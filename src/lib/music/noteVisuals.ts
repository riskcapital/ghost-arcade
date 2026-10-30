/**
 * Note visuals: turns note events into the inputs note-reactive shaders read.
 *
 * A shader opts in by declaring ISF float inputs with the names in
 * `NOTE_SHADER_INPUTS` (any subset). Every frame the studio writes the
 * current values into each playing clip that declares them, through the same
 * per-frame path modulation uses, so the browser preview and the native
 * render core both see them without any extra plumbing.
 *
 * Each note can behave in one of two ways:
 *  - fade: the voice rises, settles and fades away after release (an ADSR
 *    envelope), so visuals linger briefly and clear.
 *  - build: the voice holds while it plays and lingers for a long time after,
 *    and every note adds to a slow accumulator, so the picture keeps growing
 *    and evolving while the performer plays.
 * The mode is set per instrument, and a shader clip can override it with its
 * own `noteMode` input (0 follows the instrument, 1 fade, 2 build).
 *
 * Voice envelopes are pure functions of the note's on/off times, and the
 * accumulators integrate event by event, so the same events always give the
 * same picture: a replayed take looks like the live performance did.
 */

import { DRUM_VOICES, INSTRUMENT_INDEX, type DrumVoice, type InstrumentId, type NoteEvent } from './noteEvents';

export type NoteVisualMode = 'fade' | 'build';

export interface NoteVisualSettings {
  mode: NoteVisualMode;
  /** Seconds to full brightness. */
  attack: number;
  /** Seconds to settle to the sustain level while held (fade). */
  decay: number;
  /** Held level after the decay, 0-1 (fade). */
  sustain: number;
  /** Seconds to fade out after release (fade). Drums use it as their decay length. */
  release: number;
  /** Seconds a released voice lingers (build). */
  linger: number;
  /** How much each note adds to the build accumulator, 0-1. */
  growth: number;
}

export const DEFAULT_VISUAL_SETTINGS: Record<InstrumentId, NoteVisualSettings> = {
  synth: { mode: 'fade', attack: 0.02, decay: 0.4, sustain: 0.65, release: 0.9, linger: 8, growth: 0.06 },
  keys: { mode: 'fade', attack: 0.005, decay: 0.7, sustain: 0.35, release: 0.6, linger: 8, growth: 0.05 },
  drums: { mode: 'fade', attack: 0.002, decay: 0.2, sustain: 0, release: 0.35, linger: 4, growth: 0.04 },
  drone: { mode: 'build', attack: 1.5, decay: 2, sustain: 0.8, release: 4, linger: 14, growth: 0.08 },
  bowls: { mode: 'fade', attack: 0.01, decay: 3, sustain: 0.2, release: 6, linger: 18, growth: 0.07 },
  dubbass: { mode: 'fade', attack: 0.01, decay: 0.5, sustain: 0.6, release: 0.6, linger: 8, growth: 0.04 },
  siren: { mode: 'build', attack: 0.2, decay: 1, sustain: 0.8, release: 3, linger: 12, growth: 0.06 },
  shots: { mode: 'fade', attack: 0.005, decay: 0.4, sustain: 0.2, release: 2, linger: 10, growth: 0.08 },
  analog: { mode: 'fade', attack: 0.01, decay: 0.4, sustain: 0.6, release: 0.5, linger: 8, growth: 0.05 },
  scan: { mode: 'fade', attack: 0.05, decay: 0.5, sustain: 0.5, release: 1, linger: 8, growth: 0.03 },
  xy: { mode: 'fade', attack: 0.05, decay: 0.6, sustain: 0.7, release: 1.4, linger: 10, growth: 0.05 },
  acid: { mode: 'fade', attack: 0.003, decay: 0.15, sustain: 0.4, release: 0.25, linger: 6, growth: 0.03 },
};

/** Melodic voices a shader can see at once. */
export const NOTE_VOICE_SLOTS = 8;

const voiceInputs = (prefix: string) => Array.from({ length: NOTE_VOICE_SLOTS }, (_, i) => `${prefix}${i}`);

/** Inputs the studio drives. Shaders declare any of these as float inputs. */
export const NOTE_DRIVEN_INPUTS: readonly string[] = [
  ...voiceInputs('notePitch'),
  ...voiceInputs('noteEnergy'),
  ...voiceInputs('noteVoice'),
  'noteLevel',
  'noteHit',
  'noteBuild',
  'noteEvolve',
  'noteLast',
  'noteCount',
  'noteBuilding',
  'drumKick',
  'drumSnare',
  'drumHat',
  'drumPerc',
];

