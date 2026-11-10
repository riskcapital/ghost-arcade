/**
 * Geometry and session state shared by the show's track headers (in the
 * label column) and track lanes (in the scrolling grid). Both draw from the
 * same row heights, so a header always lines up with its lane.
 */
import { writable } from 'svelte/store';
import type { KeyframeTrack, ShowLayerClip, ShowLayerTrack } from '../../../types';
import { lineRowsHeight, type LineLayout } from './lineUi';

/** The part of a clip block a press grabbed. */
export type ClipPart = 'body' | 'start' | 'end' | 'fadeIn' | 'fadeOut';

export const TRACK_ROW_HEIGHT = 44;
export const LANE_ROW_HEIGHT = 30;
/** The row under the rows (the stage camera lane button, a hint). */
export const ADD_TRACK_ROW_HEIGHT = 28;
/** Label column width once the show has tracks (headers need the room). */
export const TRACK_HEADER_WIDTH = 204;

type RowShape = Pick<ShowLayerTrack, 'collapsed' | 'lanes' | 'row'> & { id?: string };

/** Height of one track: its clip row, plus its control lines when unfolded;
 *  nothing inside a folded group. */
export function trackHeight(track: RowShape, layout?: LineLayout): number {
  if (track.row?.hidden) return 0;
  if (track.collapsed) return TRACK_ROW_HEIGHT;
  const lines = track.id ? (layout ? layout.heights.get(track.id) ?? 0 : lineRowsHeight(track.id)) : 0;
  return TRACK_ROW_HEIGHT + track.lanes.length * LANE_ROW_HEIGHT + lines;
}

/** A row's colour: its own, or one picked from the piece's id so a piece
 *  keeps its colour wherever it shows. */
const ROW_COLORS = ['#8b7cff', '#5ce1e6', '#f0c674', '#5fdc76', '#ff6f5e', '#c77dff', '#5278ff', '#ff9f43'];
export function rowColor(track: Pick<ShowLayerTrack, 'color' | 'layerId'>): string {
  if (track.color) return track.color;
  let h = 0;
  for (let i = 0; i < track.layerId.length; i++) h = (h * 31 + track.layerId.charCodeAt(i)) | 0;
  return ROW_COLORS[Math.abs(h) % ROW_COLORS.length];
}

/** Stretches of [from, to) where a row shows nothing: its piece is hidden
 *  there (between blocks, or the whole row when its eye is closed). Only
 *  rows that hide do; a row without blocks follows the look. */
export function hiddenSpans(track: Pick<ShowLayerTrack, 'clips' | 'gap' | 'muted'>, from: number, to: number): Array<{ start: number; end: number }> {
  if (to <= from) return [];
  if (track.muted) return [{ start: from, end: to }];
  if (track.gap !== 'hide' || track.clips.length === 0) return [];
  const out: Array<{ start: number; end: number }> = [];
  let cursor = from;
  for (const c of track.clips) {
    const end = c.startTime + c.duration;
    if (end <= cursor) continue;
    if (c.startTime >= to) break;
    if (c.startTime > cursor) out.push({ start: cursor, end: Math.min(c.startTime, to) });
    cursor = Math.max(cursor, end);
  }
  if (cursor < to) out.push({ start: cursor, end: to });
  return out;
}

export function tracksStackHeight(tracks: readonly RowShape[], layout?: LineLayout): number {
  let h = ADD_TRACK_ROW_HEIGHT;
  for (const t of tracks) h += trackHeight(t, layout);
  return h;
}

/** Top of each track inside the stack. */
export function trackTops(tracks: readonly RowShape[], layout?: LineLayout): number[] {
  const tops: number[] = [];
  let y = 0;
  for (const t of tracks) {
    tops.push(y);
    y += trackHeight(t, layout);
  }
  return tops;
}

/** Index of the track whose rows contain `y` (stack coordinates), clamped
 *  to the list; -1 for an empty list. */
export function trackIndexAt(tracks: readonly RowShape[], y: number): number {
  if (!tracks.length) return -1;
  let top = 0;
  let last = -1;
  for (let i = 0; i < tracks.length; i++) {
    const h = trackHeight(tracks[i]);
    if (h > 0) last = i;
    if (y < top + h) return i;
    top += h;
  }
  return last >= 0 ? last : tracks.length - 1;
}

/**
 * How many rows a dragged selection moves: the row under the pointer less
 * the grabbed clip's row, held so every selected clip (rows `minIndex` to
 * `maxIndex`) stays on the track list. A selection spread over several
 * tracks stops at the edge instead of being refused there, which froze the
 * whole drag (sideways too).
 */
export function dragRowOffset(row: number, grabbedIndex: number, minIndex: number, maxIndex: number, count: number): number {
  return Math.max(-minIndex, Math.min(count - 1 - maxIndex, row - grabbedIndex));
}

/** The modifier that adds to (or takes from) a selection. Cmd/Ctrl is
 *  "move without snapping" across the app, so it never also selects. */
export function addsToSelection(e: Pick<MouseEvent, 'shiftKey'>): boolean {
  return e.shiftKey;
}

/** Cmd/Ctrl held: move or trim without snapping. */
export function movesFreely(e: Pick<MouseEvent, 'metaKey' | 'ctrlKey'>): boolean {
  return e.metaKey || e.ctrlKey;
}

/** Width of a clip's trim handles. The middle half of a short clip is
 *  always its body, so a clip of a few pixels can still be moved. */
export function trimEdgeWidth(clipWidth: number): number {
  return Math.max(1, Math.min(7, Math.floor(clipWidth / 4)));
}

/**
 * Clips overlapping [t0, t1] in a start-sorted, non-overlapping list. Only
 * these are drawn, so a long show costs what is on screen.
 */
