import { describe, expect, it } from 'vitest';
import {
  POINT_CLOUD_FX_NATIVE_SHADER_IDS,
  buildPointCloudFXPackedPointBuffers,
  buildPointCloudFXNativeComputeGraph,
  buildPointCloudFXNativePointData,
  buildPointCloudFXNativePrecompileCommands,
  getPointCloudFXNativeShaderSources,
  pointCloudSourceIndexForSample,
} from './webgpuPointCloudFX';

const HOME_BYTES_FOR_TEST = 112;
const HOME_FLOATS_FOR_TEST = HOME_BYTES_FOR_TEST / Float32Array.BYTES_PER_ELEMENT;
const LIVE_BYTES_FOR_TEST = 48;
const SORT_PAIR_BYTES_FOR_TEST = 8;

if (typeof globalThis.btoa !== 'function') {
  (globalThis as any).btoa = (value: string) =>
    (globalThis as any).Buffer.from(value, 'binary').toString('base64');
}

function floatsFromBase64(value: string): Float32Array {
  const bytes = (globalThis as any).Buffer.from(value, 'base64');
  return new Float32Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 4));
}

function makePoints(count: number) {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const t = i / Math.max(1, count - 1);
    positions[i * 3 + 0] = Math.cos(t * Math.PI * 4) * (0.4 + t);
    positions[i * 3 + 1] = Math.sin(t * Math.PI * 3) * 0.8;
    positions[i * 3 + 2] = (t - 0.5) * 2.5;
    colors[i * 3 + 0] = t;
    colors[i * 3 + 1] = 1 - t;
    colors[i * 3 + 2] = 0.25 + t * 0.5;
  }
  return { positions, colors };
}

