/**
 * History-recording hooks, shared by every store that mutates undoable state.
 *
 * This lives in its own module rather than in layers.ts because `layers.ts`
 * imports `keyframeTimeline.ts`, so the keyframe store cannot import back from
 * layers.ts without a cycle. Both import from here instead.
 *
 * The actual snapshot is taken by App.svelte (via setHistoryCallback), which
 * is the only place that can see every store at once.
 */

/**
 * How App.svelte takes and stores a step. `record` snapshots the live state
 * of every undoable store. `capture` takes the same state cheaply (store
 * values are replaced, not mutated, on every edit, so holding references is
 * enough) and `commit` records a state captured earlier — that is what lets
 * an edit still waiting for its debounce become its own step when a
 * different edit arrives before the debounce ends.
 */
export interface HistorySnapshotHooks {
  capture: () => unknown;
  commit: (captured: unknown) => void;
  /** Fold the live state into the latest step instead of adding one. */
  amend?: () => void;
}

// We record SYNCHRONOUSLY (no setTimeout) so each discrete action lands in its
// own undo step. Previously this used setTimeout(_, 0) which coalesced rapid
// successive actions — drawing 10 light-painting strokes in quick succession
// scheduled 10 callbacks that all fired in the next tick reading the SAME
// post-mutation project, so the undo stack only got 1 entry pointing at the
// pre-first-stroke state. One undo would wipe every stroke. Now each call
// captures the project state synchronously, post-update, so undo unwinds
// stroke-by-stroke as expected.
let _record: (() => void) | null = null;
let _snapshotHooks: HistorySnapshotHooks | null = null;

export function setHistoryCallback(record: () => void, snapshotHooks?: HistorySnapshotHooks) {
  _record = record;
  _snapshotHooks = snapshotHooks ?? null;
}

/**
 * Record one undo step for an action that has just been applied.
 *
 * A debounced edit that is still waiting (a slider, a dropdown) is committed
 * first, as the state it left, so it stays its own step instead of being
 * folded into this one. The exception is an edit made as part of the same
 * gesture (within GESTURE_GAP_MS), which belongs in this step.
 */
export function recordDiscreteAction() {
  if (_liveControlDepth > 0) return;
  if (_pending) {
    // A recording take is never folded into an edit, however close they are.
    if (_pending.keys.has(RECORDING_TAKE) || Date.now() - _pending.lastEditAt >= GESTURE_GAP_MS) commitPending();
    else cancelPendingHistorySnapshot();
  }
  if (_record) _record();
}

/**
 * Fold a follow-up into the step just recorded, for work an action finishes
 * a moment later on its own: a new layer gets its default shader once that
 * has loaded. Recording it as a step of its own meant undoing "add layer"
 * took two presses, the first of which only removed the shader.
 */
export function amendLastHistoryStep() {
  if (_liveControlDepth > 0) return;
  if (_snapshotHooks?.amend) _snapshotHooks.amend();
  else if (_record) _record();
}

// ─── Debounced history for continuous edits (sliders, drags) ──────────────
// recordDiscreteAction() above is for one-shot ops (add/remove layer, etc.)
// where every call is its own undo step. Panel sliders and dropdowns funnel
// many rapid updates through the same doUpdate()-style function with no
// clean "the user stopped editing" signal at that call site — recording on
// every call would spam the undo stack, and NOT recording at all is the bug
// this was added to fix. scheduleHistorySnapshot() coalesces a burst of edits
// into one snapshot ~600ms after the last one; flushPendingHistorySnapshot()
// commits early (called before undo/redo so an in-flight edit isn't lost or
// merged into whatever the undo jumps back to).
//
// The burst is keyed. Edits with the same key (one slider, one field of one
// layer) coalesce for as long as they keep coming. An edit with a different
// key ends the burst: the state the burst left is committed as its own step
// and a new burst starts. Without the key, changing a blend mode and then
// adding a layer half a second later was one undo step. Edits less than
// GESTURE_GAP_MS apart are one gesture whatever their keys (a slider that
// also writes a keyframe, a handler that sets two fields one after another).
const HISTORY_DEBOUNCE_MS = 600;
const GESTURE_GAP_MS = 50;
const RECORDING_TAKE = '\u0000recording-take';

interface PendingSnapshot {
  keys: Set<string>;
  lastEditAt: number;
  captured: unknown;
  timer: ReturnType<typeof setTimeout>;
}
let _pending: PendingSnapshot | null = null;

