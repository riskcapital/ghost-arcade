/**
 * Automation, live control and undo.
 *
 * Controllers, macro knobs, Auto, audio and LFO modulation and performance
 * pads change values many times a second. None of that is an undo step;
 * otherwise the history fills in seconds and every undo fights the engine.
 * What they record into a track armed for keyframes is undoable, and a whole
 * take is one step that never merges with the user's own edits.
 *
 * Drives App.svelte's own wiring (appHistory.ts).
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

let layers: typeof import('./layers');
let types: typeof import('../types');
let historyModule: typeof import('./history');
let hooks: typeof import('./historyHooks');
let appHistory: typeof import('./appHistory');
let kf: typeof import('./keyframeTimeline');
let macrosModule: typeof import('./macros');

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
  kf = await import('./keyframeTimeline');
  macrosModule = await import('./macros');
});

function projectPayload(name: string, layerList: any[] = []) {
  return { version: '1.9.3', project: { id: name, name, width: 1920, height: 1080, layers: layerList } };
}
const steps = () => get(historyModule.history).past.length;
const layerById = (id: string) => get(layers.project).layers.find((l) => l.id === id);
const TRACK = 'fx:fx:amount';
const recorded = () => kf.keyframeTimeline.getTrack('a', TRACK)?.keyframes.length ?? 0;
const undo = () => appHistory.undoHistory();
const redo = () => appHistory.redoHistory();
/** One engine frame: the playhead moves and automation writes the param. */
function automationFrame(time: number, value: number) {
  kf.keyframeTimeline.seek(time);
  hooks.runAsLiveControl(() => layers.project.updateEffectParams('a', 'fx', { amount: value } as any));
  vi.advanceTimersByTime(16);
}
const amount = () => (layerById('a')!.effects[0].params as any).amount;

beforeEach(async () => {
  appHistory.wireAppHistory();
  expect(layers.project.importProject(projectPayload('start', [
    types.createLayer('a', 'A', 'color'),
    types.createLayer('b', 'B', 'color'),
  ]))).toBe(true);
  await Promise.resolve();
  layers.project.replaceLayerEffects('a', [{ id: 'fx', type: 'blur' as any, enabled: true, params: { amount: 0.25 } as any, opacity: 1 } as any]);
  kf.keyframeTimeline.reset();
  appHistory.resetHistoryToCurrent();
});

afterEach(() => {
  vi.useRealTimers();
  kf.keyframeTimeline.pause();
  hooks.cancelPendingHistorySnapshot();
  hooks.setHistoryCallback(() => {});
  hooks.setProjectReplacedCallback(null);
});

describe('automation is not an edit', () => {
  it('writes no step while nothing is armed', () => {
    vi.useFakeTimers();
    for (let i = 0; i < 120; i++) automationFrame(i / 60, i / 120);
    hooks.runAsLiveControl(() => layers.project.updateLayer('b', { opacity: 0.4 }));
    vi.advanceTimersByTime(2000);
    expect(steps()).toBe(0);
    expect(recorded()).toBe(0);
  });

  it('does not end or swallow the user edit it runs beside', () => {
    vi.useFakeTimers();
    layers.project.updateLayer('b', { opacity: 0.5 });
    for (let i = 0; i < 20; i++) automationFrame(i / 60, i / 20);
    vi.advanceTimersByTime(700);
    expect(steps()).toBe(1);
    undo();
    expect(layerById('b')!.opacity).toBe(1);
  });
});

