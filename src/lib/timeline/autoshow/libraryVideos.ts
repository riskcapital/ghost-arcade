/**
 * My library for Auto show: the user's own videos (the media library) as
 * cast members, tiered by energy.
 *
 * A video's tier comes from its name or folder when that says ("drop",
 * "calm", "build"…), else from a few decoded frames: how much the picture
 * moves between them and how bright it is. Measures are cached per file for
 * the session (the most recent few hundred). A video the page cannot decode (HAP) and whose name says
 * nothing sits in the middle (groove).
 */
import type { MediaItem } from '../../stores/media';
import type { AutoShowTier, CastMember } from './catalog';

const NAME_TIERS: Array<[RegExp, AutoShowTier]> = [
  [/\b(drop|peak|hard|strobe|impact|banger|rave|heavy)\b/i, 'peak'],
  [/\b(build|rise|riser|drive|driving|fast|energy|tension)\b/i, 'drive'],
  [/\b(calm|ambient|chill|slow|intro|outro|soft|drift|still|breath(e|ing)?|pad)\b/i, 'calm'],
  [/\b(groove|loop|mid|verse|bounce|flow)\b/i, 'groove'],
];

/** A tier from a video's name or the folders it sits in, else null. */
export function tierFromName(name: string, path = ''): AutoShowTier | null {
  const words = `${path.replace(/[\\/_.-]+/g, ' ')} ${name.replace(/[_.-]+/g, ' ')}`;
  for (const [re, tier] of NAME_TIERS) if (re.test(words)) return tier;
  return null;
}

export interface VideoMeasure {
  /** Mean change between sampled frames, 0..1. */
  motion: number;
  /** Mean brightness, 0..1. */
  brightness: number;
}

/** A tier from how much a video moves and how bright it is. */
export function tierFromMeasure(m: VideoMeasure): AutoShowTier {
  const e = 0.7 * Math.min(1, m.motion / 0.12) + 0.3 * Math.min(1, m.brightness / 0.5);
  return e >= 0.75 ? 'peak' : e >= 0.5 ? 'drive' : e >= 0.25 ? 'groove' : 'calm';
}

/** Measures kept for the session, most recently used last (the oldest go first). */
export const MAX_MEASURED = 256;
/** One video's measuring stops after this (a file that never decodes). */
export const MEASURE_VIDEO_MS = 6000;
/** Videos measured at once. */
export const MEASURE_AT_ONCE = 3;
/** The whole library's measuring stops after this; the rest sit in the middle (groove). */
export const MEASURE_LIBRARY_MS = 15000;

const measured = new Map<string, VideoMeasure | null>();

function recall(src: string): VideoMeasure | null | undefined {
  if (!measured.has(src)) return undefined;
  const v = measured.get(src) ?? null;
  measured.delete(src);
  measured.set(src, v);
  return v;
}

function remember(src: string, v: VideoMeasure | null): void {
  measured.delete(src);
  measured.set(src, v);
  while (measured.size > MAX_MEASURED) measured.delete(measured.keys().next().value as string);
}

/** Test seam: how many measures are kept, and forget them all. */
export function _measuredCount(): number {
  return measured.size;
}
export function _forgetMeasures(): void {
  measured.clear();
}

/** Brightness and motion of a few tiny RGBA frames. */
export function measureFrames(samples: readonly Uint8ClampedArray[]): VideoMeasure {
  let bright = 0;
  let motion = 0;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    let b = 0;
    for (let k = 0; k < s.length; k += 4) b += (s[k] + s[k + 1] + s[k + 2]) / (3 * 255);
    bright += b / (s.length / 4);
    if (i > 0) {
      const p = samples[i - 1];
      let d = 0;
      for (let k = 0; k < s.length; k += 4) d += (Math.abs(s[k] - p[k]) + Math.abs(s[k + 1] - p[k + 1]) + Math.abs(s[k + 2] - p[k + 2])) / (3 * 255);
      motion += d / (s.length / 4);
    }
  }
  return { brightness: samples.length ? bright / samples.length : 0, motion: samples.length > 1 ? motion / (samples.length - 1) : 0 };
}

/** The bits of a video element and a 2D canvas the measuring uses (tests pass fakes). */
export interface MeasureVideoEl {
  muted: boolean;
  preload: string;
  crossOrigin: string | null;
  readonly duration: number;
  currentTime: number;
  src: string;
  onerror: ((e: unknown) => void) | null;
  onloadedmetadata: ((e: unknown) => void) | null;
  onseeked: ((e: unknown) => void) | null;
  removeAttribute(name: string): void;
  load(): void;
}
export interface MeasureCanvas {
  drawImage(video: MeasureVideoEl, x: number, y: number, w: number, h: number): void;
  getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray };
}
export interface MeasureDeps {
  video(): MeasureVideoEl;
  canvas(w: number, h: number): MeasureCanvas | null;
}

function pageDeps(): MeasureDeps | null {
  if (typeof document === 'undefined') return null;
  return {
    video: () => document.createElement('video') as unknown as MeasureVideoEl,
    canvas: (w, h) => {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      return canvas.getContext('2d', { willReadFrequently: true }) as unknown as MeasureCanvas | null;
    },
  };
}

export interface MeasureOptions {
  frames?: number;
  timeoutMs?: number;
  /** Stops the measuring (nothing is kept for the file). */
  signal?: AbortSignal;
  deps?: MeasureDeps;
}

/**
 * Decode a few frames of a video in the page and measure them (cached).
 * Always settles: on the frames, an error, the timeout or the signal, and
 * then lets go of its video element (no source, no handlers, no waits).
 */
