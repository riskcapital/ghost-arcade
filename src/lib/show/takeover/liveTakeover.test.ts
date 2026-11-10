/**
 * Live takeover store: engage and release, momentary holds, quantised
 * release times on the tempo map and the launch clock, a release landing
 * exactly on its boundary, the show paused underneath and resumed, and
 * 'pause' refused while the show follows a clock.
 */
import { describe, expect, it } from 'vitest';
import {
  createLiveTakeover,
  evaluateTakeover,
  createTakeoverState,
  nextShowBoundary,
  releaseTargetFor,
  takeoverSummary,
  takeoverSourceLabel,
  type TakeoverDeps,
  type TakeoverShowContext,
} from './liveTakeover';
import { createTempoMap } from '../tempoMap';

function harness(init: Partial<TakeoverShowContext> = {}) {
  const t = { now: 1000, show: { showTime: 0, playing: false, tempo: null, markers: [], ...init } as TakeoverShowContext, chasing: false, paused: 0, played: 0, allReleased: 0 };
  const deps: Partial<TakeoverDeps> = {
    now: () => t.now,
    show: () => t.show,
    chasing: () => t.chasing,
    pauseShow: () => { t.paused++; t.show = { ...t.show, playing: false }; },
    playShow: () => { t.played++; t.show = { ...t.show, playing: true }; },
    // Launch clock at 120 BPM from wall 0: a beat every 500 ms.
    launchBoundary: (grid, nowMs) => Math.ceil((nowMs + 0.001) / (500 * grid)) * 500 * grid,
    onAllReleased: () => { t.allReleased++; },
  };
  const store = createLiveTakeover(deps);
  return { t, store };
}

const blueRow = { kind: 'vjRow', deck: 'A', row: 1 } as const;

describe('engage and release', () => {
  it('takes a surface over at full level and hands it back instantly', () => {
    const { t, store } = harness();
    expect(store.engage('wall', blueRow, { trackId: 'trk' })).toBe(true);
    let f = store.tick();
    expect(f.frame.surfaces).toEqual([expect.objectContaining({ surfaceId: 'wall', trackId: 'trk', level: 1 })]);
    expect(f.frame.needsVjFeeds).toBe(true);
    t.now += 100;
    expect(store.release('wall', { mode: 'instant' })).toBe(1);
    f = store.tick();
    expect(f.frame.surfaces).toEqual([]);
    expect(store.state.surfaces).toEqual({});
    expect(t.allReleased).toBe(1);
  });

  it('fades out over the release fade', () => {
    const { t, store } = harness();
    store.engage('wall', blueRow);
    store.release('wall', { mode: 'fade', fadeSeconds: 1 });
    t.now += 500;
    expect(store.tick().frame.surfaces[0].level).toBeCloseTo(0.5, 6);
    t.now += 400;
    expect(store.tick().frame.surfaces[0].level).toBeCloseTo(0.1, 6);
    t.now += 200;
    expect(store.tick().frame.surfaces).toEqual([]);
  });

  it('fades in, and a re-engage mid-release carries on from the level it had', () => {
    const { t, store } = harness();
    store.engage('wall', blueRow, { fadeIn: 2 });
    t.now += 500;
    expect(store.tick().frame.surfaces[0].level).toBeCloseTo(0.25, 6);
    t.now += 1500;
    store.tick();
    expect(store.state.surfaces.wall.phase).toBe('live');
    store.release('wall', { mode: 'fade', fadeSeconds: 1 });
    t.now += 600;
    expect(store.tick().frame.surfaces[0].level).toBeCloseTo(0.4, 6);
    store.engage('wall', { kind: 'black' }, { fadeIn: 1 });
    expect(store.tick().frame.surfaces[0].level).toBeCloseTo(0.4, 6);
    t.now += 500;
    expect(store.tick().frame.surfaces[0].level).toBeCloseTo(0.7, 6);
  });

  it('same source keeps the source key; a new source gets a new one', () => {
    const { store } = harness();
    store.engage('wall', blueRow);
    const k1 = store.tick().frame.surfaces[0].key;
    store.engage('wall', blueRow);
    expect(store.tick().frame.surfaces[0].key).toBe(k1);
    store.engage('wall', { kind: 'black' });
    expect(store.tick().frame.surfaces[0].key).not.toBe(k1);
  });

  it("release 'all' takes the overlay away too", () => {
    const { store } = harness();
    store.engage('a', blueRow);
    store.engage('b', { kind: 'vjMix' });
    store.setOverlay({ level: 0.5 });
    expect(store.tick().frame.overlay?.level).toBe(0.5);
    expect(store.release('all', { mode: 'instant' })).toBe(2);
    const f = store.tick().frame;
    expect(f.surfaces).toEqual([]);
    expect(f.overlay).toBeNull();
  });

  it('labels its sources', () => {
    expect(takeoverSourceLabel(blueRow)).toBe('VJ A2');
    expect(takeoverSourceLabel({ kind: 'vjMix' })).toBe('VJ mix');
    expect(takeoverSourceLabel({ kind: 'black' })).toBe('Black');
    expect(takeoverSourceLabel({ kind: 'vjGroup', groupId: 'g', name: 'Left' })).toBe('Left');
  });
});

