/**
 * Mesh mapping for curved and organic forms, from the stripe scan and LiDAR.
 *
 * The stripe scan says which projector pixel each camera pixel sees; LiDAR
 * says where each camera pixel is in the room. Together they:
 *  1. calibrate the projector like a camera (any point in the room -> the
 *     projector pixel that lands on it), which fills the holes the stripes
 *     miss and measures far finer than one stripe;
 *  2. split the scene into smooth surfaces (a jump in depth or a crease
 *     separates them), so a statue comes apart from the wall and the floor;
 *  3. give each curved surface a mesh the desktop can warp a layer with:
 *     the picture either wraps the surface evenly (a conformal flattening of
 *     the measured shape) or matches what the camera sees.
 *
 * Pure TypeScript with no DOM: it runs on the phone and in tests.
 * Camera space is x right, y down, z forward, in metres.
 */
import type { Decoded, UV } from './structuredLight';

/** Normalised lens: fx = focal length / photo width, cx = principal point x / photo width (y likewise with the height). */
export type Intrinsics = { fx: number; fy: number; cx: number; cy: number };
/** Depth from the same camera as the photo: same field of view and orientation. 0 = no reading. */
export type DepthScan = {
  width: number; height: number; meters: Float32Array; intrinsics: Intrinsics;
  /** The ARKit camera transform of the depth frame (4x4, column-major, camera to gravity-aligned world), when the camera has one. */
  pose?: ArrayLike<number>;
  /** How far the depth was turned clockwise to be upright; `pose` is of the sensor's own orientation. */
  turn?: 0 | 90 | 180 | 270;
};

/** The scan resampled on the depth grid. */
export type ScanGrid = {
  width: number;
  height: number;
  xyz: Float32Array;   // camera space, 3 per cell
  hasXyz: Uint8Array;
  proj: Float32Array;  // measured projector pixel, 2 per cell
  hasProj: Uint8Array;
};

/** The projector as a camera: 3x4, camera-space metres -> projector pixels. */
export type ProjectorModel = { P: number[]; rmsPx: number; inliers: number; samples: number };

export type MeshMode = 'wrap' | 'camera';

/** A grid in the desktop's mesh layout, before its y-up flip. */
export type FittedMesh = {
  rows: number;
  cols: number;
  /** Row-major, row 0 at the top; the projector picture, normalised, top-left origin. */
  points: UV[];
  /** Cubic edge handles per point (offsets in the same space), or null for straight cells. */
  tangents: { right: UV; down: UV }[] | null;
  /** The part of the layer's picture the grid spans (content UV, top-left origin). */
  rest: { u0: number; v0: number; u1: number; v1: number };
};

export type CurvedSurface = {
  /** The edge on the photo, normalised, for showing it. */
  outline: UV[];
  /** The same edge in the layer's picture (content UV, top-left origin): the desktop hides content outside it. */
  contentOutline: UV[];
  mesh: FittedMesh;
  /** Four projector corners around the surface (top left, clockwise) for desktops that cannot take a mesh. */
  corners: UV[];
  mode: MeshMode;
  /** How far the mesh lands from the stripe measurements, projector pixels (stripes alone are good to about a third of a stripe). */
  rmsPx: number;
  /** Share of the photo it covers. */
  area: number;
  /** Each mesh vertex: its depth-grid cell and where it sits in the layer's picture (content UV). */
  vertices: { cell: number; u: number; v: number }[];
};

// ---------------------------------------------------------------------------
// Small dense linear algebra
// ---------------------------------------------------------------------------

/** Eigen-decomposition of a symmetric n×n matrix by Jacobi rotations. Values ascending; vectors[k] is the k-th unit vector. */
export function symmetricEigen(matrix: ArrayLike<number>, n: number): { values: number[]; vectors: number[][] } {
  const a = Float64Array.from(matrix as ArrayLike<number>);
  const v = new Float64Array(n * n);
  for (let i = 0; i < n; i++) v[i * n + i] = 1;
  let scale = 0;
  for (let i = 0; i < n * n; i++) scale += a[i] * a[i];
  for (let sweep = 0; sweep < 80; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p * n + q] * a[p * n + q];
    if (off <= 1e-30 * scale || off === 0) break;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
      const apq = a[p * n + q];
      if (Math.abs(apq) < 1e-300) continue;
      const theta = (a[q * n + q] - a[p * n + p]) / (2 * apq);
      const t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < n; k++) {
        const akp = a[k * n + p], akq = a[k * n + q];
        a[k * n + p] = c * akp - s * akq;
        a[k * n + q] = s * akp + c * akq;
      }
      for (let k = 0; k < n; k++) {
        const apk = a[p * n + k], aqk = a[q * n + k];
        a[p * n + k] = c * apk - s * aqk;
        a[q * n + k] = s * apk + c * aqk;
      }
      for (let k = 0; k < n; k++) {
        const vkp = v[k * n + p], vkq = v[k * n + q];
        v[k * n + p] = c * vkp - s * vkq;
        v[k * n + q] = s * vkp + c * vkq;
      }
    }
  }
  const order = Array.from({ length: n }, (_, i) => i).sort((i, j) => a[i * n + i] - a[j * n + j]);
  return {
    values: order.map(i => a[i * n + i]),
    vectors: order.map(i => Array.from({ length: n }, (_, k) => v[k * n + i])),
  };
}

/** Solves M x = b for each right-hand side; M is symmetric positive definite (n×n, row-major). Null when it is not. */
export function choleskySolve(m: Float64Array, n: number, rhs: Float64Array[]): Float64Array[] | null {
  const l = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = m[i * n + j];
      for (let k = 0; k < j; k++) sum -= l[i * n + k] * l[j * n + k];
      if (i === j) {
        if (!(sum > 0)) return null;
        l[i * n + i] = Math.sqrt(sum);
      } else l[i * n + j] = sum / l[j * n + j];
    }
  }
  return rhs.map(b => {
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let sum = b[i];
      for (let k = 0; k < i; k++) sum -= l[i * n + k] * y[k];
      y[i] = sum / l[i * n + i];
    }
    const x = new Float64Array(n);
    for (let i = n - 1; i >= 0; i--) {
      let sum = y[i];
      for (let k = i + 1; k < n; k++) sum -= l[k * n + i] * x[k];
      x[i] = sum / l[i * n + i];
    }
    return x;
  });
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function medianOf(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : 0.5 * (sorted[mid - 1] + sorted[mid]);
}

// ---------------------------------------------------------------------------
// 1. The scan on the depth grid
// ---------------------------------------------------------------------------

/**
 * Each depth cell gets its point in the room and the projector pixel the
 * stripes measured there: the mean of the decoded pixels it covers, after
 * dropping any more than a stripe from their median, so a cell that straddles
 * two stripes lands between them instead of on one.
 */