describe('Point Cloud FX native graph', () => {
  it('exports real WGSL sources and precompile commands', () => {
    const sources = getPointCloudFXNativeShaderSources();
    const byId = new Map(sources.map((source) => [source.shaderId, source]));

    expect(byId.get(POINT_CLOUD_FX_NATIVE_SHADER_IDS.compute)?.source).toContain('@compute');
    expect(byId.get(POINT_CLOUD_FX_NATIVE_SHADER_IDS.compute)?.source).toContain('fn cs_main');
    expect(byId.get(POINT_CLOUD_FX_NATIVE_SHADER_IDS.sortFill)?.source).toContain('@compute');
    expect(byId.get(POINT_CLOUD_FX_NATIVE_SHADER_IDS.sortFill)?.source).toContain('ghost_sort_key_from_depth_far_to_near');
    expect(byId.get(POINT_CLOUD_FX_NATIVE_SHADER_IDS.sortStep)?.source).toContain('@compute');
    expect(byId.get(POINT_CLOUD_FX_NATIVE_SHADER_IDS.sortStep)?.source).toContain('ghost_sort_pair_before');
    expect(byId.get(POINT_CLOUD_FX_NATIVE_SHADER_IDS.render)?.source).toContain('@vertex');
    expect(byId.get(POINT_CLOUD_FX_NATIVE_SHADER_IDS.render)?.source).toContain('@fragment');
    expect(byId.get(POINT_CLOUD_FX_NATIVE_SHADER_IDS.render)?.source).toContain('sortPairs');
    expect(byId.get(POINT_CLOUD_FX_NATIVE_SHADER_IDS.render)?.source).toContain('GHOST_GAUSSIAN_SIGMA_EXTENT');
    expect(byId.get(POINT_CLOUD_FX_NATIVE_SHADER_IDS.render)?.source).toContain('GHOST_GAUSSIAN_MAX_SIGMA_NDC');
    expect(byId.get(POINT_CLOUD_FX_NATIVE_SHADER_IDS.render)?.source).toContain('GHOST_GAUSSIAN_SCREEN_BASIS_STEP');
    expect(byId.get(POINT_CLOUD_FX_NATIVE_SHADER_IDS.render)?.source).toContain('gaussianAaPixels');
    expect(byId.get(POINT_CLOUD_FX_NATIVE_SHADER_IDS.render)?.source).toContain('opacityScale');
    expect(byId.get(POINT_CLOUD_FX_NATIVE_SHADER_IDS.render)?.source).toContain('projectSplatAxisNdc');
    expect(byId.get(POINT_CLOUD_FX_NATIVE_SHADER_IDS.render)?.source).toContain('solveScreenToWorldOffset');
    expect(byId.get(POINT_CLOUD_FX_NATIVE_SHADER_IDS.render)?.source).toContain('gaussianScreenAxes');
    expect(byId.get(POINT_CLOUD_FX_NATIVE_SHADER_IDS.render)?.source).toContain('gaussianSigma');
    expect(byId.get(POINT_CLOUD_FX_NATIVE_SHADER_IDS.render)?.source).toContain('exp(-0.5 * r2)');
    expect(byId.get(POINT_CLOUD_FX_NATIVE_SHADER_IDS.render)?.source).toContain('firstOrderShTint');
    expect(byId.get(POINT_CLOUD_FX_NATIVE_SHADER_IDS.render)?.source).toContain('sh1Y');
    expect(byId.get(POINT_CLOUD_FX_NATIVE_SHADER_IDS.render)?.source).toContain('GHOST_SH_C1');
    for (const source of sources) {
      expect(source.source).not.toMatch(/^\s*#include\b/m);
    }

    const commands = buildPointCloudFXNativePrecompileCommands();
    expect(commands.map((command) => command.shader_id)).toEqual([
      POINT_CLOUD_FX_NATIVE_SHADER_IDS.compute,
      POINT_CLOUD_FX_NATIVE_SHADER_IDS.sortFill,
      POINT_CLOUD_FX_NATIVE_SHADER_IDS.sortStep,
      POINT_CLOUD_FX_NATIVE_SHADER_IDS.render,
    ]);
  });

  it('packs sampled point cloud data for persistent native buffers', () => {
    const { positions, colors } = makePoints(32);
    const data = buildPointCloudFXNativePointData(positions, colors, {
      maxPoints: 8,
      signature: 'synthetic-cloud',
    });

    expect(data.signature).toBe('synthetic-cloud');
    expect(data.pointCount).toBe(8);
    expect(data.sampledFromCount).toBe(32);
    expect(data.homeByteLength).toBe(8 * HOME_BYTES_FOR_TEST);
    expect(data.liveByteLength).toBe(8 * LIVE_BYTES_FOR_TEST);
    expect(data.sortCount).toBe(8);
    expect(data.sortByteLength).toBe(8 * SORT_PAIR_BYTES_FOR_TEST);
    expect(data.hasGaussianPayload).toBe(false);
    expect(data.depthSortEnabled).toBe(false);
    expect(data.homeInitialBuffer).toBeInstanceOf(ArrayBuffer);
    expect(data.liveInitialBuffer).toBeInstanceOf(ArrayBuffer);
    expect(data.sortInitialBuffer).toBeInstanceOf(ArrayBuffer);
    expect(data.homeInitialBuffer.byteLength).toBe(data.homeByteLength);
    expect(data.liveInitialBuffer.byteLength).toBe(data.liveByteLength);
    expect(data.sortInitialBuffer.byteLength).toBe(data.sortByteLength);

    const home = new Float32Array(data.homeInitialBuffer);
    const expectedSourceIndices = [0, 4, 8, 13, 17, 22, 26, 31];
    for (let i = 0; i < expectedSourceIndices.length; i++) {
      const t = expectedSourceIndices[i] / 31;
      const off = i * HOME_FLOATS_FOR_TEST;
      expect(home[off + 4]).toBeCloseTo(t);
      expect(home[off + 5]).toBeCloseTo(1 - t);
    }
  });

  it('samples point budgets across the whole source cloud', () => {
    expect(Array.from({ length: 8 }, (_, i) =>
      pointCloudSourceIndexForSample(i, 8, 32),
    )).toEqual([0, 4, 8, 13, 17, 22, 26, 31]);
    expect(Array.from({ length: 4 }, (_, i) =>
      pointCloudSourceIndexForSample(i, 4, 1_000_000),
    )).toEqual([0, 333333, 666666, 999999]);
  });

  it('packs live WebGPU buffers from the full source cloud', () => {
    const { positions, colors } = makePoints(10);
    const packed = buildPointCloudFXPackedPointBuffers(positions, colors, {
      maxPoints: 4,
      pointSize: 0.02,
    });

    expect(packed?.sourceCount).toBe(10);
    expect(packed?.pointCount).toBe(4);
    expect(packed?.sortCount).toBe(4);
    expect(packed?.depthSortEnabled).toBe(false);
    expect(packed?.homeBytes.byteLength).toBe(4 * HOME_BYTES_FOR_TEST);
    expect(packed?.liveBytes.byteLength).toBe(4 * LIVE_BYTES_FOR_TEST);
    const home = new Float32Array(packed!.homeBytes);
    const live = new Float32Array(packed!.liveBytes);
    const expectedSourceIndices = [0, 3, 6, 9];
    for (let i = 0; i < expectedSourceIndices.length; i++) {
      const t = expectedSourceIndices[i] / 9;
      const homeOff = i * HOME_FLOATS_FOR_TEST;
      expect(home[homeOff + 4]).toBeCloseTo(t);
      expect(home[homeOff + 5]).toBeCloseTo(1 - t);
      expect(live[i * 12 + 7]).toBeCloseTo(0.02 * home[homeOff + 7]);
    }
  });

  it('normalizes architectural scans without letting a distant outlier shrink the cloud', () => {
    const positions = new Float32Array([
      -1.0, 0.0, -0.2,
      -0.6, 0.1, -0.1,
      -0.3, -0.1, 0.0,
      0.0, 0.0, 0.1,
      0.3, 0.1, 0.0,
      0.6, -0.1, 0.1,
      1.0, 0.0, 0.2,
      1200.0, 0.0, 0.0,
    ]);
    const colors = new Float32Array((positions.length / 3) * 3).fill(0.8);
    const data = buildPointCloudFXNativePointData(positions, colors, {
      maxPoints: 8,
      signature: 'scan-with-outlier',
    });
    const home = new Float32Array(data.homeInitialBuffer);
    const inlierRadii = Array.from({ length: 7 }, (_, i) => {
      const off = i * HOME_FLOATS_FOR_TEST;
      return Math.hypot(home[off + 0], home[off + 1], home[off + 2]);
    });
    const inlierMax = Math.max(...inlierRadii);
    const outlierOff = 7 * HOME_FLOATS_FOR_TEST;
    const outlierRadius = Math.hypot(home[outlierOff + 0], home[outlierOff + 1], home[outlierOff + 2]);

    expect(inlierMax).toBeGreaterThan(0.5);
    expect(inlierMax).toBeLessThanOrEqual(0.95);
    expect(outlierRadius).toBeGreaterThan(100);
  });

  it('preserves gaussian opacity, scale, and rotation for native buffers', () => {
    const positions = new Float32Array([
      -0.5, 0.0, 0.0,
      0.5, 0.2, 0.1,
    ]);
    const colors = new Float32Array([
      1, 0, 0.25,
      0.2, 0.8, 1,
    ]);
    const alpha = new Float32Array([0.25, 0.75]);
    const splatScale = new Float32Array([
      -5.0, -5.5, -6.0,
      -3.2, -3.6, -4.0,
    ]);
    const splatRotation = new Float32Array([
      1, 0, 0, 0,
      0, 1, 0, 0,
    ]);
    const sphericalHarmonicsRest = new Float32Array([
      0.10, 0.20, 0.30,
      0.40, 0.50, 0.60,
      0.70, 0.80, 0.90,
      -0.10, -0.20, -0.30,
      -0.40, -0.50, -0.60,
      -0.70, -0.80, -0.90,
    ]);

    const data = buildPointCloudFXNativePointData(positions, colors, {
      alpha,
      splatScale,
      splatRotation,
      sphericalHarmonicsRest,
      gaussian: true,
      pointSize: 0.01,
      signature: 'gaussian-cloud',
      sphericalHarmonicsDegree: 1,
      sphericalHarmonicsCoefficientCount: 45,
      sphericalHarmonicsRestStride: 9,
    });
    const home = new Float32Array(data.homeInitialBuffer);
    const live = new Float32Array(data.liveInitialBuffer);

    expect(data.homeByteLength).toBe(2 * HOME_BYTES_FOR_TEST);
    expect(data.sortCount).toBe(2);
    expect(data.sortByteLength).toBe(2 * SORT_PAIR_BYTES_FOR_TEST);
    expect(data.hasGaussianPayload).toBe(true);
    expect(data.depthSortEnabled).toBe(true);
    expect(data.sphericalHarmonicsDegree).toBe(1);
    expect(data.sphericalHarmonicsCoefficientCount).toBe(45);
    expect(home[3]).toBeCloseTo(0.25);
    expect(home[7]).toBeGreaterThan(0);
    expect(home[8]).toBeGreaterThan(0);
    expect(home[11]).toBe(1);
    expect(home[12]).toBeCloseTo(1);
    expect(home[16]).toBeCloseTo(0.10);
    expect(home[17]).toBeCloseTo(0.40);
    expect(home[18]).toBeCloseTo(0.70);
    expect(home[19]).toBe(1);
    expect(home[20]).toBeCloseTo(0.20);
    expect(home[21]).toBeCloseTo(0.50);
    expect(home[22]).toBeCloseTo(0.80);
    expect(home[23]).toBe(45);
    expect(home[24]).toBeCloseTo(0.30);
    expect(home[25]).toBeCloseTo(0.60);
    expect(home[26]).toBeCloseTo(0.90);
    const secondHomeOff = HOME_FLOATS_FOR_TEST;
    expect(home[secondHomeOff + 3]).toBeCloseTo(0.75);
    expect(home[secondHomeOff + 11]).toBe(1);
    expect(home[secondHomeOff + 12]).toBeCloseTo(0);
    expect(home[secondHomeOff + 13]).toBeCloseTo(1);
    expect(home[secondHomeOff + 16]).toBeCloseTo(-0.10);
    expect(home[secondHomeOff + 20]).toBeCloseTo(-0.20);
    expect(home[secondHomeOff + 24]).toBeCloseTo(-0.30);
    expect(live[3]).toBeCloseTo(0.25);
    expect(live[7]).toBeCloseTo(0.01 * home[7]);
    expect(live[12 + 3]).toBeCloseTo(0.75);
    expect(live[12 + 7]).toBeCloseTo(0.01 * home[secondHomeOff + 7]);
  });

  it('keeps native gaussian clouds inside the depth-sort budget', () => {
    const count = 270_000;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const splatScale = new Float32Array(count * 3);
    const splatRotation = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      positions[i * 3 + 0] = t * 2 - 1;
      positions[i * 3 + 1] = Math.sin(t * Math.PI * 10) * 0.25;
      positions[i * 3 + 2] = Math.cos(t * Math.PI * 6) * 0.35;
      colors[i * 3 + 0] = 0.25 + t * 0.6;
      colors[i * 3 + 1] = 0.8 - t * 0.4;
      colors[i * 3 + 2] = 1;
      splatScale[i * 3 + 0] = -4.3;
      splatScale[i * 3 + 1] = -4.6;
      splatScale[i * 3 + 2] = -5.1;
      splatRotation[i * 4 + 0] = 1;
    }

    const data = buildPointCloudFXNativePointData(positions, colors, {
      maxPoints: 500_000,
      splatScale,
      splatRotation,
      gaussian: true,
      signature: 'oversized-gaussian-cloud',
    });

    expect(data.sampledFromCount).toBe(count);
    expect(data.pointCount).toBe(262_144);
    expect(data.sortCount).toBe(262_144);
    expect(data.depthSortEnabled).toBe(true);
    expect(data.hasGaussianPayload).toBe(true);
  });

  it('builds a native compute/render graph and reuses cloud buffers after reset', () => {
    const { positions, colors } = makePoints(96);
    const pointData = buildPointCloudFXNativePointData(positions, colors, {
      maxPoints: 48,
      signature: 'cloud-a',
    });
    const first = buildPointCloudFXNativeComputeGraph({
      sourceId: 'gpu:layer-cloud:point-cloud-fx',
      pointData,
      params: {
        topology: 'strokes',
        pointSize: 0.008,
        colorMode: 'palette4',
        colorA: [60, 100, 240],
        colorB: [240, 60, 180],
        filterMode: 'slice',
        audioReactive: true,
      },
      width: 1920,
      height: 1080,
      time: 0,
      frameDelta: 1 / 60,
      frameIndex: 1,
      audioBass: 0.6,
      audioTreble: 0.35,
      reset: true,
    });

    expect(first.config.passes).toHaveLength(1);
    expect(first.config.render_passes).toHaveLength(1);
    expect(first.config.passes[0].shader_id).toBe(POINT_CLOUD_FX_NATIVE_SHADER_IDS.compute);
    expect(first.config.render_passes[0].shader_id).toBe(POINT_CLOUD_FX_NATIVE_SHADER_IDS.render);
    expect(first.config.render_passes[0]).toMatchObject({
      target: 'source_frame',
      source_id: 'gpu:layer-cloud:point-cloud-fx',
      vertex_count: 6,
      instance_count: 48,
      blend: 'alpha',
      bindings: [
        { binding: 0, resource: 'gpu:layer-cloud:point-cloud-fx:point-cloud-fx:home', kind: 'read-only-storage' },
        { binding: 1, resource: 'gpu:layer-cloud:point-cloud-fx:point-cloud-fx:live', kind: 'read-only-storage' },
        { binding: 2, resource: 'gpu:layer-cloud:point-cloud-fx:point-cloud-fx:render-uniform', kind: 'uniform' },
        { binding: 3, resource: 'gpu:layer-cloud:point-cloud-fx:point-cloud-fx:sort-pairs', kind: 'read-only-storage' },
      ],
    });
    const home = first.config.buffers.find((buffer) => buffer.id.endsWith(':home'));
    const live = first.config.buffers.find((buffer) => buffer.id.endsWith(':live'));
    const sortPairs = first.config.buffers.find((buffer) => buffer.id.endsWith(':sort-pairs'));
    expect(home).toMatchObject({ kind: 'read-only-storage', persistent: true, clear: true });
    expect(live).toMatchObject({ kind: 'storage', persistent: true, clear: true });
    expect(sortPairs).toMatchObject({ kind: 'storage', persistent: true, clear: true });
    expect(home?.initial_buffer).toBe(pointData.homeInitialBuffer);
    expect(live?.initial_buffer).toBe(pointData.liveInitialBuffer);
    expect(sortPairs?.initial_buffer).toBe(pointData.sortInitialBuffer);
    const renderUniform = first.config.buffers.find((buffer) => buffer.id.endsWith(':render-uniform'));
    const renderFloats = floatsFromBase64(renderUniform?.initial_b64 ?? '');
    expect(renderFloats[29]).toBeCloseTo(1920);
    expect(renderFloats[30]).toBeCloseTo(1080);
    expect(renderFloats[31]).toBeCloseTo(0.75);

    const second = buildPointCloudFXNativeComputeGraph({
      sourceId: 'gpu:layer-cloud:point-cloud-fx',
      pointData,
      params: { topology: 'strokes', audioReactive: true },
      width: 1920,
      height: 1080,
      time: 1 / 60,
      frameDelta: 1 / 60,
      frameIndex: 2,
      audioBass: 0.1,
      audioTreble: 0.2,
      state: first.state,
    });

    expect(second.config.buffers.find((buffer) => buffer.id.endsWith(':home'))?.initial_b64).toBeUndefined();
    expect(second.config.buffers.find((buffer) => buffer.id.endsWith(':live'))?.initial_b64).toBeUndefined();
    expect(second.config.buffers.find((buffer) => buffer.id.endsWith(':sort-pairs'))?.initial_b64).toBeUndefined();
    expect(second.config.buffers.find((buffer) => buffer.id.endsWith(':home'))?.initial_buffer).toBeUndefined();
    expect(second.config.buffers.find((buffer) => buffer.id.endsWith(':live'))?.initial_buffer).toBeUndefined();
    expect(second.config.buffers.find((buffer) => buffer.id.endsWith(':sort-pairs'))?.initial_buffer).toBeUndefined();
    expect(second.state.pointDataSignature).toBe('cloud-a');
    expect(second.state.waveTime).toBeGreaterThan(first.state.waveTime);
  });

  it('adds native depth-sort passes for gaussian splat payloads', () => {
    const { positions, colors } = makePoints(12);
    const splatScale = new Float32Array(12 * 3).fill(-4.5);
    const splatRotation = new Float32Array(12 * 4);
    for (let i = 0; i < 12; i++) {
      splatRotation[i * 4] = 1;
    }
    const pointData = buildPointCloudFXNativePointData(positions, colors, {
      maxPoints: 12,
      splatScale,
      splatRotation,
      gaussian: true,
      signature: 'gaussian-sort-cloud',
    });
    const graph = buildPointCloudFXNativeComputeGraph({
      sourceId: 'gpu:layer-gaussian:point-cloud-fx',
      pointData,
      params: { topology: 'billboards', autoRotateY: 0 },
      width: 1280,
      height: 720,
      time: 0,
      frameDelta: 1 / 60,
      frameIndex: 5,
      reset: true,
    });

    expect(pointData.sortCount).toBe(16);
    expect(graph.config.passes[0].shader_id).toBe(POINT_CLOUD_FX_NATIVE_SHADER_IDS.compute);
    expect(graph.config.passes[1]).toMatchObject({
      shader_id: POINT_CLOUD_FX_NATIVE_SHADER_IDS.sortFill,
      dispatch: [1, 1, 1],
    });
    expect(graph.config.passes.slice(2).every((pass) =>
      pass.shader_id === POINT_CLOUD_FX_NATIVE_SHADER_IDS.sortStep,
    )).toBe(true);
    expect(graph.config.passes).toHaveLength(1 + 1 + 10);
    expect(graph.config.buffers.some((buffer) => buffer.id.endsWith(':sort-step-uniform-9'))).toBe(true);
    expect(graph.config.render_passes[0].bindings).toContainEqual({
      binding: 3,
      resource: 'gpu:layer-gaussian:point-cloud-fx:point-cloud-fx:sort-pairs',
      kind: 'read-only-storage',
    });
  });
});
