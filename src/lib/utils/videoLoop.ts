/**
 * Video Loop Creator
 *
 * Creates seamless loops using the "cross dissolve" technique:
 * 1. Treat the same input file as two virtual inputs.
 * 2. Trim [0:v]: midpoint → end  (becomes the start of the loop).
 * 3. Trim [1:v]: 0 → midpoint    (becomes the end of the loop).
 * 4. xfade at the junction.
 *
 * Why this works: when the original video is played in a loop the
 * abrupt cut happens at duration→0. By swapping halves the cut moves
 * to the midpoint where we crossfade smoothly — and the new
 * start/end land at the original midpoint frame which already
 * matches itself.
 *
 * History notes (read before changing):
 * - Earlier revisions of this module had two persistent bugs the
 *   user reported as "weird long decimal percentages" + "never
 *   completes":
 *     1. ffmpeg.on('progress', cb) was attached inside the singleton
 *        init() and only routed to the *first* caller's onProgress.
 *        Subsequent calls saw no progress events at all — the bar
 *        sat at the last value from the prior call, including stale
 *        99%-or-greater readings.
 *     2. FFmpeg's progress event for filter_complex+xfade is known
 *        to overshoot 1.0 (it computes against input PTS not output
 *        PTS). Math.round(1.85 * 100) → "185%". UI showed garbage.
 * - HTML video duration detection is also unreliable for some
 *   container/codec combos (Chrome reports Infinity for streamed
 *   WebM, certain MP4s lack moov atoms until seek-to-end). We now
 *   probe via FFmpeg first; HTML probe is fallback-only.
 */

import type { FFmpeg as FFmpegType } from '@ffmpeg/ffmpeg';
import { invoke, isDesktopApp } from '$lib/bridge';
import { pathToFileUrl } from '../storage/assetRegistry';
// Vendor FFmpeg core locally — Vite ?url imports emit the files
// into the bundle and give us same-origin URLs. Loading from a
// CDN failed under Electron's renderer CSP / file:// origin,
// surfacing as "Failed to create loop" the moment the user
// tried it (which is what the user reported with a screenshot).
// Use the package's declared subpath exports — `.` resolves to
// ffmpeg-core.js, `./wasm` to ffmpeg-core.wasm. Deep ./dist/**
// paths aren't whitelisted in the package's `exports` field so
// Vite refuses to resolve them.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — Vite ?url query has no .d.ts
import ffmpegCoreUrl from '@ffmpeg/core?url';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import ffmpegWasmUrl from '@ffmpeg/core/wasm?url';

let ffmpeg: FFmpegType | null = null;
let ffmpegLoaded = false;
let ffmpegLoading = false;

export interface LoopProgress {
  stage: 'loading' | 'processing' | 'rendering' | 'complete' | 'error';
  /** 0..1, always clamped — safe to multiply by 100 directly. */
  progress: number;
  message: string;
}

export type ProgressCallback = (progress: LoopProgress) => void;

export interface LoopCreateResult {
  url: string;
  outputPath?: string;
  size?: number;
  duration?: number;
  transitionApplied?: LoopTransitionType;
}

export interface NativeLoopOptions {
  inputPath?: string | null;
  inputName?: string;
  outputName?: string;
  width?: number;
  height?: number;
}

export type LoopTransitionType =
  | 'fade'
  | 'dissolve'
  | 'pixelize'
  | 'rectcrop'
  | 'distance'
  | 'fadeblack'
  | 'fadewhite'
  | 'fadegrays'
  | 'fadefast'
  | 'fadeslow'
  | 'wipeleft'
  | 'wiperight'
  | 'wipeup'
  | 'wipedown'
  | 'wipetl'
  | 'wipetr'
  | 'wipebl'
  | 'wipebr'
  | 'slideleft'
  | 'slideright'
  | 'slideup'
  | 'slidedown'
  | 'smoothleft'
  | 'smoothright'
  | 'smoothup'
  | 'smoothdown'
  | 'circlecrop'
  | 'circleclose'
  | 'circleopen'
  | 'radial'
  | 'horzclose'
  | 'horzopen'
  | 'vertclose'
  | 'vertopen'
  | 'diagtl'
  | 'diagtr'
  | 'diagbl'
  | 'diagbr'
  | 'hlslice'
  | 'hrslice'
  | 'vuslice'
  | 'vdslice'
  | 'hblur'
  | 'squeezeh'
  | 'squeezev'
  | 'zoomin'
  | 'hlwind'
  | 'hrwind'
  | 'vuwind'
  | 'vdwind'
  | 'coverleft'
  | 'coverright'
  | 'coverup'
  | 'coverdown'
  | 'revealleft'
  | 'revealright'
  | 'revealup'
  | 'revealdown'
  | 'ghost-scanline-glitch'
  | 'ghost-block-glitch'
  | 'ghost-chroma-stagger'
  | 'ghost-tape-tear'
  | 'ghost-signal-pulse';

