import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { expect, it, vi } from 'vitest';
const main = readFileSync('electron/main.js', 'utf8');
const pump = main.slice(main.indexOf('const deckMonitorAttachedNames'), main.indexOf('// The rectangle the platform presenter takes.'));
const handlers = main.slice(main.indexOf("  ipcMain.handle('deck_monitor_attach'"), main.indexOf('  // Pointer-rate viewport mutations'));
function harness(platform = 'win32', nativePump = false) {
  const ticks: Array<() => Promise<void>> = [];
  const ipc: Record<string, Function> = {};
  const addon: Record<string, any> = { monitorAttach: vi.fn(() => true), monitorDetach: vi.fn(), monitorSetSharedTexture: vi.fn(() => true), monitorSetIOSurface: vi.fn(() => true), monitorRestack: vi.fn() };
  if (nativePump) addon.monitorSetSharedTextureSource = vi.fn(() => true);
  const invoke = vi.fn().mockResolvedValue({ available: true, banks: [{ bank: 'a', shared_name: 'A', handle: 1, width: 480, height: 270, frame: 1 }, { bank: 'b', shared_name: 'B', handle: 2, width: 480, height: 270, frame: 1 }] });
  const context = { process: { platform }, Buffer, Date, console: { log() {}, warn() {} }, nativePreviewAddon: addon,
    nativeRendererBroker: { invoke }, loadNativePreviewAddon: () => addon,
    setInterval: (fn: () => Promise<void>) => { ticks.push(fn); return { unref() {} }; }, clearInterval() {},
    ipcMain: { handle: (name: string, fn: Function) => { ipc[name] = fn; } },
    mainWindow: { isDestroyed: () => false, getNativeWindowHandle: () => Buffer.alloc(8) },
    normalizeNativePreviewRect: (r: any) => r, nativePreviewAddonRect: (r: any) => r,
    syncPresenterAdapter: vi.fn() };
  vm.runInNewContext(pump + handlers, context);
  const attach = () => ipc.deck_monitor_attach(null, { monitors: [{ name: 'deck-a', rect: {} }, { name: 'deck-b', rect: {} }] });
  return { addon, invoke, ticks, ipc, attach, syncPresenterAdapter: context.syncPresenterAdapter };
}
it('attaches both Windows monitors and presents new frames even with unchanged texture names', async () => {
  const h = harness(); expect((await h.attach()).attached).toBe(true);
  await h.ticks[0](); await h.ticks[0]();
  expect(h.addon.monitorSetSharedTexture).toHaveBeenCalledTimes(2);
  h.invoke.mockResolvedValue({ available: true, banks: [{ bank: 'b', shared_name: 'B', width: 480, height: 270, frame: 2 }] });
  await h.ticks[0]();
  expect(h.addon.monitorSetSharedTexture).toHaveBeenLastCalledWith('deck-b', 'B', 480, 270);
  expect(h.addon.monitorSetSharedTexture).toHaveBeenCalledTimes(3);
  await h.ipc.deck_monitor_detach();
  expect(h.addon.monitorDetach.mock.calls).toEqual([['deck-a'], ['deck-b']]);
});
it('does not attach failed native views or publish a stale response after detach', async () => {
  const h = harness(); h.addon.monitorAttach.mockReturnValue(false);
  expect((await h.attach()).attached).toBe(false);
  h.addon.monitorAttach.mockReturnValue(true); await h.attach();
  let finish!: Function; h.invoke.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const pending = h.ticks[0](); await h.ipc.deck_monitor_detach();
  finish({ available: true, banks: [{ bank: 'b', shared_name: 'B', width: 480, height: 270, frame: 1 }] });
  await pending; expect(h.addon.monitorSetSharedTexture).not.toHaveBeenCalled();
});
it('preserves Mac display-link binding without resending unchanged surfaces', async () => {
  const h = harness('darwin'); await h.attach(); await h.ticks[0](); await h.ticks[0]();
  expect(h.addon.monitorSetIOSurface).toHaveBeenCalledTimes(2);
  expect(h.addon.monitorSetSharedTexture).not.toHaveBeenCalled();
});
it('opens deck textures on the adapter the core names', async () => {
  const h = harness('win32', true); await h.attach();
  h.invoke.mockResolvedValue({ available: true, adapter_luid: '00000000000abcde', banks: [{ bank: 'a', shared_name: 'A', width: 480, height: 270, frame: 1 }] });
  await h.ticks[0]();
  expect(h.syncPresenterAdapter).toHaveBeenCalledWith(h.addon, '00000000000abcde');
});
it('hands Windows decks to the native vblank pump once per texture, not once per frame', async () => {
  const h = harness('win32', true); await h.attach();
  await h.ticks[0]();
  expect(h.addon.monitorSetSharedTextureSource.mock.calls).toEqual([['deck-a', 'A', 480, 270], ['deck-b', 'B', 480, 270]]);
  // New frames in the same texture: the addon's thread presents them itself.
  h.invoke.mockResolvedValue({ available: true, banks: [{ bank: 'b', shared_name: 'B', width: 480, height: 270, frame: 9 }] });
  await h.ticks[0](); await h.ticks[0]();
  expect(h.addon.monitorSetSharedTextureSource).toHaveBeenCalledTimes(2);
  expect(h.addon.monitorSetSharedTexture).not.toHaveBeenCalled();
  // A new texture (a resize) is published again.
  h.invoke.mockResolvedValue({ available: true, banks: [{ bank: 'b', shared_name: 'B2', width: 960, height: 540, frame: 10 }] });
  await h.ticks[0]();
  expect(h.addon.monitorSetSharedTextureSource).toHaveBeenLastCalledWith('deck-b', 'B2', 960, 540);
});
