/**
 * Songs at the show: saving the setup now as a song, calling it back up
 * (only the parts it recalls), walking a set list, the next-bar wait, the
 * tempo left to Ableton Link, another set coming up with a song, and the
 * undo history a song call leaves.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

const clock = vi.hoisted(() => ({ link: false, tempo: 120, wait: 1000 }));

// The launch clock, held still: its tempo, whether Link has it, and how far off the next bar is.
vi.mock('../stores/launchClock', async (importOriginal) => {
  const real = await importOriginal<typeof import('../stores/launchClock')>();
  return {
    ...real,
    launchClockFollowsLink: () => clock.link,
    launchClockTempo: () => clock.tempo,
    nextLaunchBoundary: () => performance.now() + clock.wait,
  };
});

// No Web Audio here: every engine call is a no-op (the clock reads 0).
vi.mock('./audioEngine', () => ({
  MusicAudioEngine: class {
    constructor() {
      return new Proxy(this, { get: (_t, key) => (key === 'then' ? undefined : () => 0) });
    }
  },
}));

let studio: typeof import('./musicStudioStore');
let songs: typeof import('./songRuntime');
let runtime: typeof import('./musicRuntime');
let target: typeof import('./studioTarget');
let launcher: typeof import('../stores/vjClipLauncher');
let layers: typeof import('../stores/layers');
let audio: typeof import('../stores/audio');
let history: typeof import('../stores/historyHooks');
let controls: typeof import('./studioControls');

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
  (globalThis as any).addEventListener = () => {};
  (globalThis as any).removeEventListener = () => {};
  (globalThis as any).dispatchEvent = () => true;
  (globalThis as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  // A frame every 16 ms, so fake timers never spin on a frame loop.
  (globalThis as any).requestAnimationFrame = (cb: (t: number) => void) => setTimeout(() => cb(Date.now()), 16) as unknown as number;
  (globalThis as any).cancelAnimationFrame = (id: number) => clearTimeout(id as never);
}

beforeAll(async () => {
  installDomShim();
  layers = await import('../stores/layers');
  studio = await import('./musicStudioStore');
  runtime = await import('./musicRuntime');
  songs = await import('./songRuntime');
  target = await import('./studioTarget');
  launcher = await import('../stores/vjClipLauncher');
  audio = await import('../stores/audio');
  history = await import('../stores/historyHooks');
  controls = await import('./studioControls');
});

const voice = (file: string, level: number) => ({ file, source: 'bass' as const, auto: true, level, params: {} });
const studioSource = (voices: ReturnType<typeof voice>[]) => ({ effectType: 'music-studio', musicSet: 'dub', musicSceneId: null, musicVoices: voices });
const voicesNow = () => target.studioTargetNow()?.source.musicVoices.map((v) => [v.file, v.level]);

/** A Music Studio clip playing on deck A, row 1, column 2. */
function studioOnDeck(voices: ReturnType<typeof voice>[]): void {
  const vj = launcher.vjClipLauncher;
  vj.setOpen(true, { fromWorkspace: true });
  vj.setClip(0, 1, { id: 'studio-clip', type: 'effect', name: 'Music Studio', src: 'plugin://musicstudio', effectSource: studioSource(voices) } as any, 'A');
  vj.triggerClipNow(0, 1, 'A');
}

function state() {
  return get(studio.musicStudio);
}

beforeEach(() => {
  clock.link = false;
  clock.tempo = 120;
  clock.wait = 1000;
  studio.musicStudio.hydrate(null);
  audio.audioStore.setManualBPM(120);
});

afterEach(() => {
  songs.cancelQueuedSong();
  studio.musicStudio.close();
  vi.useRealTimers();
});

