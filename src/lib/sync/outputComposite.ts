/**
 * Output composite — the single chokepoint where the global master warp
 * is applied, editor-side, so EVERY output transport carries the same
 * already-warped pixels.
 *
 * Background: both projector-output paths capture from one canvas —
 *   • WebGPU shared-texture presenter  (registerEditorCanvas)
 *   • WebRTC fallback broadcast        (startOutputPixelBroadcast)
 * Historically that canvas was the raw editor `.main-canvas`, so the
 * main output window presented the un-warped composite.
 *
 * This module owns a dedicated 2D canvas. When the master warp is
 * enabled, the editor render loop calls `tickMasterWarpOutput(srcCanvas)`
 * once per frame — RIGHT AFTER the editor renders — drawing the warped
 * master composite into it (blendRenderer GPU warp + readback →
 * putImageData). Transports then capture from THIS canvas.
 *
 * Why the render loop and not our own rAF: the editor canvas is created
 * with preserveDrawingBuffer:false, so its pixels are only readable in
 * the same frame they're drawn. A standalone rAF fires at composite time
 * when the drawing buffer is already cleared → reading it yields BLACK.
 * The senders read the canvas in-loop for exactly this reason; the master
 * warp must too.
 *
 * When the warp is disabled the tick no-ops and callers fall back to the
 * raw editor canvas — preserving the WebGPU zero-copy fast path.
 */

import { renderMasterWarpPixels, isBlendRendererAvailable } from '../output/blendRenderer';
import type { OutputWarp } from '../stores/settings';

let outCanvas: HTMLCanvasElement | null = null;
let outCtx: CanvasRenderingContext2D | null = null;
let active = false;
let warpGetter: (() => OutputWarp | undefined) | null = null;
let sizeGetter: (() => { w: number; h: number }) | null = null;
// Reused ImageData for putImageData (copy into its backing .data to
// sidestep ArrayBuffer-vs-ArrayBufferLike typing and keep GC flat).
let scratchImage: ImageData | null = null;

function ensureOut(w: number, h: number) {
  if (!outCanvas) {
    outCanvas = document.createElement('canvas');
    outCanvas.className = 'master-warp-output';
    outCtx = outCanvas.getContext('2d', { alpha: false, desynchronized: true });
  }
  if (outCanvas.width !== w || outCanvas.height !== h) {
    outCanvas.width = w;
    outCanvas.height = h;
  }
}

/**
 * Mark the master-warp output active and return the dedicated canvas to
 * hand to the transports. Idempotent. Geometry/size are pulled lazily
 * each tick via the getters so live edits are picked up.
 */
export function startMasterWarpOutput(
  getWarp: () => OutputWarp | undefined,
  getSize: () => { w: number; h: number },
): HTMLCanvasElement {
  warpGetter = getWarp;
  sizeGetter = getSize;
  const size = getSize();
  ensureOut(Math.max(2, Math.round(size.w)), Math.max(2, Math.round(size.h)));
  active = true;
  return outCanvas!;
}

export function stopMasterWarpOutput(): void {
  active = false;
}

/**
 * Render one warped frame into the output canvas. MUST be called from the
 * editor render loop immediately after the editor canvas is drawn (see
 * file header). No-op unless the master warp is active. `src` is the live
 * editor canvas — read in-loop while its drawing buffer is still valid.
 */
export function tickMasterWarpOutput(src: HTMLCanvasElement): void {
  if (!active || !outCtx) return;
  const warp = warpGetter?.();
  const size = sizeGetter?.() ?? { w: 1920, h: 1080 };
  const w = Math.max(2, Math.round(size.w));
  const h = Math.max(2, Math.round(size.h));
  ensureOut(w, h);

  let drew = false;
  if (warp?.enabled && isBlendRendererAvailable()) {
    const px = renderMasterWarpPixels(src, warp, w, h);
    if (px) {
      const n = w * h * 4;
      if (!scratchImage || scratchImage.width !== w || scratchImage.height !== h) {
        scratchImage = new ImageData(w, h);
      }
      scratchImage.data.set(px.subarray(0, n));
      outCtx!.putImageData(scratchImage, 0, 0);
      drew = true;
    }
  }
  if (!drew) {
    // Warp off / GPU unavailable — passthrough so we never black out.
    try {
      outCtx!.drawImage(src, 0, 0, w, h);
    } catch {
      /* source not ready this frame — keep last frame */
    }
  }
}

/** The dedicated warped output canvas, or null before the first start. */
export function getMasterWarpCanvas(): HTMLCanvasElement | null {
  return outCanvas;
}

export function isMasterWarpRunning(): boolean {
  return active;
}
