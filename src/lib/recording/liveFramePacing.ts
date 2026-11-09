/** Longest gap one late capture fills (seconds), so a long stall (window
 *  hidden, rAF paused) does not write minutes of a frozen frame at once. */
const MAX_FILL_SECONDS = 5;

/** How many encoder frame slots one live capture fills: 1, plus every slot
 *  the wall clock has passed since the last one was queued (capped). Keeps
 *  a recording real-time when the view renders slower than its frame rate. */
export function liveFrameRepeat(queuedFrames: number, elapsedMs: number, fps: number): number {
  const due = Math.floor((Math.max(0, elapsedMs) * fps) / 1000) + 1;
  return Math.max(1, Math.min(due - queuedFrames, Math.round(fps * MAX_FILL_SECONDS)));
}
