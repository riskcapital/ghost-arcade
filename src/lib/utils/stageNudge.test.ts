import { describe, expect, it } from 'vitest';
import type { BezierPoint } from '../types';
import { nudgeSlicePolygon } from './stageNudge';

const square: BezierPoint[] = [
  { x: 100, y: 100 },
  { x: 200, y: 100, cpIn: { x: 180, y: 90 }, cpOut: { x: 220, y: 110 } },
  { x: 200, y: 200 },
  { x: 100, y: 200 },
];

describe('Stage Designer arrow keys', () => {
  it('move the selected anchor with its handles, one surface pixel', () => {
    const next = nudgeSlicePolygon(square, { idx: 1, kind: 'anchor' }, { x: 0, y: -1 })!;
    expect(next[1]).toEqual({ x: 200, y: 99, cpIn: { x: 180, y: 89 }, cpOut: { x: 220, y: 109 } });
    expect(next[0]).toBe(square[0]);
    expect(next[2]).toBe(square[2]);
  });

  it('move only the selected handle', () => {
    const next = nudgeSlicePolygon(square, { idx: 1, kind: 'cpOut' }, { x: 0.1, y: 0 })!;
    expect(next[1].x).toBe(200);
    expect(next[1].cpIn).toEqual({ x: 180, y: 90 });
    expect(next[1].cpOut!.x).toBeCloseTo(220.1, 12);
  });

  it('move the whole slice with nothing selected', () => {
    const next = nudgeSlicePolygon(square, null, { x: 10, y: 0 })!;
    expect(next.map((p) => p.x)).toEqual([110, 210, 210, 110]);
    expect(next[1].cpIn).toEqual({ x: 190, y: 90 });
  });

  it('do nothing for a point that is gone', () => {
    expect(nudgeSlicePolygon(square, { idx: 9, kind: 'anchor' }, { x: 1, y: 0 })).toBeNull();
    expect(nudgeSlicePolygon(square, { idx: 0, kind: 'cpIn' }, { x: 1, y: 0 })).toBeNull();
  });
});
