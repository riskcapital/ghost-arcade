import { describe, expect, it } from 'vitest';
import { createMeshGrid, type BezierPoint, type LayerShape, type MeshWarpGrid, type Point2D } from '../types';
import {
  fittableShapeOutline,
  fittedMeshGrid,
  refitRestingMesh,
  restLatticeIsValid,
  shapeBoundsRest,
  shapeOutlineRest,
} from './meshShapeFit';
import {
  evaluateMeshGrid,
  invertLayerMesh,
  isIdentityMeshGrid,
  layerRenderMeshGrid,
  meshDomainToLayerUv,
  meshHasRest,
  withMeshPoints,
} from './meshWarp';

function customShape(points: BezierPoint[], extra: Partial<LayerShape['params']> = {}): LayerShape {
  return {
    type: 'custom',
    enabled: true,
    params: { feather: 0, rotation: 0, customPoints: points, customClosed: true, ...extra },
  } as LayerShape;
}

/** A small square in the upper left of a full-canvas layer. */
const square = customShape([
  { x: 0.1, y: 0.9 }, { x: 0.3, y: 0.9 }, { x: 0.3, y: 0.7 }, { x: 0.1, y: 0.7 },
]);

/** A circle of radius 0.15 around (0.6, 0.4), as four Bezier arcs. */
function circleShape(cx = 0.6, cy = 0.4, r = 0.15): LayerShape {
  const k = 0.5523 * r;
  return customShape([
    { x: cx, y: cy + r, cpIn: { x: cx - k, y: cy + r }, cpOut: { x: cx + k, y: cy + r } },
    { x: cx + r, y: cy, cpIn: { x: cx + r, y: cy + k }, cpOut: { x: cx + r, y: cy - k } },
    { x: cx, y: cy - r, cpIn: { x: cx + k, y: cy - r }, cpOut: { x: cx - k, y: cy - r } },
    { x: cx - r, y: cy, cpIn: { x: cx - r, y: cy - k }, cpOut: { x: cx - r, y: cy + k } },
  ]);
}

/** An L: concave, so a plain Coons fill folds without relaxing. */
const ell = customShape([
  { x: 0.2, y: 0.8 }, { x: 0.35, y: 0.8 }, { x: 0.35, y: 0.4 }, { x: 0.7, y: 0.4 },
  { x: 0.7, y: 0.25 }, { x: 0.2, y: 0.25 },
]);

