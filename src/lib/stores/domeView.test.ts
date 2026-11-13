import { describe, expect, it } from 'vitest';
import { clampDomeView, DOME_VIEW_FOV_RANGE, DOME_VIEW_HOME, zoomDomeView } from './domeView';

describe('the Inside view of the dome', () => {
  it('keeps turning past the back instead of stopping', () => {
    expect(clampDomeView({ inside: true, room: true, ...DOME_VIEW_HOME, azimuth: 190 }).azimuth).toBe(-170);
    expect(clampDomeView({ inside: true, room: true, ...DOME_VIEW_HOME, azimuth: -540 }).azimuth).toBe(-180);
  });

  it('stops short of straight up, where looking around would spin', () => {
    expect(clampDomeView({ inside: true, room: true, ...DOME_VIEW_HOME, elevation: 120 }).elevation).toBe(89);
    expect(clampDomeView({ inside: true, room: true, ...DOME_VIEW_HOME, elevation: -90 }).elevation).toBe(-60);
  });

  it('zooms within its range', () => {
    expect(clampDomeView({ inside: true, room: true, ...DOME_VIEW_HOME, fov: 5 }).fov).toBe(DOME_VIEW_FOV_RANGE.min);
    expect(clampDomeView({ inside: true, room: true, ...DOME_VIEW_HOME, fov: 400 }).fov).toBe(DOME_VIEW_FOV_RANGE.max);
  });
});

describe('zooming the Inside view', () => {
  const at = (fov: number, back = 0) => ({ inside: true, room: true, ...DOME_VIEW_HOME, fov, back });

  it('widens first, then moves the eye back once the view is as wide as it goes', () => {
    expect(zoomDomeView(at(90), 0.1).fov).toBeCloseTo(90 * Math.exp(0.1));
    const past = zoomDomeView(at(DOME_VIEW_FOV_RANGE.max - 1), 0.2);
    expect(past.fov).toBe(DOME_VIEW_FOV_RANGE.max);
    expect(past.back).toBeGreaterThan(0);
  });

  it('comes forward before it narrows, and stops at the back wall', () => {
    const back = zoomDomeView(at(DOME_VIEW_FOV_RANGE.max, 0.1), -0.2);
    expect(back.back).toBe(0);
    expect(back.fov).toBeLessThan(DOME_VIEW_FOV_RANGE.max);
    expect(zoomDomeView(at(DOME_VIEW_FOV_RANGE.max, 0.99), 1).back).toBe(1);
  });
});
