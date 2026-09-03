/**
 * OSC (Open Sound Control) state + router.
 *
 * Architecture:
 *  - Electron main process owns a dgram UDP socket. Parsed messages
 *    arrive in this store via `window.ghostOSC.onMessage`.
 *  - This store maintains the bindings table (osc address → param
 *    path) and a per-binding range mapping so an OSC value can be
 *    rescaled to the target param's natural range.
 *  - On incoming message: look up the address, rescale the value,
 *    dispatch via `midiRouter.dispatchPath` — exact same router the
 *    MIDI system uses, so EVERY MIDI-mappable param gets OSC for
 *    free.
 *  - Learn mode: caller calls `oscStore.startLearn(targetPath)`. The
 *    next inbound message's address gets bound to that target path
 *    (with sensible default min/max), then learn mode auto-exits.
 *
 * State is persisted with the project (see exportProject / importProject
 * in src/lib/stores/layers.ts) so OSC routing survives reload.
 */

import { writable, get, derived } from 'svelte/store';
import { midiRouter } from '../midi/midiRouter';
import { generateUUID } from '../utils/uuid';
import {
  createVjOscTemplateBindings,
  inferOscBindingMode,
  resolveOscBindingValue,
  type OscBindingSpec,
} from './oscBindings';
import { normalizeControlPath, validateControlPath } from '../control/controlPaths';
import { vjClipLauncher } from '../stores/vjClipLauncher';

const OSC_RUNTIME_KEY = 'ghost-arcade:osc-runtime';

export interface OscBinding extends OscBindingSpec {
  id: string;
  /** OSC address pattern that triggers this binding. Exact match for
   *  MVP (e.g. '/layer/1/opacity'); pattern matching (wildcards) is a
   *  follow-up. */
  address: string;
  /** Argument index to read from the incoming message — most senders
   *  put the control value at args[0]. */
  argIndex: number;
  /** Param path forwarded to midiRouter.dispatchPath. */
  path: string;
  /** Incoming value range — what the SOURCE sends. Most OSC senders
   *  default to 0..1 floats but Lemur faders often send 0..127, and
   *  TouchOSC's XY pads can be ±1. We rescale to 0..1 internally
   *  before dispatching. */
  sourceMin: number;
  sourceMax: number;
  /** When true, invert the rescaled value (1 - x). Useful for
   *  knobs that map "up = less" semantically. */
  invert: boolean;
}

export interface OscState {
  enabled: boolean;
  port: number;
  listening: boolean;
  lastError: string | null;
  bindings: OscBinding[];
  /** Most recent message (for learn mode + UI debug feed). */
  lastMessage: { address: string; args: any[]; from: string; receivedAt: number } | null;
  /** When set, the next incoming message's address is bound to this
   *  param path instead of being dispatched normally. */
  learnTarget: { path: string; label?: string } | null;
}

const INITIAL_STATE: OscState = {
  enabled: false,
  port: 8000,
  listening: false,
  lastError: null,
  bindings: [],
  lastMessage: null,
  learnTarget: null,
};

