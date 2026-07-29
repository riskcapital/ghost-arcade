// VJ Clip Launcher Store
// Manages the clip grid state for the VJ clip launcher workflow
// Works with shaders and videos directly (not compositions)

import { writable, derived, get } from 'svelte/store';
import type { BlendMode, Layer, MediaSource, Effect, JSAnimationSource, IntegratedEffectSource, SplatContent, Model3DContent, GPULayerContent, TextContent, ISFInputDef } from '../types';
import { createDefaultSplatContent, createDefaultModel3DContent, createDefaultGPULayerContent, createDefaultTextContent } from '../types';
import { createThreeJSIframeContext, getThreeJSIframeContext, createJSAnimationContext, createVideoTexture } from '../renderer/engine';
import { hasDecodedVideoFrame } from '../renderer/videoReadiness';
import { keyframeTimeline } from './keyframeTimeline';
import { parseISF } from '../isf/parser';
import { vjLayerSequencer } from './vjLayerSequencer';
import { syncTrimmedVideoPlayback } from '../utils/videoTrimPlayback';

// Cache parsed ISF shader inputs per shader code to avoid re-parsing every
// frame. Bounded: keys are entire shader source strings, so an unbounded
// map grows by full shader sources for every unique shader touched in a
// session. On overflow the oldest entry is evicted (Map preserves
// insertion order); re-parsing a long-untouched shader on a later cache
// miss is cheap next to leaking sources for a whole show.
const vjShaderInputCache = new Map<string, ISFInputDef[]>();
const VJ_SHADER_INPUT_CACHE_MAX = 128;
function getShaderInputs(shaderCode: string | undefined): ISFInputDef[] | undefined {
  if (!shaderCode) return undefined;
  const cached = vjShaderInputCache.get(shaderCode);
  if (cached) return cached;
  try {
    const parsed = parseISF(shaderCode);
    const inputs = (parsed?.metadata?.INPUTS || []) as ISFInputDef[];
    if (vjShaderInputCache.size >= VJ_SHADER_INPUT_CACHE_MAX) {
      const oldest = vjShaderInputCache.keys().next().value;
      if (oldest !== undefined) vjShaderInputCache.delete(oldest);
    }
    vjShaderInputCache.set(shaderCode, inputs);
    return inputs;
  } catch {
    return undefined;
  }
}

// Default dimensions for the clip grid (user can add/remove dynamically)
export const DEFAULT_VJ_LAYERS = 4;
export const DEFAULT_VJ_COLUMNS = 8;
export const MAX_VJ_LAYERS = 32;
export const MAX_VJ_COLUMNS = 64;

// Backward-compat aliases — existing imports still work
export const NUM_VJ_LAYERS = DEFAULT_VJ_LAYERS;
export const NUM_VJ_COLUMNS = DEFAULT_VJ_COLUMNS;

// A clip in the grid - can be a shader, video, image, three.js HTML, AI-generated JS animation, Spout source, integrated effect, point cloud, 3D model, or mapping preset (loads a saved composition on fire)
export interface VJClip {
  id: string;
  type: 'shader' | 'video' | 'image' | 'threejs' | 'p5js' | 'jsanimation' | 'synthvision' | 'spout' | 'effect' | 'splat' | 'model3d' | 'gpu' | 'text' | 'preset';
  /** For type='preset' clips: id of the saved Composition (mapping preset)
   *  this cell loads when fired. Firing a preset clip calls
   *  project.loadComposition() — a side effect on the mapping layers —
   *  rather than feeding content into a VJ layer like the other types. */
  presetId?: string;
  name: string;
  src: string;
  thumbnail?: string;
  // For shaders
  shaderCode?: string;
  shaderValues?: Record<string, any>;
  /** Per-param Auto playhead config. Mirrors `Effect.paramAuto` —
   *  see AutoConfig in types.ts. Keyed by the same param names as
   *  `shaderValues`. */
  shaderValueAuto?: Record<string, import('../types').AutoConfig>;
  // For videos. videoElement is the runtime <video> created when the clip
  // is dropped into the grid (vjClipLauncher.setClip → videoElementCache).
  // The other fields control playback the same way MediaSource does for
  // mapping-mode video layers — exposed in the right-side panel that
  // opens when a video clip is selected (mirrors the shader-params panel).
  // Defaults: Ghost-owned trim-aware looping, playbackRate=1, trim full
  // range, isPlaying=true on first trigger.
  videoElement?: HTMLVideoElement;
  /** Runtime-only GPU texture, created while the clip is armed so firing it
   *  never inserts a black placeholder while Canvas creates a texture. */
  videoTexture?: MediaSource['texture'];
  /** 'loop' | 'once'. Ghost owns trim-aware loop boundaries; native
   *  browser looping stays disabled on active playback elements. */
  playbackMode?: 'loop' | 'once';
  /** 0.25 / 0.5 / 1 / 1.5 / 2 / 4. Maps to `videoElement.playbackRate`. */
  playbackRate?: number;
  /** If set, the trimmed clip span is fit to this many beats at master BPM. */
  playbackSyncBeats?: number | null;
  /** 0..1 fraction of duration. Out-of-trim playback is clamped on the
   *  next per-frame update. Default 0 (start of source). */
  trimStart?: number;
  /** 0..1. Default 1 (end of source). */
  trimEnd?: number;
  /** Live play/pause flag. Toggle from the VJ video-controls panel.
   *  Default true (clip auto-plays on first trigger, same as today). */
  isPlaying?: boolean;

  // ── Per-clip transform (applied at composite time) ──
  // These let the user fit a video into a layer's quad with full
  // control over scale, position, rotation, and aspect handling
  // — the same surface mapping-mode media layers expose, but per-
  // clip so a single layer slot can host multiple content sizes.
  // All optional so old projects load with sensible defaults
  // (1.0 zoom, no offset, no rotation, fit:cover, opacity 1).

  /** Source-zoom multiplier. 1 = native size, 2 = 2× zoomed in,
   *  0.5 = zoomed out (more of the source visible / pillarboxed).
   *  Independent of the layer-quad scale. */
  zoom?: number;
  /** How the source aspect maps into the layer quad:
   *    cover    — fill quad, crop overflowing dimension
   *    contain  — fit entirely, letterbox empty axis
   *    fill     — stretch source to quad, ignore aspect
   *    stretch  — alias for fill (label-friendly variant)
   *  Default 'cover'. */
  fit?: 'cover' | 'contain' | 'fill' | 'stretch';
  /** Anchor point inside the source (0..1). 0.5,0.5 = centered.
   *  Used together with fit:cover to choose which part of an over-
   *  cropped source stays visible (e.g. anchorY=0 keeps the top). */
  anchorX?: number;
  anchorY?: number;
  /** Per-clip rotation in degrees, applied around anchor. */
  rotation?: number;
  /** Per-clip opacity 0..1, multiplied with the layer's opacity at
   *  composite time. Default 1. */
  opacity?: number;
  /** Mirror source horizontally. Mostly useful for webcam selfie view. */
  mirrorX?: boolean;

  // For three.js - iframe element for rendering
  iframeElement?: HTMLIFrameElement;
  // For AI-generated JS animations (Three.js or p5.js)
  jsAnimation?: JSAnimationSource;
  // For Performer - offscreen canvas
  synthVisionCanvas?: HTMLCanvasElement;
  // For Spout sources (FluidGen, Particles3D plugins) - legacy
  spoutSource?: string;
  // For NDI sources routed through the live-source receiver path
  ndiSource?: MediaSource['ndiSource'];
  // For integrated effects (FluidGen, Particles3D running natively in WebGL)
  effectSource?: IntegratedEffectSource;
  // Durable file identity for image/video clips dragged from the media library.
  _assetRef?: import('../storage/assetRegistry').AssetRef;
  // For point cloud / splat clips
  splatContent?: SplatContent;
  // For 3D model clips
  model3dContent?: Model3DContent;
  // For WebGPU shader clips
  gpuLayerContent?: GPULayerContent;
  // For live typography clips
  textContent?: TextContent;
  // Per-clip effects
  effects?: Effect[];
}

// A block contains a named collection of clips (8 columns x 4 layers).
// When the A/B crossfader is enabled the block also carries a parallel
// bankBClipGrid so each block is a self-contained A+B scene that switches
// together when the user activates it. bankBClipGrid is optional — older
// blocks (pre-v0.3.8) won't have it; lazy-init to an empty grid on first
// access.
export interface VJBlock {
  id: string;
  name: string;
  clipGrid: (VJClip | null)[][];
  bankBClipGrid?: (VJClip | null)[][];
}

type VJTransformableClip = VJClip & { type: 'video' | 'image' };
type VJTransformProps = Pick<VJTransformableClip, 'zoom' | 'fit' | 'anchorX' | 'anchorY' | 'rotation' | 'opacity' | 'mirrorX'>;
type VJVideoPlaybackProps = Pick<VJClip, 'playbackMode' | 'playbackRate' | 'playbackSyncBeats' | 'trimStart' | 'trimEnd' | 'isPlaying'>;

// VJ Layer state (per layer). Bank A and Bank B each get their own parallel
// VJLayerState array — see `layerStates` (Bank A) and `bankBLayerStates`
// (Bank B) on the launcher state. Per-deck independence is total: opacity,
// solo, mute, blend, effects, and the active clip are all separate.
export interface VJLayerState {
  opacity: number;
  blendMode: BlendMode;
  solo: boolean;
  mute: boolean;
  activeColumn: number | null; // Which column is currently active (null = none) - used for visual indication in current block
  activeClip: VJClip | null; // The actual clip playing on this layer (persists across block switches)
  effects: Effect[];
}

// Convenience: a deck identifier. Bank A is the default deck and is always
// active. Bank B exists in parallel but only feeds the output when the
// crossfader is enabled.
export type VJDeck = 'A' | 'B';

// All transition shaders the crossfader can use. Order here matters —
// the UI cycles through this array.
export type CrossfaderTransition =
  | 'dissolve'
  | 'wipe'
  | 'rgb-split'
  | 'cube'
  | 'shatter'
  | 'halftone'
  | 'glitch'
  | 'liquid'
  | 'strobe'
  | 'slide';

export type CrossfaderCurve = 'linear' | 'constant-power' | 'sharp-cut';

// Output blend mode for the dual-deck composite. The transition shader
// (dissolve/wipe/etc.) handles the *shape* of the A↔B journey; the blend
// mode determines the *mathematical combination* of A and B at any
// fragment where both contribute. With 'normal' the transition output is
// used verbatim. With multiply/screen/add/etc., the output sweeps
// A → blend(A,B) → B as the fader moves 0 → 0.5 → 1, giving the operator
// a creative knob beyond the transition style.
export type CrossfaderBlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'add'
  | 'difference'
  | 'darken'
  | 'lighten'
  | 'overlay'
  | 'exclusion';

// Quantization grid for clip launch. 'off' = instant trigger (current
// behavior), anything else schedules the trigger to fire on the next
// matching beat boundary.
//   1/4   → next quarter note      (1 beat in 4/4)
//   1/2   → next half note         (2 beats)
//   1bar  → next downbeat          (4 beats)
//   2bar  → next 2-bar boundary    (8 beats)
//   4bar  → next 4-bar boundary    (16 beats)
export type QuantizationGrid = 'off' | '1/4' | '1/2' | '1bar' | '2bar' | '4bar';

// A clip waiting in the quantization queue. When the wall-clock time
// reaches `fireAt`, the launcher pops it and fires immediately.
export interface PendingTrigger {
  id: string;
  layerIndex: number;
  columnIndex: number;
  bank: VJDeck;
  fireAt: number;        // performance.now() target (ms)
  queuedAt: number;      // performance.now() when queued (for UI countdown)
}

// The full clip launcher state
export interface VJClipLauncherState {
  // Dynamic grid dimensions (user can add/remove layers & columns)
  numLayers: number;
  numColumns: number;
  // Blocks - each block has its own clip grid
  blocks: VJBlock[];
  // Currently active block ID
  activeBlockId: string;
  // ===== Bank A (default deck — always active) =====
  // Grid of clips [layerIndex][columnIndex] - computed from active block
  clipGrid: (VJClip | null)[][];
  // State per layer
  layerStates: VJLayerState[];

  // ===== Bank B (parallel deck — only feeds output when crossfaderEnabled) =====
  // Bank B has its own clip grid (separate from Bank A's blocks) and its own
  // per-layer state. State is preserved when the crossfader toggles off so
  // the user can flip back on without losing their B-side setup.
  bankBClipGrid: (VJClip | null)[][];
  bankBLayerStates: VJLayerState[];
  // Which deck the parameter panel / keyframe timeline / clip preview should
  // follow when the crossfader is on. Ignored when crossfader is off.
  selectedDeck: VJDeck;

  // Master opacity
  masterOpacity: number;
  // Whether VJ mode is open
  isOpen: boolean;
  // Whether VJ mode is driving the output (live)
  isLive: boolean;
  // Composition-level effects (applied to final composite output)
  compositionEffects: Effect[];
  // Stage mode: bridge VJ layers to mapping layers
  stageMode: boolean;
  stagePresetId: string | null;
  // Map mode: VJ layer slots hold mapping presets; output is a stack of
  // their full composition layers, modulated by per-VJ-layer opacity +
  // blendMode. When mapMode is true, MIX/STAGE rendering paths are
  // bypassed and the Maps tab is the only visible source in the tray.
  // Mutually exclusive with stageMode (setters clear the other).
  mapMode: boolean;
  // Stop-all blackout: when true, all VJ output is suppressed (black)
  // Auto-clears when any clip is launched
  stoppedAll: boolean;
  // Currently selected VJ layer index (for parameter panel + keyframe timeline)
  selectedLayerIndex: number | null;
  // ===== Crossfader (A/B mixing) =====
  // When enabled, the UI shows two complete decks side-by-side. Bank A reads
  // from layerStates + clipGrid; Bank B reads from bankBLayerStates +
  // bankBClipGrid. The render engine composites both banks to separate
  // FBOs and mixes them via the chosen transition shader, controlled by
  // crossfaderValue (0.0 = pure A, 1.0 = pure B).
  crossfaderEnabled: boolean;
  crossfaderValue: number;             // 0..1
  crossfaderTransition: CrossfaderTransition;
  crossfaderCurve: CrossfaderCurve;    // shapes the fader response
  crossfaderBlendMode: CrossfaderBlendMode; // A↔B math at the mix point
  crossfaderFadeDuration: number;      // seconds for Cut A/B glide; 0 = instant

  // ===== Launch quantization =====
  // Schedules clip triggers to land on a beat grid for tight musical
  // launches. 'off' is instant — same behavior the launcher had before
  // quantization existed, so beginners don't get a "why isn't my clip
  // playing?" surprise.
  quantization: QuantizationGrid;
  // Queue of clips waiting to fire on the next matching boundary. Each
  // entry is its own pending trigger (same clip can be queued multiple
  // times — useful for re-arming during a build-up). Click-the-queued-
  // clip-again behaves as "cancel the queued trigger".
  pendingTriggers: PendingTrigger[];
}

// UUID generator with fallback for insecure contexts (mobile HTTP)
function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for browsers that don't support crypto.randomUUID (e.g., mobile HTTP)
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// Create an empty clip grid with given dimensions
function createEmptyClipGrid(numLayers: number = DEFAULT_VJ_LAYERS, numColumns: number = DEFAULT_VJ_COLUMNS): (VJClip | null)[][] {
  return Array(numLayers).fill(null).map(() => Array(numColumns).fill(null));
}

