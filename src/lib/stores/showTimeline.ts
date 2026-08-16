/**
 * Show Timeline — the mapping-mode arrangement surface.
 *
 * WHAT IT IS
 * ----------
 * Audio files on lanes, mapping presets (Compositions) laid out along a
 * single preset lane, one deterministic transport driving both. "Preset 1
 * for a minute, preset 2 for thirty seconds" — a fully programmed A/V show
 * that saves with the project and can be recorded or rendered out.
 *
 * THREE RULES HOLD THIS TOGETHER
 * ------------------------------
 * 1. `seek(seconds)` IS THE SINGLE SOURCE OF TRUTH. The RAF transport, the
 *    scrub handle, and the offline renderer all funnel through it. It
 *    decides which preset clip is live at that instant, fires the
 *    composition swap when (and only when) that answer changes, and moves
 *    the store's clock. Nothing else may fire a preset.
 *
 * 2. THE COMPOSITION LOADER IS INJECTED. `layers.ts` registers it at module
 *    init (`setShowCompositionLoader`). This store never imports `layers.ts`
 *    — that would be a cycle, and it would drag the whole project store into
 *    every unit test of the arrangement maths.
 *
 * 3. NOTHING HAPPENS WHEN THE TIMELINE IS EMPTY. No RAF, no AudioContext,
 *    no `loadComposition`, no elements. `play()` refuses on a zero-length
 *    show; audio elements are constructed on the first `addAudioTrack`.
 *
 * OVERLAP + SNAPPING (see `placeOnLane` / `snapShowTime`)
 * -------------------------------------------------------
 * • The preset lane is strictly single-occupancy: a show plays ONE
 *   composition at a time, so overlap is meaningless. Moves clamp into the
 *   free window under the pointer, and a move into a window narrower than
 *   the clip is refused rather than silently resized.
 * • Gaps on the preset lane are legal. Inside a gap no clip is active and
 *   the last-fired composition stays on screen — blanking the output for a
 *   hole in the arrangement would be worse than holding the picture.
 * • Audio tracks are one-per-lane-row and may freely overlap ACROSS lanes
 *   (that layering is the whole point); within a lane they follow the same
 *   single-occupancy rule as presets.
 * • Snapping is to a 0.25 s grid plus magnetic pull to any other clip edge
 *   and to 0, whichever is nearer, inside a zoom-aware tolerance.
 *
 * PRESETTRAY CONFLICT
 * -------------------
 * The show timeline OWNS scheduled preset changes. While it is playing,
 * PresetTray's auto-advance is stopped and cannot be restarted (its button
 * disables). Manual preset clicks still work as an operator punch-in; the
 * show takes back over at its next clip boundary.
 */

import { writable, derived, get } from 'svelte/store';
import type { ShowAudioTrack, ShowPresetClip } from '../types';
import { generateUUID } from '../utils/uuid';
import { clipAudioBus, type ClipAudioTransport } from '../audio/clipAudioBus';
import { isVisualAudioManualClock } from '../audio/visualAudio';
import {
  createAssetRefFromFile,
  recordMissingAsset,
  resolveAssetRefForRuntime,
  type AssetRef,
} from '../storage/assetRegistry';
import {
  computeAudioPeaks,
  decodeShowAudio,
  forgetShowAudioDecode,
  cachedShowAudioDecode,
} from '../audio/showAudio';

// ─── Tunables ────────────────────────────────────────────────────────────

/** Default snap grid. Quarter-second reads as "on the beat-ish" at any
 *  common tempo without being so fine that snapping stops helping. */
export const SHOW_SNAP_SECONDS = 0.25;
/** Nothing on the timeline may be shorter than this. */
export const SHOW_MIN_CLIP_SECONDS = 0.25;
/** Default length for a preset clip dropped without one. */
export const SHOW_DEFAULT_PRESET_SECONDS = 30;
/** Pixels-per-second bounds for the ruler. */
export const SHOW_MIN_ZOOM = 2;
export const SHOW_MAX_ZOOM = 120;
export const SHOW_DEFAULT_ZOOM = 12;
/** Minimum ruler length so an empty panel still reads as a timeline. */
export const SHOW_MIN_RULER_SECONDS = 60;

// ─── State ───────────────────────────────────────────────────────────────

export interface ShowTimelineSelection {
  kind: 'audio' | 'preset';
  id: string;
}

export interface ShowTimelineState {
  isOpen: boolean;
  isPlaying: boolean;
  /** Playhead, seconds. */
  currentTime: number;
  /** Effective show length, seconds — recomputed from content on every
   *  mutation. 0 means the show is empty and the transport stays inert. */
  duration: number;
  loop: boolean;
  audioTracks: ShowAudioTrack[];
  presetClips: ShowPresetClip[];
  /** id of the preset clip whose composition is currently loaded. null when
   *  the playhead sits in a gap or the show has not fired anything yet. */
  activeClipId: string | null;
  /** Pixels per second. */
  zoom: number;
  snapEnabled: boolean;
  selection: ShowTimelineSelection | null;
}

