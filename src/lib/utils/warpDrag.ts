import type { Point2D, WarpCorners } from '../types';
import { quantizeNormalized, snapPoint, snapPoints, type SnapHit, type SnapSession } from './mappingSnap';

/**
 * Where a dragged layer handle puts the layer.
 *
 * Every drag starts from where the handle was at the press and adds the
 * pointer's travel, so grabbing a handle never moves it (a handle drawn
 * inset at the canvas edge used to jump to the pointer). Snapping then
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
