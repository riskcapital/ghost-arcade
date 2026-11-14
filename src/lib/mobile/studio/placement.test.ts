import { describe, expect, it } from 'vitest';
import { defaultShow, normalizeShow, newSurface, gridPoints, duplicateSet, MAX_SAVED_SETS, type Show } from './model';
import { WHOLE_PICTURE, isWholePicture, normalizePlacement, placementControls, withControl, sameSourceSurfaces, spanPlacements, sameOnSurfaces } from './placement';
import { packSet, unpackSet } from './setBundle';
import { applyTemplate } from './templates';
import { findTemplate } from './stageScenes';

function mapped(): Show {
  const show = defaultShow();
  show.mapping = true;
  show.surfaces = [
    { ...newSurface(0), points: gridPoints(0, 0, 0.5, 1) },
    { ...newSurface(1), points: gridPoints(0.5, 0, 0.5, 1) },
    { ...newSurface(2), points: gridPoints(0.2, 0.2, 0.2, 0.2), source: 1 },
  ];
  return show;
}

describe('picture placement in a surface', () => {
  it('loads old surfaces without a placement and keeps a saved one, made safe', () => {
    const old = normalizeShow(JSON.parse(JSON.stringify(mapped())));
    expect(old.surfaces.every((s) => !('placement' in s))).toBe(true);
    const show = mapped();
    show.surfaces[0].placement = { x: 0.3, y: 0.6, w: 0.5, h: 0.4, angle: 0.2 };
    show.surfaces[1].placement = { x: Infinity, y: 'no', w: 999, h: -2, angle: 50 } as never;
    const loaded = normalizeShow(JSON.parse(JSON.stringify(show)));
    expect(loaded.surfaces[0].placement).toEqual({ x: 0.3, y: 0.6, w: 0.5, h: 0.4, angle: 0.2 });
    expect(loaded.surfaces[1].placement).toEqual({ x: 0.5, y: 0.5, w: 8, h: 0.05, angle: Math.PI });
    expect(normalizePlacement(null)).toBeUndefined();
  });
  it('zooms keeping the shape of the region, moves and turns', () => {
    let p = withControl(undefined, 'zoom', 2);
    expect(p).toMatchObject({ w: 0.5, h: 0.5, x: 0.5, y: 0.5 });
    p = withControl({ ...WHOLE_PICTURE, w: 0.5, h: 0.25 }, 'zoom', 4);
    expect(p.w).toBeCloseTo(0.25);
    expect(p.h).toBeCloseTo(0.125);
    p = withControl(p, 'x', 0.2);
    p = withControl(p, 'degrees', 90);
    expect(p.x).toBe(0.2);
    expect(p.angle).toBeCloseTo(Math.PI / 2);
    expect(placementControls(p)).toMatchObject({ zoom: 4, x: 0.2, degrees: 90 });
    expect(isWholePicture(undefined)).toBe(true);
    expect(isWholePicture(p)).toBe(false);
  });
  it('spans one picture across the surfaces that show it', () => {
    const show = mapped();
    const sharing = sameSourceSurfaces(show.surfaces, 0);
    expect(sharing).toEqual([0, 1]);
    const spanned = spanPlacements(show.surfaces, sharing);
    expect(spanned[0].placement).toEqual({ x: 0.25, y: 0.5, w: 0.5, h: 1, angle: 0 });
    expect(spanned[1].placement).toEqual({ x: 0.75, y: 0.5, w: 0.5, h: 1, angle: 0 });
    expect(spanned[2]).toBe(show.surfaces[2]);
  });
  it('puts the same picture on every surface, clip or deck source', () => {
    const show = mapped();
    const clipId = show.clips[0].id;
    show.surfaces[2].clipId = clipId;
    const same = sameOnSurfaces(show, 2, [0, 1, 2]);
    expect(same.map((s) => s.clipId)).toEqual([clipId, clipId, clipId]);
    expect(sameSourceSurfaces(same, 0)).toEqual([0, 1, 2]);
    const deck = sameOnSurfaces({ surfaces: same.map((s, i) => (i === 0 ? { ...s, clipId: undefined, source: 'mix' as const } : s)) }, 0, [1, 2]);
    expect(deck.every((s) => !s.clipId && s.source === 'mix')).toBe(true);
  });
});

describe('set library', () => {
  it('duplicates a set beside the original with a new id and a free name', () => {
    const a = { ...defaultShow(), name: 'House' };
    const b = { ...defaultShow(), name: 'Booth' };
    let { bank, copy } = duplicateSet([a, b], a);
    expect(bank.map((s) => s.name)).toEqual(['House', 'House copy', 'Booth']);
    expect(copy!.id).not.toBe(a.id);
    expect(copy!.surfaces).toEqual(a.surfaces);
    ({ bank } = duplicateSet(bank, bank[1]));
    expect(bank.map((s) => s.name)).toEqual(['House', 'House copy', 'House copy 2', 'Booth']);
    const full = Array.from({ length: MAX_SAVED_SETS }, () => defaultShow());
    expect(duplicateSet(full, full[0])).toMatchObject({ full: true, bank: full });
  });
  it('exports and opens a mapped set whole: surface clips, placement and stage travel in the file', async () => {
    const show = applyTemplate(defaultShow(true), findTemplate('facade')!);
    show.surfaces[0].placement = { x: 0.4, y: 0.5, w: 0.6, h: 0.6, angle: 0.1 };
    show.clips.push({ id: 'photo', kind: 'image', assetId: 'asset-photo', name: 'Wall.jpg' });
    show.surfaces[1].clipId = 'photo';
    const store = new Map([['asset-photo', new Blob(['jpeg bytes'], { type: 'image/jpeg' })]]);
    const packed = await packSet(show, async (id) => store.get(id));
    expect(packed.files).toBe(1);
    const opened = await unpackSet(packed.blob);
    const loaded = normalizeShow(opened.show);
    expect(loaded.stage).toBe('facade');
    expect(loaded.surfaces.map((s) => s.clipId)).toEqual(show.surfaces.map((s) => s.clipId));
    expect(loaded.surfaces[0].placement).toEqual(show.surfaces[0].placement);
    expect(opened.media.map((m) => m.id)).toEqual(['asset-photo']);
  });
});
