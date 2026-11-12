import { describe, expect, it } from 'vitest';
import { computeSpatialOrder, ledSpots, parseLedSpotId, pieceCentre, pieceSpots, type WhereSpot } from './spatialOrder';
import { slotWeight, windowWeights } from './whereWindow';
import { countKicks, defaultBeatAt, kickOnsets, randomSlot, stepWeights, whereWindowAt } from './whereMotion';
import { evaluateWhere } from './whereEval';
import { defaultWhere, normalizeNamedOrders, normalizeWhere, resolveOrderSpec, type WhereSpec } from './whereModel';
import type { Layer, WLEDController } from '../../types';

const spot = (id: string, x: number, y: number, group?: string): WhereSpot => ({ id, kind: 'piece', x, y, label: id, ...(group ? { group } : {}) });
const ids = (o: { slots: string[][] }) => o.slots.map((s) => s.join('+'));

describe('spatial order', () => {
  // A cross: centre C, left L, right R, top T, bottom B (y down).
  const cross = [spot('R', 0.9, 0.5), spot('T', 0.5, 0.1), spot('C', 0.5, 0.5), spot('L', 0.1, 0.5), spot('B', 0.5, 0.9)];

  it('orders left→right and right→left, ties top first then list order', () => {
    expect(ids(computeSpatialOrder(cross, { order: 'left-right' }))).toEqual(['L', 'T', 'C', 'B', 'R']);
    expect(ids(computeSpatialOrder(cross, { order: 'right-left' }))).toEqual(['R', 'T', 'C', 'B', 'L']);
  });

  it('orders top→bottom and bottom→top, ties left first', () => {
    expect(ids(computeSpatialOrder(cross, { order: 'top-bottom' }))).toEqual(['T', 'L', 'C', 'R', 'B']);
    expect(ids(computeSpatialOrder(cross, { order: 'bottom-top' }))).toEqual(['B', 'L', 'C', 'R', 'T']);
  });

  it('orders centre-out with ties broken clockwise from 12', () => {
    // square aspect so all four arms are the same distance
    expect(ids(computeSpatialOrder(cross, { order: 'centre-out' }, 1))).toEqual(['C', 'T', 'R', 'B', 'L']);
  });

  it('orders around clockwise from a start angle', () => {
    const ring = [spot('E', 0.9, 0.5), spot('N', 0.5, 0.1), spot('W', 0.1, 0.5), spot('S', 0.5, 0.9)];
    expect(ids(computeSpatialOrder(ring, { order: 'around' }, 1))).toEqual(['N', 'E', 'S', 'W']);
    expect(ids(computeSpatialOrder(ring, { order: 'around', angle: 180 }, 1))).toEqual(['S', 'W', 'N', 'E']);
  });

  it('keeps list order for exact ties', () => {
    const same = [spot('a', 0.5, 0.5), spot('b', 0.5, 0.5), spot('c', 0.5, 0.5)];
    expect(ids(computeSpatialOrder(same, { order: 'left-right' }))).toEqual(['a', 'b', 'c']);
    expect(ids(computeSpatialOrder(same, { order: 'right-left' }))).toEqual(['a', 'b', 'c']);
  });

  it('a hand order lists ids first, the rest left to right', () => {
    expect(ids(computeSpatialOrder(cross, { order: 'hand', hand: ['B', 'R', 'missing'] }))).toEqual(['B', 'R', 'L', 'T', 'C']);
  });

  it('groups light as one slot at their mean position', () => {
    const spots = [spot('a', 0.1, 0.5, 'g'), spot('b', 0.9, 0.5, 'g'), spot('c', 0.3, 0.5)];
    const o = computeSpatialOrder(spots, { order: 'left-right', groups: true });
    expect(ids(o)).toEqual(['c', 'a+b']);
    expect(o.slotOf.get('b')).toBe(1);
    expect(ids(computeSpatialOrder(spots, { order: 'left-right' }))).toEqual(['a', 'c', 'b']);
  });

  it('piece centres are y down; LED fixtures sit at their mapped centre (ranges each a spot)', () => {
    const layer = {
      id: 'p', name: 'P', type: 'shader', parentGroupId: 'g1',
      corners: { topLeft: { x: 0, y: 1 }, topRight: { x: 0.5, y: 1 }, bottomLeft: { x: 0, y: 0.5 }, bottomRight: { x: 0.5, y: 0.5 } },
      layerShape: null,
    } as unknown as Layer;
    expect(pieceCentre(layer)).toEqual({ x: 0.25, y: 0.25 });
    expect(pieceSpots([layer])[0]).toMatchObject({ id: 'p', group: 'g1', x: 0.25, y: 0.25 });
    const strip = { id: 'c1', name: 'Strip', ledCount: 10, mapping: { mode: 'strip', axis: 'horizontal', sourceRegion: { x: 0.5, y: 0.8, width: 0.5, height: 0.2 } } } as unknown as WLEDController;
    const whole = ledSpots([strip]);
    expect(whole).toHaveLength(1);
    expect(whole[0].id).toBe('led:c1');
    expect(whole[0].x).toBeCloseTo(0.75, 5);
    expect(whole[0].y).toBeCloseTo(0.9, 5);
    const ranged = ledSpots([{ ...strip, ranges: [{ id: 'a', name: 'A', start: 0, count: 5 }, { id: 'b', name: 'B', start: 5, count: 5 }] }]);
    expect(ranged.map((s) => s.id)).toEqual(['led:c1#a', 'led:c1#b']);
    expect(ranged[0].x).toBeLessThan(ranged[1].x);
    expect(parseLedSpotId('led:c1#b')).toEqual({ controllerId: 'c1', rangeId: 'b' });
    expect(parseLedSpotId('p')).toBeNull();
  });
});

