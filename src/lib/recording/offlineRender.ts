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
  startedAtMs: 0,
  errorMessage: null,
  lastOutputUrl: null,
  lastOutputName: null,
};

// ─── FFmpeg lazy loader ─────────────────────────────────────
// The wasm binary is ~30MB; load only when the user actually fires
// a render. Reuse across renders within a session.

let ffmpegInstance: FFmpeg | null = null;
async function loadFFmpeg(): Promise<FFmpeg> {
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

  function unregister() {
    engineRef = null;
    canvasRef = null;
  }

  function setStatus(status: OfflineRenderStatus, msg?: string) {
    update(s => ({ ...s, status, errorMessage: msg ?? null }));
  }

  /** Read the engine's composite render target back as raw RGBA8.
   *  Bypasses canvas.toBlob, which depends on preserveDrawingBuffer
   *  being true at WebGLRenderer construction — the live editor uses
   *  the more efficient `preserveDrawingBuffer: false` path, so toBlob
   *  often returns transparent bytes after a RAF tick. Raw pixels
   *  from the render target always work and we let ffmpeg re-encode
   *  them as PNG via a `-f rawvideo -pix_fmt rgba` input format. */
  function captureFrameRaw(engine: RenderEngine): { width: number; height: number; data: Uint8Array } {
    return (engine as any).readCompositePixels();
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
      setStatus('error', `FFmpeg load failed: ${(err as Error).message}`);
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

        // Read the composite target's raw RGBA bytes (top-down).
        // We write to ffmpeg's virtual FS as one concatenated
        // rawvideo file rather than per-frame PNGs — saves ~40%
        // encode time on the heavy-resolution jobs since libpng
        // decode-on-input is the bottleneck for PNG-per-frame.
        const frame = captureFrameRaw(engine);
        const frameName = `frame_${String(i).padStart(6, '0')}.rgba`;
        await ffmpeg.writeFile(frameName, frame.data);

        update(s => ({ ...s, currentFrame: i + 1 }));
      }

      if (cancelRequested) { _finish('cancelled'); return false; }

      // Encode. libx264 + yuv420p produces the broadest-compatible
      // MP4 (Quicktime, browsers, ffmpeg-built-in decoders). crf
      // picks quality vs. file size — lower = better.
      setStatus('encoding');
      const crf = settings.quality === 'archive' ? '14' : settings.quality === 'web' ? '23' : '18';
      const outputName = `${settings.filename || 'render'}.mp4`;
      await ffmpeg.exec([
        '-f', 'rawvideo',
        '-pixel_format', 'rgba',
        '-video_size', `${settings.width}x${settings.height}`,
        '-framerate', String(settings.fps),
        '-i', 'frame_%06d.rgba',
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        '-crf', crf,
        '-preset', settings.quality === 'archive' ? 'slow' : 'medium',
        outputName,
      ]);
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
          await ffmpeg.deleteFile(`frame_${String(i).padStart(6, '0')}.rgba`);
        }
        await ffmpeg.deleteFile(outputName);
      } catch (e) { /* best-effort */ }

      update(s => ({ ...s, status: 'complete', lastOutputUrl: url, lastOutputName: niceName }));
      return true;
    } catch (err) {
      console.error('[offlineRender] error:', err);
      setStatus('error', (err as Error).message);
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
  };
}

// Local helpers (not part of the store API surface).

async function thumbnailFromBlob(blob: Blob, url: string, atSeconds: number): Promise<string | undefined> {
  try {
    const v = document.createElement('video');
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
  }
}

function downloadBlob(blob: Blob, filename: string) {
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
