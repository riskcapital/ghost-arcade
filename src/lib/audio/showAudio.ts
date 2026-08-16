/**
 * Show-timeline audio helpers — decoding, waveform peaks, and the
 * virtual-time mixdown the offline renderer analyses.
 *
 * Deliberately store-free: everything here takes plain `ShowAudioTrack[]`
 * so `showTimeline.ts` (which needs peaks) and `offlineRender.ts` (which
 * needs the mixdown) can both use it without an import cycle.
 *
 * LIVE playback does NOT go through this module — that runs through
 * `clipAudioBus` on real HTMLAudioElements. This is only for (a) drawing
 * waveforms and (b) giving an offline export the same audio-reactive
 * signal the live show would have had.
 */

import type { ShowAudioTrack } from '../types';
import {
  OfflineFileAudioAnalyzer,
  monoFromAudioBuffer,
  type OfflineFileAudioSession,
} from './offlineFileAudio';

/** How many buckets a persisted waveform envelope holds. 512 is enough to
 *  read the shape of a 10-minute track at any zoom the panel offers and
 *  costs ~2 KB of JSON per track. */
export const SHOW_PEAK_BUCKETS = 512;

export interface DecodedShowAudio {
  mono: Float32Array;
  sampleRate: number;
  duration: number;
}

/** Decoded PCM keyed by runtime URL. Audio files are large and a show can
 *  reference the same file twice; decode once per session. */
const decodeCache = new Map<string, DecodedShowAudio>();
const inFlight = new Map<string, Promise<DecodedShowAudio | null>>();

/** Drop a cached decode (URL was replaced or the track removed). */
export function forgetShowAudioDecode(url: string): void {
  decodeCache.delete(url);
  inFlight.delete(url);
}

export function clearShowAudioDecodeCache(): void {
  decodeCache.clear();
  inFlight.clear();
}

/** Peek at the cache without triggering a decode. */
export function cachedShowAudioDecode(url: string): DecodedShowAudio | null {
  return decodeCache.get(url) ?? null;
}

function decodeContext(): BaseAudioContext | null {
  const g = globalThis as unknown as Record<string, unknown>;
  const Offline = (g.OfflineAudioContext ?? g.webkitOfflineAudioContext) as
    | (new (channels: number, length: number, sampleRate: number) => BaseAudioContext)
    | undefined;
  if (Offline) {
    try {
      return new Offline(1, 1, 44100);
    } catch {
      /* fall through */
    }
  }
  const Standard = (g.AudioContext ?? g.webkitAudioContext) as (new () => BaseAudioContext) | undefined;
  if (Standard) {
    try {
      return new Standard();
    } catch {
      /* no WebAudio in this environment */
    }
  }
  return null;
}

/**
 * Fetch + decode a track's source once.
 *
 * Returns null (with a warning) whenever that isn't possible — a blanked
 * URL, an unreachable path, an undecodable container. Callers degrade:
 * the waveform stays flat, and an export falls back to whatever live
 * analysis input the user had.
 */
export async function decodeShowAudio(url: string): Promise<DecodedShowAudio | null> {
  if (!url) return null;
  const cached = decodeCache.get(url);
  if (cached) return cached;
  const pending = inFlight.get(url);
  if (pending) return pending;

  const job = (async (): Promise<DecodedShowAudio | null> => {
    const ctx = decodeContext();
    if (!ctx) return null;
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`fetch ${response.status}`);
      const bytes = await response.arrayBuffer();
      const buffer = await ctx.decodeAudioData(bytes);
      const decoded: DecodedShowAudio = {
        mono: monoFromAudioBuffer(buffer),
        sampleRate: buffer.sampleRate,
        duration: buffer.duration,
      };
      decodeCache.set(url, decoded);
      return decoded;
    } catch (err) {
      console.warn('[showAudio] could not decode show audio track:', err);
      return null;
    } finally {
      inFlight.delete(url);
    }
  })();

  inFlight.set(url, job);
  return job;
}

/**
 * Coarse absolute-peak envelope, quantised to 0..255.
 *
 * Peak (not RMS) because the panel is drawing a shape the operator uses to
 * find downbeats and drops by eye — RMS flattens exactly the transients
 * they are looking for.
 */
