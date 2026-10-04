import { describe, expect, it } from 'vitest';
import { createMeshGrid, type MeshWarpGrid } from '../types';
import {
  cloneMeshGrid,
  evaluateMeshByRows,
  evaluateMeshGrid,
  invertMeshByRows,
  isIdentityMeshGrid,
  layerRenderMeshGrid,
  meshGridHasTangents,
  meshTangentLinked,
  meshTangentsAfterDrag,
  meshTangentsAfterStraighten,
  resolveMeshTangents,
  withMeshPointTangents,
  withMeshPoints,
} from './meshWarp';

function warped(): MeshWarpGrid {
  const grid = createMeshGrid(3, 3);
  grid.points[1][1] = { x: 0.62, y: 0.41 };
  return grid;
}

describe('layer mesh warp', () => {
  it('keeps a warped mesh on the picture after switching back to Corner', () => {
    const grid = warped();
    expect(layerRenderMeshGrid({ warpMode: 'mesh', meshGrid: grid })).toBe(grid);
    expect(layerRenderMeshGrid({ warpMode: 'corners', meshGrid: grid })).toBe(grid);
  });

  it('leaves an untouched mesh out in Corner mode', () => {
    const grid = createMeshGrid(4, 4);
    expect(isIdentityMeshGrid(grid)).toBe(true);
    expect(layerRenderMeshGrid({ warpMode: 'corners', meshGrid: grid })).toBeNull();
    // Mesh mode still hands it over, as before.
    expect(layerRenderMeshGrid({ warpMode: 'mesh', meshGrid: grid })).toBe(grid);
  });

  it('never lets a grid the compositor cannot take block a Corner layer', () => {
    const tooBig = createMeshGrid(17, 17);
    tooBig.points[3][3] = { x: 0.5, y: 0.5 };
    expect(layerRenderMeshGrid({ warpMode: 'corners', meshGrid: tooBig })).toBeNull();
    const ragged = warped();
    ragged.points[2] = ragged.points[2].slice(0, 2);
    expect(layerRenderMeshGrid({ warpMode: 'corners', meshGrid: ragged })).toBeNull();
  });

  it('applies no mesh without a grid or with warping off', () => {
    expect(layerRenderMeshGrid({ warpMode: 'corners', meshGrid: null })).toBeNull();
    expect(layerRenderMeshGrid({ warpMode: 'none', meshGrid: warped() })).toBeNull();
  });
});

describe('Bezier mesh warp', () => {
  function curved(): MeshWarpGrid {
    const grid = createMeshGrid(4, 4);
    grid.bezier = true;
    grid.tangents = grid.points.map(() => grid.points[0].map(() => null));
    // Pull the top-middle point's handle up: the top edge bows outward.
    grid.tangents[0][1] = { right: { x: 0.11, y: 0.1 } };
    return grid;
  }

  it('leaves a mesh without tangents exactly on the bilinear surface', () => {
    const grid = warped();
    for (const [x, y] of [[0.2, 0.3], [0.5, 0.5], [0.77, 0.91]]) {
      const gx = x * 2;
      const gy = (1 - y) * 2;
      const col = Math.min(1, Math.floor(gx));
      const row = Math.min(1, Math.floor(gy));
      const u = gx - col;
      const v = gy - row;
      const p = grid.points;
      const expectX = (1 - u) * (1 - v) * p[row][col].x + u * (1 - v) * p[row][col + 1].x
        + (1 - u) * v * p[row + 1][col].x + u * v * p[row + 1][col + 1].x;
      expect(evaluateMeshGrid(grid, x, y).x).toBeCloseTo(expectX, 12);
    }
    expect(meshGridHasTangents(grid)).toBe(false);
  });

  it('mirrors a linked handle and keeps untouched axes straight', () => {
    const grid = curved();
    const t = resolveMeshTangents(grid, 0, 1);
    expect(t.right).toEqual({ x: 0.11, y: 0.1 });
    expect(t.left).toEqual({ x: -0.11, y: -0.1 });
    expect(meshTangentLinked(grid, 0, 1, 'left')).toBe(true);
    // Down has nothing stored: a third of the way to the next row.
    expect(t.down.x).toBeCloseTo(0, 12);
    expect(t.down.y).toBeCloseTo(-1 / 9, 12);
    grid.tangents![0][1] = { right: { x: 0.11, y: 0.1 }, left: { x: -0.05, y: 0 } };
    expect(resolveMeshTangents(grid, 0, 1).left).toEqual({ x: -0.05, y: 0 });
    expect(meshTangentLinked(grid, 0, 1, 'left')).toBe(false);
  });

  it('curves the edge through its points, smooth across the shared point', () => {
    const grid = curved();
    // Edges still pass through the grid points.
    const through = evaluateMeshGrid(grid, 1 / 3, 1);
    expect(through.x).toBeCloseTo(1 / 3, 12);
    expect(through.y).toBeCloseTo(1, 12);
    // Both cells leave the shared point along the same tangent line.
    const eps = 1e-5;
    const before = evaluateMeshGrid(grid, 1 / 3 - eps, 1);
    const after = evaluateMeshGrid(grid, 1 / 3 + eps, 1);
    expect((1 - before.y) / (1 / 3 - before.x)).toBeCloseTo(0.1 / 0.11, 3);
    expect((after.y - 1) / (after.x - 1 / 3)).toBeCloseTo(0.1 / 0.11, 3);
    // And the edge really bows: the middle of the second cell rises above y=1.
    expect(evaluateMeshGrid(grid, 0.5, 1).y).toBeGreaterThan(1.005);
  });

  it('only hands tangents to the renderer while Bezier is on', () => {
    const grid = curved();
    expect(layerRenderMeshGrid({ warpMode: 'mesh', meshGrid: grid })).toBe(grid);
    // A curve counts as a warp, so it survives switching back to Corner.
    expect(isIdentityMeshGrid(grid)).toBe(false);
    expect(layerRenderMeshGrid({ warpMode: 'corners', meshGrid: grid })).toBe(grid);
    const off = { ...grid, bezier: false };
    expect(layerRenderMeshGrid({ warpMode: 'mesh', meshGrid: off })).toEqual({ rows: 4, cols: 4, points: off.points });
    expect(isIdentityMeshGrid(off)).toBe(true);
    expect(layerRenderMeshGrid({ warpMode: 'corners', meshGrid: off })).toBeNull();
  });
});

