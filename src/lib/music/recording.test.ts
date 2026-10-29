import { describe, expect, it } from 'vitest';
import { noteOff, noteOn } from './noteEvents';
import { TakeRecorder, normalizeTake, sortTakeEvents, takeEventsBetween, takeNoteCount, type Take } from './recording';
import {
  createPattern,
  normalizePattern,
  patternBeats,
  resizePattern,
  starterPattern,
  stepAt,
  stepsBetween,
  toggleStep,
} from './drumPattern';
import { nextTakeName, normalizeProjectState, defaultProjectState } from './musicStudioStore';

const meta = { id: 'take-1', name: 'Take 1', bpm: 120, pattern: null };

describe('take recorder', () => {
  it('times events from the start of the take', () => {
    const r = new TakeRecorder();
    r.start(10);
    r.capture(noteOn('synth', 60, 0.8, 'keyboard', 10.5));
    r.capture(noteOff('synth', 60, 'keyboard', 11));
    r.capture(noteOn('drums', 36, 1, 'sequencer', 11.25));
    const take = r.stop(12, meta)!;
    expect(take.length).toBe(2);
    expect(take.events).toEqual([
      { t: 0.5, type: 'on', instrument: 'synth', note: 60, velocity: 0.8 },
      { t: 1, type: 'off', instrument: 'synth', note: 60, velocity: 0 },
      { t: 1.25, type: 'on', instrument: 'drums', note: 36, velocity: 1 },
    ]);
    expect(r.recording).toBe(false);
  });

  it('ends notes still held at the stop', () => {
    const r = new TakeRecorder();
    r.start(0);
    r.capture(noteOn('keys', 64, 1, 'midi', 0.2));
    const take = r.stop(3, meta)!;
    expect(take.events.at(-1)).toEqual({ t: 3, type: 'off', instrument: 'keys', note: 64, velocity: 0 });
  });

  it('skips offs for notes pressed before recording and replayed notes', () => {
    const r = new TakeRecorder();
    r.start(0);
    r.capture(noteOff('synth', 50, 'keyboard', 0.1));
    r.capture(noteOn('synth', 70, 1, 'replay', 0.2));
    r.capture(noteOn('synth', 72, 1, 'keyboard', 0.3));
    const take = r.stop(1, meta)!;
    expect(take.events.map((e) => `${e.type}${e.note}`)).toEqual(['on72', 'off72']);
  });

  it('closes a held note before its retrigger, so every on has an off', () => {
    const r = new TakeRecorder();
    r.start(0);
    r.capture(noteOn('synth', 60, 1, 'keyboard', 0.1));
    r.capture(noteOn('synth', 60, 0.5, 'midi', 0.4));
    const take = r.stop(1, meta)!;
    expect(take.events.map((e) => `${e.type}@${e.t}`)).toEqual(['on@0.1', 'off@0.4', 'on@0.4', 'off@1']);
  });

  it('keeps nothing from an empty or tiny take', () => {
    const r = new TakeRecorder();
    r.start(0);
    expect(r.stop(5, meta)).toBeNull();
    r.start(0);
    r.capture(noteOn('synth', 60, 1, 'keyboard', 0.05));
    expect(r.stop(0.1, meta)).toBeNull();
  });

  it('stores a copy of the beat pattern', () => {
    const r = new TakeRecorder();
    const pattern = starterPattern();
    r.start(0);
    r.capture(noteOn('drums', 36, 1, 'sequencer', 0.5));
    const take = r.stop(2, { ...meta, pattern })!;
    expect(take.pattern).toEqual(pattern);
    expect(take.pattern).not.toBe(pattern);
  });
});

describe('take replay', () => {
  const take: Take = {
    id: 't', name: 'Take', createdAt: 0, length: 2, bpm: 120, pattern: null,
    events: [
      { t: 0, type: 'on', instrument: 'synth', note: 60, velocity: 1 },
      { t: 1, type: 'off', instrument: 'synth', note: 60, velocity: 0 },
      { t: 1.5, type: 'on', instrument: 'drums', note: 36, velocity: 1 },
    ],
  };

  it('returns the events in a window as music-clock times', () => {
    const events = takeEventsBetween(take, 100, 100, 101.2, false);
    expect(events.map((e) => [e.type, e.time])).toEqual([['on', 100], ['off', 101]]);
    expect(takeEventsBetween(take, 100, 101.2, 103, false).map((e) => e.time)).toEqual([101.5]);
  });

  it('plays each event exactly once across back-to-back windows', () => {
    const times: number[] = [];
    for (let from = 50; from < 52; from += 0.07) {
      for (const e of takeEventsBetween(take, 50, from, from + 0.07, false)) times.push(e.time);
    }
    expect(times).toEqual([50, 51, 51.5]);
  });

  it('repeats when looping', () => {
    const events = takeEventsBetween(take, 0, 1.9, 4.1, true);
    expect(events.map((e) => `${e.type}${e.note}@${e.time}`)).toEqual([
      'on60@2', 'off60@3', 'on36@3.5', 'on60@4',
    ]);
  });

  it('plays nothing for an empty window', () => {
    expect(takeEventsBetween(take, 0, 1, 1, false)).toEqual([]);
  });

  it('a recorded performance replays as the same notes', () => {
    const r = new TakeRecorder();
    r.start(5);
    const live = [
      noteOn('synth', 62, 0.9, 'keyboard', 5.1),
      noteOn('drums', 38, 0.7, 'sequencer', 5.25),
      noteOff('synth', 62, 'keyboard', 5.6),
    ];
    for (const e of live) r.capture(e);
    const recorded = r.stop(6, meta)!;
    const replayed = takeEventsBetween(recorded, 20, 20, 21, false);
    expect(replayed.map((e) => [e.type, e.instrument, e.note, e.velocity, +(e.time - 20).toFixed(6)])).toEqual(
      live.map((e) => [e.type, e.instrument, e.note, e.velocity, +(e.time - 5).toFixed(6)]),
    );
  });
});

