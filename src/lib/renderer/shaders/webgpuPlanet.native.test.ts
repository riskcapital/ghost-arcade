import { describe, expect, it } from 'vitest';
import {
  buildPlanetNativeComputeGraph,
  buildPlanetNativePrecompileCommands,
  getPlanetNativeShaderSource,
  PLANET_NATIVE_SHADER_IDS,
} from './webgpuPlanet';

if (typeof (globalThis as any).btoa !== 'function') {
  (globalThis as any).btoa = (value: string) =>
    (globalThis as any).Buffer.from(value, 'binary').toString('base64');
}

describe('Planet native shader bundle', () => {
  it('exposes the real Planet WGSL render shader', () => {
    const source = getPlanetNativeShaderSource();

    expect(source.shaderId).toBe(PLANET_NATIVE_SHADER_IDS.render);
    expect(source.stage).toBe('render');
    expect(source.entry).toBe('fs_planet');
    expect(source.source).toContain('fn vs_full');
    expect(source.source).toContain('fn fs_planet');
    expect(source.source).toContain('@fragment fn fs_planet(in: V)');
    expect(source.source).toContain('let frag = in.uv * u.resolution;');
    expect(source.source).not.toContain('@fragment fn fs_planet(@builtin(position)');
    expect(source.source).toContain('@vertex');
    expect(source.source).toContain('@fragment');
    expect(source.source).not.toMatch(/^\s*#include\b/m);
  });

  it('builds native precompile commands from the same shader bundle', () => {
    const source = getPlanetNativeShaderSource();
    expect(buildPlanetNativePrecompileCommands()).toEqual([{
      type: 'precompile_shader',
      shader_id: source.shaderId,
      stage: source.stage,
      entry: source.entry,
      source: source.source,
    }]);
  });

  it('builds a native graph that renders Planet into a source frame', () => {
    const first = buildPlanetNativeComputeGraph({
      sourceId: 'gpu:layer-a:planet',
      params: {
        planet: 'saturn',
        rotationSpeed: 12,
        cloudSpeed: 0.8,
        cameraDistance: 3.2,
      },
      width: 640,
      height: 360,
      time: 1,
      frameDelta: 1 / 60,
      frameIndex: 12,
      reset: true,
    });

    expect(first.passCount).toBe(1);
    expect(first.config.passes).toEqual([]);
    expect(first.config.readbacks).toEqual([]);
    expect(first.config.buffers).toEqual([
      expect.objectContaining({
        kind: 'uniform',
        byte_length: 176,
        initial_b64: expect.any(String),
      }),
    ]);
    expect(first.config.render_passes).toEqual([
      expect.objectContaining({
        name: 'planet-render',
        shader_id: PLANET_NATIVE_SHADER_IDS.render,
        target: 'source_frame',
        source_id: 'gpu:layer-a:planet',
        vertex_entry: 'vs_full',
        fragment_entry: 'fs_planet',
        vertex_count: 3,
        instance_count: 1,
        clear: true,
        blend: 'alpha',
      }),
    ]);

    const second = buildPlanetNativeComputeGraph({
      sourceId: 'gpu:layer-a:planet',
      params: {
        planet: 'saturn',
        rotationSpeed: 12,
        cloudSpeed: 0.8,
      },
      width: 640,
      height: 360,
      time: 1 + 1 / 60,
      frameDelta: 1 / 60,
      frameIndex: 13,
      state: first.state,
    });

    expect(second.state.accumRotation).toBeGreaterThan(first.state.accumRotation);
    expect(second.state.cloudPhase).toBeGreaterThan(first.state.cloudPhase);
    expect(second.config.render_passes[0].source_id).toBe(first.config.render_passes[0].source_id);
  });
});
