import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { engineScanFromPath, engineVoiceLayer, normalizeEngineScan } from './engineVoices';
// @ts-expect-error The Electron broker is authored as ESM JavaScript; this test exercises it directly.
import { guardGraphLayerReadPaths } from '../../../electron/native-renderer-broker.js';

/**
 * A cloud voice's .ply pick, end to end in the app's own code: the real
 * `open_project_dialog` handler from electron/main.js (only the OS dialog's
 * answer is faked), the main process's grant, the voice's saved scan, the
 * path the core is sent (as the packaged app resolves it, under Electron),
 * and the broker's read-path guard.
 */
const require = createRequire(import.meta.url);
const { createPathGrants } = require(join(process.cwd(), 'electron', 'path-grants.cjs'));
const mainSource = readFileSync(join(process.cwd(), 'electron', 'main.js'), 'utf8');

function registerHandler(name: string, deps: Record<string, unknown>) {
  const start = mainSource.indexOf(`  ipcMain.handle('${name}'`);
  const end = mainSource.indexOf('\n  });\n', start) + '\n  });\n'.length;
  const handlers = new Map<string, (...a: unknown[]) => unknown>();
  const ipcMain = { handle: (n: string, fn: (...a: unknown[]) => unknown) => handlers.set(n, fn) };
  new Function('ipcMain', ...Object.keys(deps), mainSource.slice(start, end))(ipcMain, ...Object.values(deps));
  return handlers.get(name)!;
}

let cloudScanPath: typeof import('../sync/nativeRendererSync').cloudScanPath;
// The renderer as the packaged app runs it: under Electron (ghost-asset:// URLs).
const win: Record<string, unknown> = { __ELECTRON__: true, addEventListener: () => {}, removeEventListener: () => {}, matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }) };
beforeAll(async () => {
  const storage = new Map<string, string>();
  const define = (name: string, value: unknown) => Object.defineProperty(globalThis, name, { configurable: true, value });
  define('localStorage', { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v), removeItem: (k: string) => storage.delete(k), clear: () => storage.clear() });
  define('document', { documentElement: { style: { setProperty: () => {} } } });
  define('window', win);
  ({ cloudScanPath } = await import('../sync/nativeRendererSync'));
});

describe('picking a scan for a cloud voice', () => {
  let dir = '';
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('reaches the core as the picked file, granted, under Electron', async () => {
    dir = mkdtempSync(join(tmpdir(), 'scan pick '));
    const ply = join(dir, 'my scan #1.ply');
    writeFileSync(ply, 'ply\n');
    const pathGrants = createPathGrants({ assetDirs: [] });
    let asked: Record<string, any> | null = null;
    const dialog = { showOpenDialog: async (_w: unknown, opts: Record<string, any>) => { asked = opts; return { canceled: false, filePaths: [ply] }; } };
    const handler = registerHandler('open_project_dialog', { dialog, pathGrants, mainWindow: {}, BrowserWindow: { getFocusedWindow: () => null } });
    const r = (await handler({}, { title: 'Point cloud scan', filters: [{ name: 'Point cloud (.ply)', extensions: ['ply'] }] })) as { canceled: boolean; filePath: string };
    expect(asked!.filters[0].extensions).toEqual(['ply']);
    expect(r).toEqual({ canceled: false, filePath: ply });
    expect(pathGrants.canRead(ply)).toBe(true);

    const scan = normalizeEngineScan(JSON.parse(JSON.stringify(engineScanFromPath(r.filePath))));
    expect(scan?.name).toBe('my scan #1.ply');
    const layer = engineVoiceLayer('v', 'engine:cloud-pulse', {}, 'all', scan) as any;
    const sent = cloudScanPath(layer.gpuLayerContent?.params?.path ?? scan);
    expect(sent).toBe(ply);

    const cmd = { type: 'set_native_graph_layer', params: { path: sent } };
    guardGraphLayerReadPaths(cmd, (p: string) => pathGrants.canRead(p));
    expect(cmd.params.path).toBe(ply);
  });

  it('a path nobody granted is refused as a failed load, not the default scan', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cmd = { type: 'set_native_graph_layer', params: { path: '/home/someone/secret.ply' } };
    guardGraphLayerReadPaths(cmd, () => false);
    expect(cmd.params.path).not.toBe('/home/someone/secret.ply');
    expect(cmd.params.path).not.toBe('');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('reads the app\'s ghost-asset URLs as paths', () => {
    expect(cloudScanPath('ghost-asset://localhost/Users/me/a%20b.ply')).toBe('/Users/me/a b.ply');
  });
});
