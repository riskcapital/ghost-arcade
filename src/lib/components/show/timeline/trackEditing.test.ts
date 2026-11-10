import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import type { Layer, ShowClipMedia, ShowLayerTrack } from '../../../types';
import { showTimeline, setShowCompositionLoader, setShowSnapEdgeProvider, setShowTrackFrameSink } from '../../../stores/showTimeline';
import { createTempoMap } from '../../../show/tempoMap';
import {
  clipsInView,
  focusedTrackId,
  laneKeySelection,
  laneValueToY,
  laneYToValue,
  setTrackClipboard,
  snapGuideAt,
  trackHeight,
  trackIndexAt,
  tracksStackHeight,
  TRACK_ROW_HEIGHT,
  LANE_ROW_HEIGHT,
  ADD_TRACK_ROW_HEIGHT,
} from './trackLayout';
import {
  copySelection,
  cutSelection,
  deleteSelection,
  duplicateSelection,
  nudgeSelection,
  pasteAtPlayhead,
  splitAtPlayhead,
} from './trackCommands';
import { clipMediaFromTrayPayload, isTrackMediaFile } from './clipMedia';

const media = (name: string): ShowClipMedia => ({ kind: 'image', name, src: `/img/${name}` });
const layer = (id: string) => ({ id, name: id, type: 'media', opacity: 1, source: null }) as unknown as Layer;

function tracks(): ShowLayerTrack[] {
  return get(showTimeline).layerTracks;
}
function clips(i: number): Array<[string, number, number]> {
  return tracks()[i].clips.map((c) => [c.media.name, +c.startTime.toFixed(3), +c.duration.toFixed(3)]);
}

describe('track layout', () => {
  it('lines headers up with lanes, and finds the row under the pointer', () => {
    const list = [{ collapsed: false, lanes: [] }, { collapsed: false, lanes: [{}, {}] }, { collapsed: true, lanes: [{}] }] as unknown as ShowLayerTrack[];
    expect(trackHeight(list[1])).toBe(TRACK_ROW_HEIGHT + 2 * LANE_ROW_HEIGHT);
    expect(trackHeight(list[2])).toBe(TRACK_ROW_HEIGHT);
    expect(tracksStackHeight(list)).toBe(3 * TRACK_ROW_HEIGHT + 2 * LANE_ROW_HEIGHT + ADD_TRACK_ROW_HEIGHT);
    expect(trackIndexAt(list, 0)).toBe(0);
    expect(trackIndexAt(list, TRACK_ROW_HEIGHT + 2)).toBe(1);
    expect(trackIndexAt(list, TRACK_ROW_HEIGHT * 2 + LANE_ROW_HEIGHT * 2 + 1)).toBe(2);
    expect(trackIndexAt(list, 9999)).toBe(2);
    expect(trackIndexAt([], 10)).toBe(-1);
  });

  it('draws only the clips in the visible window', () => {
    const list = [0, 10, 20, 30, 40].map((s) => ({ startTime: s, duration: 5 }));
    expect(clipsInView(list, 12, 31).map((c) => c.startTime)).toEqual([10, 20, 30]);
    expect(clipsInView(list, 15.5, 19)).toEqual([]);
    expect(clipsInView(list, 4, 4).map((c) => c.startTime)).toEqual([0]);
  });

  it('puts the snap guide on the edge that landed on a target', () => {
    expect(snapGuideAt({ start: 4, end: 9 }, [9], 3.9, 4)).toBe(9);
    expect(snapGuideAt({ start: 4, end: 9 }, [4], 4.1, 4)).toBe(4);
    expect(snapGuideAt({ start: 4, end: 9 }, [], 4.1, 4)).toBe(4); // the grid
    expect(snapGuideAt({ start: 4.1, end: 9.1 }, [], 4.1, 4.1)).toBeNull();
  });

  it('maps lane values to heights and back', () => {
    for (const v of [0, 0.25, 1]) expect(laneYToValue(laneValueToY(v, 0, 1, 30), 0, 1, 30)).toBeCloseTo(v, 9);
    expect(laneValueToY(1, 0, 1, 30)).toBeLessThan(laneValueToY(0, 0, 1, 30));
  });
});

