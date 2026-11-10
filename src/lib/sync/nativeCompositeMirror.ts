/**
 * Native composite mirror — a live canvas copy of the core's composited
 * output for CPU consumers that cannot read GPU frames directly.
 *
 * Under the native driver the browser canvas is a cleared underlay, so
 * anything that used to sample it — the projection simulator's projected
 * texture, WLED content-aware sampling, the VJ panel's output preview —
 * saw black (or, for native `live://` webcam/capture sources, nothing at
 * all, since those never had a browser videoElement to begin with).
 *
 * This module pumps `native_renderer_get_frame_snapshot` with the core's
 * `max_dim` downscale (GPU blit before readback — ~590KB per frame at 512px
 * instead of ~8MB at 1080p) into one shared canvas. Consumers ref-count it:
 * the pump only runs while someone is holding a handle, so an idle app pays
 * nothing.
 *
 * The mirror carries the TRUE native composite — including live capture
 * sources, GPU graphs and effect chains — because it reads the same
 * snapshot texture the screenshot path uses.
 */
import { invoke } from '$lib/bridge';
import { epochNow } from '$lib/utils/epochClock';

export interface CompositeMirrorHandle {
  canvas: HTMLCanvasElement;
  release(): void;
  /** Change this consumer's rate or size. `highRate` lets a large mirror run
   *  past 30 fps (Stage Sim rehearsing a playing show). */
  update(options: { fps?: number; maxDim?: number; highRate?: boolean }): void;
}

/** When the frame on the mirror canvas was asked for and arrived (epoch ms),
 *  so a consumer can tell how old the picture it draws is. */
export interface CompositeMirrorFrameInfo {
  seq: number;
  requestedAt: number;
  receivedAt: number;
}

/** Same clock as the Stage Sim's rehearsal messages (see utils/epochClock). */
const epochMs = epochNow;

const DEFAULT_MAX_DIM = 512;
const DEFAULT_FPS = 15;

let mirrorCanvas: HTMLCanvasElement | null = null;
let mirrorCtx: CanvasRenderingContext2D | null = null;
let consumers = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let pumpMaxDim = DEFAULT_MAX_DIM;
let pumpFps = 0;
// Each consumer's requested rate; the pump runs at the fastest one.
const fpsRequests = new Map<object, number>();
// Sizes asked for later through `update()`; the pump reads at the largest of
// those and the size it started with.
const dimRequests = new Map<object, number>();
let basePumpMaxDim = DEFAULT_MAX_DIM;
/** The consumer whose size the pump started at; its own `update()` replaces it. */
let baseOwner: object | null = null;
// Consumers allowed past the 30 fps cap of large frames.
const highRateRequests = new Set<object>();
let frameInfo: CompositeMirrorFrameInfo | null = null;

/** The shared mirror canvas, or null before anyone asked for it. */
export function compositeMirrorCanvas(): HTMLCanvasElement | null {
  return mirrorCanvas;
}

/** Timing of the picture currently on the mirror canvas, or null before the first. */
export function compositeMirrorFrameInfo(): CompositeMirrorFrameInfo | null {
  return frameInfo;
}
let inFlight = false;
let failureStreak = 0;
let scratch: ImageData | null = null;
const frameListeners = new Set<() => void>();

/** The pixel payload of a core frame snapshot. */
export interface SnapshotPixels {
  rgba_b64?: string;
  width?: number;
  height?: number;
  format?: string;
  bytes_per_row?: number;
  padded_bytes_per_row?: number;
}

/**
 * Draw a core snapshot into `canvas`, resizing it to the snapshot. `scratch`
 * is the ImageData from the previous call (or null); the one used is
 * returned so a pump allocates only when the size changes. Returns null when
 * the snapshot carries no pixels.
 */
