/**
 * Group rows in the Timeline (timeline/where/groupRows.ts): "+ Group row"
 * picks the pieces on the canvas and names the group; the row header edits
 * its pieces and switches it Unified / Individual; a Media Library click
 * with a group row selected puts the content on it at the playhead (held
 * for Update while Live edit is on), with no drag.
 */
import { get } from 'svelte/store';
import { project } from '../../../stores/layers';
import { showTimeline } from '../../../stores/showTimeline';
import { slotsFromPieces, wherePick } from '../../../timeline/where/wherePick';
import { holdContentEdit } from '../../../timeline/liveEdit';
import { generateUUID } from '../../../utils/uuid';
import { showToast } from '../../../stores/errorToast';
import type { Layer, ShowLayerTrack } from '../../../types';
import { stageNow } from './whereUi';
import { clipMediaFromTrayPayload } from './clipMedia';

const UNIFIED_LABEL = 'One picture across them (Unified)';
const UNIFIED_HINT = 'On: one picture spread across the pieces, each showing its part of it. Off (Individual): every piece shows the whole picture.';

function pieceSpotsNow() {
  return stageNow().spots.filter((s) => s.kind === 'piece');
}

function nextGroupName(): string {
  const used = new Set((get(showTimeline).whereOrders ?? []).map((o) => o.name));
  let n = 1;
  while (used.has(`Group ${n}`)) n++;
  return `Group ${n}`;
}

/** "+ Group row": choose the pieces on the canvas, name the group; the row is added on one of them. */
export function startGroupRow(): void {
  showToast('Click the pieces for the group on the canvas, name it, then press Done in the bar at the top of the canvas.', 'info');
  wherePick.set({
    ids: [],
    together: true,
    groupName: null,
    title: 'Pieces for a new group row',
    togetherLabel: UNIFIED_LABEL,
    togetherHint: UNIFIED_HINT,
    namePlaceholder: 'Name it (Left half, Top row…)',
    commit: (ids, unified, name) => {
      const slots = slotsFromPieces(ids, pieceSpotsNow(), false);
      if (!slots.length) return;
      const label = name ?? nextGroupName();
      const layers = ((get(project) as { layers?: Layer[] }).layers ?? []);
      const host = layers.find((l) => l.id === slots[0][0]);
      if (!host) return;
      const orderId = generateUUID();
      showTimeline.setWhereOrders([...(get(showTimeline).whereOrders ?? []), { id: orderId, name: label, order: 'left-right', slots }]);
      if (!get(showTimeline).layerTracks.some((t) => t.layerId === host.id && !t.subRow)) showTimeline.addLayerTrack(host);
      showTimeline.addGroupRow(host.id, label, { orderId, unified });
    },
  });
}

/** The group row's pieces again on the canvas (every block using the group follows). */
export function editGroupRowPieces(track: ShowLayerTrack): void {
  const group = track.group;
  if (!group) return;
  const orders = get(showTimeline).whereOrders ?? [];
  const order = orders.find((o) => o.id === group.orderId);
  wherePick.set({
    ids: order?.slots?.flat() ?? [],
    together: group.unified,
    groupName: order?.name ?? track.layerName,
    title: `Pieces of ${order?.name ?? track.layerName}`,
    togetherLabel: UNIFIED_LABEL,
    togetherHint: UNIFIED_HINT,
    commit: (ids, unified, name) => {
      const slots = slotsFromPieces(ids, pieceSpotsNow(), false);
      if (!slots.length) return;
      const now = get(showTimeline).whereOrders ?? [];
      const label = name ?? order?.name ?? track.layerName;
      showTimeline.setWhereOrders(order
        ? now.map((o) => (o.id === group.orderId ? { ...o, name: label, slots } : o))
        : [...now, { id: group.orderId, name: label, order: 'left-right', slots }]);
      if (unified !== group.unified) showTimeline.setGroupRowUnified(track.id, unified);
      if (label !== track.layerName) showTimeline.updateLayerTrack(track.id, { layerName: label });
    },
  });
}

/** The selected row, when it is a group row of the open Timeline. */
export function selectedGroupRow(): ShowLayerTrack | null {
  const s = get(showTimeline);
  if (!s.isOpen || s.doc !== 'timeline' || s.selection?.kind !== 'track') return null;
  const id = s.selection.id;
  return s.layerTracks.find((t) => t.id === id && !!t.group) ?? null;
}

/**
 * A Media Library card clicked with a group row selected: its content goes on
 * the row at the playhead (Live edit parked: held until Update). True when
 * it did.
 */
export function placeOnSelectedGroupRow(payload: unknown): boolean {
  const track = selectedGroupRow();
  if (!track || track.locked) return false;
  const media = clipMediaFromTrayPayload(payload);
  if (!media) return false;
  const t = get(showTimeline).currentTime;
  if (!holdContentEdit(track.id, media, t, null)) showTimeline.cutInLayerMedia(track.id, media, t, null);
  return true;
}
