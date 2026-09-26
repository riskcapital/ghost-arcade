/**
 * DMX input: state, bindings, learn and routing.
 *
 * The Electron main process (electron/dmx-input.cjs) owns the Art-Net and
 * sACN sockets and merge, and sends only changed channels. This store keeps
 * the latest 512 values per universe, evaluates the bindings those channels
 * feed, and dispatches through midiRouter.dispatchPath, the router MIDI,
 * OSC and the keyboard already use, so every mappable control is reachable.
 *
 * Where settings live:
 *  - On/off, bind address and protocols are machine settings
 *    (localStorage). A project opened on another machine never opens ports
 *    by itself.
 *  - Bindings, universe filter, merge rule and timeout travel with the
 *    project (serialize / hydrate from layers.ts).
 *
 * Learn works two ways:
 *  - From Settings > Integrations > DMX Input: pick a target path, press
 *    Learn, wiggle a desk fader.
 *  - From the MIDI overlay: click any control while DMX input is on, then
 *    wiggle a desk fader instead of a MIDI knob. The control's own range
 *    comes with it.
 * Channels that were already moving in the second before learn started
 * (a running chase) are ignored, so they cannot steal the binding.
 */
import { get, writable } from 'svelte/store';
import { midiRouter } from '../midi/midiRouter';
import { midiStore } from '../midi/midiStore';
import { generateUUID } from '../utils/uuid';
import { normalizeControlPath, validateControlPath } from '../control/controlPaths';
import {
  DEFAULT_TRIGGER_HYSTERESIS,
  DEFAULT_TRIGGER_THRESHOLD,
  DMX_CHANNELS,
  bindingChannels,
  createDmxLearnTracker,
  dmxUniverseKey,
  fineChannelOf,
  inferDmxBindingMode,
  resolveDmxBindingValue,
  sanitizeDmxBinding,
  stepDmxTrigger,
  type DmxBinding,
  type DmxBindingMode,
  type DmxMergeMode,
  type DmxProtocol,
} from './dmxBindings';

const RUNTIME_KEY = 'ghost-arcade:dmx-input-runtime';
const BUSY_BEFORE_LEARN_MS = 1000;
const ACTIVITY_THROTTLE_MS = 66;

export interface DmxInputSourceStatus {
  name: string;
  address: string;
  priority: number;
  length: number;
  ageMs: number;
}

export interface DmxInputUniverseStatus {
  protocol: DmxProtocol;
  universe: number;
  live: boolean;
  sources: DmxInputSourceStatus[];
}

export interface DmxInputStatus {
  running: boolean;
  bindAddress: string | null;
  artnet: { enabled: boolean; listening: boolean; error: string | null; port: number };
  sacn: { enabled: boolean; listening: boolean; error: string | null; port: number };
  mergeMode: DmxMergeMode;
  universeFilter: number[];
  interfaces?: Array<{ name: string; address: string }>;
  stats: {
    received: number;
    accepted: number;
    malformed: number;
    ignored: number;
    filtered: number;
    outOfOrder: number;
    own: number;
    flushes: number;
    lastReason: string | null;
  };
  universes: DmxInputUniverseStatus[];
}

export interface DmxLearnTarget {
  path: string;
  label?: string;
  mode?: DmxBindingMode;
  min?: number;
  max?: number;
  discreteValues?: string[];
  /** 'midi' when armed from the MIDI overlay. */
  source: 'panel' | 'midi';
}

export interface DmxInputState {
  // Machine settings
  enabled: boolean;
  bindAddress: string;
  artnet: boolean;
  sacn: boolean;
  sacnMulticast: boolean;
  // Project settings
  universes: number[];
  mergeMode: DmxMergeMode;
  timeoutMs: number;
  bindings: DmxBinding[];
  // Runtime
  listening: boolean;
  lastError: string | null;
  status: DmxInputStatus | null;
  learn: DmxLearnTarget | null;
  /** Id of the binding the last learn created, for the panel to highlight. */
  lastLearnedId: string | null;
}

export interface DmxProjectData {
  universes: number[];
  mergeMode: DmxMergeMode;
  timeoutMs: number;
  bindings: DmxBinding[];
}

