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
 * - A layer the show adds on a piece (a sub-row) is a copy of the piece,
 *   `showsub::<layerId>::<trackId>`, drawn directly over it (over the
 *   piece's earlier added layers), only while one of its blocks plays. It
 *   shares the piece's shape, warp and effects; its block brings the
 *   picture, the blend mode ('normal' unless the block says) and opacity.
 * - A block's own blend mode replaces the piece's while it plays.
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
import { applyShowLooks, showLooksSignature } from './showLooks';

export const SHOW_TRACK_LAYER_PREFIX = 'showtrack::';
/** A layer the show adds on a piece: `showsub::<layerId>::<trackId>`. */
export const SHOW_SUB_LAYER_PREFIX = 'showsub::';
/** Invisible copies that compile a shader or boot a sketch before its cut. */
export const SHOW_WARM_LAYER_PREFIX = 'showwarm::';
/** A block with a where line, drawn over another piece: `showwhere::<pieceId>::<clipId>`. */
export const SHOW_WHERE_LAYER_PREFIX = 'showwhere::';
/** The outgoing side of a crossfade between two clips on one track. */
export const SHOW_XFADE_LAYER_PREFIX = 'showxf::';
/** Source-cache key of a track's crossfade helper (see ShowClipSources). */
export const SHOW_XFADE_SOURCE_SUFFIX = '::xf';
/** The core's scene limit (MAX_SCENE_LAYERS in native-renderer/src/main.rs). */
export const SHOW_SCENE_LAYER_LIMIT = 1024;

export function showTrackLayerId(layerId: string): string {
  return SHOW_TRACK_LAYER_PREFIX + layerId;
}

export function showSubLayerId(layerId: string, trackId: string): string {
  return `${SHOW_SUB_LAYER_PREFIX}${layerId}::${trackId}`;
}

export function showWhereLayerId(pieceId: string, clipId: string): string {
  return `${SHOW_WHERE_LAYER_PREFIX}${pieceId}::${clipId}`;
}

/** The piece a scene layer id belongs to when it is one of the show's own
 *  copies of it (an injected copy or an added layer), else null. */
export function showCopyPieceId(id: string): string | null {
  if (id.startsWith(SHOW_TRACK_LAYER_PREFIX)) return id.slice(SHOW_TRACK_LAYER_PREFIX.length);
  if (id.startsWith(SHOW_SUB_LAYER_PREFIX)) {
    const rest = id.slice(SHOW_SUB_LAYER_PREFIX.length);
    const cut = rest.lastIndexOf('::');
    return cut > 0 ? rest.slice(0, cut) : null;
  }
  return null;
}

/** The piece a scene layer draws on when it is one of the show's copies of
 *  it (an injected copy, an added layer, a block travelling over it), else
 *  null. */
export function showLayerPieceId(id: string): string | null {
  if (id.startsWith(SHOW_WHERE_LAYER_PREFIX)) {
    const rest = id.slice(SHOW_WHERE_LAYER_PREFIX.length);
    const cut = rest.lastIndexOf('::');
    return cut > 0 ? rest.slice(0, cut) : null;
  }
  return showCopyPieceId(id);
}

/** What a state's helpers are named after: the piece for its own row, the
 *  row for a layer added on it. */
function helperKey(state: Pick<ShowTrackState, 'sub' | 'layerId' | 'trackId'>): string {
  return state.sub ? `sub:${state.trackId}` : state.layerId;
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
  if (state.clip?.blendMode) next.blendMode = state.clip.blendMode;
  if (state.clip) next._showClipId = state.clip.clipId;
  else delete next._showClipId;
  if (state.opacity < 1) next._showOpacityMul = Math.max(0, state.opacity);
  if (state.params && Object.keys(state.params).length) next._showParams = state.params;
  return next;
}

/** The part of the stage a piece covers, as a crop of a picture spread
 *  across the stage (top-origin, like `cropRegion`). */
export function stageCropOf(layer: Pick<Layer, 'corners'>): Layer['cropRegion'] {
  const c = layer.corners;
  if (!c) return null;
  const xs = [c.topLeft.x, c.topRight.x, c.bottomLeft.x, c.bottomRight.x];
  const ys = [c.topLeft.y, c.topRight.y, c.bottomLeft.y, c.bottomRight.y];
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  const x0 = clamp(Math.min(...xs));
  const x1 = clamp(Math.max(...xs));
  const y0 = clamp(Math.min(...ys));
  const y1 = clamp(Math.max(...ys));
  if (x1 - x0 < 1e-4 || y1 - y0 < 1e-4) return null;
  // Corners are y up; the crop is measured from the top.
  return { x: x0, y: 1 - y1, width: x1 - x0, height: y1 - y0 };
}

/** A layer showing its part of a picture spread across the stage. */
function spanned(layer: Layer): Layer {
  const crop = stageCropOf(layer);
  return crop ? { ...layer, cropRegion: crop, contentFit: 'stretch' } : layer;
}

const BLACK = { hue: 0, saturation: 0, lightness: 0, alpha: 1 };

/** A piece whose own content is dark: drawn black (a colour fill keeps its
 *  shape, warp and looks), or hidden when it is not a layer that can show a
 *  colour. */
export function darkPiece(layer: Layer): Layer {
  if (layer.type === 'media' || layer.type === 'color') {
    return { ...layer, source: null, colorContent: { ...BLACK }, type: layer.type };
  }
  return { ...layer, _showOpacityMul: 0 };
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
function xfadeHelper(base: Layer, layerId: string, state: ShowTrackState, source: MediaSource | null, ownSource: Layer['source'], ownBlend?: Layer['blendMode']): Layer | null {
  const xf = state.xfade;
  if (!xf || xf.opacity <= 0) return null;
  const helper: Layer = { ...base, id: SHOW_XFADE_LAYER_PREFIX + layerId, visible: true, parentGroupId: null };
  if (source) helper.source = source;
  helper._showClipId = xf.clip.clipId;
  const blend = xf.clip.blendMode ?? ownBlend;
  if (blend) helper.blendMode = blend;
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
    if (state.xfade) out.xfade.set(helperKey(state), xfSource);
    if (state.sub) {
      // A layer added on a piece is always the show's own copy.
      out.injected.push(subShows(state) ? ask(ctx.sourceFor(state)) : undefined);
      continue;
    }
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
  return !!state.clip && !!state.template && (state.opacity > 0 || xfadeShows(state) || travels(state));
}

/** A layer added on a piece is drawn: one of its blocks plays and shows
 *  (or travels: it stays, at no opacity, while its own piece is not lit). */
function subShows(state: ShowTrackState): boolean {
  return !!state.clip && (state.opacity > 0 || xfadeShows(state) || travels(state));
}

/** The block has a where line over other pieces (its copies need its source). */
function travels(state: ShowTrackState): boolean {
  return !!state.whereCopies?.length;
}

function buildFromSources(
  liveLayers: Layer[],
  ids: ReadonlyMap<string, number>,
  frame: ShowTrackFrame,
  ctx: ShowTrackSceneContext,
  sources: ResolvedShowSources,
): Layer[] {
  const scene = buildTracks(liveLayers, ids, frame, ctx, sources);
  // The Looks row dresses the shapes last, over whatever the rows did.
  return frame.looks?.length ? applyShowLooks(scene, frame.looks, liveLayers, showLayerPieceId) : scene;
}

/** Nothing in the frame changes the scene: no rows and no looks. */
function emptyFrame(frame: ShowTrackFrame | null): frame is null {
  return !frame || (frame.tracks.length === 0 && !frame.looks?.length);
}

function buildTracks(
  liveLayers: Layer[],
  ids: ReadonlyMap<string, number>,
  frame: ShowTrackFrame,
  ctx: ShowTrackSceneContext,
  sources: ResolvedShowSources,
): Layer[] {
  const injected: Layer[] = [];
  let lookup: ReturnType<typeof createSurfaceLookup> | null = null;
  const warmLayers: Layer[] = [];
  /** Layers added on each piece, top first, each with its crossfade helper. */
  const subsByPiece = new Map<string, Layer[]>();
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
          id: SHOW_WARM_LAYER_PREFIX + (state.sub ? state.trackId : state.layerId),
          visible: true,
          parentGroupId: null,
          source,
          opacity: 0,
        });
      }
    }
    if (state.sub) {
      if (!subShows(state)) return;
      const live = liveLayers.find((l) => l.id === state.layerId);
      let base: Layer | null = live ?? null;
      if (!base && state.template) {
        base = resolvePresetLayer(
          { ...state.template, surfaceId: state.template.surfaceId || state.layerId },
          lookup ??= createSurfaceLookup(liveLayers, ctx.surfaces as MapSurface[] | undefined),
        );
      }
      if (!base) return;
      const plain: Layer = { ...base, id: showSubLayerId(state.layerId, state.trackId), visible: true, parentGroupId: null, blendMode: 'normal' };
      delete plain._showOpacityMul;
      delete plain._showParams;
      const copy = drive(state.span ? spanned(plain) : plain, state, sources.injected[index] ?? null);
      const helper = xfadeHelper(copy, helperKey(state), state, sources.xfade.get(helperKey(state)) ?? null, base.source, 'normal');
      // Later rows draw over earlier ones: the newest goes first (on top).
      subsByPiece.set(state.layerId, [copy, ...(helper ? [helper] : []), ...(subsByPiece.get(state.layerId) ?? [])]);
      return;
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
    const helper = xfadeHelper(copy, state.layerId, state, sources.xfade.get(state.layerId) ?? null, template.source, template.blendMode);
    if (helper) injected.push(helper);
  });

  // Blocks with a where line, over the other pieces it reaches (like an
  // added layer: directly over the piece, Normal, the block's picture).
  frame.tracks.forEach((state, index) => {
    if (!state.clip || !state.whereCopies?.length) return;
    const source = state.sub || !isOnStage(ids, state.layerId) ? sources.injected[index] ?? null : sources.stage.get(state.layerId) ?? null;
    if (!source && state.clip.media.kind !== 'layer') return;
    for (const c of state.whereCopies) {
      // Unlit copies stay, at no opacity: the scene keeps its layers while
      // the window moves.
      const base = liveLayers.find((l) => l.id === c.pieceId);
      if (!base) continue;
      const plain: Layer = { ...base, id: showWhereLayerId(c.pieceId, state.clip.clipId), visible: true, parentGroupId: null, blendMode: 'normal' };
      delete plain._showOpacityMul;
      delete plain._showParams;
      const copy = drive(state.span ? spanned(plain) : plain, { ...state, opacity: c.opacity }, source);
      if (!state.clip.blendMode) copy.blendMode = 'normal';
      subsByPiece.set(c.pieceId, [copy, ...(subsByPiece.get(c.pieceId) ?? [])]);
    }
  });

  const onStage = sources.onStage;
  const dark = frame.darkPieces?.length ? new Set(frame.darkPieces) : null;
  if (!onStage.size && !injected.length && !warmLayers.length && !subsByPiece.size && !dark) return liveLayers;
  // Added layers go directly over their piece: where it first appears on
  // stage, over its injected copy, or at the top.
  const pendingSubs = new Map(subsByPiece);
  const subsOver = (id: string): Layer[] => {
    const pieceId = id.startsWith(TRANSITION_LAYER_PREFIX) ? id.slice(TRANSITION_LAYER_PREFIX.length) : id;
    const subs = pendingSubs.get(pieceId);
    if (!subs) return [];
    pendingSubs.delete(pieceId);
    return subs;
  };
  const stage = onStage.size || subsByPiece.size || dark
    ? liveLayers.flatMap((layer) => {
        const over = subsByPiece.size ? subsOver(layer.id) : [];
        const state = stageState(onStage, layer.id);
        if (!state) {
          const own = dark?.has(layer.id) ? darkPiece(layer) : layer;
          return over.length ? [...over, own] : [own];
        }
        const driven = drive(state.span ? spanned(layer) : layer, state, sources.stage.get(state.layerId) ?? null);
        const helper = xfadeHelper(driven, layer.id, state, sources.xfade.get(state.layerId) ?? null, layer.source, layer.blendMode);
        return [...over, driven, ...(helper ? [helper] : [])];
      })
    : liveLayers;
  if (pendingSubs.size) {
    for (const [pieceId, subs] of [...pendingSubs]) {
      const at = injected.findIndex((l) => l.id === showTrackLayerId(pieceId));
      if (at < 0) continue;
      injected.splice(at, 0, ...subs);
      pendingSubs.delete(pieceId);
    }
    if (pendingSubs.size) injected.unshift(...[...pendingSubs.values()].flat());
  }
  const room = Math.max(0, (ctx.maxLayers ?? SHOW_SCENE_LAYER_LIMIT) - stage.length);
  const extra = [...injected, ...warmLayers].slice(0, room);
  return extra.length ? [...extra, ...stage] : stage;
}

