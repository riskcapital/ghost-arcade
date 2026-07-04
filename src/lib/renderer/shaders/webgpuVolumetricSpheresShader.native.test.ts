import { describe, expect, it } from 'vitest';
import {
  buildVolumetricSpheresNativeComputeGraph,
  buildVolumetricSpheresNativePrecompileCommands,
  getVolumetricSpheresNativeShaderSources,
  VOLUMETRIC_SPHERES_NATIVE_SHADER_IDS,
} from './webgpuVolumetricSpheresShader';

if (typeof (globalThis as any).btoa !== 'function') {
  (globalThis as any).btoa = (value: string) =>
    (globalThis as any).Buffer.from(value, 'binary').toString('base64');
}

describe('Volumetric Spheres native shader bundle', () => {
  it('exposes the real Volumetric Spheres WGSL passes', () => {
    const sources = getVolumetricSpheresNativeShaderSources();
    const byId = new Map(sources.map((source) => [source.shaderId, source]));

    expect(sources).toHaveLength(2);
    expect(byId.has(VOLUMETRIC_SPHERES_NATIVE_SHADER_IDS.sim)).toBe(true);
    expect(byId.has(VOLUMETRIC_SPHERES_NATIVE_SHADER_IDS.render)).toBe(true);

    for (const source of sources) {
      expect(source.source).toContain(source.entry);
      expect(source.source).not.toMatch(/^\s*#include\b/m);
      if (source.stage === 'compute') {
        expect(source.source).toContain('@compute');
      } else {
        expect(source.source).toContain('@vertex');
        expect(source.source).toContain('@fragment');
        expect(source.source).toContain('fn vs_main');
        expect(source.source).toContain('fn fs_main');
      }
    }
  });

  it('builds native precompile commands from the same shader bundle', () => {
    const sources = getVolumetricSpheresNativeShaderSources();
    const commands = buildVolumetricSpheresNativePrecompileCommands();

    expect(commands).toHaveLength(sources.length);
    for (const [index, command] of commands.entries()) {
      expect(command).toEqual({
        type: 'precompile_shader',
        shader_id: sources[index].shaderId,
        stage: sources[index].stage,
        entry: sources[index].entry,
        source: sources[index].source,
      });
    }
  });

  it('builds a persistent native graph that simulates and renders analytic spheres', () => {
    const first = buildVolumetricSpheresNativeComputeGraph({
      sourceId: 'gpu:layer-a:volumetric-balls',
      params: {
        layout: 'orbital',
        sphereCount: 128,
        autoRotateY: 6,
        colorA: [70, 170, 255],
        colorB: [255, 78, 166],
      },
      width: 640,
      height: 360,
      time: 1,
      frameDelta: 1 / 60,
      frameIndex: 12,
      reset: true,
    });

    expect(first.sphereCount).toBe(128);
    expect(first.passCount).toBe(2);
    expect(first.config.readbacks).toEqual([]);
    expect(first.config.passes).toEqual([
      expect.objectContaining({
        name: 'volumetric-spheres-sim',
        shader_id: VOLUMETRIC_SPHERES_NATIVE_SHADER_IDS.sim,
        entry: 'cs_main',
        dispatch: [2, 1, 1],
      }),
    ]);
    expect(first.config.buffers.find((buffer) => buffer.id.endsWith(':spheres'))).toMatchObject({
      kind: 'storage',
      byte_length: 128 * 12 * 4,
      persistent: true,
      clear: true,
    });
    expect(first.config.buffers.find((buffer) => buffer.id.endsWith(':spheres'))?.initial_b64).toBeTruthy();
    expect(first.config.render_passes).toEqual([
      expect.objectContaining({
        name: 'volumetric-spheres-render',
        shader_id: VOLUMETRIC_SPHERES_NATIVE_SHADER_IDS.render,
        target: 'source_frame',
        source_id: 'gpu:layer-a:volumetric-balls',
        vertex_count: 6,
        instance_count: 128,
        depth: true,
        blend: 'alpha',
        clear_color: expect.arrayContaining([expect.any(Number)]),
      }),
    ]);
    expect(first.config.render_passes[0].clear_color?.[3]).toBeGreaterThan(0);

    const second = buildVolumetricSpheresNativeComputeGraph({
      sourceId: 'gpu:layer-a:volumetric-balls',
      params: {
        layout: 'orbital',
        sphereCount: 128,
        autoRotateY: 6,
      },
      width: 640,
      height: 360,
      time: 1 + 1 / 60,
      frameDelta: 1 / 60,
      frameIndex: 13,
      state: first.state,
    });

    const sphereBuffer = second.config.buffers.find((buffer) => buffer.id.endsWith(':spheres'));
    expect(second.state.autoRotYPhase).toBeGreaterThan(first.state.autoRotYPhase);
    expect(sphereBuffer?.clear).toBe(false);
    expect(sphereBuffer?.initial_b64).toBeUndefined();
    expect(second.config.render_passes[0].source_id).toBe(first.config.render_passes[0].source_id);
  });
});
