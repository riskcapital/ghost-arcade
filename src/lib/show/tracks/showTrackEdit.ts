/**
 * Editing a layer track's clips. Pure: every operation takes the clip list
 * and returns a new one (or null when the edit is refused), so the store,
 * the UI and the tests share one set of rules.
 *
 * A track is single-occupancy, like the preset lane: clips never overlap. A
 * move into a window too small for the clip is refused rather than silently
 * shortening it.
 */
import type { KeyframeTrack, ShowLayerClip } from '../../types';
import { generateUUID } from '../../utils/uuid';
import { clipEnd, clipFades, clipLoopStart, clipMediaTime, clipRate, mediaEnd } from './showTrackEval';

/** Nothing on a track may be shorter than this. */
export const SHOW_MIN_TRACK_CLIP_SECONDS = 0.1;
const EPS = 1e-9;

export interface Placeable {
  id: string;
  startTime: number;
  duration: number;
}

/**
 * Place `duration` seconds starting at `desiredStart` on a single-occupancy
 * lane, given the other items already on it.
 *
 * Returns the clamped start, or null when the free window under
 * `desiredStart` is too narrow to hold the item — the caller then leaves it
 * where it was. Refusing beats silently resizing: an operator dragging a
 * 60 s preset into a 10 s hole did not ask for a 10 s preset.
 */
export function placeOnLane(
  others: Placeable[],
  desiredStart: number,
  duration: number,
): number | null {
  const start = Math.max(0, desiredStart);
  const sorted = [...others].sort((a, b) => a.startTime - b.startTime);

  // If the requested start lands inside an existing item, push out to the
  // nearer edge before measuring the window.
  let probe = start;
  for (const o of sorted) {
    const s = o.startTime;
    const e = o.startTime + o.duration;
    if (probe > s && probe < e) {
      probe = probe - s < e - probe ? Math.max(0, s - duration) : e;
    }
  }

  let left = 0;
  let right = Number.POSITIVE_INFINITY;
  for (const o of sorted) {
    const s = o.startTime;
    const e = o.startTime + o.duration;
    if (e <= probe) left = Math.max(left, e);
    else if (s >= probe) right = Math.min(right, s);
    else {
      // Still straddling after the push-out (items overlap each other in a
      // hand-edited file). Treat it as blocked.
      return null;
    }
  }

  if (right - left < duration - 1e-9) return null;
  const upper = right === Number.POSITIVE_INFINITY ? probe : right - duration;
  return Math.max(left, Math.min(probe, Math.max(left, upper)));
}

/** How much room an item has to grow to the right before hitting a neighbour. */
export function maxDurationAt(others: Placeable[], startTime: number): number {
  let right = Number.POSITIVE_INFINITY;
  for (const o of others) {
    if (o.startTime >= startTime) right = Math.min(right, o.startTime);
  }
  return right === Number.POSITIVE_INFINITY ? Number.POSITIVE_INFINITY : right - startTime;
}

export function sortClips(clips: ShowLayerClip[]): ShowLayerClip[] {
  return [...clips].sort((a, b) => a.startTime - b.startTime);
}

/** Longest a clip may be from its in-point: a 'stop' clip ends with its media. */
export function maxClipDurationForMedia(clip: ShowLayerClip): number {
  if (clip.endBehaviour !== 'stop') return Number.POSITIVE_INFINITY;
  const end = mediaEnd(clip.media);
  if (!Number.isFinite(end)) return Number.POSITIVE_INFINITY;
  return Math.max(SHOW_MIN_TRACK_CLIP_SECONDS, (end - clip.inPoint) / clipRate(clip));
}

/** Keep fades inside the clip after a length change. */
function withClampedFades(clip: ShowLayerClip): ShowLayerClip {
  const { fadeIn, fadeOut } = clipFades(clip);
  return fadeIn === clip.fadeIn && fadeOut === clip.fadeOut ? clip : { ...clip, fadeIn, fadeOut };
}

/** Where `clip` can start near `desiredStart`, ignoring the clips in `ignore`. */
export function placeOnTrack(
  clips: readonly ShowLayerClip[],
  desiredStart: number,
  duration: number,
  ignore: ReadonlySet<string> = new Set(),
): number | null {
  return placeOnLane(clips.filter((c) => !ignore.has(c.id)), desiredStart, duration);
}

/** Insert a clip, placed into the free window nearest its start. */
export function insertClip(clips: readonly ShowLayerClip[], clip: ShowLayerClip): ShowLayerClip[] | null {
  const duration = Math.max(SHOW_MIN_TRACK_CLIP_SECONDS, Math.min(clip.duration, maxClipDurationForMedia(clip)));
  const start = placeOnTrack(clips, clip.startTime, duration);
  if (start === null) return null;
  return sortClips([...clips, withClampedFades({ ...clip, startTime: start, duration })]);
}

