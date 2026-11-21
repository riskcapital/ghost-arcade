/**
 * Finds the flat surfaces in a stripe scan by itself, so nobody has to tap
 * corners. Every flat surface the projector lights is a region of the photo
 * where "camera pixel to projector pixel" follows one plane (a homography).
 * A box face, the face beside it and the wall behind are three different
 * planes, so they separate cleanly. Each region is then boxed with four
 * corners and those corners are carried into the projector's own picture.
 *
 * Pure maths on the decoded scan: no network, runs on the phone.
 */
import { applyHomography, invertHomography, type Decoded, type PatternPlan, type StripeEdges, type UV } from './structuredLight';

export type DetectedSurface = {
  outline: UV[];   // four corners on the photo, normalised, clockwise from top left
  points: UV[];    // the same corners in the projector's picture, normalised, top-left origin
  area: number;    // share of the photo it covers
  rmsPx: number;   // how well its measurements fit one plane, projector pixels
  samples: number;
  solid: number;   // how much of the outline the scan actually filled, 0..1: low means a ragged or partly hidden surface
  /** How far the stripe edges on it land from its plane, projector pixels (RMS): the fit's real accuracy, where `rmsPx` is mostly the stripes' rounding. */
  edgePx?: number;
};

type Sample = { x: number; y: number; u: number; v: number; gx: number; gy: number };

/** One coordinate of a correspondence: photo (x, y) lands on projector column (axis 0) or row (axis 1) `value`. */
type AxisSample = { x: number; y: number; axis: number; value: number };

/** Least-squares homography (x, y) -> (u, v) with h33 = 1, or null if the points are degenerate. */
function solveHomography(points: Sample[]): number[] | null {
  if (points.length < 4) return null;
  const rows: AxisSample[] = [];
  for (const p of points) rows.push({ x: p.x, y: p.y, axis: 0, value: p.u }, { x: p.x, y: p.y, axis: 1, value: p.v });
  return solveAxes(rows);
}

/** The same fit from single coordinates (the stripe edges give one exact coordinate each). */
function solveAxes(points: AxisSample[]): number[] | null {
  const n = points.length;
  if (n < 8) return null;
  // Normalise both sides to about unit scale so the solve stays well conditioned.
  let mx = 0, my = 0, mu = 0, mv = 0, nu = 0, nv = 0;
  for (const p of points) { mx += p.x; my += p.y; if (p.axis) { mv += p.value; nv++; } else { mu += p.value; nu++; } }
  if (nu < 3 || nv < 3) return null;
  mx /= n; my /= n; mu /= nu; mv /= nv;
  let sc = 0, sp = 0;
  for (const p of points) { sc += Math.hypot(p.x - mx, p.y - my); sp += Math.abs(p.value - (p.axis ? mv : mu)) * Math.SQRT2; }
  sc = sc / n || 1; sp = sp / n || 1;
  const ata = new Float64Array(64), atb = new Float64Array(8), row = new Float64Array(8);
  const add = (rhs: number) => { for (let i = 0; i < 8; i++) { atb[i] += row[i] * rhs; for (let j = 0; j < 8; j++) ata[i * 8 + j] += row[i] * row[j]; } };
  for (const p of points) {
    const x = (p.x - mx) / sc, y = (p.y - my) / sc;
    if (p.axis === 0) { const u = (p.value - mu) / sp; row[0] = x; row[1] = y; row[2] = 1; row[3] = 0; row[4] = 0; row[5] = 0; row[6] = -u * x; row[7] = -u * y; add(u); }
    else { const v = (p.value - mv) / sp; row[0] = 0; row[1] = 0; row[2] = 0; row[3] = x; row[4] = y; row[5] = 1; row[6] = -v * x; row[7] = -v * y; add(v); }
  }
  // Gaussian elimination with partial pivoting on the 8x8 normal equations.
  const a = Array.from({ length: 8 }, (_, i) => [...ata.subarray(i * 8, i * 8 + 8), atb[i]]);
  for (let c = 0; c < 8; c++) {
    let pivot = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(a[r][c]) > Math.abs(a[pivot][c])) pivot = r;
    if (Math.abs(a[pivot][c]) < 1e-10) return null;
    [a[c], a[pivot]] = [a[pivot], a[c]];
    const d = a[c][c];
    for (let k = c; k < 9; k++) a[c][k] /= d;
    for (let r = 0; r < 8; r++) if (r !== c) { const f = a[r][c]; if (f) for (let k = c; k < 9; k++) a[r][k] -= f * a[c][k]; }
  }
  const h = a.map(r => r[8]);
  // Undo the normalisation: H = Tp^-1 * Hn * Tc.
  const hn = [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
  const tc = [1 / sc, 0, -mx / sc, 0, 1 / sc, -my / sc, 0, 0, 1];
  const tpInv = [sp, 0, mu, 0, sp, mv, 0, 0, 1];
  const mul = (p: number[], q: number[]) => { const o = new Array(9).fill(0); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) o[i * 3 + j] += p[i * 3 + k] * q[k * 3 + j]; return o; };
  const full = mul(tpInv, mul(hn, tc));
  if (Math.abs(full[8]) < 1e-12) return null;
  return full.map(value => value / full[8]);
}

