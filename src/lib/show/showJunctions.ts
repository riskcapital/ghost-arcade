/**
 * Junctions: where one clip ends exactly as the next begins. The preset lane
 * and the layer tracks' crossfades use the same rules, so a transition is
 * centred and clamped the same way on every lane.
 */

interface JunctionClip {
  id: string;
  startTime: number;
  duration: number;
}

/**
 * Longest transition the junction on `next`'s left edge can actually hold:
 * never longer than `next` itself, and never longer than the clip before it.
 *
 * The window is centred, so a `D`-second transition only ever spends `D/2`
 * inside each neighbour — clamping `D` to the shorter neighbour's FULL
 * length therefore leaves both halves comfortably inside their clips AND
 * guarantees two adjacent junctions can touch but never overlap (each takes
 * at most half of the clip they share).
 */
export function clampShowTransitionDuration(
  requested: number | undefined,
  next: Pick<JunctionClip, 'duration'>,
  prev: Pick<JunctionClip, 'duration'> | null,
): number {
  const want = Number(requested);
  if (!Number.isFinite(want) || want <= 0) return 0;
  let limit = Math.max(0, next.duration);
  if (prev) limit = Math.min(limit, Math.max(0, prev.duration));
  return Math.max(0, Math.min(want, limit));
}

/**
 * The clip on the other side of `next`'s left junction: the one whose end
 * meets `next.startTime`.
 *
 * ADJACENCY IS REQUIRED. An earlier version of this reached back across a
 * gap, on the reasoning that the last-fired composition is still on screen
 * through a hole. A centred transition cannot use that: it would start
 * mid-gap, where nothing is playing, and the timeline would have to draw a
 * transition element straddling a boundary that is not a junction.
 */
export function findJunctionPredecessor<T extends JunctionClip>(
  clips: readonly T[],
  next: Pick<JunctionClip, 'id' | 'startTime'>,
): T | null {
  for (const c of clips) {
    if (c.id === next.id) continue;
    if (Math.abs(c.startTime + c.duration - next.startTime) <= 1e-6) return c;
  }
  return null;
}

