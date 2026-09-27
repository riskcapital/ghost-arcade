// One-click Looks: curated Edge Effect stacks for drawn shapes.
//
// A Look is a recipe, not a saved stack: it builds its effects from a small
// palette (three colours), so swapping the palette re-runs the recipe with
// new colours. Every Look carries its own beat reaction (EdgeEffect.react,
// evaluated by the native core against the launch clock) and group chase,
// so a freshly drawn set of shapes animates to the beat the moment a Look is
// picked, with or without audio input.

import type { EdgeEffect, EdgeEffectReact } from '../types';
import { edgeTypeDefaults } from '../drawing/edgeEffectCatalog';
import { generateUUID } from '../utils/uuid';

export type Rgba = [number, number, number, number];

export interface LookPalette {
  id: string;
  name: string;
  /** Primary, secondary, accent. */
  colors: [Rgba, Rgba, Rgba];
}

const hex = (value: string, alpha = 1): Rgba => {
  const n = parseInt(value.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, alpha];
};

export const LOOK_PALETTES: LookPalette[] = [
  { id: 'neon', name: 'Neon', colors: [hex('#ff2bd6'), hex('#00e5ff'), hex('#ffe600')] },
  { id: 'sunset', name: 'Sunset', colors: [hex('#ff5e3a'), hex('#ffb03a'), hex('#d61f69')] },
  { id: 'ice', name: 'Ice', colors: [hex('#7df9ff'), hex('#3a6bff'), hex('#ffffff')] },
  { id: 'acid', name: 'Acid', colors: [hex('#b6ff00'), hex('#00ff9c'), hex('#ff00e6')] },
  { id: 'candy', name: 'Candy', colors: [hex('#ff7ab6'), hex('#8a7bff'), hex('#6ef3d6')] },
  { id: 'fire', name: 'Fire', colors: [hex('#ff3b1f'), hex('#ffc400'), hex('#ff7a00')] },
  { id: 'ocean', name: 'Ocean', colors: [hex('#00c2ff'), hex('#00ffc8'), hex('#2d5bff')] },
  { id: 'mono', name: 'White', colors: [hex('#ffffff'), hex('#9aa3ad'), hex('#ffffff')] },
];

export const DEFAULT_LOOK_PALETTE_ID = 'neon';

export function lookPalette(id: string | undefined): LookPalette {
  return LOOK_PALETTES.find((palette) => palette.id === id) ?? LOOK_PALETTES[0];
}

/** Colours a recipe works with: a, b, c from the palette, plus helpers. */
export interface LookColors {
  a: Rgba;
  b: Rgba;
  c: Rgba;
  /** `color` with a new alpha. */
  alpha(color: Rgba, alpha: number): Rgba;
  clear: Rgba;
  white: Rgba;
}

export interface LookDef {
  id: string;
  name: string;
  /** One line for the gallery card. */
  blurb: string;
  /** Palette the gallery thumbnail is rendered with. */
  palette: string;
  cornerRadius?: number;
  build(colors: LookColors): LookEffectSpec[];
}

/** A recipe's effect before ids: parts merge onto the catalog defaults. */
export interface LookEffectSpec {
  stroke?: Record<string, unknown> & { type: string };
  fill?: Record<string, unknown> & { type: string };
  animation?: Record<string, unknown> & { type: string };
  blendMode?: EdgeEffect['blendMode'];
  opacity?: number;
  chaseMode?: EdgeEffect['chaseMode'];
  chaseSpread?: number;
  react?: EdgeEffectReact;
}

const part = (kind: 'stroke' | 'fill' | 'animation', spec?: Record<string, unknown> & { type: string }) =>
  spec ? { ...edgeTypeDefaults(kind, spec.type), ...spec } : { type: 'none' };

/** A Look's effects for `paletteId`, each with a fresh id. */
export function buildLookEffects(look: LookDef, paletteId?: string): EdgeEffect[] {
  const [a, b, c] = lookPalette(paletteId ?? look.palette).colors;
  const colors: LookColors = {
    a, b, c,
    alpha: (color, alpha) => [color[0], color[1], color[2], alpha],
    clear: [0, 0, 0, 0],
    white: [1, 1, 1, 1],
  };
  return look.build(colors).map((spec) => {
    const effect: EdgeEffect = {
      id: generateUUID(),
      enabled: true,
      stroke: part('stroke', spec.stroke) as unknown as EdgeEffect['stroke'],
      fill: part('fill', spec.fill) as unknown as EdgeEffect['fill'],
      animation: part('animation', spec.animation) as unknown as EdgeEffect['animation'],
      blendMode: spec.blendMode ?? 'normal',
      opacity: spec.opacity ?? 1,
    };
    if (spec.chaseMode && spec.chaseMode !== 'none') {
      effect.chaseMode = spec.chaseMode;
      effect.chaseSpread = spec.chaseSpread ?? 0.5;
    }
    if (spec.react && spec.react.mode !== 'none') effect.react = { ...spec.react };
    return effect;
  });
}

// ---------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------

type TargetLayer = { id: string; type: string; parentGroupId?: string | null; corners?: unknown };

/** Layers a Look can dress: anything with an outline, not groups, masks or
 *  the VJ feed. */
export function isLookTarget(layer: TargetLayer): boolean {
  return !!layer.corners && layer.type !== 'group' && layer.type !== 'mask' && !String(layer.id).startsWith('vj-');
}

export type LookScope = 'all' | 'selected';

/** Layer ids a Look applies to. `selected` expands a selected group to its
 *  members, so picking a group dresses the whole group. */
export function lookTargetLayerIds(layers: readonly TargetLayer[], selectedIds: readonly string[], scope: LookScope): string[] {
  if (scope === 'all') return layers.filter(isLookTarget).map((layer) => layer.id);
  const picked = new Set(selectedIds);
  return layers.filter((layer) => isLookTarget(layer)
    && (picked.has(layer.id) || (!!layer.parentGroupId && picked.has(layer.parentGroupId)))).map((layer) => layer.id);
}