export function sampleScan(decoded: Decoded, depth: DepthScan, cell = 32): ScanGrid {
  const { width: dw, height: dh, meters, intrinsics: k } = depth;
  const n = dw * dh;
  const xyz = new Float32Array(n * 3), hasXyz = new Uint8Array(n), proj = new Float32Array(n * 2), hasProj = new Uint8Array(n);
  const sx = decoded.width / dw, sy = decoded.height / dh;
  const us: number[] = [], vs: number[] = [];
  for (let j = 0; j < dh; j++) {
    const y0 = Math.floor(j * sy), y1 = Math.max(y0 + 1, Math.floor((j + 1) * sy));
    for (let i = 0; i < dw; i++) {
      const g = j * dw + i;
      const z = meters[g];
      if (z > 0 && Number.isFinite(z)) {
        xyz[g * 3] = ((i + 0.5) / dw - k.cx) / k.fx * z;
        xyz[g * 3 + 1] = ((j + 0.5) / dh - k.cy) / k.fy * z;
        xyz[g * 3 + 2] = z;
        hasXyz[g] = 1;
      }
      const x0 = Math.floor(i * sx), x1 = Math.max(x0 + 1, Math.floor((i + 1) * sx));
      us.length = 0; vs.length = 0;
      for (let y = y0; y < y1 && y < decoded.height; y++) for (let x = x0; x < x1 && x < decoded.width; x++) {
        const c = y * decoded.width + x;
        if (decoded.valid[c]) { us.push(decoded.projX[c]); vs.push(decoded.projY[c]); }
      }
      if (!us.length || us.length < 0.3 * (x1 - x0) * (y1 - y0)) continue;
      const mu = medianOf(us), mv = medianOf(vs);
      let su = 0, sv = 0, count = 0;
      for (let q = 0; q < us.length; q++) {
        if (Math.abs(us[q] - mu) <= cell && Math.abs(vs[q] - mv) <= cell) { su += us[q]; sv += vs[q]; count++; }
      }
      // Two far-apart stripes in one cell (an edge): nothing within a stripe of the median, so keep the median.
      proj[g * 2] = count ? su / count : mu;
      proj[g * 2 + 1] = count ? sv / count : mv;
      hasProj[g] = 1;
    }
  }
  return { width: dw, height: dh, xyz, hasXyz, proj, hasProj };
}

// ---------------------------------------------------------------------------
// 2. The projector as a camera
// ---------------------------------------------------------------------------

export function projectPoint(P: ArrayLike<number>, x: number, y: number, z: number): { u: number; v: number; w: number } {
  const w = P[8] * x + P[9] * y + P[10] * z + P[11];
  return { u: (P[0] * x + P[1] * y + P[2] * z + P[3]) / w, v: (P[4] * x + P[5] * y + P[6] * z + P[7]) / w, w };
}

type Pair = { X: number; Y: number; Z: number; u: number; v: number };

/** Direct linear transform on (already normalised) pairs: the 12 entries, unit length. */
function dlt(pairs: Pair[]): number[] {
  const m = new Float64Array(144);
  const row = new Float64Array(12);
  const add = () => { for (let i = 0; i < 12; i++) { const ri = row[i]; if (!ri) continue; for (let j = 0; j < 12; j++) m[i * 12 + j] += ri * row[j]; } };
  for (const p of pairs) {
    row.fill(0);
    row[0] = p.X; row[1] = p.Y; row[2] = p.Z; row[3] = 1;
    row[8] = -p.u * p.X; row[9] = -p.u * p.Y; row[10] = -p.u * p.Z; row[11] = -p.u;
    add();
    row.fill(0);
    row[4] = p.X; row[5] = p.Y; row[6] = p.Z; row[7] = 1;
    row[8] = -p.v * p.X; row[9] = -p.v * p.Y; row[10] = -p.v * p.Z; row[11] = -p.v;
    add();
  }
  return symmetricEigen(m, 12).vectors[0];
}

function reprojectionError(P: ArrayLike<number>, p: Pair): number {
  const q = projectPoint(P, p.X, p.Y, p.Z);
  if (!(q.w > 0)) return Infinity;
  return Math.hypot(q.u - p.u, q.v - p.v);
}

/** Gauss-Newton with damping on the reprojection error (normalised space). */
function refine(P: number[], pairs: Pair[]): number[] {
  let p = P.slice();
  let lambda = 1e-3;
  const cost = (q: number[]) => { let s = 0; for (const pair of pairs) { const e = reprojectionError(q, pair); s += Number.isFinite(e) ? e * e : 1e6; } return s; };
  let current = cost(p);
  for (let iteration = 0; iteration < 12; iteration++) {
    const jtj = new Float64Array(144), jtr = new Float64Array(12);
    const ju = new Float64Array(12), jv = new Float64Array(12);
    for (const pair of pairs) {
      const h = [pair.X, pair.Y, pair.Z, 1];
      const w = p[8] * h[0] + p[9] * h[1] + p[10] * h[2] + p[11];
      if (!(w > 0)) continue;
      const u = (p[0] * h[0] + p[1] * h[1] + p[2] * h[2] + p[3]) / w;
      const v = (p[4] * h[0] + p[5] * h[1] + p[6] * h[2] + p[7]) / w;
      ju.fill(0); jv.fill(0);
      for (let k = 0; k < 4; k++) {
        ju[k] = h[k] / w; ju[8 + k] = -u * h[k] / w;
        jv[4 + k] = h[k] / w; jv[8 + k] = -v * h[k] / w;
      }
      const ru = pair.u - u, rv = pair.v - v;
      for (let i = 0; i < 12; i++) {
        jtr[i] += ju[i] * ru + jv[i] * rv;
        for (let j = 0; j < 12; j++) jtj[i * 12 + j] += ju[i] * ju[j] + jv[i] * jv[j];
      }
    }
    let improved = false;
    for (let attempt = 0; attempt < 6 && !improved; attempt++) {
      const damped = Float64Array.from(jtj);
      let trace = 0;
      for (let i = 0; i < 12; i++) trace += jtj[i * 13];
      for (let i = 0; i < 12; i++) damped[i * 13] += lambda * (jtj[i * 13] + trace / 12 * 1e-6) + 1e-12;
      const step = choleskySolve(damped, 12, [jtr]);
      if (!step) { lambda *= 10; continue; }
      const next = p.map((value, i) => value + step[0][i]);
      const norm = Math.hypot(...next);
      for (let i = 0; i < 12; i++) next[i] /= norm;
      const nextCost = cost(next);
      if (nextCost < current) { p = next; current = nextCost; lambda = Math.max(1e-7, lambda / 3); improved = true; }
      else lambda *= 10;
    }
    if (!improved) break;
  }
  return p;
}

/**
 * Calibrates the projector from points the scan saw in 3D. Robust to stray
 * measurements (RANSAC on minimal sets, then a refined fit on the agreeing
 * points). Null when the measured points lie on about one plane, where a
 * projector cannot be calibrated from them (a flat wall maps by homography
 * anyway).
 */