describe('momentary', () => {
  it('holds while any input holds it and hands back with the last one', () => {
    const { t, store } = harness();
    store.engage('wall', blueRow, { inputId: 'note:60', momentary: true });
    store.engage('wall', blueRow, { inputId: 'note:61', momentary: true });
    expect(store.state.surfaces.wall.momentaryInputs).toEqual(['note:60', 'note:61']);
    expect(store.releaseInput('wall', 'note:60')).toBe(false);
    expect(store.state.surfaces.wall.phase).toBe('live');
    store.setDefaultRelease({ mode: 'instant' });
    expect(store.releaseInput('wall', 'note:61')).toBe(true);
    t.now += 16;
    expect(store.tick().frame.surfaces).toEqual([]);
  });

  it('a latched engage ignores note-offs', () => {
    const { store } = harness();
    store.engage('wall', blueRow);
    expect(store.releaseInput('wall', 'note:60')).toBe(false);
    expect(store.state.surfaces.wall.phase).toBe('live');
  });

  it('releaseInputs lets go of every hold from a controller', () => {
    const { store } = harness();
    store.setDefaultRelease({ mode: 'instant' });
    store.engage('a', blueRow, { inputId: 'midi:pad:1', momentary: true });
    store.engage('b', blueRow, { inputId: 'midi:pad:2', momentary: true });
    store.engage('c', blueRow, { inputId: 'key:L', momentary: true });
    store.releaseInputs('midi:');
    store.tick();
    expect(Object.keys(store.state.surfaces)).toEqual(['c']);
  });
});