describe('saving a song', () => {
  it('keeps the setup, the tempo and the visuals, and puts the song on the set list being played', () => {
    const s = studio.musicStudio;
    s.addSetlist({ id: 'friday', name: 'Friday', songIds: [] });
    s.setSet('dub');
    s.setKey({ root: 7, scale: 'minor' });
    clock.tempo = 97.04;
    studioOnDeck([voice('VX-Scope.fs', 0.4)]);

    const song = songs.saveSong('Opener')!;
    expect(song.name).toBe('Opener');
    expect(song.bpm).toBe(97);
    expect(song.setup.set).toBe('dub');
    expect(song.setup.key).toEqual({ root: 7, scale: 'minor' });
    expect(song.visuals.voices?.map((v) => v.file)).toEqual(['VX-Scope.fs']);
    expect(song.visuals.vjColumn).toBe(1);
    expect(song.visuals.vjBlockId).toBe(get(launcher.vjClipLauncher).activeBlockId);
    expect(state().setlists[0].songIds).toEqual([song.id]);
    expect(state().currentSongId).toBe(song.id);
    expect(state().setlistCursor).toBe(0);

    // A copy: the studio moving on leaves the song as it was.
    s.setKey({ root: 0, scale: 'major' });
    expect(state().songs[0].setup.key.root).toBe(7);
    expect(songs.saveSong()!.name).toBe('Song 2');
  });

  it('updates a song from now, keeping its name, notes, recall and "leave the tempo"', () => {
    const s = studio.musicStudio;
    const song = songs.saveSong('Ballad')!;
    s.updateSong(song.id, { notes: 'Count in on four', bpm: null, recall: { sound: true, band: false, visuals: true } });
    s.setKey({ root: 3, scale: 'major' });
    expect(songs.updateSongFromNow(song.id)).toBe(true);
    const after = state().songs[0];
    expect(after.setup.key.root).toBe(3);
    expect(after.name).toBe('Ballad');
    expect(after.notes).toBe('Count in on four');
    expect(after.bpm).toBeNull();
    expect(after.recall.band).toBe(false);
  });
});

describe('calling a song up', () => {
  it('puts back the sound, the band settings, the tempo and the looks', () => {
    const s = studio.musicStudio;
    s.setSet('dub');
    s.setKey({ root: 7, scale: 'minor' });
    s.setLiveInput(0, { role: 'bass' });
    clock.tempo = 97;
    studioOnDeck([voice('VX-Scope.fs', 0.4)]);
    const song = songs.saveSong('A')!;

    s.setSet('berlin');
    s.setKey({ root: 0, scale: 'major' });
    s.setLiveInput(0, { role: 'lead', name: 'Tonight vox', channel: 3 });
    target.setStudioVoice(0, { level: 1 });
    audio.audioStore.setManualBPM(140);

    expect(songs.callSong(song.id, { now: true })).toBe(true);
    const now = state();
    expect(now.set).toBe('dub');
    expect(now.key).toEqual({ root: 7, scale: 'minor' });
    // The song's role and levels, on tonight's wiring.
    expect(now.liveInputs[0]).toMatchObject({ role: 'bass', name: 'Tonight vox', channel: 3 });
    expect(get(audio.audioStore).manualBPM).toBe(97);
    expect(voicesNow()).toEqual([['VX-Scope.fs', 0.4]]);
    // The looks come in the studio's palette.
    expect(target.studioTargetNow()?.source.musicSet).toBe('dub');
    expect(now.currentSongId).toBe(song.id);
  });

  it('puts back only the parts it recalls', () => {
    const s = studio.musicStudio;
    s.setKey({ root: 7, scale: 'minor' });
    s.setLiveInput(0, { role: 'bass' });
    studioOnDeck([voice('VX-Scope.fs', 0.4)]);
    const song = songs.saveSong('A')!;
    const moveOn = () => {
      s.setKey({ root: 0, scale: 'major' });
      s.setLiveInput(0, { role: 'lead' });
      target.setStudioVoice(0, { level: 1 });
    };

    moveOn();
    s.updateSong(song.id, { recall: { sound: false, band: false, visuals: true } });
    songs.callSong(song.id, { now: true });
    expect(state().key.root).toBe(0);
    expect(state().liveInputs[0].role).toBe('lead');
    expect(voicesNow()).toEqual([['VX-Scope.fs', 0.4]]);

    moveOn();
    s.updateSong(song.id, { recall: { sound: true, band: false, visuals: false } });
    songs.callSong(song.id, { now: true });
    expect(state().key.root).toBe(7);
    expect(state().liveInputs[0].role).toBe('lead');
    expect(voicesNow()).toEqual([['VX-Scope.fs', 1]]);

    moveOn();
    s.updateSong(song.id, { recall: { sound: false, band: true, visuals: false } });
    songs.callSong(song.id, { now: true });
    expect(state().key.root).toBe(0);
    expect(state().liveInputs[0].role).toBe('bass');
  });

  it('leaves the tempo to Ableton Link when Link has it, and says so', () => {
    const song = songs.saveSong('A')!;
    studio.musicStudio.updateSong(song.id, { bpm: 97 });
    audio.audioStore.setManualBPM(140);
    clock.link = true;
    songs.callSong(song.id, { now: true });
    expect(get(audio.audioStore).manualBPM).toBe(140);
    expect(get(songs.songNotice)).toMatch(/Link/);

    // A song that leaves the tempo says nothing.
    studio.musicStudio.updateSong(song.id, { bpm: null });
    songs.callSong(song.id, { now: true });
    expect(get(songs.songNotice)).toBeNull();
  });

  it('brings another set up as the set buttons do: what played stops, no note is left held, its scene starts', () => {
    const s = studio.musicStudio;
    s.open();
    s.setSet('dub');
    s.addScene({ id: 'scene-a', name: 'Groove', pattern: null, beat: true, takeId: null, vjColumn: null, loops: {} });
    const song = songs.saveSong('Dub song')!;
    s.setSet('berlin');

    runtime.startSequencer();
    runtime.playNote('synth', 60, 0.8, 'screen');
    expect(state().sequencerPlaying).toBe(true);
    expect(get(studio.musicTransport).held.has('synth:60')).toBe(true);

    songs.callSong(song.id, { now: true });
    expect(state().set).toBe('dub');
    expect(get(studio.musicTransport).held.size).toBe(0);
    expect(state().sequencerPlaying).toBe(false);

    // With its scene, the song's beat comes up on the new set.
    s.updateSong(song.id, { sceneId: 'scene-a' });
    s.setSet('berlin');
    songs.callSong(song.id, { now: true });
    expect(state().set).toBe('dub');
    expect(state().sceneId).toBe('scene-a');
    expect(state().sequencerPlaying).toBe(true);
    runtime.stopAll();
  });
});

