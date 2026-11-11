/**
 * Piece groups from a mapping: synthetic layouts (a grid of touching tiles,
 * spaced pieces, a big piece among small ones, named cube faces) and the
 * Fragmented Cube Wall as Map Sim's auto-map lays it out.
 */
import { get } from 'svelte/store';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Layer } from '../../types';
import { faceOf, groupCount, groupOrders, pieceGroups, setsSplitNeighbours, GROUP_ORDER_IDS } from './pieceGroups';
import { computeSpatialOrder, pieceSpots } from '../where/spatialOrder';

/** A quad piece; x/y in output 0..1, y down (converted to the layer's y-up corners). */
function quad(id: string, x0: number, y0: number, x1: number, y1: number, name = id): Layer {
  return {
    id, name, type: 'media', visible: true, opacity: 1, blendMode: 'normal', source: null, edgeEffects: null, parentGroupId: null, layerShape: null,
    corners: { topLeft: { x: x0, y: 1 - y0 }, topRight: { x: x1, y: 1 - y0 }, bottomRight: { x: x1, y: 1 - y1 }, bottomLeft: { x: x0, y: 1 - y1 } },
  } as unknown as Layer;
}

function grid(cols: number, rows: number, gap = 0): Layer[] {
  const out: Layer[] = [];
  const w = 1 / cols;
  const h = 1 / rows;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out.push(quad(`r${r}c${c}`, c * w + gap, r * h + gap, (c + 1) * w - gap, (r + 1) * h - gap));
  return out;
}

describe('piece groups on synthetic layouts', () => {
  it('a 4×3 grid of touching tiles: rows, columns, a true checkerboard, the middle as hero, all fronts', () => {
    const g = pieceGroups(grid(4, 3));
    expect(g.rows).toEqual([['r0c0', 'r0c1', 'r0c2', 'r0c3'], ['r1c0', 'r1c1', 'r1c2', 'r1c3'], ['r2c0', 'r2c1', 'r2c2', 'r2c3']]);
    expect(g.columns).toHaveLength(4);
    expect(g.columns[0]).toEqual(['r0c0', 'r1c0', 'r2c0']);
    expect(g.how.sets).toBe('neighbours');
    expect(g.setA).toHaveLength(6);
    expect(g.setB).toHaveLength(6);
    // Edge neighbours always differ (corner touches count as neighbours too, so not every pair can).
    const inA = new Set(g.setA);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) expect(inA.has(`r${r}c${c}`)).not.toBe(inA.has(`r${r}c${c + 1}`));
    for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) expect(inA.has(`r${r}c${c}`)).not.toBe(inA.has(`r${r + 1}c${c}`));
    expect(g.hero).toHaveLength(1);
    expect(['r1c1', 'r1c2']).toContain(g.hero[0]);
    expect(g.faces.front).toHaveLength(12);
    expect(g.how.faces).toBe('shape');
  });

  it('spaced pieces that never touch: every other piece left → right', () => {
    const spaced = [quad('a', 0.0, 0.4, 0.1, 0.6), quad('b', 0.3, 0.4, 0.4, 0.6), quad('c', 0.6, 0.4, 0.7, 0.6), quad('d', 0.85, 0.4, 0.95, 0.6)];
    const g = pieceGroups(spaced);
    expect(g.how.sets).toBe('order');
    expect(g.setA).toEqual(['a', 'c']);
    expect(g.setB).toEqual(['b', 'd']);
    expect(g.rows).toEqual([['a', 'b', 'c', 'd']]);
  });

  it('a big screen among small tiles is the hero', () => {
    const layers = [...grid(6, 4, 0.01).filter((l) => !['r1c2', 'r1c3', 'r2c2', 'r2c3'].includes(l.id)), quad('screen', 2 / 6, 1 / 4, 4 / 6, 3 / 4)];
    const g = pieceGroups(layers);
    expect(g.hero).toEqual(['screen']);
  });

  it('faces: names from auto-map win, else the quad shape', () => {
    expect(faceOf('Fragment cube 1.2 · Top', [])).toBe('top');
    expect(faceOf('Box · Right', [])).toBe('right');
    // A level-topped, leaning quad (a top face seen from the front): top.
    expect(faceOf('', [{ x: 0.2, y: 0.4 }, { x: 0.4, y: 0.4 }, { x: 0.38, y: 0.45 }, { x: 0.18, y: 0.45 }])).toBe('top');
    // Upright sides, sloping top: a side.
    expect(faceOf('', [{ x: 0.5, y: 0.4 }, { x: 0.55, y: 0.42 }, { x: 0.55, y: 0.62 }, { x: 0.5, y: 0.6 }])).toBe('left');
    expect(faceOf('', [{ x: 0.5, y: 0.42 }, { x: 0.55, y: 0.4 }, { x: 0.55, y: 0.6 }, { x: 0.5, y: 0.62 }])).toBe('right');
    expect(faceOf('', [{ x: 0.1, y: 0.1 }, { x: 0.3, y: 0.1 }, { x: 0.3, y: 0.3 }, { x: 0.1, y: 0.3 }])).toBe('front');
  });

  it('keeps the groups as named orders: sets light together, rows sweep band by band', () => {
    const layers = grid(4, 3);
    const g = pieceGroups(layers);
    const orders = groupOrders(g);
    const sets = orders.find((o) => o.id === GROUP_ORDER_IDS.sets)!;
    expect(sets.slots).toEqual([g.setA, g.setB]);
    const rows = orders.find((o) => o.id === GROUP_ORDER_IDS.rows)!;
    expect(computeSpatialOrder(pieceSpots(layers), rows).slots).toEqual(g.rows);
    expect(orders.map((o) => o.name)).toContain('✦ Hero');
    expect(groupCount(g)).toBeGreaterThanOrEqual(5);
    // Deterministic.
    expect(pieceGroups(layers)).toEqual(g);
  });
});

