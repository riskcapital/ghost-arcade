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
 */
import type { BlendMode, Composition, Layer, MapSurface } from '../types';
import { createSurfaceLookup, resolvePresetLayer, surfaceIdOf } from '../stores/mapSurfaces';
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
    for (const child of entry.layers) out.push(resolvePresetLayer(child, lookup));
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

