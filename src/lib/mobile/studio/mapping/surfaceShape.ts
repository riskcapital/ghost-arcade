/**
 * Free-form surfaces: a closed outline of any number of points, each sharp
 * or curved, with the picture warped inside it.
 *
 * The picture is laid on a corner-pinned frame (the surface's ordinary
 * corner warp, so perspective works as on any quad) and cut to the
 * outline. Whenever the outline changes the frame is fitted around it again
 * in its own perspective: the box the outline spans in the frame's picture
 * coordinates becomes the new frame. A quad turned into a shape therefore
 * keeps its picture exactly, and pulling a point out stretches the frame
 * along the same perspective instead of leaving an empty corner.
 */
import type { Point } from '../model';
import { cornerPoints, gridOf, latticeFromCorners, outline as warpOutline, resolveTangent, hasCurves, type WarpGeometry } from './meshGrid';
import { apply, invert, squareToQuad } from './homography';
import { ellipsePath, flattenPath, insidePolygon, mapPath, normalizePath, polygonPath, strokeToPath, MIN_PATH_POINTS, type PathPoint } from './pathGeometry';

export type SurfaceShape = { points: PathPoint[] };
export type ShapedGeometry = WarpGeometry & { shape?: SurfaceShape };

export const isShape = (s: ShapedGeometry) => s.mode === 'corners' && !!s.shape && s.shape.points.length >= MIN_PATH_POINTS;

/** The outline as a polygon in the output frame, for drawing, hit tests and snapping. */
export function surfaceOutline(s: ShapedGeometry, perCurve = 12): Point[] {
  return isShape(s) ? flattenPath(s.shape!.points, perCurve) : warpOutline(s, perCurve);
}

export function insideSurface(s: ShapedGeometry, p: Point): boolean {
  return insidePolygon(surfaceOutline(s, 8), p);
}

/**
 * The frame around `outline` in the perspective of `corners`: the outline's
 * box in the frame's picture coordinates, mapped back out. Falls back to the
 * outline's plain bounding box when the perspective cannot be used.
 */
export function fitFrame(corners: Point[], outline: Point[]): [Point, Point, Point, Point] {
  const box = (): [Point, Point, Point, Point] => {
    const xs = outline.map((p) => p.x),
      ys = outline.map((p) => p.y);
    const x0 = Math.min(...xs),
      x1 = Math.max(...xs),
      y0 = Math.min(...ys),
      y1 = Math.max(...ys);
    return [
      { x: x0, y: y0 },
      { x: x1, y: y0 },
      { x: x1, y: y1 },
      { x: x0, y: y1 },
    ];
  };
  const m = squareToQuad(corners);
  const inv = invert(m);
  if (!inv || outline.length < 3) return box();
  let u0 = Infinity,
    u1 = -Infinity,
    v0 = Infinity,
    v1 = -Infinity;
  for (const p of outline) {
    const q = apply(inv, p);
    if (!(q.w > 0) && !(q.w < 0)) return box();
    if (!Number.isFinite(q.x) || !Number.isFinite(q.y)) return box();
    u0 = Math.min(u0, q.x);
    u1 = Math.max(u1, q.x);
    v0 = Math.min(v0, q.y);
    v1 = Math.max(v1, q.y);
  }
  // A frame stretched past its own horizon would flip: use the plain box instead.
  if (u1 - u0 < 1e-6 || v1 - v0 < 1e-6 || u0 < -4 || v0 < -4 || u1 > 5 || v1 > 5) return box();
  const out = [apply(m, { x: u0, y: v0 }), apply(m, { x: u1, y: v0 }), apply(m, { x: u1, y: v1 }), apply(m, { x: u0, y: v1 })];
  if (out.some((p) => !(p.w > 0) || !Number.isFinite(p.x) || !Number.isFinite(p.y))) return box();
  return out.map(({ x, y }) => ({ x, y })) as [Point, Point, Point, Point];
}

const near = (a: Point[], b: Point[]) => a.length === b.length && a.every((p, i) => Math.abs(p.x - b[i].x) < 1e-9 && Math.abs(p.y - b[i].y) < 1e-9);

/** The surface with a new outline and its frame fitted around it. */
export function withShape<T extends ShapedGeometry>(s: T, points: PathPoint[]): T {
  const flat = flattenPath(points, 16);
  const before = cornerPoints(s);
  const corners = fitFrame(before, flat);
  // Unchanged frame: keep the lattice exactly as it was.
  const lattice = near(corners, before) ? s.points.map((p) => ({ ...p })) : latticeFromCorners(corners, gridOf(s));
  return { ...s, mode: 'corners', shape: { points }, points: lattice };
}

/** The outline in the surface's picture coordinates (0–1 across the frame), for cutting it out. */
export function contentOutline(s: ShapedGeometry, perCurve = 24): Point[] | null {
  if (!isShape(s)) return null;
  const inv = invert(squareToQuad(cornerPoints(s)));
  if (!inv) return null;
  const out: Point[] = [];
  for (const p of flattenPath(s.shape!.points, perCurve)) {
    const q = apply(inv, p);
    if (!Number.isFinite(q.x) || !Number.isFinite(q.y)) return null;
    out.push({ x: q.x, y: q.y });
  }
  return out;
}

