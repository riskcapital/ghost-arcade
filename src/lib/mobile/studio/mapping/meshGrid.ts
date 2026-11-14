/**
 * Warp geometry of one mapping surface: corner quads, mesh lattices of any
 * density from 2×2 to 9×9, and curved (cubic) cell edges.
 *
 * Points are in the output frame, normalised 0–1, y down, row-major with
 * row 0 at the top. A surface saved before densities existed has no `grid`
 * and nine points: it is a 3×3 lattice and renders exactly as it always did.
 *
 * Pure TypeScript, no DOM: it runs in the compositor, the editor and tests.
 */
import type { Point } from '../model';

export const MIN_MESH_SIDE = 2;
export const MAX_MESH_SIDE = 9;

export type GridSize = { cols: number; rows: number };
/** Cubic handles of one lattice point, as offsets from it. `right` and `down`
 *  lead to the next column and row. `left` / `up` are stored only once a
 *  handle is broken; while absent they mirror `right` / `down`. A point with
 *  nothing stored on an axis keeps that edge straight. */
export type MeshTangent = { right?: Point; down?: Point; left?: Point; up?: Point };

/** The parts of a surface its geometry depends on. */
export type WarpGeometry = {
  mode: 'corners' | 'mesh';
  points: Point[];
  grid?: GridSize;
  bezier?: boolean;
  tangents?: (MeshTangent | null)[];
};

const LEGACY: GridSize = { cols: 3, rows: 3 };
const side = (n: unknown) => Math.max(MIN_MESH_SIDE, Math.min(MAX_MESH_SIDE, Math.round(Number(n) || 3)));

/** The lattice size of a surface. Anything malformed reads as the original 3×3. */
export function gridOf(s: Pick<WarpGeometry, 'grid' | 'points'>): GridSize {
  const g = s.grid;
  if (g && g.cols * g.rows === s.points.length) return { cols: g.cols, rows: g.rows };
  return LEGACY;
}

export const clampGrid = (g: Partial<GridSize> | undefined): GridSize => ({ cols: side(g?.cols), rows: side(g?.rows) });

/** Indices of the four outer corners: top left, top right, bottom right, bottom left. */
export function cornerIndices(g: GridSize): [number, number, number, number] {
  return [0, g.cols - 1, g.cols * g.rows - 1, (g.rows - 1) * g.cols];
}

export function cornerPoints(s: WarpGeometry): [Point, Point, Point, Point] {
  const [a, b, c, d] = cornerIndices(gridOf(s));
  return [s.points[a], s.points[b], s.points[c], s.points[d]];
}

/** True when the outline of a lattice point is one of the four corners. */
export function isCorner(g: GridSize, index: number): boolean {
  return cornerIndices(g).includes(index);
}

const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const scale = (a: Point, k: number): Point => ({ x: a.x * k, y: a.y * k });
const finite = (p: Point | undefined | null): p is Point => !!p && Number.isFinite(p.x) && Number.isFinite(p.y);

/** A cols×rows lattice spread bilinearly between four corners (TL, TR, BR, BL). */
export function latticeFromCorners(c: [Point, Point, Point, Point], g: GridSize): Point[] {
  const [a, b, d, e] = c;
  return Array.from({ length: g.cols * g.rows }, (_, i) => {
    const u = (i % g.cols) / (g.cols - 1),
      v = Math.floor(i / g.cols) / (g.rows - 1);
    return lerp(lerp(a, b, u), lerp(e, d, u), v);
  });
}

/** Exact projective quadrilateral interpolation; never clips to the original rectangle. */
export function quadPoint(c: Point[], u: number, v: number): Point {
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
  return {
    x: ((b.x - a.x + g * b.x) * u + (e.x - a.x + h * e.x) * v + a.x) / den,
    y: ((b.y - a.y + g * b.y) * u + (e.y - a.y + h * e.y) * v + a.y) / den,
  };
}

