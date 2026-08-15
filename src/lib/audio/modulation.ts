// Parameter Modulation Engine
// Maps shader uniform parameters to modulation sources (audio bands, BPM, LFO/time)
// Runs each frame, applying modulated values to active VJ clips and mapping layers

import { get } from 'svelte/store';
import { writable } from 'svelte/store';
import { audioStore, type AudioState } from '../stores/audio';
import { getVisualAudioSnapshot } from './visualAudio';
import { vjClipLauncher } from '../stores/vjClipLauncher';
import type { ISFInput } from '../isf/parser';

// Callback for applying modulated values to mapping mode layers
// Registered by the layers store to avoid circular imports
// (layerIndex, values) => void
let _mappingLayerUpdater: ((layerIndex: number, values: Record<string, number>) => void) | null = null;

// Callback to read mapping layer shader values (for initial base value capture)
// (layerIndex, paramName) => number | undefined
let _mappingLayerReader: ((layerIndex: number, paramName: string) => number | undefined) | null = null;

// Returns true if layerIndex refers to a mapping layer (not VJ)
let _isMappingLayer: ((layerIndex: number) => boolean) | null = null;

// Effect-param read/write callbacks for mapping mode. Without these the
// engine can write modulated values to VJ effect params but mapping-mode
// effects sit at the user's manual slider value. The store registers
// them alongside the shader callbacks below.
let _mappingEffectUpdater: ((layerIndex: number, effectId: string, values: Record<string, number>) => void) | null = null;
let _mappingEffectReader: ((layerIndex: number, effectId: string, paramName: string) => number | undefined) | null = null;

// Edge-effect read/write callbacks. paramPath is the dotted nested
// path (e.g. 'stroke.width'); updater is responsible for the deep-merge
// into the right top-level object (stroke/fill/animation).
let _mappingEdgeEffectUpdater: ((layerIndex: number, effectId: string, paramPath: string, value: number) => void) | null = null;
let _mappingEdgeEffectReader: ((layerIndex: number, effectId: string, paramPath: string) => number | undefined) | null = null;

// GPU-layer param read/write callbacks. Writes go through
// project.updateGPULayerParams so changes participate in the keyframe
// auto-record path and the engine's per-frame batched updates feel
// the same as a user slider drag.
let _mappingGPUUpdater: ((layerIndex: number, values: Record<string, number>) => void) | null = null;
let _mappingGPUReader: ((layerIndex: number, paramKey: string) => number | undefined) | null = null;

// Splat / point-cloud param read/write callbacks. These mirror the GPU
// callbacks but write directly into layer.splatContent.
let _mappingSplatUpdater: ((layerIndex: number, values: Record<string, number>) => void) | null = null;
let _mappingSplatReader: ((layerIndex: number, paramKey: string) => number | undefined) | null = null;

/** Register mapping mode callbacks — called once from layers store init */
export function registerMappingLayerCallbacks(
  updater: (layerIndex: number, values: Record<string, number>) => void,
  reader: (layerIndex: number, paramName: string) => number | undefined,
  isMapping: (layerIndex: number) => boolean,
  effectUpdater?: (layerIndex: number, effectId: string, values: Record<string, number>) => void,
  effectReader?: (layerIndex: number, effectId: string, paramName: string) => number | undefined,
  edgeEffectUpdater?: (layerIndex: number, effectId: string, paramPath: string, value: number) => void,
  edgeEffectReader?: (layerIndex: number, effectId: string, paramPath: string) => number | undefined,
  gpuUpdater?: (layerIndex: number, values: Record<string, number>) => void,
  gpuReader?: (layerIndex: number, paramKey: string) => number | undefined,
  splatUpdater?: (layerIndex: number, values: Record<string, number>) => void,
  splatReader?: (layerIndex: number, paramKey: string) => number | undefined,
) {
  _mappingLayerUpdater = updater;
  _mappingLayerReader = reader;
  _isMappingLayer = isMapping;
  if (effectUpdater) _mappingEffectUpdater = effectUpdater;
  if (effectReader) _mappingEffectReader = effectReader;
  if (edgeEffectUpdater) _mappingEdgeEffectUpdater = edgeEffectUpdater;
  if (edgeEffectReader) _mappingEdgeEffectReader = edgeEffectReader;
  if (gpuUpdater) _mappingGPUUpdater = gpuUpdater;
  if (gpuReader) _mappingGPUReader = gpuReader;
  if (splatUpdater) _mappingSplatUpdater = splatUpdater;
  if (splatReader) _mappingSplatReader = splatReader;
}

// Modulation source types
export type ModSource =
  | 'manual'     // No modulation, manual slider only
  | 'sub'        // 20-60 Hz sub bass
  | 'bass'       // 60-250 Hz bass
  | 'lowMid'     // 250-500 Hz
  | 'mid'        // 500-2000 Hz
  | 'highMid'    // 2000-4000 Hz
  | 'treble'     // 4000-8000 Hz hihat / cymbal body
  | 'air'        // 8000-16000 Hz cymbal sparkle / sibilance
  | 'presence'   // 16000-22000 Hz reverb tail / shimmer
  | 'high'       // legacy: synthetic average of treble+air+presence
  | 'amplitude'  // Overall volume
  | 'beatPhase'  // 0-1 ramp synced to beat
  // Onset-based one-shots — pulse to 1 on hit, decay back to 0 over ~150ms.
  // Use these when you want a flash on the kick or snare specifically.
  | 'kick'
  | 'snare'
  | 'lfo-sine'   // Sine wave LFO
  | 'lfo-saw'    // Sawtooth LFO
  | 'lfo-square' // Square wave LFO
  | 'lfo-tri'    // Triangle wave LFO
  // Per-param playhead automation. Independent of audio entirely —
  // each param has its own speed, loop/pingpong mode, and sub-range
  // clippers (autoMin / autoMax). play/pause via mod.autoPlaying.
  // See AutomationState below.
  | 'auto';

/** Every ModSource whose value comes out of the audio analyser. The
 *  remainder ('manual', 'auto', free-running LFOs) is independent of what
 *  the analyser hears — an offline render reproduces those exactly. */
const AUDIO_DRIVEN_MOD_SOURCES: ReadonlySet<string> = new Set<ModSource>([
  'sub', 'bass', 'lowMid', 'mid', 'highMid', 'treble', 'air', 'presence', 'high',
  'amplitude', 'beatPhase', 'kick', 'snare',
]);

/** True when this modulation's value depends on incoming audio. BPM-synced
 *  LFOs count: their rate comes from the detected tempo, so they drift with
 *  whatever the analyser is hearing. */
export function isAudioDrivenMod(mod: Pick<ParamModulation, 'source' | 'bpmSync'>): boolean {
  if (AUDIO_DRIVEN_MOD_SOURCES.has(mod.source)) return true;
  return !!mod.bpmSync && mod.source.startsWith('lfo-');
}

/** Modulation target — which side of the app's render graph the
 *  engine should write modulated values to. Independent of which UI
 *  panel is currently open: a 'vj' modulation keeps driving the VJ
 *  deck's active clip even while the user is browsing mapping mode,
 *  and vice versa. Previously the engine routed based on a global
 *  `project.vjMode.enabled` flag which made VJ and mapping mods
 *  mutually exclusive — switching modes silently re-routed the same
 *  modulation entries to the wrong side, producing the "params work
 *  in mapping but not VJ" bug. */
export type ModTarget = 'vj' | 'mapping';

// A single parameter modulation assignment
export interface ParamModulation {
  source: ModSource;
  /** Which render-graph side this modulation drives. Optional for
   *  back-compat with old project saves; when absent the engine
   *  falls back to the legacy global-mode routing. New code paths
   *  (UI panels creating modulations) always set this explicitly. */
  target?: ModTarget;
  amount: number;    // 0-1 how much the source affects the parameter
  speed: number;     // LFO speed multiplier (only for LFO sources)
                     // - bpmSync=false: cycles per second (Hz). speed=1 → 1Hz → 60 BPM
                     // - bpmSync=true:  beat divisions. speed=1 → 1 cycle per beat,
                     //                  speed=0.25 → 1 cycle per 4 beats (slow),
                     //                  speed=4 → 4 cycles per beat (sixteenths)
  invert: boolean;   // Invert the modulation signal
  /** When true and source is an LFO, the LFO syncs to the detected/manual
   *  BPM instead of running at a free Hz rate. Effective cycle rate becomes
   *  `speed × (bpm / 60)` cycles per second, so speed acts as a beat-division
   *  multiplier rather than a Hz value. Ignored for non-LFO sources. */
  bpmSync?: boolean;

