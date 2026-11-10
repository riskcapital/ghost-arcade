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
 *   decoder, named after its first clip, so a split plays with no seek. A
 *   shader or sketch split the same way keeps its one program running.
 */
import type { Layer, ShowClipMedia, ShowLayerClip, ShowLayerTrack } from '../../types';
import { compositionTransitionWeights } from '../../renderer/compositionTransitionLayers';
import { clampShowTransitionDuration, findJunctionPredecessor } from '../showJunctions';

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

/** Two shader or sketch clips run the same program. */
function sameProgram(a: ShowClipMedia, b: ShowClipMedia): boolean {
  if (a === b) return true;
  if (a.kind !== b.kind || a.name !== b.name) return false;
  if (a.kind === 'shader') return !!a.shaderCode && a.shaderCode === b.shaderCode;
  if (a.kind === 'sketch') {
    const ja = a.jsAnimation;
    const jb = b.jsAnimation;
    return !!ja && !!jb && ja.animationType === jb.animationType && !!ja.htmlCode && ja.htmlCode === jb.htmlCode;
  }
  return false;
}

/**
 * True when `next` carries on exactly where `prev` leaves off: touching,
 * same media, same speed and end behaviour, and the media time continuous
 * across the cut.
 */
export function continuesRun(prev: ShowLayerClip, next: ShowLayerClip): boolean {
  if (Math.abs(clipEnd(prev) - next.startTime) > EPS) return false;
  // A crossfade shows both clips at once: they need a decoder each.
  if (next.transitionIn === 'dissolve') return false;
  if (Math.abs(clipRate(prev) - clipRate(next)) > EPS) return false;
  if (prev.media.kind === 'shader' || prev.media.kind === 'sketch') {
    // One program carries on when its time does (what a split leaves).
    return sameProgram(prev.media, next.media)
      && Math.abs(rawMediaTime(prev, clipEnd(prev)) - next.inPoint) < 1e-4;
  }
  if (prev.media.kind !== 'video' || !sameMedia(prev.media, next.media)) return false;
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
  /** Inside a crossfade: the outgoing clip, drawn by a helper copy of the
   *  layer just beneath it at `opacity`. `clip` is then the incoming one. */
  xfade?: { clip: ShowTrackClipState; opacity: number; progress: number } | null;
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
  /** The seek generation began with a loop wrap: show time moved back by
   *  `shift` seconds from generation `fromGeneration`, and nothing else
   *  jumped. A video whose media carries on through the wrap keeps its
   *  decoder (see ShowClipSources). */
  wrap?: ShowLoopWrap;
  tracks: ShowTrackState[];
}

export interface ShowLoopWrap {
  fromGeneration: number;
  shift: number;
}

export interface EvaluateShowTracksOptions {
  playing: boolean;
  seekGeneration: number;
  soloTrackId?: string | null;
  manualClock?: boolean;
  /** performance.now() at which the show was at `t` (see ShowTrackFrame). */
  evaluatedAtMs?: number;
  /** See ShowTrackFrame.wrap. */
  wrap?: ShowLoopWrap | null;
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
  const runs = clipIndex(track.clips).runs;
  const runId = runs.get(next.id) ?? next.id;
  // The rest of a run already playing needs no warming: its program runs.
  const playing = findClipAt(track.clips, t);
  if (playing && (runs.get(playing.id) ?? playing.id) === runId) return null;
  return { clipId: next.id, runId, media: next.media };
}

/**
 * What the evaluation looks up per clip, worked out once per clip list
 * (clip arrays are replaced on every edit, never changed in place): the run
 * of every clip, the first clip of every run, and each clip's junction
 * predecessor as it is asked for. Without it every frame scanned each
 * track's clips to find them.
 */
interface ClipIndex {
  runs: Map<string, string>;
  /** First clip with each id, as clips.find(id) gives it. */
  byId: Map<string, ShowLayerClip>;
  /** findJunctionPredecessor per clip, filled on first ask. */
  junctions: Map<ShowLayerClip, { id: string; startTime: number; prev: ShowLayerClip | null }>;
}

const clipIndexCache = new WeakMap<readonly ShowLayerClip[], ClipIndex>();
function clipIndex(clips: readonly ShowLayerClip[]): ClipIndex {
  let index = clipIndexCache.get(clips);
  if (!index) {
    const byId = new Map<string, ShowLayerClip>();
    for (const clip of clips) if (!byId.has(clip.id)) byId.set(clip.id, clip);
    index = { runs: clipRuns(clips), byId, junctions: new Map() };
    clipIndexCache.set(clips, index);
  }
  return index;
}

/** clipRuns(clips), computed once per clip list. Treat the map as read-only. */
export function cachedClipRuns(clips: readonly ShowLayerClip[]): ReadonlyMap<string, string> {
  return clipIndex(clips).runs;
}

function junctionPredecessor(clips: readonly ShowLayerClip[], clip: ShowLayerClip): ShowLayerClip | null {
  const junctions = clipIndex(clips).junctions;
  const known = junctions.get(clip);
  if (known && known.id === clip.id && known.startTime === clip.startTime) return known.prev;
  const prev = findJunctionPredecessor(clips, clip);
  junctions.set(clip, { id: clip.id, startTime: clip.startTime, prev });
  return prev;
}

/** The centred window of a clip's crossfade, or null for a cut. */
export function trackTransitionWindow(
  clips: readonly ShowLayerClip[],
  clip: ShowLayerClip,
): { start: number; end: number; duration: number; prev: ShowLayerClip } | null {
  if (clip.transitionIn !== 'dissolve') return null;
  const prev = junctionPredecessor(clips, clip);
  if (!prev) return null;
  const duration = clampShowTransitionDuration(clip.transitionDuration, clip, prev);
  if (duration <= 0) return null;
  const half = duration / 2;
  return { start: clip.startTime - half, end: clip.startTime + half, duration, prev };
}

