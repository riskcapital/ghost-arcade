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
import { getVisualAudioSnapshot } from '../audio/visualAudio';

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
    type: 'still',
    label: 'Still',
    icon: '∅',
    // The "no effect" effect. Brightness is constant 1.0 so the
    // slice's bound layer renders at its natural opacity. Add this to
    // the auto-cycle as a rest beat between active effects, or use it
    // as the default state when nothing else is live.
    defaultParams: {},
    paramSpecs: [],
  },
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
  {
    type: 'chase',
    label: 'Chase',
    icon: '→',
    // Sequential one-at-a-time lighting cycling through slices in
    // their stored order. width controls how many slices are lit
    // simultaneously (0.1 = sharp single; 1 = the whole stage).
    defaultParams: { speed: 1.0, width: 0.18 },
    paramSpecs: [
      { key: 'speed', label: 'Speed', min: 0,    max: 6,   step: 0.05 },
      { key: 'width', label: 'Width', min: 0.05, max: 1,   step: 0.01 },
    ],
  },
  {
    type: 'strobe',
    label: 'Strobe',
    icon: '⚡',
    // Global flash at a configurable rate. duty = fraction of the
    // cycle the stage is "on" (0.05 = punchy ratlle, 0.5 = even
    // square wave).
    defaultParams: { rate: 6, duty: 0.15 },
    paramSpecs: [
      { key: 'rate', label: 'Rate (Hz)', min: 0.5, max: 20,  step: 0.1 },
      { key: 'duty', label: 'Duty',      min: 0.02, max: 0.95, step: 0.01 },
    ],
  },
  {
    type: 'twinkle',
    label: 'Twinkle',
    icon: '✨',
    // Each slice independently fades in/out at random.
    // density = portion of slices lit at any moment; speed = fade rate.
    defaultParams: { density: 0.35, speed: 1.2 },
    paramSpecs: [
      { key: 'density', label: 'Density', min: 0.05, max: 1, step: 0.01 },
      { key: 'speed',   label: 'Speed',   min: 0.1,  max: 6, step: 0.05 },
    ],
  },
  {
    type: 'sine-wave',
    label: 'Sine Wave',
    icon: '∿',
    // Per-slice sine oscillation. phaseSpread distributes phases
    // across slices based on centroid X — positions become a
    // traveling wave instead of a unison flicker. depth = amplitude.
    defaultParams: { speed: 0.8, phaseSpread: 1.6, depth: 0.6 },
    paramSpecs: [
      { key: 'speed',       label: 'Speed',        min: 0,   max: 4, step: 0.01 },
      { key: 'phaseSpread', label: 'Phase Spread', min: 0,   max: 6, step: 0.05 },
      { key: 'depth',       label: 'Depth',        min: 0,   max: 1, step: 0.01 },
    ],
  },
  {
    type: 'beat-pulse',
    label: 'Beat Pulse',
    icon: '♪',
    // Audio-onset reactive — every tick where RMS spikes above the
    // recent average triggers a global flash that decays over `decay`
    // seconds. sensitivity scales how aggressively the spike test
    // fires (lower = more sensitive).
    defaultParams: { sensitivity: 1.4, decay: 0.25, threshold: 0.08 },
    paramSpecs: [
      { key: 'sensitivity', label: 'Sensitivity', min: 1.05, max: 3,   step: 0.05 },
      { key: 'decay',       label: 'Decay (s)',   min: 0.05, max: 1.5, step: 0.01 },
      { key: 'threshold',   label: 'Threshold',   min: 0,    max: 0.5, step: 0.01 },
    ],
  },
  {
    type: 'spiral',
    label: 'Spiral',
    icon: '𓆉',
    // Rotating angular sweep — like a lighthouse beam centered on the
    // origin. arms = how many beam arms; rotation > 0 sweeps CCW,
    // < 0 CW. Width controls how wide each beam arm is in radians.
    defaultParams: {
      originX: 0.5, originY: 0.5,
      speed: 0.5, arms: 1, width: 0.6,
    },
    paramSpecs: [
      { key: 'speed',   label: 'Speed',   min: -3, max: 3,  step: 0.01 },
      { key: 'arms',    label: 'Arms',    min: 1,  max: 6,  step: 1 },
      { key: 'width',   label: 'Width',   min: 0.1, max: 3, step: 0.01 },
      { key: 'originX', label: 'Origin X', min: 0,  max: 1, step: 0.01 },
      { key: 'originY', label: 'Origin Y', min: 0,  max: 1, step: 0.01 },
    ],
  },
  {
    type: 'cascade',
    label: 'Cascade',
    icon: '↓',
    // Vertical drop wave — slices at higher Y light first, lower-Y
    // slices light progressively later. Like a curtain of light
    // falling down the stage. delay = how staggered the slices
    // light relative to each other.
    defaultParams: { speed: 0.6, bandHeight: 0.25, delay: 0.7 },
    paramSpecs: [
      { key: 'speed',      label: 'Speed',       min: -3,   max: 3,   step: 0.01 },
      { key: 'bandHeight', label: 'Band Height', min: 0.05, max: 1,   step: 0.01 },
      { key: 'delay',      label: 'Spread',      min: 0,    max: 1,   step: 0.01 },
    ],
  },
  {
    type: 'random-hits',
    label: 'Random Hits',
    icon: '!',
    // Per-slice random one-shot strobes — a slice randomly fires,
    // brightens to peak, decays over `duration`. rate = average
    // hits per second across the whole stage.
    defaultParams: { rate: 3, duration: 0.18, peak: 1 },
    paramSpecs: [
      { key: 'rate',     label: 'Rate (per s)', min: 0.1, max: 20,  step: 0.1 },
      { key: 'duration', label: 'Duration (s)', min: 0.05, max: 1,  step: 0.01 },
      { key: 'peak',     label: 'Peak',         min: 0.1, max: 1,   step: 0.01 },
    ],
  },
  {
    type: 'breathing',
    label: 'Breathing',
    icon: '◐',
    // Smooth global pulse — full stage breathes in unison. With
    // `heartbeat` > 0 the cycle gains a "lub-dub" second peak (more
    // alive feel; useful as a base layer under other effects).
    defaultParams: { speed: 0.3, depth: 0.6, heartbeat: 0 },
    paramSpecs: [
      { key: 'speed',     label: 'Speed',     min: 0, max: 3, step: 0.01 },
      { key: 'depth',     label: 'Depth',     min: 0, max: 1, step: 0.01 },
      { key: 'heartbeat', label: 'Heartbeat', min: 0, max: 1, step: 0.01 },
    ],
  },
  {
    type: 'checker',
    label: 'Checker',
    icon: '▣',
    // Alternating on/off groups by slice index parity. Toggles
    // between two states at `rate` Hz. Useful with `phase` for
    // staggered alternation across odd/even slices.
    defaultParams: { rate: 1, ratio: 0.5 },
    paramSpecs: [
      { key: 'rate',  label: 'Rate (Hz)', min: 0.1, max: 8, step: 0.05 },
      { key: 'ratio', label: 'On Ratio',  min: 0.1, max: 0.9, step: 0.01 },
    ],
  },
  {
    type: 'inverse-pulse',
    label: 'Inverse Pulse',
    icon: '◉',
    // Ring contracts inward (mirror of radial-pulse). Outer slices
    // light first, then the pulse converges on the origin.
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
    type: 'split-flash',
    label: 'Split Flash',
    icon: '⇄',
    // Two halves of the stage alternate. axis 0 = horizontal split
    // (top vs bottom); axis 1 = vertical split (left vs right);
    // intermediate values angle the split line.
    defaultParams: { rate: 2, axis: 1, mix: 0.5 },
    paramSpecs: [
      { key: 'rate', label: 'Rate (Hz)', min: 0.1, max: 8, step: 0.05 },
      { key: 'axis', label: 'Axis',      min: 0,   max: 1, step: 0.01 },
      { key: 'mix',  label: 'Mix',       min: 0,   max: 1, step: 0.01 },
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
  /** sliceId → current frame color tint (`#rrggbb` or null when the
   *  active effect doesn't carry a color). Engine integration for
   *  tinting is a follow-up; the data is published now so the UI can
   *  visualize it and so the wiring is in place when the engine hook
   *  lands. */
  sliceColors: Map<string, string | null>;
  /** layerId → sliceId, populated from Surface.slices[].sourceBinding.
   *  Built lazily when surfaces change. Canvas reads this to find the
   *  current brightness for an opacity modulation. */
  layerToSlice: Map<string, string>;
  /** Per-effect internal state (audio-rms smoothing accumulator,
   *  beat-pulse last-onset time, random-hits per-slice fire timers,
   *  and so on). Open shape — keys are local to each evaluator. */
  state: Map<string, Record<string, any>>;
}

const initialRuntime: StageEffectsRuntime = {
  sliceOutputs: new Map(),
  sliceColors: new Map(),
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
  // Milkdrop-smoothed overall level from the shared visual-audio bus —
  // asymmetric attack/release + long-baseline normalization, so loud and
  // quiet songs light the stage the same and there's no woofer pumping.
  // gain=3 (the legacy default, calibrated for raw RMS ≈ level/3) is the
  // unity point for the normalized signal, so saved scenes keep their look.
  const visual = getVisualAudioSnapshot();
  const raw = visual.isActive ? visual.level : 0;
  const gain = eff.params.gain ?? 3;
  const floor = eff.params.floor ?? 0.05;
  const smoothing = eff.params.smoothing ?? 0.18;
  const target = Math.max(floor, Math.min(1, raw * (gain / 3) + floor));
  // Single-pole IIR smoothing — `smoothing` 0 = instantaneous, 1 = frozen.
  const a = Math.max(0, Math.min(0.99, smoothing));
  const prev = state.lastValue ?? target;
  const next = prev * a + target * (1 - a);
  state.lastValue = next;
  return next;
}

// `_sliceIndex` for the per-slice evaluators that need it — populated
// by tick() into the evaluator state object so we don't need to
// change the evaluate() signature. See the tick refactor below.
function evalChase(eff: StageEffect, _cx: number, _cy: number, tSec: number, state: any): number {
  const speed = eff.params.speed ?? 1;
  const width = Math.max(0.01, eff.params.width ?? 0.18);
  const totalSlices = state._sliceCount ?? 1;
  const idx = state._sliceIndex ?? 0;
  // Slice position normalized 0..1 in chase order.
  const pos = totalSlices > 0 ? (idx / totalSlices) : 0;
  // Chase head sweeps 0..1 over (1/speed) seconds.
  const head = (tSec * speed) % 1;
  // Distance from head, wrapped so the chase loops continuously.
  let d = pos - head;
  if (d < -0.5) d += 1;
  if (d >  0.5) d -= 1;
  const dist = Math.abs(d);
  if (dist > width) return 0;
  // Soft falloff inside the band.
  return 1 - (dist / width);
}

function evalStrobe(eff: StageEffect, _cx: number, _cy: number, tSec: number, _state: any): number {
  const rate = eff.params.rate ?? 6;
  const duty = Math.max(0.01, Math.min(0.99, eff.params.duty ?? 0.15));
  // Phase 0..1 within each cycle. Inside duty → 1; outside → 0.
  // Short ramp-down at the very end of "on" so the transition isn't
  // a hard digital edge that flickers at high rates.
  const phase = (tSec * rate) % 1;
  if (phase < duty) {
    // Hold full brightness for the bulk, then a thin tail.
    return phase < duty * 0.85 ? 1 : 1 - (phase - duty * 0.85) / (duty * 0.15);
  }
  return 0;
}

function evalTwinkle(eff: StageEffect, cx: number, cy: number, tSec: number, _state: any): number {
  const density = Math.max(0.01, Math.min(1, eff.params.density ?? 0.35));
  const speed = eff.params.speed ?? 1.2;
  // Each slice's centroid generates a stable phase via spatial hash.
  const seed = hashNoise(cx * 17.31, cy * 23.97, 0);
  const phaseOffset = seed * 6.283;
  // Slow per-slice oscillation; sin wave warped so it's "off" most
  // of the time when density is low.
  const w = Math.sin(tSec * speed + phaseOffset) * 0.5 + 0.5;
  const threshold = 1 - density;
  if (w < threshold) return 0;
  return (w - threshold) / (1 - threshold);
}

function evalSineWave(eff: StageEffect, cx: number, _cy: number, tSec: number, _state: any): number {
  const speed = eff.params.speed ?? 0.8;
  const spread = eff.params.phaseSpread ?? 1.6;
  const depth = eff.params.depth ?? 0.6;
  const phase = (cx - 0.5) * spread * 6.283;
  const v = Math.sin(tSec * speed * 6.283 + phase) * 0.5 + 0.5;
  // depth scales how deep the troughs go: depth=1 reaches 0,
  // depth=0 stays at 1.0 (no effect).
  return 1 - (1 - v) * depth;
}

function evalBeatPulse(eff: StageEffect, _cx: number, _cy: number, _tSec: number, state: any): number {
  const sensitivity = eff.params.sensitivity ?? 1.4;
  const decay = Math.max(0.01, eff.params.decay ?? 0.25);
  const threshold = eff.params.threshold ?? 0.08;
  const audio = get(audioStore);
  const raw = audio?.isActive ? (audio.rms ?? 0) : 0;
  // Primary trigger: the analyzer's tuned kick/beat onset detection —
  // event-driven, per the Milkdrop model, instead of amplitude-tracking.
  // `threshold` still gates out quiet-room noise. The legacy RMS spike
  // test stays as a fallback so the effect keeps firing (and `sensitivity`
  // keeps meaning) when the analyzer's beat detector misses or is absent.
  const prevBaseline = state._baseline ?? raw;
  const baselineA = 0.92;  // ~10-frame smoothing
  const baseline = prevBaseline * baselineA + raw * (1 - baselineA);
  state._baseline = baseline;
  const hostOnset = !!(audio?.isActive && (audio.kickSnare?.isKick || audio.beat?.isBeat));
  const spikeOnset = raw > baseline * sensitivity;
  if (raw > threshold && (hostOnset || spikeOnset)) {
    state._lastBeatTime = performance.now() / 1000;
  }
  const since = (performance.now() / 1000) - (state._lastBeatTime ?? -10);
  if (since > decay) return 0;
  return 1 - (since / decay);
}

function evalSpiral(eff: StageEffect, cx: number, cy: number, tSec: number, _state: any): number {
  const ox = eff.params.originX ?? 0.5;
  const oy = eff.params.originY ?? 0.5;
  const speed = eff.params.speed ?? 0.5;
  const arms = Math.max(1, Math.round(eff.params.arms ?? 1));
  const width = Math.max(0.05, eff.params.width ?? 0.6);
  // Angle of this slice's centroid relative to origin.
  const ang = Math.atan2(cy - oy, cx - ox);
  // Beam center angle rotates with time. arms > 1 splits into N
  // beams equally distributed around the circle.
  const beamCenter = tSec * speed * 6.283;
  // Distance from any beam — find the closest of N arms.
  let minDelta = Infinity;
  for (let i = 0; i < arms; i++) {
    const armAng = beamCenter + (i * 6.283 / arms);
    let delta = Math.abs(ang - (armAng % 6.283));
    if (delta > 3.14159) delta = 6.283 - delta;
    if (delta < minDelta) minDelta = delta;
  }
  if (minDelta > width) return 0;
  return 1 - (minDelta / width);
}

function evalCascade(eff: StageEffect, _cx: number, cy: number, tSec: number, _state: any): number {
  const speed = eff.params.speed ?? 0.6;
  const bandHeight = Math.max(0.01, eff.params.bandHeight ?? 0.25);
  // delay is unused as a fundamental cascade parameter — the inherent
  // spread happens via the band thickness and the slice's Y position.
  // Reserved for future use (e.g. multi-band cascade).
  // Band Y position cycles -bandHeight..1, so it enters from off-top
  // and exits past the bottom.
  const pos = ((tSec * speed) % (1 + bandHeight * 2)) - bandHeight;
  const diff = cy - pos;
  if (diff < 0 || diff > bandHeight) return 0;
  // Soft falloff toward each edge of the band.
  const local = diff / bandHeight;
  return 1 - Math.abs(local - 0.5) * 2;
}

function evalRandomHits(eff: StageEffect, cx: number, cy: number, _tSec: number, state: any): number {
  const rate = eff.params.rate ?? 3;
  const duration = Math.max(0.01, eff.params.duration ?? 0.18);
  const peak = eff.params.peak ?? 1;
  const totalSlices = state._sliceCount ?? 1;
  const nowSec = performance.now() / 1000;
  // Per-slice last-hit time stored in state, keyed by slice index.
  // Probability of firing this frame ≈ rate * dt / totalSlices.
  const lastFire = state._lastFireTime ?? nowSec;
  const dt = Math.max(0, Math.min(0.1, nowSec - lastFire));
  state._lastFireTime = nowSec;
  // Compute slice-local hit time map (lazy init).
  if (!state._hitTimes) state._hitTimes = new Map<number, number>();
  const idx = state._sliceIndex ?? 0;
  // Stochastic test — chance proportional to dt × per-slice rate.
  const perSliceRate = rate / Math.max(1, totalSlices);
  if (Math.random() < perSliceRate * dt) {
    state._hitTimes.set(idx, nowSec);
  }
  const hitAt = state._hitTimes.get(idx) ?? -10;
  const elapsed = nowSec - hitAt;
  if (elapsed > duration) return 0;
  // Exponential-ish decay from peak to 0 over `duration`.
  const t = 1 - (elapsed / duration);
  return peak * t * t;
}

function evalBreathing(eff: StageEffect, _cx: number, _cy: number, tSec: number, _state: any): number {
  const speed = eff.params.speed ?? 0.3;
  const depth = eff.params.depth ?? 0.6;
  const heartbeat = eff.params.heartbeat ?? 0;
  const t = tSec * speed * 6.283;
  // Base sine breathing.
  let v = Math.sin(t) * 0.5 + 0.5;
  // Heartbeat adds a second smaller pulse one-third through each
  // cycle, producing a "lub-dub" rhythm.
  if (heartbeat > 0) {
    const dub = Math.sin(t * 3) * 0.5 + 0.5;
    v = v * (1 - heartbeat * 0.5) + dub * dub * heartbeat * 0.7;
    v = Math.min(1, v);
  }
  // depth scales how deep the troughs go.
  return 1 - (1 - v) * depth;
}

function evalChecker(eff: StageEffect, _cx: number, _cy: number, tSec: number, state: any): number {
  const rate = eff.params.rate ?? 1;
  const ratio = Math.max(0.05, Math.min(0.95, eff.params.ratio ?? 0.5));
  const idx = state._sliceIndex ?? 0;
  const phase = (tSec * rate) % 1;
  // Even / odd slices flip — odd slices invert the phase test.
  const inverted = idx % 2 === 1;
  const lit = inverted ? (phase >= ratio) : (phase < ratio);
  return lit ? 1 : 0;
}

function evalInversePulse(eff: StageEffect, cx: number, cy: number, tSec: number, _state: any): number {
  const speed = eff.params.speed ?? 0.4;
  const ox = eff.params.originX ?? 0.5;
  const oy = eff.params.originY ?? 0.5;
  const ringW = Math.max(0.01, eff.params.ringWidth ?? 0.25);
  const tail = eff.params.tail ?? 0.55;
  const dx = cx - ox, dy = cy - oy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  // Inverse: the ring CONTRACTS from 1.4 (off-screen) toward 0.
  const radius = 1.4 - ((tSec * speed) % 1.4);
  const diff = dist - radius;
  if (diff > 0) {
    // Trailing (now outside ring) — soft falloff outward.
    const trail = Math.max(0, 1 - diff / Math.max(0.001, tail));
    return Math.min(1, trail);
  } else if (diff > -ringW) {
    return 1 - (-diff / ringW) * 0.4;
  }
  return 0;
}

function evalSplitFlash(eff: StageEffect, cx: number, cy: number, tSec: number, _state: any): number {
  const rate = eff.params.rate ?? 2;
  const axis = eff.params.axis ?? 1;
  const mix = eff.params.mix ?? 0.5;
  // axis is 0 (horizontal split, Y matters) to 1 (vertical split, X
  // matters). Intermediate values angle the split line.
  const angle = axis * Math.PI / 2;
  const proj = (cx - 0.5) * Math.sin(angle) + (cy - 0.5) * Math.cos(angle);
  // Alternates between two halves at `rate` Hz.
  const phase = (tSec * rate) % 1;
  const sideA = phase < 0.5;
  const onA = proj < 0;
  const lit = sideA === onA;
  return lit ? 1 : mix;
}

function evaluate(eff: StageEffect, cx: number, cy: number, tSec: number, state: any): number {
  switch (eff.type) {
    case 'still':                return 1; // no modulation; layer renders at natural opacity
    case 'radial-pulse':         return evalRadialPulse(eff, cx, cy, tSec, state);
    case 'linear-sweep':         return evalLinearSweep(eff, cx, cy, tSec, state);
    case 'noise-flicker':        return evalNoiseFlicker(eff, cx, cy, tSec, state);
    case 'audio-rms-intensity':  return evalAudioRms(eff, cx, cy, tSec, state);
    case 'chase':                return evalChase(eff, cx, cy, tSec, state);
    case 'strobe':               return evalStrobe(eff, cx, cy, tSec, state);
    case 'twinkle':              return evalTwinkle(eff, cx, cy, tSec, state);
    case 'sine-wave':            return evalSineWave(eff, cx, cy, tSec, state);
    case 'beat-pulse':           return evalBeatPulse(eff, cx, cy, tSec, state);
    case 'spiral':               return evalSpiral(eff, cx, cy, tSec, state);
    case 'cascade':              return evalCascade(eff, cx, cy, tSec, state);
    case 'random-hits':          return evalRandomHits(eff, cx, cy, tSec, state);
    case 'breathing':            return evalBreathing(eff, cx, cy, tSec, state);
    case 'checker':              return evalChecker(eff, cx, cy, tSec, state);
    case 'inverse-pulse':        return evalInversePulse(eff, cx, cy, tSec, state);
    case 'split-flash':          return evalSplitFlash(eff, cx, cy, tSec, state);
  }
}

// ─── RAF tick ───────────────────────────────────────────────────────

let rafId: number | null = null;
let startMs = 0;
/** Offline-render virtual clock. When set, the RAF tick (and the
 *  automation scheduler) read time from here instead of the wall
 *  clock — same pattern the engine + ISF renderer use. The offline
 *  store sets this per-frame, runs tick() once, captures the canvas. */
let _manualTime: number | null = null;
export function setStageEffectsManualTime(time: number | null) {
  _manualTime = time;
  if (time !== null) {
    // Mid-tick swaps would let one effect read wall clock and the
    // next read virtual time — force the runtime through a clean
    // pass at the requested virtual time so all effects converge.
    tick(0);
  }
}

function tick(nowMs: number) {
  // Offline render forces a deterministic virtual time via
  // _manualTime; in real-time mode tSec advances with the wall
  // clock. The advanceAutomation scheduler and per-effect tickers
  // all read from this one value so they stay in lock-step.
  const tSec = _manualTime !== null
    ? _manualTime
    : (nowMs - startMs) / 1000;
  // Drive any automation schedulers first — they may flip the
  // surface's activeEffectId between frames.
  advanceAutomation(nowMs);
  const newOutputs = new Map<string, number>();
  const newColors = new Map<string, string | null>();
  for (const surface of surfacesCache) {
    const live = pickLiveEffect(surface);
    if (!live) continue;
    // Build slice index map for index-aware effects.
    const surfaceSliceIds: string[] = [];
    for (const meta of sliceMetaCache) {
      if (meta.surfaceId === surface.id) surfaceSliceIds.push(meta.sliceId);
    }
    const sliceCount = surfaceSliceIds.length;
    const state = (() => {
      const rt = get({ subscribe });
      let s = rt.state.get(live.id);
      if (!s) { s = {}; rt.state.set(live.id, s); }
      return s;
    })();
    for (const meta of sliceMetaCache) {
      if (meta.surfaceId !== surface.id) continue;
      state._sliceIndex = surfaceSliceIds.indexOf(meta.sliceId);
      state._sliceCount = sliceCount;
      const v = evaluate(live, meta.cx, meta.cy, tSec, state);
      const wet = live.opacity ?? 1;
      const eff01 = v * wet + 1 * (1 - wet);
      newOutputs.set(meta.sliceId, Math.max(0, Math.min(1, eff01)));
      // Publish per-slice color tint when the effect carries one. The
      // tint is independent of brightness — engine integration will
      // multiply the slice's content by tint × brightness when wired.
      newColors.set(meta.sliceId, live.color ?? null);
    }
  }
  update(rt => ({ ...rt, sliceOutputs: newOutputs, sliceColors: newColors }));
  if (!anyLiveEffect()) {
    stopIfIdle();
    return;
  }
  rafId = requestAnimationFrame(tick);
}

/** Resolve which effect (if any) is the live one for this surface.
 *  Honors `activeEffectId` — `null` returns null (no effect runs;
 *  layers render at their natural opacity). A type='still' effect
 *  evaluates to a constant brightness of 1.0 via the regular tick
 *  path, so the user can position Still anywhere in the cycle. */
function pickLiveEffect(surface: Surface): StageEffect | null {
  const id = surface.activeEffectId;
  if (id == null) return null;
  const eff = (surface.effects ?? []).find(e => e.id === id);
  return eff ?? null;
}

function anyLiveEffect(): boolean {
  for (const s of surfacesCache) {
    if (pickLiveEffect(s)) return true;
    // Automation playing on this surface also counts — even if the
    // current step is 'still', the scheduler still needs to tick so
    // it can advance to the next effect.
    if (s.effectAutomation?.playing) return true;
  }
  return false;
}

function ensureRunning() {
  if (rafId !== null) return;
  if (!anyLiveEffect()) return;
  startMs = performance.now();
  rafId = requestAnimationFrame(tick);
}

function stopIfIdle() {
  if (!anyLiveEffect() && rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
    // Clear outputs so layers go back to their natural opacity.
    update(rt => ({ ...rt, sliceOutputs: new Map(), sliceColors: new Map() }));
  }
}

// ─── Automation scheduler ───────────────────────────────────
// Each surface has its own scheduler; we keep the per-surface state
// keyed by surface.id so multiple surfaces can run independent
// automations. `lastAdvanceMs` (time mode) and `lastBeatPhase` (beat
// mode) drive when the next step fires.
const automationState = new Map<string, {
  lastAdvanceMs?: number;
  lastBeatPhase?: number;
  beatsAccum?: number;
}>();

function advanceAutomation(nowMs: number) {
  for (const surface of surfacesCache) {
    const auto = surface.effectAutomation;
    if (!auto?.playing) {
      automationState.delete(surface.id);
      continue;
    }
    const cycle = buildAutomationCycle(surface);
    if (cycle.length === 0) continue;

    let st = automationState.get(surface.id);
    if (!st) { st = {}; automationState.set(surface.id, st); }

    let shouldAdvance = false;
    if (auto.mode === 'time') {
      const interval = Math.max(0.1, auto.seconds ?? 4) * 1000;
      if (st.lastAdvanceMs == null) {
        st.lastAdvanceMs = nowMs;
        // Fire immediately on play so the first step engages without
        // waiting one full interval.
        shouldAdvance = true;
      } else if (nowMs - st.lastAdvanceMs >= interval) {
        st.lastAdvanceMs = nowMs;
        shouldAdvance = true;
      }
    } else {
      // Beat mode — count cumulative beats elapsed using beatPhase
      // wraparounds. beatPhase is 0..1 between beats; a wrap (where
      // the new value is much smaller than the old) means one beat
      // has elapsed.
      const audio = get(audioStore);
      const phase = audio?.beatPhase ?? 0;
      if (st.lastBeatPhase == null) {
        st.lastBeatPhase = phase;
        st.beatsAccum = 0;
        shouldAdvance = true; // fire immediately on play
      } else {
        if (phase < (st.lastBeatPhase ?? 0)) {
          st.beatsAccum = (st.beatsAccum ?? 0) + 1;
        }
        st.lastBeatPhase = phase;
        const target = Math.max(1, Math.round(auto.beats ?? 4));
        if ((st.beatsAccum ?? 0) >= target) {
          st.beatsAccum = 0;
          shouldAdvance = true;
        }
      }
    }

    if (!shouldAdvance) continue;

    // Pick the next slot. Land on the current activeEffectId then step
    // forward; if the current isn't in the cycle (e.g. user disabled
    // it mid-play), start from the first slot.
    const currentId = surface.activeEffectId ?? '';
    let idx = cycle.indexOf(currentId);
    idx = idx < 0 ? 0 : (idx + 1) % cycle.length;
    const nextId = cycle[idx];

    void import('./surface').then(({ surfaceStore }) => {
      surfaceStore.setActiveEffect(surface.id, nextId);
    });
  }
}

function buildAutomationCycle(surface: Surface): string[] {
  // Cycle = the effects.[] entries the user has marked ↻-included.
  // Still is just one of those types now — to insert a "rest beat"
  // between active effects, add a Still entry and include it in the
  // cycle like any other.
  return (surface.effects ?? []).filter(e => e.enabled).map(e => e.id);
}

// ─── Public API ─────────────────────────────────────────────────────

export const stageEffectsRuntime = { subscribe };

/** Brightness output map keyed by slice id. Canvas reads this each
 *  frame to modulate the slice's bound layer opacity. */
export const stageEffectOutputs = derived(stageEffectsRuntime, $rt => $rt.sliceOutputs);

/** Color tint map keyed by slice id. Engine integration deferred —
 *  exposes the values so UI can preview and so future engine work
 *  can tint slice content with the live effect's color. */
export const stageEffectColors = derived(stageEffectsRuntime, $rt => $rt.sliceColors);

/** layerId → sliceId reverse lookup. Canvas uses this to find the
 *  effect output for a given layer in O(1). */
export const layerToSliceMap = derived(stageEffectsRuntime, $rt => $rt.layerToSlice);

// ─── One-shot evaluator for the Screens system ──────────────────────
//
// The Screens panel binds a stage-effect TYPE (not a full effect with
// per-effect state, like the surface runtime). For per-screen
// modulation we need a stateless evaluator that takes a screen's
// centroid + the wall-clock time and returns a brightness in [0..1].
//
// State-keyed evaluators (twinkle, chase, random-hits) need persistent
// per-screen state; we cache it in a screen-local Map keyed by
// `screenId + ':' + type`. State is created lazily and lives for the
// session — sufficient for the runtime, no persistence needed because
// these patterns are time-only.
const _screenStageState = new Map<string, Record<string, any>>();
function _screenStateKey(screenId: string, type: StageEffectType): string {
  return `${screenId}:${type}`;
}

/** Compute the stage-effect brightness for a Screen at a moment in
 *  time. `cx` / `cy` are the screen's centroid in normalized 0..1
 *  master-canvas coords — for radial / linear patterns this is what
 *  the operator perceives as "position." Returns 1 (no modulation)
 *  for unknown types and `still`. */
export function evaluateStageEffectForScreen(
  screenId: string,
  type: StageEffectType,
  params: Record<string, number>,
  cx: number,
  cy: number,
  tSec: number,
): number {
  // Reconstruct a minimal StageEffect just to drive the existing
  // evaluators — they expect this shape. Reuses every effect-type
  // implementation already battle-tested by the surface runtime.
  const eff: StageEffect = { id: screenId, type, enabled: true, opacity: 1, params };
  const key = _screenStateKey(screenId, type);
  let state = _screenStageState.get(key);
  if (!state) { state = {}; _screenStageState.set(key, state); }
  try {
    return evaluate(eff, cx, cy, tSec, state);
  } catch (err) {
    console.warn('[stageEffects] screen evaluate failed', err);
    return 1;
  }
}

/** Tear down cached screen state — called when a screen is removed or
 *  its stage-effect binding is cleared. Optional; state is small. */
export function clearScreenStageEffectState(screenId: string) {
  for (const k of Array.from(_screenStageState.keys())) {
    if (k.startsWith(`${screenId}:`)) _screenStageState.delete(k);
  }
}

/** Called by surface.ts whenever surfaces change. Rebuilds centroid
 *  cache + layer→slice map, then starts/stops the RAF tick based on
 *  whether any surface has at least one enabled effect. Idle when
 *  there's nothing to compute (zero per-frame cost). */
export function syncStageEffectsFromSurfaces(surfaces: Surface[]) {
  recomputeSliceMeta(surfaces);
  ensureRunning();
  stopIfIdle();
}
