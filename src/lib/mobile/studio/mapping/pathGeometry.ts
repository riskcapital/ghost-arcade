/**
 * Closed outlines made of points with optional cubic handles: the outline of
 * a free-form surface (in the output frame) and the outline of a mask (in a
 * surface's content space). Pure TypeScript.
 */
import type { Point } from '../model';

/** A path point. `in` and `out` are handle offsets from the point; absent is a sharp corner on that side. */
export type PathPoint = { x: number; y: number; in?: Point; out?: Point };

export const MIN_PATH_POINTS = 3;
export const MAX_PATH_POINTS = 64;
/** Circle constant: handle length of a quarter-circle cubic, as a share of the radius. */
export const KAPPA = 0.5522847498;

const finite = (p: Point | undefined | null): p is Point => !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/** True when the segment from point i to the next one is curved. */
export function segmentCurved(points: PathPoint[], i: number): boolean {
  const a = points[i],
    b = points[(i + 1) % points.length];
  return finite(a.out) || finite(b.in);
}

/** Cubic controls of segment i (a straight segment gives its thirds). */
export function segmentControls(points: PathPoint[], i: number): [Point, Point, Point, Point] {
  const a = points[i],
    b = points[(i + 1) % points.length];
  const p0 = { x: a.x, y: a.y },
    p3 = { x: b.x, y: b.y };
  const p1 = finite(a.out) ? { x: a.x + a.out.x, y: a.y + a.out.y } : lerp(p0, p3, 1 / 3);
  const p2 = finite(b.in) ? { x: b.x + b.in.x, y: b.y + b.in.y } : lerp(p0, p3, 2 / 3);
  return [p0, p1, p2, p3];
}

export function cubicAt(c: [Point, Point, Point, Point], t: number): Point {
  const s = 1 - t;
  const w0 = s * s * s,
    w1 = 3 * s * s * t,
    w2 = 3 * s * t * t,
    w3 = t * t * t;
  return { x: w0 * c[0].x + w1 * c[1].x + w2 * c[2].x + w3 * c[3].x, y: w0 * c[0].y + w1 * c[1].y + w2 * c[2].y + w3 * c[3].y };
}

export function segmentPoint(points: PathPoint[], i: number, t: number): Point {
  return cubicAt(segmentControls(points, i), t);
}

/**
 * The outline as a polygon. Straight segments contribute their start point
 * only; curves are sampled `perCurve` times. `sx`/`sy` scale before
 * measuring nothing: sampling is uniform in t, enough for display and masks.
 */
export function flattenPath(points: PathPoint[], perCurve = 16): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < points.length; i++) {
    if (!segmentCurved(points, i)) {
      out.push({ x: points[i].x, y: points[i].y });
      continue;
    }
    const c = segmentControls(points, i);
    for (let k = 0; k < perCurve; k++) out.push(cubicAt(c, k / perCurve));
  }
  return out;
}

/** Split segment i at t, inserting a point that keeps the outline exactly as it was. Returns the new list. */
export function insertPoint(points: PathPoint[], i: number, t = 0.5): PathPoint[] {
  if (points.length >= MAX_PATH_POINTS) return points;
  const n = points.length;
  const next = points.map((p) => ({ ...p }));
  if (!segmentCurved(points, i)) {
    const m = lerp(points[i], points[(i + 1) % n], t);
    next.splice(i + 1, 0, { x: m.x, y: m.y });
    return next;
  }
  // de Casteljau: the two halves of the cubic.
  const [p0, p1, p2, p3] = segmentControls(points, i);
  const a = lerp(p0, p1, t),
    b = lerp(p1, p2, t),
    c = lerp(p2, p3, t);
  const d = lerp(a, b, t),
    e = lerp(b, c, t);
  const m = lerp(d, e, t);
  next[i] = { ...next[i], out: { x: a.x - p0.x, y: a.y - p0.y } };
  const j = (i + 1) % n;
  next[j] = { ...next[j], in: { x: c.x - p3.x, y: c.y - p3.y } };
  next.splice(i + 1, 0, { x: m.x, y: m.y, in: { x: d.x - m.x, y: d.y - m.y }, out: { x: e.x - m.x, y: e.y - m.y } });
  return next;
}

