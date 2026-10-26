import { describe, expect, it } from 'vitest';
import type { Point2D, WarpCorners } from '../types';
import {
  advanceDragTravel,
  beginDragTravel,
  beginSnapSession,
  collectSnapOutlines,
  dragTravelNormalized,
  dragTravelPx,
  layerSnapOutline,
  quantizeNormalized,
  snapExcludedLayerIds,
  snapPoint,
  snapPoints,
  snapRadiusNormalized,
  type SnapConfig,
  type SnapView,
} from './mappingSnap';
import { dragEdge, dragPoint, rigidDragDelta, translateCorners } from './warpDrag';

type TestLayer = Parameters<typeof layerSnapOutline>[0];

/** A rectangle in canvas space, y up. */
function rect(x0: number, y0: number, x1: number, y1: number): WarpCorners {
  return {
    topLeft: { x: x0, y: y1 },
    topRight: { x: x1, y: y1 },
    bottomLeft: { x: x0, y: y0 },
    bottomRight: { x: x1, y: y0 },
  };
}

function layer(id: string, corners: WarpCorners, extra: Partial<TestLayer> = {}): TestLayer {
  return { id, type: 'media', visible: true, corners, ...extra } as TestLayer;
}

const LAYERS_ONLY: SnapConfig = { layers: true, canvasEdges: true, grid: null };
const view = (width: number, height: number, zoom = 1): SnapView => ({ width, height, zoom });
/** A point `px` screen pixels right of / above `p` (y up). */
const offset = (v: SnapView, p: Point2D, dxPx: number, dyPx: number): Point2D => ({
  x: p.x + dxPx / (v.width * v.zoom),
  y: p.y + dyPx / (v.height * v.zoom),
});
const FAR = 100; // pointer travel well past the radius

describe('mapping snap: radius on screen', () => {
  it('shrinks in canvas units as the canvas zooms in', () => {
    const r1 = snapRadiusNormalized(view(1000, 1000, 1));
    const r4 = snapRadiusNormalized(view(1000, 1000, 4));
    expect(r1.x).toBeCloseTo(0.008, 12);
    expect(r4.x).toBeCloseTo(0.002, 12);

    // The same canvas offset snaps zoomed out and not zoomed in.
    const target = layer('a', rect(0.3, 0.3, 0.6, 0.6));
    const outlines = collectSnapOutlines([target], new Set());
    const corner = { x: 0.6, y: 0.6 };
    const near = { x: 0.6 + 0.005, y: 0.6 };
    const zoomedOut = beginSnapSession([{ x: 0.9, y: 0.9 }], outlines, LAYERS_ONLY, view(1000, 1000, 1));
    expect(snapPoint(zoomedOut, near, FAR).point).toEqual(corner);
    const zoomedIn = beginSnapSession([{ x: 0.9, y: 0.9 }], outlines, LAYERS_ONLY, view(1000, 1000, 4));
    expect(snapPoint(zoomedIn, near, FAR).point).toEqual(near);
  });

  it('pulls the same distance across and up a 16:9 canvas', () => {
    const v = view(1600, 900);
    const outlines = collectSnapOutlines([layer('a', rect(0.25, 0.25, 0.5, 0.5))], new Set());
    const corner = { x: 0.5, y: 0.5 };
    const at = (dx: number, dy: number) => {
      const session = beginSnapSession([{ x: 0.9, y: 0.9 }], outlines, { ...LAYERS_ONLY, canvasEdges: false }, v);
      return snapPoint(session, offset(v, corner, dx, dy), FAR);
    };
    expect(at(7, 0).point).toEqual(corner);
    expect(at(0, 7).point).toEqual(corner);
    expect(at(9, 0).hit?.kind).not.toBe('corner');
    expect(at(0, 9).hit?.kind).not.toBe('corner');
    expect(at(0, 9).hit?.kind).not.toBe('edge');
  });
});

