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

/** Register mapping mode callbacks — called once from layers store init */
export function registerMappingLayerCallbacks(
  updater: (layerIndex: number, values: Record<string, number>) => void,
  reader: (layerIndex: number, paramName: string) => number | undefined,
  isMapping: (layerIndex: number) => boolean,
) {
  _mappingLayerUpdater = updater;
  _mappingLayerReader = reader;
  _isMappingLayer = isMapping;
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
  | 'lfo-tri';   // Triangle wave LFO

// A single parameter modulation assignment
export interface ParamModulation {
  source: ModSource;
  amount: number;    // 0-1 how much the source affects the parameter
  speed: number;     // LFO speed multiplier (only for LFO sources), cycles per second
  invert: boolean;   // Invert the modulation signal
}

// Default modulation values for new assignments
export const DEFAULT_MOD: Omit<ParamModulation, 'source'> = {
  amount: 0.5,
  speed: 1,
  invert: false,
};

// Pre-parsed key for hot-path use (avoids split(':') per frame)
interface ParsedModEntry {
  mod: ParamModulation;
  // Special target sentinel — when set, takes precedence over layer/effect
  // routing. 'xfade-value' modulates the global VJ crossfader fader.
  special?: 'xfade-value';
  // Bank tag for layer/effect targets. Default 'A'. Ignored when `special` is set.
  bank: 'A' | 'B';
  layerIndex: number;
  isEffect: boolean;
  effectId: string;   // '' for shader params
  paramName: string;
}

// Key formats — discriminator is the leading token:
//   Bank A shader:  "layerIndex:paramName"            (legacy / default)
//   Bank A effect:  "layerIndex:fx:effectId:paramName"
//   Bank B shader:  "B:layerIndex:paramName"
//   Bank B effect:  "B:layerIndex:fx:effectId:paramName"
//   Crossfader:     "xfade:value"
export type ModulationMap = Map<string, ParamModulation>;

// Key builders so callers don't hand-craft strings.
export function modKeyShader(layerIndex: number, paramName: string, bank: 'A' | 'B' = 'A'): string {
  return bank === 'B' ? `B:${layerIndex}:${paramName}` : `${layerIndex}:${paramName}`;
}
export function modKeyEffect(layerIndex: number, effectId: string, paramName: string, bank: 'A' | 'B' = 'A'): string {
  return bank === 'B'
    ? `B:${layerIndex}:fx:${effectId}:${paramName}`
    : `${layerIndex}:fx:${effectId}:${paramName}`;
}
export const MOD_KEY_XFADE_VALUE = 'xfade:value';

// Pre-parsed cache rebuilt on store change — avoids per-frame string parsing
let parsedCache: ParsedModEntry[] = [];

// Parameter range registry — stores ISF min/max for shader params to enable clamping
// Key format: "layerIndex:paramName"
const paramRanges = new Map<string, { min: number; max: number }>();

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
        layerIndex: -1,
        isEffect: false,
        effectId: '',
        paramName: '',
      });
      continue;
    }

    // Bank prefix detection: "B:..." → Bank B, otherwise Bank A (legacy default)
    let bank: 'A' | 'B' = 'A';
    let cursor = 0;
    if (parts[0] === 'B') {
      bank = 'B';
      cursor = 1;
    }

    const layerIndex = parseInt(parts[cursor], 10);
    if (isNaN(layerIndex)) continue;

    if (parts[cursor + 1] === 'fx') {
      parsedCache.push({
        mod,
        bank,
        layerIndex,
        isEffect: true,
        effectId: parts[cursor + 2],
        paramName: parts[cursor + 3],
      });
    } else {
      parsedCache.push({
        mod,
        bank,
        layerIndex,
        isEffect: false,
        effectId: '',
        paramName: parts[cursor + 1],
      });
    }
  }
}

