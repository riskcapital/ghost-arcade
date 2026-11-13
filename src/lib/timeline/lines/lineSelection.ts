/**
 * The Timeline's selected points: the line being edited (its value, its
 * curves) and the keys selected on every other line, edited as one set
 * (keyEdit.ts, components/show/timeline/keyCommands.ts). Kept apart from
 * timelineLines.ts so the track commands can use it without the recorder.
 */
import { get, writable } from 'svelte/store';
import { showTimeline } from '../../stores/showTimeline';
import type { ControlLine, LinePoint } from './lineModel';
import { keysToRefs, refsToKeys, unionKeys, type KeyAt, type KeyRef } from './keyEdit';

export interface LineSelection {
  lineId: string;
  points: number[];
  /** Which of the line's point lists the indices are in (default: its points). */
  channel?: 'points' | 'depth';
  /** The point list the indices were taken from: once the line's points are
   *  replaced (undo, redo, a recorded pass) the indices no longer apply. */
  of?: readonly LinePoint[];
  /** Selected keys on other lines too (points channel): a selection across
   *  lines and rows, edited as a set (keyEdit.ts). `lineId` stays the line
   *  being edited (its value, its curves). */
  more?: KeyRef[];
}

/** The selected point indices of `line`'s `channel` list, while they still apply. */
export function selectedLinePoints(sel: LineSelection | null, line: ControlLine, channel: 'points' | 'depth' = 'points'): number[] {
  if (!sel) return [];
  if (sel.lineId !== line.id || (sel.channel ?? 'points') !== channel) {
    if (channel !== 'points') return [];
    const extra = sel.more?.find((r) => r.lineId === line.id);
    return extra && (!extra.of || extra.of === line.points) ? extra.points : [];
  }
  const list = channel === 'depth' ? line.follow?.depthPoints ?? [] : line.points;
  if (sel.of && sel.of !== list) return [];
  return sel.points;
}
export const lineSelection = writable<LineSelection | null>(null);

/** Every selected key (points channel), on every line. */
export function selectedKeys(lines: readonly ControlLine[] = get(showTimeline).lines): KeyAt[] {
  const sel = get(lineSelection);
  if (!sel) return [];
  const refs: KeyRef[] = [...(sel.more ?? [])];
  if ((sel.channel ?? 'points') === 'points') refs.unshift({ lineId: sel.lineId, points: sel.points, of: sel.of });
  return refsToKeys(lines, refs);
}

/** Select keys (with `add`, on top of the selection); `activeLineId` becomes the line being edited. */
export function selectKeys(keys: readonly KeyAt[], opts: { add?: boolean; activeLineId?: string } = {}): void {
  const lines = get(showTimeline).lines;
  const all = opts.add ? unionKeys(selectedKeys(lines), keys) : keys.slice();
  const refs = keysToRefs(lines, all);
  const prev = get(lineSelection);
  const activeId = opts.activeLineId ?? (prev && refs.some((r) => r.lineId === prev.lineId) ? prev.lineId : refs[0]?.lineId);
  if (!activeId) {
    lineSelection.set(prev ? { lineId: prev.lineId, points: [], channel: 'points' } : null);
    return;
  }
  const own = refs.find((r) => r.lineId === activeId);
  const line = lines.find((l) => l.id === activeId);
  lineSelection.set({
    lineId: activeId,
    points: own?.points ?? [],
    channel: 'points',
    of: line?.points,
    more: refs.filter((r) => r.lineId !== activeId),
  });
}

/** Drop the selected keys (the line being edited stays chosen). */
export function clearSelectedKeys(): void {
  const prev = get(lineSelection);
  if (prev) lineSelection.set({ lineId: prev.lineId, points: [], channel: prev.channel });
}

