/**
 * The session: a grid of clip slots, one track per part (beat, bass, lead,
 * chords, texture), as in a DAW's session view. Each slot holds a clip or
 * nothing. Launching a clip starts it on the next bar in its track, taking
 * over from the clip playing there; a row launches across every track.
 *
 * Clips are the session's own copies, so editing one never changes a preset.
 * A clip made from a preset remembers the key it was written in and follows
 * the studio's key by scale degree; a recorded or imported clip keeps its
 * exact pitches and the instrument it was played on.
 *
 * Pure: the store keeps the session, the runtime plays it.
 */

import { INSTRUMENTS, clampNote, clampVelocity, type InstrumentId } from './noteEvents';
import { normalizePattern, patternHasHits, type DrumPattern } from './drumPattern';
import { SCALES, scaleNote, type MusicKey, type ScaleId, type StudioSet } from './studioSets';
import { BEAT_LOOPS, LOOP_ROLES, MELODIC_LOOPS, ROLE_INSTRUMENTS, beatPattern, loopById, loopNotesBetween, type LoopRole } from './loops';
import { BEATS_PER_BAR, MAX_LOOP_BARS, type RecordedLoop, type RecordedNote } from './loopRecorder';

export type TrackId = 'beats' | LoopRole;

export const TRACKS: ReadonlyArray<{ id: TrackId; label: string }> = [
  { id: 'beats', label: 'Beat' },
  { id: 'bass', label: 'Bass' },
  { id: 'lead', label: 'Lead' },
  { id: 'chords', label: 'Chords' },
  { id: 'texture', label: 'Texture' },
];

export const TRACK_IDS: readonly TrackId[] = TRACKS.map((t) => t.id);

/** Rows a new session starts with. */
export const SESSION_ROWS = 8;
export const MAX_SESSION_ROWS = 32;

export interface NotesClip {
  kind: 'notes';
  id: string;
  name: string;
  /** Length in beats. */
  beats: number;
  notes: RecordedNote[];
  /** The key it was written in, when it follows the studio's key; null keeps its pitches. */
  key: MusicKey | null;
  /** What it was played on; null plays on the track's instrument for the set. */
  instrument: InstrumentId | null;
  /** The preset it was made from. */
  preset?: string;
}

export interface BeatClip {
  kind: 'beat';
  id: string;
  name: string;
  pattern: DrumPattern;
  preset?: string;
}

export type SessionClip = NotesClip | BeatClip;

export type Session = Record<TrackId, Array<SessionClip | null>>;

/** What a factory preset becomes in a slot. */
export function clipFromPreset(presetId: string, key: MusicKey, id: string): SessionClip | null {
  const loop = loopById(presetId);
  if (!loop) return null;
  if ('rows' in loop) return { kind: 'beat', id, name: loop.name, pattern: beatPattern(loop), preset: loop.id };
  const notes = loopNotesBetween(loop, key, 0, 0, loop.beats).map((n) => ({ beat: n.beat, dur: n.dur, note: n.note, velocity: n.velocity }));
  return { kind: 'notes', id, name: loop.name, beats: loop.beats, notes, key: { ...key }, instrument: null, preset: loop.id };
}

/** Which track a factory preset belongs to. */
export function presetTrack(presetId: string): TrackId | null {
  const loop = loopById(presetId);
  if (!loop) return null;
  return 'rows' in loop ? 'beats' : loop.role;
}

/** The factory presets for a track, in library order. */
export function presetsFor(track: TrackId): Array<{ id: string; name: string }> {
  if (track === 'beats') return BEAT_LOOPS.map((l) => ({ id: l.id, name: l.name }));
  return MELODIC_LOOPS.filter((l) => l.role === track).map((l) => ({ id: l.id, name: l.name }));
}

/**
 * A note's place in a key: its scale degree (0 = the root at MIDI octave 0)
 * and how many semitones it sits above that degree when it is not in the scale.
 */
export function degreeOf(note: number, key: MusicKey): { degree: number; offset: number } {
  const steps = SCALES[key.scale].steps;
  const rel = note - key.root;
  const octave = Math.floor(rel / 12);
  const pc = rel - octave * 12;
  let index = steps.length - 1;
  while (index > 0 && steps[index] > pc) index--;
  return { degree: octave * steps.length + index, offset: pc - steps[index] };
}

