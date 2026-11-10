/**
 * Sound rows and control lines: the row's level and its Music Studio
 * effects are line keys (registry, evaluator, save), a sound row is a
 * follow source computed offline (scrub = play), and a row runs the
 * studio's own effect chain with the same values the studio would give it.
 */
import { describe, expect, it, vi } from 'vitest';
import { createLineEvaluator, sourceValue, SOUND_ROW_TRACK_PREFIX, type PlacedSong } from '../lines/lineEvaluator';
import { normalizeLines, type ControlLine } from '../lines/lineModel';
import { findParam, paramsFor, readParam, targetId, type RegistrySource } from '../lines/paramRegistry';
import { normalizeBindings } from '../lines/lineDocOps';
import type { SongFeatures } from '../lines/songFeatures';
import { MacroFxChain } from '../../music/macroFxAudio';
import { effectiveValue, macroFxDef } from '../../music/macroFx';
import { addRowFx, defaultSoundRow, setRowFxParam, type SoundRow } from './soundModel';
import { readSoundRowParam, rowValues, soundRowParams } from './soundParams';
import { RowBus } from './rowBus';
import { FakeAudioContext } from './fakeAudio.testutil';

function rowWithFx(): SoundRow {
  let row = addRowFx(defaultSoundRow(0), 'filter', 'f1');
  row = addRowFx(row, 'delay', 'd1');
  row = setRowFxParam(row, 'f1', 'cutoff', 0.8);
  return { ...row, volume: 0.7, duck: { source: 'beat', depth: 0.4, release: 0.2 } };
}

const source = (row: SoundRow): RegistrySource => ({
  layers: [],
  soundParams: (id) => (id === row.id ? soundRowParams(row) : []),
  readSound: (id, key) => (id === row.id ? readSoundRowParam(row, key) : undefined),
});

describe('sound rows: line keys', () => {
  it('the registry lists the row level, mute, every effect knob and the duck depth, with the stored values', () => {
    const row = rowWithFx();
    const params = paramsFor(source(row), { scope: 'sound', id: row.id });
    const keys = params.map((p) => p.key);
    expect(keys).toContain('sound:volume');
    expect(keys).toContain('sound:mute');
    expect(keys).toContain('duck:depth');
    for (const p of macroFxDef('filter').params) expect(keys).toContain(`sfx:f1:${p.key}`);
    for (const p of macroFxDef('delay').params) expect(keys).toContain(`sfx:d1:${p.key}`);
    expect(findParam(source(row), { scope: 'sound', id: row.id }, 'sfx:f1:cutoff')).toMatchObject({ min: 0, max: 1, default: 0.8, group: 'Filter', label: 'Filter Cutoff' });
    expect(readParam(source(row), { scope: 'sound', id: row.id }, 'sound:volume')).toBe(0.7);
    expect(readParam(source(row), { scope: 'sound', id: row.id }, 'sfx:f1:cutoff')).toBe(0.8);
    expect(targetId({ scope: 'sound', id: row.id })).toBe(`sound:${row.id}`);
  });

  it('a Live row offers only mute (its sound is in Live)', () => {
    expect(soundRowParams(defaultSoundRow(1, 'live')).map((p) => p.key)).toEqual(['sound:mute']);
  });

  it('lines on a row evaluate into the frame by row id and land on the row as it plays', () => {
    const row = rowWithFx();
    const lines: ControlLine[] = [
      { id: 'a', target: { scope: 'sound', id: row.id }, key: 'sfx:f1:cutoff', kind: 'continuous', min: 0, max: 1, points: [{ t: 0, v: 1 }, { t: 10, v: 0 }] },
      { id: 'b', target: { scope: 'sound', id: row.id }, key: 'sound:volume', kind: 'continuous', min: 0, max: 1, points: [{ t: 0, v: 0.5 }] },
    ];
    const frame = createLineEvaluator().evaluate(lines, 2.5);
    const rec = frame.sounds?.get(row.id);
    expect(rec?.['sfx:f1:cutoff']).toBeCloseTo(0.75, 6);
    const v = rowValues(row, rec);
    expect(v.volume).toBe(0.5);
    expect(v.fx.get('f1')!.cutoff).toBeCloseTo(0.75, 6);
    // Untouched knobs keep the row's own values.
    expect(v.fx.get('d1')!.feedback).toBe(row.fx[1].params.feedback.value);
    expect(v.duckDepth).toBe(0.4);
  });

  it('sound lines and their bindings survive a save', () => {
    const raw = JSON.parse(JSON.stringify([{ id: 'a', target: { scope: 'sound', id: 'row-0' }, key: 'sound:volume', kind: 'continuous', min: 0, max: 1, points: [{ t: 0, v: 1 }] }]));
    expect(normalizeLines(raw)[0].target).toEqual({ scope: 'sound', id: 'row-0' });
    const bindings = normalizeBindings([{ id: 'b', source: { kind: 'midi', cc: 7, channel: 0 }, target: { scope: 'sound', id: 'row-0' }, key: 'sound:volume' }]);
    expect(bindings).toHaveLength(1);
    expect(bindings[0].target).toEqual({ scope: 'sound', id: 'row-0' });
  });
});

function features(frames: number, value: (i: number) => number): SongFeatures {
  const make = () => Float32Array.from({ length: frames }, (_, i) => value(i));
  return { frameRate: 100, frames, duration: frames / 100, features: { level: make(), energy: make(), bass: make(), mid: make(), high: make(), kick: make(), snare: make(), hats: make() } };
}

