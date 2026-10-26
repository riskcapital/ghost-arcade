// Mobile standalone audio analyser. Publishes the same uniform set the
// desktop renderer publishes (verified by 2026-06-03 shader audit):
//   audioBass, audioMid, audioHigh, audioLevel, audioBeat
// All values are normalized 0..1. `audioBeat` is a transient pulse that
// decays — the desktop codebase uses this as the dominant audio signal,
// so the standalone engine matches.
//
// 2026-06 — band scalars (Bass/Mid/High/Level) now flow through a
// Milkdrop-style two-stage IIR smoother before being exposed as the
// `audio*` uniforms. The smoother gives:
//   • asymmetric attack (rate=0.2) / release (rate=0.5) — fast rise on
//     a hit, slow fall (no woofer-pulse back-and-forth)
//   • long-baseline normalisation (~30s window) — ratio of current to
//     song's running level, so loud and quiet songs look the same on
//     the shaders without the visualiser blowing out
//   • framerate-independent decay (pow(rate, 30*dt)) — phone framerate
//     drops to 30fps mid-set don't change the smoothing feel
// Output is re-mapped to 0..1 so existing shaders (`* audioBass`,
// `audioBeat * 0.55`, etc.) keep the same value range they expect.
// `audioBeat` keeps its onset-envelope behaviour (still smooth enough
// at 0.9 decay ≈ 250ms).
//
// On the iPhone and iPad app the spectrum and waveform come from the native
// analyser (nativeAudio.ts), which matches the AnalyserNode byte for byte, so
// the same smoothing runs on the microphone, the app's player or other apps'
// sound. Elsewhere the web microphone feeds an AnalyserNode as before.

import { acquireNativeAudio, AUDIO_BINS, hasNativeAudio, type AudioSourceKind, type NativeAudioHandle } from './nativeAudio';

export interface AudioUniforms {
  spectrum?: Uint8Array<ArrayBuffer>;
  waveform?: Uint8Array<ArrayBuffer>;
  audioBass: number;
  audioMid: number;
  audioHigh: number;
  audioLevel: number;
  audioBeat: number;
  /** 0..1 through the current beat, once a tempo is detected. */
  audioBeatPhase?: number;
  /** Detected tempo, 0 until there are enough beats. */
  audioBPM?: number;
  /** Brightness of the sound, 0 (dark) .. 1 (bright). */
  audioSpectralCentroid?: number;
}

/** Milkdrop-style smoother for one band. Maintains a fast short-term
 *  average (asymmetric attack/release) and a slow long-term baseline,
 *  exposes `current / longAverage` and `average / longAverage` as
 *  normalised ratios that float around 1.0. */
class BandFollower {
  current = 0;
  average = 0;
  longAverage = 0;
  private frame = 0;
  /** Smoothed normalised ratio (the "bass_att" output). */
  smoothed = 1;

  update(raw: number, dt: number): void {
    this.current = raw;
    this.frame++;
    // Asymmetric short smoothing — rate 0.2 attacking (fast rise),
    // rate 0.5 releasing (slow fall).
    const shortRate = adjustRate(this.current > this.average ? 0.2 : 0.5, dt);
    this.average = this.average * shortRate + this.current * (1 - shortRate);
    // Long baseline — bootstrap fast for first ~50 frames so the
    // running-average doesn't sit at 0 and explode the ratio.
    const longRate = adjustRate(this.frame < 50 ? 0.9 : 0.992, dt);
    this.longAverage = this.longAverage * longRate + this.current * (1 - longRate);
    if (Math.abs(this.longAverage) < 0.001) {
      this.smoothed = 1;
    } else {
      this.smoothed = this.average / this.longAverage;
    }
  }

  reset(): void {
    this.current = this.average = this.longAverage = 0;
    this.smoothed = 1;
    this.frame = 0;
  }
}

/** Framerate-independent IIR rate adjustment. `rate30` is the decay
 *  rate calibrated for a 30fps reference; we scale to actual `dt` via
 *  `pow(perSecond, dt)`. Exact port of projectM's `AdjustRateToFps`. */
function adjustRate(rate30: number, dt: number): number {
  const perSecond = Math.pow(rate30, 30);
  return Math.pow(perSecond, dt);
}

/** Map a Milkdrop normalised ratio (~0.5 quiet, ~1.0 normal, ~1.5 loud)
 *  back into a 0..1 range for the existing shader uniforms. Quiet
 *  sections sit near 0; a typical hit lifts the value to ~0.5; HUGE
 *  bass drops approach 1.0. Smooth at every point — no woofer pulse. */
function ratioToUnit(ratio: number): number {
  return Math.max(0, Math.min(1, (ratio - 0.55) / 0.95));
}

export const SILENT_AUDIO: AudioUniforms = {
  audioBass: 0,
  audioMid: 0,
  audioHigh: 0,
  audioLevel: 0,
  audioBeat: 0,
  audioBeatPhase: 0,
  audioBPM: 0,
  audioSpectralCentroid: 0,
};

