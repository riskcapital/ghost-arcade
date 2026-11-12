/**
 * Picking a group's pieces on the editor canvas. A block's ⇄ Where starts
 * a pick (WhereEditor); WherePickOverlay shows every piece, a click puts a
 * piece in or takes it out, and Done hands the chosen pieces back.
 *
 * Chosen pieces become an order's `slots`, so only they take part: left to
 * right, each its own slot (a sweep visits them in turn), or one slot that
 * lights together.
 */
import { writable } from 'svelte/store';
import type { WhereSpot } from './spatialOrder';

export interface WherePick {
  /** The pieces chosen so far (layer ids). */
  ids: string[];
  /** One slot that lights together, rather than one slot per piece. */
  together: boolean;
  /** The named group being edited, or null for the block's own pieces. */
  groupName: string | null;
  /** Done: the chosen pieces, how they light, and a name (to keep them as a named group). */
  commit(ids: string[], together: boolean, name: string | null): void;
}

export const wherePick = writable<WherePick | null>(null);

/** Chosen pieces as order slots: left to right (then top to bottom), each its own, or all as one. */
export function slotsFromPieces(ids: readonly string[], spots: readonly WhereSpot[], together: boolean): string[][] {
  const byId = new Map(spots.map((s) => [s.id, s]));
  const chosen = [...new Set(ids)].filter((id) => byId.has(id));
  chosen.sort((a, b) => {
    const p = byId.get(a)!;
    const q = byId.get(b)!;
    return p.x - q.x || p.y - q.y || (a < b ? -1 : 1);
  });
  if (!chosen.length) return [];
  return together ? [chosen] : chosen.map((id) => [id]);
}
