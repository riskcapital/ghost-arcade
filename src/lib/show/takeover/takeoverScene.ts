/**
 * The live takeover in the native scene. Runs after the show's layer tracks
 * (buildShowTrackScene) in Canvas's mapping branch.
 *
 * - A taken-over surface gets a copy of itself, `takeover::<surfaceId>`,
 *   directly above it: same geometry, warp, effects and blend, showing the
 *   takeover's source at the takeover's level. The show's layer underneath
 *   is left exactly as the timeline drives it, so handing back is only the
 *   copy fading away. A surface the scene does not have (an off-stage track
 *   between clips) is drawn from the track's template.
 * - A VJ row, the deck mix or a VJ group: the VJ feed layers it samples are
 *   put at the top of the scene at opacity 0, as MAP mode does. The core
 *   keeps rendering their frames and the copy samples one of them. Only the
 *   feeds a source reaches are brought in (a row: that row's feed; the mix
 *   or a group: the mix carrier and every row it mixes), plus any the caller
 *   asks to keep, because the core renders every layer in the scene whatever
 *   its opacity. Saved row assignments on other layers are left out while
 *   the VJ has feeds, so only the taken-over surfaces change.
 * - Dropped media plays from the moment of the engage; black is black.
 * - Temporary effects are appended to the copy (or, with no source, to the
 *   surface itself).
 * - The overlay is a full-frame layer over everything.
 * - Over the core's layer limit, takeover helpers go before show helpers.
 *
 * Returns the input array itself when no takeover is active.
 */
import { createLayer, type Layer, type MapSurface, type MediaSource } from '../../types';
import { createSurfaceLookup, resolvePresetLayer } from '../../stores/mapSurfaces';
import { staticClipSource, readableClipUri } from '../tracks/showClipSources';
import {
  SHOW_SCENE_LAYER_LIMIT,
  SHOW_TRACK_LAYER_PREFIX,
  SHOW_WARM_LAYER_PREFIX,
  SHOW_XFADE_LAYER_PREFIX,
} from '../tracks/showTrackScene';
import type { TakeoverFrame, TakeoverSource, TakeoverSurfaceFrame } from './liveTakeover';

export const TAKEOVER_LAYER_PREFIX = 'takeover::';
export const TAKEOVER_OVERLAY_ID = 'takeover::overlay';
const VJ_MIX_LAYER_ID = '__vj-mix__';

export function takeoverLayerId(surfaceId: string): string {
  return TAKEOVER_LAYER_PREFIX + surfaceId;
}

/** Opaque black, for 'black' and for a VJ row with nothing playing. */
export const TAKEOVER_BLACK_SHADER = `/*{"ISFVSN":"2.0","DESCRIPTION":"Takeover black","INPUTS":[]}*/
void main() {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
}
`;

const blackSource: MediaSource = {
  id: 'takeover:black',
  type: 'shader',
  src: 'takeover://black',
  name: 'Black',
  shaderCode: TAKEOVER_BLACK_SHADER,
  shaderInputs: [],
  shaderValues: {},
} as unknown as MediaSource;

export interface TakeoverSceneContext {
  /** The VJ row feeds (clip layers, crossfade carriers, the mix carrier).
   *  null: the launcher's derived layers are a tick behind; skip this sync. */
  feeds?: () => Layer[] | null;
  /** Feed layers to keep in the scene although no source samples them (a
   *  row whose clip transition is still running, so it finishes as before). */
  keepFeedIds?: Iterable<string>;
  /** Deck B rows exist only with the crossfader on (ids end in -A / -B). */
  crossfaderEnabled?: boolean;
  /** A surface's own copy when the scene does not have it (a track template). */
  templateFor?: (surfaceId: string) => Layer | null;
  /** Stored map surfaces, for a template's geometry. */
  surfaces?: readonly MapSurface[];
  /** Source for dropped media (cached per engage so it is stable). */
  mediaSourceFor?: (surface: TakeoverSurfaceFrame) => MediaSource | null;
  maxLayers?: number;
}

