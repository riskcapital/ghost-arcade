import { describe, expect, it } from 'vitest';
import { addNote, doubleLoop, halveLoop, nudgeNote, quantizeLayer, removeNote, resizeNote, setVelocity, transposeLayer } from './quickEdit';

const n = (beat: number, note = 60, dur = 0.5) => ({ beat, note, dur, velocity: 0.8 });

describe('quick MIDI editor edits', () => {
  it('quantises by strength and wraps to the loop', () => {
    expect(quantizeLayer([n(1.1)], 0.25, 1, 16)[0].beat).toBeCloseTo(1);
    expect(quantizeLayer([n(1.1)], 0.25, 0.5, 16)[0].beat).toBeCloseTo(1.05);
    expect(quantizeLayer([n(15.95)], 0.25, 1, 16)[0].beat).toBe(0);
  });

  it('adds, removes, nudges, resizes and sets velocity', () => {
    let l = addNote([], 3, 64, 0.25, 0.5, 4);
    expect(l).toEqual([{ beat: 3, note: 64, dur: 0.25, velocity: 0.5 }]);
    l = nudgeNote(l, 0, 1.25, 12, 4);
    expect(l[0].beat).toBeCloseTo(0.25);
    expect(l[0].note).toBe(76);
    l = resizeNote(l, 0, 10, 4);
    expect(l[0].dur).toBeCloseTo(3.75);
    expect(setVelocity(l, 0, 2)[0].velocity).toBe(1);
    expect(removeNote(l, 0)).toEqual([]);
    expect(transposeLayer([n(0, 126)], 12)[0].note).toBe(127);
  });

  it('halves and doubles the loop', () => {
    const h = halveLoop([[n(1), n(9)]], 16);
    expect(h.beats).toBe(8);
    expect(h.layers[0].map((x) => x.beat)).toEqual([1]);
    expect(halveLoop([[n(1)]], 4).beats).toBe(4);
    const d = doubleLoop([[n(1)]], 8);
    expect(d.beats).toBe(16);
    expect(d.layers[0].map((x) => x.beat)).toEqual([1, 9]);
  });
});
