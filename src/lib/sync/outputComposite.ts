/**
 * Output composite — the single chokepoint where the global master warp
 * is applied, editor-side, so EVERY output transport carries the same
 * already-warped pixels.
 *
 * Background: both projector-output paths capture from one canvas —
 *   • WebGPU shared-texture presenter  (registerEditorCanvas)
 *   • WebRTC fallback broadcast        (startOutputPixelBroadcast)
 * When the master warp is OFF, that canvas is the raw editor `.main-canvas`
 * (zero-copy fast path, untouched).
 *
 * When the warp is ON, blendRenderer owns a dedicated WebGL canvas and the
 * editor render loop calls `tickMasterWarpOutput(srcCanvas)` once per frame
 * — RIGHT AFTER the editor renders — to warp the editor canvas straight
 * onto that GPU canvas. The transports captureStream() that GPU canvas
 * DIRECTLY: no readPixels, no putImageData, no CPU round-trip (the warp
 * pass is the only extra GPU work, on par with the un-warped path).
 *
 * Why the render loop and not our own rAF: the editor canvas is created
 * with preserveDrawingBuffer:false, so its pixels are only sampleable in
 * the same frame they're drawn. A standalone rAF would sample a cleared
 * buffer → BLACK. The senders read the canvas in-loop for the same reason.
 */

import { renderMasterWarpToCanvas, ensureMasterWarpCanvas, getMasterWarpRenderCanvas, isBlendRendererAvailable, disposeMasterRenderer } from '../output/blendRenderer';
import type { OutputWarp } from '../stores/settings';
import { registerEditorCanvas, getOutputSharedTexturePresenterStats } from './outputSharedTexturePresenter';
import { startOutputPixelBroadcast, stopOutputPixelBroadcast } from './outputPixelBroadcast';

let active = false;
let warpGetter: (() => OutputWarp | undefined) | null = null;
let sizeGetter: (() => { w: number; h: number }) | null = null;

// ─── Debug ───────────────────────────────────────────────────────────────
// ON by default while the master-warp output is being debugged. Silence
// with `window.__MWARP_DEBUG__ = false` in devtools.
function mwDebug(): boolean {
  if (typeof window === 'undefined') return false;
  const flag = (window as any).__MWARP_DEBUG__;
  return flag !== false; // default true unless explicitly disabled
}
function mwlog(...args: unknown[]) {
  if (mwDebug()) console.log('[mwarp]', ...args);
}
let tickLogCounter = 0;

/**
 * Mark the master-warp output active and return the dedicated GPU canvas to
 * hand to the transports. Idempotent. Geometry/size are pulled lazily each
 * tick via the getters so live edits are picked up. The canvas is created
 * eagerly here (sized from getSize) so the transports can register it before
 * the first warp frame renders.
 */
export function startMasterWarpOutput(
  getWarp: () => OutputWarp | undefined,
  getSize: () => { w: number; h: number },
): HTMLCanvasElement | null {
  warpGetter = getWarp;
  sizeGetter = getSize;
  const size = getSize();
  const w = Math.max(2, Math.round(size.w));
  const h = Math.max(2, Math.round(size.h));
  const canvas = ensureMasterWarpCanvas(w, h);
  const was = active;
  active = true;
  if (!was) mwlog('startMasterWarpOutput → active', { w, h, canvas: !!canvas });
  return canvas;
}

export function stopMasterWarpOutput(): void {
  if (active) mwlog('stopMasterWarpOutput → inactive');
  active = false;
}

/** Full teardown for the dedicated master-warp renderer/canvas.
 *  Use this when the owning renderer/window is being destroyed; normal
 *  warp enable/disable should keep using stopMasterWarpOutput(). */
export function disposeMasterWarpOutput(...ownedCanvases: (HTMLCanvasElement | null | undefined)[]): void {
  if (ownedCanvases.length > 0 && lastBase && !ownedCanvases.includes(lastBase)) {
    return;
  }
  stopMasterWarpOutput();
  warpGetter = null;
  sizeGetter = null;
  disposeMasterRenderer();
  resetMasterWarpReconcile(...ownedCanvases);
}

/**
 * Warp one frame: render the live editor canvas through the forward master
 * warp directly onto the dedicated GPU canvas (zero-copy — the transports
 * capture that canvas). MUST be called from the editor render loop right
 * after the editor canvas is drawn. No-op unless the warp is active.
 */
export function tickMasterWarpOutput(src: HTMLCanvasElement): void {
  if (!active) return;
  const warp = warpGetter?.();
  const size = sizeGetter?.() ?? { w: 1920, h: 1080 };
  const w = Math.max(2, Math.round(size.w));
  const h = Math.max(2, Math.round(size.h));

  let drew = false;
  const avail = isBlendRendererAvailable();
  if (warp?.enabled && avail) {
    drew = !!renderMasterWarpToCanvas(src, warp, w, h);
  }
  // If the warp couldn't render (GPU unavailable / not enabled), there's
  // nothing to draw — the transports keep showing the last good frame
  // (preserveDrawingBuffer). The reconcile only registers this canvas when
  // the warp is active, so a disabled warp never reaches here.
  if (mwDebug() && tickLogCounter++ % 60 === 0) {
    console.log('[mwarp] tick — blendAvail=', avail, 'drew=', drew,
      'enabled=', warp?.enabled, 'srcW=', src?.width, 'srcH=', src?.height, 'out=', w, 'x', h);
  }
}

/** The dedicated warped output canvas, or null before the first render.
 *  Used by the sender path + the Screens-tab preview to read warped pixels.*/
export function getMasterWarpCanvas(): HTMLCanvasElement | null {
  return getMasterWarpRenderCanvas();
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

  // Warp active → capture the dedicated GPU warp canvas; if WebGL init
  // failed it returns null, so fall back to the raw editor canvas (output
  // un-warped beats output black). Warp inactive → raw editor canvas.
  const warpCanvas = warpActive ? startMasterWarpOutput(getWarp, getSize) : (stopMasterWarpOutput(), null);
  const source = warpCanvas ?? baseSource;
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

/** Reset the reconcile diff-gate on renderer teardown so the next owner
 *  re-registers from scratch. OWNER-SCOPED: both renderers (Canvas in
 *  bridgeMode, WebGPUCanvas) can be alive at once during the editorWebGPU
 *  {#if} swap. If the unmounting one resets unconditionally AFTER the
 *  survivor already registered, it wipes the survivor's gate and output
 *  freezes on the stale source until the next settings change. So only
 *  reset if the caller actually owns the current registration. Pass the
 *  canvas(es) this renderer might have registered; if none match lastBase,
 *  the survivor keeps its gate. Call with no arg to force-reset. */
export function resetMasterWarpReconcile(...ownedCanvases: (HTMLCanvasElement | null | undefined)[]): void {
  if (ownedCanvases.length > 0 && lastBase && !ownedCanvases.includes(lastBase)) {
    return; // Not our registration — leave the survivor's gate intact.
  }
  lastBase = null;
  lastFlags = '';
}
