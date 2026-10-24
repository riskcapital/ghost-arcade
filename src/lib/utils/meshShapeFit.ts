import type { BezierPoint, LayerShape, MeshWarpGrid, Point2D } from '../types';
import { createMeshGrid } from '../types';
import { isIdentityMeshGrid } from './meshWarp';

/**
 * Mesh warp on a Custom Shape. A layer's mesh normally rests on the whole
 * layer, which for a shape drawn on a full-canvas layer puts every point far
 * from the shape. A fitted mesh rests on the shape instead (MeshWarpGrid.rest):
 *
 *  - 'shape': an even grid over the shape's bounds;
 *  - 'outline': a grid that follows the outline, its border running along
 *    the shape, so moving a border point moves that part of the outline.
 *
 * Content, mask and outline stay where they are: only the part of the layer
 * each mesh cell shows changes, so fitting never moves the picture.
 */

const CURVE_STEPS = 16;
/** Room left around the shape, as a share of its larger side, so its
 *  anti-aliased edge stays on the mesh. */
const FIT_MARGIN = 0.01;
const MIN_MARGIN = 0.002;

/** What a fitted mesh rests on; 'layer' is the whole layer. */
export type MeshFit = NonNullable<MeshWarpGrid['fit']>;
/** The fits that rest on the shape. */
export type ShapeMeshFit = Exclude<MeshFit, 'layer'>;

function cubicAt(a: Point2D, b: Point2D, c: Point2D, d: Point2D, t: number): Point2D {
  const s = 1 - t;
  return {
    x: s * s * s * a.x + 3 * s * s * t * b.x + 3 * s * t * t * c.x + t * t * t * d.x,
    y: s * s * s * a.y + 3 * s * s * t * b.y + 3 * s * t * t * c.y + t * t * t * d.y,
  };
}

/**
 * The closed Custom Shape outline a mesh can rest on, in layer UV (y up),
 * dense along curves; null when there is none. An inverted shape shows the
 * layer around it, so its mesh keeps covering the whole layer.
 */
export function fittableShapeOutline(shape: LayerShape | null | undefined): Point2D[] | null {
  if (!shape || shape.enabled === false || shape.type !== 'custom') return null;
  const { customPoints, customClosed, invert } = shape.params;
  if (!customClosed || invert || !customPoints || customPoints.length < 3) return null;
  const pts = customPoints as BezierPoint[];
  const outline: Point2D[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    if (!Number.isFinite(a?.x) || !Number.isFinite(a?.y)) return null;
    outline.push({ x: a.x, y: a.y });
    if (a.cpOut || b.cpIn) {
      const c1 = a.cpOut ?? a;
      const c2 = b.cpIn ?? b;
      for (let s = 1; s < CURVE_STEPS; s++) outline.push(cubicAt(a, c1, c2, b, s / CURVE_STEPS));
    }
  }
  // Drop repeated points: they carry no direction.
  const clean = outline.filter((p, i) => {
    const q = outline[(i + outline.length - 1) % outline.length];
    return Math.hypot(p.x - q.x, p.y - q.y) > 1e-7;
  });
  const b = boundsOf(clean);
  if (clean.length < 3 || b.maxX - b.minX < 1e-4 || b.maxY - b.minY < 1e-4) return null;
  return clean;
}

