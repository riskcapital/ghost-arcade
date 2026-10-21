import { describe, expect, it } from 'vitest';
import { onAirDecks, sanitizeBeatScramble, scrambleEffectParams, scrambleNumber, scrambleShaderInput } from './beatScramble';

const fixed = (...values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length];
};

describe('scrambleNumber', () => {
  it('moves `amount` of the way toward a random point in range', () => {
    expect(scrambleNumber(0.2, 0, 1, 1, fixed(0.8))).toBeCloseTo(0.8);
    expect(scrambleNumber(0.2, 0, 1, 0.5, fixed(0.8))).toBeCloseTo(0.5);
    expect(scrambleNumber(0.2, 0, 1, 0, fixed(0.8))).toBeCloseTo(0.2);
  });
  it('stays inside the range', () => {
    expect(scrambleNumber(5, 0, 1, 0.1, fixed(0.5))).toBeLessThanOrEqual(1);
  });
});

describe('scrambleShaderInput', () => {
  it('scrambles floats, colours and points within their ranges', () => {
    expect(scrambleShaderInput({ NAME: 'speed', TYPE: 'float', MIN: 0, MAX: 10 }, 2, 1, fixed(0.5))).toBeCloseTo(5);
    const color = scrambleShaderInput({ NAME: 'tint', TYPE: 'color' }, [0, 0, 0, 0.7], 1, fixed(1)) as number[];
    expect(color).toEqual([1, 1, 1, 0.7]);
    expect(scrambleShaderInput({ NAME: 'p', TYPE: 'point2D' }, [0, 0], 1, fixed(0.25))).toEqual([0.25, 0.25]);
  });
  it('leaves images and other inputs alone', () => {
    expect(scrambleShaderInput({ NAME: 'img', TYPE: 'image' }, null, 1)).toBeNull();
  });
});

describe('scrambleEffectParams', () => {
  const defs = [
    { name: 'Amount', param: 'amount', min: 0, max: 1, step: 0.01, default: 1 },
    { name: 'Size', param: 'size', min: 0, max: 100, step: 1, default: 50 },
  ];
  it('keeps an effect audible: its amount stays in the top three quarters', () => {
    const patch = scrambleEffectParams(defs, { amount: 1, size: 50 }, 1, fixed(0));
    expect(patch.amount).toBeCloseTo(0.25);
    expect(patch.size).toBe(0);
  });
});

it('scrambles the decks the crossfader is showing', () => {
  expect(onAirDecks(false, 1)).toEqual(['A']);
  expect(onAirDecks(true, 0)).toEqual(['A']);
  expect(onAirDecks(true, 1)).toEqual(['B']);
  expect(onAirDecks(true, 0.5)).toEqual(['A', 'B']);
});

it('reads saved settings defensively', () => {
  expect(sanitizeBeatScramble({ on: true, every: 3, target: 'fx', amount: 9 })).toEqual({ on: true, every: 4, target: 'fx', amount: 1 });
  expect(sanitizeBeatScramble(null)).toEqual({ on: false, every: 4, target: 'both', amount: 0.6 });
});
