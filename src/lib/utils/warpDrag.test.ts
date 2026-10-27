import { describe, expect, it } from 'vitest';
import type { BezierPoint, Point2D, WarpCorners } from '../types';
import { quadPoint } from './layerQuad';
import {
  advanceDragTravel,
  beginDragTravel,
  beginSnapSession,
  collectSnapOutlines,
  dragTravelNormalized,
  dragTravelPx,
  type SnapView,
} from './mappingSnap';
import { nudgeSlicePolygon } from './stageNudge';
import { dragCanvasPoint, dragPoint, dragQuadPoint, moveBezierAnchor, moveBezierHandle } from './warpDrag';

/**
 * Mask points, shape warp points and the other handles that do not go
 * through WarpHandles: the pointer path a component sees, from the press
 * to each mousemove, turned into the point the drag stores.
 */

const VIEW: SnapView = { width: 1000, height: 500, zoom: 1 };

interface Step { x: number; y: number; shift?: boolean }

/** Pointer travel of a press at `from` and the moves after it, as a canvas
 *  offset (y up for layers, y down for screens and the Master Warp). */
function travelOf(from: Step, moves: Step[], view: SnapView = VIEW, yUp = true): Point2D {
  let t = beginDragTravel(from.x, from.y);
  for (const m of moves) t = advanceDragTravel(t, m.x, m.y, !!m.shift);
  return dragTravelNormalized(t, view, yUp);
}

/** Screen pixels between two canvas positions (y does not matter). */
function screenPx(view: SnapView, a: Point2D, b: Point2D): Point2D {
  return { x: (b.x - a.x) * view.width * view.zoom, y: (b.y - a.y) * view.height * view.zoom };
}

/** A layer pinned skewed and turned, y up. */
const WARPED: WarpCorners = {
  topLeft: { x: 0.18, y: 0.86 },
  topRight: { x: 0.74, y: 0.93 },
  bottomLeft: { x: 0.27, y: 0.12 },
  bottomRight: { x: 0.81, y: 0.21 },
};

describe('mask point drag', () => {
  const start: BezierPoint = { x: 0.4, y: 0.5, cpIn: { x: 0.35, y: 0.5 }, cpOut: { x: 0.45, y: 0.5 } };

  it('does not move when pressed off its centre and released', () => {
    // The handle is 8 px across; the press lands 6 px right of its centre.
    const press = { x: 400 + 6, y: 250 };
    const travel = travelOf(press, [press]);
    expect(dragCanvasPoint(start, travel)).toEqual({ x: 0.4, y: 0.5 });
    expect(moveBezierAnchor(start, dragCanvasPoint(start, travel))).toEqual(start);
  });

  it('follows the pointer from where it was, wherever it was grabbed', () => {
    const near = travelOf({ x: 406, y: 250 }, [{ x: 506, y: 250 }]);
    const far = travelOf({ x: 394, y: 244 }, [{ x: 494, y: 244 }]);
    expect(dragCanvasPoint(start, near)).toEqual(dragCanvasPoint(start, far));
    const moved = screenPx(VIEW, start, dragCanvasPoint(start, near));
    expect(moved.x).toBeCloseTo(100, 9);
    expect(moved.y).toBeCloseTo(0, 9);
  });

  it('moves a tenth as far with Shift', () => {
    const travel = travelOf({ x: 406, y: 250 }, [{ x: 506, y: 250, shift: true }]);
    expect(screenPx(VIEW, start, dragCanvasPoint(start, travel)).x).toBeCloseTo(10, 9);
    // Screen-down is canvas-down for a layer (y up).
    const down = travelOf({ x: 406, y: 250 }, [{ x: 406, y: 350, shift: true }]);
    expect(screenPx(VIEW, start, dragCanvasPoint(start, down)).y).toBeCloseTo(-10, 9);
  });

  it('carries its curve handles and stays on the canvas', () => {
    const travel = travelOf({ x: 400, y: 250 }, [{ x: 450, y: 200 }]);
    const moved = moveBezierAnchor(start, dragCanvasPoint(start, travel));
    expect(moved.x).toBeCloseTo(0.45, 12);
    expect(moved.y).toBeCloseTo(0.6, 12);
    expect(moved.cpIn!.x).toBeCloseTo(0.4, 12);
    expect(moved.cpOut!.y).toBeCloseTo(0.6, 12);
    const off = travelOf({ x: 400, y: 250 }, [{ x: 2000, y: -900 }]);
    expect(dragCanvasPoint(start, off)).toEqual({ x: 1, y: 1 });
  });

  it('a curve handle mirrors its partner unless Alt unlinks it', () => {
    const to = dragCanvasPoint(start.cpOut!, travelOf({ x: 450, y: 250 }, [{ x: 450, y: 200 }]));
    const linked = moveBezierHandle(start, 'cpOut', to, false);
    expect(linked.cpOut).toEqual(to);
    expect(linked.cpIn!.x).toBeCloseTo(0.35, 12);
    expect(linked.cpIn!.y).toBeCloseTo(0.4, 12);
    expect(moveBezierHandle(start, 'cpOut', to, true).cpIn).toEqual(start.cpIn);
  });

  it('never snaps, so Cmd or Ctrl has nothing to turn off', () => {
    // Dragged onto another layer's corner it lands exactly at the pointer.
    const target = { x: 0.5, y: 0.5 };
    const travel = travelOf({ x: 400, y: 250 }, [{ x: 499, y: 250 }]);
    const p = dragCanvasPoint(start, travel);
    expect(screenPx(VIEW, p, target).x).toBeCloseTo(1, 9);
  });
});

