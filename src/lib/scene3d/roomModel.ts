/**
 * Depth mode: the real objects in front of the projector, as faces in 3D.
 *
 * A room is what the world is built from when its source is `room` (see
 * worldModel.ts): one face per mapped surface, each a flat outline on a plane
 * in 3D with a little thickness behind it, the projector the output is
 * thrown from, and which way is down. Seen from the projector, each face's
 * outline lands on its surface's 2D outline, so effects land on the right
 * real face.
 *
 * Units are meters. The projector is never rolled: its up is as close to +Y
 * as its view allows; gravity can point anywhere.
 *
 * Validation is strict, in the style of worldModel.ts: a value outside its
 * range is clamped, a field of the wrong type throws with where and what.
 */
import type { Vec3 } from './sceneModel';

export const FACE_ROLES = ['top', 'side', 'backdrop'] as const;
export type FaceRole = (typeof FACE_ROLES)[number];

export type RoomFace = {
  /** The Studio surface this face is. */
  surfaceId: string;
  role: FaceRole;
  /** The face's plane: a point on it and two unit axes along it. Its normal,
   *  u × v, points out of the object, towards the projector. */
  origin: Vec3;
  u: Vec3;
  v: Vec3;
  /** The outline in the plane, in meters along u and v. */
  points: { x: number; y: number }[];
  /** How far the solid reaches back behind the face. */
  depth: number;
};

export type RoomProjector = {
  position: Vec3;
  target: Vec3;
  /** Vertical field of view, degrees. The aspect is the output's. */
  fov: number;
};

/**
 * What a person set up by hand (roomSolve.ts). While a room has one, its
 * faces are worked out from it and the scene's solid objects every time, so
 * reshaping an outline (or the mapping it is linked to) moves its face.
 */
export type RoomSetup = {
  /** Which way is down on the output (x right, y down). */
  arrow: { x: number; y: number };
  /** Degrees the projector looks down (negative: up). */
  elevation: number;
  /** The projector's vertical field of view, degrees. */
  fov: number;
  /** Meters from the projector to the objects. */
  distance: number;
  /** Roles a person chose, by surface; the rest are guessed. */
  roles: Record<string, FaceRole>;
  /** The solid objects follow the layers mapped in mapping mode. */
  linked: boolean;
  /** Setup was finished (the Studio shows the world's settings, not the steps). */
  done: boolean;
};

export const defaultRoomSetup = (): RoomSetup => ({ arrow: { x: 0, y: 1 }, elevation: 20, fov: 30, distance: 4, roles: {}, linked: false, done: false });

export type Room = {
  source: 'manual' | 'phone';
  setup?: RoomSetup;
  projector: RoomProjector;
  /** Which way is down, a unit vector. */
  down: Vec3;
  /** A ground plane under the lowest face that catches what falls. */
  floor: boolean;
  faces: RoomFace[];
};

/** At most this many faces (the engine's block limit). */
export const MAX_ROOM_FACES = 48;

export const defaultRoomProjector = (): RoomProjector => ({ position: [0, 0, 6], target: [0, 0, 0], fov: 30 });

export function defaultRoom(): Room {
  return { source: 'manual', projector: defaultRoomProjector(), down: [0, -1, 0], floor: true, faces: [] };
}

// ── Vector helpers ────────────────────────────────────────────────────────

export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const length = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export const normalize = (a: Vec3): Vec3 => {
  const l = length(a);
  return l > 1e-12 ? scale(a, 1 / l) : [0, 0, 0];
};

/** A face's normal: out of the object. */
export const faceNormal = (f: Pick<RoomFace, 'u' | 'v'>): Vec3 => normalize(cross(f.u, f.v));

/** A point of a face's outline in 3D. */
export const facePoint = (f: Pick<RoomFace, 'origin' | 'u' | 'v'>, p: { x: number; y: number }): Vec3 =>
  add(f.origin, add(scale(f.u, p.x), scale(f.v, p.y)));

// ── Validation ────────────────────────────────────────────────────────────

