/**
 * A mapping composition's Screen FX (or the Timeline's Screen FX row) for
 * this frame: each stage piece's brightness and tint, handed to a visitor.
 *
 * The browser render loop applies them to its per-frame layer copies; the
 * native Screen FX driver (Canvas.svelte) only records them for the frame
 * sync (stageFxFrame.ts). Working the values out without touching a layer
 * lets the native driver run every frame without copying every layer.
 */
import type { Layer, MappingCompositionState } from '../types';
import type { ScreenFxOut } from '../timeline/stagefx/stageFxEval';
import { chaseOrderIndices, evaluateStageEffectOutputForScreen } from '../stores/stageEffects';

export type StageFxTint = [number, number, number];
export type MappingStageFxVisit = (layer: Layer, brightness: number, tint: StageFxTint | null | undefined) => void;

export interface MappingStageFxDeps {
  /** The Timeline's Screen FX for a layer, when its row drives this frame
   *  (the project's own Screen FX and their automation cycle then wait). */
  timeline: ((layerId: string) => ScreenFxOut | undefined) | null;
  /** Steps the project's effect cycle (time or beat automation). */
  advance: (mappingComposition: MappingCompositionState, nowMs: number) => void;
}

/** The pieces Screen FX play over: visible, not a group container (its
 *  children are the slices), not a VJ feed, each id once. */
export function mappingStageLayers(renderLayers: readonly Layer[]): Layer[] {
  const seen = new Set<string>();
  return renderLayers.filter((layer) => {
    if (!layer.visible) return false;
    if (String(layer.type) === 'group') return false;
    if (String(layer.id).startsWith('vj-')) return false;
    if (seen.has(layer.id)) return false;
    seen.add(layer.id);
    return true;
  });
}

export function layerCentroid01(layer: Layer): { x: number; y: number } {
  const corners = layer.corners;
  if (!corners) return { x: 0.5, y: 0.5 };
  const points = [corners.topLeft, corners.topRight, corners.bottomLeft, corners.bottomRight];
  const x = points.reduce((sum, p) => sum + (p?.x ?? 0.5), 0) / points.length;
  const y = points.reduce((sum, p) => sum + (p?.y ?? 0.5), 0) / points.length;
  return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
}

export function forEachMappingStageFx(
  mappingComposition: MappingCompositionState | undefined,
  renderLayers: readonly Layer[],
  nowMs: number,
  deps: MappingStageFxDeps,
  visit: MappingStageFxVisit,
): void {
  if (deps.timeline) {
    for (const layer of mappingStageLayers(renderLayers)) {
      const out = deps.timeline(layer.id);
      if (out) visit(layer, out.brightness, out.tint);
    }
    return;
  }
  if (!mappingComposition?.enabled || mappingComposition.stageEffects.length === 0) return;
  deps.advance(mappingComposition, nowMs);
  const live = mappingComposition.stageEffects.find((effect) => effect.id === mappingComposition.activeStageEffectId);
  if (!live) return;
  const stageLayers = mappingStageLayers(renderLayers);
  const sliceCount = stageLayers.length;
  if (sliceCount === 0) return;
  const tSec = nowMs / 1000;
  // The user's clicked chase order, if any; the rest follow layer order.
  const chaseIndex = chaseOrderIndices(stageLayers.map((layer) => [layer.id]), live.order);
  for (let i = 0; i < sliceCount; i++) {
    const layer = stageLayers[i];
    const { x, y } = layerCentroid01(layer);
    const out = evaluateStageEffectOutputForScreen(`mapping-composition:${layer.id}`, live, x, 1 - y, tSec,
      { sliceIndex: chaseIndex[i], sliceCount });
    visit(layer, out.brightness, out.tint);
  }
}

/** The opacity multiplier a brightness applies (1 = untouched). */
export function stageFxMultiplier(brightness: number): number {
  const m = Math.max(0, Math.min(1, brightness));
  return m >= 0.999 ? 1 : m;
}

/** The native driver's form: the multiplier (below 1 only) and tint per
 *  piece, merged into the maps the frame sync applies. */
export function collectMappingStageFx(
  mappingComposition: MappingCompositionState | undefined,
  renderLayers: readonly Layer[],
  nowMs: number,
  deps: MappingStageFxDeps,
  opacity: Map<string, number>,
  tint: Map<string, StageFxTint>,
): void {
  forEachMappingStageFx(mappingComposition, renderLayers, nowMs, deps, (layer, brightness, color) => {
    if (color) tint.set(layer.id, color);
    const multiplier = stageFxMultiplier(brightness);
    if (multiplier < 1) opacity.set(layer.id, (opacity.get(layer.id) ?? 1) * multiplier);
  });
}
