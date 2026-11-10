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
 *   target { scope: 'block', id }  a Timeline block (clip id): its media's own
 *                                  values (shader:, sketch:, video:rate), only
 *                                  while that block plays
 *   target { scope: 'look', id }   a look block on the Looks row (clip id):
 *                                  look:intensity / react / hue / chase / speed
 *
 * A layer target may also be one of the Timeline's copies of a piece: an
 * added layer (sub-row) `showsub::<pieceId>::<trackId>`; its parameters are
 * the piece's.
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
  | { scope: 'led' }
  | { scope: 'block'; id: string }
  | { scope: 'look'; id: string }
  /** A Timeline sound row (row id): its level and Music Studio effects. */
  | { scope: 'sound'; id: string };

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
  /** A Timeline block as a layer: the piece with the block's media as its
   *  source (for a block target's parameters). */
  blockLayer?: (clipId: string) => Layer | null;
  /** A piece's layer when it is not on the stage (its row's own copy). */
  pieceLayer?: (layerId: string) => Layer | null;
  /** A look block exists. */
  hasLookBlock?: (clipId: string) => boolean;
  /** A Timeline sound row's parameters, and its stored value for one. */
  soundParams?: (rowId: string) => ParamEntry[];
  readSound?: (rowId: string, key: string) => number | undefined;
}

export function targetId(target: ParamTarget): string {
  switch (target.scope) {
    case 'layer': return `layer:${target.id}`;
    case 'block': return `block:${target.id}`;
    case 'look': return `look:${target.id}`;
    case 'sound': return `sound:${target.id}`;
    default: return target.scope;
  }
}

export function sameTarget(a: ParamTarget, b: ParamTarget): boolean {
  return targetId(a) === targetId(b);
}

const SUB_PREFIX = 'showsub::';
/** The piece of a sub-row copy id (`showsub::<pieceId>::<trackId>`), else null. */
export function subRowPieceId(id: string): string | null {
  if (!id.startsWith(SUB_PREFIX)) return null;
  const rest = id.slice(SUB_PREFIX.length);
  const cut = rest.lastIndexOf('::');
  return cut > 0 ? rest.slice(0, cut) : null;
}

/** The parameters of a look block. Each applies to that block's effects only. */
export function lookBlockParams(): ParamEntry[] {
  const group = 'Look block';
  return [
    { key: 'look:intensity', label: 'Look intensity', group, min: 0, max: 2, step: 0.01, default: 1, kind: 'continuous' },
    { key: 'look:speed', label: 'Look speed', group, min: 0, max: 4, step: 0.01, default: 1, kind: 'continuous' },
    { key: 'look:hue', label: 'Colour step per beat', group, min: 0, max: 1, step: 0.01, default: 0, kind: 'continuous' },
    { key: 'look:react', label: 'Beat reaction', group, min: 0, max: 1, step: 0.01, default: 0, kind: 'continuous' },
    { key: 'look:chase', label: 'Chase delay', group, min: 0, max: 4, step: 0.05, default: 0.5, kind: 'continuous' },
  ];
}

/** Keys a block target offers: the block's media, not the piece around it. */
export function isBlockKey(key: string): boolean {
  return key.startsWith('shader:') || key.startsWith('sketch:') || key === 'video:rate';
}

function layerFor(source: RegistrySource, id: string): Layer | null {
  const direct = source.layers.find((l) => l.id === id);
  if (direct) return direct;
  const piece = subRowPieceId(id) ?? id;
  return source.layers.find((l) => l.id === piece) ?? source.pieceLayer?.(piece) ?? null;
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
  if (target.scope === 'look') return source.hasLookBlock && !source.hasLookBlock(target.id) ? [] : lookBlockParams();
  if (target.scope === 'sound') return source.soundParams?.(target.id) ?? [];
  if (target.scope === 'block') {
    const layer = source.blockLayer?.(target.id);
    return layer ? layerParams(layer).filter((p) => isBlockKey(p.key)) : [];
  }
  const layer = layerFor(source, target.id);
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
    const layer = layerFor(source, target.id);
    return layer ? readLayerParam(layer, key) : undefined;
  }
  if (target.scope === 'block') {
    const layer = source.blockLayer?.(target.id);
    return layer ? readLayerParam(layer, key) : undefined;
  }
  if (target.scope === 'look') {
    const p = lookBlockParams().find((x) => x.key === key);
    return p ? (p.default as number) : undefined;
  }
  if (target.scope === 'sound') return source.readSound?.(target.id, key);
  return readStageLedParam(key, source.mappingComposition, source.wledControllers, source.wledEffects);
}
