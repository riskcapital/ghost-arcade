import { describe, it, expect } from 'vitest';
import { HISTORY_DEPTH, popSnapshot, pushSnapshot } from './editorHistory';

describe('editor undo history', () => {
  it('stores a deep copy so later edits do not change the snapshot', () => {
    const scene = { surfaces: [{ x: 1 }] };
    const entries = pushSnapshot([], scene);
    scene.surfaces[0].x = 2;
    expect(entries).toEqual([{ surfaces: [{ x: 1 }] }]);
  });

  it('pops the newest snapshot first and leaves the input list alone', () => {
    const entries = pushSnapshot(pushSnapshot([], { n: 1 }), { n: 2 });
    const { entries: rest, snapshot } = popSnapshot(entries);
    expect(snapshot).toEqual({ n: 2 });
    expect(rest).toEqual([{ n: 1 }]);
    expect(entries).toHaveLength(2);
  });

  it('returns no snapshot when there is nothing to undo', () => {
    const empty: { n: number }[] = [];
    expect(popSnapshot(empty)).toEqual({ entries: empty, snapshot: undefined });
  });

  it('keeps only the newest entries up to the depth', () => {
    let entries: { n: number }[] = [];
    for (let n = 0; n < HISTORY_DEPTH + 5; n++) entries = pushSnapshot(entries, { n });
    expect(entries).toHaveLength(HISTORY_DEPTH);
    expect(entries[0]).toEqual({ n: 5 });
    expect(entries.at(-1)).toEqual({ n: HISTORY_DEPTH + 4 });
  });
});
