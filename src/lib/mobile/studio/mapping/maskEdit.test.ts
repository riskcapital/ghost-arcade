import { describe, expect, it } from 'vitest';
import { movePoint, newSurface, type Surface } from '../model';
import { latticeFromCorners } from './meshGrid';
import { contentPoint, dragMask, insideMask, maskHandles, maskOutline, outputPoint, tappedPolygon, withMask } from './maskEdit';
import { newEllipseMask, newPolygonMask } from './masks';
import { mirrorSurface } from './edit';

const quad = (): Surface => {
  let s = newSurface(0);
  s = movePoint(s, 0, { x: 0.1, y: 0.1 });
  s = movePoint(s, 2, { x: 0.9, y: 0.2 });
  s = movePoint(s, 8, { x: 0.8, y: 0.9 });
  return movePoint(s, 6, { x: 0.15, y: 0.8 });
};
const mesh = (): Surface => {
  const g = { cols: 4, rows: 3 };
  const s: Surface = { ...newSurface(0), mode: 'mesh', grid: g, points: latticeFromCorners([{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.9, y: 0.9 }, { x: 0.1, y: 0.9 }], g) };
  s.points[5] = { x: 0.4, y: 0.45 };
  return s;
};

describe('mask editing', () => {
  it('maps the canvas into a surface and back, exactly on a quad and closely on a mesh', () => {
    for (const s of [quad(), mesh()]) {
      for (const uv of [{ x: 0.2, y: 0.3 }, { x: 0.7, y: 0.6 }, { x: 0.5, y: 0.5 }]) {
        const back = contentPoint(s, outputPoint(s, uv))!;
        expect(back.x).toBeCloseTo(uv.x, s.mode === 'corners' ? 9 : 3);
        expect(back.y).toBeCloseTo(uv.y, s.mode === 'corners' ? 9 : 3);
      }
    }
  });
  it('extends past the surface edge for points tapped just outside it', () => {
    const uv = contentPoint(mesh(), { x: 0.05, y: 0.5 })!;
    expect(uv.x).toBeLessThan(0);
  });
  it('builds a polygon from taps and draws it where they were', () => {
    const s = quad();
    const taps = [{ x: 0.3, y: 0.3 }, { x: 0.6, y: 0.3 }, { x: 0.5, y: 0.6 }];
    const m = newPolygonMask(tappedPolygon(s, taps));
    const line = maskOutline(s, m);
    taps.forEach((t, i) => {
      expect(line[i].x).toBeCloseTo(t.x, 9);
      expect(line[i].y).toBeCloseTo(t.y, 9);
    });
    expect(insideMask(s, m, { x: 0.47, y: 0.4 })).toBe(true);
    expect(insideMask(s, m, { x: 0.8, y: 0.8 })).toBe(false);
  });
  it('drags points, bends edges, moves and sizes circles in content space', () => {
    const m = newPolygonMask([{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.2 }, { x: 0.5, y: 0.8 }]);
    expect(dragMask(m, { kind: 'mpoint', index: 1 }, { x: 0.9, y: 0.1 }, { x: 0.8, y: 0.2 }).points[1]).toEqual({ x: 0.9, y: 0.1 });
    const bent = dragMask(m, { kind: 'mmid', index: 0 }, { x: 0.5, y: 0.05 }, { x: 0.5, y: 0.2 });
    expect(bent.points[0].out).toBeTruthy();
    const moved = dragMask(m, { kind: 'mbody' }, { x: 0.6, y: 0.5 }, { x: 0.5, y: 0.5 });
    expect(moved.points[0].x).toBeCloseTo(0.3);
    const c = newEllipseMask(1);
    const grown = dragMask(c, { kind: 'erx' }, { x: 0.9, y: 0.5 }, { x: 0, y: 0 });
    expect(grown.ellipse!.rx).toBeCloseTo(0.4);
    expect(maskHandles(quad(), c, 0)).toHaveLength(3);
  });
  it('adds, replaces and removes masks without leaving an empty list behind', () => {
    const s = quad();
    const m = newPolygonMask([{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.2 }, { x: 0.5, y: 0.8 }]);
    let surfaces: Surface[] = [{ ...s, masks: [m] }];
    surfaces = withMask(surfaces, 0, 0, { ...m, invert: true });
    expect(surfaces[0].masks![0].invert).toBe(true);
    surfaces = withMask(surfaces, 0, 0, null);
    expect('masks' in surfaces[0]).toBe(false);
  });
  it('mirrors masks with their surface', () => {
    const m = newPolygonMask([{ x: 0.1, y: 0.2 }, { x: 0.3, y: 0.2 }, { x: 0.2, y: 0.5 }]);
    const mirrored = mirrorSurface({ ...quad(), masks: [m, newEllipseMask(1)] }, true);
    expect(mirrored.masks![0].points[0].x).toBeCloseTo(0.9);
    expect(mirrored.masks![1].ellipse!.cx).toBeCloseTo(0.5);
  });
});
