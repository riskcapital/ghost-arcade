import { describe, expect, it } from 'vitest';
import {
  loopFxChannel,
  normalizeTrack,
  parseSoundValue,
  setTrackSound,
  soundValue,
  quantizeLayers,
  renameTrack,
  setTrackInstrument,
  AUDIO_MEMORY_BUDGET_BYTES,
  MAX_LAYERS,
  audioBytes,
  autoLoopName,
  defaultAfterRecord,
  emptyStack,
  findClickOnset,
  flattenMidi,
  foldOldest,
  foldsForBudget,
  freeRecordEnd,
  inferTempo,
  inputLatencySeconds,
  latencyFrames,
  loopNotesInWindow,
  loopProgress,
  maxAudioBars,
  mergeMidiLayers,
  mixInto,
  normalizeStationData,
  notesForLayer,
  passEnd,
  phaseAfterRecord,
  pressTrackButton,
  punchAt,
  pushLayer,
  recordStart,
  redoLayer,
  rescaleBeats,
  undoLayer,
  uniqueName,
  trackForProgram,
  applyStationPreset,
  lockedTrack,
  setTrackKind,
  blankTrack,
  defaultStationData,
  type TrackPhase,
} from './loopTrack';
import type { PlayedNote } from './loopRecorder';

const played = (beat: number, note = 60, end: number | null = beat + 0.5, instrument: PlayedNote['instrument'] = 'keys'): PlayedNote => ({ instrument, note, velocity: 0.8, beat, end });

describe('track button', () => {
  it('walks empty → armed → record → play/overdub ⇄ and stopped → play', () => {
    const steps: Array<[TrackPhase, string]> = [
      ['empty', 'arm'],
      ['armed', 'cancel'],
      ['record', 'close-record'],
      ['play', 'punch-in'],
      ['overdub', 'punch-out'],
      ['stopped', 'play'],
    ];
    for (const [phase, action] of steps) expect(pressTrackButton(phase).type).toBe(action);
  });

  it('goes to play or overdub after a recording, per track; MIDI plays, audio overdubs by default', () => {
    expect(phaseAfterRecord('play')).toBe('play');
    expect(phaseAfterRecord('overdub')).toBe('overdub');
    expect(defaultAfterRecord('midi')).toBe('play');
    expect(defaultAfterRecord('audio')).toBe('overdub');
  });
});

