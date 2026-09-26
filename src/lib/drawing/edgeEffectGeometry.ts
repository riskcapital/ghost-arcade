// Edge Effects geometry in OUTPUT space.
//
// Edge effects are evaluated per output pixel against the layer's outline
// after the layer's warp, never rendered into a content texture that is then
// warped and resampled. This module builds that outline:
//
//   1. the layer shape as an exact path in layer UV (lines, circular and
//      elliptical arcs, the pen tool's cubic Beziers), y up;
//   2. carried through the mesh warp (straight or Bezier) and the corner pin
//      into output pixels (origin bottom-left, y up);
//   3. flattened adaptively until every chord is within 0.25 output px of the
//      warped curve, capped at EDGE_MAX_SEGMENTS with a flag past it;
//   4. optionally filleted (corner radius, in output px);
//   5. offset EDGE_INSET_PX inward. That offset polyline is the stroke
//      centerline: strokes sit just inside the layer edge and grow inward,
//      as they always have in the editor.
//
// Distances, stroke widths, dash lengths and arc lengths are all output
// pixels, so a 4 px stroke is 4 px wide on every edge of a perspective pin.

import type { Layer, LayerShape, Point2D } from '../types';
import { evaluateMeshGrid, layerRenderMeshGrid } from '../utils/meshWarp';

export const EDGE_MAX_SEGMENTS = 512;
export const EDGE_MAX_CORNERS = 64;
export const EDGE_FLATTEN_TOLERANCE_PX = 0.25;
/** The stroke centerline sits this many output px inside the layer outline. */
export const EDGE_INSET_PX = 5;

export interface EdgeOutline {
  /** Stroke centerline, closed, output px (y up). */
  points: Point2D[];
  /** Arc length (px) from points[0] to each point. */
  cumulative: number[];
  /** Perimeter of the centerline (px). */
  length: number;
  /** Local surface scale at each point, 1 on average: widths that scale
   *  with the surface multiply by it. */
  surfaceScale: number[];
  /** Indices into `points` of the shape's own vertices (corners). */
  corners: number[];
  /** Corner-index pairs of an inner triangulation (wireframe). */
  diagonals: Array<[number, number]>;
  /** Area centroid (px). */
  centroid: Point2D;
  /** Deepest inset of the centerline shape (px): the largest inscribed radius. */
  inradius: number;
  /** [minX, minY, maxX, maxY] of the centerline (px). */
  bbox: [number, number, number, number];
  /** Segments the outline needed at the 0.25 px tolerance. */
  segmentsNeeded: number;
  /** True when that exceeded EDGE_MAX_SEGMENTS and the outline was simplified. */
  truncated: boolean;
}

type UvPiece = {
  at(t: number): Point2D;
  /** Minimum uniform split before adaptive refinement. */
  minSplits: number;
};

const lerp = (a: Point2D, b: Point2D, t: number): Point2D => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

function linePiece(a: Point2D, b: Point2D): UvPiece {
  return { at: (t) => lerp(a, b, t), minSplits: 1 };
}

function cubicPiece(a: Point2D, c1: Point2D, c2: Point2D, b: Point2D): UvPiece {
  return {
    at: (t) => {
      const mt = 1 - t;
      const w0 = mt * mt * mt, w1 = 3 * mt * mt * t, w2 = 3 * mt * t * t, w3 = t * t * t;
      return { x: w0 * a.x + w1 * c1.x + w2 * c2.x + w3 * b.x, y: w0 * a.y + w1 * c1.y + w2 * c2.y + w3 * b.y };
    },
    minSplits: 4,
  };
}

/** Closed outline in layer UV as pieces; `corners[i]` marks whether piece i
 *  starts at one of the shape's own vertices. Mirrors convertShapeToCustom's
 *  geometry exactly, with true curves where it approximated them. */
