import { describe, expect, it } from 'vitest';
import type { WarpCorners } from '../types';
import { scaleWarpCornersFromSelectionEdge, type SelectionBounds } from './selectionEdgeScale';

const bounds: SelectionBounds = { minX: 0.1, maxX: 0.9, minY: 0.2, maxY: 0.8 };
const corners: WarpCorners = {
  topLeft: { x: 0.2, y: 0.7 },
  topRight: { x: 0.4, y: 0.7 },
  bottomLeft: { x: 0.2, y: 0.3 },
  bottomRight: { x: 0.4, y: 0.3 },
};

describe('scaleWarpCornersFromSelectionEdge', () => {
  it('stretches the right edge around the selection left edge', () => {
    const result = scaleWarpCornersFromSelectionEdge(corners, bounds, 'right', 0.4, 0);
    expect(result.topLeft.x).toBeCloseTo(0.25);
    expect(result.topRight.x).toBeCloseTo(0.55);
    expect(result.topLeft.y).toBe(0.7);
    expect(result.topRight.y).toBe(0.7);
  });

  it('stretches the left edge around the selection right edge', () => {
    const result = scaleWarpCornersFromSelectionEdge(corners, bounds, 'left', -0.4, 0);
    expect(result.topLeft.x).toBeCloseTo(-0.15);
    expect(result.topRight.x).toBeCloseTo(0.15);
    expect(result.topLeft.y).toBe(0.7);
  });

  it('stretches the top edge around the selection bottom edge', () => {
    const result = scaleWarpCornersFromSelectionEdge(corners, bounds, 'top', 0, 0.3);
    expect(result.topLeft.y).toBeCloseTo(0.95);
    expect(result.bottomLeft.y).toBeCloseTo(0.35);
    expect(result.topLeft.x).toBe(0.2);
  });

  it('stretches the bottom edge around the selection top edge', () => {
    const result = scaleWarpCornersFromSelectionEdge(corners, bounds, 'bottom', 0, -0.3);
    expect(result.topLeft.y).toBeCloseTo(0.65);
    expect(result.bottomLeft.y).toBeCloseTo(0.05);
    expect(result.topLeft.x).toBe(0.2);
  });
});