export function fitProjector(grid: ScanGrid, cell = 32, seed = 1): ProjectorModel | null {
  const pairs: Pair[] = [];
  for (let g = 0; g < grid.width * grid.height; g++) {
    if (!grid.hasXyz[g] || !grid.hasProj[g]) continue;
    pairs.push({ X: grid.xyz[g * 3], Y: grid.xyz[g * 3 + 1], Z: grid.xyz[g * 3 + 2], u: grid.proj[g * 2], v: grid.proj[g * 2 + 1] });
  }
  if (pairs.length < 200) return null;
  // Points that vary in only two directions cannot fix a projector.
  const spread = covariance(pairs.map(p => [p.X, p.Y, p.Z]));
  const eigen = symmetricEigen(spread.matrix, 3);
  if (!(eigen.values[0] > 2e-4 * eigen.values[2])) return null;

  // Normalise both sides (Hartley) so the solve is well conditioned.
  let cx = 0, cy = 0, cz = 0, cu = 0, cv = 0;
  for (const p of pairs) { cx += p.X; cy += p.Y; cz += p.Z; cu += p.u; cv += p.v; }
  cx /= pairs.length; cy /= pairs.length; cz /= pairs.length; cu /= pairs.length; cv /= pairs.length;
  let d3 = 0, d2 = 0;
  for (const p of pairs) { d3 += Math.hypot(p.X - cx, p.Y - cy, p.Z - cz); d2 += Math.hypot(p.u - cu, p.v - cv); }
  const s3 = Math.sqrt(3) / (d3 / pairs.length || 1), s2 = Math.sqrt(2) / (d2 / pairs.length || 1);
  const norm = pairs.map(p => ({ X: (p.X - cx) * s3, Y: (p.Y - cy) * s3, Z: (p.Z - cz) * s3, u: (p.u - cu) * s2, v: (p.v - cv) * s2 }));
  const threshold = Math.max(10, 0.75 * cell) * s2;

  const random = mulberry32(seed);
  const check = norm.length > 2500 ? Array.from({ length: 2500 }, () => norm[Math.floor(random() * norm.length)]) : norm;
  let best: number[] | null = null, bestCount = -1;
  for (let iteration = 0; iteration < 300; iteration++) {
    const sample: Pair[] = [];
    const picked = new Set<number>();
    while (sample.length < 6) { const i = Math.floor(random() * norm.length); if (!picked.has(i)) { picked.add(i); sample.push(norm[i]); } }
    const candidate = orient(dlt(sample), sample);
    let count = 0;
    for (const p of check) if (reprojectionError(candidate, p) < threshold) count++;
    if (count > bestCount) { bestCount = count; best = candidate; if (count > 0.97 * check.length) break; }
  }
  if (!best) return null;
  let inliers = norm.filter(p => reprojectionError(best!, p) < threshold);
  if (inliers.length < 100) return null;
  let refined = refine(orient(dlt(inliers), inliers), inliers);
  inliers = norm.filter(p => reprojectionError(refined, p) < threshold);
  refined = refine(refined, inliers);

  // Back to metres and pixels: P = T2^-1 P' T3.
  const t3 = [s3, 0, 0, -s3 * cx, 0, s3, 0, -s3 * cy, 0, 0, s3, -s3 * cz, 0, 0, 0, 1];
  const t2inv = [1 / s2, 0, cu, 0, 1 / s2, cv, 0, 0, 1];
  const pt3 = new Array(12).fill(0);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) for (let k = 0; k < 4; k++) pt3[r * 4 + c] += refined[r * 4 + k] * t3[k * 4 + c];
  const P = new Array(12).fill(0);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) for (let k = 0; k < 3; k++) P[r * 4 + c] += t2inv[r * 3 + k] * pt3[k * 4 + c];
  let sum = 0, count = 0;
  for (const p of pairs) {
    const e = reprojectionError(P, p);
    if (e < threshold / s2) { sum += e * e; count++; }
  }
  return { P, rmsPx: Math.sqrt(sum / Math.max(1, count)), inliers: count, samples: pairs.length };
}

/** Signs a projection so the points it was fitted to sit in front of it. */
function orient(P: number[], pairs: Pair[]): number[] {
  let ahead = 0;
  for (let i = 0; i < Math.min(pairs.length, 50); i++) { const p = pairs[i]; if (P[8] * p.X + P[9] * p.Y + P[10] * p.Z + P[11] > 0) ahead++; else ahead--; }
  return ahead >= 0 ? P : P.map(value => -value);
}

function covariance(points: number[][]): { mean: number[]; matrix: number[] } {
  const mean = [0, 0, 0];
  for (const p of points) { mean[0] += p[0]; mean[1] += p[1]; mean[2] += p[2]; }
  mean[0] /= points.length; mean[1] /= points.length; mean[2] /= points.length;
  const m = new Array(9).fill(0);
  for (const p of points) {
    const d = [p[0] - mean[0], p[1] - mean[1], p[2] - mean[2]];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) m[i * 3 + j] += d[i] * d[j];
  }
  return { mean, matrix: m.map(value => value / points.length) };
}

// ---------------------------------------------------------------------------
// 3. Smooth surfaces
// ---------------------------------------------------------------------------

export type SurfaceRegion = {
  /** Depth-grid cells, ascending. */
  cells: Int32Array;
  /** True when it is close to one plane. */
  planar: boolean;
  /** Distance of its points from their best plane, metres (RMS). */
  planeRms: number;
  /** Its largest size, metres. */
  extent: number;
};

/** Depth jump that still counts as the same surface between neighbouring cells. */
const continuous = (za: number, zb: number) => Math.abs(za - zb) <= 0.02 + 0.03 * Math.min(za, zb);

/** Surface normals from each cell's neighbourhood (PCA over continuous neighbours), facing the camera. */
export function surfaceNormals(grid: ScanGrid, radius = 2): Float32Array {
  const { width: w, height: h, xyz, hasXyz } = grid;
  const normals = new Float32Array(w * h * 3);
  const points: number[][] = [];
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const g = j * w + i;
    if (!hasXyz[g]) continue;
    const z = xyz[g * 3 + 2];
    points.length = 0;
    for (let y = Math.max(0, j - radius); y <= Math.min(h - 1, j + radius); y++) for (let x = Math.max(0, i - radius); x <= Math.min(w - 1, i + radius); x++) {
      const q = y * w + x;
      if (hasXyz[q] && continuous(z, xyz[q * 3 + 2])) points.push([xyz[q * 3], xyz[q * 3 + 1], xyz[q * 3 + 2]]);
    }
    if (points.length < 6) continue;
    const n = symmetricEigen(covariance(points).matrix, 3).vectors[0];
    const facing = n[0] * xyz[g * 3] + n[1] * xyz[g * 3 + 1] + n[2] * z < 0 ? 1 : -1;
    normals[g * 3] = n[0] * facing; normals[g * 3 + 1] = n[1] * facing; normals[g * 3 + 2] = n[2] * facing;
  }
  return normals;
}

/**
 * Splits what the projector lights into smooth surfaces: neighbours join
 * while their depth is continuous and their normals bend less than
 * `angleDeg`. Small holes in the stripe decode (a dark patch) are closed
 * first, so they do not cut a surface in two.
 */
