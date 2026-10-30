import { describe, expect, it } from 'vitest';
import {
  clipFromPreset,
  clipLoop,
  defaultSession,
  degreeOf,
  duplicateClip,
  findClip,
  firstEmptySlot,
  normalizeSession,
  playableNotes,
  presetsFor,
  sessionRows,
  transposeNotes,
  updateClip,
  withClip,
  type NotesClip,
} from './session';

const dDorian = { root: 2, scale: 'dorian' as const };
const cMajor = { root: 0, scale: 'major' as const };
let n = 0;
const id = () => `c${n++}`;

describe('degrees and key changes', () => {
  it("finds a note's scale degree, and the semitones above it for notes outside the scale", () => {
    expect(degreeOf(62, dDorian)).toEqual({ degree: 35, offset: 0 }); // D4: root, octave 5
    expect(degreeOf(65, dDorian)).toEqual({ degree: 37, offset: 0 }); // F: the third
    expect(degreeOf(66, dDorian)).toEqual({ degree: 37, offset: 1 }); // F#: a semitone over the third
  });

  it('moves notes by degree into another key, the short way round', () => {
    const notes = [{ beat: 0, dur: 1, note: 62, velocity: 0.8 }, { beat: 1, dur: 1, note: 65, velocity: 0.8 }];
    // D Dorian root and third become C major root and third, a tone lower.
    expect(transposeNotes(notes, dDorian, cMajor).map((x) => x.note)).toEqual([60, 64]);
    // B to C goes up a semitone, not down eleven.
    const b = { root: 11, scale: 'major' as const };
    expect(transposeNotes([{ beat: 0, dur: 1, note: 59, velocity: 1 }], b, cMajor)[0].note).toBe(60);
  });
});

describe('clips from presets', () => {
  it('makes a notes clip in the key, which follows key changes', () => {
    const clip = clipFromPreset('bass-rolling', dDorian, 'a') as NotesClip;
    expect(clip.kind).toBe('notes');
    expect(clip.key).toEqual(dDorian);
    expect(clip.instrument).toBeNull();
    expect(clip.notes.length).toBeGreaterThan(0);
    const inC = playableNotes(clip, cMajor);
    expect(inC[0].note).toBe(clip.notes[0].note - 2);
  });

  it('makes a beat clip with the pattern', () => {
    const clip = clipFromPreset('beat-four', dDorian, 'b');
    expect(clip?.kind).toBe('beat');
  });

  it('plays a clip on the track instrument unless it was recorded on one', () => {
    const clip = clipFromPreset('bass-dub-root', dDorian, 'c') as NotesClip;
    expect(clipLoop(clip, 'bass', 'dub', dDorian).instrument).toBe('dubbass');
    expect(clipLoop({ ...clip, instrument: 'keys' }, 'bass', 'dub', dDorian).instrument).toBe('keys');
  });

  it('lists presets per track', () => {
    expect(presetsFor('beats').length).toBeGreaterThan(5);
    expect(presetsFor('bass').every((p) => p.id.startsWith('bass-'))).toBe(true);
  });
});

describe('the session grid', () => {
  it('starts with rows that work together', () => {
    const s = defaultSession(dDorian, id);
    expect(sessionRows(s)).toBe(8);
    expect(s.beats[0]?.kind).toBe('beat');
    expect(s.bass[0]?.kind).toBe('notes');
    expect(s.lead[7]).toBeNull();
  });

  it('places clips, growing every track together', () => {
    const s = defaultSession(dDorian, id);
    const clip = clipFromPreset('lead-run', dDorian, 'new')!;
    const next = withClip(s, 'lead', 9, clip);
    expect(sessionRows(next)).toBe(10);
    expect(next.beats).toHaveLength(10);
    expect(findClip(next, 'new')).toMatchObject({ track: 'lead', row: 9 });
    expect(firstEmptySlot(next, 'lead')).toBe(4);
  });

  it('updates and duplicates clips', () => {
    const s = defaultSession(dDorian, id);
    const target = s.bass[0]!;
    const renamed = updateClip(s, target.id, (c) => ({ ...c, name: 'Mine' }));
    expect(renamed.bass[0]?.name).toBe('Mine');
    expect(s.bass[0]?.name).not.toBe('Mine');
    const copy = duplicateClip(target, 'dup');
    expect(copy.id).toBe('dup');
    expect(copy.name).toMatch(/copy$/);
  });

  it('normalizes saved sessions and keeps clips on the right kind of track', () => {
    const s = normalizeSession({
      beats: [{ kind: 'beat', id: 'b1', name: 'B', pattern: { steps: 16 } }, { kind: 'notes', id: 'x', name: 'wrong', beats: 4, notes: [] }],
      bass: [{ kind: 'notes', id: 'n1', name: 'N', beats: 4, notes: [{ beat: 0, dur: 1, note: 36, velocity: 1 }, { beat: 9, dur: 1, note: 36 }], key: { root: 2, scale: 'dorian' } }],
    })!;
    expect(s.beats[0]?.id).toBe('b1');
    expect(s.beats[1]).toBeNull();
    const bass = s.bass[0] as NotesClip;
    expect(bass.notes).toHaveLength(1);
    expect(bass.key).toEqual({ root: 2, scale: 'dorian' });
    expect(s.lead).toHaveLength(2);
    expect(normalizeSession(null)).toBeNull();
  });
});
