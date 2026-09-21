import { describe, expect, it } from 'vitest';
import { normalizeVJGroups, removeVJGroupRow } from './vjGroups';
const group = (id: string, first: number, last: number) => ({ id, first, last, name: id, opacity: 1, blendMode: 'normal', effects: [] });
describe('VJ group membership', () => {
  it('rejects overlapping, duplicate and invalid ranges on restore', () => {
    expect(normalizeVJGroups([group('a', 0, 1), group('b', 1, 2), group('a', 2, 3), group('c', 2, 3), group('d', -1, 0)], 4).map(g => g.id)).toEqual(['a', 'c']);
  });
  it('keeps membership aligned when deleting rows above or inside a group', () => {
    expect(removeVJGroupRow([group('a', 1, 3)], 0, 3)[0]).toMatchObject({ first: 0, last: 2 });
    expect(removeVJGroupRow([group('a', 1, 3)], 2, 3)[0]).toMatchObject({ first: 1, last: 2 });
    expect(removeVJGroupRow([group('a', 1, 1)], 1, 3)).toEqual([]);
  });
});