describe('where window', () => {
  it('spread 0 hard lights one slot; spread 1 centred lights all', () => {
    expect(Array.from(windowWeights(3, { position: 0.5, spread: 0, soft: 0 }))).toEqual([0, 1, 0]);
    expect(Array.from(windowWeights(3, { position: 0, spread: 0, soft: 0 }))).toEqual([1, 0, 0]);
    expect(Array.from(windowWeights(3, { position: 1, spread: 0, soft: 0 }))).toEqual([0, 0, 1]);
    expect(Array.from(windowWeights(5, { position: 0.5, spread: 1, soft: 0 }))).toEqual([1, 1, 1, 1, 1]);
    expect(Array.from(windowWeights(5, { position: 0.5, spread: 1, soft: 1 }))).toEqual([1, 1, 1, 1, 1]);
  });

  it('a hard edge exactly between two slots gives each half', () => {
    expect(Array.from(windowWeights(3, { position: 0.25, spread: 0, soft: 0 }))).toEqual([0.5, 0.5, 0]);
  });

  it('a soft edge crossfades neighbours (sums to one between them)', () => {
    for (const p of [0, 0.1, 0.25, 0.4, 0.5]) {
      const w = windowWeights(3, { position: p, spread: 0, soft: 1 });
      expect(w[0] + w[1] + w[2]).toBeCloseTo(1, 9);
    }
    const mid = windowWeights(3, { position: 0.25, spread: 0, soft: 1 });
    expect(mid[0]).toBeCloseTo(0.5, 9);
    expect(mid[1]).toBeCloseTo(0.5, 9);
    // softer edge lights a neighbour a little before the window reaches it
    expect(slotWeight(1, 3, { position: 0.1, spread: 0, soft: 1 })).toBeGreaterThan(0);
    expect(slotWeight(1, 3, { position: 0.1, spread: 0, soft: 0 })).toBe(0);
  });

  it('wraps: the last slot neighbours the first and spread 1 lights everything anywhere', () => {
    // centre between slot 3 and slot 0 on a ring of 4
    const w = windowWeights(4, { position: 7 / 8, spread: 0, soft: 1, wrap: true });
    expect(w[3]).toBeCloseTo(0.5, 9);
    expect(w[0]).toBeCloseTo(0.5, 9);
    expect(w[1]).toBe(0);
    expect(Array.from(windowWeights(4, { position: 0.1, spread: 1, soft: 0, wrap: true }))).toEqual([1, 1, 1, 1]);
    // without wrap position is clamped
    expect(Array.from(windowWeights(3, { position: 1.4, spread: 0, soft: 0 }))).toEqual([0, 0, 1]);
    expect(Array.from(windowWeights(1, { position: 0.7, spread: 0, soft: 0 }))).toEqual([1]);
    expect(windowWeights(0, { position: 0, spread: 0, soft: 0 }).length).toBe(0);
  });
});