/** Move notes written in one key to another by scale degree, staying in the same register. */
export function transposeNotes(notes: readonly RecordedNote[], from: MusicKey, to: MusicKey): RecordedNote[] {
  if (from.root === to.root && from.scale === to.scale) return notes.map((n) => ({ ...n }));
  // Shift the root the short way round, so a key change never jumps an octave.
  const shift = ((((to.root - from.root) % 12) + 18) % 12) - 6;
  const adjust = shift - (to.root - from.root);
  return notes.map((n) => {
    const { degree, offset } = degreeOf(n.note, from);
    return { ...n, note: clampNote(scaleNote(to, degree, 0) + offset + adjust) };
  });
}

/** The notes a clip plays in `key`. */
export function playableNotes(clip: NotesClip, key: MusicKey): RecordedNote[] {
  return clip.key ? transposeNotes(clip.notes, clip.key, key) : clip.notes.map((n) => ({ ...n }));
}

/** A notes clip as the loop the runtime schedules, on the instrument for its track in `set`. */
export function clipLoop(clip: NotesClip, track: LoopRole, set: StudioSet, key: MusicKey): RecordedLoop {
  return {
    kind: 'recorded',
    id: clip.id,
    name: clip.name,
    role: track,
    instrument: clip.instrument ?? ROLE_INSTRUMENTS[set][track],
    beats: clip.beats,
    notes: playableNotes(clip, key),
    createdAt: 0,
  };
}

/** The rows a new session starts with: grooves that work together across a row. */
const STARTER_ROWS: Array<Partial<Record<TrackId, string>>> = [
  { beats: 'beat-four', bass: 'bass-rolling', lead: 'lead-arp', chords: 'chords-epic', texture: 'tex-swell' },
  { beats: 'beat-techno', bass: 'bass-offbeat', lead: 'lead-hypnotic', chords: 'chords-stab', texture: 'tex-pulse' },
  { beats: 'beat-onedrop', bass: 'bass-dub-root', lead: 'lead-melodica', chords: 'chords-skank', texture: 'tex-drops' },
  { beats: 'beat-pulse', bass: 'bass-sub', lead: 'lead-bells', chords: 'chords-float', texture: 'tex-ritual' },
];

export function emptySession(rows = SESSION_ROWS): Session {
  return Object.fromEntries(TRACK_IDS.map((t) => [t, Array.from({ length: rows }, () => null)])) as Session;
}

export function defaultSession(key: MusicKey, makeId: () => string): Session {
  const session = emptySession();
  STARTER_ROWS.forEach((row, r) => {
    for (const track of TRACK_IDS) {
      const id = row[track];
      if (id) session[track][r] = clipFromPreset(id, key, makeId());
    }
  });
  return session;
}

export function sessionRows(session: Session): number {
  return Math.max(...TRACK_IDS.map((t) => session[t].length));
}

/** The first empty slot in a track, or the row past the end when it is full. */
export function firstEmptySlot(session: Session, track: TrackId): number {
  const i = session[track].findIndex((c) => !c);
  return i >= 0 ? i : session[track].length;
}

/** A copy of the session with `clip` in a slot, growing every track to keep rows aligned. */
export function withClip(session: Session, track: TrackId, row: number, clip: SessionClip | null): Session {
  const rows = Math.min(MAX_SESSION_ROWS, Math.max(sessionRows(session), row + 1));
  const next = {} as Session;
  for (const t of TRACK_IDS) {
    const list = session[t].slice(0, rows);
    while (list.length < rows) list.push(null);
    next[t] = list;
  }
  if (row < rows) next[track][row] = clip;
  return next;
}

/** A copy of the session with one clip changed, wherever it is. */
export function updateClip(session: Session, id: string, patch: (clip: SessionClip) => SessionClip): Session {
  const next = {} as Session;
  for (const t of TRACK_IDS) next[t] = session[t].map((c) => (c && c.id === id ? patch(c) : c));
  return next;
}

export function findClip(session: Session, id: string): { track: TrackId; row: number; clip: SessionClip } | null {
  for (const track of TRACK_IDS) {
    const row = session[track].findIndex((c) => c?.id === id);
    if (row >= 0) return { track, row, clip: session[track][row]! };
  }
  return null;
}

/** A recorded loop as a clip that keeps its pitches and instrument. */
export function clipFromRecording(loop: RecordedLoop): NotesClip {
  return { kind: 'notes', id: loop.id, name: loop.name, beats: loop.beats, notes: loop.notes.map((n) => ({ ...n })), key: null, instrument: loop.instrument };
}

