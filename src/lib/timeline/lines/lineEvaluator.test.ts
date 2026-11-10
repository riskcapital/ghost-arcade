import { describe, expect, it } from 'vitest';
import { createTempoMap } from '../../show/tempoMap';
import { applyEasing } from '../../keyframes/easing';
import { beatShapeValue, createLineEvaluator, lineValueAt, mergeLineValues, pointsValueAt, snapshotFrame, type PlacedSong } from './lineEvaluator';
import { normalizeLines, type ControlLine } from './lineModel';
import { analyzeSongFeatures, clearSongFeatureCache, songFeatureAnalysisCount, songFeaturesFor, type SongFeatures } from './songFeatures';

const line = (over: Partial<ControlLine> = {}): ControlLine => ({
  id: 'l1', target: { scope: 'layer', id: 'L1' }, key: 'shader:speed', kind: 'continuous', min: 0, max: 10, points: [], ...over,
});

/** A synthetic song: a kick every 0.5 s (120 BPM), louder in the second half. */
function drumLoop(seconds = 8, rate = 22050): Float32Array {
  const out = new Float32Array(seconds * rate);
  for (let i = 0; i < out.length; i++) {
    const t = i / rate;
    const local = t % 0.5;
    const gain = t < seconds / 2 ? 0.3 : 1;
    const kick = local < 0.08 ? Math.sin(2 * Math.PI * 60 * local) * Math.exp(-local * 40) : 0;
    const hiss = (Math.sin(i * 12.9898) * 43758.5453 % 1) * 0.02;
    out[i] = gain * (kick + hiss);
  }
  return out;
}

describe('curves', () => {
  const pts = [{ t: 0, v: 0, c: 'linear' as const }, { t: 1, v: 10, c: 'hold' as const }, { t: 2, v: 4, c: 'smooth' as const }, { t: 3, v: 8, c: 'ease-in' as const }, { t: 4, v: 0 }];
  it('linear, hold, ease and the ends', () => {
    expect(pointsValueAt(pts, -1)).toBe(0);
    expect(pointsValueAt(pts, 0.25)).toBeCloseTo(2.5);
    expect(pointsValueAt(pts, 1.5)).toBe(10);
    expect(pointsValueAt(pts, 3.5)).toBeCloseTo(8 + (0 - 8) * applyEasing(0.5, 'ease-in'));
    expect(pointsValueAt(pts, 9)).toBe(0);
  });
  it('smooth passes through its points and never overshoots them', () => {
    const s = [{ t: 0, v: 0, c: 'smooth' as const }, { t: 1, v: 10, c: 'smooth' as const }, { t: 2, v: 10, c: 'smooth' as const }, { t: 3, v: 0 }];
    for (let t = 0; t <= 3; t += 0.01) {
      const v = pointsValueAt(s, t)!;
      expect(v).toBeGreaterThanOrEqual(-1e-9);
      expect(v).toBeLessThanOrEqual(10 + 1e-9);
    }
    expect(pointsValueAt(s, 1)).toBeCloseTo(10);
    expect(pointsValueAt(s, 1.5)).toBeCloseTo(10);
  });
  it('colours mix per channel', () => {
    const c = [{ t: 0, v: 0xff0000 }, { t: 1, v: 0x0000ff }];
    expect(pointsValueAt(c, 0.5, 'linear', true)).toBe((128 << 16) | 128);
  });
});

