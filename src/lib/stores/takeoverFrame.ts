/**
 * The live takeover at the current instant, as Canvas builds the native scene
 * from it (see show/takeover/takeoverScene.ts). The takeover runtime publishes
 * into it only when something the scene needs has changed; null = nothing is
 * taken over.
 *
 * `takeoverMediaSources` keeps one stable source per engage of dropped media.
 *
 * `takeoverRenderHeld`: a render owns the show (the Stage Sim's Render
 * rehearsal), so the scene leaves the takeover out until it is over. An
 * offline export is the same, told by the visual-audio manual clock.
 */
import { derived, get, writable } from 'svelte/store';
import type { TakeoverFrame } from '../show/takeover/liveTakeover';
import { TakeoverMediaSources } from '../show/takeover/takeoverScene';

export const takeoverFrame = writable<TakeoverFrame | null>(null);

export const takeoverMediaSources = new TakeoverMediaSources();

const renderHolds = writable<ReadonlySet<string>>(new Set());

/** True while some render keeps the takeover out of the scene. */
export const takeoverRenderHeld = derived(renderHolds, (holds) => holds.size > 0);

/** A render (`owner`) starts or stops owning the show's picture. */
export function holdTakeoverForRender(owner: string, on: boolean): void {
  const holds = get(renderHolds);
  if (holds.has(owner) === on) return;
  const next = new Set(holds);
  if (on) next.add(owner);
  else next.delete(owner);
  renderHolds.set(next);
}

/** Drop every hold whose owner starts with `prefix` (its window went away). */
export function releaseTakeoverRenderHolds(prefix: string): void {
  const holds = get(renderHolds);
  const next = new Set([...holds].filter((owner) => !owner.startsWith(prefix)));
  if (next.size !== holds.size) renderHolds.set(next);
}