function layerOutlinePieces(shape: LayerShape | null | undefined): { pieces: UvPiece[]; corners: boolean[] } | null {
  const polygon = (points: Point2D[]) => ({
    pieces: points.map((p, i) => linePiece(p, points[(i + 1) % points.length])),
    corners: points.map(() => true),
  });
  if (!shape || shape.enabled === false) {
    return polygon([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]);
  }
  const rotation = ((shape.params.rotation ?? 0) * Math.PI) / 180;
  const scale = shape.params.scale ?? 1.0;
  const rotatePoint = (x: number, y: number): Point2D => ({
    x: x * Math.cos(rotation) - y * Math.sin(rotation) + 0.5,
    y: x * Math.sin(rotation) + y * Math.cos(rotation) + 0.5,
  });
  const arcs = (point: (angle: number) => Point2D, start: number) => {
    const count = 8;
    const pieces: UvPiece[] = [];
    for (let i = 0; i < count; i++) {
      const a0 = start + (i / count) * Math.PI * 2;
      const a1 = start + ((i + 1) / count) * Math.PI * 2;
      pieces.push({ at: (t) => point(a0 + (a1 - a0) * t), minSplits: 2 });
    }
    return { pieces, corners: pieces.map(() => false) };
  };
  let result: { pieces: UvPiece[]; corners: boolean[] };
  switch (shape.type) {
    case 'rectangle': {
      const hw = 0.5 * scale, hh = 0.5 * scale;
      result = polygon([rotatePoint(-hw, hh), rotatePoint(hw, hh), rotatePoint(hw, -hh), rotatePoint(-hw, -hh)]);
      break;
    }
    case 'circle': {
      const r = (shape.params.radiusX ?? 0.5) * 0.5 * scale;
      result = arcs((a) => ({ x: 0.5 + r * Math.cos(a), y: 0.5 + r * Math.sin(a) }), rotation);
      break;
    }
    case 'ellipse': {
      const rx = (shape.params.radiusX ?? 0.5) * 0.5 * scale;
      const ry = (shape.params.radiusY ?? 0.35) * 0.5 * scale;
      result = arcs((a) => rotatePoint(rx * Math.cos(a), ry * Math.sin(a)), 0);
      break;
    }
    case 'triangle': {
      if (shape.controlPoints && shape.controlPoints.length === 3) {
        result = polygon(shape.controlPoints.map((p) => ({ x: p.x, y: p.y })));
      } else {
        const r = 0.4 * scale;
        result = polygon([0, 1, 2].map((i) => {
          const angle = (i / 3) * Math.PI * 2 - Math.PI / 2 + rotation;
          return { x: 0.5 + r * Math.cos(angle), y: 0.5 + r * Math.sin(angle) };
        }));
      }
      break;
    }
    case 'polygon': {
      const sides = Math.max(3, Math.round(shape.params.sides ?? 6));
      const r = 0.4 * scale;
      result = polygon(Array.from({ length: sides }, (_, i) => {
        const angle = (i / sides) * Math.PI * 2 - Math.PI / 2 + rotation;
        return { x: 0.5 + r * Math.cos(angle), y: 0.5 + r * Math.sin(angle) };
      }));
      break;
    }
    case 'star': {
      const points = Math.max(3, Math.round(shape.params.sides ?? 5));
      const outer = 0.4 * scale;
      const inner = outer * (shape.params.innerRadius ?? 0.4);
      result = polygon(Array.from({ length: points * 2 }, (_, i) => {
        const angle = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2 + rotation;
        const r = i % 2 === 0 ? outer : inner;
        return { x: 0.5 + r * Math.cos(angle), y: 0.5 + r * Math.sin(angle) };
      }));
      break;
    }
    case 'custom': {
      const pts = shape.params.customPoints;
      if (!pts || pts.length < 3) return null;
      const pieces: UvPiece[] = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        if (a.cpOut || b.cpIn) pieces.push(cubicPiece(a, a.cpOut ?? a, b.cpIn ?? b, b));
        else pieces.push(linePiece(a, b));
      }
      result = { pieces, corners: pieces.map(() => true) };
      break;
    }
    default:
      // Line and polyline shapes have no closed outline of their own; the
      // editor has always framed them with the layer rectangle.
      result = polygon([{ x: 0.1, y: 0.9 }, { x: 0.9, y: 0.9 }, { x: 0.9, y: 0.1 }, { x: 0.1, y: 0.1 }]);
      break;
  }
  // Circle shape-warp handles: the outline follows the dragged quad.
  if (shape.type === 'circle' && shape.controlPoints?.length === 5) {
    const [tl, tr, bl, br] = shape.controlPoints;
    const warp = (p: Point2D): Point2D => {
      const top = lerp(tl, tr, p.x);
      const bottom = lerp(bl, br, p.x);
      return lerp(bottom, top, p.y);
    };
    result = { pieces: result.pieces.map((piece) => ({ ...piece, at: (t: number) => warp(piece.at(t)) })), corners: result.corners };
  }
  return result;
}

type LayerGeometryInput = Pick<Layer, 'layerShape' | 'corners' | 'warpMode' | 'meshGrid'>;

