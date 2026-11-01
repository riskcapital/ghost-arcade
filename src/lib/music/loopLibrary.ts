/**
 * The big loop library: basslines, chord progressions, leads and hooks,
 * drum grooves and textures, all original, written in scale degrees so they
 * play in the studio's key. Most are built from a small figure (a bar of
 * bass, a rhythm, a motif) over a progression, which keeps them in the
 * styles they come from and lets one figure serve several progressions.
 *
 * Common progressions and genre rhythms are shared by everyone; melodies here
 * are written for this library.
 */

import type { DrumVoice } from './noteEvents';
import type { BeatLoop, LoopNote, LoopRole, MelodicLoop } from './loops';
import { LEADS } from './leadLibrary';
import { FEELS, applyGroove, voiceLead, type GrooveFeel } from './groove';

export type LoopStyle = 'dub' | 'reggae' | 'techno' | 'house' | 'acid' | 'funk' | 'livetronica' | 'garage' | 'breaks' | 'ambient' | 'pop' | 'jazz' | 'trance' | 'synthwave' | 'minimal';

export const LOOP_STYLE_LABELS: Record<LoopStyle, string> = {
  dub: 'Dub', reggae: 'Roots', techno: 'Techno', house: 'House', acid: 'Acid', funk: 'Funk',
  livetronica: 'Livetronica', garage: 'UK garage', breaks: 'Breaks', ambient: 'Ambient', pop: 'Anthem', jazz: 'Jazz',
  trance: 'Trance', synthwave: 'Synthwave', minimal: 'Minimal',
};

/** Typical tempo for each style, in BPM. */
const STYLE_BPM: Record<LoopStyle, [number, number]> = {
  dub: [66, 80], reggae: [68, 84], techno: [124, 138], house: [118, 128], acid: [125, 140], funk: [95, 115],
  livetronica: [100, 128], garage: [128, 136], breaks: [120, 140], ambient: [60, 100], pop: [100, 128], jazz: [80, 120],
  trance: [128, 140], synthwave: [90, 118], minimal: [118, 128],
};

type LibMelodic = MelodicLoop & { style: LoopStyle; bpm: [number, number] };
type LibBeat = BeatLoop & { style: LoopStyle; bpm: [number, number] };

/** [beat, duration, degree offset (or chord degrees), velocity] */
type Hit = [number, number, number | number[], number?];

const note = (beat: number, dur: number, d: number | number[], v = 0.8): LoopNote => ({ beat, dur, degrees: Array.isArray(d) ? d : [d], velocity: v });

function melodic(id: string, name: string, role: LoopRole, style: LoopStyle, beats: number, notes: LoopNote[]): LibMelodic {
  return { id, name, role, style, bpm: STYLE_BPM[style], beats, notes: notes.sort((a, b) => a.beat - b.beat) };
}

// ── Bass ────────────────────────────────────────────────────────────────
// Written lines: accents and ghost notes, slides where notes overlap (a
// legato tone glides), octave pops and approach notes, and a turnaround in
// the last bar so the loop comes round with a lift.

function written(id: string, name: string, role: LoopRole, style: LoopStyle, tone: string, feel: GrooveFeel, beats: number, hits: Hit[]): LibMelodic {
  const loop = melodic(id, name, role, style, beats, applyGroove(hits.map(([b, dur, d, v]) => note(b, dur, d, v ?? 0.85)), feel));
  return { ...loop, tone };
}

/** A bar-long figure over roots, one bar each: degrees relative to the root. */
function overRoots(roots: number[], bar: (r: number, last: boolean) => Hit[]): Hit[] {
  return roots.flatMap((r, i) => bar(r, i === roots.length - 1).map(([b, dur, d, v]): Hit => [i * 4 + b, dur, d, v]));
}

