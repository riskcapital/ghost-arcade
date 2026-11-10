/**
 * The media source a show clip puts on its layer, with the native playback
 * anchor that makes video land on the right frame.
 *
 * The core free-runs a video from an anchor: (media time M at render clock
 * C, seek generation G). A new anchor means a seek, so anchors are written
 * only when the picture really has to jump:
 *   - a run starts (a run is a chain of clips sharing one decoder: a split
 *     plays straight through);
 *   - the show's seek generation changes (a scrub, a jump, a loop wrap);
 *   - playback pauses or resumes (a held end pauses too). Pause/resume does
 *     not bump the core's seek generation, the convention midiRouter uses.
 * Between those the anchor is left alone and the phase follower
 * (showVideoPhase.ts) absorbs drift with tiny speed corrections.
 *
 * Under an offline render the show's seek generation moves every frame, so
 * there the anchor is replaced only when the decoder's predicted position
 * would be more than half a frame off.
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
/** Manual clock: re-anchor past half of a 60 fps frame. */
export const SHOW_MANUAL_REANCHOR_SECONDS = 0.5 / 60;
/** A pre-rolled session is taken over as it is when the clip binds this
 *  close after the pre-roll's time (the phase follower absorbs the rest);
 *  anything else is a real seek and needs a generation of its own, or the
 *  core keeps showing the pre-rolled frame. */
export const SHOW_PREROLL_CONTINUE_SECONDS = 0.1;

export function showSourceId(runId: string): string {
  return SHOW_SOURCE_PREFIX + runId;
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

  constructor(opts: ShowClipSourceOptions = {}) {
    this.now = opts.now ?? (() => performance.now());
  }

  /** The source for a track's clip in `frame`, or null when the clip shows
   *  the layer's own content (or there is no clip). */
  sourceFor(state: ShowTrackState, frame: ShowTrackFrame): MediaSource | null {
    const clip = state.clip;
    if (!clip || clip.media.kind === 'layer') {
      this.anchors.delete(state.trackId);
      return null;
    }
    if (clip.media.kind !== 'video') {
      this.anchors.delete(state.trackId);
      return this.staticSource(clip.runId, clip.media);
    }
    return this.videoSource(state.trackId, clip, frame);
  }

  /** The source an upcoming shader or sketch clip will have once it starts:
   *  the same object, so the warmed program is the one that goes live. */
  warmSourceFor(warm: { runId: string; media: ShowClipMedia }): MediaSource | null {
    return this.staticSource(warm.runId, warm.media);
  }

  private staticSource(runId: string, media: ShowClipMedia): MediaSource | null {
    const id = showSourceId(runId);
    const cached = this.statics.get(id);
    if (cached && cached.media === media) return cached.source;
    const source = staticClipSource(media, id);
    if (source) this.statics.set(id, { media, source });
    return source;
  }

  private videoSource(trackId: string, clip: ShowTrackClipState, frame: ShowTrackFrame): MediaSource {
    const sourceId = showSourceId(clip.runId);
    const prev = this.anchors.get(trackId);
    const duration = clip.media.sourceDuration;
    const uri = readableClipUri(clip.media);
    const sameRun = !!prev && prev.sourceId === sourceId && prev.src === uri;
    let reanchor = !sameRun || prev!.paused !== clip.paused || Math.abs(prev!.rate - clip.rate) > 1e-9;
    if (!reanchor && prev!.showSeekGeneration !== frame.seekGeneration) {
      if (frame.manualClock) {
        const predicted = predictedMediaTime(prev!, frame.time);
        reanchor = Math.abs(predicted - clip.mediaTime) > SHOW_MANUAL_REANCHOR_SECONDS;
        if (!reanchor) prev!.showSeekGeneration = frame.seekGeneration;
      } else {
        reanchor = true;
      }
    }
    if (!reanchor) return prev!.source;

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

  /** Forget tracks that are gone. */
  retain(trackIds: ReadonlySet<string>): void {
    for (const id of [...this.anchors.keys()]) if (!trackIds.has(id)) this.anchors.delete(id);
    if (this.statics.size > 256) this.statics.clear();
  }

  clear(): void {
    this.anchors.clear();
    this.statics.clear();
  }
}
