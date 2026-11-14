/**
 * Editing masks on the canvas. A mask lives in its surface's content space;
 * the canvas works in the output frame. These map between the two (exactly
 * for corner and shape surfaces, through the drawn triangles for meshes)
 * and apply drags of mask points, handles and whole masks.
 */
import type { Point, Surface } from '../model';
import { cornerPoints, evaluate, tessellate } from './meshGrid';
import { quadInverse } from './homography';
import { flattenPath, insidePolygon, moveHandle, movePathPoint, insertPoint, segmentPoint, type PathPoint } from './pathGeometry';
import { maskPath, type SurfaceMask } from './masks';
import { bendSegment } from './edit';

const clampUv = (p: Point): Point => ({ x: Math.max(-0.5, Math.min(1.5, p.x)), y: Math.max(-0.5, Math.min(1.5, p.y)) });

/** Output point → the surface's content (u, v); outside the surface it extends the nearest part of the warp. */
export function contentPoint(s: Surface, p: Point): Point | null {
  if (s.mode === 'corners') {
    const inv = quadInverse(cornerPoints(s));
    const q = inv?.(p);
    return q ? clampUv(q) : null;
  }
  const v = tessellate(s);
  let best: { u: number; v: number; d: number } | null = null;
  for (let j = 0; j < v.length; j += 12) {
    const ax = v[j], ay = v[j + 1], bx = v[j + 4], by = v[j + 5], cx = v[j + 8], cy = v[j + 9];
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (Math.abs(area) < 1e-12) continue;
    const b = ((p.x - ax) * (cy - ay) - (p.y - ay) * (cx - ax)) / area,
      c = ((bx - ax) * (p.y - ay) - (by - ay) * (p.x - ax)) / area,
      a = 1 - b - c;
    const u = v[j + 2] * a + v[j + 6] * b + v[j + 10] * c,
      w = v[j + 3] * a + v[j + 7] * b + v[j + 11] * c;
    if (a >= -1e-9 && b >= -1e-9 && c >= -1e-9) return clampUv({ x: u, y: w });
    // Outside every triangle: extend the closest one.
    const d = Math.hypot(p.x - (ax + bx + cx) / 3, p.y - (ay + by + cy) / 3);
    if (!best || d < best.d) best = { u, v: w, d };
  }
  return best ? clampUv({ x: best.u, y: best.v }) : null;
}

export const outputPoint = (s: Surface, uv: Point): Point => evaluate(s, uv.x, uv.y);

/** A polygon with each straight edge cut into `n` pieces, so it bends with a mesh when mapped. */
function densify(poly: Point[], n: number): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i],
      b = poly[(i + 1) % poly.length];
    for (let k = 0; k < n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
  }
  return out;
}

/** The mask's outline on the output, for drawing over the canvas. Image masks outline the whole surface. */
export function maskOutline(s: Surface, m: SurfaceMask): Point[] {
  const uv = m.kind === 'image' ? [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] : flattenPath(maskPath(m), 16);
  return densify(uv, s.mode === 'corners' ? 1 : 4).map((p) => outputPoint(s, p));
}

export type MaskHandle =
  | { kind: 'mpoint'; index: number }
  | { kind: 'mhandle'; index: number; side: 'in' | 'out' }
  | { kind: 'mmid'; index: number }
  | { kind: 'ecentre' }
  | { kind: 'erx' }
  | { kind: 'ery' }
  | { kind: 'mbody' };

