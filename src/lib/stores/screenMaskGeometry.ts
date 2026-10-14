/**
 * screenMaskGeometry.ts — where a screen's masks land on the editor canvas.
 *
 * Masks are stored in the screen's own content space (0..1, y=0 at the
 * top) and the Screen shaders (blendRenderer's slice pass and the Screen
 * window's WebGPU pass) cut them from the projector's frame after the crop
 * and warp have been resolved. To draw them on the editor canvas the
 * overlay runs the same forward map those shaders run, in the editor's
 * y-down frame: rect crop, corner quad, or per-cell mesh (Coons patches on
 * a Bezier mesh). The inverse map turns a canvas click back into a vertex.
 *
 * Ported from 2.0, where the native core does the cutting; the limits and
 * the flattening rule are unchanged so a project moves between the two.
 */

import type { OutputSlice, ScreenMask } from './settings';
import type { BezierPoint, Point2D } from '../types';
import { MESH_CURVE_SEGMENTS, evaluateMeshCell, invertMeshByRows, meshEdgePoint } from '../utils/meshWarp';

export type ScreenGeometry = Pick<
  OutputSlice,
  'cropX' | 'cropY' | 'cropW' | 'cropH' | 'warpMode' | 'corners' | 'meshGrid'
>;

function lerp(a: Point2D, b: Point2D, t: number): Point2D {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function bilinear(tl: Point2D, tr: Point2D, br: Point2D, bl: Point2D, u: number, v: number): Point2D {
  return lerp(lerp(tl, tr, u), lerp(bl, br, u), v);
}

function cross(a: Point2D, b: Point2D): number {
  return a.x * b.y - a.y * b.x;
}

/** Solve the (u, v) inside quad a, b, c, d (TL, TR, BR, BL) that maps to
 *  `p`. Values outside 0..1 mean `p` is outside the quad. Same solver as
 *  the slice shader's invBilinear. */
export function inverseBilinear(p: Point2D, a: Point2D, b: Point2D, c: Point2D, d: Point2D): Point2D {
  const e = { x: b.x - a.x, y: b.y - a.y };
  const f = { x: d.x - a.x, y: d.y - a.y };
  const g = { x: a.x - b.x + c.x - d.x, y: a.y - b.y + c.y - d.y };
  const h = { x: p.x - a.x, y: p.y - a.y };
  const k2 = cross(g, f);
  const k1 = cross(e, f) + cross(h, g);
  const k0 = cross(h, e);
  let v = -1;
  if (Math.abs(k2) < 1e-6) {
    if (Math.abs(k1) < 1e-6) return { x: -1, y: -1 };
    v = -k0 / k1;
  } else {
    const discriminant = k1 * k1 - 4 * k0 * k2;
    if (discriminant < 0) return { x: -1, y: -1 };
    const root = Math.sqrt(discriminant);
    const v0 = (-k1 - root) / (2 * k2);
    const v1 = (-k1 + root) / (2 * k2);
    v = v0 >= 0 && v0 <= 1 ? v0 : v1;
  }
  const denomX = e.x + g.x * v;
  const denomY = e.y + g.y * v;
  let u = -1;
  if (Math.abs(denomX) > 1e-6) u = (h.x - f.x * v) / denomX;
  else if (Math.abs(denomY) > 1e-6) u = (h.y - f.y * v) / denomY;
  return { x: u, y: v };
}

function meshCell(s: ScreenGeometry, row: number, col: number): [Point2D, Point2D, Point2D, Point2D] | null {
  const g = s.meshGrid;
  const tl = g?.points[row]?.[col];
  const tr = g?.points[row]?.[col + 1];
  const br = g?.points[row + 1]?.[col + 1];
  const bl = g?.points[row + 1]?.[col];
  return tl && tr && br && bl ? [tl, tr, br, bl] : null;
}

function meshUsable(s: ScreenGeometry): boolean {
  const g = s.meshGrid;
  return !!g && g.rows >= 2 && g.cols >= 2 && g.points.length >= g.rows;
}

type MeshGrid = NonNullable<ScreenGeometry['meshGrid']>;

/**
 * One mesh cell at (u, v), continued past the cell for the border cells.
 * Inside it is the cell itself (evaluateMeshCell). Outside, a straight cell
 * keeps its bilinear sheet. A Bezier cell's cubics would curl back within a
 * fraction of a cell, so it continues along its border instead: the
 * nearest border point plus the surface's derivatives there, including the
 * twist past a corner. That is C1 across the border, and on straight edges
 * it is exactly the bilinear sheet. The shaders only draw inside the screen,
 * so this only decides where mask handles off the screen are drawn.
 */
function continuedMeshCell(g: MeshGrid, row: number, col: number, u: number, v: number): Point2D {
  if (!g.bezier) return evaluateMeshCell(g, row, col, u, v);
  const uc = Math.max(0, Math.min(1, u));
  const vc = Math.max(0, Math.min(1, v));
  const du = u - uc;
  const dv = v - vc;
  if (du === 0 && dv === 0) return evaluateMeshCell(g, row, col, u, v);
  const at = (a: number, b: number) => evaluateMeshCell(g, row, col, a, b);
  // The cell is a polynomial, so central differences at the border are its
  // exact derivatives up to O(h^2).
  const h = 1e-4;
  const p = at(uc, vc);
  const pu = { x: (at(uc + h, vc).x - at(uc - h, vc).x) / (2 * h), y: (at(uc + h, vc).y - at(uc - h, vc).y) / (2 * h) };
  const pv = { x: (at(uc, vc + h).x - at(uc, vc - h).x) / (2 * h), y: (at(uc, vc + h).y - at(uc, vc - h).y) / (2 * h) };
  let x = p.x + du * pu.x + dv * pv.x;
  let y = p.y + du * pu.y + dv * pv.y;
  if (du !== 0 && dv !== 0) {
    const pp = at(uc + h, vc + h), pm = at(uc + h, vc - h), mp = at(uc - h, vc + h), mm = at(uc - h, vc - h);
    x += du * dv * (pp.x - pm.x - mp.x + mm.x) / (4 * h * h);
    y += du * dv * (pp.y - pm.y - mp.y + mm.y) / (4 * h * h);
  }
  return { x, y };
}

/** Screen content space (0..1, y down) -> master canvas (0..1, y down). */
export function screenContentToCanvas(s: ScreenGeometry, p: Point2D): Point2D {
  const mode = s.warpMode ?? 'rect';
  if (mode === 'corners' && s.corners) {
    const c = s.corners;
    return bilinear(c.topLeft, c.topRight, c.bottomRight, c.bottomLeft, p.x, p.y);
  }
  if (mode === 'mesh' && meshUsable(s)) {
    const g = s.meshGrid!;
    const fx = p.x * (g.cols - 1);
    const fy = p.y * (g.rows - 1);
    const col = Math.max(0, Math.min(g.cols - 2, Math.floor(fx)));
    const row = Math.max(0, Math.min(g.rows - 2, Math.floor(fy)));
    const cell = meshCell(s, row, col);
    if (cell) {
      // A Bezier mesh samples its cells as Coons patches (slice_warp_uv).
      if (g.bezier) return continuedMeshCell(g, row, col, fx - col, fy - row);
      return bilinear(cell[0], cell[1], cell[2], cell[3], fx - col, fy - row);
    }
  }
  return { x: s.cropX + p.x * s.cropW, y: s.cropY + p.y * s.cropH };
}

/** Both (u, v) that the bilinear map of quad a, b, c, d (TL, TR, BR, BL)
 *  sends to `p`, the map continued past the quad (u, v outside 0..1). One
 *  when the quad is a parallelogram along v, none past a fold. */
function bilinearRoots(p: Point2D, a: Point2D, b: Point2D, c: Point2D, d: Point2D): Point2D[] {
  const e = { x: b.x - a.x, y: b.y - a.y };
  const f = { x: d.x - a.x, y: d.y - a.y };
  const g = { x: a.x - b.x + c.x - d.x, y: a.y - b.y + c.y - d.y };
  const h = { x: p.x - a.x, y: p.y - a.y };
  const k2 = cross(g, f);
  const k1 = cross(e, f) + cross(h, g);
  const k0 = cross(h, e);
  const vs: number[] = [];
  if (Math.abs(k2) < 1e-12) {
    if (Math.abs(k1) < 1e-12) return [];
    vs.push(-k0 / k1);
  } else {
    const discriminant = k1 * k1 - 4 * k0 * k2;
    if (discriminant < 0) return [];
    const root = Math.sqrt(discriminant);
    vs.push((-k1 - root) / (2 * k2), (-k1 + root) / (2 * k2));
  }
  const out: Point2D[] = [];
  for (const v of vs) {
    const denomX = e.x + g.x * v;
    const denomY = e.y + g.y * v;
    const u = Math.abs(denomX) >= Math.abs(denomY) ? (h.x - f.x * v) / denomX : (h.y - f.y * v) / denomY;
    if (Number.isFinite(u) && Number.isFinite(v)) out.push({ x: u, y: v });
  }
  return out;
}

/** Newton on one mesh cell's continued surface (continuedMeshCell, as the
 *  forward map draws it), with no clamp to the cell. */
function newtonCellExtended(g: MeshGrid, row: number, col: number, q: Point2D, start: Point2D): Point2D | null {
  let u = start.x;
  let v = start.y;
  const h = 1e-6;
  for (let i = 0; i < 40; i++) {
    const p = continuedMeshCell(g, row, col, u, v);
    const rx = p.x - q.x;
    const ry = p.y - q.y;
    if (rx * rx + ry * ry < 1e-24) break;
    const pu = continuedMeshCell(g, row, col, u + h, v);
    const pv = continuedMeshCell(g, row, col, u, v + h);
    const dux = (pu.x - p.x) / h, duy = (pu.y - p.y) / h;
    const dvx = (pv.x - p.x) / h, dvy = (pv.y - p.y) / h;
    const det = dux * dvy - dvx * duy;
    if (Math.abs(det) < 1e-14) return null;
    let du = (rx * dvy - ry * dvx) / det;
    let dv = (dux * ry - duy * rx) / det;
    // Damp long steps so a guess far out on a curved edge cannot jump to
    // another branch of the cubic.
    const step = Math.hypot(du, dv);
    if (step > 0.5) { du *= 0.5 / step; dv *= 0.5 / step; }
    u -= du;
    v -= dv;
    if (Math.abs(u) > 64 || Math.abs(v) > 64) return null;
  }
  const p = continuedMeshCell(g, row, col, u, v);
  return (p.x - q.x) ** 2 + (p.y - q.y) ** 2 < 1e-16 ? { x: u, y: v } : null;
}

const EXTRAPOLATE_EPSILON = 1e-9;

/** Orientation of a cell's continued surface at (u, v): the sign of its
 *  Jacobian. It flips across a fold of the continuation. */
function cellOrientation(g: MeshGrid, row: number, col: number, u: number, v: number): number {
  const h = 1e-5;
  const p = continuedMeshCell(g, row, col, u, v);
  const pu = continuedMeshCell(g, row, col, u + h, v);
  const pv = continuedMeshCell(g, row, col, u, v + h);
  return Math.sign((pu.x - p.x) * (pv.y - p.y) - (pu.y - p.y) * (pv.x - p.x));
}

/**
 * Grid position of a canvas point outside a mesh screen. The forward map
 * (screenContentToCanvas) continues its border cells outward: past the
 * left edge it evaluates column 0 at u < 0, past the corner the corner
 * cell at u, v < 0, and so on (continuedMeshCell). This inverts exactly
 * that, so forward(inverse(p)) lands back on p: every border cell is solved on its
 * continued surface (closed form for a straight cell, Newton from the
 * bilinear guess for a Bezier one) and a solution only counts where the
 * forward map would pick that same cell and on the same side of any fold
 * as the cell itself (a root past a fold would jump the handle across the
 * screen). Of those, the one nearest its cell wins. Null only past a fold
 * of the continued surface, where no position maps to `p` continuously.
 */
function extrapolateMeshInverse(s: ScreenGeometry, p: Point2D): Point2D | null {
  const g = s.meshGrid!;
  const lastRow = g.rows - 2;
  const lastCol = g.cols - 2;
  let best: Point2D | null = null;
  let bestOut = Infinity;
  for (let row = 0; row <= lastRow; row++) {
    for (let col = 0; col <= lastCol; col++) {
      if (row !== 0 && row !== lastRow && col !== 0 && col !== lastCol) continue;
      const cell = meshCell(s, row, col);
      if (!cell) continue;
      const roots = bilinearRoots(p, cell[0], cell[1], cell[2], cell[3]);
      const orientation = cellOrientation(g, row, col, 0.5, 0.5);
      const candidates: Point2D[] = [];
      if (!g.bezier) candidates.push(...roots);
      else {
        const seeds = roots.length ? roots : [{ x: 0.5, y: 0.5 }];
        for (const seed of seeds) {
          const start = { x: Math.max(-4, Math.min(5, seed.x)), y: Math.max(-4, Math.min(5, seed.y)) };
          const hit = newtonCellExtended(g, row, col, p, start);
          if (hit) candidates.push(hit);
        }
      }
      for (const t of candidates) {
        const e = EXTRAPOLATE_EPSILON;
        if ((t.x < -e && col !== 0) || (t.x > 1 + e && col !== lastCol)) continue;
        if ((t.y < -e && row !== 0) || (t.y > 1 + e && row !== lastRow)) continue;
        const out = Math.hypot(Math.max(0, -t.x, t.x - 1), Math.max(0, -t.y, t.y - 1));
        if (out >= bestOut) continue;
        if (out > 0 && cellOrientation(g, row, col, t.x, t.y) !== orientation) continue;
        bestOut = out;
        best = { x: (col + t.x) / (g.cols - 1), y: (row + t.y) / (g.rows - 1) };
      }
    }
  }
  return best;
}

/** Master canvas (0..1, y down) -> screen content space. Outside the
 *  screen the result runs past 0..1, continuing the warp the way the
 *  forward map does (rect, corners and mesh alike), so a handle dragged
 *  off the screen keeps following the cursor. Callers clamp when placing
 *  a vertex. Null only where the warp has no inverse at all (a folded
 *  quad or mesh); `extrapolate: false` also returns null for any point
 *  off a mesh, for callers that only care about the inside. */
export function canvasToScreenContent(s: ScreenGeometry, p: Point2D, options: { extrapolate?: boolean } = {}): Point2D | null {
  const extrapolate = options.extrapolate ?? true;
  const mode = s.warpMode ?? 'rect';
  if (mode === 'corners' && s.corners) {
    const c = s.corners;
    const q = inverseBilinear(p, c.topLeft, c.topRight, c.bottomRight, c.bottomLeft);
    return q.x < -0.5 && q.y < -0.5 ? null : q;
  }
  if (mode === 'mesh' && meshUsable(s)) {
    const g = s.meshGrid!;
    let inside: Point2D | null = null;
    if (g.bezier) inside = invertMeshByRows(g, p);
    else {
      for (let row = 0; row < g.rows - 1 && !inside; row++) {
        for (let col = 0; col < g.cols - 1; col++) {
          const cell = meshCell(s, row, col);
          if (!cell) continue;
          const t = inverseBilinear(p, cell[0], cell[1], cell[2], cell[3]);
          if (t.x >= 0 && t.x <= 1 && t.y >= 0 && t.y <= 1) {
            inside = { x: (col + t.x) / (g.cols - 1), y: (row + t.y) / (g.rows - 1) };
            break;
          }
        }
      }
    }
    if (inside || !extrapolate) return inside;
    return extrapolateMeshInverse(s, p);
  }
  return {
    x: (p.x - s.cropX) / Math.max(1e-6, s.cropW),
    y: (p.y - s.cropY) / Math.max(1e-6, s.cropH),
  };
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// ─── Curved edges ───────────────────────────────────────────────────────
// A curved mask edge is cut as a polyline that stays within this distance
// of the true cubic, in screen UV (under half a pixel on a 4K projector).
// The Screen shaders cut exactly this polygon (packScreenMasks below
// flattens it), so the editor preview and the projector match.
export const SCREEN_MASK_CURVE_TOLERANCE = 1 / 8192;
export const SCREEN_MASK_CURVE_MAX_SEGMENTS = 64;
/** Flattened vertices one mask may use in the Screen shaders. */
export const SCREEN_MASK_FLAT_POINTS = 128;

function curveSegments(a: Point2D, c1: Point2D, c2: Point2D, b: Point2D, tolerance: number): number {
  // A cubic strays from its chord polyline by at most 3/4 of its largest
  // second difference over n^2.
  const d1x = a.x - 2 * c1.x + c2.x, d1y = a.y - 2 * c1.y + c2.y;
  const d2x = c1.x - 2 * c2.x + b.x, d2y = c1.y - 2 * c2.y + b.y;
  const dd = Math.max(Math.sqrt(d1x * d1x + d1y * d1y), Math.sqrt(d2x * d2x + d2y * d2y));
  const n = Math.ceil(Math.sqrt((0.75 * dd) / tolerance));
  return Math.max(1, Math.min(SCREEN_MASK_CURVE_MAX_SEGMENTS, Number.isFinite(n) ? n : 1));
}

/**
 * A mask's outline as the polygon the Screen shaders cut: its anchors (up to 32)
 * with each curved edge replaced by points along its cubic, spaced so the
 * polyline stays within SCREEN_MASK_CURVE_TOLERANCE. If that would need
 * more than SCREEN_MASK_FLAT_POINTS vertices the tolerance doubles until
 * it fits. A mask with no handles comes back as its plain vertex list.
 */
export function flattenScreenMask(points: readonly BezierPoint[]): Point2D[] {
  const anchors = points.slice(0, SCREEN_MASK_POINTS_PER_MASK);
  const count = anchors.length;
  if (count < 3) return anchors.map(p => ({ x: p.x, y: p.y }));
  const edges = anchors.map((a, i) => {
    const b = anchors[(i + 1) % count];
    return a.cpOut || b.cpIn ? { a, b, c1: a.cpOut ?? a, c2: b.cpIn ?? b } : null;
  });
  let tolerance = SCREEN_MASK_CURVE_TOLERANCE;
  let segments = edges.map(e => (e ? curveSegments(e.a, e.c1, e.c2, e.b, tolerance) : 1));
  for (let i = 0; i < 40 && segments.reduce((sum, n) => sum + n, 0) > SCREEN_MASK_FLAT_POINTS; i++) {
    tolerance *= 2;
    segments = edges.map(e => (e ? curveSegments(e.a, e.c1, e.c2, e.b, tolerance) : 1));
  }
  const out: Point2D[] = [];
  anchors.forEach((a, i) => {
    out.push({ x: a.x, y: a.y });
    const e = edges[i];
    if (!e) return;
    const n = segments[i];
    for (let k = 1; k < n; k++) {
      const t = k / n;
      const mt = 1 - t;
      const w0 = mt * mt * mt, w1 = 3 * mt * mt * t, w2 = 3 * mt * t * t, w3 = t * t * t;
      out.push({
        x: w0 * e.a.x + w1 * e.c1.x + w2 * e.c2.x + w3 * e.b.x,
        y: w0 * e.a.y + w1 * e.c1.y + w2 * e.c2.y + w3 * e.b.y,
      });
    }
  });
  return out;
}

// The preview shades every pixel, so each mask's polygon is flattened once
// per edit. Masks are rebuilt (never mutated) on every edit, so the points
// array identifies the shape.
const flattenedMasks = new WeakMap<readonly BezierPoint[], { pts: Point2D[]; bounds: [number, number, number, number] }>();

/** Slack around a mask's bounds before a pixel is rejected without the
 *  polygon test; far above rounding, far below a pixel. Same in the shaders. */
export const SCREEN_MASK_BOUNDS_PAD = 1e-3;

function flattenedMask(points: readonly BezierPoint[]) {
  let entry = flattenedMasks.get(points);
  if (!entry) {
    const pts = flattenScreenMask(points);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) {
      x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
    }
    entry = { pts, bounds: [x0 - SCREEN_MASK_BOUNDS_PAD, y0 - SCREEN_MASK_BOUNDS_PAD, x1 + SCREEN_MASK_BOUNDS_PAD, y1 + SCREEN_MASK_BOUNDS_PAD] };
    flattenedMasks.set(points, entry);
  }
  return entry;
}

/** Coverage of one mask polygon at `uv` (screen content space). Mirrors
 *  screenMaskCoverage in the Screen shaders: a bounds reject, even-odd ray
 *  crossing, then a smoothstep ramp over `feather` measured inward from the
 *  nearest edge. Curved edges are cut as their flattened polyline. */
function screenMaskCoverage(mask: ScreenMask, uv: Point2D): number {
  const { pts, bounds } = flattenedMask(mask.points);
  const count = pts.length;
  if (count < 3) return 0;
  // Outside the polygon's bounds there is no crossing to count.
  if (uv.x < bounds[0] || uv.y < bounds[1] || uv.x > bounds[2] || uv.y > bounds[3]) return 0;
  let inside = false;
  for (let i = 0; i < count; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % count];
    if ((a.y <= uv.y && b.y > uv.y) || (a.y > uv.y && b.y <= uv.y)) {
      const x = (b.x - a.x) * (uv.y - a.y) / (b.y - a.y) + a.x;
      if (uv.x < x) inside = !inside;
    }
  }
  if (!inside) return 0;
  const feather = Math.max(0, Math.min(1, mask.feather || 0));
  if (feather <= 0.001) return 1;
  // The edge distance only matters inside a feathered mask, so the preview
  // skips it everywhere else (the result is the same).
  let minEdge2 = 1e6;
  for (let i = 0; i < count; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % count];
    const bax = b.x - a.x, bay = b.y - a.y, pax = uv.x - a.x, pay = uv.y - a.y;
    const h = Math.max(0, Math.min(1, (pax * bax + pay * bay) / Math.max(bax * bax + bay * bay, 1e-6)));
    const dx = pax - bax * h, dy = pay - bay * h;
    minEdge2 = Math.min(minEdge2, dx * dx + dy * dy);
  }
  return smoothstep(0, feather, Math.sqrt(minEdge2));
}

