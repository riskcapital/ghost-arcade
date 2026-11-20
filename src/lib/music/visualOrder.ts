/**
 * One list of the studio's visuals, top drawing on top: its own voices and
 * the playing clips' stacks (stackRuntime.ts), in any order.
 *
 * Voices keep their order in `musicVoices`. A clip's stack has a place per
 * track (`musicStackPlace`), so the next clip on that track lands where the
 * last one was: voice i sits at i + 0.5, and a stack at its place, so a place
 * between n - 0.5 and n + 0.5 draws just above voice n. A track with no place
 * yet goes on top, the later track over the earlier, as before.
 */

export type VisualRow = { kind: 'voice'; index: number } | { kind: 'stack'; index: number };

export interface OrderStack {
  track: string;
  /** Track order: higher draws over lower when neither has a place. */
  order: number;
}

/** Tracks whose clip visuals are switched off, checked. */
export function normalizeStackOff(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((t): t is string => typeof t === 'string' && t.length > 0 && t.length <= 300))].slice(0, 64);
}

/** Most tracks a place is kept for. */
export const MAX_STACK_PLACES = 64;

/** Saved places, checked: track key → place. */
export function normalizeStackPlace(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [track, value] of Object.entries(raw as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX_STACK_PLACES) break;
    const n = Number(value);
    if (track && track.length <= 300 && Number.isFinite(n)) out[track] = Math.max(-1000, Math.min(1000, n));
  }
  return out;
}

const positionOf = (stack: OrderStack, places: Record<string, number>) => places[stack.track] ?? -1 - stack.order;

/** The whole list, top first. */
export function visualOrder(voiceCount: number, stacks: readonly OrderStack[], places: Record<string, number>): VisualRow[] {
  const rows: Array<{ row: VisualRow; at: number; tie: number }> = [];
  for (let i = 0; i < voiceCount; i++) rows.push({ row: { kind: 'voice', index: i }, at: i + 0.5, tie: 0 });
  stacks.forEach((stack, i) => rows.push({ row: { kind: 'stack', index: i }, at: positionOf(stack, places), tie: -stack.order }));
  return rows.sort((a, b) => a.at - b.at || a.tie - b.tie).map((r) => r.row);
}

/**
 * A list put in a new order (a drag): the voices' new order (old indexes,
 * top first) and a place for every stack in it.
 */
export function arrangeVisuals(rows: readonly VisualRow[], stacks: readonly OrderStack[]): { voices: number[]; places: Record<string, number> } {
  const voices: number[] = [];
  const places: Record<string, number> = {};
  // Stacks between the same two voices share the gap, spread evenly in order.
  let run: number[] = [];
  const flush = () => {
    const n = voices.length;
    run.forEach((stackIndex, k) => {
      places[stacks[stackIndex].track] = n - 0.5 + (k + 1) / (run.length + 1);
    });
    run = [];
  };
  for (const row of rows) {
    if (row.kind === 'stack') run.push(row.index);
    else {
      flush();
      voices.push(row.index);
    }
  }
  flush();
  return { voices, places };
}

/** Move one row of the list to `to` (an index into the list after it is taken out). */
export function moveVisualRow(rows: readonly VisualRow[], from: number, to: number): VisualRow[] {
  const next = [...rows];
  const [moved] = next.splice(from, 1);
  if (!moved) return [...rows];
  next.splice(Math.max(0, Math.min(next.length, to)), 0, moved);
  return next;
}