function createInitialState(): ShowTimelineState {
  return {
    isOpen: false,
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    loop: false,
    audioTracks: [],
    presetClips: [],
    activeClipId: null,
    zoom: SHOW_DEFAULT_ZOOM,
    snapEnabled: true,
    selection: null,
  };
}

// ─── Pure arrangement maths (exported for tests) ─────────────────────────

/** Content length of a show: the furthest edge of anything on it. */
export function computeShowDuration(
  clips: Pick<ShowPresetClip, 'startTime' | 'duration'>[],
  tracks: Pick<ShowAudioTrack, 'startTime' | 'duration'>[],
): number {
  let end = 0;
  for (const c of clips) end = Math.max(end, c.startTime + c.duration);
  for (const t of tracks) end = Math.max(end, t.startTime + t.duration);
  return Number.isFinite(end) && end > 0 ? end : 0;
}

/**
 * Which preset clip owns `time`.
 *
 * Half-open intervals — `[startTime, startTime + duration)`. That makes an
 * exact boundary unambiguous: at t = 30 with clip A on [0,30) and clip B on
 * [30,60), B wins, and A is never re-fired for a single frame on the way
 * past. Returns null inside a gap.
 */
export function findActiveShowClip(
  clips: ShowPresetClip[],
  time: number,
): ShowPresetClip | null {
  let best: ShowPresetClip | null = null;
  for (const c of clips) {
    const start = c.startTime;
    const end = start + c.duration;
    if (time >= start && time < end) {
      // The lane is single-occupancy, but be defensive about hand-edited
      // project files: the later-starting clip is the one on top.
      if (!best || c.startTime > best.startTime) best = c;
    }
  }
  return best;
}

/**
 * Snap a time to the grid, to any supplied edge, or to 0 — whichever is
 * nearest within `tolerance`. Returns `time` untouched when snapping is off
 * or nothing is close enough.
 */
export function snapShowTime(
  time: number,
  edges: number[],
  opts: { enabled: boolean; grid?: number; tolerance: number },
): number {
  const t = Math.max(0, Number.isFinite(time) ? time : 0);
  if (!opts.enabled) return t;
  const grid = opts.grid ?? SHOW_SNAP_SECONDS;
  let best = t;
  let bestDelta = opts.tolerance;
  const consider = (candidate: number) => {
    if (candidate < 0) return;
    const delta = Math.abs(candidate - t);
    if (delta <= bestDelta) {
      bestDelta = delta;
      best = candidate;
    }
  };
  if (grid > 0) consider(Math.round(t / grid) * grid);
  consider(0);
  for (const e of edges) consider(e);
  // Kill float dust from the grid multiply so saved values stay readable.
  return Math.max(0, Math.round(best * 1e6) / 1e6);
}

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

// ─── Composition loader injection ────────────────────────────────────────

export interface ShowCompositionLoadOptions {
  restoreTransports: boolean;
}
export type ShowCompositionLoader = (
  compositionId: string,
  options: ShowCompositionLoadOptions,
) => void;

let compositionLoader: ShowCompositionLoader | null = null;
let lazyLoaderRequested = false;

/** Registered by `layers.ts` at module init. Also the seam tests use. */
export function setShowCompositionLoader(loader: ShowCompositionLoader | null): void {
  compositionLoader = loader;
}

function requestLazyLoader(): void {
  // Safety net for an exotic import order where something drives the
  // timeline before layers.ts has evaluated. Never runs under vitest's
  // node environment, so a store test cannot accidentally pull the whole
  // project store in behind it.
  if (lazyLoaderRequested || compositionLoader) return;
  if (typeof window === 'undefined') return;
  lazyLoaderRequested = true;
  void import('./layers').catch((err) => {
    console.warn('[ShowTimeline] composition loader unavailable:', err);
  });
}

// ─── Live audio wiring ───────────────────────────────────────────────────

const CLIP_AUDIO_PREFIX = 'show-audio:';
/** One dedicated element per track. Never pooled, never re-`src`ed — the
 *  clip audio bus wires each element to a MediaElementAudioSourceNode
 *  exactly once for the element's whole life (clipAudioBus constraint 3). */
const trackElements = new Map<string, HTMLAudioElement>();
/** Bumped on every explicit seek so the bus hard-seeks instead of nudging. */
let seekGeneration = 0;

function busIdFor(trackId: string): string {
  return CLIP_AUDIO_PREFIX + trackId;
}

