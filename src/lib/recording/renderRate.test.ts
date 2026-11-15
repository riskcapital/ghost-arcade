import { describe, expect, it } from 'vitest';
import { analysisStepsUpTo, ANALYSIS_RATE, ffmpegRate, frameCount, frameTime, framesDuration, nearestRate, RENDER_RATES, rateFraction } from './renderRate';

describe('render frame rates', () => {
  it('offers 23.976 to 120, the NTSC rates as exact fractions', () => {
    expect(RENDER_RATES.map((r) => r.label)).toEqual(['23.976 fps', '24 fps', '25 fps', '29.97 fps', '30 fps', '50 fps', '59.94 fps', '60 fps', '120 fps']);
    expect(rateFraction(30000 / 1001)).toEqual({ num: 30000, den: 1001 });
    expect(rateFraction(24000 / 1001)).toEqual({ num: 24000, den: 1001 });
    expect(rateFraction(60000 / 1001)).toEqual({ num: 60000, den: 1001 });
    expect(rateFraction(120)).toEqual({ num: 120, den: 1 });
    expect(ffmpegRate(30000 / 1001)).toBe('30000/1001');
    expect(ffmpegRate(25)).toBe('25');
  });

  it('puts frame i at exactly i * den / num, with no running sum to drift', () => {
    expect(frameTime(120 * 3600, 120)).toBe(3600);
    expect(frameTime(30000, 30000 / 1001)).toBe(1001);
    // An hour of 29.97 is 107892 frames and 3599.9964 s: not 3600.
    expect(framesDuration(frameCount(3600, 30000 / 1001), 30000 / 1001)).toBeCloseTo(3600, 2);
    expect(frameTime(10, 50, 30)).toBe(30.2);
    for (const { fps } of RENDER_RATES) {
      for (const i of [1, 7, 1000, 99999]) expect(frameTime(i + 1, fps) - frameTime(i, fps)).toBeCloseTo(framesDuration(1, fps), 12);
    }
  });

  it('counts frames from a length, at least one', () => {
    expect(frameCount(120, 120)).toBe(14400);
    expect(frameCount(120, 30000 / 1001)).toBe(3596);
    expect(frameCount(0, 30)).toBe(1);
    expect(nearestRate(29.97).label).toBe('29.97 fps');
  });

  it('analyses the sound 60 times a second at any frame rate', () => {
    for (const fps of [24, 25, 30000 / 1001, 30, 50, 60, 120]) {
      let next = 0;
      const all: number[] = [];
      for (let i = 0; i < frameCount(2, fps); i++) {
        const due = analysisStepsUpTo(10, next, frameTime(i, fps, 10));
        next = due.nextStep;
        all.push(...due.times);
      }
      // Every 1/60 s up to the last frame, in order, none twice or missing.
      const last = frameTime(frameCount(2, fps) - 1, fps);
      expect(all.length).toBe(Math.floor(last * ANALYSIS_RATE + 1e-9) + 1);
      all.forEach((t, k) => expect(t).toBeCloseTo(10 + k / ANALYSIS_RATE, 9));
    }
  });
});
