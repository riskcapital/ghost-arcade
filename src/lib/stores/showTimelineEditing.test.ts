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
