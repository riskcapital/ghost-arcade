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

describe('Interactive scene: Auto on an effect param without a graph rebuild', () => {
  /** What Auto hands the frame sync for this layer each frame (liveParams.ts). */
  async function autoFrames(sync: any, layers: any[], frames: number, onFrame?: () => void) {
    const liveParams = await import('../audio/liveParams');
    const scene = layers[0].source.effectSource.interactiveScene;
    const fire = scene.effects.find((e: any) => e.kind === 'fire');
    const balls = scene.effects.find((e: any) => e.kind === 'balls3d');
    const writer = new liveParams.LiveFrameWriter('auto');
    for (let i = 0; i < frames; i++) {
      const t = i / frames;
      writer.layer('world-layer', 'world-src', `interactive:${fire.id}:speed`, 0.2 + 0.6 * t);
      writer.layer('world-layer', 'world-src', `interactive:${balls.id}:glow`, 0.1 + 0.8 * t);
      writer.commit();
      onFrame?.();
      await sync.flush(1920, 1080, layers);
    }
    return { fire, balls, clear: () => liveParams.clearLiveValues('auto') };
  }

  it('installs once and then sends only the buffers the moving params fill', async () => {
    const sync = makeSync();
    const layers = [worldLayer()];
    await sync.flush(1920, 1080, layers);
    await sync.flush(1920, 1080, layers);
    expect(ofType('set_native_graph_layer').length).toBe(1);
    h.batches.length = 0;
    (globalThis as any).__gaNativeIpcProbe = { types: {} };
    const { fire, clear } = await autoFrames(sync, layers, 30);
    const probe = (globalThis as any).__gaNativeIpcProbe;
    expect(ofType('set_native_graph_layer')).toEqual([]);
    expect(probe.graphBuilds ?? 0).toBe(0);
    const updated = ofType('update_native_graph_buffer');
    const names = new Set(updated.map((c) => String(c.buffer_id).replace(/^.*:interactive:|^.*:/, '')));
    // The fire's settings (its own effect's part) and the balls' kinds.
    expect(updated.some((c) => String(c.buffer_id).includes(`${fire.id}:interactive:`) && String(c.buffer_id).endsWith('matter'))).toBe(true);
    expect(names.has('ball-kinds')).toBe(true);
    // The stored scene is untouched.
    expect(layers[0].source.effectSource.interactiveScene.effects.find((e: any) => e.id === fire.id).params.speed).toBe(fire.params.speed);

    // What the core holds now is what a full build of the moved scene gives.
    const { buildInteractiveGraph } = await import('../renderer/nativeInteractiveGraph');
    const lastSent = new Map<string, string>();
    for (const c of ofType('update_native_graph_buffer')) lastSent.set(c.buffer_id, c.initial_b64);
    const scene = layers[0].source.effectSource.interactiveScene;
    const moved = fx.applyInteractiveOverrides(scene, { [`interactive:${fire.id}:speed`]: 0.2 + 0.6 * (29 / 30) });
    const full = buildInteractiveGraph({ kind: 'performer-world', sourceId: 'plugin:world-layer:performer-world', params: { interactiveScene: moved }, width: 1920, height: 1080, time: 0, frameDelta: 1 / 60, frameIndex: 1, audio: { active: false, bass: 0, mid: 0, treble: 0, energy: 0, beatPhase: 0, beatPulse: 0, amplitude: 0 }, state: null, reset: false } as any);
    const matterId = [...lastSent.keys()].find((id) => id.includes(`${fire.id}:interactive:`) && id.endsWith('matter'))!;
    const fullMatter = full.interactive.values.find((v) => v.id === matterId)!;
    // Same settings, apart from the slots the core writes itself every frame.
    expect(sync.nativeGraphRoutes.values().next().value.interactiveValueKeys.get(matterId)).toBe(fullMatter.key);

    // Auto stops: the stored values go back, still without a rebuild.
    h.batches.length = 0;
    clear();
    await sync.flush(1920, 1080, layers);
    expect(ofType('set_native_graph_layer')).toEqual([]);
    expect(ofType('update_native_graph_buffer').length).toBeGreaterThan(0);
    const base = buildInteractiveGraph({ kind: 'performer-world', sourceId: 'plugin:world-layer:performer-world', params: { interactiveScene: scene }, width: 1920, height: 1080, time: 0, frameDelta: 1 / 60, frameIndex: 1, audio: { active: false, bass: 0, mid: 0, treble: 0, energy: 0, beatPhase: 0, beatPulse: 0, amplitude: 0 }, state: null, reset: false } as any);
    expect(sync.nativeGraphRoutes.values().next().value.interactiveValueKeys.get(matterId)).toBe(base.interactive.values.find((v) => v.id === matterId)!.key);
  });

  it('puts the stored values back when Auto stops, on the frame loop\'s own next flush', async () => {
    const sync = makeSync();
    const layers = [worldLayer()];
    await sync.flush(1920, 1080, layers);
    const { clear } = await autoFrames(sync, layers, 5);
    // The frame loop flushes what was published, not last frame's copy.
    expect(sync.latestLayers).toBe(layers);
    clear();
    h.batches.length = 0;
    await sync.flush(1920, 1080, sync.latestLayers);
    const route = sync.nativeGraphRoutes.values().next().value;
    expect(route.interactiveParamsLive).toBe(false);
    expect(ofType('update_native_graph_buffer').length).toBeGreaterThan(0);
  });

  it('measures the sync per frame with an Auto playing on two effect params', async () => {
    const sync = makeSync();
    const layers = [worldLayer()];
    await sync.flush(1920, 1080, layers);
    const warm = await autoFrames(sync, layers, 20);
    (globalThis as any).__gaNativeIpcProbe = { types: {} };
    const frames = 120;
    const started = performance.now();
    await autoFrames(sync, layers, frames);
    const ms = (performance.now() - started) / frames;
    const builds = (globalThis as any).__gaNativeIpcProbe.graphBuilds ?? 0;
    process.stderr.write(`[interactive-auto] sync with Auto on 2 params: ${ms.toFixed(3)} ms per frame, ${builds} graph builds in ${frames} frames\n`);
    warm.clear();
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