/** Largest per-axis miss, projector pixels: stripe cells quantise each axis on its own. */
function miss(h: number[], p: Sample): number {
  const w = h[6] * p.x + h[7] * p.y + h[8];
  if (Math.abs(w) < 1e-9) return Infinity;
  return Math.max(Math.abs((h[0] * p.x + h[1] * p.y + h[2]) / w - p.u), Math.abs((h[3] * p.x + h[4] * p.y + h[5]) / w - p.v));
}

export function convexHull(points: { x: number; y: number }[]): { x: number; y: number }[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: any, a: any, b: any) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const build = (list: typeof sorted) => { const out: typeof sorted = []; for (const p of list) { while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop(); out.push(p); } out.pop(); return out; };
  return [...build(sorted), ...build(sorted.reverse())];
}

/** Shrinks a convex outline to four sides by repeatedly replacing its cheapest edge with the meeting point of its neighbours. */
export function enclosingQuad(hull: { x: number; y: number }[]): { x: number; y: number }[] | null {
  let poly = hull.slice();
  const meet = (a: any, b: any, c: any, d: any) => {
    const den = (a.x - b.x) * (c.y - d.y) - (a.y - b.y) * (c.x - d.x);
    if (Math.abs(den) < 1e-9) return null;
    const t = ((a.x - c.x) * (c.y - d.y) - (a.y - c.y) * (c.x - d.x)) / den;
    return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
  };
  while (poly.length > 4) {
    let best = -1, bestCost = Infinity, bestPoint: { x: number; y: number } | null = null;
    const n = poly.length;
    for (let i = 0; i < n; i++) {
      // Remove edge (i, i+1): extend edge (i-1, i) and edge (i+2, i+1) until they meet.
      const a = poly[(i - 1 + n) % n], b = poly[i], c = poly[(i + 1) % n], d = poly[(i + 2) % n];
      const point = meet(a, b, d, c);
      if (!point) continue;
      // The meeting point must lie beyond b and beyond c, or the outline would fold.
      if ((point.x - b.x) * (b.x - a.x) + (point.y - b.y) * (b.y - a.y) < 0) continue;
      if ((point.x - c.x) * (c.x - d.x) + (point.y - c.y) * (c.y - d.y) < 0) continue;
      const cost = Math.abs((c.x - b.x) * (point.y - b.y) - (c.y - b.y) * (point.x - b.x)) / 2;
      if (cost < bestCost) { bestCost = cost; best = i; bestPoint = point; }
    }
    if (best < 0 || !bestPoint) return null;
    const next: typeof poly = [];
    for (let i = 0; i < n; i++) { if (i === best) next.push(bestPoint); else if (i !== (best + 1) % n) next.push(poly[i]); }
    poly = next;
  }
  return poly.length === 4 ? poly : null;
}

/**
 * Four sides from a convex outline: runs of hull edges that point the same
 * way are one side, the four longest runs are the quad's sides, and its
 * corners are where they meet. Unlike shaving the hull down edge by edge,
 * this ignores the rounded corners a ragged scan leaves (they are short
 * runs), so a thin face keeps its true sides. Null when there are not four
 * clear sides.
 */
export function quadFromSides(hull: { x: number; y: number }[], bendDeg = 14): { x: number; y: number }[] | null {
  const n = hull.length;
  if (n < 4) return null;
  const edges = hull.map((a, i) => { const b = hull[(i + 1) % n]; return { a, b, length: Math.hypot(b.x - a.x, b.y - a.y), angle: Math.atan2(b.y - a.y, b.x - a.x) }; });
  const turn = (p: number, q: number) => { let d = q - p; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return Math.abs(d); };
  // Start a run at the sharpest bend so no run wraps round the end of the list.
  let start = 0, sharpest = -1;
  for (let i = 0; i < n; i++) { const t = turn(edges[(i - 1 + n) % n].angle, edges[i].angle); if (t > sharpest) { sharpest = t; start = i; } }
  const limit = (bendDeg * Math.PI) / 180;
  const runs: { edges: typeof edges; length: number; angle: number }[] = [];
  for (let k = 0; k < n; k++) {
    const e = edges[(start + k) % n];
    const run = runs[runs.length - 1];
    if (run && turn(run.angle, e.angle) < limit) {
      // Length-weighted mean direction of the run.
      const x = Math.cos(run.angle) * run.length + Math.cos(e.angle) * e.length, y = Math.sin(run.angle) * run.length + Math.sin(e.angle) * e.length;
      run.edges.push(e); run.length += e.length; run.angle = Math.atan2(y, x);
    } else runs.push({ edges: [e], length: e.length, angle: e.angle });
  }
  if (runs.length < 4) return null;
  const sides = runs.map((run, index) => ({ run, index })).sort((p, q) => q.run.length - p.run.length).slice(0, 4).sort((p, q) => p.index - q.index).map(p => p.run);
  // Each side's line: least squares through points spread along its edges.
  const lines = sides.map(run => {
    const pts: { x: number; y: number }[] = [];
    for (const e of run.edges) { const steps = Math.max(1, Math.ceil(e.length / 2)); for (let k = 0; k <= steps; k++) pts.push({ x: e.a.x + (e.b.x - e.a.x) * k / steps, y: e.a.y + (e.b.y - e.a.y) * k / steps }); }
    const mx = pts.reduce((t, p) => t + p.x, 0) / pts.length, my = pts.reduce((t, p) => t + p.y, 0) / pts.length;
    let sxx = 0, sxy = 0, syy = 0;
    for (const p of pts) { sxx += (p.x - mx) ** 2; sxy += (p.x - mx) * (p.y - my); syy += (p.y - my) ** 2; }
    const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    return { a: { x: mx, y: my }, b: { x: mx + Math.cos(angle), y: my + Math.sin(angle) } };
  });
  const quad: { x: number; y: number }[] = [];
  for (let i = 0; i < 4; i++) {
    const p = lines[(i + 3) % 4], q = lines[i];
    const den = (p.a.x - p.b.x) * (q.a.y - q.b.y) - (p.a.y - p.b.y) * (q.a.x - q.b.x);
    if (Math.abs(den) < 1e-6) return null;
    const t = ((p.a.x - q.a.x) * (q.a.y - q.b.y) - (p.a.y - q.a.y) * (q.a.x - q.b.x)) / den;
    quad.push({ x: p.a.x + t * (p.b.x - p.a.x), y: p.a.y + t * (p.b.y - p.a.y) });
  }
  // A real face: convex, and no corner flung far beyond the outline.
  const cross = quad.map((a, i) => { const b = quad[(i + 1) % 4], c = quad[(i + 2) % 4]; return (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x); });
  if (!cross.every(c => c > 0) && !cross.every(c => c < 0)) return null;
  const xs = hull.map(p => p.x), ys = hull.map(p => p.y);
  const span = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  if (quad.some(c => Math.min(...hull.map(p => Math.hypot(p.x - c.x, p.y - c.y))) > 0.25 * span)) return null;
  return quad;
}

