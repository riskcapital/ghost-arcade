/**
 * A show clip's shader anchor sent again (after a render-core restart, or a
 * value edited mid-clip) carries the time the clip has run to, not the time
 * it had when the anchor was made.
 */
import { describe, expect, it } from 'vitest';
import { IsfAnchorResend } from './isfAnchorResend';

describe('shader time anchors sent again', () => {
  it('a live resend after a core restart is advanced by the time since the first send', () => {
    let ms = 1000;
    const anchors = new IsfAnchorResend(() => ms);
    const a = { seconds: 3, rate: 1, paused: false, seq: 7 };
    expect(anchors.resolve(a, 50, false)).toEqual({ time_seconds: 3, clock_time_seconds: 50 });
    // The core is killed 4.5 s later and restarted: its clock starts again
    // near zero, and every layer's uniforms go out again.
    ms += 4500;
    const again = anchors.resolve(a, 0.2, false);
    expect(again.time_seconds).toBeCloseTo(7.5);
    expect(again.clock_time_seconds).toBe(0.2);
  });

  it('runs at the clip\'s rate; a paused clip stays put', () => {
    let ms = 0;
    const anchors = new IsfAnchorResend(() => ms);
    anchors.resolve({ seconds: 1, rate: 2, paused: false, seq: 1 }, 0, false);
    anchors.resolve({ seconds: 1, rate: 1, paused: true, seq: 2 }, 0, false);
    ms = 1000;
    expect(anchors.resolve({ seconds: 1, rate: 2, paused: false, seq: 1 }, 1, false).time_seconds).toBeCloseTo(3);
    expect(anchors.resolve({ seconds: 1, rate: 1, paused: true, seq: 2 }, 1, false).time_seconds).toBe(1);
  });

  it('a new anchor (a seek, a new clip) goes out as made', () => {
    let ms = 0;
    const anchors = new IsfAnchorResend(() => ms);
    anchors.resolve({ seconds: 1, rate: 1, paused: false, seq: 1 }, 0, false);
    ms = 5000;
    expect(anchors.resolve({ seconds: 0, rate: 1, paused: false, seq: 2 }, 5, false).time_seconds).toBe(0);
  });

  it('under an offline render a resend keeps the first send\'s clock (the core uses it)', () => {
    let ms = 0;
    const anchors = new IsfAnchorResend(() => ms);
    anchors.resolve({ seconds: 2, rate: 1, paused: false, seq: 3 }, 10, true);
    ms = 90_000;
    expect(anchors.resolve({ seconds: 2, rate: 1, paused: false, seq: 3 }, 12, true)).toEqual({ time_seconds: 2, clock_time_seconds: 10 });
  });
});
