/**
 * What Render to video will make: the quality choices per codec, and an
 * estimate of the file's size and of how long the render takes.
 *
 * Sizes: ProRes and HAP are near-constant rate, so their estimate is good
 * (ProRes from Apple's published target rates, which scale with pixels and
 * frame rate; HAP from its texture block sizes). H.264 at a quality level
 * (CRF) takes what the picture needs: flat graphics are far smaller, busy
 * noisy pictures can be bigger, so it is shown as "about".
 *
 * Time: frames × the time one frame took here last time (per megapixel),
 * or a first guess until a render has run on this machine.
 */
import type { RecordingCodecId } from './recordingSources';
import { frameCount } from './renderRate';

export type RenderQuality = 'web' | 'high' | 'archive';

export interface QualityChoice {
  value: RenderQuality;
  label: string;
  hint: string;
}

/** The quality tiers each codec offers (the encoder arguments are in electron/recording-formats.cjs and main.js). */
export function qualityChoices(codec: RecordingCodecId | undefined): QualityChoice[] {
  if (codec === 'prores_hq') {
    return [
      { value: 'web', label: 'ProRes 422 LT', hint: 'Smaller ProRes for editing and playback' },
      { value: 'high', label: 'ProRes 422 HQ', hint: 'The usual master for editing (recommended)' },
      { value: 'archive', label: 'ProRes 4444 XQ', hint: 'Full colour, the largest ProRes' },
    ];
  }
  if (codec === 'hap') {
    return [
      { value: 'high', label: 'HAP', hint: 'For media servers and VJ software (recommended)' },
      { value: 'archive', label: 'HAP Q', hint: 'Cleaner gradients, twice the size' },
    ];
  }
  return [
    { value: 'web', label: 'Smaller file', hint: 'For sharing online (CRF 23)' },
    { value: 'high', label: 'High', hint: 'Visually lossless (CRF 18, recommended)' },
    { value: 'archive', label: 'Master', hint: 'Near lossless, for big screens (CRF 14)' },
  ];
}

/** The quality to use for `codec` when `quality` is not one it offers. */
export function qualityFor(codec: RecordingCodecId | undefined, quality: RenderQuality): RenderQuality {
  const choices = qualityChoices(codec);
  return choices.some((c) => c.value === quality) ? quality : 'high';
}

// Apple ProRes white paper target rates at 1920x1080, 29.97 fps (Mbit/s).
const PRORES_1080_2997: Record<RenderQuality, number> = { web: 102, high: 220, archive: 500 };
// H.264 bits per pixel per frame at each CRF for typical show content.
const H264_BPP: Record<RenderQuality, number> = { web: 0.05, high: 0.1, archive: 0.2 };

/** Video bits per second. */
export function videoBitrate(codec: RecordingCodecId | undefined, quality: RenderQuality, width: number, height: number, fps: number): number {
  const pixels = Math.max(1, width * height);
  const q = qualityFor(codec, quality);
  if (codec === 'prores_hq') return PRORES_1080_2997[q] * 1e6 * (pixels / (1920 * 1080)) * (fps / (30000 / 1001));
  if (codec === 'hap') {
    // DXT1 is 4 bits a pixel, HAP Q (DXT5) 8; Snappy takes a little off.
    const bitsPerPixel = q === 'archive' ? 8 : 4;
    return pixels * bitsPerPixel * fps * 0.85;
  }
  return pixels * fps * H264_BPP[q];
}

/** Audio bits per second: AAC in MP4, 16-bit 48 kHz stereo PCM in MOV. */
export function audioBitrate(codec: RecordingCodecId | undefined): number {
  return codec === 'prores_hq' || codec === 'hap' ? 48000 * 16 * 2 : 192000;
}

export interface RenderEstimate {
  frames: number;
  bytes: number;
  /** True for H.264: the size depends on the picture. */
  approximate: boolean;
  /** True for ProRes and HAP: their published rates are a ceiling, simple pictures come out smaller. */
  ceiling: boolean;
  seconds: number;
  /** True when the time comes from a render on this machine. */
  measured: boolean;
}

/** What one frame cost on this machine last time: ms per frame and megapixel. */
export interface RenderRateSample {
  msPerMegapixelFrame: number;
  /** Fixed ms per frame (IPC, the show's evaluation) on top of the pixels. */
  msPerFrame: number;
}

/**
 * A first guess before any render has run here, measured on an M-series
 * MacBook Pro: 640x360 26 ms a frame, 1080p 60 ms (H.264 and ProRes alike:
 * the encoder runs beside the capture), 4K 166 ms. Most of a small frame is
 * fixed cost (one animation frame, the show's evaluation, IPC).
 */
export const DEFAULT_RATE_SAMPLE: RenderRateSample = { msPerMegapixelFrame: 17, msPerFrame: 22 };

export function estimateRender(opts: {
  codec: RecordingCodecId | undefined;
  quality: RenderQuality;
  width: number;
  height: number;
  fps: number;
  seconds: number;
  withSound: boolean;
  sample?: RenderRateSample | null;
}): RenderEstimate {
  const frames = frameCount(opts.seconds, opts.fps);
  const length = frames / opts.fps;
  const bits = (videoBitrate(opts.codec, opts.quality, opts.width, opts.height, opts.fps) + (opts.withSound ? audioBitrate(opts.codec) : 0)) * length;
  const sample = opts.sample ?? DEFAULT_RATE_SAMPLE;
  const mp = (opts.width * opts.height) / 1e6;
  const msFrame = sample.msPerFrame + sample.msPerMegapixelFrame * mp;
  return {
    frames,
    bytes: bits / 8,
    approximate: !opts.codec || opts.codec === 'h264',
    ceiling: opts.codec === 'prores_hq' || opts.codec === 'hap',
    seconds: (frames * msFrame) / 1000,
    measured: !!opts.sample,
  };
}

/** A finished render's own cost, as a sample for the next estimate: the
 *  default's shape, scaled to how fast this machine and show really were. */
export function rateSampleFrom(elapsedMs: number, frames: number, width: number, height: number): RenderRateSample | null {
  if (!(elapsedMs > 0) || !(frames > 0)) return null;
  const mp = Math.max(0.01, (width * height) / 1e6);
  const predicted = DEFAULT_RATE_SAMPLE.msPerFrame + DEFAULT_RATE_SAMPLE.msPerMegapixelFrame * mp;
  const k = Math.max(0.05, Math.min(50, elapsedMs / frames / predicted));
  return { msPerFrame: DEFAULT_RATE_SAMPLE.msPerFrame * k, msPerMegapixelFrame: DEFAULT_RATE_SAMPLE.msPerMegapixelFrame * k };
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(bytes >= 1e10 ? 0 : 1)} GB`;
  if (bytes >= 1e6) return `${Math.max(1, Math.round(bytes / 1e6))} MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}

export function formatDuration(seconds: number): string {
  const s = Math.max(1, Math.round(seconds));
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

const RATE_KEY = 'ghostarcade-render-rate';

export function loadRateSample(): RenderRateSample | null {
  try {
    const raw = JSON.parse(localStorage.getItem(RATE_KEY) ?? 'null');
    if (raw && Number.isFinite(raw.msPerMegapixelFrame) && Number.isFinite(raw.msPerFrame)) return raw;
  } catch { /* no storage */ }
  return null;
}

export function saveRateSample(sample: RenderRateSample | null): void {
  if (!sample) return;
  try { localStorage.setItem(RATE_KEY, JSON.stringify(sample)); } catch { /* no storage */ }
}
