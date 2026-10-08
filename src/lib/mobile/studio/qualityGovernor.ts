// How much detail procedural (shader) layers render with, and how that adapts to the device.
//
// The output canvas always renders at the chosen quality. Shader layers share a pixel budget: one
// layer renders at the full output size, more layers each render smaller. When the frame rate
// stays low the governor lowers shader detail a step at a time, tells its owner, and raises it
// again once the frame rate has been healthy for a while. Each failed raise doubles the wait
// before the next, so detail never see-saws during a performance.

export const MIN_DETAIL = 0.5;
const STEP = 0.15;
const SLOW_FPS = 27;
const SLOW_SECONDS = 3;
const RECOVER_SECONDS = 8;
const MAX_RECOVER_SECONDS = 120;
/** A raise that is undone within this many seconds counts as a failed raise. */
const RELAPSE_SECONDS = 20;

/** Height in pixels a shader layer renders at before it is scaled to the output. */
export function shaderRenderHeight(quality: number, activeShaders: number, detail = 1): number {
  // 540p and 720p keep their 720p-equivalent budget. 1080p really renders one layer at 1080p.
  const budget = Math.max(720, quality) / Math.sqrt(Math.max(1, activeShaders));
  return Math.max(180, Math.min(quality, budget) * detail);
}

export class QualityGovernor {
  /** 1 is full detail. Never below MIN_DETAIL. */
  detail = 1;
  private slow = 0;
  private healthy = 0;
  private peak = 0;
  private recoverAfter = RECOVER_SECONDS;
  private sinceRaise = Infinity;

  /** Feed one frame-rate reading per second of rendering. */
  sample(fps: number): 'lowered' | 'raised' | null {
    if (!Number.isFinite(fps) || fps <= 0) return null;
    this.peak = Math.max(this.peak, Math.min(60, fps));
    this.sinceRaise++;
    if (fps < SLOW_FPS) {
      this.healthy = 0;
      if (++this.slow < SLOW_SECONDS || this.detail <= MIN_DETAIL) return null;
      this.slow = 0;
      this.detail = Math.max(MIN_DETAIL, Math.round((this.detail - STEP) * 100) / 100);
      if (this.sinceRaise <= RELAPSE_SECONDS) this.recoverAfter = Math.min(MAX_RECOVER_SECONDS, this.recoverAfter * 2);
      return 'lowered';
    }
    this.slow = 0;
    // Healthy means close to the best this device has shown, not merely "not slow".
    if (this.detail >= 1 || fps < Math.max(40, this.peak * 0.9)) { this.healthy = 0; return null; }
    if (++this.healthy < this.recoverAfter) return null;
    this.healthy = 0;
    this.sinceRaise = 0;
    this.detail = Math.min(1, Math.round((this.detail + STEP) * 100) / 100);
    return 'raised';
  }
}