describe('quantised release', () => {
  const map = createTempoMap(120, 0.25); // bars every 2 s from 0.25 s

  it('finds the next beat, bar and phrase on the tempo map', () => {
    expect(nextShowBoundary(map, 3.0, 'beat')).toBeCloseTo(3.25, 9);
    expect(nextShowBoundary(map, 3.25, 'beat')).toBeCloseTo(3.75, 9);
    expect(nextShowBoundary(map, 3.0, 'bar')).toBeCloseTo(4.25, 9);
    expect(nextShowBoundary(map, 2.25, 'bar')).toBeCloseTo(4.25, 9);
    // Bars 1, 5, 9… : bar 5 starts at 0.25 + 4 × 2.
    expect(nextShowBoundary(map, 3.0, 'phrase')).toBeCloseTo(8.25, 9);
    expect(nextShowBoundary(map, 8.25, 'phrase')).toBeCloseTo(16.25, 9);
    // Before bar 1 the grid carries on backwards.
    expect(nextShowBoundary(map, 0.1, 'bar')).toBeCloseTo(0.25, 9);
  });

  it('a bar release on a playing show waits for the bar and starts exactly on it', () => {
    const { t, store } = harness({ showTime: 3.0, playing: true, tempo: map });
    store.engage('wall', blueRow);
    store.release('wall', { mode: 'bar', fadeSeconds: 0 });
    expect(store.state.surfaces.wall.phase).toBe('pendingRelease');
    expect(store.state.surfaces.wall.release?.at.showTime).toBeCloseTo(4.25, 9);
    // A frame before the bar: still live.
    t.show = { ...t.show, showTime: 4.24 };
    t.now += 1240;
    expect(store.tick().frame.surfaces[0].level).toBe(1);
    // The first frame past the bar: handed back.
    t.show = { ...t.show, showTime: 4.2567 };
    t.now += 16.7;
    expect(store.tick().frame.surfaces).toEqual([]);
  });

  it('a fade after the bar is timed from the bar, not from the frame that saw it', () => {
    const { t, store } = harness({ showTime: 3.0, playing: true, tempo: map });
    store.engage('wall', blueRow);
    store.release('wall', { mode: 'bar', fadeSeconds: 1 });
    t.show = { ...t.show, showTime: 4.35 }; // 0.1 s past the bar
    t.now += 1350;
    expect(store.tick().frame.surfaces[0].level).toBeCloseTo(0.9, 6);
    expect(store.state.surfaces.wall.release?.startedAtMs).toBeCloseTo(t.now - 100, 6);
  });

  it('falls back to the launch clock with no map, or with the show paused', () => {
    const show: TakeoverShowContext = { showTime: 3, playing: false, tempo: map, markers: [] };
    const launch = (grid: number, now: number) => now + grid * 100;
    expect(releaseTargetFor({ mode: 'bar', fadeSeconds: 0 }, show, 1000, launch)).toEqual({ wallMs: 1400 });
    expect(releaseTargetFor({ mode: 'beat', fadeSeconds: 0 }, { ...show, playing: true, tempo: null }, 1000, launch)).toEqual({ wallMs: 1100 });
    expect(releaseTargetFor({ mode: 'phrase', fadeSeconds: 0 }, { ...show, playing: true, tempo: null }, 1000, launch)).toEqual({ wallMs: 2600 });
    expect(releaseTargetFor({ mode: 'fade', fadeSeconds: 1 }, show, 1000, launch)).toBeNull();
  });

  it('a launch-clock release lands on the wall-clock boundary', () => {
    const { t, store } = harness();
    t.now = 1100;
    store.engage('wall', blueRow);
    store.release('wall', { mode: 'bar', fadeSeconds: 0 });
    expect(store.state.surfaces.wall.release?.at.wallMs).toBe(2000);
    t.now = 1990;
    expect(store.tick().frame.surfaces.length).toBe(1);
    t.now = 2001;
    expect(store.tick().frame.surfaces).toEqual([]);
  });

  it('a marker release waits for the next marker the show plays across', () => {
    const { t, store } = harness({ showTime: 5, playing: true, markers: [2, 7.5, 12] });
    store.engage('wall', blueRow);
    store.release('wall', { mode: 'marker', fadeSeconds: 0 });
    expect(store.state.surfaces.wall.release?.at.showTime).toBe(7.5);
    t.show = { ...t.show, showTime: 7.51 };
    expect(store.tick().frame.surfaces).toEqual([]);
  });

  it('aims again after a seek back', () => {
    const { t, store } = harness({ showTime: 3.0, playing: true, tempo: map });
    store.engage('wall', blueRow);
    store.release('wall', { mode: 'bar', fadeSeconds: 0 });
    t.show = { ...t.show, showTime: 0.5 };
    store.tick();
    expect(store.state.surfaces.wall.release?.at.showTime).toBeCloseTo(2.25, 9);
  });

  it('a seek far past a pending release still fades (it starts at the seek, not long before)', () => {
    const { t, store } = harness({ showTime: 3.0, playing: true, tempo: map });
    store.engage('wall', blueRow);
    store.release('wall', { mode: 'bar', fadeSeconds: 1 });
    expect(store.state.surfaces.wall.release?.at.showTime).toBeCloseTo(4.25, 9);
    // The operator seeks forward to 30 s.
    t.show = { ...t.show, showTime: 30 };
    t.now += 20;
    let f = store.tick();
    expect(store.state.surfaces.wall.phase).toBe('releasing');
    expect(f.frame.surfaces[0].level).toBeGreaterThan(0.7);
    t.now += 500;
    f = store.tick();
    expect(f.frame.surfaces[0].level).toBeGreaterThan(0.2);
    expect(f.frame.surfaces[0].level).toBeLessThan(0.8);
    t.now += 600;
    expect(store.tick().frame.surfaces).toEqual([]);
  });

  it('an instant release overrides a pending one; cancelRelease goes back to live', () => {
    const { store } = harness({ showTime: 3.0, playing: true, tempo: map });
    store.engage('a', blueRow);
    store.engage('b', blueRow);
    store.release('all', { mode: 'bar' });
    expect(store.cancelRelease('a')).toBe(true);
    expect(store.state.surfaces.a.phase).toBe('live');
    store.release('b', { mode: 'instant' });
    store.tick();
    expect(Object.keys(store.state.surfaces)).toEqual(['a']);
  });
});

