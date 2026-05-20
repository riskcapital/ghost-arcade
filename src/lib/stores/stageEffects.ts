/**
 * Stage Effects — procedural per-slice brightness generators that animate
 * a Surface's slices together (Resolume "stage-pixel" pattern).
 *
 * Architecture:
 *  - The Surface object owns its `effects: StageEffect[]` (persisted
 *    with the project).
 *  - This store runs ONE RAF tick that walks all surfaces' enabled
 *    effects each frame, computes a brightness per slice (0..1), and
 *    publishes `sliceOutputs: Map<sliceId, number>`.
 *  - It ALSO maintains `layerToSlice: Map<layerId, sliceId>` — built
 *    from `slice.sourceBinding.layerId` post-Apply-Stage — so the
 *    renderer can look up "what's the current brightness for this
 *    layer's bound slice?" in O(1) and modulate opacity.
 *
 * Canvas.svelte reads `sliceOutputs` + `layerToSlice` each frame and
 * multiplies the layer's opacity. Effects keep running even when the
 * Stage Designer workspace is closed — that's the whole point: design
 * your stage, apply, switch to mapping/VJ mode, the pulse keeps going.
 */

import { writable, get, derived } from 'svelte/store';
import type { StageEffect, StageEffectType, Surface } from '../types';
import { generateUUID } from '../utils/uuid';
import { audioStore } from './audio';

// ─── Per-effect-type catalog (UI + default params) ──────────────────

export interface StageEffectDef {
  type: StageEffectType;
  label: string;
  icon: string;
  defaultParams: Record<string, number>;
  paramSpecs: { key: string; label: string; min: number; max: number; step?: number; }[];
}

export const STAGE_EFFECT_CATALOG: StageEffectDef[] = [
  {
    type: 'radial-pulse',
    label: 'Radial Pulse',
    icon: '◎',
    // origin in normalized 0..1 surface coords; speed in Hz; ringWidth
    // in 0..1 surface fraction; tail = how far the pulse trails (smoother
    // tail = longer fade). Phase advances continuously.
    defaultParams: {
      originX: 0.5, originY: 0.5,
      speed: 0.4, ringWidth: 0.25, tail: 0.55,
    },
    paramSpecs: [
      { key: 'speed',     label: 'Speed',      min: 0,    max: 4,   step: 0.01 },
      { key: 'ringWidth', label: 'Ring Width', min: 0.05, max: 1,   step: 0.01 },
      { key: 'tail',      label: 'Tail',       min: 0,    max: 1,   step: 0.01 },
      { key: 'originX',   label: 'Origin X',   min: 0,    max: 1,   step: 0.01 },
      { key: 'originY',   label: 'Origin Y',   min: 0,    max: 1,   step: 0.01 },
    ],
  },
  {
    type: 'linear-sweep',
    label: 'Linear Sweep',
    icon: '↗',
    // angle in radians; speed in Hz; bandWidth = thickness of the
    // bright band as a 0..1 surface fraction.
    defaultParams: {
      angle: 0, speed: 0.5, bandWidth: 0.3, tail: 0.4,
    },
    paramSpecs: [
      { key: 'speed',     label: 'Speed',      min: 0,   max: 4,   step: 0.01 },
      { key: 'bandWidth', label: 'Band Width', min: 0.05, max: 1,  step: 0.01 },
      { key: 'tail',      label: 'Tail',       min: 0,    max: 1,  step: 0.01 },
      { key: 'angle',     label: 'Angle',      min: -3.14159, max: 3.14159, step: 0.01 },
    ],
  },
  {
    type: 'noise-flicker',
    label: 'Noise Flicker',
    icon: '⋯',
    // scale: spatial frequency. speed: time evolution rate. contrast:
    // remaps the underlying [-1,1] noise to a punchier 0..1 range.
    defaultParams: {
      scale: 3, speed: 0.6, contrast: 1.4,
    },
    paramSpecs: [
      { key: 'scale',    label: 'Scale',    min: 0.5, max: 12,  step: 0.1 },
      { key: 'speed',    label: 'Speed',    min: 0,   max: 4,   step: 0.01 },
      { key: 'contrast', label: 'Contrast', min: 0.5, max: 4,   step: 0.05 },
    ],
  },
  {
    type: 'audio-rms-intensity',
    label: 'Audio Reactive',
    icon: '🔊',
    // gain: amplifies the RMS [0..~0.4] to a usable 0..1 brightness.
    // floor: minimum brightness even at silence (so slices don't go
    // fully dark when audio drops).
    defaultParams: {
      gain: 3, floor: 0.05, smoothing: 0.18,
    },
    paramSpecs: [
      { key: 'gain',      label: 'Gain',      min: 0.5, max: 12, step: 0.1 },
      { key: 'floor',     label: 'Floor',     min: 0,   max: 1,  step: 0.01 },
      { key: 'smoothing', label: 'Smoothing', min: 0,   max: 0.95, step: 0.01 },
    ],
  },
];

export function getEffectDef(type: StageEffectType): StageEffectDef | undefined {
  return STAGE_EFFECT_CATALOG.find(d => d.type === type);
}

