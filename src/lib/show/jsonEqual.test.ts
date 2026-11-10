import { describe, expect, it } from 'vitest';
import { sameJson } from './jsonEqual';

const json = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

describe('sameJson', () => {
  it('agrees with comparing JSON strings', () => {
    const cases: Array<[unknown, unknown]> = [
      [1, 1], [1, 2], [0, -0], [NaN, null], [Infinity, null], [NaN, NaN], ['a', 'a'], ['a', 'b'],
      [undefined, undefined], [undefined, null], [() => 1, undefined], [null, null],
      [{ a: 1, b: 2 }, { a: 1, b: 2 }], [{ a: 1, b: 2 }, { b: 2, a: 1 }], [{ a: 1 }, { a: 1, b: undefined }],
      [{ a: 1, f: () => 0 }, { a: 1 }], [{ a: undefined, b: 1 }, { b: 1 }], [{ a: 1 }, { a: '1' }],
      [[1, undefined], [1, null]], [[1, () => 0], [1, null]], [[1], [1, 2]], [[], {}], [{}, {}],
      [{ d: new Date(5) }, { d: new Date(5).toISOString() }], [{ d: new Date(5) }, { d: new Date(6) }],
      [{ k: [{ time: 1, value: 2, easing: 'linear' }] }, { k: [{ time: 1, value: 2, easing: 'linear' }] }],
      [{ k: [{ time: 1, value: 2 }] }, { k: [{ time: 1, value: 3 }] }], [{ a: { b: { c: NaN } } }, { a: { b: { c: null } } }],
      [true, true], [true, false], [true, 1], ['', null],
    ];
    for (const [a, b] of cases) expect(sameJson(a, b), JSON.stringify([a, b])).toBe(json(a, b));
  });

  it('agrees on random nested data', () => {
    let seed = 7;
    const r = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
    const leaf = () => [1, 2, 0, NaN, undefined, null, 'x', 'y', true, false][Math.floor(r() * 10)];
    const make = (depth: number): unknown => {
      if (depth <= 0 || r() < 0.3) return leaf();
      if (r() < 0.5) return Array.from({ length: Math.floor(r() * 3) }, () => make(depth - 1));
      const o: Record<string, unknown> = {};
      for (const k of ['a', 'b', 'c'].filter(() => r() < 0.7)) o[k] = make(depth - 1);
      return o;
    };
    for (let i = 0; i < 4000; i++) {
      const a = make(4);
      const b = r() < 0.5 ? JSON.parse(JSON.stringify(a ?? null)) : make(4);
      expect(sameJson(a, b)).toBe(json(a, b));
    }
  });

  it('skips shared references without walking them', () => {
    const lane = { keyframes: Array.from({ length: 2000 }, (_, i) => ({ time: i, value: 1 })) };
    let reads = 0;
    const spy = new Proxy(lane, { get: (t, k) => { reads++; return Reflect.get(t, k); } });
    expect(sameJson([spy, { a: 1 }], [spy, { a: 1 }])).toBe(true);
    expect(reads).toBe(0);
  });
});
