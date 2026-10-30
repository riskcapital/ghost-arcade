import { describe, expect, it } from 'vitest';
import { DRUM_VOICES } from './noteEvents';
import {
  BEAT_LOOPS,
  LOOP_ROLES,
  MELODIC_LOOPS,
  ROLE_INSTRUMENTS,
  beatPattern,
  isBeatLoop,
  loopById,
  loopNotesBetween,
  nextBar,
  type MelodicLoop,
} from './loops';
import { AUDIO_SOURCES, STUDIO_SETS, scaleNote, type MusicKey } from './studioSets';

const C_MINOR: MusicKey = { root: 0, scale: 'minor' };

const twoNotes: MelodicLoop = {
  id: 'test',
  name: 'Test',
  role: 'bass',
  beats: 4,
  notes: [
    { beat: 0, dur: 1, degrees: [0], velocity: 1 },
    { beat: 2, dur: 0.5, degrees: [4, 2], velocity: 0.5 },
  ],
};

describe('loop notes', () => {
  it('repeats every loop length from where it started, in the key', () => {
    const notes = loopNotesBetween(twoNotes, C_MINOR, 8, 8, 16);
    expect(notes.map((n) => n.beat)).toEqual([8, 10, 10, 12, 14, 14]);
    expect(notes[0].note).toBe(scaleNote(C_MINOR, 0, 24));
    expect(notes.slice(1, 3).map((n) => n.note).sort()).toEqual([scaleNote(C_MINOR, 2, 24), scaleNote(C_MINOR, 4, 24)].sort());
    expect(notes[1].velocity).toBe(0.5);
  });

  it('plays nothing before it starts and only what falls in the window', () => {
    expect(loopNotesBetween(twoNotes, C_MINOR, 8, 0, 8)).toEqual([]);
    expect(loopNotesBetween(twoNotes, C_MINOR, 8, 9, 10)).toEqual([]);
    expect(loopNotesBetween(twoNotes, C_MINOR, 8, 9.5, 10.5).map((n) => n.beat)).toEqual([10, 10]);
    expect(loopNotesBetween(twoNotes, C_MINOR, 8, 12, 12)).toEqual([]);
  });

  it('follows the key it is played in', () => {
    const inD = loopNotesBetween(twoNotes, { root: 2, scale: 'minor' }, 0, 0, 1);
    const inC = loopNotesBetween(twoNotes, C_MINOR, 0, 0, 1);
    expect(inD[0].note - inC[0].note).toBe(2);
  });
});

describe('bars', () => {
  it('waits for the next bar line, or takes the one it is on', () => {
    expect(nextBar(0)).toBe(0);
    expect(nextBar(0.1)).toBe(4);
    expect(nextBar(3.99)).toBe(4);
    expect(nextBar(8)).toBe(8);
  });
});

describe('beat loops', () => {
  it('load as step patterns: x a hit, o a soft one', () => {
    const loop = BEAT_LOOPS.find((l) => l.id === 'beat-four')!;
    const p = beatPattern(loop);
    expect(p.steps).toBe(16);
    expect(p.tracks.kick.filter((v) => v > 0)).toHaveLength(4);
    expect(p.tracks.kick[0]).toBeGreaterThan(p.tracks.hatOpen[6]);
    expect(p.tracks.hatOpen[6]).toBeGreaterThan(0);
    expect(p.tracks.crash.every((v) => v === 0)).toBe(true);
  });

  it('have one character a step for real kit voices', () => {
    for (const loop of BEAT_LOOPS) {
      for (const [voice, row] of Object.entries(loop.rows)) {
        expect(DRUM_VOICES).toContain(voice);
        expect(row).toMatch(new RegExp(`^[xo.]{${loop.steps}}$`));
      }
    }
  });
});

describe('the library', () => {
  it('has unique ids that look up the right loop', () => {
    const ids = [...MELODIC_LOOPS, ...BEAT_LOOPS].map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(isBeatLoop(loopById('beat-onedrop')!)).toBe(true);
    expect(loopById('bass-dub-root')?.name).toBe('Dub root and fifth');
    expect(loopById('nope')).toBeNull();
  });

  it('keeps every note inside its loop', () => {
    for (const loop of MELODIC_LOOPS) {
      expect(loop.notes.length).toBeGreaterThan(0);
      for (const n of loop.notes) {
        expect(n.beat).toBeGreaterThanOrEqual(0);
        expect(n.beat).toBeLessThan(loop.beats);
        expect(n.dur).toBeGreaterThan(0);
      }
    }
  });

  it('has loops of every kind, each played by an instrument the set routes', () => {
    for (const role of LOOP_ROLES) expect(MELODIC_LOOPS.some((l) => l.role === role)).toBe(true);
    for (const { id } of STUDIO_SETS) {
      for (const role of LOOP_ROLES) expect(AUDIO_SOURCES[id]).toContain(ROLE_INSTRUMENTS[id][role]);
    }
  });
});
