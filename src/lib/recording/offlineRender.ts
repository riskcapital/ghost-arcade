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
import { vjLayerSequencer } from '../stores/vjLayerSequencer';
import { mediaLibrary } from '../stores/media';
import { generateUUID } from '../utils/uuid';
import { createAssetRefFromGeneratedBlob } from '../storage/assetRegistry';
import type { RenderEngine } from '../renderer/engine';
import { invoke, isElectron } from '../bridge';
import {
  exportNativeRendererFrameSnapshot,
  getNativeRendererCapabilities,
  getNativeRendererStatus,
  submitNativeRendererCommands,
  type NativeRendererFrameSnapshotExportResult,
} from '../api/native-renderer';

// ─── Settings + state ───────────────────────────────────────

export interface OfflineRenderSettings {
  durationSeconds: number;
  fps: number;
  width: number;
  height: number;
  /** Output filename WITHOUT extension. ".mp4" appended automatically. */
  filename: string;
  /** MP4 encodes in-app via ffmpeg.wasm. Frame sequence writes JPEGs
   *  directly to a folder so 4K jobs avoid the slow wasm encode step. */
  outputMode: 'mp4' | 'frames';
  /** Render quality tier. 'high' = libx264 yuv420p crf 18 (visually
   *  lossless), 'web' = crf 23 (smaller file), 'archive' = crf 14
   *  (close to lossless, big file). */
  quality: 'high' | 'web' | 'archive';
  /** JPEG frame source. The desktop-only native option captures the native
   *  renderer output directly; MP4 export still uses the WebGL compositor. */
  captureBackend?: 'webgl' | 'native';
}

export const DEFAULT_OFFLINE_SETTINGS: OfflineRenderSettings = {
  durationSeconds: 10,
  fps: 30,
  width: 1920,
  height: 1080,
  filename: 'render',
  outputMode: 'mp4',
  quality: 'high',
  captureBackend: 'webgl',
};

const MAX_SEGMENT_FRAMES = 180;
const TARGET_SEGMENT_FRAME_PIXELS = 1920 * 1080 * 180;

export function getOfflineSegmentFrameCount(settings: Pick<OfflineRenderSettings, 'width' | 'height' | 'fps'>): number {
  const pixels = Math.max(1, settings.width * settings.height);
  const byPixels = Math.max(12, Math.floor(TARGET_SEGMENT_FRAME_PIXELS / pixels));
  const byTime = Math.max(1, Math.ceil(settings.fps * 2));
  return Math.max(1, Math.min(MAX_SEGMENT_FRAMES, byTime, byPixels));
}

export type OfflineRenderStatus =
  | 'idle'
  | 'choosing-folder'
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
  lastOutputKind: 'video' | 'frames' | null;
  lastOutputPath: string | null;
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
  lastOutputKind: null,
  lastOutputPath: null,
};

export interface FrameSequenceTarget {
  kind: 'electron' | 'browser';
  name: string;
  path?: string;
  handle?: any;
}

export interface NativeJpegSequenceSession {
  jobId: string;
  baseName: string;
  target: FrameSequenceTarget;
  width: number;
  height: number;
  fps: number;
  totalFrames: number;
  pixelFormat: 'rgba' | 'bgra';
}

function rawPixelFormatForNativeTextureFormat(format: string): 'rgba' | 'bgra' {
  const normalized = String(format || '').trim().toLowerCase();
  if (normalized.includes('bgra')) return 'bgra';
  if (normalized.includes('rgba')) return 'rgba';
  throw new Error(`Native renderer output format is not supported for JPEG sequence capture: ${format || 'unknown'}`);
}

function sanitizeFilenamePart(input: string, fallback = 'render'): string {
  return (input || fallback)
    .trim()
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || fallback;
}

export function describeFrameTarget(target: FrameSequenceTarget): string {
  return target.path || target.name;
}

export async function chooseFrameSequenceTarget(): Promise<FrameSequenceTarget | null> {
  if (isElectron && window.electronAPI) {
    const picked = await invoke<{ path: string; name: string } | null>('pick_directory');
    if (!picked?.path) return null;
    return { kind: 'electron', path: picked.path, name: picked.name || picked.path };
  }

  if (!('showDirectoryPicker' in window)) {
    throw new Error('Folder export requires the desktop app or a browser with folder-write support.');
  }

  const handle = await (window as any).showDirectoryPicker({
    mode: 'readwrite',
    startIn: 'videos',
  });
  return { kind: 'browser', handle, name: handle.name || 'selected folder' };
}

