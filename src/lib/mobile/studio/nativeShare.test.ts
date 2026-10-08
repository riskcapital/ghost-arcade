import { afterEach, describe, expect, it, vi } from 'vitest';
import { blobToBase64, isNativePlatform, safeFileName, shareFile } from './nativeShare';

afterEach(() => { vi.unstubAllGlobals(); });
const json = '{"version":1,"name":"Friday — main room"}';
const blob = () => new Blob([json], { type: 'application/json' });

describe('shareFile in the installed app', () => {
  it('sends the file to StudioCapture.shareFile as base64 and reports completion', async () => {
    const nativePromise = vi.fn(async () => ({ completed: true }));
    vi.stubGlobal('Capacitor', { getPlatform: () => 'ios', nativePromise });
    expect(isNativePlatform()).toBe(true);
    await expect(shareFile('Friday: main/room.ghostset', blob(), 'application/json')).resolves.toBe(true);
    expect(nativePromise).toHaveBeenCalledOnce();
    const [plugin, method, args] = nativePromise.mock.calls[0] as unknown as [string, string, { filename: string; base64: string; mimeType: string }];
    expect(plugin).toBe('StudioCapture');
    expect(method).toBe('shareFile');
    expect(args.filename).toBe('Friday- main-room.ghostset');
    expect(args.mimeType).toBe('application/json');
    expect(new TextDecoder().decode(Uint8Array.from(atob(args.base64), c => c.charCodeAt(0)))).toBe(json);
  });
  it('reports false when the share sheet is dismissed, so nothing claims the set was saved', async () => {
    vi.stubGlobal('Capacitor', { getPlatform: () => 'ios', nativePromise: async () => ({ completed: false }) });
    await expect(shareFile('a.ghostset', blob(), 'application/json')).resolves.toBe(false);
    vi.stubGlobal('Capacitor', { getPlatform: () => 'ios', nativePromise: async () => undefined });
    await expect(shareFile('a.ghostset', blob(), 'application/json')).resolves.toBe(false);
  });
  it('rejects when the native side cannot share', async () => {
    vi.stubGlobal('Capacitor', { getPlatform: () => 'ios', nativePromise: async () => { throw new Error('not implemented'); } });
    await expect(shareFile('a.ghostset', blob(), 'application/json')).rejects.toThrow();
    vi.stubGlobal('Capacitor', { getPlatform: () => 'ios' });
    await expect(shareFile('a.ghostset', blob(), 'application/json')).rejects.toThrow(/not available/);
  });
});

describe('shareFile in a browser', () => {
  it('falls back to a download link and never calls a plugin', async () => {
    const link = { href: '', download: '', click: vi.fn() };
    vi.stubGlobal('Capacitor', { getPlatform: () => 'web', nativePromise: vi.fn() });
    vi.stubGlobal('document', { createElement: vi.fn(() => link) });
    const createObjectURL = vi.fn(() => 'blob:test'), revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }));
    expect(isNativePlatform()).toBe(false);
    await expect(shareFile('My set.ghostset', blob(), 'application/json')).resolves.toBe(true);
    expect(link.download).toBe('My set.ghostset');
    expect(link.href).toBe('blob:test');
    expect(link.click).toHaveBeenCalledOnce();
    expect((globalThis as unknown as { Capacitor: { nativePromise: ReturnType<typeof vi.fn> } }).Capacitor.nativePromise).not.toHaveBeenCalled();
  });
});

describe('helpers', () => {
  it('makes a safe file name and keeps the extension', () => {
    expect(safeFileName('Untitled set.ghostset')).toBe('Untitled set.ghostset');
    expect(safeFileName('../../etc/passwd.ghostset')).toBe('etc-passwd.ghostset');
    expect(safeFileName('   .ghostset')).toBe('Ghost Arcade file.ghostset');
    expect(safeFileName('a'.repeat(200) + '.json')).toHaveLength(85);
  });
  it('encodes binary data of any size', async () => {
    const bytes = new Uint8Array(100_000).map((_, i) => i % 251);
    const decoded = Uint8Array.from(atob(await blobToBase64(new Blob([bytes]))), c => c.charCodeAt(0));
    expect(decoded.length).toBe(bytes.length);
    expect(decoded[99_999]).toBe(bytes[99_999]);
  });
});
