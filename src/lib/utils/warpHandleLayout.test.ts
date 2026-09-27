import { describe, expect, it } from 'vitest';
import { insetEdgeHandle, insetHandle, meshMoveGrip } from './warpHandleLayout';

describe('warp handle layout', () => {
  it('pulls in a layer handle only where it straddles the canvas edge', () => {
    // A full-canvas layer: corners exactly on the edges.
    expect(insetEdgeHandle(0, 800, 10)).toBe(10);
    expect(insetEdgeHandle(800, 800, 10)).toBe(790);
    expect(insetEdgeHandle(-6, 800, 10)).toBe(10);
    expect(insetEdgeHandle(806, 800, 10)).toBe(790);
    expect(insetEdgeHandle(400, 800, 10)).toBe(400);
    // Well off the canvas (a layer bigger than it): the true position.
    expect(insetEdgeHandle(-40, 800, 10)).toBe(-40);
    expect(insetEdgeHandle(900, 800, 10)).toBe(900);
  });

  it('pulls an edge handle inside the canvas and leaves the rest alone', () => {
    expect(insetHandle(1000, 1000, 8)).toBe(992);
    expect(insetHandle(0, 1000, 8)).toBe(8);
    expect(insetHandle(-40, 1000, 8)).toBe(8);
    expect(insetHandle(500, 1000, 8)).toBe(500);
    expect(insetHandle(995, 1000, 10)).toBe(990);
    // A canvas smaller than the handle centres it rather than inverting.
    expect(insetHandle(3, 10, 8)).toBe(5);
  });

  it('keeps the mesh move grip off every mesh point', () => {
    const grid = (rows: number, cols: number) => Array.from({ length: rows }, (_, r) =>
      Array.from({ length: cols }, (_, c) => ({ x: 0.1 + 0.8 * c / (cols - 1), y: 0.2 + 0.6 * r / (rows - 1) })));
    for (const [rows, cols] of [[2, 2], [3, 3], [4, 4], [5, 5], [5, 3], [16, 16]]) {
      const points = grid(rows, cols);
      const grip = meshMoveGrip(points, rows, cols);
      const nearest = Math.min(...points.flat().map((p) => Math.hypot(p.x - grip.x, p.y - grip.y)));
      // Half a cell diagonal away from the nearest point.
      const cell = Math.hypot(0.8 / (cols - 1), 0.6 / (rows - 1));
      expect(nearest, `${rows}x${cols}`).toBeCloseTo(cell / 2, 9);
    }
    // An even grid keeps the grip at the mesh centre.
    const four = meshMoveGrip(grid(4, 4), 4, 4);
    expect(four.x).toBeCloseTo(0.5, 9);
    expect(four.y).toBeCloseTo(0.5, 9);
  });
});
