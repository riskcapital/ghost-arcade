/**
 * Whether a video's frame callbacks can be trusted to pace texture uploads.
 *
 * Studio 2.0.5 uploads a video texture only when `requestVideoFrameCallback`
 * reports a new frame, instead of on every editor frame. Studio's videos are
 * never in the page, though, and for a video that is not in the page
 * Chromium's frame callbacks are driven by its own background timer and by
 * texture uploads rather than by the display, so they can come far less
 * often than the video's frame rate. Gating uploads on them then makes the
 * video itself play back slowly.
 *
 * This compares, once a second while a video plays, how many frame
 * callbacks arrived with how many frames the video decoded (or, where that
 * count is not available, with a minimum rate). An element whose callbacks
 * fall well behind goes back to uploading on every editor frame.
 */

export interface FrameCallbackWindow {
  /** performance.now() at the start of the window. */
  at: number;
  /** Frame-callback count then. */
  seq: number;
  /** Media time then. */
  time: number;
  /** Decoded-frame count then (getVideoPlaybackQuality().totalVideoFrames), if known. */
  decoded: number | null;
}

export interface FrameCallbackReading {
  at: number;
  seq: number;
  time: number;
  decoded: number | null;
  paused: boolean;
  seeking: boolean;
  rate: number;
}

/** How long to watch before judging. */
export const FRAME_CALLBACK_WINDOW_MS = 1000;
/** Callbacks below this share of decoded frames mean the callbacks are not keeping up. */
export const FRAME_CALLBACK_MIN_SHARE = 0.6;
/** Without a decoded-frame count: fewer callbacks a second than this. */
export const FRAME_CALLBACK_MIN_FPS = 10;

export type FrameCallbackVerdict = 'wait' | 'ok' | 'unreliable';

export function judgeFrameCallbacks(
  window: FrameCallbackWindow | null,
  now: FrameCallbackReading,
): { verdict: FrameCallbackVerdict; window: FrameCallbackWindow } {
  const fresh: FrameCallbackWindow = { at: now.at, seq: now.seq, time: now.time, decoded: now.decoded };
  // Nothing to judge while paused or seeking; start again afterwards.
  if (!window || now.paused || now.seeking) return { verdict: 'wait', window: fresh };
  const elapsedMs = now.at - window.at;
  if (elapsedMs < FRAME_CALLBACK_WINDOW_MS) return { verdict: 'wait', window };
  const wallSec = elapsedMs / 1000;
  const rate = Number.isFinite(now.rate) && now.rate > 0 ? now.rate : 1;
  // The video must actually have moved forward (not stalled, not looped back).
  const mediaAdvance = now.time - window.time;
  if (!(mediaAdvance > wallSec * rate * 0.5)) return { verdict: 'wait', window: fresh };
  const callbacks = now.seq - window.seq;
  if (now.decoded != null && window.decoded != null) {
    const decoded = now.decoded - window.decoded;
    if (decoded >= 5) {
      return { verdict: callbacks < decoded * FRAME_CALLBACK_MIN_SHARE ? 'unreliable' : 'ok', window: fresh };
    }
  }
  return { verdict: callbacks / wallSec < FRAME_CALLBACK_MIN_FPS ? 'unreliable' : 'ok', window: fresh };
}

/** Decoded-frame count of a video element, or null where the browser does not report it. */
export function decodedFrameCount(video: { getVideoPlaybackQuality?: () => { totalVideoFrames: number } }): number | null {
  try {
    const total = video.getVideoPlaybackQuality?.().totalVideoFrames;
    return Number.isFinite(total) ? (total as number) : null;
  } catch {
    return null;
  }
}