/** How much of a screen's picture survives at `uv` (screen content space),
 *  0..1. Mirrors screenMaskAlpha in the Screen shaders, including the caps
 *  they apply (8 masks, 32 vertices each): normal masks keep the
 *  union of their insides (no normal mask keeps everything), then each
 *  inverted mask cuts its hole. */
const activeMasks = new WeakMap<ScreenMask[], ScreenMask[]>();

export function screenMaskAlpha(masks: ScreenMask[] | null | undefined, uv: Point2D): number {
  let active = masks ? activeMasks.get(masks) : undefined;
  if (!active) {
    active = (masks ?? []).filter(screenMaskUsable).slice(0, SCREEN_MASK_MAX);
    if (masks) activeMasks.set(masks, active);
  }
  if (active.length === 0) return 1;
  let keep = active.some(m => !m.invert) ? 0 : 1;
  let cut = 1;
  for (const mask of active) {
    const coverage = screenMaskCoverage(mask, uv);
    if (mask.invert) cut *= 1 - coverage;
    else keep = Math.max(keep, coverage);
  }
  return Math.max(0, Math.min(1, keep * cut));
}

// Same limits as 2.0's core (MAX_SCREEN_MASKS / SCREEN_MASK_POINTS_PER_MASK).
export const SCREEN_MASK_MAX = 8;
export const SCREEN_MASK_POINTS_PER_MASK = 32;

