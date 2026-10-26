import { describe, expect, it } from 'vitest';
import { showEnvelope } from './showEnvelope';

const track = (over: Partial<Parameters<typeof showEnvelope>[0][number]> = {}) => ({
  startTime: 0,
  duration: 10,
  offset: 0,
  sourceDuration: 10,
  volume: 1,
  muted: false,
  peaks: [255, 0, 255, 0, 255, 0, 255, 0, 255, 0],
  ...over,
});

describe('showEnvelope', () => {
  it('lays a track on show time', () => {
    expect(showEnvelope([track()], 10, 10)).toEqual([1, 0, 1, 0, 1, 0, 1, 0, 1, 0]);
  });

  it('is silent outside the track, and follows its start, trim and level', () => {
    const env = showEnvelope([track({ startTime: 5, duration: 4, offset: 2, volume: 0.5 })], 10, 10);
    expect(env.slice(0, 5)).toEqual([0, 0, 0, 0, 0]);
    // Show 5..9 plays source 2..6: peaks 255, 0, 255, 0 at half level.
    expect(env.slice(5, 9)).toEqual([0.5, 0, 0.5, 0]);
    expect(env[9]).toBe(0);
  });

  it('takes the louder track where two overlap, and skips muted ones', () => {
    const loud = track({ peaks: new Array(10).fill(200) });
    const quiet = track({ peaks: new Array(10).fill(100) });
    const muted = track({ peaks: new Array(10).fill(255), muted: true });
    expect(showEnvelope([quiet, loud, muted], 10, 2)).toEqual([200 / 255, 200 / 255]);
  });

  it('is flat for an empty show or tracks without a waveform', () => {
    expect(showEnvelope([], 0, 4)).toEqual([0, 0, 0, 0]);
    expect(showEnvelope([track({ peaks: undefined })], 10, 3)).toEqual([0, 0, 0]);
  });
});
