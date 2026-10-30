/**
 * Frame-sync hot path: work the flush must not repeat, and caches it must
 * not let grow. Each case drives NativeRendererSync with a stubbed core and
 * checks what reaches it.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  batches: [] as Array<Array<Record<string, any>>>,
  clears: [] as Array<Record<string, any>>,
  prefetches: [] as Array<Record<string, any>>,
}));

vi.mock('../bridge', async (original) => ({
  ...(await original<typeof import('../bridge')>()),
  invoke: vi.fn(async (command: string, args?: any) => {
    if (command === 'native_renderer_submit_batch' || command === 'native_renderer_submit_commands') {
      const commands = command === 'native_renderer_submit_batch' ? args.batch.commands : args.commands;
      h.batches.push(commands);
      return { total: commands.length, applied: commands.length, dropped: 0, unknown_types: [] };
    }
    if (command === 'native_renderer_clear_runtime_caches') {
      h.clears.push(args.config);
      return null;
    }
    if (command === 'native_renderer_prefetch_media') {
      h.prefetches.push(args);
      return null;
    }
    if (command === 'native_renderer_get_layers_snapshot') return { layers: [] };
    return null;
  }),
}));

type SyncModule = typeof import('./nativeRendererSync');
let mod: SyncModule;
let types: typeof import('../types');
let edge: typeof import('../drawing/edgeEffects');
let parseCubeLut: typeof import('../color/cubeLut').parseCubeLut;
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
  edge = await import('../drawing/edgeEffects');
  ({ parseCubeLut } = await import('../color/cubeLut'));
  manifestIds = (await import('../renderer/nativeEffectPass')).NATIVE_EFFECT_PASS_MANIFEST.map((entry) => entry.id);
});

afterEach(() => {
  vi.restoreAllMocks();
  h.batches.length = 0;
  h.clears.length = 0;
  h.prefetches.length = 0;
});

const VIDEO_FEATURES = [
  'native_media_decode', 'media_prefetch', 'native_video_decode_pump', 'native_video_decode_pump_window',
  'native_video_frame_decode', 'native_video_frame_prefetch', 'native_media_source_playback_state',
];

function makeSync(extraFeatures: string[] = []): any {
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
  return sync;
}

function imageLayer(i: number, effects: any[] = []): any {
  const layer = types.createLayer(`layer-${i}`, `Layer ${i}`, 'media') as any;
  layer.visible = true;
  // Known size, so the aspect lookup does not reach for a DOM Image.
  layer.source = {
    id: `src-${i}`, type: 'image', name: `img${i}.png`, src: `file:///tmp/media/img-${i}.png`, width: 1920, height: 1080,
  };
  const x = (i % 6) / 6;
  const y = Math.floor(i / 6) / 5;
  layer.corners = {
    topLeft: { x, y: y + 0.18 }, topRight: { x: x + 0.15, y: y + 0.18 },
    bottomLeft: { x, y }, bottomRight: { x: x + 0.15, y },
  };
  layer.effects = effects;
  return layer;
}

function twoEffects(i: number) {
  return [
    { id: `fx-a-${i}`, type: 'brightness', enabled: true, opacity: 1, params: { brightness: 1.2 } },
    { id: `fx-b-${i}`, type: 'vignette', enabled: true, opacity: 1, params: { amount: 0.7 } },
  ];
}

const sent = () => h.batches.flat();
const sentOfType = (type: string) => sent().filter((command) => command.type === type);

function fakeClock(start = 1_000_000) {
  const clock = { now: start };
  vi.spyOn(Date, 'now').mockImplementation(() => clock.now);
  return clock;
}

describe('frame scheduling', () => {
  it('lets the per-frame loop carry scene changes instead of a second timer flush', () => {
    const frames: Array<(now: number) => void> = [];
    (globalThis as any).requestAnimationFrame = (callback: (now: number) => void) => frames.push(callback);
    try {
      const sync = makeSync();
      const flush = vi.spyOn(sync, 'flush').mockResolvedValue(undefined);
      const first = [imageLayer(0)];
      const latest = [imageLayer(1)];

      sync.scheduleSync(1920, 1080, first);
      expect(sync.shaderAnimationRaf).not.toBeNull();
      sync.scheduleSync(1920, 1080, latest);
      expect(sync.pendingSyncTimer).toBeNull();

      frames.shift()!(performance.now());
      expect(flush).toHaveBeenCalledTimes(1);
      expect(flush.mock.calls[0][2]).toBe(latest);

      // A loop that stopped ticking (hidden window) leaves it to the timer.
      sync.shaderAnimationTickAt = performance.now() - 1000;
      sync.scheduleSync(1920, 1080, first);
      expect(sync.pendingSyncTimer).not.toBeNull();
      clearTimeout(sync.pendingSyncTimer);
      sync.stopShaderAnimation();
    } finally {
      (globalThis as any).requestAnimationFrame = () => 1;
    }
  });
});

describe('graph routes and effect passes', () => {
  it('looks each layer route up once per flush and still queues every chain', async () => {
    const sync = makeSync();
    const layers = Array.from({ length: 10 }, (_, i) => imageLayer(i, twoEffects(i)));
    await sync.flush(1920, 1080, layers);
    await sync.flush(1920, 1080, layers);
    const lookups = vi.spyOn(sync, 'nativeGraphRouteForLayer');
    h.batches.length = 0;

    await sync.flush(1920, 1080, layers);

    expect(lookups).toHaveBeenCalledTimes(layers.length);
    expect(sentOfType('queue_compute_graph')).toHaveLength(layers.length);
  });

  it('rebuilds an effect pass when a param is changed in place', async () => {
    const sync = makeSync();
    const layer = imageLayer(0, twoEffects(0));
    await sync.flush(1920, 1080, [layer]);
    await sync.flush(1920, 1080, [layer]);

    layer.effects[0].params.brightness = 1.9;
    await sync.flush(1920, 1080, [layer]);

    const descriptor = mod.effectToNativeDescriptor(layer.effects[0])!;
    expect(descriptor).toBe(mod.effectToNativeDescriptor({ ...layer.effects[0], params: { brightness: 1.9 } }));
    expect(sync.lastLayers.get(layer.id).sourceSig).toContain(descriptor);
    expect(mod.nativeEffectPassesForLayer(layer)?.[0].descriptor).toBe(descriptor);
  });
});

describe('shader values', () => {
  const code = '/*{"INPUTS":[{"NAME":"amt","TYPE":"float"}]}*/ void main(){ gl_FragColor = vec4(amt); }';
  const shaderLayer = (amt: number, shaderCode = code) => {
    const layer = types.createLayer('isf', 'ISF', 'media') as any;
    layer.source = { id: 'shader-1', type: 'shader', name: 'S', src: 'shader://s', shaderCode, shaderValues: { amt } };
    return layer;
  };

  it('sends only new uniforms when a value animates, and rebinds when the shader changes', async () => {
    const sync = makeSync();
    await sync.flush(1920, 1080, [shaderLayer(0.1)]);
    expect(sentOfType('bind_isf_shader')).toHaveLength(1);

    h.batches.length = 0;
    await sync.flush(1920, 1080, [shaderLayer(0.5)]);
    const types = sent().map((command) => command.type);
    expect(types).not.toContain('bind_media_source');
    expect(types).not.toContain('bind_isf_shader');
    expect(types).not.toContain('remove_native_graph_layer');
    expect(sentOfType('update_isf_uniforms')).toHaveLength(1);
    expect(sentOfType('update_isf_uniforms')[0].float_inputs).toEqual({ amt: 0.5 });

    h.batches.length = 0;
    await sync.flush(1920, 1080, [shaderLayer(0.5)]);
    expect(sentOfType('update_isf_uniforms')).toHaveLength(0);

    h.batches.length = 0;
    await sync.flush(1920, 1080, [shaderLayer(0.5, `${code}\n`)]);
    expect(sentOfType('bind_isf_shader')).toHaveLength(1);
    expect(sentOfType('update_isf_uniforms')).toHaveLength(1);
  });
});

