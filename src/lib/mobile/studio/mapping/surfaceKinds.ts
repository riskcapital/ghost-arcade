/**
 * The three kinds of mapping surface and the moves between them:
 *  - Quad: four corners, the picture in perspective.
 *  - Mesh: a lattice of 2–9 × 2–9 points, optionally with curved cells.
 *  - Shape: a free outline of any number of sharp or curved points.
 * Every change keeps the picture where it is as far as the new kind allows.
 */
import { newSurface, type Point, type Surface } from '../model';
import { clampGrid, cornerIndices, gridOf, latticeFromCorners, resample, type GridSize } from './meshGrid';
import { dropShape, isShape, presetPath, shapeFromPath, toShape, type ShapePreset } from './surfaceShape';
import type { PathPoint } from './pathGeometry';

export type SurfaceKind = 'quad' | 'mesh' | 'shape';

export const surfaceKind = (s: Surface): SurfaceKind => (isShape(s) ? 'shape' : s.mode === 'mesh' ? 'mesh' : 'quad');

export function kindLabel(s: Surface): string {
  const kind = surfaceKind(s);
  if (kind === 'shape') return `Shape · ${s.shape!.points.length} points`;
  if (kind === 'mesh') {
    const g = gridOf(s);
    return `Mesh ${g.cols} × ${g.rows}${s.bezier ? ' · curved' : ''}`;
  }
  return 'Corners';
}

/** The surface as another kind. */
export function convertSurface(s: Surface, kind: SurfaceKind): Surface {
  if (kind === surfaceKind(s)) return s;
  if (kind === 'shape') return toShape(s);
  const base = isShape(s) ? dropShape(s) : s;
  if (kind === 'quad') return { ...base, mode: 'corners' };
  // Into a mesh: the lattice is laid on the picture where the corner warp puts it.
  const g = gridOf(base);
  const r = resample({ ...base, mode: 'corners' }, g);
  const out: Surface = { ...base, mode: 'mesh', grid: r.grid, points: r.points };
  if (r.tangents) out.tangents = r.tangents;
  else delete out.tangents;
  return out;
}

/** A mesh at another density, keeping its shape and curves. */
export function setDensity(s: Surface, size: Partial<GridSize>): Surface {
  const next = clampGrid({ ...gridOf(s), ...size });
  const current = gridOf(s);
  if (s.grid && next.cols === current.cols && next.rows === current.rows) return s;
  const r = resample(s, next);
  const out: Surface = { ...s, grid: r.grid, points: r.points };
  if (r.tangents) out.tangents = r.tangents;
  else delete out.tangents;
  return out;
}

export type NewSurfaceKind = 'quad' | 'mesh' | ShapePreset;

/**
 * A new surface for the canvas, `index` surfaces already there. New quads
 * start like before (inset 8%, or full frame for the first); shapes start in
 * the middle at a size that reads on the phone.
 */
export function createSurface(kind: NewSurfaceKind, index: number, centre: Point = { x: 0.5, y: 0.5 }): Surface {
  const base = newSurface(index, index === 0 && kind === 'quad');
  if (kind === 'quad') return base;
  if (kind === 'mesh') return convertSurface({ ...base, name: `Mesh ${index + 1}` }, 'mesh');
  const names: Record<ShapePreset, string> = { circle: 'Circle', triangle: 'Triangle', hexagon: 'Hexagon', diamond: 'Diamond' };
  return { ...shapeFromPath(base, presetPath(kind, centre, 0.5)), name: `${names[kind]} ${index + 1}` };
}

export function createDrawnSurface(path: PathPoint[], index: number): Surface {
  return { ...shapeFromPath(newSurface(index), path), name: `Outline ${index + 1}` };
}

/** Back to the whole output frame, keeping the kind and density. */
export function resetGeometry(s: Surface): Surface {
  const full: [Point, Point, Point, Point] = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
  const { tangents: _t, ...rest } = s;
  const base: Surface = { ...(rest as Surface), points: latticeFromCorners(full, gridOf(s)) };
  if (isShape(s)) base.shape = { points: full.map((p) => ({ ...p })) };
  return base;
}

/** What the Interactive workspace reads from the map: corner surfaces as their four corners. */
export function cornerView(surfaces: Surface[]): { name: string; points: Point[]; enabled: boolean; mode: string }[] {
  return surfaces.map((s) => (s.mode === 'corners' && !(s.points.length === 9 && !s.grid) ? { ...s, points: cornerIndicesOf(s).map((i) => s.points[i]) } : s));
}
function cornerIndicesOf(s: Surface) {
  return cornerIndices(gridOf(s));
}