  // ─── Per-param automation (source === 'auto') ─────────────────
  /** Internal phase counter for the auto playhead, 0..1. Advanced by
   *  `autoSpeedHz × dt` each frame when autoPlaying is true.
   *  Persisted with the modulation so pause/resume continues from
   *  where the user paused, not from now mod cycle. */
  autoPhase?: number;
  /** Loop = saw (0→1, wrap), pingpong = triangle (0→1→0). */
  autoMode?: 'loop' | 'pingpong';
  /** Cycles per second. Range 0.05 - 4.0 in the UI; the engine
   *  doesn't clamp so MIDI / keyframe automation can push beyond. */
  autoSpeedHz?: number;
  /** Lower clip of the param's range, expressed as 0..1 fraction.
   *  0 = the param's natural min, 1 = the natural max. Default 0. */
  autoMin?: number;
  /** Upper clip, same scale. Default 1. Always >= autoMin in the
   *  UI (we swap if user inverts), but the engine handles either. */
  autoMax?: number;
  /** Play/pause. When false, the param sits at whatever value the
   *  last frame published — the playhead doesn't advance. */
  autoPlaying?: boolean;
}

// Default modulation values for new assignments
export const DEFAULT_MOD: Omit<ParamModulation, 'source'> = {
  amount: 0.5,
  speed: 1,
  invert: false,
  bpmSync: false,
  // Automation defaults — only consulted when source === 'auto'.
  // 0.15Hz = ~6.7s for a full cycle (≈13s ping-pong round-trip);
  // first-test feedback was that 0.5Hz felt frantic. Users can
  // crank it up via the slider for stutter effects but the
  // calm-starting-point matches typical "slow swirl" VJ pacing.
  autoPhase: 0,
  autoMode: 'loop',
  autoSpeedHz: 0.15,
  autoMin: 0,
  autoMax: 1,
  autoPlaying: true,
};

// Pre-parsed key for hot-path use (avoids split(':') per frame)
interface ParsedModEntry {
  mod: ParamModulation;
  // Special target sentinel — when set, takes precedence over layer/effect
  // routing. 'xfade-value' modulates the global VJ crossfader fader.
  special?: 'xfade-value';
  // Bank tag for layer/effect targets. Default 'A'. Ignored when `special` is set.
  bank: 'A' | 'B';
  /** Which render-graph side this entry writes to. 'vj' or 'mapping'.
   *  Derived from the key prefix at parse time; preferred over the
   *  legacy `_isMappingLayer(layerIndex)` flag during routing — so
   *  VJ + mapping mods coexist independently regardless of which
   *  workspace the user is currently in. */
  target: ModTarget;
  /** When set (vjc:-prefixed key), the engine searches deck
   *  layerStates for this clip ID at apply-time and writes there.
   *  The `layerIndex` field is a sentinel (-1) in that case — the
   *  clip's deck position is resolved per-frame, so automation
   *  follows the clip wherever the user fires it. */
  clipId?: string;
  layerIndex: number;
  isEffect: boolean;     // true for regular pixel effects (`layer.effects[]`)
  isEdgeEffect: boolean; // true for edge effects (`layer.edgeEffects.effects[]`)
  isGPU: boolean;        // true for GPU shader-layer params (`layer.gpuLayerContent.params[]`)
  isSplat: boolean;      // true for splat / point-cloud content params
  effectId: string;      // '' for shader params
  paramName: string;     // for edge effects this is the nested path, e.g. 'stroke.width'
}

// Key formats — discriminator is the leading token:
//   Bank A shader:  "layerIndex:paramName"                    (legacy / default)
//   Bank A effect:  "layerIndex:fx:effectId:paramName"
//   Bank A edge fx: "layerIndex:edge:effectId:stroke.width"   (nested path)
//   Bank B shader:  "B:layerIndex:paramName"
//   Bank B effect:  "B:layerIndex:fx:effectId:paramName"
//   Bank B edge fx: "B:layerIndex:edge:effectId:stroke.width"
//   Crossfader:     "xfade:value"
export type ModulationMap = Map<string, ParamModulation>;

// Key builders so callers don't hand-craft strings.
//
// Key format:
//   target='vj' + clipId       →  "vjc:CLIPID:paramName"        (per-clip, preferred for VJ)
//   target='vj'      bank='A'   →  "0:paramName"                 (legacy layer-keyed fallback)
//   target='vj'      bank='B'   →  "B:0:paramName"               (legacy layer-keyed)
//   target='mapping'            →  "map:0:paramName"             (no banks in mapping)
//   target='vj'      effect     →  "0:fx:effectId:paramName"
//   target='mapping' effect     →  "map:0:fx:effectId:paramName"
//
// Why clip-keyed (vjc:) for VJ shaders:
// Two different shaders might both expose a param called "speed".
// With layer-keyed mods, picking Auto on shader A's "speed" silently
// activates auto on shader B's "speed" the moment you switch to B
// on the same layer — same key, applies to whichever clip happens
// to be active. The user explicitly flagged this: "we need to use
// the shader as an ID. cant have that." Clip-keyed mods sit on the
// clip itself, dormant when the clip isn't on a deck, live when
// it is. Two different clips on the same layer get independent
// automation profiles.
//
// Mapping mode stays layer-keyed (`map:`): mapping layers are
// stable persistent containers, layer index uniquely identifies
// the shader.
export function modKeyShader(
  layerIndex: number,
  paramName: string,
  bank: 'A' | 'B' = 'A',
  target: ModTarget = 'vj',
  clipId?: string,
): string {
  if (target === 'mapping') return `map:${layerIndex}:${paramName}`;
  if (clipId) return `vjc:${clipId}:${paramName}`;
  return bank === 'B' ? `B:${layerIndex}:${paramName}` : `${layerIndex}:${paramName}`;
}
export function modKeyEffect(
  layerIndex: number,
  effectId: string,
  paramName: string,
  bank: 'A' | 'B' = 'A',
  target: ModTarget = 'vj',
): string {
  if (target === 'mapping') return `map:${layerIndex}:fx:${effectId}:${paramName}`;
  return bank === 'B'
    ? `B:${layerIndex}:fx:${effectId}:${paramName}`
    : `${layerIndex}:fx:${effectId}:${paramName}`;
}
/** Edge effects live on `layer.edgeEffects.effects[]` with a nested
 *  shape (e.g. `effect.stroke.width`, `effect.fill.opacity`,
 *  `effect.animation.speed`). The modulation key uses a `:edge:`
 *  segment so the engine can distinguish them from regular pixel
 *  effects and route writes through `project.updateEdgeEffect` with
 *  the right deep-merge instead of the flat `params` updater used by
 *  regular effects. `paramPath` is the dotted nested path
 *  (e.g. `'stroke.width'`). */
export function modKeyEdgeEffect(layerIndex: number, effectId: string, paramPath: string, bank: 'A' | 'B' = 'A', target: ModTarget = 'vj'): string {
  // Edge effects only exist on mapping layers, but the key still
  // honors the target prefix so the engine's parser routes them
  // correctly through the target-aware isMapping check.
  if (target === 'mapping') return `map:${layerIndex}:edge:${effectId}:${paramPath}`;
  return bank === 'B'
    ? `B:${layerIndex}:edge:${effectId}:${paramPath}`
    : `${layerIndex}:edge:${effectId}:${paramPath}`;
}
/** GPU layer params. Mapping-only (no VJ-mode GPU layer surface yet);
 *  layer-keyed because GPU content is stable per-layer (swapping
 *  shaders within the same gpu layer reuses the same modulations
 *  applied to whichever param keys overlap). */
export function modKeyGPU(
  layerIndex: number,
  paramKey: string,
  target: ModTarget = 'mapping',
): string {
  // Format mirrors fx/edge so rebuildParsedCache's existing
  // `parts[cursor + 1] === '...'` branch can pick it up.
  if (target === 'mapping') return `map:${layerIndex}:gpu:${paramKey}`;
  return `${layerIndex}:gpu:${paramKey}`;
}

