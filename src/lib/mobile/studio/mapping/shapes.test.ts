import { describe, expect, it } from 'vitest';
import { defaultShow, movePoint, newSurface, normalizeShow, type Point, type Surface } from '../model';
import { surfaceVertices } from '../compositor';
import { cornerPoints, evaluate } from './meshGrid';
import { ellipsePath, flattenPath, insertPoint, insidePolygon, KAPPA, moveHandle, removePoint, segmentPoint, setPointSmooth, signedArea, strokeToPath } from './pathGeometry';
import { contentOutline, dropShape, fitFrame, insideSurface, isShape, mapSurface, presetPath, shapeFromPath, surfaceOutline, toShape, withShape } from './surfaceShape';
import { quadInverse } from './homography';
import { coverageSize, fillPolygon, insideDistance, rasterizeCoverage } from './coverage';
import { newEllipseMask, newPolygonMask, normalizeMasks } from './masks';

const close = (a: Point, b: Point, digits = 9) => {
  expect(a.x).toBeCloseTo(b.x, digits);
  expect(a.y).toBeCloseTo(b.y, digits);
};
const skewed = (): Surface => {
  let s = newSurface(0);
  s = movePoint(s, 0, { x: 0.12, y: 0.07 });
  s = movePoint(s, 2, { x: 0.93, y: 0.18 });
  s = movePoint(s, 8, { x: 0.81, y: 0.95 });
  return movePoint(s, 6, { x: 0.05, y: 0.77 });
};

describe('paths', () => {
  it('insert a point on a straight or curved edge without changing the outline', () => {
    const square = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
    const five = insertPoint(square, 0);
    expect(five).toHaveLength(5);
    expect(five[1]).toEqual({ x: 0.5, y: 0 });
    const circle = ellipsePath(0.5, 0.5, 0.3, 0.3, 4);
    const before = segmentPoint(circle, 1, 0.25);
    const split = insertPoint(circle, 1, 0.5);
    expect(split).toHaveLength(5);
    close(segmentPoint(split, 1, 0.5), before);
    close(split[2], segmentPoint(circle, 1, 0.5));
  });
  it('delete points down to a triangle and no further', () => {
    let p = presetPath('hexagon');
    while (p.length > 3) p = removePoint(p, 0);
    expect(removePoint(p, 0)).toHaveLength(3);
  });
  it('make a circle from four cubic quarters', () => {
    const c = ellipsePath(0, 0, 1, 1, 4);
    expect(Math.hypot(c[0].out!.x, c[0].out!.y)).toBeCloseTo(KAPPA, 6);
    for (let i = 0; i < 4; i++) for (const t of [0.25, 0.5, 0.75]) expect(Math.hypot(segmentPoint(c, i, t).x, segmentPoint(c, i, t).y)).toBeCloseTo(1, 3);
  });
  it('smooth a corner with handles along its neighbours, and sharpen it again', () => {
    const tri = presetPath('triangle');
    const smooth = setPointSmooth(tri, 0, true);
    expect(smooth[0].in && smooth[0].out).toBeTruthy();
    expect(smooth[0].in!.x).toBeCloseTo(-smooth[0].out!.x);
    expect(setPointSmooth(smooth, 0, false)[0]).toEqual({ x: tri[0].x, y: tri[0].y });
    const turned = moveHandle(smooth, 0, 'out', { x: 0, y: 0.2 });
    expect(turned[0].in!.y).toBeLessThan(0);
    expect(turned[0].in!.x).toBeCloseTo(0);
  });
  it('turn a wobbly finger stroke into a few smooth points', () => {
    const stroke = Array.from({ length: 200 }, (_, i) => {
      const a = (i / 200) * Math.PI * 2;
      return { x: 0.5 + Math.cos(a) * 0.2 + Math.sin(i * 1.7) * 0.002, y: 0.5 + Math.sin(a) * 0.3 + Math.cos(i * 2.3) * 0.002 };
    });
    const path = strokeToPath(stroke, 1000, 562);
    expect(path.length).toBeGreaterThanOrEqual(6);
    expect(path.length).toBeLessThanOrEqual(32);
    expect(path.every((p) => p.in && p.out)).toBe(true);
    for (const p of flattenPath(path, 8)) expect(Math.hypot((p.x - 0.5) / 0.2, (p.y - 0.5) / 0.3)).toBeGreaterThan(0.9);
  });
});

