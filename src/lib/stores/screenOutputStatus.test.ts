import { describe, expect, it } from 'vitest';
import { screenRegion } from './screenOutputStatus';

describe('the part of the output a Screen shows', () => {
  it('is its crop, kept inside the output', () => {
    expect(screenRegion({ cropX: 0.5, cropY: 0, cropW: 0.5, cropH: 1 })).toEqual({ x: 0.5, y: 0, width: 0.5, height: 1 });
    expect(screenRegion({ cropX: 0.75, cropY: 0.1, cropW: 0.5, cropH: 2 })).toEqual({ x: 0.75, y: 0.1, width: 0.25, height: 0.9 });
  });
  it('is the whole output without a usable crop', () => {
    const whole = { x: 0, y: 0, width: 1, height: 1 };
    expect(screenRegion(undefined)).toEqual(whole);
    expect(screenRegion({})).toEqual(whole);
    expect(screenRegion({ cropX: 0, cropY: 0, cropW: 0, cropH: 1 })).toEqual(whole);
    expect(screenRegion({ cropX: Number.NaN, cropY: 'a', cropW: 1, cropH: 1 })).toEqual(whole);
  });
});
