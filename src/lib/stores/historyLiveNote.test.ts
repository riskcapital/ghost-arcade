/**
 * Live control notes the state it left (so the next undo step folds it in)
 * only when it changed something undoable. The engines (Auto, modulation,
 * Music motion) run inside live control every frame but write live values,
 * not the stores, so a playing Auto takes no history captures at all.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';

let layers: typeof import('./layers');
let hooks: typeof import('./historyHooks');
let historyModule: typeof import('./history');
let keyframes: typeof import('./keyframeTimeline');
let settingsModule: typeof import('./settings');
let auto: typeof import('../audio/autoEngine');
let live: typeof import('../audio/liveParams');

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
  auto = await import('../audio/autoEngine');
  live = await import('../audio/liveParams');
});

let captures = 0;
type Captured = { project: any; keyframes: unknown; output: any };
function capture(): Captured {
  captures += 1;
  return { project: get(layers.project), keyframes: keyframes.keyframeTimeline.exportAll(), output: settingsModule.settings.captureOutputHistory() };
}
function wire(withStamp: boolean) {
  hooks.setHistoryCallback(() => {
    const s = capture();
    historyModule.history.record(s.project, s.keyframes, s.output);
  }, {
    capture,
    commit: (c) => {
      const s = c as Captured;
      historyModule.history.record(s.project, s.keyframes, s.output);
    },
    amendTo: (c) => {
      const s = c as Captured;
      historyModule.history.amend(s.project, s.keyframes, s.output, { live: true });
    },
    // App.svelte's stamp: what capture reads, by reference.
    stamp: withStamp ? () => [get(layers.project), get(keyframes.keyframeTimeline), get(settingsModule.settings).output] : undefined,
  });
}

const sweep = { phase: 0.1, mode: 'loop' as const, speedHz: 0.5, min: 0, max: 1, playing: true };
function projectWithAuto() {
  return {
    version: '2.1.12',
    project: {
      id: 'note', name: 'Note', width: 1920, height: 1080,
      layers: [{
        id: 'map-1', name: 'Shader', type: 'media', visible: true, opacity: 1, blendMode: 'normal',
        corners: { topLeft: { x: 0, y: 1 }, topRight: { x: 1, y: 1 }, bottomLeft: { x: 0, y: 0 }, bottomRight: { x: 1, y: 0 } },
        effects: [{ id: 'fx-1', type: 'blur', enabled: true, params: { amount: 0.25 }, paramAuto: { amount: sweep } }],
        source: {
          id: 'src-1', type: 'shader', name: 'Shader', src: '',
          shaderCode: '/*{"INPUTS":[]}*/ void main(){ gl_FragColor = vec4(1.0); }',
          shaderValues: { speed: 0.5 },
          shaderValueAuto: { speed: { ...sweep, phase: 0.3 } },
        },
      }],
    },
  };
}

function playFrames(n: number) {
  for (let i = 0; i < n; i++) auto.stepAutoForTest(1000 + i * 16.7);
}

describe('live control notes its state only when it wrote something undoable', () => {
  beforeEach(() => {
    auto.stopAutoEngine();
    auto.resetAutoForTest();
    live.resetLiveValuesForTest();
    expect(layers.project.importProject(projectWithAuto() as any)).toBe(true);
    hooks.cancelPendingHistorySnapshot();
    const s = { project: get(layers.project), keyframes: keyframes.keyframeTimeline.exportAll(), output: settingsModule.settings.captureOutputHistory() };
    historyModule.history.init(s.project, s.keyframes, s.output);
  });
  afterEach(() => {
    hooks.setHistoryCallback(() => {});
  });

  it('takes no captures over 120 frames of a playing Auto (one per frame without the stamp)', () => {
    wire(false);
    captures = 0;
    playFrames(120);
    const without = captures;
    // The old behaviour, for the record: a capture at the end of every frame.
    expect(without).toBe(120);

    wire(true);
    captures = 0;
    playFrames(120);
    expect(captures).toBe(0);
    // Auto did play.
    expect(live.liveLayerValue('map-1', 'fx:fx-1:amount')).toBeDefined();
  });

  it('notes a block that wrote the project, once, and folds it into the next step', () => {
    wire(true);
    captures = 0;
    hooks.runAsLiveControl(() => layers.project.setLayerOpacity('map-1', 0.4));
    expect(captures).toBe(1);
    // Nested blocks count once, at the outermost end.
    hooks.runAsLiveControl(() => hooks.runAsLiveControl(() => layers.project.setLayerOpacity('map-1', 0.3)));
    expect(captures).toBe(2);
    // A block that wrote nothing takes no capture.
    hooks.runAsLiveControl(() => {});
    expect(captures).toBe(2);

    // An edit to something else, then undo: the live opacity stays.
    hooks.recordDiscreteAction();
    layers.project.updateLayer('map-1', { name: 'Renamed' });
    hooks.recordDiscreteAction();
    const step = historyModule.history.undo(get(layers.project));
    expect(step?.project.layers[0].opacity).toBe(0.3);
  });

  it('notes the one frame a paused Auto writes its value', () => {
    wire(true);
    playFrames(5);
    captures = 0;
    const amountAuto = get(layers.project).layers[0].effects[0].paramAuto!.amount;
    layers.project.setEffectParamAuto('map-1', 'fx-1', 'amount', { ...amountAuto, playing: false });
    hooks.cancelPendingHistorySnapshot();
    captures = 0;
    playFrames(30);
    expect(captures).toBe(1);
  });
});