export type LoopTransitionGroup = 'Essentials' | 'Motion' | 'Glitch' | 'Loop FX' | 'Reveals';

export interface LoopTransitionOption {
  value: LoopTransitionType;
  label: string;
  group: LoopTransitionGroup;
}

export const LOOP_TRANSITIONS: LoopTransitionOption[] = [
  { value: 'fade', label: 'Cross Dissolve', group: 'Essentials' },
  { value: 'fadefast', label: 'Quick Dip', group: 'Essentials' },
  { value: 'fadeslow', label: 'Slow Melt', group: 'Essentials' },
  { value: 'dissolve', label: 'Dither Dissolve', group: 'Essentials' },
  { value: 'pixelize', label: 'Pixel Burst', group: 'Essentials' },
  { value: 'fadeblack', label: 'Black Flash', group: 'Essentials' },
  { value: 'fadewhite', label: 'White Flash', group: 'Essentials' },
  { value: 'fadegrays', label: 'Mono Flash', group: 'Essentials' },

  { value: 'wipeleft', label: 'Wipe Left', group: 'Motion' },
  { value: 'wiperight', label: 'Wipe Right', group: 'Motion' },
  { value: 'wipeup', label: 'Wipe Up', group: 'Motion' },
  { value: 'wipedown', label: 'Wipe Down', group: 'Motion' },
  { value: 'slideleft', label: 'Slide Left', group: 'Motion' },
  { value: 'slideright', label: 'Slide Right', group: 'Motion' },
  { value: 'slideup', label: 'Slide Up', group: 'Motion' },
  { value: 'slidedown', label: 'Slide Down', group: 'Motion' },
  { value: 'smoothleft', label: 'Smooth Push Left', group: 'Motion' },
  { value: 'smoothright', label: 'Smooth Push Right', group: 'Motion' },
  { value: 'smoothup', label: 'Smooth Push Up', group: 'Motion' },
  { value: 'smoothdown', label: 'Smooth Push Down', group: 'Motion' },

  { value: 'ghost-scanline-glitch', label: 'Scanline Break', group: 'Glitch' },
  { value: 'ghost-block-glitch', label: 'Block Scatter', group: 'Glitch' },
  { value: 'ghost-chroma-stagger', label: 'Chroma Stagger', group: 'Glitch' },
  { value: 'ghost-tape-tear', label: 'Tape Tear', group: 'Glitch' },
  { value: 'ghost-signal-pulse', label: 'Signal Pulse', group: 'Glitch' },
  { value: 'hlslice', label: 'Glitch Slice Left', group: 'Glitch' },
  { value: 'hrslice', label: 'Glitch Slice Right', group: 'Glitch' },
  { value: 'vuslice', label: 'Vertical Slice Up', group: 'Glitch' },
  { value: 'vdslice', label: 'Vertical Slice Down', group: 'Glitch' },
  { value: 'hblur', label: 'Blur Smash', group: 'Glitch' },

  { value: 'zoomin', label: 'Zoom Punch', group: 'Loop FX' },
  { value: 'distance', label: 'Distance Warp', group: 'Loop FX' },
  { value: 'radial', label: 'Radial Spin', group: 'Loop FX' },
  { value: 'rectcrop', label: 'Box Iris', group: 'Loop FX' },
  { value: 'circlecrop', label: 'Circle Iris', group: 'Loop FX' },
  { value: 'circleclose', label: 'Circle Close', group: 'Loop FX' },
  { value: 'circleopen', label: 'Circle Open', group: 'Loop FX' },
  { value: 'horzclose', label: 'Horizontal Close', group: 'Loop FX' },
  { value: 'horzopen', label: 'Horizontal Open', group: 'Loop FX' },
  { value: 'vertclose', label: 'Vertical Close', group: 'Loop FX' },
  { value: 'vertopen', label: 'Vertical Open', group: 'Loop FX' },
  { value: 'squeezeh', label: 'Squeeze Horizontal', group: 'Loop FX' },
  { value: 'squeezev', label: 'Squeeze Vertical', group: 'Loop FX' },
  { value: 'diagtl', label: 'Diagonal Top Left', group: 'Loop FX' },
  { value: 'diagtr', label: 'Diagonal Top Right', group: 'Loop FX' },
  { value: 'diagbl', label: 'Diagonal Bottom Left', group: 'Loop FX' },
  { value: 'diagbr', label: 'Diagonal Bottom Right', group: 'Loop FX' },
  { value: 'wipetl', label: 'Corner Wipe Top Left', group: 'Loop FX' },
  { value: 'wipetr', label: 'Corner Wipe Top Right', group: 'Loop FX' },
  { value: 'wipebl', label: 'Corner Wipe Bottom Left', group: 'Loop FX' },
  { value: 'wipebr', label: 'Corner Wipe Bottom Right', group: 'Loop FX' },

  { value: 'hlwind', label: 'Wind Left', group: 'Reveals' },
  { value: 'hrwind', label: 'Wind Right', group: 'Reveals' },
  { value: 'vuwind', label: 'Wind Up', group: 'Reveals' },
  { value: 'vdwind', label: 'Wind Down', group: 'Reveals' },
  { value: 'coverleft', label: 'Cover Left', group: 'Reveals' },
  { value: 'coverright', label: 'Cover Right', group: 'Reveals' },
  { value: 'coverup', label: 'Cover Up', group: 'Reveals' },
  { value: 'coverdown', label: 'Cover Down', group: 'Reveals' },
  { value: 'revealleft', label: 'Reveal Left', group: 'Reveals' },
  { value: 'revealright', label: 'Reveal Right', group: 'Reveals' },
  { value: 'revealup', label: 'Reveal Up', group: 'Reveals' },
  { value: 'revealdown', label: 'Reveal Down', group: 'Reveals' },
];

