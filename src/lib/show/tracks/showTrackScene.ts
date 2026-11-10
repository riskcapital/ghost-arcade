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
 * - Crossfade between two clips on a track: a helper copy of the layer,
 *   `showxf::<layerId>`, sits directly beneath it carrying the outgoing
 *   clip at its dissolve weight. The incoming copy stays in the scene while
 *   the helper shows, even at no opacity of its own (a faded-in clip, or
 *   the first frame of the window), so an off-stage track never blanks.
 * - A preset dissolve puts the other preset's copy of a layer in the scene
 *   as `showfade::<layerId>` when the two presets share layer ids (see
 *   compositionTransitionLayers.ts). The track drives that copy too, so the
 *   clip stays on both sides of the dissolve.
 *
 * Returns the input array itself when no track changes anything.
 *
 * While a show plays, most frames change only the opacities and lane values
 * the layers carry (a fade, a crossfade, a lane). `ShowTrackSceneCache` keeps
 * the last scene and, when nothing else changed, hands it back with the new
 * values on the layers the tracks drive instead of building it again.
 */
import type { Layer, MapSurface, MediaSource } from '../../types';
import { createSurfaceLookup, resolvePresetLayer } from '../../stores/mapSurfaces';
import { TRANSITION_LAYER_PREFIX } from '../../renderer/compositionTransitionLayers';
import type { ShowTrackFrame, ShowTrackState } from './showTrackEval';

export const SHOW_TRACK_LAYER_PREFIX = 'showtrack::';
/** Invisible copies that compile a shader or boot a sketch before its cut. */
export const SHOW_WARM_LAYER_PREFIX = 'showwarm::';
/** The outgoing side of a crossfade between two clips on one track. */
export const SHOW_XFADE_LAYER_PREFIX = 'showxf::';
/** Source-cache key of a track's crossfade helper (see ShowClipSources). */
export const SHOW_XFADE_SOURCE_SUFFIX = '::xf';
/** The core's scene limit (MAX_SCENE_LAYERS in native-renderer/src/main.rs). */
export const SHOW_SCENE_LAYER_LIMIT = 1024;

export function showTrackLayerId(layerId: string): string {
  return SHOW_TRACK_LAYER_PREFIX + layerId;
}

