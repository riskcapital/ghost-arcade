import { mediaLibrary } from '../stores/media';
import { pathToFileUrl, type AssetRef } from '../storage/assetRegistry';
import { generateUUID } from '../utils/uuid';
import { isElectron } from '../bridge';
import type { Stage3DRendererControls } from '../stage3d/store';
import type { OfflineRenderSettings } from './offlineRender';
import type { RecorderHandle } from './recorder';
import {
  cancelNativeMp4FrameEncoder,
  finishNativeMp4FrameEncoder,
  formatErr,
  startNativeMp4FrameEncoder,
  thumbnailFromVideoUrl,
  writeNativeMp4Frame,
  type NativeMp4FrameEncoderSession,
} from './offlineRender';

type Stage3DCaptureControls = Pick<Stage3DRendererControls, 'captureFrameAt'>;

export interface Stage3DLiveRecorderOptions {
  controls: Stage3DCaptureControls;
  width: number;
  height: number;
  fps?: number;
  quality?: OfflineRenderSettings['quality'];
  namePrefix?: string;
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

async function saveMp4ToLibrary(
  session: NativeMp4FrameEncoderSession,
  frames: number,
  namePrefix: string,
): Promise<void> {
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
}

/**
 * Live Stage 3D recorder for the desktop app.
 *
 * Unlike the generic MediaRecorder path, this samples the Stage 3D
 * renderer through captureFrameAt() and streams raw RGBA frames into
 * the native FFmpeg MP4 pipe. It avoids captureStream/DOM-compositor
 * black frames and keeps the saved video matched to the rendered stage.
 */
export async function startStage3DLiveRecording(
  options: Stage3DLiveRecorderOptions,
): Promise<RecorderHandle | null> {
  if (!isElectron) {
    throw new Error('Native Stage 3D recording requires the desktop app.');
  }

  const width = Math.max(2, Math.round(options.width));
  const height = Math.max(2, Math.round(options.height));
  const fps = Math.max(1, Math.min(60, Math.round(options.fps ?? 30)));
  const namePrefix = options.namePrefix || 'Stage Recording';
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
      const frame = await options.controls.captureFrameAt(width, height);
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
        throw new Error('Stage recording stopped before any frames were captured.');
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
