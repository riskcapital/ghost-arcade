/**
 * Offline render-to-video pipeline.
 *
 * Instead of MediaRecorder capturing the live canvas at whatever FPS
 * the editor happens to deliver (with all the drops + variance that
 * implies), this pipeline deterministically advances ALL time-driven
 * state by exactly 1/fps seconds per frame and captures the result:
 *
 *   for frame in 0..totalFrames:
 *     virtualTime = frame / fps
 *     engine.manualTime          = virtualTime   ← shader iTime
 *     ISF.setISFManualTime       = virtualTime   ← ISF shaders' TIME
 *     stageEffects manualTime    = virtualTime   ← per-slice brightness
 *     keyframeTimeline.seek(virtualTime)
 *     layerSequencer.seek(virtualTime)
 *     (videos: per-frame seek — best-effort)
 *     await one RAF tick → live engine renders that frame
 *     canvas.toBlob('image/png')
 *     ffmpeg.writeFile(`frame_${idx}.png`, pngBytes)
 *   ffmpeg.exec(-framerate fps -i frame_%06d.png -c:v libx264 out.mp4)
 *   save Blob to media library + download
 *
 * Wall-clock pace stays one-frame-per-RAF in this MVP — so a 60 second
 * clip at 60fps takes ~60 seconds to render, same as live. The win is
 * DETERMINISM (no drops, exact timing) and the freedom to pick any
 * resolution (engine.resize before the loop). True slower-than-real
 * rendering for extreme-quality jobs is a follow-up — would require
 * pausing the live RAF and calling engine.render() directly per frame.
 */

import { writable, get } from 'svelte/store';
import { FFmpeg } from '@ffmpeg/ffmpeg';
// Vendor FFmpeg core locally via Vite asset imports. Loading from a
// CDN (unpkg) at runtime fails in packaged Electron — the renderer's
// default CSP + file:// origin blocks the cross-origin fetch and we
// surface "Failed to fetch" at the render-start moment. With Vite's
// ?url query the wasm + js are emitted into the bundle and we get
// back same-origin URLs we can pass straight to ffmpeg.load().
// The @ffmpeg/core package's `exports` field only exposes `.` (the
// JS) and `./wasm` (the WASM). Deep paths under ./dist/** are
// blocked by Node's exports resolution which Vite honors. Use the
// declared subpaths instead.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — Vite-specific ?url query, no .d.ts for it
import ffmpegCoreUrl from '@ffmpeg/core?url';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import ffmpegWasmUrl from '@ffmpeg/core/wasm?url';
import { setISFManualTime } from '../isf/renderer';
import { setStageEffectsManualTime } from '../stores/stageEffects';
import { keyframeTimeline } from '../stores/keyframeTimeline';
import { layerSequencer } from '../stores/layerSequencer';
import { mediaLibrary } from '../stores/media';
import { generateUUID } from '../utils/uuid';
import { createAssetRefFromGeneratedBlob } from '../storage/assetRegistry';
import type { RenderEngine } from '../renderer/engine';

// ─── Settings + state ───────────────────────────────────────

export interface OfflineRenderSettings {
  durationSeconds: number;
  fps: number;
  width: number;
  height: number;
  /** Output filename WITHOUT extension. ".mp4" appended automatically. */
  filename: string;
  /** Render quality tier. 'high' = libx264 yuv420p crf 18 (visually
   *  lossless), 'web' = crf 23 (smaller file), 'archive' = crf 14
   *  (close to lossless, big file). */
  quality: 'high' | 'web' | 'archive';
}

export const DEFAULT_OFFLINE_SETTINGS: OfflineRenderSettings = {
  durationSeconds: 10,
  fps: 30,
  width: 1920,
  height: 1080,
  filename: 'render',
  quality: 'high',
};

export type OfflineRenderStatus =
  | 'idle'
  | 'loading-ffmpeg'
  | 'rendering'
  | 'encoding'
  | 'saving'
  | 'complete'
  | 'cancelled'
  | 'error';

