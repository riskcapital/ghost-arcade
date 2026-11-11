/**
 * Phrases and Live (a fake Live behind the Live scheduler): a phrase's Live
 * clips go out ahead of its bar, each inside its row's grid step, and the
 * tracks the old phrase leaves are stopped just before it; the landing does
 * not fire them again; the playing phrase fires nothing past its last bar; a
 * section's Live scene fires on the beat before its start (played into, or
 * launched as a phrase); a Live scene linked to a phrase launches it at once
 * without sending its clips again; an old script gets the set's quantise.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import type { Layer } from '../../types';
import {
  onShowFrame,
  setShowAudioClockReader,
  setShowCompositionLoader,
  setShowPhraseEffects,
  setShowTrackFrameSink,
  showTimeline,
} from '../../stores/showTimeline';
import { createTempoMap } from '../../show/tempoMap';
import type { AbletonBridgeState } from '../../ableton/abletonBridge';
import { fireLead, LIVE_Q_NONE, LIVE_Q_QUARTER, LiveClipScheduler, type LiveCommand } from '../sound/liveSchedule';
import type { TimelineSection } from '../sections/sectionModel';
import { _resetPhraseRuntime, handlePhraseEvent, resolveSceneIndex, sceneLaunch, sceneTick, setPhraseLiveOut, setPhraseRuntimeClock } from './phraseRuntime';

// The runtime's heavy neighbours (the VJ decks, the bridge, the sound
// engine) are stood in for: the test hands it its own scheduler and bridge.
vi.mock('../../stores/vjClipLauncher', async () => {
  const { writable } = await import('svelte/store');
  const s = writable({ quantization: '1bar', isOpen: false, isLive: false });
  return { vjClipLauncher: { subscribe: s.subscribe, setLive: (v: boolean) => s.update((x) => ({ ...x, isLive: v })) } };
});
vi.mock('../../ableton/abletonBridge', async () => {
  const { writable } = await import('svelte/store');
  return { abletonBridge: { ...writable({}), launchScene: () => {} }, LIVE_PHRASE_PROTOCOL: 6, setPhraseLinkLauncher: () => {} };
});
vi.mock('../sound/soundEngine', () => ({ liveSchedulerNow: () => { throw new Error('the test scheduler is set'); } }));

let frames: Array<(now: number) => void> = [];
let wall = 0;
let timers: Array<{ fn: () => void; at: number }> = [];
/** Every request "Live" got, with the wall time and the show time. */
let got: Array<{ at: number; show: number; cmd: LiveCommand | { t: 'fire_scene'; s: number; q?: number } }> = [];

function frame(ms = 10) {
  for (let i = 0; i < ms; i++) {
    wall += 1;
    vi.advanceTimersByTime(1);
    const due = timers.filter((t) => t.at <= wall);
    timers = timers.filter((t) => t.at > wall);
    for (const t of due) t.fn();
  }
  const pending = frames;
  frames = [];
  for (const cb of pending) cb(wall);
}
function playFor(seconds: number, ms = 10) {
  for (let i = 0; i < Math.round((seconds * 1000) / ms); i++) frame(ms);
}

const layer = (id: string): Layer => ({ id, name: id, type: 'media', visible: true, opacity: 1, blendMode: 'normal', source: null } as unknown as Layer);
const sec = (id: string, start: number, end: number, extra: Partial<TimelineSection> = {}): TimelineSection =>
  ({ id, name: id.toUpperCase(), color: '#5b8def', start, end, action: 'vamp', phrase: { end: 'loop' }, ...extra });

const bridge = (protocol = 6): AbletonBridgeState => ({
  connected: true, protocol, quantize: 4, numerator: 4, denominator: 4, tempo: 120,
  scenes: [{ name: 'Intro', color: 0, queued: false }, { name: 'Drop', color: 0, queued: false }],
} as unknown as AbletonBridgeState);

let scheduler: LiveClipScheduler;
let offFrame: (() => void) | null = null;

