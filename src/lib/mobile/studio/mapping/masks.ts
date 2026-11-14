/**
 * Masks on a mapping surface. A mask is drawn in the surface's own content
 * space (0–1 across its picture, y down), so it travels with every warp,
 * move and turn of the surface.
 *
 * Several masks combine in order: when any enabled mask adds, the surface
 * starts empty and each adding mask reveals its inside; a subtracting mask
 * cuts its inside away. Invert swaps a mask's inside and outside first.
 * Feather ramps a mask inward from its edge, so light never spills past
 * the line that was traced.
 */
import type { Point } from '../model';
import { ellipsePath, normalizePath, type PathPoint } from './pathGeometry';

export type MaskKind = 'polygon' | 'ellipse' | 'freehand' | 'image';
export type MaskEllipse = { cx: number; cy: number; rx: number; ry: number };
export type MaskImage = {
  /** The picture, kept small (a data URL of at most 512 px a side) so the set carries it. */
  src: string;
  /** Read the picture's transparency, or its brightness. */
  channel: 'alpha' | 'luma';
};
export type SurfaceMask = {
  id: string;
  name: string;
  kind: MaskKind;
  enabled: boolean;
  op: 'add' | 'subtract';
  invert: boolean;
  /** Inward edge softness, as a share of the surface's shorter side (0–0.5). */
  feather: number;
  /** Polygon and freehand outlines. */
  points: PathPoint[];
  ellipse?: MaskEllipse;
  image?: MaskImage;
};

export const MAX_MASKS = 8;
export const MAX_FEATHER = 0.5;
/** Longest data URL an image mask may carry (about 600 KB). */
export const MAX_IMAGE_SRC = 600_000;

const KINDS: MaskKind[] = ['polygon', 'ellipse', 'freehand', 'image'];
const num = (v: unknown, lo: number, hi: number, fallback: number) => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  return Math.max(lo, Math.min(hi, n));
};

export function normalizeMasks(raw: unknown): SurfaceMask[] {
  if (!Array.isArray(raw)) return [];
  const out: SurfaceMask[] = [];
  for (const m of raw.slice(0, MAX_MASKS)) {
    if (!m || typeof m !== 'object') continue;
    const r = m as Partial<SurfaceMask>;
    const kind = KINDS.includes(r.kind as MaskKind) ? (r.kind as MaskKind) : null;
    if (!kind) continue;
    const mask: SurfaceMask = {
      id: typeof r.id === 'string' && r.id ? r.id.slice(0, 64) : crypto.randomUUID(),
      name: String(r.name || 'Mask').slice(0, 60),
      kind,
      enabled: r.enabled !== false,
      op: r.op === 'subtract' ? 'subtract' : 'add',
      invert: !!r.invert,
      feather: num(r.feather, 0, MAX_FEATHER, 0),
      points: kind === 'polygon' || kind === 'freehand' ? normalizePath(r.points, -0.5, 1.5, kind === 'freehand' ? 128 : 64) : [],
    };
    if (kind === 'ellipse') {
      const e = (r.ellipse ?? {}) as Partial<MaskEllipse>;
      mask.ellipse = { cx: num(e.cx, -0.5, 1.5, 0.5), cy: num(e.cy, -0.5, 1.5, 0.5), rx: num(e.rx, 0.005, 2, 0.25), ry: num(e.ry, 0.005, 2, 0.25) };
    }
    if (kind === 'image') {
      const img = r.image as Partial<MaskImage> | undefined;
      if (!img || typeof img.src !== 'string' || !/^data:image\/(png|jpeg|webp);base64,/.test(img.src) || img.src.length > MAX_IMAGE_SRC) continue;
      mask.image = { src: img.src, channel: img.channel === 'luma' ? 'luma' : 'alpha' };
    }
    if ((kind === 'polygon' || kind === 'freehand') && mask.points.length < 3) continue;
    out.push(mask);
  }
  return out;
}

/** The outline of a shape mask as a path (an ellipse becomes four curved points). */
export function maskPath(m: SurfaceMask): PathPoint[] {
  if (m.kind === 'ellipse' && m.ellipse) return ellipsePath(m.ellipse.cx, m.ellipse.cy, m.ellipse.rx, m.ellipse.ry, 4);
  return m.points;
}

let counter = 0;
const id = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `mask-${Date.now()}-${++counter}`);

export function newPolygonMask(points: Point[], name = 'Polygon'): SurfaceMask {
  return { id: id(), name, kind: 'polygon', enabled: true, op: 'add', invert: false, feather: 0, points: points.map((p) => ({ x: p.x, y: p.y })) };
}
export function newFreehandMask(points: PathPoint[], name = 'Freehand'): SurfaceMask {
  return { id: id(), name, kind: 'freehand', enabled: true, op: 'add', invert: false, feather: 0.02, points };
}
/** A circle that looks round on the output: `aspect` is the surface's width ÷ height there. */
export function newEllipseMask(aspect = 16 / 9, name = 'Circle'): SurfaceMask {
  const ry = 0.35,
    rx = Math.min(0.45, ry / Math.max(0.1, aspect));
  return { id: id(), name, kind: 'ellipse', enabled: true, op: 'add', invert: false, feather: 0, points: [], ellipse: { cx: 0.5, cy: 0.5, rx, ry } };
}
export function newImageMask(src: string, channel: MaskImage['channel'], name = 'Image'): SurfaceMask {
  return { id: id(), name, kind: 'image', enabled: true, op: 'add', invert: false, feather: 0, points: [], image: { src, channel } };
}
