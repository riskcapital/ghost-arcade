// Shared Lines geometry: smoothing, corners, element transforms, canvas
// hit-testing and element ordering. Both renderers (native core and WebGL)
// and the editor overlay use these so what is drawn, what is clicked and
// what is edited agree.
import type { Point2D } from '../types';
import type { LineElement } from './types';

// ============================================================================
// SMOOTHING
// ============================================================================

/** One Chaikin corner-cutting pass. Open lines keep their endpoints. */
export function chaikinLine(points: Point2D[], closed: boolean): Point2D[] {
  if (points.length < 3) return points;
  const out: Point2D[] = [];
  const count = closed ? points.length : points.length - 1;
  if (!closed) out.push(points[0]);
  for (let i = 0; i < count; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    out.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
    out.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
  }
  if (!closed) out.push(points[points.length - 1]);
  return out;
}

/** Chaikin passes for a freehand Smoothing value (0–1). */
export function freehandSmoothingPasses(smoothing: number): number {
  const s = Number.isFinite(smoothing) ? smoothing : 0.5;
  return s > 0.66 ? 2 : s > 0.2 ? 1 : 0;
}

export function smoothFreehandPoints(points: Point2D[], smoothing: number): Point2D[] {
  let pts = points;
  for (let i = 0, n = freehandSmoothingPasses(smoothing); i < n; i++) pts = chaikinLine(pts, false);
  return pts;
}

// ============================================================================
// CORNERS (point-click lines)
// ============================================================================

export type LineCornerStyle = 'sharp' | 'rounded' | 'chamfer';

/**
 * Round or chamfer the corners of a polyline. Points and radius must be in
 * the same (pixel) units so corners stay circular on non-square outputs.
 * The radius is clamped so neighbouring corners never overlap.
 */
export function applyLineCorners(
  points: Point2D[],
  closed: boolean,
  style: LineCornerStyle | undefined,
  radius: number | undefined,
  arcSegments = 6,
): Point2D[] {
  const r = Number.isFinite(radius) ? Math.max(0, radius as number) : 0;
  if ((style !== 'rounded' && style !== 'chamfer') || r <= 0) return points;
  const n = points.length;
  if (n < 3) return points;
  const out: Point2D[] = [];
  for (let i = 0; i < n; i++) {
    const p = points[i];
    const interior = closed || (i > 0 && i < n - 1);
    if (!interior) { out.push(p); continue; }
    const prev = points[(i - 1 + n) % n];
    const next = points[(i + 1) % n];
    const ax = prev.x - p.x, ay = prev.y - p.y;
    const bx = next.x - p.x, by = next.y - p.y;
    const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
    if (la < 1e-9 || lb < 1e-9) { out.push(p); continue; }
    const ux = ax / la, uy = ay / la, vx = bx / lb, vy = by / lb;
    const cos = Math.max(-1, Math.min(1, ux * vx + uy * vy));
    const theta = Math.acos(cos); // angle between the two legs
    if (theta > Math.PI - 1e-3 || theta < 1e-3) { out.push(p); continue; }
    const tanHalf = Math.tan(theta / 2);
    // Distance from the corner to each tangent point, capped at half a leg.
    const t = Math.min(r / tanHalf, la / 2, lb / 2);
    const a = { x: p.x + ux * t, y: p.y + uy * t };
    const b = { x: p.x + vx * t, y: p.y + vy * t };
    if (style === 'chamfer') { out.push(a, b); continue; }
    const rr = t * tanHalf;
    const bisx = ux + vx, bisy = uy + vy;
    const bl = Math.hypot(bisx, bisy);
    const cd = rr / Math.sin(theta / 2);
    const c = { x: p.x + (bisx / bl) * cd, y: p.y + (bisy / bl) * cd };
    const a0 = Math.atan2(a.y - c.y, a.x - c.x);
    const a1 = Math.atan2(b.y - c.y, b.x - c.x);
    let sweep = a1 - a0;
    while (sweep > Math.PI) sweep -= 2 * Math.PI;
    while (sweep < -Math.PI) sweep += 2 * Math.PI;
    for (let k = 0; k <= arcSegments; k++) {
      const ang = a0 + (sweep * k) / arcSegments;
      out.push({ x: c.x + Math.cos(ang) * rr, y: c.y + Math.sin(ang) * rr });
    }
  }
  return out;
}

/**
 * Corners applied in pixel space for a canvas of `width`×`height`, on
 * normalized points. Returns normalized points.
 */
export function applyLineCornersNormalized(
  points: Point2D[],
  closed: boolean,
  style: LineCornerStyle | undefined,
  radiusPx: number | undefined,
  width: number,
  height: number,
): Point2D[] {
  if ((style !== 'rounded' && style !== 'chamfer') || !(radiusPx && radiusPx > 0)) return points;
  const w = Math.max(1, width), h = Math.max(1, height);
  const px = points.map((p) => ({ x: p.x * w, y: p.y * h }));
  return applyLineCorners(px, closed, style, radiusPx).map((p) => ({ x: p.x / w, y: p.y / h }));
}

