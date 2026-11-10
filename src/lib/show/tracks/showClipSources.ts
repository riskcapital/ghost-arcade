/**
 * The media source a show clip puts on its layer, with the native playback
 * anchor that makes video land on the right frame.
 *
 * The core free-runs a video from an anchor: (media time M at render clock
 * C, seek generation G). A new anchor means a seek, so anchors are written
 * only when the picture really has to jump:
 *   - a run starts (a run is a chain of clips sharing one decoder: a split
 *     plays straight through);
 *   - the show's seek generation changes (a scrub, a jump); a loop wrap
 *     that leaves the video where its decoder already is keeps the anchor;
 *   - playback pauses or resumes (a held end pauses too). A pause seeks the
 *     decoder to the exact paused frame. A resume from where the decoder
 *     was paused keeps its seek generation, the convention midiRouter uses:
 *     the core then carries on decoding instead of seeking, which on a
 *     long-GOP file means no hitch.
 *   - the decoder drifted more than two frames off (see `reanchor`).
 * Between those the anchor is left alone and the phase follower
 * (showVideoPhase.ts) absorbs drift with tiny speed corrections.
 *
 * Under an offline render the show's seek generation moves every frame, so
 * there the anchor is replaced only when the decoder's predicted position
 * would be more than half a frame off.
 *
 * A shader clip runs on its own time too: its TIME is the clip's media time
 * (`inPoint + (t - start) × rate`), still while the show is paused, so a
 * scrub, live play and an export show the same picture. Its anchor goes out
 * as `_nativeShaderTime` and is replaced on the same occasions as a video's
 * (a shader has no decoder to seek, so that costs nothing).
 *
 * Sources always go out looping, trimmed to [loop start, media end), because
 * the core's phase follower only works on looping sources. 'stop' and 'hold'
 * clips pause one frame before the end instead (see showTrackEval).
 *
 * Source objects are reused while nothing changes, so the native sync sees
 * the same signature every frame and sends nothing.
 */
import type { MediaSource, ShowClipMedia } from '../../types';
import { resolveAssetRefForRuntime } from '../../storage/assetRegistry';
import type { ShowTrackClipState, ShowTrackFrame, ShowTrackState } from './showTrackEval';

export const SHOW_SOURCE_PREFIX = 'show:';
/** Anchor key of a track's crossfade helper (showTrackScene's suffix). */
const XFADE_KEY_SUFFIX = '::xf';
/** Manual clock: re-anchor past half of a 60 fps frame. */
export const SHOW_MANUAL_REANCHOR_SECONDS = 0.5 / 60;
/** A pre-rolled session is taken over as it is when the clip binds this
 *  close after the pre-roll's time (the phase follower absorbs the rest);
 *  anything else is a real seek and needs a generation of its own, or the
 *  core keeps showing the pre-rolled frame. */
export const SHOW_PREROLL_CONTINUE_SECONDS = 0.1;
/** A loop wrap keeps a video's anchor when its decoder, carried on through
 *  the wrap, lands this close to where the clip is after it. */
export const SHOW_WRAP_CONTINUE_SECONDS = 1e-3;

export function showSourceId(runId: string): string {
  return SHOW_SOURCE_PREFIX + runId;
}

/** Anchor key of a track's crossfade helper. */
export function xfadeAnchorKey(trackId: string): string {
  return trackId + XFADE_KEY_SUFFIX;
}

/**
 * A URL the core's decoder can read for clip media: the file the AssetRef
 * names when there is one (a blob: URL from a drop is not readable), the
 * runtime URL otherwise. Video sources carry this as `src`, so the playback,
 * phase and prefetch commands all name the same URI.
 */
export function readableClipUri(media: ShowClipMedia): string {
  return resolveAssetRefForRuntime(media._assetRef, undefined, media.src) ?? media.src;
}

/** Where the decoder will be at show time `t` given an anchor, wrapped like
 *  the core wraps a looping, trimmed source. */
export function predictedMediaTime(
  anchor: { mediaTime: number; showTime: number; paused: boolean; rate: number; loopStart: number; duration?: number },
  t: number,
): number {
  if (anchor.paused) return anchor.mediaTime;
  const raw = anchor.mediaTime + (t - anchor.showTime) * anchor.rate;
  const end = Number(anchor.duration);
  if (!(end > 0) || raw < end) return raw;
  const span = end - anchor.loopStart;
  return span > 0 ? anchor.loopStart + ((raw - anchor.loopStart) % span) : raw;
}

