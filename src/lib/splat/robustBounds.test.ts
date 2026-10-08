import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { robustFrameFromPositions, robustFrameFromVertices } from './robustBounds';
import { packSplatNativePoints } from '../renderer/splatNative';
import { computeSplatNormalization } from './splatTransform';
import { parsePLYBuffer, parsePLYPointBuffers } from './plyLoader';

/** Deterministic cloud filling a 3 x 1.6 x 1.7 box (a room scan's shape). */
function roomCloud(count: number): Float32Array {
  const positions = new Float32Array(count * 3);
  let seed = 12345;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (rand() - 0.5) * 3;
    positions[i * 3 + 1] = rand() * 1.6;
    positions[i * 3 + 2] = (rand() - 0.5) * 1.7;
  }
  return positions;
}

function rawBox(positions: Float32Array) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i++) {
    const axis = i % 3;
    if (positions[i] < min[axis]) min[axis] = positions[i];
    if (positions[i] > max[axis]) max[axis] = positions[i];
  }
  return { min, max };
}

describe('robust framing box', () => {
  it('gives a clean cloud exactly its raw bounding box', () => {
    const positions = roomCloud(20_000);
    const raw = rawBox(positions);
    const frame = robustFrameFromPositions(positions, 20_000);
    expect([frame.min.x, frame.min.y, frame.min.z]).toEqual(raw.min);
    expect([frame.max.x, frame.max.y, frame.max.z]).toEqual(raw.max);
    expect(frame.outliers).toBe(0);
  });

  it('ignores stray far points and keeps every point', () => {
    const clean = roomCloud(20_000);
    const cleanFrame = robustFrameFromPositions(clean, 20_000);
    // Five strays, up to 60 m away: the old raw box would be 20x too large.
    const strays = [60, 0.5, 0, -25, 0.2, 3, 0, 40, 0, 1, 0.3, -33, 12, -9, 14];
    const dirty = new Float32Array(clean.length + strays.length);
    dirty.set(strays, 0);
    dirty.set(clean, strays.length);
    const count = dirty.length / 3;
    const frame = robustFrameFromPositions(dirty, count);
    expect(frame.outliers).toBe(5);
    expect(frame.size).toBeCloseTo(cleanFrame.size, 6);
    expect(frame.center.x).toBeCloseTo(cleanFrame.center.x, 6);
    expect(frame.center.y).toBeCloseTo(cleanFrame.center.y, 6);
    expect(frame.center.z).toBeCloseTo(cleanFrame.center.z, 6);

    const packedClean = packSplatNativePoints({ positions: clean, colors: new Float32Array(clean.length), sampleCount: 20_000 });
    const packed = packSplatNativePoints({ positions: dirty, colors: new Float32Array(dirty.length), sampleCount: count });
    // All points kept; the strays simply sit outside the 4-unit frame.
    expect(packed.pointCount).toBe(count);
    expect(packed.norm).toBeCloseTo(packedClean.norm, 6);
    expect(Math.abs(packed.buffer[0])).toBeGreaterThan(50);
    // The first clean point lands where it does without the strays.
    for (let axis = 0; axis < 3; axis++) {
      expect(packed.buffer[5 * 8 + axis]).toBeCloseTo(packedClean.buffer[axis], 5);
    }
    // Raw-box framing would have drawn the room at under 6% of its size.
    const raw = rawBox(dirty);
    const rawExtent = Math.max(raw.max[0] - raw.min[0], raw.max[1] - raw.min[1], raw.max[2] - raw.min[2]);
    expect(frame.size / rawExtent).toBeLessThan(0.06);
  });

  it('frames parsed vertices the same way (WebGL renderer and projection simulator)', () => {
    const clean = roomCloud(5_000);
    const vertices = [{ x: 500, y: 0, z: 0 }];
    for (let i = 0; i < 5_000; i++) vertices.push({ x: clean[i * 3], y: clean[i * 3 + 1], z: clean[i * 3 + 2] });
    const frame = robustFrameFromVertices(vertices);
    expect(frame.outliers).toBe(1);
    const normalization = computeSplatNormalization({
      vertices, sourceVertexCount: vertices.length, wasDecimated: false, dataType: 'pointcloud', hasUVs: false,
      boundingBox: { min: { x: -1.5, y: 0, z: -0.85 }, max: { x: 500, y: 1.6, z: 0.85 } },
      center: { x: 249.25, y: 0.8, z: 0 },
    } as never);
    expect(normalization.size).toBeCloseTo(robustFrameFromPositions(clean, 5_000).size, 6);
    expect(Math.abs(normalization.center.x)).toBeLessThan(0.01);
  });

  it('uses the raw box for tiny clouds and skips non-finite points', () => {
    const frame = robustFrameFromPositions(new Float32Array([0, 0, 0, 10, 0, 0, NaN, 1, 1]), 3);
    expect(frame.min.x).toBe(0);
    expect(frame.max.x).toBe(10);
    expect(frame.outliers).toBe(1);
    expect(robustFrameFromPositions(new Float32Array(0), 0).size).toBe(0);
  });

  // The phone's own scans are already clean: their frame must not move.
  const sample = process.env.GA_SCAN_SAMPLE_DIR;
  it.skipIf(!sample || !existsSync(`${sample}/room-balanced.ply`))('frames the phone scanner samples exactly as the raw box did', () => {
    for (const name of ['room-balanced.ply', 'object-detail-cropped.ply']) {
      const bytes = readFileSync(`${sample}/${name}`);
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      const data = parsePLYPointBuffers(buffer, { maxPoints: 1_500_000 });
      const packed = packSplatNativePoints(data);
      const { min, max } = data.boundingBox;
      expect(packed.frame.outliers, name).toBe(0);
      expect(packed.frame.min, name).toEqual(min);
      expect(packed.frame.max, name).toEqual(max);
      expect(packed.norm, name).toBe(4 / Math.max(max.x - min.x, max.y - min.y, max.z - min.z));
      expect(data.voxelSizeM, name).toBeGreaterThan(0.001);
      const parsed = parsePLYBuffer(buffer);
      expect(computeSplatNormalization(parsed).size, name).toBe(Math.max(max.x - min.x, max.y - min.y, max.z - min.z));
    }
  });
});