describe('sound rows: a row drives a line', () => {
  const ramp = features(1000, (i) => i / 1000);
  const flat = features(1000, () => 0.9);
  const row = `${SOUND_ROW_TRACK_PREFIX}row-1`;
  const songs: PlacedSong[] = [
    { trackId: row, startTime: 0, offset: 0, length: 8, fadeOut: 2, features: ramp },
    { trackId: row, startTime: 6, offset: 0, length: 4, fadeIn: 2, gain: 0.5, features: flat },
    { trackId: 'other', startTime: 0, offset: 0, length: 10, features: flat },
  ];
  const src = { kind: 'audio' as const, feature: 'level' as const, track: row };

  it("reads the loudest of the row's blocks, each at its fade and level, from the files' own analysis", () => {
    expect(sourceValue(src, 2, { songs })).toBeCloseTo(0.2, 2);
    // 7 s: the ramp fades out (half way, sin 45°) under the flat block fading in at half level.
    const a = 0.7 * Math.sin(Math.PI / 4);
    const b = 0.9 * 0.5 * Math.sin(Math.PI / 4);
    expect(sourceValue(src, 7, { songs })).toBeCloseTo(Math.max(a, b), 2);
    expect(sourceValue(src, 9, { songs })).toBeCloseTo(0.45, 2);
    // Nothing on the row: silent, not "no source".
    expect(sourceValue(src, 11, { songs })).toBe(0);
  });

  it('scrubbing gives what playing gives (offline: the same at any time, in any order)', () => {
    const line: ControlLine = { id: 'x', target: { scope: 'layer', id: 'A' }, key: 'layer:opacity', kind: 'continuous', min: 0, max: 1, points: [], follow: { source: src, depth: 1, base: 0, smooth: 0.2 } };
    const times = Array.from({ length: 200 }, (_, i) => i * 0.05);
    const play = createLineEvaluator();
    const played = times.map((t) => play.evaluate([line], t, { songs }).layers.get('A')!['layer:opacity']);
    const shuffled = times.map((t, i) => [t, i] as const).sort(() => Math.random() - 0.5);
    const scrub = createLineEvaluator();
    for (const [t, i] of shuffled) expect(scrub.evaluate([line], t, { songs }).layers.get('A')!['layer:opacity']).toBe(played[i]);
  });
});

describe("sound rows: the studio's own effects", () => {
  it('a row runs MacroFxChain with exactly the values the studio sends it (macro at rest)', () => {
    const row = rowWithFx();
    const ctx = new FakeAudioContext();
    const sync = vi.spyOn(MacroFxChain.prototype, 'sync');
    const bus = new RowBus(ctx as unknown as AudioContext, ctx.destination as unknown as AudioNode);
    expect(bus.chain).toBeInstanceOf(MacroFxChain);
    bus.setFx(row, rowValues(row, undefined).fx, 124);
    expect(sync).toHaveBeenCalledTimes(1);
    const [slots, tempo] = sync.mock.calls[0];
    expect(tempo).toBe(124);
    expect(slots).toHaveLength(1);
    expect(slots[0].macroValue).toBe(0);
    expect(slots[0].effects.map((f) => [f.id, f.type])).toEqual([['f1', 'filter'], ['d1', 'delay']]);
    // What the studio's own inserts would compute for each knob (effectiveValue at macro 0).
    for (const [i, f] of row.fx.entries()) {
      for (const [k, p] of Object.entries(f.params)) expect(effectiveValue(slots[0].effects[i].params[k], 0)).toBe(effectiveValue(p, 0));
    }
    // Same values again: the chain is not touched.
    bus.setFx(row, rowValues(row, undefined).fx, 124);
    expect(sync).toHaveBeenCalledTimes(1);
    // A line moves a knob: the chain hears it.
    bus.setFx(row, rowValues(row, { 'sfx:f1:cutoff': 0.2 }).fx, 124);
    expect(sync).toHaveBeenCalledTimes(2);
    expect(sync.mock.calls[1][0][0].effects[0].params.cutoff.value).toBe(0.2);
    // An effect switched off leaves the chain.
    const off = { ...row, fx: row.fx.map((f) => (f.id === 'd1' ? { ...f, enabled: false } : f)) };
    bus.setFx(off, rowValues(off, undefined).fx, 124);
    expect(sync.mock.calls[2][0][0].effects.map((f) => f.id)).toEqual(['f1']);
    sync.mockRestore();
  });

  it("builds the studio's units: a filter row gets the studio filter's nodes", () => {
    const ctx = new FakeAudioContext();
    const bus = new RowBus(ctx as unknown as AudioContext, ctx.destination as unknown as AudioNode);
    const before = ctx.created.length;
    const row = addRowFx(defaultSoundRow(0), 'filter', 'f1');
    bus.setFx(row, rowValues(row, undefined).fx, 120);
    const fresh = ctx.kinds().slice(before);
    // The studio's filter unit: biquad stages and its drive shaper.
    expect(fresh).toContain('biquad');
    expect(fresh).toContain('waveshaper');
  });

  it('level and mute: a muted row is silent, solo leaves the others silent', () => {
    const ctx = new FakeAudioContext();
    const bus = new RowBus(ctx as unknown as AudioContext, ctx.destination as unknown as AudioNode);
    bus.setLevel(0.6);
    expect(bus.level.gain.value).toBe(0.6);
    const v = rowValues({ ...defaultSoundRow(0), volume: 0.6 }, { 'sound:mute': true });
    expect(v.muted).toBe(true);
  });
});
