/**
 * What kind of media a dropped or picked file is.
 *
 * Detection used the browser's MIME type alone. Chromium leaves it empty (or
 * reports something odd) for many show formats -- .mxf, .mkv, HAP and ProRes
 * .mov on some systems -- so a perfectly playable clip was added as an image.
 * The file extension now decides when the MIME type does not.
 */
export const VIDEO_FILE_EXTENSIONS = [
  'mp4', 'm4v', 'mov', 'qt', 'webm', 'mkv', 'avi', 'mxf', 'mts', 'm2ts', 'ts',
  'mpg', 'mpeg', 'm2v', 'wmv', 'flv', 'f4v', 'ogv', '3gp', 'dv', 'vob', 'hap',
] as const;

export const AUDIO_FILE_EXTENSIONS = [
  'mp3', 'wav', 'wave', 'aif', 'aiff', 'flac', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'wma', 'alac', 'caf',
] as const;

export const IMAGE_FILE_EXTENSIONS = [
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'avif', 'heic', 'heif', 'svg',
] as const;

/** The `accept` list for a media file picker that should offer every video. */
export const VIDEO_FILE_ACCEPT = ['video/*', ...VIDEO_FILE_EXTENSIONS.map((ext) => `.${ext}`)].join(',');

export type MediaFileKind = 'video' | 'audio' | 'image' | 'shader' | 'html' | 'unknown';

type FileLike = { name?: string; type?: string };

export function fileExtension(name: string | undefined): string {
  const clean = String(name ?? '').split(/[?#]/)[0];
  const dot = clean.lastIndexOf('.');
  return dot >= 0 ? clean.slice(dot + 1).toLowerCase() : '';
}

const has = (list: readonly string[], ext: string) => list.includes(ext);

export function mediaFileKind(file: FileLike): MediaFileKind {
  const ext = fileExtension(file.name);
  const mime = String(file.type ?? '').toLowerCase();
  if (ext === 'fs' || ext === 'isf') return 'shader';
  if (ext === 'html' || ext === 'htm') return 'html';
  // The extension is the stronger signal for show formats; an .mp4 holding
  // only sound is still treated as video, as the browser would.
  if (has(VIDEO_FILE_EXTENSIONS, ext)) return 'video';
  if (has(AUDIO_FILE_EXTENSIONS, ext)) return 'audio';
  if (has(IMAGE_FILE_EXTENSIONS, ext)) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('image/')) return 'image';
  return 'unknown';
}

export function isVideoFile(file: FileLike): boolean {
  return mediaFileKind(file) === 'video';
}

export function isAudioFile(file: FileLike): boolean {
  return mediaFileKind(file) === 'audio';
}

/** Shown when a song is dropped where only pictures belong. */
export const AUDIO_FILE_HINT = 'Audio files are not layers. Add songs in the Show timeline.';
