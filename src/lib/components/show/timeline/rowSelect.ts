/**
 * A click on a Timeline row (its header, or an empty spot of its lane)
 * selects the row and puts the Media Library in the right sidebar, ready to
 * drag media onto the row (or click a card onto a group row).
 *
 * The sidebar shows the panel of the selected mapping layer, and the Media
 * Library only for media and group layers; with no layer selected it was
 * empty, so a group row (which is no mapping layer) never brought the tray.
 * Now a piece row selects its piece (as clicking one of its blocks does) and
 * a group row lets go of the mapping layer, and the sidebar falls back to
 * the Media Library while a Timeline row is selected (`timelineRowTray`).
 */
import { derived, get, type Readable } from 'svelte/store';
import type { ShowLayerTrack } from '../../../types';
import { showTimeline } from '../../../stores/showTimeline';
import { project } from '../../../stores/layers';
import { stopEditingBlock } from '../../../show/tracks/showBlockEdit';
import { showSlice } from './timelineSlices';

/** The mapping layer the sidebar should show for a row: a piece row's own
 *  piece when it is on stage; none for a group row or a piece the current
 *  look does not have. */
export function rowPanelLayer(track: Pick<ShowLayerTrack, 'layerId' | 'group'>, onStage: (layerId: string) => boolean): string | null {
  if (track.group) return null;
  return onStage(track.layerId) ? track.layerId : null;
}

/** Select a row from the Timeline: the row, and the panel to drop media from. */
export function selectRow(track: Pick<ShowLayerTrack, 'id' | 'layerId' | 'group'>): void {
  showTimeline.select({ kind: 'track', id: track.id });
  stopEditingBlock();
  const layers = get(project).layers;
  const want = rowPanelLayer(track, (id) => layers.some((l) => l.id === id));
  if (get(project).selectedLayerId !== want) project.selectLayer(want);
}

/**
 * The sidebar shows the Media Library for the Timeline: a row or blocks of
 * the open Timeline are selected (a block just dropped from the tray is,
 * so the tray stays for the next one).
 */
export const timelineRowTray: Readable<boolean> = derived(
  [showSlice('isOpen'), showSlice('doc'), showSlice('selection'), showSlice('selectedClipIds')],
  ([open, doc, sel, clips]) => !!open && doc === 'timeline' && (sel?.kind === 'track' || sel?.kind === 'layerClip' || clips.length > 0),
);
