/**
 * The show tray's shortcuts: each cached or indexed answer must equal the
 * plain one it replaces, and the slices must stay quiet while only the
 * playhead moves (that is what keeps a playing show from re-rendering the
 * whole tray every frame).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import type { Layer, ShowClipMedia, ShowLayerClip, ShowPresetClip } from '../../../types';
import {
  showTimeline,
  maxShowTransitionDuration,
  setShowCompositionLoader,
  setShowSnapEdgeProvider,
  setShowTrackFrameSink,
  showTransitionWindow,
} from '../../../stores/showTimeline';
import { findJunctionPredecessor } from '../../../show/showJunctions';
import { trackTransitionWindow } from '../../../show/tracks/showTrackEval';
import { createTempoMap } from '../../../show/tempoMap';
import { junctionPredecessors, predecessorList, presetJunctions } from './laneJunctions';
import { cachedWavePath, wavePath } from './waveform';
import { distinct, showSlice } from './timelineSlices';
import { dragSnapper } from './dragSnap';
import { nudgeSelection } from './trackCommands';
import { devicePixel } from './timeFormat';
import { writable } from 'svelte/store';

let seed = 1;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

/** A lane the way tracks keep them: sorted, touching or apart. */
function tidyLane(n: number, prefix = 'c'): ShowLayerClip[] {
  let t = 0;
  return Array.from({ length: n }, (_, i) => {
    t += rnd() < 0.6 ? 0 : rnd() < 0.5 ? 1e-7 : rnd() * 3;
    const duration = 0.25 + Math.round(rnd() * 40) / 4;
    const c = {
      id: `${prefix}${i}`, startTime: t, duration, media: { kind: 'layer', name: 'x', src: '' } as ShowClipMedia,
      inPoint: 0, endBehaviour: 'hold', fadeIn: 0, fadeOut: 0,
      ...(rnd() < 0.5 ? { transitionIn: 'dissolve' as const, transitionDuration: rnd() * 6 } : {}),
    } as ShowLayerClip;
    t += duration;
    return c;
  });
}

/** Anything at all: unsorted, overlapping, duplicate ids, near misses. */
function messyLane(n: number): ShowLayerClip[] {
  const base = tidyLane(n);
  return base
    .map((c, i) => ({
      ...c,
      id: rnd() < 0.05 ? 'dup' : c.id,
      startTime: rnd() < 0.2 ? c.startTime + (rnd() - 0.5) * 4e-6 : rnd() < 0.1 ? base[Math.floor(rnd() * n)].startTime : c.startTime,
      duration: rnd() < 0.05 ? 0 : c.duration,
      _i: i,
    }))
    .sort(() => rnd() - 0.5);
}

describe('junction predecessors', () => {
  it('match findJunctionPredecessor on tidy and messy lanes', () => {
    for (let round = 0; round < 60; round++) {
      const lane = round % 2 ? tidyLane(5 + Math.floor(rnd() * 80)) : messyLane(5 + Math.floor(rnd() * 80));
      const prevOf = junctionPredecessors(lane);
      for (const c of lane) expect(prevOf.get(c) ?? null).toBe(findJunctionPredecessor(lane, c));
    }
  });

  it('give the same crossfade windows as a full scan', () => {
    for (let round = 0; round < 20; round++) {
      const lane = tidyLane(60);
      const prevOf = junctionPredecessors(lane);
      for (const c of lane) {
        expect(trackTransitionWindow(predecessorList(prevOf.get(c), c), c)).toEqual(trackTransitionWindow(lane, c));
      }
    }
  });

  it('give the same preset-lane junctions as the per-clip scans', () => {
    for (let round = 0; round < 20; round++) {
      const lane = (round % 2 ? tidyLane(40) : messyLane(40)).map((c, i) => ({
        id: c.id === 'dup' ? 'dup' : `p${i}`, compositionId: `comp${i % 3}`, startTime: c.startTime, duration: c.duration,
        transitionIn: i % 3 ? 'dissolve' : 'cut', transitionDuration: rnd() * 5,
      })) as ShowPresetClip[];
      const plain = lane
        .map((clip) => {
          const max = maxShowTransitionDuration(lane, clip);
          return max <= 0 ? null : { clipId: clip.id, boundary: clip.startTime, max, window: showTransitionWindow(lane, clip) };
        })
        .filter((j) => j !== null);
      expect(presetJunctions(lane)).toEqual(plain);
    }
  });
});

