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

export interface CompositeMirrorHandle {
  canvas: HTMLCanvasElement;
  release(): void;
}

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

function decodeSnapshotInto(snap: SnapshotPixels): boolean {
  if (!mirrorCanvas || !mirrorCtx) return false;
  const image = drawSnapshotToCanvas(snap, mirrorCanvas, mirrorCtx, scratch);
  if (!image) return false;
  scratch = image;
  return true;
}

async function pumpOnce(maxDim: number): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    const snap = await invoke('native_renderer_get_frame_snapshot', {
      include_pixels: true,
      max_dim: maxDim,
      live_output: true,
    }) as Parameters<typeof decodeSnapshotInto>[0] | null;
    if (snap && decodeSnapshotInto(snap)) {
      failureStreak = 0;
      for (const listener of frameListeners) {
        try { listener(); } catch (error) { console.warn('[CompositeMirror] consumer failed:', error); }
      }
    }
  } catch (err) {
    failureStreak += 1;
    // Transient during core restarts; only worth a log line early on.
    if (failureStreak <= 2) {
      console.warn('[CompositeMirror] snapshot unavailable:', err);
    }
  } finally {
    inFlight = false;
  }
}

/** Re-time the pump to the fastest consumer. Small snapshots (LED and
 *  pixel-map sampling) may run up to 60fps; large ones stay at 30. */
function rearmPump(): void {
  if (fpsRequests.size === 0) return;
  const cap = pumpMaxDim > 512 ? 30 : 60;
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
    void pumpOnce(maxDim);
  }
  fpsRequests.set(request, fps);
  rearmPump();
  let released = false;
  return {
    canvas: mirrorCanvas,
    release() {
      if (released) return;
      released = true;
      if (options.onFrame) frameListeners.delete(options.onFrame);
      fpsRequests.delete(request);
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
