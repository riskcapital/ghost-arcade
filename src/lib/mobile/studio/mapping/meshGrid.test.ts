import { describe, expect, it } from 'vitest';
import { defaultShow, gridPoints, movePoint, newSurface, normalizeShow, type Point, type Surface } from '../model';
import { surfaceVertices } from '../compositor';
import { bendEdge, clampGrid, cornerIndices, edgePoint, evaluate, gridOf, hasCurves, latticeFromCorners, outline, resample, resolveTangent, setHandle, tessellate } from './meshGrid';

/** The renderer's geometry exactly as app 1.1 built it, kept here as the reference old maps must match. */
function legacyQuadPoint(c: Point[], u: number, v: number): Point {
  const [a, b, d, e] = c;
  const dx1 = b.x - d.x,
    dx2 = e.x - d.x,
    dy1 = b.y - d.y,
    dy2 = e.y - d.y;
  const dx3 = a.x - b.x + d.x - e.x,
    dy3 = a.y - b.y + d.y - e.y,
    det = dx1 * dy2 - dx2 * dy1;
  const g = Math.abs(det) > 1e-8 ? (dx3 * dy2 - dx2 * dy3) / det : 0,
    h = Math.abs(det) > 1e-8 ? (dx1 * dy3 - dx3 * dy1) / det : 0;
  const den = g * u + h * v + 1;
  return { x: ((b.x - a.x + g * b.x) * u + (e.x - a.x + h * e.x) * v + a.x) / den, y: ((b.y - a.y + g * b.y) * u + (e.y - a.y + h * e.y) * v + a.y) / den };
}
function legacyVertices(surface?: Surface): Float32Array {
  const points = surface?.points;
  const n = surface?.mode === 'corners' ? 16 : 2;
  const vertex = (x: number, y: number) => {
    const u = x / n,
      v = y / n;
    const p = !points ? { x: u, y: v } : surface?.mode === 'corners' ? legacyQuadPoint([points[0], points[2], points[8], points[6]], u, v) : points[y * 3 + x];
    return [p.x, p.y, u, v];
  };
  const out: number[] = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) out.push(...vertex(x, y), ...vertex(x + 1, y), ...vertex(x + 1, y + 1), ...vertex(x, y), ...vertex(x + 1, y + 1), ...vertex(x, y + 1));
  return new Float32Array(out);
}

const skewed = (): Surface => {
  let s = newSurface(0);
  s = movePoint(s, 0, { x: 0.12, y: 0.07 });
  s = movePoint(s, 2, { x: 0.93, y: 0.18 });
  s = movePoint(s, 8, { x: 0.81, y: 0.95 });
  return movePoint(s, 6, { x: 0.05, y: 0.77 });
};

describe('old maps', () => {
  it('render exactly as before: corner quads, 3×3 meshes and the full frame', () => {
    const corner = skewed();
    const mesh: Surface = { ...skewed(), mode: 'mesh' };
    mesh.points[4] = { x: 0.6, y: 0.4 };
    mesh.points[1] = { x: 0.52, y: 0.02 };
    for (const s of [corner, mesh, newSurface(1), newSurface(2, true)]) expect(surfaceVertices(s)).toEqual(legacyVertices(s));
    expect(surfaceVertices()).toEqual(legacyVertices());
  });
  it('load unchanged through the set loader, with no new fields added', () => {
    const show = defaultShow();
    show.mapping = true;
    show.surfaces = [skewed(), { ...skewed(), id: 'm', mode: 'mesh' }];
    const saved = JSON.parse(JSON.stringify(show));
    const loaded = normalizeShow(saved);
    expect(loaded.surfaces).toStrictEqual(saved.surfaces.map((s: Surface) => ({ ...s, look: undefined })));
    for (const s of loaded.surfaces) {
      for (const key of ['grid', 'bezier', 'tangents', 'masks', 'group', 'shape', 'welds']) expect(key in s).toBe(false);
      expect(surfaceVertices(s)).toEqual(legacyVertices(s));
    }
  });
  it('still drop a surface whose points cannot be used back to the starter grid', () => {
    const show = defaultShow();
    show.mapping = true;
    show.surfaces = [{ ...newSurface(0), points: [{ x: 0, y: 0 }] }];
    expect(normalizeShow(JSON.parse(JSON.stringify(show))).surfaces[0].points).toEqual(gridPoints());
  });
});

