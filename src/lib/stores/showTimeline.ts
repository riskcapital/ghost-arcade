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
  ShowLookClip,
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
import { createShowTicker } from '../show/showTicker';
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
import { sameJson } from '../show/jsonEqual';
import {
  amendLastHistoryStep,
  isRestoringHistory,
  recordDiscreteAction,
  scheduleHistorySnapshot,
} from './historyHooks';
import { demoReel, type DemoShot } from '../stage3d/demoReel';
import { cameraShotTable, readCameraShotTable } from '../show/rehearsal/cameraShotTable';
import {
  bareRowFor,
  isBareRow,
  reconcileStageRows,
  rowHasContent,
  rowTrackId,
  stagePieces,
} from '../show/tracks/showStageRows';
import { evaluateShowLooks, type ShowLookState } from '../show/tracks/showLooks';
import { normalizeLines, type ControlLine } from '../timeline/lines/lineModel';
import type { LineBinding } from '../timeline/lines/lineControls';
import { lanesToLines, rowLineTarget } from '../timeline/lines/laneConversion';
import { linesEnd, normalizeBindings, removeLinesForBlocks, shiftLinesOnTarget, shiftLinesWithBlock } from '../timeline/lines/lineDocOps';
import { normalizeLedClip, normalizeLedClips, type TimelineLedClip } from '../timeline/leds/ledClips';
import { normalizeStageClip, normalizeStageClips, type StageClipRow, type TimelineStageClip } from '../timeline/stagefx/stageClips';
import { normalizeNamedOrders, normalizeWhere, type WhereNamedOrder } from '../timeline/where/whereModel';
import { EMPTY_SOUND_DOC, normalizeSoundDoc, soundDocIsEmpty, type SoundDoc } from '../timeline/sound/soundModel';
import { normalizeSections, sectionsEnd, tidySections, type TimelineSection } from '../timeline/sections/sectionModel';
import {
  createSectionPlayerState,
  freeRunOffset,
  goSections,
  resetSections,
  stepSections,
  type GoResult,
  type SectionEvent,
  type SectionPlayerState,
} from '../timeline/sections/sectionPlayer';
import { PHRASE_XFADE_SECONDS, withPhraseEnd } from '../timeline/phrases/phraseModel';
import { crossfadeLooks, crossfadeTrackFrames } from '../timeline/phrases/phraseCrossfade';

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
/** Default length of a look dropped on the Looks row, seconds. */
export const SHOW_DEFAULT_LOOK_SECONDS = 8;
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
  kind: 'audio' | 'preset' | 'transition' | 'layerClip' | 'track' | 'keyframe' | 'tempo' | 'lookClip' | 'ledClip' | 'stageClip' | 'soundRow' | 'liveClip' | 'build' | 'section';
  id: string;
}

/**
 * The two documents a project carries, each with its own song and tempo:
 * - 'show': presets along a timeline with music and transitions (the Show tab);
 * - 'timeline': the deep controller, rows for the mapping pieces, blocks,
 *   keyframe lanes and the Looks row (the Timeline tab).
 * One engine plays one of them at a time: the active document is in the
 * store, the other waits parked (see `activateDoc`).
 */
export type ShowDocKind = 'show' | 'timeline';

