import { describe, expect, it } from 'vitest';
import { defaultShow, normalizeShow, type Show } from './model';
import { BUNDLE_MAGIC, BundleTooLarge, packSet, setAssetIds, setMediaSize, unpackSet } from './setBundle';
import { blobToBase64 } from './nativeShare';

const bytes = (n: number, seed: number) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed) % 256);
function setWithMedia(): { show: Show; store: Map<string, Blob> } {
  const show = defaultShow();
  show.name = 'Friday rig';
  show.clips = [...show.clips, { id: 'v1', assetId: 'v1', name: 'Loop.mp4', kind: 'video' }, { id: 'p1', assetId: 'p1', name: 'Logo.png', kind: 'image' }, { id: 's1', kind: 'shader', shaderId: show.clips[0].shaderId, assetId: 'p1', name: 'Shader with the logo' }];
  show.launchGrid[1][0] = 'v1';
  const store = new Map<string, Blob>([['v1', new Blob([bytes(70000, 3)], { type: 'video/mp4' })], ['p1', new Blob([bytes(1234, 9)], { type: 'image/png' })], ['other', new Blob([bytes(10, 1)])]]);
  return { show, store };
}
const same = async (a: Blob, b: Blob) => {
  const x = new Uint8Array(await a.arrayBuffer()), y = new Uint8Array(await b.arrayBuffer());
  return x.length === y.length && x.every((v, i) => v === y[i]);
};
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

describe('set with media in one file', () => {
  it('lists each file a set uses once', () => {
    const { show } = setWithMedia();
    expect(setAssetIds(show)).toEqual(['v1', 'p1']);
    expect(setMediaSize(show, [{ id: 'v1', bytes: 70000 }, { id: 'p1', bytes: 1234 }, { id: 'other', bytes: 10 }])).toEqual({ files: 2, bytes: 71234 });
  });
  it('round-trips the set and every byte of its media', async () => {
    const { show, store } = setWithMedia();
    const packed = await packSet(show, async (id) => store.get(id));
    expect(packed.files).toBe(2);
    expect(packed.mediaBytes).toBe(71234);
    expect(packed.missing).toEqual([]);
    expect(new TextDecoder().decode(await packed.blob.slice(0, 8).arrayBuffer())).toBe(BUNDLE_MAGIC);
    const opened = await unpackSet(packed.blob);
    expect(opened.bundled).toBe(true);
    expect(normalizeShow(opened.show)).toEqual(normalizeShow(JSON.parse(JSON.stringify(show))));
    expect(opened.media.map((m) => [m.id, m.blob.type, m.blob.size])).toEqual([['v1', 'video/mp4', 70000], ['p1', 'image/png', 1234]]);
    expect(await same(opened.media[0].blob, store.get('v1')!)).toBe(true);
    expect(await same(opened.media[1].blob, store.get('p1')!)).toBe(true);
  });
  it('survives the trip through the share sheet (base64 and back)', async () => {
    const { show, store } = setWithMedia();
    const packed = await packSet(show, async (id) => store.get(id));
    const wire = await blobToBase64(packed.blob);
    const opened = await unpackSet(new Blob([fromBase64(wire)]));
    expect(await same(opened.media[0].blob, store.get('v1')!)).toBe(true);
    expect((opened.show as Show).name).toBe('Friday rig');
  });
  it('still opens a plain set file, with no media', async () => {
    const { show } = setWithMedia();
    const opened = await unpackSet(new Blob([JSON.stringify(show, null, 2)], { type: 'application/json' }));
    expect(opened.bundled).toBe(false);
    expect(opened.media).toEqual([]);
    expect((opened.show as Show).id).toBe(show.id);
  });
  it('exports a set whose media has gone, and says which', async () => {
    const { show, store } = setWithMedia();
    store.delete('p1');
    const packed = await packSet(show, async (id) => store.get(id));
    expect(packed.files).toBe(1);
    expect(packed.missing).toEqual(['p1']);
    expect((await unpackSet(packed.blob)).missing).toEqual(['p1']);
  });
  it('refuses media over the limit before building the file', async () => {
    const { show, store } = setWithMedia();
    await expect(packSet(show, async (id) => store.get(id), 50000)).rejects.toBeInstanceOf(BundleTooLarge);
  });
  it('rejects damaged files in plain words', async () => {
    const { show, store } = setWithMedia();
    const packed = await packSet(show, async (id) => store.get(id));
    await expect(unpackSet(packed.blob.slice(0, packed.blob.size - 500))).rejects.toThrow('This set file is damaged or incomplete.');
    await expect(unpackSet(packed.blob.slice(0, 10))).rejects.toThrow('damaged');
    await expect(unpackSet(new Blob(['hello']))).rejects.toThrow('This is not a Ghost Arcade mobile set.');
  });
});
