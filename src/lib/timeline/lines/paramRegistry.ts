/**
 * One parameter registry for the Timeline: every control a line can drive,
 * addressed as (target, key).
 *
 *   target { scope: 'layer', id }  a mapping layer (piece); keys are the
 *                                  layer-relative override keys
 *                                  (keyframes/applyParamOverrides.ts,
 *                                  keyframes/layerParamKeys.ts)
 *   target { scope: 'stage' }      Stage FX (stage:fx:…)
 *   target { scope: 'led' }        WLED controllers and LED effects (led:…, ledfx:…)
 *
 * Every entry carries key, label, group, range, step, default and kind
 * (continuous / stepped / bool / colour).
 */
import type { Layer, MappingCompositionState, WLEDController, WLEDEffect } from '../../types';
import { discoverKeyframeableParams, paramKind, type KeyframeableParam } from '../../keyframes/paramDiscovery';
import { isLayerExtraKey, readLayerExtra, type ParamKind } from '../../keyframes/layerParamKeys';
import { discoverLedParams, discoverStageParams, readStageLedParam } from './stageLedParams';

export type { ParamKind } from '../../keyframes/layerParamKeys';

export type ParamTarget =
  | { scope: 'layer'; id: string }
  | { scope: 'stage' }
  | { scope: 'led' };

export interface ParamEntry {
  key: string;
  label: string;
  group: string;
  min: number;
  max: number;
  step: number;
  default: number | boolean;
  kind: ParamKind;
}

/** What the registry reads: the project's stage, Stage FX and LED rig. */
export interface RegistrySource {
  layers: readonly Layer[];
  mappingComposition?: MappingCompositionState | null;
  wledControllers?: readonly WLEDController[];
  wledEffects?: readonly WLEDEffect[];
}

export function targetId(target: ParamTarget): string {
  return target.scope === 'layer' ? `layer:${target.id}` : target.scope;
}

export function toEntry(p: KeyframeableParam): ParamEntry {
  const kind = paramKind(p);
  const isBool = kind === 'bool';
  return {
    key: p.key,
    label: p.label,
    group: p.group,
    min: isBool ? 0 : Number.isFinite(p.min) ? (p.min as number) : 0,
    max: isBool ? 1 : Number.isFinite(p.max) ? (p.max as number) : 1,
    step: isBool ? 1 : Number.isFinite(p.step) && (p.step as number) > 0 ? (p.step as number) : kind === 'stepped' ? 1 : 0.01,
    default: p.defaultValue,
    kind,
  };
}

export function layerParams(layer: Layer): ParamEntry[] {
  return discoverKeyframeableParams(layer).map(toEntry);
}

export function stageParams(source: Pick<RegistrySource, 'mappingComposition'>): ParamEntry[] {
  return discoverStageParams(source.mappingComposition).map(toEntry);
}

export function ledParams(source: Pick<RegistrySource, 'wledControllers' | 'wledEffects'>): ParamEntry[] {
  return discoverLedParams(source.wledControllers, source.wledEffects).map(toEntry);
}

export function paramsFor(source: RegistrySource, target: ParamTarget): ParamEntry[] {
  if (target.scope === 'stage') return stageParams(source);
  if (target.scope === 'led') return ledParams(source);
  const layer = source.layers.find((l) => l.id === target.id);
  return layer ? layerParams(layer) : [];
}

export function findParam(source: RegistrySource, target: ParamTarget, key: string): ParamEntry | null {
  return paramsFor(source, target).find((p) => p.key === key) ?? null;
}

function readDot(obj: any, path: string): unknown {
  let cur = obj;
  for (const part of path.split('.')) {
    if (cur == null) return undefined;
    cur = cur[part];
  }
  return cur;
}

/** A layer's own (stored) value for `key`. */
export function readLayerParam(layer: Layer, key: string): number | boolean | undefined {
  const l = layer as any;
  let v: unknown;
  if (key === 'layer:opacity') v = l.opacity ?? 1;
  else if (isLayerExtraKey(key)) v = readLayerExtra(layer, key);
  else if (key.startsWith('shader:')) v = l.source?.shaderValues?.[key.slice(7)];
  else if (key.startsWith('fx:')) {
    const [, id, prop] = key.split(':');
    const e = l.effects?.find((x: any) => x.id === id);
    v = !e ? undefined : prop === 'enabled' ? e.enabled : prop === 'opacity' ? e.opacity ?? 1 : e.params?.[prop];
  } else if (key.startsWith('edge:')) {
    const [, id, path] = key.split(':');
    const e = l.edgeEffects?.effects?.find((x: any) => x.id === id);
    v = e && path ? readDot(e, path) : undefined;
  } else if (key.startsWith('splat:')) v = readDot(l.splatContent, key.slice(6));
  else if (key.startsWith('model3d:')) v = readDot(l.model3dContent, key.slice(8));
  return typeof v === 'number' || typeof v === 'boolean' ? v : undefined;
}

/** The project's own value for (target, key). */
export function readParam(source: RegistrySource, target: ParamTarget, key: string): number | boolean | undefined {
  if (target.scope === 'layer') {
    const layer = source.layers.find((l) => l.id === target.id);
    return layer ? readLayerParam(layer, key) : undefined;
  }
  return readStageLedParam(key, source.mappingComposition, source.wledControllers, source.wledEffects);
}