describe('recording into an armed track', () => {
  beforeEach(() => {
    kf.keyframeTimeline.toggleArmed('a', TRACK);
  });

  it('is one step for the whole take, and one undo removes it', () => {
    vi.useFakeTimers();
    for (let i = 0; i < 60; i++) automationFrame(i / 30, i / 60);
    expect(recorded()).toBe(60);
    vi.advanceTimersByTime(700);
    expect(steps()).toBe(1);
    undo();
    expect(recorded()).toBe(0);
    redo();
    expect(recorded()).toBe(60);
  });

  it('ends the take when the timeline stops', () => {
    vi.useFakeTimers();
    kf.keyframeTimeline.play();
    for (let i = 0; i < 10; i++) automationFrame(i / 30, i / 10);
    kf.keyframeTimeline.pause();
    expect(steps()).toBe(1);
  });

  it('ends the take when the track is disarmed', () => {
    vi.useFakeTimers();
    for (let i = 0; i < 10; i++) automationFrame(i / 30, i / 10);
    kf.keyframeTimeline.toggleArmed('a', TRACK);
    expect(steps()).toBe(1);
  });

  it('keeps a user edit made mid-take as its own step, between two takes', () => {
    vi.useFakeTimers();
    for (let i = 0; i < 10; i++) automationFrame(i / 30, 0.1);
    // Within the 50 ms gesture window of the last automation frame.
    layers.project.updateLayer('b', { opacity: 0.5 });
    vi.advanceTimersByTime(16);
    for (let i = 10; i < 20; i++) automationFrame(i / 30, 0.2);
    vi.advanceTimersByTime(700);
    expect(steps()).toBe(3);

    undo();
    expect(recorded()).toBe(10);
    expect(layerById('b')!.opacity).toBe(0.5);
    undo();
    expect(layerById('b')!.opacity).toBe(1);
    expect(recorded()).toBe(10);
    undo();
    expect(recorded()).toBe(0);
  });

  it('never folds the take into a one-shot action', () => {
    vi.useFakeTimers();
    for (let i = 0; i < 5; i++) automationFrame(i / 30, 0.3);
    layers.project.addColorLayer('Added');
    expect(steps()).toBe(2);
    undo();
    expect(get(layers.project).layers.map((l) => l.name)).not.toContain('Added');
    expect(recorded()).toBe(5);
    undo();
    expect(recorded()).toBe(0);
  });

  it('records nothing while the timeline just plays', () => {
    vi.useFakeTimers();
    kf.keyframeTimeline.play();
    vi.advanceTimersByTime(1500);
    kf.keyframeTimeline.pause();
    vi.advanceTimersByTime(700);
    expect(steps()).toBe(0);
    expect(recorded()).toBe(0);
  });

  it('still records a slider the user drags on an armed track as their own edit', () => {
    vi.useFakeTimers();
    kf.keyframeTimeline.seek(1);
    layers.project.updateEffectParams('a', 'fx', { amount: 0.8 } as any);
    vi.advanceTimersByTime(700);
    expect(steps()).toBe(1);
    expect(recorded()).toBe(1);
  });
});

describe('macro knobs perform', () => {
  beforeEach(() => {
    macrosModule.macros.reset();
    macrosModule.macros.assignParameter('macro-1', {
      target: { scope: 'mapping-layer', layerId: 'a', effectId: 'fx', param: 'amount' },
      label: 'Amount', min: 0, max: 1, from: 0, to: 1,
    } as any);
    appHistory.resetHistoryToCurrent();
  });

  it('drive their targets without a step', () => {
    vi.useFakeTimers();
    for (let i = 0; i <= 10; i++) { macrosModule.macros.setMacroValue('macro-1', i / 10); vi.advanceTimersByTime(16); }
    vi.advanceTimersByTime(700);
    expect(amount()).toBe(1);
    expect(steps()).toBe(0);
  });

  it('record into an armed track as one take', () => {
    vi.useFakeTimers();
    kf.keyframeTimeline.toggleArmed('a', TRACK);
    for (let i = 0; i <= 10; i++) {
      kf.keyframeTimeline.seek(i / 10);
      macrosModule.macros.setMacroValue('macro-1', i / 10);
      vi.advanceTimersByTime(16);
    }
    vi.advanceTimersByTime(700);
    expect(recorded()).toBe(11);
    expect(steps()).toBe(1);
  });
});
