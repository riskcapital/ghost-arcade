import type { BezierPoint, Point2D, WarpCorners } from '../types';
import { quadInverse, quadPoint } from './layerQuad';
import { quantizeNormalized, snapPoint, snapPoints, type SnapHit, type SnapSession } from './mappingSnap';

/**
 * Where a dragged layer handle puts the layer.
 *
 * Every drag starts from where the handle was at the press and adds the
 * pointer's travel, so grabbing a handle never moves it (grabbing one off
 * its centre used to jump it to the pointer). Snapping then
 * applies one correction to everything the drag moves, so a moved layer
 * keeps its shape and an edge drag never touches the other two corners.
 * Axes that did not snap land on the project's pixel grid.
 */

export type WarpEdge = 'top' | 'bottom' | 'left' | 'right';

export const EDGE_CORNERS: Record<WarpEdge, [keyof WarpCorners, keyof WarpCorners]> = {
  top: ['topLeft', 'topRight'],
  bottom: ['bottomLeft', 'bottomRight'],
  left: ['topLeft', 'bottomLeft'],
  right: ['topRight', 'bottomRight'],
};

/** The project's pixel grid: its size and the drag step (null: free). */
export interface PixelGrid {
  width: number;
  height: number;
  stepPx: number | null;
}

export interface DragOutcome {
  hit: SnapHit | null;
}

const add = (p: Point2D, d: Point2D): Point2D => ({ x: p.x + d.x, y: p.y + d.y });

/**
 * One offset for points that move together. `travel` is the pointer travel
 * as a canvas offset, `travelPx` its length on screen.
 */
export function rigidDragDelta(
  session: SnapSession | null,
  startPoints: Point2D[],
  travel: Point2D,
  travelPx: number,
  bypass: boolean,
  pixels: PixelGrid,
): DragOutcome & { delta: Point2D } {
  const snap = session && startPoints.length > 0
    ? snapPoints(session, startPoints.map((p) => add(p, travel)), travelPx, bypass)
    : null;
  return {
    delta: {
      x: snap?.snappedX ? travel.x + snap.correction.x : quantizeNormalized(travel.x, pixels.width, pixels.stepPx),
      y: snap?.snappedY ? travel.y + snap.correction.y : quantizeNormalized(travel.y, pixels.height, pixels.stepPx),
    },
    hit: snap?.hit ?? null,
  };
}

/** A single point (a corner): snapped, otherwise on the pixel grid. */
export function dragPoint(
  session: SnapSession | null,
  start: Point2D,
  travel: Point2D,
  travelPx: number,
  bypass: boolean,
  pixels: PixelGrid,
): DragOutcome & { point: Point2D } {
  const raw = add(start, travel);
  const snap = session ? snapPoint(session, raw, travelPx, bypass) : null;
  return {
    point: {
      x: snap?.snappedX ? snap.point.x : quantizeNormalized(raw.x, pixels.width, pixels.stepPx),
      y: snap?.snappedY ? snap.point.y : quantizeNormalized(raw.y, pixels.height, pixels.stepPx),
    },
    hit: snap?.hit ?? null,
  };
}

/** Drag one edge: its two corners move by one shared offset, the other
 *  two stay exactly where they were. The session snaps those two corners. */
export function dragEdge(
  session: SnapSession | null,
  initial: WarpCorners,
  edge: WarpEdge,
  travel: Point2D,
  travelPx: number,
  bypass: boolean,
  pixels: PixelGrid,
): DragOutcome & { corners: WarpCorners } {
  const [a, b] = EDGE_CORNERS[edge];
  const { delta, hit } = rigidDragDelta(session, [initial[a], initial[b]], travel, travelPx, bypass, pixels);
  return {
    corners: { ...initial, [a]: add(initial[a], delta), [b]: add(initial[b], delta) },
    hit,
  };
}

/** Every corner moved by the same offset. */
export function translateCorners(c: WarpCorners, d: Point2D): WarpCorners {
  return {
    topLeft: add(c.topLeft, d),
    topRight: add(c.topRight, d),
    bottomLeft: add(c.bottomLeft, d),
    bottomRight: add(c.bottomRight, d),
  };
}

// ─── Points that do not snap ──────────────────────────────────────────────
// Mask points and shape warp points follow the pointer's travel from where
// they were at the press too (see DragTravel in mappingSnap.ts: Shift moves
// a tenth as far), so grabbing one off its centre never moves it.

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** A point that lives on the canvas (a layer mask point or curve handle):
 *  where it was plus the travel, kept on the canvas. */
export function dragCanvasPoint(start: Point2D, travel: Point2D): Point2D {
  return { x: clamp01(start.x + travel.x), y: clamp01(start.y + travel.y) };
}

/**
 * A point in layer UV drawn through the corner pin (a shape warp point).
 * It is moved where it is drawn and mapped back, so it crosses the screen
 * with the pointer however the layer is warped, and stays on the layer.
 * Null when the quad is folded flat there.
 */
export function dragQuadPoint(corners: WarpCorners, startUv: Point2D, travel: Point2D): Point2D | null {
  const local = quadInverse(corners, add(quadPoint(corners, startUv.x, startUv.y), travel));
  return local ? { x: clamp01(local.x), y: clamp01(local.y) } : null;
}

/** A curve point moved to `to`, its handles keeping their offsets. */
export function moveBezierAnchor(point: BezierPoint, to: Point2D): BezierPoint {
  const d = { x: to.x - point.x, y: to.y - point.y };
  const next: BezierPoint = { ...point, x: to.x, y: to.y };
  if (point.cpIn) next.cpIn = add(point.cpIn, d);
  if (point.cpOut) next.cpOut = add(point.cpOut, d);
  return next;
}

/** A curve handle moved to `to`; its partner mirrors through the point
 *  unless `unlink`. */
export function moveBezierHandle(point: BezierPoint, handle: 'cpIn' | 'cpOut', to: Point2D, unlink: boolean): BezierPoint {
  const other = handle === 'cpIn' ? 'cpOut' : 'cpIn';
  const next: BezierPoint = { ...point, [handle]: to };
  if (!unlink && point[other]) next[other] = { x: 2 * point.x - to.x, y: 2 * point.y - to.y };
  return next;
}
