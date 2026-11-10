/**
 * "Detect tempo": seed the show's tempo map from an audio track on it.
 *
 * The song analysis (show/songLayout.ts) finds the tempo and the beats; the
 * first beat at or after the track's in-point becomes bar 1 beat 1, in show
 * time. There is no downbeat detection, so the inspector offers "Bar 1 here"
 * and "shift one beat" to put bar 1 where the music has it.
 */
import { get } from 'svelte/store';
import type { ShowAudioTrack, ShowTempoMap } from '../types';
import { showTimeline } from '../stores/showTimeline';
import { cachedShowAudioDecode, decodeShowAudio } from '../audio/showAudio';
import type { SongAnalysis } from './songLayout';
import { analyzeSongOffThread } from './songAnalysisClient';
import { tempoFromAnalysis } from './tempoMap';

export type TempoDetectResult =
  | { ok: true; map: ShowTempoMap; bpm: number; trackId: string }
  | { ok: false; reason: 'no-audio' | 'undecodable' | 'no-pulse' };

/** The track "Detect tempo" reads when none is named: the longest one. */
export function tempoSourceTrack(tracks: readonly ShowAudioTrack[], trackId?: string): ShowAudioTrack | null {
  if (trackId) return tracks.find((t) => t.id === trackId) ?? null;
  const usable = tracks.filter((t) => t.url);
  if (!usable.length) return null;
  return usable.reduce((a, b) => (b.duration > a.duration ? b : a));
}

/** A map from an analysis of `track`, or null without a steady pulse. */
export function tempoMapForTrack(analysis: Pick<SongAnalysis, 'tempo' | 'beats'>, track: Pick<ShowAudioTrack, 'id' | 'startTime' | 'offset'>): ShowTempoMap | null {
  return tempoFromAnalysis(analysis, { id: track.id, startTime: track.startTime, offset: track.offset });
}

/**
 * Analyse an audio track and, when it has a pulse, make its map the show's
 * (one undo step). The analysis runs in a worker (songAnalysisClient.ts),
 * as New show from audio's does, so a long mix does not freeze the app.
 */
export async function detectShowTempo(trackId?: string, opts: { apply?: boolean } = {}): Promise<TempoDetectResult> {
  const track = tempoSourceTrack(get(showTimeline).audioTracks, trackId);
  if (!track?.url) return { ok: false, reason: 'no-audio' };
  const decoded = cachedShowAudioDecode(track.url) ?? (await decodeShowAudio(track.url));
  if (!decoded) return { ok: false, reason: 'undecodable' };
  let analysis: SongAnalysis;
  try {
    analysis = await analyzeSongOffThread(decoded.mono, decoded.sampleRate);
  } catch (err) {
    console.warn('[ShowTempo] analysis failed:', err);
    return { ok: false, reason: 'no-pulse' };
  }
  const map = tempoMapForTrack(analysis, track);
  if (!map) return { ok: false, reason: 'no-pulse' };
  if (opts.apply !== false) showTimeline.setTempo(map);
  return { ok: true, map, bpm: map.segments[0].bpm, trackId: track.id };
}
