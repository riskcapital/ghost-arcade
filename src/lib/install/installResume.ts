/**
 * Install mode: where a show picks up after a restart.
 *
 * A looping show resumes by the clock: at the point it would have reached
 * had it never stopped. The show's start time (its anchor) is kept by the
 * main process, beside the install state, so it outlives a reload of the
 * editor and a relaunch of the app. Visitors in the room see the loop carry
 * on where it should be, and a show that runs beside something else on a
 * clock (a sound piece on its own player, a daily ritual at a given time)
 * stays in step with it.
 *
 * Why not "from the start": after a crash at minute 40 of a 45-minute loop,
 * starting over replays 40 minutes that the room just saw. And why not "the
 * exact position at the crash": the restart takes time, and the show would
 * drift a few seconds later on every restart.
 *
 * A playlist resumes at the item it was playing, from that item's start:
 * items are separate pieces and joining one in the middle is worse than
 * replaying its beginning. "From the start" is offered as a setting for a
 * looping show too.
 */

export type InstallResumeMode = 'clock' | 'start';

/** The anchor the main process keeps for the running show. */
export interface InstallAnchor {
  /** Wall-clock ms at which the show's time 0 played. */
  anchorMs: number;
  /** Which on period it belongs to ('always' without a schedule). */
  periodKey: string;
  /** The project it belongs to. */
  projectPath: string;
  /** Playlist position, when playing a playlist. */
  playlistIndex?: number;
}

export function periodKeyFor(scheduleEnabled: boolean, periodStart: number): string {
  return scheduleEnabled ? `p${Math.round(periodStart)}` : 'always';
}

/**
 * Seconds into the show to start at, now.
 * - clock mode, looping: where the loop would be since the anchor.
 * - clock mode, not looping: the same, or 0 once the show would have ended.
 * - start mode, or no usable anchor: 0.
 */
export function resumePosition(opts: {
  mode: InstallResumeMode;
  anchorMs: number | null;
  now: number;
  duration: number;
  loop: boolean;
}): number {
  const { mode, anchorMs, now, duration, loop } = opts;
  if (mode !== 'clock' || anchorMs === null || !Number.isFinite(anchorMs)) return 0;
  if (!(duration > 0)) return 0;
  const elapsed = (now - anchorMs) / 1000;
  if (!(elapsed > 0)) return 0;
  if (loop) return elapsed % duration;
  return elapsed < duration ? elapsed : 0;
}

/**
 * The anchor to resume against: the stored one when it belongs to this
 * project and this on period; otherwise the period's own start (so a
 * machine that comes back mid-afternoon is where the loop would be had it
 * started on time), or null with no schedule and nothing stored.
 */
export function chooseAnchor(opts: {
  stored: InstallAnchor | null;
  projectPath: string;
  periodKey: string;
  periodStart: number;
  scheduleEnabled: boolean;
  warmupMs: number;
}): number | null {
  const { stored, projectPath, periodKey, periodStart, scheduleEnabled, warmupMs } = opts;
  if (stored && stored.projectPath === projectPath && stored.periodKey === periodKey && Number.isFinite(stored.anchorMs)) {
    return stored.anchorMs;
  }
  if (scheduleEnabled && periodStart > 0) return periodStart + Math.max(0, warmupMs);
  return null;
}

/** The playlist item after `index`, wrapping round. */
export function nextPlaylistIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  const i = Number.isInteger(index) && index >= 0 ? index : -1;
  return (i + 1) % length;
}

/** A stored playlist position, kept when still in range. */
export function resumePlaylistIndex(stored: InstallAnchor | null, length: number, periodKey: string): number {
  if (!stored || length <= 0 || stored.periodKey !== periodKey) return 0;
  const i = stored.playlistIndex;
  return typeof i === 'number' && Number.isInteger(i) && i >= 0 && i < length ? i : 0;
}
