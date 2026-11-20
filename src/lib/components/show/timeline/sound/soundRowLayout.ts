/**
 * The Timeline's sound rows in the tray: how tall each row is (its strip
 * plus its control lines) and what the rows are, for the header column and
 * the grid to draw the same stack.
 */
import { derived, type Readable } from 'svelte/store';
import { soundRowsFor, type SoundRow } from '../../../../timeline/sound/soundModel';
import { lineLayout, soundLineGroup } from '../lineUi';
import { showSlice } from '../timelineSlices';

/** The first audio row (the song, with its waveform). */
export const SOUND_ROW_HEIGHT = 56;
/** Every other audio row. */
export const SOUND_ROW_HEIGHT_SM = 40;
/** The empty Audio row: a card that takes the first song. */
export const SOUND_EMPTY_HEIGHT = 112;
/** Nothing under the rows any more: "+ Row" adds audio and Ableton clips rows. */
export const SOUND_FOOTER_HEIGHT = 0;

/** A row's own strip (without its lines). */
export function soundStripHeight(index: number, empty = false): number {
  if (index === 0) return empty ? SOUND_EMPTY_HEIGHT : SOUND_ROW_HEIGHT;
  return SOUND_ROW_HEIGHT_SM;
}

export interface SoundRowsLayout {
  rows: SoundRow[];
  /** Each row's strip + lines. */
  heights: number[];
  /** Each row's own strip. */
  strips: number[];
  /** The show has no audio yet: the first row is the "Drop audio here" card. */
  empty: boolean;
  /** Top of each row in the stack. */
  tops: number[];
  /** Lines height under each row. */
  lineHeights: number[];
  total: number;
}

export function computeSoundLayout(rows: SoundRow[], lineHeight: (rowId: string) => number, empty = false): SoundRowsLayout {
  const heights: number[] = [];
  const strips: number[] = [];
  const tops: number[] = [];
  const lineHeights: number[] = [];
  const isEmpty = empty && rows.length > 0 && rows[0].kind === 'audio';
  let y = 0;
  rows.forEach((row, i) => {
    const lh = lineHeight(row.id);
    const strip = soundStripHeight(i, isEmpty);
    tops.push(y);
    lineHeights.push(lh);
    strips.push(strip);
    heights.push(strip + lh);
    y += strip + lh;
  });
  return { rows, heights, strips, tops, lineHeights, empty: isEmpty, total: y + SOUND_FOOTER_HEIGHT };
}

/** The row under a y inside the stack (clamped), or -1 above it. */
export function soundRowAt(layout: Pick<SoundRowsLayout, 'tops' | 'heights'>, y: number): number {
  if (y < 0 || !layout.tops.length) return -1;
  for (let i = layout.tops.length - 1; i >= 0; i--) if (y >= layout.tops[i]) return i;
  return 0;
}

export const soundLayout: Readable<SoundRowsLayout> = derived(
  [showSlice('sound'), showSlice('audioTracks'), lineLayout],
  ([sound, tracks, layout]) => computeSoundLayout(
    soundRowsFor(sound, tracks),
    (id) => layout.heights.get(soundLineGroup(id)) ?? 0,
    tracks.length === 0 && !(sound?.builds?.length),
  ),
);

/** 0xRRGGBB → css. */
export function liveColor(color: number): string {
  return `#${(color & 0xffffff).toString(16).padStart(6, '0')}`;
}

/**
 * Where a dropped song lands: on the empty Timeline's first row (the "Drop
 * audio here" card) at 0, as "Choose audio…" on the same card does; on a row
 * that already has audio, where it was dropped.
 */
export function songDropTime(layout: Pick<SoundRowsLayout, 'empty'>, rowIndex: number, pointerTime: number): number {
  return layout.empty && rowIndex === 0 ? 0 : Math.max(0, pointerTime);
}
