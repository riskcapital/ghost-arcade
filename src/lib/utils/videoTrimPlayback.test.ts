import { describe, expect, it } from 'vitest';
import { getVideoTrimAction, getVideoTrimBounds } from './videoTrimPlayback';

describe('trim-aware video playback', () => {
  it('loops a trimmed clip back to trim-in instead of source frame zero', () => {
    const state = { playbackMode: 'loop' as const, trimStart: 0.25, trimEnd: 0.75 };
    expect(getVideoTrimBounds(20, state)).toEqual({ start: 5, end: 15 });
    expect(getVideoTrimAction(14.98, 20, state)).toBe('loop');
    expect(getVideoTrimAction(0, 20, state)).toBe('clamp-start');
  });

  it('stops once-mode clips at trim-out', () => {
    const state = { playbackMode: 'once' as const, trimStart: 0.1, trimEnd: 0.6 };
    expect(getVideoTrimAction(6, 10, state)).toBe('stop');
  });

  it('does not interfere with timelapse playback', () => {
    const state = { playbackMode: 'timelapse' as const, trimStart: 0.2, trimEnd: 0.8 };
    expect(getVideoTrimAction(9, 10, state)).toBeNull();
  });
});
