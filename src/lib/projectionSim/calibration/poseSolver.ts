/**
 * Projector pose and lens from 3D-2D point matches.
 *
 * The operator clicks features on the model (world points) and drags a
 * crosshair onto the same features on the real projector's output (image
 * points). This solves the pinhole model that maps one onto the other:
 *
 *  1. DLT on Hartley-normalised coordinates for an initial 3x4 camera
 *     matrix, decomposed into K [R | t] with an RQ step.
 *     With a fixed lens and coplanar points the DLT is singular, so the
 *     initial pose comes from the plane homography instead.
 *  2. Levenberg-Marquardt on the reprojection error: rotation (local
 *     rotation-vector steps), translation, and, unless the lens is fixed,
 *     one focal length (square pixels) and the principal point.
 *
 * Failures come back as `{ ok: false }` with a code and a message the UI
 * can show as is; nothing throws on bad input.
 */
import {
  cross3,
  dot3,
  mat3Det,
  mat3Mul,
  mat3MulVec,
  mat3Transpose,
  norm3,
  nullVector,
  orthonormalize,
  rodrigues,
  rq3,
  scale3,
  solveLinear,
  sub3,
  svd,
  type Mat3,
  type Vec3,
} from './linalg';
import type { ProjectorCameraModel } from '../projectorLens';

export const MIN_CALIBRATION_POINTS = 6;

export interface PoseCorrespondence {
  world: Vec3 | [number, number, number];
  /** Image pixel, x right, y down. */
  image: [number, number];
}

export interface PoseSolveOptions {
  imageWidth: number;
  imageHeight: number;
  /** Keep this lens and solve the pose only. */
  fixedIntrinsics?: { f: number; cx: number; cy: number } | null;
  maxIterations?: number;
}

export type PoseSolveFailureCode =
  | 'too-few-points'
  | 'invalid-input'
  | 'coplanar'
  | 'degenerate'
  | 'behind-projector'
  | 'did-not-converge';

export interface PoseSolveSuccess {
  ok: true;
  model: ProjectorCameraModel;
  /** Camera centre in world space. */
  position: Vec3;
  /** Reprojection error per correspondence, pixels. */
  errors: number[];
  rms: number;
  iterations: number;
  mode: 'free' | 'fixed';
  /** Set when the configuration is solvable but weak (for example nearly
   *  flat points with a free lens). */
  warning?: string;
}

export interface PoseSolveFailure {
  ok: false;
  code: PoseSolveFailureCode;
  message: string;
}

export type PoseSolveResult = PoseSolveSuccess | PoseSolveFailure;

/** Relative thickness (smallest over largest spread of the points) below
 *  which the points are treated as coplanar. */
const COPLANAR_RATIO = 0.004;
/** Below this the lens is only weakly constrained with free intrinsics. */
const NEAR_FLAT_RATIO = 0.06;

function fail(code: PoseSolveFailureCode, message: string): PoseSolveFailure {
  return { ok: false, code, message };
}

interface Normalization3 {
  centroid: Vec3;
  scale: number;
}

function normalization3(points: Vec3[]): Normalization3 {
  const centroid: Vec3 = [0, 0, 0];
  for (const p of points) {
    centroid[0] += p[0] / points.length;
    centroid[1] += p[1] / points.length;
    centroid[2] += p[2] / points.length;
  }
  let meanDistance = 0;
  for (const p of points) meanDistance += norm3(sub3(p, centroid)) / points.length;
  return { centroid, scale: meanDistance > 0 ? Math.sqrt(3) / meanDistance : 1 };
}

function normalization2(points: [number, number][]): { cx: number; cy: number; scale: number } {
  let cx = 0;
  let cy = 0;
  for (const p of points) {
    cx += p[0] / points.length;
    cy += p[1] / points.length;
  }
  let meanDistance = 0;
  for (const p of points) meanDistance += Math.hypot(p[0] - cx, p[1] - cy) / points.length;
  return { cx, cy, scale: meanDistance > 0 ? Math.SQRT2 / meanDistance : 1 };
}

/** Singular values of the centred point cloud, largest first. */
function pointSpread(points: Vec3[]): { values: number[]; normal: Vec3; axes: Vec3[]; centroid: Vec3 } {
  const { centroid } = normalization3(points);
  const centred = points.map((p) => sub3(p, centroid) as number[]);
  const { S, V } = svd(centred);
  const axes = [0, 1, 2].map((j) => [V[0][j], V[1][j], V[2][j]] as Vec3);
  return { values: S, normal: axes[2], axes, centroid };
}