describe('where motions', () => {
  const ctx = { beatAt: defaultBeatAt };
  const spec = (motion: WhereSpec['motion'], extra: Partial<WhereSpec> = {}): WhereSpec => ({ ...defaultWhere(), motion, wrap: false, ...extra });

  it('sweep: one pass per bar from the block start; reverse runs back', () => {
    // 120 BPM: one bar = 2 s
    expect(whereWindowAt(spec({ kind: 'sweep', bars: 1 }), 10, 10, 3, ctx).position).toBe(0);
    expect(whereWindowAt(spec({ kind: 'sweep', bars: 1 }), 11, 10, 3, ctx).position).toBeCloseTo(0.5, 9);
    expect(whereWindowAt(spec({ kind: 'sweep', bars: 1 }), 12.5, 10, 3, ctx).position).toBeCloseTo(0.25, 9);
    expect(whereWindowAt(spec({ kind: 'sweep', bars: 2, reverse: true }), 11, 10, 3, ctx).position).toBeCloseTo(0.75, 9);
  });

  it('ping-pong goes there and back', () => {
    const at = (t: number) => whereWindowAt(spec({ kind: 'pingpong', bars: 1 }), t, 0, 3, ctx).position;
    expect(at(0)).toBe(0);
    expect(at(1)).toBeCloseTo(0.5, 9);
    expect(at(2)).toBeCloseTo(1, 9);
    expect(at(3)).toBeCloseTo(0.5, 9);
    expect(at(4)).toBeCloseTo(0, 9);
  });

  it('centre burst grows from the middle to everything each cycle', () => {
    const w = (t: number) => whereWindowAt(spec({ kind: 'burst', bars: 1 }), t, 0, 5, ctx);
    expect(w(0)).toMatchObject({ position: 0.5, spread: 0 });
    expect(w(1).spread).toBeCloseTo(0.5, 9);
    expect(w(2).spread).toBeCloseTo(0, 9);
  });

  it('random: deterministic, seeded, never the same piece twice running', () => {
    const run = (seed: number) => Array.from({ length: 40 }, (_, k) => randomSlot(seed, k, 4));
    const a = run(7);
    expect(run(7)).toEqual(a);
    // replayed out of order gives the same picks
    expect([randomSlot(7, 30, 4), randomSlot(7, 3, 4), randomSlot(7, 39, 4)]).toEqual([a[30], a[3], a[39]]);
    for (let k = 1; k < a.length; k++) expect(a[k]).not.toBe(a[k - 1]);
    expect(new Set(a).size).toBe(4);
    expect(run(8)).not.toEqual(a);
    // beat vs bar
    const pos = (t: number, every: 'beat' | 'bar') => whereWindowAt(spec({ kind: 'random', every, seed: 7 }), t, 0, 4, ctx).position;
    expect(pos(0.6, 'beat')).toBeCloseTo(a[1] / 3, 9);
    expect(pos(0.6, 'bar')).toBeCloseTo(a[0] / 3, 9);
    expect(pos(2.1, 'bar')).toBeCloseTo(a[1] / 3, 9);
  });

  it('follow kick: one step per kick from the block start; beats without a song', () => {
    const kicks = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0];
    const at = (t: number) => whereWindowAt(spec({ kind: 'kick' }), t, 1.0, 3, { ...ctx, kicks }).position;
    expect(at(0.9)).toBe(0);
    expect(at(1.0)).toBe(0);
    expect(at(1.6)).toBeCloseTo(0.5, 9);
    expect(at(2.1)).toBe(1);
    expect(at(2.6)).toBe(0);
    expect(whereWindowAt(spec({ kind: 'kick' }), 1.0, 0, 3, ctx).position).toBe(1); // 2 beats
    expect(countKicks(kicks, 1, 2)).toBe(3);
    const env = new Float32Array([0, 0.9, 0.6, 0.1, 0.8, 0.4, 0.3, 0.2, 0.7]);
    expect(kickOnsets(env, 10, 5)).toEqual([5.1, 5.4, 5.8]);
  });

  it('drawn: the block lines win; resting values otherwise', () => {
    const s = spec({ kind: 'drawn' }, { position: 0.3, spread: 0.2, soft: 0.1 });
    expect(whereWindowAt(s, 5, 0, 3, ctx)).toMatchObject({ position: 0.3, spread: 0.2, soft: 0.1 });
    expect(whereWindowAt(s, 5, 0, 3, ctx, { position: 0.9, spread: 0, soft: 1 })).toMatchObject({ position: 0.9, spread: 0, soft: 1 });
  });

  it('each motion is a pure function of time (scrub = play)', () => {
    const motions: WhereSpec['motion'][] = [{ kind: 'sweep', bars: 1 }, { kind: 'pingpong', bars: 2 }, { kind: 'burst', bars: 1 }, { kind: 'random', every: 'beat', seed: 3 }, { kind: 'kick' }];
    const kicks = Array.from({ length: 50 }, (_, i) => i * 0.37);
    for (const m of motions) {
      const times = Array.from({ length: 60 }, (_, i) => i * 0.29);
      const forward = times.map((t) => whereWindowAt(spec(m), t, 0, 5, { ...ctx, kicks }));
      const shuffled = [...times].reverse().map((t) => whereWindowAt(spec(m), t, 0, 5, { ...ctx, kicks })).reverse();
      expect(shuffled).toEqual(forward);
    }
  });
});

