/**
 * Controllers for control lines: bindings (a MIDI CC, a Live knob or an OSC
 * address driving one parameter), "touch a knob to bind", the last value of
 * every CC (for lines that follow a CC), and a watch on the project so a
 * change from the panel slider, OSC, a mapped MIDI control or a Live signal
 * is recorded too.
 *
 * Wiring (lineSession.ts does it): `onMidi` is a MIDI tap (midi/midiTaps.ts,
 * after MIDI learn, so learn always wins), `observe` runs on project changes,
 * `pollLive` runs every frame.
 */
import type { MidiMessageType } from '../../midi/midiTypes';
import type { LineRecorder } from './lineRecorder';
import { lineFor, RELEASE_MS } from './lineRecorder';
import type { ControlLine } from './lineModel';
import { layerParams, ledParams, readParam, stageParams, targetId, type ParamEntry, type ParamTarget, type RegistrySource } from './paramRegistry';

export type BindingSource =
  | { kind: 'midi'; channel: number; cc: number; input?: string }
  | { kind: 'live-param'; track: number; device: number; param: number }
  | { kind: 'osc'; address: string };

export interface LineBinding {
  id: string;
  source: BindingSource;
  target: ParamTarget;
  key: string;
}

export interface LineControlsHost {
  recorder: LineRecorder;
  lines(): readonly ControlLine[];
  describe(target: ParamTarget, key: string): ParamEntry | null;
  showTime(): number;
  playing(): boolean;
  newId(): string;
  now?: () => number;
  liveParam?: (track: number, device: number, param: number) => number | null;
  onBindingsChange?: (bindings: LineBinding[]) => void;
  /** The project is being put back (undo / redo): stored values that move
   *  now were not moved by a control, so they are not recorded. */
  restoring?: () => boolean;
  /** An engine is writing (modulation, Auto, a section, a cue, a takeover):
   *  with Follow edits on, what it moves is not a person's edit. */
  automated?: () => boolean;
  /** Live edit: key `value` on the parameter's line at show time `t` (parked playhead). */
  keyAt?: (target: ParamTarget, key: string, value: number | boolean, t: number) => void;
}

/** Every parameter Follow edits watches: each mapping layer's own, the Stage
 *  FX and the LED rig. The scopes are read from the project as it is now. */
function followTargets(source: RegistrySource): { target: ParamTarget; keys: () => string[]; ref: unknown }[] {
  const out: { target: ParamTarget; keys: () => string[]; ref: unknown }[] = [];
  for (const layer of source.layers) {
    out.push({ target: { scope: 'layer', id: layer.id }, ref: layer, keys: () => layerParams(layer).map((p) => p.key) });
  }
  out.push({ target: { scope: 'stage' }, ref: source.mappingComposition, keys: () => stageParams(source).map((p) => p.key) });
  out.push({ target: { scope: 'led' }, ref: [source.wledControllers, source.wledEffects], keys: () => ledParams(source).map((p) => p.key) });
  return out;
}

const sameRef = (a: unknown, b: unknown): boolean =>
  Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((x, i) => x === b[i]) : a === b;

const sameSource = (a: BindingSource, b: BindingSource) => JSON.stringify(a) === JSON.stringify(b);

