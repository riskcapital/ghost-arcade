/**
 * "Convert for smooth playback": run the Video Converter's Playback preset on
 * a file the core decodes in software, then point every layer, VJ clip and
 * tray item that used it at the converted copy.
 */
import { get } from 'svelte/store';
import { showToast } from '$lib/stores/errorToast';
import { fileNameOf } from '$lib/vj/clipFiles';
import { relinkVideoFile, type VideoRelinkResult } from '$lib/media/relinkVideoFile';
import { convertVideoForPlayback, isVideoConversionCancelled, type VideoConversionResult } from './videoConverter';
import { checkVideoDecode, setVideoConversionProgress, videoDecodeHealth } from './videoDecodeHealth';

export function describeRelink(result: VideoRelinkResult): string {
  const parts: string[] = [];
  if (result.layers) parts.push(`${result.layers} layer${result.layers === 1 ? '' : 's'}`);
  if (result.clips) parts.push(`${result.clips} clip${result.clips === 1 ? '' : 's'}`);
  if (result.items) parts.push(`${result.items} media item${result.items === 1 ? '' : 's'}`);
  if (!parts.length) return '';
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

export interface PlaybackConversionDeps {
  convert?: (path: string, onProgress: (p: { progress: number; message: string }) => void) => Promise<VideoConversionResult>;
  relink?: typeof relinkVideoFile;
  toast?: typeof showToast;
  recheck?: typeof checkVideoDecode;
}

/** Resolves the converted file's path, or null when it did not happen. */
export async function convertForSmoothPlayback(path: string, deps: PlaybackConversionDeps = {}): Promise<string | null> {
  const convert = deps.convert ?? convertVideoForPlayback;
  const relink = deps.relink ?? relinkVideoFile;
  const toast = deps.toast ?? showToast;
  const recheck = deps.recheck ?? checkVideoDecode;
  if (get(videoDecodeHealth)[path]?.converting) return null;
  const name = fileNameOf(path);
  setVideoConversionProgress(path, { progress: 0, message: 'Preparing…' });
  toast(`Converting ${name} for smooth playback. You can keep working.`, 'info');
  try {
    const result = await convert(path, (p) => setVideoConversionProgress(path, {
      progress: Number.isFinite(p.progress) ? p.progress : 0,
      message: p.message,
    }));
    const moved = relink(path, result.outputPath);
    void recheck(result.outputPath, { force: true });
    const users = describeRelink(moved);
    const hdr = result.hdrSkipped ? ' It is HDR and could not be converted to SDR here, so colours may look washed out.' : '';
    toast(users
      ? `Converted ${name}. ${users} now play ${fileNameOf(result.outputPath)}. Save the project to keep this.${hdr}`
      : `Converted ${name} to ${fileNameOf(result.outputPath)}.${hdr}`,
    hdr ? 'warning' : 'info');
    return result.outputPath;
  } catch (error) {
    if (isVideoConversionCancelled(error)) {
      toast(`Conversion of ${name} cancelled.`, 'info');
    } else {
      const message = error instanceof Error ? error.message.split('\n')[0] : String(error);
      toast(`Could not convert ${name}: ${message}`, 'error');
    }
    return null;
  } finally {
    setVideoConversionProgress(path, null);
  }
}