const BASS: LibMelodic[] = [
  written('cur-bass-basement', 'Basement Pressure', 'bass', 'dub', 'bass.pedal-sub', FEELS.dub, 16, [
    [0, 1.2, 0, 1], [1.5, 0.45, 0, 0.4], [2, 0.9, 4, 0.85], [3, 0.4, 2, 0.7], [3.5, 0.45, 3, 0.7],
    [4, 1.2, 4, 0.95], [5.5, 0.4, 4, 0.4], [6, 0.9, 2, 0.8], [7, 0.9, 0, 0.85],
    [8, 1.2, 0, 1], [9.5, 0.45, 0, 0.4], [10, 0.9, 4, 0.85], [11, 0.4, 5, 0.75], [11.5, 0.45, 6, 0.75],
    [12, 0.9, 7, 1], [13, 0.4, 6, 0.6], [13.5, 0.4, 4, 0.7], [14, 0.9, 3, 0.85], [15, 0.45, 2, 0.7], [15.5, 0.45, -1, 0.75],
  ]),
  written('cur-bass-missing-one', 'Missing One', 'bass', 'dub', 'bass.fat-mono', FEELS.dub, 16, [
    [1, 1.4, 0, 0.95], [2.5, 0.4, 4, 0.6], [3, 0.9, 4, 0.85],
    [5, 1.4, 2, 0.95], [6.5, 0.4, 1, 0.6], [7, 0.9, 0, 0.9],
    [9, 1.4, 0, 0.95], [10.5, 0.4, 4, 0.6], [11, 0.9, 4, 0.85],
    [13, 0.9, 5, 0.9], [14, 0.4, 4, 0.7], [14.5, 0.4, 3, 0.65], [15, 0.45, 2, 0.75], [15.5, 0.45, 1, 0.7],
  ]),
  written('cur-bass-steppers', 'Steppers Lane', 'bass', 'dub', 'bass.pedal-sub', FEELS.dub, 8, [
    [0, 0.45, 0, 1], [1, 0.45, 0, 0.85], [2, 0.45, 0, 0.95], [2.75, 0.2, 2, 0.45], [3, 0.45, 4, 0.85], [3.5, 0.4, 3, 0.6],
    [4, 0.45, 0, 1], [5, 0.45, 0, 0.85], [6, 0.45, 5, 0.95], [6.75, 0.2, 4, 0.45], [7, 0.45, 3, 0.85], [7.5, 0.4, -1, 0.7],
  ]),
  written('cur-bass-rockers', 'Rockers Hill', 'bass', 'reggae', 'bass.fat-mono', FEELS.dub, 8, [
    [0, 0.4, 0, 1], [0.5, 0.3, 0, 0.45], [1, 0.4, 7, 0.8], [1.75, 0.2, 6, 0.45], [2, 0.4, 4, 0.9], [2.5, 0.3, 2, 0.6], [3, 0.8, 3, 0.85],
    [4, 0.4, 0, 1], [4.5, 0.3, 0, 0.45], [5, 0.4, 7, 0.8], [5.75, 0.2, 6, 0.45], [6, 0.4, 5, 0.9], [6.5, 0.3, 4, 0.6], [7, 0.45, 2, 0.8], [7.5, 0.45, 1, 0.7],
  ]),
  written('cur-bass-night-engine', 'Night Engine', 'bass', 'techno', 'bass.reese', FEELS.techno, 8, [
    ...[0, 1, 2, 3].flatMap((b): Hit[] => [[b + 0.25, 0.18, 0, 0.45], [b + 0.5, 0.2, 0, 1], [b + 0.75, 0.18, 0, 0.45]]),
    ...[4, 5, 6].flatMap((b): Hit[] => [[b + 0.25, 0.18, 0, 0.45], [b + 0.5, 0.2, b === 5 ? 4 : 0, 1], [b + 0.75, 0.18, 0, 0.45]]),
    [7.25, 0.18, 7, 0.5], [7.5, 0.2, 6, 0.95], [7.75, 0.18, 4, 0.55],
  ]),
  written('cur-bass-warehouse', 'Warehouse Offbeat', 'bass', 'techno', 'bass.fat-mono', FEELS.techno, 8, [
    [0.5, 0.3, 0, 1], [1.5, 0.3, 0, 0.9], [2.5, 0.3, 0, 1], [3.5, 0.3, 0, 0.9],
    [4.5, 0.3, 0, 1], [5.5, 0.3, 4, 0.9], [6.5, 0.3, 0, 1], [7.25, 0.2, 6, 0.45], [7.5, 0.3, 7, 0.9],
  ]),
  written('cur-bass-tunnel', 'Tunnel Gallop', 'bass', 'techno', 'bass.fat-mono', FEELS.techno, 8, [
    ...[0, 1, 2, 3, 4, 5, 6].flatMap((b): Hit[] => [[b + 0.25, 0.15, 0, 0.5], [b + 0.5, 0.2, 0, 1]]),
    [7.25, 0.15, 6, 0.55], [7.5, 0.2, 4, 0.95], [7.75, 0.15, 6, 0.5],
  ]),
  written('cur-bass-acid-slide', 'Acid Slide', 'bass', 'acid', 'bass.squelch', FEELS.straight, 8, [
    [0, 0.3, 0, 1], [0.25, 0.2, 0, 0.45], [0.5, 0.3, 7, 0.9], [0.75, 0.4, 6, 0.55], [1, 0.3, 0, 0.95], [1.5, 0.3, 2, 0.7], [1.75, 0.45, 3, 0.55],
    [2, 0.3, 0, 1], [2.5, 0.3, 9, 0.85], [2.75, 0.4, 7, 0.55], [3, 0.3, 0, 0.95], [3.5, 0.5, 4, 0.8],
    [4, 0.3, 0, 1], [4.25, 0.2, 0, 0.45], [4.5, 0.3, 7, 0.9], [4.75, 0.4, 6, 0.55], [5, 0.3, 0, 0.95], [5.5, 0.3, 2, 0.7], [5.75, 0.45, 3, 0.55],
    [6, 0.3, 0, 1], [6.5, 0.3, 9, 0.85], [6.75, 0.4, 7, 0.55], [7, 0.3, 5, 0.9], [7.25, 0.3, 6, 0.55], [7.5, 0.5, -1, 0.85],
  ]),
  written('cur-bass-rubber-hose', 'Rubber Hose', 'bass', 'acid', 'bass.squelch', FEELS.straight, 8, [
    [0, 0.25, 0, 1], [0.5, 0.25, 0, 0.45], [0.75, 0.4, 3, 0.85], [1.25, 0.25, 0, 0.45], [1.5, 0.5, 7, 0.95], [2.25, 0.25, 0, 0.5], [2.5, 0.25, 6, 0.8], [3, 0.4, 4, 0.9], [3.5, 0.25, 3, 0.5],
    [4, 0.25, 0, 1], [4.5, 0.25, 0, 0.45], [4.75, 0.4, 3, 0.85], [5.25, 0.25, 0, 0.45], [5.5, 0.5, 7, 0.95], [6.25, 0.25, 9, 0.55], [6.5, 0.4, 7, 0.85], [7, 0.5, 6, 0.9], [7.5, 0.4, 4, 0.7],
  ]),
  written('cur-bass-disco-lung', 'Disco Lung', 'bass', 'house', 'bass.rubber', FEELS.house, 8, [
    [0, 0.3, 0, 1], [0.75, 0.2, 0, 0.45], [1, 0.3, 7, 0.85], [1.75, 0.25, 0, 0.55], [2.5, 0.3, 0, 0.9], [3, 0.2, 7, 0.65], [3.5, 0.3, 6, 0.85],
    [4, 0.3, 0, 1], [4.75, 0.2, 0, 0.45], [5, 0.3, 7, 0.85], [5.75, 0.25, 3, 0.55], [6.5, 0.3, 3, 0.9], [7, 0.2, 10, 0.65], [7.5, 0.3, 2, 0.85], [7.75, 0.2, -1, 0.55],
  ]),
  written('cur-bass-late-club', 'Late Club', 'bass', 'house', 'bass.fat-mono', FEELS.house, 16, overRoots([0, 5, 3, 4], (r, last): Hit[] => [
    [0.5, 0.3, r, 0.95], [1.25, 0.2, r, 0.45], [1.75, 0.3, r + 7, 0.75], [2.5, 0.3, r, 0.95], [3.25, 0.2, r + 4, 0.55],
    last ? [3.5, 0.45, r + 2, 0.85] : [3.5, 0.3, r, 0.85],
  ])),
  written('cur-bass-grease', 'Grease Pocket', 'bass', 'funk', 'bass.slap-fm', FEELS.funk, 8, [
    [0, 0.25, 0, 1], [0.5, 0.15, 0, 0.4], [0.75, 0.25, 7, 0.9], [1.25, 0.15, 0, 0.4], [1.5, 0.25, 6, 0.8], [1.75, 0.25, 4, 0.7], [2.5, 0.25, 0, 0.95], [3, 0.15, 0, 0.4], [3.25, 0.25, 2, 0.8], [3.75, 0.25, 3, 0.85],
    [4, 0.25, 4, 1], [4.5, 0.15, 4, 0.4], [4.75, 0.25, 7, 0.9], [5.5, 0.25, 6, 0.8], [6, 0.25, 4, 0.85], [6.5, 0.25, 2, 0.7], [7, 0.15, 0, 0.4], [7.25, 0.25, -1, 0.8], [7.5, 0.25, 1, 0.75],
  ]),
  written('cur-bass-envelope-strut', 'Envelope Strut', 'bass', 'funk', 'bass.envelope-funk', FEELS.funk, 8, [
    [0, 0.4, 0, 1], [0.75, 0.2, 0, 0.45], [1, 0.3, 2, 0.8], [1.5, 0.4, 3, 0.85], [2.5, 0.2, 4, 0.9], [2.75, 0.2, 4, 0.45], [3, 0.4, 6, 0.85], [3.5, 0.3, 7, 0.8],
    [4, 0.4, 0, 1], [4.75, 0.2, 0, 0.45], [5, 0.3, 2, 0.8], [5.5, 0.4, 3, 0.85], [6.5, 0.3, 5, 0.9], [7, 0.25, 4, 0.7], [7.5, 0.4, -1, 0.85],
  ]),
  written('cur-bass-festival-walk', 'Festival Walk', 'bass', 'livetronica', 'bass.octave-pluck', FEELS.straight, 16, overRoots([0, 5, 3, 4], (r, last): Hit[] => [
    [0, 0.4, r, 1], [0.5, 0.3, r + 7, 0.55], [1, 0.4, r + 4, 0.85], [1.5, 0.3, r + 7, 0.5], [2, 0.4, r + 2, 0.85], [2.5, 0.3, r + 4, 0.55],
    [3, 0.4, last ? r + 3 : r + 7, 0.8], [3.5, 0.3, last ? r + 1 : r + 6, 0.6],
  ])),
  written('cur-bass-two-step', 'Two Step Rumble', 'bass', 'garage', 'bass.reese', FEELS.house, 8, [
    [0, 0.45, 0, 1], [0.75, 0.25, 0, 0.45], [1.75, 0.4, 4, 0.85], [2.5, 0.3, 2, 0.7], [3.25, 0.3, 0, 0.8],
    [4, 0.45, 0, 1], [4.75, 0.25, 0, 0.45], [5.75, 0.4, 5, 0.85], [6.5, 0.3, 4, 0.7], [7.25, 0.3, 2, 0.8], [7.75, 0.2, 1, 0.55],
  ]),
  written('cur-bass-sub-ocean', 'Sub Ocean', 'bass', 'ambient', 'bass.click-sub', FEELS.float, 16, [
    [0, 3.5, 0, 0.9], [4, 1.75, 3, 0.75], [6, 1.75, 4, 0.8], [8, 3.5, 0, 0.9], [12, 1.5, 3, 0.8], [13.5, 0.4, 2, 0.5], [14, 1.9, -1, 0.85],
  ]),
];