describe('edge effects', () => {
  const circleLayer = (i: number) => {
    const layer = imageLayer(i);
    layer.layerShape = {
      enabled: true, type: 'circle',
      params: { feather: 0, rotation: 0, scale: 1, radiusX: 1, radiusY: 1, sides: 5, innerRadius: 0.4 },
    };
    layer.edgeEffects = { enabled: true, effects: [types.createDefaultEdgeEffect(), types.createDefaultEdgeEffect()] };
    return layer;
  };

  it('reuses edge data while inputs are unchanged and matches a fresh build after a change', async () => {
    const sync = makeSync();
    const layers = Array.from({ length: 6 }, (_, i) => circleLayer(i));
    await sync.flush(1920, 1080, layers);
    expect(sentOfType('set_layer_edge_effects')).toHaveLength(6);

    h.batches.length = 0;
    await sync.flush(1920, 1080, layers);
    expect(sentOfType('set_layer_edge_effects')).toHaveLength(0);

    const moved = layers.map((layer, i) => (i === 2
      ? { ...layer, corners: { ...layer.corners, topRight: { x: layer.corners.topRight.x + 0.2, y: layer.corners.topRight.y } } }
      : layer));
    h.batches.length = 0;
    await sync.flush(1920, 1080, moved);

    const context = edge.buildEdgeEffectContext(moved, 1920, 1080);
    const updated = sentOfType('set_layer_edge_effects');
    expect(updated.map((command) => command.layer_id)).toContain('layer-2');
    for (const command of updated) {
      const layer = moved.find((candidate) => candidate.id === command.layer_id)!;
      const fresh = mod.nativeLayerEdgeEffectsState(layer, 1920, 1080, context);
      expect(command.edge_effects).toEqual(fresh.packed);
      expect(command.edge_outline).toEqual(fresh.outline);
    }
    for (const layer of moved) {
      expect(sync.lastLayers.get(layer.id).edgeEffectsSig)
        .toBe(mod.nativeLayerEdgeEffectsState(layer, 1920, 1080, context).signature);
    }
  });
});

