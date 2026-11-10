/**
 * Media dropped on the show: a media-tray card or files from the computer,
 * onto a piece's row (at the drop time): a block on that piece. Rows are the
 * mapping layers, so media dropped anywhere else is turned away with a hint.
 * Audio files are left to the audio lanes.
 */
import { get } from 'svelte/store';
import type { ShowClipMedia } from '../../../types';
import { showTimeline } from '../../../stores/showTimeline';
import { showToast } from '../../../stores/errorToast';
import { clipEnd } from '../../../show/tracks/showTrackEval';
import { clipMediaFromFile, clipMediaFromTrayPayload, isTrackMediaFile, MEDIA_SOURCE_DRAG_TYPE } from './clipMedia';
import { focusedTrackId } from './trackLayout';

/** The drag may carry something a track can take (types only: dragover). */
export function mayCarryTrackMedia(dt: DataTransfer): boolean {
  const types = Array.from(dt.types ?? []);
  return types.includes(MEDIA_SOURCE_DRAG_TYPE) || types.includes('Files');
}

/** The drop carries a tray card or files a track can take. */
export function carriesTrackMedia(dt: DataTransfer): boolean {
  if (dt.getData(MEDIA_SOURCE_DRAG_TYPE)) return true;
  return Array.from(dt.files ?? []).some((f) => isTrackMediaFile(f));
}

function stem(name: string): string {
  return name.replace(/\.[a-z0-9]{1,5}$/i, '') || name;
}

/** Put media on a row at `at`; after the last block when there is no room
 *  there. */
export function placeClipMedia(trackId: string | null, media: ShowClipMedia, at: number): { trackId: string; clipId: string | null } | null {
  const id = trackId;
  if (!id) {
    const rows = get(showTimeline).layerTracks.length;
    showToast(rows
      ? `Drop ${stem(media.name)} on a piece's row: each row is a mapping layer.`
      : 'Add a layer in Mapping first: each mapping layer gets a row here.', 'info');
    return null;
  }
  let clipId = showTimeline.addLayerClip(id, media, at);
  if (!clipId) {
    const track = get(showTimeline).layerTracks.find((t) => t.id === id);
    const end = track?.clips.length ? Math.max(...track.clips.map(clipEnd)) : 0;
    clipId = showTimeline.addLayerClip(id, media, end);
    if (clipId) showToast('No room there: the block went after the last one on the row.', 'info');
  }
  focusedTrackId.set(id);
  return { trackId: id, clipId };
}

/**
 * Handle a drop of tray cards or files. Several files go one after another
 * on the same track. Resolves when every file is placed.
 */
export async function dropTrackMedia(dt: DataTransfer, trackId: string | null, at: number): Promise<void> {
  const raw = dt.getData(MEDIA_SOURCE_DRAG_TYPE);
  if (raw) {
    let media: ShowClipMedia | null;
    try { media = clipMediaFromTrayPayload(JSON.parse(raw)); } catch { media = null; }
    if (!media) {
      showToast('That card cannot go on a track. Use a video, an image, a shader or a sketch.', 'warning');
      return;
    }
    placeClipMedia(trackId, media, at);
    return;
  }
  // Read the list now: the DataTransfer empties once the drop event ends.
  const files = Array.from(dt.files ?? []).filter((f) => isTrackMediaFile(f));
  let target = trackId;
  let cursor = at;
  for (const file of files) {
    try {
      const media = await clipMediaFromFile(file);
      const placed = placeClipMedia(target, media, cursor);
      if (!placed) continue;
      target = placed.trackId;
      const clip = placed.clipId ? showTimeline.findLayerClip(placed.clipId)?.clip : null;
      if (clip) cursor = clipEnd(clip);
    } catch (err) {
      showToast(`${file.name}: ${err instanceof Error ? err.message : String(err)}`, 'warning');
    }
  }
}
