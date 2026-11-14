/**
 * A shader slider in the media tray writes through the store: a new source
 * each time (never the stored values in place), and a drag is one undo step.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';

let layers: typeof import('./layers');
let hooks: typeof import('./historyHooks');
let historyModule: typeof import('./history');
let keyframes: typeof import('./keyframeTimeline');
let settingsModule: typeof import('./settings');

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
  // Frames run only when the test steps the engine.
  (globalThis as any).requestAnimationFrame = () => 0;
  (globalThis as any).cancelAnimationFrame = () => {};
}

beforeAll(async () => {
  installDomShim();
  layers = await import('./layers');
  hooks = await import('./historyHooks');
  historyModule = await import('./history');
  keyframes = await import('./keyframeTimeline');
  settingsModule = await import('./settings');
});

type Captured = { project: any; keyframes: unknown; output: any };
const capture = (): Captured => ({ project: get(layers.project), keyframes: keyframes.keyframeTimeline.exportAll(), output: settingsModule.settings.captureOutputHistory() });
const commit = (c: unknown) => {
  const s = c as Captured;
  historyModule.history.record(s.project, s.keyframes, s.output);
};
const steps = () => get(historyModule.history).past.length;
const glow = () => get(layers.project).layers[0].source!.shaderValues!.glow;
function undo() {
  hooks.flushPendingHistorySnapshot();
  const step = historyModule.history.undo(get(layers.project));
  if (step) layers.project.set(step.project);
}

beforeEach(() => {
  hooks.setHistoryCallback(() => commit(capture()), { capture, commit });
  expect(layers.project.importProject({
    version: '2.1.12',
    project: {
      id: 'tray', name: 'Tray', width: 1920, height: 1080,
      layers: [{
        id: 'map-1', name: 'Shader', type: 'media', visible: true, opacity: 1, blendMode: 'normal',
        corners: { topLeft: { x: 0, y: 1 }, topRight: { x: 1, y: 1 }, bottomLeft: { x: 0, y: 0 }, bottomRight: { x: 1, y: 0 } },
        effects: [],
        source: { id: 'src-1', type: 'shader', name: 'Shader', src: '', shaderCode: '/*{"INPUTS":[]}*/ void main(){ gl_FragColor = vec4(1.0); }', shaderValues: { glow: 0.2, speed: 0.5 } },
      }],
    },
  } as any)).toBe(true);
  hooks.cancelPendingHistorySnapshot();
  const s = capture();
  historyModule.history.init(s.project, s.keyframes, s.output);
});

describe('media tray shader slider', () => {
  it('a drag is one undo step, the stored values are never written in place, and undo puts the value back', () => {
    const stored = get(layers.project).layers[0].source!.shaderValues!;
    for (let i = 1; i <= 20; i++) layers.project.setLayerShaderValue('map-1', 'glow', 0.2 + i * 0.01);
    expect(stored.glow).toBe(0.2);
    expect(glow()).toBeCloseTo(0.4);
    hooks.flushPendingHistorySnapshot();
    expect(steps()).toBe(1);
    undo();
    expect(glow()).toBe(0.2);
    expect(get(layers.project).layers[0].source!.shaderValues!.speed).toBe(0.5);
  });

  it('a layer without shader values is left alone', () => {
    const before = get(layers.project);
    layers.project.setLayerShaderValue('nope', 'glow', 1);
    hooks.flushPendingHistorySnapshot();
    expect(steps()).toBe(0);
    expect(get(layers.project).layers).toEqual(before.layers);
  });
});
