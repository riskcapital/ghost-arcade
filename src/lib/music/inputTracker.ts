/**
 * Notes from a live instrument: hits, pitch and release found in the audio.
 *
 * The live input (a guitar, a voice, anything on an interface input) has no
 * note events of its own, so the tracker listens for them. Each step looks at
 * the newest block of samples:
 *
 *  - a hit is a jump in level well above where the signal has just been,
 *    over the gate, and not too soon after the last one;
 *  - pitch comes from the block's normalised autocorrelation, and is only
 *    trusted when the waveform is clearly periodic (one string or one voice;
 *    a strummed chord gives hits and level, not a pitch);
 *  - a held note that slides to a new pitch and stays there is a new note;
 *  - a note ends when the level falls under the gate.
 *
 * Pure: the caller reads the samples and owns the clock.
 */

export interface TrackerEvent {
  type: 'on' | 'off';
  /** MIDI note number. */
  note: number;
  /** 0-1. */
  velocity: number;
}

export interface TrackerSettings {
  /** 0-1: higher hears quieter playing. */
  sensitivity: number;
}

/** Lowest and highest pitch looked for: below a guitar's low E down a step, to a soprano's top. */
const MIN_HZ = 70;
const MAX_HZ = 1400;
/** How periodic a block must be before its pitch counts. */
const CLARITY = 0.86;
/** A hit is this many dB over the recent level. */
const HIT_RISE_DB = 6;
/** Hits closer than this are one hit. */
const REFRACTORY_SECONDS = 0.07;
/** The note ends this far under the gate. */
const RELEASE_HYSTERESIS_DB = 6;
/** Steps a new pitch must hold before a held note becomes it. */
const LEGATO_STEPS = 2;
/** Samples used for pitch: enough for two periods of the lowest note at 48 kHz. */
const PITCH_WINDOW = 1536;

export function gateDb(sensitivity: number): number {
  const s = Math.max(0, Math.min(1, sensitivity));
  return -28 - 34 * s;
}

export function rmsDb(samples: ArrayLike<number>, from = 0): number {
  let sum = 0;
  const n = samples.length - from;
  if (n <= 0) return -120;
  for (let i = from; i < samples.length; i++) sum += samples[i] * samples[i];
  const rms = Math.sqrt(sum / n);
  return rms > 1e-6 ? 20 * Math.log10(rms) : -120;
}

// Reused between calls: the tracker runs this about 80 times a second.
let nsdfBuffer = new Float32Array(0);

/** The fundamental of a block in Hz, or null when it is not clearly pitched. */
export function detectPitch(samples: ArrayLike<number>, sampleRate: number): { hz: number; clarity: number } | null {
  const size = Math.min(samples.length, PITCH_WINDOW);
  const start = samples.length - size;
  const minLag = Math.max(2, Math.floor(sampleRate / MAX_HZ));
  const maxLag = Math.min(Math.floor(size / 2), Math.ceil(sampleRate / MIN_HZ));
  if (maxLag <= minLag + 2) return null;
  if (nsdfBuffer.length < maxLag + 2) nsdfBuffer = new Float32Array(maxLag + 2);
  const nsdf = nsdfBuffer;
  // Every other sample pair: each lag keeps its full resolution, at half the
  // work (the window still holds two periods of the lowest note).
  for (let lag = 0; lag <= maxLag + 1; lag++) {
    let acf = 0;
    let energy = 0;
    for (let i = start, end = start + size - lag; i < end; i += 2) {
      const a = samples[i];
      const b = samples[i + lag];
      acf += a * b;
      energy += a * a + b * b;
    }
    nsdf[lag] = energy > 0 ? (2 * acf) / energy : 0;
  }
  // Peaks after the first fall below zero; take the first close to the best.
  let lag = 1;
  while (lag < maxLag && nsdf[lag] > 0) lag++;
  const peaks: number[] = [];
  let best = 0;
  while (lag < maxLag) {
    while (lag < maxLag && nsdf[lag] <= 0) lag++;
    let top = lag;
    while (lag < maxLag && nsdf[lag] > 0) {
      if (nsdf[lag] > nsdf[top]) top = lag;
      lag++;
    }
    if (top >= minLag && top < maxLag) {
      peaks.push(top);
      best = Math.max(best, nsdf[top]);
    }
  }
  if (!peaks.length || best < CLARITY) return null;
  const pick = peaks.find((p) => nsdf[p] >= 0.93 * best) ?? peaks[0];
  // Parabolic interpolation around the peak.
  const a = nsdf[pick - 1];
  const b = nsdf[pick];
  const c = nsdf[pick + 1];
  const denom = a - 2 * b + c;
  const shift = denom !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denom)) : 0;
  return { hz: sampleRate / (pick + shift), clarity: b };
}

