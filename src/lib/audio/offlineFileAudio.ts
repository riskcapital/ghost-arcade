/**
 * Offline (virtual-time) analysis of a file audio source.
 *
 * ─── Why this exists ────────────────────────────────────────────────
 * The offline render advances every subsystem by exactly 1/fps per frame
 * while the capture itself runs at whatever pace the encoder allows. For
 * audio-reactive content that leaves two separate wall-clock couplings:
 *
 *   1. The follower's dt — fixed by `setVisualAudioManualTime()` /
 *      `pumpVisualAudio()` in `visualAudio.ts`. That alone makes every
 *      envelope / LFO / beat-phase advance the right AMOUNT.
 *   2. The audio CONTENT — what the analyser is looking at. For a file
 *      source, frame N of a 30 fps export should see the spectrum at
 *      N/30 seconds into the track, not the spectrum at whatever moment
 *      the encoder happened to reach.
 *
 * This module fixes (2).
 *
 * ─── Why not "seek the element and read the AnalyserNode" ───────────
 * That is how the splat texture video path solves the same problem
 * (`nativeRendererSync.ts`, `manualClockTime % duration`) — but it only
 * works because a <video> element hands out a decoded FRAME on seek. A
 * Web Audio AnalyserNode is a tap on a running graph: it only produces
 * data while samples are actually flowing through it. Seek a paused
 * <audio> element and the analyser reports silence decaying toward
 * minDecibels, so a per-frame seek + read yields nothing usable.
 *
 * So we take the documented fallback: decode the source once into an
 * AudioBuffer up front, then compute the FFT ourselves at an arbitrary
 * sample offset per exported frame. The resulting dB spectrum is fed
 * through a dedicated `AudioAnalyzer` instance via `analyzeBuffers()`,
 * which means bands, beat detection, BPM estimation and kick/snare
 * onsets all use the exact same code (and the exact same constants) as
 * live playback — just on a virtual clock. Note that an OfflineAudioContext
 * is no help here either: AnalyserNode does not run in one.
 */

import { AudioAnalyzer, type AudioAnalysis } from './analyzer';

/** Matches the live AnalyserNode's fftSize. */
export const OFFLINE_FFT_SIZE = 2048;
/** Matches AnalyserNode.smoothingTimeConstant used by the live analyser. */
export const OFFLINE_FFT_SMOOTHING = 0.8;

/** Blackman window — the window the Web Audio AnalyserNode applies before
 *  its FFT, so our spectrum lines up with the live one. */
export function blackmanWindow(size: number): Float32Array {
  const w = new Float32Array(size);
  const a0 = 0.42, a1 = 0.5, a2 = 0.08;
  for (let i = 0; i < size; i++) {
    const x = (2 * Math.PI * i) / (size - 1);
    w[i] = a0 - a1 * Math.cos(x) + a2 * Math.cos(2 * x);
  }
  return w;
}

/** In-place iterative radix-2 Cooley-Tukey FFT. `re`/`im` must be the same
 *  power-of-two length. Twiddles are evaluated directly rather than via a
 *  recurrence so error doesn't accumulate across the 11 stages. */
export function fftInPlace(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  if (n < 2 || (n & (n - 1)) !== 0) throw new Error(`fftInPlace: length must be a power of two, got ${n}`);

  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let j = 0; j < half; j++) {
        const wRe = Math.cos(ang * j);
        const wIm = Math.sin(ang * j);
        const a = i + j;
        const b = a + half;
        const vRe = re[b] * wRe - im[b] * wIm;
        const vIm = re[b] * wIm + im[b] * wRe;
        re[b] = re[a] - vRe;
        im[b] = im[a] - vIm;
        re[a] += vRe;
        im[a] += vIm;
      }
    }
  }
}

/** Floor for the dB conversion. The AnalyserNode would report -Infinity for
 *  a silent bin; downstream normalization clamps at -90 anyway, so a finite
 *  floor keeps every number in the pipeline well-behaved. */
const DB_FLOOR = -180;

/**
 * Virtual-time analyser over already-decoded PCM.
 *
 * Owns its own `AudioAnalyzer` instance so its beat history, BPM estimate,
 * onset running-averages and band smoothing are completely independent of
 * the live analyser's — an export must not disturb the live show's state,
 * and the live state must not leak into the export.
 */
export class OfflineFileAudioAnalyzer {
  private readonly mono: Float32Array;
  private readonly sampleRate: number;
  private readonly fftSize: number;
  private readonly binCount: number;
  private readonly window: Float32Array;
  private readonly re: Float32Array;
  private readonly im: Float32Array;
  /** Cross-frame magnitude smoothing, mirroring AnalyserNode's
   *  smoothingTimeConstant. */
  private readonly smoothedMag: Float32Array;
  private readonly fftDb: Float32Array;
  private readonly waveform: Float32Array;
  private readonly analyzer = new AudioAnalyzer();
  private readonly fftSmoothing: number;
  private started = false;

  constructor(
    mono: Float32Array,
    sampleRate: number,
    opts: { fftSize?: number; bandSmoothing?: number; fftSmoothing?: number } = {},
  ) {
    this.mono = mono;
    this.sampleRate = sampleRate > 0 ? sampleRate : 48000;
    this.fftSize = opts.fftSize ?? OFFLINE_FFT_SIZE;
    this.binCount = this.fftSize >> 1;
    this.window = blackmanWindow(this.fftSize);
    this.re = new Float32Array(this.fftSize);
    this.im = new Float32Array(this.fftSize);
    this.smoothedMag = new Float32Array(this.binCount);
    this.fftDb = new Float32Array(this.binCount);
    // The live analyser allocates its waveform buffer at frequencyBinCount
    // (not fftSize), so getFloatTimeDomainData only ever fills the first
    // half of the window. Match that exactly — the RMS the app calls
    // "amplitude" is computed over this many samples.
    this.waveform = new Float32Array(this.binCount);
    this.fftSmoothing = opts.fftSmoothing ?? OFFLINE_FFT_SMOOTHING;
    if (typeof opts.bandSmoothing === 'number') this.analyzer.setSmoothing(opts.bandSmoothing);
  }