export function segmentSurfaces(grid: ScanGrid, options: { angleDeg?: number; minCells?: number; normals?: Float32Array } = {}): SurfaceRegion[] {
  const { width: w, height: h, xyz, hasXyz } = grid;
  const n = w * h;
  const normals = options.normals ?? surfaceNormals(grid);
  const cosine = Math.cos(((options.angleDeg ?? 25) * Math.PI) / 180);
  const minCells = options.minCells ?? Math.max(60, Math.round(n * 0.004));
  // Lit: the stripes reached it, with gaps of a cell or two closed.
  const lit = close(grid.hasProj, w, h, 1);
  const label = new Int32Array(n).fill(-1);
  const queue = new Int32Array(n);
  const regions: SurfaceRegion[] = [];
  const hasNormal = (g: number) => normals[g * 3] !== 0 || normals[g * 3 + 1] !== 0 || normals[g * 3 + 2] !== 0;
  for (let seed = 0; seed < n; seed++) {
    if (label[seed] !== -1 || !hasXyz[seed] || !lit[seed] || !hasNormal(seed)) continue;
    let head = 0, tail = 0;
    queue[tail++] = seed;
    label[seed] = regions.length;
    while (head < tail) {
      const g = queue[head++];
      const i = g % w, j = (g - i) / w;
      const z = xyz[g * 3 + 2];
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const x = i + di, y = j + dj;
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const q = y * w + x;
        if (label[q] !== -1 || !hasXyz[q] || !lit[q] || !continuous(z, xyz[q * 3 + 2])) continue;
        if (hasNormal(q) && normals[g * 3] * normals[q * 3] + normals[g * 3 + 1] * normals[q * 3 + 1] + normals[g * 3 + 2] * normals[q * 3 + 2] < cosine) continue;
        label[q] = regions.length;
        queue[tail++] = q;
      }
    }
    const cells = Int32Array.from(queue.subarray(0, tail)).sort();
    if (cells.length < minCells) { for (const c of cells) label[c] = -2; continue; }
    const points = Array.from(cells, c => [xyz[c * 3], xyz[c * 3 + 1], xyz[c * 3 + 2]]);
    const eigen = symmetricEigen(covariance(points).matrix, 3);
    const planeRms = Math.sqrt(Math.max(0, eigen.values[0]));
    const extent = Math.sqrt(Math.max(0, eigen.values[2]) * 12);
    regions.push({ cells, planar: planeRms < Math.max(0.006, 0.012 * extent), planeRms, extent });
  }
  return regions;
}

/** Morphological closing (dilate then erode) of a 0/1 mask with a square of the given radius. */
function close(mask: Uint8Array, w: number, h: number, radius: number): Uint8Array {
  const pass = (source: Uint8Array, grow: boolean) => {
    const out = new Uint8Array(w * h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      let hit = !grow;
      for (let y = j - radius; y <= j + radius && hit !== grow; y++) for (let x = i - radius; x <= i + radius; x++) {
        const inside = x >= 0 && y >= 0 && x < w && y < h && source[y * w + x] === 1;
        if (grow ? inside : !inside) { hit = grow; break; }
      }
      out[j * w + i] = hit ? 1 : 0;
    }
    return out;
  };
  return pass(pass(mask, true), false);
}

// ---------------------------------------------------------------------------
// 4. Flattening (least squares conformal maps)
// ---------------------------------------------------------------------------

type Triangle = [number, number, number];

/**
 * Lays a triangle mesh flat with as little shape distortion as possible
 * (least squares conformal map, two vertices pinned). `guess` is a starting
 * layout, 2 numbers per vertex; it also sets where the pins go.
 */
export function conformalFlatten(positions: Float64Array, triangles: Triangle[], guess: Float64Array): Float64Array {
  const count = positions.length / 3;
  // Pin the two vertices farthest apart in the guess.
  let pinA = 0, far = -1;
  let gx = 0, gy = 0;
  for (let v = 0; v < count; v++) { gx += guess[v * 2]; gy += guess[v * 2 + 1]; }
  gx /= count; gy /= count;
  for (let v = 0; v < count; v++) { const d = Math.hypot(guess[v * 2] - gx, guess[v * 2 + 1] - gy); if (d > far) { far = d; pinA = v; } }
  let pinB = pinA; far = -1;
  for (let v = 0; v < count; v++) { const d = Math.hypot(guess[v * 2] - guess[pinA * 2], guess[v * 2 + 1] - guess[pinA * 2 + 1]); if (d > far) { far = d; pinB = v; } }
  if (pinA === pinB) return Float64Array.from(guess);
  const pinned = new Float64Array(count * 2).fill(NaN);
  pinned[pinA * 2] = guess[pinA * 2]; pinned[pinA * 2 + 1] = guess[pinA * 2 + 1];
  pinned[pinB * 2] = guess[pinB * 2]; pinned[pinB * 2 + 1] = guess[pinB * 2 + 1];
  // Free unknowns are numbered after skipping the four pinned ones.
  const index = new Int32Array(count * 2);
  let free = 0;
  for (let k = 0; k < count * 2; k++) index[k] = Number.isNaN(pinned[k]) ? free++ : -1;
  // Two rows per triangle (the Cauchy-Riemann residuals), six entries each.
  const rowsCols: number[] = [], rowsVals: number[] = [], rhs: number[] = [];
  for (const [i0, i1, i2] of triangles) {
    const p = [i0, i1, i2].map(i => [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]]);
    const e1 = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]];
    const e2 = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
    const l1 = Math.hypot(e1[0], e1[1], e1[2]);
    if (!(l1 > 1e-9)) continue;
    const ux = [e1[0] / l1, e1[1] / l1, e1[2] / l1];
    const normal = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const nl = Math.hypot(normal[0], normal[1], normal[2]);
    if (!(nl > 1e-12)) continue;
    const uy = [(normal[1] * ux[2] - normal[2] * ux[1]) / nl, (normal[2] * ux[0] - normal[0] * ux[2]) / nl, (normal[0] * ux[1] - normal[1] * ux[0]) / nl];
    const q = [[0, 0], [l1, 0], [e2[0] * ux[0] + e2[1] * ux[1] + e2[2] * ux[2], e2[0] * uy[0] + e2[1] * uy[1] + e2[2] * uy[2]]];
    const area2 = q[1][0] * q[2][1]; // twice the area, positive by construction
    if (!(area2 > 1e-12)) continue;
    const weight = Math.sqrt(area2 / 2);
    const ids = [i0, i1, i2];
    const real: [number, number][] = [], imag: [number, number][] = [];
    for (let k = 0; k < 3; k++) {
      const next = q[(k + 2) % 3], prev = q[(k + 1) % 3];
      // Gradient of vertex k's hat function: rot90(q[k+2] - q[k+1]) / (2A).
      const gx = -(next[1] - prev[1]) / area2, gy = (next[0] - prev[0]) / area2;
      real.push([gx * weight, -gy * weight]); // du/dx - dv/dy
      imag.push([gy * weight, gx * weight]);  // du/dy + dv/dx
    }
    for (const parts of [real, imag]) {
      let constant = 0;
      for (let k = 0; k < 3; k++) {
        for (let axis = 0; axis < 2; axis++) {
          const unknown = ids[k] * 2 + axis;
          const value = parts[k][axis];
          if (index[unknown] >= 0) { rowsCols.push(index[unknown]); rowsVals.push(value); }
          else constant += value * pinned[unknown];
        }
      }
      rowsCols.push(-1); rowsVals.push(0); // row end marker
      rhs.push(-constant);
    }
  }
  // Conjugate gradients on the normal equations, Jacobi preconditioned, from the guess.
  const rows: { cols: Int32Array; vals: Float64Array }[] = [];
  for (let start = 0, k = 0; k < rowsCols.length; k++) {
    if (rowsCols[k] === -1) { rows.push({ cols: Int32Array.from(rowsCols.slice(start, k)), vals: Float64Array.from(rowsVals.slice(start, k)) }); start = k + 1; }
  }
  const x = new Float64Array(free);
  for (let k = 0; k < count * 2; k++) if (index[k] >= 0) x[index[k]] = guess[k];
  const apply = (input: Float64Array, out: Float64Array) => {
    out.fill(0);
    for (const row of rows) {
      let dot = 0;
      for (let k = 0; k < row.cols.length; k++) dot += row.vals[k] * input[row.cols[k]];
      for (let k = 0; k < row.cols.length; k++) out[row.cols[k]] += row.vals[k] * dot;
    }
  };
  const b = new Float64Array(free), diag = new Float64Array(free);
  rows.forEach((row, r) => { for (let k = 0; k < row.cols.length; k++) { b[row.cols[k]] += row.vals[k] * rhs[r]; diag[row.cols[k]] += row.vals[k] * row.vals[k]; } });
  for (let k = 0; k < free; k++) diag[k] = diag[k] > 0 ? 1 / diag[k] : 1;
  const ax = new Float64Array(free), r = new Float64Array(free), z = new Float64Array(free), p = new Float64Array(free), ap = new Float64Array(free);
  apply(x, ax);
  let bNorm = 0;
  for (let k = 0; k < free; k++) { r[k] = b[k] - ax[k]; z[k] = r[k] * diag[k]; p[k] = z[k]; bNorm += b[k] * b[k]; }
  let rz = 0;
  for (let k = 0; k < free; k++) rz += r[k] * z[k];
  const tolerance = 1e-12 * Math.max(bNorm, 1e-30);
  for (let iteration = 0; iteration < 6000; iteration++) {
    apply(p, ap);
    let pap = 0;
    for (let k = 0; k < free; k++) pap += p[k] * ap[k];
    if (!(pap > 0)) break;
    const alpha = rz / pap;
    let rr = 0;
    for (let k = 0; k < free; k++) { x[k] += alpha * p[k]; r[k] -= alpha * ap[k]; rr += r[k] * r[k]; }
    if (rr < tolerance) break;
    let next = 0;
    for (let k = 0; k < free; k++) { z[k] = r[k] * diag[k]; next += r[k] * z[k]; }
    const beta = next / rz;
    rz = next;
    for (let k = 0; k < free; k++) p[k] = z[k] + beta * p[k];
  }
  const out = new Float64Array(count * 2);
  for (let k = 0; k < count * 2; k++) out[k] = index[k] >= 0 ? x[index[k]] : pinned[k];
  return out;
}

