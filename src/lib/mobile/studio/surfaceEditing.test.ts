import { describe, it, expect } from 'vitest';
import { translatePoints, transformPoints, makeSurface } from './surfaceEditing';
import { defaultInteractive, validateScene, InteractiveWorld, INTERACTIVE_PRESETS } from './interactive';
describe('interactive surface editing', () => {
  it('keeps an entire translated shape reachable without distorting it', () => {
    const p = makeSurface('box', 0).points;
    const moved = translatePoints(p, 3, -3);
    expect(Math.max(...moved.map((v) => v.x))).toBe(1);
    expect(Math.min(...moved.map((v) => v.y))).toBe(0);
    expect(moved[1].x - moved[0].x).toBeCloseTo(p[1].x - p[0].x);
  });
  it('rejects transforms that would strand handles outside the editor', () => {
    const p = makeSurface('box', 0).points;
    expect(transformPoints(p, 10)).toEqual(p);
    expect(transformPoints(p, 0.8)).not.toEqual(p);
  });
  it('round trips all movements and rejects corrupt geometry', () => {
    for (const preset of INTERACTIVE_PRESETS)
      expect(validateScene({ ...defaultInteractive(), preset }).preset).toBe(preset);
    const bad = defaultInteractive();
    bad.surfaces[0].points[0].x = Infinity;
    expect(() => validateScene(bad)).toThrow();
  });
  it('preserves authored material and depth and rejects non-finite controls', () => {
    const scene = defaultInteractive();
    scene.surfaces[0].material = 'fire';
    scene.surfaces[0].height = 0.4;
    const saved = validateScene(scene);
    expect(saved.surfaces[0].material).toBe('fire');
    expect(saved.surfaces[0].height).toBe(0.4);
    expect(() => validateScene({ ...saved, matter: { ...saved.matter, lightHeight: Infinity } })).toThrow();
    expect(() => validateScene({ ...saved, surfaces: [{ ...saved.surfaces[0], material: 'bogus' }] })).toThrow();
  });
  it('attract and repel send particles in opposite directions', () => {
    function run(mode: 'attract' | 'repel') {
      const w = new InteractiveWorld();
      w.particles = [{ x: 0.4, y: 0.5, vx: 0, vy: 0, life: 5, seed: 0.5 }];
      w.update({ ...defaultInteractive(), surfaces: [], gravity: 0 }, 0.01, [
        { id: 'finger', point: { x: 0.6, y: 0.5 }, strength: 1, mode },
      ]);
      return w.particles[0].vx;
    }
    expect(run('attract')).toBeGreaterThan(0);
    expect(run('repel')).toBeLessThan(0);
  });
});

// Real mobile corner mappings use a 3×3 grid, unlike desktop four-corner slices.
import { importCornerSurfaces } from './surfaceEditing';
it('imports mobile nine-point corner boundaries without center points or source mutation', () => {
  const points = Array.from({ length: 9 }, (_, i) => ({ x: (i % 3) / 2, y: Math.floor(i / 3) / 2 }));
  const result = importCornerSurfaces([{ name: 'Backdrop', enabled: true, mode: 'corners', points }]);
  expect(result[0].points).toEqual([points[0], points[2], points[8], points[6]]);
  result[0].points[0].x = 0.2;
  expect(points[0].x).toBe(0);
});
it('keeps four-corner desktop mappings and omits disabled/mesh surfaces', () => {
  const points = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ];
  expect(
    importCornerSurfaces([
      { name: 'Good', enabled: true, mode: 'corners', points },
      { name: 'Off', enabled: false, mode: 'corners', points },
      { name: 'Mesh', enabled: true, mode: 'mesh', points },
    ]).map((s) => s.name),
  ).toEqual(['Good']);
});

import {
  centroid,
  hitTestSurfaces,
  hitTestVertex,
  spawnPoint,
  MOUSE_TOLERANCE,
  TOUCH_TOLERANCE,
} from './surfaceEditing';
import type { InteractiveSurface, Point } from './interactive';

const rect = (id: string, x: number, y: number, w: number, h: number): InteractiveSurface => ({
  id,
  name: id,
  behavior: 'solid',
  points: [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ],
});