describe('shape warp point drag', () => {
  const startUv = { x: 0.3, y: 0.7 };
  const drawnAt = quadPoint(WARPED, startUv.x, startUv.y);

  it('does not move when pressed off its centre and released', () => {
    const travel = travelOf({ x: 306, y: 150 }, [{ x: 306, y: 150 }]);
    const p = dragQuadPoint(WARPED, startUv, travel)!;
    expect(p.x).toBeCloseTo(0.3, 12);
    expect(p.y).toBeCloseTo(0.7, 12);
  });

  it('crosses the screen with the pointer through the layer warp', () => {
    const travel = travelOf({ x: 306, y: 150 }, [{ x: 406, y: 150 }]);
    const p = dragQuadPoint(WARPED, startUv, travel)!;
    const moved = screenPx(VIEW, drawnAt, quadPoint(WARPED, p.x, p.y));
    expect(moved.x).toBeCloseTo(100, 6);
    expect(moved.y).toBeCloseTo(0, 6);
    // The same drag in layer UV is not a plain offset on a warped layer.
    expect(Math.abs(p.y - startUv.y)).toBeGreaterThan(1e-3);
  });

  it('moves a tenth as far with Shift', () => {
    const travel = travelOf({ x: 306, y: 150 }, [{ x: 406, y: 150, shift: true }]);
    const p = dragQuadPoint(WARPED, startUv, travel)!;
    const moved = screenPx(VIEW, drawnAt, quadPoint(WARPED, p.x, p.y));
    expect(moved.x).toBeCloseTo(10, 6);
    expect(moved.y).toBeCloseTo(0, 6);
  });

  it('is the move the arrow keys make, and stays on the layer', () => {
    const p = dragQuadPoint(WARPED, startUv, { x: 2, y: 0 })!;
    expect(p.x).toBe(1);
    expect(p.y).toBeGreaterThanOrEqual(0);
    expect(p.y).toBeLessThanOrEqual(1);
  });
});

describe('screen and Master Warp handle drag (y down)', () => {
  it('moves a tenth as far with Shift and does not jump when Shift changes', () => {
    const view = { width: 800, height: 450, zoom: 2 };
    const travel = travelOf({ x: 100, y: 100 }, [
      { x: 150, y: 100 },
      { x: 250, y: 100, shift: true },
      { x: 250, y: 200, shift: true },
    ], view, false);
    expect(travel.x * view.width * view.zoom).toBeCloseTo(60, 9);
    expect(travel.y * view.height * view.zoom).toBeCloseTo(10, 9);
  });

  it('a press without movement moves nothing', () => {
    expect(travelOf({ x: 106, y: 100 }, [{ x: 106, y: 100 }], VIEW, false)).toEqual({ x: 0, y: 0 });
  });
});

describe('Stage Designer anchor drag', () => {
  const polygon: BezierPoint[] = [
    { x: 100, y: 100, cpOut: { x: 140, y: 100 } },
    { x: 300, y: 100 },
    { x: 200, y: 260 },
  ];

  it('moves from where the anchor was by the travel in surface pixels', () => {
    const zoom = 0.5;
    let t = beginDragTravel(56, 50); // 6 px off the anchor's centre
    t = advanceDragTravel(t, 56, 50, false);
    expect(nudgeSlicePolygon(polygon, { idx: 0, kind: 'anchor' }, { x: t.x / zoom, y: t.y / zoom })).toEqual(polygon);
    t = advanceDragTravel(t, 156, 50, true);
    const moved = nudgeSlicePolygon(polygon, { idx: 0, kind: 'anchor' }, { x: t.x / zoom, y: t.y / zoom })!;
    // 100 screen px with Shift is 10 screen px, 20 surface px at half zoom.
    expect(moved[0].x).toBeCloseTo(120, 9);
    expect(moved[0].cpOut!.x).toBeCloseTo(160, 9);
    expect(dragTravelPx(t)).toBeCloseTo(10, 9);
  });
});

describe('Cmd or Ctrl on a drag that snaps', () => {
  it('keeps the pointer travel, grab offset and Shift, without the snap', () => {
    const outlines = collectSnapOutlines([{
      id: 'other',
      type: 'media',
      visible: true,
      corners: { topLeft: { x: 0.6, y: 0.8 }, topRight: { x: 0.9, y: 0.8 }, bottomLeft: { x: 0.6, y: 0.2 }, bottomRight: { x: 0.9, y: 0.2 } },
    } as Parameters<typeof collectSnapOutlines>[0][number]], new Set());
    const start = { x: 0.5, y: 0.8 };
    const session = () => beginSnapSession([start], outlines, { layers: true, canvasEdges: false, grid: null }, VIEW);
    const pixels = { width: 1920, height: 1080, stepPx: null };
    // Pressed 6 px off the corner, then 97 px right: 3 px short of the
    // other layer's corner.
    let t = beginDragTravel(506, 100);
    t = advanceDragTravel(t, 603, 100, false);
    const travel = dragTravelNormalized(t, VIEW, true);
    const snapped = dragPoint(session(), start, travel, dragTravelPx(t), false, pixels);
    expect(snapped.point).toEqual({ x: 0.6, y: 0.8 });
    const free = dragPoint(session(), start, travel, dragTravelPx(t), true, pixels);
    expect(screenPx(VIEW, start, free.point).x).toBeCloseTo(97, 9);
    expect(free.hit).toBeNull();
  });
});