function transportProviderFor(trackId: string): () => ClipAudioTransport | null {
  return () => {
    const s = get(store);
    const track = s.audioTracks.find((t) => t.id === trackId);
    if (!track) return null;
    const end = track.startTime + track.duration;
    const inWindow = s.currentTime >= track.startTime && s.currentTime < end;
    const local = s.currentTime - track.startTime + track.offset;
    return {
      timeSeconds: Math.max(0, local),
      playbackRate: 1,
      paused: !s.isPlaying || !inWindow,
      loop: false,
      trimStartSeconds: track.offset,
      trimEndSeconds: track.offset + track.duration,
      seekGeneration,
      durationSeconds: track.sourceDuration > 0 ? track.sourceDuration : undefined,
    };
  };
}

/**
 * Make sure a track has a live, bus-attached element matching its URL.
 * A URL change means a BRAND NEW element — `createMediaElementSource` is
 * one-shot per element and re-`src`ing an attached one would keep playing
 * the old file through the graph.
 */
function ensureTrackElement(track: ShowAudioTrack): void {
  if (typeof document === 'undefined') return;
  if (!track.url) {
    releaseTrackElement(track.id);
    return;
  }
  const existing = trackElements.get(track.id);
  if (existing && existing.dataset.showTrackUrl === track.url) {
    clipAudioBus.setClipVolume(busIdFor(track.id), track.volume);
    clipAudioBus.setClipMuted(busIdFor(track.id), track.muted);
    return;
  }
  if (existing) releaseTrackElement(track.id);

  const el = document.createElement('audio');
  el.dataset.showTrackUrl = track.url;
  el.preload = 'auto';
  el.crossOrigin = 'anonymous';
  el.muted = true; // the bus is the only thing that un-mutes anything
  el.loop = false;
  el.src = track.url;
  trackElements.set(track.id, el);

  clipAudioBus.attachClip(busIdFor(track.id), el, {
    volume: track.volume,
    muted: track.muted,
    provider: transportProviderFor(track.id),
  });
}

function releaseTrackElement(trackId: string): void {
  const el = trackElements.get(trackId);
  clipAudioBus.detachClip(busIdFor(trackId));
  if (el) {
    try {
      el.pause();
    } catch {
      /* already parked */
    }
    try {
      el.removeAttribute('src');
      el.load();
    } catch {
      /* best effort */
    }
    trackElements.delete(trackId);
  }
}

function releaseAllTrackElements(): void {
  for (const id of [...trackElements.keys()]) releaseTrackElement(id);
}

function syncAudioWiring(tracks: ShowAudioTrack[]): void {
  const live = new Set(tracks.map((t) => t.id));
  for (const id of [...trackElements.keys()]) {
    if (!live.has(id)) releaseTrackElement(id);
  }
  for (const track of tracks) ensureTrackElement(track);
}

// ─── Store ───────────────────────────────────────────────────────────────

const store = writable<ShowTimelineState>(createInitialState());

let rafId: number | null = null;
let lastFrameTime = 0;

function isManualClock(): boolean {
  try {
    return isVisualAudioManualClock();
  } catch {
    return false;
  }
}

function cancelRaf(): void {
  if (rafId !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafId);
  rafId = null;
}

function fireComposition(clip: ShowPresetClip): void {
  const loader = compositionLoader;
  if (!loader) {
    requestLazyLoader();
    return;
  }
  try {
    // Live: let loadComposition restore the preset's own sequencer /
    // keyframe transports, so each preset starts its animation clean at its
    // boundary — that IS the intent of a programmed show.
    //
    // Offline export: the render loop owns keyframeTimeline / layerSequencer
    // and seeks them per frame. loadComposition's deferred `seek(0); play()`
    // lands a microtask later and would fight it, so suppress it entirely.
    loader(clip.compositionId, { restoreTransports: !isManualClock() });
  } catch (err) {
    console.warn('[ShowTimeline] preset load failed:', err);
  }
}

/**
 * The single evaluation path. Everything that moves the playhead ends here.
 *
 * `bumpSeek` marks a discontinuity (user scrub, transport start, stop) so
 * the audio bus hard-seeks its elements instead of rate-nudging toward a
 * target that just jumped.
 */
function applyTime(time: number, bumpSeek: boolean): void {
  const s = get(store);
  const dur = s.duration;

  let t = Number.isFinite(time) ? Math.max(0, time) : 0;
  if (dur <= 0) {
    t = 0;
  } else if (s.loop) {
    t = ((t % dur) + dur) % dur;
  } else {
    t = Math.min(t, dur);
  }

  // Parking exactly on the end of a non-looping show would leave every clip
  // "not active" (half-open intervals) and drop the picture. Evaluate a hair
  // inside instead.
  const evalTime = !s.loop && dur > 0 && t >= dur ? Math.max(0, dur - 1e-6) : t;
  const next = findActiveShowClip(s.presetClips, evalTime);
  const nextId = next ? next.id : null;
  const changed = nextId !== s.activeClipId;

  if (bumpSeek) seekGeneration++;

  // Publish BEFORE firing so anything the composition load touches reads
  // the new playhead and the new active clip, not the old ones.
  store.set({ ...s, currentTime: t, activeClipId: nextId });

  if (changed && next) fireComposition(next);
}

