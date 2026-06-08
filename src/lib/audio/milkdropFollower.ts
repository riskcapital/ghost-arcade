/**
 * Milkdrop-style smooth audio follower.
 *
 * The core idea, ripped directly from projectM's `Loudness.cpp` (Geiss'
 * original Milkdrop model): instead of driving visual params off raw
 * band amplitude — which produces ugly woofer-like back-and-forth
 * stuttering — drive them off a two-stage smoothed RATIO:
 *
 *   1. Short-term smoothing with ASYMMETRIC attack/release. Fast rise
 *      (catches the kick) + slow fall (no snap-back). One-pole IIR.
 *   2. Long-term baseline (~30s time constant). The "running volume"
 *      of this band for this song.
 *   3. Expose `current / longAverage` and `average / longAverage` —
 *      both are auto-normalized RATIOS where 1.0 = "normal for this
 *      song", < 0.7 = quiet, > 1.3 = a hit. Loud/quiet songs look the
 *      same on the visualizer because the baseline adapts.
 *
 * Plus two things Milkdrop doesn't have but pro visualizers stack on:
 *
 *   - **Onset-triggered envelopes** (AR/exponential). Event-driven,
 *     not amplitude-driven. A kick fires a smooth 30→350 ms envelope
 *     that plays out regardless of what the audio does next — so a
 *     particle burst or camera punch always feels complete, not
 *     reactive-to-every-frame.
 *   - **BPM-locked LFOs**. Phase-locked sine/triangle/saw at musical
 *     subdivisions. Rhythmically tied to the music, mathematically
 *     smooth — drives orbital motion, breathing, color cycling.
 *
 * Usage:
 *
 *   const follower = new MilkdropFollower();
 *   // each animation frame:
 *   follower.update(hostAudio, dt);
 *   // then read smoothed values:
 *   const bassPulse  = follower.bass_att;    // smoothed, normalized
 *   const kickPunch  = follower.kickEnv;     // 0→1 envelope, decays
 *   const orbit      = follower.lfo(1, 'sin'); // sine once per beat
 *   const hue        = follower.centroid_att; // smoothed brightness 0→1
 */

import type {
  AudioBands,
  AudioAnalysis,
  BandKickSnare,
} from './analyzer';

// ─────────────────────────────────────────────────────────────────────
//  Band follower — the heart of the Milkdrop model.
// ─────────────────────────────────────────────────────────────────────

/** One follower per frequency band. Maintains the two-stage smoothing
 *  model from projectM's `Loudness.cpp` (per-frame IIRs with asymmetric
 *  attack/release + a much longer baseline). */
class BandFollower {
  /** Raw band level fed in this frame (host's normalized 0-1). */
  current = 0;
  /** Short-term smoothed `current`. Asymmetric IIR — fast attack, slow
   *  release. This is the "bass_att" numerator. */
  average = 0;
  /** Long-term baseline (~30s time constant once bootstrapped). Used
   *  as the denominator for the normalized ratios. */
  longAverage = 0;
  /** Instant normalized — `current / longAverage`. Equivalent to
   *  Milkdrop's `bass`. ~1 = normal for this song, > 1.3 = hit. */
  currentRel = 1;
  /** Smoothed normalized — `average / longAverage`. Equivalent to
   *  Milkdrop's `bass_att`. Doesn't snap back; ideal for driving
   *  continuous params. */
  averageRel = 1;

  /** Bootstrap counter — until this exceeds the bootstrap threshold,
   *  the long-average uses a much faster rate so we don't divide by
   *  zero on song start. */
  private frame = 0;

  update(raw: number, dt: number) {
    this.current = Math.max(0, raw);
    this.frame++;

    // Seed the baseline from the first meaningful frame. Without this,
    // the first few nonzero frames divide by a near-zero long average and
    // produce a huge visual pop before the follower has learned the song.
    if (this.frame === 1) {
      this.average = this.current;
      this.longAverage = Math.max(this.current, 0.025);
    }

    // Short-term smoothing. Asymmetric: rises with rate=0.2 (fast),
    // falls with rate=0.5 (slow). The lower the rate, the faster the
    // tracking — `average = average * rate + current * (1 - rate)`.
    const shortRate = adjustRate(
      this.current > this.average ? 0.2 : 0.5,
      dt,
    );
    this.average =
      this.average * shortRate + this.current * (1 - shortRate);

    // Long-term baseline. Bootstrap with rate=0.9 for the first ~50
    // frames (so we get a sensible normalizer quickly), then switch to
    // 0.992 (~30s time constant at 30fps) for true running average.
    const longRate = adjustRate(this.frame < 50 ? 0.9 : 0.992, dt);
    this.longAverage =
      this.longAverage * longRate + this.current * (1 - longRate);

    // Expose normalized ratios. Guard against divide-by-zero during
    // the first few frames when longAverage is near 0.
    if (Math.abs(this.longAverage) < 0.001) {
      this.currentRel = 1;
      this.averageRel = 1;
    } else {
      const denom = Math.max(this.longAverage, 0.025);
      this.currentRel = Math.max(0, Math.min(2.5, this.current / denom));
      this.averageRel = Math.max(0, Math.min(2.5, this.average / denom));
    }
  }