export function computeAudioPeaks(mono: Float32Array, buckets = SHOW_PEAK_BUCKETS): number[] {
  const count = Math.max(1, Math.floor(buckets));
  const out = new Array<number>(count).fill(0);
  if (mono.length === 0) return out;
  const per = mono.length / count;
  for (let b = 0; b < count; b++) {
    const start = Math.floor(b * per);
    const end = Math.min(mono.length, Math.max(start + 1, Math.floor((b + 1) * per)));
    let peak = 0;
    // Stride large buckets — a 10-minute track at 48 kHz is 28.8M samples
    // and the envelope does not get more honest by touching every one.
    const stride = Math.max(1, Math.floor((end - start) / 4096));
    for (let i = start; i < end; i += stride) {
      const v = Math.abs(mono[i]);
      if (v > peak) peak = v;
    }
    out[b] = Math.max(0, Math.min(255, Math.round(peak * 255)));
  }
  return out;
}

/**
 * Build one mono mixdown of the whole show and wrap it in the same
 * `OfflineFileAudioSession` the file-input export path uses, so the
 * renderer's per-frame `analyzer.frameAt(offlineFileAudioTime(...))` call
 * is byte-for-byte the same code.
 *
 * Every track is summed at its own `startTime` with its own `volume`, then
 * the result is peak-normalised only if summing pushed it past full scale
 * (so a single quiet track stays quiet — we are matching what the speakers
 * would have produced, not mastering).
 *
 * Returns null when nothing decodable is on the timeline.
 */
export async function prepareShowOfflineAudio(
  tracks: ShowAudioTrack[],
  showDuration: number,
  opts: { loop?: boolean; bandSmoothing?: number } = {},
): Promise<OfflineFileAudioSession | null> {
  const audible = tracks.filter((t) => !t.muted && t.url && t.duration > 0);
  if (audible.length === 0) return null;

  const decoded: Array<{ track: ShowAudioTrack; pcm: DecodedShowAudio }> = [];
  for (const track of audible) {
    const pcm = await decodeShowAudio(track.url);
    if (pcm) decoded.push({ track, pcm });
  }
  if (decoded.length === 0) return null;

  // Everything is resampled onto the highest source rate present so no
  // track loses bandwidth relative to how it plays live.
  const sampleRate = decoded.reduce((max, d) => Math.max(max, d.pcm.sampleRate), 0) || 48000;
  const lengthSeconds = Math.max(
    showDuration,
    ...decoded.map(({ track }) => track.startTime + track.duration),
  );
  const totalSamples = Math.max(1, Math.ceil(lengthSeconds * sampleRate));
  const mix = new Float32Array(totalSamples);

  for (const { track, pcm } of decoded) {
    const ratio = pcm.sampleRate / sampleRate;
    const destStart = Math.round(track.startTime * sampleRate);
    const destCount = Math.round(track.duration * sampleRate);
    const srcOffset = track.offset * pcm.sampleRate;
    const gain = Math.max(0, Math.min(1, track.volume));
    if (gain === 0) continue;
    for (let i = 0; i < destCount; i++) {
      const dest = destStart + i;
      if (dest < 0) continue;
      if (dest >= totalSamples) break;
      // Nearest-neighbour resample. The consumer is a 2048-point FFT that
      // gets smoothed across frames; interpolation error here is far below
      // what the band extraction can see.
      const src = Math.round(srcOffset + i * ratio);
      if (src < 0 || src >= pcm.mono.length) continue;
      mix[dest] += pcm.mono[src] * gain;
    }
  }

  let peak = 0;
  for (let i = 0; i < totalSamples; i++) {
    const v = Math.abs(mix[i]);
    if (v > peak) peak = v;
  }
  if (peak > 1) {
    const inv = 1 / peak;
    for (let i = 0; i < totalSamples; i++) mix[i] *= inv;
  }

  return {
    analyzer: new OfflineFileAudioAnalyzer(mix, sampleRate, { bandSmoothing: opts.bandSmoothing }),
    startOffsetSeconds: 0,
    loop: opts.loop === true,
    durationSeconds: totalSamples / sampleRate,
    label: `show timeline (${decoded.length} track${decoded.length === 1 ? '' : 's'})`,
  };
}
