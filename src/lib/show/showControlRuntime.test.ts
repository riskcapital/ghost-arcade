/**
 * The live show-control runtime: the app's cue executor against the real
 * stores, `show:*` control paths through the shared MIDI/OSC/keyboard
 * router, timeline markers firing cues as the playhead crosses them, the
 * timecode chase driving the timeline and firing timecoded cues, and a cue
 * commanding a fake PJLink projector through the projector store.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createPjlinkClient } = require('../../../electron/pjlink.cjs');
const { startFakePjlink } = require('../../../scripts/fake-pjlink-server.cjs');

let layers: typeof import('../stores/layers');
let runtime: typeof import('./showControlRuntime');
let cues: typeof import('./cueList');
let router: typeof import('../midi/midiRouter');
let timeline: typeof import('../stores/showTimeline');
let settingsMod: typeof import('../stores/settings');
let macrosMod: typeof import('../stores/macros');
let tc: typeof import('./timecode/timecodeChase');
let proj: typeof import('./projectors');
let teardown: () => void;

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
  // Same import order as the app: layers first pulls the store graph in.
  layers = await import('../stores/layers');
  router = await import('../midi/midiRouter');
  cues = await import('./cueList');
  timeline = await import('../stores/showTimeline');
  settingsMod = await import('../stores/settings');
  macrosMod = await import('../stores/macros');
  tc = await import('./timecode/timecodeChase');
  proj = await import('./projectors');
  runtime = await import('./showControlRuntime');
  teardown = runtime.installShowControl();
});

afterAll(() => {
  teardown?.();
});

function freshList() {
  cues.cueList.hydrate(null);
  timeline.showTimeline._resetForTest();
}

describe('show:* control paths', () => {
  it('GO, Back, Stop, Reset and fire-cue work through the router, on the rising edge only', () => {
    freshList();
    const { cueList } = cues;
    const a = cueList.addCue({ name: 'A' });
    const b = cueList.addCue({ name: 'B' });
    const c = cueList.addCue({ name: 'C' });
    router.midiRouter.dispatchPath('show:go', 1);
    expect(cueList.state.currentCueId).toBe(a);
    router.midiRouter.dispatchPath('show:go', 0);
    expect(cueList.state.currentCueId).toBe(a);
    router.midiRouter.dispatchPath('show:go', 1);
    expect(cueList.state.currentCueId).toBe(b);
    router.midiRouter.dispatchPath('show:back', 1);
    expect(cueList.state.currentCueId).toBe(a);
    router.midiRouter.dispatchPath('show:cue:2', 1);
    expect(cueList.state.currentCueId).toBe(c);
    router.midiRouter.dispatchPath('show:reset', 1);
    expect(cueList.state.currentCueId).toBeNull();
    expect(cueList.state.standbyCueId).toBe(a);
    expect(cueList.state.history.map((h) => h.source)).toEqual(['remote', 'remote', 'back', 'remote']);
  });
});

describe('app executor', () => {
  it('blackout, macro fades and snapshot recall reach the real stores', async () => {
    freshList();
    const { cueList } = cues;
    const id = cueList.addCue();
    cueList.addAction(id, 'blackout');
    const m = cueList.addAction(id, 'macro');
    cueList.updateAction(id, m, { macro: 2, value: 0.75, fade: 0 });
    cueList.go();
    expect(get(settingsMod.settings).output.blackout).toBe(true);
    expect(get(macrosMod.macros).macros.find((x) => x.id === 'macro-2')?.value).toBe(0.75);
    runtime.setBlackout(false);
    expect(get(settingsMod.settings).output.blackout).toBe(false);
  });

  it('a timeline action starts the show timeline', () => {
    freshList();
    timeline.showTimeline.addPresetClip('comp-x', 30);
    const { cueList } = cues;
    const id = cueList.addCue();
    cueList.addAction(id, 'timeline');
    cueList.go();
    expect(get(timeline.showTimeline).isPlaying).toBe(true);
    cueList.stop();
    expect(get(timeline.showTimeline).isPlaying).toBe(false);
  });
});

describe('markers on the timeline', () => {
  it('fire their cues as the playhead crosses them, not on a jump', () => {
    freshList();
    const { showTimeline } = timeline;
    showTimeline.addPresetClip('comp-x', 60);
    const { cueList } = cues;
    const a = cueList.addCue({ name: 'at 0' });
    const b = cueList.addCue({ name: 'at 5' });
    const c = cueList.addCue({ name: 'at 40' });
    cueList.addMarker(0, a);
    cueList.addMarker(5, b);
    cueList.addMarker(40, c);
    // Drive the playhead as the transport would: small forward steps.
    showTimeline.chase(0, true);
    expect(cueList.state.currentCueId).toBe(a);
    for (let t = 0.016; t < 6; t += 0.016) showTimeline.chase(t, true);
    expect(cueList.state.currentCueId).toBe(b);
    // A jump past 40 is a locate, not playback: the marker does not fire.
    showTimeline.chase(45, true);
    expect(cueList.state.currentCueId).toBe(b);
    expect(cueList.state.history.map((h) => [h.cueId, h.source])).toEqual([[a, 'marker'], [b, 'marker']]);
    showTimeline.releaseChase();
  });
});

describe('timecode chase', () => {
  it('drives the timeline through the offset and fires timecoded cues', () => {
    freshList();
    const { showTimeline } = timeline;
    showTimeline.addPresetClip('comp-x', 120);
    const { cueList } = cues;
    const hit = cueList.addCue({ name: 'at 00:00:10:00 show time', timecode: 10 });
    tc.timecodeChase.settings.set(tc.normalizeTimecodeSettings({ source: 'ltc', offset: 3600 }));
    const label = { hours: 1, minutes: 0, seconds: 9, frames: 0, rate: 25 as const, dropFrame: false };
    let now = 1000;
    for (let i = 0; i < 60; i++) {
      tc.timecodeChase.feed(3609 + i * 0.04, now, true, label);
      tc.timecodeChase.step(now + 5);
      now += 40;
    }
    const s = get(showTimeline);
    expect(s.isPlaying).toBe(true);
    expect(s.currentTime).toBeGreaterThan(11);
    expect(s.currentTime).toBeLessThan(11.5);
    expect(cueList.state.history.map((h) => [h.cueId, h.source])).toEqual([[hit, 'timecode']]);
    // Source gone for longer than the freewheel: the show pauses.
    tc.timecodeChase.step(now + 5000);
    expect(get(showTimeline).isPlaying).toBe(false);
    tc.timecodeChase.settings.set(tc.normalizeTimecodeSettings({}));
    expect(showTimeline.isChasing()).toBe(false);
  });
});

describe('projectors from a cue', () => {
  it('a cue fired by GO sends authenticated POWR and AVMT through the app executor', async () => {
    freshList();
    const server = await startFakePjlink({ password: 'house' });
    try {
      const client = createPjlinkClient();
      proj.setPjlinkTransport((req) => client.run(req));
      proj.projectors.hydrate(null);
      const pid = proj.projectors.add({ name: 'Booth', host: '127.0.0.1', port: server.port, password: 'house' });
      const { cueList } = cues;
      const id = cueList.addCue();
      const on = cueList.addAction(id, 'projector');
      cueList.updateAction(id, on, { projectorId: pid, command: 'power-on' });
      const mute = cueList.addAction(id, 'projector');
      cueList.updateAction(id, mute, { projectorId: pid, command: 'shutter-close' });
      router.midiRouter.dispatchPath('show:go', 1);
      // The runtime also polls status (queries end in '?'); keep commands.
      const commands = () => server.received.filter((r: { line: string }) => !r.line.endsWith('?'));
      for (let i = 0; i < 100 && commands().length < 2; i++) await new Promise((r) => setTimeout(r, 10));
      expect(commands().map((r: { line: string; authenticated: boolean }) => [r.line, r.authenticated])).toEqual([
        ['%1POWR 1', true],
        ['%1AVMT 31', true],
      ]);
    } finally {
      proj.projectors._resetForTest();
      await server.close();
    }
  });
});
