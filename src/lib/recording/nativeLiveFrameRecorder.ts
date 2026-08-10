import { mediaLibrary } from '../stores/media';
import { pathToFileUrl, type AssetRef } from '../storage/assetRegistry';
import { generateUUID } from '../utils/uuid';
import { invoke, isElectron } from '../bridge';
import {
  getNativeRendererCapabilities,
  getNativeRendererFrameSnapshot,
  getNativeRendererStatus,
  submitNativeRendererCommands,
} from '../api/native-renderer';
import type { OfflineRenderSettings } from './offlineRender';
import type { RecorderHandle } from './recorder';
import {
  cancelNativeMp4FrameEncoder,
  finishNativeMp4FrameEncoder,
  formatErr,
  startNativeMp4FrameEncoder,
  thumbnailFromVideoUrl,
  writeNativeMp4Frame,
  writeNativeRendererMp4Frame,
  writeNativeRendererMp4FrameLiveSpan,
  type NativeMp4FrameEncoderSession,
} from './offlineRender';

export type NativeLiveFrame = { data: Uint8Array; width: number; height: number };

export interface NativeLiveFrameRecorderOptions {
  captureFrame: (width: number, height: number) => Promise<NativeLiveFrame>;
  width: number;
  height: number;
  fps?: number;
  quality?: OfflineRenderSettings['quality'];
  namePrefix?: string;
  unavailableMessage?: string;
  onDurationUpdate?: (seconds: number) => void;
  onComplete?: () => void;
  onError?: (error: Error) => void;
}

export interface NativeRendererLiveFrameRecorderOptions {
  width: number;
  height: number;
  /** Record the core's LIVE clock output as-is: no output resize, no
   *  manual frame times — each frame snapshots whatever the core is
   *  presenting right now. Used by the app's REC button. The default
   *  (false) is the deterministic manual-clock path used by the
   *  projection-sim reel recorder. */
  liveClock?: boolean;
  /** After saving to the media library, show a Save dialog and copy the
   *  MP4 to the chosen path (live REC parity with the old recorder's
   *  auto-download prompt). */
  promptSave?: boolean;
  fps?: number;
  quality?: OfflineRenderSettings['quality'];
  namePrefix?: string;
  unavailableMessage?: string;
  prepareFrame?: (frameIndex: number, timeSeconds: number) => Promise<void> | void;
  restore?: () => Promise<void> | void;
  onDurationUpdate?: (seconds: number) => void;
  onComplete?: () => void;
  onError?: (error: Error) => void;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, ms));
}

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(formatErr(err));
}

function recordingName(prefix: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `${prefix} ${timestamp}`;
}

function nativePixelFormatForOutput(format: string | null | undefined): 'rgba' | 'bgra' {
  return /bgra/i.test(String(format ?? '')) ? 'bgra' : 'rgba';
}

async function ensureNativeFrameExportReady(message?: string): Promise<void> {
  const caps = await getNativeRendererCapabilities();
  const methods = Array.isArray(caps?.implemented_methods) ? caps.implemented_methods : [];
  const features = caps?.features ?? {};
  const ready = !!(
    caps?.core_capabilities_confirmed &&
    features.native_recording &&
    features.native_frame_export &&
    features.frame_snapshot_export &&
    methods.includes('export_frame_snapshot')
  );
  if (!ready) {
    throw new Error(message || 'Native renderer frame recording is not available in this build.');
  }
}

async function saveMp4ToLibrary(
  session: NativeMp4FrameEncoderSession,
  frames: number,
  namePrefix: string,
): Promise<{ outputPath: string; name: string }> {
  const encoded = await finishNativeMp4FrameEncoder(session);
  const url = pathToFileUrl(encoded.outputPath);
  const durationSeconds = frames / Math.max(1, session.fps);
  const thumbnail = await thumbnailFromVideoUrl(url, Math.min(2, durationSeconds * 0.4));
  const name = recordingName(namePrefix);
  const assetRef: AssetRef = {
    kind: 'local-file',
    originalPath: encoded.outputPath,
    name: `${name}.mp4`,
    mime: 'video/mp4',
    size: encoded.size,
    lastModified: Date.now(),
  };

  mediaLibrary.addItem({
    id: generateUUID(),
    name,
    type: 'video',
    src: url,
    thumbnail,
    _assetRef: assetRef,
  });
  return { outputPath: encoded.outputPath, name };
}

/** Live REC parity with the old recorder: prompt for a save location and
 *  copy the already-encoded MP4 there (fast on-disk copy, no IPC bytes). */