export async function writeFrameTargetBytes(target: FrameSequenceTarget, filename: string, bytes: Uint8Array): Promise<void> {
  if (target.kind === 'electron') {
    if (!target.path) throw new Error('Frame export folder path is missing');
    const result = await invoke<{ success?: boolean; error?: string }>('save_file_bytes', {
      path: `${target.path}/${filename}`,
      bytes,
    });
    if (!result?.success) throw new Error(result?.error || `Could not save ${filename}`);
    return;
  }

  const fileHandle = await target.handle.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' }));
  await writable.close();
}

export async function writeFrameTargetText(target: FrameSequenceTarget, filename: string, text: string): Promise<void> {
  if (target.kind === 'electron') {
    if (!target.path) throw new Error('Frame export folder path is missing');
    const result = await invoke<{ success?: boolean; error?: string }>('save_file_text', {
      path: `${target.path}/${filename}`,
      content: text,
    });
    if (!result?.success) throw new Error(result?.error || `Could not save ${filename}`);
    return;
  }

  const fileHandle = await target.handle.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(text);
  await writable.close();
}

export async function startNativeJpegSequence(
  target: FrameSequenceTarget,
  settings: Pick<OfflineRenderSettings, 'width' | 'height' | 'fps'>,
  baseName: string,
  totalFrames: number,
  pixelFormat: 'rgba' | 'bgra' = 'rgba',
): Promise<NativeJpegSequenceSession | null> {
  if (target.kind !== 'electron' || !target.path || !isElectron) return null;
  const jobId = `jpeg-seq-${generateUUID()}`;
  const result = await invoke<{ success?: boolean; error?: string }>('jpeg_sequence_start', {
    jobId,
    folderPath: target.path,
    baseName,
    width: settings.width,
    height: settings.height,
    fps: settings.fps,
    totalFrames,
    pixelFormat,
  });
  if (!result?.success) {
    throw new Error(result?.error || 'Could not start native JPEG sequence encoder');
  }
  return {
    jobId,
    baseName,
    target,
    width: settings.width,
    height: settings.height,
    fps: settings.fps,
    totalFrames,
    pixelFormat,
  };
}

export async function writeNativeJpegSequenceFrame(
  session: NativeJpegSequenceSession,
  frameIndex: number,
  pixels: { width: number; height: number; data: Uint8Array },
): Promise<void> {
  const result = await invoke<{ success?: boolean; error?: string }>('jpeg_sequence_write_frame', {
    jobId: session.jobId,
    frameIndex,
    bytes: pixels.data,
    pixelFormat: session.pixelFormat,
  });
  if (!result?.success) {
    throw new Error(result?.error || `Could not write JPEG frame ${frameIndex}`);
  }
}

export async function writeNativeJpegSequenceFrameFile(
  session: NativeJpegSequenceSession,
  frameIndex: number,
  path: string,
  deleteAfterWrite = false,
): Promise<void> {
  const result = await invoke<{ success?: boolean; error?: string }>('jpeg_sequence_write_frame_file', {
    jobId: session.jobId,
    frameIndex,
    path,
    pixelFormat: session.pixelFormat,
    deleteAfterWrite,
  });
  if (!result?.success) {
    throw new Error(result?.error || `Could not write JPEG frame file ${frameIndex}`);
  }
}

export async function writeNativeRendererJpegSequenceFrame(
  session: NativeJpegSequenceSession,
  frameIndex: number,
  timeSeconds: number,
): Promise<NativeRendererFrameSnapshotExportResult> {
  if (session.target.kind !== 'electron' || !session.target.path) {
    throw new Error('Native renderer frame capture requires the desktop app frame-sequence encoder');
  }
  const rawName = `.${session.baseName}_${session.jobId}_${String(frameIndex).padStart(6, '0')}.${session.pixelFormat}`;
  const rawPath = `${session.target.path}/${rawName}`;
  const snapshot = await exportNativeRendererFrameSnapshot(rawPath, {
    time: timeSeconds,
    frame_index: frameIndex,
  });
  if (snapshot.width !== session.width || snapshot.height !== session.height) {
    throw new Error(
      `Native renderer frame ${frameIndex} size mismatch: got ${snapshot.width}x${snapshot.height}, expected ${session.width}x${session.height}`,
    );
  }
  if (snapshot.dark_frame || snapshot.nonzero_pixels <= 0) {
    throw new Error(`Native renderer exported a blank frame at ${frameIndex}`);
  }
  const snapshotPixelFormat = rawPixelFormatForNativeTextureFormat(snapshot.format);
  if (snapshotPixelFormat !== session.pixelFormat) {
    throw new Error(
      `Native renderer frame ${frameIndex} format changed from ${session.pixelFormat} to ${snapshotPixelFormat} (${snapshot.format})`,
    );
  }
  await writeNativeJpegSequenceFrameFile(session, frameIndex, rawPath, true);
  return snapshot;
}