function captureNow(): unknown {
  return _snapshotHooks ? _snapshotHooks.capture() : undefined;
}

function commitPending() {
  const pending = _pending;
  if (!pending) return;
  clearTimeout(pending.timer);
  _pending = null;
  if (_snapshotHooks) _snapshotHooks.commit(pending.captured);
  else if (_record) _record();
}

/**
 * Coalesce a continuous edit into one undo step, recorded ~600ms after the
 * last edit with the same key. `key` names what is being edited (for example
 * `layer:<id>:opacity`); call sites that pass none share one key.
 */
export function scheduleHistorySnapshot(key = '') {
  if (_liveControlDepth > 0) return;
  schedule(key);
}

/**
 * Values a controller or an automation engine records into tracks armed for
 * keyframes. The whole take is one step: it is committed once recording has
 * paused for HISTORY_DEBOUNCE_MS, when the timeline stops or a track is
 * disarmed (endRecordingTake), before undo and redo, and the moment an edit
 * of the user's arrives, so the two never share a step.
 */
export function scheduleRecordingTakeSnapshot() {
  schedule(RECORDING_TAKE);
}

/** End a recording take now, if one is waiting. */
export function endRecordingTake() {
  if (_pending?.keys.has(RECORDING_TAKE)) commitPending();
}

function schedule(key: string) {
  const now = Date.now();
  if (_pending && !_pending.keys.has(key)) {
    const take = key === RECORDING_TAKE || _pending.keys.has(RECORDING_TAKE);
    if (take || now - _pending.lastEditAt >= GESTURE_GAP_MS) commitPending();
  }
  if (_pending) {
    clearTimeout(_pending.timer);
    _pending.keys.add(key);
  }
  const timer = setTimeout(commitPending, HISTORY_DEBOUNCE_MS);
  _pending = {
    keys: _pending?.keys ?? new Set([key]),
    lastEditAt: now,
    captured: captureNow(),
    timer,
  };
}

/** Commit any debounced edit now (before undo/redo, save, quit). */
export function flushPendingHistorySnapshot() {
  commitPending();
}

/** Drop a debounced edit without recording it. Used when the whole history
 *  is reset (a project was opened or created), where it no longer applies. */
export function cancelPendingHistorySnapshot() {
  if (!_pending) return;
  clearTimeout(_pending.timer);
  _pending = null;
}

/** True while an edit is waiting for its debounce. */
export function hasPendingHistorySnapshot(): boolean {
  return _pending !== null;
}

// ─── Live control and automation ─────────────────────────────────────────
// Controllers, OSC, DMX, show control, macro knobs and the automation engines
// (Auto, audio and LFO modulation, performance pads) perform: they change
// values many times a second. Everything they write runs inside
// runAsLiveControl(), where nothing becomes an undo step: a fader or an
// engine would otherwise fill the history in seconds, push the real edits out
// of it and fight every undo. The one undoable thing they make is a
// recording into an armed keyframe track (scheduleRecordingTakeSnapshot).
let _liveControlDepth = 0;
export function runAsLiveControl<T>(fn: () => T): T {
  _liveControlDepth += 1;
  try {
    return fn();
  } finally {
    _liveControlDepth -= 1;
  }
}
export function isLiveControl(): boolean { return _liveControlDepth > 0; }

/**
 * Suppress recording while a snapshot is being restored.
 *
 * undo()/redo() call importAll()/set() on the stores they restore, and those
 * setters record history like any other mutation would — without this guard an
 * undo would immediately push the state it just restored as a NEW entry,
 * poisoning the redo stack and making a second undo a no-op.
 */
let _restoreDepth = 0;
export function beginHistoryRestore() { _restoreDepth += 1; }
export function endHistoryRestore() { _restoreDepth = Math.max(0, _restoreDepth - 1); }
export function isRestoringHistory() { return _restoreDepth > 0; }

/**
 * A project was replaced wholesale (opened from a file, recovered from an
 * autosave). The undo history belongs to the project that was there before,
 * so App.svelte resets it to the new project; without that, the first undo
 * after opening a project brought the previous project back.
 */
let _onProjectReplaced: (() => void) | null = null;
export function setProjectReplacedCallback(fn: (() => void) | null) { _onProjectReplaced = fn; }
export function notifyProjectReplaced() {
  cancelPendingHistorySnapshot();
  if (_onProjectReplaced) _onProjectReplaced();
}
