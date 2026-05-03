import { describe, it, expect } from 'vitest';
import { parsePLYBuffer } from './plyLoader';

function stringToBuffer(str: string): ArrayBuffer {
  const encoder = new TextEncoder();
  return encoder.encode(str).buffer;
}

const POINT_CLOUD_PLY = `ply
format ascii 1.0
element vertex 3
property float x
property float y
property float z
property uchar red
property uchar green
property uchar blue
end_header
1.0 2.0 3.0 255 0 0
4.0 5.0 6.0 0 255 0
7.0 8.0 9.0 0 0 255
`;

const GAUSSIAN_PLY = `ply
format ascii 1.0
element vertex 2
property float x
property float y
property float z
property uchar red
property uchar green
property uchar blue
property float scale_0
property float scale_1
property float scale_2
property float rot_0
property float rot_1
property float rot_2
property float rot_3
end_header
1.0 2.0 3.0 255 128 0 0.1 0.2 0.3 1.0 0.0 0.0 0.0
-1.0 -2.0 -3.0 0 128 255 0.4 0.5 0.6 0.0 1.0 0.0 0.0
`;

describe('parsePLYBuffer', () => {
  it('parses ASCII point cloud PLY', () => {
    const result = parsePLYBuffer(stringToBuffer(POINT_CLOUD_PLY));
    expect(result.dataType).toBe('pointcloud');
    expect(result.vertices).toHaveLength(3);
    expect(result.vertices[0].x).toBeCloseTo(1.0);
    expect(result.vertices[0].r).toBe(255);
    expect(result.vertices[0].g).toBe(0);
  });

  it('detects gaussian splat from scale/rot properties', () => {
    const result = parsePLYBuffer(stringToBuffer(GAUSSIAN_PLY));
    expect(result.dataType).toBe('gaussian');
    expect(result.vertices).toHaveLength(2);
    expect(result.vertices[0].scale_0).toBeCloseTo(0.1);
    expect(result.vertices[0].rot_0).toBeCloseTo(1.0);
  });

  it('computes correct bounding box', () => {
    const result = parsePLYBuffer(stringToBuffer(POINT_CLOUD_PLY));
    expect(result.boundingBox.min.x).toBeCloseTo(1.0);
    expect(result.boundingBox.max.x).toBeCloseTo(7.0);
    expect(result.boundingBox.min.z).toBeCloseTo(3.0);
    expect(result.boundingBox.max.z).toBeCloseTo(9.0);
  });

  it('computes correct center', () => {
    const result = parsePLYBuffer(stringToBuffer(POINT_CLOUD_PLY));
    expect(result.center.x).toBeCloseTo(4.0);
    expect(result.center.y).toBeCloseTo(5.0);
    expect(result.center.z).toBeCloseTo(6.0);
  });

  it('throws on missing vertex element', () => {
    const noVertex = `ply
format ascii 1.0
element face 1
property list uchar int vertex_indices
end_header
3 0 1 2
`;
    expect(() => parsePLYBuffer(stringToBuffer(noVertex))).toThrow('vertex');
  });

  it('marks hasUVs false when no UV properties', () => {
    const result = parsePLYBuffer(stringToBuffer(POINT_CLOUD_PLY));
    expect(result.hasUVs).toBe(false);
  });
});