export async function finishNativeJpegSequence(session: NativeJpegSequenceSession): Promise<void> {
  const result = await invoke<{ success?: boolean; error?: string }>('jpeg_sequence_finish', {
    jobId: session.jobId,
  });
  if (!result?.success) {
    throw new Error(result?.error || 'Could not finalize native JPEG sequence');
  }
}

export async function cancelNativeJpegSequence(session: NativeJpegSequenceSession): Promise<void> {
  await invoke('jpeg_sequence_cancel', { jobId: session.jobId }).catch(() => {});
}

export function frameSequenceManifest(args: {
  baseName: string;
  fps: number;
  width: number;
  height: number;
  totalFrames: number;
  quality: OfflineRenderSettings['quality'];
}): string {
  const crf = args.quality === 'archive' ? '14' : args.quality === 'web' ? '23' : '18';
  return [
    'Ghost Arcade frame sequence',
    '',
    `Base name: ${args.baseName}`,
    `Frames: ${args.totalFrames}`,
    `Frame rate: ${args.fps}`,
    `Resolution: ${args.width}x${args.height}`,
    '',
    'Compile to MP4 with:',
    `ffmpeg -framerate ${args.fps} -i "${args.baseName}_%06d.jpg" -c:v libx264 -pix_fmt yuv420p -crf ${crf} -movflags +faststart "${args.baseName}.mp4"`,
    '',
  ].join('\n');
}

export function frameSequenceBaseName(filename: string, fallback = 'render'): string {
  return sanitizeFilenamePart(filename, fallback);
}

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

export async function deleteOfflineFrameFiles(ffmpeg: FFmpeg, frameCount: number): Promise<void> {
  for (let i = 0; i < frameCount; i++) {
    try {
      await ffmpeg.deleteFile(`frame_${String(i).padStart(6, '0')}.jpg`);
    } catch { /* best-effort */ }
  }
}

export async function encodeOfflineJpegSegment(
  ffmpeg: FFmpeg,
  frameCount: number,
  fps: number,
  quality: OfflineRenderSettings['quality'],
  segmentName: string,
  onProgress?: (progress: number) => void,
): Promise<void> {
  const crf = quality === 'archive' ? '14' : quality === 'web' ? '23' : '18';
  const onFfmpegProgress = ({ progress }: { progress: number }) => {
    const p = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
    onProgress?.(p);
  };
  ffmpeg.on('progress', onFfmpegProgress);
  try {
    await ffmpeg.exec([
      '-framerate', String(fps),
      '-start_number', '0',
      '-i', 'frame_%06d.jpg',
      '-frames:v', String(frameCount),
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-crf', crf,
      '-preset', quality === 'archive' ? 'slow' : 'medium',
      '-movflags', '+faststart',
      segmentName,
    ]);
  } finally {
    ffmpeg.off('progress', onFfmpegProgress);
  }
}

