import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { derived, get, writable } from 'svelte/store';

const state = writable({ layers: [], selectedLayerId: null });
vi.mock('../../stores/layers', () => ({
  project: { subscribe: state.subscribe, selectLayer: () => {} },
  layers: derived(state, (s) => s.layers),
  selectedLayerId: derived(state, (s) => s.selectedLayerId),
}));
const bridgeState = writable({ connected: true, protocol: 5, quantize: 4, numerator: 4, denominator: 4, tracks: [{ name: 'Bass', color: 0, slots: [{ name: 'A', color: 0, length: 4 }, { name: 'B', color: 0, length: 4 }] }] });
vi.mock('../../ableton/abletonBridge', () => ({
  abletonBridge: { subscribe: bridgeState.subscribe, liveParamValue: () => null, liveLevelValue: () => null, watchLiveSources: () => {}, launchClip: () => {}, stopTrack: () => {}, stopAllClips: () => {} },
}));
const { showTimeline, setShowCompositionLoader, setShowAudioClockReader, setShowTrackFrameSink } = await import('../../stores/showTimeline');
const { addRow, bindLiveTrack, removeRow } = await import('./soundCommands');
const { installTimelineSound, setLiveSender } = await import('./soundEngine');
import { createTempoMap } from '../../show/tempoMap';

let frames: Array<(now: number) => void> = [];
let wall = 0;
function frame(ms = 16) { wall += ms; const p = frames; frames = []; for (const cb of p) cb(wall); }
function playFor(s: number) { for (let i = 0; i < Math.round(s * 1000 / 16); i++) frame(); }
let got: any[] = [];
let liveRowId = '';
let uninstall: (() => void) | null = null;

beforeEach(() => {
  showTimeline._resetForTest();
  setShowCompositionLoader(() => {});
  setShowTrackFrameSink(() => {});
  setShowAudioClockReader(null);
  vi.stubGlobal('requestAnimationFrame', (cb: (now: number) => void) => { frames.push(cb); return frames.length; });
  vi.stubGlobal('cancelAnimationFrame', () => { frames = []; });
  got = [];
  setLiveSender((c) => got.push({ t: +get(showTimeline).currentTime.toFixed(2), doc: get(showTimeline).doc, c }));
  uninstall = installTimelineSound();
  showTimeline.openDoc('timeline');
  showTimeline.setTempo?.(createTempoMap(120, 0));
  const live = addRow('live'); liveRowId = live;
  const rows = get(showTimeline).sound.rows;
  const lane = rows.findIndex((r: any) => r.id === live);
  bindLiveTrack(live, 0, 'Bass');
  showTimeline.setSound({ ...get(showTimeline).sound, live: [{ id: 'c1', lane, startTime: 0.5, duration: 30, slot: 0, clipName: 'A', color: 0 }] });
});
afterEach(() => { uninstall?.(); setLiveSender(null); showTimeline._resetForTest(); vi.unstubAllGlobals(); });

const kinds = () => got.map((g) => g.c.t);

describe('the Live clips the Timeline started stop when it lets go of them', () => {
  it('internal play, then the Show tab: stop_all', () => {
    showTimeline.play(); playFor(1.5);
    showTimeline.activateDoc('show');
    frame();
    expect(kinds()).toEqual(['fire_clip', 'stop_all']);
  });

  it('following an outside clock, then the Show tab: stop_all', () => {
    for (let t = 0; t < 1.5; t += 1 / 60) showTimeline.chase(t, true);
    showTimeline.activateDoc('show');
    for (let t = 1.5; t < 3; t += 1 / 60) showTimeline.chase(t, true);
    expect(kinds()).toEqual(['fire_clip', 'stop_all']);
  });

  it('a new file while the Timeline plays: stop_all', () => {
    showTimeline.play(); playFor(1.5);
    showTimeline.hydrate(null);
    frame(); playFor(0.5);
    expect(kinds()).toEqual(['fire_clip', 'stop_all']);
  });

  it('the Live row removed while its clip plays: the clip stops', () => {
    showTimeline.play(); playFor(1.5);
    removeRow(liveRowId);
    playFor(1);
    expect(kinds()).toEqual(['fire_clip', 'stop_track']);
    showTimeline.pause(); frame();
    expect(kinds().length).toBeLessThanOrEqual(3);
  });

  it('the playing block deleted: the clip stops at once', () => {
    showTimeline.play(); playFor(1.5);
    showTimeline.setSound({ ...get(showTimeline).sound, live: [{ id: 'c2', lane: get(showTimeline).sound.live[0].lane, startTime: 40, duration: 4, slot: 1, clipName: 'B', color: 0 }] });
    playFor(0.2);
    expect(kinds()).toEqual(['fire_clip', 'stop_track']);
  });

  it('Live reconnecting mid-block fires the block again where the playhead is', () => {
    showTimeline.play(); playFor(1.5);
    bridgeState.update((b) => ({ ...b, connected: false }));
    playFor(0.5);
    bridgeState.update((b) => ({ ...b, connected: true }));
    playFor(0.5);
    const fires = got.filter((g) => g.c.t === 'fire_clip');
    expect(fires).toHaveLength(2);
    expect(fires[1].c.pos).toBeGreaterThan(0);
  });
});