export const LOOP_TRANSITION_GROUPS: LoopTransitionGroup[] = ['Essentials', 'Motion', 'Glitch', 'Loop FX', 'Reveals'];

const CUSTOM_LOOP_TRANSITION_EXPRESSIONS: Partial<Record<LoopTransitionType, string>> = {
  'ghost-scanline-glitch': 'if(gt(P+0.08*PLANE,0.18+0.64*mod(floor(Y/6),7)/6),B,A)',
  'ghost-block-glitch': 'if(gt(P,0.12+0.76*mod(floor(X/64)*13+floor(Y/48)*7,19)/18),B,A)',
  'ghost-chroma-stagger': 'if(gt(P+0.13*(PLANE-1),0.15+0.7*mod(floor(Y/20)+floor(X/80),5)/4),B,A)',
  'ghost-tape-tear': 'if(gt(P+0.25*sin(Y*0.12+P*12),0.48),B,A)',
  'ghost-signal-pulse': 'if(gt(P+0.18*sin((floor(Y/18)+floor(X/90))*2+P*18),0.58),B,A)',
  hlwind: 'if(gt(P+0.12*sin(Y*0.14),X/W),B,A)',
  hrwind: 'if(gt(P+0.12*sin(Y*0.14),(W-X)/W),B,A)',
  vuwind: 'if(gt(P+0.12*sin(X*0.14),(H-Y)/H),B,A)',
  vdwind: 'if(gt(P+0.12*sin(X*0.14),Y/H),B,A)',
  coverleft: 'if(gt(P,X/W),B,A)',
  coverright: 'if(gt(P,(W-X)/W),B,A)',
  coverup: 'if(gt(P,(H-Y)/H),B,A)',
  coverdown: 'if(gt(P,Y/H),B,A)',
  revealleft: 'A*(1-clip((P-X/W)*8+0.5,0,1))+B*clip((P-X/W)*8+0.5,0,1)',
  revealright: 'A*(1-clip((P-(W-X)/W)*8+0.5,0,1))+B*clip((P-(W-X)/W)*8+0.5,0,1)',
  revealup: 'A*(1-clip((P-(H-Y)/H)*8+0.5,0,1))+B*clip((P-(H-Y)/H)*8+0.5,0,1)',
  revealdown: 'A*(1-clip((P-Y/H)*8+0.5,0,1))+B*clip((P-Y/H)*8+0.5,0,1)',
};

function loopXfadeOptions(
  transitionType: LoopTransitionType,
  fadeDuration: number,
  xfadeOffset: number,
): string {
  const expr = CUSTOM_LOOP_TRANSITION_EXPRESSIONS[transitionType];
  if (expr) {
    return `transition=custom:duration=${fadeDuration.toFixed(3)}:offset=${xfadeOffset.toFixed(3)}:expr='${expr}'`;
  }
  return `transition=${transitionType}:duration=${fadeDuration.toFixed(3)}:offset=${xfadeOffset.toFixed(3)}`;
}

// ─── Helpers ────────────────────────────────────────────────

/** Clamp a number into [lo, hi], converting NaN/Infinity to lo.
 *  Used everywhere a value could come from an external source
 *  (FFmpeg progress events, HTMLMediaElement duration). */
function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  return Math.max(lo, Math.min(hi, v));
}

