/** The projective map of a corner-pinned surface, as a 3×3 matrix, and its inverse. */
import type { Point } from '../model';

export type Mat3 = [number, number, number, number, number, number, number, number, number];

/**
 * Unit square → quad (TL, TR, BR, BL), the same map `quadPoint` evaluates:
 * x = (A u + B v + C) / (g u + h v + 1), y likewise.
 */
export function squareToQuad(c: [Point, Point, Point, Point] | Point[]): Mat3 {
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
  return [b.x - a.x + g * b.x, e.x - a.x + h * e.x, a.x, b.y - a.y + g * b.y, e.y - a.y + h * e.y, a.y, g, h, 1];
}

export function apply(m: Mat3, p: Point): Point & { w: number } {
  const w = m[6] * p.x + m[7] * p.y + m[8];
  return { x: (m[0] * p.x + m[1] * p.y + m[2]) / w, y: (m[3] * p.x + m[4] * p.y + m[5]) / w, w };
}

export function invert(m: Mat3): Mat3 | null {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h,
    B = -(d * i - f * g),
    C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  const k = 1 / det;
  return [A * k, -(b * i - c * h) * k, (b * f - c * e) * k, B * k, (a * i - c * g) * k, -(a * f - c * d) * k, C * k, -(a * h - b * g) * k, (a * e - b * d) * k];
}

/** Output point → content (u, v) of a corner-pinned surface. Null when the quad is degenerate or the point lies beyond its horizon. */
export function quadInverse(c: [Point, Point, Point, Point] | Point[]): ((p: Point) => Point | null) | null {
  const m = squareToQuad(c);
  const inv = invert(m);
  if (!inv) return null;
  return (p: Point) => {
    const q = apply(inv, p);
    if (!(q.w > 0) && !(q.w < 0)) return null;
    // A point maps forward with a positive denominator only on the visible side.
    const back = m[6] * q.x + m[7] * q.y + m[8];
    return Number.isFinite(q.x) && Number.isFinite(q.y) && back > 0 ? { x: q.x, y: q.y } : null;
  };
}