/** Moves every side of a convex quad outward by `distance`, keeping its angles. */
function pushOut(quad: { x: number; y: number }[], distance: number): { x: number; y: number }[] {
  if (!distance) return quad;
  const cx = quad.reduce((sum, p) => sum + p.x, 0) / 4, cy = quad.reduce((sum, p) => sum + p.y, 0) / 4;
  const lines = quad.map((a, i) => {
    const b = quad[(i + 1) % 4], length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    let nx = -(b.y - a.y) / length, ny = (b.x - a.x) / length;
    if ((a.x + b.x) / 2 * nx + (a.y + b.y) / 2 * ny < cx * nx + cy * ny) { nx = -nx; ny = -ny; }
    return { a: { x: a.x + nx * distance, y: a.y + ny * distance }, b: { x: b.x + nx * distance, y: b.y + ny * distance } };
  });
  return quad.map((corner, i) => {
    const p = lines[(i + 3) % 4], q = lines[i];
    const den = (p.a.x - p.b.x) * (q.a.y - q.b.y) - (p.a.y - p.b.y) * (q.a.x - q.b.x);
    if (Math.abs(den) < 1e-9) return corner;
    const t = ((p.a.x - q.a.x) * (q.a.y - q.b.y) - (p.a.y - q.a.y) * (q.a.x - q.b.x)) / den;
    return { x: p.a.x + t * (p.b.x - p.a.x), y: p.a.y + t * (p.b.y - p.a.y) };
  });
}

/**
 * The fold between two faces from where their planes agree: across the
 * photo the two homographies send a point to places whose difference is
 * nearly one fixed direction times the signed distance from the fold, so
 * that distance comes straight from a least-squares fit near the faces.
 * As a*x + b*y + c = 0 with a unit normal, or null.
 */
function foldBetween(h1: number[], h2: number[], around: { x: number; y: number }[]): [number, number, number] | null {
  const xs = around.map(p => p.x), ys = around.map(p => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const pts: { x: number; y: number; fx: number; fy: number }[] = [];
  for (let a = 0; a <= 30; a++) for (let b = 0; b <= 30; b++) {
    const x = x0 + (x1 - x0) * a / 30, y = y0 + (y1 - y0) * b / 30;
    const p = applyHomography(h1, x, y), q = applyHomography(h2, x, y);
    if ([p.x, p.y, q.x, q.y].every(Number.isFinite)) pts.push({ x, y, fx: p.x - q.x, fy: p.y - q.y });
  }
  if (pts.length < 20) return null;
  let line: [number, number, number] | null = null;
  let limit = Infinity;
  for (let round = 0; round < 4; round++) {
    const use = line ? pts.filter(p => Math.abs(line![0] * p.x + line![1] * p.y + line![2]) < limit) : pts;
    if (use.length < 12) return line;
    // The common direction of the differences, signed consistently.
    let sxx = 0, sxy = 0, syy = 0;
    for (const p of use) { sxx += p.fx * p.fx; sxy += p.fx * p.fy; syy += p.fy * p.fy; }
    const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy), dx = Math.cos(angle), dy = Math.sin(angle);
    // s = difference along that direction, fitted as a plane over the photo: s = a x + b y + c.
    const m = new Float64Array(9), r = new Float64Array(3);
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    for (const p of use) {
      const v = [p.x - mx, p.y - my, 1], t = p.fx * dx + p.fy * dy;
      for (let i = 0; i < 3; i++) { r[i] += v[i] * t; for (let j = 0; j < 3; j++) m[i * 3 + j] += v[i] * v[j]; }
    }
    const det = (q: Float64Array | number[]) => q[0] * (q[4] * q[8] - q[5] * q[7]) - q[1] * (q[3] * q[8] - q[5] * q[6]) + q[2] * (q[3] * q[7] - q[4] * q[6]);
    const d = det(m);
    if (Math.abs(d) < 1e-12) return line;
    const solve = (k: number) => { const q = Array.from(m); for (let i = 0; i < 3; i++) q[i * 3 + k] = r[i]; return det(q) / d; };
    const a = solve(0), b = solve(1), c = solve(2) - a * mx - b * my;
    const n = Math.hypot(a, b);
    if (!(n > 1e-9)) return line;
    line = [a / n, b / n, c / n];
    limit = Math.max(8, 0.06 * Math.hypot(x1 - x0, y1 - y0));
  }
  return line;
}

