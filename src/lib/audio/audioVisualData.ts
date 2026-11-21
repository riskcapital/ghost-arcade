// Analyser frame -> the audio packet the native core's audio-reactive
// instruments read (Strands, Cloud Pulse, ...): a log-spaced spectrum, a
// triggered waveform, per-band onset envelopes and a ring of recent hits.
//
// Built from the analysis the editor already has (no second analyser) and
// sent inside the existing per-frame `set_audio_spectrum` command as
// `visual_b64`, only while a layer that reads it is showing.
//
// The layout is a flat little-endian f32 array; it is mirrored in
// native-renderer/src/audio_visuals/audio_data.rs and audio_data.wgsl.
//
// Deterministic: everything depends only on the sequence of (analysis, time)
// it is given. The sync passes the render clock, so an offline render (frame
// locked, analysis injected per frame from the decoded file) packs the same
// hits at the same times on every run.

import type { AudioAnalysis } from './analyzer';

export const AV_VERSION = 1;
export const AV_HEADER_FLOATS = 16;
export const AV_EVENT_CAPACITY = 32;
export const AV_EVENT_FLOATS = 4;
export const AV_SPECTRUM_BINS = 128;
export const AV_WAVEFORM_SAMPLES = 512;
export const AV_EVENTS_OFFSET = AV_HEADER_FLOATS;
export const AV_SPECTRUM_OFFSET = AV_EVENTS_OFFSET + AV_EVENT_CAPACITY * AV_EVENT_FLOATS;
export const AV_WAVEFORM_OFFSET = AV_SPECTRUM_OFFSET + AV_SPECTRUM_BINS;
export const AV_TOTAL_FLOATS = AV_WAVEFORM_OFFSET + AV_WAVEFORM_SAMPLES;

export const AV_H = {
  version: 0,
  time: 1,
  active: 2,
  eventCount: 3,
  level: 4,
  envBass: 5,
  envMid: 6,
  envHigh: 7,
  bass: 8,
  mid: 9,
  high: 10,
  beatPhase: 11,
  bpm: 12,
  spectrumBins: 13,
  waveformSamples: 14,
  eventSeq: 15,
} as const;

export type OnsetBand = 0 | 1 | 2;

/** Hz ranges of the three onset bands (bass, mid, high). */
const BANDS: ReadonlyArray<{ lo: number; hi: number; minGap: number; floor: number; decay: number }> = [
  { lo: 30, hi: 160, minGap: 0.16, floor: 0.035, decay: 0.26 },
  { lo: 160, hi: 2800, minGap: 0.11, floor: 0.025, decay: 0.16 },
  { lo: 2800, hi: 16000, minGap: 0.08, floor: 0.02, decay: 0.1 },
];
const SPECTRUM_LO_HZ = 30;
const SPECTRUM_HI_HZ = 16000;
/** Flux history per band: the last 0.7 s, whatever the frame rate (a 30 fps
 *  render must find the same hits as the 60 Hz live analyser). Capacity
 *  covers 0.7 s at up to 180 frames per second. */
const FLUX_HISTORY_SECONDS = 0.7;
const FLUX_HISTORY = 128;
const THRESHOLD_SIGMAS = 1.6;
/** Seconds for the loudness followers (spectrum and per-band peaks) to fall
 *  back after a loud passage. */
const PEAK_RELEASE_SECONDS = 6;
/** Waveform ends taper to zero over this fraction, so a closed shape's seam
 *  (u = 0 and u = 1) reads the same value on both sides. */
const WAVE_TAPER = 0.08;

/**
 * Hits from one sound's own notes instead of the spectrum's onsets (a voice
 * following a source): a rising `hit` (vxHit) is one hit in `band`, and `env`
 * (vxEnv) is the level and that band's envelope.
 */
export interface SourceHits {
  hit: number;
  env: number;
  band: OnsetBand;
}