describe('the set list', () => {
  function threeSongList() {
    const a = songs.saveSong('A')!;
    const b = songs.saveSong('B')!;
    studio.musicStudio.addSetlist({ id: 'tour', name: 'Tour', songIds: [a.id, b.id, a.id] });
    studio.musicStudio.setCurrentSong(null, -1);
    return { a, b };
  }

  it('walks next and previous, a song played twice included, and stops at the ends', () => {
    const { a, b } = threeSongList();
    const at = () => [state().currentSongId, state().setlistCursor];
    expect(songs.prevSong({ now: true })).toBe(false);
    songs.nextSong({ now: true });
    expect(at()).toEqual([a.id, 0]);
    songs.nextSong({ now: true });
    expect(at()).toEqual([b.id, 1]);
    songs.nextSong({ now: true });
    expect(at()).toEqual([a.id, 2]);
    expect(songs.nextSong({ now: true })).toBe(false);
    expect(at()).toEqual([a.id, 2]);
    songs.prevSong({ now: true });
    expect(at()).toEqual([b.id, 1]);
    songs.goToSong(0, { now: true });
    expect(at()).toEqual([a.id, 0]);

    // Called up from the song list, a song in the set goes on from its first place.
    songs.callSong(b.id, { now: true });
    expect(at()).toEqual([b.id, -1]);
    expect(songs.songAlongSetlist(state(), 1)?.cursor).toBe(2);
  });

  it('waits for the next bar, comes up at once on a second press, and is forgotten when the studio closes', () => {
    vi.useFakeTimers();
    const { a, b } = threeSongList();
    songs.nextSong();
    expect(get(songs.queuedSong)).toMatchObject({ songId: a.id, cursor: 0 });
    expect(state().currentSongId).toBeNull();
    vi.advanceTimersByTime(clock.wait - 20);
    expect(state().currentSongId).toBeNull();
    vi.advanceTimersByTime(40);
    expect(state().currentSongId).toBe(a.id);
    expect(get(songs.queuedSong)).toBeNull();

    // Next again while it waits: now.
    songs.nextSong();
    expect(get(songs.queuedSong)?.songId).toBe(b.id);
    songs.nextSong();
    expect(state().currentSongId).toBe(b.id);
    expect(get(songs.queuedSong)).toBeNull();

    // Go brings the waiting song up now; with none waiting, the next one.
    songs.prevSong();
    expect(songs.songGo()).toBe(true);
    expect([state().currentSongId, state().setlistCursor]).toEqual([a.id, 0]);
    controls.runStudioControl('song.go', 1);
    expect([state().currentSongId, state().setlistCursor]).toEqual([b.id, 1]);

    // A waiting song never comes up once the studio closes.
    studio.musicStudio.open();
    songs.nextSong();
    expect(get(songs.queuedSong)).not.toBeNull();
    studio.musicStudio.close();
    expect(get(songs.queuedSong)).toBeNull();
    vi.advanceTimersByTime(clock.wait * 2);
    expect(state().currentSongId).toBe(b.id);
  });

  it('answers MIDI as studio controls', () => {
    const { a, b } = threeSongList();
    vi.useFakeTimers();
    controls.runStudioControl('song.next', 1);
    controls.runStudioControl('song.next', 0);
    vi.advanceTimersByTime(clock.wait + 10);
    expect(state().currentSongId).toBe(a.id);
    controls.runStudioControl('song.next', 1);
    controls.runStudioControl('song.next', 0);
    controls.runStudioControl('song.next', 1);
    expect(state().currentSongId).toBe(b.id);
    controls.runStudioControl('song.prev', 1);
    vi.advanceTimersByTime(clock.wait + 10);
    expect(state().currentSongId).toBe(a.id);
  });
});

