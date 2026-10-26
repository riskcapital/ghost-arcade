/**
 * File > New starts from nothing the previous project owned.
 *
 * New reset the project, clips, media, modulation, macros, snapshots, DMX,
 * Ableton links and the cue list, but not keyframes, the sequencer, GeoDeck,
 * the show timeline, OSC / keyboard / MediaPipe bindings, the audio
 * calibration, Stage Designer surfaces, or the Stage 3D and Map Sim scenes.
 * Those leaked into the new project and were saved with it. New and opening
 * an older file now share one list of project-owned stores.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let layers: typeof import('./layers');
let keyframes: typeof import('./keyframeTimeline');
let sequencer: typeof import('./layerSequencer');
let geo: typeof import('./geoDeck');
let audio: typeof import('./audio');
let media: typeof import('./media');
let sim: typeof import('../projectionSim/store');
let stage3d: typeof import('../stage3d/store');
let show: typeof import('./showTimeline');
let cues: typeof import('../show/cueList');
let osc: typeof import('../osc/oscStore');
let keyboard: typeof import('../keyboard/keyboardStore');
let mediaPipe: typeof import('../mediapipe/mediaPipeBus');
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
    getContext: () => null,
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
  keyframes = await import('./keyframeTimeline');
  sequencer = await import('./layerSequencer');
  geo = await import('./geoDeck');
  audio = await import('./audio');
  media = await import('./media');
  sim = await import('../projectionSim/store');
  stage3d = await import('../stage3d/store');
  show = await import('./showTimeline');
  cues = await import('../show/cueList');
  osc = await import('../osc/oscStore');
  keyboard = await import('../keyboard/keyboardStore');
  mediaPipe = await import('../mediapipe/mediaPipeBus');
  macrosModule = await import('./macros');
});

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('File > New', () => {
  it('resets every store a project owns', async () => {
    // What a brand-new project looks like.
    layers.project.newProject('Fresh');
    layers.resetProjectOwnedStores();
    await flush();
    const fresh = {
      geo: geo.geoDeckStore.serialize(),
      sim: get(sim.projectionSimScene).name,
      stage3d: get(stage3d.stage3dScene).name,
      show: JSON.stringify(show.showTimeline.serialize()),
      macros: JSON.stringify(macrosModule.macros.serialize()),
    };

    // A previous project that used all of it.
    const { surfaceStore } = await import('./surface');
    surfaceStore.hydrateFromProject([{ id: 'surf', name: 'Old stage', width: 1920, height: 1080, slices: [] } as any], 'surf');
    keyframes.keyframeTimeline.importAll([{ layerId: 'old', tracks: [{ key: 'opacity', label: 'Opacity', type: 'number', keyframes: [{ time: 0, value: 1, easing: 'linear' }], boolKeyframes: [] }] as any }]);
    sequencer.layerSequencer.hydrate({ isOpen: true, config: { rate: 2 }, pattern: { steps: [{ layers: { old: true } }], continuousLayers: {} } });
    geo.geoDeckStore.hydrate({ ...fresh.geo, scale: 0.95 });
    audio.audioStore.setManualBPM(128);
    audio.audioStore.setBandGain('bass', 2);
    media.mediaLibrary.addItem({ id: 'clip-old', name: 'Old clip', type: 'image', src: '/old.png' } as any);
    sim.projectionSimScene.setName('Last venue');
    stage3d.stage3dScene.setName('Last stage');
    show.showTimeline.hydrate({ version: 1, loop: true, audioTracks: [], presetClips: [{ id: 'clip', presetId: 'p', start: 0, duration: 4 }] });
    cues.cueList.hydrate({ version: 1, cues: [{ id: 'q1', name: 'Opening' }], markers: [] });
    osc.oscStore.hydrate({ enabled: false, port: 9123, outputHost: '10.0.0.9', bindings: [{ id: 'b', address: '/fader', argIndex: 0, path: 'map:layer:old:opacity' } as any] });
    keyboard.keyboardStore.hydrate({ enabled: false, bindings: [{ id: 'k', key: 'q', path: 'map:layer:old:opacity' } as any] });
    mediaPipe.mediaPipeBus.hydrate([{ id: 'm', signalId: 'hand.left.x', path: 'map:layer:old:opacity' }]);

    // The previous project really is in the stores.
    expect(keyframes.keyframeTimeline.exportAll()).toHaveLength(1);
    expect(get(stage3d.stage3dScene).name).toBe('Last stage');
    expect(fresh.stage3d).not.toBe('Last stage');
    expect(JSON.stringify(show.showTimeline.serialize())).not.toBe(fresh.show);
    expect(cues.cueList.state.cues).toHaveLength(1);
    expect(get(osc.oscStore).bindings).toHaveLength(1);
    expect(get(keyboard.keyboardStore).bindings).toHaveLength(1);
    expect(mediaPipe.mediaPipeBus.serialize()).toHaveLength(1);

    layers.project.newProject('Fresh');
    layers.resetProjectOwnedStores();
    await flush();

    expect(get(surfaceStore).surfaces).toEqual([]);
    expect(keyframes.keyframeTimeline.exportAll()).toEqual([]);
    expect(get(sequencer.layerSequencer).isOpen).toBe(false);
    expect(get(sequencer.layerSequencer).pattern.steps.every((step: any) => Object.keys(step.layers ?? {}).length === 0)).toBe(true);
    expect(geo.geoDeckStore.serialize()).toEqual(fresh.geo);
    expect(audio.audioStore.getState().manualBPM).toBeNull();
    expect(audio.audioStore.getState().bandGain.bass).toBe(1);
    expect(get(media.mediaLibrary)).toEqual([]);
    expect(get(sim.projectionSimScene).name).toBe(fresh.sim);
    expect(get(stage3d.stage3dScene).name).toBe(fresh.stage3d);
    expect(JSON.stringify(show.showTimeline.serialize())).toBe(fresh.show);
    expect(cues.cueList.state.cues).toHaveLength(0);
    expect(get(osc.oscStore).bindings).toEqual([]);
    expect(get(keyboard.keyboardStore).bindings).toEqual([]);
    expect(mediaPipe.mediaPipeBus.serialize()).toEqual([]);
    expect(JSON.stringify(macrosModule.macros.serialize())).toBe(fresh.macros);
  });

  it('keeps how this machine is wired to its OSC surface', () => {
    osc.oscStore.hydrate({ enabled: false, port: 9123, outputHost: '10.0.0.9', bindings: [{ id: 'b', address: '/fader', argIndex: 0, path: 'map:layer:old:opacity' } as any] });
    layers.resetProjectOwnedStores();
    const state = get(osc.oscStore);
    expect(state.bindings).toEqual([]);
    expect(state.port).toBe(9123);
    expect(state.outputHost).toBe('10.0.0.9');
  });
});

describe('New and opening an older file share one list', () => {
  const root = process.cwd();
  const layersSource = readFileSync(join(root, 'src/lib/stores/layers.ts'), 'utf8');
  const appSource = readFileSync(join(root, 'src/App.svelte'), 'utf8');

  it('New resets through the shared list', () => {
    const start = appSource.indexOf('function startFreshProject(');
    const body = appSource.slice(start, appSource.indexOf('\n  }', start));
    expect(body).toContain('resetProjectOwnedStores()');
  });

  it('opening a file falls back to the same reset for every section', () => {
    const start = layersSource.indexOf('    importProject(data: unknown');
    const importer = layersSource.slice(start, layersSource.indexOf('    importProjectJSON(', start));
    const missing = Object.keys(layers.PROJECT_SECTION_RESETS)
      .filter((section) => !importer.includes(`resetProjectSection('${section}')`));
    expect(missing, `importProject never resets: ${missing.join(', ')}`).toEqual([]);
  });
});
