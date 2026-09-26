/**
 * The projector lens model shared by the Map Sim preview, the native
 * projector-view output and the calibration solver.
 *
 * A projector is a pinhole camera with square pixels:
 *  - pose: position, a look-at target and a roll about the lens axis;
 *  - lens: vertical field of view, image aspect and lens shift.
 *
 * Two conventions meet here. Rendering uses the GL/three.js camera (looks
 * down -Z, +Y up, NDC in [-1, 1]). Calibration uses the computer-vision
 * camera (looks down +Z, +Y down) with pixel coordinates (x right, y down).
 * Both are derived from the same basis so they cannot drift apart:
 *
 *   x_ndc = fxn * Xc / Zc + ox        u = W/2 * (1 + x_ndc)
 *   y_ndc = -fyn * Yc / Zc + oy       v = H/2 * (1 - y_ndc)
 *
 * with fyn = 1 / tan(fov/2), fxn = fyn / aspect and the NDC principal
 * point (ox, oy) = (-2 * shiftX, -2 * shiftY). So f = H / (2 tan(fov/2))
 * pixels, cx = W/2 * (1 - 2 shiftX) and cy = H/2 * (1 + 2 shiftY).
 */
import type { ProjectionSimProjector, ProjectionSimVec3 } from './types';
import {
  cross3,
  dot3,
  normalize3,
  norm3,
  scale3,
  sub3,
  add3,
  mat3MulVec,
  type Mat3,
  type Vec3,
} from './calibration/linalg';

export const DEFAULT_PROJECTOR_NEAR = 0.1;
export const DEFAULT_PROJECTOR_FAR = 120;
export const DEFAULT_CALIBRATION_WIDTH = 1920;

export type ProjectorLensLike = Pick<ProjectionSimProjector, 'position' | 'target' | 'fov' | 'aspect'>
  & Partial<Pick<ProjectionSimProjector, 'lensShift' | 'roll' | 'near' | 'far'>>;

/** Pinhole model in pixels: x_cam = R X + t, u = f x/z + cx, v = f y/z + cy
 *  (computer-vision camera, +Y down, +Z forward). */
export interface ProjectorCameraModel {
  R: Mat3;
  t: Vec3;
  f: number;
  cx: number;
  cy: number;
  width: number;
  height: number;
}

/** Orthonormal basis of the GL camera in world space: x right, y up, z
 *  backwards (the camera looks down -z). */
export interface ProjectorBasis {
  x: Vec3;
  y: Vec3;
  z: Vec3;
}

const WORLD_UP: Vec3 = [0, 1, 0];

function lensShiftOf(p: ProjectorLensLike): [number, number] {
  const shift = p.lensShift;
  return [Number.isFinite(shift?.[0]) ? shift![0] : 0, Number.isFinite(shift?.[1]) ? shift![1] : 0];
}

export function projectorNear(p: ProjectorLensLike): number {
  return Math.max(1e-4, Number.isFinite(p.near) ? p.near! : DEFAULT_PROJECTOR_NEAR);
}

export function projectorFar(p: ProjectorLensLike): number {
  return Math.max(projectorNear(p) * 2, Number.isFinite(p.far) ? p.far! : DEFAULT_PROJECTOR_FAR);
}

export function projectorAspect(p: ProjectorLensLike): number {
  return p.aspect > 0 && Number.isFinite(p.aspect) ? p.aspect : 16 / 9;
}

/** Look-at basis with world +Y up, then rolled about the lens axis. Matches
 *  three.js Matrix4.lookAt, including its nudge when looking straight up or
 *  down, so an un-rolled projector keeps the pose it always had. */
