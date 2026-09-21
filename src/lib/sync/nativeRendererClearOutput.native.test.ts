/**
 * Regression: clearing the scene must produce a clearing frame.
 *
 * The bug this guards: deleting the last layer left the previous frame stuck
 * in every native output surface (the shared output export texture that
 * feeds Syphon / NDI / Spout and the embedded editor presenter, the slice
 * windows, the swapchain). The core cannot repaint a surface without drawing
 * a frame, and the per-frame RAF is torn down the instant nothing needs
 * continuous sync — so the removal commands MUST travel with a present, and
 * that flush must not be left to a timer that the teardown could outrun.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const invokeCalls: Array<{ command: string; args: any }> = [];
let failNextBatch = false;
let coreLayers: any[] = [];

vi.mock('$lib/bridge', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    invoke: async (command: string, args?: any) => {
      invokeCalls.push({ command, args });
      if (command === 'native_renderer_submit_batch' || command === 'native_renderer_submit_commands') {
        if (failNextBatch) {
          failNextBatch = false;
          throw new Error('test transport interruption');
        }
        return { total: 0, applied: 0, dropped: 0, unknown_types: [] };
      }
      if (command === 'native_renderer_get_layers_snapshot') return { layers: coreLayers };
      return null;
    },
  };
});

let NativeRendererSyncCtor: typeof import('./nativeRendererSync').NativeRendererSync;

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
  ({ NativeRendererSync: NativeRendererSyncCtor } = await import('./nativeRendererSync'));
});

beforeEach(() => {
  invokeCalls.length = 0;
  failNextBatch = false;
  coreLayers = [];
});

describe('native video trigger and live diagnostics', () => {
  const source = () => ({
    id: 'clip', src: 'file:///tmp/video.mp4', type: 'video', isPlaying: true,
    playbackRate: 1, durationSeconds: 8, _nativePlaybackTimeSeconds: 0,
    _nativePlaybackUpdatedAtMs: performance.now(), _nativePlaybackSeekSeq: 7,
  });

  it.each([false, true])('preserves successful transport state and retries failed handoffs (failure=%s)', async (fail) => {
    const sync = new NativeRendererSyncCtor() as any;
    sync.running = true;
    sync.startupReady = true;
    sync.lastLayers.set('row', {});
    const src = source();
    failNextBatch = fail;
    await sync.syncUrgentVideoSources(1920, 1080, [
      { id: 'row', type: 'video', visible: true, opacity: 1, source: src, effects: [] },
    ], ['clip']);
    const batch = lastSubmittedBatch()!;
    expect(batch.find(command => command.type === 'set_media_source_playback'))
      .toMatchObject({ source_id: 'clip', time_seconds: 0, seek_generation: 7 });
    expect(batch.at(-1)?.type).toBe('present');
    const followingTransport = sync.nativeVideoPlaybackCommandIfChanged(src, 'video', Date.now(), { mode: 'live' });
    if (fail) expect(followingTransport?.source_id).toBe('clip');
    else expect(followingTransport).toBeNull();
    expect(sync.prefetchedSources.size).toBe(fail ? 0 : 1);
  });

  it('does not read output pixels during ordinary live scene reconciliation', async () => {
    const sync = new NativeRendererSyncCtor() as any;
    sync.nativeLayerReconcileAt = -Infinity;
    sync.lastLayers.set('row', { geometrySig: '', visible: true, opacity: 1 });
    coreLayers = [{ layer_id: 'row', visible: true, opacity: 1 }];
    await sync.reconcileNativeLayerGeometry();
    expect(invokeCalls.some(call => call.command === 'native_renderer_get_layers_snapshot')).toBe(true);
    expect(invokeCalls.some(call => call.command === 'native_renderer_get_frame_snapshot')).toBe(false);
  });
});

function lastSubmittedBatch(): any[] | null {
  for (let i = invokeCalls.length - 1; i >= 0; i -= 1) {
    if (invokeCalls[i].command === 'native_renderer_submit_commands') {
      return invokeCalls[i].args?.commands ?? null;
    }
    if (invokeCalls[i].command === 'native_renderer_submit_batch') {
      return invokeCalls[i].args?.batch?.commands ?? null;
    }
  }
  return null;
}

describe('native renderer sync clears the output when the scene empties', () => {
  it('sends a present after the last remove_layer so the core repaints an empty scene', async () => {
    const sync = new NativeRendererSyncCtor() as any;
    sync.running = true;
    sync.startupReady = true;
    // The core is holding one layer that has just disappeared from the scene.
    sync.lastLayers = new Map([['ghost-layer', { geometrySig: '', visible: true } as any]]);

    await sync.flushOnce(1920, 1080, []);

    const commands = lastSubmittedBatch();
    expect(commands, 'the empty scene must still produce a command batch').not.toBeNull();

    const removeIndex = commands!.findIndex(
      (command: any) => command.type === 'remove_layer' && command.layer_id === 'ghost-layer',
    );
    const presentIndex = commands!.findIndex((command: any) => command.type === 'present');
    expect(removeIndex, 'remove_layer must be emitted for the disappeared layer').toBeGreaterThanOrEqual(0);
    // Without a present the core never draws again — an empty scene puts its
    // idle loop to sleep, so the last picture stays resident in the output
    // export texture and on every slice window.
    expect(presentIndex, 'the removal batch must ask for a present').toBeGreaterThan(removeIndex);
    expect(commands![commands!.length - 1].type).toBe('present');
    expect(sync.lastLayers.size, 'the removed layer must not be re-sent next flush').toBe(0);
  });

  it('flushes immediately when the per-frame loop is torn down instead of deferring the clearing frame', () => {
    const sync = new NativeRendererSyncCtor() as any;
    sync.running = true;
    sync.startupReady = true;
    const flushed: Array<unknown[]> = [];
    sync.flush = (...args: unknown[]) => {
      flushed.push(args);
      return Promise.resolve();
    };
    // Pretend the shader RAF is live, as it is whenever a visible layer exists.
    sync.shaderAnimationRaf = 7;

    sync.scheduleSync(1920, 1080, []);

    expect(sync.shaderAnimationRaf, 'the per-frame loop must stop when nothing needs it').toBeNull();
    // The clearing frame must ride out with the teardown, not wait on the
    // 16ms coalescing timer that the teardown has already outrun.
    expect(flushed.length, 'the clearing flush must happen synchronously').toBe(1);
    expect(flushed[0][2]).toEqual([]);
    expect(sync.pendingSyncTimer).toBeNull();
    expect(sync.pendingSync).toBe(false);
  });
});


describe('native scene ownership across editor and workspace changes', () => {
  it('removes stale core layers after remount even with an empty editor diff cache', async () => {
    const sync = new NativeRendererSyncCtor() as any;
    sync.running = true; sync.startupReady = true;
    coreLayers = [{ layer_id: '__vj-mix__' }, { layer_id: 'old-mapping-media' }];
    await sync.flushOnce(1920, 1080, []);
    const removals = lastSubmittedBatch()!.filter(c => c.type === 'remove_layer').map(c => c.layer_id);
    expect(removals).toEqual(expect.arrayContaining(['__vj-mix__', 'old-mapping-media']));
    expect(lastSubmittedBatch()!.at(-1).type).toBe('present');
  });
  it('replaces an old VJ scene with Mapping media without removing the incoming layer', async () => {
    const { createLayer } = await import('../types');
    const sync = new NativeRendererSyncCtor() as any;
    sync.running = true; sync.startupReady = true;
    sync.nativeFeatureFlags = { native_static_image_decode: true };
    coreLayers = [{ layer_id: '__vj-mix__' }, { layer_id: 'vj-layer-0' }, { layer_id: 'mapping-media' }];
    const media = createLayer('mapping-media', 'Mapping media', 'media');
    media.source = { id: 'mapping-image', type: 'image', src: '/mapping.png', name: 'Mapping image', width: 1920, height: 1080 } as any;
    await sync.flushOnce(1920, 1080, [media]);
    const commands = lastSubmittedBatch()!;
    expect(commands).toContainEqual({ type: 'remove_layer', layer_id: '__vj-mix__' });
    expect(commands).toContainEqual({ type: 'remove_layer', layer_id: 'vj-layer-0' });
    expect(commands.some(c => c.type === 'remove_layer' && c.layer_id === media.id)).toBe(false);
    expect(commands.some(c => c.type === 'bind_media_source' && c.layer_id === media.id && c.source_id === 'mapping-image')).toBe(true);
  });
  it('retains removal ownership when reconciliation invalidates a geometry snapshot', async () => {
    const sync = new NativeRendererSyncCtor() as any;
    sync.running = true; sync.startupReady = true; sync.nativeSceneAdopted = true;
    sync.nativeLayerReconcileAt = -Infinity;
    sync.lastLayers.set('vj-layer-0', { geometrySig: '', visible: true, opacity: 1 });
    coreLayers = [{ layer_id: 'vj-layer-0', visible: false, opacity: 1 }];
    await sync.reconcileNativeLayerGeometry();
    expect(sync.lastLayers.has('vj-layer-0')).toBe(false);
    coreLayers = [];
    await sync.flushOnce(1920, 1080, []);
    expect(lastSubmittedBatch()).toContainEqual({ type: 'remove_layer', layer_id: 'vj-layer-0' });
  });
});
