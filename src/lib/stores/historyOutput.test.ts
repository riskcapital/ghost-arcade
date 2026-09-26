import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import type { Project } from '../types';

/**
 * Screens and the Master Warp live in settings, not in Project, so history
 * carries them as a third part of every step, on the same timeline as the
 * project and keyframes. What matters: an output-only edit is its own step,
 * undo and redo put the screens back, a step that never touched the output
 * leaves the live output alone, and live-performance state (blackout) is
 * never part of it.
 */

let historyModule: typeof import('./history');
let settingsModule: typeof import('./settings');
let screensModule: typeof import('./screens');
let hooks: typeof import('./historyHooks');

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
  (globalThis as any).document = {
    documentElement: { style: { setProperty() {}, removeProperty() {} } },
    addEventListener() {}, removeEventListener() {},
  };
  (globalThis as any).window = globalThis;
  (globalThis as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
}

function projectAt(name: string): Project {
  return { name, layers: [] } as unknown as Project;
}

let liveProject = projectAt('start');

/** What App.svelte does: record every store, restore only what changed. */
function record() {
  historyModule.history.record(liveProject, null, settingsModule.settings.captureOutputHistory());
}
function apply(step: import('./history').HistorySnapshot | null) {
  if (!step) return;
  liveProject = step.project;
  const patch = historyModule.outputHistoryPatch(step.output, step.leavingOutput);
  if (patch) settingsModule.settings.applyOutputStage(patch);
}
const undo = () => apply(historyModule.history.undo(liveProject));
const redo = () => apply(historyModule.history.redo(liveProject));

const output = () => get(settingsModule.settings).output;
const slice = () => output().slices[0];

beforeAll(async () => {
  installDomShim();
  settingsModule = await import('./settings');
  screensModule = await import('./screens');
  historyModule = await import('./history');
  hooks = await import('./historyHooks');
});

beforeEach(() => {
  settingsModule.settings.update(s => ({
    ...s,
    output: {
      ...s.output,
      slices: [settingsModule.createDefaultSlice('screen-a', 'A', 'A', 0, 0.5)],
      masterWarp: { enabled: true, mode: 'corners' },
      blackout: false,
    },
  }));
  liveProject = projectAt('start');
  historyModule.history.clear();
  historyModule.history.init(liveProject, null, settingsModule.settings.captureOutputHistory());
  hooks.setHistoryCallback(record);
});

describe('history carries the screens and the Master Warp', () => {
  it('undoes and redoes a mask edit, a crop drag and a Master Warp drag, one step each', () => {
    // Mask: add it and three points (four discrete actions, each recorded
    // by the store), then drag a point (one step for the whole drag).
    const maskId = screensModule.screenActions.addMask('screen-a')!;
    for (const p of [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.5, y: 0.9 }]) {
      screensModule.screenActions.addMaskPoint('screen-a', maskId, p);
    }
    for (const x of [0.52, 0.55, 0.6]) screensModule.screenActions.updateMaskPoint('screen-a', maskId, 2, { x, y: 0.9 });
    hooks.recordDiscreteAction();
    // Crop drag: many writes, one record at mouseup.
    for (const w of [0.45, 0.4, 0.35]) screensModule.screenActions.update('screen-a', { cropW: w });
    hooks.recordDiscreteAction();
    // Master Warp drag.
    for (const x of [0.02, 0.05, 0.1]) {
      settingsModule.settings.setMasterWarp({ corners: {
        topLeft: { x, y: 0 }, topRight: { x: 1, y: 0 }, bottomLeft: { x: 0, y: 1 }, bottomRight: { x: 1, y: 1 },
      } });
    }
    hooks.recordDiscreteAction();

    undo();
    expect(output().masterWarp?.corners).toBeUndefined();
    expect(slice().cropW).toBe(0.35);
    undo();
    expect(slice().cropW).toBe(0.5);
    expect(slice().masks![0].points[2].x).toBe(0.6);
    undo();
    expect(slice().masks![0].points[2].x).toBe(0.5);
    undo();
    expect(slice().masks![0].points).toHaveLength(2);

    redo();
    redo();
    expect(slice().masks![0].points[2].x).toBe(0.6);
    redo();
    expect(slice().cropW).toBe(0.35);
    redo();
    expect(output().masterWarp?.corners?.topLeft.x).toBe(0.1);
  });

  it('keeps output and layer edits in the order they happened', () => {
    screensModule.screenActions.update('screen-a', { cropX: 0.2 });
    hooks.recordDiscreteAction();
    liveProject = projectAt('layer edit');
    record();
    undo();
    expect(liveProject.name).toBe('start');
    expect(slice().cropX).toBe(0.2);
    undo();
    expect(slice().cropX).toBe(0);
  });

  it('leaves the live output alone when the undone step never touched it', () => {
    liveProject = projectAt('layer edit');
    record();
    // Something changes the output without being recorded (another window,
    // a live control). Undoing the layer edit must not revert it.
    screensModule.screenActions.update('screen-a', { brightness: 1.4 });
    undo();
    expect(liveProject.name).toBe('start');
    expect(slice().brightness).toBe(1.4);
  });

  it('never records or restores the blackout', () => {
    expect(settingsModule.OUTPUT_HISTORY_KEYS).not.toContain('blackout');
    expect(Object.keys(settingsModule.settings.captureOutputHistory()).sort()).toEqual(['masterWarp', 'slices']);
    screensModule.screenActions.update('screen-a', { cropX: 0.3 });
    hooks.recordDiscreteAction();
    settingsModule.settings.update(s => ({ ...s, output: { ...s.output, blackout: true } }));
    undo();
    expect(slice().cropX).toBe(0);
    expect(output().blackout).toBe(true);
  });

  it('dedupes a record with nothing changed, so a click without a drag adds no step', () => {
    hooks.recordDiscreteAction();
    hooks.recordDiscreteAction();
    expect(get(historyModule.canUndo)).toBe(false);
    screensModule.screenActions.applyPreset('2-wide');
    expect(get(historyModule.canUndo)).toBe(true);
    undo();
    expect(output().slices.map(s => s.id)).toEqual(['screen-a']);
  });
});
