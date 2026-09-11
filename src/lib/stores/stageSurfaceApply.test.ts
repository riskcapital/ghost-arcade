import { get } from 'svelte/store';
import { beforeAll, describe, expect, it } from 'vitest';

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

/** A two-slice surface: one band across the top, one across the bottom. */
function twoBandSurface() {
  return {
    id: 'surface-apply-test',
    name: 'Apply test',
    width: 1000,
    height: 1000,
    slices: [
      {
        id: 'top-band',
        name: 'Top',
        polygon: [
          { x: 100, y: 100 },
          { x: 900, y: 100 },
          { x: 900, y: 300 },
          { x: 100, y: 300 },
        ],
        color: '#ff0000',
        visible: true,
        locked: false,
        sourceBinding: null,
      },
      {
        id: 'bottom-band',
        name: 'Bottom',
        polygon: [
          { x: 100, y: 700 },
          { x: 900, y: 700 },
          { x: 900, y: 900 },
          { x: 100, y: 900 },
        ],
        color: '#00ff00',
        visible: true,
        locked: false,
        sourceBinding: null,
      },
    ],
  } as any;
}

describe('applyStageSurfaceToLayers', () => {
  it('places slices with canvas Y-up corners, so the top of the stage is the top of the canvas', () => {
    const links = project.applyStageSurfaceToLayers(twoBandSurface());
    const layers = get(project).layers;
    const top = layers.find((layer) => layer.id === links['top-band']);
    const bottom = layers.find((layer) => layer.id === links['bottom-band']);

    expect(top).toBeTruthy();
    expect(bottom).toBeTruthy();
    // Surface y 100..300 (its top band) maps to canvas y 0.7..0.9.
    expect(top!.corners.topLeft.y).toBeCloseTo(0.9, 5);
    expect(top!.corners.bottomLeft.y).toBeCloseTo(0.7, 5);
    // The top edge sits above the bottom edge, as for any ordinary layer.
    expect(top!.corners.topLeft.y).toBeGreaterThan(top!.corners.bottomLeft.y);
    // And the stage's bottom band stays below the top one.
    expect(bottom!.corners.topLeft.y).toBeLessThan(top!.corners.bottomLeft.y);
    // Freshly applied screens are already in the new convention, so the
    // load-time migration must not touch them.
    expect(top!.stageTextureFlipV).toBe(false);
  });
});