const fail = (where: string, what: string): never => {
  throw new Error(`Room ${where}: ${what}.`);
};
const num = (raw: unknown, where: string, fallback: number, lo: number, hi: number): number => {
  if (raw === undefined) return fallback;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) fail(where, 'not a number');
  return Math.max(lo, Math.min(hi, raw as number));
};
const vec = (raw: unknown, where: string, fallback: Vec3): Vec3 => {
  if (raw === undefined) return [...fallback] as Vec3;
  if (!Array.isArray(raw) || raw.length !== 3 || raw.some((x) => typeof x !== 'number' || !Number.isFinite(x))) fail(where, 'not three numbers');
  return (raw as number[]).map((x) => Math.max(-1000, Math.min(1000, x))) as Vec3;
};
const unit = (raw: unknown, where: string, fallback: Vec3): Vec3 => {
  const v = vec(raw, where, fallback);
  const n = normalize(v);
  return length(n) > 0.5 ? n : ([...fallback] as Vec3);
};
const obj = (raw: unknown, where: string): Record<string, unknown> => {
  if (raw === undefined) return {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail(where, 'not an object');
  return raw as Record<string, unknown>;
};

function validateSetup(raw: unknown): RoomSetup {
  const s = obj(raw, 'setup');
  const d = defaultRoomSetup();
  const arrow = obj(s.arrow, 'setup arrow');
  let ax = num(arrow.x, 'setup arrow', d.arrow.x, -1, 1), ay = num(arrow.y, 'setup arrow', d.arrow.y, -1, 1);
  const len = Math.hypot(ax, ay);
  if (len < 1e-3) [ax, ay] = [d.arrow.x, d.arrow.y];
  else [ax, ay] = [ax / len, ay / len];
  const roles: Record<string, FaceRole> = {};
  for (const [id, role] of Object.entries(obj(s.roles, 'setup roles'))) {
    if (!FACE_ROLES.includes(role as FaceRole)) fail('setup roles', `unknown role ${String(role)}`);
    roles[id] = role as FaceRole;
  }
  const flag = (raw: unknown, where: string, fallback: boolean) => {
    if (raw === undefined) return fallback;
    if (typeof raw !== 'boolean') fail(where, 'not true or false');
    return raw as boolean;
  };
  return {
    arrow: { x: ax, y: ay },
    elevation: num(s.elevation, 'setup angle', d.elevation, -60, 85),
    fov: num(s.fov, 'setup lens', d.fov, 8, 90),
    distance: num(s.distance, 'setup distance', d.distance, 0.5, 30),
    roles,
    linked: flag(s.linked, 'setup link', d.linked),
    done: flag(s.done, 'setup done', d.done),
  };
}

function validateFace(raw: unknown, i: number): RoomFace {
  const where = `face ${i + 1}`;
  const f = obj(raw, where);
  if (typeof f.surfaceId !== 'string' || !f.surfaceId) fail(where, 'no surface');
  const role = f.role === undefined ? 'side' : f.role;
  if (!FACE_ROLES.includes(role as FaceRole)) fail(where, `unknown role ${String(role)}`);
  const u = unit(f.u, `${where} u`, [1, 0, 0]);
  // v at right angles to u, in the plane u and the given v span.
  let v = vec(f.v, `${where} v`, [0, 1, 0]);
  v = normalize(sub(v, scale(u, dot(v, u))));
  if (length(v) < 0.5) v = normalize(cross(Math.abs(u[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], u));
  if (!Array.isArray(f.points)) fail(where, 'no outline');
  const points = (f.points as unknown[]).slice(0, 64).map((p, j) => {
    const q = obj(p, `${where} point ${j + 1}`);
    return { x: num(q.x, `${where} point ${j + 1}`, 0, -1000, 1000), y: num(q.y, `${where} point ${j + 1}`, 0, -1000, 1000) };
  });
  if (points.length < 3) fail(where, 'fewer than three points');
  return { surfaceId: f.surfaceId as string, role: role as FaceRole, origin: vec(f.origin, `${where} origin`, [0, 0, 0]), u, v, points, depth: num(f.depth, `${where} depth`, 0.05, 0.005, 20) };
}

export function validateRoom(raw: unknown): Room {
  const r = obj(raw, 'settings');
  const d = defaultRoom();
  const source = r.source === undefined ? d.source : r.source;
  if (source !== 'manual' && source !== 'phone') fail('source', `unknown source ${String(source)}`);
  const p = obj(r.projector, 'projector');
  const projector: RoomProjector = {
    position: vec(p.position, 'projector position', d.projector.position),
    target: vec(p.target, 'projector target', d.projector.target),
    fov: num(p.fov, 'projector fov', d.projector.fov, 5, 120),
  };
  if (length(sub(projector.target, projector.position)) < 1e-3) projector.target = add(projector.position, [0, 0, -1]);
  if (r.faces !== undefined && !Array.isArray(r.faces)) fail('faces', 'not a list');
  const faces = ((r.faces as unknown[] | undefined) ?? []).slice(0, MAX_ROOM_FACES).map(validateFace);
  if (r.floor !== undefined && typeof r.floor !== 'boolean') fail('floor', 'not true or false');
  return { source: source as Room['source'], ...(r.setup !== undefined ? { setup: validateSetup(r.setup) } : {}), projector, down: unit(r.down, 'down', d.down), floor: (r.floor as boolean | undefined) ?? d.floor, faces };
}
