/** LFO shapes stay in 0..1 for negative positions (a show before its bar 1). */
import { describe, expect, it } from 'vitest';
import { cyclePhase, lfoValue, type LfoShape } from './lfoShape';

describe('LFO shapes', () => {
  it('stay in range and keep their phase on negative beats', () => {
    for (const shape of ['sine', 'saw', 'square', 'tri'] as LfoShape[]) {
      for (let x = -8.03; x <= 8; x += 0.0625) {
        const v = lfoValue(shape, x);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
        // Periodic across zero: one cycle before reads the same.
        expect(lfoValue(shape, x - 1)).toBeCloseTo(v, 9);
      }
    }
    // A quarter of a beat before bar 1 is three quarters into the saw.
    expect(lfoValue('saw', -0.25)).toBeCloseTo(0.75, 9);
    expect(lfoValue('tri', -0.25)).toBeCloseTo(0.5, 9);
    expect(lfoValue('saw', 2.25)).toBeCloseTo(0.25, 9);
    expect(cyclePhase(-1e-17)).toBeLessThan(1);
    expect(cyclePhase(NaN)).toBe(0);
  });
});
