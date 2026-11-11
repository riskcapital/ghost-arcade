/**
 * Auto show's built-in content (data only; the types and how a show picks
 * from it are in catalog.ts). Shaders from public/ISF and shape Looks that
 * read well on mapped pieces, tagged by energy tier, mood, texture and
 * scale, with colour variants per mood.
 */
import type { AutoShowContent } from './catalog';

export const AUTO_SHOW_CATALOG: AutoShowContent[] = [
  {
    id: 'ga2-quasicrystal', kind: 'shader', ref: 'GA2-Quasicrystal.fs',
    tiers: ['calm', 'groove'], moods: ['cool', 'warm', 'acid', 'mono'], texture: 'geometric', scale: ['span', 'piece'],
    params: { drift: 0.3 },
    variants: [
      { mood: 'cool', params: { colorMode: 1 } }, { mood: 'warm', params: { colorMode: 2 } }, { mood: 'acid', params: { colorMode: 4 } },
      { mood: 'mono', params: { colorMode: 6 } }, { mood: 'dark', params: { colorMode: 3, exposure: 0.8 } },
    ],
    cost: 'mid',
  },
  {
    id: 'ga2-driftveil', kind: 'shader', ref: 'GA2-DriftVeil.fs',
    tiers: ['calm'], moods: ['dark', 'cool', 'warm'], texture: 'organic', scale: ['span'],
    variants: [
      { mood: 'dark', params: { colorMode: 1 } }, { mood: 'cool', params: { colorMode: 4 } }, { mood: 'warm', params: { colorMode: 6 } },
      { mood: 'acid', params: { colorMode: 3 } }, { mood: 'mono', params: { colorMode: 5 } },
    ],
    cost: 'high',
  },
  {
    id: 'ga2-softcells', kind: 'shader', ref: 'GA2-SoftCells.fs',
    tiers: ['groove', 'drive'], moods: ['warm', 'cool', 'acid', 'mono'], texture: 'geometric', scale: ['piece'],
    params: { breathe: 0.5 },
    variants: [
      { mood: 'warm', params: { colorMode: 3 } }, { mood: 'cool', params: { colorMode: 2 } }, { mood: 'acid', params: { colorMode: 5 } },
      { mood: 'mono', params: { colorMode: 0 } }, { mood: 'dark', params: { colorMode: 4 } },
    ],
    cost: 'mid',
  },
  {
    id: 'ga2-lightbox', kind: 'shader', ref: 'GA2-Lightbox.fs',
    tiers: ['calm', 'groove'], moods: ['warm', 'dark', 'cool'], texture: 'organic', scale: ['piece', 'span'],
    variants: [
      { mood: 'warm', params: { colorMode: 0 } }, { mood: 'dark', params: { colorMode: 1 } }, { mood: 'cool', params: { colorMode: 4 } },
      { mood: 'acid', params: { colorMode: 3 } }, { mood: 'mono', params: { colorMode: 6 } },
    ],
    cost: 'mid',
  },
  {
    id: 'stage-colourwash', kind: 'shader', ref: 'STAGE-ColourWash.fs',
    tiers: ['calm', 'groove'], moods: ['warm', 'cool', 'acid'], texture: 'light', scale: ['span'],
    params: { motion: 1, colorPattern: 3 },
    variants: [
      { mood: 'warm', params: { colorMode: 1 } }, { mood: 'cool', params: { colorMode: 2 } }, { mood: 'acid', params: { colorMode: 5 } },
      { mood: 'dark', params: { colorMode: 2, level: 0.7 } }, { mood: 'mono', params: { colorMode: 6 } },
    ],
    cost: 'low',
  },
  {
    id: 'stage-beamrig', kind: 'shader', ref: 'STAGE-BeamRig.fs',
    tiers: ['drive', 'peak'], moods: ['acid', 'cool', 'warm', 'mono'], texture: 'light', scale: ['span'],
    params: { movement: 3, colorPattern: 4 },
    variants: [
      { mood: 'acid', params: { colorMode: 0 } }, { mood: 'cool', params: { colorMode: 2 } }, { mood: 'warm', params: { colorMode: 1 } },
      { mood: 'mono', params: { colorMode: 6 } }, { mood: 'dark', params: { colorMode: 4 } },
    ],
    cost: 'mid',
  },
  {
    id: 'stage-lightcurtain', kind: 'shader', ref: 'STAGE-LightCurtain.fs',
    tiers: ['groove', 'drive'], moods: ['cool', 'warm', 'dark', 'mono'], texture: 'light', scale: ['span', 'piece'],
    params: { chase: 0.6 },
    variants: [
      { mood: 'cool', params: { colorMode: 1 } }, { mood: 'warm', params: { colorMode: 2 } }, { mood: 'dark', params: { colorMode: 4 } },
      { mood: 'acid', params: { colorMode: 5 } }, { mood: 'mono', params: { colorMode: 6 } },
    ],
    cost: 'low',
  },
  {
    id: 'live-obsidianflow', kind: 'shader', ref: 'LIVE-ObsidianFlow.fs',
    tiers: ['drive', 'peak'], moods: ['dark', 'mono', 'cool'], texture: 'organic', scale: ['piece'],
    variants: [
      { mood: 'dark', params: { tint: 0.75 } }, { mood: 'mono', params: { tint: 0 } }, { mood: 'cool', params: { tint: 0.55 } },
      { mood: 'warm', params: { tint: 0.1 } }, { mood: 'acid', params: { tint: 0.3 } },
    ],
    cost: 'mid',
  },
  {
    id: 'live-pulsehalo', kind: 'shader', ref: 'LIVE-PulseHalo.fs',
    tiers: ['peak', 'drive'], moods: ['warm', 'acid', 'cool'], texture: 'light', scale: ['piece'],
    variants: [
      { mood: 'warm', params: { hue: 0.06 } }, { mood: 'acid', params: { hue: 0.3 } }, { mood: 'cool', params: { hue: 0.55 } },
      { mood: 'dark', params: { hue: 0.75 } }, { mood: 'mono', params: { hue: 0.6, chroma: 0 } },
    ],
    cost: 'low',
  },
  {
    id: 'featured-lumenveil', kind: 'shader', ref: 'Featured-lumenveil.fs',
    tiers: ['groove', 'drive'], moods: ['cool', 'acid', 'warm'], texture: 'geometric', scale: ['piece'],
    variants: [
      { mood: 'cool', params: { hueShift: 0.55 } }, { mood: 'acid', params: { hueShift: 0.25 } }, { mood: 'warm', params: { hueShift: 0.02 } },
      { mood: 'dark', params: { hueShift: 0.7, saturation: 0.6 } }, { mood: 'mono', params: { saturation: 0 } },
    ],
    cost: 'low',
  },
  {
    id: 'look-echo-rings', kind: 'look', ref: 'echo-rings',
    tiers: ['calm', 'peak'], moods: ['acid', 'cool', 'dark'], texture: 'light', scale: ['piece'],
    cost: 'low',
  },
  {
    id: 'look-comet-chase', kind: 'look', ref: 'comet-chase',
    tiers: ['drive'], moods: ['cool', 'mono'], texture: 'light', scale: ['piece'],
    cost: 'low',
  },
];
