/**
 * Which upcoming show clips to get ready, so a cut lands on a decoded frame.
 *
 * While the show plays (4 times a second) and once after every seek, clips
 * starting within the next few seconds are prefetched: video as a paused
 * pre-roll under the source id and seek generation the clip will bind with,
 * so the session the core warmed is the one that plays; images as a decode.
 * Shaders and sketches are warmed by the scene itself (an invisible copy in
 * the last second, see showTrackScene.ts).
 *
 * A clip that carries on its run's decoder (the right half of a split) needs
 * nothing: that decoder is already running.
 */
import type { ShowLayerClip, ShowLayerTrack } from '../../types';
import { clipLoopStart, clipRate, clipRuns } from './showTrackEval';

export const SHOW_PRELOAD_HORIZON_SECONDS = 4;
export const SHOW_PRELOAD_MAX_RUNS = 6;

export interface ShowPreload {
  trackId: string;
  clip: ShowLayerClip;
  runId: string;
  kind: 'video' | 'image';
  /** Seconds until the clip starts. */
  startsIn: number;
  rate: number;
  loopStart: number;
}

export function selectShowPreloads(
  tracks: readonly ShowLayerTrack[],
  t: number,
  opts: { horizonSeconds?: number; maxRuns?: number; soloTrackId?: string | null } = {},
): ShowPreload[] {
  const horizon = opts.horizonSeconds ?? SHOW_PRELOAD_HORIZON_SECONDS;
  const max = opts.maxRuns ?? SHOW_PRELOAD_MAX_RUNS;
  const picks: ShowPreload[] = [];
  for (const track of tracks) {
    if (track.muted || (opts.soloTrackId && opts.soloTrackId !== track.id)) continue;
    const runs = clipRuns(track.clips);
    for (const clip of track.clips) {
      const startsIn = clip.startTime - t;
      if (startsIn <= 0) continue;
      if (startsIn > horizon) break;
      if (clip.media.kind !== 'video' && clip.media.kind !== 'image') continue;
      const runId = runs.get(clip.id) ?? clip.id;
      if (runId !== clip.id) continue;
      picks.push({ trackId: track.id, clip, runId, kind: clip.media.kind, startsIn, rate: clipRate(clip), loopStart: clipLoopStart(clip) });
    }
  }
  return picks.sort((a, b) => a.startsIn - b.startsIn).slice(0, max);
}