export function modKeySplat(
  layerIndex: number,
  paramKey: string,
  target: ModTarget = 'mapping',
): string {
  if (target === 'mapping') return `map:${layerIndex}:splat:${paramKey}`;
  return `${layerIndex}:splat:${paramKey}`;
}

export const MOD_KEY_XFADE_VALUE = 'xfade:value';

// Pre-parsed cache rebuilt on store change — avoids per-frame string parsing
let parsedCache: ParsedModEntry[] = [];

// Parameter range registry — stores ISF min/max for shader params to enable clamping.
//
// Key format:
//   "vjc:CLIPID:paramName"   → per-clip VJ ranges (preferred; survives shader swap)
//   "vj:layerIndex:paramName" → legacy layer-keyed VJ ranges
//   "map:layerIndex:paramName" → mapping-mode ranges
//
// Why the namespace prefix: previously the key was just
// "layerIndex:paramName", shared between VJ + mapping. When the user
// opened a mapping shader on layer 0, registerParamRanges cleared
// ALL `0:*` entries — wiping VJ's layer 0 ranges too. The engine
// then fell back to a generic 0..2 span for VJ mods, which mapped
// the slider's actual min/max badly enough that the thumb looked
// frozen at one edge. Namespacing keeps the two mode keyspaces
// isolated so mode switching doesn't clobber the other side.
const paramRanges = new Map<string, { min: number; max: number }>();

// Effect param range registry — same idea for layer effect params.
// Key format: "layerIndex:fx:effectId:paramName"
// Used by the engine to clamp modulated effect values to the slider's
// configured min/max (matches what the LayerPanel inputs enforce).
const effectParamRanges = new Map<string, { min: number; max: number }>();

/** Register the min/max for a single effect param. The LayerPanel calls
 *  this when wiring up a mod-source dropdown so the engine knows how to
 *  clamp the modulated output. Safe to call repeatedly for the same key
 *  (just overwrites). */
export function registerEffectParamRange(
  layerIndex: number,
  effectId: string,
  paramName: string,
  min: number,
  max: number,
) {
  effectParamRanges.set(`${layerIndex}:fx:${effectId}:${paramName}`, { min, max });
}

/** Register the min/max for a GPU shader-layer param. Called by the
 *  param-row component when wiring its mod source dropdown so the
 *  engine can clamp modulated values into the schema's natural range. */
export function registerGPUParamRange(
  layerIndex: number,
  paramKey: string,
  min: number,
  max: number,
) {
  paramRanges.set(`map:${layerIndex}:gpu:${paramKey}`, { min, max });
}

export function registerSplatParamRange(
  layerIndex: number,
  paramKey: string,
  min: number,
  max: number,
) {
  paramRanges.set(`map:${layerIndex}:splat:${paramKey}`, { min, max });
}

/** Drop every GPU-range entry for a layer. Call when the layer's
 *  shader id changes (different shader = different param set). */
export function clearGPUParamRanges(layerIndex: number) {
  const prefix = `map:${layerIndex}:gpu:`;
  for (const key of paramRanges.keys()) {
    if (key.startsWith(prefix)) paramRanges.delete(key);
  }
}

/** Drop every effect-range entry for a layer. Call when the layer's
 *  effects list churns (effect removed, layer deleted) so stale ranges
 *  don't survive into unrelated effects that happen to reuse the index. */
export function clearEffectParamRanges(layerIndex: number) {
  const aPrefix = `${layerIndex}:fx:`;
  for (const key of effectParamRanges.keys()) {
    if (key.startsWith(aPrefix)) effectParamRanges.delete(key);
  }
}

// Edge-effect param range registry — separate map keyed by the dotted
// path so `stroke.width` and `fill.opacity` don't collide with any
// regular effect named "stroke" or "fill". Same engine semantics:
// modulation output is clamped to (min,max) before being written back.
const edgeEffectParamRanges = new Map<string, { min: number; max: number }>();

export function registerEdgeEffectParamRange(
  layerIndex: number,
  effectId: string,
  paramPath: string,
  min: number,
  max: number,
) {
  edgeEffectParamRanges.set(`${layerIndex}:edge:${effectId}:${paramPath}`, { min, max });
}

export function clearEdgeEffectParamRanges(layerIndex: number) {
  const prefix = `${layerIndex}:edge:`;
  for (const key of edgeEffectParamRanges.keys()) {
    if (key.startsWith(prefix)) edgeEffectParamRanges.delete(key);
  }
}

// Last modulated values — for UI ghost indicator display
const lastModulatedValues = new Map<string, number>();

// Base values — the user's manual slider position, never overwritten by modulation.
// Without this, the modulation engine would read its own output as next frame's input,
// creating a runaway feedback loop where values drift to min/max and stick.
// Key format: "layerIndex:paramName"
const baseValues = new Map<string, number>();

/** Register ISF parameter ranges for a layer so modulation can clamp correctly */
/** Register the ISF min/max for a shader's params under a namespaced
 *  key so VJ + mapping ranges don't clobber each other on mode
 *  switch. When clipId is provided, ranges go under `vjc:CLIPID:`
 *  (preferred for VJ — survives shader swap on the same layer).
 *  Otherwise falls back to legacy `vj:layerIndex:` or `map:layerIndex:`
 *  depending on target. */
export function registerParamRanges(layerIndex: number, inputs: ISFInput[], target: ModTarget = 'vj', clipId?: string) {
  const prefix = clipId ? `vjc:${clipId}:` : (target === 'mapping' ? `map:${layerIndex}:` : `vj:${layerIndex}:`);
  // Clear only THIS namespace's old keys — leaves other modes' /
  // other clips' ranges untouched.
  for (const key of paramRanges.keys()) {
    if (key.startsWith(prefix)) paramRanges.delete(key);
  }
  for (const input of inputs) {
    if (input.TYPE === 'float' || input.TYPE === 'long' || input.TYPE === 'event') {
      paramRanges.set(`${prefix}${input.NAME}`, {
        min: input.MIN ?? 0,
        max: input.MAX ?? 1,
      });
    }
  }
}

/** Get the last computed modulated value for a param (for UI ghost indicators) */
export function getModulatedValue(layerIndex: number, paramName: string): number | null {
  return lastModulatedValues.get(`${layerIndex}:${paramName}`) ?? null;
}

/** Clear all modulated value cache entries for a layer (sweeps BOTH banks) */
export function clearModulatedValues(layerIndex: number) {
  const aPrefix = `A:${layerIndex}:`;
  const bPrefix = `B:${layerIndex}:`;
  const legacy = `${layerIndex}:`;
  for (const key of lastModulatedValues.keys()) {
    if (key.startsWith(aPrefix) || key.startsWith(bPrefix) || key.startsWith(legacy)) {
      lastModulatedValues.delete(key);
    }
  }
}

/** Set the base (manual slider) value for a parameter — called when user moves a slider */
export function setBaseValue(layerIndex: number, paramName: string, value: number, bank: 'A' | 'B' = 'A') {
  baseValues.set(`${bank}:${layerIndex}:${paramName}`, value);
}

/** Clear all base values for a layer (sweeps BOTH banks) — call on shader/clip switch */
export function clearBaseValues(layerIndex: number) {
  const aPrefix = `A:${layerIndex}:`;
  const bPrefix = `B:${layerIndex}:`;
  const legacy = `${layerIndex}:`;
  for (const key of baseValues.keys()) {
    if (key.startsWith(aPrefix) || key.startsWith(bPrefix) || key.startsWith(legacy)) {
      baseValues.delete(key);
    }
  }
}