describe('mesh density', () => {
  it('reads a missing or mismatched grid as the original 3×3', () => {
    expect(gridOf(newSurface(0))).toEqual({ cols: 3, rows: 3 });
    expect(gridOf({ ...newSurface(0), grid: { cols: 5, rows: 5 } })).toEqual({ cols: 3, rows: 3 });
    expect(clampGrid({ cols: 1, rows: 40 })).toEqual({ cols: 2, rows: 9 });
  });
  it('keeps the shape when the density refines it (every old point stays put)', () => {
    const s: Surface = { ...skewed(), mode: 'mesh' };
    s.points[4] = { x: 0.62, y: 0.41 };
    const r = resample(s, { cols: 5, rows: 9 });
    expect(r.points).toHaveLength(45);
    const g = { cols: 5, rows: 9 };
    for (let i = 0; i < 9; i++) {
      const c = (i % 3) * 2,
        row = Math.floor(i / 3) * 4;
      expect(r.points[row * g.cols + c].x).toBeCloseTo(s.points[i].x, 12);
      expect(r.points[row * g.cols + c].y).toBeCloseTo(s.points[i].y, 12);
    }
  });
  it('lands every new point on the old warp, at any density, and back', () => {
    const s: Surface = { ...skewed(), mode: 'mesh' };
    s.points[4] = { x: 0.62, y: 0.41 };
    const up = { ...s, ...resample(s, { cols: 7, rows: 4 }) } as Surface;
    for (const [u, v] of [[0, 0], [1 / 6, 1 / 3], [0.5, 2 / 3], [1, 1]]) {
      const a = evaluate(s, u, v),
        b = evaluate(up, u, v);
      expect(b.x).toBeCloseTo(a.x, 9);
      expect(b.y).toBeCloseTo(a.y, 9);
    }
    const down = resample(up, { cols: 2, rows: 2 });
    const [tl, tr, br, bl] = cornerIndices({ cols: 7, rows: 4 }).map((i) => up.points[i]);
    [tl, tr, bl, br].forEach((p, i) => {
      expect(down.points[i].x).toBeCloseTo(p.x, 12);
      expect(down.points[i].y).toBeCloseTo(p.y, 12);
    });
  });
  it('keeps a corner quad on its perspective when it becomes a mesh', () => {
    const s = skewed();
    const r = resample(s, { cols: 9, rows: 9 });
    const mid = r.points[4 * 9 + 4];
    const projective = evaluate(s, 0.5, 0.5);
    expect(mid.x).toBeCloseTo(projective.x, 12);
    expect(mid.y).toBeCloseTo(projective.y, 12);
  });
  it('drags a corner of any lattice and spreads the others between the corners', () => {
    const s: Surface = { ...newSurface(0), grid: { cols: 4, rows: 2 }, points: latticeFromCorners([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }], { cols: 4, rows: 2 }) };
    const moved = movePoint(s, 3, { x: 0.7, y: 0.1 });
    expect(moved.points[3]).toEqual({ x: 0.7, y: 0.1 });
    expect(moved.points[1].x).toBeCloseTo(0.7 / 3, 12);
    expect(moved.points).toHaveLength(8);
  });
  it('tessellates a dense mesh smoothly and with a bounded triangle count', () => {
    for (const size of [2, 3, 5, 9]) {
      const g = { cols: size, rows: size };
      const s: Surface = { ...newSurface(0), mode: 'mesh', grid: g, points: latticeFromCorners([{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.2 }, { x: 0.8, y: 0.9 }, { x: 0.2, y: 0.8 }], g) };
      const v = tessellate(s);
      expect(v.length / 4 / 3).toBeLessThanOrEqual(2 * 32 * 32);
      expect(v.length / 4 / 3).toBeGreaterThanOrEqual(2 * 12 * 12);
    }
  });
});

describe('curved edges', () => {
  const mesh = (): Surface => ({ ...newSurface(0), mode: 'mesh', grid: { cols: 2, rows: 2 }, bezier: true, points: latticeFromCorners([{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.2 }, { x: 0.8, y: 0.8 }, { x: 0.2, y: 0.8 }], { cols: 2, rows: 2 }) });
  it('are straight until a handle is stored, and off when curves are switched off', () => {
    const s = mesh();
    expect(hasCurves(s)).toBe(false);
    const bent = { ...s, tangents: bendEdge(s, 0, 1, { x: 0.5, y: 0.05 }) };
    expect(hasCurves(bent)).toBe(true);
    expect(hasCurves({ ...bent, bezier: false })).toBe(false);
  });
  it('bend an edge through the dragged point and leave the far edges straight', () => {
    const s = mesh();
    const bent = { ...s, tangents: bendEdge(s, 0, 1, { x: 0.5, y: 0.05 }) };
    const top = edgePoint(bent, 0, 1, 0.5);
    expect(top.x).toBeCloseTo(0.5, 9);
    expect(top.y).toBeCloseTo(0.05, 9);
    const left = edgePoint(bent, 0, 2, 0.5);
    expect(left.x).toBeCloseTo(0.2, 9);
    expect(left.y).toBeCloseTo(0.5, 9);
    // The picture follows: the top middle of the content now sits on the curve.
    expect(evaluate(bent, 0.5, 0).y).toBeCloseTo(0.05, 9);
    expect(outline(bent, 8).some((p) => p.y < 0.1)).toBe(true);
  });
  it('mirror a smooth handle and keep a broken one', () => {
    const s = { ...mesh(), grid: { cols: 3, rows: 3 }, points: latticeFromCorners([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }], { cols: 3, rows: 3 }) };
    const smooth = { ...s, tangents: setHandle(s, 4, 'right', { x: 0.1, y: 0.05 }) };
    const t = resolveTangent(smooth, 4);
    expect(t.left.x).toBeCloseTo(-t.right.x * (Math.hypot(t.left.x, t.left.y) / Math.hypot(t.right.x, t.right.y)), 9);
    const broken = { ...s, tangents: setHandle(s, 4, 'right', { x: 0.1, y: 0.05 }, true) };
    expect(resolveTangent(broken, 4).left).toEqual({ x: -0.1, y: -0.05 });
  });
  it('survive a density change close to their old shape', () => {
    const s = mesh();
    const bent = { ...s, tangents: bendEdge(s, 0, 1, { x: 0.5, y: 0.05 }) } as Surface;
    const up = { ...bent, ...resample(bent, { cols: 5, rows: 5 }) } as Surface;
    for (const u of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      const a = evaluate(bent, u, 0),
        b = evaluate(up, u, 0);
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(2e-3);
    }
  });
});
