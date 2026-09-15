import type { Layer, MeshWarpGrid } from '../types';

// The native compositor searches up to 16 points a side.
const MAX_MESH_SIDE = 16;
const IDENTITY_EPSILON = 1e-4;

function wellFormed(grid: MeshWarpGrid): boolean {
  if (grid.rows < 2 || grid.cols < 2 || grid.rows > MAX_MESH_SIDE || grid.cols > MAX_MESH_SIDE) return false;
  if (!Array.isArray(grid.points) || grid.points.length !== grid.rows) return false;
  return grid.points.every((row) => Array.isArray(row) && row.length === grid.cols
    && row.every((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y)));
}

/** True when every point sits where createMeshGrid puts it, so the mesh warps nothing. */
export function isIdentityMeshGrid(grid: MeshWarpGrid): boolean {
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      const point = grid.points[r]?.[c];
      if (!point) return false;
      if (Math.abs(point.x - c / (grid.cols - 1)) > IDENTITY_EPSILON) return false;
      if (Math.abs(point.y - (1 - r / (grid.rows - 1))) > IDENTITY_EPSILON) return false;
    }
  }
  return true;
}

/**
 * The mesh a layer renders with, or null for a plain corner quad.
 *
 * Mesh points live inside the corner quad, so pinning the corners carries the
 * mesh along. Corner and Mesh mode only choose which handles you edit: a mesh
 * you warped stays on the picture after switching back to Corner, and corner
 * pinning then moves the whole warped picture. It used to be one or the other,
 * and switching to Corner dropped the mesh from the output.
 *
 * In Corner mode a mesh that warps nothing, or one the compositor cannot take,
 * is left out, so a plain corner-pinned layer keeps its cheap path and is never
 * blocked by a grid it is not using.
 */
export function layerRenderMeshGrid(
  layer: Pick<Layer, 'warpMode' | 'meshGrid'>,
): MeshWarpGrid | null {
  const grid = layer.meshGrid;
  if (!grid) return null;
  const mode = layer.warpMode ?? 'corners';
  if (mode === 'mesh') return grid;
  if (mode !== 'corners') return null;
  return wellFormed(grid) && !isIdentityMeshGrid(grid) ? grid : null;
}
