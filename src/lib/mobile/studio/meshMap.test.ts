import { describe, expect, it } from 'vitest';
import type { Decoded } from './structuredLight';
import {
  choleskySolve, evaluateFittedMesh, fitMesh, fitProjector, mapCurvedSurfaces, projectPoint, sampleScan,
  segmentSurfaces, simplifyClosed, symmetricEigen, traceBoundary, type DepthScan, type FittedMesh,
} from './meshMap';

// ---------------------------------------------------------------------------
// A simulated room: a phone camera at the origin (x right, y down, z forward)
// looks at a wall 3 m away with a cylinder (a stand-in for a statue) in front
// of it. A projector off to the side lights both and casts the cylinder's
// shadow on the wall. The stripes are decoded to 32-pixel cells, as on the
// phone, and the LiDAR has a few millimetres of noise.
// ---------------------------------------------------------------------------

type Vec = [number, number, number];
const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: Vec): Vec => { const l = Math.hypot(...a); return [a[0] / l, a[1] / l, a[2] / l]; };

type Scene = { cylinder: { x: number; z: number; r: number; y0: number; y1: number } | null; wallZ: number };
const PHOTO = { width: 480, height: 360 };
const LENS = { fx: 0.75, fy: 1, cx: 0.5, cy: 0.5 };
const PROJ = { width: 1920, height: 1080, f: 1900, pos: [0.55, -0.35, -0.1] as Vec, target: [0.1, 0, 2.2] as Vec };
const CELL = 32;

/** The projector's camera-space -> pixel mapping, the ground truth. */
function projector() {
  const f = unit(sub(PROJ.target, PROJ.pos));
  const r = unit(cross(f, [0, -1, 0]));
  const d = cross(f, r);
  return (p: Vec) => {
    const q = sub(p, PROJ.pos);
    const x = dot(q, r), y = dot(q, d), z = dot(q, f);
    return { u: (PROJ.f * x) / z + PROJ.width / 2, v: (PROJ.f * y) / z + PROJ.height / 2, z };
  };
}

/** Nearest hit along a ray from `origin` in `dir` (t in units of dir), or null. */
function hitCylinder(scene: Scene, origin: Vec, dir: Vec): number | null {
  const c = scene.cylinder;
  if (!c) return null;
  const ox = origin[0] - c.x, oz = origin[2] - c.z;
  const a = dir[0] * dir[0] + dir[2] * dir[2], b = 2 * (ox * dir[0] + oz * dir[2]), k = ox * ox + oz * oz - c.r * c.r;
  const disc = b * b - 4 * a * k;
  if (disc < 0) return null;
  for (const t of [(-b - Math.sqrt(disc)) / (2 * a), (-b + Math.sqrt(disc)) / (2 * a)]) {
    if (t <= 1e-6) continue;
    const y = origin[1] + t * dir[1];
    if (y >= c.y0 && y <= c.y1) return t;
  }
  return null;
}

function surfaceAt(scene: Scene, xn: number, yn: number): { point: Vec; onCylinder: boolean } {
  const dir: Vec = [(xn - LENS.cx) / LENS.fx, (yn - LENS.cy) / LENS.fy, 1];
  const t = hitCylinder(scene, [0, 0, 0], dir);
  const wall = scene.wallZ;
  if (t !== null && t < wall) return { point: [dir[0] * t, dir[1] * t, t], onCylinder: true };
  return { point: [dir[0] * wall, dir[1] * wall, wall], onCylinder: false };
}

