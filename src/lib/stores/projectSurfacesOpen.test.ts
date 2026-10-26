import { beforeAll, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

/**
 * Opening a project with no Stage Designer surfaces left the previous
 * project's surfaces in the designer, and the designer copies its state back
 * into the project on its next change, so they ended up saved in the new
 * project too.
 */

let layers: typeof import('./layers');

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
  (globalThis as any).requestAnimationFrame = (cb: (t: number) => void) => setTimeout(() => cb(Date.now()), 0) as unknown as number;
  (globalThis as any).cancelAnimationFrame = (id: number) => clearTimeout(id as never);
}

beforeAll(async () => {
  installDomShim();
  layers = await import('./layers');
});

describe('Stage Designer surfaces belong to the project that is open', () => {
  const surface = (id: string, name: string) => ({ id, name, width: 1920, height: 1080, slices: [] });
  const payload = (extra: Record<string, unknown>) => ({
    version: '1.9.3',
    project: { id: 'stage', name: 'Stage', width: 1920, height: 1080, layers: [], ...extra },
  });

  it('opens a project with no surfaces with none, not the previous project\'s', async () => {
    const { surfaceStore } = await import('./surface');
    expect(layers.project.importProject(payload({ surfaces: [surface('surf-a', 'Stage A')], activeSurfaceId: 'surf-a' }))).toBe(true);
    await vi.waitFor(() => expect(get(surfaceStore).surfaces.map((s) => s.id)).toEqual(['surf-a']));

    expect(layers.project.importProject(payload({}))).toBe(true);
    await vi.waitFor(() => expect(get(surfaceStore).surfaces).toEqual([]));
    expect(get(surfaceStore).activeSurfaceId).toBeNull();
    // The store mirrors itself into the project on its next change; the old
    // surfaces must not come back with it.
    surfaceStore.createSurface('New stage');
    await vi.waitFor(() => expect((get(layers.project).surfaces ?? []).map((s: any) => s.name)).toEqual(['New stage']));
  });

  it('leaves the designer alone for live state relayed from another window', async () => {
    const { surfaceStore } = await import('./surface');
    expect(layers.project.importProject(payload({ surfaces: [surface('surf-b', 'Stage B')], activeSurfaceId: 'surf-b' }))).toBe(true);
    await vi.waitFor(() => expect(get(surfaceStore).surfaces.map((s) => s.id)).toEqual(['surf-b']));
    expect(layers.project.importProject(payload({}), undefined, { live: true })).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(get(surfaceStore).surfaces.map((s) => s.id)).toEqual(['surf-b']);
  });
});