/** Sample one VJ feed layer's finished frame (what the core's routing does
 *  for a saved row assignment). */
function sharedFeedSource(ownerId: string, feed: Layer): MediaSource {
  return {
    id: `vj-shared-feed:${ownerId}`,
    type: 'effect',
    name: feed.name,
    src: 'plugin://vj-mix',
    effectSource: {
      effectType: 'vj-mix',
      vjmixSharedFeed: true,
      vjmixRows: [{ layerId: feed.id, opacity: 1, blendMode: 'normal' }],
    },
  } as unknown as MediaSource;
}

/** The feed layer a VJ row source samples, or null when the row is empty. */
export function vjRowFeedId(source: { deck: 'A' | 'B'; row: number }, feeds: readonly Layer[], crossfaderEnabled: boolean): string | null {
  const ids = new Set(feeds.map((f) => f.id));
  if (crossfaderEnabled) {
    const banked = `vj-layer-${source.row}-${source.deck}`;
    if (ids.has(banked)) return banked;
    return null;
  }
  if (source.deck === 'B') return null;
  const plain = `vj-layer-${source.row}`;
  return ids.has(plain) ? plain : null;
}

/** Point `layer` at `source`. A source with nothing to show (an empty row,
 *  a mix with no rows) is black. */
function applySource(
  layer: Layer,
  surface: TakeoverSurfaceFrame | null,
  source: TakeoverSource,
  feeds: readonly Layer[],
  ctx: TakeoverSceneContext,
): void {
  delete layer.vjLayerIndex;
  delete layer.vjGroupId;
  switch (source.kind) {
    case 'black':
      layer.source = blackSource;
      return;
    case 'vjRow': {
      const id = vjRowFeedId(source, feeds, !!ctx.crossfaderEnabled);
      const feed = id ? feeds.find((f) => f.id === id) : null;
      layer.source = feed ? sharedFeedSource(layer.id, feed) : blackSource;
      return;
    }
    case 'vjMix': {
      const mix = feeds.find((f) => f.id === VJ_MIX_LAYER_ID);
      layer.source = mix ? sharedFeedSource(layer.id, mix) : blackSource;
      return;
    }
    case 'vjGroup':
      // The core's routing builds the group's feed from the mix carrier.
      layer.vjGroupId = source.groupId;
      layer.source = blackSource;
      return;
    case 'media': {
      const media = surface && ctx.mediaSourceFor ? ctx.mediaSourceFor(surface) : null;
      layer.source = media ?? blackSource;
      return;
    }
  }
}

/** The feed layers a feed samples: crossfade inputs and mix rows. */
function feedReferences(feed: Layer): string[] {
  const fx = (feed.source as { effectSource?: Record<string, unknown> } | undefined)?.effectSource;
  if (!fx) return [];
  const out: string[] = [];
  for (const key of ['vjxfadeLayerA', 'vjxfadeLayerB'] as const) {
    if (typeof fx[key] === 'string') out.push(fx[key] as string);
  }
  if (Array.isArray(fx.vjmixRows)) {
    for (const row of fx.vjmixRows as Array<{ layerId?: unknown; frameId?: unknown }>) {
      if (typeof row?.layerId === 'string') out.push(row.layerId);
      else if (typeof row?.frameId === 'string' && row.frameId.startsWith('layer-frame:')) out.push(row.frameId.slice('layer-frame:'.length));
    }
  }
  return out;
}

/**
 * The feeds a takeover frame needs, in their scene order: the feed each VJ
 * source samples (a row's own feed; the mix carrier for the mix and for a
 * group, whose picture the core cuts from the mix), every feed those sample
 * in turn, and `keep`. Every VJ source counts, at any level, so a fade-in
 * starting from 0 has its feed running from the first frame.
 */
