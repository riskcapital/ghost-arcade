/**
 * A sketch saved in the sketch editor reaches every copy of it: the layers
 * on screen, saved compositions, VJ-mode compositions, stage presets and VJ
 * clips, without reloading anything.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import type { JSAnimationSource, Layer, MediaSource } from '../types';
import type { VJClip } from './vjClipLauncher';

let layers: typeof import('./layers');
let types: typeof import('../types');
let launcher: typeof import('./vjClipLauncher');

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
  });
  (globalThis as any).document = {
    documentElement: makeEl(), body: makeEl(), head: makeEl(),
    createElement: () => makeEl(),
    querySelector: () => null, querySelectorAll: () => [], getElementById: () => null,
    addEventListener() {}, removeEventListener() {},
    visibilityState: 'visible',
  };
  (globalThis as any).window = globalThis;
  (globalThis as any).dispatchEvent = () => true;
  (globalThis as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  (globalThis as any).requestAnimationFrame = (cb: (t: number) => void) => setTimeout(() => cb(Date.now()), 0) as unknown as number;
  (globalThis as any).cancelAnimationFrame = (id: number) => clearTimeout(id as never);
}

const before: JSAnimationSource = { animationType: 'p5js', htmlCode: '<script>function draw() { circle(0, 0, 10); }</script>' };
const after: JSAnimationSource = { animationType: 'p5js', htmlCode: '<script>function draw() { circle(0, 0, 20); }</script>' };
const other: JSAnimationSource = { animationType: 'p5js', htmlCode: '<script>function draw() { square(0, 0, 10); }</script>' };

const swap = (js: JSAnimationSource | undefined) => (js?.htmlCode === before.htmlCode ? after : null);

function sketchLayer(id: string, jsAnimation: JSAnimationSource): Layer {
  const layer = types.createLayer(id, id, 'media');
  const source: MediaSource = { id: `item-${id}`, type: 'p5js', src: 'js-animation', name: id, jsAnimation };
  layer.source = source;
  return layer;
}

describe('saving a sketch everywhere it lives', () => {
  beforeAll(async () => {
    installDomShim();
    types = await import('../types');
    layers = await import('./layers');
    launcher = await import('./vjClipLauncher');
  });

  it('updates the layers on screen, saved compositions, VJ compositions and stage presets', () => {
    const project = get(layers.project);
    const composition = (id: string, list: Layer[]) => ({ id, name: id, createdAt: 0, layers: list });
    layers.project.set({
      ...project,
      layers: [sketchLayer('a', before), sketchLayer('b', other)],
      compositions: [composition('saved', [sketchLayer('c', before)])],
      vjMode: { ...(project.vjMode ?? { enabled: false, decks: [], timeline: {} as any, activeCompositionId: null, masterOpacity: 1 }), compositions: [composition('vj', [sketchLayer('d', before)])] },
      stagePresets: [{ id: 'stage', name: 'stage', createdAt: 0, layers: [sketchLayer('e', before)] }],
    });

    expect(layers.project.replaceSketchSources((source) => {
      const next = swap(source.jsAnimation);
      return next ? { ...source, jsAnimation: next } : null;
    }, { history: false })).toBe(true);

    const saved = get(layers.project);
    expect(saved.layers.map((l) => l.source?.jsAnimation)).toEqual([after, other]);
    expect(saved.compositions?.[0].layers[0].source?.jsAnimation).toBe(after);
    expect(saved.vjMode?.compositions[0].layers[0].source?.jsAnimation).toBe(after);
    expect(saved.stagePresets?.[0].layers[0].source?.jsAnimation).toBe(after);
  });

  it('leaves the project as it was when no layer holds the sketch', () => {
    const project = get(layers.project);
    expect(layers.project.replaceSketchSources(() => null, { history: false })).toBe(false);
    expect(get(layers.project)).toBe(project);
  });

  it('updates VJ clips in every grid, keeping a playing clip the same object as its cell', () => {
    const { vjClipLauncher } = launcher;
    const clip = (id: string, jsAnimation: JSAnimationSource): VJClip => ({ id, name: id, type: 'p5js', src: '', jsAnimation });
    const playing = clip('playing', before);
    const state = get(vjClipLauncher);
    const grid = state.clipGrid.map((row) => row.map(() => null as VJClip | null));
    grid[0][0] = playing;
    grid[0][1] = clip('untouched', other);
    const bankB = state.bankBClipGrid.map((row) => row.map(() => null as VJClip | null));
    bankB[0][0] = clip('bank-b', before);
    vjClipLauncher.set({
      ...state,
      clipGrid: grid,
      bankBClipGrid: bankB,
      layerStates: state.layerStates.map((row, i) => (i === 0 ? { ...row, activeClip: playing } : row)),
      blocks: state.blocks.map((block) => (block.id === state.activeBlockId ? { ...block, clipGrid: grid, bankBClipGrid: bankB } : block)),
    });

    expect(vjClipLauncher.replaceClipSketches((c) => {
      const next = swap(c.jsAnimation);
      return next ? { ...c, jsAnimation: next } : null;
    })).toBe(true);

    const saved = get(vjClipLauncher);
    expect(saved.clipGrid[0][0]?.jsAnimation).toBe(after);
    expect(saved.layerStates[0].activeClip).toBe(saved.clipGrid[0][0]);
    expect(saved.clipGrid[0][1]?.jsAnimation).toBe(other);
    expect(saved.bankBClipGrid[0][0]?.jsAnimation).toBe(after);
    const block = saved.blocks.find((b) => b.id === saved.activeBlockId)!;
    expect(block.clipGrid[0][0]).toBe(saved.clipGrid[0][0]);
    expect(block.bankBClipGrid?.[0][0]?.jsAnimation).toBe(after);

    expect(vjClipLauncher.replaceClipSketches(() => null)).toBe(false);
    expect(get(vjClipLauncher)).toBe(saved);
  });
});
