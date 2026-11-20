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

const q = (v: number) => Math.round(v * 2048);

function sameOpacity(a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>): boolean {
  if (a.size !== b.size) return false;
  for (const [id, v] of a) {
    const w = b.get(id);
    if (w === undefined || q(v) !== q(w)) return false;
  }
  return true;
}

function sameTint(a: ReadonlyMap<string, [number, number, number]>, b: ReadonlyMap<string, [number, number, number]>): boolean {
  if (a.size !== b.size) return false;
  for (const [id, v] of a) {
    const w = b.get(id);
    if (!w || q(v[0]) !== q(w[0]) || q(v[1]) !== q(w[1]) || q(v[2]) !== q(w[2])) return false;
  }
  return true;
}

/**
 * The Screen FX driver's last published values. `offer` says whether this
 * frame's values differ from them (and keeps them when they do), so an idle
 * frame (a Timeline Screen FX row with no block under the playhead, a paused
 * show, a held colour) asks the core for nothing.
 */
export class StageFxFrameGate {
  private opacity: ReadonlyMap<string, number> = new Map();
  private tint: ReadonlyMap<string, [number, number, number]> = new Map();
  private follows = false;
  private primed = false;

  offer(opacity: ReadonlyMap<string, number>, tint: ReadonlyMap<string, [number, number, number]>, followsTimeline: boolean): boolean {
    if (this.primed && this.follows === followsTimeline && sameOpacity(this.opacity, opacity) && sameTint(this.tint, tint)) return false;
    this.primed = true;
    this.opacity = opacity;
    this.tint = tint;
    this.follows = followsTimeline;
    return true;
  }

  /** Forget the last values (the next offer publishes). */
  reset(): void {
    this.primed = false;
  }
}
