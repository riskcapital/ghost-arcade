import { describe, expect, it } from 'vitest';
import { defaultShow, duplicateSet, normalizeShow, type Show } from './model';
import { packSet, unpackSet } from './setBundle';
import { BLEND_MODES } from './blendModes';

/** A set as app 1.1 saved it: five layer blends, surfaces with no opacity or blend. */
function setFrom11(): Show {
  const show = defaultShow();
  show.name = 'Club night';
  show.layers[0].blend = 'add';
  show.layers[1].blend = 'multiply';
  show.layers[2].blend = 'difference';
  show.mapping = true;
  show.surfaces = [show.surfaces[0], { ...show.surfaces[0], id: 'wall-2', name: 'Left wall', source: 1, feather: 0.1 }];
  show.scenes = [{ id: 'b1', name: 'Block 1', layers: show.layers.map((l) => ({ ...l, blend: 'screen' })), crossfade: 0 }];
  return JSON.parse(JSON.stringify(show));
}

describe('sets with blend modes', () => {
  it('open a set from app 1.1 exactly as saved: no new fields appear', () => {
    const saved = setFrom11();
    const opened = normalizeShow(saved);
    expect(opened.layers.map((l) => l.blend)).toEqual(saved.layers.map((l) => l.blend));
    expect(opened.scenes[0].layers.map((l) => l.blend)).toEqual(saved.scenes[0].layers.map((l) => l.blend));
    for (const s of opened.surfaces) {
      expect(s).not.toHaveProperty('opacity');
      expect(s).not.toHaveProperty('blend');
    }
    // Opening it twice changes nothing.
    expect(normalizeShow(JSON.parse(JSON.stringify(opened)))).toEqual(opened);
  });

  it('keep every desktop mode on layers and blocks; an unknown one plays as Normal', () => {
    const saved = setFrom11();
    BLEND_MODES.slice(0, 8).forEach((mode, i) => (saved.layers[i].blend = mode));
    saved.layers[3].blend = 'pin-light';
    (saved.layers[4] as { blend: string }).blend = 'glow';
    saved.scenes[0].layers[0].blend = 'hard-mix';
    const opened = normalizeShow(saved);
    expect(opened.layers[3].blend).toBe('pin-light');
    expect(opened.layers[4].blend).toBe('normal');
    expect(opened.layers[7].blend).toBe(BLEND_MODES[7]);
    expect(opened.scenes[0].layers[0].blend).toBe('hard-mix');
  });

  it('keep a surface\'s opacity and blend through save, open, copy and export', async () => {
    const saved = setFrom11();
    saved.surfaces[1] = { ...saved.surfaces[1], opacity: 0.4, blend: 'overlay' };
    const opened = normalizeShow(JSON.parse(JSON.stringify(saved)));
    expect(opened.surfaces[1]).toMatchObject({ opacity: 0.4, blend: 'overlay', feather: 0.1, name: 'Left wall' });
    expect(opened.surfaces[0]).not.toHaveProperty('opacity');
    const { copy } = duplicateSet([opened], opened);
    expect(copy!.surfaces[1]).toMatchObject({ opacity: 0.4, blend: 'overlay' });
    const packed = await packSet(opened, async () => undefined);
    const unpacked = normalizeShow((await unpackSet(packed.blob)).show);
    expect(unpacked.surfaces[1]).toMatchObject({ opacity: 0.4, blend: 'overlay' });
  });

  it('clean damaged surface values', () => {
    const saved = setFrom11() as unknown as { surfaces: Record<string, unknown>[] };
    saved.surfaces[0] = { ...saved.surfaces[0], opacity: 7, blend: 'normal' };
    saved.surfaces[1] = { ...saved.surfaces[1], opacity: -1, blend: 'Overlay' };
    const opened = normalizeShow(saved);
    expect(opened.surfaces[0]).not.toHaveProperty('opacity');
    expect(opened.surfaces[0]).not.toHaveProperty('blend');
    expect(opened.surfaces[1].opacity).toBe(0);
    expect(opened.surfaces[1]).not.toHaveProperty('blend');
  });
});
