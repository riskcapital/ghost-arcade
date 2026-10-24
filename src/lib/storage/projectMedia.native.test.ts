import { afterAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { scanProjectMedia, relinkProjectMedia, relinkMissingInFolder, collectProjectMedia, prepareProjectMediaForOpen, makeProjectPortable } = require('../../../electron/project-media.cjs');
const { findMediaInFolder } = require('../../../electron/media-locate.cjs');
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ghost-project-media-'));
afterAll(() => fs.rm(root, { recursive: true, force: true }));
const source = path.join(root, 'clip.mov'); await fs.writeFile(source, 'video fixture');
const ref = () => ({ kind: 'local-file', originalPath: source, name: 'clip.mov' });
describe('project media management', () => {
  it('deduplicates references across layers, decks, compositions and presets', async () => {
    const data = { layers: [{ src: 'blob:session', _assetRef: ref() }], vj: { decks: [{ _assetRef: ref() }] }, compositions: [{ layers: [{ _assetRef: ref() }] }] };
    const scan = await scanProjectMedia(data);
    expect(scan).toHaveLength(1); expect(scan[0]).toMatchObject({ missing: false, uses: 3, size: 13 });
  });
  it('falls back to the original when a portable copy is missing, and lists foreign paths as missing', async () => {
    const scan = await scanProjectMedia({ a: { _assetRef: { ...ref(), projectPath: './gone.mov' } }, b: { _assetRef: { originalPath: 'Z:\\Show\\gone.mov' } } }, root);
    expect(scan[0].path).toBe(source); expect(scan[0].missing).toBe(false); expect(scan[1].missing).toBe(true);
  });
  it('relinks every use and clears stale portable locations', async () => {
    const data = { a: { _assetRef: { ...ref(), projectPath: './gone.mov' } }, b: { _assetRef: { ...ref(), projectPath: './gone.mov' } } };
    const scan = await scanProjectMedia(data, path.join(root, 'show'));
    await relinkProjectMedia(data, path.join(root, 'show'), scan[0].id, source);
    expect(data.a._assetRef).not.toHaveProperty('projectPath'); expect(data.b._assetRef).toEqual(data.a._assetRef);
    await expect(relinkProjectMedia(data, root, scan[0].id, source)).rejects.toThrow('changed');
  });
  it('keeps a relink inside the project folder portable', async () => {
    const data = { a: { _assetRef: { originalPath: '/missing/clip.mov' } } };
    const scan = await scanProjectMedia(data, root);
    await relinkProjectMedia(data, root, scan[0].id, source);
    expect(data.a._assetRef).toMatchObject({ kind: 'project-file', projectPath: './clip.mov' });
  });
  it('collects duplicates once and reopens after moving the project and media folder', async () => {
    const destination = path.join(root, 'portable', 'Show.gha');
    const data = { layers: [{ src: 'blob:old', _assetRef: ref() }], decks: [{ _assetRef: ref() }], old: { src: source } };
    const result = await collectProjectMedia(data, root, destination);
    expect(result.filesCopied).toBe(1);
    const moved = path.join(root, 'moved'); await fs.rename(path.dirname(destination), moved);
    const restored = JSON.parse(await fs.readFile(path.join(moved, 'Show.gha'), 'utf8'));
    expect(restored.layers[0]._assetRef).not.toHaveProperty('originalPath');
    const scan = await scanProjectMedia(restored, moved);
    expect(scan.every((entry: any) => !entry.missing && entry.path.startsWith(moved))).toBe(true);
    expect(await fs.readFile(scan[0].path, 'utf8')).toBe('video fixture');
  });
  it('never overwrites a project, and lists missing and session media instead of packing them', async () => {
    const target = path.join(root, 'existing.gha'); await fs.writeFile(target, 'keep');
    await expect(collectProjectMedia({}, root, target)).rejects.toThrow('not be overwritten');
    expect(await fs.readFile(target, 'utf8')).toBe('keep');
    for (const [i, data] of [{ a: { src: 'blob:gone', name: 'Unsaved clip' } }, { a: { _assetRef: { name: 'Lost clip' } } }].entries()) {
      expect((await scanProjectMedia(data, root))[0].missing).toBe(true);
      const result = await collectProjectMedia(data, root, path.join(root, `missing-${i}`, 'missing.gha'));
      expect(result.filesCopied).toBe(0);
      expect(result.missing).toHaveLength(1);
    }
  });
  it('does not treat generators, network inputs, embedded media or inline model JSON as files', async () => {
    expect(await scanProjectMedia({ a: { src: 'builtin:grid' }, b: { src: 'live://camera/1' }, c: { _assetRef: { dataUrl: 'data:image/png;base64,AA==' } }, d: { src: 'https://example.com/movie.mp4' }, e: { modelData: '{"vertices":[]}' } }, root)).toEqual([]);
  });
  it('collects a model with the files it loads from beside it', async () => {
    const dir = path.join(root, 'robot'); await fs.mkdir(path.join(dir, 'tex'), { recursive: true });
    const model = path.join(dir, 'robot.gltf');
    await fs.writeFile(model, JSON.stringify({ buffers: [{ uri: 'robot.bin' }], images: [{ uri: 'tex/skin%20one.png' }, { uri: 'data:image/png;base64,AA==' }, { uri: '../shared.png' }] }));
    await fs.writeFile(path.join(dir, 'robot.bin'), 'bin'); await fs.writeFile(path.join(dir, 'tex', 'skin one.png'), 'png');
    const data = { a: { _assetRef: { originalPath: model } } };
    const result = await collectProjectMedia(data, root, path.join(root, 'model-out', 'model.gha'));
    expect(result.filesCopied).toBe(3);
    expect(data.a._assetRef).toMatchObject({ projectPath: './Media/robot/robot.gltf' });
    expect(await fs.readFile(path.join(root, 'model-out', 'Media', 'robot', 'tex', 'skin one.png'), 'utf8')).toBe('png');
    expect(result.missing).toEqual(['../shared.png (outside the folder of robot.gltf)']);
  });
});

describe('project media that survives a move', () => {
  const show = path.join(root, 'trip');
  const write = async (file: string, text = 'media') => { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, text); };
  it('saves where each file is from the project, inside and just above its folder', async () => {
    const inside = path.join(show, 'Show', 'Media', 'a.mov');
    const above = path.join(show, 'Footage', 'b.mov');
    const data = { a: { _assetRef: { originalPath: inside } }, b: { _assetRef: { originalPath: above } }, c: { _assetRef: { originalPath: path.join(path.parse(show).root, 'elsewhere', 'c.mov') } }, d: { _assetRef: { originalPath: 'C:\\Show\\d.mov', projectPath: './stale.mov' } } };
    makeProjectPortable(data, path.join(show, 'Show'));
    expect(data.a._assetRef).toMatchObject({ projectPath: './Media/a.mov', originalPath: inside });
    expect(data.b._assetRef).toMatchObject({ relativePath: '../Footage/b.mov' });
    expect(data.b._assetRef).not.toHaveProperty('projectPath');
    // Far above the folder (here, at the top of the disk): only the absolute
    // location is kept.
    expect(data.c._assetRef).not.toHaveProperty('relativePath');
    expect(data.c._assetRef).not.toHaveProperty('projectPath');
    // A path from another computer is left as it was saved.
    expect(data.d._assetRef.projectPath).toBe('./stale.mov');
  });
  it('opens after the whole show folder moved, and after the media moved inside it', async () => {
    const original = path.join(show, 'Show');
    await write(path.join(original, 'Media', 'a.mov'));
    await write(path.join(show, 'Footage', 'b.mov'));
    const data = { layers: [{ src: '', _assetRef: { originalPath: path.join(original, 'Media', 'a.mov') } }], decks: [{ _assetRef: { originalPath: path.join(show, 'Footage', 'b.mov') } }] };
    makeProjectPortable(data, original);
    const saved = JSON.parse(JSON.stringify(data));
    // Copy to "another computer": a new parent, old paths gone.
    const moved = path.join(root, 'other-machine');
    await fs.rename(show, moved);
    const reopened = JSON.parse(JSON.stringify(saved));
    const result = await prepareProjectMediaForOpen(reopened, path.join(moved, 'Show'));
    expect(result.missing).toEqual([]);
    expect(reopened.layers[0]._assetRef.originalPath).toBe(path.join(moved, 'Show', 'Media', 'a.mov'));
    expect(reopened.decks[0]._assetRef.originalPath).toBe(path.join(moved, 'Footage', 'b.mov'));
    // Found refs keep one place; the next save writes the relative ones again.
    expect(reopened.layers[0]._assetRef).not.toHaveProperty('projectPath');
    // A file moved to another folder inside the show is found by name.
    await fs.mkdir(path.join(moved, 'Show', 'Clips'), { recursive: true });
    await fs.rename(path.join(moved, 'Show', 'Media', 'a.mov'), path.join(moved, 'Show', 'Clips', 'a.mov'));
    const again = JSON.parse(JSON.stringify(saved));
    const second = await prepareProjectMediaForOpen(again, path.join(moved, 'Show'));
    expect(second.moved).toEqual(['a.mov']);
    expect(again.layers[0]._assetRef.originalPath).toBe(path.join(moved, 'Show', 'Clips', 'a.mov'));
    await fs.rename(moved, show);
  });
  it('lists what is missing and keeps an absolute place for it', async () => {
    const data: any = { a: { _assetRef: { projectPath: './Gone/lost.mov' } }, b: { src: 'ISF/builtin.fs' }, c: { src: 'performer' } };
    const result = await prepareProjectMediaForOpen(data, path.join(show, 'Show'));
    expect(result.missing).toEqual(['lost.mov']);
    expect(data.a._assetRef.originalPath).toBe(path.join(show, 'Show', 'Gone', 'lost.mov'));
    // Built-in shaders and source keywords are never missing media.
    expect(await scanProjectMedia({ b: { src: './ISF/builtin.fs' }, c: { src: 'performer' } }, root)).toEqual([]);
  });
  it('relinks every missing file in the folder of the one located', async () => {
    const folder = path.join(root, 'relocated');
    await write(path.join(folder, 'one.mov')); await write(path.join(folder, 'sub', 'two.png'));
    const data = { a: { _assetRef: { originalPath: '/old/one.mov' } }, b: { _assetRef: { originalPath: '/old/two.png' } }, c: { _assetRef: { originalPath: '/old/three.wav' } } };
    const scan = await scanProjectMedia(data, root);
    await relinkProjectMedia(data, root, scan[0].id, path.join(folder, 'one.mov'));
    const files = await relinkMissingInFolder(data, root, folder);
    expect(files).toEqual([path.join(folder, 'sub', 'two.png')]);
    expect(data.b._assetRef.originalPath).toBe(path.join(folder, 'sub', 'two.png'));
    expect(data.c._assetRef.originalPath).toBe('/old/three.wav');
  });
  it('matches names however their accents were stored', async () => {
    const folder = path.join(root, 'accents');
    await write(path.join(folder, 'Cafe\u0301.mov'));
    const found = await findMediaInFolder(folder, ['Caf\u00e9.mov']);
    expect(found['Caf\u00e9.mov']).toBe(path.join(folder, 'Cafe\u0301.mov'));
  });
});
