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
 * The Screen shaders sample each projector pixel through the screen's crop or warp
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
    // Off the mesh the inverse continues the border cell (see the
    // extrapolation tests below); the inside-only form still says null.
    close(canvasToScreenContent(mesh, { x: 1.5, y: 0.5 })!, { x: 1.5, y: 0.5 });
    expect(canvasToScreenContent(mesh, { x: 1.5, y: 0.5 }, { extrapolate: false })).toBeNull();
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

// The Bezier sweeps run thousands of Newton solves; slower machines need room.
describe('screen mask inverse past the screen', { timeout: 30000 }, () => {
  // Forward then inverse has to land back on the canvas point, off the
  // surface as well as on it: that is what keeps a mask handle under the
  // cursor while it is dragged outside a Mesh screen.
  const roundTrip = (s: Parameters<typeof canvasToScreenContent>[0], q: { x: number; y: number }) => {
    const content = canvasToScreenContent(s, q);
    expect(content, `inverse of (${q.x}, ${q.y})`).not.toBeNull();
    const back = screenContentToCanvas(s, content!);
    expect(Math.hypot(back.x - q.x, back.y - q.y), `round trip of (${q.x}, ${q.y})`).toBeLessThan(1e-7);
    return content!;
  };
  const ring = (x0: number, y0: number, x1: number, y1: number, pad: number, n = 12) => {
    const out: Array<{ x: number; y: number }> = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      out.push({ x: x0 - pad + (x1 - x0 + 2 * pad) * t, y: y0 - pad });
      out.push({ x: x0 - pad + (x1 - x0 + 2 * pad) * t, y: y1 + pad });
      out.push({ x: x0 - pad, y: y0 - pad + (y1 - y0 + 2 * pad) * t });
      out.push({ x: x1 + pad, y: y0 - pad + (y1 - y0 + 2 * pad) * t });
    }
    return out;
  };

  const grid = (rows: number, cols: number, move: (x: number, y: number, r: number, c: number) => { x: number; y: number }) =>
    Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => move(0.2 + 0.6 * c / (cols - 1), 0.2 + 0.6 * r / (rows - 1), r, c)));
  const warped = grid(4, 5, (x, y, r, c) => ({ x: x + 0.03 * Math.sin(r * 1.7 + c), y: y + 0.025 * Math.cos(c * 1.3 + r) }));
  const straight = { cropX: 0, cropY: 0, cropW: 1, cropH: 1, warpMode: 'mesh' as const, meshGrid: { rows: 4, cols: 5, points: warped } };

  it('continues a straight mesh past every side and corner', () => {
    for (const pad of [0.01, 0.05, 0.12]) {
      for (const q of ring(0.2, 0.2, 0.8, 0.8, pad)) {
        const content = roundTrip(straight, q);
        // Clear of the (wobbly) border, off the surface means off 0..1 in
        // content space too.
        if (pad >= 0.05) expect(content.x < 0 || content.x > 1 || content.y < 0 || content.y > 1).toBe(true);
      }
    }
  });

  it('continues a Bezier mesh past its curved border with a Newton solve', () => {
    const tangents = warped.map((row, r) => row.map((_, c) => (r === 0 && c === 2 ? { right: { x: 0.1, y: -0.08 } }
      : r === 3 && c === 1 ? { right: { x: 0.08, y: 0.06 } }
        : c === 0 && r === 1 ? { down: { x: -0.07, y: 0.08 } }
          : c === 4 && r === 2 ? { up: { x: 0.06, y: -0.07 } } : null)));
    const curved = { ...straight, meshGrid: { ...straight.meshGrid, bezier: true, tangents } };
    // The curve really leaves the straight border, so these points exercise
    // Newton rather than the bilinear guess.
    expect(screenContentToCanvas(curved, { x: 0.6, y: 0 }).y).toBeLessThan(0.17);
    for (const pad of [0.02, 0.06, 0.1]) {
      for (const q of ring(0.2, 0.2, 0.8, 0.8, pad)) roundTrip(curved, q);
    }
    // Inside it is still the plain cell inverse.
    close(canvasToScreenContent(curved, screenContentToCanvas(curved, { x: 0.4, y: 0.6 }))!, { x: 0.4, y: 0.6 });
  });

  it('moves smoothly across the screen border', () => {
    const tangents = warped.map((row, r) => row.map((_, c) => (r === 0 && c === 2 ? { right: { x: 0.12, y: -0.1 } } : null)));
    const curved = { ...straight, meshGrid: { ...straight.meshGrid, bezier: true, tangents } };
    for (const s of [straight, curved]) {
      // A drag straight up out of the top edge, and one out past a corner.
      for (const [from, to] of [[{ x: 0.53, y: 0.4 }, { x: 0.53, y: 0.02 }], [{ x: 0.6, y: 0.6 }, { x: 0.9, y: 0.91 }]]) {
        let prev = roundTrip(s, from);
        const steps: number[] = [];
        for (let i = 1; i <= 200; i++) {
          const t = i / 200;
          const q = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
          const next = roundTrip(s, q);
          steps.push(Math.hypot(next.x - prev.x, next.y - prev.y));
          prev = next;
        }
        // Equal cursor steps move the content by similar amounts: no jump
        // where the inside solve hands over to the continued border cell.
        const sorted = [...steps].sort((a, b) => a - b);
        const median = sorted[sorted.length >> 1];
        expect(Math.max(...steps) / median).toBeLessThan(3);
      }
    }
  });

  it('stops at a fold of the continued border instead of jumping across the screen', () => {
    // This corner cell's right and bottom edges converge outward, so its
    // continued sheet folds over about 0.15 past the corner. Up to the fold
    // the inverse round-trips; past it there is no position that does, and
    // the far branch of the solve must not be taken.
    let last: { x: number; y: number } | null = null;
    let sawNull = false;
    for (let i = 0; i <= 200; i++) {
      const t = i / 200;
      const q = { x: 0.6 + 0.35 * t, y: 0.6 + 0.37 * t };
      const content = canvasToScreenContent(straight, q);
      if (!content) { sawNull = true; continue; }
      expect(sawNull, 'no solution comes back once past the fold').toBe(false);
      const back = screenContentToCanvas(straight, content);
      expect(Math.hypot(back.x - q.x, back.y - q.y)).toBeLessThan(1e-7);
      if (last) expect(Math.hypot(content.x - last.x, content.y - last.y)).toBeLessThan(0.1);
      last = content;
    }
    expect(sawNull).toBe(true);
  });
});

