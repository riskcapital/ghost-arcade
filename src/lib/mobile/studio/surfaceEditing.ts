import { inside, type Point, type InteractiveSurface } from './interactive';

/** Width ÷ height of the composition when the host does not say. */
export const DEFAULT_ASPECT = 16 / 9;

/** Mobile mapping stores a 3×3 grid even in corner mode. Convert its boundary
 * in winding order; mesh surfaces need resampling and are intentionally omitted. */
export function importCornerSurfaces(
  surfaces: { name: string; points: Point[]; enabled: boolean; mode: string }[],
): InteractiveSurface[] {
  return surfaces
    .filter((s) => s.enabled && s.mode === 'corners' && [4, 9].includes(s.points.length))
    .slice(0, 32)
    .map((s) => ({
      id: crypto.randomUUID(),
      name: s.name,
      behavior: 'solid',
      points: structuredClone(s.points.length === 9 ? [s.points[0], s.points[2], s.points[8], s.points[6]] : s.points),
    }));
}

/** Move a shape, stopping at the canvas edge so the whole shape stays reachable. */
export function translatePoints(points: Point[], dx: number, dy: number): Point[] {
  dx = Math.max(-Math.min(...points.map((p) => p.x)), Math.min(1 - Math.max(...points.map((p) => p.x)), dx));
  dy = Math.max(-Math.min(...points.map((p) => p.y)), Math.min(1 - Math.max(...points.map((p) => p.y)), dy));
  return points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
}

/**
 * Scale and rotate a shape about its centre.
 *
 * Points are normalised 0–1 on both axes, so the maths runs in units of the
 * canvas height (`aspect` = width ÷ height). Without that a turn would shear
 * the shape on any canvas that is not square. Returns the input unchanged
 * when the result would leave the canvas.
 */
export function transformPoints(points: Point[], scale: number, angle = 0, aspect = DEFAULT_ASPECT): Point[] {
  const centre = centroid(points);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const next = points.map((p) => {
    const dx = (p.x - centre.x) * aspect;
    const dy = p.y - centre.y;
    return {
      x: centre.x + ((dx * cos - dy * sin) * scale) / aspect,
      y: centre.y + (dx * sin + dy * cos) * scale,
    };
  });
  if (next.some((p) => p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1)) return points;
  return next;
}

export function centroid(points: Point[]): Point {
  return {
    x: points.reduce((v, p) => v + p.x, 0) / points.length,
    y: points.reduce((v, p) => v + p.y, 0) / points.length,
  };
}

/** Normalised size of one "short side" of the canvas along each axis. */
function shortSide(aspect: number): Point {
  return aspect >= 1 ? { x: 1 / aspect, y: 1 } : { x: 1, y: aspect };
}

/** Where new shapes are tried, in order. The first free place wins. */
const SPAWN_PLACES: Point[] = [
  { x: 0.5, y: 0.5 },
  { x: 0.3, y: 0.35 },
  { x: 0.7, y: 0.35 },
  { x: 0.3, y: 0.65 },
  { x: 0.7, y: 0.65 },
  { x: 0.5, y: 0.3 },
  { x: 0.5, y: 0.7 },
  { x: 0.3, y: 0.5 },
  { x: 0.7, y: 0.5 },
];

/**
 * A centre for a new shape that is not on top of an existing one.
 * When the usual places are taken, a scatter of fallback places keeps new
 * shapes from stacking exactly.
 */
export function spawnPoint(surfaces: InteractiveSurface[], aspect = DEFAULT_ASPECT): Point {
  const unit = shortSide(aspect);
  const centres = surfaces.map((s) => centroid(s.points));
  const taken = (place: Point, gap: number) =>
    centres.some((c) => Math.hypot((c.x - place.x) / unit.x, (c.y - place.y) / unit.y) < gap);
  const free = SPAWN_PLACES.find((place) => !taken(place, 0.14));
  if (free) return free;
  for (let k = 1; k <= 64; k++) {
    const place = { x: 0.3 + ((k * 0.07) % 0.4), y: 0.3 + ((k * 0.11) % 0.4) };
    if (!taken(place, 0.03)) return place;
  }
  return { x: 0.5, y: 0.5 };
}

/**
 * A ready-made shape. Sizes are fractions of the canvas's short side, so a
 * circle is round and a box keeps its proportions on any `aspect`.
 */