describe('the Fragmented Cube Wall, auto-mapped', () => {
  let layers: Layer[] = [];
  beforeAll(async () => {
    const storage = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v), removeItem: (k: string) => storage.delete(k), clear: () => storage.clear() },
    });
    Object.defineProperty(globalThis, 'document', { configurable: true, value: { documentElement: { style: { setProperty: () => {} } } } });
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { addEventListener: () => {}, removeEventListener: () => {}, matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }) },
    });
    const { project } = await import('../../stores/layers');
    const { autoMapProjectionSim } = await import('../../projectionSim/autoMap');
    const { buildProjectionSimPreset } = await import('../../projectionSim/presets');
    const scene = buildProjectionSimPreset('isam-cubes')!;
    await autoMapProjectionSim(scene);
    layers = get(project).layers as Layer[];
  });

  it('finds the central screen as hero, a dozen-odd rows, faces by name and two balanced sets that split most neighbours', () => {
    expect(layers.length).toBeGreaterThan(60);
    const g = pieceGroups(layers);
    const name = (id: string) => layers.find((l) => l.id === id)!.name;
    expect(g.hero.map(name).some((n) => /Central screen face/.test(n))).toBe(true);
    expect(g.how.faces).toBe('names');
    expect(g.faces.front.length).toBeGreaterThan(20);
    expect(g.faces.top.length + g.faces.left.length + g.faces.right.length).toBeGreaterThan(10);
    expect(g.rows.length).toBeGreaterThanOrEqual(5);
    expect(g.columns.length).toBeGreaterThanOrEqual(6);
    expect(g.rows.flat().sort()).toEqual(g.pieces.map((p) => p.id).sort());
    expect(g.how.sets).toBe('neighbours');
    expect(Math.abs(g.setA.length - g.setB.length)).toBeLessThanOrEqual(Math.ceil(g.pieces.length * 0.2));
    // Most touching pairs end up in different sets.
    expect(setsSplitNeighbours(g)).toBeGreaterThan(0.6);
  });
});