describe('waveform path cache', () => {
  it('equals the plain path, and is reused until the shown slice changes', () => {
    const peaks = Array.from({ length: 512 }, () => Math.floor(rnd() * 255));
    const first = cachedWavePath(peaks, 3, 40, 120);
    expect(first).toBe(wavePath(peaks, 3, 40, 120));
    // Peaks are never mutated in place; doing it here shows the cache answered.
    peaks[100] = 255 - peaks[100];
    expect(cachedWavePath(peaks, 3, 40, 120)).toBe(first);
    const moved = cachedWavePath(peaks, 4, 40, 120);
    expect(moved).toBe(wavePath(peaks, 4, 40, 120));
    expect(cachedWavePath(undefined, 0, 1, 1)).toBe('');
    expect(cachedWavePath([], 0, 1, 1)).toBe('');
  });
});

const media = (name: string): ShowClipMedia => ({ kind: 'image', name, src: `/img/${name}` });
const layer = (id: string) => ({ id, name: id, type: 'media', opacity: 1, source: null }) as unknown as Layer;

describe('with a show loaded', () => {
  let a = '';
  let b = '';
  beforeEach(() => {
    showTimeline._resetForTest();
    setShowCompositionLoader(() => {});
    setShowTrackFrameSink(() => {});
    a = showTimeline.addLayerTrack(layer('A'));
    b = showTimeline.addLayerTrack(layer('B'));
    for (let i = 0; i < 30; i++) showTimeline.addLayerClip(a, media(`a${i}`), i * 4, { duration: 4 });
    for (let i = 0; i < 20; i++) showTimeline.addLayerClip(b, media(`b${i}`), 1 + i * 5, { duration: 3 });
    showTimeline.selectLayerClips([]);
  });
  afterEach(() => {
    setShowTrackFrameSink(null);
    setShowCompositionLoader(null);
    setShowSnapEdgeProvider(null);
    showTimeline._resetForTest();
  });

  it('slices stay quiet while only the playhead moves', () => {
    const counts = { layerTracks: 0, selection: 0, zoom: 0, presetClips: 0, currentTime: 0 };
    const stops = (Object.keys(counts) as Array<keyof typeof counts>).map((k) => showSlice(k).subscribe(() => { counts[k]++; }));
    for (let i = 0; i < 100; i++) showTimeline.seek(i * 0.5);
    expect(counts).toEqual({ layerTracks: 1, selection: 1, zoom: 1, presetClips: 1, currentTime: 100 });
    showTimeline.addLayerClip(a, media('late'), 500, { duration: 2 });
    expect(counts.layerTracks).toBe(2);
    expect(counts.zoom).toBe(1);
    for (const stop of stops) stop();
  });

  it('a slice always reads the store’s current value', () => {
    const slice = showSlice('layerTracks');
    expect(get(slice)).toBe(get(showTimeline).layerTracks);
    showTimeline.addLayerClip(b, media('x'), 300, { duration: 1 });
    expect(get(slice)).toBe(get(showTimeline).layerTracks);
  });

  it('distinct passes a store on only when the value changes', () => {
    const obj = { n: 1 };
    const src = writable(obj);
    let fired = 0;
    const stop = distinct(src).subscribe(() => { fired++; });
    src.set(obj);
    src.set(obj);
    expect(fired).toBe(1);
    src.set({ n: 2 });
    expect(fired).toBe(2);
    stop();
  });

  it('a drag snaps exactly like snapTime, playhead moves included', () => {
    const tr = get(showTimeline).layerTracks;
    const moving = [tr[0].clips[3].id, tr[1].clips[7].id];
    setShowSnapEdgeProvider(() => [13.37, 61.2]);
    for (const tempo of [null, createTempoMap(123)]) {
      showTimeline.setTempo(tempo);
      if (tempo) showTimeline.setSnapGrid('beat');
      for (const exclude of [[], moving]) {
        showTimeline.seek(7.3);
        const snapper = dragSnapper(exclude);
        for (let i = 0; i < 200; i++) {
          if (i === 100) showTimeline.seek(42.11); // the show plays on under the drag
          const t = rnd() * 120;
          expect(snapper.snap(t)).toBe(showTimeline.snapTime(t, exclude));
          expect([...snapper.edges()]).toEqual(showTimeline.snapTargets(exclude));
        }
      }
    }
  });

  it('nudges a whole selection by one step', () => {
    showTimeline.selectAllLayerClips();
    const before = get(showTimeline).layerTracks.map((t) => t.clips.map((c) => c.startTime));
    expect(nudgeSelection(1, false)).toBe(true);
    const after = get(showTimeline).layerTracks.map((t) => t.clips.map((c) => c.startTime));
    expect(after).toEqual(before.map((row) => row.map((s) => s + 0.25)));
  });
});

describe('playhead position', () => {
  it('lands on the device pixel grid', () => {
    expect(devicePixel(100.3, 2)).toBe(100.5);
    expect(devicePixel(100.2, 2)).toBe(100);
    expect(devicePixel(100.4, 1)).toBe(100);
  });
});
