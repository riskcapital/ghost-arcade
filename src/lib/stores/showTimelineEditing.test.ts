/**
 * Editing the Timeline the way a video editor does: in and out points that
 * Loop plays between, recording into an empty Timeline, and the edit-point
 * and trim commands behind Up / Down and Q / W.
 *
 * requestAnimationFrame is a queue the test steps by hand, so every frame is exact.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { normalizeWorkArea, setShowRecordArm, showTimeline } from './showTimeline';
import { editPoints, jumpToEdit, trimToPlayhead } from '../components/show/timeline/trackCommands';
import type { Layer, ShowClipMedia } from '../types';

let frames: Array<(now: number) => void> = [];
let frameMs = 0;

function frame(ms: number) {
  frameMs += ms;
  const pending = frames;
  frames = [];
  for (const cb of pending) cb(frameMs);
}

function hydrateShow(duration: number, loop: boolean) {
  showTimeline.hydrate({
    version: 1,
    loop,
    audioTracks: [],
    presetClips: [{ id: 'one', compositionId: 'A', startTime: 0, duration, transitionIn: 'cut', transitionDuration: 0 }],
  });
}

const layer = (id: string) => ({ id, name: id, type: 'media', visible: true, opacity: 1, source: null }) as unknown as Layer;
const video = (name: string): ShowClipMedia => ({
  kind: 'video',
  name,
  src: `ghost-asset://localhost/clips/${name}`,
  _assetRef: { kind: 'local-file', originalPath: `/clips/${name}`, name },
  sourceDuration: 60,
}) as ShowClipMedia;

/** Rows of blocks: [name, start, length] each. Returns the block ids by name. */
function rows(...spec: Array<Array<[string, number, number]>>): Record<string, string> {
  const ids: Record<string, string> = {};
  spec.forEach((blocks, i) => {
    const track = showTimeline.addLayerTrack(layer(`L${i}`));
    for (const [name, start, length] of blocks) ids[name] = showTimeline.addLayerClip(track, video(`${name}.mp4`), start, { duration: length })!;
  });
  return ids;
}

beforeEach(() => {
  showTimeline._resetForTest();
  frames = [];
  frameMs = 1000;
  vi.stubGlobal('requestAnimationFrame', (cb: (now: number) => void) => { frames.push(cb); return frames.length; });
  vi.stubGlobal('cancelAnimationFrame', () => { frames = []; });
});

afterEach(() => {
  setShowRecordArm(null);
  showTimeline._resetForTest();
  vi.unstubAllGlobals();
});

describe('in and out points', () => {
  it('I and O set them; an out point before the in point is refused', () => {
    hydrateShow(20, false);
    showTimeline.markIn(4);
    expect(get(showTimeline).workArea).toEqual({ start: 4, end: 20 });
    showTimeline.markOut(9);
    expect(get(showTimeline).workArea).toEqual({ start: 4, end: 9 });
    // An in point after the out point starts a fresh span from there.
    showTimeline.markIn(12);
    expect(get(showTimeline).workArea).toEqual({ start: 12, end: 20 });
    showTimeline.setWorkArea(null);
    expect(get(showTimeline).workArea).toBeNull();
    expect(normalizeWorkArea({ start: 5, end: 5.01 })).toBeNull();
    expect(normalizeWorkArea({ start: -1, end: 3 })).toBeNull();
  });

  it('with Loop on, play starts at the in point and loops at the out point', () => {
    hydrateShow(20, true);
    showTimeline.setWorkArea({ start: 4, end: 6 });
    showTimeline.play();
    expect(get(showTimeline).currentTime).toBeCloseTo(4, 6);
    frame(16); // anchors
    for (let i = 0; i < 25; i++) frame(100); // 2.5 s
    const t = get(showTimeline).currentTime;
    expect(t).toBeGreaterThanOrEqual(4);
    expect(t).toBeLessThan(6);
    expect(t).toBeCloseTo(4.5, 1);
  });

  it('without Loop they do not stop the show', () => {
    hydrateShow(20, false);
    showTimeline.setWorkArea({ start: 4, end: 6 });
    showTimeline.seek(5);
    showTimeline.play();
    frame(16);
    for (let i = 0; i < 20; i++) frame(100);
    expect(get(showTimeline).currentTime).toBeCloseTo(7, 1);
  });

  it('are saved with the document', () => {
    hydrateShow(20, false);
    showTimeline.setWorkArea({ start: 2, end: 8 });
    const saved = JSON.parse(JSON.stringify(showTimeline.serialize()));
    showTimeline._resetForTest();
    showTimeline.hydrate(saved);
    expect(get(showTimeline).workArea).toEqual({ start: 2, end: 8 });
  });
});