interface InitialPose {
  R: Mat3;
  t: Vec3;
  f: number;
  cx: number;
  cy: number;
}

/** DLT camera matrix from normalised coordinates, decomposed into K [R|t]. */
function dltInitialPose(world: Vec3[], image: [number, number][]): InitialPose | PoseSolveFailure {
  const n3 = normalization3(world);
  const n2 = normalization2(image);
  const A: number[][] = [];
  for (let i = 0; i < world.length; i++) {
    const X = scale3(sub3(world[i], n3.centroid), n3.scale);
    const u = (image[i][0] - n2.cx) * n2.scale;
    const v = (image[i][1] - n2.cy) * n2.scale;
    A.push([X[0], X[1], X[2], 1, 0, 0, 0, 0, -u * X[0], -u * X[1], -u * X[2], -u]);
    A.push([0, 0, 0, 0, X[0], X[1], X[2], 1, -v * X[0], -v * X[1], -v * X[2], -v]);
  }
  const { vector, secondSmallest, largest } = nullVector(A);
  if (!(secondSmallest > largest * 1e-7)) {
    return fail('degenerate', 'These points do not pin down a projector. Spread them across the object and avoid repeating a point.');
  }
  // P~ in normalised space, rows of 4.
  const Pn = [vector.slice(0, 4), vector.slice(4, 8), vector.slice(8, 12)];
  // Undo the normalisations: P = T2^-1 * Pn * T3.
  const s3 = n3.scale;
  const c3 = n3.centroid;
  const T3 = [
    [s3, 0, 0, -s3 * c3[0]],
    [0, s3, 0, -s3 * c3[1]],
    [0, 0, s3, -s3 * c3[2]],
    [0, 0, 0, 1],
  ];
  const T2inv = [
    [1 / n2.scale, 0, n2.cx],
    [0, 1 / n2.scale, n2.cy],
    [0, 0, 1],
  ];
  const PnT3 = Pn.map((row) => [0, 1, 2, 3].map((j) => row.reduce((sum, value, k) => sum + value * T3[k][j], 0)));
  let P = T2inv.map((row) => [0, 1, 2, 3].map((j) => row.reduce((sum, value, k) => sum + value * PnT3[k][j], 0)));

  let M: Mat3 = [
    [P[0][0], P[0][1], P[0][2]],
    [P[1][0], P[1][1], P[1][2]],
    [P[2][0], P[2][1], P[2][2]],
  ];
  if (mat3Det(M) < 0) {
    P = P.map((row) => row.map((value) => -value));
    M = M.map((row) => row.map((value) => -value)) as Mat3;
  }
  const decomposed = rq3(M);
  if (!decomposed) return fail('degenerate', 'The point layout is degenerate. Spread the points out in depth.');
  const { K, R } = decomposed;
  const k33 = K[2][2];
  const Kn = K.map((row) => row.map((value) => value / k33)) as Mat3;
  // t = K^-1 p4 (scaled by the same factor as K).
  const p4: Vec3 = [P[0][3] / k33, P[1][3] / k33, P[2][3] / k33];
  const t2 = p4[2];
  const t1 = (p4[1] - Kn[1][2] * t2) / Kn[1][1];
  const t0 = (p4[0] - Kn[0][1] * t1 - Kn[0][2] * t2) / Kn[0][0];
  const f = (Kn[0][0] + Kn[1][1]) / 2;
  if (!(f > 0) || !Number.isFinite(f)) return fail('degenerate', 'Could not find a lens that fits these points.');
  return { R: orthonormalize(R), t: [t0, t1, t2], f, cx: Kn[0][2], cy: Kn[1][2] };
}

