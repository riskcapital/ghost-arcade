import * as THREE from 'three';
import type { SplatContent, SplatImportOrientation } from '../types';
import type { PLYData, PLYVertex } from './plyLoader';

export const SPLAT_TARGET_DIAMETER = 4;
export const SPLAT_IMPORT_ORIENTATION_OPTIONS: ReadonlyArray<{
  value: SplatImportOrientation;
  label: string;
}> = [
  { value: 'authored', label: 'As Authored' },
  { value: 'yUp', label: 'Y Up' },
  { value: 'zUp', label: 'Z Up' },
  { value: 'zUpInverted', label: 'Z Up Inverted' },
  { value: 'xUp', label: 'X Up' },
  { value: 'auto', label: 'Auto Level' },
  { value: 'custom', label: 'Custom Upright' },
];

export interface SplatNormalization {
  center: { x: number; y: number; z: number };
  scale: number;
  size: number;
}

export function computeSplatNormalization(data: PLYData): SplatNormalization {
  const { min, max } = data.boundingBox;
  const size = Math.max(max.x - min.x, max.y - min.y, max.z - min.z);
  return {
    center: data.center,
    scale: SPLAT_TARGET_DIAMETER / Math.max(size, 1e-6),
    size,
  };
}

export function normalizedSplatPosition(
  vertex: Pick<PLYVertex, 'x' | 'y' | 'z'>,
  normalization: SplatNormalization,
): [number, number, number] {
  const { center, scale } = normalization;
  return [(vertex.x - center.x) * scale, (vertex.y - center.y) * scale, (vertex.z - center.z) * scale];
}

export function normalizedGaussianScale(
  vertex: Pick<PLYVertex, 'scale_0' | 'scale_1' | 'scale_2'>,
  normalization: SplatNormalization,
  compactSplat = false,
): [number, number, number] {
  const decode = (value: number | undefined) => {
    if (value === undefined || !Number.isFinite(value)) return 1;
    const decoded = compactSplat ? value : Math.exp(Math.max(-12, Math.min(12, value)));
    return Math.max(0.02, Math.min(8, decoded * normalization.scale));
  };
  return [decode(vertex.scale_0), decode(vertex.scale_1), decode(vertex.scale_2)];
}

export function resolveSplatCameraDistance(distance: number | undefined): number {
  if (!Number.isFinite(distance)) return 5;
  // Projects saved before normalized framing used a 1..500 camera range.
  if ((distance as number) > 30) return 5;
  return Math.max(1.5, Math.min(30, distance as number));
}

export function hexToRgb01(hex: string | undefined, fallback: string): [number, number, number] {
  const source = /^#[0-9a-f]{6}$/i.test(hex ?? '') ? (hex as string) : fallback;
  return [
    parseInt(source.slice(1, 3), 16) / 255,
    parseInt(source.slice(3, 5), 16) / 255,
    parseInt(source.slice(5, 7), 16) / 255,
  ];
}

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

function finiteAngle(value: number | undefined): number {
  return Number.isFinite(value) ? (value as number) : 0;
}

function quaternionFromDegrees(x: number, y: number, z: number): THREE.Quaternion {
  return new THREE.Quaternion().setFromEuler(
    new THREE.Euler(x * DEG_TO_RAD, y * DEG_TO_RAD, z * DEG_TO_RAD, 'XYZ'),
  );
}

function degreesFromQuaternion(quaternion: THREE.Quaternion): [number, number, number] {
  const euler = new THREE.Euler().setFromQuaternion(quaternion.normalize(), 'XYZ');
  return [euler.x * RAD_TO_DEG, euler.y * RAD_TO_DEG, euler.z * RAD_TO_DEG];
}

export function splatImportOrientationRotation(
  orientation: SplatImportOrientation | undefined,
): [number, number, number] {
  switch (orientation) {
    case 'zUp':
      return [-90, 0, 0];
    case 'zUpInverted':
      return [90, 0, 0];
    case 'xUp':
      return [0, 0, 90];
    default:
      return [0, 0, 0];
  }
}

export function resolveSplatImportRotation(
  content: Pick<
    SplatContent,
    | 'importOrientation'
    | 'importRotationX'
    | 'importRotationY'
    | 'importRotationZ'
    | 'autoLevelRotationX'
    | 'autoLevelRotationY'
    | 'autoLevelRotationZ'
  >,
): [number, number, number] {
  if (content.importOrientation === 'auto') {
    return [
      finiteAngle(content.autoLevelRotationX),
      finiteAngle(content.autoLevelRotationY),
      finiteAngle(content.autoLevelRotationZ),
    ];
  }
  if (content.importOrientation === 'custom') {
    return [
      finiteAngle(content.importRotationX),
      finiteAngle(content.importRotationY),
      finiteAngle(content.importRotationZ),
    ];
  }
  return splatImportOrientationRotation(content.importOrientation);
}

/**
 * Source correction is applied first, then the manual gizmo transform, then
 * optional turntable rotation around the corrected world-up axis.
 */
export function composeSplatRotationRadians(
  content: Pick<
    SplatContent,
    | 'rotationX'
    | 'rotationY'
    | 'rotationZ'
    | 'importOrientation'
    | 'importRotationX'
    | 'importRotationY'
    | 'importRotationZ'
    | 'autoLevelRotationX'
    | 'autoLevelRotationY'
    | 'autoLevelRotationZ'
  >,
  autoRotationRadians = 0,
): [number, number, number] {
  const [importX, importY, importZ] = resolveSplatImportRotation(content);
  const sourceCorrection = quaternionFromDegrees(importX, importY, importZ);
  const manual = quaternionFromDegrees(
    finiteAngle(content.rotationX),
    finiteAngle(content.rotationY),
    finiteAngle(content.rotationZ),
  );
  const automatic = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0),
    autoRotationRadians,
  );
  const combined = automatic.multiply(manual).multiply(sourceCorrection);
  const euler = new THREE.Euler().setFromQuaternion(combined.normalize(), 'XYZ');
  return [euler.x, euler.y, euler.z];
}

