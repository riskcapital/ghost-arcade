/**
 * Media for show clips, from what the user drops on a track: a media-tray
 * card (its drag payload) or a file from the computer.
 *
 * Thumbnails are not part of the clip (undo steps stay small). They live in
 * a runtime cache keyed by library id or source, filled from the drop and
 * from the media, shader and sketch libraries.
 */
import { get, writable } from 'svelte/store';
import type { ISFInputDef, ImageInputRef, JSAnimationSource, ShowClipMedia } from '../../../types';
import { mediaLibrary } from '../../../stores/media';
import { getInputDefault, parseISF } from '../../../isf/parser';
import { mediaFileKind } from '../../../media/mediaFileKind';

export const MEDIA_SOURCE_DRAG_TYPE = 'application/x-ghost-media-source';

/** What the media tray puts on a drag (MediaTray.mediaTrayDragPayload). */
export interface TrayMediaPayload {
  id?: string;
  type?: string;
  name?: string;
  src?: string;
  thumbnail?: string;
  _assetRef?: ShowClipMedia['_assetRef'];
  durationSeconds?: number;
  videoWidth?: number;
  videoHeight?: number;
  shaderCode?: string;
  shaderInputs?: ISFInputDef[];
  shaderValues?: Record<string, number | boolean | number[]>;
  shaderImageInputs?: Record<string, ImageInputRef | null>;
  jsAnimation?: JSAnimationSource;
}

// ── Thumbnails ─────────────────────────────────────────────────────────

const thumbs = writable<Record<string, string>>({});
export const clipThumbnails = { subscribe: thumbs.subscribe };

export function thumbKey(media: Pick<ShowClipMedia, 'libraryId' | 'src' | 'name' | '_assetRef'>): string {
  return media.libraryId || media._assetRef?.originalPath || media.src || media.name;
}

export function rememberThumbnail(media: Pick<ShowClipMedia, 'libraryId' | 'src' | 'name' | '_assetRef'>, url: string | undefined | null): void {
  if (!url) return;
  const key = thumbKey(media);
  if (get(thumbs)[key] === url) return;
  thumbs.update((m) => ({ ...m, [key]: url }));
}

/** A thumbnail for clip media, if one is known. */
export function thumbnailFor(map: Record<string, string>, media: ShowClipMedia): string | null {
  const own = map[thumbKey(media)];
  if (own) return own;
  if (media.libraryId) {
    const item = get(mediaLibrary).find((m) => m.id === media.libraryId);
    if (item?.thumbnail) return item.thumbnail;
  }
  if (media.kind === 'image' && media.src) return media.src;
  return null;
}

// ── Tray payloads ──────────────────────────────────────────────────────

/** Clip media from a media-tray drag payload, or null for cards a track
 *  cannot play (live sources, plugins, presets). */
export function clipMediaFromTrayPayload(raw: unknown): ShowClipMedia | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as TrayMediaPayload;
  const name = String(p.name || 'Clip');
  let media: ShowClipMedia | null = null;
  if (p.jsAnimation) {
    media = { kind: 'sketch', name, libraryId: p.id, src: 'js-animation', jsAnimation: p.jsAnimation };
  } else if (p.type === 'shader' && p.shaderCode) {
    const imageInputs: Record<string, ImageInputRef> = {};
    for (const [key, ref] of Object.entries(p.shaderImageInputs ?? {})) if (ref) imageInputs[key] = ref;
    media = {
      kind: 'shader',
      name,
      libraryId: p.id,
      src: String(p.src ?? ''),
      shaderCode: p.shaderCode,
      shaderInputs: p.shaderInputs ?? [],
      shaderValues: { ...(p.shaderValues ?? {}) },
      shaderImageInputs: imageInputs,
    };
  } else if ((p.type === 'video' || p.type === 'image') && p.src) {
    media = {
      kind: p.type,
      name,
      libraryId: p.id,
      src: p.src,
      _assetRef: p._assetRef,
      sourceDuration: Number(p.durationSeconds) > 0 ? Number(p.durationSeconds) : undefined,
      videoWidth: p.videoWidth,
      videoHeight: p.videoHeight,
    };
  }
  if (media) rememberThumbnail(media, p.thumbnail);
  return media;
}

/** Shader media with every input at the shader's own default (a block whose
 *  media was replaced starts from the new shader's defaults). */
export function withShaderDefaults(media: ShowClipMedia): ShowClipMedia {
  if (media.kind !== 'shader') return media;
  const values: Record<string, number | boolean | number[]> = {};
  for (const input of media.shaderInputs ?? []) {
    if (input.TYPE === 'image') continue;
    values[input.NAME] = getInputDefault(input) as number | boolean | number[];
  }
  return { ...media, shaderValues: values };
}

// ── Files from the computer ────────────────────────────────────────────

/** Files a track can take (video, image, .fs shader). */
export function isTrackMediaFile(file: { name?: string; type?: string }): boolean {
  const kind = mediaFileKind(file);
  return kind === 'video' || kind === 'image' || kind === 'shader';
}

/** First video frame as a small JPEG, best effort. */
function grabVideoThumbnail(video: HTMLVideoElement): Promise<string | null> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (url: string | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(url);
    };
    const draw = () => {
      try {
        const w = video.videoWidth;
        const h = video.videoHeight;
        if (!w || !h) return finish(null);
        const canvas = document.createElement('canvas');
        canvas.height = 72;
        canvas.width = Math.max(1, Math.round((w / h) * 72));
        canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
        finish(canvas.toDataURL('image/jpeg', 0.7));
      } catch {
        finish(null);
      }
    };
    const timer = setTimeout(() => finish(null), 2500);
    if (video.readyState >= 2) draw();
    else video.addEventListener('loadeddata', draw, { once: true });
  });
}

/** Clip media from a dropped or picked file (imports it like a layer drop). */
export async function clipMediaFromFile(file: File): Promise<ShowClipMedia> {
  const { createLayerMediaSource } = await import('../../../media/layerMediaImport');
  const source = await createLayerMediaSource(file);
  const kind = source.type === 'video' || source.type === 'image' || source.type === 'shader' ? source.type : 'image';
  if (kind === 'shader') {
    const code = String(source.shaderCode ?? '');
    const parsed = parseISF(code);
    const inputs = (parsed.metadata.INPUTS ?? []) as ISFInputDef[];
    const values: Record<string, number | boolean | number[]> = {};
    for (const input of inputs) {
      if (input.TYPE !== 'image') values[input.NAME] = getInputDefault(input) as number | boolean | number[];
    }
    return { kind: 'shader', name: file.name.replace(/\.(fs|isf)$/i, ''), src: source.src, shaderCode: code, shaderInputs: inputs, shaderValues: values, shaderImageInputs: {} };
  }
  const media: ShowClipMedia = {
    kind,
    name: file.name,
    src: source.src,
    _assetRef: source._assetRef,
    sourceDuration: Number(source.durationSeconds) > 0 ? Number(source.durationSeconds) : undefined,
    videoWidth: source.videoWidth,
    videoHeight: source.videoHeight,
  };
  const video = source.videoElement as HTMLVideoElement | undefined;
  if (video) {
    // The render core plays the clip; this element was only for the import.
    try { video.pause(); } catch { /* ignore */ }
    void grabVideoThumbnail(video).then((url) => {
      rememberThumbnail(media, url);
      try { video.removeAttribute('src'); video.load(); } catch { /* ignore */ }
    });
  }
  return media;
}