export function runtimeVideoUrlToPath(src: string | undefined | null): string | null {
  if (!src) return null;
  try {
    if (/^ghost-asset:/i.test(src)) {
      const url = new URL(src);
      let p = decodeURIComponent(url.pathname);
      if (p.startsWith('/') && /^\/[A-Za-z]:\//.test(p)) p = p.slice(1);
      return p || null;
    }
    if (/^file:/i.test(src)) {
      const url = new URL(src);
      let p = decodeURIComponent(url.pathname);
      if (p.startsWith('/') && /^\/[A-Za-z]:\//.test(p)) p = p.slice(1);
      return p || null;
    }
  } catch {
    return null;
  }
  return null;
}

function canUseNativeLoop(): boolean {
  return isDesktopApp
    && typeof window !== 'undefined'
    && !!window.electronAPI?.invoke
    && !!window.electronAPI?.on;
}

function makeLoopJobId(prefix: string): string {
  const cryptoId = globalThis.crypto?.randomUUID?.();
  return `${prefix}-${cryptoId || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`;
}

function subscribeNativeLoopProgress(jobId: string, onProgress?: ProgressCallback): (() => void) | undefined {
  if (!onProgress || typeof window === 'undefined') return undefined;
  return window.electronAPI?.on?.('video-loop-progress', (payload: any) => {
    if (!payload || payload.jobId !== jobId) return;
    onProgress({
      stage: payload.stage === 'complete' ? 'complete'
        : payload.stage === 'error' ? 'error'
          : payload.stage === 'processing' ? 'processing'
            : 'rendering',
      progress: clamp(Number(payload.progress), 0, 1),
      message: String(payload.message || 'Creating loop...'),
    });
  });
}

async function nativeInputPayload(
  videoFile: File | Blob | string,
  options?: NativeLoopOptions,
): Promise<{ inputPath?: string; inputBytes?: ArrayBuffer }> {
  const explicitPath = options?.inputPath || (typeof videoFile === 'string' ? runtimeVideoUrlToPath(videoFile) : null);
  if (explicitPath) return { inputPath: explicitPath };

  if (typeof videoFile === 'string') {
    const resp = await fetch(videoFile);
    if (!resp.ok) throw new Error(`Failed to read video for loop: ${resp.status}`);
    const blob = await resp.blob();
    return { inputBytes: await blob.arrayBuffer() };
  }
  return { inputBytes: await videoFile.arrayBuffer() };
}

export async function createNativeLoopedVideo(
  videoFile: File | Blob | string,
  crossfadeDuration: number = 0.5,
  onProgress?: ProgressCallback,
  transitionType: LoopTransitionType = 'fade',
  options: NativeLoopOptions = {},
): Promise<LoopCreateResult> {
  if (!canUseNativeLoop()) {
    throw new Error('Native loop creation is only available in the desktop app.');
  }

  const jobId = makeLoopJobId('video-loop');
  const unsubscribe = subscribeNativeLoopProgress(jobId, onProgress);
  try {
    onProgress?.({ stage: 'processing', progress: 0, message: 'Preparing native loop...' });
    const input = await nativeInputPayload(videoFile, options);
    const result = await invoke<{
      success?: boolean;
      error?: string;
      outputPath?: string;
      size?: number;
      duration?: number;
      transitionApplied?: LoopTransitionType;
    }>('video_loop_create', {
      jobId,
      ...input,
      inputName: options.inputName,
      outputName: options.outputName,
      crossfadeDuration,
      transitionType,
    });

    if (!result?.success || !result.outputPath) {
      throw new Error(result?.error || 'Native loop creation failed.');
    }
    if (result.transitionApplied !== transitionType) {
      throw new Error(
        `Loop encoder returned ${result.transitionApplied || 'no transition'} `
        + `instead of the requested ${transitionType}.`,
      );
    }
    const transitionLabel = LOOP_TRANSITIONS.find(option => option.value === transitionType)?.label
      ?? transitionType;
    onProgress?.({
      stage: 'complete',
      progress: 1,
      message: `Loop created with ${transitionLabel}.`,
    });
    return {
      url: pathToFileUrl(result.outputPath),
      outputPath: result.outputPath,
      size: result.size,
      duration: result.duration,
      transitionApplied: result.transitionApplied,
    };
  } finally {
    unsubscribe?.();
  }
}

export async function appendNativeVideoSegment(
  videoFile: File | Blob | string,
  segmentBlob: Blob,
  onProgress?: ProgressCallback,
  options: NativeLoopOptions = {},
): Promise<LoopCreateResult> {
  if (!canUseNativeLoop()) {
    throw new Error('Native video assembly is only available in the desktop app.');
  }

  const jobId = makeLoopJobId('video-append-segment');
  const unsubscribe = subscribeNativeLoopProgress(jobId, onProgress);
  try {
    onProgress?.({ stage: 'processing', progress: 0, message: 'Preparing video assembly...' });
    const input = await nativeInputPayload(videoFile, options);
    const result = await invoke<{
      success?: boolean;
      error?: string;
      outputPath?: string;
      size?: number;
    }>('video_append_segment', {
      jobId,
      ...input,
      segmentBytes: await segmentBlob.arrayBuffer(),
      inputName: options.inputName,
      outputName: options.outputName,
      width: options.width,
      height: options.height,
    });

    if (!result?.success || !result.outputPath) {
      throw new Error(result?.error || 'Native video assembly failed.');
    }
    onProgress?.({ stage: 'complete', progress: 1, message: 'Video assembled!' });
    return {
      url: pathToFileUrl(result.outputPath),
      outputPath: result.outputPath,
      size: result.size,
    };
  } finally {
    unsubscribe?.();
  }
}

/** Build a phase-scaled progress callback. The internal phases of
 *  the loop process don't each cover 0..1 — they cover a SLICE of
 *  the overall bar. This wraps onProgress so a phase's local 0..1
 *  maps onto [start, end] of the user's bar.
 *
 *  Without this, the user sees the bar jump back to 0% three times
 *  (load → probe → encode), which reads as "stuck / restarting". */
function phasedProgress(
  base: ProgressCallback | undefined,
  start: number,
  end: number,
): ProgressCallback {
  return (p: LoopProgress) => {
    const local = clamp(p.progress, 0, 1);
    const mapped = start + (end - start) * local;
    base?.({
      stage: p.stage,
      progress: clamp(mapped, 0, 1),
      message: p.message,
    });
  };
}

// ─── FFmpeg init ────────────────────────────────────────────

/** Initialize FFmpeg singleton. Does NOT register a progress
 *  handler — that's bound per-call in createLoopedVideo so each
 *  caller sees its own progress and we never accumulate stale
 *  handlers from prior calls. */
async function initFFmpeg(onProgress?: ProgressCallback): Promise<FFmpegType> {
  if (ffmpeg && ffmpegLoaded) return ffmpeg;

  if (ffmpegLoading) {
    // Concurrent load — wait for the in-flight one rather than
    // racing a second wasm-instance creation.
    while (ffmpegLoading) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (ffmpeg && ffmpegLoaded) return ffmpeg;
  }

  ffmpegLoading = true;
  onProgress?.({ stage: 'loading', progress: 0, message: 'Loading FFmpeg…' });

  try {
    const { FFmpeg } = await import('@ffmpeg/ffmpeg');
    ffmpeg = new FFmpeg();

    // The 'log' subscription stays as a session-wide diagnostic
    // (we do parse certain log lines per-call for duration probe,
    // but those handlers are bound + removed locally below).
    ffmpeg.on('log', ({ message }) => {
      console.log('[FFmpeg]', message);
    });

    onProgress?.({ stage: 'loading', progress: 0.3, message: 'Loading FFmpeg core…' });

    // ffmpegCoreUrl / ffmpegWasmUrl are Vite ?url imports (top of
    // this file). Same-origin local URLs work under Electron's
    // strict file://-origin CSP where unpkg fetches failed with
    // "Failed to create loop".
    await ffmpeg.load({
      coreURL: ffmpegCoreUrl,
      wasmURL: ffmpegWasmUrl,
    });

    ffmpegLoaded = true;
    onProgress?.({ stage: 'loading', progress: 1, message: 'FFmpeg ready' });
    return ffmpeg;
  } finally {
    ffmpegLoading = false;
  }
}

// ─── Duration probes ────────────────────────────────────────

/** Primary duration probe — runs FFmpeg's null muxer over the input
 *  file and parses the Duration line from its log output. More
 *  reliable than HTMLVideoElement.duration which lies for many MP4s
 *  (returns Infinity for missing moov, NaN for variable framerate
 *  containers, etc.). Returns NaN on failure so caller can fall
 *  back to the HTML probe. */
async function probeDurationViaFFmpeg(ff: FFmpegType): Promise<number> {
  let detected = NaN;
  const logHandler = ({ message }: { message: string }) => {
    // FFmpeg's banner format: "Duration: 00:00:05.42, start: ..."
    const m = message.match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/);
    if (m) {
      const h = parseInt(m[1], 10);
      const min = parseInt(m[2], 10);
      const sec = parseInt(m[3], 10);
      // Centiseconds — parse as a fractional so 2 or 3 digits both
      // work ("42" → 0.42, "423" → 0.423).
      const frac = parseFloat(`0.${m[4]}`);
      const val = h * 3600 + min * 60 + sec + frac;
      if (Number.isFinite(val) && val > 0) detected = val;
    }
  };
  ff.on('log', logHandler);
  try {
    // `-f null -` runs the demuxer but discards output. Banner
    // (containing Duration) prints before any frame is processed
    // so this is fast even on long videos.
    await ff.exec(['-i', 'input.mp4', '-f', 'null', '-']);
  } catch {
    // Even when exec throws (non-zero exit), the banner has usually
    // already printed by the time the muxer errors. Keep what we
    // captured.
  } finally {
    ff.off('log', logHandler);
  }
  return detected;
}

/** Fallback HTML duration probe — used only if FFmpeg couldn't
 *  parse a Duration line, since that path implies a malformed
 *  container that the browser might also struggle with.
 *  Bracketed in a hard 6s timeout so we don't hang forever. */
async function probeDurationViaHTML(url: string): Promise<number> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;

    let done = false;
    const finish = (val: number) => {
      if (done) return;
      done = true;
      video.remove();
      resolve(Number.isFinite(val) && val > 0 ? val : NaN);
    };

    video.onloadedmetadata = () => {
      if (Number.isFinite(video.duration) && video.duration > 0) {
        finish(video.duration);
      } else {
        // Trick: seek past the end so the browser is forced to
        // index the file, then read currentTime.
        video.currentTime = Number.MAX_SAFE_INTEGER;
      }
    };
    video.onseeked = () => finish(video.currentTime);
    video.onerror = () => finish(NaN);
    setTimeout(() => finish(NaN), 6000);

    video.src = url;
    video.load();
  });
}