describe('combine, clamp, kinds', () => {
  it('drawn only', () => {
    expect(lineValueAt(line({ points: [{ t: 0, v: 2 }, { t: 2, v: 6 }] }), 1)).toBeCloseTo(4);
  });
  it('base + depth × range × source, clamped', () => {
    const l = line({ points: [{ t: 0, v: 2 }], follow: { source: { kind: 'beat', shape: 'saw', beats: 1 }, depth: 0.5 } });
    const tempo = createTempoMap(60, 0);
    // saw at quarter 0.5 = 0.5 → 2 + 0.5 × 10 × 0.5
    expect(lineValueAt(l, 0.5, { tempo })).toBeCloseTo(4.5);
    const big = line({ points: [{ t: 0, v: 8 }], follow: { source: { kind: 'beat', shape: 'square', beats: 1 }, depth: 1 } });
    expect(lineValueAt(big, 0.1, { tempo })).toBe(10);
    const down = line({ points: [{ t: 0, v: 3 }], follow: { source: { kind: 'beat', shape: 'square', beats: 1 }, depth: -1 } });
    expect(lineValueAt(down, 0.1, { tempo })).toBe(0);
  });
  it('drawn depth sets how much the source moves it; bipolar centres it', () => {
    const tempo = createTempoMap(60, 0);
    const l = line({ points: [{ t: 0, v: 5 }], follow: { source: { kind: 'beat', shape: 'square', beats: 1 }, depth: 1, depthPoints: [{ t: 0, v: 0 }, { t: 10, v: 0, c: 'hold' }, { t: 10.001, v: 0.2 }] } });
    expect(lineValueAt(l, 2.1, { tempo })).toBe(5);
    expect(lineValueAt(l, 12.1, { tempo })).toBeCloseTo(7);
    const bi = line({ points: [{ t: 0, v: 5 }], follow: { source: { kind: 'beat', shape: 'square', beats: 1 }, depth: 0.2, bipolar: true } });
    expect(lineValueAt(bi, 0.1, { tempo })).toBeCloseTo(7);
    expect(lineValueAt(bi, 0.6, { tempo })).toBeCloseTo(3);
  });
  it('follow without points rides on base / default', () => {
    const tempo = createTempoMap(60, 0);
    const l = line({ default: 1, follow: { source: { kind: 'beat', shape: 'square', beats: 1 }, depth: 0.1 } });
    expect(lineValueAt(l, 0.1, { tempo })).toBeCloseTo(2);
    expect(lineValueAt({ ...l, follow: { ...l.follow!, base: 4 } }, 0.1, { tempo })).toBeCloseTo(5);
  });
  it('stepped rounds to the step, bool switches at the middle', () => {
    const s = line({ kind: 'stepped', min: 0, max: 25, step: 1, points: [{ t: 0, v: 0, c: 'linear' }, { t: 1, v: 10 }] });
    expect(lineValueAt(s, 0.26)).toBe(3);
    const s2 = line({ kind: 'stepped', min: 0, max: 25, step: 1, points: [{ t: 0, v: 2 }, { t: 1, v: 10 }] });
    expect(lineValueAt(s2, 0.9)).toBe(2); // stepped lines hold by default
    const b = line({ kind: 'bool', min: 0, max: 1, points: [{ t: 0, v: 1 }, { t: 1, v: 0 }] });
    expect(lineValueAt(b, 0.5)).toBe(true);
    expect(lineValueAt(b, 1)).toBe(false);
  });
  it('colour follow mixes toward the follow colour', () => {
    const tempo = createTempoMap(60, 0);
    const c = line({ kind: 'colour', min: 0, max: 0xffffff, points: [{ t: 0, v: 0x000000 }], follow: { source: { kind: 'beat', shape: 'square', beats: 1 }, depth: 1, color: 0x00ff00 } });
    expect(lineValueAt(c, 0.1, { tempo })).toBe(0x00ff00);
    expect(lineValueAt(c, 0.6, { tempo })).toBe(0);
  });
  it('live-only sources add nothing during export, and follow the controller live', () => {
    const l = line({ points: [{ t: 0, v: 2 }], follow: { source: { kind: 'midi', cc: 7, channel: 0 }, depth: 1 } });
    expect(lineValueAt(l, 0, { liveInputs: false, midiCC: () => 1 })).toBe(2);
    expect(lineValueAt(l, 0, { liveInputs: true, midiCC: (ch, cc) => (ch === 0 && cc === 7 ? 0.5 : null) })).toBe(7);
    expect(lineValueAt({ ...l, follow: { source: { kind: 'live-level', track: 2 }, depth: 1 } }, 0, { liveLevel: (t) => (t === 2 ? 0.1 : 0) })).toBeCloseTo(3);
  });
  it('a touched value replaces the line', () => {
    expect(lineValueAt(line({ points: [{ t: 0, v: 2 }] }), 0, { touch: new Map([['l1', 9]]) })).toBe(9);
    expect(lineValueAt(line({ points: [{ t: 0, v: 2 }] }), 0, { touch: new Map([['l1', 99]]) })).toBe(10);
  });
  it('beat shapes', () => {
    expect(beatShapeValue('sine', 0)).toBeCloseTo(0);
    expect(beatShapeValue('sine', 0.5)).toBeCloseTo(1);
    expect(beatShapeValue('triangle', 0.25)).toBeCloseTo(0.5);
    expect(beatShapeValue('ramp', 0.25)).toBeCloseTo(0.75);
    expect(beatShapeValue('pulse', 0)).toBe(1);
  });
  it('bar-locked LFO follows the tempo map', () => {
    const tempo = createTempoMap(120, 1); // bar 1 at 1 s, a beat every 0.5 s
    const l = line({ points: [{ t: 0, v: 0 }], follow: { source: { kind: 'beat', shape: 'saw', beats: 4 }, depth: 1 } });
    expect(lineValueAt(l, 1, { tempo })).toBeCloseTo(0);
    expect(lineValueAt(l, 2, { tempo })).toBeCloseTo(5);
    expect(lineValueAt(l, 2.999, { tempo })).toBeCloseTo(10, 1);
  });
});

