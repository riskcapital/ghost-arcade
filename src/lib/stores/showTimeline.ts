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
  KeyframeEasing,
  ClipTransitionIn,
  CompositionTransitionStyle,
  KeyframeTrack,
  Layer,
  ShowAudioTrack,
  ShowCameraClip,
  ShowClipEndBehaviour,
  ShowClipMedia,
  ShowLayerClip,
  ShowLayerTrack,
  ShowPresetClip,
  ShowSnapGrid,
  ShowTempoMap,
} from '../types';
// Type-only: keeps this store loadable in vitest's node environment without
// dragging the renderer (and three.js behind it) into an arrangement test.
import type { ActiveCompositionTransition } from '../renderer/compositionTransitionLayers';
import { generateUUID } from '../utils/uuid';
import { getPresetTransitionSettings, isTransitionStyle } from './presetTransition';
import { clipAudioBus, type ClipAudioTransport } from '../audio/clipAudioBus';
import { isVisualAudioManualClock } from '../audio/visualAudio';
import {
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
import {
  convertShowAudioPath,
  prepareShowAudioFile,
  probeMediaDuration,
  unplayableAudioMessage,
} from '../audio/showAudioImport';
import { ShowTransportClock, readAudioClock, type AudioClockContext } from '../show/showTransportClock';
import { showToast } from './errorToast';
import {
  placeOnLane,
  maxDurationAt,
  type Placeable,
  SHOW_MIN_TRACK_CLIP_SECONDS,
  deleteClips,
  duplicateClips,
  insertClip,
  maxClipDurationForMedia,
  moveClipTo,
  moveClips,
  moveClipsAcrossTracks,
  pasteClips,
  rippleDelete,
  shiftLaneKeys,
  splitClip,
  trimClip,
} from '../show/tracks/showTrackEdit';
import {
  clipEnd,
  evaluateShowTracks,
  findClipAt,
  showTrackFrameSignature,
  type ShowTrackFrame,
} from '../show/tracks/showTrackEval';
import { nearestGridTime, normalizeTempoMap } from '../show/tempoMap';
import {
  addLane,
  evaluateLanes,
  moveLaneKey,
  removeLane,
  removeLaneKeys,
  setLaneKey,
  setLaneKeyEasing,
  shiftKeysOnLane,
  type LaneParam,
} from '../show/tracks/showTrackLanes';
import { clampShowTransitionDuration, findJunctionPredecessor } from '../show/showJunctions';
import { resolveAssetTreeInPlace } from '../storage/assetRegistry';
import {
  amendLastHistoryStep,
  isRestoringHistory,
  recordDiscreteAction,
  scheduleHistorySnapshot,
} from './historyHooks';

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
  kind: 'audio' | 'preset' | 'transition' | 'layerClip' | 'track' | 'keyframe' | 'tempo';
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
  /** What happens when a show that does not loop reaches its end. */
  endAction: ShowEndAction;
  /** Layer tracks, top to bottom. */
  layerTracks: ShowLayerTrack[];
  /** The beat grid, or null for a show measured in seconds only. */
  tempo: ShowTempoMap | null;
  rulerMode: 'time' | 'bars';
  snapGrid: ShowSnapGrid;
  /** Selected layer clips (multi-select). */
  selectedClipIds: string[];
  /** Session only: the one track left visible. */
  soloTrackId: string | null;
  /** Stage-camera shots along the show. */
  cameraLane: ShowCameraClip[];
}

/**
 * What a show that does not loop does at its end:
 *  - hold:     the transport stops on the end and the last look stays up
 *  - rewind:   back to the start, with the opening look cued
 *  - blackout: the outputs go to black (Blackout in the top bar)
 */
export type ShowEndAction = 'hold' | 'rewind' | 'blackout';
export const SHOW_END_ACTIONS: readonly ShowEndAction[] = ['hold', 'rewind', 'blackout'];

export function normalizeShowEndAction(value: unknown): ShowEndAction {
  return SHOW_END_ACTIONS.includes(value as ShowEndAction) ? (value as ShowEndAction) : 'hold';
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
    endAction: 'hold',
    layerTracks: [],
    tempo: null,
    rulerMode: 'time',
    snapGrid: 'seconds',
    selectedClipIds: [],
    soloTrackId: null,
    cameraLane: [],
  };
}

/** Pixels per second that fit `duration` into `width` pixels, within the zoom range. */
export function fitShowZoom(duration: number, width: number): number {
  if (!(duration > 0) || !(width > 0)) return SHOW_DEFAULT_ZOOM;
  return Math.max(SHOW_MIN_ZOOM, Math.min(SHOW_MAX_ZOOM, width / duration));
}

// ─── Pure arrangement maths (exported for tests) ─────────────────────────

/** Content length of a show: the furthest edge of anything on it. */
export function computeShowDuration(
  clips: Pick<ShowPresetClip, 'startTime' | 'duration'>[],
  tracks: Pick<ShowAudioTrack, 'startTime' | 'duration'>[],
  layerTracks: Pick<ShowLayerTrack, 'clips'>[] = [],
  cameraLane: Pick<ShowCameraClip, 'startTime' | 'duration'>[] = [],
): number {
  let end = 0;
  for (const c of clips) end = Math.max(end, c.startTime + c.duration);
  for (const t of tracks) end = Math.max(end, t.startTime + t.duration);
  for (const lt of layerTracks) for (const c of lt.clips) end = Math.max(end, c.startTime + c.duration);
  for (const c of cameraLane) end = Math.max(end, c.startTime + c.duration);
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
  opts: {
    enabled: boolean;
    grid?: number;
    tolerance: number;
    /** The nearest line of a musical grid (the tempo map). When given it
     *  replaces the plain (magnetic) seconds grid, and always applies. */
    nearestGrid?: (time: number) => number;
  },
): number {
  const t = Math.max(0, Number.isFinite(time) ? time : 0);
  if (!opts.enabled) return t;
  const grid = opts.nearestGrid ? 0 : (opts.grid ?? SHOW_SNAP_SECONDS);
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
  if (opts.nearestGrid) {
    // A musical grid is not magnetic: with snap on, things land on the
    // nearest line wherever they are dropped, as in a DAW. Edges, the
    // playhead and markers still win when they are within reach and nearer.
    const line = Number(opts.nearestGrid(t));
    if (Number.isFinite(line) && line >= 0) {
      best = line;
      bestDelta = Math.min(opts.tolerance, Math.abs(line - t));
    }
  } else if (grid > 0) consider(Math.round(t / grid) * grid);
  consider(0);
  for (const e of edges) consider(e);
  // Kill float dust from the grid multiply so saved values stay readable.
  return Math.max(0, Math.round(best * 1e6) / 1e6);
}

// Lane placement is shared with the layer tracks.
export { placeOnLane, maxDurationAt, type Placeable } from '../show/tracks/showTrackEdit';

/**
 * Time inside the preset that is showing at show time `time`: show time minus
 * the start of the preset clip that is live (or, in a gap, of the last clip
 * that ended before it, whose look is being held). Before the first clip it
 * is show time itself.
 *
 * Live playback restarts each preset's own keyframes at 0 on its boundary
 * (loadComposition), so an offline render has to drive them with this, not
 * with show time, to land on the same frame.
 */
