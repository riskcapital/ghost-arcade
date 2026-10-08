import { afterEach, describe, expect, it, vi } from 'vitest';
import { blobToBase64, haptic, isNativePlatform, nativeMethodAvailable, resetHapticsProbe, safeFileName, shareAnchor, shareFile } from './nativeShare';

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
    await expect(shareFile('a.ghostset', blob(), 'application/json')).rejects.toThrow(/latest version/);
  });
  it('passes the tapped button as the iPad popover anchor', async () => {
    const nativePromise = vi.fn(async () => ({ completed: true }));
    vi.stubGlobal('Capacitor', { getPlatform: () => 'ios', nativePromise });
    const button = { getBoundingClientRect: () => ({ x: 40.4, y: 300.6, width: 160, height: 44 }) };
    await shareFile('a.ghostset', blob(), 'application/json', button);
    expect((nativePromise.mock.calls[0] as unknown as [string, string, { anchor: object }])[2].anchor).toEqual({ x: 40, y: 301, width: 160, height: 44 });
    await shareFile('a.ghostset', blob(), 'application/json');
    expect((nativePromise.mock.calls[1] as unknown as [string, string, object])[2]).not.toHaveProperty('anchor');
    expect(shareAnchor({ x: 0, y: 0, width: 0, height: 0 })).toBeUndefined();
    expect(shareAnchor(null)).toBeUndefined();
  });
});

describe('app builds without the new native methods', () => {
  const headers = (methods: string[]) => [{ name: 'StudioCapture', methods: methods.map(name => ({ name })) }];
  it('reads method support from the plugin headers', () => {
    vi.stubGlobal('Capacitor', { getPlatform: () => 'ios', nativePromise: vi.fn(), PluginHeaders: headers(['listScans', 'shareFile']) });
    expect(nativeMethodAvailable('StudioCapture', 'shareFile')).toBe(true);
    expect(nativeMethodAvailable('StudioCapture', 'haptic')).toBe(false);
    expect(nativeMethodAvailable('Missing', 'shareFile')).toBe(false);
    vi.stubGlobal('Capacitor', { getPlatform: () => 'ios', nativePromise: vi.fn() });
    expect(nativeMethodAvailable('StudioCapture', 'shareFile')).toBeNull();
    vi.stubGlobal('Capacitor', { getPlatform: () => 'web', nativePromise: vi.fn() });
    expect(nativeMethodAvailable('StudioCapture', 'shareFile')).toBe(false);
  });
  it('never calls a missing shareFile and uses the system share sheet instead', async () => {
    const nativePromise = vi.fn();
    vi.stubGlobal('Capacitor', { getPlatform: () => 'android', nativePromise, PluginHeaders: headers(['listScans']) });
    const share = vi.fn(async () => {});
    vi.stubGlobal('navigator', { canShare: () => true, share });
    await expect(shareFile('a.ghostset', blob(), 'application/json')).resolves.toBe(true);
    expect(nativePromise).not.toHaveBeenCalled();
    expect((share.mock.calls[0] as unknown as [{ files: File[] }])[0].files[0].name).toBe('a.ghostset');
    share.mockRejectedValueOnce(Object.assign(new Error('cancelled'), { name: 'AbortError' }));
    await expect(shareFile('a.ghostset', blob(), 'application/json')).resolves.toBe(false);
  });
  it('says so plainly when nothing on the device can share a file', async () => {
    vi.stubGlobal('Capacitor', { getPlatform: () => 'ios', nativePromise: vi.fn(), PluginHeaders: headers([]) });
    vi.stubGlobal('navigator', {});
    await expect(shareFile('a.ghostset', blob(), 'application/json')).rejects.toThrow(/latest version/);
  });
  it('falls back when an older build rejects the call as unimplemented', async () => {
    const nativePromise = vi.fn(async () => { throw Object.assign(new Error('shareFile is not implemented on ios'), { code: 'UNIMPLEMENTED' }); });
    vi.stubGlobal('Capacitor', { getPlatform: () => 'ios', nativePromise });
    const share = vi.fn(async () => {});
    vi.stubGlobal('navigator', { canShare: () => true, share });
    await expect(shareFile('a.ghostset', blob(), 'application/json')).resolves.toBe(true);
    expect(share).toHaveBeenCalledOnce();
  });
  it('does not hide a real failure, such as a share sheet that is already open', async () => {
    vi.stubGlobal('Capacitor', { getPlatform: () => 'ios', nativePromise: async () => { throw new Error('A share sheet is already open.'); }, PluginHeaders: headers(['shareFile']) });
    vi.stubGlobal('navigator', { canShare: () => true, share: vi.fn() });
    await expect(shareFile('a.ghostset', blob(), 'application/json')).rejects.toThrow(/already open/);
  });
});

