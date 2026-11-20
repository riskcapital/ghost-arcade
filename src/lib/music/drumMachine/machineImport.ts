/**
 * Parts for the drum machine from elsewhere: the session's beat clips and the
 * beat library (step patterns by kit voice), and beats made up on the spot.
 *
 * A pattern names its drums by voice (kick, snare, hats); the machine has
 * pads. Each voice goes to the first pad on the sequencer that plays that
 * role, or the nearest thing the kit has.
 *
 * Pure: the runtime adds the part to the beat.
 */

import { noteGrid } from '../grid';
import { patternBeats, type DrumPattern } from '../drumPattern';
import { DRUM_VOICES, type DrumVoice } from '../noteEvents';
import { emptyPart, emptyTrack, partSteps, type Part, type PartBars } from './machineBeat';

/** A part made from a session clip carries the clip's id, so it is brought in once. */
export const CLIP_PART_PREFIX = 'part-clip-';
export const RANDOM_PART_PREFIX = 'part-rnd-';

/** What a voice plays on when the kit has no pad of its own role. */
const STAND_INS: Record<DrumVoice, DrumVoice[]> = {
  kick: [],
  snare: ['clap', 'rim'],
  clap: ['snare', 'rim'],
  hatClosed: ['hatOpen', 'rim'],
  hatOpen: ['hatClosed', 'crash'],
  tom: ['rim', 'snare'],
  rim: ['clap', 'snare', 'hatClosed'],
  crash: ['hatOpen'],
};

/** The pad each voice plays on: `pads` are the pads on the sequencer, in its order. */
export function padsForVoices(pads: ReadonlyArray<{ index: number; role: DrumVoice }>): Partial<Record<DrumVoice, number>> {
  const first = (role: DrumVoice) => pads.find((p) => p.role === role)?.index;
  const out: Partial<Record<DrumVoice, number>> = {};
  for (const voice of DRUM_VOICES) {
    const pad = first(voice) ?? STAND_INS[voice].map(first).find((p) => p !== undefined);
    if (pad !== undefined) out[voice] = pad;
  }
  return out;
}

function trackFor(part: Part, pad: number) {
  while (part.tracks.length <= pad) part.tracks.push(emptyTrack(partSteps(part)));
  return part.tracks[pad];
}

/** A step pattern as a part: up to four bars of it, on its own grid. */
export function partFromPattern(pattern: DrumPattern, pads: ReadonlyArray<{ index: number; role: DrumVoice }>, name: string, id?: string): Part {
  const bars = Math.max(1, Math.round(patternBeats(pattern) / 4));
  const partBars: PartBars = bars >= 4 ? 4 : bars >= 2 ? 2 : 1;
  const part = emptyPart(name.slice(0, 40) || 'Beat', 'loop', partBars, noteGrid(pattern.grid));
  if (id) part.id = id;
  part.swing = Math.max(0, Math.min(0.5, pattern.swing || 0));
  const steps = Math.min(partSteps(part), pattern.steps);
  const map = padsForVoices(pads);
  for (const voice of DRUM_VOICES) {
    const pad = map[voice];
    if (pad === undefined) continue;
    const track = trackFor(part, pad);
    // A pattern shorter than the part repeats to fill it.
    for (let i = 0; i < partSteps(part); i++) {
      const v = pattern.tracks[voice]?.[i % steps] ?? 0;
      if (v > 0) track.vel[i] = Math.max(track.vel[i], Math.min(1, v));
    }
  }
  return part;
}

// ── Random beats ────────────────────────────────────────────────────────

export const RANDOM_STYLES = [
  { id: 'house', label: 'House' },
  { id: 'techno', label: 'Techno' },
  { id: 'breaks', label: 'Breaks' },
  { id: 'half', label: 'Half-time' },
  { id: 'dub', label: 'Dub' },
  { id: 'electro', label: 'Electro' },
] as const;
export type RandomStyle = (typeof RANDOM_STYLES)[number]['id'];

type Rng = () => number;

/**
 * A two-bar beat made up in a style. The style fixes what makes it that kind
 * of beat (where the kick and the backbeat sit); chance picks the rest: the
 * extra kicks, the ghost notes, the hat pattern, a fill at the end.
 */