function insidePolygon(p: Point2D, polygon: Point2D[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** The fitted mesh's border at rest, walked around the ring. */
function restBorder(rest: Point2D[][]): Point2D[] {
  const rows = rest.length, cols = rest[0].length;
  const ring: Point2D[] = [];
  for (let c = 0; c < cols; c++) ring.push(rest[0][c]);
  for (let r = 1; r < rows; r++) ring.push(rest[r][cols - 1]);
  for (let c = cols - 2; c >= 0; c--) ring.push(rest[rows - 1][c]);
  for (let r = rows - 2; r > 0; r--) ring.push(rest[r][0]);
  return ring;
}

describe('mesh fitted to a Custom Shape', () => {
  it('only fits closed, visible, uninverted custom shapes', () => {
    expect(fittableShapeOutline(square)).not.toBeNull();
    expect(fittableShapeOutline({ ...square, params: { ...square.params, customClosed: false } })).toBeNull();
    expect(fittableShapeOutline({ ...square, params: { ...square.params, invert: true } })).toBeNull();
    expect(fittableShapeOutline({ ...square, enabled: false })).toBeNull();
    expect(fittableShapeOutline(null)).toBeNull();
    expect(fittableShapeOutline({ ...square, type: 'circle' } as LayerShape)).toBeNull();
  });

  it('rests an even grid on the shape bounds, a hair outside them', () => {
    const rest = shapeBoundsRest(fittableShapeOutline(square)!, 3, 3);
    expect(rest[0][0].x).toBeLessThan(0.1);
    expect(rest[0][0].x).toBeGreaterThan(0.09);
    expect(rest[0][0].y).toBeGreaterThan(0.9);
    expect(rest[2][2].x).toBeGreaterThan(0.3);
    expect(rest[2][2].y).toBeLessThan(0.7);
    expect(rest[1][1].x).toBeCloseTo(0.2, 6);
    expect(rest[1][1].y).toBeCloseTo(0.8, 6);
  });

  it('starts unwarped: every layer position lands where it was', () => {
    const { grid, fitted } = fittedMeshGrid(square, 3, 3, 'shape');
    expect(fitted).toBe('shape');
    expect(meshHasRest(grid)).toBe(true);
    expect(isIdentityMeshGrid(grid)).toBe(true);
    for (const p of [{ x: 0.15, y: 0.85 }, { x: 0.25, y: 0.72 }, { x: 0.3, y: 0.9 }]) {
      const out = evaluateMeshGrid(grid, p.x, p.y);
      expect(out.x).toBeCloseTo(p.x, 6);
      expect(out.y).toBeCloseTo(p.y, 6);
    }
    // A position past the fitted mesh still lands next to it.
    const outside = evaluateMeshGrid(grid, 0.5, 0.5);
    expect(outside.x).toBeCloseTo(0.5, 6);
    expect(outside.y).toBeCloseTo(0.5, 6);
  });

  it('moves the shape with the fitted mesh points', () => {
    const { grid } = fittedMeshGrid(square, 3, 3, 'shape');
    const points = grid.points.map((row) => row.map((p) => ({ ...p })));
    points[0][2] = { x: points[0][2].x + 0.1, y: points[0][2].y + 0.05 };
    const warpedGrid = withMeshPoints(grid, points);
    expect(isIdentityMeshGrid(warpedGrid)).toBe(false);
    // The shape's top-right corner sits next to that point and follows it.
    const corner = evaluateMeshGrid(warpedGrid, 0.3, 0.9);
    expect(corner.x).toBeGreaterThan(0.38);
    expect(corner.y).toBeGreaterThan(0.93);
    // The opposite corner stays put.
    const far = evaluateMeshGrid(warpedGrid, 0.1, 0.7);
    expect(far.x).toBeCloseTo(0.1, 6);
    expect(far.y).toBeCloseTo(0.7, 6);
    // And the inverse finds the layer position again.
    for (const p of [{ x: 0.12, y: 0.88 }, { x: 0.28, y: 0.86 }, { x: 0.2, y: 0.75 }]) {
      const back = invertLayerMesh(warpedGrid, evaluateMeshGrid(warpedGrid, p.x, p.y));
      expect(back).not.toBeNull();
      expect(back!.x).toBeCloseTo(p.x, 5);
      expect(back!.y).toBeCloseTo(p.y, 5);
    }
  });

  it('keeps the rest lattice when the renderer strips Bezier state', () => {
    const { grid } = fittedMeshGrid(square, 3, 3, 'shape');
    const render = layerRenderMeshGrid({ warpMode: 'mesh', meshGrid: { ...grid, bezier: false } });
    expect(render?.rest).toBe(grid.rest);
    expect(meshDomainToLayerUv(render!, 0.5, 0.5).x).toBeCloseTo(0.2, 6);
  });

  it('follows a circle outline with its border just outside the curve', () => {
    const outline = fittableShapeOutline(circleShape())!;
    for (const size of [3, 4, 6]) {
      const fitted = shapeOutlineRest(outline, size, size);
      expect(fitted, `${size}x${size}`).not.toBeNull();
      expect(fitted!.spansInnerCorners).toBe(false);
      const rest = fitted!.rest;
      expect(restLatticeIsValid(rest)).toBe(true);
      const border = restBorder(rest);
      // Every outline point is on the mesh.
      for (const p of outline) expect(insidePolygon(p, border), `${size}: ${p.x},${p.y}`).toBe(true);
      // And the border hugs the circle instead of its bounding box.
      for (const p of border) {
        const d = Math.hypot(p.x - 0.6, p.y - 0.4);
        expect(d).toBeGreaterThan(0.149);
        expect(d).toBeLessThan(size === 3 ? 0.23 : 0.19);
      }
    }
  });

  it('spans the inner corner of a concave outline instead of folding', () => {
    const outline = fittableShapeOutline(ell)!;
    for (const size of [3, 4, 5, 8]) {
      const fitted = shapeOutlineRest(outline, size, size);
      expect(fitted, `${size}x${size}`).not.toBeNull();
      expect(restLatticeIsValid(fitted!.rest)).toBe(true);
      const border = restBorder(fitted!.rest);
      for (const p of outline) expect(insidePolygon(p, border), `${size}: ${p.x},${p.y}`).toBe(true);
      // The outer corners are on the border, not cut and pushed out.
      const onBorder = (q: Point2D) => border.some((p) => Math.hypot(p.x - q.x, p.y - q.y) < 0.02);
      for (const corner of [{ x: 0.2, y: 0.8 }, { x: 0.7, y: 0.25 }, { x: 0.2, y: 0.25 }]) {
        expect(onBorder(corner), `${size}: ${corner.x},${corner.y}`).toBe(true);
      }
    }
    const { grid, fitted, spansInnerCorners } = fittedMeshGrid(ell, 5, 5, 'outline');
    expect(fitted).toBe('outline');
    expect(spansInnerCorners).toBe(true);
    expect(grid.fit).toBe('outline');
  });

  it('puts a triangle on its three corners and the middle of its base', () => {
    const triangle = customShape([{ x: 0.5, y: 0.9 }, { x: 0.9, y: 0.1 }, { x: 0.1, y: 0.1 }]);
    const fitted = shapeOutlineRest(fittableShapeOutline(triangle)!, 4, 4)!;
    expect(fitted.spansInnerCorners).toBe(false);
    const rest = fitted.rest;
    expect(restLatticeIsValid(rest)).toBe(true);
    const near = (p: Point2D, x: number, y: number) => Math.hypot(p.x - x, p.y - y) < 0.03;
    expect(near(rest[0][0], 0.5, 0.9)).toBe(true);
    expect(near(rest[0][3], 0.9, 0.1)).toBe(true);
    expect(near(rest[3][3], 0.5, 0.1)).toBe(true);
    expect(near(rest[3][0], 0.1, 0.1)).toBe(true);
  });

  it('round-trips layer positions through an outline mesh', () => {
    const { grid, fitted } = fittedMeshGrid(circleShape(), 4, 4, 'outline');
    expect(fitted).toBe('outline');
    for (const p of [{ x: 0.6, y: 0.4 }, { x: 0.52, y: 0.47 }, { x: 0.68, y: 0.31 }]) {
      const out = evaluateMeshGrid(grid, p.x, p.y);
      expect(out.x).toBeCloseTo(p.x, 6);
      expect(out.y).toBeCloseTo(p.y, 6);
      const back = invertLayerMesh(grid, out);
      expect(back!.x).toBeCloseTo(p.x, 5);
      expect(back!.y).toBeCloseTo(p.y, 5);
    }
  });

  it('refits a resting mesh when its shape changes, and leaves a warped one alone', () => {
    const { grid } = fittedMeshGrid(square, 3, 3, 'shape');
    const moved = customShape([
      { x: 0.5, y: 0.6 }, { x: 0.9, y: 0.6 }, { x: 0.9, y: 0.2 }, { x: 0.5, y: 0.2 },
    ]);
    const refit = refitRestingMesh(grid, moved)!;
    expect(refit.fit).toBe('shape');
    expect(refit.rest![1][1].x).toBeCloseTo(0.7, 6);
    expect(refit.rest![1][1].y).toBeCloseTo(0.4, 6);

    const points = grid.points.map((row) => row.map((p) => ({ ...p })));
    points[1][1] = { x: 0.22, y: 0.83 };
    const warpedGrid: MeshWarpGrid = withMeshPoints(grid, points);
    expect(refitRestingMesh(warpedGrid, moved)).toBe(warpedGrid);

    // No closed shape any more: the resting mesh covers the whole layer again.
    const opened = refitRestingMesh(grid, { ...moved, params: { ...moved.params, customClosed: false } })!;
    expect(opened.fit).toBeUndefined();
    expect(opened.rest).toBeUndefined();
    expect(isIdentityMeshGrid(opened)).toBe(true);
  });

  it('leaves a plain mesh plain', () => {
    const plain = createMeshGrid(3, 3);
    expect(refitRestingMesh(plain, square)).toBe(plain);
    expect(fittedMeshGrid(null, 3, 3, 'shape').fitted).toBeNull();
  });
});
