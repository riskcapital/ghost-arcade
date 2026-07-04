import { describe, expect, it } from 'vitest';
import {
  buildInkCloudNativeComputeGraph,
  buildInkCloudNativePrecompileCommands,
  getInkCloudNativeShaderSources,
  INK_CLOUD_NATIVE_SHADER_IDS,
} from './webgpuInkCloud';

if (typeof (globalThis as any).btoa !== 'function') {
  (globalThis as any).btoa = (value: string) =>
    (globalThis as any).Buffer.from(value, 'binary').toString('base64');
}

describe('Ink Cloud native shader bundle', () => {
  it('exposes the real Ink Cloud WGSL stages', () => {
    const sources = getInkCloudNativeShaderSources();
    const byId = new Map(sources.map((source) => [source.shaderId, source]));

    expect(sources).toHaveLength(3);
    expect(byId.has(INK_CLOUD_NATIVE_SHADER_IDS.sim)).toBe(true);
    expect(byId.has(INK_CLOUD_NATIVE_SHADER_IDS.render)).toBe(true);
    expect(byId.has(INK_CLOUD_NATIVE_SHADER_IDS.background)).toBe(true);

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
    const sources = getInkCloudNativeShaderSources();
    const commands = buildInkCloudNativePrecompileCommands();

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

  it('builds a persistent native graph that simulates and renders Ink Cloud particles', () => {
    const first = buildInkCloudNativeComputeGraph({
      sourceId: 'gpu:layer-a:ink-cloud',
      params: {
        particleCount: 16_384,
        emitterCount: 5,
        spread: 0.62,
        bgOpacity: 0.85,
        emitterColor1: [255, 100, 45],
        emitterColor2: [45, 200, 255],
        autoRotateY: 8,
      },
      width: 640,
      height: 360,
      time: 1,
      frameDelta: 1 / 60,
      frameIndex: 12,
      audioBass: 0.9,
      audioTreble: 0.4,
      reset: true,
    });

    expect(first.particleCount).toBe(16_384);
    expect(first.passCount).toBe(3);
    expect(first.config.readbacks).toEqual([]);
    expect(first.config.passes).toEqual([
      expect.objectContaining({
        name: 'ink-cloud-sim',
        shader_id: INK_CLOUD_NATIVE_SHADER_IDS.sim,
        entry: 'cs_main',
        dispatch: [256, 1, 1],
      }),
    ]);
    expect(first.config.buffers.find((buffer) => buffer.id.endsWith(':particles'))).toMatchObject({
      kind: 'storage',
      byte_length: 16_384 * 64,
      persistent: true,
      clear: true,
    });
    expect(first.config.buffers.find((buffer) => buffer.id.endsWith(':particles'))?.initial_buffer).toBeInstanceOf(ArrayBuffer);
    expect(first.config.buffers.find((buffer) => buffer.id.endsWith(':emitters'))).toMatchObject({
      kind: 'storage',
      byte_length: 8 * 32,
    });
    expect(first.config.render_passes).toEqual([
      expect.objectContaining({
        name: 'ink-cloud-background',
        shader_id: INK_CLOUD_NATIVE_SHADER_IDS.background,
        target: 'source_frame',
        source_id: 'gpu:layer-a:ink-cloud',
        vertex_count: 3,
        instance_count: 1,
        clear: true,
        blend: 'alpha',
      }),
      expect.objectContaining({
        name: 'ink-cloud-render',
        shader_id: INK_CLOUD_NATIVE_SHADER_IDS.render,
        target: 'source_frame',
        source_id: 'gpu:layer-a:ink-cloud',
        vertex_count: 6,
        instance_count: 16_384,
        clear: false,
        blend: 'alpha',
      }),
    ]);

    const second = buildInkCloudNativeComputeGraph({
      sourceId: 'gpu:layer-a:ink-cloud',
      params: {
        particleCount: 16_384,
        emitterCount: 5,
        spread: 0.62,
        autoRotateY: 8,
      },
      width: 640,
      height: 360,
      time: 1 + 1 / 60,
      frameDelta: 1 / 60,
      frameIndex: 13,
      state: first.state,
    });

    const particleBuffer = second.config.buffers.find((buffer) => buffer.id.endsWith(':particles'));
    expect(second.state.autoRotYPhase).toBeGreaterThan(first.state.autoRotYPhase);
    expect(particleBuffer?.clear).toBe(false);
    expect(particleBuffer?.initial_b64).toBeUndefined();
    expect(particleBuffer?.initial_buffer).toBeUndefined();
    expect(second.config.render_passes[1].source_id).toBe(first.config.render_passes[1].source_id);
  });
});
