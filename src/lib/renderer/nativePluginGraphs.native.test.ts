import { describe, expect, it } from 'vitest';
import {
  HAND_FX_PARTICLE_COUNT,
  buildNativeHandInputUpdate,
  buildNativePluginGraph,
  buildNativePluginPrecompileCommands,
} from './nativePluginGraphs';

const audio = {
  active: true,
  bass: 0.7,
  mid: 0.45,
  treble: 0.3,
  energy: 0.6,
  beatPhase: 0.25,
  beatPulse: 0.9,
  amplitude: 0.5,
};

describe('native plugin graphs', () => {
  it('precompiles every enabled plugin shader module', () => {
    expect(buildNativePluginPrecompileCommands().map((command) => command.shader_id)).toEqual([
      'ghostfx/drift-compute',
      'ghostfx/drift-render',
      'ghostfx/ribbons-compute',
      'ghostfx/ribbons-render',
      'ghostfx/spheres-compute',
      'ghostfx/spheres-render',
      'ghostfx/liquid-splat',
      'ghostfx/liquid-advect-vel',
      'ghostfx/liquid-divergence',
      'ghostfx/liquid-jacobi',
      'ghostfx/liquid-subtract',
      'ghostfx/liquid-advect-dye',
      'ghostfx/liquid-render',
      'ghostfx/liquid-bubbles-sim',
      'ghostfx/liquid-bubbles-render',
      'ghostfx/post',
      'handfx/compute',
      'handfx/render',
      'performer-world/render',
    ]);
  });

  it('builds Performer worlds as a transparent native overlay with the original controls', () => {
    const result = buildNativePluginGraph({
      kind: 'performer-world',
      sourceId: 'plugin:performer-world:A:0',
      params: {
        performerWorldIndex: 7,
        performerWorldSpace: 3,
        performerWorldPointerDown: true,
        performerWorldX: 0.25,
        performerWorldY: 0.75,
        performerWorldParams: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8],
        performerWorldPump: 0.9,
      },
      width: 1920,
      height: 1080,
      time: 2,
      frameDelta: 1 / 60,
      frameIndex: 120,
      audio,
    });
    const config = result.config as any;
    const uniform = config.buffers.find((buffer: any) => buffer.id.endsWith(':uniform'));
    const bytes = Uint8Array.from(atob(uniform.initial_b64), (char) => char.charCodeAt(0));
    const floats = new Float32Array(bytes.buffer);
    const integers = new Uint32Array(bytes.buffer);
    const pass = config.render_passes[0];

    expect(uniform.byte_length).toBe(80);
    expect(integers[4]).toBe(7);
    expect(integers[5]).toBe(3);
    expect(integers[6]).toBe(1);
    expect(floats[8]).toBeCloseTo(0.25);
    expect(floats[9]).toBeCloseTo(0.75);
    expect(floats[12]).toBeCloseTo(0.1);
    expect(floats[17]).toBeCloseTo(0.6);
    expect(floats[18]).toBe(0);
    expect(floats[19]).toBe(0);
    expect(pass.shader_id).toBe('performer-world/render');
    expect(pass.source_id).toBe('plugin:performer-world:A:0');
    expect(pass.blend).toBe('alpha');
  });

  it.each(['drift', 'ribbons'] as const)('builds original GhostFX %s passes in the native graph', (scene) => {
    const result = buildNativePluginGraph({
      kind: 'ghostfx',
      sourceId: 'plugin:layer:ghostfx',
      params: { ghostfxScenePreset: scene },
      width: 1920,
      height: 1080,
      time: 1,
      frameDelta: 1 / 60,
      frameIndex: 60,
      audio,
    });
    const config = result.config as any;
    expect(config.passes[0].shader_id).toBe(`ghostfx/${scene}-compute`);
    expect(config.render_passes.every((pass: any) => pass.target === 'source_frame')).toBe(true);
    expect(config.render_passes.at(-1).source_id).toBe('plugin:layer:ghostfx');
    expect(config.render_passes.slice(-3).map((pass: any) => pass.fragment_entry)).toEqual([
      'fsExtractHBlur',
      'fsVBlur',
      'fsComposite',
    ]);
  });

  it('connects GhostFX opacity, trail intensity, and lighten blend to native rendering', () => {
    const result = buildNativePluginGraph({
      kind: 'ghostfx',
      sourceId: 'plugin:layer:ghostfx',
      params: {
        ghostfxScenePreset: 'ribbons',
        ghostfxBgAlpha: 0.42,
        ghostfxTrailIntensity: 1.7,
        ghostfxRibbonBlend: 'lighten',
      },
      width: 1920,
      height: 1080,
      time: 1,
      frameDelta: 1 / 60,
      frameIndex: 60,
      audio,
    });
    const config = result.config as any;
    const uniform = config.buffers.find((buffer: any) => buffer.id.endsWith(':uniform'));
    const values = new Float32Array(Uint8Array.from(atob(uniform.initial_b64), (char) => char.charCodeAt(0)).buffer);
    expect(values[26]).toBeCloseTo(0.42);
    expect(values[27]).toBeCloseTo(1.7);
    expect(config.render_passes.find((pass: any) => pass.name === 'ghostfx-ribbons').blend).toBe('lighten');
  });

  it('builds GhostFX Liquid as a persistent native buffer graph', () => {
    const result = buildNativePluginGraph({
      kind: 'ghostfx',
      sourceId: 'plugin:layer:ghostfx',
      params: { ghostfxScenePreset: 'liquid' },
      width: 1920,
      height: 1080,
      time: 1,
      frameDelta: 1 / 60,
      frameIndex: 60,
      audio,
    });
    const config = result.config as any;
    // Field state lives in persistent storage buffers — the ONLY graph
    // storage the native core supports. (The original texture-based liquid
    // could never build a pipeline under the template path.)
    // 7 sim fields + the bubble particle pool.
    const fieldBuffers = config.buffers.filter((buffer: any) => buffer.persistent);
    expect(fieldBuffers).toHaveLength(8);
    expect(fieldBuffers.every((buffer: any) => buffer.clear && buffer.kind === 'storage')).toBe(true);
    const uniform = config.buffers.find((buffer: any) => buffer.id.endsWith(':uniform'));
    expect(uniform.byte_length).toBe(128);
    expect(config.textures).toBeUndefined();
    expect(config.passes.filter((pass: any) => pass.shader_id === 'ghostfx/liquid-jacobi')).toHaveLength(30);
    expect(config.passes.some((pass: any) => pass.shader_id === 'ghostfx/liquid-splat')).toBe(true);
    expect(config.passes.flatMap((pass: any) => pass.bindings).every(
      (binding: any) => ['uniform', 'read-only-storage', 'storage'].includes(binding.kind),
    )).toBe(true);
    expect(config.render_passes[0].shader_id).toBe('ghostfx/liquid-render');
    expect(config.render_passes.at(-1).source_id).toBe('plugin:layer:ghostfx');

    const next = buildNativePluginGraph({
      kind: 'ghostfx',
      sourceId: 'plugin:layer:ghostfx',
      params: { ghostfxScenePreset: 'liquid' },
      width: 1920,
      height: 1080,
      time: 1 + 1 / 60,
      frameDelta: 1 / 60,
      frameIndex: 61,
      audio: { ...audio, beatPulse: 0.2 },
      state: result.state,
    });
    // Continuation frames must not clear the persistent field buffers —
    // that would restart the fluid every frame.
    expect(
      (next.config as any).buffers
        .filter((buffer: any) => buffer.persistent)
        .every((buffer: any) => buffer.clear === false),
    ).toBe(true);
  });

  it('reuses the same intermediate frame ids across every GhostFX scene', () => {
    // The core has only 8 source-frame slots. Per-scene intermediate ids leak
    // 3 slots per scene switch until the pool is exhausted, and the next
    // template install then fails and freezes the layer ("spheres does
    // nothing"). Scene switches must reuse one stable set per layer.
    const intermediateIds = (scene: string) => {
      const result = buildNativePluginGraph({
        kind: 'ghostfx',
        sourceId: 'plugin:layer:ghostfx',
        params: { ghostfxScenePreset: scene },
        width: 1920,
        height: 1080,
        time: 1,
        frameDelta: 1 / 60,
        frameIndex: 60,
        audio,
      });
      const passes = (result.config as any).render_passes as any[];
      return new Set(
        passes.map((pass) => String(pass.source_id)).filter((id) => id !== 'plugin:layer:ghostfx'),
      );
    };
    const drift = intermediateIds('drift');
    expect(drift.size).toBe(3);
    for (const scene of ['ribbons', 'liquid', 'spheres']) {
      expect(intermediateIds(scene), scene).toEqual(drift);
    }
  });

  it('uses MediaPipe landmarks as native HandFX input data', () => {
    const result = buildNativePluginGraph({
      kind: 'handfx',
      sourceId: 'plugin:layer:handfx',
      params: { handfxMode: 'skeleton' },
      width: 1920,
      height: 1080,
      time: 1,
      frameDelta: 1 / 60,
      frameIndex: 60,
      audio,
      handFrame: {
        timestamp: 1,
        values: {},
        gestures: { 'gesture.right': '', 'gesture.left': '' },
        confidence: {},
        hands: [{
          handedness: 'Right',
          landmarks: Array.from({ length: 21 }, (_, index) => ({
            x: index / 20,
            y: 1 - index / 20,
            z: 0,
          })),
        }],
      },
    });
    const config = result.config as any;
    expect(config.buffers.find((buffer: any) => buffer.id.endsWith(':landmarks')).byte_length).toBe(42 * 16);
    expect(config.buffers.find((buffer: any) => buffer.id.endsWith(':particles')).byte_length).toBe(
      HAND_FX_PARTICLE_COUNT * 32,
    );
    expect(config.render_passes.some((pass: any) => pass.name === 'handfx-skeleton')).toBe(true);
  });

  it('updates only HandFX input buffers after its persistent graph is installed', () => {
    const update = buildNativeHandInputUpdate({
      sourceId: 'plugin:layer:handfx',
      params: { handfxMode: 'trails' },
      width: 1920,
      height: 1080,
      time: 2,
      frameDelta: 1 / 60,
      frameIndex: 120,
      audio,
      handFrame: {
        timestamp: 2,
        values: {},
        gestures: { 'gesture.right': '', 'gesture.left': '' },
        confidence: {},
        hands: [],
      },
    });

    expect(update.buffers.map((buffer) => buffer.id)).toEqual([
      expect.stringMatching(/:uniform$/),
      expect.stringMatching(/:landmarks$/),
    ]);
    expect(update.buffers.some((buffer) => buffer.id.endsWith(':particles'))).toBe(false);
  });
});
