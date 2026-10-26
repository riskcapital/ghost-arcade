/**
 * Point everything that plays one video file at another file: mapping
 * layers, VJ clips (through the 2.1.10 relink, which re-arms their decoders)
 * and media tray items. Used after "Convert for smooth playback".
 */
import { get } from 'svelte/store';
import { project } from '$lib/stores/layers';
import { vjClipLauncher } from '$lib/stores/vjClipLauncher';
import { mediaLibrary } from '$lib/stores/media';
import { noteMediaRelinked } from '$lib/stores/missingMedia';
import { pathToFileUrl, type AssetRef } from '$lib/storage/assetRegistry';
import { clipFilePath, fileNameOf } from '$lib/vj/clipFiles';
import { generateUUID, type MediaSource } from '$lib/types';
import { configureSourceVideoElement } from './sourceVideoElement';
import { restoreVideoSourceElement } from './videoSourceRestore';

export interface VideoRelinkResult {
  layers: number;
  clips: number;
  items: number;
}

function localAssetRef(previous: AssetRef | undefined, to: string): AssetRef {
  return { ...(previous ?? {}), kind: 'local-file', originalPath: to, projectPath: undefined } as AssetRef;
}

function retireElement(video: HTMLVideoElement | undefined | null) {
  if (!video) return;
  try { video.pause(); } catch { /* ignore */ }
  try { video.removeAttribute('src'); video.load(); } catch { /* ignore */ }
}

export function relinkVideoFile(from: string, to: string): VideoRelinkResult {
  if (!from || !to || from === to) return { layers: 0, clips: 0, items: 0 };
  const src = pathToFileUrl(to);
  const name = fileNameOf(to);

  let layers = 0;
  for (const layer of get(project).layers) {
    const source = layer.source;
    if (!source || source.type !== 'video' || clipFilePath(source) !== from) continue;
    const { videoElement: previous, videoWidth: _w, videoHeight: _h, ...rest } = source;
    const next: MediaSource = {
      ...rest,
      id: generateUUID(),
      src,
      name,
      _assetRef: localAssetRef(source._assetRef, to),
      // A new seek generation: the core opens the new file at the same spot.
      _nativePlaybackSeekSeq: Math.max(0, Math.floor(Number(source._nativePlaybackSeekSeq) || 0)) + 1,
      _nativePlaybackUpdatedAtMs: performance.now(),
    };
    restoreVideoSourceElement(next);
    next.isPlaying = source.isPlaying;
    project.setLayerSource(layer.id, next);
    if (previous && previous !== next.videoElement) retireElement(previous);
    layers += 1;
  }

  const clips = vjClipLauncher.relinkClipFiles({ [from]: to });

  let items = 0;
  for (const item of get(mediaLibrary)) {
    if (item.type !== 'video' || clipFilePath(item) !== from) continue;
    const video = document.createElement('video');
    configureSourceVideoElement(video);
    video.src = src;
    retireElement(item.videoElement);
    mediaLibrary.updateItem(item.id, {
      src, name, videoElement: video, broken: false, brokenReason: undefined,
      videoWidth: undefined, videoHeight: undefined,
      _assetRef: localAssetRef(item._assetRef, to),
    });
    items += 1;
  }

  if (layers || clips || items) noteMediaRelinked();
  return { layers, clips, items };
}
