/**
 * Restarting a Lines layer's animations on the render core.
 *
 * Every line animation (draw, stroke looks, stagger, Light Up) runs off the
 * time the layer's graph is given. Restarting means giving it time measured
 * from the moment of the restart.
 */
const origins = new Map<string, number>();
const pending = new Set<string>();

/** Restart the layer's animations from the next frame. */
export function restartLinesAnimation(layerId: string): void {
  pending.add(layerId);
}

/** The layer's animation time for this frame, given the clock's time. */
export function linesAnimationTime(layerId: string, clockTime: number): number {
  if (pending.delete(layerId)) origins.set(layerId, clockTime);
  const origin = origins.get(layerId) ?? 0;
  // A clock that went backwards (a new session, a seek) starts over.
  if (clockTime < origin) {
    origins.delete(layerId);
    return clockTime;
  }
  return clockTime - origin;
}

/** Test seam. */
export function resetLinesClock(): void {
  origins.clear();
  pending.clear();
}
