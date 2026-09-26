/** Calibration from the Map Sim side: a solve moves the projector onto the
 *  pose that made the matches, in one undo step, and survives a project
 *  save and load. */
import { beforeAll, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import type { ProjectionSimCalibration, ProjectionSimProjector, ProjectionSimVec3 } from '../types';
import { projectToImage, projectorCameraModel } from '../projectorLens';
import { rotationErrorDegrees } from './poseSolver';

let store: typeof import('../store');
let types: typeof import('../types');
let session: typeof import('./calibrationSession');

beforeAll(async () => {
  const storage = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, String(v)),
    removeItem: (k: string) => void storage.delete(k),
    clear: () => storage.clear(), key: () => null, length: 0,
  };
  store = await import('../store');
  types = await import('../types');
  session = await import('./calibrationSession');
});

const WORLD: ProjectionSimVec3[] = [
  [-1, 0, 1], [1, 0, 1], [1, 2, 1], [-1, 2, 1], [1, 2, -1], [-1, 2, -1], [1, 0, -1], [0, 2, 0], [1, 1, 0],
];

/** The "real" projector the operator is aligning to. */
function realProjector(): ProjectionSimProjector {
  return {
    ...types.makeProjectionSimProjector('Real'),
    position: [-3.6, 3.1, 5.2],
    target: [0.1, 0.9, 0],
    roll: -2.5,
    fov: 31,
    aspect: 16 / 9,
    lensShift: [0.02, 0.08],
  };
}

function matchedCalibration(real: ProjectionSimProjector): ProjectionSimCalibration {
  const model = projectorCameraModel(real, 1920, 1080);
  return {
    imageSize: [1920, 1080],
    fixedIntrinsics: false,
    points: WORLD.map((world, index) => ({
      id: `p${index}`,
      world,
      image: projectToImage(model, world)!,
      objectId: null,
      enabled: true,
    })),
    result: null,
  };
}

describe('calibration session', () => {
  it('solves the virtual projector onto the real one', () => {
    const real = realProjector();
    const guess: ProjectionSimProjector = { ...types.makeProjectionSimProjector('Guess'), position: [-5, 4, 7], target: [0, 1, 0] };
    const { result, patch } = session.solveCalibration(guess, matchedCalibration(real), 1234);
    expect(result.ok).toBe(true);
    expect(result.rms).toBeLessThan(1e-4);
    expect(Object.keys(result.errors)).toHaveLength(WORLD.length);
    const solved = { ...guess, ...patch! };
    const a = projectorCameraModel(solved, 1920, 1080);
    const b = projectorCameraModel(real, 1920, 1080);
    expect(rotationErrorDegrees(a.R, b.R)).toBeLessThan(1e-3);
    expect(a.f).toBeCloseTo(b.f, 2);
    expect(solved.roll).toBeCloseTo(real.roll!, 3);
    expect(solved.fov).toBeCloseTo(real.fov, 4);
    solved.position.forEach((v, i) => expect(v).toBeCloseTo(real.position[i], 4));
  });

  it('reports why it cannot solve', () => {
    const real = realProjector();
    const calibration = matchedCalibration(real);
    calibration.points = calibration.points.slice(0, 4);
    const { result, patch } = session.solveCalibration(real, calibration);
    expect(patch).toBeNull();
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/at least 6/);
    expect(session.canSolve(calibration)).toBe(false);
  });

  it('predicts where a model point lands on the current output', () => {
    const real = realProjector();
    const calibration = matchedCalibration(real);
    const predicted = session.predictImagePoint(real, calibration, WORLD[2])!;
    expect(predicted[0]).toBeCloseTo(calibration.points[2].image![0], 6);
    expect(predicted[1]).toBeCloseTo(calibration.points[2].image![1], 6);
  });
});

describe('calibration in the Map Sim store', () => {
  it('applies a solve with its points as one undo step, and keeps a locked pose', () => {
    const scene = types.createProjectionSimScene('Calib');
    const projector = { ...types.makeProjectionSimProjector('P1'), position: [-5, 4, 7] as ProjectionSimVec3 };
    scene.projectors = [projector];
    store.projectionSimScene.loadScene(scene);
    const calibration = matchedCalibration(realProjector());
    const { result, patch } = session.solveCalibration(projector, calibration);
    store.projectionSimScene.updateCalibration(projector.id, () => ({ ...calibration, result }), patch!);
    let current = get(store.projectionSimScene).projectors[0];
    expect(current.calibration?.points).toHaveLength(WORLD.length);
    expect(current.position[0]).toBeCloseTo(-3.6, 3);
    expect(store.projectionSimScene.undo()).toBe(true);
    current = get(store.projectionSimScene).projectors[0];
    expect(current.calibration).toBeUndefined();
    expect(current.position).toEqual([-5, 4, 7]);

    store.projectionSimScene.toggleProjectorLock(projector.id);
    store.projectionSimScene.updateCalibration(projector.id, () => ({ ...calibration, result }), patch!);
    current = get(store.projectionSimScene).projectors[0];
    expect(current.calibration?.result?.ok).toBe(true);
    expect(current.position).toEqual([-5, 4, 7]);
  });

  it('round-trips lens and calibration through a project save, and fills them on old scenes', () => {
    const scene = types.createProjectionSimScene('Saved');
    const projector: ProjectionSimProjector = { ...realProjector(), calibration: matchedCalibration(realProjector()) };
    scene.projectors = [projector];
    store.projectionSimScene.loadScene(scene);
    const saved = JSON.parse(JSON.stringify(store.projectionSimScene.exportForProject()));
    store.projectionSimScene.newScene();
    store.projectionSimScene.loadSceneFromProject(saved);
    const loaded = get(store.projectionSimScene).projectors[0];
    expect(loaded.lensShift).toEqual([0.02, 0.08]);
    expect(loaded.roll).toBe(-2.5);
    expect(loaded.calibration?.points).toHaveLength(WORLD.length);
    expect(loaded.calibration?.points[3].image).toEqual(projector.calibration!.points[3].image);

    // A projector saved before lenses and calibration existed.
    const legacy = JSON.parse(JSON.stringify(saved));
    for (const key of ['lensShift', 'roll', 'near', 'far', 'contentFrom', 'calibration']) delete legacy.projectors[0][key];
    store.projectionSimScene.loadSceneFromProject(legacy);
    const upgraded = get(store.projectionSimScene).projectors[0];
    expect(upgraded.lensShift).toEqual([0, 0]);
    expect(upgraded.roll).toBe(0);
    expect(upgraded.near).toBe(0.1);
    expect(upgraded.far).toBe(120);
    expect(upgraded.contentFrom).toBeNull();
    expect(upgraded.calibration).toBeUndefined();
  });

  it('applies a scene from the other window without an undo step', () => {
    const scene = types.createProjectionSimScene('Remote');
    store.projectionSimScene.loadScene(scene);
    const before = store.projectionSimScene.getHistoryCounts().past;
    const remote = { ...scene, name: 'From the pop-out' };
    store.projectionSimScene.applyRemoteScene(remote);
    expect(get(store.projectionSimScene).name).toBe('From the pop-out');
    expect(store.projectionSimScene.getHistoryCounts().past).toBe(before);
  });
});
