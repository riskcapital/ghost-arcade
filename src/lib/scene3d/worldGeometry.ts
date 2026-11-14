/**
 * The world's shape as the engine sees it, whichever way it was made: the
 * projector the output is seen from, which way is down, and the faces things
 * collide with. A face is a flat outline on a plane in 3D with a solid behind
 * it (an oriented prism).
 *
 * The flat-wall relief (relief.ts) is one case: a face-on projector, gravity
 * down the wall, and each block's front face at its depth with the wall
 * behind. A room (roomModel.ts) is the other: the real objects, face by face.
 * Everything downstream (physics, input, drawing) reads only this.
 *
 * Pure and exported for tests.
 */
import type { InteractiveScene, InteractiveSurface, Point } from '../mobile/studio/interactive';
import type { Vec3 } from './sceneModel';
import {
  add,
  cross,
  dot,
  facePoint,
  faceNormal,
  length,
  normalize,
  scale,
  sub,
  type Room,
} from './roomModel';
import { blockDepth, deepestBlock, floorDepth, frontPaneDepth, reliefFrame, reliefSolids, unproject, type ReliefFrame } from './relief';
import type { ReliefWorld, SurfaceFinish } from './worldModel';
import { forwardDepth, projectorBasis, rayDirection, type ProjectorBasis, type Ray } from './projector';
import { effectiveRoom } from './roomSolve';

export { forwardDepth, projectorBasis, projectPoint, rayDirection, rayThrough, type ProjectorBasis, type Ray } from './projector';

export type GeoFace = {
  surfaceId: string;
  name: string;
  origin: Vec3;
  u: Vec3;
  v: Vec3;
  n: Vec3;
  points: { x: number; y: number }[];
  depth: number;
  finish?: SurfaceFinish;
};

export type WorldGeo = {
  mode: 'wall' | 'room';
  projector: ProjectorBasis;
  /** Unit vector: which way things fall. */
  down: Vec3;
  faces: GeoFace[];
  /** The plane behind or under everything (normal, offset: dot(p, n) = offset), or none. */
  plane: { n: Vec3; offset: number } | null;
  /** Spawn depth is measured from here: a point at spawn z sits `spawnRef − z`
   *  in front of the projector. For the wall, the wall is z = 0. */
  spawnRef: number;
  /** The nearest a spawned point may be (spawn z). */
  deepest: number;
  /** Where the world is, and how far from it things are lost (rooms). */
  center: Vec3;
  radius: number;
  /** The wall relief's own frame, when the source is the wall. */
  frame?: ReliefFrame;
  /** An invisible pane at this spawn z keeps things in (0: none). Wall only. */
  pane: number;
};

// ── Projector ─────────────────────────────────────────────────────────────

/** The face-on projector of the wall relief. */
export function wallProjector(frame: ReliefFrame): ProjectorBasis {
  return { pos: [0, 0, frame.camZ], fwd: [0, 0, -1], right: [frame.W / 2 / frame.camZ, 0, 0], up: [0, frame.H / 2 / frame.camZ, 0], fov: frame.fov, shift: [0, 0] };
}

/** The point on the ray through `uv` at spawn depth z. */
export const unprojectAt = (geo: WorldGeo, uv: Point, z: number): Vec3 =>
  add(geo.projector.pos, scale(rayDirection(geo.projector, uv), geo.spawnRef - z));

/** A point's spawn depth. */
export const spawnZ = (geo: WorldGeo, p: Vec3): number => geo.spawnRef - forwardDepth(geo.projector, p);

/** A velocity on the output (per second) as meters per second at a point. */
export function outputVelocity(geo: WorldGeo, v: Point, at: Vec3): Vec3 {
  const t = forwardDepth(geo.projector, at);
  return add(scale(geo.projector.right, 2 * v.x * t), scale(geo.projector.up, -2 * v.y * t));
}

// ── Building it ───────────────────────────────────────────────────────────

