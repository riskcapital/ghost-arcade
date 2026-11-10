/**
 * Junction lookups for drawing lanes.
 *
 * `findJunctionPredecessor` scans the whole lane for every clip it is asked
 * about. That is fine for one clip, but a lane drawing a few hundred clips
 * (or the preset lane drawing all of its junctions) turned it into a
 * quadratic walk on every edit, scroll and zoom. This answers the same
 * question for every clip at once, in n log n, with the same rule: the
 * FIRST clip in the list (not itself) whose end meets the clip's start
 * within 1e-6.
 */
import { findJunctionPredecessor } from '../../../show/showJunctions';
import { maxShowTransitionDuration, showTransitionWindow } from '../../../stores/showTimeline';
import type { ShowPresetClip } from '../../../types';

interface JunctionClip {
  id: string;
  startTime: number;
  duration: number;
}

const EPS = 1e-6;

/** For every clip with a junction on its left edge, the clip before it.
 *  Keyed by clip object (lanes replace clips on edit, never mutate them). */
export function junctionPredecessors<T extends JunctionClip>(clips: readonly T[]): Map<T, T> {
  const out = new Map<T, T>();
  const n = clips.length;
  if (n < 2) return out;
  if (isTidyLane(clips)) {
    // Sorted, apart and not overlapping (every layer track, normally): only
    // the clip just before can end where a clip starts.
    for (let i = 1; i < n; i++) {
      const prev = clips[i - 1];
      const next = clips[i];
      if (prev.id !== next.id && Math.abs(prev.startTime + prev.duration - next.startTime) <= EPS) out.set(next, prev);
    }
    return out;
  }
  const ends = clips.map((c) => c.startTime + c.duration);
  const order = clips.map((_, i) => i).sort((a, b) => ends[a] - ends[b] || a - b);
  for (let i = 0; i < n; i++) {
    const next = clips[i];
    // First sorted end inside the (slightly widened) tolerance window.
    const from = next.startTime - 2 * EPS;
    let lo = 0;
    let hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (ends[order[mid]] < from) lo = mid + 1;
      else hi = mid;
    }
    let best = -1;
    for (let k = lo; k < n && ends[order[k]] <= next.startTime + 2 * EPS; k++) {
      const j = order[k];
      const c = clips[j];
      if (c.id === next.id) continue;
      // The exact test findJunctionPredecessor makes; the lowest index wins.
      if (Math.abs(c.startTime + c.duration - next.startTime) <= EPS && (best < 0 || j < best)) best = j;
    }
    if (best >= 0) out.set(next, clips[best]);
  }
  return out;
}

/**
 * True when no clip but the one just before another can meet its start
 * within the tolerance: positive lengths, starts increasing by more than
 * twice the tolerance, and no clip ending past the next one's start.
 */
function isTidyLane(clips: readonly JunctionClip[]): boolean {
  for (let k = 0; k < clips.length; k++) {
    const c = clips[k];
    if (!(c.duration > 0)) return false;
    const next = clips[k + 1];
    if (!next) break;
    if (!(next.startTime - c.startTime > 4 * EPS)) return false;
    if (!(c.startTime + c.duration <= next.startTime + EPS)) return false;
  }
  return true;
}

/**
 * The one-element list to hand a window function that would otherwise scan
 * the whole lane for `clip`'s predecessor: `findJunctionPredecessor([prev],
 * clip)` is `prev`, so the result is identical without the scan.
 */
export function predecessorList<T extends JunctionClip>(prev: T | undefined, clip: T): T[] {
  return prev && findJunctionPredecessor([prev], clip) === prev ? [prev] : [];
}

// ── The preset lane ─────────────────────────────────────────────────────

/** A junction on the preset lane: where the clip `clipId` meets the one
 *  before it, with its transition window (null for a hard cut). */
export interface PresetJunction {
  clipId: string;
  /** Show time the two clips meet. */
  boundary: number;
  /** Ceiling a resize clamps against (shorter neighbour). */
  max: number;
  /** null when this junction is currently a hard cut. */
  window: ReturnType<typeof showTransitionWindow>;
}

/**
 * Every junction on the preset lane, in clip order. The geometry is exactly
 * what the renderer runs: `showTransitionWindow()` is the function
 * `resolveShowTransition()` uses, here handed the predecessor directly.
 */
export function presetJunctions(clips: ShowPresetClip[]): PresetJunction[] {
  const prevOf = junctionPredecessors(clips);
  const out: PresetJunction[] = [];
  for (const clip of clips) {
    const lane = predecessorList(prevOf.get(clip), clip);
    const max = maxShowTransitionDuration(lane, clip);
    if (max <= 0) continue; // nothing adjacent on the left — not a junction
    out.push({ clipId: clip.id, boundary: clip.startTime, max, window: showTransitionWindow(lane, clip) });
  }
  return out;
}