describe('mapping snap: a point that starts on a target', () => {
  const v = view(1000, 1000);
  // Another full-canvas layer: the new layer's corners start on its corners
  // and on the canvas corners.
  const outlines = collectSnapOutlines([layer('under', rect(0, 0, 1, 1))], new Set());
  const start = { x: 0, y: 1 };

  it('does not spring back for a small move', () => {
    const session = beginSnapSession([start], outlines, LAYERS_ONLY, v);
    const moved = offset(v, start, 5, -4);
    expect(snapPoint(session, moved, Math.hypot(5, 4)).point).toEqual(moved);
  });

  it('slides along the edge it started on without being pulled onto it', () => {
    const session = beginSnapSession([start], outlines, LAYERS_ONLY, v);
    const moved = offset(v, start, 40, -3);
    const result = snapPoint(session, moved, 40);
    expect(result.point).toEqual(moved);
    expect(result.hit).toBeNull();
  });

  it('pulls again once the point has left and comes back', () => {
    const session = beginSnapSession([start], outlines, LAYERS_ONLY, v);
    snapPoint(session, offset(v, start, 30, -30), 42);
    expect(snapPoint(session, offset(v, start, 3, -3), 4).point).toEqual(start);
  });

  it('never snaps before the pointer has moved past the radius', () => {
    const elsewhere = collectSnapOutlines([layer('b', rect(0.5, 0.5, 0.7, 0.7))], new Set());
    const from = offset(v, { x: 0.5, y: 0.5 }, -12, 0);
    const session = beginSnapSession([from], elsewhere, LAYERS_ONLY, v);
    const moved = offset(v, { x: 0.5, y: 0.5 }, -6, 0);
    expect(snapPoint(session, moved, 6).point).toEqual(moved);
    expect(snapPoint(session, moved, 9).point).toEqual({ x: 0.5, y: 0.5 });
  });
});

describe('mapping snap: targets', () => {
  it('leaves out the layers being moved, their groups and their children', () => {
    const layers = [
      { id: 'g' },
      { id: 'child', parentGroupId: 'g' },
      { id: 'sibling', parentGroupId: 'g' },
      { id: 'other' },
      { id: 'g2' },
      { id: 'g2-child', parentGroupId: 'g2' },
    ];
    expect([...snapExcludedLayerIds(layers, 'child')].sort()).toEqual(['child', 'g']);
    expect([...snapExcludedLayerIds(layers, 'g')].sort()).toEqual(['child', 'g', 'sibling']);
    expect([...snapExcludedLayerIds(layers, 'other', ['other', 'g2'])].sort()).toEqual(['g2', 'g2-child', 'other']);
  });

  it('skips hidden layers, groups, masks and round shapes', () => {
    const outlines = collectSnapOutlines([
      layer('hidden', rect(0, 0, 1, 1), { visible: false }),
      layer('group', rect(0, 0, 1, 1), { type: 'group' }),
      layer('mask', rect(0, 0, 1, 1), { type: 'mask' }),
      layer('circle', rect(0, 0, 1, 1), { layerShape: { type: 'circle', enabled: true, params: {} } as TestLayer['layerShape'] }),
      layer('excluded', rect(0, 0, 1, 1)),
      layer('kept', rect(0.1, 0.1, 0.2, 0.2)),
    ], new Set(['excluded']));
    expect(outlines.map((o) => o.layerId)).toEqual(['kept']);
  });

  it('uses a custom shape outline, not its bounding quad', () => {
    const shaped = layer('shape', rect(0, 0, 0.5, 0.5), {
      layerShape: {
        type: 'custom',
        enabled: true,
        params: { customClosed: true, customPoints: [{ x: 0.5, y: 1 }, { x: 1, y: 0 }, { x: 0, y: 0 }] },
      } as TestLayer['layerShape'],
    });
    const outline = layerSnapOutline(shaped)!;
    expect(outline.corners).toEqual([{ x: 0.25, y: 0.5 }, { x: 0.5, y: 0 }, { x: 0, y: 0 }]);
    // The quad's top-left corner is not a target.
    const v = view(1000, 1000);
    const session = beginSnapSession([{ x: 0.9, y: 0.9 }], [outline], { ...LAYERS_ONLY, canvasEdges: false }, v);
    const nearQuadCorner = offset(v, { x: 0, y: 0.5 }, 3, -3);
    expect(snapPoint(session, nearQuadCorner, FAR).point).toEqual(nearQuadCorner);
  });

  it('uses the outline of a warped mesh', () => {
    const points = [
      [{ x: 0.1, y: 0.9 }, { x: 0.5, y: 1 }, { x: 0.9, y: 0.9 }],
      [{ x: 0, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 1, y: 0.5 }],
      [{ x: 0.1, y: 0.1 }, { x: 0.5, y: 0 }, { x: 0.9, y: 0.1 }],
    ];
    const meshed = layer('mesh', rect(0, 0, 1, 1), { warpMode: 'mesh', meshGrid: { rows: 3, cols: 3, points } });
    const outline = layerSnapOutline(meshed)!;
    expect(outline.corners[0].x).toBeCloseTo(0.1, 9);
    expect(outline.corners[0].y).toBeCloseTo(0.9, 9);
    expect(outline.corners[2].x).toBeCloseTo(0.9, 9);
    expect(outline.corners[2].y).toBeCloseTo(0.1, 9);
  });
});

