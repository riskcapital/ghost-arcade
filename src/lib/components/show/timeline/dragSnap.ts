/**
 * Snapping for one pointer drag on the layer tracks.
 *
 * `showTimeline.snapTime()` / `snapTargets()` collect every clip edge in the
 * show on each call, and a clip drag asked up to three times per pointer
 * move: with a few thousand clips that is tens of thousands of edges per
 * move, plus a Set of the dragged ids each time. The edges a drag snaps to
 * are the ones it does NOT move, so they are collected once when it starts.
 * Only the playhead can move under a drag (a playing show), and it is read
 * fresh on every call; the snap options (zoom, grid, snap on/off) too.
 */
import { get } from 'svelte/store';
import { showTimeline, snapShowTime } from '../../../stores/showTimeline';

export interface DragSnapper {
  /** The magnetic targets right now (the playhead first), for snap guides.
   *  The same array every call: read it, do not keep it. */
  edges(): number[];
  /** `showTimeline.snapTime(t, exclude)` against the held edges. */
  snap(t: number): number;
  /** Magnetic targets only (edges, the playhead, markers), never a grid line. */
  magnet(t: number): number;
}

export function dragSnapper(exclude: Iterable<string> = []): DragSnapper {
  // `_snapEdges` puts the playhead first; that slot is refreshed per call.
  const held = showTimeline._snapEdges(new Set(exclude));
  const edges = (): number[] => {
    held[0] = get(showTimeline).currentTime;
    return held;
  };
  return {
    edges,
    snap: (t) => snapShowTime(t, edges(), showTimeline._snapOptions()),
    magnet: (t) => snapShowTime(t, edges(), { ...showTimeline._snapOptions(), nearestGrid: undefined, grid: 0 }),
  };
}

/**
 * Where a moving clip's start lands. The start snaps to the grid and to the
 * magnetic targets; the end only to magnetic targets (a neighbour's edge,
 * the playhead, a marker), so a clip butts up against the next one but is
 * never pulled off the grid by its own length. Whichever edge actually
 * found something nearer wins; neither: the pointer.
 */
export function snapMovingClip(snapper: Pick<DragSnapper, 'snap' | 'magnet'>, raw: number, duration: number): number {
  const a = snapper.snap(raw);
  const b = snapper.magnet(raw + duration) - duration;
  const pull = (v: number) => (Math.abs(v - raw) < 1e-9 ? Number.POSITIVE_INFINITY : Math.abs(v - raw));
  return pull(b) < pull(a) ? b : a;
}