function rebuildParsedCache(map: ModulationMap) {
  parsedCache = [];
  for (const [key, mod] of map) {
    const parts = key.split(':');

    // Special: crossfader value target
    if (parts[0] === 'xfade' && parts[1] === 'value') {
      parsedCache.push({
        mod,
        special: 'xfade-value',
        bank: 'A',
        target: 'vj',
        layerIndex: -1,
        isEffect: false,
        isEdgeEffect: false,
        isGPU: false,
        isSplat: false,
        effectId: '',
        paramName: '',
      });
      continue;
    }

    // Target prefix detection:
    //   "vjc:CLIPID:..." → vj target, clip-keyed (preferred)
    //   "map:..."        → mapping target (no banks)
    //   "B:..."          → vj target, Bank B
    //   otherwise        → vj target, Bank A (legacy layer-keyed)
    let target: ModTarget = 'vj';
    let bank: 'A' | 'B' = 'A';
    let cursor = 0;
    if (parts[0] === 'vjc') {
      // vjc:CLIPID:paramName  — layerIndex is resolved per-frame by
      // searching deck layerStates for the clip ID. paramName can
      // include colons (rare but possible) so rejoin everything
      // after the clipId.
      parsedCache.push({
        mod,
        bank: 'A',
        target: 'vj',
        clipId: parts[1],
        layerIndex: -1,
        isEffect: false,
        isEdgeEffect: false,
        isGPU: false,
        isSplat: false,
        effectId: '',
        paramName: parts.slice(2).join(':'),
      });
      continue;
    }
    if (parts[0] === 'map') {
      target = 'mapping';
      cursor = 1;
    } else if (parts[0] === 'B') {
      bank = 'B';
      cursor = 1;
    }

    const layerIndex = parseInt(parts[cursor], 10);
    if (isNaN(layerIndex)) continue;

    if (parts[cursor + 1] === 'fx') {
      parsedCache.push({
        mod,
        bank,
        target,
        layerIndex,
        isEffect: true,
        isEdgeEffect: false,
        isGPU: false,
        isSplat: false,
        effectId: parts[cursor + 2],
        paramName: parts[cursor + 3],
      });
    } else if (parts[cursor + 1] === 'edge') {
      // Edge effect path may contain dots (`stroke.width`) — rejoin
      // anything after the effect id so the nested path is preserved
      // intact. Splitting was on `:` only, so dots in paramName are safe.
      parsedCache.push({
        mod,
        bank,
        target,
        layerIndex,
        isEffect: false,
        isEdgeEffect: true,
        isGPU: false,
        isSplat: false,
        effectId: parts[cursor + 2],
        paramName: parts.slice(cursor + 3).join(':'),
      });
    } else if (parts[cursor + 1] === 'gpu') {
      // GPU shader-layer param: map:N:gpu:paramKey (mapping-only).
      // paramKey may contain colons in theory, rejoin to preserve.
      parsedCache.push({
        mod,
        bank,
        target,
        layerIndex,
        isEffect: false,
        isEdgeEffect: false,
        isGPU: true,
        isSplat: false,
        effectId: '',
        paramName: parts.slice(cursor + 2).join(':'),
      });
    } else if (parts[cursor + 1] === 'splat') {
      parsedCache.push({
        mod,
        bank,
        target,
        layerIndex,
        isEffect: false,
        isEdgeEffect: false,
        isGPU: false,
        isSplat: true,
        effectId: '',
        paramName: parts.slice(cursor + 2).join(':'),
      });
    } else {
      parsedCache.push({
        mod,
        bank,
        target,
        layerIndex,
        isEffect: false,
        isEdgeEffect: false,
        isGPU: false,
        isSplat: false,
        effectId: '',
        paramName: parts[cursor + 1],
      });
    }
  }
}

// Store for modulation assignments
function createModulationStore() {
  const { subscribe, update, set } = writable<ModulationMap>(new Map());

  // Rebuild parsed cache whenever store changes. ALSO auto-start
  // the modulation engine when there are mods to apply — previously
  // the engine only started when audio.isActive flipped true, which
  // froze pure-auto modulations indefinitely (they don't need
  // audio). Triggering on parsedCache > 0 makes the engine pick up
  // any mod regardless of source.
  subscribe(map => {
    rebuildParsedCache(map);
    // Any store change is a chance to re-baseline the dt clock so
    // the next applyModulations() doesn't compute a freak dt against
    // a long-stale lastApplyTimeSec from a previous mode's session.
    // Without this the first tick after a mode switch can clamp dt
    // to 0 and the playhead appears paused for a moment.
    //
    // Both engine calls are gated on parsedCache.length > 0 because
    // svelte writable invokes the subscriber synchronously with the
    // initial empty map BEFORE `modulationEngine` is declared below
    // — touching the const at that point would throw a TDZ
    // ReferenceError. On the initial empty fire we have no work to
    // do anyway.
    if (parsedCache.length > 0) {
      modulationEngine.resetDtBaseline();
      if (!modulationEngine.running) {
        modulationEngine.start();
      }
    }
  });

  return {
    subscribe,

    /** Set modulation for a specific layer+param (shader). When
     *  clipId is provided for a VJ target, the mod is stored under
     *  a per-clip (vjc:) key — survives clip switching, doesn't
     *  bleed across shaders with the same param name. */
    setModulation(layerIndex: number, paramName: string, mod: ParamModulation, bank: 'A' | 'B' = 'A', target?: ModTarget, clipId?: string) {
      const t = target ?? mod.target ?? 'vj';
      const stored: ParamModulation = { ...mod, target: t };
      update(map => {
        const newMap = new Map(map);
        const key = modKeyShader(layerIndex, paramName, bank, t, clipId);
        if (stored.source === 'manual') {
          newMap.delete(key);
        } else {
          newMap.set(key, stored);
        }
        return newMap;
      });
    },

    /** Get modulation for a specific layer+param (shader). */
    getModulation(layerIndex: number, paramName: string, bank: 'A' | 'B' = 'A', target: ModTarget = 'vj', clipId?: string): ParamModulation | undefined {
      const map = get({ subscribe });
      return map.get(modKeyShader(layerIndex, paramName, bank, target, clipId));
    },

    /** Set modulation for an effect parameter. Target defaults to
     *  'vj' for back-compat with callers that haven't been updated,
     *  but mapping-mode UI (EffectParamRow et al.) passes 'mapping'
     *  so the engine routes through the mapping updater instead of
     *  the VJ deck updater. The `target` field on the stored mod is
     *  stamped to match the key prefix so engine routing stays in
     *  sync. */
    setEffectModulation(layerIndex: number, effectId: string, paramName: string, mod: ParamModulation, bank: 'A' | 'B' = 'A', target?: ModTarget) {
      const t = target ?? mod.target ?? 'vj';
      const stored: ParamModulation = { ...mod, target: t };
      update(map => {
        const newMap = new Map(map);
        const key = modKeyEffect(layerIndex, effectId, paramName, bank, t);
        if (stored.source === 'manual') {
          newMap.delete(key);
        } else {
          newMap.set(key, stored);
        }
        return newMap;
      });
    },

    /** Get modulation for an effect parameter. */
    getEffectModulation(layerIndex: number, effectId: string, paramName: string, bank: 'A' | 'B' = 'A', target: ModTarget = 'vj'): ParamModulation | undefined {
      const map = get({ subscribe });
      return map.get(modKeyEffect(layerIndex, effectId, paramName, bank, target));
    },

    /** Set modulation on an edge-effect param. `paramPath` is the
     *  dotted nested path (e.g. `'stroke.width'`, `'fill.opacity'`).
     *  Bank A only — edge effects don't participate in VJ A/B banking.
     *  Target defaults to 'mapping' since edge effects only live on
     *  mapping layers; engine routing needs the map: prefix so it
     *  goes through _mappingEdgeEffectUpdater. */
    setEdgeEffectModulation(layerIndex: number, effectId: string, paramPath: string, mod: ParamModulation, target: ModTarget = 'mapping') {
      const stored: ParamModulation = { ...mod, target };
      update(map => {
        const newMap = new Map(map);
        const key = modKeyEdgeEffect(layerIndex, effectId, paramPath, 'A', target);
        if (stored.source === 'manual') {
          newMap.delete(key);
        } else {
          newMap.set(key, stored);
        }
        return newMap;
      });
    },

    /** Get modulation for an edge-effect param. */
    getEdgeEffectModulation(layerIndex: number, effectId: string, paramPath: string, target: ModTarget = 'mapping'): ParamModulation | undefined {
      const map = get({ subscribe });
      return map.get(modKeyEdgeEffect(layerIndex, effectId, paramPath, 'A', target));
    },

    /** Set modulation on a GPU shader-layer param. Mapping-only —
     *  there's no VJ-mode GPU surface yet. Stamps `target='mapping'`
     *  on the stored mod so the engine routes through the gpu updater. */
    setGPUParamModulation(layerIndex: number, paramKey: string, mod: ParamModulation) {
      const stored: ParamModulation = { ...mod, target: 'mapping' };
      update(map => {
        const newMap = new Map(map);
        const key = modKeyGPU(layerIndex, paramKey, 'mapping');
        if (stored.source === 'manual') {
          newMap.delete(key);
        } else {
          newMap.set(key, stored);
        }
        return newMap;
      });
    },

    /** Get modulation for a GPU shader-layer param. */
    getGPUParamModulation(layerIndex: number, paramKey: string): ParamModulation | undefined {
      const map = get({ subscribe });
      return map.get(modKeyGPU(layerIndex, paramKey, 'mapping'));
    },

    setSplatParamModulation(layerIndex: number, paramKey: string, mod: ParamModulation) {
      const stored: ParamModulation = { ...mod, target: 'mapping' };
      update(map => {
        const newMap = new Map(map);
        const key = modKeySplat(layerIndex, paramKey, 'mapping');
        if (stored.source === 'manual') {
          newMap.delete(key);
        } else {
          newMap.set(key, stored);
        }
        return newMap;
      });
    },

    getSplatParamModulation(layerIndex: number, paramKey: string): ParamModulation | undefined {
      const map = get({ subscribe });
      return map.get(modKeySplat(layerIndex, paramKey, 'mapping'));
    },

    /** Set modulation on the global VJ A/B crossfader value (0..1).
     * Source signal drives the fader directly — useful for audio-driven
     * auto-mixing (e.g. kick drum → snap to Deck A). */
    setCrossfaderModulation(mod: ParamModulation) {
      update(map => {
        const newMap = new Map(map);
        if (mod.source === 'manual') {
          newMap.delete(MOD_KEY_XFADE_VALUE);
        } else {
          newMap.set(MOD_KEY_XFADE_VALUE, mod);
        }
        return newMap;
      });
    },

    /** Get the crossfader-value modulation (or undefined if manual). */
    getCrossfaderModulation(): ParamModulation | undefined {
      const map = get({ subscribe });
      return map.get(MOD_KEY_XFADE_VALUE);
    },

    /** Remove all modulations for a layer (sweeps BOTH banks). Also
     *  purges the per-key base-value and last-modulated-value caches so
     *  the next modulation assignment on this layer captures a fresh
     *  base — without this, callers had to remember to call
     *  clearBaseValues + clearModulatedValues themselves and most don't. */
    clearLayer(layerIndex: number) {
      update(map => {
        const newMap = new Map(map);
        const aPrefix = `${layerIndex}:`;
        const bPrefix = `B:${layerIndex}:`;
        for (const key of map.keys()) {
          if (key.startsWith(bPrefix)) {
            newMap.delete(key);
          } else if (key.startsWith(aPrefix) && !key.startsWith('B:')) {
            // Match bare-layer (Bank A legacy format) without picking up
            // partial matches like "10:..." when clearing layer 1.
            const next = key[aPrefix.length];
            if (next !== undefined) newMap.delete(key);
          }
        }
        return newMap;
      });
      // Helper-cache cleanup — same prefix logic as the cache helpers
      // exported below. Without this, stale base values cause modulation
      // to "snap to the wrong slider position" on re-assignment.
      clearBaseValues(layerIndex);
      clearModulatedValues(layerIndex);
    },

    /** Clear everything — including the crossfader entry. */
    clearAll() {
      set(new Map());
    },

    /** Replace the entire modulation map with one rebuilt from raw
     *  `[key, ParamModulation]` entries. Used by project import — the
     *  exporter dumps the raw map verbatim, so import has to feed the
     *  raw keys back in (NOT re-parse them through setModulation, which
     *  would re-encode and mangle multi-prefix keys like
     *  `B:N:fx:eff:param` or `xfade:value`). */
    bulkLoad(entries: Array<{ key: string; mod: ParamModulation }>) {
      const m = new Map<string, ParamModulation>();
      for (const { key, mod } of entries) {
        if (typeof key === 'string' && key.length > 0 && mod) m.set(key, mod);
      }
      set(m);
    },
  };
}