/** Layer UV (y up) to output pixels (y up), through the mesh and the corner pin. */
export function layerUvToOutput(layer: LayerGeometryInput, width: number, height: number): ((uv: Point2D) => Point2D) | null {
  const c = layer.corners;
  if (!c) return null;
  const mesh = layerRenderMeshGrid(layer);
  return (uv: Point2D) => {
    const m = mesh ? evaluateMeshGrid(mesh, uv.x, uv.y) : uv;
    const topX = c.topLeft.x + (c.topRight.x - c.topLeft.x) * m.x;
    const topY = c.topLeft.y + (c.topRight.y - c.topLeft.y) * m.x;
    const botX = c.bottomLeft.x + (c.bottomRight.x - c.bottomLeft.x) * m.x;
    const botY = c.bottomLeft.y + (c.bottomRight.y - c.bottomLeft.y) * m.x;
    return { x: (botX + (topX - botX) * m.y) * width, y: (botY + (topY - botY) * m.y) * height };
  };
}

function chordError(p0: Point2D, p1: Point2D, q: Point2D): number {
  const dx = p1.x - p0.x, dy = p1.y - p0.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) return Math.hypot(q.x - p0.x, q.y - p0.y);
  const t = Math.max(0, Math.min(1, ((q.x - p0.x) * dx + (q.y - p0.y) * dy) / len2));
  return Math.hypot(q.x - (p0.x + dx * t), q.y - (p0.y + dy * t));
}

/** Flatten one piece in output space; pushes every point but the last. */
function flattenPiece(piece: UvPiece, map: (uv: Point2D) => Point2D, tolerance: number, minSplits: number, out: Point2D[]): void {
  const splits = Math.max(1, piece.minSplits, minSplits);
  const recurse = (t0: number, t1: number, p0: Point2D, p1: Point2D, depth: number) => {
    const tq1 = t0 + (t1 - t0) * 0.25;
    const tm = (t0 + t1) * 0.5;
    const tq3 = t0 + (t1 - t0) * 0.75;
    const pm = map(piece.at(tm));
    const err = Math.max(
      chordError(p0, p1, pm),
      chordError(p0, p1, map(piece.at(tq1))),
      chordError(p0, p1, map(piece.at(tq3))),
    );
    if (depth >= 14 || err <= tolerance) {
      out.push(p0);
      return;
    }
    recurse(t0, tm, p0, pm, depth + 1);
    recurse(tm, t1, pm, p1, depth + 1);
  };
  let prevT = 0;
  let prev = map(piece.at(0));
  for (let i = 1; i <= splits; i++) {
    const t = i / splits;
    const next = map(piece.at(t));
    recurse(prevT, t, prev, next, 0);
    prevT = t;
    prev = next;
  }
}

function flattenOutline(
  pieces: UvPiece[],
  cornerFlags: boolean[],
  map: (uv: Point2D) => Point2D,
  tolerance: number,
  minSplits: number,
): { points: Point2D[]; corners: number[] } {
  const points: Point2D[] = [];
  const corners: number[] = [];
  pieces.forEach((piece, i) => {
    if (cornerFlags[i]) corners.push(points.length);
    flattenPiece(piece, map, tolerance, minSplits, points);
  });
  // Drop zero-length steps; they carry no direction.
  const cleanPoints: Point2D[] = [];
  const remap = new Map<number, number>();
  points.forEach((p, i) => {
    const last = cleanPoints[cleanPoints.length - 1];
    if (last && Math.hypot(p.x - last.x, p.y - last.y) < 1e-4) { remap.set(i, cleanPoints.length - 1); return; }
    remap.set(i, cleanPoints.length);
    cleanPoints.push(p);
  });
  if (cleanPoints.length > 1) {
    const first = cleanPoints[0], last = cleanPoints[cleanPoints.length - 1];
    if (Math.hypot(first.x - last.x, first.y - last.y) < 1e-4) cleanPoints.pop();
  }
  const cleanCorners = [...new Set(corners.map((i) => Math.min(remap.get(i) ?? 0, cleanPoints.length - 1)))];
  return { points: cleanPoints, corners: cleanCorners };
}

function decimate(points: Point2D[], corners: number[], max: number): { points: Point2D[]; corners: number[] } {
  if (points.length <= max) return { points, corners };
  const keep = new Set<number>();
  for (const c of corners) if (keep.size < max / 2) keep.add(c);
  const remaining = max - keep.size;
  const step = points.length / remaining;
  for (let i = 0; i < remaining; i++) keep.add(Math.floor(i * step));
  const ordered = [...keep].sort((a, b) => a - b).slice(0, max);
  const index = new Map(ordered.map((value, i) => [value, i]));
  return { points: ordered.map((i) => points[i]), corners: corners.filter((c) => index.has(c)).map((c) => index.get(c)!) };
}

