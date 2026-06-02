// MediaPipe binding table + signal → param router.
//
// Mirrors oscStore's design: each binding is "signal id → target path"
// with rescaling, smoothing, and a trigger/latch/momentary mode for
// categorical (gesture) sources. Routing dispatches via the shared
// `midiRouter.dispatchPath(path, 0..1)` — every MIDI-learnable param
// in the app becomes gesture-bindable with no per-param plumbing.

import { midiRouter } from '../midi/midiRouter';
import { mediaPipeSource } from './mediaPipeSource';
import type { SignalFrame, GestureName } from './signals';

export type MediaPipeBindingMode = 'continuous' | 'trigger' | 'latch';

export interface MediaPipeBinding {
  id: string;
  /** Signal id from SIGNAL_DEFS. Continuous (palm.right.x, pinch.left,
   *  hands.distance, palm.right.z, ...) or categorical (gesture.right,
   *  gesture.left). */
  signalId: string;
  /** Param path consumed by midiRouter.dispatchPath. */
  path: string;
  /** UI label for the binding row — usually the param's display name. */
  label?: string;
  /** Source-range rescaling. For continuous signals the raw 0..1 range
   *  maps to [sourceMin..sourceMax] before midiRouter applies the
   *  param's own range. Lets you confine "palm Y" to a useful band. */
  sourceMin: number;
  sourceMax: number;
  /** Invert the rescaled value. */
  invert: boolean;
  /** Exponential smoothing factor for continuous signals. 0=no smoothing,
   *  ~0.7=heavy. Skips smoothing on the first frame after enable. */
  smoothing: number;
  /** Below this confidence the signal is ignored. */
  minConfidence: number;
  /** Native value range of the target param — captured at tap time
   *  from `data-midi-min/max`. The bus rescales its 0..1 output into
   *  this range before dispatching, so binding a 0..1 signal to a
   *  0..8 param actually reaches the full range. Falls back to 0..1
   *  if absent. */
  targetMin?: number;
  targetMax?: number;
  /** For continuous: 'continuous' (live value).
   *  For categorical (gestures): the gesture name to match, plus mode:
   *    - trigger: fire 1.0 on the frame the gesture appears, 0 otherwise
   *    - latch: flip a stored 0/1 each time the gesture fires */
  mode: MediaPipeBindingMode;
  /** When mode='trigger' or 'latch', the gesture name we match. Ignored
   *  for continuous bindings. */
  gestureName?: GestureName;
  /** Persisted internal latch state (mode='latch' only). */
  _latched?: number;
  /** Last emitted value, for smoothing. */
  _last?: number;
}

// MediaPipe bindings live in the project file (via serialize/hydrate),
// NOT in localStorage. That keeps each project's gesture mappings tied
// to the project: opening a different project loads its own bindings,
// closing the app without saving loses unsaved changes. Mirrors how
// macros / snapshots / osc / synthvision persist.
function stripInternal(b: MediaPipeBinding): MediaPipeBinding {
  const { _latched, _last, ...rest } = b;
  return rest as MediaPipeBinding;
}

let bindings: MediaPipeBinding[] = [];
let unsubSource: (() => void) | null = null;
let attached = false;
const subscribers = new Set<(bs: MediaPipeBinding[]) => void>();

// ── Learn-target mode ────────────────────────────────────────────────
// When active, the next click anywhere in the app that lands on (or
// inside) a `data-midi-path` element captures that element's metadata
// and resolves a pending "pick target" promise. Click capture runs at
// the capture phase so we beat normal handlers, and `preventDefault` +
// `stopPropagation` ensure the click doesn't also nudge the slider.
export interface LearnTarget {
  path: string;
  label?: string;
  min?: number;
  max?: number;
  step?: number;
}
let learnActive = false;
let learnResolver: ((t: LearnTarget | null) => void) | null = null;
let learnCleanup: (() => void) | null = null;
const learnSubscribers = new Set<(active: boolean) => void>();

function notifyLearn(): void {
  for (const cb of learnSubscribers) {
    try { cb(learnActive); } catch {}
  }
}