describe('shared mesh editing (layers, screens, Master Warp)', () => {
  /** A rows-down grid the way screens and the Master Warp store it. */
  function rowsDown(rows: number, cols: number): MeshWarpGrid {
    return {
      rows, cols,
      points: Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => ({ x: c / (cols - 1), y: r / (rows - 1) }))),
    };
  }

  it('reads the same surface by rows as evaluateMeshGrid does upward', () => {
    const grid = warped();
    for (const [x, y] of [[0.1, 0.2], [0.5, 0.5], [0.9, 0.7]]) {
      expect(evaluateMeshByRows(grid, x, 1 - y)).toEqual(evaluateMeshGrid(grid, x, y));
    }
  });

  it('inverts straight and Bezier cells back to the grid position', () => {
    const straight = rowsDown(4, 5);
    straight.points[1][2] = { x: 0.55, y: 0.4 };
    const bezier = withMeshPointTangents({ ...cloneMeshGrid(straight), bezier: true }, 0, 2, { right: { x: 0.1, y: -0.12 } });
    for (const grid of [straight, bezier]) {
      for (const [x, y] of [[0.05, 0.02], [0.5, 0.01], [0.33, 0.61], [0.97, 0.93]]) {
        const q = evaluateMeshByRows(grid, x, y);
        const back = invertMeshByRows(grid, q);
        expect(back, `${x},${y}`).not.toBeNull();
        expect(back!.x).toBeCloseTo(x, 5);
        expect(back!.y).toBeCloseTo(y, 5);
      }
    }
    // The bulge above the top edge belongs to the curved mesh only.
    const bulge = evaluateMeshByRows(bezier, 0.6, 0);
    expect(bulge.y).toBeLessThan(-0.01);
    expect(invertMeshByRows(straight, bulge)).toBeNull();
    expect(invertMeshByRows(bezier, bulge)!.y).toBeCloseTo(0, 5);
  });

  it('keeps tangents when points move and drops the list once empty', () => {
    const grid = withMeshPointTangents({ ...rowsDown(3, 3), bezier: true }, 1, 1, { down: { x: 0.1, y: 0 } });
    expect(meshGridHasTangents(grid)).toBe(true);
    const moved = withMeshPoints(grid, grid.points.map((row) => row.map((p) => ({ x: p.x + 0.1, y: p.y }))));
    expect(moved.tangents).toBe(grid.tangents);
    expect(moved.bezier).toBe(true);
    const copy = cloneMeshGrid(moved);
    expect(copy).toEqual(moved);
    expect(copy.tangents![1][1]).not.toBe(moved.tangents![1][1]);
    const cleared = withMeshPointTangents(grid, 1, 1, null);
    expect(cleared.tangents).toBeUndefined();
    expect(cleared.bezier).toBe(true);
    expect(withMeshPointTangents(grid, 7, 0, null)).toBe(grid);
  });

  it('drags linked, unlinks with Alt and straightens on double-click', () => {
    const grid = { ...rowsDown(3, 3), bezier: true };
    // Linked: only the dragged side is stored, the other mirrors it.
    const linked = withMeshPointTangents(grid, 1, 1, meshTangentsAfterDrag(grid, 1, 1, 'right', { x: 0.2, y: 0.1 }, false));
    expect(linked.tangents![1][1]).toEqual({ right: { x: 0.2, y: 0.1 } });
    expect(resolveMeshTangents(linked, 1, 1).left).toEqual({ x: -0.2, y: -0.1 });
    // Alt: the opposite handle freezes where it was.
    const unlinked = withMeshPointTangents(linked, 1, 1, meshTangentsAfterDrag(linked, 1, 1, 'left', { x: -0.1, y: 0.3 }, true));
    expect(unlinked.tangents![1][1]).toEqual({ right: { x: 0.2, y: 0.1 }, left: { x: -0.1, y: 0.3 } });
    expect(meshTangentLinked(unlinked, 1, 1, 'left')).toBe(false);
    // An unlinked pair stays unlinked on a plain drag.
    const still = meshTangentsAfterDrag(unlinked, 1, 1, 'right', { x: 0.25, y: 0 }, false);
    expect(still).toEqual({ right: { x: 0.25, y: 0 }, left: { x: -0.1, y: 0.3 } });
    // Double-click one side of a bent unlinked pair pins only that side.
    const pinned = meshTangentsAfterStraighten(unlinked, 1, 1, 'right');
    expect(pinned.left).toEqual({ x: -0.1, y: 0.3 });
    expect(pinned.right!.x).toBeCloseTo(0.5 / 3, 12);
    expect(pinned.right!.y).toBeCloseTo(0, 12);
    // On a linked pair it straightens the whole axis.
    expect(meshTangentsAfterStraighten(linked, 1, 1, 'left')).toEqual({});
  });
});
