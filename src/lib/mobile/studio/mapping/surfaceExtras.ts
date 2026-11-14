/**
 * Optional surface fields added for the pro mapping tools. Every one is
 * optional and absent on sets saved before them; absent means the surface
 * behaves exactly as it always did.
 */
import type { Point } from '../model';
import { clampGrid, normalizeTangents, type GridSize, type MeshTangent } from './meshGrid';
import { normalizeMasks, type SurfaceMask } from './masks';
import { normalizeShape, type SurfaceShape } from './surfaceShape';

export type SurfaceExtras = {
  /** Mesh lattice size. Absent: the original 3×3. */
  grid?: GridSize;
  /** Curved (cubic) cell edges in mesh mode. Handles are kept while it is off. */
  bezier?: boolean;
  /** Per-point handles, row-major like `points`; null is a straight point. */
  tangents?: (MeshTangent | null)[];
  /** Masks cut the surface's picture, in its own content space (0–1, y down). */
  masks?: SurfaceMask[];
  /** Surfaces sharing a group id select and move together. */
  group?: string;
  /** A free-form outline (output frame). The picture is laid on the corner frame and cut to it. */
  shape?: SurfaceShape;
  /** Points of this surface welded to whatever welded point of another surface sits at the same place. */
  welds?: Point[];
};

/** The lattice and extras of a saved surface, or null when its points cannot be used. */
export function normalizeSurfaceGeometry(raw: { mode?: unknown; points?: unknown; grid?: unknown; bezier?: unknown; tangents?: unknown; masks?: unknown; group?: unknown; shape?: unknown; welds?: unknown }): ({ points: Point[] } & SurfaceExtras) | null {
  const points = Array.isArray(raw.points) ? (raw.points as Point[]) : null;
  if (!points) return null;
  const clean = (p: Point) => ({ x: clamp(p?.x, -0.5, 1.5), y: clamp(p?.y, -0.5, 1.5) });
  const out: { points: Point[] } & SurfaceExtras = { points: [] };
  if (raw.grid && typeof raw.grid === 'object') {
    const g = clampGrid(raw.grid as GridSize);
    const asked = raw.grid as GridSize;
    if (g.cols === asked.cols && g.rows === asked.rows && points.length === g.cols * g.rows) {
      out.points = points.map(clean);
      out.grid = g;
    }
  }
  if (!out.grid) {
    if (points.length !== 9) return null;
    out.points = points.map(clean);
  }
  if (raw.bezier === true) out.bezier = true;
  const tangents = normalizeTangents(raw.tangents, out.points.length);
  if (tangents) out.tangents = tangents;
  const masks = normalizeMasks(raw.masks);
  if (masks.length) out.masks = masks;
  if (typeof raw.group === 'string' && raw.group) out.group = raw.group.slice(0, 64);
  // An outline belongs to a corner-framed surface only.
  const shape = raw.mode === 'mesh' ? undefined : normalizeShape(raw.shape);
  if (shape) out.shape = shape;
  if (Array.isArray(raw.welds)) {
    const welds = (raw.welds as Point[]).filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y)).slice(0, 128).map((p) => ({ x: p.x, y: p.y }));
    if (welds.length) out.welds = welds;
  }
  return out;
}

/** Same rule as the set loader's clamp: anything but a finite number becomes the low end. */
function clamp(v: unknown, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, typeof v === 'number' && Number.isFinite(v) ? v : lo));
}
