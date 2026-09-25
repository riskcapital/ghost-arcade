import type { Layer, MeshPointTangents, MeshWarpGrid, Point2D } from '../types';

// The native compositor searches up to 16 points a side.
const MAX_MESH_SIDE = 16;
const IDENTITY_EPSILON = 1e-4;

/** Points along one cell edge when a Bezier mesh is drawn as an outline.
 *  Matches the sampling the native compositor needs to look smooth at 4K. */
export const MESH_CURVE_SEGMENTS = 16;

export type MeshTangentSide = keyof MeshPointTangents;

export interface ResolvedMeshTangents {
  right: Point2D;
  down: Point2D;
  left: Point2D;
  up: Point2D;
}

function wellFormed(grid: MeshWarpGrid): boolean {
  if (grid.rows < 2 || grid.cols < 2 || grid.rows > MAX_MESH_SIDE || grid.cols > MAX_MESH_SIDE) return false;
  if (!Array.isArray(grid.points) || grid.points.length !== grid.rows) return false;
  return grid.points.every((row) => Array.isArray(row) && row.length === grid.cols
    && row.every((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y)));
}

function finitePoint(point: Point2D | undefined | null): point is Point2D {
  return !!point && Number.isFinite(point.x) && Number.isFinite(point.y);
}

/** The tangents stored on one point, or null when it has none. */
export function meshPointTangents(grid: MeshWarpGrid, row: number, col: number): MeshPointTangents | null {
  const entry = grid.tangents?.[row]?.[col];
  if (!entry) return null;
  return finitePoint(entry.right) || finitePoint(entry.down) || finitePoint(entry.left) || finitePoint(entry.up)
    ? entry
    : null;
}

/** True when the grid is in Bezier mode and at least one point carries a
 *  tangent, so its cells are curved. Everything else renders as the
 *  straight-edged mesh it always did. */
export function meshGridHasTangents(grid: MeshWarpGrid | null | undefined): boolean {
  if (!grid || !grid.bezier || !Array.isArray(grid.tangents)) return false;
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      if (meshPointTangents(grid, r, c)) return true;
    }
  }
  return false;
}

/**
 * Every tangent of a point as an explicit offset, so both the outline and
 * the compositor see the same curve. A stored side wins; a missing side
 * mirrors its opposite while that one is stored (linked handles); a point
 * with nothing stored on an axis keeps that edge straight, which is a
 * control point one third of the way along the chord to the neighbour.
 * The native core (parse_layer_mesh_tangents) applies the same rules.
 */
export function resolveMeshTangents(grid: MeshWarpGrid, row: number, col: number): ResolvedMeshTangents {
  const point = grid.points[row][col];
  const stored = meshPointTangents(grid, row, col);
  const chord = (r: number, c: number): Point2D => {
    const next = grid.points[r]?.[c];
    if (!next) return { x: 0, y: 0 };
    return { x: (next.x - point.x) / 3, y: (next.y - point.y) / 3 };
  };
  const neg = (t: Point2D): Point2D => ({ x: -t.x, y: -t.y });
  const right = finitePoint(stored?.right) ? stored!.right! : finitePoint(stored?.left) ? neg(stored!.left!) : chord(row, col + 1);
  const left = finitePoint(stored?.left) ? stored!.left! : finitePoint(stored?.right) ? neg(stored!.right!) : chord(row, col - 1);
  const down = finitePoint(stored?.down) ? stored!.down! : finitePoint(stored?.up) ? neg(stored!.up!) : chord(row + 1, col);
  const up = finitePoint(stored?.up) ? stored!.up! : finitePoint(stored?.down) ? neg(stored!.down!) : chord(row - 1, col);
  return { right, down, left, up };
}

/** Whether the handle on `side` moves with its opposite (nothing stored on
 *  the opposite side of that axis). */
export function meshTangentLinked(grid: MeshWarpGrid, row: number, col: number, side: MeshTangentSide): boolean {
  const stored = meshPointTangents(grid, row, col);
  const opposite: MeshTangentSide = side === 'right' ? 'left' : side === 'left' ? 'right' : side === 'down' ? 'up' : 'down';
  return !finitePoint(stored?.[opposite]) || !finitePoint(stored?.[side]);
}

function cubic(p0: Point2D, p1: Point2D, p2: Point2D, p3: Point2D, t: number): Point2D {
  const s = 1 - t;
  const w0 = s * s * s, w1 = 3 * s * s * t, w2 = 3 * s * t * t, w3 = t * t * t;
  return {
    x: w0 * p0.x + w1 * p1.x + w2 * p2.x + w3 * p3.x,
    y: w0 * p0.y + w1 * p1.y + w2 * p2.y + w3 * p3.y,
  };
}