describe('LUT tables', () => {
  const lut = (k: number) => parseCubeLut(`LUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n${k / 10} 1 1`);
  const lutTableIds = () => sentOfType('queue_compute_graph')
    .flatMap((graph) => (graph.buffers ?? []).filter((buffer: any) => buffer.immutable_lut).map((buffer: any) => String(buffer.id)));
  const prunedLutIds = () => h.clears
    .flatMap((config) => config.native_graph_buffer_prefixes ?? [])
    .filter((id: string) => id.includes(':lut:'));

  it('frees a replaced LUT table once changes settle, and never the one in use', async () => {
    const clock = fakeClock();
    const sync = makeSync();
    const layer = imageLayer(0);
    const flushFor = async (ms: number) => {
      for (let t = 0; t < ms; t += 500) {
        clock.now += 500;
        await sync.flush(1920, 1080, [{ ...layer }]);
      }
    };

    layer.effects = [{ id: 'lut', type: 'cubeLut', enabled: true, opacity: 1, params: { cubeLut: lut(1), lutStrength: 1 } }];
    await flushFor(1000);
    const [firstTable] = lutTableIds();
    expect(firstTable).toMatch(/:lut:\d+:table$/);

    h.batches.length = 0;
    layer.effects = [{ id: 'lut', type: 'cubeLut', enabled: true, opacity: 1, params: { cubeLut: lut(2), lutStrength: 1 } }];
    await flushFor(1000);
    const [secondTable] = lutTableIds();
    expect(secondTable).not.toBe(firstTable);
    // Still inside the settle time: nothing freed yet.
    expect(prunedLutIds()).toEqual([]);

    await flushFor(2000);
    await Promise.resolve();
    expect(prunedLutIds()).toEqual([firstTable]);
  });
});

