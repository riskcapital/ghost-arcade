/**
 * The paid add-ons (Audio Lab, Analog Synth) in a build with them and in one
 * without (src/lib/features.ts). Without: not offered, not in the plugin
 * inventory or the param pickers, not drawn, and a saved layer keeps its
 * settings exactly. With: everything as before.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ batches: [] as Array<Array<Record<string, any>>> }));

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

beforeAll(() => {
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
});

afterEach(() => {
  h.batches.length = 0;
  vi.doUnmock('../features');
});

/** A fresh module graph built as a build with (or without) the add-ons. */
async function build(on: boolean) {
  vi.resetModules();
  vi.doMock('../features', () => ({ MUSIC_STUDIO: on, ANALOG_SYNTH: on }));
  return {
    registry: await import('./registry'),
    addons: await import('./addons'),
    inventory: await import('../renderer/nativePluginInventory'),
    discovery: await import('../keyframes/paramDiscovery'),
    overrides: await import('../keyframes/applyParamOverrides'),
    graphs: await import('../renderer/nativePluginGraphs'),
    sync: await import('../sync/nativeRendererSync'),
    types: await import('../types'),
    patch: await import('../videosynth/patch'),
  };
}
type Build = Awaited<ReturnType<typeof build>>;

function synthLayer(b: Build): any {
  const layer = b.types.createLayer('synth-1', 'Analog Synth', 'media') as any;
  layer.visible = true;
  layer.source = {
    id: 'synth-src', type: 'effect', name: 'Analog Synth', src: 'plugin://analog-synth',
    effectSource: { effectType: 'videosynth', ...b.patch.VIDEOSYNTH_DEFAULTS, vsFeedback: 0.42 },
  };
  return layer;
}

function graphSync(b: Build): any {
  const sync = new b.sync.NativeRendererSync() as any;
  Object.assign(sync, {
    running: true,
    startupReady: true,
    nativeSceneAdopted: true,
    nativeComputeGraphSourceFrames: true,
    nativeWgslStdlibWarmed: true,
  });
  sync.nativeFeatureFlags = Object.fromEntries(['compute_graph_texture_sampling', 'compute_graph_source_frame_target', 'native_videosynth_graph'].map((f) => [f, true]));
  sync.nativeCoreMethods = new Set(['clear_runtime_caches']);
  sync.nativeEffectPassDescriptorIds = new Set();
  sync.nativeGraphReadyKinds = new Set(['videosynth']);
  return sync;
}

const sent = () => h.batches.flat();
const synthInstalls = () => sent().filter((c) => c.type === 'set_native_graph_layer' && c.kind === 'videosynth');
const synthShaders = (b: Build) => b.graphs.buildNativePluginPrecompileCommands().filter((c: any) => String(c.shader_id).startsWith('videosynth/'));

describe('a build with the add-ons', () => {
  it('offers both, lists them in the plugin inventory and has no missing add-on', async () => {
    const b = await build(true);
    expect(b.registry.getPlugin('analog-synth')?.effectType).toBe('videosynth');
    expect(b.registry.getPlugin('musicstudio')?.name).toBe('Audio Lab');
    expect(b.inventory.isNativePluginId('analog-synth')).toBe(true);
    expect(b.inventory.isNativePluginId('musicstudio')).toBe(true);
    expect(b.addons.missingAddon('videosynth')).toBeNull();
    expect(b.addons.missingAddon('music-studio')).toBeNull();
    expect(b.inventory.nativePluginUnavailableReason({ effectType: 'videosynth' } as any)).toBeNull();
  });

  it('offers the synth controls to Timeline lines and applies them', async () => {
    const b = await build(true);
    const layer = synthLayer(b);
    const keys = b.discovery.discoverKeyframeableParams(layer).map((p) => p.key);
    expect(keys).toContain('vsynth:vsFeedback');
    const copy = structuredClone(layer);
    b.overrides.applyParamOverrides(copy, { 'vsynth:vsFeedback': 0.9 });
    expect(copy.source.effectSource.vsFeedback).toBe(0.9);
  });

  it('precompiles the synth shader and draws its layer', async () => {
    const b = await build(true);
    expect(synthShaders(b)).toHaveLength(1);
    const sync = graphSync(b);
    const layer = synthLayer(b);
    expect(b.sync.nativeUnsupportedSourceReason(layer, true)).toBeNull();
    await sync.flush(1920, 1080, [layer]);
    expect(synthInstalls()).toHaveLength(1);
  });
});

describe('a build without the add-ons', () => {
  it('offers neither and leaves them out of the plugin inventory', async () => {
    const b = await build(false);
    expect(b.registry.getPlugin('analog-synth')).toBeUndefined();
    expect(b.registry.getPlugin('musicstudio')).toBeUndefined();
    expect(b.registry.getPluginByEffectType('videosynth')).toBeUndefined();
    expect(b.registry.getAllPlugins().some((p) => p.effectType === 'videosynth' || p.effectType === 'music-studio')).toBe(false);
    expect(b.inventory.isNativePluginId('analog-synth')).toBe(false);
    expect(b.inventory.isNativePluginId('musicstudio')).toBe(false);
    // Built-in plugins are still offered.
    expect(b.inventory.isNativePluginId('ghostfx')).toBe(true);
  });

  it('names the missing add-on for each saved layer kind, and nothing for built-in ones', async () => {
    const b = await build(false);
    expect(b.addons.missingAddon('videosynth')).toBe('Analog Synth');
    expect(b.addons.missingAddon('music-studio')).toBe('Audio Lab');
    expect(b.addons.missingAddon('ghostfx')).toBeNull();
    expect(b.addons.missingAddon(undefined)).toBeNull();
  });

  it('offers no synth controls to Timeline lines and leaves a saved line from touching the layer', async () => {
    const b = await build(false);
    const layer = synthLayer(b);
    const params = b.discovery.discoverKeyframeableParams(layer);
    expect(params.some((p) => p.key.startsWith('vsynth:'))).toBe(false);
    // The layer's own controls (opacity…) are still there.
    expect(params.some((p) => p.key === 'layer:opacity')).toBe(true);
    const copy = structuredClone(layer);
    b.overrides.applyParamOverrides(copy, { 'vsynth:vsFeedback': 0.9 });
    expect(copy.source.effectSource).toEqual(layer.source.effectSource);
  });

  it('does not compile the synth shader or draw a saved synth layer, and keeps its settings', async () => {
    const b = await build(false);
    expect(synthShaders(b)).toHaveLength(0);
    const sync = graphSync(b);
    const layer = synthLayer(b);
    const saved = structuredClone(layer);
    expect(b.inventory.nativePluginUnavailableReason(layer.source.effectSource)).toBe('addon:videosynth:not-installed');
    expect(b.sync.nativeUnsupportedSourceReason(layer, false)).toBe('addon:videosynth:not-installed');
    await sync.flush(1920, 1080, [layer]);
    await sync.flush(1920, 1080, [layer]);
    expect(synthInstalls()).toHaveLength(0);
    expect(sent().some((c) => JSON.stringify(c).includes('native-graph://videosynth'))).toBe(false);
    expect(layer).toEqual(saved);
  });
});
