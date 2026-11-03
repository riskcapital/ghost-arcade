import { describe, expect, it } from 'vitest';
import { followBars, MixFollower, mixAt, normalizeMix, SHUFFLE_BLENDS } from './studioMix';

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
    expect(normalizeMix({ mode: 'shuffle', bars: 8, follow: true })).toEqual({ mode: 'shuffle', bars: 8, follow: true });
    expect(normalizeMix({ mode: 'order', bars: 0.25 })).toEqual({ mode: 'order', bars: 0.25, follow: false });
    expect(normalizeMix({ mode: 'nope', bars: 3 })).toEqual({ mode: 'all', bars: 4, follow: false });
  });
});

describe('auto-mix at the clock wrap', () => {
  it('fades from the last change of the 64-bar cycle into the first', () => {
    const atEnd = mixAt({ mode: 'order', bars: 1 }, 63.5, [false, false, false]).map((v) => v.gain);
    const justAfter = mixAt({ mode: 'order', bars: 1 }, 0.0, [false, false, false]).map((v) => v.gain);
    expect(justAfter).toEqual(atEnd);
  });
});

describe('auto-mix on the beat', () => {
  const shown = (bars: number, pos: number, n = 4) => mixAt({ mode: 'order', bars }, pos, none(n)).flatMap((v, i) => (v.gain > 0.99 ? [i] : []));

  it('changes every beat, half bar and eighth of a bar', () => {
    expect([0.2, 0.45, 0.7, 0.95].map((p) => shown(0.25, p))).toEqual([[0], [1], [2], [3]]);
    expect([0.4, 0.9, 1.4].map((p) => shown(0.5, p))).toEqual([[0], [1], [2]]);
    expect([0.1, 0.24, 0.36].map((p) => shown(0.125, p))).toEqual([[0], [1], [2]]);
  });

  it('keeps the crossfade inside the shorter gap', () => {
    // An eighth of a bar: the fade is done a sixteenth in.
    expect(mixAt({ mode: 'order', bars: 0.125 }, 0.125 + 0.07, none(2)).map((v) => v.gain)).toEqual([0, 1]);
  });
});

describe('auto-mix following the music', () => {
  const busy = { pace: 1, level: 1 };
  const calm = { pace: 0, level: 0 };

  it('moves up to two steps either side of the chosen pace', () => {
    expect(followBars(1, 0.5)).toBe(1);
    expect(followBars(1, 1)).toBe(0.25);
    expect(followBars(1, 0)).toBe(4);
    expect(followBars(0.125, 1)).toBe(0.125);
    expect(followBars(8, 0)).toBe(8);
  });

  const changes = (feel: { pace: number; level: number }) => {
    const f = new MixFollower();
    let count = 0;
    let last = '';
    for (let pos = 0; pos < 8; pos += 1 / 64) {
      const now = f.step({ mode: 'order', bars: 1 }, pos, none(4), feel).map((v) => (v.gain > 0.99 ? 1 : 0)).join('');
      // Count settled picks only (one visual fully shown), not the crossfades between.
      if (now.includes('1') && now !== last) { count++; last = now; }
    }
    return count;
  };

  it('changes faster when the music is busy and slower when it is calm', () => {
    const fast = changes(busy);
    const slow = changes(calm);
    expect(fast).toBeGreaterThan(20);
    expect(slow).toBeLessThan(4);
  });

  it('shows more at once in shuffle when the music is big', () => {
    const most = (feel: { pace: number; level: number }) => {
      const f = new MixFollower();
      let top = 0;
      for (let pos = 0; pos < 32; pos += 1 / 16) top = Math.max(top, f.step({ mode: 'shuffle', bars: 1 }, pos, none(6), feel).filter((v) => v.gain > 0.99).length);
      return top;
    };
    expect(most(busy)).toBe(4);
    expect(most(calm)).toBeLessThanOrEqual(2);
  });

  it('carries on through the 64-bar clock wrap without a jump', () => {
    const f = new MixFollower();
    let seen = 0;
    for (let pos = 60; pos < 68; pos += 1 / 32) {
      const out = f.step({ mode: 'order', bars: 1 }, pos % 64, none(3), { pace: 0.5, level: 0.5 });
      seen += out.some((v) => v.gain > 0) ? 1 : 0;
    }
    expect(seen).toBe(8 * 32);
  });
});