export interface AudioVisualPackerOptions {
  /** The analyser's sample rate; sets where the FFT bins fall in Hz. */
  sampleRate?: number;
}

export interface AudioVisualPacker {
  /** Pack the frame at `timeSeconds` (the render clock). Returns the packet,
   *  or null when there is no analysis. A repeat call at the same or an
   *  earlier time returns the previous packet unchanged. */
  pack(analysis: AudioAnalysis | null | undefined, timeSeconds: number, hits?: SourceHits): Float32Array | null;
  /** `pack`, base64-encoded for the command. */
  encode(analysis: AudioAnalysis | null | undefined, timeSeconds: number, hits?: SourceHits): string | null;
  /** Forget onset history (a new song, playback stopped). Keeps the event
   *  sequence so the core never sees an old sequence number as new. */
  reset(): void;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x2000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode.apply(
      null,
      bytes.subarray(offset, Math.min(bytes.length, offset + chunk)) as unknown as number[],
    );
  }
  return btoa(binary);
}

const normalizeDb = (db: number) => {
  const v = Math.max(0, Math.min(1, (db + 80) / 60));
  return Number.isFinite(v) ? v : 0;
};

class FluxBand {
  readonly history = new Float32Array(FLUX_HISTORY);
  readonly times = new Float64Array(FLUX_HISTORY);
  filled = 0;
  head = 0;
  previous = -1;
  lastOnset = -1e9;
  envelope = 0;
  level = 0;
  /** Recent peak energy: quiet material (a soft hi-hat bed) still finds its
   *  hits, because the absolute floor shrinks with it. */
  peak = 0;

  reset() {
    this.history.fill(0);
    this.times.fill(0);
    this.filled = 0;
    this.head = 0;
    this.previous = -1;
    this.lastOnset = -1e9;
    this.envelope = 0;
    this.level = 0;
    this.peak = 0;
  }

  /** Feed one band energy; returns the onset strength, or 0. */
  step(energy: number, time: number, dt: number, band: (typeof BANDS)[number]): number {
    const flux = this.previous < 0 ? 0 : Math.max(0, energy - this.previous);
    this.previous = energy;
    // Statistics over the entries still inside the time window.
    let mean = 0;
    let used = 0;
    for (let i = 0; i < this.filled; i += 1) {
      if (time - this.times[i] > FLUX_HISTORY_SECONDS) continue;
      mean += this.history[i];
      used += 1;
    }
    mean = used ? mean / used : 0;
    let variance = 0;
    for (let i = 0; i < this.filled; i += 1) {
      if (time - this.times[i] > FLUX_HISTORY_SECONDS) continue;
      variance += (this.history[i] - mean) ** 2;
    }
    const sigma = used ? Math.sqrt(variance / used) : 0;
    this.peak = Math.max(energy, this.peak * Math.exp(-dt / PEAK_RELEASE_SECONDS));
    const floor = band.floor * Math.max(0.15, Math.min(1, this.peak / 0.5));
    const threshold = Math.max(floor, mean + THRESHOLD_SIGMAS * sigma);
    this.history[this.head] = flux;
    this.times[this.head] = time;
    this.head = (this.head + 1) % FLUX_HISTORY;
    this.filled = Math.min(FLUX_HISTORY, this.filled + 1);
    this.envelope *= Math.exp(-dt / band.decay);
    const target = Math.max(0, Math.min(1, (energy - 0.15) / 0.6));
    this.level += (target - this.level) * (target > this.level ? 0.5 : 0.08);
    if (used < 4 || flux <= threshold || time - this.lastOnset < band.minGap) return 0;
    this.lastOnset = time;
    const strength = Math.max(0.3, Math.min(1.6, flux / (threshold * 1.5)));
    this.envelope = Math.max(this.envelope, Math.min(1, strength));
    return strength;
  }
}

