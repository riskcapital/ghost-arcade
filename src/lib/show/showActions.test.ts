/**
 * fireShowAction against the real stores (project, VJ launcher, Timeline,
 * cue list, takeover, settings) with the show-control runtime installed,
 * and a fake Live behind the bridge seam (never a real Ableton): each kind
 * does what the app's own control does, a target that is gone is a reason,
 * nothing throws, and the MIDI/OSC show: paths that now go through it act
 * as before (GO passes a held section).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

let layers: typeof import('../stores/layers');
let router: typeof import('../midi/midiRouter');
let cues: typeof import('./cueList');
let timeline: typeof import('../stores/showTimeline');
let runtime: typeof import('./showControlRuntime');
let actions: typeof import('./showActions');
let takeoverRt: typeof import('./takeover/takeoverRuntime');
let takeover: typeof import('./takeover/liveTakeover');
let launcher: typeof import('../stores/vjClipLauncher');
let types: typeof import('../types');
let settingsMod: typeof import('../stores/settings');
let hooks: typeof import('../stores/historyHooks');
let teardown: Array<() => void> = [];

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
    load() {}, play: () => Promise.resolve(), pause() {},
  });
  (globalThis as any).document = {
    documentElement: makeEl(), body: makeEl(), head: makeEl(),
    createElement: () => makeEl(),
    querySelector: () => null, querySelectorAll: () => [], getElementById: () => null,
    addEventListener() {}, removeEventListener() {},
    visibilityState: 'visible',
  };
  (globalThis as any).window = globalThis;
  if (typeof (globalThis as any).dispatchEvent !== 'function') (globalThis as any).dispatchEvent = () => true;
  (globalThis as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  (globalThis as any).requestAnimationFrame = (cb: (t: number) => void) => setTimeout(() => cb(Date.now()), 0) as unknown as number;
  (globalThis as any).cancelAnimationFrame = (id: number) => clearTimeout(id as never);
}

beforeAll(async () => {
  installDomShim();
  layers = await import('../stores/layers');
  router = await import('../midi/midiRouter');
  cues = await import('./cueList');
  timeline = await import('../stores/showTimeline');
  runtime = await import('./showControlRuntime');
  actions = await import('./showActions');
  takeoverRt = await import('./takeover/takeoverRuntime');
  takeover = await import('./takeover/liveTakeover');
  launcher = await import('../stores/vjClipLauncher');
  types = await import('../types');
  settingsMod = await import('../stores/settings');
  hooks = await import('../stores/historyHooks');
  teardown = [runtime.installShowControl(), takeoverRt.installTakeoverRuntime()];
});

afterAll(() => {
  for (const t of teardown.reverse()) t();
  actions.setShowActionLive(null);
});

beforeEach(() => {
  cues.cueList.hydrate(null);
  timeline.showTimeline._resetForTest();
  takeover.liveTakeover.reset();
  takeover.liveTakeover.setDefaultRelease({ mode: 'instant', fadeSeconds: 0 });
  launcher.vjClipLauncher.reset();
  actions.setShowActionLive(null);
  runtime.setBlackout(false);
});

const fire = (a: Parameters<typeof actions.fireShowAction>[0]) => actions.fireShowAction(a);
const sec = (id: string, start: number, end: number, extra: Record<string, unknown> = {}) => ({ id, name: id, color: '#5b8def', start, end, action: 'through', ...extra });

/** A Timeline document with sections (and a song so it has a length). */
function timelineWith(sections: ReturnType<typeof sec>[], length = 24) {
  timeline.showTimeline.hydrate({
    version: 8, activeDoc: 'timeline', audioTracks: [], presetClips: [],
    timeline: {
      version: 8, presetClips: [], sections,
      audioTracks: [{ id: 'song', name: 'Song', url: 'blob:song', startTime: 0, duration: length, offset: 0, sourceDuration: length, volume: 1, muted: false, lane: 0, peaks: [1] }],
      tempo: { offset: 0, segments: [{ bar: 1, bpm: 120, beatsPerBar: 4, beatUnit: 4 }], source: 'manual' },
    },
  });
}

