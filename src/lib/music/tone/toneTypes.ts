/**
 * The tone engine's patch formats: plain data, shared by the library, the
 * main thread and the audio worklet that plays them.
 */

import type { ArpSettings } from '../arp';

export type Wave = 'saw' | 'square' | 'tri' | 'sine' | 'noise';
export type FilterMode = 'ladder' | 'lp' | 'bp' | 'hp' | 'notch' | 'formant' | 'off';
export type LfoShape = 'sine' | 'tri' | 'square' | 'saw' | 'random';

export interface Env {
  a: number;
  d: number;
  s: number;
  r: number;
}

export interface Osc {
  wave: Wave;
  /** Octaves and semitones from the played note. */
  oct?: number;
  semi?: number;
  /** Cents. */
  detune?: number;
  level: number;
  /** Pulse width for square, 0.05-0.95. */
  pw?: number;
}

export interface Lfo {
  /** Hz, or, with `beats`, one cycle every that many beats. */
  rate: number;
  beats?: number;
  shape: LfoShape;
  /** Seconds before it reaches full depth. */
  delay?: number;
  pitch?: number;
  cutoff?: number;
  pw?: number;
  amp?: number;
  vowel?: number;
}

export interface TonePatch {
  osc1: Osc;
  osc2?: Osc;
  /** A square an octave under the note. */
  sub?: number;
  noise?: number;
  /** Copies of oscillator 1, detuned (cents across the stack) and spread in stereo. */
  unison?: { voices: number; detune: number; spread: number };
  /** Oscillator 2 restarts with oscillator 1. */
  sync?: boolean;
  /** Oscillator 2, as a sine at `ratio`, frequency-modulates oscillator 1; `index` decays to `sustain` x index over `decay` s. */
  fm?: { ratio: number; index: number; decay: number; sustain?: number; vel?: number };
  filter: {
    mode: FilterMode;
    cutoff: number;
    res: number;
    drive?: number;
    keyTrack?: number;
    /** Octaves of the filter envelope. */
    env?: number;
    vel?: number;
    /** 0-1 across a, e, i, o, u for the formant filter. */
    vowel?: number;
    /** Octaves the vowel moves with the filter envelope. */
    vowelEnv?: number;
  };
  fenv: Env;
  aenv: Env;
  /** How much velocity sets the loudness, 0-1. */
  vel?: number;
  lfo1?: Lfo;
  lfo2?: Lfo;
  glide?: number;
  mono?: boolean;
  legato?: boolean;
  /** Pitch wander and voice-to-voice slop, 0-1. */
  drift?: number;
  poly?: number;
  /** Pitch envelope: cents at the start, gone in `time` s (plucks, slaps). */
  pitchEnv?: { cents: number; time: number };
  /** The mod wheel, aftertouch and bend. */
  wheel?: 'vibrato' | 'cutoff' | 'wah' | 'vowel';
  bend?: number;
  fx?: ToneFx;
  /** Held keys play as a tempo-synced arpeggio instead of a chord. */
  arp?: ArpSettings;
  gain: number;
}

export interface ToneFx {
  drive?: number;
  /** Envelope filter: how far it opens and how fast it follows. */
  wah?: { amount: number; base: number; res: number };
  /** String-machine ensemble: mode 1 slow and deep, 2 quicker. */
  chorus?: { mix: number; mode: 1 | 2 };
  phaser?: { mix: number; rate: number; depth: number; fb: number };
  delay?: { mix: number; beats: number; fb: number; tone?: number };
  /** Bit depth reduction and sample hold, for lo-fi kits. */
  crush?: { bits: number; hold: number };
}

// ── Drums ────────────────────────────────────────────────────────────────

/**
 * membrane: a hand drum (two modes, a small pitch drop, a slap of noise on `tone`).
 * shaker: band-passed noise that swells in and out. scrape: noise in ridges, `rate` per second.
 * bell: three inharmonic sines (agogo, triangle, glass). rise: a friction drum whose pitch climbs by `bend`.
 * glitch: stepped random values `rate` times a second. fm: a metallic two-operator hit, `tone` sets the index.
 * laser: a sine falling `bend` octaves over the whole decay.
 */
export type DrumModel =
  | 'kick' | 'snare' | 'clap' | 'hat' | 'tom' | 'rim' | 'cowbell' | 'cymbal' | 'zap' | 'blip'
  | 'membrane' | 'shaker' | 'scrape' | 'bell' | 'rise' | 'glitch' | 'fm' | 'laser';

/** One drum sound: a model and its settings, each 0-1 unless noted. */
export interface DrumSound {
  model: DrumModel;
  /** Base frequency in Hz. */
  freq: number;
  decay: number;
  /** Brightness; for snares the noise balance. */
  tone: number;
  /** Pitch drop (kick, tom, zap) in octaves. */
  bend?: number;
  click?: number;
  drive?: number;
  level: number;
  /** Open hats are cut by closed ones. */
  choke?: boolean;
  /** This sound cuts every sounding `choke` sound (a closed hat; a muted conga). Slot 3 always does. */
  cuts?: boolean;
  /** Ridges or steps per second (scrape, glitch); the FM ratio for fm. */
  rate?: number;
}

export interface DrumKit {
  id: string;
  name: string;
  blurb: string;
  /** Kit order: kick, snare, clap, closed hat, open hat, tom, rim, crash. */
  sounds: DrumSound[];
  fx?: ToneFx;
  gain: number;
}

/** Per-voice adjustments from the panel, 0-1 with 0.5 meaning as the kit has it. */
export interface DrumTweak {
  tune: number;
  decay: number;
  tone: number;
  drive: number;
  level: number;
}

// ── Messages to the worklet ─────────────────────────────────────────────

export type ToneMessage =
  | { t: 'patch'; patch: TonePatch }
  | { t: 'kit'; kit: DrumKit }
  | { t: 'on'; note: number; vel: number; at: number }
  | { t: 'off'; note: number; at: number }
  | { t: 'hit'; slot: number; vel: number; at: number; tweak: DrumTweak }
  | { t: 'expr'; wheel?: number; pressure?: number; bend?: number }
  | { t: 'tempo'; bpm: number }
  | { t: 'panic' };
