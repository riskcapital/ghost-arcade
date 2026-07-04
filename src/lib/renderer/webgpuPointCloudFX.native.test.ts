import { describe, expect, it } from 'vitest';
import {
  POINT_CLOUD_FX_NATIVE_SHADER_IDS,
  buildPointCloudFXNativeComputeGraph,
  buildPointCloudFXNativePointData,
  buildPointCloudFXNativePrecompileCommands,
  getPointCloudFXNativeShaderSources,
} from './webgpuPointCloudFX';

if (typeof globalThis.btoa !== 'function') {
  (globalThis as any).btoa = (value: string) =>
    (globalThis as any).Buffer.from(value, 'binary').toString('base64');
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
    expect(byId.get(POINT_CLOUD_FX_NATIVE_SHADER_IDS.render)?.source).toContain('@vertex');
    expect(byId.get(POINT_CLOUD_FX_NATIVE_SHADER_IDS.render)?.source).toContain('@fragment');
    for (const source of sources) {
      expect(source.source).not.toMatch(/^\s*#include\b/m);
    }

    const commands = buildPointCloudFXNativePrecompileCommands();
    expect(commands.map((command) => command.shader_id)).toEqual([
      POINT_CLOUD_FX_NATIVE_SHADER_IDS.compute,
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
    expect(data.homeByteLength).toBe(8 * 32);
    expect(data.liveByteLength).toBe(8 * 48);
    expect(data.homeInitialB64.length).toBeGreaterThan(16);
    expect(data.liveInitialB64.length).toBeGreaterThan(16);
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
    });
    const home = first.config.buffers.find((buffer) => buffer.id.endsWith(':home'));
    const live = first.config.buffers.find((buffer) => buffer.id.endsWith(':live'));
    expect(home).toMatchObject({ kind: 'read-only-storage', persistent: true, clear: true });
    expect(live).toMatchObject({ kind: 'storage', persistent: true, clear: true });
    expect(home?.initial_b64).toBe(pointData.homeInitialB64);
    expect(live?.initial_b64).toBe(pointData.liveInitialB64);

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
    expect(second.state.pointDataSignature).toBe('cloud-a');
    expect(second.state.waveTime).toBeGreaterThan(first.state.waveTime);
  });
});
