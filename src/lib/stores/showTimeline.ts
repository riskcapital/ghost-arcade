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
 * TRANSITIONS (see the "Clip transitions" section below)
 * ------------------------------------------------------
 * A transition is an object that lives at the JUNCTION between two adjacent
 * preset clips, stored on the right-hand clip as `transitionIn` +
 * `transitionDuration` and seeded from the preset tray's own settings so the
 * two players match. It is CENTRED on the boundary — half of it reaches back
 * into the outgoing clip and half forward into the incoming one, the way
 * Premiere and CapCut place one — and is clamped so it can never be longer
 * than the material either neighbour has to give it.
 *
 * PRESETTRAY CONFLICT
 * -------------------
 * The show timeline OWNS scheduled preset changes. While it is playing,
 * PresetTray's auto-advance is stopped and cannot be restarted (its button
 * disables). Manual preset clicks still work as an operator punch-in; the
 * show takes back over at its next clip boundary.
 */

import { writable, derived, get } from 'svelte/store';
import type {
  ClipTransitionIn,
  CompositionTransitionStyle,
  ShowAudioTrack,
  ShowPresetClip,
} from '../types';
// Type-only: keeps this store loadable in vitest's node environment without
// dragging the renderer (and three.js behind it) into an arrangement test.
import type { ActiveCompositionTransition } from '../renderer/compositionTransitionLayers';
import { generateUUID } from '../utils/uuid';
import { getPresetTransitionSettings, isTransitionStyle } from './presetTransition';
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
/** Shortest transition that is still a transition and not a jump cut. One
 *  snap step, so dragging an edge can always reach it exactly. */
export const SHOW_MIN_TRANSITION_SECONDS = 0.25;
/** Length a transition dropped onto a junction is born with, before the
 *  neighbour clamp. Matches the preset tray's default feel. */
export const SHOW_DEFAULT_TRANSITION_SECONDS = 1;
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
  /** 'transition' selects the junction element sitting on `id`'s LEFT edge —
   *  the transition is stored on that clip, but it is a separate selectable
   *  object on the timeline with its own inspector. */
  kind: 'audio' | 'preset' | 'transition';
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

// ─── Clip transitions ────────────────────────────────────────────────────
//
// SEMANTICS: CENTRED ON THE JUNCTION.
// -----------------------------------
// A transition is an OBJECT sitting at the junction between two adjacent
// clips, stored on the right-hand clip as `transitionIn` +
// `transitionDuration`. A `D`-second transition at boundary `t0` runs over
// `[t0 - D/2, t0 + D/2)` — half reaching back into the outgoing clip, half
// forward into the incoming one. That is where Premiere and CapCut put one
// by default, and it is what makes the timeline element the user drags a
// truthful picture of when the blend is on screen.
//
// This REPLACES the original start-at semantics, where the blend ran forward
// over `[startTime, startTime + D)`. That was forced by the old mechanism:
// `engine.startTransition()` froze the outgoing composite and cross-faded
// the snapshot out, so nothing could happen before the swap. The native
// implementation has no snapshot — it puts BOTH compositions' layers in the
// scene at once (renderer/compositionTransitionLayers.ts) — so the blend can
// start before the boundary without the incoming composition being "live"
// yet.
//
// THE ONE RULE STILL HOLDS. `findActiveShowClip` still decides which clip is
// live, and `loadComposition` still fires only when that answer changes, at
// `t0` exactly. During `[t0 - D/2, t0)` the OUTGOING composition is the
// loaded one and the incoming is a transient clone; after `t0` the roles
// reverse. Both halves publish the same `{from, to, progress}`, so the layer
// builder sees one continuous blend across the swap.
//
// ADJACENCY. A transition needs two clips actually touching. Across a gap
// there is nothing to transition FROM at the moment the blend would start —
// the outgoing picture is being held, not played — so a gap is a hard cut.
//
// DETERMINISM. `progress` is a pure function of (clips, show time). A cold
// `seek()` into the middle of a transition resolves to exactly the same
// state as playing into it, with no animation left to run, which is what
// lets the offline renderer honour transitions at all: it calls `seek()`
// once per virtual frame and gets a reproducible blend every time.
//
// STACKING. The effective duration is clamped to the shorter neighbour,
// which (because the window is centred, so each side only spends D/2) means
// two adjacent transitions can touch but never overlap.

