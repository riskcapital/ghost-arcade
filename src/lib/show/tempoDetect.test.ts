import { describe, expect, it } from 'vitest';
import type { ShowAudioTrack } from '../types';
import { tempoMapForTrack, tempoSourceTrack } from './tempoDetect';
import { barBeatAt } from './tempoMap';

const track = (id: string, duration: number, extra: Partial<ShowAudioTrack> = {}): ShowAudioTrack => ({
  id, name: id, url: `blob:${id}`, startTime: 0, duration, offset: 0, sourceDuration: duration, volume: 1, muted: false, lane: 0, ...extra,
});

describe('detect tempo', () => {
  it('reads the named track, else the longest one that can play', () => {
    const tracks = [track('a', 30), track('b', 200), track('c', 400, { url: '' })];
    expect(tempoSourceTrack(tracks)?.id).toBe('b');
    expect(tempoSourceTrack(tracks, 'a')?.id).toBe('a');
    expect(tempoSourceTrack([])).toBeNull();
  });

  it('puts bar 1 on the first beat at or after the in-point, in show time', () => {
    // The song sits at 12 s on the show, trimmed to start 3 s into the file.
    const beats = Array.from({ length: 60 }, (_, i) => 0.012 + i * (60 / 124));
    const map = tempoMapForTrack({ tempo: 124, beats }, { id: 't', startTime: 12, offset: 3 })!;
    const firstBeat = beats.find((b) => b >= 3)!;
    expect(map.offset).toBeCloseTo(12 + firstBeat - 3, 9);
    expect(map.segments[0].bpm).toBe(124);
    expect(map).toMatchObject({ source: 'analysis', analysedTrackId: 't' });
    // Every later detected beat lands on a grid beat.
    for (const b of beats.filter((x) => x >= 3)) {
      const f = barBeatAt(map, 12 + b - 3).fraction;
      expect(Math.min(f, 1 - f)).toBeLessThan(1e-6);
    }
    expect(tempoMapForTrack({ tempo: null, beats: [] }, { id: 't', startTime: 0, offset: 0 })).toBeNull();
  });
});
