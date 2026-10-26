/**
 * The browser <video> element a layer or clip source carries.
 *
 * In the desktop build the render core decodes and plays every video; the
 * element only supplies metadata (duration, size) and transport UI. It used to
 * loop and autoplay anyway, so every resident VJ clip and every mapping layer
 * was decoded twice: once by the core, once by Chromium for nothing. Now such
 * an element loads metadata only and is never started for its picture.
 *
 * Elements that genuinely play keep doing so: the browser build (the element
 * is the picture there), clips with sound (the clip audio bus starts its own
 * element), live camera and capture streams, thumbnails, and splat textures.
 */
import { isDesktopApp } from '$lib/bridge';
import { NATIVE_ENGINE_ONLY } from '$lib/stores/settings';

/** True where the render core plays video and the element is metadata only. */
export function sourceVideoIsMetadataOnly(): boolean {
  return isDesktopApp && NATIVE_ENGINE_ONLY;
}

/** How much a source element should load: metadata only beside the core. */
export function sourceVideoPreload(): 'metadata' | 'auto' {
  return sourceVideoIsMetadataOnly() ? 'metadata' : 'auto';
}

/** Loop, mute, inline playback and the preload policy above. */
export function configureSourceVideoElement(video: HTMLVideoElement): HTMLVideoElement {
  video.loop = true;
  video.muted = true;
  video.playsInline = true;
  video.preload = sourceVideoPreload();
  return video;
}

/**
 * Start the element for its picture. Resolves whether the source should count
 * as playing: beside the render core it always does (the core plays the
 * file), and Chromium refusing ProRes or HAP used to mark the layer paused,
 * which froze it on its first frame.
 */
export async function startSourceVideoElement(video: HTMLVideoElement): Promise<boolean> {
  if (sourceVideoIsMetadataOnly()) return true;
  try {
    await video.play();
    return true;
  } catch (err) {
    console.warn('Autoplay blocked, user interaction required:', err);
    return false;
  }
}

/** Fire-and-forget start, for the places that never waited on play(). */
export function playSourceVideoElement(video: HTMLVideoElement | null | undefined): void {
  if (!video || sourceVideoIsMetadataOnly()) return;
  void video.play().catch(() => { /* autoplay or rapid retrigger; a later event retries */ });
}