describe('where model', () => {
  it('normalizes, keeps named orders and resolves them', () => {
    expect(normalizeWhere(null)).toBeNull();
    const w = normalizeWhere({ order: 'nope', members: 'both', motion: { kind: 'random', every: 'bar', seed: -5 }, spread: 4, soft: -1, wrap: true, hand: ['a', 'a', 3, 'b'], namedOrder: 'n1' })!;
    expect(w).toMatchObject({ order: 'left-right', members: 'both', motion: { kind: 'random', every: 'bar', seed: 5 }, spread: 1, soft: 0, wrap: true, hand: ['a', 'b'], namedOrder: 'n1' });
    const named = normalizeNamedOrders([{ id: 'n1', name: 'Facade', order: 'hand', hand: ['x', 'y'] }, { id: 'n1' }, {}]);
    expect(named).toHaveLength(1);
    expect(resolveOrderSpec(w, named)).toMatchObject({ order: 'hand', hand: ['x', 'y'] });
    expect(resolveOrderSpec({ ...w, namedOrder: 'gone' }, named).order).toBe('left-right');
  });

  it('evaluates across pieces and LEDs together', () => {
    const spots: WhereSpot[] = [spot('A', 0.1, 0.5), spot('B', 0.5, 0.5), { id: 'led:s', kind: 'led', x: 0.9, y: 0.9, label: 's' }];
    const spec: WhereSpec = { ...defaultWhere('both'), motion: { kind: 'drawn' }, soft: 0, wrap: false };
    const at = (position: number) => evaluateWhere({ spec, spots, time: 0, start: 0, ctx: { beatAt: defaultBeatAt }, lines: { position } }).weights;
    expect([...at(0)]).toEqual([['A', 1]]);
    expect([...at(1)]).toEqual([['led:s', 1]]);
    const piecesOnly = evaluateWhere({ spec: { ...spec, members: 'pieces' }, spots, time: 0, start: 0, ctx: { beatAt: defaultBeatAt }, lines: { position: 1 } });
    expect([...piecesOnly.weights]).toEqual([['B', 1]]);
    const scoped = evaluateWhere({ spec, spots, pieces: new Set(['B']), time: 0, start: 0, ctx: { beatAt: defaultBeatAt }, lines: { position: 0 } });
    expect([...scoped.weights]).toEqual([['B', 1]]);
  });
});

