import { describe, it, expect } from 'vitest';
import { parseSplatBuffer } from './splatLoader';

function createSplatBuffer(splats: Array<{
  x: number; y: number; z: number;
  sx: number; sy: number; sz: number;
  r: number; g: number; b: number; a: number;
  rot0: number; rot1: number; rot2: number; rot3: number;
}>): ArrayBuffer {
  const buffer = new ArrayBuffer(splats.length * 32);
  const f32 = new Float32Array(buffer);
  const u8 = new Uint8Array(buffer);
  for (let i = 0; i < splats.length; i++) {
    const s = splats[i];
    const f32Off = (i * 32) / 4;
    const u8Off = i * 32;
    f32[f32Off] = s.x;
    f32[f32Off + 1] = s.y;
    f32[f32Off + 2] = s.z;
    f32[f32Off + 3] = s.sx;
    f32[f32Off + 4] = s.sy;
    f32[f32Off + 5] = s.sz;
    u8[u8Off + 24] = s.r;
    u8[u8Off + 25] = s.g;
    u8[u8Off + 26] = s.b;
    u8[u8Off + 27] = s.a;
    u8[u8Off + 28] = Math.round(s.rot0 * 128 + 128);
    u8[u8Off + 29] = Math.round(s.rot1 * 128 + 128);
    u8[u8Off + 30] = Math.round(s.rot2 * 128 + 128);
    u8[u8Off + 31] = Math.round(s.rot3 * 128 + 128);
  }
  return buffer;
}

describe('parseSplatBuffer', () => {
  it('throws on empty buffer', () => {
    expect(() => parseSplatBuffer(new ArrayBuffer(0))).toThrow('no splat data');
  });

  it('throws on buffer smaller than one splat', () => {
    expect(() => parseSplatBuffer(new ArrayBuffer(16))).toThrow('no splat data');
  });

  it('parses a single splat correctly', () => {
    const buf = createSplatBuffer([{
      x: 1.0, y: 2.0, z: 3.0,
      sx: 0.1, sy: 0.2, sz: 0.3,
      r: 255, g: 128, b: 0, a: 200,
      rot0: 0.0, rot1: 0.0, rot2: 0.0, rot3: 1.0,
    }]);
    const result = parseSplatBuffer(buf);
    expect(result.vertices).toHaveLength(1);
    expect(result.dataType).toBe('gaussian');
    expect(result.hasUVs).toBe(false);

    const v = result.vertices[0];
    expect(v.x).toBeCloseTo(1.0);
    expect(v.y).toBeCloseTo(2.0);
    expect(v.z).toBeCloseTo(3.0);
    expect(v.r).toBe(255);
    expect(v.g).toBe(128);
    expect(v.b).toBe(0);
    expect(v.a).toBe(200);
  });

  it('computes correct bounding box and center', () => {
    const buf = createSplatBuffer([
      { x: -1, y: -2, z: -3, sx: 0, sy: 0, sz: 0, r: 0, g: 0, b: 0, a: 255, rot0: 0, rot1: 0, rot2: 0, rot3: 1 },
      { x: 1, y: 2, z: 3, sx: 0, sy: 0, sz: 0, r: 0, g: 0, b: 0, a: 255, rot0: 0, rot1: 0, rot2: 0, rot3: 1 },
    ]);
    const result = parseSplatBuffer(buf);
    expect(result.vertices).toHaveLength(2);
    expect(result.boundingBox.min).toEqual({ x: -1, y: -2, z: -3 });
    expect(result.boundingBox.max).toEqual({ x: 1, y: 2, z: 3 });
    expect(result.center.x).toBeCloseTo(0);
    expect(result.center.y).toBeCloseTo(0);
    expect(result.center.z).toBeCloseTo(0);
  });

  it('ignores trailing bytes less than one splat', () => {
    // 32 + 12 extra bytes = only 1 splat parsed (44 is divisible by 4 for Float32Array)
    const buf = new ArrayBuffer(44);
    const f32 = new Float32Array(buf);
    f32[0] = 5.0; f32[1] = 6.0; f32[2] = 7.0;
    const result = parseSplatBuffer(buf);
    expect(result.vertices).toHaveLength(1);
  });
});
