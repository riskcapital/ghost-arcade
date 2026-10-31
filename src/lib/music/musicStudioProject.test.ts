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

  it('keeps the mixer, the live input and Live control', () => {
    const s = studio.musicStudio;
    s.setStrip('drums', { low: 6, pan: -0.5 });
    s.setLiveInput(0, { role: 'bass', sensitivity: 0.8, monitor: false });
    s.setLiveControl(true);
    s.setLiveRole('Bass', 'bass');
    const saved = JSON.parse(JSON.stringify(layers.project.exportProject()));
    s.hydrate(null);
    expect(get(s).liveControl).toBe(false);
    expect(layers.project.importProject(saved)).toBe(true);
    const after = get(s);
    expect(after.mixer.drums).toMatchObject({ low: 6, pan: -0.5 });
    expect(after.liveInputs[0]).toMatchObject({ role: 'bass', sensitivity: 0.8, monitor: false });
    expect(after.liveControl).toBe(true);
    expect(after.liveRoles).toEqual({ Bass: 'bass' });
  });

  it('keeps the bowls, the FX pads, the drone sound and the band effects', () => {
    const s = studio.musicStudio;
    s.setSet('bath');
    s.setBowlSlot(0, { sound: 'gong', octave: -1 });
    s.setFxPad(2, 'thunder');
    s.setDronePatch('choir');
    s.setBandFx({ echoSend: 0.4, echoTime: '1/4', freezePitch: 12 });
    const saved = JSON.parse(JSON.stringify(layers.project.exportProject()));
    s.hydrate(null);
    expect(get(s).dronePatch).toBe('warm');
    expect(layers.project.importProject(saved)).toBe(true);
    const after = get(s);
    expect(after.bowlSlots[0]).toEqual({ sound: 'gong', octave: -1 });
    expect(after.fxPads.bath[2]).toBe('thunder');
    expect(after.dronePatch).toBe('choir');
    expect(after.bandFx).toMatchObject({ echoSend: 0.4, echoTime: '1/4', freezePitch: 12 });
  });

  it('keeps the band inputs, the songs and the set lists', async () => {
    const { captureSetup, defaultRecall, emptySongVisuals } = await import('./songs');
    const s = studio.musicStudio;
    s.hydrate(null);
    s.setLiveInput(0, { name: 'Bass', channel: 0, role: 'bass' });
    expect(s.addLiveInput({ name: 'Guitar', channel: 1, role: 'lead', fxSend: 0.4 })).toBe(1);
    s.setStrip('input2', { pan: 0.5 });
    s.setBandFx({ duckDepth: 0.6, followBass: true });
    const setup = captureSetup(get(s));
    s.addSong({ id: 'song-a', name: 'Opener', bpm: 92, sceneId: null, notes: 'Bass counts in', setup, visuals: { ...emptySongVisuals(), vjColumn: 3 }, recall: defaultRecall() });
    s.addSong({ id: 'song-b', name: 'Closer', bpm: null, sceneId: null, notes: '', setup, visuals: emptySongVisuals(), recall: defaultRecall() });
    s.addSetlist({ id: 'set-1', name: 'Friday', songIds: ['song-b', 'song-a', 'song-b'] });
    s.setCurrentSong('song-a', 1);
    const saved = JSON.parse(JSON.stringify(layers.project.exportProject()));
    s.hydrate(null);
    expect(get(s).songs).toHaveLength(0);
    expect(layers.project.importProject(saved)).toBe(true);
    const after = get(s);
    expect(after.liveInputs.map((i) => i.name)).toEqual(['Bass', 'Guitar']);
    expect(after.liveInputs[1]).toMatchObject({ channel: 1, fxSend: 0.4 });
    expect(after.mixer.input2).toMatchObject({ pan: 0.5 });
    expect(after.bandFx).toMatchObject({ duckDepth: 0.6, followBass: true });
    expect(after.songs.map((x) => x.name)).toEqual(['Opener', 'Closer']);
    expect(after.songs[0]).toMatchObject({ bpm: 92, notes: 'Bass counts in', visuals: { vjColumn: 3 } });
    expect(after.songs[0].setup.liveInputs).toHaveLength(2);
    expect(after.setlists).toEqual([{ id: 'set-1', name: 'Friday', songIds: ['song-b', 'song-a', 'song-b'] }]);
    expect(after).toMatchObject({ activeSetlistId: 'set-1', currentSongId: 'song-a', setlistCursor: 1 });

    // Taking out an input moves the later ones up, mixer strip and all.
    s.removeLiveInput(0);
    expect(get(s).liveInputs.map((i) => i.name)).toEqual(['Guitar']);
    expect(get(s).mixer.input).toMatchObject({ pan: 0.5 });
    // A song keeps tonight's wiring and takes its own roles.
    s.setLiveInput(0, { role: 'pad' });
    s.applySetup({ liveInputs: [{ ...setup.liveInputs[0] }] });
    expect(get(s).liveInputs[0]).toMatchObject({ name: 'Guitar', channel: 1, role: 'bass' });
    // Forgetting a song takes it out of the set list.
    s.removeSong('song-b');
    expect(get(s).setlists[0].songIds).toEqual(['song-a']);
  });

  it('opens a project from before there were several inputs with its one input first', () => {
    const older = { version: '1.9.5', project: { id: 'p', name: 'Show', width: 1920, height: 1080, layers: [] }, musicStudio: { schemaVersion: 1, liveInput: { role: 'kick', sensitivity: 0.9 } } };
    expect(layers.project.importProject(older)).toBe(true);
    expect(get(studio.musicStudio).liveInputs).toEqual([{ name: '', channel: -1, role: 'kick', sensitivity: 0.9, volume: 0.5, monitor: true, fxSend: 1 }]);
  });

  it('keeps a Music Studio layer and a Music Studio clip, voices and all', async () => {
    const { vjClipLauncher } = await import('../stores/vjClipLauncher');
    const source = {
      effectType: 'music-studio',
      musicSet: 'dub',
      musicSceneId: null,
      musicVoices: [{ file: 'VX-Scope.fs', source: 'lead', auto: false, level: 0.4, params: { scale: 2 } }],
    };
    const layerId = layers.project.addLayer('Studio', 'media')!;
    layers.project.setLayerSource(layerId, { id: 'studio-src', type: 'effect', name: 'Music Studio', src: 'plugin://musicstudio', effectSource: source } as any);
    vjClipLauncher.setClip(0, 1, { id: 'studio-clip', type: 'effect', name: 'Music Studio', src: 'plugin://musicstudio', effectSource: source } as any, 'A');
    const saved = JSON.parse(JSON.stringify(layers.project.exportProject()));

    expect(layers.project.importProject({ version: '1.9.5', project: { id: 'p', name: 'Show', width: 1920, height: 1080, layers: [] } })).toBe(true);
    expect(layers.project.importProject(saved)).toBe(true);

    const layer = get(layers.project).layers.find((l) => l.id === layerId);
    expect(layer?.source?.effectSource).toEqual(source);
    expect(get(vjClipLauncher).clipGrid[0][1]?.effectSource).toEqual(source);
  });

  it('File > New resets the studio', () => {
    playSomething();
    layers.PROJECT_SECTION_RESETS.musicStudio();
    expect(get(studio.musicStudio).takes).toHaveLength(0);
  });
});
