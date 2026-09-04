/**
 * Anchoring the native playback clock.
 *
 * Under the native engine the DOM video element is not what renders. What the
 * core presents comes from three fields carried on a clip or a media source:
 * a time, the wall-clock instant that time was true, and a seek generation.
 * The core free-runs between seeks, so the stored time is only the last
 * anchor — never the live position.
 *
 * Writing videoElement.currentTime instead moves a clock nothing draws from.
 * That was the whole of "the app ignores my timeline position": the value
 * arrived correctly and was applied to the wrong place. It existed separately
 * on the VJ side and the mapping side, so the fix lives here once rather than
 * being written twice and drifting apart.
 */

/** The subset both VJClip and MediaSource share. */
export interface NativeTransportTarget {
  isPlaying?: boolean;
  playbackRate?: number;
  _nativePlaybackTimeSeconds?: number;
  _nativePlaybackUpdatedAtMs?: number;
  _nativePlaybackSeekSeq?: number;
}

/**
 * How far an incoming timeline may drift before we re-anchor.
 *
 * A timeline source — Beat Link Trigger following a CDJ, a DAW, a show
 * controller — sends position tens of times a second. Seeking on each one
 * would re-arm the decoder constantly and look far worse than not syncing.
 * Between corrections the anchor already advances the clip at the right rate,
 * so a seek is only needed once it has genuinely fallen out of step.
 *
 * 80ms is about two frames at 25fps: past where a cut reads as late, well
 * above the jitter of position sent over UDP.
 */
export const NATIVE_POSITION_DRIFT_SECONDS = 0.08;

/**
 * Where this target's playhead is right now, predicted from the anchor.
 * Reading the stored time alone would report the last seek, not the position.
 */
export function predictNativePlayheadSeconds(
  target: NativeTransportTarget,
  nowMs = performance.now(),
): number {
  const anchored = Number(target._nativePlaybackTimeSeconds);
  if (!Number.isFinite(anchored)) return 0;
  if (target.isPlaying === false) return Math.max(0, anchored);
  const anchorMs = Number(target._nativePlaybackUpdatedAtMs);
  if (!Number.isFinite(anchorMs)) return Math.max(0, anchored);
  const rate = Number(target.playbackRate) || 1;
  return Math.max(0, anchored + (Math.max(0, nowMs - anchorMs) / 1000) * rate);
}

/** The three fields that must move together to re-anchor the core. */
export interface NativeAnchorFields {
  _nativePlaybackTimeSeconds: number;
  _nativePlaybackUpdatedAtMs: number;
  _nativePlaybackSeekSeq: number;
}

/**
 * Build the anchor for a seek to `seconds`.
 *
 * All three fields or none: a time without a fresh timestamp reads as an old
 * position that has since advanced, and without a bumped seek generation the
 * core never re-seeks at all.
 */
export function buildNativeAnchor(
  target: NativeTransportTarget,
  seconds: number,
): NativeAnchorFields {
  const previous = Number(target._nativePlaybackSeekSeq);
  return {
    _nativePlaybackTimeSeconds: Math.max(0, seconds),
    _nativePlaybackUpdatedAtMs: performance.now(),
    _nativePlaybackSeekSeq: (Number.isFinite(previous) ? Math.max(0, Math.floor(previous)) : 0) + 1,
  };
}

/**
 * Should a seek to `seconds` actually be issued, or is the target already
 * close enough to leave running?
 */
export function needsNativeReanchor(
  target: NativeTransportTarget,
  seconds: number,
  driftToleranceSeconds = NATIVE_POSITION_DRIFT_SECONDS,
): boolean {
  if (!Number.isFinite(seconds)) return false;
  const drift = Math.abs(seconds - predictNativePlayheadSeconds(target));
  return drift > Math.max(0, driftToleranceSeconds);
}
