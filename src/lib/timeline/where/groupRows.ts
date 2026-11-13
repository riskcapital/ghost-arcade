/**
 * Group rows: a Timeline row whose blocks play across a named group of
 * pieces (a where order with its own pieces, "Left half", "Top row"…) rather
 * than on the piece the row is added to, the way a media server lets each
 * clip play through a mapping of several screens.
 *
 * A group row is an added layer (subRow) carrying `group`: the order and
 * whether its picture is Unified (one picture across the pieces, each
 * showing its part) or Individual (each piece shows the whole picture). Its
 * blocks are ordinary blocks with a where spec on that order, every piece
 * lit for the block's span, the pieces the block's own while it plays (dark:
 * their own content goes, only the block shows). A block can still change
 * its own pattern in the pattern editor; the row only fills in blocks that
 * come without one.
 */
import type { ShowLayerTrack } from '../../types';
import { defaultWhere, type WhereSpec } from './whereModel';

export interface TrackGroup {
  /** The where order (Timeline `whereOrders`) holding the group's pieces. */
  orderId: string;
  /** One picture across the pieces (true) or the whole picture on each (false). */
  unified: boolean;
}

/** The pattern a block on a group row plays with: every piece of the group lit, the pieces the block's own. */
export function groupRowWhere(group: TrackGroup): WhereSpec {
  return {
    ...defaultWhere('pieces'),
    namedOrder: group.orderId,
    motion: { kind: 'drawn' },
    position: 0.5,
    spread: 1,
    soft: 0,
    wrap: false,
    dark: true,
    span: group.unified,
  };
}

/** A row's group from a file (null: none). Never throws. */
export function normalizeTrackGroup(raw: unknown): TrackGroup | null {
  if (!raw || typeof raw !== 'object') return null;
  const g = raw as Record<string, unknown>;
  if (typeof g.orderId !== 'string' || !g.orderId) return null;
  return { orderId: g.orderId, unified: g.unified !== false };
}

/** Blocks on group rows that came without a pattern get the row's (the same array when none needed it). */
export function adoptGroupWhere(tracks: readonly ShowLayerTrack[]): ShowLayerTrack[] {
  let changed = false;
  const out = tracks.map((t) => {
    if (!t.group || !t.clips.some((c) => !c.where)) return t;
    changed = true;
    const where = groupRowWhere(t.group);
    return { ...t, clips: t.clips.map((c) => (c.where ? c : { ...c, where: { ...where } })) };
  });
  return changed ? out : (tracks as ShowLayerTrack[]);
}

/**
 * Set a group row Unified or Individual: the row's default, and every block
 * on it that plays through the row's group.
 */
export function setGroupRowUnified(tracks: readonly ShowLayerTrack[], trackId: string, unified: boolean): ShowLayerTrack[] {
  let changed = false;
  const out = tracks.map((t) => {
    if (t.id !== trackId || !t.group) return t;
    const orderId = t.group.orderId;
    changed = true;
    return {
      ...t,
      group: { ...t.group, unified },
      clips: t.clips.map((c) => (c.where && c.where.namedOrder === orderId ? { ...c, where: { ...c.where, span: unified } } : c)),
    };
  });
  return changed ? out : (tracks as ShowLayerTrack[]);
}