export async function measureVideo(src: string, opts: MeasureOptions = {}): Promise<VideoMeasure | null> {
  const cached = recall(src);
  if (cached !== undefined) return cached;
  const deps = opts.deps ?? pageDeps();
  if (!deps || opts.signal?.aborted) return null;
  const frames = opts.frames ?? 5;
  const W = 32;
  const H = 18;
  const { value, keep } = await new Promise<{ value: VideoMeasure | null; keep: boolean }>((resolve) => {
    const video = deps.video();
    video.muted = true;
    video.preload = 'auto';
    video.crossOrigin = 'anonymous';
    const ctx = deps.canvas(W, H);
    let done = false;
    let wake: (() => void) | null = null;
    const finish = (v: VideoMeasure | null, keepIt = true) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      video.onerror = null;
      video.onloadedmetadata = null;
      video.onseeked = null;
      // A seek still waited on ends here, so the frame loop returns.
      const w = wake;
      wake = null;
      w?.();
      try {
        video.removeAttribute('src');
        video.load();
      } catch { /* already gone */ }
      resolve({ value: v, keep: keepIt });
    };
    const onAbort = () => finish(null, false);
    const timer = setTimeout(() => finish(null), opts.timeoutMs ?? MEASURE_VIDEO_MS);
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    video.onerror = () => finish(null);
    video.onloadedmetadata = async () => {
      if (!ctx || !(video.duration > 0)) return finish(null);
      const samples: Uint8ClampedArray[] = [];
      try {
        for (let i = 0; i < frames; i++) {
          const at = (video.duration * (i + 0.5)) / frames;
          await new Promise<void>((r) => {
            wake = r;
            video.onseeked = () => { wake = null; r(); };
            video.currentTime = at;
          });
          if (done) return;
          ctx.drawImage(video, 0, 0, W, H);
          samples.push(ctx.getImageData(0, 0, W, H).data.slice());
        }
      } catch {
        // A picture the page may not read (another origin) or a decoder that gave up.
        return finish(null);
      }
      finish(measureFrames(samples));
    };
    video.src = src;
  });
  if (keep) remember(src, value);
  return value;
}

export interface LibraryCastOptions {
  signal?: AbortSignal;
  /** Videos measured at once. */
  atOnce?: number;
  /** The whole measuring stops after this. */
  totalMs?: number;
}

/**
 * The library's videos as cast members (named tiers first, then measured).
 * Unnamed videos are measured a few at a time, and the whole measuring has a
 * time limit: what is not measured by then (or when the signal stops it)
 * sits in the middle (groove), and `complete` says so.
 */
export async function libraryCastDetailed(
  items: readonly MediaItem[],
  measure: (src: string, signal: AbortSignal) => Promise<VideoMeasure | null> = (src, signal) => measureVideo(src, { signal }),
  opts: LibraryCastOptions = {},
): Promise<{ cast: CastMember[]; complete: boolean }> {
  const entries = items
    .filter((item) => item.type === 'video' && !item.broken && !!item.src)
    .map((item) => {
      const path = (item._assetRef as { originalPath?: string } | undefined)?.originalPath ?? '';
      const named = tierFromName(item.name, path);
      // A HAP .mov the page cannot decode is not measured.
      const measurable = !named && !/\.(mov|hap)$/i.test(path || item.name);
      return { item, named, measurable, m: null as VideoMeasure | null };
    });
  const queue = entries.filter((e) => e.measurable);
  let complete = true;
  if (queue.length) {
    const stop = new AbortController();
    const onAbort = () => stop.abort();
    if (opts.signal?.aborted) stop.abort();
    else opts.signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => stop.abort(), opts.totalMs ?? MEASURE_LIBRARY_MS);
    let next = 0;
    const worker = async () => {
      while (next < queue.length && !stop.signal.aborted) {
        const e = queue[next++];
        try {
          const m = await measure(e.item.src, stop.signal);
          if (!stop.signal.aborted) e.m = m;
        } catch {
          e.m = null;
        }
      }
    };
    const stopped = new Promise<void>((r) => {
      if (stop.signal.aborted) r();
      else stop.signal.addEventListener('abort', () => r(), { once: true });
    });
    const workers = Array.from({ length: Math.max(1, Math.min(opts.atOnce ?? MEASURE_AT_ONCE, queue.length)) }, worker);
    // Settles at the time limit even when a measure never does.
    await Promise.race([Promise.all(workers), stopped]);
    complete = !stop.signal.aborted;
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
    stop.abort();
  }
  const cast = entries.map(({ item, named, m }): CastMember => {
    const tier: AutoShowTier = named ?? (m ? tierFromMeasure(m) : 'groove');
    const tiers: AutoShowTier[] = tier === 'calm' ? ['calm', 'groove'] : tier === 'peak' ? ['peak', 'drive'] : [tier];
    return {
      id: `library:${item.id}`,
      kind: 'video',
      ref: item.id,
      name: item.name.replace(/\.[a-z0-9]+$/i, ''),
      tiers,
      texture: 'organic',
      scale: ['piece', 'span'],
      params: {},
      paramsFor: () => ({}),
      video: { src: item.src, assetRef: item._assetRef, seconds: item.durationSeconds, width: item.videoWidth, height: item.videoHeight },
      cost: 'mid',
    };
  });
  return { cast, complete };
}

/** The library's videos as cast members (see libraryCastDetailed). */
export async function libraryCast(
  items: readonly MediaItem[],
  measure?: (src: string, signal: AbortSignal) => Promise<VideoMeasure | null>,
  opts: LibraryCastOptions = {},
): Promise<CastMember[]> {
  return (await libraryCastDetailed(items, measure, opts)).cast;
}
