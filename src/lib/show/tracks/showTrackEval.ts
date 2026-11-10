/**
 * Layer tracks at one instant of show time.
 *
 * Pure: the store calls `evaluateShowTracks` on every evaluation (live play,
 * scrub, offline render) and the scene builder turns the result into the
 * layers the core draws. The same show time always gives the same frame.
 *
 * Rules:
 * - Clips own half-open intervals [start, start + duration). At an exact cut
 *   the incoming clip wins.
 * - Media time is `loopStart/inPoint + (t - start) * rate`:
 *     'loop' wraps over [loopStart, mediaEnd),
 *     'hold' and 'stop' stop one frame before the media end and pause there
 *     (a 'stop' clip cannot be longer than its media; a hand-edited one
 *     simply holds).
 * - Fades multiply opacity: no extra layers.
 * - A run is a chain of touching clips with the same media whose media time
 *   carries on across each cut (what a split leaves behind). A run keeps one
 *   decoder, named after its first clip, so a split plays with no seek.
 */
import type { Layer, ShowClipMedia, ShowLayerClip, ShowLayerTrack } from '../../types';

/** One frame at the rate stop/hold clips park before the media end. */
export const SHOW_CLIP_END_GUARD_SECONDS = 1 / 30;
export const SHOW_MIN_RATE = 0.25;
/** A shader or sketch clip is warmed (compiled / booted, invisible) for this
 *  long before it starts, so the cut does not hitch. */
export const SHOW_WARM_SECONDS = 1;
export const SHOW_MAX_RATE = 4;
const EPS = 1e-6;

export function clipRate(clip: Pick<ShowLayerClip, 'rate'>): number {
  const r = Number(clip.rate ?? 1);
  if (!Number.isFinite(r) || r <= 0) return 1;
  return Math.max(SHOW_MIN_RATE, Math.min(SHOW_MAX_RATE, r));
}

export function clipEnd(clip: Pick<ShowLayerClip, 'startTime' | 'duration'>): number {
  return clip.startTime + clip.duration;
}

/** Length of the media, or Infinity when unknown or not time-based. */
export function mediaEnd(media: ShowClipMedia): number {
  if (media.kind !== 'video') return Number.POSITIVE_INFINITY;
  const d = Number(media.sourceDuration);
  return Number.isFinite(d) && d > 0 ? d : Number.POSITIVE_INFINITY;
}

export function clipLoopStart(clip: Pick<ShowLayerClip, 'inPoint' | 'loopStart'>): number {
  const ls = Number(clip.loopStart);
  return Number.isFinite(ls) && ls >= 0 ? ls : Math.max(0, clip.inPoint);
}

/**
 * The clip under show time `t` in a start-sorted, non-overlapping list
 * (binary search). Half-open: a clip ending at `t` is not under it.
 */
export function findClipAt<T extends Pick<ShowLayerClip, 'startTime' | 'duration'>>(clips: readonly T[], t: number): T | null {
  let lo = 0;
  let hi = clips.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (clips[mid].startTime <= t) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  if (found < 0) return null;
  const c = clips[found];
  return t < c.startTime + c.duration ? c : null;
}

/** Unwrapped media position: where the media would be with no end. */
function rawMediaTime(clip: ShowLayerClip, t: number): number {
  return clip.inPoint + (t - clip.startTime) * clipRate(clip);
}

export interface ClipMediaPosition {
  /** Seconds into the media file. */
  time: number;
  /** The media has reached its end and stopped there ('stop' / 'hold'). */
  held: boolean;
}

/** Where the clip's media is at show time `t` (see the module rules). */
export function clipMediaTime(clip: ShowLayerClip, t: number): ClipMediaPosition {
  const raw = rawMediaTime(clip, t);
  if (clip.media.kind !== 'video') return { time: Math.max(0, raw), held: false };
  const end = mediaEnd(clip.media);
  if (!Number.isFinite(end)) return { time: Math.max(0, raw), held: false };
  if (clip.endBehaviour === 'loop') {
    const lo = Math.min(clipLoopStart(clip), Math.max(0, end - SHOW_CLIP_END_GUARD_SECONDS));
    const span = end - lo;
    if (raw < end || span <= 0) return { time: Math.max(0, raw), held: false };
    return { time: lo + ((raw - lo) % span), held: false };
  }
  const park = Math.max(0, end - SHOW_CLIP_END_GUARD_SECONDS);
  return raw >= park ? { time: park, held: true } : { time: Math.max(0, raw), held: false };
}

/** Fades in and out are clamped so they never overlap. */
export function clipFades(clip: Pick<ShowLayerClip, 'duration' | 'fadeIn' | 'fadeOut'>): { fadeIn: number; fadeOut: number } {
  const d = Math.max(0, clip.duration);
  let fadeIn = Math.max(0, Number(clip.fadeIn) || 0);
  let fadeOut = Math.max(0, Number(clip.fadeOut) || 0);
  if (fadeIn + fadeOut > d && fadeIn + fadeOut > 0) {
    const k = d / (fadeIn + fadeOut);
    fadeIn *= k;
    fadeOut *= k;
  }
  return { fadeIn, fadeOut };
}