function wallGeometry(scene: InteractiveScene, world: ReliefWorld, aspect: number): WorldGeo {
  const frame = reliefFrame(aspect, world.lens);
  const faces = reliefSolids(scene).map((s): GeoFace => {
    const d = blockDepth(s, world, frame);
    return {
      surfaceId: s.id, name: s.name || 'Block', origin: [0, 0, d], u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1],
      points: s.points.slice(0, 64).map((p) => unproject(frame, p, d)), depth: d, finish: s.finish,
    };
  });
  return {
    mode: 'wall', projector: wallProjector(frame), down: [0, -1, 0], faces, plane: { n: [0, 0, 1], offset: 0 },
    spawnRef: frame.camZ, deepest: Math.max(0.5, deepestBlock(scene, world, frame)),
    center: [0, 0, 0], radius: 0, frame,
    pane: world.frontPane ? frontPaneDepth(scene, world, frame) : 0,
  };
}

function roomGeometry(scene: InteractiveScene, room: Room, aspect: number): WorldGeo {
  const shift = room.projector.shift;
  const projector = projectorBasis(room.projector.position, room.projector.target, room.projector.fov, aspect, shift ? [shift.x, shift.y] : [0, 0]);
  const surfaces = new Map(scene.surfaces.map((s) => [s.id, s] as [string, InteractiveSurface]));
  const faces = room.faces.filter((f) => surfaces.has(f.surfaceId)).map((f): GeoFace => {
    const s = surfaces.get(f.surfaceId)!;
    return { surfaceId: f.surfaceId, name: s.name || 'Face', origin: f.origin, u: f.u, v: f.v, n: faceNormal(f), points: f.points, depth: f.depth, finish: s.finish };
  });
  const corners = faces.flatMap((f) => f.points.map((p) => facePoint(f, p)));
  const center: Vec3 = corners.length ? scale(corners.reduce(add, [0, 0, 0] as Vec3), 1 / corners.length) : add(projector.pos, scale(projector.fwd, 4));
  const reach = corners.reduce((r, p) => Math.max(r, length(sub(p, center))), 1);
  const depths = corners.map((p) => forwardDepth(projector, p));
  const far = depths.length ? Math.max(...depths) : forwardDepth(projector, center) + 1;
  const near = depths.length ? Math.min(...depths) : far - 1;
  const down = normalize(room.down);
  const lowest = corners.length ? Math.max(...corners.map((p) => dot(p, down))) : dot(center, down) + 1;
  return {
    mode: 'room', projector, down, faces,
    // The ground: under the lowest face, facing up.
    plane: room.floor ? { n: scale(down, -1), offset: -lowest } : null,
    spawnRef: far, deepest: Math.max(0.5, far - near + 0.3),
    center, radius: reach * 2 + 2, pane: 0,
  };
}

export function worldGeometry(scene: InteractiveScene, world: ReliefWorld, aspect: number): WorldGeo {
  return world.source === 'room' && world.room ? roomGeometry(scene, effectiveRoom(scene, world.room, aspect), aspect) : wallGeometry(scene, world, aspect);
}

/** The face for a surface, if it has one. */
export const geoFace = (geo: WorldGeo, surfaceId: string): GeoFace | undefined => geo.faces.find((f) => f.surfaceId === surfaceId);

/** The way up. */
export const upOf = (geo: WorldGeo): Vec3 => scale(geo.down, -1);

// ── Picking ───────────────────────────────────────────────────────────────

export type GeoHit = { surfaceId: string | null; point: Vec3; normal: Vec3; t: number };