describe('free-form surfaces', () => {
  it('a quad turned into a shape keeps its picture exactly', () => {
    const quad = skewed();
    const shape = toShape(quad);
    expect(isShape(shape)).toBe(true);
    expect(shape.shape!.points).toHaveLength(4);
    expect(surfaceVertices(shape)).toEqual(surfaceVertices(quad));
    const fitted = withShape(shape, shape.shape!.points);
    expect(fitted.points).toEqual(shape.points);
  });
  it('a point pulled out of the frame stretches the frame along the same perspective', () => {
    const shape = toShape(skewed());
    const gable = insertPoint(shape.shape!.points, 0);
    const top = cornerPoints(shape);
    gable[1] = { x: (top[0].x + top[1].x) / 2, y: -0.1 };
    const next = withShape(shape, gable);
    const inv = quadInverse(cornerPoints(next))!;
    for (const p of flattenPath(gable)) {
      const uv = inv(p)!;
      expect(uv.x).toBeGreaterThanOrEqual(-1e-9);
      expect(uv.x).toBeLessThanOrEqual(1 + 1e-9);
      expect(uv.y).toBeGreaterThanOrEqual(-1e-9);
      expect(uv.y).toBeLessThanOrEqual(1 + 1e-9);
    }
    // The bottom corners did not move, and the picture's bottom edge is where it was.
    close(cornerPoints(next)[2], cornerPoints(shape)[2]);
    close(cornerPoints(next)[3], cornerPoints(shape)[3]);
  });
  it('maps the outline into the picture space for cutting it out', () => {
    const shape = toShape(skewed());
    const outline = contentOutline(shape)!;
    [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }].forEach((c, i) => close(outline[i], c));
  });
  it('a drawn or preset outline gets a frame that encloses it', () => {
    const circle = shapeFromPath(newSurface(0), presetPath('circle', { x: 0.4, y: 0.5 }, 0.6));
    const corners = cornerPoints(circle);
    for (const p of surfaceOutline(circle)) {
      expect(p.x).toBeGreaterThanOrEqual(corners[0].x - 1e-9);
      expect(p.x).toBeLessThanOrEqual(corners[1].x + 1e-9);
    }
    expect(insideSurface(circle, { x: 0.4, y: 0.5 })).toBe(true);
    expect(insideSurface(circle, { x: corners[0].x + 0.001, y: corners[0].y + 0.001 })).toBe(false);
    // Round on a 16:9 output: equal size in pixels across and down.
    const xs = surfaceOutline(circle).map((p) => p.x * 1920),
      ys = surfaceOutline(circle).map((p) => p.y * 1080);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(Math.max(...ys) - Math.min(...ys), -1);
  });
  it('moves, scales and turns the outline, frame and handles together', () => {
    const s = shapeFromPath(newSurface(0), presetPath('circle'));
    const moved = mapSurface(s, (p) => ({ x: p.x + 0.1, y: p.y - 0.05 }));
    close(moved.shape!.points[0], { x: s.shape!.points[0].x + 0.1, y: s.shape!.points[0].y - 0.05 });
    close(moved.shape!.points[0].out!, s.shape!.points[0].out!);
  });
  it('drops back to a quad on its frame', () => {
    const s = dropShape(toShape(skewed()));
    expect('shape' in s).toBe(false);
    expect(s.mode).toBe('corners');
  });
  it('a mesh becomes a shape that follows its border, curves included', () => {
    const mesh: Surface = { ...skewed(), mode: 'mesh' };
    const shape = toShape(mesh);
    expect(shape.shape!.points).toHaveLength(8);
    close(shape.shape!.points[1], mesh.points[1]);
  });
  it('saves and loads, and old builds without shapes still read the frame', () => {
    const show = defaultShow();
    show.mapping = true;
    const s = shapeFromPath(newSurface(0), presetPath('hexagon'));
    show.surfaces = [s];
    const loaded = normalizeShow(JSON.parse(JSON.stringify(show))).surfaces[0];
    expect(loaded.shape).toEqual(s.shape);
    expect(loaded.points).toEqual(s.points);
    // A mesh never carries an outline.
    show.surfaces = [{ ...s, mode: 'mesh' }];
    expect(normalizeShow(JSON.parse(JSON.stringify(show))).surfaces[0].shape).toBeUndefined();
  });
  it('fits a frame even when the old one is degenerate', () => {
    const flat = [{ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }];
    const frame = fitFrame(flat, [{ x: 0.1, y: 0.2 }, { x: 0.6, y: 0.25 }, { x: 0.3, y: 0.7 }]);
    expect(frame[0]).toEqual({ x: 0.1, y: 0.2 });
    expect(frame[2]).toEqual({ x: 0.6, y: 0.7 });
  });
  it('content inside the frame is still where the warp puts it', () => {
    const shape = toShape(skewed());
    close(evaluate(shape, 0.3, 0.6), evaluate(skewed(), 0.3, 0.6));
  });
});

