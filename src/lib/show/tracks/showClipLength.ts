/**
 * The length of a video clip's media when the clip did not come with one
 * (dropped before the library knew it, or from an older file).
 *
 * Without it a clip loops forever whatever its end behaviour says, and its
 * right edge stretches without limit. The render core answers for every
 * file it can play; the file's own metadata (a video element) is the
 * fallback for when the core is not running.
 */
import type { ShowClipMedia, ShowLayerTrack } from '../../types';
import type { NativeVideoProbe } from '../../api/native-renderer';

const ELEMENT_TIMEOUT_MS = 8000;

/** Every video file on the tracks whose clips do not know its length. */
export function unknownLengthVideoUris(
  tracks: readonly ShowLayerTrack[],
  uriOf: (media: ShowClipMedia) => string,
): string[] {
  const uris = new Set<string>();
  for (const track of tracks) {
    for (const clip of track.clips) {
      const media = clip.media;
      if (media.kind !== 'video' || Number(media.sourceDuration) > 0) continue;
      const uri = uriOf(media);
      if (uri) uris.add(uri);
    }
  }
  return [...uris];
}

/** Seconds the file at `uri` lasts, read from a video element's metadata. */
export function elementVideoDuration(uri: string, timeoutMs = ELEMENT_TIMEOUT_MS): Promise<number> {
  if (typeof document === 'undefined') return Promise.resolve(0);
  return new Promise((resolve) => {
    const video = document.createElement('video');
    let done = false;
    const finish = (seconds: number) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      video.removeAttribute('src');
      try { video.load(); } catch { /* ignore */ }
      resolve(Number.isFinite(seconds) && seconds > 0 ? seconds : 0);
    };
    const timer = setTimeout(() => finish(0), timeoutMs);
    video.preload = 'metadata';
    video.muted = true;
    video.addEventListener('loadedmetadata', () => finish(video.duration), { once: true });
    video.addEventListener('error', () => finish(0), { once: true });
    video.src = uri;
  });
}

/**
 * The length of the video at `uri`: seconds; 0 when it cannot be found (the
 * file does not play); null when nobody could answer yet (the core is busy
 * or not running), so the caller asks again later.
 */
export async function probeVideoDuration(
  uri: string,
  probe: ((uri: string) => Promise<NativeVideoProbe | null>) | null,
  elementDuration: (uri: string) => Promise<number> = elementVideoDuration,
): Promise<number | null> {
  // Without the core, the file's metadata is the only answer there is.
  let answered = !probe;
  if (probe) {
    try {
      const result = await probe(uri);
      if (result && result.backend !== 'busy') {
        answered = true;
        if (Number(result.duration_seconds) > 0) return Number(result.duration_seconds);
      }
    } catch { /* fall back to the file's metadata */ }
  }
  const seconds = await elementDuration(uri).catch(() => 0);
  if (seconds > 0) return seconds;
  return answered ? 0 : null;
}
