/**
 * Painted masks on the editor side: the compact stroke encoding the core
 * decodes, the canvas -> content-space map the brush paints through, one
 * undo step per stroke, and the project round trip.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import type { Layer, PaintMaskStroke, Project } from '../types';
import {
  brushRadiusInContent, canvasToLayerContent, decodePaintPoints, encodePaintPoints, migratePaintMask,
} from '../utils/paintMask';
import { createMeshGrid, createDefaultCorners } from '../types';
import { evaluateMeshGrid } from '../utils/meshWarp';

let layers: typeof import('./layers');
let history: typeof import('./history');
let hooks: typeof import('./historyHooks');

function installDomShim(): void {
  const storage = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, String(v)),
    removeItem: (k: string) => void storage.delete(k),
    clear: () => storage.clear(), key: () => null, length: 0,
  };
  const el = (): any => ({
    style: { setProperty() {}, removeProperty() {}, getPropertyValue: () => '' },
    dataset: {}, classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
    setAttribute() {}, removeAttribute() {}, getAttribute: () => null,
    appendChild: (c: any) => c, removeChild: (c: any) => c,
    addEventListener() {}, removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
    load() {}, play: () => Promise.resolve(), pause() {},
  });
  (globalThis as any).document = {
    documentElement: el(), body: el(), head: el(), createElement: () => el(),
    querySelector: () => null, querySelectorAll: () => [], getElementById: () => null,
    addEventListener() {}, removeEventListener() {}, visibilityState: 'visible',
  };
  (globalThis as any).window = globalThis;
  (globalThis as any).dispatchEvent = () => true;
  (globalThis as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  (globalThis as any).requestAnimationFrame = (cb: (t: number) => void) => setTimeout(() => cb(Date.now()), 0);
  (globalThis as any).cancelAnimationFrame = (id: number) => clearTimeout(id as never);
}

beforeAll(async () => {
  installDomShim();
  layers = await import('./layers');
  history = await import('./history');
  hooks = await import('./historyHooks');
});

function stroke(id: string, points = [{ x: 0.5, y: 0.5 }], mode: 'erase' | 'restore' = 'erase'): PaintMaskStroke {
  return { id, mode, rx: 0.05, ry: 0.08, softness: 0.3, opacity: 1, points: encodePaintPoints(points) };
}

describe('stroke encoding', () => {
  it('round-trips content points within a 65535th of the range', () => {
    const pts = [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0.3217, y: 0.9 }, { x: -0.2, y: 1.2 }];
    const back = decodePaintPoints(encodePaintPoints(pts));
    back.forEach((p, i) => {
      expect(p.x).toBeCloseTo(pts[i].x, 4);
      expect(p.y).toBeCloseTo(pts[i].y, 4);
    });
  });

  it('writes little-endian uint16 pairs over -0.25..1.25, as paint_mask.rs reads them', () => {
    expect(Array.from(atob(encodePaintPoints([{ x: -0.25, y: 1.25 }])), (c) => c.charCodeAt(0))).toEqual([0, 0, 255, 255]);
  });

  it('keeps a long stroke compact', () => {
    const pts = Array.from({ length: 200 }, (_, i) => ({ x: i / 199, y: 0.5 }));
    expect(encodePaintPoints(pts).length).toBeLessThan(1100);
  });
});

describe('content space', () => {
  const base = { warpMode: 'corners' as const, meshGrid: null };

  it('maps the canvas (y up) to content (y down) for an unwarped full-frame layer', () => {
    const c = canvasToLayerContent({ ...base, corners: createDefaultCorners() }, { x: 0.25, y: 0.75 })!;
    expect(c.x).toBeCloseTo(0.25, 6);
    expect(c.y).toBeCloseTo(0.25, 6);
  });

  it('follows a corner pin: each pinned corner is the matching content corner', () => {
    const corners = { topLeft: { x: 0.1, y: 0.95 }, topRight: { x: 0.8, y: 0.9 }, bottomRight: { x: 0.9, y: 0.05 }, bottomLeft: { x: 0.2, y: 0.2 } };
    const layer = { ...base, corners };
    const at = (p: { x: number; y: number }) => canvasToLayerContent(layer, p)!;
    expect(at(corners.topLeft)).toMatchObject({ x: expect.closeTo(0, 5), y: expect.closeTo(0, 5) });
    expect(at(corners.bottomRight)).toMatchObject({ x: expect.closeTo(1, 5), y: expect.closeTo(1, 5) });
    expect(at(corners.bottomLeft)).toMatchObject({ x: expect.closeTo(0, 5), y: expect.closeTo(1, 5) });
  });

  it('inverts a mesh warp, so the same content point is found after the warp', () => {
    const grid = createMeshGrid(3, 3);
    grid.points[1][1] = { x: 0.62, y: 0.41 };
    const layer = { corners: createDefaultCorners(), warpMode: 'mesh' as const, meshGrid: grid };
    // Content (0.5, 0.5) sits where the mesh moved its centre.
    const warped = evaluateMeshGrid(grid, 0.5, 0.5);
    const c = canvasToLayerContent(layer, warped)!;
    expect(c.x).toBeCloseTo(0.5, 4);
    expect(c.y).toBeCloseTo(0.5, 4);
  });

  it('sizes the brush from project pixels into content units per axis', () => {
    const r = brushRadiusInContent({ ...base, corners: createDefaultCorners() }, { x: 0.5, y: 0.5 }, 54, 1920, 1080)!;
    expect(r.rx).toBeCloseTo(54 / 1920, 5);
    expect(r.ry).toBeCloseTo(54 / 1080, 5);
    // Squash the layer to half width: the same on-screen brush covers twice the content.
    const half = { ...base, corners: { topLeft: { x: 0.25, y: 1 }, topRight: { x: 0.75, y: 1 }, bottomRight: { x: 0.75, y: 0 }, bottomLeft: { x: 0.25, y: 0 } } };
    expect(brushRadiusInContent(half, { x: 0.5, y: 0.5 }, 54, 1920, 1080)!.rx).toBeCloseTo(2 * 54 / 1920, 5);
  });
});

describe('painted-mask store', () => {
  let live: Project;
  const record = () => history.history.record(live);
  const layer = (): Layer => get(layers.project).layers.find((l) => l.id === 'L')!;
  const undo = () => {
    const step = history.history.undo(get(layers.project));
    if (step) layers.project.set(step.project);
  };

  beforeEach(() => {
    const payload: any = {
      version: '2.0.8',
      project: { id: 'p', name: 'P', width: 1920, height: 1080, layers: [{ id: 'L', name: 'Speakers', type: 'color' }] },
    };
    expect(layers.project.importProject(payload)).toBe(true);
    history.history.clear();
    live = get(layers.project);
    history.history.init(live);
    hooks.setHistoryCallback(() => { live = get(layers.project); record(); });
  });

  it('records one undo step per stroke, and undo steps back one stroke at a time', () => {
    layers.project.addPaintMaskStroke('L', stroke('a'));
    layers.project.addPaintMaskStroke('L', stroke('b'));
    layers.project.addPaintMaskStroke('L', stroke('c'));
    expect(layer().paintMask!.strokes.map((s) => s.id)).toEqual(['a', 'b', 'c']);
    undo();
    expect(layer().paintMask!.strokes.map((s) => s.id)).toEqual(['a', 'b']);
    undo();
    expect(layer().paintMask!.strokes.map((s) => s.id)).toEqual(['a']);
    undo();
    expect(layer().paintMask?.strokes ?? []).toEqual([]);
  });

  it('ignores a repeated stroke id and a locked layer', () => {
    layers.project.addPaintMaskStroke('L', stroke('a'));
    layers.project.addPaintMaskStroke('L', stroke('a'));
    expect(layer().paintMask!.strokes).toHaveLength(1);
    layers.project.update((p) => ({ ...p, layers: p.layers.map((l) => ({ ...l, locked: true })) }));
    layers.project.addPaintMaskStroke('L', stroke('b'));
    expect(layer().paintMask!.strokes).toHaveLength(1);
  });

  it('clear, show/hide and invert are each one undoable step', () => {
    layers.project.addPaintMaskStroke('L', stroke('a'));
    layers.project.clearPaintMask('L');
    expect(layer().paintMask!.strokes).toEqual([]);
    undo();
    expect(layer().paintMask!.strokes.map((s) => s.id)).toEqual(['a']);
    layers.project.setPaintMaskVisible('L', false);
    layers.project.togglePaintMaskInvert('L');
    expect(layer().paintMask).toMatchObject({ enabled: false, inverted: true });
    undo();
    expect(layer().paintMask).toMatchObject({ enabled: false, inverted: false });
  });

  it('survives a project save and reload', () => {
    layers.project.addPaintMaskStroke('L', stroke('a', [{ x: 0.1, y: 0.2 }, { x: 0.4, y: 0.6 }]));
    layers.project.addPaintMaskStroke('L', stroke('b', [{ x: 0.5, y: 0.5 }], 'restore'));
    layers.project.togglePaintMaskInvert('L');
    const saved = JSON.parse(JSON.stringify(layers.project.exportProject()));
    expect(layers.project.importProject(saved)).toBe(true);
    const mask = layer().paintMask!;
    expect(mask.inverted).toBe(true);
    expect(mask.strokes.map((s) => [s.id, s.mode])).toEqual([['a', 'erase'], ['b', 'restore']]);
    expect(decodePaintPoints(mask.strokes[0].points)[1].x).toBeCloseTo(0.4, 4);
  });
});

describe('migratePaintMask', () => {
  it('drops strokes that cannot render and clamps the brush', () => {
    const m = migratePaintMask({
      inverted: true,
      strokes: [
        { id: 'ok', mode: 'restore', rx: 0.1, ry: 0.1, softness: 7, opacity: -2, points: encodePaintPoints([{ x: 0.5, y: 0.5 }]) },
        { id: 'ok', rx: 0.1, ry: 0.1, points: encodePaintPoints([{ x: 0.5, y: 0.5 }]) },
        { id: 'no-points', rx: 0.1, ry: 0.1, points: '' },
        { id: 'bad-radius', rx: 0, ry: 0.1, points: encodePaintPoints([{ x: 0, y: 0 }]) },
        'junk',
      ],
    })!;
    expect(m).toMatchObject({ enabled: true, inverted: true });
    expect(m.strokes).toHaveLength(1);
    expect(m.strokes[0]).toMatchObject({ id: 'ok', mode: 'restore', softness: 1, opacity: 0 });
    expect(migratePaintMask(undefined)).toBeNull();
  });
});
