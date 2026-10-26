import type { MediaSource } from '../types';
import { syncTrimmedVideoPlayback } from '../utils/videoTrimPlayback';
import { configureSourceVideoElement, playSourceVideoElement, sourceVideoIsMetadataOnly } from './sourceVideoElement';

type VideoFactory = () => HTMLVideoElement;

export function videoSourceNeedsCors(src: string): boolean {
  return /^(https?:|ghost-asset:)/i.test(src);
}

/**
 * Rebuild the runtime-only video element stripped from saved projects.
 *
 * ghost-asset:// is a cross-origin custom protocol. Its response includes
 * CORS headers, but Chromium will only let WebGL sample it when the video
 * element opts into anonymous CORS before assigning src.
 */
export function restoreVideoSourceElement(
  source: MediaSource,
  createVideo: VideoFactory = () => document.createElement('video'),
): HTMLVideoElement | null {
  if (source.type !== 'video' || !source.src) return null;
  if (source.videoElement) return source.videoElement;

  const video = createVideo();
  if (videoSourceNeedsCors(source.src)) video.crossOrigin = 'anonymous';
  configureSourceVideoElement(video);
  video.loop = false;
  video.playbackRate = source.playbackRate ?? 1;

  source.videoElement = video;
  source.isPlaying = true;

  // Beside the render core the element only reads metadata: playing it
  // decoded every restored layer a second time.
  const playWhenReady = () => {
    if (source.videoElement !== video || source.isPlaying === false) return;
    // A later canplay event retries transient Chromium autoplay/load races.
    playSourceVideoElement(video);
  };
  const reportError = () => {
    // Chromium refusing ProRes or HAP is no failure when the core plays it.
    if (sourceVideoIsMetadataOnly()) return;
    console.warn('[VideoRestore] Failed to restore saved video source:', source.name, source.src);
  };

  // Install readiness handlers before src/load. Fast local files can reach
  // loadeddata synchronously enough to beat handlers installed afterwards.
  video.addEventListener('loadeddata', playWhenReady, { once: true });
  video.addEventListener('canplay', playWhenReady, { once: true });
  video.addEventListener('error', reportError, { once: true });

  video.src = source.src;
  syncTrimmedVideoPlayback(video, source);

  // A fresh restored element has no pending play operation, so explicitly
  // starting Chromium's resource selection is safe for custom protocols.
  try {
    video.load();
  } catch {
    reportError();
  }

  if (video.readyState >= 2) queueMicrotask(playWhenReady);
  return video;
}