export function projectorBasis(p: ProjectorLensLike): ProjectorBasis {
  let z = sub3(p.position as Vec3, p.target as Vec3);
  if (norm3(z) === 0) z = [0, 0, 1];
  z = normalize3(z);
  let x = cross3(WORLD_UP, z);
  if (norm3(x) === 0) {
    if (Math.abs(WORLD_UP[2]) === 1) z = normalize3([z[0] + 0.0001, z[1], z[2]]);
    else z = normalize3([z[0], z[1], z[2] + 0.0001]);
    x = cross3(WORLD_UP, z);
  }
  x = normalize3(x);
  let y = cross3(z, x);
  const roll = ((p.roll ?? 0) * Math.PI) / 180;
  if (roll !== 0 && Number.isFinite(roll)) {
    const c = Math.cos(roll);
    const s = Math.sin(roll);
    const rx = add3(scale3(x, c), scale3(y, s));
    const ry = add3(scale3(x, -s), scale3(y, c));
    x = rx;
    y = ry;
  }
  return { x, y, z };
}

/** Column-major world -> camera matrix (GL convention). */
export function projectorViewMatrix(p: ProjectorLensLike): number[] {
  const { x, y, z } = projectorBasis(p);
  const c = p.position as Vec3;
  return [
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -dot3(x, c), -dot3(y, c), -dot3(z, c), 1,
  ];
}

/** Column-major camera -> world matrix (the camera's matrixWorld). */
export function projectorWorldMatrix(p: ProjectorLensLike): number[] {
  const { x, y, z } = projectorBasis(p);
  const c = p.position as Vec3;
  return [
    x[0], x[1], x[2], 0,
    y[0], y[1], y[2], 0,
    z[0], z[1], z[2], 0,
    c[0], c[1], c[2], 1,
  ];
}

/** NDC scale and principal point of the lens. */
export function projectorNdcIntrinsics(p: ProjectorLensLike): { fxn: number; fyn: number; ox: number; oy: number } {
  const fov = Math.min(170, Math.max(0.5, p.fov || 34));
  const fyn = 1 / Math.tan((fov * Math.PI) / 360);
  const fxn = fyn / projectorAspect(p);
  const [sx, sy] = lensShiftOf(p);
  return { fxn, fyn, ox: -2 * sx, oy: -2 * sy };
}

/** Column-major GL projection matrix with lens shift (clip z in [-1, 1]). */
export function projectorProjectionMatrix(p: ProjectorLensLike): number[] {
  const { fxn, fyn, ox, oy } = projectorNdcIntrinsics(p);
  const n = projectorNear(p);
  const f = projectorFar(p);
  return [
    fxn, 0, 0, 0,
    0, fyn, 0, 0,
    -ox, -oy, -(f + n) / (f - n), -1,
    0, 0, (-2 * f * n) / (f - n), 0,
  ];
}