/** The per-clip override. A long input the performer sets, never driven. */
export const NOTE_MODE_INPUT = 'noteMode';

const DRIVEN_SET = new Set(NOTE_DRIVEN_INPUTS);

export function isNoteDrivenInput(name: string): boolean {
  return DRIVEN_SET.has(name);
}

/** Which drum inputs each kit voice feeds. */
const DRUM_GROUP: Record<DrumVoice, 'drumKick' | 'drumSnare' | 'drumHat' | 'drumPerc'> = {
  kick: 'drumKick',
  snare: 'drumSnare',
  clap: 'drumSnare',
  rim: 'drumSnare',
  hatClosed: 'drumHat',
  hatOpen: 'drumHat',
  tom: 'drumPerc',
  crash: 'drumPerc',
};

/** Relative decay per kit voice, scaled by the drums' release setting. */
const DRUM_DECAY: Record<DrumVoice, number> = {
  kick: 1, snare: 0.8, clap: 0.7, rim: 0.35, hatClosed: 0.3, hatOpen: 1.1, tom: 0.9, crash: 2.2,
};

/** Time constant of the build accumulator's slow leak, in seconds. */
const BUILD_LEAK_SECONDS = 24;
/** Time constant of the note-on flash. */
const HIT_SECONDS = 0.09;
const EVOLVE_WRAP = 1000;

interface Voice {
  instrument: InstrumentId;
  note: number;
  velocity: number;
  onTime: number;
  offTime: number | null;
}

/** Fade envelope (ADSR) at `time`, 0-1. */
export function fadeEnvelope(s: NoteVisualSettings, onTime: number, offTime: number | null, time: number): number {
  const level = (t: number) => {
    const age = t - onTime;
    if (age < 0) return 0;
    const attack = Math.max(0.001, s.attack);
    if (age < attack) return age / attack;
    const sustain = Math.max(0, Math.min(1, s.sustain));
    return sustain + (1 - sustain) * Math.exp(-(age - attack) / Math.max(0.001, s.decay));
  };
  if (offTime === null || time < offTime) return level(time);
  const atRelease = level(offTime);
  return atRelease * Math.exp((-3 * (time - offTime)) / Math.max(0.001, s.release));
}

/** Build envelope at `time`: holds while the note is down, then lingers. */
export function buildEnvelope(s: NoteVisualSettings, onTime: number, offTime: number | null, time: number): number {
  const level = (t: number) => {
    const age = t - onTime;
    if (age < 0) return 0;
    const attack = Math.max(0.001, s.attack);
    return age < attack ? age / attack : 1;
  };
  if (offTime === null || time < offTime) return level(time);
  return level(offTime) * Math.exp((-3 * (time - offTime)) / Math.max(0.001, s.linger));
}

type Modes = { fade: number; build: number };

export class NoteVisualState {
  private settings: Record<InstrumentId, NoteVisualSettings>;
  private voices: (Voice | null)[] = Array.from({ length: NOTE_VOICE_SLOTS }, () => null);
  private pending: NoteEvent[] = [];
  private clock = 0;
  private hit = 0;
  private build = 0;
  private evolve = 0;
  private last = 0;
  /** Instrument of the latest note-on, for `noteBuilding`. */
  private lastInstrument: InstrumentId = 'synth';
  private drums: Record<DrumVoice, Modes> = Object.fromEntries(
    DRUM_VOICES.map((v) => [v, { fade: 0, build: 0 }]),
  ) as Record<DrumVoice, Modes>;

  constructor(settings: Partial<Record<InstrumentId, NoteVisualSettings>> = DEFAULT_VISUAL_SETTINGS) {
    this.settings = cloneSettings(settings);
  }

  setSettings(settings: Partial<Record<InstrumentId, NoteVisualSettings>>): void {
    this.settings = cloneSettings(settings);
  }

  /** Queue an event. It takes effect when the clock reaches its time. */
  push(event: NoteEvent): void {
    const time = Number.isFinite(event.time) ? event.time : this.clock;
    const queued = { ...event, time: Math.max(time, this.clock) };
    // Keep the queue in time order; live events nearly always append.
    let i = this.pending.length;
    while (i > 0 && this.pending[i - 1].time > queued.time) i--;
    this.pending.splice(i, 0, queued);
  }

