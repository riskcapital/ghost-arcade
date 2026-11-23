import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

const clock = { beat: 0, beatMs: 500 };
vi.mock('../stores/launchClock', () => ({
  launchClockPosition: () => ({ ...clock }),
  launchClockTempo: () => 60000 / clock.beatMs,
  resyncLaunchClock: () => {
    clock.beat = 0;
    return true;
  },
}));

import { musicStudio } from './musicStudioStore';
import {
  _resetStationForTests,
  _trackRuntime,
  attachLoopStation,
  captureSourceHit,
  captureSourceRelease,
  captureXyMove,
  clearLoopTrack,
  killLoopStation,
  loadUserLoopToTrack,
  pressLoopTrack,
  saveLoopTrack,
  scheduleStation,
  setLoopTrackSound,
  stopLoopTrack,
  undoLoopLayer,
} from './loopStation';
import { normalizeStationData } from './loopTrack';
import { memoryBackend, setUserLoopsBackend } from './userLoops';
import type { PlayedNote } from './loopRecorder';
import type { NoteEvent } from './noteEvents';

let notes: PlayedNote[] = [];
let sent: NoteEvent[] = [];
let moves: Array<{ x: number; y: number; time: number; track: number }> = [];
let letGo: number[] = [];
let hits: Array<{ source: string; index: number; velocity: number; time: number; dur: number; track: number }> = [];

function attach() {
  attachLoopStation({
    send: (e) => sent.push(e),
    now: () => (clock.beat * clock.beatMs) / 1000,
    click: () => {},
    played: () => notes,
    clockBusy: () => true,
    wake: () => {},
    audioTracks: () => null,
    moveXy: (x, y, time, track) => moves.push({ x, y, time, track }),
    letGoXy: (track) => letGo.push(track),
    hit: (source, index, velocity, time, dur, track) => hits.push({ source, index, velocity, time, dur, track }),
  });
}

function runTo(beat: number) {
  while (clock.beat < beat) {
    clock.beat = Math.min(beat, clock.beat + 0.25);
    scheduleStation(0.12);
  }
}

const track0 = () => get(musicStudio).loopStation.tracks[0];
/** The XY pad played as it plays: each new note first, then the one before let go at the same beat. */
function glide(from: number, pitches: number[], step = 1) {
  pitches.forEach((note, k) => {
    const beat = from + k * step;
    notes.push({ instrument: 'xy', note, velocity: 0.7, beat, end: k === pitches.length - 1 ? beat + step : beat + step });
    captureXyMove(k / pitches.length, 0.25 + k * 0.1, beat);
  });
}

beforeEach(() => {
  _resetStationForTests();
  musicStudio.hydrate(null);
  musicStudio.setInstrument?.('keys');
  musicStudio.setSet('bath');
  musicStudio.updateLoopStation((d) => ({ ...d, length: 4, countIn: 1 }));
  musicStudio.setQuantize('off');
  clock.beat = 0.5;
  notes = [];
  sent = [];
  moves = [];
  letGo = [];
  hits = [];
  attach();
});

describe('an XY loop', () => {
  it('"This tab" on the Sound bath records the XY pad: notes and the puck', () => {
    expect(track0().instrument).toBeNull();
    pressLoopTrack(0);
    runTo(4);
    glide(4, [60, 62, 64]);
    runTo(20);
    expect(_trackRuntime(0).phase).toBe('play');
    expect(track0()).toMatchObject({ source: 'xy', instrument: 'xy', name: 'XY' });
    expect(track0().layers[0].map((n) => n.note)).toEqual([60, 62, 64]);
    expect(track0().xy?.[0].map((p) => p.beat)).toEqual([0, 1, 2]);
  });

  it('plays back gliding as played, moves the puck on time, and keeps going on another tab', () => {
    pressLoopTrack(0);
    runTo(4);
    glide(4, [60, 62]);
    musicStudio.setSet('dub');
    sent = [];
    runTo(24);
    const xy = sent.filter((e) => e.instrument === 'xy');
    // Pass two starts on beat 20: the new note goes out before the old one lets go.
    const at21 = xy.filter((e) => Math.abs(e.time - 21 * 0.5) < 1e-6);
    expect(at21.map((e) => e.type)).toEqual(['on', 'off']);
    expect(at21[0].note).toBe(62);
    expect(xy.every((e) => e.loopTrack === 0 && e.insertChannel === 'loop:0' && e.source === 'sequencer')).toBe(true);
    expect(moves.filter((m) => m.time >= 10).map((m) => m.time)).toEqual([10, 10.5]);
    expect(moves[0]).toMatchObject({ x: 0, y: 0.25, track: 0 });
  });

  it('lets go of the XY note and the arp when stopped or killed', () => {
    pressLoopTrack(0);
    runTo(4);
    glide(4, [60, 62]);
    runTo(21.2);
    stopLoopTrack(0, true);
    expect(letGo).toEqual([0]);
    // The note held across the stop is let go.
    expect(sent.filter((e) => e.type === 'off').at(-1)?.note).toBe(62);
    pressLoopTrack(0);
    runTo(30);
    killLoopStation();
    expect(letGo).toEqual([0, 0]);
    expect(_trackRuntime(0).phase).toBe('stopped');
  });

  it('keeps its points with each overdub layer, through undo and Clear', () => {
    musicStudio.updateLoopTrack(0, { afterRecord: 'overdub' });
    setLoopTrackSound(0, { instrument: 'xy', source: 'xy' });
    pressLoopTrack(0);
    runTo(4);
    glide(4, [60]);
    runTo(20);
    glide(22, [67]);
    runTo(36.5);
    expect(track0().layers).toHaveLength(2);
    expect(track0().xy).toHaveLength(2);
    expect(track0().xy?.[1][0].beat).toBe(2);
    undoLoopLayer(0);
    expect(track0().xy).toHaveLength(1);
    clearLoopTrack(0);
    expect(track0().xy).toEqual([]);
    undoLoopLayer(0);
    expect(track0().xy).toHaveLength(1);
    // Kept with the project.
    const again = normalizeStationData(JSON.parse(JSON.stringify(get(musicStudio).loopStation)));
    expect(again.tracks[0].xy?.[0][0]).toMatchObject({ beat: 0, x: 0 });
  });

  it('"This tab" on another tab records the keys as before', () => {
    musicStudio.setSet('berlin');
    pressLoopTrack(0);
    runTo(4);
    notes.push({ instrument: 'keys', note: 60, velocity: 0.8, beat: 4, end: 4.5 });
    glide(6, [60]);
    runTo(20);
    expect(track0().source).toBeUndefined();
    expect(track0().instrument).toBe('keys');
    expect(track0().layers[0]).toHaveLength(1);
  });

  it('an XY pad left untouched on the Sound bath records the keys', () => {
    pressLoopTrack(0);
    runTo(4);
    notes.push({ instrument: 'keys', note: 60, velocity: 0.8, beat: 4, end: 4.5 });
    runTo(20);
    expect(track0().source).toBeUndefined();
    expect(track0().instrument).toBe('keys');
  });

  it('saves to My loops with its points and loads back as an XY loop', async () => {
    setUserLoopsBackend(memoryBackend(null));
    pressLoopTrack(0);
    runTo(4);
    glide(4, [60, 64]);
    runTo(20);
    const id = await saveLoopTrack(0);
    expect(id).toBeTruthy();
    // No session clip for it: only the looper plays it.
    expect(JSON.stringify(get(musicStudio).session)).not.toContain('"xy"');
    clearLoopTrack(0);
    setLoopTrackSound(0, { instrument: 'keys' });
    expect(await loadUserLoopToTrack(id!)).toBe(0);
    expect(track0()).toMatchObject({ source: 'xy', instrument: 'xy' });
    expect(track0().xy?.[0]).toHaveLength(2);
  });
});

