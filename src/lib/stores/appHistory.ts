/**
 * The app's one undo timeline: which stores a step spans, and how an undo or
 * redo makes a step live. App.svelte wires it at launch and calls it for
 * Cmd/Ctrl+Z; the history tests drive the same functions.
 *
 * Keyframe timelines and the output stage (Screens, Master Warp) live in
 * their own stores rather than inside Project, so every step captures them
 * beside it; this is the only place that sees all three. Each store replaces
 * its value on every edit rather than mutating it, so holding the references
 * is a complete, cheap capture.
 *
 * Steps are recorded where an edit ends (historyHooks), never on a store
 * subscription. Playback records nothing, and live control runs under
 * runAsLiveControl (midiRouter), so neither lands in the history.
 */

import { get } from 'svelte/store';
import type { Project } from '../types';
import { history, type HistorySnapshot } from './history';
import { project, selectedLayerIds } from './layers';
import { keyframeTimeline } from './keyframeTimeline';
import { settings } from './settings';
import { selectedScreenId, selectedScreenMaskId, screenMaskPlacing } from './screens';
import {
  setHistoryCallback,
  setProjectReplacedCallback,
  cancelPendingHistorySnapshot,
  flushPendingHistorySnapshot,
  beginHistoryRestore,
  endHistoryRestore,
} from './historyHooks';

interface CapturedHistoryState {
  project: Project;
  keyframes: ReturnType<typeof keyframeTimeline.exportAll>;
  output: ReturnType<typeof settings.captureOutputHistory>;
}

/** The live state of every store a step spans. */
export function captureHistoryState(): CapturedHistoryState {
  return {
    project: get(project),
    keyframes: keyframeTimeline.exportAll(),
    output: settings.captureOutputHistory(),
  };
}

function commitHistoryState(captured: unknown) {
  const state = captured as CapturedHistoryState;
  history.record(state.project, state.keyframes, state.output);
}

/** Record a step of the live state. Call sites record through
 *  recordDiscreteAction() (historyHooks), which first commits an edit still
 *  waiting for its debounce as its own step. */
export function recordHistory() {
  commitHistoryState(captureHistoryState());
}

/** Start the undo history over at the project as it is now: after a project
 *  is opened, recovered or created, undo must not reach back into the
 *  project that was open before. The keyframes and the Screens are part of
 *  the baseline. */
export function resetHistoryToCurrent() {
  cancelPendingHistorySnapshot();
  history.clear();
  const state = captureHistoryState();
  history.init(state.project, state.keyframes, state.output);
}

/** Install the recorder (setHistoryCallback) and the reset on open. */
export function wireAppHistory() {
  setHistoryCallback(recordHistory, {
    capture: captureHistoryState,
    commit: commitHistoryState,
    amend: () => {
      const state = captureHistoryState();
      history.amend(state.project, state.keyframes, state.output);
    },
  });
  // Opening a project (any path: File, Open Recent, recovery, relink,
  // package) starts its history over. Deferred to a microtask so what the
  // opening path does right after the import is part of the starting point,
  // not the first undo.
  setProjectReplacedCallback(() => queueMicrotask(resetHistoryToCurrent));
}

/** Make an undo or redo step live in every store it spans. Only what the
 *  step changed is restored (see mergeProjectStep, mergeKeyframeStep and
 *  mergeOutputStep). */
function applyHistorySnapshot(step: HistorySnapshot) {
  project.set(step.project);
  // The multi-selection may still name a layer the step removed.
  project.setSelectedLayerIds(get(selectedLayerIds));
  // beginHistoryRestore() keeps the stores from recording the state they
  // are restoring as a fresh step (which would poison the redo stack).
  beginHistoryRestore();
  try {
    if (step.keyframes) keyframeTimeline.importAll(step.keyframes as Parameters<typeof keyframeTimeline.importAll>[0]);
    if (step.output) {
      settings.applyOutputStage(step.output);
      // An undone Screen or mask may have been the selected one.
      const screenId = get(selectedScreenId);
      const screen = get(settings).output.slices?.find((s) => s.id === screenId);
      if (screenId && !screen) selectedScreenId.set(null);
      const maskId = get(selectedScreenMaskId);
      if (maskId && !screen?.masks?.some((m) => m.id === maskId)) {
        selectedScreenMaskId.set(null);
        screenMaskPlacing.set(false);
      }
    }
  } finally {
    endHistoryRestore();
  }
}

function moveHistory(direction: 'undo' | 'redo'): boolean {
  // Commit any debounced edit first, so it becomes its own step instead of
  // being lost or merged into whatever the undo jumps back to.
  flushPendingHistorySnapshot();
  const { past, future } = get(history);
  if ((direction === 'undo' ? past : future).length === 0) return false;
  history.suppress();
  const live = captureHistoryState();
  const step = direction === 'undo'
    ? history.undo(live.project, live.keyframes, live.output)
    : history.redo(live.project, live.keyframes, live.output);
  if (step) applyHistorySnapshot(step);
  history.unsuppress();
  return !!step;
}

/** Undo one step. False when there is nothing to undo. */
export function undoHistory(): boolean {
  return moveHistory('undo');
}

/** Redo one step. False when there is nothing to redo. */
export function redoHistory(): boolean {
  return moveHistory('redo');
}