export function createDefaultStageEffect(type: StageEffectType): StageEffect {
  const def = getEffectDef(type);
  return {
    id: generateUUID(),
    type,
    enabled: true,
    opacity: 1,
    params: def ? { ...def.defaultParams } : {},
  };
}

// ─── Per-slice output store ─────────────────────────────────────────

interface StageEffectsRuntime {
  /** sliceId → current frame brightness (0..1). */
  sliceOutputs: Map<string, number>;
  /** layerId → sliceId, populated from Surface.slices[].sourceBinding.
   *  Built lazily when surfaces change. Canvas reads this to find the
   *  current brightness for an opacity modulation. */
  layerToSlice: Map<string, string>;
  /** Per-effect internal state (e.g. audio-rms smoothing accumulator
   *  carries the prior frame's value). Keyed by effect.id. */
  state: Map<string, { lastValue?: number; phase?: number }>;
}

const initialRuntime: StageEffectsRuntime = {
  sliceOutputs: new Map(),
  layerToSlice: new Map(),
  state: new Map(),
};

const { subscribe, set, update } = writable<StageEffectsRuntime>(initialRuntime);

// ─── Per-slice centroid cache ───────────────────────────────────────
// Centroids are derived from polygon anchor positions; recomputed when
// slices change. We cache them in normalized 0..1 surface coordinates
// so all effect generators work in a unified space regardless of the
// surface's width/height.

interface SliceMeta {
  sliceId: string;
  surfaceId: string;
  layerId: string | null;
  // Centroid in normalized 0..1 surface coords (origin top-left).
  cx: number;
  cy: number;
}

let sliceMetaCache: SliceMeta[] = [];
let surfacesCache: Surface[] = [];

function recomputeSliceMeta(surfaces: Surface[]) {
  sliceMetaCache = [];
  const newLayerToSlice = new Map<string, string>();
  for (const surface of surfaces) {
    const sw = Math.max(1, surface.width);
    const sh = Math.max(1, surface.height);
    for (const slice of surface.slices) {
      if (slice.polygon.length < 3) continue;
      let sumX = 0, sumY = 0;
      for (const p of slice.polygon) { sumX += p.x; sumY += p.y; }
      const cx = (sumX / slice.polygon.length) / sw;
      const cy = (sumY / slice.polygon.length) / sh;
      const layerId = slice.sourceBinding?.kind === 'layer' ? slice.sourceBinding.layerId : null;
      sliceMetaCache.push({ sliceId: slice.id, surfaceId: surface.id, layerId, cx, cy });
      if (layerId) newLayerToSlice.set(layerId, slice.id);
    }
  }
  surfacesCache = surfaces;
  update(rt => ({ ...rt, layerToSlice: newLayerToSlice }));
}

// ─── Effect evaluators ──────────────────────────────────────────────

function evalRadialPulse(eff: StageEffect, cx: number, cy: number, tSec: number, _state: any): number {
  const speed = eff.params.speed ?? 0.4;
  const ox = eff.params.originX ?? 0.5;
  const oy = eff.params.originY ?? 0.5;
  const ringW = Math.max(0.01, eff.params.ringWidth ?? 0.25);
  const tail = eff.params.tail ?? 0.55;
  const dx = cx - ox, dy = cy - oy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  // Pulse "radius" cycles 0..1.4 over (1/speed) seconds. Cap > 1 so
  // the pulse fully leaves the surface before restarting.
  const radius = (tSec * speed) % 1.4;
  // Distance from pulse front. Inside the ring (0..ringW) → bright;
  // outside → falls off over `tail` distance.
  const diff = dist - radius;
  if (diff < 0) {
    // Trailing edge of the wave — soft falloff.
    const trail = Math.max(0, 1 + diff / Math.max(0.001, tail));
    return Math.min(1, trail);
  } else if (diff < ringW) {
    return 1 - (diff / ringW) * 0.4;
  }
  return 0;
}

function evalLinearSweep(eff: StageEffect, cx: number, cy: number, tSec: number, _state: any): number {
  const angle = eff.params.angle ?? 0;
  const speed = eff.params.speed ?? 0.5;
  const bandW = Math.max(0.01, eff.params.bandWidth ?? 0.3);
  const tail = eff.params.tail ?? 0.4;
  // Project centroid onto the sweep direction (unit vector at `angle`).
  const dirX = Math.cos(angle), dirY = Math.sin(angle);
  // Project distance from a centered origin so the sweep is symmetric
  // across the surface.
  const proj = (cx - 0.5) * dirX + (cy - 0.5) * dirY;
  // Sweep position cycles -0.8..0.8.
  const sweepPos = ((tSec * speed) % 2) - 1;
  const diff = proj - sweepPos;
  if (diff > 0 && diff < bandW) {
    return 1 - (diff / bandW) * 0.3;
  }
  if (diff < 0 && diff > -tail) {
    return 1 + diff / tail;
  }
  return 0;
}

// 2D Perlin-noise-ish hash — cheap pseudo-random with deterministic
// per-(x,y,t) output so flicker is stable instead of pure white noise.
function hashNoise(x: number, y: number, t: number): number {
  const s = Math.sin(x * 12.9898 + y * 78.233 + t * 37.719) * 43758.5453;
  return s - Math.floor(s);  // 0..1
}

