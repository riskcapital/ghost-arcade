/**
 * The tray's checks on the show's selection, run after store updates.
 *
 * Keys on a lane are selected next to the show's own selection (they live
 * in `laneKeySelection`, not in the store). Picking something else (a
 * preset clip, an audio track, a transition, a track) lets go of them, so
 * Delete acts on what was just picked.
 *
 * That used to be checked against the selection as it stood after EVERY
 * store update, each playhead frame included: with a preset clip still
 * selected, keys clicked on a lane were dropped on the next update, and
 * Delete then removed the preset clip instead of the clicked key. Keys on a
 * selected track could never stay selected either. It is now checked only
 * when the selection itself changes.
 */
import type { Readable, Writable } from 'svelte/store';
import type { ShowTimelineSelection } from '../../../stores/showTimeline';
import type { LaneKeySelection } from './trackLayout';

/** Whether a change of selection from `prev` to `next` lets go of keys. */
export function selectionDropsKeys(prev: ShowTimelineSelection | null, next: ShowTimelineSelection | null): boolean {
  if (next === prev || !next) return false;
  if (prev && prev.kind === next.kind && prev.id === next.id) return false;
  return next.kind !== 'layerClip';
}

export interface StoreChecks {
  /** Called on a selection change (and once at the start) with it. */
  onSelection?: (selection: ShowTimelineSelection | null, prev: ShowTimelineSelection | null) => void;
  /** Called after every store update, batched to one per microtask. */
  onUpdate?: (selection: ShowTimelineSelection | null) => void;
}

/**
 * Watch the show store: drop lane keys when the selection changes to
 * something else, and run the tray's own checks. Runs once at the start
 * (without dropping keys), then batched to one run per microtask.
 * Returns the unsubscribe.
 */
export function watchShowSelection(
  show: Readable<{ selection: ShowTimelineSelection | null }>,
  keys: Writable<LaneKeySelection | null>,
  checks: StoreChecks = {},
): () => void {
  let current: ShowTimelineSelection | null = null;
  let latest: ShowTimelineSelection | null = null;
  let first = true;
  let queued = false;
  let stopped = false;
  const run = () => {
    queued = false;
    if (stopped) return;
    const next = latest;
    const prev = current;
    current = next;
    if (first) {
      first = false;
      checks.onSelection?.(next, prev);
    } else if (next !== prev) {
      if (selectionDropsKeys(prev, next)) keys.set(null);
      checks.onSelection?.(next, prev);
    }
    checks.onUpdate?.(next);
  };
  const unsubscribe = show.subscribe((s) => {
    latest = s.selection;
    if (first) { run(); return; }
    if (queued) return;
    queued = true;
    queueMicrotask(run);
  });
  return () => {
    stopped = true;
    unsubscribe();
  };
}
