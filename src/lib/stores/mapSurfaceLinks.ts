/**
 * Link to existing surface.
 *
 * Presets made from one map share its surfaces by id. A layer deleted and
 * made again, or pasted into other presets, is a new layer with a surface of
 * its own, so its warp stops reaching the other presets. This links chosen
 * layers of chosen presets back to one existing surface, or adds the layer to
 * a preset that lacks it.
 *
 * Nothing is matched for the user: every destination layer is picked by
 * hand, never inferred from a name or a position. A choice that would lose
 * something (a detached warp, a surface other presets still use) or that
 * cannot work (the layer is gone, the preset already has a layer on the
 * surface) is reported by planSurfaceLink and must be settled before
 * applySurfaceLink changes anything.
 *
 * A linked layer keeps its own id, so its media, effects, routing and every
 * per-preset reference to it stay as they are; only `surfaceId` (with the
 * `surfaceLinkFor` that makes it a link) and the geometry change.
 *
 * Pure: no stores, no side effects.
 */
import type { Composition, Layer, MapSurface, MapSurfaceGeometry, Project } from '../types';
import {
  captureMapSurfaces,
  createSurfaceLookup,
  resolveSharedGeometry,
  surfaceIdOf,
  withSurfaceGeometry,
  withSurfaceRef,
} from './mapSurfaces';

/** What joins the surface in one preset. */
export type SurfaceLinkTarget =
  /** A layer the preset already has. `warp` settles a detached layer:
   *  'shared' drops its own warp, 'own' keeps it as an override. `moveOff`
   *  confirms moving a layer whose current surface other presets still use
   *  (they stay on it). */
  | { kind: 'layer'; layerId: string; warp?: 'shared' | 'own'; moveOff?: boolean }
  /** A copy of the surface's layer, added to the preset. */
  | { kind: 'add' };

export interface SurfaceLinkDestination {
  compositionId: string;
  /** Null until the user has chosen. */
  target: SurfaceLinkTarget | null;
}

export interface SurfaceLinkRequest {
  surfaceId: string;
  destinations: readonly SurfaceLinkDestination[];
}

export type SurfaceLinkIssue =
  | { kind: 'no-source' }
  | { kind: 'preset-missing' }
  | { kind: 'no-choice' }
  | { kind: 'layer-missing'; layerId: string }
  | { kind: 'group-layer'; layerName: string }
  | { kind: 'already-on-surface'; layerName: string }
  | { kind: 'detached'; resolved: boolean }
  | { kind: 'shared-elsewhere'; surfaceName: string; presetNames: string[]; resolved: boolean }
  | { kind: 'no-template' };

export interface SurfaceLinkPlanRow {
  compositionId: string;
  presetName: string;
  action: 'relink' | 'add' | 'none';
  /** The destination layer (the copy to add, for 'add'). */
  layerName: string | null;
  /** The surface the layer leaves, for 'relink'. */
  fromSurfaceName: string | null;
  /** How the layer's warp ends up. */
  warp: 'shared' | 'own';
  issues: SurfaceLinkIssue[];
  /** True while an issue stops this row from being applied. */
  blocked: boolean;
}

export interface SurfaceLinkPlan {
  surfaceId: string;
  surfaceName: string;
  rows: SurfaceLinkPlanRow[];
  /** Every row can be applied and at least one changes something. */
  ready: boolean;
}

export interface LinkableSurface {
  id: string;
  name: string;
  /** Presets with a layer on the surface, in preset order. */
  presetIds: string[];
  /** The editor shows a layer on it. */
  inEditor: boolean;
}

/** How one preset stands towards a surface. */
export type PresetSurfaceState =
  | { kind: 'on'; layerId: string; layerName: string; detached: boolean }
  | { kind: 'off' };

export interface LinkCandidateLayer {
  id: string;
  name: string;
  surfaceId: string;
  surfaceName: string;
  detached: boolean;
  /** Other presets on the layer's current surface. */
  sharedWith: string[];
}

const BLOCKING: ReadonlySet<SurfaceLinkIssue['kind']> = new Set([
  'no-source', 'preset-missing', 'no-choice', 'layer-missing', 'group-layer', 'already-on-surface', 'no-template',
]);

