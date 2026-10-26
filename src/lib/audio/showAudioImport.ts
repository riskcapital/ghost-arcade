/**
 * Getting a song onto the show timeline: which files count as audio, which
 * ones Chromium cannot play and need converting first, and the fallbacks
 * when a file will not decode.
 */
import { createAssetRefFromFile, pathToFileUrl, type AssetRef } from '../storage/assetRegistry';

/** File types the show accepts as audio. */
const AUDIO_EXTENSIONS = new Set([
  'mp3', 'wav', 'wave', 'ogg', 'oga', 'opus', 'm4a', 'aac', 'mp4', 'flac', 'webm', 'weba',
  'aif', 'aiff', 'aifc', 'wma', 'caf', 'ac3', 'ape', 'amr', 'mka', 'alac',
]);

/** Types Chromium's decoder does not play: converted with the bundled ffmpeg first. */
const CONVERT_EXTENSIONS = new Set(['aif', 'aiff', 'aifc', 'wma', 'caf', 'ac3', 'ape', 'amr', 'mka', 'alac']);
const CONVERT_MIME = /^audio\/(x-)?(aiff|aifc|ms-wma|x-caf|ac3|ape|amr)$/i;

/** Formats to suggest when a file cannot be played. */
export const PLAYABLE_AUDIO_HINT = 'WAV, MP3, M4A, FLAC or OGG';

function extensionOf(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name || '');
  return m ? m[1].toLowerCase() : '';
}

export function isShowAudioFile(name: string, mime = ''): boolean {
  if (mime && mime.startsWith('audio/')) return true;
  return AUDIO_EXTENSIONS.has(extensionOf(name));
}

export function needsAudioConversion(name: string, mime = ''): boolean {
  return CONVERT_EXTENSIONS.has(extensionOf(name)) || CONVERT_MIME.test(mime || '');
}

export function unplayableAudioMessage(name: string): string {
  return `“${name}” can't be played. Use ${PLAYABLE_AUDIO_HINT}.`;
}

export interface PreparedShowAudio {
  name: string;
  url: string;
  assetRef?: AssetRef;
  /** True when the file was converted to play. */
  converted: boolean;
}

export type PrepareShowAudioResult = PreparedShowAudio | { error: string };

function desktopApi(): { invoke?: (command: string, args?: unknown) => Promise<any>; getPathForFile?: (file: File) => string } | null {
  if (typeof window === 'undefined') return null;
  return (window as any).electronAPI ?? null;
}

/**
 * Converts a file on disk to FLAC with the bundled ffmpeg (desktop only).
 * Returns the playable copy, or an error message.
 */
export async function convertShowAudioPath(sourcePath: string, name: string): Promise<PrepareShowAudioResult> {
  const api = desktopApi();
  if (!api?.invoke || !sourcePath) return { error: unplayableAudioMessage(name) };
  try {
    const result = await api.invoke('show_audio_prepare', { path: sourcePath });
    if (!result?.success || typeof result.path !== 'string') {
      return { error: `${unplayableAudioMessage(name)}${result?.error ? ` (${result.error})` : ''}` };
    }
    const converted: string = result.path;
    return {
      name,
      url: pathToFileUrl(converted),
      assetRef: {
        kind: 'local-file',
        originalPath: converted,
        name: converted.split(/[\\/]/).pop() || name,
        mime: 'audio/flac',
        lastModified: Date.now(),
      },
      converted: true,
    };
  } catch (err) {
    return { error: `${unplayableAudioMessage(name)} (${err instanceof Error ? err.message : String(err)})` };
  }
}

/** A dropped or picked audio file, ready for the show: converted first when Chromium cannot play it. */
export async function prepareShowAudioFile(file: File): Promise<PrepareShowAudioResult> {
  if (!file) return { error: 'No file.' };
  if (needsAudioConversion(file.name, file.type)) {
    const sourcePath = desktopApi()?.getPathForFile?.(file) || '';
    return convertShowAudioPath(sourcePath, file.name);
  }
  const { assetRef, runtimeUrl } = createAssetRefFromFile(file);
  return { name: file.name, url: runtimeUrl, assetRef, converted: false };
}

/**
 * Length of a file as the media element sees it, or null. The fallback when
 * the full decode fails but the element can still play the file.
 */
export function probeMediaDuration(url: string, timeoutMs = 8000): Promise<number | null> {
  if (typeof document === 'undefined' || !url) return Promise.resolve(null);
  return new Promise((resolve) => {
    const el = document.createElement('audio');
    let done = false;
    const finish = (value: number | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      el.removeAttribute('src');
      try { el.load(); } catch { /* best effort */ }
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    el.preload = 'metadata';
    el.muted = true;
    el.onloadedmetadata = () => finish(Number.isFinite(el.duration) && el.duration > 0 ? el.duration : null);
    el.onerror = () => finish(null);
    el.src = url;
  });
}
