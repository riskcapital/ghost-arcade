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
 *   timeline behind it. Wall-clock RAF ramp; there is no show time to derive
 *   from, so there is nothing to be deterministic against.
 *
 * They are mutually exclusive: starting either cancels the other. The show
 * timeline wins ties because it is the programmed player.
 *
 * Deliberately free of any `layers.ts` import — Canvas.svelte already has
 * the composition list and passes the lookup in, which keeps this store out
 * of the project-store dependency cycle.
 */

import { writable, get } from 'svelte/store';
import type { CompositionTransitionStyle } from '../types';
import type { ActiveCompositionTransition } from '../renderer/compositionTransitionLayers';

export type { ActiveCompositionTransition };

export interface CompositionTransitionState {
  /** null when the scene is showing exactly one composition. */
  active: ActiveCompositionTransition | null;
}

const store = writable<CompositionTransitionState>({ active: null });

/** RAF handle for the wall-clock (`beginTimed`) ramp. */
let rafId: number | null = null;
let timedStartMs = 0;
let timedDurationMs = 0;

function cancelTimed(): void {
  if (rafId !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafId);
  rafId = null;
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
  const current = get(store).active;
  // Progress moves every frame during a transition, so a no-op guard is what
  // keeps a settled scene from re-flushing the whole native layer stack.
  if (sameTransition(current, active)) return;
  store.set({ active });
}

function tick(now: number): void {
  rafId = null;
  const current = get(store).active;
  if (!current || timedDurationMs <= 0) {
    publish(null);
    return;
  }
  const progress = (now - timedStartMs) / timedDurationMs;
  if (progress >= 1) {
    publish(null);
    return;
  }
  publish({ ...current, progress: Math.max(0, progress) });
  if (typeof requestAnimationFrame === 'function') rafId = requestAnimationFrame(tick);
}

export const compositionTransition = {
  subscribe: store.subscribe,

  /**
   * Show-timeline path. `active` is recomputed from show time on every
   * `seek()`; null ends the transition. Cancels any wall-clock ramp, because
   * the programmed player owns the picture while it is running.
   */
  driveFromClock(active: ActiveCompositionTransition | null): void {
    if (rafId !== null) cancelTimed();
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
      typeof requestAnimationFrame !== 'function'
    ) {
      publish(null);
      return;
    }
    timedStartMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    timedDurationMs = duration * 1000;
    // Progress 0 on the first published frame: the outgoing composition is
    // still the loaded one at this instant, and the caller swaps it a line
    // later. `buildCompositionTransitionLayers` resolves which side is live
    // by comparing against `activeCompositionId`, so it copes with both.
    publish({ style, progress: 0, fromCompositionId, toCompositionId });
    rafId = requestAnimationFrame(tick);
  },

  /** Drop any transition immediately — a hard cut from here on. */
  clear(): void {
    cancelTimed();
    publish(null);
  },

  /** Non-reactive peek. */
  current(): ActiveCompositionTransition | null {
    return get(store).active;
  },

  /** Test seam. */
  _resetForTest(): void {
    cancelTimed();
    timedStartMs = 0;
    timedDurationMs = 0;
    store.set({ active: null });
  },
};