function screenMaskUsable(mask: ScreenMask): boolean {
  return !!mask && mask.enabled !== false && Array.isArray(mask.points) && mask.points.length >= 3;
}

/** A mask's vertices on the master canvas, in order. */
export function screenMaskCanvasPoints(s: ScreenGeometry, mask: Pick<ScreenMask, 'points'>): Point2D[] {
  return mask.points.map((p) => screenContentToCanvas(s, p));
}

/** A mask's outline on the master canvas as drawn: curved edges follow
 *  their cubics (the flattened polygon the shaders cut). While a mask has
 *  fewer than 3 points it is an open path of its vertices. */
export function screenMaskCanvasOutline(s: ScreenGeometry, mask: Pick<ScreenMask, 'points'>): Point2D[] {
  const pts = mask.points.length >= 3 ? flattenScreenMask(mask.points) : mask.points;
  return pts.map((p) => screenContentToCanvas(s, p));
}

/** The screen's own outline on the master canvas (the region its masks
 *  are cut from). The mesh outline walks the grid's border cells. */
export function screenOutlineCanvasPoints(s: ScreenGeometry): Point2D[] {
  const mode = s.warpMode ?? 'rect';
  if (mode === 'mesh' && meshUsable(s)) {
    const g = s.meshGrid!;
    const out: Point2D[] = [];
    if (g.bezier) {
      // Walk the curved border edges, each sampled along its cubic. Edges
      // are defined toward the next column / row, so the bottom and left
      // sides are sampled backwards.
      const edge = (r0: number, c0: number, r1: number, c1: number, backwards: boolean) => {
        for (let i = 0; i < MESH_CURVE_SEGMENTS; i++) {
          const t = i / MESH_CURVE_SEGMENTS;
          out.push(meshEdgePoint(g, r0, c0, r1, c1, backwards ? 1 - t : t));
        }
      };
      for (let col = 0; col < g.cols - 1; col++) edge(0, col, 0, col + 1, false);
      for (let row = 0; row < g.rows - 1; row++) edge(row, g.cols - 1, row + 1, g.cols - 1, false);
      for (let col = g.cols - 1; col > 0; col--) edge(g.rows - 1, col - 1, g.rows - 1, col, true);
      for (let row = g.rows - 1; row > 0; row--) edge(row - 1, 0, row, 0, true);
      return out;
    }
    for (let col = 0; col < g.cols; col++) out.push(g.points[0][col]);
    for (let row = 1; row < g.rows; row++) out.push(g.points[row][g.cols - 1]);
    for (let col = g.cols - 2; col >= 0; col--) out.push(g.points[g.rows - 1][col]);
    for (let row = g.rows - 2; row >= 1; row--) out.push(g.points[row][0]);
    return out.filter(Boolean);
  }
  return [
    screenContentToCanvas(s, { x: 0, y: 0 }),
    screenContentToCanvas(s, { x: 1, y: 0 }),
    screenContentToCanvas(s, { x: 1, y: 1 }),
    screenContentToCanvas(s, { x: 0, y: 1 }),
  ];
}

