/**
 * Notices when the editor's GPU bridge is not drawing.
 *
 * With the bridge on, the editor's WebGL canvas is hidden and a WebGPU
 * canvas on top shows its frames. On some Windows machines that canvas never
 * shows anything (WebGPU starts but importing the WebGL frame fails, or the
 * device never comes up), and since its per-frame failures were swallowed
 * the workspace simply stayed empty. This decides, from counters the bridge
 * keeps, when to give up on it so the editor can show the WebGL canvas
 * instead.
 */

export type BridgePhase = 'init' | 'presenting' | 'failed';

export interface BridgeSample {
  /** ms (performance.now()). */
  now: number;
  /** 'init' while WebGPU starts, 'presenting' once it should draw, 'failed' if it could not start. */
  phase: BridgePhase;
  /** Whether the editor window is visible (frames are not expected while hidden). */
  visible: boolean;
  /** Frame-loop ticks that tried to draw (not counted while the output is frozen). */
  attempts: number;
  /** Frames that reached the screen. */
  presented: number;
}

export type BridgeFailureReason = 'init-failed' | 'init-timeout' | 'no-frames';

export interface BridgeWatchdogOptions {
  /** Time without a presented frame, while drawing is being attempted, before giving up. */
  noFrameMs?: number;
  /** Draw attempts that must have failed in that time (so a throttled or paused loop is not judged). */
  minAttempts?: number;
  /** Time WebGPU may take to start while the window is visible. */
  initTimeoutMs?: number;
}

export function createBridgeWatchdog({ noFrameMs = 3000, minAttempts = 90, initTimeoutMs = 8000 }: BridgeWatchdogOptions = {}) {
  let tripped = false;
  let lastPresented = -1;
  let progressAt = -1;
  let attemptsAtProgress = 0;
  let initSince = -1;

  return {
    /** Feed the latest counters; returns a reason once, the first time the bridge should be abandoned. */
    check(sample: BridgeSample): { reason: BridgeFailureReason } | null {
      if (tripped) return null;
      if (sample.phase === 'failed') {
        tripped = true;
        return { reason: 'init-failed' };
      }
      if (sample.phase === 'init') {
        if (!sample.visible) {
          initSince = -1;
          return null;
        }
        if (initSince < 0) initSince = sample.now;
        if (sample.now - initSince >= initTimeoutMs) {
          tripped = true;
          return { reason: 'init-timeout' };
        }
        return null;
      }
      initSince = -1;
      if (sample.presented !== lastPresented || progressAt < 0) {
        lastPresented = sample.presented;
        progressAt = sample.now;
        attemptsAtProgress = sample.attempts;
        return null;
      }
      if (!sample.visible) {
        // Nothing is drawn while hidden; start the clock again when shown.
        progressAt = sample.now;
        attemptsAtProgress = sample.attempts;
        return null;
      }
      if (sample.now - progressAt >= noFrameMs && sample.attempts - attemptsAtProgress >= minAttempts) {
        tripped = true;
        return { reason: 'no-frames' };
      }
      return null;
    },
    get tripped() {
      return tripped;
    },
  };
}

/** What to tell the user, once, when the editor falls back to WebGL. */
export const BRIDGE_FALLBACK_MESSAGE =
  'The workspace switched to the standard WebGL view because the GPU bridge was not drawing on this computer. '
  + 'To stop it trying at the next launch, turn off Settings › Performance › GPU Acceleration › Editor GPU bridge.';
