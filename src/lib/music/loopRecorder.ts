/**
 * Loops made from what is played.
 *
 * Two ways in, both on the launch clock's bars:
 *  - Record: arm it, and the next bars of playing become a loop.
 *  - Capture: just play, then keep the last phrase (everything since the
 *    last long pause, rounded out to whole bars) without having pressed
 *    record first.
 * Melodic notes become recorded loops, kept with the project, one per
 * instrument played; each repeats straight away in the slot for its part.
 * Drum hits are written into the beat grid instead, so touch drumming builds
 * the pattern the sequencer plays.
 *
 * Everything here is pure; the runtime feeds it beats.
 */

import { INSTRUMENTS, clampNote, clampVelocity, type DrumVoice, type InstrumentId } from './noteEvents';
import { DRUM_VOICES } from './noteEvents';
import { PATTERN_LENGTHS, STEPS_PER_BEAT, normalizePattern, resizePattern, type DrumPattern, type PatternLength } from './drumPattern';
import { INSTRUMENT_LABELS } from './instruments';
import type { LoopRole, ScheduledLoopNote } from './loops';

export const BEATS_PER_BAR = 4;

/** A note of a recorded loop: beats from the loop start, and a MIDI note. */
export interface RecordedNote {
  beat: number;
  dur: number;
  note: number;
  velocity: number;
}

export interface RecordedLoop {
  kind: 'recorded';
  id: string;
  name: string;
  role: LoopRole;
  instrument: InstrumentId;
  /** Length in beats, whole bars. */
  beats: number;
  notes: RecordedNote[];
  /** ms since epoch. */
  createdAt: number;
}

/** A beat kept from the grid, with every step's velocity. */
export interface RecordedBeat {
  kind: 'beat';
  id: string;
  name: string;
  pattern: DrumPattern;
  createdAt: number;
}

/** Lengths offered for recording, in bars; 0 keeps going until stopped. */
export const RECORD_LENGTHS = [0, 1, 2, 4, 8] as const;
export type RecordLength = (typeof RECORD_LENGTHS)[number];

/** Longest loop kept, in bars. */
export const MAX_LOOP_BARS = 16;

export const QUANTIZE_GRIDS = [
  { id: 'off', label: 'Off', beats: 0 },
  { id: '1/16', label: '1/16', beats: 1 / 4 },
  { id: '1/8', label: '1/8', beats: 1 / 2 },
  { id: '1/8T', label: '1/8T', beats: 1 / 3 },
  { id: '1/4', label: '1/4', beats: 1 },
] as const;
export type QuantizeId = (typeof QUANTIZE_GRIDS)[number]['id'];

export function quantizeBeats(id: QuantizeId): number {
  return QUANTIZE_GRIDS.find((g) => g.id === id)?.beats ?? 0;
}

/** Notes played this much before the first bar line still count as on it. */
export const EARLY_GRACE_BEATS = 0.125;
/** A pause this long ends a phrase, for capture. */
export const PHRASE_GAP_BEATS = 4;
/** How far back capture reaches. */
export const CAPTURE_WINDOW_BEATS = MAX_LOOP_BARS * BEATS_PER_BAR * 2;

/** Shortest note kept, in beats. */
const MIN_NOTE_BEATS = 1 / 64;

/** One live note or drum hit, in launch-clock beats. `end` is null while held. */
export interface PlayedNote {
  instrument: InstrumentId;
  note: number;
  velocity: number;
  beat: number;
  end: number | null;
  drum?: DrumVoice;
}

/**
 * What was played, as notes with start and end beats. The runtime keeps one
 * of these running all the time (capture reads its recent past) and reads a
 * window of it when a recording ends.
 */
export class PlayedNotes {
  private notes: PlayedNote[] = [];
  private open = new Map<string, PlayedNote>();

  noteOn(instrument: InstrumentId, note: number, velocity: number, beat: number): void {
    // A second on for a held pitch closes the first.
    this.noteOff(instrument, note, beat);
    const played: PlayedNote = { instrument, note, velocity, beat, end: null };
    this.open.set(`${instrument}:${note}`, played);
    this.notes.push(played);
  }

