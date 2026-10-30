/**
 * The studio's music as MIDI: what is playing (the beat and each track),
 * a single clip, or a recorded take, as .mid files a DAW opens; and .mid
 * files read back in as session clips (a drum channel becomes a beat clip,
 * every other part a notes clip on the track for it).
 */

import { drumVoiceForNote, type InstrumentId } from './noteEvents';
import { INSTRUMENT_LABELS } from './instruments';
import { createPattern, patternBeats, stepsBetween, type DrumPattern } from './drumPattern';
import { LOOP_ROLES, ROLE_INSTRUMENTS, loopById, loopNotesBetween, type LoopRole, type MelodicLoop } from './loops';
import {
  BEATS_PER_BAR,
  MAX_LOOP_BARS,
  loopBars,
  nextRecordedName,
  patternLengthFor,
  roleForRecording,
  writeHits,
  type RecordedLoop,
  type RecordedNote,
} from './loopRecorder';
import { midiFileName, writeMidiFile, type MidiSong, type MidiTrack } from './midiFile';
import type { Take } from './recording';
import { clipLoop, findClip, playableNotes, type Session, type SessionClip, type TrackId } from './session';
import type { MusicKey, StudioSet } from './studioSets';

export const DRUM_CHANNEL_INDEX = 9;

/** One pass of a beat as a drum track. */
export function patternTrack(pattern: DrumPattern, name = 'Drums'): MidiTrack {
  return {
    name,
    channel: DRUM_CHANNEL_INDEX,
    notes: stepsBetween(pattern, 0, patternBeats(pattern)).map((step) => ({ beat: step.beat, dur: 0.25, note: step.note, velocity: step.velocity })),
  };
}

/** One pass of a loop: recorded notes as played, library loops in `key`. */
export function loopTrack(loop: MelodicLoop | RecordedLoop, key: MusicKey, name = loop.name): MidiTrack {
  const notes = 'kind' in loop ? loop.notes.map((n) => ({ ...n })) : loopNotesBetween(loop, key, 0, 0, loop.beats).map((n) => ({ ...n }));
  return { name, channel: 0, notes };
}

export interface PlayingParts {
  bpm: number;
  key: MusicKey;
  set: StudioSet;
  /** The beat, when it is playing. */
  pattern: DrumPattern | null;
  playingLoops: Partial<Record<LoopRole, string>>;
  session: Session;
}

/** What is playing, one track per part, each repeated to the length of the longest. */
export function playingSong(parts: PlayingParts): MidiSong {
  const tracks: MidiTrack[] = [];
  const lengths: number[] = [];
  const loops: Array<MelodicLoop | RecordedLoop> = [];
  for (const role of LOOP_ROLES) {
    const id = parts.playingLoops[role];
    if (!id) continue;
    const found = findClip(parts.session, id);
    const loop = found?.clip.kind === 'notes' ? clipLoop(found.clip, role, parts.set, parts.key) : loopById(id);
    if (!loop || 'rows' in loop) continue;
    loops.push(loop);
    lengths.push(loop.beats);
  }
  if (parts.pattern) lengths.push(patternBeats(parts.pattern));
  const total = Math.max(BEATS_PER_BAR, ...lengths);
  const repeat = (track: MidiTrack, beats: number): MidiTrack => {
    const passes = Math.max(1, Math.round(total / beats));
    return { ...track, notes: Array.from({ length: passes }, (_, i) => track.notes.map((n) => ({ ...n, beat: n.beat + i * beats }))).flat() };
  };
  if (parts.pattern) tracks.push(repeat(patternTrack(parts.pattern), patternBeats(parts.pattern)));
  for (const loop of loops) {
    const voice = 'kind' in loop ? loop.instrument : ROLE_INSTRUMENTS[parts.set][loop.role];
    tracks.push(repeat(loopTrack(loop, parts.key, `${loop.name} (${INSTRUMENT_LABELS[voice]})`), loop.beats));
  }
  return { bpm: parts.bpm, tracks };
}

