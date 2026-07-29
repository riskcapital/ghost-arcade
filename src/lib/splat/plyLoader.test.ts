import { describe, it, expect } from 'vitest';
import { parsePLYBuffer, parsePLYBufferProgressive } from './plyLoader';

function stringToBuffer(str: string): ArrayBuffer {
  const encoder = new TextEncoder();
  return encoder.encode(str).buffer;
}

function binaryPlyWithFaceBeforeVertices(): ArrayBuffer {
  const header = `ply
format binary_little_endian 1.0
element face 1
property list uchar int vertex_indices
element vertex 2
property float x
property float y
property float z
property uchar red
property uchar green
property uchar blue
end_header
`;
  const headerBytes = new TextEncoder().encode(header);
  const body = new ArrayBuffer(1 + 3 * 4 + 2 * (3 * 4 + 3));
  const view = new DataView(body);
  let offset = 0;
  view.setUint8(offset, 3);
  offset += 1;
  for (const index of [0, 1, 0]) {
    view.setInt32(offset, index, true);
    offset += 4;
  }
  for (const [x, y, z, r, g, b] of [
    [1, 2, 3, 255, 0, 0],
    [4, 5, 6, 0, 255, 0],
  ]) {
    view.setFloat32(offset, x, true);
    view.setFloat32(offset + 4, y, true);
    view.setFloat32(offset + 8, z, true);
    view.setUint8(offset + 12, r);
    view.setUint8(offset + 13, g);
    view.setUint8(offset + 14, b);
    offset += 15;
  }
  const combined = new Uint8Array(headerBytes.byteLength + body.byteLength);
  combined.set(headerBytes, 0);
  combined.set(new Uint8Array(body), headerBytes.byteLength);
  return combined.buffer;
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

const SH_GAUSSIAN_PLY = `ply
format ascii 1.0
element vertex 1
property float x
property float y
property float z
property float f_dc_0
property float f_dc_1
property float f_dc_2
property float opacity
property float scale_0
property float scale_1
property float scale_2
property float rot_0
property float rot_1
property float rot_2
property float rot_3
end_header
0 0 0 1 0 -1 0 -2 -2 -2 1 0 0 0
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
    expect(result.scaleEncoding).toBe('log');
    expect(result.vertices).toHaveLength(2);
    expect(result.vertices[0].scale_0).toBeCloseTo(0.1);
    expect(result.vertices[0].rot_0).toBeCloseTo(1.0);
  });

  it('decodes gaussian SH color and logit opacity when byte colors are absent', () => {
    const result = parsePLYBuffer(stringToBuffer(SH_GAUSSIAN_PLY));
    const vertex = result.vertices[0];
    expect(vertex.r).toBe(199);
    expect(vertex.g).toBe(128);
    expect(vertex.b).toBe(56);
    expect(vertex.a).toBe(128);
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

  it('parses every row in an ASCII PLY larger than the former 10 KB probe', async () => {
    const count = 4_000;
    const rows = Array.from({ length: count }, (_, index) => `${index} ${index + 1} ${index + 2} 1 2 3`).join('\n');
    const source = `ply
format ascii 1.0
element vertex ${count}
property float x
property float y
property float z
property uchar red
property uchar green
property uchar blue
end_header
${rows}
`;
    expect(source.length).toBeGreaterThan(10_000);
    const result = await parsePLYBufferProgressive(stringToBuffer(source));
    expect(result.vertices).toHaveLength(count);
    expect(result.sourceVertexCount).toBe(count);
    expect(result.vertices.at(-1)?.x).toBe(count - 1);
  });

  it('locates binary vertices when another variable-size element precedes them', async () => {
    const result = await parsePLYBufferProgressive(binaryPlyWithFaceBeforeVertices());
    expect(result.vertices).toHaveLength(2);
    expect(result.vertices[0]).toMatchObject({ x: 1, y: 2, z: 3, r: 255, g: 0, b: 0 });
    expect(result.vertices[1]).toMatchObject({ x: 4, y: 5, z: 6, r: 0, g: 255, b: 0 });
  });

  it('uses deterministic whole-file sampling when the source exceeds the display budget', async () => {
    const count = 100;
    const rows = Array.from({ length: count }, (_, index) => `${index} 0 0`).join('\n');
    const source = `ply
format ascii 1.0
element vertex ${count}
property float x
property float y
property float z
end_header
${rows}
`;
    const result = await parsePLYBufferProgressive(stringToBuffer(source), { maxPoints: 5 });
    expect(result.sourceVertexCount).toBe(100);
    expect(result.wasDecimated).toBe(true);
    expect(result.vertices.map((vertex) => vertex.x)).toEqual([0, 20, 40, 60, 80]);
  });

  it('rejects truncated binary vertex data with a useful error', async () => {
    const complete = binaryPlyWithFaceBeforeVertices();
    const truncated = complete.slice(0, complete.byteLength - 5);
    await expect(parsePLYBufferProgressive(truncated)).rejects.toThrow('ended early');
  });
});