export interface ShowClipAnchor {
  sourceId: string;
  src: string;
  runId: string;
  mediaTime: number;
  showTime: number;
  paused: boolean;
  rate: number;
  loopStart: number;
  duration?: number;
  showSeekGeneration: number;
  nativeSeekSeq: number;
  source: MediaSource;
}

interface ShowShaderAnchor {
  /** The clip's source without the anchor (the static source). */
  base: MediaSource;
  /** The shader's time at show time `showTime`. */
  seconds: number;
  showTime: number;
  rate: number;
  paused: boolean;
  generation: number;
  /** Anchored on the export clock. */
  manual: boolean;
  source: MediaSource;
}

export interface ShowClipSourceOptions {
  /** performance.now() replacement for tests. */
  now?: () => number;
}

/** Called when a paused scrub should go through the native scrubber
 *  instead of a plain re-anchor. Returns true when it took the seek. */
export type ShowScrubHandler = (
  trackId: string,
  source: MediaSource,
  mediaTime: number,
  commit: (fields: Pick<MediaSource, '_nativePlaybackTimeSeconds' | '_nativePlaybackUpdatedAtMs' | '_nativePlaybackSeekSeq'>) => void,
) => boolean;

export function staticClipSource(media: ShowClipMedia, sourceId: string): MediaSource | null {
  switch (media.kind) {
    case 'image':
      return { id: sourceId, type: 'image', src: readableClipUri(media), name: media.name, _assetRef: media._assetRef } as MediaSource;
    case 'shader':
      return {
        id: sourceId,
        type: 'shader',
        src: media.src,
        name: media.name,
        shaderCode: media.shaderCode,
        shaderInputs: media.shaderInputs,
        shaderValues: { ...(media.shaderValues ?? {}) },
        shaderImageInputs: media.shaderImageInputs,
      } as MediaSource;
    case 'sketch':
      if (!media.jsAnimation) return null;
      return {
        id: sourceId,
        type: media.jsAnimation.animationType,
        src: 'js-animation',
        name: media.name,
        jsAnimation: { ...media.jsAnimation },
      } as MediaSource;
    default:
      return null;
  }
}

export class ShowClipSources {
  private readonly anchors = new Map<string, ShowClipAnchor>();
  /** Last native seek sequence used per source id, so a source that comes
   *  back (a seek back into a run) always moves forward. */
  private readonly seekSeq = new Map<string, number>();
  private readonly statics = new Map<string, { media: ShowClipMedia; source: MediaSource }>();
  private readonly now: () => number;
  scrubHandler: ShowScrubHandler | null = null;
  /** Called after a scrub commit changed a source (republish the scene). */
  onSourceChanged: (() => void) | null = null;
  /** Called when a track's video is re-anchored directly, so a scrub still
   *  waiting to go out cannot land after it and undo it. */
  onReanchor: ((trackId: string) => void) | null = null;
  /** Pre-rolls sent per source id: the generation and media time. */
  private readonly prerolls = new Map<string, { generation: number; time: number }>();
  /** Anchor keys whose decoder drifted off: re-anchored on their next ask. */
  private readonly stale = new Set<string>();
  /** Shader clips' time anchors, by the same keys as `anchors`. */
  private readonly shaderAnchors = new Map<string, ShowShaderAnchor>();
  private shaderAnchorSeq = 0;

  constructor(opts: ShowClipSourceOptions = {}) {
    this.now = opts.now ?? (() => performance.now());
  }

  /** The source for a track's clip in `frame`, or null when the clip shows
   *  the layer's own content (or there is no clip). */
  sourceFor(state: ShowTrackState, frame: ShowTrackFrame): MediaSource | null {
    // A crossfade that ended leaves no helper anchor behind: the next pass
    // through it hands the playing run over again instead of seeking.
    if (!state.xfade) this.anchors.delete(state.trackId + XFADE_KEY_SUFFIX);
    const clip = state.clip;
    if (!clip || clip.media.kind === 'layer') {
      this.anchors.delete(state.trackId);
      this.shaderAnchors.delete(state.trackId);
      return null;
    }
    if (clip.media.kind === 'shader') {
      this.anchors.delete(state.trackId);
      return this.shaderSource(state.trackId, clip, frame);
    }
    this.shaderAnchors.delete(state.trackId);
    if (clip.media.kind !== 'video') {
      this.anchors.delete(state.trackId);
      return this.staticSource(clip.runId, clip.media);
    }
    return this.videoSource(state.trackId, clip, frame);
  }