describe('coverage', () => {
  it('fills a polygon with anti-aliased edges and exact area', () => {
    const out = new Float32Array(20 * 20);
    fillPolygon([{ x: 2.5, y: 2 }, { x: 12.5, y: 2 }, { x: 12.5, y: 12 }, { x: 2.5, y: 12 }], 20, 20, out);
    const area = out.reduce((a, b) => a + b, 0);
    expect(area).toBeCloseTo(100, 4);
    expect(out[5 * 20 + 2]).toBeCloseTo(0.5, 5);
    expect(out[5 * 20 + 5]).toBeCloseTo(1, 5);
    expect(out[15 * 20 + 5]).toBe(0);
  });
  it('fills curved, concave and self-crossing outlines (non-zero)', () => {
    const out = new Float32Array(64 * 64);
    const star = Array.from({ length: 10 }, (_, i) => {
      const r = i % 2 ? 12 : 28,
        a = (i / 10) * Math.PI * 2;
      return { x: 32 + Math.cos(a) * r, y: 32 + Math.sin(a) * r };
    });
    fillPolygon(star, 64, 64, out);
    const area = out.reduce((a, b) => a + b, 0);
    expect(area).toBeCloseTo(Math.abs(signedArea(star)), 0);
    expect(insidePolygon(star, { x: 32, y: 32 })).toBe(true);
  });
  it('measures distance inward, ignoring the texture border', () => {
    const inside = new Uint8Array(10 * 10).fill(1);
    inside[0] = 0;
    const d = insideDistance(inside, 10, 10);
    expect(d[0]).toBe(0);
    expect(d[1]).toBe(1);
    expect(d[99]).toBeCloseTo(Math.hypot(9, 9), 5);
  });
  it('combines masks: adds reveal, subtracts cut, invert flips, feather ramps inward', () => {
    const W = 80,
      H = 40;
    const at = (c: Uint8Array, u: number, v: number) => c[Math.floor(v * H) * W + Math.floor(u * W)];
    const left = newPolygonMask([{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 0.5, y: 1 }, { x: 0, y: 1 }]);
    const hole = { ...newEllipseMask(2), op: 'subtract' as const, ellipse: { cx: 0.25, cy: 0.5, rx: 0.1, ry: 0.2 } };
    const c = rasterizeCoverage({ masks: [left, hole] }, W, H)!;
    expect(at(c, 0.05, 0.1)).toBe(255);
    expect(at(c, 0.75, 0.5)).toBe(0);
    expect(at(c, 0.25, 0.5)).toBe(0);
    const inverted = rasterizeCoverage({ masks: [{ ...left, invert: true }] }, W, H)!;
    expect(at(inverted, 0.05, 0.1)).toBe(0);
    expect(at(inverted, 0.75, 0.5)).toBe(255);
    const soft = rasterizeCoverage({ masks: [{ ...left, feather: 0.25 }] }, W, H)!;
    expect(at(soft, 0.49, 0.5)).toBeLessThan(64);
    expect(at(soft, 0.45, 0.5)).toBeGreaterThan(at(soft, 0.49, 0.5));
    expect(at(soft, 0.02, 0.5)).toBe(255);
    // Only cutting masks: the rest of the surface stays.
    const onlyHole = rasterizeCoverage({ masks: [hole] }, W, H)!;
    expect(at(onlyHole, 0.75, 0.5)).toBe(255);
    expect(rasterizeCoverage({ masks: [{ ...left, enabled: false }] }, W, H)).toBeNull();
  });
  it('cuts to a free-form outline and multiplies masks inside it', () => {
    const shape = shapeFromPath(newSurface(0), presetPath('circle', { x: 0.5, y: 0.5 }, 0.8));
    const outline = contentOutline(shape)!;
    const c = rasterizeCoverage({ outline }, 64, 64)!;
    expect(c[32 * 64 + 32]).toBe(255);
    expect(c[1 * 64 + 1]).toBe(0);
  });
  it('sizes textures to the surface, capped, width a multiple of four', () => {
    expect(coverageSize(1920, 1080)).toEqual({ width: 1536, height: 864 });
    expect(coverageSize(301, 100).width % 4).toBe(0);
    expect(coverageSize(0, 0)).toEqual({ width: 16, height: 16 });
  });
  it('drops malformed masks on load and keeps good ones', () => {
    const good = newPolygonMask([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }]);
    const masks = normalizeMasks([good, { kind: 'polygon', points: [{ x: 0, y: 0 }] }, { kind: 'image', image: { src: 'http://x' } }, null, { kind: 'nope' }]);
    expect(masks).toHaveLength(1);
    expect(masks[0]).toEqual(good);
  });
});

