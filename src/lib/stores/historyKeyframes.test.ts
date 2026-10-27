/**
 * Keyframe timelines live in their own store, not inside Project, so every
 * undo step carries them beside the project, on the one shared timeline.
 *
 * What matters: a keyframe edit is its own step and comes back on redo; a
 * keyframe edit and the layer edit beside it unwind in the order they
 * happened; a step recorded without keyframes never wipes them; only what
 * a step changed comes back; and playback and live control never record.
 *
 * The integration tests drive App.svelte's own wiring (appHistory.ts).
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import type { Project } from '../types';

let layers: typeof import('./layers');
let types: typeof import('../types');
let historyModule: typeof import('./history');
let hooks: typeof import('./historyHooks');
let appHistory: typeof import('./appHistory');
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
  kf = await import('./keyframeTimeline');
});

// ── The history store on its own ─────────────────────────────────────────

function projectAt(name: string): Project {
  return { name, layers: [] } as unknown as Project;
}
const track = (key: string, times: number[]) => ({
  key, label: key, type: 'number', boolKeyframes: [],
  keyframes: times.map((time) => ({ time, value: time, easing: 'linear' })),
});
const kfA = [{ layerId: 'L1', tracks: [track('opacity', [0])] }];
const kfB = [{ layerId: 'L1', tracks: [track('opacity', [0, 2])] }];

describe('history carries keyframe timelines', () => {
  beforeEach(() => {
    historyModule.history.clear();
  });

  it('round-trips keyframes through undo and redo', () => {
    historyModule.history.init(projectAt('start'), kfA);
    historyModule.history.record(projectAt('after'), kfB);

    const undone = historyModule.history.undo(projectAt('after'), kfB);
    expect(undone!.project.name).toBe('start');
    expect(undone!.keyframes).toEqual(kfA);

    const redone = historyModule.history.redo(projectAt('start'), kfA);
    expect(redone!.project.name).toBe('after');
    expect(redone!.keyframes).toEqual(kfB);
  });

  it('records a keyframe edit even when the project is unchanged', () => {
    // Adding a keyframe does not touch Project at all. Keyed on the project
    // alone, the step would dedupe away and the edit could not be undone.
    const same = projectAt('same');
    historyModule.history.init(same, kfA);
    historyModule.history.record(same, kfB);
    expect(get(historyModule.canUndo)).toBe(true);
    expect(historyModule.history.undo(same, kfB)!.keyframes).toEqual(kfA);
  });

  it('never wipes the keyframes onto a step recorded without them', () => {
    historyModule.history.init(projectAt('start'));
    historyModule.history.record(projectAt('after'));
    expect(historyModule.history.undo(projectAt('after'), kfB)!.keyframes).toBeNull();
  });

  it('leaves the keyframes alone when the step did not change them', () => {
    historyModule.history.init(projectAt('start'), kfA);
    historyModule.history.record(projectAt('after'), kfA);
    // Live keyframes moved on without a step; undoing the layer edit keeps them.
    expect(historyModule.history.undo(projectAt('after'), kfB)!.keyframes).toBeNull();
  });
});

describe('mergeKeyframeStep', () => {
  it('restores only the layers and tracks the step changed', () => {
    const live = [
      { layerId: 'L1', tracks: [track('opacity', [0, 2]), track('scale', [0, 1, 3])] },
      { layerId: 'L2', tracks: [track('opacity', [5, 6])] },
      { layerId: 'L3', tracks: [track('opacity', [1])] },
    ];
    const from = [
      { layerId: 'L1', tracks: [track('opacity', [0, 2]), track('scale', [0])] },
      { layerId: 'L2', tracks: [track('opacity', [5])] },
    ];
    const to = [
      { layerId: 'L1', tracks: [track('opacity', [0]), track('scale', [0])] },
      { layerId: 'L2', tracks: [track('opacity', [5])] },
    ];
    const merged = historyModule.mergeKeyframeStep(live, to, from)!;
    // The opacity keyframe the step added goes; the scale keyframes written
    // without a step since, L2's and L3's, stay as they are live.
    expect(merged.map((t) => t.layerId)).toEqual(['L1', 'L2', 'L3']);
    expect(merged[0].tracks).toEqual([track('opacity', [0]), track('scale', [0, 1, 3])]);
    expect(merged[1]).toBe(live[1]);
    expect(merged[2]).toBe(live[2]);
  });

  it('brings back a timeline the step removed, and removes one it added', () => {
    const one = { layerId: 'L1', tracks: [track('opacity', [0])] };
    const two = { layerId: 'L2', tracks: [track('opacity', [1])] };
    expect(historyModule.mergeKeyframeStep([one], [one, two], [one])).toEqual([one, two]);
    expect(historyModule.mergeKeyframeStep([one, two], [one], [one, two])).toEqual([one]);
  });
});

// ── With the real stores, wired as App.svelte wires them ──────────────────

function projectPayload(name: string, layerList: any[] = []) {
  return { version: '1.9.3', project: { id: name, name, width: 1920, height: 1080, layers: layerList } };
}
const steps = () => get(historyModule.history).past.length;
const layerById = (id: string) => get(layers.project).layers.find((l) => l.id === id);
const opacityTimes = (layerId = 'a') =>
  kf.keyframeTimeline.getTrack(layerId, 'opacity')?.keyframes.map((k) => k.time) ?? [];

describe('keyframe edits on the shared undo timeline', () => {
  beforeEach(async () => {
    appHistory.wireAppHistory();
    expect(layers.project.importProject(projectPayload('start', [
      types.createLayer('a', 'A', 'color'),
      types.createLayer('b', 'B', 'color'),
    ]))).toBe(true);
    await Promise.resolve();
    appHistory.resetHistoryToCurrent();
  });

  afterEach(() => {
    vi.useRealTimers();
    kf.keyframeTimeline.pause();
    hooks.cancelPendingHistorySnapshot();
    hooks.setHistoryCallback(() => {});
    hooks.setProjectReplacedCallback(null);
  });

  it('undoes and redoes adding a keyframe, one step', () => {
    kf.keyframeTimeline.addKeyframe('a', 'opacity', 1, 0.5);
    expect(appHistory.undoHistory()).toBe(true);
    expect(opacityTimes()).toEqual([]);
    expect(appHistory.redoHistory()).toBe(true);
    expect(opacityTimes()).toEqual([1]);
    expect(steps()).toBe(1);
  });

  it('makes a keyframe drag one step', () => {
    vi.useFakeTimers();
    kf.keyframeTimeline.addKeyframe('a', 'opacity', 1, 0.5);
    vi.advanceTimersByTime(700);
    let at = 1;
    for (const next of [1.1, 1.3, 1.6, 2]) {
      kf.keyframeTimeline.moveKeyframe('a', 'opacity', at, next);
      at = next;
      vi.advanceTimersByTime(30);
    }
    vi.advanceTimersByTime(700);
    expect(steps()).toBe(2);
    appHistory.undoHistory();
    expect(opacityTimes()).toEqual([1]);
  });

  it('unwinds layer and keyframe edits in the order they happened', () => {
    layers.project.setLayerBlendMode('a', 'screen');
    kf.keyframeTimeline.addKeyframe('a', 'opacity', 1, 0.5);
    hooks.flushPendingHistorySnapshot();
    layers.project.addColorLayer('Extra');
    kf.keyframeTimeline.removeKeyframe('a', 'opacity', 1);
    expect(steps()).toBe(4);

    appHistory.undoHistory();
    expect(opacityTimes()).toEqual([1]);
    expect(get(layers.project).layers.map((l) => l.name)).toContain('Extra');
    appHistory.undoHistory();
    expect(get(layers.project).layers.map((l) => l.name)).not.toContain('Extra');
    expect(opacityTimes()).toEqual([1]);
    appHistory.undoHistory();
    expect(opacityTimes()).toEqual([]);
    expect(layerById('a')!.blendMode).toBe('screen');
    appHistory.undoHistory();
    expect(layerById('a')!.blendMode).toBe('normal');

    for (let i = 0; i < 4; i++) appHistory.redoHistory();
    expect(layerById('a')!.blendMode).toBe('screen');
    expect(get(layers.project).layers.map((l) => l.name)).toContain('Extra');
    expect(opacityTimes()).toEqual([]);
  });

  it('keeps a slider edit and the keyframe it auto-records in one step', () => {
    kf.keyframeTimeline.toggleArmed('a', 'opacity');
    layers.project.updateLayer('a', { opacity: 0.4 });
    kf.keyframeTimeline.autoRecord('a', 'opacity', 0.4, 'Opacity', 'number');
    hooks.flushPendingHistorySnapshot();
    expect(steps()).toBe(1);
    appHistory.undoHistory();
    expect(layerById('a')!.opacity).toBe(1);
    expect(opacityTimes()).toEqual([]);
  });

  it('takes back Clear All in one step', () => {
    kf.keyframeTimeline.addKeyframe('a', 'opacity', 1, 0.5);
    kf.keyframeTimeline.addKeyframe('b', 'opacity', 2, 0.5);
    hooks.flushPendingHistorySnapshot();
    kf.keyframeTimeline.clearAll();
    appHistory.undoHistory();
    expect(opacityTimes('a')).toEqual([1]);
    expect(opacityTimes('b')).toEqual([2]);
  });

  it('drops the selection of a keyframe the undo removed', () => {
    kf.keyframeTimeline.addKeyframe('a', 'opacity', 1, 0.5);
    kf.keyframeTimeline.selectKeyframe('a', 'opacity', 1);
    appHistory.undoHistory();
    expect(get(kf.keyframeTimeline).selectedKeyframe).toBeNull();
  });

  it('records nothing while the keyframes play', () => {
    vi.useFakeTimers();
    layers.project.updateLayer('a', { opacity: 0.5 });
    hooks.flushPendingHistorySnapshot();
    kf.keyframeTimeline.addKeyframe('a', 'opacity', 0, 0);
    kf.keyframeTimeline.addKeyframe('a', 'opacity', 2, 1);
    hooks.flushPendingHistorySnapshot();
    const before = steps();
    kf.keyframeTimeline.play();
    vi.advanceTimersByTime(1500);
    kf.keyframeTimeline.seek(1.5);
    kf.keyframeTimeline.pause();
    vi.advanceTimersByTime(1000);
    expect(get(kf.keyframeTimeline).config.currentTime).toBeGreaterThan(0);
    expect(steps()).toBe(before);
  });

  it('records a controller recording into an armed track as one step of its own', async () => {
    const { midiRouter } = await import('../midi/midiRouter');
    layers.project.replaceLayerEffects('a', [{ id: 'fx', type: 'blur' as any, enabled: true, params: { amount: 0.25 } as any, opacity: 1 } as any]);
    appHistory.resetHistoryToCurrent();
    kf.keyframeTimeline.addKeyframe('a', 'opacity', 1, 0.5);
    hooks.flushPendingHistorySnapshot();
    expect(steps()).toBe(1);

    kf.keyframeTimeline.toggleArmed('a', 'fx:fx:amount');
    midiRouter.dispatchPath('map:effect:fx:amount', 0.7, { layerId: 'a' });
    hooks.flushPendingHistorySnapshot();
    // The armed track takes the keyframe, and the recording is its own step.
    const fxValues = () => kf.keyframeTimeline.getTrack('a', 'fx:fx:amount')?.keyframes.map((k) => k.value) ?? [];
    expect(fxValues()).toEqual([0.7]);
    expect(steps()).toBe(2);

    // One undo takes back the recording only, the next the edit before it.
    appHistory.undoHistory();
    expect(fxValues()).toEqual([]);
    expect(opacityTimes()).toEqual([1]);
    appHistory.undoHistory();
    expect(opacityTimes()).toEqual([]);
  });

  it('starts the history over on open, keyframes included in the baseline', async () => {
    kf.keyframeTimeline.addKeyframe('a', 'opacity', 1, 0.5);
    hooks.flushPendingHistorySnapshot();
    const withKeyframes = {
      ...projectPayload('second', [types.createLayer('c', 'C', 'color')]),
      keyframeTimelines: [{ layerId: 'c', tracks: [track('opacity', [3])] }],
    };
    expect(layers.project.importProject(withKeyframes)).toBe(true);
    await Promise.resolve();
    expect(steps()).toBe(0);
    expect(appHistory.undoHistory()).toBe(false);
    expect(opacityTimes('c')).toEqual([3]);
    // The first edit after opening undoes back to the opened keyframes.
    kf.keyframeTimeline.addKeyframe('c', 'opacity', 4, 0.5);
    appHistory.undoHistory();
    expect(opacityTimes('c')).toEqual([3]);
    expect(opacityTimes('a')).toEqual([]);
  });
});