describe('rotate and scale on a non-square canvas', () => {
  // Work out the shape in pixels: that is what the audience sees.
  const pixels = (points: Point[], width: number, height: number) =>
    points.map((p) => ({ x: p.x * width, y: p.y * height }));
  const edge = (a: Point, b: Point) => ({ x: b.x - a.x, y: b.y - a.y });
  const length = (v: Point) => Math.hypot(v.x, v.y);
  const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;

  for (const [label, width, height] of [
    ['16:9', 1920, 1080],
    ['9:16', 1080, 1920],
  ] as const) {
    const aspect = width / height;
    const box = rect('box', 0.4, 0.4, 0.2, 0.1).points;

    it(`keeps a rectangle a rectangle when rotated (${label})`, () => {
      const before = pixels(box, width, height);
      const after = pixels(transformPoints(box, 1, Math.PI / 12, aspect), width, height);
      expect(after).not.toEqual(before);
      for (let i = 0; i < 4; i++) {
        const a = edge(after[i], after[(i + 1) % 4]);
        const b = edge(after[(i + 1) % 4], after[(i + 2) % 4]);
        expect(dot(a, b)).toBeCloseTo(0, 6);
        expect(length(a)).toBeCloseTo(length(edge(before[i], before[(i + 1) % 4])), 6);
      }
    });

    it(`swaps width and height in pixels after a quarter turn (${label})`, () => {
      const before = pixels(box, width, height);
      const after = pixels(transformPoints(box, 1, Math.PI / 2, aspect), width, height);
      const size = (pts: Point[]) => [
        Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x)),
        Math.max(...pts.map((p) => p.y)) - Math.min(...pts.map((p) => p.y)),
      ];
      expect(size(after)[0]).toBeCloseTo(size(before)[1], 6);
      expect(size(after)[1]).toBeCloseTo(size(before)[0], 6);
    });

    it(`scales evenly about the centre (${label})`, () => {
      const scaled = transformPoints(box, 1.5, 0, aspect);
      expect(centroid(scaled).x).toBeCloseTo(centroid(box).x);
      expect(centroid(scaled).y).toBeCloseTo(centroid(box).y);
      expect(scaled[1].x - scaled[0].x).toBeCloseTo(0.3);
      expect(scaled[2].y - scaled[1].y).toBeCloseTo(0.15);
    });

    it(`makes a round circle and a box with square corners (${label})`, () => {
      const circle = pixels(makeSurface('circle', 0, aspect).points, width, height);
      const c = centroid(circle);
      const radii = circle.map((p) => Math.hypot(p.x - c.x, p.y - c.y));
      expect(Math.max(...radii) - Math.min(...radii)).toBeLessThan(1e-6);
      const made = pixels(makeSurface('box', 0, aspect).points, width, height);
      expect(dot(edge(made[0], made[1]), edge(made[1], made[2]))).toBeCloseTo(0, 6);
      for (const p of [...makeSurface('circle', 0, aspect).points, ...makeSurface('triangle', 0, aspect).points]) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(1);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThanOrEqual(1);
      }
    });
  }

  it('used to shear: rotating in normalised space is not what happens any more', () => {
    const box = rect('box', 0.4, 0.4, 0.2, 0.1).points;
    const after = pixels(transformPoints(box, 1, Math.PI / 12, 16 / 9), 1920, 1080);
    const naive = pixels(transformPoints(box, 1, Math.PI / 12, 1), 1920, 1080);
    expect(dot(edge(naive[0], naive[1]), edge(naive[1], naive[2]))).not.toBeCloseTo(0, 2);
    expect(dot(edge(after[0], after[1]), edge(after[1], after[2]))).toBeCloseTo(0, 6);
  });
});

describe('placing new shapes', () => {
  it('does not put a second shape on top of the first', () => {
    const first = makeSurface('box', 0, 16 / 9, spawnPoint([], 16 / 9));
    const place = spawnPoint([first], 16 / 9);
    expect(place).not.toEqual(centroid(first.points));
    const second = makeSurface('box', 1, 16 / 9, place);
    expect(centroid(second.points).x).not.toBeCloseTo(centroid(first.points).x, 2);
  });

  it('keeps finding distinct places as the scene fills up', () => {
    const surfaces: InteractiveSurface[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < 12; i++) {
      const place = spawnPoint(surfaces, 9 / 16);
      const key = place.x.toFixed(3) + ',' + place.y.toFixed(3);
      expect(seen.has(key)).toBe(false);
      seen.add(key);
      const shape = makeSurface('circle', i, 9 / 16, place);
      for (const p of shape.points) expect(p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1).toBe(true);
      surfaces.push(shape);
    }
  });
});

