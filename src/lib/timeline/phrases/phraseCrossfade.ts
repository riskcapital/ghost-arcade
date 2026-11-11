/**
 * The hand-over between two phrases: for a moment the old phrase (evaluated
 * where it would have been) fades out under the new one, on every piece and
 * look. Pure: two evaluated frames in, one frame out.
 *
 * Per piece row:
 *   same block on both sides      the new frame as it is (nothing to fade)
 *   a block on both sides         the new block fades in over the old one,
 *                                 drawn by the row's crossfade copy (the
 *                                 same path as a block's own dissolve)
 *   only the old side has one     the old block fades out
 *   only the new side has one     the new block fades in
 * A row already inside a block dissolve keeps it (no third picture).
 *
 * Looks: the new looks ramp in, the old ones out; a look on both sides stays.
 */
import { compositionTransitionWeights } from '../../renderer/compositionTransitionLayers';
import type { ShowTrackFrame, ShowTrackState } from '../../show/tracks/showTrackEval';
import type { ShowLookState } from '../../show/tracks/showLooks';

function mixRow(next: ShowTrackState, old: ShowTrackState | undefined, p: number): ShowTrackState {
  if (!old || next.xfade || old.xfade) return next;
  const w = compositionTransitionWeights('dissolve', p);
  const oldVisible = old.clip !== null && old.opacity > 0;
  if (next.clip && old.clip && next.clip.clipId === old.clip.clipId) return next;
  if (next.clip && oldVisible) {
    return {
      ...next,
      opacity: next.opacity * w.incoming,
      xfade: { clip: old.clip!, opacity: old.opacity * w.outgoing, progress: p },
    };
  }
  if (!next.clip && oldVisible) {
    return { ...next, clip: old.clip, opacity: old.opacity * w.outgoing, params: old.params, warm: null };
  }
  if (next.clip && !old.clip) return { ...next, opacity: next.opacity * w.incoming };
  return next;
}

/** `next` with `old` fading out under it, `p` (0..1) of the way through. */
export function crossfadeTrackFrames(next: ShowTrackFrame, old: ShowTrackFrame, p: number): ShowTrackFrame {
  if (p >= 1) return next;
  const byId = new Map(old.tracks.map((t) => [t.trackId, t]));
  return { ...next, tracks: next.tracks.map((t) => mixRow(t, byId.get(t.trackId), Math.max(0, p))) };
}

/** The new looks ramping in over the old ones. */
export function crossfadeLooks(next: readonly ShowLookState[], old: readonly ShowLookState[], p: number): ShowLookState[] {
  if (p >= 1) return [...next];
  const w = compositionTransitionWeights('dissolve', Math.max(0, p));
  const nextIds = new Set(next.map((l) => l.clipId));
  const oldIds = new Set(old.map((l) => l.clipId));
  const out: ShowLookState[] = [];
  for (const l of old) if (!nextIds.has(l.clipId) && l.weight * w.outgoing > 0) out.push({ ...l, weight: l.weight * w.outgoing });
  for (const l of next) out.push(oldIds.has(l.clipId) ? l : { ...l, weight: l.weight * w.incoming });
  return out.filter((l) => l.weight > 0);
}