export function clipsInView<T extends Pick<ShowLayerClip, 'startTime' | 'duration'>>(clips: readonly T[], t0: number, t1: number): T[] {
  let lo = 0;
  let hi = clips.length;
  // First clip whose end is after t0.
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (clips[mid].startTime + clips[mid].duration <= t0) lo = mid + 1;
    else hi = mid;
  }
  const out: T[] = [];
  for (let i = lo; i < clips.length && clips[i].startTime <= t1; i++) out.push(clips[i]);
  return out;
}

/**
 * Where to draw a snap guide after a drag step: the edge of the dragged
 * item that sits exactly on a magnetic target, or (when snapping moved it
 * off the pointer) on the grid. Null when nothing snapped.
 */
export function snapGuideAt(
  edges: { start: number; end?: number },
  targets: readonly number[],
  raw: number,
  snapped: number,
): number | null {
  const on = (t: number) => targets.some((x) => Math.abs(x - t) < 1e-6);
  if (on(edges.start)) return edges.start;
  if (edges.end !== undefined && on(edges.end)) return edges.end;
  if (Math.abs(raw - snapped) > 1e-6) return edges.start;
  return null;
}

/** Where a lane's value sits vertically: 0 at the bottom, 1 at the top. */
export function laneValueToY(value: number, min: number, max: number, height: number, pad = 4): number {
  const span = max - min || 1;
  const f = Math.max(0, Math.min(1, (value - min) / span));
  return pad + (1 - f) * (height - pad * 2);
}

export function laneYToValue(y: number, min: number, max: number, height: number, pad = 4): number {
  const inner = Math.max(1, height - pad * 2);
  const f = Math.max(0, Math.min(1, 1 - (y - pad) / inner));
  return min + f * (max - min);
}

/** A lane's range from its key (opacity and toggles are 0..1). */
export function laneRange(lane: Pick<KeyframeTrack, 'key' | 'type'>, known?: { min?: number; max?: number }): { min: number; max: number } {
  if (lane.type === 'boolean') return { min: 0, max: 1 };
  if (known && Number.isFinite(known.min) && Number.isFinite(known.max) && known.max! > known.min!) return { min: known.min!, max: known.max! };
  return { min: 0, max: 1 };
}

// ── Session state (not part of the show) ───────────────────────────────

/** Show time of the snap guide being drawn, or null. */
export const showSnapGuide = writable<number | null>(null);

/** The track keys and paste land on when the clipboard has no track of its own. */
export const focusedTrackId = writable<string | null>(null);

/** Selected keys on one lane. */
export interface LaneKeySelection {
  trackId: string;
  key: string;
  times: number[];
}
export const laneKeySelection = writable<LaneKeySelection | null>(null);

/** Clips on the clipboard, grouped by the track they were copied from. */
export interface TrackClipboard {
  groups: Array<{ trackId: string; clips: ShowLayerClip[] }>;
}
let clipboard: TrackClipboard | null = null;
export function setTrackClipboard(next: TrackClipboard | null): void {
  clipboard = next;
}
export function trackClipboard(): TrackClipboard | null {
  return clipboard;
}

/** What a track row reports up to the track stack, which owns the edits. */
export interface TrackLaneController {
  pressClip(e: MouseEvent, track: ShowLayerTrack, clip: ShowLayerClip, part: ClipPart): void;
  pressEmpty(e: MouseEvent, track: ShowLayerTrack): void;
  /** Right-click on a clip: the clip menu. */
  contextClip(e: MouseEvent, track: ShowLayerTrack, clip: ShowLayerClip): void;
  pressXfade(e: MouseEvent, track: ShowLayerTrack, clip: ShowLayerClip, edge: 'body' | 'edge'): void;
  addXfade(track: ShowLayerTrack, clip: ShowLayerClip): void;
  removeXfade(track: ShowLayerTrack, clip: ShowLayerClip): void;
  dragOver(e: DragEvent, track: ShowLayerTrack | null): void;
  dragLeave(e: DragEvent): void;
  drop(e: DragEvent, track: ShowLayerTrack | null): void;
  snap(t: number): number;
  laneAddKey(track: ShowLayerTrack, key: string, time: number, value: number | boolean): void;
  laneMoveKey(track: ShowLayerTrack, key: string, from: number, to: number, value: number | boolean | undefined, dragId: string): void;
  laneShiftKeys(track: ShowLayerTrack, key: string, times: number[], delta: number, dragId: string): void;
  laneSelectKeys(track: ShowLayerTrack, key: string, times: number[], additive: boolean): void;
  laneDeleteKeys(track: ShowLayerTrack, key: string, times: number[]): void;
  laneEasing(track: ShowLayerTrack, key: string, times: number[], easing: import('../../../types').KeyframeEasing): void;
  /** At the start of a drag: what puts the show back if it is cancelled. */
  snapshot(): () => void;
}

/**
 * Move a popover to <body>: the label column is translated to follow the
 * grid's scroll, and a fixed-position menu inside a transformed parent is
 * placed relative to that parent instead of the window.
 */
export function portal(node: HTMLElement): { destroy(): void } {
  document.body.appendChild(node);
  return { destroy: () => node.remove() };
}

/**
 * Reorder drag: the gap (0 = above the first track, n = below the last) a
 * header dragged to `y` in the header column points at.
 */
export function reorderGapAt(tops: readonly number[], heights: readonly number[], y: number): number {
  let gap = 0;
  for (let i = 0; i < tops.length; i++) if (y > tops[i] + heights[i] / 2) gap = i + 1;
  return gap;
}

/** The index a track moved from `from` into `gap` ends up at. */
export function reorderIndexForGap(from: number, gap: number): number {
  return gap > from ? gap - 1 : gap;
}
