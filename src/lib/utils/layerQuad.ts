import type { MeshWarpGrid, Point2D, WarpCorners } from '../types';
import { evaluateMeshGrid, invertLayerMesh } from './meshWarp';

/**
 * Layer positions and canvas positions.
 *
 * A layer is pinned to the canvas by its four corners. A position on the
 * layer (layer UV: 0..1, y up, 1 at the top) lands on the canvas (0..1, y
 * up) by bilinear interpolation across that quad. A mesh, when the layer has
 * one, bends layer UV first. These are the maps the handles draw with, so
 * the handles and the arrow keys move points the same way.
 */

/** Layer UV → canvas through the corner pin. */
export function quadPoint(c: WarpCorners, u: number, v: number): Point2D {
  const u1 = 1 - u;
  const v1 = 1 - v;
  return {
    x: c.bottomLeft.x * u1 * v1 + c.bottomRight.x * u * v1 + c.topLeft.x * u1 * v + c.topRight.x * u * v,
    y: c.bottomLeft.y * u1 * v1 + c.bottomRight.y * u * v1 + c.topLeft.y * u1 * v + c.topRight.y * u * v,
  };
}

/**
 * Canvas → layer UV through the corner pin. Not clamped: a position past
 * the quad continues it. Null when the quad is folded flat there.
 */
export function quadInverse(c: WarpCorners, p: Point2D, guess: Point2D = { x: 0.5, y: 0.5 }): Point2D | null {
  let u = guess.x;
  let v = guess.y;
  for (let i = 0; i < 24; i++) {
    const m = quadPoint(c, u, v);
    const ex = p.x - m.x;
    const ey = p.y - m.y;
    if (ex * ex + ey * ey < 1e-26) break;
    const v1 = 1 - v;
    const u1 = 1 - u;
    const dxdu = (c.bottomRight.x - c.bottomLeft.x) * v1 + (c.topRight.x - c.topLeft.x) * v;
    const dydu = (c.bottomRight.y - c.bottomLeft.y) * v1 + (c.topRight.y - c.topLeft.y) * v;
    const dxdv = (c.topLeft.x - c.bottomLeft.x) * u1 + (c.topRight.x - c.bottomRight.x) * u;
    const dydv = (c.topLeft.y - c.bottomLeft.y) * u1 + (c.topRight.y - c.bottomRight.y) * u;
    const det = dxdu * dydv - dxdv * dydu;
    if (Math.abs(det) < 1e-14) return null;
    u += (ex * dydv - ey * dxdv) / det;
    v += (dxdu * ey - dydu * ex) / det;
  }
  return Number.isFinite(u) && Number.isFinite(v) ? { x: u, y: v } : null;
}

/** Layer UV → canvas, through the mesh (when there is one) and the corners. */
export function layerUvToCanvas(corners: WarpCorners, mesh: MeshWarpGrid | null, uv: Point2D): Point2D {
  const m = mesh ? evaluateMeshGrid(mesh, uv.x, uv.y) : uv;
  return quadPoint(corners, m.x, m.y);
}

/**
 * Canvas → layer UV: back through the corners, then the mesh. Off the mesh
 * (a point dragged past its edge) the mesh map, which continues outward,
 * is solved from the nearest guess.
 */
export function canvasToLayerUv(corners: WarpCorners, mesh: MeshWarpGrid | null, p: Point2D): Point2D | null {
  const local = quadInverse(corners, p);
  if (!local || !mesh) return local;
  const hit = invertLayerMesh(mesh, local);
  if (hit) return hit;
  let u = local.x;
  let v = local.y;
  const h = 1e-4;
  for (let i = 0; i < 12; i++) {
    const q = evaluateMeshGrid(mesh, u, v);
    const ex = local.x - q.x;
    const ey = local.y - q.y;
    if (ex * ex + ey * ey < 1e-14) break;
    const pu = evaluateMeshGrid(mesh, u + h, v);
    const pv = evaluateMeshGrid(mesh, u, v + h);
    const a = (pu.x - q.x) / h, b = (pv.x - q.x) / h, c = (pu.y - q.y) / h, d = (pv.y - q.y) / h;
    const det = a * d - b * c;
    if (Math.abs(det) < 1e-10) return local;
    u += (ex * d - ey * b) / det;
    v += (a * ey - c * ex) / det;
  }
  return Number.isFinite(u) && Number.isFinite(v) ? { x: u, y: v } : local;
}
