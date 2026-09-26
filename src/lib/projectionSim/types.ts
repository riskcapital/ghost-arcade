import type { AssetRef } from '../storage/assetRegistry';

export type ProjectionSimVec3 = [number, number, number];

export type ProjectionSimPrimitiveKind =
  | 'box'
  | 'sphere'
  | 'cylinder'
  | 'cone'
  | 'pyramid'
  | 'column'
  | 'plane';

export type ProjectionSimObjectType = 'primitive' | 'model' | 'pointcloud';

export interface ProjectionSimObject {
  id: string;
  name: string;
  type: ProjectionSimObjectType;
  primitive?: ProjectionSimPrimitiveKind;
  position: ProjectionSimVec3;
  rotation: ProjectionSimVec3;
  scale: ProjectionSimVec3;
  color: string;
  roughness: number;
  visible: boolean;
  locked: boolean;
  castShadow: boolean;
  receiveProjection: boolean;
  assetUrl?: string;
  assetRef?: AssetRef;
  assetName?: string;
  assetFormat?: 'glb' | 'gltf' | 'obj' | 'fbx' | 'ply';
  pointSize?: number;
}

export interface ProjectionSimProjector {
  id: string;
  name: string;
  enabled: boolean;
  locked: boolean;
  position: ProjectionSimVec3;
  target: ProjectionSimVec3;
  fov: number;
  aspect: number;
  intensity: number;
  opacity: number;
  color: string;
  source: 'master' | 'slice';
  sliceId?: string | null;
  crop: [number, number, number, number];
  edgeBlend: [number, number, number, number];
  showFrustum: boolean;
  /** Lens shift as a fraction of the image size, projector-spec style:
   *  +x moves the image right of the lens axis, +y moves it up. 0.5 puts
   *  the axis on the image edge. Absent on scenes saved before 2.1. */
  lensShift?: [number, number];
  /** Rotation about the lens axis in degrees, on top of the look-at pose. */
  roll?: number;
  near?: number;
  far?: number;
  /** Which projector's lens lays the content onto the surfaces. Null (the
   *  default) is this projector's own lens, the classic "project the canvas"
   *  look. Pointing it at another projector anchors the content to the
   *  model, so this projector renders that mapping from its own pose. */
  contentFrom?: string | null;
  /** Point-matching calibration for this projector. */
  calibration?: ProjectionSimCalibration;
}

export interface ProjectionSimCalibrationPoint {
  id: string;
  /** Picked position on the model, world space. */
  world: ProjectionSimVec3;
  /** Where the feature lands on the projector output, in calibration image
   *  pixels (x right, y down). Null until the operator matches it. */
  image: [number, number] | null;
  objectId?: string | null;
  enabled: boolean;
}

export interface ProjectionSimCalibrationResult {
  ok: boolean;
  /** RMS reprojection error in calibration image pixels. */
  rms: number;
  /** Reprojection error per point id, in pixels. */
  errors: Record<string, number>;
  mode: 'free' | 'fixed';
  message?: string;
  warning?: string;
  solvedAt: number;
}

export interface ProjectionSimCalibration {
  /** Output resolution the image points are measured in. */
  imageSize: [number, number];
  /** Solve the pose only and keep the current lens. */
  fixedIntrinsics: boolean;
  points: ProjectionSimCalibrationPoint[];
  result?: ProjectionSimCalibrationResult | null;
}

export interface ProjectionSimEnvironment {
  background: string;
  ambient: number;
  roomExposure: number;
  surfaceStyle: 'original' | 'white' | 'light-gray' | 'dark-gray';
  floorColor: string;
  showFloorProjection: boolean;
  showGrid: boolean;
  shadows: boolean;
  shadowStrength: number;
}

export interface ProjectionSimCamera {
  position: ProjectionSimVec3;
  target: ProjectionSimVec3;
  fov: number;
}

export interface ProjectionSimScene {
  id: string;
  name: string;
  schemaVersion: 1;
  environment: ProjectionSimEnvironment;
  camera: ProjectionSimCamera;
  objects: ProjectionSimObject[];
  projectors: ProjectionSimProjector[];
}

export type ProjectionSimSelection =
  | `object:${string}`
  | `projector:${string}`
  | null;

export type ProjectionSimGizmoMode = 'translate' | 'rotate' | 'scale';

export function createProjectionSimScene(name = 'Projection Simulator'): ProjectionSimScene {
  return {
    id: `psim-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    schemaVersion: 1,
    environment: {
      background: '#05070b',
      ambient: 0.22,
      roomExposure: 1.15,
      surfaceStyle: 'light-gray',
      floorColor: '#16181d',
      showFloorProjection: true,
      showGrid: true,
      shadows: true,
      shadowStrength: 1,
    },
    camera: {
      position: [9, 6, 11],
      target: [0, 2, 0],
      fov: 48,
    },
    objects: [],
    projectors: [makeProjectionSimProjector('Projector 1', [-6, 4.5, 8], [0, 2.1, 0])],
  };
}

export function makeProjectionSimPrimitive(
  primitive: ProjectionSimPrimitiveKind,
  name?: string,
  position: ProjectionSimVec3 = [0, 1, 0],
  scale: ProjectionSimVec3 = [2, 2, 2],
  color = '#d8d2c4',
): ProjectionSimObject {
  return {
    id: `psobj-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name: name ?? primitiveLabel(primitive),
    type: 'primitive',
    primitive,
    position,
    rotation: [0, 0, 0],
    scale,
    color,
    roughness: 0.82,
    visible: true,
    locked: false,
    castShadow: true,
    receiveProjection: true,
  };
}

export function makeProjectionSimProjector(
  name = 'Projector',
  position: ProjectionSimVec3 = [-6, 4, 8],
  target: ProjectionSimVec3 = [0, 2, 0],
): ProjectionSimProjector {
  return {
    id: `psproj-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    enabled: true,
    locked: false,
    position,
    target,
    fov: 34,
    aspect: 16 / 9,
    intensity: 1.25,
    opacity: 1,
    color: '#ffffff',
    source: 'master',
    sliceId: null,
    crop: [0, 0, 1, 1],
    edgeBlend: [0, 0, 0, 0],
    showFrustum: true,
    lensShift: [0, 0],
    roll: 0,
    near: 0.1,
    far: 120,
    contentFrom: null,
  };
}

export function primitiveLabel(kind: ProjectionSimPrimitiveKind): string {
  switch (kind) {
    case 'box': return 'Block';
    case 'sphere': return 'Sphere';
    case 'cylinder': return 'Cylinder';
    case 'cone': return 'Cone';
    case 'pyramid': return 'Pyramid';
    case 'column': return 'Column';
    case 'plane': return 'Plane';
  }
}
