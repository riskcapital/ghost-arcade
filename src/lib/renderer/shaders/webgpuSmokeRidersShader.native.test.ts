import { describe, expect, it } from 'vitest';
import {
  buildSmokeRidersInnerParams,
  buildSmokeRidersNativeComputeGraph,
} from './webgpuSmokeRidersShader';

if (typeof (globalThis as any).btoa !== 'function') {
  (globalThis as any).btoa = (value: string) =>
    (globalThis as any).Buffer.from(value, 'binary').toString('base64');
}

describe('Smoke Riders native graph composition', () => {
  it('maps curated Smoke Riders params into smoke and sphere inner params', () => {
    const mapped = buildSmokeRidersInnerParams({
      quality: 'performance',
      style: 'ember',
      sphereCount: 240,
      bassDrive: 2,
      audioReactive: true,
    }, { bass: 0.5, treble: 0.2 });

    expect(mapped.smoke.gridSize).toBe(32);
    expect(mapped.smoke.emitterCount).toBe(6);
    expect(mapped.smoke.bass).toBeGreaterThan(0);
    expect(mapped.spheres.layout).toBe('column');
    expect(mapped.spheres.sphereCount).toBe(132);
    expect(mapped.spheres.backgroundOpacity).toBe(0);
    expect(mapped.spheres.clearBackground).toBe(false);
  });

  it('builds one native graph that renders smoke then spheres into the same source frame', () => {
    const graph = buildSmokeRidersNativeComputeGraph({
      sourceId: 'gpu:layer-a:smoke-riders',
      params: {
        quality: 'performance',
        style: 'orbital',
        sphereCount: 96,
        smokeDensity: 2.4,
      },
      width: 640,
      height: 360,
      time: 1,
      frameDelta: 1 / 60,
      frameIndex: 10,
      audioBass: 0.25,
      audioTreble: 0.1,
      reset: true,
    });

    expect(graph.config.readbacks).toEqual([]);
    expect(graph.config.passes.length).toBeGreaterThan(1);
    expect(graph.config.passes.some((pass) => pass.shader_id === '3d-smoke/splat')).toBe(true);
    expect(graph.config.passes.some((pass) => pass.shader_id === 'volumetric-spheres/sim')).toBe(true);
    expect(graph.config.render_passes).toHaveLength(2);
    expect(graph.config.render_passes[0]).toMatchObject({
      shader_id: '3d-smoke/render',
      source_id: 'gpu:layer-a:smoke-riders',
      clear: true,
      blend: 'replace',
    });
    expect(graph.config.render_passes[1]).toMatchObject({
      shader_id: 'volumetric-spheres/render',
      source_id: 'gpu:layer-a:smoke-riders',
      clear: false,
      blend: 'alpha',
      depth: true,
    });
    expect(graph.state.smoke).toBeTruthy();
    expect(graph.state.spheres).toBeTruthy();

    const second = buildSmokeRidersNativeComputeGraph({
      sourceId: 'gpu:layer-a:smoke-riders',
      params: {
        quality: 'performance',
        style: 'orbital',
        sphereCount: 96,
      },
      width: 640,
      height: 360,
      time: 1 + 1 / 60,
      frameDelta: 1 / 60,
      frameIndex: 11,
      state: graph.state,
    });
    const sphereBuffer = second.config.buffers.find((buffer) => String(buffer.id).endsWith(':spheres'));
    expect(sphereBuffer?.clear).toBe(false);
    expect(sphereBuffer?.initial_b64).toBeUndefined();
  });
});
