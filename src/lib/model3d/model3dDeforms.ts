// The 3D model deformations and the controls each one reads. The panel shows
// only these controls, and both renderers (the WebGL one and the native core)
// implement the same maths, so every control shown changes the model.
import type { Model3DContent, Model3DDeformationType } from '../types';

export type Model3DDeformAxis = Model3DContent['deformationAxis'];
type MoveAxis = 'x' | 'y' | 'z';

export interface Model3DDeformInfo {
  value: Model3DDeformationType;
  label: string;
  description: string;
  /** Intensity always applies. These say which other controls do. */
  speed: boolean;
  scale: boolean;
  spread: boolean;
  /** What Scale and Spread do for this deformation, when it is not the usual. */
  scaleLabel?: string;
  spreadLabel?: string;
  /** Axes the deformation moves points along. Axis offers only these. */
  axes: MoveAxis[];
}

const ALL: MoveAxis[] = ['x', 'y', 'z'];
const XZ: MoveAxis[] = ['x', 'z'];

export const MODEL3D_DEFORMATIONS: Model3DDeformInfo[] = [
  { value: 'none', label: 'None', description: 'No deformation', speed: false, scale: false, spread: false, axes: [] },
  { value: 'noise', label: 'Noise', description: 'Organic noise displacement', speed: true, scale: true, spread: true, axes: ALL },
  { value: 'wave', label: 'Wave', description: 'Water-like surface ripples', speed: true, scale: true, spread: true, axes: ALL },
  { value: 'pulse', label: 'Pulse', description: 'Concentric ripple from center', speed: true, scale: true, spread: true, axes: ALL },
  { value: 'bulge', label: 'Bulge', description: 'Wave climbing up the model', speed: true, scale: true, spread: true, axes: ALL },
  { value: 'twist', label: 'Twist', description: 'Twist around the Y axis', speed: true, scale: true, spread: true, axes: XZ },
  { value: 'swirl', label: 'Swirl', description: 'Helical vortex twist', speed: true, scale: true, spread: true, axes: XZ },
  { value: 'bend', label: 'Bend', description: 'Arc around the X axis (steady)', speed: false, scale: false, spread: true, axes: ['y', 'z'] },
  { value: 'taper', label: 'Taper', description: 'Pinch the ends toward the axis (steady)', speed: false, scale: false, spread: true, axes: XZ },
  { value: 'spherify', label: 'Spherify', description: 'Pull to a sphere (steady)', speed: false, scale: false, spread: true, spreadLabel: 'Radius', axes: ALL },
  { value: 'inflate', label: 'Inflate', description: 'Push along normals, pulsing', speed: true, scale: true, spread: true, scaleLabel: 'Variation', axes: ALL },
  { value: 'breathe', label: 'Breathe', description: 'Soft pulsating scale', speed: true, scale: false, spread: true, axes: ALL },
  { value: 'explode', label: 'Explode', description: 'Steady outward push. Pair with the Rotate animation', speed: false, scale: false, spread: true, axes: ALL },
  { value: 'implode', label: 'Implode', description: 'Steady inward pull', speed: false, scale: false, spread: true, axes: ALL },
  { value: 'shatter', label: 'Shatter', description: 'Fragments scatter outward (steady)', speed: false, scale: true, spread: true, scaleLabel: 'Pieces', axes: ALL },
  { value: 'fracture', label: 'Fracture', description: 'Chunks drift apart along their own axes (steady)', speed: false, scale: true, spread: true, scaleLabel: 'Pieces', axes: ALL },
  { value: 'melt', label: 'Melt', description: 'Droop downward', speed: true, scale: true, spread: true, axes: ALL },
  { value: 'pixelate', label: 'Voxelize', description: 'Snap to a voxel grid (steady)', speed: false, scale: true, spread: true, scaleLabel: 'Resolution', axes: ALL },
  { value: 'jelly', label: 'Jelly', description: 'Bouncy soft body', speed: true, scale: false, spread: true, axes: ALL },
  { value: 'tentacle', label: 'Tentacle', description: 'Tendril-like waves', speed: true, scale: true, spread: true, axes: XZ },
  { value: 'magnetic', label: 'Magnetic', description: 'Pull toward the poles', speed: true, scale: false, spread: true, axes: ALL },
];

/**
 * Deformation order for MIDI and the native shader index. The first fifteen
 * keep the order MIDI maps have always used; the rest were added after.
 */
export const MODEL3D_DEFORM_ORDER: Model3DDeformationType[] = [
  'none', 'noise', 'wave', 'twist', 'bend', 'taper', 'spherify', 'inflate',
  'explode', 'implode', 'shatter', 'melt', 'pixelate', 'jelly', 'breathe',
  'pulse', 'bulge', 'tentacle', 'magnetic', 'swirl', 'fracture',
];

const BY_TYPE = new Map(MODEL3D_DEFORMATIONS.map((d) => [d.value, d]));

export function model3dDeformInfo(type: Model3DDeformationType | undefined): Model3DDeformInfo {
  return BY_TYPE.get(type ?? 'none') ?? MODEL3D_DEFORMATIONS[0];
}

/**
 * The axis restriction a deformation actually uses. An axis the deformation
 * does not move along (Y on Twist) would freeze it, so it reads as All.
 */
export function effectiveModel3DDeformAxis(
  type: Model3DDeformationType | undefined,
  axis: Model3DDeformAxis | undefined,
): Model3DDeformAxis {
  if (!axis || axis === 'all') return 'all';
  return model3dDeformInfo(type).axes.includes(axis) ? axis : 'all';
}

/** Axis index for the shaders: 0 all, 1 x, 2 y, 3 z. */
export function model3dDeformAxisIndex(
  type: Model3DDeformationType | undefined,
  axis: Model3DDeformAxis | undefined,
): number {
  return ['all', 'x', 'y', 'z'].indexOf(effectiveModel3DDeformAxis(type, axis));
}