function add(a: Point2D, b: Point2D): Point2D {
  return { x: a.x + b.x, y: a.y + b.y };
}

/** The four cubic control points of the edge from (r0,c0) to its right or
 *  lower neighbour (r1,c1). Straight cells return the chord thirds. */
export function meshEdgeControls(grid: MeshWarpGrid, r0: number, c0: number, r1: number, c1: number): [Point2D, Point2D, Point2D, Point2D] {
  const a = grid.points[r0][c0];
  const b = grid.points[r1][c1];
  const ta = resolveMeshTangents(grid, r0, c0);
  const tb = resolveMeshTangents(grid, r1, c1);
  if (r0 === r1) return [a, add(a, ta.right), add(b, tb.left), b];
  return [a, add(a, ta.down), add(b, tb.up), b];
}

/** Point on the edge from (r0,c0) to (r1,c1) at parameter t (0 at the first
 *  point). Straight when the grid is not a Bezier mesh. */
export function meshEdgePoint(grid: MeshWarpGrid, r0: number, c0: number, r1: number, c1: number, t: number): Point2D {
  const a = grid.points[r0][c0];
  const b = grid.points[r1][c1];
  if (!grid.bezier) return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  const [p0, p1, p2, p3] = meshEdgeControls(grid, r0, c0, r1, c1);
  return cubic(p0, p1, p2, p3, t);
}

/**
 * Where the mesh sends a local position. `x` runs along the columns and `y`
 * up the rows (1 at row 0, the top row), the same convention as the points
 * themselves. Straight meshes interpolate the cell bilinearly, exactly as
 * before; a Bezier mesh evaluates the cell as a Coons patch bounded by its
 * four cubic edges, which is the bicubic surface the native compositor
 * inverts per pixel.
 */
export function evaluateMeshGrid(grid: MeshWarpGrid, x: number, y: number): Point2D {
  const rows = grid.rows;
  const cols = grid.cols;
  const gx = Math.max(0, Math.min(cols - 1, x * (cols - 1)));
  const gy = Math.max(0, Math.min(rows - 1, (1 - y) * (rows - 1)));
  const col = Math.min(cols - 2, Math.floor(gx));
  const row = Math.min(rows - 2, Math.floor(gy));
  const u = gx - col;
  const v = gy - row;
  const a = grid.points[row][col];
  const b = grid.points[row][col + 1];
  const c = grid.points[row + 1][col + 1];
  const d = grid.points[row + 1][col];
  const bilinear = {
    x: (1 - u) * (1 - v) * a.x + u * (1 - v) * b.x + (1 - u) * v * d.x + u * v * c.x,
    y: (1 - u) * (1 - v) * a.y + u * (1 - v) * b.y + (1 - u) * v * d.y + u * v * c.y,
  };
  if (!grid.bezier) return bilinear;
  const top = meshEdgePoint(grid, row, col, row, col + 1, u);
  const bottom = meshEdgePoint(grid, row + 1, col, row + 1, col + 1, u);
  const left = meshEdgePoint(grid, row, col, row + 1, col, v);
  const right = meshEdgePoint(grid, row, col + 1, row + 1, col + 1, v);
  return {
    x: (1 - v) * top.x + v * bottom.x + (1 - u) * left.x + u * right.x - bilinear.x,
    y: (1 - v) * top.y + v * bottom.y + (1 - u) * left.y + u * right.y - bilinear.y,
  };
}

/** True when every point sits where createMeshGrid puts it and no edge is
 *  curved, so the mesh warps nothing. */
export function isIdentityMeshGrid(grid: MeshWarpGrid): boolean {
  if (meshGridHasTangents(grid)) return false;
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
 *
 * Tangents only reach the renderer while the mesh is in Bezier mode. With it
 * off they stay on the grid for later but the cells render straight, on the
 * same path as a mesh that never had them.
 */
export function layerRenderMeshGrid(
  layer: Pick<Layer, 'warpMode' | 'meshGrid'>,
): MeshWarpGrid | null {
  const grid = layer.meshGrid;
  if (!grid) return null;
  const mode = layer.warpMode ?? 'corners';
  if (mode !== 'mesh' && mode !== 'corners') return null;
  if (mode === 'corners' && (!wellFormed(grid) || isIdentityMeshGrid(grid))) return null;
  if (meshGridHasTangents(grid)) return grid;
  if (grid.bezier === undefined && grid.tangents === undefined) return grid;
  return { rows: grid.rows, cols: grid.cols, points: grid.points };
}