function random(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function simulate(scene: Scene, depthSize = { width: 192, height: 144 }, noiseM = 0.003) {
  const toProjector = projector();
  const lit = (p: Vec) => {
    const q = toProjector(p);
    if (!(q.z > 0) || q.u < 0 || q.v < 0 || q.u >= PROJ.width || q.v >= PROJ.height) return null;
    // Shadowed when the cylinder is in the way.
    const t = hitCylinder(scene, PROJ.pos, sub(p, PROJ.pos));
    if (t !== null && t < 1 - 1e-4) return null;
    return q;
  };
  const n = PHOTO.width * PHOTO.height;
  const decoded: Decoded = { width: PHOTO.width, height: PHOTO.height, valid: new Uint8Array(n), projX: new Float32Array(n), projY: new Float32Array(n), coverage: 0 };
  for (let y = 0; y < PHOTO.height; y++) for (let x = 0; x < PHOTO.width; x++) {
    const { point } = surfaceAt(scene, (x + 0.5) / PHOTO.width, (y + 0.5) / PHOTO.height);
    const q = lit(point);
    if (!q) continue;
    const i = y * PHOTO.width + x;
    decoded.valid[i] = 1;
    decoded.projX[i] = (Math.floor(q.u / CELL) + 0.5) * CELL;
    decoded.projY[i] = (Math.floor(q.v / CELL) + 0.5) * CELL;
  }
  const rand = random(7);
  const gauss = () => Math.sqrt(-2 * Math.log(Math.max(1e-12, rand()))) * Math.cos(2 * Math.PI * rand());
  const truth: { point: Vec; onCylinder: boolean }[] = [];
  const meters = new Float32Array(depthSize.width * depthSize.height);
  for (let j = 0; j < depthSize.height; j++) for (let i = 0; i < depthSize.width; i++) {
    const s = surfaceAt(scene, (i + 0.5) / depthSize.width, (j + 0.5) / depthSize.height);
    truth.push(s);
    meters[j * depthSize.width + i] = s.point[2] + noiseM * gauss();
  }
  const depth: DepthScan = { ...depthSize, meters, intrinsics: LENS };
  return { decoded, depth, truth, toProjector };
}

const room: Scene = { wallZ: 3, cylinder: { x: 0.1, z: 2.0, r: 0.35, y0: -0.7, y1: 0.6 } };

describe('linear algebra', () => {
  it('finds eigenvalues and vectors of a symmetric matrix', () => {
    const rand = random(3), n = 6;
    const a = new Array(n * n).fill(0);
    for (let i = 0; i < n; i++) for (let j = i; j < n; j++) { const v = rand() - 0.5; a[i * n + j] = v; a[j * n + i] = v; }
    const { values, vectors } = symmetricEigen(a, n);
    for (let k = 0; k < n; k++) {
      for (let i = 0; i < n; i++) {
        let av = 0;
        for (let j = 0; j < n; j++) av += a[i * n + j] * vectors[k][j];
        expect(av).toBeCloseTo(values[k] * vectors[k][i], 9);
      }
      if (k) expect(values[k]).toBeGreaterThanOrEqual(values[k - 1]);
    }
  });
  it('solves a positive definite system', () => {
    const m = Float64Array.from([4, 1, 0, 1, 3, 1, 0, 1, 2]);
    const [x] = choleskySolve(m, 3, [Float64Array.from([1, 2, 3])])!;
    expect(4 * x[0] + x[1]).toBeCloseTo(1, 10);
    expect(x[0] + 3 * x[1] + x[2]).toBeCloseTo(2, 10);
    expect(x[1] + 2 * x[2]).toBeCloseTo(3, 10);
    expect(choleskySolve(Float64Array.from([1, 2, 2, 1]), 2, [Float64Array.from([1, 1])])).toBeNull();
  });
});

describe('outlines', () => {
  it('traces a shape’s outer edge in order, once round', () => {
    const w = 6, h = 5;
    const mask = new Uint8Array(w * h);
    // An L: a 4x2 bar with a 2x2 foot.
    for (const [x, y] of [[1, 1], [2, 1], [3, 1], [4, 1], [1, 2], [2, 2], [3, 2], [4, 2], [1, 3], [2, 3]]) mask[y * w + x] = 1;
    const boundary = traceBoundary(mask, w, h);
    const cells = boundary.map(g => [g % w, Math.floor(g / w)]);
    expect(cells[0]).toEqual([1, 1]);
    expect(new Set(boundary).size).toBe(boundary.length);
    // Every cell but (2,2): with diagonal steps the edge goes round it.
    expect(boundary.length).toBe(9);
    expect(boundary).not.toContain(2 * w + 2);
    for (let k = 0; k < cells.length; k++) {
      const [a, b] = [cells[k], cells[(k + 1) % cells.length]];
      expect(Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]))).toBe(1);
    }
  });
  it('keeps a long outline under the point limit without losing its shape', () => {
    const circle = Array.from({ length: 400 }, (_, k) => ({ x: 0.5 + 0.3 * Math.cos((k / 400) * 2 * Math.PI), y: 0.5 + 0.3 * Math.sin((k / 400) * 2 * Math.PI) }));
    const short = simplifyClosed(circle, 32);
    expect(short.length).toBeLessThanOrEqual(32);
    expect(short.length).toBeGreaterThan(12);
    for (const p of short) expect(Math.hypot(p.x - 0.5, p.y - 0.5)).toBeCloseTo(0.3, 6);
  });
});

