/**
 * A file dropped on (or picked for) a mapping layer, as its source.
 *
 * This used to wait for Chromium to decode the video and gave up when it
 * could not -- ProRes, HAP, DNx, 10-bit or 4:2:2 H.264 and HEVC without a
 * hardware decoder all failed there although the render core plays them, and
 * the failure only reached the console. It now imports the way the media tray
 * does (Chromium, then the bundled ffmpeg), and an audio file is turned away
 * with a hint instead of becoming a broken "image" layer.
 */
import { isDesktopApp } from '$lib/bridge';
import { createDurableAssetRefFromFile } from '$lib/storage/assetRegistry';
import { generateUUID, type MediaSource } from '$lib/types';
import { prepareVideoImport } from '$lib/video/videoImport';
import { AUDIO_FILE_HINT, mediaFileKind } from './mediaFileKind';
import { configureSourceVideoElement, startSourceVideoElement } from './sourceVideoElement';

/** The file cannot be a layer source; `message` says why, for a toast. */
export class LayerMediaRejected extends Error {
  constructor(message: string, readonly severity: 'warning' | 'error' = 'warning') {
    super(message);
  }
}

export async function createLayerMediaSource(file: File): Promise<MediaSource> {
  const kind = mediaFileKind(file);
  if (kind === 'audio') throw new LayerMediaRejected(AUDIO_FILE_HINT);
  if (kind !== 'video' && kind !== 'image' && kind !== 'shader') {
    throw new LayerMediaRejected("this file type can't be a layer. Use a video, an image or an .fs shader.");
  }
  // Both runtime URL and durable AssetRef, so the layer's source survives
  // save+reload (the blob URL alone won't).
  const { assetRef, runtimeUrl: url } = await createDurableAssetRefFromFile(file);
  const source: MediaSource = {
    id: generateUUID(),
    type: kind,
    src: url,
    name: file.name,
    _assetRef: assetRef,
  };

  if (kind === 'video') {
    const video = document.createElement('video');
    // crossOrigin BEFORE src -- order matters on Chromium 130.
    video.crossOrigin = 'anonymous';
    configureSourceVideoElement(video);
    // The first frame is needed only for Chromium's quick look at the file.
    video.preload = 'auto';
    video.src = url;
    // Chromium first, then the bundled ffmpeg for what Chromium cannot read.
    const imported = await prepareVideoImport(video, assetRef);
    if (!isDesktopApp && video.error) {
      // The browser build plays through this element; nothing else can.
      throw new LayerMediaRejected("this browser can't play this video format.", 'error');
    }
    source.videoElement = video;
    source.isPlaying = true;
    source.durationSeconds = imported.durationSeconds
      ?? (Number.isFinite(video.duration) && video.duration > 0 ? video.duration : undefined);
    if (imported.videoWidth && imported.videoHeight) {
      source.videoWidth = imported.videoWidth;
      source.videoHeight = imported.videoHeight;
    }
    source._nativePlaybackTimeSeconds = 0;
    source._nativePlaybackUpdatedAtMs = performance.now();
    source._nativePlaybackSeekSeq = 1;
    if (!(await startSourceVideoElement(video))) source.isPlaying = false;
  } else if (kind === 'shader') {
    source.shaderCode = await file.text();
  }
  return source;
}