// ── Curved edges ────────────────────────────────────────────────────────────

/** True when the surface draws curved cells: mesh mode, curves on, and at least one handle stored. */
export function hasCurves(s: WarpGeometry): boolean {
  if (s.mode !== 'mesh' || !s.bezier || !Array.isArray(s.tangents)) return false;
  return s.tangents.some((t) => !!t && (finite(t.right) || finite(t.down) || finite(t.left) || finite(t.up)));
}

export type ResolvedTangent = { right: Point; down: Point; left: Point; up: Point };

/** Every handle of one point as an explicit offset (see MeshTangent). A missing axis is a straight edge: a third of the chord. */
export function resolveTangent(s: WarpGeometry, index: number): ResolvedTangent {
  const g = gridOf(s);
  const col = index % g.cols,
    row = Math.floor(index / g.cols);
  const p = s.points[index];
  const stored = s.tangents?.[index] ?? null;
  const chord = (c: number, r: number): Point => {
    if (c < 0 || r < 0 || c >= g.cols || r >= g.rows) return { x: 0, y: 0 };
    return scale(sub(s.points[r * g.cols + c], p), 1 / 3);
  };
  const neg = (t: Point) => ({ x: -t.x, y: -t.y });
  return {
    right: finite(stored?.right) ? stored!.right! : finite(stored?.left) ? neg(stored!.left!) : chord(col + 1, row),
    left: finite(stored?.left) ? stored!.left! : finite(stored?.right) ? neg(stored!.right!) : chord(col - 1, row),
    down: finite(stored?.down) ? stored!.down! : finite(stored?.up) ? neg(stored!.up!) : chord(col, row + 1),
    up: finite(stored?.up) ? stored!.up! : finite(stored?.down) ? neg(stored!.down!) : chord(col, row - 1),
  };
}

function cubic(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const s = 1 - t;
  const w0 = s * s * s,
    w1 = 3 * s * s * t,
    w2 = 3 * s * t * t,
    w3 = t * t * t;
  return { x: w0 * p0.x + w1 * p1.x + w2 * p2.x + w3 * p3.x, y: w0 * p0.y + w1 * p1.y + w2 * p2.y + w3 * p3.y };
}

/** The four cubic controls of the edge from lattice point `a` to its right or lower neighbour `b`. */
export function edgeControls(s: WarpGeometry, a: number, b: number): [Point, Point, Point, Point] {
  const g = gridOf(s);
  const pa = s.points[a],
    pb = s.points[b];
  if (!hasCurves(s)) return [pa, lerp(pa, pb, 1 / 3), lerp(pa, pb, 2 / 3), pb];
  const ta = resolveTangent(s, a),
    tb = resolveTangent(s, b);
  const horizontal = b - a === 1 && Math.floor(a / g.cols) === Math.floor(b / g.cols);
  return horizontal ? [pa, add(pa, ta.right), add(pb, tb.left), pb] : [pa, add(pa, ta.down), add(pb, tb.up), pb];
}

export function edgePoint(s: WarpGeometry, a: number, b: number, t: number): Point {
  const [p0, p1, p2, p3] = edgeControls(s, a, b);
  return cubic(p0, p1, p2, p3, t);
}

/**
 * Bend one edge so it passes through `through` at its middle, keeping both
 * ends where they are. Returns the new tangents array (the handle on each
 * end along this edge; the opposite side is left to mirror it).
 */
