import { afterAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Finding clip files that moved. The renderer may ask which of its own media
 * files still exist, and may search a folder only by having the main process
 * show the folder dialog (electron/media-locate.cjs).
 */
const require = createRequire(import.meta.url);
const electronDir = join(process.cwd(), 'electron');
const { mediaFilesStatus, findMediaInFolder } = require(join(electronDir, 'media-locate.cjs'));

const root = mkdtempSync(join(tmpdir(), 'ga-locate-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const put = (...parts: string[]) => {
  const file = join(root, ...parts);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, 'x');
  return file;
};

describe('locating media files', () => {
  it('says which files exist, and that a folder is not a file', async () => {
    const here = put('status', 'a.mov');
    const gone = join(root, 'status', 'gone.mov');
    expect(await mediaFilesStatus([here, gone, join(root, 'status'), 'relative.mov', 42])).toEqual({
      [here]: true, [gone]: false, [join(root, 'status')]: false,
    });
  });

  it('finds files by name in subfolders, without case, nearest first', async () => {
    const top = put('pack', 'One.mov');
    put('pack', 'deep', 'a', 'one.mov');
    const nested = put('pack', 'deep', 'a', 'b', 'Two.mov');
    put('pack', '.hidden', 'three.mov');
    const found = await findMediaInFolder(join(root, 'pack'), ['one.mov', 'two.mov', 'three.mov', '../escape.mov', 7]);
    expect(found).toEqual({ 'one.mov': top, 'two.mov': nested });
  });

  it('is only reachable through the checked handlers', () => {
    const main = readFileSync(join(electronDir, 'main.js'), 'utf8');
    const status = main.slice(main.indexOf("ipcMain.handle('media_files_status'"));
    expect(status.slice(0, 400)).toContain('pathGrants.canRead');
    const find = main.slice(main.indexOf("ipcMain.handle('media_find_in_folder'"));
    // The folder comes from a dialog, never from the renderer.
    expect(find.slice(0, 700)).toContain('dialog.showOpenDialog');
    expect(find.slice(0, 900)).not.toMatch(/args\??\.dir/);
    const preload = readFileSync(join(electronDir, 'preload.cjs'), 'utf8');
    expect(preload).toContain("'media_files_status', 'media_find_in_folder'");
  });
});