// Create a new block with default name. Each block carries its own Bank A
// AND Bank B clip grids — switching blocks swaps both banks together so a
// "block" is a complete A+B scene.
function createNewBlock(name: string = 'Block 1', numLayers: number = DEFAULT_VJ_LAYERS, numColumns: number = DEFAULT_VJ_COLUMNS): VJBlock {
  return {
    id: generateUUID(),
    name,
    clipGrid: createEmptyClipGrid(numLayers, numColumns),
    bankBClipGrid: createEmptyClipGrid(numLayers, numColumns),
  };
}

// Create a default layer state
function createDefaultLayerState(): VJLayerState {
  return {
    opacity: 1,
    blendMode: 'normal' as BlendMode,
    solo: false,
    mute: false,
    activeColumn: null,
    activeClip: null,
    effects: [],
  };
}

// Create default state
function createDefaultState(): VJClipLauncherState {
  const defaultBlock = createNewBlock('Block 1', DEFAULT_VJ_LAYERS, DEFAULT_VJ_COLUMNS);
  return {
    numLayers: DEFAULT_VJ_LAYERS,
    numColumns: DEFAULT_VJ_COLUMNS,
    blocks: [defaultBlock],
    activeBlockId: defaultBlock.id,
    clipGrid: defaultBlock.clipGrid,
    layerStates: Array(DEFAULT_VJ_LAYERS).fill(null).map(() => createDefaultLayerState()),
    // Bank B's clipGrid is the LIVE mirror of the active block's bankBClipGrid
    // (parallel to how `clipGrid` mirrors activeBlock.clipGrid). Block switches
    // re-point this; mutations write through to both.
    bankBClipGrid: defaultBlock.bankBClipGrid!,
    bankBLayerStates: Array(DEFAULT_VJ_LAYERS).fill(null).map(() => createDefaultLayerState()),
    selectedDeck: 'A',
    masterOpacity: 1,
    isOpen: false,
    isLive: false,
    compositionEffects: [],
    stageMode: false,
    mapMode: false,
    stagePresetId: null,
    stoppedAll: false,
    selectedLayerIndex: null,
    crossfaderEnabled: false,
    crossfaderValue: 0,
    crossfaderTransition: 'dissolve',
    crossfaderCurve: 'constant-power',
    crossfaderBlendMode: 'normal',
    crossfaderFadeDuration: 0,
    // Default off so beginners get instant triggers without thinking about
    // beat-sync. Pros switch this on once they're locked to a tempo source.
    quantization: 'off',
    pendingTriggers: [],
  };
}

// ----- Internal helpers: pick the right slice of state for a given deck.
// All bank-aware mutators below funnel through these so we don't duplicate
// the routing logic.
function pickGrid(state: VJClipLauncherState, deck: VJDeck): (VJClip | null)[][] {
  return deck === 'B' ? state.bankBClipGrid : state.clipGrid;
}
function pickLayerStates(state: VJClipLauncherState, deck: VJDeck): VJLayerState[] {
  return deck === 'B' ? state.bankBLayerStates : state.layerStates;
}
// Apply a fresh grid + fresh layerStates back to state, returning a new
// state object. `newGrid` may be null to leave the grid unchanged.
function withDeck(
  state: VJClipLauncherState,
  deck: VJDeck,
  newLayerStates: VJLayerState[],
  newGrid?: (VJClip | null)[][] | null
): VJClipLauncherState {
  if (deck === 'B') {
    return {
      ...state,
      bankBLayerStates: newLayerStates,
      ...(newGrid !== undefined && newGrid !== null ? { bankBClipGrid: newGrid } : {}),
    };
  }
  return {
    ...state,
    layerStates: newLayerStates,
    ...(newGrid !== undefined && newGrid !== null ? { clipGrid: newGrid } : {}),
  };
}

// Write a fresh deck grid into the active block, updating the right slot
// (clipGrid for Bank A, bankBClipGrid for Bank B). Returns a fresh blocks
// array. Both banks live inside the block so each block is a complete A+B
// scene that swaps together when the user activates it.
function blocksWithDeckGrid(
  state: VJClipLauncherState,
  deck: VJDeck,
  newGrid: (VJClip | null)[][]
): VJBlock[] {
  return state.blocks.map(block => {
    if (block.id !== state.activeBlockId) return block;
    if (deck === 'A') {
      return { ...block, clipGrid: newGrid.map(row => [...row]) };
    }
    return { ...block, bankBClipGrid: newGrid.map(row => [...row]) };
  });
}

// ─── Quantization clock helpers ──────────────────────────────────────────
//
// Two ground truths for "where are we in the bar":
//   1) Audio is active + has detected beats → anchor to the most recent
//      detected beat using audioStore.beat.timeSinceLastBeat. This stays
//      tight even if BPM drifts because we measure against a real beat.
//   2) Audio is off (or no beats detected yet) → run a virtual clock at
//      the current manual/auto BPM with a fixed epoch. Beginners who tap
//      a tempo without enabling audio still get usable quantization.
//
// `quantClockEpoch` is the wall-clock time the virtual clock started — it
// only matters for branch (2) but stays stable across BPM changes so the
// fader doesn't jump on every tempo tweak.

import { get as getStore } from 'svelte/store';
import { audioStore } from './audio';

const QUANT_CLOCK_EPOCH = performance.now();

/** Convert a quantization grid label to its size in beats (4/4 assumed). */
function gridToBeats(grid: QuantizationGrid): number {
  switch (grid) {
    case '1/4':  return 1;
    case '1/2':  return 2;
    case '1bar': return 4;
    case '2bar': return 8;
    case '4bar': return 16;
    default:     return 0;
  }
}

/**
 * Compute the next wall-clock time (performance.now() ms) that aligns to
 * the requested grid. Returns the current time if grid is 'off' so callers
 * can use the same code path for unscheduled triggers.
 */
function nextQuantumWallTime(grid: QuantizationGrid): number {
  const now = performance.now();
  const beats = gridToBeats(grid);
  if (beats === 0) return now;

  const audio = getStore(audioStore);
  // Resolve BPM with manual override > auto-detected > fallback 120
  const bpm = audio.manualBPM || audio.bpm || 120;
  if (bpm <= 0) return now;
  const beatMs = 60000 / bpm;

  // Anchor approach: find the wall-clock time of "beat 0" (the reference
  // downbeat the clock counts from), then forward to the next boundary.
  let anchorMs: number;
  let anchorBeatPos: number;

  if (audio.isActive && audio.beat.beatCount > 0 && audio.beat.timeSinceLastBeat >= 0) {
    // Snap anchor to the most recent detected beat. timeSinceLastBeat is
    // in seconds; convert to ms.
    anchorMs = now - audio.beat.timeSinceLastBeat * 1000;
    anchorBeatPos = audio.beat.beatCount;  // integer beat at anchorMs
  } else {
    // Virtual clock: anchor at the launcher's epoch, beat 0.
    anchorMs = QUANT_CLOCK_EPOCH;
    anchorBeatPos = 0;
  }

  // How many beats have elapsed since the anchor (float)?
  const elapsedBeats = (now - anchorMs) / beatMs;
  const currentBeatPos = anchorBeatPos + elapsedBeats;

  // +epsilon so triggers fired exactly on the boundary don't get
  // re-scheduled to the SAME boundary (would fire instantly, defeating
  // the point of quantization).
  const targetBeatPos = Math.ceil((currentBeatPos + 0.001) / beats) * beats;
  const fireMs = anchorMs + (targetBeatPos - anchorBeatPos) * beatMs;
  return fireMs;
}

// rAF tick state — only runs when there are pending triggers
let quantTickHandle: number | null = null;
function ensureQuantTickRunning(launcher: { update: any }) {
  if (quantTickHandle !== null) return;
  const tick = () => {
    quantTickHandle = null;
    let didFire = false;
    let firedTriggers: PendingTrigger[] = [];
    launcher.update((s: VJClipLauncherState) => {
      if (s.pendingTriggers.length === 0) return s;
      const now = performance.now();
      const due: PendingTrigger[] = [];
      const remaining: PendingTrigger[] = [];
      for (const p of s.pendingTriggers) {
        if (p.fireAt <= now) due.push(p);
        else remaining.push(p);
      }
      if (due.length === 0) return s;
      didFire = true;
      firedTriggers = due;
      return { ...s, pendingTriggers: remaining };
    });
    // Fire triggers OUTSIDE the update so the immediate trigger path
    // (which itself calls update) doesn't recurse mid-mutation.
    if (didFire) {
      for (const t of firedTriggers) {
        immediateTriggerClip(t.layerIndex, t.columnIndex, t.bank);
      }
    }
    // Continue ticking if anything is still queued
    const after = getStore(vjClipLauncher);
    if (after.pendingTriggers.length > 0) {
      quantTickHandle = requestAnimationFrame(tick);
    }
  };
  quantTickHandle = requestAnimationFrame(tick);
}

/** Forward decl — populated below by createVJClipLauncherStore. */
let immediateTriggerClip: (layerIndex: number, columnIndex: number, deck: VJDeck) => void = () => {};

// Cache for video elements to persist playback
const videoElementCache = new Map<string, HTMLVideoElement>();

// VideoTexture creation is part of arming a clip, not triggering it. Keeping
// one stable texture per clip also prevents Three.js from sampling a newly
// constructed (and not-yet-uploadable) texture on the trigger frame.
const videoTextureCache = new Map<string, MediaSource['texture']>();
type ArmedVideoState = {
  key: string;
  ready: boolean;
  promise?: Promise<HTMLVideoElement>;
};
const armedVideoStates = new Map<string, ArmedVideoState>();

// Cache for VJ source objects (keeps textures persistent)
const vjSourceCache = new Map<string, MediaSource>();

function releaseVJSourceCacheEntry(key: string): void {
  const source = vjSourceCache.get(key);
  const armedVideoTexture = source?.type === 'video'
    ? videoTextureCache.get(source.id)
    : undefined;
  if (source?.texture && source.texture !== armedVideoTexture) {
    try { source.texture.dispose?.(); } catch { /* ignore */ }
    source.texture = undefined;
  }
  vjSourceCache.delete(key);
}

function ensureClipVideoTexture(clip: VJClip, videoEl: HTMLVideoElement): MediaSource['texture'] {
  let texture = videoTextureCache.get(clip.id);
  if (texture && texture.image !== videoEl) {
    try { texture.dispose?.(); } catch { /* ignore */ }
    videoTextureCache.delete(clip.id);
    texture = undefined;
  }
  if (!texture) {
    texture = createVideoTexture(videoEl);
    videoTextureCache.set(clip.id, texture);
  }
  clip.videoTexture = texture;
  return texture;
}

function waitForDecodedClipFrame(clip: VJClip, videoEl: HTMLVideoElement): Promise<void> {
  if (hasDecodedVideoFrame(videoEl)) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      videoEl.removeEventListener('loadeddata', onReady);
      videoEl.removeEventListener('canplay', onReady);
      videoEl.removeEventListener('error', onError);
    };
    const onReady = () => {
      if (!hasDecodedVideoFrame(videoEl)) return;
      cleanup();
      ensureClipVideoTexture(clip, videoEl);
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error(`Video clip failed to decode: ${clip.name}`));
    };
    videoEl.addEventListener('loadeddata', onReady);
    videoEl.addEventListener('canplay', onReady);
    videoEl.addEventListener('error', onError, { once: true });
  });
}

function clearVJSourceCache(): void {
  for (const key of [...vjSourceCache.keys()]) releaseVJSourceCacheEntry(key);
}

function shouldSkipVideoCors(src: string | undefined): boolean {
  // Skip only schemes that are same-origin or in-memory. `ghost-asset://`
  // is served by Electron's custom protocol on a DIFFERENT origin, so the
  // video element MUST set crossOrigin='anonymous' before src — otherwise
  // WebGL throws "SecurityError: ... contains cross-origin data" the
  // moment Three.js tries to upload the frame as a texture. Pair this with
  // the Access-Control-Allow-Origin headers in main.js's protocol handler.
  return !src || /^(blob:|file:|data:)/i.test(src);
}

function mediaTypeForClip(clip: VJClip): 'shader' | 'video' | 'image' | 'threejs' | 'p5js' | 'color' | 'spout' | 'effect' {
  if (clip.type === 'shader') return 'shader';
  if (clip.type === 'video') return 'video';
  if (clip.type === 'threejs' || clip.type === 'synthvision') return 'threejs';
  if (clip.type === 'jsanimation') return clip.jsAnimation?.animationType === 'p5js' ? 'p5js' : 'threejs';
  if (clip.type === 'p5js') return 'p5js';
  if (clip.type === 'spout') return 'spout';
  if (clip.type === 'effect') return 'effect';
  if (clip.type === 'gpu' || clip.type === 'text') return 'color';
  return 'image';
}

function isTransformableMediaClip(clip: VJClip | null | undefined): clip is VJTransformableClip {
  return !!clip && (clip.type === 'video' || clip.type === 'image');
}

function isLiveVideoClip(clip: VJClip): boolean {
  return (
    clip.type === 'video' &&
    (
      !!clip.src?.startsWith('live://') ||
      !!clip.videoElement?.srcObject
    )
  );
}

function ensureClipVideoElement(clip: VJClip): HTMLVideoElement | undefined {
  if (!clip || clip.type !== 'video') return clip.videoElement;

  if (clip.videoElement && isLiveVideoClip(clip)) {
    videoElementCache.set(clip.id, clip.videoElement);
    ensureClipVideoTexture(clip, clip.videoElement);
    clip.isPlaying = clip.isPlaying ?? true;
    return clip.videoElement;
  }

  if (!clip.src) return clip.videoElement;

  let videoEl = videoElementCache.get(clip.id);
  if (videoEl && videoEl.src !== clip.src) {
    try { videoEl.pause(); } catch { /* ignore */ }
    videoEl.removeAttribute('src');
    videoElementCache.delete(clip.id);
    const staleTexture = videoTextureCache.get(clip.id);
    try { staleTexture?.dispose?.(); } catch { /* ignore */ }
    videoTextureCache.delete(clip.id);
    clip.videoTexture = undefined;
    videoEl = undefined;
  }

  if (!videoEl) {
    videoEl = document.createElement('video');
    if (!shouldSkipVideoCors(clip.src)) {
      videoEl.crossOrigin = 'anonymous';
    }
    videoEl.loop = false;
    videoEl.muted = true;
    videoEl.playsInline = true;
    videoEl.preload = 'auto';
    videoEl.src = clip.src;
    clip.isPlaying = clip.isPlaying ?? true;

    const v = videoEl;
    const tryPlay = () => {
      if (clip.isPlaying === false) return;
      v.play().catch(e => console.warn('[vjClipLauncher] video autoplay failed:', e));
    };
    if (v.readyState >= 2) tryPlay();
    else v.addEventListener('loadeddata', tryPlay, { once: true });
    videoElementCache.set(clip.id, videoEl);
  }

  clip.videoElement = videoEl;
  syncTrimmedVideoPlayback(videoEl, clip);
  ensureClipVideoTexture(clip, videoEl);
  return videoEl;
}

function videoArmKey(clip: VJClip): string {
  return `${clip.src}|${Math.max(0, Math.min(1, clip.trimStart ?? 0)).toFixed(6)}`;
}