describe('stage hit-testing', () => {
  const W = 960,
    H = 540;
  const px = (x: number, y: number): Point => ({ x: x / W, y: y / H });
  const boxAt = (id: string, x: number, y: number, size: number) => rect(id, x / W, y / H, size / W, size / H);

  it('only the selected shape has corner handles', () => {
    const surfaces = [boxAt('main', 100, 100, 200), boxAt('other', 360, 100, 200)];
    // 8 px inside the top-left corner of "other"
    const nearOtherCorner = px(368, 108);
    expect(hitTestSurfaces(surfaces, nearOtherCorner, W, H, 'main')).toEqual({ kind: 'body', id: 'other' });
    expect(hitTestSurfaces(surfaces, nearOtherCorner, W, H, 'other')).toEqual({
      kind: 'vertex',
      id: 'other',
      index: 0,
    });
    expect(hitTestSurfaces(surfaces, nearOtherCorner, W, H)).toEqual({ kind: 'body', id: 'other' });
  });

  it('dragging inside the selected shape never grabs a hidden corner of another shape', () => {
    // "below" has a corner at (300,300), in the middle of the selected shape on top of it.
    const surfaces = [boxAt('below', 300, 300, 150), boxAt('selected', 200, 200, 200)];
    expect(hitTestSurfaces(surfaces, px(302, 302), W, H, 'selected')).toEqual({ kind: 'body', id: 'selected' });
  });

  it('picks the topmost shape under the point, or nothing', () => {
    const surfaces = [boxAt('below', 200, 100, 300), boxAt('above', 300, 200, 300)];
    expect(hitTestSurfaces(surfaces, px(450, 350), W, H)).toEqual({ kind: 'body', id: 'above' });
    expect(hitTestSurfaces(surfaces, px(250, 150), W, H)).toEqual({ kind: 'body', id: 'below' });
    expect(hitTestSurfaces(surfaces, px(900, 30), W, H)).toEqual({ kind: 'none' });
  });

  it('keeps small shapes draggable by their body', () => {
    for (const size of [40, 24, 12]) {
      const small = boxAt('small', 400, 300, size);
      const centre = px(400 + size / 2, 300 + size / 2);
      expect(hitTestSurfaces([small], centre, W, H, 'small', MOUSE_TOLERANCE)).toEqual({ kind: 'body', id: 'small' });
      expect(hitTestSurfaces([small], centre, W, H, 'small', TOUCH_TOLERANCE)).toEqual({ kind: 'body', id: 'small' });
    }
    // the corners of a small selected shape can still be grabbed
    expect(hitTestVertex(boxAt('s', 400, 300, 40).points, px(401, 301), W, H, MOUSE_TOLERANCE.handle)).toBe(0);
  });

  it('reaches thin shapes by their outline', () => {
    const ledge = rect('ledge', 0.2, 0.5, 0.4, 2 / H);
    expect(hitTestSurfaces([ledge], px(300, 270 + 6), W, H)).toEqual({ kind: 'body', id: 'ledge' });
    expect(hitTestSurfaces([ledge], px(300, 270 + 12), W, H)).toEqual({ kind: 'none' });
    expect(hitTestSurfaces([ledge], px(300, 270 + 12), W, H, '', TOUCH_TOLERANCE)).toEqual({
      kind: 'body',
      id: 'ledge',
    });
  });

  it('measures in screen pixels, so the same press works on any stage shape', () => {
    const box = rect('box', 0.5, 0.5, 0.2, 0.2);
    const p = { x: 0.5, y: 0.5 - 10 / 540 };
    expect(hitTestSurfaces([box], p, 960, 540, 'box').kind).toBe('vertex');
    expect(hitTestSurfaces([box], p, 540, 960, 'box').kind).toBe('none');
  });
});