describe('given slots, reveal (Auto show orders and sets)', () => {
  const row = [spot('a', 0.1, 0.5), spot('b', 0.3, 0.5), spot('c', 0.5, 0.5), spot('d', 0.7, 0.5)];

  it('a named order can be its own slots: sets that light together, only the listed pieces', () => {
    const order = computeSpatialOrder(row, { order: 'left-right', slots: [['c', 'a'], ['d'], ['gone']] });
    expect(order.slots).toEqual([['c', 'a'], ['d']]);
    expect(order.slotOf.get('a')).toBe(0);
    expect(order.slotOf.has('b')).toBe(false);
    // Saved and opened again as it was (empty and repeated ids dropped).
    const [named] = normalizeNamedOrders([{ id: 'set', name: 'Set A', order: 'left-right', slots: [['a', 'a', 'c'], [], ['d', 7]] }]);
    expect(named.slots).toEqual([['a', 'c'], ['d']]);
    // Two sets swapping each beat: a sweep over two slots, one lit.
    const spec = normalizeWhere({ namedOrder: 'set', motion: { kind: 'sweep', bars: 0.5 }, spread: 0, soft: 0 })!;
    const lit = (t: number) => [...evaluateWhere({ spec, named: [named], spots: row, time: t, start: 0, ctx: { beatAt: defaultBeatAt } }).weights.entries()].filter(([, w]) => w >= 0.99).map(([id]) => id).sort();
    expect(lit(0.1)).toEqual(['a', 'c']);
    expect(lit(0.6)).toEqual(['d']);
    expect(lit(1.1)).toEqual(['a', 'c']);
  });

  it('reveal: pieces light one after another over the bars, then stay; reversed they go dark in turn', () => {
    const at = (t: number, reverse = false) => {
      const w = whereWindowAt({ motion: { kind: 'reveal', bars: 2, ...(reverse ? { reverse: true } : {}) }, position: 0, spread: 0, soft: 0 }, t, 0, 4, { beatAt: defaultBeatAt });
      return [0, 1, 2, 3].map((i) => (slotWeight(i, 4, w) >= 0.5 ? 1 : 0));
    };
    // 2 bars at 120 BPM = 4 s.
    expect(at(0)).toEqual([1, 0, 0, 0]);
    // Half-way: 2.5 of 4 lit (the half-lit third sits on the window's edge).
    expect(at(2)).toEqual([1, 1, 1, 0]);
    expect(at(4.5)).toEqual([1, 1, 1, 1]);
    expect(at(0, true)).toEqual([1, 1, 1, 1]);
    expect(at(4.5, true)).toEqual([0, 0, 0, 1]);
    expect(normalizeWhere({ motion: { kind: 'reveal', bars: 8, reverse: true } })!.motion).toEqual({ kind: 'reveal', bars: 8, reverse: true });
    expect(normalizeWhere({ dark: true, span: true })).toMatchObject({ dark: true, span: true });
    expect(normalizeWhere({})).not.toHaveProperty('dark');
  });
});

describe('steps motion (a step grid, like the Sequencer)', () => {
  const spots = [spot('A', 0.1, 0.5), spot('B', 0.5, 0.5), spot('C', 0.9, 0.5)];
  // defaultBeatAt: 120 BPM, so a quarter-note step is half a second.
  const spec: WhereSpec = { ...defaultWhere('pieces'), motion: { kind: 'steps', per: 1, steps: [[0], [1, 2], []] } };
  const lit = (time: number, start = 0) => [...evaluateWhere({ spec, spots, time, start, ctx: { beatAt: defaultBeatAt } }).weights.keys()].sort();

  it('lights the slots each step names, a step every `per` quarter notes, looping', () => {
    expect(lit(0.1)).toEqual(['A']);
    expect(lit(0.6)).toEqual(['B', 'C']);
    expect(lit(1.1)).toEqual([]);
    expect(lit(1.6)).toEqual(['A']);
  });

  it('counts steps from the block start', () => {
    expect(lit(10.1, 10)).toEqual(['A']);
    expect(lit(10.6, 10)).toEqual(['B', 'C']);
  });

  it('ignores slots past the order and keeps its steps through a save', () => {
    expect(stepWeights({ kind: 'steps', per: 1, steps: [[0, 7]] }, 0, 0, 2, { beatAt: defaultBeatAt })).toEqual([1, 0]);
    expect(stepWeights({ kind: 'sweep', bars: 1 }, 0, 0, 2, { beatAt: defaultBeatAt })).toBeNull();
    expect(normalizeWhere(JSON.parse(JSON.stringify(spec)))?.motion).toEqual(spec.motion);
    expect(normalizeWhere({ motion: { kind: 'steps', per: 99, steps: [[2, 2, -1, 'x', 1.5, 0], 'junk'] } })?.motion)
      .toEqual({ kind: 'steps', per: 16, steps: [[0, 2], []] });
    expect(normalizeWhere({ motion: { kind: 'steps' } })?.motion).toEqual({ kind: 'steps', per: 1, steps: [[0]] });
  });
});