  reset() {
    this.current = 0;
    this.average = 0;
    this.longAverage = 0;
    this.currentRel = 1;
    this.averageRel = 1;
    this.frame = 0;
  }
}

/** Frame-rate-independent IIR rate adjustment. The reference rate is
 *  calibrated for 30 fps; we scale to actual frame interval via
 *  `pow(perSecond, dt)`. Exact port of projectM's `AdjustRateToFps`. */
function adjustRate(rate30fps: number, dt: number): number {
  const perSecond = Math.pow(rate30fps, 30);
  return Math.pow(perSecond, dt);
}

// ─────────────────────────────────────────────────────────────────────
//  Attack-Release envelope generator.
// ─────────────────────────────────────────────────────────────────────

/** Smooth event-driven envelope. Triggered on onset detection (kick,
 *  snare, etc); rises quickly to 1 with `attackMs`, then decays back
 *  to 0 with `releaseMs`. Use for event-driven effects — particle
 *  bursts, camera punches, color flashes — that should feel
 *  intentional rather than amplitude-tracking. */
class AREnvelope {
  /** Current envelope value 0→1. Read this each frame. */
  value = 0;
  /** Internal target — 1 right after trigger, 0 once we've peaked. */
  private target = 0;

  /** Fire the envelope. Sets target=1; update() will ramp toward it. */
  trigger() {
    this.target = 1;
  }

  /** Tick the envelope. `attackMs` is rise time, `releaseMs` is fall.
   *  Defaults give a punchy-but-smooth ~30/350 ms ADSR feel that reads
   *  as "the visual reacted to the beat" without strobing. */
  update(dt: number, attackMs = 30, releaseMs = 350) {
    const tauMs = this.target > this.value ? attackMs : releaseMs;
    const tau = Math.max(tauMs, 1) / 1000;
    const alpha = 1 - Math.exp(-dt / tau);
    this.value += (this.target - this.value) * alpha;
    // Once we've nearly reached peak, flip to release. Without this,
    // a held trigger would keep the envelope pinned at 1 instead of
    // falling away after the hit.
    if (this.target > 0 && this.value > 0.95) this.target = 0;
  }

  reset() {
    this.value = 0;
    this.target = 0;
  }
}

// ─────────────────────────────────────────────────────────────────────
//  BPM-locked LFO.
// ─────────────────────────────────────────────────────────────────────

/** Maintains a "musical phase" accumulator that advances at the
 *  detected BPM, so LFOs can be sampled at musical subdivisions (1/1
 *  per beat, 1/2 per beat, 4 beats per cycle, etc) regardless of
 *  whether the beat phase wraps mid-frame. */
class MusicalClock {
  /** Current phase position in beats (monotonically increasing). */
  beats = 0;

  /** Last seen beatPhase from the host — used to detect beat boundary
   *  crossings so our beat counter stays consistent even when the
   *  host's beatPhase wraps. */
  private lastPhase = 0;

  update(beatPhase: number, bpm: number, dt: number) {
    // Two methods to advance, picked based on signal quality:
    //
    //  (a) When BPM is known + confident, advance by BPM × dt. This
    //      gives a stable musical phase even when the host's
    //      beat-phase signal is noisy.
    //  (b) Otherwise integrate beatPhase deltas — handles the case
    //      when bpm is 0 but we still want phase to move.
    if (bpm > 30) {
      const bps = bpm / 60;
      this.beats += bps * dt;
    } else {
      // Detect wrap from ~1 → ~0 (one beat elapsed).
      const delta = beatPhase - this.lastPhase;
      if (delta < -0.5) this.beats += 1 + delta; // wrapped
      else this.beats += Math.max(0, delta);
      this.lastPhase = beatPhase;
    }
  }

  reset() {
    this.beats = 0;
    this.lastPhase = 0;
  }
}