describe('dub shot and drum pad loops', () => {
  it('"This tab" on the Dub set records the shots as hits, each as long as it was held', () => {
    musicStudio.setSet('dub');
    pressLoopTrack(0);
    runTo(4);
    captureSourceHit('dub', 3, 0.9, 4);
    captureSourceRelease('dub', 3, 6);
    captureSourceHit('dub', 0, 0.5, 9);
    runTo(20);
    expect(track0()).toMatchObject({ source: 'dub', instrument: 'shots', name: 'Dub shots' });
    expect(track0().layers[0].map((n) => [n.beat, n.note, n.dur])).toEqual([[0, 3, 2], [5, 0, 11]]);
    runTo(26);
    // Played on the shots themselves, not as notes.
    expect(hits.filter((h) => h.time >= 10).map((h) => [h.source, h.index, h.time])).toEqual([['dub', 3, 10], ['dub', 0, 12.5]]);
    expect(hits[0].dur).toBeCloseTo(1);
    expect(sent.filter((e) => e.loopTrack === 0)).toHaveLength(0);
  });

  it('records drum pad taps on the drum machine tab, quantized, and plays them at the fader', () => {
    musicStudio.setSet('machine');
    musicStudio.setQuantize('1/16');
    musicStudio.updateLoopTrack(0, { level: 0.5 });
    pressLoopTrack(0);
    runTo(4);
    captureSourceHit('pads', 0, 1, 4.02);
    captureSourceHit('pads', 5, 0.8, 6.49);
    runTo(20);
    expect(track0()).toMatchObject({ source: 'pads', instrument: 'drums' });
    expect(track0().layers[0].map((n) => [n.beat, n.note])).toEqual([[0, 0], [2.5, 5]]);
    runTo(24);
    expect(hits.map((h) => [h.source, h.index, h.velocity])).toEqual([['pads', 0, 0.5], ['pads', 5, 0.4]]);
  });

  it('a pads track chosen by hand records only the pads, on any tab', () => {
    musicStudio.setSet('berlin');
    setLoopTrackSound(0, { instrument: 'drums', source: 'pads' });
    pressLoopTrack(0);
    runTo(4);
    notes.push({ instrument: 'keys', note: 60, velocity: 0.8, beat: 4, end: 4.5 });
    captureSourceHit('pads', 2, 1, 5);
    captureSourceHit('dub', 1, 1, 6);
    runTo(20);
    expect(track0().layers[0].map((n) => n.note)).toEqual([2]);
    // Kept with the project.
    const again = normalizeStationData(JSON.parse(JSON.stringify(get(musicStudio).loopStation)));
    expect(again.tracks[0]).toMatchObject({ source: 'pads', instrument: 'drums' });
  });

  it('saves to My loops and loads back as a pads loop', async () => {
    setUserLoopsBackend(memoryBackend(null));
    setLoopTrackSound(0, { instrument: 'drums', source: 'pads' });
    pressLoopTrack(0);
    runTo(4);
    captureSourceHit('pads', 1, 1, 4);
    runTo(20);
    const id = await saveLoopTrack(0);
    clearLoopTrack(0);
    setLoopTrackSound(0, { instrument: 'keys' });
    expect(await loadUserLoopToTrack(id!)).toBe(0);
    expect(track0()).toMatchObject({ source: 'pads', instrument: 'drums' });
    expect(track0().layers[0][0].note).toBe(1);
  });
});