export function buildShowTrackScene(
  liveLayers: Layer[],
  frame: ShowTrackFrame | null,
  ctx: ShowTrackSceneContext,
): Layer[] {
  if (emptyFrame(frame)) return liveLayers;
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
  const parts: string[] = [showLooksSignature(frame.looks), frame.darkPieces?.length ? `D:${frame.darkPieces.join(',')}` : ''];
  for (const state of frame.tracks) {
    const xf = state.xfade;
    parts.push([
      state.trackId,
      state.layerId,
      state.sub ? 's' : '',
      state.clip ? `c${state.clip.blendMode ?? ''}` : '-',
      state.opacity > 0 ? '+' : '0',
      state.opacity < 1 ? '<' : '1',
      state.params ? Object.keys(state.params).join(',') : '',
      state.warm ? 'w' : '',
      xf ? `x${xf.clip.media.kind === 'layer' ? 'L' : ''}${xf.opacity > 0 ? '+' : '0'}${xf.opacity < 1 ? '<' : '1'}${xf.clip.blendMode ?? ''}` : '',
      state.whereCopies?.length ? `W${state.whereCopies.map((c) => c.pieceId).join(',')}` : '',
      state.span ? 'S' : '',
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
  /** The layer itself or its injected copy; or its crossfade helper; or a
   *  where copy over another piece. */
  kind: 'drive' | 'xfade' | 'where';
  pieceId?: string;
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
    if (emptyFrame(frame)) {
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
            : patch.kind === 'where'
              ? withShowValues(layer, state.whereCopies?.find((c) => c.pieceId === patch.pieceId)?.opacity ?? 0, state.params)
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
  const wanted = new Map<string, { track: number; kind: ShowValuePatch['kind']; pieceId?: string }>();
  frame.tracks.forEach((state, track) => {
    if (state.clip && state.whereCopies?.length) {
      for (const c of state.whereCopies) wanted.set(showWhereLayerId(c.pieceId, state.clip.clipId), { track, kind: 'where', pieceId: c.pieceId });
    }
    if (state.sub) {
      wanted.set(showSubLayerId(state.layerId, state.trackId), { track, kind: 'drive' });
      wanted.set(SHOW_XFADE_LAYER_PREFIX + helperKey(state), { track, kind: 'xfade' });
      return;
    }
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
