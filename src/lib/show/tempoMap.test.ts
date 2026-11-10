import { describe, expect, it } from 'vitest';
import {
  barBeatAt,
  beatAtSeconds,
  createTempoMap,
  formatBarsBeats,
  gridStepSeconds,
  nearestGridTime,
  normalizeTempoMap,
  rulerTicks,
  secondsAtBar,
  secondsAtBeat,
  tempoFromAnalysis,
} from './tempoMap';

describe('tempo map', () => {
  it('round-trips seconds and quarter notes on a single tempo', () => {
    const map = createTempoMap(120, 2);
    for (const t of [-3, 0, 2, 2.25, 7.5, 100.123]) {
      expect(secondsAtBeat(map, beatAtSeconds(map, t))).toBeCloseTo(t, 9);
    }
    expect(beatAtSeconds(map, 2)).toBe(0);
    expect(beatAtSeconds(map, 3)).toBeCloseTo(2, 9);
    expect(secondsAtBar(map, 2)).toBeCloseTo(4, 9);
  });

  it('reads bars and beats, 1-based', () => {
    const map = createTempoMap(120, 0);
    expect(barBeatAt(map, 0)).toMatchObject({ bar: 1, beat: 1 });
    expect(barBeatAt(map, 0.5)).toMatchObject({ bar: 1, beat: 2 });
    expect(barBeatAt(map, 2)).toMatchObject({ bar: 2, beat: 1 });
    expect(barBeatAt(map, 2.75)).toMatchObject({ bar: 2, beat: 2, fraction: 0.5 });
    expect(formatBarsBeats(map, 2.75)).toBe('2.2');
    expect(formatBarsBeats(map, 2.75, true)).toBe('2.2.3');
  });

  it('counts bars before bar 1', () => {
    const map = createTempoMap(120, 4);
    expect(barBeatAt(map, 3.5)).toMatchObject({ bar: 0, beat: 4 });
    expect(barBeatAt(map, 0)).toMatchObject({ bar: -1, beat: 1 });
    expect(secondsAtBar(map, 0)).toBeCloseTo(2, 9);
    expect(nearestGridTime(map, 1.1, 'bar')).toBeCloseTo(2, 9);
  });

  it('handles 6/8: six eighth-note beats, three quarters per bar', () => {
    const map = createTempoMap(120, 0, 6, 8);
    // A bar is 3 quarter notes = 1.5 s at 120 BPM; each beat is 0.25 s.
    expect(secondsAtBar(map, 2)).toBeCloseTo(1.5, 9);
    expect(barBeatAt(map, 0.25)).toMatchObject({ bar: 1, beat: 2 });
    expect(barBeatAt(map, 1.25)).toMatchObject({ bar: 1, beat: 6 });
    expect(barBeatAt(map, 1.5)).toMatchObject({ bar: 2, beat: 1 });
    expect(gridStepSeconds(map, 0, 'beat')).toBeCloseTo(0.25, 9);
    expect(nearestGridTime(map, 0.3, 'beat')).toBeCloseTo(0.25, 9);
  });

  it('follows tempo changes across segments', () => {
    const map = normalizeTempoMap({
      offset: 0,
      source: 'manual',
      segments: [
        { bar: 1, bpm: 120, beatsPerBar: 4, beatUnit: 4 },
        { bar: 3, bpm: 60, beatsPerBar: 3, beatUnit: 4 },
      ],
    })!;
    // Bars 1-2 at 120 = 4 s; then 3/4 at 60 = 3 s a bar.
    expect(secondsAtBar(map, 3)).toBeCloseTo(4, 9);
    expect(secondsAtBar(map, 4)).toBeCloseTo(7, 9);
    expect(barBeatAt(map, 5)).toMatchObject({ bar: 3, beat: 2 });
    expect(beatAtSeconds(map, 5)).toBeCloseTo(9, 9);
    for (const t of [0.3, 3.9, 4, 4.01, 12]) expect(secondsAtBeat(map, beatAtSeconds(map, t))).toBeCloseTo(t, 9);
    expect(nearestGridTime(map, 3.95, 'beat')).toBeCloseTo(4, 9);
    expect(nearestGridTime(map, 5.4, 'beat')).toBeCloseTo(5, 9);
  });

  it('normalises junk and forces the first segment onto bar 1', () => {
    expect(normalizeTempoMap(null)).toBeNull();
    expect(normalizeTempoMap({ segments: [] })).toBeNull();
    const m = normalizeTempoMap({ offset: 'x', segments: [{ bar: 5, bpm: 9999, beatsPerBar: 0, beatUnit: 3 }] })!;
    expect(m.offset).toBe(0);
    expect(m.segments[0]).toEqual({ bar: 1, bpm: 400, beatsPerBar: 4, beatUnit: 4 });
  });

  it('snaps to bars, beats and sub-beats', () => {
    const map = createTempoMap(120, 0.1);
    expect(nearestGridTime(map, 2.0, 'bar')).toBeCloseTo(2.1, 9);
    expect(nearestGridTime(map, 0.4, 'beat')).toBeCloseTo(0.6, 9);
    expect(nearestGridTime(map, 0.4, 'half')).toBeCloseTo(0.35, 9);
    expect(nearestGridTime(map, 0.4, 'sixteenth')).toBeCloseTo(0.35, 9);
    expect(nearestGridTime(map, 0.4, 'seconds')).toBe(0.4);
  });

  it('builds ruler ticks with bar numbers and beats', () => {
    const map = createTempoMap(120, 0);
    const ticks = rulerTicks(map, 0, 4, 50);
    expect(ticks.filter((t) => t.kind === 'bar').map((t) => t.bar)).toEqual([1, 2, 3]);
    expect(ticks.filter((t) => t.kind === 'beat')).toHaveLength(6);
    // Zoomed far out the beats disappear and bar labels thin out.
    const sparse = rulerTicks(map, 0, 64, 2);
    expect(sparse.some((t) => t.kind === 'beat')).toBe(false);
    expect(sparse.filter((t) => t.label).length).toBeLessThan(sparse.length);
  });

  it('seeds from analysis at the first beat after the in-point', () => {
    const map = tempoFromAnalysis({ tempo: 128, beats: [0.2, 0.67, 1.14] }, { id: 'a', startTime: 10, offset: 0.5 })!;
    expect(map.offset).toBeCloseTo(10.17, 9);
    expect(map.segments[0].bpm).toBe(128);
    expect(map.source).toBe('analysis');
    expect(map.analysedTrackId).toBe('a');
    expect(tempoFromAnalysis({ tempo: null, beats: [] }, { startTime: 0, offset: 0 })).toBeNull();
  });
});
