/**
 * The A/B crossfader as a per-frame value.
 *
 * The fader moves every frame while it is ridden (by hand, MIDI, OSC, Auto or
 * a glide). The VJ scene is built from it in a few places: the mix the
 * crossfade carriers pass to the transition shader, each single-deck row's
 * weight in the VJ Mix rows, and each MAP preset row's opacity. Rebuilding
 * and handing over the whole scene for each step cost a full scene build and
 * a fresh diff every frame.
 *
 * Instead the scene is built once and every value that follows the fader is
 * tagged on its layer (`_xfadeFrame`). The frame sync calls
 * `applyCrossfadeFrame` on each frame it sends, which puts the fader's current
 * position into those values. A built scene with the fader moved this way is
 * exactly the scene a full build at the new position gives, as long as the
 * fader stays in the same step (`crossfadeSceneStep`): which deck a row
 * carrier copies its layer settings from, and whether a deck shows at all.
 * Crossing a step is a scene change and rebuilds.
 */
import type { Layer } from '../types';
import { applyFaderCurve } from './crossfadeTransitions';

export type CrossfaderCurve = 'linear' | 'constant-power' | 'sharp-cut';
export type CrossfaderPosition = {
  crossfaderEnabled?: boolean;
  crossfaderValue?: number;
  crossfaderCurve?: CrossfaderCurve;
};
export type CrossfadeDeck = 'a' | 'b';

/** What follows the fader on one scene layer. Runtime only, never saved. */
export type CrossfadeFrameTag = {
  /** `effectSource.vjxfadeMix` is the fader's mix (A/B carriers). */
  mix?: true;
  /** `opacity` is `base` times the deck's weight. */
  opacity?: { deck: CrossfadeDeck; base: number };
  /** `effectSource.vjmixRows[index].opacity` is `base` times the deck's
   *  weight, clamped to 0..1 (the VJ Mix rows of single-deck rows). */
  rows?: Array<{ index: number; deck: CrossfadeDeck; base: number }>;
};

/**
 * Each deck's weight: full A means Deck B adds nothing (its layers stay
 * resident so riding the fader never re-warms sources), full B mutes Deck A,
 * and the middle follows the fader curve. null while the crossfader is off.
 */
export function crossfadeWeights(state: CrossfaderPosition): { a: number; b: number } | null {
  if (!state.crossfaderEnabled) return null;
  const value = Math.max(0, Math.min(1, state.crossfaderValue ?? 0));
  const curve = state.crossfaderCurve || 'constant-power';
  if (curve === 'constant-power') {
    return { a: Math.cos(value * Math.PI / 2), b: Math.sin(value * Math.PI / 2) };
  }
  const shaped = applyFaderCurve(value, curve);
  return { a: 1 - shaped, b: shaped };
}

/**
 * The mix handed to the native transition shader. Every transition applies
 * its own constant-power (or equivalent) response, so 'constant-power' passes
 * the raw fader value (pre-shaping it applied the curve twice); 'linear' is
 * identity and 'sharp-cut' wants its S-curve pre-shape.
 */
export function crossfadeShapedMix(state: CrossfaderPosition): number {
  const curve = state.crossfaderCurve || 'constant-power';
  const raw = Math.max(0, Math.min(1, state.crossfaderValue ?? 0));
  return curve === 'constant-power' ? raw : applyFaderCurve(raw, curve);
}

/**
 * The part of the fader position the scene's shape depends on. Moving the
 * fader inside one step only changes values `applyCrossfadeFrame` sets.
 */
export function crossfadeSceneStep(state: CrossfaderPosition): string {
  const weights = crossfadeWeights(state);
  if (!weights) return 'off';
  return `${crossfadeShapedMix(state) < 0.5 ? 'a' : 'b'}${weights.a > 0 ? 1 : 0}${weights.b > 0 ? 1 : 0}`;
}

/** Tag a layer whose opacity is `base` times a deck's weight. */
export function withCrossfadeOpacity(layer: Layer, deck: CrossfadeDeck, base: number, weight: number): Layer {
  return { ...layer, opacity: base * weight, _xfadeFrame: { ...layer._xfadeFrame, opacity: { deck, base } } };
}

/** Tag a carrier whose `vjxfadeMix` is the fader's mix. */
export function withCrossfadeMix(layer: Layer): Layer {
  return { ...layer, _xfadeFrame: { ...layer._xfadeFrame, mix: true } };
}

/** A layer leaving the picture at opacity 0 keeps its other fader tags, not its opacity one. */
export function hiddenCrossfadeLayer(layer: Layer): Layer {
  const tag = layer._xfadeFrame;
  if (!tag?.opacity) return { ...layer, opacity: 0 };
  const { opacity: _opacity, ...rest } = tag;
  const next: Layer = { ...layer, opacity: 0 };
  if (rest.mix || rest.rows) next._xfadeFrame = rest;
  else delete next._xfadeFrame;
  return next;
}

const clamp01 = (v: number) => Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;

/**
 * The scene with the fader where it is now. Layers without a tag, and tagged
 * layers whose values are already there, come back as they are; with nothing
 * to change the same list comes back.
 */
export function applyCrossfadeFrame(layers: Layer[], state: CrossfaderPosition): Layer[] {
  const weights = crossfadeWeights(state);
  if (!weights) return layers;
  const mix = clamp01(crossfadeShapedMix(state));
  let out: Layer[] | null = null;
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i];
    const tag = layer._xfadeFrame;
    if (!tag) continue;
    let next: Layer = layer;
    if (tag.opacity) {
      const opacity = tag.opacity.base * weights[tag.opacity.deck];
      if (opacity !== next.opacity) next = { ...next, opacity };
    }
    const es = next.source?.effectSource as (Record<string, unknown> & { vjxfadeMix?: number; vjmixRows?: Array<Record<string, unknown> & { opacity?: number }> }) | undefined;
    if (es && tag.mix && es.vjxfadeMix !== mix) {
      next = { ...next, source: { ...next.source!, effectSource: { ...es, vjxfadeMix: mix } as any } };
    }
    if (es && tag.rows?.length && Array.isArray(es.vjmixRows)) {
      let rows: typeof es.vjmixRows | null = null;
      for (const row of tag.rows) {
        const current = (rows ?? es.vjmixRows)[row.index];
        if (!current) continue;
        const opacity = clamp01(row.base * weights[row.deck]);
        if (current.opacity === opacity) continue;
        rows ??= es.vjmixRows.slice();
        rows[row.index] = { ...current, opacity };
      }
      if (rows) {
        const source = next.source!;
        next = { ...next, source: { ...source, effectSource: { ...(source.effectSource as object), vjmixRows: rows } as any } };
      }
    }
    if (next !== layer) (out ??= layers.slice())[i] = next;
  }
  return out ?? layers;
}
