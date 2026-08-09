import { describe, expect, it } from 'vitest';
import {
  SPLAT_NATIVE_SHADER_ID,
  SPLAT_NATIVE_WGSL,
  SPLAT_POINT_VEC4S,
  buildSplatNativePrecompileCommands,
  packSplatNativePoints,
  splatViewProjection,
} from './splatNative';
import { createDefaultSplatContent } from '../types';

describe('native Splat graph', () => {
  it('pins the render contract', () => {
    expect(SPLAT_NATIVE_SHADER_ID).toBe('splat/render-v1');
    expect(SPLAT_NATIVE_WGSL).toContain('fn vs_point');
    expect(SPLAT_NATIVE_WGSL).toContain('fn fs_point');
    expect(SPLAT_NATIVE_WGSL).toContain('var<storage, read> points');
    expect(buildSplatNativePrecompileCommands()[0]).toEqual(
      expect.objectContaining({ shader_id: SPLAT_NATIVE_SHADER_ID, stage: 'render', entry: 'fs_point' }),
    );
  });

  it('packs points with rgba8 color and per-point scale', () => {
    const packed = packSplatNativePoints({
      positions: new Float32Array([1, 2, 3, -1, -2, -3]),
      colors: new Float32Array([1, 0, 0.5, 0, 1, 0]),
      alpha: new Float32Array([1, 0.5]),
      splatScale: new Float32Array([2, 0.5]),
      sampleCount: 2,
    });
    expect(packed.pointCount).toBe(2);
    expect(packed.buffer.length).toBe(2 * SPLAT_POINT_VEC4S * 4);
    // Positions normalize to a centered ~4-unit cloud: extent 6 → ×(4/6).
    expect(packed.buffer[0]).toBeCloseTo(2 / 3);
    // Raw gaussian radii run through the release's fit-scaled point-scale
    // curve (0.65 + raw·fit·160, clamped to 10): radius 2 saturates.
    expect(packed.buffer[4]).toBe(10);
    const u32 = new Uint32Array(packed.buffer.buffer);
    expect(u32[3] & 0xff).toBe(255); // red
    expect((u32[3] >>> 24) & 0xff).toBe(255); // alpha
  });

  it('produces a finite view-projection from default camera', () => {
    const vp = splatViewProjection(createDefaultSplatContent(), 16 / 9, 0.5);
    expect(vp).toHaveLength(16);
    for (const v of vp) expect(Number.isFinite(v)).toBe(true);
  });
});