  noteOff(instrument: InstrumentId, note: number, beat: number): void {
    const key = `${instrument}:${note}`;
    const played = this.open.get(key);
    if (!played) return;
    played.end = Math.max(played.beat + MIN_NOTE_BEATS, beat);
    this.open.delete(key);
  }

  hit(voice: DrumVoice, note: number, velocity: number, beat: number): void {
    this.notes.push({ instrument: 'drums', note, velocity, beat, end: beat + 1 / STEPS_PER_BEAT, drum: voice });
  }

  /** Forget notes that started before `beat` and have ended. */
  forgetBefore(beat: number): void {
    if (!this.notes.length || this.notes[0].beat >= beat) return;
    this.notes = this.notes.filter((n) => n.beat >= beat || n.end === null);
  }

  /** Notes starting in [from - grace, to), oldest first. */
  between(from: number, to: number): PlayedNote[] {
    return this.notes.filter((n) => n.beat >= from - EARLY_GRACE_BEATS && n.beat < to);
  }

  all(): readonly PlayedNote[] {
    return this.notes;
  }

  clear(): void {
    this.notes = [];
    this.open.clear();
  }
}

/** A recording cut to its bars: melodic notes per instrument, and drum hits. */
export interface LoopTake {
  startBeat: number;
  beats: number;
  melodic: Map<InstrumentId, RecordedNote[]>;
  /** Drum hits, in launch-clock beats. */
  hits: Array<{ beat: number; voice: DrumVoice; velocity: number }>;
}

/** `beat` on a grid of `grid` beats (0 leaves it), wrapped into [0, length). */
export function quantizeBeat(beat: number, grid: number, length: number): number {
  const q = grid > 0 ? Math.round(beat / grid) * grid : beat;
  const wrapped = ((q % length) + length) % length;
  // A note snapped onto the end of the loop belongs on its first beat.
  return Math.abs(wrapped - length) < 1e-6 ? 0 : wrapped + 0;
}

/**
 * Cut what was played in [startBeat, startBeat + beats) into a loop's worth.
 * Times become beats from the loop start, snapped to `grid`; notes still
 * held, or held past the end, stop at the end.
 */
export function takeLoop(played: readonly PlayedNote[], startBeat: number, beats: number, grid: number): LoopTake {
  const end = startBeat + beats;
  const melodic = new Map<InstrumentId, RecordedNote[]>();
  const hits: LoopTake['hits'] = [];
  for (const n of played) {
    if (n.beat < startBeat - EARLY_GRACE_BEATS || n.beat >= end) continue;
    const offset = Math.max(0, n.beat - startBeat);
    if (n.drum) {
      hits.push({ beat: startBeat + quantizeBeat(offset, grid || 1 / STEPS_PER_BEAT, beats), voice: n.drum, velocity: n.velocity });
      continue;
    }
    const beat = quantizeBeat(offset, grid, beats);
    const heldTo = Math.min(n.end ?? end, end);
    const dur = Math.max(MIN_NOTE_BEATS, Math.min(heldTo - Math.max(n.beat, startBeat), beats - beat));
    const list = melodic.get(n.instrument) ?? [];
    list.push({ beat, dur, note: clampNote(n.note), velocity: clampVelocity(n.velocity) });
    melodic.set(n.instrument, list);
  }
  for (const list of melodic.values()) list.sort((a, b) => a.beat - b.beat || a.note - b.note);
  return { startBeat, beats, melodic, hits };
}

/** The power-of-two bar count that holds `bars`, up to the longest loop. */
export function loopBars(bars: number): number {
  let n = 1;
  while (n < bars && n < MAX_LOOP_BARS) n *= 2;
  return n;
}

/**
 * The phrase capture keeps: from the bar where the latest phrase started
 * (after a pause of at least PHRASE_GAP_BEATS) to the end of the bar its last
 * note started in, stretched to 1, 2, 4, 8 or 16 bars. Null when nothing was
 * played recently.
 */
