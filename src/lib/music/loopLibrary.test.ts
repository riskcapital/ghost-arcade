import { describe, expect, it } from 'vitest';
import { LIBRARY_BEATS, LIBRARY_MELODIC, LOOP_STYLE_LABELS } from './loopLibrary';
import { BEAT_LOOPS, MELODIC_LOOPS, loopById } from './loops';

describe('the loop library', () => {
  it('is big: over 150 loops across every part', () => {
    expect(LIBRARY_MELODIC.length + LIBRARY_BEATS.length).toBeGreaterThanOrEqual(150);
    for (const role of ['bass', 'lead', 'chords', 'texture'] as const) {
      expect(LIBRARY_MELODIC.filter((l) => l.role === role).length, role).toBeGreaterThanOrEqual(10);
    }
    expect(LIBRARY_BEATS.length).toBeGreaterThanOrEqual(20);
  });

  it('has unique ids and names, and is part of the studio presets', () => {
    const all = [...MELODIC_LOOPS, ...BEAT_LOOPS];
    expect(new Set(all.map((l) => l.id)).size).toBe(all.length);
    const names = [...LIBRARY_MELODIC, ...LIBRARY_BEATS].map((l) => l.name);
    expect(new Set(names).size).toBe(names.length);
    for (const l of LIBRARY_MELODIC) expect(loopById(l.id)).toBe(l);
  });

  it('keeps every note inside its loop, in whole bars, with sane degrees', () => {
    for (const l of LIBRARY_MELODIC) {
      expect(l.beats % 4, l.id).toBe(0);
      expect(l.notes.length, l.id).toBeGreaterThan(0);
      for (const n of l.notes) {
        expect(n.beat, l.id).toBeGreaterThanOrEqual(0);
        expect(n.beat, l.id).toBeLessThan(l.beats);
        expect(n.dur, l.id).toBeGreaterThan(0);
        expect(n.velocity, l.id).toBeGreaterThan(0);
        expect(n.velocity, l.id).toBeLessThanOrEqual(1);
        for (const d of n.degrees) expect(Math.abs(d), l.id).toBeLessThanOrEqual(16);
      }
      expect(l.style in LOOP_STYLE_LABELS, l.id).toBe(true);
      expect(l.bpm[0]).toBeLessThan(l.bpm[1]);
    }
  });

  it('writes drum rows the grid can read', () => {
    for (const b of LIBRARY_BEATS) {
      for (const row of Object.values(b.rows)) {
        expect(row!.length, b.id).toBe(b.steps);
        expect(/^[xo.]+$/.test(row!), b.id).toBe(true);
      }
    }
  });

  it('names no real artists or studios', () => {
    const banned = /perry|scratch|tubby|ott\b|black ark|marley|sly|robbie|aphex|daft|disco biscuits|new deal|pressure drop/i;
    for (const l of [...LIBRARY_MELODIC, ...LIBRARY_BEATS]) expect(banned.test(l.name), l.name).toBe(false);
  });
});