export interface ShowTrackSceneContext {
  /** The clip's source for a track (null: keep the layer's own content). */
  sourceFor: (state: ShowTrackState) => MediaSource | null;
  /** The outgoing clip's source for a crossfade helper. Asked before the
   *  incoming clip's `sourceFor`, so the outgoing decoder can carry on. */
  xfadeSourceFor?: (state: ShowTrackState) => MediaSource | null;
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

/** A crossfade's outgoing clip is showing. */
function xfadeShows(state: ShowTrackState): boolean {
  return !!state.xfade && state.xfade.opacity > 0;
}

/** The crossfade helper for `base` (a driven layer or an injected copy),
 *  named after the layer it sits beneath. */
function xfadeHelper(base: Layer, layerId: string, state: ShowTrackState, source: MediaSource | null, ownSource: Layer['source']): Layer | null {
  const xf = state.xfade;
  if (!xf || xf.opacity <= 0) return null;
  const helper: Layer = { ...base, id: SHOW_XFADE_LAYER_PREFIX + layerId, visible: true, parentGroupId: null };
  if (source) helper.source = source;
  else if (xf.clip.media.kind === 'layer') helper.source = ownSource;
  if (xf.opacity < 1) helper._showOpacityMul = Math.max(0, xf.opacity);
  else delete helper._showOpacityMul;
  return helper;
}

/**
 * The sources a frame's scene uses, asked for once per build in the order
 * the build has always asked for them (the video sources keep playback
 * anchors, so the calls are part of the result).
 */
interface ResolvedShowSources {
  /** Per track (frame order): the warm source, when asked for. */
  warm: Array<MediaSource | null | undefined>;
  /** By layer id: the outgoing source of a crossfade. */
  xfade: Map<string, MediaSource | null>;
  /** Per track (frame order): the source of an injected copy, when asked for. */
  injected: Array<MediaSource | null | undefined>;
  /** By track layer id: the source of a layer driven on stage. */
  stage: Map<string, MediaSource | null>;
  /** Tracks driving a layer on stage, by track layer id (the last track
   *  wins). The layer may be in the scene as itself or as the other side
   *  of a preset dissolve (`showfade::<layerId>`), or both. */
  onStage: Map<string, ShowTrackState>;
  /** Every answer, in call order, for comparing two resolutions. */
  calls: Array<MediaSource | null>;
}

function resolveShowTrackSources(
  ids: ReadonlyMap<string, number>,
  frame: ShowTrackFrame,
  ctx: ShowTrackSceneContext,
): ResolvedShowSources {
  const out: ResolvedShowSources = { warm: [], xfade: new Map(), injected: [], stage: new Map(), onStage: new Map(), calls: [] };
  const ask = (source: MediaSource | null) => {
    out.calls.push(source);
    return source;
  };
  for (const state of frame.tracks) {
    out.warm.push(state.warm && ctx.warmSourceFor ? ask(ctx.warmSourceFor(state.warm)) : undefined);
    const xfSource = state.xfade && ctx.xfadeSourceFor ? ask(ctx.xfadeSourceFor(state)) : null;
    if (state.xfade) out.xfade.set(state.layerId, xfSource);
    if (isOnStage(ids, state.layerId)) {
      if (affects(state)) out.onStage.set(state.layerId, state);
      out.injected.push(undefined);
      continue;
    }
    out.injected.push(injects(state) ? ask(ctx.sourceFor(state)) : undefined);
  }
  if (out.onStage.size) {
    // In the order of the live layers, as the build draws them.
    const order = [...out.onStage.keys()].sort((a, b) => stageIndex(ids, a) - stageIndex(ids, b));
    for (const id of order) out.stage.set(id, ask(ctx.sourceFor(out.onStage.get(id)!)));
  }
  return out;
}

/** The layer, or the other side of a preset dissolve, is in the scene. */
function isOnStage(ids: ReadonlyMap<string, number>, layerId: string): boolean {
  return ids.has(layerId) || ids.has(TRANSITION_LAYER_PREFIX + layerId);
}

/** Where a track's layer first appears in the scene. */
function stageIndex(ids: ReadonlyMap<string, number>, layerId: string): number {
  return Math.min(ids.get(layerId) ?? Infinity, ids.get(TRANSITION_LAYER_PREFIX + layerId) ?? Infinity);
}

/** The track the live layer `id` is driven by: its own, or for a preset
 *  dissolve's copy of a layer, that layer's. */
function stageState(onStage: ReadonlyMap<string, ShowTrackState>, id: string): ShowTrackState | undefined {
  return onStage.get(id) ?? (id.startsWith(TRANSITION_LAYER_PREFIX) ? onStage.get(id.slice(TRANSITION_LAYER_PREFIX.length)) : undefined);
}

/** An off-stage track injects its copy: a clip plays and either it or the
 *  outgoing side of its crossfade shows. */
function injects(state: ShowTrackState): boolean {
  return !!state.clip && !!state.template && (state.opacity > 0 || xfadeShows(state));
}

function buildFromSources(
  liveLayers: Layer[],
  ids: ReadonlyMap<string, number>,
  frame: ShowTrackFrame,
  ctx: ShowTrackSceneContext,
  sources: ResolvedShowSources,
): Layer[] {
  const injected: Layer[] = [];
  let lookup: ReturnType<typeof createSurfaceLookup> | null = null;
  const warmLayers: Layer[] = [];
  frame.tracks.forEach((state, index) => {
    if (state.warm && ctx.warmSourceFor) {
      const source = sources.warm[index] ?? null;
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
    if (isOnStage(ids, state.layerId)) return;
    // Off stage: an injected copy, only while a clip plays and the layer is
    // not hidden outright. Inside a crossfade the copy stays while the
    // outgoing clip shows, even when the incoming one is not visible yet
    // (it fades in, or the window has just begun): the helper beneath it
    // is made from it.
    if (!injects(state)) return;
    const template = resolvePresetLayer(
      { ...state.template!, surfaceId: state.template!.surfaceId || state.layerId },
      lookup ??= createSurfaceLookup(liveLayers, ctx.surfaces as MapSurface[] | undefined),
    );
    const copy = drive(
      { ...template, id: showTrackLayerId(state.layerId), visible: true, parentGroupId: null },
      state,
      sources.injected[index] ?? null,
    );
    injected.push(copy);
    const helper = xfadeHelper(copy, state.layerId, state, sources.xfade.get(state.layerId) ?? null, template.source);
    if (helper) injected.push(helper);
  });

  const onStage = sources.onStage;
  if (!onStage.size && !injected.length && !warmLayers.length) return liveLayers;
  const stage = onStage.size
    ? liveLayers.flatMap((layer) => {
        const state = stageState(onStage, layer.id);
        if (!state) return [layer];
        const driven = drive(layer, state, sources.stage.get(state.layerId) ?? null);
        const helper = xfadeHelper(driven, layer.id, state, sources.xfade.get(state.layerId) ?? null, layer.source);
        return helper ? [driven, helper] : [driven];
      })
    : liveLayers;
  const room = Math.max(0, (ctx.maxLayers ?? SHOW_SCENE_LAYER_LIMIT) - stage.length);
  const extra = [...injected, ...warmLayers].slice(0, room);
  return extra.length ? [...extra, ...stage] : stage;
}

export function buildShowTrackScene(
  liveLayers: Layer[],
  frame: ShowTrackFrame | null,
  ctx: ShowTrackSceneContext,
): Layer[] {
  if (!frame || frame.tracks.length === 0) return liveLayers;
  const ids = layerIndex(liveLayers);
  return buildFromSources(liveLayers, ids, frame, ctx, resolveShowTrackSources(ids, frame, ctx));
}

/** Layer id → position in the list (the first, when an id repeats). */
function layerIndex(layers: readonly Layer[]): Map<string, number> {
  const ids = new Map<string, number>();
  layers.forEach((l, i) => { if (!ids.has(l.id)) ids.set(l.id, i); });
  return ids;
}

/**
 * What a frame's scene is shaped by, apart from the values the driven layers
 * carry: which layers are driven, injected or hidden, which crossfade helpers
 * and warm copies exist, and which lane keys are set. Two frames with the
 * same shape (and the same sources and templates) build the same scene but
 * for `_showOpacityMul` and `_showParams`.
 */
export function showTrackSceneShape(frame: ShowTrackFrame): string {
  const parts: string[] = [];
  for (const state of frame.tracks) {
    const xf = state.xfade;
    parts.push([
      state.trackId,
      state.layerId,
      state.clip ? 'c' : '-',
      state.opacity > 0 ? '+' : '0',
      state.opacity < 1 ? '<' : '1',
      state.params ? Object.keys(state.params).join(',') : '',
      state.warm ? 'w' : '',
      xf ? `x${xf.clip.media.kind === 'layer' ? 'L' : ''}${xf.opacity > 0 ? '+' : '0'}${xf.opacity < 1 ? '<' : '1'}` : '',
    ].join('|'));
  }
  return parts.join(';');
}

/** The show's own fields of a driven layer (what `drive` puts on it). */
function withShowValues(layer: Layer, opacity: number, params: ShowTrackState['params']): Layer {
  const next: Layer = { ...layer };
  if (opacity < 1) next._showOpacityMul = Math.max(0, opacity);
  else delete next._showOpacityMul;
  if (params && Object.keys(params).length) next._showParams = params;
  else delete next._showParams;
  return next;
}

interface ShowValuePatch {
  index: number;
  track: number;
  /** The layer itself or its injected copy; or its crossfade helper. */
  kind: 'drive' | 'xfade';
}

interface CachedShowScene {
  deps: readonly unknown[];
  shape: string;
  templates: Array<Layer | null>;
  calls: Array<MediaSource | null>;
  scene: Layer[];
  patches: ShowValuePatch[];
}

/**
 * One frame's scene build, prepared: its sources are resolved, and it either
 * reuses the cached scene (same inputs, same shape, same sources) or builds.
 */
export interface PreparedShowTrackScene {
  /** The cached scene can be reused with this frame's values. */
  readonly reusable: boolean;
  /** The cached scene with this frame's opacities and lane values. */
  reuse(): Layer[];
  /** Build the tracks into `list` (a copy of the live layers, same ids and
   *  order); the sources are the ones already resolved. */
  build(list: Layer[]): Layer[];
  /** Remember the finished scene: the build's output after whatever the
   *  caller did to it, as long as that left the show's own fields alone. */
  commit(scene: Layer[]): void;
}

/**
 * The last scene built from the show's layer tracks, reused while a show
 * plays and only the values the driven layers carry move. `deps` are the
 * caller's other inputs (the live layer list, map surfaces, anything applied
 * after the tracks), compared by identity: any change builds afresh.
 */
export class ShowTrackSceneCache {
  private cached: CachedShowScene | null = null;
  private idsFor: { live: readonly Layer[]; ids: Map<string, number> } | null = null;

  /** Forget the cached scene. */
  clear(): void {
    this.cached = null;
  }

  prepare(
    liveLayers: Layer[],
    frame: ShowTrackFrame | null,
    ctx: ShowTrackSceneContext,
    deps: readonly unknown[],
  ): PreparedShowTrackScene {
    const self = this;
    if (!frame || frame.tracks.length === 0) {
      return {
        reusable: false,
        reuse: () => { throw new Error('nothing to reuse'); },
        build: (list) => list,
        commit: () => { self.cached = null; },
      };
    }
    if (this.idsFor?.live !== liveLayers) this.idsFor = { live: liveLayers, ids: layerIndex(liveLayers) };
    const ids = this.idsFor.ids;
    const sources = resolveShowTrackSources(ids, frame, ctx);
    const shape = showTrackSceneShape(frame);
    const templates = frame.tracks.map((t) => t.template);
    const cached = this.cached;
    const reusable = !!cached
      && cached.shape === shape
      && sameItems(cached.deps, deps)
      && sameItems(cached.templates, templates)
      && sameItems(cached.calls, sources.calls);
    return {
      reusable,
      reuse: () => {
        if (!reusable || !cached) throw new Error('the cached scene does not fit this frame');
        const scene = cached.scene.slice();
        for (const patch of cached.patches) {
          const state = frame.tracks[patch.track];
          const layer = scene[patch.index];
          scene[patch.index] = patch.kind === 'drive'
            ? withShowValues(layer, state.opacity, state.params)
            : withShowValues(layer, state.xfade?.opacity ?? 1, state.params);
        }
        cached.scene = scene;
        return scene;
      },
      build: (list) => buildFromSources(list, ids, frame, ctx, sources),
      commit: (scene) => {
        self.cached = { deps: [...deps], shape, templates, calls: sources.calls, scene, patches: showValuePatches(scene, frame) };
      },
    };
  }
}

function sameItems(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Where a scene's driven layers are: the layer a track drives on stage
 *  (when it drives it at all), its injected copy, its crossfade helper. */
function showValuePatches(scene: readonly Layer[], frame: ShowTrackFrame): ShowValuePatch[] {
  const wanted = new Map<string, { track: number; kind: ShowValuePatch['kind'] }>();
  frame.tracks.forEach((state, track) => {
    if (affects(state)) wanted.set(state.layerId, { track, kind: 'drive' });
    wanted.set(showTrackLayerId(state.layerId), { track, kind: 'drive' });
    wanted.set(SHOW_XFADE_LAYER_PREFIX + state.layerId, { track, kind: 'xfade' });
  });
  const patches: ShowValuePatch[] = [];
  scene.forEach((layer, index) => {
    const hit = wanted.get(layer.id);
    if (hit) patches.push({ index, ...hit });
  });
  return patches;
}