export function isBlockingIssue(issue: SurfaceLinkIssue): boolean {
  if (issue.kind === 'detached' || issue.kind === 'shared-elsewhere') return !issue.resolved;
  return BLOCKING.has(issue.kind);
}

function compositionsOf(project: Pick<Project, 'vjMode'>): Composition[] {
  return project.vjMode?.compositions ?? [];
}

const linkable = (layer: Layer) => layer.type !== 'group';

/** Surfaces a layer can be linked to: those of the shared map that some
 *  preset or the editor draws a (non-group) layer on, in map order. */
export function linkableSurfaces(project: Pick<Project, 'layers' | 'mapSurfaces' | 'vjMode'>): LinkableSurface[] {
  const presets = new Map<string, string[]>();
  for (const composition of compositionsOf(project)) {
    const seen = new Set<string>();
    for (const layer of composition.layers ?? []) {
      if (!linkable(layer)) continue;
      const id = surfaceIdOf(layer);
      if (seen.has(id)) continue;
      seen.add(id);
      const list = presets.get(id) ?? [];
      list.push(composition.id);
      presets.set(id, list);
    }
  }
  const editor = new Set(project.layers.filter(linkable).map(surfaceIdOf));
  return (project.mapSurfaces ?? [])
    .filter((surface) => presets.has(surface.id) || editor.has(surface.id))
    .map((surface) => ({
      id: surface.id,
      name: surface.name,
      presetIds: presets.get(surface.id) ?? [],
      inEditor: editor.has(surface.id),
    }));
}

export function presetSurfaceState(composition: Composition, surfaceId: string): PresetSurfaceState {
  const layer = (composition.layers ?? []).find((l) => linkable(l) && surfaceIdOf(l) === surfaceId);
  return layer
    ? { kind: 'on', layerId: layer.id, layerName: layer.name, detached: !!layer.surfaceDetached }
    : { kind: 'off' };
}

function surfaceName(project: Pick<Project, 'mapSurfaces'>, id: string, fallback: string): string {
  return project.mapSurfaces?.find((surface) => surface.id === id)?.name ?? fallback;
}

/** Presets other than those in `except` with a layer on `surfaceId`. */
function presetsOnSurface(project: Pick<Project, 'vjMode'>, surfaceId: string, except: ReadonlySet<string>): Composition[] {
  return compositionsOf(project).filter((composition) =>
    !except.has(composition.id) && (composition.layers ?? []).some((l) => surfaceIdOf(l) === surfaceId));
}

/** The layers of a preset that can be linked to `surfaceId`, top first. */
export function linkCandidates(
  project: Pick<Project, 'vjMode' | 'mapSurfaces'>,
  compositionId: string,
  surfaceId: string,
): LinkCandidateLayer[] {
  const composition = compositionsOf(project).find((c) => c.id === compositionId);
  if (!composition) return [];
  return (composition.layers ?? [])
    .filter((layer) => linkable(layer) && surfaceIdOf(layer) !== surfaceId)
    .map((layer) => {
      const own = surfaceIdOf(layer);
      return {
        id: layer.id,
        name: layer.name,
        surfaceId: own,
        surfaceName: surfaceName(project, own, layer.name),
        detached: !!layer.surfaceDetached,
        sharedWith: presetsOnSurface(project, own, new Set([compositionId])).map((c) => c.name),
      };
    });
}

/** The layer a preset gets when the surface's layer is added to it: the
 *  editor's (when it is on the surface and not detached), else the first
 *  preset layer on it, preferring one that follows the shared warp. */
function templateFor(project: Pick<Project, 'layers' | 'vjMode'>, surfaceId: string): { layer: Layer; index: number } | null {
  const pick = (layers: readonly Layer[], attachedOnly: boolean) => {
    const index = layers.findIndex((l) => linkable(l) && surfaceIdOf(l) === surfaceId && (!attachedOnly || !l.surfaceDetached));
    return index >= 0 ? { layer: layers[index], index } : null;
  };
  const presets = compositionsOf(project);
  return pick(project.layers, true)
    ?? presets.reduce<{ layer: Layer; index: number } | null>((found, c) => found ?? pick(c.layers ?? [], true), null)
    ?? pick(project.layers, false)
    ?? presets.reduce<{ layer: Layer; index: number } | null>((found, c) => found ?? pick(c.layers ?? [], false), null);
}

