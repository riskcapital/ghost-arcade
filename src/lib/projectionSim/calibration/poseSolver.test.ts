/** Projector calibration solver: a known projector generates the matches,
 *  the solver has to recover it. Tolerances from the Map Sim 3D brief:
 *  position within 0.5% of the object size, rotation within 0.2 degrees,
 *  focal length within 1%.
 *
 *  The fixture is a small stage set (a 2 m block beside a 1.2 m plinth,
 *  4.4 m across) filling a 1920 x 1080 projector about 5.9 m away, the way
 *  a mapping projector is normally framed. Image noise of 0.3 px is about
 *  what whole-pixel crosshair placement gives. */
import { describe, expect, it } from 'vitest';
import { solveProjectorPose, rotationErrorDegrees, type PoseCorrespondence } from './poseSolver';
import {
  cameraCenter,
  projectToImage,
  projectorCameraModel,
  projectorPatchFromCameraModel,
  projectorViewProjectionMatrix,
  type ProjectorCameraModel,
  type ProjectorLensLike,
} from '../projectorLens';
import type { Vec3 } from './linalg';

const WIDTH = 1920;
const HEIGHT = 1080;
/** The calibrated set spans 4.4 m, so 0.5% is 2.2 cm. */
const OBJECT_SIZE = 4.4;

const TARGET: Vec3 = [-0.3, 0.3, 0];
const VIEW_DIRECTION: Vec3 = [-3.2, 2.2, 7.5];
const TRUE_PROJECTOR: ProjectorLensLike = {
  position: VIEW_DIRECTION.map((d, i) => (d / Math.hypot(...VIEW_DIRECTION)) * 5.5 + TARGET[i]) as Vec3,
  target: TARGET,
  roll: 3,
  fov: 38,
  aspect: WIDTH / HEIGHT,
  lensShift: [0.03, 0.1],
};

function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const gaussian = () => {
    const u = Math.max(1e-12, next());
    const v = next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  return { next, gaussian };
}

/** Corners and face points of the stage set. */
function setPoints(): Vec3[] {
  const points: Vec3[] = [];
  for (const x of [-2.2, -0.2]) for (const y of [0, 2]) for (const z of [-1, 1]) points.push([x, y, z]);
  for (const x of [0.4, 2.2]) for (const y of [0, 1.2]) for (const z of [-0.6, 0.6]) points.push([x, y, z]);
  points.push([-1.2, 2, 0], [1.3, 1.2, 0], [-1.2, 1, 1], [1.3, 0.6, 0.6], [0, 0, 1.6], [-2.8, 0, 1.4]);
  return points;
}

/** A 4.4 m facade in a grid, every other point pushed out by `relief`. */
function facadePoints(relief: number): Vec3[] {
  const points: Vec3[] = [];
  [-2.2, -0.8, 0.8, 2.2].forEach((x, i) => [0, 1, 2].forEach((y, j) => {
    points.push([x, y, (i + j) % 2 === 0 ? relief : -relief]);
  }));
  return points;
}

function matches(model: ProjectorCameraModel, world: Vec3[], noisePx: number, seed = 7): PoseCorrespondence[] {
  const random = rng(seed);
  return world.map((X) => {
    const uv = projectToImage(model, X);
    if (!uv) throw new Error('test point behind the projector');
    expect(uv[0]).toBeGreaterThan(0);
    expect(uv[0]).toBeLessThan(WIDTH);
    expect(uv[1]).toBeGreaterThan(0);
    expect(uv[1]).toBeLessThan(HEIGHT);
    return { world: X, image: [uv[0] + random.gaussian() * noisePx, uv[1] + random.gaussian() * noisePx] as [number, number] };
  });
}

function expectRecovered(result: ReturnType<typeof solveProjectorPose>, truth: ProjectorCameraModel) {
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const trueCenter = cameraCenter(truth);
  const positionError = Math.hypot(
    result.position[0] - trueCenter[0],
    result.position[1] - trueCenter[1],
    result.position[2] - trueCenter[2],
  );
  const rotationError = rotationErrorDegrees(result.model.R, truth.R);
  const focalError = Math.abs(result.model.f - truth.f) / truth.f;
  expect(positionError).toBeLessThan(0.005 * OBJECT_SIZE);
  expect(rotationError).toBeLessThan(0.2);
  expect(focalError).toBeLessThan(0.01);
  return { positionError, rotationError, focalError };
}

