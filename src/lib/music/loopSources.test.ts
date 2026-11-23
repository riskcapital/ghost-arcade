import { describe, expect, it } from 'vitest';
import { alignXy, fitXy, loopXyInWindow, normalizeXyLayers, tabSource, thinXy, trackSoundLabel, xyLayerFor, type XyPoint } from './loopSources';
import { normalizeTrack, parseSoundValue, setTrackSound, soundValue, xyNotesForLayer, blankTrack } from './loopTrack';
import { INSTRUMENT_LABELS } from './instruments';
import type { PlayedNote } from './loopRecorder';

const sweep = (from: number, to: number, step: number): XyPoint[] => {
  const out: XyPoint[] = [];
  for (let b = from; b < to; b += step) out.push({ beat: b, x: (b - from) / (to - from), y: 0.5 });
  return out;
};

describe('tab instruments a loop track records', () => {
  it('maps each tab to its own instrument, and the others to the keys', () => {
    expect(tabSource('bath')).toBe('xy');
    expect(tabSource('dub')).toBe('dub');
    expect(tabSource('machine')).toBe('pads');
    expect(tabSource('berlin')).toBeNull();
    expect(tabSource('analog')).toBeNull();
  });

  it('names a track by its source, else its instrument', () => {
    expect(trackSoundLabel({ source: 'xy', instrument: 'xy' }, 'synth')).toBe('XY');
    expect(trackSoundLabel({ source: 'pads', instrument: 'drums' }, 'synth')).toBe('Drum pads');
    expect(trackSoundLabel({ instrument: null }, 'keys')).toBe('Keys');
  });

  it('reads and writes the sound menu value', () => {
    expect(parseSoundValue('src:xy')).toEqual({ instrument: 'xy', source: 'xy' });
    expect(parseSoundValue('src:nope')).toBeNull();
    expect(soundValue({ instrument: 'xy', source: 'xy' })).toBe('src:xy');
    expect(soundValue({ instrument: null })).toBe('');
  });

  it('switches a track to a source and back; the automatic name follows', () => {
    const t = { ...blankTrack(0), instrument: 'keys' as const, patch: 'organ', name: 'Keys 2' };
    const xy = setTrackSound(t, { instrument: 'xy', source: 'xy' }, INSTRUMENT_LABELS);
    expect(xy).toMatchObject({ source: 'xy', instrument: 'xy', name: 'XY 2', xy: [] });
    expect(xy.patch).toBeUndefined();
    const back = setTrackSound(xy, { instrument: 'synth' }, INSTRUMENT_LABELS);
    expect(back.source).toBeUndefined();
    expect(back.xy).toBeUndefined();
    expect(back.name).toBe('Synth 2');
  });
});

