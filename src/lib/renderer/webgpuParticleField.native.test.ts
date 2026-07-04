import { describe, expect, it } from 'vitest';
import {
  buildParticleFieldNativeComputeGraph,
  buildParticleFieldNativePrecompileCommands,
  getParticleFieldNativeShaderSources,
  PARTICLE_FIELD_NATIVE_SHADER_IDS,
} from './webgpuParticleField';

if (typeof (globalThis as any).btoa !== 'function') {
  (globalThis as any).btoa = (value: string) =>
    (globalThis as any).Buffer.from(value, 'binary').toString('base64');
}

describe('Particle Field native shader bundle', () => {
  it('exposes the real Particle Field WGSL passes with resolved includes', () => {
    const sources = getParticleFieldNativeShaderSources();
    const byId = new Map(sources.map((source) => [source.shaderId, source]));

    expect(sources).toHaveLength(5);
    for (const shaderId of Object.values(PARTICLE_FIELD_NATIVE_SHADER_IDS)) {
      expect(byId.has(shaderId)).toBe(true);
    }

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
    const sources = getParticleFieldNativeShaderSources();
    const commands = buildParticleFieldNativePrecompileCommands();

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

  it('builds a persistent native graph that renders particles into a source frame', () => {
    const first = buildParticleFieldNativeComputeGraph({
      sourceId: 'gpu:layer-a:particle-field',
      params: {
        mode: 'gravity',
        topology: 'softSphere',
        particleCount: 4096,
        connectEnabled: false,
        fogOpacity: 0.65,
        bass: 0.4,
      },
      width: 640,
      height: 360,
      time: 1,
      frameDelta: 1 / 60,
      frameIndex: 12,
      reset: true,
    });

    expect(first.particleCount).toBe(4096);
    expect(first.topology).toBe('softSphere');
    expect(first.config.readbacks).toEqual([]);
    expect(first.config.passes).toHaveLength(1);
    expect(first.config.passes[0]).toMatchObject({
      shader_id: PARTICLE_FIELD_NATIVE_SHADER_IDS.behavior,
      entry: 'cs_main',
      dispatch: [64, 1, 1],
    });
    expect(first.config.passes[0].bindings).toContainEqual(
      expect.objectContaining({ binding: 2, kind: 'source-frame-texture', allow_missing: true }),
    );
    expect(first.config.buffers.find((buffer) => buffer.id.endsWith(':particles'))).toMatchObject({
      kind: 'storage',
      byte_length: 4096 * 64,
      persistent: true,
      clear: true,
    });
    expect(first.config.buffers.find((buffer) => buffer.id.endsWith(':particles'))?.initial_b64).toBeTruthy();
    expect(first.config.render_passes.map((pass) => pass.shader_id)).toEqual([
      PARTICLE_FIELD_NATIVE_SHADER_IDS.fog,
      PARTICLE_FIELD_NATIVE_SHADER_IDS.render,
    ]);
    expect(first.config.render_passes[1]).toMatchObject({
      target: 'source_frame',
      source_id: 'gpu:layer-a:particle-field',
      vertex_count: 6,
      instance_count: 4096,
      depth: true,
      blend: 'alpha',
    });

    const second = buildParticleFieldNativeComputeGraph({
      sourceId: 'gpu:layer-a:particle-field',
      params: {
        mode: 'gravity',
        topology: 'softSphere',
        particleCount: 4096,
        connectEnabled: false,
        fogOpacity: 0.65,
        bass: 0.6,
      },
      width: 640,
      height: 360,
      time: 1 + 1 / 60,
      frameDelta: 1 / 60,
      frameIndex: 13,
      state: first.state,
    });

    expect(second.state.burstImpulse).toBeGreaterThan(first.state.burstImpulse);
    const particleBuffer = second.config.buffers.find((buffer) => buffer.id.endsWith(':particles'));
    expect(particleBuffer?.clear).toBe(false);
    expect(particleBuffer?.initial_b64).toBeUndefined();
    expect(second.config.render_passes[1].source_id).toBe(first.config.render_passes[1].source_id);
  });

  it('adds native edge compute and line-list render passes when connections are enabled', () => {
    const graph = buildParticleFieldNativeComputeGraph({
      sourceId: 'gpu:layer-b:particle-field',
      params: {
        mode: 'galaxy',
        topology: 'glow',
        particleCount: 2048,
        connectEnabled: true,
        partnerCount: 4,
        fogOpacity: 0.4,
      },
      width: 640,
      height: 360,
      time: 2,
      frameDelta: 1 / 60,
      frameIndex: 22,
      reset: true,
    });

    expect(graph.config.passes.map((pass) => pass.shader_id)).toEqual([
      PARTICLE_FIELD_NATIVE_SHADER_IDS.behavior,
      PARTICLE_FIELD_NATIVE_SHADER_IDS.edges,
    ]);
    expect(graph.config.buffers.find((buffer) => buffer.id.endsWith(':indirect'))).toMatchObject({
      kind: 'storage',
      byte_length: 16,
      persistent: true,
      initial_u32: [2, 0, 0, 0],
      indirect: true,
    });
    expect(graph.config.buffers.find((buffer) => buffer.id.endsWith(':edges'))).toMatchObject({
      kind: 'storage',
      byte_length: 600000 * 16,
      persistent: true,
      clear: true,
    });
    expect(graph.config.render_passes.map((pass) => pass.shader_id)).toEqual([
      PARTICLE_FIELD_NATIVE_SHADER_IDS.fog,
      PARTICLE_FIELD_NATIVE_SHADER_IDS.render,
      PARTICLE_FIELD_NATIVE_SHADER_IDS.lines,
    ]);
    expect(graph.config.render_passes[2]).toMatchObject({
      primitive: 'line-list',
      vertex_count: 2,
      instance_count: 0,
      blend: 'alpha',
    });
    expect(graph.config.render_passes[2].draw_indirect_buffer).toMatch(/:indirect$/);
  });
});
