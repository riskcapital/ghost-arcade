import { describe, expect, it } from 'vitest';
import {
  buildVolumetricSpheresNativeComputeGraph,
  buildVolumetricSpheresNativePrecompileCommands,
  getVolumetricSpheresNativeShaderSources,
  normalizeVolumetricSpheresParams,
  packVolumetricSpheresRenderUniform,
  volumetricSpheresScene,
  volumetricSpheresShininessToRoughness,
  VOLUMETRIC_SPHERES_NATIVE_GRAPH_SHADER_IDS,
  VOLUMETRIC_SPHERES_NATIVE_SHADER_IDS,
} from './webgpuVolumetricSpheresShader';

if (typeof (globalThis as any).btoa !== 'function') {
  (globalThis as any).btoa = (value: string) =>
    (globalThis as any).Buffer.from(value, 'binary').toString('base64');
}

const BASE = {
  sourceId: 'gpu:layer-a:volumetric-balls',
  width: 640,
  height: 360,
  time: 1,
  frameDelta: 1 / 60,
  frameIndex: 12,
};

describe('Volumetric Spheres native shader bundle', () => {
  it('exposes every WGSL module the graph references', () => {
    const sources = getVolumetricSpheresNativeShaderSources();
    const byId = new Map(sources.map((source) => [source.shaderId, source]));

    expect(sources).toHaveLength(5);
    for (const id of Object.values(VOLUMETRIC_SPHERES_NATIVE_SHADER_IDS)) {
      expect(byId.has(id)).toBe(true);
    }
    // A graph that references a shader nobody registered fails the whole
    // route at install ("<id> shader has not been precompiled"), so the
    // declared list and the shipped sources have to be the same set.
    expect([...VOLUMETRIC_SPHERES_NATIVE_GRAPH_SHADER_IDS].sort())
      .toEqual([...byId.keys()].sort());

    for (const source of sources) {
      expect(source.source).toContain(source.entry);
      expect(source.source).not.toMatch(/^\s*#include\b/m);
      // Nothing may survive un-interpolated into the shipped WGSL.
      expect(source.source).not.toMatch(/\$\{/);
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

  it('ships every compute entry point the graph dispatches', () => {
    const byId = new Map(getVolumetricSpheresNativeShaderSources().map((s) => [s.shaderId, s]));
    const graph = buildVolumetricSpheresNativeComputeGraph({ ...BASE, reset: true });
    for (const pass of graph.config.passes) {
      const source = byId.get(pass.shader_id);
      expect(source, `missing module for ${pass.shader_id}`).toBeTruthy();
      expect(source!.source).toContain(`fn ${pass.entry}(`);
    }
    for (const pass of graph.config.render_passes) {
      const source = byId.get(pass.shader_id);
      expect(source).toBeTruthy();
      expect(source!.source).toContain(`fn ${pass.vertex_entry}(`);
      expect(source!.source).toContain(`fn ${pass.fragment_entry}(`);
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

  it('orders the graph sim → grid → links → tiles → shadow → render', () => {
    const graph = buildVolumetricSpheresNativeComputeGraph({
      ...BASE,
      params: { sphereCount: 128, connectMode: 'cylinder', maxLinks: 4 },
      reset: true,
    });
    expect(graph.config.passes.map((pass) => pass.name)).toEqual([
      'volumetric-spheres-sim',
      'volumetric-spheres-clear-grid',
      'volumetric-spheres-bin-grid',
      'volumetric-spheres-links',
      'volumetric-spheres-clear-tiles',
      'volumetric-spheres-bin-nodes',
      'volumetric-spheres-bin-edges',
      'volumetric-spheres-clear-shadow',
      'volumetric-spheres-splat-shadow',
      'volumetric-spheres-prefix-shadow',
    ]);
    expect(graph.passCount).toBe(graph.config.passes.length + 1);
    expect(graph.config.readbacks).toEqual([]);

    // The opacity volume has to be splatted before it is prefix-summed,
    // and prefix-summed before the render reads it — that ordering IS the
    // shadow structure.
    const order = graph.config.passes.map((pass) => pass.name);
    expect(order.indexOf('volumetric-spheres-clear-shadow'))
      .toBeLessThan(order.indexOf('volumetric-spheres-splat-shadow'));
    expect(order.indexOf('volumetric-spheres-splat-shadow'))
      .toBeLessThan(order.indexOf('volumetric-spheres-prefix-shadow'));
    // The link grid must be rebuilt after the sim has moved the nodes.
    expect(order.indexOf('volumetric-spheres-sim'))
      .toBeLessThan(order.indexOf('volumetric-spheres-clear-grid'));
    expect(order.indexOf('volumetric-spheres-bin-grid'))
      .toBeLessThan(order.indexOf('volumetric-spheres-links'));
  });

  it('drops the link passes when connectors are off', () => {
    const graph = buildVolumetricSpheresNativeComputeGraph({
      ...BASE,
      params: { sphereCount: 128, connectMode: 'off' },
      reset: true,
    });
    const names = graph.config.passes.map((pass) => pass.name);
    expect(names).not.toContain('volumetric-spheres-links');
    expect(names).not.toContain('volumetric-spheres-bin-edges');
    // The grid still has to be built — the sim's separation reads it.
    expect(names).toContain('volumetric-spheres-bin-grid');
  });

  it('wires every pass to buffers the graph actually declares', () => {
    const graph = buildVolumetricSpheresNativeComputeGraph({
      ...BASE,
      params: { sphereCount: 128 },
      reset: true,
    });
    const declared = new Map(graph.config.buffers.map((buffer) => [buffer.id, buffer]));
    const allPasses = [...graph.config.passes, ...graph.config.render_passes];
    for (const pass of allPasses) {
      const seen = new Set<number>();
      for (const binding of pass.bindings) {
        expect(seen.has(binding.binding)).toBe(false);
        seen.add(binding.binding);
        const buffer = declared.get(binding.resource);
        expect(buffer, `${pass.name} binds unknown ${binding.resource}`).toBeTruthy();
        if (binding.kind === 'uniform') {
          expect(buffer!.kind).toBe('uniform');
        } else {
          expect(buffer!.kind).toBe('storage');
        }
      }
      // Bindings are declared densely from 0 — a hole makes the layout
      // signature disagree with the WGSL module.
      expect([...seen].sort((a, b) => a - b)).toEqual(
        pass.bindings.map((_, index) => index),
      );
    }
  });

  it('renders one fullscreen pass with the shadow volume bound', () => {
    const graph = buildVolumetricSpheresNativeComputeGraph({
      ...BASE,
      params: { sphereCount: 128 },
      reset: true,
    });
    expect(graph.config.render_passes).toHaveLength(1);
    const render = graph.config.render_passes[0];
    expect(render).toMatchObject({
      name: 'volumetric-spheres-render',
      shader_id: VOLUMETRIC_SPHERES_NATIVE_SHADER_IDS.render,
      target: 'source_frame',
      source_id: BASE.sourceId,
      vertex_count: 3,
      instance_count: 1,
      blend: 'alpha',
      clear: true,
    });
    // The shader paints its own background, so the pass must clear to
    // transparent rather than to a fog-tinted colour.
    expect(render.clear_color).toEqual([0, 0, 0, 0]);
    expect(render.bindings.some((b) => b.resource.endsWith(':shadow-depth'))).toBe(true);
    expect(render.bindings.some((b) => b.resource.endsWith(':edge-count'))).toBe(true);
  });

  it('seeds a 16-float node record once and keeps it across frames', () => {
    const first = buildVolumetricSpheresNativeComputeGraph({
      ...BASE,
      params: { layout: 'orbital', sphereCount: 128, autoRotateY: 6 },
      reset: true,
    });
    expect(first.sphereCount).toBe(128);
    const seeded = first.config.buffers.find((buffer) => buffer.id.endsWith(':spheres'));
    expect(seeded).toMatchObject({
      kind: 'storage',
      byte_length: 128 * 16 * 4,
      persistent: true,
      clear: true,
    });
    expect(seeded?.initial_buffer).toBeInstanceOf(ArrayBuffer);
    // Orientations are Shoemake-uniform, so every seeded quaternion is a
    // unit quaternion — a non-unit one silently skews the primitive.
    const floats = new Float32Array(seeded!.initial_buffer as ArrayBuffer);
    for (let i = 0; i < 128; i++) {
      const o = i * 16 + 12;
      const len = Math.hypot(floats[o], floats[o + 1], floats[o + 2], floats[o + 3]);
      expect(len).toBeCloseTo(1, 4);
    }

    const second = buildVolumetricSpheresNativeComputeGraph({
      ...BASE,
      params: { layout: 'orbital', sphereCount: 128, autoRotateY: 6 },
      time: 1 + 1 / 60,
      frameIndex: 13,
      state: first.state,
    });
    const kept = second.config.buffers.find((buffer) => buffer.id.endsWith(':spheres'));
    expect(second.state.autoRotYPhase).toBeGreaterThan(first.state.autoRotYPhase);
    expect(kept?.clear).toBe(false);
    expect(kept?.initial_buffer).toBeUndefined();
    expect(second.config.render_passes[0].source_id).toBe(first.config.render_passes[0].source_id);
  });

  it('keeps the link grid cell no smaller than the connect distance', () => {
    // This is the invariant that makes the 27-cell neighbour gather
    // complete; break it and links silently disappear at range.
    for (const connectDistance of [0.05, 0.2, 0.4, 0.9, 1.2]) {
      for (const spread of [0.3, 1.2, 2.8]) {
        const params = normalizeVolumetricSpheresParams({ connectDistance, spread });
        const scene = volumetricSpheresScene(params, 256);
        expect(scene.cellSize).toBeGreaterThanOrEqual(connectDistance - 1e-6);
        expect(scene.gridDim.every((d) => d >= 1 && d <= 32)).toBe(true);
        expect(scene.gridCellCount).toBeLessThanOrEqual(32768);
        // The grid must still cover the simulation bounds.
        expect(scene.gridDim[0] * scene.cellSize).toBeGreaterThanOrEqual(-scene.gridMin[0] * 2 - 1e-4);
      }
    }
  });

  it('builds an orthonormal light frame for the opacity volume', () => {
    for (const light of [
      { lightX: -0.62, lightY: 1.05, lightZ: 0.72 },
      { lightX: 0, lightY: 1, lightZ: 0 },
      { lightX: 0, lightY: -1, lightZ: 0 },
      { lightX: 1, lightY: 0, lightZ: 0 },
    ]) {
      const params = normalizeVolumetricSpheresParams(light);
      const scene = volumetricSpheresScene(params, 128);
      const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      const len = (a: number[]) => Math.hypot(a[0], a[1], a[2]);
      expect(len(scene.lightDir)).toBeCloseTo(1, 5);
      expect(len(scene.shU)).toBeCloseTo(1, 5);
      expect(len(scene.shV)).toBeCloseTo(1, 5);
      expect(dot(scene.shU, scene.shV)).toBeCloseTo(0, 5);
      expect(dot(scene.shU, scene.lightDir)).toBeCloseTo(0, 5);
      expect(dot(scene.shV, scene.lightDir)).toBeCloseTo(0, 5);
      // The light sits opposite the direction it shines.
      expect(dot(scene.lightPos, scene.lightDir)).toBeLessThan(0);
    }
  });

  it('migrates legacy shininess to a GGX roughness', () => {
    expect(volumetricSpheresShininessToRoughness(78)).toBeCloseTo(Math.sqrt(2 / 80), 5);
    const migrated = normalizeVolumetricSpheresParams({ shininess: 78 });
    expect(migrated.roughness).toBeCloseTo(Math.sqrt(2 / 80), 5);
    // An explicit roughness always wins over the legacy key.
    expect(normalizeVolumetricSpheresParams({ shininess: 78, roughness: 0.5 }).roughness).toBe(0.5);
    // Every legacy param the old instrument shipped still resolves.
    const legacy = normalizeVolumetricSpheresParams({
      layout: 'cavern', sphereCount: 192, radiusScale: 0.085, spread: 1.08, depth: 1.35,
      motion: 0.72, swirl: 0.58, pull: 0.28, chaos: 0.34, damping: 1.7, opacity: 0.96,
      fogDensity: 0.38, backgroundOpacity: 0.88, fogColor: [8, 10, 20], colorCycle: 0.018,
      saturation: 1.08, brightness: 1.12, ambient: 0.24, diffuse: 1.08, specular: 0.9,
      reflection: 0.22, rim: 0.46, lightX: -0.55, lightY: 0.8, lightZ: 1, lightStrength: 1.1,
      audioReactive: true, bassPulse: 1.15, trebleSparkle: 0.32, fovDeg: 48, cameraZ: 2.75,
    });
    expect(legacy.layout).toBe('cavern');
    expect(legacy.sphereCount).toBe(192);
    expect(legacy.opacity).toBeCloseTo(0.96, 5);
    expect(legacy.lightStrength).toBeCloseTo(1.1, 5);
  });

  it('packs the render uniform at the byte layout the WGSL declares', () => {
    const params = normalizeVolumetricSpheresParams({ sphereCount: 128, marchSteps: 40 });
    const scene = volumetricSpheresScene(params, 128);
    const buf = packVolumetricSpheresRenderUniform(
      params, scene, new Float32Array(16), [0, 0, 3.1], 40, 23, 128, 7, 1.5, 0, 0,
    );
    expect(buf.byteLength).toBe(528);
    const u = new Uint32Array(buf);
    const f = new Float32Array(buf);
    expect(u[92]).toBe(40);
    expect(u[93]).toBe(23);
    expect(u[94]).toBe(48);
    expect(u[95]).toBe(64);
    expect(u[96]).toBe(128);
    expect(u[98]).toBe(40);
    expect(u[100]).toBe(scene.shadowDim);
    expect(u[103]).toBe(7);
    expect(f[75]).toBeCloseTo(scene.volumeRadius, 5);
    expect(f[121]).toBeCloseTo(1.5, 5);
  });

  it('keeps the buffer prefix the sync layer cleans up', () => {
    const graph = buildVolumetricSpheresNativeComputeGraph({ ...BASE, reset: true });
    for (const buffer of graph.config.buffers) {
      expect(buffer.id.startsWith('volumetric-spheres:')).toBe(true);
    }
  });
});