// ─── Shader packing ─────────────────────────────────────────────────────
/** A screen's masks as the Screen shaders read them. Mask m's flattened
 *  vertices sit at flat index m * SCREEN_MASK_FLAT_POINTS onwards, two per
 *  vec4 in `points` (WGSL: array<vec4, 512>; WebGL: a 64 x 8 RGBA float
 *  texture, one row per mask). Per mask, `info` is (first vertex, vertex
 *  count, feather, invert) and `bounds` the padded vertex bounds. */
export interface PackedScreenMasks {
  count: number;
  keepCount: number;
  info: Float32Array;   // SCREEN_MASK_MAX * 4
  bounds: Float32Array; // SCREEN_MASK_MAX * 4
  points: Float32Array; // SCREEN_MASK_MAX * SCREEN_MASK_FLAT_POINTS * 2
}

export const SCREEN_MASK_POINT_TEXELS = SCREEN_MASK_FLAT_POINTS / 2;

const packedMasks = new WeakMap<ScreenMask[], PackedScreenMasks>();
const NO_MASKS: PackedScreenMasks = {
  count: 0,
  keepCount: 0,
  info: new Float32Array(SCREEN_MASK_MAX * 4),
  bounds: new Float32Array(SCREEN_MASK_MAX * 4),
  points: new Float32Array(SCREEN_MASK_MAX * SCREEN_MASK_FLAT_POINTS * 2),
};