/** Tempo from beat times (ms), as the desktop analyser estimates it: the median
 *  interval between 60 and 200 BPM, eased toward small changes. 0 when unsure. */
export function estimateBpm(beatTimes: readonly number[], previous: number): number {
  if (beatTimes.length < 4) return 0;
  const intervals: number[] = [];
  for (let i = 1; i < beatTimes.length; i++) {
    const interval = beatTimes[i] - beatTimes[i - 1];
    if (interval >= 300 && interval <= 1000) intervals.push(interval);
  }
  if (intervals.length < 3) return previous;
  intervals.sort((a, b) => a - b);
  const raw = 60000 / intervals[Math.floor(intervals.length / 2)];
  return previous === 0 || Math.abs(raw - previous) > 10 ? Math.round(raw) : Math.round(previous * 0.8 + raw * 0.2);
}

/** Spectral centroid of a byte spectrum (-100..-30 dB), normalised like the desktop's. */
export function spectralCentroid(spectrum: ArrayLike<number>): number {
  let weighted = 0, total = 0;
  for (let i = 0; i < spectrum.length; i++) {
    const db = -100 + (spectrum[i] * 70) / 255;
    const magnitude = Math.max(0, (db + 90) / 80);
    weighted += i * magnitude;
    total += magnitude;
  }
  return total > 0 ? weighted / total / Math.max(1, spectrum.length) : 0;
}