function setup(sections: TimelineSection[], protocol = 6) {
  showTimeline.hydrate({
    version: 8, activeDoc: 'timeline', audioTracks: [], presetClips: [],
    timeline: { version: 8, audioTracks: [], presetClips: [], sections, tempo: createTempoMap(120, 0) },
  });
  showTimeline.syncStageRows([layer('A')], []);
  scheduler = new LiveClipScheduler({ send: (cmd) => got.push({ at: wall, show: get(showTimeline).currentTime, cmd }), now: () => wall });
  scheduler.setEnv({ tempo: createTempoMap(120, 0), setQuantize: 4, numerator: 4, denominator: 4, protocol });
  // Two Live rows: drums (beat launch) and bass (bar launch), a clip per phrase.
  scheduler.setBlocks(
    [
      { rowId: 'drums', track: 0, launch: 'beat', latency: 0.02, audible: true },
      { rowId: 'bass', track: 1, launch: 'bar', latency: 0.02, audible: true },
    ],
    [
      { id: 'a-drums', rowId: 'drums', start: 0, end: 8, slot: 0 },
      { id: 'a-bass', rowId: 'bass', start: 0, end: 8, slot: 0 },
      { id: 'b-drums', rowId: 'drums', start: 8, end: 16, slot: 1 },
    ],
  );
  const b = bridge(protocol);
  setPhraseLiveOut({
    scheduler: () => scheduler,
    bridge: () => b,
    fireScene: (s, q) => got.push({ at: wall, show: get(showTimeline).currentTime, cmd: { t: 'fire_scene', s, ...(q !== undefined ? { q } : {}) } }),
  });
  offFrame = onShowFrame((t) => {
    scheduler.tick(t.time, t.playing, t.seek);
    sceneTick(t);
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  showTimeline._resetForTest();
  _resetPhraseRuntime();
  setShowCompositionLoader(() => {});
  frames = [];
  timers = [];
  got = [];
  wall = 10_000;
  vi.stubGlobal('requestAnimationFrame', (cb: (now: number) => void) => { frames.push(cb); return frames.length; });
  vi.stubGlobal('cancelAnimationFrame', () => { frames = []; });
  setShowAudioClockReader(null);
  showTimeline._setSectionClock(() => wall / 1000);
  showTimeline._setPhraseClock(() => wall, (fn, ms) => { const t = { fn, at: wall + ms }; timers.push(t); return t; }, (h) => { timers = timers.filter((t) => t !== h); });
  setPhraseRuntimeClock(() => wall);
  setShowPhraseEffects(handlePhraseEvent);
  setShowTrackFrameSink(() => {});
});
afterEach(() => {
  offFrame?.();
  offFrame = null;
  setShowPhraseEffects(null);
  setShowTrackFrameSink(null);
  setShowCompositionLoader(null);
  setPhraseLiveOut(null);
  setPhraseRuntimeClock(null);
  _resetPhraseRuntime();
  showTimeline._resetForTest();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const cmds = () => got.map((g) => g.cmd);

describe('a phrase fires its Live clips ahead of its bar', () => {
  it('from stopped: each row inside its own grid step before the bar; the landing sends nothing again', () => {
    setup([sec('a', 0, 8), sec('b', 8, 16)]);
    const bar = wall + 2000;
    showTimeline.launchPhrase('a', { delay: 2 });
    playFor(0.9);
    expect(cmds()).toEqual([]);
    playFor(1.3);
    const drums = got.find((g) => g.cmd.t === 'fire_clip' && g.cmd.i === 0)!;
    const bass = got.find((g) => g.cmd.t === 'fire_clip' && g.cmd.i === 1)!;
    expect(drums.cmd).toEqual({ t: 'fire_clip', i: 0, s: 0, q: LIVE_Q_QUARTER });
    expect(bass.cmd).toEqual({ t: 'fire_clip', i: 1, s: 0, q: 4 });
    // Drums inside the beat before the bar, bass inside the bar before it.
    expect(bar - drums.at).toBeGreaterThan(0.12 * 1000);
    expect(bar - drums.at).toBeLessThan(500);
    expect(Math.abs(bar - drums.at - fireLead(0.5, 0.02) * 1000)).toBeLessThanOrEqual(5);
    expect(Math.abs(bar - bass.at - fireLead(2, 0.02) * 1000)).toBeLessThanOrEqual(5);
    expect(get(showTimeline).isPlaying).toBe(true);
    // Playing into the phrase: no second fire of the same clips.
    playFor(1);
    expect(cmds().filter((c) => c.t === 'fire_clip')).toHaveLength(2);
  });

  it('hand-over while playing: the next phrase\'s clip before its bar, a stop for the track it leaves, nothing past the cut', () => {
    setup([sec('a', 0, 8), sec('b', 8, 16)]);
    showTimeline.launchPhrase('a', { delay: 0 });
    playFor(1);
    got = [];
    const bar = wall + 1000;
    showTimeline.launchPhrase('b', { delay: 1 });
    playFor(1.2);
    expect(showTimeline.phraseState().activeId).toBe('b');
    const fire = got.find((g) => g.cmd.t === 'fire_clip')!;
    expect(fire.cmd).toEqual({ t: 'fire_clip', i: 0, s: 1, q: LIVE_Q_QUARTER });
    expect(Math.abs(bar - fire.at - fireLead(0.5, 0.02) * 1000)).toBeLessThanOrEqual(5);
    const stop = got.find((g) => g.cmd.t === 'stop_track')!;
    expect(stop.cmd).toEqual({ t: 'stop_track', i: 1, q: LIVE_Q_NONE });
    expect(bar - stop.at).toBeGreaterThan(0);
    expect(bar - stop.at).toBeLessThan(150);
    // A's own end (stop at 8 s) never went out, nor a refire on the landing.
    playFor(1);
    expect(cmds().filter((c) => c.t === 'fire_clip')).toHaveLength(1);
    expect(cmds().filter((c) => c.t === 'stop_track')).toHaveLength(1);
  });

  it('pause stops every clip in Live, as the Timeline does', () => {
    setup([sec('a', 0, 8)]);
    showTimeline.launchPhrase('a', { delay: 0 });
    playFor(0.5);
    showTimeline.pause();
    frame();
    expect(cmds().at(-1)).toEqual({ t: 'stop_all', q: LIVE_Q_NONE });
  });
});

describe('Live scenes', () => {
  it('a section with a Live scene fires it in the beat before its start while the Timeline plays into it', () => {
    setup([sec('a', 0, 4, { action: 'through', phrase: undefined }), sec('b', 4, 8, { action: 'through', phrase: undefined, liveScene: { scene: 1, name: 'Drop' } })]);
    showTimeline.play();
    playFor(5);
    const scenes = got.filter((g) => g.cmd.t === 'fire_scene');
    expect(scenes).toHaveLength(1);
    expect(scenes[0].cmd).toEqual({ t: 'fire_scene', s: 1, q: LIVE_Q_QUARTER });
    expect(4 - scenes[0].show).toBeGreaterThan(0.12);
    expect(4 - scenes[0].show).toBeLessThan(0.5);
  });

  it('launching the phrase fires its scene ahead of the bar, once', () => {
    setup([sec('a', 0, 8), sec('b', 8, 16, { liveScene: { scene: 1, name: 'Drop' } })]);
    showTimeline.launchPhrase('a', { delay: 0 });
    playFor(0.5);
    const bar = wall + 1000;
    showTimeline.launchPhrase('b', { delay: 1 });
    playFor(2);
    const scenes = got.filter((g) => g.cmd.t === 'fire_scene');
    expect(scenes).toHaveLength(1);
    expect(bar - scenes[0].at).toBeGreaterThan(120);
    expect(bar - scenes[0].at).toBeLessThan(500);
  });

  it('scenes are found by name when they moved; an old script gets the set\'s launch quantise', () => {
    const b = bridge(6);
    expect(resolveSceneIndex({ liveScene: { scene: 0, name: 'Drop' } }, b)).toBe(1);
    expect(resolveSceneIndex({ liveScene: { scene: 1, name: 'Gone' } }, b)).toBe(1);
    expect(resolveSceneIndex({ liveScene: { scene: 5, name: 'Gone' } }, b)).toBeNull();
    expect(sceneLaunch(b, 120)).toEqual({ q: LIVE_Q_QUARTER, lead: fireLead(0.5, 0.02) });
    expect(sceneLaunch(bridge(5), 120)).toEqual({ lead: fireLead(2, 0.02) });
  });

  it('a Live scene linked to a phrase launches it at once, and none of its clips or its scene are sent again', () => {
    setup([sec('a', 0, 8, { liveScene: { scene: 0, name: 'Intro' } }), sec('b', 8, 16, { liveScene: { scene: 1, name: 'Drop' } })]);
    showTimeline.launchPhrase('b', { delay: 0, origin: { scene: 1 } });
    expect(get(showTimeline).isPlaying).toBe(true);
    expect(get(showTimeline).currentTime).toBeCloseTo(8, 3);
    playFor(1);
    expect(cmds()).toEqual([]);
  });
});
