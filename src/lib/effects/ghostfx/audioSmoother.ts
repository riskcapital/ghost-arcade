// GhostFX audio smoother — turns raw audio frame data into the
// continuous, anticipatory, multi-time-scale signals the shader uses.
//
// Design principle: the shader NEVER sees raw audio. Direct
// raw-bass-to-position mappings produce the jerky "things bouncing
// on the kick" feel we explicitly don't want. Instead we expose:
//
//   bassSlow / midSlow / trebSlow    — long half-life (400-800ms),
//      track overall section energy in each band. Drive camera
//      radius, scene scale, palette saturation — anything that
//      should *vibe* with the song, not flinch.
//
//   bassFast / midFast / trebFast    — short half-life (120-180ms),
//      still smoothed but punchy. Use sparingly for accents (subtle
//      surface bumps on kicks, sparkle on hats).
//
//   energy                            — extremely long (1500ms) RMS
//      proxy. Drives global "intensity": bloom strength, exposure,
//      atmospheric density. Quiet section → muted; loud section →
//      glowing. This is what gives the visualizer a song-arc shape
//      instead of frame-by-frame jitter.
//
//   beatPhase                         — 0..1 sawtooth synced to the
//      detected BPM. Resets on each beat *if* BPM is locked,
//      otherwise drifts at a default 120 BPM. Lets the shader run a
//      smooth sin(phase*2π) oscillator that anticipates AND follows
//      every beat — the visualizer is always in motion in step with
//      the tempo, never just reactive.
//
//   beatPulse                         — exponentially decaying impulse
//      seeded on each beat. Short half-life (~150ms) for surgical
//      sparkle/specular. The ONLY signal that fires on discrete beats.
//      Use it sparingly.

import type { AudioAnalysis } from '../../audio/analyzer';

export interface SmoothedAudio {
  bassSlow: number; midSlow: number; trebSlow: number;
  bassFast: number; midFast: number; trebFast: number;
  energy: number;
  /** 0..1 sawtooth within the current beat. Continuous, BPM-synced. */
  beatPhase: number;
  /** Decaying impulse on each detected beat. 0..1. */
  beatPulse: number;
  /** Smoothed amplitude RMS — fast (~80ms) for surface response. */
  amp: number;
}

const EMPTY: SmoothedAudio = {
  bassSlow: 0, midSlow: 0, trebSlow: 0,
  bassFast: 0, midFast: 0, trebFast: 0,
  energy: 0, beatPhase: 0, beatPulse: 0, amp: 0,
};

/** Per-channel exponential smoother with configurable half-life.
 *  `alpha = 1 - 2^(-dt/halfLife)` is the smoothest classical EMA
 *  formulation (linear in dt — robust to variable frame timing). */
function smoothTowards(current: number, target: number, halfLifeMs: number, dtSec: number): number {
  if (halfLifeMs <= 0) return target;
  const alpha = 1 - Math.pow(0.5, (dtSec * 1000) / halfLifeMs);
  return current + (target - current) * alpha;
}

export class AudioSmoother {
  private state: SmoothedAudio = { ...EMPTY };

  // Beat-phase state
  private lastBeatCount = 0;
  private lastBeatAt = 0;
  /** Phase increment per second — derived from BPM. Defaults to 2 Hz
   *  (120 BPM) when no BPM is detected yet so the visualizer always
   *  has a baseline pulse instead of being completely still. */
  private phaseRate = 2.0;

  // Audio history for the long energy envelope (RMS over 1.5s)
  private energyHistory: number[] = [];
  private historyLimit = 90;  // ~1.5s at 60Hz

  constructor() {}

