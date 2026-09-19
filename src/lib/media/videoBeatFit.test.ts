import { describe, expect, it } from 'vitest';
import { videoBeatFit } from './videoBeatFit';

describe('video beat fitting', () => {
  it('fits a trimmed reverse bounce round trip', () => {
    expect(videoBeatFit(20, .25, .75, 8, 120, true, -1)).toMatchObject({ rate: -5, limited: false, actualBeats: 8 });
  });
  it('reports attainable timing when either speed limit is reached', () => {
    expect(videoBeatFit(60, 0, 1, 1, 120)).toMatchObject({ rate: 8, limited: true, actualBeats: 15 });
    expect(videoBeatFit(.1, 0, 1, 16, 60)).toMatchObject({ rate: .05, limited: true, actualBeats: 2 });
  });
  it('preserves fractional tempo precision over ten minutes of ideal transport', () => {
    const bpm = 120.01;
    const fit = videoBeatFit(10, 0, 1, 4, bpm)!;
    expect(600 * fit.rate / 10 * 4).toBeCloseTo(600 * bpm / 60, 9);
  });
  it('rejects unknown duration and malformed ranges', () => {
    expect(videoBeatFit(NaN, 0, 1, 4, 120)).toBeNull();
    expect(videoBeatFit(10, .8, .2, 4, 120)).toBeNull();
    expect(videoBeatFit(10, 0, 1, 0, 120)).toBeNull();
  });
});
