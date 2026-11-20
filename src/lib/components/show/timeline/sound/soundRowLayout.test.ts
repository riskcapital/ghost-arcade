import { describe, expect, it } from 'vitest';
import { computeSoundLayout, songDropTime } from './soundRowLayout';
import type { SoundRow } from '../../../../timeline/sound/soundModel';

const rows = [{ id: 'a', kind: 'audio' }, { id: 'b', kind: 'audio' }] as unknown as SoundRow[];

describe('where a dropped song lands', () => {
  it('on the empty Timeline\'s "Drop audio here" card: at 0, wherever the pointer is', () => {
    const empty = computeSoundLayout(rows, () => 0, true);
    expect(empty.empty).toBe(true);
    expect(songDropTime(empty, 0, 28.25)).toBe(0);
  });

  it('on a row with audio, or another row: where it was dropped', () => {
    const full = computeSoundLayout(rows, () => 0, false);
    expect(songDropTime(full, 0, 28.25)).toBe(28.25);
    expect(songDropTime(computeSoundLayout(rows, () => 0, true), 1, 12)).toBe(12);
  });
});
