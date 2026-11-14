/**
 * Rooms to test against: a pyramid of three 1 m boxes on the ground, as the
 * projector sees it, with the true faces to compare a solve with.
 */
import type { Point } from '../mobile/studio/interactive';
import { dot, facePoint, faceNormal, normalize, sub, type FaceRole, type RoomFace } from './roomModel';
import type { Vec3 } from './sceneModel';
import { projectorBasis, projectPoint, type ProjectorBasis } from './worldGeometry';

/** Turns a point about Z by `a` degrees (tilting the whole room, gravity and all). */
export const tilt = (p: Vec3, a: number): Vec3 => {
  const c = Math.cos((a * Math.PI) / 180), s = Math.sin((a * Math.PI) / 180);
  return [p[0] * c - p[1] * s, p[0] * s + p[1] * c, p[2]];
};

export type BoxPyramid = {
  /** The faces the projector sees, in the room's own frame. */
  faces: RoomFace[];
  pr: ProjectorBasis;
  /** Each face's outline on the output. */
  surfaces: { id: string; points: Point[] }[];
  /** Down on the output, and how far the projector's axis dips: what a person sets. */
  arrow: Point;
  elevation: number;
  down: Vec3;
  /** The boxes' middles; each is 1 m across. */
  boxes: Vec3[];
};

/** A pyramid of three 1 m boxes on the ground, each face the projector sees, the room tilted by `roll`. */
export function boxPyramid(position: Vec3, target: Vec3, fov: number, aspect: number, roll = 0, shift: [number, number] = [0, 0]): BoxPyramid {
  const sq = [{ x: -0.5, y: -0.5 }, { x: 0.5, y: -0.5 }, { x: 0.5, y: 0.5 }, { x: -0.5, y: 0.5 }];
  const kinds = [
    { name: 'top', o: [0, 0.5, 0], u: [1, 0, 0], v: [0, 0, -1], role: 'top' },
    { name: 'front', o: [0, 0, 0.5], u: [1, 0, 0], v: [0, 1, 0], role: 'side' },
    { name: 'right', o: [0.5, 0, 0], u: [0, 0, -1], v: [0, 1, 0], role: 'side' },
    { name: 'left', o: [-0.5, 0, 0], u: [0, 0, 1], v: [0, 1, 0], role: 'side' },
  ] as const;
  const faces: RoomFace[] = [];
  const boxes: Vec3[] = [[-0.56, 0.5, 0], [0.56, 0.5, 0], [0, 1.5, 0]];
  boxes.forEach((c, b) => {
    for (const k of kinds) {
      const face: RoomFace = {
        surfaceId: `b${b}-${k.name}`, role: k.role as FaceRole,
        origin: tilt([c[0] + k.o[0], c[1] + k.o[1], c[2] + k.o[2]], roll), u: tilt([...k.u] as Vec3, roll), v: tilt([...k.v] as Vec3, roll),
        points: sq, depth: 1,
      };
      if (dot(faceNormal(face), sub(position, face.origin)) > 0.05) faces.push(face);
    }
  });
  const pr = projectorBasis(position, target, fov, aspect, shift);
  const down = tilt([0, -1, 0], roll);
  const surfaces = faces.map((f) => ({ id: f.surfaceId, points: f.points.map((p) => projectPoint(pr, facePoint(f, p))) }));
  // What a person would set: down on the output at its middle, and how far the axis dips.
  const across = normalize(pr.right), upward = normalize(pr.up);
  const arrow = { x: dot(down, across), y: -dot(down, upward) };
  const elevation = (Math.asin(dot(pr.fwd, down)) * 180) / Math.PI;
  return { faces, pr, surfaces, arrow, elevation, down, boxes: boxes.map((b) => tilt(b, roll)) };
}

/** A world point in the projector's own frame (x right, y up, looking down −Z). */
export const inProjector = (pr: ProjectorBasis, p: Vec3): Vec3 => {
  const r = sub(p, pr.pos);
  return [dot(r, normalize(pr.right)), dot(r, normalize(pr.up)), -dot(r, pr.fwd)];
};
export const dirInProjector = (pr: ProjectorBasis, d: Vec3): Vec3 => [dot(d, normalize(pr.right)), dot(d, normalize(pr.up)), -dot(d, pr.fwd)];

/**
 * What the phone would capture of the pyramid: each face's outline on the
 * output, and a grid of points on it measured in 3D (with `noise` meters of
 * depth error) at the projector pixels the stripes decode there (with
 * `pixelNoise` output units of error).
 */
export function pyramidCapture(p: BoxPyramid, noise = 0, pixelNoise = 0, seed = 1) {
  let r = seed;
  const rand = () => ((r = (r * 16807) % 2147483647) / 2147483647) * 2 - 1;
  return {
    down: p.down,
    surfaces: p.faces.map((f) => {
      const samples: { p: Vec3; uv: Point }[] = [];
      for (let i = 0; i < 6; i++) {
        for (let j = 0; j < 6; j++) {
          const at = facePoint(f, { x: -0.4 + (i * 0.8) / 5, y: -0.4 + (j * 0.8) / 5 });
          const uv = projectPoint(p.pr, at);
          samples.push({ p: [at[0] + rand() * noise, at[1] + rand() * noise, at[2] + rand() * noise], uv: { x: uv.x + rand() * pixelNoise, y: uv.y + rand() * pixelNoise } });
        }
      }
      return { id: f.surfaceId, name: f.surfaceId, outline: p.surfaces.find((s) => s.id === f.surfaceId)!.points, samples };
    }),
  };
}