describe('the projector as a camera', () => {
  it('calibrates the projector from the stripes and the depth, to well under a stripe', () => {
    const { decoded, depth, toProjector } = simulate(room);
    const model = fitProjector(sampleScan(decoded, depth, CELL), CELL)!;
    expect(model).not.toBeNull();
    expect(model.inliers).toBeGreaterThan(0.9 * model.samples);
    // Against the true projector at points across the room.
    const rand = random(11);
    let worst = 0;
    for (let k = 0; k < 200; k++) {
      const p: Vec = [-0.8 + 1.6 * rand(), -0.6 + 1.2 * rand(), 1.8 + 1.2 * rand()];
      const truth = toProjector(p), fitted = projectPoint(model.P, ...p);
      if (truth.u < 0 || truth.v < 0 || truth.u > PROJ.width || truth.v > PROJ.height) continue;
      worst = Math.max(worst, Math.hypot(fitted.u - truth.u, fitted.v - truth.v));
    }
    expect(worst).toBeLessThan(3.5);
  });
  it('declines a flat wall, which a homography already maps', () => {
    const { decoded, depth } = simulate({ wallZ: 3, cylinder: null });
    expect(fitProjector(sampleScan(decoded, depth, CELL), CELL)).toBeNull();
  });
});

describe('smooth surfaces', () => {
  it('separates the cylinder from the wall and knows which is curved', () => {
    const { decoded, depth, truth } = simulate(room);
    const grid = sampleScan(decoded, depth, CELL);
    const regions = segmentSurfaces(grid);
    const litCylinder = truth.map((t, g) => t.onCylinder && grid.hasProj[g]).filter(Boolean).length;
    const curved = regions.filter(r => !r.planar);
    const flat = regions.filter(r => r.planar);
    expect(curved.length).toBeGreaterThanOrEqual(1);
    const best = curved.reduce((a, b) => (a.cells.length > b.cells.length ? a : b));
    const onCylinder = Array.from(best.cells).filter(c => truth[c].onCylinder).length;
    expect(onCylinder / best.cells.length).toBeGreaterThan(0.97);
    expect(onCylinder / litCylinder).toBeGreaterThan(0.8);
    expect(flat.some(r => Array.from(r.cells).every(c => !truth[c].onCylinder) && r.cells.length > 2000)).toBe(true);
  });
});

/** The desktop's own cell evaluation (meshWarp.ts evaluateMeshCell), in its y-up space, to prove the phone fits what it draws. */
function desktopCell(points: { x: number; y: number }[][], tangents: { right: { x: number; y: number }; down: { x: number; y: number } }[][], row: number, col: number, u: number, v: number) {
  const cubic = (p0: any, p1: any, p2: any, p3: any, t: number) => {
    const s = 1 - t;
    return { x: s * s * s * p0.x + 3 * s * s * t * p1.x + 3 * s * t * t * p2.x + t * t * t * p3.x, y: s * s * s * p0.y + 3 * s * s * t * p1.y + 3 * s * t * t * p2.y + t * t * t * p3.y };
  };
  const add = (p: any, q: any) => ({ x: p.x + q.x, y: p.y + q.y });
  const neg = (p: any) => ({ x: -p.x, y: -p.y });
  const edge = (r0: number, c0: number, r1: number, c1: number, t: number) => {
    const a = points[r0][c0], b = points[r1][c1];
    const ta = tangents[r0][c0], tb = tangents[r1][c1];
    return r0 === r1 ? cubic(a, add(a, ta.right), add(b, neg(tb.right)), b, t) : cubic(a, add(a, ta.down), add(b, neg(tb.down)), b, t);
  };
  const a = points[row][col], b = points[row][col + 1], c = points[row + 1][col + 1], d = points[row + 1][col];
  const bilinear = { x: (1 - u) * (1 - v) * a.x + u * (1 - v) * b.x + (1 - u) * v * d.x + u * v * c.x, y: (1 - u) * (1 - v) * a.y + u * (1 - v) * b.y + (1 - u) * v * d.y + u * v * c.y };
  const top = edge(row, col, row, col + 1, u), bottom = edge(row + 1, col, row + 1, col + 1, u);
  const left = edge(row, col, row + 1, col, v), right = edge(row, col + 1, row + 1, col + 1, v);
  return { x: (1 - v) * top.x + v * bottom.x + (1 - u) * left.x + u * right.x - bilinear.x, y: (1 - v) * top.y + v * bottom.y + (1 - u) * left.y + u * right.y - bilinear.y };
}