function tick(now: number): void {
  rafId = null;
  const s = get(store);
  if (!s.isPlaying) return;

  const dt = lastFrameTime > 0 ? (now - lastFrameTime) / 1000 : 0;
  lastFrameTime = now;

  const dur = s.duration;
  let next = s.currentTime + dt;
  if (dur > 0 && next >= dur) {
    if (s.loop) {
      next = next % dur;
      applyTime(next, true); // wrap is a discontinuity for the audio bus
      rafId = requestAnimationFrame(tick);
      return;
    }
    applyTime(dur, true);
    store.update((x) => ({ ...x, isPlaying: false }));
    return;
  }

  applyTime(next, false);
  rafId = requestAnimationFrame(tick);
}

/** Recompute duration + reselect after any structural mutation. */
function withDuration(s: ShowTimelineState): ShowTimelineState {
  return { ...s, duration: computeShowDuration(s.presetClips, s.audioTracks) };
}

function normalizeTrack(raw: unknown, index: number): ShowAudioTrack | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as Record<string, unknown>;
  const duration = Number(t.duration);
  const startTime = Number(t.startTime);
  return {
    id: typeof t.id === 'string' && t.id ? t.id : generateUUID(),
    name: typeof t.name === 'string' && t.name ? t.name : `Audio ${index + 1}`,
    url: typeof t.url === 'string' ? t.url : '',
    assetRef: (t.assetRef as AssetRef | undefined) ?? undefined,
    startTime: Number.isFinite(startTime) ? Math.max(0, startTime) : 0,
    duration: Number.isFinite(duration) ? Math.max(SHOW_MIN_CLIP_SECONDS, duration) : SHOW_MIN_CLIP_SECONDS,
    offset: Number.isFinite(Number(t.offset)) ? Math.max(0, Number(t.offset)) : 0,
    sourceDuration: Number.isFinite(Number(t.sourceDuration)) ? Math.max(0, Number(t.sourceDuration)) : 0,
    volume: Number.isFinite(Number(t.volume)) ? Math.max(0, Math.min(1, Number(t.volume))) : 1,
    muted: t.muted === true,
    lane: Number.isFinite(Number(t.lane)) ? Math.max(0, Math.floor(Number(t.lane))) : 0,
    peaks: Array.isArray(t.peaks) ? (t.peaks as number[]).map((n) => Number(n) || 0) : undefined,
  };
}

function normalizeClip(raw: unknown): ShowPresetClip | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  if (typeof c.compositionId !== 'string' || !c.compositionId) return null;
  const duration = Number(c.duration);
  const startTime = Number(c.startTime);
  return {
    id: typeof c.id === 'string' && c.id ? c.id : generateUUID(),
    compositionId: c.compositionId,
    startTime: Number.isFinite(startTime) ? Math.max(0, startTime) : 0,
    duration: Number.isFinite(duration) ? Math.max(SHOW_MIN_CLIP_SECONDS, duration) : SHOW_DEFAULT_PRESET_SECONDS,
    transitionIn: (c.transitionIn as ShowPresetClip['transitionIn']) ?? 'cut',
    transitionDuration: Number.isFinite(Number(c.transitionDuration)) ? Number(c.transitionDuration) : 0.5,
    label: typeof c.label === 'string' ? c.label : undefined,
  };
}

/** True when the AssetRef alone can rebuild the runtime URL on load. */
function refIsDurable(ref: AssetRef | undefined): boolean {
  return !!(ref && (ref.originalPath || ref.projectPath || ref.dataUrl || ref.url));
}

export interface ShowTimelineSnapshot {
  version: number;
  isOpen: boolean;
  loop: boolean;
  zoom: number;
  snapEnabled: boolean;
  audioTracks: ShowAudioTrack[];
  presetClips: ShowPresetClip[];
}

