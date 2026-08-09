import { describe, expect, it } from 'vitest';
import { resolveSplatAnimationClock, smoothSplatAudio } from './splatMotion';

describe('splat motion clock', () => {
  it('keeps a continuous phase instead of reversing each cycle', () => {
    const first = resolveSplatAnimationClock({
      time: 0.25,
      speed: 1,
      loop: true,
      pingPong: false,
      manualProgress: 0,
    });
    const second = resolveSplatAnimationClock({
      time: 1.25,
      speed: 1,
      loop: true,
      pingPong: false,
      manualProgress: 0,
    });

    expect(second.phase).toBeGreaterThan(first.phase);
    expect(first.progress).toBeCloseTo(second.progress);
  });

  it('only reverses when ping pong is explicitly enabled', () => {
    const outbound = resolveSplatAnimationClock({
      time: 0.25,
      speed: 1,
      loop: true,
      pingPong: true,
      manualProgress: 0,
    });
    const returned = resolveSplatAnimationClock({
      time: 0.75,
      speed: 1,
      loop: true,
      pingPong: true,
      manualProgress: 0,
    });

    expect(outbound.progress).toBeCloseTo(returned.progress);
  });
});

describe('splat audio response', () => {
  it('smooths input without swallowing the response', () => {
    expect(smoothSplatAudio(0, 1, 0.7)).toBeCloseTo(0.3);
    expect(smoothSplatAudio(0.3, 1, 0)).toBe(1);
  });
});
