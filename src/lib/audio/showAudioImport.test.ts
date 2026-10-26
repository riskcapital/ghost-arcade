import { describe, expect, it } from 'vitest';
import { isShowAudioFile, needsAudioConversion, unplayableAudioMessage } from './showAudioImport';

describe('show audio files', () => {
  it('accepts audio by type or by extension', () => {
    expect(isShowAudioFile('song.mp3')).toBe(true);
    expect(isShowAudioFile('SONG.AIFF')).toBe(true);
    expect(isShowAudioFile('take', 'audio/wav')).toBe(true);
    expect(isShowAudioFile('clip.mov', 'video/quicktime')).toBe(false);
    expect(isShowAudioFile('notes.txt')).toBe(false);
  });

  it('converts what Chromium cannot play, and only that', () => {
    expect(needsAudioConversion('song.aif')).toBe(true);
    expect(needsAudioConversion('song.aiff')).toBe(true);
    expect(needsAudioConversion('mix.wma')).toBe(true);
    expect(needsAudioConversion('unnamed', 'audio/x-aiff')).toBe(true);
    for (const name of ['a.mp3', 'a.wav', 'a.m4a', 'a.flac', 'a.ogg', 'a.opus', 'a.aac']) {
      expect(needsAudioConversion(name)).toBe(false);
    }
  });

  it('says what to use instead', () => {
    expect(unplayableAudioMessage('x.xyz')).toContain('x.xyz');
    expect(unplayableAudioMessage('x.xyz')).toContain('WAV, MP3, M4A, FLAC or OGG');
  });
});
