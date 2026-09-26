/**
 * Shared map surfaces in the project store: presets reference one geometry
 * per surface, firing a preset in VJ MAP leaves the editor alone, and older
 * projects migrate without moving anything.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';

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
  const makeEl = (): any => ({
    style: { setProperty() {}, removeProperty() {}, getPropertyValue: () => '' },
    dataset: {},
    classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
    setAttribute() {}, removeAttribute() {}, getAttribute: () => null,
    appendChild: (c: any) => c, removeChild: (c: any) => c,
    addEventListener() {}, removeEventListener() {},
    querySelector: () => null, querySelectorAll: () => [],
    load() {}, play: () => Promise.resolve(), pause() {},
  });
  (globalThis as any).document = {
    documentElement: makeEl(), body: makeEl(), head: makeEl(),
    createElement: () => makeEl(), querySelector: () => null, querySelectorAll: () => [],
    getElementById: () => null, addEventListener() {}, removeEventListener() {},
    visibilityState: 'visible',
  };
  (globalThis as any).window = globalThis;
  (globalThis as any).dispatchEvent = () => true;
  (globalThis as any).CustomEvent ??= class extends Event {
    detail: unknown;
    constructor(name: string, options: any) { super(name); this.detail = options.detail; }
  };
  (globalThis as any).matchMedia = () => ({
    matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
  });
  (globalThis as any).requestAnimationFrame = (cb: (t: number) => void) =>
    setTimeout(() => cb(Date.now()), 0) as unknown as number;
  (globalThis as any).cancelAnimationFrame = (id: number) => clearTimeout(id as never);
}

beforeAll(async () => {
  installDomShim();
  layers = await import('./layers');
  types = await import('../types');
});

const box = (x0: number, y0: number, x1: number, y1: number) => ({
  topLeft: { x: x0, y: y1 }, topRight: { x: x1, y: y1 },
  bottomLeft: { x: x0, y: y0 }, bottomRight: { x: x1, y: y0 },
});

function surface(id: string, corners = box(0.1, 0.1, 0.5, 0.5)) {
  return { ...types.createLayer(id, `Surface ${id}`, 'media'), corners,
    source: { id: `src-${id}`, type: 'image', src: `/show/${id}.png`, name: id } };
}

/** A saved project as older builds wrote it: presets carry their own copies. */
function oldProject() {
  const left = surface('left', box(0.1, 0.1, 0.4, 0.6));
  const right = surface('right', box(0.6, 0.1, 0.9, 0.6));
  const staleLeft = { ...left, corners: box(0.12, 0.08, 0.41, 0.63) };
  const clip = (presetId: string) => ({ id: `clip-${presetId}`, type: 'preset', name: presetId, src: '', presetId });
  return {
    version: '1.9.5',
    project: {
      id: 'shared-map', name: 'Shared map', width: 1920, height: 1080,
      layers: [left, right],
      vjMode: {
        compositions: [
          { id: 'A', name: 'A', createdAt: 1, layers: [left, right] },
          { id: 'B', name: 'B', createdAt: 2, layers: [staleLeft, right] },
          { id: 'C', name: 'C', createdAt: 3, layers: [left] },
        ],
        decks: [], timeline: { clips: [] },
      },
    },
    vjClipLauncher: {
      numLayers: 2, numColumns: 2, activeBlockId: 'main',
      blocks: [{ id: 'main', name: 'Main', clipGrid: [[clip('A'), clip('B')], [clip('C'), null]] }],
      layerStates: [
        { opacity: 1, blendMode: 'normal', effects: [], activeColumn: null, activeClip: null },
        { opacity: 1, blendMode: 'normal', effects: [], activeColumn: null, activeClip: null },
      ],
    },
  };
}

const presetLayer = (presetId: string, layerId: string) =>
  get(layers.project).vjMode!.compositions.find((c) => c.id === presetId)!.layers.find((l) => l.id === layerId)!;