// Store for modulation assignments
function createModulationStore() {
  const { subscribe, update, set } = writable<ModulationMap>(new Map());

  // Rebuild parsed cache whenever store changes
  subscribe(map => rebuildParsedCache(map));

  return {
    subscribe,

    /** Set modulation for a specific layer+param (shader). Bank A by default. */
    setModulation(layerIndex: number, paramName: string, mod: ParamModulation, bank: 'A' | 'B' = 'A') {
      update(map => {
        const newMap = new Map(map);
        const key = modKeyShader(layerIndex, paramName, bank);
        if (mod.source === 'manual') {
          newMap.delete(key);
        } else {
          newMap.set(key, mod);
        }
        return newMap;
      });
    },

    /** Get modulation for a specific layer+param (shader). Bank A by default. */
    getModulation(layerIndex: number, paramName: string, bank: 'A' | 'B' = 'A'): ParamModulation | undefined {
      const map = get({ subscribe });
      return map.get(modKeyShader(layerIndex, paramName, bank));
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

/** Set or clear a shader param's modulation source. Starts engine if needed. */
export function setParamModSource(layerIndex: number, paramName: string, source: ModSource, bank: 'A' | 'B' = 'A') {
  if (source === 'manual') {
    modulationStore.setModulation(layerIndex, paramName, { source: 'manual', ...DEFAULT_MOD }, bank);
  } else {
    const existing = modulationStore.getModulation(layerIndex, paramName, bank);
    modulationStore.setModulation(layerIndex, paramName, {
      source,
      amount: existing?.amount ?? DEFAULT_MOD.amount,
      speed: existing?.speed ?? DEFAULT_MOD.speed,
      invert: existing?.invert ?? DEFAULT_MOD.invert,
    }, bank);
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

  private applyModulations() {
    const audio = get(audioStore);
    const now = (performance.now() - this.startTime) / 1000;
    const vjState = get(vjClipLauncher);

    // Batch shader updates per (bank, layerIndex). Bank A and Bank B route
    // to separate state slices, so they need separate buckets.
    const vjBatchA = new Map<number, Record<string, number>>();
    const vjBatchB = new Map<number, Record<string, number>>();
    const mappingBatch = new Map<number, Record<string, number>>();

    for (const entry of parsedCache) {
      const { mod, bank, layerIndex, isEffect, effectId, paramName, special } = entry;

      let signal = this.getSignal(mod.source, audio, now, mod.speed);
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

      const isMapping = _isMappingLayer ? _isMappingLayer(layerIndex) : false;
      // Validate layer index. Bank B uses bankBLayerStates which is the same
      // length as numLayers (the store keeps them in sync).
      if (!isMapping && (layerIndex < 0 || layerIndex >= vjState.numLayers)) continue;

      // Resolve the layer-state slice for this entry's bank — only matters
      // for VJ mode; mapping mode goes through its own callback so bank is
      // implicitly Bank A there (mapping doesn't have banks).
      const layerStates = (!isMapping && bank === 'B')
        ? vjState.bankBLayerStates
        : vjState.layerStates;

      if (isEffect && !isMapping) {
        // Effect params — VJ mode only.
        const layerState = layerStates[layerIndex];
        const effect = layerState?.effects.find(e => e.id === effectId);
        if (!effect) continue;
        // Base-value cache is keyed including bank so A and B effects on the
        // same row don't share a base.
        const fxKey = `${bank}:${layerIndex}:fx:${effectId}:${paramName}`;
        let fxBase = baseValues.get(fxKey);
        if (fxBase === undefined) {
          const sv = (effect.params as Record<string, number>)[paramName];
          if (typeof sv !== 'number') continue;
          fxBase = sv;
          baseValues.set(fxKey, fxBase);
        }
        const modulated = Math.max(0, Math.min(1, fxBase + (signal - 0.5) * mod.amount * 2));
        vjClipLauncher.updateLayerEffectParams(layerIndex, effectId, { [paramName]: modulated }, bank);
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

        // Scale modulation relative to param range, clamp to ISF min/max
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
  }

  private getSignal(source: ModSource, audio: AudioState, time: number, speed: number): number {
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
      case 'lfo-sine':  return (Math.sin(time * speed * Math.PI * 2) + 1) / 2;
      case 'lfo-saw':   return (time * speed) % 1;
      case 'lfo-square': return (Math.sin(time * speed * Math.PI * 2) > 0) ? 1 : 0;
      case 'lfo-tri': {
        const phase = (time * speed) % 1;
        return phase < 0.5 ? phase * 2 : 2 - phase * 2;
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