function findLearnTarget(start: EventTarget | null): LearnTarget | null {
  let el: HTMLElement | null = start as HTMLElement | null;
  while (el && el !== document.body) {
    const path = el.getAttribute?.('data-midi-path');
    if (path) {
      const min = el.getAttribute('data-midi-min');
      const max = el.getAttribute('data-midi-max');
      const step = el.getAttribute('data-midi-step');
      return {
        path,
        label: el.getAttribute('data-midi-label') ?? undefined,
        min: min != null ? Number(min) : undefined,
        max: max != null ? Number(max) : undefined,
        step: step != null ? Number(step) : undefined,
      };
    }
    el = el.parentElement;
  }
  return null;
}

function notify(): void {
  for (const cb of subscribers) {
    try { cb(bindings.slice()); } catch {}
  }
}

function genId(): string {
  return 'mpb-' + Math.random().toString(36).slice(2, 9);
}

/** Process one signal frame, dispatch any bindings whose source value
 *  changed enough to matter. Called from the source subscription. */
function processFrame(frame: SignalFrame): void {
  for (const b of bindings) {
    if (b.mode === 'continuous') {
      const v = frame.values[b.signalId];
      if (typeof v !== 'number' || Number.isNaN(v)) continue;
      const conf = frame.confidence[b.signalId] ?? 0;
      if (conf < b.minConfidence) continue;
      // Rescale source range to 0..1
      let scaled = (v - b.sourceMin) / Math.max(1e-6, b.sourceMax - b.sourceMin);
      scaled = Math.max(0, Math.min(1, scaled));
      if (b.invert) scaled = 1 - scaled;
      // Exponential smoothing
      const prev = b._last;
      const smooth = Math.max(0, Math.min(0.95, b.smoothing));
      const smoothed = (typeof prev === 'number' && smooth > 0)
        ? prev * smooth + scaled * (1 - smooth)
        : scaled;
      b._last = smoothed;
      // Rescale into the target param's native range before dispatch.
      // Without this step, binding to a param with min=0 max=8 would
      // only ever reach 1/8 of its travel.
      const tMin = b.targetMin ?? 0;
      const tMax = b.targetMax ?? 1;
      const out = tMin + smoothed * (tMax - tMin);
      try { midiRouter.dispatchPath(b.path, out); } catch (e) { console.warn('[MediaPipe] dispatchPath failed', b.path, e); }
    } else {
      // trigger / latch — categorical
      if (!b.signalId.startsWith('gesture.')) continue;
      const fired = frame.gestures[b.signalId];
      if (!fired || fired !== b.gestureName) continue;
      const conf = frame.confidence[b.signalId] ?? 0;
      if (conf < b.minConfidence) continue;
      if (b.mode === 'trigger') {
        try { midiRouter.dispatchPath(b.path, 1); } catch {}
        // We don't follow up with 0 on the next frame — the source's
        // gesture-edge-only emission means the next frame is naturally
        // a non-fire. Consumers that want a momentary pulse should
        // re-bind as mode='momentary' once we add it (Phase 1B).
      } else if (b.mode === 'latch') {
        b._latched = b._latched ? 0 : 1;
        try { midiRouter.dispatchPath(b.path, b._latched); } catch {}
      }
    }
  }
}

/** Attach the source listener — called once when the source first
 *  starts, kept attached even when the source stops/starts (a fresh
 *  start re-emits frames into the same subscription). */
function ensureAttached(): void {
  if (attached) return;
  unsubSource = mediaPipeSource.subscribe(processFrame);
  attached = true;
}