describe('music following is deterministic and offline', () => {
  const rate = 22050;
  const song = analyzeSongFeatures(drumLoop(8, rate), rate);
  const placed: PlacedSong[] = [{ trackId: 'a1', startTime: 2, offset: 0, features: song }];
  const kick = line({ follow: { source: { kind: 'audio', feature: 'kick' }, depth: 1 } });

  it('features are 0..1 and find the kicks and the louder half', () => {
    for (const f of Object.values(song.features)) for (const v of f) expect(v >= 0 && v <= 1).toBe(true);
    const at = (t: number) => lineValueAt(kick, t, { songs: placed }) as number;
    // A kick lands every 0.5 s of song time (song starts at show time 2).
    expect(at(2 + 4.03)).toBeGreaterThan(at(2 + 4.3));
    const energy = line({ follow: { source: { kind: 'audio', feature: 'energy' }, depth: 1 } });
    expect(lineValueAt(energy, 2 + 6, { songs: placed }) as number).toBeGreaterThan(lineValueAt(energy, 2 + 1.5, { songs: placed }) as number);
    // Before the song starts the source has no value: the base stays.
    expect(lineValueAt({ ...kick, default: 3 }, 1, { songs: placed })).toBe(3);
  });

  it('the same show time gives the same value: scrub = play = export', () => {
    const lines = [kick, line({ id: 'l2', key: 'layer:opacity', min: 0, max: 1, follow: { source: { kind: 'stem', stem: 'drums' }, depth: 1, smooth: 0.2 } })];
    const times = Array.from({ length: 300 }, (_, i) => 2 + i / 60);
    const play = createLineEvaluator();
    const played = times.map((t) => snapshotFrame(play.evaluate(lines, t, { songs: placed })));
    const scrub = createLineEvaluator();
    // Scrub: jump around in a fixed shuffled order (backwards, far, near).
    const order = [...times.keys()].map((i) => (i * 97) % times.length);
    for (const i of order) {
      const f = snapshotFrame(scrub.evaluate(lines, times[i], { songs: placed }));
      expect(f.layers.get('L1')).toEqual(played[i].layers.get('L1'));
    }
  });

  it('the analysis runs once per song and is cached', async () => {
    clearSongFeatureCache();
    const before = songFeatureAnalysisCount();
    let decodes = 0;
    const load = async () => { decodes++; return { mono: drumLoop(2, rate), sampleRate: rate }; };
    const [a, b] = await Promise.all([songFeaturesFor('song.wav', load), songFeaturesFor('song.wav', load)]);
    const c = await songFeaturesFor('song.wav', load);
    expect(a).toBe(b);
    expect(c).toBe(a);
    expect(decodes).toBe(1);
    expect(songFeatureAnalysisCount() - before).toBe(1);
  });
});

