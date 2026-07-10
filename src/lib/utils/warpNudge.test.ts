import { describe, expect, it } from 'vitest';
import { normalizedWarpNudge, warpNudgeStepPixels } from './warpNudge';

describe('warp nudge granularity', () => {
  it('maps every settings option to a project-pixel step', () => {
    expect(warpNudgeStepPixels('sub')).toBe(0.5);
    expect(warpNudgeStepPixels('1px')).toBe(1);
    expect(warpNudgeStepPixels('5px')).toBe(5);
    expect(warpNudgeStepPixels('10px')).toBe(10);
    expect(warpNudgeStepPixels('free')).toBe(1);
  });

  it('normalizes horizontal and vertical nudges against project dimensions', () => {
    expect(normalizedWarpNudge(1920, 1080, '5px')).toEqual({
      x: 5 / 1920,
      y: 5 / 1080,
    });
  });

  it('uses the same ten-times multiplier for shift nudging', () => {
    expect(normalizedWarpNudge(1000, 500, 'sub', 10)).toEqual({
      x: 0.005,
      y: 0.01,
    });
  });
});
