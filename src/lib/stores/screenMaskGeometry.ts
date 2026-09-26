/**
 * screenMaskGeometry.ts — where a screen's masks land on the editor canvas.
 *
 * Masks are stored in the screen's own content space (0..1, y=0 at the
 * top) and the core cuts them from the projector's frame after the crop
 * and warp have been resolved. To draw them on the editor canvas the
 * overlay runs the same forward map the core's slice_warp_uv runs, in the
 * editor's y-down frame: rect crop, corner quad, or per-cell mesh. The
 * inverse map turns a canvas click back into a mask vertex.
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
 *  the core's inverse_bilinear. */
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
      if (g.bezier) return evaluateMeshCell(g, row, col, fx - col, fy - row);
      return bilinear(cell[0], cell[1], cell[2], cell[3], fx - col, fy - row);
    }
  }
  return { x: s.cropX + p.x * s.cropW, y: s.cropY + p.y * s.cropH };
}

/** Master canvas (0..1, y down) -> screen content space. Outside the
 *  screen the result runs past 0..1 (rect, corners) or is null (mesh,
 *  where no cell contains the point); callers clamp when placing. */
export function canvasToScreenContent(s: ScreenGeometry, p: Point2D): Point2D | null {
  const mode = s.warpMode ?? 'rect';
  if (mode === 'corners' && s.corners) {
    const c = s.corners;
    const q = inverseBilinear(p, c.topLeft, c.topRight, c.bottomRight, c.bottomLeft);
    return q.x < -0.5 && q.y < -0.5 ? null : q;
  }
  if (mode === 'mesh' && meshUsable(s)) {
    const g = s.meshGrid!;
    if (g.bezier) return invertMeshByRows(g, p);
    for (let row = 0; row < g.rows - 1; row++) {
      for (let col = 0; col < g.cols - 1; col++) {
        const cell = meshCell(s, row, col);
        if (!cell) continue;
        const t = inverseBilinear(p, cell[0], cell[1], cell[2], cell[3]);
        if (t.x >= 0 && t.x <= 1 && t.y >= 0 && t.y <= 1) {
          return { x: (col + t.x) / (g.cols - 1), y: (row + t.y) / (g.rows - 1) };
        }
      }
    }
    return null;
  }
  return {
    x: (p.x - s.cropX) / Math.max(1e-6, s.cropW),
    y: (p.y - s.cropY) / Math.max(1e-6, s.cropH),
  };
}

function segmentDistance(p: Point2D, a: Point2D, b: Point2D): number {
  const bax = b.x - a.x, bay = b.y - a.y;
  const h = Math.max(0, Math.min(1, ((p.x - a.x) * bax + (p.y - a.y) * bay) / Math.max(bax * bax + bay * bay, 1e-6)));
  return Math.hypot(p.x - a.x - bax * h, p.y - a.y - bay * h);
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// ─── Curved edges ───────────────────────────────────────────────────────
// A curved mask edge is cut as a polyline that stays within this distance
// of the true cubic, in screen UV (under half a pixel on a 4K projector).
// The core flattens with the identical rule (flatten_screen_mask in
// main.rs), so the editor preview and the projector cut the same polygon.
export const SCREEN_MASK_CURVE_TOLERANCE = 1 / 8192;
export const SCREEN_MASK_CURVE_MAX_SEGMENTS = 64;
/** Flattened vertices one mask may use in the core's uniforms. */
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
 * A mask's outline as the polygon the core cuts: its anchors (up to 32)
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
 *  polygon test; far above rounding, far below a pixel. Same in the core. */
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
 *  screen_mask_coverage in heartbeat.wgsl: a bounds reject, even-odd ray
 *  crossing, then a smoothstep ramp over `feather` measured inward from the
 *  nearest edge. Curved edges are cut as their flattened polyline. */
function screenMaskCoverage(mask: ScreenMask, uv: Point2D): number {
  const { pts, bounds } = flattenedMask(mask.points);
  const count = pts.length;
  if (count < 3) return 0;
  // Outside the polygon's bounds there is no crossing to count.
  if (uv.x < bounds[0] || uv.y < bounds[1] || uv.x > bounds[2] || uv.y > bounds[3]) return 0;
  let inside = false;
  let minEdge = 1000;
  for (let i = 0; i < count; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % count];
    if ((a.y <= uv.y && b.y > uv.y) || (a.y > uv.y && b.y <= uv.y)) {
      const x = (b.x - a.x) * (uv.y - a.y) / (b.y - a.y) + a.x;
      if (uv.x < x) inside = !inside;
    }
    minEdge = Math.min(minEdge, segmentDistance(uv, a, b));
  }
  if (!inside) return 0;
  const feather = Math.max(0, Math.min(1, mask.feather || 0));
  return feather > 0.001 ? smoothstep(0, feather, minEdge) : 1;
}

/** How much of a screen's picture survives at `uv` (screen content space),
 *  0..1. Mirrors screen_mask_alpha in heartbeat.wgsl, including the caps
 *  the core applies (8 masks, 32 vertices each): normal masks keep the
 *  union of their insides (no normal mask keeps everything), then each
 *  inverted mask cuts its hole. */
export function screenMaskAlpha(masks: ScreenMask[] | null | undefined, uv: Point2D): number {
  const active = (masks ?? []).filter(screenMaskUsable).slice(0, SCREEN_MASK_MAX);
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

// Same limits as MAX_SCREEN_MASKS / SCREEN_MASK_POINTS_PER_MASK in the core.
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
 *  their cubics (the flattened polygon the core cuts). While a mask has
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