export function presetLocalTimeAt(clips: ShowPresetClip[], time: number): number {
  const t = Number.isFinite(time) ? Math.max(0, time) : 0;
  const active = findActiveShowClip(clips, t);
  if (active) return Math.max(0, t - active.startTime);
  let held: ShowPresetClip | null = null;
  for (const c of clips) {
    if (c.startTime + c.duration <= t && (!held || c.startTime > held.startTime)) held = c;
  }
  return held ? Math.max(0, t - held.startTime) : t;
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

// The junction rules are shared with the layer tracks' crossfades.
export { clampShowTransitionDuration, findJunctionPredecessor } from '../show/showJunctions';

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

/**
 * Publishes the layer tracks' state for the current instant (see
 * show/tracks/showTrackEval.ts). Injected for the same reason as the
 * transition sink; App.svelte points it at the `showTrackFrame` store that
 * Canvas builds the native scene from. Called on every evaluation, but only
 * a frame that differs in what the scene needs is handed on.
 */
export type ShowTrackFrameSink = (frame: ShowTrackFrame | null) => void;
let trackFrameSink: ShowTrackFrameSink | null = null;
let lastTrackFrameSignature: string | null = null;
let lastTrackFrame: ShowTrackFrame | null = null;

export function setShowTrackFrameSink(sink: ShowTrackFrameSink | null): void {
  trackFrameSink = sink;
  lastTrackFrameSignature = null;
  if (sink) sink(lastTrackFrame);
}

/** The most recent layer-track frame, whether or not it was published. */
export function currentShowTrackFrame(): ShowTrackFrame | null {
  return lastTrackFrame;
}

function publishTrackFrame(s: ShowTimelineState, evalTime: number, force = false): void {
  if (!s.layerTracks.length) {
    if (lastTrackFrame !== null || force) {
      lastTrackFrame = null;
      lastTrackFrameSignature = null;
      try { trackFrameSink?.(null); } catch (err) { console.warn('[ShowTimeline] track frame publish failed:', err); }
    }
    return;
  }
  const frame = evaluateShowTracks(s.layerTracks, evalTime, {
    playing: s.isPlaying,
    seekGeneration,
    soloTrackId: s.soloTrackId,
    manualClock: isManualClock(),
    laneValues: (track, t) => (track.lanes.length ? evaluateLanes(track.lanes, t) : null),
    evaluatedAtMs: typeof performance !== 'undefined' ? performance.now() : undefined,
  });
  lastTrackFrame = frame;
  const signature = showTrackFrameSignature(frame);
  if (!force && signature === lastTrackFrameSignature) return;
  lastTrackFrameSignature = signature;
  try {
    trackFrameSink?.(frame);
  } catch (err) {
    console.warn('[ShowTimeline] track frame publish failed:', err);
  }
}

/** Re-publish the tracks after an edit, at the playhead. */
function republishTracks(): void {
  const s = get(store);
  const dur = s.duration;
  const evalTime = !s.loop && dur > 0 && s.currentTime >= dur ? Math.max(0, dur - 1e-6) : s.currentTime;
  publishTrackFrame(s, evalTime, true);
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
/** The playhead's clock: the sound card while the show has audio, animation frames otherwise. */
const transportClock = new ShowTransportClock();
type AudioClockReader = (performanceNowMs: number) => number | null;
const defaultAudioClockReader: AudioClockReader = (nowMs) =>
  readAudioClock(clipAudioBus.contextIfReady() as AudioClockContext | null, nowMs);
let audioClockReader: AudioClockReader | null = defaultAudioClockReader;

/** Test seam: replace the audio clock (null = no audio clock). */
export function setShowAudioClockReader(reader: AudioClockReader | null | 'default'): void {
  audioClockReader = reader === 'default' ? defaultAudioClockReader : reader;
  transportClock.reset();
}

/** True while the show has a track the audio engine is playing from. */
function showHasAudibleTracks(s: ShowTimelineState): boolean {
  return s.audioTracks.some((t) => !t.muted && !!t.url && t.volume > 0);
}

export type ShowTransportEvent = { type: 'start' } | { type: 'end'; action: ShowEndAction };
type ShowTransportSink = (event: ShowTransportEvent) => void;
let transportSink: ShowTransportSink | null = null;

/** Registered by the show panel: carries out the end-of-show blackout. */
export function setShowTransportSink(sink: ShowTransportSink | null): void {
  transportSink = sink;
}

function notifyTransport(event: ShowTransportEvent): void {
  try {
    transportSink?.(event);
  } catch (err) {
    console.warn('[ShowTimeline] transport sink failed:', err);
  }
}
// ─── Undo ────────────────────────────────────────────────────────────────
//
// Show edits are undoable like any other edit: every step App.svelte records
// carries `exportArrangement()`, and undo hands it back through
// `restoreArrangement()`. A one-shot edit records its own step; a drag or a
// slider, which calls the same method many times, coalesces into one step
// keyed on what is being edited.

/** Ids of audio tracks still being measured right after they were added;
 *  their step is recorded once the length is known. */
const tracksAwaitingFirstStep = new Set<string>();

function recordShowEdit(continuousKey?: string): void {
  if (isRestoringHistory()) return;
  if (continuousKey) scheduleHistorySnapshot(`show:${continuousKey}`);
  else recordDiscreteAction();
}

/** Told when the whole show is cleared or another one is loaded (a live
 *  takeover of the old show's surfaces ends there). */
const resetListeners = new Set<() => void>();
export function onShowTimelineReset(listener: () => void): () => void {
  resetListeners.add(listener);
  return () => resetListeners.delete(listener);
}
function notifyReset(): void {
  for (const listener of resetListeners) {
    try { listener(); } catch (err) { console.warn('[ShowTimeline] reset listener failed:', err); }
  }
}

/** Extra snap targets from outside the store: the cue list's markers. */
let snapEdgeProvider: (() => number[]) | null = null;
export function setShowSnapEdgeProvider(provider: (() => number[]) | null): void {
  snapEdgeProvider = provider;
}

/** True while an external clock (timecode chase) owns the playhead. The
 *  RAF transport stays off and play() defers to it. */
let externalClock = false;

/** Play / Pause / Stop while an external clock owns the playhead go here
 *  first (Link's quantised start waits for the next Link bar). */
export type ShowChaseTransportHandler = (op: 'play' | 'pause' | 'stop') => boolean;
let chaseTransportHandler: ShowChaseTransportHandler | null = null;
export function setShowChaseTransportHandler(handler: ShowChaseTransportHandler | null): void {
  chaseTransportHandler = handler;
}
/** A chased position further than this from the playhead is a jump: the
 *  audio bus hard-seeks instead of rate-nudging toward it. */
export const SHOW_CHASE_RESEEK_SECONDS = 0.25;

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
  publishTrackFrame(get(store), evalTime);
}

function tick(now: number): void {
  rafId = null;
  const s = get(store);
  if (!s.isPlaying) return;

  const audio = audioClockReader && showHasAudibleTracks(s) ? audioClockReader(now) : null;
  let next = transportClock.advance({ frame: now / 1000, audio }, s.currentTime);

  const dur = s.duration;
  if (dur > 0 && next >= dur) {
    if (s.loop) {
      const wrapped = ((next % dur) + dur) % dur;
      // Keep the clock anchor: only the show time moves back by whole passes.
      transportClock.shift(wrapped - next);
      next = wrapped;
      applyTime(next, true); // wrap is a discontinuity for the audio bus
      rafId = requestAnimationFrame(tick);
      return;
    }
    applyTime(dur, true);
    store.update((x) => ({ ...x, isPlaying: false }));
    transportClock.reset();
    republishTracks();
    finishShow(s.endAction);
    return;
  }

  applyTime(next, false);
  rafId = requestAnimationFrame(tick);
}

/** The end of a show that does not loop. */
function finishShow(action: ShowEndAction): void {
  if (action === 'rewind') {
    seekGeneration++;
    store.update((x) => ({ ...x, isPlaying: false, currentTime: 0, activeClipId: null }));
    publishTransition(null);
    // Cue the opening look so the next run starts from it.
    applyTime(0, true);
  }
  notifyTransport({ type: 'end', action });
}

/** Recompute duration + reselect after any structural mutation. */
function withDuration(s: ShowTimelineState): ShowTimelineState {
  return { ...s, duration: computeShowDuration(s.presetClips, s.audioTracks, s.layerTracks, s.cameraLane) };
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

const CLIP_MEDIA_KINDS = new Set(['video', 'image', 'shader', 'sketch', 'layer']);
const END_BEHAVIOURS = new Set(['stop', 'loop', 'hold']);
const SNAP_GRIDS = new Set<ShowSnapGrid>(['off', 'bar', 'beat', 'half', 'quarter', 'sixteenth', 'seconds']);

function finiteOr(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function normalizeClipMedia(raw: unknown): ShowClipMedia | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  const kind = String(m.kind);
  if (!CLIP_MEDIA_KINDS.has(kind)) return null;
  const media: ShowClipMedia = {
    ...(m as unknown as ShowClipMedia),
    kind: kind as ShowClipMedia['kind'],
    name: typeof m.name === 'string' ? m.name : kind,
    src: typeof m.src === 'string' ? m.src : '',
  };
  const d = Number(m.sourceDuration);
  if (Number.isFinite(d) && d > 0) media.sourceDuration = d;
  else delete media.sourceDuration;
  return media;
}

export function normalizeLayerClip(raw: unknown): ShowLayerClip | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  const media = normalizeClipMedia(c.media);
  if (!media) return null;
  const clip: ShowLayerClip = {
    id: typeof c.id === 'string' && c.id ? c.id : generateUUID(),
    startTime: Math.max(0, finiteOr(c.startTime, 0)),
    duration: Math.max(SHOW_MIN_TRACK_CLIP_SECONDS, finiteOr(c.duration, SHOW_DEFAULT_PRESET_SECONDS)),
    media,
    inPoint: Math.max(0, finiteOr(c.inPoint, 0)),
    endBehaviour: END_BEHAVIOURS.has(String(c.endBehaviour)) ? (c.endBehaviour as ShowClipEndBehaviour) : 'loop',
    fadeIn: Math.max(0, finiteOr(c.fadeIn, 0)),
    fadeOut: Math.max(0, finiteOr(c.fadeOut, 0)),
  };
  const rate = Number(c.rate);
  if (Number.isFinite(rate) && rate > 0 && rate !== 1) clip.rate = Math.max(0.25, Math.min(4, rate));
  const loopStart = Number(c.loopStart);
  if (c.loopStart !== undefined && Number.isFinite(loopStart) && loopStart >= 0) clip.loopStart = loopStart;
  const opacity = Number(c.opacity);
  if (c.opacity !== undefined && Number.isFinite(opacity)) clip.opacity = Math.max(0, Math.min(1, opacity));
  if (c.transitionIn === 'dissolve' || c.transitionIn === 'cut') clip.transitionIn = c.transitionIn;
  const td = Number(c.transitionDuration);
  if (c.transitionDuration !== undefined && Number.isFinite(td) && td >= 0) clip.transitionDuration = td;
  if (typeof c.label === 'string') clip.label = c.label;
  if (typeof c.color === 'string') clip.color = c.color;
  return clip;
}

function normalizeLane(raw: unknown): KeyframeTrack | null {
  if (!raw || typeof raw !== 'object') return null;
  const l = raw as Record<string, unknown>;
  if (typeof l.key !== 'string' || !l.key) return null;
  return {
    key: l.key,
    label: typeof l.label === 'string' ? l.label : l.key,
    type: l.type === 'boolean' ? 'boolean' : 'number',
    keyframes: Array.isArray(l.keyframes) ? (l.keyframes as KeyframeTrack['keyframes']).filter((k) => k && Number.isFinite(Number(k.time))) : [],
    boolKeyframes: Array.isArray(l.boolKeyframes) ? (l.boolKeyframes as KeyframeTrack['boolKeyframes']).filter((k) => k && Number.isFinite(Number(k.time))) : [],
  };
}

/** Clips sorted, overlaps from a hand-edited file dropped (earlier wins). */
function cleanTrackClips(clips: ShowLayerClip[]): ShowLayerClip[] {
  const sorted = [...clips].sort((a, b) => a.startTime - b.startTime);
  const out: ShowLayerClip[] = [];
  for (const c of sorted) {
    const prev = out[out.length - 1];
    if (prev && c.startTime < clipEnd(prev) - 1e-9) continue;
    out.push(c);
  }
  return out;
}

export function normalizeLayerTrack(raw: unknown, index: number): ShowLayerTrack | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as Record<string, unknown>;
  if (typeof t.layerId !== 'string' || !t.layerId) return null;
  const clips = (Array.isArray(t.clips) ? t.clips : [])
    .map(normalizeLayerClip)
    .filter((c): c is ShowLayerClip => c !== null);
  return {
    id: typeof t.id === 'string' && t.id ? t.id : generateUUID(),
    layerId: t.layerId,
    layerName: typeof t.layerName === 'string' && t.layerName ? t.layerName : `Layer ${index + 1}`,
    color: typeof t.color === 'string' ? t.color : undefined,
    template: t.template && typeof t.template === 'object' ? (t.template as Layer) : null,
    clips: cleanTrackClips(clips),
    lanes: (Array.isArray(t.lanes) ? t.lanes : []).map(normalizeLane).filter((l): l is KeyframeTrack => l !== null),
    gap: t.gap === 'hide' ? 'hide' : 'layer',
    muted: t.muted === true,
    locked: t.locked === true,
    collapsed: t.collapsed === true,
  };
}