export interface ShowTimelineState {
  /** The document in the engine (and the tray that shows it). */
  doc: ShowDocKind;
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
  /** The Looks row (Timeline): shape Looks worn for a span. */
  lookClips: ShowLookClip[];
  /** Control lines (Timeline): every drawn or following parameter line. */
  lines: ControlLine[];
  /** Controllers bound to lines (a MIDI CC, a Live knob, an OSC address). */
  lineBindings: LineBinding[];
  /** LED rows (Timeline): blocks on the WLED controllers and their ranges. */
  ledClips: TimelineLedClip[];
  /** Screen FX and Effects rows (Timeline, Stage group): stage effects and composition effects for a span. */
  stageClips: TimelineStageClip[];
  /** Named spatial orders for where lines (Timeline). */
  whereOrders: WhereNamedOrder[];
  /** Sound rows (Timeline): what each audio lane is, Live clip and build blocks. */
  sound: SoundDoc;
  /** Sections (Timeline): named spans with an end action (hold, vamp, jump, live). */
  sections: TimelineSection[];
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
    doc: 'show',
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
    lookClips: [],
    lines: [],
    lineBindings: [],
    ledClips: [],
    stageClips: [],
    whereOrders: [],
    sound: EMPTY_SOUND_DOC,
    sections: [],
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
  lookClips: Pick<ShowLookClip, 'startTime' | 'duration'>[] = [],
  lines: readonly ControlLine[] = [],
  ledClips: readonly Pick<TimelineLedClip, 'startTime' | 'duration'>[] = [],
  stageClips: readonly Pick<TimelineStageClip, 'startTime' | 'duration'>[] = [],
): number {
  let end = lines.length ? linesEnd(lines) : 0;
  for (const c of stageClips) end = Math.max(end, c.startTime + c.duration);
  for (const c of ledClips) end = Math.max(end, c.startTime + c.duration);
  for (const c of lookClips) end = Math.max(end, c.startTime + c.duration);
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

/** The rows the show evaluates: those with blocks, lanes or a setting that
 *  changes the picture. A row with nothing on it leaves its piece to the
 *  current look, so it is left out (with a solo, every row counts: the
 *  others hide). */
let activeTracksMemo: { tracks: ShowLayerTrack[]; solo: string | null; out: ShowLayerTrack[] } | null = null;
function evaluatedTracks(s: ShowTimelineState): ShowLayerTrack[] {
  if (activeTracksMemo && activeTracksMemo.tracks === s.layerTracks && activeTracksMemo.solo === s.soloTrackId) return activeTracksMemo.out;
  const out = s.soloTrackId ? s.layerTracks : s.layerTracks.filter((t) => rowHasContent(t) || t.muted);
  activeTracksMemo = { tracks: s.layerTracks, solo: s.soloTrackId, out };
  return out;
}

/** The Timeline's control lines, ticked with the show (see setShowLineTicker). */
export interface ShowLineTick {
  doc: ShowDocKind;
  time: number;
  playing: boolean;
  tempo: ShowTempoMap | null;
  /** An offline render's virtual clock (live-only sources add nothing). */
  manual: boolean;
}
let lineTicker: ((tick: ShowLineTick) => void) | null = null;
/** Called on every evaluation of the show (each frame, every seek, an
 *  export's every frame), before its frame is published, so the lines'
 *  values reach the same flush as the rows'. */
export function setShowLineTicker(ticker: ((tick: ShowLineTick) => void) | null): void {
  lineTicker = ticker;
}

/**
 * Where lines and LED rows (Timeline, see timeline/where/whereRuntime.ts):
 * called on every evaluation, after the lines were ticked, so a where line's
 * position at this instant is known. `begin` publishes the LED rows; `looks`
 * and `frame` say which pieces wear a block with a where line.
 */
export interface ShowWhereDecorator {
  begin(s: ShowTimelineState, time: number): void;
  looks(s: ShowTimelineState, time: number, looks: ShowLookState[]): void;
  frame(s: ShowTimelineState, time: number, frame: ShowTrackFrame): void;
}
let whereDecorator: ShowWhereDecorator | null = null;
export function setShowWhereDecorator(decorator: ShowWhereDecorator | null): void {
  whereDecorator = decorator;
}

/** One evaluation of the show, for the Timeline's sound rows and Live clips. */
export interface ShowFrameTick extends ShowLineTick {
  /** Changes on every jump of the playhead (seek, scrub, loop wrap, start). */
  seek: number;
  loop: boolean;
  duration: number;
}
const frameListeners = new Set<(tick: ShowFrameTick) => void>();
/** Called on every evaluation of the show, after the lines. */
export function onShowFrame(listener: (tick: ShowFrameTick) => void): () => void {
  frameListeners.add(listener);
  return () => frameListeners.delete(listener);
}

/** Blocks' media through holds, loops and jumps (live Timeline only). */
function freeRunFor(s: ShowTimelineState): ((clip: ShowLayerClip) => { offset: number; paused: boolean } | null) | undefined {
  if (s.doc !== 'timeline' || isManualClock()) return undefined;
  const p = sectionPlayer;
  if (!p.hold && !p.freeRun.length) return undefined;
  const now = sectionClock();
  return (clip) => {
    if (clip.holdStops) return p.hold ? { offset: 0, paused: true } : null;
    const offset = freeRunOffset(p, clip.startTime, clipEnd(clip), now);
    return offset ? { offset, paused: false } : null;
  };
}

function publishTrackFrame(s: ShowTimelineState, evalTime: number, force = false): void {
  // Holding at a section's end: the song and everything that follows it
  // (sound rows, Live clips, line recording) stands still with the playhead.
  const rolling = s.isPlaying && !sectionHolding(s);
  if (lineTicker) {
    try {
      lineTicker({ doc: s.doc, time: evalTime, playing: rolling, tempo: s.tempo, manual: isManualClock() });
    } catch (err) {
      console.warn('[ShowTimeline] line tick failed:', err);
    }
  }
  const deco = whereDecorator;
  try { deco?.begin(s, evalTime); } catch (err) { console.warn('[ShowTimeline] where tick failed:', err); }
  if (frameListeners.size) {
    const tick: ShowFrameTick = { doc: s.doc, time: evalTime, playing: rolling, tempo: s.tempo, manual: isManualClock(), seek: seekGeneration, loop: s.loop, duration: s.duration };
    for (const listener of frameListeners) {
      try { listener(tick); } catch (err) { console.warn('[ShowTimeline] frame listener failed:', err); }
    }
  }
  const tracks = evaluatedTracks(s);
  const looks = s.lookClips.length ? evaluateShowLooks(s.lookClips, evalTime) : [];
  if (deco && looks.length) {
    try { deco.looks(s, evalTime, looks); } catch (err) { console.warn('[ShowTimeline] where looks failed:', err); }
  }
  if (!tracks.length && !looks.length) {
    if (lastTrackFrame !== null || force) {
      lastTrackFrame = null;
      lastTrackFrameSignature = null;
      try { trackFrameSink?.(null); } catch (err) { console.warn('[ShowTimeline] track frame publish failed:', err); }
    }
    return;
  }
  const evalOpts = {
    playing: s.isPlaying,
    seekGeneration,
    soloTrackId: s.soloTrackId,
    manualClock: isManualClock(),
    laneValues: (track: ShowLayerTrack, t: number) => (track.lanes.length ? evaluateLanes(track.lanes, t) : null),
    evaluatedAtMs: typeof performance !== 'undefined' ? performance.now() : undefined,
    wrap: lastLoopWrap && lastLoopWrap.generation === seekGeneration ? lastLoopWrap.wrap : null,
    freeRun: freeRunFor(s),
  };
  let frame = evaluateShowTracks(tracks, evalTime, evalOpts);
  if (looks.length) frame.looks = looks;
  // A phrase taking over: the old phrase fades out where it would have been.
  const xf = phrase.xfade;
  if (xf) {
    const p = (evalTime - xf.at) / xf.seconds;
    if (xf.generation !== seekGeneration || p >= 1 || p < -1e-6 || isManualClock() || s.doc !== 'timeline') {
      phrase.xfade = null;
    } else {
      const oldTime = xf.from + (evalTime - xf.at);
      const old = evaluateShowTracks(tracks, oldTime, { ...evalOpts, wrap: null, freeRun: undefined });
      frame = crossfadeTrackFrames(frame, old, Math.max(0, p));
      const oldLooks = s.lookClips.length ? evaluateShowLooks(s.lookClips.filter((c) => !c.where), oldTime) : [];
      const mixed = crossfadeLooks(frame.looks ?? [], oldLooks, Math.max(0, p));
      if (mixed.length) frame.looks = mixed;
      else delete frame.looks;
    }
  }
  if (deco) {
    try { deco.frame(s, evalTime, frame); } catch (err) { console.warn('[ShowTimeline] where frame failed:', err); }
  }
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
/** The last loop wrap, and the seek generation it began (see
 *  ShowTrackFrame.wrap). */
let lastLoopWrap: { generation: number; wrap: { fromGeneration: number; shift: number } } | null = null;

function busIdFor(trackId: string): string {
  return CLIP_AUDIO_PREFIX + trackId;
}

/** Where a track's sound goes instead of the master (the Timeline's sound
 *  rows). Null: the master, as on the Show. */
export type ShowAudioRouter = (trackId: string, ctx: AudioContext, master: AudioNode) => AudioNode | null;
let audioRouter: ShowAudioRouter | null = null;
export function setShowAudioRouter(router: ShowAudioRouter | null): void {
  audioRouter = router;
  for (const id of trackElements.keys()) clipAudioBus.rewireClip(busIdFor(id));
}
/** A track's output moved (another row): connect it again. */
export function rewireShowAudioTrack(trackId: string): void {
  clipAudioBus.rewireClip(busIdFor(trackId));
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
      // Following a musical clock at another tempo than the map, show time
      // runs at that ratio: the song has to as well, or it drifts out and
      // the bus warbles and hard-seeks to catch it.
      playbackRate: externalClock && s.isPlaying ? chaseAudioRate() : 1,
      paused: !s.isPlaying || !inWindow || sectionHolding(s),
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
    output: (ctx, master) => audioRouter?.(track.id, ctx, master) ?? null,
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

/** Animation frames while the editor is on screen, a timer while it is minimised. */
const ticker = createShowTicker((now) => tick(now));
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

/** The chased source's speed against show time, smoothed (1 = the map's
 *  tempo). Smoothed over about a quarter second, so a MIDI clock's tempo
 *  jitter does not wobble the song. */
let chaseRate = 1;
const CHASE_RATE_SMOOTHING = 0.08;
/** The last parked position the chase applied. A parked source re-sends the
 *  same position every tick; re-applying it would pin the playhead and the
 *  user could not move it. Only a new position (a locate) moves it. */
let lastParkedChase: number | null = null;

/** The song's playback rate while following: the smoothed chase rate on a
 *  1/2000 grid, so it settles instead of changing every frame. */
function chaseAudioRate(): number {
  return Math.round(chaseRate * 2000) / 2000;
}

/** Where `applyTime` would put the playhead for `time`. */
function settledShowTime(s: ShowTimelineState, time: number): number {
  const dur = s.duration;
  const t = Number.isFinite(time) ? Math.max(0, time) : 0;
  if (dur <= 0) return 0;
  if (s.loop) return ((t % dur) + dur) % dur;
  return Math.min(t, dur);
}

function isManualClock(): boolean {
  try {
    return isVisualAudioManualClock();
  } catch {
    return false;
  }
}

function cancelRaf(): void {
  ticker.cancel();
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

// ─── Sections (Timeline) ─────────────────────────────────────────────────
//
// While the Timeline plays, its sections may hold the playhead, loop a
// section or jump (timeline/sections/sectionPlayer.ts). Session state only:
// a seek, Stop or another document forgets it, and an offline render (manual
// clock) and a followed clock (timecode, Link, MIDI clock) never use it, so
// a render always plays the Timeline straight through.

const sectionPlayer: SectionPlayerState = createSectionPlayerState();

/** What the sections are doing now, for the transport and the cue list. */
export interface ShowSectionStatus {
  /** The section the playhead holds at the end of (hold / live), waiting for GO. */
  holdId: string | null;
  /** Sections GO armed to play on at their end. */
  armed: string[];
  /** A vamp told to leave (at its end, or at `vampExitAt`). */
  vampExitId: string | null;
  vampExitAt: number | null;
  /** The Live section whose pieces are with the VJ decks. */
  liveId: string | null;
  /** Passes played of each jump section. */
  passes: Record<string, number>;
}
const sectionStatusStore = writable<ShowSectionStatus>({ holdId: null, armed: [], vampExitId: null, vampExitAt: null, liveId: null, passes: {} });
export const showSectionStatus = { subscribe: sectionStatusStore.subscribe };

function publishSectionStatus(): void {
  const p = sectionPlayer;
  sectionStatusStore.set({
    holdId: p.hold?.sectionId ?? null,
    armed: [...p.armed],
    vampExitId: p.vampExit?.sectionId ?? null,
    vampExitAt: p.vampExit?.at ?? null,
    liveId: p.live,
    passes: { ...p.passes },
  });
}

/** Carries out what the sections asked for (the Live takeover). */
export type ShowSectionEffects = (event: SectionEvent) => void;
let sectionEffects: ShowSectionEffects | null = null;
export function setShowSectionEffects(effects: ShowSectionEffects | null): void {
  sectionEffects = effects;
}

function runSectionEvents(events: readonly SectionEvent[]): void {
  for (const e of events) {
    try { sectionEffects?.(e); } catch (err) { console.warn('[ShowTimeline] section effect failed:', err); }
  }
  publishSectionStatus();
}

/** Clock for holds (seconds). Test seam: `_setSectionClock`. */
let sectionClock: () => number = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;

function sectionsRun(s: Pick<ShowTimelineState, 'doc' | 'sections'>): boolean {
  return s.doc === 'timeline' && s.sections.length > 0 && !externalClock && !isManualClock();
}

/** The Timeline is holding at a section's end (the song holds too). */
function sectionHolding(s: Pick<ShowTimelineState, 'doc'>): boolean {
  return s.doc === 'timeline' && sectionPlayer.hold !== null;
}

/** Clock seconds a hold was paused at (a paused hold does not run its blocks on). */
let holdPausedAt: number | null = null;

function forgetSections(): void {
  holdPausedAt = null;
  const hadState = sectionPlayer.hold || sectionPlayer.live || sectionPlayer.armed.length || sectionPlayer.vampExit
    || sectionPlayer.freeRun.length || Object.keys(sectionPlayer.passes).length;
  if (!hadState) return;
  runSectionEvents(resetSections(sectionPlayer, get(store).sections));
}

/**
 * How far ahead a Timeline block's media runs (free-running content through
 * holds, loops and jumps), for the LED rows. 0 outside a live session.
 */
export function showFreeRunOffset(start: number, end: number): number {
  const s = get(store);
  if (s.doc !== 'timeline' || isManualClock()) return 0;
  if (!sectionPlayer.hold && !sectionPlayer.freeRun.length) return 0;
  return freeRunOffset(sectionPlayer, start, end, sectionClock());
}

// ─── Phrases (Timeline) ──────────────────────────────────────────────────
//
// A/V phrases (timeline/phrases/phraseModel.ts): a published section played
// from its start by this transport, on the next bar. While the Timeline
// plays, a launch waits for its bar in transport seconds (`elapsed`, the
// show time the clock has advanced, loops and holds left out), so a phrase
// looping a section shorter than the wait still hands over on the bar.
// Stopped, a timer starts the transport on the bar. The landing is a seek
// with a short crossfade of the pieces and looks from where the old phrase
// would have been. The section player plays the phrase's section with the
// phrase's end action. Session only, never saved; Render to Video plays the
// Timeline straight through.

/** What the phrases are doing, for the pads and the transport. */
export interface ShowPhraseStatus {
  /** The phrase playing (a section id). */
  activeId: string | null;
  /** A launch waiting for its bar: a phrase, or a stop (null). */
  pending: { id: string | null; at: number } | null;
}
const phraseStatusStore = writable<ShowPhraseStatus>({ activeId: null, pending: null });
export const showPhraseStatus = { subscribe: phraseStatusStore.subscribe };

export type ShowPhraseEvent =
  /** A launch is waiting: it lands at wall time `at` (performance.now() ms). */
  | { type: 'pending'; id: string | null; at: number; immediate: boolean; origin: PhraseOrigin }
  /** A phrase took over: the playhead is at `time` (just after its start). */
  | { type: 'land'; id: string; time: number; from: string | null; origin: PhraseOrigin }
  /** Phrases stopped (the transport paused on the bar). */
  | { type: 'stop'; from: string | null }
  /** A waiting launch was called off (Stop, a seek outside, another document). */
  | { type: 'cancel' };
export interface PhraseOrigin {
  /** Launched by a Live scene (Live already started its clips). */
  scene?: number;
}
let phraseEffects: ((event: ShowPhraseEvent) => void) | null = null;
export function setShowPhraseEffects(effects: ((event: ShowPhraseEvent) => void) | null): void {
  phraseEffects = effects;
}
function emitPhrase(event: ShowPhraseEvent): void {
  try { phraseEffects?.(event); } catch (err) { console.warn('[ShowTimeline] phrase effect failed:', err); }
}

interface PhraseSession {
  activeId: string | null;
  /** A launch waiting for its bar. Playing: `due` in transport seconds;
   *  stopped: `dueMs` wall time and its timer. */
  pending: { id: string | null; due?: number; dueMs?: number; timer?: unknown; origin: PhraseOrigin } | null;
  /** Show seconds the transport has advanced while playing. */
  elapsed: number;
  /** The hand-over crossfade: the old phrase's show time `from` at the new
   *  one's `at`, for the seek generation it began. */
  xfade: { from: number; at: number; generation: number; seconds: number } | null;
}
const phrase: PhraseSession = { activeId: null, pending: null, elapsed: 0, xfade: null };

/** The frame the phrase clock last counted (a hold counts wall time). */
let phraseLastFrameMs: number | null = null;
/** Wall clock for phrase launches from a stopped Timeline (ms). Test seam. */
let phraseNowMs: () => number = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
let phraseTimer: (fn: () => void, ms: number) => unknown = (fn, ms) => setTimeout(fn, Math.max(0, ms));
let phraseClearTimer: (handle: unknown) => void = (h) => clearTimeout(h as ReturnType<typeof setTimeout>);

function publishPhraseStatus(): void {
  const p = phrase.pending;
  let pending: ShowPhraseStatus['pending'] = null;
  if (p) pending = { id: p.id, at: p.dueMs ?? phraseNowMs() + Math.max(0, (p.due ?? 0) - phrase.elapsed) * 1000 };
  phraseStatusStore.set({ activeId: phrase.activeId, pending });
}

function clearPhrasePending(emit = true): void {
  const p = phrase.pending;
  if (!p) return;
  if (p.timer !== undefined) phraseClearTimer(p.timer);
  phrase.pending = null;
  if (emit) emitPhrase({ type: 'cancel' });
}

/**
 * Everything about phrases forgotten (Stop, another document, a new file,
 * the end of the show). A phrase that was playing stops (the VJ decks get
 * the output back). Returns whether a stop went out.
 */
function forgetPhrases(): boolean {
  const had = phrase.activeId !== null || phrase.pending !== null || phrase.xfade !== null;
  const from = phrase.activeId;
  clearPhrasePending(phrase.pending !== null);
  phrase.activeId = null;
  phrase.xfade = null;
  if (had) publishPhraseStatus();
  if (from !== null) emitPhrase({ type: 'stop', from });
  return from !== null;
}

/** The sections as the player sees them (the playing phrase's end action). */
function playerSections(s: Pick<ShowTimelineState, 'sections'>): readonly TimelineSection[] {
  return phrase.activeId ? withPhraseEnd(s.sections, phrase.activeId) : s.sections;
}

/** The playing phrase follows the playhead into the next published section
 *  (a phrase that plays on, or jumps). */
function followPhrase(s: ShowTimelineState): void {
  if (!phrase.activeId) return;
  const here = s.sections.find((x) => s.currentTime >= x.start - 1e-9 && s.currentTime < x.end - 1e-9);
  if (here && here.phrase && here.id !== phrase.activeId) {
    phrase.activeId = here.id;
    publishPhraseStatus();
  }
}

/**
 * The phrase waiting lands now: `over` seconds past its bar, the old show
 * time at the bar `oldAt`, the clock's proposed show time `next`.
 */
function landPhrase(over: number, oldAt: number, next: number | null): void {
  const p = phrase.pending;
  if (!p) return;
  if (p.timer !== undefined) phraseClearTimer(p.timer);
  phrase.pending = null;
  const from = phrase.activeId;
  const s = get(store);
  if (p.id === null) {
    // Stop on the bar: the picture stays where the bar left it.
    phrase.activeId = null;
    phrase.xfade = null;
    publishPhraseStatus();
    emitPhrase({ type: 'stop', from });
    applyTime(oldAt, false);
    showTimeline.pause();
    return;
  }
  const target = s.sections.find((x) => x.id === p.id);
  if (!target) {
    // The phrase was deleted while it waited: the launch is off.
    publishPhraseStatus();
    emitPhrase({ type: 'cancel' });
    return;
  }
  const time = Math.min(target.end - 1e-4, target.start + Math.max(0, over));
  // The old phrase's holds, loops and Live pieces end with it.
  forgetSections();
  phrase.activeId = target.id;
  emitPhrase({ type: 'land', id: target.id, time, from, origin: p.origin });
  if (next !== null) transportClock.shift(time - next);
  else transportClock.reset();
  phrase.xfade = from !== null || next !== null ? { from: oldAt, at: target.start, generation: seekGeneration + 1, seconds: PHRASE_XFADE_SECONDS } : null;
  applyTime(time, true);
  publishPhraseStatus();
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
  const s = get(store);
  if (!s.isPlaying) return;

  const audio = audioClockReader && showHasAudibleTracks(s) ? audioClockReader(now) : null;
  let next = transportClock.advance({ frame: now / 1000, audio }, s.currentTime);

  // A phrase waiting for its bar: counted in transport seconds, so loops and
  // the end of the Timeline do not move the bar it waits for.
  if (s.doc === 'timeline' && !externalClock && !isManualClock()) {
    const held = sectionHolding(s);
    const step = held ? Math.max(0, (now - (phraseLastFrameMs ?? now)) / 1000) : Math.max(0, next - s.currentTime);
    phraseLastFrameMs = now;
    phrase.elapsed += step;
    const p = phrase.pending;
    if (p && p.due !== undefined && phrase.elapsed >= p.due - 1e-9) {
      const over = phrase.elapsed - p.due;
      const oldAt = held ? s.currentTime : Math.max(s.currentTime, next - over);
      landPhrase(over, oldAt, next);
      if (get(store).isPlaying) ticker.request();
      return;
    }
  }

  if (sectionsRun(s)) {
    const step = stepSections(sectionPlayer, playerSections(s), s.tempo, s.currentTime, next, sectionClock());
    if (step.events.length) runSectionEvents(step.events);
    if (step.kind === 'hold') {
      // The playhead stays; the clock re-anchors when GO lets it go.
      transportClock.reset();
      applyTime(step.time, false);
      ticker.request();
      return;
    }
    if (step.kind === 'wrap') {
      // A loop or a jump: like the show's own loop wrap, the clock keeps its
      // anchor and the evaluation knows by how much show time moved.
      transportClock.shift(step.time - next);
      lastLoopWrap = { generation: seekGeneration + 1, wrap: { fromGeneration: seekGeneration, shift: step.shift } };
      applyTime(step.time, true);
      ticker.request();
      return;
    }
  } else if (sectionPlayer.hold) {
    forgetSections();
  }

  const dur = s.duration;
  if (dur > 0 && next >= dur) {
    if (s.loop) {
      // A new pass of the show: the last pass's vamps, jump counts and
      // free-running offsets are done with.
      forgetSections();
      const wrapped = ((next % dur) + dur) % dur;
      // Keep the clock anchor: only the show time moves back by whole passes.
      transportClock.shift(wrapped - next);
      lastLoopWrap = { generation: seekGeneration + 1, wrap: { fromGeneration: seekGeneration, shift: next - wrapped } };
      next = wrapped;
      applyTime(next, true); // wrap is a discontinuity for the audio bus
      ticker.request();
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
  if (phrase.activeId) followPhrase(get(store));
  ticker.request();
}

/** The end of a show that does not loop. */
function finishShow(action: ShowEndAction): void {
  forgetSections();
  forgetPhrases();
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
  const tracks = soundDocIsEmpty(s.sound) ? s.audioTracks : [...s.audioTracks, ...s.sound.live, ...s.sound.builds];
  const duration = computeShowDuration(s.presetClips, tracks, s.layerTracks, s.cameraLane, s.lookClips, s.lines, s.ledClips, s.stageClips);
  return { ...s, duration: s.sections.length ? Math.max(duration, sectionsEnd(s.sections)) : duration };
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
    ...(Number(t.fadeIn) > 0 ? { fadeIn: Number(t.fadeIn) } : {}),
    ...(Number(t.fadeOut) > 0 ? { fadeOut: Number(t.fadeOut) } : {}),
    ...(t.sound && typeof (t.sound as { id?: unknown }).id === 'string'
      ? { sound: { id: (t.sound as { id: string }).id, ...(Number.isFinite(Number((t.sound as { note?: unknown }).note)) ? { note: Number((t.sound as { note: number }).note) } : {}) } }
      : {}),
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
  if (typeof c.blendMode === 'string' && c.blendMode) clip.blendMode = c.blendMode as ShowLayerClip['blendMode'];
  if (typeof c.label === 'string') clip.label = c.label;
  if (typeof c.color === 'string') clip.color = c.color;
  const where = normalizeWhere(c.where);
  if (where) clip.where = { ...where, members: 'pieces' };
  if (c.holdStops === true) clip.holdStops = true;
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
    // Rows hide their piece between blocks unless they say otherwise (files
    // before rows came from the stage always said).
    gap: t.gap === 'layer' ? 'layer' : 'hide',
    muted: t.muted === true,
    locked: t.locked === true,
    collapsed: t.collapsed === true,
    ...(t.subRow === true ? { subRow: true } : {}),
    ...(t.foldChildren === true ? { foldChildren: true } : {}),
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

/** A block on the Looks row from a file or an undo step (null: unusable). */
export function normalizeLookClip(raw: unknown): ShowLookClip | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  if (typeof c.lookId !== 'string' || !c.lookId) return null;
  const layerIds = Array.isArray(c.layerIds) ? c.layerIds.filter((id): id is string => typeof id === 'string' && !!id) : [];
  const duration = Math.max(SHOW_MIN_TRACK_CLIP_SECONDS, finiteOr(c.duration, SHOW_DEFAULT_LOOK_SECONDS));
  return {
    id: typeof c.id === 'string' && c.id ? c.id : generateUUID(),
    startTime: Math.max(0, finiteOr(c.startTime, 0)),
    duration,
    lookId: c.lookId,
    paletteId: typeof c.paletteId === 'string' && c.paletteId ? c.paletteId : '',
    scope: c.scope === 'pieces' ? 'pieces' : 'all',
    ...(c.scope === 'pieces' ? { layerIds } : {}),
    fadeIn: Math.max(0, Math.min(duration, finiteOr(c.fadeIn, 0))),
    fadeOut: Math.max(0, Math.min(duration, finiteOr(c.fadeOut, 0))),
    ...whereField(c.where),
  };
}

/** A block's where line, when it has one. */
function whereField(raw: unknown): { where?: NonNullable<ReturnType<typeof normalizeWhere>> } {
  const where = normalizeWhere(raw);
  return where ? { where } : {};
}

function normalizeLookClips(raw: unknown): ShowLookClip[] {
  return (Array.isArray(raw) ? raw : [])
    .map(normalizeLookClip)
    .filter((c): c is ShowLookClip => c !== null)
    .sort((a, b) => a.startTime - b.startTime);
}

export function normalizeSnapGrid(raw: unknown, hasTempo: boolean): ShowSnapGrid {
  return SNAP_GRIDS.has(raw as ShowSnapGrid) ? (raw as ShowSnapGrid) : hasTempo ? 'beat' : 'seconds';
}

/** Underscore fields a track's copy of its layer keeps: the AssetRefs of
 *  its media (a splat's texture and a PixelFX source too), so the copy's
 *  own content survives save and reload and the project packager finds it. */
const TEMPLATE_KEPT_FIELDS = new Set(['_assetRef', '_textureAssetRef', '_sourceAssetRef']);

/**
 * A clean copy of a layer to keep on its track, for when the layer is not on
 * stage. Runtime handles go; the media's AssetRefs stay so the copy's own
 * content survives save and reload.
 */
export function trackTemplateFromLayer(layer: Layer): Layer {
  const clean = JSON.parse(JSON.stringify(layer, (key, value) => {
    if (key === 'texture' || key === 'videoElement' || key === 'renderTarget' || key === 'iframeElement' || key === 'synthVisionCanvas') return undefined;
    if (typeof key === 'string' && key.startsWith('_') && !TEMPLATE_KEPT_FIELDS.has(key)) return undefined;
    return value;
  })) as Layer;
  // Geometry is resolved live from the shared surface map it belongs to.
  return { ...clean, surfaceId: layer.surfaceId || layer.id };
}

/** Track copies of their layers, refreshed where they changed. */
function refreshTemplates(pairs: ReadonlyArray<readonly [ShowLayerTrack, Layer]>): void {
  if (!pairs.length) return;
  const next = new Map<string, { template: Layer; layerName: string }>();
  for (const [track, layer] of pairs) {
    const template = trackTemplateFromLayer(layer);
    // A layer the show added on a piece keeps its own name.
    const layerName = track.subRow ? track.layerName : layer.name;
    if (track.template && track.layerName === layerName && sameJson(track.template, template)) continue;
    next.set(track.id, { template, layerName });
  }
  if (!next.size) return;
  store.update((s) => ({
    ...s,
    layerTracks: s.layerTracks.map((t) => {
      const fresh = next.get(t.id);
      return fresh ? { ...t, ...fresh } : t;
    }),
  }));
  republishTracks();
}

/** The project's live layers, for refreshing track templates before a save
 *  (installed by the show-track runtime). */
let templateLayerSource: (() => readonly Layer[]) | null = null;
export function setShowTemplateLayerSource(source: (() => readonly Layer[]) | null): void {
  templateLayerSource = source;
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
  lookClips?: ShowLookClip[];
  lines?: ControlLine[];
  ledClips?: TimelineLedClip[];
  stageClips?: TimelineStageClip[];
  whereOrders?: WhereNamedOrder[];
  sound?: SoundDoc;
  sections?: TimelineSection[];
  /** The Timeline document's arrangement; the fields above are the Show's.
   *  Missing in steps made before the two were separate: such a step is
   *  the active document's. */
  timeline?: ShowArrangement;
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
  /** The Demo Reel shots the camera lane uses (shots are kept per machine;
   *  the show carries its own). Missing in older files. */
  cameraShots?: DemoShot[];
  /** Version 4: the Timeline's Looks row. */
  lookClips?: ShowLookClip[];
  /** Version 5: the Timeline's control lines and their controllers. */
  lines?: ControlLine[];
  lineBindings?: LineBinding[];
  /** Version 6: the Timeline's LED rows and named where orders. */
  ledClips?: TimelineLedClip[];
  whereOrders?: WhereNamedOrder[];
  /** Version 7: the Timeline's sound rows, Live clip and build blocks (missing = default rows). */
  sound?: SoundDoc;
  /** Version 8: the Timeline's sections (hold / vamp / jump / live, GO). */
  sections?: TimelineSection[];
  /** Version 9: the Timeline's Screen FX and Effects rows. */
  stageClips?: TimelineStageClip[];
  /** Version 4: the Timeline document (the fields above are the Show's). */
  timeline?: ShowTimelineSnapshot;
  /** Version 4: the document that was active when saved. */
  activeDoc?: ShowDocKind;
}

// ─── Two documents ───────────────────────────────────────────────────────
//
// The Show and the Timeline are separate documents with the same shape. One
// engine (this store: transport, audio, evaluation) holds the active one;
// the other waits here, untouched, until its tab is opened. So only one can
// play, every consumer of the store (cues, following, Stage Sim, Rec,
// export, show control) acts on the active one, and none of them had to
// learn about two documents.

/** What a document owns. Everything else in the state is the engine's. */
const DOC_KEYS = [
  'audioTracks', 'presetClips', 'layerTracks', 'lookClips', 'lines', 'lineBindings', 'ledClips', 'stageClips', 'whereOrders', 'sound', 'sections', 'cameraLane', 'tempo', 'loop', 'endAction',
  'rulerMode', 'snapGrid', 'zoom', 'snapEnabled', 'currentTime', 'selection', 'selectedClipIds', 'soloTrackId',
] as const;
export type ShowDocFields = Pick<ShowTimelineState, (typeof DOC_KEYS)[number]>;

function docFieldsOf(s: ShowDocFields): ShowDocFields {
  const out = {} as Record<string, unknown>;
  for (const key of DOC_KEYS) out[key] = s[key];
  return out as unknown as ShowDocFields;
}

function emptyDocFields(): ShowDocFields {
  return docFieldsOf(createInitialState());
}

let parkedDoc: ShowDocFields = emptyDocFields();
const parkedStore = writable<ShowDocFields>(parkedDoc);
function setParked(doc: ShowDocFields): void {
  parkedDoc = doc;
  parkedStore.set(doc);
}
/** The document that is not active (read only). */
export const parkedShowDoc = { subscribe: parkedStore.subscribe };

/** A document has something on it. */
export function docHasContent(d: Pick<ShowDocFields, 'presetClips' | 'audioTracks' | 'layerTracks' | 'lookClips' | 'cameraLane'> & { lines?: readonly ControlLine[]; ledClips?: readonly TimelineLedClip[]; stageClips?: readonly TimelineStageClip[]; sound?: SoundDoc; sections?: readonly TimelineSection[] }): boolean {
  return d.presetClips.length > 0 || d.audioTracks.length > 0 || d.lookClips.length > 0 || d.cameraLane.length > 0
    || (d.sections?.length ?? 0) > 0
    || (d.ledClips?.length ?? 0) > 0
    || (d.stageClips?.length ?? 0) > 0
    || (d.lines?.length ?? 0) > 0 || (d.sound?.live.length ?? 0) > 0 || (d.sound?.builds.length ?? 0) > 0
    || d.layerTracks.some((t) => !isBareRow(t));
}

const docListeners = new Set<(doc: ShowDocKind) => void>();
/** Told after the active document changed (a tab was opened, a project loaded). */
export function onShowDocChange(listener: (doc: ShowDocKind) => void): () => void {
  docListeners.add(listener);
  return () => docListeners.delete(listener);
}
function notifyDocChange(doc: ShowDocKind): void {
  for (const listener of docListeners) {
    try { listener(doc); } catch (err) { console.warn('[ShowTimeline] document listener failed:', err); }
  }
}

export const SHOW_DOC_NAMES: Record<ShowDocKind, string> = { show: 'Show', timeline: 'Timeline' };

/** An arrangement (one undo step's view) of a document. */
function arrangementOf(d: ShowDocFields): ShowArrangement {
  return {
    audioTracks: d.audioTracks.map((t) => ({ ...t })),
    presetClips: d.presetClips.map((c) => ({ ...c })),
    loop: d.loop,
    endAction: d.endAction,
    // Track and clip objects are replaced on every edit, never mutated,
    // so holding them is a complete capture.
    layerTracks: d.layerTracks,
    tempo: d.tempo,
    cameraLane: d.cameraLane,
    lookClips: d.lookClips,
    // Lines are replaced on every edit, never mutated.
    lines: d.lines,
    ledClips: d.ledClips,
    stageClips: d.stageClips,
    whereOrders: d.whereOrders,
    // So is the sound doc.
    sound: d.sound,
    sections: d.sections,
  };
}

/** A document with an arrangement put back into it (selection kept where
 *  it still points at something). */
function docWithArrangement(base: ShowDocFields, a: Partial<ShowArrangement>): ShowDocFields {
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
  const lookClips = normalizeLookClips(a.lookClips);
  const lines = Array.isArray(a.lines) ? a.lines : base.lines;
  const ledClips = Array.isArray(a.ledClips) ? normalizeLedClips(a.ledClips) : base.ledClips;
  const stageClips = Array.isArray(a.stageClips) ? normalizeStageClips(a.stageClips) : base.stageClips;
  const whereOrders = Array.isArray(a.whereOrders) ? normalizeNamedOrders(a.whereOrders) : base.whereOrders;
  const sound = a.sound !== undefined ? normalizeSoundDoc(a.sound) : base.sound;
  const sections = Array.isArray(a.sections) ? normalizeSections(a.sections) : base.sections;
  const tempo = normalizeTempoMap(a.tempo);
  const clipIds = new Set(layerTracks.flatMap((t) => t.clips.map((c) => c.id)));
  const ids = new Set([
    ...audioTracks.map((t) => t.id),
    ...presetClips.map((c) => c.id),
    ...layerTracks.map((t) => t.id),
    ...lookClips.map((c) => c.id),
    ...ledClips.map((c) => c.id),
    ...stageClips.map((c) => c.id),
    ...clipIds,
    ...sound.rows.map((r) => r.id),
    ...sound.live.map((b) => b.id),
    ...sound.builds.map((b) => b.id),
    ...sections.map((x) => x.id),
  ]);
  return {
    ...base,
    audioTracks,
    presetClips,
    loop: a.loop === true,
    endAction: normalizeShowEndAction(a.endAction),
    layerTracks,
    tempo,
    snapGrid: normalizeSnapGrid(base.snapGrid, !!tempo),
    rulerMode: tempo ? base.rulerMode : 'time',
    cameraLane,
    lookClips,
    lines,
    ledClips,
    stageClips,
    whereOrders,
    sound,
    sections,
    soloTrackId: base.soloTrackId && layerTracks.some((t) => t.id === base.soloTrackId) ? base.soloTrackId : null,
    selectedClipIds: base.selectedClipIds.filter((id) => clipIds.has(id)),
    selection: base.selection && ids.has(base.selection.id) ? base.selection : null,
  };
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

/** A document as it is saved (see `serialize`). */
function docSnapshot(d: ShowDocFields): Omit<ShowTimelineSnapshot, 'version' | 'isOpen'> {
  return {
    loop: d.loop,
    endAction: d.endAction,
    zoom: d.zoom,
    snapEnabled: d.snapEnabled,
    audioTracks: d.audioTracks.map((t) => ({
      ...t,
      url: refIsDurable(t.assetRef) ? '' : t.url,
    })),
    presetClips: d.presetClips.map((c) => ({ ...c })),
    layerTracks: d.layerTracks.filter((t) => !isBareRow(t)).map(({ row: _row, ...t }) => ({
      ...t,
      template: serializeTemplate(t.template),
      clips: t.clips.map((c) => ({ ...c, media: serializeClipMedia(c.media) })),
    })),
    tempo: d.tempo,
    rulerMode: d.rulerMode,
    snapGrid: d.snapGrid,
    cameraLane: d.cameraLane.map((c) => ({ ...c })),
    ...(d.cameraLane.length > 0 ? { cameraShots: cameraShotTable(d.cameraLane, get(demoReel).shots) } : {}),
    ...(d.lookClips.length > 0 ? { lookClips: d.lookClips.map((c) => ({ ...c, ...(c.layerIds ? { layerIds: [...c.layerIds] } : {}) })) } : {}),
    ...(d.lines.length > 0 ? { lines: d.lines } : {}),
    ...(d.lineBindings.length > 0 ? { lineBindings: d.lineBindings } : {}),
    ...(d.ledClips.length > 0 ? { ledClips: d.ledClips.map((c) => ({ ...c })) } : {}),
    ...(d.stageClips.length > 0 ? { stageClips: d.stageClips.map((c) => JSON.parse(JSON.stringify(c)) as TimelineStageClip) } : {}),
    ...(d.whereOrders.length > 0 ? { whereOrders: d.whereOrders } : {}),
    ...(!soundDocIsEmpty(d.sound) ? { sound: d.sound } : {}),
    ...(d.sections.length > 0 ? { sections: d.sections.map((x) => ({ ...x })) } : {}),
  };
}

/** A saved document read back, its media resolved for this machine. */
function hydrateDoc(p: Record<string, unknown>, projectDir?: string): ShowDocFields {
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
  // Shots the lane uses that this machine's Demo Reel lacks come with the show.
  if (cameraLane.length > 0) {
    const shots = readCameraShotTable(p.cameraShots);
    if (shots.length > 0) demoReel.adoptShots(shots);
  }

  const zoom = Number(p.zoom);
  // The ◆ keyframe lanes of step 1 are control lines now (same keys).
  const savedLines = normalizeLines(p.lines);
  const converted = lanesToLines(layerTracks, savedLines);
  return {
    audioTracks,
    presetClips,
    layerTracks: converted.tracks,
    lookClips: normalizeLookClips(p.lookClips),
    lines: converted.lines.length ? [...savedLines, ...converted.lines] : savedLines,
    lineBindings: normalizeBindings(p.lineBindings),
    ledClips: normalizeLedClips(p.ledClips),
    stageClips: normalizeStageClips(p.stageClips),
    whereOrders: normalizeNamedOrders(p.whereOrders),
    sound: normalizeSoundDoc(p.sound),
    sections: normalizeSections(p.sections),
    cameraLane,
    tempo,
    loop: p.loop === true,
    endAction: normalizeShowEndAction(p.endAction),
    rulerMode: p.rulerMode === 'bars' && tempo ? 'bars' : 'time',
    snapGrid: normalizeSnapGrid(p.snapGrid, !!tempo),
    zoom: Number.isFinite(zoom) ? Math.max(SHOW_MIN_ZOOM, Math.min(SHOW_MAX_ZOOM, zoom)) : SHOW_DEFAULT_ZOOM,
    snapEnabled: p.snapEnabled !== false,
    currentTime: 0,
    selection: null,
    selectedClipIds: [],
    soloTrackId: null,
  };
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
    phraseLastFrameMs = null;
    if (sectionPlayer.hold && holdPausedAt !== null) sectionPlayer.hold.since += Math.max(0, sectionClock() - holdPausedAt);
    holdPausedAt = null;
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
    if (typeof requestAnimationFrame === 'function') ticker.request();
  },

  pause() {
    if (externalClock) {
      // A rolling clock owns the transport: pausing would only last until
      // its next position restarted the show with a hard seek.
      if (!chaseTransportHandler?.('pause') && get(store).isPlaying) return;
    }
    cancelRaf();
    if (phrase.pending) {
      clearPhrasePending();
      publishPhraseStatus();
    }
    if (sectionPlayer.hold && holdPausedAt === null && get(store).isPlaying) holdPausedAt = sectionClock();
    store.update((s) => ({ ...s, isPlaying: false }));
    seekGeneration++;
    transportClock.reset();
    republishTracks();
  },

  stop() {
    if (externalClock) {
      if (!chaseTransportHandler?.('stop') && get(store).isPlaying) return;
    }
    cancelRaf();
    forgetSections();
    forgetPhrases();
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
  chase(seconds: number, running: boolean, rate = 1) {
    if (!externalClock) {
      // The outside clock takes the playhead: sections and phrases need the
      // Timeline's own transport, so what they were doing ends here.
      externalClock = true;
      forgetSections();
      forgetPhrases();
    }
    externalClock = true;
    cancelRaf();
    const s = get(store);
    const target = Number.isFinite(seconds) ? seconds : 0;
    // Compared where the playhead would land: past the end of a looping
    // show, or before 0, the raw target is never "here" and every tick
    // would be a jump that hard-seeks the audio and every video.
    const jump = Math.abs(settledShowTime(s, target) - s.currentTime) > SHOW_CHASE_RESEEK_SECONDS;
    const r = Number.isFinite(rate) && rate > 0 ? Math.max(0.25, Math.min(4, rate)) : 1;
    if (running) {
      lastParkedChase = null;
      chaseRate = s.isPlaying ? chaseRate + (r - chaseRate) * CHASE_RATE_SMOOTHING : r;
    }
    if (running && !s.isPlaying) {
      if (s.duration <= 0) return;
      syncAudioWiring(s.audioTracks);
      clipAudioBus.resume();
      store.update((x) => ({ ...x, isPlaying: true }));
      applyTime(target, true);
      return;
    }
    if (!running && s.isPlaying) {
      lastParkedChase = target;
      chaseRate = 1;
      store.update((x) => ({ ...x, isPlaying: false }));
      applyTime(target, true);
      return;
    }
    if (!running) {
      // Parked: only a new position from the source moves the playhead, so
      // the user can still scrub or Stop while the source sits still.
      if (lastParkedChase !== null && Math.abs(target - lastParkedChase) < 1e-6) return;
      lastParkedChase = target;
      if (Math.abs(settledShowTime(s, target) - s.currentTime) < 1e-6) return;
      applyTime(target, true);
      return;
    }
    applyTime(target, jump);
  },

  /** Hand the playhead back to the internal transport. */
  releaseChase() {
    if (!externalClock) return;
    externalClock = false;
    chaseRate = 1;
    lastParkedChase = null;
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
    forgetSections();
    // A launch waiting for its bar is called off (its bar was on the old place).
    if (phrase.pending) {
      clearPhrasePending();
      publishPhraseStatus();
    }
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
    /** Timeline sound blocks: fades, the library sound it was rendered from. */
    extra?: Partial<Pick<ShowAudioTrack, 'fadeIn' | 'fadeOut' | 'sound' | 'peaks' | 'sourceDuration'>>;
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
      ...(init.extra ?? {}),
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
    const existing = get(store).layerTracks.find((t) => t.layerId === layer.id && !t.subRow);
    if (existing) {
      store.update((s) => ({ ...s, selection: { kind: 'track', id: existing.id } }));
      return existing.id;
    }
    const id = rowTrackId(layer.id);
    const track: ShowLayerTrack = {
      ...bareRowFor({ id: layer.id, name: layer.name }),
      color: opts.color,
      template: trackTemplateFromLayer(layer),
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
    // The row's block lines go with it, and an added layer's own lines.
    const subTarget = track.subRow ? `showsub::${track.layerId}::${track.id}` : null;
    store.update((s) => withDuration({
      ...s,
      lines: (() => {
        const kept = removeLinesForBlocks(s.lines, clipIds);
        if (!subTarget || !kept.some((l) => l.target.scope === 'layer' && l.target.id === subTarget)) return kept;
        return kept.filter((l) => !(l.target.scope === 'layer' && l.target.id === subTarget));
      })(),
      layerTracks: s.layerTracks.filter((t) => t.id !== trackId),
      soloTrackId: s.soloTrackId === trackId ? null : s.soloTrackId,
      selectedClipIds: s.selectedClipIds.filter((id) => !clipIds.has(id)),
      selection: s.selection && (s.selection.id === trackId || clipIds.has(s.selection.id)) ? null : s.selection,
    }));
    recordShowEdit();
    republishTracks();
  },

  /**
   * Rows from the mapping stage (see show/tracks/showStageRows.ts): the
   * layers on stage now and those of the looks the show uses. Rows are
   * added, named, ordered and folded to match; nothing is recorded as an
   * edit (a row with nothing on it is not part of the show).
   */
  syncStageRows(stage: readonly Layer[], looks: ReadonlyArray<readonly Layer[]>) {
    const pieces = stagePieces(stage, looks);
    const next = reconcileStageRows(get(store).layerTracks, pieces, { templateOf: trackTemplateFromLayer });
    if (!next) return;
    store.update((s) => ({
      ...s,
      layerTracks: next,
      soloTrackId: s.soloTrackId && next.some((t) => t.id === s.soloTrackId) ? s.soloTrackId : null,
    }));
    republishTracks();
  },

  /** The looks (preset ids) the show uses, in the order it first uses them. */
  usedCompositionIds(): string[] {
    return [...new Set(get(store).presetClips.map((c) => c.compositionId))];
  },

  /**
   * "+ Layer on this piece": a row whose blocks draw over the piece, sharing
   * its shape, under the piece's other added layers. Never added to the
   * mapping Layers panel. Returns the new row's id.
   */
  addSubRow(layerId: string, name?: string): string | null {
    const tracks = get(store).layerTracks;
    const main = tracks.find((t) => t.layerId === layerId && !t.subRow);
    if (!main) return null;
    const own = tracks.filter((t) => t.layerId === layerId && t.subRow);
    const id = generateUUID();
    const track: ShowLayerTrack = {
      id,
      layerId,
      layerName: name?.trim() || `${main.layerName} · layer ${own.length + 2}`,
      template: main.template,
      clips: [],
      lanes: [],
      gap: 'hide',
      muted: false,
      locked: false,
      collapsed: false,
      subRow: true,
      ...(main.row ? { row: { ...main.row, kind: 'sub' as const, depth: main.row.depth + 1 } } : {}),
    };
    const last = own.length ? tracks.indexOf(own[own.length - 1]) : tracks.indexOf(main);
    store.update((s) => {
      const layerTracks = [...s.layerTracks];
      layerTracks.splice(last + 1, 0, track);
      return { ...s, layerTracks, selection: { kind: 'track', id } };
    });
    recordShowEdit();
    republishTracks();
    return id;
  },

  /** The row of a piece (made on the fly when it has nothing on it yet). */
  rowFor(layerId: string): ShowLayerTrack | null {
    return get(store).layerTracks.find((t) => t.layerId === layerId && !t.subRow) ?? null;
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
  updateLayerTrack(trackId: string, patch: Partial<Pick<ShowLayerTrack, 'gap' | 'muted' | 'locked' | 'collapsed' | 'color' | 'layerName' | 'foldChildren'>>) {
    let changed = false;
    store.update((s) => ({
      ...s,
      layerTracks: s.layerTracks.map((t) => {
        if (t.id !== trackId) return t;
        // Changed when any patched field reads differently (what comparing
        // the whole track as JSON answered, without stringifying it).
        const current = t as unknown as Record<string, unknown>;
        changed = (Object.keys(patch) as Array<keyof typeof patch>).some((key) => !sameJson(current[key], patch[key]));
        return { ...t, ...patch };
      }),
    }));
    if (!changed) return;
    // Folding a track (or a group's children) is how it is viewed, not an edit.
    const keys = Object.keys(patch);
    if (!keys.every((k) => k === 'collapsed' || k === 'foldChildren')) recordShowEdit();
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
    const track = get(store).layerTracks.find((t) => t.id === trackId);
    if (track) refreshTemplates([[track, layer]]);
  },

  /** Refresh every track whose layer is in `layers` (the project's live
   *  layers) at once. */
  refreshTrackTemplates(layers: readonly Layer[]) {
    const byId = new Map(layers.map((l) => [l.id, l]));
    const pairs: Array<[ShowLayerTrack, Layer]> = [];
    for (const track of get(store).layerTracks) {
      // A row with nothing on it never draws a copy of its piece.
      if (!track.template && !rowHasContent(track)) continue;
      const layer = byId.get(track.layerId);
      if (layer) pairs.push([track, layer]);
    }
    refreshTemplates(pairs);
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
    for (const key of ['rate', 'opacity', 'blendMode', 'label', 'color', 'loopStart', 'transitionIn', 'transitionDuration'] as const) {
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

  /**
   * The length of a video file clips were placed without (see
   * show/tracks/showClipLength.ts): every video clip whose media reads from
   * `uri` and has no length gets it. Measuring a file is not an edit: the
   * length goes into the step the clips are already in.
   */
  applyClipMediaLength(uri: string, seconds: number, uriOf: (media: ShowClipMedia) => string) {
    if (!(Number.isFinite(seconds) && seconds > 0)) return;
    let changed = false;
    const lengthen = (media: ShowClipMedia): ShowClipMedia => {
      if (media.kind !== 'video' || Number(media.sourceDuration) > 0 || uriOf(media) !== uri) return media;
      changed = true;
      return { ...media, sourceDuration: seconds };
    };
    const layerTracks = get(store).layerTracks.map((track) => {
      let touched = false;
      const clips = track.clips.map((clip) => {
        const media = lengthen(clip.media);
        if (media === clip.media) return clip;
        touched = true;
        return { ...clip, media };
      });
      return touched ? { ...track, clips } : track;
    });
    if (!changed) return;
    store.update((s) => ({ ...s, layerTracks }));
    if (!isRestoringHistory()) amendLastHistoryStep();
    republishTracks();
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

  /**
   * Swap a block's media for another (a library card clicked or dropped on
   * it), keeping its timing, fades, blend mode and opacity. The new media
   * plays from its start. One undo step.
   */
  replaceLayerClipMedia(clipId: string, media: ShowClipMedia): boolean {
    const found = this.findLayerClip(clipId);
    if (!found || found.track.locked) return false;
    this.updateLayerClip(clipId, { media, inPoint: 0, loopStart: undefined }, { discrete: true });
    return true;
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
    this._carryLines(found.track, [found.clip], delta);
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
    this._carryLines(track, track.clips.filter((x) => ids.has(x.id)), delta);
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
    // Only blocks really removed lose their lines (a locked row keeps both).
    const removed = new Set<string>();
    let changed = false;
    store.update((s) => withDuration({
      ...s,
      layerTracks: s.layerTracks.map((track) => {
        if (track.locked || !track.clips.some((c) => ids.has(c.id))) return track;
        changed = true;
        for (const c of track.clips) if (ids.has(c.id)) removed.add(c.id);
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
    store.update((s) => {
      const lines = removeLinesForBlocks(s.lines, removed);
      return lines === s.lines ? s : withDuration({ ...s, lines });
    });
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
    // Untouched lanes are the same objects, so only the edited lane is
    // compared (this runs on every pointer move of a key drag).
    if (lanes === track.lanes || sameJson(lanes, track.lanes)) return false;
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

  /** Replace the stage-camera lane. A drag passes `continuousKey` so its
   *  many updates make one undo step. */
  setCameraLane(clips: ShowCameraClip[], continuousKey?: string) {
    const cameraLane = clips.map(normalizeCameraClip).filter((c): c is ShowCameraClip => c !== null).sort((a, b) => a.startTime - b.startTime);
    store.update((s) => withDuration({ ...s, cameraLane }));
    recordShowEdit(continuousKey ? `camera:${continuousKey}` : undefined);
  },

  // ── Looks row (Timeline) ───────────────────────────────────────────────
  //
  // Blocks may overlap: the overlap is a crossfade (see showLooks.ts).

  findLookClip(clipId: string): ShowLookClip | null {
    return get(store).lookClips.find((c) => c.id === clipId) ?? null;
  },

  /** A Look dropped on the Looks row at `startTime` (snapped). Returns its id. */
  addLookClip(lookId: string, paletteId: string, startTime: number, opts: { duration?: number; scope?: ShowLookClip['scope']; layerIds?: string[] } = {}): string | null {
    const id = generateUUID();
    const at = Math.max(0, snapShowTime(startTime, this._snapEdges(new Set()), this._snapOptions()));
    const clip = normalizeLookClip({
      id,
      lookId,
      paletteId,
      startTime: at,
      duration: opts.duration ?? SHOW_DEFAULT_LOOK_SECONDS,
      scope: opts.scope ?? 'all',
      layerIds: opts.layerIds,
      fadeIn: 0,
      fadeOut: 0,
    });
    if (!clip) return null;
    this._setLookClips([...get(store).lookClips, clip]);
    store.update((s) => ({ ...s, selection: { kind: 'lookClip', id }, selectedClipIds: [] }));
    recordShowEdit();
    return id;
  },

  /** Change a look block's look, colours, scope or fades. */
  updateLookClip(clipId: string, patch: Partial<Omit<ShowLookClip, 'id'>>, opts: { discrete?: boolean } = {}) {
    const found = this.findLookClip(clipId);
    if (!found) return;
    const next = normalizeLookClip({ ...found, ...patch, id: clipId });
    if (!next) return;
    this._setLookClips(get(store).lookClips.map((c) => (c.id === clipId ? next : c)));
    recordShowEdit(opts.discrete ? undefined : `look-clip:${clipId}`);
  },

  /** Drag a look block to a new start (snapped by either edge). */
  moveLookClip(clipId: string, startTime: number) {
    const found = this.findLookClip(clipId);
    if (!found) return;
    const edges = this._snapEdges(new Set([clipId]));
    const opts = this._snapOptions();
    const byStart = snapShowTime(startTime, edges, opts);
    const byEnd = snapShowTime(startTime + found.duration, edges, opts) - found.duration;
    const pull = (v: number) => (Math.abs(v - startTime) < 1e-9 ? Number.POSITIVE_INFINITY : Math.abs(v - startTime));
    const at = Math.max(0, pull(byEnd) < pull(byStart) ? byEnd : byStart);
    if (Math.abs(at - found.startTime) < 1e-9) return;
    store.update((s) => {
      const lines = shiftLinesOnTarget(s.lines, { scope: 'look', id: clipId }, at - found.startTime);
      return lines === s.lines ? s : { ...s, lines };
    });
    this._setLookClips(get(store).lookClips.map((c) => (c.id === clipId ? { ...c, startTime: at } : c)));
    recordShowEdit(`look-clip:${clipId}`);
  },

  /** Drag a look block's edge. */
  resizeLookClip(clipId: string, edge: 'start' | 'end', time: number) {
    const found = this.findLookClip(clipId);
    if (!found) return;
    const t = snapShowTime(time, this._snapEdges(new Set([clipId])), this._snapOptions());
    const end = found.startTime + found.duration;
    let next: ShowLookClip;
    if (edge === 'start') {
      const start = Math.max(0, Math.min(t, end - SHOW_MIN_TRACK_CLIP_SECONDS));
      next = { ...found, startTime: start, duration: end - start };
    } else {
      next = { ...found, duration: Math.max(SHOW_MIN_TRACK_CLIP_SECONDS, t - found.startTime) };
    }
    next.fadeIn = Math.min(next.fadeIn, next.duration);
    next.fadeOut = Math.min(next.fadeOut, next.duration);
    this._setLookClips(get(store).lookClips.map((c) => (c.id === clipId ? next : c)));
    recordShowEdit(`look-clip:${clipId}`);
  },

  removeLookClip(clipId: string) {
    const s = get(store);
    if (!s.lookClips.some((c) => c.id === clipId)) return;
    store.update((x) => {
      const lines = removeLinesForBlocks(x.lines, [clipId]);
      return lines === x.lines ? x : { ...x, lines };
    });
    this._setLookClips(s.lookClips.filter((c) => c.id !== clipId));
    if (s.selection?.kind === 'lookClip' && s.selection.id === clipId) store.update((x) => ({ ...x, selection: null }));
    recordShowEdit();
  },

  _setLookClips(clips: ShowLookClip[]) {
    const lookClips = [...clips].sort((a, b) => a.startTime - b.startTime);
    store.update((s) => withDuration({ ...s, lookClips }));
    republishTracks();
  },

  // ── LED rows (Timeline) ────────────────────────────────────────────────
  //
  // One row per WLED controller and per named range (row id = its spot id).
  // Blocks on a row may overlap: the later one draws over the earlier.

  findLedClip(clipId: string): TimelineLedClip | null {
    return get(store).ledClips.find((c) => c.id === clipId) ?? null;
  },

  /** A block on an LED row at `startTime` (snapped). Returns its id. */
  addLedClip(rowId: string, startTime: number, fields: Partial<Omit<TimelineLedClip, 'id' | 'rowId' | 'startTime'>> = {}): string | null {
    const id = generateUUID();
    const at = Math.max(0, snapShowTime(startTime, this._snapEdges(new Set()), this._snapOptions()));
    const clip = normalizeLedClip({ ...fields, id, rowId, startTime: at });
    if (!clip) return null;
    this._setLedClips([...get(store).ledClips, clip]);
    store.update((s) => ({ ...s, selection: { kind: 'ledClip', id }, selectedClipIds: [] }));
    recordShowEdit();
    return id;
  },

  /** Change an LED block's kind, colours, pattern, fades or where line. */
  updateLedClip(clipId: string, patch: Partial<Omit<TimelineLedClip, 'id'>>, opts: { discrete?: boolean } = {}) {
    const found = this.findLedClip(clipId);
    if (!found) return;
    const next = normalizeLedClip({ ...found, ...patch, id: clipId });
    if (!next) return;
    this._setLedClips(get(store).ledClips.map((c) => (c.id === clipId ? next : c)));
    recordShowEdit(opts.discrete ? undefined : `led-clip:${clipId}`);
  },

  /** Drag an LED block to a new start (snapped by either edge), and to another LED row. */
  moveLedClip(clipId: string, startTime: number, rowId?: string) {
    const found = this.findLedClip(clipId);
    if (!found) return;
    const edges = this._snapEdges(new Set([clipId]));
    const opts = this._snapOptions();
    const byStart = snapShowTime(startTime, edges, opts);
    const byEnd = snapShowTime(startTime + found.duration, edges, opts) - found.duration;
    const pull = (v: number) => (Math.abs(v - startTime) < 1e-9 ? Number.POSITIVE_INFINITY : Math.abs(v - startTime));
    const at = Math.max(0, pull(byEnd) < pull(byStart) ? byEnd : byStart);
    const row = rowId && rowId.startsWith('led:') ? rowId : found.rowId;
    if (Math.abs(at - found.startTime) < 1e-9 && row === found.rowId) return;
    store.update((s) => {
      const lines = shiftLinesOnTarget(s.lines, { scope: 'block', id: clipId }, at - found.startTime);
      return lines === s.lines ? s : { ...s, lines };
    });
    this._setLedClips(get(store).ledClips.map((c) => (c.id === clipId ? { ...c, startTime: at, rowId: row } : c)));
    recordShowEdit(`led-clip:${clipId}`);
  },

  /** Drag an LED block's edge. */
  resizeLedClip(clipId: string, edge: 'start' | 'end', time: number) {
    const found = this.findLedClip(clipId);
    if (!found) return;
    const t = snapShowTime(time, this._snapEdges(new Set([clipId])), this._snapOptions());
    const end = found.startTime + found.duration;
    let next: TimelineLedClip;
    if (edge === 'start') {
      const start = Math.max(0, Math.min(t, end - SHOW_MIN_TRACK_CLIP_SECONDS));
      next = { ...found, startTime: start, duration: end - start };
    } else {
      next = { ...found, duration: Math.max(SHOW_MIN_TRACK_CLIP_SECONDS, t - found.startTime) };
    }
    next.fadeIn = Math.min(next.fadeIn, next.duration);
    next.fadeOut = Math.min(next.fadeOut, next.duration);
    this._setLedClips(get(store).ledClips.map((c) => (c.id === clipId ? next : c)));
    recordShowEdit(`led-clip:${clipId}`);
  },

  removeLedClip(clipId: string) {
    const s = get(store);
    if (!s.ledClips.some((c) => c.id === clipId)) return;
    store.update((x) => {
      const lines = removeLinesForBlocks(x.lines, [clipId]);
      return lines === x.lines ? x : { ...x, lines };
    });
    this._setLedClips(s.ledClips.filter((c) => c.id !== clipId));
    if (s.selection?.kind === 'ledClip' && s.selection.id === clipId) store.update((x) => ({ ...x, selection: null }));
    recordShowEdit();
  },

  _setLedClips(clips: TimelineLedClip[]) {
    const ledClips = [...clips].sort((a, b) => a.startTime - b.startTime || (a.id < b.id ? -1 : 1));
    store.update((s) => withDuration({ ...s, ledClips }));
    republishTracks();
  },

  // ── Screen FX and Effects rows (Timeline, Stage group) ─────────────────
  //
  // Blocks carry their own copy of a stage effect (Screen FX) or a
  // composition effect (Effects). Overlapping blocks of a row crossfade.

  findStageClip(clipId: string): TimelineStageClip | null {
    return get(store).stageClips.find((c) => c.id === clipId) ?? null;
  },

  /** A block on the Screen FX or Effects row at `startTime` (snapped). Returns its id. */
  addStageClip(row: StageClipRow, startTime: number, fields: Partial<Omit<TimelineStageClip, 'id' | 'row' | 'startTime'>> = {}): string | null {
    const id = generateUUID();
    const at = Math.max(0, snapShowTime(startTime, this._snapEdges(new Set()), this._snapOptions()));
    const clip = normalizeStageClip({ ...fields, id, row, startTime: at });
    if (!clip) return null;
    this._setStageClips([...get(store).stageClips, clip]);
    store.update((s) => ({ ...s, selection: { kind: 'stageClip', id }, selectedClipIds: [] }));
    recordShowEdit();
    return id;
  },

  /** Change a Stage block's effect, settings, fades, timing or where line. */
  updateStageClip(clipId: string, patch: Partial<Omit<TimelineStageClip, 'id' | 'row'>>, opts: { discrete?: boolean } = {}) {
    const found = this.findStageClip(clipId);
    if (!found) return;
    const next = normalizeStageClip({ ...found, ...patch, id: clipId, row: found.row });
    if (!next) return;
    if (next.startTime !== found.startTime) {
      const delta = next.startTime - found.startTime;
      store.update((s) => {
        const lines = shiftLinesOnTarget(s.lines, { scope: 'block', id: clipId }, delta);
        return lines === s.lines ? s : { ...s, lines };
      });
    }
    this._setStageClips(get(store).stageClips.map((c) => (c.id === clipId ? next : c)));
    recordShowEdit(opts.discrete ? undefined : `stage-clip:${clipId}`);
  },

  /** Drag a Stage block to a new start (snapped by either edge). Its lines move with it. */
  moveStageClip(clipId: string, startTime: number) {
    const found = this.findStageClip(clipId);
    if (!found) return;
    const edges = this._snapEdges(new Set([clipId]));
    const opts = this._snapOptions();
    const byStart = snapShowTime(startTime, edges, opts);
    const byEnd = snapShowTime(startTime + found.duration, edges, opts) - found.duration;
    const pull = (v: number) => (Math.abs(v - startTime) < 1e-9 ? Number.POSITIVE_INFINITY : Math.abs(v - startTime));
    const at = Math.max(0, pull(byEnd) < pull(byStart) ? byEnd : byStart);
    if (Math.abs(at - found.startTime) < 1e-9) return;
    store.update((s) => {
      const lines = shiftLinesOnTarget(s.lines, { scope: 'block', id: clipId }, at - found.startTime);
      return lines === s.lines ? s : { ...s, lines };
    });
    this._setStageClips(get(store).stageClips.map((c) => (c.id === clipId ? { ...c, startTime: at } : c)));
    recordShowEdit(`stage-clip:${clipId}`);
  },

  /** Drag a Stage block's edge. */
  resizeStageClip(clipId: string, edge: 'start' | 'end', time: number) {
    const found = this.findStageClip(clipId);
    if (!found) return;
    const t = snapShowTime(time, this._snapEdges(new Set([clipId])), this._snapOptions());
    const end = found.startTime + found.duration;
    let next: TimelineStageClip;
    if (edge === 'start') {
      const start = Math.max(0, Math.min(t, end - SHOW_MIN_TRACK_CLIP_SECONDS));
      next = { ...found, startTime: start, duration: end - start };
    } else {
      next = { ...found, duration: Math.max(SHOW_MIN_TRACK_CLIP_SECONDS, t - found.startTime) };
    }
    next.fadeIn = Math.min(next.fadeIn, next.duration);
    next.fadeOut = Math.min(next.fadeOut, next.duration);
    this._setStageClips(get(store).stageClips.map((c) => (c.id === clipId ? next : c)));
    recordShowEdit(`stage-clip:${clipId}`);
  },

  removeStageClip(clipId: string) {
    const s = get(store);
    if (!s.stageClips.some((c) => c.id === clipId)) return;
    store.update((x) => {
      const lines = removeLinesForBlocks(x.lines, [clipId]);
      return lines === x.lines ? x : { ...x, lines };
    });
    this._setStageClips(s.stageClips.filter((c) => c.id !== clipId));
    if (s.selection?.kind === 'stageClip' && s.selection.id === clipId) store.update((x) => ({ ...x, selection: null }));
    recordShowEdit();
  },

  _setStageClips(clips: TimelineStageClip[]) {
    const stageClips = [...clips].sort((a, b) => a.startTime - b.startTime || (a.id < b.id ? -1 : 1));
    store.update((s) => withDuration({ ...s, stageClips }));
    republishTracks();
  },

  /** The Timeline's named where orders (one undo step). */
  setWhereOrders(orders: WhereNamedOrder[]) {
    const whereOrders = normalizeNamedOrders(orders);
    store.update((s) => ({ ...s, whereOrders }));
    republishTracks();
    recordShowEdit();
  },

  // ── Control lines ──────────────────────────────────────────────────────

  /**
   * Replace the document's lines. One undo step; a drag passes
   * `continuousKey` so its many updates make one. `quiet`: not an edit
   * (fitting ranges to the registry), no undo step.
   */
  setLines(lines: ControlLine[], opts: { continuousKey?: string; quiet?: boolean } = {}) {
    const s = get(store);
    if (lines === s.lines) return;
    store.update((x) => withDuration({ ...x, lines }));
    if (!opts.quiet) recordShowEdit(opts.continuousKey ? `lines:${opts.continuousKey}` : undefined);
  },

  // ── Sections (Timeline) ───────────────────────────────────────────────

  /** Replace the sections (sorted, overlaps trimmed). One undo step; a drag
   *  passes `continuousKey` so its many updates make one. */
  setSections(sections: TimelineSection[], opts: { continuousKey?: string; quiet?: boolean } = {}) {
    const next = tidySections(sections);
    store.update((x) => withDuration({
      ...x,
      sections: next,
      selection: x.selection?.kind === 'section' && !next.some((n) => n.id === x.selection!.id) ? null : x.selection,
    }));
    publishSectionStatus();
    if (!opts.quiet) recordShowEdit(opts.continuousKey ? `sections:${opts.continuousKey}` : undefined);
  },

  addSection(section: TimelineSection): string {
    this.setSections([...get(store).sections, section]);
    store.update((x) => ({ ...x, selection: { kind: 'section', id: section.id } }));
    return section.id;
  },

  updateSection(id: string, patch: Partial<Omit<TimelineSection, 'id'>>, opts: { continuousKey?: string } = {}) {
    const s = get(store);
    if (!s.sections.some((x) => x.id === id)) return;
    this.setSections(s.sections.map((x) => (x.id === id ? { ...x, ...patch } : x)), opts);
  },

  removeSection(id: string) {
    const s = get(store);
    if (!s.sections.some((x) => x.id === id)) return;
    if (sectionPlayer.hold?.sectionId === id || sectionPlayer.live === id) forgetSections();
    this.setSections(s.sections.filter((x) => x.id !== id));
  },

  /**
   * GO. On the Timeline with sections: a hold lets go, a vamp leaves at the
   * end of its pass (or the next bar), a hold or Live section ahead plays
   * on; stopped, it plays. Returns what it did ('none' when nothing waits).
   */
  go(): GoResult {
    const s = get(store);
    if (!sectionsRun(s)) {
      if (!s.isPlaying) {
        this.play();
        return { kind: 'play' };
      }
      return { kind: 'none' };
    }
    const result = goSections(sectionPlayer, s.sections, s.tempo, s.currentTime, s.isPlaying, sectionClock());
    if (result.kind === 'resume') {
      runSectionEvents(result.events);
      transportClock.reset();
      if (!s.isPlaying) this.play();
      // Re-evaluate: free-running blocks take the time they ran while held.
      republishTracks();
    } else if (result.kind === 'play') {
      this.play();
    } else {
      publishSectionStatus();
    }
    return result;
  },

  /**
   * Several parts of the Timeline replaced at once, as one undo step (Score
   * the song lays down sections, looks, lines and LED blocks together).
   */
  replaceTimelineParts(parts: Partial<Pick<ShowTimelineState, 'sections' | 'lookClips' | 'lines' | 'ledClips' | 'stageClips' | 'tempo'>>) {
    store.update((x) => withDuration({
      ...x,
      ...(parts.tempo !== undefined && !x.tempo && parts.tempo
        ? { tempo: normalizeTempoMap(parts.tempo), snapGrid: x.snapGrid === 'seconds' ? 'bar' as const : x.snapGrid, rulerMode: 'bars' as const }
        : {}),
      ...(parts.sections ? { sections: tidySections(parts.sections) } : {}),
      ...(parts.lookClips ? { lookClips: [...parts.lookClips].sort((a, b) => a.startTime - b.startTime) } : {}),
      ...(parts.lines ? { lines: parts.lines } : {}),
      ...(parts.ledClips ? { ledClips: normalizeLedClips(parts.ledClips) } : {}),
      ...(parts.stageClips ? { stageClips: normalizeStageClips(parts.stageClips) } : {}),
    }));
    republishTracks();
    publishSectionStatus();
    recordShowEdit();
  },

  /** The section state, for tests and the debug surface. */
  sectionState(): Readonly<SectionPlayerState> {
    return sectionPlayer;
  },

  // ── Phrases (Timeline) ────────────────────────────────────────────────

  /**
   * Launch a phrase: section `id` plays from its start `delay` seconds from
   * now (the caller's launch grid: the next bar; 0 = at once). Playing, the
   * Timeline hands over on that bar; stopped, it starts there. Opens the
   * Timeline document if the Show is active. Returns false (and does
   * nothing) when the section is gone or an outside clock owns the playhead.
   */
  launchPhrase(id: string, opts: { delay?: number; origin?: PhraseOrigin } = {}): boolean {
    if (externalClock || isManualClock()) return false;
    if (get(store).doc !== 'timeline') this.activateDoc('timeline', { quiet: true });
    const s = get(store);
    const target = s.sections.find((x) => x.id === id);
    if (!target) return false;
    const delay = Math.max(0, Number.isFinite(opts.delay) ? opts.delay! : 0);
    const origin = opts.origin ?? {};
    clearPhrasePending(false);
    const nowMs = phraseNowMs();
    if (s.isPlaying) {
      phrase.pending = { id, due: phrase.elapsed + delay, origin };
      emitPhrase({ type: 'pending', id, at: nowMs + delay * 1000, immediate: delay <= 0, origin });
      publishPhraseStatus();
      if (delay <= 0) {
        const t = get(store).currentTime;
        landPhrase(0, t, null);
        ticker.request();
      }
      return true;
    }
    const dueMs = nowMs + delay * 1000;
    phrase.pending = { id, dueMs, origin };
    emitPhrase({ type: 'pending', id, at: dueMs, immediate: delay <= 0, origin });
    publishPhraseStatus();
    const start = () => {
      const p = phrase.pending;
      if (!p || p.id !== id || p.dueMs !== dueMs) return;
      phrase.pending = null;
      const sec = get(store).sections.find((x) => x.id === id);
      if (!sec) { publishPhraseStatus(); emitPhrase({ type: 'cancel' }); return; }
      const over = Math.max(0, (phraseNowMs() - dueMs) / 1000);
      const from = phrase.activeId;
      const time = Math.min(sec.end - 1e-4, sec.start + over);
      forgetSections();
      phrase.activeId = id;
      phrase.xfade = null;
      emitPhrase({ type: 'land', id, time, from, origin });
      applyTime(time, true);
      transportClock.reset();
      this.play();
      publishPhraseStatus();
    };
    if (delay <= 0) start();
    else phrase.pending.timer = phraseTimer(start, delay * 1000);
    return true;
  },

  /** Stop the phrases on the bar (`delay` seconds from now): the Timeline
   *  pauses there. Stopped, it forgets the playing phrase at once. */
  stopPhrases(opts: { delay?: number } = {}): void {
    const s = get(store);
    const delay = Math.max(0, Number.isFinite(opts.delay) ? opts.delay! : 0);
    if (!s.isPlaying || s.doc !== 'timeline' || delay <= 0) {
      const from = phrase.activeId;
      const stopped = forgetPhrases();
      if (s.isPlaying && s.doc === 'timeline') this.pause();
      if (!stopped) emitPhrase({ type: 'stop', from });
      publishPhraseStatus();
      return;
    }
    clearPhrasePending(false);
    phrase.pending = { id: null, due: phrase.elapsed + delay, origin: {} };
    emitPhrase({ type: 'pending', id: null, at: phraseNowMs() + delay * 1000, immediate: false, origin: {} });
    publishPhraseStatus();
  },

  /** Call off the launch waiting for its bar. */
  cancelPhraseLaunch(): boolean {
    if (!phrase.pending) return false;
    clearPhrasePending();
    publishPhraseStatus();
    return true;
  },

  /** Wall time (ms) the waiting launch lands at, or null. */
  phrasePendingAt(): number | null {
    const p = phrase.pending;
    if (!p) return null;
    return p.dueMs ?? phraseNowMs() + Math.max(0, (p.due ?? 0) - phrase.elapsed) * 1000;
  },

  /** The phrase state, for tests and the debug surface. */
  phraseState(): Readonly<{ activeId: string | null; pending: { id: string | null } | null; elapsed: number; crossfading: boolean }> {
    return { activeId: phrase.activeId, pending: phrase.pending ? { id: phrase.pending.id } : null, elapsed: phrase.elapsed, crossfading: phrase.xfade !== null };
  },

  /** Test seam: the wall clock and timer phrase launches from stopped use. */
  _setPhraseClock(now: () => number, timer?: (fn: () => void, ms: number) => unknown, clear?: (handle: unknown) => void) {
    phraseNowMs = now;
    if (timer) phraseTimer = timer;
    if (clear) phraseClearTimer = clear;
  },

  // ── Sound rows (Timeline) ─────────────────────────────────────────────

  /** Replace the sound doc (rows, Live clip and build blocks). */
  setSound(sound: SoundDoc, opts: { continuousKey?: string; quiet?: boolean } = {}) {
    if (sound === get(store).sound) return;
    store.update((x) => withDuration({ ...x, sound }));
    if (!opts.quiet) recordShowEdit(opts.continuousKey ? `sound:${opts.continuousKey}` : undefined);
  },

  /**
   * Replace the audio blocks and the sound doc in one step (a sound row's
   * blocks moved, trimmed, faded, a row removed). Elements follow.
   */
  setSoundBlocks(audioTracks: ShowAudioTrack[], sound: SoundDoc = get(store).sound, opts: { continuousKey?: string; quiet?: boolean } = {}) {
    const s = get(store);
    if (audioTracks === s.audioTracks && sound === s.sound) return;
    const lanesBefore = new Map(s.audioTracks.map((t) => [t.id, t.lane]));
    store.update((x) => withDuration({
      ...x,
      audioTracks,
      sound,
      selection: x.selection && x.selection.kind === 'audio' && !audioTracks.some((t) => t.id === x.selection!.id) ? null : x.selection,
    }));
    syncAudioWiring(audioTracks);
    for (const t of audioTracks) if (lanesBefore.has(t.id) && lanesBefore.get(t.id) !== t.lane) rewireShowAudioTrack(t.id);
    republishTracks();
    if (!opts.quiet) recordShowEdit(opts.continuousKey ? `sound:${opts.continuousKey}` : undefined);
  },

  /** Edit the lines: `edit` returns the new list (or the same to do nothing). */
  editLines(edit: (lines: ControlLine[]) => ControlLine[], continuousKey?: string): boolean {
    const s = get(store);
    const next = edit(s.lines);
    if (next === s.lines) return false;
    this.setLines(next, { continuousKey });
    return true;
  },

  /** Controllers bound to lines. Not an edit of the show (no undo step). */
  setLineBindings(bindings: LineBinding[]) {
    store.update((x) => (x.lineBindings === bindings ? x : { ...x, lineBindings: bindings }));
  },

  /** A block moved by `delta`: its lines and the row's points under it go along. */
  _carryLines(track: ShowLayerTrack, clips: readonly ShowLayerClip[], delta: number) {
    if (!clips.length || Math.abs(delta) < 1e-9) return;
    store.update((s) => {
      let lines = s.lines;
      for (const c of clips) {
        lines = shiftLinesWithBlock(lines, { clipId: c.id, rowTarget: rowLineTarget(track), from: c.startTime, to: clipEnd(c), delta });
      }
      return lines === s.lines ? s : withDuration({ ...s, lines });
    });
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
    for (const t of s.audioTracks) if (!exclude.has(t.id)) edges.push(t.startTime, t.startTime + t.duration);
    for (const b of s.sound.live) if (!exclude.has(b.id)) edges.push(b.startTime, b.startTime + b.duration);
    for (const b of s.sound.builds) if (!exclude.has(b.id)) edges.push(b.startTime, b.startTime + b.duration);
    for (const c of s.lookClips) if (!exclude.has(c.id)) edges.push(c.startTime, c.startTime + c.duration);
    for (const c of s.ledClips) if (!exclude.has(c.id)) edges.push(c.startTime, c.startTime + c.duration);
    for (const c of s.stageClips) if (!exclude.has(c.id)) edges.push(c.startTime, c.startTime + c.duration);
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
    forgetSections();
    forgetPhrases();
    releaseAllTrackElements();
    publishTransition(null);
    transportClock.reset();
    // A new show: no video may carry on from where the old one left it.
    seekGeneration++;
    store.update((s) => ({
      ...createInitialState(),
      doc: s.doc,
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

  /** The active document has something on it. */
  hasContent(): boolean {
    return docHasContent(get(store));
  },

  /** Either document has something on it. */
  anyContent(): boolean {
    return docHasContent(get(store)) || docHasContent(parkedDoc);
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
    const active = arrangementOf(s);
    const parked = arrangementOf(parkedDoc);
    return s.doc === 'show' ? { ...active, timeline: parked } : { ...parked, timeline: active };
  },

  /**
   * Put an arrangement from an undo step back. The transport keeps going
   * from where it is, and the show is re-evaluated there, so a preset clip
   * that undo moved under the playhead takes over at once. A step carries
   * both documents; the one that is not active is put back quietly.
   */
  restoreArrangement(raw: unknown): void {
    if (!raw || typeof raw !== 'object') return;
    const a = raw as Partial<ShowArrangement>;
    let activePart: Partial<ShowArrangement> = a;
    if (a.timeline && typeof a.timeline === 'object') {
      const { timeline, ...showPart } = a;
      const doc = get(store).doc;
      activePart = doc === 'show' ? showPart : timeline;
      setParked(docWithArrangement(parkedDoc, doc === 'show' ? timeline : showPart));
    }
    store.update((s) => withDuration({ ...s, ...docWithArrangement(docFieldsOf(s), activePart) }));
    syncAudioWiring(get(store).audioTracks);
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

  // ── Two documents ──────────────────────────────────────────────────────

  /** The document in the engine. */
  activeDoc(): ShowDocKind {
    return get(store).doc;
  },

  /**
   * Make `doc` the active document (its tab was opened). The other one is
   * parked as it is, playhead included. If it was playing it stops first,
   * and a toast says so: only one plays at a time. Nothing is fired on the
   * way in (a preset loads when the show plays or the playhead moves), so
   * opening a tab never changes the stage by itself, except that a
   * Timeline's rows and looks show at its playhead, as they would paused.
   * Returns false when `doc` was already active.
   */
  activateDoc(doc: ShowDocKind, opts: { quiet?: boolean } = {}): boolean {
    const s = get(store);
    if (s.doc === doc) return false;
    const wasPlaying = s.isPlaying;
    if (wasPlaying && !externalClock) this.pause();
    else if (wasPlaying) {
      // Following a clock: the outgoing document still sees itself stop
      // (open recording passes end in it, its Live clips stop) before the
      // swap; the clock starts the incoming one.
      store.update((x) => ({ ...x, isPlaying: false }));
      seekGeneration++;
      republishTracks();
    }
    cancelRaf();
    forgetSections();
    forgetPhrases();
    const outgoing = docFieldsOf(get(store));
    const incoming = parkedDoc;
    setParked({ ...outgoing, selection: null, selectedClipIds: [] });
    releaseAllTrackElements();
    publishTransition(null);
    seekGeneration++;
    transportClock.reset();
    activeTracksMemo = null;
    store.update((x) => withDuration({ ...x, ...incoming, doc, isPlaying: false, activeClipId: null }));
    syncAudioWiring(get(store).audioTracks);
    notifyDocChange(doc);
    republishTracks();
    // Waveforms the parked document had not measured yet.
    for (const t of get(store).audioTracks) {
      if (!t.peaks?.length && t.url) void this.analyzeAudioTrack(t.id);
    }
    if (externalClock) {
      if (!opts.quiet) showToast(`Following now drives the ${SHOW_DOC_NAMES[doc]}.`, 'info');
    } else if (wasPlaying && !opts.quiet) {
      showToast(`${SHOW_DOC_NAMES[s.doc]} stopped: only one plays at a time, and the ${SHOW_DOC_NAMES[doc]} is active now.`, 'info');
    }
    return true;
  },

  /** Open a document's tray (making it the active document). */
  openDoc(doc: ShowDocKind) {
    this.activateDoc(doc);
    store.update((s) => (s.isOpen ? s : { ...s, isOpen: true }));
  },

  /** The bottom-bar pill: open that document's tray, or close it if it is
   *  the one showing. */
  toggleDoc(doc: ShowDocKind) {
    const s = get(store);
    if (s.isOpen && s.doc === doc) this.setOpen(false);
    else this.openDoc(doc);
  },

  // ── Persistence ────────────────────────────────────────────────────────

  /**
   * Durable state only. Runtime audio URLs are blanked whenever the
   * AssetRef can rebuild them on load — same contract as
   * projectionSimScene.exportForProject(). `isPlaying` / `currentTime` /
   * `activeClipId` are session state and never travel.
   */
  serialize(): ShowTimelineSnapshot {
    // A save carries each track's copy of its layer as the layer is now,
    // not as the last refresh left it.
    if (templateLayerSource && get(store).layerTracks.length) {
      try { this.refreshTrackTemplates(templateLayerSource()); } catch (err) {
        console.warn('[ShowTimeline] template refresh before save failed:', err);
      }
    }
    const s = get(store);
    const active = docSnapshot(s);
    const parked = docSnapshot(parkedDoc);
    const [show, timeline] = s.doc === 'show' ? [active, parked] : [parked, active];
    return {
      // 3: rows come from the mapping layers; empty rows are not saved,
      // blocks have their own blend mode, layers can be added on a piece.
      // 4: the Show and the Timeline are two documents; the Show's fields
      // stay at the top (an older build opens the Show), the Timeline's
      // are under `timeline`, and the Looks row is new.
      // 5: the Timeline has control lines (the ◆ lanes became lines).
      // 6: the Timeline has LED rows and where lines (blocks carry `where`).
      // 7: sound rows. 8: sections. 9: Screen FX and Effects rows.
      version: 9,
      isOpen: s.isOpen,
      ...show,
      activeDoc: s.doc,
      timeline: { version: 9, isOpen: false, ...timeline },
    };
  },

  /**
   * Project-open restore. Rebuilds every audio URL from its AssetRef
   * (project-dir aware, so a .gha handed to another machine still finds its
   * siblings) and reports anything that could not be found through the
   * standard missing-asset repair flow. Never auto-plays.
   *
   * A file from before the two documents (no `timeline`) is split: presets
   * go to the Show, rows with blocks and their lanes to the Timeline, the
   * music, tempo and camera lane to whichever has content (both, if both
   * do). The Show is active unless only the Timeline has anything.
   */
  hydrate(payload: unknown, projectDir?: string): void {
    cancelRaf();
    forgetSections();
    forgetPhrases();
    releaseAllTrackElements();
    publishTransition(null);
    // Another show (or the same one reopened): its videos start from their
    // own anchors, never from where the last show left a decoder.
    seekGeneration++;
    notifyReset();
    activeTracksMemo = null;

    if (!payload || typeof payload !== 'object') {
      setParked(emptyDocFields());
      store.set(createInitialState());
      notifyDocChange('show');
      republishTracks();
      return;
    }
    const p = payload as Record<string, unknown>;
    let showDoc: ShowDocFields;
    let timelineDoc: ShowDocFields;
    let active: ShowDocKind;
    if (p.timeline && typeof p.timeline === 'object') {
      showDoc = hydrateDoc(p, projectDir);
      timelineDoc = hydrateDoc(p.timeline as Record<string, unknown>, projectDir);
      active = p.activeDoc === 'timeline' ? 'timeline' : 'show';
    } else {
      const whole = hydrateDoc(p, projectDir);
      const empty = emptyDocFields();
      const hasPresets = whole.presetClips.length > 0;
      const hasRows = whole.layerTracks.some((t) => !isBareRow(t));
      const shared = {
        audioTracks: whole.audioTracks,
        tempo: whole.tempo,
        loop: whole.loop,
        endAction: whole.endAction,
        rulerMode: whole.rulerMode,
        snapGrid: whole.snapGrid,
        zoom: whole.zoom,
        snapEnabled: whole.snapEnabled,
        cameraLane: whole.cameraLane,
      };
      // Nothing but music (or nothing at all): it was a Show.
      const toShow = hasPresets || !hasRows;
      showDoc = toShow ? { ...empty, ...shared, presetClips: whole.presetClips } : { ...empty, zoom: whole.zoom, snapEnabled: whole.snapEnabled };
      timelineDoc = hasRows
        ? { ...empty, ...shared, layerTracks: whole.layerTracks, lookClips: whole.lookClips, lines: whole.lines, lineBindings: whole.lineBindings }
        : { ...empty, zoom: whole.zoom, snapEnabled: whole.snapEnabled };
      if (hasRows && hasPresets) {
        // Both carry the song: give the Timeline's copy its own track ids,
        // so the two never share an audio element.
        timelineDoc.audioTracks = timelineDoc.audioTracks.map((t) => ({ ...t, id: generateUUID() }));
        timelineDoc.cameraLane = timelineDoc.cameraLane.map((c) => ({ ...c, id: generateUUID() }));
      }
      active = toShow ? 'show' : 'timeline';
    }
    const [activeDoc, parked] = active === 'show' ? [showDoc, timelineDoc] : [timelineDoc, showDoc];
    setParked(parked);
    store.set(withDuration({
      ...createInitialState(),
      ...activeDoc,
      doc: active,
      isOpen: p.isOpen === true,
    }));
    transportClock.reset();
    notifyDocChange(active);
    republishTracks();

    syncAudioWiring(activeDoc.audioTracks);
    // Waveforms for tracks whose peaks did not travel (older saves). The
    // parked document's are measured when its tab is opened.
    for (const t of activeDoc.audioTracks) {
      if (!t.peaks?.length && t.url) void this.analyzeAudioTrack(t.id);
    }
  },

  /** Test seam — tears the transport and audio elements down completely. */
  _resetForTest() {
    externalClock = false;
    chaseRate = 1;
    lastParkedChase = null;
    transportClock.reset();
    audioClockReader = defaultAudioClockReader;
    transportSink = null;
    cancelRaf();
    releaseAllTrackElements();
    publishTransition(null);
    lastPublishedTransition = null;
    seekGeneration = 0;
    lastLoopWrap = null;
    templateLayerSource = null;
    trackFrameSink = null;
    lastTrackFrame = null;
    lastTrackFrameSignature = null;
    activeTracksMemo = null;
    tracksAwaitingFirstStep.clear();
    Object.assign(sectionPlayer, createSectionPlayerState());
    sectionEffects = null;
    clearPhrasePending(false);
    Object.assign(phrase, { activeId: null, pending: null, elapsed: 0, xfade: null });
    phraseEffects = null;
    phraseLastFrameMs = null;
    phraseNowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
    phraseTimer = (fn, ms) => setTimeout(fn, Math.max(0, ms));
    phraseClearTimer = (h) => clearTimeout(h as ReturnType<typeof setTimeout>);
    publishPhraseStatus();
    sectionClock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
    publishSectionStatus();
    setParked(emptyDocFields());
    store.set(createInitialState());
  },

  /** Test seam: the clock holds are counted on (seconds). */
  _setSectionClock(clock: () => number) {
    sectionClock = clock;
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
