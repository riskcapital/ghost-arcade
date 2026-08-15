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

vi.mock('$lib/bridge', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    invoke: async (command: string, args?: any) => {
      invokeCalls.push({ command, args });
      if (command === 'native_renderer_submit_batch' || command === 'native_renderer_submit_commands') {
        return { total: 0, applied: 0, dropped: 0, unknown_types: [] };
      }
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
});

function lastSubmittedBatch(): any[] | null {
  for (let i = invokeCalls.length - 1; i >= 0; i -= 1) {
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
