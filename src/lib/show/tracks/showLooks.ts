/**
 * The Timeline's Looks row: one-click shape Looks worn by the shapes for a
 * span of show time.
 *
 * Pure, like the rest of the show evaluation. `evaluateShowLooks` says which
 * look blocks are under show time `t` and how strongly; `applyShowLooks`
 * dresses the scene's shapes with them when the scene is built. Nothing is
 * written into the project, so scrubbing, live play and an export give the
 * same picture, and outside every block the shapes wear their own Edge
 * Effects again.
 *
 * Rules:
 * - Blocks own half-open spans [start, start + duration).
 * - Fades in and out ramp the look's strength (and the shapes' own Edge
 *   Effects the other way).
 * - Where two blocks overlap, the overlap is a crossfade: the earlier block
 *   ramps out while the later one ramps in. Touching blocks cut.
 * - A look's strength scales the opacity of each of its effects. Below full
 *   strength, the shapes' own effects are drawn with the rest.
 * - Each (block, shape) pair keeps the same effect ids for its whole span,
 *   so the core keeps one effect state per shape (chases, beat reactions).
 */
import type { EdgeEffect, EdgeEffectsConfig, Layer, ShowLookClip } from '../../types';
import { edgeLook } from '../../looks/edgeLookCatalog';
import { buildLookEffects, isLookTarget, lookPalette, lookTargetLayerIds } from '../../looks/edgeLooks';

/** One look block at one instant. */
export interface ShowLookState {
  clipId: string;
  lookId: string;
  paletteId: string;
  scope: ShowLookClip['scope'];
  layerIds: readonly string[];
  /** 0..1: fades × crossfade ramps. */
  weight: number;
  /** The block's where line at this instant: shape id → 0..1. Shapes not in
   *  it do not wear the block. Unset: no where line. */
  where?: ReadonlyMap<string, number>;
}

const EPS = 1e-6;

function clipEnd(clip: Pick<ShowLookClip, 'startTime' | 'duration'>): number {
  return clip.startTime + clip.duration;
}

function fadeGain(clip: ShowLookClip, t: number): number {
  const d = Math.max(0, clip.duration);
  let fadeIn = Math.max(0, Number(clip.fadeIn) || 0);
  let fadeOut = Math.max(0, Number(clip.fadeOut) || 0);
  if (fadeIn + fadeOut > d && fadeIn + fadeOut > 0) {
    const k = d / (fadeIn + fadeOut);
    fadeIn *= k;
    fadeOut *= k;
  }
  let gain = 1;
  if (fadeIn > 0) gain = Math.min(gain, (t - clip.startTime) / fadeIn);
  if (fadeOut > 0) gain = Math.min(gain, (clipEnd(clip) - t) / fadeOut);
  return Math.max(0, Math.min(1, gain));
}

/** The look blocks under show time `t`, in start order (the later one is
 *  drawn on top). */
export function evaluateShowLooks(clips: readonly ShowLookClip[], t: number): ShowLookState[] {
  const active = clips
    .filter((c) => c.duration > 0 && t >= c.startTime - EPS && t < clipEnd(c) - EPS)
    .sort((a, b) => a.startTime - b.startTime || (a.id < b.id ? -1 : 1));
  if (!active.length) return [];
  const out: ShowLookState[] = [];
  for (const clip of active) {
    let weight = fadeGain(clip, t);
    for (const other of active) {
      if (other === clip) continue;
      if (other.startTime < clip.startTime || (other.startTime === clip.startTime && other.id < clip.id)) {
        // `other` began first: this block ramps in over their overlap.
        const span = Math.min(clipEnd(other), clipEnd(clip)) - clip.startTime;
        if (span > EPS) weight *= Math.max(0, Math.min(1, (t - clip.startTime) / span));
      } else {
        // `other` began later: this block ramps out over their overlap.
        const span = Math.min(clipEnd(clip), clipEnd(other)) - other.startTime;
        if (span > EPS && t >= other.startTime) weight *= Math.max(0, Math.min(1, 1 - (t - other.startTime) / span));
      }
    }
    if (weight <= 0 || !edgeLook(clip.lookId)) continue;
    out.push({
      clipId: clip.id,
      lookId: clip.lookId,
      paletteId: lookPalette(clip.paletteId).id,
      scope: clip.scope === 'pieces' ? 'pieces' : 'all',
      layerIds: clip.scope === 'pieces' ? clip.layerIds ?? [] : [],
      weight,
    });
  }
  return out;
}

/** A weight as the 8-bit output can show it. */
function weightStep(weight: number): number {
  return Math.round(Math.max(0, Math.min(1, weight)) * 255);
}

/** What decides whether the scene must be rebuilt for the looks. */
export function showLooksSignature(looks: readonly ShowLookState[] | undefined): string {
  if (!looks?.length) return '';
  return looks.map((l) => `${l.clipId}/${l.lookId}/${l.paletteId}/${l.scope}/${l.layerIds.join(',')}/${weightStep(l.weight)}${whereSignature(l.where)}`).join(';');
}