function waitForVideoEvent(
  videoEl: HTMLVideoElement,
  eventName: 'loadedmetadata' | 'seeked',
  timeoutMs = 1500,
): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      videoEl.removeEventListener(eventName, finish);
      clearTimeout(timeout);
      resolve();
    };
    const timeout = window.setTimeout(finish, timeoutMs);
    videoEl.addEventListener(eventName, finish, { once: true });
  });
}

function waitForPresentedVideoFrame(videoEl: HTMLVideoElement, timeoutMs = 500): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    let frameHandle: number | undefined;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (frameHandle !== undefined && typeof videoEl.cancelVideoFrameCallback === 'function') {
        videoEl.cancelVideoFrameCallback(frameHandle);
      }
      resolve();
    };
    const timeout = window.setTimeout(finish, timeoutMs);
    if (typeof videoEl.requestVideoFrameCallback === 'function') {
      frameHandle = videoEl.requestVideoFrameCallback(finish);
    } else {
      requestAnimationFrame(() => requestAnimationFrame(finish));
    }
  });
}

function isVideoArmedAtTrimStart(clip: VJClip, videoEl: HTMLVideoElement): boolean {
  const state = armedVideoStates.get(clip.id);
  if (!state?.ready || state.key !== videoArmKey(clip)) return false;
  if (!hasDecodedVideoFrame(videoEl) || !videoEl.paused) return false;
  const duration = videoEl.duration;
  if (!Number.isFinite(duration) || duration <= 0) return false;
  const target = Math.max(0, Math.min(1, clip.trimStart ?? 0)) * duration;
  return Math.abs(videoEl.currentTime - target) <= Math.max(1 / 120, duration * 0.00001);
}

function isVideoReadyForTrigger(clip: VJClip, videoEl: HTMLVideoElement): boolean {
  if (isLiveVideoClip(clip)) {
    return hasDecodedVideoFrame(videoEl);
  }
  return isVideoArmedAtTrimStart(clip, videoEl);
}

/**
 * Decode and park the exact first visible frame while the clip is inactive.
 * Triggering then becomes play + reveal; no seek or decoder wait occurs in
 * the frame where the active clip changes.
 */
function armVideoClipForTrigger(clip: VJClip): Promise<HTMLVideoElement> {
  const videoEl = ensureClipVideoElement(clip);
  if (!videoEl) return Promise.reject(new Error(`Video clip has no source: ${clip.name}`));

  const key = videoArmKey(clip);
  const current = armedVideoStates.get(clip.id);
  if (current?.key === key) {
    if (current.ready && isVideoReadyForTrigger(clip, videoEl)) return Promise.resolve(videoEl);
    if (current.promise) return current.promise;
  }

  const state: ArmedVideoState = { key, ready: false };

  if (isLiveVideoClip(clip)) {
    clip.isPlaying = true;

    const promise = Promise.resolve(
      videoEl.paused ? videoEl.play().catch(() => { /* autoplay policy */ }) : undefined,
    ).then(async () => {
      await waitForDecodedClipFrame(clip, videoEl);

      const texture = ensureClipVideoTexture(clip, videoEl);
      if (texture) texture.needsUpdate = true;

      state.ready = true;
      state.promise = undefined;
      return videoEl;
    }).catch((error) => {
      if (armedVideoStates.get(clip.id) === state) armedVideoStates.delete(clip.id);
      throw error;
    });

    state.promise = promise;
    armedVideoStates.set(clip.id, state);
    return promise;
  }

  const promise = (async () => {
    clip.isPlaying = false;
    try { videoEl.pause(); } catch { /* ignore */ }

    if (!Number.isFinite(videoEl.duration) || videoEl.duration <= 0) {
      await waitForVideoEvent(videoEl, 'loadedmetadata');
    }

    const duration = videoEl.duration;
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error(`Video duration is unavailable: ${clip.name}`);
    }

    const target = Math.max(0, Math.min(1, clip.trimStart ?? 0)) * duration;
    if (!hasDecodedVideoFrame(videoEl) ||
        Math.abs(videoEl.currentTime - target) > Math.max(1 / 120, duration * 0.00001)) {
      const seeked = waitForVideoEvent(videoEl, 'seeked');
      videoEl.currentTime = target;
      await seeked;
      // `seeked` means the media timeline moved; it does not guarantee the
      // corresponding frame has reached Chromium's presentation queue yet.
      // Waiting for rVFC prevents activation from winning that race by one
      // compositor frame.
      await waitForPresentedVideoFrame(videoEl);
    }

    await waitForDecodedClipFrame(clip, videoEl);
    const texture = ensureClipVideoTexture(clip, videoEl);
    if (texture) texture.needsUpdate = true;
    state.ready = true;
    state.promise = undefined;
    return videoEl;
  })().catch((error) => {
    if (armedVideoStates.get(clip.id) === state) armedVideoStates.delete(clip.id);
    throw error;
  });

  state.promise = promise;
  armedVideoStates.set(clip.id, state);
  return promise;
}

/**
 * Put an already-armed video into motion before publishing it as active.
 *
 * Svelte store subscribers render synchronously during update(). If the
 * activation happens after that update, videos visibly trail shaders.
 */
function prepareVideoClipForTrigger(clip: VJClip): HTMLVideoElement | undefined {
  if (clip.type !== 'video') return undefined;
  const videoEl = ensureClipVideoElement(clip);
  if (!videoEl) return undefined;

  clip.isPlaying = true;
  armedVideoStates.delete(clip.id);
  if (videoEl.paused) {
    videoEl.play().catch(() => { /* AbortError on rapid retrigger is fine */ });
  }
  if (clip.videoTexture) {
    clip.videoTexture.needsUpdate = true;
  }
  return videoEl;
}

function pauseClipRuntime(clip: VJClip | null | undefined): void {
  if (!clip || clip.type !== 'video') return;
  if (isLiveVideoClip(clip)) {
    // Live feeds stay running while assigned to the deck; do not pause or
    // enter seek-and-trim arming when switching away from them.
    armedVideoStates.delete(clip.id);
    return;
  }
  const videoEl = clip.videoElement || videoElementCache.get(clip.id);
  if (!videoEl) return;
  try { videoEl.pause(); } catch { /* ignore */ }
  clip.isPlaying = false;
  void armVideoClipForTrigger(clip).catch((error) => {
    console.warn('[vjClipLauncher] video re-arm failed:', error);
  });
}

/** Release a removed clip's cached video element unless the same clip id
 *  is still referenced somewhere else (another cell, the other bank, an
 *  inactive block, or an active deck slot — bank copies share clip ids).
 *  Without this, every video clip deleted from the grid left its
 *  HTMLVideoElement (decoder + buffered media) alive in the cache for
 *  the rest of the session. Checked against the NEXT state so the cell
 *  being cleared doesn't count as a reference. */
function releaseClipRuntimeIfOrphaned(nextState: any, clipId: string): void {
  if (!clipId || !videoElementCache.has(clipId)) return;
  const gridHasClip = (grid: any) =>
    Array.isArray(grid) && grid.some((row: any) => Array.isArray(row) && row.some((c: any) => c?.id === clipId));
  const statesHaveClip = (ls: any) =>
    Array.isArray(ls) && ls.some((l: any) => l?.activeClip?.id === clipId);
  if (gridHasClip(nextState.clipGrid) || gridHasClip(nextState.bankBClipGrid)) return;
  if (statesHaveClip(nextState.layerStates) || statesHaveClip(nextState.bankBLayerStates)) return;
  for (const block of nextState.blocks ?? []) {
    if (gridHasClip(block.clipGrid) || gridHasClip(block.bankBClipGrid)) return;
  }
  const video = videoElementCache.get(clipId)!;
  try { video.pause(); } catch { /* ignore */ }
  video.removeAttribute('src');
  try { video.load(); } catch { /* ignore */ }
  videoElementCache.delete(clipId);
  armedVideoStates.delete(clipId);
  const texture = videoTextureCache.get(clipId);
  try { texture?.dispose?.(); } catch { /* ignore */ }
  videoTextureCache.delete(clipId);
}

