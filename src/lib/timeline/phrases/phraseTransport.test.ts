/**
 * A/V phrases on the Timeline's own transport (the store with a fake frame
 * clock): a launch lands on its bar, also while the playing phrase loops a
 * section shorter than the wait; the phrase loops / holds / plays on per its
 * end action; a launch from stopped starts on the bar; the pieces crossfade
 * from where the old phrase would have been; stop on the bar; calling a
 * launch off; and nothing of it is saved.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import type { Layer, ShowClipMedia } from '../../types';
import {
  currentShowTrackFrame,
  setShowAudioClockReader,
  setShowCompositionLoader,
  setShowPhraseEffects,
  setShowTrackFrameSink,
  showPhraseStatus,
  showSectionStatus,
  showTimeline,
  type ShowPhraseEvent,
} from '../../stores/showTimeline';
import { rowTrackId } from '../../show/tracks/showStageRows';
import type { TimelineSection } from '../sections/sectionModel';
import { HOLD_EPSILON } from '../sections/sectionPlayer';
import { phraseByNumber, phraseEndAction, phraseGridBeats, phraseNumber, phraseSections, withPhraseEnd } from './phraseModel';
import { PHRASE_XFADE_SECONDS } from './phraseModel';

let frames: Array<(now: number) => void> = [];
let frameMs = 0;
let timers: Array<{ fn: () => void; at: number }> = [];

function frame(ms = 50) {
  frameMs += ms;
  const pending = frames;
  frames = [];
  for (const cb of pending) cb(frameMs);
  // Timers due by now run after the frame (the stopped-launch timer).
  const due = timers.filter((t) => t.at <= frameMs);
  timers = timers.filter((t) => t.at > frameMs);
  for (const t of due) t.fn();
}
function playFor(seconds: number, ms = 50) {
  for (let i = 0; i < Math.round((seconds * 1000) / ms); i++) frame(ms);
}

const layer = (id: string): Layer => ({ id, name: id, type: 'media', visible: true, opacity: 1, blendMode: 'normal', source: null } as unknown as Layer);
const shader = (name: string): ShowClipMedia => ({ kind: 'shader', name, src: `ISF/${name}.fs`, shaderCode: `void main(){} // ${name}`, shaderValues: {} });
const sec = (id: string, start: number, end: number, extra: Partial<TimelineSection> = {}): TimelineSection =>
  ({ id, name: id.toUpperCase(), color: '#5b8def', start, end, action: 'through', phrase: { end: 'section' }, ...extra });

function timeline(sections: TimelineSection[], length = 32) {
  showTimeline.hydrate({
    version: 8,
    activeDoc: 'timeline',
    audioTracks: [],
    presetClips: [],
    timeline: {
      version: 8,
      audioTracks: [],
      presetClips: [],
      sections,
      tempo: { offset: 0, segments: [{ bar: 1, bpm: 120, beatsPerBar: 4, beatUnit: 4 }], source: 'manual' },
    },
  });
  showTimeline.syncStageRows([layer('A'), layer('B')], []);
  // Something to play over the whole length.
  showTimeline.addLayerClip(rowTrackId('B'), shader('Base'), 0, { duration: length });
}

let events: ShowPhraseEvent[] = [];

beforeEach(() => {
  showTimeline._resetForTest();
  setShowCompositionLoader(() => {});
  frames = [];
  timers = [];
  frameMs = 1000;
  vi.stubGlobal('requestAnimationFrame', (cb: (now: number) => void) => { frames.push(cb); return frames.length; });
  vi.stubGlobal('cancelAnimationFrame', () => { frames = []; });
  setShowAudioClockReader(null);
  showTimeline._setSectionClock(() => frameMs / 1000);
  showTimeline._setPhraseClock(() => frameMs, (fn, ms) => { const t = { fn, at: frameMs + ms }; timers.push(t); return t; }, (h) => { timers = timers.filter((t) => t !== h); });
  events = [];
  setShowPhraseEffects((e) => events.push(e));
  setShowTrackFrameSink(() => {});
});
afterEach(() => {
  setShowTrackFrameSink(null);
  setShowPhraseEffects(null);
  setShowCompositionLoader(null);
  showTimeline._resetForTest();
  vi.unstubAllGlobals();
});

const now = () => get(showTimeline).currentTime;

describe('the phrase model', () => {
  it('pads are the published sections in time order; the end action the phrase plays with', () => {
    const list = [sec('a', 0, 8), { ...sec('x', 8, 12), phrase: undefined }, sec('b', 12, 16, { phrase: { end: 'loop' } }), sec('c', 16, 20, { action: 'hold', phrase: { end: 'section' } })];
    expect(phraseSections(list).map((s) => s.id)).toEqual(['a', 'b', 'c']);
    expect(phraseNumber(list, 'b')).toBe(2);
    expect(phraseNumber(list, 'x')).toBe(0);
    expect(phraseByNumber(list, 3)?.id).toBe('c');
    expect(phraseEndAction(list[2])).toBe('vamp');
    expect(phraseEndAction(list[3])).toBe('hold');
    expect(withPhraseEnd(list, 'b')[2]).toMatchObject({ action: 'vamp', exit: 'end' });
    expect(withPhraseEnd(list, 'a')).toBe(list);
    expect(phraseGridBeats('off')).toBe(4);
    expect(phraseGridBeats('1/4')).toBe(4);
    expect(phraseGridBeats('2bar')).toBe(8);
    expect(phraseGridBeats('4bar')).toBe(16);
  });
});

describe('launch quantise and hand-over', () => {
  it('a launch while playing lands on its bar, at the new section start plus the overshoot', () => {
    timeline([sec('a', 0, 8), sec('b', 8, 16)]);
    showTimeline.play();
    playFor(0.6);
    expect(showTimeline.launchPhrase('b', { delay: 1.4 })).toBe(true);
    expect(get(showPhraseStatus).pending?.id).toBe('b');
    playFor(1.3);
    // Still the old place, one frame before the bar.
    expect(now()).toBeLessThan(2);
    expect(showTimeline.phraseState().activeId).toBeNull();
    playFor(0.1);
    expect(showTimeline.phraseState().activeId).toBe('b');
    expect(now()).toBeGreaterThanOrEqual(8);
    expect(now()).toBeLessThan(8 + 0.05 + 1e-6);
    expect(get(showPhraseStatus).pending).toBeNull();
    expect(events.map((e) => e.type)).toEqual(['pending', 'land']);
    const land = events[1] as Extract<ShowPhraseEvent, { type: 'land' }>;
    expect(land.time).toBeCloseTo(now(), 6);
  });

  it('a phrase looping a section shorter than the wait still hands over on the bar', () => {
    timeline([sec('a', 0, 2, { phrase: { end: 'loop' } }), sec('b', 8, 16)]);
    showTimeline.launchPhrase('a', { delay: 0 });
    playFor(1);
    expect(showTimeline.phraseState().activeId).toBe('a');
    showTimeline.launchPhrase('b', { delay: 3 });
    playFor(2.5);
    // Looped back into A (show time 1.5 again), not handed over yet.
    expect(now()).toBeLessThan(2);
    expect(showTimeline.phraseState().activeId).toBe('a');
    playFor(0.55);
    expect(showTimeline.phraseState().activeId).toBe('b');
    expect(now()).toBeGreaterThanOrEqual(8);
    expect(now()).toBeLessThan(8.1);
  });

  it('pressing another pad before the bar replaces the waiting launch; the same pad calls it off', () => {
    timeline([sec('a', 0, 8), sec('b', 8, 16), sec('c', 16, 24)]);
    showTimeline.play();
    showTimeline.launchPhrase('b', { delay: 1 });
    showTimeline.launchPhrase('c', { delay: 1 });
    playFor(1.05);
    expect(showTimeline.phraseState().activeId).toBe('c');
    showTimeline.launchPhrase('a', { delay: 1 });
    expect(showTimeline.cancelPhraseLaunch()).toBe(true);
    playFor(1.5);
    expect(showTimeline.phraseState().activeId).toBe('c');
    expect(now()).toBeGreaterThan(17);
  });

  it('a launch from stopped starts the transport on the bar', () => {
    timeline([sec('a', 0, 8), sec('b', 8, 16)]);
    showTimeline.seek(3);
    showTimeline.launchPhrase('b', { delay: 0.5 });
    expect(get(showTimeline).isPlaying).toBe(false);
    frame(250);
    expect(get(showTimeline).isPlaying).toBe(false);
    frame(260); // the timer runs 10 ms past its bar
    expect(get(showTimeline).isPlaying).toBe(true);
    expect(now()).toBeCloseTo(8.01, 6);
    expect(showTimeline.phraseState().activeId).toBe('b');
  });

  it('launching opens the Timeline when the Show is active', () => {
    timeline([sec('a', 0, 8)]);
    showTimeline.activateDoc('show', { quiet: true });
    expect(showTimeline.launchPhrase('a', { delay: 0 })).toBe(true);
    expect(get(showTimeline).doc).toBe('timeline');
    expect(get(showTimeline).isPlaying).toBe(true);
  });

  it('an outside clock owns the playhead: no phrases', () => {
    timeline([sec('a', 0, 8)]);
    showTimeline.chase(1, true);
    expect(showTimeline.launchPhrase('a', { delay: 0 })).toBe(false);
    showTimeline.releaseChase();
  });
});

describe('the end of a phrase', () => {
  it('as the section (Hold for GO): holds on its end until another phrase', () => {
    timeline([sec('a', 0, 4, { action: 'hold' }), sec('b', 8, 16)]);
    showTimeline.launchPhrase('a', { delay: 0 });
    playFor(5);
    expect(now()).toBeCloseTo(4 - HOLD_EPSILON, 6);
    expect(get(showSectionStatus).holdId).toBe('a');
    // Another phrase leaves the hold on its bar (the wait counts wall time).
    showTimeline.launchPhrase('b', { delay: 0.5 });
    playFor(0.55);
    expect(showTimeline.phraseState().activeId).toBe('b');
    expect(get(showSectionStatus).holdId).toBeNull();
    expect(now()).toBeGreaterThan(8);
    playFor(0.5);
    expect(now()).toBeGreaterThan(8.5);
  });

  it('loops: the section plays again from its start', () => {
    timeline([sec('a', 0, 4, { phrase: { end: 'loop' } }), sec('b', 4, 12)]);
    showTimeline.launchPhrase('a', { delay: 0 });
    playFor(5);
    expect(now()).toBeGreaterThan(0.9);
    expect(now()).toBeLessThan(1.1);
    expect(showTimeline.phraseState().activeId).toBe('a');
  });

  it('plays on: into the next section, and the next published one becomes the playing phrase', () => {
    timeline([sec('a', 0, 4, { phrase: { end: 'through' }, action: 'hold' }), sec('b', 4, 12)]);
    showTimeline.launchPhrase('a', { delay: 0 });
    playFor(5);
    expect(now()).toBeGreaterThan(4.9);
    expect(showTimeline.phraseState().activeId).toBe('b');
  });

  it('Stop on the bar pauses the Timeline there and forgets the phrase', () => {
    timeline([sec('a', 0, 8)]);
    showTimeline.launchPhrase('a', { delay: 0 });
    playFor(1);
    const at = now() + 1;
    showTimeline.stopPhrases({ delay: 1 });
    playFor(0.9);
    expect(get(showTimeline).isPlaying).toBe(true);
    playFor(0.2);
    expect(get(showTimeline).isPlaying).toBe(false);
    expect(now()).toBeCloseTo(at, 6);
    expect(showTimeline.phraseState().activeId).toBeNull();
    expect(events.at(-1)?.type).toBe('stop');
  });
});

describe('the visual hand-over', () => {
  it('the old phrase fades out under the new one for a moment, from where it would have been', () => {
    timeline([sec('a', 0, 8), sec('b', 8, 16)]);
    showTimeline.addLayerClip(rowTrackId('A'), shader('Red'), 0, { duration: 8 });
    showTimeline.addLayerClip(rowTrackId('A'), shader('Blue'), 8, { duration: 8 });
    const [red, blue] = get(showTimeline).layerTracks.find((t) => t.layerId === 'A')!.clips;
    showTimeline.play();
    playFor(1);
    showTimeline.launchPhrase('b', { delay: 1 });
    playFor(1.05);
    let row = currentShowTrackFrame()!.tracks.find((t) => t.layerId === 'A')!;
    expect(row.clip?.clipId).toBe(blue.id);
    expect(row.xfade?.clip.clipId).toBe(red.id);
    expect(row.xfade!.opacity).toBeGreaterThan(0.5);
    expect(row.opacity).toBeLessThan(0.5);
    // The old block is where it would have been (about 2 s in), not at 0.
    expect(row.xfade!.clip.localTime).toBeGreaterThan(1.9);
    playFor(PHRASE_XFADE_SECONDS);
    row = currentShowTrackFrame()!.tracks.find((t) => t.layerId === 'A')!;
    expect(row.xfade ?? null).toBeNull();
    expect(row.opacity).toBe(1);
    expect(showTimeline.phraseState().crossfading).toBe(false);
  });

  it('a block on both sides of the bar (the same one) does not fade', () => {
    timeline([sec('a', 0, 8), sec('b', 8, 16)]);
    showTimeline.play();
    showTimeline.launchPhrase('b', { delay: 1 });
    playFor(1.05);
    const row = currentShowTrackFrame()!.tracks.find((t) => t.layerId === 'B')!;
    expect(row.xfade ?? null).toBeNull();
    expect(row.opacity).toBe(1);
  });
});

describe('saving', () => {
  it('a published section saves its phrase and Live scene; the session state never travels', () => {
    timeline([sec('a', 0, 8, { phrase: { end: 'loop' }, liveScene: { scene: 2, name: 'Drop' } })]);
    showTimeline.launchPhrase('a', { delay: 0 });
    playFor(0.2);
    const saved = JSON.parse(JSON.stringify(showTimeline.serialize()));
    showTimeline._resetForTest();
    showTimeline.hydrate(saved);
    const s = get(showTimeline);
    expect(s.sections[0]).toMatchObject({ phrase: { end: 'loop' }, liveScene: { scene: 2, name: 'Drop' } });
    expect(showTimeline.phraseState().activeId).toBeNull();
    expect(JSON.stringify(saved)).not.toContain('activeId');
  });
});