describe('haptics', () => {
  it('fires on builds that have the method and stays silent elsewhere', async () => {
    resetHapticsProbe();
    const nativePromise = vi.fn(async () => ({}));
    vi.stubGlobal('Capacitor', { getPlatform: () => 'ios', nativePromise, PluginHeaders: [{ name: 'StudioCapture', methods: [{ name: 'haptic' }] }] });
    haptic('selection');
    expect(nativePromise).toHaveBeenCalledWith('StudioCapture', 'haptic', { type: 'selection' });
    nativePromise.mockClear();
    vi.stubGlobal('Capacitor', { getPlatform: () => 'ios', nativePromise, PluginHeaders: [{ name: 'StudioCapture', methods: [] }] });
    haptic('light');
    vi.stubGlobal('Capacitor', { getPlatform: () => 'web', nativePromise });
    haptic('light');
    vi.stubGlobal('Capacitor', undefined);
    expect(() => haptic('light')).not.toThrow();
    expect(nativePromise).not.toHaveBeenCalled();
  });
  it('stops asking once an older build has said the method does not exist', async () => {
    resetHapticsProbe();
    const nativePromise = vi.fn(async () => { throw Object.assign(new Error('not implemented'), { code: 'UNIMPLEMENTED' }); });
    vi.stubGlobal('Capacitor', { getPlatform: () => 'ios', nativePromise });
    haptic('light');
    await new Promise(resolve => setTimeout(resolve, 0));
    haptic('light'); haptic('heavy');
    expect(nativePromise).toHaveBeenCalledTimes(1);
    resetHapticsProbe();
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

describe('large files and iOS Settings', () => {
  it('encodes a file larger than one slice exactly like a single pass', async () => {
    const { blobToBase64 } = await import('./nativeShare');
    const bytes = Uint8Array.from({ length: 3 * 0x80000 + 12345 }, (_, i) => (i * 7 + 3) % 256);
    const encoded = await blobToBase64(new Blob([bytes]));
    expect(encoded.length).toBe(Math.ceil(bytes.length / 3) * 4);
    const decoded = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
    expect(decoded.length).toBe(bytes.length);
    expect(decoded.every((v, i) => v === bytes[i])).toBe(true);
    expect(await blobToBase64(new Blob([]))).toBe('');
  });
  it('offers Open Settings only where the app build can do it', async () => {
    const { canOpenAppSettings, openAppSettings, mentionsSettings } = await import('./nativeShare');
    const g = globalThis as { Capacitor?: unknown };
    const before = g.Capacitor;
    try {
      delete g.Capacitor;
      expect(canOpenAppSettings()).toBe(false);
      expect(await openAppSettings()).toBe(false);
      const calls: string[] = [];
      g.Capacitor = { getPlatform: () => 'ios', nativePromise: async (_p: string, m: string) => { calls.push(m); return {}; }, PluginHeaders: [{ name: 'StudioCapture', methods: [{ name: 'openAppSettings' }] }] };
      expect(canOpenAppSettings()).toBe(true);
      expect(await openAppSettings()).toBe(true);
      expect(calls).toEqual(['openAppSettings']);
      g.Capacitor = { getPlatform: () => 'ios', nativePromise: async () => ({}), PluginHeaders: [{ name: 'StudioCapture', methods: [{ name: 'haptic' }] }] };
      expect(canOpenAppSettings()).toBe(false);
    } finally { g.Capacitor = before; }
    expect(mentionsSettings('Camera access was denied. Enable it in iOS Settings.')).toBe(true);
    expect(mentionsSettings('Camera access is disabled in iOS Settings.')).toBe(true);
    expect(mentionsSettings('Microphone access was not available. Check microphone permission in Settings.')).toBe(true);
    expect(mentionsSettings('Could not launch this clip.')).toBe(false);
    expect(mentionsSettings('Open Output settings in the header.')).toBe(false);
  });
});
