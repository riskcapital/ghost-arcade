import { describe, expect, it } from 'vitest';
import { validateScene } from '../mobile/studio/interactive';
import { interactiveFromScene3D, reliefStarterScene } from './reliefStarter';
import { lightAndShadowWorld, type StageShape } from './worlds';

const shapes: StageShape[] = [
  { name: 'Left', points: [{ x: 0.1, y: 0.2 }, { x: 0.3, y: 0.2 }, { x: 0.3, y: 0.6 }, { x: 0.1, y: 0.6 }] },
  { name: 'Right', points: [{ x: 0.6, y: 0.3 }, { x: 0.9, y: 0.35 }, { x: 0.75, y: 0.8 }] },
];

describe('Interactive 3D in the Studio', () => {
  it('starts a new layer with the mapped shapes standing out of a lit wall', () => {
    const scene = validateScene(reliefStarterScene(shapes));
    expect(scene.world?.enabled).toBe(true);
    expect(scene.surfaces.map((s) => [s.name, s.behavior])).toEqual([['Left', 'solid'], ['Right', 'solid']]);
    expect(scene.surfaces.map((s) => s.finish?.preset)).toEqual(['stone', 'chrome']);
    expect(scene.surfaces[1].points).toEqual(shapes[1].points);
    expect(scene.effects?.map((e) => e.kind)).toContain('balls3d');
    expect(scene.effects?.find((e) => e.kind === 'drips')?.target).toBe(scene.surfaces[0].id);
    expect(scene.effects?.find((e) => e.kind === 'flames')?.target).toBe(scene.surfaces[1].id);
    expect(scene.effects?.some((e) => e.kind !== 'balls3d')).toBe(true);
  });

  it('stands three plinths up when nothing is mapped', () => {
    const scene = validateScene(reliefStarterScene([]));
    expect(scene.surfaces).toHaveLength(3);
    expect(scene.surfaces.every((s) => s.behavior === 'solid' && !!s.finish)).toBe(true);
  });

  it('brings an older 3D world in on the same outlines, with its sun', () => {
    const old = lightAndShadowWorld(shapes, 16 / 9);
    const scene = validateScene(interactiveFromScene3D(old, 16 / 9));
    expect(scene.world?.enabled).toBe(true);
    expect(scene.surfaces.map((s) => s.name)).toEqual(['Left', 'Right']);
    scene.surfaces.forEach((s, i) => s.points.forEach((p, j) => {
      expect(p.x).toBeCloseTo(shapes[i].points[j].x, 9);
      expect(p.y).toBeCloseTo(shapes[i].points[j].y, 9);
    }));
    expect(scene.world?.sun.color).toBe('#ffd9b0');
    expect(scene.surfaces.every((s) => s.height! > 0.02 && s.height! < 0.9)).toBe(true);
  });
});