/** The crossfade under show time `t` on a track, if any. */
export function crossfadeAt(
  clips: readonly ShowLayerClip[],
  t: number,
): { incoming: ShowLayerClip; outgoing: ShowLayerClip; progress: number } | null {
  const at = findClipAt(clips, t);
  const candidates = [nextClipAfter(clips, t), at];
  for (const c of candidates) {
    if (!c) continue;
    const w = trackTransitionWindow(clips, c);
    if (w && t >= w.start - 1e-9 && t < w.end) {
      return { incoming: c, outgoing: w.prev, progress: Math.max(0, Math.min(1, (t - w.start) / w.duration)) };
    }
  }
  return null;
}

function clipStateAt(
  clips: readonly ShowLayerClip[],
  clip: ShowLayerClip,
  t: number,
  opts: Pick<EvaluateShowTracksOptions, 'playing' | 'manualClock'>,
): ShowTrackClipState {
  const index = clipIndex(clips);
  const runId = index.runs.get(clip.id) ?? clip.id;
  const runFirst = index.byId.get(runId) ?? clip;
  // Before its start (the first half of a crossfade) a clip with no media
  // before its in-point waits on its first frame.
  const waiting = clip.media.kind === 'video' && rawMediaTime(clip, t) < 0;
  const position = clipMediaTime(clip, t);
  return {
    clipId: clip.id,
    runId,
    runStart: runFirst.startTime,
    media: clip.media,
    mediaTime: position.time,
    // An offline render seeks frame by frame without "playing": its
    // clips run on the render clock all the same.
    paused: (!opts.playing && !opts.manualClock) || position.held || waiting,
    held: position.held,
    rate: clipRate(clip),
    loopStart: clipLoopStart(runFirst),
    localTime: t - clip.startTime,
  };
}

/** Opacity a clip contributes at `t`: its own opacity times its fades. */
function clipGain(clip: ShowLayerClip, t: number): number {
  const inside = Math.max(clip.startTime, Math.min(clipEnd(clip) - 1e-6, t));
  return Math.max(0, Math.min(1, clip.opacity ?? 1)) * clipFadeGain(clip, inside);
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
    const xf = silenced ? null : crossfadeAt(track.clips, t);
    if (xf) {
      const weights = compositionTransitionWeights('dissolve', xf.progress);
      return {
        trackId: track.id,
        layerId: track.layerId,
        layerName: track.layerName,
        template: track.template,
        clip: clipStateAt(track.clips, xf.incoming, t, opts),
        opacity: clipGain(xf.incoming, t) * weights.incoming,
        gap: track.gap,
        params,
        warm: warmFor(track, t, silenced),
        xfade: {
          clip: clipStateAt(track.clips, xf.outgoing, t, opts),
          opacity: clipGain(xf.outgoing, t) * weights.outgoing,
          progress: xf.progress,
        },
      };
    }
    const opacity = silenced
      ? 0
      : Math.max(0, Math.min(1, clip.opacity ?? 1)) * clipFadeGain(clip, t);
    return {
      trackId: track.id,
      layerId: track.layerId,
      layerName: track.layerName,
      template: track.template,
      clip: clipStateAt(track.clips, clip, t, opts),
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
    ...(opts.wrap ? { wrap: opts.wrap } : {}),
    tracks: states,
  };
}

/** An opacity as the 8-bit output can show it, and whether it is at either
 *  end (the scene adds and drops layers there). */
function visibleOpacity(value: number): string {
  return `${Math.round(value * 255)}${value <= 0 ? 'z' : value < 1 ? '' : 'f'}`;
}

/** Lane values at the precision they take effect: opacity in 8-bit steps
 *  like the clip's, every other number as the 32-bit float a uniform holds. */
function laneValuesSignature(params: Record<string, number | boolean>): string {
  const parts: string[] = [];
  for (const key in params) {
    const value = params[key];
    parts.push(`${key}=${typeof value !== 'number' ? String(value) : key === 'layer:opacity' ? visibleOpacity(value) : String(Math.fround(value))}`);
  }
  return parts.join(',');
}

/**
 * What decides whether a new frame has to reach the scene. Media time is
 * left out while playing: the decoder free-runs from its anchor, so a
 * playing video needs no new scene every frame. Opacity is rounded to what
 * the output can show, so a slow fade publishes once per visible step, not
 * on every frame.
 */
export function showTrackFrameSignature(frame: ShowTrackFrame): string {
  const parts: string[] = [frame.playing ? 'p' : 's', String(frame.seekGeneration), frame.manualClock ? 'm' : ''];
  for (const tr of frame.tracks) {
    const c = tr.clip;
    parts.push(
      [
        tr.trackId,
        tr.layerId,
        visibleOpacity(tr.opacity),
        tr.gap,
        c ? `${c.clipId}/${c.runId}/${c.paused ? 'P' : ''}${c.held ? 'H' : ''}` : '-',
        c && c.paused ? c.mediaTime.toFixed(4) : '',
        tr.params ? laneValuesSignature(tr.params) : '',
        tr.template ? tr.template.id : '',
        tr.warm ? `w:${tr.warm.clipId}` : '',
        tr.xfade ? `x:${tr.xfade.clip.clipId}/${tr.xfade.clip.runId}/${tr.xfade.clip.paused ? 'P' : ''}${visibleOpacity(tr.xfade.opacity)}` : '',
      ].join('|'),
    );
  }
  return parts.join(';');
}
