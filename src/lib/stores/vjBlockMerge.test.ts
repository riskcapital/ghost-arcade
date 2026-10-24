import { describe, expect, it } from 'vitest';
import { mergeBlockGrids } from './vjBlockMerge';

const c = (id: string) => ({ id });
type G = ({ id: string } | null)[][];
const ids = (grid: G) => grid.map((row) => row.map((clip) => clip?.id ?? '.').join(' '));
const empty = (rows: number, cols: number): G => Array.from({ length: rows }, () => Array(cols).fill(null));
const full = (prefix: string, rows: number, cols: number): G =>
  Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, k) => c(`${prefix}${r}${k}`)));

describe('merging VJ blocks', () => {
  it('puts the other block\'s columns after the ones in use, growing the grid', () => {
    const merged = mergeBlockGrids({
      targetA: full('a', 2, 3), targetB: empty(2, 3),
      sourceA: full('b', 2, 3), sourceB: empty(2, 3),
      maxColumns: 64,
    });
    expect(merged.columns).toBe(6);
    expect(ids(merged.gridA)).toEqual(['a00 a01 a02 b00 b01 b02', 'a10 a11 a12 b10 b11 b12']);
    expect(merged.moved).toBe(6);
    expect(merged.leftOver).toBe(0);
  });

  it('keeps each column a scene and both decks lined up', () => {
    // Target uses column 0 on deck A only; source uses columns 1 and 3,
    // column 3 only on deck B.
    const targetA = [[c('t'), null, null, null]];
    const sourceA = [[null, c('x'), null, null]];
    const sourceB = [[null, c('y'), null, c('z')]];
    const merged = mergeBlockGrids({ targetA, targetB: empty(1, 4), sourceA, sourceB, maxColumns: 64 });
    expect(merged.columns).toBe(4);
    expect(ids(merged.gridA)).toEqual(['t x . .']);
    expect(ids(merged.gridB)).toEqual(['. y z .']);
  });

  it('does not add a clip the row already holds (a duplicated block)', () => {
    const shared = c('s');
    const merged = mergeBlockGrids({
      targetA: [[shared, null]], targetB: empty(1, 2),
      sourceA: [[shared, c('n')]], sourceB: empty(1, 2), maxColumns: 64,
    });
    expect(ids(merged.gridA)).toEqual(['s . n']);
    expect(merged.moved).toBe(1);
  });

  it('stops at the column limit and leaves the rest where it was', () => {
    const merged = mergeBlockGrids({
      targetA: full('a', 1, 3), targetB: empty(1, 3),
      sourceA: full('b', 1, 3), sourceB: empty(1, 3), maxColumns: 4,
    });
    expect(merged.columns).toBe(4);
    expect(ids(merged.gridA)).toEqual(['a00 a01 a02 b00']);
    expect(merged.leftOver).toBe(2);
    expect(ids(merged.restA)).toEqual(['. b01 b02 .']);
  });
});
