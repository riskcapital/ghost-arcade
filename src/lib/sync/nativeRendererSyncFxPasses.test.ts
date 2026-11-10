/**
 * Effect passes that cost a frame for nothing: a pass whose output is its
 * input (mixed in at 0, a Glitch at no intensity) is left out of a per-frame
 * chain, and a VJ group's effects are rebuilt and re-sent only when their
 * uniforms change (a Glitch on the Constant trigger does not take the live
 * audio, so it does not change with the music).
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

function makeSync(extraFeatures: string[] = ['native_vj_mix_graph']): any {
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
  sync.nativeGraphReadyKinds = new Set(['vj-mix']);
  return sync;
}

function imageLayer(id: string, effects: any[] = []): any {
  const layer = types.createLayer(id, id, 'media') as any;
  layer.visible = true;
  layer.source = { id: `src-${id}`, type: 'image', name: `${id}.png`, src: `file:///tmp/media/${id}.png`, width: 1920, height: 1080 };
  layer.effects = effects;
  return layer;
}

const glitch = (params: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  ({ id: `glitch-${JSON.stringify(params)}`, type: 'glitch', enabled: true, opacity: 1, params, ...extra });
const invert = { id: 'invert', type: 'invert', enabled: true, opacity: 1, params: {} };
const sent = () => h.batches.flat();
const sentOfType = (type: string) => sent().filter((command) => command.type === type);

describe('identity passes in a per-frame chain', () => {
  it('knows which passes hand their input straight back', () => {
    const passes = (effects: any[]) => mod.nativeEffectPassesForLayer(imageLayer('x', effects))!;
    expect(mod.nativeEffectPassIsIdentity(passes([glitch({ glitchIntensity: 0 })])[0])).toBe(true);
    expect(mod.nativeEffectPassIsIdentity(passes([glitch({ glitchIntensity: 0, glitchTriggerMode: 1 })])[0])).toBe(true);
    expect(mod.nativeEffectPassIsIdentity(passes([glitch({ glitchIntensity: 0.01 })])[0])).toBe(false);
    expect(mod.nativeEffectPassIsIdentity(passes([{ ...invert, opacity: 0 }])[0])).toBe(true);
    expect(mod.nativeEffectPassIsIdentity(passes([invert])[0])).toBe(false);
  });

  it('leaves a zero-intensity Glitch out of the chain, but always keeps one pass', async () => {
    const renderPasses = async (effects: any[]) => {
      const sync = makeSync();
      const layer = imageLayer('fx', effects);
      await sync.flush(1920, 1080, [layer]);
      h.batches.length = 0;
      await sync.flush(1920, 1080, [layer]);
      const queued = sentOfType('queue_compute_graph');
      expect(queued).toHaveLength(1);
      return queued[0].render_passes.map((pass: any) => pass.name);
    };
    expect(await renderPasses([glitch({ glitchIntensity: 0 }), invert])).toEqual(['effect-pass-invert']);
    expect(await renderPasses([invert, { ...invert, id: 'invert-2', opacity: 0 }])).toEqual(['effect-pass-invert']);
    expect(await renderPasses([glitch({ glitchIntensity: 0.5 }), invert])).toEqual(['effect-pass-glitch-1', 'effect-pass-invert-2']);
    expect(await renderPasses([glitch({ glitchIntensity: 0 })])).toEqual(['effect-pass-glitch']);
  });
});

describe('VJ group effects', () => {
  function mixScene(groupEffects: any[]) {
    const rows = [imageLayer('vj-layer-0'), imageLayer('vj-layer-1')];
    const mix = types.createLayer('__vj-mix__', 'VJ Mix', 'media') as any;
    mix.visible = true;
    mix.source = {
      id: '__vj-mix-src__', type: 'effect', src: 'plugin://vj-mix', name: 'VJ Mix',
      effectSource: {
        effectType: 'vj-mix',
        vjmixRows: [{ layerId: 'vj-layer-1', opacity: 1, blendMode: 'normal', groupId: 'g' }, { layerId: 'vj-layer-0', opacity: 1, blendMode: 'normal', groupId: 'g' }],
        vjmixGroups: [{ id: 'g', name: 'G', first: 0, last: 1, opacity: 1, blendMode: 'normal', effects: groupEffects }],
      },
    };
    mix.effects = [];
    return [...rows.map((row) => ({ ...row, opacity: 0 })), mix];
  }
  const groupUpdates = () => sentOfType('update_native_graph_buffer').filter((c) => String(c.buffer_id).startsWith('effect-pass:'));
  const installs = () => sentOfType('set_native_graph_layer').filter((c) => c.layer_id === '__vj-mix__');

  it('a Constant-trigger Glitch is installed once and not re-sent while the music plays', async () => {
    const sync = makeSync();
    const scene = mixScene([glitch({ glitchIntensity: 0.5, glitchTriggerMode: 0 })]);
    await sync.flush(1920, 1080, scene);
    expect(installs()).toHaveLength(1);
    const build = vi.spyOn(await import('../renderer/vjGroupNative'), 'buildVJGroupedMixGraph');
    for (let i = 0; i < 10; i++) {
      h.audio = { level: 0.1 + i * 0.07, beat: i % 2 };
      await sync.flush(1920, 1080, scene);
    }
    expect(installs()).toHaveLength(1);
    expect(groupUpdates()).toHaveLength(0);
    expect(build).not.toHaveBeenCalled();
  });

  it('an Audio-trigger Glitch is refreshed when the level moves, one buffer at a time, and not when it holds', async () => {
    const sync = makeSync();
    const scene = mixScene([glitch({ glitchIntensity: 0.5, glitchTriggerMode: 1 }), { ...invert, id: 'inv-g' }]);
    await sync.flush(1920, 1080, scene);
    h.batches.length = 0;
    h.audio = { level: 0.6, beat: 0 };
    await sync.flush(1920, 1080, scene);
    expect(groupUpdates()).toHaveLength(1);
    expect(groupUpdates()[0].buffer_id).toContain(':pass:0:');
    h.batches.length = 0;
    await sync.flush(1920, 1080, scene);
    expect(groupUpdates()).toHaveLength(0);
    // The values that went out are the ones a fresh install would carry.
    h.audio = { level: 0.9, beat: 0 };
    await sync.flush(1920, 1080, scene);
    const update = groupUpdates()[0];
    const fresh = makeSync();
    h.batches.length = 0;
    await fresh.flush(1920, 1080, scene);
    const installed = installs()[0];
    const buffer = installed.effect_graph.buffers.find((b: any) => b.id === update.buffer_id);
    expect(buffer).toBeTruthy();
    const floats = new Float32Array(Uint8Array.from(atob(update.initial_b64), (c) => c.charCodeAt(0)).buffer);
    expect(Array.from(floats).slice(0, buffer.initial_f32.length)).toEqual(buffer.initial_f32.map((v: number) => Math.fround(v)));
  });

  it('a group effect change still reinstalls the graph', async () => {
    const sync = makeSync();
    await sync.flush(1920, 1080, mixScene([glitch({ glitchIntensity: 0.5 })]));
    await sync.flush(1920, 1080, mixScene([glitch({ glitchIntensity: 0.8 })]));
    expect(installs()).toHaveLength(2);
  });

  it('reads the audio only for the Glitch triggers that use it', () => {
    const reads = (triggerMode: unknown) => mod.nativeEffectPassReadsAudio({ effect: 'glitch', params: { triggerMode } });
    expect([0, 1, 2, 3].map(reads)).toEqual([false, true, true, false]);
    expect(reads(undefined)).toBe(false);
    expect(reads(2.5)).toBe(true);
    expect(mod.nativeEffectPassReadsAudio({ effect: 'block-corrupt', params: {} })).toBe(true);
  });
});