const PROJECT_DEFAULTS: DmxProjectData = {
  universes: [],
  mergeMode: 'htp',
  timeoutMs: 2500,
  bindings: [],
};

const INITIAL_STATE: DmxInputState = {
  enabled: false,
  bindAddress: '0.0.0.0',
  artnet: true,
  sacn: true,
  sacnMulticast: true,
  ...PROJECT_DEFAULTS,
  listening: false,
  lastError: null,
  status: null,
  learn: null,
  lastLearnedId: null,
};

interface UniverseValues {
  data: Uint8Array;
  changedAt: Float64Array;
}

/** Latest merged values per universe. Outside the store on purpose: they
 *  change up to 40 times a second and only the monitor reads them. */
const universeValues = new Map<string, UniverseValues>();

/** Bumped (throttled) when channels arrive, so the monitor knows to redraw. */
export const dmxActivity = writable(0);

export function getDmxUniverseValues(protocol: DmxProtocol, universe: number): Uint8Array | null {
  return universeValues.get(dmxUniverseKey(protocol, universe))?.data ?? null;
}

/** Universes that have delivered data this session, for the monitor picker. */
export function listDmxUniverses(): Array<{ protocol: DmxProtocol; universe: number }> {
  return [...universeValues.keys()].map(key => {
    const [protocol, universe] = key.split(':');
    return { protocol: protocol as DmxProtocol, universe: Number(universe) };
  });
}

function sanitizeBindings(raw: unknown): DmxBinding[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: DmxBinding[] = [];
  for (const entry of raw) {
    let id = typeof (entry as { id?: unknown })?.id === 'string' ? (entry as { id: string }).id.trim() : '';
    if (!id || seen.has(id)) id = generateUUID();
    const binding = sanitizeDmxBinding(entry, id);
    if (!binding) continue;
    seen.add(id);
    out.push(binding);
  }
  return out;
}

function sanitizeProject(raw: Partial<DmxProjectData> | null | undefined): DmxProjectData {
  const data = raw && typeof raw === 'object' ? raw : {};
  const universes = Array.isArray(data.universes)
    ? [...new Set(data.universes.filter(value => Number.isInteger(value) && value >= 0 && value <= 63999))].slice(0, 64)
    : [];
  const timeout = Number(data.timeoutMs);
  return {
    universes,
    mergeMode: data.mergeMode === 'ltp' || data.mergeMode === 'priority' ? data.mergeMode : 'htp',
    timeoutMs: Number.isFinite(timeout) ? Math.max(250, Math.min(30000, Math.round(timeout))) : PROJECT_DEFAULTS.timeoutMs,
    bindings: sanitizeBindings(data.bindings),
  };
}

