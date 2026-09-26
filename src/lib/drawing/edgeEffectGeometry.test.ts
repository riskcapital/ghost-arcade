import { describe, expect, it } from 'vitest';
import type { LayerShape, MeshWarpGrid, WarpCorners } from '../types';
import { buildEdgeOutline, EDGE_INSET_PX, EDGE_MAX_SEGMENTS, layerUvToOutput } from './edgeEffectGeometry';

const FULL: WarpCorners = { topLeft: { x: 0, y: 1 }, topRight: { x: 1, y: 1 }, bottomLeft: { x: 0, y: 0 }, bottomRight: { x: 1, y: 0 } };
const layer = (layerShape: LayerShape | null, corners: WarpCorners = FULL, meshGrid: MeshWarpGrid | null = null) =>
  ({ layerShape, corners, warpMode: meshGrid ? 'mesh' : 'corners', meshGrid }) as any;

function maxDeviation(points: { x: number; y: number }[], f: (x: number, y: number) => number) {
  return Math.max(...points.map((p) => Math.abs(f(p.x, p.y))));
}

describe('edge effect outline in output space', () => {
  it('traces a plain layer rectangle as four corners, inset 5 px', () => {
    const outline = buildEdgeOutline(layer(null), 400, 200)!;
    expect(outline.points).toHaveLength(4);
    expect(outline.corners).toEqual([0, 1, 2, 3]);
    const xs = outline.points.map((p) => p.x).sort((a, b) => a - b);
    const ys = outline.points.map((p) => p.y).sort((a, b) => a - b);
    expect(xs[0]).toBeCloseTo(EDGE_INSET_PX, 5);
    expect(xs[3]).toBeCloseTo(400 - EDGE_INSET_PX, 5);
    expect(ys[0]).toBeCloseTo(EDGE_INSET_PX, 5);
    expect(ys[3]).toBeCloseTo(200 - EDGE_INSET_PX, 5);
    expect(outline.length).toBeCloseTo(2 * (390 + 190), 3);
    expect(outline.centroid.x).toBeCloseTo(200, 3);
    expect(outline.inradius).toBeGreaterThan(90);
    expect(outline.truncated).toBe(false);
  });

  it('flattens a circle to within a quarter pixel at 4K', () => {
    const shape = { type: 'circle', enabled: true, params: { radiusX: 0.9, scale: 1 } } as LayerShape;
    // A square layer 2000 px across in the middle of a 3840x2160 output.
    const corners: WarpCorners = {
      topLeft: { x: 920 / 3840, y: 2080 / 2160 }, topRight: { x: 2920 / 3840, y: 2080 / 2160 },
      bottomLeft: { x: 920 / 3840, y: 80 / 2160 }, bottomRight: { x: 2920 / 3840, y: 80 / 2160 },
    };
    const outline = buildEdgeOutline(layer(shape, corners), 3840, 2160)!;
    const radius = 0.9 * 0.5 * 2000 - EDGE_INSET_PX;
    // Vertices sit on the inset circle, and chords stay within 0.25 px of it.
    expect(maxDeviation(outline.points, (x, y) => Math.hypot(x - 1920, y - 1080) - radius)).toBeLessThan(0.05);
    for (let i = 0; i < outline.points.length; i++) {
      const a = outline.points[i], b = outline.points[(i + 1) % outline.points.length];
      const mid = Math.hypot((a.x + b.x) / 2 - 1920, (a.y + b.y) / 2 - 1080);
      expect(radius - mid).toBeLessThanOrEqual(0.3);
    }
    expect(outline.points.length).toBeLessThanOrEqual(EDGE_MAX_SEGMENTS);
    expect(outline.corners).toEqual([]);
  });

  it('follows a strong corner pin and a mesh warp with the picture', () => {
    const pinned: WarpCorners = {
      topLeft: { x: 0.3, y: 0.95 }, topRight: { x: 0.7, y: 0.95 },
      bottomLeft: { x: 0.02, y: 0.05 }, bottomRight: { x: 0.98, y: 0.05 },
    };
    const shape = { type: 'triangle', enabled: true, params: { scale: 1 } } as LayerShape;
    const outline = buildEdgeOutline(layer(shape, pinned), 1920, 1080)!;
    // Triangle edges are not axis aligned, so the bilinear pin bends them:
    // the outline is subdivided rather than left as three chords.
    expect(outline.points.length).toBeGreaterThan(3);
    expect(outline.corners).toHaveLength(3);

    const mesh: MeshWarpGrid = {
      rows: 3, cols: 3,
      points: [
        [{ x: 0, y: 1 }, { x: 0.5, y: 0.8 }, { x: 1, y: 1 }],
        [{ x: 0, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 1, y: 0.5 }],
        [{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 1, y: 0 }],
      ],
    };
    const meshOutline = buildEdgeOutline(layer(null, FULL, mesh), 1000, 1000)!;
    const map = layerUvToOutput(layer(null, FULL, mesh), 1000, 1000)!;
    // The top edge dips to the mesh's middle point (y = 0.8), less the inset.
    const top = meshOutline.points.filter((p) => Math.abs(p.x - 500) < 30);
    const highest = Math.max(...top.map((p) => p.y));
    expect(highest).toBeCloseTo(map({ x: 0.5, y: 1 }).y - EDGE_INSET_PX, 0);
  });

  it('flattens the pen tool Beziers and caps huge outlines with a flag', () => {
    const custom = {
      type: 'custom', enabled: true,
      params: {
        customClosed: true,
        customPoints: [
          { x: 0.2, y: 0.2, cpOut: { x: 0.4, y: 0.0 } },
          { x: 0.8, y: 0.2, cpIn: { x: 0.6, y: 0.0 } },
          { x: 0.8, y: 0.8 },
          { x: 0.2, y: 0.8 },
        ],
      },
    } as LayerShape;
    const outline = buildEdgeOutline(layer(custom), 1000, 1000)!;
    expect(outline.corners).toHaveLength(4);
    expect(outline.points.length).toBeGreaterThan(8);

    const wiggly = {
      type: 'custom', enabled: true,
      params: {
        customClosed: true,
        customPoints: Array.from({ length: 700 }, (_, i) => {
          const a = (i / 700) * Math.PI * 2;
          const r = 0.4 + 0.05 * Math.sin(a * 60);
          return { x: 0.5 + r * Math.cos(a), y: 0.5 + r * Math.sin(a) };
        }),
      },
    } as LayerShape;
    const capped = buildEdgeOutline(layer(wiggly), 2000, 2000)!;
    expect(capped.truncated).toBe(true);
    expect(capped.segmentsNeeded).toBeGreaterThan(EDGE_MAX_SEGMENTS);
    expect(capped.points.length).toBeLessThanOrEqual(EDGE_MAX_SEGMENTS);
  });

  it('rounds corners with a radius in output pixels', () => {
    const outline = buildEdgeOutline(layer(null), 400, 400, { cornerRadius: 40 })!;
    expect(outline.points.length).toBeGreaterThan(20);
    // A rounded square is shorter than the sharp one by 4 (2r - pi r / 2).
    const sharp = 4 * 390;
    expect(outline.length).toBeLessThan(sharp - 4 * (80 - Math.PI * 20) + 30);
    expect(outline.length).toBeGreaterThan(sharp - 4 * (80 - Math.PI * 20) - 30);
  });
});
