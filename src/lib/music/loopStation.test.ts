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
  clearLoopTrack,
  loopStationView,
  pressLoopTrack,
  redoLoopLayer,
  scheduleStation,
  stopLoopTrack,
  undoLoopLayer,
} from './loopStation';
import type { PlayedNote } from './loopRecorder';
import type { NoteEvent } from './noteEvents';

let notes: PlayedNote[] = [];
let sent: NoteEvent[] = [];
let busy = false;

function attach() {
  attachLoopStation({
    send: (e) => sent.push(e),
    now: () => (clock.beat * clock.beatMs) / 1000,
    click: () => {},
    played: () => notes,
    clockBusy: () => busy,
    wake: () => {},
    audioTracks: () => null,
  });
}

/** Move the clock to `beat`, ticking the scheduler every quarter beat on the way. */
function runTo(beat: number) {
  while (clock.beat < beat) {
    clock.beat = Math.min(beat, clock.beat + 0.25);
    scheduleStation(0.12);
  }
}

const play = (beat: number, note = 60) => notes.push({ instrument: 'keys', note, velocity: 0.8, beat, end: beat + 0.5 });
const track0 = () => get(musicStudio).loopStation.tracks[0];

beforeEach(() => {
  _resetStationForTests();
  musicStudio.hydrate(null);
  musicStudio.setInstrument?.('keys');
  musicStudio.updateLoopStation((d) => ({ ...d, length: 4, countIn: 1 }));
  musicStudio.setQuantize('1/16');
  clock.beat = 0.5;
  notes = [];
  sent = [];
  busy = true;
  attach();
});

describe('a MIDI loop track', () => {
  it('records 4 bars from the next bar, then plays them without a gap', () => {
    pressLoopTrack(0);
    expect(_trackRuntime(0).phase).toBe('armed');
    expect(_trackRuntime(0).recStart).toBe(4);
    runTo(4);
    expect(_trackRuntime(0).phase).toBe('record');
    play(4);
    play(10, 64);
    runTo(20);
    expect(_trackRuntime(0).phase).toBe('play');
    expect(track0().beats).toBe(16);
    expect(track0().layers).toHaveLength(1);
    expect(track0().layers[0].map((n) => n.beat)).toEqual([0, 6]);
    // The first note of the second pass went out on beat 20's time.
    const ons = sent.filter((e) => e.type === 'on');
    expect(ons[0].time).toBeCloseTo((20 * 500) / 1000, 6);
  });

  it('overdubs a layer per pass, undoes and redoes it', () => {
    pressLoopTrack(0);
    runTo(4);
    play(4);
    runTo(20);
    pressLoopTrack(0); // punch in on the next bar (24)
    expect(_trackRuntime(0).phase).toBe('overdub');
    runTo(24);
    play(26, 67);
    runTo(36.5);
    expect(track0().layers).toHaveLength(2);
    expect(track0().layers[1][0].beat).toBe(6);
    // A pass with nothing new adds no layer.
    runTo(52.5);
    expect(track0().layers).toHaveLength(2);
    pressLoopTrack(0); // punch out
    runTo(60);
    expect(_trackRuntime(0).phase).toBe('play');
    expect(undoLoopLayer(0)).toBe(true);
    expect(track0().layers).toHaveLength(1);
    expect(get(loopStationView).tracks[0].redo).toBe(1);
    expect(redoLoopLayer(0)).toBe(true);
    expect(track0().layers).toHaveLength(2);
  });

  it('goes straight to overdub when the track says so', () => {
    musicStudio.updateLoopTrack(0, { afterRecord: 'overdub' });
    pressLoopTrack(0);
    runTo(4);
    play(5);
    runTo(20);
    expect(_trackRuntime(0).phase).toBe('overdub');
  });

  it('cancels during the count-in, and Clear is undoable once', () => {
    pressLoopTrack(0);
    pressLoopTrack(0);
    expect(_trackRuntime(0).phase).toBe('empty');
    pressLoopTrack(0);
    runTo(4);
    play(4);
    runTo(20);
    clearLoopTrack(0);
    expect(track0().layers).toHaveLength(0);
    expect(undoLoopLayer(0)).toBe(true);
    expect(track0().layers).toHaveLength(1);
    stopLoopTrack(0, true);
    expect(_trackRuntime(0).phase).toBe('stopped');
  });

  it('closes a free recording on the nearest bar', () => {
    musicStudio.updateLoopStation((d) => ({ ...d, length: 0 }));
    pressLoopTrack(0);
    runTo(4);
    play(4.1);
    runTo(11);
    pressLoopTrack(0);
    expect(_trackRuntime(0).recEnd).toBe(12);
    runTo(13);
    expect(track0().beats).toBe(8);
  });

  it('with nothing playing, a free first loop sets the tempo', () => {
    busy = false;
    musicStudio.updateLoopStation((d) => ({ ...d, length: 0 }));
    const t0 = 1000;
    const nowSpy = vi.spyOn(performance, 'now').mockReturnValue(t0);
    pressLoopTrack(0);
    expect(_trackRuntime(0).phase).toBe('record');
    const start = clock.beat;
    play(start);
    play(start + 3, 64);
    // 4 seconds later (8 beats at 120): 2 bars at 120 BPM.
    nowSpy.mockReturnValue(t0 + 4000);
    clock.beat = start + 8;
    pressLoopTrack(0);
    nowSpy.mockRestore();
    expect(track0().beats).toBe(8);
    expect(track0().layers[0].map((n) => n.beat)).toEqual([0, 3]);
    expect(_trackRuntime(0).phase).toBe('play');
  });
});