/** How far a homography puts an edge from its exact projector column or row, pixels. */
function edgeResidual(m: number[], p: AxisSample): number {
  const w = m[6] * p.x + m[7] * p.y + m[8];
  return Math.abs((p.axis ? m[3] * p.x + m[4] * p.y + m[5] : m[0] * p.x + m[1] * p.y + m[2]) / w - p.value);
}

/** An edge sits in the thin unreadable line between two cells: it belongs to whoever owns the grid all round it. */
function edgeOwnedBy(ownerAt: Int16Array | Int32Array | Uint8Array, gw: number, gh: number, step: number, x: number, y: number, id: number, none = -1): boolean {
  const gx = Math.floor(x / step), gy = Math.floor(y / step);
  let mine = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const cx = gx + dx, cy = gy + dy;
    if (cx < 0 || cy < 0 || cx >= gw || cy >= gh) continue;
    const owner = ownerAt[cy * gw + cx];
    if (owner === id) mine++;
    else if (owner !== none) return false;
  }
  return mine >= 3;
}

/**
 * Refits a surface's homography on the stripe edges inside it. Cell centres
 * are off by up to half a cell wherever a face's edge cuts a cell (and that is
 * most of a small face), which tilts the fit; the edges are exact.
 */
function refineWithEdges(h: number[], edges: StripeEdges | undefined, mine: (x: number, y: number) => boolean, cell: number): number[] {
  if (!edges?.count) return h;
  let points: AxisSample[] = [];
  for (let k = 0; k < edges.count; k++) {
    const x = edges.x[k], y = edges.y[k];
    if (mine(x, y)) points.push({ x, y, axis: edges.axis[k], value: edges.value[k] });
  }
  // Start from the cell-centre fit, then tighten: edges that disagree are misread stripes or another surface.
  let fit = h;
  for (const limit of [cell * 0.75, cell * 0.25, 0]) {
    let kept = points.filter(p => edgeResidual(fit, p) < (limit || Infinity));
    if (!limit) {
      const errors = kept.map(p => edgeResidual(fit, p)).sort((a, b) => a - b);
      const bound = Math.max(1.5, 3 * (errors[errors.length >> 1] ?? 0) * 1.4826);
      kept = kept.filter(p => edgeResidual(fit, p) < bound);
    }
    if (kept.filter(p => p.axis === 0).length < 12 || kept.filter(p => p.axis === 1).length < 12) return fit;
    fit = solveAxes(kept) ?? fit;
    points = kept;
  }
  return fit;
}

export type Photo = { width: number; height: number; luma: Uint8Array | Uint8ClampedArray | Float32Array };

/**
 * Moves each side of a detected outline onto the edge you can see in the
 * photo. The stripe scan puts a side within a few pixels (it cannot read
 * right at an edge, where a stripe straddles two surfaces); the lit photo
 * has a sharp step in brightness there. Each side slides and tilts a little
 * to where that step is strongest, and corners are where the sides meet.
 */