describe('per-source caches', () => {
  const clipLayer = (i: number) => {
    const layer = types.createLayer('vj-layer-0', 'Row', 'media') as any;
    layer.source = {
      id: `clip-${i}`, type: 'video', name: `c${i}.mp4`,
      src: `file:///clips/clip-${i}.mp4`, isPlaying: true, durationSeconds: 8, videoWidth: 1920, videoHeight: 1080,
    };
    return layer;
  };
  const sizes = (sync: any) => ({
    prefetchedSources: sync.prefetchedSources.size,
    sourcePreviewSeq: sync.sourcePreviewSeq.size,
    sourcePreviewSig: sync.sourcePreviewSig.size,
    nativeSourceAspectCache: sync.nativeSourceAspectCache.size,
    nativeVideoDecodeDimensionCache: sync.nativeVideoDecodeDimensionCache.size,
    sourceKeyLastUsedAt: sync.sourceKeyLastUsedAt.size,
  });

  it('stays bounded while clips cycle, and empties once the scene is cleared', async () => {
    const clock = fakeClock();
    const sync = makeSync(VIDEO_FEATURES);
    for (let i = 0; i < 150; i++) {
      for (let f = 0; f < 3; f++) {
        clock.now += 400;
        await sync.flush(1920, 1080, [clipLayer(i)]);
      }
    }
    for (const [name, size] of Object.entries(sizes(sync))) {
      // 30 s grace, pruned every 5 s, one clip every 1.2 s.
      expect(size, name).toBeLessThanOrEqual(35);
    }
    expect(sync.prefetchedSources.has('clip-149::file:///clips/clip-149.mp4')).toBe(true);

    for (let f = 0; f < 10; f++) {
      clock.now += 5000;
      await sync.flush(1920, 1080, []);
    }
    expect(Object.values(sizes(sync)).every((size) => size === 0)).toBe(true);
  });

  it('keeps a clip that comes straight back warm, and prerolls it again after the grace period', async () => {
    const clock = fakeClock();
    const sync = makeSync(VIDEO_FEATURES);
    const run = async (layers: any[], ms: number) => {
      for (let t = 0; t < ms; t += 500) {
        clock.now += 500;
        await sync.flush(1920, 1080, layers);
      }
    };
    const prerolls = () => h.prefetches.filter((args) => args.source_id === 'clip-7' && args.prefetch_mode === 'preroll').length;

    await run([clipLayer(7)], 1000);
    expect(prerolls()).toBe(1);
    await run([], 10_000);
    await run([clipLayer(7)], 1000);
    expect(prerolls()).toBe(1);
    await run([], 45_000);
    await run([clipLayer(7)], 1000);
    expect(prerolls()).toBe(2);
  });
});

describe('library video arms', () => {
  it('keeps only the newest arm requests for replay, without their video elements', () => {
    for (let i = 0; i < 50; i++) {
      mod.armNativeLibraryVideo({
        id: `tray-${i}`,
        src: `file:///clips/tray-${i}.mp4`,
        videoElement: { duration: 12, videoWidth: 1280, videoHeight: 720 } as unknown as HTMLVideoElement,
      });
    }
    const pending = mod.pendingNativeLibraryVideoArms();
    expect(pending).toHaveLength(16);
    expect(pending[pending.length - 1].id).toBe('tray-49');
    expect(pending.every((item) => !('videoElement' in item))).toBe(true);
    expect(pending[0]).toMatchObject({ durationSeconds: 12, videoWidth: 1280, videoHeight: 720 });
  });
});