function whereSignature(where: ReadonlyMap<string, number> | undefined): string {
  if (!where) return '';
  let out = '/w';
  for (const [id, w] of where) {
    const step = weightStep(w);
    if (step > 0) out += `:${id}=${step}`;
  }
  return out;
}

// ─── Building the stacks ────────────────────────────────────────────────

/** Full-strength stacks by block, look, palette and shape. Ids are fixed
 *  per pair so the core sees the same effects on every rebuild. */
const fullStacks = new Map<string, EdgeEffectsConfig>();
const FULL_STACK_LIMIT = 2048;

function fullStack(look: ShowLookState, layerId: string): EdgeEffectsConfig | null {
  const key = `${look.clipId}|${look.lookId}|${look.paletteId}|${layerId}`;
  const hit = fullStacks.get(key);
  if (hit) return hit;
  const def = edgeLook(look.lookId);
  if (!def) return null;
  const effects = buildLookEffects(def, look.paletteId).map((effect, i) => ({ ...effect, id: `showlook:${look.clipId}:${layerId}:${i}` }));
  const config: EdgeEffectsConfig = { enabled: true, effects, look: { id: def.id, paletteId: look.paletteId } };
  if (def.cornerRadius) config.cornerRadius = def.cornerRadius;
  if (fullStacks.size >= FULL_STACK_LIMIT) fullStacks.clear();
  fullStacks.set(key, config);
  return config;
}

function scaled(effects: readonly EdgeEffect[], weight: number): EdgeEffect[] {
  if (weight >= 1) return effects as EdgeEffect[];
  return effects.map((e) => ({ ...e, opacity: (e.opacity ?? 1) * weight }));
}

/** The last mixed stack per shape, kept while its inputs stay the same so a
 *  settled scene hands the core the same object. */
const mixed = new Map<string, { sig: string; own: EdgeEffectsConfig | null; config: EdgeEffectsConfig }>();

function mixedStack(layer: Layer, looks: readonly ShowLookState[]): EdgeEffectsConfig | null {
  const own = layer.edgeEffects?.enabled ? layer.edgeEffects : null;
  const sig = looks.map((l) => `${l.clipId}/${l.lookId}/${l.paletteId}/${weightStep(l.weight)}`).join(';');
  const memo = mixed.get(layer.id);
  if (memo && memo.sig === sig && memo.own === own) return memo.config;
  const total = Math.min(1, looks.reduce((sum, l) => sum + l.weight, 0));
  const stacks = looks.map((l) => ({ look: l, config: fullStack(l, layer.id) })).filter((s) => s.config) as Array<{ look: ShowLookState; config: EdgeEffectsConfig }>;
  if (!stacks.length) return null;
  const top = stacks[stacks.length - 1];
  let config: EdgeEffectsConfig;
  if (stacks.length === 1 && weightStep(top.look.weight) >= 255) {
    config = top.config;
  } else {
    const effects: EdgeEffect[] = [];
    // The shape's own effects show through what the looks leave.
    if (own && total < 1) effects.push(...scaled(own.effects ?? [], 1 - total));
    for (const s of stacks) effects.push(...scaled(s.config.effects, weightStep(s.look.weight) / 255));
    config = { ...top.config, effects };
  }
  mixed.set(layer.id, { sig, own, config });
  if (mixed.size > FULL_STACK_LIMIT) mixed.clear();
  return config;
}

/**
 * Dress the scene's shapes with the looks under the playhead. `layers` is
 * the scene being built; `liveLayers` the mapping layers it was built from
 * (a group in a block's scope brings its members). Returns `layers` itself
 * when no look applies.
 */
export function applyShowLooks(layers: Layer[], looks: readonly ShowLookState[] | undefined, liveLayers: readonly Layer[] = layers): Layer[] {
  if (!looks?.length) return layers;
  const all = new Set(liveLayers.filter(isLookTarget).map((l) => l.id));
  const scoped = new Map<string, Set<string>>();
  for (const look of looks) {
    if (look.scope === 'pieces') scoped.set(look.clipId, new Set(lookTargetLayerIds(liveLayers, look.layerIds, 'selected')));
  }
  let changed = false;
  const out = layers.map((layer) => {
    if (!all.has(layer.id)) return layer;
    const wearing = looks
      .filter((l) => l.scope === 'all' || scoped.get(l.clipId)?.has(layer.id))
      // A where line: only the shapes in its window, by how lit they are.
      .map((l) => (l.where ? { ...l, weight: l.weight * (l.where.get(layer.id) ?? 0) } : l))
      .filter((l) => weightStep(l.weight) > 0);
    if (!wearing.length) return layer;
    const config = mixedStack(layer, wearing);
    if (!config) return layer;
    changed = true;
    return { ...layer, edgeEffects: config };
  });
  return changed ? out : layers;
}

/** Test seam: forget the cached stacks. */
export function _resetShowLookCaches(): void {
  fullStacks.clear();
  mixed.clear();
}
