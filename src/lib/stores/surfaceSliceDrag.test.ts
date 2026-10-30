import { get } from 'svelte/store';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// surface.ts mirrors into the layers store, which reads settings on import.
let surface: typeof import('./surface');

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
  // Load layers up front: surface.ts mirrors into it through a lazy import,
  // which must not still be loading when the file finishes.
  await import('./layers');
  surface = await import('./surface');
});

afterEach(() => {
  vi.restoreAllMocks();
  surface.surfaceStore.reset();
});

const square = (x: number, y: number) => [
  { x, y }, { x: x + 100, y }, { x: x + 100, y: y + 100 }, { x, y: y + 100 },
];

function setup() {
  const store = surface.surfaceStore;
  store.reset();
  store.createSurface('Drag test', 1000, 1000);
  const a = store.addSlice(square(0, 0), 'A')!;
  const b = store.addSlice(square(300, 300), 'B')!;
  return { store, a, b };
}

const polygonOf = (id: string) => get(surface.activeSurfaceSlices).find((sl) => sl.id === id)!.polygon;

describe('multi-slice drag', () => {
  it('writes the store once per move and never clones state mid-gesture', () => {
    const { store, a, b } = setup();
    let writes = 0;
    const unsubscribe = store.subscribe(() => { writes++; });
    writes = 0;
    store.beginHistoryGesture();
    const clone = vi.spyOn(globalThis, 'structuredClone');
    for (let step = 1; step <= 5; step++) {
      store.updateSlices([
        { sliceId: a, patch: { polygon: square(step, 0) } },
        { sliceId: b, patch: { polygon: square(300 + step, 300) } },
      ]);
    }
    expect(clone).not.toHaveBeenCalled();
    expect(writes).toBe(5);
    unsubscribe();
    store.endHistoryGesture();
    expect(polygonOf(a)[0].x).toBe(5);
    expect(polygonOf(b)[0].x).toBe(305);
  });

  it('is one undo step per drag', () => {
    const { store, a, b } = setup();
    store.beginHistoryGesture();
    for (let step = 1; step <= 3; step++) {
      store.updateSlices([
        { sliceId: a, patch: { polygon: square(step * 10, 0) } },
        { sliceId: b, patch: { polygon: square(300 + step * 10, 300) } },
      ]);
    }
    store.endHistoryGesture();
    store.undo();
    expect(polygonOf(a)[0].x).toBe(0);
    expect(polygonOf(b)[0].x).toBe(300);
    // The step before the drag is adding B.
    store.undo();
    expect(get(surface.activeSurfaceSlices).map((sl) => sl.id)).toEqual([a]);
  });

  it('records one undo step for a batched update outside a gesture', () => {
    const { store, a, b } = setup();
    store.updateSlices([
      { sliceId: a, patch: { name: 'A2' } },
      { sliceId: b, patch: { name: 'B2' } },
    ]);
    store.undo();
    const names = get(surface.activeSurfaceSlices).map((sl) => sl.name);
    expect(names).toEqual(['A', 'B']);
  });
});
