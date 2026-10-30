/**
 * The sound library holds together: ids are unique and well formed, names
 * fit a pad, and every sound a default pad bank, bowl set or the drone
 * names is in it.
 */
import { describe, expect, it } from 'vitest';
import { PAD_PATCHES, SOUND_LIBRARY, padPatchById, soundById } from './library';
import { BOWL_KITS, DEFAULT_DRONE_PATCH, DEFAULT_FX_PADS } from '../soundSlots';

describe('sound library', () => {
  it('has unique, well-formed ids and short names', () => {
    const ids = SOUND_LIBRARY.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of SOUND_LIBRARY) {
      expect(s.id).toMatch(/^[a-z0-9][a-z0-9-]{0,47}$/);
      expect(s.name.length, s.id).toBeLessThanOrEqual(16);
      expect(s.blurb.length, s.id).toBeGreaterThan(10);
      if (s.kind === 'strike') expect(s.pitched, s.id).toBe(true);
    }
    const pads = PAD_PATCHES.map((p) => p.id);
    expect(new Set(pads).size).toBe(pads.length);
  });

  it('has every sound the default pads and bowl sets use', () => {
    for (const ids of Object.values(DEFAULT_FX_PADS)) for (const id of ids) expect(soundById(id), id).toBeDefined();
    for (const kit of BOWL_KITS) for (const slot of kit.slots) expect(soundById(slot.sound)?.kind, `${kit.id}: ${slot.sound}`).toBe('strike');
    expect(padPatchById(DEFAULT_DRONE_PATCH)).toBeDefined();
  });
});