// ── Chords ──────────────────────────────────────────────────────────────
// Progressions voice-led (each voice to the nearest note of the next chord),
// with sevenths where the style wants them, in that style's rhythm, and a
// change in the last bar so the phrase turns round.

/** A chord's tones on scale degree `d`. */
const tonesOf = (d: number, seventh: boolean, ninth = false) => [d, d + 2, d + 4, ...(seventh ? [d + 6] : []), ...(ninth ? [d + 8] : [])];

type RHit = [number, number, number];
type ChordRhythm = (bar: number, last: boolean) => RHit[];

const RHYTHM: Record<string, ChordRhythm> = {
  // Short choked chops on 2 and 4, a ghost upstroke after each; the last bar pushes into the next.
  skank: (_b, last) => [[1, 0.18, 0.85], [1.5, 0.1, 0.4], [3, 0.18, 0.85], last ? [3.75, 0.1, 0.5] : [3.5, 0.1, 0.4]],
  bubble: (_b, last) => [[0.5, 0.2, 0.8], [0.75, 0.15, 0.45], [1.5, 0.2, 0.75], [2.5, 0.2, 0.8], [2.75, 0.15, 0.45], ...(last ? [] : [[3.5, 0.2, 0.75] as RHit])],
  house: (_b, last) => [[0.5, 0.25, 0.85], [1.5, 0.25, 0.75], [2.5, 0.25, 0.85], [3.5, 0.25, 0.75], ...(last ? [[3.75, 0.2, 0.6] as RHit] : [])],
  broken: (_b, last) => [[0, 0.9, 0.8], [1.75, 0.4, 0.55], [2.5, last ? 0.6 : 1.2, 0.75], ...(last ? [[3.25, 0.6, 0.6] as RHit] : [])],
  pad: (_b, last) => [[0, last ? 2.9 : 3.9, 0.62], ...(last ? [[3, 0.9, 0.5] as RHit] : [])],
  push: (_b, last) => [[0, 1.4, 0.8], [1.5, 0.4, 0.55], [2.5, last ? 0.6 : 1.4, 0.8], ...(last ? [[3.25, 0.6, 0.65] as RHit] : [])],
  pulse: (_b, last) => [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5].filter((b) => !(last && b === 3.5)).map((b): RHit => [b, 0.4, b % 1 === 0 ? 0.8 : 0.55]),
  stab: (_b, last) => [[0, 0.2, 0.95], [0.75, 0.2, 0.65], [2.5, 0.2, 0.85], ...(last ? [[3.5, 0.2, 0.7] as RHit] : [])],
  gate: (_b, last) => [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5].map((b): RHit => [b, last && b >= 3 ? 0.12 : 0.22, b % 1 === 0 ? 0.85 : 0.6]),
  clav: (_b, last) => [[0, 0.15, 0.9], [0.75, 0.15, 0.55], [1.5, 0.15, 0.8], [2.25, 0.15, 0.55], [2.5, 0.15, 0.85], [3.25, 0.15, 0.55], ...(last ? [[3.75, 0.15, 0.7] as RHit] : [])],
  swell: () => [[0, 7.8, 0.55], [4, 3.8, 0.4]],
};

