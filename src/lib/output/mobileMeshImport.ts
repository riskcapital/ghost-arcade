import type { BezierPoint, LayerShape, MeshWarpGrid, Point2D, WarpCorners } from '../types';

/**
 * A curved surface the phone measured with LiDAR and the stripe scan: a mesh
 * in the projector's own picture and the surface's edge in the layer's
 * picture. It becomes a layer whose picture is warped onto the surface by the
 * mesh and hidden where it would fall off it (a Custom Shape mask, cut in the
 * layer's picture before the mesh, in every renderer).
 *
 * Phone conventions: normalised, top-left origin, y down.
 * Layer conventions: layer UV, y up; the mesh sits inside `corners`.
 */
export type PhoneMesh = {
  rows: number;
  cols: number;
  /** Row-major, row 0 at the top: where each point lands in the projector picture. */
  points: Point2D[];
  /** Cubic edge handles per point (offsets), or null for straight cells. */
  tangents?: { right: Point2D; down: Point2D }[] | null;
  /** The part of the layer's picture the grid spans. */
  rest: { u0: number; v0: number; u1: number; v1: number };
};

export type PhoneMeshSurface = { mesh?: unknown; contentOutline?: unknown };

/** The layer fields that pin a layer onto a curved surface. */
export type PhoneMeshLayer = { corners: WarpCorners; meshGrid: MeshWarpGrid; layerShape: LayerShape };

/** The native compositor keeps 16 points a side and 32 outline points; values beyond ±8 are clamped there. */
const MAX_SIDE = 16;
const MAX_OUTLINE = 32;

const finite = (p: unknown): p is Point2D => {
  const q = p as Point2D | null;
  return !!q && Number.isFinite(q.x) && Number.isFinite(q.y) && Math.abs(q.x) <= 8 && Math.abs(q.y) <= 8;
};
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/**
 * Checks the phone's mesh and turns it into layer fields, placed on the
 * Screen's part of the composition (`crop`, y down like the Screen's own
 * crop). Null when anything is missing or malformed: the caller then falls
 * back to the surface's four corners.
 */
export function phoneMeshLayer(surface: PhoneMeshSurface, crop: { x: number; y: number; w: number; h: number }): PhoneMeshLayer | null {
  const mesh = surface.mesh as PhoneMesh | undefined;
  if (!mesh || typeof mesh !== 'object') return null;
  const { rows, cols } = mesh;
  if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows < 2 || cols < 2 || rows > MAX_SIDE || cols > MAX_SIDE) return null;
  if (!Array.isArray(mesh.points) || mesh.points.length !== rows * cols || !mesh.points.every(finite)) return null;
  const rest = mesh.rest;
  if (!rest || ![rest.u0, rest.v0, rest.u1, rest.v1].every(v => Number.isFinite(v) && v >= 0 && v <= 1) || !(rest.u1 > rest.u0) || !(rest.v1 > rest.v0)) return null;
  const tangents = Array.isArray(mesh.tangents) && mesh.tangents.length === rows * cols && mesh.tangents.every(t => finite(t?.right) && finite(t?.down)) ? mesh.tangents : null;
  const outline = Array.isArray(surface.contentOutline) ? (surface.contentOutline as unknown[]).filter(finite) : [];
  if (outline.length < 3 || outline.length > 4 * MAX_OUTLINE) return null;

  const lattice = <T>(make: (row: number, col: number) => T): T[][] =>
    Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => make(r, c)));
  const meshGrid: MeshWarpGrid = {
    rows,
    cols,
    points: lattice((r, c) => { const p = mesh.points[r * cols + c]; return { x: p.x, y: 1 - p.y }; }),
    // Each point shows its own spot of the surface's part of the picture.
    rest: lattice((r, c) => ({ x: rest.u0 + (c / (cols - 1)) * (rest.u1 - rest.u0), y: 1 - (rest.v0 + (r / (rows - 1)) * (rest.v1 - rest.v0)) })),
    // Fitted on purpose: Mesh never refits itself to the shape.
    fit: 'layer',
  };
  if (tangents) {
    meshGrid.bezier = true;
    meshGrid.tangents = lattice((r, c) => {
      const t = tangents[r * cols + c];
      return { right: { x: t.right.x, y: -t.right.y }, down: { x: t.down.x, y: -t.down.y } };
    });
  }
  // The outline, at most 32 points (every other one beyond that), inside the picture.
  const step = Math.ceil(outline.length / MAX_OUTLINE);
  const customPoints: BezierPoint[] = outline.filter((_, i) => i % step === 0).map(p => ({ x: clamp01(p.x), y: 1 - clamp01(p.y) }));
  const corners: WarpCorners = {
    topLeft: { x: crop.x, y: 1 - crop.y },
    topRight: { x: crop.x + crop.w, y: 1 - crop.y },
    bottomRight: { x: crop.x + crop.w, y: 1 - (crop.y + crop.h) },
    bottomLeft: { x: crop.x, y: 1 - (crop.y + crop.h) },
  };
  const layerShape: LayerShape = {
    type: 'custom',
    enabled: true,
    params: { customPoints, customClosed: true, customShapeFit: 'mask', feather: 0.004, rotation: 0 },
  };
  return { corners, meshGrid, layerShape };
}