export interface OfflineRenderState {
  status: OfflineRenderStatus;
  totalFrames: number;
  currentFrame: number;
  /** Encode-phase progress 0..1. Separate from currentFrame so the
   *  modal can show meaningful progress during the libx264 wasm
   *  pass (slow — ~1-3× clip duration). Previously the bar froze
   *  at 100% (last captured-frame value) during encode and looked
   *  stuck even though work was happening. */
  encodeProgress: number;
  /** Wall-clock ms when start() was called — drives the elapsed
   *  display in the modal. */
  startedAtMs: number;
  errorMessage: string | null;
  /** Last completed output's blob URL (so the modal can show a
   *  preview + download link). Cleared on next start. */
  lastOutputUrl: string | null;
  lastOutputName: string | null;
}

const INITIAL_STATE: OfflineRenderState = {
  status: 'idle',
  totalFrames: 0,
  currentFrame: 0,
  encodeProgress: 0,
  startedAtMs: 0,
  errorMessage: null,
  lastOutputUrl: null,
  lastOutputName: null,
};

// ─── FFmpeg lazy loader ─────────────────────────────────────
// The wasm binary is ~30MB; load only when the user actually fires
// a render. Reuse across renders within a session.

let ffmpegInstance: FFmpeg | null = null;
/** Shared across this module AND the Demo Reel renderer
 *  (stageReelRender.ts) so the ~30MB wasm core loads once per session
 *  regardless of which pipeline fires first. */
export async function loadFFmpeg(): Promise<FFmpeg> {
  if (ffmpegInstance) return ffmpegInstance;
  const ffmpeg = new FFmpeg();
  // ffmpegCoreUrl / ffmpegWasmUrl come from Vite ?url imports at
  // the top of this file — same-origin, no fetch needed, works in
  // Electron prod where remote CDN fetches are blocked by CSP.
  // Earlier rev fetched from unpkg.com which surfaced "Failed to
  // fetch" the moment a user tried to render anything.
  await ffmpeg.load({
    coreURL: ffmpegCoreUrl,
    wasmURL: ffmpegWasmUrl,
  });
  ffmpegInstance = ffmpeg;
  return ffmpeg;
}

// ─── Store ──────────────────────────────────────────────────