export function snapToEdges(quad: { x: number; y: number }[], photo: Photo, locked: boolean[] = []): { x: number; y: number }[] {
  const reach = Math.max(6, Math.round(Math.max(photo.width, photo.height) / 110));
  const cx = quad.reduce((sum, p) => sum + p.x, 0) / 4, cy = quad.reduce((sum, p) => sum + p.y, 0) / 4;
  // Bilinear, so a side can settle between pixels. Pixel centres sit at +0.5.
  const at = (x: number, y: number) => {
    const fx = Math.min(photo.width - 1, Math.max(0, x - 0.5)), fy = Math.min(photo.height - 1, Math.max(0, y - 0.5));
    const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(photo.width - 1, x0 + 1), y1 = Math.min(photo.height - 1, y0 + 1);
    const tx = fx - x0, ty = fy - y0, l = photo.luma, w = photo.width;
    return (l[y0 * w + x0] * (1 - tx) + l[y0 * w + x1] * tx) * (1 - ty) + (l[y1 * w + x0] * (1 - tx) + l[y1 * w + x1] * tx) * ty;
  };
  const lines: { a: { x: number; y: number }; b: { x: number; y: number } }[] = [];
  for (let side = 0; side < 4; side++) {
    const a = quad[side], b = quad[(side + 1) % 4];
    const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    let nx = -(b.y - a.y) / length, ny = (b.x - a.x) / length;
    if ((a.x + b.x) / 2 * nx + (a.y + b.y) / 2 * ny < cx * nx + cy * ny) { nx = -nx; ny = -ny; } // outward
    const steps = Math.max(12, Math.min(60, Math.round(length / 6)));
    const score = (d0: number, d1: number) => {
      let total = 0;
      for (let i = 0; i < steps; i++) {
        const t = 0.12 + 0.76 * i / (steps - 1), d = d0 + (d1 - d0) * t;
        const x = a.x + (b.x - a.x) * t + nx * d, y = a.y + (b.y - a.y) * t + ny * d;
        total += Math.abs(at(x + nx * 2, y + ny * 2) - at(x - nx * 2, y - ny * 2));
      }
      return total / steps;
    };
    let best = { d0: 0, d1: 0, value: score(0, 0) };
    if (!locked[side]) for (let d0 = -reach; d0 <= reach; d0++) for (let d1 = -reach; d1 <= reach; d1++) {
      // A small pull toward the measured position keeps a faint texture from winning.
      const value = score(d0, d1) - 0.08 * (Math.abs(d0) + Math.abs(d1));
      if (value > best.value) best = { d0, d1, value };
    }
    // Then to a quarter of a pixel around the best whole-pixel fit.
    if (!locked[side]) {
      const whole = best;
      for (let d0 = whole.d0 - 1; d0 <= whole.d0 + 1; d0 += 0.25) for (let d1 = whole.d1 - 1; d1 <= whole.d1 + 1; d1 += 0.25) {
        const value = score(d0, d1) - 0.08 * (Math.abs(d0) + Math.abs(d1));
        if (value > best.value) best = { d0, d1, value };
      }
    }
    lines.push({ a: { x: a.x + nx * best.d0, y: a.y + ny * best.d0 }, b: { x: b.x + nx * best.d1, y: b.y + ny * best.d1 } });
  }
  const meet = (p: typeof lines[number], q: typeof lines[number]) => {
    const den = (p.a.x - p.b.x) * (q.a.y - q.b.y) - (p.a.y - p.b.y) * (q.a.x - q.b.x);
    if (Math.abs(den) < 1e-9) return null;
    const t = ((p.a.x - q.a.x) * (q.a.y - q.b.y) - (p.a.y - q.a.y) * (q.a.x - q.b.x)) / den;
    return { x: p.a.x + t * (p.b.x - p.a.x), y: p.a.y + t * (p.b.y - p.a.y) };
  };
  const snapped = quad.map((corner, i) => meet(lines[(i + 3) % 4], lines[i]) ?? corner);
  // Keep the measured outline if snapping moved a corner further than it is allowed to look.
  return snapped.every((p, i) => Math.hypot(p.x - quad[i].x, p.y - quad[i].y) <= reach * 3) ? snapped : quad;
}