/** Sample a BPM-locked LFO at the given division.
 *  - `division=1` → one full cycle per beat (4 cycles per bar)
 *  - `division=0.5` → cycle every 2 beats
 *  - `division=0.25` → cycle every 4 beats (slow swelling)
 *  - `division=2` → 2 cycles per beat (8ths)
 *  - `division=4` → 4 cycles per beat (16ths)
 *
 *  Returns -1 → 1 for `sin` / `tri`, or 0 → 1 for `saw` (use offset
 *  arithmetic to remap as needed at call site). */
function sampleLFO(
  beats: number,
  division: number,
  shape: 'sin' | 'tri' | 'saw',
): number {
  const phase = (beats * division) % 1; // 0..1 within one LFO cycle
  switch (shape) {
    case 'sin':
      return Math.sin(phase * Math.PI * 2);
    case 'tri': {
      // Triangle wave -1..1, peak at phase=0.5
      const t = phase < 0.5 ? phase * 2 : 2 - phase * 2;
      return t * 2 - 1;
    }
    case 'saw':
      return phase;
  }
}

// ─────────────────────────────────────────────────────────────────────
//  Public follower — wraps everything for the SV worlds (and beyond).
// ─────────────────────────────────────────────────────────────────────

export interface MilkdropFollowerInput {
  /** Host's normalized 0-1 band levels. Required. */
  bands: AudioBands;
  /** Overall amplitude (0-1). Used for `vol`/`vol_att`. */
  amplitude: number;
  /** Onset detection state from host. `isKick`/`isSnare` are
   *  per-frame booleans that trigger our envelopes. */
  kickSnare: BandKickSnare;
  /** Phase within current beat (0-1) from host. Drives the musical
   *  clock when BPM is unreliable. */
  beatPhase: number;
  /** Detected BPM. Drives the musical clock when > 30. */
  bpm: number;
  /** Spectral centroid (0-1). Drives the smoothed hue offset. */
  spectralCentroid: number;
  /** Per-frame "isBeat" boolean from host (general beat, not band-
   *  specific). Used for `beatEnv`. Optional — falls back to `isKick`
   *  when undefined. */
  isBeat?: boolean;
}

/** Convenience adapter — takes a full `AudioAnalysis` and produces the
 *  follower input. Lets call sites pass `analysis` straight through
 *  without unpacking. */
export function followerInputFromAnalysis(
  a: AudioAnalysis,
): MilkdropFollowerInput {
  return {
    bands: a.bands,
    amplitude: a.amplitude,
    kickSnare: a.kickSnare,
    beatPhase: a.beatPhase,
    bpm: a.bpm,
    spectralCentroid: a.spectralCentroid,
    isBeat: a.beat?.isBeat,
  };
}

/** Single-instance follower that maintains state across frames. One per
 *  visualizer / scene that wants smooth audio. Stateless inputs → smooth
 *  state-aware outputs. */
export class MilkdropFollower {
  // ── Band followers ────────────────────────────────────────────────
  // Three "milkdrop classic" bands (bass/mid/treb) plus a vol follower
  // for overall energy. We also expose narrow-band followers for
  // sub/lowMid/highMid/air so SV worlds can drive params off finer
  // slices of the spectrum.
  private bassF = new BandFollower();
  private midF = new BandFollower();
  private trebF = new BandFollower();
  private volF = new BandFollower();
  private subF = new BandFollower();
  private lowMidF = new BandFollower();
  private highMidF = new BandFollower();
  private airF = new BandFollower();

  // ── Envelopes ─────────────────────────────────────────────────────
  private kickEnv_ = new AREnvelope();
  private snareEnv_ = new AREnvelope();
  private beatEnv_ = new AREnvelope();

  // ── Musical clock + centroid smoother ─────────────────────────────
  private clock = new MusicalClock();
  private centroidValue = 0;
  /** Initialised to false until we see meaningful input — so first-
   *  frame divisions don't poison the long-average. */
  private hasInput = false;

