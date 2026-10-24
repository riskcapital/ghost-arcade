import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { expect, it, vi } from 'vitest';

// The Screen pump in electron/main.js, run on its own: on Windows it hands
// each Screen's texture to the presenter addon's vblank thread once, instead
// of copying and presenting every frame on the Electron main thread.
const main = readFileSync('electron/main.js', 'utf8');
const pump = main.slice(main.indexOf('function windowsNativeMonitorPump'), main.indexOf('const deckMonitorAttachedNames'));

function harness(nativePump: boolean) {
  const ticks: Array<() => Promise<void>> = [];
  const addon: Record<string, any> = { monitorSetSharedTexture: vi.fn(() => true), monitorRestack: vi.fn() };
  if (nativePump) addon.monitorSetSharedTextureSource = vi.fn(() => true);
  const invoke = vi.fn().mockResolvedValue({ available: true, slices: [{ id: 's1', shared_name: 'S1', width: 1920, height: 1080, frame: 1 }] });
  const intervals: number[] = [];
  const context: Record<string, any> = {
    isWin: true, isMac: false, Number, String, Array, console: { log() {}, warn() {} },
    nativePreviewAddon: addon, loadNativePreviewAddon: () => addon,
    nativeRendererBroker: { invoke },
    sliceNativeAttached: new Set(['s1']), sliceNativeLastBinding: new Map(),
    sliceNativePump: null, sliceNativePumpInFlight: false,
    sliceMonitorName: (id: string) => `slice:${id}`,
    setInterval: (fn: () => Promise<void>, ms: number) => { ticks.push(fn); intervals.push(ms); return { unref() {} }; },
    clearInterval() {},
  };
  vm.runInNewContext(`${pump}\nstartSliceNativePump();`, context);
  return { addon, invoke, tick: () => ticks[0](), intervals };
}

it('publishes a Windows Screen to the native vblank pump once per texture', async () => {
  const h = harness(true);
  // A light bookkeeping tick, not a 30 fps present clock.
  expect(h.intervals[0]).toBe(100);
  await h.tick(); await h.tick();
  expect(h.addon.monitorSetSharedTextureSource.mock.calls).toEqual([['slice:s1', 'S1', 1920, 1080]]);
  h.invoke.mockResolvedValue({ available: true, slices: [{ id: 's1', shared_name: 'S1', width: 1920, height: 1080, frame: 7 }] });
  await h.tick();
  expect(h.addon.monitorSetSharedTextureSource).toHaveBeenCalledTimes(1);
  expect(h.addon.monitorSetSharedTexture).not.toHaveBeenCalled();
  // Placement behind the Screen window is re-asserted from here.
  await h.tick(); await h.tick();
  expect(h.addon.monitorRestack).toHaveBeenCalled();
});

it('keeps presenting each new frame with an addon that has no native pump', async () => {
  const h = harness(false);
  expect(h.intervals[0]).toBeCloseTo(1000 / 30);
  await h.tick();
  h.invoke.mockResolvedValue({ available: true, slices: [{ id: 's1', shared_name: 'S1', width: 1920, height: 1080, frame: 2 }] });
  await h.tick();
  expect(h.addon.monitorSetSharedTexture).toHaveBeenCalledTimes(2);
});
