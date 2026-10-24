import { describe, expect, it } from 'vitest';
import { mergeClipGrids } from './vjBlockMerge';

const c = (id: string) => ({ id });
const ids = (grid: ({ id: string } | null)[][]) => grid.map((row) => row.map((clip) => clip?.id ?? '.').join(' '));

describe('merging VJ blocks', () => {
  it('puts clips in the same cell, or the first free cell of their row', () => {
    const target = [[c('a'), null, null], [null, null, null]];
    const source = [[c('x'), c('y'), null], [null, c('z'), null]];
    const merged = mergeClipGrids(target, source);
    expect(ids(merged.grid)).toEqual(['a y x', '. z .']);
    expect(merged.moved).toBe(3);
    expect(merged.leftOver).toBe(0);
    expect(ids(merged.rest)).toEqual(['. . .', '. . .']);
    // The inputs are not changed.
    expect(ids(target)).toEqual(['a . .', '. . .']);
  });

  it('does not add a clip the row already holds (a duplicated block)', () => {
    const shared = c('s');
    const merged = mergeClipGrids([[shared, null]], [[null, shared]]);
    expect(ids(merged.grid)).toEqual(['s .']);
    expect(merged.moved).toBe(0);
  });

  it('leaves clips with no free cell behind', () => {
    const merged = mergeClipGrids([[c('a'), c('b')]], [[c('x'), c('y')]]);
    expect(ids(merged.grid)).toEqual(['a b']);
    expect(merged.leftOver).toBe(2);
    expect(ids(merged.rest)).toEqual(['x y']);
  });
});