describe('screen mask shader packing', () => {
  it('packs each mask at its own row of flattened vertices', async () => {
    const { packScreenMasks, SCREEN_MASK_FLAT_POINTS: FLAT } = await import('./screenMaskGeometry');
    const keep = { id: 'a', name: 'A', enabled: true, feather: 0.1, invert: false,
      points: [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.5, y: 0.9 }] };
    const hole = { id: 'b', name: 'B', enabled: true, feather: 0, invert: true,
      points: [{ x: 0.4, y: 0.4 }, { x: 0.6, y: 0.4 }, { x: 0.6, y: 0.6 }, { x: 0.4, y: 0.6 }] };
    const off = { ...keep, id: 'c', enabled: false };
    const masks = [keep, off, hole];
    const packed = packScreenMasks(masks);
    expect(packed.count).toBe(2);
    expect(packed.keepCount).toBe(1);
    expect(Array.from(packed.info.slice(0, 8))).toEqual([0, 3, Math.fround(0.1), 0, FLAT, 4, 0, 1]);
    expect(packed.points[FLAT * 2]).toBeCloseTo(0.4);
    expect(packed.points[FLAT * 2 + 5]).toBeCloseTo(0.6);
    expect(packed.bounds[0]).toBeCloseTo(0.1 - 1e-3);
    // Packing is cached per mask list, so a render loop can call it freely.
    expect(packScreenMasks(masks)).toBe(packed);
    expect(packScreenMasks([]).count).toBe(0);
  });
});