describe('look and preset', () => {
  function shapes(n: number) {
    const list = Array.from({ length: n }, (_, i) => types.createLayer(`shape-${i}`, `Shape ${i + 1}`, 'media'));
    expect(layers.project.importProject({ version: '2.0.12', project: { id: 'p', name: 'P', width: 1920, height: 1080, layers: list } } as any)).toBe(true);
    return list.map((l) => l.id);
  }
  const lookOf = (id: string) => get(layers.project).layers.find((l) => l.id === id)!.edgeEffects?.look ?? null;

  it('a Look dresses every shape (or the ones named) in its own palette, as live control (no undo step)', () => {
    const ids = shapes(3);
    let steps = 0;
    hooks.setHistoryCallback(() => { steps++; });
    try {
      expect(fire({ kind: 'look', lookId: 'comet-chase' })).toEqual({ ok: true });
      expect(ids.map(lookOf)).toEqual(ids.map(() => ({ id: 'comet-chase', paletteId: expect.any(String) })));
      expect(fire({ kind: 'look', lookId: 'beat-step', paletteId: 'acid', layerIds: [ids[1]] })).toEqual({ ok: true });
      expect(lookOf(ids[1])).toEqual({ id: 'beat-step', paletteId: 'acid' });
      expect(lookOf(ids[0])?.id).toBe('comet-chase');
      expect(steps).toBe(0);
    } finally {
      hooks.setHistoryCallback(() => {});
    }
    expect(fire({ kind: 'look', lookId: 'no-such-look' })).toEqual({ ok: false, reason: 'not-found' });
    expect(fire({ kind: 'look', lookId: 'comet-chase', layerIds: ['gone'] })).toEqual({ ok: false, reason: 'not-found' });
  });

  it('a preset is recalled by id; a deleted one is not-found', () => {
    shapes(1);
    const id = layers.project.saveComposition('Opening');
    const load = vi.spyOn(layers.project, 'loadComposition');
    try {
      expect(fire({ kind: 'preset', compositionId: id })).toEqual({ ok: true });
      expect(load).toHaveBeenCalledWith(id, { recordHistory: false });
      expect(fire({ kind: 'preset', compositionId: 'gone' })).toEqual({ ok: false, reason: 'not-found' });
    } finally {
      load.mockRestore();
    }
  });
});

describe('VJ clips', () => {
  const shader = (id: string) => ({ id, type: 'shader', name: id, src: `./ISF/${id}.fs`, shaderCode: 'void main(){}' }) as any;
  const vj = () => get(launcher.vjClipLauncher);

  it('a clip launches on its deck (VJ launch quantise); an empty slot or a missing row is not-found', () => {
    launcher.vjClipLauncher.setQuantization('off');
    launcher.vjClipLauncher.setClip(0, 1, shader('red'));
    launcher.vjClipLauncher.setClip(1, 0, shader('blue'), 'B');
    const trigger = vi.spyOn(launcher.vjClipLauncher, 'triggerClip');
    try {
      expect(fire({ kind: 'clip', row: 0, column: 1 })).toEqual({ ok: true });
      expect(trigger).toHaveBeenLastCalledWith(0, 1, 'A');
      expect(fire({ kind: 'clip', deck: 'B', row: 1, column: 0 })).toEqual({ ok: true });
      expect(trigger).toHaveBeenLastCalledWith(1, 0, 'B');
      expect(fire({ kind: 'clip', row: 0, column: 0 })).toEqual({ ok: false, reason: 'not-found' });
      expect(fire({ kind: 'clip', row: 40, column: 0 })).toEqual({ ok: false, reason: 'not-found' });
      expect(fire({ kind: 'clip', row: -1, column: 0 })).toEqual({ ok: false, reason: 'invalid' });
      expect(trigger).toHaveBeenCalledTimes(2);
    } finally {
      trigger.mockRestore();
    }
  });

  it('a column launches the clips in it; an empty column is not-found', () => {
    launcher.vjClipLauncher.setClip(0, 2, shader('red'));
    launcher.vjClipLauncher.setClip(1, 2, shader('blue'));
    launcher.vjClipLauncher.setQuantization('off');
    expect(fire({ kind: 'clipColumn', column: 2 })).toEqual({ ok: true });
    expect(vj().layerStates.slice(0, 2).map((s) => s.activeClip?.id)).toEqual(['red', 'blue']);
    expect(fire({ kind: 'clipColumn', column: 3 })).toEqual({ ok: false, reason: 'not-found' });
  });
});

