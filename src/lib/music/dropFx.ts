/**
 * Drop FX: a look that warps the whole program output with the build and
 * drop. It creeps in as the build rises, hits full on the drop's downbeat and
 * lets go over the release. The looks are built from the composition effects
 * the native core already runs, so they show on the live output and the
 * preview alike; this module is the looks and the envelope, and runDropFx
 * drives them on the VJ composition chain as live control (not saved, no undo).
 */

import type { Effect, EffectParams, EffectType } from '../types';

export type DropFxId = 'none' | 'glitch' | 'stutter' | 'warp' | 'strobe' | 'kaleido' | 'melt';

/** Release lengths in beats: half a bar, one bar, two bars. */
export const DROP_FX_RELEASES = [2, 4, 8] as const;
export type DropFxRelease = (typeof DROP_FX_RELEASES)[number];

/** Flashes a second the strobe never goes past (photosensitivity guidance keeps flashing under 3 a second). */
export const STROBE_MAX_HZ = 3;

interface Layer {
  type: EffectType;
  /** The params at envelope `e` (0-1), `beat` on the launch clock and `bps` beats a second. */
  params: (e: number, beat: number, bps: number) => EffectParams;
}

export interface DropFxDef {
  id: DropFxId;
  label: string;
  layers: Layer[];
}

const wobble = (beat: number, rate: number) => Math.sin(beat * Math.PI * 2 * rate);

export const DROP_FX: DropFxDef[] = [
  { id: 'none', label: 'None', layers: [] },
  {
    id: 'glitch',
    label: 'Glitch storm',
    layers: [
      { type: 'glitch', params: (e) => ({ glitchIntensity: e, glitchSpeed: 1 + 4 * e, glitchBlockSize: 0.2 + 0.5 * e, glitchRGBSplit: e, glitchJitter: e, glitchTearChance: 0.6 * e, glitchFreezeBurst: e > 0.8 ? 1 : 0 }) },
      { type: 'rgbShift', params: (e, beat) => ({ rgbShiftAmount: 30 * e, rgbShiftAngle: (beat * 90) % 360 }) },
    ],
  },
  {
    id: 'stutter',
    label: 'Time stretch / stutter',
    layers: [
      { type: 'echoRepeat', params: (e, beat) => ({ echoCount: Math.round(2 + 8 * e), echoOffsetX: 0.08 * e * wobble(beat, 0.5), echoOffsetY: 0.02 * e, echoDecay: 0.55 + 0.35 * e, echoHueShift: 0.05 * e }) },
      { type: 'directionalBlur', params: () => ({}) },
    ],
  },
  {
    id: 'warp',
    label: 'Warp zoom',
    layers: [
      { type: 'zoomBlur', params: (e) => ({ zoomBlurAmount: 0.9 * e, zoomBlurSamples: 24, zoomBlurChromatic: 0.6 * e, zoomBlurMix: 1 }) },
      { type: 'fluidDistort', params: (e) => ({ fluidDistAmount: 0.4 * e, fluidDistScale: 3, fluidDistSpeed: 1.2, fluidDistTurbulence: 0.6 }) },
    ],
  },
  {
    id: 'strobe',
    label: 'Strobe flash',
    layers: [
      // On the beat, but never faster than STROBE_MAX_HZ.
      { type: 'strobeFlash', params: (e, _beat, bps) => ({ strobeRate: Math.min(STROBE_MAX_HZ, Math.max(0.5, bps)), strobeDuty: 0.35, strobeIntensity: 0.85, strobeMode: 0 }) },
    ],
  },
  {
    id: 'kaleido',
    label: 'Kaleido burst',
    layers: [
      { type: 'kaleidoscope', params: (e, beat) => ({ kaleidoscopeSegments: Math.round(4 + 8 * e), kaleidoscopeAngle: (beat * 45) % 360, kaleidoscopeZoom: 1 + 0.6 * e, kaleidoscopeMix: 1 }) },
    ],
  },
  {
    id: 'melt',
    label: 'Melt',
    layers: [
      { type: 'fluidDistort', params: (e) => ({ fluidDistAmount: e, fluidDistScale: 2, fluidDistSpeed: 0.5, fluidDistTurbulence: 0.9 }) },
      { type: 'chromaticAberration', params: () => ({}) },
    ],
  },
];

export const dropFxDef = (id: DropFxId) => DROP_FX.find((d) => d.id === id) ?? DROP_FX[0];

/**
 * How strong the look is: during the build it creeps in on progress squared
 * (up to 40% of the amount by the end); from the drop it is the full amount,
 * falling to nothing over `releaseBeats` on an ease-out curve.
 */
export function dropFxEnvelope(state: { phase: 'build' | 'release'; progress: number; sinceDrop: number }, amount: number, releaseBeats: number): number {
  const a = Math.max(0, Math.min(1, amount));
  if (state.phase === 'build') return a * 0.4 * Math.max(0, Math.min(1, state.progress)) ** 2;
  const t = Math.max(0, state.sinceDrop) / Math.max(0.25, releaseBeats);
  return t >= 1 ? 0 : a * (1 - t) ** 2;
}

/** The id prefix the drop's effects carry on the composition chain. */
export const DROP_FX_PREFIX = 'drop-fx:';

/** The look's composition effects at envelope `e`; opacity carries the envelope as the wet mix. */
export function dropFxEffects(id: DropFxId, e: number, beat: number, bps: number, base: (type: EffectType) => EffectParams): Effect[] {
  return dropFxDef(id).layers.map((layer, i) => ({
    id: `${DROP_FX_PREFIX}${i}`,
    type: layer.type,
    enabled: true,
    opacity: Math.max(0, Math.min(1, e)),
    params: { ...base(layer.type), ...layer.params(e, beat, bps) },
  }));
}
