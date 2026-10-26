import { get } from 'svelte/store';
import { history } from './history';
import { project } from './layers';
import { createDeferredRecorder } from '../utils/deferredRecorder';

/**
 * One undo step for a run of arrow-key nudges on layer points: the snapshot
 * is taken once the presses stop for NUDGE_HISTORY_IDLE_MS, or straight away
 * when the arrow key comes up or an undo or redo needs the history current.
 */
export const NUDGE_HISTORY_IDLE_MS = 600;

const recorder = createDeferredRecorder(() => history.record(get(project)), NUDGE_HISTORY_IDLE_MS);

/** A layer point was nudged; one undo step covers the whole run. */
export function scheduleHistorySnapshot(): void {
  recorder.schedule();
}

/** Take the waiting snapshot now (an arrow key came up, or before undo). */
export function flushPendingHistorySnapshot(): void {
  recorder.flush();
}
