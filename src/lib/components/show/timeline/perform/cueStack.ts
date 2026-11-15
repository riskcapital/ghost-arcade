/**
 * The Timeline's one cue list: its sections, its markers and the cue list's
 * own cues together, in show order, numbered once (Q1, Q2…). Markers are
 * cues with a time (each fires the cue it points at when the playhead
 * crosses it); the cues no marker points at are "manual" and wait for GO,
 * after the timed items in the cue list's own order. Pure: the Perform tab,
 * the marker flags on the ruler and GO all read the same numbering.
 */
import type { Cue, CueMarker } from '../../../../show/cueList';
import type { TimelineSection } from '../../../../timeline/sections/sectionModel';

export type StackItem =
  | { kind: 'section'; id: string; q: number; time: number; section: TimelineSection }
  | { kind: 'marker'; id: string; q: number; time: number; marker: CueMarker; cue: Cue | null }
  | { kind: 'cue'; id: string; q: number; time: null; cue: Cue };

export function buildCueStack(
  sections: readonly TimelineSection[],
  markers: readonly CueMarker[],
  cues: readonly Cue[],
): StackItem[] {
  const timed: Array<Omit<Extract<StackItem, { kind: 'section' }>, 'q'> | Omit<Extract<StackItem, { kind: 'marker' }>, 'q'>> = [];
  for (const s of sections) timed.push({ kind: 'section', id: s.id, time: s.start, section: s });
  const byId = new Map(cues.map((c) => [c.id, c]));
  const onMarker = new Set<string>();
  for (const m of markers) {
    if (m.cueId) onMarker.add(m.cueId);
    timed.push({ kind: 'marker', id: m.id, time: m.time, marker: m, cue: m.cueId ? byId.get(m.cueId) ?? null : null });
  }
  // Show order; at the same time a section comes before a marker in it.
  timed.sort((a, b) => a.time - b.time || (a.kind === b.kind ? 0 : a.kind === 'section' ? -1 : 1));
  const out: StackItem[] = timed.map((t, i) => ({ ...t, q: i + 1 }) as StackItem);
  for (const c of cues) {
    if (onMarker.has(c.id)) continue;
    out.push({ kind: 'cue', id: c.id, q: out.length + 1, time: null, cue: c });
  }
  return out;
}

/** The number the stack gives a marker (its flag on the ruler), or null. */
export function markerNumber(stack: readonly StackItem[], markerId: string): number | null {
  return stack.find((i) => i.kind === 'marker' && i.id === markerId)?.q ?? null;
}

/** An item's name as the list shows it. */
export function stackItemName(item: StackItem): string {
  if (item.kind === 'section') return item.section.name;
  if (item.kind === 'marker') return item.marker.label || item.cue?.name || 'Marker';
  return item.cue.name || 'Untitled';
}