export function drawSnapshotToCanvas(
  snap: SnapshotPixels | null | undefined,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  scratch: ImageData | null,
): ImageData | null {
  if (!snap?.rgba_b64 || !snap.width || !snap.height) return null;
  // A 1024px mirror frame is ~4MB of base64, and the obvious
  // atob-then-charCodeAt-per-byte decode showed up in a live profile at 13%
  // of renderer samples with another 6% in atob itself. Uint8Array.fromBase64
  // does the whole thing in native code; the loop stays as the fallback for
  // runtimes without it.
  let bytes: Uint8Array;
  const fromBase64 = (Uint8Array as unknown as {
    fromBase64?: (s: string) => Uint8Array;
  }).fromBase64;
  if (typeof fromBase64 === 'function') {
    bytes = fromBase64(snap.rgba_b64);
  } else {
    const raw = atob(snap.rgba_b64);
    bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  }
  const w = snap.width;
  const h = snap.height;
  // The core sends rows already stripped of GPU padding, so the padded
  // stride only describes the copy it made, not these bytes.
  const stride = snap.bytes_per_row || w * 4;
  if (bytes.length < stride * (h - 1) + w * 4) return null;
  const bgra = /bgra/i.test(String(snap.format ?? ''));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const image = scratch && scratch.width === w && scratch.height === h ? scratch : new ImageData(w, h);
  const out = image.data;
  for (let y = 0; y < h; y++) {
    const src = y * stride;
    const dst = y * w * 4;
    for (let x = 0; x < w; x++) {
      const si = src + x * 4;
      const di = dst + x * 4;
      out[di] = bytes[bgra ? si + 2 : si];
      out[di + 1] = bytes[si + 1];
      out[di + 2] = bytes[bgra ? si : si + 2];
      out[di + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return image;
}

function base64Bytes(b64: string): Uint8Array {
  const fromBase64 = (Uint8Array as unknown as { fromBase64?: (s: string) => Uint8Array }).fromBase64;
  if (typeof fromBase64 === 'function') return fromBase64(b64);
  const raw = atob(b64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** JPEG frames decode off the main thread and draw in one call (unless a
 *  newer frame was drawn while this one decoded). */
async function decodeJpegIntoIfNewer(snap: { jpeg_b64?: string }, requestSeq: number): Promise<boolean> {
  if (!mirrorCanvas || !mirrorCtx || !snap.jpeg_b64) return false;
  const bitmap = await createImageBitmap(new Blob([base64Bytes(snap.jpeg_b64) as BlobPart], { type: 'image/jpeg' }));
  if (requestSeq <= drawnRequestSeq || !mirrorCanvas || !mirrorCtx) {
    bitmap.close();
    return false;
  }
  try {
    if (mirrorCanvas.width !== bitmap.width) mirrorCanvas.width = bitmap.width;
    if (mirrorCanvas.height !== bitmap.height) mirrorCanvas.height = bitmap.height;
    mirrorCtx.drawImage(bitmap, 0, 0);
  } finally {
    bitmap.close();
  }
  return true;
}

function decodeSnapshotInto(snap: SnapshotPixels): boolean {
  if (!mirrorCanvas || !mirrorCtx) return false;
  const image = drawSnapshotToCanvas(snap, mirrorCanvas, mirrorCtx, scratch);
  if (!image) return false;
  scratch = image;
  return true;
}

/** Start of the last snapshot request (performance ms). */
let lastPumpStart = 0;
/** Request counter: a JPEG that finishes decoding after a newer frame was
 *  drawn is dropped, so frames never go backwards. */
let pumpRequestSeq = 0;
let drawnRequestSeq = 0;

async function pumpOnce(maxDim: number): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  lastPumpStart = performance.now();
  const requestedAt = epochMs();
  const requestSeq = ++pumpRequestSeq;
  let snap: (Parameters<typeof decodeSnapshotInto>[0] & { jpeg_b64?: string }) | null = null;
  try {
    // Large frames travel as JPEG: raw pixels at 30 fps were ~150 MB/s of
    // base64 through the broker and slowed every window. Small ones (LED
    // and pixel-map sampling) stay raw, since they need exact colours.
    const useJpeg = maxDim > 512;
    snap = await invoke('native_renderer_get_frame_snapshot', {
      include_pixels: true,
      max_dim: maxDim,
      live_output: true,
      ...(useJpeg ? { encoding: 'jpeg', quality: 82 } : {}),
    }) as (Parameters<typeof decodeSnapshotInto>[0] & { jpeg_b64?: string }) | null;
  } catch (err) {
    failureStreak += 1;
    // Transient during core restarts; only worth a log line early on.
    if (failureStreak <= 2) {
      console.warn('[CompositeMirror] snapshot unavailable:', err);
    }
  } finally {
    // The next request may start while this frame decodes.
    inFlight = false;
    // A large frame can take longer than one tick at a high rate; then the
    // next one starts as soon as this lands instead of waiting a whole tick.
    if (timer && highRateRequests.size > 0 && pumpFps > 30 && performance.now() - lastPumpStart >= 1000 / pumpFps) {
      setTimeout(() => { if (timer) void pumpOnce(pumpMaxDim); }, 0);
    }
  }
  if (!snap) return;
  try {
    let decoded: boolean;
    if (snap.jpeg_b64) {
      decoded = await decodeJpegIntoIfNewer(snap, requestSeq);
    } else {
      decoded = requestSeq > drawnRequestSeq && decodeSnapshotInto(snap);
    }
    if (decoded) {
      drawnRequestSeq = requestSeq;
      failureStreak = 0;
      // Lets a consumer that draws every animation frame skip re-uploading
      // a picture it already has (the pump runs slower than the display).
      if (mirrorCanvas) (mirrorCanvas as any).__gaFrameSeq = ((mirrorCanvas as any).__gaFrameSeq ?? 0) + 1;
      frameInfo = { seq: (mirrorCanvas as any)?.__gaFrameSeq ?? 0, requestedAt, receivedAt: epochMs() };
      for (const listener of frameListeners) {
        try { listener(); } catch (error) { console.warn('[CompositeMirror] consumer failed:', error); }
      }
    }
  } catch (err) {
    failureStreak += 1;
    if (failureStreak <= 2) console.warn('[CompositeMirror] frame decode failed:', err);
  }
}

/** Re-time the pump to the fastest consumer. Small snapshots (LED and
 *  pixel-map sampling) may run up to 60fps; large ones stay at 30. */
function rearmPump(): void {
  if (fpsRequests.size === 0) return;
  const base = (baseOwner && dimRequests.get(baseOwner)) || basePumpMaxDim;
  const others = [...dimRequests.entries()].filter(([owner]) => owner !== baseOwner).map(([, dim]) => dim);
  pumpMaxDim = Math.max(base, ...others);
  const cap = pumpMaxDim > 512 && highRateRequests.size === 0 ? 30 : 60;
  const fps = Math.min(cap, Math.max(...fpsRequests.values()));
  if (timer && fps === pumpFps) return;
  if (timer) clearInterval(timer);
  pumpFps = fps;
  timer = setInterval(() => void pumpOnce(pumpMaxDim), Math.round(1000 / fps));
}

/** Hold a live mirror of the native composite. Call `release()` when done —
 *  the snapshot pump stops as soon as the last consumer lets go. */
export function acquireNativeCompositeMirror(
  options: { maxDim?: number; fps?: number; onFrame?: () => void } = {},
): CompositeMirrorHandle {
  const maxDim = Math.max(64, Math.min(2048, Math.round(options.maxDim ?? DEFAULT_MAX_DIM)));
  const fps = Math.max(1, Math.min(60, Math.round(options.fps ?? DEFAULT_FPS)));
  if (!mirrorCanvas) {
    mirrorCanvas = document.createElement('canvas');
    mirrorCanvas.width = maxDim;
    mirrorCanvas.height = Math.round((maxDim * 9) / 16);
    mirrorCtx = mirrorCanvas.getContext('2d');
  }
  consumers += 1;
  if (options.onFrame) frameListeners.add(options.onFrame);
  const request = {};
  if (!timer) {
    pumpMaxDim = maxDim;
    basePumpMaxDim = maxDim;
    baseOwner = request;
    void pumpOnce(maxDim);
  }
  fpsRequests.set(request, fps);
  rearmPump();
  let released = false;
  return {
    canvas: mirrorCanvas,
    update(next) {
      if (released) return;
      if (next.fps !== undefined) fpsRequests.set(request, Math.max(1, Math.min(60, Math.round(next.fps))));
      if (next.maxDim !== undefined) dimRequests.set(request, Math.max(64, Math.min(2048, Math.round(next.maxDim))));
      if (next.highRate !== undefined) {
        if (next.highRate) highRateRequests.add(request);
        else highRateRequests.delete(request);
      }
      rearmPump();
    },
    release() {
      if (released) return;
      released = true;
      if (options.onFrame) frameListeners.delete(options.onFrame);
      fpsRequests.delete(request);
      dimRequests.delete(request);
      highRateRequests.delete(request);
      consumers = Math.max(0, consumers - 1);
      if (consumers === 0 && timer) {
        clearInterval(timer);
        timer = null;
        pumpFps = 0;
      } else {
        rearmPump();
      }
    },
  };
}