function createOfflineRenderStore() {
  const { subscribe, update, set } = writable<OfflineRenderState>({ ...INITIAL_STATE });
  let cancelRequested = false;
  /** Reference to the live RenderEngine. Set by Canvas.svelte on
   *  mount via registerEngine — the offline pipeline needs to
   *  resize() it + read its DOM canvas + restore size at the end. */
  let engineRef: RenderEngine | null = null;
  let canvasRef: HTMLCanvasElement | null = null;

  function registerEngine(engine: RenderEngine, canvas: HTMLCanvasElement) {
    engineRef = engine;
    canvasRef = canvas;
  }

  /** Expose the registered engine/canvas to the Demo Reel renderer —
   *  it shares the same per-window engine registration. */
  function getEngine(): { engine: RenderEngine; canvas: HTMLCanvasElement } | null {
    return engineRef && canvasRef ? { engine: engineRef, canvas: canvasRef } : null;
  }

  function unregister() {
    engineRef = null;
    canvasRef = null;
  }

  function setStatus(status: OfflineRenderStatus, msg?: string) {
    update(s => ({ ...s, status, errorMessage: msg ?? null }));
  }

  /** Read the engine's composite render target as JPEG bytes.
   *
   *  Why JPEG and not raw RGBA: ffmpeg.wasm runs in a ~2GB heap.
   *  A 1080p RGBA frame is 8.3MB, so a 10s/30fps render produces
   *  ~2.5GB of raw pixel data — wasm OOMs partway through and we
   *  see `ErrnoError: FS error` from writeFile. JPEG at q≈0.92
   *  drops that to ~5-15% per frame (so the same job uses
   *  ~150-400MB), which fits comfortably.
   *
   *  Why we can't use canvas.toBlob('image/jpeg') directly on the
   *  WebGL canvas: the live engine creates its renderer with
   *  preserveDrawingBuffer:false (perf optimization), so the
   *  drawing buffer is cleared after compositing and toBlob would
   *  return blank bytes. Instead we readPixels from the engine's
   *  composite RenderTarget into CPU memory, splat that into a
   *  scratch 2D canvas via putImageData, and toBlob from THAT
   *  canvas — which has the bytes regardless of WebGL state. */
  let scratchCanvas: HTMLCanvasElement | null = null;
  let scratchCtx: CanvasRenderingContext2D | null = null;
  function getScratchCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
    if (!scratchCanvas) {
      scratchCanvas = document.createElement('canvas');
    }
    if (scratchCanvas.width !== w || scratchCanvas.height !== h) {
      scratchCanvas.width = w;
      scratchCanvas.height = h;
      scratchCtx = null;
    }
    if (!scratchCtx) {
      // willReadFrequently=false because we only WRITE to this
      // canvas, never readback from it.
      scratchCtx = scratchCanvas.getContext('2d', { willReadFrequently: false });
      if (!scratchCtx) throw new Error('Could not get 2d context for scratch canvas');
    }
    return { canvas: scratchCanvas, ctx: scratchCtx };
  }
  async function captureFrameJPEG(engine: RenderEngine, quality: number): Promise<Uint8Array> {
    const { width, height, data } = (engine as any).readCompositePixels() as { width: number; height: number; data: Uint8Array };
    const { canvas, ctx } = getScratchCanvas(width, height);
    // ImageData wants Uint8ClampedArray with the same byte layout
    // as the RGBA buffer we already produced — wrap the buffer
    // in-place to avoid a multi-MB copy per frame.
    const clamped = new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength);
    // Cast to satisfy TS's preference for Uint8ClampedArray<ArrayBuffer>
    // — the runtime is fine either way; this is purely the union-narrowing
    // overload resolution that gets cranky with byte-pointer constructors.
    const imgData = new ImageData(clamped as Uint8ClampedArray<ArrayBuffer>, width, height);
    ctx.putImageData(imgData, 0, 0);
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('toBlob returned null'));
          return;
        }
        blob.arrayBuffer().then(buf => resolve(new Uint8Array(buf))).catch(reject);
      }, 'image/jpeg', quality);
    });
  }

  /** Wait one animation frame so the live RAF loop has a chance to
   *  render with the freshly-set manualTime values. */
  function nextFrame(): Promise<void> {
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
  }

  async function start(settings: OfflineRenderSettings): Promise<boolean> {
    if (!engineRef || !canvasRef) {
      setStatus('error', 'Render engine not ready');
      return false;
    }
    const engine = engineRef;
    const canvas = canvasRef;
    const totalFrames = Math.max(1, Math.round(settings.durationSeconds * settings.fps));
    cancelRequested = false;
    set({
      ...INITIAL_STATE,
      status: 'loading-ffmpeg',
      totalFrames,
      currentFrame: 0,
      startedAtMs: performance.now(),
    });

    // Save state to restore after render so the live editor returns
    // to exactly how it was. Both engine size + the time overrides.
    const restoreWidth  = (engine as any).width  ?? canvas.width;
    const restoreHeight = (engine as any).height ?? canvas.height;
    const restoreManual = engine.manualTime;

    let ffmpeg: FFmpeg;
    try {
      ffmpeg = await loadFFmpeg();
    } catch (err) {
      setStatus('error', `FFmpeg load failed: ${formatErr(err)}`);
      return false;
    }
    if (cancelRequested) { _finish('cancelled'); return false; }

    setStatus('rendering');

    try {
      // Resize the engine to the offline resolution. Live editor will
      // briefly show this size; restored at the end. The engine.resize
      // path rebuilds all render targets cleanly.
      engine.resize(settings.width, settings.height);
      canvas.width = settings.width;
      canvas.height = settings.height;
      // Let the resize settle before the first capture.
      await nextFrame();

      // Pump frames into ffmpeg's virtual filesystem. Names need
      // %06d to support up to ~16 hour renders at 60fps without
      // changing the format string.
      for (let i = 0; i < totalFrames; i++) {
        if (cancelRequested) { _finish('cancelled'); return false; }
        const virtualTime = i / settings.fps;

        // Drive every time-dependent subsystem from the same virtual
        // clock. Engine = shader iTime; ISF = ISF shaders' TIME;
        // stage effects = per-slice brightness; keyframes + sequencer
        // = parameter / opacity overrides.
        engine.manualTime = virtualTime;
        setISFManualTime(virtualTime);
        setStageEffectsManualTime(virtualTime);
        keyframeTimeline.seek(virtualTime);
        layerSequencer.seek(virtualTime);

        // Wait one RAF so the live render loop picks up the new
        // state. (True offline-rate rendering — where we'd call
        // engine.render() directly without waiting for RAF — is a
        // follow-up; that path needs to bypass Canvas.svelte's
        // texture-update + composite stages entirely.)
        await nextFrame();

        // Capture the frame as a JPEG. Raw RGBA was 8MB/frame at
        // 1080p — 300 frames OOM'd the wasm heap (~2GB) with an
        // "ErrnoError: FS error" during writeFile. JPEG at q=0.92
        // is roughly 100KB-1MB/frame depending on content, fitting
        // the budget comfortably while still being near-lossless
        // for typical VJ output. The final MP4 quality is set by
        // libx264 CRF below, not by the intermediate JPEGs.
        const jpegBytes = await captureFrameJPEG(engine, 0.92);
        const frameName = `frame_${String(i).padStart(6, '0')}.jpg`;
        await ffmpeg.writeFile(frameName, jpegBytes);

        update(s => ({ ...s, currentFrame: i + 1 }));
      }

      if (cancelRequested) { _finish('cancelled'); return false; }

      // Encode. libx264 + yuv420p produces the broadest-compatible
      // MP4 (Quicktime, browsers, ffmpeg-built-in decoders). crf
      // picks quality vs. file size — lower = better.
      //
      // Subscribe to ffmpeg's progress events for the duration of
      // this exec call so the modal's bar reflects actual encoder
      // progress instead of staying frozen at the last captured-
      // frame value (100%). filter_complex / xfade have known
      // overshoot issues with this event but the straight-through
      // image-sequence-to-libx264 pipeline gives clean 0..1.
      setStatus('encoding');
      update(s => ({ ...s, encodeProgress: 0 }));
      const encodeProgressHandler = ({ progress }: { progress: number }) => {
        // Clamp — even on the simple pipeline ffmpeg occasionally
        // reports slightly out-of-range values on the last frame.
        const p = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
        update(s => ({ ...s, encodeProgress: p }));
      };
      ffmpeg.on('progress', encodeProgressHandler);

      const crf = settings.quality === 'archive' ? '14' : settings.quality === 'web' ? '23' : '18';
      const outputName = `${settings.filename || 'render'}.mp4`;
      try {
        await ffmpeg.exec([
          '-framerate', String(settings.fps),
          '-i', 'frame_%06d.jpg',
          '-c:v', 'libx264',
          '-pix_fmt', 'yuv420p',
          '-crf', crf,
          '-preset', settings.quality === 'archive' ? 'slow' : 'medium',
          outputName,
        ]);
      } finally {
        ffmpeg.off('progress', encodeProgressHandler);
      }
      update(s => ({ ...s, encodeProgress: 1 }));
      if (cancelRequested) { _finish('cancelled'); return false; }

      setStatus('saving');
      const data = await ffmpeg.readFile(outputName);
      // ffmpeg.readFile returns Uint8Array; wrap in a Blob for save.
      const u8 = data instanceof Uint8Array ? data : new Uint8Array(data as any);
      const blob = new Blob([u8], { type: 'video/mp4' });
      const url = URL.createObjectURL(blob);

      // Capture a thumbnail mid-clip for the media library row.
      const thumbnail = await thumbnailFromBlob(blob, url, Math.min(2, settings.durationSeconds * 0.4));

      const niceName = `${settings.filename || 'Offline Render'} ${new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-')}`;
      const { assetRef } = await createAssetRefFromGeneratedBlob(
        blob, `${niceName}.mp4`, 'video/mp4', url,
      );
      mediaLibrary.addItem({
        id: generateUUID(),
        name: niceName,
        type: 'video',
        src: url,
        thumbnail,
        _assetRef: assetRef,
      });

      // Trigger a download too — users usually want the file
      // outside the project's media library.
      downloadBlob(blob, `${niceName}.mp4`);

      // Cleanup ffmpeg virtual filesystem so subsequent renders
      // don't accumulate gigabytes of PNG state across sessions.
      try {
        for (let i = 0; i < totalFrames; i++) {
          await ffmpeg.deleteFile(`frame_${String(i).padStart(6, '0')}.jpg`);
        }
        await ffmpeg.deleteFile(outputName);
      } catch (e) { /* best-effort */ }

      update(s => ({ ...s, status: 'complete', lastOutputUrl: url, lastOutputName: niceName }));
      return true;
    } catch (err) {
      console.error('[offlineRender] error:', err);
      setStatus('error', formatErr(err));
      return false;
    } finally {
      // Always restore engine state so the live editor returns to
      // normal regardless of how the render ended.
      engine.manualTime = restoreManual;
      setISFManualTime(null);
      setStageEffectsManualTime(null);
      try { engine.resize(restoreWidth, restoreHeight); } catch (e) { /* nothing we can do */ }
    }
  }

  function _finish(status: OfflineRenderStatus) {
    update(s => ({ ...s, status }));
  }

  function cancel() {
    cancelRequested = true;
  }

  function reset() {
    set({ ...INITIAL_STATE });
  }

  return {
    subscribe,
    start,
    cancel,
    reset,
    registerEngine,
    unregister,
    getEngine,
  };
}

