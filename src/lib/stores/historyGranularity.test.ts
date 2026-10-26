/**
 * Undo granularity: one undo takes back one thing.
 *
 * Users reported that Cmd/Ctrl+Z "undoes a lot of things". The causes pinned
 * here: most edits (sliders, dropdowns, toggles, mask and shape edits,
 * presets) recorded nothing, so the next recorded step swallowed them; a
 * slider edit was folded into whatever came next; live control (MIDI, show
 * fades) wrote undo steps or was reverted by them; and adding a layer took
 * two undos.
 *
 * The harness wires history exactly as App.svelte does.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

let layers: typeof import('./layers');
let types: typeof import('../types');
let historyModule: typeof import('./history');
let hooks: typeof import('./historyHooks');
let stageEffects: typeof import('./stageEffects');

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
  types = await import('../types');
  historyModule = await import('./history');
  hooks = await import('./historyHooks');
  stageEffects = await import('./stageEffects');
});

// ── App.svelte's wiring ────────────────────────────────────────────────
function resetHistory() {
  hooks.cancelPendingHistorySnapshot();
  historyModule.history.init(get(layers.project));
}
function wireHistory() {
  hooks.setHistoryCallback(() => historyModule.history.record(get(layers.project)), {
    capture: () => get(layers.project),
    commit: (captured) => historyModule.history.record(captured as any),
    amend: () => historyModule.history.amend(get(layers.project)),
  });
}
function apply(step: import('../types').Project | null) {
  if (!step) return false;
  layers.project.set(step);
  layers.project.setSelectedLayerIds(get(layers.selectedLayerIds));
  return true;
}
function undo() {
  hooks.flushPendingHistorySnapshot();
  return apply(historyModule.history.undo(get(layers.project)));
}
function redo() {
  hooks.flushPendingHistorySnapshot();
  return apply(historyModule.history.redo(get(layers.project)));
}
const steps = () => get(historyModule.history).past.length;
const layerById = (id: string) => get(layers.project).layers.find((l) => l.id === id);

function projectPayload(name: string, layerList: any[] = []) {
  return { version: '1.9.3', project: { id: name, name, width: 1920, height: 1080, layers: layerList } };
}

beforeEach(() => {
  wireHistory();
  expect(layers.project.importProject(projectPayload('start', [
    types.createLayer('a', 'A', 'color'),
    types.createLayer('b', 'B', 'color'),
  ]))).toBe(true);
  resetHistory();
});

afterEach(() => {
  vi.useRealTimers();
  hooks.cancelPendingHistorySnapshot();
  hooks.setHistoryCallback(() => {});
});

describe('a debounced edit is its own step', () => {
  it('records a layer edit made through updateLayer', () => {
    layers.project.updateLayer('a', { opacity: 0.4 });
    hooks.flushPendingHistorySnapshot();
    expect(steps()).toBe(1);
    undo();
    expect(layerById('a')!.opacity).toBe(1);
  });

  it('keeps an opacity change and an added layer apart', () => {
    vi.useFakeTimers();
    layers.project.updateLayer('a', { opacity: 0.4 });
    vi.advanceTimersByTime(200);
    layers.project.addColorLayer('New');
    vi.advanceTimersByTime(700);
    expect(steps()).toBe(2);

    undo();
    expect(get(layers.project).layers.map((l) => l.name)).not.toContain('New');
    expect(layerById('a')!.opacity).toBe(0.4);
    undo();
    expect(layerById('a')!.opacity).toBe(1);
  });

  it('coalesces a slider drag into one step, even with a pause in it', () => {
    vi.useFakeTimers();
    for (const value of [0.9, 0.8, 0.7, 0.6]) {
      layers.project.updateLayer('a', { opacity: value });
      vi.advanceTimersByTime(100);
    }
    vi.advanceTimersByTime(400); // holds still, still under the debounce
    layers.project.updateLayer('a', { opacity: 0.5 });
    vi.advanceTimersByTime(700);
    expect(steps()).toBe(1);
    undo();
    expect(layerById('a')!.opacity).toBe(1);
  });

  it('keeps a blend-mode change and the opacity drag after it apart', () => {
    vi.useFakeTimers();
    layers.project.updateLayer('a', { blendMode: 'screen' });
    vi.advanceTimersByTime(300);
    layers.project.updateLayer('a', { opacity: 0.5 });
    vi.advanceTimersByTime(100);
    layers.project.updateLayer('a', { opacity: 0.25 });
    vi.advanceTimersByTime(700);
    expect(steps()).toBe(2);
    undo();
    expect(layerById('a')!.opacity).toBe(1);
    expect(layerById('a')!.blendMode).toBe('screen');
  });

  it('treats edits within one gesture as one step whatever they touch', () => {
    vi.useFakeTimers();
    layers.project.updateLayer('a', { opacity: 0.5 });
    layers.project.updateLayer('a', { blendMode: 'add' });
    layers.project.setLayerOpacity('b', 0.3);
    vi.advanceTimersByTime(700);
    expect(steps()).toBe(1);
  });

  it('commits the waiting edit before undo and redo', () => {
    vi.useFakeTimers();
    layers.project.updateLayer('a', { opacity: 0.6 });
    undo();
    expect(layerById('a')!.opacity).toBe(1);
    redo();
    expect(layerById('a')!.opacity).toBe(0.6);
  });

  it('makes an add-layer one undo, default shader included', async () => {
    // A new media layer gets its default shader a moment after it is added.
    const id = layers.project.addLayer('Media', 'media')!;
    await vi.waitFor(() => expect(layerById(id)?.source).toBeTruthy());
    expect(steps()).toBe(1);
    undo();
    expect(layerById(id)).toBeUndefined();
    redo();
    expect(layerById(id)?.source?.type).toBe('shader');
  });
});

describe('live control is not an edit', () => {
  it('writes no step and does not end a debounce in progress', () => {
    vi.useFakeTimers();
    layers.project.updateLayer('a', { opacity: 0.5 });
    for (const value of [0.1, 0.2, 0.3]) {
      vi.advanceTimersByTime(100);
      layers.project.updateLayer('b', { opacity: value }, { history: false });
    }
    vi.advanceTimersByTime(700);
    expect(steps()).toBe(1);
  });

  it('is not reverted by undoing an edit to another layer', () => {
    layers.project.setLayerBlendMode('a', 'multiply');
    layers.project.updateLayer('b', { opacity: 0.2 }, { history: false });
    undo();
    expect(layerById('a')!.blendMode).toBe('normal');
    expect(layerById('b')!.opacity).toBe(0.2);
  });

  it('does not record a MIDI-style shader value write', () => {
    layers.project.setLayerSource('a', { id: 's', type: 'shader', src: 'builtin:grid', name: 'Grid', shaderValues: { x: 0 } } as any);
    const before = steps();
    layers.project.setLayerSource('a', { ...layerById('a')!.source!, shaderValues: { x: 0.7 } }, { history: false });
    expect(steps()).toBe(before);
  });

  it('keeps play/pause out of the steps', () => {
    layers.project.setLayerSource('a', { id: 'v', type: 'video', src: '/v.mp4', name: 'Clip', isPlaying: true } as any);
    const before = steps();
    layers.project.updateLayer('a', { source: { ...layerById('a')!.source!, isPlaying: false } });
    hooks.flushPendingHistorySnapshot();
    expect(steps()).toBe(before);
  });
});

describe('the view is not part of a step', () => {
  it('keeps the live selection through undo, and moves it off a layer the undo removed', () => {
    layers.project.addColorLayer('Added');
    const addedId = get(layers.project).layers.find((l) => l.name === 'Added')!.id;
    layers.project.selectLayer('a');
    layers.project.setLayerBlendMode('b', 'screen');
    undo();
    expect(get(layers.project).selectedLayerId).toBe('a');
    layers.project.selectLayer(addedId);
    undo();
    expect(layerById(addedId)).toBeUndefined();
    expect(get(layers.project).selectedLayerId).not.toBe(addedId);
    expect(get(layers.selectedLayerIds)).not.toContain(addedId);
  });

  it('does not make a step of selecting a layer or folding a group', () => {
    layers.project.selectLayer('b');
    hooks.recordDiscreteAction();
    layers.project.update((p) => ({ ...p, layers: p.layers.map((l) => (l.id === 'a' ? { ...l, groupCollapsed: true } : l)) }));
    hooks.recordDiscreteAction();
    expect(steps()).toBe(0);
  });
});

describe('every user-facing mutator records a step', () => {
  function fxProject() {
    layers.project.replaceMappingCompositionEffects([{ id: 'cfx', type: 'blur' as any, enabled: true, params: { amount: 0.25 } as any, opacity: 1 } as any]);
    layers.project.replaceLayerEffects('a', [{ id: 'lfx', type: 'blur' as any, enabled: true, params: { amount: 0.25 } as any, opacity: 1 } as any]);
    layers.project.addMappingStageEffect({ ...stageEffects.createDefaultStageEffect('radial-pulse'), id: 'sfx' });
    layers.project.enableMask('b');
    resetHistory();
  }

  const cases: Array<[string, () => void]> = [
    ['toggleEffect', () => layers.project.toggleEffect('a', 'lfx')],
    ['updateEffect', () => layers.project.updateEffect('a', 'lfx', { opacity: 0.5 })],
    ['resetEffectParams', () => layers.project.resetEffectParams('a', 'lfx')],
    ['setLayerOpacity', () => layers.project.setLayerOpacity('a', 0.5)],
    ['toggleLayerFlipH', () => layers.project.toggleLayerFlipH('a')],
    ['toggleLayerFlipV', () => layers.project.toggleLayerFlipV('a')],
    ['toggleMaskInvert', () => layers.project.toggleMaskInvert('b')],
    ['setMaskFeather', () => layers.project.setMaskFeather('b', 0.4)],
    ['disableMask', () => layers.project.disableMask('b')],
    ['setCropRegion', () => layers.project.setCropRegion('a', { x: 0.1, y: 0.1, width: 0.5, height: 0.5 } as any)],
    ['updateColorContent', () => layers.project.updateColorContent('a', { color: [1, 0, 0, 1] } as any)],
    ['toggleMappingCompositionEffect', () => layers.project.toggleMappingCompositionEffect('cfx')],
    ['updateMappingCompositionEffect', () => layers.project.updateMappingCompositionEffect('cfx', { opacity: 0.5 })],
    ['resetMappingCompositionEffectParams', () => {
      layers.project.updateMappingCompositionEffectParams('cfx', { amount: 0.9 } as any);
      layers.project.resetMappingCompositionEffectParams('cfx');
    }],
    ['setMappingStageEffectActive', () => layers.project.setMappingStageEffectActive(
      get(layers.project).mappingComposition?.activeStageEffectId === 'sfx' ? null : 'sfx')],
    ['toggleMappingStageEffectInTimeline', () => layers.project.toggleMappingStageEffectInTimeline('sfx')],
    ['updateMappingStageEffect', () => layers.project.updateMappingStageEffect('sfx', { opacity: 0.4 } as any)],
    ['updateMappingStageEffectParam', () => layers.project.updateMappingStageEffectParam('sfx', 'speed', 3)],
    ['saveStagePreset', () => layers.project.saveStagePreset('Look A')],
    ['saveComposition', () => layers.project.saveComposition('Preset A')],
    ['setProjectDimensions', () => layers.project.setProjectDimensions(1280, 720)],
    ['addWLEDController', () => layers.project.addWLEDController({ id: 'w', name: 'W', ipAddr: '10.0.0.2', port: 21324, ledCount: 30, enabled: true } as any)],
    ['addWLEDGroup', () => layers.project.addWLEDGroup({ id: 'g', name: 'G', members: [] } as any)],
    ['saveSVKeyboardPreset', () => layers.project.saveSVKeyboardPreset({ id: 'k', name: 'K' } as any)],
    ['setShaderValueAuto', () => {
      layers.project.update((p) => ({ ...p, layers: p.layers.map((l) => (l.id === 'a' ? { ...l, source: { id: 's', type: 'shader', src: 'x', name: 'x', shaderValues: { x: 0 } } as any } : l)) }));
      layers.project.setShaderValueAuto('a', 'x', { enabled: true } as any);
    }],
    ['setEffectParamAuto', () => layers.project.setEffectParamAuto('a', 'lfx', 'amount', { enabled: true } as any)],
  ];

  it.each(cases)('%s', (_name, run) => {
    fxProject();
    run();
    hooks.flushPendingHistorySnapshot();
    expect(steps()).toBeGreaterThanOrEqual(1);
  });

  it('does not record the Screen FX that beat automation or a hold button picks', () => {
    fxProject();
    layers.project.setMappingStageEffectActive(
      get(layers.project).mappingComposition?.activeStageEffectId === 'sfx' ? null : 'sfx', { history: false });
    hooks.flushPendingHistorySnapshot();
    expect(steps()).toBe(0);
  });

  it('records a stage preset load as one step, unless it is fired live', () => {
    fxProject();
    const presetId = layers.project.saveStagePreset('Look A');
    layers.project.updateLayer('a', { opacity: 0.1 });
    hooks.flushPendingHistorySnapshot();
    const before = steps();
    layers.project.loadStagePreset(presetId);
    expect(steps()).toBe(before + 1);
    layers.project.updateLayer('a', { opacity: 0.2 }, { history: false });
    layers.project.loadStagePreset(presetId, { history: false });
    expect(steps()).toBe(before + 1);
  });

  it('records a preset recall from the tray, but not one the show fires', async () => {
    fxProject();
    const presetId = layers.project.saveComposition('Preset A');
    layers.project.updateLayer('a', { opacity: 0.1 });
    hooks.flushPendingHistorySnapshot();
    const before = steps();
    layers.project.loadComposition(presetId);
    // The preset's sequencer and keyframes go in a moment later, and the
    // step is recorded once they are in.
    await Promise.resolve();
    expect(steps()).toBe(before + 1);
    layers.project.updateLayer('a', { opacity: 0.2 }, { history: false });
    layers.project.loadComposition(presetId, { recordHistory: false });
    await Promise.resolve();
    expect(steps()).toBe(before + 1);
  });
});

describe('mergeProjectStep', () => {
  const layer = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: id, opacity: 1, ...extra });
  const proj = (layerList: any[], extra: Record<string, unknown> = {}) => ({ name: 'p', width: 1920, layers: layerList, ...extra }) as any;

  it('restores only what the step changed', () => {
    const from = proj([layer('a', { opacity: 0.5 }), layer('b')]);
    const to = proj([layer('a'), layer('b')]);
    const liveB = layer('b', { opacity: 0.3 });
    const live = proj([layer('a', { opacity: 0.5 }), liveB], { selectedLayerId: 'b' });
    const merged = historyModule.mergeProjectStep(live, to, from);
    expect(merged.layers[0].opacity).toBe(1);
    expect(merged.layers[1]).toBe(liveB);
    expect(merged.selectedLayerId).toBe('b');
  });

  it('takes project fields the step changed and keeps the rest live', () => {
    const merged = historyModule.mergeProjectStep(
      proj([], { name: 'live', width: 800 }),
      proj([], { name: 'p', width: 1280 }),
      proj([], { name: 'p', width: 1920 }),
    );
    expect(merged.width).toBe(1280);
    expect(merged.name).toBe('live');
  });

  it('re-attaches runtime refs and keeps group folding on a restored layer', () => {
    const texture = { isTexture: true };
    const live = proj([{ ...layer('a', { opacity: 0.2, groupCollapsed: true }), source: { id: 's', isPlaying: true, texture } }]);
    const merged = historyModule.mergeProjectStep(live, proj([{ ...layer('a'), source: { id: 's' } }]), proj([{ ...layer('a', { opacity: 0.2 }), source: { id: 's' } }]));
    expect(merged.layers[0].opacity).toBe(1);
    expect((merged.layers[0] as any).groupCollapsed).toBe(true);
    expect((merged.layers[0].source as any).texture).toBe(texture);
    expect((merged.layers[0].source as any).isPlaying).toBe(true);
  });
});
