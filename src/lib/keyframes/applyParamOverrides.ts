/**
 * Write keyframed parameter values onto a layer copy.
 *
 * One override set is a map of track key to value, the keys the keyframe
 * tray and the show's lanes both use:
 *   layer:opacity            the layer's opacity
 *   shader:<input>           a shader input value
 *   fx:<effectId>:<param>    a layer effect parameter (or `enabled`)
 *   edge:<effectId>:<path>   an edge effect field, `enabled` or a dot path
 *   splat:<path>             a field of the splat content
 *   model3d:<path>           a field of the 3D model content
 * Interactive scenes take the whole set through their own applier.
 * Transform, corners, mesh, visibility, blend, sketch, video speed, GPU and
 * whole-Look keys are described in layerParamKeys.ts.
 *
 * `target` must already be a shallow copy of the layer; it is written in
 * place. Nested objects on the way to a value are copied, never mutated, so
 * the layer store's own objects stay untouched. Identity-sensitive fields
 * (source.id, media elements) are carried by reference so decode sessions
 * and prefetch keys stay stable across frames.
 */
import type { Layer } from '../types';
import { applyInteractiveOverrides } from '../mobile/studio/interactiveEffects';
import { applyLayerExtra, extraApplyState, finishLayerExtras, isLayerExtraKey, type ExtraApplyState } from './layerParamKeys';

export type ParamOverrideSet = Record<string, number | boolean>;

/** Copy `root` and each object along `dotPath`, then set the leaf. */
export function setDotPathClone(root: Record<string, any>, dotPath: string, value: unknown): Record<string, any> {
  const parts = dotPath.split('.');
  const last = parts.pop()!;
  const clone: Record<string, any> = { ...root };
  let cursor = clone;
  let source = root;
  for (const part of parts) {
    const childClone = { ...(source?.[part] ?? {}) };
    cursor[part] = childClone;
    cursor = childClone;
    source = source?.[part];
  }
  cursor[last] = value;
  return clone;
}

export function applyParamOverrides(target: Layer, overrides: ParamOverrideSet): void {
  const next = target as any;
  if (next.source?.effectSource?.interactiveScene) {
    next.source = {
      ...next.source,
      effectSource: {
        ...next.source.effectSource,
        interactiveScene: applyInteractiveOverrides(next.source.effectSource.interactiveScene, overrides),
      },
    };
  }
  // Analog Synth's controls live flat on the effect source.
  if (next.source?.effectSource?.effectType === 'videosynth') {
    let synth: Record<string, any> | null = null;
    for (const key in overrides) {
      if (!key.startsWith('vsynth:')) continue;
      if (!synth) synth = { ...next.source.effectSource };
      synth![key.slice(7)] = overrides[key];
    }
    if (synth) next.source = { ...next.source, effectSource: synth };
  }
  let shaderValues: Record<string, any> | null = null;
  let effects: any[] | null = null;
  let extras: ExtraApplyState | null = null;
  for (const key in overrides) {
    const value = overrides[key];
    if (key === 'layer:opacity') {
      next.opacity = value as number;
    } else if (key.startsWith('shader:') && next.source?.shaderValues) {
      if (shaderValues === null) {
        shaderValues = { ...next.source.shaderValues };
        next.source = { ...next.source, shaderValues };
      }
      shaderValues![key.slice(7)] = value;
    } else if (key.startsWith('fx:') && next.effects?.length) {
      const [, fxId, prop] = key.split(':');
      if (effects === null) {
        effects = next.effects.map((e: any) => ({ ...e, params: { ...e.params } }));
        next.effects = effects;
      }
      const effect = effects!.find((e: any) => e.id === fxId);
      if (effect) {
        if (prop === 'enabled') effect.enabled = !!value;
        // The effect's mix, as the editor's own keyframe path writes it
        // (it used to land in params.opacity, which nothing reads).
        else if (prop === 'opacity') effect.opacity = value as number;
        else effect.params[prop] = value;
      }
    } else if (key.startsWith('edge:') && next.edgeEffects?.effects?.length) {
      // edge:<effectId>:<path>, path either top level (enabled, opacity)
      // or one level deep (stroke.width, fill.speed).
      const [, edgeId, path] = key.split(':');
      const edgeIndex = next.edgeEffects.effects.findIndex((e: any) => e.id === edgeId);
      if (edgeIndex >= 0 && path) {
        const edgeEffects = [...next.edgeEffects.effects];
        const edited = path === 'enabled'
          ? { ...edgeEffects[edgeIndex], enabled: !!value }
          : setDotPathClone(edgeEffects[edgeIndex], path, value);
        edgeEffects[edgeIndex] = edited as any;
        next.edgeEffects = { ...next.edgeEffects, effects: edgeEffects };
      }
    } else if (key.startsWith('splat:') && next.splatContent) {
      next.splatContent = setDotPathClone(next.splatContent, key.slice('splat:'.length), value);
    } else if (key.startsWith('model3d:') && next.model3dContent) {
      next.model3dContent = setDotPathClone(next.model3dContent, key.slice('model3d:'.length), value);
    } else if (isLayerExtraKey(key)) {
      applyLayerExtra(next, key, value, (extras ??= extraApplyState()));
    }
  }
  if (extras) finishLayerExtras(next, extras);
}
