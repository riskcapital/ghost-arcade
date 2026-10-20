import { describe, expect, it } from 'vitest';
import { deriveSongs, mixPosition, nextSong, orderSongs, parseBpm, stripBpm } from './abletonSetlist';
import type { LiveScene, LiveTrack } from './abletonLinks';

const track = (name: string, side: 'A' | 'B' | null, clips: (string | null)[]): LiveTrack => ({
  name, color: 0, midi: false, side, playing: -1, fired: -1, startedBeat: 0, firedBeat: 0,
  slots: clips.map(c => (c === null ? null : { name: c, color: 0, length: 16 })),
});
const scene = (name: string): LiveScene => ({ name, color: 0, queued: false });

describe('tempo in names', () => {
  it('reads and strips BPM', () => {
    expect(parseBpm('Techno 130 BPM')).toBe(130);
    expect(parseBpm('Garage Room-135bpm')).toBe(135);
    expect(parseBpm('Drop')).toBeNull();
    expect(stripBpm('Deep Hours Intro 122 BPM')).toBe('Deep Hours Intro');
  });
});

describe('deck sets', () => {
  const tracks = [track('Deck A', 'A', ['House 122 BPM', null, 'Techno 125 BPM']), track('Deck B', 'B', ['Garage 135 BPM']), track('FX', null, ['Riser'])];
  it('lists every clip on a deck track as a song', () => {
    const songs = deriveSongs([], tracks);
    expect(songs.map(s => [s.title, s.bpm])).toEqual([['House', 122], ['Techno', 125], ['Garage', 135]]);
  });
  it('alternates decks when there is no saved order', () => {
    expect(orderSongs(deriveSongs([], tracks), []).map(s => s.title)).toEqual(['House', 'Garage', 'Techno']);
  });
  it('keeps a saved order and appends new songs', () => {
    const songs = deriveSongs([], tracks);
    expect(orderSongs(songs, [songs[1].key]).map(s => s.title)).toEqual(['Techno', 'House', 'Garage']);
  });
});

describe('stems sets', () => {
  it('groups scenes into songs at each tempo change', () => {
    const scenes = ['Deep Hours Intro 122 BPM', 'Deep Hours Groove', 'Deep Hours Drop', 'Night Shift Groove 128 BPM', 'Night Shift Drop'].map(scene);
    const tracks = [track('Drums', null, ['a', 'b', 'c', 'd', 'e'])];
    const songs = deriveSongs(scenes, tracks);
    expect(songs.map(s => s.title)).toEqual(['Deep Hours', 'Night Shift']);
    const first = songs[0];
    expect(first.kind === 'scenes' && first.sections.map(x => x.label)).toEqual(['Intro', 'Groove', 'Drop']);
    expect(first.bpm).toBe(122);
  });
});

describe('next song', () => {
  const songs = deriveSongs([], [track('A', 'A', ['One', 'Two', 'Three'])]);
  it('skips what already played and wraps around', () => {
    expect(nextSong(songs, songs[0].key, new Set([songs[0].key]))?.title).toBe('Two');
    expect(nextSong(songs, songs[2].key, new Set([songs[2].key, songs[1].key]))?.title).toBe('One');
    expect(nextSong(songs, songs[0].key, new Set(songs.map(s => s.key)))).toBeNull();
  });
});

it('eases the crossfader across a mix', () => {
  expect(mixPosition(0, 1, 16, 32, 16)).toBe(0);
  expect(mixPosition(0, 1, 16, 32, 32)).toBeCloseTo(0.5);
  expect(mixPosition(0, 1, 16, 32, 60)).toBe(1);
  expect(mixPosition(1, 0, 0, 0, 5)).toBe(0);
});