export function bendEdge(s: WarpGeometry, a: number, b: number, through: Point): (MeshTangent | null)[] {
  const g = gridOf(s);
  const tangents = Array.from({ length: g.cols * g.rows }, (_, i) => (s.tangents?.[i] ? { ...s.tangents[i]! } : null));
  const pa = s.points[a],
    pb = s.points[b];
  // A symmetric cubic through `through` at t=.5: both handles reach k·(q - chord mid), k = 4/3.
  const mid = lerp(pa, pb, 0.5);
  const bulge = scale(sub(through, mid), 4 / 3);
  const handleA = add(scale(sub(pb, pa), 1 / 3), bulge);
  const handleB = add(scale(sub(pa, pb), 1 / 3), bulge);
  const horizontal = b - a === 1 && Math.floor(a / g.cols) === Math.floor(b / g.cols);
  const ta = (tangents[a] ??= {}),
    tb = (tangents[b] ??= {});
  if (horizontal) {
    ta.right = handleA;
    tb.left = handleB;
    // The handle on the far side of each end was mirroring this one: pin it so only this edge bends.
    if (!finite(ta.left) && a % g.cols > 0) ta.left = resolveTangent(s, a).left;
    if (!finite(tb.right) && b % g.cols < g.cols - 1) tb.right = resolveTangent(s, b).right;
  } else {
    ta.down = handleA;
    tb.up = handleB;
    if (!finite(ta.up) && a >= g.cols) ta.up = resolveTangent(s, a).up;
    if (!finite(tb.down) && b < g.cols * (g.rows - 1)) tb.down = resolveTangent(s, b).down;
  }
  return tangents;
}

/** Move the handle `side` of point `index` to `offset`; its opposite follows (smooth) unless `broken`. */
export function setHandle(s: WarpGeometry, index: number, sideName: keyof MeshTangent, offset: Point, broken = false): (MeshTangent | null)[] {
  const g = gridOf(s);
  const tangents = Array.from({ length: g.cols * g.rows }, (_, i) => (s.tangents?.[i] ? { ...s.tangents[i]! } : null));
  const t = (tangents[index] ??= {});
  const opposite: keyof MeshTangent = sideName === 'right' ? 'left' : sideName === 'left' ? 'right' : sideName === 'down' ? 'up' : 'down';
  t[sideName] = offset;
  if (!broken) {
    // Smooth: the opposite handle keeps its length and points the other way.
    const current = resolveTangent(s, index)[opposite];
    const length = Math.hypot(current.x, current.y) || Math.hypot(offset.x, offset.y);
    const along = Math.hypot(offset.x, offset.y) || 1;
    t[opposite] = { x: (-offset.x / along) * length, y: (-offset.y / along) * length };
  }
  return tangents;
}

// ── Evaluating the warp ─────────────────────────────────────────────────────

/** True for a surface saved before densities existed: it keeps its original two-triangle cells. */
export const isLegacyMesh = (s: WarpGeometry) => s.mode === 'mesh' && !s.grid && !hasCurves(s);

/**
 * Where content position (u, v) (0–1, v down) lands on the output. This is
 * the map the renderer draws: a projective quad in corner mode, bilinear
 * cells in a mesh, Coons patches bounded by the cubic edges when curved.
 */
export function evaluate(s: WarpGeometry, u: number, v: number): Point {
  const g = gridOf(s);
  if (s.mode === 'corners') return quadPoint(cornerPoints(s), u, v);
  const gx = Math.max(0, Math.min(g.cols - 1, u * (g.cols - 1)));
  const gy = Math.max(0, Math.min(g.rows - 1, v * (g.rows - 1)));
  const col = Math.min(g.cols - 2, Math.floor(gx)),
    row = Math.min(g.rows - 2, Math.floor(gy));
  const fu = gx - col,
    fv = gy - row;
  const ia = row * g.cols + col,
    ib = ia + 1,
    id = ia + g.cols,
    ic = id + 1;
  const a = s.points[ia],
    b = s.points[ib],
    c = s.points[ic],
    d = s.points[id];
  const bilinear = lerp(lerp(a, b, fu), lerp(d, c, fu), fv);
  if (!hasCurves(s)) return bilinear;
  const top = edgePoint(s, ia, ib, fu),
    bottom = edgePoint(s, id, ic, fu),
    left = edgePoint(s, ia, id, fv),
    right = edgePoint(s, ib, ic, fv);
  return {
    x: (1 - fv) * top.x + fv * bottom.x + (1 - fu) * left.x + fu * right.x - bilinear.x,
    y: (1 - fv) * top.y + fv * bottom.y + (1 - fu) * left.y + fu * right.y - bilinear.y,
  };
}