function chordLoop(id: string, name: string, style: LoopStyle, tone: string, feel: GrooveFeel, roots: number[], rhythm: string, opts: { seventh?: boolean; ninth?: boolean; start?: number[]; every?: number; voicings?: number[][] } = {}): LibMelodic {
  const voiced = opts.voicings ?? voiceLead(roots.map((r) => tonesOf(r, !!opts.seventh, !!opts.ninth)), opts.start ?? (opts.seventh ? [4, 6, 7, 9] : [4, 7, 9]));
  const every = opts.every ?? 4;
  const hits: Hit[] = voiced.flatMap((v, i) => RHYTHM[rhythm](i, i === voiced.length - 1).map(([b, dur, vel]): Hit => [i * every + b, dur, v, vel]));
  return written(id, name, 'chords', style, tone, feel, roots.length * every, hits);
}

const CHORDS: LibMelodic[] = [
  chordLoop('cur-chords-hilltop-skank', 'Hilltop Skank', 'dub', 'keys.funk-clav', FEELS.dub, [0, 0, 3, 3], 'skank'),
  chordLoop('cur-chords-organ-bubble', 'Organ Bubble', 'dub', 'keys.stab', FEELS.dub, [0, 6, 0, 6], 'bubble'),
  chordLoop('cur-chords-tin-roof', 'Tin Roof Skank', 'reggae', 'keys.funk-clav', FEELS.dub, [0, 5, 3, 4], 'skank', { voicings: [[2, 4, 7], [2, 5, 7], [5, 7, 10], [6, 8, 11]] }),
  chordLoop('cur-chords-smoke-room', 'Smoke Room Stabs', 'house', 'keys.stab', FEELS.house, [0, 5, 3, 4], 'house', { seventh: true }),
  chordLoop('cur-chords-deep-nine', 'Deep Nine', 'house', 'keys.tine', FEELS.house, [1, 4, 0, 0], 'broken', { seventh: true, start: [3, 5, 7, 8] }),
  chordLoop('cur-chords-dorian-glide', 'Dorian Glide', 'house', 'pad.pwm-strings', FEELS.house, [0, 1, 0, 1], 'push', { seventh: true }),
  chordLoop('cur-chords-golden-pads', 'Golden Pads', 'pop', 'pad.lush-80s', FEELS.float, [0, 4, 5, 3], 'pad', { seventh: true, voicings: [[2, 4, 6, 7], [3, 4, 6, 8], [4, 5, 7, 9], [3, 5, 7, 9]] }),
  chordLoop('cur-chords-heartbreak', 'Heartbreak Keys', 'pop', 'keys.tine', FEELS.straight, [5, 3, 0, 4], 'pulse'),
  chordLoop('cur-chords-canyon', 'Canyon Chords', 'livetronica', 'pad.brass', FEELS.straight, [0, 6, 5, 6], 'push'),
  chordLoop('cur-chords-steel-sky', 'Steel Sky Stab', 'techno', 'keys.stab', FEELS.techno, [0, 0, 0, 5], 'stab', { seventh: true }),
  chordLoop('cur-chords-trance-gate', 'Trance Gate', 'trance', 'pad.supersaw', FEELS.techno, [0, 5, 3, 4], 'gate', { voicings: [[4, 7, 9], [5, 7, 9], [5, 7, 10], [6, 8, 11]] }),
  chordLoop('cur-chords-back-alley', 'Back Alley Clav', 'funk', 'keys.funk-clav', FEELS.funk, [0, 3, 0, 4], 'clav', { seventh: true }),
  chordLoop('cur-chords-fog-choir', 'Fog Choir', 'ambient', 'pad.aah', FEELS.float, [0, 5, 3, 0], 'swell', { every: 8 }),
];

