/**
 * What the output window needs, beyond the project, to show what the editor
 * shows: where the layer sequencer and the keyframe timeline are, the Show
 * timeline's transition, and where each video is.
 *
 * The standard output window (used when the zero-copy one cannot start, or
 * when zero-copy is off) renders the project itself from the synced state.
 * That state carried the layers but not the transports, and every project
 * import stopped the window's own copy of the sequencer, so the output
 * ignored the Sequencer and keyframes and showed every layer at once. Its
 * videos also started from zero on every import and then drifted.
 *
 * Everything here is plain data in, plain data out, so it can be tested
 * without windows; stateBroadcast.ts sends and applies it.
 */

/** Runtime state of the layer sequencer and keyframe timeline, as the editor has it. */
export interface PlaybackStatePayload {
  seq: {
    isPlaying: boolean;
    currentStep: number;
    opacityOverrides: Record<string, number>;
  };
  kf: {
    isPlaying: boolean;
    currentTime: number;
    activeOverrides: Record<string, Record<string, number | boolean>>;
  };
}

type SeqLike = { isPlaying: boolean; currentStep: number; opacityOverrides: Record<string, number> };
type KfLike = {
  config: { isPlaying: boolean; currentTime: number };
  activeOverrides: Record<string, Record<string, number | boolean>>;
};

export function buildPlaybackState(seq: SeqLike, kf: KfLike): PlaybackStatePayload {
  return {
    seq: {
      isPlaying: !!seq.isPlaying,
      currentStep: Number.isFinite(seq.currentStep) ? seq.currentStep : 0,
      opacityOverrides: { ...(seq.opacityOverrides ?? {}) },
    },
    kf: {
      isPlaying: !!kf.config?.isPlaying,
      currentTime: Number.isFinite(kf.config?.currentTime) ? kf.config.currentTime : 0,
      // Only applied while playing (Canvas reads overrides only then), so a
      // paused timeline does not ship its whole override map.
      activeOverrides: kf.config?.isPlaying ? (kf.activeOverrides ?? {}) : {},
    },
  };
}

/**
 * Identity of a playback state for change detection. The keyframe playhead
 * is left out while nothing is keyframed: it moves every frame and changes
 * nothing on screen.
 */
export function playbackSignature(state: PlaybackStatePayload): string {
  const kfHasOverrides = Object.keys(state.kf.activeOverrides).length > 0;
  return JSON.stringify({
    seq: state.seq,
    kf: {
      isPlaying: state.kf.isPlaying,
      activeOverrides: state.kf.activeOverrides,
      ...(kfHasOverrides ? { currentTime: state.kf.currentTime } : {}),
    },
  });
}

// ─── Video clocks ──────────────────────────────────────────────────────

/** Where one layer's video is in the editor, sampled at `sentAt` (ms, Date.now()). */
export interface VideoClockSample {
  id: string;
  time: number;
  rate: number;
  paused: boolean;
  sentAt: number;
}

type VideoLayerLike = {
  id: string;
  source?: {
    type?: string;
    videoElement?: { currentTime: number; playbackRate: number; paused: boolean; readyState: number } | null;
  } | null;
};

/** Samples for every layer whose video has loaded. */
export function sampleVideoClocks(layers: VideoLayerLike[], nowMs: number): VideoClockSample[] {
  const out: VideoClockSample[] = [];
  for (const layer of layers) {
    const el = layer.source?.type === 'video' ? layer.source.videoElement : null;
    if (!el || el.readyState < 1 || !Number.isFinite(el.currentTime)) continue;
    out.push({
      id: layer.id,
      time: el.currentTime,
      rate: Number.isFinite(el.playbackRate) && el.playbackRate > 0 ? el.playbackRate : 1,
      paused: !!el.paused,
      sentAt: nowMs,
    });
  }
  return out;
}

