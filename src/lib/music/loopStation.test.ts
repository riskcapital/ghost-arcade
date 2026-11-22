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
  saveLoopTrack,
  loadUserLoopToTrack,
  insertUserLoopInSession,
  quantizeLoopTrack,
  renameLoopTrack,
  setLoopTrackInstrument,
  setLoopTrackSound,
} from './loopStation';
import { normalizeStationData } from './loopTrack';
import { memoryBackend, setUserLoopsBackend, userLoops } from './userLoops';
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

  it('saves to My loops with an auto-name and loads back onto a track', async () => {
    setUserLoopsBackend(memoryBackend(null));
    pressLoopTrack(0);
    runTo(4);
    play(4);
    play(7, 64);
    runTo(20);
    const id = await saveLoopTrack(0);
    expect(id).toBeTruthy();
    const saved = get(userLoops)[0];
    expect(saved.name).toMatch(/^Keys · 4 bars · 120/);
    expect(saved.noteCount).toBe(2);
    clearLoopTrack(0);
    expect(await loadUserLoopToTrack(id!)).toBe(0);
    expect(track0().layers[0].map((n) => n.beat)).toEqual([0, 3]);
    expect(await insertUserLoopInSession(id!)).toBe(true);
  });
});

describe('older projects', () => {
  it('load with six empty loop tracks, keeping their recorded loops and session', async () => {
    const { normalizeProjectState } = await import('./musicStudioStore');
    const old = normalizeProjectState({ myLoops: [{ id: 'a', instrument: 'keys', beats: 8, notes: [{ beat: 0, dur: 1, note: 60, velocity: 0.5 }] }], recordLength: 4 });
    expect(old.loopStation.tracks).toHaveLength(8);
    expect(old.loopStation.trackCount).toBe(6);
    expect(old.loopStation.tracks.every((t) => t.layers.length === 0)).toBe(true);
    expect(Object.values(old.session).flat().some((c) => c?.id === 'a')).toBe(true);
    expect(old.recordLength).toBe(4);
    // And a station round-trips through a save.
    const again = normalizeProjectState({ loopStation: { tracks: [{ kind: 'midi', instrument: 'keys', beats: 16, layers: [[{ beat: 2, dur: 1, note: 62, velocity: 0.7 }]] }] } });
    expect(again.loopStation.tracks[0].layers[0][0].note).toBe(62);
  });
});

describe('visuals per loop track', () => {
  it('tags each loop note with its track, and names a source per track', async () => {
    const { loopTrackSource, loopTrackOfSource, isLiveSource } = await import('./visualVoices');
    pressLoopTrack(2);
    runTo(4);
    notes.push({ instrument: 'keys', note: 60, velocity: 0.8, beat: 4, end: 4.5 });
    runTo(21);
    expect(sent.filter((e) => e.type === 'on').every((e) => e.loopTrack === 2)).toBe(true);
    expect(isLiveSource(loopTrackSource(2))).toBe(true);
    expect(loopTrackOfSource(loopTrackSource(5))).toBe(5);
    expect(loopTrackOfSource('live:Bass')).toBe(-1);
  });
});

describe('full editor on a loop track', () => {
  it('edits flow back as one undoable change, and the editor copy leaves the session', async () => {
    const { writable } = await import('svelte/store');
    const { openTrackInFullEditor } = await import('./loopStation');
    const { findClip } = await import('./session');
    pressLoopTrack(0);
    runTo(4);
    play(4);
    play(6, 64);
    runTo(20);
    const editor = writable<string | null>(null);
    openTrackInFullEditor(0, (id) => editor.set(id), editor);
    const id = get(editor)!;
    expect(findClip(get(musicStudio).session, id)).toBeTruthy();
    musicStudio.updateSessionClip(id, (c) => (c.kind === 'notes' ? { ...c, notes: [...c.notes, { beat: 8, dur: 1, note: 70, velocity: 0.9 }] } : c));
    await Promise.resolve();
    expect(track0().layers).toHaveLength(1);
    expect(track0().layers[0].map((n) => n.note)).toEqual([60, 64, 70]);
    expect(undoLoopLayer(0)).toBe(true);
    expect(track0().layers[0].map((n) => n.note)).toEqual([60, 64]);
    editor.set(null);
    await Promise.resolve();
    expect(findClip(get(musicStudio).session, id)).toBeNull();
  });
});

describe('sections on the rail', () => {
  it('launch on the next bar, show next until then, and step with Next section', async () => {
    const { launchLoopSection, loopSectionState, nextLoopSection } = await import('./loopStation');
    pressLoopTrack(0);
    runTo(4);
    play(4);
    runTo(20);
    musicStudio.updateLoopStation((d) => ({ ...d, sections: [{ id: 'a', name: 'Intro', tracks: [0] }, { id: 'b', name: 'Verse', tracks: [] }] }));
    clock.beat = 21;
    launchLoopSection('b');
    expect(get(loopSectionState)).toEqual({ now: null, next: 'b', at: 24 });
    runTo(24.5);
    expect(get(loopSectionState).now).toBe('b');
    expect(_trackRuntime(0).phase).toBe('stopped');
    nextLoopSection();
    expect(get(loopSectionState).next).toBe('a');
  });
});

