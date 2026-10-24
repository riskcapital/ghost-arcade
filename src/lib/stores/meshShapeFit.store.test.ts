import { get } from 'svelte/store';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Layer } from '../types';
import { isIdentityMeshGrid, meshHasRest } from '../utils/meshWarp';

// The layers store pulls in settings, which paints CSS variables on import.
let project: typeof import('./layers').project;

beforeAll(async () => {
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
    },
  });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { documentElement: { style: { setProperty: () => {} } } },
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      addEventListener: () => {},
      removeEventListener: () => {},
      matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
    },
  });
  ({ project } = await import('./layers'));
});

const layer = (id: string): Layer => get(project).layers.find((l) => l.id === id)!;

/** A layer with a closed square Custom Shape in its upper left. */
function shapedLayer(): string {
  const id = project.addLayer('Shaped')!;
  project.setLayerShape(id, 'custom');
  for (const point of [{ x: 0.1, y: 0.9 }, { x: 0.3, y: 0.9 }, { x: 0.3, y: 0.7 }, { x: 0.1, y: 0.7 }]) {
    project.addCustomShapePoint(id, point);
  }
  project.closeCustomShape(id);
  return id;
}

describe('mesh warp on a Custom Shape', () => {
  it('starts the mesh on the shape when Mesh is turned on', () => {
    const id = shapedLayer();
    project.setWarpMode(id, 'mesh');
    const grid = layer(id).meshGrid!;
    expect(grid.fit).toBe('shape');
    expect(meshHasRest(grid)).toBe(true);
    expect(isIdentityMeshGrid(grid)).toBe(true);
    // The middle point sits in the middle of the shape, not of the layer.
    expect(grid.points[1][1].x).toBeCloseTo(0.2, 5);
    expect(grid.points[1][1].y).toBeCloseTo(0.8, 5);
  });

  it('keeps a plain mesh on a layer without a closed shape', () => {
    const id = project.addLayer('Plain')!;
    project.setWarpMode(id, 'mesh');
    const grid = layer(id).meshGrid!;
    expect(grid.fit).toBeUndefined();
    expect(grid.points[1][1]).toEqual({ x: 0.5, y: 0.5 });
  });

  it('fits a mesh already on when the shape is closed', () => {
    const id = project.addLayer('Mesh first')!;
    project.setWarpMode(id, 'mesh');
    project.setLayerShape(id, 'custom');
    for (const point of [{ x: 0.5, y: 0.5 }, { x: 0.9, y: 0.5 }, { x: 0.7, y: 0.1 }]) project.addCustomShapePoint(id, point);
    expect(layer(id).meshGrid!.fit).toBeUndefined();
    project.closeCustomShape(id);
    const grid = layer(id).meshGrid!;
    expect(grid.fit).toBe('shape');
    expect(grid.points[0][0].x).toBeLessThan(0.5);
    expect(grid.points[0][0].x).toBeGreaterThan(0.49);
  });

  it('follows shape edits while unwarped, and keeps a warp once there is one', () => {
    const id = shapedLayer();
    project.setWarpMode(id, 'mesh');
    project.updateCustomShapePoint(id, 1, { x: 0.5, y: 0.9 });
    const followed = layer(id).meshGrid!;
    expect(followed.fit).toBe('shape');
    expect(followed.points[1][1].x).toBeCloseTo(0.3, 5);

    project.setMeshPoint(id, 1, 1, { x: 0.32, y: 0.78 });
    const warped = layer(id).meshGrid!;
    project.updateCustomShapePoint(id, 1, { x: 0.6, y: 0.9 });
    expect(layer(id).meshGrid).toBe(warped);

    // Reset starts over on the shape as it is now.
    project.resetMeshGrid(id);
    expect(layer(id).meshGrid!.points[1][1].x).toBeCloseTo(0.35, 5);
  });

  it('gives the whole layer back when the shape goes away', () => {
    const id = shapedLayer();
    project.setWarpMode(id, 'mesh');
    project.toggleLayerShapeEnabled(id);
    const grid = layer(id).meshGrid!;
    expect(grid.fit).toBeUndefined();
    expect(grid.rest).toBeUndefined();
    expect(grid.points[1][1]).toEqual({ x: 0.5, y: 0.5 });
  });

  it('keeps the fit through a new grid size and can follow the outline or the whole layer', () => {
    const id = shapedLayer();
    project.setWarpMode(id, 'mesh');
    project.setMeshGridSize(id, 5, 5);
    expect(layer(id).meshGrid!.fit).toBe('shape');
    expect(layer(id).meshGrid!.rows).toBe(5);

    expect(project.fitMeshGrid(id, 'outline')).toEqual({ fitted: 'outline', spansInnerCorners: false });
    expect(layer(id).meshGrid!.fit).toBe('outline');
    project.setMeshGridSize(id, 4, 4);
    expect(layer(id).meshGrid!.fit).toBe('outline');

    expect(project.fitMeshGrid(id, 'layer').fitted).toBeNull();
    const plain = layer(id).meshGrid!;
    expect(plain.fit).toBe('layer');
    expect(plain.rest).toBeUndefined();
    expect(plain.rows).toBe(4);
    // Turning Mesh off and on again keeps the choice of the whole layer,
    // and so does editing the shape.
    project.setWarpMode(id, 'corners');
    project.setWarpMode(id, 'mesh');
    project.updateCustomShapePoint(id, 1, { x: 0.4, y: 0.9 });
    expect(layer(id).meshGrid).toBe(plain);
  });
});
