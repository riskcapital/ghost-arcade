/**
 * Music motion on a mapping layer: its values move every frame, so they go
 * to a per-frame override map the frame sync reads, never into the project
 * store. Nothing that watches the project wakes up for them, and the saved
 * project keeps the layer's own values.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

vi.mock('./visualAudio', async (original) => {
  const actual = await original<typeof import('./visualAudio')>();
  let n = 0;
  return {
    ...actual,
    getVisualAudioSnapshot: () => {
      n += 1;
      const beat = n % 8 === 0;
      return { ...actual.getVisualAudioSnapshot(), isActive: true, level: 0.6, energy: 0.6, bassFast: beat ? 1 : 0.1, high: 0.3 };
    },
  };
});

let layers: typeof import('../stores/layers');
let engine: typeof import('./musicMotionEngine');

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
  (globalThis as any).requestAnimationFrame = () => 0;
  (globalThis as any).cancelAnimationFrame = () => {};
}

beforeAll(async () => {
  installDomShim();
  layers = await import('../stores/layers');
  engine = await import('./musicMotionEngine');
});

const inputs = [
  { NAME: 'speed', TYPE: 'float', DEFAULT: 0.5, MIN: 0, MAX: 1 },
  { NAME: 'glow', TYPE: 'float', DEFAULT: 0.4, MIN: 0, MAX: 1 },
  { NAME: 'hue', TYPE: 'float', DEFAULT: 0.2, MIN: 0, MAX: 1 },
];

function shaderProject(on: boolean) {
  return {
    version: '2.1.12',
    project: {
      id: 'p', name: 'P', width: 1920, height: 1080,
      layers: [{
        id: 'shader-layer', name: 'Shader', type: 'media', visible: true, opacity: 1, blendMode: 'normal',
        corners: { topLeft: { x: 0, y: 1 }, topRight: { x: 1, y: 1 }, bottomLeft: { x: 0, y: 0 }, bottomRight: { x: 1, y: 0 } },
        effects: [],
        source: {
          id: 'src-shader', type: 'shader', name: 'Shader', src: '',
          shaderCode: '/*{"INPUTS":[]}*/ void main(){ gl_FragColor = vec4(1.0); }',
          shaderInputs: inputs,
          shaderValues: { speed: 0.5, glow: 0.4, hue: 0.2 },
          musicMotion: { on, amount: 1, params: ['speed', 'glow', 'hue'] },
        },
      }],
    },
  };
}

describe('music motion on a mapping layer', () => {
  it('drives the layer through the override map with zero project publishes per frame', async () => {
    expect(layers.project.importProject(shaderProject(true) as any)).toBe(true);
    const stored = structuredClone(get(layers.project).layers[0].source!.shaderValues);
    let publishes = 0;
    const stop = layers.project.subscribe(() => { publishes += 1; });
    publishes = 0;
    const seen: number[] = [];
    for (let i = 0; i <= 120; i++) {
      engine.stepMusicMotionForTest(1000 + i * (1000 / 60));
      const o = engine.musicMotionValuesFor(get(layers.project).layers[0]);
      if (i > 0) {
        expect(o).toBeDefined();
        expect(Object.keys(o!).sort()).toEqual(['shader:glow', 'shader:hue', 'shader:speed']);
        seen.push(o!['shader:speed']);
      }
    }
    // A Timeline copy showing the layer's shader follows it; one showing another source does not.
    const layer = get(layers.project).layers[0];
    expect(engine.musicMotionValuesFor({ ...layer, id: 'showtrack::shader-layer' })).toEqual(engine.musicMotionValuesFor(layer));
    expect(engine.musicMotionValuesFor({ ...layer, source: { ...layer.source!, id: 'clip-src' } })).toBeUndefined();
    // The frame sync puts them on over the stored values.
    const { NativeRendererSync } = await import('../sync/nativeRendererSync');
    const sent = (new NativeRendererSync() as any).applyTimelineOverrides(get(layers.project).layers);
    expect(sent[0].source.shaderValues.speed).toBe(engine.musicMotionValuesFor(layer)!['shader:speed']);
    expect(get(layers.project).layers[0].source!.shaderValues).toEqual(stored);
    // The music moved the values, and the project heard nothing of it.
    expect(new Set(seen.map((v) => v.toFixed(4))).size).toBeGreaterThan(5);
    expect(publishes).toBe(0);
    expect(get(layers.project).layers[0].source!.shaderValues).toEqual(stored);

    // A value set by the user becomes the base the music moves.
    layers.project.batchUpdateLayerShaderValues('shader-layer', { speed: 0.9 });
    publishes = 0;
    engine.stepMusicMotionForTest(1000 + 121 * (1000 / 60));
    expect(publishes).toBe(0);
    expect(get(layers.project).layers[0].source!.shaderValues!.speed).toBe(0.9);

    // Off: the overrides are gone and the stored values were never touched.
    const off = get(layers.project).layers.map((l) => ({ ...l, source: { ...l.source!, musicMotion: { on: false, amount: 1 } } }));
    layers.project.update((p) => ({ ...p, layers: off as any }));
    publishes = 0;
    engine.stepMusicMotionForTest(1000 + 122 * (1000 / 60));
    engine.stepMusicMotionForTest(1000 + 123 * (1000 / 60));
    expect(engine.musicMotionLayerOverrides().size).toBe(0);
    expect(publishes).toBe(0);
    expect(get(layers.project).layers[0].source!.shaderValues).toEqual({ ...stored, speed: 0.9 });
    stop();
  });
});