export const modulationStore = createModulationStore();

// ─── Shared helpers (used by VJModePanel, MediaTray, SynthVision) ───

/** Set or clear a shader param's modulation source. Starts engine
 *  if needed. `target` says which render-graph side this
 *  modulation drives — 'vj' for clip-bound shaders, 'mapping' for
 *  mapping-layer shaders. Each UI panel passes its own target so
 *  VJ and mapping mods coexist in the store under separate keys. */
export function setParamModSource(layerIndex: number, paramName: string, source: ModSource, bank: 'A' | 'B' = 'A', target: ModTarget = 'vj', clipId?: string) {
  if (source === 'manual') {
    modulationStore.setModulation(layerIndex, paramName, { source: 'manual', target, ...DEFAULT_MOD }, bank, target, clipId);
  } else {
    const existing = modulationStore.getModulation(layerIndex, paramName, bank, target, clipId);
    // For 'auto' source, seed the playhead fields if the existing
    // mod doesn't have them (e.g. user is switching from 'manual'
    // straight to 'auto'). Without these defaults the engine would
    // tick with autoSpeedHz=undefined and the param would freeze.
    const isAuto = source === 'auto';
    modulationStore.setModulation(layerIndex, paramName, {
      source,
      target,
      amount: existing?.amount ?? DEFAULT_MOD.amount,
      speed: existing?.speed ?? DEFAULT_MOD.speed,
      invert: existing?.invert ?? DEFAULT_MOD.invert,
      // Carry over auto-fields when the mod was already in auto
      // mode, otherwise seed from DEFAULT_MOD. autoPlaying defaults
      // true so picking "Auto" immediately starts the sweep — user
      // can hit pause if they want to dial in min/max first.
      autoPhase: existing?.autoPhase ?? DEFAULT_MOD.autoPhase,
      autoMode: existing?.autoMode ?? DEFAULT_MOD.autoMode,
      autoSpeedHz: existing?.autoSpeedHz ?? DEFAULT_MOD.autoSpeedHz,
      autoMin: existing?.autoMin ?? DEFAULT_MOD.autoMin,
      autoMax: existing?.autoMax ?? DEFAULT_MOD.autoMax,
      // Picking "Auto" from the dropdown always starts the playhead
      // in PLAYING state — the user is asking for animation, not
      // re-establishing a previously-paused config. They can pause
      // via the button afterwards if they want. Previously we
      // carried over `existing?.autoPlaying` which made a paused
      // mod from a prior session re-open paused; the user reported
      // this as "i have to click pause then play to get it to work".
      autoPlaying: isAuto ? true : DEFAULT_MOD.autoPlaying,
    }, bank, target, clipId);
  }
  if (source !== 'manual' && !modulationEngine.running) {
    modulationEngine.start();
  }
}

/** Merge a partial update into an existing shader-param modulation.
 *  MUST be called with the same (bank, target, clipId) addressing the
 *  mod was created with — a clip-keyed (vjc:) mod is invisible to a
 *  layer-keyed lookup and vice versa. The old amount/speed setters
 *  hardcoded the layer-keyed vj lookup, which made the VJ panel's
 *  Depth/Speed sliders (clip-keyed) and MediaTray's depth slider
 *  (mapping-keyed) silent no-ops. */
export function updateParamMod(
  layerIndex: number,
  paramName: string,
  patch: Partial<ParamModulation>,
  bank: 'A' | 'B' = 'A',
  target: ModTarget = 'vj',
  clipId?: string,
) {
  const existing = modulationStore.getModulation(layerIndex, paramName, bank, target, clipId);
  if (existing) {
    modulationStore.setModulation(layerIndex, paramName, { ...existing, ...patch }, bank, target, clipId);
  }
}

/** Update modulation depth for a shader param */
export function setParamModAmount(layerIndex: number, paramName: string, amount: number, bank: 'A' | 'B' = 'A', target: ModTarget = 'vj', clipId?: string) {
  updateParamMod(layerIndex, paramName, { amount }, bank, target, clipId);
}

/** Update LFO speed for a shader param */
export function setParamModSpeed(layerIndex: number, paramName: string, speed: number, bank: 'A' | 'B' = 'A', target: ModTarget = 'vj', clipId?: string) {
  updateParamMod(layerIndex, paramName, { speed }, bank, target, clipId);
}