/** Pose of a fixed lens from coplanar points via the plane homography. */
function planarInitialPose(
  world: Vec3[],
  image: [number, number][],
  lens: { f: number; cx: number; cy: number },
): InitialPose | PoseSolveFailure {
  const spread = pointSpread(world);
  const [ax, ay] = spread.axes;
  const origin = spread.centroid;
  const plane = world.map((p) => {
    const d = sub3(p, origin);
    return [dot3(d, ax), dot3(d, ay)] as [number, number];
  });
  const rays = image.map((p) => [(p[0] - lens.cx) / lens.f, (p[1] - lens.cy) / lens.f] as [number, number]);
  const nA = normalization2(plane);
  const nB = normalization2(rays);
  const A: number[][] = [];
  for (let i = 0; i < plane.length; i++) {
    const x = (plane[i][0] - nA.cx) * nA.scale;
    const y = (plane[i][1] - nA.cy) * nA.scale;
    const u = (rays[i][0] - nB.cx) * nB.scale;
    const v = (rays[i][1] - nB.cy) * nB.scale;
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, -u]);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, -v]);
  }
  const { vector, secondSmallest, largest } = nullVector(A);
  if (!(secondSmallest > largest * 1e-7)) {
    return fail('degenerate', 'These points do not pin down a projector. Spread them across the surface.');
  }
  const Hn = [vector.slice(0, 3), vector.slice(3, 6), vector.slice(6, 9)];
  const TA = [[nA.scale, 0, -nA.scale * nA.cx], [0, nA.scale, -nA.scale * nA.cy], [0, 0, 1]];
  const TBinv = [[1 / nB.scale, 0, nB.cx], [0, 1 / nB.scale, nB.cy], [0, 0, 1]];
  const mul = (X: number[][], Y: number[][]) => X.map((row) => [0, 1, 2].map((j) => row.reduce((s, v, k) => s + v * Y[k][j], 0)));
  const H = mul(mul(TBinv, Hn), TA);
  const h1: Vec3 = [H[0][0], H[1][0], H[2][0]];
  const h2: Vec3 = [H[0][1], H[1][1], H[2][1]];
  const h3: Vec3 = [H[0][2], H[1][2], H[2][2]];
  let lambda = 2 / (norm3(h1) + norm3(h2));
  // The plane origin must land in front of the lens.
  if (h3[2] * lambda < 0) lambda = -lambda;
  const r1 = scale3(h1, lambda);
  const r2 = scale3(h2, lambda);
  const r3 = cross3(r1, r2);
  // Columns r1, r2, r3 map plane axes to camera axes.
  const Rplane = orthonormalize([
    [r1[0], r2[0], r3[0]],
    [r1[1], r2[1], r3[1]],
    [r1[2], r2[2], r3[2]],
  ]);
  const tPlane = scale3(h3, lambda);
  // World -> plane frame: rows ax, ay, normal; x_cam = Rplane * (B (X - origin)) + tPlane.
  const normal = cross3(ax, ay);
  const B: Mat3 = [ax, ay, normal];
  const R = mat3Mul(Rplane, B);
  const t = sub3(tPlane, mat3MulVec(R, origin));
  return { R, t, f: lens.f, cx: lens.cx, cy: lens.cy };
}

interface LmState {
  R: Mat3;
  t: Vec3;
  intr: number[];
}

/** Levenberg-Marquardt on the reprojection error. World points are passed
 *  already normalised (centred and scaled) for a well-conditioned problem. */