  /** Tick the follower forward by `dt` seconds with the latest audio
   *  input. Must be called once per render frame. */
  update(input: MilkdropFollowerInput, dt: number) {
    // Sanity: clamp dt so a freeze (debugger pause) doesn't blow up
    // the long-average smoothing into negative territory.
    const _dt = Math.max(0.001, Math.min(0.1, dt));
    this.hasInput = true;

    // Band followers — fed the host's already-band-summed normalized
    // values. Milkdrop's `current` is FFT sum; here we trust the host
    // to have done the FFT sum + initial normalization, and just apply
    // the two-stage IIRs on top.
    this.bassF.update(input.bands.bass, _dt);
    this.midF.update(input.bands.mid, _dt);
    this.trebF.update(input.bands.treble, _dt);
    this.volF.update(input.amplitude, _dt);
    this.subF.update(input.bands.sub, _dt);
    this.lowMidF.update(input.bands.lowMid, _dt);
    this.highMidF.update(input.bands.highMid, _dt);
    this.airF.update(input.bands.air, _dt);

    // Onset envelopes — trigger on the frame the host detects an
    // onset, then tick toward 0.
    if (input.kickSnare.isKick) this.kickEnv_.trigger();
    if (input.kickSnare.isSnare) this.snareEnv_.trigger();
    if (input.isBeat ?? input.kickSnare.isKick) this.beatEnv_.trigger();
    this.kickEnv_.update(_dt);
    this.snareEnv_.update(_dt);
    this.beatEnv_.update(_dt);

    // Musical clock for LFOs.
    this.clock.update(input.beatPhase, input.bpm, _dt);

    // Smoothed centroid — 600ms time constant feels right for hue
    // shifts (long enough to not strobe, short enough to track).
    const centroidTau = 0.6;
    const centroidAlpha = 1 - Math.exp(-_dt / centroidTau);
    this.centroidValue +=
      (input.spectralCentroid - this.centroidValue) * centroidAlpha;
  }

  /** Reset all state. Call when audio source changes (file swap, mic
   *  reconnect) so the long-averages don't carry stale baselines. */
  reset() {
    this.bassF.reset();
    this.midF.reset();
    this.trebF.reset();
    this.volF.reset();
    this.subF.reset();
    this.lowMidF.reset();
    this.highMidF.reset();
    this.airF.reset();
    this.kickEnv_.reset();
    this.snareEnv_.reset();
    this.beatEnv_.reset();
    this.clock.reset();
    this.centroidValue = 0;
    this.hasInput = false;
  }

  // ─── Smoothed band outputs (Milkdrop style — auto-normalized) ────
  /** Instant bass, normalized. 1.0 = normal for this song. Spiky. */
  get bass(): number { return this.bassF.currentRel; }
  /** Smoothed bass, normalized. The one to drive params off. */
  get bass_att(): number { return this.bassF.averageRel; }
  get mid(): number { return this.midF.currentRel; }
  get mid_att(): number { return this.midF.averageRel; }
  get treb(): number { return this.trebF.currentRel; }
  get treb_att(): number { return this.trebF.averageRel; }
  get vol(): number { return this.volF.currentRel; }
  get vol_att(): number { return this.volF.averageRel; }

  /** Narrow-band followers for finer control (smoothed normalized). */
  get sub_att(): number { return this.subF.averageRel; }
  get lowMid_att(): number { return this.lowMidF.averageRel; }
  get highMid_att(): number { return this.highMidF.averageRel; }
  get air_att(): number { return this.airF.averageRel; }

  // ─── Event envelopes — fire on onset, decay smoothly ─────────────
  /** 0→1 envelope, fires on every detected kick. Decays ~350 ms. */
  get kickEnv(): number { return this.kickEnv_.value; }
  /** 0→1 envelope, fires on every detected snare. */
  get snareEnv(): number { return this.snareEnv_.value; }
  /** 0→1 envelope on general beat — useful when you want "fire on the
   *  pulse" without distinguishing kick from snare. */
  get beatEnv(): number { return this.beatEnv_.value; }

  // ─── BPM-locked LFOs — call with desired musical division ────────
  /** Sample a BPM-locked sine LFO at the given division.
   *  Returns -1 → 1. See `sampleLFO()` for the division convention. */
  lfo(division: number, shape: 'sin' | 'tri' | 'saw' = 'sin'): number {
    return sampleLFO(this.clock.beats, division, shape);
  }
  /** Same as lfo() but mapped to 0 → 1 for direct use as a 0-1 param. */
  lfo01(division: number, shape: 'sin' | 'tri' | 'saw' = 'sin'): number {
    const v = sampleLFO(this.clock.beats, division, shape);
    return shape === 'saw' ? v : v * 0.5 + 0.5;
  }

  // ─── Smoothed centroid (drives color/hue) ────────────────────────
  /** Smoothed spectral centroid (0-1). Track brighter = higher. Use
   *  for hue offset, color temperature, palette blending. */
  get centroid_att(): number { return this.centroidValue; }

  // ─── Musical clock readout — for direct phase access ─────────────
  /** Accumulated phase in beats since instantiation. Monotonically
   *  rising. Useful for custom phase math beyond the LFO helpers. */
  get beats(): number { return this.clock.beats; }
}
