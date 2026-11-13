import { describe, expect, it } from 'vitest';
import type { ControlLine } from './lineModel';
import {
  copyKeys, deleteKeys, keyMoments, keysBetween, keysToRefs, pasteKeys, refsToKeys, shiftKeys, unionKeys,
} from './keyEdit';

const line = (id: string, times: number[], target: ControlLine['target'] = { scope: 'layer', id: 'piece' }, key = `k-${id}`): ControlLine => ({
  id, target, key, kind: 'continuous', min: 0, max: 1, step: 0.01, default: 0, label: id,
  points: times.map((t, i) => ({ t, v: i / 10 })),
});

describe('keys edited as a set', () => {
  const lines = [line('a', [0, 2, 4]), line('b', [1, 2, 6])];

  it('moves keys on several lines together, keeping their spacing at 0', () => {
    const moved = shiftKeys(lines, [{ lineId: 'a', t: 2 }, { lineId: 'b', t: 6 }], 1.5);
    expect(moved.lines[0].points.map((p) => p.t)).toEqual([0, 3.5, 4]);
    expect(moved.lines[1].points.map((p) => p.t)).toEqual([1, 2, 7.5]);
    expect(moved.keys).toEqual([{ lineId: 'a', t: 3.5 }, { lineId: 'b', t: 7.5 }]);
    // Stops at 0 as a set: the earliest key reaches 0, the others keep their distance.
    const back = shiftKeys(lines, [{ lineId: 'a', t: 2 }, { lineId: 'b', t: 6 }], -10);
    expect(back.lines[0].points.map((p) => p.t)).toEqual([0, 4]);
    expect(back.lines[1].points.map((p) => p.t)).toEqual([1, 2, 4]);
  });

  it('a moved key replaces an unmoved one at the same moment', () => {
    const moved = shiftKeys(lines, [{ lineId: 'a', t: 2 }], 2);
    expect(moved.lines[0].points.map((p) => p.t)).toEqual([0, 4]);
    expect(moved.lines[0].points[1].v).toBe(0.1);
  });

  it('deletes keys across lines and leaves other lines untouched', () => {
    const out = deleteKeys(lines, [{ lineId: 'a', t: 0 }, { lineId: 'b', t: 2 }]);
    expect(out[0].points.map((p) => p.t)).toEqual([2, 4]);
    expect(out[1].points.map((p) => p.t)).toEqual([1, 6]);
    expect(deleteKeys(lines, [])).toBe(lines);
  });

  it('finds keys in a span, on chosen lines', () => {
    expect(keysBetween(lines, 2, 6).length).toBe(4);
    expect(keysBetween(lines, 2, 6, new Set(['b']))).toEqual([{ lineId: 'b', t: 2 }, { lineId: 'b', t: 6 }]);
  });

  it('round-trips between index selections and keys, dropping stale ones', () => {
    const keys = refsToKeys(lines, [{ lineId: 'a', points: [1, 2], of: lines[0].points }]);
    expect(keys).toEqual([{ lineId: 'a', t: 2 }, { lineId: 'a', t: 4 }]);
    expect(refsToKeys(lines, [{ lineId: 'a', points: [1], of: [] }])).toEqual([]);
    expect(keysToRefs(lines, keys)).toEqual([{ lineId: 'a', points: [1, 2], of: lines[0].points }]);
  });

  it('copies relative to the earliest key and pastes at a time', () => {
    const clip = copyKeys(lines, [{ lineId: 'a', t: 2 }, { lineId: 'b', t: 6 }])!;
    expect(clip.items.map((i) => i.points.map((p) => p.t))).toEqual([[0], [4]]);
    const pasted = pasteKeys(lines, clip, 10);
    expect(pasted.lines[0].points.map((p) => p.t)).toEqual([0, 2, 4, 10]);
    expect(pasted.lines[1].points.map((p) => p.t)).toEqual([1, 2, 6, 14]);
    expect(pasted.keys).toEqual([{ lineId: 'a', t: 10 }, { lineId: 'b', t: 14 }]);
  });

  it('pastes onto the same parameter when the copied line is gone', () => {
    const clip = copyKeys(lines, [{ lineId: 'a', t: 4 }])!;
    const other = [line('a2', [0], { scope: 'layer', id: 'piece' }, 'k-a')];
    const pasted = pasteKeys(other, clip, 3);
    expect(pasted.lines[0].points.map((p) => p.t)).toEqual([0, 3]);
  });

  it('merges keys closer than a few pixels into one moment', () => {
    const near = [line('a', [1, 1.01, 3]), line('b', [1.005])];
    const moments = keyMoments(near, 0, 10, 100);
    expect(moments.map((m) => m.keys.length)).toEqual([3, 1]);
    expect(unionKeys([{ lineId: 'a', t: 1 }], [{ lineId: 'a', t: 1 }, { lineId: 'b', t: 2 }]).length).toBe(2);
  });
});
