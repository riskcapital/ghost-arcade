import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

// Execute the real Electron pump with controlled scheduling and native APIs.
const main = readFileSync('electron/main.js', 'utf8');
const source = main.slice(main.indexOf('let ndiOutputPumpGeneration'), main.indexOf('// Ableton Link — main-process singleton'));
function harness(mac = false) {
  const ticks: Array<() => Promise<void>> = [];
  const addon = { createSender: vi.fn(), destroySender: vi.fn(), sendImage: vi.fn() };
  const preview = { readSharedTexturePixels: vi.fn(), readIOSurfacePixels: vi.fn(), releaseReadback: vi.fn() };
  const metadata = vi.fn().mockResolvedValue({ available: true, shared_name: 'Local\\test', handle: 42, width: 2, height: 1, frame: 7 });
  const context: any = { process: { platform: mac ? 'darwin' : 'win32' }, isMac: mac, console: { log() {}, warn() {}, error() {} },
    nativePreviewAddon: preview, loadNativePreviewAddon: () => preview, ndiAddon: addon, loadNdiAddon: () => addon,
    getNdiLoadStatus: () => ({}), ndiSenders: new Set(), OSR_PAINT_FPS: 60, getNativeOutputSharedTextureMetadata: metadata,
    setInterval: (fn: () => Promise<void>) => { ticks.push(fn); return ticks.length; }, clearInterval() {}, Date };
  vm.runInNewContext(source, context);
  return { context, addon, preview, metadata, ticks };
}
const pixels = (frame = 7) => ({ data: Buffer.alloc(8, 123), width: 2, height: 1, frame });
describe('NDI native output pump', () => {
  it('drains a pending Windows frame while the source is frozen and preserves the selected rate', async () => {
    const h = harness();
    h.preview.readSharedTexturePixels.mockReturnValueOnce(null).mockReturnValue(pixels());
    expect(h.context.startNdiOutputPump({ name: 'Test', fps: 30 }).ok).toBe(true);
    await h.ticks[0](); expect(h.addon.sendImage).not.toHaveBeenCalled();
    await h.ticks[0](); await h.ticks[0]();
    expect(h.preview.readSharedTexturePixels).toHaveBeenCalledWith('Local\\test', 7);
    expect(h.addon.sendImage).toHaveBeenCalledTimes(1);
    expect(h.addon.sendImage).toHaveBeenCalledWith({ name: 'Test', data: pixels().data, width: 2, height: 1, fps: 30 });
  });
  it('does not publish an old pending tick into a restarted sender', async () => {
    const h = harness(); let finish!: (value: any) => void;
    h.metadata.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    h.context.startNdiOutputPump({ name: 'Old' }); const old = h.ticks[0]();
    h.context.startNdiOutputPump({ name: 'New' });
    finish({ available: true, shared_name: 'old', width: 2, height: 1, frame: 1 }); await old;
    expect(h.preview.readSharedTexturePixels).not.toHaveBeenCalled();
    expect(h.addon.sendImage).not.toHaveBeenCalled();
    expect(h.addon.destroySender).toHaveBeenCalledWith({ name: 'Old' });
  });
  it('captures a replacement texture even when its frame counter matches', async () => {
    const h = harness(); h.preview.readSharedTexturePixels.mockReturnValue(pixels());
    h.context.startNdiOutputPump(); await h.ticks[0]();
    h.metadata.mockResolvedValue({ available: true, shared_name: 'replacement', width: 2, height: 1, frame: 7 });
    await h.ticks[0](); expect(h.addon.sendImage).toHaveBeenCalledTimes(2);
    h.context.stopNdiOutputPump(); expect(h.preview.releaseReadback).toHaveBeenCalled();
  });
  it('reports DXGI capture failure and clears it after recovery', async () => {
    const h = harness(); h.preview.readSharedTexturePixels.mockImplementationOnce(() => { throw Error('GPU removed'); }).mockReturnValue(pixels());
    h.context.startNdiOutputPump(); await h.ticks[0]();
    expect(h.context.ndiOutputPumpStatus().lastError).toBe('GPU removed');
    await h.ticks[0](); expect(h.context.ndiOutputPumpStatus().lastError).toBeUndefined();
  });
  it('preserves the Mac IOSurface output and frame deduplication', async () => {
    const h = harness(true); h.preview.readIOSurfacePixels.mockReturnValue(pixels());
    h.context.startNdiOutputPump(); await h.ticks[0](); await h.ticks[0]();
    expect(h.preview.readIOSurfacePixels).toHaveBeenCalledWith(42);
    expect(h.addon.sendImage).toHaveBeenCalledTimes(1);
    expect(h.preview.readSharedTexturePixels).not.toHaveBeenCalled();
  });
});
