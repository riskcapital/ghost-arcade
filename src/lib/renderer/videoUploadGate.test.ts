import { describe, expect, it } from 'vitest';
import { decodedFrameCount, judgeFrameCallbacks, type FrameCallbackReading, type FrameCallbackWindow } from './videoUploadGate';

const playing = (at: number, seq: number, time: number, decoded: number | null): FrameCallbackReading =>
  ({ at, seq, time, decoded, paused: false, seeking: false, rate: 1 });

/** Watch a video for `seconds`, one reading per editor frame (60 fps). */
function watch(seconds: number, callbacksPerSec: number, decodedPerSec: number | null) {
  let window: FrameCallbackWindow | null = null;
  const verdicts: string[] = [];
  for (let frame = 0; frame <= seconds * 60; frame++) {
    const t = frame / 60;
    const judged = judgeFrameCallbacks(window, playing(t * 1000, Math.floor(t * callbacksPerSec), t, decodedPerSec == null ? null : Math.floor(t * decodedPerSec)));
    window = judged.window;
    if (judged.verdict !== 'wait') verdicts.push(judged.verdict);
  }
  return verdicts;
}

describe('judgeFrameCallbacks', () => {
  it('trusts callbacks that keep up with the decoded frames', () => {
    expect(watch(3, 30, 30)).toEqual(['ok', 'ok', 'ok']);
    expect(watch(3, 60, 60)).toEqual(['ok', 'ok', 'ok']);
  });

  it('gives up on callbacks driven by a background timer (4 a second for a 30 fps clip)', () => {
    expect(watch(2, 4, 30)[0]).toBe('unreliable');
  });

  it('catches callbacks that run at half the video rate', () => {
    expect(watch(2, 15, 30)[0]).toBe('unreliable');
  });

  it('uses a minimum rate when the decoded-frame count is unknown', () => {
    expect(watch(2, 30, null)[0]).toBe('ok');
    expect(watch(2, 4, null)[0]).toBe('unreliable');
  });

  it('does not judge a paused, seeking or stalled video', () => {
    const start = judgeFrameCallbacks(null, playing(0, 0, 0, 0)).window;
    expect(judgeFrameCallbacks(start, { ...playing(2000, 0, 2, 60), paused: true }).verdict).toBe('wait');
    expect(judgeFrameCallbacks(start, { ...playing(2000, 0, 2, 60), seeking: true }).verdict).toBe('wait');
    // Media time did not move (buffering), or jumped back (a loop).
    expect(judgeFrameCallbacks(start, playing(2000, 0, 0.1, 0)).verdict).toBe('wait');
    expect(judgeFrameCallbacks({ ...start, time: 5 }, playing(2000, 0, 0.5, 60)).verdict).toBe('wait');
  });
});

describe('decodedFrameCount', () => {
  it('reads the playback quality when the browser reports it', () => {
    expect(decodedFrameCount({ getVideoPlaybackQuality: () => ({ totalVideoFrames: 42 }) })).toBe(42);
    expect(decodedFrameCount({})).toBeNull();
    expect(decodedFrameCount({ getVideoPlaybackQuality: () => { throw new Error('no'); } })).toBeNull();
  });
});
