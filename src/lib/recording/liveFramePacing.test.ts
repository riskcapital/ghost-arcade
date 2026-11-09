import { describe, expect, it } from 'vitest';
import { liveFrameRepeat } from './liveFramePacing';

describe('live frame pacing', () => {
  it('writes one slot per capture when captures keep up', () => {
    expect(liveFrameRepeat(0, 0, 30)).toBe(1);
    expect(liveFrameRepeat(1, 34, 30)).toBe(1);
    expect(liveFrameRepeat(2, 67, 30)).toBe(1);
  });

  it('fills the slots a late capture missed so playback stays real time', () => {
    // 23 fps view recorded at 30 fps: the second capture lands at 87 ms,
    // which is slot 2, so it covers slots 1 and 2.
    expect(liveFrameRepeat(1, 87, 30)).toBe(2);
    // One second in with 20 frames queued: due 31 → write 11.
    expect(liveFrameRepeat(20, 1000, 30)).toBe(11);
  });

  it('never writes less than one slot or more than five seconds at once', () => {
    expect(liveFrameRepeat(100, 1000, 30)).toBe(1);
    expect(liveFrameRepeat(0, 60_000, 30)).toBe(150);
  });
});
