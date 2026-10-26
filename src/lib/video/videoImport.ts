/**
 * Bringing a video into Studio without hanging on one it cannot play.
 *
 * Studio plays video with Chromium's own decoders. A file they cannot decode
 * (ProRes, HAP, some HEVC and AVI files, an unsupported container) never
 * reaches `loadeddata`, and the media tray used to wait for that forever:
 * the file never appeared and, in a multi-file drop, nothing after it was
 * added either. Waiting now ends on an error or a timeout, and the user is
 * told what to do (convert it with File › Video Converter).
 */

/** Video file extensions, for files the OS gives no MIME type (common on Windows for .mkv, .mov, .mxf). */
export const VIDEO_EXTENSIONS = new Set([
  'mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi', 'wmv', 'flv', 'mpg', 'mpeg', 'mts', 'm2ts', 'ts',
  '3gp', 'ogv', 'mxf', 'hap', 'm2v', 'vob', 'f4v', 'dv', 'asf', 'y4m',
]);

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/** True for a video file, by MIME type or, when that is missing, by extension. */
export function isVideoFile(file: { name: string; type?: string }): boolean {
  const type = (file.type || '').toLowerCase();
  if (type.startsWith('video/')) return true;
  if (type.startsWith('image/') || type.startsWith('audio/')) return false;
  return VIDEO_EXTENSIONS.has(extensionOf(file.name || ''));
}

export type VideoReadyResult =
  | { ok: true }
  | { ok: false; reason: 'error'; code: number | null }
  | { ok: false; reason: 'timeout' };

/** How long a video may take to show its first frame before we give up on it. */
export const VIDEO_READY_TIMEOUT_MS = 8000;

type VideoLike = Pick<HTMLVideoElement, 'readyState' | 'error' | 'addEventListener' | 'removeEventListener'>;

/**
 * Resolves once the video has a frame to show, it fails, or `timeoutMs`
 * passes, whichever comes first. Never rejects and never waits forever.
 */
export function waitForVideoData(
  video: VideoLike,
  { timeoutMs = VIDEO_READY_TIMEOUT_MS, minReadyState = 2 }: { timeoutMs?: number; minReadyState?: number } = {},
): Promise<VideoReadyResult> {
  if (video.error) return Promise.resolve({ ok: false, reason: 'error', code: video.error.code ?? null });
  if (video.readyState >= minReadyState) return Promise.resolve({ ok: true });
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = (result: VideoReadyResult) => {
      if (timer) clearTimeout(timer);
      timer = null;
      video.removeEventListener('loadeddata', onReady);
      video.removeEventListener('canplay', onReady);
      video.removeEventListener('error', onError);
      resolve(result);
    };
    const onReady = () => {
      if (video.readyState >= minReadyState) finish({ ok: true });
    };
    const onError = () => finish({ ok: false, reason: 'error', code: video.error?.code ?? null });
    video.addEventListener('loadeddata', onReady);
    video.addEventListener('canplay', onReady);
    video.addEventListener('error', onError);
    timer = setTimeout(() => {
      if (video.readyState >= minReadyState) finish({ ok: true });
      else if (video.error) onError();
      else finish({ ok: false, reason: 'timeout' });
    }, Math.max(0, timeoutMs));
  });
}

/** MediaError codes: 2 = network (missing file), 3 = decode, 4 = format not supported. */
const MEDIA_ERR_NETWORK = 2;

/** What to tell the user about a video that would not load. */
export function videoLoadFailureMessage(name: string, result: Exclude<VideoReadyResult, { ok: true }>): string {
  const label = name || 'This video';
  if (result.reason === 'error' && result.code === MEDIA_ERR_NETWORK) {
    return `${label} could not be read. Check that the file is still there, then add it again.`;
  }
  if (result.reason === 'timeout') {
    return `${label} did not load. It may be in a format Studio can't play: convert it to H.264 with File › Video Converter, then add it again.`;
  }
  return `${label} can't play in Studio (its format or codec isn't supported). Convert it to H.264 with File › Video Converter, then add it again.`;
}

/** Stop a video element from holding a decoder or a file it could not play. */
export function releaseVideoElement(video: Pick<HTMLVideoElement, 'pause' | 'removeAttribute' | 'load'>): void {
  try {
    video.pause();
    video.removeAttribute('src');
    video.load();
  } catch { /* already gone */ }
}
