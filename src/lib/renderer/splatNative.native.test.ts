import { describe, expect, it } from 'vitest';
import {
  SPLAT_NATIVE_SHADER_ID,
  SPLAT_NATIVE_WGSL,
  SPLAT_POINT_VEC4S,
  SPLAT_SHADOW_SHADER_ID,
  SPLAT_SHADOW_WGSL,
  SPLAT_UNIFORM_BYTES,
  SPLAT_UNIFORM_VEC4S,
  SPLAT_VOLUMETRIC_BUDGETS,
  buildSplatNativeComputeGraph,
  buildSplatNativePrecompileCommands,
  packSplatNativePoints,
  splatShadowDim,
  splatShadowFrame,
  splatSpotBlend,
  splatSpotCos,
  splatViewProjection,
} from './splatNative';
import { createDefaultSplatContent } from '../types';

/** Deterministic 512-point blob so the graph builder has a real cloud. */
function testCloud(count = 512) {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = Math.sin(i * 1.7);
    positions[i * 3 + 1] = Math.cos(i * 2.3);
    positions[i * 3 + 2] = Math.sin(i * 0.9) * Math.cos(i * 1.1);
    colors[i * 3] = 1; colors[i * 3 + 1] = 0.6; colors[i * 3 + 2] = 0.2;
  }
  return packSplatNativePoints({ positions, colors, sampleCount: count });
}

function buildGraph(overrides: Record<string, unknown> = {}, tier?: 'low' | 'balanced' | 'high' | 'ultra') {
  const packed = testCloud();
  return buildSplatNativeComputeGraph({
    sourceId: 'splat-test',
    content: { ...createDefaultSplatContent(), ...overrides } as never,
    pointCount: packed.pointCount,
    pointsBufferId: 'pts',
    pointsB64: null,
    width: 1920,
    height: 1080,
    time: 1.25,
    frameDelta: 1 / 60,
    frameIndex: 7,
    qualityTier: tier,
  });
}

function uniformOf(graph: ReturnType<typeof buildGraph>): number[] {
  const buffers = graph.config.buffers as Array<Record<string, unknown>>;
  return buffers[0].initial_f32 as number[];
}

/** vec4 `slot` of the packed uniform. */
function v4(data: number[], slot: number): number[] {
  return data.slice(slot * 4, slot * 4 + 4);
}

