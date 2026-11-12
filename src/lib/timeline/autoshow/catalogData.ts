// The Auto show's built-in content: the cast it builds a show from on any
// mapping. Chosen and tuned on the Fragmented Cube Wall (Map Sim, auto-mapped):
// pictures that read as rendered light on the pieces at default settings,
// strong silhouettes and deliberate colour; thin line art on black is out.
//
// Each shader keeps its own colour presets: a mood picks one of that shader's
// own presets (`colorMode` on the pack shaders) rather than a palette shared
// across the cast. Looks take one of the Look palettes.
// `cost` is the per-pixel work of one render of the shader (raymarch steps,
// loop counts, noise octaves), checked against frame times on the cube wall:
// high = raymarched or volumetric (render it once and share it), mid = layered
// 2D with loops, low = cheap 2D or a shape Look.

import type { StageEffectType } from '../../types';
import { LOOK_PALETTES } from '../../looks/edgeLooks';
import type { AutoShowContent, AutoShowMood, AutoShowTier } from './catalogTypes';

export type { AutoShowContent, AutoShowMood, AutoShowTier } from './catalogTypes';

export const AUTO_SHOW_CATALOG: AutoShowContent[] = [
  // ── Calm: intros, breakdowns, outros ────────────────────────────
  {
    id: 'eclipse', kind: 'shader', ref: 'GA2-Eclipse.fs',
    tiers: ['calm', 'groove'], moods: ['dark', 'mono', 'warm', 'cool'], texture: 'light', scale: ['span'],
    params: { colorMode: 0 },
    variants: [{ mood: 'dark', params: { colorMode: 0 } }, { mood: 'mono', params: { colorMode: 6 } }, { mood: 'warm', params: { colorMode: 4 } }, { mood: 'cool', params: { colorMode: 3 } }],
    cost: 'high',
  },
  {
    id: 'lightbox', kind: 'shader', ref: 'GA2-Lightbox.fs',
    tiers: ['calm', 'groove'], moods: ['warm', 'cool', 'dark', 'mono'], texture: 'organic', scale: ['span', 'piece'],
    params: { colorMode: 0 },
    variants: [{ mood: 'warm', params: { colorMode: 0 } }, { mood: 'cool', params: { colorMode: 4 } }, { mood: 'dark', params: { colorMode: 1 } }, { mood: 'mono', params: { colorMode: 6 } }],
    cost: 'low',
  },
  {
    id: 'circle-limit', kind: 'shader', ref: 'GA2-CircleLimit.fs',
    tiers: ['calm', 'groove'], moods: ['cool', 'dark', 'warm'], texture: 'geometric', scale: ['span'],
    params: { colorMode: 0 },
    variants: [{ mood: 'cool', params: { colorMode: 0 } }, { mood: 'dark', params: { colorMode: 4 } }, { mood: 'warm', params: { colorMode: 5 } }],
    cost: 'mid',
  },
  {
    id: 'sentinels', kind: 'shader', ref: 'Featured-sentinels.fs',
    tiers: ['calm', 'groove'], moods: ['cool', 'dark'], texture: 'light', scale: ['span'],
    params: { intensity: 2 },
    cost: 'high',
  },
  {
    id: 'aurora-curtain', kind: 'shader', ref: 'SM-AuroraCurtain.fs',
    tiers: ['calm'], moods: ['cool'], texture: 'light', scale: ['span'],
    params: { brightness: 0.85 },
    cost: 'high',
  },
  {
    id: 'stellar-nursery', kind: 'shader', ref: 'StellarNursery.fs',
    tiers: ['calm'], moods: ['mono', 'cool', 'warm'], texture: 'organic', scale: ['span'],
    params: { speed: 0.35 },
    variants: [{ mood: 'mono', params: { hue: 0.1 } }, { mood: 'cool', params: { hue: 0.6 } }, { mood: 'warm', params: { hue: 0 } }],
    cost: 'high',
  },
  {
    id: 'obsidian-flow', kind: 'shader', ref: 'LIVE-ObsidianFlow.fs',
    tiers: ['calm', 'groove'], moods: ['dark', 'mono'], texture: 'organic', scale: ['span'],
    cost: 'low',
  },
  {
    id: 'molten-core', kind: 'shader', ref: 'SM-MoltenCore.fs',
    tiers: ['calm', 'groove'], moods: ['warm', 'cool', 'acid'], texture: 'light', scale: ['piece', 'span'],
    variants: [
      { mood: 'cool', params: { moltenColor: [0.2, 0.6, 1, 1], hotColor: [0.15, 0.25, 1, 1], crustColor: [0.03, 0.05, 0.12, 1], crackGlow: [0.4, 0.7, 1, 1] } },
      { mood: 'acid', params: { moltenColor: [1, 0.2, 0.8, 1], hotColor: [0.6, 0.1, 1, 1], crustColor: [0.08, 0.02, 0.1, 1], crackGlow: [1, 0.3, 0.9, 1] } },
    ],
    cost: 'mid',
  },
  {
    id: 'soft-cells', kind: 'shader', ref: 'GA2-SoftCells.fs',
    tiers: ['calm', 'groove'], moods: ['mono', 'warm', 'dark', 'acid', 'cool'], texture: 'geometric', scale: ['span'],
    params: { colorMode: 0, scale: 3 },
    variants: [{ mood: 'mono', params: { colorMode: 0 } }, { mood: 'warm', params: { colorMode: 3 } }, { mood: 'dark', params: { colorMode: 4 } }, { mood: 'acid', params: { colorMode: 5 } }, { mood: 'cool', params: { colorMode: 2 } }],
    cost: 'low',
  },
  {
    id: 'colour-wash', kind: 'shader', ref: 'STAGE-ColourWash.fs',
    tiers: ['calm', 'groove'], moods: ['warm', 'cool', 'acid', 'mono'], texture: 'light', scale: ['span', 'piece'],
    params: { colorMode: 3 },
    variants: [{ mood: 'warm', params: { colorMode: 3 } }, { mood: 'cool', params: { colorMode: 2 } }, { mood: 'acid', params: { colorMode: 0 } }, { mood: 'mono', params: { colorMode: 4 } }],
    cost: 'low',
  },
  {
    id: 'followspot', kind: 'shader', ref: 'STAGE-Followspot.fs',
    tiers: ['calm', 'groove'], moods: ['dark', 'mono', 'warm', 'cool'], texture: 'light', scale: ['span'],
    params: { spots: 3, spotSize: 0.3 },
    variants: [{ mood: 'mono', params: { colorMode: 0 } }, { mood: 'warm', params: { colorMode: 1 } }, { mood: 'cool', params: { colorMode: 3 } }],
    cost: 'low',
  },
  {
    id: 'minimal-surface', kind: 'shader', ref: 'GA2-MinimalSurface.fs',
    tiers: ['calm', 'groove'], moods: ['mono', 'cool', 'warm', 'acid'], texture: 'geometric', scale: ['span'],
    params: { colorMode: 3 },
    variants: [{ mood: 'mono', params: { colorMode: 3 } }, { mood: 'cool', params: { colorMode: 1 } }, { mood: 'warm', params: { colorMode: 2 } }, { mood: 'acid', params: { colorMode: 6 } }],
    cost: 'high',
  },
  {
    id: 'mercury-pool', kind: 'shader', ref: 'MercuryPool.fs',
    tiers: ['calm', 'groove'], moods: ['mono'], texture: 'organic', scale: ['span'],
    cost: 'low',
  },
  {
    id: 'gradient-glow', kind: 'look', ref: 'gradient-glow',
    tiers: ['calm'], moods: ['cool', 'warm', 'acid'], texture: 'light', scale: ['piece'],
    params: { palette: 6 /* ocean */ },
    variants: [{ mood: 'cool', params: { palette: 6 /* ocean */ } }, { mood: 'warm', params: { palette: 1 /* sunset */ } }, { mood: 'acid', params: { palette: 4 /* candy */ } }],
    cost: 'low',
  },
  {
    id: 'wireframe-origami', kind: 'look', ref: 'wireframe-origami',
    tiers: ['calm', 'groove'], moods: ['cool', 'mono', 'warm'], texture: 'geometric', scale: ['piece'],
    params: { palette: 2 /* ice */ },
    variants: [{ mood: 'cool', params: { palette: 2 /* ice */ } }, { mood: 'mono', params: { palette: 7 /* mono */ } }, { mood: 'warm', params: { palette: 1 /* sunset */ } }],
    cost: 'low',
  },
  // ── Groove: verses, steady sections ─────────────────────────────
  {
    id: 'lumen-strata', kind: 'shader', ref: 'Featured-lumenstrata.fs',
    tiers: ['groove', 'drive'], moods: ['acid', 'cool', 'warm'], texture: 'light', scale: ['piece', 'span'],
    variants: [{ mood: 'acid', params: { hueShift: 0 } }, { mood: 'cool', params: { hueShift: -0.3 } }, { mood: 'warm', params: { hueShift: 0.3 } }],
    cost: 'mid',
  },
  {
    id: 'phase-portrait', kind: 'shader', ref: 'GA2-PhasePortrait.fs',
    tiers: ['groove', 'drive'], moods: ['acid', 'cool', 'warm', 'mono'], texture: 'geometric', scale: ['span', 'piece'],
    params: { colorMode: 0 },
    variants: [{ mood: 'acid', params: { colorMode: 0 } }, { mood: 'cool', params: { colorMode: 1 } }, { mood: 'warm', params: { colorMode: 5 } }, { mood: 'mono', params: { colorMode: 4 } }],
    cost: 'low',
  },
  {
    id: 'kakeya', kind: 'shader', ref: 'GA2-Kakeya.fs',
    tiers: ['groove', 'drive'], moods: ['warm', 'cool', 'acid', 'mono'], texture: 'light', scale: ['span', 'piece'],
    params: { colorMode: 0 },
    variants: [{ mood: 'warm', params: { colorMode: 0 } }, { mood: 'cool', params: { colorMode: 1 } }, { mood: 'acid', params: { colorMode: 2 } }, { mood: 'mono', params: { colorMode: 4 } }],
    cost: 'high',
  },
  {
    id: 'quasicrystal', kind: 'shader', ref: 'GA2-Quasicrystal.fs',
    tiers: ['groove'], moods: ['warm', 'cool', 'mono'], texture: 'geometric', scale: ['span'],
    params: { colorMode: 2 },
    variants: [{ mood: 'warm', params: { colorMode: 2 } }, { mood: 'cool', params: { colorMode: 1 } }, { mood: 'mono', params: { colorMode: 6 } }],
    cost: 'mid',
  },
  {
    id: 'oil-wheel', kind: 'shader', ref: 'PSY-OilWheel.fs',
    tiers: ['groove', 'drive'], moods: ['acid', 'warm', 'cool'], texture: 'organic', scale: ['span'],
    params: { colorMode: 0 },
    variants: [{ mood: 'acid', params: { colorMode: 0 } }, { mood: 'warm', params: { colorMode: 3 } }, { mood: 'cool', params: { colorMode: 4 } }],
    cost: 'mid',
  },
  {
    id: 'drift', kind: 'shader', ref: 'Featured-drift.fs',
    tiers: ['groove'], moods: ['acid', 'warm'], texture: 'organic', scale: ['span'],
    variants: [{ mood: 'acid', params: { paletteShift: 0 } }, { mood: 'warm', params: { paletteShift: 0.5 } }],
    cost: 'mid',
  },
  {
    id: 'pulse-halo', kind: 'shader', ref: 'LIVE-PulseHalo.fs',
    tiers: ['groove', 'drive', 'peak'], moods: ['dark', 'cool'], texture: 'light', scale: ['span'],
    variants: [{ mood: 'cool', params: { hue: 0.55 } }],
    cost: 'low',
  },
  {
    id: 'flip-cards', kind: 'look', ref: 'flip-cards',
    tiers: ['groove', 'drive'], moods: ['warm', 'cool', 'acid'], texture: 'geometric', scale: ['piece'],
    params: { palette: 1 /* sunset */ },
    variants: [{ mood: 'warm', params: { palette: 1 /* sunset */ } }, { mood: 'cool', params: { palette: 2 /* ice */ } }, { mood: 'acid', params: { palette: 4 /* candy */ } }],
    cost: 'low',
  },
  // ── Drive: builds and driving sections ──────────────────────────
  {
    id: 'tide', kind: 'shader', ref: 'Featured-tide.fs',
    tiers: ['drive'], moods: ['acid'], texture: 'organic', scale: ['span'],
    cost: 'high',
  },
  {
    id: 'coloured-shadows', kind: 'shader', ref: 'GA2-ColouredShadows.fs',
    tiers: ['drive', 'peak'], moods: ['acid', 'warm', 'cool', 'mono'], texture: 'light', scale: ['span', 'piece'],
    params: { colorMode: 0 },
    variants: [{ mood: 'acid', params: { colorMode: 0 } }, { mood: 'warm', params: { colorMode: 5 } }, { mood: 'cool', params: { colorMode: 6 } }, { mood: 'mono', params: { colorMode: 2 } }],
    cost: 'mid',
  },
  {
    id: 'tie-dye', kind: 'shader', ref: 'PSY-TieDye.fs',
    tiers: ['drive', 'peak'], moods: ['acid', 'warm', 'cool', 'dark'], texture: 'organic', scale: ['span', 'piece'],
    params: { colorMode: 0 },
    variants: [{ mood: 'acid', params: { colorMode: 0 } }, { mood: 'warm', params: { colorMode: 2 } }, { mood: 'cool', params: { colorMode: 1 } }, { mood: 'dark', params: { colorMode: 6 } }],
    cost: 'low',
  },
  {
    id: 'acid-flow', kind: 'shader', ref: 'PSY-AcidFlow.fs',
    tiers: ['drive', 'peak'], moods: ['acid', 'warm', 'cool', 'mono'], texture: 'organic', scale: ['span'],
    params: { colorMode: 0 },
    variants: [{ mood: 'acid', params: { colorMode: 0 } }, { mood: 'warm', params: { colorMode: 1 } }, { mood: 'cool', params: { colorMode: 2 } }, { mood: 'mono', params: { colorMode: 6 } }],
    cost: 'mid',
  },
  {
    id: 'beam-rig', kind: 'shader', ref: 'STAGE-BeamRig.fs',
    tiers: ['drive', 'peak'], moods: ['acid', 'warm', 'cool', 'mono', 'dark'], texture: 'light', scale: ['span'],
    params: { colorMode: 0, fixtures: 12, exposure: 1.5, haze: 1.1, beamWidth: 0.35 },
    variants: [{ mood: 'acid', params: { colorMode: 0 } }, { mood: 'warm', params: { colorMode: 3 } }, { mood: 'cool', params: { colorMode: 2 } }, { mood: 'mono', params: { colorMode: 6 } }, { mood: 'dark', params: { colorMode: 2, exposure: 1, haze: 0.7 } }],
    cost: 'mid',
  },
  {
    id: 'molten-lava', kind: 'shader', ref: 'MorphingLava.fs',
    tiers: ['drive', 'peak'], moods: ['warm'], texture: 'organic', scale: ['span'],
    cost: 'low',
  },
  {
    id: 'clock-wipe', kind: 'look', ref: 'clock-wipe',
    tiers: ['groove', 'drive'], moods: ['cool', 'warm', 'acid'], texture: 'geometric', scale: ['piece'],
    params: { palette: 6 /* ocean */ },
    variants: [{ mood: 'cool', params: { palette: 6 /* ocean */ } }, { mood: 'warm', params: { palette: 5 /* fire */ } }, { mood: 'acid', params: { palette: 3 /* acid */ } }],
    cost: 'low',
  },
  {
    id: 'hue-hop', kind: 'look', ref: 'hue-hop',
    tiers: ['drive', 'peak'], moods: ['acid', 'warm', 'cool'], texture: 'light', scale: ['piece'],
    params: { palette: 0 /* neon */ },
    variants: [{ mood: 'acid', params: { palette: 0 /* neon */ } }, { mood: 'warm', params: { palette: 5 /* fire */ } }, { mood: 'cool', params: { palette: 6 /* ocean */ } }],
    cost: 'low',
  },
  // ── Peak: drops ─────────────────────────────────────────────────
  {
    id: 'chrysanthemum', kind: 'shader', ref: 'PSY-Chrysanthemum.fs',
    tiers: ['peak', 'drive'], moods: ['acid', 'warm', 'mono', 'cool'], texture: 'geometric', scale: ['span', 'piece'],
    params: { colorMode: 0 },
    variants: [{ mood: 'acid', params: { colorMode: 3 } }, { mood: 'warm', params: { colorMode: 2 } }, { mood: 'mono', params: { colorMode: 6 } }, { mood: 'cool', params: { colorMode: 1 } }],
    cost: 'mid',
  },
  {
    id: 'form-constants', kind: 'shader', ref: 'PSY-FormConstants.fs',
    tiers: ['peak', 'drive'], moods: ['mono', 'acid', 'warm', 'cool'], texture: 'geometric', scale: ['span', 'piece'],
    params: { colorMode: 6 },
    variants: [{ mood: 'mono', params: { colorMode: 6 } }, { mood: 'acid', params: { colorMode: 4 } }, { mood: 'warm', params: { colorMode: 5 } }, { mood: 'cool', params: { colorMode: 0 } }],
    cost: 'low',
  },
  {
    id: 'modular-grid', kind: 'shader', ref: 'ModularGrid.fs',
    tiers: ['drive', 'peak'], moods: ['mono'], texture: 'geometric', scale: ['span'],
    cost: 'low',
  },
  {
    id: 'glitch-blocks', kind: 'shader', ref: 'GlitchBlocks.fs',
    tiers: ['peak'], moods: ['acid'], texture: 'glitch', scale: ['span'],
    params: { intensity: 0.9 },
    cost: 'low',
  },
  {
    id: 'mosaic-shimmer', kind: 'look', ref: 'mosaic-shimmer',
    tiers: ['drive', 'peak'], moods: ['acid', 'mono', 'cool'], texture: 'glitch', scale: ['piece'],
    params: { palette: 4 /* candy */ },
    variants: [{ mood: 'acid', params: { palette: 4 /* candy */ } }, { mood: 'mono', params: { palette: 7 /* mono */ } }, { mood: 'cool', params: { palette: 2 /* ice */ } }],
    cost: 'low',
  },
];