/**
 * A resolved transition at one instant of show time. Everything the renderer
 * needs, and nothing that depends on when it was asked.
 */
export interface ShowTransitionPlan {
  style: CompositionTransitionStyle;
  /** The clip whose LEFT junction owns this transition. */
  clipId: string;
  fromCompositionId: string;
  toCompositionId: string;
  /** Effective (clamped) window length, seconds. */
  durationSeconds: number;
  /** Show time the blend starts, `t0 - durationSeconds / 2`. */
  startSeconds: number;
  /** Show time the blend ends, `t0 + durationSeconds / 2`. */
  endSeconds: number;
  /** 0 = outgoing fully live, 1 = incoming fully live. */
  progress: number;
}

/** Legacy WebGL shader style names that may still be sitting in project
 *  files. They never ran in this build — see types.ts `TransitionStyle`. */
const LEGACY_TRANSITION_STYLES = new Set<string>([
  'wipeUp', 'wipeDown', 'wipeLeft', 'wipeRight',
  'wave', 'iris', 'voxelize', 'warp', 'explode', 'pixelMelt',
]);

/**
 * Map a clip's `transitionIn` onto a style the native renderer implements.
 *
 * null means "hard cut" — 'cut', a missing value, or junk from a hand-edited
 * file. 'fade' / 'crossfade' are the legacy VJ-timeline values and every
 * `TransitionStyle` member is a legacy WebGL shader name; all of them mean
 * "there IS a blend here", so they resolve to 'dissolve' rather than
 * silently becoming a cut.
 */
export function resolveTransitionStyle(
  value: ClipTransitionIn | undefined,
): CompositionTransitionStyle | null {
  if (!value || value === 'cut') return null;
  if (value === 'fade' || value === 'crossfade') return 'dissolve';
  if (LEGACY_TRANSITION_STYLES.has(value)) return 'dissolve';
  return isTransitionStyle(value) ? value : null;
}

/**
 * Longest transition the junction on `next`'s left edge can actually hold:
 * never longer than `next` itself, and never longer than the clip before it.
 *
 * The window is centred, so a `D`-second transition only ever spends `D/2`
 * inside each neighbour — clamping `D` to the shorter neighbour's FULL
 * length therefore leaves both halves comfortably inside their clips AND
 * guarantees two adjacent junctions can touch but never overlap (each takes
 * at most half of the clip they share).
 */
export function clampShowTransitionDuration(
  requested: number | undefined,
  next: Pick<ShowPresetClip, 'duration'>,
  prev: Pick<ShowPresetClip, 'duration'> | null,
): number {
  const want = Number(requested);
  if (!Number.isFinite(want) || want <= 0) return 0;
  let limit = Math.max(0, next.duration);
  if (prev) limit = Math.min(limit, Math.max(0, prev.duration));
  return Math.max(0, Math.min(want, limit));
}

/**
 * The clip on the other side of `next`'s left junction: the one whose end
 * meets `next.startTime`.
 *
 * ADJACENCY IS REQUIRED. An earlier version of this reached back across a
 * gap, on the reasoning that the last-fired composition is still on screen
 * through a hole. A centred transition cannot use that: it would start
 * mid-gap, where nothing is playing, and the timeline would have to draw a
 * transition element straddling a boundary that is not a junction. Premiere
 * does not put a transition on a gap either — so neither does this.
 */
export function findJunctionPredecessor(
  clips: ShowPresetClip[],
  next: Pick<ShowPresetClip, 'id' | 'startTime'>,
): ShowPresetClip | null {
  for (const c of clips) {
    if (c.id === next.id) continue;
    if (Math.abs(c.startTime + c.duration - next.startTime) <= 1e-6) return c;
  }
  return null;
}

/** The centred window a clip's transition occupies, or null for a hard cut.
 *  Exported for the timeline UI, which draws the element from exactly this. */
export function showTransitionWindow(
  clips: ShowPresetClip[],
  next: ShowPresetClip,
): { start: number; end: number; duration: number; style: CompositionTransitionStyle; prev: ShowPresetClip } | null {
  const style = resolveTransitionStyle(next.transitionIn);
  if (!style) return null;
  const prev = findJunctionPredecessor(clips, next);
  if (!prev) return null;
  const duration = clampShowTransitionDuration(next.transitionDuration, next, prev);
  if (duration <= 0) return null;
  const half = duration / 2;
  return { start: next.startTime - half, end: next.startTime + half, duration, style, prev };
}

