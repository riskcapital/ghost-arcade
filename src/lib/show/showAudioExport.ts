/**
 * The show's soundtrack in "Render to Video": which tracks go into the file
 * and where each one comes from on disk. The mixing itself is done by the
 * bundled ffmpeg in the main process (electron/show-audio.cjs).
 */
import type { ShowAudioTrack } from '../types';
import { clipFilePath } from '../vj/clipFiles';

export interface ShowMuxTrack {
  path: string;
  startTime: number;
  offset: number;
  duration: number;
  volume: number;
}

/** The file on disk a show track plays from, or null (a browser blob, a missing file). */
export function showTrackFilePath(track: Pick<ShowAudioTrack, 'url' | 'assetRef'>): string | null {
  return clipFilePath({ src: track.url, _assetRef: track.assetRef });
}

/** Audible tracks with a file on disk, as the mux wants them. */
export function showMuxTracks(
  tracks: ShowAudioTrack[],
  pathOf: (track: ShowAudioTrack) => string | null = showTrackFilePath,
): ShowMuxTrack[] {
  const out: ShowMuxTrack[] = [];
  for (const track of tracks) {
    if (track.muted || !(track.volume > 0) || !(track.duration > 0)) continue;
    const path = pathOf(track);
    if (!path) continue;
    out.push({
      path,
      startTime: Math.max(0, track.startTime),
      offset: Math.max(0, track.offset),
      duration: track.duration,
      volume: Math.max(0, Math.min(1, track.volume)),
    });
  }
  return out;
}
