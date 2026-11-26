import { describe, expect, it } from 'vitest';
import { fineTuneNudgedPoint, normalizedWarpNudge, warpNudgeStepPixels } from './warpNudge';

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

describe('touch fine-tune pad', () => {
  it('Up moves the corner up on screen (y up in corner space)', () => {
    const up = fineTuneNudgedPoint({ x: 0.5, y: 0.5 }, 'up', 1000, 500, '1px');
    expect(up.y).toBeCloseTo(0.502);
    expect(up.x).toBe(0.5);
    const down = fineTuneNudgedPoint({ x: 0.5, y: 0.5 }, 'down', 1000, 500, '1px');
    expect(down.y).toBeCloseTo(0.498);
  });

  it('Left and Right move along x by the nudge step', () => {
    expect(fineTuneNudgedPoint({ x: 0.5, y: 0.5 }, 'right', 1000, 500, '5px').x).toBeCloseTo(0.505);
    expect(fineTuneNudgedPoint({ x: 0.5, y: 0.5 }, 'left', 1000, 500, '5px').x).toBeCloseTo(0.495);
  });
});