describe('edge field for Looks', () => {
  it('measures inward distance to a free-form outline and position along it', async () => {
    const { edgeField, FIELD_MAX_PX } = await import('./coverage');
    const W = 64,
      H = 64;
    const circle = Array.from({ length: 64 }, (_, i) => ({ x: 32 + Math.cos((i / 64) * Math.PI * 2) * 24, y: 32 + Math.sin((i / 64) * Math.PI * 2) * 24 }));
    const cov = new Float32Array(W * H);
    fillPolygon(circle, W, H, cov);
    const c8 = Uint8Array.from(cov, (v) => Math.round(Math.min(1, v) * 255));
    const { data, perimeter } = edgeField(c8, W, H, 2, circle);
    expect(perimeter).toBeCloseTo(2 * Math.PI * 24 * 2, -1);
    const dist = (x: number, y: number) => (data[(y * W + x) * 4 + 1] / 255) ** 2 * FIELD_MAX_PX;
    const along = (x: number, y: number) => (data[(y * W + x) * 4 + 2] * 256 + data[(y * W + x) * 4 + 3]) / 65535;
    // Centre: 24 texels from the edge, 2 output pixels each.
    expect(dist(32, 32)).toBeGreaterThan(44);
    expect(dist(32, 32)).toBeLessThan(52);
    expect(dist(32 + 22, 32)).toBeLessThan(6);
    // Right of centre is the start of the outline, below it a quarter of the way round.
    expect(along(54, 32)).toBeLessThan(0.05);
    expect(along(32, 54)).toBeCloseTo(0.25, 1);
    // Outside the outline nothing shows.
    expect(data[(1 * W + 1) * 4]).toBe(0);
  });
  it('treats the frame border as an edge when masks leave it visible', async () => {
    const { edgeField } = await import('./coverage');
    const cov = new Uint8Array(32 * 32).fill(255);
    const { data } = edgeField(cov, 32, 32, 1, null);
    const d = (x: number, y: number) => (data[(y * 32 + x) * 4 + 1] / 255) ** 2 * 256;
    expect(d(0, 16)).toBeLessThan(2);
    expect(d(16, 16)).toBeGreaterThan(14);
  });
});
