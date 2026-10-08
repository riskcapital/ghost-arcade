// The effect browser's catalogue: the effect list under plain category names, with search.
// The engine's own categories are engineering groups ("Advanced Warp", "New Hero", "Effects");
// here they are folded into ten shelves a performer would look on.
import { moveItem } from './reorder';

export type BrowsableEffect = { type: string; label: string; category: string; internal?: boolean };
export type EffectShelf = { id: string; label: string; icon: string };
export type EffectEntry = { type: string; label: string; shelf: string };

/** Shelves in the order they are shown. `icon` names a glyph drawn by the browser. */
export const EFFECT_SHELVES: EffectShelf[] = [
  { id: 'featured', label: 'Featured', icon: 'star' },
  { id: 'color', label: 'Color', icon: 'drop' },
  { id: 'glow', label: 'Light and glow', icon: 'sun' },
  { id: 'blur', label: 'Blur', icon: 'blur' },
  { id: 'warp', label: 'Warp', icon: 'wave' },
  { id: 'stylize', label: 'Stylize', icon: 'halftone' },
  { id: 'trails', label: 'Trails', icon: 'trail' },
  { id: 'texture', label: 'Texture and weather', icon: 'grain' },
  { id: 'pattern', label: 'Pattern and depth', icon: 'tiles' },
  { id: 'mask', label: 'Mask and key', icon: 'mask' },
];

const SHELF_OF: Record<string, string> = {
  'New Hero': 'featured',
  Color: 'color', 'Advanced Color': 'color', Effects: 'color',
  'Light & Glow': 'glow',
  'Blur & Focus': 'blur',
  Distort: 'warp', 'Advanced Warp': 'warp',
  Stylize: 'stylize', 'Advanced Stylize': 'stylize',
  'Advanced Trails': 'trails',
  'Generate & Texture': 'texture', 'Advanced Atmosphere': 'texture',
  'Advanced Text & Pattern': 'pattern', 'Advanced Depth': 'pattern', 'Advanced 3D': 'pattern',
  Masking: 'mask', Keying: 'mask',
};

/** The shelf an engine category belongs on. Unknown categories land on Stylize, never nowhere. */
export const shelfFor = (category: string): string => SHELF_OF[category] ?? 'stylize';

/** Labels as shown: a few engine entries are lower-case ("brightness"). */
export const effectLabel = (label: string): string => (label ? label[0].toUpperCase() + label.slice(1) : label);

/** Every effect a performer can add, labelled and shelved, in catalogue order. */
export function effectEntries(effects: BrowsableEffect[]): EffectEntry[] {
  return effects.filter((e) => !e.internal).map((e) => ({ type: e.type, label: effectLabel(e.label), shelf: shelfFor(e.category) }));
}

/** Shelves that hold at least one effect, with counts, in display order. */
export function effectShelves(entries: EffectEntry[]): (EffectShelf & { count: number })[] {
  return EFFECT_SHELVES.map((s) => ({ ...s, count: entries.filter((e) => e.shelf === s.id).length })).filter((s) => s.count);
}

const fold = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Effects for one shelf ('all' for every shelf), narrowed by a search. A search looks across all
 * shelves, since someone typing "blur" should not have to guess the shelf first; names that start
 * with the search come before names that only contain it.
 */
export function browseEffects(entries: EffectEntry[], shelf: string, search = ''): EffectEntry[] {
  const query = fold(search);
  if (!query) return shelf === 'all' ? entries : entries.filter((e) => e.shelf === shelf);
  const shelfNames = new Map(EFFECT_SHELVES.map((s) => [s.id, fold(s.label)]));
  const words = query.split(' ');
  const scored = entries.flatMap((e, order) => {
    const name = fold(e.label), where = `${name} ${shelfNames.get(e.shelf) ?? ''}`;
    if (!words.every((w) => where.includes(w))) return [];
    return [{ e, rank: name.startsWith(query) ? 0 : name.includes(query) ? 1 : 2, order }];
  });
  return scored.sort((a, b) => a.rank - b.rank || a.order - b.order).map((s) => s.e);
}

/** The chain with one effect moved. Used by the drag handles and the arrow keys. */
export const moveEffect = moveItem;