function createOscStore() {
  const { subscribe, update, set } = writable<OscState>({ ...INITIAL_STATE });

  // The renderer-side IPC unsubscribers (closures returned by
  // ghostOSC.onMessage / onStatus). They remain attached for the app
  // lifetime so restarting the UDP socket cannot lose status events.
  let messageUnsub: (() => void) | null = null;
  let statusUnsub: (() => void) | null = null;
  let initialized = false;

  function persistRuntime() {
    if (typeof localStorage === 'undefined') return;
    try {
      const state = get({ subscribe });
      localStorage.setItem(OSC_RUNTIME_KEY, JSON.stringify({
        enabled: state.enabled,
        port: state.port,
      }));
    } catch {
      // Project persistence still carries the OSC configuration. A
      // blocked localStorage implementation must not stop the socket.
    }
  }

  function attachBridgeListeners(api: any) {
    if (!messageUnsub) {
      messageUnsub = api.onMessage((msgs: any[]) => {
        const now = performance.now();
        for (const m of msgs) {
          update(s => ({ ...s, lastMessage: { address: m.address, args: m.args, from: m.from, receivedAt: now } }));
          handleIncoming(m);
        }
      });
    }
    if (!statusUnsub) {
      statusUnsub = api.onStatus((s: { listening: boolean; port: number; error: string | null }) => {
        update(prev => ({ ...prev, listening: s.listening, port: s.port, lastError: s.error }));
      });
    }
  }

  async function startListener(port: number) {
    const api = (window as any).ghostOSC;
    if (!api) {
      console.warn('[OSC] ghostOSC bridge not available — not running under Electron?');
      update(s => ({ ...s, lastError: 'OSC requires the desktop app', listening: false }));
      return;
    }
    attachBridgeListeners(api);
    try {
      const result = await api.start({ port });
      if (result?.ok) {
        const status = await api.status();
        update(s => ({
          ...s,
          listening: status?.listening === true,
          port: status?.port ?? port,
          lastError: status?.error ?? null,
        }));
      } else {
        update(s => ({ ...s, listening: false, lastError: result?.error ?? 'unknown start error' }));
      }
    } catch (error) {
      update(s => ({
        ...s,
        listening: false,
        lastError: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  async function stopListener() {
    const api = (window as any).ghostOSC;
    if (api) await api.stop();
    update(s => ({ ...s, listening: false }));
  }

  /** Route an incoming message. If learn mode is active, capture the
   *  address as a binding for the pending target path; otherwise look
   *  up matching bindings + dispatch the rescaled value through
   *  midiRouter. */
  function handleIncoming(msg: { address: string; args: any[] }) {
    const state = get({ subscribe });

    // Learn mode — capture the next message's address as a binding
    // for the pending target. Take args[0] if numeric to seed the
    // source range; default 0..1 otherwise.
    if (state.learnTarget) {
      const val = msg.args[0];
      let sMin = 0, sMax = 1;
      if (typeof val === 'number') {
        // If the incoming value looks like it might be a controller
        // 0..127 range, snap to that. Otherwise leave 0..1.
        if (Math.abs(val) > 1.2) sMax = 127;
      }
      const binding: OscBinding = {
        id: generateUUID(),
        address: msg.address,
        argIndex: 0,
        path: normalizeControlPath(state.learnTarget.path),
        sourceMin: sMin,
        sourceMax: sMax,
        invert: false,
        label: state.learnTarget.label,
        mode: inferOscBindingMode(state.learnTarget.path),
      };
      update(s => ({ ...s, bindings: [...s.bindings, binding], learnTarget: null }));
      console.log('[OSC] learned binding:', msg.address, '→', binding.path);
      return;
    }

    // Normal routing — dispatch every matching binding (one address
    // could legitimately be bound to multiple params).
    for (const b of state.bindings) {
      if (b.address !== msg.address) continue;
      const value = resolveOscBindingValue(b, msg.args);
      if (value === null) continue;
      midiRouter.dispatchPath(b.path, value);
    }
  }

  return {
    subscribe,

    async initialize() {
      if (initialized) return;
      initialized = true;
      const api = (window as any).ghostOSC;
      if (!api) return;
      attachBridgeListeners(api);

      try {
        const saved = JSON.parse(localStorage.getItem(OSC_RUNTIME_KEY) ?? 'null');
        if (saved && typeof saved === 'object') {
          update(s => ({
            ...s,
            enabled: typeof saved.enabled === 'boolean' ? saved.enabled : s.enabled,
            port: Number.isInteger(saved.port) ? saved.port : s.port,
          }));
        }
      } catch {
        // Ignore malformed legacy runtime state.
      }

      const state = get({ subscribe });
      const status = await api.status();
      if (state.enabled && (!status?.listening || status.port !== state.port)) {
        await startListener(state.port);
      } else {
        update(s => ({
          ...s,
          listening: status?.listening === true,
          port: status?.port ?? s.port,
          lastError: status?.error ?? null,
        }));
      }
    },

    async setEnabled(enabled: boolean) {
      update(s => ({ ...s, enabled }));
      persistRuntime();
      if (enabled) {
        const port = get({ subscribe }).port;
        await startListener(port);
      } else {
        await stopListener();
      }
    },

    async setPort(port: number) {
      const validPort = Math.max(1, Math.min(65535, Math.round(port)));
      update(s => ({ ...s, port: validPort }));
      persistRuntime();
      const state = get({ subscribe });
      if (state.enabled) {
        // Restart on the new port.
        await stopListener();
        await startListener(validPort);
      }
    },

    /** Begin learn mode. The next incoming OSC message becomes a
     *  binding for `targetPath`. Auto-exits on capture. Calling
     *  startLearn with a new target replaces any prior pending learn. */
    startLearn(targetPath: string, label?: string) {
      const validation = validateControlPath(targetPath);
      if (!validation.valid) {
        update(s => ({ ...s, lastError: validation.reason }));
        return false;
      }
      update(s => ({ ...s, learnTarget: { path: validation.normalized, label }, lastError: null }));
      return true;
    },
    cancelLearn() {
      update(s => ({ ...s, learnTarget: null }));
    },

    addBinding(binding: Omit<OscBinding, 'id'>) {
      const path = normalizeControlPath(binding.path);
      update(s => ({ ...s, bindings: [...s.bindings, { id: generateUUID(), ...binding, path }] }));
    },
    /**
     * Install the VJ template for the deck the user actually has.
     *
     * The size used to be pinned at 4x8. Decks are resizable at runtime
     * (addLayer / addColumn), so anyone who grew theirs got bindings for the
     * first four layers and first eight columns and nothing for the rest —
     * including no column trigger past column 8, which reads as "column
     * launch does not work" rather than "the template stopped early".
     */
    installVjTemplate(layerCount?: number, columnCount?: number) {
      const deck = get(vjClipLauncher);
      const template = createVjOscTemplateBindings(
        layerCount ?? deck.numLayers,
        columnCount ?? deck.numColumns,
      );
      update(s => {
        const existing = new Set(s.bindings.map(b => `${b.address}\n${b.path}`));
        const additions = template
          .filter(b => !existing.has(`${b.address}\n${b.path}`))
          .map(b => ({ id: generateUUID(), ...b }));
        return additions.length > 0
          ? { ...s, bindings: [...s.bindings, ...additions] }
          : s;
      });
    },
    updateBinding(id: string, patch: Partial<OscBinding>) {
      if (typeof patch.path === 'string') patch = { ...patch, path: normalizeControlPath(patch.path) };
      update(s => ({
        ...s,
        bindings: s.bindings.map(b => b.id === id ? { ...b, ...patch } : b),
      }));
    },
    removeBinding(id: string) {
      update(s => ({ ...s, bindings: s.bindings.filter(b => b.id !== id) }));
    },

    /** Wholesale replace — used by importProject + reset() to keep the
     *  store in sync with the loaded project. */
    hydrate(state: Partial<OscState>) {
      update(s => ({
        ...INITIAL_STATE,
        ...state,
        bindings: (state.bindings ?? []).map(binding => ({
          ...binding,
          path: normalizeControlPath(binding.path),
        })),
        // Always reset transient runtime fields on hydrate.
        listening: false,
        lastError: null,
        lastMessage: null,
        learnTarget: null,
      }));
      // If the imported project had OSC enabled, kick the listener.
      if (state.enabled) {
        void startListener(state.port ?? 8000);
      }
    },

    /** Serialize the persistent subset (no transient runtime fields)
     *  for project save. */
    serialize() {
      const s = get({ subscribe });
      return {
        enabled: s.enabled,
        port: s.port,
        bindings: s.bindings,
      };
    },

    reset() {
      void stopListener();
      set({ ...INITIAL_STATE });
      persistRuntime();
    },

    destroy() {
      if (messageUnsub) { messageUnsub(); messageUnsub = null; }
      if (statusUnsub) { statusUnsub(); statusUnsub = null; }
      initialized = false;
    },
  };
}

export const oscStore = createOscStore();

// Derived: count of bindings matching a path (used by the "OSC mapped"
// indicator on slider rows in the future — placeholder for now).
export const oscBindingsByPath = derived(oscStore, $s => {
  const map = new Map<string, number>();
  for (const b of $s.bindings) {
    map.set(b.path, (map.get(b.path) ?? 0) + 1);
  }
  return map;
});
