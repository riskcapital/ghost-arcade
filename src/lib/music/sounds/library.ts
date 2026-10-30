/**
 * Every sound the studio can put on a bowl or an FX pad, by category, and
 * the drone's pad patches.
 */
import { SOUND_CATEGORY_LABELS, type PadPatchDef, type SoundCategory, type SoundDef } from './kit';
import { RESONANT_SOUNDS } from './resonant';
import { ONE_SHOT_SOUNDS } from './oneShots';
import { ATMOS_SOUNDS } from './atmos';
import { PAD_PATCHES } from './padPatches';

export const SOUND_LIBRARY: readonly SoundDef[] = [...RESONANT_SOUNDS, ...ONE_SHOT_SOUNDS, ...ATMOS_SOUNDS];

const byId = new Map(SOUND_LIBRARY.map((s) => [s.id, s]));

export function soundById(id: string | null | undefined): SoundDef | undefined {
  return id ? byId.get(id) : undefined;
}

/** The library grouped for a menu, in category order. */
export function soundGroups(filter?: (s: SoundDef) => boolean): { category: SoundCategory; label: string; sounds: SoundDef[] }[] {
  const order: SoundCategory[] = ['resonant', 'dub', 'rise', 'impact', 'atmos'];
  return order
    .map((category) => ({ category, label: SOUND_CATEGORY_LABELS[category], sounds: SOUND_LIBRARY.filter((s) => s.category === category && (!filter || filter(s))) }))
    .filter((g) => g.sounds.length > 0);
}

export { PAD_PATCHES };

const padById = new Map(PAD_PATCHES.map((p) => [p.id, p]));

export function padPatchById(id: string | null | undefined): PadPatchDef | undefined {
  return id ? padById.get(id) : undefined;
}