export function createLineControls(host: LineControlsHost, initial: LineBinding[] = []) {
  const now = host.now ?? (() => performance.now());
  let bindings = initial.slice();
  let pending: { target: ParamTarget; key: string } | null = null;
  const ccValues = new Map<string, number>();
  /** Unrecorded moves of a bound control: they drive the line live, like a touch. */
  const liveTouch = new Map<string, { value: number; at: number }>();
  const merged = new Map<string, number>();
  const lastObserved = new Map<string, number | boolean>();
  const lastLive = new Map<string, number>();
  const watched = new Map<string, { target: ParamTarget; key: string }>();
  /** Follow edits: record any parameter a person changes, not only lines. */
  let followEdits = false;
  /** Follow edits: the object each scope was last read from. A scope whose
   *  object is the same has not changed (the stores replace what they edit). */
  const followRefs = new Map<string, unknown>();

  const setBindings = (next: LineBinding[]) => {
    bindings = next;
    host.onBindingsChange?.(bindings);
  };

  /** A bound control moved to `value` (parameter units). */
  function controlInput(target: ParamTarget, key: string, value: number | boolean): void {
    if (host.recorder.armed && host.playing()) {
      host.recorder.input(target, key, value, host.showTime());
      return;
    }
    const line = lineFor(host.lines(), target, key);
    if (line) liveTouch.set(line.id, { value: typeof value === 'boolean' ? (value ? 1 : 0) : value, at: now() });
  }

  function scaled(target: ParamTarget, key: string, normalized: number): number | boolean | null {
    const entry = host.describe(target, key);
    if (!entry) return null;
    const v = Math.max(0, Math.min(1, normalized));
    if (entry.kind === 'bool') return v >= 0.5;
    const raw = entry.min + v * (entry.max - entry.min);
    return entry.kind === 'stepped' ? Math.round(raw / entry.step) * entry.step : raw;
  }

  return {
    bindings: () => bindings,
    setBindings,
    unbind(id: string): void {
      setBindings(bindings.filter((b) => b.id !== id));
    },

    /** The next moved MIDI CC binds to this parameter. */
    bindNext(target: ParamTarget, key: string): void {
      pending = { target, key };
    },
    cancelBind(): void {
      pending = null;
    },
    pendingBind: () => pending,

    /** MIDI tap. True when the message was used to bind (kept from the mappings). */
    onMidi(channel: number, type: MidiMessageType, number: number, value: number, from: { id: string | null; name?: string }): boolean {
      if (type !== 'cc') return false;
      const v = value / 127;
      ccValues.set(`${channel}:${number}`, v);
      if (from.name) ccValues.set(`${from.name}|${channel}:${number}`, v);
      if (pending) {
        const source: BindingSource = { kind: 'midi', channel, cc: number, ...(from.name ? { input: from.name } : {}) };
        const { target, key } = pending;
        pending = null;
        // One control drives one parameter: rebinding moves it.
        setBindings([
          ...bindings.filter((b) => !sameSource(b.source, source) && !(b.key === key && targetId(b.target) === targetId(target))),
          { id: host.newId(), source, target, key },
        ]);
        return true;
      }
      for (const b of bindings) {
        const s = b.source;
        if (s.kind !== 'midi' || s.cc !== number || (s.channel !== -1 && s.channel !== channel)) continue;
        if (s.input && from.name && s.input !== from.name) continue;
        const scaledValue = scaled(b.target, b.key, v);
        if (scaledValue !== null) controlInput(b.target, b.key, scaledValue);
      }
      return false;
    },

    /** An OSC message (0..1) for a bound address. */
    onOsc(address: string, normalized: number): boolean {
      let used = false;
      for (const b of bindings) {
        if (b.source.kind !== 'osc' || b.source.address !== address) continue;
        const v = scaled(b.target, b.key, normalized);
        if (v !== null) { controlInput(b.target, b.key, v); used = true; }
      }
      return used;
    },

    /** The panel slider (or anything else that knows the parameter): value in parameter units. */
    controlInput,

    /** Last value of a CC, 0..1 (a line following a CC). */
    midiCC(channel: number, cc: number, input?: string): number | null {
      if (input) {
        const v = ccValues.get(`${input}|${channel}:${cc}`);
        if (v !== undefined) return v;
      }
      if (channel === -1) {
        for (let ch = 0; ch < 16; ch++) {
          const v = ccValues.get(`${ch}:${cc}`);
          if (v !== undefined) return v;
        }
        return null;
      }
      return ccValues.get(`${channel}:${cc}`) ?? null;
    },

    /** Every frame: Live knobs bound to a parameter. */
    pollLive(): void {
      if (!host.liveParam) return;
      for (const b of bindings) {
        const s = b.source;
        if (s.kind !== 'live-param') continue;
        const v = host.liveParam(s.track, s.device, s.param);
        if (v === null) continue;
        const prev = lastLive.get(b.id);
        lastLive.set(b.id, v);
        if (prev === undefined || Math.abs(prev - v) < 1e-4) continue;
        const scaledValue = scaled(b.target, b.key, v);
        if (scaledValue !== null) controlInput(b.target, b.key, scaledValue);
      }
    },

    /** Also record this parameter when its stored value changes (a selected parameter without a line). */
    watch(target: ParamTarget, key: string): void {
      watched.set(`${targetId(target)}|${key}`, { target, key });
    },
    unwatch(target: ParamTarget, key: string): void {
      watched.delete(`${targetId(target)}|${key}`);
    },

    /**
     * The project changed. A parameter with a line (or watched) whose stored
     * value moved while armed and playing was moved by a control (slider,
     * OSC, a mapped MIDI control, a Live signal): record it.
     */
    observe(source: RegistrySource): void {
      const seen = new Set<string>();
      const automated = host.automated?.() ?? false;
      const visit = (target: ParamTarget, key: string, follow = false) => {
        const k = `${targetId(target)}|${key}`;
        if (seen.has(k)) return;
        seen.add(k);
        const value = readParam(source, target, key);
        if (value === undefined) return;
        const prev = lastObserved.get(k);
        lastObserved.set(k, value);
        if (prev === undefined || prev === value) return;
        if (host.restoring?.()) return;
        // Follow edits records what a person changes; an engine's own moves
        // only drive the output. A line or a watched parameter is recorded
        // from anything, as before.
        if (follow && automated) return;
        if (host.recorder.armed && host.playing()) {
          host.recorder.input(target, key, value, host.showTime());
          return;
        }
        // Live edit: the playhead is parked, armed with Follow edits on. A
        // person's change is keyed on the line at the playhead.
        if (followEdits && host.recorder.armed && !automated) host.keyAt?.(target, key, value, host.showTime());
      };
      for (const line of host.lines()) visit(line.target, line.key);
      for (const w of watched.values()) visit(w.target, w.key);
      if (!followEdits || !host.recorder.armed) return;
      for (const scope of followTargets(source)) {
        const id = targetId(scope.target);
        const before = followRefs.get(id);
        followRefs.set(id, scope.ref);
        if (before !== undefined && sameRef(before, scope.ref)) continue;
        for (const key of scope.keys()) visit(scope.target, key, true);
      }
    },

    /** Follow edits: while armed, record every parameter a person changes in
     *  the editor (Mapping, the panels, controllers), not only bound ones. */
    setFollowEdits(on: boolean, source?: RegistrySource): void {
      followEdits = on;
      followRefs.clear();
      // Read every value now, so the first change after this is recorded.
      if (on && source && host.recorder.armed) this.observe(source);
    },
    followEdits: () => followEdits,

    /** Touch values for LineContext.touch: open record passes, plus unrecorded live moves. */
    touches(): ReadonlyMap<string, number> {
      const rec = host.recorder.touches();
      if (!liveTouch.size) return rec;
      merged.clear();
      const t = now();
      for (const [id, entry] of liveTouch) {
        if (t - entry.at > RELEASE_MS) liveTouch.delete(id);
        else merged.set(id, entry.value);
      }
      for (const [id, v] of rec) merged.set(id, v);
      return merged;
    },
  };
}

export type LineControls = ReturnType<typeof createLineControls>;