function evalNoiseFlicker(eff: StageEffect, cx: number, cy: number, tSec: number, _state: any): number {
  const scale = eff.params.scale ?? 3;
  const speed = eff.params.speed ?? 0.6;
  const contrast = eff.params.contrast ?? 1.4;
  const v = hashNoise(cx * scale, cy * scale, tSec * speed);
  // Map v 0..1 through contrast curve centered on 0.5.
  const centered = (v - 0.5) * contrast + 0.5;
  return Math.max(0, Math.min(1, centered));
}

function evalAudioRms(eff: StageEffect, _cx: number, _cy: number, _tSec: number, state: any): number {
  const audio = get(audioStore);
  const raw = (audio?.isActive ? (audio.rms ?? 0) : 0);
  const gain = eff.params.gain ?? 3;
  const floor = eff.params.floor ?? 0.05;
  const smoothing = eff.params.smoothing ?? 0.18;
  const target = Math.max(floor, Math.min(1, raw * gain + floor));
  // Single-pole IIR smoothing — `smoothing` 0 = instantaneous, 1 = frozen.
  const a = Math.max(0, Math.min(0.99, smoothing));
  const prev = state.lastValue ?? target;
  const next = prev * a + target * (1 - a);
  state.lastValue = next;
  return next;
}

function evaluate(eff: StageEffect, cx: number, cy: number, tSec: number, state: any): number {
  switch (eff.type) {
    case 'radial-pulse':         return evalRadialPulse(eff, cx, cy, tSec, state);
    case 'linear-sweep':         return evalLinearSweep(eff, cx, cy, tSec, state);
    case 'noise-flicker':        return evalNoiseFlicker(eff, cx, cy, tSec, state);
    case 'audio-rms-intensity':  return evalAudioRms(eff, cx, cy, tSec, state);
  }
}

// ─── RAF tick ───────────────────────────────────────────────────────

let rafId: number | null = null;
let startMs = 0;

function tick(nowMs: number) {
  const tSec = (nowMs - startMs) / 1000;
  const newOutputs = new Map<string, number>();
  // For each surface, evaluate each enabled effect per slice. Multiple
  // effects on a single surface multiply together (so a sweep + a
  // noise produces gated noise) — opaque to the slice, it just sees
  // a single final brightness value.
  for (const surface of surfacesCache) {
    const effs = (surface.effects ?? []).filter(e => e.enabled);
    if (effs.length === 0) continue;
    for (const meta of sliceMetaCache) {
      if (meta.surfaceId !== surface.id) continue;
      let composite = 1;
      let touched = false;
      for (const eff of effs) {
        const state = (() => {
          const rt = get({ subscribe });
          let s = rt.state.get(eff.id);
          if (!s) { s = {}; rt.state.set(eff.id, s); }
          return s;
        })();
        const v = evaluate(eff, meta.cx, meta.cy, tSec, state);
        // Effect opacity (wet/dry): blend toward "no effect" (1.0) at
        // opacity 0, full effect at opacity 1.
        const wet = eff.opacity ?? 1;
        const eff01 = v * wet + 1 * (1 - wet);
        composite *= eff01;
        touched = true;
      }
      if (touched) newOutputs.set(meta.sliceId, Math.max(0, Math.min(1, composite)));
    }
  }
  update(rt => ({ ...rt, sliceOutputs: newOutputs }));
  rafId = requestAnimationFrame(tick);
}

function ensureRunning() {
  if (rafId !== null) return;
  // Only run if any surface has at least one enabled effect — keeps
  // the tick idle when there's nothing to compute.
  const anyEnabled = surfacesCache.some(s => (s.effects ?? []).some(e => e.enabled));
  if (!anyEnabled) return;
  startMs = performance.now();
  rafId = requestAnimationFrame(tick);
}

function stopIfIdle() {
  const anyEnabled = surfacesCache.some(s => (s.effects ?? []).some(e => e.enabled));
  if (!anyEnabled && rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
    // Clear outputs so layers go back to their natural opacity.
    update(rt => ({ ...rt, sliceOutputs: new Map() }));
  }
}

// ─── Public API ─────────────────────────────────────────────────────

export const stageEffectsRuntime = { subscribe };

/** Brightness output map keyed by slice id. Canvas reads this each
 *  frame to modulate the slice's bound layer opacity. */
export const stageEffectOutputs = derived(stageEffectsRuntime, $rt => $rt.sliceOutputs);

/** layerId → sliceId reverse lookup. Canvas uses this to find the
 *  effect output for a given layer in O(1). */
export const layerToSliceMap = derived(stageEffectsRuntime, $rt => $rt.layerToSlice);

/** Called by surface.ts whenever surfaces change. Rebuilds centroid
 *  cache + layer→slice map; starts/stops the RAF tick. */
export function syncStageEffectsFromSurfaces(surfaces: Surface[]) {
  recomputeSliceMeta(surfaces);
  ensureRunning();
  stopIfIdle();
}
