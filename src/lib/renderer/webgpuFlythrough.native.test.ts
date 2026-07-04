import { describe, expect, it } from 'vitest';
import {
  buildFlythroughNativeComputeGraph,
  buildFlythroughNativePrecompileCommands,
  FLYTHROUGH_NATIVE_SHADER_IDS,
  getFlythroughNativeShaderSources,
} from './webgpuFlythrough';

if (typeof (globalThis as any).btoa !== 'function') {
  (globalThis as any).btoa = (value: string) =>
    (globalThis as any).Buffer.from(value, 'binary').toString('base64');
}

describe('Flythrough native shader bundle', () => {
  it('exposes the real Flythrough compute and render WGSL', () => {
    const sources = getFlythroughNativeShaderSources();
    const byId = new Map(sources.map((source) => [source.shaderId, source]));

    expect(sources).toHaveLength(2);
    expect(byId.has(FLYTHROUGH_NATIVE_SHADER_IDS.compute)).toBe(true);
    expect(byId.has(FLYTHROUGH_NATIVE_SHADER_IDS.render)).toBe(true);

    const compute = byId.get(FLYTHROUGH_NATIVE_SHADER_IDS.compute);
    const render = byId.get(FLYTHROUGH_NATIVE_SHADER_IDS.render);
    expect(compute?.source).toContain('@compute');
    expect(compute?.source).toContain('fn cs_main');
    expect(render?.source).toContain('@vertex');
    expect(render?.source).toContain('@fragment');
    expect(render?.source).toContain('fn vs_main');
    expect(render?.source).toContain('fn fs_main');
    for (const source of sources) {
      expect(source.source).not.toMatch(/^\s*#include\b/m);
    }
  });

  it('builds native precompile commands from the same shader bundle', () => {
    const sources = getFlythroughNativeShaderSources();
    const commands = buildFlythroughNativePrecompileCommands();

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

  it('builds a persistent native graph that samples a source frame and renders slabs', () => {
    const first = buildFlythroughNativeComputeGraph({
      sourceId: 'gpu:layer-fly:flythrough',
      mediaSourceId: 'media:input-source',
      params: {
        topology: 'strokes',
        particleCount: 4096,
        slabCount: 3,
        flySpeed: 1.2,
        audioReactive: true,
      },
      width: 640,
      height: 360,
      time: 1,
      frameDelta: 1 / 60,
      frameIndex: 7,
      audioBass: 0.5,
      reset: true,
    });

    expect(first.particleCount).toBe(4096);
    expect(first.topology).toBe('strokes');
    expect(first.mediaSourceId).toBe('media:input-source');
    expect(first.config.readbacks).toEqual([]);
    expect(first.config.passes).toHaveLength(1);
    expect(first.config.passes[0]).toMatchObject({
      shader_id: FLYTHROUGH_NATIVE_SHADER_IDS.compute,
      entry: 'cs_main',
      dispatch: [64, 1, 1],
    });
    expect(first.config.buffers.find((buffer) => buffer.id.endsWith(':particles'))).toMatchObject({
      kind: 'storage',
      byte_length: 4096 * 48,
      persistent: true,
      clear: true,
    });
    expect(first.config.buffers.find((buffer) => buffer.id.endsWith(':particles'))?.initial_buffer).toBeInstanceOf(ArrayBuffer);
    expect(first.config.render_passes).toHaveLength(1);
    expect(first.config.render_passes[0]).toMatchObject({
      target: 'source_frame',
      source_id: 'gpu:layer-fly:flythrough',
      shader_id: FLYTHROUGH_NATIVE_SHADER_IDS.render,
      clear_color: [0, 0, 0, 0],
      vertex_count: 6,
      instance_count: 3 * 4096,
      blend: 'alpha',
    });
    expect(first.config.render_passes[0].bindings).toContainEqual(
      expect.objectContaining({ binding: 2, kind: 'source-frame-texture', source_id: 'media:input-source' }),
    );
    expect(first.state.flyDistance).toBeGreaterThan(0);

    const second = buildFlythroughNativeComputeGraph({
      sourceId: 'gpu:layer-fly:flythrough',
      mediaSourceId: 'media:input-source',
      params: {
        topology: 'strokes',
        particleCount: 4096,
        slabCount: 3,
        flySpeed: 1.2,
      },
      width: 640,
      height: 360,
      time: 1 + 1 / 60,
      frameDelta: 1 / 60,
      frameIndex: 8,
      state: first.state,
    });

    expect(second.state.flyDistance).toBeGreaterThan(first.state.flyDistance);
    const particleBuffer = second.config.buffers.find((buffer) => buffer.id.endsWith(':particles'));
    expect(particleBuffer?.clear).toBe(false);
    expect(particleBuffer?.initial_b64).toBeUndefined();
    expect(particleBuffer?.initial_buffer).toBeUndefined();
    expect(second.config.render_passes[0].source_id).toBe(first.config.render_passes[0].source_id);
  });

  it('marks the source texture binding optional when no media source is supplied', () => {
    const graph = buildFlythroughNativeComputeGraph({
      sourceId: 'gpu:layer-fly:fallback',
      params: { particleCount: 2048 },
      width: 320,
      height: 180,
      time: 0,
      frameDelta: 1 / 60,
      reset: true,
    });

    expect(graph.config.render_passes[0].bindings).toContainEqual(
      expect.objectContaining({ binding: 2, kind: 'source-frame-texture', allow_missing: true }),
    );
  });
});
