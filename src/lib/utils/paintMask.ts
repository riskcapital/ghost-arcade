/**
 * paintMask.ts — painted masks: storage, content-space mapping and the
 * brush maths the editor overlay uses.
 *
 * Storage design. A painted mask is kept as its STROKES, never as pixels:
 * each stroke is a centreline in the layer's content space plus the brush
 * (radius, softness, opacity, erase or restore). The native core rasterises
 * the strokes (native-renderer/src/paint_mask.rs) at a resolution chosen
 * from the output, so:
 *   - undo is a full-project JSON snapshot per step (stores/history.ts), and
 *     a stroke adds a few hundred bytes to it where a 2048² bitmap would add
 *     megabytes to every one of the 50 snapshots;
 *   - the mask is re-rasterised crisp when the output resolution changes;
 *   - a project file carries it as plain JSON, nothing to side-load.
 *
 * Content space is the layer's own picture rectangle, (0,0) top-left to
 * (1,1) bottom-right, BEFORE the corner pin and mesh warp: the compositor
 * samples the mask at the mesh-inverse UV, so a painted hole stays on the
 * same part of the picture whatever the layer's geometry does later.
 */

import type { Layer, PaintMaskConfig, PaintMaskStroke, Point2D, WarpCorners } from '../types';
import { invertMeshByRows, layerRenderMeshGrid } from './meshWarp';

/** Encoded point range (matches POINT_RANGE_* in paint_mask.rs). */
export const PAINT_POINT_MIN = -0.25;
export const PAINT_POINT_SPAN = 1.5;
export const PAINT_MASK_MAX_STROKES = 4096;
export const PAINT_MASK_MAX_POINTS = 16384;

export function createPaintMask(): PaintMaskConfig {
  return { enabled: true, inverted: false, strokes: [] };
}

