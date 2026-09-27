/**
 * VJ MAP sub-mode: the preset stack for the output.
 *
 * Each VJ row holding a preset clip renders as a synthetic group wrapping the
 * preset's layers. Native layer ids are keyed by ROW and SURFACE, not by clip:
 *   group  `mapvj-<row>`
 *   child  `mapvj-<row>::<surfaceId>`
 * so switching a row from one preset to another keeps the id of every surface
 * both presets use. The native sync then sees an ordinary layer update instead
 * of a remove + upsert, and a video on that surface keeps its decoder.
 *
 * Geometry comes from the shared map (see stores/mapSurfaces.ts), resolved on
 * every build, so a warp edited in the editor moves the preset that is live.
 * So does a surface's VJ MAP Look: while a surface wears one, its Edge
 * Effects replace the preset layer's own.
 */
import type { BlendMode, Composition, Layer, MapSurface } from '../types';
import { createSurfaceLookup, resolvePresetLayer, surfaceIdOf, withSurfaceLook } from '../stores/mapSurfaces';
import type { VJClipLauncherState } from '../stores/vjClipLauncher';
import type { VJLayerSequencerState } from '../stores/vjLayerSequencer';

export interface MapPresetRow {
  /** Stable per deck row: `0`, `1`… for deck A, `B0`, `B1`… for deck B. */
  key: string;
  /** Shown in the group name, e.g. `L1`. */
  label: string;
  composition: Composition;
  opacity: number;
  blendMode: BlendMode;
  /** Row FX, applied by the browser group renderer to the whole preset. */
  effects?: Layer['effects'];
}

export interface MapPresetCacheEntry {
  compositionRef: Composition;
  group: Layer;
  /** Runtime-clean clones with stable ids. Geometry is re-resolved per build. */
  layers: Layer[];
}

export const mapPresetGroupId = (rowKey: string) => `mapvj-${rowKey}`;
export const mapPresetLayerId = (rowKey: string, surfaceId: string) => `mapvj-${rowKey}::${surfaceId}`;
/** The surface id inside a `mapvj-<row>::<surfaceId>` layer id. */
const surfaceOfPresetLayerId = (id: string) => id.slice(id.indexOf('::') + 2);

/** JSON clone that drops runtime refs (textures, DOM elements, `_` private
 *  state) so a preset clone can never drag a live handle into a save. */
export function cleanPresetLayerClone(layer: Layer): Layer {
  return JSON.parse(JSON.stringify(layer, (key, value) => {
    if (key === 'texture' || key === 'videoElement' || key === 'renderTarget' || key === 'iframeElement' || key === 'synthVisionCanvas') return undefined;
    if (typeof key === 'string' && key.startsWith('_')) return undefined;
    if (value && typeof value === 'object' && value.constructor?.name?.startsWith('_')) return undefined;
    return value;
  }));
}

function createMapPresetGroup(row: MapPresetRow): Layer {
  return {
    id: mapPresetGroupId(row.key),
    name: `MAP ${row.label}: ${row.composition.name}`,
    type: 'group',
    visible: true,
    locked: false,
    opacity: row.opacity,
    blendMode: row.blendMode,
    source: null,
    linesContent: null,
    svgContent: null,
    colorContent: null,
    lightPaintingContent: null,
    advLightPaintingContent: null,
    textContent: null,
    splatContent: null,
    model3dContent: null,
    pixelFXContent: null,
    gpuLayerContent: null,
    arcadeContent: null,
    position: { x: 0, y: 0 },
    scale: { x: 1, y: 1 },
    rotation: 0,
    flipH: false,
    flipV: false,
    warpMode: 'none',
    corners: {
      topLeft: { x: 0, y: 1 },
      topRight: { x: 1, y: 1 },
      bottomLeft: { x: 0, y: 0 },
      bottomRight: { x: 1, y: 0 },
    },
    meshGrid: null,
    mask: null,
    cropRegion: null,
    layerShape: null,
    effects: [],
    edgeEffects: null,
    groupConfig: { shaderMode: 'individual', overrideStyles: false, shaderSource: null },
  };
}