/**
 * Cut a clip in two at show time `t`. The right half starts where the left
 * half's media had got to and loops over the same range, so it plays on as
 * one clip did (and keeps the same decoder: see clipRuns).
 */
export function splitClip(clip: ShowLayerClip, t: number, newId: string = generateUUID()): [ShowLayerClip, ShowLayerClip] | null {
  if (!(t > clip.startTime + SHOW_MIN_TRACK_CLIP_SECONDS - EPS) || !(t < clipEnd(clip) - SHOW_MIN_TRACK_CLIP_SECONDS + EPS)) return null;
  const leftDuration = t - clip.startTime;
  const position = clipMediaTime(clip, t);
  const inPoint = clip.media.kind === 'video' ? position.time : clip.inPoint + leftDuration * clipRate(clip);
  const left: ShowLayerClip = { ...clip, duration: leftDuration, fadeOut: 0 };
  const right: ShowLayerClip = {
    ...clip,
    id: newId,
    startTime: t,
    duration: clipEnd(clip) - t,
    inPoint,
    fadeIn: 0,
    transitionIn: 'cut',
    transitionDuration: undefined,
  };
  if (clip.endBehaviour === 'loop' || clip.loopStart !== undefined) right.loopStart = clipLoopStart(clip);
  return [withClampedFades(left), withClampedFades(right)];
}

/**
 * Drag one edge of a clip to show time `time`. The right edge stops at the
 * next clip (and, for a 'stop' clip, at the end of its media). The left edge
 * moves the in-point with it, so the picture under the cursor stays put,
 * and cannot reach before the start of the media.
 */
export function trimClip(
  clips: readonly ShowLayerClip[],
  clipId: string,
  edge: 'start' | 'end',
  time: number,
): ShowLayerClip[] | null {
  const clip = clips.find((c) => c.id === clipId);
  if (!clip) return null;
  const others = clips.filter((c) => c.id !== clipId);
  let next: ShowLayerClip;
  if (edge === 'end') {
    const room = Math.min(maxDurationAt(others, clip.startTime), maxClipDurationForMedia(clip));
    const duration = Math.max(SHOW_MIN_TRACK_CLIP_SECONDS, Math.min(time - clip.startTime, room));
    if (Math.abs(duration - clip.duration) < EPS) return null;
    next = { ...clip, duration };
  } else {
    const right = clipEnd(clip);
    const leftBound = others.reduce((m, o) => (clipEnd(o) <= clip.startTime + EPS ? Math.max(m, clipEnd(o)) : m), 0);
    const rate = clipRate(clip);
    // Time-based media cannot be trimmed back before its first frame.
    const earliestForMedia = clip.media.kind === 'video' ? clip.startTime - clip.inPoint / rate : Number.NEGATIVE_INFINITY;
    const startTime = Math.max(leftBound, earliestForMedia, Math.min(time, right - SHOW_MIN_TRACK_CLIP_SECONDS));
    if (Math.abs(startTime - clip.startTime) < EPS) return null;
    const inPoint = Math.max(0, clip.inPoint + (startTime - clip.startTime) * rate);
    next = { ...clip, startTime, duration: right - startTime, inPoint };
    if (clip.loopStart !== undefined) next.loopStart = Math.min(clip.loopStart, inPoint);
  }
  return sortClips([...others, withClampedFades(next)]);
}

/**
 * Move the clips in `ids` together by `delta` seconds. Refused when any of
 * them would overlap a clip that is not moving or start before 0.
 */
export function moveClips(clips: readonly ShowLayerClip[], ids: ReadonlySet<string>, delta: number): ShowLayerClip[] | null {
  if (!Number.isFinite(delta) || Math.abs(delta) < EPS) return null;
  const moving = clips.filter((c) => ids.has(c.id));
  if (!moving.length) return null;
  const staying = clips.filter((c) => !ids.has(c.id));
  const moved = moving.map((c) => ({ ...c, startTime: c.startTime + delta }));
  for (const m of moved) {
    if (m.startTime < -EPS) return null;
    for (const s of staying) {
      if (m.startTime < clipEnd(s) - EPS && s.startTime < clipEnd(m) - EPS) return null;
    }
  }
  return sortClips([...staying, ...moved.map((m) => ({ ...m, startTime: Math.max(0, m.startTime) }))]);
}

/**
 * Move one clip to `desiredStart`, clamped into the free window there (the
 * single-clip drag). Refused when the window is too small.
 */