describe('media dropped on a track', () => {
  it('takes tray videos, images, shaders and sketches, and refuses the rest', () => {
    expect(clipMediaFromTrayPayload({ id: 'v1', type: 'video', name: 'a.mp4', src: 'x', durationSeconds: 8 })).toMatchObject({ kind: 'video', libraryId: 'v1', sourceDuration: 8 });
    expect(clipMediaFromTrayPayload({ id: 's', type: 'shader', name: 'S', src: 'ISF/S.fs', shaderCode: 'void main(){}', shaderImageInputs: { img: null } })).toMatchObject({ kind: 'shader', shaderImageInputs: {} });
    expect(clipMediaFromTrayPayload({ id: 'j', type: 'p5js', name: 'J', jsAnimation: { animationType: 'p5js' } })).toMatchObject({ kind: 'sketch' });
    expect(clipMediaFromTrayPayload({ id: 'p', type: 'preset', name: 'P' })).toBeNull();
    expect(clipMediaFromTrayPayload({ id: 'n', type: 'ndi', name: 'Cam', sourceType: 'ndi' })).toBeNull();
    expect(isTrackMediaFile({ name: 'clip.mov' })).toBe(true);
    expect(isTrackMediaFile({ name: 'look.fs' })).toBe(true);
    expect(isTrackMediaFile({ name: 'song.wav' })).toBe(false);
  });
});

