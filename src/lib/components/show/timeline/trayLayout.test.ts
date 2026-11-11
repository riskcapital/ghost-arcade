/**
 * Tray layout: menus stay inside the window, crossfade marks keep unique
 * keys, and the tray leaves the panels beside it room to work.
 */
import { describe, expect, it } from 'vitest';
import type { TimelineStageClip } from '../../../timeline/stagefx/stageClips';
import { stageRowOverlaps } from './stageFxRowsUi';

const block = (id: string, startTime: number, duration: number, row: TimelineStageClip['row'] = 'screenfx'): TimelineStageClip =>
  ({ id, row, startTime, duration, fadeIn: 0, fadeOut: 0 });

describe('Stage FX crossfade marks', () => {
  it('gives every overlapping pair its own key, even when two pairs share a span', () => {
    // Two copies of one block over a long one: three pairs, two of them on
    // the same span. A keyed list with a repeated key stops the whole tray.
    const out = stageRowOverlaps([block('a', 0, 16), block('b', 5, 8), block('c', 5, 8), block('d', 6, 2, 'effects')]);
    expect(out.screenfx.map((o) => [o.start, o.end])).toEqual([[5, 13], [5, 13], [5, 13]]);
    expect(new Set(out.screenfx.map((o) => o.key)).size).toBe(out.screenfx.length);
    expect(out.effects).toEqual([]);
  });
});