  get durationSeconds(): number {
    return this.mono.length / this.sampleRate;
  }

  /**
   * Analyse the track at `timeSec`. Must be called with monotonically
   * increasing times — every detector downstream is stateful and models a
   * forward-running timeline.
   *
   * The analysis window is the `fftSize` samples ENDING at `timeSec`, which
   * is what the live AnalyserNode sees (it always reports the most recent
   * fftSize samples). Samples outside the buffer read as silence.
   */
  frameAt(timeSec: number): AudioAnalysis {
    const end = Math.round(Math.max(0, timeSec) * this.sampleRate);
    const start = end - this.fftSize;

    for (let i = 0; i < this.fftSize; i++) {
      const idx = start + i;
      const sample = idx >= 0 && idx < this.mono.length ? this.mono[idx] : 0;
      this.re[i] = sample * this.window[i];
      this.im[i] = 0;
      if (i < this.binCount) this.waveform[i] = sample;
    }

    fftInPlace(this.re, this.im);

    // The Web Audio spec normalizes the FFT output by fftSize before the
    // temporal smoothing and the dB conversion.
    const norm = 1 / this.fftSize;
    for (let k = 0; k < this.binCount; k++) {
      const mag = Math.sqrt(this.re[k] * this.re[k] + this.im[k] * this.im[k]) * norm;
      // Seed rather than smooth on the first frame so an export doesn't
      // open with an artificial fade-in from silence.
      this.smoothedMag[k] = this.started
        ? this.fftSmoothing * this.smoothedMag[k] + (1 - this.fftSmoothing) * mag
        : mag;
      this.fftDb[k] = this.smoothedMag[k] > 0
        ? Math.max(DB_FLOOR, 20 * Math.log10(this.smoothedMag[k]))
        : DB_FLOOR;
    }
    this.started = true;

    return this.analyzer.analyzeBuffers(
      this.fftDb,
      this.waveform,
      this.sampleRate,
      Math.max(0, timeSec) * 1000,
    );
  }
}

/** Downmix every channel of a decoded buffer to a single mono track — the
 *  live analyser taps a mono-summed node too. */
export function monoFromAudioBuffer(buffer: AudioBuffer): Float32Array {
  const channels = buffer.numberOfChannels;
  const length = buffer.length;
  const mono = new Float32Array(length);
  if (channels === 0) return mono;
  for (let c = 0; c < channels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < length; i++) mono[i] += data[i];
  }
  if (channels > 1) {
    const inv = 1 / channels;
    for (let i = 0; i < length; i++) mono[i] *= inv;
  }
  return mono;
}

export interface OfflineFileAudioSession {
  analyzer: OfflineFileAudioAnalyzer;
  /** Where in the track the export starts — wherever the user had the
   *  playhead parked when they hit render. */
  startOffsetSeconds: number;
  /** Wrap back to the start when the export runs past the end, matching the
   *  element's own loop setting (and the splat texture video precedent). */
  loop: boolean;
  durationSeconds: number;
  /** Human-readable source description for the console breadcrumb. */
  label: string;
}

/**
 * Decode the media element currently feeding the analyser so the export can
 * analyse it at virtual time.
 *
 * Returns null (with a console warning) whenever that isn't possible — no
 * element, an unfetchable src, an undecodable container. The caller then
 * falls back to pinning the follower alone, which still removes the
 * time-compression of every envelope and LFO.
 */
export async function prepareOfflineFileAudio(
  element: HTMLAudioElement | HTMLVideoElement | null,
  audioContext: BaseAudioContext | null,
  opts: {
    /** Where in the track the export starts. Read by the caller BEFORE the
     *  decode, so a slow decode can't let the playhead drift. */
    startOffsetSeconds: number;
    /** Mirror of the live analyser's band smoothing. */
    bandSmoothing?: number;
  },
): Promise<OfflineFileAudioSession | null> {
  if (!element || !audioContext) return null;
  const src = element.currentSrc || element.src;
  if (!src) {
    console.warn('[offlineFileAudio] file input has no resolvable src — audio content stays on the wall clock');
    return null;
  }
  try {
    const response = await fetch(src);
    if (!response.ok) throw new Error(`fetch ${response.status}`);
    const bytes = await response.arrayBuffer();
    const decoded = await audioContext.decodeAudioData(bytes);
    const mono = monoFromAudioBuffer(decoded);
    const startOffsetSeconds = Math.max(0, Number.isFinite(opts.startOffsetSeconds) ? opts.startOffsetSeconds : 0);
    return {
      analyzer: new OfflineFileAudioAnalyzer(mono, decoded.sampleRate, { bandSmoothing: opts.bandSmoothing }),
      startOffsetSeconds,
      loop: !!element.loop,
      durationSeconds: decoded.duration,
      label: src.length > 96 ? `${src.slice(0, 93)}...` : src,
    };
  } catch (err) {
    console.warn('[offlineFileAudio] could not decode the file source for virtual-time analysis:', err);
    return null;
  }
}

/** Map an export's virtual time onto a position in the decoded track. */
export function offlineFileAudioTime(session: OfflineFileAudioSession, virtualTime: number): number {
  const raw = session.startOffsetSeconds + Math.max(0, virtualTime);
  if (session.loop && session.durationSeconds > 0) return raw % session.durationSeconds;
  return raw;
}
