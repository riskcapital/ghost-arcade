/**
 * Screens and the Master Warp live in settings, not in Project, so every
 * undo step carries them beside the project and the keyframes, on the one
 * shared timeline.
 *
 * What matters: a Screen, mask or Master Warp edit is its own step and comes
 * back on redo; a drag, a slider drag and a held arrow key are one step each;
 * Screen, layer and keyframe edits unwind in the order they happened; a step
 * restores only the Screens and fields it changed, so nothing that changed
 * without a step is reverted; live-performance state (blackout, test
 * pattern) and live control never become steps; and opening a project starts
 * the history over with its Screens as the baseline.
 *
 * The harness drives App.svelte's own wiring (appHistory.ts).
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

let layers: typeof import('./layers');
let types: typeof import('../types');
let historyModule: typeof import('./history');
let hooks: typeof import('./historyHooks');
let appHistory: typeof import('./appHistory');
let settingsModule: typeof import('./settings');
let screensModule: typeof import('./screens');
let kf: typeof import('./keyframeTimeline');

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
    setTimeout(() => cb(Date.now()), 16) as unknown as number;
  (globalThis as any).cancelAnimationFrame = (id: number) => clearTimeout(id as never);
}

beforeAll(async () => {
  installDomShim();
  layers = await import('./layers');
  types = await import('../types');
  historyModule = await import('./history');
  hooks = await import('./historyHooks');
  appHistory = await import('./appHistory');
  settingsModule = await import('./settings');
  screensModule = await import('./screens');
  kf = await import('./keyframeTimeline');
});

const undo = () => appHistory.undoHistory();
const redo = () => appHistory.redoHistory();
const steps = () => get(historyModule.history).past.length;
const output = () => get(settingsModule.settings).output;
const screenById = (id: string) => output().slices.find((s) => s.id === id)!;
const actions = () => screensModule.screenActions;
const layerById = (id: string) => get(layers.project).layers.find((l) => l.id === id);
const corners = (x: number) => ({
  topLeft: { x, y: 0 }, topRight: { x: 1, y: 0 }, bottomLeft: { x: 0, y: 1 }, bottomRight: { x: 1, y: 1 },
});

function projectPayload(name: string, extra: Record<string, unknown> = {}) {
  return {
    version: '1.9.3',
    project: {
      id: name, name, width: 1920, height: 1080,
      layers: [types.createLayer('a', 'A', 'color')],
      ...extra,
    },
  };
}

beforeEach(async () => {
  appHistory.wireAppHistory();
  expect(layers.project.importProject(projectPayload('start'))).toBe(true);
  await Promise.resolve();
  settingsModule.settings.update((s) => ({
    ...s,
    output: {
      ...s.output,
      slices: [
        settingsModule.createDefaultSlice('screen-a', 'A', 'A', 0, 0.5),
        settingsModule.createDefaultSlice('screen-b', 'B', 'B', 0.5, 0.5),
      ],
      masterWarp: { enabled: true, mode: 'corners' },
      blackout: false,
      testPattern: 'none',
    },
  }));
  screensModule.selectedScreenId.set(null);
  appHistory.resetHistoryToCurrent();
});

afterEach(() => {
  vi.useRealTimers();
  hooks.cancelPendingHistorySnapshot();
  hooks.setHistoryCallback(() => {});
  hooks.setProjectReplacedCallback(null);
});

describe('history carries the Screens and the Master Warp', () => {
  it('undoes and redoes a mask edit, a crop drag and a Master Warp drag, one step each', () => {
    // A mask and three points: four discrete actions, each recorded by the
    // store. Then a point drag, one step for the whole drag.
    const maskId = actions().addMask('screen-a')!;
    for (const p of [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.5, y: 0.9 }]) {
      actions().addMaskPoint('screen-a', maskId, p);
    }
    for (const x of [0.52, 0.55, 0.6]) actions().updateMaskPoint('screen-a', maskId, 2, { x, y: 0.9 });
    hooks.recordDiscreteAction();
    // Crop drag: many writes, one record at mouseup.
    for (const w of [0.45, 0.4, 0.35]) actions().update('screen-a', { cropW: w });
    hooks.recordDiscreteAction();
    // Master Warp drag.
    for (const x of [0.02, 0.05, 0.1]) settingsModule.settings.setMasterWarp({ corners: corners(x) });
    hooks.recordDiscreteAction();
    expect(steps()).toBe(7);

    undo();
    expect(output().masterWarp?.corners).toBeUndefined();
    expect(screenById('screen-a').cropW).toBe(0.35);
    undo();
    expect(screenById('screen-a').cropW).toBe(0.5);
    expect(screenById('screen-a').masks![0].points[2].x).toBe(0.6);
    undo();
    expect(screenById('screen-a').masks![0].points[2].x).toBe(0.5);
    undo();
    expect(screenById('screen-a').masks![0].points).toHaveLength(2);

    redo();
    redo();
    expect(screenById('screen-a').masks![0].points[2].x).toBe(0.6);
    redo();
    expect(screenById('screen-a').cropW).toBe(0.35);
    redo();
    expect(output().masterWarp?.corners?.topLeft.x).toBe(0.1);
  });

  it('unwinds interleaved layer, Screen and keyframe edits in the order they happened', () => {
    layers.project.setLayerBlendMode('a', 'screen');                    // 1 layer
    actions().update('screen-a', { cropX: 0.2 });                        // 2 Screen
    hooks.recordDiscreteAction();
    kf.keyframeTimeline.addKeyframe('a', 'opacity', 1, 0.5);             // 3 keyframe
    hooks.flushPendingHistorySnapshot();
    settingsModule.settings.setMasterWarp({ corners: corners(0.1) });    // 4 Master Warp
    hooks.recordDiscreteAction();
    layers.project.addColorLayer('Extra');                               // 5 layer
    actions().setWarpMode('screen-b', 'corners');                        // 6 Screen
    expect(steps()).toBe(6);

    const names = () => get(layers.project).layers.map((l) => l.name);
    const kfTimes = () => kf.keyframeTimeline.getTrack('a', 'opacity')?.keyframes.map((k) => k.time) ?? [];
    const state = () => ({
      blend: layerById('a')!.blendMode,
      cropX: screenById('screen-a').cropX,
      kf: kfTimes().length,
      warp: output().masterWarp?.corners?.topLeft.x ?? null,
      extra: names().includes('Extra'),
      modeB: screenById('screen-b').warpMode,
    });
    const at6 = state();
    expect(at6).toEqual({ blend: 'screen', cropX: 0.2, kf: 1, warp: 0.1, extra: true, modeB: 'corners' });

    const expected = [
      { ...at6, modeB: 'rect' },
      { ...at6, modeB: 'rect', extra: false },
      { ...at6, modeB: 'rect', extra: false, warp: null },
      { ...at6, modeB: 'rect', extra: false, warp: null, kf: 0 },
      { ...at6, modeB: 'rect', extra: false, warp: null, kf: 0, cropX: 0 },
      { ...at6, modeB: 'rect', extra: false, warp: null, kf: 0, cropX: 0, blend: 'normal' },
    ];
    for (const after of expected) {
      expect(undo()).toBe(true);
      expect(state()).toEqual(after);
    }
    expect(undo()).toBe(false);
    for (const after of [...expected].reverse().slice(1)) {
      expect(redo()).toBe(true);
      expect(state()).toEqual(after);
    }
    expect(redo()).toBe(true);
    expect(state()).toEqual(at6);
  });

  it('makes a slider drag on a Screen one step, even with a pause in it', () => {
    vi.useFakeTimers();
    // What ScreenInspector does on every slider tick.
    const slide = (brightness: number) => {
      actions().update('screen-a', { brightness });
      hooks.scheduleHistorySnapshot('screen:screen-a:brightness');
    };
    for (const value of [1.1, 1.2, 1.3]) {
      slide(value);
      vi.advanceTimersByTime(100);
    }
    vi.advanceTimersByTime(400);
    slide(1.4);
    vi.advanceTimersByTime(700);
    expect(steps()).toBe(1);
    undo();
    expect(screenById('screen-a').brightness).toBe(1);
    redo();
    expect(screenById('screen-a').brightness).toBe(1.4);
  });

  it('keeps a Screen slider edit and a Screen added after it apart', () => {
    vi.useFakeTimers();
    actions().update('screen-a', { contrast: 1.3 });
    hooks.scheduleHistorySnapshot('screen:screen-a:contrast');
    vi.advanceTimersByTime(200);
    actions().add();
    expect(steps()).toBe(2);
    undo();
    expect(output().slices).toHaveLength(2);
    expect(screenById('screen-a').contrast).toBe(1.3);
    undo();
    expect(screenById('screen-a').contrast).toBe(1);
  });

  it('makes a held arrow key on a Screen corner one step', () => {
    vi.useFakeTimers();
    actions().setWarpMode('screen-a', 'corners');
    const start = screenById('screen-a').corners!.topLeft.x;
    // What ScreenWarpHandles does on each key repeat, about 30 a second,
    // and App.svelte on the arrow keyup.
    for (let i = 0; i < 20; i++) {
      const c = screenById('screen-a').corners!;
      actions().update('screen-a', { corners: { ...c, topLeft: { x: c.topLeft.x + 0.001, y: c.topLeft.y } } });
      hooks.scheduleHistorySnapshot('screen-nudge:screen-a');
      vi.advanceTimersByTime(33);
    }
    hooks.flushPendingHistorySnapshot();
    expect(steps()).toBe(2);
    undo();
    expect(screenById('screen-a').corners!.topLeft.x).toBe(start);
    expect(screenById('screen-a').warpMode).toBe('corners');
  });

  it('restores only the Screens and fields the step changed', () => {
    actions().update('screen-a', { cropW: 0.3 });
    hooks.recordDiscreteAction();
    // Changed since without a step: Screen A re-found on a renumbered
    // display, a Stage 3D sync moving Screen B, a Screen added elsewhere.
    actions().update('screen-a', { displayId: 7 });
    actions().update('screen-b', { cropY: 0.25 });
    settingsModule.settings.update((s) => ({
      ...s,
      output: { ...s.output, slices: [...s.output.slices, settingsModule.createDefaultSlice('screen-c', 'C', 'C', 0, 1)] },
    }));
    undo();
    expect(screenById('screen-a').cropW).toBe(0.5);
    expect(screenById('screen-a').displayId).toBe(7);
    expect(screenById('screen-b').cropY).toBe(0.25);
    expect(output().slices.map((s) => s.id)).toEqual(['screen-a', 'screen-b', 'screen-c']);
    redo();
    expect(screenById('screen-a').cropW).toBe(0.3);
    expect(screenById('screen-a').displayId).toBe(7);
  });

  it('leaves the live output alone when the undone step never touched it', () => {
    layers.project.setLayerBlendMode('a', 'screen');
    // Something changes the output without a step (another window, a
    // Stage 3D sync). Undoing the layer edit must not revert it.
    actions().update('screen-a', { brightness: 1.4 });
    settingsModule.settings.setMasterWarp({ corners: corners(0.2) });
    undo();
    expect(layerById('a')!.blendMode).toBe('normal');
    expect(screenById('screen-a').brightness).toBe(1.4);
    expect(output().masterWarp?.corners?.topLeft.x).toBe(0.2);
  });

  it('never records or restores the blackout or the test pattern', () => {
    expect(settingsModule.OUTPUT_HISTORY_KEYS).toEqual(['slices', 'masterWarp']);
    expect(Object.keys(settingsModule.settings.captureOutputHistory()).sort()).toEqual(['masterWarp', 'slices']);
    actions().update('screen-a', { cropX: 0.3 });
    hooks.recordDiscreteAction();
    settingsModule.settings.update((s) => ({ ...s, output: { ...s.output, blackout: true, testPattern: 'grid' } }));
    hooks.recordDiscreteAction();
    expect(steps()).toBe(1);
    undo();
    expect(screenById('screen-a').cropX).toBe(0);
    expect(output().blackout).toBe(true);
    expect(output().testPattern).toBe('grid');
  });

  it('adds no step for a click that moves nothing, and one for a layout preset', () => {
    hooks.recordDiscreteAction();
    hooks.recordDiscreteAction();
    expect(get(historyModule.canUndo)).toBe(false);
    actions().applyPreset('3-wide');
    expect(steps()).toBe(1);
    undo();
    expect(output().slices.map((s) => s.id)).toEqual(['screen-a', 'screen-b']);
  });

  it('records no step for live control', () => {
    vi.useFakeTimers();
    actions().update('screen-a', { gamma: 1.5 });
    hooks.scheduleHistorySnapshot('screen:screen-a:gamma');
    vi.advanceTimersByTime(100);
    // A controller-fired action that would otherwise record.
    hooks.runAsLiveControl(() => {
      actions().applyPreset('2x2');
      settingsModule.settings.setMasterWarp({ corners: corners(0.3) });
      hooks.recordDiscreteAction();
    });
    vi.advanceTimersByTime(700);
    // Only the slider edit, which live control did not end early.
    expect(steps()).toBe(1);
  });

  it('drops the selection of a Screen the undo removed', () => {
    const id = actions().add()!;
    screensModule.selectedScreenId.set(id);
    undo();
    expect(get(screensModule.selectedScreenId)).toBeNull();
  });

  it('drops the selection of a mask the undo removed, and stops placing', () => {
    screensModule.selectedScreenId.set('screen-a');
    actions().addMask('screen-a');
    expect(get(screensModule.screenMaskPlacing)).toBe(true);
    undo();
    expect(get(screensModule.selectedScreenId)).toBe('screen-a');
    expect(get(screensModule.selectedScreenMaskId)).toBeNull();
    expect(get(screensModule.screenMaskPlacing)).toBe(false);
  });

  it('starts the history over on open, with the opened Screens as the baseline', async () => {
    actions().update('screen-a', { cropX: 0.4 });
    hooks.recordDiscreteAction();
    const opened = settingsModule.createDefaultSlice('screen-z', 'Z', 'Z', 0.1, 0.8);
    expect(layers.project.importProject(projectPayload('second', {
      outputSlices: [opened],
      outputMasterWarp: { enabled: true, mode: 'corners', corners: corners(0.05) },
    }))).toBe(true);
    await Promise.resolve();
    expect(steps()).toBe(0);
    expect(undo()).toBe(false);
    expect(output().slices.map((s) => s.id)).toEqual(['screen-z']);

    actions().update('screen-z', { cropW: 0.5 });
    hooks.recordDiscreteAction();
    settingsModule.settings.setMasterWarp({ corners: corners(0.2) });
    hooks.recordDiscreteAction();
    undo();
    undo();
    expect(undo()).toBe(false);
    expect(screenById('screen-z').cropW).toBe(0.8);
    expect(output().masterWarp?.corners?.topLeft.x).toBe(0.05);
  });
});

describe('mergeOutputStep', () => {
  it('returns nothing when the step did not change the output', () => {
    const state = { slices: [{ id: 's', cropX: 0 }], masterWarp: { enabled: false, mode: 'corners' } };
    expect(historyModule.mergeOutputStep(state, state, JSON.parse(JSON.stringify(state)))).toBeNull();
    expect(historyModule.mergeOutputStep(state, null, state)).toBeNull();
  });

  it('takes a field the step dropped away again', () => {
    const live = { masterWarp: { enabled: true, mode: 'corners', corners: corners(0.1), meshGrid: { rows: 2 } } };
    const to = { masterWarp: { enabled: true, mode: 'corners' } };
    const from = { masterWarp: { enabled: true, mode: 'corners', corners: corners(0.1) } };
    expect(historyModule.mergeOutputStep(live, to, from)).toEqual({
      masterWarp: { enabled: true, mode: 'corners', meshGrid: { rows: 2 } },
    });
  });
});