describe('projector lens model', () => {
  it('agrees with the GL view-projection matrix', () => {
    const model = projectorCameraModel(TRUE_PROJECTOR, WIDTH, HEIGHT);
    const vp = projectorViewProjectionMatrix(TRUE_PROJECTOR);
    for (const X of setPoints()) {
      const clip = [0, 1, 2, 3].map((row) => vp[row] * X[0] + vp[4 + row] * X[1] + vp[8 + row] * X[2] + vp[12 + row]);
      const u = (WIDTH / 2) * (1 + clip[0] / clip[3]);
      const v = (HEIGHT / 2) * (1 - clip[1] / clip[3]);
      const uv = projectToImage(model, X)!;
      expect(u).toBeCloseTo(uv[0], 6);
      expect(v).toBeCloseTo(uv[1], 6);
    }
  });

  it('round-trips a projector through the pixel camera model', () => {
    const model = projectorCameraModel(TRUE_PROJECTOR, WIDTH, HEIGHT);
    const patch = projectorPatchFromCameraModel(model, 6);
    expect(patch.fov).toBeCloseTo(TRUE_PROJECTOR.fov, 5);
    expect(patch.roll).toBeCloseTo(TRUE_PROJECTOR.roll!, 4);
    expect(patch.lensShift[0]).toBeCloseTo(TRUE_PROJECTOR.lensShift![0], 6);
    expect(patch.lensShift[1]).toBeCloseTo(TRUE_PROJECTOR.lensShift![1], 6);
    const again = projectorCameraModel({ ...TRUE_PROJECTOR, ...patch }, WIDTH, HEIGHT);
    expect(rotationErrorDegrees(again.R, model.R)).toBeLessThan(1e-4);
    expect(again.f).toBeCloseTo(model.f, 3);
    expect(again.cx).toBeCloseTo(model.cx, 3);
    expect(again.cy).toBeCloseTo(model.cy, 3);
  });

  it('puts a centred lens principal point in the image centre and shifts it with the lens', () => {
    const centred = projectorCameraModel({ ...TRUE_PROJECTOR, lensShift: [0, 0] }, WIDTH, HEIGHT);
    expect(centred.cx).toBeCloseTo(WIDTH / 2, 9);
    expect(centred.cy).toBeCloseTo(HEIGHT / 2, 9);
    // A +50% vertical shift puts the lens axis on the bottom edge.
    const shifted = projectorCameraModel({ ...TRUE_PROJECTOR, lensShift: [0, 0.5] }, WIDTH, HEIGHT);
    expect(shifted.cy).toBeCloseTo(HEIGHT, 9);
  });
});