export function signedArea(points: readonly Point2D[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    area += a.x * b.y - b.x * a.y;
  }
  return area * 0.5;
}

export function areaCentroid(points: readonly Point2D[]): Point2D {
  const area = signedArea(points);
  if (Math.abs(area) < 1e-6) {
    const n = Math.max(1, points.length);
    return { x: points.reduce((s, p) => s + p.x, 0) / n, y: points.reduce((s, p) => s + p.y, 0) / n };
  }
  let cx = 0, cy = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    const f = a.x * b.y - b.x * a.y;
    cx += (a.x + b.x) * f;
    cy += (a.y + b.y) * f;
  }
  return { x: cx / (6 * area), y: cy / (6 * area) };
}

/** Round each shape corner with a circular fillet of `radius` px. */
function filletCorners(points: Point2D[], corners: number[], radius: number, tolerance: number): { points: Point2D[]; corners: number[] } {
  if (radius <= 0 || points.length < 3) return { points, corners };
  const cornerSet = new Set(corners);
  const out: Point2D[] = [];
  const outCorners: number[] = [];
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const v = points[i];
    if (!cornerSet.has(i)) { out.push(v); continue; }
    const prev = points[(i - 1 + n) % n];
    const next = points[(i + 1) % n];
    const inLen = Math.hypot(v.x - prev.x, v.y - prev.y);
    const outLen = Math.hypot(next.x - v.x, next.y - v.y);
    if (inLen < 1e-6 || outLen < 1e-6) { outCorners.push(out.length); out.push(v); continue; }
    const tin = { x: (v.x - prev.x) / inLen, y: (v.y - prev.y) / inLen };
    const tout = { x: (next.x - v.x) / outLen, y: (next.y - v.y) / outLen };
    const cos = Math.max(-1, Math.min(1, tin.x * tout.x + tin.y * tout.y));
    const turn = Math.acos(cos);
    if (turn < 0.02) { outCorners.push(out.length); out.push(v); continue; }
    const cut = Math.min(radius * Math.tan(turn / 2), inLen * 0.5, outLen * 0.5);
    const r = cut / Math.tan(turn / 2);
    const a = { x: v.x - tin.x * cut, y: v.y - tin.y * cut };
    const b = { x: v.x + tout.x * cut, y: v.y + tout.y * cut };
    const cross = tin.x * tout.y - tin.y * tout.x;
    const side = cross > 0 ? 1 : -1;
    const center = { x: a.x - tin.y * r * side, y: a.y + tin.x * r * side };
    const a0 = Math.atan2(a.y - center.y, a.x - center.x);
    let a1 = Math.atan2(b.y - center.y, b.x - center.x);
    if (side > 0 && a1 < a0) a1 += Math.PI * 2;
    if (side < 0 && a1 > a0) a1 -= Math.PI * 2;
    const step = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - tolerance / Math.max(r, tolerance))));
    const count = Math.max(1, Math.ceil(Math.abs(a1 - a0) / Math.max(step, 1e-3)));
    for (let s = 0; s <= count; s++) {
      if (s === Math.floor(count / 2)) outCorners.push(out.length);
      const t = a0 + (a1 - a0) * (s / count);
      out.push({ x: center.x + Math.cos(t) * r, y: center.y + Math.sin(t) * r });
    }
  }
  return { points: out, corners: outCorners };
}

/** Offset a closed polyline inward by `inset` px (miter vertices, clamped). */
function insetPolyline(points: Point2D[], inset: number): Point2D[] {
  const n = points.length;
  const orientation = signedArea(points) >= 0 ? 1 : -1; // +1 counter-clockwise
  return points.map((v, i) => {
    const prev = points[(i - 1 + n) % n];
    const next = points[(i + 1) % n];
    const e0 = { x: v.x - prev.x, y: v.y - prev.y };
    const e1 = { x: next.x - v.x, y: next.y - v.y };
    const l0 = Math.hypot(e0.x, e0.y) || 1;
    const l1 = Math.hypot(e1.x, e1.y) || 1;
    // Inward normals: left of the direction for a counter-clockwise outline.
    const n0 = { x: -e0.y / l0 * orientation, y: e0.x / l0 * orientation };
    const n1 = { x: -e1.y / l1 * orientation, y: e1.x / l1 * orientation };
    // Miter offset: (n0 + n1) / (1 + n0.n1) has length 1 / cos(turn / 2).
    const denom = 1 + n0.x * n1.x + n0.y * n1.y;
    let mx = n0.x, my = n0.y;
    if (denom > 1e-3) {
      mx = (n0.x + n1.x) / denom;
      my = (n0.y + n1.y) / denom;
    }
    const len = Math.hypot(mx, my);
    if (len > 3) { mx *= 3 / len; my *= 3 / len; }
    return { x: v.x + mx * inset, y: v.y + my * inset };
  });
}