// ─── Point encoding ─────────────────────────────────────────────────────

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array | null {
  try {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

/** Content-space points (y down) -> the stored base64 of LE uint16 pairs. */
export function encodePaintPoints(points: readonly Point2D[]): string {
  const count = Math.min(points.length, PAINT_MASK_MAX_POINTS);
  const bytes = new Uint8Array(count * 4);
  const view = new DataView(bytes.buffer);
  const q = (v: number) => Math.round(Math.max(0, Math.min(1, (v - PAINT_POINT_MIN) / PAINT_POINT_SPAN)) * 65535);
  for (let i = 0; i < count; i++) {
    view.setUint16(i * 4, q(points[i].x), true);
    view.setUint16(i * 4 + 2, q(points[i].y), true);
  }
  return toBase64(bytes);
}

export function decodePaintPoints(encoded: string): Point2D[] {
  const bytes = fromBase64(encoded);
  if (!bytes || bytes.length % 4 !== 0) return [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: Point2D[] = [];
  for (let i = 0; i + 3 < bytes.length && out.length < PAINT_MASK_MAX_POINTS; i += 4) {
    out.push({
      x: PAINT_POINT_MIN + (view.getUint16(i, true) / 65535) * PAINT_POINT_SPAN,
      y: PAINT_POINT_MIN + (view.getUint16(i + 2, true) / 65535) * PAINT_POINT_SPAN,
    });
  }
  return out;
}

// ─── Persistence ────────────────────────────────────────────────────────

function finite(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

/** Bring a saved paint mask to the current shape, dropping anything that
 *  could not render. Null when there is nothing to keep. */
export function migratePaintMask(raw: unknown): PaintMaskConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  const strokes: PaintMaskStroke[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(m.strokes) ? m.strokes : []) {
    if (strokes.length >= PAINT_MASK_MAX_STROKES) break;
    if (!item || typeof item !== 'object') continue;
    const s = item as Record<string, unknown>;
    const id = typeof s.id === 'string' ? s.id.trim() : '';
    const points = typeof s.points === 'string' ? s.points : '';
    const rx = Number(s.rx);
    const ry = Number(s.ry);
    if (!id || id.length > 128 || seen.has(id) || !points || !(rx > 0) || !(ry > 0)) continue;
    if (decodePaintPoints(points).length === 0) continue;
    seen.add(id);
    strokes.push({
      id,
      mode: s.mode === 'restore' ? 'restore' : 'erase',
      rx: finite(rx, 0.02, 0.0001, 2),
      ry: finite(ry, 0.02, 0.0001, 2),
      softness: finite(s.softness, 0.5, 0, 1),
      opacity: finite(s.opacity, 1, 0, 1),
      points,
    });
  }
  return {
    enabled: m.enabled !== false,
    inverted: m.inverted === true,
    strokes,
  };
}

/** Painted masks worth keeping on the layer: null for a never-used one. */
export function paintMaskIsEmpty(mask: PaintMaskConfig | null | undefined): boolean {
  return !mask || (mask.strokes.length === 0 && !mask.inverted && mask.enabled !== false);
}

// ─── Content space ──────────────────────────────────────────────────────

function cross(a: Point2D, b: Point2D): number {
  return a.x * b.y - a.y * b.x;
}

/** (u, v) of `p` in the corner quad, u along top-left -> top-right and v
 *  along top-left -> bottom-left (the core's quad_local_uv). Extrapolates
 *  past 0..1 outside the quad, so a dab just off the layer still lands. */
export function inverseCornerQuad(p: Point2D, c: WarpCorners): Point2D | null {
  const a = c.topLeft, b = c.topRight, cc = c.bottomRight, d = c.bottomLeft;
  const e = { x: b.x - a.x, y: b.y - a.y };
  const f = { x: d.x - a.x, y: d.y - a.y };
  const g = { x: a.x - b.x + cc.x - d.x, y: a.y - b.y + cc.y - d.y };
  const h = { x: p.x - a.x, y: p.y - a.y };
  const k2 = cross(g, f);
  const k1 = cross(e, f) + cross(h, g);
  const k0 = cross(h, e);
  let v: number;
  if (Math.abs(k2) < 1e-10) {
    if (Math.abs(k1) < 1e-12) return null;
    v = -k0 / k1;
  } else {
    const disc = k1 * k1 - 4 * k0 * k2;
    if (disc < 0) return null;
    const root = Math.sqrt(disc);
    const v0 = (-k1 - root) / (2 * k2);
    const v1 = (-k1 + root) / (2 * k2);
    // The root nearer the quad (both are valid far outside a folded quad).
    const dist = (t: number) => (t < 0 ? -t : t > 1 ? t - 1 : 0);
    v = dist(v0) <= dist(v1) ? v0 : v1;
  }
  const dx = e.x + g.x * v;
  const dy = e.y + g.y * v;
  let u: number;
  if (Math.abs(dx) >= Math.abs(dy) && Math.abs(dx) > 1e-12) u = (h.x - f.x * v) / dx;
  else if (Math.abs(dy) > 1e-12) u = (h.y - f.y * v) / dy;
  else return null;
  return Number.isFinite(u) && Number.isFinite(v) ? { x: u, y: v } : null;
}

type ContentGeometry = Pick<Layer, 'corners' | 'warpMode' | 'meshGrid'>;

/**
 * Editor canvas point (0..1, y UP, the layer-corner convention) -> the
 * layer's content space (0..1, y DOWN), through the inverse corner pin and
 * the inverse of whatever mesh the compositor renders the layer with.
 * Null when the point cannot be placed.
 */
export function canvasToLayerContent(layer: ContentGeometry, canvas: Point2D): Point2D | null {
  if (!layer.corners) return null;
  const local = inverseCornerQuad(canvas, layer.corners);
  if (!local) return null;
  const grid = layerRenderMeshGrid(layer);
  if (grid && grid.rows >= 2 && grid.cols >= 2) {
    // Mesh points live in the quad's local space with y up (row 0 at y=1).
    const hit = invertMeshByRows(grid, { x: local.x, y: 1 - local.y });
    if (hit) return hit;
    // Off the mesh: the corner-quad position is the best available guess,
    // and only matters for dabs whose centre is outside the picture.
  }
  return local;
}

/**
 * The brush's radius in content space at `canvas`. `radiusPx` is in
 * project (output) pixels; the local Jacobian of canvas -> content turns
 * the on-screen circle into the ellipse the core rasterises.
 */
export function brushRadiusInContent(
  layer: ContentGeometry,
  canvas: Point2D,
  radiusPx: number,
  projectWidth: number,
  projectHeight: number,
): { rx: number; ry: number } | null {
  const center = canvasToLayerContent(layer, canvas);
  if (!center) return null;
  // Differentiate over a step a fraction of the brush, so a mesh's local
  // stretch is what counts, not the far side of a fold.
  const hx = Math.max(1e-4, (radiusPx / Math.max(1, projectWidth)) * 0.25);
  const hy = Math.max(1e-4, (radiusPx / Math.max(1, projectHeight)) * 0.25);
  const px = canvasToLayerContent(layer, { x: canvas.x + hx, y: canvas.y });
  const py = canvasToLayerContent(layer, { x: canvas.x, y: canvas.y + hy });
  if (!px || !py) return null;
  // Content change per project pixel along canvas x and y.
  const dux = (px.x - center.x) / (hx * projectWidth);
  const dvx = (px.y - center.y) / (hx * projectWidth);
  const duy = (py.x - center.x) / (hy * projectHeight);
  const dvy = (py.y - center.y) / (hy * projectHeight);
  const rx = radiusPx * Math.hypot(dux, duy);
  const ry = radiusPx * Math.hypot(dvx, dvy);
  if (!Number.isFinite(rx) || !Number.isFinite(ry) || rx <= 0 || ry <= 0) return null;
  return { rx: Math.min(2, Math.max(0.0001, rx)), ry: Math.min(2, Math.max(0.0001, ry)) };
}

/**
 * Should `next` be added after `last`? Points closer than a fraction of the
 * brush add nothing visible and only grow the project, so a stroke keeps a
 * point every ~quarter radius (in brush-normalised distance).
 */
export function paintPointSpacingOk(last: Point2D | undefined, next: Point2D, rx: number, ry: number, spacing = 0.25): boolean {
  if (!last) return true;
  const dx = (next.x - last.x) / rx;
  const dy = (next.y - last.y) / ry;
  return dx * dx + dy * dy >= spacing * spacing;
}

/** Wire form of a stroke for the core (set_layer_paint_mask / _preview). */
export function nativePaintStroke(stroke: PaintMaskStroke): Record<string, unknown> {
  return {
    id: stroke.id,
    mode: stroke.mode,
    rx: stroke.rx,
    ry: stroke.ry,
    softness: stroke.softness,
    opacity: stroke.opacity,
    points: stroke.points,
  };
}