describe('meshes the desktop can draw', () => {
  it('evaluates a curved mesh exactly as the desktop does', () => {
    const rand = random(5), rows = 4, cols = 5;
    const mesh: FittedMesh = {
      rows, cols, rest: { u0: 0.1, v0: 0.2, u1: 0.8, v1: 0.9 },
      points: Array.from({ length: rows * cols }, (_, i) => ({ x: (i % cols) / (cols - 1) + 0.05 * (rand() - 0.5), y: Math.floor(i / cols) / (rows - 1) + 0.05 * (rand() - 0.5) })),
      tangents: Array.from({ length: rows * cols }, () => ({ right: { x: 0.08 + 0.04 * (rand() - 0.5), y: 0.04 * (rand() - 0.5) }, down: { x: 0.04 * (rand() - 0.5), y: 0.1 + 0.04 * (rand() - 0.5) } })),
    };
    // The desktop stores y up: flip points and handles.
    const grid = Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => ({ x: mesh.points[r * cols + c].x, y: 1 - mesh.points[r * cols + c].y })));
    const handles = Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => { const t = mesh.tangents![r * cols + c]; return { right: { x: t.right.x, y: -t.right.y }, down: { x: t.down.x, y: -t.down.y } }; }));
    for (let k = 0; k < 50; k++) {
      const u = mesh.rest.u0 + rand() * (mesh.rest.u1 - mesh.rest.u0), v = mesh.rest.v0 + rand() * (mesh.rest.v1 - mesh.rest.v0);
      const gs = ((u - mesh.rest.u0) / (mesh.rest.u1 - mesh.rest.u0)) * (cols - 1), gt = ((v - mesh.rest.v0) / (mesh.rest.v1 - mesh.rest.v0)) * (rows - 1);
      const c = Math.min(cols - 2, Math.floor(gs)), r = Math.min(rows - 2, Math.floor(gt));
      const desktop = desktopCell(grid, handles, r, c, gs - c, gt - r);
      const phone = evaluateFittedMesh(mesh, u, v);
      expect(phone.x).toBeCloseTo(desktop.x, 10);
      expect(1 - phone.y).toBeCloseTo(desktop.y, 10);
    }
  });

  it('fits a curved mapping far closer with curved cells than straight ones', () => {
    // A mapping with real curvature: a quarter-turn of a cylinder seen from the side.
    const samples = [] as { u: number; v: number; x: number; y: number }[];
    for (let i = 0; i <= 60; i++) for (let j = 0; j <= 30; j++) {
      const u = i / 60, v = j / 30;
      samples.push({ u, v, x: 0.5 + 0.4 * Math.sin((u - 0.5) * 2.4), y: 0.2 + 0.6 * v + 0.05 * Math.cos((u - 0.5) * 2.4) });
    }
    const rest = { u0: 0, v0: 0, u1: 1, v1: 1 };
    const error = (mesh: FittedMesh) => Math.sqrt(samples.reduce((s, p) => { const q = evaluateFittedMesh(mesh, p.u, p.v); return s + (q.x - p.x) ** 2 + (q.y - p.y) ** 2; }, 0) / samples.length);
    const straight = error(fitMesh(samples, rest, 4, 5, false)), curved = error(fitMesh(samples, rest, 4, 5, true));
    expect(curved).toBeLessThan(straight / 5);
  });
});

