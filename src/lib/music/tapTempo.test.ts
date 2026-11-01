import { describe, expect, it } from 'vitest';
import { launchClockPosition, resyncLaunchClock } from '../stores/launchClock';
import { TAP_RESET_MS, addTap, emptyTaps, msToNextBeat, scaleTempo, tapBpm } from './tapTempo';

const tapAt = (times: number[]) => times.reduce(addTap, emptyTaps());

describe('tap tempo', () => {
  it('needs four taps, then averages the gaps', () => {
    expect(tapBpm(tapAt([0, 500, 1000]))).toBeNull();
    expect(tapBpm(tapAt([0, 500, 1000, 1500]))).toBe(120);
    expect(tapBpm(tapAt([0, 830, 1650, 2480, 3300]))).toBeCloseTo(72.7, 0);
  });

  it('leaves a stray tap out', () => {
    // A flam (a tap far too soon) and a missed beat do not drag the tempo.
    expect(tapBpm(tapAt([0, 500, 1000, 1120, 1500, 2000, 2500]))).toBeCloseTo(120, 0);
    expect(tapBpm(tapAt([0, 500, 1000, 2000, 2500, 3000]))).toBeCloseTo(120, 0);
  });

  it('starts a fresh count after a pause', () => {
    const s = tapAt([0, 500, 1000, 1500, 1500 + TAP_RESET_MS + 1]);
    expect(s.taps).toHaveLength(1);
    expect(tapBpm(s)).toBeNull();
  });

  it('halves and doubles inside the clock range', () => {
    expect(scaleTempo(140, 0.5)).toBe(70);
    expect(scaleTempo(72, 2)).toBe(144);
    expect(scaleTempo(200, 2)).toBe(200);
  });

  it('waits for the next beat before the tempo changes', () => {
    expect(msToNextBeat(8, 500)).toBe(0);
    expect(msToNextBeat(8.25, 500)).toBeCloseTo(375);
  });

  it('moves the bar to the downbeat without changing the tempo', () => {
    const before = launchClockPosition(10_000);
    expect(resyncLaunchClock(10_000)).toBe(true);
    const at = launchClockPosition(10_000);
    expect(at.beat).toBeCloseTo(0, 3);
    expect(at.beatMs).toBeCloseTo(before.beatMs, 3);
    // A bar later it is on beat 4 (the next downbeat).
    expect(launchClockPosition(10_000 + 4 * at.beatMs).beat).toBeCloseTo(4, 3);
  });
});