function normalizeCameraClip(raw: unknown): ShowCameraClip | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  if (typeof c.shotId !== 'string' || !c.shotId) return null;
  return {
    id: typeof c.id === 'string' && c.id ? c.id : generateUUID(),
    startTime: Math.max(0, finiteOr(c.startTime, 0)),
    duration: Math.max(SHOW_MIN_TRACK_CLIP_SECONDS, finiteOr(c.duration, 1)),
    shotId: c.shotId,
  };
}

export function normalizeSnapGrid(raw: unknown, hasTempo: boolean): ShowSnapGrid {
  return SNAP_GRIDS.has(raw as ShowSnapGrid) ? (raw as ShowSnapGrid) : hasTempo ? 'beat' : 'seconds';
}

/**
 * A clean copy of a layer to keep on its track, for when the layer is not on
 * stage. Runtime handles go; the media's AssetRef stays so the copy's own
 * content survives save and reload.
 */
export function trackTemplateFromLayer(layer: Layer): Layer {
  const clean = JSON.parse(JSON.stringify(layer, (key, value) => {
    if (key === 'texture' || key === 'videoElement' || key === 'renderTarget' || key === 'iframeElement' || key === 'synthVisionCanvas') return undefined;
    if (typeof key === 'string' && key.startsWith('_') && key !== '_assetRef') return undefined;
    return value;
  })) as Layer;
  // Geometry is resolved live from the shared surface map it belongs to.
  return { ...clean, surfaceId: layer.surfaceId || layer.id };
}

/** True when the AssetRef alone can rebuild the runtime URL on load. */
function refIsDurable(ref: AssetRef | undefined): boolean {
  return !!(ref && (ref.originalPath || ref.projectPath || ref.dataUrl || ref.url));
}

/** What one undo step holds of the show (see exportArrangement). */
export interface ShowArrangement {
  audioTracks: ShowAudioTrack[];
  presetClips: ShowPresetClip[];
  loop: boolean;
  endAction: ShowEndAction;
  layerTracks?: ShowLayerTrack[];
  tempo?: ShowTempoMap | null;
  cameraLane?: ShowCameraClip[];
}

export interface ShowTimelineSnapshot {
  version: number;
  isOpen: boolean;
  loop: boolean;
  endAction?: ShowEndAction;
  zoom: number;
  snapEnabled: boolean;
  audioTracks: ShowAudioTrack[];
  presetClips: ShowPresetClip[];
  /** Version 2 and later. Missing means empty, so version 1 shows open as
   *  they always did. */
  layerTracks?: ShowLayerTrack[];
  tempo?: ShowTempoMap | null;
  rulerMode?: 'time' | 'bars';
  snapGrid?: ShowSnapGrid;
  cameraLane?: ShowCameraClip[];
}

/** Clip media for a file: the runtime URL is blanked when the AssetRef can
 *  rebuild it (same contract as the audio tracks). */
function serializeClipMedia(media: ShowClipMedia): ShowClipMedia {
  return { ...media, src: refIsDurable(media._assetRef) ? '' : media.src };
}

