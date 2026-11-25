/**
 * Where a surface the phone measured in a projector's own picture goes in the
 * composition, so the layer pinned to it lands on it.
 *
 * The phone's stripes are drawn in the projector's raster with nothing applied
 * (no rotation, crop or warp). The picture itself reaches the projector through
 * the output stage: rotation, then the Screen's crop (or its corner / mesh
 * warp), then the Master Warp. This runs that same chain (heartbeat.wgsl
 * output_source_uv) for one point, in the core's coordinates (y up), which are
 * also a layer's corner coordinates.
 */
import type { MeshWarpGrid, WarpCorners } from '../types';

export type UV = { x: number; y: number };
type Corners = { topLeft: UV; topRight: UV; bottomRight: UV; bottomLeft: UV };

/** One output's geometry, as the operator set it (crop and corners from the top left, y down). */
export type OutputPath = {
  crop: { x: number; y: number; w: number; h: number };
  rotation?: number;
  warpMode?: 'rect' | 'corners' | 'mesh';
  corners?: WarpCorners | null;
  meshGrid?: MeshWarpGrid | null;
  masterWarp?: { enabled?: boolean; mode?: 'corners' | 'mesh'; corners?: WarpCorners | null; meshGrid?: MeshWarpGrid | null } | null;
};

const finite = (p: UV | undefined | null): p is UV => !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
const mix = (a: UV, b: UV, t: number): UV => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const up = (p: UV): UV => ({ x: p.x, y: 1 - p.y });

/** The corners as the core holds them (nativeWarpCorners): y flipped, so top and bottom swap. */
function coreCorners(c: WarpCorners | null | undefined): Corners | null {
  if (!c || ![c.topLeft, c.topRight, c.bottomRight, c.bottomLeft].every(finite)) return null;
  return { topLeft: up(c.bottomLeft), topRight: up(c.bottomRight), bottomLeft: up(c.topLeft), bottomRight: up(c.topRight) };
}

/** output_rotate_uv: quarter turns of the projector's picture, in the core's coordinates. */
function rotate(p: UV, degrees: number): UV {
  const index = ((Math.round((Number(degrees) || 0) / 90) % 4) + 4) % 4;
  if (index === 1) return { x: p.y, y: 1 - p.x };
  if (index === 2) return { x: 1 - p.x, y: 1 - p.y };
  if (index === 3) return { x: 1 - p.y, y: p.x };
  return p;
}

/** The core's bilinear corner map: top edge topLeft->topRight at y = 0. */
function bilinear(c: Corners, p: UV): UV {
  return mix(mix(c.topLeft, c.topRight, p.x), mix(c.bottomLeft, c.bottomRight, p.x), p.y);
}

/** slice_warp_uv for a straight-celled mesh (the core's grid: rows reversed and y flipped). */
function meshAt(grid: MeshWarpGrid, p: UV): UV | null {
  const { rows, cols } = grid;
  if (!(rows >= 2 && cols >= 2) || !Array.isArray(grid.points) || grid.points.length !== rows) return null;
  const point = (r: number, c: number) => { const q = grid.points[rows - 1 - r]?.[c]; return finite(q) ? up(q) : null; };
  const fx = p.x * (cols - 1), fy = p.y * (rows - 1);
  const ci = Math.min(cols - 2, Math.max(0, Math.floor(fx))), ri = Math.min(rows - 2, Math.max(0, Math.floor(fy)));
  const su = Math.min(1, Math.max(0, fx - ci)), sv = Math.min(1, Math.max(0, fy - ri));
  const p00 = point(ri, ci), p10 = point(ri, ci + 1), p01 = point(ri + 1, ci), p11 = point(ri + 1, ci + 1);
  if (!p00 || !p10 || !p01 || !p11) return null;
  return mix(mix(p00, p10, su), mix(p01, p11, su), sv);
}

/** The point whose bilinear image is `p` (Newton, from the middle): the Master Warp's inverse. */
function inverseBilinear(c: Corners, p: UV): UV | null {
  let s = 0.5, t = 0.5;
  for (let k = 0; k < 30; k++) {
    const q = bilinear(c, { x: s, y: t });
    const ds = { x: (c.topRight.x - c.topLeft.x) * (1 - t) + (c.bottomRight.x - c.bottomLeft.x) * t, y: (c.topRight.y - c.topLeft.y) * (1 - t) + (c.bottomRight.y - c.bottomLeft.y) * t };
    const dt = { x: (c.bottomLeft.x - c.topLeft.x) * (1 - s) + (c.bottomRight.x - c.topRight.x) * s, y: (c.bottomLeft.y - c.topLeft.y) * (1 - s) + (c.bottomRight.y - c.topRight.y) * s };
    const det = ds.x * dt.y - ds.y * dt.x;
    if (Math.abs(det) < 1e-12) return null;
    const ex = p.x - q.x, ey = p.y - q.y;
    s += (ex * dt.y - ey * dt.x) / det; t += (ds.x * ey - ds.y * ex) / det;
    if (Math.hypot(ex, ey) < 1e-10) break;
  }
  return Number.isFinite(s) && Number.isFinite(t) ? { x: s, y: t } : null;
}

/**
 * Projector picture (0..1, top left, as the phone measured it) -> composition,
 * in layer-corner coordinates (y up). Null where the output shows nothing of
 * the composition there (outside the Master Warp's quad, say).
 */
export function rasterToComposition(point: UV, path: OutputPath): UV | null {
  // The core's screen coordinates have y up; the phone's picture has it down.
  const rotated = rotate(up(point), path.rotation ?? 0);
  let warped: UV | null;
  const corners = path.warpMode === 'corners' ? coreCorners(path.corners) : null;
  const mesh = path.warpMode === 'mesh' && path.meshGrid ? path.meshGrid : null;
  if (corners) warped = bilinear(corners, rotated);
  else if (mesh) warped = meshAt(mesh, rotated);
  else {
    const { x, y, w, h } = path.crop;
    warped = { x: x + rotated.x * w, y: Math.min(1, Math.max(0, 1 - y - h)) + rotated.y * h };
  }
  if (!warped) return null;
  const master = path.masterWarp?.enabled ? coreCorners(path.masterWarp.corners) : null;
  if (!master) return warped;
  const q = inverseBilinear(master, warped);
  return q && q.x >= -1e-6 && q.x <= 1 + 1e-6 && q.y >= -1e-6 && q.y <= 1 + 1e-6 ? q : null;
}

/** What this chain cannot follow exactly, in plain words for the panel (empty when it is exact). */
export function placementCaveats(path: OutputPath): string[] {
  const notes: string[] = [];
  if (path.warpMode === 'mesh' && path.meshGrid?.bezier) notes.push('its curved (Bezier) Screen mesh is followed as straight cells');
  if (path.masterWarp?.enabled && path.masterWarp.mode === 'mesh' && path.masterWarp.meshGrid) notes.push('the Master Warp mesh is not followed, only its corners');
  return notes;
}
