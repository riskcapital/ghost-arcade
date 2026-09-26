/**
 * Shared map surfaces.
 *
 * A mapping preset used to carry a full copy of every layer's geometry, so a
 * projector that moved meant re-warping and re-saving every preset. Geometry
 * now lives once per project in `project.mapSurfaces`, keyed by surface id
 * (the id of the editor layer the surface was made from). Preset layers point
 * at it with `surfaceId`; only a layer the user explicitly detached (or one an
 * older project disagreed on, see migrateMapSurfaces) keeps its own copy.
 *
 * Resolution order for a shared surface, used by the MAP output and by
 * loadComposition:
 *   1. the editor layer with that id, when it is present and not detached,
 *      so a warp being dragged moves every preset on the same frame;
 *   2. the stored `project.mapSurfaces` entry;
 *   3. the preset's own copy.
 *
 * Everything here is pure: no stores, no side effects.
 */
import type { Composition, Layer, MapSurface, MapSurfaceGeometry, Project } from '../types';

export const MAP_SURFACE_GEOMETRY_KEYS = [
  'position',
  'scale',
  'rotation',
  'flipH',
  'flipV',
  'warpMode',
  'corners',
  'meshGrid',
  'mask',
  'paintMask',
  'cropRegion',
  'layerShape',
] as const satisfies ReadonlyArray<keyof MapSurfaceGeometry>;