// ── Textures ────────────────────────────────────────────────────────────

const TEXTURES: LibMelodic[] = [
  written('cur-tex-harbour-fog', 'Harbour Fog', 'texture', 'ambient', 'pad.dark-drone', FEELS.float, 16, [[0, 7.8, [0, 4, 9], 0.6], [8, 7.8, [-2, 2, 7], 0.55]]),
  written('cur-tex-halo', 'Halo', 'texture', 'ambient', 'pad.shimmer', FEELS.float, 8, [[0, 7.8, [7, 11, 14], 0.5], [4, 3.8, 16, 0.35]]),
  written('cur-tex-cave-drips', 'Cave Drips', 'texture', 'dub', 'pad.glass', FEELS.dub, 8, [[0.5, 0.4, 9, 0.85], [2.75, 0.4, 11, 0.65], [4.25, 0.4, 7, 0.8], [6.5, 0.4, 12, 0.62], [7.25, 0.4, 11, 0.5]]),
  written('cur-tex-slow-swell', 'Slow Swell', 'texture', 'ambient', 'pad.sweep', FEELS.float, 16, [[0, 15.8, [0, 2, 4, 6], 0.55], [8, 7.8, 9, 0.35]]),
  written('cur-tex-bronze-rain', 'Bronze Rain', 'texture', 'livetronica', 'pad.glass', FEELS.straight, 8, [0, 0.75, 1.5, 2.5, 3.25, 4, 5.5, 6.75].map((b, i): Hit => [b, 0.5, [7, 9, 11, 12][i % 4], i % 3 === 0 ? 0.85 : 0.62])),
  written('cur-tex-rooftop-wind', 'Rooftop Wind', 'texture', 'dub', 'pad.air', FEELS.float, 16, [[0, 3.8, [0, 7], 0.45], [6, 3.8, [3, 10], 0.38], [12, 3.8, [-1, 6], 0.42]]),
];