/** A copy of a clip under a new id. */
export function duplicateClip(clip: SessionClip, id: string, name = `${clip.name} copy`): SessionClip {
  return clip.kind === 'beat'
    ? { ...clip, id, name, pattern: normalizePattern(clip.pattern) }
    : { ...clip, id, name, notes: clip.notes.map((n) => ({ ...n })), key: clip.key ? { ...clip.key } : null };
}

/** What a saved clip may hold before it is checked. */
interface RawClip {
  kind?: unknown;
  id?: unknown;
  name?: unknown;
  preset?: unknown;
  pattern?: unknown;
  beats?: unknown;
  notes?: unknown;
  key?: { root?: unknown; scale?: unknown } | null;
  instrument?: unknown;
}

/** A clip from saved data, or null. */
export function normalizeClip(raw: unknown): SessionClip | null {
  if (!raw || typeof raw !== 'object') return null;
  const input = raw as RawClip;
  if (typeof input.id !== 'string' || !input.id) return null;
  const name = typeof input.name === 'string' && input.name.trim() ? input.name.trim() : 'Clip';
  const preset = typeof input.preset === 'string' ? input.preset : undefined;
  if (input.kind === 'beat') {
    if (!input.pattern) return null;
    return { kind: 'beat', id: input.id, name, pattern: normalizePattern(input.pattern), ...(preset ? { preset } : {}) };
  }
  if (input.kind !== 'notes') return null;
  // Any length in quarter beats: a three-beat loop drifts against the bar on purpose.
  const quarters = Math.round(Number(input.beats) * 4);
  const beats = Number.isFinite(quarters) && quarters > 0 ? Math.min(MAX_LOOP_BARS * BEATS_PER_BAR, quarters / 4) : BEATS_PER_BAR;
  const notes: RecordedNote[] = [];
  for (const n of Array.isArray(input.notes) ? (input.notes as Array<Partial<RecordedNote> | null>) : []) {
    if (!n || typeof n !== 'object') continue;
    const beat = Number(n.beat);
    if (!(beat >= 0 && beat < beats)) continue;
    notes.push({
      beat,
      dur: Math.max(1 / 64, Math.min(beats, Number(n.dur) || 0.25)),
      note: clampNote(Number(n.note)),
      velocity: clampVelocity(Number(n.velocity ?? 0.8)),
    });
  }
  notes.sort((a, b) => a.beat - b.beat || a.note - b.note);
  const root = Number(input.key?.root);
  const scale = input.key?.scale;
  const key = Number.isInteger(root) && typeof scale === 'string' && scale in SCALES
    ? { root: ((root % 12) + 12) % 12, scale: scale as ScaleId }
    : null;
  const instrument = INSTRUMENTS.includes(input.instrument as InstrumentId) ? (input.instrument as InstrumentId) : null;
  return { kind: 'notes', id: input.id, name, beats, notes, key, instrument, ...(preset ? { preset } : {}) };
}

/** A session from saved data. Beat clips only live on the beat track, notes clips on the others. */
export function normalizeSession(raw: unknown): Session | null {
  if (!raw || typeof raw !== 'object') return null;
  const input = raw as Partial<Record<TrackId, unknown>>;
  const session = {} as Session;
  const seen = new Set<string>();
  for (const track of TRACK_IDS) {
    const list = Array.isArray(input[track]) ? (input[track] as unknown[]) : [];
    session[track] = list.slice(0, MAX_SESSION_ROWS).map((c) => {
      const clip = normalizeClip(c);
      if (!clip || seen.has(clip.id) || (clip.kind === 'beat') !== (track === 'beats')) return null;
      seen.add(clip.id);
      return clip;
    });
  }
  const rows = Math.max(1, sessionRows(session));
  for (const track of TRACK_IDS) while (session[track].length < rows) session[track].push(null);
  return session;
}

/** True when a beat clip has any hits, for showing empty ones dimmed. */
export function clipHasNotes(clip: SessionClip): boolean {
  return clip.kind === 'beat' ? patternHasHits(clip.pattern) : clip.notes.length > 0;
}

/** Every track's id is a loop role except the beat. */
export function isNotesTrack(track: TrackId): track is LoopRole {
  return (LOOP_ROLES as readonly string[]).includes(track);
}

