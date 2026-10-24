/** Round-trip guard for project-file projection sim persistence:
 *  runtime asset URLs are blanked at save when a durable AssetRef exists,
 *  and recomputed (projectDir-aware) on project load. */
import { describe, expect, it, beforeAll } from 'vitest';

let store: typeof import('./store');
let types: typeof import('./types');

beforeAll(async () => {
  const storage = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, String(v)),
    removeItem: (k: string) => void storage.delete(k),
    clear: () => storage.clear(), key: () => null, length: 0,
  };
  store = await import('./store');
  types = await import('./types');
});

describe('projection sim project persistence', () => {
  it('blanks runtime asset URLs at save and restores them on load', () => {
    const obj = {
      ...types.makeProjectionSimPrimitive('box'),
      type: 'model' as const,
      assetUrl: 'blob:http://localhost:1420/dead-runtime-url',
      assetRef: { kind: 'local-file' as const, originalPath: '/Users/x/models/venue.glb', name: 'venue.glb' },
      assetName: 'venue.glb',
      assetFormat: 'glb' as const,
    };
    store.projectionSimScene.addImportedObject(obj);

    const saved = store.projectionSimScene.exportForProject();
    const savedObj = saved.objects.find((o) => o.id === obj.id)!;
    expect(savedObj.assetUrl).toBe('');
    expect(savedObj.assetRef?.originalPath).toBe('/Users/x/models/venue.glb');
    // Nothing base64-sized may survive into the project file.
    expect(JSON.stringify(saved).length).toBeLessThan(50_000);

    store.projectionSimScene.loadSceneFromProject(saved, '/Users/x/projects/show1');
    let current: any;
    const unsub = store.projectionSimScene.subscribe((s) => { current = s; });
    unsub();
    const loadedObj = current.objects.find((o: any) => o.id === obj.id);
    expect(loadedObj.assetUrl).toBeTruthy();
    expect(loadedObj.assetUrl).not.toContain('blob:');
    expect(loadedObj.assetUrl).toContain('venue.glb');
  });

  it('keeps plain scenes intact through the save serializer', () => {
    const saved = store.projectionSimScene.exportForProject();
    expect(saved.schemaVersion).toBe(1);
    expect(Array.isArray(saved.objects)).toBe(true);
    expect(Array.isArray(saved.projectors)).toBe(true);
  });
});

describe('the Map Sim in the project file', () => {
  it('is saved with the project and restored on open', async () => {
    const storage = new Map<string, string>();
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
        localStorage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v), removeItem: () => {} },
      },
    });
    const { project } = await import('../stores/layers');
    store.projectionSimScene.loadPreset('cube-pyramid');
    store.projectionSimScene.addProjector?.();
    let before: any;
    store.projectionSimScene.subscribe((s) => { before = s; })();
    const saved = JSON.parse(JSON.stringify(await project.exportProjectForSave())) as any;
    expect(saved.project.projectionSim?.schemaVersion).toBe(1);
    expect(saved.project.projectionSim.objects.length).toBe(before.objects.length);
    // Autosave (crash recovery) carries it too.
    expect(JSON.parse(project.exportProjectJSON()).project.projectionSim?.schemaVersion).toBe(1);

    store.projectionSimScene.newScene();
    expect(project.importProject(saved, '/Users/x/projects/show1')).toBe(true);
    let after: any;
    store.projectionSimScene.subscribe((s) => { after = s; })();
    expect(after.objects.map((o: any) => o.id)).toEqual(before.objects.map((o: any) => o.id));
    expect(after.projectors.length).toBe(before.projectors.length);
  });
});
