import { describe, expect, it } from 'vitest';
import {
  SCREEN_MASK_CURVE_TOLERANCE,
  SCREEN_MASK_FLAT_POINTS,
  canvasToScreenContent,
  flattenScreenMask,
  inverseBilinear,
  screenMaskAlpha,
  screenContentToCanvas,
  screenMaskCanvasPoints,
  screenOutlineCanvasPoints,
} from './screenMaskGeometry';

/**
 * The canvas overlay must draw a mask exactly where the projector cuts it.
 * The core samples each projector pixel through the screen's crop or warp
 * and evaluates the mask in the screen's own UV, so on the canvas a mask
 * vertex has to be pushed through the same forward map. These pin that map
 * for every warp mode and that a canvas click inverts back to the vertex.
 */

const close = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  expect(a.x).toBeCloseTo(b.x, 5);
  expect(a.y).toBeCloseTo(b.y, 5);
};

describe('screen mask geometry', () => {
  const rect = { cropX: 0.25, cropY: 0.5, cropW: 0.5, cropH: 0.25, warpMode: 'rect' as const };

  it('maps a rect screen through its crop and back', () => {
    close(screenContentToCanvas(rect, { x: 0, y: 0 }), { x: 0.25, y: 0.5 });
    close(screenContentToCanvas(rect, { x: 1, y: 1 }), { x: 0.75, y: 0.75 });
    close(screenContentToCanvas(rect, { x: 0.5, y: 0.2 }), { x: 0.5, y: 0.55 });
    close(canvasToScreenContent(rect, { x: 0.5, y: 0.55 })!, { x: 0.5, y: 0.2 });
    // corners / meshGrid left over from another mode are ignored in rect mode.
    close(screenContentToCanvas({ ...rect, corners: { topLeft: { x: 0, y: 0 }, topRight: { x: 1, y: 0 }, bottomLeft: { x: 0, y: 1 }, bottomRight: { x: 1, y: 1 } } }, { x: 0, y: 0 }), { x: 0.25, y: 0.5 });
  });

  it('follows a corner-pinned screen with the core forward interpolation', () => {
    const pinned = {
      cropX: 0, cropY: 0, cropW: 1, cropH: 1, warpMode: 'corners' as const,
      corners: {
        topLeft: { x: 0.1, y: 0.05 }, topRight: { x: 0.8, y: 0.1 },
        bottomLeft: { x: 0.2, y: 0.95 }, bottomRight: { x: 0.95, y: 0.85 },
      },
    };
    close(screenContentToCanvas(pinned, { x: 0, y: 0 }), pinned.corners.topLeft);
    close(screenContentToCanvas(pinned, { x: 1, y: 1 }), pinned.corners.bottomRight);
    // Halfway along the top edge, then halfway down.
    close(screenContentToCanvas(pinned, { x: 0.5, y: 0 }), { x: 0.45, y: 0.075 });
    close(screenContentToCanvas(pinned, { x: 0.5, y: 0.5 }), { x: (0.45 + 0.575) / 2, y: (0.075 + 0.9) / 2 });
    for (const p of [{ x: 0.3, y: 0.7 }, { x: 0.9, y: 0.1 }, { x: 0.5, y: 0.5 }]) {
      close(canvasToScreenContent(pinned, screenContentToCanvas(pinned, p))!, p);
    }
    // Outside the quad the inverse runs past 0..1 rather than lying.
    const outside = canvasToScreenContent(pinned, { x: 0.01, y: 0.5 })!;
    expect(outside.x < 0 || outside.x > 1 || outside.y < 0 || outside.y > 1).toBe(true);
  });

  it('walks mesh cells and their border', () => {
    // A 3x2 grid whose middle column is bent to the right.
    const mesh = {
      cropX: 0, cropY: 0, cropW: 1, cropH: 1, warpMode: 'mesh' as const,
      meshGrid: {
        rows: 2, cols: 3,
        points: [
          [{ x: 0, y: 0 }, { x: 0.6, y: 0 }, { x: 1, y: 0 }],
          [{ x: 0, y: 1 }, { x: 0.4, y: 1 }, { x: 1, y: 1 }],
        ],
      },
    };
    // u = 0.5 is the middle column, so it bends with it.
    close(screenContentToCanvas(mesh, { x: 0.5, y: 0 }), { x: 0.6, y: 0 });
    close(screenContentToCanvas(mesh, { x: 0.5, y: 1 }), { x: 0.4, y: 1 });
    close(screenContentToCanvas(mesh, { x: 0.25, y: 0.5 }), { x: 0.25, y: 0.5 });
    for (const p of [{ x: 0.1, y: 0.9 }, { x: 0.75, y: 0.25 }, { x: 0.5, y: 0.5 }]) {
      close(canvasToScreenContent(mesh, screenContentToCanvas(mesh, p))!, p);
    }
    expect(canvasToScreenContent(mesh, { x: 1.5, y: 0.5 })).toBeNull();
    expect(screenOutlineCanvasPoints(mesh)).toEqual([
      { x: 0, y: 0 }, { x: 0.6, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0.4, y: 1 }, { x: 0, y: 1 },
    ]);
    // A grid too small to warp with falls back to the rect crop.
    close(screenContentToCanvas({ ...mesh, meshGrid: { rows: 1, cols: 3, points: [mesh.meshGrid.points[0]] } }, { x: 0.5, y: 0 }), { x: 0.5, y: 0 });
  });

  it('follows a Bezier mesh screen along its curved cells', () => {
    const points = [
      [{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 1, y: 0 }],
      [{ x: 0, y: 1 }, { x: 0.5, y: 1 }, { x: 1, y: 1 }],
    ];
    const straight = { cropX: 0, cropY: 0, cropW: 1, cropH: 1, warpMode: 'mesh' as const, meshGrid: { rows: 2, cols: 3, points } };
    // The top-middle handle tilts the top edge into an S: up in the right
    // cell, down in the left one (its linked mirror). A mask vertex on that
    // edge rides with it, exactly where the core samples it.
    const curved = { ...straight, meshGrid: { rows: 2, cols: 3, points, bezier: true,
      tangents: [[null, { right: { x: 0.15, y: -0.2 } }, null], [null, null, null]] } };
    expect(screenContentToCanvas(curved, { x: 0.75, y: 0 }).y).toBeLessThan(-0.05);
    expect(screenContentToCanvas(curved, { x: 0.25, y: 0 }).y).toBeGreaterThan(0.05);
    close(screenContentToCanvas(curved, { x: 0.5, y: 0 }), { x: 0.5, y: 0 });
    close(screenContentToCanvas(curved, { x: 0.3, y: 1 }), screenContentToCanvas(straight, { x: 0.3, y: 1 }));
    for (const p of [{ x: 0.75, y: 0 }, { x: 0.25, y: 0 }, { x: 0.1, y: 0.4 }, { x: 0.8, y: 0.7 }]) {
      close(canvasToScreenContent(curved, screenContentToCanvas(curved, p))!, p);
    }
    // The outline walks the curve, so the bulge is inside it.
    const outline = screenOutlineCanvasPoints(curved);
    expect(Math.min(...outline.map(q => q.y))).toBeLessThan(-0.05);
    expect(outline[0]).toEqual({ x: 0, y: 0 });
    // Bezier switched off: the stored tangents are ignored.
    const off = { ...curved, meshGrid: { ...curved.meshGrid, bezier: false } };
    close(screenContentToCanvas(off, { x: 0.25, y: 0 }), { x: 0.25, y: 0 });
  });

  it('maps every mask vertex and the screen outline', () => {
    const mask = { points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0.5, y: 1 }] };
    expect(screenMaskCanvasPoints(rect, mask)).toEqual([
      { x: 0.25, y: 0.5 }, { x: 0.75, y: 0.5 }, { x: 0.5, y: 0.75 },
    ]);
    expect(screenOutlineCanvasPoints(rect)).toEqual([
      { x: 0.25, y: 0.5 }, { x: 0.75, y: 0.5 }, { x: 0.75, y: 0.75 }, { x: 0.25, y: 0.75 },
    ]);
  });

  it('inverts a bilinear quad like the core solver', () => {
    const a = { x: 0, y: 0 }, b = { x: 1, y: 0 }, c = { x: 1, y: 1 }, d = { x: 0, y: 1 };
    close(inverseBilinear({ x: 0.3, y: 0.8 }, a, b, c, d), { x: 0.3, y: 0.8 });
    // Degenerate quad: no solution rather than NaN.
    const flat = inverseBilinear({ x: 0.5, y: 0.5 }, a, a, a, a);
    expect(Number.isNaN(flat.x) || Number.isNaN(flat.y)).toBe(false);
  });

  it('flattens curved mask edges within tolerance and leaves straight masks alone', () => {
    const straight = [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.5, y: 0.9 }];
    expect(flattenScreenMask(straight)).toEqual(straight);
    const a = { x: 0.1, y: 0.6 }, c1 = { x: 0.3, y: 0.05 }, c2 = { x: 0.7, y: 0.05 }, b = { x: 0.9, y: 0.6 };
    const flat = flattenScreenMask([{ ...a, cpOut: c1 }, { ...b, cpIn: c2 }, { x: 0.5, y: 0.97 }]);
    expect(flat.length).toBeGreaterThan(10);
    expect(flat[0]).toEqual(a);
    expect(flat[flat.length - 2]).toEqual(b);
    const n = flat.length - 2;
    const cubic = (t: number) => {
      const mt = 1 - t;
      return {
        x: mt ** 3 * a.x + 3 * mt * mt * t * c1.x + 3 * mt * t * t * c2.x + t ** 3 * b.x,
        y: mt ** 3 * a.y + 3 * mt * mt * t * c1.y + 3 * mt * t * t * c2.y + t ** 3 * b.y,
      };
    };
    for (let k = 0; k < n; k++) {
      const p = flat[k], q = flat[k + 1], mid = cubic((k + 0.5) / n);
      const dist = Math.abs((mid.x - p.x) * (q.y - p.y) - (mid.y - p.y) * (q.x - p.x)) / Math.hypot(q.x - p.x, q.y - p.y);
      expect(dist).toBeLessThanOrEqual(SCREEN_MASK_CURVE_TOLERANCE * 1.01);
    }
    // The coverage follows the curve: the arch's apex is inside, the
    // straight chord's region above it is not.
    const mask = { id: 'm', name: 'M', enabled: true, invert: false, feather: 0, points: [{ ...a, cpOut: c1 }, { ...b, cpIn: c2 }, { x: 0.5, y: 0.97 }] };
    expect(screenMaskAlpha([mask], { x: 0.5, y: 0.3 })).toBe(1);
    expect(screenMaskAlpha([mask], { x: 0.5, y: 0.15 })).toBe(0);
    // However curved, a mask fits its vertex budget.
    const wild = Array.from({ length: 32 }, (_, i) => {
      const t = (i / 32) * Math.PI * 2;
      return { x: 0.5 + 0.4 * Math.cos(t), y: 0.5 + 0.4 * Math.sin(t), cpIn: { x: 0.5, y: 2 }, cpOut: { x: 0.5, y: -1 } };
    });
    const packed = flattenScreenMask(wild);
    expect(packed.length).toBeLessThanOrEqual(SCREEN_MASK_FLAT_POINTS);
    expect(packed.length).toBeGreaterThanOrEqual(32);
  });
});