/** Remove point i, keeping at least three. */
export function removePoint(points: PathPoint[], i: number): PathPoint[] {
  if (points.length <= MIN_PATH_POINTS) return points;
  return points.filter((_, k) => k !== i).map((p) => ({ ...p }));
}

/** Handles that make point i smooth: along the line from its previous to its next neighbour. */
export function smoothHandles(points: PathPoint[], i: number, tension = 1 / 6): { in: Point; out: Point } {
  const n = points.length;
  const prev = points[(i + n - 1) % n],
    next = points[(i + 1) % n];
  const d = { x: (next.x - prev.x) * tension, y: (next.y - prev.y) * tension };
  return { in: { x: -d.x, y: -d.y }, out: d };
}

/** Make point i smooth (auto handles) or a sharp corner. */
export function setPointSmooth(points: PathPoint[], i: number, smooth: boolean): PathPoint[] {
  return points.map((p, k) => {
    if (k !== i) return { ...p };
    if (!smooth) return { x: p.x, y: p.y };
    return { x: p.x, y: p.y, ...smoothHandles(points, i) };
  });
}

export const isSmooth = (p: PathPoint) => finite(p.in) || finite(p.out);

/** Move one handle; a smooth point's other handle turns to stay opposite, keeping its own length. */
export function moveHandle(points: PathPoint[], i: number, side: 'in' | 'out', offset: Point, broken = false): PathPoint[] {
  return points.map((p, k) => {
    if (k !== i) return { ...p };
    const other = side === 'in' ? 'out' : 'in';
    const q: PathPoint = { ...p, [side]: offset };
    if (!broken) {
      const current = p[other];
      const length = finite(current) ? Math.hypot(current.x, current.y) : Math.hypot(offset.x, offset.y);
      const along = Math.hypot(offset.x, offset.y) || 1;
      q[other] = { x: (-offset.x / along) * length, y: (-offset.y / along) * length };
    }
    return q;
  });
}

/** Move point i; its handles travel with it. */
export function movePathPoint(points: PathPoint[], i: number, to: Point): PathPoint[] {
  return points.map((p, k) => (k === i ? { ...p, x: to.x, y: to.y } : { ...p }));
}

/**
 * An ellipse of `points` points (4 or 8) around a centre, radii in each
 * axis's own units. A circle on a 16:9 output passes rx = r / 16·9.
 */
export function ellipsePath(cx: number, cy: number, rx: number, ry: number, count = 4): PathPoint[] {
  const k = (4 / 3) * Math.tan(Math.PI / (2 * count));
  return Array.from({ length: count }, (_, i) => {
    const a = (i / count) * Math.PI * 2 - Math.PI / 2;
    const x = cx + Math.cos(a) * rx,
      y = cy + Math.sin(a) * ry;
    // Tangent direction at angle a: (-sin a, cos a), scaled per axis.
    const tx = -Math.sin(a) * rx * k,
      ty = Math.cos(a) * ry * k;
    return { x, y, in: { x: -tx, y: -ty }, out: { x: tx, y: ty } };
  });
}

export function polygonPath(cx: number, cy: number, rx: number, ry: number, sides: number): PathPoint[] {
  return Array.from({ length: sides }, (_, i) => {
    const a = (i / sides) * Math.PI * 2 - Math.PI / 2;
    return { x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry };
  });
}

