import { describe, expect, it } from 'vitest';
import { createPattern } from '../drumPattern';
import { partSteps } from './machineBeat';
import { RANDOM_STYLES, padsForVoices, partFromPattern, randomPart } from './machineImport';

const pads = [
  { index: 0, role: 'kick' as const },
  { index: 2, role: 'snare' as const },
  { index: 4, role: 'hatClosed' as const },
  { index: 9, role: 'tom' as const },
];

/** A fixed sequence, so a random beat is the same every run. */
function seeded(seed: number) {
  let x = seed;
  return () => {
    x = (x * 1664525 + 1013904223) % 4294967296;
    return x / 4294967296;
  };
}

describe('padsForVoices', () => {
  it('gives each voice its own pad, or the nearest the kit has', () => {
    const map = padsForVoices(pads);
    expect(map.kick).toBe(0);
    expect(map.clap).toBe(2); // no clap pad: the snare
    expect(map.hatOpen).toBe(4);
    expect(map.crash).toBeUndefined(); // nothing close: left out
  });
});

describe('partFromPattern', () => {
  it('puts a two-bar pattern on the pads, step for step', () => {
    const p = createPattern(32);
    p.swing = 0.1;
    p.tracks.kick[0] = 0.9;
    p.tracks.kick[16] = 0.9;
    p.tracks.snare[4] = 0.8;
    p.tracks.hatClosed[30] = 0.5;
    const part = partFromPattern(p, pads, 'Verse / Drums', 'part-clip-x');
    expect(part).toMatchObject({ id: 'part-clip-x', name: 'Verse / Drums', bars: 2, swing: 0.1 });
    expect(partSteps(part)).toBe(32);
    expect(part.tracks[0].vel[0]).toBe(0.9);
    expect(part.tracks[0].vel[16]).toBe(0.9);
    expect(part.tracks[2].vel[4]).toBe(0.8);
    expect(part.tracks[4].vel[30]).toBe(0.5);
  });

  it('keeps the grid of a fine pattern and the first four bars of a long one', () => {
    const p = createPattern(256, 32); // eight bars of 1/32
    p.tracks.kick[8] = 1;
    const part = partFromPattern(p, pads, 'Bridge');
    expect(part.bars).toBe(4);
    expect(part.grid).toBe(32);
    expect(part.tracks[0].vel[8]).toBe(1);
  });
});

describe('randomPart', () => {
  it('makes a two-bar beat with a kick in every style, the same for the same chances', () => {
    for (const style of RANDOM_STYLES) {
      const a = randomPart(style.id, pads, seeded(7), 'id');
      const b = randomPart(style.id, pads, seeded(7), 'id');
      expect(a).toEqual(b);
      expect(a.bars).toBe(2);
      expect(a.tracks[0].vel.some((v) => v > 0), style.id).toBe(true);
      expect(a.tracks[4].vel.some((v) => v > 0), style.id).toBe(true);
      for (const t of a.tracks) for (const v of t.vel) expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('keeps house on the floor and half-time on the three', () => {
    const house = randomPart('house', pads, seeded(3));
    for (const s of [0, 4, 8, 12, 16, 20, 24, 28]) expect(house.tracks[0].vel[s]).toBeGreaterThan(0.9);
    const half = randomPart('half', pads, seeded(3));
    expect(half.tracks[2].vel[8]).toBeGreaterThan(0.9);
  });
});