describe('native Splat graph', () => {
  it('pins the render contract', () => {
    expect(SPLAT_NATIVE_SHADER_ID).toBe('splat/render-v1');
    expect(SPLAT_NATIVE_WGSL).toContain('fn vs_point');
    expect(SPLAT_NATIVE_WGSL).toContain('fn fs_point');
    expect(SPLAT_NATIVE_WGSL).toContain('var<storage, read> points');
    // The shared prelude is interpolated into BOTH modules, so the
    // opacity volume runs the exact transform chain the vertex shader
    // draws with. If this stops being shared the shadow silently drifts
    // away from the cloud as soon as an animation is on.
    expect(SPLAT_NATIVE_WGSL).toContain('fn splat_world');
    expect(SPLAT_SHADOW_WGSL).toContain('fn splat_world');
    expect(SPLAT_NATIVE_WGSL).toContain('fn apply_animation');
    expect(SPLAT_SHADOW_WGSL).toContain('fn apply_animation');
  });

  it('pins the volumetric shaft contract', () => {
    expect(SPLAT_SHADOW_SHADER_ID).toBe('splat/shadowvol-v1');
    for (const entry of ['cs_shadow_clear', 'cs_shadow_scatter', 'cs_shadow_prefix']) {
      expect(SPLAT_SHADOW_WGSL).toContain(`fn ${entry}`);
    }
    expect(SPLAT_NATIVE_WGSL).toContain('fn vs_god');
    expect(SPLAT_NATIVE_WGSL).toContain('fn fs_god');
    expect(SPLAT_NATIVE_WGSL).toContain('fn sp_shadow_vol');
    expect(SPLAT_NATIVE_WGSL).toContain('fn sp_hg');
    const commands = buildSplatNativePrecompileCommands();
    expect(commands[0]).toEqual(
      expect.objectContaining({ shader_id: SPLAT_NATIVE_SHADER_ID, stage: 'render', entry: 'fs_point' }),
    );
    expect(commands[1]).toEqual(
      expect.objectContaining({ shader_id: SPLAT_SHADOW_SHADER_ID, stage: 'compute', entry: 'cs_shadow_scatter' }),
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

  it('pins the uniform layout', () => {
    expect(SPLAT_UNIFORM_VEC4S).toBe(63);
    expect(SPLAT_UNIFORM_BYTES).toBe(63 * 16);
    const data = uniformOf(buildGraph());
    expect(data).toHaveLength(63 * 4);
    // 0-3 view-projection, 4 screen(w, h, time, pointCount)
    expect(v4(data, 4)).toEqual([1920, 1080, 1.25, 512]);
    // 42 stateless physics (the last pre-volumetric slot) still lands here
    const phys2 = v4(data, 42);
    expect(phys2[0]).toBe(0);
    expect(phys2[1]).toBeCloseTo(0.05, 6);
    expect(phys2[2]).toBeCloseTo(0.5, 6);
    expect(phys2[3]).toBe(0);
  });

  it('packs the light frame, medium and scatter budget in vec4 43-57', () => {
    const graph = buildGraph({ volumetricEnabled: true }, 'balanced');
    const data = uniformOf(graph);
    const [lux, luy, luz, extent] = v4(data, 43);
    const [lvx, lvy, lvz, depth] = v4(data, 44);
    const [lwx, lwy, lwz, shadowDensity] = v4(data, 45);
    // Orthonormal BY CONSTRUCTION — a sheared frame skews every shaft.
    expect(Math.hypot(lux, luy, luz)).toBeCloseTo(1, 5);
    expect(Math.hypot(lvx, lvy, lvz)).toBeCloseTo(1, 5);
    expect(Math.hypot(lwx, lwy, lwz)).toBeCloseTo(1, 5);
    expect(lux * lvx + luy * lvy + luz * lvz).toBeCloseTo(0, 5);
    expect(lux * lwx + luy * lwy + luz * lwz).toBeCloseTo(0, 5);
    expect(lvx * lwx + lvy * lwy + lvz * lwz).toBeCloseTo(0, 5);
    expect(depth).toBeCloseTo(extent * 2.15, 5);
    expect(shadowDensity).toBeCloseTo(1.6, 5);
    // 46: dim, dim, dim, cellZ
    const dim = SPLAT_VOLUMETRIC_BUDGETS.balanced.shadowDim;
    expect(v4(data, 46).slice(0, 3)).toEqual([dim, dim, dim]);
    expect(v4(data, 46)[3]).toBeCloseTo(depth / dim, 5);
    // 47: haze colour + density
    expect(v4(data, 47)[3]).toBeCloseTo(1.2, 5);
    // 48: spot apex + cos(halfAngle)
    expect(v4(data, 48)[3]).toBeCloseTo(Math.cos((38 / 2) * Math.PI / 180), 5);
    // 49: spotBlend, volumetricOn, marchSteps, radiusUnit
    const sh6 = v4(data, 49);
    expect(sh6[1]).toBe(1);
    expect(sh6[2]).toBe(SPLAT_VOLUMETRIC_BUDGETS.balanced.marchSteps);
    expect(sh6[3]).toBeGreaterThan(0);
    // 50: volume origin + per-sample occupancy unit
    expect(v4(data, 50).slice(0, 3)).toEqual([0, 0, 0]);
    expect(v4(data, 50)[3]).toBeGreaterThan(0);
    // 51: scatterCount, scatterStride, cloudShadowing, shaftPower.
    // 512 points is under the budget, so every point is visited at
    // stride 1 and no compensation is needed.
    expect(v4(data, 51)[0]).toBe(512);
    expect(v4(data, 51)[1]).toBe(1);
    expect(v4(data, 51)[2]).toBeCloseTo(0.5, 5);
    expect(v4(data, 51)[3]).toBeCloseTo(1.4, 5);
    // 52: Henyey-Greenstein g
    expect(v4(data, 52)[0]).toBeCloseTo(0.6, 5);
    // 53-56 inverse view-projection, 57 camera eye (default orbit: +Z at 5)
    for (let i = 53 * 4; i < 57 * 4; i++) expect(Number.isFinite(data[i])).toBe(true);
    expect(v4(data, 57)[2]).toBeCloseTo(5, 4);
  });

  it('costs nothing when the shafts are off', () => {
    const graph = buildGraph();
    const config = graph.config as Record<string, unknown>;
    expect((config.passes as unknown[]).length).toBe(0);
    expect((config.render_passes as unknown[]).length).toBe(2);
    // The lookup buffer collapses to a 16-byte stub — fs_point statically
    // references it, so the binding must exist, but nothing is allocated.
    const buffers = config.buffers as Array<Record<string, unknown>>;
    const stub = buffers.find((b) => String(b.id).endsWith(':shadow-stub'));
    expect(stub?.byte_length).toBe(16);
    // volumetricOn = 0 and every medium term is zeroed, so the shader
    // early-outs before any volume read.
    const data = uniformOf(graph);
    expect(v4(data, 49)[1]).toBe(0);
    expect(v4(data, 45)[3]).toBe(0);
    expect(v4(data, 47)[3]).toBe(0);
    expect(v4(data, 51)[0]).toBe(0);
  });

  it('adds exactly three compute passes and one god-ray pass when on', () => {
    const graph = buildGraph({ volumetricEnabled: true });
    const config = graph.config as Record<string, unknown>;
    const passes = config.passes as Array<Record<string, unknown>>;
    expect(passes.map((p) => p.entry)).toEqual([
      'cs_shadow_clear', 'cs_shadow_scatter', 'cs_shadow_prefix',
    ]);
    for (const pass of passes) expect(pass.shader_id).toBe(SPLAT_SHADOW_SHADER_ID);
    const renders = config.render_passes as Array<Record<string, unknown>>;
    expect(renders.map((r) => r.name)).toEqual(['splat-bg', 'splat-render', 'splat-godrays']);
    // The snapshot belongs to the LAST pass into the frame.
    expect(renders[1].include_snapshot).toBe(false);
    expect(graph.passCount).toBe(6);
  });

  it('bounds the scatter on huge clouds and compensates the stride', () => {
    const packed = testCloud(64);
    const huge = 1_200_000;
    const graph = buildSplatNativeComputeGraph({
      sourceId: 'splat-big',
      content: { ...createDefaultSplatContent(), volumetricEnabled: true } as never,
      pointCount: huge,
      pointsBufferId: 'pts',
      pointsB64: null,
      width: 1920, height: 1080, time: 0, frameDelta: 1 / 60, frameIndex: 0,
      qualityTier: 'balanced',
    });
    void packed;
    const data = uniformOf(graph);
    const budget = SPLAT_VOLUMETRIC_BUDGETS.balanced.scatterBudget;
    expect(v4(data, 51)[0]).toBe(budget);
    expect(v4(data, 51)[1]).toBeCloseTo(huge / budget, 4);
    // The dispatch is bounded by the budget, NOT by the point count, so a
    // 1.2M gaussian splat costs exactly what a 120k scan costs.
    const passes = (graph.config as Record<string, unknown>).passes as Array<Record<string, unknown>>;
    const scatter = passes.find((p) => p.entry === 'cs_shadow_scatter');
    expect((scatter?.dispatch as number[])[0]).toBe(Math.ceil(budget / 64));
  });

  it('scales the volumetric budget with the quality tier', () => {
    const dims = (['low', 'balanced', 'high', 'ultra'] as const).map((tier) => {
      const data = uniformOf(buildGraph({ volumetricEnabled: true }, tier));
      return { dim: v4(data, 46)[0], steps: v4(data, 49)[2] };
    });
    expect(dims.map((d) => d.dim)).toEqual([32, 48, 64, 80]);
    expect(dims.map((d) => d.steps)).toEqual([24, 40, 56, 88]);
    // An explicit choice is honoured but never above the tier cap.
    expect(splatShadowDim(96, SPLAT_VOLUMETRIC_BUDGETS.low.shadowDimCap, 32)).toBe(32);
    expect(splatShadowDim(64, SPLAT_VOLUMETRIC_BUDGETS.ultra.shadowDimCap, 80)).toBe(64);
    expect(splatShadowDim(0, SPLAT_VOLUMETRIC_BUDGETS.high.shadowDimCap, 64)).toBe(64);
  });

  it('treats a 180-degree spot as no cone at all', () => {
    expect(splatSpotCos(180)).toBe(-1);
    expect(splatSpotCos(60)).toBeCloseTo(Math.cos(30 * Math.PI / 180), 6);
    // The blend can never push the upper cone edge past straight-on.
    expect(splatSpotCos(60) + splatSpotBlend(60, 1)).toBeLessThanOrEqual(1);
  });

  it('fits the light frame to the cloud bounding sphere, not the box', () => {
    const frame = splatShadowFrame([0, 1, 0], 4, 48);
    expect(frame.extent).toBeCloseTo(4, 6);
    expect(frame.depth).toBeCloseTo(8.6, 6);
    expect(frame.cellZ).toBeCloseTo(8.6 / 48, 6);
    // Degenerate up vector: lw parallel to +Y must still be orthonormal.
    expect(Math.hypot(...frame.lu)).toBeCloseTo(1, 6);
    expect(Math.hypot(...frame.lv)).toBeCloseTo(1, 6);
  });
});
