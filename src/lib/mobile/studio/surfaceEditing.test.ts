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

import { hitTestSurfaces, VERTEX_GRAB_RADIUS } from './surfaceEditing';
describe('stage hit-testing', () => {
  const square = (id: string, x: number, y: number, size: number) => ({
    id,
    name: id,
    behavior: 'solid' as const,
    points: [
      { x, y },
      { x: x + size, y },
      { x: x + size, y: y + size },
      { x, y: y + size },
    ],
  });
  const W = 960,
    H = 540;

  it('grabs the nearest corner inside the grab radius', () => {
    const surfaces = [square('a', 0.1, 0.1, 0.3)];
    const near = { x: 0.1 + (VERTEX_GRAB_RADIUS - 2) / W, y: 0.1 };
    expect(hitTestSurfaces(surfaces, near, W, H)).toEqual({ kind: 'vertex', id: 'a', index: 0 });
    const far = { x: 0.1 + (VERTEX_GRAB_RADIUS + 2) / W, y: 0.1 + (VERTEX_GRAB_RADIUS + 2) / H };
    expect(hitTestSurfaces(surfaces, far, W, H)).toEqual({ kind: 'body', id: 'a' });
  });

  it('picks the topmost shape under the point, or nothing', () => {
    const surfaces = [square('below', 0.2, 0.2, 0.5), square('above', 0.3, 0.3, 0.5)];
    expect(hitTestSurfaces(surfaces, { x: 0.5, y: 0.5 }, W, H)).toEqual({ kind: 'body', id: 'above' });
    expect(hitTestSurfaces(surfaces, { x: 0.25, y: 0.5 }, W, H)).toEqual({ kind: 'body', id: 'below' });
    expect(hitTestSurfaces(surfaces, { x: 0.95, y: 0.05 }, W, H)).toEqual({ kind: 'none' });
  });

  it('measures the grab radius in screen pixels, not normalised units', () => {
    const surfaces = [square('a', 0.5, 0.5, 0.2)];
    const p = { x: 0.5, y: 0.5 - 20 / 540 };
    expect(hitTestSurfaces(surfaces, p, 960, 540).kind).toBe('vertex');
    expect(hitTestSurfaces(surfaces, p, 960, 1080).kind).toBe('none');
  });
});