/** Past this much difference the output's video is moved to the editor's time. */
export const VIDEO_CLOCK_SEEK_SECONDS = 0.1;
/** Give a seek time to land before judging the video again. */
export const VIDEO_CLOCK_COOLDOWN_MS = 1000;
/** Samples older than this are not extrapolated from (a stalled channel). */
export const VIDEO_CLOCK_MAX_AGE_MS = 1500;

export interface VideoClockCheck {
  sample: VideoClockSample;
  nowMs: number;
  /** The output's own element. */
  elementTime: number;
  seeking: boolean;
  /** Playable range in seconds (trim in/out); the video loops within it. */
  rangeStart: number;
  rangeEnd: number;
  /** When this element was last moved, ms; null if never. */
  lastSeekAtMs: number | null;
}

/** Where the editor's video is now, wrapped into the playable range. */
export function expectedVideoTime(sample: VideoClockSample, nowMs: number, rangeStart: number, rangeEnd: number): number {
  const elapsed = sample.paused ? 0 : Math.max(0, (nowMs - sample.sentAt) / 1000) * sample.rate;
  let t = sample.time + elapsed;
  const length = rangeEnd - rangeStart;
  if (length > 0 && t >= rangeEnd) t = rangeStart + ((t - rangeStart) % length);
  return t;
}

/**
 * The time to move the output's video to, or null to leave it alone.
 *
 * Measured as a distance around the loop, so a video that has just wrapped
 * back to the start is not "a whole loop behind" an editor that has not yet.
 */
export function videoClockSeekTarget(check: VideoClockCheck): number | null {
  const { sample, nowMs } = check;
  if (check.seeking) return null;
  if (nowMs - sample.sentAt > VIDEO_CLOCK_MAX_AGE_MS) return null;
  if (check.lastSeekAtMs != null && nowMs - check.lastSeekAtMs < VIDEO_CLOCK_COOLDOWN_MS) return null;
  if (!Number.isFinite(check.elementTime)) return null;
  const expected = expectedVideoTime(sample, nowMs, check.rangeStart, check.rangeEnd);
  let drift = check.elementTime - expected;
  const length = check.rangeEnd - check.rangeStart;
  if (length > 0) {
    drift = ((drift % length) + length) % length;
    if (drift > length / 2) drift -= length;
  }
  return Math.abs(drift) > VIDEO_CLOCK_SEEK_SECONDS ? expected : null;
}

// ─── Reusing live video elements across imports ──────────────────────────

/** The live video a layer has now, by layer id. */
export interface LiveVideo<E> {
  element: E;
  src: string;
  isPlaying?: boolean;
}

type SourceWithVideo<E> = { type?: string; src?: string; videoElement?: E | null; isPlaying?: boolean };

export function collectLiveVideos<E>(layers: Array<{ id: string; source?: SourceWithVideo<E> | null }>): Map<string, LiveVideo<E>> {
  const live = new Map<string, LiveVideo<E>>();
  for (const layer of layers) {
    const source = layer.source;
    if (source?.type !== 'video' || !source.videoElement || !source.src) continue;
    live.set(layer.id, { element: source.videoElement, src: source.src, isPlaying: source.isPlaying });
  }
  return live;
}

/**
 * Give an imported layer the video element it already plays, when it is the
 * same layer showing the same file. Returns the element it adopted.
 */
export function adoptLiveVideo<E>(
  layerId: string,
  source: SourceWithVideo<E> | null | undefined,
  live: Map<string, LiveVideo<E>>,
): E | null {
  if (!source || source.type !== 'video' || source.videoElement || !source.src) return null;
  const prev = live.get(layerId);
  if (!prev || prev.src !== source.src) return null;
  source.videoElement = prev.element;
  if (source.isPlaying === undefined) source.isPlaying = prev.isPlaying;
  return prev.element;
}

/** Elements no imported layer adopted. */
export function unadoptedVideos<E>(live: Map<string, LiveVideo<E>>, adopted: Set<E>): E[] {
  const out: E[] = [];
  for (const { element } of live.values()) {
    if (!adopted.has(element) && !out.includes(element)) out.push(element);
  }
  return out;
}