/** Turns (and if needed mirrors) a layout to best match a reference layout, keeping its shape. */
export function alignLayout(layout: Float64Array, reference: Float64Array): Float64Array {
  const count = layout.length / 2;
  let lx = 0, ly = 0, rx = 0, ry = 0;
  for (let v = 0; v < count; v++) { lx += layout[v * 2]; ly += layout[v * 2 + 1]; rx += reference[v * 2]; ry += reference[v * 2 + 1]; }
  lx /= count; ly /= count; rx /= count; ry /= count;
  const score = (mirror: number) => {
    let c = 0, s = 0;
    for (let v = 0; v < count; v++) {
      const px = layout[v * 2] - lx, py = mirror * (layout[v * 2 + 1] - ly);
      const qx = reference[v * 2] - rx, qy = reference[v * 2 + 1] - ry;
      c += px * qx + py * qy; s += px * qy - py * qx;
    }
    return { c, s, fit: Math.hypot(c, s) };
  };
  const plain = score(1), mirrored = score(-1);
  const mirror = mirrored.fit > plain.fit ? -1 : 1;
  const { c, s } = mirror === 1 ? plain : mirrored;
  const angle = Math.atan2(s, c), cos = Math.cos(angle), sin = Math.sin(angle);
  const out = new Float64Array(layout.length);
  for (let v = 0; v < count; v++) {
    const px = layout[v * 2] - lx, py = mirror * (layout[v * 2 + 1] - ly);
    out[v * 2] = cos * px - sin * py;
    out[v * 2 + 1] = sin * px + cos * py;
  }
  return out;
}

// ---------------------------------------------------------------------------
// 5. A desktop mesh fitted to the surface
// ---------------------------------------------------------------------------

/** The weights of each unknown at (a, b) in one cell: 4 points, then right and down handles of the same 4. */
function cellWeights(a: number, b: number, bezier: boolean): number[] {
  const bilinear = [(1 - a) * (1 - b), a * (1 - b), (1 - a) * b, a * b]; // P00 P01 P10 P11
  if (!bezier) return bilinear;
  const B = [(1 - a) ** 3, 3 * a * (1 - a) ** 2, 3 * a * a * (1 - a), a ** 3];
  const C = [(1 - b) ** 3, 3 * b * (1 - b) ** 2, 3 * b * b * (1 - b), b ** 3];
  // Coons patch of the four cubic edges (controls a, a + R_a, b - R_b, b; likewise down), minus the bilinear.
  return [
    (1 - b) * (B[0] + B[1]) + (1 - a) * (C[0] + C[1]) - bilinear[0],
    (1 - b) * (B[2] + B[3]) + a * (C[0] + C[1]) - bilinear[1],
    b * (B[0] + B[1]) + (1 - a) * (C[2] + C[3]) - bilinear[2],
    b * (B[2] + B[3]) + a * (C[2] + C[3]) - bilinear[3],
    (1 - b) * B[1], -(1 - b) * B[2], b * B[1], -b * B[2], // right handles of P00 P01 P10 P11
    (1 - a) * C[1], a * C[1], -(1 - a) * C[2], -a * C[2], // down handles of P00 P01 P10 P11
  ];
}

