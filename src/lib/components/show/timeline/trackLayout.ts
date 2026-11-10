/**
 * Geometry and session state shared by the show's track headers (in the
 * label column) and track lanes (in the scrolling grid). Both draw from the
 * same row heights, so a header always lines up with its lane.
 */
import { writable } from 'svelte/store';
import type { KeyframeTrack, ShowLayerClip, ShowLayerTrack } from '../../../types';

/** The part of a clip block a press grabbed. */
export type ClipPart = 'body' | 'start' | 'end' | 'fadeIn' | 'fadeOut';

export const TRACK_ROW_HEIGHT = 44;
export const LANE_ROW_HEIGHT = 30;
/** The "+ Track" row under the tracks (and drop target for a new track). */
export const ADD_TRACK_ROW_HEIGHT = 28;
/** Label column width once the show has tracks (headers need the room). */
export const TRACK_HEADER_WIDTH = 204;

/** Height of one track: its clip row, plus its lanes when unfolded. */
export function trackHeight(track: Pick<ShowLayerTrack, 'collapsed' | 'lanes'>): number {
  return TRACK_ROW_HEIGHT + (track.collapsed ? 0 : track.lanes.length * LANE_ROW_HEIGHT);
}

export function tracksStackHeight(tracks: readonly Pick<ShowLayerTrack, 'collapsed' | 'lanes'>[]): number {
  let h = ADD_TRACK_ROW_HEIGHT;
  for (const t of tracks) h += trackHeight(t);
  return h;
}

/** Top of each track inside the stack. */
export function trackTops(tracks: readonly Pick<ShowLayerTrack, 'collapsed' | 'lanes'>[]): number[] {
  const tops: number[] = [];
  let y = 0;
  for (const t of tracks) {
    tops.push(y);
    y += trackHeight(t);
  }
  return tops;
}

/** Index of the track whose rows contain `y` (stack coordinates), clamped
 *  to the list; -1 for an empty list. */
export function trackIndexAt(tracks: readonly Pick<ShowLayerTrack, 'collapsed' | 'lanes'>[], y: number): number {
  if (!tracks.length) return -1;
  let top = 0;
  for (let i = 0; i < tracks.length; i++) {
    const h = trackHeight(tracks[i]);
    if (y < top + h) return i;
    top += h;
  }
  return tracks.length - 1;
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
