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
import { pumpVisualAudio, setVisualAudioManualTime } from '../audio/visualAudio';
import { audioStore } from '../stores/audio';
import { audioAnalyzer } from '../audio/analyzer';
import {
  OfflineFileAudioAnalyzer,
  offlineFileAudioTime,
  prepareOfflineFileAudio,
  type OfflineFileAudioSession,
} from '../audio/offlineFileAudio';
import { getActiveNativeRendererSync } from '../sync/nativeRendererSync';
import { prepareShowOfflineAudio } from '../audio/showAudio';
import { keyframeTimeline } from '../stores/keyframeTimeline';
import { layerSequencer } from '../stores/layerSequencer';
import { vjLayerSequencer } from '../stores/vjLayerSequencer';
import { showTimeline } from '../stores/showTimeline';
import { showMuxTracks } from '../show/showAudioExport';
import { discardSoundtrackWav, renderTimelineSound, saveSoundtrackWav, soundtrackMono } from '../timeline/sound/soundExport';
import { IDLE, isRunning, renderStep, type RenderEvent, type RenderFlow } from './renderFlow';
import { analysisStepsUpTo, frameCount, frameTime, framesDuration } from './renderRate';
import { beginRenderClock, endRenderClock, setRenderClockSeconds } from './renderClock';
import { rateSampleFrom, saveRateSample } from './renderEstimate';
import { mediaLibrary } from '../stores/media';
import { generateUUID } from '../utils/uuid';
import { createAssetRefFromGeneratedBlob, pathToFileUrl, type AssetRef } from '../storage/assetRegistry';
import type { RenderEngine } from '../renderer/engine';
import { invoke, isElectron } from '../bridge';
import { recordingCodecOption, type RecordingCodecId } from './recordingSources';
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
  /** MP4 encodes with native desktop FFmpeg in Electron and falls back
   *  to ffmpeg.wasm in browser builds. Frame sequence writes JPEGs
   *  directly to a folder so 4K jobs avoid the slow wasm encode step. */
  outputMode: 'mp4' | 'frames';
  /** Render quality tier. 'high' = libx264 yuv420p crf 18 (visually
   *  lossless), 'web' = crf 23 (smaller file), 'archive' = crf 14
   *  (close to lossless, big file). */
  quality: 'high' | 'web' | 'archive';
  /** Frame source. The desktop-only native option captures the native
   *  renderer output directly; desktop MP4 packaging streams raw frames
   *  through native FFmpeg while browser builds keep the wasm fallback. */
  captureBackend?: 'webgl' | 'native';
  /** Show time of the first frame (a render of the in/out work area). 0: the start. */
  startSeconds?: number;
  /** Desktop native encode only: H.264 MP4 (default), ProRes 422 HQ or HAP
   *  (MOV). Offline frames are the opaque program output, so the alpha
   *  codecs are not offered here. */
  codec?: RecordingCodecId;
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

/** The render's state is one explicit value (renderFlow.ts): idle, preparing,
 *  rendering, encoding, then done, cancelled or error. */
export interface OfflineRenderState {
  flow: RenderFlow;
  /** Wall-clock ms when start() was called — drives the elapsed
   *  display in the modal. */
  startedAtMs: number;
  /** Last completed output's blob URL (so the modal can show a
   *  preview + download link). Cleared on next start. */
  lastOutputUrl: string | null;
  lastOutputName: string | null;
  lastOutputKind: 'video' | 'frames' | null;
  /** Where the file actually lives — the app-managed generated-video
   *  folder for MP4, or the chosen folder for a frame sequence. Always
   *  set for desktop renders so a user who dismissed the save dialog can
   *  still find (and reveal) the output. */
  lastOutputPath: string | null;
  /** The copy the user chose in the save dialog, if they picked one.
   *  Null means "kept where it was rendered" — never an error. */
  lastOutputSavedPath: string | null;
  /** About the show's soundtrack in the last video: included, or why not.
   *  Null when the show has no audio. */
  lastOutputAudioNote: string | null;
  /** Frames and wall time of the last finished render (the completion line). */
  lastFrames: number;
  lastElapsedMs: number;
}

const INITIAL_STATE: OfflineRenderState = {
  flow: IDLE,
  startedAtMs: 0,
  lastOutputUrl: null,
  lastOutputName: null,
  lastOutputKind: null,
  lastOutputPath: null,
  lastOutputSavedPath: null,
  lastOutputAudioNote: null,
  lastFrames: 0,
  lastElapsedMs: 0,
};

/** Thrown inside a render when Cancel was pressed: the cleanup runs, then the state is `cancelled`. */
class RenderCancelled extends Error {
  constructor() { super('cancelled'); }
}

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

export interface NativeJpegFrameEncoderSession {
  jobId: string;
  tempDir: string;
  width: number;
  height: number;
  fps: number;
  totalFrames: number;
  pixelFormat: 'rgba' | 'bgra';
}

export interface NativeMp4FrameEncoderSession {
  jobId: string;
  tempDir: string;
  outputPath: string;
  width: number;
  height: number;
  fps: number;
  /** 0 means open-ended/live recording; positive values are validated
   *  exactly by the native FFmpeg job on finish. */
  totalFrames: number;
  pixelFormat: 'rgba' | 'bgra';
  quality: OfflineRenderSettings['quality'];
  /** Container of the encoded file: mp4 for H.264, mov for ProRes / HAP. */
  extension: string;
  mime: string;
}

function rawPixelFormatForNativeTextureFormat(format: string): 'rgba' | 'bgra' {
  const normalized = String(format || '').trim().toLowerCase();
  if (normalized.includes('bgra')) return 'bgra';
  if (normalized.includes('rgba')) return 'rgba';
  throw new Error(`Native renderer output format is not supported for native frame capture: ${format || 'unknown'}`);
}

