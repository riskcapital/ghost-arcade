import { describe, expect, it } from 'vitest';
import { computeWLEDSamplingGrid } from './sampling';

describe('computeWLEDSamplingGrid', () => {
  it('spreads a typical strip count across a spatial 16:9 grid', () => {
    expect(computeWLEDSamplingGrid(32, 16 / 9)).toEqual({ columns: 8, rows: 4 });
  });

  it('keeps enough cells for every LED without exceeding protocol limits', () => {
    const grid = computeWLEDSamplingGrid(490, 9 / 16);
    expect(grid.columns * grid.rows).toBeGreaterThanOrEqual(490);
    expect(grid.columns).toBeLessThanOrEqual(490);
  });

  it('sanitizes invalid counts and aspect ratios', () => {
    expect(computeWLEDSamplingGrid(0, Number.NaN)).toEqual({ columns: 1, rows: 1 });
  });
});