/**
 * The same surface on a lattice of another size, keeping its shape: every
 * new point is placed where the current warp puts it. Going to a size that
 * refines the old one (3→5→9, 2→anything) keeps every old point exactly.
 * Curves are carried over as handles that follow the old surface's slope.
 */
export function resample(s: WarpGeometry, next: GridSize): Pick<WarpGeometry, 'points' | 'grid' | 'tangents'> {
  const g = clampGrid(next);
  const points = Array.from({ length: g.cols * g.rows }, (_, i) => evaluate(s, (i % g.cols) / (g.cols - 1), Math.floor(i / g.cols) / (g.rows - 1)));
  if (!hasCurves(s)) return { points, grid: g, tangents: undefined };
  const du = 1 / (g.cols - 1),
    dv = 1 / (g.rows - 1),
    h = 1e-3;
  const slope = (u: number, v: number, alongU: boolean) => {
    const lo = Math.max(0, (alongU ? u : v) - h),
      hi = Math.min(1, (alongU ? u : v) + h);
    const p0 = alongU ? evaluate(s, lo, v) : evaluate(s, u, lo);
    const p1 = alongU ? evaluate(s, hi, v) : evaluate(s, u, hi);
    return scale(sub(p1, p0), 1 / Math.max(1e-6, hi - lo));
  };
  const tangents = points.map((_, i) => {
    const u = (i % g.cols) * du,
      v = Math.floor(i / g.cols) * dv;
    return { right: scale(slope(u, v, true), du / 3), down: scale(slope(u, v, false), dv / 3) };
  });
  return { points, grid: g, tangents };
}

// ── Triangles for the GPU ───────────────────────────────────────────────────

/** Sub-cells per lattice cell, so the warp looks smooth without costing much at 9×9. */
export function subdivisions(s: WarpGeometry): number {
  const g = gridOf(s);
  const cells = Math.max(g.cols, g.rows) - 1;
  return hasCurves(s) ? Math.max(3, Math.min(16, Math.ceil(40 / cells))) : Math.max(2, Math.min(12, Math.ceil(24 / cells)));
}

/** Triangles as x, y, u, v per vertex. `undefined` is the whole frame. */
export function tessellate(s?: WarpGeometry): Float32Array {
  const out: number[] = [];
  const quad = (p00: number[], p10: number[], p11: number[], p01: number[]) => out.push(...p00, ...p10, ...p11, ...p00, ...p11, ...p01);
  if (!s || s.mode === 'corners' || isLegacyMesh(s)) {
    // Unchanged from the original renderer: 16×16 projective cells, or 2×2 straight mesh cells.
    const legacy = !!s && s.mode === 'mesh';
    const n = legacy ? 2 : s ? 16 : 2;
    const corners = s && !legacy ? cornerPoints(s) : null;
    const vertex = (x: number, y: number) => {
      const u = x / n,
        v = y / n;
      const p = !s ? { x: u, y: v } : corners ? quadPoint(corners, u, v) : s.points[y * 3 + x];
      return [p.x, p.y, u, v];
    };
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) quad(vertex(x, y), vertex(x + 1, y), vertex(x + 1, y + 1), vertex(x, y + 1));
    return new Float32Array(out);
  }
  const g = gridOf(s);
  const k = subdivisions(s);
  const nx = (g.cols - 1) * k,
    ny = (g.rows - 1) * k;
  const row: number[][][] = [];
  for (let y = 0; y <= ny; y++) {
    const line: number[][] = [];
    for (let x = 0; x <= nx; x++) {
      const u = x / nx,
        v = y / ny;
      const p = evaluate(s, u, v);
      line.push([p.x, p.y, u, v]);
    }
    row.push(line);
  }
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) quad(row[y][x], row[y][x + 1], row[y + 1][x + 1], row[y + 1][x]);
  return new Float32Array(out);
}