// Local helpers (not part of the store API surface).

/** Coerce any thrown value into a useful display string. Native
 *  Error.message works in the common case but Emscripten's
 *  `ErrnoError` (what ffmpeg.wasm throws on FS failures) has
 *  `.message` empty + the useful text in `.name` or via String(err).
 *  Earlier rev showed a blank red banner when this fired; users
 *  saw "Render failed" with no clue what to do. */
export function formatErr(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as { message?: unknown; name?: unknown; errno?: unknown };
    if (typeof e.message === 'string' && e.message.length > 0) return e.message;
    if (typeof e.name === 'string' && e.name.length > 0) {
      const errnoSuffix = typeof e.errno === 'number' ? ` (errno ${e.errno})` : '';
      return `${e.name}${errnoSuffix}`;
    }
  }
  try { return String(err); } catch { return 'Unknown error'; }
}


export async function thumbnailFromBlob(blob: Blob, url: string, atSeconds: number): Promise<string | undefined> {
  // `url` stays alive after this returns — it's the media-library item's
  // src. Only the temporary <video> below must be released.
  const v = document.createElement('video');
  try {
    v.src = url;
    v.muted = true;
    await new Promise<void>((resolve, reject) => {
      v.onloadeddata = () => resolve();
      v.onerror = () => reject(new Error('thumb video load'));
    });
    v.currentTime = atSeconds;
    await new Promise<void>((resolve) => { v.onseeked = () => resolve(); });
    const c = document.createElement('canvas');
    c.width = 160; c.height = 90;
    const ctx = c.getContext('2d');
    if (!ctx) return undefined;
    ctx.drawImage(v, 0, 0, 160, 90);
    return c.toDataURL('image/jpeg', 0.7);
  } catch {
    return undefined;
  } finally {
    v.onloadeddata = null;
    v.onerror = null;
    v.onseeked = null;
    try { v.pause(); } catch { /* ignore */ }
    v.removeAttribute('src');
    try { v.load(); } catch { /* ignore */ }
  }
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 1000);
}

export const offlineRender = createOfflineRenderStore();
