import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import type { Layer, ShowClipMedia } from '../../../types';
import type { ControlLine } from '../../../timeline/lines/lineModel';
import { showTimeline, setShowCompositionLoader, setShowSnapEdgeProvider, setShowTrackFrameSink } from '../../../stores/showTimeline';
import { lineSelection, selectedKeys, selectKeys } from '../../../timeline/lines/lineSelection';
import { focusedTrackId, laneKeySelection, setTrackClipboard } from './trackLayout';
import { copySelection, deleteSelection, nudgeSelection, pasteAtPlayhead } from './trackCommands';
import { moveSelectedKeys, selectForward } from './keyCommands';

const media = (name: string): ShowClipMedia => ({ kind: 'image', name, src: `/img/${name}` });
const layer = (id: string) => ({ id, name: id, type: 'media', opacity: 1, source: null }) as unknown as Layer;
const line = (id: string, layerId: string, times: number[]): ControlLine => ({
  id, target: { scope: 'layer', id: layerId }, key: 'layer:opacity', kind: 'continuous', min: 0, max: 1, step: 0.01, default: 1, label: id,
  points: times.map((t) => ({ t, v: 0.5 })),
});
const times = (id: string) => get(showTimeline).lines.find((l) => l.id === id)!.points.map((p) => +p.t.toFixed(3));

describe('keys edited with the blocks, from the keyboard and the forward tool', () => {
  let a = '';
  beforeEach(() => {
    showTimeline._resetForTest();
    setShowCompositionLoader(() => {});
    setShowTrackFrameSink(() => {});
    setTrackClipboard(null);
    laneKeySelection.set(null);
    lineSelection.set(null);
    a = showTimeline.addLayerTrack(layer('A'));
    showTimeline.addLayerTrack(layer('B'));
    showTimeline.addLayerClip(a, media('a1'), 0, { duration: 4 });
    showTimeline.addLayerClip(a, media('a2'), 10, { duration: 2 });
    showTimeline.setLines([line('la', 'A', [1, 6, 11]), line('lb', 'B', [2, 8])]);
    showTimeline.selectLayerClips([]);
    focusedTrackId.set(null);
  });
  afterEach(() => {
    setShowTrackFrameSink(null);
    setShowCompositionLoader(null);
    setShowSnapEdgeProvider(null);
    lineSelection.set(null);
    showTimeline._resetForTest();
  });

  it('deletes keys on several lines in one go', () => {
    selectKeys([{ lineId: 'la', t: 6 }, { lineId: 'lb', t: 8 }]);
    expect(deleteSelection(false)).toBe(true);
    expect(times('la')).toEqual([1, 11]);
    expect(times('lb')).toEqual([2]);
    expect(selectedKeys()).toEqual([]);
  });

  it('nudges keys and blocks together by the same step', () => {
    const a2 = get(showTimeline).layerTracks[0].clips[1].id;
    showTimeline.selectLayerClips([a2]);
    selectKeys([{ lineId: 'la', t: 11 }, { lineId: 'lb', t: 8 }]);
    expect(nudgeSelection(1, false)).toBe(true);
    const step = get(showTimeline).layerTracks[0].clips[1].startTime - 10;
    expect(step).toBeGreaterThan(0);
    expect(times('la')).toEqual([1, 6, +(11 + step).toFixed(3)]);
    expect(times('lb')).toEqual([2, +(8 + step).toFixed(3)]);
  });

  it('copies keys and pastes them at the playhead, earliest first', () => {
    selectKeys([{ lineId: 'la', t: 1 }, { lineId: 'lb', t: 2 }]);
    expect(copySelection()).toBe(true);
    showTimeline.seek(9);
    expect(pasteAtPlayhead()).toBe(true);
    expect(times('la')).toEqual([1, 6, 9, 11]);
    expect(times('lb')).toEqual([2, 8, 10]);
    expect(selectedKeys().map((k) => k.t)).toEqual([9, 10]);
  });

  it('selects every block and key from a time on, or on one row', () => {
    expect(selectForward(5)).toEqual({ clips: 1, keys: 3 });
    expect(get(showTimeline).selectedClipIds.length).toBe(1);
    const row = get(showTimeline).layerTracks[1];
    expect(selectForward(5, row)).toEqual({ clips: 0, keys: 1 });
    expect(selectedKeys()).toEqual([{ lineId: 'lb', t: 8 }]);
  });

  it('moves keys alone, keeping the selection on them', () => {
    selectKeys([{ lineId: 'la', t: 6 }, { lineId: 'lb', t: 8 }]);
    expect(moveSelectedKeys(-1)).toBe(true);
    expect(times('la')).toEqual([1, 5, 11]);
    expect(times('lb')).toEqual([2, 7]);
    expect(selectedKeys().map((k) => k.t).sort()).toEqual([5, 7]);
  });
});
