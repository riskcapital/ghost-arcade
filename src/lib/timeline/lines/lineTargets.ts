/**
 * Which of a line frame's values a scene layer takes. Pure; the native sync
 * calls these for every layer it sends (applyTimelineOverrides).
 *
 *   - a piece's lines (`layers` by piece id) apply to the piece, and to the
 *     Timeline's own copy of it when it is off the stage (`showtrack::<id>`)
 *     or the other side of a preset dissolve (`showfade::<id>`)
 *   - an added layer (sub-row) has lines of its own, by its copy's id
 *     (`showsub::<pieceId>::<trackId>`)
 *   - a block's lines (`blocks` by clip id) apply to whichever layer shows
 *     that block right now (the scene tags it `_showClipId`), so they only
 *     act while the block plays
 *   - a look block's lines (`looks` by clip id) apply to that block's own
 *     effects on every shape wearing it (effect ids `showlook:<clipId>:…`)
 */
import type { Layer } from '../../types';
import type { LineFrame, OverrideRecord } from './lineEvaluator';

const COPY_PREFIXES = ['showtrack::', 'showfade::'];

/** The piece-level line values for a scene layer id. */
export function lineLayerValues(frame: LineFrame | null, layerId: string): OverrideRecord | undefined {
  const layers = frame?.layers;
  if (!layers?.size) return undefined;
  const own = layers.get(layerId);
  if (own) return own;
  for (const prefix of COPY_PREFIXES) {
    if (layerId.startsWith(prefix)) return layers.get(layerId.slice(prefix.length));
  }
  return undefined;
}

/** The block-level line values for a scene layer (the block it shows). */
export function lineBlockValues(frame: LineFrame | null, layer: Pick<Layer, '_showClipId'>): OverrideRecord | undefined {
  const id = layer._showClipId;
  return id && frame?.blocks?.size ? frame.blocks.get(id) : undefined;
}

const LOOK_EFFECT_PREFIX = 'showlook:';

function lookClipOf(effectId: string): string | null {
  if (!effectId.startsWith(LOOK_EFFECT_PREFIX)) return null;
  const rest = effectId.slice(LOOK_EFFECT_PREFIX.length);
  const cut = rest.indexOf(':');
  return cut > 0 ? rest.slice(0, cut) : null;
}

/** The layer wears a look block that has lines. */
export function wearsLookWithLines(frame: LineFrame | null, layer: Pick<Layer, 'edgeEffects'>): boolean {
  const looks = frame?.looks;
  if (!looks?.size) return false;
  const effects = layer.edgeEffects?.effects;
  if (!effects?.length) return false;
  for (const e of effects) {
    const clip = lookClipOf(e.id);
    if (clip && looks.has(clip)) return true;
  }
  return false;
}

interface LookBase {
  opacity: number;
  fill?: number;
  stroke?: number;
  animation?: number;
}

const num = (v: number | boolean) => (typeof v === 'boolean' ? (v ? 1 : 0) : Number(v));

/**
 * Apply look-block lines to `next` (a copy of a scene layer; its
 * edgeEffects are replaced, never mutated). Values are taken against each
 * effect's own (pre-line) values, kept on the copy, so a list that comes
 * through twice does not scale twice.
 */
export function applyLookLines(next: Layer, frame: LineFrame | null): boolean {
  const looks = frame?.looks;
  const edge = next.edgeEffects;
  if (!looks?.size || !edge?.effects?.length) return false;
  let changed = false;
  const effects = edge.effects.map((effect) => {
    const clip = lookClipOf(effect.id);
    const rec = clip ? looks.get(clip) : undefined;
    if (!rec || !Object.keys(rec).length) return effect;
    changed = true;
    const e: any = { ...effect };
    const base: LookBase = e._lineBase ?? {
      opacity: Number(e.opacity ?? 1),
      fill: typeof e.fill?.speed === 'number' ? e.fill.speed : undefined,
      stroke: typeof e.stroke?.speed === 'number' ? e.stroke.speed : undefined,
      animation: typeof e.animation?.speed === 'number' ? e.animation.speed : undefined,
    };
    e._lineBase = base;
    for (const key in rec) {
      const v = num(rec[key]);
      switch (key) {
        case 'look:intensity':
          e.opacity = base.opacity * Math.max(0, v);
          break;
        case 'look:speed':
          if (base.fill !== undefined) e.fill = { ...e.fill, speed: base.fill * Math.max(0, v) };
          if (base.stroke !== undefined) e.stroke = { ...e.stroke, speed: base.stroke * Math.max(0, v) };
          if (base.animation !== undefined) e.animation = { ...e.animation, speed: base.animation * Math.max(0, v) };
          break;
        case 'look:react':
          if (e.react) e.react = { ...e.react, amount: Math.max(0, Math.min(1, v)) };
          break;
        case 'look:hue':
          if (e.react) e.react = { ...e.react, hueStep: v };
          break;
        case 'look:chase':
          if (e.chaseMode && e.chaseMode !== 'none') e.chaseSpread = Math.max(0, v);
          break;
      }
    }
    return e;
  });
  if (changed) next.edgeEffects = { ...edge, effects };
  return changed;
}
