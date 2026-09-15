import { describe, expect, it } from 'vitest';
import { createMeshGrid, type MeshWarpGrid } from '../types';
import { isIdentityMeshGrid, layerRenderMeshGrid } from './meshWarp';

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
