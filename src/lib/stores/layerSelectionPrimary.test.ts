import { get } from 'svelte/store';
import { beforeAll, describe, expect, it } from 'vitest';
import { primaryForSelection } from './layerSelection';

// The layers store pulls in settings, which paints CSS variables on import.
let layersModule: typeof import('./layers');

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
  layersModule = await import('./layers');
});

describe('primaryForSelection', () => {
  const all = ['a', 'b', 'c'];

  it('keeps a requested layer that is part of the selection', () => {
    expect(primaryForSelection('b', 'a', ['a', 'b'], all)).toBe('b');
  });

  it('never makes a deselected layer the primary', () => {
    // Cmd-click deselecting "b" passes "b" as the requested primary.
    expect(primaryForSelection('b', 'b', ['a', 'c'], all)).toBe('c');
    expect(primaryForSelection('b', 'a', ['a', 'c'], all)).toBe('a');
  });

  it('allows a lone primary when the selection is empty', () => {
    expect(primaryForSelection('a', null, [], all)).toBe('a');
    expect(primaryForSelection('gone', null, [], all)).toBeNull();
  });
});

describe('project selection and batch corners', () => {
  it('Cmd/Ctrl-deselecting the primary layer moves the primary to a selected one', () => {
    const { project, selectedLayerIds } = layersModule;
    project.addLayer('one');
    const a = get(project).selectedLayerId!;
    project.addLayer('two');
    const b = get(project).selectedLayerId!;
    project.setLayerSelection(b, [a, b]);
    expect(get(project).selectedLayerId).toBe(b);
    // What LayerPanel / the canvas pass when b is Cmd-clicked off.
    project.setLayerSelection(b, [a]);
    expect(get(selectedLayerIds)).toEqual([a]);
    expect(get(project).selectedLayerId).toBe(a);
  });

  it('moves several layers in one store update', () => {
    const { project } = layersModule;
    project.addLayer('x');
    const x = get(project).selectedLayerId!;
    project.addLayer('y');
    const y = get(project).selectedLayerId!;
    const quad = (dx: number) => ({
      topLeft: { x: dx, y: 1 }, topRight: { x: dx + 0.5, y: 1 },
      bottomLeft: { x: dx, y: 0.5 }, bottomRight: { x: dx + 0.5, y: 0.5 },
    });
    let updates = 0;
    const unsubscribe = project.subscribe(() => { updates += 1; });
    updates = 0;
    project.setCornersBatch(new Map([[x, quad(0.1)], [y, quad(0.2)]]));
    unsubscribe();
    expect(updates).toBe(1);
    const layers = get(project).layers;
    expect(layers.find(l => l.id === x)!.corners.topLeft.x).toBeCloseTo(0.1);
    expect(layers.find(l => l.id === y)!.corners.topLeft.x).toBeCloseTo(0.2);
  });
});
