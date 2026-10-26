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

// Attaching a Screen's presenter. The Windows presenter places its window in
// physical pixels, while Electron sizes the Screen window in DIPs.
const attach = main.slice(main.indexOf('function sliceNativeLayerRect'), main.indexOf('/** Linux: hand the Screen window'));

async function attachHarness(platform: 'win32' | 'darwin', scaleFactor: number) {
  const { nativePreviewRectToDevicePixels } = await import('../../../electron/native-preview-geometry.js');
  const addon = { monitorAttach: vi.fn(() => true) };
  const win = {
    isDestroyed: () => false,
    getNativeWindowHandle: () => Buffer.alloc(8, 1),
    getContentSize: () => [2560, 1440],
    getBounds: () => ({ x: 2560, y: 0, width: 2560, height: 1440 }),
  };
  const context: Record<string, any> = {
    isWin: platform === 'win32', isMac: platform === 'darwin', Buffer, Date, Math,
    console: { log() {}, warn() {} },
    nativePreviewAddon: addon, loadNativePreviewAddon: () => addon,
    nativePreviewRectToDevicePixels,
    screen: { getDisplayMatching: vi.fn(() => ({ id: 2, scaleFactor })) },
    sliceNativeAttached: new Set<string>(), sliceNativePending: new Set<string>(),
    sliceWindows: new Map([['s1', win]]),
    sliceMonitorName: (id: string) => `slice:${id}`,
    startSliceNativePump: vi.fn(),
  };
  vm.runInNewContext(attach, context);
  return { addon, win, context };
}

it('sizes a Windows Screen presenter in physical pixels on a scaled display', async () => {
  const h = await attachHarness('win32', 1.5);
  expect(h.context.attachSliceNativeLayer('s1', h.win)).toBe(true);
  const [name, , rect] = h.addon.monitorAttach.mock.calls[0];
  expect(name).toBe('slice:s1');
  // A 150% 4K projector: 2560x1440 DIP is the whole 3840x2160 panel.
  expect(rect).toMatchObject({ x: 0, y: 0, width: 3840, height: 2160, contentWidth: 3840, contentHeight: 2160 });
  // The addon keeps tracking the client area after a resize or DPI change.
  expect(rect.fillHost).toBe(true);
});

it('re-sends a Windows Screen rect when its display changes scale', async () => {
  const h = await attachHarness('win32', 1);
  h.context.attachSliceNativeLayer('s1', h.win);
  expect(h.addon.monitorAttach.mock.calls[0][2]).toMatchObject({ width: 2560, height: 1440 });
  h.context.screen.getDisplayMatching.mockReturnValue({ id: 2, scaleFactor: 2 });
  h.context.refreshSliceNativeLayerRects();
  expect(h.addon.monitorAttach).toHaveBeenCalledTimes(2);
  expect(h.addon.monitorAttach.mock.calls[1][2]).toMatchObject({ width: 5120, height: 2880 });
});

it('keeps macOS Screen presenters in points', async () => {
  const h = await attachHarness('darwin', 2);
  expect(h.context.attachSliceNativeLayer('s1', h.win)).toBe(true);
  expect(h.addon.monitorAttach.mock.calls[0][2]).toMatchObject({ width: 2560, height: 1440 });
  expect(h.context.screen.getDisplayMatching).not.toHaveBeenCalled();
});