export function capturePhrase(played: readonly PlayedNote[], nowBeat: number): { startBeat: number; beats: number } | null {
  const recent = played.filter((n) => n.beat > nowBeat - CAPTURE_WINDOW_BEATS && n.beat <= nowBeat + EARLY_GRACE_BEATS);
  if (!recent.length) return null;
  const byStart = [...recent].sort((a, b) => a.beat - b.beat);
  const last = byStart[byStart.length - 1];
  let phraseStart = last.beat;
  // Walk back while each earlier note reaches to within a pause of the phrase.
  let reach = last.beat;
  for (let i = byStart.length - 2; i >= 0; i--) {
    const n = byStart[i];
    const ends = n.end ?? nowBeat;
    if (reach - ends > PHRASE_GAP_BEATS) break;
    phraseStart = n.beat;
    reach = Math.min(reach, n.beat);
  }
  const startBar = Math.floor((phraseStart + EARLY_GRACE_BEATS) / BEATS_PER_BAR) * BEATS_PER_BAR;
  const endBar = Math.floor(last.beat / BEATS_PER_BAR + 1) * BEATS_PER_BAR;
  const bars = loopBars(Math.max(1, (endBar - startBar) / BEATS_PER_BAR));
  // A phrase longer than the longest loop keeps its last bars.
  const beats = bars * BEATS_PER_BAR;
  const start = endBar - startBar > beats ? endBar - beats : startBar;
  return { startBeat: start, beats };
}

/** Which slot a recorded part plays in. */
export function roleForRecording(instrument: InstrumentId, notes: readonly RecordedNote[]): LoopRole {
  switch (instrument) {
    case 'dubbass':
    case 'acid':
      return 'bass';
    case 'drone':
      return 'chords';
    case 'bowls':
    case 'siren':
    case 'shots':
    case 'scan':
      return 'texture';
    case 'xy':
      return 'lead';
    default:
      break;
  }
  if (!notes.length) return 'lead';
  const together = notes.filter((n, i) => notes.some((m, j) => j !== i && Math.abs(m.beat - n.beat) < 0.06)).length;
  if (together / notes.length >= 0.4) return 'chords';
  const pitches = notes.map((n) => n.note).sort((a, b) => a - b);
  return pitches[Math.floor(pitches.length / 2)] < 48 ? 'bass' : 'lead';
}

/**
 * Notes of a recorded loop starting in [fromBeat, toBeat), with the loop
 * started on `startBeat` and repeating every `loop.beats`.
 */
export function recordedNotesBetween(loop: RecordedLoop, startBeat: number, fromBeat: number, toBeat: number): ScheduledLoopNote[] {
  if (!(toBeat > fromBeat) || loop.beats <= 0) return [];
  const out: ScheduledLoopNote[] = [];
  const firstPass = Math.max(0, Math.floor((fromBeat - startBeat) / loop.beats));
  const lastPass = Math.floor((toBeat - startBeat) / loop.beats);
  for (let pass = firstPass; pass <= lastPass; pass++) {
    const passStart = startBeat + pass * loop.beats;
    for (const n of loop.notes) {
      const beat = passStart + n.beat;
      if (beat < fromBeat || beat >= toBeat || beat < startBeat) continue;
      out.push({ beat, dur: n.dur, note: n.note, velocity: n.velocity });
    }
  }
  return out.sort((a, b) => a.beat - b.beat);
}

/** The grid step a hit at `beat` lands on: the nearest one, as the pattern loops from beat 0. */
export function stepForBeat(pattern: DrumPattern, beat: number): number {
  const step = Math.round(beat * STEPS_PER_BEAT);
  return ((step % pattern.steps) + pattern.steps) % pattern.steps;
}

/** The pattern length that holds `beats`, up to the longest grid. */
export function patternLengthFor(beats: number): PatternLength {
  const steps = beats * STEPS_PER_BEAT;
  return PATTERN_LENGTHS.find((n) => n >= steps) ?? PATTERN_LENGTHS[PATTERN_LENGTHS.length - 1];
}

