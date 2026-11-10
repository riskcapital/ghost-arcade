/**
 * Track header edits that reach past the show: renaming a track renames its
 * layer while the layer is on stage (the track's name follows its layer), or
 * just the track while it plays its own off-stage copy.
 */
import { get } from 'svelte/store';
import type { Layer, ShowLayerTrack } from '../../../types';
import { showTimeline } from '../../../stores/showTimeline';
import { project } from '../../../stores/layers';

export function renameShowTrack(track: Pick<ShowLayerTrack, 'id' | 'layerId' | 'layerName'>, name: string, live: Layer | null): void {
  const trimmed = name.trim();
  if (!trimmed || trimmed === track.layerName) return;
  if (live) {
    project.renameLayer(track.layerId, trimmed);
    const renamed = get(project).layers.find((l) => l.id === track.layerId);
    if (renamed) showTimeline.refreshTrackTemplate(track.id, renamed);
    return;
  }
  showTimeline.updateLayerTrack(track.id, { layerName: trimmed });
}
