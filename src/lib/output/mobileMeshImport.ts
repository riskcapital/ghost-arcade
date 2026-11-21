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

/** Points a side of the mesh that carries a flat face's perspective (bilinear cells; 9 keeps the bend under 0.2 px at 1080p). */
const PERSPECTIVE_SIDE = 9;

/**
 * A flat face measured by the phone: four corners in the projector's picture.
 * The face and the projector picture are related by a perspective
 * (homography), but a four-corner warp is bilinear: the edges land, the
 * inside does not (a grid on a slanted box face bows by 3-15 px at 1080p).
 * So the face becomes a mesh sampled from the true perspective: the same
 * corners, with the picture where the face really is in between. Null for a
 * crossed or collapsed quad (the caller then uses the four corners).
 */
export function perspectiveMeshLayer(points: Point2D[], crop: { x: number; y: number; w: number; h: number }): Omit<PhoneMeshLayer, 'layerShape'> | null {
  if (points.length !== 4 || !points.every(finite)) return null;
  const cross = points.map((a, i) => { const b = points[(i + 1) % 4], c = points[(i + 2) % 4]; return (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x); });
  if (!cross.every(c => c > 1e-9) && !cross.every(c => c < -1e-9)) return null;
  // Unit square (content, top-left origin) -> the quad, in the projector picture.
  const a: number[][] = [];
  const unit = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
  unit.forEach((p, i) => { const q = points[i]; a.push([p.x, p.y, 1, 0, 0, 0, -q.x * p.x, -q.x * p.y, q.x], [0, 0, 0, p.x, p.y, 1, -q.y * p.x, -q.y * p.y, q.y]); });
  for (let c = 0; c < 8; c++) {
    let pivot = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(a[r][c]) > Math.abs(a[pivot][c])) pivot = r;
    if (Math.abs(a[pivot][c]) < 1e-12) return null;
    [a[c], a[pivot]] = [a[pivot], a[c]];
    const d = a[c][c];
    for (let k = c; k < 9; k++) a[c][k] /= d;
    for (let r = 0; r < 8; r++) if (r !== c) { const f = a[r][c]; for (let k = c; k < 9; k++) a[r][k] -= f * a[c][k]; }
  }
  const h = [...a.map(row => row[8]), 1];
  const n = PERSPECTIVE_SIDE;
  const meshPoints: Point2D[] = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const u = c / (n - 1), v = r / (n - 1), w = h[6] * u + h[7] * v + h[8];
    if (!(Math.abs(w) > 1e-9)) return null;
    meshPoints.push({ x: (h[0] * u + h[1] * v + h[2]) / w, y: (h[3] * u + h[4] * v + h[5]) / w });
  }
  const layer = phoneMeshLayer({ mesh: { rows: n, cols: n, points: meshPoints, tangents: null, rest: { u0: 0, v0: 0, u1: 1, v1: 1 } }, contentOutline: unit }, crop);
  if (!layer) return null;
  const { layerShape: _unused, ...fields } = layer;
  return fields;
}
