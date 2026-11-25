import { describe, expect, it } from 'vitest';
import { placementCaveats, rasterToComposition } from './autoMapPlacement';

/** The native core checks these against real pixels (autoMapPlacement.native.test.ts); here, the plain cases and the edges. */
describe('placing a phone-measured point in the composition', () => {
  it('with only a crop, lands where the corner pin always put it', () => {
    const crop = { x: 0.2, y: 0.1, w: 0.5, h: 0.6 };
    for (const p of [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0.3, y: 0.8 }]) {
      const q = rasterToComposition(p, { crop })!;
      // The earlier placement: x through the crop, y through the crop then flipped up.
      expect(q.x).toBeCloseTo(crop.x + p.x * crop.w, 9);
      expect(q.y).toBeCloseTo(1 - (crop.y + p.y * crop.h), 9);
    }
  });

  it('follows a turned Screen: the projector\'s top left shows another corner of the crop', () => {
    const crop = { x: 0, y: 0, w: 1, h: 1 };
    expect(rasterToComposition({ x: 0, y: 0 }, { crop, rotation: 180 })).toEqual({ x: 1, y: 0 });
    const quarter = rasterToComposition({ x: 0, y: 0 }, { crop, rotation: 90 })!;
    const back = rasterToComposition({ x: 0, y: 0 }, { crop, rotation: -270 })!;
    expect(back).toEqual(quarter);
    expect(rasterToComposition({ x: 0.5, y: 0.5 }, { crop, rotation: 270 })).toEqual({ x: 0.5, y: 0.5 });
  });

  it('inverts the Master Warp, and says when a point is outside what it shows', () => {
    const crop = { x: 0, y: 0, w: 1, h: 1 };
    const masterWarp = { enabled: true, mode: 'corners' as const, corners: { topLeft: { x: 0.25, y: 0.25 }, topRight: { x: 0.75, y: 0.25 }, bottomRight: { x: 0.75, y: 0.75 }, bottomLeft: { x: 0.25, y: 0.75 } } };
    // The composition squeezed into the middle half: the projector's centre still shows its centre...
    const centre = rasterToComposition({ x: 0.5, y: 0.5 }, { crop, masterWarp })!;
    expect(centre.x).toBeCloseTo(0.5, 6); expect(centre.y).toBeCloseTo(0.5, 6);
    // ...a quarter in shows the composition's corner, and the projector's corner shows nothing of it.
    const corner = rasterToComposition({ x: 0.25, y: 0.25 }, { crop, masterWarp })!;
    expect(corner.x).toBeCloseTo(0, 6); expect(corner.y).toBeCloseTo(1, 6);
    expect(rasterToComposition({ x: 0.05, y: 0.05 }, { crop, masterWarp })).toBeNull();
  });

  it('names what it only approximates', () => {
    const crop = { x: 0, y: 0, w: 1, h: 1 };
    expect(placementCaveats({ crop })).toEqual([]);
    expect(placementCaveats({ crop, warpMode: 'mesh', meshGrid: { rows: 2, cols: 2, points: [], bezier: true } })).toHaveLength(1);
    expect(placementCaveats({ crop, masterWarp: { enabled: true, mode: 'mesh', meshGrid: { rows: 2, cols: 2, points: [] } } })).toHaveLength(1);
  });
});