describe('editing tracks from the keyboard', () => {
  let a = '';
  let b = '';
  beforeEach(() => {
    showTimeline._resetForTest();
    setShowCompositionLoader(() => {});
    setShowTrackFrameSink(() => {});
    setTrackClipboard(null);
    laneKeySelection.set(null);
    a = showTimeline.addLayerTrack(layer('A'));
    b = showTimeline.addLayerTrack(layer('B'));
    showTimeline.addLayerClip(a, media('a1'), 0, { duration: 4 });
    showTimeline.addLayerClip(a, media('a2'), 6, { duration: 2 });
    showTimeline.addLayerClip(b, media('b1'), 1, { duration: 3 });
    showTimeline.selectLayerClips([]);
    focusedTrackId.set(null);
  });
  afterEach(() => {
    setShowTrackFrameSink(null);
    setShowCompositionLoader(null);
    setShowSnapEdgeProvider(null);
    showTimeline._resetForTest();
  });

  const idOf = (track: number, name: string) => tracks()[track].clips.find((c) => c.media.name === name)!.id;

  it('splits every clip under the playhead, or only the selected ones', () => {
    showTimeline.seek(2);
    expect(splitAtPlayhead()).toBe(true);
    expect(clips(0).slice(0, 2)).toEqual([['a1', 0, 2], ['a1', 2, 2]]);
    expect(clips(1)).toEqual([['b1', 1, 1], ['b1', 2, 2]]);
    showTimeline.seek(3);
    showTimeline.selectLayerClips([tracks()[1].clips[1].id]);
    splitAtPlayhead();
    expect(clips(0)).toHaveLength(3);
    expect(clips(1)).toHaveLength(3);
  });

  it('duplicates after the selection', () => {
    showTimeline.selectLayerClips([idOf(0, 'a2')]);
    expect(duplicateSelection()).toBe(true);
    expect(clips(0)).toEqual([['a1', 0, 4], ['a2', 6, 2], ['a2', 8, 2]]);
  });

  it('pastes onto the focused track at the playhead, or each group back onto its own track', () => {
    showTimeline.selectLayerClips([idOf(0, 'a2')]);
    copySelection();
    showTimeline.seek(5);
    focusedTrackId.set(b);
    expect(pasteAtPlayhead()).toBe(true);
    expect(clips(1)).toEqual([['b1', 1, 3], ['a2', 5, 2]]);
    // Two tracks copied: each lands on its own, spacing kept.
    showTimeline.selectLayerClips([idOf(0, 'a1'), idOf(1, 'b1')]);
    copySelection();
    showTimeline.addLayerClip(a, media('end'), 20, { duration: 1 });
    showTimeline.seek(10);
    expect(pasteAtPlayhead()).toBe(true);
    expect(clips(0).filter(([n]) => n === 'a1').map(([, s]) => s)).toEqual([0, 10]);
    expect(clips(1).filter(([n]) => n === 'b1').map(([, s]) => s)).toEqual([1, 11]);
    expect(get(showTimeline).selectedClipIds).toHaveLength(2);
  });

  it('refuses a paste that would overlap, as one all-or-nothing step', () => {
    showTimeline.selectLayerClips([idOf(0, 'a1')]);
    copySelection();
    focusedTrackId.set(b);
    showTimeline.seek(0);
    expect(pasteAtPlayhead()).toBe(false);
    expect(clips(1)).toEqual([['b1', 1, 3]]);
  });

  it('cuts, deletes and ripple-deletes, keys before clips', () => {
    showTimeline.selectLayerClips([idOf(0, 'a1')]);
    expect(cutSelection()).toBe(true);
    expect(clips(0)).toEqual([['a2', 6, 2]]);
    showTimeline.addLayerClip(a, media('a1'), 0, { duration: 4 });
    showTimeline.selectLayerClips([idOf(0, 'a1')]);
    expect(deleteSelection(true)).toBe(true);
    expect(clips(0)).toEqual([['a2', 2, 2]]);
    showTimeline.addTrackLane(a, { key: 'layer:opacity', label: 'Opacity', type: 'number' });
    showTimeline.setLaneKey(a, 'layer:opacity', 1, 0.5);
    laneKeySelection.set({ trackId: a, key: 'layer:opacity', times: [1] });
    showTimeline.selectLayerClips([idOf(0, 'a2')]);
    expect(deleteSelection(false)).toBe(true);
    expect(tracks()[0].lanes[0].keyframes).toEqual([]);
    expect(clips(0)).toEqual([['a2', 2, 2]]);
  });

  it('nudges by the grid, a bar with Shift, on the beat grid with a tempo map', () => {
    showTimeline.selectLayerClips([idOf(1, 'b1')]);
    nudgeSelection(1, false);
    expect(clips(1)[0][1]).toBeCloseTo(1.25, 9);
    nudgeSelection(-1, true);
    expect(clips(1)[0][1]).toBeCloseTo(0.25, 9);
    showTimeline.setTempo(createTempoMap(120, 0));
    nudgeSelection(1, false);
    expect(clips(1)[0][1]).toBeCloseTo(0.75, 9);
    nudgeSelection(1, true);
    expect(clips(1)[0][1]).toBeCloseTo(2.75, 9);
  });

  it('moves a selection onto another track as one step, and refuses overlaps', () => {
    expect(showTimeline.moveLayerClipsAcross([idOf(0, 'a2')], 1, 1)).toBe(true);
    expect(clips(1)).toEqual([['b1', 1, 3], ['a2', 7, 2]]);
    expect(showTimeline.moveLayerClipsAcross([idOf(1, 'a2')], -6, 0)).toBe(false);
  });

  it('snaps to markers as well as clip edges and the playhead', () => {
    showTimeline.setSnapEnabled(true);
    showTimeline.setZoom(100);
    setShowSnapEdgeProvider(() => [12.37]);
    expect(showTimeline.snapTime(12.4)).toBe(12.37);
    expect(showTimeline.snapTargets()).toContain(12.37);
  });

  it('keys added on a lane drive the track frame and undo through the arrangement', () => {
    showTimeline.addTrackLane(a, { key: 'layer:opacity', label: 'Opacity', type: 'number' });
    showTimeline.setLaneKey(a, 'layer:opacity', 0, 0);
    showTimeline.setLaneKey(a, 'layer:opacity', 4, 1);
    const before = showTimeline.exportArrangement();
    showTimeline.moveLaneKey(a, 'layer:opacity', 4, 2, 0.5, 'drag');
    expect(tracks()[0].lanes[0].keyframes.map((k) => [k.time, k.value])).toEqual([[0, 0], [2, 0.5]]);
    showTimeline.restoreArrangement(before);
    expect(tracks()[0].lanes[0].keyframes.map((k) => [k.time, k.value])).toEqual([[0, 0], [4, 1]]);
    showTimeline.updateLayerTrack(a, { locked: true });
    expect(showTimeline.setLaneKey(a, 'layer:opacity', 3, 1)).toBe(false);
  });
});