/** Every written loop the library replaced, by the one now nearest it. */
export const LIBRARY_ALIASES: Record<string, string> = {
  'bass-rolling': 'cur-bass-night-engine', 'bass-offbeat': 'cur-bass-warehouse', 'bass-dub-root': 'cur-bass-basement',
  'bass-steppers': 'cur-bass-steppers', 'bass-acid': 'cur-bass-acid-slide', 'bass-sub': 'cur-bass-sub-ocean',
  'bass-walking': 'cur-bass-festival-walk', 'bass-reese': 'cur-bass-two-step',
  'chords-epic': 'cur-chords-golden-pads', 'chords-stab': 'cur-chords-steel-sky', 'chords-skank': 'cur-chords-hilltop-skank',
  'chords-float': 'cur-chords-fog-choir', 'chords-detroit': 'cur-chords-smoke-room',
  'tex-swell': 'cur-tex-slow-swell', 'tex-drops': 'cur-tex-cave-drips', 'tex-ritual': 'cur-tex-harbour-fog', 'tex-pulse': 'cur-tex-bronze-rain',
  'tex-cloud': 'cur-tex-halo', 'tex-ticks': 'cur-tex-bronze-rain', 'tex-rise': 'cur-tex-slow-swell', 'tex-rain': 'cur-tex-cave-drips',
};

