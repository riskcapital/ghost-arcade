import { describe, expect, it } from 'vitest';
import { STATUS_RATE_MIN_INTERVAL_MS, statusFrameRate } from './statusFrameRate';

describe('native status frame rate', () => {
  it('measures frames over the elapsed seconds', () => {
    const r = statusFrameRate({ count: 100, at: 1000 }, 280, 4000);
    expect(r.fps).toBeCloseTo(60, 9);
    expect(r).toMatchObject({ count: 280, at: 4000 });
  });

  it('does not divide a burst of frames by a sliver of time', () => {
    // The log right after start: 12 frames 1 ms after the baseline used to
    // print nativeFps=12000.
    const early = statusFrameRate({ count: 0, at: 1000 }, 12, 1001);
    expect(early.fps).toBe(0);
    // The baseline is kept, so the next reading measures the whole interval.
    expect(early).toMatchObject({ count: 0, at: 1000 });
    const next = statusFrameRate(early, 12 + 180, 4001, early.fps);
    expect(next.fps).toBeCloseTo(192 / 3.001, 6);
    expect(next.fps).toBeLessThan(120);
    // An overlapping call just after a real reading repeats that rate.
    expect(statusFrameRate(next, next.count + 3, next.at + 2, next.fps).fps).toBe(next.fps);
  });

  it('never reports a rate across a restart or without a baseline', () => {
    expect(statusFrameRate({ count: 5000, at: 1000 }, 40, 4000).fps).toBe(0);
    expect(statusFrameRate({ count: 5000, at: 1000 }, 40, 4000)).toMatchObject({ count: 40, at: 4000 });
    expect(statusFrameRate(null, 900, 4000)).toMatchObject({ fps: 0, count: 900, at: 4000 });
    expect(statusFrameRate({ count: 0, at: 0 }, 900, 4000).fps).toBe(0);
  });

  it('stays bounded for any reading past the minimum interval', () => {
    // At most count / (min interval) even for a counter that jumped.
    for (const frames of [0, 1, 30, 60, 144]) {
      const r = statusFrameRate({ count: 10, at: 1000 }, 10 + frames, 1000 + STATUS_RATE_MIN_INTERVAL_MS);
      expect(r.fps).toBe(frames * (1000 / STATUS_RATE_MIN_INTERVAL_MS));
    }
    expect(Number.isFinite(statusFrameRate({ count: 10, at: 1000 }, Number.NaN, 5000).fps)).toBe(true);
  });
});
