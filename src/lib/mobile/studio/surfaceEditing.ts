import { inside, type Point, type InteractiveSurface } from './interactive';

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

/** Scale and rotate a shape about its centre. Returns the input unchanged when
 * the result would leave the canvas. */
export function transformPoints(points: Point[], scale: number, angle = 0): Point[] {
  const cx = points.reduce((v, p) => v + p.x, 0) / points.length;
  const cy = points.reduce((v, p) => v + p.y, 0) / points.length;
  const next = points.map((p) => ({
    x: cx + (p.x - cx) * scale * Math.cos(angle) - (p.y - cy) * scale * Math.sin(angle),
    y: cy + (p.x - cx) * scale * Math.sin(angle) + (p.y - cy) * scale * Math.cos(angle),
  }));
  if (next.some((p) => p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1)) return points;
  return next;
}

export function makeSurface(kind: 'box' | 'circle' | 'triangle', count: number): InteractiveSurface {
  const points =
    kind === 'box'
      ? [
          { x: 0.35, y: 0.3 },
          { x: 0.65, y: 0.3 },
          { x: 0.65, y: 0.7 },
          { x: 0.35, y: 0.7 },
        ]
      : kind === 'triangle'
        ? [
            { x: 0.5, y: 0.25 },
            { x: 0.7, y: 0.7 },
            { x: 0.3, y: 0.7 },
          ]
        : Array.from({ length: 16 }, (_, i) => ({
            x: 0.5 + Math.cos((i * Math.PI) / 8) * 0.15,
            y: 0.5 + Math.sin((i * Math.PI) / 8) * 0.24,
          }));
  return {
    id: crypto.randomUUID(),
    name: `${kind[0].toUpperCase() + kind.slice(1)} ${count + 1}`,
    behavior: 'solid',
    points,
  };
}

/** How close (in stage pixels) a press must be to grab a corner handle. */
export const VERTEX_GRAB_RADIUS = 28;

export type SurfaceHit =
  | { kind: 'vertex'; id: string; index: number }
  | { kind: 'body'; id: string }
  | { kind: 'none' };

/**
 * What a press at `p` (normalised 0–1) lands on, for a stage that is
 * `width` × `height` pixels on screen. The nearest corner within the grab
 * radius wins; otherwise the topmost shape under the point.
 */
export function hitTestSurfaces(
  surfaces: InteractiveSurface[],
  p: Point,
  width: number,
  height: number,
  radius = VERTEX_GRAB_RADIUS,
): SurfaceHit {
  let nearest = radius;
  let vertex: SurfaceHit = { kind: 'none' };
  for (const surface of surfaces) {
    for (let index = 0; index < surface.points.length; index++) {
      const distance = Math.hypot((surface.points[index].x - p.x) * width, (surface.points[index].y - p.y) * height);
      if (distance < nearest) {
        nearest = distance;
        vertex = { kind: 'vertex', id: surface.id, index };
      }
    }
  }
  if (vertex.kind === 'vertex') return vertex;
  const body = [...surfaces].reverse().find((surface) => inside(p, surface.points));
  return body ? { kind: 'body', id: body.id } : { kind: 'none' };
}