function refine(
  world: Vec3[],
  image: [number, number][],
  start: LmState,
  freeIntrinsics: boolean,
  maxIterations: number,
): { state: LmState; iterations: number; cost: number; converged: boolean } {
  const nParams = freeIntrinsics ? 9 : 6;
  const residuals = (state: LmState, delta: number[]): number[] | null => {
    const R = mat3Mul(rodrigues([delta[0], delta[1], delta[2]]), state.R);
    const t: Vec3 = [state.t[0] + delta[3], state.t[1] + delta[4], state.t[2] + delta[5]];
    const f = freeIntrinsics ? state.intr[0] + delta[6] : state.intr[0];
    const cx = freeIntrinsics ? state.intr[1] + delta[7] : state.intr[1];
    const cy = freeIntrinsics ? state.intr[2] + delta[8] : state.intr[2];
    const out: number[] = [];
    for (let i = 0; i < world.length; i++) {
      const xc = mat3MulVec(R, world[i]);
      const z = xc[2] + t[2];
      if (!(z > 1e-9)) return null;
      out.push(f * ((xc[0] + t[0]) / z) + cx - image[i][0]);
      out.push(f * ((xc[1] + t[1]) / z) + cy - image[i][1]);
    }
    return out;
  };
  const costOf = (r: number[]) => r.reduce((sum, value) => sum + value * value, 0);
  const zero = new Array<number>(nParams).fill(0);
  let state: LmState = { R: start.R, t: [...start.t] as Vec3, intr: [...start.intr] };
  let r = residuals(state, zero);
  if (!r) return { state, iterations: 0, cost: Infinity, converged: false };
  let cost = costOf(r);
  let lambda = 1e-3;
  let converged = false;
  let iteration = 0;
  for (; iteration < maxIterations; iteration++) {
    // Central-difference Jacobian around the current state.
    const J: number[][] = r.map(() => new Array<number>(nParams).fill(0));
    let jacobianOk = true;
    for (let j = 0; j < nParams; j++) {
      const base = j < 6 ? 1 : Math.max(1, Math.abs(state.intr[j - 6]));
      const h = 1e-6 * base;
      const plus = zero.slice();
      const minus = zero.slice();
      plus[j] = h;
      minus[j] = -h;
      const rp = residuals(state, plus);
      const rm = residuals(state, minus);
      if (!rp || !rm) {
        jacobianOk = false;
        break;
      }
      for (let i = 0; i < r.length; i++) J[i][j] = (rp[i] - rm[i]) / (2 * h);
    }
    if (!jacobianOk) break;
    const JtJ: number[][] = Array.from({ length: nParams }, () => new Array<number>(nParams).fill(0));
    const Jtr = new Array<number>(nParams).fill(0);
    for (let i = 0; i < r.length; i++) {
      const row = J[i];
      for (let a = 0; a < nParams; a++) {
        Jtr[a] += row[a] * r[i];
        for (let b = a; b < nParams; b++) JtJ[a][b] += row[a] * row[b];
      }
    }
    for (let a = 0; a < nParams; a++) for (let b = 0; b < a; b++) JtJ[a][b] = JtJ[b][a];
    const gradientNorm = Math.sqrt(Jtr.reduce((sum, value) => sum + value * value, 0));
    if (gradientNorm < 1e-14 * Math.max(1, cost)) {
      converged = true;
      break;
    }

    let accepted = false;
    for (let attempt = 0; attempt < 12; attempt++) {
      const Aug = JtJ.map((row, a) => row.map((value, b) => (a === b ? value + lambda * Math.max(value, 1e-12) : value)));
      const step = solveLinear(Aug, Jtr.map((value) => -value));
      if (!step) {
        lambda *= 10;
        continue;
      }
      const candidate = residuals(state, step);
      const candidateCost = candidate ? costOf(candidate) : Infinity;
      if (candidate && candidateCost < cost) {
        const R = orthonormalize(mat3Mul(rodrigues([step[0], step[1], step[2]]), state.R));
        const t: Vec3 = [state.t[0] + step[3], state.t[1] + step[4], state.t[2] + step[5]];
        const intr = freeIntrinsics
          ? [state.intr[0] + step[6], state.intr[1] + step[7], state.intr[2] + step[8]]
          : state.intr;
        const previousCost = cost;
        state = { R, t, intr };
        r = residuals(state, zero) ?? candidate;
        cost = costOf(r);
        lambda = Math.max(lambda / 3, 1e-12);
        accepted = true;
        const stepNorm = Math.sqrt(step.reduce((sum, value) => sum + value * value, 0));
        if (previousCost - cost <= 1e-15 * previousCost + 1e-24 || stepNorm < 1e-13) converged = true;
        break;
      }
      lambda *= 4;
    }
    if (!accepted) {
      // No step reduces the cost any more: a local minimum.
      converged = true;
      break;
    }
    if (converged) break;
  }
  return { state, iterations: iteration + 1, cost, converged };
}