/** Where a fitted mesh sends a content position (rest-space u, v, top-left origin). */
export function evaluateFittedMesh(mesh: FittedMesh, u: number, v: number): UV {
  const { rows, cols, rest } = mesh;
  const gs = Math.max(0, Math.min(cols - 1, ((u - rest.u0) / (rest.u1 - rest.u0)) * (cols - 1)));
  const gt = Math.max(0, Math.min(rows - 1, ((v - rest.v0) / (rest.v1 - rest.v0)) * (rows - 1)));
  const c = Math.min(cols - 2, Math.floor(gs)), r = Math.min(rows - 2, Math.floor(gt));
  const weights = cellWeights(gs - c, gt - r, !!mesh.tangents);
  const corner = [r * cols + c, r * cols + c + 1, (r + 1) * cols + c, (r + 1) * cols + c + 1];
  let x = 0, y = 0;
  for (let k = 0; k < 4; k++) { x += weights[k] * mesh.points[corner[k]].x; y += weights[k] * mesh.points[corner[k]].y; }
  if (mesh.tangents) for (let k = 0; k < 4; k++) {
    const t = mesh.tangents[corner[k]];
    x += weights[4 + k] * t.right.x + weights[8 + k] * t.down.x;
    y += weights[4 + k] * t.right.y + weights[8 + k] * t.down.y;
  }
  return { x, y };
}

/**
 * Least-squares fit of a rows×cols mesh over `rest` to samples (content uv ->
 * target position), with a little smoothing so cells without samples follow
 * their neighbours. Bezier meshes also fit each point's edge handles, so
 * curved cells follow a curved surface far closer than straight ones.
 */
export function fitMesh(
  samples: { u: number; v: number; x: number; y: number }[],
  rest: FittedMesh['rest'],
  rows: number,
  cols: number,
  bezier: boolean,
): FittedMesh {
  const cells = rows * cols;
  const kinds = bezier ? 3 : 1;
  const n = cells * kinds;
  const m = new Float64Array(n * n), bx = new Float64Array(n), by = new Float64Array(n);
  const idx = new Int32Array(12), val = new Float64Array(12);
  const addRow = (count: number, weight: number, tx: number, ty: number) => {
    for (let p = 0; p < count; p++) {
      const ip = idx[p], vp = val[p] * weight;
      bx[ip] += vp * tx; by[ip] += vp * ty;
      for (let q = 0; q < count; q++) m[ip * n + idx[q]] += vp * val[q] * weight;
    }
  };
  for (const s of samples) {
    const gs = Math.max(0, Math.min(cols - 1, ((s.u - rest.u0) / (rest.u1 - rest.u0)) * (cols - 1)));
    const gt = Math.max(0, Math.min(rows - 1, ((s.v - rest.v0) / (rest.v1 - rest.v0)) * (rows - 1)));
    const c = Math.min(cols - 2, Math.floor(gs)), r = Math.min(rows - 2, Math.floor(gt));
    const weights = cellWeights(gs - c, gt - r, bezier);
    const corner = [r * cols + c, r * cols + c + 1, (r + 1) * cols + c, (r + 1) * cols + c + 1];
    let count = 0;
    for (let k = 0; k < 4; k++) { idx[count] = corner[k]; val[count++] = weights[k]; }
    if (bezier) for (let k = 0; k < 4; k++) { idx[count] = cells + corner[k]; val[count++] = weights[4 + k]; idx[count] = 2 * cells + corner[k]; val[count++] = weights[8 + k]; }
    addRow(count, 1, s.x, s.y);
  }
  // Smoothing: second differences of the points; handles near a third of the local chord.
  const density = Math.max(1, samples.length / cells);
  const smooth = Math.sqrt(1e-4 * density), handle = Math.sqrt(1e-4 * density);
  const at = (r: number, c: number) => r * cols + c;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (c > 0 && c < cols - 1) { idx[0] = at(r, c - 1); val[0] = 1; idx[1] = at(r, c); val[1] = -2; idx[2] = at(r, c + 1); val[2] = 1; addRow(3, smooth, 0, 0); }
    if (r > 0 && r < rows - 1) { idx[0] = at(r - 1, c); val[0] = 1; idx[1] = at(r, c); val[1] = -2; idx[2] = at(r + 1, c); val[2] = 1; addRow(3, smooth, 0, 0); }
    if (!bezier) continue;
    for (const [kind, along] of [[1, 'c'], [2, 'r']] as const) {
      const before = along === 'c' ? (c > 0 ? at(r, c - 1) : at(r, c)) : (r > 0 ? at(r - 1, c) : at(r, c));
      const after = along === 'c' ? (c < cols - 1 ? at(r, c + 1) : at(r, c)) : (r < rows - 1 ? at(r + 1, c) : at(r, c));
      const span = (along === 'c' ? (c > 0 ? 1 : 0) + (c < cols - 1 ? 1 : 0) : (r > 0 ? 1 : 0) + (r < rows - 1 ? 1 : 0)) || 1;
      idx[0] = kind * cells + at(r, c); val[0] = 1;
      idx[1] = after; val[1] = -1 / (3 * span);
      idx[2] = before; val[2] = 1 / (3 * span);
      addRow(before === after ? 1 : 3, handle, 0, 0);
    }
  }
  let trace = 0;
  for (let i = 0; i < n; i++) trace += m[i * n + i];
  for (let i = 0; i < n; i++) m[i * n + i] += 1e-9 * (trace / n) + 1e-12;
  const solved = choleskySolve(m, n, [bx, by]);
  if (!solved) throw new Error('The surface mesh could not be fitted.');
  const [sx, sy] = solved;
  const points = Array.from({ length: cells }, (_, i) => ({ x: sx[i], y: sy[i] }));
  const tangents = bezier ? Array.from({ length: cells }, (_, i) => ({ right: { x: sx[cells + i], y: sy[cells + i] }, down: { x: sx[2 * cells + i], y: sy[2 * cells + i] } })) : null;
  return { rows, cols, points, tangents, rest };
}

// ---------------------------------------------------------------------------
// 6. One curved surface, end to end
// ---------------------------------------------------------------------------

/** Ordered outer boundary of a 0/1 mask (Moore neighbour tracing, Jacob's stop), as cell indices, clockwise on screen. */
export function traceBoundary(mask: Uint8Array, w: number, h: number): number[] {
  let start = -1;
  for (let g = 0; g < w * h; g++) if (mask[g]) { start = g; break; }
  if (start < 0) return [];
  // Directions clockwise on screen (y down), from west.
  const dx = [-1, -1, 0, 1, 1, 1, 0, -1], dy = [0, -1, -1, -1, 0, 1, 1, 1];
  const on = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] === 1;
  const out = [start];
  let x = start % w, y = (start - x) / w;
  let from = 0; // the first cell's west neighbour is outside
  let first = -1;
  for (let steps = 0; steps < 8 * w * h; steps++) {
    let found = -1;
    for (let k = 1; k <= 8; k++) {
      const d = (from + k) % 8;
      if (on(x + dx[d], y + dy[d])) { found = d; break; }
    }
    if (found < 0) break; // a single cell
    if (y * w + x === start && found === first) break; // round once, leaving the start the same way
    if (first < 0) first = found;
    x += dx[found]; y += dy[found];
    out.push(y * w + x);
    from = (found + 4) % 8; // look round from the cell we came from
  }
  if (out.length > 1 && out[out.length - 1] === start) out.pop();
  return out;
}

