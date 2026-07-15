import { describe, it, expect } from 'vitest';
import { parsePLYBuffer, parsePLYPointBuffers, pointCloudBuffersFromPLYData } from './plyLoader';

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

const GAUSSIAN_SH_PLY = `ply
format ascii 1.0
element vertex 1
property float x
property float y
property float z
property float opacity
property float f_dc_0
property float f_dc_1
property float f_dc_2
property float f_rest_2
property float f_rest_0
property float f_rest_1
property float f_rest_3
property float f_rest_4
property float f_rest_5
property float f_rest_6
property float f_rest_7
property float f_rest_8
property float scale_0
property float scale_1
property float scale_2
property float rot_0
property float rot_1
property float rot_2
property float rot_3
end_header
0 0 0 0 0 -0.5 0.5 0.2 0.0 0.1 0.3 0.4 0.5 0.6 0.7 0.8 -4 -4 -4 1 0 0 0
`;

const MESH_PLY = `ply
format ascii 1.0
element vertex 4
property float x
property float y
property float z
element face 1
property list uchar int vertex_indices
end_header
0 0 0
1 0 0
1 1 0
0 1 0
4 0 1 2 3
`;

function binaryGaussianPLY(rows: number[][]): ArrayBuffer {
  const header = `ply
format binary_little_endian 1.0
element vertex ${rows.length}
property float x
property float y
property float z
property float scale_0
property float scale_1
property float scale_2
property float f_dc_0
property float f_dc_1
property float f_dc_2
property float opacity
property float rot_0
property float rot_1
property float rot_2
property float rot_3
end_header
`;
  const headerBytes = new TextEncoder().encode(header);
  const stride = 14 * Float32Array.BYTES_PER_ELEMENT;
  const bytes = new Uint8Array(headerBytes.byteLength + rows.length * stride);
  bytes.set(headerBytes, 0);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < rows.length; i++) {
    for (let j = 0; j < 14; j++) {
      view.setFloat32(headerBytes.byteLength + i * stride + j * 4, rows[i][j] ?? 0, true);
    }
  }
  return bytes.buffer;
}

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

  it('uses Gaussian spherical harmonics color and opacity properties', () => {
    const result = parsePLYBuffer(stringToBuffer(GAUSSIAN_SH_PLY));
    expect(result.dataType).toBe('gaussian');
    expect(result.vertices[0].r).toBe(128);
    expect(result.vertices[0].g).toBe(92);
    expect(result.vertices[0].b).toBe(163);
    expect(result.vertices[0].a).toBe(128);
    expect(result.sphericalHarmonicsDegree).toBe(1);
    expect(result.sphericalHarmonicsCoefficientCount).toBe(9);
    expect(result.vertices[0].f_rest).toEqual([
      0.0, 0.1, 0.2,
      0.3, 0.4, 0.5,
      0.6, 0.7, 0.8,
    ]);
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

  it('parses ASCII mesh faces for projector-sim imports', () => {
    const result = parsePLYBuffer(stringToBuffer(MESH_PLY));
    expect(result.vertices).toHaveLength(4);
    expect(result.faces).toEqual([[0, 1, 2, 3]]);
  });

  it('parses PLY files with headers longer than 10KB', () => {
    const comments = Array.from({ length: 700 }, (_, i) => `comment exporter metadata ${i} ${'x'.repeat(24)}`).join('\n');
    const longHeaderPly = `ply
format ascii 1.0
${comments}
element vertex 1
property float x
property float y
property float z
end_header
1 2 3
`;
    const result = parsePLYBuffer(stringToBuffer(longHeaderPly));
    expect(result.vertices).toHaveLength(1);
    expect(result.vertices[0].x).toBe(1);
  });

  it('samples binary Gaussian splat PLY directly into point buffers', () => {
    const buffer = binaryGaussianPLY([
      [0, 0, 0, -4, -4, -4, 0, 0, 0, 0, 1, 0, 0, 0],
      [1, 2, 3, -3, -3, -3, 0.5, 0, -0.5, 1, 0.5, 0.5, 0.5, 0.5],
      [2, 4, 6, -2, -2, -2, 1, 0, -1, -1, 0, 1, 0, 0],
      [3, 6, 9, -1, -1, -1, -0.5, 0.5, 0, 2, 0, 0, 1, 0],
    ]);

    const result = parsePLYPointBuffers(buffer, { maxGaussianPoints: 2 });

    expect(result.gaussian).toBe(true);
    expect(result.sourceVertexCount).toBe(4);
    expect(result.sampleCount).toBe(2);
    expect(Array.from(result.positions)).toEqual([0, 0, 0, 3, 6, 9]);
    expect(result.colors[0]).toBeCloseTo(128 / 255, 4);
    expect(result.colors[1]).toBeCloseTo(128 / 255, 4);
    expect(result.colors[2]).toBeCloseTo(128 / 255, 4);
    expect(result.alpha[0]).toBeCloseTo(128 / 255, 4);
    expect(result.alpha[1]).toBeGreaterThan(0.87);
    expect(result.splatScale?.[0]).toBeCloseTo(-4);
    expect(result.splatScale?.[3]).toBeCloseTo(-1);
    expect(result.splatRotation?.[0]).toBeCloseTo(1);
    expect(result.splatRotation?.[6]).toBeCloseTo(1);
  });

  it('converts parsed PLY data into sampled point buffers', () => {
    const parsed = parsePLYBuffer(stringToBuffer(POINT_CLOUD_PLY));
    const result = pointCloudBuffersFromPLYData(parsed, { maxPoints: 2 });
    expect(result.sourceVertexCount).toBe(3);
    expect(result.sampleCount).toBe(2);
    expect(Array.from(result.positions)).toEqual([1, 2, 3, 7, 8, 9]);
    expect(result.colors[0]).toBe(1);
    expect(result.colors[5]).toBe(1);
  });
});