async function promptSaveMp4(outputPath: string, name: string): Promise<void> {
  try {
    const result = await invoke('save_project_dialog', {
      title: 'Save Recording',
      defaultPath: `${name}.mp4`,
      filters: [
        { name: 'MP4 Video', extensions: ['mp4'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    }) as { canceled?: boolean; filePath?: string | null } | null;
    if (result?.canceled || !result?.filePath) return;
    const copy = await invoke('copy_file_to_project', {
      sourcePath: outputPath,
      destPath: result.filePath,
    }) as { success?: boolean; error?: string } | null;
    if (!copy?.success) {
      console.warn('[NativeRec] Failed to copy recording to chosen path:', copy?.error);
    }
  } catch (err) {
    console.warn('[NativeRec] Save prompt failed:', err);
  }
}

/**
 * Desktop live recorder backed by native FFmpeg.
 *
 * Callers provide a synchronous-with-render capture hook returning
 * top-down RGBA frames. The recorder throttles to the requested FPS and
 * streams raw frames into the native MP4 pipe, avoiding MediaRecorder
 * and browser compositor capture.
 */
export async function startNativeLiveFrameRecording(
  options: NativeLiveFrameRecorderOptions,
): Promise<RecorderHandle | null> {
  if (!isElectron) {
    throw new Error(options.unavailableMessage || 'Native live recording requires the desktop app.');
  }

  const width = Math.max(2, Math.round(options.width));
  const height = Math.max(2, Math.round(options.height));
  const fps = Math.max(1, Math.min(60, Math.round(options.fps ?? 30)));
  const namePrefix = options.namePrefix || 'Recording';
  const session = await startNativeMp4FrameEncoder({
    width,
    height,
    fps,
    quality: options.quality ?? 'high',
    filename: namePrefix,
  }, 0, 'rgba');

  let active = true;
  let finishing = false;
  let duration = 0;
  let frameIndex = 0;
  let rafId = 0;
  let pumpPromise: Promise<void> | null = null;
  const startedAt = performance.now();
  const frameMs = 1000 / fps;
  let nextFrameAt = startedAt;

  const durationTimer = window.setInterval(() => {
    if (!active && !finishing) return;
    duration = Math.max(0, Math.floor((performance.now() - startedAt) / 1000));
    options.onDurationUpdate?.(duration);
  }, 250);

  const cleanupTimers = () => {
    window.clearInterval(durationTimer);
    if (rafId) window.cancelAnimationFrame(rafId);
    rafId = 0;
  };

  const fail = async (err: unknown) => {
    if (!active && !finishing) return;
    active = false;
    finishing = false;
    cleanupTimers();
    await cancelNativeMp4FrameEncoder(session);
    options.onError?.(toError(err));
  };

  const captureAndWrite = async () => {
    try {
      const frame = await options.captureFrame(width, height);
      if (!active || finishing) return;
      await writeNativeMp4Frame(session, frameIndex, frame);
      frameIndex++;
    } catch (err) {
      if (!active || finishing) return;
      await fail(err);
    }
  };

  const schedule = () => {
    if (!active || finishing) return;
    rafId = window.requestAnimationFrame(() => {
      if (!active || finishing) return;
      const now = performance.now();
      if (now + 1 < nextFrameAt) {
        schedule();
        return;
      }
      nextFrameAt = Math.max(nextFrameAt + frameMs, now + frameMs);
      pumpPromise = captureAndWrite().finally(() => {
        pumpPromise = null;
        schedule();
      });
    });
  };

  const finish = async () => {
    if (finishing || !active) return;
    active = false;
    finishing = true;
    cleanupTimers();
    if (pumpPromise) {
      await Promise.race([pumpPromise.catch(() => {}), delay(1500)]);
    }
    try {
      if (frameIndex <= 0) {
        await cancelNativeMp4FrameEncoder(session);
        throw new Error('Recording stopped before any frames were captured.');
      }
      await saveMp4ToLibrary(session, frameIndex, namePrefix);
      options.onComplete?.();
    } catch (err) {
      await cancelNativeMp4FrameEncoder(session);
      options.onError?.(toError(err));
    } finally {
      finishing = false;
    }
  };

  schedule();

  return {
    stop() {
      void finish();
    },
    get isRecording() {
      return active;
    },
    get duration() {
      return duration;
    },
    get hasAudio() {
      return false;
    },
  };
}

/**
 * Desktop live recorder backed by native renderer snapshots.
 *
 * This path keeps rendering and readback inside the Rust render core,
 * then hands each raw snapshot file directly to the desktop MP4 frame
 * encoder. It is the live-recording equivalent of the offline native
 * render path and avoids browser canvas capture entirely.
 */
export async function startNativeRendererLiveFrameRecording(
  options: NativeRendererLiveFrameRecorderOptions,
): Promise<RecorderHandle | null> {
  if (!isElectron) {
    throw new Error(options.unavailableMessage || 'Native renderer recording requires the desktop app.');
  }

  await ensureNativeFrameExportReady(options.unavailableMessage);

  const liveClock = !!options.liveClock;
  const fps = Math.max(1, Math.min(60, Math.round(options.fps ?? 30)));
  const namePrefix = options.namePrefix || 'Recording';
  let restored = false;

  const restoreStatus = await getNativeRendererStatus().catch(() => null);
  // Live REC records the output exactly as it is being presented —
  // never resize the projector output mid-show.
  const width = liveClock && restoreStatus
    ? Math.max(2, Math.round(restoreStatus.output_width))
    : Math.max(2, Math.round(options.width));
  const height = liveClock && restoreStatus
    ? Math.max(2, Math.round(restoreStatus.output_height))
    : Math.max(2, Math.round(options.height));
  const restoreOnce = async () => {
    if (restored) return;
    restored = true;
    if (!liveClock && restoreStatus) {
      await submitNativeRendererCommands([
        {
          type: 'set_output',
          width: restoreStatus.output_width,
          height: restoreStatus.output_height,
          refresh_hz: restoreStatus.output_refresh_hz || restoreStatus.target_fps || 60,
        },
      ]).catch(() => {});
    }
    await options.restore?.();
  };

  if (!liveClock) {
    await submitNativeRendererCommands([
      { type: 'set_output', width, height, refresh_hz: fps },
    ]);
  }

  try {
    if (!liveClock) await options.prepareFrame?.(0, 0);
    const probe = await getNativeRendererFrameSnapshot(false, liveClock ? {} : { time: 0, frame_index: 0 });
    if (
      probe.width !== width ||
      probe.height !== height ||
      (!liveClock && (probe.dark_frame || Number(probe.nonzero_pixels ?? 0) <= 0))
    ) {
      throw new Error(
        `Native renderer stage capture probe failed (${probe.width}x${probe.height}, dark=${probe.dark_frame}, nonzero=${probe.nonzero_pixels})`,
      );
    }
  } catch (err) {
    await restoreOnce().catch(() => {});
    throw err;
  }

  const nativeStatus = await getNativeRendererStatus();
  const pixelFormat = nativePixelFormatForOutput(nativeStatus.output_format);

  const session = await startNativeMp4FrameEncoder({
    width,
    height,
    fps,
    quality: options.quality ?? 'high',
    filename: namePrefix,
  }, 0, pixelFormat);

  let active = true;
  let finishing = false;
  let duration = 0;
  let frameIndex = 0;
  let rafId = 0;
  let pumpPromise: Promise<void> | null = null;
  const startedAt = performance.now();
  const frameMs = 1000 / fps;
  let nextFrameAt = startedAt;

  const durationTimer = window.setInterval(() => {
    if (!active && !finishing) return;
    duration = Math.max(0, Math.floor((performance.now() - startedAt) / 1000));
    options.onDurationUpdate?.(duration);
  }, 250);

  const cleanupTimers = () => {
    window.clearInterval(durationTimer);
    if (rafId) window.cancelAnimationFrame(rafId);
    rafId = 0;
  };

  const fail = async (err: unknown) => {
    if (!active && !finishing) return;
    active = false;
    finishing = false;
    cleanupTimers();
    await cancelNativeMp4FrameEncoder(session);
    await restoreOnce().catch(() => {});
    options.onError?.(toError(err));
  };

  const captureAndWrite = async () => {
    try {
      const timeSeconds = frameIndex / fps;
      if (!liveClock) await options.prepareFrame?.(frameIndex, timeSeconds);
      if (!active || finishing) return;
      if (liveClock) {
        // Pace by the wall clock: one capture covers every frame slot
        // that elapsed since the last one (duplicates keep real-time
        // playback; cap runaway spans at 2s so a long stall can't
        // spiral into thousands of writes).
        const elapsed = (performance.now() - startedAt) / 1000;
        const targetIndex = Math.min(
          frameIndex + fps * 2,
          Math.max(frameIndex, Math.floor(elapsed * fps)),
        );
        await writeNativeRendererMp4FrameLiveSpan(session, frameIndex, targetIndex);
        frameIndex = targetIndex + 1;
      } else {
        await writeNativeRendererMp4Frame(session, frameIndex, timeSeconds);
        frameIndex++;
      }
    } catch (err) {
      if (!active || finishing) return;
      await fail(err);
    }
  };

  const schedule = () => {
    if (!active || finishing) return;
    rafId = window.requestAnimationFrame(() => {
      if (!active || finishing) return;
      const now = performance.now();
      if (now + 1 < nextFrameAt) {
        schedule();
        return;
      }
      nextFrameAt = Math.max(nextFrameAt + frameMs, now + frameMs);
      pumpPromise = captureAndWrite().finally(() => {
        pumpPromise = null;
        schedule();
      });
    });
  };

  const finish = async () => {
    if (finishing || !active) return;
    active = false;
    finishing = true;
    cleanupTimers();
    if (pumpPromise) {
      await Promise.race([pumpPromise.catch(() => {}), delay(1500)]);
    }
    try {
      if (frameIndex <= 0) {
        await cancelNativeMp4FrameEncoder(session);
        throw new Error('Recording stopped before any native renderer frames were captured.');
      }
      const saved = await saveMp4ToLibrary(session, frameIndex, namePrefix);
      await restoreOnce();
      if (options.promptSave) await promptSaveMp4(saved.outputPath, saved.name);
      options.onComplete?.();
    } catch (err) {
      await cancelNativeMp4FrameEncoder(session);
      await restoreOnce().catch(() => {});
      options.onError?.(toError(err));
    } finally {
      finishing = false;
    }
  };

  schedule();

  return {
    stop() {
      void finish();
    },
    get isRecording() {
      return active;
    },
    get duration() {
      return duration;
    },
    get hasAudio() {
      return false;
    },
  };
}
