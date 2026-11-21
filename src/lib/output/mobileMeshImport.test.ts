import { describe, expect, it } from 'vitest';
import { perspectiveMeshLayer, phoneMeshLayer, type PhoneMesh } from './mobileMeshImport';
import { evaluateMeshGrid } from '../utils/meshWarp';

// Where content (u, v: the layer's picture, top-left origin) lands in the projector picture
// (top-left origin): quadratic across, with a shear, the kind of shape a curved surface gives.
const F = (u: number, v: number) => ({ x: 0.15 + 0.5 * u + 0.25 * u * u, y: 0.1 + 0.6 * v + 0.2 * u * v });
const dFdu = (u: number, v: number) => ({ x: 0.5 + 0.5 * u, y: 0.2 * v });
const dFdv = (u: number) => ({ x: 0, y: 0.6 + 0.2 * u });

/** A phone mesh sampled from F over `rest`, with exact cubic handles (a third of the edge's derivative). */
function phoneMesh(rows: number, cols: number, rest: PhoneMesh['rest'], curved: boolean): PhoneMesh {
  const du = (rest.u1 - rest.u0) / (cols - 1), dv = (rest.v1 - rest.v0) / (rows - 1);
  const points = [], tangents = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const u = rest.u0 + c * du, v = rest.v0 + r * dv;
    points.push(F(u, v));
    const a = dFdu(u, v), b = dFdv(u);
    tangents.push({ right: { x: (a.x * du) / 3, y: (a.y * du) / 3 }, down: { x: (b.x * dv) / 3, y: (b.y * dv) / 3 } });
  }
  return { rows, cols, points, tangents: curved ? tangents : null, rest };
}

const outline = [{ x: 0.3, y: 0.25 }, { x: 0.55, y: 0.2 }, { x: 0.7, y: 0.5 }, { x: 0.45, y: 0.75 }, { x: 0.25, y: 0.55 }];
const crop = { x: 0, y: 0, w: 1, h: 1 };

describe('a curved surface from the phone', () => {
  it('lands the picture where the phone measured it, through the desktop’s own mesh', () => {
    const rest = { u0: 0.2, v0: 0.15, u1: 0.8, v1: 0.85 };
    const layer = phoneMeshLayer({ mesh: phoneMesh(6, 7, rest, true), contentOutline: outline }, crop)!;
    expect(layer).not.toBeNull();
    expect(layer.meshGrid.bezier).toBe(true);
    expect(layer.meshGrid.fit).toBe('layer');
    for (let k = 0; k < 60; k++) {
      const u = rest.u0 + ((k * 37) % 61) / 60 * (rest.u1 - rest.u0), v = rest.v0 + ((k * 23) % 59) / 58 * (rest.v1 - rest.v0);
      const want = F(u, v);
      // Layer UV is y up: content (u, v) is layer (u, 1 - v), and the projector picture is the layer.
      const got = evaluateMeshGrid(layer.meshGrid, u, 1 - v);
      expect(got.x).toBeCloseTo(want.x, 6);
      expect(got.y).toBeCloseTo(1 - want.y, 6);
    }
  });

  it('pins straight cells exactly at their points', () => {
    const rest = { u0: 0, v0: 0, u1: 1, v1: 1 };
    const mesh = phoneMesh(3, 4, rest, false);
    const layer = phoneMeshLayer({ mesh, contentOutline: outline }, crop)!;
    expect(layer.meshGrid.bezier).toBeUndefined();
    expect(layer.meshGrid.points[0][0]).toEqual({ x: mesh.points[0].x, y: 1 - mesh.points[0].y });
    expect(layer.meshGrid.rest![2][3]).toEqual({ x: 1, y: 0 });
  });

  it('masks with the surface’s edge in the layer’s picture, y up, and covers the Screen', () => {
    const many = Array.from({ length: 70 }, (_, k) => ({ x: 0.5 + 0.6 * Math.cos(k / 11), y: 0.5 + 0.3 * Math.sin(k / 11) }));
    const layer = phoneMeshLayer({ mesh: phoneMesh(3, 3, { u0: 0, v0: 0, u1: 1, v1: 1 }, false), contentOutline: many }, { x: 0.5, y: 0, w: 0.5, h: 0.5 })!;
    const shape = layer.layerShape;
    expect(shape).toMatchObject({ type: 'custom', enabled: true, params: { customClosed: true, customShapeFit: 'mask' } });
    expect(shape.params.customPoints!.length).toBeLessThanOrEqual(32);
    expect(shape.params.customPoints!.every(p => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1)).toBe(true);
    expect(shape.params.customPoints![0]).toEqual({ x: 1, y: 0.5 }); // (1.1, 0.5) clamped, then y up
    expect(layer.corners).toEqual({ topLeft: { x: 0.5, y: 1 }, topRight: { x: 1, y: 1 }, bottomRight: { x: 1, y: 0.5 }, bottomLeft: { x: 0.5, y: 0.5 } });
  });

  it('ignores a malformed mesh so the four corners are used instead', () => {
    const good = phoneMesh(3, 3, { u0: 0, v0: 0, u1: 1, v1: 1 }, true);
    const bad = [
      undefined,
      { ...good, rows: 17 },
      { ...good, points: good.points.slice(1) },
      { ...good, points: good.points.map((p, i) => (i === 4 ? { x: NaN, y: 0 } : p)) },
      { ...good, rest: { u0: 0.5, v0: 0, u1: 0.4, v1: 1 } },
    ];
    for (const mesh of bad) expect(phoneMeshLayer({ mesh, contentOutline: outline }, crop)).toBeNull();
    expect(phoneMeshLayer({ mesh: good, contentOutline: outline.slice(0, 2) }, crop)).toBeNull();
    // Broken handles only: kept, as straight cells.
    const straight = phoneMeshLayer({ mesh: { ...good, tangents: [{ right: { x: 1, y: 0 } }] as never }, contentOutline: outline }, crop)!;
    expect(straight.meshGrid.bezier).toBeUndefined();
  });
});

