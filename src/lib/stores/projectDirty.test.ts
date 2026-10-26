/**
 * Unsaved changes: closing or quitting asks about every edit, and about
 * nothing that only happened while performing.
 *
 * The old check compared a few layer fields, so effects, shader params,
 * blend modes, masks, Screens and VJ clips never counted and closing after
 * editing them lost the edits silently.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { isProjectDirty, projectSettingsSignature, type ProjectDirtySnapshot } from './projectDirty';

let layers: typeof import('./layers');
let types: typeof import('../types');
let historyModule: typeof import('./history');
let hooks: typeof import('./historyHooks');
let keyframes: typeof import('./keyframeTimeline');
let settingsModule: typeof import('./settings');
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

describe('isProjectDirty', () => {
  const at = (stepId: number, settings = 's', counters = 'c'): ProjectDirtySnapshot => ({ stepId, settings, counters });

  it('is clean only when nothing differs from the saved state', () => {
    expect(isProjectDirty(at(3), at(3))).toBe(false);
    expect(isProjectDirty(at(3), at(4))).toBe(true);
    expect(isProjectDirty(at(3), at(3, 'other'))).toBe(true);
    expect(isProjectDirty(at(3), at(3, 's', 'other'))).toBe(true);
  });

  it('treats a project that was never saved (a recovered autosave) as unsaved', () => {
    expect(isProjectDirty(null, at(1))).toBe(true);
  });
});

describe('projectSettingsSignature', () => {
  const base = () => ({
    exportedAt: '2026-10-26T10:00:00Z',
    project: { outputSettings: { domeEnabled: false, brightness: 1 }, outputMasterCanvasWidth: 1920, outputMasterCanvasHeight: 1080 },
    mediaLibrary: [{ id: 'm1', name: 'Clip', type: 'video', src: 'blob:1', thumbnail: 'x' }],
    vjClipLauncher: {
      numLayers: 1, numColumns: 2, groups: [],
      blocks: [{ id: 'b', name: 'Main', clipGrid: [[{ id: 'c1', type: 'video', name: 'Clip', zoom: 1 }, null]], bankBClipGrid: [[null, null]] }],
      layerStates: [{ activeClip: null, activeColumn: null }],
      crossfaderValue: 0,
    },
    modulation: [{ key: '0:speed', mod: { source: 'bass', amount: 0.5, autoPhase: 0.1 } }],
    keyframeSettings: { duration: 30, isLooping: true },
    macros: { macros: [{ id: 'macro-1', name: 'Knob', value: 0.2, assignments: [] }] },
    osc: { enabled: false, port: 9000, bindings: [] },
    abletonBridge: { enabled: false, links: [], linkedCounts: { a: 1 } },
    dmxInput: { universes: [0], bindings: [] },
    keyboard: { enabled: false, bindings: [] },
    mediaPipe: [],
    snapshots: { snapshots: [] },
    audio: { sensitivity: 1, smoothing: 0.3, manualBPM: null, bandGain: {} },
    layerSequencer: { isOpen: false, pattern: { steps: [] }, config: { rate: 1 } },
    geoDeck: { scale: 0.5, sceneSlots: [], modRoutes: [] },
  });
  const sig = (exported: any, showTimeline: unknown = { isOpen: false, zoom: 1, loop: false, audioTracks: [{ id: 't', url: 'blob:a' }], presetClips: [] }, showControl: unknown = { cues: { cues: [] } }) =>
    projectSettingsSignature({ exported, showTimeline, showControl });

  it('ignores what changes while performing or looking around', () => {
    const before = sig(base());
    const played = base();
    played.exportedAt = '2026-10-26T11:00:00Z';
    played.macros.macros[0].value = 0.9;
    played.vjClipLauncher.layerStates[0].activeClip = { id: 'c1' } as any;
    played.vjClipLauncher.crossfaderValue = 0.7;
    played.modulation[0].mod.autoPhase = 0.8;
    played.abletonBridge.linkedCounts = { a: 2 };
    played.layerSequencer.isOpen = true;
    played.geoDeck.scale = 0.9;
    played.mediaLibrary[0].src = 'ghost-asset://clip.mp4';
    expect(sig(played, { isOpen: true, zoom: 3, loop: false, audioTracks: [{ id: 't', url: 'ghost-asset://a' }], presetClips: [] })).toBe(before);
  });

  it('counts edits to settings undo does not cover', () => {
    const before = sig(base());
    const edits: Array<(p: any) => void> = [
      (p) => { p.project.outputSettings.domeEnabled = true; },
      (p) => { p.project.outputMasterCanvasWidth = 3840; },
      (p) => { p.mediaLibrary.push({ id: 'm2', name: 'New', type: 'image' }); },
      (p) => { p.vjClipLauncher.blocks[0].clipGrid[0][1] = { id: 'c2', type: 'image', name: 'Still' }; },
      (p) => { p.modulation[0].mod.amount = 0.9; },
      (p) => { p.macros.macros[0].assignments.push({ path: 'map:layer:x:opacity' }); },
      (p) => { p.osc.bindings.push({ address: '/x' }); },
      (p) => { p.audio.manualBPM = 128; },
      (p) => { p.layerSequencer.pattern.steps.push({ layers: { a: true } }); },
      (p) => { p.keyframeSettings.duration = 60; },
    ];
    for (const edit of edits) {
      const changed = base();
      edit(changed);
      expect(sig(changed), edit.toString()).not.toBe(before);
    }
    expect(sig(base(), undefined, { cues: { cues: [{ id: 'q1' }] } })).not.toBe(before);
  });
});

describe('with the real stores', () => {
  beforeAll(async () => {
    installDomShim();
    layers = await import('./layers');
    types = await import('../types');
    historyModule = await import('./history');
    hooks = await import('./historyHooks');
    keyframes = await import('./keyframeTimeline');
    settingsModule = await import('./settings');
    macrosModule = await import('./macros');
  });

  const capture = () => ({ project: get(layers.project), keyframes: keyframes.keyframeTimeline.exportAll(), output: settingsModule.settings.captureOutputHistory() });
  const snapshot = (): ProjectDirtySnapshot => ({
    stepId: historyModule.history.currentStepId(),
    settings: projectSettingsSignature({ exported: layers.project.exportProject() as any }),
    counters: '',
  });
  const dirty = (saved: ProjectDirtySnapshot) => {
    hooks.flushPendingHistorySnapshot();
    return isProjectDirty(saved, snapshot());
  };
  const undo = () => {
    hooks.flushPendingHistorySnapshot();
    const step = historyModule.history.undo(get(layers.project));
    if (step) layers.project.set(step.project);
  };

  beforeEach(() => {
    hooks.setHistoryCallback(() => { const c = capture(); historyModule.history.record(c.project, c.keyframes, c.output); }, {
      capture,
      commit: (c: any) => historyModule.history.record(c.project, c.keyframes, c.output),
    });
    const layer = types.createLayer('a', 'A', 'color');
    layer.effects = [{ id: 'fx', type: 'blur' as any, enabled: true, params: { amount: 0.2 } as any, opacity: 1 }];
    expect(layers.project.importProject({ version: '2.1.10', project: { id: 'p', name: 'P', width: 1920, height: 1080, layers: [layer] } })).toBe(true);
    const c = capture();
    historyModule.history.init(c.project, c.keyframes, c.output);
  });

  afterEach(() => {
    vi.useRealTimers();
    hooks.setHistoryCallback(() => {});
  });

  it('counts an effect param edit, even before its undo step is recorded', () => {
    vi.useFakeTimers();
    const saved = snapshot();
    expect(dirty(saved)).toBe(false);
    layers.project.updateEffectParams('a', 'fx', { amount: 0.8 } as any);
    hooks.scheduleHistorySnapshot('effect-params:a:fx:amount');
    // Before the undo debounce has even run.
    expect(dirty(saved)).toBe(true);
  });

  it('is clean again after undoing back to the saved state', () => {
    const saved = snapshot();
    layers.project.setLayerBlendMode('a', 'screen');
    expect(dirty(saved)).toBe(true);
    undo();
    expect(dirty(saved)).toBe(false);
  });

  it('does not count live control or automation', () => {
    const saved = snapshot();
    layers.project.updateLayer('a', { opacity: 0.3 }, { history: false });
    layers.project.updateEffectParams('a', 'fx', { amount: 0.6 } as any);
    macrosModule.macros.setMacroValue('macro-1', 0.75);
    expect(dirty(saved)).toBe(false);
  });

  it('counts output settings, which undo does not cover', () => {
    const saved = snapshot();
    settingsModule.settings.setDomeEnabled(!get(settingsModule.settings).output.domeEnabled);
    expect(dirty(saved)).toBe(true);
    settingsModule.settings.setDomeEnabled(!get(settingsModule.settings).output.domeEnabled);
  });
});
