import { describe, expect, it } from 'vitest';
import { BASS_STABLE_SECONDS, BassFollower, droneShift } from './bassFollow';
import { chordNotes } from './studioSets';

describe('BassFollower', () => {
  it('moves once a note has held for a moment', () => {
    const f = new BassFollower();
    f.hear(40, 1); // E
    expect(f.settle(1.05)).toBeNull();
    expect(f.wait(1.05)).toBeCloseTo(BASS_STABLE_SECONDS - 0.05);
    expect(f.settle(1 + BASS_STABLE_SECONDS)).toBe(4);
    expect(f.root).toBe(4);
    expect(f.wait(2)).toBeNull();
  });

  it('is not shaken by passing notes or a fast run', () => {
    const f = new BassFollower();
    f.hear(40, 0);
    f.settle(1);
    // A run of sixteenths: no note stays long enough.
    [43, 45, 47, 48].forEach((note, i) => {
      f.hear(note, 2 + i * 0.1);
      expect(f.settle(2 + i * 0.1 + 0.09)).toBeNull();
    });
    // The last one rings on and the drone follows it.
    expect(f.settle(2.3 + BASS_STABLE_SECONDS)).toBe(0);
  });

  it('counts a repeated note from its first hit, and an octave off as the same note', () => {
    const f = new BassFollower();
    f.hear(45, 0);
    f.hear(57, 0.1);
    f.hear(33, 0.12);
    expect(f.settle(BASS_STABLE_SECONDS)).toBe(9);
  });

  it('stays put when the bass comes back to its note before a new one settles', () => {
    const f = new BassFollower();
    f.hear(40, 0);
    f.settle(1);
    f.hear(41, 2);
    f.hear(40, 2.05);
    expect(f.wait(2.1)).toBeNull();
    expect(f.settle(3)).toBeNull();
    expect(f.root).toBe(4);
  });

  it('forgets everything on reset', () => {
    const f = new BassFollower();
    f.hear(40, 0);
    f.settle(1);
    f.hear(43, 2);
    f.reset();
    expect(f.root).toBeNull();
    expect(f.settle(5)).toBeNull();
  });
});

describe('droneShift', () => {
  const eMinor = { root: 4, scale: 'minor' as const };

  it('roots a chord on the key root on the bass note, in the key', () => {
    // A (the fourth) in E minor: up three degrees.
    expect(droneShift(eMinor, 9)).toBe(3);
    const chord = chordNotes(eMinor, droneShift(eMinor, 9), 48);
    expect(chord[0] % 12).toBe(9);
    // C (the sixth): down two degrees, so the drone stays in its register.
    expect(droneShift(eMinor, 0)).toBe(-2);
    const low = chordNotes(eMinor, droneShift(eMinor, 0), 48);
    expect(low[0] % 12).toBe(0);
    // C major: C E G B, built from the key, not a transposed E minor chord.
    expect(low.map((n) => n % 12)).toEqual([0, 4, 7, 11]);
  });

  it('stays on the key root with no bass and on the root note', () => {
    expect(droneShift(eMinor, null)).toBe(0);
    expect(droneShift(eMinor, 4)).toBe(0);
  });

  it('takes the nearest scale note for a note outside the key', () => {
    // F in E minor goes down to E; G# to G (ties go down).
    expect(droneShift(eMinor, 5)).toBe(0);
    expect(droneShift(eMinor, 8)).toBe(2);
  });

  it('works on a five-note scale', () => {
    const aPent = { root: 9, scale: 'pentatonic' as const };
    // A C D E G: E is the fourth note, so the move is two steps down instead of three up.
    expect(droneShift(aPent, 4)).toBe(-2);
    expect(droneShift(aPent, 2)).toBe(2);
  });
});
