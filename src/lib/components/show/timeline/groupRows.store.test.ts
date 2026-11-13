import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import type { Layer, ShowClipMedia } from '../../../types';
import { showTimeline, setShowCompositionLoader, setShowTrackFrameSink, normalizeLayerTrack } from '../../../stores/showTimeline';

const media = (name: string): ShowClipMedia => ({ kind: 'image', name, src: `/img/${name}` });
const layer = (id: string) => ({ id, name: id, type: 'media', opacity: 1, source: null }) as unknown as Layer;
const row = (id: string) => get(showTimeline).layerTracks.find((t) => t.id === id)!;

describe('group rows in the show', () => {
  let rowId = '';
  beforeEach(() => {
    showTimeline._resetForTest();
    setShowCompositionLoader(() => {});
    setShowTrackFrameSink(() => {});
    showTimeline.addLayerTrack(layer('A'));
    showTimeline.setWhereOrders([{ id: 'left', name: 'Left', order: 'left-right', slots: [['A'], ['B']] }]);
    rowId = showTimeline.addGroupRow('A', 'Left', { orderId: 'left', unified: true })!;
  });
  afterEach(() => {
    setShowTrackFrameSink(null);
    setShowCompositionLoader(null);
    showTimeline._resetForTest();
  });

  it('adds a group row on the host piece, selected', () => {
    expect(row(rowId)).toMatchObject({ layerId: 'A', layerName: 'Left', subRow: true, group: { orderId: 'left', unified: true } });
    expect(get(showTimeline).selection).toEqual({ kind: 'track', id: rowId });
  });

  it('gives every block that lands on it the group, however it got there', () => {
    showTimeline.addLayerClip(rowId, media('a'), 0, { duration: 4 });
    showTimeline.cutInLayerMedia(rowId, media('b'), 6);
    for (const c of row(rowId).clips) expect(c.where).toMatchObject({ namedOrder: 'left', spread: 1, dark: true, span: true });
  });

  it('switches the row and its blocks between Unified and Individual, one undo step', () => {
    showTimeline.addLayerClip(rowId, media('a'), 0, { duration: 4 });
    expect(showTimeline.setGroupRowUnified(rowId, false)).toBe(true);
    expect(row(rowId).group?.unified).toBe(false);
    expect(row(rowId).clips[0].where?.span).toBe(false);
    expect(showTimeline.setGroupRowUnified(rowId, false)).toBe(false);
  });

  it('keeps its group through a save', () => {
    const saved = JSON.parse(JSON.stringify(row(rowId)));
    expect(normalizeLayerTrack(saved, 0)?.group).toEqual({ orderId: 'left', unified: true });
    expect(normalizeLayerTrack({ ...saved, subRow: false }, 0)?.group).toBeUndefined();
  });
});