describe('layers', () => {
  const merge = (a: number[], b: number[]) => [...a, ...b];

  it('undo takes the last layer off and redo puts it back; a new layer clears redo', () => {
    let s = emptyStack<number[]>();
    s = pushLayer(s, [1], merge);
    s = pushLayer(s, [2], merge);
    s = undoLayer(s);
    expect(s.layers).toEqual([[1]]);
    expect(s.redo).toEqual([[2]]);
    s = redoLayer(s);
    expect(s.layers).toEqual([[1], [2]]);
    s = undoLayer(undoLayer(s));
    expect(s.layers).toEqual([]);
    s = pushLayer(s, [3], merge);
    expect(s.redo).toEqual([]);
    expect(undoLayer(emptyStack())).toEqual(emptyStack());
  });

  it('keeps 8 layers, folding the oldest together', () => {
    let s = emptyStack<number[]>();
    for (let i = 1; i <= 10; i++) s = pushLayer(s, [i], merge);
    expect(s.layers.length).toBe(MAX_LAYERS);
    expect(s.layers[0]).toEqual([1, 2, 3]);
    expect(s.layers.flat()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(foldOldest(s, merge).layers.length).toBe(MAX_LAYERS - 1);
  });

  it('flattens MIDI layers in time order, tagged by layer', () => {
    const a = [{ beat: 2, dur: 1, note: 60, velocity: 1 }];
    const b = [{ beat: 0, dur: 1, note: 64, velocity: 1 }];
    const flat = flattenMidi({ layers: [a, b], redo: [] });
    expect(flat.map((n) => [n.beat, n.layer])).toEqual([[0, 1], [2, 0]]);
    expect(mergeMidiLayers(a, b).map((n) => n.beat)).toEqual([0, 2]);
  });
});

describe('overdub layering and punch', () => {
  it('wraps an overdub pass into the loop and snaps it', () => {
    // A 4-beat loop from beat 8; a pass from 12 to 16.
    const layer = notesForLayer([played(13.02), played(15.9, 62, 16.4), played(14, 50, 15, 'synth')], 'keys', 12, 16, 8, 4, 0.25);
    expect(layer.map((n) => n.beat)).toEqual([0, 1]);
    // The note snapped onto the loop end belongs on its first beat; held past the punch-out it ends there.
    expect(layer[0].dur).toBeCloseTo(0.1, 5);
  });

  it('counts a note a hair early as on the punch-in', () => {
    const layer = notesForLayer([played(11.95)], 'keys', 12, 16, 8, 4, 0.25);
    expect(layer).toHaveLength(1);
    expect(layer[0].beat).toBe(0);
  });

  it('punches in and out on the next bar, and passes end on loop boundaries', () => {
    expect(punchAt(5.2)).toBe(8);
    expect(punchAt(8)).toBe(12);
    expect(passEnd(8, 16, 9)).toBe(24);
    expect(passEnd(8, 16, 24)).toBe(40);
  });

  it('starts a recording on the next bar, after the count-in only when the clock is idle', () => {
    expect(recordStart(1.5, 1, true)).toBe(4);
    expect(recordStart(1.5, 1, false)).toBe(8);
    expect(recordStart(1.5, 2, false)).toBe(12);
    expect(recordStart(1.5, 0, false)).toBe(4);
  });

  it('ends a free recording on the nearest bar line, ahead in its last beat', () => {
    expect(freeRecordEnd(0, 9)).toBe(8);
    expect(freeRecordEnd(0, 10.5)).toBe(12);
    expect(freeRecordEnd(0, 15.2)).toBe(16);
    expect(freeRecordEnd(0, 1)).toBe(4);
  });

  it('schedules the loop passes without drift', () => {
    const notes = [{ beat: 0, dur: 0.5, note: 60, velocity: 1 }];
    // 1000 passes of a 4-beat loop: the last note is exactly on its beat.
    const out = loopNotesInWindow(notes, 4, 4, 4000, 4004.01);
    expect(out.map((n) => n.at)).toEqual([4000, 4004]);
    expect(loopProgress(4, 4, 4006)).toBeCloseTo(0.5);
  });
});

describe('free tempo', () => {
  it('takes the bar count that lands in 80-160 BPM', () => {
    expect(inferTempo(2)).toEqual({ bpm: 120, bars: 1 });
    expect(inferTempo(8)).toEqual({ bpm: 120, bars: 4 });
    expect(inferTempo(2.4)).toEqual({ bpm: 100, bars: 1 });
    expect(inferTempo(5)?.bars).toBe(2);
    expect(inferTempo(0.1)).toBeNull();
    expect(rescaleBeats(4, 500, 250)).toBe(8);
  });
});

describe('latency', () => {
  it('adds the reported latencies and the manual offset, never below zero', () => {
    expect(inputLatencySeconds({ baseLatency: 0.005, outputLatency: 0.01 }, 5)).toBeCloseTo(0.02);
    expect(inputLatencySeconds({ outputLatency: Number.NaN }, -50)).toBe(0);
    expect(latencyFrames(0.01, 48000)).toBe(480);
  });

  it('finds the click that came back in a loopback measure', () => {
    const rec = new Float32Array(1000);
    rec[300] = 0.6;
    rec[301] = -0.9;
    expect(findClickOnset(rec)).toBe(300);
    expect(findClickOnset(new Float32Array(10))).toBeNull();
  });
});

describe('audio memory', () => {
  it('mixes an overdub in at its offset, wrapping', () => {
    const out = mixInto(new Float32Array([1, 1, 1, 1]), new Float32Array([1, 2]), 3);
    expect([...out]).toEqual([3, 1, 1, 2]);
  });

  it('folds the biggest track first to stay in budget', () => {
    const big = audioBytes(48000 * 120);
    const folds = foldsForBudget([[big, big, big, big, big, big], [big, big], [1000]], AUDIO_MEMORY_BUDGET_BYTES);
    expect(folds.length).toBeGreaterThan(0);
    expect(folds[0]).toBe(0);
    expect(foldsForBudget([[1, 1]], 10)).toEqual([]);
  });

  it('caps an audio loop at 64 bars and 120 seconds', () => {
    expect(maxAudioBars(500)).toBe(60);
    expect(maxAudioBars(250)).toBe(64);
  });
});

describe('saved state', () => {
  it('gives a project from before the station six empty tracks', () => {
    const d = normalizeStationData(undefined);
    expect(d.tracks).toHaveLength(8);
    expect(d.trackCount).toBe(6);
    expect(d.tracks.slice(0, 6).map((t) => t.kind)).toEqual(['midi', 'midi', 'midi', 'midi', 'audio', 'audio']);
    expect(d.tracks[4].afterRecord).toBe('overdub');
  });

  it('keeps layers and drops bad notes', () => {
    const d = normalizeStationData({
      tracks: [{ kind: 'midi', instrument: 'keys', beats: 16, layers: [[{ beat: 1, dur: 1, note: 60, velocity: 0.5 }, { beat: 99, dur: 1, note: 60 }], 'junk'] }],
      length: 0,
      countIn: 2,
      sections: [{ id: 's', name: '', tracks: [0, 9, 1] }],
    });
    expect(d.tracks[0].layers).toEqual([[{ beat: 1, dur: 1, note: 60, velocity: 0.5 }], []]);
    expect(d.length).toBe(0);
    expect(d.sections[0].tracks).toEqual([0, 1]);
  });

  it('names a save and keeps names unique', () => {
    expect(autoLoopName('Keys 3', 4, 120, { root: 9, scale: 'minor' })).toBe('Keys 3 · 4 bars · 120 · A min');
    expect(uniqueName('Riff', ['riff', 'Riff 2'])).toBe('Riff 3');
  });
});

describe('Program Change track select', () => {
  it('maps PC offset+n on the channel to track n+1', () => {
    const pc = { on: true, channel: 2, offset: 10 };
    expect(trackForProgram(pc, 2, 10)).toBe(0);
    expect(trackForProgram(pc, 2, 15)).toBe(5);
    expect(trackForProgram(pc, 2, 17)).toBe(7);
    expect(trackForProgram(pc, 2, 18)).toBe(-1);
    expect(trackForProgram(pc, 3, 10)).toBe(-1);
    expect(trackForProgram({ ...pc, channel: -1 }, 7, 11)).toBe(1);
    expect(trackForProgram({ ...pc, on: false }, 2, 10)).toBe(-1);
    expect(normalizeStationData({ pc: { on: true, channel: 99, offset: -4 } }).pc).toEqual({ on: true, channel: 15, offset: 0 });
  });
});

describe('track types, count and the band setup', () => {
  it('changes a track type only while it is empty', () => {
    const t = { ...blankTrack(0, 'midi'), instrument: 'keys' as const, name: 'Keys' };
    expect(setTrackKind(t, 0, 'audio', false)).toBe(t);
    const a = setTrackKind(t, 0, 'audio', true);
    expect(a.kind).toBe('audio');
    expect(a.afterRecord).toBe('overdub');
    expect(a.name).toBe('Keys');
  });

  it('keeps 4 to 8 tracks, older projects showing their six', () => {
    expect(normalizeStationData({ trackCount: 12 }).trackCount).toBe(8);
    expect(normalizeStationData({ trackCount: 1 }).trackCount).toBe(4);
    const old = normalizeStationData({ tracks: Array.from({ length: 6 }, (_, i) => ({ kind: i < 4 ? 'midi' : 'audio' })) });
    expect(old.tracks).toHaveLength(8);
    expect(old.trackCount).toBe(6);
    expect(old.locks).toEqual([]);
  });

  it('routes a locked channel or device to its track', () => {
    const locks = [{ track: 0, channel: 9, device: '' }, { track: 2, channel: -1, device: 'kbd' }];
    expect(lockedTrack(locks, 9, 'pads')).toBe(0);
    expect(lockedTrack(locks, 0, 'kbd')).toBe(2);
    expect(lockedTrack(locks, 0, 'other')).toBe(-1);
    expect(lockedTrack(locks, 9, 'x', 0)).toBe(-1);
  });

  it('sets up a live band on the empty tracks, keeping tracks with loops', () => {
    const d = applyStationPreset(defaultStationData(), 'band', (i) => i === 2);
    expect(d.tracks.slice(0, 6).map((t) => [t.kind, t.instrument, t.name])).toEqual([
      ['midi', 'drums', 'Drums'], ['midi', 'dubbass', 'Bass'], ['midi', null, ''], ['midi', 'drone', 'Pads'], ['audio', null, 'Guitar'], ['audio', null, 'Spare'],
    ]);
    expect(d.tracks[4].input).toBe(0);
    expect(d.locks).toEqual([{ track: 0, channel: 9, device: '' }]);
    const back = applyStationPreset(d, 'default', () => false);
    expect(back.tracks[0].instrument).toBeNull();
    expect(back.locks).toEqual([]);
  });
});

describe('editing a track', () => {
  const labels = { keys: 'Keys', synth: 'Synth' } as Record<string, string>;
  it('quantizes every layer, wrapping into the loop and keeping lengths', () => {
    const layers = [[{ beat: 0.1, dur: 0.3, note: 60, velocity: 0.8 }, { beat: 15.9, dur: 0.5, note: 62, velocity: 0.8 }], [{ beat: 2.6, dur: 1, note: 64, velocity: 0.8 }]];
    const out = quantizeLayers(layers, 1, 16);
    expect(out[0].map((n) => n.beat)).toEqual([0, 0]);
    expect(out[0].map((n) => n.dur)).toEqual([0.3, 0.5]);
    expect(out[1][0].beat).toBe(3);
    expect(layers[0][0].beat).toBe(0.1);
    expect(quantizeLayers(layers, 0, 16)[0][0].beat).toBe(0.1);
  });
  it('renames, and a blank name goes back to the automatic one', () => {
    const t = renameTrack(blankTrack(0), '  Lead ');
    expect(t).toMatchObject({ name: 'Lead', customName: true });
    const back = renameTrack(t, '   ');
    expect(back.name).toBe('');
    expect(back.customName).toBeUndefined();
  });
  it('changes the sound with the notes kept; an automatic name follows it', () => {
    const t = { ...blankTrack(0), instrument: 'keys' as const, tone: 'x', name: 'Keys 2', beats: 4, layers: [[{ beat: 0, dur: 1, note: 60, velocity: 1 }]] };
    const next = setTrackInstrument(t, 'synth', labels);
    expect(next).toMatchObject({ instrument: 'synth', name: 'Synth 2', layers: t.layers });
    expect(next.tone).toBeUndefined();
    expect(setTrackInstrument({ ...t, customName: true }, 'synth', labels).name).toBe('Keys 2');
    const audio = blankTrack(5, 'audio');
    expect(setTrackInstrument(audio, 'synth', labels)).toBe(audio);
  });
});

describe('a loop track sound', () => {
  const labels = { keys: 'Keys', synth: 'Synth', drone: 'Drone' } as Record<string, string>;
  it('round-trips the sound menu values', () => {
    for (const v of ['', 'synth:pluck', 'keys:organ', 'tone:warm-bass', 'inst:drone']) expect(soundValue(parseSoundValue(v)!)).toBe(v);
    expect(parseSoundValue('inst:nope')).toBeNull();
    expect(parseSoundValue('tone:x')).toEqual({ instrument: 'synth', tone: 'x' });
  });
  it('takes a patch or a tone, never both, and keeps the notes', () => {
    const t = { ...blankTrack(0), instrument: 'synth' as const, tone: 'old', beats: 4, layers: [[{ beat: 0, dur: 1, note: 60, velocity: 1 }]] };
    const p = setTrackSound(t, { instrument: 'keys', patch: 'organ' }, labels);
    expect(p).toMatchObject({ instrument: 'keys', patch: 'organ', layers: t.layers });
    expect(p.tone).toBeUndefined();
    const back = setTrackSound(p, { instrument: 'synth', tone: 'new' }, labels);
    expect(back.patch).toBeUndefined();
    expect(back.tone).toBe('new');
  });
  it('keeps its patch through a project reload, and has its own effects channel', () => {
    const t = normalizeTrack(JSON.parse(JSON.stringify({ ...blankTrack(0), instrument: 'synth', patch: 'pluck' })), 0);
    expect(t.patch).toBe('pluck');
    expect(loopFxChannel(2)).toBe('loop:2');
  });
});