  /**
   * The outgoing clip's source in a crossfade, for the helper copy beneath
   * the layer. Its anchor is kept under its own key; when the crossfade
   * begins, the run that was playing on the track is handed over as it is,
   * so the outgoing video carries on without a seek. Call it before
   * `sourceFor` for the same frame.
   */
  xfadeSourceFor(state: ShowTrackState, frame: ShowTrackFrame): MediaSource | null {
    const xf = state.xfade;
    const key = state.trackId + XFADE_KEY_SUFFIX;
    if (!xf || xf.clip.media.kind === 'layer') {
      this.anchors.delete(key);
      this.shaderAnchors.delete(key);
      return null;
    }
    if (xf.clip.media.kind === 'shader') {
      this.anchors.delete(key);
      return this.shaderSource(key, xf.clip, frame, state.trackId);
    }
    this.shaderAnchors.delete(key);
    if (xf.clip.media.kind !== 'video') {
      this.anchors.delete(key);
      return this.staticSource(xf.clip.runId, xf.clip.media);
    }
    return this.videoSource(key, xf.clip, frame, state.trackId);
  }

  /** The source an upcoming shader or sketch clip will have once it starts:
   *  the same object, so the warmed program is the one that goes live. */
  warmSourceFor(warm: { runId: string; media: ShowClipMedia }): MediaSource | null {
    return this.staticSource(warm.runId, warm.media);
  }

  /**
   * A shader clip's source with its time anchor. Kept while the shader's
   * time carries on as predicted; replaced (a new anchor) when the run, the
   * pause state or the speed changes, or a seek moved the clip's time.
   */
  private shaderSource(key: string, clip: ShowTrackClipState, frame: ShowTrackFrame, handOverFrom?: string): MediaSource | null {
    const base = this.staticSource(clip.runId, clip.media);
    if (!base) return null;
    let prev = this.shaderAnchors.get(key);
    if (handOverFrom && (!prev || prev.base !== base)) {
      const playing = this.shaderAnchors.get(handOverFrom);
      if (playing && playing.base === base) {
        prev = playing;
        this.shaderAnchors.set(key, playing);
      }
    }
    // An anchor on the live clock means nothing on the export clock (and
    // back): a render starting or ending re-anchors.
    const same = !!prev && prev.base === base && prev.paused === clip.paused && Math.abs(prev.rate - clip.rate) <= 1e-9
      && prev.manual === frame.manualClock;
    let reanchor = !same;
    if (!reanchor && prev!.generation !== frame.seekGeneration) {
      // The core runs a shader's time on from its anchor by its own clock.
      // That follows the show through an export frame (the render clock is
      // show time there) and through a loop wrap; any other jump re-anchors.
      const wrap = frame.wrap && frame.wrap.fromGeneration === prev!.generation ? frame.wrap : null;
      const shift = wrap ? wrap.shift : 0;
      const predicted = prev!.paused ? prev!.seconds : prev!.seconds + (frame.time + shift - prev!.showTime) * prev!.rate;
      reanchor = !(frame.manualClock || wrap) || Math.abs(predicted - clip.mediaTime) > SHOW_MANUAL_REANCHOR_SECONDS;
      if (!reanchor) {
        prev!.showTime -= shift;
        prev!.generation = frame.seekGeneration;
      }
    }
    if (!reanchor) return prev!.source;
    const seconds = Math.max(0, clip.mediaTime);
    const source = {
      ...base,
      _nativeShaderTime: { seconds, rate: clip.rate, paused: clip.paused, seq: ++this.shaderAnchorSeq },
    } as MediaSource;
    this.shaderAnchors.set(key, {
      base, seconds, showTime: frame.time, rate: clip.rate, paused: clip.paused, generation: frame.seekGeneration,
      manual: frame.manualClock, source,
    });
    return source;
  }

  private staticSource(runId: string, media: ShowClipMedia): MediaSource | null {
    const id = showSourceId(runId);
    const cached = this.statics.get(id);
    if (cached && cached.media === media) return cached.source;
    const source = staticClipSource(media, id);
    if (source) this.statics.set(id, { media, source });
    return source;
  }