// Create the store
function createVJClipLauncherStore() {
  const { subscribe, set, update } = writable<VJClipLauncherState>(createDefaultState());

  // Wire the module-level immediateTriggerClip closure so triggerClip() can
  // delegate to it AND so the rAF tick can fire queued triggers without
  // needing access to the store closure scope.
  const commitImmediateTriggerClip = (layerIndex: number, columnIndex: number, deck: VJDeck) => {
    let didTrigger = false;
    let isReclick = false;
    let outgoingClip: VJClip | null = null;
    let incomingClip: VJClip | null = null;

    // Prepare the decoded frame before the store publishes this clip as
    // active. Store subscribers (including the compositor adapter) run
    // synchronously inside update(), so this ordering is the difference
    // between same-frame video/shader triggering and a one-frame video lag.
    const before = get({ subscribe });
    const requestedClip = pickGrid(before, deck)[layerIndex]?.[columnIndex];
    if (requestedClip?.type === 'video') {
      prepareVideoClipForTrigger(requestedClip);
    }

    update(state => {
      const targetGrid = pickGrid(state, deck);
      const targetLayerStates = pickLayerStates(state, deck);
      const newLayerStates = [...targetLayerStates];
      const clip = targetGrid[layerIndex]?.[columnIndex];
      if (!clip) return state;
      // Preset clips:
      //   - ALWAYS load the composition into project.layers (side
      //     effect). In STAGE mode this immediately swaps the mapping
      //     topology, exiting VJ shows the loaded preset, etc.
      //   - In MAP mode ALSO occupy the VJ layer slot via activeClip
      //     so the Canvas MAP render branch composites this preset
      //     into the output stack. The cell highlight + per-VJ-layer
      //     opacity + blend mode all flow from that.
      //   - In MIX / STAGE the slot stays available for the user's
      //     real VJ content. Otherwise firing a preset would lock
      //     a VJ layer to "no content" (the preset is filtered out
      //     of vjOutputLayers) and shader/video fires on the same
      //     layer would appear to do nothing visually.
      if (clip.type === 'preset') {
        if (clip.presetId) {
          void import('./layers').then(({ project }) => {
            project.loadComposition(clip.presetId!);
          }).catch((err) => {
            console.error('[VJ] preset load failed:', err);
          });
        }
        if (!state.mapMode) {
          // Side-effect only — leave the VJ layer slot's activeClip
          // alone so STAGE/MIX VJ workflow is preserved.
          didTrigger = false;
          return state;
        }
        const wasReclick = !!(newLayerStates[layerIndex].activeClip && newLayerStates[layerIndex].activeClip!.id === clip.id);
        if (wasReclick) {
          didTrigger = false;
          return state;
        }
        newLayerStates[layerIndex] = {
          ...newLayerStates[layerIndex],
          activeColumn: columnIndex,
          activeClip: clip,
        };
        didTrigger = true;
        incomingClip = clip;
        const next = withDeck(state, deck, newLayerStates);
        return { ...next, stoppedAll: false };
      }
      const current = newLayerStates[layerIndex].activeClip;
      isReclick = !!(current && current.id === clip.id);
      outgoingClip = !isReclick ? current : null;
      incomingClip = clip;

      // Re-clicking the currently-playing clip keeps STATE unchanged
      // (so we don't reset keyframe time mid-show), but the video
      // element below is still restarted to frame 0 — that's the
      // explicit user expectation: every click on a clip starts it
      // from the beginning, no exceptions.
      if (isReclick) {
        didTrigger = false;
        return state;
      }

      newLayerStates[layerIndex] = {
        ...newLayerStates[layerIndex],
        activeColumn: columnIndex,
        activeClip: clip,
      };
      didTrigger = true;
      const next = withDeck(state, deck, newLayerStates);
      return { ...next, stoppedAll: false };
    });

    // VJ semantics: clicking a clip ALWAYS restarts it at its trim start,
    // never resumes from where it last paused. Combined with pausing
    // the outgoing clip on this same layer/deck, this stops the
    // "videos play forever in the background and resume mid-stream"
    // behaviour the user reported. Wrapped in try/catch because
    // currentTime= can throw if the element is mid-load.
    // Cast through the VJClip type — TS can't track assignments
    // inside the update() closure across closure boundaries.
    const inc = incomingClip as VJClip | null;
    const out = outgoingClip as VJClip | null;
    // Pause the OUTGOING video so it doesn't keep decoding in the
    // background. Only when it's a different element from the
    // incoming clip's — same element (e.g. re-clicking same clip on
    // the layer) doesn't get paused mid-restart.
    if (out && out.type === 'video' && out.videoElement &&
        out.videoElement !== inc?.videoElement) {
      pauseClipRuntime(out);
    }

    if (didTrigger) {
      keyframeTimeline.seek(0);
      keyframeTimeline.play();
    }
  };

  // A clip cannot enter the visible stack until Chromium has decoded a frame.
  // Usually this is synchronous because setClip arms videos in advance. The
  // async branch only covers a user firing immediately after adding a clip;
  // the outgoing layer remains visible instead of flashing black.
  const pendingVideoTriggers = new Map<string, number>();
  let videoTriggerSerial = 0;
  immediateTriggerClip = (layerIndex, columnIndex, deck) => {
    const triggerKey = `${deck}:${layerIndex}`;
    const requestId = ++videoTriggerSerial;
    pendingVideoTriggers.set(triggerKey, requestId);

    const state = get({ subscribe });
    const clip = pickGrid(state, deck)[layerIndex]?.[columnIndex];
    if (clip?.type === 'video') {
      const videoEl = ensureClipVideoElement(clip);
      if (videoEl && !isVideoReadyForTrigger(clip, videoEl)) {
        void armVideoClipForTrigger(clip)
          .then(() => {
            if (pendingVideoTriggers.get(triggerKey) !== requestId) return;
            commitImmediateTriggerClip(layerIndex, columnIndex, deck);
          })
          .catch((error) => console.warn('[vjClipLauncher] trigger held; video is not ready:', error));
        return;
      }
    }

    commitImmediateTriggerClip(layerIndex, columnIndex, deck);
  };

  return {
    subscribe,
    set,
    update,

    // Reset to default state
    reset() {
      // Cleanup video elements
      for (const video of videoElementCache.values()) {
        video.pause();
        video.src = '';
      }
      videoElementCache.clear();
      armedVideoStates.clear();
      clearVJSourceCache();
      for (const texture of videoTextureCache.values()) {
        try { texture?.dispose?.(); } catch { /* ignore */ }
      }
      videoTextureCache.clear();
      set(createDefaultState());
    },

    // Drop transient renderer-side VJ sources without touching the user's
    // clip grid. Used when exiting VJ so stale shader/canvas textures do
    // not linger behind the main editor.
    clearRuntimeSourceCache() {
      clearVJSourceCache();
    },

    // Set VJ mode open state. Mirrors into the workspace store so the
    // tri-state activeWorkspace flag ('main' | 'vj' | 'stage') stays
    // consistent — required so a future Stage Designer overlay can
    // open and reliably close any active VJ panel without each call
    // site having to remember.  The `opts.fromWorkspace` escape hatch
    // is used when workspace.setActive() drives the close itself, to
    // avoid bouncing back through workspace and double-firing.
    setOpen(isOpen: boolean, opts?: { fromWorkspace?: boolean }) {
      update(state => ({ ...state, isOpen }));
      if (!opts?.fromWorkspace) {
        void import('./workspace').then(({ workspace }) => {
          workspace.setActive(isOpen ? 'vj' : 'main');
        });
      }
    },

    // Set a clip in the grid for the given deck. Bank A also writes through
    // to the active block's persisted grid (Bank B has no block system).
    setClip(layerIndex: number, columnIndex: number, clip: VJClip | null, deck: VJDeck = 'A') {
      update(state => {
        const targetGrid = pickGrid(state, deck);
        const newGrid = targetGrid.map(row => [...row]);

        // Replacing/clearing an occupied cell: drop the old clip's cached
        // render source, and release its video element if this was the
        // last cell referencing it.
        const replacedClip = targetGrid[layerIndex]?.[columnIndex];
        if (replacedClip && replacedClip.id !== clip?.id) {
          const bankSuffix = deck === 'B' ? '-B' : '';
          releaseVJSourceCacheEntry(`vj-${layerIndex}${bankSuffix}-${replacedClip.id}`);
        }

        // If setting a video, create/get the video element. Match
        // LayerPanel.createMediaSource() — without playsInline + preload + an
        // explicit load-then-play sequence the element starts in HAVE_NOTHING
        // and the first VideoTexture sample comes back as a single black
        // frame. That's the "VJ video shows one stuck frame" bug.
        if (clip && clip.type === 'video') {
          ensureClipVideoElement(clip);
          let videoEl = videoElementCache.get(clip.id) || clip.videoElement;
          if (!videoEl) {
            videoEl = document.createElement('video');
            // Only set crossOrigin for remote URLs — blob:/file: would log a
            // CORS warning and refuse to load.
            if (!clip.src.startsWith('blob:') && !clip.src.startsWith('file:')) {
              videoEl.crossOrigin = 'anonymous';
            }
            videoEl.loop = false;
            videoEl.muted = true;
            videoEl.playsInline = true;
            videoEl.preload = 'auto';
            videoEl.src = clip.src;
            // Default isPlaying to true — the layer is being triggered into
            // the deck, so playback should start. UI toggle (pause from the
            // VJ video controls panel) flips this to false later.
            clip.isPlaying = clip.isPlaying ?? true;
            syncTrimmedVideoPlayback(videoEl, clip);
            // Wait for the first frame to decode, then play. DON'T call
            // `.load()` here — the `.src=` setter above already initiated
            // the resource selection algorithm. A second load() races the
            // first and, on Electron 42 / Chromium 130, aborts any pending
            // play() with AbortError + leaves the VideoTexture in an
            // INVALID_VALUE state on next upload (= the "horizontal lines /
            // freeze on rapid clip switch" bug).
            const v = videoEl;
            const tryPlay = () => v.play().catch(e => console.warn('[vjClipLauncher] video autoplay failed:', e));
            if (v.readyState >= 2) tryPlay();
            else v.addEventListener('loadeddata', tryPlay, { once: true });
            videoElementCache.set(clip.id, videoEl);
          }
          clip.videoElement = videoEl;
          ensureClipVideoTexture(clip, videoEl);
          void armVideoClipForTrigger(clip).catch((error) => {
            console.warn('[vjClipLauncher] video arm failed:', error);
          });
        }

        // If setting a threejs clip (built-in), create/get the iframe context
        if (clip && clip.type === 'threejs') {
          const context = createThreeJSIframeContext(clip.id, clip.src);
          clip.iframeElement = context.iframe;
        }

        // If setting an AI-generated JS animation (threejs or p5js with jsAnimation)
        if (clip && (clip.type === 'jsanimation' || clip.type === 'p5js') && clip.jsAnimation) {
          const context = createJSAnimationContext(clip.id, clip.jsAnimation);
          clip.iframeElement = context.iframe;
        }

        newGrid[layerIndex][columnIndex] = clip;

        // Persist into the active block — both banks now live inside the
        // block so each block is a complete A+B scene.
        const newBlocks = state.blocks.map(block => {
          if (block.id !== state.activeBlockId) return block;
          if (deck === 'A') {
            const blockGrid = block.clipGrid.map(row => [...row]);
            blockGrid[layerIndex][columnIndex] = clip;
            return { ...block, clipGrid: blockGrid };
          }
          // Bank B
          const blockBankB = (block.bankBClipGrid ?? createEmptyClipGrid(state.numLayers, state.numColumns)).map(row => [...row]);
          blockBankB[layerIndex][columnIndex] = clip;
          return { ...block, bankBClipGrid: blockBankB };
        });

        const nextState = deck === 'A'
          ? { ...state, clipGrid: newGrid, blocks: newBlocks }
          : { ...state, bankBClipGrid: newGrid, blocks: newBlocks };
        if (replacedClip && replacedClip.id !== clip?.id) {
          releaseClipRuntimeIfOrphaned(nextState, replacedClip.id);
        }
        return nextState;
      });
    },

    // Clear a clip from the grid for the given deck
    clearClip(layerIndex: number, columnIndex: number, deck: VJDeck = 'A') {
      const before = get({ subscribe });
      const activeBefore = pickLayerStates(before, deck)[layerIndex]?.activeClip;
      if (activeBefore && pickLayerStates(before, deck)[layerIndex]?.activeColumn === columnIndex) {
        pauseClipRuntime(activeBefore);
      }
      update(state => {
        const targetGrid = pickGrid(state, deck);
        const targetLayerStates = pickLayerStates(state, deck);

        // Remove stale source cache entry for this clip (key includes bank
        // suffix when in dual-bank mode)
        const oldClip = targetGrid[layerIndex]?.[columnIndex];
        if (oldClip) {
          const bankSuffix = deck === 'B' ? '-B' : '';
          releaseVJSourceCacheEntry(`vj-${layerIndex}${bankSuffix}-${oldClip.id}`);
        }

        const newGrid = targetGrid.map(row => [...row]);
        newGrid[layerIndex][columnIndex] = null;

        // If this was the active clip, deactivate it and clear the reference
        const newLayerStates = [...targetLayerStates];
        if (newLayerStates[layerIndex].activeColumn === columnIndex) {
          newLayerStates[layerIndex] = { ...newLayerStates[layerIndex], activeColumn: null, activeClip: null };
        }

        // Persist into the active block — both banks are part of the block.
        const newBlocks = state.blocks.map(block => {
          if (block.id !== state.activeBlockId) return block;
          if (deck === 'A') {
            const blockGrid = block.clipGrid.map(row => [...row]);
            blockGrid[layerIndex][columnIndex] = null;
            return { ...block, clipGrid: blockGrid };
          }
          const blockBankB = (block.bankBClipGrid ?? createEmptyClipGrid(state.numLayers, state.numColumns)).map(row => [...row]);
          blockBankB[layerIndex][columnIndex] = null;
          return { ...block, bankBClipGrid: blockBankB };
        });

        const nextState = deck === 'A'
          ? { ...state, clipGrid: newGrid, layerStates: newLayerStates, blocks: newBlocks }
          : { ...state, bankBClipGrid: newGrid, bankBLayerStates: newLayerStates, blocks: newBlocks };
        if (oldClip) releaseClipRuntimeIfOrphaned(nextState, oldClip.id);
        return nextState;
      });
    },

    /** Clear all synthvision clips from the grid — called when VJ mode closes to prevent stale canvas refs.
     * Sweeps BOTH banks since synthvision clips can exist independently in each deck. */
    clearSynthVisionClips() {
      update(state => {
        let changed = false;

        const newGridA = state.clipGrid.map((row, li) =>
          row.map((clip, ci) => {
            if (clip?.type === 'synthvision') {
              releaseVJSourceCacheEntry(`vj-${li}-${clip.id}`);
              changed = true;
              return null;
            }
            return clip;
          })
        );

        const newGridB = state.bankBClipGrid.map((row, li) =>
          row.map((clip, ci) => {
            if (clip?.type === 'synthvision') {
              releaseVJSourceCacheEntry(`vj-${li}-B-${clip.id}`);
              changed = true;
              return null;
            }
            return clip;
          })
        );

        if (!changed) return state;

        const newLayerStatesA = state.layerStates.map((ls) => {
          if (ls.activeClip?.type === 'synthvision') {
            return { ...ls, activeColumn: null, activeClip: null };
          }
          return ls;
        });
        const newLayerStatesB = state.bankBLayerStates.map((ls) => {
          if (ls.activeClip?.type === 'synthvision') {
            return { ...ls, activeColumn: null, activeClip: null };
          }
          return ls;
        });

        return {
          ...state,
          clipGrid: newGridA,
          layerStates: newLayerStatesA,
          bankBClipGrid: newGridB,
          bankBLayerStates: newLayerStatesB,
        };
      });
    },

    // Trigger a clip on the given deck.
    //
    // Behavior depends on `state.quantization`:
    //   'off' → fires instantly (legacy / beginner path, no surprises)
    //   '1/4' .. '4bar' → enqueues to fire on the next matching beat boundary
    //
    // Click-while-already-queued cancels the pending trigger (lets the
    // user re-arm without firing). Bank B triggers work whether or not
    // the crossfader is enabled so users can pre-arm Bank B before flipping.
    triggerClip(layerIndex: number, columnIndex: number, deck: VJDeck = 'A') {
      const state = get({ subscribe });
      const grid = state.quantization;

      // Off → instant path
      if (grid === 'off') {
        immediateTriggerClip(layerIndex, columnIndex, deck);
        return;
      }

      // Validate the cell exists before queuing
      const targetGrid = pickGrid(state, deck);
      const clip = targetGrid[layerIndex]?.[columnIndex];
      if (!clip) return;

      // Click-the-queued-cell-again unqueues it. Lets the user pre-arm and
      // back out without firing.
      const existingIdx = state.pendingTriggers.findIndex(
        p => p.layerIndex === layerIndex && p.columnIndex === columnIndex && p.bank === deck
      );
      if (existingIdx >= 0) {
        update(s => ({
          ...s,
          pendingTriggers: s.pendingTriggers.filter((_, i) => i !== existingIdx),
        }));
        return;
      }

      const fireAt = nextQuantumWallTime(grid);
      const queuedAt = performance.now();
      update(s => ({
        ...s,
        pendingTriggers: [
          ...s.pendingTriggers,
          { id: generateUUID(), layerIndex, columnIndex, bank: deck, fireAt, queuedAt },
        ],
      }));
      ensureQuantTickRunning({ update });
    },

    /** Fire a clip immediately, bypassing quantization. Used by both the
     *  'off' path and by the rAF tick when a queued trigger comes due. */
    triggerClipNow(layerIndex: number, columnIndex: number, deck: VJDeck = 'A') {
      immediateTriggerClip(layerIndex, columnIndex, deck);
    },

    // Trigger an entire column on the given deck (all layers at once)
    triggerColumn(columnIndex: number, deck: VJDeck = 'A') {
      let didTrigger = false;
      const incomingVideos: VJClip[] = [];
      const outgoingVideos: VJClip[] = [];

      // Match single-cell triggering: every incoming video is already
      // rewound and moving before the column swap reaches subscribers.
      const before = get({ subscribe });
      const beforeGrid = pickGrid(before, deck);
      const videosToArm: VJClip[] = [];
      for (let layerIndex = 0; layerIndex < beforeGrid.length; layerIndex++) {
        const clip = beforeGrid[layerIndex]?.[columnIndex];
        if (clip?.type !== 'video') continue;
        const videoEl = ensureClipVideoElement(clip);
        if (videoEl && !isVideoReadyForTrigger(clip, videoEl)) videosToArm.push(clip);
      }
      if (videosToArm.length > 0) {
        void Promise.all(videosToArm.map((clip) => armVideoClipForTrigger(clip)))
          .then(() => vjClipLauncher.triggerColumn(columnIndex, deck))
          .catch((error) => console.warn('[vjClipLauncher] column trigger held; video is not ready:', error));
        return;
      }
      for (let layerIndex = 0; layerIndex < beforeGrid.length; layerIndex++) {
        const clip = beforeGrid[layerIndex]?.[columnIndex];
        if (clip?.type === 'video') prepareVideoClipForTrigger(clip);
      }

      update(state => {
        const targetGrid = pickGrid(state, deck);
        const targetLayerStates = pickLayerStates(state, deck);
        const newLayerStates = targetLayerStates.map((layerState, layerIndex) => {
          const clip = targetGrid[layerIndex]?.[columnIndex];
          if (clip) {
            if (clip.type === 'video') {
              ensureClipVideoElement(clip);
              incomingVideos.push(clip);
            }
            if (layerState.activeClip && layerState.activeClip.id !== clip.id) {
              outgoingVideos.push(layerState.activeClip);
            }
            didTrigger = true;
            return { ...layerState, activeColumn: columnIndex, activeClip: clip };
          }
          if (layerState.activeClip) {
            outgoingVideos.push(layerState.activeClip);
          }
          if (layerState.activeColumn !== null || layerState.activeClip !== null) {
            return { ...layerState, activeColumn: null, activeClip: null };
          }
          return layerState;
        });

        const next = withDeck(state, deck, newLayerStates);
        return { ...next, stoppedAll: false };
      });
      if (didTrigger || outgoingVideos.length > 0) {
        const incomingEls = new Set<HTMLVideoElement>();
        for (const clip of incomingVideos) {
          const videoEl = clip.videoElement || videoElementCache.get(clip.id);
          if (!videoEl) continue;
          incomingEls.add(videoEl);
        }
        for (const clip of outgoingVideos) {
          if (clip.type !== 'video') continue;
          const videoEl = clip.videoElement || videoElementCache.get(clip.id);
          if (!videoEl || incomingEls.has(videoEl)) continue;
          pauseClipRuntime(clip);
        }
      }
      if (didTrigger) {
        keyframeTimeline.seek(0);
        keyframeTimeline.play();
      }
    },

    // Stop all clips on a layer for the given deck
    stopLayer(layerIndex: number, deck: VJDeck = 'A') {
      const before = get({ subscribe });
      pauseClipRuntime(pickLayerStates(before, deck)[layerIndex]?.activeClip);
      update(state => {
        const targetLayerStates = pickLayerStates(state, deck);
        const newLayerStates = [...targetLayerStates];
        newLayerStates[layerIndex] = { ...newLayerStates[layerIndex], activeColumn: null, activeClip: null };
        return withDeck(state, deck, newLayerStates);
      });
    },

    // Stop all clips on BOTH decks — suppresses all VJ output to black.
    // Also flushes the pending-trigger queue so a panic STOP doesn't leave
    // queued clips that fire seconds later when the bar boundary lands.
    stopAll() {
      update(state => {
        for (const layerState of state.layerStates) pauseClipRuntime(layerState.activeClip);
        for (const layerState of state.bankBLayerStates) pauseClipRuntime(layerState.activeClip);
        const newLayerStatesA = state.layerStates.map(ls => ({ ...ls, activeColumn: null, activeClip: null }));
        const newLayerStatesB = state.bankBLayerStates.map(ls => ({ ...ls, activeColumn: null, activeClip: null }));
        return {
          ...state,
          layerStates: newLayerStatesA,
          bankBLayerStates: newLayerStatesB,
          stoppedAll: true,
          pendingTriggers: [],
        };
      });
    },

    /** Set the launch quantization grid. 'off' fires triggers instantly
     *  (beginner default). Any other value queues triggers to the next
     *  matching beat boundary using the active BPM source (audio-anchored
     *  when audio is detecting beats, virtual-clock from BPM otherwise).
     *
     *  Switching TO 'off' flushes the pending-trigger queue — otherwise
     *  triggers queued at the previous grid would still fire seconds
     *  later, looking like a ghost. Switching BETWEEN non-off grids
     *  preserves the queue so users can shift from 1bar → 4bar mid-set
     *  without re-arming. */
    setQuantization(grid: QuantizationGrid) {
      update(state => ({
        ...state,
        quantization: grid,
        pendingTriggers: grid === 'off' ? [] : state.pendingTriggers,
      }));
    },

    /** Cancel every queued trigger. Called by panic shortcuts and by
     *  stopAll above. Pending triggers are non-destructive (no clips
     *  have fired yet) so this is always safe. */
    clearPendingTriggers() {
      update(state => state.pendingTriggers.length === 0 ? state : { ...state, pendingTriggers: [] });
    },

    /** Cancel a specific queued trigger — for the cell-right-click "Cancel
     *  queued" action and as the toggle-off path when the user clicks a
     *  queued cell again (handled inline in triggerClip too). */
    cancelPendingTrigger(layerIndex: number, columnIndex: number, deck: VJDeck = 'A') {
      update(state => ({
        ...state,
        pendingTriggers: state.pendingTriggers.filter(
          p => !(p.layerIndex === layerIndex && p.columnIndex === columnIndex && p.bank === deck)
        ),
      }));
    },

    // Set layer opacity for the given deck
    setLayerOpacity(layerIndex: number, opacity: number, deck: VJDeck = 'A') {
      update(state => {
        const targetLayerStates = pickLayerStates(state, deck);
        const newLayerStates = [...targetLayerStates];
        newLayerStates[layerIndex] = { ...newLayerStates[layerIndex], opacity: Math.max(0, Math.min(1, opacity)) };
        return withDeck(state, deck, newLayerStates);
      });
    },

    // Set layer blend mode for the given deck
    setLayerBlendMode(layerIndex: number, blendMode: BlendMode, deck: VJDeck = 'A') {
      update(state => {
        const targetLayerStates = pickLayerStates(state, deck);
        const newLayerStates = [...targetLayerStates];
        newLayerStates[layerIndex] = { ...newLayerStates[layerIndex], blendMode };
        return withDeck(state, deck, newLayerStates);
      });
    },

    // Toggle layer solo for the given deck
    toggleLayerSolo(layerIndex: number, deck: VJDeck = 'A') {
      update(state => {
        const targetLayerStates = pickLayerStates(state, deck);
        const newLayerStates = [...targetLayerStates];
        newLayerStates[layerIndex] = { ...newLayerStates[layerIndex], solo: !newLayerStates[layerIndex].solo };
        return withDeck(state, deck, newLayerStates);
      });
    },

    // Toggle layer mute for the given deck
    toggleLayerMute(layerIndex: number, deck: VJDeck = 'A') {
      update(state => {
        const targetLayerStates = pickLayerStates(state, deck);
        const newLayerStates = [...targetLayerStates];
        newLayerStates[layerIndex] = { ...newLayerStates[layerIndex], mute: !newLayerStates[layerIndex].mute };
        return withDeck(state, deck, newLayerStates);
      });
    },

    // Set master opacity
    setMasterOpacity(opacity: number) {
      update(state => ({ ...state, masterOpacity: Math.max(0, Math.min(1, opacity)) }));
    },

    // Toggle live mode
    toggleLive() {
      update(state => ({ ...state, isLive: !state.isLive }));
    },

    // Set live mode
    setLive(isLive: boolean) {
      update(state => ({ ...state, isLive }));
    },

    // Add effect to layer on the given deck
    addLayerEffect(layerIndex: number, effect: Effect, deck: VJDeck = 'A') {
      update(state => {
        const targetLayerStates = pickLayerStates(state, deck);
        const newLayerStates = [...targetLayerStates];
        newLayerStates[layerIndex] = {
          ...newLayerStates[layerIndex],
          effects: [...newLayerStates[layerIndex].effects, effect]
        };
        return withDeck(state, deck, newLayerStates);
      });
    },

    // Remove effect from layer on the given deck
    removeLayerEffect(layerIndex: number, effectId: string, deck: VJDeck = 'A') {
      update(state => {
        const targetLayerStates = pickLayerStates(state, deck);
        const newLayerStates = [...targetLayerStates];
        newLayerStates[layerIndex] = {
          ...newLayerStates[layerIndex],
          effects: newLayerStates[layerIndex].effects.filter(e => e.id !== effectId)
        };
        return withDeck(state, deck, newLayerStates);
      });
    },

    // Toggle effect enabled on the given deck
    toggleLayerEffect(layerIndex: number, effectId: string, deck: VJDeck = 'A') {
      update(state => {
        const targetLayerStates = pickLayerStates(state, deck);
        const newLayerStates = [...targetLayerStates];
        newLayerStates[layerIndex] = {
          ...newLayerStates[layerIndex],
          effects: newLayerStates[layerIndex].effects.map(e =>
            e.id === effectId ? { ...e, enabled: !e.enabled } : e
          )
        };
        return withDeck(state, deck, newLayerStates);
      });
    },

    // Update a single shader uniform value on the active clip of a layer (per deck)
    updateActiveClipShaderValue(layerIndex: number, paramName: string, value: any, deck: VJDeck = 'A') {
      update(state => {
        const targetLayerStates = pickLayerStates(state, deck);
        const targetGrid = pickGrid(state, deck);
        const newLayerStates = [...targetLayerStates];
        const activeClip = newLayerStates[layerIndex]?.activeClip;
        if (!activeClip) return state;

        const newClip = {
          ...activeClip,
          shaderValues: { ...(activeClip.shaderValues || {}), [paramName]: value },
        };
        newLayerStates[layerIndex] = { ...newLayerStates[layerIndex], activeClip: newClip };

        // Also update the clip in the deck's grid if it exists there
        const newGrid = targetGrid.map(row => [...row]);
        for (let col = 0; col < state.numColumns; col++) {
          const gridClip = newGrid[layerIndex]?.[col];
          if (gridClip && gridClip.id === activeClip.id) {
            newGrid[layerIndex][col] = newClip;
          }
        }

        return withDeck(state, deck, newLayerStates, newGrid);
      });
      // Auto-record keyframe if track is armed (keyed per-clip so switching clips shows independent keyframes)
      const s = get({ subscribe });
      const ls = deck === 'B' ? s.bankBLayerStates : s.layerStates;
      const activeClipId = ls[layerIndex]?.activeClip?.id;
      if (activeClipId && (typeof value === 'number' || typeof value === 'boolean')) {
        keyframeTimeline.autoRecord(
          `vj-${activeClipId}`,
          `shader:${paramName}`,
          value,
          paramName,
          typeof value === 'boolean' ? 'boolean' : 'number'
        );
      }
    },

    // Batch-update multiple shader values (modulation engine HOT PATH —
    // runs per audio tick, up to 60Hz per modulated layer). Mutates the
    // active clip's shaderValues IN PLACE and does NOT tick the store:
    //   • Rendering still updates — updateShaderTextures re-reads
    //     source.shaderValues every frame, and the cached VJ render
    //     source points at this exact object (vjOutputLayers re-points
    //     it on every derived run).
    //   • The grid cell holds the same clip object as activeClip, so
    //     grid state stays consistent by identity.
    //   • UI sliders show the live value via the modulation ghost rAF
    //     loop (getModulatedValue), not store reactivity.
    // The old implementation cloned layerStates + the ENTIRE clip grid
    // and woke every store subscriber on each tick — 120+ full-grid
    // clones/second during an audio-reactive set with 2 modulated
    // layers, all garbage.
    batchUpdateShaderValues(layerIndex: number, values: Record<string, number>, deck: VJDeck = 'A') {
      const state = get({ subscribe });
      const activeClip = pickLayerStates(state, deck)[layerIndex]?.activeClip;
      if (!activeClip) return;
      if (!activeClip.shaderValues) {
        // First touch: the cached render source may hold a detached {}
        // (vjOutputLayers substitutes one when shaderValues is missing).
        // Create the object, then tick the store once so the derived
        // layer re-points its source at it.
        activeClip.shaderValues = { ...values };
        update(s => s);
        return;
      }
      Object.assign(activeClip.shaderValues, values);
    },

    // Update splat content on the active clip of a layer (per deck)
    updateActiveClipSplatContent(layerIndex: number, updates: Partial<SplatContent>, deck: VJDeck = 'A') {
      update(state => {
        const targetLayerStates = pickLayerStates(state, deck);
        const targetGrid = pickGrid(state, deck);
        const newLayerStates = [...targetLayerStates];
        if (layerIndex < 0 || layerIndex >= newLayerStates.length) return state;
        const activeClip = newLayerStates[layerIndex]?.activeClip;
        if (!activeClip || activeClip.type !== 'splat') return state;

        const newClip = {
          ...activeClip,
          splatContent: { ...(activeClip.splatContent || createDefaultSplatContent()), ...updates },
        };
        newLayerStates[layerIndex] = { ...newLayerStates[layerIndex], activeClip: newClip };

        const newGrid = targetGrid.map(row => [...row]);
        for (let col = 0; col < state.numColumns; col++) {
          const gridClip = newGrid[layerIndex]?.[col];
          if (gridClip && gridClip.id === activeClip.id) {
            newGrid[layerIndex][col] = newClip;
          }
        }

        return withDeck(state, deck, newLayerStates, newGrid);
      });
    },

    // Update model3d content on the active clip of a layer (per deck)
    updateActiveClipModel3DContent(layerIndex: number, updates: Partial<Model3DContent>, deck: VJDeck = 'A') {
      update(state => {
        const targetLayerStates = pickLayerStates(state, deck);
        const targetGrid = pickGrid(state, deck);
        const newLayerStates = [...targetLayerStates];
        if (layerIndex < 0 || layerIndex >= newLayerStates.length) return state;
        const activeClip = newLayerStates[layerIndex]?.activeClip;
        if (!activeClip || activeClip.type !== 'model3d') return state;

        const newClip = {
          ...activeClip,
          model3dContent: { ...(activeClip.model3dContent || createDefaultModel3DContent()), ...updates },
        };
        newLayerStates[layerIndex] = { ...newLayerStates[layerIndex], activeClip: newClip };

        const newGrid = targetGrid.map(row => [...row]);
        for (let col = 0; col < state.numColumns; col++) {
          const gridClip = newGrid[layerIndex]?.[col];
          if (gridClip && gridClip.id === activeClip.id) {
            newGrid[layerIndex][col] = newClip;
          }
        }

        return withDeck(state, deck, newLayerStates, newGrid);
      });
    },

    updateActiveClipGPUContent(layerIndex: number, updates: Partial<GPULayerContent>, deck: VJDeck = 'A') {
      update(state => {
        const targetLayerStates = pickLayerStates(state, deck);
        const targetGrid = pickGrid(state, deck);
        const newLayerStates = [...targetLayerStates];
        if (layerIndex < 0 || layerIndex >= newLayerStates.length) return state;
        const activeClip = newLayerStates[layerIndex]?.activeClip;
        if (!activeClip || activeClip.type !== 'gpu') return state;

        const newClip = {
          ...activeClip,
          gpuLayerContent: { ...(activeClip.gpuLayerContent || createDefaultGPULayerContent()), ...updates },
        };
        newLayerStates[layerIndex] = { ...newLayerStates[layerIndex], activeClip: newClip };

        const newGrid = targetGrid.map(row => [...row]);
        for (let col = 0; col < state.numColumns; col++) {
          const gridClip = newGrid[layerIndex]?.[col];
          if (gridClip?.id === activeClip.id) newGrid[layerIndex][col] = newClip;
        }

        const next = withDeck(state, deck, newLayerStates, newGrid);
        return { ...next, blocks: blocksWithDeckGrid(state, deck, newGrid) };
      });
    },

    updateActiveClipTextContent(layerIndex: number, updates: Partial<TextContent>, deck: VJDeck = 'A') {
      update(state => {
        const targetLayerStates = pickLayerStates(state, deck);
        const targetGrid = pickGrid(state, deck);
        const newLayerStates = [...targetLayerStates];
        if (layerIndex < 0 || layerIndex >= newLayerStates.length) return state;
        const activeClip = newLayerStates[layerIndex]?.activeClip;
        if (!activeClip || activeClip.type !== 'text') return state;

        const newClip = {
          ...activeClip,
          textContent: { ...(activeClip.textContent || createDefaultTextContent()), ...updates },
        };
        newLayerStates[layerIndex] = { ...newLayerStates[layerIndex], activeClip: newClip };

        const newGrid = targetGrid.map(row => [...row]);
        for (let col = 0; col < state.numColumns; col++) {
          const gridClip = newGrid[layerIndex]?.[col];
          if (gridClip?.id === activeClip.id) newGrid[layerIndex][col] = newClip;
        }

        const next = withDeck(state, deck, newLayerStates, newGrid);
        return { ...next, blocks: blocksWithDeckGrid(state, deck, newGrid) };
      });
    },

    // Update video playback props plus shared visual transform props on the
    // active clip of a layer. Still images use the same transform fields as
    // videos; playback fields are ignored unless the clip is a video.
    updateActiveClipVideoProps(layerIndex: number, updates: Partial<VJVideoPlaybackProps & VJTransformProps>, deck: VJDeck = 'A') {
      update(state => {
        const targetLayerStates = pickLayerStates(state, deck);
        const targetGrid = pickGrid(state, deck);
        const newLayerStates = [...targetLayerStates];
        if (layerIndex < 0 || layerIndex >= newLayerStates.length) return state;
        const activeClip = newLayerStates[layerIndex]?.activeClip;
        if (!isTransformableMediaClip(activeClip)) return state;

        const allowedUpdates: Partial<VJVideoPlaybackProps & VJTransformProps> = {};
        const transformKeys: (keyof VJTransformProps)[] = ['zoom', 'fit', 'anchorX', 'anchorY', 'rotation', 'opacity', 'mirrorX'];
        for (const key of transformKeys) {
          if (key in updates) (allowedUpdates as any)[key] = (updates as any)[key];
        }
        if (activeClip.type === 'video') {
          const playbackKeys: (keyof VJVideoPlaybackProps)[] = ['playbackMode', 'playbackRate', 'playbackSyncBeats', 'trimStart', 'trimEnd', 'isPlaying'];
          for (const key of playbackKeys) {
            if (key in updates) (allowedUpdates as any)[key] = (updates as any)[key];
          }
        }

        const newClip = { ...activeClip, ...allowedUpdates };
        if (newClip.type === 'video' && newClip.videoElement) {
          syncTrimmedVideoPlayback(newClip.videoElement, newClip);
        }
        newLayerStates[layerIndex] = { ...newLayerStates[layerIndex], activeClip: newClip };

        // Mirror the change into the grid for any cells whose clip.id matches
        // (handles the case where the same source has been triggered into
        // multiple columns of the same row).
        const newGrid = targetGrid.map(row => [...row]);
        for (let col = 0; col < state.numColumns; col++) {
          const gridClip = newGrid[layerIndex]?.[col];
          if (gridClip && gridClip.id === activeClip.id) {
            newGrid[layerIndex][col] = newClip;
          }
        }

        // Persist into the active block too.
        const newBlocks = blocksWithDeckGrid(state, deck, newGrid);
        const next = withDeck(state, deck, newLayerStates, newGrid);
        return { ...next, blocks: newBlocks };
      });
    },

    // Update splat/model3d content on a specific clip in the grid (for file loading) — per deck.
    // Writes through to the active block so swapping blocks preserves the loaded file.
    updateClipSplatContent(layerIndex: number, columnIndex: number, updates: Partial<SplatContent>, deck: VJDeck = 'A') {
      update(state => {
        const targetGrid = pickGrid(state, deck);
        const targetLayerStates = pickLayerStates(state, deck);
        const newGrid = targetGrid.map(row => [...row]);
        const clip = newGrid[layerIndex]?.[columnIndex];
        if (!clip || clip.type !== 'splat') return state;

        const newClip = {
          ...clip,
          splatContent: { ...(clip.splatContent || createDefaultSplatContent()), ...updates },
        };
        newGrid[layerIndex][columnIndex] = newClip;

        const newLayerStates = [...targetLayerStates];
        if (newLayerStates[layerIndex]?.activeClip?.id === clip.id) {
          newLayerStates[layerIndex] = { ...newLayerStates[layerIndex], activeClip: newClip };
        }

        const newBlocks = blocksWithDeckGrid(state, deck, newGrid);
        const next = withDeck(state, deck, newLayerStates, newGrid);
        return { ...next, blocks: newBlocks };
      });
    },

    updateClipModel3DContent(layerIndex: number, columnIndex: number, updates: Partial<Model3DContent>, deck: VJDeck = 'A') {
      update(state => {
        const targetGrid = pickGrid(state, deck);
        const targetLayerStates = pickLayerStates(state, deck);
        const newGrid = targetGrid.map(row => [...row]);
        const clip = newGrid[layerIndex]?.[columnIndex];
        if (!clip || clip.type !== 'model3d') return state;

        const newClip = {
          ...clip,
          model3dContent: { ...(clip.model3dContent || createDefaultModel3DContent()), ...updates },
        };
        newGrid[layerIndex][columnIndex] = newClip;

        const newLayerStates = [...targetLayerStates];
        if (newLayerStates[layerIndex]?.activeClip?.id === clip.id) {
          newLayerStates[layerIndex] = { ...newLayerStates[layerIndex], activeClip: newClip };
        }

        const newBlocks = blocksWithDeckGrid(state, deck, newGrid);
        const next = withDeck(state, deck, newLayerStates, newGrid);
        return { ...next, blocks: newBlocks };
      });
    },

    updateClipEffectSource(layerIndex: number, columnIndex: number, effectSource: any, deck: VJDeck = 'A') {
      update(state => {
        const targetGrid = pickGrid(state, deck);
        const targetLayerStates = pickLayerStates(state, deck);
        const newGrid = targetGrid.map(row => [...row]);
        const clip = newGrid[layerIndex]?.[columnIndex];
        if (!clip || clip.type !== 'effect') return state;

        const newClip = { ...clip, effectSource };
        newGrid[layerIndex][columnIndex] = newClip;

        const newLayerStates = [...targetLayerStates];
        if (newLayerStates[layerIndex]?.activeClip?.id === clip.id) {
          newLayerStates[layerIndex] = { ...newLayerStates[layerIndex], activeClip: newClip };
        }

        const newBlocks = blocksWithDeckGrid(state, deck, newGrid);
        const next = withDeck(state, deck, newLayerStates, newGrid);
        return { ...next, blocks: newBlocks };
      });
    },

    // Update effect params on a layer of the given deck
    updateLayerEffectParams(layerIndex: number, effectId: string, params: Record<string, any>, deck: VJDeck = 'A') {
      update(state => {
        const targetLayerStates = pickLayerStates(state, deck);
        const newLayerStates = [...targetLayerStates];
        newLayerStates[layerIndex] = {
          ...newLayerStates[layerIndex],
          effects: newLayerStates[layerIndex].effects.map(e =>
            e.id === effectId ? { ...e, params: { ...e.params, ...params } } : e
          )
        };
        return withDeck(state, deck, newLayerStates);
      });
      // Auto-record keyframes for any armed effect parameter tracks (keyed per-clip)
      const sFx = get({ subscribe });
      const ls = deck === 'B' ? sFx.bankBLayerStates : sFx.layerStates;
      const activeClipIdFx = ls[layerIndex]?.activeClip?.id;
      if (activeClipIdFx) {
        for (const [paramName, value] of Object.entries(params)) {
          if (typeof value !== 'number' && typeof value !== 'boolean') continue;
          const trackKey = `fx:${effectId}:${paramName}`;
          keyframeTimeline.autoRecord(
            `vj-${activeClipIdFx}`,
            trackKey,
            value,
            paramName,
            typeof value === 'boolean' ? 'boolean' : 'number'
          );
        }
      }
    },

    // ========== Composition Effects ==========

    addCompositionEffect(effect: Effect) {
      update(state => ({
        ...state,
        compositionEffects: [...state.compositionEffects, effect]
      }));
    },

    removeCompositionEffect(effectId: string) {
      update(state => ({
        ...state,
        compositionEffects: state.compositionEffects.filter(e => e.id !== effectId)
      }));
    },

    toggleCompositionEffect(effectId: string) {
      update(state => ({
        ...state,
        compositionEffects: state.compositionEffects.map(e =>
          e.id === effectId ? { ...e, enabled: !e.enabled } : e
        )
      }));
    },

    updateCompositionEffectParams(effectId: string, params: Record<string, any>) {
      update(state => ({
        ...state,
        compositionEffects: state.compositionEffects.map(e =>
          e.id === effectId ? { ...e, params: { ...e.params, ...params } } : e
        )
      }));
    },

    // ========== Clip Effects ==========

    addClipEffect(layerIndex: number, columnIndex: number, effect: Effect, deck: VJDeck = 'A') {
      update(state => {
        const targetGrid = pickGrid(state, deck);
        const targetLayerStates = pickLayerStates(state, deck);
        const newGrid = targetGrid.map(row => [...row]);
        const clip = newGrid[layerIndex]?.[columnIndex];
        if (!clip) return state;
        newGrid[layerIndex][columnIndex] = {
          ...clip,
          effects: [...(clip.effects || []), effect]
        };
        const newLayerStates = [...targetLayerStates];
        if (newLayerStates[layerIndex].activeClip?.id === clip.id) {
          newLayerStates[layerIndex] = {
            ...newLayerStates[layerIndex],
            activeClip: newGrid[layerIndex][columnIndex]
          };
        }
        const newBlocks = blocksWithDeckGrid(state, deck, newGrid);
        if (deck === 'A') {
          return { ...state, clipGrid: newGrid, layerStates: newLayerStates, blocks: newBlocks };
        }
        return { ...state, bankBClipGrid: newGrid, bankBLayerStates: newLayerStates, blocks: newBlocks };
      });
    },

    removeClipEffect(layerIndex: number, columnIndex: number, effectId: string, deck: VJDeck = 'A') {
      update(state => {
        const targetGrid = pickGrid(state, deck);
        const targetLayerStates = pickLayerStates(state, deck);
        const newGrid = targetGrid.map(row => [...row]);
        const clip = newGrid[layerIndex]?.[columnIndex];
        if (!clip) return state;
        newGrid[layerIndex][columnIndex] = {
          ...clip,
          effects: (clip.effects || []).filter(e => e.id !== effectId)
        };
        const newLayerStates = [...targetLayerStates];
        if (newLayerStates[layerIndex].activeClip?.id === clip.id) {
          newLayerStates[layerIndex] = {
            ...newLayerStates[layerIndex],
            activeClip: newGrid[layerIndex][columnIndex]
          };
        }
        const newBlocks = blocksWithDeckGrid(state, deck, newGrid);
        if (deck === 'A') {
          return { ...state, clipGrid: newGrid, layerStates: newLayerStates, blocks: newBlocks };
        }
        return { ...state, bankBClipGrid: newGrid, bankBLayerStates: newLayerStates, blocks: newBlocks };
      });
    },

    toggleClipEffect(layerIndex: number, columnIndex: number, effectId: string, deck: VJDeck = 'A') {
      update(state => {
        const targetGrid = pickGrid(state, deck);
        const targetLayerStates = pickLayerStates(state, deck);
        const newGrid = targetGrid.map(row => [...row]);
        const clip = newGrid[layerIndex]?.[columnIndex];
        if (!clip) return state;
        newGrid[layerIndex][columnIndex] = {
          ...clip,
          effects: (clip.effects || []).map(e =>
            e.id === effectId ? { ...e, enabled: !e.enabled } : e
          )
        };
        const newLayerStates = [...targetLayerStates];
        if (newLayerStates[layerIndex].activeClip?.id === clip.id) {
          newLayerStates[layerIndex] = {
            ...newLayerStates[layerIndex],
            activeClip: newGrid[layerIndex][columnIndex]
          };
        }
        const newBlocks = blocksWithDeckGrid(state, deck, newGrid);
        if (deck === 'A') {
          return { ...state, clipGrid: newGrid, layerStates: newLayerStates, blocks: newBlocks };
        }
        return { ...state, bankBClipGrid: newGrid, bankBLayerStates: newLayerStates, blocks: newBlocks };
      });
    },

    /**
     * Update a single shader-input value on a grid clip without launching it.
     * Used by the clip preview panel so users can dial in shader params
     * before triggering. Mirrors any matching active layer (same clip id)
     * so the change shows up live if the clip is already playing. Per deck.
     */
    updateClipShaderValue(layerIndex: number, columnIndex: number, name: string, value: any, deck: VJDeck = 'A') {
      update(state => {
        const targetGrid = pickGrid(state, deck);
        const targetLayerStates = pickLayerStates(state, deck);
        const newGrid = targetGrid.map(row => [...row]);
        const clip = newGrid[layerIndex]?.[columnIndex];
        if (!clip) return state;
        const updatedClip = {
          ...clip,
          shaderValues: { ...(clip.shaderValues || {}), [name]: value },
        };
        newGrid[layerIndex][columnIndex] = updatedClip;
        const newLayerStates = [...targetLayerStates];
        if (newLayerStates[layerIndex].activeClip?.id === clip.id) {
          newLayerStates[layerIndex] = {
            ...newLayerStates[layerIndex],
            activeClip: updatedClip,
          };
        }
        const newBlocks = blocksWithDeckGrid(state, deck, newGrid);
        if (deck === 'A') {
          return { ...state, clipGrid: newGrid, layerStates: newLayerStates, blocks: newBlocks };
        }
        return { ...state, bankBClipGrid: newGrid, bankBLayerStates: newLayerStates, blocks: newBlocks };
      });
    },

    /** Set or clear the Auto playhead config for a single param on a
     *  VJ-layer-state effect. Effects live on the layer slot (not the
     *  clip) so the routing is by (layerIndex, bank, effectId). The
     *  autoEngine reads paramAuto from layerStates / bankBLayerStates
     *  and writes resolved values via updateLayerEffectParams. */
    setLayerEffectParamAuto(layerIndex: number, effectId: string, paramName: string, auto: import('../types').AutoConfig | null, bank: VJDeck = 'A') {
      update(state => {
        const targetStates = bank === 'B' ? state.bankBLayerStates : state.layerStates;
        if (!targetStates[layerIndex]) return state;
        const updatedEffects = targetStates[layerIndex].effects.map(e => {
          if (e.id !== effectId) return e;
          const nextAuto: Record<string, import('../types').AutoConfig> = { ...(e.paramAuto ?? {}) };
          if (auto === null) {
            delete nextAuto[paramName];
          } else {
            nextAuto[paramName] = auto;
          }
          const hasAny = Object.keys(nextAuto).length > 0;
          const { paramAuto: _drop, ...rest } = e;
          return hasAny ? { ...rest, paramAuto: nextAuto } : rest;
        });
        const newStates = [...targetStates];
        newStates[layerIndex] = { ...newStates[layerIndex], effects: updatedEffects };
        if (bank === 'B') {
          return { ...state, bankBLayerStates: newStates };
        }
        return { ...state, layerStates: newStates };
      });
    },

    /** Set or clear the Auto playhead config for a single shader-param
     *  on a clip. Walks every grid + layerState by clip id so the
     *  sidecar updates wherever the clip lives (grid slot, active deck
     *  slot, both decks if duplicated). Caller doesn't need to know
     *  where the clip is sitting — this is paired with the autoEngine
     *  which reads `clip.shaderValueAuto` from active deck slots. */
    setClipShaderValueAuto(clipId: string, paramName: string, auto: import('../types').AutoConfig | null) {
      update(state => {
        const applyToClip = (clip: VJClip): VJClip => {
          const nextAuto: Record<string, import('../types').AutoConfig> = { ...(clip.shaderValueAuto ?? {}) };
          if (auto === null) {
            delete nextAuto[paramName];
          } else {
            nextAuto[paramName] = auto;
          }
          const hasAny = Object.keys(nextAuto).length > 0;
          const { shaderValueAuto: _drop, ...rest } = clip;
          return hasAny ? { ...rest, shaderValueAuto: nextAuto } : rest;
        };
        const mapGrid = (grid: (VJClip | null)[][]) => grid.map(row =>
          row.map(c => (c && c.id === clipId ? applyToClip(c) : c))
        );
        const mapStates = (states: any[]) => states.map(ls => {
          if (!ls?.activeClip || ls.activeClip.id !== clipId) return ls;
          return { ...ls, activeClip: applyToClip(ls.activeClip) };
        });
        return {
          ...state,
          clipGrid: mapGrid(state.clipGrid),
          bankBClipGrid: mapGrid(state.bankBClipGrid),
          layerStates: mapStates(state.layerStates),
          bankBLayerStates: mapStates(state.bankBLayerStates),
        };
      });
    },

    updateClipEffectParams(layerIndex: number, columnIndex: number, effectId: string, params: Record<string, any>, deck: VJDeck = 'A') {
      update(state => {
        const targetGrid = pickGrid(state, deck);
        const targetLayerStates = pickLayerStates(state, deck);
        const newGrid = targetGrid.map(row => [...row]);
        const clip = newGrid[layerIndex]?.[columnIndex];
        if (!clip) return state;
        newGrid[layerIndex][columnIndex] = {
          ...clip,
          effects: (clip.effects || []).map(e =>
            e.id === effectId ? { ...e, params: { ...e.params, ...params } } : e
          )
        };
        const newLayerStates = [...targetLayerStates];
        if (newLayerStates[layerIndex].activeClip?.id === clip.id) {
          newLayerStates[layerIndex] = {
            ...newLayerStates[layerIndex],
            activeClip: newGrid[layerIndex][columnIndex]
          };
        }
        const newBlocks = blocksWithDeckGrid(state, deck, newGrid);
        if (deck === 'A') {
          return { ...state, clipGrid: newGrid, layerStates: newLayerStates, blocks: newBlocks };
        }
        return { ...state, bankBClipGrid: newGrid, bankBLayerStates: newLayerStates, blocks: newBlocks };
      });
    },

    // ========== Block Management ==========

    // Add a new block
    addBlock(name?: string) {
      update(state => {
        const blockNum = state.blocks.length + 1;
        const newBlock = createNewBlock(name || `Block ${blockNum}`, state.numLayers, state.numColumns);
        return {
          ...state,
          blocks: [...state.blocks, newBlock],
        };
      });
    },

    // Switch to a different block (does NOT interrupt playing clips).
    // Restores BOTH Bank A's clipGrid AND Bank B's bankBClipGrid from the
    // block — each block is a complete A+B scene.
    setActiveBlock(blockId: string) {
      update(state => {
        const block = state.blocks.find(b => b.id === blockId);
        if (!block) return state;

        // Lazy-init: older blocks (loaded from pre-v0.3.8 saves) won't have
        // a bankBClipGrid. Materialize an empty one so the dual-deck UI has
        // something to render to.
        const blockBankB = block.bankBClipGrid
          ?? createEmptyClipGrid(state.numLayers, state.numColumns);

        // Update activeColumn for each layer based on whether the activeClip
        // exists in this block's grid (same logic for both banks). When
        // we find a match we ALSO refresh the layer's activeClip pointer
        // to the matching cell from the NEW block — otherwise the layer
        // keeps a reference to the old block's clip object, and any
        // edits the user made to the new block's version of that clip
        // (different shaderValues, different effect chain) get ignored
        // because the renderer reads from layerState.activeClip, not
        // the grid.
        const reconcileColumn = (
          layerStates: VJLayerState[],
          grid: (VJClip | null)[][]
        ) => layerStates.map((layerState, layerIndex) => {
          if (!layerState.activeClip) {
            return { ...layerState, activeColumn: null };
          }
          const row = grid[layerIndex] || [];
          const columnIndex = row.findIndex(
            clip => clip && clip.id === layerState.activeClip!.id
          );
          if (columnIndex < 0) {
            return { ...layerState, activeColumn: null };
          }
          // Re-bind activeClip to the new block's version of this clip.
          return {
            ...layerState,
            activeColumn: columnIndex,
            activeClip: row[columnIndex] || layerState.activeClip,
          };
        });

        const newLayerStates = reconcileColumn(state.layerStates, block.clipGrid);
        const newBankBLayerStates = reconcileColumn(state.bankBLayerStates, blockBankB);

        return {
          ...state,
          activeBlockId: blockId,
          clipGrid: block.clipGrid.map(row => [...row]),
          bankBClipGrid: blockBankB.map(row => [...row]),
          layerStates: newLayerStates,
          bankBLayerStates: newBankBLayerStates,
        };
      });
    },

    // Rename a block
    renameBlock(blockId: string, newName: string) {
      update(state => {
        const newBlocks = state.blocks.map(block =>
          block.id === blockId ? { ...block, name: newName } : block
        );
        return { ...state, blocks: newBlocks };
      });
    },

    // Reorder blocks without changing their saved grids. Used by the VJ
    // block tab strip so performers can arrange scenes in show order.
    reorderBlocks(fromIndex: number, toIndex: number) {
      update(state => {
        if (fromIndex < 0 || fromIndex >= state.blocks.length) return state;
        if (toIndex < 0 || toIndex >= state.blocks.length) return state;
        if (fromIndex === toIndex) return state;
        const nextBlocks = [...state.blocks];
        const [moved] = nextBlocks.splice(fromIndex, 1);
        nextBlocks.splice(toIndex, 0, moved);
        return { ...state, blocks: nextBlocks };
      });
    },

    // Delete a block (cannot delete the last one)
    deleteBlock(blockId: string) {
      update(state => {
        if (state.blocks.length <= 1) return state; // Keep at least one block

        const newBlocks = state.blocks.filter(b => b.id !== blockId);

        // If deleting the active block, switch to the first remaining block
        let newActiveBlockId = state.activeBlockId;
        let newClipGrid = state.clipGrid;

        if (state.activeBlockId === blockId) {
          const firstBlock = newBlocks[0];
          newActiveBlockId = firstBlock.id;
          newClipGrid = firstBlock.clipGrid.map(row => [...row]);
        }

        return {
          ...state,
          blocks: newBlocks,
          activeBlockId: newActiveBlockId,
          clipGrid: newClipGrid,
        };
      });
    },

    // Duplicate a block — copies BOTH banks so an A+B scene clones intact.
    duplicateBlock(blockId: string) {
      update(state => {
        const blockToDuplicate = state.blocks.find(b => b.id === blockId);
        if (!blockToDuplicate) return state;

        const sourceBankB = blockToDuplicate.bankBClipGrid
          ?? createEmptyClipGrid(state.numLayers, state.numColumns);

        const newBlock: VJBlock = {
          id: generateUUID(),
          name: `${blockToDuplicate.name} (copy)`,
          clipGrid: blockToDuplicate.clipGrid.map(row => [...row]),
          bankBClipGrid: sourceBankB.map(row => [...row]),
        };

        return {
          ...state,
          blocks: [...state.blocks, newBlock],
        };
      });
    },

    // Reorder layers (drag and drop). Layer count is shared between decks
    // so a row swap reorders BOTH banks' layerStates and clip grids in lockstep
    // — across ALL blocks — keeps the visual layout symmetric and predictable.
    reorderLayers(fromIndex: number, toIndex: number) {
      update(state => {
        if (fromIndex === toIndex) return state;
        if (fromIndex < 0 || fromIndex >= state.numLayers) return state;
        if (toIndex < 0 || toIndex >= state.numLayers) return state;

        // Bank A live state
        const newLayerStates = [...state.layerStates];
        const [movedLayerState] = newLayerStates.splice(fromIndex, 1);
        newLayerStates.splice(toIndex, 0, movedLayerState);

        const newClipGrid = [...state.clipGrid];
        const [movedRow] = newClipGrid.splice(fromIndex, 1);
        newClipGrid.splice(toIndex, 0, movedRow);

        // Bank B live state
        const newBankBLayerStates = [...state.bankBLayerStates];
        const [movedB] = newBankBLayerStates.splice(fromIndex, 1);
        newBankBLayerStates.splice(toIndex, 0, movedB);

        const newBankBClipGrid = [...state.bankBClipGrid];
        const [movedBRow] = newBankBClipGrid.splice(fromIndex, 1);
        newBankBClipGrid.splice(toIndex, 0, movedBRow);

        // Reorder each block's BOTH grids so the per-block snapshot stays
        // consistent with the live row order.
        const newBlocks = state.blocks.map(block => {
          const blockA = [...block.clipGrid];
          const [aRow] = blockA.splice(fromIndex, 1);
          blockA.splice(toIndex, 0, aRow);

          const sourceB = block.bankBClipGrid ?? createEmptyClipGrid(state.numLayers, state.numColumns);
          const blockB = [...sourceB];
          const [bRow] = blockB.splice(fromIndex, 1);
          blockB.splice(toIndex, 0, bRow);

          return { ...block, clipGrid: blockA, bankBClipGrid: blockB };
        });

        return {
          ...state,
          layerStates: newLayerStates,
          clipGrid: newClipGrid,
          blocks: newBlocks,
          bankBLayerStates: newBankBLayerStates,
          bankBClipGrid: newBankBClipGrid,
        };
      });
    },

    // ========== Dynamic Layer/Column Management ==========

    // Add a new layer (row) to BOTH banks across ALL blocks so the dual-deck
    // UI stays symmetric and switching blocks doesn't surface mismatched dims.
    addLayer() {
      update(state => {
        if (state.numLayers >= MAX_VJ_LAYERS) return state;

        const newNumLayers = state.numLayers + 1;
        const cols = state.numColumns;

        // Each block grows its A and B grids together.
        const newBlocks = state.blocks.map(block => ({
          ...block,
          clipGrid: [...block.clipGrid, Array(cols).fill(null)],
          bankBClipGrid: [
            ...(block.bankBClipGrid ?? createEmptyClipGrid(state.numLayers, cols)),
            Array(cols).fill(null),
          ],
        }));

        const newClipGrid = [...state.clipGrid, Array(cols).fill(null)];
        const newBankBClipGrid = [...state.bankBClipGrid, Array(cols).fill(null)];
        const newLayerStates = [...state.layerStates, createDefaultLayerState()];
        const newBankBLayerStates = [...state.bankBLayerStates, createDefaultLayerState()];

        return {
          ...state,
          numLayers: newNumLayers,
          clipGrid: newClipGrid,
          blocks: newBlocks,
          layerStates: newLayerStates,
          bankBClipGrid: newBankBClipGrid,
          bankBLayerStates: newBankBLayerStates,
        };
      });
    },

    // Remove a layer (default: last) from BOTH banks across ALL blocks.
    removeLayer(index?: number) {
      update(state => {
        if (state.numLayers <= 1) return state;

        const removeIdx = index !== undefined ? index : state.numLayers - 1;
        if (removeIdx < 0 || removeIdx >= state.numLayers) return state;

        const newNumLayers = state.numLayers - 1;

        const newBlocks = state.blocks.map(block => ({
          ...block,
          clipGrid: block.clipGrid.filter((_, i) => i !== removeIdx),
          bankBClipGrid: (block.bankBClipGrid ?? createEmptyClipGrid(state.numLayers, state.numColumns))
            .filter((_, i) => i !== removeIdx),
        }));

        const newClipGrid = state.clipGrid.filter((_, i) => i !== removeIdx);
        const newBankBClipGrid = state.bankBClipGrid.filter((_, i) => i !== removeIdx);
        const newLayerStates = state.layerStates.filter((_, i) => i !== removeIdx);
        const newBankBLayerStates = state.bankBLayerStates.filter((_, i) => i !== removeIdx);

        return {
          ...state,
          numLayers: newNumLayers,
          clipGrid: newClipGrid,
          blocks: newBlocks,
          layerStates: newLayerStates,
          bankBClipGrid: newBankBClipGrid,
          bankBLayerStates: newBankBLayerStates,
        };
      });
    },

    // Add a new column to BOTH banks across ALL blocks.
    addColumn() {
      update(state => {
        if (state.numColumns >= MAX_VJ_COLUMNS) return state;

        const newNumColumns = state.numColumns + 1;

        const newBlocks = state.blocks.map(block => ({
          ...block,
          clipGrid: block.clipGrid.map(row => [...row, null]),
          bankBClipGrid: (block.bankBClipGrid ?? createEmptyClipGrid(state.numLayers, state.numColumns))
            .map(row => [...row, null]),
        }));

        const newClipGrid = state.clipGrid.map(row => [...row, null]);
        const newBankBClipGrid = state.bankBClipGrid.map(row => [...row, null]);

        return {
          ...state,
          numColumns: newNumColumns,
          clipGrid: newClipGrid,
          blocks: newBlocks,
          bankBClipGrid: newBankBClipGrid,
        };
      });
    },

    // Remove a column (default: last) from BOTH banks across ALL blocks.
    removeColumn(index?: number) {
      update(state => {
        if (state.numColumns <= 1) return state;

        const removeIdx = index !== undefined ? index : state.numColumns - 1;
        if (removeIdx < 0 || removeIdx >= state.numColumns) return state;

        const newNumColumns = state.numColumns - 1;

        const adjustActiveCol = (ls: VJLayerState): VJLayerState => {
          if (ls.activeColumn === removeIdx) return { ...ls, activeColumn: null };
          if (ls.activeColumn !== null && ls.activeColumn > removeIdx) {
            return { ...ls, activeColumn: ls.activeColumn - 1 };
          }
          return ls;
        };

        const newBlocks = state.blocks.map(block => ({
          ...block,
          clipGrid: block.clipGrid.map(row => row.filter((_, i) => i !== removeIdx)),
          bankBClipGrid: (block.bankBClipGrid ?? createEmptyClipGrid(state.numLayers, state.numColumns))
            .map(row => row.filter((_, i) => i !== removeIdx)),
        }));

        const newClipGrid = state.clipGrid.map(row => row.filter((_, i) => i !== removeIdx));
        const newBankBClipGrid = state.bankBClipGrid.map(row => row.filter((_, i) => i !== removeIdx));
        const newLayerStates = state.layerStates.map(adjustActiveCol);
        const newBankBLayerStates = state.bankBLayerStates.map(adjustActiveCol);

        return {
          ...state,
          numColumns: newNumColumns,
          clipGrid: newClipGrid,
          blocks: newBlocks,
          layerStates: newLayerStates,
          bankBClipGrid: newBankBClipGrid,
          bankBLayerStates: newBankBLayerStates,
        };
      });
    },

    // ========== Sub-modes (MIX / STAGE / MAP) ==========
    // Mutually exclusive — setting STAGE or MAP true clears the other.
    // MIX is the implicit default (both flags false).

    toggleStageMode() {
      update(state => ({ ...state, stageMode: !state.stageMode, mapMode: false }));
    },

    setStageMode(enabled: boolean) {
      update(state => ({ ...state, stageMode: enabled, mapMode: enabled ? false : state.mapMode }));
    },

    toggleMapMode() {
      update(state => ({ ...state, mapMode: !state.mapMode, stageMode: false }));
    },

    setMapMode(enabled: boolean) {
      update(state => ({ ...state, mapMode: enabled, stageMode: enabled ? false : state.stageMode }));
    },

    /** Convenience: set the active sub-mode by name. */
    setSubMode(mode: 'mix' | 'stage' | 'map') {
      update(state => ({
        ...state,
        stageMode: mode === 'stage',
        mapMode: mode === 'map',
      }));
    },

    setStagePreset(presetId: string | null) {
      update(state => ({ ...state, stagePresetId: presetId }));
    },

    setSelectedLayerIndex(idx: number | null) {
      update(state => ({ ...state, selectedLayerIndex: idx }));
    },

    // Which deck the parameter panel / clip preview should track when the
    // crossfader is on. Ignored when the crossfader is off (Bank A is
    // always the canonical deck in single-deck mode).
    setSelectedDeck(deck: VJDeck) {
      update(state => ({ ...state, selectedDeck: deck }));
    },

    // ===== Crossfader actions =====

    setCrossfaderEnabled(enabled: boolean) {
      update(state => {
        // Toggling preserves both decks' state. We just snap the fader back
        // to 0 (full Bank A) on disable so the user has a defined starting
        // point next time they enable it. Bank B clipGrid + activeClips
        // persist so flipping back on returns the user to where they were.
        if (!enabled) {
          return {
            ...state,
            crossfaderEnabled: false,
            crossfaderValue: 0,
            // Reset deck focus so panels go back to following Bank A.
            selectedDeck: 'A' as VJDeck,
          };
        }
        return { ...state, crossfaderEnabled: true };
      });
    },

    setCrossfaderValue(value: number) {
      const clamped = Math.max(0, Math.min(1, value));
      update(state => ({ ...state, crossfaderValue: clamped }));
    },

    setCrossfaderTransition(transition: CrossfaderTransition) {
      update(state => ({ ...state, crossfaderTransition: transition }));
    },

    setCrossfaderCurve(curve: CrossfaderCurve) {
      update(state => ({ ...state, crossfaderCurve: curve }));
    },

    setCrossfaderBlendMode(mode: CrossfaderBlendMode) {
      update(state => ({ ...state, crossfaderBlendMode: mode }));
    },

    setCrossfaderFadeDuration(duration: number) {
      const clamped = Math.max(0, Math.min(8, Number(duration) || 0));
      update(state => ({ ...state, crossfaderFadeDuration: clamped }));
    },

    cutToA() {
      update(state => ({ ...state, crossfaderValue: 0 }));
    },

    cutToB() {
      update(state => ({ ...state, crossfaderValue: 1 }));
    },
  };
}