export function makeSurface(
  kind: 'box' | 'circle' | 'triangle',
  count: number,
  aspect = DEFAULT_ASPECT,
  centre: Point = { x: 0.5, y: 0.5 },
): InteractiveSurface {
  const unit = shortSide(aspect);
  const at = (x: number, y: number): Point => ({ x: centre.x + x * unit.x, y: centre.y + y * unit.y });
  const points =
    kind === 'box'
      ? [at(-0.25, -0.2), at(0.25, -0.2), at(0.25, 0.2), at(-0.25, 0.2)]
      : kind === 'triangle'
        ? [at(0, -0.22), at(0.25, 0.22), at(-0.25, 0.22)]
        : Array.from({ length: 16 }, (_, i) =>
            at(Math.cos((i * Math.PI) / 8) * 0.22, Math.sin((i * Math.PI) / 8) * 0.22),
          );
  return {
    id: crypto.randomUUID(),
    name: `${kind[0].toUpperCase() + kind.slice(1)} ${count + 1}`,
    behavior: 'solid',
    points,
  };
}

// ── Hit-testing ────────────────────────────────────────────────────────────

/** Grab distances in screen pixels. A finger needs a bigger target than a mouse. */
export type HitTolerance = { handle: number; edge: number };
export const MOUSE_TOLERANCE: HitTolerance = { handle: 12, edge: 6 };
export const TOUCH_TOLERANCE: HitTolerance = { handle: 24, edge: 14 };

export type SurfaceHit =
  | { kind: 'vertex'; id: string; index: number }
  | { kind: 'body'; id: string }
  | { kind: 'none' };

/** Distance between two normalised points on a stage `width` × `height` pixels big. */
export function pixelDistance(a: Point, b: Point, width: number, height: number): number {
  return Math.hypot((a.x - b.x) * width, (a.y - b.y) * height);
}

function segmentDistance(p: Point, a: Point, b: Point, width: number, height: number): number {
  const px = (p.x - a.x) * width;
  const py = (p.y - a.y) * height;
  const sx = (b.x - a.x) * width;
  const sy = (b.y - a.y) * height;
  const length = sx * sx + sy * sy;
  const t = length ? Math.max(0, Math.min(1, (px * sx + py * sy) / length)) : 0;
  return Math.hypot(px - sx * t, py - sy * t);
}

function outlineDistance(points: Point[], p: Point, width: number, height: number): number {
  let nearest = Infinity;
  for (let i = 0; i < points.length; i++)
    nearest = Math.min(nearest, segmentDistance(p, points[i], points[(i + 1) % points.length], width, height));
  return nearest;
}

/**
 * The corner handle of one shape under `p`, or -1.
 * A handle never reaches further than 40 % of the way to its neighbours, so
 * the middle of a small shape stays free for dragging the whole shape.
 */
export function hitTestVertex(points: Point[], p: Point, width: number, height: number, radius: number): number {
  let best = -1;
  let nearest = Infinity;
  for (let i = 0; i < points.length; i++) {
    const previous = points[(i + points.length - 1) % points.length];
    const next = points[(i + 1) % points.length];
    const reach = Math.min(
      radius,
      0.4 * pixelDistance(points[i], previous, width, height),
      0.4 * pixelDistance(points[i], next, width, height),
    );
    const distance = pixelDistance(points[i], p, width, height);
    if (distance <= reach && distance < nearest) {
      nearest = distance;
      best = i;
    }
  }
  return best;
}

/**
 * What a press at `p` (normalised 0–1) lands on, for a stage that is
 * `width` × `height` pixels on screen.
 *
 *  1. A corner handle, but only on the selected shape: the other shapes do
 *     not show handles, so they must not react like they had them.
 *  2. The topmost shape under the point.
 *  3. The topmost shape whose outline is within reach (thin or tiny shapes).
 */
export function hitTestSurfaces(
  surfaces: InteractiveSurface[],
  p: Point,
  width: number,
  height: number,
  selected = '',
  tolerance: HitTolerance = MOUSE_TOLERANCE,
): SurfaceHit {
  const chosen = surfaces.find((s) => s.id === selected);
  if (chosen) {
    const index = hitTestVertex(chosen.points, p, width, height, tolerance.handle);
    if (index >= 0) return { kind: 'vertex', id: chosen.id, index };
  }
  const topFirst = [...surfaces].reverse();
  const body =
    topFirst.find((s) => inside(p, s.points)) ??
    topFirst.find((s) => outlineDistance(s.points, p, width, height) <= tolerance.edge);
  return body ? { kind: 'body', id: body.id } : { kind: 'none' };
}