  private videoSource(trackId: string, clip: ShowTrackClipState, frame: ShowTrackFrame, handOverFrom?: string): MediaSource {
    const sourceId = showSourceId(clip.runId);
    let prev = this.anchors.get(trackId);
    const duration = clip.media.sourceDuration;
    const uri = readableClipUri(clip.media);
    if (handOverFrom && (!prev || prev.sourceId !== sourceId || prev.src !== uri)) {
      const playing = this.anchors.get(handOverFrom);
      if (playing && playing.sourceId === sourceId && playing.src === uri) {
        prev = playing;
        this.anchors.set(trackId, playing);
      }
    }
    const sameRun = !!prev && prev.sourceId === sourceId && prev.src === uri;
    const drifted = this.stale.delete(trackId);
    const sameRate = sameRun && Math.abs(prev!.rate - clip.rate) <= 1e-9;
    // A length found after the clip started (see showClipLength) re-trims it.
    let reanchor = !sameRun || drifted || prev!.paused !== clip.paused || !sameRate || prev!.duration !== duration;
    if (!reanchor && prev!.showSeekGeneration !== frame.seekGeneration) {
      if (frame.manualClock) {
        const predicted = predictedMediaTime(prev!, frame.time);
        reanchor = Math.abs(predicted - clip.mediaTime) > SHOW_MANUAL_REANCHOR_SECONDS;
        if (!reanchor) prev!.showSeekGeneration = frame.seekGeneration;
      } else if (frame.wrap && frame.wrap.fromGeneration === prev!.showSeekGeneration && !clip.paused) {
        // A loop wrap: show time went back by `shift`, the decoder did not.
        // When it lands where the clip is after the wrap, carry on.
        const predicted = predictedMediaTime(prev!, frame.time + frame.wrap.shift);
        reanchor = Math.abs(predicted - clip.mediaTime) > SHOW_WRAP_CONTINUE_SECONDS;
        if (!reanchor) {
          prev!.showTime -= frame.wrap.shift;
          prev!.showSeekGeneration = frame.seekGeneration;
        }
      } else {
        reanchor = true;
      }
    }
    if (!reanchor) return prev!.source;

    // A resume from where the decoder was paused: same generation, so the
    // core carries on decoding from its paused frame instead of seeking.
    if (sameRate && !drifted && prev!.paused && !clip.paused
      && (this.seekSeq.get(sourceId) ?? 0) === prev!.nativeSeekSeq
      && Math.abs(clip.mediaTime - prev!.mediaTime) <= SHOW_PREROLL_CONTINUE_SECONDS) {
      this.onReanchor?.(trackId);
      return this.anchorSource(trackId, clip, frame, prev!.nativeSeekSeq, duration, uri);
    }

    // A scrub while paused: let the native scrubber pace the seeks (one in
    // flight, latest wins) instead of a new anchor on every pointer move.
    if (sameRun && prev!.paused && clip.paused && this.scrubHandler) {
      const anchor = prev!;
      anchor.showSeekGeneration = frame.seekGeneration;
      const taken = this.scrubHandler(trackId, anchor.source, clip.mediaTime, (fields) => {
        const generation = Number(fields._nativePlaybackSeekSeq) || 0;
        // Whatever happens to the anchor, later seeks must move past this one.
        this.seekSeq.set(sourceId, Math.max(this.seekSeq.get(sourceId) ?? 0, generation));
        if (this.anchors.get(trackId) !== anchor) return;
        anchor.mediaTime = Number(fields._nativePlaybackTimeSeconds) || 0;
        anchor.showTime = frame.time;
        anchor.nativeSeekSeq = generation || anchor.nativeSeekSeq;
        anchor.source = { ...anchor.source, ...fields };
        this.onSourceChanged?.();
      });
      if (taken) return anchor.source;
    }

    let nativeSeekSeq = (this.seekSeq.get(sourceId) ?? 0) + 1;
    const preroll = this.prerolls.get(sourceId);
    if (preroll && preroll.generation === nativeSeekSeq) {
      const ahead = clip.mediaTime - preroll.time;
      if (!(ahead >= -1e-6 && ahead <= SHOW_PREROLL_CONTINUE_SECONDS)) nativeSeekSeq += 1;
    }
    this.prerolls.delete(sourceId);
    this.seekSeq.set(sourceId, nativeSeekSeq);
    this.onReanchor?.(trackId);
    return this.anchorSource(trackId, clip, frame, nativeSeekSeq, duration, uri);
  }

