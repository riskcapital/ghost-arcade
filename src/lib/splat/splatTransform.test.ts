import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { PLYData } from './plyLoader';
import { createDefaultSplatContent } from '../types';
import {
  SPLAT_TARGET_DIAMETER,
  bakeSplatManualRotationAsUpright,
  composeSplatRotationRadians,
  computeSplatNormalization,
  hexToRgb01,
  normalizedGaussianScale,
  normalizedSplatPosition,
  resolveSplatCameraDistance,
  splatImportOrientationRotation,
  suggestSplatAutoLevel,
} from './splatTransform';

const data: PLYData = {
  vertices: [],
  sourceVertexCount: 0,
  wasDecimated: false,
  dataType: 'gaussian',
  scaleEncoding: 'log',
  hasUVs: false,
  boundingBox: {
    min: { x: 100, y: -50, z: 20 },
    max: { x: 900, y: 150, z: 120 },
  },
  center: { x: 500, y: 50, z: 70 },
};

describe('splat transform contract', () => {
  it('normalizes architectural scans into a stable working diameter', () => {
    const normalization = computeSplatNormalization(data);
    expect(normalization.scale).toBeCloseTo(SPLAT_TARGET_DIAMETER / 800);
    expect(normalizedSplatPosition({ x: 900, y: 50, z: 70 }, normalization)[0]).toBeCloseTo(2);
    expect(normalizedSplatPosition({ x: 100, y: 50, z: 70 }, normalization)[0]).toBeCloseTo(-2);
  });

  it('decodes log Gaussian scales before applying import normalization', () => {
    const normalization = computeSplatNormalization(data);
    const scales = normalizedGaussianScale(
      { scale_0: Math.log(10), scale_1: Math.log(5), scale_2: Math.log(2) },
      normalization,
    );
    expect(scales[0]).toBeCloseTo(0.05);
    expect(scales[1]).toBeCloseTo(0.025);
    expect(scales[2]).toBeCloseTo(0.02);
  });

  it('migrates legacy camera distances into the normalized framing range', () => {
    expect(resolveSplatCameraDistance(50)).toBe(5);
    expect(resolveSplatCameraDistance(0)).toBe(1.5);
    expect(resolveSplatCameraDistance(12)).toBe(12);
  });

  it('converts configurable gradient colors without leaking byte ranges', () => {
    expect(hexToRgb01('#ff8000', '#000000')).toEqual([1, 128 / 255, 0]);
    expect(hexToRgb01('invalid', '#3377ff')).toEqual([0x33 / 255, 0x77 / 255, 1]);
  });

  it('provides explicit source-up corrections without mutating imported points', () => {
    expect(splatImportOrientationRotation('authored')).toEqual([0, 0, 0]);
    expect(splatImportOrientationRotation('yUp')).toEqual([0, 0, 0]);
    expect(splatImportOrientationRotation('zUp')).toEqual([-90, 0, 0]);
    expect(splatImportOrientationRotation('zUpInverted')).toEqual([90, 0, 0]);
    expect(splatImportOrientationRotation('xUp')).toEqual([0, 0, 90]);
  });

  it('bakes the current manual alignment into a persistent import correction', () => {
    const content = {
      ...createDefaultSplatContent(),
      importOrientation: 'zUp' as const,
      rotationX: 12,
      rotationY: 35,
      rotationZ: -8,
    };
    const before = composeSplatRotationRadians(content);
    const baked = { ...content, ...bakeSplatManualRotationAsUpright(content) };
    const after = composeSplatRotationRadians(baked);

    expect(baked.importOrientation).toBe('custom');
    expect(baked.rotationX).toBe(0);
    expect(baked.rotationY).toBe(0);
    expect(baked.rotationZ).toBe(0);

    const beforeQuaternion = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(before[0], before[1], before[2], 'XYZ'),
    );
    const afterQuaternion = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(after[0], after[1], after[2], 'XYZ'),
    );
    expect(Math.abs(beforeQuaternion.dot(afterQuaternion))).toBeCloseTo(1, 5);
  });

  it('auto-levels a scan whose dominant normals identify Z as its up axis', () => {
    const vertices = Array.from({ length: 64 }, (_, index) => ({
      x: index % 8,
      y: Math.floor(index / 8),
      z: 0,
      nx: 0,
      ny: 0,
      nz: 1,
      r: 255,
      g: 255,
      b: 255,
      a: 255,
    }));
    const suggestion = suggestSplatAutoLevel({
      ...data,
      vertices,
      sourceVertexCount: vertices.length,
    });
    expect(suggestion.rotationX).toBeCloseTo(-90, 4);
    expect(suggestion.rotationY).toBeCloseTo(0, 4);
    expect(suggestion.rotationZ).toBeCloseTo(0, 4);
    expect(suggestion.confidence).toBeGreaterThan(0.99);
  });
});