describe('Live (a fake Live behind the bridge)', () => {
  function fakeLive(connected: boolean, over: Partial<import('./showActions').ShowActionLive> = {}) {
    const sent: string[] = [];
    actions.setShowActionLive({
      bridge: () => ({
        connected,
        tracks: [{ name: 'Drums', color: 0, midi: false, side: null, slots: [{ name: 'Beat', color: 0, length: 4 }, null], playing: -1, fired: -1, startedBeat: 0, firedBeat: 0 }] as any,
        scenes: [{ name: 'Intro', color: 0, queued: false }, { name: 'Drop', color: 0, queued: false }],
      }),
      launchClip: (t, s) => sent.push(`clip ${t}/${s}`),
      launchScene: (s) => sent.push(`scene ${s}`),
      ...over,
    });
    return sent;
  }

  it('fires a clip or a scene through the bridge; an empty slot, a missing scene or no Live is a reason', () => {
    const sent = fakeLive(true);
    expect(fire({ kind: 'liveClip', track: 0, slot: 0 })).toEqual({ ok: true });
    expect(fire({ kind: 'liveScene', scene: 1 })).toEqual({ ok: true });
    expect(fire({ kind: 'liveClip', track: 0, slot: 1 })).toEqual({ ok: false, reason: 'not-found' });
    expect(fire({ kind: 'liveClip', track: 3, slot: 0 })).toEqual({ ok: false, reason: 'not-found' });
    expect(fire({ kind: 'liveScene', scene: 5 })).toEqual({ ok: false, reason: 'not-found' });
    expect(sent).toEqual(['clip 0/0', 'scene 1']);
    const offline = fakeLive(false);
    expect(fire({ kind: 'liveClip', track: 0, slot: 0 })).toEqual({ ok: false, reason: 'not-connected' });
    expect(fire({ kind: 'liveScene', scene: 0 })).toEqual({ ok: false, reason: 'not-connected' });
    expect(offline).toEqual([]);
  });

  it('a bridge that throws is an error result, never a throw', () => {
    fakeLive(true, { launchScene: () => { throw new Error('socket gone'); } });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(fire({ kind: 'liveScene', scene: 0 })).toEqual({ ok: false, reason: 'error' });
    warn.mockRestore();
  });
});

