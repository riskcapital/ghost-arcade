// Whole-quad transforms for the layer warp handles (WarpHandles.svelte):
// rotate and scale a layer, or a set of layers, around one pivot.
//
// Corners are stored normalized with y up (0 = bottom, 1 = top), while the
// pointer moves in screen pixels with y down. Rotation is done in canvas
// pixels so a 16:9 layer keeps its shape, and the screen angle is turned
// round so the layer follows the pointer's direction.

import type { Point2D, WarpCorners } from '../types';

const CORNER_KEYS = ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'] as const;

/** The canvas the corners are drawn on, in pixels. */
export interface CanvasFrame {
  width: number;
  height: number;
}

function mapCorners(c: WarpCorners, fn: (p: Point2D) => Point2D): WarpCorners {
  return {
    topLeft: fn(c.topLeft),
    topRight: fn(c.topRight),
    bottomLeft: fn(c.bottomLeft),
    bottomRight: fn(c.bottomRight),
  };
}

/** Mean of the four corners. */
export function cornersCentroid(c: WarpCorners): Point2D {
  let x = 0;
  let y = 0;
  for (const k of CORNER_KEYS) { x += c[k].x; y += c[k].y; }
  return { x: x / 4, y: y / 4 };
}

/** Centre of the box round every corner of every quad. */
export function cornersBoundsCenter(sets: Iterable<WarpCorners>): Point2D | null {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const c of sets) {
    for (const k of CORNER_KEYS) {
      minX = Math.min(minX, c[k].x); maxX = Math.max(maxX, c[k].x);
      minY = Math.min(minY, c[k].y); maxY = Math.max(maxY, c[k].y);
    }
  }
  return Number.isFinite(minX) ? { x: (minX + maxX) / 2, y: (minY + maxY) / 2 } : null;
}

/**
 * Rotate corners round `pivot` by an angle measured on screen (radians,
 * y down, so positive is clockwise as the user sees it). The turn happens
 * in canvas pixels, so the quad keeps its on-screen shape whatever the
 * canvas aspect.
 */
export function rotateCornersOnScreen(
  c: WarpCorners,
  pivot: Point2D,
  screenAngle: number,
  frame: CanvasFrame,
): WarpCorners {
  const w = Math.max(1e-9, frame.width);
  const h = Math.max(1e-9, frame.height);
  const cos = Math.cos(screenAngle);
  const sin = Math.sin(screenAngle);
  return mapCorners(c, (p) => {
    const dx = (p.x - pivot.x) * w;
    const dy = (p.y - pivot.y) * h;
    // Clockwise on screen is clockwise in y-up pixels too, i.e. a
    // rotation by -angle in the y-up frame.
    return {
      x: pivot.x + (dx * cos + dy * sin) / w,
      y: pivot.y + (-dx * sin + dy * cos) / h,
    };
  });
}

/** Scale corners round `pivot` by `factor`. */
export function scaleCornersAround(c: WarpCorners, pivot: Point2D, factor: number): WarpCorners {
  return mapCorners(c, (p) => ({
    x: pivot.x + (p.x - pivot.x) * factor,
    y: pivot.y + (p.y - pivot.y) * factor,
  }));
}
