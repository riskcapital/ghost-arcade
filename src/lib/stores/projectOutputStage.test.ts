/**
 * The whole output stage is part of the project.
 *
 * Only the Screens, the master canvas and the Master Warp used to be saved.
 * The dome, output rotation and crop, the single-output edge blend and the
 * output grade stayed in this machine's settings, so a project reopened with
 * whatever the last project (or the last session) had left there: one of the
 * ways a project "looks different each time it is opened".
 */

import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';

let layers: typeof import('./layers');
let settingsModule: typeof import('./settings');
let screenSetupsModule: typeof import('./screenSetups');

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

beforeAll(async () => {
  installDomShim();
  layers = await import('./layers');
  settingsModule = await import('./settings');
  screenSetupsModule = await import('./screenSetups');
});

afterEach(() => {
  screenSetupsModule.screenSetups.clearDefault();
});

const output = () => get(settingsModule.settings).output;
function setOutput(patch: Record<string, unknown>) {
  settingsModule.settings.update((s) => ({ ...s, output: { ...s.output, ...patch } }));
}
const SHOW_SETUP = {
  domeEnabled: true, domeFOV: 210, domeTilt: 12,
  outputRotation: 90, outputCropX: 0.1, outputCropWidth: 0.8,
  edgeBlendLeft: 0.15, edgeBlendGamma: 1.8,
  brightness: 0.8, contrast: 1.2, gamma: 0.9,
};
const LEFT_BEHIND = {
  domeEnabled: false, domeFOV: 180, domeTilt: 0,
  outputRotation: 270, outputCropX: 0.3, outputCropWidth: 0.5,
  edgeBlendLeft: 0.4, edgeBlendGamma: 2.6,
  brightness: 1.5, contrast: 0.7, gamma: 1.4,
};
const oldFile = (extra: Record<string, unknown> = {}) => ({
  version: '1.9.5',
  project: { id: 'old', name: 'Old show', width: 1920, height: 1080, layers: [], ...extra },
});

describe('the output stage saves with the project', () => {
  it('lists every output-stage setting as saved or as a live switch', () => {
    const { OUTPUT_STAGE_KEYS, PROJECT_OUTPUT_KEYS, OUTPUT_LIVE_KEYS } = settingsModule;
    expect([...PROJECT_OUTPUT_KEYS, ...OUTPUT_LIVE_KEYS].sort()).toEqual([...OUTPUT_STAGE_KEYS].sort());
    const saved = JSON.parse(JSON.stringify(layers.project.exportProject())).project;
    const dedicated: Record<string, string> = {
      slices: 'outputSlices', masterCanvasWidth: 'outputMasterCanvasWidth',
      masterCanvasHeight: 'outputMasterCanvasHeight', masterWarp: 'outputMasterWarp',
    };
    for (const key of PROJECT_OUTPUT_KEYS) {
      const present = dedicated[key] ? dedicated[key] in saved : key in saved.outputSettings;
      expect(present, `${key} is not saved with the project`).toBe(true);
    }
    for (const key of OUTPUT_LIVE_KEYS) expect(key in saved.outputSettings).toBe(false);
  });

  it('reopens with the dome, rotation, crop, blend and grade it was saved with', () => {
    setOutput(SHOW_SETUP);
    const saved = JSON.parse(JSON.stringify(layers.project.exportProject()));
    setOutput({ ...LEFT_BEHIND, blackout: true });
    expect(layers.project.importProject(saved)).toBe(true);
    expect(output()).toMatchObject(SHOW_SETUP);
    // The blackout is a live switch: opening a project leaves it alone.
    expect(output().blackout).toBe(true);
    setOutput({ blackout: false });
  });

  it('opens an older file at the defaults, not at what the last project left', () => {
    setOutput({ ...LEFT_BEHIND, masterCanvasWidth: 3840, masterWarp: { enabled: true, mode: 'corners' } });
    expect(layers.project.importProject(oldFile())).toBe(true);
    expect(output()).toMatchObject({
      domeEnabled: false, domeFOV: 180, domeTilt: 0, outputRotation: 0, outputCropX: 0, outputCropWidth: 1,
      edgeBlendLeft: 0, edgeBlendGamma: 2.2, brightness: 1, contrast: 1, gamma: 1,
      masterCanvasWidth: 1920, slices: [],
    });
    expect(output().masterWarp).toEqual({ enabled: false, mode: 'corners' });
  });

  it('opens an older file with the saved default screen setup, if there is one', () => {
    setOutput(SHOW_SETUP);
    screenSetupsModule.screenSetups.setCurrentAsDefault('Venue');
    setOutput(LEFT_BEHIND);
    expect(layers.project.importProject(oldFile())).toBe(true);
    expect(output()).toMatchObject(SHOW_SETUP);
  });

  it('ignores a damaged value and uses the default instead', () => {
    setOutput(LEFT_BEHIND);
    expect(layers.project.importProject(oldFile({ outputSettings: { outputRotation: 'sideways', brightness: Number.NaN, domeFOV: 200 } }))).toBe(true);
    expect(output().outputRotation).toBe(0);
    expect(output().brightness).toBe(1);
    expect(output().domeFOV).toBe(200);
  });

  it('leaves the output alone for live state relayed from another window', () => {
    setOutput(SHOW_SETUP);
    expect(layers.project.importProject(oldFile(), undefined, { live: true })).toBe(true);
    expect(output()).toMatchObject(SHOW_SETUP);
  });
});