// ── Lines for the editor ────────────────────────────────────────────────────

/** The closed outline, sampled finely enough for curves. Clockwise from the top-left corner. */
export function outline(s: WarpGeometry, perEdge = 12): Point[] {
  if (s.mode === 'corners') return cornerPoints(s);
  const g = gridOf(s);
  const curved = hasCurves(s);
  const samples = curved ? perEdge : 1;
  const out: Point[] = [];
  const walk = (indices: number[]) => {
    for (let k = 0; k < indices.length - 1; k++) {
      const a = indices[k],
        b = indices[k + 1];
      const forward = b > a;
      for (let j = 0; j < samples; j++) {
        const t = j / samples;
        out.push(forward ? edgePoint(s, a, b, t) : edgePoint(s, b, a, 1 - t));
      }
    }
  };
  const top = Array.from({ length: g.cols }, (_, c) => c);
  const right = Array.from({ length: g.rows }, (_, r) => r * g.cols + g.cols - 1);
  const bottom = Array.from({ length: g.cols }, (_, c) => (g.rows - 1) * g.cols + g.cols - 1 - c);
  const left = Array.from({ length: g.rows }, (_, r) => (g.rows - 1 - r) * g.cols);
  walk(top);
  walk(right);
  walk(bottom);
  walk(left);
  return out;
}

/** Inner lattice lines (each a polyline), for drawing the mesh. */
export function latticeLines(s: WarpGeometry, perEdge = 8): Point[][] {
  const g = gridOf(s);
  const samples = hasCurves(s) ? perEdge : 1;
  const lines: Point[][] = [];
  const line = (indices: number[]) => {
    const out: Point[] = [];
    for (let k = 0; k < indices.length - 1; k++) for (let j = 0; j < samples; j++) out.push(edgePoint(s, indices[k], indices[k + 1], j / samples));
    out.push(s.points[indices[indices.length - 1]]);
    lines.push(out);
  };
  for (let r = 1; r < g.rows - 1; r++) line(Array.from({ length: g.cols }, (_, c) => r * g.cols + c));
  for (let c = 1; c < g.cols - 1; c++) line(Array.from({ length: g.rows }, (_, r) => r * g.cols + c));
  return lines;
}

/** The lattice neighbours of a point, as [neighbour, side of `index` the edge leaves from]. */
export function neighbours(g: GridSize, index: number): { index: number; side: keyof MeshTangent }[] {
  const col = index % g.cols,
    row = Math.floor(index / g.cols);
  const out: { index: number; side: keyof MeshTangent }[] = [];
  if (col < g.cols - 1) out.push({ index: index + 1, side: 'right' });
  if (col > 0) out.push({ index: index - 1, side: 'left' });
  if (row < g.rows - 1) out.push({ index: index + g.cols, side: 'down' });
  if (row > 0) out.push({ index: index - g.cols, side: 'up' });
  return out;
}

/** Keep only well-formed handles for a lattice of `count` points. */
export function normalizeTangents(raw: unknown, count: number): (MeshTangent | null)[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const clean = (p: unknown): Point | undefined => {
    const q = p as Point;
    return finite(q) ? { x: Math.max(-2, Math.min(2, q.x)), y: Math.max(-2, Math.min(2, q.y)) } : undefined;
  };
  const out = Array.from({ length: count }, (_, i) => {
    const t = raw[i] as MeshTangent | null | undefined;
    if (!t || typeof t !== 'object') return null;
    const next: MeshTangent = {};
    for (const k of ['right', 'down', 'left', 'up'] as const) {
      const v = clean(t[k]);
      if (v) next[k] = v;
    }
    return Object.keys(next).length ? next : null;
  });
  return out.some(Boolean) ? out : undefined;
}
