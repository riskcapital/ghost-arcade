import { describe, expect, it } from 'vitest';
import { fileExtension, isAudioFile, isVideoFile, mediaFileKind, VIDEO_FILE_ACCEPT } from './mediaFileKind';

describe('media file kind', () => {
  it('recognises show video formats Chromium gives no video MIME type', () => {
    for (const name of ['show.mxf', 'clip.MKV', 'loop.mov', 'take.m2ts', 'deck.mts', 'old.avi']) {
      expect(mediaFileKind({ name, type: '' }), name).toBe('video');
    }
    // A wrong MIME type does not turn a .mov into an image.
    expect(isVideoFile({ name: 'hap-loop.mov', type: 'application/octet-stream' })).toBe(true);
  });

  it('still trusts a video MIME type when the name has no known extension', () => {
    expect(mediaFileKind({ name: 'download', type: 'video/mp4' })).toBe('video');
  });

  it('separates songs from pictures, so audio is never added as an image', () => {
    expect(isAudioFile({ name: 'track.wav', type: 'audio/wav' })).toBe(true);
    expect(mediaFileKind({ name: 'mix.mp3', type: '' })).toBe('audio');
    expect(mediaFileKind({ name: 'stem', type: 'audio/flac' })).toBe('audio');
    expect(mediaFileKind({ name: 'logo.png', type: 'image/png' })).toBe('image');
  });

  it('keeps shaders and HTML animations apart and reports anything else as unknown', () => {
    expect(mediaFileKind({ name: 'tunnel.fs' })).toBe('shader');
    expect(mediaFileKind({ name: 'sketch.HTML' })).toBe('html');
    expect(mediaFileKind({ name: 'notes.txt', type: 'text/plain' })).toBe('unknown');
    expect(fileExtension('/a/b.c/Clip.MOV?x=1')).toBe('mov');
  });

  it('offers every recognised video in file pickers', () => {
    expect(VIDEO_FILE_ACCEPT).toContain('video/*');
    expect(VIDEO_FILE_ACCEPT).toContain('.mxf');
    expect(VIDEO_FILE_ACCEPT).toContain('.mov');
  });
});
