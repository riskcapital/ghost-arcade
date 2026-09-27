import type { Point2D } from '../types';

/**
 * Where on-canvas warp handles are drawn, as opposed to where their points
 * are. A point on the canvas edge keeps its true position, but its handle
 * is pulled in far enough to be whole: at the right edge half of it would
 * otherwise sit under the right sidebar. Lines and outlines still run to
 * the true position.
 */
export function insetHandle(value: number, size: number, half: number): number {
  if (!Number.isFinite(value)) return value;
  if (size <= 2 * half) return size / 2;
  return Math.min(size - half, Math.max(half, value));
}

/**
 * insetHandle for layer handles, which may sit off the canvas: a layer can
 * be bigger than the canvas, and the workspace around the canvas shows its
 * handles where they really are. Only a handle that straddles a canvas edge
 * (and so would be half under a side panel) is pulled in; one further out
 * keeps its true position.
 */
export function insetEdgeHandle(value: number, size: number, half: number): number {
  if (!Number.isFinite(value) || value < -half || value > size + half) return value;
  return insetHandle(value, size, half);
}

/**
 * The grip that moves a whole mesh: the middle of its central cell. The
 * average of all points is exactly the centre point of an odd grid (5x5),
 * which put the move grip on top of that point so it could not be picked.
 * A cell centre never sits on a mesh point.
 */
export function meshMoveGrip(points: Point2D[][], rows: number, cols: number): Point2D {
  const row = Math.max(0, Math.min(rows - 2, Math.floor((rows - 1) / 2)));
  const col = Math.max(0, Math.min(cols - 2, Math.floor((cols - 1) / 2)));
  const cell = [points[row]?.[col], points[row]?.[col + 1], points[row + 1]?.[col + 1], points[row + 1]?.[col]];
  if (cell.some((p) => !p)) {
    const all = points.flat();
    const n = Math.max(1, all.length);
    return { x: all.reduce((s, p) => s + p.x, 0) / n, y: all.reduce((s, p) => s + p.y, 0) / n };
  }
  return {
    x: (cell[0]!.x + cell[1]!.x + cell[2]!.x + cell[3]!.x) / 4,
    y: (cell[0]!.y + cell[1]!.y + cell[2]!.y + cell[3]!.y) / 4,
  };
}