describe('XY automation', () => {
  it('thins a slow sweep but keeps its ends and its jumps', () => {
    const raw = sweep(0, 4, 1 / 240); // a point every frame at 60 fps and 120 BPM-ish
    const thin = thinXy(raw);
    expect(thin.length).toBeLessThan(raw.length / 4);
    expect(thin[0]).toEqual(raw[0]);
    expect(thin[thin.length - 1]).toEqual(raw[raw.length - 1]);
    const jump = thinXy([{ beat: 0, x: 0, y: 0 }, { beat: 0.001, x: 0.9, y: 0 }, { beat: 0.002, x: 0.9, y: 0.01 }]);
    expect(jump.map((p) => p.x)).toEqual([0, 0.9, 0.9]);
  });

  it('keeps where the puck rested before a pause', () => {
    const pts = [{ beat: 0, x: 0.1, y: 0.1 }, { beat: 0.01, x: 0.105, y: 0.1 }, { beat: 2, x: 0.6, y: 0.6 }, { beat: 2.1, x: 0.7, y: 0.6 }];
    expect(thinXy(pts).map((p) => p.beat)).toContain(0.01);
  });

  it('takes the window as a layer: wrapped into the loop, started where the puck was held', () => {
    const moves = [{ beat: 3, x: 0.2, y: 0.3 }, { beat: 5, x: 0.4, y: 0.5 }, { beat: 6, x: 0.8, y: 0.9 }, { beat: 21, x: 1, y: 1 }];
    const layer = xyLayerFor(moves, 4, 20, 4, 16, true);
    expect(xyLayerFor(moves, 4, 20, 4, 16)[0].beat).toBe(1);
    expect(layer).toEqual([{ beat: 0, x: 0.2, y: 0.3 }, { beat: 1, x: 0.4, y: 0.5 }, { beat: 2, x: 0.8, y: 0.9 }]);
    expect(xyLayerFor(moves, 8, 20, 8, 12)).toEqual([]);
  });

  it('plays a layer pass after pass', () => {
    const pts = [{ beat: 0, x: 0, y: 0 }, { beat: 2, x: 1, y: 1 }];
    expect(loopXyInWindow(pts, 4, 4, 4, 12).map((p) => p.at)).toEqual([4, 6, 8, 10]);
    expect(loopXyInWindow(pts, 4, 4, 0, 4)).toEqual([]);
  });

  it('follows a length change, keeps one list per layer, and cleans what it loads', () => {
    const pts = [{ beat: 1, x: 0.5, y: 0.5 }];
    expect(fitXy(pts, 4, 8).map((p) => p.beat)).toEqual([1, 5]);
    expect(fitXy([{ beat: 1, x: 0, y: 0 }, { beat: 6, x: 0, y: 0 }], 8, 4).map((p) => p.beat)).toEqual([1]);
    expect(alignXy([[{ beat: 0, x: 0, y: 0 }]], 3)).toHaveLength(3);
    const clean = normalizeXyLayers([[{ beat: 9, x: 0, y: 0 }, { beat: 1, x: 2, y: -1 }, 'junk']], 2, 8);
    expect(clean).toEqual([[{ beat: 1, x: 1, y: 0 }], []]);
  });

  it('keeps an XY track and its points in the project; an old track keeps its instrument', () => {
    const t = normalizeTrack({ kind: 'midi', source: 'xy', instrument: 'synth', tone: 'x', beats: 8, layers: [[{ beat: 0, dur: 1, note: 60, velocity: 0.8 }]], xy: [[{ beat: 0.5, x: 0.2, y: 0.4 }]] }, 0);
    expect(t).toMatchObject({ source: 'xy', instrument: 'xy', xy: [[{ beat: 0.5, x: 0.2, y: 0.4 }]] });
    expect(t.tone).toBeUndefined();
    const old = normalizeTrack({ kind: 'midi', instrument: 'xy', beats: 8, layers: [[{ beat: 0, dur: 1, note: 60, velocity: 0.8 }]] }, 0);
    expect(old.source).toBeUndefined();
    expect(old.instrument).toBe('xy');
    expect(normalizeTrack({ kind: 'midi', source: 'bogus', instrument: 'keys' }, 0).source).toBeUndefined();
  });
});

describe('XY notes as a layer', () => {
  const glide: PlayedNote[] = [
    { instrument: 'xy', note: 60, velocity: 0.7, beat: 4.1, end: 4.9 },
    { instrument: 'xy', note: 62, velocity: 0.7, beat: 4.9, end: 5.7 },
    { instrument: 'xy', note: 64, velocity: 0.7, beat: 5.7, end: 6 },
    { instrument: 'keys', note: 40, velocity: 0.7, beat: 5, end: 6 },
  ];

  it('takes only the XY notes', () => {
    expect(xyNotesForLayer(glide, 4, 8, 4, 4, 0).map((n) => n.note)).toEqual([60, 62, 64]);
  });

  it('keeps a glide gliding after the snap', () => {
    const layer = xyNotesForLayer(glide, 4, 8, 4, 4, 0.5);
    expect(layer.map((n) => n.beat)).toEqual([0, 1, 1.5]);
    // Each note runs right up to the next, as it did when played.
    expect(layer[0].dur).toBeCloseTo(1);
    expect(layer[1].dur).toBeCloseTo(0.5);
  });
});