/** Douglas-Peucker on a closed polygon, loosened until it has at most `limit` points. */
export function simplifyClosed(points: UV[], limit = 96): UV[] {
  if (points.length <= limit) return points.slice();
  let tolerance = 0.0015;
  for (let attempt = 0; attempt < 24; attempt++) {
    // Split at the point farthest from the first so the two halves are open chains.
    let far = 0, best = -1;
    for (let i = 1; i < points.length; i++) { const d = Math.hypot(points[i].x - points[0].x, points[i].y - points[0].y); if (d > best) { best = d; far = i; } }
    const keep = new Uint8Array(points.length);
    keep[0] = keep[far] = 1;
    const chain = (from: number, to: number) => {
      const stack: [number, number][] = [[from, to]];
      while (stack.length) {
        const [a, b] = stack.pop()!;
        const pa = points[a % points.length], pb = points[b % points.length];
        let worst = -1, at = -1;
        for (let i = a + 1; i < b; i++) {
          const p = points[i % points.length];
          const len = Math.hypot(pb.x - pa.x, pb.y - pa.y) || 1e-12;
          const d = Math.abs((pb.x - pa.x) * (pa.y - p.y) - (pa.x - p.x) * (pb.y - pa.y)) / len;
          if (d > worst) { worst = d; at = i; }
        }
        if (worst > tolerance) { keep[at % points.length] = 1; stack.push([a, at], [at, b]); }
      }
    };
    chain(0, far);
    chain(far, points.length);
    const out = points.filter((_, i) => keep[i]);
    if (out.length <= limit) return out;
    tolerance *= 1.5;
  }
  return points.filter((_, i) => i % Math.ceil(points.length / limit) === 0);
}

/**
 * Builds the mesh for one curved surface.
 * `aspect` is the projector picture's width / height (the layer fills it).
 */
export function buildCurvedSurface(
  grid: ScanGrid,
  cells: ArrayLike<number>,
  projector: { width: number; height: number; model: ProjectorModel | null },
  mode: MeshMode,
  options: { maxSide?: number; bezier?: boolean } = {},
): CurvedSurface {
  const { width: w, height: h, xyz } = grid;
  const maxSide = Math.max(4, Math.min(16, options.maxSide ?? 16));
  const bezier = options.bezier ?? true;
  // Fewer vertices on a big surface: every `stride`-th cell.
  const stride = Math.max(1, Math.ceil(Math.sqrt(cells.length / 3500)));
  const inRegion = new Uint8Array(w * h);
  for (let k = 0; k < cells.length; k++) inRegion[cells[k]] = 1;
  const lw = Math.ceil(w / stride), lh = Math.ceil(h / stride);
  const lattice = new Uint8Array(lw * lh);
  const vertexOf = new Int32Array(lw * lh).fill(-1);
  const positions: number[] = [], camera: number[] = [], cellOf: number[] = [];
  for (let lj = 0; lj < lh; lj++) for (let li = 0; li < lw; li++) {
    const g = lj * stride * w + li * stride;
    if (!inRegion[g]) continue;
    lattice[lj * lw + li] = 1;
    vertexOf[lj * lw + li] = cellOf.length;
    cellOf.push(g);
    positions.push(xyz[g * 3], xyz[g * 3 + 1], xyz[g * 3 + 2]);
    camera.push(li * stride + 0.5, lj * stride + 0.5);
  }
  const count = cellOf.length;
  if (count < 12) throw new Error('This surface is too small to mesh.');
  // Triangles over the lattice, split along the shorter diagonal in 3D.
  const triangles: Triangle[] = [];
  const zOf = (v: number) => positions[v * 3 + 2];
  const ok = (a: number, b: number) => continuous(zOf(a), zOf(b));
  const dist = (a: number, b: number) => Math.hypot(positions[a * 3] - positions[b * 3], positions[a * 3 + 1] - positions[b * 3 + 1], positions[a * 3 + 2] - positions[b * 3 + 2]);
  for (let lj = 0; lj + 1 < lh; lj++) for (let li = 0; li + 1 < lw; li++) {
    const a = vertexOf[lj * lw + li], b = vertexOf[lj * lw + li + 1], c = vertexOf[(lj + 1) * lw + li], d = vertexOf[(lj + 1) * lw + li + 1];
    const tri = (p: number, q: number, r: number) => { if (p >= 0 && q >= 0 && r >= 0 && ok(p, q) && ok(q, r) && ok(p, r)) triangles.push([p, q, r]); };
    if (a >= 0 && b >= 0 && c >= 0 && d >= 0) {
      if (dist(a, d) <= dist(b, c)) { tri(a, b, d); tri(a, d, c); } else { tri(a, b, c); tri(b, d, c); }
    } else { tri(a, b, d); tri(a, d, c); tri(a, b, c); tri(b, d, c); }
  }
  if (triangles.length < 8) throw new Error('This surface is too broken up to mesh.');
  // Where each vertex lands in the projector: the calibrated projector when there is one, else the stripes.
  const targets: ({ x: number; y: number } | null)[] = cellOf.map((g, v) => {
    if (projector.model) {
      const q = projectPoint(projector.model.P, positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]);
      return q.w > 0 ? { x: q.u, y: q.v } : null;
    }
    return grid.hasProj[g] ? { x: grid.proj[g * 2], y: grid.proj[g * 2 + 1] } : null;
  });
  // The layout: the camera's view, or the surface laid flat and turned to match it.
  const cameraLayout = Float64Array.from(camera);
  let layout: Float64Array = cameraLayout;
  if (mode === 'wrap') {
    // Start from a front view in metres, scaled to the camera layout so the pins are sensible.
    const front = new Float64Array(count * 2);
    for (let v = 0; v < count; v++) { front[v * 2] = positions[v * 3]; front[v * 2 + 1] = positions[v * 3 + 1]; }
    layout = alignLayout(conformalFlatten(Float64Array.from(positions), triangles, front), cameraLayout);
  }
  // Fit the layout into the layer's picture: aspect kept, centred, nearly filling it.
  const aspect = projector.width / projector.height;
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (let v = 0; v < count; v++) {
    minU = Math.min(minU, layout[v * 2]); maxU = Math.max(maxU, layout[v * 2]);
    minV = Math.min(minV, layout[v * 2 + 1]); maxV = Math.max(maxV, layout[v * 2 + 1]);
  }
  const bw = Math.max(1e-9, maxU - minU), bh = Math.max(1e-9, maxV - minV);
  const scale = 0.98 * Math.min(aspect / bw, 1 / bh);
  const content = (v: number): UV => ({
    x: 0.5 + ((layout[v * 2] - (minU + maxU) / 2) * scale) / aspect,
    y: 0.5 + (layout[v * 2 + 1] - (minV + maxV) / 2) * scale,
  });
  const uv = Array.from({ length: count }, (_, v) => content(v));
  // The grid spans the surface's part of the picture (a hair beyond it), cells about square on screen.
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const p of uv) { u0 = Math.min(u0, p.x); u1 = Math.max(u1, p.x); v0 = Math.min(v0, p.y); v1 = Math.max(v1, p.y); }
  const pad = 0.01;
  const rest = { u0: Math.max(0, u0 - pad), v0: Math.max(0, v0 - pad), u1: Math.min(1, u1 + pad), v1: Math.min(1, v1 + pad) };
  const restAspect = ((rest.u1 - rest.u0) * aspect) / (rest.v1 - rest.v0);
  const cols = restAspect >= 1 ? maxSide : Math.max(4, Math.min(maxSide, Math.round((maxSide - 1) * restAspect) + 1));
  const rows = restAspect >= 1 ? Math.max(4, Math.min(maxSide, Math.round((maxSide - 1) / restAspect) + 1)) : maxSide;
  const samples: { u: number; v: number; x: number; y: number }[] = [];
  for (let v = 0; v < count; v++) {
    const t = targets[v];
    if (t) samples.push({ u: uv[v].x, v: uv[v].y, x: t.x / projector.width, y: t.y / projector.height });
  }
  if (samples.length < 12) throw new Error('The projector does not reach enough of this surface.');
  const mesh = fitMesh(samples, rest, rows, cols, bezier);
  // How far the mesh lands from what the stripes measured, in projector pixels.
  let sum = 0, measured = 0;
  for (let v = 0; v < count; v++) {
    const g = cellOf[v];
    if (!grid.hasProj[g]) continue;
    const p = evaluateFittedMesh(mesh, uv[v].x, uv[v].y);
    const ex = p.x * projector.width - grid.proj[g * 2], ey = p.y * projector.height - grid.proj[g * 2 + 1];
    sum += ex * ex + ey * ey; measured++;
  }
  // The outline: the lattice boundary, in the photo and in the picture.
  const boundary = traceBoundary(lattice, lw, lh).map(l => vertexOf[l]).filter(v => v >= 0);
  // The desktop's native renderer keeps 32 outline points.
  const contentOutline = simplifyClosed(boundary.map(v => uv[v]), 32);
  const outline = simplifyClosed(boundary.map(v => ({ x: camera[v * 2] / w, y: camera[v * 2 + 1] / h })));
  const corner = (u: number, v: number) => evaluateFittedMesh(mesh, u, v);
  return {
    outline,
    contentOutline,
    mesh,
    corners: [corner(rest.u0, rest.v0), corner(rest.u1, rest.v0), corner(rest.u1, rest.v1), corner(rest.u0, rest.v1)],
    mode,
    rmsPx: Math.sqrt(sum / Math.max(1, measured)),
    area: cells.length / (w * h),
    vertices: cellOf.map((cell, v) => ({ cell, u: uv[v].x, v: uv[v].y })),
  };
}

