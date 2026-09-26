/**
 * Frames-per-second from two readings of a presented-frames counter, for
 * the native status line.
 *
 * The status is logged right after the core starts and then every few
 * seconds. The first log came a millisecond or so after the baseline was
 * taken, and a dozen frames over that sliver (floored at 1 ms) printed
 * nativeFps=12000. A rate is now only measured over at least
 * STATUS_RATE_MIN_INTERVAL_MS; a reading sooner than that keeps the
 * baseline and reports the previous rate. A counter that went backwards
 * (the core restarted) starts a new baseline instead of a rate.
 */
export const STATUS_RATE_MIN_INTERVAL_MS = 500;

export interface FrameRateSample {
  /** Counter value and time (ms) the next rate is measured from. */
  count: number;
  at: number;
  /** The rate to report now. */
  fps: number;
}

export function statusFrameRate(
  baseline: { count: number; at: number } | null,
  count: number,
  now: number,
  previousFps = 0,
): FrameRateSample {
  const safeCount = Number.isFinite(count) ? count : 0;
  if (!baseline || !(baseline.at > 0) || !Number.isFinite(now)) {
    return { count: safeCount, at: now, fps: 0 };
  }
  if (safeCount < baseline.count) return { count: safeCount, at: now, fps: 0 };
  const elapsedMs = now - baseline.at;
  if (!(elapsedMs >= STATUS_RATE_MIN_INTERVAL_MS)) {
    return { count: baseline.count, at: baseline.at, fps: previousFps };
  }
  return { count: safeCount, at: now, fps: (safeCount - baseline.count) / (elapsedMs / 1000) };
}