/** Points the renderers draw for an element's shape, before its transform. */
export function lineShapeRenderPoints(element: LineElement, width: number, height: number): Point2D[] {
  const shape = element.shape;
  let pts: Point2D[] = shape.points.map((p) => ({ x: p.x, y: p.y }));
  if (shape.type === 'freehand') {
    pts = smoothFreehandPoints(pts, shape.smoothing);
  } else if (shape.type === 'pointClick') {
    pts = applyLineCornersNormalized(pts, !!shape.closed, shape.cornerStyle, shape.cornerRadius, width, height);
  }
  return pts;
}

// ============================================================================
// ELEMENT TRANSFORM (position / rotation / scale)
// ============================================================================

const fin = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** Shape-local point → canvas point (same transform the renderers bake). */
export function lineElementToCanvas(point: Point2D, element: Pick<LineElement, 'position' | 'rotation' | 'scale'>): Point2D {
  const rot = (fin(element.rotation, 0) * Math.PI) / 180;
  const sx = fin(element.scale?.x, 1), sy = fin(element.scale?.y, 1);
  const x = (point.x - 0.5) * sx;
  const y = (point.y - 0.5) * sy;
  return {
    x: x * Math.cos(rot) - y * Math.sin(rot) + 0.5 + fin(element.position?.x, 0),
    y: x * Math.sin(rot) + y * Math.cos(rot) + 0.5 + fin(element.position?.y, 0),
  };
}

/** Canvas point → shape-local point (inverse of lineElementToCanvas). */
export function canvasToLineElement(point: Point2D, element: Pick<LineElement, 'position' | 'rotation' | 'scale'>): Point2D {
  const rot = (fin(element.rotation, 0) * Math.PI) / 180;
  const sx = fin(element.scale?.x, 1) || 1, sy = fin(element.scale?.y, 1) || 1;
  const x = point.x - 0.5 - fin(element.position?.x, 0);
  const y = point.y - 0.5 - fin(element.position?.y, 0);
  const lx = x * Math.cos(rot) + y * Math.sin(rot);
  const ly = -x * Math.sin(rot) + y * Math.cos(rot);
  return { x: lx / sx + 0.5, y: ly / sy + 0.5 };
}

/** The element's editable points where they appear on the canvas. */
export function lineElementCanvasPoints(element: LineElement): Point2D[] {
  return element.shape.points.map((p) => lineElementToCanvas(p, element));
}

export function isClosedLine(element: LineElement): boolean {
  return element.shape.type === 'pointClick' && !!element.shape.closed;
}

// ============================================================================
// HIT TESTING
// ============================================================================

function distToSegment(px: number, py: number, a: Point2D, b: Point2D): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / len2));
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
}

/** True when `p` is on the line (within margin), or inside a closed one. */
export function pointHitsLine(p: Point2D, points: Point2D[], closed: boolean, margin = 0.05): boolean {
  if (points.length < 2) return false;
  const edges = closed ? points.length : points.length - 1;
  for (let i = 0; i < edges; i++) {
    if (distToSegment(p.x, p.y, points[i], points[(i + 1) % points.length]) < margin) return true;
  }
  if (closed && points.length >= 3) {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const a = points[i], b = points[j];
      if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    if (inside) return true;
  }
  return false;
}

/**
 * Top-most visible, unlocked line under `p` (canvas coords), or null.
 * Top-most follows draw order: highest zIndex, then later in the list.
 */
export function hitTestLineElements(elements: LineElement[], p: Point2D, margin = 0.05): LineElement | null {
  const ordered = elements
    .map((element, index) => ({ element, index }))
    .sort((a, b) => (fin(b.element.zIndex, 0) - fin(a.element.zIndex, 0)) || (b.index - a.index));
  for (const { element } of ordered) {
    if (element.visible === false || element.locked) continue;
    if (pointHitsLine(p, lineElementCanvasPoints(element), isClosedLine(element), margin)) return element;
  }
  return null;
}

// ============================================================================
// DRAWING + ORDER HELPERS
// ============================================================================

/**
 * Drop trailing points that repeat the one before them. A double-click to
 * finish a point-click line also delivers two clicks at the same spot.
 */
export function trimDuplicateTailPoints(points: Point2D[], epsilon = 1e-4): Point2D[] {
  const out = points.slice();
  while (out.length > 2) {
    const a = out[out.length - 1], b = out[out.length - 2];
    if (Math.hypot(a.x - b.x, a.y - b.y) > epsilon) break;
    out.pop();
  }
  return out;
}

/** zIndex follows list order, so reordering the list reorders the drawing. */
export function syncLineZIndex(elements: LineElement[]): LineElement[] {
  return elements.map((e, i) => (e.zIndex === i ? e : { ...e, zIndex: i }));
}

/** zIndex for a line added on top of the others. */
export function nextLineZIndex(elements: LineElement[]): number {
  let max = -1;
  for (const e of elements) max = Math.max(max, fin(e.zIndex, 0));
  return Math.max(elements.length, max + 1);
}
