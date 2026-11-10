/**
 * The Timeline's sound rows in the tray: how tall each row is (its strip
 * plus its control lines) and what the rows are, for the header column and
 * the grid to draw the same stack.
 */
import { derived, type Readable } from 'svelte/store';
import { soundRowsFor, type SoundRow } from '../../../../timeline/sound/soundModel';
import { lineLayout, soundLineGroup } from '../lineUi';
import { showSlice } from '../timelineSlices';

export const SOUND_ROW_HEIGHT = 52;
/** The "+ Sound row / + Live row" strip under the rows. */
export const SOUND_FOOTER_HEIGHT = 26;

export interface SoundRowsLayout {
  rows: SoundRow[];
  /** Each row's strip + lines. */
  heights: number[];
  /** Top of each row in the stack. */
  tops: number[];
  /** Lines height under each row. */
  lineHeights: number[];
  total: number;
}

export function computeSoundLayout(rows: SoundRow[], lineHeight: (rowId: string) => number): SoundRowsLayout {
  const heights: number[] = [];
  const tops: number[] = [];
  const lineHeights: number[] = [];
  let y = 0;
  for (const row of rows) {
    const lh = lineHeight(row.id);
    tops.push(y);
    lineHeights.push(lh);
    heights.push(SOUND_ROW_HEIGHT + lh);
    y += SOUND_ROW_HEIGHT + lh;
  }
  return { rows, heights, tops, lineHeights, total: y + SOUND_FOOTER_HEIGHT };
}

/** The row under a y inside the stack (clamped), or -1 above it. */
export function soundRowAt(layout: Pick<SoundRowsLayout, 'tops' | 'heights'>, y: number): number {
  if (y < 0 || !layout.tops.length) return -1;
  for (let i = layout.tops.length - 1; i >= 0; i--) if (y >= layout.tops[i]) return i;
  return 0;
}

export const soundLayout: Readable<SoundRowsLayout> = derived(
  [showSlice('sound'), showSlice('audioTracks'), lineLayout],
  ([sound, tracks, layout]) => computeSoundLayout(soundRowsFor(sound, tracks), (id) => layout.heights.get(soundLineGroup(id)) ?? 0),
);

/** 0xRRGGBB → css. */
export function liveColor(color: number): string {
  return `#${(color & 0xffffff).toString(16).padStart(6, '0')}`;
}
