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
let inFlight = false;
let failureStreak = 0;
let scratch: ImageData | null = null;

function decodeSnapshotInto(snap: {
  rgba_b64?: string;
  width?: number;
  height?: number;
  format?: string;
  bytes_per_row?: number;
  padded_bytes_per_row?: number;
}): boolean {
  if (!snap?.rgba_b64 || !snap.width || !snap.height || !mirrorCanvas || !mirrorCtx) return false;
  const raw = atob(snap.rgba_b64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  const w = snap.width;
  const h = snap.height;
  const stride = snap.padded_bytes_per_row || snap.bytes_per_row || w * 4;
  const bgra = /bgra/i.test(String(snap.format ?? ''));
  if (mirrorCanvas.width !== w) mirrorCanvas.width = w;
  if (mirrorCanvas.height !== h) mirrorCanvas.height = h;
  if (!scratch || scratch.width !== w || scratch.height !== h) {
    scratch = new ImageData(w, h);
  }
  const out = scratch.data;
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
  mirrorCtx.putImageData(scratch, 0, 0);
  return true;
}

async function pumpOnce(maxDim: number): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    const snap = await invoke('native_renderer_get_frame_snapshot', {
      include_pixels: true,
      max_dim: maxDim,
    }) as Parameters<typeof decodeSnapshotInto>[0] | null;
    if (snap && decodeSnapshotInto(snap)) {
      failureStreak = 0;
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

/** Hold a live mirror of the native composite. Call `release()` when done —
 *  the snapshot pump stops as soon as the last consumer lets go. */
export function acquireNativeCompositeMirror(
  options: { maxDim?: number; fps?: number } = {},
): CompositeMirrorHandle {
  const maxDim = Math.max(64, Math.min(2048, Math.round(options.maxDim ?? DEFAULT_MAX_DIM)));
  const fps = Math.max(1, Math.min(30, Math.round(options.fps ?? DEFAULT_FPS)));
  if (!mirrorCanvas) {
    mirrorCanvas = document.createElement('canvas');
    mirrorCanvas.width = maxDim;
    mirrorCanvas.height = Math.round((maxDim * 9) / 16);
    mirrorCtx = mirrorCanvas.getContext('2d');
  }
  consumers += 1;
  if (!timer) {
    void pumpOnce(maxDim);
    timer = setInterval(() => void pumpOnce(maxDim), Math.round(1000 / fps));
  }
  let released = false;
  return {
    canvas: mirrorCanvas,
    release() {
      if (released) return;
      released = true;
      consumers = Math.max(0, consumers - 1);
      if (consumers === 0 && timer) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}
