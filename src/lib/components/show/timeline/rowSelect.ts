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
import { derived, get, writable, type Readable } from 'svelte/store';
import type { ShowLayerTrack } from '../../../types';
import { showTimeline } from '../../../stores/showTimeline';
import { project } from '../../../stores/layers';
import { stopEditingBlock } from '../../../show/tracks/showBlockEdit';
import { showSlice } from './timelineSlices';
import { mediaTabShown, sideColumn } from './sideColumn';

/**
 * The row a Media Library click puts content on: the row just clicked on the
 * Timeline (group or piece). The Media tab says so in a banner; its × lets
 * go (cards then only drag). It only counts while that row is selected.
 */
export const mediaTarget = writable<string | null>(null);

/** The target row when it is still the selected row of the open Timeline. */
export function activeMediaTarget(): ShowLayerTrack | null {
  const id = get(mediaTarget);
  const s = get(showTimeline);
  if (!id || !s.isOpen || s.doc !== 'timeline' || s.selection?.kind !== 'track' || s.selection.id !== id) return null;
  return s.layerTracks.find((t) => t.id === id) ?? null;
}

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
  mediaTarget.set(track.id);
  // The Media tab comes next to the rows (the side column) with the row as its target.
  sideColumn.send({ kind: 'rowTarget' });
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
  [showSlice('isOpen'), showSlice('doc'), showSlice('selection'), showSlice('selectedClipIds'), mediaTabShown],
  // Not while the Timeline's own Media tab shows the library beside the rows.
  ([open, doc, sel, clips, mediaTab]) => !!open && doc === 'timeline' && !mediaTab && (sel?.kind === 'track' || sel?.kind === 'layerClip' || clips.length > 0),
);