describe('MIDI follows the selected track', () => {
  it('plays the selected MIDI track, a locked channel its own track, and only with the looper in front', async () => {
    const { loopMidiInstrument, setLooperFocus, selectLoopTrack } = await import('./loopStation');
    const { applyStationPreset } = await import('./loopTrack');
    musicStudio.updateLoopStation((d) => applyStationPreset(d, 'band', () => false));
    expect(loopMidiInstrument(0, 'kbd')).toBeNull();
    setLooperFocus(true);
    selectLoopTrack(1);
    expect(loopMidiInstrument(0, 'kbd')).toBe('dubbass');
    expect(get(musicStudio).instrument).toBe('dubbass');
    // E-drums on channel 10 stay on the drums.
    expect(loopMidiInstrument(9, 'edrums')).toBe('drums');
    selectLoopTrack(4);
    expect(loopMidiInstrument(0, 'kbd')).toBeNull();
    setLooperFocus(false);
  });
});

describe('editing a recorded MIDI loop', () => {
  function record(beats: number[]) {
    pressLoopTrack(0);
    runTo(4);
    for (const b of beats) play(b);
    runTo(20);
  }

  it('quantizes on demand, and one undo brings the notes back', () => {
    musicStudio.setQuantize('off');
    record([4.1, 6.4]);
    expect(track0().layers[0].map((n) => n.beat)).toEqual([expect.closeTo(0.1, 6), expect.closeTo(2.4, 6)]);
    expect(quantizeLoopTrack(0, '1/4')).toBe(true);
    expect(track0().layers[0].map((n) => n.beat)).toEqual([0, 2]);
    expect(undoLoopLayer(0)).toBe(true);
    expect(track0().layers[0].map((n) => n.beat)).toEqual([expect.closeTo(0.1, 6), expect.closeTo(2.4, 6)]);
    expect(quantizeLoopTrack(0, 'off')).toBe(false);
  });

  it('keeps record-time quantize', () => {
    musicStudio.setQuantize('1/4');
    record([4.1, 6.4]);
    expect(track0().layers[0].map((n) => n.beat)).toEqual([0, 2]);
  });

  it('plays its notes on a new sound after recording', () => {
    record([4]);
    setLoopTrackInstrument(0, 'synth');
    expect(track0().instrument).toBe('synth');
    expect(track0().layers[0]).toHaveLength(1);
    sent = [];
    runTo(40);
    const ons = sent.filter((e) => e.type === 'on');
    expect(ons.length).toBeGreaterThan(0);
    expect(ons.every((e) => e.instrument === 'synth')).toBe(true);
  });

  it('plays a chosen patch or tone, through the track\'s own effects channel', () => {
    record([4]);
    setLoopTrackSound(0, { instrument: 'keys', patch: 'organ' });
    sent = [];
    runTo(40);
    let ons = sent.filter((e) => e.type === 'on');
    expect(ons.length).toBeGreaterThan(0);
    expect(ons.every((e) => e.instrument === 'keys' && e.patch === 'organ' && e.insertChannel === 'loop:0' && !e.tone)).toBe(true);
    setLoopTrackSound(0, { instrument: 'synth', tone: 'some-tone' });
    sent = [];
    runTo(60);
    ons = sent.filter((e) => e.type === 'on');
    expect(ons.every((e) => e.instrument === 'synth' && e.tone === 'some-tone' && e.patch === undefined)).toBe(true);
  });

  it('sends nothing with its fader at 0', () => {
    record([4]);
    musicStudio.updateLoopTrack(0, { level: 0 });
    sent = [];
    runTo(40);
    expect(sent.filter((e) => e.type === 'on')).toHaveLength(0);
  });

  it('keeps a new name on the loop, in the project and when saved to My loops', async () => {
    setUserLoopsBackend(memoryBackend(null));
    record([4]);
    renameLoopTrack(0, '  Night  riff ');
    expect(track0().name).toBe('Night riff');
    expect(track0().customName).toBe(true);
    const reloaded = normalizeStationData(JSON.parse(JSON.stringify(get(musicStudio).loopStation)));
    expect(reloaded.tracks[0]).toMatchObject({ name: 'Night riff', customName: true });
    // A new sound leaves a name the player chose.
    setLoopTrackInstrument(0, 'synth');
    expect(track0().name).toBe('Night riff');
    await saveLoopTrack(0);
    expect(get(userLoops)[0].name).toBe('Night riff');
    const clips = JSON.stringify(get(musicStudio).session);
    expect(clips).toContain('Night riff');
  });
});