describe('saved takes', () => {
  it('sorts offs before ons at the same instant', () => {
    const sorted = sortTakeEvents([
      { t: 1, type: 'on', instrument: 'synth', note: 60, velocity: 1 },
      { t: 1, type: 'off', instrument: 'synth', note: 60, velocity: 0 },
      { t: 0, type: 'on', instrument: 'synth', note: 60, velocity: 1 },
    ]);
    expect(sorted.map((e) => `${e.type}@${e.t}`)).toEqual(['on@0', 'off@1', 'on@1']);
  });

  it('reads a take back, dropping malformed events', () => {
    const take = normalizeTake({
      id: 'x',
      name: '',
      length: 1,
      events: [
        { t: 0.5, type: 'on', instrument: 'keys', note: 300, velocity: 2 },
        { t: -1, type: 'on', instrument: 'keys', note: 60, velocity: 1 },
        { t: 0.7, type: 'on', instrument: 'theremin', note: 60, velocity: 1 },
        { t: 2.5, type: 'off', instrument: 'keys', note: 127, velocity: 1 },
        null,
      ],
    })!;
    expect(take.name).toBe('Take');
    expect(take.events).toEqual([
      { t: 0.5, type: 'on', instrument: 'keys', note: 127, velocity: 1 },
      { t: 2.5, type: 'off', instrument: 'keys', note: 127, velocity: 0 },
    ]);
    expect(take.length).toBe(2.5);
    expect(takeNoteCount(take)).toBe(1);
    expect(normalizeTake({ events: [] })).toBeNull();
  });

  it('names new takes after the highest number', () => {
    expect(nextTakeName([])).toBe('Take 1');
    const t = (name: string) => ({ ...normalizeTake({ id: name, name })! });
    expect(nextTakeName([t('Take 1'), t('Take 4')])).toBe('Take 5');
    expect(nextTakeName([t('Intro'), t('Verse')])).toBe('Take 3');
  });

  it('round-trips the studio section and fills in what an older file lacks', () => {
    const state = defaultProjectState();
    state.instrument = 'keys';
    state.visuals.keys.mode = 'build';
    state.takes = [normalizeTake({ id: 'a', name: 'Take 1', length: 1, events: [{ t: 0, type: 'on', instrument: 'keys', note: 60, velocity: 1 }] })!];
    const back = normalizeProjectState(JSON.parse(JSON.stringify(state)));
    expect(back).toEqual(state);
    const partial = normalizeProjectState({ instrument: 'drums', visuals: { synth: { mode: 'build' } }, octave: 42 });
    expect(partial.instrument).toBe('drums');
    expect(partial.visuals.synth.mode).toBe('build');
    expect(partial.visuals.synth.release).toBe(defaultProjectState().visuals.synth.release);
    expect(partial.octave).toBe(8);
    expect(normalizeProjectState(null)).toEqual(defaultProjectState());
  });
});

describe('drum pattern', () => {
  it('toggles steps on and off', () => {
    let p = createPattern(16);
    p = toggleStep(p, 'snare', 4, 0.6);
    expect(p.tracks.snare[4]).toBe(0.6);
    p = toggleStep(p, 'snare', 4);
    expect(p.tracks.snare[4]).toBe(0);
    expect(toggleStep(p, 'snare', 99)).toBe(p);
  });

  it('schedules every hit once across back-to-back windows, looping', () => {
    const p = starterPattern();
    const hits: string[] = [];
    for (let b = 0; b < 8; b += 0.13) {
      for (const s of stepsBetween(p, b, Math.min(8, b + 0.13))) hits.push(`${s.voice}@${s.beat}`);
    }
    const kicks = hits.filter((h) => h.startsWith('kick'));
    expect(kicks).toEqual(['kick@0', 'kick@1', 'kick@2', 'kick@3', 'kick@4', 'kick@5', 'kick@6', 'kick@7']);
    expect(hits.filter((h) => h.startsWith('snare'))).toEqual(['snare@1', 'snare@3', 'snare@5', 'snare@7']);
    expect(new Set(hits).size).toBe(hits.length);
  });

  it('swings every second step late', () => {
    let p = createPattern(16);
    p = toggleStep(p, 'hatClosed', 1);
    p = { ...p, swing: 0.5 };
    const [hit] = stepsBetween(p, 0, 1);
    expect(hit.beat).toBeCloseTo(0.25 + 0.125);
  });

  it('knows the playing step and pattern length', () => {
    const p = createPattern(16);
    expect(patternBeats(p)).toBe(4);
    expect(stepAt(p, 0)).toBe(0);
    expect(stepAt(p, 1.3)).toBe(5);
    expect(stepAt(p, 4.1)).toBe(0);
  });

  it('resizes by repeating a short pattern', () => {
    const p = toggleStep(createPattern(8), 'kick', 0);
    const long = resizePattern(p, 16);
    expect(long.tracks.kick[0]).toBeGreaterThan(0);
    expect(long.tracks.kick[8]).toBeGreaterThan(0);
    expect(resizePattern(long, 8).tracks.kick).toHaveLength(8);
  });

  it('reads a saved pattern back safely', () => {
    const p = normalizePattern({ steps: 12, swing: 3, tracks: { kick: [1, 'x', 2] } });
    expect(p.steps).toBe(16);
    expect(p.swing).toBe(0.5);
    expect(p.tracks.kick.slice(0, 3)).toEqual([1, 0, 1]);
    expect(p.tracks.crash).toHaveLength(16);
  });
});
