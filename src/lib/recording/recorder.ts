// Shared Recording Service
// Centralizes canvas recording logic used by App, PresetTray, and VJModePanel
// Supports optional audio capture: a mixdown of the opt-in clip audio bus
// and the shared audio analyzer's live input (clipAudioBus.getRecordingAudioStream)

import { get } from 'svelte/store';
import { project } from '../stores/layers';
import { settings, getMimeType, getFileExtension } from '../stores/settings';
import { mediaLibrary } from '../stores/media';
import { generateUUID } from '../types';
import { getRecordingAudioStream, type RecordingAudioStream } from '../audio/clipAudioBus';
import { createAssetRefFromGeneratedBlob, pathToFileUrl } from '../storage/assetRegistry';
import { NATIVE_ENGINE_ONLY } from '../stores/settings';
import { invoke, isElectron } from '../bridge';
import { startNativeRendererLiveFrameRecording } from './nativeLiveFrameRecorder';

// ============================================================================
// TYPES
// ============================================================================

export interface RecorderOptions {
  /** Label prefix for saved recordings (e.g., 'Recording', 'VJ Recording') */
  namePrefix?: string;
  /** Explicit canvas to record. Defaults to the main output canvas. */
  canvas?: HTMLCanvasElement | (() => HTMLCanvasElement | null);
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

function resolveCanvas(source: RecorderOptions['canvas']): HTMLCanvasElement | null {
  if (!source) return findCanvas();
  return typeof source === 'function' ? source() : source;
}

// ============================================================================
// NATIVE-CORE LIVE RECORDING (async start behind a sync handle)
// ============================================================================

/** Renderer-side audio sidecar for native recordings.
 *
 *  Native video is encoded outside the renderer (main-process IOSurface
 *  pump, or the broker's frame encoder), so neither can hear the app's
 *  WebAudio graph. Record the shared audio stream to opus/webm here in
 *  parallel and hand the bytes to `native_recording_mux_audio` at stop,
 *  which remuxes them into the finished MP4 (video stream copied, audio
 *  transcoded to AAC). Returns null when audio is disabled in settings or
 *  no audio source is active — recording then stays video-only exactly as
 *  before. */
type AudioSidecar = { stop(): Promise<Uint8Array | null>; discard(): void };

function startRecordingAudioSidecar(): AudioSidecar | null {
  const recSettings = settings.get().recording;
  // Deliberate setting, not a fault — log, don't warn.
  if (recSettings.includeAudio === false) {
    console.log('[Recorder] Audio capture is OFF in settings — recording video-only.');
    return null;
  }
  let audioResult: RecordingAudioStream | null = null;
  try {
    // Mixdown of clip-audio bus + live analyzer input. Falls back to the
    // analyzer-only stream when no clip has opted into audio, so shows that
    // don't use the feature record exactly as before. Without this, a show
    // whose only sound is clip playback recorded silent: analyzer
    // getAudioStream() returns null unless an analyzer INPUT is running.
    audioResult = getRecordingAudioStream();
  } catch (err) {
    console.warn('[Recorder] audio mixdown unavailable:', err);
    return null;
  }
  if (!audioResult) return null;
  const tracks = audioResult.stream.getAudioTracks();
  if (!tracks.length) {
    console.warn('[Recorder] Audio mixdown produced no tracks — recording video-only.');
    audioResult.cleanup?.();
    return null;
  }
  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(new MediaStream(tracks), {
      mimeType: 'audio/webm;codecs=opus',
      audioBitsPerSecond: recSettings.audioBitrate || 192_000,
    });
  } catch (err) {
    console.warn('[Recorder] audio sidecar unavailable:', err);
    audioResult.cleanup?.();
    return null;
  }
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };
  // 1s timeslices bound the data lost if the app dies mid-recording.
  recorder.start(1000);
  console.log(`[Recorder] audio sidecar started — capturing: ${audioResult.sources.join(' + ')}`);
  let finished = false;
  const finish = async (): Promise<Uint8Array | null> => {
    if (finished) return null;
    finished = true;
    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
      try { recorder.stop(); } catch { resolve(); }
    });
    audioResult?.cleanup?.();
    if (!chunks.length) return null;
    const buf = await new Blob(chunks, { type: 'audio/webm' }).arrayBuffer();
    return new Uint8Array(buf);
  };
  return {
    stop: finish,
    discard() {
      void finish();
    },
  };
}

/** Mux the sidecar's audio into a finished MP4. Returns true only when the
 *  file on disk now carries the audio track; a failed mux leaves the
 *  video-only file untouched. */