function boundsOf(points: Point2D[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

function marginFor(outline: Point2D[]): number {
  const b = boundsOf(outline);
  return Math.max(MIN_MARGIN, FIT_MARGIN * Math.max(b.maxX - b.minX, b.maxY - b.minY));
}

/** An even rest lattice over the outline's bounds. Row 0 is the top. */
export function shapeBoundsRest(outline: Point2D[], rows: number, cols: number): Point2D[][] {
  const b = boundsOf(outline);
  const m = marginFor(outline);
  const x0 = b.minX - m, x1 = b.maxX + m, y0 = b.minY - m, y1 = b.maxY + m;
  const rest: Point2D[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: Point2D[] = [];
    for (let c = 0; c < cols; c++) {
      row.push({ x: x0 + (x1 - x0) * (c / (cols - 1)), y: y1 - (y1 - y0) * (r / (rows - 1)) });
    }
    rest.push(row);
  }
  return rest;
}

function signedArea(points: Point2D[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

const cross = (o: Point2D, a: Point2D, b: Point2D) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** True when no cell folds. Rows run down and columns right with y up, so
 *  cells wind clockwise; a corner may be straight (a triangle's grid corner
 *  sits on an edge) but none may turn back. */
export function restLatticeIsValid(rest: Point2D[][]): boolean {
  for (let r = 0; r < rest.length - 1; r++) {
    for (let c = 0; c < rest[r].length - 1; c++) {
      const quad = [rest[r][c], rest[r][c + 1], rest[r + 1][c + 1], rest[r + 1][c]];
      let area = 0;
      for (let i = 0; i < 4; i++) {
        const prev = quad[(i + 3) % 4], at = quad[i], next = quad[(i + 1) % 4];
        const ax = at.x - prev.x, ay = at.y - prev.y, bx = next.x - at.x, by = next.y - at.y;
        const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
        if (la < 1e-7 || lb < 1e-7) return false;
        // Sine of the turn at this corner: negative turns right (clockwise).
        if ((ax * by - ay * bx) / (la * lb) > 0.02) return false;
        area += at.x * next.y - next.x * at.y;
      }
      if (area >= 0) return false;
    }
  }
  return true;
}

/** The convex hull, clockwise with y up (Andrew's monotone chain). */
function convexHull(points: Point2D[]): Point2D[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (sorted.length < 3) return sorted;
  const lower: Point2D[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Point2D[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1)).reverse();
}

/**
 * A rest lattice that follows the outline: its border runs along the
 * shape, its cells fill it. A concave outline whose inner corners would
 * fold the cells (an L, a crescent) is followed along its convex hull
 * instead, so the border spans those corners (`spansInnerCorners`); the
 * shape still masks the notch. Null only when even that folds.
 */
export function shapeOutlineRest(
  outline: Point2D[],
  rows: number,
  cols: number,
): { rest: Point2D[][]; spansInnerCorners: boolean } | null {
  const rest = outlineLattice(outline, rows, cols);
  if (rest) return { rest, spansInnerCorners: false };
  const hull = convexHull(outline);
  const spanned = hull.length >= 3 ? outlineLattice(hull, rows, cols) : null;
  return spanned ? { rest: spanned, spansInnerCorners: true } : null;
}

/**
 * The outline is split into four sides at the points nearest its bounds'
 * corners, the sides are sampled by length (on its sharp corners first),
 * and the inside is filled by transfinite (Coons) interpolation, then
 * relaxed. The border is pushed just past the outline between samples, so
 * no part of the shape falls off the mesh. Null when the cells fold.
 */
function outlineLattice(outline: Point2D[], rows: number, cols: number): Point2D[][] | null {
  if (rows < 2 || cols < 2 || outline.length < 3) return null;
  // Clockwise with y up: top edge left to right, then down the right side.
  const ring = signedArea(outline) > 0 ? [...outline].reverse() : [...outline];
  const n = ring.length;
  const b = boundsOf(ring);
  const nearest = (x: number, y: number) => {
    let best = 0, bestD = Infinity;
    ring.forEach((p, i) => {
      const d = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  };
  const iTL = nearest(b.minX, b.maxY);
  // Start the ring at the top-left corner.
  const P = ring.slice(iTL).concat(ring.slice(0, iTL));
  const arc: number[] = [0];
  for (let i = 1; i <= n; i++) {
    const a = P[i - 1], q = P[i % n];
    arc.push(arc[i - 1] + Math.hypot(q.x - a.x, q.y - a.y));
  }
  const total = arc[n];
  if (!(total > 0)) return null;
  const at = (s: number): Point2D => {
    const t = ((s % total) + total) % total;
    let lo = 0, hi = n;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (arc[mid] <= t) lo = mid; else hi = mid;
    }
    const a = P[lo], q = P[(lo + 1) % n];
    const span = arc[lo + 1] - arc[lo];
    const f = span > 0 ? (t - arc[lo]) / span : 0;
    return { x: a.x + (q.x - a.x) * f, y: a.y + (q.y - a.y) * f };
  };
  const shift = (i: number) => (i - iTL + n) % n;
  // Sharp corners of the outline (not the steps along a curve), by where
  // they sit along it. Border points land on them, so a polygon's border
  // runs along its edges instead of cutting its corners.
  // Outer (convex) corners rank first: a border that cuts one leaves part of
  // the shape off the mesh, while cutting an inner corner only adds room.
  const sharp: Array<{ s: number; rank: number }> = [];
  for (let i = 0; i < n; i++) {
    const a = P[(i + n - 1) % n], o = P[i], q = P[(i + 1) % n];
    const ax = o.x - a.x, ay = o.y - a.y, bx = q.x - o.x, by = q.y - o.y;
    const turn = Math.atan2(ax * by - ay * bx, ax * bx + ay * by);
    if (Math.abs(turn) > Math.PI / 9) sharp.push({ s: arc[i], rank: (turn < 0 ? 10 : 0) + Math.abs(turn) });
  }
  const snap = (s: number, lo: number, hi: number) => {
    let best = s, bestD = Infinity;
    for (const { s: a } of sharp) {
      if (a <= lo || a > hi) continue;
      const d = Math.abs(a - s);
      if (d < bestD) { bestD = d; best = a; }
    }
    return best;
  };
  let aTR = arc[shift(nearest(b.maxX, b.maxY))];
  let aBR = arc[shift(nearest(b.maxX, b.minY))];
  let aBL = arc[shift(nearest(b.minX, b.minY))];
  // Corners that coincide or come out of order (a triangle's apex is
  // nearest two corners of its bounds): split the length in four instead,
  // moving each split onto a sharp corner nearby.
  if (!(aTR > 0 && aBR > aTR && aBL > aBR && aBL < total)) {
    const reach = total / 8;
    aTR = snap(total / 4, total / 4 - reach, total / 4 + reach);
    aBR = snap(total / 2, Math.max(aTR, total / 2 - reach), total / 2 + reach);
    aBL = snap((3 * total) / 4, Math.max(aBR, (3 * total) / 4 - reach), (3 * total) / 4 + reach);
  }
  // Points along one side: on its sharp corners first (as many as the side
  // has inner points, best ranked first), the rest spread evenly over the
  // stretches between them by length.
  const side = (from: number, to: number, count: number): number[] => {
    const inner = count - 2;
    const pinned = sharp
      .filter(({ s: a }) => a > from + 1e-9 && a < to - 1e-9)
      .sort((p, q) => q.rank - p.rank)
      .slice(0, inner)
      .map(({ s: a }) => a)
      .sort((p, q) => p - q);
    const stops = [from, ...pinned, to];
    const spare = inner - pinned.length;
    const spans = stops.slice(1).map((s, k) => s - stops[k]);
    const length = to - from;
    // Spare points per stretch, by largest remainder.
    const share = spans.map((span) => (length > 0 ? (spare * span) / length : 0));
    const given = share.map(Math.floor);
    let left = spare - given.reduce((sum, g) => sum + g, 0);
    share.map((x, k) => ({ k, r: x - Math.floor(x) })).sort((p, q) => q.r - p.r)
      .forEach(({ k }) => { if (left > 0) { given[k]++; left--; } });
    const out: number[] = [from];
    spans.forEach((span, k) => {
      for (let j = 1; j <= given[k]; j++) out.push(stops[k] + (span * j) / (given[k] + 1));
      out.push(stops[k + 1]);
    });
    return out;
  };
  const topS = side(0, aTR, cols);
  const rightS = side(aTR, aBR, rows);
  const bottomS = side(aBR, aBL, cols);
  const leftS = side(aBL, total, rows);

  // The border as the ring walks it: top row left to right, right column
  // down, bottom row right to left, left column up. Each entry remembers
  // where it sits along the outline.
  type Border = { row: number; col: number; s: number };
  const border: Border[] = [];
  for (let c = 0; c < cols - 1; c++) border.push({ row: 0, col: c, s: topS[c] });
  for (let r = 0; r < rows - 1; r++) border.push({ row: r, col: cols - 1, s: rightS[r] });
  for (let c = cols - 1; c > 0; c--) border.push({ row: rows - 1, col: c, s: bottomS[cols - 1 - c] });
  for (let r = rows - 1; r > 0; r--) border.push({ row: r, col: 0, s: leftS[rows - 1 - r] });

  const rest: Point2D[][] = Array.from({ length: rows }, () => Array.from({ length: cols }, () => ({ x: 0, y: 0 })));
  const placed = border.map((entry) => at(entry.s));

  // Push the border out past the outline: each border edge must clear the
  // stretch of outline it spans (its sagitta), plus the margin.
  const margin = marginFor(ring);
  const m = border.length;
  const edgeNormal: Point2D[] = [];
  const edgeClear: number[] = [];
  for (let k = 0; k < m; k++) {
    const A = placed[k], B = placed[(k + 1) % m];
    const len = Math.hypot(B.x - A.x, B.y - A.y) || 1;
    // Outward is the left of travel for a clockwise ring with y up.
    const nx = -(B.y - A.y) / len, ny = (B.x - A.x) / len;
    edgeNormal.push({ x: nx, y: ny });
    const s0 = border[k].s;
    const s1 = k + 1 < m ? border[k + 1].s : total;
    let clear = 0;
    for (let i = 0; i < n; i++) {
      if (arc[i] <= s0 || arc[i] >= s1) continue;
      clear = Math.max(clear, (P[i].x - A.x) * nx + (P[i].y - A.y) * ny);
    }
    edgeClear.push(clear + margin);
  }
  for (let k = 0; k < m; k++) {
    const prev = (k + m - 1) % m;
    const n0 = edgeNormal[prev], n1 = edgeNormal[k];
    let nx = n0.x + n1.x, ny = n0.y + n1.y;
    const len = Math.hypot(nx, ny);
    if (len < 1e-6) { nx = n1.x; ny = n1.y; } else { nx /= len; ny /= len; }
    const need = Math.max(edgeClear[prev], edgeClear[k]);
    // Move far enough along the bisector that both edges move out by `need`.
    const facing = Math.max(0.5, Math.min(nx * n0.x + ny * n0.y, nx * n1.x + ny * n1.y));
    const out = Math.min(2 * need, need / facing);
    rest[border[k].row][border[k].col] = { x: placed[k].x + nx * out, y: placed[k].y + ny * out };
  }

  // Inside: Coons patch of the four sides.
  const TL = rest[0][0], TR = rest[0][cols - 1], BL = rest[rows - 1][0], BR = rest[rows - 1][cols - 1];
  for (let r = 1; r < rows - 1; r++) {
    const t = r / (rows - 1);
    for (let c = 1; c < cols - 1; c++) {
      const s = c / (cols - 1);
      const top = rest[0][c], bottom = rest[rows - 1][c], left = rest[r][0], right = rest[r][cols - 1];
      rest[r][c] = {
        x: (1 - t) * top.x + t * bottom.x + (1 - s) * left.x + s * right.x
          - ((1 - s) * (1 - t) * TL.x + s * (1 - t) * TR.x + (1 - s) * t * BL.x + s * t * BR.x),
        y: (1 - t) * top.y + t * bottom.y + (1 - s) * left.y + s * right.y
          - ((1 - s) * (1 - t) * TL.y + s * (1 - t) * TR.y + (1 - s) * t * BL.y + s * t * BR.y),
      };
    }
  }
  // Relax the inside (the border stays) with Winslow smoothing: the grid
  // lines settle as if the shape were a stretched square, which keeps the
  // cells of a concave outline from folding where a plain Coons fill or an
  // averaging pass would fold them.
  const relax = (iterations: number) => {
    for (let it = 0; it < iterations; it++) {
      for (let r = 1; r < rows - 1; r++) {
        for (let c = 1; c < cols - 1; c++) {
          const e = rest[r][c + 1], w = rest[r][c - 1], nn = rest[r - 1][c], ss = rest[r + 1][c];
          const ne = rest[r - 1][c + 1], nw = rest[r - 1][c - 1], se = rest[r + 1][c + 1], sw = rest[r + 1][c - 1];
          const xu = (e.x - w.x) / 2, yu = (e.y - w.y) / 2;
          const xv = (ss.x - nn.x) / 2, yv = (ss.y - nn.y) / 2;
          const alpha = xv * xv + yv * yv;
          const beta = xu * xv + yu * yv;
          const gamma = xu * xu + yu * yu;
          const denom = 2 * (alpha + gamma);
          if (!(denom > 1e-14)) continue;
          rest[r][c] = {
            x: (alpha * (e.x + w.x) + gamma * (ss.x + nn.x) - (beta / 2) * (se.x - ne.x - sw.x + nw.x)) / denom,
            y: (alpha * (e.y + w.y) + gamma * (ss.y + nn.y) - (beta / 2) * (se.y - ne.y - sw.y + nw.y)) / denom,
          };
        }
      }
    }
  };
  relax(30);
  for (let round = 0; round < 6 && !restLatticeIsValid(rest); round++) relax(60);
  return restLatticeIsValid(rest) ? rest : null;
}

/** A mesh lying on `rest`, unwarped. */
export function meshOnRest(rest: Point2D[][], fit: ShapeMeshFit, bezier?: boolean): MeshWarpGrid {
  const grid: MeshWarpGrid = {
    rows: rest.length,
    cols: rest[0].length,
    points: rest.map((row) => row.map((p) => ({ x: p.x, y: p.y }))),
    rest: rest.map((row) => row.map((p) => ({ x: p.x, y: p.y }))),
    fit,
  };
  if (bezier) grid.bezier = true;
  return grid;
}

/**
 * A fresh, unwarped mesh of `rows` x `cols` for a layer with `shape`, fitted
 * as asked when the shape allows it ('layer' and null give the even grid
 * over the whole layer, 'layer' remembering it was chosen). An outline that cannot be followed
 * without folding gets the shape's bounds instead (`fitted` says which).
 * `spansInnerCorners` says an outline fit runs across inner corners.
 */
export function fittedMeshGrid(
  shape: LayerShape | null | undefined,
  rows: number,
  cols: number,
  fit: MeshFit | null,
  bezier?: boolean,
): { grid: MeshWarpGrid; fitted: ShapeMeshFit | null; spansInnerCorners?: boolean } {
  const outline = fit === 'shape' || fit === 'outline' ? fittableShapeOutline(shape) : null;
  if (outline && fit === 'outline') {
    const fitted = shapeOutlineRest(outline, rows, cols);
    if (fitted) {
      return { grid: meshOnRest(fitted.rest, 'outline', bezier), fitted: 'outline', spansInnerCorners: fitted.spansInnerCorners };
    }
  }
  if (outline) return { grid: meshOnRest(shapeBoundsRest(outline, rows, cols), 'shape', bezier), fitted: 'shape' };
  const plain: MeshWarpGrid = createMeshGrid(rows, cols);
  if (bezier) plain.bezier = true;
  if (fit === 'layer') plain.fit = 'layer';
  return { grid: plain, fitted: null };
}

/**
 * Keep a resting fitted mesh on its shape. When the shape changes while the
 * mesh is unwarped, the mesh is fitted again; a shape that can no longer
 * hold a mesh (opened, inverted, removed) gives the whole layer back. A
 * warped mesh is the user's work and stays as it is.
 */
export function refitRestingMesh(
  grid: MeshWarpGrid | null | undefined,
  shape: LayerShape | null | undefined,
): MeshWarpGrid | null | undefined {
  if (!grid?.fit || grid.fit === 'layer' || !isIdentityMeshGrid(grid)) return grid;
  // Tangents kept while Bezier is off are work too.
  if (grid.tangents?.some((row) => row?.some(Boolean))) return grid;
  return fittedMeshGrid(shape, grid.rows, grid.cols, grid.fit, grid.bezier).grid;
}
