import { describe, expect, it } from 'vitest';
import {
  azElOf,
  DEFAULT_DOME_PROJECTOR,
  directionOf,
  domeProjectorRing,
  domeRigPayload,
  projectorFramePoint,
  projectorFrustum,
  projectorPixelDirection,
  sphereExit,
} from './domeMath';

const close = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps);

/** How many projectors of a rig see a dome point, with `inset` of their frame kept clear. */
function seenBy(frusta: ReturnType<typeof projectorFrustum>[], azimuth: number, elevation: number, inset = 0): number {
  const dir = directionOf(azimuth, elevation);
  return frusta.filter((f) => {
    const p = projectorFramePoint(f, dir);
    return !!p && p.x >= inset && p.x <= 1 - inset && p.y >= inset && p.y <= 1 - inset;
  }).length;
}

describe('projectors around the dome', () => {
  it('leaves the sphere where a ray from inside it meets it', () => {
    const hit = sphereExit([0, 0, 0], [0, 0, 1])!;
    close(hit[2], 1);
    const fromSide = sphereExit([0.5, 0, 0], [-1, 0, 0])!;
    close(fromSide[0], -1);
  });

  it('finds a projector pixel again from the dome point it lands on', () => {
    const f = projectorFrustum({ ...DEFAULT_DOME_PROJECTOR, roll: 10, lensShift: 0.3 }, 16 / 9);
    for (const uv of [{ x: 0.5, y: 0.5 }, { x: 0.1, y: 0.8 }, { x: 0.9, y: 0.2 }]) {
      const dir = projectorPixelDirection(f, uv)!;
      const back = projectorFramePoint(f, dir)!;
      close(back.x, uv.x, 1e-9);
      close(back.y, uv.y, 1e-9);
    }
  });

  it('aims the middle of the frame where it is pointed', () => {
    const p = { ...DEFAULT_DOME_PROJECTOR, mountDistance: 0 };
    const middle = azElOf(projectorPixelDirection(projectorFrustum(p, 16 / 9), { x: 0.5, y: 0.5 })!);
    close(middle.azimuth, p.aimAzimuth, 1e-6);
    close(middle.elevation, p.aimElevation, 1e-6);
  });

  it.each([
    [4, true],
    [5, true],
    [6, false],
  ])('a ring of %i (cap %s) covers the whole dome, overlapping its neighbours', (count, zenith) => {
    const rig = domeProjectorRing(count, zenith, 16 / 9);
    expect(rig).toHaveLength(count + (zenith ? 1 : 0));
    const frusta = rig.map((p) => projectorFrustum(p, 16 / 9));
    for (let el = 0; el <= 89; el += 7) {
      for (let az = -180; az < 180; az += 5) {
        expect(seenBy(frusta, az, el), `${az} around, ${el} up`).toBeGreaterThanOrEqual(1);
      }
    }
    // Where neighbours meet, both see it.
    expect(seenBy(frusta, 360 / count / 2, 20)).toBeGreaterThanOrEqual(2);
  });

  it('hands the core each projector as sixteen numbers', () => {
    const f = projectorFrustum(DEFAULT_DOME_PROJECTOR, 16 / 9);
    const rig = domeRigPayload([{ id: 'a', frustum: f }], 0.15, 2.2);
    expect(rig.projectors[0].frustum).toHaveLength(16);
    expect(rig.projectors[0].frustum[3]).toBeCloseTo(f.tanX);
  });
});