function isIPv4(value: string): boolean {
  const parts = value.split('.');
  return parts.length === 4 && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

function createDmxStore() {
  const store = writable<DmxInputState>({ ...INITIAL_STATE });
  const { subscribe, update, set } = store;

  let initialized = false;
  let changesUnsub: (() => void) | null = null;
  let statusUnsub: (() => void) | null = null;
  let midiUnsub: (() => void) | null = null;
  let startToken = 0;
  let bindingsByUniverse = new Map<string, DmxBinding[]>();
  let indexedBindings: DmxBinding[] | null = null;
  const lastDispatched = new Map<string, number>();
  const triggerPressed = new Map<string, boolean>();
  const tracker = createDmxLearnTracker();
  let learnStartedAt = 0;
  let learnKey: string | null = null;
  const busyChannels = new Set<string>();
  let lastActivityAt = 0;
  let activityPending: ReturnType<typeof setTimeout> | null = null;

  const api = () => (typeof window !== 'undefined' ? (window as any).ghostDMX : undefined);

  function persistRuntime() {
    if (typeof localStorage === 'undefined') return;
    try {
      const state = get(store);
      localStorage.setItem(RUNTIME_KEY, JSON.stringify({
        enabled: state.enabled,
        bindAddress: state.bindAddress,
        artnet: state.artnet,
        sacn: state.sacn,
        sacnMulticast: state.sacnMulticast,
      }));
    } catch {
      // Blocked storage only loses the remembered switch, never the socket.
    }
  }

  function reindex(bindings: DmxBinding[]) {
    if (bindings === indexedBindings) return;
    indexedBindings = bindings;
    const next = new Map<string, DmxBinding[]>();
    const live = new Set<string>();
    for (const binding of bindings) {
      live.add(binding.id);
      const key = dmxUniverseKey(binding.protocol, binding.universe);
      next.set(key, [...(next.get(key) ?? []), binding]);
    }
    bindingsByUniverse = next;
    // A removed or edited binding starts from scratch; a held trigger is
    // released so a clip does not stay latched to a binding that is gone.
    for (const id of [...triggerPressed.keys()]) {
      if (!live.has(id) && triggerPressed.get(id)) midiRouter.releaseInputs(`dmx:${id}`);
      if (!live.has(id)) triggerPressed.delete(id);
    }
    for (const id of [...lastDispatched.keys()]) if (!live.has(id)) lastDispatched.delete(id);
  }

  function bumpActivity() {
    const now = performance.now();
    if (now - lastActivityAt >= ACTIVITY_THROTTLE_MS) {
      lastActivityAt = now;
      dmxActivity.update(value => value + 1);
      return;
    }
    if (activityPending) return;
    activityPending = setTimeout(() => {
      activityPending = null;
      lastActivityAt = performance.now();
      dmxActivity.update(value => value + 1);
    }, ACTIVITY_THROTTLE_MS);
  }

  function dispatchBinding(binding: DmxBinding, data: Uint8Array) {
    const inputId = `dmx:${binding.id}`;
    if (binding.mode === 'trigger') {
      const was = triggerPressed.get(binding.id) ?? false;
      const step = stepDmxTrigger(binding, data, was);
      triggerPressed.set(binding.id, step.pressed);
      if (step.edge === 'press') midiRouter.dispatchPath(binding.path, 1, { inputId, discreteValues: binding.discreteValues });
      else if (step.edge === 'release') midiRouter.dispatchPath(binding.path, 0, { inputId, discreteValues: binding.discreteValues });
      return;
    }
    const value = resolveDmxBindingValue(binding, data);
    const previous = lastDispatched.get(binding.id);
    if (previous !== undefined && Math.abs(previous - value) < 1e-9) return;
    lastDispatched.set(binding.id, value);
    midiRouter.dispatchPath(binding.path, value, { inputId, discreteValues: binding.discreteValues });
  }

  function finishLearn(state: DmxInputState) {
    const learn = state.learn;
    if (!learn) return;
    const wants16 = learn.mode === '16bit';
    const candidate = wants16 ? tracker.winner16() : tracker.winner();
    if (!candidate) return;
    const path = normalizeControlPath(learn.path);
    const mode: DmxBindingMode = learn.mode ?? inferDmxBindingMode(path);
    const binding = sanitizeDmxBinding({
      protocol: candidate.protocol,
      universe: candidate.universe,
      channel: candidate.channel,
      fineChannel: mode === '16bit' ? candidate.channel + 1 : undefined,
      mode,
      path,
      label: learn.label,
      min: learn.min ?? 0,
      max: learn.max ?? 1,
      invert: false,
      threshold: DEFAULT_TRIGGER_THRESHOLD,
      hysteresis: DEFAULT_TRIGGER_HYSTERESIS,
      discreteValues: learn.discreteValues,
    }, generateUUID());
    if (!binding) return;
    // The channel that was just wiggled is where it is now; seed the
    // trigger state so the release that follows the learn does not fire.
    const values = universeValues.get(dmxUniverseKey(binding.protocol, binding.universe));
    if (values && binding.mode === 'trigger') triggerPressed.set(binding.id, stepDmxTrigger(binding, values.data, false).pressed);
    if (values && binding.mode !== 'trigger') lastDispatched.set(binding.id, resolveDmxBindingValue(binding, values.data));
    update(s => ({ ...s, bindings: [...s.bindings, binding], learn: null, lastLearnedId: binding.id }));
    stopLearnTracking();
    if (learn.source === 'midi') midiStore.cancelLearn();
    console.log('[DMX in] learned', `${binding.protocol} U${binding.universe} ch${binding.channel}`, '->', binding.path);
  }

  function handleChanges(batch: { universes?: Array<{ protocol: DmxProtocol; universe: number; changes: number[] }> }) {
    const state = get(store);
    const learning = !!state.learn;
    const now = performance.now();
    for (const entry of batch?.universes ?? []) {
      if ((entry.protocol !== 'artnet' && entry.protocol !== 'sacn') || !Number.isInteger(entry.universe)) continue;
      const key = dmxUniverseKey(entry.protocol, entry.universe);
      let values = universeValues.get(key);
      if (!values) {
        values = { data: new Uint8Array(DMX_CHANNELS), changedAt: new Float64Array(DMX_CHANNELS).fill(-Infinity) };
        universeValues.set(key, values);
      }
      const changes = Array.isArray(entry.changes) ? entry.changes : [];
      const touched = new Set<number>();
      for (let index = 0; index + 1 < changes.length; index += 2) {
        const channelIndex = changes[index];
        const value = changes[index + 1];
        if (!Number.isInteger(channelIndex) || channelIndex < 0 || channelIndex >= DMX_CHANNELS) continue;
        if (!Number.isInteger(value) || value < 0 || value > 255) continue;
        const previous = values.data[channelIndex];
        if (learning) {
          const busyKey = `${key}:${channelIndex}`;
          const lastChange = values.changedAt[channelIndex];
          if (lastChange >= learnStartedAt - BUSY_BEFORE_LEARN_MS && lastChange < learnStartedAt) busyChannels.add(busyKey);
          if (!busyChannels.has(busyKey)) tracker.observe(entry.protocol, entry.universe, channelIndex, previous, value);
        }
        values.data[channelIndex] = value;
        values.changedAt[channelIndex] = now;
        touched.add(channelIndex + 1);
      }
      // Bindings are not driven while learning, like MIDI edit mode: the
      // fader being wiggled should not also move whatever it drove before.
      if (learning || touched.size === 0) continue;
      for (const binding of bindingsByUniverse.get(key) ?? []) {
        if (bindingChannels(binding).some(channel => touched.has(channel))) dispatchBinding(binding, values.data);
      }
    }
    bumpActivity();
    if (learning) finishLearn(state);
  }

  function beginLearnTracking(target: DmxLearnTarget) {
    tracker.reset();
    busyChannels.clear();
    learnStartedAt = performance.now();
    learnKey = `${target.source}:${target.path}`;
  }

  function stopLearnTracking() {
    tracker.reset();
    busyChannels.clear();
    learnKey = null;
  }

  function attachBridge(bridge: any) {
    if (!changesUnsub) changesUnsub = bridge.onChanges(handleChanges);
    if (!statusUnsub) {
      statusUnsub = bridge.onStatus((status: DmxInputStatus) => {
        update(s => ({ ...s, status, listening: listeningFrom(status) }));
      });
    }
  }

  function listeningFrom(status: DmxInputStatus | null | undefined): boolean {
    return !!status?.running && (!!status.artnet?.listening || !!status.sacn?.listening);
  }

  function startConfig(state: DmxInputState) {
    return {
      bindAddress: state.bindAddress,
      artnet: state.artnet,
      sacn: state.sacn,
      sacnMulticast: state.sacnMulticast,
      universes: state.universes,
      mergeMode: state.mergeMode,
      timeoutMs: state.timeoutMs,
    };
  }

  async function startListener() {
    const bridge = api();
    if (!bridge) {
      update(s => ({ ...s, listening: false, lastError: 'DMX input needs the desktop app' }));
      return;
    }
    attachBridge(bridge);
    const token = ++startToken;
    universeValues.clear();
    try {
      const result = await bridge.start(startConfig(get(store)));
      if (token !== startToken) return;
      const errors = [result?.status?.artnet?.error, result?.status?.sacn?.error].filter(Boolean);
      update(s => ({
        ...s,
        status: result?.status ?? null,
        listening: listeningFrom(result?.status),
        lastError: result?.ok ? (errors.length ? errors.join(' ') : null) : (result?.error ?? 'Could not start DMX input'),
      }));
    } catch (error) {
      if (token !== startToken) return;
      update(s => ({ ...s, listening: false, lastError: error instanceof Error ? error.message : String(error) }));
    }
  }

  async function stopListener() {
    startToken += 1;
    midiRouter.releaseInputs('dmx:');
    triggerPressed.clear();
    lastDispatched.clear();
    const bridge = api();
    try { await bridge?.stop(); } catch { /* bridge gone */ }
    update(s => ({ ...s, listening: false, status: s.status ? { ...s.status, running: false } : null }));
  }

  async function restartIfRunning() {
    if (get(store).enabled) await startListener();
  }

  function watchMidiLearn() {
    if (midiUnsub) return;
    midiUnsub = midiStore.subscribe(midi => {
      const state = get(store);
      const learn = midi.learn;
      if (learn?.active && learn.targetPath && state.enabled && state.listening) {
        if (state.learn?.source === 'panel') return;
        const target: DmxLearnTarget = {
          path: learn.targetPath,
          label: learn.targetLabel ?? undefined,
          min: learn.targetMin,
          max: learn.targetMax,
          mode: learn.targetMode === 'toggle' ? 'trigger' : undefined,
          discreteValues: learn.targetDiscreteValues,
          source: 'midi',
        };
        if (learnKey === `midi:${target.path}`) return;
        beginLearnTracking(target);
        update(s => ({ ...s, learn: target }));
      } else if (state.learn?.source === 'midi') {
        stopLearnTracking();
        update(s => ({ ...s, learn: null }));
      }
    });
  }

  // Keep the per-universe binding index in step with the bindings.
  subscribe(state => reindex(state.bindings));

  return {
    subscribe,

    async initialize() {
      if (initialized) return;
      initialized = true;
      const bridge = api();
      if (!bridge) return;
      attachBridge(bridge);
      watchMidiLearn();
      try {
        const saved = JSON.parse(localStorage.getItem(RUNTIME_KEY) ?? 'null');
        if (saved && typeof saved === 'object') {
          update(s => ({
            ...s,
            enabled: saved.enabled === true,
            bindAddress: typeof saved.bindAddress === 'string' && isIPv4(saved.bindAddress) ? saved.bindAddress : s.bindAddress,
            artnet: typeof saved.artnet === 'boolean' ? saved.artnet : s.artnet,
            sacn: typeof saved.sacn === 'boolean' ? saved.sacn : s.sacn,
            sacnMulticast: typeof saved.sacnMulticast === 'boolean' ? saved.sacnMulticast : s.sacnMulticast,
          }));
        }
      } catch {
        // Ignore malformed runtime state.
      }
      if (get(store).enabled) {
        await startListener();
      } else {
        // A renderer reload while main is still listening (dev) must not
        // leave a socket open that the UI says is off.
        try {
          const status = await bridge.status();
          if (status?.running) await bridge.stop();
        } catch { /* ignore */ }
      }
    },

    async setEnabled(enabled: boolean) {
      update(s => ({ ...s, enabled, learn: enabled ? s.learn : null }));
      persistRuntime();
      if (enabled) await startListener();
      else await stopListener();
    },

    async setNetwork(patch: Partial<Pick<DmxInputState, 'bindAddress' | 'artnet' | 'sacn' | 'sacnMulticast'>>) {
      const next = { ...patch };
      if (next.bindAddress !== undefined) {
        const address = next.bindAddress.trim() || '0.0.0.0';
        if (!isIPv4(address)) {
          update(s => ({ ...s, lastError: 'Bind address must be an IPv4 address, or 0.0.0.0 for all interfaces' }));
          return;
        }
        next.bindAddress = address;
      }
      update(s => {
        const merged = { ...s, ...next };
        // Never leave both protocols off; turning one off keeps the other.
        if (!merged.artnet && !merged.sacn) return s;
        return merged;
      });
      persistRuntime();
      await restartIfRunning();
    },

    async setUniverses(universes: number[]) {
      update(s => ({ ...s, universes: sanitizeProject({ universes }).universes }));
      await restartIfRunning();
    },

    async setMerge(patch: Partial<Pick<DmxInputState, 'mergeMode' | 'timeoutMs'>>) {
      const data = sanitizeProject({ ...get(store), ...patch });
      update(s => ({ ...s, mergeMode: data.mergeMode, timeoutMs: data.timeoutMs }));
      const bridge = api();
      if (bridge && get(store).listening) {
        try {
          const result = await bridge.update({ mergeMode: data.mergeMode, timeoutMs: data.timeoutMs });
          if (result?.status) update(s => ({ ...s, status: result.status }));
        } catch { /* ignore */ }
      }
    },

    async refreshStatus() {
      const bridge = api();
      if (!bridge) return;
      try {
        const status = await bridge.status();
        update(s => ({ ...s, status, listening: listeningFrom(status) }));
      } catch { /* ignore */ }
    },

    /** Arm learn for a control path. The next wiggled channel is bound to it. */
    startLearn(path: string, options: { label?: string; mode?: DmxBindingMode; min?: number; max?: number } = {}) {
      const validation = validateControlPath(path);
      if (!validation.valid) {
        update(s => ({ ...s, lastError: validation.reason }));
        return false;
      }
      const target: DmxLearnTarget = { path: validation.normalized, ...options, source: 'panel' };
      beginLearnTracking(target);
      update(s => ({ ...s, learn: target, lastError: null, lastLearnedId: null }));
      return true;
    },

    cancelLearn() {
      const learn = get(store).learn;
      stopLearnTracking();
      update(s => ({ ...s, learn: null }));
      if (learn?.source === 'midi') midiStore.cancelLearn();
    },

    addBinding(binding: Omit<DmxBinding, 'id'>) {
      const clean = sanitizeDmxBinding(binding, generateUUID());
      if (!clean) return null;
      update(s => ({ ...s, bindings: [...s.bindings, clean] }));
      return clean.id;
    },

    updateBinding(id: string, patch: Partial<DmxBinding>) {
      update(s => ({
        ...s,
        bindings: s.bindings.map(binding => {
          if (binding.id !== id) return binding;
          const next = sanitizeDmxBinding({ ...binding, ...patch }, id);
          if (!next) return binding;
          // Moving a binding to 16-bit picks the next channel as fine.
          if (next.mode === '16bit' && patch.mode === '16bit' && binding.mode !== '16bit') next.fineChannel = fineChannelOf({ channel: next.channel });
          return next;
        }),
      }));
    },

    removeBinding(id: string) {
      update(s => ({ ...s, bindings: s.bindings.filter(binding => binding.id !== id) }));
    },

    serialize(): DmxProjectData {
      const state = get(store);
      return {
        universes: [...state.universes],
        mergeMode: state.mergeMode,
        timeoutMs: state.timeoutMs,
        bindings: state.bindings.map(binding => ({ ...binding })),
      };
    },

    /** Load a project's DMX data. Machine settings and the socket are kept. */
    hydrate(raw: Partial<DmxProjectData> | null | undefined) {
      const data = sanitizeProject(raw);
      const before = get(store);
      midiRouter.releaseInputs('dmx:');
      triggerPressed.clear();
      lastDispatched.clear();
      stopLearnTracking();
      update(s => ({ ...s, ...data, learn: null, lastLearnedId: null }));
      const filterChanged = before.universes.join(',') !== data.universes.join(',');
      const mergeChanged = before.mergeMode !== data.mergeMode || before.timeoutMs !== data.timeoutMs;
      if (before.enabled && filterChanged) void startListener();
      else if (before.enabled && mergeChanged) void this.setMerge({ mergeMode: data.mergeMode, timeoutMs: data.timeoutMs });
    },

    /** New project: clear project data, keep the machine settings. */
    reset() {
      this.hydrate(null);
    },

    destroy() {
      midiRouter.releaseInputs('dmx:');
      changesUnsub?.(); changesUnsub = null;
      statusUnsub?.(); statusUnsub = null;
      midiUnsub?.(); midiUnsub = null;
      if (activityPending) { clearTimeout(activityPending); activityPending = null; }
      initialized = false;
    },

    /** Test hook: feed a change batch as if it came from main. */
    _handleChanges: handleChanges,
    _resetForTests() {
      set({ ...INITIAL_STATE });
      universeValues.clear();
      triggerPressed.clear();
      lastDispatched.clear();
      stopLearnTracking();
      indexedBindings = null;
    },
  };
}

export const dmxStore = createDmxStore();