export class StandaloneAudio {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private node: MediaStreamAudioSourceNode | null = null;
  private stream: MediaStream | null = null;
  private wave = new Uint8Array(new ArrayBuffer(1024));
  private freq: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(0));
  private native: NativeAudioHandle | null = null;
  /** Where the sound comes from; 'off' until started. */
  public source: AudioSourceKind = 'off';
  /** True while the source is delivering sound (the player is playing, the broadcast is sending). */
  public arriving = false;
  /** Unsmoothed loudness 0..1, for a level meter (the uniforms are normalised to the song). */
  public rawLevel = 0;
  private beatTimes: number[] = [];
  private bpm = 0;

  // Beat detection: envelope follower on the bass band.
  // When the bass exceeds (running average * threshold), pop a beat that
  // decays over ~250ms — the "still alive at silence" requirement is
  // satisfied by gentle drift, not zero. Uses the RAW bass band (not
  // the smoothed follower output) so onset detection isn't lagged by
  // the slow-release smoothing — beats need to fire on the instant.
  private bassEnv = 0;
  private bassAvg = 0;
  private beatStrength = 0;
  private lastBeatTime = 0;

  // Milkdrop-style followers — one per band that flows to a uniform.
  // The smoothed/normalised outputs feed `audioBass`/`audioMid`/etc.
  // so every shader on the mobile path automatically gets the
  // "elegant breath" feel without per-shader rewiring.
  private bassF = new BandFollower();
  private midF = new BandFollower();
  private highF = new BandFollower();
  private levelF = new BandFollower();
  private lastUpdate = 0;

  public uniforms: AudioUniforms = { ...SILENT_AUDIO };
  public ready = false;

  /** The microphone. On the iPhone and iPad app other apps' music keeps playing. */
  async start(): Promise<void> {
    return this.startSource('mic');
  }

  /** Listen to `source`: 'mic' everywhere; 'player' and 'phone' on the iPhone and iPad app. */
  async startSource(source: AudioSourceKind): Promise<void> {
    if (source === 'off') { this.stop(); return; }
    if (this.ready && this.source === source) return;
    if (hasNativeAudio()) {
      // Take the new source before letting go of the old one, so the shared native source never switches off in between.
      const handle = await acquireNativeAudio(source);
      this.stop();
      this.native = handle;
      this.freq = new Uint8Array(new ArrayBuffer(AUDIO_BINS));
      this.wave.fill(128);
      this.source = source;
      this.ready = true;
      return;
    }
    if (source !== 'mic') throw new Error('This audio source needs the iPhone or iPad app.');
    if (this.ready) return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    const AC = (window.AudioContext || (window as any).webkitAudioContext);
    this.ctx = new AC();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.7;
    this.node = this.ctx.createMediaStreamSource(this.stream);
    this.node.connect(this.analyser);
    this.freq = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount));
    this.source = 'mic';
    this.ready = true;
  }

  /** Pull one frame of audio and update the uniforms.
   *  Call from your render loop — cheap, allocates nothing. */
  update(now = performance.now()): void {
    if (!this.ready) return;
    if (this.native) {
      const frame = this.native.frame();
      if (frame) { this.freq.set(frame.spectrum); this.wave.set(frame.waveform); }
      else { this.freq.fill(0); this.wave.fill(128); }
      this.arriving = !!frame?.arriving;
    } else if (this.analyser) {
      this.analyser.getByteFrequencyData(this.freq);
      this.analyser.getByteTimeDomainData(this.wave);
      this.arriving = true;
    } else return;
    this.uniforms.spectrum = this.freq;
    this.uniforms.waveform = this.wave;

    // dt for framerate-independent smoothing. Clamped so a tab-switch
    // pause doesn't blow the long-baseline towards zero with a giant
    // step.
    const dt = this.lastUpdate === 0
      ? 0.016
      : Math.max(0.001, Math.min(0.1, (now - this.lastUpdate) / 1000));
    this.lastUpdate = now;

    // Bin split: with fftSize=1024 @ 48kHz, each bin ≈ 47Hz. We want
    // bass ≈ 0-250Hz (bins 0-5), mid ≈ 250-2kHz (bins 5-42),
    // high ≈ 2kHz-12kHz (bins 42-256). Rest discarded (too quiet to matter).
    let bassSum = 0, midSum = 0, highSum = 0;
    const f = this.freq;
    for (let i = 0; i < 5; i++) bassSum += f[i];
    for (let i = 5; i < 42; i++) midSum += f[i];
    for (let i = 42; i < 256; i++) highSum += f[i];
    const bass = bassSum / (5 * 255);
    const mid = midSum / ((42 - 5) * 255);
    const high = highSum / ((256 - 42) * 255);
    const level = (bass + mid + high) / 3;
    this.rawLevel = level;

    // Drive the band-followers with the raw band values. Each
    // follower internally maintains an asymmetric short average + a
    // long normalisation baseline, and exposes a smoothed normalised
    // ratio that floats around 1.0 (~0.5 quiet, ~1.0 normal, ~1.5
    // loud). Framerate-aware via `dt`.
    this.bassF.update(bass, dt);
    this.midF.update(mid, dt);
    this.highF.update(high, dt);
    this.levelF.update(level, dt);

    // Beat detection runs off the RAW bass band — onsets need to fire
    // immediately, not lagged by the smoother's slow-release tail.
    // The existing envelope+threshold model gives a clean transient
    // pulse with 0.9 decay (~250ms).
    this.bassEnv = Math.max(this.bassEnv * 0.85, bass);
    this.bassAvg = this.bassAvg * 0.99 + bass * 0.01;
    const sinceLastBeat = now - this.lastBeatTime;
    if (
      this.bassEnv > this.bassAvg * 1.5 &&
      this.bassEnv > 0.15 &&
      sinceLastBeat > 180
    ) {
      this.beatStrength = 1;
      this.lastBeatTime = now;
      this.beatTimes.push(now);
      if (this.beatTimes.length > 17) this.beatTimes.shift();
      this.bpm = estimateBpm(this.beatTimes, this.bpm);
    } else {
      this.beatStrength *= 0.9; // ~250ms decay
    }

    // Expose the smoothed normalised ratios as the 0..1 uniforms the
    // shaders already use. Same uniform names, same value range, just
    // no more woofer-pulse stutter.
    this.uniforms.audioBass = ratioToUnit(this.bassF.smoothed);
    this.uniforms.audioMid = ratioToUnit(this.midF.smoothed);
    this.uniforms.audioHigh = ratioToUnit(this.highF.smoothed);
    this.uniforms.audioLevel = ratioToUnit(this.levelF.smoothed);
    this.uniforms.audioBeat = this.beatStrength;
    // A tempo goes stale after four seconds without a beat.
    if (now - this.lastBeatTime > 4000) { this.bpm = 0; this.beatTimes = []; }
    const interval = this.bpm > 0 ? 60000 / this.bpm : 0;
    this.uniforms.audioBPM = this.bpm;
    this.uniforms.audioBeatPhase = interval > 0 ? ((now - this.lastBeatTime) % interval) / interval : 0;
    this.uniforms.audioSpectralCentroid = spectralCentroid(this.freq);
  }

  stop(): void {
    this.native?.release();
    this.native = null;
    this.source = 'off';
    this.arriving = false;
    this.rawLevel = 0;
    if (this.stream) {
      for (const t of this.stream.getTracks()) t.stop();
      this.stream = null;
    }
    this.node?.disconnect();
    this.analyser?.disconnect();
    this.ctx?.close().catch(() => { /* ignore close races */ });
    this.node = null;
    this.analyser = null;
    this.ctx = null;
    this.ready = false;
    this.uniforms = { ...SILENT_AUDIO };
    this.resetSmoothing();
  }

  /** Forget the last source's levels so a new one doesn't inherit its normalisation. */
  private resetSmoothing(): void {
    this.bassF.reset();
    this.midF.reset();
    this.highF.reset();
    this.levelF.reset();
    this.bassEnv = this.bassAvg = this.beatStrength = 0;
    this.lastUpdate = 0;
    this.beatTimes = [];
    this.bpm = 0;
  }
}
