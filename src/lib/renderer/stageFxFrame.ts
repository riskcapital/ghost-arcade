/**
 * Screen FX on the native scene as per-frame values.
 *
 * While Screen FX run (the project's own, the Timeline's Screen FX row, or a
 * mapping composition's stage effects) each bound piece's opacity is
 * multiplied by the effect's brightness for this frame, and a colour chase
 * tints it. Canvas.svelte's Screen FX driver works out those values once per
 * animation frame; the frame sync puts them on the scene it sends
 * (`applyStageFxFrame`). They never go into the scene build, so a running
 * effect does not rebuild and hand over the whole scene every frame.
 */
import type { Layer } from '../types';
import type { ScreenFxOut } from '../timeline/stagefx/stageFxEval';

export interface StageFxFrameValues {
  /** Layer id → opacity multiplier (only entries below 1). */
  opacity: ReadonlyMap<string, number>;
  /** Layer id → colour chase tint. */
  tint: ReadonlyMap<string, [number, number, number]>;
  /** The Timeline's Screen FX for a scene layer the maps do not name (a
   *  Timeline copy of a piece follows the piece), when that row drives. */
  fallback?: ((layerId: string) => ScreenFxOut | undefined) | null;
}

export const NO_STAGE_FX: StageFxFrameValues = { opacity: new Map(), tint: new Map(), fallback: null };

/** Whether `values` changes anything at all. */
export function stageFxFrameActive(values: StageFxFrameValues): boolean {
  return values.opacity.size > 0 || values.tint.size > 0 || !!values.fallback;
}

/**
 * The scene with this frame's Screen FX on it. Layers no effect touches come
 * back as they are; nothing to apply, the same list.
 */
export function applyStageFxFrame(list: Layer[], values: StageFxFrameValues): Layer[] {
  if (!stageFxFrameActive(values)) return list;
  let out: Layer[] | null = null;
  for (let i = 0; i < list.length; i++) {
    const layer = list[i];
    let multiplier = values.opacity.get(layer.id);
    let tint = values.tint.get(layer.id);
    if (multiplier === undefined && !tint && values.fallback) {
      const fx = values.fallback(layer.id);
      if (fx) {
        if (fx.brightness < 1) multiplier = Math.max(0, fx.brightness);
        if (fx.tint) tint = fx.tint;
      }
    }
    if (multiplier === undefined && !tint) continue;
    const next = multiplier === undefined ? { ...layer } : { ...layer, opacity: layer.opacity * multiplier };
    if (tint) next._stageTint = tint;
    (out ??= list.slice())[i] = next;
  }
  return out ?? list;
}
