/**
 * The hard fallback behind the phase follower (showVideoPhase.ts).
 *
 * The follower steers a playing clip's decoder with small speed changes,
 * but only a hardware-decoded one, and only the clip on the track itself:
 * a software-decoded video, or the outgoing clip of a crossfade, was never
 * corrected and could drift without limit. Twice a second the show compares
 * where each playing decoder really is (the core's last presented frame)
 * with where the show says it should be. A decoder that is more than two
 * frames off on two checks in a row is re-anchored: a seek, under a new
 * seek generation (see ShowClipSources.reanchor).
 */
import type { ShowTrackFrame } from './showTrackEval';
import { predictedMediaTime, type ShowClipAnchor } from './showClipSources';

export const SHOW_DRIFT_CHECK_MS = 500;
/** Frames a decoder may be off before it is re-anchored. */
export const SHOW_DRIFT_MAX_FRAMES = 2;
/** Checks in a row a decoder has to be off (one is noise: a status read
 *  that landed in a stall). */
export const SHOW_DRIFT_STRIKES = 2;
/** Frames a decoder presents after a seek before it is judged. */
const SETTLE_FRAMES = 3;
const FALLBACK_FRAME_SECONDS = 1 / 30;
/** A frame older than this is not projected to now (the show stalled). */
const MAX_FRAME_AGE_SECONDS = 0.25;

/** What the check reads from the core's status for one decoder. */
export interface ShowDriftSession {
  source_id: string;
  state: string;
  seek_generation?: number;
  frames_presented: number;
  source_time_seconds?: number | null;
  source_frame_duration_seconds?: number | null;
  source_fps?: number | null;
}

/** Signed distance from `actual` to `expected` on a loop of `span`
 *  seconds, the shorter way round. */
function loopError(expected: number, actual: number, span: number): number {
  const error = expected - actual;
  if (!(span > 0)) return error;
  const wrapped = ((error % span) + span) % span;
  return wrapped > span / 2 ? wrapped - span : wrapped;
}

export class ShowDriftWatch {
  private readonly strikes = new Map<string, { seq: number; count: number }>();

  reset(): void {
    this.strikes.clear();
  }

  /**
   * The anchor keys to re-anchor now. `atMs` is when the status was read
   * (performance.now()); `uncertaintySeconds` how far off that may be.
   */
  check(
    frame: ShowTrackFrame,
    anchors: ReadonlyArray<readonly [string, Readonly<ShowClipAnchor>]>,
    sessions: readonly ShowDriftSession[],
    atMs: number,
    uncertaintySeconds = 0,
  ): string[] {
    if (!frame.playing || frame.manualClock) {
      this.reset();
      return [];
    }
    const age = Number.isFinite(frame.evaluatedAtMs) ? (atMs - frame.evaluatedAtMs!) / 1000 : 0;
    if (!(age >= -MAX_FRAME_AGE_SECONDS && age <= MAX_FRAME_AGE_SECONDS)) return [];
    const showNow = frame.time + Math.max(0, age);
    const bySource = new Map(sessions.map((s) => [s.source_id, s]));
    const out: string[] = [];
    const seen = new Set<string>();
    for (const [key, anchor] of anchors) {
      seen.add(key);
      const session = bySource.get(anchor.sourceId);
      const pts = Number(session?.source_time_seconds);
      if (
        anchor.paused
        || anchor.showSeekGeneration !== frame.seekGeneration
        || !session
        || session.state !== 'playing'
        || session.seek_generation !== anchor.nativeSeekSeq
        || session.frames_presented < SETTLE_FRAMES
        || !Number.isFinite(pts)
      ) {
        this.strikes.delete(key);
        continue;
      }
      const frameSeconds = Number(session.source_frame_duration_seconds) > 0
        ? Number(session.source_frame_duration_seconds)
        : Number(session.source_fps) > 0 ? 1 / Number(session.source_fps) : FALLBACK_FRAME_SECONDS;
      const expected = predictedMediaTime(anchor, showNow);
      // The presented frame shows from its timestamp for one frame.
      const span = Number(anchor.duration) > 0 ? Number(anchor.duration) - anchor.loopStart : 0;
      const error = loopError(expected, pts + frameSeconds / 2, span);
      const limit = SHOW_DRIFT_MAX_FRAMES * frameSeconds + frameSeconds / 2 + Math.abs(uncertaintySeconds * anchor.rate);
      if (Math.abs(error) <= limit) {
        this.strikes.delete(key);
        continue;
      }
      const prev = this.strikes.get(key);
      const count = prev && prev.seq === anchor.nativeSeekSeq ? prev.count + 1 : 1;
      if (count >= SHOW_DRIFT_STRIKES) {
        this.strikes.delete(key);
        out.push(key);
      } else {
        this.strikes.set(key, { seq: anchor.nativeSeekSeq, count });
      }
    }
    for (const key of [...this.strikes.keys()]) if (!seen.has(key)) this.strikes.delete(key);
    return out;
  }
}