/** Douglas–Peucker on an open polyline. */
function simplifyOpen(points: Point[], tolerance: number): Point[] {
  if (points.length < 3) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let worst = -1,
      at = -1;
    const pa = points[a],
      pb = points[b];
    const dx = pb.x - pa.x,
      dy = pb.y - pa.y,
      len = Math.hypot(dx, dy) || 1e-9;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((points[i].x - pa.x) * dy - (points[i].y - pa.y) * dx) / len;
      if (d > worst) {
        worst = d;
        at = i;
      }
    }
    if (worst > tolerance && at > 0) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/**
 * A finger-drawn stroke as a smooth closed path: lightly averaged to take
 * out jitter, thinned to the points that carry its shape (at most `limit`),
 * and given smooth handles so it reads as one flowing outline.
 * `sx`/`sy` turn the units into pixels so the tolerance means the same on any canvas.
 */
export function strokeToPath(stroke: Point[], sx = 1, sy = 1, tolerancePx = 4, limit = 32): PathPoint[] {
  const pts = stroke.filter((p) => finite(p));
  if (pts.length < 3) return [];
  // Average over a small window (closed), in pixels.
  const px = pts.map((p) => ({ x: p.x * sx, y: p.y * sy }));
  const n = px.length;
  const smoothed = px.map((_, i) => {
    let x = 0,
      y = 0;
    for (let k = -2; k <= 2; k++) {
      const q = px[(i + k + n) % n];
      x += q.x;
      y += q.y;
    }
    return { x: x / 5, y: y / 5 };
  });
  // A closed loop is simplified as two open halves, split at the point farthest from the start.
  let far = 0,
    best = -1;
  for (let i = 1; i < n; i++) {
    const d = Math.hypot(smoothed[i].x - smoothed[0].x, smoothed[i].y - smoothed[0].y);
    if (d > best) {
      best = d;
      far = i;
    }
  }
  const closed = (tol: number) => [...simplifyOpen(smoothed.slice(0, far + 1), tol).slice(0, -1), ...simplifyOpen([...smoothed.slice(far), smoothed[0]], tol).slice(0, -1)];
  let tolerance = tolerancePx;
  let thin = closed(tolerance);
  while (thin.length > limit) {
    tolerance *= 1.5;
    thin = closed(tolerance);
  }
  if (thin.length < 3) return [];
  const path: PathPoint[] = thin.map((p) => ({ x: p.x / sx, y: p.y / sy }));
  return path.map((p, i) => ({ ...p, ...smoothHandles(path, i) }));
}

/** Signed area of the flattened outline (positive = clockwise on a y-down canvas). */
export function signedArea(poly: Point[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i],
      q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/** Even–odd point-in-polygon. */
export function insidePolygon(poly: Point[], p: Point): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i],
      b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

/** Apply a point map to a path, carrying handles through it (their tips are mapped too). */
export function mapPath(points: PathPoint[], f: (p: Point) => Point): PathPoint[] {
  return points.map((p) => {
    const at = f(p);
    const q: PathPoint = { x: at.x, y: at.y };
    if (finite(p.in)) {
      const tip = f({ x: p.x + p.in.x, y: p.y + p.in.y });
      q.in = { x: tip.x - at.x, y: tip.y - at.y };
    }
    if (finite(p.out)) {
      const tip = f({ x: p.x + p.out.x, y: p.y + p.out.y });
      q.out = { x: tip.x - at.x, y: tip.y - at.y };
    }
    return q;
  });
}

/** Keep only well-formed path points, clamped to `lo`..`hi`. */
export function normalizePath(raw: unknown, lo = -0.5, hi = 1.5, limit = MAX_PATH_POINTS): PathPoint[] {
  if (!Array.isArray(raw)) return [];
  const c = (v: number) => Math.max(lo, Math.min(hi, v));
  const h = (v: Point | undefined) => (finite(v) ? { x: Math.max(-2, Math.min(2, v.x)), y: Math.max(-2, Math.min(2, v.y)) } : undefined);
  return raw
    .filter((p): p is PathPoint => finite(p as Point))
    .slice(0, limit)
    .map((p) => {
      const q: PathPoint = { x: c(p.x), y: c(p.y) };
      const i = h(p.in),
        o = h(p.out);
      if (i) q.in = i;
      if (o) q.out = o;
      return q;
    });
}
