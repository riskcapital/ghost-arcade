/**
 * Track actions that touch both the project and the show. Kept out of the
 * show store, which never imports the project store (see showTimeline.ts).
 */
import { get } from 'svelte/store';
import { project } from '../../stores/layers';
import { showTimeline } from '../../stores/showTimeline';

/**
 * "+ Track → New layer": a new empty layer with a track for it. With
 * `addToPresets` (the default) the layer also goes into every preset the
 * show uses, so it stays on stage through the whole show. One undo step.
 */
export function addTrackForNewLayer(name: string, opts: { addToPresets?: boolean } = {}): string | null {
  const used = opts.addToPresets === false
    ? []
    : [...new Set(get(showTimeline).presetClips.map((c) => c.compositionId))];
  const layer = project.addLayerForShowTrack(name, { addToCompositionIds: used });
  if (!layer) return null;
  // Records the one step, which holds the new layer and presets too.
  return showTimeline.addLayerTrack(layer);
}

/** A track for a layer that already exists in the editor. */
export function addTrackForLayer(layerId: string): string | null {
  const layer = get(project).layers.find((l) => l.id === layerId);
  return layer ? showTimeline.addLayerTrack(layer) : null;
}
