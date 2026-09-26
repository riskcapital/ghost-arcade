/**
 * Map Sim point-matching calibration: from a projector's calibration
 * record (model points and the output pixels they were matched to) to a
 * solved pose and lens, as a projector patch plus a result the UI shows.
 */
import type {
  ProjectionSimCalibration,
  ProjectionSimCalibrationPoint,
  ProjectionSimCalibrationResult,
  ProjectionSimProjector,
  ProjectionSimVec3,
} from '../types';
import {
  projectToImage,
  projectorCameraModel,
  projectorImageSize,
  projectorPatchFromCameraModel,
  type ProjectorCameraModel,
} from '../projectorLens';
import { MIN_CALIBRATION_POINTS, solveProjectorPose } from './poseSolver';
import type { Vec3 } from './linalg';

export function newCalibrationPointId(): string {
  return `pcal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function defaultCalibration(projector: ProjectionSimProjector): ProjectionSimCalibration {
  return { imageSize: projectorImageSize(projector), fixedIntrinsics: false, points: [], result: null };
}

export function matchedPoints(calibration: ProjectionSimCalibration): ProjectionSimCalibrationPoint[] {
  return calibration.points.filter((point) => point.enabled && point.image);
}

/** The projector's current lens and pose as a pixel camera for this
 *  calibration's output size. */
export function calibrationCameraModel(
  projector: ProjectionSimProjector,
  calibration: ProjectionSimCalibration,
): ProjectorCameraModel {
  const [width, height] = calibration.imageSize;
  return projectorCameraModel({ ...projector, aspect: width / height }, width, height);
}

/** Where the current virtual projector puts a model point on its output. */
export function predictImagePoint(
  projector: ProjectionSimProjector,
  calibration: ProjectionSimCalibration,
  world: ProjectionSimVec3,
): [number, number] | null {
  return projectToImage(calibrationCameraModel(projector, calibration), world as Vec3);
}

export interface CalibrationSolve {
  result: ProjectionSimCalibrationResult;
  /** Pose and lens to apply to the projector when the solve succeeded. */
  patch: Partial<ProjectionSimProjector> | null;
}

/** Solve a projector from its matched points. */
export function solveCalibration(
  projector: ProjectionSimProjector,
  calibration: ProjectionSimCalibration,
  now = Date.now(),
): CalibrationSolve {
  const points = matchedPoints(calibration);
  const [width, height] = calibration.imageSize;
  const mode = calibration.fixedIntrinsics ? 'fixed' : 'free';
  const fixed = calibration.fixedIntrinsics ? calibrationCameraModel(projector, calibration) : null;
  const solved = solveProjectorPose(
    points.map((point) => ({ world: point.world, image: point.image! })),
    {
      imageWidth: width,
      imageHeight: height,
      fixedIntrinsics: fixed ? { f: fixed.f, cx: fixed.cx, cy: fixed.cy } : null,
    },
  );
  if (!solved.ok) {
    return {
      result: { ok: false, rms: 0, errors: {}, mode, message: solved.message, solvedAt: now },
      patch: null,
    };
  }
  const errors: Record<string, number> = {};
  points.forEach((point, index) => { errors[point.id] = solved.errors[index]; });
  // Keep the look-at target on the calibrated points so the gizmo and the
  // beam stay near the object.
  const centroid = points.reduce<Vec3>((sum, point) => [
    sum[0] + point.world[0] / points.length,
    sum[1] + point.world[1] / points.length,
    sum[2] + point.world[2] / points.length,
  ], [0, 0, 0]);
  const forward = solved.model.R[2];
  const focus = (centroid[0] - solved.position[0]) * forward[0]
    + (centroid[1] - solved.position[1]) * forward[1]
    + (centroid[2] - solved.position[2]) * forward[2];
  const patch = projectorPatchFromCameraModel(solved.model, focus > 0.05 ? focus : 5);
  return {
    result: {
      ok: true,
      rms: solved.rms,
      errors,
      mode,
      ...(solved.warning ? { warning: solved.warning } : {}),
      solvedAt: now,
    },
    patch,
  };
}

export function canSolve(calibration: ProjectionSimCalibration): boolean {
  return matchedPoints(calibration).length >= MIN_CALIBRATION_POINTS;
}

export { MIN_CALIBRATION_POINTS };