describe('frames', () => {
  it('groups by piece, stage and LEDs, drops disabled lines and merges over lanes', () => {
    const lines = normalizeLines([
      { id: 'a', target: { scope: 'layer', id: 'L1' }, key: 'transform:x', kind: 'continuous', min: -1, max: 1, points: [{ t: 0, v: 0.5 }] },
      { id: 'b', target: { scope: 'stage' }, key: 'stage:fx:b1:opacity', kind: 'continuous', min: 0, max: 1, points: [{ t: 0, v: 0.2 }] },
      { id: 'c', target: { scope: 'led' }, key: 'led:c1:brightness', kind: 'continuous', min: 0, max: 1, points: [{ t: 0, v: 0.7 }] },
      { id: 'd', target: { scope: 'layer', id: 'L1' }, key: 'layer:opacity', kind: 'continuous', min: 0, max: 1, points: [{ t: 0, v: 0 }], enabled: false },
      { id: 'bad' },
    ]);
    expect(lines).toHaveLength(4);
    const frame = createLineEvaluator().evaluate(lines, 1);
    expect(frame.layers.get('L1')).toEqual({ 'transform:x': 0.5 });
    expect(frame.stage).toEqual({ 'stage:fx:b1:opacity': 0.2 });
    expect(frame.leds).toEqual({ 'led:c1:brightness': 0.7 });
    expect(mergeLineValues({ 'transform:x': 0, 'layer:opacity': 1 }, frame, 'L1')).toEqual({ 'transform:x': 0.5, 'layer:opacity': 1 });
    expect(mergeLineValues(null, frame, 'nope')).toBeNull();
  });

  it('save format round-trips', () => {
    const l: ControlLine = line({ points: [{ t: 0, v: 1, c: 'smooth' }], follow: { source: { kind: 'stem', stem: 'vocals', track: 'a1' }, depth: -0.3, smooth: 0.1, bipolar: true } });
    expect(normalizeLines(JSON.parse(JSON.stringify([l])))).toEqual([l]);
  });
});

describe('performance', () => {
  it('500 lines at 60 fps stays far inside the frame budget', () => {
    const rate = 22050;
    const songs: PlacedSong[] = [{ trackId: 'a', startTime: 0, offset: 0, features: analyzeSongFeatures(drumLoop(20, rate), rate) as SongFeatures }];
    const tempo = createTempoMap(124, 0);
    const lines: ControlLine[] = [];
    for (let i = 0; i < 500; i++) {
      const points = Array.from({ length: 40 }, (_, k) => ({ t: k * 0.5, v: (k * 37 + i) % 10, c: (['linear', 'smooth', 'hold', 'sine'] as const)[k % 4] }));
      const follow = i % 3 === 0 ? { source: { kind: 'audio' as const, feature: 'kick' as const }, depth: 0.3 }
        : i % 3 === 1 ? { source: { kind: 'beat' as const, shape: 'sine' as const, beats: 4 }, depth: 0.2 } : undefined;
      lines.push(line({ id: `l${i}`, target: { scope: 'layer', id: `L${i % 40}` }, key: `shader:p${i}`, points, follow }));
    }
    const ev = createLineEvaluator();
    ev.evaluate(lines, 0, { songs, tempo });
    const frames = 600;
    const start = performance.now();
    for (let f = 0; f < frames; f++) ev.evaluate(lines, f / 60, { songs, tempo });
    const perFrame = (performance.now() - start) / frames;
    console.log(`[lines perf] 500 lines: ${perFrame.toFixed(3)} ms per frame`);
    expect(perFrame).toBeLessThan(2);
  });
});
