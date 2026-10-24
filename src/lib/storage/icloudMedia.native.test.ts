import { afterAll, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// Media that iCloud Drive has not downloaded: a stub where the file should
// be. The show has to say so and start the download, not report the file
// lost (older macOS) or stall reading it (macOS 14 and later).
const require = createRequire(import.meta.url);
const { prepareProjectMediaForOpen, scanProjectMedia } = require('../../../electron/project-media.cjs');
const { icloudState, requestIcloudDownloads } = require('../../../electron/media-locate.cjs');
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ghost-icloud-media-'));
afterAll(() => fs.rm(root, { recursive: true, force: true }));

const stat = (fields: { isFile?: boolean; size: number; blocks: number }) =>
  async () => ({ isFile: () => fields.isFile ?? true, size: fields.size, blocks: fields.blocks });

describe('media in iCloud', () => {
  it('knows a file that is there but not downloaded', async () => {
    const file = path.join(root, 'clip.mov');
    expect(await icloudState(file, { platform: 'darwin', statFn: stat({ size: 50_000_000, blocks: 0 }) })).toBe('dataless');
    expect(await icloudState(file, { platform: 'darwin', statFn: stat({ size: 50_000_000, blocks: 97_664 }) })).toBeNull();
    // Tiny files can be stored without blocks of their own.
    expect(await icloudState(file, { platform: 'darwin', statFn: stat({ size: 300, blocks: 0 }) })).toBeNull();
    // Only macOS keeps iCloud stubs.
    expect(await icloudState(file, { platform: 'win32', statFn: stat({ size: 50_000_000, blocks: 0 }) })).toBeNull();
    expect(await icloudState('relative/clip.mov', { platform: 'darwin', statFn: stat({ size: 50_000_000, blocks: 0 }) })).toBeNull();
  });

  it.runIf(process.platform === 'darwin')('opens a show whose file is only an older .icloud stub as downloading, not missing', async () => {
    const show = path.join(root, 'Show');
    await fs.mkdir(show, { recursive: true });
    await fs.writeFile(path.join(show, '.intro.mov.icloud'), 'stub');
    const data = { layers: [{ _assetRef: { kind: 'project-file', projectPath: './intro.mov', originalPath: '/Volumes/Gone/intro.mov', name: 'intro.mov' } }] };
    const result = await prepareProjectMediaForOpen(data, show);
    expect(result.missing).toEqual([]);
    expect(result.icloud).toEqual([{ name: 'intro.mov', file: path.join(show, 'intro.mov'), state: 'placeholder' }]);
    // The show points where the file will arrive.
    expect(data.layers[0]._assetRef.originalPath).toBe(path.join(show, 'intro.mov'));
    const scan = await scanProjectMedia(data, show);
    expect(scan[0]).toMatchObject({ missing: true, icloud: 'placeholder', path: path.join(show, 'intro.mov') });
  });

  it('starts each download without waiting for it', () => {
    const spawnFn = vi.fn();
    const started = requestIcloudDownloads([
      { file: '/Users/x/Show/a.mov', state: 'dataless' },
      { file: '/Users/x/Show/b.mov', state: 'placeholder' },
      { file: 'relative.mov', state: 'dataless' },
      { file: '/Users/x/Show/c.mov', state: 'other' },
    ], { spawnFn });
    expect(started).toEqual(['/Users/x/Show/a.mov', '/Users/x/Show/b.mov']);
    // A read of the first byte downloads a dataless file; no shell is involved.
    expect(spawnFn.mock.calls[0].slice(0, 2)).toEqual(['/usr/bin/head', ['-c', '1', '/Users/x/Show/a.mov']]);
    expect(spawnFn.mock.calls[1].slice(0, 2)).toEqual(['/usr/bin/brctl', ['download', '/Users/x/Show/b.mov']]);
  });
});