function buildEntry(row: MapPresetRow): MapPresetCacheEntry {
  const groupId = mapPresetGroupId(row.key);
  const layers = row.composition.layers.map((layer) => {
    const cloned = cleanPresetLayerClone(layer);
    cloned.id = mapPresetLayerId(row.key, surfaceIdOf(layer));
    // Flat under the row group, as before shared surfaces: the native scene
    // has one level of grouping and the row fader must reach every child.
    cloned.parentGroupId = groupId;
    cloned.bank = undefined;
    // A preset's video plays, as it does when the preset is loaded into
    // the editor. The saved flag is not a user choice: project import
    // resets every source to paused, which froze MAP videos after reopen.
    if (cloned.source?.type === 'video') cloned.source.isPlaying = true;
    return cloned;
  });
  return { compositionRef: row.composition, group: createMapPresetGroup(row), layers };
}

/**
 * The MAP preset stack, row order top first. `cache` keeps the clones across
 * builds (rebuilt only when a row's composition object changes) and is pruned
 * to the rows passed in.
 */
export function buildMapPresetLayers(
  rows: readonly MapPresetRow[],
  context: {
    liveLayers: readonly Layer[];
    surfaces: readonly MapSurface[] | undefined;
    cache: Map<string, MapPresetCacheEntry>;
  },
): Layer[] {
  const lookup = createSurfaceLookup(context.liveLayers, context.surfaces);
  const out: Layer[] = [];
  const active = new Set<string>();
  for (const row of rows) {
    active.add(row.key);
    let entry = context.cache.get(row.key);
    if (!entry || entry.compositionRef !== row.composition) {
      entry = buildEntry(row);
      context.cache.set(row.key, entry);
    }
    // Scalars only: safe to update in place on the cached group.
    entry.group.opacity = row.opacity;
    entry.group.blendMode = row.blendMode;
    entry.group.name = `MAP ${row.label}: ${row.composition.name}`;
    (entry.group as Layer & { _postCompositeEffects?: Layer['effects'] })._postCompositeEffects = row.effects ?? [];
    out.push(entry.group);
    for (const child of entry.layers) {
      out.push(withSurfaceLook(resolvePresetLayer(child, lookup), surfaceOfPresetLayerId(child.id), lookup.stored));
    }
  }
  for (const key of [...context.cache.keys()]) {
    if (!active.has(key)) context.cache.delete(key);
  }
  return out;
}

type MapLauncherState = Pick<VJClipLauncherState,
  'layerStates' | 'bankBLayerStates' | 'crossfaderEnabled' | 'masterOpacity'>;
type MapSequencerState = Pick<VJLayerSequencerState, 'isPlaying' | 'opacityOverrides' | 'bankBOpacityOverrides'>;

/**
 * The rows that show a preset, top first. Deck B rows join when the
 * crossfader is on, each deck weighted by `weights` (the same crossfader
 * weights the clip rows use); `null` weights means the crossfader is off.
 */