export function sampledVjFeeds(
  feeds: readonly Layer[],
  frame: TakeoverFrame,
  crossfaderEnabled: boolean,
  keep: Iterable<string> = [],
): Layer[] {
  const byId = new Map(feeds.map((f) => [f.id, f]));
  const pending: string[] = [...keep];
  const add = (source: TakeoverSource | null | undefined) => {
    if (!source) return;
    if (source.kind === 'vjRow') {
      const id = vjRowFeedId(source, feeds, crossfaderEnabled);
      if (id) pending.push(id);
    } else if (source.kind === 'vjMix' || source.kind === 'vjGroup') {
      pending.push(VJ_MIX_LAYER_ID);
    }
  };
  for (const surface of frame.surfaces) add(surface.source);
  add(frame.overlay?.source);
  const needed = new Set<string>();
  while (pending.length) {
    const id = pending.pop()!;
    const feed = byId.get(id);
    if (!feed || needed.has(id)) continue;
    needed.add(id);
    pending.push(...feedReferences(feed));
  }
  return needed.size === feeds.length ? [...feeds] : feeds.filter((f) => needed.has(f.id));
}

function isShowHelper(id: string): boolean {
  return id.startsWith(SHOW_WARM_LAYER_PREFIX) || id.startsWith(SHOW_XFADE_LAYER_PREFIX) || id.startsWith(SHOW_TRACK_LAYER_PREFIX);
}

/**
 * Fit the scene under the core's layer limit. Takeover helpers go first
 * (the copies, then the overlay, then the VJ feeds they no longer need),
 * then the show's helpers (warm layers, crossfade helpers, injected copies).
 */
export function capTakeoverScene(list: Layer[], feedIds: ReadonlySet<string>, maxLayers = SHOW_SCENE_LAYER_LIMIT): Layer[] {
  if (list.length <= maxLayers) return list;
  let out = list;
  let excess = out.length - maxLayers;
  const dropWhere = (pred: (l: Layer) => boolean, fromEnd = true) => {
    if (excess <= 0) return;
    const idx: number[] = [];
    out.forEach((l, i) => { if (pred(l)) idx.push(i); });
    if (fromEnd) idx.reverse();
    const gone = new Set(idx.slice(0, excess));
    if (!gone.size) return;
    out = out.filter((_, i) => !gone.has(i));
    excess -= gone.size;
  };
  dropWhere((l) => l.id.startsWith(TAKEOVER_LAYER_PREFIX) && l.id !== TAKEOVER_OVERLAY_ID);
  dropWhere((l) => l.id === TAKEOVER_OVERLAY_ID);
  if (!out.some((l) => l.id.startsWith(TAKEOVER_LAYER_PREFIX))) {
    // Nothing samples the feeds any more: they all go.
    const before = out.length;
    out = out.filter((l) => !feedIds.has(l.id));
    excess -= before - out.length;
  }
  dropWhere((l) => l.id.startsWith(SHOW_WARM_LAYER_PREFIX));
  dropWhere((l) => l.id.startsWith(SHOW_XFADE_LAYER_PREFIX));
  dropWhere((l) => l.id.startsWith(SHOW_TRACK_LAYER_PREFIX));
  return out.length > maxLayers ? out.slice(0, maxLayers) : out;
}