describe('mapping snap: moving several points together', () => {
  const v = view(1000, 1000);
  const config: SnapConfig = { layers: true, canvasEdges: false, grid: null };

  it('moves the whole layer by one correction, keeping its size', () => {
    const outlines = collectSnapOutlines([layer('t', rect(0.6, 0.6, 0.8, 0.8))], new Set());
    const start = rect(0.2, 0.2, 0.4, 0.4);
    const pts = [start.topLeft, start.topRight, start.bottomRight, start.bottomLeft];
    const session = beginSnapSession(pts, outlines, config, v);
    // Top-right ends 4 px from the target's bottom-left corner.
    const travel = { x: 0.2 - 0.004, y: 0.2 + 0.003 };
    const { delta, hit } = rigidDragDelta(session, pts, travel, FAR, false, { width: 1920, height: 1080, stepPx: null });
    expect(hit?.kind).toBe('corner');
    const moved = translateCorners(start, delta);
    expect(moved.topRight.x).toBeCloseTo(0.6, 12);
    expect(moved.topRight.y).toBeCloseTo(0.6, 12);
    expect(moved.topRight.x - moved.topLeft.x).toBeCloseTo(0.2, 12);
    expect(moved.topLeft.y - moved.bottomLeft.y).toBeCloseTo(0.2, 12);
  });

  it('an edge drag never moves the other two corners', () => {
    const outlines = collectSnapOutlines([layer('t', rect(0.7, 0, 0.9, 1))], new Set());
    const start = rect(0.2, 0.2, 0.5, 0.5);
    const session = beginSnapSession([start.topRight, start.bottomRight], outlines, config, v);
    const { corners, hit } = dragEdge(session, start, 'right', { x: 0.197, y: 0.01 }, FAR, false, { width: 1920, height: 1080, stepPx: 1 });
    expect(hit?.kind).toBe('edge');
    expect(corners.topLeft).toEqual(start.topLeft);
    expect(corners.bottomLeft).toEqual(start.bottomLeft);
    expect(corners.topRight.x).toBeCloseTo(0.7, 12);
    expect(corners.bottomRight.x).toBeCloseTo(0.7, 12);
    // Both moving corners got the same offset.
    expect(corners.topRight.y - start.topRight.y).toBeCloseTo(corners.bottomRight.y - start.bottomRight.y, 12);
  });
});