export function mapPresetRows(
  state: MapLauncherState,
  compositions: readonly Composition[],
  sequencer: MapSequencerState,
  weights: { a: number; b: number } | null,
): MapPresetRow[] {
  const rows: MapPresetRow[] = [];
  const decks: Array<{ deck: 'A' | 'B'; states: VJClipLauncherState['layerStates']; weight: number }> = [
    { deck: 'A', states: state.layerStates ?? [], weight: weights ? weights.a : 1 },
  ];
  if (state.crossfaderEnabled && weights) {
    decks.push({ deck: 'B', states: state.bankBLayerStates ?? [], weight: weights.b });
  }
  for (const { deck, states, weight } of decks) {
    const hasSolo = states.some((row) => row.solo);
    const overrides = deck === 'B' ? (sequencer.bankBOpacityOverrides ?? {}) : (sequencer.opacityOverrides ?? {});
    states.forEach((row, index) => {
      if (row.mute || (hasSolo && !row.solo)) return;
      const clip = row.activeClip;
      if (!clip || clip.type !== 'preset' || !clip.presetId) return;
      const composition = compositions.find((entry) => entry.id === clip.presetId);
      if (!composition) return;
      const sequenceOpacity = sequencer.isPlaying ? (overrides[index] ?? 1) : 1;
      const opacity = row.opacity * sequenceOpacity * (state.masterOpacity ?? 1) * weight;
      if (opacity <= 0) return;
      rows.push({
        key: deck === 'A' ? String(index) : `B${index}`,
        label: deck === 'A' ? `L${index + 1}` : `B L${index + 1}`,
        composition,
        opacity,
        blendMode: row.blendMode,
        effects: row.effects,
      });
    });
  }
  return rows;
}

const hasLiveSource = (layer: Layer) => !!layer.vjGroupId
  || (layer.vjLayerIndex != null && Number.isFinite(Number(layer.vjLayerIndex)));

const sameLiveSource = (a: Layer, b: Layer) => (a.vjGroupId || null) === (b.vjGroupId || null)
  && (a.vjGroupId ? true : Math.round(Number(a.vjLayerIndex)) === Math.round(Number(b.vjLayerIndex)));

/**
 * Editor (shared map) layers whose Source is a VJ row, the deck mix or a VJ
 * group. In MAP they play live next to the presets, drawn above them. A
 * bound group brings its children, a bound child brings its group container
 * so the native group pass still applies. A surface an active preset already
 * routes to the same source is left to the preset, so it is not drawn twice.
 */
export function mapLiveSurfaceLayers(projectLayers: readonly Layer[], presetLayers: readonly Layer[]): Layer[] {
  const presetBySurface = new Map<string, Layer[]>();
  for (const layer of presetLayers) {
    const at = layer.id.indexOf('::');
    if (at < 0 || !hasLiveSource(layer)) continue;
    const surfaceId = layer.id.slice(at + 2);
    const list = presetBySurface.get(surfaceId) ?? [];
    list.push(layer);
    presetBySurface.set(surfaceId, list);
  }
  const include = new Set<string>();
  const boundGroups = new Set<string>();
  for (const layer of projectLayers) {
    if (!hasLiveSource(layer)) continue;
    if (presetBySurface.get(layer.id)?.some((preset) => sameLiveSource(preset, layer))) continue;
    include.add(layer.id);
    if (layer.type === 'group') boundGroups.add(layer.id);
    if (layer.parentGroupId) include.add(layer.parentGroupId);
  }
  for (const layer of projectLayers) {
    if (layer.parentGroupId && boundGroups.has(layer.parentGroupId)) include.add(layer.id);
  }
  return projectLayers.filter((layer) => include.has(layer.id)).map((layer) => ({ ...layer }));
}

/**
 * The whole MAP scene, top first: live-bound editor surfaces (wearing their
 * surface's MAP Look, when `surfaces` has one), then the preset
 * rows. The VJ row feeds (clips, transition and crossfade carriers, the deck
 * mix) come along at opacity 0, as in STAGE: the core keeps rendering their
 * frames and a bound surface samples them, but they never show on their own.
 */
export function composeMapOutputLayers(
  feeds: readonly Layer[],
  editorLayers: readonly Layer[],
  presetLayers: readonly Layer[],
  surfaces?: readonly MapSurface[],
): Layer[] {
  const stored = new Map((surfaces ?? []).map((surface) => [surface.id, surface]));
  return [
    ...feeds.map((layer) => ({ ...layer, opacity: 0 })),
    // An editor layer is its own surface, so it wears that surface's Look.
    ...mapLiveSurfaceLayers(editorLayers, presetLayers).map((layer) => withSurfaceLook(layer, layer.id, stored)),
    ...presetLayers,
  ];
}
