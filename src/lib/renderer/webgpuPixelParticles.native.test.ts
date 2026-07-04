import { describe, expect, it } from 'vitest';
import {
  buildPixelParticlesNativeComputeGraph,
  buildPixelParticlesNativePrecompileCommands,
  getPixelParticlesNativeShaderSources,
  PIXEL_PARTICLES_NATIVE_SHADER_IDS,
} from './webgpuPixelParticles';

if (typeof (globalThis as any).btoa !== 'function') {
  (globalThis as any).btoa = (value: string) =>
    (globalThis as any).Buffer.from(value, 'binary').toString('base64');
}

describe('Pixel Particles native shader bundle', () => {
  it('exposes the real Pixel Particles compute and render WGSL', () => {
    const sources = getPixelParticlesNativeShaderSources();
    const byId = new Map(sources.map((source) => [source.shaderId, source]));

    expect(sources).toHaveLength(2);
    expect(byId.has(PIXEL_PARTICLES_NATIVE_SHADER_IDS.compute)).toBe(true);
    expect(byId.has(PIXEL_PARTICLES_NATIVE_SHADER_IDS.render)).toBe(true);
    expect(byId.get(PIXEL_PARTICLES_NATIVE_SHADER_IDS.compute)?.source).toContain('@compute');
    expect(byId.get(PIXEL_PARTICLES_NATIVE_SHADER_IDS.compute)?.source).toContain('fn cs_main');
    expect(byId.get(PIXEL_PARTICLES_NATIVE_SHADER_IDS.render)?.source).toContain('@vertex');
    expect(byId.get(PIXEL_PARTICLES_NATIVE_SHADER_IDS.render)?.source).toContain('@fragment');
    for (const source of sources) {
      expect(source.source).not.toMatch(/^\s*#include\b/m);
    }
  });

  it('builds native precompile commands from the same shader bundle', () => {
    const sources = getPixelParticlesNativeShaderSources();
    const commands = buildPixelParticlesNativePrecompileCommands();

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

  it('builds a persistent native graph that computes from and renders against a source frame', () => {
    const first = buildPixelParticlesNativeComputeGraph({
      sourceId: 'gpu:layer-pixels:pixel-particles',
      mediaSourceId: 'media:pixel-source',
      params: {
        mode: 'depth-shift',
        particleCount: 4096,
        depthAmount: 0.8,
        depthMotion: 'drift',
        depthMotionAmount: 0.2,
        mirrorX: true,
      },
      width: 640,
      height: 360,
      sourceFrameSize: 1024,
      time: 1,
      frameDelta: 1 / 60,
      frameIndex: 4,
      reset: true,
    });

    expect(first.particleCount).toBe(4096);
    expect(first.mode).toBe('depth-shift');
    expect(first.mediaSourceId).toBe('media:pixel-source');
    expect(first.config.passes).toHaveLength(1);
    expect(first.config.passes[0]).toMatchObject({
      shader_id: PIXEL_PARTICLES_NATIVE_SHADER_IDS.compute,
      entry: 'cs_main',
      dispatch: [64, 1, 1],
    });
    expect(first.config.passes[0].bindings).toContainEqual(
      expect.objectContaining({ binding: 2, kind: 'source-frame-texture', source_id: 'media:pixel-source' }),
    );
    expect(first.config.passes[0].bindings).toContainEqual(
      expect.objectContaining({ binding: 4, kind: 'source-frame-texture', allow_missing: true }),
    );
    expect(first.config.buffers.find((buffer) => buffer.id.endsWith(':particles'))).toMatchObject({
      kind: 'storage',
      byte_length: 4096 * 32,
      persistent: true,
      clear: true,
    });
    expect(first.config.buffers.find((buffer) => buffer.id.endsWith(':particles'))?.initial_buffer).toBeInstanceOf(ArrayBuffer);
    expect(first.config.render_passes).toHaveLength(1);
    expect(first.config.render_passes[0]).toMatchObject({
      target: 'source_frame',
      source_id: 'gpu:layer-pixels:pixel-particles',
      shader_id: PIXEL_PARTICLES_NATIVE_SHADER_IDS.render,
      clear_color: [0, 0, 0, 0],
      vertex_count: 6,
      instance_count: 4096,
      blend: 'alpha',
    });
    expect(first.config.render_passes[0].bindings).toContainEqual(
      expect.objectContaining({ binding: 2, kind: 'source-frame-texture', source_id: 'media:pixel-source' }),
    );

    const second = buildPixelParticlesNativeComputeGraph({
      sourceId: 'gpu:layer-pixels:pixel-particles',
      mediaSourceId: 'media:pixel-source',
      params: {
        mode: 'depth-shift',
        particleCount: 4096,
        depthAmount: 0.8,
      },
      width: 640,
      height: 360,
      sourceFrameSize: 1024,
      time: 1 + 1 / 60,
      frameDelta: 1 / 60,
      frameIndex: 5,
      state: first.state,
    });

    const particleBuffer = second.config.buffers.find((buffer) => buffer.id.endsWith(':particles'));
    expect(particleBuffer?.clear).toBe(false);
    expect(particleBuffer?.initial_b64).toBeUndefined();
    expect(particleBuffer?.initial_buffer).toBeUndefined();
    expect(second.config.render_passes[0].source_id).toBe(first.config.render_passes[0].source_id);
  });

  it('resets persistent state when mode changes', () => {
    const first = buildPixelParticlesNativeComputeGraph({
      sourceId: 'gpu:layer-pixels:pixel-particles',
      mediaSourceId: 'media:pixel-source',
      params: { mode: 'scatter', particleCount: 2048 },
      reset: true,
    });
    const second = buildPixelParticlesNativeComputeGraph({
      sourceId: 'gpu:layer-pixels:pixel-particles',
      mediaSourceId: 'media:pixel-source',
      params: { mode: 'dissolve', particleCount: 2048 },
      state: first.state,
    });

    expect(second.mode).toBe('dissolve');
    expect(second.config.buffers.find((buffer) => buffer.id.endsWith(':particles'))?.clear).toBe(true);
  });
});