  /** Move to `time`, applying every event due by then. */
  advance(time: number): void {
    if (!(time > this.clock)) {
      this.flushDue(this.clock);
      return;
    }
    while (this.pending.length && this.pending[0].time <= time) {
      const event = this.pending.shift()!;
      this.integrate(event.time);
      this.apply(event);
    }
    this.integrate(time);
  }

  /** Release every voice now (stop, panic). Lingering visuals still fade out. */
  releaseAll(): void {
    this.pending = this.pending.filter((e) => e.type === 'off');
    for (const voice of this.voices) {
      if (voice && voice.offTime === null) voice.offTime = this.clock;
    }
  }

  /** Clear everything, including what is still fading. */
  reset(time = 0): void {
    this.voices = this.voices.map(() => null);
    this.pending = [];
    this.clock = time;
    this.hit = 0;
    this.build = 0;
    this.evolve = 0;
    this.last = 0;
    this.lastInstrument = 'synth';
    for (const v of DRUM_VOICES) this.drums[v] = { fade: 0, build: 0 };
  }

  get time(): number {
    return this.clock;
  }

  /** True while anything is still visible, so the studio can stop writing when idle. */
  isActive(): boolean {
    if (this.pending.length || this.hit > 0.001 || this.build > 0.001) return true;
    if (this.voices.some((v) => v !== null)) return true;
    return DRUM_VOICES.some((v) => this.drums[v].fade > 0.001 || this.drums[v].build > 0.001);
  }

  /**
   * The shader inputs at the current clock. `override` is a clip's noteMode:
   * 0 follows each instrument's own mode, 1 forces fade, 2 forces build.
   */
  inputs(override = 0): Record<string, number> {
    const out: Record<string, number> = {};
    const modeFor = (instrument: InstrumentId): NoteVisualMode =>
      override === 1 ? 'fade' : override === 2 ? 'build' : this.settings[instrument].mode;

    let level = 0;
    let held = 0;
    for (let i = 0; i < NOTE_VOICE_SLOTS; i++) {
      const voice = this.voices[i];
      let energy = 0;
      if (voice) {
        const s = this.settings[voice.instrument];
        const env = modeFor(voice.instrument) === 'build'
          ? buildEnvelope(s, voice.onTime, voice.offTime, this.clock)
          : fadeEnvelope(s, voice.onTime, voice.offTime, this.clock);
        energy = voice.velocity * env;
        if (voice.offTime === null) held++;
      }
      out[`notePitch${i}`] = voice ? voice.note / 127 : 0;
      out[`noteEnergy${i}`] = energy;
      out[`noteVoice${i}`] = voice ? INSTRUMENT_INDEX[voice.instrument] : 0;
      level += energy;
    }

    const drumMode = modeFor('drums');
    const groups = { drumKick: 0, drumSnare: 0, drumHat: 0, drumPerc: 0 };
    for (const v of DRUM_VOICES) {
      const value = drumMode === 'build' ? this.drums[v].build : this.drums[v].fade;
      const group = DRUM_GROUP[v];
      groups[group] = Math.max(groups[group], value);
      level += value * 0.5;
    }
    Object.assign(out, groups);

    out.noteLevel = Math.min(1, level);
    out.noteHit = this.hit;
    out.noteBuild = this.build;
    out.noteEvolve = this.evolve;
    out.noteLast = this.last;
    out.noteCount = held;
    out.noteBuilding = modeFor(this.lastInstrument) === 'build' ? 1 : 0;
    return out;
  }

  /** How bright one instrument's voices are right now, 0-1 (for patching it to a visual). */
  instrumentLevel(instrument: InstrumentId): number {
    let level = 0;
    for (const voice of this.voices) {
      if (!voice || voice.instrument !== instrument) continue;
      const s = this.settings[instrument];
      const env = s.mode === 'build'
        ? buildEnvelope(s, voice.onTime, voice.offTime, this.clock)
        : fadeEnvelope(s, voice.onTime, voice.offTime, this.clock);
      level += voice.velocity * env;
    }
    return Math.min(1, level);
  }

  /** One kit voice's envelope at the current clock (for patching a drum to a visual). */
  drumLevel(voice: DrumVoice): number {
    const d = this.drums[voice];
    return this.settings.drums.mode === 'build' ? d.build : d.fade;
  }

