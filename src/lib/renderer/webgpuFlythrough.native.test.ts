import { describe, expect, it } from 'vitest';
import {
  buildFlythroughNativeComputeGraph,
  buildFlythroughNativePrecompileCommands,
  FLYTHROUGH_CURL_BYTES,
  FLYTHROUGH_CURL_GRID_N,
  FLYTHROUGH_CURL_PERIOD,
  FLYTHROUGH_NATIVE_SHADER_IDS,
  getFlythroughNativeShaderSources,
} from './webgpuFlythrough';

function uniformWords(b64: string | undefined): { f: Float32Array; u: Uint32Array } {
  const bytes = Buffer.from(String(b64 ?? ''), 'base64');
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return { f: new Float32Array(copy), u: new Uint32Array(copy) };
}

if (typeof (globalThis as any).btoa !== 'function') {
  (globalThis as any).btoa = (value: string) =>
    (globalThis as any).Buffer.from(value, 'binary').toString('base64');
}

describe('Flythrough native shader bundle', () => {
  it('exposes the real Flythrough compute and render WGSL', () => {
    const sources = getFlythroughNativeShaderSources();
    const byId = new Map(sources.map((source) => [source.shaderId, source]));

    expect(sources).toHaveLength(5);
    expect(byId.has(FLYTHROUGH_NATIVE_SHADER_IDS.curlBake)).toBe(true);
    expect(byId.has(FLYTHROUGH_NATIVE_SHADER_IDS.compute)).toBe(true);
    expect(byId.has(FLYTHROUGH_NATIVE_SHADER_IDS.render)).toBe(true);
    expect(byId.get(FLYTHROUGH_NATIVE_SHADER_IDS.curlBake)?.source).toContain('fn cs_bake');
    // The per-particle curl is gone: the compute pass reads the baked field.
    expect(byId.get(FLYTHROUGH_NATIVE_SHADER_IDS.compute)?.source).toContain('fn sampleCurl');
    expect(byId.get(FLYTHROUGH_NATIVE_SHADER_IDS.compute)?.source).not.toContain('fn noise3');

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
    // A reset frame bakes the curl field first, then advances the particles.
    expect(first.config.passes).toHaveLength(2);
    const curlGroups = Math.ceil(FLYTHROUGH_CURL_GRID_N / 4);
    expect(first.config.passes[0]).toMatchObject({
      shader_id: FLYTHROUGH_NATIVE_SHADER_IDS.curlBake,
      entry: 'cs_bake',
      dispatch: [curlGroups, curlGroups, curlGroups],
    });
    const curlField = first.config.buffers.find((buffer) => buffer.id.endsWith(':curl-field'));
    expect(curlField).toMatchObject({ kind: 'storage', byte_length: FLYTHROUGH_CURL_BYTES, persistent: true, clear: true });
    const bakeUniform = uniformWords(first.config.buffers.find((buffer) => buffer.id.endsWith(':curl-bake-uniform'))?.initial_b64);
    expect(Array.from(bakeUniform.u.slice(0, 2))).toEqual([FLYTHROUGH_CURL_GRID_N, FLYTHROUGH_CURL_PERIOD]);

    expect(first.config.passes[1]).toMatchObject({
      shader_id: FLYTHROUGH_NATIVE_SHADER_IDS.compute,
      entry: 'cs_main',
      dispatch: [64, 1, 1],
    });
    expect(first.config.passes[1].bindings).toContainEqual(
      expect.objectContaining({ binding: 2, kind: 'source-frame-texture', source_id: 'media:input-source' }),
    );
    expect(first.config.passes[1].bindings).toContainEqual(
      expect.objectContaining({ binding: 3, kind: 'source-frame-sampler' }),
    );
    expect(first.config.passes[1].bindings).toContainEqual(
      expect.objectContaining({ binding: 4, resource: curlField?.id, kind: 'read-only-storage' }),
    );
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
    // No re-bake once the field exists: one compute pass, and the field is kept.
    expect(second.config.passes.map((pass) => pass.shader_id)).toEqual([FLYTHROUGH_NATIVE_SHADER_IDS.compute]);
    expect(second.config.buffers.find((buffer) => buffer.id.endsWith(':curl-field'))?.clear).toBe(false);
  });

  it('keys the curl field on the source, so a Count change keeps it', () => {
    const small = buildFlythroughNativeComputeGraph({ sourceId: 'gpu:fly', params: { particleCount: 4096 }, reset: true });
    const large = buildFlythroughNativeComputeGraph({ sourceId: 'gpu:fly', params: { particleCount: 8192 }, reset: true });
    const field = (graph: typeof small) => graph.config.buffers.find((buffer) => buffer.id.endsWith(':curl-field'))?.id;
    const particles = (graph: typeof small) => graph.config.buffers.find((buffer) => buffer.id.endsWith(':particles'))?.id;
    expect(field(small)).toBe(field(large));
    expect(particles(small)).not.toBe(particles(large));
  });

  it('writes wander, motion and curl grid into the compute uniform', () => {
    const off = buildFlythroughNativeComputeGraph({ sourceId: 'gpu:fly', params: {}, reset: true });
    const offU = uniformWords(off.config.buffers.find((buffer) => buffer.id.endsWith(':compute-uniform'))?.initial_b64);
    expect(offU.f[11]).toBe(0);  // wander radius: unbounded unless Limit Wander is on
    expect(offU.f[12]).toBe(0);  // motion reactivity off by default
    expect(offU.f[13]).toBeCloseTo(3);
    expect(offU.u[14]).toBe(FLYTHROUGH_CURL_GRID_N);
    expect(offU.f[15]).toBe(FLYTHROUGH_CURL_PERIOD);

    // A radius without Limit Wander does nothing; the toggle is what arms it.
    const radiusOnly = buildFlythroughNativeComputeGraph({ sourceId: 'gpu:fly', params: { wanderRadius: 0.4 }, reset: true });
    expect(uniformWords(radiusOnly.config.buffers.find((b) => b.id.endsWith(':compute-uniform'))?.initial_b64).f[11]).toBe(0);

    const on = buildFlythroughNativeComputeGraph({
      sourceId: 'gpu:fly',
      params: { limitWander: true, wanderRadius: 0.4, motionReactive: 1.25, motionDecay: 6 },
      reset: true,
    });
    const onU = uniformWords(on.config.buffers.find((buffer) => buffer.id.endsWith(':compute-uniform'))?.initial_b64);
    expect(onU.f[11]).toBeCloseTo(0.4);
    expect(onU.f[12]).toBeCloseTo(1.25);
    expect(onU.f[13]).toBeCloseTo(6);
    const renderU = uniformWords(on.config.buffers.find((buffer) => buffer.id.endsWith(':render-uniform'))?.initial_b64);
    expect(renderU.f[36]).toBeCloseTo(1.25);
  });

  it('marks every particle as not having read its pixel yet', () => {
    const graph = buildFlythroughNativeComputeGraph({ sourceId: 'gpu:fly', params: { particleCount: 2048 }, reset: true });
    const init = graph.config.buffers.find((buffer) => buffer.id.endsWith(':particles'))?.initial_buffer as ArrayBuffer;
    const words = new Float32Array(init);
    for (let i = 0; i < 2048; i += 311) expect(words[i * 12 + 10]).toBe(-1);
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
    const compute = graph.config.passes.find((pass) => pass.shader_id === FLYTHROUGH_NATIVE_SHADER_IDS.compute);
    expect(compute?.bindings).toContainEqual(
      expect.objectContaining({ binding: 2, kind: 'source-frame-texture', allow_missing: true }),
    );
  });
});
