import { describe, expect, it } from 'vitest';
import { bezierAt, pointsValueAt } from './lineEvaluator';
import { normalizeLines, type LinePoint } from './lineModel';

describe('bezier curves (the graph editor)', () => {
  it('handles on the straight line give a straight line', () => {
    for (const x of [0, 0.1, 0.5, 0.9, 1]) expect(bezierAt(x, 1 / 3, 1 / 3, 2 / 3, 2 / 3)).toBeCloseTo(x, 5);
  });

  it('ease in and out: slow at both ends, half way at the middle', () => {
    expect(bezierAt(0.5, 0.42, 0, 0.58, 1)).toBeCloseTo(0.5, 4);
    expect(bezierAt(0.1, 0.42, 0, 0.58, 1)).toBeLessThan(0.05);
    expect(bezierAt(0.9, 0.42, 0, 0.58, 1)).toBeGreaterThan(0.95);
  });

  it('a handle past the change overshoots, between two points of a line', () => {
    const points: LinePoint[] = [{ t: 0, v: 0, c: 'bezier', b: [0.3, 1.6, 0.6, 1.4] }, { t: 2, v: 10 }];
    const peak = Math.max(...[0.6, 0.8, 1, 1.2, 1.4].map((t) => pointsValueAt(points, t)!));
    expect(peak).toBeGreaterThan(10);
    expect(pointsValueAt(points, 0)).toBeCloseTo(0, 6);
    expect(pointsValueAt(points, 2)).toBeCloseTo(10, 6);
  });

  it('handles are saved with the point, and only on bezier points', () => {
    const [line] = normalizeLines([{
      id: 'a', target: { scope: 'layer', id: 'L1' }, key: 'layer:opacity', kind: 'continuous', min: 0, max: 1,
      points: [{ t: 0, v: 0, c: 'bezier', b: [1.5, 2, -1, 0.5] }, { t: 1, v: 1, c: 'linear', b: [0, 0, 1, 1] }],
    }]);
    expect(line.points[0].b).toEqual([1, 2, 0, 0.5]);
    expect(line.points[1].b).toBeUndefined();
  });
});
