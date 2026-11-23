import { describe, expect, it } from 'vitest';
import { compilePoints } from './lineEvaluator';
import type { LinePoint } from './lineModel';

describe('compiled points cache', () => {
  it('keeps the default curve apart: a linear lookup does not poison a hold line', () => {
    const pts: LinePoint[] = [{ t: 0, v: 0 }, { t: 1, v: 1 }] as LinePoint[];
    const lin = compilePoints(pts, 'linear');
    const hold = compilePoints(pts, 'hold');
    expect(hold).not.toBe(lin);
    expect(hold.c[0]).not.toBe(lin.c[0]);
    expect(compilePoints(pts, 'hold')).toBe(hold);
  });
});
