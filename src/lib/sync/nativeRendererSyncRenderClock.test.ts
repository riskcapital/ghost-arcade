/**
 * Render to video owns the core's clock. The editor's own frame loop (the
 * native shell) handed the clock back to live on every animation frame, so a
 * render frame whose work spanned one went out on the live clock and the
 * render stopped: "The render core left the render's clock at frame N".
 * Seen on an Auto show Timeline, within the first thirty seconds.
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
let parseCubeLut: typeof import('../color/cubeLut').parseCubeLut;
let packUniforms: typeof import('../renderer/nativeEffectPass').packNativeEffectPassUniforms;
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
  ({ parseCubeLut } = await import('../color/cubeLut'));
  const effectPass = await import('../renderer/nativeEffectPass');
  manifestIds = effectPass.NATIVE_EFFECT_PASS_MANIFEST.map((entry) => entry.id);
  packUniforms = effectPass.packNativeEffectPassUniforms;
});


describe('the render clock during Render to video', () => {
  it('stays on the render while the export holds it, whatever the editor loop says', () => {
    const sync = new mod.NativeRendererSync() as any;
    sync.beginManualClockExport({ width: 1920, height: 1080 });
    sync.setRenderClock(5);
    sync.setRenderClock(null); // the editor's frame loop, between a frame's start and its flush
    const cmd = sync.renderClockCommand();
    expect(cmd.mode).toBe('manual');
    expect(cmd.time).toBe(5);
    sync.endManualClockExport();
    expect(sync.renderClockCommand().mode).toBe('live');
  });

  it('live, the editor loop still drives the clock', () => {
    const sync = new mod.NativeRendererSync() as any;
    sync.setRenderClock(3);
    sync.setRenderClock(null);
    expect(sync.renderClockCommand().mode).toBe('live');
  });
});