function pointInPolygon(p: Point2D, points: readonly Point2D[]): boolean {
  let winding = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    const cross = (b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y);
    if (a.y <= p.y) { if (b.y > p.y && cross > 0) winding++; }
    else if (b.y <= p.y && cross < 0) winding--;
  }
  return winding !== 0;
}

function distanceToPolyline(p: Point2D, points: readonly Point2D[]): number {
  let best = Infinity;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    best = Math.min(best, chordError(a, b, p));
  }
  return best;
}

function inscribedRadius(points: readonly Point2D[], bbox: [number, number, number, number]): number {
  let best = 0;
  let cx = (bbox[0] + bbox[2]) / 2, cy = (bbox[1] + bbox[3]) / 2;
  let spanX = (bbox[2] - bbox[0]) / 2, spanY = (bbox[3] - bbox[1]) / 2;
  for (let pass = 0; pass < 3; pass++) {
    const grid = 16;
    let bestPoint = { x: cx, y: cy };
    for (let gy = 0; gy <= grid; gy++) {
      for (let gx = 0; gx <= grid; gx++) {
        const p = { x: cx - spanX + (2 * spanX * gx) / grid, y: cy - spanY + (2 * spanY * gy) / grid };
        if (!pointInPolygon(p, points)) continue;
        const d = distanceToPolyline(p, points);
        if (d > best) { best = d; bestPoint = p; }
      }
    }
    cx = bestPoint.x; cy = bestPoint.y;
    spanX /= 4; spanY /= 4;
  }
  return best;
}

/** Ear-clipping triangulation of the corner polygon; returns the inner
 *  diagonals (corner index pairs). Falls back to a fan when clipping fails. */
