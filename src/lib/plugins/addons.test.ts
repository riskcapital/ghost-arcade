/**
 * The paid add-ons (Audio Lab, Analog Synth) ship in every build and are
 * gated at run time by this computer's licence (addons/addonAccess.ts).
 * Locked: listed with a lock, not in the param pickers, not drawn, and a
 * saved layer keeps its settings exactly. Unlocked: everything as before.
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
});

/** A fresh module graph on a computer where the add-ons are unlocked (or locked). */
async function build(on: boolean) {
  vi.resetModules();
  const access = await import('../addons/addonAccess');
  access.setAddonsStatusForTests({ 'addon.audio-lab': on, 'addon.analog-synth': on });
  return {
    access,
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

/** An Audio Lab engine voice as the studio expands it: a hidden gpu layer drawn by the core. */
function engineVoice(b: Build): any {
  const layer = b.types.createLayer('ev-1', 'Fluid Ink', 'gpu') as any;
  layer.visible = true;
  const content = b.types.createDefaultGPULayerContent();
  content.shaderId = 'fluid-ink';
  content.params = { burstSize: 0.5 } as any;
  return { ...layer, opacity: 0, gpuLayerContent: content, engineVoice: true };
}

function voiceSync(b: Build): any {
  const sync = graphSync(b);
  sync.nativeFeatureFlags.native_fluid_ink_graph = true;
  sync.nativeGraphReadyKinds = new Set(['fluid-ink']);
  return sync;
}

const sent = () => h.batches.flat();
const voiceInstalls = () => sent().filter((c) => c.type === 'set_native_graph_layer' && c.kind === 'fluid-ink');
const synthInstalls = () => sent().filter((c) => c.type === 'set_native_graph_layer' && c.kind === 'videosynth');
const synthShaders = (b: Build) => b.graphs.buildNativePluginPrecompileCommands().filter((c: any) => String(c.shader_id).startsWith('videosynth/'));

describe('add-ons unlocked on this computer', () => {
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
    expect(synthShaders(b).map((c: any) => c.shader_id)).toEqual(['videosynth/clock', 'videosynth/analog-synth']);
    const sync = graphSync(b);
    const layer = synthLayer(b);
    expect(b.sync.nativeUnsupportedSourceReason(layer, true)).toBeNull();
    await sync.flush(1920, 1080, [layer]);
    expect(synthInstalls()).toHaveLength(1);
  });
});

describe('add-ons locked on this computer', () => {
  it('still lists both, marked as add-ons, so their cards can offer a trial', async () => {
    const b = await build(false);
    expect(b.registry.getPlugin('analog-synth')?.addon).toBe('addon.analog-synth');
    expect(b.registry.getPlugin('musicstudio')?.addon).toBe('addon.audio-lab');
    expect(b.registry.getPlugin('ghostfx')?.addon).toBeUndefined();
    expect(b.inventory.isNativePluginId('analog-synth')).toBe(true);
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
    expect(b.inventory.nativePluginUnavailableReason(layer.source.effectSource)).toBe('addon:videosynth:locked');
    expect(b.sync.nativeUnsupportedSourceReason(layer, false)).toBe('addon:videosynth:locked');
    await sync.flush(1920, 1080, [layer]);
    await sync.flush(1920, 1080, [layer]);
    expect(synthInstalls()).toHaveLength(0);
    expect(sent().some((c) => JSON.stringify(c).includes('native-graph://videosynth'))).toBe(false);
    expect(layer).toEqual(saved);
  });
});

describe('Audio Lab engine voices', () => {
  it('draws one when Audio Lab is unlocked', async () => {
    const b = await build(true);
    await voiceSync(b).flush(1920, 1080, [engineVoice(b)]);
    expect(voiceInstalls()).toHaveLength(1);
  });

  it('draws none while it is locked, keeps the layer as it was, and draws it once unlocked', async () => {
    const b = await build(false);
    const sync = voiceSync(b);
    const layer = engineVoice(b);
    const saved = structuredClone(layer);
    await sync.flush(1920, 1080, [layer]);
    await sync.flush(1920, 1080, [layer]);
    expect(voiceInstalls()).toHaveLength(0);
    expect(layer).toEqual(saved);
    b.access.setAddonsStatusForTests({ 'addon.audio-lab': true });
    await sync.flush(1920, 1080, [layer]);
    expect(voiceInstalls()).toHaveLength(1);
    expect(layer).toEqual(saved);
  });
});

describe('access within one run', () => {
  it('draws a saved synth layer once the add-on is unlocked, without touching its settings', async () => {
    const b = await build(false);
    const sync = graphSync(b);
    const layer = synthLayer(b);
    const saved = structuredClone(layer);
    await sync.flush(1920, 1080, [layer]);
    expect(synthInstalls()).toHaveLength(0);
    b.access.setAddonsStatusForTests({ 'addon.analog-synth': true });
    await sync.flush(1920, 1080, [layer]);
    expect(synthInstalls()).toHaveLength(1);
    expect(layer).toEqual(saved);
  });

  it('keeps an add-on usable until quit when a later look says it is locked', async () => {
    const b = await build(false);
    const licensed = { products: { 'addon.audio-lab': { state: { kind: 'licensed' }, usable: true } } };
    b.access.applyAddonsStatus(licensed);
    expect(b.access.addonUsable('addon.audio-lab')).toBe(true);
    const next = b.access.applyAddonsStatus({ products: { 'addon.audio-lab': { state: { kind: 'expired', why: 'trial-ended' }, usable: false } } });
    expect(next.products['addon.audio-lab']).toEqual({ state: { kind: 'expired', why: 'trial-ended' }, usable: true });
    expect(b.access.addonUsable('addon.audio-lab')).toBe(true);
    expect(b.access.addonUsable('addon.analog-synth')).toBe(false);
  });

  it('reads anything odd from the main process as locked', async () => {
    const b = await build(false);
    for (const raw of [null, 'x', { products: { 'addon.audio-lab': { state: { kind: 'owned' }, usable: true } } }]) {
      expect(b.access.normalizeAddonsStatus(raw).products['addon.audio-lab']).toEqual({ state: { kind: 'locked' }, usable: false });
    }
  });
});
