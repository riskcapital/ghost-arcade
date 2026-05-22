// Parameter Modulation Engine
// Maps shader uniform parameters to modulation sources (audio bands, BPM, LFO/time)
// Runs each frame, applying modulated values to active VJ clips and mapping layers

import { get } from 'svelte/store';
import { writable } from 'svelte/store';
import { audioStore, type AudioState } from '../stores/audio';
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

/** Register mapping mode callbacks — called once from layers store init */
export function registerMappingLayerCallbacks(
  updater: (layerIndex: number, values: Record<string, number>) => void,
  reader: (layerIndex: number, paramName: string) => number | undefined,
  isMapping: (layerIndex: number) => boolean,
  effectUpdater?: (layerIndex: number, effectId: string, values: Record<string, number>) => void,
  effectReader?: (layerIndex: number, effectId: string, paramName: string) => number | undefined,
  edgeEffectUpdater?: (layerIndex: number, effectId: string, paramPath: string, value: number) => void,
  edgeEffectReader?: (layerIndex: number, effectId: string, paramPath: string) => number | undefined,
) {
  _mappingLayerUpdater = updater;
  _mappingLayerReader = reader;
  _isMappingLayer = isMapping;
  if (effectUpdater) _mappingEffectUpdater = effectUpdater;
  if (effectReader) _mappingEffectReader = effectReader;
  if (edgeEffectUpdater) _mappingEdgeEffectUpdater = edgeEffectUpdater;
  if (edgeEffectReader) _mappingEdgeEffectReader = edgeEffectReader;
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
   *  Derived from the key prefix at parse time, then preferred over
   *  the legacy `_isMappingLayer(layerIndex)` global flag during
   *  routing — so VJ + mapping mods coexist independently regardless
   *  of which workspace the user is currently in. */
  target: ModTarget;
  /** When set (target='vj' + clip-keyed `vjc:` prefix), the engine
   *  looks up which deck/layer currently has this clip active and
   *  writes there. layerIndex is ignored in that case — the clip's
   *  position is resolved per-frame. */
  clipId?: string;
  layerIndex: number;
  isEffect: boolean;     // true for regular pixel effects (`layer.effects[]`)
  isEdgeEffect: boolean; // true for edge effects (`layer.edgeEffects.effects[]`)
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
//   target='vj' + clipId       →  "vjc:CLIPID:cameraSpeed"      (per-clip, preferred for VJ)
//   target='vj'      bank='A'   →  "0:cameraSpeed"               (legacy layer-keyed)
//   target='vj'      bank='B'   →  "B:0:cameraSpeed"             (legacy layer-keyed)
//   target='mapping'            →  "map:0:cameraSpeed"           (no banks in mapping)
//   target='vj'      effect     →  "0:fx:effectId:paramName"
//   target='mapping' effect     →  "map:0:fx:effectId:paramName"
//
// Why clip-keyed for VJ shaders:
// Performers set up automation on a per-CLIP basis ("clip A: slow
// camera sweep; clip B: nothing"). Triggering a different clip on
// the same VJ deck layer must NOT carry the previous clip's mods,
// and switching back must restore them. Layer-keyed mods used to
// either bleed across clips (when we stopped clearing on switch)
// or get wiped on every switch (when we did clear). vjc: keys are
// stable across clip switches and tied to the clip itself, so
// "this clip has automation X" travels with the clip wherever it
// goes (deck A, deck B, saved + reloaded). Layer keying stays as
// the fallback for legacy projects without clip-bound mods.
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
export function modKeyEdgeEffect(layerIndex: number, effectId: string, paramPath: string, bank: 'A' | 'B' = 'A'): string {
  return bank === 'B'
    ? `B:${layerIndex}:edge:${effectId}:${paramPath}`
    : `${layerIndex}:edge:${effectId}:${paramPath}`;
}
export const MOD_KEY_XFADE_VALUE = 'xfade:value';

// Pre-parsed cache rebuilt on store change — avoids per-frame string parsing
let parsedCache: ParsedModEntry[] = [];

// Parameter range registry — stores ISF min/max for shader params to enable clamping
// Key format: "layerIndex:paramName"
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
export function registerParamRanges(layerIndex: number, inputs: ISFInput[]) {
  // Clear old ranges for this layer
  for (const key of paramRanges.keys()) {
    if (key.startsWith(`${layerIndex}:`)) paramRanges.delete(key);
  }
  for (const input of inputs) {
    if (input.TYPE === 'float' || input.TYPE === 'long' || input.TYPE === 'event') {
      paramRanges.set(`${layerIndex}:${input.NAME}`, {
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
        effectId: '',
        paramName: '',
      });
      continue;
    }

    // Target prefix detection:
    //   "vjc:..." → vj target, clip-keyed (preferred)
    //   "map:..." → mapping target (no banks)
    //   "B:..."   → vj target, Bank B (legacy)
    //   otherwise → vj target, Bank A (legacy default)
    let target: ModTarget = 'vj';
    let bank: 'A' | 'B' = 'A';
    let cursor = 0;
    let clipId: string | undefined;
    if (parts[0] === 'vjc') {
      // vjc:<clipId>:<paramName...>  layerIndex doesn't apply here;
      // resolved per-frame by searching deck layerStates for clipId.
      target = 'vj';
      clipId = parts[1];
      parsedCache.push({
        mod,
        bank,
        target,
        clipId,
        layerIndex: -1,  // sentinel; engine resolves via clipId
        isEffect: false,
        isEdgeEffect: false,
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
        effectId: parts[cursor + 2],
        paramName: parts.slice(cursor + 3).join(':'),
      });
    } else {
      parsedCache.push({
        mod,
        bank,
        target,
        layerIndex,
        isEffect: false,
        isEdgeEffect: false,
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
    if (parsedCache.length > 0 && !modulationEngine.running) {
      modulationEngine.start();
    }
  });

  return {
    subscribe,

    /** Set modulation for a specific layer+param (shader).
     *  When `clipId` is provided, the modulation is stored under a
     *  clip-keyed `vjc:` key so it survives layer / bank reassignment
     *  and persists per-clip (the perform-ready model: each clip
     *  carries its own automation, dormant when not triggered, live
     *  when it is). Falls through to layer/bank keying otherwise. */
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

    /** Get modulation. When clipId provided, looks up the clip-keyed
     *  entry; otherwise the legacy layer-keyed entry. */
    getModulation(layerIndex: number, paramName: string, bank: 'A' | 'B' = 'A', target: ModTarget = 'vj', clipId?: string): ParamModulation | undefined {
      const map = get({ subscribe });
      return map.get(modKeyShader(layerIndex, paramName, bank, target, clipId));
    },

    /** Set modulation for an effect parameter. Bank A by default. */
    setEffectModulation(layerIndex: number, effectId: string, paramName: string, mod: ParamModulation, bank: 'A' | 'B' = 'A') {
      update(map => {
        const newMap = new Map(map);
        const key = modKeyEffect(layerIndex, effectId, paramName, bank);
        if (mod.source === 'manual') {
          newMap.delete(key);
        } else {
          newMap.set(key, mod);
        }
        return newMap;
      });
    },

    /** Get modulation for an effect parameter. Bank A by default. */
    getEffectModulation(layerIndex: number, effectId: string, paramName: string, bank: 'A' | 'B' = 'A'): ParamModulation | undefined {
      const map = get({ subscribe });
      return map.get(modKeyEffect(layerIndex, effectId, paramName, bank));
    },

    /** Set modulation on an edge-effect param. `paramPath` is the
     *  dotted nested path (e.g. `'stroke.width'`, `'fill.opacity'`).
     *  Bank A only — edge effects don't participate in VJ A/B banking. */
    setEdgeEffectModulation(layerIndex: number, effectId: string, paramPath: string, mod: ParamModulation) {
      update(map => {
        const newMap = new Map(map);
        const key = modKeyEdgeEffect(layerIndex, effectId, paramPath, 'A');
        if (mod.source === 'manual') {
          newMap.delete(key);
        } else {
          newMap.set(key, mod);
        }
        return newMap;
      });
    },

    /** Get modulation for an edge-effect param. */
    getEdgeEffectModulation(layerIndex: number, effectId: string, paramPath: string): ParamModulation | undefined {
      const map = get({ subscribe });
      return map.get(modKeyEdgeEffect(layerIndex, effectId, paramPath, 'A'));
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
      autoPlaying: isAuto ? (existing?.autoPlaying ?? true) : DEFAULT_MOD.autoPlaying,
    }, bank, target, clipId);
  }
  if (source !== 'manual' && !modulationEngine.running) {
    modulationEngine.start();
  }
}

/** Update modulation depth for a shader param */
export function setParamModAmount(layerIndex: number, paramName: string, amount: number, bank: 'A' | 'B' = 'A') {
  const existing = modulationStore.getModulation(layerIndex, paramName, bank);
  if (existing) {
    modulationStore.setModulation(layerIndex, paramName, { ...existing, amount }, bank);
  }
}

/** Update LFO speed for a shader param */
export function setParamModSpeed(layerIndex: number, paramName: string, speed: number, bank: 'A' | 'B' = 'A') {
  const existing = modulationStore.getModulation(layerIndex, paramName, bank);
  if (existing) {
    modulationStore.setModulation(layerIndex, paramName, { ...existing, speed }, bank);
  }
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
    this.tick();
  }

  stop() {
    this.isRunning = false;
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
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

    for (const entry of parsedCache) {
      let { mod, bank, layerIndex, isEffect, isEdgeEffect, effectId, paramName, special } = entry;

      // Clip-keyed entries — resolve which deck/layer currently has
      // this clip active, write there. Layer index in the entry is
      // a sentinel; we find the real position at apply-time so the
      // automation follows the clip wherever it goes. If the clip
      // isn't active anywhere, skip but keep the mod in the store
      // — it resumes the moment the user re-fires that clip.
      if (entry.clipId) {
        let foundLayer = -1;
        let foundBank: 'A' | 'B' = 'A';
        // Check deck A first (more common), then deck B.
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
        if (foundLayer < 0) continue;  // clip not active anywhere — dormant
        layerIndex = foundLayer;
        bank = foundBank;
      }

      // Auto-source playhead advance. Mutates the modulation's
      // autoPhase in-place — cheap because the parsedCache holds a
      // reference to the same object the modulationStore writes to
      // when the user moves the speed/range/play controls. Phase
      // wraps in [0, 1); the loop / pingpong shaping is done in
      // getSignal() where the wave shape lives next to the LFOs.
      if (mod.source === 'auto' && mod.autoPlaying !== false) {
        const speedHz = mod.autoSpeedHz ?? 0.5;
        const phase = ((mod.autoPhase ?? 0) + speedHz * dt) % 1;
        mod.autoPhase = phase < 0 ? phase + 1 : phase;
      }

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
          if (typeof sv !== 'number') continue;
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
        // Auto source uses absolute-position routing (see the
        // shader-params branch below for the rationale).
        const raw = mod.source === 'auto'
          ? fxMin + signal * fxSpan
          : fxBase + (signal - 0.5) * mod.amount * fxSpan;
        const modulated = Math.max(fxMin, Math.min(fxMax, raw));

        if (isMapping) {
          if (_mappingEffectUpdater) {
            _mappingEffectUpdater(layerIndex, effectId, { [paramName]: modulated });
          }
        } else {
          vjClipLauncher.updateLayerEffectParams(layerIndex, effectId, { [paramName]: modulated }, bank);
        }
        lastModulatedValues.set(fxKey, modulated);
      } else if (!isEffect) {
        // Shader params — works for VJ (both banks) and mapping mode.
        const bvKey = `${bank}:${layerIndex}:${paramName}`;
        const rangeKey = `${layerIndex}:${paramName}`; // ranges live per-shader, not per-bank
        const range = paramRanges.get(rangeKey);
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
        // (`(signal - 0.5) * amount` recentered formula). Auto source
        // is different — the signal is already a fraction of the
        // user's chosen sub-range (autoMin..autoMax) and should drive
        // the param ABSOLUTELY to that position. Mixing the auto
        // signal through the audio formula would just modulate
        // around the base, which is the opposite of what the user
        // wants from an automation slider.
        const span = range ? (range.max - range.min) : 2;
        let raw: number;
        if (mod.source === 'auto') {
          raw = (range ? range.min : 0) + signal * span;
        } else {
          raw = base + (signal - 0.5) * mod.amount * span;
        }
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
  }

  private getSignal(source: ModSource, audio: AudioState, time: number, speed: number, bpmSync: boolean, mod?: ParamModulation): number {
    switch (source) {
      case 'sub':       return audio.bands.sub;
      case 'bass':      return audio.bands.bass;
      case 'lowMid':    return audio.bands.lowMid;
      case 'mid':       return audio.bands.mid;
      case 'highMid':   return audio.bands.highMid;
      case 'treble':    return audio.bands.treble;
      case 'air':       return audio.bands.air;
      case 'presence':  return audio.bands.presence;
      case 'high':      return audio.bands.high;
      case 'amplitude': return audio.amplitude;
      case 'beatPhase': return audio.beatPhase;
      // Kick / snare are onset-based one-shots: shape an exponential decay
      // from the onset so the modulation reads as a hit, not a level.
      // ~150ms decay window matches the eye's perception of a flash.
      case 'kick': {
        const ks = audio.kickSnare;
        if (!ks) return 0;
        const t = ks.timeSinceLastKick / 1000; // seconds
        // exp decay with τ=0.15s, peak intensity at hit
        return Math.max(0, ks.kickIntensity * Math.exp(-t / 0.15));
      }
      case 'snare': {
        const ks = audio.kickSnare;
        if (!ks) return 0;
        const t = ks.timeSinceLastSnare / 1000;
        return Math.max(0, ks.snareIntensity * Math.exp(-t / 0.15));
      }
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
