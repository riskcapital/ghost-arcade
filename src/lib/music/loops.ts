/**
 * The loop library: premade beats, basslines, leads, chord progressions and
 * textures to launch while playing.
 *
 * Melodic loops are written in scale degrees, so they play in whatever key
 * the studio is set to, and each set plays them on its own instruments (a
 * bassline is the acid line in Berlin, the dub bass in the dub set). Beats
 * are step patterns that load into the beat grid, ready to edit. Times are in
 * beats, so loops follow the tempo.
 */

import { DRUM_VOICES, type DrumVoice, type InstrumentId } from './noteEvents';
import { createPattern, type DrumPattern } from './drumPattern';
import { scaleNote, type MusicKey, type StudioSet } from './studioSets';
import { LIBRARY_BEATS, LIBRARY_MELODIC, libraryAlias } from './loopLibrary';
import { LEADS, leadAlias } from './leadLibrary';

export type LoopRole = 'bass' | 'lead' | 'chords' | 'texture';
export type LoopCategory = 'beats' | LoopRole;

export const LOOP_ROLES: LoopRole[] = ['bass', 'lead', 'chords', 'texture'];

export const LOOP_CATEGORIES: { id: LoopCategory; label: string }[] = [
  { id: 'beats', label: 'Beats' },
  { id: 'bass', label: 'Bass' },
  { id: 'lead', label: 'Leads' },
  { id: 'chords', label: 'Chords' },
  { id: 'texture', label: 'Textures' },
];

/** One note: when (beats from the loop start), how long, which scale degree(s), how hard. */
export interface LoopNote {
  beat: number;
  dur: number;
  degrees: number[];
  velocity: number;
}

export interface MelodicLoop {
  id: string;
  name: string;
  role: LoopRole;
  /** Length in beats. */
  beats: number;
  notes: LoopNote[];
  /** The tone-library tone it was written for, if any; a clip made from it starts on that tone. */
  tone?: string;
}

export interface BeatLoop {
  id: string;
  name: string;
  steps: 16 | 32;
  swing: number;
  /** Per kit voice, a 16 or 32 character row: x = hit, o = soft hit, . = rest. */
  rows: Partial<Record<DrumVoice, string>>;
}

// Shorthand: [beat, duration, degree or degrees, velocity].
type N = [number, number, number | number[], number?];
const notes = (list: N[]): LoopNote[] =>
  list.map(([beat, dur, d, v]) => ({ beat, dur, degrees: Array.isArray(d) ? d : [d], velocity: v ?? 0.8 }));

/** Sixteenth-note rows: a degree per step, null for a rest. */
const sixteenths = (row: Array<number | null>, dur = 0.22, accents: number[] = []): LoopNote[] =>
  row.flatMap((d, i) => (d === null ? [] : [{ beat: i / 4, dur, degrees: [d], velocity: accents.includes(i) ? 1 : 0.75 }]));

export const MELODIC_LOOPS: MelodicLoop[] = [
  // Leads (leadLibrary.ts), then the written basslines, chords and textures (loopLibrary.ts).
  ...LEADS,
  ...LIBRARY_MELODIC,
];

export const BEAT_LOOPS: BeatLoop[] = [
  { id: 'beat-four', name: 'Four on the floor', steps: 16, swing: 0, rows: {
    kick: 'x...x...x...x...', clap: '....x.......x...', hatClosed: '..x...x...x...x.', hatOpen: '......o.......o.' } },
  { id: 'beat-techno', name: 'Driving techno', steps: 16, swing: 0.08, rows: {
    kick: 'x...x...x...x...', clap: '....x.......x...', hatClosed: 'o.x.o.x.o.x.o.x.', rim: '...o.......o....', tom: '...............o' } },
  { id: 'beat-minimal', name: 'Minimal', steps: 16, swing: 0.12, rows: {
    kick: 'x...x...x...x...', rim: '..o..o....o..o..', hatClosed: '..x...x...x...x.' } },
  { id: 'beat-break', name: 'Breakbeat', steps: 16, swing: 0.1, rows: {
    kick: 'x.........x.....', snare: '....x..o....x...', hatClosed: 'x.x.x.x.x.x.x.x.', hatOpen: '.......o.......o' } },
  { id: 'beat-onedrop', name: 'Dub one drop', steps: 16, swing: 0.06, rows: {
    kick: '........x.......', snare: '........x.......', rim: '....o.......o...', hatClosed: 'o.x.o.x.o.x.o.x.' } },
  { id: 'beat-steppers', name: 'Dub steppers', steps: 16, swing: 0.04, rows: {
    kick: 'x...x...x...x...', snare: '........x.......', hatClosed: '..x...x...x...x.', rim: '....o.......o...' } },
  { id: 'beat-half', name: 'Half time', steps: 16, swing: 0, rows: {
    kick: 'x.....x.........', snare: '........x.......', hatClosed: 'x...x...x...x...', crash: 'o...............' } },
  { id: 'beat-electro', name: 'Electro', steps: 16, swing: 0, rows: {
    kick: 'x......x..x.....', clap: '....x.......x...', hatClosed: 'xxxxxxxxxxxxxxxx', tom: '.............o.o' } },
  { id: 'beat-pulse', name: 'Ambient pulse', steps: 16, swing: 0, rows: {
    kick: 'o.......o.......', rim: '......o.......o.', hatClosed: '..o.......o.....' } },
  { id: 'beat-rockers', name: 'Dub rockers', steps: 16, swing: 0.05, rows: {
    kick: 'x.......x.......', snare: '........x.......', hatClosed: 'x.x.x.x.x.x.x.x.', rim: '....o.......o...' } },
  { id: 'beat-garage', name: '2-step garage', steps: 16, swing: 0.18, rows: {
    kick: 'x.........x.....', snare: '....x.......x...', hatClosed: '..x...x...x.x.x.', rim: '.......o......o.' } },
  { id: 'beat-house', name: 'Deep house', steps: 16, swing: 0.1, rows: {
    kick: 'x...x...x...x...', clap: '....x.......x...', hatOpen: '..o...o...o...o.', hatClosed: 'o.....o.....o...' } },
  { id: 'beat-industrial', name: 'Industrial', steps: 16, swing: 0, rows: {
    kick: 'x..x..x...x..x..', snare: '....x.......x...', tom: 'o.....o.....o...', crash: 'x...............' } },
  { id: 'beat-trap', name: 'Half-time rolls', steps: 16, swing: 0, rows: {
    kick: 'x......x..x.....', snare: '........x.......', hatClosed: 'x.x.xxx.x.x.xxxx' } },
  { id: 'beat-brushed', name: 'Brushed', steps: 16, swing: 0.2, rows: {
    kick: 'o...........o...', rim: '..o.....o.o.....', hatClosed: 'o..o..o..o..o...' } },
  ...LIBRARY_BEATS,
];