export function buildTakeoverScene(list: Layer[], frame: TakeoverFrame | null, ctx: TakeoverSceneContext = {}): Layer[] | null {
  if (!frame || (!frame.surfaces.length && !frame.overlay)) return list;

  let feeds: Layer[] = [];
  let vjHasFeeds = false;
  if (frame.needsVjFeeds && ctx.feeds) {
    const built = ctx.feeds();
    if (built === null) return null;
    vjHasFeeds = built.length > 0;
    feeds = sampledVjFeeds(built, frame, !!ctx.crossfaderEnabled, ctx.keepFeedIds).map((l) => ({ ...l, opacity: 0 }));
  }
  const feedIds = new Set(feeds.map((l) => l.id));

  // While the VJ has feeds, a saved row assignment on any other layer would
  // start sampling them: only the takeover's own layers may.
  let stage = vjHasFeeds
    ? list.map((l) => (l.vjLayerIndex != null || l.vjGroupId ? { ...l, vjLayerIndex: undefined, vjGroupId: undefined } : l))
    : list;

  const injected: Layer[] = [];
  let lookup: ReturnType<typeof createSurfaceLookup> | null = null;
  for (const surface of frame.surfaces) {
    const level = Math.max(0, Math.min(1, surface.level));
    // Effects only: the surface keeps its picture and wears the effects.
    if (!surface.source) {
      if (!surface.effects?.length) continue;
      stage = stage.map((l) => (l.id === surface.surfaceId || l.id === SHOW_TRACK_LAYER_PREFIX + surface.surfaceId
        ? { ...l, effects: [...(l.effects ?? []), ...surface.effects!] }
        : l));
      continue;
    }
    if (level <= 0 && surface.source.kind !== 'media') continue;
    let index = stage.findIndex((l) => l.id === surface.surfaceId);
    if (index < 0) index = stage.findIndex((l) => l.id === SHOW_TRACK_LAYER_PREFIX + surface.surfaceId);
    let base: Layer | null = index >= 0 ? stage[index] : null;
    if (!base) {
      const template = ctx.templateFor?.(surface.surfaceId) ?? null;
      if (!template) continue;
      lookup ??= createSurfaceLookup(list, ctx.surfaces as MapSurface[] | undefined);
      base = resolvePresetLayer({ ...template, surfaceId: template.surfaceId || surface.surfaceId }, lookup);
    }
    const copy: Layer = {
      ...base,
      id: takeoverLayerId(surface.surfaceId),
      visible: true,
      parentGroupId: null,
      opacity: level,
      effects: [...(base.effects ?? []), ...(surface.effects ?? [])],
    };
    delete copy._showOpacityMul;
    delete copy._showParams;
    applySource(copy, surface, surface.source, feeds, ctx);
    if (index >= 0) stage = [...stage.slice(0, index), copy, ...stage.slice(index)];
    else injected.push(copy);
  }

  const top: Layer[] = [];
  if (frame.overlay && frame.overlay.level > 0) {
    const overlay: Layer = {
      ...createLayer(TAKEOVER_OVERLAY_ID, 'Live overlay', 'media'),
      opacity: Math.max(0, Math.min(1, frame.overlay.level)),
      blendMode: frame.overlay.blend,
    };
    applySource(overlay, null, frame.overlay.source, feeds, ctx);
    top.push(overlay);
  }

  if (!feeds.length && !top.length && !injected.length && stage === list) return list;
  return capTakeoverScene([...feeds, ...top, ...injected, ...stage], feedIds, ctx.maxLayers ?? SHOW_SCENE_LAYER_LIMIT);
}

/**
 * Sources for dropped media, one per engage (the frame's `key`), reused while
 * the takeover lasts so the scene's signature stays put. A video starts at
 * its beginning at the moment of the engage and loops.
 */
export class TakeoverMediaSources {
  private readonly cache = new Map<string, MediaSource | null>();

  sourceFor(surface: TakeoverSurfaceFrame): MediaSource | null {
    if (surface.source?.kind !== 'media') return null;
    const key = surface.key;
    if (this.cache.has(key)) return this.cache.get(key)!;
    const media = surface.source.media;
    const id = `takeover:${key}`;
    let source: MediaSource | null;
    if (media.kind === 'video') {
      source = {
        id,
        type: 'video',
        src: readableClipUri(media),
        name: media.name,
        _assetRef: media._assetRef,
        durationSeconds: media.sourceDuration,
        videoWidth: media.videoWidth,
        videoHeight: media.videoHeight,
        isPlaying: true,
        playbackRate: 1,
        playbackMode: 'loop',
        trimStart: 0,
        trimEnd: 1,
        _nativePlaybackTimeSeconds: 0,
        _nativePlaybackUpdatedAtMs: surface.engagedAtMs,
        _nativePlaybackSeekSeq: 1,
      } as unknown as MediaSource;
    } else {
      source = staticClipSource(media, id);
    }
    this.cache.set(key, source);
    return source;
  }

  /** Forget engages that are over. */
  retain(keys: ReadonlySet<string>): void {
    for (const k of [...this.cache.keys()]) if (!keys.has(k)) this.cache.delete(k);
  }
}
