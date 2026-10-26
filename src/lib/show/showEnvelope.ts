/**
 * One waveform for the whole show: every audible track's peak envelope laid
 * on show time, the loudest wins per bucket. Used by the compact soundtrack
 * bar in VJ mode, which has room for one strip, not one per lane.
 */
import type { ShowAudioTrack } from '../types';

type EnvelopeTrack = Pick<ShowAudioTrack, 'startTime' | 'duration' | 'offset' | 'sourceDuration' | 'volume' | 'muted' | 'peaks'>;

/** `buckets` values in 0..1 across [0, showDuration). */
export function showEnvelope(tracks: EnvelopeTrack[], showDuration: number, buckets: number): number[] {
  const count = Math.max(1, Math.floor(buckets));
  const out = new Array<number>(count).fill(0);
  if (!(showDuration > 0)) return out;
  const step = showDuration / count;
  for (const track of tracks) {
    const peaks = track.peaks;
    if (track.muted || !peaks || peaks.length === 0 || !(track.duration > 0)) continue;
    const source = track.sourceDuration > 0 ? track.sourceDuration : track.duration + track.offset;
    if (!(source > 0)) continue;
    const level = Math.max(0, Math.min(1, track.volume));
    const first = Math.max(0, Math.floor(track.startTime / step));
    const last = Math.min(count - 1, Math.ceil((track.startTime + track.duration) / step) - 1);
    for (let b = first; b <= last; b++) {
      // Source time at the middle of the bucket, clamped into the track's window.
      const showTime = Math.min(track.startTime + track.duration, Math.max(track.startTime, (b + 0.5) * step));
      const sourceTime = showTime - track.startTime + track.offset;
      const index = Math.min(peaks.length - 1, Math.max(0, Math.floor((sourceTime / source) * peaks.length)));
      const value = ((peaks[index] ?? 0) / 255) * level;
      if (value > out[b]) out[b] = value;
    }
  }
  return out;
}