// ─── Core: create loop ─────────────────────────────────────

const MIN_DURATION = 1.0;     // shorter than this, xfade gets unstable
const MAX_DURATION = 60 * 30; // 30 minutes — past this, refuse (out-of-memory risk in wasm)
const WATCHDOG_MS = 60_000;   // if FFmpeg hasn't logged in 60s, abort

export async function createLoopedVideo(
  videoFile: File | Blob | string,
  crossfadeDuration: number = 0.5,
  onProgress?: ProgressCallback,
  transitionType: LoopTransitionType = 'fade',
): Promise<string> {
  // Phase plan (progress bar slices):
  //   load    : 0  – 20%
  //   probe   : 20 – 30%
  //   render  : 30 – 95%
  //   read    : 95 – 100%
  const loadProgress   = phasedProgress(onProgress, 0.00, 0.20);
  const probeProgress  = phasedProgress(onProgress, 0.20, 0.30);
  const renderProgress = phasedProgress(onProgress, 0.30, 0.95);
  const readProgress   = phasedProgress(onProgress, 0.95, 1.00);

  const ff = await initFFmpeg(loadProgress);

  probeProgress({ stage: 'processing', progress: 0, message: 'Preparing video…' });

  // Resolve the input to bytes we can hand FFmpeg.
  let videoData: Uint8Array;
  let videoUrl: string;
  let needsUrlCleanup = false;
  if (typeof videoFile === 'string') {
    videoUrl = videoFile;
    const resp = await fetch(videoFile);
    const blob = await resp.blob();
    videoData = new Uint8Array(await blob.arrayBuffer());
  } else {
    videoUrl = URL.createObjectURL(videoFile);
    needsUrlCleanup = true;
    videoData = new Uint8Array(await videoFile.arrayBuffer());
  }

  await ff.writeFile('input.mp4', videoData);

  probeProgress({ stage: 'processing', progress: 0.4, message: 'Detecting duration…' });

  // FFmpeg-first duration probe; HTML fallback only if the
  // container is malformed enough that FFmpeg can't parse it
  // (rare — usually that means we can't loop it either).
  let duration = await probeDurationViaFFmpeg(ff);
  if (!Number.isFinite(duration) || duration <= 0) {
    duration = await probeDurationViaHTML(videoUrl);
  }
  if (needsUrlCleanup) URL.revokeObjectURL(videoUrl);

  // Validate. A clear error here is much better than a silent
  // FFmpeg hang downstream.
  if (!Number.isFinite(duration) || duration <= 0) {
    try { await ff.deleteFile('input.mp4'); } catch { /* ignore */ }
    throw new Error('Could not detect video duration — the file may be corrupted.');
  }
  if (duration < MIN_DURATION) {
    try { await ff.deleteFile('input.mp4'); } catch { /* ignore */ }
    throw new Error(`Video is too short to loop (${duration.toFixed(2)}s; need at least ${MIN_DURATION}s).`);
  }
  if (duration > MAX_DURATION) {
    try { await ff.deleteFile('input.mp4'); } catch { /* ignore */ }
    throw new Error(`Video is too long to loop in-browser (${Math.round(duration)}s; max ${MAX_DURATION}s). Trim it first.`);
  }

  probeProgress({ stage: 'processing', progress: 1, message: `Duration ${duration.toFixed(2)}s detected` });

  // xfade math — all derived values get explicit guards so a bad
  // input duration produces a clean error, not a hang.
  const midpoint = duration / 2;
  const secondHalfDuration = duration - midpoint;
  // Crossfade can't exceed 40% of the shorter half — leaves real
  // (non-overlapped) content on both sides of the join, otherwise
  // the loop looks like a constant fade with no "rest" in between.
  // Hard upper cap at 1.0s matches the UI slider's range.
  const fadeDuration = clamp(crossfadeDuration, 0.1, Math.min(1.0, midpoint * 0.4));
  const xfadeOffset  = Math.max(0, secondHalfDuration - fadeDuration);

  if (!Number.isFinite(midpoint) || !Number.isFinite(xfadeOffset) || !Number.isFinite(fadeDuration)) {
    try { await ff.deleteFile('input.mp4'); } catch { /* ignore */ }
    throw new Error('Loop math produced non-finite values — internal error.');
  }

  renderProgress({ stage: 'rendering', progress: 0, message: 'Creating seamless loop…' });

  // Per-call progress handler. We bind it RIGHT before exec and
  // unbind it in `finally`, so concurrent / sequential createLoop
  // calls never share progress state. (Bug from earlier rev: the
  // handler was registered in initFFmpeg() once at first-init
  // time, closing over the first caller's onProgress forever.)
  //
  // Why we ALSO parse `time=HH:MM:SS.cc` from FFmpeg's log lines:
  // the 'progress' event is unreliable for filter_complex / xfade
  // outputs — it often doesn't fire at all during long encodes, or
  // fires once at the very end with progress=1. Users reported the
  // bar sitting at 0% (well, the 30% phase-entry value, which the
  // narrow phase slice makes look near-0) for minutes during a
  // multi-minute loop creation. Parsing `time=` from log gives us
  // smooth incremental progress no matter which event path fires.
  const progressHandler = ({ progress }: { progress: number }) => {
    // FFmpeg's filter_complex progress can overshoot — we've seen
    // up to 1.85 with xfade. Clamp before publishing.
    const p = clamp(progress, 0, 1);
    publishEncode(p);
  };
  /** Last published encode-phase progress. Both the progress event
   *  AND the log-time parser feed into this — we publish the higher
   *  of the two so the bar never goes backwards (in case the
   *  progress event eventually fires after we'd already estimated
   *  ~80% from the log time). */
  let lastEncodeProgress = 0;
  function publishEncode(p: number) {
    if (p <= lastEncodeProgress) return;
    lastEncodeProgress = p;
    const pct = Math.round(p * 100);
    renderProgress({ stage: 'rendering', progress: p, message: `Encoding ${pct}%` });
  }

  // Log-line parser for FFmpeg's per-frame progress reports.
  // ffmpeg.wasm emits lines like:
  //   "frame=  150 fps=25 q=23.0 size=512kB time=00:00:05.00 ...."
  // We map `time` against the EXPECTED OUTPUT DURATION to compute
  // progress. For our loop layout, the output is the same length as
  // the input (we swap halves and crossfade in place), so the
  // already-detected `duration` is the right total.
  const expectedOutputSec = duration;
  let lastLogAt = performance.now();
  const logHeartbeat = ({ message }: { message: string }) => {
    lastLogAt = performance.now();
    // Match "time=HH:MM:SS.cc" — present in pretty much every
    // ffmpeg progress line. Cents/millis is optional.
    const m = message.match(/time=\s*(\d+):(\d+):(\d+)\.(\d+)/);
    if (!m) return;
    const h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    const sec = parseInt(m[3], 10);
    const frac = parseFloat(`0.${m[4]}`);
    const tSec = h * 3600 + min * 60 + sec + frac;
    if (!Number.isFinite(tSec) || expectedOutputSec <= 0) return;
    const p = clamp(tSec / expectedOutputSec, 0, 1);
    publishEncode(p);
  };
  let watchdogTimedOut = false;
  const watchdog = setInterval(() => {
    if (performance.now() - lastLogAt > WATCHDOG_MS) {
      watchdogTimedOut = true;
      // We can't actually cancel ff.exec mid-flight in the current
      // FFmpeg.wasm API — best we can do is mark it so we throw
      // after exec eventually unblocks (or doesn't).
      console.error('[VideoLoop] Watchdog: no FFmpeg log activity for', WATCHDOG_MS, 'ms');
    }
  }, 5000);

  ff.on('progress', progressHandler);
  ff.on('log', logHeartbeat);

  let renderError: unknown = null;
  try {
    // Filter graph:
    //   [0:v]trim=start=midpoint, reset PTS  → [v0] (becomes loop start)
    //   [1:v]trim=end=midpoint,   reset PTS  → [v1] (becomes loop end)
    //   xfade [v0]→[v1] at offset = secondHalfDuration - fadeDuration
    //
    // xfade requires matching frame rate, sample aspect ratio, pixel
    // format, and timebase. Normalize every boundary before mixing.
    await ff.exec([
      '-i', 'input.mp4',
      '-i', 'input.mp4',
      '-filter_complex',
      `[0:v]trim=start=${midpoint.toFixed(3)},setpts=PTS-STARTPTS,fps=30,setsar=1,format=yuv420p,settb=AVTB[v0];` +
      `[1:v]trim=end=${midpoint.toFixed(3)},setpts=PTS-STARTPTS,fps=30,setsar=1,format=yuv420p,settb=AVTB[v1];` +
      `[v0][v1]xfade=${loopXfadeOptions(transitionType, fadeDuration, xfadeOffset)}[outv]`,
      '-map', '[outv]',
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '23',
      '-movflags', '+faststart',
      '-an',
      'output.mp4',
    ]);
  } catch (err) {
    renderError = err;
  } finally {
    clearInterval(watchdog);
    ff.off('progress', progressHandler);
    ff.off('log', logHeartbeat);
  }

  if (watchdogTimedOut) {
    try { await ff.deleteFile('input.mp4'); } catch { /* ignore */ }
    throw new Error('Loop creation timed out — the encoder stopped responding. Try a shorter clip or a different transition.');
  }

  if (renderError) {
    // Fail loudly rather than silently substituting a hard-cut
    // concat — a wrong transition masquerading as success is worse
    // than an actionable error.
    try { await ff.deleteFile('input.mp4'); } catch { /* ignore */ }
    const detail = renderError instanceof Error ? renderError.message : String(renderError);
    throw new Error(`The ${transitionType} loop transition could not be rendered. ${detail}`);
  }

  readProgress({ stage: 'rendering', progress: 0, message: 'Finalizing…' });

  const outputData = await ff.readFile('output.mp4');

  try { await ff.deleteFile('input.mp4'); } catch { /* ignore */ }
  try { await ff.deleteFile('output.mp4'); } catch { /* ignore */ }

  // FFmpeg's readFile typing is FileData; we narrow to the
  // Uint8Array branch — for binary outputs that's always what
  // comes back, but the union includes string for text outputs.
  const u8 = outputData instanceof Uint8Array ? outputData : new Uint8Array(outputData as any);
  // Cast to ArrayBuffer-backed Uint8Array so Blob accepts it
  // across all TS lib targets (some target setups complain about
  // the underlying buffer type).
  const outputBlob = new Blob([u8 as Uint8Array<ArrayBuffer>], { type: 'video/mp4' });
  const outputUrl = URL.createObjectURL(outputBlob);

  // Always publish a clean 100% on success — earlier the bar would
  // get stuck at 95% because the readFile step had no progress.
  onProgress?.({ stage: 'complete', progress: 1, message: 'Loop created!' });

  return outputUrl;
}

