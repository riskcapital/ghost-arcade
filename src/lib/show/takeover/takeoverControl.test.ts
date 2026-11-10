/**
 * Live takeover control in the running app: the show:live / show:release /
 * show:overlay / show:releasemode / show:underneath paths through the shared
 * router (a note-off releases a momentary takeover), the takeover cue
 * actions through the app's cue executor, and marker policy 'hold' keeping
 * the VJ and blackout actions of marker cues until the hand-back.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

let router: typeof import('../../midi/midiRouter');
let cues: typeof import('../cueList');
let timeline: typeof import('../../stores/showTimeline');
let runtime: typeof import('../showControlRuntime');
let takeoverRt: typeof import('./takeoverRuntime');
let takeover: typeof import('./liveTakeover');
let launcher: typeof import('../../stores/vjClipLauncher');
let types: typeof import('../../types');
let settingsMod: typeof import('../../stores/settings');
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
    documentElement: makeEl(),
    body: makeEl(),
    head: makeEl(),
    createElement: () => makeEl(),
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null,
    addEventListener() {}, removeEventListener() {},
    visibilityState: 'visible',
  };
  (globalThis as any).window = globalThis;
  if (typeof (globalThis as any).dispatchEvent !== 'function') (globalThis as any).dispatchEvent = () => true;
  (globalThis as any).matchMedia = () => ({
    matches: false,
    addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {},
  });
  (globalThis as any).requestAnimationFrame = (cb: (t: number) => void) =>
    setTimeout(() => cb(Date.now()), 0) as unknown as number;
  (globalThis as any).cancelAnimationFrame = (id: number) => clearTimeout(id as never);
}

beforeAll(async () => {
  installDomShim();
  await import('../../stores/layers');
  router = await import('../../midi/midiRouter');
  cues = await import('../cueList');
  timeline = await import('../../stores/showTimeline');
  runtime = await import('../showControlRuntime');
  takeoverRt = await import('./takeoverRuntime');
  takeover = await import('./liveTakeover');
  launcher = await import('../../stores/vjClipLauncher');
  types = await import('../../types');
  settingsMod = await import('../../stores/settings');
  teardown = [runtime.installShowControl(), takeoverRt.installTakeoverRuntime()];
});

afterAll(() => {
  for (const t of teardown.reverse()) t();
});

let wall: string;
let logo: string;
beforeEach(() => {
  cues.cueList.hydrate(null);
  timeline.showTimeline._resetForTest();
  takeover.liveTakeover.reset();
  takeover.liveTakeover.setDefaultRelease({ mode: 'instant', fadeSeconds: 0 });
  takeover.liveTakeover.setMarkerPolicy('fire');
  takeover.liveTakeover.setPadMode('latch');
  takeover.liveTakeover.setUnderneath('run');
  timeline.showTimeline.addLayerTrack(types.createLayer('wall', 'Wall', 'media'));
  timeline.showTimeline.addLayerTrack(types.createLayer('logo', 'Logo', 'media'));
  const tracks = get(timeline.showTimeline).layerTracks;
  wall = tracks[0].id;
  logo = tracks[1].id;
});

const surfaces = () => takeover.liveTakeover.state.surfaces;
const path = (p: string, v: number, inputId?: string) => router.midiRouter.dispatchPath(p, v, inputId ? { inputId } : {});

describe('show:live and friends through the router', () => {
  it('parses the takeover paths (tracks and rows count from 1)', () => {
    const parse = (p: string) => router.parseShowControlPath(p.split(':'));
    expect(parse('show:live:2:vja:3')).toEqual({ live: { track: 1, source: { kind: 'vjRow', deck: 'A', row: 2 }, hold: false } });
    expect(parse('show:live:1:vjb:1:hold')).toEqual({ live: { track: 0, source: { kind: 'vjRow', deck: 'B', row: 0 }, hold: true } });
    expect(parse('show:live:1:mix')).toEqual({ live: { track: 0, source: { kind: 'vjMix' }, hold: false } });
    expect(parse('show:live:1:group:2')).toEqual({ live: { track: 0, source: { kind: 'vjGroup', index: 1 }, hold: false } });
    expect(parse('show:live:1:black')).toEqual({ live: { track: 0, source: { kind: 'black' }, hold: false } });
    expect(parse('show:live:0:mix')).toBeNull();
    expect(parse('show:live:1:vja')).toBeNull();
    expect(parse('show:release')).toEqual({ release: null });
    expect(parse('show:release:2')).toEqual({ release: 1 });
    expect(parse('show:overlay')).toEqual({ overlay: true });
    expect(parse('show:releasemode:bar')).toEqual({ releaseMode: 'bar' });
    expect(parse('show:releasemode:soon')).toBeNull();
    expect(parse('show:underneath:pause')).toEqual({ underneath: 'pause' });
  });

  it('a latched pad takes the track over, ignores the note-off, and a second press hands back', () => {
    path('show:live:1:vja:2', 1, 'note:36');
    expect(surfaces().wall).toMatchObject({ trackId: wall, source: { kind: 'vjRow', deck: 'A', row: 1 }, phase: 'live' });
    path('show:live:1:vja:2', 0, 'note:36');
    expect(surfaces().wall?.phase).toBe('live');
    path('show:live:1:vja:2', 1, 'note:36');
    expect(surfaces().wall).toBeUndefined();
  });

  it(':hold is momentary: value 0 (a note-off) hands back', () => {
    path('show:live:2:mix:hold', 1, 'note:40');
    expect(surfaces().logo?.source).toEqual({ kind: 'vjMix' });
    path('show:live:2:mix:hold', 0, 'note:40');
    expect(surfaces().logo).toBeUndefined();
  });

  it('pads set to Hold make every live path momentary', () => {
    takeover.liveTakeover.setPadMode('momentary');
    path('show:live:1:black', 1);
    expect(surfaces().wall?.momentaryInputs).toEqual(['path:show:live:1:black']);
    path('show:live:1:black', 0);
    expect(surfaces().wall).toBeUndefined();
  });

  it('release, release:<track>, overlay, releasemode and underneath', () => {
    path('show:live:1:vja:1', 1);
    path('show:live:2:vja:1', 1);
    path('show:release:2', 1);
    expect(Object.keys(surfaces())).toEqual(['wall']);
    path('show:release:2', 0);
    path('show:overlay', 0.4);
    expect(takeover.liveTakeover.state.overlay?.level).toBe(0.4);
    path('show:overlay', 0);
    expect(takeover.liveTakeover.state.overlay?.level).toBe(0);
    path('show:release', 1);
    expect(surfaces()).toEqual({});
    path('show:releasemode:bar', 1);
    expect(takeover.liveTakeover.state.defaultRelease.mode).toBe('bar');
    path('show:underneath:pause', 1);
    expect(takeover.liveTakeover.state.underneath).toBe('pause');
  });

  it('the cue paths still fire on the rising edge only', () => {
    const a = cues.cueList.addCue({ name: 'A' });
    cues.cueList.addCue({ name: 'B' });
    path('show:go', 1);
    path('show:go', 0);
    expect(cues.cueList.state.currentCueId).toBe(a);
  });
});

describe('takeover cue actions', () => {
  it('take a track over and hand it back through the app executor', () => {
    const cue = cues.cueList.addCue({ name: 'VJ in' });
    const act = cues.cueList.addAction(cue, 'takeover');
    cues.cueList.updateAction(cue, act, { trackId: logo, source: 'vjRow', deck: 'B', row: 3 });
    const back = cues.cueList.addCue({ name: 'VJ out' });
    const rel = cues.cueList.addAction(back, 'takeoverRelease');
    cues.cueList.updateAction(back, rel, { trackId: '', mode: 'instant' });
    cues.cueList.go();
    expect(surfaces().logo).toMatchObject({ trackId: logo, source: { kind: 'vjRow', deck: 'B', row: 3 } });
    cues.cueList.go();
    expect(surfaces()).toEqual({});
  });

  it('normalise and survive a save', () => {
    const a = cues.normalizeCueAction({ kind: 'takeover', trackId: 't', source: 'nope', row: 99 });
    expect(a).toMatchObject({ kind: 'takeover', source: 'vjRow', row: 63, deck: 'A', groupId: '' });
    const r = cues.normalizeCueAction({ kind: 'takeoverRelease', mode: 'bar', fade: -1 });
    expect(r).toMatchObject({ kind: 'takeoverRelease', trackId: '', mode: 'bar', fade: 0 });
  });
});

describe('marker policy', () => {
  function markerCue() {
    const id = cues.cueList.addCue({ name: 'drop' });
    cues.cueList.addAction(id, 'vjStopAll');
    const b = cues.cueList.addAction(id, 'blackout');
    cues.cueList.updateAction(id, b, { on: true });
    cues.cueList.addAction(id, 'macro');
    return id;
  }

  it("'hold' keeps a marker cue's VJ and blackout actions until the hand-back; GO is never held", () => {
    const stopAll = vi.spyOn(launcher.vjClipLauncher, 'stopAll');
    try {
      const id = markerCue();
      takeover.liveTakeover.setMarkerPolicy('hold');
      path('show:live:1:vja:1', 1);
      cues.cueList.fire(id, 'marker');
      expect(stopAll).not.toHaveBeenCalled();
      expect(get(settingsMod.settings).output.blackout).toBe(false);
      expect(takeover.liveTakeover.state.deferredCount).toBe(2);
      path('show:release', 1);
      expect(stopAll).toHaveBeenCalledTimes(1);
      expect(get(settingsMod.settings).output.blackout).toBe(true);
      expect(takeover.liveTakeover.state.deferredCount).toBe(0);
      runtime.setBlackout(false);
      // GO during a takeover runs everything at once.
      path('show:live:1:vja:1', 1);
      cues.cueList.fire(id, 'go');
      expect(stopAll).toHaveBeenCalledTimes(2);
      path('show:release', 1);
      runtime.setBlackout(false);
    } finally {
      stopAll.mockRestore();
    }
  });

  it("'fire' (the default) runs marker cues as normal during a takeover", () => {
    const stopAll = vi.spyOn(launcher.vjClipLauncher, 'stopAll');
    try {
      const id = markerCue();
      path('show:live:1:vja:1', 1);
      cues.cueList.fire(id, 'marker');
      expect(stopAll).toHaveBeenCalledTimes(1);
      expect(get(settingsMod.settings).output.blackout).toBe(true);
      runtime.setBlackout(false);
    } finally {
      stopAll.mockRestore();
    }
  });

  it('shouldHoldCueAction: only clock-fired VJ and blackout actions, only while taken over', () => {
    const vjStop = { id: 'x', kind: 'vjStopAll' } as const;
    const macro = { id: 'm', kind: 'macro', macro: 1, value: 1, fade: 0 } as const;
    expect(takeoverRt.shouldHoldCueAction(vjStop, 'marker', 'hold', true)).toBe(true);
    expect(takeoverRt.shouldHoldCueAction(vjStop, 'timecode', 'hold', true)).toBe(true);
    expect(takeoverRt.shouldHoldCueAction(vjStop, 'go', 'hold', true)).toBe(false);
    expect(takeoverRt.shouldHoldCueAction(vjStop, 'marker', 'fire', true)).toBe(false);
    expect(takeoverRt.shouldHoldCueAction(vjStop, 'marker', 'hold', false)).toBe(false);
    expect(takeoverRt.shouldHoldCueAction(macro, 'marker', 'hold', true)).toBe(false);
  });
});

describe('a cleared show', () => {
  it('ends the takeover', () => {
    path('show:live:1:vja:1', 1);
    timeline.showTimeline.clear();
    expect(surfaces()).toEqual({});
  });
});

describe('leaving VJ mode with vj:mode', () => {
  const shader = (id: string) => ({ id, type: 'shader', name: id, src: `./ISF/${id}.fs`, shaderCode: 'void main(){}' }) as any;
  const vj = () => get(launcher.vjClipLauncher);
  const active = () => vj().layerStates.slice(0, 2).map((ls) => ls.activeClip?.id ?? null);
  const enterVj = () => {
    launcher.vjClipLauncher.reset();
    launcher.vjClipLauncher.setClip(0, 0, shader('red'));
    launcher.vjClipLauncher.setClip(1, 0, shader('blue'));
    launcher.vjClipLauncher.triggerClipNow(0, 0, 'A');
    launcher.vjClipLauncher.triggerClipNow(1, 0, 'A');
    path('vj:mode', 1);
    expect(vj().isOpen && vj().isLive).toBe(true);
  };

  it('keeps the row a takeover samples playing, stops the rest, and stops it at the hand-back', () => {
    enterVj();
    path('show:live:1:vja:2', 1);
    expect(vj().takeoverLive).toBe(true);
    path('vj:mode', 1);
    expect(vj().isOpen || vj().isLive).toBe(false);
    expect(active()).toEqual([null, 'blue']);
    path('show:release', 1);
    expect(vj().takeoverLive).toBe(false);
    expect(active()).toEqual([null, null]);
  });

  it('with nothing taken over it stops everything, as before', () => {
    enterVj();
    const stopAll = vi.spyOn(launcher.vjClipLauncher, 'stopAll');
    try {
      path('vj:mode', 1);
      expect(stopAll).toHaveBeenCalledTimes(1);
      expect(active()).toEqual([null, null]);
    } finally {
      stopAll.mockRestore();
    }
  });
});

describe('a controller that disconnects', () => {
  it("hands back the takeovers it holds, with the default release, and only those", () => {
    takeover.liveTakeover.setDefaultRelease({ mode: 'fade', fadeSeconds: 1 });
    path('show:live:1:vja:1:hold', 1, 'midi:dev-1:m1:0:36');
    path('show:live:2:vja:2:hold', 1, 'midi:dev-10:m2:0:37');
    expect(surfaces().wall?.momentaryInputs).toEqual(['midi:dev-1:m1:0:36']);
    router.midiRouter.releaseInputs('midi:dev-1:');
    expect(surfaces().wall?.phase).toBe('releasing');
    expect(surfaces().wall?.release?.spec).toEqual({ mode: 'fade', fadeSeconds: 1 });
    expect(surfaces().logo?.phase).toBe('live');
    router.midiRouter.releaseInputs('midi:dev-10:');
    expect(surfaces().logo?.phase).toBe('releasing');
  });

  it('leaves latched takeovers alone', () => {
    path('show:live:1:vja:1', 1, 'midi:dev-1:m1:0:36');
    router.midiRouter.releaseInputs('midi:dev-1:');
    expect(surfaces().wall?.phase).toBe('live');
  });
});


describe('an offline render', () => {
  it('does not move a pending release on with its own playhead', async () => {
    const audio = await import('../../audio/visualAudio');
    cues.cueList.addMarker(3);
    timeline.showTimeline.addLayerClip(wall, { kind: 'layer', name: 'layer', src: '' } as any, 0, { duration: 30 });
    timeline.showTimeline.seek(1);
    timeline.showTimeline.play();
    path('show:live:1:vja:1', 1);
    takeover.liveTakeover.release('all', { mode: 'marker', fadeSeconds: 0 });
    expect(surfaces().wall?.phase).toBe('pendingRelease');
    expect(surfaces().wall?.release?.at.showTime).toBe(3);
    audio.setVisualAudioManualTime(0);
    try {
      // The render seeks the show past the marker on its own clock.
      timeline.showTimeline.seek(5);
      expect(surfaces().wall?.phase).toBe('pendingRelease');
    } finally {
      audio.setVisualAudioManualTime(null);
    }
    // Back on the live clock, the show past the marker hands back.
    timeline.showTimeline.seek(5.1);
    expect(surfaces().wall).toBeUndefined();
    timeline.showTimeline.pause();
  });
});

describe('stop all during a takeover', () => {
  const shader = (id: string) => ({ id, type: 'shader', name: id, src: `./ISF/${id}.fs`, shaderCode: 'void main(){}' }) as any;
  const active = () => get(launcher.vjClipLauncher).layerStates.slice(0, 2).map((ls) => ls.activeClip?.id ?? null);
  const twoRows = () => {
    launcher.vjClipLauncher.reset();
    launcher.vjClipLauncher.setClip(0, 0, shader('red'));
    launcher.vjClipLauncher.setClip(1, 0, shader('blue'));
    launcher.vjClipLauncher.triggerClipNow(0, 0, 'A');
    launcher.vjClipLauncher.triggerClipNow(1, 0, 'A');
  };

  it('vj:stopall keeps the taken-over row until the hand-back', () => {
    twoRows();
    path('show:live:1:vja:2', 1);
    path('vj:stopall', 1);
    expect(active()).toEqual([null, 'blue']);
    path('show:release', 1);
    expect(active()).toEqual([null, null]);
  });

  it("a cue's Stop all VJ clips keeps the taken-over row until the hand-back", () => {
    twoRows();
    const cue = cues.cueList.addCue({ name: 'stop' });
    cues.cueList.addAction(cue, 'vjStopAll');
    path('show:live:1:vja:2', 1);
    cues.cueList.fire(cue, 'go');
    expect(active()).toEqual([null, 'blue']);
    path('show:release', 1);
    expect(active()).toEqual([null, null]);
  });
});

describe('controllers on show:live', () => {
  it('a CC knob takes over once on its way up and hands back on its next way up, instead of toggling on every step', () => {
    const knob = 'midi:dev1:map1:0:21';
    for (const v of [0.05, 0.2, 0.4, 0.8, 1]) path('show:live:1:vja:2', v, knob);
    expect(surfaces().wall?.phase).toBe('live');
    path('show:live:1:vja:2', 0, knob);
    expect(surfaces().wall?.phase).toBe('live');
    for (const v of [0.1, 0.3]) path('show:live:1:vja:2', v, knob);
    expect(surfaces().wall).toBeUndefined();
  });

  it('a held pad lets go of its track even after the tracks were reordered under it', () => {
    const pad = 'midi:dev1:map2:0:36';
    path('show:live:1:mix:hold', 1, pad);
    expect(surfaces().wall?.momentaryInputs).toEqual([pad]);
    // Wall moves below Logo while held: track 1 is now Logo.
    timeline.showTimeline.reorderLayerTrack(wall, 1);
    expect(get(timeline.showTimeline).layerTracks[0].id).toBe(logo);
    path('show:live:1:mix:hold', 0, pad);
    expect(surfaces().wall).toBeUndefined();
    expect(surfaces().logo).toBeUndefined();
  });

  it('a note-off that learn or identify mode keeps from the mappings still lets go of a held takeover', async () => {
    const { midiStore } = await import('../../midi/midiStore');
    midiStore.startLearn('show:live:1:mix:hold', 'Wall live', 0, 1, 0, 'absolute');
    midiStore.completeLearn(0, 'note', 36);
    try {
      router.midiRouter.routeMessage(0, 'note', 36, 100, { id: 'dev1', name: 'Pads' });
      expect(surfaces().wall?.phase).toBe('live');
      router.midiRouter.routeShowReleases(0, 'note', 36, { id: 'dev1', name: 'Pads' });
      expect(surfaces().wall).toBeUndefined();
      // The pad's next press takes over again (its release was seen).
      router.midiRouter.routeMessage(0, 'note', 36, 100, { id: 'dev1', name: 'Pads' });
      expect(surfaces().wall?.phase).toBe('live');
      router.midiRouter.routeMessage(0, 'note', 36, 0, { id: 'dev1', name: 'Pads' });
      expect(surfaces().wall).toBeUndefined();
    } finally {
      midiStore.clearAllMappings();
    }
  });
});

describe('an override whose track is gone', () => {
  it('ends when the track is deleted', () => {
    path('show:live:1:vja:1', 1);
    path('show:live:2:black', 1);
    timeline.showTimeline.removeLayerTrack(wall);
    expect(Object.keys(surfaces())).toEqual(['logo']);
  });

  it('ends when an undo takes the track away (the arrangement is restored without it)', () => {
    const before = timeline.showTimeline.exportArrangement();
    timeline.showTimeline.addLayerTrack(types.createLayer('extra', 'Extra', 'media'));
    const trackId = get(timeline.showTimeline).layerTracks.find((t) => t.layerId === 'extra')!.id;
    takeoverRt.takeOverTrack(takeoverRt.trackById(trackId)!, { kind: 'black' });
    path('show:live:1:black', 1);
    expect(Object.keys(surfaces()).sort()).toEqual(['extra', 'wall']);
    // What undo does: put the arrangement from before the track back.
    timeline.showTimeline.restoreArrangement(before);
    expect(Object.keys(surfaces())).toEqual(['wall']);
  });
});