  /** A new anchor (and source) for `trackId` at the clip's media time. */
  private anchorSource(
    trackId: string,
    clip: ShowTrackClipState,
    frame: ShowTrackFrame,
    nativeSeekSeq: number,
    duration: number | undefined,
    uri: string,
  ): MediaSource {
    const sourceId = showSourceId(clip.runId);
    const trimStart = duration && duration > 0 ? Math.max(0, Math.min(1, clip.loopStart / duration)) : 0;
    const source = {
      id: sourceId,
      type: 'video',
      src: uri,
      name: clip.media.name,
      _assetRef: clip.media._assetRef,
      durationSeconds: duration,
      videoWidth: clip.media.videoWidth,
      videoHeight: clip.media.videoHeight,
      isPlaying: !clip.paused,
      playbackRate: clip.rate,
      playbackMode: 'loop',
      trimStart,
      trimEnd: 1,
      _nativePlaybackTimeSeconds: Math.max(0, clip.mediaTime),
      _nativePlaybackUpdatedAtMs: this.now(),
      _nativePlaybackSeekSeq: nativeSeekSeq,
    } as MediaSource;
    this.anchors.set(trackId, {
      sourceId,
      src: uri,
      runId: clip.runId,
      mediaTime: clip.mediaTime,
      showTime: frame.time,
      paused: clip.paused,
      rate: clip.rate,
      loopStart: clip.loopStart,
      duration,
      showSeekGeneration: frame.seekGeneration,
      nativeSeekSeq,
      source,
    });
    return source;
  }

  /** The native seek generation a source will be bound with next: what a
   *  pre-roll for it must use so the core hands that session over. */
  nextSeekSeqFor(sourceId: string): number {
    return (this.seekSeq.get(sourceId) ?? 0) + 1;
  }

  /** A pre-roll went out for `sourceId` at `generation`, paused at `time`. */
  notePreroll(sourceId: string, generation: number, time: number): void {
    this.prerolls.set(sourceId, { generation, time });
    if (this.prerolls.size > 64) this.prerolls.delete(this.prerolls.keys().next().value as string);
  }

  /** The anchor a track's video runs from (phase follower, tests). */
  anchorFor(trackId: string): Readonly<ShowClipAnchor> | null {
    return this.anchors.get(trackId) ?? null;
  }

  /** Expected media time for a track's video at show time `t`. */
  expectedMediaTime(trackId: string, t: number): number | null {
    const a = this.anchors.get(trackId);
    return a ? predictedMediaTime(a, t) : null;
  }

  /** The anchor of a crossfade's outgoing clip on a track. */
  xfadeAnchorFor(trackId: string): Readonly<ShowClipAnchor> | null {
    return this.anchors.get(trackId + XFADE_KEY_SUFFIX) ?? null;
  }

  /**
   * The decoder behind an anchor (`trackId`, or `xfadeKey(trackId)` for a
   * crossfade's outgoing clip) drifted off: its next source is a fresh
   * anchor at the clip's media time, under a new seek generation.
   */
  reanchor(key: string): void {
    if (this.anchors.has(key)) this.stale.add(key);
  }

  /** Every anchor, by key (the drift check). */
  anchorEntries(): Array<[string, Readonly<ShowClipAnchor>]> {
    return [...this.anchors.entries()];
  }

  /** Forget tracks that are gone. */
  retain(trackIds: ReadonlySet<string>): void {
    for (const id of [...this.anchors.keys()]) if (!trackIds.has(id)) this.anchors.delete(id);
    for (const id of [...this.shaderAnchors.keys()]) if (!trackIds.has(id)) this.shaderAnchors.delete(id);
    for (const id of [...this.stale]) if (!this.anchors.has(id)) this.stale.delete(id);
    if (this.statics.size > 256) this.statics.clear();
  }

  /** Keep the anchors `frame` still uses: one per track, and a helper's
   *  only while its track is inside a crossfade. */
  retainFrame(frame: ShowTrackFrame | null): void {
    const keep = new Set<string>();
    for (const state of frame?.tracks ?? []) {
      keep.add(state.trackId);
      if (state.xfade) keep.add(state.trackId + XFADE_KEY_SUFFIX);
    }
    this.retain(keep);
  }

  /** Forget every anchor and source (another show was loaded or the show
   *  was cleared). Seek generations are kept, so a source that comes back
   *  still moves forward. */
  clear(): void {
    this.anchors.clear();
    this.shaderAnchors.clear();
    this.statics.clear();
    this.stale.clear();
  }
}