export function planSurfaceLink(project: Project, request: SurfaceLinkRequest): SurfaceLinkPlan {
  const surface = project.mapSurfaces?.find((s) => s.id === request.surfaceId);
  const name = surface?.name ?? 'Surface';
  const byId = new Map(compositionsOf(project).map((c) => [c.id, c]));
  // Presets whose chosen layer moves off the same surface are not "left
  // behind" on it: they move too.
  const moving = new Map<string, Set<string>>();
  for (const { compositionId, target } of request.destinations) {
    if (target?.kind !== 'layer') continue;
    const layer = byId.get(compositionId)?.layers.find((l) => l.id === target.layerId);
    if (!layer) continue;
    const from = surfaceIdOf(layer);
    const set = moving.get(from) ?? new Set<string>();
    set.add(compositionId);
    moving.set(from, set);
  }
  const template = surface ? templateFor(project, request.surfaceId) : null;

  const rows = request.destinations.map(({ compositionId, target }): SurfaceLinkPlanRow => {
    const composition = byId.get(compositionId);
    const row: SurfaceLinkPlanRow = {
      compositionId,
      presetName: composition?.name ?? 'Preset',
      action: 'none',
      layerName: null,
      fromSurfaceName: null,
      warp: 'shared',
      issues: [],
      blocked: false,
    };
    const finish = () => ({ ...row, blocked: row.issues.some(isBlockingIssue) });
    if (!surface) { row.issues.push({ kind: 'no-source' }); return finish(); }
    if (!composition) { row.issues.push({ kind: 'preset-missing' }); return finish(); }
    const state = presetSurfaceState(composition, request.surfaceId);
    if (state.kind === 'on') {
      row.layerName = state.layerName;
      // Already there: nothing to do, and nothing else may join it.
      if (target) row.issues.push({ kind: 'already-on-surface', layerName: state.layerName });
      return finish();
    }
    if (!target) { row.issues.push({ kind: 'no-choice' }); return finish(); }
    if (target.kind === 'add') {
      row.action = 'add';
      row.layerName = template?.layer.name ?? null;
      if (!template) row.issues.push({ kind: 'no-template' });
      return finish();
    }
    row.action = 'relink';
    const layer = composition.layers.find((l) => l.id === target.layerId);
    if (!layer) { row.issues.push({ kind: 'layer-missing', layerId: target.layerId }); return finish(); }
    row.layerName = layer.name;
    if (!linkable(layer)) { row.issues.push({ kind: 'group-layer', layerName: layer.name }); return finish(); }
    const from = surfaceIdOf(layer);
    row.fromSurfaceName = surfaceName(project, from, layer.name);
    if (layer.surfaceDetached) {
      row.issues.push({ kind: 'detached', resolved: target.warp === 'shared' || target.warp === 'own' });
      row.warp = target.warp === 'own' ? 'own' : 'shared';
    }
    const left = presetsOnSurface(project, from, moving.get(from) ?? new Set([compositionId]));
    if (left.length) {
      row.issues.push({
        kind: 'shared-elsewhere',
        surfaceName: row.fromSurfaceName,
        presetNames: left.map((c) => c.name),
        resolved: target.moveOff === true,
      });
    }
    return finish();
  });

  return {
    surfaceId: request.surfaceId,
    surfaceName: name,
    rows,
    ready: rows.length > 0 && rows.every((row) => !row.blocked) && rows.some((row) => row.action !== 'none'),
  };
}

