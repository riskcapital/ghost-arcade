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

export interface AudioUniforms {
  audioBass: number;
  audioMid: number;
  audioHigh: number;
  audioLevel: number;
  audioBeat: number;
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
};

export class StandaloneAudio {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private stream: MediaStream | null = null;
  private freq: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(0));

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

  async start(): Promise<void> {
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
    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.source.connect(this.analyser);
    this.freq = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount));
    this.ready = true;
  }

  /** Pull one frame of audio and update the uniforms.
   *  Call from your render loop — cheap, allocates nothing. */
  update(now = performance.now()): void {
    if (!this.analyser || !this.ready) return;
    this.analyser.getByteFrequencyData(this.freq);

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
  }

  stop(): void {
    if (this.stream) {
      for (const t of this.stream.getTracks()) t.stop();
      this.stream = null;
    }
    this.source?.disconnect();
    this.analyser?.disconnect();
    this.ctx?.close().catch(() => { /* ignore close races */ });
    this.source = null;
    this.analyser = null;
    this.ctx = null;
    this.ready = false;
    this.uniforms = { ...SILENT_AUDIO };
    // Reset smoothing state so reconnecting the mic doesn't carry
    // the prior song's long-baseline normalisation forward.
    this.bassF.reset();
    this.midF.reset();
    this.highF.reset();
    this.levelF.reset();
    this.bassEnv = this.bassAvg = this.beatStrength = 0;
    this.lastUpdate = 0;
  }
}
