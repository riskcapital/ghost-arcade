/**
 * A show clip's shader runs on its own time: an anchor (`_nativeShaderTime`,
 * TIME was `seconds` when it was made) goes to the core with
 * `set_isf_time_anchor`, and the core runs it on from there by its clock.
 *
 * The same anchor is sent again whenever the layer's uniforms go out again:
 * a shader value edited mid-clip, and every layer after a render-core
 * restart (the sync forgets what the old core had). Sent as it was made, a
 * live core took it as "TIME is `seconds` now", so the clip's TIME jumped
 * back to where it was when the anchor was made, and stayed offset until the
 * clip was entered again. This keeps, per anchor, when it was first sent,
 * and a resend carries the time it has run to since.
 *
 * - live clock: the core anchors at its own "now", so a resend is advanced
 *   by the wall time since the first send (the core's clock may have
 *   started again from zero after a restart, so the render clock cannot be
 *   used for this);
 * - manual clock (an offline render): the core takes `clock_time_seconds`,
 *   so a resend carries the first send's clock and the original time.
 */
export interface ShaderTimeAnchor {
  seconds: number;
  rate: number;
  paused: boolean;
  seq: number;
}

interface FirstSend {
  wallMs: number;
  clock: number;
}

const LIMIT = 512;

export class IsfAnchorResend {
  private sent = new Map<number, FirstSend>();

  constructor(private now: () => number = () => performance.now()) {}

  /** What to send for `anchor` at render clock `clock`. */
  resolve(anchor: ShaderTimeAnchor, clock: number, manual: boolean): { time_seconds: number; clock_time_seconds: number } {
    const seconds = Math.max(0, anchor.seconds);
    const first = this.sent.get(anchor.seq);
    if (!first) {
      if (this.sent.size >= LIMIT) {
        const oldest = this.sent.keys().next().value;
        if (oldest !== undefined) this.sent.delete(oldest);
      }
      this.sent.set(anchor.seq, { wallMs: this.now(), clock });
      return { time_seconds: seconds, clock_time_seconds: clock };
    }
    if (anchor.paused) return { time_seconds: seconds, clock_time_seconds: clock };
    if (manual) return { time_seconds: seconds, clock_time_seconds: first.clock };
    const elapsed = Math.max(0, (this.now() - first.wallMs) / 1000);
    return { time_seconds: Math.max(0, seconds + elapsed * anchor.rate), clock_time_seconds: clock };
  }

  clear(): void {
    this.sent.clear();
  }
}