describe('a curved surface, end to end', () => {
  const scan = (mode: 'wrap' | 'camera') => {
    const sim = simulate(room);
    const result = mapCurvedSurfaces({ width: PROJ.width, height: PROJ.height, cell: CELL, decoded: sim.decoded }, sim.depth, [], mode);
    return { ...sim, result };
  };

  it('meshes the cylinder so content lands within a few projector pixels of where it should', () => {
    const { result, truth, toProjector } = scan('wrap');
    expect(result.model).not.toBeNull();
    expect(result.surfaces.length).toBe(1);
    const surface = result.surfaces[0];
    expect(surface.mesh.rows).toBeLessThanOrEqual(16);
    expect(surface.mesh.cols).toBeLessThanOrEqual(16);
    expect(surface.mesh.points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
    let sum = 0, count = 0, worst = 0;
    for (const vertex of surface.vertices) {
      const t = truth[vertex.cell];
      if (!t.onCylinder) continue;
      const want = toProjector(t.point);
      const got = evaluateFittedMesh(surface.mesh, vertex.u, vertex.v);
      const e = Math.hypot(got.x * PROJ.width - want.u, got.y * PROJ.height - want.v);
      sum += e * e; count++; worst = Math.max(worst, e);
    }
    const rms = Math.sqrt(sum / count);
    expect(rms).toBeLessThan(3);
    expect(worst).toBeLessThan(10);
    // The outline the desktop masks with: closed, inside the picture, at most 32 points.
    expect(surface.contentOutline.length).toBeGreaterThanOrEqual(4);
    expect(surface.contentOutline.length).toBeLessThanOrEqual(32);
    expect(surface.contentOutline.every(p => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1)).toBe(true);
    expect(surface.corners).toHaveLength(4);
  });

  it('wraps content evenly round the cylinder, unlike the camera’s view', () => {
    const evenness = (mode: 'wrap' | 'camera') => {
      const { result, truth } = scan(mode);
      const surface = result.surfaces[0];
      const c = room.cylinder!;
      const aspect = PROJ.width / PROJ.height;
      // Arc length round the cylinder and height, against the picture's horizontal and vertical.
      const rows = surface.vertices.filter(v => truth[v.cell].onCylinder).map(v => {
        const p = truth[v.cell].point;
        return { arc: c.r * Math.atan2(p[0] - c.x, c.z - p[2]), y: p[1], x: v.u * aspect, z: v.v };
      });
      const slope = (xs: number[], ys: number[]) => {
        const mx = xs.reduce((a, b) => a + b) / xs.length, my = ys.reduce((a, b) => a + b) / ys.length;
        let sxy = 0, sxx = 0, syy = 0;
        for (let k = 0; k < xs.length; k++) { sxy += (xs[k] - mx) * (ys[k] - my); sxx += (xs[k] - mx) ** 2; syy += (ys[k] - my) ** 2; }
        return { slope: sxy / sxx, r2: (sxy * sxy) / (sxx * syy) };
      };
      const across = slope(rows.map(r => r.arc), rows.map(r => r.x));
      const down = slope(rows.map(r => r.y), rows.map(r => r.z));
      return { ratio: across.slope / down.slope, r2: across.r2 };
    };
    const wrap = evenness('wrap'), camera = evenness('camera');
    expect(Math.abs(wrap.ratio - 1)).toBeLessThan(0.08);
    expect(wrap.r2).toBeGreaterThan(0.995);
    // The camera's view squeezes the sides of the cylinder.
    expect(camera.r2).toBeLessThan(wrap.r2);
  });

  it('gives way to the mesh when a flat outline was drawn across the cylinder', () => {
    const sim = simulate(room);
    const acrossCylinder = [{ x: 0.42, y: 0.3 }, { x: 0.62, y: 0.3 }, { x: 0.62, y: 0.6 }, { x: 0.42, y: 0.6 }];
    const onWall = [{ x: 0.02, y: 0.05 }, { x: 0.2, y: 0.05 }, { x: 0.2, y: 0.3 }, { x: 0.02, y: 0.3 }];
    const result = mapCurvedSurfaces({ width: PROJ.width, height: PROJ.height, cell: CELL, decoded: sim.decoded }, sim.depth, [acrossCylinder, onWall]);
    expect(result.keepFlat).toEqual([false, true]);
    expect(result.surfaces.length).toBe(1);
  });

  it('finds nothing curved on a flat wall', () => {
    const sim = simulate({ wallZ: 3, cylinder: null });
    const result = mapCurvedSurfaces({ width: PROJ.width, height: PROJ.height, cell: CELL, decoded: sim.decoded }, sim.depth, []);
    expect(result.surfaces).toHaveLength(0);
  });
});