describe('going between the Studio view and the deck', () => {
  it('switches with one key or control, keeps the music open, and opens again with the tray', async () => {
    const deck = await import('./studioDeck');
    const onDeck = () => get(deck.studioOnDeck);
    launcher.vjClipLauncher.setOpen(true, { fromWorkspace: true });
    studio.musicStudio.setStudioView(true);

    deck.toggleStudioView();
    expect([state().isOpen, state().studioView, onDeck()]).toEqual([true, false, true]);
    controls.runStudioControl('studio.view', 1);
    expect([state().isOpen, state().studioView]).toEqual([true, true]);
    deck.showTray();
    expect([state().studioView, onDeck()]).toEqual([false, false]);

    deck.showDeck();
    studio.musicStudio.close();
    expect(onDeck()).toBe(false);

    const key = (patch: Partial<KeyboardEvent> = {}) => ({ code: 'Backquote', repeat: false, defaultPrevented: false, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...patch }) as KeyboardEvent;
    expect(deck.isStudioViewKey(key())).toBe(true);
    expect(deck.isStudioViewKey(key({ ctrlKey: true }))).toBe(false);
    expect(deck.isStudioViewKey(key({ repeat: true }))).toBe(false);
    expect(deck.isStudioViewKey(key({ code: 'KeyA' }))).toBe(false);

    // Outside VJ mode the Studio view cannot show, so nothing opens.
    launcher.vjClipLauncher.setOpen(false, { fromWorkspace: true });
    deck.toggleStudioView();
    expect(state().isOpen).toBe(false);
  });
});

describe('undo history', () => {
  it('a song walked to leaves no step; one called up by hand is one step for the map', () => {
    launcher.vjClipLauncher.setOpen(false, { fromWorkspace: true });
    const layerId = layers.project.addLayer('Studio', 'media')!;
    const source = (level: number) => ({ id: 'studio-src', type: 'effect', name: 'Music Studio', src: 'plugin://musicstudio', effectSource: studioSource([voice('VX-Scope.fs', level)]) });
    layers.project.setLayerSource(layerId, source(0.3) as any, { history: false });
    expect(target.studioTargetNow()?.kind).toBe('layer');
    const song = songs.saveSong('A')!;
    studio.musicStudio.addSetlist({ id: 'set', name: 'Set', songIds: [song.id] });
    studio.musicStudio.setCurrentSong(null, -1);

    let steps = 0;
    history.setHistoryCallback(() => steps++);
    try {
      layers.project.setLayerSource(layerId, source(0.9) as any, { history: false });
      songs.nextSong({ now: true });
      expect(voicesNow()).toEqual([['VX-Scope.fs', 0.3]]);
      expect(steps).toBe(0);

      layers.project.setLayerSource(layerId, source(0.9) as any, { history: false });
      songs.callSong(song.id, { now: true, history: true });
      expect(voicesNow()).toEqual([['VX-Scope.fs', 0.3]]);
      expect(steps).toBe(1);

      // Nothing to change on the map: no step.
      songs.callSong(song.id, { now: true, history: true });
      expect(steps).toBe(1);
    } finally {
      history.setHistoryCallback(() => {});
      layers.project.removeLayer(layerId);
    }
  });
});
