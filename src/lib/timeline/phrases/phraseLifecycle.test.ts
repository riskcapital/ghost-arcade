/**
 * Phrase state that must end with its owner: a waiting launch whose section
 * is deleted is called off (and Live's cut cleared), the VJ decks get the
 * output back however the phrases end, Clear and a followed clock forget
 * them, a seek calls a waiting launch off, and the pads work from the Show
 * tab (launching opens the Timeline).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

vi.mock('../../stores/vjClipLauncher', async () => {
  const { writable } = await import('svelte/store');
  const s = writable({ quantization: '1bar', isOpen: true, isLive: true });
  return { vjClipLauncher: { subscribe: s.subscribe, set: s.set, setLive: (v: boolean) => s.update((x) => ({ ...x, isLive: v })) } };
});
vi.mock('../../ableton/abletonBridge', async () => {
  const { writable } = await import('svelte/store');
  return { abletonBridge: { ...writable({}), launchScene: () => {} }, LIVE_PHRASE_PROTOCOL: 6, setPhraseLinkLauncher: () => {} };
});
vi.mock('../sound/soundEngine', () => ({ liveSchedulerNow: () => { throw new Error('not in these tests'); } }));

import { setShowAudioClockReader, setShowCompositionLoader, setShowPhraseEffects, setShowTrackFrameSink, showPhraseStatus, showTimeline, type ShowPhraseEvent } from '../../stores/showTimeline';
import { vjClipLauncher } from '../../stores/vjClipLauncher';
import { _resetPhraseRuntime, handlePhraseEvent, launchPhrase as padLaunch, setPhraseLiveOut, setPhraseRuntimeClock } from './phraseRuntime';
import type { TimelineSection } from '../sections/sectionModel';
import type { Layer } from '../../types';

let frames: Array<(now: number) => void> = [];
let frameMs = 0;
let timers: Array<{ fn: () => void; at: number }> = [];
function frame(ms = 50) {
  frameMs += ms;
  const p = frames;
  frames = [];
  for (const cb of p) cb(frameMs);
  const due = timers.filter((t) => t.at <= frameMs);
  timers = timers.filter((t) => t.at > frameMs);
  for (const t of due) t.fn();
}
function playFor(seconds: number, ms = 50) {
  for (let i = 0; i < Math.round((seconds * 1000) / ms); i++) frame(ms);
}
const layer = (id: string) => ({ id, name: id, type: 'media', visible: true, opacity: 1, blendMode: 'normal', source: null } as unknown as Layer);
const sec = (id: string, start: number, end: number, extra: Partial<TimelineSection> = {}): TimelineSection =>
  ({ id, name: id.toUpperCase(), color: '#5b8def', start, end, action: 'through', phrase: { end: 'section' }, ...extra } as TimelineSection);
function timeline(sections: TimelineSection[], activeDoc: 'timeline' | 'show' = 'timeline', length = 32) {
  showTimeline.hydrate({
    version: 8,
    activeDoc,
    audioTracks: [],
    presetClips: [],
    timeline: {
      version: 8,
      audioTracks: [{ id: 'song', name: 'Song', url: 'blob:song', startTime: 0, duration: length, offset: 0, sourceDuration: length, volume: 1, muted: false, lane: 0, peaks: [1] }],
      presetClips: [],
      sections,
      tempo: { offset: 0, segments: [{ bar: 1, bpm: 120, beatsPerBar: 4, beatUnit: 4 }], source: 'manual' },
    },
  } as never);
  if (activeDoc === 'timeline') showTimeline.syncStageRows([layer('A')], []);
}
const vjLive = () => (get(vjClipLauncher) as unknown as { isLive: boolean }).isLive;

let events: ShowPhraseEvent[] = [];
let cuts: Array<number | null> = [];
let resyncs = 0;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  showTimeline._resetForTest();
  _resetPhraseRuntime();
  setShowCompositionLoader(() => {});
  frames = [];
  timers = [];
  frameMs = 1000;
  events = [];
  cuts = [];
  resyncs = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: (now: number) => void) => { frames.push(cb); return frames.length; });
  vi.stubGlobal('cancelAnimationFrame', () => { frames = []; });
  setShowAudioClockReader(null);
  showTimeline._setSectionClock(() => frameMs / 1000);
  showTimeline._setPhraseClock(() => frameMs, (fn, ms) => { const t = { fn, at: frameMs + ms }; timers.push(t); return t; }, (h) => { timers = timers.filter((t) => t !== h); });
  setPhraseRuntimeClock(() => frameMs);
  const fire = { t: 'fire_clip', i: 0, s: 1 };
  const sched = {
    entryPlan: () => ({ fires: [{ blockId: 'x', track: 0, lead: 10, cmd: fire }], stops: [] }),
    setCut: (c: number | null) => cuts.push(c),
    primeEntry: () => {},
    sendEntry: () => {},
    stopForEntry: () => {},
    resyncSoon: () => { resyncs++; },
  };
  setPhraseLiveOut({ scheduler: () => sched as never, bridge: () => ({ connected: true, protocol: 6, quantize: 4, numerator: 4, denominator: 4, scenes: [] } as never), fireScene: () => {} });
  setShowPhraseEffects((e) => { events.push(e); handlePhraseEvent(e); });
  setShowTrackFrameSink(() => {});
  (vjClipLauncher as unknown as { set: (v: unknown) => void }).set({ quantization: '1bar', isOpen: true, isLive: true });
});
afterEach(() => {
  setShowPhraseEffects(null);
  setShowTrackFrameSink(null);
  setShowCompositionLoader(null);
  setPhraseLiveOut(null);
  setPhraseRuntimeClock(null);
  _resetPhraseRuntime();
  showTimeline._resetForTest();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('a waiting launch whose phrase goes away', () => {
  it('is called off at its bar: Live gets its cut cleared and is put back', () => {
    timeline([sec('a', 0, 8), sec('b', 8, 16)]);
    showTimeline.play(); playFor(1);
    showTimeline.launchPhrase('b', { delay: 1 });
    showTimeline.removeSection('b');
    playFor(2);
    expect(events.map((e) => e.type)).toEqual(['pending', 'cancel']);
    expect(cuts.at(-1)).toBe(null);
    expect(resyncs).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(get(showPhraseStatus).pending).toBe(null);
  });

  it('launched from stopped, it is called off too', () => {
    timeline([sec('a', 0, 8), sec('b', 8, 16)]);
    showTimeline.launchPhrase('b', { delay: 1 });
    showTimeline.removeSection('b');
    playFor(2);
    expect(events.map((e) => e.type)).toEqual(['pending', 'cancel']);
    expect(get(showTimeline).isPlaying).toBe(false);
  });
});

describe('the VJ decks get the output back', () => {
  it('on Timeline Stop', () => {
    timeline([sec('a', 0, 8), sec('b', 8, 16)]);
    showTimeline.launchPhrase('a', { delay: 0 });
    playFor(0.5);
    expect(vjLive()).toBe(false);
    showTimeline.stop();
    expect(vjLive()).toBe(true);
    expect(events.map((e) => e.type)).toContain('stop');
  });

  it('at the end of a Timeline that does not loop', () => {
    timeline([sec('a', 0, 2, { phrase: { end: 'through' } } as Partial<TimelineSection>)], 'timeline', 4);
    showTimeline.launchPhrase('a', { delay: 0 });
    playFor(5);
    expect(get(showTimeline).isPlaying).toBe(false);
    expect(get(showPhraseStatus).activeId).toBe(null);
    expect(vjLive()).toBe(true);
  });

  it('when the Show tab opens', () => {
    timeline([sec('a', 0, 8)]);
    showTimeline.launchPhrase('a', { delay: 0 });
    playFor(0.5);
    showTimeline.activateDoc('show');
    expect(vjLive()).toBe(true);
  });

  it('■ on the bar sends one stop', () => {
    timeline([sec('a', 0, 8)]);
    showTimeline.launchPhrase('a', { delay: 0 });
    playFor(0.5);
    showTimeline.pause();
    showTimeline.stopPhrases();
    expect(events.filter((e) => e.type === 'stop')).toHaveLength(1);
    expect(vjLive()).toBe(true);
  });
});

describe('forgetting phrases', () => {
  it('Clear forgets the phrase playing and the launch waiting', () => {
    timeline([sec('a', 0, 8), sec('b', 8, 16)]);
    showTimeline.launchPhrase('a', { delay: 0 }); playFor(0.5);
    showTimeline.launchPhrase('b', { delay: 2 });
    showTimeline.clear();
    expect(showTimeline.phraseState()).toMatchObject({ activeId: null, pending: null });
    expect(get(showPhraseStatus)).toEqual({ activeId: null, pending: null });
  });

  it('an outside clock taking the playhead calls a waiting launch off', () => {
    timeline([sec('a', 0, 8), sec('b', 8, 16)]);
    showTimeline.play(); playFor(1);
    showTimeline.launchPhrase('b', { delay: 1 });
    for (let i = 0; i < 60; i++) { showTimeline.chase(2 + i * 0.05, true); frame(); }
    expect(get(showPhraseStatus).pending).toBe(null);
    expect(events.map((e) => e.type)).toContain('cancel');
    expect(cuts.at(-1)).toBe(null);
    showTimeline.releaseChase();
  });

  it('a seek calls a waiting launch off', () => {
    timeline([sec('a', 0, 8), sec('b', 8, 16)]);
    showTimeline.play(); playFor(1);
    showTimeline.launchPhrase('b', { delay: 1 });
    showTimeline.seek(3);
    playFor(2);
    expect(events.map((e) => e.type)).toEqual(['pending', 'cancel']);
    expect(get(showTimeline).currentTime).toBeGreaterThan(4);
  });
});

describe('pads from the Show tab', () => {
  it('launch the Timeline phrase and open the Timeline', () => {
    timeline([sec('a', 0, 8)], 'show');
    expect(padLaunch('a')).toBe(true);
    expect(get(showTimeline).doc).toBe('timeline');
  });
});
