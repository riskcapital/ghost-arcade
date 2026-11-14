/**
 * Snapping for the mapping editor: a dragged point lands on another
 * surface's corner, on another surface's edge, or on the edge or corner of
 * the output, when it comes within a few screen pixels of one.
 *
 * Distances are measured in screen pixels of the canvas as it is shown, so
 * the pull feels the same at every zoom.
 */
import type { Point } from '../model';
import { outline, cornerPoints, gridOf, hasCurves, type WarpGeometry } from './meshGrid';

export type SnapTarget =
  | { kind: 'corner'; at: Point }
  | { kind: 'edge'; at: Point; from: Point; to: Point }
  | { kind: 'frame'; at: Point; from: Point; to: Point }
  | { kind: 'frame-corner'; at: Point }
  | { kind: 'grid'; at: Point };
export type SnapResult = { point: Point; target: SnapTarget | null };
export type SnapSurface = WarpGeometry & { enabled: boolean };
export type SnapOptions = {
  /** Shown size of the canvas in screen pixels. */
  width: number;
  height: number;
  /** Pull radius in screen pixels. */
  radius?: number;
  /** Also land on the guide grid (16 × 9) when nothing else is near. */
  grid?: boolean;
};

const FRAME: [Point, Point][] = [
  [{ x: 0, y: 0 }, { x: 1, y: 0 }],
  [{ x: 1, y: 0 }, { x: 1, y: 1 }],
  [{ x: 1, y: 1 }, { x: 0, y: 1 }],
  [{ x: 0, y: 1 }, { x: 0, y: 0 }],
];

function project(p: Point, a: Point, b: Point, w: number, h: number): { at: Point; distance: number } {
  const sx = (b.x - a.x) * w,
    sy = (b.y - a.y) * h;
  const px = (p.x - a.x) * w,
    py = (p.y - a.y) * h;
  const length = sx * sx + sy * sy;
  const t = length ? Math.max(0, Math.min(1, (px * sx + py * sy) / length)) : 0;
  const at = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  return { at, distance: Math.hypot((p.x - at.x) * w, (p.y - at.y) * h) };
}

/** The corners and outline points other surfaces offer, and their edges. */
export function snapFeatures(surfaces: SnapSurface[], exclude: (index: number) => boolean) {
  const corners: Point[] = [];
  const edges: [Point, Point][] = [];
  surfaces.forEach((s, i) => {
    if (exclude(i) || !s.enabled) return;
    const ring = outline(s, 10);
    // Straight outlines offer every lattice point on the border; curved ones their four corners.
    if (hasCurves(s) || s.mode === 'corners') corners.push(...cornerPoints(s));
    else {
      const g = gridOf(s);
      for (let i = 0; i < g.cols * g.rows; i++) {
        const c = i % g.cols,
          r = Math.floor(i / g.cols);
        if (r === 0 || c === 0 || r === g.rows - 1 || c === g.cols - 1) corners.push(s.points[i]);
      }
    }
    for (let k = 0; k < ring.length; k++) edges.push([ring[k], ring[(k + 1) % ring.length]]);
  });
  return { corners, edges };
}

/** Where `p` lands. Corners win over edges, edges over the output frame, the frame over the grid. */
export function snapPoint(p: Point, surfaces: SnapSurface[], exclude: (index: number) => boolean, options: SnapOptions): SnapResult {
  const { width: w, height: h } = options;
  const radius = options.radius ?? 12;
  const { corners, edges } = snapFeatures(surfaces, exclude);
  const near = (a: Point) => Math.hypot((a.x - p.x) * w, (a.y - p.y) * h);
  let best: { at: Point; distance: number } | null = null;
  for (const c of corners) {
    const d = near(c);
    if (d <= radius && (!best || d < best.distance)) best = { at: c, distance: d };
  }
  if (best) return { point: { ...best.at }, target: { kind: 'corner', at: { ...best.at } } };
  const frameCorners = FRAME.map(([a]) => a);
  for (const c of frameCorners) {
    const d = near(c);
    if (d <= radius && (!best || d < best.distance)) best = { at: c, distance: d };
  }
  if (best) return { point: { ...best.at }, target: { kind: 'frame-corner', at: { ...best.at } } };
  let edge: { at: Point; distance: number; from: Point; to: Point } | null = null;
  for (const [a, b] of edges) {
    const hit = project(p, a, b, w, h);
    if (hit.distance <= radius && (!edge || hit.distance < edge.distance)) edge = { ...hit, from: a, to: b };
  }
  if (edge) return { point: edge.at, target: { kind: 'edge', at: edge.at, from: edge.from, to: edge.to } };
  for (const [a, b] of FRAME) {
    const hit = project(p, a, b, w, h);
    if (hit.distance <= radius && (!edge || hit.distance < edge.distance)) edge = { ...hit, from: a, to: b };
  }
  if (edge) return { point: edge.at, target: { kind: 'frame', at: edge.at, from: edge.from, to: edge.to } };
  if (options.grid) {
    const gx = Math.round(p.x * 16) / 16,
      gy = Math.round(p.y * 9) / 9;
    const x = Math.abs(gx - p.x) * w <= radius ? gx : p.x,
      y = Math.abs(gy - p.y) * h <= radius ? gy : p.y;
    if (x !== p.x || y !== p.y) return { point: { x, y }, target: { kind: 'grid', at: { x, y } } };
  }
  return { point: p, target: null };
}

/**
 * Snap a whole shape being moved: the shift that brings the nearest of its
 * `anchors` (its corners) onto a target, or no change.
 */
export function snapShift(anchors: Point[], surfaces: SnapSurface[], exclude: (index: number) => boolean, options: SnapOptions): { dx: number; dy: number; target: SnapTarget | null } {
  let best: { dx: number; dy: number; target: SnapTarget; score: number } | null = null;
  for (const a of anchors) {
    const hit = snapPoint(a, surfaces, exclude, options);
    if (!hit.target) continue;
    const distance = Math.hypot((hit.point.x - a.x) * options.width, (hit.point.y - a.y) * options.height);
    // A corner meeting a corner beats any edge contact.
    const score = (hit.target.kind === 'corner' || hit.target.kind === 'frame-corner' ? 0 : 1000) + distance;
    if (!best || score < best.score) best = { dx: hit.point.x - a.x, dy: hit.point.y - a.y, target: hit.target, score };
  }
  return best ? { dx: best.dx, dy: best.dy, target: best.target } : { dx: 0, dy: 0, target: null };
}