/** A quad or mesh as an editable outline: its corners, or its border points with their curves. */
export function outlineToPath(s: WarpGeometry): PathPoint[] {
  if (s.mode === 'corners') return cornerPoints(s).map((p) => ({ x: p.x, y: p.y }));
  const g = gridOf(s);
  const ring: number[] = [];
  for (let c = 0; c < g.cols; c++) ring.push(c);
  for (let r = 1; r < g.rows; r++) ring.push(r * g.cols + g.cols - 1);
  for (let c = g.cols - 2; c >= 0; c--) ring.push((g.rows - 1) * g.cols + c);
  for (let r = g.rows - 2; r >= 1; r--) ring.push(r * g.cols);
  const curved = hasCurves(s);
  return ring.map((index, k) => {
    const p: PathPoint = { x: s.points[index].x, y: s.points[index].y };
    if (!curved) return p;
    const next = ring[(k + 1) % ring.length],
      prev = ring[(k + ring.length - 1) % ring.length];
    const t = resolveTangent(s, index);
    const towards = (other: number) => (other === index + 1 ? t.right : other === index - 1 ? t.left : other > index ? t.down : t.up);
    p.out = towards(next);
    p.in = towards(prev);
    return p;
  });
}

/** Turn a quad or mesh into a free-form shape that looks the same. */
export function toShape<T extends ShapedGeometry>(s: T): T {
  if (isShape(s)) return s;
  const path = outlineToPath(s);
  const corners = cornerPoints(s);
  return { ...s, mode: 'corners', shape: { points: path }, points: latticeFromCorners(corners, gridOf(s)) };
}

/** Back to a plain quad on the shape's frame. */
export function dropShape<T extends ShapedGeometry>(s: T): T {
  const { shape: _shape, ...rest } = s;
  return { ...(rest as T), mode: 'corners' };
}

/** Move/scale/turn a whole shaped surface: frame, outline and handles go through the same map. */
export function mapSurface<T extends ShapedGeometry>(s: T, f: (p: Point) => Point): T {
  const out: T = { ...s, points: s.points.map(f) };
  if (s.tangents) out.tangents = s.tangents.map((t, i) => {
    if (!t) return null;
    const at = s.points[i],
      to = f(at);
    const conv = (o?: Point) => {
      if (!o) return undefined;
      const tip = f({ x: at.x + o.x, y: at.y + o.y });
      return { x: tip.x - to.x, y: tip.y - to.y };
    };
    const next: typeof t = {};
    for (const k of ['right', 'down', 'left', 'up'] as const) if (t[k]) next[k] = conv(t[k]);
    return next;
  });
  if (s.shape) out.shape = { points: mapPath(s.shape.points, f) };
  const welded = (s as { welds?: Point[] }).welds;
  if (welded) (out as { welds?: Point[] }).welds = welded.map(f);
  return out;
}

export type ShapePreset = 'circle' | 'triangle' | 'hexagon' | 'diamond';
/**
 * A preset outline centred at `centre`, `size` of the output's height
 * across, round on an output `aspect` wide (16:9 by default).
 */
export function presetPath(kind: ShapePreset, centre: Point = { x: 0.5, y: 0.5 }, size = 0.5, aspect = 16 / 9): PathPoint[] {
  const ry = size / 2,
    rx = ry / aspect;
  if (kind === 'circle') return ellipsePath(centre.x, centre.y, rx, ry, 4);
  if (kind === 'triangle') return polygonPath(centre.x, centre.y + ry * 0.15, rx * 1.1, ry * 1.1, 3);
  if (kind === 'hexagon') return polygonPath(centre.x, centre.y, rx, ry, 6);
  return polygonPath(centre.x, centre.y, rx * 0.8, ry, 4);
}

/** A finger-drawn outline (output frame, normalised) as a shape path; empty when too small. */
export function drawnPath(stroke: Point[], widthPx: number, heightPx: number): PathPoint[] {
  const path = strokeToPath(stroke, widthPx, heightPx, 4, 24);
  if (path.length < MIN_PATH_POINTS) return [];
  const xs = path.map((p) => p.x * widthPx),
    ys = path.map((p) => p.y * heightPx);
  if (Math.max(...xs) - Math.min(...xs) < 12 || Math.max(...ys) - Math.min(...ys) < 12) return [];
  return path;
}

/** A shape surface's starting frame and lattice for a path drawn from scratch. */
export function shapeFromPath<T extends ShapedGeometry>(s: T, points: PathPoint[]): T {
  const flat = flattenPath(points, 16);
  const xs = flat.map((p) => p.x),
    ys = flat.map((p) => p.y);
  const corners: [Point, Point, Point, Point] = [
    { x: Math.min(...xs), y: Math.min(...ys) },
    { x: Math.max(...xs), y: Math.min(...ys) },
    { x: Math.max(...xs), y: Math.max(...ys) },
    { x: Math.min(...xs), y: Math.max(...ys) },
  ];
  const { tangents: _t, bezier: _b, grid: _g, ...rest } = s;
  return { ...(rest as T), mode: 'corners', shape: { points }, points: latticeFromCorners(corners, { cols: 3, rows: 3 }) };
}

export function normalizeShape(raw: unknown): SurfaceShape | undefined {
  const points = normalizePath((raw as SurfaceShape | undefined)?.points);
  return points.length >= MIN_PATH_POINTS ? { points } : undefined;
}
