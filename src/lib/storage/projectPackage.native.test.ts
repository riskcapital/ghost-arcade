import { afterAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { exportProjectPackage, unpackProjectPackage } = require('../../../electron/project-package.cjs');
const { prepareProjectMediaForOpen } = require('../../../electron/project-media.cjs');

// A show packed into one .zip opens anywhere: the project at the top, its
// media in Media/, every reference relative.
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ghost-package-'));
afterAll(() => fs.rm(root, { recursive: true, force: true }));
const write = async (file: string, text: string) => { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, text); };
const systemUnzipOk = (zip: string) => {
  try { execFileSync('unzip', ['-tq', zip], { stdio: 'pipe' }); return true; } catch (e: any) { if (e.code === 'ENOENT') return true; throw new Error(String(e.stdout || e.message)); }
};

async function show() {
  const media = path.join(root, 'source');
  await write(path.join(media, 'clip.mov'), 'video bytes '.repeat(1000));
  await write(path.join(media, 'other', 'clip.mov'), 'a different clip');
  await write(path.join(media, 'logo.png'), 'png');
  await write(path.join(media, 'model', 'robot.gltf'), JSON.stringify({ buffers: [{ uri: 'robot.bin' }] }));
  await write(path.join(media, 'model', 'robot.bin'), 'bin');
  return {
    name: 'Tour',
    layers: [
      { source: { src: '', _assetRef: { originalPath: path.join(media, 'clip.mov') } } },
      { source: { src: '', _assetRef: { originalPath: path.join(media, 'other', 'clip.mov') } } },
      { source: { src: 'file://' + path.join(media, 'logo.png') } },
      { model3dContent: { _assetRef: { originalPath: path.join(media, 'model', 'robot.gltf') } } },
      { source: { _assetRef: { originalPath: path.join(media, 'gone.mov'), name: 'gone.mov' } } },
      { textContent: { fontFamily: '"Bebas Neue", sans-serif' } },
    ],
    vj: { decks: [{ _assetRef: { originalPath: path.join(media, 'clip.mov') } }] },
  };
}

describe('project packages', () => {
  it('packs the project and its media, and opens unpacked in a new place', async () => {
    const data: any = await show();
    const zip = path.join(root, 'out', 'Tour.zip');
    await fs.mkdir(path.dirname(zip), { recursive: true });
    const progress: number[] = [];
    const result = await exportProjectPackage(data, root, zip, { projectName: 'Tour', onProgress: (p: any) => progress.push(p.done / p.total) });
    expect(result.files).toBe(5);
    expect(result.missing).toEqual(['gone.mov']);
    expect(result.fonts).toEqual(['Bebas Neue']);
    expect(progress.at(-1)).toBe(1);
    expect(systemUnzipOk(zip)).toBe(true);
    await expect(fs.stat(zip + '.partial')).rejects.toThrow();

    const elsewhere = path.join(root, 'elsewhere');
    await fs.mkdir(elsewhere);
    const { folder, projectPath } = await unpackProjectPackage(zip, elsewhere);
    expect(projectPath).toBe(path.join(elsewhere, 'Tour', 'Tour.gha'));
    const opened = JSON.parse(await fs.readFile(projectPath, 'utf8'));
    expect(opened.layers[0].source._assetRef).toEqual(expect.objectContaining({ projectPath: './Media/clip.mov' }));
    expect(opened.layers[0].source._assetRef).not.toHaveProperty('originalPath');
    expect(opened.layers[1].source._assetRef.projectPath).toBe('./Media/clip (2).mov');
    expect(opened.layers[3].model3dContent._assetRef.projectPath).toBe('./Media/robot/robot.gltf');
    expect(await fs.readFile(path.join(folder, 'Media', 'robot', 'robot.bin'), 'utf8')).toBe('bin');
    expect(await fs.readFile(path.join(folder, 'Media', 'clip (2).mov'), 'utf8')).toBe('a different clip');
    const media = await prepareProjectMediaForOpen(opened, folder);
    expect(media.missing).toEqual(['gone.mov']);
    // A plain src field stays relative; the editor resolves it against the project folder.
    expect(opened.layers[2].source.src).toBe('./Media/logo.png');
    expect(await fs.readFile(path.join(folder, 'Media', 'logo.png'), 'utf8')).toBe('png');
    // A second unpack beside the first gets its own folder.
    expect((await unpackProjectPackage(zip, elsewhere)).folder).toBe(path.join(elsewhere, 'Tour 2'));
  });

  it('writes ZIP64 records that unzip tools and the unpacker read', async () => {
    const data: any = await show();
    const zip = path.join(root, 'zip64', 'Big.zip');
    await fs.mkdir(path.dirname(zip), { recursive: true });
    // Every size and offset past 16 bytes takes the ZIP64 path.
    await exportProjectPackage(data, root, zip, { zip64Threshold: 16 });
    expect(systemUnzipOk(zip)).toBe(true);
    const { folder } = await unpackProjectPackage(zip, path.dirname(zip));
    expect(await fs.readFile(path.join(folder, 'Media', 'clip.mov'), 'utf8')).toBe('video bytes '.repeat(1000));
  });

  it('cancels without leaving a file behind', async () => {
    const data: any = await show();
    const zip = path.join(root, 'cancel', 'Show.zip');
    await fs.mkdir(path.dirname(zip), { recursive: true });
    const controller = new AbortController();
    controller.abort();
    await expect(exportProjectPackage(data, root, zip, { signal: controller.signal })).rejects.toThrow('cancelled');
    expect(await fs.readdir(path.dirname(zip))).toEqual([]);
  });

  it('opens a zip made by hand from a show folder, and refuses one without a project', async () => {
    const folder = path.join(root, 'byhand', 'My Show');
    await write(path.join(folder, 'My Show.gha'), '{}');
    const zip = path.join(root, 'byhand', 'My Show.zip');
    try { execFileSync('zip', ['-rq', zip, 'My Show'], { cwd: path.dirname(folder) }); } catch { return; }
    const target = path.join(root, 'byhand', 'open');
    await fs.mkdir(target);
    expect((await unpackProjectPackage(zip, target)).projectPath).toBe(path.join(target, 'My Show', 'My Show', 'My Show.gha'));
    const empty = path.join(root, 'byhand', 'empty.zip');
    await write(path.join(root, 'byhand', 'notes.txt'), 'x');
    execFileSync('zip', ['-q', empty, 'notes.txt'], { cwd: path.join(root, 'byhand') });
    await expect(unpackProjectPackage(empty, target)).rejects.toThrow('no Ghost Arcade project');
    await expect(fs.stat(path.join(target, 'empty'))).rejects.toThrow();
  });
});