export function detectSurfaces(
  projector: { plan: PatternPlan; decoded: Decoded; width: number; height: number },
  options: { maxSurfaces?: number; seed?: number; minShare?: number; photo?: Photo } = {},
): DetectedSurface[] {
  const { decoded, plan } = projector;
  const step = Math.max(2, Math.round(Math.max(decoded.width, decoded.height) / 400));
  const gw = Math.floor(decoded.width / step), gh = Math.floor(decoded.height / step);
  const grid = new Int32Array(gw * gh).fill(-1);
  const samples: Sample[] = [];
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
    const x = gx * step + (step >> 1), y = gy * step + (step >> 1), i = y * decoded.width + x;
    if (!decoded.valid[i]) continue;
    grid[gy * gw + gx] = samples.length;
    samples.push({ x: x + 0.5, y: y + 0.5, u: decoded.projX[i], v: decoded.projY[i], gx, gy });
  }
  if (samples.length < 200) return [];
  let state = (options.seed ?? 7) >>> 0;
  const random = () => ((state = (state * 1664525 + 1013904223) >>> 0) / 4294967296);
  const tolerance = plan.cell * 0.6 + 2;
  const minPoints = Math.max(120, Math.floor(samples.length * (options.minShare ?? 0.003)));
  const taken = new Uint8Array(samples.length);
  const planes: number[][] = [];
  const reach = 14; // seeds are drawn close together, so they usually share a surface
  for (let found = 0; found < (options.maxSurfaces ?? 16); found++) {
    const open: number[] = [];
    for (let i = 0; i < samples.length; i++) if (!taken[i]) open.push(i);
    if (open.length < minPoints) break;
    let best: number[] | null = null, bestCount = 0;
    for (let iteration = 0; iteration < 500; iteration++) {
      const first = samples[open[Math.floor(random() * open.length)]];
      const pick = [first];
      for (let tries = 0; tries < 40 && pick.length < 4; tries++) {
        const gx = first.gx + Math.round((random() * 2 - 1) * reach), gy = first.gy + Math.round((random() * 2 - 1) * reach);
        if (gx < 0 || gy < 0 || gx >= gw || gy >= gh) continue;
        const index = grid[gy * gw + gx];
        if (index < 0 || taken[index] || pick.includes(samples[index])) continue;
        pick.push(samples[index]);
      }
      if (pick.length < 4) continue;
      const h = solveHomography(pick);
      if (!h) continue;
      let count = 0;
      for (const i of open) if (miss(h, samples[i]) < tolerance) count++;
      if (count > bestCount) { bestCount = count; best = h; }
    }
    if (!best || bestCount < minPoints) break;
    // Grow: refit on everything that agrees and look again, until the surface
    // stops gaining ground. Four close seeds only describe their own corner
    // of a face; this is what carries the plane out to the face's edges.
    let size = 0;
    for (let round = 0; round < 12; round++) {
      const agree = open.filter(i => miss(best!, samples[i]) < tolerance).map(i => samples[i]);
      if (agree.length <= size * 1.01) break;
      size = agree.length;
      best = solveHomography(agree) ?? best;
    }
    const members = open.filter(i => miss(best!, samples[i]) < tolerance);
    if (members.length < minPoints) break;
    for (const i of members) taken[i] = 1;
    planes.push(best);
  }
  // Every sample goes to the plane it fits best.
  const owner = new Int16Array(samples.length).fill(-1);
  const assign = () => {
    for (let i = 0; i < samples.length; i++) {
      let bestError = tolerance;
      owner[i] = -1;
      for (let p = 0; p < planes.length; p++) { const error = miss(planes[p], samples[i]); if (error < bestError) { bestError = error; owner[i] = p; } }
    }
  };
  assign();
  const edges = decoded.edges?.count ? decoded.edges : undefined;
  if (!edges) {
    // Two finds that are really one surface (a face found in two halves) fit a
    // single plane together: merge them.
    for (let merged = true; merged;) {
      merged = false;
      const members = planes.map(h => samples.filter(sample => miss(h, sample) < tolerance));
      search: for (let i = 0; i < planes.length; i++) for (let j = i + 1; j < planes.length; j++) {
        const both = [...new Set([...members[i], ...members[j]])];
        const joint = solveHomography(both);
        if (!joint) continue;
        const agree = both.filter(sample => miss(joint, sample) < tolerance).length;
        if (agree >= both.length * 0.9) { planes[i] = joint; planes.splice(j, 1); merged = true; break search; }
      }
    }
    // Along a fold the two faces are nearly the same plane, and the rounding in
    // the scan can make a thin in-between "surface" there. A find whose points
    // mostly sit close to a bigger find is that seam, not a surface: drop it.
    {
      const sizes = planes.map(h => samples.filter(sample => miss(h, sample) < tolerance));
      const order = planes.map((_, i) => i).sort((a, b) => sizes[b].length - sizes[a].length);
      const keep: number[] = [];
      for (const i of order) {
        const seam = keep.some(k => sizes[i].filter(sample => miss(planes[k], sample) < tolerance * 1.6).length > sizes[i].length * 0.6);
        if (!seam) keep.push(i);
      }
      const kept = keep.map(i => planes[i]);
      planes.length = 0; planes.push(...kept);
    }
    assign();
  } else {
    // Each plane made exact on the stripe edges among its samples: a plane
    // then lands inside the very cell a sample decoded, or it is not that
    // sample's plane. That decides what the rounded cell centres cannot: two
    // faces of a box nearly agree near their fold, a small face (a box top
    // seen at a slant) nearly agrees with its neighbour.
    const fits = (h: number[], sample: Sample) => miss(h, sample) <= plan.cell / 2 + 4;
    const ownerMap = () => {
      const ownerAt = new Int16Array(gw * gh).fill(-1);
      for (let i = 0; i < samples.length; i++) ownerAt[samples[i].gy * gw + samples[i].gx] = owner[i];
      return ownerAt;
    };
    const exactAll = () => { const ownerAt = ownerMap(); return planes.map((h, p) => refineWithEdges(h, edges, (x, y) => edgeOwnedBy(ownerAt, gw, gh, step, x, y, p), plan.cell)); };
    planes.splice(0, planes.length, ...exactAll());
    // The edges each plane owns: what decides whether two finds are one surface.
    const edgesOf = () => {
      const ownerAt = ownerMap();
      const lists: AxisSample[][] = planes.map(() => []);
      for (let k = 0; k < edges.count; k++) {
        const x = edges.x[k], y = edges.y[k];
        for (let p = 0; p < planes.length; p++) if (edgeOwnedBy(ownerAt, gw, gh, step, x, y, p)) { lists[p].push({ x, y, axis: edges.axis[k], value: edges.value[k] }); break; }
      }
      return lists;
    };
    const good = (h: number[], list: AxisSample[]) => list.filter(e => edgeResidual(h, e) < 2).length;
    // Two finds that are one surface (a face found in two halves): one exact
    // plane fits both finds' edges as well as their own planes do. Two faces
    // meeting at a fold never do, however small one of them is.
    for (let merged = true; merged;) {
      merged = false;
      assign();
      const lists = edgesOf();
      search: for (let i = 0; i < planes.length; i++) for (let j = i + 1; j < planes.length; j++) {
        const both = [...lists[i], ...lists[j]];
        if (both.length < 24) continue;
        const joint = solveAxes(both);
        if (!joint) continue;
        const own = good(planes[i], lists[i]) + good(planes[j], lists[j]);
        if (good(joint, both) >= 0.95 * own) { planes[i] = refineWithEdges(joint, { count: both.length, x: Float32Array.from(both, e => e.x), y: Float32Array.from(both, e => e.y), axis: Uint8Array.from(both, e => e.axis), value: Float32Array.from(both, e => e.value) }, () => true, plan.cell); planes.splice(j, 1); merged = true; break search; }
      }
    }
    // A find whose edges a bigger find's plane already fits is a seam along a fold, not a surface.
    {
      assign();
      const lists = edgesOf();
      const order = planes.map((_, i) => i).sort((p, q) => lists[q].length - lists[p].length);
      const keep: number[] = [];
      for (const i of order) {
        const mine = good(planes[i], lists[i]);
        const explained = keep.some(k => good(planes[k], lists[i]) >= 0.8 * mine);
        if (!explained && mine >= 12) keep.push(i);
      }
      const kept = keep.map(i => planes[i]);
      planes.length = 0; planes.push(...kept);
    }
    assign();
    planes.splice(0, planes.length, ...exactAll());
    const exact = planes;
    const candidates: number[][] = [];
    const unique = new Int16Array(gw * gh).fill(-1);
    for (let i = 0; i < samples.length; i++) {
      const list: number[] = [];
      for (let p = 0; p < exact.length; p++) if (fits(exact[p], samples[i])) list.push(p);
      candidates.push(list);
      if (list.length === 1) unique[samples[i].gy * gw + samples[i].gx] = list[0];
    }
    // Two planes also agree along the line where one's plane would cut the
    // other, far from any fold (a box top's height across the other box): a
    // sample is only in doubt when another candidate really is close by.
    const nearby = (sample: Sample, p: number) => {
      for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
        const x = sample.gx + dx, y = sample.gy + dy;
        if (x >= 0 && y >= 0 && x < gw && y < gh && unique[y * gw + x] === p) return true;
      }
      return false;
    };
    for (let i = 0; i < samples.length; i++) {
      const list = candidates[i];
      if (list.length <= 1) { owner[i] = list.length ? list[0] : -1; continue; }
      const near = list.filter(p => nearby(samples[i], p));
      owner[i] = near.length === 1 ? near[0] : near.length ? -1 : list.reduce((a, b) => (miss(exact[a], samples[i]) <= miss(exact[b], samples[i]) ? a : b));
    }
  }
  const seen = new Uint8Array(samples.length);
  const patchOf = new Int32Array(gw * gh);
  const surfaces: DetectedSurface[] = [];
  const rough: { h: number[]; quad: { x: number; y: number }[]; locked: boolean[]; samples: number; rmsPx: number; edgePx?: number }[] = [];
  for (let start = 0; start < samples.length; start++) {
    if (seen[start] || owner[start] < 0) continue;
    const plane = owner[start], patch: Sample[] = [], stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const s = samples[stack.pop()!];
      patch.push(s);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const gx = s.gx + dx, gy = s.gy + dy;
        if (gx < 0 || gy < 0 || gx >= gw || gy >= gh) continue;
        const index = grid[gy * gw + gx];
        if (index >= 0 && !seen[index] && owner[index] === plane) { seen[index] = 1; stack.push(index); }
      }
    }
    if (patch.length < minPoints) continue;
    let h = solveHomography(patch) ?? planes[plane];
    const patchId = rough.length + 1;
    for (const sample of patch) patchOf[sample.gy * gw + sample.gx] = patchId;
    const inPatch = (x: number, y: number) => edgeOwnedBy(patchOf, gw, gh, step, x, y, patchId, 0);
    h = refineWithEdges(h, decoded.edges, inPatch, plan.cell);
    let edgeSum = 0, edgeCount = 0;
    if (decoded.edges) for (let k = 0; k < decoded.edges.count; k++) {
      const e = { x: decoded.edges.x[k], y: decoded.edges.y[k], axis: decoded.edges.axis[k], value: decoded.edges.value[k] };
      if (!inPatch(e.x, e.y)) continue;
      const r = edgeResidual(h, e);
      if (r < plan.cell / 4) { edgeSum += r * r; edgeCount++; }
    }
    // Box the solid part of the patch: stray samples on its fringe would
    // drag a corner out, so only samples surrounded by their own patch count.
    let core = patch, trimmed = 0;
    for (let pass = 0; pass < 2; pass++) {
      const mine = new Set(core.map(sample => sample.gy * gw + sample.gx));
      const kept = core.filter(sample => {
        let near = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (mine.has((sample.gy + dy) * gw + sample.gx + dx)) near++;
        return near >= 8;
      });
      if (kept.length < Math.max(12, patch.length * 0.25)) break;
      core = kept; trimmed++;
    }
    // The sides of the whole patch's outline (a ragged edge and rounded corners
    // do not move them); else the trimmed core shaved to four sides, pushed back
    // out by the trimming.
    const sides = quadFromSides(convexHull(patch));
    const tight = sides ?? enclosingQuad(convexHull(core.length >= 12 ? core : patch));
    if (!tight) continue;
    const quad = sides ?? pushOut(tight, trimmed * step);
    let error = 0;
    for (const s of patch) { const q = applyHomography(h, s.x, s.y); error += (q.x - s.u) ** 2 + (q.y - s.v) ** 2; }
    // Clockwise from the corner nearest the photo's top left.
    const cx = quad.reduce((sum, p) => sum + p.x, 0) / 4, cy = quad.reduce((sum, p) => sum + p.y, 0) / 4;
    const around = [...quad].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
    let first = 0;
    for (let i = 1; i < 4; i++) if (around[i].x + around[i].y < around[first].x + around[first].y) first = i;
    rough.push({ h, quad: [0, 1, 2, 3].map(i => around[(first + i) % 4]), locked: [false, false, false, false], samples: patch.length, rmsPx: Math.sqrt(error / patch.length), ...(edgeCount >= 24 ? { edgePx: Math.sqrt(edgeSum / edgeCount) } : {}) });
  }
  // Folds: where two faces share a side, both take the calculated line where
  // their planes meet. It is exact, and the same for both, so they join.
  const near = Math.max(decoded.width, decoded.height) / 22;
  for (let i = 0; i < rough.length; i++) for (let j = i + 1; j < rough.length; j++) {
    const line = foldBetween(rough[i].h, rough[j].h, [...rough[i].quad, ...rough[j].quad]);
    if (!line) continue;
    const distance = (p: { x: number; y: number }) => line[0] * p.x + line[1] * p.y + line[2];
    // The side lying along the fold: the closest one, and only if the face's
    // other sides are clearly further away (a thin face has two sides near it).
    const sideOn = (surface: typeof rough[number]) => {
      const reach = [0, 1, 2, 3].map(k => Math.max(Math.abs(distance(surface.quad[k])), Math.abs(distance(surface.quad[(k + 1) % 4]))));
      const order = [0, 1, 2, 3].sort((p, q) => reach[p] - reach[q]);
      return !surface.locked[order[0]] && reach[order[0]] < near && reach[order[1]] > reach[order[0]] * 1.5 + 4 ? order[0] : undefined;
    };
    const a = sideOn(rough[i]), b = sideOn(rough[j]);
    if (a === undefined || b === undefined) continue;
    // A real fold: the two faces lie either side of it and their sides along
    // it run side by side, close together. Any two planes have such a line
    // (parallel faces too), but only touching faces share it.
    {
      const qa = rough[i].quad, qb = rough[j].quad;
      const centre = (q: { x: number; y: number }[]) => ({ x: q.reduce((t, p) => t + p.x, 0) / 4, y: q.reduce((t, p) => t + p.y, 0) / 4 });
      if (distance(centre(qa)) * distance(centre(qb)) >= 0) continue;
      const along = (p: { x: number; y: number }) => -line[1] * p.x + line[0] * p.y;
      const sa = [along(qa[a]), along(qa[(a + 1) % 4])].sort((p, q) => p - q), sb = [along(qb[b]), along(qb[(b + 1) % 4])].sort((p, q) => p - q);
      const overlap = Math.min(sa[1], sb[1]) - Math.max(sa[0], sb[0]);
      if (overlap < 0.3 * Math.min(sa[1] - sa[0], sb[1] - sb[0])) continue;
      const gap = Math.max(...[qa[a], qa[(a + 1) % 4]].map(p => Math.abs(distance(p)))) + Math.max(...[qb[b], qb[(b + 1) % 4]].map(p => Math.abs(distance(p))));
      if (gap > near) continue;
    }
    for (const [surface, side] of [[rough[i], a], [rough[j], b]] as const) {
      // The side becomes the fold line; its corners are where the fold meets the neighbouring sides.
      const q = surface.quad, k0 = side, k1 = (side + 1) % 4;
      const meetFold = (from: { x: number; y: number }, to: { x: number; y: number }) => {
        const df = distance(from), dt = distance(to);
        if (Math.abs(df - dt) < 1e-9) return null;
        const t = df / (df - dt);
        return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
      };
      const c0 = meetFold(q[(k0 + 3) % 4], q[k0]), c1 = meetFold(q[(k1 + 1) % 4], q[k1]);
      const onLine = (p: { x: number; y: number }) => { const d = distance(p); return { x: p.x - line[0] * d, y: p.y - line[1] * d }; };
      // A neighbouring side nearly along the fold would send its corner far off: then just drop the corner onto the line.
      const sane = (c: { x: number; y: number } | null, was: { x: number; y: number }) => c && Math.hypot(c.x - was.x, c.y - was.y) < near ? c : onLine(was);
      q[k0] = sane(c0, q[k0]); q[k1] = sane(c1, q[k1]);
      surface.locked[side] = true;
    }
  }
  for (const surface of rough) {
    // A few passes: each can only move a side a short way, and a thin face
    // often starts with one side well off. A fold side starts on its
    // calculated line, close enough for the visible crease to take it the rest of the way.
    let ordered = surface.quad;
    if (options.photo) for (let pass = 0; pass < 4; pass++) ordered = snapToEdges(ordered, options.photo);
    surfaces.push({
      outline: ordered.map(p => ({ x: p.x / decoded.width, y: p.y / decoded.height })),
      points: ordered.map(p => { const q = applyHomography(surface.h, p.x, p.y); return { x: q.x / projector.width, y: q.y / projector.height }; }),
      area: surface.samples * step * step / (decoded.width * decoded.height),
      rmsPx: surface.rmsPx,
      samples: surface.samples,
      ...(surface.edgePx !== undefined ? { edgePx: surface.edgePx } : {}),
      solid: Math.min(1, surface.samples * step * step / Math.max(1, Math.abs(ordered.reduce((sum, p, i) => sum + p.x * ordered[(i + 1) % 4].y - ordered[(i + 1) % 4].x * p.y, 0)) / 2)),
    });
  }
  return surfaces.sort((a, b) => b.area - a.area);
}
