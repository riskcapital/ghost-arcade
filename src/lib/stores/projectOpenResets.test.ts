/**
 * Opening a project replaces everything the project owns.
 *
 * Sections were only restored when the file carried them. A file saved by an
 * older build, without a step sequencer, GeoDeck, audio calibration,
 * SynthVision, media library or Map Sim scene, kept the previous project's in
 * their place — and the next save wrote them into this project. A file saved
 * without a manual BPM kept the last project's BPM. Each now resets to its
 * default when the file does not carry it. Live state relayed from another
 * window still leaves absent sections alone.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';

let layers: typeof import('./layers');
let sequencer: typeof import('./layerSequencer');
let geo: typeof import('./geoDeck');
let audio: typeof import('./audio');
let media: typeof import('./media');
let sim: typeof import('../projectionSim/store');
let synth: typeof import('./synthVision');

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
  sequencer = await import('./layerSequencer');
  geo = await import('./geoDeck');
  audio = await import('./audio');
  media = await import('./media');
  sim = await import('../projectionSim/store');
  synth = await import('./synthVision');
});

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const fileFrom = (version: string, extra: Record<string, unknown> = {}) => ({
  version,
  project: { id: 'p', name: 'Show', width: 1920, height: 1080, layers: [] },
  ...extra,
});

/** Leave every project-owned store somewhere other than its default. */
function dirtyEverything() {
  sequencer.layerSequencer.hydrate({ isOpen: true, config: { bpmSync: false, rate: 2 }, pattern: { steps: [{ layers: { a: true } }], continuousLayers: {} } });
  geo.geoDeckStore.hydrate({ ...geo.geoDeckStore.serialize(), scale: 0.95, depth: 0.1 });
  audio.audioStore.setManualBPM(128);
  audio.audioStore.setSensitivity(2.5);
  audio.audioStore.setBandGain('bass', 2);
  media.mediaLibrary.addItem({ id: 'clip-old', name: 'Old clip', type: 'image', src: '/old.png' } as any);
  sim.projectionSimScene.setName('Last venue');
}

describe('opening a file that lacks a section resets it', () => {
  it('resets the sequencer, GeoDeck, audio calibration, media library and Map Sim', async () => {
    geo.geoDeckStore.reset();
    const defaultGeo = geo.geoDeckStore.serialize();
    sim.projectionSimScene.resetForProject();
    const defaultSimName = get(sim.projectionSimScene).name;

    dirtyEverything();
    expect(layers.project.importProject(fileFrom('1.8.0'))).toBe(true);
    await flush();

    const seq = get(sequencer.layerSequencer);
    expect(seq.isOpen).toBe(false);
    expect(seq.pattern.steps.every((step: any) => Object.keys(step.layers ?? {}).length === 0)).toBe(true);
    expect(geo.geoDeckStore.serialize()).toEqual(defaultGeo);
    const a = audio.audioStore.getState();
    expect(a.manualBPM).toBeNull();
    expect(a.sensitivity).toBe(1);
    expect(a.bandGain.bass).toBe(1);
    expect(get(media.mediaLibrary)).toEqual([]);
    expect(get(sim.projectionSimScene).name).toBe(defaultSimName);
  });

  it('resets SynthVision when the file has none', async () => {
    synth.synthVisionStore.reset();
    const fresh = synth.synthVisionStore.getSerializable();
    synth.synthVisionStore.loadSerializable({ ...fresh, xfade: 0.77, bpm: 171 });
    expect(synth.synthVisionStore.getSerializable()).not.toEqual(fresh);
    expect(layers.project.importProject(fileFrom('1.8.0'))).toBe(true);
    expect(synth.synthVisionStore.getSerializable()).toEqual(fresh);
  });

  it('does not keep the last project\'s manual BPM when the file has none', () => {
    audio.audioStore.setManualBPM(140);
    expect(layers.project.importProject(fileFrom('1.9.3', { audio: { sensitivity: 1.5, smoothing: 0.4, manualBPM: null, bandGain: { mid: 0.5 } } }))).toBe(true);
    const a = audio.audioStore.getState();
    expect(a.manualBPM).toBeNull();
    expect(a.sensitivity).toBe(1.5);
    expect(a.smoothing).toBe(0.4);
    expect(a.bandGain.mid).toBe(0.5);
    expect(a.bandGain.bass).toBe(1);
  });

  it('restores a saved manual BPM', () => {
    expect(layers.project.importProject(fileFrom('1.9.3', { audio: { manualBPM: 124 } }))).toBe(true);
    expect(audio.audioStore.getState().manualBPM).toBe(124);
  });

  it('leaves absent sections alone for live state relayed from another window', async () => {
    dirtyEverything();
    expect(layers.project.importProject(fileFrom('1.8.0'), undefined, { live: true })).toBe(true);
    await flush();
    expect(get(sequencer.layerSequencer).isOpen).toBe(true);
    expect(audio.audioStore.getState().manualBPM).toBe(128);
    expect(get(media.mediaLibrary).map((item: any) => item.id)).toContain('clip-old');
    expect(get(sim.projectionSimScene).name).toBe('Last venue');
  });
});