describe('sections, GO and the transport', () => {
  let frames: Array<(now: number) => void> = [];
  let frameMs = 0;
  let clock = 0;
  const playFor = (seconds: number, ms = 50) => {
    for (let i = 0; i < Math.round((seconds * 1000) / ms); i++) {
      frameMs += ms;
      clock += ms / 1000;
      const pending = frames;
      frames = [];
      for (const cb of pending) cb(frameMs);
    }
  };
  beforeEach(() => {
    frames = [];
    frameMs = 1000;
    clock = 100;
    vi.stubGlobal('requestAnimationFrame', (cb: (now: number) => void) => { frames.push(cb); return frames.length; });
    vi.stubGlobal('cancelAnimationFrame', () => { frames = []; });
    timeline.setShowAudioClockReader(null);
    timeline.showTimeline._setSectionClock(() => clock);
  });
  afterAll(() => vi.unstubAllGlobals());

  it('GO passes a held section (as show:go did); with nothing waiting it says so', () => {
    timelineWith([sec('a', 0, 4, { action: 'hold' }), sec('b', 4, 12)]);
    timeline.showTimeline.seek(3);
    timeline.showTimeline.play();
    playFor(2);
    expect(get(timeline.showSectionStatus).holdId).toBe('a');
    expect(fire({ kind: 'go' })).toEqual({ ok: true });
    playFor(1);
    expect(get(timeline.showTimeline).currentTime).toBeGreaterThan(4.5);
    expect(get(timeline.showSectionStatus).holdId).toBeNull();
    // Playing through a section that does not stop: nothing waits.
    expect(fire({ kind: 'go' })).toEqual({ ok: false, reason: 'nothing-waits' });
  });

  it('MIDI/OSC show:go through the router still passes the hold (it goes through fireShowAction now)', () => {
    timelineWith([sec('a', 0, 4, { action: 'hold' }), sec('b', 4, 12)]);
    const spy = vi.spyOn(timeline.showTimeline, 'go');
    timeline.showTimeline.seek(3.5);
    timeline.showTimeline.play();
    playFor(1);
    expect(get(timeline.showSectionStatus).holdId).toBe('a');
    router.midiRouter.dispatchPath('show:go', 1);
    expect(spy).toHaveBeenCalledTimes(1);
    playFor(1);
    expect(get(timeline.showTimeline).currentTime).toBeGreaterThan(4.5);
    spy.mockRestore();
  });

  it('without sections GO is the cue list\'s', () => {
    const a = cues.cueList.addCue({ name: 'A' });
    expect(fire({ kind: 'go' })).toEqual({ ok: true });
    expect(cues.cueList.state.currentCueId).toBe(a);
    expect(cues.cueList.state.history.at(-1)?.source).toBe('remote');
  });

  it('a section jump goes to its start (by id, name or position); a gone section or no Timeline is a reason', () => {
    timelineWith([sec('intro', 0, 4), sec('drop', 8, 16), sec('out', 16, 24)]);
    expect(fire({ kind: 'section', name: 'drop' })).toEqual({ ok: true });
    expect(get(timeline.showTimeline).currentTime).toBe(8);
    expect(fire({ kind: 'section', index: 2 })).toEqual({ ok: true });
    expect(get(timeline.showTimeline).currentTime).toBe(16);
    expect(fire({ kind: 'section', id: 'intro' })).toEqual({ ok: true });
    expect(get(timeline.showTimeline).currentTime).toBe(0);
    timeline.showTimeline.removeSection('drop');
    expect(fire({ kind: 'section', id: 'drop' })).toEqual({ ok: false, reason: 'not-found' });
    expect(fire({ kind: 'section', index: 9 })).toEqual({ ok: false, reason: 'not-found' });
    timeline.showTimeline.openDoc('show');
    expect(fire({ kind: 'section', id: 'intro' })).toEqual({ ok: false, reason: 'no-sections' });
  });

  it('transport play / pause / seek / stop; refused while a clock is followed', () => {
    timelineWith([]);
    expect(fire({ kind: 'transport', op: 'play' })).toEqual({ ok: true });
    expect(get(timeline.showTimeline).isPlaying).toBe(true);
    expect(fire({ kind: 'transport', op: 'pause' })).toEqual({ ok: true });
    expect(get(timeline.showTimeline).isPlaying).toBe(false);
    expect(fire({ kind: 'transport', op: 'seek', seconds: 6 })).toEqual({ ok: true });
    expect(get(timeline.showTimeline).currentTime).toBe(6);
    expect(fire({ kind: 'transport', op: 'seek', seconds: Number.NaN })).toEqual({ ok: false, reason: 'invalid' });
    expect(fire({ kind: 'transport', op: 'stop' })).toEqual({ ok: true });
    expect(get(timeline.showTimeline).currentTime).toBe(0);
    timeline.showTimeline.chase(2, false);
    expect(fire({ kind: 'transport', op: 'play' })).toEqual({ ok: false, reason: 'chasing' });
    timeline.showTimeline.releaseChase();
  });
});

describe('phrases', () => {
  it('a pad (or section id) launches its phrase on the bar; stop stops; an unknown pad is not-found', () => {
    timelineWith([sec('verse', 0, 8, { phrase: { end: 'section' } }), sec('drop', 8, 16, { phrase: { end: 'loop' } })]);
    expect(fire({ kind: 'phrase', pad: 2 })).toEqual({ ok: true });
    expect(get(timeline.showPhraseStatus).pending?.id ?? get(timeline.showPhraseStatus).activeId).toBe('drop');
    expect(fire({ kind: 'phrase', stop: true })).toEqual({ ok: true });
    expect(fire({ kind: 'phrase', sectionId: 'verse' })).toEqual({ ok: true });
    expect(get(timeline.showPhraseStatus).pending?.id ?? get(timeline.showPhraseStatus).activeId).toBe('verse');
    expect(fire({ kind: 'phrase', pad: 3 })).toEqual({ ok: false, reason: 'not-found' });
    expect(fire({ kind: 'phrase', sectionId: 'nope' })).toEqual({ ok: false, reason: 'not-found' });
    expect(fire({ kind: 'phrase' })).toEqual({ ok: false, reason: 'invalid' });
    timeline.showTimeline.cancelPhraseLaunch();
  });

  it('show:phrase:<n> through the router still launches the pad', () => {
    timelineWith([sec('verse', 0, 8, { phrase: { end: 'section' } })]);
    router.midiRouter.dispatchPath('show:phrase:1', 1);
    expect(get(timeline.showPhraseStatus).pending?.id ?? get(timeline.showPhraseStatus).activeId).toBe('verse');
    timeline.showTimeline.cancelPhraseLaunch();
  });
});