function triangulationDiagonals(corners: Point2D[]): Array<[number, number]> {
  const n = corners.length;
  if (n < 4) return [];
  const ccw = signedArea(corners) >= 0;
  const index = Array.from({ length: n }, (_, i) => i);
  const diagonals: Array<[number, number]> = [];
  const isConvex = (a: Point2D, b: Point2D, c: Point2D) => {
    const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    return ccw ? cross > 1e-9 : cross < -1e-9;
  };
  const inside = (p: Point2D, a: Point2D, b: Point2D, c: Point2D) => pointInPolygon(p, [a, b, c]);
  let guard = 0;
  while (index.length > 3 && guard++ < n * n) {
    let clipped = false;
    for (let i = 0; i < index.length; i++) {
      const ia = index[(i - 1 + index.length) % index.length];
      const ib = index[i];
      const ic = index[(i + 1) % index.length];
      const a = corners[ia], b = corners[ib], c = corners[ic];
      if (!isConvex(a, b, c)) continue;
      if (index.some((j) => j !== ia && j !== ib && j !== ic && inside(corners[j], a, b, c))) continue;
      diagonals.push([ia, ic]);
      index.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (index.length > 3) {
    return Array.from({ length: n - 3 }, (_, i) => [0, i + 2] as [number, number]);
  }
  return diagonals;
}

const outlineCache = new Map<string, EdgeOutline | null>();

/**
 * The output-space outline edge effects are evaluated against. Null when
 * the layer has no drawable closed outline.
 */
export function buildEdgeOutline(
  layer: LayerGeometryInput,
  width: number,
  height: number,
  options: { cornerRadius?: number } = {},
): EdgeOutline | null {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const cornerRadius = Math.max(0, Number(options.cornerRadius) || 0);
  const mesh = layerRenderMeshGrid(layer);
  const key = JSON.stringify([layer.layerShape ?? null, layer.corners ?? null, mesh, w, h, cornerRadius]);
  if (outlineCache.has(key)) return outlineCache.get(key)!;
  const outline = computeEdgeOutline(layer, w, h, cornerRadius);
  outlineCache.set(key, outline);
  if (outlineCache.size > 96) outlineCache.delete(outlineCache.keys().next().value!);
  return outline;
}

function computeEdgeOutline(layer: LayerGeometryInput, w: number, h: number, cornerRadius: number): EdgeOutline | null {
  const source = layerOutlinePieces(layer.layerShape);
  const map = layerUvToOutput(layer, w, h);
  if (!source || !map) return null;
  const mesh = layerRenderMeshGrid(layer);
  const meshSplits = mesh ? 2 * Math.max(mesh.rows - 1, mesh.cols - 1) : 1;

  let tolerance = EDGE_FLATTEN_TOLERANCE_PX;
  let flat = flattenOutline(source.pieces, source.corners, map, tolerance, meshSplits);
  const segmentsNeeded = flat.points.length;
  let truncated = false;
  while (flat.points.length > EDGE_MAX_SEGMENTS && tolerance < 64) {
    truncated = true;
    tolerance *= 2;
    flat = flattenOutline(source.pieces, source.corners, map, tolerance, meshSplits);
  }
  if (flat.points.length > EDGE_MAX_SEGMENTS) {
    truncated = true;
    flat = decimate(flat.points, flat.corners, EDGE_MAX_SEGMENTS);
  }
  if (cornerRadius > 0) {
    flat = filletCorners(flat.points, flat.corners, cornerRadius, EDGE_FLATTEN_TOLERANCE_PX);
    if (flat.points.length > EDGE_MAX_SEGMENTS) {
      truncated = true;
      flat = decimate(flat.points, flat.corners, EDGE_MAX_SEGMENTS);
    }
  }
  if (flat.points.length < 3 || Math.abs(signedArea(flat.points)) < 1) return null;

  // Surface scale: sqrt of the warp's area scale at each outline point,
  // normalised so the average over the outline is 1.
  const rawArea = Math.abs(signedArea(flat.points));
  const points = insetPolyline(flat.points, Math.min(EDGE_INSET_PX, Math.sqrt(rawArea) * 0.25));
  const surfaceScale = localSurfaceScale(layer, flat.points, w, h);

  const cumulative: number[] = [0];
  let length = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    length += Math.hypot(b.x - a.x, b.y - a.y);
    if (i + 1 < points.length) cumulative.push(length);
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  const bbox: [number, number, number, number] = [minX, minY, maxX, maxY];
  const corners = flat.corners.slice(0, EDGE_MAX_CORNERS);
  return {
    points,
    cumulative,
    length,
    surfaceScale,
    corners,
    diagonals: triangulationDiagonals(corners.map((i) => points[i])).slice(0, EDGE_MAX_CORNERS),
    centroid: areaCentroid(points),
    inradius: inscribedRadius(points, bbox),
    bbox,
    segmentsNeeded,
    truncated,
  };
}

/** Where the outline crosses the warp, how much the surface is stretched
 *  relative to its average (1 = average). */
function localSurfaceScale(layer: LayerGeometryInput, outputPoints: readonly Point2D[], w: number, h: number): number[] {
  const c = layer.corners;
  if (!c) return outputPoints.map(() => 1);
  // Inverse-free estimate: the corner pin's bilinear Jacobian at the point's
  // position inside the pinned quad, found by nearest sampling of a grid.
  const map = layerUvToOutput(layer, w, h)!;
  const grid = 24;
  const samples: Array<{ p: Point2D; s: number }> = [];
  let total = 0;
  for (let gy = 0; gy <= grid; gy++) {
    for (let gx = 0; gx <= grid; gx++) {
      const u = gx / grid, v = gy / grid;
      const e = 0.5 / grid;
      const p = map({ x: u, y: v });
      const px = map({ x: Math.min(1, u + e), y: v });
      const mx = map({ x: Math.max(0, u - e), y: v });
      const py = map({ x: u, y: Math.min(1, v + e) });
      const my = map({ x: u, y: Math.max(0, v - e) });
      const jx = { x: (px.x - mx.x), y: (px.y - mx.y) };
      const jy = { x: (py.x - my.x), y: (py.y - my.y) };
      const s = Math.sqrt(Math.abs(jx.x * jy.y - jx.y * jy.x));
      samples.push({ p, s });
      total += s;
    }
  }
  const mean = total / samples.length || 1;
  return outputPoints.map((q) => {
    let best = samples[0];
    let bestD = Infinity;
    for (const sample of samples) {
      const d = (sample.p.x - q.x) ** 2 + (sample.p.y - q.y) ** 2;
      if (d < bestD) { bestD = d; best = sample; }
    }
    return best.s / mean;
  });
}