/** Ceiling the UI clamps a drag-resize against — the same limit
 *  `clampShowTransitionDuration` applies, exposed so the element can stop
 *  growing instead of silently reporting a shorter number. */
export function maxShowTransitionDuration(
  clips: ShowPresetClip[],
  next: ShowPresetClip,
): number {
  const prev = findJunctionPredecessor(clips, next);
  if (!prev) return 0;
  return Math.max(0, Math.min(next.duration, prev.duration));
}

/**
 * Resolve `next`'s junction transition at show time `time`. Pure — the
 * transport, a scrub and the offline renderer all get the identical answer
 * for the identical inputs.
 *
 * Returns null for a hard cut or when `time` is outside the window.
 */
export function resolveShowTransition(
  clips: ShowPresetClip[],
  next: ShowPresetClip,
  time: number,
): ShowTransitionPlan | null {
  const win = showTransitionWindow(clips, next);
  if (!win) return null;
  if (time < win.start - 1e-9 || time >= win.end) return null;
  // A composition blending into itself is a no-op that would only double the
  // scene's layer count — call it a cut.
  if (win.prev.compositionId === next.compositionId) return null;
  const progress = Math.max(0, Math.min(1, (time - win.start) / win.duration));
  return {
    style: win.style,
    clipId: next.id,
    fromCompositionId: win.prev.compositionId,
    toCompositionId: next.compositionId,
    durationSeconds: win.duration,
    startSeconds: win.start,
    endSeconds: win.end,
    progress,
  };
}

/**
 * The one transition in flight at `time`, if any. Windows cannot overlap
 * (see the stacking clamp), so the first match is the only match.
 */
export function resolveShowTransitionAt(
  clips: ShowPresetClip[],
  time: number,
): ShowTransitionPlan | null {
  for (const clip of clips) {
    const plan = resolveShowTransition(clips, clip, time);
    if (plan) return plan;
  }
  return null;
}

/** Transition fields a brand-new clip is born with — whatever the preset
 *  tray is currently set to, so the two players feel like one feature. */
export function defaultClipTransition(): {
  transitionIn: ClipTransitionIn;
  transitionDuration: number;
} {
  const s = getPresetTransitionSettings();
  return {
    transitionIn: s.enabled ? s.style : 'cut',
    transitionDuration: s.duration,
  };
}

// ─── Composition loader injection ────────────────────────────────────────

export interface ShowCompositionLoadOptions {
  restoreTransports: boolean;
}
export type ShowCompositionLoader = (
  compositionId: string,
  options: ShowCompositionLoadOptions,
) => void;

/**
 * Publishes the transition state for the CURRENT instant, recomputed on
 * every `seek()`. `null` means "nothing is blending right now".
 *
 * Injected for the same reason the loader is: this store is deliberately
 * component-free so the offline renderer can drive it with nothing mounted.
 * App.svelte points it at `compositionTransition.driveFromClock`, which is
 * what Canvas.svelte reads when it builds the native scene.
 *
 * NOT a fire-and-forget "start a 4-second animation" call. The old seam was
 * exactly that (`startTransition(duration, style)` on the WebGL engine) and
 * it is why transitions could never be deterministic — the blend ran off
 * `performance.now()`, so the same virtual frame of an export blended by a
 * different amount on every run, and a cold seek into the middle of one had
 * nothing to resume from. Publishing a resolved `progress` per evaluation
 * makes a scrub, a playing transport and an offline render agree exactly.
 *
 * Left unregistered (headless tests) every boundary is a hard cut.
 */
export type ShowTransitionSink = (transition: ActiveCompositionTransition | null) => void;

let compositionLoader: ShowCompositionLoader | null = null;
let transitionSink: ShowTransitionSink | null = null;
let lazyLoaderRequested = false;
/** Last value handed to the sink, so a settled scene is not re-published
 *  (and the native layer stack not re-flushed) on every idle frame. */
let lastPublishedTransition: ActiveCompositionTransition | null = null;