export function bakeSplatManualRotationAsUpright(
  content: Pick<
    SplatContent,
    | 'rotationX'
    | 'rotationY'
    | 'rotationZ'
    | 'importOrientation'
    | 'importRotationX'
    | 'importRotationY'
    | 'importRotationZ'
    | 'autoLevelRotationX'
    | 'autoLevelRotationY'
    | 'autoLevelRotationZ'
  >,
): Partial<SplatContent> {
  const [importX, importY, importZ] = resolveSplatImportRotation(content);
  const combined = quaternionFromDegrees(
    finiteAngle(content.rotationX),
    finiteAngle(content.rotationY),
    finiteAngle(content.rotationZ),
  ).multiply(quaternionFromDegrees(importX, importY, importZ));
  const [rotationX, rotationY, rotationZ] = degreesFromQuaternion(combined);
  return {
    importOrientation: 'custom',
    importRotationX: rotationX,
    importRotationY: rotationY,
    importRotationZ: rotationZ,
    rotationX: 0,
    rotationY: 0,
    rotationZ: 0,
  };
}

export interface SplatAutoLevelSuggestion {
  rotationX: number;
  rotationY: number;
  rotationZ: number;
  confidence: number;
}

function rotationToWorldUp(sourceUp: THREE.Vector3): [number, number, number] {
  const normalized = sourceUp.normalize();
  const dominantAxis = ['x', 'y', 'z'].reduce((best, axis) =>
    Math.abs(normalized[axis as 'x' | 'y' | 'z']) >
    Math.abs(normalized[best as 'x' | 'y' | 'z'])
      ? axis
      : best,
  );
  if (normalized[dominantAxis as 'x' | 'y' | 'z'] < 0) normalized.multiplyScalar(-1);
  return degreesFromQuaternion(
    new THREE.Quaternion().setFromUnitVectors(normalized, new THREE.Vector3(0, 1, 0)),
  );
}

/**
 * Produces a non-destructive best-effort upright suggestion. Oriented normals
 * provide arbitrary-angle leveling; scans without normals fall back to the
 * likely architectural height axis and remain user-adjustable.
 */
export function suggestSplatAutoLevel(data: PLYData): SplatAutoLevelSuggestion {
  let xx = 0;
  let xy = 0;
  let xz = 0;
  let yy = 0;
  let yz = 0;
  let zz = 0;
  let normalCount = 0;
  const stride = Math.max(1, Math.floor(data.vertices.length / 100_000));

  for (let index = 0; index < data.vertices.length; index += stride) {
    const vertex = data.vertices[index];
    if (
      !Number.isFinite(vertex.nx) ||
      !Number.isFinite(vertex.ny) ||
      !Number.isFinite(vertex.nz)
    ) {
      continue;
    }
    const normal = new THREE.Vector3(vertex.nx, vertex.ny, vertex.nz);
    const lengthSq = normal.lengthSq();
    if (lengthSq < 1e-8) continue;
    normal.multiplyScalar(1 / Math.sqrt(lengthSq));
    xx += normal.x * normal.x;
    xy += normal.x * normal.y;
    xz += normal.x * normal.z;
    yy += normal.y * normal.y;
    yz += normal.y * normal.z;
    zz += normal.z * normal.z;
    normalCount += 1;
  }

  if (normalCount >= 32) {
    let axis = new THREE.Vector3(0.37, 0.81, 0.45).normalize();
    for (let iteration = 0; iteration < 18; iteration += 1) {
      axis
        .set(
          xx * axis.x + xy * axis.y + xz * axis.z,
          xy * axis.x + yy * axis.y + yz * axis.z,
          xz * axis.x + yz * axis.y + zz * axis.z,
        )
        .normalize();
    }
    const energy =
      axis.x * (xx * axis.x + xy * axis.y + xz * axis.z) +
      axis.y * (xy * axis.x + yy * axis.y + yz * axis.z) +
      axis.z * (xz * axis.x + yz * axis.y + zz * axis.z);
    const [rotationX, rotationY, rotationZ] = rotationToWorldUp(axis);
    return {
      rotationX,
      rotationY,
      rotationZ,
      confidence: Math.max(0, Math.min(1, energy / Math.max(xx + yy + zz, 1e-6))),
    };
  }

  const extents = [
    { axis: 'x' as const, size: data.boundingBox.max.x - data.boundingBox.min.x },
    { axis: 'y' as const, size: data.boundingBox.max.y - data.boundingBox.min.y },
    { axis: 'z' as const, size: data.boundingBox.max.z - data.boundingBox.min.z },
  ].sort((a, b) => a.size - b.size);
  const likelyHeight = extents[1]?.axis ?? 'y';
  const sourceUp =
    likelyHeight === 'x'
      ? new THREE.Vector3(1, 0, 0)
      : likelyHeight === 'z'
        ? new THREE.Vector3(0, 0, 1)
        : new THREE.Vector3(0, 1, 0);
  const [rotationX, rotationY, rotationZ] = rotationToWorldUp(sourceUp);
  return { rotationX, rotationY, rotationZ, confidence: 0.25 };
}
