import { beforeAll, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';

/**
 * Bezier mesh tangents ride inside the layer's meshGrid, so a project save
 * carries them and a pre-Bezier project opens without gaining any keys.
 */

let layers: typeof import('./layers');
let types: typeof import('../types');

function installDomShim(): void {
  const storage = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, String(v)),
    removeItem: (k: string) => void storage.delete(k),
    clear: () => storage.clear(),
    key: () => null,
    length: 0,
  };
  (globalThis as any).document = {
    documentElement: { style: { setProperty() {}, removeProperty() {} } },
    addEventListener() {}, removeEventListener() {},
  };
  (globalThis as any).window = globalThis;
  (globalThis as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
}

beforeAll(async () => {
  installDomShim();
  types = await import('../types');
  layers = await import('./layers');
});

describe('Bezier mesh persistence', () => {
  it('saves and reopens Bezier mesh tangents, and opens old meshes unchanged', () => {
    const layer = types.createLayer('bezier-mesh', 'Cyclorama', 'gpu');
    const legacy = types.createLayer('legacy-mesh', 'Old mesh', 'gpu');
    legacy.warpMode = 'mesh';
    legacy.meshGrid = types.createMeshGrid(3, 3);
    legacy.meshGrid.points[1][1] = { x: 0.6, y: 0.4 };
    // Exactly what a pre-Bezier project holds: no bezier or tangents keys.
    const legacyJson = JSON.parse(JSON.stringify(legacy));
    expect(layers.project.importProject({ version: '1.9.995', project: { id: 'bezier', name: 'Bezier', width: 1920, height: 1080, layers: [layer, legacyJson] } })).toBe(true);

    layers.project.setWarpMode(layer.id, 'mesh');
    layers.project.setMeshGridSize(layer.id, 4, 4);
    layers.project.setMeshBezier(layer.id, true);
    layers.project.setMeshPointTangents(layer.id, 0, 1, { right: { x: 0.1, y: 0.08 } });
    layers.project.setMeshPointTangents(layer.id, 3, 2, { left: { x: -0.1, y: 0 }, up: { x: 0.02, y: 0.1 } });
    // A point whose handles are all reset drops out of the sparse grid.
    layers.project.setMeshPointTangents(layer.id, 2, 2, { down: { x: 0, y: -0.1 } });
    layers.project.setMeshPointTangents(layer.id, 2, 2, null);

    const live = get(layers.project).layers.find((l) => l.id === layer.id)!.meshGrid!;
    expect(live.bezier).toBe(true);
    expect(live.tangents?.[2][2]).toBeNull();

    const saved = JSON.parse(JSON.stringify(layers.project.exportProject()));
    expect(layers.project.importProject(saved)).toBe(true);
    const reopened = get(layers.project).layers;
    const grid = reopened.find((l) => l.id === layer.id)!.meshGrid!;
    expect(grid.bezier).toBe(true);
    expect(grid.tangents?.[0][1]).toEqual({ right: { x: 0.1, y: 0.08 } });
    expect(grid.tangents?.[3][2]).toEqual({ left: { x: -0.1, y: 0 }, up: { x: 0.02, y: 0.1 } });
    expect(grid.tangents?.[1][1]).toBeNull();

    const old = reopened.find((l) => l.id === legacy.id)!.meshGrid!;
    expect(old).toEqual(legacyJson.meshGrid);
    expect('bezier' in old).toBe(false);
    expect('tangents' in old).toBe(false);

    // Clearing the last tangent removes the field, and Reset Mesh keeps
    // the Bezier toggle but straightens every point.
    layers.project.resetMeshGrid(layer.id);
    const reset = get(layers.project).layers.find((l) => l.id === layer.id)!.meshGrid!;
    expect(reset.bezier).toBe(true);
    expect(reset.tangents).toBeUndefined();
  });});
