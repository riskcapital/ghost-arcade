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
import { applyHomography, invertHomography, type Decoded, type PatternPlan, type UV } from './structuredLight';

export type DetectedSurface = {
  outline: UV[];   // four corners on the photo, normalised, clockwise from top left
  points: UV[];    // the same corners in the projector's picture, normalised, top-left origin
  area: number;    // share of the photo it covers
  rmsPx: number;   // how well its measurements fit one plane, projector pixels
  samples: number;
  solid: number;   // how much of the outline the scan actually filled, 0..1: low means a ragged or partly hidden surface
};

type Sample = { x: number; y: number; u: number; v: number; gx: number; gy: number };

/** Least-squares homography (x, y) -> (u, v) with h33 = 1, or null if the points are degenerate. */
function solveHomography(points: Sample[]): number[] | null {
  const n = points.length;
  if (n < 4) return null;
  // Normalise both sides to about unit scale so the solve stays well conditioned.
  let mx = 0, my = 0, mu = 0, mv = 0;
  for (const p of points) { mx += p.x; my += p.y; mu += p.u; mv += p.v; }
  mx /= n; my /= n; mu /= n; mv /= n;
  let sc = 0, sp = 0;
  for (const p of points) { sc += Math.hypot(p.x - mx, p.y - my); sp += Math.hypot(p.u - mu, p.v - mv); }
  sc = sc / n || 1; sp = sp / n || 1;
  const ata = new Float64Array(64), atb = new Float64Array(8), row = new Float64Array(8);
  const add = (rhs: number) => { for (let i = 0; i < 8; i++) { atb[i] += row[i] * rhs; for (let j = 0; j < 8; j++) ata[i * 8 + j] += row[i] * row[j]; } };
  for (const p of points) {
    const x = (p.x - mx) / sc, y = (p.y - my) / sc, u = (p.u - mu) / sp, v = (p.v - mv) / sp;
    row[0] = x; row[1] = y; row[2] = 1; row[3] = 0; row[4] = 0; row[5] = 0; row[6] = -u * x; row[7] = -u * y; add(u);
    row[0] = 0; row[1] = 0; row[2] = 0; row[3] = x; row[4] = y; row[5] = 1; row[6] = -v * x; row[7] = -v * y; add(v);
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

function convexHull(points: { x: number; y: number }[]): { x: number; y: number }[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: any, a: any, b: any) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const build = (list: typeof sorted) => { const out: typeof sorted = []; for (const p of list) { while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop(); out.push(p); } out.pop(); return out; };
  return [...build(sorted), ...build(sorted.reverse())];
}

/** Shrinks a convex outline to four sides by repeatedly replacing its cheapest edge with the meeting point of its neighbours. */
function enclosingQuad(hull: { x: number; y: number }[]): { x: number; y: number }[] | null {
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
 * The line in the photo where two measured planes meet (a fold between two
 * faces), as a*x + b*y + c = 0 with a unit normal, or null. Two planes seen
 * by the same camera and projector differ by a transform that leaves exactly
 * the points of their shared edge where they were: that fixed line is the fold.
 */
function foldLine(h1: number[], h2: number[]): [number, number, number] | null {
  const inverse = invertHomography(h2);
  const g = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) g[i * 3 + j] += inverse[i * 3 + k] * h1[k * 3 + j];
  const scale = Math.cbrt(Math.abs(g[0] * (g[4] * g[8] - g[5] * g[7]) - g[1] * (g[3] * g[8] - g[5] * g[6]) + g[2] * (g[3] * g[7] - g[4] * g[6]))) || 1;
  for (let i = 0; i < 9; i++) g[i] /= scale;
  // G = k*I + e*l^T. The repeated eigenvalue k makes G - k*I rank one, every row a multiple of l.
  // Try the candidates for k and keep the one that leaves the flattest remainder.
  let best: [number, number, number] | null = null, bestRatio = Infinity, bestK = 0;
  const trace = g[0] + g[4] + g[8];
  const attempt = (k: number) => {
    const m = [g[0] - k, g[1], g[2], g[3], g[4] - k, g[5], g[6], g[7], g[8] - k];
    const rows = [m.slice(0, 3), m.slice(3, 6), m.slice(6, 9)].sort((p, q) => Math.hypot(...q) - Math.hypot(...p));
    const top = rows[0], norm = Math.hypot(...top);
    if (norm < 1e-9) return;
    // How far the other rows are from being multiples of the largest one.
    let off = 0;
    for (const row of rows.slice(1)) { const dot = (row[0] * top[0] + row[1] * top[1] + row[2] * top[2]) / (norm * norm); off += Math.hypot(row[0] - dot * top[0], row[1] - dot * top[1], row[2] - dot * top[2]); }
    const ratio = off / norm;
    if (ratio < bestRatio) { bestRatio = ratio; bestK = k; const n = Math.hypot(top[0], top[1]) || 1; best = [top[0] / n, top[1] / n, top[2] / n]; }
  };
  // Coarse sweep, then two finer sweeps around the best value.
  for (let step = 0; step <= 400; step++) attempt(trace / 3 * (0.5 + step / 400));
  for (const width of [1 / 400, 1 / 16000]) { const centre = bestK; for (let step = -40; step <= 40; step++) attempt(centre + trace / 3 * width * step / 40); }
  return bestRatio < 0.05 ? best : null;
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
  const at = (x: number, y: number) => {
    const px = Math.min(photo.width - 1, Math.max(0, Math.round(x))), py = Math.min(photo.height - 1, Math.max(0, Math.round(y)));
    return photo.luma[py * photo.width + px];
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
  const minPoints = Math.max(120, Math.floor(samples.length * (options.minShare ?? 0.012)));
  const taken = new Uint8Array(samples.length);
  const planes: number[][] = [];
  const reach = 14; // seeds are drawn close together, so they usually share a surface
  for (let found = 0; found < (options.maxSurfaces ?? 10); found++) {
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
  // Every sample goes to the plane it fits best; then each plane splits into connected patches.
  const owner = new Int16Array(samples.length).fill(-1);
  for (let i = 0; i < samples.length; i++) {
    let bestError = tolerance;
    for (let p = 0; p < planes.length; p++) { const error = miss(planes[p], samples[i]); if (error < bestError) { bestError = error; owner[i] = p; } }
  }
  const seen = new Uint8Array(samples.length);
  const surfaces: DetectedSurface[] = [];
  const rough: { h: number[]; quad: { x: number; y: number }[]; locked: boolean[]; samples: number; rmsPx: number }[] = [];
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
    const h = solveHomography(patch) ?? planes[plane];
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
    const tight = enclosingQuad(convexHull(core.length >= 12 ? core : patch));
    if (!tight) continue;
    // Trimming pulled every side in by one grid step per pass: push them back out.
    const quad = pushOut(tight, trimmed * step);
    let error = 0;
    for (const s of patch) { const q = applyHomography(h, s.x, s.y); error += (q.x - s.u) ** 2 + (q.y - s.v) ** 2; }
    // Clockwise from the corner nearest the photo's top left.
    const cx = quad.reduce((sum, p) => sum + p.x, 0) / 4, cy = quad.reduce((sum, p) => sum + p.y, 0) / 4;
    const around = [...quad].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
    let first = 0;
    for (let i = 1; i < 4; i++) if (around[i].x + around[i].y < around[first].x + around[first].y) first = i;
    rough.push({ h, quad: [0, 1, 2, 3].map(i => around[(first + i) % 4]), locked: [false, false, false, false], samples: patch.length, rmsPx: Math.sqrt(error / patch.length) });
  }
  // Folds: where two faces share a side, both take the calculated line where
  // their planes meet. It is exact, and the same for both, so they join.
  const near = Math.max(decoded.width, decoded.height) / 22;
  for (let i = 0; i < rough.length; i++) for (let j = i + 1; j < rough.length; j++) {
    const line = foldLine(rough[i].h, rough[j].h);
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
    for (const [surface, side] of [[rough[i], a], [rough[j], b]] as const) {
      for (const k of [side, (side + 1) % 4]) { const d = distance(surface.quad[k]); surface.quad[k] = { x: surface.quad[k].x - line[0] * d, y: surface.quad[k].y - line[1] * d }; }
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
      solid: Math.min(1, surface.samples * step * step / Math.max(1, Math.abs(ordered.reduce((sum, p, i) => sum + p.x * ordered[(i + 1) % 4].y - ordered[(i + 1) % 4].x * p.y, 0)) / 2)),
    });
  }
  return surfaces.sort((a, b) => b.area - a.area);
}