/**
 * Write hits into the grid, each on its nearest step; a step keeps the
 * louder of what it had and the hit. With `beats`, a shorter grid grows to
 * hold that many beats first (repeating what it had).
 */
export function writeHits(pattern: DrumPattern, hits: LoopTake['hits'], beats = 0): DrumPattern {
  let next = pattern;
  if (beats > 0) {
    const steps = patternLengthFor(beats);
    if (steps > next.steps) next = resizePattern(next, steps);
  }
  if (!hits.length) return next;
  const tracks = Object.fromEntries(DRUM_VOICES.map((v) => [v, [...next.tracks[v]]])) as DrumPattern['tracks'];
  for (const hit of hits) {
    const step = stepForBeat(next, hit.beat);
    tracks[hit.voice][step] = Math.max(tracks[hit.voice][step], Math.max(0.05, clampVelocity(hit.velocity)));
  }
  return { ...next, tracks };
}

/** "Dub bass 3" after "Dub bass 1" and "Dub bass 2". */
export function nextRecordedName(existing: ReadonlyArray<{ name: string }>, label: string): string {
  let highest = 0;
  const pattern = new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} (\\d+)$`);
  for (const item of existing) {
    const m = pattern.exec(item.name);
    if (m) highest = Math.max(highest, Number(m[1]));
  }
  return `${label} ${highest + 1}`;
}

export function recordedLoopLabel(instrument: InstrumentId): string {
  return INSTRUMENT_LABELS[instrument];
}

const LOOP_ROLES: readonly LoopRole[] = ['bass', 'lead', 'chords', 'texture'];

function finite(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** A recorded loop from a project file, or null when it can't be one. */
export function normalizeRecordedLoop(raw: unknown): RecordedLoop | null {
  if (!raw || typeof raw !== 'object') return null;
  const input = raw as Partial<RecordedLoop>;
  if (typeof input.id !== 'string' || !input.id) return null;
  const instrument = INSTRUMENTS.includes(input.instrument as InstrumentId) ? (input.instrument as InstrumentId) : null;
  if (!instrument) return null;
  const bars = Math.round(finite(input.beats, BEATS_PER_BAR) / BEATS_PER_BAR);
  const beats = Math.max(1, Math.min(MAX_LOOP_BARS, bars)) * BEATS_PER_BAR;
  const notes: RecordedNote[] = [];
  for (const n of Array.isArray(input.notes) ? input.notes : []) {
    if (!n || typeof n !== 'object') continue;
    const beat = finite(n.beat, -1);
    if (beat < 0 || beat >= beats) continue;
    notes.push({
      beat,
      dur: Math.max(MIN_NOTE_BEATS, Math.min(beats, finite(n.dur, 0.25))),
      note: clampNote(finite(n.note, 60)),
      velocity: clampVelocity(finite(n.velocity, 0.8)),
    });
  }
  notes.sort((a, b) => a.beat - b.beat || a.note - b.note);
  return {
    kind: 'recorded',
    id: input.id,
    name: typeof input.name === 'string' && input.name.trim() ? input.name.trim() : recordedLoopLabel(instrument),
    role: LOOP_ROLES.includes(input.role as LoopRole) ? (input.role as LoopRole) : roleForRecording(instrument, notes),
    instrument,
    beats,
    notes,
    createdAt: finite(input.createdAt, 0),
  };
}

/** A kept beat from a project file, or null. */
export function normalizeRecordedBeat(raw: unknown): RecordedBeat | null {
  if (!raw || typeof raw !== 'object') return null;
  const input = raw as Partial<RecordedBeat>;
  if (typeof input.id !== 'string' || !input.id || !input.pattern) return null;
  return {
    kind: 'beat',
    id: input.id,
    name: typeof input.name === 'string' && input.name.trim() ? input.name.trim() : 'Beat',
    pattern: normalizePattern(input.pattern),
    createdAt: finite(input.createdAt, 0),
  };
}
