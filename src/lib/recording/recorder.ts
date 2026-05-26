// Shared Recording Service
// Centralizes canvas recording logic used by App, PresetTray, and VJModePanel
// Supports optional audio capture from the shared audioStore

import { get } from 'svelte/store';
import { project } from '../stores/layers';
import { settings, getMimeType, getFileExtension } from '../stores/settings';
import { mediaLibrary } from '../stores/media';
import { generateUUID } from '../types';
import { audioStore } from '../stores/audio';
import { createAssetRefFromGeneratedBlob } from '../storage/assetRegistry';

// ============================================================================
// TYPES
// ============================================================================

export interface RecorderOptions {
  /** Label prefix for saved recordings (e.g., 'Recording', 'VJ Recording') */
  namePrefix?: string;
  /** Called every second with updated duration */
  onDurationUpdate?: (seconds: number) => void;
  /** Called when recording completes and is saved */
  onComplete?: () => void;
  /** Called on error */
  onError?: (error: Error) => void;
}

export interface RecorderHandle {
  /** Stop the current recording */
  stop(): void;
  /** Whether recording is currently active */
  readonly isRecording: boolean;
  /** Current duration in seconds */
  readonly duration: number;
  /** Whether audio is being captured */
  readonly hasAudio: boolean;
}

// ============================================================================
// MIME TYPE HELPERS (with audio codec support)
// ============================================================================

function getMimeTypeWithAudio(formatId: string): string {
  const formats: Record<string, string> = {
    'webm-vp9': 'video/webm;codecs=vp9,opus',
    'webm-vp8': 'video/webm;codecs=vp8,opus',
    'mp4-h264': 'video/mp4;codecs=avc1.424028,mp4a.40.2',
  };
  return formats[formatId] || 'video/webm;codecs=vp9,opus';
}

function findSupportedMimeType(preferredMime: string, withAudio: boolean): string {
  // Try preferred first
  if (MediaRecorder.isTypeSupported(preferredMime)) {
    return preferredMime;
  }

  // Fallback chain
  const fallbacks = withAudio
    ? [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm;codecs=vp9',
        'video/webm;codecs=vp8',
        'video/webm',
      ]
    : [
        'video/webm;codecs=vp9',
        'video/webm;codecs=vp8',
        'video/webm',
      ];

  for (const mime of fallbacks) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }

  return 'video/webm';
}

// ============================================================================
// CANVAS DISCOVERY
// ============================================================================

function findCanvas(): HTMLCanvasElement | null {
  return (
    document.querySelector('canvas.main-canvas') as HTMLCanvasElement ||
    document.querySelector('.canvas-container canvas') as HTMLCanvasElement ||
    document.querySelector('canvas') as HTMLCanvasElement ||
    null
  );
}

// ============================================================================
// RECORDING SERVICE
// ============================================================================

/**
 * Start recording the main canvas output.
 * Optionally captures audio from the shared audio system.
 */
