import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get, writable } from 'svelte/store';
import type { Layer, ShowClipMedia } from '../../../types';

// The project store pulls the whole editor in: the layers, the selected
// layer and selectLayer are all a row click touches.
const projectState = writable<{ id: string; layers: Array<{ id: string }>; selectedLayerId: string | null }>({ id: 'p', layers: [], selectedLayerId: null });
vi.mock('../../../stores/layers', () => ({
  project: {
    subscribe: projectState.subscribe,
    selectLayer: (id: string | null) => projectState.update((p) => ({ ...p, selectedLayerId: id })),
  },
  layers: writable([]),
  selectedLayerId: writable(null),
}));

const { showTimeline, setShowCompositionLoader, setShowTrackFrameSink } = await import('../../../stores/showTimeline');
const { rowPanelLayer, selectRow, timelineRowTray } = await import('./rowSelect');
const { placeOnSelectedGroupRow } = await import('./groupRowUi');

const media = (name: string): ShowClipMedia => ({ kind: 'image', name, src: `/img/${name}` });
const layer = (id: string) => ({ id, name: id, type: 'media', opacity: 1, source: null }) as unknown as Layer;

describe('a row picked on the Timeline brings the Media Library', () => {
  it('selects a piece row\'s own piece, and no mapping layer for a group row or a piece off stage', () => {
    const onStage = (id: string) => id === 'A';
    expect(rowPanelLayer({ layerId: 'A' }, onStage)).toBe('A');
    expect(rowPanelLayer({ layerId: 'B' }, onStage)).toBeNull();
    expect(rowPanelLayer({ layerId: 'A', group: { orderId: 'o', unified: true } }, onStage)).toBeNull();
  });

  describe('in the show', () => {
    let pieceRow = '';
    let groupRow = '';
    beforeEach(() => {
      showTimeline._resetForTest();
      setShowCompositionLoader(() => {});
      setShowTrackFrameSink(() => {});
      projectState.set({ id: 'p', layers: [{ id: 'A' }, { id: 'T' }], selectedLayerId: 'T' });
      showTimeline.openDoc('timeline');
      pieceRow = showTimeline.addLayerTrack(layer('A'))!;
      showTimeline.setWhereOrders([{ id: 'left', name: 'Left', order: 'left-right', slots: [['A'], ['B']] }]);
      groupRow = showTimeline.addGroupRow('A', 'Left', { orderId: 'left', unified: true })!;
      showTimeline.select(null);
    });
    afterEach(() => {
      setShowTrackFrameSink(null);
      setShowCompositionLoader(null);
      showTimeline._resetForTest();
    });

    const row = (id: string) => get(showTimeline).layerTracks.find((t) => t.id === id)!;

    it('a group row: the row is selected, the mapping layer let go, and the sidebar shows the tray', () => {
      expect(get(timelineRowTray)).toBe(false);
      selectRow(row(groupRow));
      expect(get(showTimeline).selection).toEqual({ kind: 'track', id: groupRow });
      expect(get(projectState).selectedLayerId).toBeNull();
      expect(get(timelineRowTray)).toBe(true);
      // A tray card clicked now goes onto the group row at the playhead.
      expect(placeOnSelectedGroupRow({ type: 'image', src: '/img/x.png', name: 'x' })).toBe(true);
      expect(row(groupRow).clips).toHaveLength(1);
      // The new block is selected: the tray stays for the next one.
      showTimeline.selectLayerClips([row(groupRow).clips[0].id]);
      expect(get(timelineRowTray)).toBe(true);
    });

    it('a piece row: its piece is selected, as clicking one of its blocks does', () => {
      selectRow(row(pieceRow));
      expect(get(showTimeline).selection).toEqual({ kind: 'track', id: pieceRow });
      expect(get(projectState).selectedLayerId).toBe('A');
    });

    it('no tray when the Timeline is closed or nothing on it is a row', () => {
      selectRow(row(groupRow));
      showTimeline.addLayerClip(pieceRow, media('a'), 0, { duration: 2 });
      showTimeline.select(null);
      expect(get(timelineRowTray)).toBe(false);
      selectRow(row(groupRow));
      showTimeline.setOpen(false);
      expect(get(timelineRowTray)).toBe(false);
    });
  });
});
