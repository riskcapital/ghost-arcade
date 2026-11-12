import { describe, expect, it } from 'vitest';
import { clampDomeView, DOME_VIEW_FOV_RANGE, DOME_VIEW_HOME } from './domeView';

describe('the Inside view of the dome', () => {
  it('keeps turning past the back instead of stopping', () => {
    expect(clampDomeView({ inside: true, ...DOME_VIEW_HOME, azimuth: 190 }).azimuth).toBe(-170);
    expect(clampDomeView({ inside: true, ...DOME_VIEW_HOME, azimuth: -540 }).azimuth).toBe(-180);
  });

  it('stops short of straight up, where looking around would spin', () => {
    expect(clampDomeView({ inside: true, ...DOME_VIEW_HOME, elevation: 120 }).elevation).toBe(89);
    expect(clampDomeView({ inside: true, ...DOME_VIEW_HOME, elevation: -90 }).elevation).toBe(-60);
  });

  it('zooms within its range', () => {
    expect(clampDomeView({ inside: true, ...DOME_VIEW_HOME, fov: 5 }).fov).toBe(DOME_VIEW_FOV_RANGE.min);
    expect(clampDomeView({ inside: true, ...DOME_VIEW_HOME, fov: 400 }).fov).toBe(DOME_VIEW_FOV_RANGE.max);
  });
});
