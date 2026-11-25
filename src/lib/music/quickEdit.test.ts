import { describe, expect, it } from 'vitest';
import { addNote, drawNote, doubleLoop, halveLoop, nudgeNote, quantizeLayer, removeNote, resizeNote, setVelocity, transposeLayer } from './quickEdit';

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

  it('deleting the only note leaves the loop drawable (regression)', () => {
    // One 1/4 note drawn into a 1-bar loop, then deleted.
    let { layers, layer, index } = drawNote([[]], -1, 1, 60, 1, 0.8, 4);
    expect(layers).toEqual([[{ beat: 1, note: 60, dur: 1, velocity: 0.8 }]]);
    layers = layers.map((l, k) => (k === layer ? removeNote(l, index) : l));
    expect(layers).toEqual([[]]);
    // A new note still goes in.
    ({ layers } = drawNote(layers, -1, 2, 62, 1, 0.8, 4));
    expect(layers[0]).toEqual([{ beat: 2, note: 62, dur: 1, velocity: 0.8 }]);
  });

  it('deleting one note keeps the others', () => {
    const layers = [[n(0), n(1, 62), n(2, 64)]];
    expect(removeNote(layers[0], 1).map((x) => x.note)).toEqual([60, 64]);
  });

  it('draws on a track with no layers left (cleared): it gets one', () => {
    const r = drawNote([], -1, 0, 60, 0.25, 0.8, 4);
    expect(r.layers).toHaveLength(1);
    expect(r.layer).toBe(0);
    expect(r.index).toBe(0);
  });

  it('draws on the shown layer, or the newest', () => {
    const base = [[n(0)], [n(1)]];
    expect(drawNote(base, 0, 2, 60, 1, 0.8, 4).layers[0]).toHaveLength(2);
    expect(drawNote(base, -1, 2, 60, 1, 0.8, 4).layers[1]).toHaveLength(2);
  });
});
