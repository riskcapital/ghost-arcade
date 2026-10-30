/**
 * The music studio saves with the project: a recorded take, its beat pattern
 * and the instrument and note-visual settings come back when the file opens,
 * a file without the studio opens with a fresh one, and live state relayed
 * from another window never stops what is playing.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';

let layers: typeof import('../stores/layers');
let studio: typeof import('./musicStudioStore');

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
  layers = await import('../stores/layers');
  studio = await import('./musicStudioStore');
});

const take = {
  id: 'take-a',
  name: 'Take 1',
  createdAt: 1,
  length: 2,
  bpm: 124,
  events: [
    { t: 0.1, type: 'on', instrument: 'keys', note: 64, velocity: 0.7 },
    { t: 0.6, type: 'off', instrument: 'keys', note: 64, velocity: 0 },
    { t: 1, type: 'on', instrument: 'drums', note: 36, velocity: 1 },
  ],
  pattern: null,
} as const;

function playSomething(): void {
  const s = studio.musicStudio;
  s.setInstrument('keys');
  s.setKeysPatch('bell');
  s.setVisualMode('keys', 'build');
  s.toggleStep('crash', 3);
  s.addTake(JSON.parse(JSON.stringify(take)));
  s.addScene({ id: 'scene-a', name: 'Arrival', pattern: null, beat: true, takeId: 'take-a', vjColumn: 2, loops: { bass: 'bass-sub' } });
  s.setSet('berlin');
  s.setParam('drone.tone', 0.9);
  s.connectCable({ id: 'c1', from: 'cv:drum.hatClosed', to: 'dest:layer:1' });
}

describe('music studio in the project file', () => {
  it('saves and reopens the takes, pattern and settings', () => {
    playSomething();
    const saved = JSON.parse(JSON.stringify(layers.project.exportProject()));
    expect(saved.musicStudio.takes).toHaveLength(1);

    studio.musicStudio.hydrate(null);
    expect(get(studio.musicStudio).takes).toHaveLength(0);

    expect(layers.project.importProject(saved)).toBe(true);
    const s = get(studio.musicStudio);
    expect(s.instrument).toBe('keys');
    expect(s.keysPatch).toBe('bell');
    expect(s.visuals.keys.mode).toBe('build');
    expect(s.pattern.tracks.crash[3]).toBeGreaterThan(0);
    expect(s.takes).toEqual([take]);
    expect(s.scenes).toEqual([{ id: 'scene-a', name: 'Arrival', pattern: null, beat: true, takeId: 'take-a', vjColumn: 2, loops: { bass: 'bass-sub' } }]);
    expect(s.set).toBe('berlin');
    expect(s.params['drone.tone']).toBe(0.9);
    expect(s.cables.berlin).toContainEqual({ id: 'c1', from: 'cv:drum.hatClosed', to: 'dest:layer:1' });
  });

  it('opens an older file with a fresh studio, not the last project\'s', () => {
    playSomething();
    const older = { version: '1.9.5', project: { id: 'p', name: 'Show', width: 1920, height: 1080, layers: [] } };
    expect(layers.project.importProject(older)).toBe(true);
    const s = get(studio.musicStudio);
    expect(s.takes).toHaveLength(0);
    expect(s.instrument).toBe('synth');
    expect(s.visuals.keys.mode).toBe('fade');
    expect(s.scenes).toHaveLength(0);
    expect(s.set).toBe('bath');
    expect(s.params['drone.tone']).toBe(0.35);
  });

  it('leaves the studio alone for live state relayed from another window', () => {
    playSomething();
    studio.musicStudio.setTransport({ sequencerPlaying: true });
    const relayed = { version: '1.9.5', project: { id: 'p', name: 'Show', width: 1920, height: 1080, layers: [] }, musicStudio: { takes: [] } };
    expect(layers.project.importProject(relayed, undefined, { live: true })).toBe(true);
    const s = get(studio.musicStudio);
    expect(s.sequencerPlaying).toBe(true);
    expect(s.takes.length).toBeGreaterThan(0);
  });

  it('File > New resets the studio', () => {
    playSomething();
    layers.PROJECT_SECTION_RESETS.musicStudio();
    expect(get(studio.musicStudio).takes).toHaveLength(0);
  });
});
