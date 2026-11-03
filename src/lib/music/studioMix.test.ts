import { describe, expect, it } from 'vitest';
import { mixAt, normalizeMix, SHUFFLE_BLENDS } from './studioMix';

const none = (n: number) => Array.from({ length: n }, () => false);
const shownAt = (mode: 'order' | 'random' | 'shuffle', bar: number, n = 4, bars = 1) =>
  mixAt({ mode, bars }, bar + 0.5, none(n)).flatMap((v, i) => (v.gain > 0.99 ? [i] : []));

describe('auto-mix', () => {
  it('shows everything when off', () => {
    expect(mixAt({ mode: 'all', bars: 4 }, 3.2, none(3)).map((v) => v.gain)).toEqual([1, 1, 1]);
  });

  it('one by one goes down the list, a change every N bars', () => {
    expect([0, 1, 2, 3, 4].map((b) => shownAt('order', b))).toEqual([[0], [1], [2], [3], [0]]);
    expect([0, 1, 2, 3].map((b) => shownAt('order', b, 4, 2))).toEqual([[0], [0], [1], [1]]);
  });

  it('one at random never repeats itself straight away', () => {
    let last = -1;
    for (let bar = 0; bar < 40; bar++) {
      const [now] = shownAt('random', bar);
      expect(now).toBeGreaterThanOrEqual(0);
      expect(now).not.toBe(last);
      last = now;
    }
  });

  it('shuffle changes how many show, and their blends', () => {
    const counts = Array.from({ length: 24 }, (_, bar) => shownAt('shuffle', bar, 5).length);
    expect(new Set(counts).size).toBeGreaterThan(1);
    expect(Math.max(...counts)).toBeLessThanOrEqual(3);
    for (let i = 1; i < counts.length; i++) expect(counts[i]).not.toBe(counts[i - 1]);
    const blends = mixAt({ mode: 'shuffle', bars: 1 }, 7.5, none(5)).flatMap((v) => (v.blend ? [v.blend] : []));
    expect(blends.length).toBeGreaterThan(0);
    for (const b of blends) expect(SHUFFLE_BLENDS).toContain(b);
  });

  it('crossfades over a beat at each change, no pops', () => {
    const at = (pos: number) => mixAt({ mode: 'order', bars: 1 }, pos, none(2)).map((v) => v.gain);
    expect(at(0.99)).toEqual([1, 0]);
    const mid = at(1.125);
    expect(mid[0]).toBeGreaterThan(0.2);
    expect(mid[1]).toBeGreaterThan(0.2);
    expect(at(1.3)).toEqual([0, 1]);
  });

  it('leaves muted visuals out of the turns', () => {
    const muted = [false, true, false];
    const shown = [0, 1, 2, 3].map((bar) => mixAt({ mode: 'order', bars: 1 }, bar + 0.5, muted).flatMap((v, i) => (v.gain > 0.99 ? [i] : [])));
    expect(shown).toEqual([[0], [2], [0], [2]]);
  });

  it('keeps its settings through a save', () => {
    expect(normalizeMix({ mode: 'shuffle', bars: 8 })).toEqual({ mode: 'shuffle', bars: 8 });
    expect(normalizeMix({ mode: 'nope', bars: 3 })).toEqual({ mode: 'all', bars: 4 });
  });
});

describe('auto-mix at the clock wrap', () => {
  it('fades from the last change of the 64-bar cycle into the first', () => {
    const atEnd = mixAt({ mode: 'order', bars: 1 }, 63.5, [false, false, false]).map((v) => v.gain);
    const justAfter = mixAt({ mode: 'order', bars: 1 }, 0.0, [false, false, false]).map((v) => v.gain);
    expect(justAfter).toEqual(atEnd);
  });
});