/** 0..1 opacity gain from the clip's fades at show time `t`. */
export function clipFadeGain(clip: Pick<ShowLayerClip, 'startTime' | 'duration' | 'fadeIn' | 'fadeOut'>, t: number): number {
  const { fadeIn, fadeOut } = clipFades(clip);
  const local = t - clip.startTime;
  const remaining = clip.startTime + clip.duration - t;
  let gain = 1;
  if (fadeIn > 0) gain = Math.min(gain, local / fadeIn);
  if (fadeOut > 0) gain = Math.min(gain, remaining / fadeOut);
  return Math.max(0, Math.min(1, gain));
}

/** Two clips play the same media file. */
export function sameMedia(a: ShowClipMedia, b: ShowClipMedia): boolean {
  if (a.kind !== b.kind) return false;
  if (a.libraryId && b.libraryId) return a.libraryId === b.libraryId;
  const pa = a._assetRef?.originalPath;
  const pb = b._assetRef?.originalPath;
  if (pa && pb) return pa === pb;
  return !!a.src && a.src === b.src;
}

/**
 * True when `next` carries on exactly where `prev` leaves off: touching,
 * same media, same speed and end behaviour, and the media time continuous
 * across the cut.
 */
export function continuesRun(prev: ShowLayerClip, next: ShowLayerClip): boolean {
  if (Math.abs(clipEnd(prev) - next.startTime) > EPS) return false;
  if (prev.media.kind !== 'video' || !sameMedia(prev.media, next.media)) return false;
  if (Math.abs(clipRate(prev) - clipRate(next)) > EPS) return false;
  if (prev.endBehaviour !== next.endBehaviour) return false;
  if (prev.endBehaviour === 'loop' && Math.abs(clipLoopStart(prev) - clipLoopStart(next)) > EPS) return false;
  const carried = clipMediaTime(prev, clipEnd(prev));
  if (carried.held) return false;
  return Math.abs(carried.time - next.inPoint) < 1e-4;
}

/** Run id of every clip: the id of the first clip of its run. */
export function clipRuns(clips: readonly ShowLayerClip[]): Map<string, string> {
  const runs = new Map<string, string>();
  let prev: ShowLayerClip | null = null;
  let runId = '';
  for (const clip of clips) {
    if (prev && continuesRun(prev, clip)) runs.set(clip.id, runId);
    else {
      runId = clip.id;
      runs.set(clip.id, runId);
    }
    prev = clip;
  }
  return runs;
}

/** The clip playing on a track at one instant. */
export interface ShowTrackClipState {
  clipId: string;
  /** First clip of the run this clip belongs to (its decoder's name). */
  runId: string;
  /** Show time the run started. */
  runStart: number;
  media: ShowClipMedia;
  /** Media seconds (video). */
  mediaTime: number;
  /** The video should be paused: held at its end, or the transport stopped. */
  paused: boolean;
  /** At its end (stop/hold). */
  held: boolean;
  rate: number;
  /** Where the source loops back to (the run's loop start), seconds. */
  loopStart: number;
  /** Seconds since the clip started. */
  localTime: number;
}

/** One track at one instant. */
export interface ShowTrackState {
  trackId: string;
  layerId: string;
  layerName: string;
  template: Layer | null;
  /** The clip under the playhead; null in a gap. */
  clip: ShowTrackClipState | null;
  /**
   * Opacity multiplier for the layer: clip opacity × fades, 0 for a muted
   * or soloed-out track or a 'hide' gap, 1 in a pass-through gap.
   */
  opacity: number;
  /** In a gap, the layer shows its own content ('layer') or nothing ('hide'). */
  gap: 'layer' | 'hide';
  /** Keyframe-lane values at this instant (applyParamOverrides keys). */
  params: Record<string, number | boolean> | null;
  /** A shader or sketch clip about to start: its source is warmed
   *  invisibly ahead of the cut. */
  warm: { clipId: string; runId: string; media: ShowClipMedia } | null;
}

export interface ShowTrackFrame {
  time: number;
  playing: boolean;
  /** The show's seek generation: changes on every discontinuity. */
  seekGeneration: number;
  /** An offline render's virtual clock is driving the show. */
  manualClock: boolean;
  /** performance.now() when the show was at `time`, if known. Lets a
   *  reader that runs later (the phase follower) project media times to its
   *  own instant. */
  evaluatedAtMs?: number;
  tracks: ShowTrackState[];
}