export async function concatOfflineSegments(ffmpeg: FFmpeg, segmentNames: string[], outputName: string): Promise<string> {
  if (segmentNames.length === 1) return segmentNames[0];
  const listName = 'segments.txt';
  const list = segmentNames.map(name => `file '${name.replace(/'/g, "'\\''")}'`).join('\n');
  await ffmpeg.writeFile(listName, new TextEncoder().encode(list));
  try {
    await ffmpeg.exec([
      '-f', 'concat',
      '-safe', '0',
      '-i', listName,
      '-c', 'copy',
      outputName,
    ]);
  } finally {
    try { await ffmpeg.deleteFile(listName); } catch { /* best-effort */ }
  }
  return outputName;
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
    const outputMode = settings.outputMode ?? 'mp4';
    const totalFrames = Math.max(1, Math.round(settings.durationSeconds * settings.fps));
    cancelRequested = false;
    set({
      ...INITIAL_STATE,
      status: outputMode === 'frames' ? 'choosing-folder' : 'loading-ffmpeg',
      totalFrames,
      currentFrame: 0,
      startedAtMs: performance.now(),
    });

    // Save state to restore after render so the live editor returns
    // to exactly how it was. Both engine size + the time overrides.
    const restoreWidth  = (engine as any).width  ?? canvas.width;
    const restoreHeight = (engine as any).height ?? canvas.height;
    const restoreManual = engine.manualTime;
    const restoreCanvasVisibility = canvas.style.visibility;

    let ffmpeg: FFmpeg | null = null;
    let frameTarget: FrameSequenceTarget | null = null;
    let nativeJpegSequence: NativeJpegSequenceSession | null = null;
    let nativeJpegSequenceFinished = false;
    let nativeFrameCaptureActive = false;
    let nativeOutputNeedsRestore = false;
    const frameBaseName = frameSequenceBaseName(settings.filename, 'render');
    if (outputMode === 'frames') {
      try {
        frameTarget = await chooseFrameSequenceTarget();
        if (!frameTarget) { _finish('cancelled'); return false; }
      } catch (err) {
        setStatus('error', formatErr(err));
        return false;
      }
    } else {
      try {
        ffmpeg = await loadFFmpeg();
      } catch (err) {
        setStatus('error', `FFmpeg load failed: ${formatErr(err)}`);
        return false;
      }
    }
    if (cancelRequested) { _finish('cancelled'); return false; }

    setStatus('rendering');
    canvas.style.visibility = 'hidden';
    const segmentFrameCount = outputMode === 'frames'
      ? totalFrames
      : getOfflineSegmentFrameCount(settings);
    const segmentNames: string[] = [];
    let currentSegmentFrames = 0;
    let readableOutputName = '';

    try {
      // Resize the engine to the offline resolution. Live editor will
      // briefly show this size; restored at the end. The engine.resize
      // path rebuilds all render targets cleanly.
      engine.resize(settings.width, settings.height);
      canvas.width = settings.width;
      canvas.height = settings.height;
      if (outputMode === 'frames' && frameTarget) {
        let jpegSequencePixelFormat: 'rgba' | 'bgra' = 'rgba';
        if (settings.captureBackend === 'native') {
          const caps = await getNativeRendererCapabilities();
          if (
            !caps?.features?.frame_snapshot_export ||
            !caps?.features?.native_frame_sequence_export ||
            !caps.implemented_methods?.includes('export_frame_snapshot')
          ) {
            throw new Error('Native frame capture is not available in this renderer build.');
          }
          await submitNativeRendererCommands([
            { type: 'set_output', width: settings.width, height: settings.height, refresh_hz: settings.fps },
          ]);
          nativeOutputNeedsRestore = true;
          const nativeStatus = await getNativeRendererStatus();
          jpegSequencePixelFormat = rawPixelFormatForNativeTextureFormat(nativeStatus.output_format);
          nativeFrameCaptureActive = true;
        }
        nativeJpegSequence = await startNativeJpegSequence(frameTarget, settings, frameBaseName, totalFrames, jpegSequencePixelFormat);
      }
      // Let the resize settle before the first capture.
      await nextFrame();

      // Pump frames into ffmpeg's virtual filesystem. Names need
      // %06d to support up to ~16 hour renders at 60fps without
      // changing the format string.
      for (let segmentStart = 0; segmentStart < totalFrames; segmentStart += segmentFrameCount) {
        currentSegmentFrames = Math.min(segmentFrameCount, totalFrames - segmentStart);
        for (let localFrame = 0; localFrame < currentSegmentFrames; localFrame++) {
        if (cancelRequested) { _finish('cancelled'); return false; }
        const globalFrame = segmentStart + localFrame;
        const virtualTime = globalFrame / settings.fps;

        // Drive every time-dependent subsystem from the same virtual
        // clock. Engine = shader iTime; ISF = ISF shaders' TIME;
        // stage effects = per-slice brightness; keyframes + sequencer
        // = parameter / opacity overrides.
        engine.manualTime = virtualTime;
        setISFManualTime(virtualTime);
          setStageEffectsManualTime(virtualTime);
          keyframeTimeline.seek(virtualTime);
          layerSequencer.seek(virtualTime);
          vjLayerSequencer.seek(virtualTime);

        // Wait one RAF so the live render loop picks up the new
        // state. (True offline-rate rendering — where we'd call
        // engine.render() directly without waiting for RAF — is a
        // follow-up; that path needs to bypass Canvas.svelte's
        // texture-update + composite stages entirely.)
        await nextFrame();

        if (outputMode === 'frames') {
          if (!frameTarget) throw new Error('Frame export folder not ready');
          if (nativeJpegSequence) {
            if (nativeFrameCaptureActive) {
              await writeNativeRendererJpegSequenceFrame(nativeJpegSequence, globalFrame, virtualTime);
            } else {
              const pixels = (engine as any).readCompositePixels() as { width: number; height: number; data: Uint8Array };
              await writeNativeJpegSequenceFrame(nativeJpegSequence, globalFrame, pixels);
            }
          } else {
            const jpegBytes = await captureFrameJPEG(engine, 0.92);
            const frameName = `${frameBaseName}_${String(globalFrame).padStart(6, '0')}.jpg`;
            await writeFrameTargetBytes(frameTarget, frameName, jpegBytes);
          }
        } else {
          if (!ffmpeg) throw new Error('FFmpeg encoder not ready');
          // MP4 export still feeds compressed JPEG intermediates into
          // ffmpeg.wasm so the wasm heap stays below its ~2GB limit.
          const jpegBytes = await captureFrameJPEG(engine, 0.92);
          const frameName = `frame_${String(localFrame).padStart(6, '0')}.jpg`;
          await ffmpeg.writeFile(frameName, jpegBytes);
        }

        update(s => ({ ...s, currentFrame: globalFrame + 1 }));
        }

        if (outputMode === 'frames') {
          currentSegmentFrames = 0;
          continue;
        }

        if (!ffmpeg) throw new Error('FFmpeg encoder not ready');
        setStatus('encoding');
        const segmentIndex = segmentNames.length;
        const segmentName = `segment_${String(segmentIndex).padStart(4, '0')}.mp4`;
        segmentNames.push(segmentName);
        await encodeOfflineJpegSegment(
          ffmpeg,
          currentSegmentFrames,
          settings.fps,
          settings.quality,
          segmentName,
          (progress) => {
            const segmentCount = Math.max(1, Math.ceil(totalFrames / segmentFrameCount));
            const p = (segmentIndex + progress) / segmentCount;
            update(s => ({ ...s, encodeProgress: Math.max(0, Math.min(0.95, p)) }));
          },
        );
        await deleteOfflineFrameFiles(ffmpeg, currentSegmentFrames);
        currentSegmentFrames = 0;
        if (cancelRequested) { _finish('cancelled'); return false; }
        setStatus('rendering');
      }

      if (cancelRequested) { _finish('cancelled'); return false; }

      if (outputMode === 'frames') {
        if (!frameTarget) throw new Error('Frame export folder not ready');
        setStatus('saving');
        if (nativeJpegSequence) {
          await finishNativeJpegSequence(nativeJpegSequence);
          nativeJpegSequenceFinished = true;
        }
        const manifestName = `${frameBaseName}_manifest.txt`;
        await writeFrameTargetText(frameTarget, manifestName, frameSequenceManifest({
          baseName: frameBaseName,
          fps: settings.fps,
          width: settings.width,
          height: settings.height,
          totalFrames,
          quality: settings.quality,
        }));
        update(s => ({
          ...s,
          status: 'complete',
          lastOutputKind: 'frames',
          lastOutputName: frameBaseName,
          lastOutputPath: describeFrameTarget(frameTarget!),
        }));
        return true;
      }

      if (!ffmpeg) throw new Error('FFmpeg encoder not ready');

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
      readableOutputName = await concatOfflineSegments(ffmpeg, segmentNames, `${settings.filename || 'render'}.mp4`);
      const outputName = `${settings.filename || 'render'}.mp4`;
      update(s => ({ ...s, encodeProgress: 1 }));
      if (cancelRequested) { _finish('cancelled'); return false; }

      setStatus('saving');
      const data = await ffmpeg.readFile(readableOutputName);
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
        if (ffmpeg) {
          await deleteOfflineFrameFiles(ffmpeg, currentSegmentFrames || segmentFrameCount);
          for (const segmentName of segmentNames) await ffmpeg.deleteFile(segmentName);
          if (readableOutputName === outputName) await ffmpeg.deleteFile(outputName);
        }
      } catch (e) { /* best-effort */ }

      update(s => ({ ...s, status: 'complete', lastOutputUrl: url, lastOutputName: niceName, lastOutputKind: 'video' }));
      return true;
    } catch (err) {
      console.error('[offlineRender] error:', err);
      try {
        if (ffmpeg) {
          await deleteOfflineFrameFiles(ffmpeg, currentSegmentFrames || segmentFrameCount);
          for (const segmentName of segmentNames) await ffmpeg.deleteFile(segmentName);
        }
      } catch { /* best-effort */ }
      setStatus('error', formatErr(err));
      return false;
    } finally {
      // Always restore engine state so the live editor returns to
      // normal regardless of how the render ended.
      if (nativeJpegSequence && !nativeJpegSequenceFinished) {
        await cancelNativeJpegSequence(nativeJpegSequence);
      }
      if (nativeOutputNeedsRestore) {
        await submitNativeRendererCommands([
          { type: 'set_output', width: restoreWidth, height: restoreHeight, refresh_hz: settings.fps },
        ]).catch(() => {});
      }
      engine.manualTime = restoreManual;
      canvas.style.visibility = restoreCanvasVisibility;
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