function inside(poly: { x: number; y: number }[], x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

/**
 * What the ray meets first: a face (its front) or the side of its solid, or
 * the plane behind. Each face's solid is a prism from the face back to its
 * depth, so in the face's own frame the ray meets the front where it crosses
 * z = 0 inside the outline, else a side where it enters between −depth and 0.
 */
export function pickWorld(geo: WorldGeo, ray: Ray): GeoHit {
  const at = (t: number): Vec3 => add(ray.origin, scale(ray.dir, t));
  let best: GeoHit;
  const pd = geo.plane ? dot(ray.dir, geo.plane.n) : 0;
  const tPlane = geo.plane && Math.abs(pd) > 1e-9 ? (geo.plane.offset - dot(ray.origin, geo.plane.n)) / pd : -1;
  if (geo.plane && tPlane > 0) best = { surfaceId: null, point: at(tPlane), normal: [...geo.plane.n] as Vec3, t: tPlane };
  else {
    // Nothing behind: as far as the world reaches.
    const t = Math.max(1e-3, geo.spawnRef / Math.max(1e-3, dot(ray.dir, geo.projector.fwd)));
    best = { surfaceId: null, point: at(t), normal: scale(geo.projector.fwd, -1), t: Infinity };
  }
  for (const f of geo.faces) {
    const rel = sub(ray.origin, f.origin);
    const o = [dot(rel, f.u), dot(rel, f.v), dot(rel, f.n)];
    const d = [dot(ray.dir, f.u), dot(ray.dir, f.v), dot(ray.dir, f.n)];
    const local = (t: number) => [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
    if (Math.abs(d[2]) > 1e-9) {
      const tFront = -o[2] / d[2];
      const q = local(tFront);
      // A face beats the side of another solid it touches (faces of one object share their solids).
      if (tFront > 0 && tFront < best.t + 1e-6 && inside(f.points, q[0], q[1])) {
        best = { surfaceId: f.surfaceId, point: at(tFront), normal: dot(ray.dir, f.n) < 0 ? [...f.n] as Vec3 : scale(f.n, -1), t: tFront };
        continue;
      }
    }
    // Sides: the first edge the ray crosses between the face and its back.
    const poly = f.points;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const ex = b.x - a.x, ey = b.y - a.y;
      const nx = ey, ny = -ex;
      const denom = nx * d[0] + ny * d[1];
      if (Math.abs(denom) < 1e-9) continue;
      const t = (nx * (a.x - o[0]) + ny * (a.y - o[1])) / denom;
      if (t <= 0 || t >= best.t - 1e-6) continue;
      const p = local(t);
      if (p[2] > 0 || p[2] < -f.depth) continue;
      const along = ((p[0] - a.x) * ex + (p[1] - a.y) * ey) / (ex * ex + ey * ey);
      if (along < 0 || along > 1) continue;
      const len = Math.hypot(nx, ny) || 1;
      let n = normalize(add(scale(f.u, nx / len), scale(f.v, ny / len)));
      // Face the normal back at the ray.
      if (dot(n, ray.dir) > 0) n = scale(n, -1);
      best = { surfaceId: f.surfaceId, point: at(t), normal: n, t };
    }
  }
  return best;
}

/**
 * Where a face drips or burns from: its upper edges (those whose outward
 * side faces up), with the face's normal and depth. At most 16.
 */
export function faceSites(geo: WorldGeo, surfaceId: string): { a: Vec3; b: Vec3; n: Vec3; depth: number }[] {
  const f = geoFace(geo, surfaceId);
  if (!f) return [];
  const pts = f.points;
  let area = 0;
  pts.forEach((a, i) => { const b = pts[(i + 1) % pts.length]; area += a.x * b.y - b.x * a.y; });
  const up = upOf(geo);
  const sites: { a: Vec3; b: Vec3; n: Vec3; depth: number }[] = [];
  pts.forEach((a, i) => {
    const b = pts[(i + 1) % pts.length];
    const ex = b.x - a.x, ey = b.y - a.y, len = Math.hypot(ex, ey);
    if (len < 1e-6) return;
    // Outward: to the right of each edge when the outline runs counterclockwise.
    const ox = (area > 0 ? ey : -ey) / len, oy = (area > 0 ? -ex : ex) / len;
    const out = add(scale(f.u, ox), scale(f.v, oy));
    if (dot(out, up) > 0.35) sites.push({ a: facePoint(f, a), b: facePoint(f, b), n: f.n, depth: f.depth });
  });
  return sites.slice(0, 16);
}

/** The basis of a face as Euler angles (degrees, R = Rz·Ry·Rx), for a mesh node. */
export function basisEuler(u: Vec3, v: Vec3, n: Vec3): Vec3 {
  const deg = (r: number) => (r * 180) / Math.PI;
  const sy = -u[2];
  if (Math.abs(sy) < 0.99999) {
    return [deg(Math.atan2(v[2], n[2])), deg(Math.asin(sy)), deg(Math.atan2(u[1], u[0]))];
  }
  // Gimbal lock: Rx and Rz turn about the same axis; put it all in Rz.
  return [0, deg(Math.asin(Math.max(-1, Math.min(1, sy)))), deg(Math.atan2(-v[0], v[1]))];
}