/** Pack once per edit: masks are rebuilt (never mutated) on every edit, so
 *  the array identifies the shapes and a render loop can call this each
 *  frame for free. */
export function packScreenMasks(masks: ScreenMask[] | null | undefined): PackedScreenMasks {
  if (!masks || masks.length === 0) return NO_MASKS;
  const cached = packedMasks.get(masks);
  if (cached) return cached;
  const active = masks.filter(screenMaskUsable).slice(0, SCREEN_MASK_MAX);
  const packed: PackedScreenMasks = {
    count: active.length,
    keepCount: active.filter(m => !m.invert).length,
    info: new Float32Array(SCREEN_MASK_MAX * 4),
    bounds: new Float32Array(SCREEN_MASK_MAX * 4),
    points: new Float32Array(SCREEN_MASK_MAX * SCREEN_MASK_FLAT_POINTS * 2),
  };
  active.forEach((mask, m) => {
    const { pts, bounds } = flattenedMask(mask.points);
    const n = Math.min(pts.length, SCREEN_MASK_FLAT_POINTS);
    const start = m * SCREEN_MASK_FLAT_POINTS;
    for (let i = 0; i < n; i++) {
      packed.points[(start + i) * 2] = pts[i].x;
      packed.points[(start + i) * 2 + 1] = pts[i].y;
    }
    packed.info.set([start, n, Math.max(0, Math.min(1, mask.feather || 0)), mask.invert ? 1 : 0], m * 4);
    packed.bounds.set(bounds, m * 4);
  });
  packedMasks.set(masks, packed);
  return packed;
}