/** A take, with its seconds turned into beats at the tempo it was played at. One track per instrument. */
export function takeSong(take: Take): MidiSong {
  const bpm = take.bpm > 0 ? take.bpm : 120;
  const beatsPer = bpm / 60;
  const byInstrument = new Map<InstrumentId, MidiTrack>();
  const open = new Map<string, { beat: number; velocity: number }>();
  for (const e of take.events) {
    const key = `${e.instrument}:${e.note}`;
    const beat = e.t * beatsPer;
    const track = byInstrument.get(e.instrument) ?? { name: INSTRUMENT_LABELS[e.instrument], channel: e.instrument === 'drums' ? DRUM_CHANNEL_INDEX : 0, notes: [] };
    byInstrument.set(e.instrument, track);
    if (e.type === 'on') {
      if (e.instrument === 'drums') {
        track.notes.push({ beat, dur: 0.25, note: e.note, velocity: e.velocity });
        continue;
      }
      open.set(key, { beat, velocity: e.velocity });
    } else {
      const start = open.get(key);
      if (!start) continue;
      open.delete(key);
      track.notes.push({ beat: start.beat, dur: Math.max(1 / 64, beat - start.beat), note: e.note, velocity: start.velocity });
    }
  }
  return { bpm, tracks: [...byInstrument.values()].filter((t) => t.notes.length) };
}

/** Save a song as a .mid file through the browser's download. */
export function downloadMidi(song: MidiSong, name: string): void {
  const bytes = writeMidiFile(song);
  const blob = new Blob([bytes as BlobPart], { type: 'audio/midi' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = midiFileName(name);
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A clip from a MIDI file and the track it belongs on. */
export interface ImportedClip {
  track: TrackId;
  clip: SessionClip;
}

/**
 * Turn a MIDI file into session clips. Each track is cut to whole bars (up
 * to the longest loop). Drum-channel tracks become beat clips (up to four
 * bars, on sixteenths); other tracks become notes clips on the track for the
 * part they sound like, keeping their pitches and playing on that track's
 * instrument.
 */
export function importMidi(song: MidiSong, fileName: string, existing: ReadonlyArray<{ name: string }>, makeId: () => string): ImportedClip[] {
  const out: ImportedClip[] = [];
  const names = () => [...existing, ...out.map((o) => o.clip)];
  const base = fileName.replace(/\.(mid|midi)$/i, '').trim() || 'MIDI';
  for (const track of song.tracks) {
    if (!track.notes.length) continue;
    const end = Math.max(...track.notes.map((n) => n.beat + n.dur));
    const bars = loopBars(Math.max(1, Math.ceil(end / BEATS_PER_BAR - 1e-6)));
    const length = Math.min(bars, MAX_LOOP_BARS) * BEATS_PER_BAR;
    const label = track.name?.trim() || base;
    if (track.channel === DRUM_CHANNEL_INDEX) {
      const gridBeats = Math.min(length, 16);
      let pattern: DrumPattern = createPattern(patternLengthFor(gridBeats));
      pattern = writeHits(
        pattern,
        track.notes.filter((n) => n.beat < gridBeats).map((n) => ({ beat: n.beat, voice: drumVoiceForNote(n.note), velocity: n.velocity })),
      );
      out.push({ track: 'beats', clip: { kind: 'beat', id: makeId(), name: nextRecordedName(names(), label), pattern } });
      continue;
    }
    const notes: RecordedNote[] = track.notes
      .filter((n) => n.beat < length)
      .map((n) => ({ beat: n.beat, dur: Math.min(n.dur, length - n.beat), note: n.note, velocity: n.velocity }));
    if (!notes.length) continue;
    const role = roleForRecording('synth', notes);
    out.push({ track: role, clip: { kind: 'notes', id: makeId(), name: nextRecordedName(names(), label), beats: length, notes, key: null, instrument: null } });
  }
  return out;
}

/** One clip as a MIDI track: beat clips on the drum channel, notes clips as they play in `key`. */
export function clipTrack(clip: SessionClip, key: MusicKey): MidiTrack {
  if (clip.kind === 'beat') return patternTrack(clip.pattern, clip.name);
  return { name: clip.name, channel: 0, notes: playableNotes(clip, key).map((n) => ({ ...n })) };
}
