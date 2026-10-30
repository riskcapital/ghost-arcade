/**
 * A clip keeps playing when the performer browses to another block. Edits to
 * it then must be saved into the block it came from, so they are in the
 * project file and on screen when that block is shown again — not only in
 * the live deck, where the next block switch threw them away.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';

let layers: typeof import('./layers');
let launcher: typeof import('./vjClipLauncher');
let keyframes: typeof import('./keyframeTimeline');

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
    documentElement: makeEl(),
    body: makeEl(),
    head: makeEl(),
    createElement: () => makeEl(),
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null,
    addEventListener() {}, removeEventListener() {},
    visibilityState: 'visible',
  };
  (globalThis as any).window = globalThis;
  (globalThis as any).dispatchEvent = () => true;
  (globalThis as any).CustomEvent ??= class extends Event {
    detail: unknown;
    constructor(name: string, options: any) { super(name); this.detail = options.detail; }
  };
  (globalThis as any).matchMedia = () => ({
    matches: false,
    addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {},
  });
  (globalThis as any).requestAnimationFrame = (cb: (t: number) => void) =>
    setTimeout(() => cb(Date.now()), 0) as unknown as number;
  (globalThis as any).cancelAnimationFrame = (id: number) => clearTimeout(id as never);
}

beforeAll(async () => {
  installDomShim();
  layers = await import('./layers');
  launcher = await import('./vjClipLauncher');
  keyframes = await import('./keyframeTimeline');
});

// Triggers start the keyframe transport; stop it before the file ends.
afterAll(() => keyframes.keyframeTimeline.stop());

const shader = (id: string) => ({ id, type: 'shader', name: id, src: '', shaderCode: 'void main(){}', shaderValues: { a: 1 } });
const blur = (id: string) => ({ id, type: 'blur', enabled: true, opacity: 1, blendMode: 'normal', params: { radius: 2 } }) as any;
const layerState = { opacity: 1, blendMode: 'normal', effects: [], activeColumn: null, activeClip: null };

function twoBlockProject() {
  return {
    version: '2.0.8',
    project: { id: 'browse', name: 'Browse', width: 1920, height: 1080, layers: [] },
    vjClipLauncher: {
      numLayers: 2, numColumns: 2, activeBlockId: 'first',
      blocks: [
        { id: 'first', name: 'First', clipGrid: [[shader('a1'), null], [null, null]], bankBClipGrid: [[shader('b1'), null], [null, null]] },
        { id: 'second', name: 'Second', clipGrid: [[shader('a2'), null], [null, null]], bankBClipGrid: [[null, null], [null, null]] },
      ],
      layerStates: [layerState, layerState],
      bankBLayerStates: [layerState, layerState],
    },
  };
}

describe('editing a clip that plays from a block the user browsed away from', () => {
  it('saves the edit into that block and shows it there again', () => {
    const { vjClipLauncher, vjEditVersion } = launcher;
    expect(layers.project.importProject(twoBlockProject())).toBe(true);
    vjClipLauncher.triggerClipNow(0, 0);
    vjClipLauncher.triggerClipNow(0, 0, 'B');
    vjClipLauncher.setActiveBlock('second');
    expect(get(vjClipLauncher).layerStates[0].activeClip?.id).toBe('a1');
    const before = get(vjEditVersion);

    vjClipLauncher.updateActiveClipShaderValue(0, 'a', 0.25);
    vjClipLauncher.addActiveClipEffect(0, blur('fx-a'));
    vjClipLauncher.updateActiveClipShaderValue(0, 'a', 0.5, 'B');
    vjClipLauncher.setEffectChain('clip', [blur('fx-b')], 0, 'B');

    expect(get(vjEditVersion)).toBe(before + 4);
    // The shown block's cells are not touched.
    expect(get(vjClipLauncher).clipGrid[0][0]?.id).toBe('a2');
    expect(get(vjClipLauncher).clipGrid[0][0]?.shaderValues).toEqual({ a: 1 });

    const saved = JSON.parse(JSON.stringify(layers.project.exportProject()));
    const first = saved.vjClipLauncher.blocks.find((block: any) => block.id === 'first');
    expect(first.clipGrid[0][0].shaderValues).toEqual({ a: 0.25 });
    expect(first.clipGrid[0][0].effects.map((effect: any) => effect.id)).toEqual(['fx-a']);
    expect(first.bankBClipGrid[0][0].shaderValues).toEqual({ a: 0.5 });
    expect(first.bankBClipGrid[0][0].effects.map((effect: any) => effect.id)).toEqual(['fx-b']);

    vjClipLauncher.setActiveBlock('first');
    const state = get(vjClipLauncher);
    expect(state.clipGrid[0][0]?.shaderValues).toEqual({ a: 0.25 });
    expect(state.clipGrid[0][0]?.effects?.map(effect => effect.id)).toEqual(['fx-a']);
    expect(state.layerStates[0].activeColumn).toBe(0);
    expect(state.layerStates[0].activeClip?.shaderValues).toEqual({ a: 0.25 });
    expect(state.bankBClipGrid[0][0]?.shaderValues).toEqual({ a: 0.5 });
  });

  it('keeps an edit to a clip in no block live only', () => {
    const { vjClipLauncher } = launcher;
    expect(layers.project.importProject(twoBlockProject())).toBe(true);
    vjClipLauncher.launchTransientClip(1, shader('performer-pad') as any);
    const before = get(vjClipLauncher);
    vjClipLauncher.updateActiveClipShaderValue(1, 'a', 0.75);
    expect(get(vjClipLauncher).layerStates[1].activeClip?.shaderValues).toEqual({ a: 0.75 });
    expect(get(vjClipLauncher).blocks).toBe(before.blocks);
    expect(get(vjClipLauncher).clipGrid).toBe(before.clipGrid);
  });
});
