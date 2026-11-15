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

describe('Interactive scene: keyframes, show lanes and Timeline lines on an effect param without a graph rebuild', () => {
  const base = { kind: 'performer-world', sourceId: 'plugin:world-layer:performer-world', width: 1920, height: 1080, time: 0, frameDelta: 1 / 60, frameIndex: 1, audio: { active: false, bass: 0, mid: 0, treble: 0, energy: 0, beatPhase: 0, beatPulse: 0, amplitude: 0 }, state: null, reset: false };
  /** What the core holds for the layer's value buffers. */
  const held = (sync: any) => sync.nativeGraphRoutes.values().next().value.interactiveValueKeys as Map<string, string>;
  /** Every value buffer the core holds equals a full build of this scene. */
  async function expectHeldEqualsFullBuild(sync: any, scene: any) {
    const { buildInteractiveGraph } = await import('../renderer/nativeInteractiveGraph');
    const full = buildInteractiveGraph({ ...base, params: { interactiveScene: scene } } as any);
    const keys = held(sync);
    let compared = 0;
    for (const value of full.interactive.values) {
      if (!keys.has(value.id)) continue;
      expect([value.id, keys.get(value.id)]).toEqual([value.id, value.key]);
      compared++;
    }
    expect(compared).toBeGreaterThan(3);
  }
  type Driver = { name: string; frame: (layers: any[], key: string, value: number) => Promise<any[]> | any[]; stop: (layers: any[]) => Promise<any[]> | any[] };
  const drivers: Driver[] = [
    {
      name: 'a Timeline line',
      frame: async (layers, key, value) => {
        const lines = await import('../timeline/lines/lineRuntime');
        lines.publishLineFrame({ time: value, layers: new Map([['world-layer', { [key]: value }]]), stage: null, leds: null } as any);
        return layers;
      },
      stop: async (layers) => { (await import('../timeline/lines/lineRuntime')).publishLineFrame(null); return layers; },
    },
    {
      name: 'keyframes',
      frame: async (layers, key, value) => {
        const { keyframeTimeline } = await import('../stores/keyframeTimeline');
        if (!keyframeTimeline.hasKeyframes('world-layer')) {
          keyframeTimeline.addKeyframe('world-layer', key, 0, 0.1, 'linear', 'Speed', 'number');
          keyframeTimeline.addKeyframe('world-layer', key, 10, 0.9, 'linear', 'Speed', 'number');
          keyframeTimeline.setOpen(true);
        }
        keyframeTimeline.seek(((value - 0.1) / 0.8) * 10);
        return layers;
      },
      stop: async (layers) => { const { keyframeTimeline } = await import('../stores/keyframeTimeline'); keyframeTimeline.clearAll(); keyframeTimeline.setOpen(false); return layers; },
    },
    {
      name: 'a show lane',
      // The show's scene copies carry their lane values (showTrackScene.ts).
      frame: (layers, key, value) => [{ ...layers[0], _showParams: { [key]: value } }],
      stop: (layers) => layers,
    },
  ];

  for (const driver of drivers) {
    it(`${driver.name} on fire speed: 0 graph builds, and the core holds what a full build gives`, async () => {
      const sync = makeSync();
      const layers = [worldLayer()];
      const scene = layers[0].source.effectSource.interactiveScene;
      const fire = scene.effects.find((e: any) => e.kind === 'fire');
      const key = `interactive:${fire.id}:speed`;
      await sync.flush(1920, 1080, layers);
      await sync.flush(1920, 1080, layers);
      h.batches.length = 0;
      (globalThis as any).__gaNativeIpcProbe = { types: {} };
      let value = 0;
      for (let i = 0; i < 30; i++) {
        value = 0.1 + 0.8 * (i / 30);
        await sync.flush(1920, 1080, await driver.frame(layers, key, value));
      }
      const probe = (globalThis as any).__gaNativeIpcProbe;
      expect(ofType('set_native_graph_layer')).toEqual([]);
      expect(probe.graphBuilds ?? 0).toBe(0);
      expect(ofType('update_native_graph_buffer').some((c) => String(c.buffer_id).includes(`${fire.id}:interactive:`))).toBe(true);
      // Keyframes are evaluated at the time seeked, so their last value is
      // the track's value there; read it back from what was applied.
      const applied = sync.applyTimelineOverrides(await driver.frame(layers, key, value))[0]._interactiveLiveParams?.[key];
      expect(applied).toBeCloseTo(value, 5);
      await expectHeldEqualsFullBuild(sync, fx.applyInteractiveOverrides(scene, { [key]: applied }));
      // The stored scene is untouched.
      expect(scene.effects.find((e: any) => e.id === fire.id).params.speed).toBe(fire.params.speed);
      // Stopped: the stored values go back, still without a rebuild.
      const after = await driver.stop(layers);
      await sync.flush(1920, 1080, after);
      expect(ofType('set_native_graph_layer')).toEqual([]);
      await expectHeldEqualsFullBuild(sync, scene);
      delete (globalThis as any).__gaNativeIpcProbe;
    });
  }

  it('a line on a param with a Core modulation: one graph change when it starts, none while it plays, one when it stops', async () => {
    const sync = makeSync();
    const layers = [worldLayer()];
    const scene = layers[0].source.effectSource.interactiveScene;
    const arch = scene.effects.find((e: any) => e.kind === 'architecture');
    arch.mods = { ...arch.mods, energy: { source: 'bass', amount: 0.5, speed: 0.15, invert: false, bpmSync: false } };
    const key = `interactive:${arch.id}:energy`;
    const lines = await import('../timeline/lines/lineRuntime');
    await sync.flush(1920, 1080, layers);
    h.batches.length = 0;
    (globalThis as any).__gaNativeIpcProbe = { types: {} };
    let value = 0;
    for (let i = 0; i < 30; i++) {
      value = 0.2 + 0.6 * (i / 30);
      lines.publishLineFrame({ time: i, layers: new Map([['world-layer', { [key]: value }]]), stage: null, leds: null } as any);
      await sync.flush(1920, 1080, layers);
    }
    expect(ofType('set_native_graph_layer').length).toBe(1);
    expect((globalThis as any).__gaNativeIpcProbe.graphBuilds).toBe(1);
    await expectHeldEqualsFullBuild(sync, fx.applyInteractiveOverrides(scene, { [key]: value }));
    lines.publishLineFrame(null);
    await sync.flush(1920, 1080, layers);
    expect(ofType('set_native_graph_layer').length).toBe(2);
    await expectHeldEqualsFullBuild(sync, scene);
    delete (globalThis as any).__gaNativeIpcProbe;
  });

  it('a value that stops moving goes back to the stored one even after a build made while it moved', async () => {
    const sync = makeSync();
    const layers = [worldLayer()];
    const scene = layers[0].source.effectSource.interactiveScene;
    const fire = scene.effects.find((e: any) => e.kind === 'fire');
    const key = `interactive:${fire.id}:speed`;
    const lines = await import('../timeline/lines/lineRuntime');
    lines.publishLineFrame({ time: 0, layers: new Map([['world-layer', { [key]: 0.85 }]]), stage: null, leds: null } as any);
    // Installed (and, with this stub core, repaired once) while the line plays.
    await sync.flush(1920, 1080, layers);
    await sync.flush(1920, 1080, layers);
    expect(ofType('set_native_graph_layer').length).toBeGreaterThan(0);
    await expectHeldEqualsFullBuild(sync, fx.applyInteractiveOverrides(scene, { [key]: 0.85 }));
    h.batches.length = 0;
    lines.publishLineFrame(null);
    await sync.flush(1920, 1080, layers);
    expect(ofType('set_native_graph_layer')).toEqual([]);
    await expectHeldEqualsFullBuild(sync, scene);
  });

  it('an Auto value goes back to the stored one when it stops, even after a build made while it played', async () => {
    const sync = makeSync();
    const layers = [worldLayer()];
    const scene = layers[0].source.effectSource.interactiveScene;
    const fire = scene.effects.find((e: any) => e.kind === 'fire');
    const liveParams = await import('../audio/liveParams');
    const writer = new liveParams.LiveFrameWriter('auto');
    writer.layer('world-layer', 'world-src', `interactive:${fire.id}:speed`, 0.85);
    writer.commit();
    // Installed while the Auto plays.
    await sync.flush(1920, 1080, layers);
    await sync.flush(1920, 1080, layers);
    await expectHeldEqualsFullBuild(sync, fx.applyInteractiveOverrides(scene, { [`interactive:${fire.id}:speed`]: 0.85 }));
    h.batches.length = 0;
    liveParams.clearLiveValues('auto');
    await sync.flush(1920, 1080, layers);
    expect(ofType('set_native_graph_layer')).toEqual([]);
    await expectHeldEqualsFullBuild(sync, scene);
  });

  it('enabled stays a step change on the scene copy', async () => {
    const sync = makeSync();
    const layers = [worldLayer()];
    const fire = layers[0].source.effectSource.interactiveScene.effects.find((e: any) => e.kind === 'fire');
    const split = mod.splitInteractiveOverrides(layers[0], [{ [`interactive:${fire.id}:enabled`]: false }, { [`interactive:${fire.id}:speed`]: 0.3, 'layer:opacity': 0.5 }]);
    expect(split.params).toEqual({ [`interactive:${fire.id}:speed`]: 0.3 });
    expect(split.sets).toEqual([{ [`interactive:${fire.id}:enabled`]: false }, { 'layer:opacity': 0.5 }]);
    expect(split.source).toBe(layers[0].source);
    // A layer opacity line alone leaves the scene source as it is.
    const copy = sync.applyTimelineOverrides([{ ...layers[0], _showParams: { 'layer:opacity': 0.4 } }])[0];
    expect(copy.source).toBe(layers[0].source);
    expect(copy.opacity).toBe(0.4);
  });
});