function deepCopy<T>(value: T): T {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

/** The layer's geometry by reference. Callers that store it must copy. */
export function layerGeometryView(layer: Layer): MapSurfaceGeometry {
  return {
    position: layer.position,
    scale: layer.scale,
    rotation: layer.rotation,
    flipH: layer.flipH,
    flipV: layer.flipV,
    warpMode: layer.warpMode,
    corners: layer.corners,
    meshGrid: layer.meshGrid ?? null,
    mask: layer.mask ?? null,
    // Left out (not null) when there is none, so surfaces saved before
    // painted masks still compare equal to their layers.
    ...(layer.paintMask ? { paintMask: layer.paintMask } : {}),
    cropRegion: layer.cropRegion ?? null,
    layerShape: layer.layerShape ?? null,
  };
}

/** A detached, JSON-clean copy of the layer's geometry. */
export function layerSurfaceGeometry(layer: Layer): MapSurfaceGeometry {
  return deepCopy(layerGeometryView(layer));
}

/** Key-order independent JSON, so two geometries that went through different
 *  clone paths still compare equal. */
function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.keys(value as Record<string, unknown>)
    .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`);
  return `{${entries.join(',')}}`;
}

export function surfaceGeometryKey(geometry: MapSurfaceGeometry): string {
  return canonicalJson(geometry);
}

export function sameSurfaceGeometry(a: MapSurfaceGeometry, b: MapSurfaceGeometry): boolean {
  return surfaceGeometryKey(a) === surfaceGeometryKey(b);
}

/** Replace the layer's geometry with `geometry` (by reference). */
export function withSurfaceGeometry<T extends Layer>(layer: T, geometry: MapSurfaceGeometry): T {
  return {
    ...layer,
    position: geometry.position,
    scale: geometry.scale,
    rotation: geometry.rotation,
    flipH: geometry.flipH,
    flipV: geometry.flipV,
    warpMode: geometry.warpMode,
    corners: geometry.corners,
    meshGrid: geometry.meshGrid,
    mask: geometry.mask,
    paintMask: geometry.paintMask ?? null,
    cropRegion: geometry.cropRegion,
    layerShape: geometry.layerShape,
  };
}

/** The shared surface a layer belongs to. Editor layers ARE their surface;
 *  preset layers carry `surfaceId`. */
export function surfaceIdOf(layer: Pick<Layer, 'id' | 'surfaceId'>): string {
  return layer.surfaceId || layer.id;
}

export interface SurfaceLookup {
  /** Editor layers by id. */
  live: ReadonlyMap<string, Layer>;
  /** Stored surfaces by id. */
  stored: ReadonlyMap<string, MapSurface>;
}

export function createSurfaceLookup(liveLayers: readonly Layer[], surfaces: readonly MapSurface[] | undefined): SurfaceLookup {
  return {
    live: new Map(liveLayers.map((layer) => [layer.id, layer])),
    stored: new Map((surfaces ?? []).map((surface) => [surface.id, surface])),
  };
}

/** Current shared geometry for a surface, or null when nothing defines it. */
export function resolveSharedGeometry(surfaceId: string, lookup: SurfaceLookup): MapSurfaceGeometry | null {
  const live = lookup.live.get(surfaceId);
  if (live && !live.surfaceDetached) return layerGeometryView(live);
  return lookup.stored.get(surfaceId)?.geometry ?? null;
}

/**
 * A preset layer with the shared geometry applied. Layers without an explicit
 * `surfaceId` (never migrated) and detached layers keep their own copy, so
 * nothing moves unless it opted into the shared map.
 */
export function resolvePresetLayer<T extends Layer>(layer: T, lookup: SurfaceLookup): T {
  if (!layer.surfaceId || layer.surfaceDetached) return layer;
  const geometry = resolveSharedGeometry(layer.surfaceId, lookup);
  return geometry ? withSurfaceGeometry(layer, geometry) : layer;
}

/**
 * Write the editor's geometry into the stored surfaces it defines. Only
 * surfaces that already exist are updated; detached editor layers are left
 * out. Returns the same array when nothing changed.
 */
export function captureMapSurfaces(
  surfaces: MapSurface[] | undefined,
  layers: readonly Layer[],
): MapSurface[] | undefined {
  if (!surfaces?.length) return surfaces;
  const byId = new Map(layers.map((layer) => [layer.id, layer]));
  let changed = false;
  const next = surfaces.map((surface) => {
    const layer = byId.get(surface.id);
    if (!layer || layer.surfaceDetached) return surface;
    const geometry = layerSurfaceGeometry(layer);
    if (surface.name === layer.name && sameSurfaceGeometry(geometry, surface.geometry)) return surface;
    changed = true;
    return { ...surface, name: layer.name, geometry };
  });
  return changed ? next : surfaces;
}

/**
 * Make sure every layer of a preset being saved has a shared surface. New
 * surfaces take the layer's geometry; existing ones take it only from a
 * layer that is not detached.
 */
export function registerMapSurfaces(
  surfaces: MapSurface[] | undefined,
  layers: readonly Layer[],
): MapSurface[] {
  const next = [...(surfaces ?? [])];
  const index = new Map(next.map((surface, i) => [surface.id, i]));
  for (const layer of layers) {
    const id = surfaceIdOf(layer);
    const at = index.get(id);
    if (at === undefined) {
      index.set(id, next.length);
      next.push({ id, name: layer.name, geometry: layerSurfaceGeometry(layer) });
      continue;
    }
    if (layer.surfaceDetached) continue;
    const geometry = layerSurfaceGeometry(layer);
    if (next[at].name !== layer.name || !sameSurfaceGeometry(geometry, next[at].geometry)) {
      next[at] = { ...next[at], name: layer.name, geometry };
    }
  }
  return next;
}

/** Tag a preset snapshot's layers with the surface they came from. An editor
 *  layer is its own surface; a stale `surfaceId` copied along by a duplicate
 *  must not make two layers share one. */
export function tagPresetSurfaces(layers: Layer[]): Layer[] {
  return layers.map((layer) => ({ ...layer, surfaceId: layer.id }));
}

/**
 * Load a preset's layers for editing: shared surfaces get the current shared
 * geometry (deep-copied, the editor mutates through the store), detached ones
 * keep their own.
 */
export function presetLayersForEditing(layers: Layer[], surfaces: readonly MapSurface[] | undefined): Layer[] {
  const stored = new Map((surfaces ?? []).map((surface) => [surface.id, surface]));
  return layers.map((layer) => {
    if (!layer.surfaceId || layer.surfaceDetached) return layer;
    const surface = stored.get(layer.surfaceId);
    return surface ? withSurfaceGeometry(layer, deepCopy(surface.geometry)) : layer;
  });
}

/**
 * One-time upgrade of a project saved before shared surfaces.
 *
 * Every layer id used by a preset becomes a shared surface. Its geometry is
 * the one most presets agree on (a tie goes to the editor's own copy, then to
 * the earliest preset). A preset whose copy differs keeps it as a detached
 * override, and so does an editor layer that differs, so no preset and no
 * editor layer moves. Runs once: a project that has `mapSurfaces` (even
 * empty) is returned untouched.
 */
export function migrateMapSurfaces(project: Project): Project {
  if (Array.isArray(project.mapSurfaces)) return project;
  const compositions = project.vjMode?.compositions ?? [];
  if (!compositions.some((composition) => composition.layers?.length)) {
    return { ...project, mapSurfaces: [] };
  }

  type Variant = { key: string; geometry: MapSurfaceGeometry; count: number; first: number };
  const variants = new Map<string, Map<string, Variant>>();
  const names = new Map<string, string>();
  const order: string[] = [];
  let seen = 0;
  for (const composition of compositions) {
    for (const layer of composition.layers ?? []) {
      const id = surfaceIdOf(layer);
      const geometry = layerSurfaceGeometry(layer);
      const key = surfaceGeometryKey(geometry);
      let byKey = variants.get(id);
      if (!byKey) {
        byKey = new Map();
        variants.set(id, byKey);
        order.push(id);
      }
      const variant = byKey.get(key);
      if (variant) variant.count += 1;
      else byKey.set(key, { key, geometry, count: 1, first: seen++ });
      if (!names.has(id)) names.set(id, layer.name);
    }
  }

  const liveById = new Map(project.layers.map((layer) => [layer.id, layer]));
  const canonicalKey = new Map<string, string>();
  const surfaces: MapSurface[] = [];
  for (const id of order) {
    const live = liveById.get(id);
    const liveKey = live ? surfaceGeometryKey(layerSurfaceGeometry(live)) : null;
    const best = [...variants.get(id)!.values()].sort((a, b) =>
      b.count - a.count
      || Number(b.key === liveKey) - Number(a.key === liveKey)
      || a.first - b.first)[0];
    canonicalKey.set(id, best.key);
    surfaces.push({ id, name: live?.name ?? names.get(id) ?? 'Surface', geometry: best.geometry });
  }

  const tag = (layer: Layer): Layer => {
    const id = surfaceIdOf(layer);
    const key = canonicalKey.get(id);
    if (key === undefined) return layer;
    const differs = surfaceGeometryKey(layerSurfaceGeometry(layer)) !== key;
    const tagged: Layer = { ...layer, surfaceId: id };
    if (differs) tagged.surfaceDetached = true;
    else delete tagged.surfaceDetached;
    return tagged;
  };

  const migratedCompositions: Composition[] = compositions.map((composition) => ({
    ...composition,
    layers: (composition.layers ?? []).map(tag),
  }));
  const layers = project.layers.map((layer) => {
    const key = canonicalKey.get(layer.id);
    if (key === undefined) return layer;
    return surfaceGeometryKey(layerSurfaceGeometry(layer)) === key ? layer : { ...layer, surfaceDetached: true };
  });

  return {
    ...project,
    layers,
    mapSurfaces: surfaces,
    vjMode: project.vjMode ? { ...project.vjMode, compositions: migratedCompositions } : project.vjMode,
  };
}
