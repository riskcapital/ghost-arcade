import { describe, expect, it, vi } from 'vitest';

const media = vi.hoisted(() => ({ metadataOnly: false }));
vi.mock('$lib/media/sourceVideoElement', () => ({ sourceVideoIsMetadataOnly: () => media.metadataOnly }));

import { getVideoTrimAction, getVideoTrimBounds, syncTrimmedVideoPlayback } from './videoTrimPlayback';

function fakeVideo(currentTime: number) {
  return {
    duration: 10, currentTime, paused: true, loop: true,
    play: vi.fn(async () => {}), pause: vi.fn(),
    addEventListener() {}, removeEventListener() {},
  } as unknown as HTMLVideoElement & { play: ReturnType<typeof vi.fn> };
}

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

  it('restarts a looped element at trim-in, but never one that only carries metadata', () => {
    const state = { playbackMode: 'loop' as const, trimStart: 0.2, trimEnd: 0.5 };
    media.metadataOnly = false;
    const browserPlayed = fakeVideo(5);
    syncTrimmedVideoPlayback(browserPlayed, { ...state });
    expect(browserPlayed.currentTime).toBe(2);
    expect(browserPlayed.play).toHaveBeenCalledTimes(1);

    media.metadataOnly = true;
    const coreSide = fakeVideo(5);
    syncTrimmedVideoPlayback(coreSide, { ...state });
    expect(coreSide.currentTime).toBe(2);
    expect(coreSide.play).not.toHaveBeenCalled();
    media.metadataOnly = false;
  });
});
