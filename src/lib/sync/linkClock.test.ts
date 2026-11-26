import { describe, expect, it } from 'vitest';
import { LinkClockMap } from './linkClock';

describe('Link clock to performance.now()', () => {
  it('maps from the midpoint of a round trip', () => {
    const map = new LinkClockMap();
    expect(map.toPerfMs(1_000_000)).toBeNull();
    // Link read 5_000_000 µs somewhere between 100 and 110 ms.
    map.add({ sentMs: 100, receivedMs: 110, micros: 5_000_000 });
    expect(map.toPerfMs(5_000_000)).toBe(105);
    expect(map.toPerfMs(5_250_000)).toBe(355);
    expect(map.toLinkMicros(105)).toBe(5_000_000);
  });

  it('trusts the shortest round trip among recent polls', () => {
    const map = new LinkClockMap();
    // True offset: perf = micros/1000 - 4900. Slow replies come back late and
    // lopsided; the quick one is right to within half its round trip.
    map.add({ sentMs: 100, receivedMs: 140, micros: 5_002_000 });
    map.add({ sentMs: 350, receivedMs: 351, micros: 5_250_500 });
    map.add({ sentMs: 600, receivedMs: 630, micros: 5_501_000 });
    expect(map.uncertaintyMs).toBe(1);
    expect(map.toPerfMs(6_000_000)).toBeCloseTo(1100, 6);
  });

  it('drops impossible samples and forgets on clear', () => {
    const map = new LinkClockMap();
    expect(map.add({ sentMs: 10, receivedMs: 5, micros: 1 })).toBe(false);
    expect(map.add({ sentMs: 10, receivedMs: 12, micros: Number.NaN })).toBe(false);
    expect(map.ready).toBe(false);
    map.add({ sentMs: 10, receivedMs: 12, micros: 0 });
    expect(map.ready).toBe(true);
    map.clear();
    expect(map.toPerfMs(0)).toBeNull();
  });
});