describe('recording into the Timeline', () => {
  it('armed, an empty Timeline plays and runs on; disarmed it stops where it got to', () => {
    showTimeline.openDoc('timeline');
    expect(get(showTimeline).duration).toBe(0);
    showTimeline.play();
    expect(get(showTimeline).isPlaying).toBe(false);
    let armed = true;
    setShowRecordArm(() => armed);
    showTimeline.play();
    expect(get(showTimeline).isPlaying).toBe(true);
    frame(16);
    for (let i = 0; i < 20; i++) frame(100);
    expect(get(showTimeline).currentTime).toBeCloseTo(2, 1);
    armed = false;
    frame(100);
    expect(get(showTimeline).isPlaying).toBe(false);
  });
});

describe('edit points and trims', () => {
  function timeline() {
    showTimeline.openDoc('timeline');
    return rows([['a', 0, 4], ['b', 6, 4]], [['c', 2, 6]]);
  }

  it('Up / Down go to the previous / next edit point', () => {
    timeline();
    expect(editPoints()).toEqual([0, 2, 4, 6, 8, 10]);
    showTimeline.seek(4.5);
    jumpToEdit(1);
    expect(get(showTimeline).currentTime).toBeCloseTo(6, 6);
    jumpToEdit(-1);
    expect(get(showTimeline).currentTime).toBeCloseTo(4, 6);
    jumpToEdit(-1);
    expect(get(showTimeline).currentTime).toBeCloseTo(2, 6);
  });

  it('Q / W trim the blocks under the playhead to it, or the selected ones only', () => {
    const ids = timeline();
    const name = Object.fromEntries(Object.entries(ids).map(([k, v]) => [v, k]));
    const ends = () => get(showTimeline).layerTracks.flatMap((t) => t.clips.map((c) => [name[c.id], c.startTime, c.startTime + c.duration]));
    // Nothing selected (adding a block selects it): every block under the playhead.
    showTimeline.selectLayerClips([]);
    showTimeline.seek(3);
    expect(trimToPlayhead('end')).toBe(true);
    expect(ends()).toEqual([['a', 0, 3], ['b', 6, 10], ['c', 2, 3]]);
    showTimeline.seek(7);
    showTimeline.selectLayerClips([ids.b]);
    expect(trimToPlayhead('start')).toBe(true);
    expect(ends()).toEqual([['a', 0, 3], ['b', 7, 10], ['c', 2, 3]]);
    // Nothing under the playhead: nothing to trim.
    showTimeline.selectLayerClips([]);
    showTimeline.seek(5);
    expect(trimToPlayhead('start')).toBe(false);
  });
});

describe('a recorded block', () => {
  it('overwrites what was under it: blocks inside go, blocks across an edge are cut', () => {
    showTimeline.openDoc('timeline');
    const ids = rows([['a', 0, 4], ['b', 5, 2], ['c', 8, 4]]);
    const row = get(showTimeline).layerTracks[0].id;
    const id = showTimeline.recordLayerBlock(row, video('take.mp4'), 3, 9);
    expect(id).toBeTruthy();
    const name: Record<string, string> = { ...Object.fromEntries(Object.entries(ids).map(([k, v]) => [v, k])), [id!]: 'take' };
    const blocks = get(showTimeline).layerTracks[0].clips.map((c) => [name[c.id] ?? 'cut', c.startTime, c.startTime + c.duration]);
    expect(blocks).toEqual([['a', 0, 3], ['take', 3, 9], ['cut', 9, 12]]);
  });
});

describe('live edit with the playhead parked', () => {
  it('a swap cuts the block under the playhead and the right part takes the new media', () => {
    showTimeline.openDoc('timeline');
    rows([['a', 0, 6]]);
    const row = get(showTimeline).layerTracks[0].id;
    showTimeline.cutInLayerMedia(row, video('swap.mp4'), 2);
    const blocks = () => get(showTimeline).layerTracks[0].clips.map((c) => [c.media.name, c.startTime, c.startTime + c.duration]);
    expect(blocks()).toEqual([['a.mp4', 0, 2], ['swap.mp4', 2, 6]]);
    // At a block's start the whole block takes it.
    showTimeline.cutInLayerMedia(row, video('again.mp4'), 2);
    expect(blocks()).toEqual([['a.mp4', 0, 2], ['again.mp4', 2, 6]]);
    // In a gap, a block runs to the next block or 10 s.
    showTimeline.cutInLayerMedia(row, video('gap.mp4'), 8);
    expect(blocks()).toEqual([['a.mp4', 0, 2], ['again.mp4', 2, 6], ['gap.mp4', 8, 18]]);
  });
});

