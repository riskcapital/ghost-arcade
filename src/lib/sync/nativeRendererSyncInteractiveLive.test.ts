/**
 * An Interactive layer with a 3D world, with the pointer moving and the
 * Orbit view turning: the frame sync sends the few value buffers that live
 * input changes, and does not rebuild the layer's graph on the CPU for it.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ batches: [] as Array<Array<Record<string, any>>>, log: [] as string[] }));

vi.mock('../show/showActions', async (original) => ({
  ...(await original<typeof import('../show/showActions')>()),
  fireShowAction: vi.fn((action: { kind: string }) => { h.log.push(`show:${action.kind}`); }),
}));

vi.mock('../bridge', async (original) => ({
  ...(await original<typeof import('../bridge')>()),
  invoke: vi.fn(async (command: string, args?: any) => {
    if (command === 'native_renderer_submit_batch' || command === 'native_renderer_submit_commands') {
      const commands = command === 'native_renderer_submit_batch' ? args.batch.commands : args.commands;
      h.batches.push(commands);
      h.log.push('batch');
      return { total: commands.length, applied: commands.length, dropped: 0, unknown_types: [] };
    }
    if (command === 'native_renderer_get_layers_snapshot') return { layers: [] };
    return null;
  }),
}));

type SyncModule = typeof import('./nativeRendererSync');
let mod: SyncModule;
let types: typeof import('../types');
let live: typeof import('../interactive/interactiveLive');
let studio: typeof import('../mobile/studio/interactive');
let fx: typeof import('../mobile/studio/interactiveEffects');
let worldModel: typeof import('../scene3d/worldModel');

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
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { documentElement: { style: { setProperty: () => {} } } } });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { addEventListener: () => {}, removeEventListener: () => {}, matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }) },
  });
  (globalThis as any).requestAnimationFrame = () => 1;
  (globalThis as any).cancelAnimationFrame = () => {};
  mod = await import('./nativeRendererSync');
  types = await import('../types');
  live = await import('../interactive/interactiveLive');
  studio = await import('../mobile/studio/interactive');
  fx = await import('../mobile/studio/interactiveEffects');
  worldModel = await import('../scene3d/worldModel');
});

afterEach(() => {
  h.batches.length = 0;
  h.log.length = 0;
  delete (globalThis as any).__gaNativeIpcProbe;
});

function makeSync(): any {
  const sync = new mod.NativeRendererSync() as any;
  Object.assign(sync, { running: true, startupReady: true, nativeSceneAdopted: true, nativeComputeGraphSourceFrames: true, nativeWgslStdlibWarmed: true });
  sync.nativeFeatureFlags = Object.fromEntries([
    'native_effect_pass_manifest', 'compute_graph_texture_sampling', 'compute_graph_source_frame_target',
    'native_graph_buffer_prune', 'native_performer_world_graph', 'native_interactive_value_updates',
  ].map((flag) => [flag, true]));
  sync.nativeCoreMethods = new Set(['clear_runtime_caches']);
  sync.nativeEffectPassDescriptorIds = new Set();
  sync.nativeGraphReadyKinds = new Set(['performer-world']);
  return sync;
}

function worldLayer(): any {
  const block = { id: 'b', name: 'Block', behavior: 'solid' as const, points: [{ x: 0.3, y: 0.3 }, { x: 0.6, y: 0.3 }, { x: 0.6, y: 0.7 }, { x: 0.3, y: 0.7 }], height: 0.4 };
  const scene = {
    ...studio.defaultInteractive(),
    surfaces: [block],
    effects: [fx.makeEffect('architecture'), fx.makeEffect('fire'), fx.makeEffect('balls3d'), fx.makeEffect('drips'), fx.makeEffect('flames')],
    world: { ...worldModel.defaultReliefWorld(), flat: 'projected' as const },
  };
  const layer = types.createLayer('world-layer', 'World', 'media') as any;
  layer.visible = true;
  layer.source = { id: 'world-src', type: 'effect', src: 'plugin://performer-world', name: 'Interactive Studio', effectSource: { effectType: 'performer-world', interactiveScene: scene } };
  return layer;
}

const sent = () => h.batches.flat();
const ofType = (type: string) => sent().filter((c) => c.type === type && c.layer_id === 'world-layer');

async function moveFrames(sync: any, layers: any[], frames: number) {
  for (let i = 0; i < frames; i++) {
    const t = i / frames;
    live.setLivePointer('world-layer', [{ id: 'mouse', point: { x: 0.2 + 0.6 * t, y: 0.5 + 0.2 * Math.sin(t * 6) }, strength: 1, mode: 'push' } as any]);
    live.setLiveWorldView('world-layer', { yaw: 30 * Math.sin(t * 3), pitch: 10 });
    await sync.flush(1920, 1080, layers);
  }
}

describe('Interactive 3D world: live input without a graph rebuild', () => {
  it('installs the graph once and then sends only the live value buffers while the pointer moves', async () => {
    const sync = makeSync();
    const layers = [worldLayer()];
    await sync.flush(1920, 1080, layers);
    await sync.flush(1920, 1080, layers);
    expect(ofType('set_native_graph_layer').length).toBe(1);
    h.batches.length = 0;
    (globalThis as any).__gaNativeIpcProbe = { types: {} };
    await moveFrames(sync, layers, 30);
    const probe = (globalThis as any).__gaNativeIpcProbe;
    expect(ofType('set_native_graph_layer')).toEqual([]);
    // No CPU rebuild of the world for live input.
    expect(probe.graphBuilds ?? 0).toBe(0);
    const updated = new Set(ofType('update_native_graph_buffer').map((c) => String(c.buffer_id).split(':').pop()));
    expect([...updated].sort()).toEqual(expect.arrayContaining(['ball-input', 'settings', 'touches', 'uniform']));
    // Nothing that live input does not move.
    for (const name of updated) expect(['ball-input', 'settings', 'touches', 'uniform', 'fire-lights']).toContain(name);
  });

  it('measures the sync per frame with the pointer moving', async () => {
    const sync = makeSync();
    const layers = [worldLayer()];
    await sync.flush(1920, 1080, layers);
    await moveFrames(sync, layers, 20);
    const frames = 120;
    const started = performance.now();
    await moveFrames(sync, layers, frames);
    const ms = (performance.now() - started) / frames;
    process.stderr.write(`[interactive-live] sync with live input: ${ms.toFixed(3)} ms per frame\n`);
    expect(ms).toBeGreaterThan(0);
  });
});

describe('Interactive zones: actions run after the frame is sent', () => {
  function zoneLayer(): any {
    const zone = {
      id: 'z', name: 'Zone', behavior: 'trigger' as const,
      points: [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.9, y: 0.9 }, { x: 0.1, y: 0.9 }],
      trigger: { actions: [{ kind: 'show' as const, action: { kind: 'preset' as const, compositionId: 'c1' } }], rearm: 1 },
    };
    const layer = types.createLayer('zone-layer', 'Zones', 'media') as any;
    layer.visible = true;
    layer.source = {
      id: 'zone-src', type: 'effect', src: 'plugin://performer-world', name: 'Interactive Studio',
      effectSource: { effectType: 'performer-world', interactiveScene: { ...studio.defaultInteractive(), surfaces: [zone], effects: [fx.makeEffect('architecture')] } },
    };
    return layer;
  }

  it('fires a touched zone once the frame it was found in is sent, not while it is built', async () => {
    const sync = makeSync();
    const layers = [zoneLayer()];
    await sync.flush(1920, 1080, layers);
    h.log.length = 0;
    live.setLivePointer('zone-layer', [{ id: 'mouse', point: { x: 0.5, y: 0.5 }, strength: 1, mode: 'push' } as any]);
    await sync.flush(1920, 1080, layers);
    expect(h.log).toContain('show:preset');
    // Every batch of that frame went out before the action ran.
    expect(h.log.lastIndexOf('batch')).toBeLessThan(h.log.indexOf('show:preset'));
    expect(sync.queuedZoneActions).toEqual([]);
  });

  it('fires at once outside a frame, and keeps at most the newest while frames fail', () => {
    const sync = makeSync();
    const fired = [{ surfaceId: 'z', actions: [{ kind: 'show', action: { kind: 'preset', compositionId: 'c1' } }] }];
    sync.fireZonesAfterFrame('zone-layer', fired);
    expect(h.log).toEqual(['show:preset']);
    sync.flushInFlight = true;
    for (let i = 0; i < 70; i++) sync.fireZonesAfterFrame(`layer-${i}`, fired);
    expect(h.log).toEqual(['show:preset']);
    expect(sync.queuedZoneActions).toHaveLength(64);
    expect(sync.queuedZoneActions[0].layerId).toBe('layer-6');
    sync.runQueuedZoneActions();
    expect(h.log).toHaveLength(65);
    expect(sync.queuedZoneActions).toEqual([]);
  });
});