export function loopById(id: string): MelodicLoop | BeatLoop | null {
  // A loop the library no longer has plays as the one now nearest it.
  const lead = leadAlias(id);
  const real = lead !== id ? lead : (libraryAlias(id) ?? id);
  return MELODIC_LOOPS.find((l) => l.id === real) ?? BEAT_LOOPS.find((l) => l.id === real) ?? null;
}

export function isBeatLoop(loop: MelodicLoop | BeatLoop): loop is BeatLoop {
  return 'rows' in loop;
}

/** The step pattern of a beat loop. */
export function beatPattern(loop: BeatLoop): DrumPattern {
  const p = createPattern(loop.steps);
  p.swing = loop.swing;
  for (const voice of DRUM_VOICES) {
    const row = loop.rows[voice] ?? '';
    for (let i = 0; i < loop.steps; i++) {
      const ch = row[i % Math.max(1, row.length)];
      p.tracks[voice][i] = ch === 'x' ? 0.9 : ch === 'o' ? 0.5 : 0;
    }
  }
  return p;
}

/** Which instrument plays each kind of loop in each set. */
export const ROLE_INSTRUMENTS: Record<StudioSet, Record<LoopRole, InstrumentId>> = {
  bath: { bass: 'synth', lead: 'xy', chords: 'drone', texture: 'bowls' },
  berlin: { bass: 'acid', lead: 'synth', chords: 'keys', texture: 'synth' },
  dub: { bass: 'dubbass', lead: 'keys', chords: 'keys', texture: 'siren' },
  analog: { bass: 'analog', lead: 'synth', chords: 'keys', texture: 'synth' },
};

/** Where each kind of loop sits on the keyboard. */
const ROLE_BASE: Record<LoopRole, number> = { bass: 24, lead: 60, chords: 48, texture: 48 };

export interface ScheduledLoopNote {
  /** Beat the note starts on, on the launch clock. */
  beat: number;
  dur: number;
  note: number;
  velocity: number;
}

/**
 * Notes of a melodic loop starting in [fromBeat, toBeat), with the loop
 * started on `startBeat` and repeating every `loop.beats`. Degrees become
 * MIDI notes in `key`.
 */
export function loopNotesBetween(loop: MelodicLoop, key: MusicKey, startBeat: number, fromBeat: number, toBeat: number): ScheduledLoopNote[] {
  if (!(toBeat > fromBeat) || loop.beats <= 0) return [];
  const out: ScheduledLoopNote[] = [];
  const firstPass = Math.max(0, Math.floor((fromBeat - startBeat) / loop.beats));
  const lastPass = Math.floor((toBeat - startBeat) / loop.beats);
  for (let pass = firstPass; pass <= lastPass; pass++) {
    const passStart = startBeat + pass * loop.beats;
    for (const n of loop.notes) {
      const beat = passStart + n.beat;
      if (beat < fromBeat || beat >= toBeat || beat < startBeat) continue;
      for (const degree of n.degrees) {
        out.push({ beat, dur: n.dur, note: scaleNote(key, degree, ROLE_BASE[loop.role]), velocity: n.velocity });
      }
    }
  }
  return out.sort((a, b) => a.beat - b.beat);
}

/** The first bar line at or after `beat` (a beat already on a bar line counts). */
export function nextBar(beat: number, beatsPerBar = 4): number {
  // Adding 0 turns the -0 of a bar at zero into 0.
  return Math.ceil(beat / beatsPerBar - 1e-6) * beatsPerBar + 0;
}
