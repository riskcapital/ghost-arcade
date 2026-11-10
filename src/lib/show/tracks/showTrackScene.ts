/**
 * Build the layers the core draws from the mapping scene and the show's
 * layer-track frame.
 *
 * Tracks never write into the project. Every frame the scene is rebuilt from
 * show time, so a preset swapping layers underneath, undo and autosave never
 * see a clip, and scrubbing, live play and export give the same picture.
 *
 * - On stage (a layer with the track's id is in the scene): the track drives
 *   that layer in place. It keeps its z-order, warp, effects and blend; the
 *   clip's media replaces its source, and the clip's opacity and fades ride
 *   on `_showOpacityMul`, applied after every keyframe value.
 * - Off stage: the track injects its own copy, `showtrack::<layerId>`, made
 *   from the track's template with the shared surface geometry resolved
 *   live. Injected copies are drawn above the stage, in track order, and are
 *   only there while a clip is playing.
 * - Gaps: the layer shows its own content ('layer') or is hidden ('hide').
 * - Muted tracks hide their layer; a solo hides every other tracked layer.
 *
 * Returns the input array itself when no track changes anything.
 */
import type { Layer, MapSurface, MediaSource } from '../../types';
import { createSurfaceLookup, resolvePresetLayer } from '../../stores/mapSurfaces';
import type { ShowTrackFrame, ShowTrackState } from './showTrackEval';

export const SHOW_TRACK_LAYER_PREFIX = 'showtrack::';
/** Invisible copies that compile a shader or boot a sketch before its cut. */
export const SHOW_WARM_LAYER_PREFIX = 'showwarm::';
/** The core's scene limit (MAX_SCENE_LAYERS in native-renderer/src/main.rs). */
export const SHOW_SCENE_LAYER_LIMIT = 1024;

export function showTrackLayerId(layerId: string): string {
  return SHOW_TRACK_LAYER_PREFIX + layerId;
}

export interface ShowTrackSceneContext {
  /** The clip's source for a track (null: keep the layer's own content). */
  sourceFor: (state: ShowTrackState) => MediaSource | null;
  /** The source a warmed (upcoming) shader or sketch clip will use. */
  warmSourceFor?: (warm: NonNullable<ShowTrackState['warm']>) => MediaSource | null;
  /** Stored map surfaces, for an injected copy's geometry. */
  surfaces?: readonly MapSurface[];
  /** Hard cap on scene layers; injected copies past it are left out. */
  maxLayers?: number;
}

function drive(layer: Layer, state: ShowTrackState, source: MediaSource | null): Layer {
  const next: Layer = { ...layer };
  if (source) next.source = source;
  if (state.opacity < 1) next._showOpacityMul = Math.max(0, state.opacity);
  if (state.params && Object.keys(state.params).length) next._showParams = state.params;
  return next;
}

function affects(state: ShowTrackState): boolean {
  return state.clip !== null || state.opacity < 1 || !!(state.params && Object.keys(state.params).length);
}

export function buildShowTrackScene(
  liveLayers: Layer[],
  frame: ShowTrackFrame | null,
  ctx: ShowTrackSceneContext,
): Layer[] {
  if (!frame || frame.tracks.length === 0) return liveLayers;
  const onStage = new Map<string, ShowTrackState>();
  const injected: Layer[] = [];
  let lookup: ReturnType<typeof createSurfaceLookup> | null = null;
  const ids = new Set(liveLayers.map((l) => l.id));

  const warmLayers: Layer[] = [];
  for (const state of frame.tracks) {
    if (state.warm && ctx.warmSourceFor) {
      const source = ctx.warmSourceFor(state.warm);
      const base = liveLayers.find((l) => l.id === state.layerId) ?? state.template;
      if (source && base) {
        lookup ??= createSurfaceLookup(liveLayers, ctx.surfaces as MapSurface[] | undefined);
        const resolved = base === state.template
          ? resolvePresetLayer({ ...base, surfaceId: base.surfaceId || state.layerId }, lookup)
          : base;
        warmLayers.push({
          ...resolved,
          id: SHOW_WARM_LAYER_PREFIX + state.layerId,
          visible: true,
          parentGroupId: null,
          source,
          opacity: 0,
        });
      }
    }
    if (ids.has(state.layerId)) {
      if (affects(state)) onStage.set(state.layerId, state);
      continue;
    }
    // Off stage: an injected copy, only while a clip plays and the layer is
    // not hidden outright.
    if (!state.clip || !state.template || state.opacity <= 0) continue;
    lookup ??= createSurfaceLookup(liveLayers, ctx.surfaces as MapSurface[] | undefined);
    const template = resolvePresetLayer({ ...state.template, surfaceId: state.template.surfaceId || state.layerId }, lookup);
    const copy = drive(
      { ...template, id: showTrackLayerId(state.layerId), visible: true, parentGroupId: null },
      state,
      ctx.sourceFor(state),
    );
    injected.push(copy);
  }

  if (!onStage.size && !injected.length && !warmLayers.length) return liveLayers;
  const stage = onStage.size
    ? liveLayers.map((layer) => {
        const state = onStage.get(layer.id);
        return state ? drive(layer, state, ctx.sourceFor(state)) : layer;
      })
    : liveLayers;
  const room = Math.max(0, (ctx.maxLayers ?? SHOW_SCENE_LAYER_LIMIT) - stage.length);
  const extra = [...injected, ...warmLayers].slice(0, room);
  return extra.length ? [...extra, ...stage] : stage;
}