describe('underneath', () => {
  it("'pause' pauses the show on the first engage and resumes it when the last release starts", () => {
    const { t, store } = harness({ showTime: 10, playing: true });
    expect(store.setUnderneath('pause')).toBe(true);
    store.engage('a', blueRow);
    store.engage('b', blueRow);
    expect(t.paused).toBe(1);
    expect(store.state.pausedAt).toBe(10);
    store.release('a', { mode: 'instant' });
    expect(t.played).toBe(0);
    store.release('b', { mode: 'fade', fadeSeconds: 1 });
    expect(t.played).toBe(1);
    expect(t.show.showTime).toBe(10);
    expect(store.state.pausedAt).toBeUndefined();
  });

  it("'run' keeps the show going", () => {
    const { t, store } = harness({ showTime: 10, playing: true });
    store.engage('a', blueRow);
    store.release('a', { mode: 'instant' });
    expect(t.paused + t.played).toBe(0);
  });

  it("'pause' is refused while the show follows a clock, and a chased show is not paused", () => {
    const { t, store } = harness({ showTime: 10, playing: true });
    t.chasing = true;
    expect(store.setUnderneath('pause')).toBe(false);
    expect(store.state.underneath).toBe('run');
    t.chasing = false;
    store.setUnderneath('pause');
    t.chasing = true;
    store.engage('a', blueRow);
    expect(t.paused).toBe(0);
  });

  it("'pause': the user's Stop while taken over wins; Return does not start the show from 0", () => {
    const { t, store } = harness({ showTime: 10, playing: true });
    store.setUnderneath('pause');
    store.engage('a', blueRow);
    expect(t.paused).toBe(1);
    // The operator stops the show (it goes to 0), then hands back.
    t.show = { ...t.show, showTime: 0, playing: false };
    store.release('a', { mode: 'instant' });
    expect(t.played).toBe(0);
    expect(t.show).toMatchObject({ showTime: 0, playing: false });
    expect(store.state.pausedAt).toBeUndefined();
  });

  it("'pause': a show the user already started again is left running at the hand-back", () => {
    const { t, store } = harness({ showTime: 10, playing: true });
    store.setUnderneath('pause');
    store.engage('a', blueRow);
    t.show = { ...t.show, showTime: 12, playing: true };
    store.release('a', { mode: 'fade', fadeSeconds: 1 });
    expect(t.played).toBe(0);
    expect(store.state.pausedAt).toBeUndefined();
  });

  it("'pause': engaging B while A fades out pauses the show again", () => {
    const { t, store } = harness({ showTime: 10, playing: true });
    store.setUnderneath('pause');
    store.engage('a', blueRow);
    store.release('a', { mode: 'fade', fadeSeconds: 1 });
    expect(t.played).toBe(1);
    t.now += 200;
    t.show = { ...t.show, showTime: 10.2 };
    store.engage('b', blueRow);
    expect(t.paused).toBe(2);
    expect(t.show.playing).toBe(false);
    expect(store.state.pausedAt).toBe(10.2);
    store.release('b', { mode: 'instant' });
    expect(t.played).toBe(2);
  });

  it("switching to 'run' mid-takeover resumes a paused show", () => {
    const { t, store } = harness({ showTime: 4, playing: true });
    store.setUnderneath('pause');
    store.engage('a', blueRow);
    store.setUnderneath('run');
    expect(t.played).toBe(1);
  });
});

describe('pure evaluation and summary', () => {
  it('evaluateTakeover returns the same state when nothing moves', () => {
    const s = createTakeoverState();
    const ev = evaluateTakeover(s, { showTime: 0, playing: false, tempo: null, markers: [] }, 0);
    expect(ev.next).toBe(s);
    expect(ev.frame).toEqual({ surfaces: [], overlay: null, needsVjFeeds: false });
  });

  it('media and black do not need the VJ feeds; an overlay of the mix does', () => {
    const { store } = harness();
    store.engage('a', { kind: 'black' });
    expect(store.tick().frame.needsVjFeeds).toBe(false);
    store.setOverlay({ level: 0.3 });
    expect(store.tick().frame.needsVjFeeds).toBe(true);
  });

  it('effects only: no source, the surface keeps its picture', () => {
    const { store } = harness();
    store.addTempEffect('a', { id: 'fx1', type: 'invert', enabled: true, params: {} } as any, 'trk');
    expect(store.tick().frame.surfaces[0]).toMatchObject({ source: null, effects: [{ id: 'fx1' }] });
    store.removeTempEffect('a', 'fx1');
    expect(store.tick().frame.surfaces).toEqual([]);
  });

  it('summarises for other windows', () => {
    const { store } = harness({ showTime: 3, playing: true, tempo: createTempoMap(120, 0) });
    store.engage('a', blueRow, { trackId: 't1' });
    store.engage('b', { kind: 'vjMix' }, { trackId: 't2' });
    store.release('b', { mode: 'bar' });
    const sum = takeoverSummary(store.state);
    expect(sum).toMatchObject({ active: true, count: 2, pending: 1, underneath: 'run', overlay: null });
    expect(sum.surfaces.map((s) => [s.label, s.phase])).toEqual([['VJ A2', 'live'], ['VJ mix', 'pendingRelease']]);
    expect(sum.surfaces[1].releaseAtShowTime).toBeCloseTo(4, 9);
    expect(JSON.parse(JSON.stringify(sum))).toEqual(sum);
  });

  it('reset ends every takeover and keeps the preferences', () => {
    const { store } = harness();
    store.setMarkerPolicy('hold');
    store.setDefaultRelease({ mode: 'bar' });
    store.engage('a', blueRow);
    store.reset();
    expect(store.state.surfaces).toEqual({});
    expect(store.state.markerPolicy).toBe('hold');
    expect(store.state.defaultRelease.mode).toBe('bar');
  });
});
