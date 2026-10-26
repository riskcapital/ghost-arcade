/**
 * The browser <video> element a layer or clip source carries.
 *
 * In the desktop build the render core decodes and plays every video; the
 * element only supplies metadata (duration, size) and transport UI.
 */
import { isDesktopApp } from '$lib/bridge';

/** Loop, mute and inline playback, as every source element is set up. */
export function configureSourceVideoElement(video: HTMLVideoElement): HTMLVideoElement {
  video.loop = true;
  video.muted = true;
  video.playsInline = true;
  return video;
}

/**
 * Start the element. Resolves whether the source should count as playing:
 * in the desktop build the core plays the file whatever the element does --
 * Chromium refusing ProRes or HAP used to mark the layer paused, which froze
 * it on its first frame.
 */
export async function startSourceVideoElement(video: HTMLVideoElement): Promise<boolean> {
  try {
    await video.play();
    return true;
  } catch (err) {
    if (!isDesktopApp) console.warn('Autoplay blocked, user interaction required:', err);
    return isDesktopApp;
  }
}