export function moveClipTo(clips: readonly ShowLayerClip[], clipId: string, desiredStart: number): ShowLayerClip[] | null {
  const clip = clips.find((c) => c.id === clipId);
  if (!clip) return null;
  const start = placeOnTrack(clips, desiredStart, clip.duration, new Set([clipId]));
  if (start === null || Math.abs(start - clip.startTime) < EPS) return null;
  return sortClips(clips.map((c) => (c.id === clipId ? { ...c, startTime: start } : c)));
}

/** Copies of `source` clips, keeping their spacing, with the earliest at `at`. */
function placedCopies(source: readonly ShowLayerClip[], at: number, idFor: () => string): ShowLayerClip[] {
  const first = Math.min(...source.map((c) => c.startTime));
  return source.map((c) => ({ ...c, id: idFor(), startTime: at + (c.startTime - first) }));
}

function fits(clips: readonly ShowLayerClip[], added: readonly ShowLayerClip[]): boolean {
  for (const a of added) {
    if (a.startTime < -EPS) return false;
    for (const c of clips) {
      if (a.startTime < clipEnd(c) - EPS && c.startTime < clipEnd(a) - EPS) return false;
    }
  }
  return true;
}

/**
 * Paste clips (as copied, any start) so the earliest starts at `at`. Refused
 * when they would overlap what is there.
 */
export function pasteClips(
  clips: readonly ShowLayerClip[],
  copied: readonly ShowLayerClip[],
  at: number,
  idFor: () => string = generateUUID,
): { clips: ShowLayerClip[]; ids: string[] } | null {
  if (!copied.length) return null;
  const added = placedCopies(copied, Math.max(0, at), idFor);
  if (!fits(clips, added)) return null;
  return { clips: sortClips([...clips, ...added]), ids: added.map((c) => c.id) };
}

/**
 * Duplicate the selected clips: the copy goes straight after the selection,
 * or after the last clip on the track when that space is taken.
 */
export function duplicateClips(
  clips: readonly ShowLayerClip[],
  ids: ReadonlySet<string>,
  idFor: () => string = generateUUID,
): { clips: ShowLayerClip[]; ids: string[] } | null {
  const selected = clips.filter((c) => ids.has(c.id));
  if (!selected.length) return null;
  const selectionEnd = Math.max(...selected.map(clipEnd));
  const direct = pasteClips(clips, selected, selectionEnd, idFor);
  if (direct) return direct;
  const trackEnd = Math.max(...clips.map(clipEnd));
  return pasteClips(clips, selected, trackEnd, idFor);
}

/** Remove the clips in `ids`. */
export function deleteClips(clips: readonly ShowLayerClip[], ids: ReadonlySet<string>): ShowLayerClip[] {
  return clips.filter((c) => !ids.has(c.id));
}

/**
 * Remove the clips in `ids` and close the space they took: everything after
 * each removed clip moves left by its length. Returns the clips and the
 * shifts applied (time each shift starts at, and how far), for the lanes.
 */
export function rippleDelete(
  clips: readonly ShowLayerClip[],
  ids: ReadonlySet<string>,
): { clips: ShowLayerClip[]; shifts: Array<{ from: number; delta: number }> } {
  const removed = clips.filter((c) => ids.has(c.id)).sort((a, b) => a.startTime - b.startTime);
  let kept = clips.filter((c) => !ids.has(c.id)).map((c) => ({ ...c }));
  const shifts: Array<{ from: number; delta: number }> = [];
  // Latest first, so earlier removals still see their original positions.
  for (const r of [...removed].reverse()) {
    const from = clipEnd(r);
    const delta = -r.duration;
    shifts.push({ from, delta });
    kept = kept.map((c) => (c.startTime >= from - EPS ? { ...c, startTime: Math.max(0, c.startTime + delta) } : c));
  }
  return { clips: sortClips(kept), shifts };
}

/**
 * Move every key in [from, to) by `delta`: the keys a clip carries when it
 * moves (lanes are in show seconds, not clip-relative).
 */
export function shiftLaneKeys(lanes: readonly KeyframeTrack[], from: number, to: number, delta: number): KeyframeTrack[] {
  if (!Number.isFinite(delta) || Math.abs(delta) < EPS) return lanes as KeyframeTrack[];
  const inside = (time: number) => time >= from - EPS && time < to - EPS;
  return lanes.map((lane) => ({
    ...lane,
    keyframes: lane.keyframes
      .map((k) => (inside(k.time) ? { ...k, time: Math.max(0, k.time + delta) } : k))
      .sort((a, b) => a.time - b.time),
    boolKeyframes: lane.boolKeyframes
      .map((k) => (inside(k.time) ? { ...k, time: Math.max(0, k.time + delta) } : k))
      .sort((a, b) => a.time - b.time),
  }));
}
