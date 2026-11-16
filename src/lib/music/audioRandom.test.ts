import { describe, expect, it } from 'vitest';
import { effectRandom, hashString, seededRandom } from './audioRandom';

describe('effect noise', () => {
  it('is a fixed sequence per key on an offline context, Math.random live', () => {
    class FakeOffline {}
    const g = globalThis as { OfflineAudioContext?: unknown };
    const real = g.OfflineAudioContext;
    g.OfflineAudioContext = FakeOffline;
    try {
      const a = effectRandom(new FakeOffline() as never, 'reverb:2.1:0.5:0.4');
      const b = effectRandom(new FakeOffline() as never, 'reverb:2.1:0.5:0.4');
      const c = effectRandom(new FakeOffline() as never, 'reverb:4.0:0.5:0.4');
      const seq = (r: () => number) => [r(), r(), r()];
      const sa = seq(a);
      expect(seq(b)).toEqual(sa);
      expect(seq(c)).not.toEqual(sa);
      expect(sa.every((x) => x >= 0 && x < 1)).toBe(true);
      expect(effectRandom({} as never, 'reverb')).toBe(Math.random);
    } finally {
      g.OfflineAudioContext = real;
    }
    expect(seededRandom(hashString('x'))()).toBe(seededRandom(hashString('x'))());
  });
});