export const mediaPipeBus = {
  /** Subscribe to binding list changes (for UI). */
  subscribe(cb: (bs: MediaPipeBinding[]) => void): () => void {
    subscribers.add(cb);
    cb(bindings.slice());
    return () => subscribers.delete(cb);
  },

  list(): MediaPipeBinding[] { return bindings.slice(); },

  add(partial: Partial<MediaPipeBinding> & Pick<MediaPipeBinding, 'signalId' | 'path'>): MediaPipeBinding {
    ensureAttached();
    const b: MediaPipeBinding = {
      id: partial.id ?? genId(),
      signalId: partial.signalId,
      path: partial.path,
      label: partial.label,
      sourceMin: partial.sourceMin ?? 0,
      sourceMax: partial.sourceMax ?? 1,
      invert: partial.invert ?? false,
      smoothing: partial.smoothing ?? 0.35,
      minConfidence: partial.minConfidence ?? 0.5,
      mode: partial.mode ?? (partial.signalId.startsWith('gesture.') ? 'trigger' : 'continuous'),
      gestureName: partial.gestureName,
      targetMin: partial.targetMin,
      targetMax: partial.targetMax,
    };
    bindings.push(b);
    notify();
    return b;
  },

  update(id: string, patch: Partial<MediaPipeBinding>): void {
    const idx = bindings.findIndex(b => b.id === id);
    if (idx === -1) return;
    bindings[idx] = { ...bindings[idx], ...patch };
    notify();
  },

  remove(id: string): void {
    bindings = bindings.filter(b => b.id !== id);
    notify();
  },

  clear(): void {
    bindings = [];
    notify();
  },

  // ── Learn-target API ───────────────────────────────────────────────
  /** Subscribe to learn-active state for UI styling. */
  subscribeLearn(cb: (active: boolean) => void): () => void {
    learnSubscribers.add(cb);
    cb(learnActive);
    return () => learnSubscribers.delete(cb);
  },

  /** True while a `pickTarget()` is awaiting a click. */
  isLearning(): boolean { return learnActive; },

  /** Enter learn mode: returns a promise that resolves with the next
   *  clicked element's MIDI metadata, or null if cancelled. Only one
   *  pickTarget can be active at a time — a second call cancels the
   *  first. */
  pickTarget(): Promise<LearnTarget | null> {
    // Cancel any in-flight learn before starting a new one.
    if (learnActive) this.cancelLearn();

    return new Promise<LearnTarget | null>((resolve) => {
      learnActive = true;
      learnResolver = resolve;

      const onClick = (e: MouseEvent) => {
        const target = findLearnTarget(e.target);
        if (target) {
          // Eat the click so the slider doesn't also move.
          e.preventDefault();
          e.stopImmediatePropagation();
          finish(target);
        }
      };
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') finish(null);
      };
      const finish = (t: LearnTarget | null) => {
        if (!learnActive) return;
        learnActive = false;
        document.removeEventListener('click', onClick, true);
        document.removeEventListener('keydown', onKey, true);
        learnCleanup = null;
        const r = learnResolver;
        learnResolver = null;
        notifyLearn();
        if (r) r(t);
      };
      learnCleanup = () => finish(null);

      // Capture phase so we beat any click handlers on the target.
      document.addEventListener('click', onClick, true);
      document.addEventListener('keydown', onKey, true);
      notifyLearn();
    });
  },

  /** Abort an in-flight `pickTarget()` resolving null. */
  cancelLearn(): void {
    if (learnCleanup) learnCleanup();
  },

  /** Fire-and-forget version of pickTarget that auto-creates the
   *  binding once a target is clicked. Use this when the calling UI
   *  (e.g. a settings panel) may unmount before the user actually
   *  clicks a target — the bus owns the whole flow, so the panel can
   *  disappear without dropping the in-flight learn. */
  beginLearnAndBind(spec: Partial<MediaPipeBinding> & Pick<MediaPipeBinding, 'signalId'>): void {
    void this.pickTarget().then(t => {
      if (!t) return;  // cancelled
      this.add({
        ...spec,
        path: t.path,
        label: spec.label ?? t.label,
        targetMin: t.min,
        targetMax: t.max,
      });
    });
  },

  /** Multi-bind learn session. Stays armed across many target clicks
   *  until `endLearnSession()` or Esc. On each click, calls `getSpec`
   *  for the current form values, creates the binding, then fires
   *  `onBound` so the modal can show what was just added. Designed for
   *  the floating-modal flow where the user keeps assigning params to
   *  the same (or rotating) signal without re-entering learn mode. */
  beginLearnSession(
    getSpec: () => Partial<MediaPipeBinding> & Pick<MediaPipeBinding, 'signalId'>,
    onBound: (b: MediaPipeBinding) => void,
  ): () => void {
    // A normal pickTarget() shouldn't be running concurrently; cancel
    // if it is.
    if (learnActive) this.cancelLearn();

    learnActive = true;
    notifyLearn();

    const onClick = (e: MouseEvent) => {
      const target = findLearnTarget(e.target);
      if (!target) return;  // not a bindable element, let the click through
      e.preventDefault();
      e.stopImmediatePropagation();
      const spec = getSpec();
      const b = this.add({
        ...spec,
        path: target.path,
        label: spec.label ?? target.label,
        targetMin: target.min,
        targetMax: target.max,
      });
      try { onBound(b); } catch {}
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') stop();
    };
    const stop = () => {
      if (!learnActive) return;
      learnActive = false;
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKey, true);
      learnCleanup = null;
      notifyLearn();
    };
    learnCleanup = stop;
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
    return stop;
  },

  /** End an active learn session (or pickTarget). Safe no-op if none. */
  endLearnSession(): void {
    if (learnCleanup) learnCleanup();
  },

  // ── Project save/load ──────────────────────────────────────────────
  /** Return a plain-data snapshot suitable for embedding in the
   *  project's .gha file. Strips runtime-only fields (_last, _latched). */
  serialize(): MediaPipeBinding[] {
    return bindings.map(stripInternal);
  },

  /** Replace current bindings with a saved snapshot. Tolerant of
   *  partial / malformed data — silently drops anything that doesn't
   *  parse. Called from project import. */
  hydrate(data: unknown): void {
    if (!Array.isArray(data)) { this.reset(); return; }
    const next: MediaPipeBinding[] = [];
    for (const item of data) {
      if (!item || typeof item !== 'object') continue;
      const b = item as any;
      if (typeof b.signalId !== 'string' || typeof b.path !== 'string') continue;
      next.push({
        id: typeof b.id === 'string' ? b.id : genId(),
        signalId: b.signalId,
        path: b.path,
        label: typeof b.label === 'string' ? b.label : undefined,
        sourceMin: typeof b.sourceMin === 'number' ? b.sourceMin : 0,
        sourceMax: typeof b.sourceMax === 'number' ? b.sourceMax : 1,
        invert: !!b.invert,
        smoothing: typeof b.smoothing === 'number' ? b.smoothing : 0.35,
        minConfidence: typeof b.minConfidence === 'number' ? b.minConfidence : 0.5,
        mode: b.mode === 'trigger' || b.mode === 'latch' ? b.mode : 'continuous',
        gestureName: typeof b.gestureName === 'string' ? b.gestureName : undefined,
        targetMin: typeof b.targetMin === 'number' ? b.targetMin : undefined,
        targetMax: typeof b.targetMax === 'number' ? b.targetMax : undefined,
      });
    }
    bindings = next;
    if (bindings.length > 0) ensureAttached();
    notify();
  },

  /** Wipe all bindings (used when a project loads without any). */
  reset(): void {
    bindings = [];
    notify();
  },

  /** Seed a curated set of bindings hand → macros 1-4. Wipes any
   *  existing bindings first so the result is predictable; the user
   *  can prune from there. The macro paths are stable wet/dry knobs,
   *  so this works in any project regardless of layer layout. */
  loadDefaults(): void {
    ensureAttached();
    bindings = [
      {
        id: genId(), signalId: 'spread.right', path: 'vj:macro:1:value',
        label: 'Macro 1 (Right spread)', sourceMin: 0.25, sourceMax: 0.95,
        invert: false, smoothing: 0.4, minConfidence: 0.5, mode: 'continuous',
      },
      {
        id: genId(), signalId: 'palm.right.y', path: 'vj:macro:2:value',
        label: 'Macro 2 (Right palm height)', sourceMin: 0.15, sourceMax: 0.85,
        // Invert so raising the hand opens the macro (Y goes 0→top→1→bottom).
        invert: true, smoothing: 0.35, minConfidence: 0.5, mode: 'continuous',
      },
      {
        id: genId(), signalId: 'pinch.right', path: 'vj:macro:3:value',
        label: 'Macro 3 (Right pinch)', sourceMin: 0.05, sourceMax: 0.6,
        // Invert so pinched=1 (knob open), released=0.
        invert: true, smoothing: 0.45, minConfidence: 0.5, mode: 'continuous',
      },
      {
        id: genId(), signalId: 'hands.distance', path: 'vj:macro:4:value',
        label: 'Macro 4 (Hands apart)', sourceMin: 0.1, sourceMax: 0.7,
        invert: false, smoothing: 0.4, minConfidence: 0.5, mode: 'continuous',
      },
    ];
    notify();
  },
};

// No boot-time attach — bindings are empty until a project hydrates
// them via mediaPipeBus.hydrate(). add() / hydrate() both call
// ensureAttached() as needed once the first binding lands.
