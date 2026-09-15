import { describe, expect, it } from 'vitest';
import {
  buildPixelParticlesNativeComputeGraph,
  buildPixelParticlesNativePrecompileCommands,
  getPixelParticlesNativeShaderSources,
  PIXEL_PARTICLES_GLOBALS_BYTES,
  PIXEL_PARTICLES_NATIVE_SHADER_IDS,
  PIXEL_PARTICLES_RENDER_UNIFORM_BYTES,
  pixelParticlesFocusDistance,
  pixelParticlesLightViewDir,
} from './webgpuPixelParticles';

function words(b64: string | undefined): Float32Array {
  const bytes = Buffer.from(String(b64 ?? ''), 'base64');
  return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

if (typeof (globalThis as any).btoa !== 'function') {
  (globalThis as any).btoa = (value: string) =>
    (globalThis as any).Buffer.from(value, 'binary').toString('base64');
}

describe('Pixel Particles native shader bundle', () => {
  it('exposes the real Pixel Particles compute and render WGSL', () => {
    const sources = getPixelParticlesNativeShaderSources();
    const byId = new Map(sources.map((source) => [source.shaderId, source]));

    expect(sources).toHaveLength(4);
    expect(byId.has(PIXEL_PARTICLES_NATIVE_SHADER_IDS.compute)).toBe(true);
    expect(byId.has(PIXEL_PARTICLES_NATIVE_SHADER_IDS.render)).toBe(true);
    const lit = byId.get(PIXEL_PARTICLES_NATIVE_SHADER_IDS.renderLit)?.source ?? '';
    for (const entry of ['fn vs_lit', 'fn vs_sharp', 'fn vs_blur', 'fn fs_lit', 'fn fs_bokeh', 'frag_depth']) {
      expect(lit).toContain(entry);
    }
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

  it('sizes the uniforms for the grain, focus and motion fields', () => {
    const graph = buildPixelParticlesNativeComputeGraph({ sourceId: 'gpu:pp', params: {}, reset: true });
    expect(graph.config.buffers.find((b) => b.id.endsWith(':globals'))?.byte_length).toBe(PIXEL_PARTICLES_GLOBALS_BYTES);
    expect(graph.config.buffers.find((b) => b.id.endsWith(':render-uniform'))?.byte_length).toBe(PIXEL_PARTICLES_RENDER_UNIFORM_BYTES);
  });

  it('keeps the soft look by default, and marks every particle unread', () => {
    const graph = buildPixelParticlesNativeComputeGraph({ sourceId: 'gpu:pp', params: { particleCount: 2048 }, reset: true });
    expect(graph.config.render_passes).toHaveLength(1);
    expect(graph.config.render_passes[0]).toMatchObject({ shader_id: PIXEL_PARTICLES_NATIVE_SHADER_IDS.render, blend: 'alpha' });
    expect(graph.config.render_passes[0].depth_test).toBeUndefined();
    const g = words(graph.config.buffers.find((b) => b.id.endsWith(':globals'))?.initial_b64);
    expect(g[44]).toBe(0);  // motion off
    expect(g[48]).toBe(0);  // grains off
    const init = new Float32Array(graph.config.buffers.find((b) => b.id.endsWith(':particles'))?.initial_buffer as ArrayBuffer);
    for (let i = 0; i < 2048; i += 257) expect(init[i * 8 + 7]).toBe(-1);
  });

  it('draws lit grains in one depth-writing pass without an aperture', () => {
    const graph = buildPixelParticlesNativeComputeGraph({ sourceId: 'gpu:pp', params: { grainShading: 'lit' }, reset: true });
    expect(graph.config.render_passes).toHaveLength(1);
    expect(graph.config.render_passes[0]).toMatchObject({
      shader_id: PIXEL_PARTICLES_NATIVE_SHADER_IDS.renderLit,
      vertex_entry: 'vs_lit',
      fragment_entry: 'fs_lit',
      blend: 'replace',
      depth_test: true,
      depth_write: true,
      clear: true,
    });
    const g = words(graph.config.buffers.find((b) => b.id.endsWith(':globals'))?.initial_b64);
    expect(g[48]).toBe(1);
    expect(g[49]).toBeCloseTo(0.65);
  });

  it('splits lit grains into sharp then blurred passes with an aperture', () => {
    const graph = buildPixelParticlesNativeComputeGraph({
      sourceId: 'gpu:pp',
      params: { grainShading: 'lit', aperture: 0.8, focusDepth: 0.2 },
      reset: true,
    });
    const [sharp, blur] = graph.config.render_passes;
    expect(sharp).toMatchObject({ vertex_entry: 'vs_sharp', fragment_entry: 'fs_lit', depth_write: true, clear: true });
    expect(sharp.depth_load).toBeUndefined();
    // The blurred pass keeps the sharp pass's depth and colour, blends, and
    // does not write depth, so grains in front still hide it.
    expect(blur).toMatchObject({ vertex_entry: 'vs_blur', fragment_entry: 'fs_bokeh', blend: 'alpha', depth_test: true, depth_write: false, depth_load: true, clear: false });
    const r = words(graph.config.buffers.find((b) => b.id.endsWith(':render-uniform'))?.initial_b64);
    expect(r[33]).toBeCloseTo(0.8);
  });

  it('turns the light with the camera and places focus across the relief', () => {
    const still = pixelParticlesLightViewDir({ lightX: 0, lightY: 0, lightZ: 1, cameraYaw: 0, cameraPitch: 0 });
    expect(still[2]).toBeCloseTo(1);
    // A quarter turn of yaw swings a light that faced the camera to the side.
    const turned = pixelParticlesLightViewDir({ lightX: 0, lightY: 0, lightZ: 1, cameraYaw: 90, cameraPitch: 0 });
    expect(Math.abs(turned[0])).toBeCloseTo(1);
    expect(turned[2]).toBeCloseTo(0);

    const base = { cameraZ: 2, depthCenter: 0.5, knobs: [0.6, 0, 0, 0] as [number, number, number, number] };
    // Relief spans z in [-0.3, 0.3]; the camera sits at z = 2.
    expect(pixelParticlesFocusDistance({ ...base, focusDepth: 0 })).toBeCloseTo(1.7);
    expect(pixelParticlesFocusDistance({ ...base, focusDepth: 1 })).toBeCloseTo(2.3);
  });
});
