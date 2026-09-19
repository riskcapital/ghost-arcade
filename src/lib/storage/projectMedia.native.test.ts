import { afterAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { scanProjectMedia, relinkProjectMedia, collectProjectMedia } = require('../../../electron/project-media.cjs');
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
  it('never overwrites a project or silently collects missing/session media', async () => {
    const target = path.join(root, 'existing.gha'); await fs.writeFile(target, 'keep');
    await expect(collectProjectMedia({}, root, target)).rejects.toThrow('not be overwritten');
    expect(await fs.readFile(target, 'utf8')).toBe('keep');
    for (const data of [{ a: { src: 'blob:gone', name: 'Unsaved clip' } }, { a: { _assetRef: { name: 'Lost clip' } } }]) {
      expect((await scanProjectMedia(data, root))[0].missing).toBe(true);
      await expect(collectProjectMedia(data, root, path.join(root, 'missing.gha'))).rejects.toThrow('Locate missing');
    }
  });
  it('does not treat generators, network inputs, embedded media or inline model JSON as files', async () => {
    expect(await scanProjectMedia({ a: { src: 'builtin:grid' }, b: { src: 'live://camera/1' }, c: { _assetRef: { dataUrl: 'data:image/png;base64,AA==' } }, d: { src: 'https://example.com/movie.mp4' }, e: { modelData: '{"vertices":[]}' } }, root)).toEqual([]);
  });
  it('refuses models with uncollected external dependencies', async () => {
    const model = path.join(root, 'model.gltf'); await fs.writeFile(model, '{}');
    await expect(collectProjectMedia({ a: { _assetRef: { originalPath: model } } }, root, path.join(root, 'model.gha'))).rejects.toThrow('external dependencies');
  });
});