/** Smart loop creator — main entry point. Thin wrapper that exists
 *  for symmetry with the rest of the recording API surface. */
export async function createLoopWithResult(
  videoFile: File | Blob | string,
  crossfadeDuration: number = 0.5,
  onProgress?: ProgressCallback,
  transitionType: LoopTransitionType = 'fade',
  options: NativeLoopOptions = {},
): Promise<LoopCreateResult> {
  if (canUseNativeLoop()) {
    try {
      return await createNativeLoopedVideo(videoFile, crossfadeDuration, onProgress, transitionType, options);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(
        `[VideoLoop] Native FFmpeg loop encoder failed (${reason}); falling back to FFmpeg.wasm.`,
        err,
      );
      onProgress?.({ stage: 'processing', progress: 0, message: 'Native loop failed, trying browser encoder...' });
    }
  }

  const url = await createLoopedVideo(videoFile, crossfadeDuration, onProgress, transitionType);
  return { url, transitionApplied: transitionType };
}

export async function createLoop(
  videoFile: File | Blob | string,
  crossfadeDuration: number = 0.5,
  onProgress?: ProgressCallback,
  transitionType: LoopTransitionType = 'fade',
): Promise<string> {
  return (await createLoopWithResult(videoFile, crossfadeDuration, onProgress, transitionType)).url;
}
