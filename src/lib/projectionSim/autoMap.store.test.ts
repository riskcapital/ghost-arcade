import { get } from 'svelte/store';
import { beforeAll, expect, it } from 'vitest';

// The layers store pulls in settings, which paints CSS variables on import.
let project: typeof import('../stores/layers').project;
let autoMap: typeof import('./autoMap');
let types: typeof import('./types');

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
  ({ project } = await import('../stores/layers'));
  autoMap = await import('./autoMap');
  types = await import('./types');
});

it('maps each face to a media layer that can take content, filled with its face colour until then', async () => {
  const scene = types.createProjectionSimScene();
  scene.objects = [{ ...types.makeProjectionSimPrimitive('box'), position: [0, 1, 0] }];
  scene.projectors = [{ ...types.makeProjectionSimProjector(), position: [0, 1.4, 4], target: [0, 1, 0], enabled: true }];
  const result = await autoMap.autoMapProjectionSim(scene);
  expect(result.surfaces).toBeGreaterThan(0);
  const faces = get(project).layers.filter((layer) => (layer as any).autoMap === autoMap.AUTO_MAP_TAG);
  expect(faces).toHaveLength(result.surfaces);
  for (const face of faces) {
    expect(face.type).toBe('media');
    expect(face.source).toBeNull();
    expect(face.colorContent?.alpha).toBe(1);
  }
  // A shader goes onto a face like onto any media layer.
  const face = faces[0];
  project.setLayerSource(face.id, { id: 'shader-on-face', type: 'shader', name: 'grid', src: 'builtin:grid', shaderCode: 'void main(){}', shaderValues: {} } as any);
  expect(get(project).layers.find((layer) => layer.id === face.id)?.source?.type).toBe('shader');
});