function coerceUint8Array(bytes: unknown): Uint8Array {
  if (bytes instanceof Uint8Array) return bytes;
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
  if (ArrayBuffer.isView(bytes)) {
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  if (Array.isArray(bytes)) return new Uint8Array(bytes);
  if (bytes && typeof bytes === 'object' && Array.isArray((bytes as { data?: unknown }).data)) {
    return new Uint8Array((bytes as { data: number[] }).data);
  }
  throw new Error('Native JPEG encoder returned an invalid byte payload');
}

function joinNativeTempPath(dir: string, filename: string): string {
  const separator = dir.includes('\\') ? '\\' : '/';
  return `${dir.replace(/[\\/]+$/, '')}${separator}${filename}`;
}

function sanitizeFilenamePart(input: string, fallback = 'render'): string {
  return (input || fallback)
    .trim()
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || fallback;
}

function describeNativeFrameHealth(snapshot: NativeRendererFrameSnapshotExportResult): string {
  const luma = Number(snapshot.average_luma ?? 0);
  const maxLuma = Number(snapshot.max_luma ?? 0);
  const nonzero = Number(snapshot.nonzero_pixels ?? 0);
  const bright = Number(snapshot.bright_pixels ?? 0);
  const byteLength = Number(snapshot.byte_length ?? 0);
  const bytesWritten = Number(snapshot.bytes_written ?? 0);
  return [
    `checksum=${snapshot.checksum || 'missing'}`,
    `luma=${luma.toFixed(4)}`,
    `max=${maxLuma.toFixed(4)}`,
    `nonzero=${nonzero}`,
    `bright=${bright}`,
    `bytes=${bytesWritten}/${byteLength}`,
    `format=${snapshot.format || 'unknown'}`,
  ].join(' ');
}

/** A show render may go black on purpose (a row hides its piece between
 *  blocks, a blackout, a dip): its blank frames are real frames. Any other
 *  render that comes out blank has lost its picture. Set per render. */
let blankFramesAreReal = false;

function assertNativeRendererFrameExport(
  snapshot: NativeRendererFrameSnapshotExportResult,
  frameIndex: number,
  expected: { width: number; height: number; pixelFormat: 'rgba' | 'bgra' },
): void {
  if (snapshot.width !== expected.width || snapshot.height !== expected.height) {
    throw new Error(
      `Native renderer frame ${frameIndex} size mismatch: got ${snapshot.width}x${snapshot.height}, expected ${expected.width}x${expected.height} (${describeNativeFrameHealth(snapshot)})`,
    );
  }
  const expectedBytes = expected.width * expected.height * 4;
  if (Number(snapshot.byte_length ?? 0) !== expectedBytes || Number(snapshot.bytes_written ?? 0) !== expectedBytes) {
    throw new Error(
      `Native renderer frame ${frameIndex} byte count mismatch: expected ${expectedBytes} raw bytes (${describeNativeFrameHealth(snapshot)})`,
    );
  }
  if ((snapshot.dark_frame || snapshot.nonzero_pixels <= 0) && !blankFramesAreReal) {
    throw new Error(`Native renderer exported a blank frame at ${frameIndex} (${describeNativeFrameHealth(snapshot)})`);
  }
  const snapshotPixelFormat = rawPixelFormatForNativeTextureFormat(snapshot.format);
  if (snapshotPixelFormat !== expected.pixelFormat) {
    throw new Error(
      `Native renderer frame ${frameIndex} format changed from ${expected.pixelFormat} to ${snapshotPixelFormat} (${describeNativeFrameHealth(snapshot)})`,
    );
  }
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
  stepSeconds?: number,
): Promise<NativeRendererFrameSnapshotExportResult> {
  if (session.target.kind !== 'electron' || !session.target.path) {
    throw new Error('Native renderer frame capture requires the desktop app frame-sequence encoder');
  }
  const rawName = `.${session.baseName}_${session.jobId}_${String(frameIndex).padStart(6, '0')}.${session.pixelFormat}`;
  const rawPath = `${session.target.path}/${rawName}`;
  const snapshot = await exportNativeRendererFrameSnapshot(rawPath, {
    time: timeSeconds,
    frame_index: frameIndex,
    ...(stepSeconds ? { step_seconds: stepSeconds } : {}),
  });
  assertNativeRendererFrameExport(snapshot, frameIndex, session);
  await writeNativeJpegSequenceFrameFile(session, frameIndex, rawPath, true);
  return snapshot;
}

export async function startNativeJpegFrameEncoder(
  settings: Pick<OfflineRenderSettings, 'width' | 'height' | 'fps'>,
  totalFrames: number,
  pixelFormat: 'rgba' | 'bgra' = 'rgba',
): Promise<NativeJpegFrameEncoderSession> {
  if (!isElectron) {
    throw new Error('Native frame capture requires the desktop app.');
  }
  const jobId = `jpeg-frame-${generateUUID()}`;
  const result = await invoke<{
    success?: boolean;
    error?: string;
    tempDir?: string;
    pixelFormat?: string;
  }>('jpeg_frame_encoder_start', {
    jobId,
    width: settings.width,
    height: settings.height,
    fps: settings.fps,
    totalFrames,
    pixelFormat,
  });
  if (!result?.success || !result.tempDir) {
    throw new Error(result?.error || 'Could not start native JPEG frame encoder');
  }
  return {
    jobId,
    tempDir: result.tempDir,
    width: settings.width,
    height: settings.height,
    fps: settings.fps,
    totalFrames,
    pixelFormat: rawPixelFormatForNativeTextureFormat(result.pixelFormat || pixelFormat),
  };
}

export async function encodeNativeRendererJpegFrame(
  session: NativeJpegFrameEncoderSession,
  frameIndex: number,
  timeSeconds: number,
  stepSeconds?: number,
): Promise<Uint8Array> {
  const rawName = `native_frame_${session.jobId}_${String(frameIndex).padStart(6, '0')}.${session.pixelFormat}`;
  const rawPath = joinNativeTempPath(session.tempDir, rawName);
  const snapshot = await exportNativeRendererFrameSnapshot(rawPath, {
    time: timeSeconds,
    frame_index: frameIndex,
    ...(stepSeconds ? { step_seconds: stepSeconds } : {}),
  });
  assertNativeRendererFrameExport(snapshot, frameIndex, session);

  const result = await invoke<{
    success?: boolean;
    error?: string;
    bytes?: unknown;
    byteLength?: number;
  }>('jpeg_frame_encoder_encode_file', {
    jobId: session.jobId,
    frameIndex,
    path: rawPath,
    pixelFormat: session.pixelFormat,
    deleteAfterWrite: true,
  });
  if (!result?.success || !result.bytes) {
    throw new Error(result?.error || `Could not encode native JPEG frame ${frameIndex}`);
  }
  const jpegBytes = coerceUint8Array(result.bytes);
  if (jpegBytes.byteLength <= 0) {
    throw new Error(`Native JPEG encoder returned an empty frame at ${frameIndex}`);
  }
  return jpegBytes;
}

export async function finishNativeJpegFrameEncoder(session: NativeJpegFrameEncoderSession): Promise<void> {
  const result = await invoke<{ success?: boolean; error?: string }>('jpeg_frame_encoder_finish', {
    jobId: session.jobId,
  });
  if (!result?.success) {
    throw new Error(result?.error || 'Could not finalize native JPEG frame encoder');
  }
}

export async function cancelNativeJpegFrameEncoder(session: NativeJpegFrameEncoderSession): Promise<void> {
  await invoke('jpeg_frame_encoder_cancel', { jobId: session.jobId }).catch(() => {});
}

export async function startNativeMp4FrameEncoder(
  settings: Pick<OfflineRenderSettings, 'width' | 'height' | 'fps' | 'quality' | 'filename' | 'codec'>,
  totalFrames: number,
  pixelFormat: 'rgba' | 'bgra' = 'rgba',
  /** Live fallback capture only: read the core's record target or one
   *  Screen ("slice:<id>") instead of the program output. */
  captureSource?: string,
): Promise<NativeMp4FrameEncoderSession> {
  if (!isElectron) {
    throw new Error('Native MP4 encoding requires the desktop app.');
  }
  const jobId = `mp4-frame-${generateUUID()}`;
  const codec = recordingCodecOption(settings.codec);
  const outputName = `${sanitizeFilenamePart(settings.filename || 'Offline Render', 'Offline_Render')}.${codec.extension}`;
  const expectedFrames = Number.isFinite(totalFrames) && totalFrames > 0 ? Math.round(totalFrames) : 0;
  const result = await invoke<{
    success?: boolean;
    error?: string;
    tempDir?: string;
    outputPath?: string;
    pixelFormat?: string;
  }>('mp4_frame_encoder_start', {
    jobId,
    width: settings.width,
    height: settings.height,
    fps: settings.fps,
    quality: settings.quality,
    totalFrames: expectedFrames,
    outputName,
    pixelFormat,
    codec: codec.id,
    ...(captureSource && captureSource !== 'output' ? { captureSource } : {}),
  });
  if (!result?.success || !result.tempDir || !result.outputPath) {
    throw new Error(result?.error || 'Could not start native MP4 frame encoder');
  }
  return {
    jobId,
    tempDir: result.tempDir,
    outputPath: result.outputPath,
    width: settings.width,
    height: settings.height,
    fps: settings.fps,
    totalFrames: expectedFrames,
    pixelFormat: rawPixelFormatForNativeTextureFormat(result.pixelFormat || pixelFormat),
    quality: settings.quality,
    extension: codec.extension,
    mime: codec.mime,
  };
}

export async function writeNativeMp4Frame(
  session: NativeMp4FrameEncoderSession,
  frameIndex: number,
  pixels: { width: number; height: number; data: Uint8Array },
  /** Write the frame into this many consecutive slots (live pacing). */
  repeat = 1,
): Promise<void> {
  if (pixels.width !== session.width || pixels.height !== session.height) {
    throw new Error(
      `MP4 frame ${frameIndex} size mismatch: got ${pixels.width}x${pixels.height}, expected ${session.width}x${session.height}`,
    );
  }
  const result = await invoke<{ success?: boolean; error?: string }>('mp4_frame_encoder_write_frame', {
    jobId: session.jobId,
    frameIndex,
    bytes: pixels.data,
    pixelFormat: session.pixelFormat,
    ...(repeat > 1 ? { repeat } : {}),
  });
  if (!result?.success) {
    throw new Error(result?.error || `Could not write MP4 frame ${frameIndex}`);
  }
}

export async function writeNativeMp4FrameFile(
  session: NativeMp4FrameEncoderSession,
  frameIndex: number,
  path: string,
  deleteAfterWrite = false,
): Promise<void> {
  const result = await invoke<{ success?: boolean; error?: string }>('mp4_frame_encoder_write_frame_file', {
    jobId: session.jobId,
    frameIndex,
    path,
    pixelFormat: session.pixelFormat,
    deleteAfterWrite,
  });
  if (!result?.success) {
    throw new Error(result?.error || `Could not write MP4 frame file ${frameIndex}`);
  }
}

export async function writeNativeRendererMp4Frame(
  session: NativeMp4FrameEncoderSession,
  frameIndex: number,
  timeSeconds: number,
  stepSeconds?: number,
): Promise<NativeRendererFrameSnapshotExportResult> {
  const rawName = `native_mp4_${session.jobId}_${String(frameIndex).padStart(6, '0')}.${session.pixelFormat}`;
  const rawPath = joinNativeTempPath(session.tempDir, rawName);
  const snapshot = await exportNativeRendererFrameSnapshot(rawPath, {
    time: timeSeconds,
    frame_index: frameIndex,
    ...(stepSeconds ? { step_seconds: stepSeconds } : {}),
  });
  assertNativeRendererFrameExport(snapshot, frameIndex, session);
  await writeNativeMp4FrameFile(session, frameIndex, rawPath, true);
  return snapshot;
}

/** Live-clock variant: snapshot whatever the core is presenting right
 *  now (no manual time override) and write it as frames fromIndex..
 *  toIndex inclusive. Duplicating one capture across the span is how
 *  live REC keeps wall-clock pacing when a capture takes longer than a
 *  frame interval — the encoded timeline stays real-time instead of
 *  compressing (which played back sped-up). Returns the snapshot. */
export async function writeNativeRendererMp4FrameLiveSpan(
  session: NativeMp4FrameEncoderSession,
  fromIndex: number,
  toIndex: number,
): Promise<NativeRendererFrameSnapshotExportResult> {
  let snapshot!: NativeRendererFrameSnapshotExportResult;
  const last = Math.max(fromIndex, toIndex);
  for (let first = fromIndex; first <= last; first += 120) {
    const result = await invoke<{ success: boolean; error?: string; snapshot: NativeRendererFrameSnapshotExportResult }>(
      'mp4_frame_encoder_capture_live', { jobId: session.jobId, fromIndex: first, toIndex: Math.min(last, first + 119) });
    if (!result?.success) throw new Error(result?.error || 'Native live frame capture failed');
    snapshot = result.snapshot;
    assertNativeRendererFrameExport(snapshot, first, session);
  }
  return snapshot;
}

export async function finishNativeMp4FrameEncoder(
  session: NativeMp4FrameEncoderSession,
): Promise<{ outputPath: string; size: number; frames: number; nativeAudio: boolean }> {
  const result = await invoke<{
    success?: boolean;
    error?: string;
    outputPath?: string;
    size?: number;
    frames?: number;
    nativeAudio?: boolean;
  }>('mp4_frame_encoder_finish', {
    jobId: session.jobId,
  });
  if (!result?.success || !result.outputPath) {
    throw new Error(result?.error || 'Could not finalize native MP4 frame encoder');
  }
  return {
    outputPath: result.outputPath,
    size: Number(result.size ?? 0),
    frames: Number(result.frames ?? session.totalFrames),
    // Live recordings: the native clip audio tap is held for the mux.
    nativeAudio: result.nativeAudio === true,
  };
}

export async function cancelNativeMp4FrameEncoder(session: NativeMp4FrameEncoderSession): Promise<void> {
  await invoke('mp4_frame_encoder_cancel', { jobId: session.jobId }).catch(() => {});
}

/**
 * Prompt for a save location and copy an already-encoded MP4 there.
 *
 * The encoder always writes into the app-managed generated-video folder,
 * which is the right home for the media-library entry but not a place a
 * user can find. This is a fast on-disk copy (no IPC bytes), so both the
 * library entry and the user's own copy survive.
 *
 * Cancelling is a normal outcome, not a failure: the render is already
 * complete and the file is still at `outputPath`. Returns the chosen
 * destination, or null when the user dismissed the dialog or the copy
 * could not be made.
 */
export async function promptSaveMp4(
  outputPath: string,
  name: string,
  title = 'Save Video',
  extension = 'mp4',
): Promise<string | null> {
  try {
    const result = await invoke('save_project_dialog', {
      title,
      defaultPath: `${name}.${extension}`,
      filters: [
        extension === 'mov'
          ? { name: 'QuickTime Movie', extensions: ['mov'] }
          : { name: 'MP4 Video', extensions: ['mp4'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    }) as { canceled?: boolean; filePath?: string | null } | null;
    if (result?.canceled || !result?.filePath) return null;
    const copy = await invoke('copy_file_to_project', {
      sourcePath: outputPath,
      destPath: result.filePath,
    }) as { success?: boolean; error?: string } | null;
    if (!copy?.success) {
      console.warn('[OfflineRender] Failed to copy render to chosen path:', copy?.error);
      return null;
    }
    return result.filePath;
  } catch (err) {
    console.warn('[OfflineRender] Save prompt failed:', err);
    return null;
  }
}

/** Show a finished render in Finder/Explorer. Best-effort — a render that
 *  cannot be revealed still shows its path in the completion panel. */
export async function revealOutputPath(path: string): Promise<void> {
  if (!isElectron || !path) return;
  await invoke('video_converter_reveal_path', { path }).catch((err) => {
    console.warn('[OfflineRender] Reveal failed:', err);
  });
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
  /** Each render's number: a render's late writes never land on a newer one. */
  let renderToken = 0;
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

  /** `opts.promptSave: false` keeps a finished MP4 where the encoder wrote
   *  it (the media library has it either way) instead of asking where to
   *  save a copy: for automation that reads the file itself.
   *
   *  Every frame is made, never captured live: frame i is show time
   *  `start + i / fps` exactly (renderRate.ts), every clock the app has is
   *  moved to it (renderClock.ts for the live engines, the show, lines,
   *  keyframes, sequencers, Screen FX, the audio analysis at a fixed 60 a
   *  second, the core's render clock), and the core steps its simulations
   *  once to that time before the frame is read. Frames stream to the
   *  encoder one at a time; none are kept. */
  async function start(settings: OfflineRenderSettings, opts: { promptSave?: boolean } = {}): Promise<boolean> {
    if (isRunning(get({ subscribe }).flow)) return false;
    const token = ++renderToken;
    const dispatch = (event: RenderEvent) => {
      if (token !== renderToken) return;
      update((s) => ({ ...s, flow: renderStep(s.flow, event) }));
    };
    // The WebGL engine only exists in non-native builds. Native capture
    // renders + reads frames entirely in the core, so it must not require it.
    if ((!engineRef || !canvasRef) && settings.captureBackend !== 'native') {
      set({ ...INITIAL_STATE, flow: { kind: 'error', message: 'Render engine not ready — this build renders natively; use the native capture backend.' } });
      return false;
    }
    const engine = engineRef;
    const canvas = canvasRef;
    const outputMode = settings.outputMode ?? 'mp4';
    const useNativeMp4Encoder = outputMode === 'mp4' && isElectron;
    const fps = settings.fps;
    const startT = Math.max(0, Number(settings.startSeconds) || 0);
    const totalFrames = frameCount(settings.durationSeconds, fps);
    const renderSeconds = framesDuration(totalFrames, fps);
    const step = framesDuration(1, fps);
    cancelRequested = false;
    set({ ...INITIAL_STATE, flow: renderStep(IDLE, { type: 'start' }), startedAtMs: performance.now() });
    const checkStop = () => { if (cancelRequested) throw new RenderCancelled(); };
    // Progress for the modal, at most ten times a second.
    let lastProgressAt = 0;
    const progress = (frame: number) => {
      const now = performance.now();
      if (frame < totalFrames && now - lastProgressAt < 100) return;
      lastProgressAt = now;
      dispatch({ type: 'frame', frame, total: totalFrames });
    };

    // Save state to restore after render so the live editor returns
    // to exactly how it was. Both engine size + the time overrides.
    // Without an engine (native shell) the output size to restore comes
    // from the core's own status just before we resize it.
    let restoreWidth  = (engine as any)?.width  ?? canvas?.width ?? settings.width;
    let restoreHeight = (engine as any)?.height ?? canvas?.height ?? settings.height;
    const restoreManual = engine ? engine.manualTime : null;
    const restoreCanvasVisibility = canvas?.style.visibility ?? '';

    let ffmpeg: FFmpeg | null = null;
    let frameTarget: FrameSequenceTarget | null = null;
    let nativeJpegSequence: NativeJpegSequenceSession | null = null;
    let nativeMp4FrameEncoder: NativeMp4FrameEncoderSession | null = null;
    let nativeJpegSequenceFinished = false;
    let nativeMp4FrameEncoderFinished = false;
    let nativeFrameCaptureActive = false;
    let nativeOutputNeedsRestore = false;
    /** True once the live sync RAF has been suspended for this render. */
    let manualClockExportHeld = false;
    /** Virtual-time analysis of the sound, when there is a file to analyse.
     *  Null for live inputs (mic / system), which cannot be virtualized —
     *  see the warning in OfflineRenderModal. */
    let fileAudioSession: OfflineFileAudioSession | null = null;
    /** A file-input session is relative to the render's first frame; a show
     *  session is in show time. */
    let analysisFromRenderStart = false;
    let liveAnalysisHeld = false;
    let pausedAudioElement: HTMLAudioElement | HTMLVideoElement | null = null;
    /** The show as it was: playing (resumed after), or parked at a time (put back). */
    let showWasPlaying = false;
    let showParkedAt: number | null = null;
    /** The Timeline's sound rows rendered up front, in a temp file of the desktop app. */
    let soundtrackPath: string | null = null;
    let nativeCapturePixelFormat: 'rgba' | 'bgra' = 'rgba';
    const frameBaseName = frameSequenceBaseName(settings.filename, 'render');
    const segmentFrameCount = outputMode === 'frames' || useNativeMp4Encoder
      ? totalFrames
      : getOfflineSegmentFrameCount(settings);
    const segmentNames: string[] = [];
    let currentSegmentFrames = 0;
    let readableOutputName = '';
    const sync = () => getActiveNativeRendererSync();

    try {
      if (outputMode === 'frames') {
        dispatch({ type: 'prepare', step: 'folder' });
        frameTarget = await chooseFrameSequenceTarget();
        if (!frameTarget) throw new RenderCancelled();
      } else if (!useNativeMp4Encoder) {
        dispatch({ type: 'prepare', step: 'encoder' });
        try {
          ffmpeg = await loadFFmpeg();
        } catch (err) {
          throw new Error(`FFmpeg load failed: ${formatErr(err)}`);
        }
      }
      checkStop();

      // ─── The show and its sound, before any frame ───────────────────
      // The render owns the show's clock: a playing show is paused (its own
      // frame loop would fight the per-frame seeks) and resumed after.
      const showState = get(showTimeline);
      blankFramesAreReal = showTimeline.hasContent();
      showWasPlaying = showState.isPlaying;
      showParkedAt = showState.isPlaying ? null : showState.currentTime;
      if (showWasPlaying) showTimeline.pause();
      const endT = startT + renderSeconds;
      if (showState.doc === 'timeline' && showState.audioTracks.some(t => !t.muted && t.url && t.volume > 0)) {
        // The Timeline's sound rows as they play live (effects, fades, levels,
        // ducking, mute and solo, lines): rendered once, put in the video,
        // and what the audio-reactive content reacts to.
        dispatch({ type: 'prepare', step: 'sound' });
        const sound = await renderTimelineSound(showState, endT);
        checkStop();
        if (sound) {
          if (outputMode === 'mp4' && isElectron) soundtrackPath = await saveSoundtrackWav(sound);
          fileAudioSession = {
            analyzer: new OfflineFileAudioAnalyzer(soundtrackMono(sound), sound.sampleRate, { bandSmoothing: audioAnalyzer.getSmoothing() }),
            startOffsetSeconds: 0,
            loop: false,
            durationSeconds: sound.left.length / sound.sampleRate,
            label: 'Timeline sound rows',
          };
        }
      } else if (showState.audioTracks.some(t => !t.muted && t.url && t.duration > 0)) {
        // The Show: its tracks mixed down once, sampled per frame.
        dispatch({ type: 'prepare', step: 'sound' });
        fileAudioSession = await prepareShowOfflineAudio(
          showState.audioTracks,
          showState.duration,
          { loop: showState.loop, bandSmoothing: audioAnalyzer.getSmoothing() },
        );
      }
      if (fileAudioSession) {
        audioAnalyzer.beginAnalysisHold();
        liveAnalysisHeld = true;
      }
      checkStop();

      const audioState = get(audioStore);
      if (!fileAudioSession && audioState.inputType === 'file') {
        const element = audioAnalyzer.getMediaElement();
        // Freeze the playhead BEFORE the decode: the export starts from
        // wherever the user left the track, not from wherever it drifted
        // to while a few MB of audio were being decoded.
        const wasPlaying = !!element && !element.paused;
        if (wasPlaying && element) {
          try { element.pause(); } catch { /* best-effort */ }
        }
        fileAudioSession = await prepareOfflineFileAudio(
          element,
          audioAnalyzer.getAudioContext(),
          {
            startOffsetSeconds: element ? element.currentTime : 0,
            bandSmoothing: audioAnalyzer.getSmoothing(),
          },
        );
        if (fileAudioSession) {
          analysisFromRenderStart = true;
          audioAnalyzer.beginAnalysisHold();
          liveAnalysisHeld = true;
          if (wasPlaying) pausedAudioElement = element;
        } else if (wasPlaying && element) {
          void element.play().catch(() => { /* user can hit play again */ });
        }
      }
      checkStop();

      // ─── The output ───────────────────────────────────────────────
      dispatch({ type: 'prepare', step: 'output' });
      if (canvas) canvas.style.visibility = 'hidden';
      engine?.resize(settings.width, settings.height);
      if (canvas) {
        canvas.width = settings.width;
        canvas.height = settings.height;
      }
      if (settings.captureBackend === 'native') {
        const caps = await getNativeRendererCapabilities();
        if (
          !caps?.features?.frame_snapshot_export ||
          !caps?.features?.native_frame_sequence_export ||
          !caps.implemented_methods?.includes('export_frame_snapshot')
        ) {
          throw new Error('Native frame capture is not available in this renderer build.');
        }
        if (!engine) {
          const preStatus = await getNativeRendererStatus();
          if (preStatus.output_width > 0) restoreWidth = preStatus.output_width;
          if (preStatus.output_height > 0) restoreHeight = preStatus.output_height;
        }
        await submitNativeRendererCommands([
          { type: 'set_output', width: settings.width, height: settings.height, refresh_hz: Math.round(fps) },
        ]);
        nativeOutputNeedsRestore = true;
        const nativeStatus = await getNativeRendererStatus();
        nativeCapturePixelFormat = rawPixelFormatForNativeTextureFormat(nativeStatus.output_format);
        nativeFrameCaptureActive = true;
        // Lock the world clock to the render clock: from here until the
        // finally block, the ONLY thing advancing the core is this loop.
        sync()?.beginManualClockExport({ width: settings.width, height: settings.height });
        manualClockExportHeld = true;
      }
      if (outputMode === 'frames' && frameTarget) {
        nativeJpegSequence = await startNativeJpegSequence(frameTarget, settings, frameBaseName, totalFrames, nativeCapturePixelFormat);
      } else if (outputMode === 'mp4' && useNativeMp4Encoder) {
        nativeMp4FrameEncoder = await startNativeMp4FrameEncoder(settings, totalFrames, nativeFrameCaptureActive ? nativeCapturePixelFormat : 'rgba');
      }

      // Every live engine reads the render's clock from here (renderClock.ts).
      beginRenderClock(startT);
      setVisualAudioManualTime(startT);
      let analysisStep = 0;
      checkStop();
      dispatch({ type: 'frame', frame: 0, total: totalFrames });
      // Let the resize settle before the first capture.
      await nextFrame();

      for (let segmentStart = 0; segmentStart < totalFrames; segmentStart += segmentFrameCount) {
        currentSegmentFrames = Math.min(segmentFrameCount, totalFrames - segmentStart);
        for (let localFrame = 0; localFrame < currentSegmentFrames; localFrame++) {
          checkStop();
          const globalFrame = segmentStart + localFrame;
          const virtualTime = frameTime(globalFrame, fps, startT);

          // Drive every time-dependent subsystem from the same virtual
          // clock. Engine = shader iTime; ISF = ISF shaders' TIME;
          // stage effects = per-slice brightness; keyframes + sequencer
          // = parameter / opacity overrides; the live engines' own clock.
          setRenderClockSeconds(virtualTime);
          if (engine) engine.manualTime = virtualTime;
          setISFManualTime(virtualTime);
          setStageEffectsManualTime(virtualTime);
          // Audio-reactive content: the analysis steps at a fixed 60 a
          // second (whatever the frame rate, so a 120 fps render reacts like
          // a 30 fps one), then the follower moves by exactly one frame.
          // Must land BEFORE renderManualFrame() — the graph build reads
          // getVisualAudioSnapshot() synchronously.
          if (fileAudioSession) {
            const due = analysisStepsUpTo(startT, analysisStep, virtualTime);
            analysisStep = due.nextStep;
            for (const t of due.times) {
              const at = analysisFromRenderStart ? t - startT : t;
              audioStore.injectAnalysisFrame(fileAudioSession.analyzer.frameAt(offlineFileAudioTime(fileAudioSession, at)));
            }
          }
          pumpVisualAudio(virtualTime);
          layerSequencer.seek(virtualTime);
          vjLayerSequencer.seek(virtualTime);
          // Show timeline: evaluates which preset clip owns this instant and
          // fires the composition swap ONLY when that answer changes. Must
          // run after the sub-transport seeks above — loadComposition
          // re-hydrates them, and with `restoreTransports:false` (which the
          // show timeline passes under a manual clock) it will not fight the
          // next frame's seeks. A show with no clips is a no-op.
          showTimeline.seek(virtualTime);
          // The keyframe tray runs on preset time, not show time: live, each
          // preset's keyframes restart at 0 on its boundary. The preset swap above
          // imports the incoming keyframes a microtask later, so let that land
          // first, then evaluate them at the same instant live playback would.
          await Promise.resolve();
          keyframeTimeline.seek(showTimeline.keyframeTimeFor(virtualTime));
          // One animation frame: the engines that run on it (modulation,
          // Auto, music motion, fades, Screen FX) take this frame's time.
          await nextFrame();
          if (nativeFrameCaptureActive) {
            // This frame's scene, values and clock reach the core (awaited:
            // a sync already running is waited for, never skipped).
            await sync()?.renderManualFrame(virtualTime, { index: globalFrame, step });
          }

          if (outputMode === 'frames') {
            if (!frameTarget) throw new Error('Frame export folder not ready');
            if (nativeJpegSequence) {
              if (nativeFrameCaptureActive) {
                await writeNativeRendererJpegSequenceFrame(nativeJpegSequence, globalFrame, virtualTime, step);
              } else {
                if (!engine) throw new Error('WebGL frame capture needs the render engine');
                const pixels = (engine as any).readCompositePixels() as { width: number; height: number; data: Uint8Array };
                await writeNativeJpegSequenceFrame(nativeJpegSequence, globalFrame, pixels);
              }
            } else {
              if (!engine) throw new Error('WebGL frame capture needs the render engine');
              const jpegBytes = await captureFrameJPEG(engine, 0.92);
              const frameName = `${frameBaseName}_${String(globalFrame).padStart(6, '0')}.jpg`;
              await writeFrameTargetBytes(frameTarget, frameName, jpegBytes);
            }
          } else if (nativeMp4FrameEncoder) {
            if (nativeFrameCaptureActive) {
              await writeNativeRendererMp4Frame(nativeMp4FrameEncoder, globalFrame, virtualTime, step);
            } else {
              if (!engine) throw new Error('WebGL frame capture needs the render engine');
              const pixels = (engine as any).readCompositePixels() as { width: number; height: number; data: Uint8Array };
              await writeNativeMp4Frame(nativeMp4FrameEncoder, globalFrame, pixels);
            }
          } else {
            if (!ffmpeg) throw new Error('FFmpeg encoder not ready');
            // Browser fallback: compressed JPEG intermediates keep
            // ffmpeg.wasm below its ~2GB heap limit.
            if (!engine) throw new Error('WebGL frame capture needs the render engine');
            const jpegBytes = await captureFrameJPEG(engine, 0.92);
            const frameName = `frame_${String(localFrame).padStart(6, '0')}.jpg`;
            await ffmpeg.writeFile(frameName, jpegBytes);
          }
          progress(globalFrame + 1);
        }

        if (outputMode === 'frames' || nativeMp4FrameEncoder) {
          currentSegmentFrames = 0;
          continue;
        }

        if (!ffmpeg) throw new Error('FFmpeg encoder not ready');
        const segmentIndex = segmentNames.length;
        const segmentCount = Math.max(1, Math.ceil(totalFrames / segmentFrameCount));
        dispatch({ type: 'encode', step: 'video', progress: segmentIndex / segmentCount });
        const segmentName = `segment_${String(segmentIndex).padStart(4, '0')}.mp4`;
        segmentNames.push(segmentName);
        await encodeOfflineJpegSegment(ffmpeg, currentSegmentFrames, fps, settings.quality, segmentName, (p) => {
          dispatch({ type: 'encode', step: 'video', progress: Math.min(0.95, (segmentIndex + p) / segmentCount) });
        });
        await deleteOfflineFrameFiles(ffmpeg, currentSegmentFrames);
        currentSegmentFrames = 0;
        checkStop();
      }
      checkStop();

      if (outputMode === 'frames') {
        if (!frameTarget) throw new Error('Frame export folder not ready');
        dispatch({ type: 'encode', step: 'saving', progress: 1 });
        if (nativeJpegSequence) {
          await finishNativeJpegSequence(nativeJpegSequence);
          nativeJpegSequenceFinished = true;
        }
        await writeFrameTargetText(frameTarget, `${frameBaseName}_manifest.txt`, frameSequenceManifest({
          baseName: frameBaseName, fps, width: settings.width, height: settings.height, totalFrames, quality: settings.quality,
        }));
        finishWith({ lastOutputKind: 'frames', lastOutputName: frameBaseName, lastOutputPath: describeFrameTarget(frameTarget) });
        return true;
      }

      if (nativeMp4FrameEncoder) {
        dispatch({ type: 'encode', step: 'video', progress: 0.5 });
        const encoded = await finishNativeMp4FrameEncoder(nativeMp4FrameEncoder);
        nativeMp4FrameEncoderFinished = true;
        checkStop();
        dispatch({ type: 'encode', step: 'sound', progress: 0.8 });
        const audioNote = await addShowSoundtrack(encoded.outputPath, { start: startT, seconds: renderSeconds, soundtrackPath });
        soundtrackPath = null; // the mux deletes it
        checkStop();

        dispatch({ type: 'encode', step: 'saving', progress: 1 });
        const url = pathToFileUrl(encoded.outputPath);
        const thumbnail = await thumbnailFromVideoUrl(url, Math.min(2, renderSeconds * 0.4));
        const niceName = `${settings.filename || 'Offline Render'} ${new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-')}`;
        const assetRef: AssetRef = {
          kind: 'local-file',
          originalPath: encoded.outputPath,
          name: `${niceName}.${nativeMp4FrameEncoder.extension}`,
          mime: nativeMp4FrameEncoder.mime,
          size: encoded.size,
          lastModified: Date.now(),
        };
        mediaLibrary.addItem({ id: generateUUID(), name: niceName, type: 'video', src: url, thumbnail, _assetRef: assetRef });
        // Ask where the user wants their copy. The library entry above is
        // already committed, so cancelling just means "leave it in the
        // app folder" — the completion panel surfaces that path either way.
        const savedPath = opts.promptSave === false
          ? null
          : await promptSaveMp4(encoded.outputPath, niceName, 'Save Video', nativeMp4FrameEncoder.extension);
        finishWith({
          lastOutputUrl: url,
          lastOutputName: niceName,
          lastOutputKind: 'video',
          lastOutputPath: encoded.outputPath,
          lastOutputSavedPath: savedPath,
          lastOutputAudioNote: audioNote,
        });
        return true;
      }

      if (!ffmpeg) throw new Error('FFmpeg encoder not ready');
      dispatch({ type: 'encode', step: 'video', progress: 0.95 });
      readableOutputName = await concatOfflineSegments(ffmpeg, segmentNames, `${settings.filename || 'render'}.mp4`);
      const outputName = `${settings.filename || 'render'}.mp4`;
      checkStop();
      dispatch({ type: 'encode', step: 'saving', progress: 1 });
      const data = await ffmpeg.readFile(readableOutputName);
      const u8 = data instanceof Uint8Array ? data : new Uint8Array(data as any);
      const blob = new Blob([u8], { type: 'video/mp4' });
      const url = URL.createObjectURL(blob);
      const thumbnail = await thumbnailFromBlob(blob, url, Math.min(2, renderSeconds * 0.4));
      const niceName = `${settings.filename || 'Offline Render'} ${new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-')}`;
      const { assetRef } = await createAssetRefFromGeneratedBlob(blob, `${niceName}.mp4`, 'video/mp4', url);
      mediaLibrary.addItem({ id: generateUUID(), name: niceName, type: 'video', src: url, thumbnail, _assetRef: assetRef });
      // Trigger a download too — users usually want the file
      // outside the project's media library.
      downloadBlob(blob, `${niceName}.mp4`);
      try {
        for (const segmentName of segmentNames) await ffmpeg.deleteFile(segmentName);
        if (readableOutputName === outputName) await ffmpeg.deleteFile(outputName);
      } catch { /* best-effort */ }
      finishWith({ lastOutputUrl: url, lastOutputName: niceName, lastOutputKind: 'video' });
      return true;
    } catch (err) {
      if (err instanceof RenderCancelled) {
        dispatch({ type: 'stopped' });
      } else {
        console.error('[offlineRender] error:', err);
        dispatch({ type: 'fail', message: formatErr(err) });
      }
      return false;
    } finally {
      // Always clean up and give the live editor its clocks back, however
      // the render ended: temp frames, the encoder and its partial file,
      // the sound file, the core's size and clock.
      if (ffmpeg) {
        try {
          await deleteOfflineFrameFiles(ffmpeg, currentSegmentFrames || segmentFrameCount);
          if (get({ subscribe }).flow.kind !== 'done') for (const segmentName of segmentNames) await ffmpeg.deleteFile(segmentName).catch(() => {});
        } catch { /* best-effort */ }
      }
      if (nativeJpegSequence && !nativeJpegSequenceFinished) await cancelNativeJpegSequence(nativeJpegSequence);
      if (nativeMp4FrameEncoder && !nativeMp4FrameEncoderFinished) await cancelNativeMp4FrameEncoder(nativeMp4FrameEncoder);
      if (soundtrackPath) await discardSoundtrackWav(soundtrackPath);
      endRenderClock();
      if (nativeOutputNeedsRestore) {
        await submitNativeRendererCommands([
          { type: 'set_output', width: restoreWidth, height: restoreHeight, refresh_hz: Math.round(fps) },
        ]).catch(() => {});
      }
      if (engine && restoreManual !== null) engine.manualTime = restoreManual;
      sync()?.setRenderClock(null);
      if (manualClockExportHeld) {
        manualClockExportHeld = false;
        sync()?.endManualClockExport();
      }
      if (canvas) canvas.style.visibility = restoreCanvasVisibility;
      setISFManualTime(null);
      setStageEffectsManualTime(null);
      // Hand the audio clock back. setVisualAudioManualTime(null) also
      // resets the follower and restores the pre-export published state.
      setVisualAudioManualTime(null);
      if (liveAnalysisHeld) {
        liveAnalysisHeld = false;
        audioAnalyzer.endAnalysisHold();
      }
      if (pausedAudioElement) {
        const element = pausedAudioElement;
        pausedAudioElement = null;
        void element.play().catch(() => { /* user can hit play again */ });
      }
      if (showWasPlaying) {
        // Rewind first: the render left the playhead at the last virtual
        // frame, and resuming from there would drop the operator into the
        // middle of a show they were watching from somewhere else.
        showTimeline.stop();
        showTimeline.play();
      } else if (showParkedAt !== null) {
        showTimeline.seek(showParkedAt);
      }
      fileAudioSession = null;
      try { engine?.resize(restoreWidth, restoreHeight); } catch { /* nothing we can do */ }
    }

    function finishWith(patch: Partial<OfflineRenderState>) {
      if (token !== renderToken) return;
      const elapsed = performance.now() - get({ subscribe }).startedAtMs;
      saveRateSample(rateSampleFrom(elapsed, totalFrames, settings.width, settings.height));
      update((s) => ({ ...s, ...patch, lastFrames: totalFrames, lastElapsedMs: elapsed, flow: renderStep(s.flow, { type: 'finish' }) }));
    }
  }

  /** Ask the running render to stop. It cleans up, then the state is `cancelled`. */
  function cancel() {
    const flow = get({ subscribe }).flow;
    if (!isRunning(flow)) return;
    cancelRequested = true;
    update((s) => ({ ...s, flow: renderStep(s.flow, { type: 'stop' }) }));
  }

  /** Back to the settings (only when no render is running). */
  function reset() {
    update((s) => (isRunning(s.flow) ? s : { ...INITIAL_STATE }));
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

/**
 * Add the show's sound to a rendered video with the bundled ffmpeg
 * (desktop), from show time `start` for `seconds` (frame 0 of the video is
 * show time `start`). The Timeline's sound rows come rendered
 * (`soundtrackPath`, deleted by the mux); the Show mixes its files, looped
 * like the show. Returns a note for the finished render, or null when the
 * show has no audio. A failed mix leaves the silent video as it was.
 */
async function addShowSoundtrack(
  videoPath: string,
  range: { start: number; seconds: number; soundtrackPath: string | null },
): Promise<string | null> {
  const show = get(showTimeline);
  if (!show.audioTracks.some(t => !t.muted && t.volume > 0)) {
    await discardSoundtrackWav(range.soundtrackPath);
    return null;
  }
  const soundtrackLength = range.start + range.seconds;
  const tracks = range.soundtrackPath
    ? [{ path: range.soundtrackPath, startTime: 0, offset: 0, duration: soundtrackLength, volume: 1 }]
    : showMuxTracks(show.audioTracks);
  if (tracks.length === 0) return 'Saved without sound: the show audio is not in a file on this computer.';
  try {
    const result = await invoke<{ success?: boolean; error?: string }>('show_audio_mux', {
      videoPath,
      tracks,
      showDuration: range.soundtrackPath ? soundtrackLength : show.duration,
      renderDuration: range.seconds,
      renderStart: range.start,
      loop: range.soundtrackPath ? false : show.loop,
    });
    if (result?.success) return 'The show audio is in the video.';
    console.warn('[offlineRender] show audio mux failed:', result?.error);
    return `Saved without sound: ${result?.error || 'the audio could not be added'}.`;
  } catch (err) {
    console.warn('[offlineRender] show audio mux failed:', err);
    await discardSoundtrackWav(range.soundtrackPath);
    return `Saved without sound: ${formatErr(err)}.`;
  }
}

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


export async function thumbnailFromVideoUrl(url: string, atSeconds: number): Promise<string | undefined> {
  // `url` stays alive after this returns when it is the media-library
  // item's src. Only the temporary <video> below must be released.
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

export async function thumbnailFromBlob(blob: Blob, url: string, atSeconds: number): Promise<string | undefined> {
  void blob;
  return thumbnailFromVideoUrl(url, atSeconds);
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
