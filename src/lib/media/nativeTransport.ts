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

/** Launch from the end of the trim when running backwards. The decoder
 * selects the last picture below this exclusive endpoint. */
export function nativeVideoLaunchTime(target: {
  playbackRate?: number; trimStart?: number; trimEnd?: number;
}, duration?: number): number {
  if (!Number.isFinite(duration) || !duration || duration <= 0) return 0;
  const start = Math.max(0, Math.min(1, Number(target.trimStart ?? 0)));
  const end = Math.max(start, Math.min(1, Number(target.trimEnd ?? 1)));
  return duration * ((target.playbackRate ?? 1) < 0 ? end : start);
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
  if ((target as NativeVideoTransportTarget).playbackMode === 'bounce') return nativeVideoTransportSnapshot(target, nowMs).timeSeconds;
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

export interface NativeVideoTransportTarget extends NativeTransportTarget {
  playbackMode?: string;
  durationSeconds?: number;
  videoElement?: { duration: number; currentTime: number };
  trimStart?: number;
  trimEnd?: number;
  /** Direction at the time anchor, independent of the selected launch speed. */
  _nativePlaybackDirection?: number;
}

/** Position and travel direction are one snapshot. Re-anchoring a bounce
 * using position alone would turn every pause on the return leg into a jump. */
export function nativeVideoTransportSnapshot(target: NativeVideoTransportTarget, nowMs = performance.now()) {
  const duration = Number(target.durationSeconds ?? target.videoElement?.duration);
  const rate = Number.isFinite(target.playbackRate) ? target.playbackRate! : 1;
  const direction = target.playbackMode === 'bounce'
    ? (target._nativePlaybackDirection ?? (rate < 0 ? -1 : 1))
    : (rate < 0 ? -1 : 1);
  const anchored = Number(target._nativePlaybackTimeSeconds ?? target.videoElement?.currentTime ?? 0);
  const anchorMs = Number(target._nativePlaybackUpdatedAtMs);
  const elapsed = target.isPlaying === false || !Number.isFinite(anchorMs) ? 0 : Math.max(0, nowMs - anchorMs) / 1000;
  let time = (Number.isFinite(anchored) ? anchored : 0) + elapsed * Math.abs(rate) * direction;
  if (!(duration > 0 && Number.isFinite(duration))) return { timeSeconds: Math.max(0, time), direction };
  const lo = duration * Math.max(0, Math.min(1, target.trimStart ?? 0));
  const hi = Math.max(lo, duration * Math.max(0, Math.min(1, target.trimEnd ?? 1)));
  const span = hi - lo;
  if (span <= 0) return { timeSeconds: lo, direction };
  if (target.playbackMode === 'bounce') {
    const phase = ((time - lo) % (2 * span) + 2 * span) % (2 * span);
    time = lo + (phase <= span ? phase : 2 * span - phase);
    const travel = phase < 1e-9 ? 1 : Math.abs(phase - span) < 1e-9 ? -1 : phase < span ? direction : -direction;
    return { timeSeconds: time, direction: travel };
  }
  if (target.playbackMode === 'once') time = Math.max(lo, Math.min(hi, time));
  else if (!(rate < 0 && Math.abs(time - hi) < 1e-9)) time = lo + ((time - lo) % span + span) % span;
  return { timeSeconds: time, direction };
}

/** Use only when writing a new time anchor. Explicit seeks choose the launch
 * direction; pause/resume and audio changes preserve the current bounce leg. */
export function nativeVideoAnchorDirection(target: NativeVideoTransportTarget, updates: Partial<NativeVideoTransportTarget>) {
  if (updates._nativePlaybackDirection === -1 || updates._nativePlaybackDirection === 1) return updates._nativePlaybackDirection;
  const reset = updates._nativePlaybackSeekSeq !== undefined && updates._nativePlaybackSeekSeq !== target._nativePlaybackSeekSeq;
  if (reset || updates.playbackMode !== undefined || (updates.playbackRate !== undefined && Math.sign(updates.playbackRate) !== Math.sign(target.playbackRate ?? 1))) {
    return (updates.playbackRate ?? target.playbackRate ?? 1) < 0 ? -1 : 1;
  }
  return nativeVideoTransportSnapshot(target).direction;
}

export function nativeVideoAnchorRate(target: NativeVideoTransportTarget): number {
  const rate = Number(target.playbackRate) || 1;
  return target.playbackMode === 'bounce' ? Math.abs(rate) * (target._nativePlaybackDirection ?? Math.sign(rate)) : rate;
}

/** A loop in Bounce is a complete out-and-back trip. */
export function nativeVideoLoopProgress(target: NativeVideoTransportTarget, nowMs = performance.now()): number {
  const duration = Number(target.durationSeconds ?? target.videoElement?.duration);
  if (!(duration > 0 && Number.isFinite(duration))) return 0;
  const lo = duration * Math.max(0, Math.min(1, target.trimStart ?? 0));
  const hi = Math.max(lo, duration * Math.max(0, Math.min(1, target.trimEnd ?? 1)));
  if (hi <= lo) return 0;
  const snapshot = nativeVideoTransportSnapshot(target, nowMs);
  const fraction = (snapshot.timeSeconds - lo) / (hi - lo);
  if (target.playbackMode !== 'bounce') return (target.playbackRate ?? 1) < 0 ? 1 - fraction : fraction;
  const phase = snapshot.direction < 0 ? 2 - fraction : fraction;
  const launchPhase = (target.playbackRate ?? 1) < 0 ? 1 : 0;
  return ((phase - launchPhase + 2) % 2) / 2;
}

/** Browser metadata is unavailable for native-only codecs such as HAP.
 * Adopt decoder metadata once, anchoring at its presented frame rather than
 * an unbounded browser clock. Never overwrite a newer UI seek. */
export function nativeVideoMetadataPatch(target: NativeVideoTransportTarget, session: {
  source_duration_seconds?: number | null;
  source_time_seconds?: number | null;
  seek_generation?: number;
  frames_presented: number;
  playback_rate: number;
}, nowMs = performance.now()): Partial<Pick<NativeVideoTransportTarget, 'durationSeconds' | '_nativePlaybackTimeSeconds' | '_nativePlaybackUpdatedAtMs' | '_nativePlaybackDirection'>> | null {
  if (Number.isFinite(target.durationSeconds) && target.durationSeconds! > 0) return null;
  const duration = session.source_duration_seconds;
  if (!(typeof duration === 'number' && Number.isFinite(duration) && duration > 0)) return null;
  const patch: Partial<Pick<NativeVideoTransportTarget, 'durationSeconds' | '_nativePlaybackTimeSeconds' | '_nativePlaybackUpdatedAtMs' | '_nativePlaybackDirection'>> = { durationSeconds: duration };
  if (session.frames_presented > 0 && session.seek_generation === (target._nativePlaybackSeekSeq ?? 0)
    && typeof session.source_time_seconds === 'number' && Number.isFinite(session.source_time_seconds)) {
    patch._nativePlaybackTimeSeconds = Math.max(0, Math.min(duration, session.source_time_seconds));
    patch._nativePlaybackUpdatedAtMs = nowMs;
    patch._nativePlaybackDirection = session.playback_rate < 0 ? -1 : 1;
  }
  return patch;
}
