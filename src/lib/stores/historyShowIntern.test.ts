/**
 * The show part of each undo step is stored as shared fragments: what did
 * not change between steps (shader sources, templates, untouched clips) is
 * kept once, and every undo and redo still gives back exactly the
 * arrangement that was recorded.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { history, historyTableStats, showHistoryRestore } from './history';
import type { Project } from '../types';

const project = { name: 'p', layers: [] } as unknown as Project;

function shader(n: number): string {
  let s = `/*{"DESCRIPTION":"clip ${n}"}*/\n`;
  for (let i = 0; s.length < 8192; i++) s += `float f${n}_${i}(vec2 p){ return sin(p.x * ${i}.0); }\n`;
  return s;
}

function arrangement(tracks: number, clipsPerTrack: number) {
  return {
    audioTracks: [{ id: 'a1', name: 'Song', url: 'blob:x', startTime: 0, duration: 60, offset: 0, sourceDuration: 60, volume: 1, muted: false, lane: 0, peaks: Array.from({ length: 512 }, (_, i) => i % 256) }],
    presetClips: [{ id: 'p1', compositionId: 'c1', startTime: 0, duration: 10 }],
    loop: false,
    endAction: 'hold',
    tempo: null,
    cameraLane: [],
    layerTracks: Array.from({ length: tracks }, (_, t) => ({
      id: `t${t}`,
      layerId: `L${t}`,
      layerName: `Layer ${t}`,
      template: { id: `L${t}`, type: 'shader', name: `Layer ${t}`, source: { id: `s${t}`, type: 'shader', shaderCode: shader(5000 + t) }, opacity: 1 },
      clips: Array.from({ length: clipsPerTrack }, (_, k) => ({
        id: `c${t}_${k}`, startTime: k * 10, duration: 10, inPoint: 0, endBehaviour: 'loop', fadeIn: 0, fadeOut: 0,
        media: { kind: 'shader', name: `Clip ${k}`, src: '', shaderCode: shader(t * 100 + k), shaderValues: { speed: 1 } },
      })),
      lanes: [{ key: 'opacity', label: 'Opacity', type: 'number', keyframes: [{ time: 0, value: 1, easing: 'linear' }], boolKeyframes: [] }],
      gap: 'layer', muted: false, locked: false, collapsed: false,
    })),
  };
}

type Arr = ReturnType<typeof arrangement>;
/** The arrangement with clip `k` of track `t` changed (a new object path, as the store does it). */
function edit(a: Arr, t: number, k: number, opacity: number): Arr {
  return {
    ...a,
    layerTracks: a.layerTracks.map((tr, i) => i !== t ? tr : { ...tr, clips: tr.clips.map((c, j) => (j === k ? { ...c, opacity } : c)) }),
  };
}

/** What a step held before fragments: the arrangement through JSON. */
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));

afterEach(() => history.clear());

describe('show fragments in the undo history', () => {
  it('gives back exactly the recorded arrangement on every undo and redo', () => {
    let a = arrangement(4, 6);
    const states = [a];
    history.init(project, null, null, a);
    for (let i = 0; i < 12; i++) {
      a = edit(a, i % 4, i % 6, i / 20);
      states.push(a);
      history.record(project, null, null, a);
    }
    for (let i = states.length - 2; i >= 0; i--) {
      const snap = history.undo(project)!;
      expect(JSON.stringify(snap.show)).toBe(JSON.stringify(states[i]));
      expect(snap.show).toEqual(plain(states[i]));
      expect(snap.showChanged).toBe(true);
      expect(showHistoryRestore(snap.show, snap.leavingShow, snap.showChanged)).toBe(snap.show);
      expect(JSON.stringify(snap.leavingShow)).toBe(JSON.stringify(states[i + 1]));
    }
    for (let i = 1; i < states.length; i++) {
      const snap = history.redo(project)!;
      expect(JSON.stringify(snap.show)).toBe(JSON.stringify(states[i]));
    }
  });

  it('keeps what JSON keeps: nulls for holes, no runtime handles, odd numbers', () => {
    const a = { ...arrangement(1, 1), extra: { list: [1, undefined, () => 0, NaN, -0, 'x'.repeat(2000)], texture: { isTexture: true }, fn: () => 1 } };
    history.init(project, null, null, a);
    history.record(project, null, null, { ...a, loop: true });
    const snap = history.undo(project)!;
    const expected = plain({ ...a, extra: { list: [1, null, null, null, 0, 'x'.repeat(2000)] } });
    expect(snap.show).toEqual(expected);
    expect(JSON.stringify(snap.show)).toBe(JSON.stringify(expected));
  });

  it('keeps unchanged clips, shaders and templates once across steps', () => {
    let a = arrangement(20, 15);
    history.init(project, null, null, a);
    const first = historyTableStats();
    for (let i = 0; i < 50; i++) {
      a = edit(a, i % 20, i % 15, (i % 9) / 10);
      history.record(project, null, null, a);
    }
    const after = historyTableStats();
    const state = get(history);
    const stepChars = [...state.past, state.current!].reduce((n, e) => n + e.json.length, 0);
    // 300 shader sources and 20 templates of ~8 KB each: ~2.6 MB per step inline.
    expect(first.strings).toBe(320);
    expect(after.strings).toBe(320);
    // Each step adds its edited clip and the containers above it, not the show.
    expect(after.fragmentChars - first.fragmentChars).toBeLessThan(50 * 12_000);
    expect(stepChars).toBeLessThan(51 * 400);
  });

  it('compares an untouched show by id and restores it once', () => {
    const a = arrangement(2, 2);
    history.init(project, null, null, a);
    history.record({ ...project, name: 'renamed' } as Project, null, null, a);
    const snap = history.undo(project)!;
    expect(snap.showChanged).toBe(false);
    expect(snap.leavingShow).toBe(snap.show);
    expect(showHistoryRestore(snap.show, snap.leavingShow, snap.showChanged)).toBeUndefined();
    expect(showHistoryRestore(snap.show, snap.leavingShow)).toBeUndefined();
  });

  it('forgets fragments no step refers to any more', () => {
    let a = arrangement(2, 3);
    history.init(project, null, null, a);
    for (let i = 0; i < 60; i++) {
      a = edit(a, 0, 0, i / 100);
      history.record(project, null, null, a);
    }
    const busy = historyTableStats();
    history.clear();
    expect(historyTableStats()).toEqual({ strings: 0, fragments: 0, fragmentChars: 0 });
    history.init(project, null, null, a);
    const fresh = historyTableStats();
    expect(fresh.fragments).toBeLessThan(busy.fragments);
    // Steps recorded after the clear still restore whole shows.
    const before = a;
    a = edit(a, 1, 2, 0.5);
    history.record(project, null, null, a);
    expect(JSON.stringify(history.undo(project)!.show)).toBe(JSON.stringify(before));
  });
});
