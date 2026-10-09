import { describe, expect, it } from 'vitest';
import { traceShapes } from './vectorize';

type Rgb = [number, number, number];
function picture(width: number, height: number, colorAt: (x: number, y: number) => Rgb): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const [r, g, b] = colorAt(x, y), o = (y * width + x) * 4;
    data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = 255;
  }
  return data;
}
const area = (points: { x: number; y: number }[]) => {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) { const a = points[i], b = points[(i + 1) % points.length]; sum += a.x * b.y - b.x * a.y; }
  return Math.abs(sum / 2);
};
// A quilt of flat colour blocks with a faint texture, like areas of paint.
const quilt = (cells: number) => (x: number, y: number): Rgb => {
  const cx = Math.floor((x / 400) * cells), cy = Math.floor((y / 300) * cells);
  const seed = (cx * 73 + cy * 151) % 255, grain = ((x * 7 + y * 13) % 5) - 2;
  return [(seed * 3) % 256 + grain, (seed * 7 + 60) % 256 + grain, (seed * 11 + 120) % 256 + grain].map(v => Math.max(0, Math.min(255, v))) as Rgb;
};

describe('traceShapes', () => {
  it('finds the four quarters of a four-colour picture as four-cornered shapes', () => {
    const data = picture(400, 300, (x, y) => (x < 200 ? (y < 150 ? [220, 40, 40] : [40, 60, 200]) : (y < 150 ? [240, 210, 40] : [30, 160, 90])));
    const shapes = traceShapes(data, 400, 300, { detail: 0.5 });
    expect(shapes).toHaveLength(4);
    for (const shape of shapes) {
      expect(shape.points).toHaveLength(4);
      expect(shape.area).toBeCloseTo(0.25, 1);
      expect(area(shape.points)).toBeCloseTo(0.25, 1);
    }
    // Each shape carries the colour of its patch.
    expect(shapes.some(s => Math.abs(s.color[0] - 220) < 4 && Math.abs(s.color[1] - 40) < 4 && Math.abs(s.color[2] - 40) < 4)).toBe(true);
  });

  it('gives more shapes as detail rises', () => {
    const data = picture(400, 300, quilt(12));
    const low = traceShapes(data, 400, 300, { detail: 0.05 }).length;
    const mid = traceShapes(data, 400, 300, { detail: 0.5 }).length;
    const high = traceShapes(data, 400, 300, { detail: 1 }).length;
    expect(low).toBeLessThan(mid);
    expect(mid).toBeLessThanOrEqual(high);
    expect(low).toBeLessThan(40);
    expect(high).toBeGreaterThan(100);
  });

  it('tiles the picture: shapes cover it once, with shared borders', () => {
    const data = picture(400, 300, quilt(7));
    const shapes = traceShapes(data, 400, 300, { detail: 0.8 });
    expect(shapes.length).toBeGreaterThan(20);
    // Every stretch of border inside the picture belongs to exactly two shapes, point for point.
    const seen = new Map<string, number>();
    const name = (p: { x: number; y: number }) => `${p.x.toFixed(5)},${p.y.toFixed(5)}`;
    for (const shape of shapes) for (let i = 0; i < shape.points.length; i += 1) {
      const a = shape.points[i], b = shape.points[(i + 1) % shape.points.length];
      const onEdge = (a.x === b.x && (a.x === 0 || a.x === 1)) || (a.y === b.y && (a.y === 0 || a.y === 1));
      if (onEdge) continue;
      const key = [name(a), name(b)].sort().join(' ');
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    const counts = [...seen.values()];
    expect(Math.max(...counts)).toBeLessThanOrEqual(2);
    expect(counts.filter(c => c === 2).length / counts.length).toBeGreaterThan(0.95);
    for (const shape of shapes) for (const p of shape.points) {
      expect(p.x).toBeGreaterThanOrEqual(0); expect(p.x).toBeLessThanOrEqual(1);
      expect(p.y).toBeGreaterThanOrEqual(0); expect(p.y).toBeLessThanOrEqual(1);
    }
  });

  it('keeps to the limit on the number of shapes', () => {
    const data = picture(400, 300, quilt(20));
    expect(traceShapes(data, 400, 300, { detail: 1, maxShapes: 50 }).length).toBeLessThanOrEqual(50);
  });

  it('follows a round shape closely with few points', () => {
    const data = picture(300, 300, (x, y) => (Math.hypot(x - 150, y - 150) < 90 ? [250, 215, 40] : [20, 30, 60]));
    const shapes = traceShapes(data, 300, 300, { detail: 0.6 });
    expect(shapes).toHaveLength(2);
    const disc = shapes[1];
    expect(disc.points.length).toBeGreaterThan(8);
    expect(disc.points.length).toBeLessThan(90);
    expect(area(disc.points)).toBeCloseTo(Math.PI * 0.3 * 0.3, 1);
  });

  it('traces a large photo in well under a second', () => {
    const data = picture(1600, 1200, (x, y) => quilt(16)(x / 4, y / 4));
    const started = performance.now();
    traceShapes(data, 1600, 1200, { detail: 1 });
    expect(performance.now() - started).toBeLessThan(900);
  });
});

import { onComposition, shapesToSvg } from './paintingShapes';

describe('shapes on the painting', () => {
  const corners = { topLeft: { x: 0.2, y: 0.9 }, topRight: { x: 0.8, y: 0.8 }, bottomRight: { x: 0.7, y: 0.1 }, bottomLeft: { x: 0.3, y: 0.2 } };
  it('puts the photo corners on the layer corners', () => {
    expect(onComposition(corners, 0, 0)).toEqual(corners.topLeft);
    expect(onComposition(corners, 1, 0)).toEqual(corners.topRight);
    expect(onComposition(corners, 1, 1)).toEqual(corners.bottomRight);
    expect(onComposition(corners, 0, 1)).toEqual(corners.bottomLeft);
  });
  it('writes one polygon per shape in composition pixels, y down', () => {
    const svg = shapesToSvg([{ points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }], color: [0, 0, 0], area: 0.5 }], corners, 1000, 500);
    expect(svg).toContain('viewBox="0 0 1000 500"');
    expect(svg).toContain('points="200.00,50.00 800.00,100.00 700.00,450.00"');
    expect(svg.match(/<polygon/g)).toHaveLength(1);
  });
});
