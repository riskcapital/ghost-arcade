/**
 * The read-only show state: what it says about the Timeline (document,
 * time, tempo, bar and beat, section and next, GO, takeover, phrases,
 * blackout, install health), that it is worked out at most 10 times a second
 * however often the show publishes, that a paused show publishes nothing,
 * and that nothing runs without a subscriber.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get, writable } from 'svelte/store';

// The stores the app keeps in the browser (settings) want a page.
{
  const storage = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => void storage.set(k, String(v)),
    removeItem: (k: string) => void storage.delete(k), clear: () => storage.clear(), key: () => null, length: 0,
  };
  const el = (): any => ({
    style: { setProperty() {}, removeProperty() {}, getPropertyValue: () => '' }, dataset: {},
    classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
    setAttribute() {}, removeAttribute() {}, getAttribute: () => null, appendChild: (c: any) => c, removeChild: (c: any) => c,
    addEventListener() {}, removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
  });
  (globalThis as any).document ??= {
    documentElement: el(), body: el(), head: el(), createElement: () => el(), querySelector: () => null, querySelectorAll: () => [],
    getElementById: () => null, addEventListener() {}, removeEventListener() {}, visibilityState: 'visible',
  };
  (globalThis as any).matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
}

let installOn = false;
const paused = writable(false);
vi.mock('../install/installSession', () => ({ installModeRunning: () => installOn, installPaused: paused }));

const { showTimeline, setShowAudioClockReader, setShowCompositionLoader } = await import('../stores/showTimeline');
const { liveTakeover } = await import('./takeover/liveTakeover');
const { settings } = await import('../stores/settings');
const { cueList } = await import('./cueList');
const { showState, sampleShowState, installHealthFrom, _setShowStateSources, SHOW_STATE_INTERVAL_MS } = await import('./showState');

const sec = (id: string, start: number, end: number, extra: Record<string, unknown> = {}) => ({ id, name: id, color: '#5b8def', start, end, action: 'through', ...extra });
function timelineWith(sections: ReturnType<typeof sec>[], length = 32) {
  showTimeline.hydrate({
    version: 8, activeDoc: 'timeline', audioTracks: [], presetClips: [],
    timeline: {
      version: 8, presetClips: [], sections,
      audioTracks: [{ id: 'song', name: 'Song', url: 'blob:song', startTime: 0, duration: length, offset: 0, sourceDuration: length, volume: 1, muted: false, lane: 0, peaks: [1] }],
      tempo: { offset: 0, segments: [{ bar: 1, bpm: 120, beatsPerBar: 4, beatUnit: 4 }], source: 'manual' },
    },
  });
}

let frames: Array<(now: number) => void> = [];
let frameMs = 0;
let clock = 0;
let wall = 0;
function frame(ms: number) {
  frameMs += ms;
  clock += ms / 1000;
  wall += ms;
  vi.advanceTimersByTime(ms);
  const pending = frames;
  frames = [];
  for (const cb of pending) cb(frameMs);
}

beforeEach(() => {
  vi.useFakeTimers();
  showTimeline._resetForTest();
  setShowCompositionLoader(() => {});
  cueList.hydrate(null);
  liveTakeover.reset();
  settings.update((s) => ({ ...s, output: { ...s.output, blackout: false } }));
  frames = [];
  frameMs = 1000;
  clock = 100;
  wall = 1_700_000_000_000;
  vi.stubGlobal('requestAnimationFrame', (cb: (now: number) => void) => { frames.push(cb); return frames.length; });
  vi.stubGlobal('cancelAnimationFrame', () => { frames = []; });
  setShowAudioClockReader(null);
  showTimeline._setSectionClock(() => clock);
  installOn = false;
  _setShowStateSources({ now: () => wall, installStatus: async () => null });
});
afterEach(() => {
  _setShowStateSources(null);
  setShowCompositionLoader(null);
  showTimeline._resetForTest();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('what it says', () => {
  it('document, time, tempo with bar and beat, the section and the next one, GO', () => {
    timelineWith([sec('intro', 0, 8, { kind: 'intro' }), sec('drop', 8, 16, { kind: 'drop', action: 'hold' }), sec('out', 16, 32)]);
    showTimeline.seek(9.25);
    const s = sampleShowState();
    expect(s).toMatchObject({
      doc: 'timeline', playing: false, time: 9.25, duration: 32, loop: false, following: false,
      tempo: { bpm: 120, bar: 5, beat: 3, beatsPerBar: 4 },
      section: { id: 'drop', name: 'drop', kind: 'drop', action: 'hold', start: 8, end: 16 },
      nextSection: { id: 'out', action: 'through' },
      go: { label: 'Play', status: '', holding: false, armed: false, target: 'sections' },
      takeover: { active: false, rows: [], overlay: null },
      phrase: { playing: null, waiting: null },
      blackout: false,
      install: { running: false, uptime: null, fps: null, restarts: null, lastError: null },
    });
  });

  it('holding at a section end, a takeover, a waiting phrase and blackout show up', () => {
    timelineWith([sec('a', 0, 4, { action: 'hold', phrase: { end: 'section' } }), sec('b', 4, 12, { phrase: { end: 'loop' } })]);
    showTimeline.seek(3.5);
    showTimeline.play();
    for (let i = 0; i < 20; i++) frame(50);
    let s = sampleShowState();
    expect(s.go).toMatchObject({ holding: true, label: 'Go on from a', status: 'HOLD · a', target: 'sections' });
    expect(s.section?.id).toBe('a');
    showTimeline.addLayerTrack({ id: 'wall', name: 'Wall', type: 'media', visible: true, opacity: 1, blendMode: 'normal', source: null } as never);
    const track = get(showTimeline).layerTracks[0];
    liveTakeover.engage(track.layerId, { kind: 'vjMix' }, { trackId: track.id });
    showTimeline.launchPhrase('b', { delay: 4 });
    settings.update((x) => ({ ...x, output: { ...x.output, blackout: true } }));
    s = sampleShowState();
    expect(s.takeover.active).toBe(true);
    expect(s.takeover.rows).toEqual([expect.objectContaining({ trackId: track.id })]);
    expect(s.phrase.waiting).toEqual({ id: 'b', name: 'b' });
    expect(s.blackout).toBe(true);
    showTimeline.cancelPhraseLaunch();
  });

  it('on the Show tab GO is the cue list\'s: what stands by', () => {
    showTimeline.addPresetClip('comp', 10);
    cueList.addCue({ name: 'Opening' });
    const s = sampleShowState();
    expect(s.doc).toBe('show');
    expect(s.section).toBeNull();
    expect(s.go).toMatchObject({ target: 'cues', holding: false });
    expect(s.go.label).toMatch(/^Cue \S+ Opening$/);
  });

  it('install health from the main process: uptime, core frame rate, restarts, the last problem', () => {
    const first = installHealthFrom({ uptimeMs: 65_400, core: { frames: 1000, at: 10_000 }, restarts: { coreKills: 1, reloads: 0, relaunches: 0 }, recent: [] }, null, 58);
    expect(first.health).toEqual({ uptime: 65, fps: 58, restarts: 1, lastError: null });
    const second = installHealthFrom({
      uptimeMs: 68_400, core: { frames: 1180, at: 13_000 }, restarts: { coreKills: 1, reloads: 1, relaunches: 0 },
      recent: [{ at: 1, kind: 'restart', message: 'render core ended (stalled)' }, { at: 2, kind: 'schedule', message: 'on' }, { at: 3, kind: 'warning', message: 'editor did not answer for 20 s' }, { at: 4, kind: 'show', message: 'playing' }],
    }, first.core, 58);
    expect(second.health).toEqual({ uptime: 68, fps: 60, restarts: 2, lastError: { at: 3, kind: 'warning', message: 'editor did not answer for 20 s' } });
    // A restarted core (counter went back): no rate from it this time.
    expect(installHealthFrom({ core: { frames: 10, at: 16_000 } }, second.core, null).health.fps).toBeNull();
  });
});

describe('cost', () => {
  it('a playing show publishes at most 10 times a second however often it moves; a paused one publishes nothing', () => {
    timelineWith([sec('a', 0, 16)]);
    let published = 0;
    const times: number[] = [];
    const off = showState.subscribe((s) => { published++; times.push(s.time); });
    expect(published).toBe(1);
    showTimeline.play();
    // 2 s at 60 frames a second: 120 show updates.
    for (let i = 0; i < 120; i++) frame(1000 / 60);
    expect(published - 1).toBeGreaterThanOrEqual(18);
    expect(published - 1).toBeLessThanOrEqual(21);
    // The time it reports follows the playhead.
    expect(times.at(-1)!).toBeGreaterThan(1.8);
    showTimeline.pause();
    frame(200);
    const after = published;
    for (let i = 0; i < 120; i++) frame(1000 / 60);
    vi.advanceTimersByTime(5000);
    expect(published).toBe(after);
    off();
  });

  it('without a subscriber nothing is scheduled; the install status is asked for only while install mode runs', async () => {
    timelineWith([sec('a', 0, 16)]);
    const status = vi.fn(async () => ({ uptimeMs: 4000, core: { frames: 240, at: wall }, restarts: { coreKills: 0, reloads: 0, relaunches: 0 }, recent: [] }));
    _setShowStateSources({ now: () => wall, installStatus: status });
    showTimeline.play();
    for (let i = 0; i < 30; i++) frame(1000 / 60);
    // The show's own timers; none of ours without a subscriber.
    const base = vi.getTimerCount();
    for (let i = 0; i < 30; i++) frame(1000 / 60);
    expect(vi.getTimerCount()).toBe(base);
    let last = get(showState);
    expect(vi.getTimerCount()).toBe(base);
    const off = showState.subscribe((s) => { last = s; });
    vi.advanceTimersByTime(4000);
    expect(status).not.toHaveBeenCalled();
    expect(last.install.running).toBe(false);
    off();
    installOn = true;
    const off2 = showState.subscribe((s) => { last = s; });
    await vi.advanceTimersByTimeAsync(SHOW_STATE_INTERVAL_MS * 2);
    expect(status).toHaveBeenCalledTimes(1);
    expect(last.install).toMatchObject({ running: true, uptime: 4, restarts: 0 });
    await vi.advanceTimersByTimeAsync(3000);
    expect(status).toHaveBeenCalledTimes(2);
    off2();
    expect(vi.getTimerCount()).toBe(base);
  });
});
