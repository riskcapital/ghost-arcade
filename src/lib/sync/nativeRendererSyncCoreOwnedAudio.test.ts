/**
 * Audio-driven effects on core-owned graph layers. An instrument layer
 * (planet, particles, smoke, ghostfx, ...) and a VJ crossfade/mix layer carry
 * their own effect chain inside the graph the core owns, so the chain's
 * uniforms went out only when the graph was installed or an effect param
 * changed. Glitch's Audio/Beat triggers and Block Corrupt / Data Bend audio
 * reactivity then held the level they were installed with. The sync now
 * re-sends a pass's uniforms whenever the live audio moves them.
 * (VJ composition FX run on the final composite chain, which is rebuilt with
 * the live audio every frame; the VJ mix/crossfade routes carry no chain.)
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  batches: [] as Array<Array<Record<string, any>>>,
  audio: { level: 0.2, beat: 0 },
}));

vi.mock('../bridge', async (original) => ({
  ...(await original<typeof import('../bridge')>()),
  invoke: vi.fn(async (command: string, args?: any) => {
    if (command === 'native_renderer_submit_batch' || command === 'native_renderer_submit_commands') {
      const commands = command === 'native_renderer_submit_batch' ? args.batch.commands : args.commands;
      h.batches.push(commands);
      return { total: commands.length, applied: commands.length, dropped: 0, unknown_types: [] };
    }
    if (command === 'native_renderer_get_layers_snapshot') return { layers: [] };
    return null;
  }),
}));

vi.mock('../audio/visualAudio', async (original) => {
  const actual = await original<typeof import('../audio/visualAudio')>();
  return {
    ...actual,
    getVisualAudioSnapshot: () => ({ ...actual.getVisualAudioSnapshot(), isActive: true, level: h.audio.level, beat: h.audio.beat }),
  };
});

type SyncModule = typeof import('./nativeRendererSync');
let mod: SyncModule;
let types: typeof import('../types');
let manifestIds: string[];

beforeAll(async () => {
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
    },
  });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { documentElement: { style: { setProperty: () => {} } } },
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      addEventListener: () => {},
      removeEventListener: () => {},
      matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
    },
  });
  (globalThis as any).requestAnimationFrame = () => 1;
  (globalThis as any).cancelAnimationFrame = () => {};
  mod = await import('./nativeRendererSync');
  types = await import('../types');
  const effectPass = await import('../renderer/nativeEffectPass');
  manifestIds = effectPass.NATIVE_EFFECT_PASS_MANIFEST.map((entry) => entry.id);
});

afterEach(() => {
  vi.restoreAllMocks();
  h.batches.length = 0;
  h.audio = { level: 0.2, beat: 0 };
});

function makeSync(extraFeatures: string[] = ['native_vj_mix_graph', 'native_planet_graph']): any {
  const sync = new mod.NativeRendererSync() as any;
  Object.assign(sync, {
    running: true,
    startupReady: true,
    nativeSceneAdopted: true,
    nativeComputeGraphSourceFrames: true,
    nativeWgslStdlibWarmed: true,
  });
  sync.nativeFeatureFlags = Object.fromEntries([
    'native_effect_pass_manifest', 'compute_graph_texture_sampling', 'compute_graph_source_frame_target',
    'native_static_image_decode', 'native_graph_buffer_prune', ...extraFeatures,
  ].map((flag) => [flag, true]));
  sync.nativeCoreMethods = new Set(['clear_runtime_caches']);
  sync.nativeEffectPassDescriptorIds = new Set(manifestIds);
  sync.nativeGraphReadyKinds = new Set(['vj-mix', 'planet']);
  return sync;
}

function imageLayer(id: string, effects: any[] = []): any {
  const layer = types.createLayer(id, id, 'media') as any;
  layer.visible = true;
  layer.source = { id: `src-${id}`, type: 'image', name: `${id}.png`, src: `file:///tmp/media/${id}.png`, width: 1920, height: 1080 };
  layer.effects = effects;
  return layer;
}


const fx = (id: string, type: string, params: Record<string, unknown>) => ({ id, type, enabled: true, opacity: 1, params });
const sent = () => h.batches.flat();
const sentOfType = (type: string) => sent().filter((command) => command.type === type);

function planetLayer(effects: any[]): any {
  return {
    ...types.createLayer('planet-layer', 'Planet', 'gpu'),
    id: 'planet-layer', type: 'gpu', visible: true, opacity: 1, blendMode: 'normal', source: null,
    gpuLayerContent: { shaderId: 'planet', params: {} },
    effects,
  };
}

const fxUpdates = (layerId: string) => sentOfType('update_native_graph_buffer')
  .filter((c) => c.layer_id === layerId && String(c.buffer_id).startsWith('effect-pass:'));
const installs = (layerId: string) => sentOfType('set_native_graph_layer').filter((c) => c.layer_id === layerId);
const floatsOf = (b64: string) => Array.from(new Float32Array(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer));
// Effect params as the shader reads them (code .. params3); time and frame
// slots are rewritten by the core every frame.
const paramSlots = (values: number[]) => [values[4], values[5], values[6], ...values.slice(8, 24)].map((v) => Math.fround(v));

async function audioRun(sync: any, scene: any[], layerId: string) {
  await sync.flush(1920, 1080, scene);
  expect(installs(layerId).length).toBeGreaterThan(0);
  const installed = installs(layerId).length;
  h.batches.length = 0;
  const perStep: number[] = [];
  for (const level of [0.05, 0.6, 0.6, 1.0, 0.3]) {
    h.audio = { level, beat: level > 0.5 ? 1 : 0 };
    await sync.flush(1920, 1080, scene);
    perStep.push(fxUpdates(layerId).length);
    h.batches.length = 0;
  }
  return { perStep, reinstalled: installs(layerId).length > 0 || installed < 1 };
}

describe('audio-driven effects on core-owned graph layers', () => {
  for (const [name, effect] of [
    ['Glitch Audio trigger', fx('g', 'glitch', { glitchIntensity: 0.5, glitchTriggerMode: 1 })],
    ['Glitch Beat trigger', fx('g', 'glitch', { glitchIntensity: 0.5, glitchTriggerMode: 2 })],
    ['Block Corrupt audio', fx('bc', 'blockCorrupt', { bcIntensity: 0.3, bcAudioReact: 1 })],
    ['Data Bend audio', fx('db', 'dataBend', { dbIntensity: 0.3, dbAudioReact: 1 })],
  ] as const) {
    it(`a planet layer's ${name} follows the music`, async () => {
      const sync = makeSync();
      const { perStep } = await audioRun(sync, [planetLayer([effect])], 'planet-layer');
      // Re-sent whenever the level (or beat) moved, not when it held.
      expect(perStep[0]).toBe(1);
      expect(perStep[1]).toBe(1);
      expect(perStep[2]).toBe(0);
      expect(perStep[3]).toBe(1);
    });
  }

  it('sends the values a fresh install would carry, and only the pass that moved', async () => {
    const sync = makeSync();
    const effects = [fx('inv', 'invert', {}), fx('g', 'glitch', { glitchIntensity: 0.5, glitchTriggerMode: 1 })];
    await sync.flush(1920, 1080, [planetLayer(effects)]);
    h.batches.length = 0;
    h.audio = { level: 0.9, beat: 0 };
    await sync.flush(1920, 1080, [planetLayer(effects)]);
    const updates = fxUpdates('planet-layer');
    expect(updates).toHaveLength(1);
    expect(updates[0].buffer_id).toContain(':pass:1:');
    const fresh = makeSync();
    h.batches.length = 0;
    await fresh.flush(1920, 1080, [planetLayer(effects)]);
    const buffer = installs('planet-layer')[0].effect_graph.buffers.find((b: any) => b.id === updates[0].buffer_id);
    expect(buffer).toBeTruthy();
    expect(paramSlots(floatsOf(updates[0].initial_b64))).toEqual(paramSlots(buffer.initial_f32));
  });

  it('a Constant-trigger Glitch is not re-sent while the music plays', async () => {
    const sync = makeSync();
    const { perStep } = await audioRun(sync, [planetLayer([fx('g', 'glitch', { glitchIntensity: 0.5, glitchTriggerMode: 0 })])], 'planet-layer');
    expect(perStep).toEqual([0, 0, 0, 0, 0]);
  });

  it('the VJ mix carrier carries no effect chain of its own (composition FX run on the composite)', () => {
    const sync = makeSync();
    const mix = types.createLayer('__vj-mix__', 'VJ Mix', 'media') as any;
    mix.visible = true;
    mix.source = { id: '__vj-mix-src__', type: 'effect', src: 'plugin://vj-mix', name: 'VJ Mix',
      effectSource: { effectType: 'vj-mix', vjmixRows: [{ layerId: 'a', opacity: 1, blendMode: 'normal' }] } };
    mix.effects = [fx('g', 'glitch', { glitchIntensity: 0.5, glitchTriggerMode: 1 })];
    const route = sync.nativeGraphRouteForLayer(mix);
    expect(route?.kind).toBe('vj-mix');
    expect(route?.effectPasses).toBeUndefined();
  });

  it('audio keys change only for passes the audio reaches', () => {
    const passes = [
      { effect: 'invert', params: {} },
      { effect: 'glitch', amount: 0.5, params: { triggerMode: 0 } },
      { effect: 'glitch', amount: 0.5, params: { triggerMode: 1 } },
      { effect: 'block-corrupt', params: { bcAudioReact: 0 } },
      { effect: 'block-corrupt', params: { bcAudioReact: 1 } },
    ];
    const quiet = mod.nativeEffectPassAudioKeys(passes, { audioLevel: 0.1, audioBeat: 0 });
    const loud = mod.nativeEffectPassAudioKeys(passes, { audioLevel: 0.8, audioBeat: 1 });
    expect(quiet.map((key, i) => key !== loud[i])).toEqual([false, false, true, false, true]);
  });
});