export const vjClipLauncher = createVJClipLauncherStore();

// Derived store: Get the active clip for each layer.
//
// When the crossfader is OFF: Bank A is the only deck. Each layer with an
// active clip emits one entry tagged bank=null (engine treats it as the
// single canonical bank).
//
// When the crossfader is ON: BOTH decks contribute entries. Bank A pulls
// from layerStates, Bank B from bankBLayerStates — each fully independent
// (separate opacity, blend, mute, solo, effects). The render engine
// composites them to separate FBOs and crossfades between them via the
// chosen transition shader.
export const activeVJLayers = derived(
  vjClipLauncher,
  ($vjClipLauncher) => {
    const cfOn = $vjClipLauncher.crossfaderEnabled;

    // Solo gates ONLY apply within their own deck — soloing layer 2 on
    // Bank A doesn't mute layer 2 on Bank B.
    const hasSoloA = $vjClipLauncher.layerStates.some(ls => ls.solo);
    const hasSoloB = cfOn && $vjClipLauncher.bankBLayerStates.some(ls => ls.solo);

    const out: Array<{
      clip: VJClip;
      opacity: number;
      blendMode: BlendMode;
      effects: Effect[];
      layerIndex: number;
      bank: 'A' | 'B' | null;
    }> = [];

    // Bank A pass — always runs.
    for (let i = 0; i < $vjClipLauncher.layerStates.length; i++) {
      const ls = $vjClipLauncher.layerStates[i];
      if (ls.mute) continue;
      if (hasSoloA && !ls.solo) continue;
      const clip = ls.activeClip;
      if (!clip) continue;
      // Preset clips are side-effect-only (load mapping on fire); they
      // don't feed content into a VJ layer. Skip them so the engine
      // doesn't try to source pixels from a preset.
      if (clip.type === 'preset') continue;
      out.push({
        clip,
        opacity: ls.opacity,
        blendMode: ls.blendMode,
        effects: [...(clip.effects || []), ...ls.effects],
        layerIndex: i,
        bank: cfOn ? 'A' : null,
      });
    }

    // Bank B pass — only when crossfader is on.
    if (cfOn) {
      for (let i = 0; i < $vjClipLauncher.bankBLayerStates.length; i++) {
        const ls = $vjClipLauncher.bankBLayerStates[i];
        if (ls.mute) continue;
        if (hasSoloB && !ls.solo) continue;
        const clip = ls.activeClip;
        if (!clip) continue;
        if (clip.type === 'preset') continue;
        out.push({
          clip,
          opacity: ls.opacity,
          blendMode: ls.blendMode,
          effects: [...(clip.effects || []), ...ls.effects],
          layerIndex: i,
          bank: 'B',
        });
      }
    }

    return out;
  }
);

