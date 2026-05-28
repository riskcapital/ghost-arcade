/**
 * Output composite — the single chokepoint where the global master warp
 * is applied, editor-side, so EVERY output transport carries the same
 * already-warped pixels.
 *
 * Background: both projector-output paths capture from one canvas —
 *   • WebGPU shared-texture presenter  (registerEditorCanvas)
 *   • WebRTC fallback broadcast        (startOutputPixelBroadcast)
 * Historically that canvas was the raw editor `.main-canvas`, so the
 * main output window presented the un-warped composite — the master
 * warp only ever touched the sender / slice-display paths.
 *
 * This module owns a dedicated 2D canvas and a rAF pump that, when the
 * master warp is enabled, draws the warped master composite into it each
 * frame (via blendRenderer's GPU warp + readback). Transports then
 * capture from THIS canvas instead of the editor canvas. When the warp
 * is disabled the pump is stopped and callers fall back to the raw
 * editor canvas — preserving the WebGPU zero-copy fast path for the
 * common no-warp case.
 *
 * The GPU-pass-plus-readback cost (~one 2D putImageData per frame at
 * master-canvas resolution) is the deliberate, accepted trade for a
 * single source of truth that works identically on both transports.
 */

import { renderMasterWarpPixels, isBlendRendererAvailable } from '../output/blendRenderer';
import type { OutputWarp } from '../stores/settings';

let outCanvas: HTMLCanvasElement | null = null;
let outCtx: CanvasRenderingContext2D | null = null;
let rafId = 0;
let running = false;
let srcCanvas: HTMLCanvasElement | null = null;
let warpGetter: (() => OutputWarp | undefined) | null = null;
let sizeGetter: (() => { w: number; h: number }) | null = null;
// Reused ImageData for putImageData. We copy the renderer's readback
// into its backing .data (rather than constructing ImageData from a
// typed-array view) so we sidestep the ArrayBuffer-vs-ArrayBufferLike
// typing and keep per-frame GC flat.
let scratchImage: ImageData | null = null;

function ensureOut(w: number, h: number) {
  if (!outCanvas) {
    outCanvas = document.createElement('canvas');
    outCanvas.className = 'master-warp-output';
    // alpha:false — output is opaque; desynchronized lowers present
    // latency for a canvas that's only ever captureStream'd, never
    // composited into the editor DOM.
    outCtx = outCanvas.getContext('2d', { alpha: false, desynchronized: true });
  }
  if (outCanvas.width !== w || outCanvas.height !== h) {
    outCanvas.width = w;
    outCanvas.height = h;
  }
}

function frame() {
  rafId = 0;
  if (!running) return;

  const warp = warpGetter?.();
  const size = sizeGetter?.() ?? { w: 1920, h: 1080 };
  const w = Math.max(2, Math.round(size.w));
  const h = Math.max(2, Math.round(size.h));
  ensureOut(w, h);

  if (srcCanvas && outCtx) {
    let drew = false;
    if (warp?.enabled && isBlendRendererAvailable()) {
      const px = renderMasterWarpPixels(srcCanvas, warp, w, h);
      if (px) {
        // px is blendRenderer's reused readback buffer, top-down (already
        // row-flipped). Copy into the ImageData's own backing store.
        const n = w * h * 4;
        if (!scratchImage || scratchImage.width !== w || scratchImage.height !== h) {
          scratchImage = new ImageData(w, h);
        }
        scratchImage.data.set(px.subarray(0, n));
        outCtx.putImageData(scratchImage, 0, 0);
        drew = true;
      }
    }
    if (!drew) {
      // Warp disabled mid-pump or GPU readback failed — passthrough so a
      // transient failure never blacks out the projector. (Steady-state
      // disabled is handled by stopping the pump entirely.)
      try {
        outCtx.drawImage(srcCanvas, 0, 0, w, h);
      } catch {
        /* source canvas not ready yet — leave last frame */
      }
    }
  }

  rafId = requestAnimationFrame(frame);
}

/**
 * Start (or re-point) the master-warp pump. Idempotent — safe to call on
 * every settings change; only the first call starts the rAF loop. Returns
 * the dedicated warped output canvas to hand to the transports.
 */
export function startMasterWarpOutput(
  src: HTMLCanvasElement,
  getWarp: () => OutputWarp | undefined,
  getSize: () => { w: number; h: number },
): HTMLCanvasElement {
  srcCanvas = src;
  warpGetter = getWarp;
  sizeGetter = getSize;
  const size = getSize();
  ensureOut(Math.max(2, Math.round(size.w)), Math.max(2, Math.round(size.h)));
  if (!running) {
    running = true;
    rafId = requestAnimationFrame(frame);
  }
  return outCanvas!;
}

/** Stop the pump. The canvas is retained so a later restart reuses it. */
export function stopMasterWarpOutput(): void {
  running = false;
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
}

/** The dedicated warped output canvas, or null before the first start. */
export function getMasterWarpCanvas(): HTMLCanvasElement | null {
  return outCanvas;
}

export function isMasterWarpRunning(): boolean {
  return running;
}