/** A loop id the library no longer has, to the loop now nearest it, by its kind and style. */
export function libraryAlias(id: string): string | null {
  if (LIBRARY_ALIASES[id]) return LIBRARY_ALIASES[id];
  const byStyle: Record<string, string> = {
    onedrop: 'cur-bass-missing-one', 'heavy-one': 'cur-bass-basement', steppers: 'cur-bass-steppers', rockers: 'cur-bass-rockers',
    halfstep: 'cur-bass-sub-ocean', rolling: 'cur-bass-night-engine', offbeat: 'cur-bass-warehouse', gallop: 'cur-bass-tunnel',
    'acid-a': 'cur-bass-acid-slide', 'acid-b': 'cur-bass-rubber-hose', 'house-octave': 'cur-bass-disco-lung', 'funk-slap': 'cur-bass-grease',
    'live-arp': 'cur-bass-festival-walk', twostep: 'cur-bass-two-step', 'sub-swell': 'cur-bass-sub-ocean',
  };
  const bass = /^lib-bass-(.+)-(one|i-iv|i-vii|i-vi-vii|i-v)$/.exec(id);
  if (bass && byStyle[bass[1]]) return byStyle[bass[1]];
  if (id.startsWith('lib-bass-')) return 'cur-bass-basement';
  if (/^lib-chords-.*-(skank|double)$/.test(id)) return 'cur-chords-hilltop-skank';
  if (/^lib-chords-.*-bubble$/.test(id)) return 'cur-chords-organ-bubble';
  if (/^lib-chords-.*-house$/.test(id)) return 'cur-chords-smoke-room';
  if (/^lib-chords-.*-arp$/.test(id)) return 'cur-chords-trance-gate';
  if (/^lib-chords-.*-stab$/.test(id)) return 'cur-chords-steel-sky';
  if (id.startsWith('lib-chords-')) return 'cur-chords-golden-pads';
  if (id.startsWith('lib-tex-')) return 'cur-tex-harbour-fog';
  return null;
}

// ── Drum grooves ────────────────────────────────────────────────────────

function groove(id: string, name: string, style: LoopStyle, swing: number, rows: Partial<Record<DrumVoice, string>>, steps: 16 | 32 = 16): LibBeat {
  return { id, name, style, bpm: STYLE_BPM[style], steps, swing, rows };
}