function deepCopy<T>(value: T): T {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

/** A JSON-clean copy for a preset: runtime handles go, AssetRefs stay (the
 *  same rule as saving a preset). */
function presetCopy(layer: Layer): Layer {
  return JSON.parse(JSON.stringify(layer, (key, value) => {
    if (key === 'texture' || key === 'videoElement' || key === 'renderTarget' || key === 'iframeElement' || key === 'synthVisionCanvas') return undefined;
    if (value && typeof value === 'object' && value.constructor?.name?.startsWith('_')) return undefined;
    return value;
  }));
}

function relinked(layer: Layer, surfaceId: string, warp: 'shared' | 'own', geometry: MapSurfaceGeometry | null): Layer {
  const next = withSurfaceRef(layer, surfaceId);
  if (warp === 'own') return { ...next, surfaceDetached: true };
  delete next.surfaceDetached;
  return geometry ? withSurfaceGeometry(next, deepCopy(geometry)) : next;
}

export type SurfaceLinkResult =
  | { ok: true; project: Project; plan: SurfaceLinkPlan; changed: number; addedEditorLayerIds: string[] }
  | { ok: false; plan: SurfaceLinkPlan };

/**
 * Apply a link. Re-plans first and changes nothing unless every row is
 * settled. The preset the editor shows (`activeCompositionId`) gets the same
 * change in the editor, so updating that preset later keeps the link.
 */
export function applySurfaceLink(project: Project, request: SurfaceLinkRequest, newId: () => string): SurfaceLinkResult {
  // The warp being edited right now is the shared one.
  const captured = captureMapSurfaces(project.mapSurfaces, project.layers) ?? project.mapSurfaces;
  const base: Project = captured === project.mapSurfaces ? project : { ...project, mapSurfaces: captured };
  const plan = planSurfaceLink(base, request);
  if (!plan.ready) return { ok: false, plan };

  const surfaceId = request.surfaceId;
  const geometry = resolveSharedGeometry(surfaceId, createSurfaceLookup(base.layers, base.mapSurfaces as MapSurface[] | undefined));
  const template = templateFor(base, surfaceId);
  const targets = new Map(request.destinations.map((d) => [d.compositionId, d.target]));
  const activeId = base.vjMode?.activeCompositionId ?? null;
  let editorLayers = base.layers;
  const addedEditorLayerIds: string[] = [];
  let changed = 0;

  const compositions = compositionsOf(base).map((composition) => {
    const row = plan.rows.find((r) => r.compositionId === composition.id);
    const target = targets.get(composition.id);
    if (!row || row.action === 'none' || !target) return composition;
    changed += 1;
    const mirror = composition.id === activeId;
    if (target.kind === 'layer') {
      const warp = row.warp;
      if (mirror) {
        editorLayers = editorLayers.map((l) => (l.id === target.layerId ? relinked(l, surfaceId, warp, geometry) : l));
      }
      return {
        ...composition,
        layers: composition.layers.map((l) => (l.id === target.layerId ? relinked(l, surfaceId, warp, geometry) : l)),
      };
    }
    // Add: the surface's layer, under its own id where the preset has no
    // layer by that id, so show tracks that drive it reach it here too.
    const source = template!.layer;
    const taken = new Set(composition.layers.map((l) => l.id));
    const id = taken.has(source.id) ? newId() : source.id;
    const groups = new Set(composition.layers.filter((l) => l.type === 'group').map((l) => l.id));
    let added = relinked({ ...presetCopy(source), id }, surfaceId, 'shared', geometry);
    if (added.parentGroupId && !groups.has(added.parentGroupId)) added = { ...added, parentGroupId: null };
    const at = Math.min(template!.index, composition.layers.length);
    if (mirror && !editorLayers.some((l) => l.id === id)) {
      const editorCopy = deepCopy(added);
      if (editorCopy.parentGroupId && !editorLayers.some((l) => l.id === editorCopy.parentGroupId && l.type === 'group')) {
        editorCopy.parentGroupId = null;
      }
      editorLayers = [...editorLayers.slice(0, Math.min(at, editorLayers.length)), editorCopy, ...editorLayers.slice(Math.min(at, editorLayers.length))];
      addedEditorLayerIds.push(id);
    }
    return { ...composition, layers: [...composition.layers.slice(0, at), added, ...composition.layers.slice(at)] };
  });

  return {
    ok: true,
    plan,
    changed,
    addedEditorLayerIds,
    project: {
      ...base,
      layers: editorLayers,
      vjMode: base.vjMode ? { ...base.vjMode, compositions } : base.vjMode,
    },
  };
}