export interface EvaluateShowTracksOptions {
  playing: boolean;
  seekGeneration: number;
  soloTrackId?: string | null;
  manualClock?: boolean;
  /** performance.now() at which the show was at `t` (see ShowTrackFrame). */
  evaluatedAtMs?: number;
  /** Lane evaluation (phase 4); null/absent means no lanes. */
  laneValues?: (track: ShowLayerTrack, t: number) => Record<string, number | boolean> | null;
}

/** The first clip starting after `t`. */
export function nextClipAfter<T extends Pick<ShowLayerClip, 'startTime'>>(clips: readonly T[], t: number): T | null {
  let lo = 0;
  let hi = clips.length - 1;
  let found: T | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (clips[mid].startTime > t) {
      found = clips[mid];
      hi = mid - 1;
    } else lo = mid + 1;
  }
  return found;
}

function warmFor(track: ShowLayerTrack, t: number, silenced: boolean): ShowTrackState['warm'] {
  if (silenced) return null;
  const next = nextClipAfter(track.clips, t);
  if (!next || next.startTime - t > SHOW_WARM_SECONDS) return null;
  if (next.media.kind !== 'shader' && next.media.kind !== 'sketch') return null;
  return { clipId: next.id, runId: runsOf(track.clips).get(next.id) ?? next.id, media: next.media };
}

/** Cache of run maps per clip list (clip arrays are replaced on every edit). */
const runCache = new WeakMap<readonly ShowLayerClip[], Map<string, string>>();
function runsOf(clips: readonly ShowLayerClip[]): Map<string, string> {
  let runs = runCache.get(clips);
  if (!runs) {
    runs = clipRuns(clips);
    runCache.set(clips, runs);
  }
  return runs;
}

export function evaluateShowTracks(
  tracks: readonly ShowLayerTrack[],
  t: number,
  opts: EvaluateShowTracksOptions,
): ShowTrackFrame {
  const solo = opts.soloTrackId ? tracks.find((tr) => tr.id === opts.soloTrackId) ?? null : null;
  const states: ShowTrackState[] = tracks.map((track) => {
    const silenced = track.muted || (solo !== null && solo.id !== track.id);
    const clip = findClipAt(track.clips, t);
    const params = opts.laneValues ? opts.laneValues(track, t) : null;
    if (!clip) {
      return {
        trackId: track.id,
        layerId: track.layerId,
        layerName: track.layerName,
        template: track.template,
        clip: null,
        opacity: silenced || track.gap === 'hide' ? 0 : 1,
        gap: track.gap,
        params,
        warm: warmFor(track, t, silenced),
      };
    }
    const runs = runsOf(track.clips);
    const runId = runs.get(clip.id) ?? clip.id;
    const runFirst = track.clips.find((c) => c.id === runId) ?? clip;
    const position = clipMediaTime(clip, t);
    const opacity = silenced
      ? 0
      : Math.max(0, Math.min(1, clip.opacity ?? 1)) * clipFadeGain(clip, t);
    return {
      trackId: track.id,
      layerId: track.layerId,
      layerName: track.layerName,
      template: track.template,
      clip: {
        clipId: clip.id,
        runId,
        runStart: runFirst.startTime,
        media: clip.media,
        mediaTime: position.time,
        // An offline render seeks frame by frame without "playing": its
        // clips run on the render clock all the same.
        paused: (!opts.playing && !opts.manualClock) || position.held,
        held: position.held,
        rate: clipRate(clip),
        loopStart: clipLoopStart(runFirst),
        localTime: t - clip.startTime,
      },
      opacity,
      gap: track.gap,
      params,
      warm: warmFor(track, t, silenced),
    };
  });
  return {
    time: t,
    playing: opts.playing,
    seekGeneration: opts.seekGeneration,
    manualClock: opts.manualClock === true,
    ...(Number.isFinite(opts.evaluatedAtMs) ? { evaluatedAtMs: opts.evaluatedAtMs } : {}),
    tracks: states,
  };
}

/**
 * What decides whether a new frame has to reach the scene. Media time is
 * left out while playing: the decoder free-runs from its anchor, so a
 * playing video needs no new scene every frame. Opacity is rounded so a
 * fade publishes at a useful rate, not on every float wiggle.
 */
export function showTrackFrameSignature(frame: ShowTrackFrame): string {
  const parts: string[] = [frame.playing ? 'p' : 's', String(frame.seekGeneration), frame.manualClock ? 'm' : ''];
  for (const tr of frame.tracks) {
    const c = tr.clip;
    parts.push(
      [
        tr.trackId,
        tr.layerId,
        tr.opacity.toFixed(4),
        tr.gap,
        c ? `${c.clipId}/${c.runId}/${c.paused ? 'P' : ''}${c.held ? 'H' : ''}` : '-',
        c && c.paused ? c.mediaTime.toFixed(4) : '',
        tr.params ? JSON.stringify(tr.params) : '',
        tr.template ? tr.template.id : '',
        tr.warm ? `w:${tr.warm.clipId}` : '',
      ].join('|'),
    );
  }
  return parts.join(';');
}