describe('solveProjectorPose', () => {
  const truth = projectorCameraModel(TRUE_PROJECTOR, WIDTH, HEIGHT);

  it('recovers an exact projector from noise-free matches', () => {
    const result = solveProjectorPose(matches(truth, setPoints().slice(0, 8), 0), { imageWidth: WIDTH, imageHeight: HEIGHT });
    expectRecovered(result, truth);
    if (!result.ok) return;
    expect(result.rms).toBeLessThan(1e-6);
    expect(result.model.cx).toBeCloseTo(truth.cx, 4);
    expect(result.model.cy).toBeCloseTo(truth.cy, 4);
  });

  it('recovers pose, focal length and principal point from noisy matches', () => {
    const correspondences = matches(truth, setPoints(), 0.3, 11);
    const result = solveProjectorPose(correspondences, { imageWidth: WIDTH, imageHeight: HEIGHT });
    expectRecovered(result, truth);
    if (!result.ok) return;
    expect(result.rms).toBeGreaterThan(0.05);
    expect(result.rms).toBeLessThan(0.6);
    expect(result.errors).toHaveLength(correspondences.length);
    expect(Math.abs(result.model.cx - truth.cx)).toBeLessThan(5);
    expect(Math.abs(result.model.cy - truth.cy)).toBeLessThan(5);
    expect(result.warning).toBeUndefined();
  });

  it('holds its tolerances across many noise draws at 0.3 px and 0.5 px', () => {
    for (const noise of [0.3, 0.5]) {
      for (let seed = 1; seed <= 40; seed++) {
        expectRecovered(solveProjectorPose(matches(truth, setPoints(), noise, seed), { imageWidth: WIDTH, imageHeight: HEIGHT }), truth);
      }
    }
  });

  it('finds the least-squares optimum, never a worse fit than the truth', () => {
    // At 1 px of noise the estimate wanders, but it must always fit the
    // matches at least as well as the projector that made them.
    const cost = (model: ProjectorCameraModel, c: PoseCorrespondence[]) => c.reduce((sum, { world, image }) => {
      const uv = projectToImage(model, world as Vec3)!;
      return sum + (uv[0] - image[0]) ** 2 + (uv[1] - image[1]) ** 2;
    }, 0);
    for (let seed = 1; seed <= 20; seed++) {
      const c = matches(truth, setPoints(), 1, seed);
      const result = solveProjectorPose(c, { imageWidth: WIDTH, imageHeight: HEIGHT });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(cost(result.model, c)).toBeLessThanOrEqual(cost(truth, c) + 1e-6);
    }
  });

  it('recovers from the minimum six points (near-degenerate: 12 equations, 9 unknowns)', () => {
    const six: Vec3[] = [[-2.2, 0, 1], [-2.2, 2, -1], [-0.2, 2, 1], [0.4, 0, 0.6], [2.2, 1.2, -0.6], [2.2, 0, 0.6]];
    for (let seed = 1; seed <= 20; seed++) {
      expectRecovered(solveProjectorPose(matches(truth, six, 0.1, seed), { imageWidth: WIDTH, imageHeight: HEIGHT }), truth);
    }
  });

  it('stays numerically stable on a nearly flat facade and warns that the lens is weak', () => {
    // 5 cm of relief across 4.4 m: the DLT is close to singular, so this
    // guards the normalisation. It still lands on the projector, and says
    // the configuration is weak.
    const result = solveProjectorPose(matches(truth, facadePoints(0.05), 0.01, 3), { imageWidth: WIDTH, imageHeight: HEIGHT });
    expectRecovered(result, truth);
    if (!result.ok) return;
    expect(result.warning).toMatch(/nearly flat/);
  });

  it('solves the pose alone with a fixed lens, including flat targets', () => {
    const lens = { f: truth.f, cx: truth.cx, cy: truth.cy };
    for (let seed = 1; seed <= 10; seed++) {
      const result = solveProjectorPose(matches(truth, facadePoints(0), 0.3, seed), { imageWidth: WIDTH, imageHeight: HEIGHT, fixedIntrinsics: lens });
      expectRecovered(result, truth);
      if (!result.ok) return;
      expect(result.mode).toBe('fixed');
      expect(result.model.f).toBe(truth.f);
    }
    const nonPlanar = solveProjectorPose(matches(truth, setPoints(), 0.3, 6), { imageWidth: WIDTH, imageHeight: HEIGHT, fixedIntrinsics: lens });
    expectRecovered(nonPlanar, truth);
  });

  it('refuses coplanar points when the lens is free', () => {
    const result = solveProjectorPose(matches(truth, facadePoints(0), 0.2), { imageWidth: WIDTH, imageHeight: HEIGHT });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('coplanar');
    expect(result.message).toMatch(/flat surface/);
  });

  it('refuses fewer than six points', () => {
    const result = solveProjectorPose(matches(truth, setPoints().slice(0, 5), 0), { imageWidth: WIDTH, imageHeight: HEIGHT });
    expect(result).toMatchObject({ ok: false, code: 'too-few-points' });
  });

  it('refuses points on a line and repeated points', () => {
    const line: Vec3[] = [0, 1, 2, 3, 4, 5].map((i) => [-2 + i * 0.6, 0.2 * i, 0.1 * i]);
    expect(solveProjectorPose(matches(truth, line, 0), { imageWidth: WIDTH, imageHeight: HEIGHT }))
      .toMatchObject({ ok: false, code: 'degenerate' });
    const same: Vec3[] = new Array(6).fill(0).map(() => [0.3, 1, 0.2]);
    expect(solveProjectorPose(matches(truth, same, 0), { imageWidth: WIDTH, imageHeight: HEIGHT }))
      .toMatchObject({ ok: false, code: 'degenerate' });
  });

  it('refuses matches that are not a projection at all', () => {
    const random = rng(99);
    const scrambled = setPoints().map((X) => ({ world: X, image: [random.next() * WIDTH, random.next() * HEIGHT] as [number, number] }));
    const result = solveProjectorPose(scrambled, { imageWidth: WIDTH, imageHeight: HEIGHT });
    // Random pixels either fail outright or fit terribly; never a quiet pass.
    if (result.ok) expect(result.rms).toBeGreaterThan(20);
    else expect(['degenerate', 'behind-projector', 'did-not-converge']).toContain(result.code);
  });

  it('reports invalid input without throwing', () => {
    const bad = matches(truth, setPoints().slice(0, 8), 0);
    bad[2] = { world: [Number.NaN, 0, 0], image: [1, 1] };
    expect(solveProjectorPose(bad, { imageWidth: WIDTH, imageHeight: HEIGHT })).toMatchObject({ ok: false, code: 'invalid-input' });
    expect(solveProjectorPose(bad, { imageWidth: 0, imageHeight: HEIGHT })).toMatchObject({ ok: false, code: 'invalid-input' });
  });
});