export function randomPart(style: RandomStyle, pads: ReadonlyArray<{ index: number; role: DrumVoice }>, rng: Rng = Math.random, id?: string): Part {
  const label = RANDOM_STYLES.find((s) => s.id === style)!.label;
  const part = emptyPart(`Random ${label}`, 'loop', 2, 16);
  if (id) part.id = id;
  const map = padsForVoices(pads);
  const chance = (p: number) => rng() < p;
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rng() * list.length) % list.length];
  // One bar of sixteen steps per voice, then a second bar that answers it.
  const bar: Record<DrumVoice, number[]> = Object.fromEntries(DRUM_VOICES.map((v) => [v, new Array(16).fill(0)])) as Record<DrumVoice, number[]>;
  const hit = (voice: DrumVoice, step: number, vel = 0.9) => { bar[voice][step] = Math.max(bar[voice][step], vel); };
  const each = (voice: DrumVoice, steps: readonly number[], vel = 0.9) => steps.forEach((s) => hit(voice, s, vel));

  switch (style) {
    case 'house':
    case 'techno': {
      each('kick', [0, 4, 8, 12], 0.95);
      if (chance(0.35)) hit('kick', pick([7, 11, 14, 15]), 0.55);
      each(style === 'house' || chance(0.6) ? 'clap' : 'rim', [4, 12], 0.85);
      // Offbeat hats: open in house, closed and tight in techno.
      each(style === 'house' ? 'hatOpen' : 'hatClosed', [2, 6, 10, 14], 0.8);
      const fill = pick([[], [0, 4, 8, 12], [1, 3, 5, 7, 9, 11, 13, 15], [3, 7, 11, 15]] as const);
      each('hatClosed', fill, 0.4);
      break;
    }
    case 'breaks': {
      each('kick', [0, 10], 0.95);
      if (chance(0.6)) hit('kick', pick([3, 6, 7]), 0.7);
      each('snare', [4, 12], 0.9);
      for (const s of [7, 9, 14, 15]) if (chance(0.4)) hit('snare', s, 0.4);
      for (let s = 0; s < 16; s += 2) hit('hatClosed', s, s % 4 === 0 ? 0.75 : 0.5);
      if (chance(0.5)) hit('hatOpen', pick([6, 14]), 0.6);
      break;
    }
    case 'half': {
      hit('kick', 0, 1);
      hit('kick', pick([6, 7, 10, 11]), 0.85);
      if (chance(0.4)) hit('kick', pick([3, 14]), 0.6);
      hit('snare', 8, 0.95);
      if (chance(0.5)) hit('clap', 8, 0.6);
      const dense = chance(0.5);
      for (let s = 0; s < 16; s += dense ? 1 : 2) hit('hatClosed', s, s % 4 === 0 ? 0.75 : s % 2 === 0 ? 0.55 : 0.35);
      break;
    }
    case 'dub': {
      // One drop, or steppers one time in three.
      if (chance(0.33)) each('kick', [0, 4, 8, 12], 0.9);
      else hit('kick', 8, 1);
      hit(chance(0.6) ? 'rim' : 'snare', 8, 0.85);
      for (let s = 0; s < 16; s += 2) hit('hatClosed', s, s % 4 === 2 ? 0.8 : 0.45);
      if (chance(0.5)) hit('hatOpen', 14, 0.55);
      break;
    }
    case 'electro': {
      each('kick', [0, 10], 0.95);
      hit('kick', pick([3, 6, 7]), 0.8);
      each('clap', [4, 12], 0.9);
      for (let s = 0; s < 16; s++) hit('hatClosed', s, s % 4 === 0 ? 0.7 : s % 2 === 0 ? 0.5 : 0.35);
      break;
    }
  }
  // A little percussion off the grid lines.
  if (chance(0.6)) {
    const voice = pick(['rim', 'tom'] as const);
    for (let n = 0, count = 1 + Math.floor(rng() * 3); n < count; n++) hit(voice, pick([3, 5, 6, 9, 11, 13, 15]), 0.5);
  }

  const second = Object.fromEntries(DRUM_VOICES.map((v) => [v, [...bar[v]]])) as Record<DrumVoice, number[]>;
  // The answer: one more kick, and a fill into the next bar.
  if (chance(0.5)) second.kick[pick([11, 14, 15])] = 0.65;
  if (chance(0.7)) {
    const voice = pick(['snare', 'tom'] as const);
    const from = pick([12, 13, 14]);
    for (let s = from; s < 16; s++) second[voice][s] = Math.max(second[voice][s], 0.5 + 0.45 * ((s - from) / Math.max(1, 15 - from)));
  }

  for (const voice of DRUM_VOICES) {
    const pad = map[voice];
    if (pad === undefined) continue;
    const track = trackFor(part, pad);
    for (let s = 0; s < 16; s++) {
      track.vel[s] = Math.max(track.vel[s], bar[voice][s]);
      track.vel[16 + s] = Math.max(track.vel[16 + s], second[voice][s]);
    }
  }
  // Half-time hats get a roll or two.
  if (style === 'half' && map.hatClosed !== undefined) {
    const track = trackFor(part, map.hatClosed);
    for (let n = 0; n < 2; n++) {
      const s = pick([6, 7, 14, 15, 22, 23, 30, 31]);
      if (track.vel[s] > 0) track.roll[s] = pick([2, 3, 4]);
    }
  }
  part.swing = style === 'house' ? 0.12 : style === 'breaks' ? 0.08 : style === 'dub' ? 0.06 : 0;
  return part;
}