// ---------------------------------------------------------------------------
// 7. A whole projector's scan
// ---------------------------------------------------------------------------

export type CurvedScan = {
  grid: ScanGrid;
  model: ProjectorModel | null;
  /** Curved surfaces' cells, for rebuilding one in another mode. */
  regions: Int32Array[];
  surfaces: CurvedSurface[];
  /** Which of the flat surfaces found by the stripes alone to keep: a flat fit across a curved surface is dropped. */
  keepFlat: boolean[];
};

const insidePolygon = (polygon: UV[], x: number, y: number) => {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
};

/**
 * Finds the curved surfaces one projector lights, given its stripe decode,
 * the LiDAR depth and the outlines (photo, normalised) of the flat surfaces
 * the stripes found on their own. A flat outline drawn across a surface the
 * depth shows is curved gives way to that surface's mesh.
 */
export function mapCurvedSurfaces(
  projector: { width: number; height: number; cell: number; decoded: Decoded },
  depth: DepthScan,
  flatOutlines: UV[][],
  mode: MeshMode = 'wrap',
  options: { maxSide?: number; bezier?: boolean } = {},
): CurvedScan {
  const grid = sampleScan(projector.decoded, depth, projector.cell);
  const model = fitProjector(grid, projector.cell);
  const all = segmentSurfaces(grid);
  const { width: w, height: h } = grid;
  const curvedOf = new Int32Array(w * h).fill(-1);
  const curved = all.filter(r => !r.planar);
  curved.forEach((region, index) => { for (const c of region.cells) curvedOf[c] = index; });
  const taken = new Uint8Array(w * h);
  // A flat outline stays when the depth inside it is flat. Judged on the
  // outline's own cells, not on the region it falls in: smoothed normals bend
  // gradually across a box's edge, so a box's faces (and the floor they stand
  // on) can grow into one region that is not planar, though each face is.
  const keepFlat = flatOutlines.map(outline => {
    const cx = outline.reduce((s, p) => s + p.x, 0) / outline.length, cy = outline.reduce((s, p) => s + p.y, 0) / outline.length;
    // A little inside the outline: its edge cells straddle the next surface.
    const inner = outline.map(p => ({ x: cx + (p.x - cx) * 0.85, y: cy + (p.y - cy) * 0.85 }));
    let lit = 0, onCurved = 0;
    const inside: number[] = [], points: number[][] = [];
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const g = j * w + i;
      if (!grid.hasProj[g] || !insidePolygon(outline, (i + 0.5) / w, (j + 0.5) / h)) continue;
      lit++; inside.push(g);
      if (curvedOf[g] >= 0) onCurved++;
      if (grid.hasXyz[g] && insidePolygon(inner, (i + 0.5) / w, (j + 0.5) / h)) points.push([grid.xyz[g * 3], grid.xyz[g * 3 + 1], grid.xyz[g * 3 + 2]]);
    }
    let keep = !(lit > 0 && onCurved > 0.5 * lit);
    if (!keep && points.length >= 12) {
      // Robustly: the outline is four corners round a surface, so it can take in
      // a little of what is in front of or behind it (a floor's outline round
      // the boxes on it). Flat when most of its depth lies on one plane.
      let use = points, share = 0;
      for (let round = 0; round < 4 && use.length >= 12; round++) {
        const { mean, matrix } = covariance(use);
        const n = symmetricEigen(matrix, 3).vectors[0];
        const off = (p: number[]) => Math.abs((p[0] - mean[0]) * n[0] + (p[1] - mean[1]) * n[1] + (p[2] - mean[2]) * n[2]);
        const on = points.filter(p => off(p) < 0.01);
        share = on.length / points.length;
        use = on;
      }
      keep = share >= 0.7;
    }
    if (keep) for (const g of inside) taken[g] = 1;
    return keep;
  });
  const regions: Int32Array[] = [];
  const surfaces: CurvedSurface[] = [];
  const minCells = Math.max(60, Math.round(w * h * 0.004));
  for (const region of curved) {
    const cells = Int32Array.from(Array.from(region.cells).filter(c => !taken[c]));
    // Mostly explained by flat faces: what is left is their seams, not a curved form.
    if (cells.length < minCells || cells.length < 0.5 * region.cells.length) continue;
    try {
      surfaces.push(buildCurvedSurface(grid, cells, { width: projector.width, height: projector.height, model }, mode, options));
      regions.push(cells);
    } catch { /* too small or broken up to mesh: left out */ }
  }
  return { grid, model, regions, surfaces, keepFlat };
}