/** An entry's starting values in a mood: its params with that mood's preset laid over them. */
export function autoShowParams(entry: AutoShowContent, mood?: AutoShowMood): Record<string, number | boolean | number[]> {
  const preset = mood ? entry.variants?.find((v) => v.mood === mood) : undefined;
  return { ...(entry.params ?? {}), ...(preset?.params ?? {}) };
}

/** For a Look entry: the LOOK_PALETTES id it wears in a mood (params.palette is an index). */
export function autoShowLookPalette(entry: AutoShowContent, mood?: AutoShowMood): string | undefined {
  if (entry.kind !== 'look') return undefined;
  const index = autoShowParams(entry, mood).palette;
  return typeof index === 'number' ? LOOK_PALETTES[index]?.id : undefined;
}

/**
 * Screen FX that sit well over each texture, by tier, strongest fit first.
 * Screen FX dim and flash whole pieces, so they are accents over content:
 * light content already moves like a rig, so it takes beat pulses and sweeps;
 * geometric content takes chases and checkers that agree with its edges;
 * organic content wants breathing and waves rather than hard cuts; glitch
 * takes random hits and checkers. Strobe and inverse pulse black the stage out
 * between flashes; keep them for drops, and off dark-mood content.
 */
export const AUTO_SHOW_SCREEN_FX: Record<AutoShowContent['texture'], Record<AutoShowTier, StageEffectType[]>> = {
  light: {
    calm: ['breathing', 'sine-wave'],
    groove: ['beat-pulse', 'sine-wave', 'chase'],
    drive: ['linear-sweep', 'chase', 'radial-pulse'],
    peak: ['beat-pulse', 'strobe', 'split-flash'],
  },
  geometric: {
    calm: ['breathing', 'cascade'],
    groove: ['chase', 'cascade', 'sine-wave'],
    drive: ['linear-sweep', 'spiral', 'chase'],
    peak: ['checker', 'beat-pulse', 'split-flash'],
  },
  organic: {
    calm: ['breathing', 'sine-wave'],
    groove: ['sine-wave', 'radial-pulse'],
    drive: ['radial-pulse', 'linear-sweep'],
    peak: ['beat-pulse', 'radial-pulse'],
  },
  glitch: {
    calm: ['twinkle'],
    groove: ['random-hits', 'twinkle'],
    drive: ['random-hits', 'checker'],
    peak: ['random-hits', 'strobe', 'inverse-pulse'],
  },
};
