/**
 * Layer shape outlines trace the shape the mask draws: every corner and
 * every edge midpoint of layerShapeCorners lies on the mask's boundary, for
 * triangles, polygons and stars at any rotation and scale. The distance
 * functions below are the shape mask's (shaders/basic.ts and the inline
 * layer mask), line for line.
 */
import { describe, expect, it } from 'vitest';
import { createDefaultLayerShape, getShapeVertices, layerShapeCorners, LAYER_TRIANGLE_POINTS, type LayerShape } from '../types';

type V = { x: number; y: number };
const sub = (a: V, b: V): V => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a: V, b: V) => a.x * b.x + a.y * b.y;
const len = (a: V) => Math.hypot(a.x, a.y);
const glslMod = (x: number, y: number) => x - y * Math.floor(x / y);

function rotate(p: V, angle: number): V {
  const c = Math.cos(angle), s = Math.sin(angle);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

function sdSegment(p: V, a: V, b: V): number {
  const pa = sub(p, a), ba = sub(b, a);
  const h = Math.max(0, Math.min(1, dot(pa, ba) / dot(ba, ba)));
  return len({ x: pa.x - ba.x * h, y: pa.y - ba.y * h });
}

function sdTriangle(p: V, a: V, b: V, c: V): number {
  const d = Math.min(sdSegment(p, a, b), sdSegment(p, b, c), sdSegment(p, c, a));
  const s1 = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  const s2 = (c.x - b.x) * (p.y - b.y) - (c.y - b.y) * (p.x - b.x);
  const s3 = (a.x - c.x) * (p.y - c.y) - (a.y - c.y) * (p.x - c.x);
  const inside = (s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0);
  return inside ? -d : d;
}

function sdPolygon(p: V, r: number, n: number): number {
  const an = Math.PI / n;
  const a = Math.atan2(p.y, p.x);
  const bn = glslMod(a, 2 * an) - an;
  return len(p) * Math.cos(bn) - r;
}

function sdStar(p: V, r: number, ri: number, n: number): number {
  const an = Math.PI / n;
  const a = Math.atan2(p.x, p.y);
  const bn = Math.abs(glslMod(a + an, 2 * an) - an);
  const q = { x: len(p) * Math.sin(bn), y: len(p) * Math.cos(bn) };
  const tip = { x: 0, y: r };
  const e = sub({ x: ri * Math.sin(an), y: ri * Math.cos(an) }, tip);
  const w = sub(q, tip);
  const h = Math.max(0, Math.min(1, dot(w, e) / dot(e, e)));
  const d = len({ x: w.x - e.x * h, y: w.y - e.y * h });
  return d * (e.x * w.y - e.y * w.x < 0 ? -1 : 1);
}

/** The mask's signed distance at layer UV `uv` (negative inside). */
function maskDistance(shape: LayerShape, uv: V): number {
  const rotation = ((shape.params.rotation ?? 0) * Math.PI) / 180;
  const scale = shape.params.scale ?? 1;
  const p = rotate({ x: (uv.x - 0.5) / scale, y: (uv.y - 0.5) / scale }, -rotation);
  switch (shape.type) {
    case 'triangle': {
      const [a, b, c] = LAYER_TRIANGLE_POINTS;
      return sdTriangle({ x: p.x + 0.5, y: p.y + 0.5 }, a, b, c) * scale;
    }
    case 'polygon': return sdPolygon(p, 0.4, Math.round(shape.params.sides ?? 6)) * scale;
    case 'star': return sdStar(p, 0.4, (shape.params.innerRadius ?? 0.4) * 0.4, Math.round(shape.params.sides ?? 5)) * scale;
    default: throw new Error(shape.type);
  }
}

function shape(type: LayerShape['type'], params: Partial<LayerShape['params']> = {}): LayerShape {
  const base = createDefaultLayerShape();
  return { ...base, type, enabled: true, params: { ...base.params, ...params }, controlPoints: undefined };
}

describe('layer shape outlines follow their masks', () => {
  const cases: LayerShape[] = [
    shape('triangle'),
    shape('triangle', { rotation: 37, scale: 0.8 }),
    ...[3, 4, 5, 6, 8].map((sides) => shape('polygon', { sides })),
    shape('polygon', { sides: 5, rotation: 20, scale: 1.2 }),
    ...[3, 5, 7].map((sides) => shape('star', { sides })),
    shape('star', { sides: 5, innerRadius: 0.6, rotation: -45, scale: 0.7 }),
  ];

  for (const s of cases) {
    it(`${s.type} ${JSON.stringify({ sides: s.params.sides, rotation: s.params.rotation, scale: s.params.scale })}`, () => {
      const corners = layerShapeCorners(s)!;
      expect(corners.length).toBeGreaterThanOrEqual(3);
      corners.forEach((c, i) => {
        const next = corners[(i + 1) % corners.length];
        const mid = { x: (c.x + next.x) / 2, y: (c.y + next.y) / 2 };
        expect(Math.abs(maskDistance(s, c)), `corner ${i}`).toBeLessThan(1e-6);
        expect(Math.abs(maskDistance(s, mid)), `edge ${i}`).toBeLessThan(1e-6);
      });
      // Edge effects use the same corners.
      expect(getShapeVertices(s)).toEqual(corners);
    });
  }

  it('the default triangle points up, like its warp handles', () => {
    const tri = shape('triangle');
    const corners = layerShapeCorners(tri)!;
    expect(corners.map((p) => ({ x: +p.x.toFixed(6), y: +p.y.toFixed(6) }))).toEqual(createDefaultLayerShape('triangle').controlPoints);
  });

  it('a star mask is inside at its centre and points up', () => {
    const star = shape('star', { sides: 5 });
    expect(maskDistance(star, { x: 0.5, y: 0.5 })).toBeLessThan(0);
    expect(maskDistance(star, { x: 0.5, y: 0.89 })).toBeLessThan(0);
    expect(maskDistance(star, { x: 0.5, y: 0.11 })).toBeGreaterThan(0);
  });
});
