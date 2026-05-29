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
import { registerEditorCanvas, getOutputSharedTexturePresenterStats } from './outputSharedTexturePresenter';
import { startOutputPixelBroadcast, stopOutputPixelBroadcast } from './outputPixelBroadcast';

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

// ─── Debug ───────────────────────────────────────────────────────────────
// OFF by default; enable with `window.__MWARP_DEBUG__ = true` in devtools
// when diagnosing the master-warp pipeline.
function mwDebug(): boolean {
  return typeof window !== 'undefined' && (window as any).__MWARP_DEBUG__ === true;
}
function mwlog(...args: unknown[]) {
  if (mwDebug()) console.log('[mwarp]', ...args);
}
let tickLogCounter = 0;

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
  const was = active;
  active = true;
  if (!was) mwlog('startMasterWarpOutput → active', { w: outCanvas?.width, h: outCanvas?.height });
  return outCanvas!;
}

export function stopMasterWarpOutput(): void {
  if (active) mwlog('stopMasterWarpOutput → inactive');
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
  let pxOk = false;
  const avail = isBlendRendererAvailable();
  if (warp?.enabled && avail) {
    const px = renderMasterWarpPixels(src, warp, w, h);
    if (px) {
      const n = w * h * 4;
      if (!scratchImage || scratchImage.width !== w || scratchImage.height !== h) {
        scratchImage = new ImageData(w, h);
      }
      scratchImage.data.set(px.subarray(0, n));
      outCtx!.putImageData(scratchImage, 0, 0);
      drew = true;
      pxOk = true;
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
  // Throttled heartbeat (~1/sec at 60fps). Flat args so the console can't
  // collapse the important fields behind a "…".
  if (mwDebug() && tickLogCounter++ % 60 === 0) {
    console.log('[mwarp] tick — blendAvail=', avail, 'pxOk=', pxOk, 'drew=', drew,
      'enabled=', warp?.enabled, 'mode=', warp?.mode, 'srcW=', src?.width, 'srcH=', src?.height,
      'outW=', outCanvas?.width, 'outH=', outCanvas?.height);
  }
}

/** The dedicated warped output canvas, or null before the first start. */
export function getMasterWarpCanvas(): HTMLCanvasElement | null {
  return outCanvas;
}

export function isMasterWarpRunning(): boolean {
  return active;
}

// ─── Single output-registration owner ───────────────────────────────────
// Both the WebGL editor renderer (Canvas.svelte) and the WebGPU pilot
// (WebGPUCanvas.svelte, when experimental.editorWebGPU is on) can be the
// "final present surface" the output transports capture. Whichever owns
// output calls this on settings changes; it registers the master-warp
// canvas (when the warp is active) or the renderer's raw `baseSource`
// otherwise, with BOTH the WebGPU shared-texture presenter and the WebRTC
// fallback. Centralizing here prevents the two renderers from fighting
// over registerEditorCanvas (which is what made the master warp silently
// do nothing in WebGPU-pilot mode).
let lastBase: HTMLCanvasElement | null = null;
let lastFlags = '';
let webrtcOn = false;

export function reconcileMasterWarpOutput(opts: {
  baseSource: HTMLCanvasElement;
  warpActive: boolean;
  zeroCopy: boolean;
  webrtc: boolean;
  getWarp: () => OutputWarp | undefined;
  getSize: () => { w: number; h: number };
  perf?: {
    frameRate?: number;
    maxBitrate?: number;
    degradationPreference?: 'maintain-resolution' | 'maintain-framerate' | 'balanced';
    codecPreference?: 'auto' | 'h264' | 'vp8';
  };
}): void {
  const { baseSource, warpActive, zeroCopy, webrtc, getWarp, getSize, perf } = opts;
  const flags = `${warpActive ? 1 : 0}${zeroCopy ? 1 : 0}${webrtc ? 1 : 0}`;
  // Diff-gate: only act when the source surface or the flags change.
  if (baseSource === lastBase && flags === lastFlags) {
    return;
  }
  mwlog('reconcile', {
    base: baseSource?.className || baseSource?.id || 'canvas',
    warpActive, zeroCopy, webrtc,
    prevFlags: lastFlags, newFlags: flags,
    baseChanged: baseSource !== lastBase,
  });
  lastBase = baseSource;
  lastFlags = flags;

  const source = warpActive ? startMasterWarpOutput(getWarp, getSize) : (stopMasterWarpOutput(), baseSource);
  const fps = perf?.frameRate ?? 60;
  registerEditorCanvas(source, fps);
  const st = getOutputSharedTexturePresenterStats();
  mwlog('registered', warpActive ? 'WARPED outCanvas' : 'base source', {
    w: source.width, h: source.height,
    presenterActive: st.active, pumpRunning: st.pumpRunning,
    targetAttached: st.targetAttached, portConnected: st.portConnected,
  });

  const wantWebRTC = !zeroCopy && webrtc;
  if (wantWebRTC) {
    startOutputPixelBroadcast(source, fps, {
      maxBitrate: perf?.maxBitrate,
      degradationPreference: perf?.degradationPreference,
      codecPreference: perf?.codecPreference,
    });
    webrtcOn = true;
  } else if (webrtcOn) {
    stopOutputPixelBroadcast();
    webrtcOn = false;
  }
}

/** Reset the reconcile diff-gate — call when output ownership tears down
 *  (renderer unmount) so the next owner re-registers from scratch. */
export function resetMasterWarpReconcile(): void {
  lastBase = null;
  lastFlags = '';
}
