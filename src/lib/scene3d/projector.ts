/**
 * The projector as a pinhole camera: where it stands, which way it looks,
 * and how wide. Shared by the world's geometry and the room solve.
 */
import type { Point } from '../mobile/studio/interactive';
import { add, cross, dot, length, normalize, scale, sub } from './roomModel';
import type { Vec3 } from './sceneModel';

/**
 * The projector as a pinhole: where it is, and three axes. `fwd` is unit;
 * `right` and `up` are scaled so that the ray through output point (u, v)
 * is fwd + right·(2u − 1) + up·(1 − 2v).
 */
export type ProjectorBasis = { pos: Vec3; right: Vec3; up: Vec3; fwd: Vec3; fov: number };

/** A projector at `position` looking at `target`, unrolled (up as close to +Y as it can be). */
export function projectorBasis(position: Vec3, target: Vec3, fov: number, aspect: number): ProjectorBasis {
  const fwd = normalize(sub(target, position));
  let side = cross(fwd, [0, 1, 0]);
  if (length(side) < 1e-4) side = cross(fwd, [0, 0, -1]);
  side = normalize(side);
  const up = normalize(cross(side, fwd));
  const th = Math.tan((fov * Math.PI) / 360);
  return { pos: [...position] as Vec3, fwd, right: scale(side, th * Math.max(0.1, aspect)), up: scale(up, th), fov };
}

/** How far in front of the projector a point is, along its axis. */
export const forwardDepth = (pr: ProjectorBasis, p: Vec3): number => dot(sub(p, pr.pos), pr.fwd);

/** Where a point shows on the output (0..1, y down). */
export function projectPoint(pr: ProjectorBasis, p: Vec3): Point {
  const rel = sub(p, pr.pos);
  const t = Math.max(1e-6, dot(rel, pr.fwd));
  return { x: 0.5 + (0.5 * dot(rel, pr.right)) / (dot(pr.right, pr.right) * t), y: 0.5 - (0.5 * dot(rel, pr.up)) / (dot(pr.up, pr.up) * t) };
}

/** The direction (not unit) of the ray through an output point; its forward part is 1. */
export const rayDirection = (pr: ProjectorBasis, uv: Point): Vec3 =>
  add(pr.fwd, add(scale(pr.right, uv.x * 2 - 1), scale(pr.up, 1 - uv.y * 2)));

export type Ray = { origin: Vec3; dir: Vec3 };
export const rayThrough = (pr: ProjectorBasis, uv: Point): Ray => ({ origin: [...pr.pos] as Vec3, dir: normalize(rayDirection(pr, uv)) });