export const LIBRARY_BEATS: LibBeat[] = [
  groove('lib-beat-onedrop-deep', 'Deep One Drop', 'dub', 0.08, { kick: '........x.......', snare: '........x.......', rim: '..o.......o.....', hatClosed: 'x.o.x.o.x.o.x.o.' }),
  groove('lib-beat-onedrop-rim', 'Rim Drop', 'dub', 0.1, { kick: '........x.......', rim: '....x.......x...', hatClosed: '..x...x...x...x.', hatOpen: '..............o.' }),
  groove('lib-beat-steppers-heavy', 'Heavy Steppers', 'dub', 0.04, { kick: 'x...x...x...x...', snare: '........x.......', hatClosed: 'o.x.o.x.o.x.o.x.', crash: 'x...............' }),
  groove('lib-beat-rockers', 'Rockers Groove', 'reggae', 0.06, { kick: 'x.....x.x.......', snare: '....x.......x...', hatClosed: 'x.xxx.xxx.xxx.xx', rim: '......o.......o.' }),
  groove('lib-beat-rockers-flying', 'Flying Cymbal', 'reggae', 0.05, { kick: 'x.......x.......', snare: '....x.......x...', hatOpen: '..x...x...x...x.', hatClosed: 'x...x...x...x...' }),
  groove('lib-beat-four-deep', 'Deep Four', 'house', 0.1, { kick: 'x...x...x...x...', clap: '....x.......x...', hatClosed: '..x...x...x...x.', hatOpen: '..o.......o.....' }),
  groove('lib-beat-four-shuffle', 'Shuffle House', 'house', 0.18, { kick: 'x...x...x...x...', clap: '....x.......x...', hatClosed: 'x.xxx.xxx.xxx.xx', rim: '...o.....o......' }),
  groove('lib-beat-techno-drive', 'Motor Drive', 'techno', 0.02, { kick: 'x...x...x...x...', hatClosed: 'xxxxxxxxxxxxxxxx', hatOpen: '..x...x...x...x.', clap: '....x.......x...' }),
  groove('lib-beat-techno-hollow', 'Hollow Room', 'techno', 0.05, { kick: 'x...x...x...x...', rim: '...x..x....x..x.', hatOpen: '..o...o...o...o.', tom: '.......o.......o' }),
  groove('lib-beat-techno-roll', 'Rolling Toms', 'techno', 0.03, { kick: 'x...x...x...x...', tom: '..o..o..o..o.o.o', hatClosed: '..x...x...x...x.', clap: '............x...' }),
  groove('lib-beat-acid', 'Acid Floor', 'acid', 0.06, { kick: 'x...x...x...x...', clap: '....x.......x...', hatClosed: 'o.x.o.x.o.x.o.x.', hatOpen: '......x.......x.' }),
  groove('lib-beat-broken', 'Broken Beat', 'breaks', 0.14, { kick: 'x......x..x.....', snare: '....x.......x..o', hatClosed: 'x.x.xx.xx.x.xx.x', rim: '.o.....o........' }),
  groove('lib-beat-breaks-amen', 'Chopped Break', 'breaks', 0.08, { kick: 'x.x.......xx....', snare: '....x..x.x..x..x', hatClosed: 'x.x.x.x.x.x.x.x.' }),
  groove('lib-beat-breaks-slow', 'Slow Funk Break', 'funk', 0.16, { kick: 'x......xx.......', snare: '....x.......x...', hatClosed: 'xxxxxxxxxxxxxxxx', hatOpen: '.......o........' }),
  groove('lib-beat-funk-ghost', 'Ghost Notes', 'funk', 0.12, { kick: 'x..x..x...x.....', snare: '....x.o.o..ox.o.', hatClosed: 'x.x.x.x.x.x.x.x.' }),
  groove('lib-beat-garage', 'Two Step', 'garage', 0.22, { kick: 'x.....x...x.....', snare: '....x.......x...', hatClosed: '..x.x.x...x.x.x.', rim: '.......o.......o' }),
  groove('lib-beat-livetronica', 'Festival Groove', 'livetronica', 0.07, { kick: 'x...x...x..xx...', snare: '....x.......x...', hatClosed: 'x.xxx.xxx.xxx.xx', hatOpen: '......o.......o.', crash: 'x...............' }),
  groove('lib-beat-halftime', 'Halftime Weight', 'dub', 0.06, { kick: 'x.........x.....', snare: '........x.......', hatClosed: 'x.x.x.x.x.x.x.x.', rim: '...o.......o....' }),
  groove('lib-beat-trap', 'Trap Rattle', 'breaks', 0, { kick: 'x......x..x.....', snare: '........x.......', hatClosed: 'x.x.x.xxx.x.xxxx', clap: '........x.......' }),
  groove('lib-beat-ambient', 'Pulse Only', 'ambient', 0, { kick: 'x.......x.......', hatClosed: '....o.......o...', rim: '..........o.....' }),
];

export const LIBRARY_MELODIC: LibMelodic[] = [...BASS, ...CHORDS, ...TEXTURES];

/** The library's style for a loop id, if it is one of its loops. */
const STYLE_BY_ID = new Map<string, LoopStyle>([...LIBRARY_MELODIC, ...LIBRARY_BEATS, ...LEADS].map((l) => [l.id, l.style]));
export function loopStyle(id: string): LoopStyle | undefined {
  return STYLE_BY_ID.get(id);
}