export function createAudioVisualPacker(options: AudioVisualPackerOptions = {}): AudioVisualPacker {
  const sampleRate = options.sampleRate ?? 48000;
  const floats = new Float32Array(AV_TOTAL_FLOATS);
  const bytes = new Uint8Array(floats.buffer);
  const bands = BANDS.map(() => new FluxBand());
  // Ring of recent hits, newest first: [time, band, strength, seq] each.
  const ring = new Float32Array(AV_EVENT_CAPACITY * AV_EVENT_FLOATS);
  let ringCount = 0;
  let eventSeq = 0;
  let lastTime = Number.NEGATIVE_INFINITY;
  let hasPacket = false;
  /** Spectrum loudness follower: a quiet mix still fills the 0..1 range. */
  let spectrumPeak = 0;
  /** The last source hit flash, so only a rising one counts. */
  let lastHit = 0;

  const pushEvent = (time: number, band: OnsetBand, strength: number) => {
    ring.copyWithin(AV_EVENT_FLOATS, 0, (AV_EVENT_CAPACITY - 1) * AV_EVENT_FLOATS);
    eventSeq += 1;
    ring[0] = time;
    ring[1] = band;
    ring[2] = strength;
    ring[3] = eventSeq;
    ringCount = Math.min(AV_EVENT_CAPACITY, ringCount + 1);
  };

  const binAt = (hz: number, bins: number) => (hz / (sampleRate / 2)) * bins;

  const pack: AudioVisualPacker['pack'] = (analysis, timeSeconds, hits) => {
    if (!analysis?.fftData?.length) return null;
    if (hasPacket && !(timeSeconds > lastTime)) return floats;
    const dt = Number.isFinite(lastTime) ? Math.min(0.25, timeSeconds - lastTime) : 1 / 60;
    lastTime = timeSeconds;
    hasPacket = true;
    const fft = analysis.fftData;
    const n = fft.length;

    // Log-spaced spectrum: each bin keeps its range's peak; narrow low bins
    // interpolate between FFT lines instead of repeating one.
    const ratio = SPECTRUM_HI_HZ / SPECTRUM_LO_HZ;
    for (let k = 0; k < AV_SPECTRUM_BINS; k += 1) {
      const f0 = SPECTRUM_LO_HZ * ratio ** (k / AV_SPECTRUM_BINS);
      const f1 = SPECTRUM_LO_HZ * ratio ** ((k + 1) / AV_SPECTRUM_BINS);
      const i0 = binAt(f0, n);
      const i1 = binAt(f1, n);
      let value: number;
      if (i1 - i0 < 1) {
        const x = Math.min(n - 1.001, (i0 + i1) / 2);
        const a = Math.floor(x);
        value = normalizeDb(fft[a]) * (1 - (x - a)) + normalizeDb(fft[a + 1]) * (x - a);
      } else {
        value = 0;
        for (let i = Math.floor(i0); i < Math.min(n, Math.ceil(i1)); i += 1) value = Math.max(value, normalizeDb(fft[i]));
      }
      // Music falls off with frequency; a gentle tilt keeps the top visible.
      floats[AV_SPECTRUM_OFFSET + k] = value * (0.9 + (k / AV_SPECTRUM_BINS) * 0.35);
    }
    let frameMax = 0;
    for (let k = 0; k < AV_SPECTRUM_BINS; k += 1) frameMax = Math.max(frameMax, floats[AV_SPECTRUM_OFFSET + k]);
    spectrumPeak = Math.max(frameMax, spectrumPeak * Math.exp(-dt / PEAK_RELEASE_SECONDS), 0.25);
    for (let k = 0; k < AV_SPECTRUM_BINS; k += 1) {
      const v = Math.min(1, floats[AV_SPECTRUM_OFFSET + k] / spectrumPeak);
      floats[AV_SPECTRUM_OFFSET + k] = v * v;
    }

    // Onsets: positive flux of each band's mean level against its own recent
    // history (adaptive threshold), with a per-band minimum gap.
    for (let b = 0; b < BANDS.length; b += 1) {
      const band = BANDS[b];
      const i0 = Math.max(0, Math.floor(binAt(band.lo, n)));
      const i1 = Math.min(n, Math.max(i0 + 1, Math.ceil(binAt(band.hi, n))));
      let sum = 0;
      for (let i = i0; i < i1; i += 1) sum += normalizeDb(fft[i]);
      const strength = bands[b].step(sum / (i1 - i0), timeSeconds, dt, band);
      if (strength > 0 && !hits) pushEvent(timeSeconds, b as OnsetBand, strength);
    }

    // Waveform from a rising zero crossing (a stable trace frame to frame),
    // tapered at both ends.
    const wave = analysis.waveformData;
    if (wave?.length) {
      const span = Math.min(wave.length, AV_WAVEFORM_SAMPLES * 4);
      let trigger = 0;
      for (let i = 1; i < wave.length - span; i += 1) {
        if (wave[i - 1] < 0 && wave[i] >= 0) {
          trigger = i;
          break;
        }
      }
      const step = Math.max(1, Math.floor((wave.length - trigger) / AV_WAVEFORM_SAMPLES));
      for (let s = 0; s < AV_WAVEFORM_SAMPLES; s += 1) {
        const v = wave[Math.min(wave.length - 1, trigger + s * step)];
        const u = s / (AV_WAVEFORM_SAMPLES - 1);
        const edge = Math.min(u, 1 - u) / WAVE_TAPER;
        const taper = edge >= 1 ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * edge);
        floats[AV_WAVEFORM_OFFSET + s] = Math.max(-1, Math.min(1, Number.isFinite(v) ? v : 0)) * taper;
      }
    } else {
      floats.fill(0, AV_WAVEFORM_OFFSET, AV_WAVEFORM_OFFSET + AV_WAVEFORM_SAMPLES);
    }

    if (hits) {
      const hit = Math.max(0, Math.min(1, hits.hit || 0));
      if (hit > 0.5 && hit > lastHit + 0.05) pushEvent(timeSeconds, hits.band, Math.max(0.3, hit));
      lastHit = hit;
      const env = Math.max(0, Math.min(1, hits.env || 0));
      for (let b = 0; b < bands.length; b += 1) {
        bands[b].envelope = b === hits.band ? Math.max(env, bands[b].envelope) : 0;
      }
    }
    floats[AV_H.version] = AV_VERSION;
    floats[AV_H.time] = timeSeconds;
    floats[AV_H.active] = 1;
    floats[AV_H.eventCount] = ringCount;
    floats[AV_H.level] = Math.max(0, Math.min(1.5, hits ? Math.max(hits.env || 0, analysis.amplitude || 0) : analysis.amplitude || 0));
    floats[AV_H.envBass] = bands[0].envelope;
    floats[AV_H.envMid] = bands[1].envelope;
    floats[AV_H.envHigh] = bands[2].envelope;
    floats[AV_H.bass] = bands[0].level;
    floats[AV_H.mid] = bands[1].level;
    floats[AV_H.high] = bands[2].level;
    floats[AV_H.beatPhase] = Math.max(0, Math.min(1, analysis.beatPhase || 0));
    floats[AV_H.bpm] = Math.max(0, Math.min(300, analysis.bpm || 0));
    floats[AV_H.spectrumBins] = AV_SPECTRUM_BINS;
    floats[AV_H.waveformSamples] = AV_WAVEFORM_SAMPLES;
    floats[AV_H.eventSeq] = eventSeq;
    floats.set(ring, AV_EVENTS_OFFSET);
    return floats;
  };

  return {
    pack,
    encode(analysis, timeSeconds, hits) {
      return pack(analysis, timeSeconds, hits) ? bytesToBase64(bytes) : null;
    },
    reset() {
      for (const band of bands) band.reset();
      ring.fill(0);
      ringCount = 0;
      lastTime = Number.NEGATIVE_INFINITY;
      hasPacket = false;
      spectrumPeak = 0;
      lastHit = 0;
    },
  };
}
