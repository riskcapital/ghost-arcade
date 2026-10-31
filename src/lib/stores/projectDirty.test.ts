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
    musicStudio: {
      set: 'berlin', params: { energy: 0.5 }, octave: 0, velocity: 0.8, drumMutes: [],
      pattern: { steps: 16, kick: [true] }, takes: [] as any[],
      mixer: { drums: { low: 0, mid: 0, high: 0, pan: 0, mute: false, solo: false } },
      liveControl: false,
    },
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
    played.abletonBridge.linkedCounts = { a: 2 };
    played.layerSequencer.isOpen = true;
    played.geoDeck.scale = 0.9;
    played.mediaLibrary[0].src = 'ghost-asset://clip.mp4';
    played.audio.manualBPM = 128 as any;
    played.musicStudio.params.energy = 0.9;
    played.musicStudio.octave = 1;
    played.musicStudio.velocity = 1;
    played.musicStudio.drumMutes = ['kick'] as any;
    played.musicStudio.mixer.drums.mute = true;
    played.musicStudio.mixer.drums.solo = true;
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
      (p) => { p.project.surfaces = [{ id: 's', slices: [{ id: 'a' }] }]; },
      (p) => { p.layerSequencer.pattern.steps.push({ layers: { a: true } }); },
      (p) => { p.keyframeSettings.duration = 60; },
      (p) => { p.musicStudio.pattern.kick = [false]; },
      (p) => { p.musicStudio.takes.push({ id: 't1', events: [] }); },
      (p) => { p.musicStudio.mixer.drums.low = 6; },
      (p) => { p.musicStudio.liveControl = true; },
    ];
    for (const edit of edits) {
      const changed = base();
      edit(changed);
      expect(sig(changed), edit.toString()).not.toBe(before);
    }
    expect(sig(base(), undefined, { cues: { cues: [{ id: 'q1' }] } })).not.toBe(before);
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
    const savedSections = projectSettingsSections({ exported: saved, stage3d: { schemaVersion: 1, nodes: [] } });

    // The recall-side signatures are the same text the full signature holds.
    expect(recallSectionSignature('sequencer', saved.layerSequencer)).toBe(savedSections.sequencer);
    expect(recallSectionSignature('keyframeSettings', saved.keyframeSettings)).toBe(savedSections.keyframeSettings);
    expect(recallSectionSignature('surfaces', saved.project.surfaces)).toBe(savedSections.surfaces);
    expect(recallSectionSignature('stage3d', { schemaVersion: 1, nodes: [] })).toBe(savedSections.stage3d);

    // A show cue recalls a preset with its own pattern and keyframe settings.
    const recalled = base() as any;
    recalled.project.surfaces = saved.project.surfaces;
    recalled.layerSequencer.pattern = { steps: [{ layers: { a: true } }] };
    recalled.keyframeSettings = { duration: 12, isLooping: false };
    const imprint = {
      sequencer: recallSectionSignature('sequencer', recalled.layerSequencer),
      keyframeSettings: recallSectionSignature('keyframeSettings', recalled.keyframeSettings),
    };
    const nowSections = projectSettingsSections({ exported: recalled, stage3d: { schemaVersion: 1, nodes: [] } });
    expect(JSON.stringify(nowSections)).not.toBe(JSON.stringify(savedSections));
    expect(JSON.stringify(withRecallsAsSaved(nowSections, imprint, savedSections))).toBe(JSON.stringify(savedSections));

    // An edit after the recall counts again.
    recalled.layerSequencer.pattern = { steps: [{ layers: { a: false } }] };
    const edited = projectSettingsSections({ exported: recalled, stage3d: { schemaVersion: 1, nodes: [] } });
    expect(JSON.stringify(withRecallsAsSaved(edited, imprint, savedSections))).not.toBe(JSON.stringify(savedSections));
    // Other sections are never read as saved.
    recalled.osc.bindings.push({ address: '/x' });
    const oscEdit = projectSettingsSections({ exported: recalled, stage3d: { schemaVersion: 1, nodes: [] } });
    expect(withRecallsAsSaved(oscEdit, imprint, savedSections).osc).not.toBe(savedSections.osc);
  });

  it("leaves a clip's settings to the VJ edit counter, so live control moving them is not an edit", () => {
    const withClip = (effectSource: any) => {
      const p = base();
      p.vjClipLauncher.blocks[0].clipGrid[0][1] = { id: 'c2', type: 'effect', name: 'Plugin', effectSource } as any;
      return sig(p);
    };
    const voices = (level: number) => ({ effectType: 'music-studio', musicSet: 'dub', musicSceneId: null, musicVoices: [{ file: 'VX-Scope.fs', source: 'lead', auto: true, level, params: {} }] });
    expect(withClip(voices(1))).toBe(withClip(voices(0.5)));
    expect(withClip({ effectType: 'ghostfx', amount: 0.2 })).toBe(withClip({ effectType: 'ghostfx', amount: 0.9 }));
  });

  it('reads the studio setup a song put back as saved, and its songs and other edits as edits', () => {
    const studio = (patch: Record<string, unknown> = {}) => ({
      set: 'bath', key: { root: 2, scale: 'dorian' }, dronePatch: 'warm', params: { 'drone.tone': 0.3 },
      mixer: { drone: { low: 0, mid: 0, high: 0, pan: 0, mute: false, solo: false }, input2: { low: 0, mid: 0, high: 0, pan: 0, mute: false, solo: false } },
      liveInputs: [{ role: 'lead' }], bandFx: { echoSend: 0 }, visuals: {}, songs: [], setlists: [], currentSongId: null, setlistCursor: -1,
      ...patch,
    });
    const sections = (st: Record<string, unknown>) => projectSettingsSections({ exported: { project: {}, musicStudio: st } });
    const saved = sections(studio());
    // A song brings back another set and drone, and another role on the band's input.
    const played = studio({ set: 'dub', dronePatch: 'choir', liveInputs: [{ role: 'bass' }], currentSongId: 's1', setlistCursor: 0 });
    const now = sections(played);
    expect(now.studioSound).not.toBe(saved.studioSound);
    expect(now.musicStudio).toBe(saved.musicStudio);
    const imprint = { studioSound: recallSectionSignature('studioSound', played), studioBand: recallSectionSignature('studioBand', played) };
    expect(withRecallsAsSaved(now, imprint, saved)).toEqual(saved);
    // A knob or a band input's mute is playing; a new song is an edit.
    expect(sections(studio({ params: { 'drone.tone': 0.9 } }))).toEqual(saved);
    expect(sections(studio({ songs: [{ id: 's1' }] })).musicStudio).not.toBe(saved.musicStudio);
    // The band input strips go with the band, the instruments' with the sound.
    const panned = sections(studio({ mixer: { drone: { low: 0, mid: 0, high: 0, pan: 0, mute: false, solo: false }, input2: { low: 0, mid: 0, high: 0, pan: 0.5, mute: true, solo: false } } }));
    expect(panned.studioSound).toBe(saved.studioSound);
    expect(panned.studioBand).not.toBe(saved.studioBand);
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

  it("makes a slider drag on a plugin layer one undo step, and a discrete edit its own", () => {
    vi.useFakeTimers();
    const studio = (level: number, file = 'VX-Scope.fs') => ({
      id: 'src', type: 'effect', name: 'Music Studio', src: 'plugin://musicstudio',
      effectSource: { effectType: 'music-studio', musicSet: 'dub', musicSceneId: null, musicVoices: [{ file, source: 'lead', auto: true, level, params: {} }] },
    }) as any;
    const level = () => (get(layers.project).layers[0].source as any).effectSource.musicVoices[0].level;
    const file = () => (get(layers.project).layers[0].source as any).effectSource.musicVoices[0].file;
    layers.project.setLayerSource('a', studio(1));
    vi.advanceTimersByTime(100);
    // A drag: many updates, one gesture.
    for (let i = 1; i <= 30; i++) {
      layers.project.setLayerSource('a', studio(1 - i / 60), { gesture: 'voice:0:level' });
      vi.advanceTimersByTime(16);
    }
    vi.advanceTimersByTime(700);
    // Then a discrete edit.
    layers.project.setLayerSource('a', studio(0.5, 'VX-Smoke.fs'));
    expect(file()).toBe('VX-Smoke.fs');
    undo();
    expect(file()).toBe('VX-Scope.fs');
    expect(level()).toBe(0.5);
    undo();
    expect(level()).toBe(1);
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
    // A stage preset carries the 3D scene it was saved with.
    expect(seen).toEqual([['stage3d']]);
  });
});
