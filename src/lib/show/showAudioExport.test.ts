import { describe, expect, it } from 'vitest';
import type { ShowAudioTrack } from '../types';
import { showMuxTracks, showTrackFilePath } from './showAudioExport';

function track(over: Partial<ShowAudioTrack>): ShowAudioTrack {
  return {
    id: 't', name: 'Song', url: '', startTime: 0, duration: 60, offset: 0, sourceDuration: 60,
    volume: 1, muted: false, lane: 0, ...over,
  };
}

describe('show soundtrack for Render to Video', () => {
  it('finds the file behind a track: its ghost-asset URL, or the picked file behind a blob', () => {
    expect(showTrackFilePath(track({ url: 'ghost-asset://localhost/Users/me/Music/My%20Song.wav' }))).toBe('/Users/me/Music/My Song.wav');
    expect(showTrackFilePath(track({ url: 'blob:abc', assetRef: { kind: 'local-file', originalPath: 'C:\\Music\\song.mp3' } }))).toBe('C:\\Music\\song.mp3');
    expect(showTrackFilePath(track({ url: 'blob:abc' }))).toBeNull();
  });

  it('keeps audible tracks with a file, with their place, trim and level', () => {
    const tracks = [
      track({ id: 'a', url: 'ghost-asset://localhost/m/a.wav', startTime: 4, offset: 2, duration: 30, volume: 0.8 }),
      track({ id: 'b', url: 'ghost-asset://localhost/m/b.wav', muted: true }),
      track({ id: 'c', url: 'ghost-asset://localhost/m/c.wav', volume: 0 }),
      track({ id: 'd', url: 'blob:nofile' }),
    ];
    expect(showMuxTracks(tracks)).toEqual([{ path: '/m/a.wav', startTime: 4, offset: 2, duration: 30, volume: 0.8 }]);
  });
});