export function startRecording(options: RecorderOptions = {}): RecorderHandle | null {
  const canvas = findCanvas();
  if (!canvas) {
    options.onError?.(new Error('No canvas found to record'));
    return null;
  }

  const currentSettings = settings.get();
  const recSettings = currentSettings.recording;
  const includeAudio = recSettings.includeAudio ?? true;

  // Determine MIME type
  const preferredMime = includeAudio
    ? getMimeTypeWithAudio(recSettings.format)
    : getMimeType(recSettings.format);
  const mimeType = findSupportedMimeType(preferredMime, includeAudio);

  // Use the canvas's actual drawing buffer dimensions for recording.
  // Do NOT resize canvas.width/height here — Three.js sets them to
  // projectW * pixelRatio (e.g. 3840×2160 for 1920×1080 at DPR=2).
  // Resizing would destroy the drawing buffer and break rendering.
  console.log(`[Recorder] Recording at canvas buffer size: ${canvas.width}x${canvas.height}`);

  // Get video stream at 60fps to match the editor's rAF cadence on
  // high-refresh displays. Hardcoded 30 was the previous default — fine
  // for slideshow content but produced visibly jittery playback when
  // the canvas was actually rendering at 60+fps. captureStream(60) will
  // duplicate frames internally if the canvas renders slower; the
  // encoder handles duplicates fine and the resulting file plays back
  // smoothly on any framerate target.
  const videoStream = canvas.captureStream(60);

  // Get audio stream (if enabled and available)
  let combinedStream: MediaStream;
  let hasAudio = false;
  let audioCleanup: (() => void) | null = null;

  if (includeAudio) {
    const audioResult = audioStore.getAudioStream();
    if (audioResult) {
      const audioTracks = audioResult.stream.getAudioTracks();
      if (audioTracks.length > 0) {
        combinedStream = new MediaStream([
          ...videoStream.getVideoTracks(),
          ...audioTracks,
        ]);
        hasAudio = true;
        audioCleanup = audioResult.cleanup;
        console.log('[Recorder] Audio track attached to recording');
      } else {
        combinedStream = videoStream;
        console.log('[Recorder] Audio stream had no tracks, recording video-only');
      }
    } else {
      combinedStream = videoStream;
      console.log('[Recorder] No audio source active, recording video-only');
    }
  } else {
    combinedStream = videoStream;
  }

  // Configure MediaRecorder
  const recorderOptions: MediaRecorderOptions = {
    mimeType,
    videoBitsPerSecond: recSettings.videoBitrate,
  };
  if (hasAudio && recSettings.audioBitrate) {
    recorderOptions.audioBitsPerSecond = recSettings.audioBitrate;
  }

  let mediaRecorder: MediaRecorder;
  try {
    mediaRecorder = new MediaRecorder(combinedStream, recorderOptions);
  } catch (err) {
    // If audio codec fails, try video-only
    console.warn('[Recorder] Failed with audio codec, falling back to video-only:', err);
    const videoOnlyMime = findSupportedMimeType(getMimeType(recSettings.format), false);
    mediaRecorder = new MediaRecorder(videoStream, {
      mimeType: videoOnlyMime,
      videoBitsPerSecond: recSettings.videoBitrate,
    });
    hasAudio = false;
    if (audioCleanup) {
      audioCleanup();
      audioCleanup = null;
    }
  }

  const recordedChunks: Blob[] = [];
  let duration = 0;
  let isRecording = true;
  // Two-phase start: the recorder is "armed" synchronously (handle is
  // returned to the caller right away so the UI flips into recording
  // state) but mediaRecorder.start() is deferred by two rAFs. This lets
  // the editor's animate loop push at least one fresh canvas redraw
  // into the captureStream pipe before the encoder starts consuming
  // from it. Without this delay the encoder samples whatever stale
  // frame was in the canvas at function-call time, writes it as the
  // file's opening frame, and the player freezes on that frame for
  // ~1s while waiting for the next keyframe to update the displayed
  // image — visible as the "freezes for a second then plays smoothly"
  // start-of-recording stutter.
  let mediaRecorderStarted = false;
  let stopBeforeStart = false;

  // Duration timer — kicks off immediately so the UI clock counts from
  // user-perceived "I clicked record" rather than from when the encoder
  // actually began. The ~33 ms warmup difference is invisible.
  const durationInterval = window.setInterval(() => {
    duration++;
    options.onDurationUpdate?.(duration);
  }, 1000);

  // Data handler
  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) {
      recordedChunks.push(e.data);
    }
  };

  // Stop handler
  mediaRecorder.onstop = async () => {
    const finalMime = mediaRecorder.mimeType || mimeType;
    const blob = new Blob(recordedChunks, { type: finalMime });
    await saveRecordingToLibrary(blob, finalMime, options.namePrefix || 'Recording');

    // Cleanup audio destination node if created
    if (audioCleanup) {
      audioCleanup();
      audioCleanup = null;
    }

    options.onComplete?.();
  };

  // Defer start by two rAF ticks — see comment above. Two ticks (vs one)
  // guarantees we cross at least one editor animate() boundary on every
  // refresh-rate target, including 120/144 Hz where a single rAF can fire
  // before the renderer has time to draw.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (stopBeforeStart) {
        // User clicked Stop within the warmup window. Skip start() and
        // run cleanup paths directly so the caller's onComplete still
        // fires and audio resources are released.
        clearInterval(durationInterval);
        if (audioCleanup) { audioCleanup(); audioCleanup = null; }
        options.onComplete?.();
        return;
      }
      mediaRecorder.start(1000);
      mediaRecorderStarted = true;
      console.log(`[Recorder] Started — ${mimeType} — audio: ${hasAudio} — fps: 60`);
    });
  });

  // Return handle
  const handle: RecorderHandle = {
    stop() {
      if (!isRecording) return;
      isRecording = false;
      clearInterval(durationInterval);
      if (mediaRecorderStarted) {
        mediaRecorder.stop();
      } else {
        // Recorder hasn't started yet — flag the warmup callback to
        // skip start() entirely so we don't write an empty file.
        stopBeforeStart = true;
      }
    },
    get isRecording() { return isRecording; },
    get duration() { return duration; },
    get hasAudio() { return hasAudio; },
  };

  return handle;
}