export function multiplyMat4(a: number[], b: number[]): number[] {
  const out = new Array<number>(16).fill(0);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[col * 4 + k];
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

export function projectorViewProjectionMatrix(p: ProjectorLensLike): number[] {
  return multiplyMat4(projectorProjectionMatrix(p), projectorViewMatrix(p));
}

/** Frustum corners on a plane `distance` in front of the lens, in camera
 *  space (GL convention), ordered bottom-left, bottom-right, top-right,
 *  top-left. Used for the beam wireframe. */
export function projectorFrustumCorners(p: ProjectorLensLike, distance: number): Vec3[] {
  const { fxn, fyn, ox, oy } = projectorNdcIntrinsics(p);
  const corner = (nx: number, ny: number): Vec3 => [
    (distance * (nx - ox)) / fxn,
    (distance * (ny - oy)) / fyn,
    -distance,
  ];
  return [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
}

/** Calibration image size for a projector: an explicit calibration size,
 *  else 1920 wide at the projector's aspect. */
export function projectorImageSize(p: ProjectionSimProjector): [number, number] {
  const size = p.calibration?.imageSize;
  if (size && size[0] > 0 && size[1] > 0) return [size[0], size[1]];
  return [DEFAULT_CALIBRATION_WIDTH, Math.round(DEFAULT_CALIBRATION_WIDTH / projectorAspect(p))];
}

/** Pixel pinhole model of a projector for an image of width x height. */
export function projectorCameraModel(p: ProjectorLensLike, width: number, height: number): ProjectorCameraModel {
  const { x, y, z } = projectorBasis(p);
  // Computer-vision axes: x right, y down, z forward.
  const R: Mat3 = [
    [x[0], x[1], x[2]],
    [-y[0], -y[1], -y[2]],
    [-z[0], -z[1], -z[2]],
  ];
  const c = p.position as Vec3;
  const Rc = mat3MulVec(R, c);
  const t: Vec3 = [-Rc[0], -Rc[1], -Rc[2]];
  const { fyn, ox, oy } = projectorNdcIntrinsics(p);
  return {
    R,
    t,
    f: (height / 2) * fyn,
    cx: (width / 2) * (1 + ox),
    cy: (height / 2) * (1 - oy),
    width,
    height,
  };
}

/** Project a world point to image pixels. Returns null behind the lens. */
export function projectToImage(model: ProjectorCameraModel, X: Vec3 | ProjectionSimVec3): [number, number] | null {
  const xc = add3(mat3MulVec(model.R, X as Vec3), model.t);
  if (!(xc[2] > 1e-9)) return null;
  return [model.f * (xc[0] / xc[2]) + model.cx, model.f * (xc[1] / xc[2]) + model.cy];
}

export function cameraCenter(model: Pick<ProjectorCameraModel, 'R' | 't'>): Vec3 {
  const { R, t } = model;
  return [
    -(R[0][0] * t[0] + R[1][0] * t[1] + R[2][0] * t[2]),
    -(R[0][1] * t[0] + R[1][1] * t[1] + R[2][1] * t[2]),
    -(R[0][2] * t[0] + R[1][2] * t[1] + R[2][2] * t[2]),
  ];
}

function round(value: number, digits = 6): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

/** Projector fields that reproduce a pixel camera model. The look-at target
 *  sits `focusDistance` along the lens axis (callers pass the distance to
 *  the calibrated object so the gizmo stays near it), and the roll absorbs
 *  whatever the look-at basis cannot express. */
export function projectorPatchFromCameraModel(
  model: ProjectorCameraModel,
  focusDistance = 5,
): Pick<ProjectionSimProjector, 'position' | 'target' | 'roll' | 'fov' | 'aspect' | 'lensShift'> {
  const { R, f, cx, cy, width, height } = model;
  const position = cameraCenter(model);
  const forward: Vec3 = [R[2][0], R[2][1], R[2][2]];
  const distance = Math.max(0.05, Number.isFinite(focusDistance) ? focusDistance : 5);
  const target = add3(position, scale3(forward, distance));
  const aspect = width / height;
  const unrolled = projectorBasis({ position, target, fov: 30, aspect, roll: 0 });
  const actualX: Vec3 = [R[0][0], R[0][1], R[0][2]];
  const roll = (Math.atan2(dot3(actualX, unrolled.y), dot3(actualX, unrolled.x)) * 180) / Math.PI;
  const fov = (2 * Math.atan(height / (2 * f)) * 180) / Math.PI;
  return {
    position: position.map((v) => round(v)) as ProjectionSimVec3,
    target: target.map((v) => round(v)) as ProjectionSimVec3,
    roll: round(roll, 5),
    fov: round(fov, 6),
    aspect: round(aspect, 9),
    lensShift: [round((width / 2 - cx) / width, 7), round((cy - height / 2) / height, 7)],
  };
}

/** Throw ratio (throw distance / image width) of a projector's lens. */
export function projectorThrowRatio(p: ProjectorLensLike): number {
  const { fxn } = projectorNdcIntrinsics(p);
  return fxn / 2;
}

/** Vertical field of view (degrees) for a throw ratio at an aspect. */
export function fovFromThrowRatio(throwRatio: number, aspect: number): number {
  const tr = Math.max(0.05, throwRatio);
  const halfWidth = 1 / (2 * tr);
  return (2 * Math.atan(halfWidth / Math.max(1e-6, aspect)) * 180) / Math.PI;
}
