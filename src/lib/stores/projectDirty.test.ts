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
import { isProjectDirty, projectSettingsSections, projectSettingsSignature, recallSectionSignature, withRecallsAsSaved, type ProjectDirtySnapshot } from './projectDirty';

let layers: typeof import('./layers');
let types: typeof import('../types');
let historyModule: typeof import('./history');
let hooks: typeof import('./historyHooks');
let keyframes: typeof import('./keyframeTimeline');
let settingsModule: typeof import('./settings');
let macrosModule: typeof import('./macros');
let appHistory: typeof import('./appHistory');
let screens: typeof import('./screens');

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
    project: {
      outputSettings: { domeEnabled: false, brightness: 1 }, outputMasterCanvasWidth: 1920, outputMasterCanvasHeight: 1080,
      outputSlices: [] as any[], outputMasterWarp: { enabled: false, mode: 'corners' },
      surfaces: [] as any[], activeSurfaceId: null, mediaFolders: [] as any[],
    },
    keyframeTimelines: [] as any[],
    mediaLibrary: [{ id: 'm1', name: 'Clip', type: 'video', src: 'blob:1', thumbnail: 'x' }],
    vjClipLauncher: {
      numLayers: 1, numColumns: 2, groups: [],
      blocks: [{ id: 'b', name: 'Main', clipGrid: [[{ id: 'c1', type: 'video', name: 'Clip', zoom: 1 }, null]], bankBClipGrid: [[null, null]] }],
      layerStates: [{ activeClip: null, activeColumn: null }],
      crossfaderValue: 0,
    },
    modulation: [{ key: '0:speed', mod: { source: 'bass', amount: 0.5, autoPhase: 0.1 } }],
    macros: { macros: [{ id: 'macro-1', name: 'Knob', value: 0.2, assignments: [] }] },
    osc: { enabled: false, port: 9000, bindings: [] },
    dmxInput: { universes: [0], bindings: [] },
    keyboard: { enabled: false, bindings: [] },
    mediaPipe: [],
    snapshots: { snapshots: [] },
    audio: { sensitivity: 1, smoothing: 0.3, manualBPM: null, bandGain: {} },
    layerSequencer: { isOpen: false, pattern: { steps: [] }, config: { rate: 1 } },
    geoDeck: { scale: 0.5, sceneSlots: [], modRoutes: [] },
  });
  const sig3d = (stage3d: unknown) => projectSettingsSignature({ exported: base(), stage3d });
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
    played.layerSequencer.isOpen = true;
    played.geoDeck.scale = 0.9;
    played.mediaLibrary[0].src = 'ghost-asset://clip.mp4';
    played.audio.manualBPM = 128 as any;
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
      (p) => { p.audio.sensitivity = 2; },
      (p) => { p.layerSequencer.pattern.steps.push({ layers: { a: true } }); },
      (p) => { p.keyframeTimelines.push({ layerId: 'a', tracks: [] }); },
      (p) => { p.project.outputSlices.push({ id: 's1' }); },
      (p) => { p.project.outputMasterWarp.enabled = true; },
      (p) => { p.project.surfaces.push({ id: 'surf' }); },
      (p) => { p.project.mediaFolders.push({ id: 'f', name: 'F', tab: 'videos', itemIds: [] }); },
    ];
    for (const edit of edits) {
      const changed = base();
      edit(changed);
      expect(sig(changed), edit.toString()).not.toBe(before);
    }
    expect(sig(base(), undefined, { cues: { cues: [{ id: 'q1' }] } })).not.toBe(before);
  });

  it('does not count what decoding a show audio track measures', () => {
    const show = (track: Record<string, unknown>) => ({ isOpen: false, zoom: 1, loop: false, presetClips: [], audioTracks: [{ id: 't', url: '', startTime: 2, offset: 0, volume: 1, muted: false, lane: 0, ...track }] });
    // An older save: no waveform, length still the placeholder.
    const saved = sig(base(), show({ duration: 0.25, sourceDuration: 0 }));
    expect(sig(base(), show({ duration: 184.5, sourceDuration: 184.5, peaks: [1, 9, 4], url: 'blob:x' }))).toBe(saved);
    // Saved without its waveform; the decode adds it.
    const trimmed = sig(base(), show({ duration: 30, sourceDuration: 184.5 }));
    expect(sig(base(), show({ duration: 30, sourceDuration: 184.5, peaks: [1, 9, 4] }))).toBe(trimmed);
    // Trimming, moving and the volume still count.
    const full = sig(base(), show({ duration: 184.5, sourceDuration: 184.5, peaks: [1] }));
    expect(sig(base(), show({ duration: 90, sourceDuration: 184.5, peaks: [1] }))).not.toBe(full);
    expect(sig(base(), show({ duration: 184.5, sourceDuration: 184.5, peaks: [1], startTime: 4 }))).not.toBe(full);
    expect(sig(base(), show({ duration: 184.5, sourceDuration: 184.5, peaks: [1], volume: 0.5 }))).not.toBe(full);
  });

  it('counts Stage 3D edits without copying its models, and not a running stage effect show', () => {
    const model = 'data:model/gltf-binary;base64,' + 'A'.repeat(200_000);
    const scene = (x: number) => ({ schemaVersion: 1, nodes: [{ id: 'truss', x }], venueModel: model });
    expect(sig3d(scene(1))).toBe(sig3d(scene(1)));
    expect(sig3d(scene(1))).not.toBe(sig3d(scene(2)));
    expect(sig3d(scene(1)).length).toBeLessThan(20_000);

    const surfaces = (active: string, playing: boolean) => {
      const p = base() as any;
      p.project.surfaces = [{ id: 's', slices: [], activeEffectId: active, effectAutomation: { playing, steps: [1] } }];
      return sig(p);
    };
    expect(surfaces('a', false)).toBe(surfaces('b', true));
  });

  it('reads sections as saved while they are as an automated recall left them', () => {
    const saved = base() as any;
    saved.project.surfaces = [{ id: 's', slices: [] }];
    saved.project.activeSurfaceId = 's';
    const scene = { schemaVersion: 1, nodes: [] };
    const savedSections = projectSettingsSections({ exported: saved, stage3d: scene });

    // The recall-side signatures are the same text the full signature holds.
    expect(recallSectionSignature('sequencer', saved.layerSequencer)).toBe(savedSections.sequencer);
    expect(recallSectionSignature('keyframes', saved.keyframeTimelines)).toBe(savedSections.keyframes);
    expect(recallSectionSignature('surfaces', { surfaces: saved.project.surfaces, activeSurfaceId: 's' })).toBe(savedSections.surfaces);
    expect(recallSectionSignature('stage3d', scene)).toBe(savedSections.stage3d);

    // A show cue recalls a preset with its own pattern and keyframes.
    const recalled = base() as any;
    recalled.project.surfaces = saved.project.surfaces;
    recalled.project.activeSurfaceId = 's';
    recalled.layerSequencer.pattern = { steps: [{ layers: { a: true } }] };
    recalled.keyframeTimelines = [{ layerId: 'a', tracks: [{ key: 'opacity' }] }];
    const imprint = {
      sequencer: recallSectionSignature('sequencer', recalled.layerSequencer),
      keyframes: recallSectionSignature('keyframes', recalled.keyframeTimelines),
    };
    const nowSections = projectSettingsSections({ exported: recalled, stage3d: scene });
    expect(JSON.stringify(nowSections)).not.toBe(JSON.stringify(savedSections));
    expect(JSON.stringify(withRecallsAsSaved(nowSections, imprint, savedSections))).toBe(JSON.stringify(savedSections));

    // An edit after the recall counts again.
    recalled.layerSequencer.pattern = { steps: [{ layers: { a: false } }] };
    const edited = projectSettingsSections({ exported: recalled, stage3d: scene });
    expect(JSON.stringify(withRecallsAsSaved(edited, imprint, savedSections))).not.toBe(JSON.stringify(savedSections));
    // Other sections are never read as saved.
    recalled.osc.bindings.push({ address: '/x' });
    const oscEdit = projectSettingsSections({ exported: recalled, stage3d: scene });
    expect(withRecallsAsSaved(oscEdit, imprint, savedSections).osc).not.toBe(savedSections.osc);
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
    appHistory = await import('./appHistory');
    screens = await import('./screens');
  });

  const snapshot = (): ProjectDirtySnapshot => ({
    stepId: historyModule.history.currentStepId(),
    settings: projectSettingsSignature({ exported: layers.project.exportProject() as any }),
    counters: '',
  });
  const dirty = (saved: ProjectDirtySnapshot) => {
    hooks.flushPendingHistorySnapshot();
    return isProjectDirty(saved, snapshot());
  };
  const undo = () => appHistory.undoHistory();

  beforeEach(() => {
    appHistory.wireAppHistory();
    const layer = types.createLayer('a', 'A', 'color');
    layer.effects = [{ id: 'fx', type: 'blur' as any, enabled: true, params: { amount: 0.2 } as any, opacity: 1 }];
    expect(layers.project.importProject({ version: '1.9.3', project: { id: 'p', name: 'P', width: 1920, height: 1080, layers: [layer] } })).toBe(true);
    appHistory.resetHistoryToCurrent();
  });

  afterEach(() => {
    vi.useRealTimers();
    hooks.setHistoryCallback(() => {});
    hooks.setProjectReplacedCallback(null);
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

  it('counts a keyframe edit, and is clean again once it is undone', () => {
    const saved = snapshot();
    keyframes.keyframeTimeline.addKeyframe('a', 'opacity', 0, 0.5);
    expect(dirty(saved)).toBe(true);
    undo();
    expect(keyframes.keyframeTimeline.exportAll()).toEqual([]);
    expect(dirty(saved)).toBe(false);
  });

  it('counts keyframes changed without a step', () => {
    const saved = snapshot();
    hooks.beginHistoryRestore();
    try {
      keyframes.keyframeTimeline.addKeyframe('a', 'opacity', 0, 0.5);
    } finally {
      hooks.endHistoryRestore();
    }
    expect(dirty(saved)).toBe(true);
    expect(get(historyModule.history).past).toHaveLength(0);
    keyframes.keyframeTimeline.reset();
    expect(dirty(saved)).toBe(false);
  });

  it('counts a Screen edit, and is clean again once it is undone', () => {
    const saved = snapshot();
    screens.screenActions.add();
    expect(dirty(saved)).toBe(true);
    undo();
    expect(dirty(saved)).toBe(false);
  });

  it('counts a Screen change made without a step (a Stage 3D sync)', () => {
    const saved = snapshot();
    const slices = get(settingsModule.settings).output.slices;
    settingsModule.settings.update((s) => ({ ...s, output: { ...s.output, slices: [...slices, { id: 'screen-x' } as any] } }));
    expect(dirty(saved)).toBe(true);
    expect(get(historyModule.history).past).toHaveLength(0);
    settingsModule.settings.update((s) => ({ ...s, output: { ...s.output, slices } }));
    expect(dirty(saved)).toBe(false);
  });
});

describe('automated stage preset recalls', () => {
  it('are noted as recalls and are not VJ edits', async () => {
    vi.useFakeTimers();
    const vj = await import('./vjClipLauncher');
    const id = layers.project.saveStagePreset('Look A');
    const before = get(vj.vjEditVersion);
    const seen: string[][] = [];
    const stop = layers.automatedRecalls.subscribe(({ count, sections }) => { if (count) seen.push(sections); });
    layers.project.loadStagePreset(id, { history: false });
    vi.runAllTimers();
    stop();
    expect(get(vj.vjEditVersion)).toBe(before);
    // A user's recall of the same preset is an edit.
    layers.project.loadStagePreset(id);
    expect(get(vj.vjEditVersion)).toBeGreaterThan(before);
    vi.useRealTimers();
    expect(seen.length).toBeLessThanOrEqual(1);
  });
});