describe('mapping snap: grid and canvas edges', () => {
  it('a 64 grid leaves most of each cell free', () => {
    const v = view(1000, 1000);
    const config: SnapConfig = { layers: false, canvasEdges: false, grid: { columns: 64, rows: 64 } };
    const cell = 1 / 64;
    const at = (fraction: number) => {
      const session = beginSnapSession([{ x: 0.5, y: 0.5 }], [], config, v);
      const p = { x: 10 * cell + fraction * cell, y: 0.3 + 0.4 * cell };
      return snapPoint(session, p, FAR);
    };
    expect(at(0.1).snappedX).toBe(true);
    expect(at(0.4).snappedX).toBe(false);
    expect(at(0.4).snappedY).toBe(false);
    let free = 0;
    for (let i = 0; i < 100; i++) if (!at(i / 100).snappedX) free++;
    expect(free).toBeGreaterThanOrEqual(45);
  });

  it('snaps to the canvas edge only when canvas edges are on', () => {
    const v = view(1000, 1000);
    const p = { x: 0.004, y: 0.5 };
    const on = beginSnapSession([{ x: 0.5, y: 0.5 }], [], { layers: true, canvasEdges: true, grid: null }, v);
    expect(snapPoint(on, p, FAR).point.x).toBe(0);
    const off = beginSnapSession([{ x: 0.5, y: 0.5 }], [], { layers: false, canvasEdges: false, grid: null }, v);
    expect(snapPoint(off, p, FAR).point).toEqual(p);
  });

  it('Cmd or Ctrl held returns the raw point', () => {
    const v = view(1000, 1000);
    const outlines = collectSnapOutlines([layer('t', rect(0.4, 0.4, 0.6, 0.6))], new Set());
    const session = beginSnapSession([{ x: 0.9, y: 0.9 }], outlines, { layers: true, canvasEdges: true, grid: { columns: 8, rows: 8 } }, v);
    const p = { x: 0.402, y: 0.601 };
    const result = snapPoint(session, p, FAR, true);
    expect(result.point).toEqual(p);
    expect(result.hit).toBeNull();
    const dragged = dragPoint(session, { x: 0.3, y: 0.5 }, { x: 0.102, y: 0.101 }, FAR, true, { width: 1000, height: 1000, stepPx: null });
    expect(dragged.point.x).toBeCloseTo(0.402, 12);
    expect(dragged.point.y).toBeCloseTo(0.601, 12);
  });

  it('several points snap each axis to the nearest line', () => {
    const v = view(1000, 1000);
    const session = beginSnapSession([{ x: 0.3, y: 0.3 }, { x: 0.6, y: 0.6 }], [], { layers: false, canvasEdges: true, grid: null }, v);
    const result = snapPoints(session, [{ x: 0.005, y: 0.3 }, { x: 0.6, y: 0.996 }], FAR);
    expect(result.correction.x).toBeCloseTo(-0.005, 12);
    expect(result.correction.y).toBeCloseTo(0.004, 12);
  });
});

describe('drag travel', () => {
  it('moves a tenth as far with Shift and never jumps when Shift changes', () => {
    let t = beginDragTravel(100, 100);
    t = advanceDragTravel(t, 110, 100, false);
    t = advanceDragTravel(t, 120, 100, true);
    t = advanceDragTravel(t, 130, 90, false);
    expect(t.x).toBeCloseTo(21, 12);
    expect(t.y).toBeCloseTo(-10, 12);
    expect(dragTravelPx(t)).toBeCloseTo(Math.hypot(21, 10), 12);
  });

  it('turns screen travel into a canvas offset at any zoom, y up for layers', () => {
    const t = advanceDragTravel(beginDragTravel(0, 0), 20, 10, false);
    expect(dragTravelNormalized(t, view(1000, 500, 2), true)).toEqual({ x: 0.01, y: -0.01 });
    expect(dragTravelNormalized(t, view(1000, 500, 2), false)).toEqual({ x: 0.01, y: 0.01 });
  });

  it('a press without movement leaves the point where it was', () => {
    const v = view(1000, 1000);
    const outlines = collectSnapOutlines([layer('under', rect(0, 0, 1, 1))], new Set());
    const start = { x: 0.2, y: 1 };
    const session = beginSnapSession([start], outlines, LAYERS_ONLY, v);
    const travel = dragTravelNormalized(beginDragTravel(5, 5), v, true);
    const { point } = dragPoint(session, start, travel, 0, false, { width: 1920, height: 1080, stepPx: 1 });
    expect(point.x).toBeCloseTo(0.2, 3);
    expect(point.y).toBe(1);
  });

  it('rounds to project pixels', () => {
    expect(quantizeNormalized(0.1234, 1000, 1)).toBeCloseTo(0.123, 12);
    expect(quantizeNormalized(0.1234, 1000, 5)).toBeCloseTo(0.125, 12);
    expect(quantizeNormalized(0.1234, 1000, null)).toBe(0.1234);
  });
});