  /** Advance smoothing one frame. Pass dt in seconds and the latest
   *  AudioAnalysis (or null for silence). Returns the smoothed
   *  uniform-ready snapshot. */
  step(dt: number, audio: AudioAnalysis | null, sensitivity: number): SmoothedAudio {
    if (!audio) {
      // No audio → decay everything to zero, but slowly so cuts feel
      // graceful instead of snapping black.
      this.state.bassSlow = smoothTowards(this.state.bassSlow, 0, 1200, dt);
      this.state.midSlow  = smoothTowards(this.state.midSlow,  0, 1200, dt);
      this.state.trebSlow = smoothTowards(this.state.trebSlow, 0, 1200, dt);
      this.state.bassFast = smoothTowards(this.state.bassFast, 0,  300, dt);
      this.state.midFast  = smoothTowards(this.state.midFast,  0,  300, dt);
      this.state.trebFast = smoothTowards(this.state.trebFast, 0,  300, dt);
      this.state.energy   = smoothTowards(this.state.energy,   0, 2000, dt);
      this.state.amp      = smoothTowards(this.state.amp,      0,  200, dt);
      this.state.beatPulse *= Math.pow(0.5, dt / 0.15);
      this.state.beatPhase = (this.state.beatPhase + dt * this.phaseRate) % 1;
      return this.state;
    }

    const b = audio.bands;
    const k = sensitivity;

    // Per-band targets — same blends Canvas uses to drive milkdrop +
    // a bit of low-octave overlap so bands feel connected, not
    // siloed. Each is clamped to 1 so a hot signal doesn't blow up
    // smoothed value into nonsense values that then take seconds to
    // settle back down.
    const bassT = Math.min(1, (b.sub * 0.5 + b.bass) * 0.7 * k);
    const midT  = Math.min(1, (b.lowMid * 0.3 + b.mid) * 0.7 * k);
    const trebT = Math.min(1, (b.highMid * 0.3 + b.treble * 0.5 + b.air * 0.3) * k);

    // SLOW band — section vibe. These are what drive camera /
    // exposure / palette — visible motion you can watch from a couch.
    this.state.bassSlow = smoothTowards(this.state.bassSlow, bassT, 800, dt);
    this.state.midSlow  = smoothTowards(this.state.midSlow,  midT,  600, dt);
    this.state.trebSlow = smoothTowards(this.state.trebSlow, trebT, 500, dt);

    // FAST band — accent only. ~150ms gives kick punch without
    // strobing.
    this.state.bassFast = smoothTowards(this.state.bassFast, bassT, 180, dt);
    this.state.midFast  = smoothTowards(this.state.midFast,  midT,  140, dt);
    this.state.trebFast = smoothTowards(this.state.trebFast, trebT, 120, dt);

    // Amplitude RMS — 80ms half-life feels "punchy" without being
    // glitchy. Used for things like specular highlight intensity.
    const ampT = Math.min(1, (audio.amplitude ?? 0) * k);
    this.state.amp = smoothTowards(this.state.amp, ampT, 80, dt);

    // ENERGY — long rolling RMS. Pushes recent amplitude into a ring
    // buffer; the result is a section-level estimate of "how loud is
    // the song right now" that doesn't blink on individual hits.
    this.energyHistory.push(ampT);
    if (this.energyHistory.length > this.historyLimit) this.energyHistory.shift();
    let sum = 0;
    for (let i = 0; i < this.energyHistory.length; i++) sum += this.energyHistory[i] * this.energyHistory[i];
    const rms = Math.sqrt(sum / Math.max(1, this.energyHistory.length));
    this.state.energy = smoothTowards(this.state.energy, rms, 1500, dt);

    // BEAT PHASE — continuous 0..1 sawtooth synced to detected BPM.
    // Resets to 0 on each detected beat (re-sync), drifts at phaseRate
    // between detections. The shader uses sin(phase * 2π) so the
    // visualizer always breathes with the tempo, even without hits.
    const bpm = audio.bpm ?? 0;
    const bpmConfident = bpm > 50 && (audio.bpmConfidence ?? 0) > 0.35;
    if (bpmConfident) {
      this.phaseRate = bpm / 60;
    } else {
      // Lerp toward a default 2Hz (120 BPM) when confidence drops so
      // the phase doesn't stall awkwardly.
      this.phaseRate = smoothTowards(this.phaseRate, 2.0, 800, dt);
    }
    if (audio.beat?.beatCount > this.lastBeatCount) {
      // Re-sync: nudge phase toward 0 rather than snapping. A snap
      // would create exactly the kind of flinch we're avoiding.
      const overshoot = this.state.beatPhase;
      this.state.beatPhase = overshoot * 0.25; // soft pull instead of slam
      this.lastBeatCount = audio.beat.beatCount;
      this.lastBeatAt = performance.now();
      // Beat pulse — the only signal that fires on the edge. Used
      // sparingly in shader for sparkle / specular.
      this.state.beatPulse = Math.max(this.state.beatPulse, audio.beat.beatIntensity ?? 1);
    }
    this.state.beatPhase = (this.state.beatPhase + dt * this.phaseRate) % 1;
    this.state.beatPulse *= Math.pow(0.5, dt / 0.15);

    return this.state;
  }

  reset(): void {
    this.state = { ...EMPTY };
    this.lastBeatCount = 0;
    this.energyHistory = [];
  }

  snapshot(): SmoothedAudio { return this.state; }
}