// ============================================================================
// SAVE / DOWNLOAD HELPERS
// ============================================================================

export async function downloadRecording(blob: Blob, filename: string): Promise<void> {
  const currentSettings = settings.get();
  const dirHandle = currentSettings.recording.saveDirectoryHandle;

  if (dirHandle) {
    try {
      const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
      console.log('[Recorder] Saved to:', dirHandle.name + '/' + filename);
      return;
    } catch (err) {
      console.warn('[Recorder] Failed to save to chosen folder, falling back to download:', err);
    }
  }

  // Fallback: browser download
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  console.log('[Recorder] Downloaded:', filename);
}

async function saveRecordingToLibrary(blob: Blob, mimeType: string, namePrefix: string): Promise<void> {
  try {
    const url = URL.createObjectURL(blob);
    const video = document.createElement('video');
    video.src = url;
    video.muted = true;

    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error('Failed to load video'));
      video.load();
    });

    video.currentTime = 0;
    await new Promise<void>((resolve) => {
      video.onseeked = () => resolve();
    });

    const thumbCanvas = document.createElement('canvas');
    thumbCanvas.width = 120;
    thumbCanvas.height = 68;
    const ctx = thumbCanvas.getContext('2d');
    let thumbnail: string | undefined;
    if (ctx) {
      ctx.drawImage(video, 0, 0, thumbCanvas.width, thumbCanvas.height);
      thumbnail = thumbCanvas.toDataURL('image/jpeg', 0.7);
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const name = `${namePrefix} ${timestamp}`;
    const extension = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('webm') ? 'webm' : 'mp4';
    const { assetRef } = await createAssetRefFromGeneratedBlob(
      blob,
      `${name}.${extension}`,
      mimeType,
      url,
    );

    mediaLibrary.addItem({
      id: generateUUID(),
      name,
      type: 'video',
      src: url,
      thumbnail,
      _assetRef: assetRef,
    });

    console.log('[Recorder] Saved to library:', name);

    // Auto-download if enabled
    const currentSettings = settings.get();
    if (currentSettings.recording.autoDownload) {
      const filename = `GhostArcade_${timestamp}.${extension}`;
      await downloadRecording(blob, filename);
    }
  } catch (err) {
    console.error('[Recorder] Failed to save recording:', err);
  }
}

// ============================================================================
// FORMAT DURATION HELPER
// ============================================================================

export function formatRecordingDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}