describe('shared map surfaces', () => {
  it('migrates an older project into shared surfaces without moving any preset', () => {
    expect(layers.project.importProject(oldProject())).toBe(true);
    const project = get(layers.project);
    expect(project.mapSurfaces!.map((s) => s.id)).toEqual(['left', 'right']);
    expect(project.mapSurfaces!.find((s) => s.id === 'left')!.geometry.corners).toEqual(box(0.1, 0.1, 0.4, 0.6));
    expect(presetLayer('A', 'left')).toMatchObject({ surfaceId: 'left' });
    expect(presetLayer('A', 'left').surfaceDetached).toBeUndefined();
    // B disagreed with the others, so it keeps its own copy.
    expect(presetLayer('B', 'left')).toMatchObject({ surfaceId: 'left', surfaceDetached: true, corners: box(0.12, 0.08, 0.41, 0.63) });
    expect(presetLayer('B', 'right').surfaceDetached).toBeUndefined();

    // The upgrade is saved, and a saved project is not migrated again.
    const saved = JSON.parse(JSON.stringify(layers.project.exportProject()));
    expect(saved.project.mapSurfaces).toHaveLength(2);
    expect(saved.project.vjMode.compositions[1].layers[0]).toMatchObject({ surfaceId: 'left', surfaceDetached: true });
    expect(layers.project.importProject(saved)).toBe(true);
    expect(get(layers.project).mapSurfaces).toEqual(project.mapSurfaces);
    expect(presetLayer('B', 'left').surfaceDetached).toBe(true);
  });

  it('saves presets as references and loads them with the current shared geometry', () => {
    expect(layers.project.importProject(oldProject())).toBe(true);
    const moved = box(0.2, 0.2, 0.3, 0.3);
    layers.project.update((p) => ({ ...p, layers: p.layers.map((l) => l.id === 'right' ? { ...l, corners: moved } : l) }));
    const id = layers.project.saveComposition('D');
    const saved = get(layers.project).vjMode!.compositions.find((c) => c.id === id)!;
    expect(saved.layers.map((l) => l.surfaceId)).toEqual(['left', 'right']);
    // Loading an older preset picks up the edit made since it was saved.
    layers.project.loadComposition('A');
    expect(get(layers.project).layers.find((l) => l.id === 'right')!.corners).toEqual(moved);
    // ...but a detached copy stays where it was.
    layers.project.loadComposition('B');
    expect(get(layers.project).layers.find((l) => l.id === 'left')!.corners).toEqual(box(0.12, 0.08, 0.41, 0.63));
  });

  it('detaches, shares and re-uses a surface on request', () => {
    expect(layers.project.importProject(oldProject())).toBe(true);
    const current = () => get(layers.project);
    const stored = (id: string) => current().mapSurfaces!.find((s) => s.id === id)!.geometry.corners;
    layers.project.setLayerSurfaceSharing('left', 'detach');
    const own = box(0.3, 0.3, 0.35, 0.35);
    layers.project.update((p) => ({ ...p, layers: p.layers.map((l) => l.id === 'left' ? { ...l, corners: own } : l) }));
    layers.project.saveComposition('Detached');
    // The detached edit stayed out of the shared map.
    expect(stored('left')).toEqual(box(0.1, 0.1, 0.4, 0.6));
    layers.project.setLayerSurfaceSharing('left', 'use');
    expect(current().layers.find((l) => l.id === 'left')).toMatchObject({ corners: box(0.1, 0.1, 0.4, 0.6) });
    expect(current().layers.find((l) => l.id === 'left')!.surfaceDetached).toBeFalsy();
    layers.project.setLayerSurfaceSharing('left', 'detach');
    layers.project.update((p) => ({ ...p, layers: p.layers.map((l) => l.id === 'left' ? { ...l, corners: own } : l) }));
    layers.project.setLayerSurfaceSharing('left', 'share');
    expect(stored('left')).toEqual(own);
  });
});