function serializeTemplate(template: Layer | null): Layer | null {
  if (!template) return null;
  const source = template.source;
  if (!source || !refIsDurable(source._assetRef)) return template;
  return { ...template, source: { ...source, src: '' } };
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
    // One selection at a time: picking a preset clip, an audio track, a
    // transition or a track (or nothing) lets go of selected layer clips,
    // or Delete would remove those instead of what was just clicked.
    store.update((s) => {
      const keepClips = selection?.kind === 'layerClip' && s.selectedClipIds.includes(selection.id);
      return { ...s, selection, selectedClipIds: keepClips ? s.selectedClipIds : selection?.kind === 'layerClip' ? [selection.id] : [] };
    });
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
    if (get(store).loop === loop) return;
    store.update((s) => ({ ...s, loop }));
    recordShowEdit();
  },
  setEndAction(action: ShowEndAction) {
    const next = normalizeShowEndAction(action);
    if (get(store).endAction === next) return;
    store.update((s) => ({ ...s, endAction: next }));
    recordShowEdit();
  },
  /** Zoom so the whole show fits `width` pixels. */
  zoomToFit(width: number) {
    store.update((s) => ({ ...s, zoom: fitShowZoom(Math.max(s.duration, 1), width) }));
  },

  // ── Transport ──────────────────────────────────────────────────────────

  play() {
    const s = get(store);
    if (externalClock) {
      chaseTransportHandler?.('play');
      return;
    }
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
    // Starting again from the very end (the show stopped there) starts over.
    const from = !s.loop && s.currentTime >= s.duration - 1e-6 ? 0 : get(store).currentTime;
    // Re-evaluate at the current position. Fires only when the clip under
    // the playhead differs from what is loaded, so resuming from pause does
    // not reload (and visibly reset) the composition already on screen.
    // `stop()` clears activeClipId, so play-from-stop always re-fires.
    applyTime(from, true);
    transportClock.reset();
    notifyTransport({ type: 'start' });
    if (typeof requestAnimationFrame === 'function') rafId = requestAnimationFrame(tick);
  },

  pause() {
    if (externalClock) chaseTransportHandler?.('pause');
    cancelRaf();
    store.update((s) => ({ ...s, isPlaying: false }));
    seekGeneration++;
    transportClock.reset();
    republishTracks();
  },

  stop() {
    if (externalClock) chaseTransportHandler?.('stop');
    cancelRaf();
    // Clearing activeClipId is what makes the next play() re-fire the
    // opening preset even if the operator hand-loaded something else.
    store.update((s) => ({ ...s, isPlaying: false, currentTime: 0, activeClipId: null }));
    seekGeneration++;
    transportClock.reset();
    // A stop mid-blend must not leave the outgoing composition's layers
    // resident in the scene forever.
    publishTransition(null);
    republishTracks();
  },

  togglePlay() {
    if (get(store).isPlaying) this.pause();
    else this.play();
  },

  /**
   * Follow an external clock (timecode chase). Called at ~60 Hz with the
   * chased show time and whether the source is rolling. Starts and stops the
   * show with the source, never runs the internal RAF transport while
   * chasing, and hard-seeks only on a real jump so audio follows smoothly.
   */
  chase(seconds: number, running: boolean) {
    externalClock = true;
    cancelRaf();
    const s = get(store);
    const target = Number.isFinite(seconds) ? seconds : 0;
    const jump = Math.abs(target - s.currentTime) > SHOW_CHASE_RESEEK_SECONDS;
    if (running && !s.isPlaying) {
      if (s.duration <= 0) return;
      syncAudioWiring(s.audioTracks);
      clipAudioBus.resume();
      store.update((x) => ({ ...x, isPlaying: true }));
      applyTime(target, true);
      return;
    }
    if (!running && s.isPlaying) {
      store.update((x) => ({ ...x, isPlaying: false }));
      applyTime(target, true);
      return;
    }
    if (!running && Math.abs(target - s.currentTime) < 1e-6) return;
    applyTime(target, jump || !running);
  },

  /** Hand the playhead back to the internal transport. */
  releaseChase() {
    if (!externalClock) return;
    externalClock = false;
    if (get(store).isPlaying) {
      store.update((x) => ({ ...x, isPlaying: false }));
      seekGeneration++;
      republishTracks();
    }
  },

  isChasing(): boolean {
    return externalClock;
  },

  /**
   * Move the playhead. THE contract — the offline renderer calls exactly
   * this once per frame with its virtual time, and the UI scrub calls it
   * with the pointer position.
   */
  seek(seconds: number) {
    applyTime(seconds, true);
    // A seek while playing carries on from the new position.
    transportClock.reset();
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
    recordShowEdit();
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
    if (inserted) recordShowEdit();
    return inserted ? id : null;
  },

  removePresetClip(clipId: string) {
    let removed = false;
    store.update((s) => {
      const presetClips = s.presetClips.filter((c) => c.id !== clipId);
      if (presetClips.length === s.presetClips.length) return s;
      removed = true;
      return withDuration({
        ...s,
        presetClips,
        activeClipId: s.activeClipId === clipId ? null : s.activeClipId,
        selection: s.selection?.id === clipId ? null : s.selection,
      });
    });
    if (removed) recordShowEdit();
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
    recordShowEdit(`move:${clipId}`);
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
    recordShowEdit(`resize:${clipId}`);
  },

  updatePresetClip(clipId: string, updates: Partial<ShowPresetClip>) {
    store.update((s) => {
      const presetClips = s.presetClips.map((c) => (c.id === clipId ? { ...c, ...updates } : c));
      return withDuration({ ...s, presetClips });
    });
    recordShowEdit(`clip:${clipId}`);
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
    if (created) recordShowEdit();
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
    recordShowEdit();
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
    recordShowEdit(`transition:${clipId}`);
  },

  setTransitionStyle(clipId: string, style: CompositionTransitionStyle) {
    store.update((s) => ({
      ...s,
      presetClips: s.presetClips.map((c) => (c.id === clipId ? { ...c, transitionIn: style } : c)),
    }));
    recordShowEdit();
  },

  /**
   * Replace the whole preset lane (a show laid out over a song). Clips are
   * placed as given, sorted, and take the preset tray's transition.
   */
  setPresetClips(clips: Array<{ compositionId: string; startTime: number; duration: number; label?: string }>) {
    store.update((s) => {
      const presetClips: ShowPresetClip[] = clips
        .filter((c) => c && typeof c.compositionId === 'string' && c.compositionId && Number(c.duration) > 0)
        .map((c) => ({
          id: generateUUID(),
          compositionId: c.compositionId,
          startTime: Math.max(0, Number(c.startTime) || 0),
          duration: Math.max(SHOW_MIN_CLIP_SECONDS, Number(c.duration)),
          ...defaultClipTransition(),
          label: c.label,
        }))
        .sort((a, b) => a.startTime - b.startTime);
      return withDuration({ ...s, presetClips, activeClipId: null, selection: null });
    });
    recordShowEdit();
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
    recordShowEdit();
  },

  // ── Audio tracks ───────────────────────────────────────────────────────

  /**
   * Add an audio file. Captures a durable AssetRef immediately (so the
   * track survives save/reload), measures the source length, and kicks off
   * the waveform decode in the background.
   */
  async addAudioTrackFromFile(file: File, opts: { startTime?: number; lane?: number } = {}): Promise<string | null> {
    if (!file) return null;
    // Formats Chromium cannot play (AIFF, WMA …) are converted first.
    const prepared = await prepareShowAudioFile(file);
    if ('error' in prepared) {
      showToast(prepared.error, 'error');
      return null;
    }
    return this.addAudioTrack({
      name: prepared.name,
      url: prepared.url,
      assetRef: prepared.assetRef,
      startTime: opts.startTime ?? 0,
      lane: opts.lane,
    }, { removeIfUnplayable: true });
  },

  async addAudioTrack(init: {
    name: string;
    url: string;
    assetRef?: AssetRef;
    startTime?: number;
    duration?: number;
    lane?: number;
  }, opts: { removeIfUnplayable?: boolean } = {}): Promise<string | null> {
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
    // The step is recorded once the track has its real length, so undo and
    // redo never bring back the placeholder.
    tracksAwaitingFirstStep.add(id);
    let playable = false;
    try {
      playable = await this.analyzeAudioTrack(id);
    } finally {
      tracksAwaitingFirstStep.delete(id);
    }
    if (!playable && opts.removeIfUnplayable) {
      removeAudioTrackNow(id);
      showToast(unplayableAudioMessage(track.name), 'error');
      return null;
    }
    if (get(store).audioTracks.some((t) => t.id === id)) recordShowEdit();
    return id;
  },

  /**
   * Decode a track to learn its true length and waveform. Safe to call
   * repeatedly — the decode is cached per URL. Sets the timeline duration
   * to the full source length the first time it resolves.
   */
  async analyzeAudioTrack(trackId: string): Promise<boolean> {
    const track = get(store).audioTracks.find((t) => t.id === trackId);
    if (!track || !track.url) return false;
    if (track.sourceDuration > 0 && track.peaks?.length) return true;
    const decoded = await decodeShowAudio(track.url);
    if (decoded) {
      this.applyMeasuredLength(trackId, decoded.duration, computeAudioPeaks(decoded.mono));
      return true;
    }

    // The decoder could not read it. A file on disk can be converted with
    // the bundled ffmpeg (desktop); the track then plays from the copy.
    const sourcePath = track.assetRef?.originalPath;
    const alreadyConverted = /[\\/]converted-audio[\\/]/.test(sourcePath ?? '');
    if (sourcePath && !alreadyConverted && typeof window !== 'undefined' && (window as any).electronAPI?.invoke) {
      const converted = await convertShowAudioPath(sourcePath, track.name);
      if (!('error' in converted) && get(store).audioTracks.some((t) => t.id === trackId)) {
        forgetShowAudioDecode(track.url);
        store.update((s) => ({
          ...s,
          audioTracks: s.audioTracks.map((t) => (t.id === trackId ? { ...t, url: converted.url, assetRef: converted.assetRef } : t)),
        }));
        const updated = get(store).audioTracks.find((t) => t.id === trackId);
        if (updated) ensureTrackElement(updated);
        const again = await decodeShowAudio(converted.url);
        if (again) {
          this.applyMeasuredLength(trackId, again.duration, computeAudioPeaks(again.mono));
          return true;
        }
      }
    }

    // Still nothing to decode: the media element may play it anyway. Use
    // its length and do without a waveform.
    const current = get(store).audioTracks.find((t) => t.id === trackId);
    const length = current?.url ? await probeMediaDuration(current.url) : null;
    if (length) {
      this.applyMeasuredLength(trackId, length, undefined);
      return true;
    }
    console.warn(`[ShowTimeline] "${track.name}" could not be decoded or played.`);
    return false;
  },

  /** Record a track's real length (and waveform) once it is known. */
  applyMeasuredLength(trackId: string, sourceDuration: number, peaks: number[] | undefined) {
    store.update((s) => {
      const audioTracks = s.audioTracks.map((t) => {
        if (t.id !== trackId) return t;
        // Only stretch to the full source length when the track was added
        // with a placeholder duration; a user-trimmed track keeps its trim.
        const grow = t.duration <= SHOW_MIN_CLIP_SECONDS + 1e-9;
        return {
          ...t,
          sourceDuration,
          peaks: peaks ?? t.peaks,
          duration: grow ? Math.max(SHOW_MIN_CLIP_SECONDS, sourceDuration) : t.duration,
        };
      });
      return withDuration({ ...s, audioTracks });
    });
    // Measuring a file is not an edit: the length belongs in the step that
    // added the track (recorded by addAudioTrack once this is known) or, for
    // a track that arrived with the project, in the step it is already in.
    if (!tracksAwaitingFirstStep.has(trackId) && !isRestoringHistory()) amendLastHistoryStep();
  },

  removeAudioTrack(trackId: string) {
    if (!get(store).audioTracks.some((t) => t.id === trackId)) return;
    removeAudioTrackNow(trackId);
    recordShowEdit();
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
    recordShowEdit(`audio-move:${trackId}`);
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
    recordShowEdit(`audio-resize:${trackId}`);
  },

  setAudioTrackVolume(trackId: string, volume: number) {
    const v = Math.max(0, Math.min(1, Number(volume) || 0));
    store.update((s) => ({
      ...s,
      audioTracks: s.audioTracks.map((t) => (t.id === trackId ? { ...t, volume: v } : t)),
    }));
    clipAudioBus.setClipVolume(busIdFor(trackId), v);
    recordShowEdit(`volume:${trackId}`);
  },

  setAudioTrackMuted(trackId: string, muted: boolean) {
    store.update((s) => ({
      ...s,
      audioTracks: s.audioTracks.map((t) => (t.id === trackId ? { ...t, muted } : t)),
    }));
    clipAudioBus.setClipMuted(busIdFor(trackId), muted);
    recordShowEdit();
  },

  renameAudioTrack(trackId: string, name: string) {
    store.update((s) => ({
      ...s,
      audioTracks: s.audioTracks.map((t) => (t.id === trackId ? { ...t, name } : t)),
    }));
    recordShowEdit();
  },

  // ── Layer tracks ───────────────────────────────────────────────────────
  //
  // A layer track drives one mapping layer along the show. Clips never
  // touch the project: the scene is built from show time (see
  // show/tracks/showTrackScene.ts), so presets swapping layers underneath,
  // undo and autosave never see a clip's picture.

  /**
   * Add a track for a layer. One track per layer: asking again selects the
   * existing one. Returns the track id.
   */
  addLayerTrack(layer: Layer, opts: { color?: string; index?: number } = {}): string {
    const existing = get(store).layerTracks.find((t) => t.layerId === layer.id);
    if (existing) {
      store.update((s) => ({ ...s, selection: { kind: 'track', id: existing.id } }));
      return existing.id;
    }
    const id = generateUUID();
    const track: ShowLayerTrack = {
      id,
      layerId: layer.id,
      layerName: layer.name,
      color: opts.color,
      template: trackTemplateFromLayer(layer),
      clips: [],
      lanes: [],
      gap: 'layer',
      muted: false,
      locked: false,
      collapsed: false,
    };
    store.update((s) => {
      const layerTracks = [...s.layerTracks];
      const at = opts.index === undefined ? layerTracks.length : Math.max(0, Math.min(layerTracks.length, opts.index));
      layerTracks.splice(at, 0, track);
      return { ...s, layerTracks, selection: { kind: 'track', id } };
    });
    recordShowEdit();
    republishTracks();
    return id;
  },

  removeLayerTrack(trackId: string) {
    const track = get(store).layerTracks.find((t) => t.id === trackId);
    if (!track) return;
    const clipIds = new Set(track.clips.map((c) => c.id));
    store.update((s) => withDuration({
      ...s,
      layerTracks: s.layerTracks.filter((t) => t.id !== trackId),
      soloTrackId: s.soloTrackId === trackId ? null : s.soloTrackId,
      selectedClipIds: s.selectedClipIds.filter((id) => !clipIds.has(id)),
      selection: s.selection && (s.selection.id === trackId || clipIds.has(s.selection.id)) ? null : s.selection,
    }));
    recordShowEdit();
    republishTracks();
  },

  /** Move a track to another row. */
  reorderLayerTrack(trackId: string, toIndex: number) {
    const tracks = get(store).layerTracks;
    const from = tracks.findIndex((t) => t.id === trackId);
    if (from < 0) return;
    const to = Math.max(0, Math.min(tracks.length - 1, Math.floor(toIndex)));
    if (to === from) return;
    store.update((s) => {
      const layerTracks = [...s.layerTracks];
      const [moved] = layerTracks.splice(from, 1);
      layerTracks.splice(to, 0, moved);
      return { ...s, layerTracks };
    });
    recordShowEdit();
    republishTracks();
  },

  /** Track settings: gap mode, mute, lock, fold, colour, name. */
  updateLayerTrack(trackId: string, patch: Partial<Pick<ShowLayerTrack, 'gap' | 'muted' | 'locked' | 'collapsed' | 'color' | 'layerName'>>) {
    let changed = false;
    store.update((s) => ({
      ...s,
      layerTracks: s.layerTracks.map((t) => {
        if (t.id !== trackId) return t;
        const next = { ...t, ...patch };
        changed = JSON.stringify(next) !== JSON.stringify(t);
        return next;
      }),
    }));
    if (!changed) return;
    // Folding a track is how it is viewed, not an edit.
    const keys = Object.keys(patch);
    if (!(keys.length === 1 && keys[0] === 'collapsed')) recordShowEdit();
    republishTracks();
  },

  /** Solo one track (null clears). Session only: never saved or undone. */
  setSoloTrack(trackId: string | null) {
    store.update((s) => ({ ...s, soloTrackId: trackId && s.layerTracks.some((t) => t.id === trackId) ? trackId : null }));
    republishTracks();
  },

  /**
   * Keep a track's copy of its layer up to date (the layer is on stage and
   * may have been edited). Not an edit of the show: no undo step.
   */
  refreshTrackTemplate(trackId: string, layer: Layer) {
    const template = trackTemplateFromLayer(layer);
    let changed = false;
    store.update((s) => ({
      ...s,
      layerTracks: s.layerTracks.map((t) => {
        if (t.id !== trackId) return t;
        if (t.template && JSON.stringify(t.template) === JSON.stringify(template) && t.layerName === layer.name) return t;
        changed = true;
        return { ...t, template, layerName: layer.name };
      }),
    }));
    if (changed) republishTracks();
  },

  /**
   * Put media on a track at `startTime`. Placed into the free window there;
   * returns null when it does not fit. Video clips default to their media's
   * length (or the rest of it from `inPoint`), anything else to 10 s.
   */
  addLayerClip(
    trackId: string,
    media: ShowClipMedia,
    startTime: number,
    opts: Partial<Omit<ShowLayerClip, 'id' | 'media' | 'startTime'>> = {},
  ): string | null {
    const track = get(store).layerTracks.find((t) => t.id === trackId);
    if (!track || track.locked) return null;
    const normalizedMedia = normalizeClipMedia(media);
    if (!normalizedMedia) return null;
    const inPoint = Math.max(0, opts.inPoint ?? 0);
    const sourceLeft = normalizedMedia.kind === 'video' && normalizedMedia.sourceDuration
      ? Math.max(SHOW_MIN_TRACK_CLIP_SECONDS, normalizedMedia.sourceDuration - inPoint)
      : 10;
    const clip: ShowLayerClip = {
      id: generateUUID(),
      startTime: Math.max(0, startTime),
      duration: Math.max(SHOW_MIN_TRACK_CLIP_SECONDS, opts.duration ?? sourceLeft),
      media: normalizedMedia,
      inPoint,
      endBehaviour: opts.endBehaviour ?? (normalizedMedia.kind === 'video' ? 'stop' : 'loop'),
      fadeIn: Math.max(0, opts.fadeIn ?? 0),
      fadeOut: Math.max(0, opts.fadeOut ?? 0),
    };
    for (const key of ['rate', 'opacity', 'label', 'color', 'loopStart', 'transitionIn', 'transitionDuration'] as const) {
      if (opts[key] !== undefined) (clip as unknown as Record<string, unknown>)[key] = opts[key];
    }
    const clips = insertClip(track.clips, clip);
    if (!clips) return null;
    store.update((s) => withDuration({
      ...s,
      layerTracks: s.layerTracks.map((t) => (t.id === trackId ? { ...t, clips } : t)),
      selectedClipIds: [clip.id],
      selection: { kind: 'layerClip', id: clip.id },
    }));
    recordShowEdit();
    republishTracks();
    return clip.id;
  },

  /** Where a layer clip lives. */
  findLayerClip(clipId: string): { track: ShowLayerTrack; clip: ShowLayerClip } | null {
    for (const track of get(store).layerTracks) {
      const clip = track.clips.find((c) => c.id === clipId);
      if (clip) return { track, clip };
    }
    return null;
  },

  /** Change a clip's fields (inspector). Timing changes go through
   *  move/trim; this clamps fades and a 'stop' clip's length. */
  updateLayerClip(clipId: string, patch: Partial<Omit<ShowLayerClip, 'id' | 'startTime'>>, opts: { discrete?: boolean } = {}) {
    const found = this.findLayerClip(clipId);
    if (!found || found.track.locked) return;
    const others = found.track.clips.filter((c) => c.id !== clipId);
    let next: ShowLayerClip = { ...found.clip, ...patch };
    const room = Math.min(maxDurationAt(others, next.startTime), maxClipDurationForMedia(next));
    next.duration = Math.max(SHOW_MIN_TRACK_CLIP_SECONDS, Math.min(next.duration, room));
    next = normalizeLayerClip(next) ?? found.clip;
    this._setTrackClips(found.track.id, found.track.clips.map((c) => (c.id === clipId ? next : c)));
    // Drags and sliders coalesce into one step; a one-shot change is its own.
    recordShowEdit(opts.discrete ? undefined : `layer-clip:${clipId}`);
  },

  /** Drag one clip to a new start (snapped), carrying its lane keys. */
  moveLayerClip(clipId: string, startTime: number) {
    const found = this.findLayerClip(clipId);
    if (!found || found.track.locked) return;
    const snapped = snapShowTime(startTime, this._snapEdges(new Set([clipId])), this._snapOptions());
    // Snap the clip's end too: whichever edge lands nearer a target wins.
    const endSnapped = snapShowTime(startTime + found.clip.duration, this._snapEdges(new Set([clipId])), this._snapOptions()) - found.clip.duration;
    // An edge that found nothing to snap to does not compete.
    const pull = (v: number) => (Math.abs(v - startTime) < 1e-9 ? Number.POSITIVE_INFINITY : Math.abs(v - startTime));
    const want = pull(endSnapped) < pull(snapped) ? endSnapped : snapped;
    const clips = moveClipTo(found.track.clips, clipId, want);
    if (!clips) return;
    const moved = clips.find((c) => c.id === clipId)!;
    const delta = moved.startTime - found.clip.startTime;
    const lanes = shiftLaneKeys(found.track.lanes, found.clip.startTime, clipEnd(found.clip), delta);
    this._setTrackClips(found.track.id, clips, lanes);
    recordShowEdit(`layer-move:${clipId}`);
  },

  /** Move several clips on one track together (multi-select drag). */
  moveLayerClips(trackId: string, clipIds: string[], delta: number) {
    const track = get(store).layerTracks.find((t) => t.id === trackId);
    if (!track || track.locked) return;
    const ids = new Set(clipIds);
    const clips = moveClips(track.clips, ids, delta);
    if (!clips) return;
    let lanes = track.lanes;
    for (const c of track.clips.filter((x) => ids.has(x.id))) lanes = shiftLaneKeys(lanes, c.startTime, clipEnd(c), delta);
    this._setTrackClips(trackId, clips, lanes);
    recordShowEdit(`layer-move:${[...ids].sort().join(',')}`);
  },

  /** Drag a clip edge (snapped). The left edge moves the in-point with it. */
  trimLayerClip(clipId: string, edge: 'start' | 'end', time: number, opts: { snap?: boolean } = {}) {
    const found = this.findLayerClip(clipId);
    if (!found || found.track.locked) return;
    const snapped = opts.snap === false
      ? Math.max(0, time)
      : snapShowTime(time, this._snapEdges(new Set([clipId])), this._snapOptions());
    const clips = trimClip(found.track.clips, clipId, edge, snapped);
    if (!clips) return;
    this._setTrackClips(found.track.id, clips);
    recordShowEdit(`layer-trim:${clipId}:${edge}`);
  },

  /**
   * Split at show time `t`: the given clips, or with none given the selected
   * clips under `t`, or failing that every clip under `t` on an unlocked
   * track. Returns the ids of the new right-hand halves.
   */
  splitLayerClips(t: number, clipIds?: string[]): string[] {
    const s = get(store);
    const wanted = clipIds ? new Set(clipIds) : null;
    const selected = new Set(s.selectedClipIds);
    const created: string[] = [];
    const layerTracks = s.layerTracks.map((track) => {
      if (track.locked) return track;
      const clip = findClipAt(track.clips, t);
      if (!clip) return track;
      const eligible = wanted ? wanted.has(clip.id) : selected.size ? selected.has(clip.id) : true;
      if (!eligible) return track;
      const halves = splitClip(clip, t);
      if (!halves) return track;
      created.push(halves[1].id);
      return { ...track, clips: track.clips.flatMap((c) => (c.id === clip.id ? halves : [c])) };
    });
    // Nothing selected under the playhead: split every track instead.
    if (!created.length && !wanted && selected.size) return this.splitLayerClips(t, s.layerTracks.flatMap((tr) => {
      const c = tr.locked ? null : findClipAt(tr.clips, t);
      return c ? [c.id] : [];
    }));
    if (!created.length) return created;
    store.update((x) => ({ ...x, layerTracks }));
    recordShowEdit();
    republishTracks();
    return created;
  },

  /** Delete clips; `ripple` closes the space they leave on their tracks. */
  removeLayerClips(clipIds: string[], opts: { ripple?: boolean } = {}) {
    const ids = new Set(clipIds);
    let changed = false;
    store.update((s) => withDuration({
      ...s,
      layerTracks: s.layerTracks.map((track) => {
        if (track.locked || !track.clips.some((c) => ids.has(c.id))) return track;
        changed = true;
        if (!opts.ripple) return { ...track, clips: deleteClips(track.clips, ids) };
        const result = rippleDelete(track.clips, ids);
        let lanes = track.lanes;
        for (const shift of result.shifts) lanes = shiftLaneKeys(lanes, shift.from, Number.POSITIVE_INFINITY, shift.delta);
        return { ...track, clips: result.clips, lanes };
      }),
      selectedClipIds: s.selectedClipIds.filter((id) => !ids.has(id)),
      selection: s.selection && ids.has(s.selection.id) ? null : s.selection,
    }));
    if (!changed) return;
    recordShowEdit();
    republishTracks();
  },

  /** Duplicate clips on their own tracks. Returns the new clip ids. */
  duplicateLayerClips(clipIds: string[]): string[] {
    const ids = new Set(clipIds);
    const created: string[] = [];
    const layerTracks = get(store).layerTracks.map((track) => {
      if (track.locked || !track.clips.some((c) => ids.has(c.id))) return track;
      const result = duplicateClips(track.clips, ids);
      if (!result) return track;
      created.push(...result.ids);
      return { ...track, clips: result.clips };
    });
    if (!created.length) return created;
    store.update((s) => withDuration({ ...s, layerTracks, selectedClipIds: created }));
    recordShowEdit();
    republishTracks();
    return created;
  },

  /** Copies of clips for the clipboard (ids are replaced on paste). */
  copyLayerClips(clipIds: string[]): ShowLayerClip[] {
    const ids = new Set(clipIds);
    return get(store).layerTracks.flatMap((t) => t.clips.filter((c) => ids.has(c.id))).map((c) => structuredCloneSafe(c));
  },

  /** Paste copied clips onto a track with the earliest at `at`. */
  pasteLayerClips(trackId: string, copied: ShowLayerClip[], at: number): string[] {
    const track = get(store).layerTracks.find((t) => t.id === trackId);
    if (!track || track.locked) return [];
    const result = pasteClips(track.clips, copied, at);
    if (!result) return [];
    this._setTrackClips(trackId, result.clips);
    store.update((s) => ({ ...s, selectedClipIds: result.ids }));
    recordShowEdit();
    return result.ids;
  },

  selectLayerClips(clipIds: string[]) {
    store.update((s) => ({
      ...s,
      selectedClipIds: [...clipIds],
      // Several clips: no single item is "the" selection (and never a
      // preset clip left over from before). None: drop only a clip selection.
      selection: clipIds.length === 1
        ? { kind: 'layerClip', id: clipIds[0] }
        : clipIds.length
          ? null
          : s.selection?.kind === 'layerClip' ? null : s.selection,
    }));
  },

  /** Select every clip on every track. */
  selectAllLayerClips() {
    const ids = get(store).layerTracks.flatMap((t) => t.clips.map((c) => c.id));
    this.selectLayerClips(ids);
  },

  /**
   * Move clips together by `delta` seconds and `trackOffset` rows (a drag of
   * a selection, possibly onto other tracks). Keys inside each clip go with
   * it. Returns false when the move is refused (overlap, locked, off the
   * track list) and nothing changed.
   */
  moveLayerClipsAcross(clipIds: string[], delta: number, trackOffset: number): boolean {
    const ids = new Set(clipIds);
    const layerTracks = moveClipsAcrossTracks(get(store).layerTracks, ids, delta, trackOffset);
    if (!layerTracks) return false;
    store.update((s) => withDuration({ ...s, layerTracks }));
    recordShowEdit(`layer-move:${[...ids].sort().join(',')}`);
    republishTracks();
    return true;
  },

  /**
   * Paste copied clips, each group onto its own track, keeping their spacing
   * with the earliest clip at `at`. All or nothing; one undo step. Returns
   * the new clip ids (empty when it would overlap or a track is locked).
   */
  pasteLayerClipGroups(groups: Array<{ trackId: string; clips: ShowLayerClip[] }>, at: number): string[] {
    const usable = groups.filter((g) => g.clips.length);
    if (!usable.length) return [];
    const first = Math.min(...usable.flatMap((g) => g.clips.map((c) => c.startTime)));
    const s = get(store);
    const created: string[] = [];
    const next = new Map<string, ShowLayerClip[]>();
    for (const g of usable) {
      const track = s.layerTracks.find((t) => t.id === g.trackId);
      if (!track || track.locked) return [];
      const base = next.get(g.trackId) ?? track.clips;
      const groupFirst = Math.min(...g.clips.map((c) => c.startTime));
      const result = pasteClips(base, g.clips, Math.max(0, at + (groupFirst - first)));
      if (!result) return [];
      next.set(g.trackId, result.clips);
      created.push(...result.ids);
    }
    store.update((x) => withDuration({
      ...x,
      layerTracks: x.layerTracks.map((t) => (next.has(t.id) ? { ...t, clips: next.get(t.id)! } : t)),
      selectedClipIds: created,
      selection: created.length === 1 ? { kind: 'layerClip', id: created[0] } : x.selection?.kind === 'layerClip' ? null : x.selection,
    }));
    recordShowEdit();
    republishTracks();
    return created;
  },

  /** A show time snapped like a dragged clip edge would be (UI drags of
   *  several clips, keys, the drop position). */
  snapTime(t: number, excludeClipIds: Iterable<string> = []): number {
    return snapShowTime(t, this._snapEdges(new Set(excludeClipIds)), this._snapOptions());
  },

  /** The magnetic targets (not the grid) for a drag, for snap guides. */
  snapTargets(excludeClipIds: Iterable<string> = []): number[] {
    return this._snapEdges(new Set(excludeClipIds));
  },

  // ── Keyframe lanes ─────────────────────────────────────────────────────

  _editLanes(trackId: string, edit: (lanes: KeyframeTrack[]) => KeyframeTrack[], continuousKey?: string): boolean {
    const track = get(store).layerTracks.find((t) => t.id === trackId);
    if (!track || track.locked) return false;
    const lanes = edit(track.lanes);
    if (lanes === track.lanes || JSON.stringify(lanes) === JSON.stringify(track.lanes)) return false;
    store.update((s) => ({
      ...s,
      layerTracks: s.layerTracks.map((t) => (t.id === trackId ? { ...t, lanes } : t)),
    }));
    recordShowEdit(continuousKey);
    republishTracks();
    return true;
  },

  /** Fold a keyframe lane open under a track for `param`. */
  addTrackLane(trackId: string, param: LaneParam): boolean {
    const added = this._editLanes(trackId, (lanes) => addLane(lanes, param));
    this.updateLayerTrack(trackId, { collapsed: false });
    return added;
  },

  removeTrackLane(trackId: string, key: string): boolean {
    return this._editLanes(trackId, (lanes) => removeLane(lanes, key));
  },

  /** Add or change the key at `time` (show seconds). */
  setLaneKey(trackId: string, key: string, time: number, value: number | boolean, easing?: KeyframeEasing): boolean {
    return this._editLanes(trackId, (lanes) => setLaneKey(lanes, key, time, value, easing), `lane:${trackId}:${key}:set:${time.toFixed(4)}`);
  },

  /** Drag a key (one undo step per drag: pass the key's time at grab). */
  moveLaneKey(trackId: string, key: string, from: number, to: number, value?: number | boolean, dragId?: string): boolean {
    return this._editLanes(trackId, (lanes) => moveLaneKey(lanes, key, from, to, value), `lane:${trackId}:${key}:move:${dragId ?? from.toFixed(4)}`);
  },

  /** Move several keys on one lane together. */
  shiftLaneKeys(trackId: string, key: string, times: number[], delta: number, dragId?: string): boolean {
    return this._editLanes(trackId, (lanes) => shiftKeysOnLane(lanes, key, times, delta), `lane:${trackId}:${key}:shift:${dragId ?? ''}`);
  },

  removeLaneKeys(trackId: string, key: string, times: number[]): boolean {
    return this._editLanes(trackId, (lanes) => removeLaneKeys(lanes, key, times));
  },

  setLaneKeyEasing(trackId: string, key: string, times: number[], easing: KeyframeEasing): boolean {
    return this._editLanes(trackId, (lanes) => setLaneKeyEasing(lanes, key, times, easing));
  },

  // ── Beat grid ──────────────────────────────────────────────────────────

  /** Set (or with null, clear) the show's tempo map. */
  setTempo(map: ShowTempoMap | null) {
    const tempo = map ? normalizeTempoMap(map) : null;
    store.update((s) => {
      // Switching a grid on picks the beat; switching it off goes back to seconds.
      const musical = s.snapGrid !== 'off' && s.snapGrid !== 'seconds';
      const snapGrid = tempo && s.snapGrid === 'seconds' && !s.tempo ? 'beat' : !tempo && musical ? 'seconds' : s.snapGrid;
      return { ...s, tempo, snapGrid, rulerMode: tempo ? s.rulerMode : 'time' };
    });
    recordShowEdit('tempo');
  },

  setSnapGrid(grid: ShowSnapGrid) {
    store.update((s) => ({ ...s, snapGrid: normalizeSnapGrid(grid, !!s.tempo) }));
  },

  setRulerMode(mode: 'time' | 'bars') {
    store.update((s) => ({ ...s, rulerMode: mode === 'bars' && s.tempo ? 'bars' : 'time' }));
  },

  // ── Stage camera lane ──────────────────────────────────────────────────

  setCameraLane(clips: ShowCameraClip[]) {
    const cameraLane = clips.map(normalizeCameraClip).filter((c): c is ShowCameraClip => c !== null).sort((a, b) => a.startTime - b.startTime);
    store.update((s) => withDuration({ ...s, cameraLane }));
    recordShowEdit();
  },

  // ── Track helpers (internal) ───────────────────────────────────────────

  _setTrackClips(trackId: string, clips: ShowLayerClip[], lanes?: KeyframeTrack[]) {
    store.update((s) => withDuration({
      ...s,
      layerTracks: s.layerTracks.map((t) => (t.id === trackId ? { ...t, clips, ...(lanes ? { lanes } : {}) } : t)),
    }));
    republishTracks();
  },

  /** Every edge a dragged layer clip can snap to: clip edges on every lane,
   *  the playhead, markers and 0. */
  _snapEdges(exclude: ReadonlySet<string>): number[] {
    const s = get(store);
    const edges = [s.currentTime];
    if (snapEdgeProvider) {
      try { edges.push(...snapEdgeProvider()); } catch { /* provider gone */ }
    }
    for (const c of s.presetClips) edges.push(c.startTime, c.startTime + c.duration);
    for (const t of s.audioTracks) edges.push(t.startTime, t.startTime + t.duration);
    for (const track of s.layerTracks) {
      for (const c of track.clips) if (!exclude.has(c.id)) edges.push(c.startTime, clipEnd(c));
    }
    return edges;
  },

  _snapOptions(): { enabled: boolean; tolerance: number; nearestGrid?: (t: number) => number } {
    const s = get(store);
    return { enabled: s.snapEnabled && s.snapGrid !== 'off', tolerance: snapTolerance(s.zoom), nearestGrid: gridFunction(s) };
  },

  // ── Whole-show ─────────────────────────────────────────────────────────

  clear() {
    cancelRaf();
    releaseAllTrackElements();
    publishTransition(null);
    transportClock.reset();
    store.update((s) => ({
      ...createInitialState(),
      isOpen: s.isOpen,
      zoom: s.zoom,
      snapEnabled: s.snapEnabled,
      endAction: s.endAction,
    }));
    republishTracks();
    recordShowEdit();
    notifyReset();
  },

  /** Total programmed length, seconds. The render modal seeds from this. */
  totalDuration(): number {
    return get(store).duration;
  },

  hasContent(): boolean {
    const s = get(store);
    return s.presetClips.length > 0 || s.audioTracks.length > 0 || s.layerTracks.length > 0;
  },

  /** See `presetLocalTimeAt`. */
  presetLocalTime(seconds: number): number {
    return presetLocalTimeAt(get(store).presetClips, seconds);
  },

  /**
   * The time an offline render should drive the keyframe tray with for show
   * time `seconds`: preset-local when the show lays out presets (each
   * preset's keyframes restart on its boundary, as they do live), show time
   * otherwise.
   */
  keyframeTimeFor(seconds: number): number {
    const clips = get(store).presetClips;
    return clips.length ? presetLocalTimeAt(clips, seconds) : seconds;
  },

  // ── Undo ───────────────────────────────────────────────────────────────

  /**
   * The arrangement as one undo step holds it: everything the user edits,
   * nothing about where the playhead is or how the panel is being viewed.
   * Runtime URLs stay in (the step lives in this session only).
   */
  exportArrangement(): ShowArrangement {
    const s = get(store);
    return {
      audioTracks: s.audioTracks.map((t) => ({ ...t })),
      presetClips: s.presetClips.map((c) => ({ ...c })),
      loop: s.loop,
      endAction: s.endAction,
      // Track and clip objects are replaced on every edit, never mutated,
      // so holding them is a complete capture.
      layerTracks: s.layerTracks,
      tempo: s.tempo,
      cameraLane: s.cameraLane,
    };
  },

  /**
   * Put an arrangement from an undo step back. The transport keeps going
   * from where it is, and the show is re-evaluated there, so a preset clip
   * that undo moved under the playhead takes over at once.
   */
  restoreArrangement(raw: unknown): void {
    if (!raw || typeof raw !== 'object') return;
    const a = raw as Partial<ShowArrangement>;
    const audioTracks = (Array.isArray(a.audioTracks) ? a.audioTracks : [])
      .map((t, i) => normalizeTrack(t, i))
      .filter((t): t is ShowAudioTrack => t !== null);
    const presetClips = (Array.isArray(a.presetClips) ? a.presetClips : [])
      .map((c) => normalizeClip(c))
      .filter((c): c is ShowPresetClip => c !== null)
      .sort((x, y) => x.startTime - y.startTime);
    const layerTracks = (Array.isArray(a.layerTracks) ? a.layerTracks : [])
      .map((t, i) => normalizeLayerTrack(t, i))
      .filter((t): t is ShowLayerTrack => t !== null);
    const cameraLane = (Array.isArray(a.cameraLane) ? a.cameraLane : [])
      .map(normalizeCameraClip)
      .filter((c): c is ShowCameraClip => c !== null);
    const tempo = normalizeTempoMap(a.tempo);
    store.update((s) => {
      const clipIds = new Set(layerTracks.flatMap((t) => t.clips.map((c) => c.id)));
      const ids = new Set([
        ...audioTracks.map((t) => t.id),
        ...presetClips.map((c) => c.id),
        ...layerTracks.map((t) => t.id),
        ...clipIds,
      ]);
      return withDuration({
        ...s,
        audioTracks,
        presetClips,
        loop: a.loop === true,
        endAction: normalizeShowEndAction(a.endAction),
        layerTracks,
        tempo,
        snapGrid: normalizeSnapGrid(s.snapGrid, !!tempo),
        rulerMode: tempo ? s.rulerMode : 'time',
        cameraLane,
        soloTrackId: s.soloTrackId && layerTracks.some((t) => t.id === s.soloTrackId) ? s.soloTrackId : null,
        selectedClipIds: s.selectedClipIds.filter((id) => clipIds.has(id)),
        selection: s.selection && ids.has(s.selection.id) ? s.selection : null,
      });
    });
    syncAudioWiring(audioTracks);
    const s = get(store);
    if (s.duration <= 0) {
      if (s.isPlaying) this.pause();
      store.update((x) => ({ ...x, currentTime: 0, activeClipId: null }));
      publishTransition(null);
      republishTracks();
      return;
    }
    applyTime(s.currentTime, true);
    republishTracks();
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
      version: 2,
      isOpen: s.isOpen,
      loop: s.loop,
      endAction: s.endAction,
      zoom: s.zoom,
      snapEnabled: s.snapEnabled,
      audioTracks: s.audioTracks.map((t) => ({
        ...t,
        url: refIsDurable(t.assetRef) ? '' : t.url,
      })),
      presetClips: s.presetClips.map((c) => ({ ...c })),
      layerTracks: s.layerTracks.map((t) => ({
        ...t,
        template: serializeTemplate(t.template),
        clips: t.clips.map((c) => ({ ...c, media: serializeClipMedia(c.media) })),
      })),
      tempo: s.tempo,
      rulerMode: s.rulerMode,
      snapGrid: s.snapGrid,
      cameraLane: s.cameraLane.map((c) => ({ ...c })),
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
    notifyReset();

    if (!payload || typeof payload !== 'object') {
      store.set(createInitialState());
      republishTracks();
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

    // Layer tracks (version 2). Clip media and each track's copy of its
    // layer resolve like the audio does.
    const resolveField = (ref: unknown, current: string) =>
      resolveAssetRefForRuntime(ref as AssetRef, projectDir, current) ?? current;
    const layerTracks = (Array.isArray(p.layerTracks) ? p.layerTracks : [])
      .map((raw, i) => normalizeLayerTrack(raw, i))
      .filter((t): t is ShowLayerTrack => t !== null)
      .map((track) => {
        if (track.template) resolveAssetTreeInPlace(track.template, resolveField);
        const clips = track.clips.map((clip) => {
          const media = clip.media;
          if (media.kind === 'layer' || media.kind === 'shader' && !media._assetRef) return clip;
          const resolved = resolveAssetRefForRuntime(media._assetRef, projectDir, media.src) ?? '';
          if (!resolved && media._assetRef) {
            recordMissingAsset({ assetRef: media._assetRef, fieldHint: 'show timeline clip' });
          }
          return { ...clip, media: { ...media, src: resolved } };
        });
        return { ...track, clips };
      });
    const tempo = normalizeTempoMap(p.tempo);
    const cameraLane = (Array.isArray(p.cameraLane) ? p.cameraLane : [])
      .map(normalizeCameraClip)
      .filter((c): c is ShowCameraClip => c !== null)
      .sort((a, b) => a.startTime - b.startTime);

    const zoom = Number(p.zoom);
    store.set({
      isOpen: p.isOpen === true,
      isPlaying: false,
      currentTime: 0,
      duration: computeShowDuration(presetClips, audioTracks, layerTracks, cameraLane),
      loop: p.loop === true,
      audioTracks,
      presetClips,
      activeClipId: null,
      zoom: Number.isFinite(zoom) ? Math.max(SHOW_MIN_ZOOM, Math.min(SHOW_MAX_ZOOM, zoom)) : SHOW_DEFAULT_ZOOM,
      snapEnabled: p.snapEnabled !== false,
      selection: null,
      endAction: normalizeShowEndAction(p.endAction),
      layerTracks,
      tempo,
      rulerMode: p.rulerMode === 'bars' && tempo ? 'bars' : 'time',
      snapGrid: normalizeSnapGrid(p.snapGrid, !!tempo),
      selectedClipIds: [],
      soloTrackId: null,
      cameraLane,
    });
    transportClock.reset();
    republishTracks();

    syncAudioWiring(audioTracks);
    // Waveforms for tracks whose peaks did not travel (older saves).
    for (const t of audioTracks) {
      if (!t.peaks?.length && t.url) void this.analyzeAudioTrack(t.id);
    }
  },

  /** Test seam — tears the transport and audio elements down completely. */
  _resetForTest() {
    externalClock = false;
    transportClock.reset();
    audioClockReader = defaultAudioClockReader;
    transportSink = null;
    cancelRaf();
    releaseAllTrackElements();
    publishTransition(null);
    lastPublishedTransition = null;
    seekGeneration = 0;
    trackFrameSink = null;
    lastTrackFrame = null;
    lastTrackFrameSignature = null;
    tracksAwaitingFirstStep.clear();
    store.set(createInitialState());
  },

  /** The show's current seek generation (bumped on every discontinuity). */
  seekGeneration(): number {
    return seekGeneration;
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────

function structuredCloneSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** The musical grid snapping uses, or undefined for the seconds grid. */
function gridFunction(s: Pick<ShowTimelineState, 'tempo' | 'snapGrid'>): ((t: number) => number) | undefined {
  const tempo = s.tempo;
  if (!tempo || s.snapGrid === 'off' || s.snapGrid === 'seconds') return undefined;
  const grid = s.snapGrid;
  return (t: number) => nearestGridTime(tempo, t, grid);
}

function removeAudioTrackNow(trackId: string): void {
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
}

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
