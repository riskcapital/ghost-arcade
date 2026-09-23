import { get } from 'svelte/store';
import { beforeAll, describe, expect, it, vi } from 'vitest';

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


it('gives new stage slices a calibration grid even when ordinary new layers are blank', async () => {
  const { settings } = await import('./settings');
  const original = get(settings);
  try {
    settings.update(s => ({ ...s, defaultLayerShader: 'none' }));
    const surface = twoBandSurface();
    const links = project.applyStageSurfaceToLayers(surface);
    await vi.waitFor(() => {
      for (const id of Object.values(links)) {
        expect(get(project).layers.find(l => l.id === id)?.source?.src).toBe('builtin:grid');
      }
    });
    const firstId = Object.values(links)[0];
    const content = { id: 'test-content', type: 'image', src: '/stage-image.png', name: 'User content' } as const;
    project.setLayerSource(firstId, content);
    const reapplied = project.applyStageSurfaceToLayers(surface, links);
    expect(reapplied).toEqual(links);
    expect(get(project).layers.find(l => l.id === firstId)?.source).toEqual(content);
  } finally { settings.update(() => original); }
});

it('applies a 2D layout to live VJ screens without leaving the VJ workspace', async () => {
  const { surfaceStore } = await import('./surface');
  const { workspace } = await import('./workspace');
  surfaceStore.reset();
  surfaceStore.createSurface('Live stage', 1000, 1000);
  surfaceStore.addSlice([
    { x: 100, y: 100 }, { x: 900, y: 100 },
    { x: 900, y: 900 }, { x: 100, y: 900 },
  ], 'Live slice');
  workspace.openVJ();
  try {
    expect(await surfaceStore.applyStage({ stayInVJ: true })).toBe(true);
    expect(get(workspace)).toBe('vj');
    expect(get(project).layers.some(layer => layer.type === 'screen' && layer.name === 'Live slice')).toBe(true);
  } finally {
    workspace.closeAll();
    surfaceStore.reset();
  }
});

it('keeps a screen created in VJ linked to the 2D stage after corner edits', async () => {
  const { surfaceStore, activeSurfaceSlices } = await import('./surface');
  surfaceStore.reset();
  project.addScreenLayer('Live screen');
  const screenId = get(project).selectedLayerId!;
  const screen = get(project).layers.find(layer => layer.id === screenId)!;
  const sliceId = surfaceStore.registerLiveScreenLayer(screen);
  expect(sliceId).toBeTruthy();
  expect(get(activeSurfaceSlices).find(slice => slice.id === sliceId)?.sourceBinding).toEqual({ kind: 'layer', layerId: screenId });
  project.setCorner(screenId, 'topLeft', { x: 0.2, y: 0.9 });
  surfaceStore.syncFromMappingLayers(get(project).layers);
  const updated = get(activeSurfaceSlices).find(slice => slice.id === sliceId)!;
  expect(updated.polygon.some(point => point.x > 0 && point.x < 0.3 * 1920 && point.y < 0.2 * 1080)).toBe(true);
  surfaceStore.reset();
});

it('mirrors a drawn live custom outline into the saved 2D slice', async () => {
  const { surfaceStore, activeSurfaceSlices } = await import('./surface');
  surfaceStore.reset();
  project.addScreenLayer('Drawn screen');
  const id = get(project).selectedLayerId!;
  project.setLayerShape(id, 'custom');
  const screen = get(project).layers.find(layer => layer.id === id)!;
  const sliceId = surfaceStore.registerLiveScreenLayer(screen);
  project.updateLayerShapeParams(id, {
    customPoints: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0.5, y: 1 }],
    customClosed: true,
  });
  surfaceStore.syncFromMappingLayers(get(project).layers);
  const slice = get(activeSurfaceSlices).find(item => item.id === sliceId)!;
  expect(slice.polygon).toHaveLength(3);
  expect(slice.polygon[2].y).toBeCloseTo(0, 5);
  surfaceStore.reset();
});