/** Solve a projector's pose (and lens, unless fixed) from point matches. */
export function solveProjectorPose(correspondences: PoseCorrespondence[], options: PoseSolveOptions): PoseSolveResult {
  const width = options.imageWidth;
  const height = options.imageHeight;
  if (!(width > 0) || !(height > 0)) return fail('invalid-input', 'The projector output size must be positive.');
  const usable = correspondences.filter((c) =>
    c.world.every(Number.isFinite) && c.image.every(Number.isFinite));
  if (usable.length !== correspondences.length) return fail('invalid-input', 'Some points have no position yet.');
  if (usable.length < MIN_CALIBRATION_POINTS) {
    return fail('too-few-points', `Match at least ${MIN_CALIBRATION_POINTS} points (${usable.length} so far).`);
  }
  const world = usable.map((c) => [c.world[0], c.world[1], c.world[2]] as Vec3);
  const image = usable.map((c) => [c.image[0], c.image[1]] as [number, number]);
  const fixed = options.fixedIntrinsics ?? null;
  if (fixed && !(fixed.f > 0)) return fail('invalid-input', 'The fixed lens needs a positive focal length.');

  const spread = pointSpread(world);
  if (!(spread.values[0] > 0)) return fail('degenerate', 'All points are in the same place.');
  const flatness = spread.values[2] / spread.values[0];
  const lineness = spread.values[1] / spread.values[0];
  if (lineness < COPLANAR_RATIO) return fail('degenerate', 'The points lie on a line. Pick points spread across the object.');
  const coplanar = flatness < COPLANAR_RATIO;
  if (coplanar && !fixed) {
    return fail('coplanar', 'All points are on one flat surface, which cannot fix the lens. Add points at other depths, or turn on Fixed lens.');
  }

  const initial = coplanar && fixed
    ? planarInitialPose(world, image, fixed)
    : dltInitialPose(world, image);
  if ('ok' in initial) return initial;
  if (fixed) {
    initial.f = fixed.f;
    initial.cx = fixed.cx;
    initial.cy = fixed.cy;
  }

  // Depths of the points under the initial pose: they must be in front.
  const inFront = world.filter((X) => dot3(initial.R[2] as Vec3, X) + initial.t[2] > 0).length;
  if (inFront < world.length) {
    if (inFront === 0 && !coplanar) {
      return fail('behind-projector', 'These matches put the object behind the projector. Check that each crosshair sits on the right feature.');
    }
  }

  // Normalise the world for the refinement: X' = (X - c) * s, so that
  // x_cam = R X + t = (R X' + t') / s with t' = (R c + t) * s.
  const norm = normalization3(world);
  const worldN = world.map((X) => scale3(sub3(X, norm.centroid), norm.scale));
  const Rc = mat3MulVec(initial.R, norm.centroid);
  const tN: Vec3 = scale3([Rc[0] + initial.t[0], Rc[1] + initial.t[1], Rc[2] + initial.t[2]], norm.scale);

  const freeIntrinsics = !fixed;
  const refined = refine(
    worldN,
    image,
    { R: initial.R, t: tN, intr: [initial.f, initial.cx, initial.cy] },
    freeIntrinsics,
    options.maxIterations ?? 400,
  );
  if (!Number.isFinite(refined.cost)) {
    return fail('behind-projector', 'These matches put part of the object behind the projector. Check the crosshair positions.');
  }
  const { R, intr } = refined.state;
  const Rc2 = mat3MulVec(R, norm.centroid);
  const t = sub3(scale3(refined.state.t, 1 / norm.scale), Rc2);
  const [f, cx, cy] = intr;
  if (!(f > 0) || !Number.isFinite(f)) return fail('did-not-converge', 'The solve did not settle on a usable lens. Check the matches.');

  const model: ProjectorCameraModel = { R, t, f, cx, cy, width, height };
  const errors = world.map((X, i) => {
    const xc = mat3MulVec(R, X);
    const z = xc[2] + t[2];
    const u = f * ((xc[0] + t[0]) / z) + cx;
    const v = f * ((xc[1] + t[1]) / z) + cy;
    return Math.hypot(u - image[i][0], v - image[i][1]);
  });
  if (world.some((X) => dot3(R[2] as Vec3, X) + t[2] <= 0)) {
    return fail('behind-projector', 'The best fit puts some points behind the projector. Check the crosshair positions.');
  }
  const rms = Math.sqrt(errors.reduce((sum, e) => sum + e * e, 0) / errors.length);
  const position: Vec3 = [
    -(R[0][0] * t[0] + R[1][0] * t[1] + R[2][0] * t[2]),
    -(R[0][1] * t[0] + R[1][1] * t[1] + R[2][1] * t[2]),
    -(R[0][2] * t[0] + R[1][2] * t[1] + R[2][2] * t[2]),
  ];
  let warning: string | undefined;
  if (!fixed && flatness < NEAR_FLAT_RATIO) {
    warning = 'The points are nearly flat, so the lens is only loosely fixed. Add points at other depths or use Fixed lens.';
  } else if (!refined.converged) {
    warning = 'The solve stopped before fully settling. The result may improve with more points.';
  }
  return {
    ok: true,
    model,
    position,
    errors,
    rms,
    iterations: refined.iterations,
    mode: fixed ? 'fixed' : 'free',
    ...(warning ? { warning } : {}),
  };
}

/** Relative rotation angle between two camera models, degrees. */
export function rotationErrorDegrees(a: Mat3, b: Mat3): number {
  const D = mat3Mul(a, mat3Transpose(b));
  const cos = (D[0][0] + D[1][1] + D[2][2] - 1) / 2;
  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
}