/** Registered by `layers.ts` at module init. Also the seam tests use. */
export function setShowCompositionLoader(loader: ShowCompositionLoader | null): void {
  compositionLoader = loader;
}

/** Registered by `App.svelte`, next to the preset tray's `onBeforeLoad`. */
export function setShowTransitionSink(sink: ShowTransitionSink | null): void {
  transitionSink = sink;
  lastPublishedTransition = null;
}

function publishTransition(plan: ShowTransitionPlan | null): void {
  const next: ActiveCompositionTransition | null = plan
    ? {
        style: plan.style,
        progress: plan.progress,
        fromCompositionId: plan.fromCompositionId,
        toCompositionId: plan.toCompositionId,
      }
    : null;
  const prev = lastPublishedTransition;
  if (
    prev === next ||
    (prev !== null &&
      next !== null &&
      prev.style === next.style &&
      prev.fromCompositionId === next.fromCompositionId &&
      prev.toCompositionId === next.toCompositionId &&
      Math.abs(prev.progress - next.progress) < 1e-6)
  ) {
    return;
  }
  lastPublishedTransition = next;
  if (!transitionSink) return;
  try {
    transitionSink(next);
  } catch (err) {
    console.warn('[ShowTimeline] transition publish failed:', err);
  }
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
  const manual = isManualClock();

  // No transition call here any more. The blend is not an event fired at the
  // boundary — it is state resolved from show time on every evaluation (see
  // `publishTransition` in applyTime), which is what makes it survive a cold
  // seek and reproduce exactly under an offline render's virtual clock.
  try {
    // Live: let loadComposition restore the preset's own sequencer /
    // keyframe transports, so each preset starts its animation clean at its
    // boundary — that IS the intent of a programmed show.
    //
    // Offline export: the render loop owns keyframeTimeline / layerSequencer
    // and seeks them per frame. loadComposition's deferred `seek(0); play()`
    // lands a microtask later and would fight it, so suppress it entirely.
    loader(clip.compositionId, { restoreTransports: !manual });
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

  // Every evaluation, not just boundary crossings: `progress` moves on every
  // frame of the window, and it has to be resolved from `evalTime` alone so
  // a cold seek lands in the same state playback would have reached.
  //
  // AFTER the load, because the layer builder decides which side of the
  // blend is the transient clone by comparing against the project's active
  // composition id.
  publishTransition(resolveShowTransitionAt(s.presetClips, evalTime));
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

/** Accept only values the transition resolver understands; anything else
 *  (typo in a hand-edited file, a style removed from a later build) reports
 *  as unknown so the caller can fall back rather than silently hard-cut.
 *  Legacy WebGL style names are normalized to 'dissolve' on the way in, so a
 *  show saved by an older build keeps a blend at every junction that had
 *  one instead of inheriting whatever the tray happens to be set to. */
function normalizeTransitionIn(raw: unknown): ClipTransitionIn | null {
  if (raw === 'cut' || raw === 'fade' || raw === 'crossfade') return raw;
  if (typeof raw === 'string' && LEGACY_TRANSITION_STYLES.has(raw)) return 'dissolve';
  return isTransitionStyle(raw) ? raw : null;
}

function normalizeClip(raw: unknown): ShowPresetClip | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  if (typeof c.compositionId !== 'string' || !c.compositionId) return null;
  const duration = Number(c.duration);
  const startTime = Number(c.startTime);
  // A clip that names no transition predates the feature (or was hand
  // written) — inherit the preset tray's setting rather than forcing a cut,
  // so an older show picks the crossfades up on first open.
  const fallback = defaultClipTransition();
  const transitionIn = normalizeTransitionIn(c.transitionIn) ?? fallback.transitionIn;
  const transitionDuration = Number(c.transitionDuration);
  return {
    id: typeof c.id === 'string' && c.id ? c.id : generateUUID(),
    compositionId: c.compositionId,
    startTime: Number.isFinite(startTime) ? Math.max(0, startTime) : 0,
    duration: Number.isFinite(duration) ? Math.max(SHOW_MIN_CLIP_SECONDS, duration) : SHOW_DEFAULT_PRESET_SECONDS,
    transitionIn,
    transitionDuration: Number.isFinite(transitionDuration) && transitionDuration >= 0
      ? transitionDuration
      : fallback.transitionDuration,
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
    // Transport start is the moment audio has to be ready. A context built
    // outside a user gesture starts suspended (browser / mobile builds) and
    // would play nothing at all; `resume()` also un-does an explicit
    // `suspend()` and arms the click-to-enable fallback if the policy still
    // refuses. Cheap and idempotent when the context is already running.
    clipAudioBus.resume();
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
    // A stop mid-blend must not leave the outgoing composition's layers
    // resident in the scene forever.
    publishTransition(null);
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
        ...defaultClipTransition(),
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
        ...defaultClipTransition(),
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

  // ── Junction transitions ───────────────────────────────────────────────
  //
  // A transition is an object on the timeline, not a property in a form.
  // It is STORED on the right-hand clip (`transitionIn` +
  // `transitionDuration`) because that is the shape the project file has
  // always had — but every entry point here is addressed by the junction it
  // sits on, which is how the user thinks about it.

  /**
   * Put a transition on the junction at `clipId`'s left edge. Refused when
   * there is no clip butted up against it — a transition needs two clips.
   * Returns true when one now exists there.
   */
  addTransitionAt(clipId: string, style?: CompositionTransitionStyle, durationSeconds?: number): boolean {
    let created = false;
    store.update((s) => {
      const clip = s.presetClips.find((c) => c.id === clipId);
      if (!clip) return s;
      const prev = findJunctionPredecessor(s.presetClips, clip);
      if (!prev) return s;
      const defaults = defaultClipTransition();
      const fallbackStyle = resolveTransitionStyle(defaults.transitionIn) ?? 'dissolve';
      const want = durationSeconds
        ?? (defaults.transitionDuration > 0 ? defaults.transitionDuration : SHOW_DEFAULT_TRANSITION_SECONDS);
      const ceiling = Math.max(0, Math.min(clip.duration, prev.duration));
      const duration = Math.max(SHOW_MIN_TRANSITION_SECONDS, Math.min(want, ceiling));
      if (ceiling < SHOW_MIN_TRANSITION_SECONDS) return s;
      created = true;
      return {
        ...s,
        presetClips: s.presetClips.map((c) =>
          c.id === clipId
            ? { ...c, transitionIn: style ?? fallbackStyle, transitionDuration: duration }
            : c,
        ),
        selection: { kind: 'transition', id: clipId },
      };
    });
    return created;
  },

  /** Back to a hard cut. The clip itself is untouched. */
  removeTransitionAt(clipId: string) {
    store.update((s) => ({
      ...s,
      presetClips: s.presetClips.map((c) =>
        c.id === clipId ? { ...c, transitionIn: 'cut' as ClipTransitionIn } : c,
      ),
      selection: s.selection?.kind === 'transition' && s.selection.id === clipId ? null : s.selection,
    }));
  },

  /** Set the length of an existing junction transition, clamped against both
   *  neighbours. Dragging either edge of the element lands here. */
  setTransitionDuration(clipId: string, durationSeconds: number) {
    store.update((s) => {
      const clip = s.presetClips.find((c) => c.id === clipId);
      if (!clip) return s;
      const ceiling = maxShowTransitionDuration(s.presetClips, clip);
      if (ceiling <= 0) return s;
      const raw = Number(durationSeconds);
      if (!Number.isFinite(raw)) return s;
      const snapped = s.snapEnabled
        ? snapShowTime(raw, [], { enabled: true, tolerance: snapTolerance(s.zoom) })
        : raw;
      const next = Math.max(SHOW_MIN_TRANSITION_SECONDS, Math.min(snapped, ceiling));
      if (Math.abs(next - (clip.transitionDuration ?? 0)) < 1e-9) return s;
      return {
        ...s,
        presetClips: s.presetClips.map((c) => (c.id === clipId ? { ...c, transitionDuration: next } : c)),
      };
    });
  },

  setTransitionStyle(clipId: string, style: CompositionTransitionStyle) {
    store.update((s) => ({
      ...s,
      presetClips: s.presetClips.map((c) => (c.id === clipId ? { ...c, transitionIn: style } : c)),
    }));
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
    publishTransition(null);
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
    publishTransition(null);

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
    publishTransition(null);
    lastPublishedTransition = null;
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