describe('takeover and release', () => {
  let wall: string;
  beforeEach(() => {
    timeline.showTimeline.addLayerTrack(types.createLayer('wall', 'Wall', 'media'));
    timeline.showTimeline.addLayerTrack(types.createLayer('logo', 'Logo', 'media'));
    wall = get(timeline.showTimeline).layerTracks[0].id;
  });
  const surfaces = () => takeover.liveTakeover.state.surfaces;

  it('takes a row over (by number or row id) and hands it back; a gone row is not-found', () => {
    expect(fire({ kind: 'takeover', track: 0, source: { kind: 'vjMix' } })).toEqual({ ok: true });
    expect(surfaces().wall).toMatchObject({ trackId: wall, source: { kind: 'vjMix' } });
    expect(fire({ kind: 'takeover', track: get(timeline.showTimeline).layerTracks[1].id, source: { kind: 'vjRow', deck: 'B', row: 2 } })).toEqual({ ok: true });
    expect(surfaces().logo?.source).toEqual({ kind: 'vjRow', deck: 'B', row: 2 });
    expect(fire({ kind: 'release', track: 0 })).toEqual({ ok: true });
    expect(surfaces().wall).toBeUndefined();
    expect(fire({ kind: 'release', track: 0 })).toEqual({ ok: false, reason: 'nothing-waits' });
    expect(fire({ kind: 'release' })).toEqual({ ok: true });
    expect(surfaces()).toEqual({});
    expect(fire({ kind: 'takeover', track: 7, source: { kind: 'vjMix' } })).toEqual({ ok: false, reason: 'not-found' });
    expect(fire({ kind: 'takeover', track: 'gone', source: { kind: 'vjMix' } })).toEqual({ ok: false, reason: 'not-found' });
    // A VJ group that does not exist.
    expect(fire({ kind: 'takeover', track: 0, source: { kind: 'vjGroup', index: 9 } })).toEqual({ ok: false, reason: 'not-found' });
  });
});

describe('blackout and the cue list', () => {
  it('blackout on, off and toggled', () => {
    const blackout = () => get(settingsMod.settings).output.blackout;
    expect(fire({ kind: 'blackout', on: true })).toEqual({ ok: true });
    expect(blackout()).toBe(true);
    expect(fire({ kind: 'blackout' })).toEqual({ ok: true });
    expect(blackout()).toBe(false);
    expect(fire({ kind: 'blackout' })).toEqual({ ok: true });
    expect(blackout()).toBe(true);
    expect(fire({ kind: 'blackout', on: false })).toEqual({ ok: true });
    expect(blackout()).toBe(false);
  });

  it('cue go / back / fire n / stop / reset, as the router\'s show: paths', () => {
    const { cueList } = cues;
    const a = cueList.addCue({ name: 'A' });
    const b = cueList.addCue({ name: 'B' });
    const c = cueList.addCue({ name: 'C' });
    expect(fire({ kind: 'cue', op: 'go' })).toEqual({ ok: true });
    expect(fire({ kind: 'cue', op: 'go' })).toEqual({ ok: true });
    expect(cueList.state.currentCueId).toBe(b);
    expect(fire({ kind: 'cue', op: 'back' })).toEqual({ ok: true });
    expect(cueList.state.currentCueId).toBe(a);
    expect(fire({ kind: 'cue', op: 'fire', index: 2 })).toEqual({ ok: true });
    expect(cueList.state.currentCueId).toBe(c);
    expect(fire({ kind: 'cue', op: 'fire', index: 5 })).toEqual({ ok: false, reason: 'not-found' });
    expect(fire({ kind: 'cue', op: 'stop' })).toEqual({ ok: true });
    expect(fire({ kind: 'cue', op: 'reset' })).toEqual({ ok: true });
    expect(cueList.state.currentCueId).toBeNull();
    expect(cueList.state.history.map((h) => h.source)).toEqual(['remote', 'remote', 'back', 'remote']);
  });
});

describe('never throws', () => {
  it('nonsense in, a reason out', () => {
    expect(fire(null as never)).toEqual({ ok: false, reason: 'invalid' });
    expect(fire({ kind: 'nope' } as never)).toEqual({ ok: false, reason: 'invalid' });
    expect(fire({ kind: 'clip' } as never)).toEqual({ ok: false, reason: 'invalid' });
    expect(fire({ kind: 'section' })).toEqual({ ok: false, reason: 'no-sections' });
    expect(fire({ kind: 'cue', op: 'fire' })).toEqual({ ok: false, reason: 'not-found' });
    expect(fire({ kind: 'takeover', track: 0, source: null } as never)).toEqual({ ok: false, reason: 'not-found' });
  });
});