export function hzToMidi(hz: number): number {
  return Math.max(0, Math.min(127, Math.round(69 + 12 * Math.log2(hz / 440))));
}

export class InputTracker {
  private settings: TrackerSettings;
  /** Recent level the next hit is measured against; falls slowly, follows rises at once. */
  private floorDb = -120;
  private lastHit = -Infinity;
  private lastTime: number | null = null;
  private sounding: number | null = null;
  private lastPitch = 60;
  private candidate: { note: number; steps: number } | null = null;
  /** Latest level over the gate, 0-1, for the input meter. */
  level = 0;

  constructor(settings: TrackerSettings) {
    this.settings = { ...settings };
  }

  setSettings(settings: Partial<TrackerSettings>): void {
    this.settings = { ...this.settings, ...settings };
  }

  /** Let any held note go (input stopped or changed). */
  reset(): TrackerEvent[] {
    const out: TrackerEvent[] = [];
    if (this.sounding !== null) out.push({ type: 'off', note: this.sounding, velocity: 0 });
    this.sounding = null;
    this.candidate = null;
    this.floorDb = -120;
    this.level = 0;
    return out;
  }

  /** The newest block of samples at `time` seconds. */
  step(samples: ArrayLike<number>, sampleRate: number, time: number): TrackerEvent[] {
    const out: TrackerEvent[] = [];
    const dt = this.lastTime === null ? 0 : Math.max(0, Math.min(0.25, time - this.lastTime));
    this.lastTime = time;
    // Level of the newest part of the block, so a hit is heard as it lands.
    const db = rmsDb(samples, Math.max(0, samples.length - 512));
    const gate = gateDb(this.settings.sensitivity);
    this.level = Math.max(0, Math.min(1, (db - gate) / -gate));

    const rise = db - this.floorDb;
    // The floor follows a decaying string down (90 dB a second) and jumps up with the signal.
    this.floorDb = Math.max(db, this.floorDb - 90 * dt);

    // Pitch only on a hit or under a held note: the rest of the time it is not used.
    const pitchNote = (): number | null => {
      const pitch = db > gate ? detectPitch(samples, sampleRate) : null;
      return pitch ? hzToMidi(pitch.hz) : null;
    };

    const velocity = Math.max(0.15, Math.min(1, (db - gate) / Math.max(6, -gate * 0.75)));
    if (db > gate && rise >= HIT_RISE_DB && time - this.lastHit >= REFRACTORY_SECONDS) {
      this.lastHit = time;
      const note = pitchNote() ?? this.lastPitch;
      if (this.sounding !== null) out.push({ type: 'off', note: this.sounding, velocity: 0 });
      out.push({ type: 'on', note, velocity });
      this.sounding = note;
      this.lastPitch = note;
      this.candidate = null;
      return out;
    }

    if (this.sounding !== null && db < gate - RELEASE_HYSTERESIS_DB) {
      out.push({ type: 'off', note: this.sounding, velocity: 0 });
      this.sounding = null;
      this.candidate = null;
      return out;
    }

    if (this.sounding === null) {
      this.candidate = null;
      return out;
    }
    // A held note sliding to a new pitch that sticks.
    const held = pitchNote();
    if (held !== null && held !== this.sounding) {
      if (this.candidate?.note === held) this.candidate.steps++;
      else this.candidate = { note: held, steps: 1 };
      if (this.candidate.steps >= LEGATO_STEPS) {
        out.push({ type: 'off', note: this.sounding, velocity: 0 });
        out.push({ type: 'on', note: held, velocity });
        this.sounding = held;
        this.lastPitch = held;
        this.candidate = null;
      }
    } else if (held === this.sounding) {
      this.candidate = null;
    }
    return out;
  }
}
