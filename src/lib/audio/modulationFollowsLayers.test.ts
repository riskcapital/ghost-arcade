/**
 * Mapping modulation is keyed by layer position. It must stay on the layer
 * it was put on when other layers are added, removed or reordered, and come
 * back with a deleted layer that an undo restores.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';

let layers: typeof import('../stores/layers');
let modulation: typeof import('./modulation');

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
  const el = (): any => ({
    style: { setProperty() {}, removeProperty() {}, getPropertyValue: () => '' },
    dataset: {}, classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
    setAttribute() {}, removeAttribute() {}, getAttribute: () => null,
    appendChild: (c: any) => c, removeChild: (c: any) => c,
    addEventListener() {}, removeEventListener() {},
    querySelector: () => null, querySelectorAll: () => [], getContext: () => null,
  });
  (globalThis as any).document = {
    documentElement: el(), body: el(), head: el(), createElement: () => el(),
    querySelector: () => null, querySelectorAll: () => [], getElementById: () => null,
    addEventListener() {}, removeEventListener() {}, visibilityState: 'visible',
  };
  (globalThis as any).window = globalThis;
  (globalThis as any).dispatchEvent = () => true;
  (globalThis as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  (globalThis as any).requestAnimationFrame = (cb: (t: number) => void) => setTimeout(() => cb(Date.now()), 0) as unknown as number;
  (globalThis as any).cancelAnimationFrame = (id: number) => clearTimeout(id as never);
}

beforeAll(async () => {
  installDomShim();
  layers = await import('../stores/layers');
  modulation = await import('./modulation');
});

const mod = { source: 'bass', amount: 0.5, target: 'mapping' } as any;
const keys = () => [...get(modulation.modulationStore).keys()].filter((k) => k.startsWith('map:')).sort();
const indexOf = (id: string) => get(layers.project).layers.findIndex((l) => l.id === id);

describe('mapping modulation follows its layer', () => {
  it('stays on its layer when layers are added, deleted and restored', () => {
    expect(layers.project.importProject({ version: '2.1.10', project: { id: 'p', name: 'P', width: 1920, height: 1080, layers: [] } })).toBe(true);
    const a = layers.project.addLayer('A', 'color')!;
    modulation.modulationStore.bulkLoad([{ key: `map:${indexOf(a)}:speed`, mod }]);
    expect(keys()).toEqual([`map:${indexOf(a)}:speed`]);

    // Another layer goes in on top: A moves down a place, its modulation with it.
    const aWas = indexOf(a);
    const b = layers.project.addLayer('B', 'color')!;
    expect(indexOf(a)).not.toBe(aWas);
    expect(keys()).toEqual([`map:${indexOf(a)}:speed`]);
    expect(keys()).not.toContain(`map:${indexOf(b)}:speed`);

    // A is deleted: its modulation goes with it, nothing lands on B.
    const before = get(layers.project);
    layers.project.removeLayer(a);
    expect(keys()).toEqual([]);

    // A comes back (as an undo restores it): so does its modulation.
    layers.project.set(before);
    expect(keys()).toEqual([`map:${indexOf(a)}:speed`]);
  });
});