describe('ripple, roll and slip', () => {
  function row() {
    showTimeline.openDoc('timeline');
    const ids = rows([['a', 0, 4], ['b', 4, 4], ['c', 10, 2]]);
    const name = Object.fromEntries(Object.entries(ids).map(([k, v]) => [v, k]));
    const blocks = () => get(showTimeline).layerTracks[0].clips.map((c) => [name[c.id], +c.startTime.toFixed(3), +(c.startTime + c.duration).toFixed(3), +c.inPoint.toFixed(3)]);
    return { ids, blocks };
  }

  it('ripple: an end edge moves every later block with it, no gap and nothing covered', () => {
    const { ids, blocks } = row();
    showTimeline.rippleTrimLayerClip(ids.a, 'end', 3);
    expect(blocks()).toEqual([['a', 0, 3, 0], ['b', 3, 7, 0], ['c', 9, 11, 0]]);
    showTimeline.rippleTrimLayerClip(ids.a, 'end', 5);
    expect(blocks()).toEqual([['a', 0, 5, 0], ['b', 5, 9, 0], ['c', 11, 13, 0]]);
  });

  it('ripple: a start edge trims the media and pulls the later blocks back', () => {
    const { ids, blocks } = row();
    showTimeline.rippleTrimLayerClip(ids.b, 'start', 5);
    expect(blocks()).toEqual([['a', 0, 4, 0], ['b', 4, 7, 1], ['c', 9, 11, 0]]);
  });

  it('roll: the cut between touching blocks moves, the right block keeps its picture', () => {
    const { ids, blocks } = row();
    showTimeline.rollLayerEdit(ids.a, ids.b, 5);
    expect(blocks()).toEqual([['a', 0, 5, 0], ['b', 5, 8, 1], ['c', 10, 12, 0]]);
    // Blocks that do not touch do not roll.
    showTimeline.rollLayerEdit(ids.b, ids.c, 9);
    expect(blocks()).toEqual([['a', 0, 5, 0], ['b', 5, 8, 1], ['c', 10, 12, 0]]);
  });

  it('slip: the block stays put and plays a later stretch of its media', () => {
    const { ids, blocks } = row();
    showTimeline.slipLayerClip(ids.c, 3);
    expect(blocks()).toEqual([['a', 0, 4, 0], ['b', 4, 8, 0], ['c', 10, 12, 3]]);
    showTimeline.slipLayerClip(ids.c, -10);
    expect(blocks()).toEqual([['a', 0, 4, 0], ['b', 4, 8, 0], ['c', 10, 12, 0]]);
  });
});

describe('grouped blocks', () => {
  it('select, move, copy and ungroup as one; a copy is a new group', () => {
    showTimeline.openDoc('timeline');
    const ids = rows([['a', 0, 2]], [['b', 1, 2]], [['c', 6, 2]]);
    expect(showTimeline.groupLayerClips([ids.a, ids.b])).toBe(true);
    showTimeline.selectLayerClips([ids.a]);
    expect(new Set(get(showTimeline).selectedClipIds)).toEqual(new Set([ids.a, ids.b]));
    // Moving the selection moves both rows.
    showTimeline.moveLayerClipsAcross(get(showTimeline).selectedClipIds, 1, 0);
    const starts = () => get(showTimeline).layerTracks.map((t) => t.clips.map((c) => c.startTime));
    expect(starts()).toEqual([[1], [2], [6]]);
    // Duplicating makes a new group, not more members of the old one.
    const copies = showTimeline.duplicateLayerClips(get(showTimeline).selectedClipIds);
    const all = get(showTimeline).layerTracks.flatMap((t) => t.clips);
    const groupOf = (id: string) => all.find((c) => c.id === id)!.groupId;
    expect(groupOf(copies[0])).toBe(groupOf(copies[1]));
    expect(groupOf(copies[0])).not.toBe(groupOf(ids.a));
    // Ungroup: a click selects one block again.
    expect(showTimeline.ungroupLayerClips([ids.b])).toBe(true);
    showTimeline.selectLayerClips([ids.a]);
    expect(get(showTimeline).selectedClipIds).toEqual([ids.a]);
  });

  it('a group is saved with the Timeline', () => {
    showTimeline.openDoc('timeline');
    const ids = rows([['a', 0, 2]], [['b', 1, 2]]);
    showTimeline.groupLayerClips([ids.a, ids.b]);
    const saved = JSON.parse(JSON.stringify(showTimeline.serialize()));
    showTimeline._resetForTest();
    showTimeline.hydrate(saved);
    showTimeline.openDoc('timeline');
    const clips = get(showTimeline).layerTracks.flatMap((t) => t.clips);
    expect(clips.length).toBe(2);
    expect(clips[0].groupId).toBeTruthy();
    expect(clips[0].groupId).toBe(clips[1].groupId);
  });
});
