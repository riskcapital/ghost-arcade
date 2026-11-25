/**
 * Live edit's Discard, worked out on plain data: the project with each held
 * parameter put back to what it was before its first held change, and the
 * pieces whose content goes back. Nothing else in the project is touched,
 * so an edit made while changes were held (and not held itself) stays.
 *
 * Each held change on its own: one that cannot be put back (its piece is
 * gone, or its setting lives somewhere Discard cannot write, such as a sound
 * fader) is kept held and named, and the rest are put back. Only when none
 * can be does the plan refuse. A piece's content goes back before its
 * settings, so a setting held before the swap is put back on the content
 * it was changed on.
 */
import type { Layer, MediaSource, Project } from '../types';
import type { HeldContentEdit, HeldEdit, HeldParamEdit } from './liveEdit';
import { readLayerParam } from './lines/paramRegistry';
import { applyParamOverrides } from '../keyframes/applyParamOverrides';
import { applyLedControllerOverrides, applyLedEffectOverrides, applyStageOverrides, readStageLedParam } from './lines/stageLedParams';

type ProjectData = Pick<Project, 'layers'> & Partial<Pick<Project, 'mappingComposition' | 'wledControllers' | 'wledEffects'>>;

export type DiscardPlan<P extends ProjectData> =
  | {
    ok: true;
    /** The project with the content and settings put back. */
    project: P;
    sources: Array<{ layerId: string; source: MediaSource | null }>;
    /** The settings put back (to apply once the sources are in). */
    params: HeldParamEdit[];
    /** Held changes that cannot be put back: they stay held. */
    kept: HeldEdit[];
  }
  | { ok: false; edit: HeldEdit };

const same = (a: number | boolean | undefined, b: number | boolean): boolean => {
  if (a === undefined) return false;
  if (typeof a === 'boolean' || typeof b === 'boolean') return Boolean(a) === Boolean(b);
  return Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b));
};

/** `p` with one parameter set back to `was`, or null when it cannot be (read back to check). */
function putBack<P extends ProjectData>(p: P, edit: HeldParamEdit): P | null {
  const { target, key, was } = edit;
  if (was === undefined) return null;
  const overrides = { [key]: was };
  if (target.scope === 'layer') {
    const at = p.layers.findIndex((l) => l.id === target.id);
    if (at < 0) return null;
    const copy = { ...p.layers[at] } as Layer;
    applyParamOverrides(copy, overrides);
    if (!same(readLayerParam(copy, key), was)) return null;
    const layers = p.layers.slice();
    layers[at] = copy;
    return { ...p, layers };
  }
  if (target.scope === 'stage') {
    const comp = p.mappingComposition;
    if (!comp?.effects) return null;
    const next = { ...comp, effects: applyStageOverrides(comp.effects, overrides) as typeof comp.effects };
    if (!same(readStageLedParam(key, next, p.wledControllers, p.wledEffects), was)) return null;
    return { ...p, mappingComposition: next };
  }
  if (target.scope === 'led') {
    if (key.startsWith('led:')) {
      const controllers = (p.wledControllers ?? []).map((c) => applyLedControllerOverrides(c, overrides));
      if (!same(readStageLedParam(key, p.mappingComposition, controllers, p.wledEffects), was)) return null;
      return { ...p, wledControllers: controllers };
    }
    if (key.startsWith('ledfx:')) {
      const effects = applyLedEffectOverrides(p.wledEffects ?? [], overrides) as NonNullable<P['wledEffects']>;
      if (!same(readStageLedParam(key, p.mappingComposition, p.wledControllers, effects), was)) return null;
      return { ...p, wledEffects: effects };
    }
  }
  // Blocks, looks, sound rows and registered scopes keep their values in
  // the Timeline or their own stores: not put back from here.
  return null;
}

/** What Discard does for these held changes on `project`. */
export function planDiscard<P extends ProjectData>(project: P, edits: readonly HeldEdit[]): DiscardPlan<P> {
  let next = project;
  const sources: Array<{ layerId: string; source: MediaSource | null }> = [];
  const params: HeldParamEdit[] = [];
  const kept: HeldEdit[] = [];
  // Content first: each piece goes back to what it showed.
  for (const edit of edits) {
    if (edit.kind !== 'content') continue;
    const piece = (edit as HeldContentEdit).piece;
    // Held for a row only (nothing in the editor changed): nothing to put back.
    if (!piece) continue;
    const at = next.layers.findIndex((l) => l.id === piece.layerId);
    if (at < 0) { kept.push(edit); continue; }
    sources.push({ layerId: piece.layerId, source: piece.previous });
    const layers = next.layers.slice();
    layers[at] = { ...layers[at], source: piece.previous } as Layer;
    next = { ...next, layers };
  }
  for (const edit of edits) {
    if (edit.kind !== 'param') continue;
    const put = putBack(next, edit);
    if (!put) { kept.push(edit); continue; }
    next = put;
    params.push(edit);
  }
  const refused = kept.length > 0 && kept.length === edits.filter((e) => e.kind === 'param' || (e as HeldContentEdit).piece).length;
  if (refused) return { ok: false, edit: kept[0] };
  // Keep the original order for the bar's notice.
  kept.sort((a, b) => edits.indexOf(a) - edits.indexOf(b));
  return { ok: true, project: next, sources, params, kept };
}

/** The held settings put back on `project` (after the sources went back). */
export function putBackParams<P extends ProjectData>(project: P, edits: readonly HeldParamEdit[]): P {
  let next = project;
  for (const edit of edits) next = putBack(next, edit) ?? next;
  return next;
}
