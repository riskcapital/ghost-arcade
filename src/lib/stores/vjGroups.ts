import type { Effect } from '../types';
export interface VJGroup {
  id: string;
  name: string;
  first: number;
  last: number;
  opacity: number;
  blendMode: string;
  effects: Effect[];
}
/** Contiguous, non-overlapping row ranges keep stack ordering unambiguous. */
export function normalizeVJGroups(input: unknown, count: number): VJGroup[] {
  if (!Array.isArray(input)) return [];
  const used = new Set<number>();
  const ids = new Set<string>();
  return input.flatMap((g): VJGroup[] => {
    if (!g || typeof g.id !== 'string' || !g.id || ids.has(g.id) || !Number.isInteger(g.first) || !Number.isInteger(g.last) || g.first < 0 || g.last < g.first || g.last >= count) return [];
    for (let i = g.first; i <= g.last; i++) if (used.has(i)) return [];
    for (let i = g.first; i <= g.last; i++) used.add(i);
    ids.add(g.id);
    return [{ id: g.id, name: typeof g.name === 'string' ? g.name.slice(0, 80) : 'Group', first: g.first, last: g.last,
      opacity: Number.isFinite(g.opacity) ? Math.max(0, Math.min(1, g.opacity)) : 1,
      blendMode: typeof g.blendMode === 'string' ? g.blendMode : 'normal', effects: Array.isArray(g.effects) ? g.effects : [] }];
  });
}
export function removeVJGroupRow(groups: VJGroup[], row: number, count: number): VJGroup[] {
  return normalizeVJGroups(groups.flatMap(g => {
    if (g.first === row && g.last === row) return [];
    return [{ ...g, first: g.first > row ? g.first - 1 : g.first, last: g.last >= row ? g.last - 1 : g.last }];
  }), count);
}
