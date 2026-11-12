/**
 * The tone library: basses, pads, leads and keys for the tone engine, built
 * from our own oscillators, filters and effects. Each is plain patch data.
 */

import type { Env, TonePatch } from './toneTypes';

export type ToneFamily = 'bass' | 'pad' | 'lead' | 'arp';

export interface Tone {
  id: string;
  name: string;
  family: ToneFamily;
  blurb: string;
  patch: TonePatch;
}

const env = (a: number, d: number, s: number, r: number): Env => ({ a, d, s, r });

export const TONES: Tone[] = [
  // ── Basses ──
  {
    id: 'bass.fat-mono', name: 'Fat mono', family: 'bass', blurb: 'Two saws and a sub through a growling ladder, a filter pluck on every note',
    patch: {
      osc1: { wave: 'saw', level: 0.6 }, osc2: { wave: 'saw', detune: -9, level: 0.5 }, sub: 0.45,
      filter: { mode: 'ladder', cutoff: 180, res: 0.35, drive: 0.5, env: 3.6, keyTrack: 0.4, vel: 0.5 },
      fenv: env(0.002, 0.22, 0.1, 0.12), aenv: env(0.002, 0.4, 0.85, 0.08),
      mono: true, glide: 0.04, drift: 0.3, gain: 1.35,
    },
  },
  {
    id: 'bass.pedal-sub', name: 'Pedal sub', family: 'bass', blurb: 'A round foot-pedal sub: triangle and sine, barely filtered',
    patch: {
      osc1: { wave: 'tri', level: 0.8 }, osc2: { wave: 'sine', oct: -1, level: 0.6 },
      filter: { mode: 'ladder', cutoff: 420, res: 0.1, env: 1, keyTrack: 0.3 },
      fenv: env(0.004, 0.3, 0.3, 0.2), aenv: env(0.006, 0.6, 0.9, 0.18),
      mono: true, glide: 0.06, drift: 0.2, gain: 0.54,
    },
  },
  {
    id: 'bass.dub-round', name: 'Dub round', family: 'bass', blurb: 'Deep and round for dub and roots: triangle and sine under a low lid, a soft start and a little warmth',
    patch: {
      osc1: { wave: 'tri', level: 0.75 }, osc2: { wave: 'sine', level: 0.6 },
      filter: { mode: 'ladder', cutoff: 320, res: 0.08, env: 0.4, keyTrack: 0.2 },
      fenv: env(0.01, 0.3, 0.5, 0.2), aenv: env(0.01, 0.5, 0.92, 0.2),
      mono: true, glide: 0.03, drift: 0.15, fx: { drive: 0.18 }, gain: 0.62,
    },
  },
  {
    id: 'bass.rockers-growl', name: 'Rockers growl', family: 'bass', blurb: 'The dub bass with more mid and a bit of growl, for rockers and rub-a-dub',
    patch: {
      osc1: { wave: 'saw', level: 0.5 }, osc2: { wave: 'tri', level: 0.55 }, sub: 0.3,
      filter: { mode: 'ladder', cutoff: 380, res: 0.2, drive: 0.35, env: 1.2, keyTrack: 0.3, vel: 0.4 },
      fenv: env(0.008, 0.2, 0.3, 0.12), aenv: env(0.008, 0.4, 0.88, 0.14),
      mono: true, glide: 0.03, drift: 0.2, fx: { drive: 0.25 }, gain: 0.85,
    },
  },
  {
    id: 'bass.squelch', name: 'Squelch', family: 'bass', blurb: 'Acid: one saw, a screaming resonant ladder and slides between held notes',
    patch: {
      osc1: { wave: 'saw', level: 0.8 },
      filter: { mode: 'ladder', cutoff: 260, res: 0.82, drive: 0.6, env: 4.2, keyTrack: 0.6, vel: 0.9 },
      fenv: env(0.001, 0.16, 0, 0.08), aenv: env(0.001, 0.3, 0.8, 0.04),
      mono: true, legato: true, glide: 0.07, wheel: 'cutoff', fx: { drive: 0.25, delay: { mix: 0.18, beats: 0.75, fb: 0.35 } }, gain: 1.09,
    },
  },
  {
    id: 'bass.slap-fm', name: 'Slap FM', family: 'bass', blurb: 'A bright FM slap that snaps and settles into a woody body',
    patch: {
      osc1: { wave: 'sine', level: 0.9 }, fm: { ratio: 1, index: 6, decay: 0.12, sustain: 0.12, vel: 0.8 },
      osc2: { wave: 'sine', oct: -1, level: 0.35 },
      filter: { mode: 'lp', cutoff: 2600, res: 0.1, keyTrack: 0.5 },
      fenv: env(0.001, 0.2, 0, 0.1), aenv: env(0.001, 0.5, 0.55, 0.08),
      mono: true, pitchEnv: { cents: 40, time: 0.02 }, gain: 0.53,
    },
  },
  {
    id: 'bass.rubber', name: 'Rubber', family: 'bass', blurb: 'A bouncy FM bass at a 1:2 ratio, soft attack and a plump middle',
    patch: {
      osc1: { wave: 'sine', level: 0.9 }, fm: { ratio: 2, index: 2.6, decay: 0.25, sustain: 0.35, vel: 0.6 },
      filter: { mode: 'lp', cutoff: 1400, res: 0.15, keyTrack: 0.4 },
      fenv: env(0.002, 0.3, 0.2, 0.15), aenv: env(0.004, 0.4, 0.7, 0.1),
      mono: true, glide: 0.03, pitchEnv: { cents: -60, time: 0.04 }, gain: 0.61,
    },
  },
  {
    id: 'bass.envelope-funk', name: 'Envelope funk', family: 'bass', blurb: 'A square bass through an envelope filter that quacks harder the harder you play',
    patch: {
      osc1: { wave: 'square', pw: 0.42, level: 0.6 }, osc2: { wave: 'saw', detune: 6, level: 0.35 }, sub: 0.3,
      filter: { mode: 'off', cutoff: 1000, res: 0 },
      fenv: env(0.001, 0.2, 0, 0.1), aenv: env(0.002, 0.35, 0.8, 0.08),
      mono: true, vel: 0.8, fx: { wah: { amount: 1.2, base: 240, res: 0.8 }, drive: 0.15 }, gain: 0.6,
    },
  },
  {
    id: 'bass.clav', name: 'Clav bass', family: 'bass', blurb: 'A narrow pulse, plucked and band-passed for a stringy, percussive funk line',
    patch: {
      osc1: { wave: 'square', pw: 0.18, level: 0.7 }, osc2: { wave: 'saw', oct: 1, level: 0.2 },
      filter: { mode: 'bp', cutoff: 700, res: 0.45, env: 2.2, keyTrack: 0.8, vel: 0.6 },
      fenv: env(0.001, 0.12, 0.15, 0.06), aenv: env(0.001, 0.25, 0.4, 0.05),
      mono: true, gain: 1.51,
    },
  },
  {
    id: 'bass.reese', name: 'Reese', family: 'bass', blurb: 'Two detuned saws beating against each other, dark and moving',
    patch: {
      osc1: { wave: 'saw', level: 0.6 }, osc2: { wave: 'saw', detune: 18, level: 0.6 }, unison: { voices: 3, detune: 22, spread: 0.6 }, sub: 0.3,
      filter: { mode: 'ladder', cutoff: 520, res: 0.25, drive: 0.4, env: 0.6, keyTrack: 0.3 },
      fenv: env(0.01, 0.5, 0.5, 0.3), aenv: env(0.004, 0.5, 0.95, 0.15),
      mono: true, glide: 0.05, lfo1: { rate: 0.2, shape: 'sine', cutoff: 0.6 }, fx: { drive: 0.2, phaser: { mix: 0.25, rate: 0.12, depth: 0.5, fb: 0.4 } }, gain: 0.76,
    },
  },
  {
    id: 'bass.wobble', name: 'Wobble', family: 'bass', blurb: 'A filter swung by an LFO locked to the tempo, an eighth note at a time',
    patch: {
      osc1: { wave: 'saw', level: 0.55 }, osc2: { wave: 'square', detune: -7, level: 0.45 }, sub: 0.45,
      filter: { mode: 'ladder', cutoff: 260, res: 0.55, drive: 0.6, keyTrack: 0.3 },
      fenv: env(0.002, 0.2, 1, 0.1), aenv: env(0.003, 0.4, 0.9, 0.1),
      mono: true, glide: 0.04, lfo1: { rate: 2, beats: 0.5, shape: 'sine', cutoff: 3.4 }, wheel: 'cutoff', fx: { drive: 0.3 }, gain: 0.89,
    },
  },
  {
    id: 'bass.click-sub', name: 'Click sub', family: 'bass', blurb: 'A pure sine sub with a tight click on the front, for big systems',
    patch: {
      osc1: { wave: 'sine', level: 1 }, noise: 0.06,
      filter: { mode: 'lp', cutoff: 900, res: 0, env: 2.5, keyTrack: 0.2 },
      fenv: env(0.001, 0.015, 0, 0.02), aenv: env(0.001, 0.8, 0.9, 0.08),
      mono: true, pitchEnv: { cents: 300, time: 0.015 }, gain: 0.48,
    },
  },
  {
    id: 'bass.octave-pluck', name: 'Octave pluck', family: 'bass', blurb: 'The note and its octave together, short and springy for running lines',
    patch: {
      osc1: { wave: 'saw', level: 0.5 }, osc2: { wave: 'square', oct: 1, pw: 0.35, level: 0.32 }, sub: 0.35,
      filter: { mode: 'ladder', cutoff: 300, res: 0.4, env: 3.8, keyTrack: 0.5, vel: 0.6 },
      fenv: env(0.001, 0.14, 0.05, 0.08), aenv: env(0.001, 0.3, 0.35, 0.06),
      poly: 4, gain: 1.0,
    },
  },
  {
    id: 'bass.talker', name: 'Talker', family: 'bass', blurb: 'A formant bass that says "yeow": the vowel opens with each note and the mod wheel',
    patch: {
      osc1: { wave: 'saw', level: 0.7 }, osc2: { wave: 'saw', detune: 8, level: 0.5 }, sub: 0.35,
      filter: { mode: 'formant', cutoff: 1000, res: 0.6, vowel: 0.2, vowelEnv: 0.55 },
      fenv: env(0.01, 0.35, 0.2, 0.2), aenv: env(0.004, 0.4, 0.85, 0.12),
      mono: true, glide: 0.06, wheel: 'vowel', fx: { drive: 0.3 }, gain: 0.96,
    },
  },

  {
    id: 'bass.reese-wide', name: 'Wide reese', family: 'bass', blurb: 'Seven detuned saws spread wide over a clean sine sub, slowly phasing and opening with velocity',
    patch: {
      osc1: { wave: 'saw', level: 0.6 }, unison: { voices: 7, detune: 34, spread: 0.9 }, osc2: { wave: 'sine', oct: -1, level: 0.55 },
      filter: { mode: 'ladder', cutoff: 420, res: 0.22, drive: 0.5, env: 1.4, keyTrack: 0.35, vel: 0.7 },
      fenv: env(0.01, 0.6, 0.4, 0.3), aenv: env(0.005, 0.5, 0.95, 0.2),
      vel: 0.5, mono: true, legato: true, glide: 0.06, drift: 0.2, lfo1: { rate: 0.15, shape: 'tri', cutoff: 0.7 }, wheel: 'cutoff',
      fx: { drive: 0.3, phaser: { mix: 0.2, rate: 0.1, depth: 0.5, fb: 0.35 } }, gain: 0.64,
    },
  },
  {
    id: 'bass.punch', name: 'Punch bass', family: 'bass', blurb: 'A short, hard synth bass with a filter snap and a pitch kick, louder and brighter the harder you play',
    patch: {
      osc1: { wave: 'saw', level: 0.55 }, osc2: { wave: 'square', pw: 0.4, detune: -6, level: 0.4 }, sub: 0.5,
      filter: { mode: 'ladder', cutoff: 150, res: 0.3, drive: 0.6, env: 4.2, keyTrack: 0.4, vel: 1 },
      fenv: env(0.001, 0.12, 0.08, 0.08), aenv: env(0.001, 0.35, 0.7, 0.06),
      vel: 0.8, mono: true, glide: 0.02, pitchEnv: { cents: 120, time: 0.015 }, fx: { drive: 0.3 }, gain: 1.1,
    },
  },
  {
    id: 'bass.growl-sub', name: 'Growl sub', family: 'bass', blurb: 'A deep, clean sine sub that grows a driven, buzzing top only when you dig in',
    patch: {
      osc1: { wave: 'sine', level: 0.85 }, osc2: { wave: 'saw', detune: 8, level: 0.3 }, sub: 0.2,
      filter: { mode: 'ladder', cutoff: 260, res: 0.2, drive: 0.8, env: 1.5, keyTrack: 0.3, vel: 1.8 },
      fenv: env(0.004, 0.5, 0.6, 0.2), aenv: env(0.004, 0.6, 0.95, 0.15),
      vel: 0.45, mono: true, glide: 0.04, drift: 0.1, wheel: 'cutoff', fx: { drive: 0.4 }, gain: 0.62,
    },
  },
  {
    id: 'bass.funk-rubber', name: 'Rubber funk', family: 'bass', blurb: 'A rubbery funk bass that boings into each note, its resonant filter quacking with velocity',
    patch: {
      osc1: { wave: 'square', pw: 0.35, level: 0.55 }, osc2: { wave: 'saw', detune: 5, level: 0.35 }, sub: 0.4,
      filter: { mode: 'ladder', cutoff: 220, res: 0.55, drive: 0.35, env: 3, keyTrack: 0.5, vel: 1.2 },
      fenv: env(0.002, 0.18, 0.15, 0.08), aenv: env(0.002, 0.3, 0.75, 0.07),
      vel: 0.7, mono: true, legato: true, glide: 0.05, pitchEnv: { cents: -300, time: 0.06 }, wheel: 'wah', gain: 1.15,
    },
  },
  {
    id: 'bass.analog-fat', name: 'Fat analog', family: 'bass', blurb: 'Three saws, a square and a sub through a warm, drifting ladder: thick, round and moving',
    patch: {
      osc1: { wave: 'saw', level: 0.5 }, unison: { voices: 3, detune: 12, spread: 0.3 }, osc2: { wave: 'square', oct: -1, pw: 0.5, level: 0.45 }, sub: 0.35,
      filter: { mode: 'ladder', cutoff: 240, res: 0.28, drive: 0.55, env: 2.4, keyTrack: 0.45, vel: 0.8 },
      fenv: env(0.004, 0.35, 0.3, 0.2), aenv: env(0.003, 0.5, 0.9, 0.12),
      vel: 0.6, mono: true, glide: 0.035, drift: 0.45, fx: { drive: 0.22 }, gain: 0.75,
    },
  },

  // ── Pads ──
  {
    id: 'pad.ensemble-strings', name: 'Ensemble strings', family: 'pad', blurb: 'Bright divide-down strings spread wide by a slow ensemble chorus',
    patch: {
      osc1: { wave: 'saw', level: 0.5 }, osc2: { wave: 'saw', oct: 1, detune: 4, level: 0.25 },
      filter: { mode: 'lp', cutoff: 3200, res: 0.05, keyTrack: 0.4 },
      fenv: env(0.3, 1, 1, 1), aenv: env(0.35, 1, 0.9, 1.2),
      fx: { chorus: { mix: 0.8, mode: 1 } }, gain: 0.39,
    },
  },
  {
    id: 'pad.brass', name: 'Brass swell', family: 'pad', blurb: 'A poly brass pad: saws with a filter that blooms open on each chord',
    patch: {
      osc1: { wave: 'saw', level: 0.55 }, osc2: { wave: 'saw', detune: 8, level: 0.5 },
      filter: { mode: 'ladder', cutoff: 500, res: 0.15, env: 2.6, keyTrack: 0.5, vel: 0.5 },
      fenv: env(0.12, 0.6, 0.55, 0.5), aenv: env(0.05, 0.8, 0.85, 0.4),
      drift: 0.4, fx: { chorus: { mix: 0.4, mode: 2 } }, gain: 0.4,
    },
  },
  {
    id: 'pad.pwm-strings', name: 'Pulse strings', family: 'pad', blurb: 'Pulse waves whose width breathes with an LFO, the classic poly string shimmer',
    patch: {
      osc1: { wave: 'square', pw: 0.5, level: 0.55 }, osc2: { wave: 'square', pw: 0.3, detune: -6, level: 0.4 },
      filter: { mode: 'ladder', cutoff: 1800, res: 0.1, keyTrack: 0.4 },
      fenv: env(0.4, 1, 1, 1), aenv: env(0.4, 1, 0.9, 1.3),
      lfo1: { rate: 0.7, shape: 'tri', pw: 0.9 }, drift: 0.3, fx: { chorus: { mix: 0.5, mode: 1 } }, gain: 0.19,
    },
  },
  {
    id: 'pad.supersaw', name: 'Supersaw', family: 'pad', blurb: 'Seven saws fanned across the stereo field: the big euphoric chord',
    patch: {
      osc1: { wave: 'saw', level: 0.9 }, unison: { voices: 7, detune: 38, spread: 1 },
      filter: { mode: 'lp', cutoff: 5200, res: 0.1, keyTrack: 0.3 },
      fenv: env(0.05, 1, 1, 0.8), aenv: env(0.08, 1, 0.9, 0.9),
      poly: 6, fx: { delay: { mix: 0.2, beats: 0.75, fb: 0.35, tone: 0.6 } }, gain: 0.23,
    },
  },
  {
    id: 'pad.sweep', name: 'Slow sweep', family: 'pad', blurb: 'A long filter sweep that rises over four bars and falls back',
    patch: {
      osc1: { wave: 'saw', level: 0.5 }, osc2: { wave: 'saw', detune: 11, level: 0.5 },
      filter: { mode: 'ladder', cutoff: 600, res: 0.45, keyTrack: 0.3 },
      fenv: env(1, 1, 1, 2), aenv: env(0.8, 1, 0.9, 2),
      lfo1: { rate: 0.06, beats: 16, shape: 'tri', cutoff: 3 }, drift: 0.4, fx: { chorus: { mix: 0.4, mode: 1 } }, gain: 0.9,
    },
  },
  {
    id: 'pad.glass', name: 'Glass', family: 'pad', blurb: 'A digital FM bell-pad, clear and cold, with a soft tail',
    patch: {
      osc1: { wave: 'sine', level: 0.8 }, fm: { ratio: 3.5, index: 2.2, decay: 1.4, sustain: 0.3 },
      osc2: { wave: 'tri', oct: 1, level: 0.15 },
      filter: { mode: 'lp', cutoff: 7000, res: 0.05 },
      fenv: env(0.01, 1, 1, 1), aenv: env(0.02, 1.8, 0.6, 1.8),
      fx: { chorus: { mix: 0.35, mode: 2 }, delay: { mix: 0.22, beats: 1.5, fb: 0.4, tone: 0.8 } }, gain: 0.23,
    },
  },
  {
    id: 'pad.aah', name: 'Aah choir', family: 'pad', blurb: 'A vocal pad: saws through a formant filter that drifts between "aah" and "ooh"',
    patch: {
      osc1: { wave: 'saw', level: 0.6 }, osc2: { wave: 'saw', detune: 9, level: 0.5 }, noise: 0.03,
      filter: { mode: 'formant', cutoff: 1000, res: 0.55, vowel: 0.05 },
      fenv: env(0.6, 1, 1, 1.5), aenv: env(0.5, 1, 0.9, 1.6),
      lfo1: { rate: 0.12, shape: 'sine', vowel: 0.35 }, lfo2: { rate: 5, shape: 'sine', pitch: 6, delay: 1 }, wheel: 'vowel',
      fx: { chorus: { mix: 0.6, mode: 1 } }, gain: 0.46,
    },
  },
  {
    id: 'pad.shimmer', name: 'Shimmer', family: 'pad', blurb: 'An octave-up sparkle over a soft pad, washed in a long, bright echo',
    patch: {
      osc1: { wave: 'tri', level: 0.6 }, osc2: { wave: 'saw', oct: 1, detune: 5, level: 0.25 },
      filter: { mode: 'lp', cutoff: 4200, res: 0.1 },
      fenv: env(0.5, 1, 1, 2), aenv: env(0.6, 1, 0.85, 2.5),
      fx: { chorus: { mix: 0.6, mode: 2 }, delay: { mix: 0.38, beats: 1.5, fb: 0.62, tone: 0.9 } }, gain: 0.36,
    },
  },
  {
    id: 'pad.dark-drone', name: 'Dark drone', family: 'pad', blurb: 'Low, slow and heavy: detuned saws under a dark filter that barely moves',
    patch: {
      osc1: { wave: 'saw', oct: -1, level: 0.6 }, osc2: { wave: 'square', oct: -1, detune: 13, level: 0.4 }, noise: 0.03,
      filter: { mode: 'ladder', cutoff: 320, res: 0.4, drive: 0.4, keyTrack: 0.2 },
      fenv: env(2, 1, 1, 3), aenv: env(1.5, 1, 1, 3),
      lfo1: { rate: 0.05, shape: 'random', cutoff: 0.8 }, drift: 0.6, fx: { phaser: { mix: 0.3, rate: 0.05, depth: 0.6, fb: 0.5 } }, gain: 0.85,
    },
  },
  {
    id: 'pad.arp-pluck', name: 'Arp pluck', family: 'pad', blurb: 'A short poly pluck made for arpeggios, with a dotted echo on it',
    patch: {
      osc1: { wave: 'saw', level: 0.55 }, osc2: { wave: 'square', detune: 7, pw: 0.4, level: 0.35 },
      filter: { mode: 'ladder', cutoff: 420, res: 0.35, env: 3.8, keyTrack: 0.5, vel: 0.6 },
      fenv: env(0.001, 0.18, 0, 0.15), aenv: env(0.001, 0.4, 0, 0.3),
      fx: { delay: { mix: 0.3, beats: 0.75, fb: 0.45 } }, gain: 0.82,
    },
  },
  {
    id: 'pad.sync-lead', name: 'Sync pad', family: 'pad', blurb: 'A hard-synced oscillator swept by the envelope: a resonant, tearing chord',
    patch: {
      osc1: { wave: 'saw', level: 0.15 }, osc2: { wave: 'saw', semi: 7, level: 0.6 }, sync: true,
      filter: { mode: 'ladder', cutoff: 1200, res: 0.45, env: 1.6, keyTrack: 0.4 },
      fenv: env(0.05, 0.8, 0.5, 0.6), aenv: env(0.04, 1, 0.85, 0.7),
      lfo1: { rate: 0.3, shape: 'tri', pitch: 0 }, fx: { chorus: { mix: 0.35, mode: 2 } }, gain: 0.5,
    },
  },
  {
    id: 'pad.vocoder', name: 'Robot choir', family: 'pad', blurb: 'A vocoder-like chord: buzzing pulses and noise through moving vowel bands',
    patch: {
      osc1: { wave: 'square', pw: 0.25, level: 0.6 }, osc2: { wave: 'saw', detune: 5, level: 0.4 }, noise: 0.08,
      filter: { mode: 'formant', cutoff: 1000, res: 0.75, vowel: 0.5 },
      fenv: env(0.08, 0.5, 0.8, 0.5), aenv: env(0.06, 0.5, 0.9, 0.5),
      lfo1: { rate: 1, beats: 2, shape: 'tri', vowel: 0.45 }, wheel: 'vowel', fx: { chorus: { mix: 0.3, mode: 2 } }, gain: 0.27,
    },
  },
  {
    id: 'pad.lush-80s', name: 'Lush eighties', family: 'pad', blurb: 'Detuned poly saws with drift and a deep chorus, warm and wide',
    patch: {
      osc1: { wave: 'saw', level: 0.55 }, osc2: { wave: 'saw', detune: 14, level: 0.55 },
      filter: { mode: 'ladder', cutoff: 1500, res: 0.2, env: 0.8, keyTrack: 0.4 },
      fenv: env(0.3, 1.2, 0.6, 1), aenv: env(0.25, 1, 0.9, 1.2),
      drift: 0.7, fx: { chorus: { mix: 0.7, mode: 2 } }, gain: 0.37,
    },
  },
  {
    id: 'pad.air', name: 'Air', family: 'pad', blurb: 'Breath and noise tuned by a resonant band-pass: wind with a note in it',
    patch: {
      osc1: { wave: 'noise', level: 0.9 }, osc2: { wave: 'sine', level: 0.15 },
      filter: { mode: 'bp', cutoff: 800, res: 0.88, keyTrack: 1 },
      fenv: env(1, 1, 1, 2), aenv: env(1.2, 1, 0.9, 2.5),
      lfo1: { rate: 0.1, shape: 'sine', cutoff: 0.6 }, fx: { chorus: { mix: 0.5, mode: 1 } }, gain: 0.55,
    },
  },
  {
    id: 'pad.evolving', name: 'Evolving', family: 'pad', blurb: 'Two slow LFOs on pulse width and filter that never quite repeat',
    patch: {
      osc1: { wave: 'square', pw: 0.5, level: 0.5 }, osc2: { wave: 'saw', detune: -10, level: 0.45 }, noise: 0.02,
      filter: { mode: 'lp', cutoff: 1100, res: 0.35, keyTrack: 0.3 },
      fenv: env(1, 1, 1, 2), aenv: env(1, 1, 0.9, 2.2),
      lfo1: { rate: 0.13, shape: 'tri', pw: 0.8 }, lfo2: { rate: 0.071, shape: 'sine', cutoff: 1.6 }, drift: 0.5,
      fx: { phaser: { mix: 0.3, rate: 0.08, depth: 0.7, fb: 0.4 }, chorus: { mix: 0.4, mode: 1 } }, gain: 0.23,
    },
  },

  // ── Leads and keys ──
  {
    id: 'lead.fat-saw', name: 'Fat saw lead', family: 'lead', blurb: 'Five detuned saws, mono with a glide between held notes: big, wide and singing',
    patch: {
      osc1: { wave: 'saw', level: 0.8 }, unison: { voices: 5, detune: 22, spread: 0.8 }, osc2: { wave: 'saw', oct: -1, level: 0.25 },
      filter: { mode: 'ladder', cutoff: 2200, res: 0.2, env: 1.2, keyTrack: 0.5, drive: 0.3 },
      fenv: env(0.01, 0.5, 0.6, 0.3), aenv: env(0.008, 0.4, 0.9, 0.25),
      mono: true, legato: true, glide: 0.09, lfo1: { rate: 5.4, shape: 'sine', pitch: 14, delay: 0.6 }, wheel: 'vibrato', bend: 2,
      fx: { drive: 0.12, chorus: { mix: 0.3, mode: 2 }, delay: { mix: 0.22, beats: 0.75, fb: 0.38, tone: 0.6 } }, gain: 0.6,
    },
  },
  {
    id: 'lead.hollow', name: 'Hollow square', family: 'lead', blurb: 'A hollow square-wave lead; the mod wheel adds vibrato',
    patch: {
      osc1: { wave: 'square', pw: 0.5, level: 0.7 }, osc2: { wave: 'square', oct: 1, pw: 0.5, detune: 4, level: 0.15 },
      filter: { mode: 'lp', cutoff: 3200, res: 0.15, env: 0.6, keyTrack: 0.6 },
      fenv: env(0.005, 0.3, 0.7, 0.2), aenv: env(0.006, 0.3, 0.9, 0.18),
      mono: true, glide: 0.04, wheel: 'vibrato', lfo1: { rate: 5.8, shape: 'sine', pitch: 8, delay: 0.8 },
      fx: { chorus: { mix: 0.2, mode: 1 }, delay: { mix: 0.18, beats: 0.5, fb: 0.3 } }, gain: 0.28,
    },
  },
  {
    id: 'lead.pluck-delay', name: 'Bright pluck', family: 'lead', blurb: 'A bright, snappy pluck through a dotted-eighth echo: made for arps and riffs',
    patch: {
      osc1: { wave: 'saw', level: 0.6 }, osc2: { wave: 'square', oct: 1, pw: 0.3, level: 0.25 },
      filter: { mode: 'ladder', cutoff: 900, res: 0.3, env: 3.4, keyTrack: 0.6, vel: 0.7 },
      fenv: env(0.001, 0.16, 0, 0.12), aenv: env(0.001, 0.32, 0, 0.25),
      poly: 6, fx: { delay: { mix: 0.32, beats: 0.75, fb: 0.42, tone: 0.65 }, chorus: { mix: 0.2, mode: 2 } }, gain: 1,
    },
  },
  {
    id: 'lead.pwm', name: 'Pulse lead', family: 'lead', blurb: 'A pulse-width lead that shimmers as the width moves, warm and retro',
    patch: {
      osc1: { wave: 'square', pw: 0.5, level: 0.6 }, osc2: { wave: 'square', pw: 0.35, detune: -7, level: 0.45 },
      filter: { mode: 'ladder', cutoff: 1900, res: 0.25, env: 1.2, keyTrack: 0.5 },
      fenv: env(0.01, 0.4, 0.6, 0.3), aenv: env(0.01, 0.3, 0.9, 0.3),
      mono: true, glide: 0.06, lfo1: { rate: 0.9, shape: 'tri', pw: 0.8 }, lfo2: { rate: 5.2, shape: 'sine', pitch: 10, delay: 0.7 }, wheel: 'vibrato',
      fx: { chorus: { mix: 0.45, mode: 2 }, delay: { mix: 0.2, beats: 0.75, fb: 0.35 } }, gain: 0.32,
    },
  },
  {
    id: 'lead.fm-bell', name: 'FM bell lead', family: 'lead', blurb: 'A clear FM bell for melodies, ringing out over a soft body',
    patch: {
      osc1: { wave: 'sine', level: 0.85 }, fm: { ratio: 3.5, index: 3.2, decay: 0.6, sustain: 0.15, vel: 0.8 },
      osc2: { wave: 'sine', oct: 1, level: 0.1 },
      filter: { mode: 'lp', cutoff: 8000, res: 0 },
      fenv: env(0.001, 1, 1, 0.6), aenv: env(0.001, 1.2, 0.25, 0.7),
      poly: 6, fx: { delay: { mix: 0.25, beats: 1.5, fb: 0.4, tone: 0.8 }, chorus: { mix: 0.2, mode: 2 } }, gain: 0.4,
    },
  },
  {
    id: 'lead.acid', name: 'Acid lead', family: 'lead', blurb: 'A screaming resonant saw for riffs: slides between held notes and opens on accents',
    patch: {
      osc1: { wave: 'saw', level: 0.8 }, osc2: { wave: 'square', oct: 1, pw: 0.5, level: 0.15 },
      filter: { mode: 'ladder', cutoff: 520, res: 0.78, drive: 0.6, env: 3.6, keyTrack: 0.6, vel: 0.9 },
      fenv: env(0.001, 0.2, 0.05, 0.1), aenv: env(0.001, 0.3, 0.8, 0.06),
      mono: true, legato: true, glide: 0.06, wheel: 'cutoff',
      fx: { drive: 0.25, delay: { mix: 0.24, beats: 0.75, fb: 0.4 } }, gain: 0.72,
    },
  },
  {
    id: 'lead.soar', name: 'Soaring lead', family: 'lead', blurb: 'A singing mono lead with a long glide and delayed vibrato',
    patch: {
      osc1: { wave: 'saw', level: 0.55 }, osc2: { wave: 'square', detune: 7, pw: 0.45, level: 0.4 },
      filter: { mode: 'ladder', cutoff: 1400, res: 0.3, env: 1.5, keyTrack: 0.6, drive: 0.3 },
      fenv: env(0.02, 0.6, 0.5, 0.3), aenv: env(0.01, 0.5, 0.9, 0.3),
      mono: true, legato: true, glide: 0.14, lfo1: { rate: 5.2, shape: 'sine', pitch: 18, delay: 0.5 }, wheel: 'vibrato', bend: 2,
      fx: { delay: { mix: 0.25, beats: 0.75, fb: 0.4 }, chorus: { mix: 0.2, mode: 2 } }, gain: 0.74,
    },
  },
  {
    id: 'lead.square', name: 'Square lead', family: 'lead', blurb: 'A hollow square lead, plain and punchy, that cuts through a mix',
    patch: {
      osc1: { wave: 'square', pw: 0.5, level: 0.6 }, osc2: { wave: 'square', oct: -1, pw: 0.5, level: 0.25 },
      filter: { mode: 'ladder', cutoff: 2200, res: 0.2, env: 1, keyTrack: 0.5 },
      fenv: env(0.005, 0.3, 0.6, 0.2), aenv: env(0.005, 0.3, 0.85, 0.15),
      mono: true, glide: 0.03, wheel: 'vibrato', gain: 0.48,
    },
  },
  {
    id: 'lead.high-whistle', name: 'High whistle', family: 'lead', blurb: 'A high, smooth sine whistle with a long glide, a slow vibrato that fades in and a breath of air',
    patch: {
      osc1: { wave: 'sine', oct: 1, level: 0.75 }, osc2: { wave: 'tri', oct: 1, detune: 4, level: 0.3 }, noise: 0.025,
      filter: { mode: 'lp', cutoff: 5200, res: 0.05, keyTrack: 0.4 },
      fenv: env(0.05, 0.5, 1, 0.3), aenv: env(0.06, 0.4, 0.92, 0.35),
      vel: 0.35, mono: true, legato: true, glide: 0.28, drift: 0.15, lfo1: { rate: 5.4, shape: 'sine', pitch: 22, delay: 0.9 }, wheel: 'vibrato', bend: 2,
      fx: { chorus: { mix: 0.15, mode: 2 }, delay: { mix: 0.22, beats: 0.75, fb: 0.35, tone: 0.5 } }, gain: 0.32,
    },
  },
  {
    id: 'lead.glide-whistle', name: 'Glide whistle', family: 'lead', blurb: 'The whistle with a brighter edge, a longer slide and a quicker vibrato',
    patch: {
      osc1: { wave: 'tri', oct: 1, level: 0.65 }, osc2: { wave: 'square', oct: 1, pw: 0.5, detune: -3, level: 0.12 }, noise: 0.035,
      filter: { mode: 'ladder', cutoff: 2600, res: 0.18, env: 0.6, keyTrack: 0.6, vel: 0.4 },
      fenv: env(0.08, 0.6, 0.7, 0.3), aenv: env(0.04, 0.4, 0.9, 0.3),
      vel: 0.4, mono: true, legato: true, glide: 0.36, drift: 0.2, lfo1: { rate: 5.9, shape: 'sine', pitch: 26, delay: 0.7 }, wheel: 'vibrato', bend: 2,
      fx: { delay: { mix: 0.25, beats: 0.75, fb: 0.38, tone: 0.55 } }, gain: 0.6,
    },
  },
  {
    id: 'arp.pluck-up', name: 'Up arp', family: 'arp', blurb: 'Hold a chord and it runs up two octaves in sixteenths, a bright, short pluck with an echo',
    patch: {
      osc1: { wave: 'saw', level: 0.5 }, osc2: { wave: 'square', pw: 0.3, detune: 6, level: 0.35 },
      filter: { mode: 'ladder', cutoff: 600, res: 0.35, env: 3, keyTrack: 0.5, vel: 0.6 },
      fenv: env(0.001, 0.12, 0.05, 0.08), aenv: env(0.001, 0.2, 0.2, 0.08),
      poly: 4, vel: 0.7, arp: { mode: 'up', rate: 0.25, octaves: 2, gate: 0.6 },
      fx: { delay: { mix: 0.25, beats: 0.75, fb: 0.4, tone: 0.6 } }, gain: 0.7,
    },
  },
  {
    id: 'arp.bounce', name: 'Bounce arp', family: 'arp', blurb: 'A round square-wave arp that bounces up and down the held chord in eighths',
    patch: {
      osc1: { wave: 'square', pw: 0.45, level: 0.55 }, osc2: { wave: 'tri', oct: 1, level: 0.25 },
      filter: { mode: 'ladder', cutoff: 900, res: 0.25, env: 1.8, keyTrack: 0.5, vel: 0.5 },
      fenv: env(0.002, 0.18, 0.2, 0.1), aenv: env(0.002, 0.3, 0.4, 0.1),
      poly: 4, vel: 0.7, arp: { mode: 'updown', rate: 0.5, octaves: 1, gate: 0.7 },
      fx: { chorus: { mix: 0.2, mode: 2 } }, gain: 0.6,
    },
  },
  {
    id: 'arp.glass', name: 'Glass arp', family: 'arp', blurb: 'A glassy FM bell picking random notes from three octaves of the chord, latched so it keeps going',
    patch: {
      osc1: { wave: 'sine', level: 0.8 }, fm: { ratio: 3.5, index: 2.5, decay: 0.25, sustain: 0.1, vel: 0.8 },
      filter: { mode: 'lp', cutoff: 6000, res: 0, keyTrack: 0.3 },
      fenv: env(0.001, 1, 1, 0.3), aenv: env(0.001, 0.6, 0.1, 0.4),
      poly: 6, vel: 0.8, arp: { mode: 'random', rate: 0.25, octaves: 3, gate: 0.5, latch: true },
      fx: { delay: { mix: 0.3, beats: 0.75, fb: 0.45, tone: 0.5 }, chorus: { mix: 0.2, mode: 2 } }, gain: 0.4,
    },
  },
  {
    id: 'arp.trance', name: 'Trance arp', family: 'arp', blurb: 'Wide detuned saws running up and down the chord in quick sixteenths, for driving builds',
    patch: {
      osc1: { wave: 'saw', level: 0.6 }, unison: { voices: 3, detune: 18, spread: 0.7 },
      filter: { mode: 'ladder', cutoff: 1100, res: 0.3, env: 2, keyTrack: 0.5, vel: 0.6 },
      fenv: env(0.001, 0.1, 0.2, 0.06), aenv: env(0.001, 0.15, 0.5, 0.05),
      poly: 4, vel: 0.6, arp: { mode: 'updown', rate: 0.25, octaves: 2, gate: 0.45 },
      fx: { delay: { mix: 0.22, beats: 0.75, fb: 0.35 } }, gain: 0.9,
    },
  },
  {
    id: 'keys.funk-clav', name: 'Funk clav', family: 'lead', blurb: 'A stringy, percussive keyboard for choppy funk chords; plays harder through the wah',
    patch: {
      osc1: { wave: 'square', pw: 0.12, level: 0.6 }, osc2: { wave: 'square', oct: 1, pw: 0.3, level: 0.3 },
      filter: { mode: 'bp', cutoff: 1300, res: 0.4, env: 1.8, keyTrack: 0.7, vel: 0.7 },
      fenv: env(0.001, 0.08, 0.3, 0.05), aenv: env(0.001, 0.4, 0.3, 0.06),
      poly: 6, vel: 0.8, fx: { wah: { amount: 0.8, base: 500, res: 0.6 } }, gain: 0.72,
    },
  },
  {
    id: 'keys.tine', name: 'Tine piano', family: 'lead', blurb: 'An electric piano modeled with FM: a bell-like tine and a warm, round body',
    patch: {
      osc1: { wave: 'sine', level: 0.85 }, fm: { ratio: 1, index: 3.4, decay: 0.45, sustain: 0.06, vel: 0.9 },
      osc2: { wave: 'sine', oct: 2, semi: 7, level: 0.06 },
      filter: { mode: 'lp', cutoff: 5000, res: 0, keyTrack: 0.4 },
      fenv: env(0.001, 1, 1, 0.4), aenv: env(0.001, 2.4, 0.2, 0.5),
      poly: 8, vel: 0.85, fx: { phaser: { mix: 0.25, rate: 0.4, depth: 0.45, fb: 0.2 }, chorus: { mix: 0.25, mode: 2 } }, gain: 0.37,
    },
  },
  {
    id: 'keys.stab', name: 'House stab', family: 'lead', blurb: 'A short, bright chord stab with a filter snap and a dotted echo',
    patch: {
      osc1: { wave: 'saw', level: 0.5 }, osc2: { wave: 'saw', detune: 12, level: 0.5 },
      filter: { mode: 'ladder', cutoff: 700, res: 0.3, env: 3, keyTrack: 0.4, vel: 0.5 },
      fenv: env(0.001, 0.15, 0.1, 0.1), aenv: env(0.001, 0.25, 0.2, 0.12),
      fx: { delay: { mix: 0.28, beats: 0.75, fb: 0.4 }, chorus: { mix: 0.3, mode: 2 } }, gain: 0.6,
    },
  },
  {
    id: 'keys.skank-piano', name: 'Skank piano', family: 'lead', blurb: 'Bright, percussive and a little honky, with a fast decay for choked offbeats',
    patch: {
      osc1: { wave: 'tri', level: 0.6 }, osc2: { wave: 'saw', oct: 1, detune: 7, level: 0.22 },
      filter: { mode: 'lp', cutoff: 4200, res: 0.1, env: 1.2, keyTrack: 0.5, vel: 0.6 },
      fenv: env(0.001, 0.12, 0.2, 0.06), aenv: env(0.001, 0.25, 0.1, 0.05),
      poly: 6, vel: 0.8, fx: { drive: 0.1 }, gain: 0.6,
    },
  },
  {
    id: 'keys.bubble-organ', name: 'Bubble organ', family: 'lead', blurb: 'Drawbar-style organ for the bubble: a soft key click and a gentle rotary-style chorus',
    patch: {
      osc1: { wave: 'sine', level: 0.6 }, osc2: { wave: 'sine', oct: 1, level: 0.35 }, noise: 0.03,
      filter: { mode: 'lp', cutoff: 3000, res: 0.05, keyTrack: 0.4 },
      fenv: env(0.001, 0.02, 1, 0.05), aenv: env(0.004, 0.2, 0.85, 0.06),
      poly: 6, vel: 0.5, fx: { chorus: { mix: 0.4, mode: 2 } }, gain: 0.55,
    },
  },
  {
    id: 'keys.chop-clav', name: 'Chop clav', family: 'lead', blurb: 'A clavinet-style chop with no wah: tight, stringy and gone almost at once',
    patch: {
      osc1: { wave: 'square', pw: 0.12, level: 0.6 }, osc2: { wave: 'square', oct: 1, pw: 0.3, level: 0.3 },
      filter: { mode: 'bp', cutoff: 1500, res: 0.35, env: 1.6, keyTrack: 0.7, vel: 0.7 },
      fenv: env(0.001, 0.06, 0.3, 0.03), aenv: env(0.001, 0.12, 0.1, 0.03),
      poly: 6, vel: 0.8, gain: 0.75,
    },
  },
  {
    id: 'keys.skank-guitar', name: 'Skank guitar', family: 'lead', blurb: 'A plucky, muted, mid-heavy upstroke, made from a filtered saw and a pick of noise',
    patch: {
      osc1: { wave: 'saw', level: 0.5 }, osc2: { wave: 'square', pw: 0.3, detune: 5, level: 0.3 }, noise: 0.05,
      filter: { mode: 'bp', cutoff: 1100, res: 0.3, env: 1.5, keyTrack: 0.6, vel: 0.5 },
      fenv: env(0.001, 0.06, 0.2, 0.03), aenv: env(0.001, 0.1, 0.05, 0.03),
      poly: 6, vel: 0.7, fx: { chorus: { mix: 0.15, mode: 2 } }, gain: 0.8,
    },
  },
  {
    id: 'keys.dub-skank', name: 'Dub skank', family: 'lead', blurb: 'The skank guitar into a dotted-eighth tape echo, for sparse dub chops',
    patch: {
      osc1: { wave: 'saw', level: 0.5 }, osc2: { wave: 'square', pw: 0.3, detune: 5, level: 0.3 }, noise: 0.04,
      filter: { mode: 'bp', cutoff: 1000, res: 0.3, env: 1.4, keyTrack: 0.6, vel: 0.5 },
      fenv: env(0.001, 0.06, 0.2, 0.03), aenv: env(0.001, 0.1, 0.05, 0.03),
      poly: 6, vel: 0.7, fx: { delay: { mix: 0.38, beats: 0.75, fb: 0.5, tone: 0.4 } }, gain: 0.8,
    },
  },
  {
    id: 'keys.skank-ep', name: 'Skank tine', family: 'lead', blurb: 'An electric piano with a short tine bark, for skanks and vamps',
    patch: {
      osc1: { wave: 'sine', level: 0.85 }, fm: { ratio: 1, index: 2.6, decay: 0.2, sustain: 0.05, vel: 0.9 },
      filter: { mode: 'lp', cutoff: 5000, res: 0, keyTrack: 0.4 },
      fenv: env(0.001, 1, 1, 0.2), aenv: env(0.001, 0.4, 0.05, 0.08),
      poly: 8, vel: 0.85, fx: { chorus: { mix: 0.2, mode: 2 } }, gain: 0.42,
    },
  },
];

const BY_ID = new Map(TONES.map((t) => [t.id, t]));

export function toneById(id: string | null | undefined): Tone | undefined {
  return id ? BY_ID.get(id) : undefined;
}

export const TONE_FAMILY_LABELS: Record<ToneFamily, string> = { bass: 'Basses', pad: 'Pads', lead: 'Leads and keys', arp: 'Arps (hold a chord)' };
