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

// History recording callback — set from App.svelte to avoid circular imports.
// We record SYNCHRONOUSLY (no setTimeout) so each discrete action lands in its
// own undo step. Previously this used setTimeout(_, 0) which coalesced rapid
// successive actions — drawing 10 light-painting strokes in quick succession
// scheduled 10 callbacks that all fired in the next tick reading the SAME
// post-mutation project, so the undo stack only got 1 entry pointing at the
// pre-first-stroke state. One undo would wipe every stroke. Now each call
// captures the project state synchronously, post-update, so undo unwinds
// stroke-by-stroke as expected.
let _onDiscreteAction: (() => void) | null = null;
export function setHistoryCallback(fn: () => void) { _onDiscreteAction = fn; }
export function recordDiscreteAction() { if (_onDiscreteAction) _onDiscreteAction(); }

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
const HISTORY_DEBOUNCE_MS = 600;
let _historySnapshotTimer: ReturnType<typeof setTimeout> | null = null;

export function scheduleHistorySnapshot() {
  if (_historySnapshotTimer) clearTimeout(_historySnapshotTimer);
  _historySnapshotTimer = setTimeout(() => {
    _historySnapshotTimer = null;
    recordDiscreteAction();
  }, HISTORY_DEBOUNCE_MS);
}

export function flushPendingHistorySnapshot() {
  if (!_historySnapshotTimer) return;
  clearTimeout(_historySnapshotTimer);
  _historySnapshotTimer = null;
  recordDiscreteAction();
}

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
