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
  return evaluateMeshByRows(grid, x, 1 - y);
}

/**
 * The same surface addressed by grid position: `x` runs along the columns
 * and `y` down the rows (0 at row 0). Output-stage meshes (screens and the
 * Master Warp) store row 0 at the top, so they read the mesh this way.
 */
export function evaluateMeshByRows(grid: MeshWarpGrid, x: number, y: number): Point2D {
  const rows = grid.rows;
  const cols = grid.cols;
  const gx = Math.max(0, Math.min(cols - 1, x * (cols - 1)));
  const gy = Math.max(0, Math.min(rows - 1, y * (rows - 1)));
  const col = Math.min(cols - 2, Math.floor(gx));
  const row = Math.min(rows - 2, Math.floor(gy));
  return evaluateMeshCell(grid, row, col, gx - col, gy - row);
}

/** One cell at (u, v), u toward the next column and v toward the next row. */
export function evaluateMeshCell(grid: MeshWarpGrid, row: number, col: number, u: number, v: number): Point2D {
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

// ─── Inverse ────────────────────────────────────────────────────────────

function cross(a: Point2D, b: Point2D): number {
  return a.x * b.y - a.y * b.x;
}

/** (u, v) of `p` inside the straight quad a, b, c, d (row, col / next col /
 *  next row next col / next row). Values outside 0..1 mean outside. */
function inverseBilinearCell(p: Point2D, a: Point2D, b: Point2D, c: Point2D, d: Point2D): Point2D | null {
  const e = { x: b.x - a.x, y: b.y - a.y };
  const f = { x: d.x - a.x, y: d.y - a.y };
  const g = { x: a.x - b.x + c.x - d.x, y: a.y - b.y + c.y - d.y };
  const h = { x: p.x - a.x, y: p.y - a.y };
  const k2 = cross(g, f);
  const k1 = cross(e, f) + cross(h, g);
  const k0 = cross(h, e);
  let v: number;
  if (Math.abs(k2) < 1e-9) {
    if (Math.abs(k1) < 1e-12) return null;
    v = -k0 / k1;
  } else {
    const discriminant = k1 * k1 - 4 * k0 * k2;
    if (discriminant < 0) return null;
    const root = Math.sqrt(discriminant);
    const v0 = (-k1 - root) / (2 * k2);
    const v1 = (-k1 + root) / (2 * k2);
    v = v0 >= 0 && v0 <= 1 ? v0 : v1;
  }
  const denomX = e.x + g.x * v;
  const denomY = e.y + g.y * v;
  let u: number;
  if (Math.abs(denomX) > Math.abs(denomY)) u = (h.x - f.x * v) / denomX;
  else if (Math.abs(denomY) > 1e-12) u = (h.y - f.y * v) / denomY;
  else return null;
  return Number.isFinite(u) && Number.isFinite(v) ? { x: u, y: v } : null;
}

const CELL_EPSILON = 1e-6;

/** Newton on one Bezier cell from `start`, as the core's mesh_patch_newton. */
function newtonMeshCell(grid: MeshWarpGrid, row: number, col: number, q: Point2D, start: Point2D): Point2D | null {
  let u = start.x;
  let v = start.y;
  const h = 1e-6;
  for (let i = 0; i < 16; i++) {
    const p = evaluateMeshCell(grid, row, col, u, v);
    const rx = p.x - q.x;
    const ry = p.y - q.y;
    if (rx * rx + ry * ry < 1e-18) break;
    const pu = evaluateMeshCell(grid, row, col, u + h, v);
    const pv = evaluateMeshCell(grid, row, col, u, v + h);
    const dux = (pu.x - p.x) / h, duy = (pu.y - p.y) / h;
    const dvx = (pv.x - p.x) / h, dvy = (pv.y - p.y) / h;
    const det = dux * dvy - dvx * duy;
    if (Math.abs(det) < 1e-14) return null;
    u = Math.max(-0.5, Math.min(1.5, u - (rx * dvy - ry * dvx) / det));
    v = Math.max(-0.5, Math.min(1.5, v - (dux * ry - duy * rx) / det));
  }
  const p = evaluateMeshCell(grid, row, col, u, v);
  const inside = u >= -CELL_EPSILON && u <= 1 + CELL_EPSILON && v >= -CELL_EPSILON && v <= 1 + CELL_EPSILON;
  const converged = (p.x - q.x) ** 2 + (p.y - q.y) ** 2 < 1e-14;
  return inside && converged ? { x: Math.max(0, Math.min(1, u)), y: Math.max(0, Math.min(1, v)) } : null;
}

/** Bounds of a cell's surface. A Bezier cell is a bicubic patch, so it
 *  stays inside the hull of its 16 control points: the corners, the edge
 *  controls and four inner points (mesh_patch_inner in the core). */
function meshCellBounds(grid: MeshWarpGrid, row: number, col: number): [number, number, number, number] {
  const a = grid.points[row][col];
  const b = grid.points[row][col + 1];
  const c = grid.points[row + 1][col + 1];
  const d = grid.points[row + 1][col];
  const pts: Point2D[] = [a, b, c, d];
  if (grid.bezier) {
    const top = meshEdgeControls(grid, row, col, row, col + 1);
    const bottom = meshEdgeControls(grid, row + 1, col, row + 1, col + 1);
    const left = meshEdgeControls(grid, row, col, row + 1, col);
    const right = meshEdgeControls(grid, row, col + 1, row + 1, col + 1);
    pts.push(top[1], top[2], bottom[1], bottom[2], left[1], left[2], right[1], right[2]);
    for (const i of [1, 2]) {
      for (const j of [1, 2]) {
        const fu = i / 3;
        const fv = j / 3;
        const sheetX = (1 - fv) * ((1 - fu) * a.x + fu * b.x) + fv * ((1 - fu) * d.x + fu * c.x);
        const sheetY = (1 - fv) * ((1 - fu) * a.y + fu * b.y) + fv * ((1 - fu) * d.y + fu * c.y);
        pts.push({
          x: (1 - fv) * top[i].x + fv * bottom[i].x + (1 - fu) * left[j].x + fu * right[j].x - sheetX,
          y: (1 - fv) * top[i].y + fv * bottom[i].y + (1 - fu) * left[j].y + fu * right[j].y - sheetY,
        });
      }
    }
  }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) {
    x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
  }
  const pad = 1e-6;
  return [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
}

/**
 * Where `q` sits on the mesh, as a grid position with `x` along the columns
 * and `y` down the rows (0..1, the inverse of evaluateMeshByRows), or null
 * when no cell covers it. Straight cells use the closed-form bilinear
 * inverse; Bezier cells run Newton on the Coons patch from the bilinear
 * guess, then the centre and quadrants, the same seeds the core uses.
 */
export function invertMeshByRows(grid: MeshWarpGrid, q: Point2D): Point2D | null {
  for (let row = 0; row < grid.rows - 1; row++) {
    for (let col = 0; col < grid.cols - 1; col++) {
      const [x0, y0, x1, y1] = meshCellBounds(grid, row, col);
      if (q.x < x0 || q.x > x1 || q.y < y0 || q.y > y1) continue;
      const a = grid.points[row][col];
      const b = grid.points[row][col + 1];
      const c = grid.points[row + 1][col + 1];
      const d = grid.points[row + 1][col];
      const guess = inverseBilinearCell(q, a, b, c, d);
      let hit: Point2D | null = null;
      if (!grid.bezier) {
        if (guess && guess.x >= -CELL_EPSILON && guess.x <= 1 + CELL_EPSILON && guess.y >= -CELL_EPSILON && guess.y <= 1 + CELL_EPSILON) {
          hit = { x: Math.max(0, Math.min(1, guess.x)), y: Math.max(0, Math.min(1, guess.y)) };
        }
      } else {
        const seeds: Point2D[] = [];
        if (guess && guess.x >= -0.25 && guess.x <= 1.25 && guess.y >= -0.25 && guess.y <= 1.25) {
          seeds.push({ x: Math.max(0, Math.min(1, guess.x)), y: Math.max(0, Math.min(1, guess.y)) });
        }
        seeds.push({ x: 0.5, y: 0.5 }, { x: 0.25, y: 0.25 }, { x: 0.75, y: 0.25 }, { x: 0.25, y: 0.75 }, { x: 0.75, y: 0.75 });
        for (const seed of seeds) {
          hit = newtonMeshCell(grid, row, col, q, seed);
          if (hit) break;
        }
      }
      if (hit) return { x: (col + hit.x) / (grid.cols - 1), y: (row + hit.y) / (grid.rows - 1) };
    }
  }
  return null;
}

// ─── Editing ────────────────────────────────────────────────────────────
// Shared by every mesh with tangent handles: layer meshes, screen meshes
// and the Master Warp. Each store keeps its own grid; these only decide
// what the next grid is.

export const MESH_OPPOSITE_SIDE: Record<MeshTangentSide, MeshTangentSide> = {
  right: 'left', left: 'right', down: 'up', up: 'down',
};

/** Sides of a point that have a neighbour, so a handle there bends an edge. */
export function meshTangentSides(grid: MeshWarpGrid, row: number, col: number): MeshTangentSide[] {
  const sides: MeshTangentSide[] = [];
  if (col < grid.cols - 1) sides.push('right');
  if (col > 0) sides.push('left');
  if (row < grid.rows - 1) sides.push('down');
  if (row > 0) sides.push('up');
  return sides;
}

/** A deep copy that keeps the Bezier flag and tangents. */
export function cloneMeshGrid(grid: MeshWarpGrid): MeshWarpGrid {
  const copy: MeshWarpGrid = {
    rows: grid.rows,
    cols: grid.cols,
    points: grid.points.map((row) => row.map((p) => ({ x: p.x, y: p.y }))),
  };
  if (grid.bezier !== undefined) copy.bezier = grid.bezier;
  if (grid.tangents) {
    copy.tangents = grid.tangents.map((row) => row.map((entry) => {
      if (!entry) return null;
      const out: MeshPointTangents = {};
      for (const side of ['right', 'down', 'left', 'up'] as const) {
        const t = entry[side];
        if (t) out[side] = { x: t.x, y: t.y };
      }
      return out;
    }));
  }
  return copy;
}

/** The grid with new point positions. Tangents are offsets from their
 *  points, so they travel with them. */
export function withMeshPoints(grid: MeshWarpGrid, points: Point2D[][]): MeshWarpGrid {
  return { ...grid, points };
}

/** The grid with one point's tangents replaced. `null` (or no usable side)
 *  clears the point, which straightens every edge there; the tangents list
 *  is dropped entirely once no point carries one. */
export function withMeshPointTangents(grid: MeshWarpGrid, row: number, col: number, tangents: MeshPointTangents | null): MeshWarpGrid {
  const next: (MeshPointTangents | null)[][] = [];
  for (let r = 0; r < grid.rows; r++) {
    const source = grid.tangents?.[r];
    next.push(Array.from({ length: grid.cols }, (_, c) => (source?.[c] ?? null)));
  }
  if (!next[row] || col < 0 || col >= grid.cols) return grid;
  const kept: MeshPointTangents = {};
  for (const side of ['right', 'down', 'left', 'up'] as const) {
    const value = tangents?.[side];
    if (value && Number.isFinite(value.x) && Number.isFinite(value.y)) kept[side] = { x: value.x, y: value.y };
  }
  next[row][col] = Object.keys(kept).length ? kept : null;
  const any = next.some((r) => r.some((entry) => entry !== null));
  const { tangents: _dropped, ...rest } = grid;
  return any ? { ...rest, tangents: next } : rest;
}

/**
 * The tangents a point stores after one handle is dragged to `tangent`.
 * Linked handles (the default) store only the dragged side, so the opposite
 * one mirrors it. Alt unlinks: the opposite handle is frozen where it is and
 * the two move independently from then on. A pair that is already unlinked
 * stays unlinked.
 */
export function meshTangentsAfterDrag(
  grid: MeshWarpGrid,
  row: number,
  col: number,
  side: MeshTangentSide,
  tangent: Point2D,
  unlink: boolean,
): MeshPointTangents {
  const stored: MeshPointTangents = { ...(meshPointTangents(grid, row, col) ?? {}) };
  const opposite = MESH_OPPOSITE_SIDE[side];
  const linked = meshTangentLinked(grid, row, col, side);
  if (unlink && linked) {
    stored[opposite] = resolveMeshTangents(grid, row, col)[opposite];
  } else if (linked) {
    delete stored[opposite];
  }
  stored[side] = tangent;
  return stored;
}

/** The tangents a point stores after one handle is double-clicked back onto
 *  the straight edge. A linked pair straightens the whole axis; if the other
 *  handle was unlinked and still bends, it keeps its bend and only this one
 *  is pinned straight. */
export function meshTangentsAfterStraighten(
  grid: MeshWarpGrid,
  row: number,
  col: number,
  side: MeshTangentSide,
): MeshPointTangents {
  const stored: MeshPointTangents = { ...(meshPointTangents(grid, row, col) ?? {}) };
  const opposite = MESH_OPPOSITE_SIDE[side];
  const point = grid.points[row][col];
  const straight = (s: MeshTangentSide): Point2D | null => {
    const dr = s === 'down' ? 1 : s === 'up' ? -1 : 0;
    const dc = s === 'right' ? 1 : s === 'left' ? -1 : 0;
    const next = grid.points[row + dr]?.[col + dc];
    return next ? { x: (next.x - point.x) / 3, y: (next.y - point.y) / 3 } : null;
  };
  const isStraight = (s: MeshTangentSide) => {
    const want = straight(s);
    const have = stored[s];
    return !want || (!!have && Math.abs(have.x - want.x) < 1e-6 && Math.abs(have.y - want.y) < 1e-6);
  };
  const linked = meshTangentLinked(grid, row, col, side);
  delete stored[side];
  if (stored[opposite] && !linked && !isStraight(opposite)) {
    const pinned = straight(side);
    if (pinned) stored[side] = pinned;
  } else {
    delete stored[opposite];
  }
  return stored;
}