describe('a flat face from the phone', () => {
  // A slanted box top as the projector sees it (pixels at 1080p): a strong trapezoid.
  const W = 1920, H = 1080;
  const quad = [{ x: 1085, y: 169 }, { x: 1481, y: 222 }, { x: 1425, y: 747 }, { x: 1072, y: 675 }].map(p => ({ x: p.x / W, y: p.y / H }));
  /** The true perspective: content (u, v) -> projector, normalised. */
  const truth = (() => {
    const s = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
    const a: number[][] = [];
    s.forEach((p, i) => { const q = quad[i]; a.push([p.x, p.y, 1, 0, 0, 0, -q.x * p.x, -q.x * p.y, q.x], [0, 0, 0, p.x, p.y, 1, -q.y * p.x, -q.y * p.y, q.y]); });
    for (let c = 0; c < 8; c++) { let p = c; for (let r = c + 1; r < 8; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r; [a[c], a[p]] = [a[p], a[c]]; const d = a[c][c]; for (let k = c; k < 9; k++) a[c][k] /= d; for (let r = 0; r < 8; r++) if (r !== c) { const f = a[r][c]; for (let k = c; k < 9; k++) a[r][k] -= f * a[c][k]; } }
    const h = [...a.map(r => r[8]), 1];
    return (u: number, v: number) => { const w = h[6] * u + h[7] * v + 1; return { x: (h[0] * u + h[1] * v + h[2]) / w, y: (h[3] * u + h[4] * v + h[5]) / w }; };
  })();
  const worst = (at: (u: number, v: number) => { x: number; y: number }) => {
    let e = 0;
    for (let a = 0; a <= 16; a++) for (let b = 0; b <= 16; b++) { const t = truth(a / 16, b / 16), g = at(a / 16, b / 16); e = Math.max(e, Math.hypot((g.x - t.x) * W, (g.y - t.y) * H)); }
    return e;
  };

  it('lands the inside of the face where the perspective puts it, not just its corners', () => {
    const layer = perspectiveMeshLayer(quad, crop)!;
    expect(layer).not.toBeNull();
    const meshed = worst((u, v) => { const p = evaluateMeshGrid(layer.meshGrid, u, 1 - v); return { x: p.x, y: 1 - p.y }; });
    // What the four-corner (bilinear) warp did before.
    const bilinear = worst((u, v) => ({ x: quad[0].x * (1 - u) * (1 - v) + quad[1].x * u * (1 - v) + quad[2].x * u * v + quad[3].x * (1 - u) * v, y: quad[0].y * (1 - u) * (1 - v) + quad[1].y * u * (1 - v) + quad[2].y * u * v + quad[3].y * (1 - u) * v }));
    expect(bilinear).toBeGreaterThan(10);
    expect(meshed).toBeLessThan(0.5);
    // Corners exactly where the phone measured them.
    expect(layer.meshGrid.points[0][0]).toEqual({ x: quad[0].x, y: 1 - quad[0].y });
  });

  it('declines a crossed quad', () => {
    expect(perspectiveMeshLayer([quad[0], quad[2], quad[1], quad[3]], crop)).toBeNull();
  });
});