/** The handles a selected mask offers, with where they sit on the output. */
export function maskHandles(s: Surface, m: SurfaceMask, point: number): { handle: MaskHandle; at: Point; role: 'point' | 'handle' | 'mid' }[] {
  const out: { handle: MaskHandle; at: Point; role: 'point' | 'handle' | 'mid' }[] = [];
  if (m.kind === 'ellipse' && m.ellipse) {
    const e = m.ellipse;
    out.push({ handle: { kind: 'ecentre' }, at: outputPoint(s, { x: e.cx, y: e.cy }), role: 'point' });
    out.push({ handle: { kind: 'erx' }, at: outputPoint(s, { x: e.cx + e.rx, y: e.cy }), role: 'handle' });
    out.push({ handle: { kind: 'ery' }, at: outputPoint(s, { x: e.cx, y: e.cy + e.ry }), role: 'handle' });
    return out;
  }
  if (m.kind === 'image') return out;
  m.points.forEach((p, index) => out.push({ handle: { kind: 'mpoint', index }, at: outputPoint(s, p), role: 'point' }));
  if (m.kind === 'polygon') for (let i = 0; i < m.points.length; i++) out.push({ handle: { kind: 'mmid', index: i }, at: outputPoint(s, segmentPoint(m.points, i, 0.5)), role: 'mid' });
  const p = m.points[point];
  if (p?.in) out.push({ handle: { kind: 'mhandle', index: point, side: 'in' }, at: outputPoint(s, { x: p.x + p.in.x, y: p.y + p.in.y }), role: 'handle' });
  if (p?.out) out.push({ handle: { kind: 'mhandle', index: point, side: 'out' }, at: outputPoint(s, { x: p.x + p.out.x, y: p.y + p.out.y }), role: 'handle' });
  return out;
}

/** True when an output point lies inside the mask's own outline. */
export function insideMask(s: Surface, m: SurfaceMask, p: Point): boolean {
  if (m.kind === 'image') return false;
  const uv = contentPoint(s, p);
  return !!uv && insidePolygon(flattenPath(maskPath(m), 12), uv);
}

/** Apply a drag of `handle` from `fromUv` (where the finger started) to `toUv`, both in content space. */
export function dragMask(start: SurfaceMask, handle: MaskHandle, toUv: Point, fromUv: Point): SurfaceMask {
  const m: SurfaceMask = { ...start, points: start.points.map((p) => ({ ...p })), ellipse: start.ellipse ? { ...start.ellipse } : undefined };
  if (!m.ellipse) delete m.ellipse;
  const dx = toUv.x - fromUv.x,
    dy = toUv.y - fromUv.y;
  switch (handle.kind) {
    case 'mpoint':
      m.points = movePathPoint(start.points, handle.index, clampUv(toUv));
      break;
    case 'mhandle': {
      const p = start.points[handle.index];
      m.points = moveHandle(start.points, handle.index, handle.side, { x: toUv.x - p.x, y: toUv.y - p.y });
      break;
    }
    case 'mmid':
      m.points = bendSegment(start.points, handle.index, toUv);
      break;
    case 'ecentre':
      if (start.ellipse) m.ellipse = { ...start.ellipse, cx: start.ellipse.cx + dx, cy: start.ellipse.cy + dy };
      break;
    case 'erx':
      if (start.ellipse) m.ellipse = { ...start.ellipse, rx: Math.max(0.005, Math.abs(toUv.x - start.ellipse.cx)) };
      break;
    case 'ery':
      if (start.ellipse) m.ellipse = { ...start.ellipse, ry: Math.max(0.005, Math.abs(toUv.y - start.ellipse.cy)) };
      break;
    case 'mbody':
      if (start.ellipse) m.ellipse = { ...start.ellipse, cx: start.ellipse.cx + dx, cy: start.ellipse.cy + dy };
      else m.points = start.points.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy }));
      break;
  }
  return m;
}

/** Insert a point in the middle of a polygon mask's segment. */
export function addMaskPoint(m: SurfaceMask, segment: number): SurfaceMask {
  return { ...m, points: insertPoint(m.points, segment, 0.5) };
}

/** The surfaces with one mask replaced (or removed with `null`). */
export function withMask(surfaces: Surface[], index: number, maskIndex: number, mask: SurfaceMask | null): Surface[] {
  return surfaces.map((s, i) => {
    if (i !== index) return s;
    const masks = (s.masks ?? []).slice();
    if (mask) masks[maskIndex] = mask;
    else masks.splice(maskIndex, 1);
    const out: Surface = { ...s, masks };
    if (!masks.length) delete out.masks;
    return out;
  });
}

/** Content-space path from points tapped on the output. */
export function tappedPolygon(s: Surface, taps: Point[]): PathPoint[] {
  return taps.map((p) => contentPoint(s, p)).filter((p): p is Point => !!p).map((p) => ({ x: p.x, y: p.y }));
}