/** Convenience: set/clear crossfader modulation source. Mirrors setParamModSource. */
export function setCrossfaderModSource(source: ModSource) {
  if (source === 'manual') {
    modulationStore.setCrossfaderModulation({ source: 'manual', ...DEFAULT_MOD });
  } else {
    const existing = modulationStore.getCrossfaderModulation();
    modulationStore.setCrossfaderModulation({
      source,
      amount: existing?.amount ?? DEFAULT_MOD.amount,
      speed: existing?.speed ?? DEFAULT_MOD.speed,
      invert: existing?.invert ?? DEFAULT_MOD.invert,
      bpmSync: existing?.bpmSync ?? DEFAULT_MOD.bpmSync,
    });
  }
  if (source !== 'manual' && !modulationEngine.running) {
    modulationEngine.start();
  }
}

// Modulation engine - runs each frame
class ModulationEngine {
  private animFrameId: number | null = null;
  private isRunning = false;
  private startTime = 0;

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.startTime = performance.now();
    // Reset the dt-history reference too, otherwise after a stop /
    // start cycle the new session's `now` (which starts back near 0
    // because startTime was just reset) appears to go BACKWARDS
    // relative to lastApplyTimeSec from the old session, making dt
    // clamp to 0 for many seconds. That manifests as auto-mods
    // looking "stuck" right after a re-trigger.
    this.lastApplyTimeSec = 0;
    this.tick();
  }

  stop() {
    this.isRunning = false;
    this.lastApplyTimeSec = 0;
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }

  /** External signal — called by the modulationStore subscriber when
   *  the map changes (mode switch, user adds/removes mods, etc.) so
   *  the next tick recomputes dt from the current `now` and doesn't
   *  carry stale time deltas across the change. */
  resetDtBaseline() {
    this.lastApplyTimeSec = 0;
  }

  get running() {
    return this.isRunning;
  }

  private tick = () => {
    if (!this.isRunning) return;

    // Auto-stop when nothing to modulate
    if (parsedCache.length === 0) {
      this.stop();
      return;
    }

    this.applyModulations();
    this.animFrameId = requestAnimationFrame(this.tick);
  };

  /** Wall-clock time of the previous applyModulations call. Used to
   *  derive `dt` so the auto-playhead phase advances by exactly
   *  `speedHz × dt` per frame regardless of RAF cadence. */
  private lastApplyTimeSec = 0;

  private applyModulations() {
    const audio = get(audioStore);
    const now = (performance.now() - this.startTime) / 1000;
    // Every ~1s, dump the full parsedCache contents so we can see
    // whether multiple mods are actually present and being iterated.
    // Set window.__modCacheDebug=true in console to enable.
    if ((globalThis as any).__modCacheDebug) {
      if (!(globalThis as any).__modCacheDumpAt) (globalThis as any).__modCacheDumpAt = 0;
      const nowMs = performance.now();
      if (nowMs - (globalThis as any).__modCacheDumpAt > 1000) {
        (globalThis as any).__modCacheDumpAt = nowMs;
        console.log('[modEngine] parsedCache contents:', parsedCache.length, 'entries');
        for (const e of parsedCache) {
          console.log('  →', { target: e.target, layer: e.layerIndex, isEffect: e.isEffect, isEdge: e.isEdgeEffect, fx: e.effectId.slice(0, 8), param: e.paramName, src: e.mod.source, phase: typeof e.mod.autoPhase === 'number' ? e.mod.autoPhase.toFixed(3) : '-', playing: e.mod.autoPlaying });
        }
      }
    }
    // dt: clamp to a reasonable window so a tab-suspend / hitch
    // doesn't dump 30s of phase advance into one frame and make
    // automated params snap visibly. 100ms cap = 1.5x normal RAF
    // frame which is enough headroom to recover from a stutter
    // without producing a visible jump.
    const dt = this.lastApplyTimeSec > 0
      ? Math.min(0.1, Math.max(0, now - this.lastApplyTimeSec))
      : 0.016;
    this.lastApplyTimeSec = now;
    const vjState = get(vjClipLauncher);

    // Batch shader updates per (bank, layerIndex). Bank A and Bank B route
    // to separate state slices, so they need separate buckets.
    const vjBatchA = new Map<number, Record<string, number>>();
    const vjBatchB = new Map<number, Record<string, number>>();
    const mappingBatch = new Map<number, Record<string, number>>();
    // GPU shader-layer params live on `layer.gpuLayerContent.params`,
    // mapping-only. Batched per-layer just like shader params so one
    // updater call writes all modulated entries for the frame.
    const mappingGPUBatch = new Map<number, Record<string, number>>();
    const mappingSplatBatch = new Map<number, Record<string, number>>();

    for (const entry of parsedCache) {
      // Per-iteration shadowing of bank/layerIndex — clip-keyed
      // entries override these from the runtime deck search below.
      let { bank, layerIndex } = entry;
      const { mod, isEffect, isEdgeEffect, isGPU, isSplat, effectId, paramName, special } = entry;

      // Auto-source modulations are handled exclusively by autoEngine.ts
      // now — state lives on the layer / clip data itself. Legacy
      // project files may still carry `source: 'auto'` entries in their
      // saved modulation map; ignore them here so the audio engine
      // doesn't double-drive on top of the sidecar's writes.
      if (mod.source === 'auto') continue;

      // Clip-keyed (vjc:) entries — resolve which deck/layer
      // currently has this clip active, write there. Mod stays in
      // the store regardless; if the clip isn't on any deck right
      // now, we just skip this frame's write (mod is dormant). This
      // is what makes per-clip automation survive clip switching:
      // the clip keeps its own auto setup, ready to resume when
      // the user re-fires it.
      if (entry.clipId) {
        let foundLayer = -1;
        let foundBank: 'A' | 'B' = 'A';
        for (let i = 0; i < vjState.layerStates.length; i++) {
          if (vjState.layerStates[i]?.activeClip?.id === entry.clipId) {
            foundLayer = i;
            foundBank = 'A';
            break;
          }
        }
        if (foundLayer < 0) {
          for (let i = 0; i < vjState.bankBLayerStates.length; i++) {
            if (vjState.bankBLayerStates[i]?.activeClip?.id === entry.clipId) {
              foundLayer = i;
              foundBank = 'B';
              break;
            }
          }
        }
        if (foundLayer < 0) {
          // One-shot diagnostic so we can see clip-keyed mods being
          // skipped because their clip isn't where we expect. Logs
          // each entry once via a Set so the console stays sane
          // during a 60Hz tick.
          if (!(globalThis as any).__loggedDormantClips) (globalThis as any).__loggedDormantClips = new Set();
          const tag = entry.clipId + ':' + entry.paramName;
          if (!(globalThis as any).__loggedDormantClips.has(tag)) {
            (globalThis as any).__loggedDormantClips.add(tag);
            const a = vjState.layerStates.map(ls => ls?.activeClip?.id ?? '·').join('|');
            const b = vjState.bankBLayerStates.map(ls => ls?.activeClip?.id ?? '·').join('|');
            console.log('[modEngine] vjc dormant — clipId not active on any deck. clipId=', entry.clipId, ' param=', entry.paramName, ' deckA=', a, ' deckB=', b);
          }
          continue;
        }
        layerIndex = foundLayer;
        bank = foundBank;
      }

      // Auto-source phase advance + write was here. Now lives in
      // autoEngine.ts which drives the per-param sidecar. Entries
      // with source='auto' are skipped at the top of the loop so
      // any legacy 'auto' mods loaded from old projects don't
      // double-write on top of the autoEngine's output.

      let signal = this.getSignal(mod.source, audio, now, mod.speed, mod.bpmSync === true, mod);
      if (mod.invert) signal = 1 - signal;

      // ===== Special: crossfader value =====
      // Modulates the global A/B fader 0..1 directly. No base-value tracking
      // because the fader itself IS the live value — we just write the signal
      // (scaled by amount) on top of a 0.5 midpoint so amount=0 leaves the
      // fader at center.
      if (special === 'xfade-value') {
        // amount=1 → full 0..1 sweep, amount=0 → no movement.
        const modulated = Math.max(0, Math.min(1, 0.5 + (signal - 0.5) * mod.amount * 2));
        lastModulatedValues.set(MOD_KEY_XFADE_VALUE, modulated);
        vjClipLauncher.setCrossfaderValue(modulated);
        continue;
      }

      // Route by the modulation's own target (set at creation time
      // by the UI panel that owns this binding) — NOT the legacy
      // global `_isMappingLayer(layerIndex)` flag which assumed
      // one mode active at a time. With target-aware routing, a VJ
      // auto-modulation keeps driving its clip even while the user
      // is browsing mapping mode in another panel, and vice versa.
      // Falls back to the legacy probe only when target is absent
      // (old projects loaded without the field).
      const isMapping = entry.target === 'mapping';
      // Validate layer index. Bank B uses bankBLayerStates which is the same
      // length as numLayers (the store keeps them in sync).
      if (!isMapping && (layerIndex < 0 || layerIndex >= vjState.numLayers)) continue;

      // Resolve the layer-state slice for this entry's bank — only matters
      // for VJ mode; mapping mode goes through its own callback so bank is
      // implicitly Bank A there (mapping doesn't have banks).
      const layerStates = (!isMapping && bank === 'B')
        ? vjState.bankBLayerStates
        : vjState.layerStates;

      if (isEdgeEffect) {
        // Edge-effect modulation. Edge effects live on
        // `layer.edgeEffects.effects[]` with a nested data shape
        // (`effect.stroke.width`, `effect.fill.opacity`, etc.) — the
        // engine writes through the registered edge updater which
        // handles the deep-merge into the right top-level object.
        //
        // Mapping mode only — VJ mode doesn't have its own edge-effects
        // state, so edge modulation is intentionally scoped to mapping.
        if (!isMapping || !_mappingEdgeEffectUpdater || !_mappingEdgeEffectReader) continue;

        const edgeKey = `${bank}:${layerIndex}:edge:${effectId}:${paramName}`;
        let edgeBase = baseValues.get(edgeKey);
        if (edgeBase === undefined) {
          const sv = _mappingEdgeEffectReader(layerIndex, effectId, paramName);
          if (typeof sv !== 'number') continue;
          edgeBase = sv;
          baseValues.set(edgeKey, edgeBase);
        }

        const edgeRange = edgeEffectParamRanges.get(`${layerIndex}:edge:${effectId}:${paramName}`);
        const eMin = edgeRange?.min ?? 0;
        const eMax = edgeRange?.max ?? 1;
        const eSpan = eMax - eMin;
        const rawE = edgeBase + (signal - 0.5) * mod.amount * eSpan;
        const modulatedE = Math.max(eMin, Math.min(eMax, rawE));

        _mappingEdgeEffectUpdater(layerIndex, effectId, paramName, modulatedE);
        lastModulatedValues.set(edgeKey, modulatedE);
      } else if (isGPU) {
        // GPU shader-layer param modulation. Mapping-only target — the
        // GPU layer panel doesn't have a VJ surface yet. Same formula
        // as shader params (base + (signal − 0.5) × amount × span) so
        // audio sources modulate around the user's manual slider value.
        const gpuKey = `M:${layerIndex}:gpu:${paramName}`;  // 'M' to disambiguate from VJ banks
        const gpuRange = paramRanges.get(`map:${layerIndex}:gpu:${paramName}`);
        const gMin = gpuRange?.min ?? 0;
        const gMax = gpuRange?.max ?? 1;
        const gSpan = gMax - gMin;
        let gBase = baseValues.get(gpuKey);
        if (gBase === undefined) {
          const sv = _mappingGPUReader ? _mappingGPUReader(layerIndex, paramName) : undefined;
          if (typeof sv !== 'number') {
            // Param hasn't been written yet (e.g. shader just loaded and
            // schema defaults not flushed). Retry next frame once the
            // value lands.
            continue;
          }
          gBase = sv;
          baseValues.set(gpuKey, gBase);
        }
        const rawG = gBase + (signal - 0.5) * mod.amount * gSpan;
        const modulatedG = Math.max(gMin, Math.min(gMax, rawG));
        let gBatch = mappingGPUBatch.get(layerIndex);
        if (!gBatch) { gBatch = {}; mappingGPUBatch.set(layerIndex, gBatch); }
        gBatch[paramName] = modulatedG;
        lastModulatedValues.set(gpuKey, modulatedG);
      } else if (isSplat) {
        const splatKey = `M:${layerIndex}:splat:${paramName}`;
        const splatRange = paramRanges.get(`map:${layerIndex}:splat:${paramName}`);
        const sMin = splatRange?.min ?? 0;
        const sMax = splatRange?.max ?? 1;
        const sSpan = sMax - sMin;
        let sBase = baseValues.get(splatKey);
        if (sBase === undefined) {
          const sourceValue = _mappingSplatReader
            ? _mappingSplatReader(layerIndex, paramName)
            : undefined;
          if (typeof sourceValue !== 'number') continue;
          sBase = sourceValue;
          baseValues.set(splatKey, sBase);
        }
        const rawSplat = sBase + (signal - 0.5) * mod.amount * sSpan;
        const modulatedSplat = Math.max(sMin, Math.min(sMax, rawSplat));
        let splatBatch = mappingSplatBatch.get(layerIndex);
        if (!splatBatch) {
          splatBatch = {};
          mappingSplatBatch.set(layerIndex, splatBatch);
        }
        splatBatch[paramName] = modulatedSplat;
        lastModulatedValues.set(splatKey, modulatedSplat);
      } else if (isEffect) {
        // Effect param modulation. Mapping mode + VJ mode share the same
        // math (capture base on first hit, signal-driven offset, clamp to
        // the registered range) but write to different places — mapping
        // hits the layer's effect via the project store callback, VJ hits
        // the layer-state effect via vjClipLauncher.

        // Base-value cache key — mapping uses bank='A' implicitly (no
        // banks in mapping mode), VJ uses the real bank so A and B effects
        // on the same row don't share a base.
        const fxKey = `${bank}:${layerIndex}:fx:${effectId}:${paramName}`;
        let fxBase = baseValues.get(fxKey);
        if (fxBase === undefined) {
          let sv: number | undefined;
          if (isMapping && _mappingEffectReader) {
            sv = _mappingEffectReader(layerIndex, effectId, paramName);
          } else if (!isMapping) {
            const layerState = layerStates[layerIndex];
            const effect = layerState?.effects.find(e => e.id === effectId);
            if (!effect) continue;
            const fxParam = (effect.params as Record<string, number>)[paramName];
            sv = typeof fxParam === 'number' ? fxParam : undefined;
          }
          // Auto-source doesn't use the base value (raw = range.min +
          // signal × span). Audio / LFO sources do, because their
          // formula is `base + (signal − 0.5) × amount × span`. So:
          //   - auto: missing base is fine, fall back to 0 and continue
          //   - others: bail this frame, try again next tick
          //
          // Before this guard, picking Auto on a freshly-added effect
          // whose params object was still empty made the engine `continue`
          // forever — no value was ever written, the mod looked dormant.
          // Most-recent-layer worked because by the time the user picked
          // Auto there, they had moved the slider once (which writes a
          // numeric value into params) so capture succeeded. Older
          // layers that the user picked Auto on without first moving
          // the slider were the ones stuck.
          if (typeof sv !== 'number') {
            continue;
          }
          fxBase = sv;
          baseValues.set(fxKey, fxBase);
        }

        // Pull the registered slider range so modulation scales naturally
        // to the param's actual scope (e.g. a 0..10 displacement amplitude
        // doesn't get clamped to 0..1). Falls back to 0..1 for legacy
        // unregistered params so the old VJ-mode behavior is preserved.
        const fxRange = effectParamRanges.get(`${layerIndex}:fx:${effectId}:${paramName}`);
        const fxMin = fxRange?.min ?? 0;
        const fxMax = fxRange?.max ?? 1;
        const fxSpan = fxMax - fxMin;
        const raw = fxBase + (signal - 0.5) * mod.amount * fxSpan;
        const modulated = Math.max(fxMin, Math.min(fxMax, raw));

        if (isMapping) {
          if (_mappingEffectUpdater) {
            _mappingEffectUpdater(layerIndex, effectId, { [paramName]: modulated });
            // Tick-counted diagnostic so we can see whether EACH mod
            // is still being ticked after layer switches. Logs every
            // 120 frames (~2s) per (layer, effect, param). If after a
            // layer switch one mod's line stops while another's
            // continues, that's the engine actually halting the
            // mod. Clear `window.__modFxCounters` to reset cadence.
            if (!(globalThis as any).__modFxCounters) (globalThis as any).__modFxCounters = new Map<string, number>();
            const tag = `${layerIndex}:${effectId.slice(0, 8)}:${paramName}`;
            const counters = (globalThis as any).__modFxCounters as Map<string, number>;
            const n = (counters.get(tag) ?? 0) + 1;
            counters.set(tag, n);
            if (n % 120 === 1) {
              console.log('[modEngine] fx-tick #' + n, tag, ' val=', modulated.toFixed(3));
            }
          }
        } else {
          vjClipLauncher.updateLayerEffectParams(layerIndex, effectId, { [paramName]: modulated }, bank);
        }
        lastModulatedValues.set(fxKey, modulated);
      } else if (!isEffect) {
        // Shader params — works for VJ (both banks) and mapping mode.
        const bvKey = `${bank}:${layerIndex}:${paramName}`;
        // Range lookup uses the namespaced key matching whichever
        // namespace the panel registered under. Clip-keyed entries
        // get clip-prefixed ranges (shader-specific, independent of
        // layer). Layer-keyed VJ entries get `vj:` ranges. Mapping
        // entries get `map:` ranges. Falls through to the legacy
        // unprefixed key for any data carried over from older builds.
        let range = entry.clipId
          ? paramRanges.get(`vjc:${entry.clipId}:${paramName}`)
          : (isMapping
              ? paramRanges.get(`map:${layerIndex}:${paramName}`)
              : paramRanges.get(`vj:${layerIndex}:${paramName}`));
        if (!range) {
          // Legacy fallback so projects from before the namespace
          // refactor still find their ranges.
          range = paramRanges.get(`${layerIndex}:${paramName}`);
        }
        let base = baseValues.get(bvKey);

        if (base === undefined) {
          // First frame: capture current value as the base
          let sv: number | undefined;
          if (isMapping && _mappingLayerReader) {
            sv = _mappingLayerReader(layerIndex, paramName);
          } else {
            const layerState = layerStates[layerIndex];
            if (!layerState?.activeClip) continue;
            sv = layerState.activeClip.shaderValues?.[paramName] as number | undefined;
          }
          if (typeof sv === 'number') {
            base = sv;
          } else {
            base = range ? (range.min + range.max) / 2 : 0.5;
          }
          baseValues.set(bvKey, base);
        }

        // Scale modulation relative to param range, clamp to ISF min/max.
        // Audio sources modulate AROUND the slider's base value
        // (`(signal - 0.5) * amount` recentered formula).
        const span = range ? (range.max - range.min) : 2;
        const raw = base + (signal - 0.5) * mod.amount * span;
        const modulated = range ? Math.max(range.min, Math.min(range.max, raw)) : raw;
        // Ghost-indicator cache also keyed by bank
        lastModulatedValues.set(bvKey, modulated);

        // Batch by destination
        const batch = isMapping
          ? mappingBatch
          : (bank === 'B' ? vjBatchB : vjBatchA);
        let layerBatch = batch.get(layerIndex);
        if (!layerBatch) {
          layerBatch = {};
          batch.set(layerIndex, layerBatch);
        }
        layerBatch[paramName] = modulated;
      }
    }

    // Apply batched VJ shader updates per bank
    for (const [layerIndex, values] of vjBatchA) {
      vjClipLauncher.batchUpdateShaderValues(layerIndex, values, 'A');
    }
    for (const [layerIndex, values] of vjBatchB) {
      vjClipLauncher.batchUpdateShaderValues(layerIndex, values, 'B');
    }

    // Apply batched mapping mode shader updates
    if (_mappingLayerUpdater) {
      for (const [layerIndex, values] of mappingBatch) {
        _mappingLayerUpdater(layerIndex, values);
      }
    }

    // Apply batched GPU-layer param updates (mapping-only).
    if (_mappingGPUUpdater) {
      for (const [layerIndex, values] of mappingGPUBatch) {
        _mappingGPUUpdater(layerIndex, values);
      }
    }

    if (_mappingSplatUpdater) {
      for (const [layerIndex, values] of mappingSplatBatch) {
        _mappingSplatUpdater(layerIndex, values);
      }
    }
  }

  private getSignal(source: ModSource, audio: AudioState, time: number, speed: number, bpmSync: boolean, mod?: ParamModulation): number {
    const visual = getVisualAudioSnapshot();
    // Audio bands/envelopes are unipolar control signals: silence should
    // mean "stay at the user's base value", not "pull below base". Map
    // smooth 0..1 visual energy to 0.5..1 so the existing centered formula
    // (`base + (signal - 0.5) * amount * span`) becomes additive. Invert
    // still works as an intentional subtractive response.
    const audioUp = (v: number) => 0.5 + Math.max(0, Math.min(1, v)) * 0.5;
    switch (source) {
      case 'sub':       return audioUp(visual.sub);
      case 'bass':      return audioUp(visual.bass);
      case 'lowMid':    return audioUp(visual.lowMid);
      case 'mid':       return audioUp(visual.mid);
      case 'highMid':   return audioUp(visual.highMid);
      case 'treble':    return audioUp(visual.treble);
      case 'air':       return audioUp(visual.air);
      case 'presence':  return audioUp(visual.presence);
      case 'high':      return audioUp(visual.high);
      case 'amplitude': return audioUp(visual.level);
      case 'beatPhase': return visual.beatPhase;
      // Kick / snare are onset-based one-shots: shape an exponential decay
      // from the onset so the modulation reads as a hit, not a level.
      // ~150ms decay window matches the eye's perception of a flash.
      case 'kick':      return audioUp(visual.kick);
      case 'snare':     return audioUp(visual.snare);
      // LFOs: bpmSync reinterprets `speed` from "cycles per second" to
      // "cycles per beat". effectiveRate = speed × (bpm/60). When no BPM
      // is detected (bpm=0) fall back to the manual speed so the LFO
      // keeps running instead of freezing.
      case 'lfo-sine': {
        const rate = bpmSync && audio.bpm > 0 ? speed * (audio.bpm / 60) : speed;
        return (Math.sin(time * rate * Math.PI * 2) + 1) / 2;
      }
      case 'lfo-saw': {
        const rate = bpmSync && audio.bpm > 0 ? speed * (audio.bpm / 60) : speed;
        return (time * rate) % 1;
      }
      case 'lfo-square': {
        const rate = bpmSync && audio.bpm > 0 ? speed * (audio.bpm / 60) : speed;
        return (Math.sin(time * rate * Math.PI * 2) > 0) ? 1 : 0;
      }
      case 'lfo-tri': {
        const rate = bpmSync && audio.bpm > 0 ? speed * (audio.bpm / 60) : speed;
        const phase = (time * rate) % 1;
        return phase < 0.5 ? phase * 2 : 2 - phase * 2;
      }
      // Per-param playhead automation. Phase advancement happens
      // in applyModulations() (so it can use frame dt and respect
      // autoPlaying); here we just shape the stored phase into a
      // saw (loop) or triangle (pingpong) and clip into the user's
      // autoMin..autoMax sub-range. Result is a value 0..1 that
      // the downstream `(signal - 0.5) * amount` formula maps onto
      // the param's full range — to make the param sweep cleanly
      // through autoMin..autoMax, callers should set amount=1.
      case 'auto': {
        if (!mod) return 0;
        const phase = mod.autoPhase ?? 0;
        const shaped = mod.autoMode === 'pingpong'
          ? (phase < 0.5 ? phase * 2 : 2 - phase * 2)
          : phase;
        const lo = mod.autoMin ?? 0;
        const hi = mod.autoMax ?? 1;
        return lo + shaped * (hi - lo);
      }
      default: return 0;
    }
  }
}

export const modulationEngine = new ModulationEngine();

// Auto-start engine when audio becomes active (centralized, not per-component)
audioStore.subscribe(audio => {
  if (audio.isActive && !modulationEngine.running && parsedCache.length > 0) {
    modulationEngine.start();
  }
});