export const showTimeline = {
  subscribe: store.subscribe,

  // ── Panel ──────────────────────────────────────────────────────────────

  toggleOpen() {
    store.update((s) => ({ ...s, isOpen: !s.isOpen }));
  },
  setOpen(open: boolean) {
    store.update((s) => ({ ...s, isOpen: open }));
  },
  select(selection: ShowTimelineSelection | null) {
    store.update((s) => ({ ...s, selection }));
  },
  setZoom(zoom: number) {
    store.update((s) => ({
      ...s,
      zoom: Math.max(SHOW_MIN_ZOOM, Math.min(SHOW_MAX_ZOOM, Number(zoom) || SHOW_DEFAULT_ZOOM)),
    }));
  },
  setSnapEnabled(enabled: boolean) {
    store.update((s) => ({ ...s, snapEnabled: enabled }));
  },
  setLoop(loop: boolean) {
    store.update((s) => ({ ...s, loop }));
  },

  // ── Transport ──────────────────────────────────────────────────────────

  play() {
    const s = get(store);
    if (s.isPlaying) return;
    // An empty show has nothing to play — stay completely inert.
    if (s.duration <= 0) return;
    syncAudioWiring(s.audioTracks);
    store.update((x) => ({ ...x, isPlaying: true }));
    // Re-evaluate at the current position. Fires only when the clip under
    // the playhead differs from what is loaded, so resuming from pause does
    // not reload (and visibly reset) the composition already on screen.
    // `stop()` clears activeClipId, so play-from-stop always re-fires.
    applyTime(get(store).currentTime, true);
    lastFrameTime = 0;
    if (typeof requestAnimationFrame === 'function') rafId = requestAnimationFrame(tick);
  },

  pause() {
    cancelRaf();
    store.update((s) => ({ ...s, isPlaying: false }));
    seekGeneration++;
  },

  stop() {
    cancelRaf();
    // Clearing activeClipId is what makes the next play() re-fire the
    // opening preset even if the operator hand-loaded something else.
    store.update((s) => ({ ...s, isPlaying: false, currentTime: 0, activeClipId: null }));
    seekGeneration++;
  },

  togglePlay() {
    if (get(store).isPlaying) this.pause();
    else this.play();
  },

  /**
   * Move the playhead. THE contract — the offline renderer calls exactly
   * this once per frame with its virtual time, and the UI scrub calls it
   * with the pointer position.
   */
  seek(seconds: number) {
    applyTime(seconds, true);
  },

  // ── Preset clips ───────────────────────────────────────────────────────

  /** Append a preset clip after everything already on the lane. */
  addPresetClip(compositionId: string, duration = SHOW_DEFAULT_PRESET_SECONDS, label?: string): string {
    const id = generateUUID();
    store.update((s) => {
      const end = s.presetClips.reduce((m, c) => Math.max(m, c.startTime + c.duration), 0);
      const clip: ShowPresetClip = {
        id,
        compositionId,
        startTime: end,
        duration: Math.max(SHOW_MIN_CLIP_SECONDS, duration),
        transitionIn: 'cut',
        transitionDuration: 0.5,
        label,
      };
      return withDuration({
        ...s,
        presetClips: [...s.presetClips, clip],
        selection: { kind: 'preset', id },
      });
    });
    return id;
  },

  /** Insert a preset clip at a specific time (drop from the preset tray). */
  insertPresetClipAt(compositionId: string, startTime: number, duration = SHOW_DEFAULT_PRESET_SECONDS, label?: string): string | null {
    const id = generateUUID();
    let inserted = false;
    store.update((s) => {
      const dur = Math.max(SHOW_MIN_CLIP_SECONDS, duration);
      const placed = placeOnLane(s.presetClips, startTime, dur);
      if (placed === null) return s;
      inserted = true;
      const clip: ShowPresetClip = {
        id,
        compositionId,
        startTime: placed,
        duration: dur,
        transitionIn: 'cut',
        transitionDuration: 0.5,
        label,
      };
      return withDuration({
        ...s,
        presetClips: [...s.presetClips, clip].sort((a, b) => a.startTime - b.startTime),
        selection: { kind: 'preset', id },
      });
    });
    return inserted ? id : null;
  },

  removePresetClip(clipId: string) {
    store.update((s) => {
      const presetClips = s.presetClips.filter((c) => c.id !== clipId);
      if (presetClips.length === s.presetClips.length) return s;
      return withDuration({
        ...s,
        presetClips,
        activeClipId: s.activeClipId === clipId ? null : s.activeClipId,
        selection: s.selection?.id === clipId ? null : s.selection,
      });
    });
  },

  /** Move a clip's start. Clamped into the free window; refused if it will
   *  not fit (see `placeOnLane`). */
  movePresetClip(clipId: string, startTime: number) {
    store.update((s) => {
      const clip = s.presetClips.find((c) => c.id === clipId);
      if (!clip) return s;
      const others = s.presetClips.filter((c) => c.id !== clipId);
      const snapped = snapShowTime(startTime, laneEdges(others), {
        enabled: s.snapEnabled,
        tolerance: snapTolerance(s.zoom),
      });
      const placed = placeOnLane(others, snapped, clip.duration);
      if (placed === null || Math.abs(placed - clip.startTime) < 1e-9) return s;
      return withDuration({
        ...s,
        presetClips: s.presetClips
          .map((c) => (c.id === clipId ? { ...c, startTime: placed } : c))
          .sort((a, b) => a.startTime - b.startTime),
      });
    });
  },

  /** Resize a clip. `edge: 'end'` drags the right handle; `'start'` drags
   *  the left one and holds the right edge still. */
  resizePresetClip(clipId: string, edge: 'start' | 'end', time: number) {
    store.update((s) => {
      const clip = s.presetClips.find((c) => c.id === clipId);
      if (!clip) return s;
      const others = s.presetClips.filter((c) => c.id !== clipId);
      const snapped = snapShowTime(time, laneEdges(others), {
        enabled: s.snapEnabled,
        tolerance: snapTolerance(s.zoom),
      });
      let startTime = clip.startTime;
      let duration = clip.duration;
      if (edge === 'end') {
        const room = maxDurationAt(others, clip.startTime);
        duration = Math.max(SHOW_MIN_CLIP_SECONDS, Math.min(snapped - clip.startTime, room));
      } else {
        const right = clip.startTime + clip.duration;
        const leftBound = others.reduce(
          (m, o) => (o.startTime + o.duration <= clip.startTime ? Math.max(m, o.startTime + o.duration) : m),
          0,
        );
        startTime = Math.max(leftBound, Math.min(snapped, right - SHOW_MIN_CLIP_SECONDS));
        duration = right - startTime;
      }
      if (Math.abs(startTime - clip.startTime) < 1e-9 && Math.abs(duration - clip.duration) < 1e-9) return s;
      return withDuration({
        ...s,
        presetClips: s.presetClips
          .map((c) => (c.id === clipId ? { ...c, startTime, duration } : c))
          .sort((a, b) => a.startTime - b.startTime),
      });
    });
  },

  updatePresetClip(clipId: string, updates: Partial<ShowPresetClip>) {
    store.update((s) => {
      const presetClips = s.presetClips.map((c) => (c.id === clipId ? { ...c, ...updates } : c));
      return withDuration({ ...s, presetClips });
    });
  },

  /** Re-flow every preset clip back-to-back from 0, keeping durations. */
  compactPresetClips() {
    store.update((s) => {
      let cursor = 0;
      const presetClips = [...s.presetClips]
        .sort((a, b) => a.startTime - b.startTime)
        .map((c) => {
          const next = { ...c, startTime: cursor };
          cursor += c.duration;
          return next;
        });
      return withDuration({ ...s, presetClips });
    });
  },

  // ── Audio tracks ───────────────────────────────────────────────────────

  /**
   * Add an audio file. Captures a durable AssetRef immediately (so the
   * track survives save/reload), measures the source length, and kicks off
   * the waveform decode in the background.
   */
  async addAudioTrackFromFile(file: File, opts: { startTime?: number; lane?: number } = {}): Promise<string | null> {
    if (!file) return null;
    const { assetRef, runtimeUrl } = createAssetRefFromFile(file);
    return this.addAudioTrack({
      name: file.name,
      url: runtimeUrl,
      assetRef,
      startTime: opts.startTime ?? 0,
      lane: opts.lane,
    });
  },

  async addAudioTrack(init: {
    name: string;
    url: string;
    assetRef?: AssetRef;
    startTime?: number;
    duration?: number;
    lane?: number;
  }): Promise<string | null> {
    const id = generateUUID();
    const state = get(store);
    const lane = init.lane ?? nextFreeLane(state.audioTracks, init.startTime ?? 0, init.duration ?? SHOW_MIN_CLIP_SECONDS);
    const track: ShowAudioTrack = {
      id,
      name: init.name || 'Audio',
      url: init.url,
      assetRef: init.assetRef,
      startTime: Math.max(0, init.startTime ?? 0),
      duration: Math.max(SHOW_MIN_CLIP_SECONDS, init.duration ?? SHOW_MIN_CLIP_SECONDS),
      offset: 0,
      sourceDuration: 0,
      volume: 1,
      muted: false,
      lane,
    };
    store.update((s) => withDuration({ ...s, audioTracks: [...s.audioTracks, track], selection: { kind: 'audio', id } }));
    ensureTrackElement(track);
    await this.analyzeAudioTrack(id);
    return id;
  },

  /**
   * Decode a track to learn its true length and waveform. Safe to call
   * repeatedly — the decode is cached per URL. Sets the timeline duration
   * to the full source length the first time it resolves.
   */
  async analyzeAudioTrack(trackId: string): Promise<void> {
    const track = get(store).audioTracks.find((t) => t.id === trackId);
    if (!track || !track.url) return;
    if (track.sourceDuration > 0 && track.peaks?.length) return;
    const decoded = await decodeShowAudio(track.url);
    if (!decoded) return;
    const peaks = computeAudioPeaks(decoded.mono);
    store.update((s) => {
      const audioTracks = s.audioTracks.map((t) => {
        if (t.id !== trackId) return t;
        // Only stretch to the full source length when the track was added
        // with a placeholder duration; a user-trimmed track keeps its trim.
        const grow = t.duration <= SHOW_MIN_CLIP_SECONDS + 1e-9;
        return {
          ...t,
          sourceDuration: decoded.duration,
          peaks,
          duration: grow ? Math.max(SHOW_MIN_CLIP_SECONDS, decoded.duration) : t.duration,
        };
      });
      return withDuration({ ...s, audioTracks });
    });
  },

  removeAudioTrack(trackId: string) {
    const track = get(store).audioTracks.find((t) => t.id === trackId);
    releaseTrackElement(trackId);
    if (track?.url) forgetShowAudioDecode(track.url);
    store.update((s) =>
      withDuration({
        ...s,
        audioTracks: s.audioTracks.filter((t) => t.id !== trackId),
        selection: s.selection?.id === trackId ? null : s.selection,
      }),
    );
  },

  moveAudioTrack(trackId: string, startTime: number, lane?: number) {
    store.update((s) => {
      const track = s.audioTracks.find((t) => t.id === trackId);
      if (!track) return s;
      const targetLane = lane === undefined ? track.lane : Math.max(0, Math.floor(lane));
      const others = s.audioTracks.filter((t) => t.id !== trackId && t.lane === targetLane);
      const snapped = snapShowTime(startTime, laneEdges(s.audioTracks.filter((t) => t.id !== trackId)), {
        enabled: s.snapEnabled,
        tolerance: snapTolerance(s.zoom),
      });
      const placed = placeOnLane(others, snapped, track.duration);
      if (placed === null) return s;
      if (placed === track.startTime && targetLane === track.lane) return s;
      return withDuration({
        ...s,
        audioTracks: s.audioTracks.map((t) =>
          t.id === trackId ? { ...t, startTime: placed, lane: targetLane } : t,
        ),
      });
    });
  },

  /**
   * Resize an audio track. The right edge trims the tail; the left edge
   * trims the head AND advances `offset` by the same amount so the audio
   * under the cursor does not slide.
   */
  resizeAudioTrack(trackId: string, edge: 'start' | 'end', time: number) {
    store.update((s) => {
      const track = s.audioTracks.find((t) => t.id === trackId);
      if (!track) return s;
      const others = s.audioTracks.filter((t) => t.id !== trackId && t.lane === track.lane);
      const snapped = snapShowTime(time, laneEdges(s.audioTracks.filter((t) => t.id !== trackId)), {
        enabled: s.snapEnabled,
        tolerance: snapTolerance(s.zoom),
      });
      let startTime = track.startTime;
      let duration = track.duration;
      let offset = track.offset;
      const sourceRemaining = track.sourceDuration > 0
        ? track.sourceDuration - track.offset
        : Number.POSITIVE_INFINITY;

      if (edge === 'end') {
        const room = Math.min(maxDurationAt(others, track.startTime), sourceRemaining);
        duration = Math.max(SHOW_MIN_CLIP_SECONDS, Math.min(snapped - track.startTime, room));
      } else {
        const right = track.startTime + track.duration;
        const leftBound = others.reduce(
          (m, o) => (o.startTime + o.duration <= track.startTime ? Math.max(m, o.startTime + o.duration) : m),
          0,
        );
        // Cannot trim the head back past the start of the file.
        const earliest = Math.max(leftBound, track.startTime - track.offset);
        startTime = Math.max(earliest, Math.min(snapped, right - SHOW_MIN_CLIP_SECONDS));
        offset = Math.max(0, track.offset + (startTime - track.startTime));
        duration = right - startTime;
      }
      if (
        Math.abs(startTime - track.startTime) < 1e-9 &&
        Math.abs(duration - track.duration) < 1e-9 &&
        Math.abs(offset - track.offset) < 1e-9
      ) {
        return s;
      }
      return withDuration({
        ...s,
        audioTracks: s.audioTracks.map((t) => (t.id === trackId ? { ...t, startTime, duration, offset } : t)),
      });
    });
  },

  setAudioTrackVolume(trackId: string, volume: number) {
    const v = Math.max(0, Math.min(1, Number(volume) || 0));
    store.update((s) => ({
      ...s,
      audioTracks: s.audioTracks.map((t) => (t.id === trackId ? { ...t, volume: v } : t)),
    }));
    clipAudioBus.setClipVolume(busIdFor(trackId), v);
  },

  setAudioTrackMuted(trackId: string, muted: boolean) {
    store.update((s) => ({
      ...s,
      audioTracks: s.audioTracks.map((t) => (t.id === trackId ? { ...t, muted } : t)),
    }));
    clipAudioBus.setClipMuted(busIdFor(trackId), muted);
  },

  renameAudioTrack(trackId: string, name: string) {
    store.update((s) => ({
      ...s,
      audioTracks: s.audioTracks.map((t) => (t.id === trackId ? { ...t, name } : t)),
    }));
  },

  // ── Whole-show ─────────────────────────────────────────────────────────

  clear() {
    cancelRaf();
    releaseAllTrackElements();
    store.update((s) => ({ ...createInitialState(), isOpen: s.isOpen, zoom: s.zoom, snapEnabled: s.snapEnabled }));
  },

  /** Total programmed length, seconds. The render modal seeds from this. */
  totalDuration(): number {
    return get(store).duration;
  },

  hasContent(): boolean {
    const s = get(store);
    return s.presetClips.length > 0 || s.audioTracks.length > 0;
  },

  // ── Persistence ────────────────────────────────────────────────────────

  /**
   * Durable state only. Runtime audio URLs are blanked whenever the
   * AssetRef can rebuild them on load — same contract as
   * projectionSimScene.exportForProject(). `isPlaying` / `currentTime` /
   * `activeClipId` are session state and never travel.
   */
  serialize(): ShowTimelineSnapshot {
    const s = get(store);
    return {
      version: 1,
      isOpen: s.isOpen,
      loop: s.loop,
      zoom: s.zoom,
      snapEnabled: s.snapEnabled,
      audioTracks: s.audioTracks.map((t) => ({
        ...t,
        url: refIsDurable(t.assetRef) ? '' : t.url,
      })),
      presetClips: s.presetClips.map((c) => ({ ...c })),
    };
  },

  /**
   * Project-open restore. Rebuilds every audio URL from its AssetRef
   * (project-dir aware, so a .gha handed to another machine still finds its
   * siblings) and reports anything that could not be found through the
   * standard missing-asset repair flow. Never auto-plays.
   */
  hydrate(payload: unknown, projectDir?: string): void {
    cancelRaf();
    releaseAllTrackElements();

    if (!payload || typeof payload !== 'object') {
      store.set(createInitialState());
      return;
    }
    const p = payload as Record<string, unknown>;
    const rawTracks = Array.isArray(p.audioTracks) ? p.audioTracks : [];
    const rawClips = Array.isArray(p.presetClips) ? p.presetClips : [];

    const audioTracks: ShowAudioTrack[] = [];
    rawTracks.forEach((raw, i) => {
      const track = normalizeTrack(raw, i);
      if (!track) return;
      const resolved = resolveAssetRefForRuntime(track.assetRef, projectDir, track.url) ?? '';
      if (!resolved && track.assetRef) {
        recordMissingAsset({ assetRef: track.assetRef, fieldHint: 'show timeline audio' });
      }
      audioTracks.push({ ...track, url: resolved });
    });

    const presetClips = rawClips
      .map((raw) => normalizeClip(raw))
      .filter((c): c is ShowPresetClip => c !== null)
      .sort((a, b) => a.startTime - b.startTime);

    const zoom = Number(p.zoom);
    store.set({
      isOpen: p.isOpen === true,
      isPlaying: false,
      currentTime: 0,
      duration: computeShowDuration(presetClips, audioTracks),
      loop: p.loop === true,
      audioTracks,
      presetClips,
      activeClipId: null,
      zoom: Number.isFinite(zoom) ? Math.max(SHOW_MIN_ZOOM, Math.min(SHOW_MAX_ZOOM, zoom)) : SHOW_DEFAULT_ZOOM,
      snapEnabled: p.snapEnabled !== false,
      selection: null,
    });

    syncAudioWiring(audioTracks);
    // Waveforms for tracks whose peaks did not travel (older saves).
    for (const t of audioTracks) {
      if (!t.peaks?.length && t.url) void this.analyzeAudioTrack(t.id);
    }
  },

  /** Test seam — tears the transport and audio elements down completely. */
  _resetForTest() {
    cancelRaf();
    releaseAllTrackElements();
    seekGeneration = 0;
    store.set(createInitialState());
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────

function laneEdges(items: Placeable[]): number[] {
  const edges: number[] = [];
  for (const o of items) {
    edges.push(o.startTime, o.startTime + o.duration);
  }
  return edges;
}

/** Snap radius in seconds for a given zoom — a constant 8 px on screen, so
 *  the magnet feels the same whether you are looking at 30 s or 30 min. */
function snapTolerance(zoom: number): number {
  return 8 / Math.max(1, zoom);
}

/** Lowest lane row where `[startTime, startTime + duration)` is free. */
function nextFreeLane(tracks: ShowAudioTrack[], startTime: number, duration: number): number {
  for (let lane = 0; lane < 64; lane++) {
    const occupied = tracks.some(
      (t) => t.lane === lane && startTime < t.startTime + t.duration && t.startTime < startTime + duration,
    );
    if (!occupied) return lane;
  }
  return 0;
}

// ─── Derived ─────────────────────────────────────────────────────────────

export const showTimelineIsOpen = derived(showTimeline, (s) => s.isOpen);
export const showTimelineIsPlaying = derived(showTimeline, (s) => s.isPlaying);
export const showTimelineDuration = derived(showTimeline, (s) => s.duration);
/** How many audio lane rows the panel has to draw (always at least one). */
export const showAudioLaneCount = derived(showTimeline, (s) =>
  Math.max(1, s.audioTracks.reduce((m, t) => Math.max(m, t.lane + 1), 0)),
);

/** Cached decode peek for the waveform renderer. */
export { cachedShowAudioDecode };
