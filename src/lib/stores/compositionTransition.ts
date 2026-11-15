/**
 * Live composition-transition state — the one place that says "right now the
 * scene is `progress` of the way from composition X to composition Y".
 *
 * Canvas.svelte reads this every frame and hands it to
 * `buildCompositionTransitionLayers()`, which is what actually puts both
 * stacks in the scene. Nothing else needs to know a transition is happening.
 *
 * TWO CLOCKS, ONE STATE
 * ---------------------
 * • `driveFromClock()` — the show timeline. Progress is a pure function of
 *   show time, recomputed inside `showTimeline.seek()`, so a cold seek into
 *   the middle of a transition lands fully resolved and the offline renderer
 *   gets the identical frame on every run. This is the authoritative path.
 * • `beginTimed()` — the preset tray, MIDI preset fires, anything with no
 *   timeline behind it. A wall-clock ramp; there is no show time to derive
 *   from, so there is nothing to be deterministic against. The store
 *   publishes only its start and its end: `current()` works out the progress
 *   from the clock when the frame sync asks, once per frame it sends.
 *
 * They are mutually exclusive: starting either cancels the other. The show
 * timeline wins ties because it is the programmed player.
 *
 * Deliberately free of any `layers.ts` import — Canvas.svelte already has
 * the composition list and passes the lookup in, which keeps this store out
 * of the project-store dependency cycle.
 */

import { writable } from 'svelte/store';
import type { CompositionTransitionStyle } from '../types';
import type { ActiveCompositionTransition } from '../renderer/compositionTransitionLayers';

export type { ActiveCompositionTransition };

export interface CompositionTransitionState {
  /** null when the scene is showing exactly one composition. */
  active: ActiveCompositionTransition | null;
}

const store = writable<CompositionTransitionState>({ active: null });

/** What the store last published (read without a subscription). */
let published: ActiveCompositionTransition | null = null;

/** The wall-clock (`beginTimed`) ramp: its clock, and the timer that ends it. */
let timedEndTimer: ReturnType<typeof setTimeout> | null = null;
let timedStartMs = 0;
let timedDurationMs = 0;

const clockNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function timedRunning(): boolean {
  return timedEndTimer !== null;
}

function cancelTimed(): void {
  if (timedEndTimer !== null) clearTimeout(timedEndTimer);
  timedEndTimer = null;
}

/** Wall-clock progress of the running ramp, 0..1. */
function timedProgress(now: number): number {
  if (timedDurationMs <= 0) return 1;
  return Math.min(1, Math.max(0, (now - timedStartMs) / timedDurationMs));
}

function sameTransition(
  a: ActiveCompositionTransition | null,
  b: ActiveCompositionTransition | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.style === b.style &&
    a.fromCompositionId === b.fromCompositionId &&
    a.toCompositionId === b.toCompositionId &&
    Math.abs(a.progress - b.progress) < 1e-6
  );
}

function publish(active: ActiveCompositionTransition | null): void {
  // Progress moves every frame during a show-timeline transition, so a
  // no-op guard is what keeps a settled scene from re-flushing the whole
  // native layer stack.
  if (sameTransition(published, active)) return;
  published = active;
  store.set({ active });
}

/** The ramp's end: a timer can fire a moment before the clock says so. */
function endTimed(): void {
  timedEndTimer = null;
  const remaining = timedStartMs + timedDurationMs - clockNow();
  if (remaining > 0.5) {
    timedEndTimer = setTimeout(endTimed, remaining);
    return;
  }
  publish(null);
}

export const compositionTransition = {
  subscribe: store.subscribe,

  /**
   * Show-timeline path. `active` is recomputed from show time on every
   * `seek()`; null ends the transition. Cancels any wall-clock ramp, because
   * the programmed player owns the picture while it is running.
   */
  driveFromClock(active: ActiveCompositionTransition | null): void {
    cancelTimed();
    publish(active);
  },

  /**
   * Wall-clock path for the preset tray. Call immediately BEFORE
   * `project.loadComposition(toCompositionId)` — `fromCompositionId` has to
   * be read while it is still the loaded one.
   */
  beginTimed(
    fromCompositionId: string | null | undefined,
    toCompositionId: string,
    style: CompositionTransitionStyle,
    durationSeconds: number,
  ): void {
    cancelTimed();
    const duration = Number(durationSeconds);
    if (
      !fromCompositionId ||
      !toCompositionId ||
      fromCompositionId === toCompositionId ||
      !Number.isFinite(duration) ||
      duration <= 0 ||
      // No frame loop here (a headless test): a hard cut, as before.
      typeof requestAnimationFrame !== 'function'
    ) {
      publish(null);
      return;
    }
    timedStartMs = clockNow();
    timedDurationMs = duration * 1000;
    // Published once, at progress 0: the outgoing composition is still the
    // loaded one at this instant, and the caller swaps it a line later.
    // `buildCompositionTransitionLayers` resolves which side is live by
    // comparing against `activeCompositionId`, so it copes with both. From
    // here the progress is read from the clock (`current()`); the store
    // publishes again only when the ramp ends.
    publish({ style, progress: 0, fromCompositionId, toCompositionId });
    timedEndTimer = setTimeout(endTimed, timedDurationMs);
  },

  /** Drop any transition immediately — a hard cut from here on. */
  clear(): void {
    cancelTimed();
    publish(null);
  },

  /** Non-reactive peek, with the progress of this instant: the frame sync
   *  reads it for every frame it sends. A wall-clock ramp's progress comes
   *  from its clock here, not from a store publish per frame. */
  current(now = clockNow()): ActiveCompositionTransition | null {
    if (!published || !timedRunning()) return published;
    return { ...published, progress: timedProgress(now) };
  },

  /** Test seam. */
  _resetForTest(): void {
    cancelTimed();
    timedStartMs = 0;
    timedDurationMs = 0;
    published = null;
    store.set({ active: null });
  },
};