  private flushDue(time: number): void {
    while (this.pending.length && this.pending[0].time <= time) this.apply(this.pending.shift()!);
  }

  /** Run the accumulators and free finished voices up to `time`. */
  private integrate(time: number): void {
    const dt = time - this.clock;
    if (!(dt > 0)) return;
    const activity = Math.min(1, this.buildLevel());
    this.evolve = (this.evolve + dt * activity) % EVOLVE_WRAP;
    this.hit *= Math.exp(-dt / HIT_SECONDS);
    this.build *= Math.exp(-dt / BUILD_LEAK_SECONDS);
    const drums = this.settings.drums;
    for (const v of DRUM_VOICES) {
      const d = this.drums[v];
      d.fade *= Math.exp((-3 * dt) / Math.max(0.01, drums.release * DRUM_DECAY[v]));
      d.build *= Math.exp((-3 * dt) / Math.max(0.01, drums.linger));
    }
    this.clock = time;
    for (let i = 0; i < NOTE_VOICE_SLOTS; i++) {
      const voice = this.voices[i];
      if (voice && voice.offTime !== null && this.voiceLevel(voice) < 0.001) this.voices[i] = null;
    }
  }

  /** Build-mode loudness, which drives `noteEvolve`. */
  private buildLevel(): number {
    let level = 0;
    for (const voice of this.voices) {
      if (voice) level += voice.velocity * buildEnvelope(this.settings[voice.instrument], voice.onTime, voice.offTime, this.clock);
    }
    for (const v of DRUM_VOICES) level += this.drums[v].build * 0.5;
    return level;
  }

  /** The brighter of a voice's two envelopes, for deciding when it is gone. */
  private voiceLevel(voice: Voice): number {
    const s = this.settings[voice.instrument];
    return voice.velocity * Math.max(
      fadeEnvelope(s, voice.onTime, voice.offTime, this.clock),
      buildEnvelope(s, voice.onTime, voice.offTime, this.clock),
    );
  }

  private apply(event: NoteEvent): void {
    if (event.instrument === 'drums') {
      if (event.type !== 'on' || !event.drum) return;
      const d = this.drums[event.drum];
      d.fade = Math.max(d.fade, event.velocity);
      d.build = Math.min(1, d.build + event.velocity * 0.25);
      this.lastInstrument = 'drums';
      this.hit = Math.max(this.hit, event.velocity);
      this.build = Math.min(1, this.build + event.velocity * this.settings.drums.growth * (1 - this.build));
      return;
    }
    if (event.type === 'off') {
      for (const voice of this.voices) {
        if (voice && voice.offTime === null && voice.instrument === event.instrument && voice.note === event.note) {
          voice.offTime = event.time;
          return;
        }
      }
      return;
    }
    const slot = this.pickSlot(event);
    this.voices[slot] = {
      instrument: event.instrument,
      note: event.note,
      velocity: event.velocity,
      onTime: event.time,
      offTime: null,
    };
    this.last = event.note / 127;
    this.lastInstrument = event.instrument;
    this.hit = Math.max(this.hit, event.velocity);
    const growth = this.settings[event.instrument].growth;
    this.build = Math.min(1, this.build + event.velocity * growth * (1 - this.build));
  }

  /** A free slot, else the quietest released voice, else the oldest. */
  private pickSlot(event: NoteEvent): number {
    // Retriggering a note that is still showing reuses its slot.
    const same = this.voices.findIndex((v) => v && v.instrument === event.instrument && v.note === event.note);
    if (same >= 0) return same;
    const free = this.voices.findIndex((v) => v === null);
    if (free >= 0) return free;
    let best = 0;
    let bestScore = Infinity;
    for (let i = 0; i < NOTE_VOICE_SLOTS; i++) {
      const voice = this.voices[i]!;
      // Held voices only lose to each other, oldest first.
      const score = voice.offTime === null ? 10 + voice.onTime / 1e6 : this.voiceLevel(voice);
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    }
    return best;
  }
}

function cloneSettings(settings: Partial<Record<InstrumentId, NoteVisualSettings>>): Record<InstrumentId, NoteVisualSettings> {
  return Object.fromEntries(
    (Object.keys(DEFAULT_VISUAL_SETTINGS) as InstrumentId[]).map((id) => [id, { ...DEFAULT_VISUAL_SETTINGS[id], ...settings[id] }]),
  ) as Record<InstrumentId, NoteVisualSettings>;
}