// Derived store: Get layers to render when VJ mode is live
export const vjOutputLayers = derived(
  [vjClipLauncher, activeVJLayers, vjLayerSequencer],
  ([$vjClipLauncher, $activeVJLayers, $vjLayerSequencer]) => {
    if (!$vjClipLauncher.isLive) return null;

    const outputLayers: Layer[] = [];

    // Iterate every active entry — when crossfader is on, a single VJ
    // layer may have BOTH a Bank A and a Bank B entry. We emit one
    // Layer per entry so the engine can route each to its bank FBO.
    for (const activeLayer of $activeVJLayers) {
      const vjLayerIndex = activeLayer.layerIndex;
      const clip = activeLayer.clip;
      const sequenceOverrides = activeLayer.bank === 'B'
        ? ($vjLayerSequencer.bankBOpacityOverrides ?? {})
        : $vjLayerSequencer.opacityOverrides;
      const sequenceOpacity = $vjLayerSequencer.isPlaying
        ? (sequenceOverrides[vjLayerIndex] ?? 1)
        : 1;
      const vjLayerOpacity = activeLayer.opacity * sequenceOpacity * $vjClipLauncher.masterOpacity;
      if (clip.type === 'video') {
        ensureClipVideoElement(clip);
      }

      // Cache key includes the bank so Bank A and Bank B clips on the same
      // row don't collide. In single-bank mode bank is null and the key
      // matches the original vj-{layer}-{clipId} shape.
      const bankSuffix = activeLayer.bank ? `-${activeLayer.bank}` : '';
      const cacheKey = `vj-${vjLayerIndex}${bankSuffix}-${clip.id}`;
      let source = vjSourceCache.get(cacheKey);

      if (!source) {
        // Map VJClip type to MediaSource type
        const mediaType = mediaTypeForClip(clip);

        source = {
          id: clip.id,
          type: mediaType,
          name: clip.name,
          src: clip.src,
          _assetRef: clip._assetRef,
          shaderCode: clip.shaderCode,
          shaderInputs: getShaderInputs(clip.shaderCode),
          shaderValues: clip.shaderValues || {},
          jsAnimation: clip.jsAnimation,
          videoElement: clip.videoElement,
          texture: clip.type === 'video' ? clip.videoTexture : undefined,
          iframeElement: clip.iframeElement,
          // Forward video playback props so Canvas.svelte's updateTexturesSync
          // sees them. Canvas already has trim-aware loop/clamp/once logic
          // (`source.trimStart/trimEnd/playbackMode/playbackRate/isPlaying`)
          // — without these forwards the playhead ignores the trim handles
          // and just plays the whole file end-to-end on loop.
          playbackMode: clip.playbackMode || 'loop',
          playbackRate: clip.playbackRate ?? 1,
          playbackSyncBeats: clip.playbackSyncBeats ?? null,
          trimStart: clip.trimStart ?? 0,
          trimEnd: clip.trimEnd ?? 1,
          isPlaying: clip.isPlaying !== false,
        };

        // For threejs clips, get the canvas from the iframe context
        if (clip.type === 'threejs') {
          const context = getThreeJSIframeContext(clip.id);
          if (context) {
            source.threejsCanvas = context.canvas;
          }
        }

        // For synthvision clips, use the provided offscreen canvas
        if (clip.type === 'synthvision' && clip.synthVisionCanvas) {
          source.threejsCanvas = clip.synthVisionCanvas;
        }

        // For live network clips, route to the correct renderer receiver.
        // NDI reuses the legacy 'spout' clip type for compatibility, but
        // Canvas distinguishes it by ndiSource vs spoutSource.
        if (clip.type === 'spout' && clip.ndiSource) {
          source.ndiSource = clip.ndiSource;
        } else if (clip.type === 'spout' && clip.spoutSource) {
          source.spoutSource = {
            senderName: clip.spoutSource,
            name: clip.spoutSource, // Legacy compatibility
            width: 1920,
            height: 1080,
          };
        }

        // For effect clips, set the effectSource property for integrated WebGL effects
        if (clip.type === 'effect' && clip.effectSource) {
          source.effectSource = clip.effectSource;
        }

        vjSourceCache.set(cacheKey, source);
      } else {
        // Update dynamic properties
        const mediaType = mediaTypeForClip(clip);
        const srcChanged = source.src !== clip.src;
        source.id = clip.id;
        source.type = mediaType;
        source.name = clip.name;
        source.src = clip.src;
        source.jsAnimation = clip.jsAnimation;
        if (srcChanged) {
          source.texture?.dispose?.();
          source.texture = undefined;
          source.videoElement = undefined;
        }
        source.shaderValues = clip.shaderValues || {};
        if (clip.videoElement) {
          source.videoElement = clip.videoElement;
        }
        if (clip.type === 'video' && clip.videoTexture) {
          source.texture = clip.videoTexture;
        }
        source._assetRef = clip._assetRef;
        if (clip.iframeElement) {
          source.iframeElement = clip.iframeElement;
        }
        // For video clips: refresh trim/playback props every recompute so
        // the trim handles in the VJ video controls panel feed live values
        // into Canvas.svelte's per-frame trim clamp / loop logic. Without
        // this refresh the cached source freezes its trim values at
        // first-trigger time and the playhead ignores subsequent drags.
        if (clip.type === 'video') {
          source.playbackMode = clip.playbackMode || 'loop';
          source.playbackRate = clip.playbackRate ?? 1;
          source.playbackSyncBeats = clip.playbackSyncBeats ?? null;
          source.trimStart = clip.trimStart ?? 0;
          source.trimEnd = clip.trimEnd ?? 1;
          source.isPlaying = clip.isPlaying !== false;
        }
        // For threejs clips, get the canvas from the iframe context
        if (clip.type === 'threejs') {
          const context = getThreeJSIframeContext(clip.id);
          if (context) {
            source.threejsCanvas = context.canvas;
          }
        }
        // For synthvision clips, update the canvas reference
        if (clip.type === 'synthvision' && clip.synthVisionCanvas) {
          source.threejsCanvas = clip.synthVisionCanvas;
        }
        // For live network clips, refresh receiver metadata and clear the
        // opposite transport so cached sources cannot flip stale routes.
        if (clip.type === 'spout' && clip.ndiSource) {
          source.ndiSource = clip.ndiSource;
          source.spoutSource = undefined;
        } else if (clip.type === 'spout' && clip.spoutSource) {
          source.spoutSource = {
            senderName: clip.spoutSource,
            name: clip.spoutSource,
            width: 1920,
            height: 1080,
          };
          source.ndiSource = undefined;
        } else {
          source.spoutSource = undefined;
          source.ndiSource = undefined;
        }
        // For effect clips, update the effectSource (for parameter changes)
        if (clip.type === 'effect' && clip.effectSource) {
          source.effectSource = clip.effectSource;
        }
      }

      // Map content clips to their native layer types so Canvas creates the
      // same renderers used by mapping mode.
      let layerType: Layer['type'] = 'media';
      if (clip.type === 'splat') layerType = 'splat';
      else if (clip.type === 'model3d') layerType = 'model3d';
      else if (clip.type === 'gpu') layerType = 'gpu';
      else if (clip.type === 'text') layerType = 'text';

      // Create Layer object with all required properties.
      // ID includes the bank suffix when in dual-bank mode so the render
      // engine treats Bank A and Bank B clips on the same row as
      // distinct layers (they'll otherwise collide in renderPlan
      // dedup / texture caches).
      const layerIdSuffix = activeLayer.bank ? `-${activeLayer.bank}` : '';

      // Per-clip transforms — applied by REWRITING THE CORNERS of
      // the layer's warp quad. The engine renders VJ layers through
      // the warp-quad pipeline; layer.position/scale/rotation are
      // bypassed for layers in 'corners' warp mode. So we bake the
      // transforms into the corners directly:
      //   1. Start with default unit-rect corners at ±0.5 from center
      //   2. Scale by zoom (uniform scale around center)
      //   3. Rotate by rotation degrees (around center)
      //   4. Translate by (anchor - 0.5)
      //   5. Re-anchor to (0.5, 0.5) and convert to corner format
      // contentFit + opacity are still consumed via the existing
      // shader uniforms (they're UV-based and per-layer-multiply,
      // not corner-based).
      const transformableClip = isTransformableMediaClip(clip);
      const clipZoom = transformableClip ? (clip.zoom ?? 1) : 1;
      const clipRotation = transformableClip ? (clip.rotation ?? 0) : 0;
      const clipOpacity = transformableClip ? (clip.opacity ?? 1) : 1;
      const clipMirrorX = transformableClip ? !!clip.mirrorX : false;
      const ax = transformableClip ? (clip.anchorX ?? 0.5) : 0.5;
      const ay = transformableClip ? (clip.anchorY ?? 0.5) : 0.5;
      // Map VJ-friendly fit names to engine ContentFitMode.
      let clipContentFit: 'stretch' | 'fill' | 'crop' | undefined;
      if (transformableClip) {
        const f = clip.fit ?? 'cover';
        clipContentFit = f === 'cover' ? 'fill' : f === 'contain' ? 'crop' : 'stretch';
      }

      // Corner computation. Engine corner space is [0,1]² with
      // y=1 at top. We work in centered space (-0.5..0.5) for the
      // matrix math, then re-translate to [0,1] for the engine.
      const cosR = Math.cos((clipRotation * Math.PI) / 180);
      const sinR = Math.sin((clipRotation * Math.PI) / 180);
      // Anchor maps user 0..1 → quad offset from center in [-0.5..0.5].
      // anchorX=0 means "anchor at left edge" → quad shifts LEFT by 0.5
      // (so the right edge ends up at x=0.5 of canvas? actually that's
      // "anchor at left edge of source maps to center of canvas"; for
      // a more intuitive pan-the-content semantics we shift the OPPOSITE
      // way so anchorX=1 reveals the left side of source).
      const offX = (ax - 0.5);
      const offY = (ay - 0.5);
      const transformCorner = (cx: number, cy: number) => {
        // cx,cy are corner positions in centered space ±0.5
        // Apply zoom, rotate around center, translate by anchor
        const sx = cx * clipZoom;
        const sy = cy * clipZoom;
        const rx = sx * cosR - sy * sinR;
        const ry = sx * sinR + sy * cosR;
        return { x: rx + 0.5 + offX, y: ry + 0.5 + offY };
      };
      // Default unit corners in centered space (-0.5..0.5). The
      // top corners have cy=+0.5 because engine corner space has
      // y=1 at the top, y=0 at the bottom — transformCorner adds
      // 0.5 at the end so cy=+0.5 → y=1 (top) for identity. Hand-
      // off into the engine's corner format is now direct.
      const clipCorners = {
        topLeft:     transformCorner(-0.5,  0.5),
        topRight:    transformCorner( 0.5,  0.5),
        bottomLeft:  transformCorner(-0.5, -0.5),
        bottomRight: transformCorner( 0.5, -0.5),
      };

      const layer: Layer = {
        id: `vj-layer-${vjLayerIndex}${layerIdSuffix}`,
        name: clip.name,
        type: layerType,
        visible: true,
        locked: false,
        opacity: vjLayerOpacity * clipOpacity,
        blendMode: activeLayer.blendMode,
        source,
        linesContent: null,
        svgContent: null,
        colorContent: null,
        lightPaintingContent: null,
        advLightPaintingContent: null,
        textContent: clip.type === 'text' ? (clip.textContent || createDefaultTextContent()) : null,
        splatContent: clip.type === 'splat' ? (clip.splatContent || createDefaultSplatContent()) : null,
        model3dContent: clip.type === 'model3d' ? (clip.model3dContent || createDefaultModel3DContent()) : null,
        pixelFXContent: null,
        gpuLayerContent: clip.type === 'gpu' ? (clip.gpuLayerContent || createDefaultGPULayerContent()) : null,
        arcadeContent: null,
        // Transform identity — per-clip transforms are baked into
        // `corners` below so the engine's warp pipeline applies them
        // uniformly. position/scale/rotation are bypassed by the
        // corner pipeline anyway.
        position: { x: 0, y: 0 },
        scale: { x: 1, y: 1 },
        rotation: 0,
        flipH: clipMirrorX,
        // VideoTexture already normalizes DOM video frames for the renderer.
        // Keep the VJ adapter neutral so rotation 0 / mirror off matches Mapping.
        flipV: false,
        contentFit: clipContentFit,
        // Warping - corners computed from per-clip zoom/anchor/rotation
        // above; defaults to a full-screen unit quad when all transforms
        // are at identity (zoom=1, anchor=0.5/0.5, rotation=0).
        warpMode: 'corners',
        corners: clipCorners,
        meshGrid: null,
        // No mask or crop
        mask: null,
        cropRegion: null,
        layerShape: null,
        edgeEffects: null,
        // Effects from VJ layer state
        effects: activeLayer.effects,
        // Bank tag — read by engine.render() to route to A or B FBO when crossfader is on.
        bank: activeLayer.bank ?? undefined,
      };

      outputLayers.push(layer);
    }

    return outputLayers.length > 0 ? outputLayers : null;
  }
);

// Helper to get current state
export function getVJClipLauncherState(): VJClipLauncherState {
  return get(vjClipLauncher);
}

// Don't clear source cache when VJ mode toggles - let textures persist
// This was causing issues because textures need to be reloaded each time
// The cache is small and keyed by vj-layer-index + clip-id, so it won't grow unbounded