async function muxSidecarAudio(outputPath: string, sidecar: AudioSidecar | null): Promise<boolean> {
  if (!sidecar) return false;
  let audio: Uint8Array | null = null;
  try {
    audio = await sidecar.stop();
  } catch (err) {
    console.warn('[Recorder] audio sidecar stop failed:', err);
    return false;
  }
  if (!audio || audio.length === 0) return false;
  try {
    const result = await invoke('native_recording_mux_audio', {
      videoPath: outputPath,
      audio,
    }) as { success?: boolean; error?: string } | null;
    if (!result?.success) {
      console.warn('[Recorder] audio mux failed:', result?.error);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[Recorder] audio mux invoke failed:', err);
    return false;
  }
}

function startNativeCoreLiveRecording(options: RecorderOptions): RecorderHandle {
  let innerFallback: RecorderHandle | null = null;
  let mainProcessActive = false;
  let stopRequested = false;
  let failed = false;
  let recording = true;
  let duration = 0;
  let muxedAudio = false;
  // Started immediately so audio covers the whole capture regardless of
  // which video path (main-process pump or snapshot fallback) wins.
  const audioSidecar = startRecordingAudioSidecar();
  const autoDownload = !!settings.get().recording.autoDownload;
  const namePrefix = options.namePrefix || 'Recording';

  const durationTimer = window.setInterval(() => {
    if (!recording) return;
    duration += 1;
    options.onDurationUpdate?.(duration);
  }, 1000);

  const finishFail = (err: unknown) => {
    failed = true;
    recording = false;
    window.clearInterval(durationTimer);
    audioSidecar?.discard();
    options.onError?.(err instanceof Error ? err : new Error(String(err)));
  };

  const stopMainProcessRecording = async () => {
    recording = false;
    window.clearInterval(durationTimer);
    try {
      const result = await invoke('native_output_recording_stop') as {
        success?: boolean;
        error?: string;
        outputPath?: string;
        durationSeconds?: number;
        thumbnailDataUrl?: string | null;
      } | null;
      if (!result?.success || !result.outputPath) {
        throw new Error(result?.error || 'Native recording failed.');
      }
      muxedAudio = await muxSidecarAudio(result.outputPath, audioSidecar);
      const url = pathToFileUrl(result.outputPath);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const name = `${namePrefix} ${timestamp}`;
      mediaLibrary.addItem({
        id: generateUUID(),
        name,
        type: 'video',
        src: url,
        thumbnail: result.thumbnailDataUrl ?? undefined,
        _assetRef: {
          kind: 'local-file',
          originalPath: result.outputPath,
          name: `${name}.mp4`,
          mime: 'video/mp4',
          size: 0,
          lastModified: Date.now(),
        },
      });
      if (autoDownload) {
        const dialog = await invoke('save_project_dialog', {
          title: 'Save Recording',
          defaultPath: `${name}.mp4`,
          filters: [
            { name: 'MP4 Video', extensions: ['mp4'] },
            { name: 'All Files', extensions: ['*'] },
          ],
        }) as { canceled?: boolean; filePath?: string | null } | null;
        if (!dialog?.canceled && dialog?.filePath) {
          await invoke('copy_file_to_project', {
            sourcePath: result.outputPath,
            destPath: dialog.filePath,
          });
        }
      }
      options.onComplete?.();
    } catch (err) {
      finishFail(err);
    }
  };

  void (async () => {
    // Preferred: main-process IOSurface capture — zero per-frame work in
    // the renderer or the render core, so live output stays smooth.
    const started = await invoke('native_output_recording_start', {
      // 60fps: main-process IOSurface capture costs a memcpy per frame,
      // and hardware VideoToolbox encodes 1080p60 easily — matching the
      // output rate removes the temporal aliasing 30fps sampling showed.
      fps: 60,
      quality: 'high',
      namePrefix,
    }).catch((err) => ({ success: false, error: String(err) })) as { success?: boolean; error?: string } | null;
    if (started?.success) {
      mainProcessActive = true;
      if (stopRequested) void stopMainProcessRecording();
      return;
    }
    console.warn('[Recorder] Main-process capture unavailable, falling back to snapshot recorder:', started?.error);
    // Fallback: renderer-driven snapshot recorder (heavier).
    const proj = get(project);
    try {
      const handle = await startNativeRendererLiveFrameRecording({
        width: proj.width || 1920,
        height: proj.height || 1080,
        fps: 30,
        quality: 'high',
        namePrefix,
        liveClock: true,
        promptSave: autoDownload,
        finalizeOutput: async (outputPath) => {
          muxedAudio = await muxSidecarAudio(outputPath, audioSidecar);
        },
        onDurationUpdate: (seconds) => {
          duration = seconds;
          options.onDurationUpdate?.(seconds);
        },
        onComplete: () => {
          recording = false;
          window.clearInterval(durationTimer);
          options.onComplete?.();
        },
        onError: finishFail,
      });
      innerFallback = handle;
      if (stopRequested) handle?.stop();
    } catch (err) {
      finishFail(err);
    }
  })();

  return {
    stop() {
      if (stopRequested) return;
      stopRequested = true;
      if (mainProcessActive) {
        void stopMainProcessRecording();
      } else {
        innerFallback?.stop();
      }
    },
    get isRecording() {
      if (failed || stopRequested) return false;
      return recording;
    },
    get duration() {
      return innerFallback?.duration ?? duration;
    },
    get hasAudio() {
      return muxedAudio;
    },
  };
}

// ============================================================================
// RECORDING SERVICE
// ============================================================================

/**
 * Start recording the main canvas output.
 * Optionally captures audio from the shared audio system.
 */
export function startRecording(options: RecorderOptions = {}): RecorderHandle | null {
  // Native mode: the WebGL canvas is a cleared underlay — captureStream
  // would record black. Record the core's live output via frame
  // snapshots into the native MP4 encoder instead. Video-only for now
  // (audio muxing into the native encoder is a separate piece).
  if (isElectron && NATIVE_ENGINE_ONLY) {
    return startNativeCoreLiveRecording(options);
  }
  const canvas = resolveCanvas(options.canvas);
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
  let videoStreamCleaned = false;
  const cleanupVideoStream = () => {
    if (videoStreamCleaned) return;
    videoStreamCleaned = true;
    try { videoStream.getTracks().forEach(track => track.stop()); } catch {}
  };

  // Get audio stream (if enabled and available)
  let combinedStream: MediaStream;
  let hasAudio = false;
  let audioCleanup: (() => void) | null = null;

  if (includeAudio) {
    // Same mixdown-or-fallback rule as the native sidecar above.
    const audioResult = getRecordingAudioStream();
    if (audioResult) {
      const audioTracks = audioResult.stream.getAudioTracks();
      if (audioTracks.length > 0) {
        combinedStream = new MediaStream([
          ...videoStream.getVideoTracks(),
          ...audioTracks,
        ]);
        hasAudio = true;
        audioCleanup = audioResult.cleanup;
        console.log(`[Recorder] Audio track attached — capturing: ${audioResult.sources.join(' + ')}`);
      } else {
        combinedStream = videoStream;
        console.warn('[Recorder] Audio stream had no tracks, recording video-only');
      }
    } else {
      combinedStream = videoStream;
      console.warn('[Recorder] No audio source active, recording video-only');
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
    try {
      mediaRecorder = new MediaRecorder(videoStream, {
        mimeType: videoOnlyMime,
        videoBitsPerSecond: recSettings.videoBitrate,
      });
    } catch (fallbackErr) {
      cleanupVideoStream();
      if (audioCleanup) {
        audioCleanup();
        audioCleanup = null;
      }
      options.onError?.(fallbackErr instanceof Error ? fallbackErr : new Error(String(fallbackErr)));
      return null;
    }
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
    try {
      const finalMime = mediaRecorder.mimeType || mimeType;
      const blob = new Blob(recordedChunks, { type: finalMime });
      await saveRecordingToLibrary(blob, finalMime, options.namePrefix || 'Recording');
      options.onComplete?.();
    } catch (err) {
      options.onError?.(err instanceof Error ? err : new Error(String(err)));
    } finally {
      cleanupVideoStream();
      // Cleanup audio destination node if created
      if (audioCleanup) {
        audioCleanup();
        audioCleanup = null;
      }
    }
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
        cleanupVideoStream();
        if (audioCleanup) { audioCleanup(); audioCleanup = null; }
        options.onComplete?.();
        return;
      }
      try {
        mediaRecorder.start(1000);
        mediaRecorderStarted = true;
        console.log(`[Recorder] Started — ${mimeType} — audio: ${hasAudio} — fps: 60`);
      } catch (err) {
        isRecording = false;
        clearInterval(durationInterval);
        cleanupVideoStream();
        if (audioCleanup) { audioCleanup(); audioCleanup = null; }
        options.onError?.(err instanceof Error ? err : new Error(String(err)));
      }
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
    // NOTE: this blob URL is intentionally long-lived — it becomes the
    // media-library item's `src`, so revoking it would break playback.
    const url = URL.createObjectURL(blob);
    const video = document.createElement('video');
    let thumbnail: string | undefined;
    try {
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
      if (ctx) {
        ctx.drawImage(video, 0, 0, thumbCanvas.width, thumbCanvas.height);
        thumbnail = thumbCanvas.toDataURL('image/jpeg', 0.7);
      }
    } finally {
      // Release the temporary element's decoder + buffered media — one
      // of these leaked per recording before.
      video.onloadeddata = null;
      video.onerror = null;
      video.onseeked = null;
      try { video.pause(); } catch { /* ignore */ }
      video.removeAttribute('src');
      try { video.load(); } catch { /* ignore */ }
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
