/**
 * Section state that must end with its owner: a Live section deleted or
 * replaced while live gives its pieces back, the free-running offsets of
 * one run do not carry into the next, a paused hold does not run its blocks
 * on, and an outside clock taking the playhead ends what the sections did.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import type { Layer } from '../../types';
import {
  setShowAudioClockReader,
  setShowCompositionLoader,
  setShowSectionEffects,
  setShowTrackFrameSink,
  showFreeRunOffset,
  showSectionStatus,
  showTimeline,
} from '../../stores/showTimeline';
import type { TimelineSection } from './sectionModel';
import { handleSectionEvent } from './sectionRuntime';
import { liveTakeover } from '../../show/takeover/liveTakeover';

let frames: Array<(now: number) => void> = [];
let frameMs = 0;
let clock = 0;
function frame(ms = 50) {
  frameMs += ms;
  clock += ms / 1000;
  const pending = frames;
  frames = [];
  for (const cb of pending) cb(frameMs);
}
function playFor(seconds: number, ms = 50) {
  for (let i = 0; i < Math.round((seconds * 1000) / ms); i++) frame(ms);
}
const layer = (id: string): Layer => ({ id, name: id, type: 'media', visible: true, opacity: 1, blendMode: 'normal', source: null } as unknown as Layer);
const sec = (id: string, start: number, end: number, extra: Partial<TimelineSection> = {}): TimelineSection =>
  ({ id, name: id, color: '#5b8def', start, end, action: 'through', ...extra });

function timeline(sections: TimelineSection[], length = 24, loop = false) {
  showTimeline.hydrate({
    version: 8,
    activeDoc: 'timeline',
    audioTracks: [],
    presetClips: [],
    timeline: {
      version: 8,
      loop,
      audioTracks: [{ id: 'song', name: 'Song', url: 'blob:song', startTime: 0, duration: length, offset: 0, sourceDuration: length, volume: 1, muted: false, lane: 0, peaks: [1] }],
      presetClips: [],
      sections,
      tempo: { offset: 0, segments: [{ bar: 1, bpm: 120, beatsPerBar: 4, beatUnit: 4 }], source: 'manual' },
    },
  } as never);
  showTimeline.syncStageRows([layer('A'), layer('B')], []);
}

beforeEach(() => {
  showTimeline._resetForTest();
  setShowCompositionLoader(() => {});
  frames = [];
  frameMs = 1000;
  clock = 100;
  vi.stubGlobal('requestAnimationFrame', (cb: (now: number) => void) => { frames.push(cb); return frames.length; });
  vi.stubGlobal('cancelAnimationFrame', () => { frames = []; });
  setShowAudioClockReader(null);
  showTimeline._setSectionClock(() => clock);
  setShowTrackFrameSink(() => {});
  liveTakeover.reset();
  liveTakeover.configure({ show: () => ({ showTime: 0, playing: false, tempo: null, markers: [] }), pauseShow: () => {}, playShow: () => {}, now: () => clock * 1000 });
  setShowSectionEffects(handleSectionEvent);
});
afterEach(() => {
  setShowSectionEffects(null);
  setShowTrackFrameSink(null);
  setShowCompositionLoader(null);
  showTimeline._resetForTest();
  liveTakeover.reset();
  vi.unstubAllGlobals();
});

const liveA = (id = 'live', start = 0, end = 4) => sec(id, start, end, { action: 'live', livePieces: ['A'] });
const released = () => { liveTakeover.tick(); return !liveTakeover.isTakenOver('A'); };

describe('a Live section that goes away while live', () => {
  it('replaced by setSections (locator sync, an edit): its pieces come back', () => {
    timeline([liveA(), sec('b', 4, 8)]);
    showTimeline.seek(0); showTimeline.play(); playFor(1);
    expect(liveTakeover.isTakenOver('A')).toBe(true);
    showTimeline.setSections([sec('b', 4, 8)], { quiet: true });
    playFor(1);
    expect(showTimeline.sectionState().live).toBe(null);
    showTimeline.stop();
    expect(released()).toBe(true);
  });

  it('taken away by undo: its pieces come back', () => {
    timeline([sec('b', 4, 8)]);
    const before = showTimeline.exportArrangement();
    showTimeline.setSections([liveA(), sec('b', 4, 8)], { quiet: true });
    showTimeline.seek(0); showTimeline.play(); playFor(1);
    showTimeline.restoreArrangement(before);
    playFor(1);
    showTimeline.stop();
    expect(released()).toBe(true);
  });

  it('Stop straight after it was deleted still gives the pieces back', () => {
    timeline([liveA(), sec('b', 4, 8)]);
    showTimeline.seek(0); showTimeline.play(); playFor(1);
    showTimeline.setSections([sec('b', 4, 8)], { quiet: true });
    showTimeline.stop();
    expect(released()).toBe(true);
  });
});

describe('a Live section and the takeover', () => {
  it('leaves a piece the VJ took over by hand alone', () => {
    timeline([sec('a', 0, 2), liveA('live', 2, 6), sec('b', 6, 8)]);
    const own = { kind: 'vjRow', deck: 'A', row: 1 } as const;
    liveTakeover.engage('A', own);
    showTimeline.seek(0); showTimeline.play(); playFor(3);
    expect(liveTakeover.state.surfaces.A?.source).toEqual(own);
    playFor(4); showTimeline.go(); playFor(3);
    expect(liveTakeover.isTakenOver('A')).toBe(true);
  });

  it("does not pause the Timeline when the takeover's underneath is 'pause'", () => {
    timeline([sec('a', 0, 2), liveA('live', 2, 6), sec('b', 6, 8)]);
    liveTakeover.configure({
      show: () => { const s = get(showTimeline); return { showTime: s.currentTime, playing: s.isPlaying, tempo: s.tempo, markers: [] }; },
      pauseShow: () => showTimeline.pause(),
      playShow: () => showTimeline.play(),
    });
    liveTakeover.setUnderneath('pause');
    showTimeline.seek(0); showTimeline.play(); playFor(3);
    expect(liveTakeover.isTakenOver('A')).toBe(true);
    expect(get(showTimeline).isPlaying).toBe(true);
    expect(get(showTimeline).currentTime).toBeGreaterThan(2.5);
  });

  it('two Live sections back to back keep the piece taken over', () => {
    timeline([liveA('l1', 0, 2), liveA('l2', 2, 6), sec('b', 6, 8)]);
    showTimeline.seek(0); showTimeline.play(); playFor(1);
    showTimeline.go(); playFor(2);
    expect(showTimeline.sectionState().live).toBe('l2');
    expect(liveTakeover.state.surfaces.A?.phase === 'in' || liveTakeover.state.surfaces.A?.phase === 'live').toBe(true);
  });

  it('an outside clock taking the playhead gives the pieces back', () => {
    timeline([liveA(), sec('b', 4, 8)]);
    showTimeline.seek(0); showTimeline.play(); playFor(1);
    for (let i = 0; i < 40; i++) showTimeline.chase(6 + i * 0.05, true);
    expect(showTimeline.sectionState().live).toBe(null);
    expect(released()).toBe(true);
    showTimeline.releaseChase();
  });
});

describe('free-running offsets end with the run', () => {
  it('playing to the end and again starts clean', () => {
    timeline([sec('v', 4, 8, { action: 'vamp', exit: 'end' }), sec('b', 8, 12)], 12);
    showTimeline.seek(0); showTimeline.play(); playFor(13);
    expect(showFreeRunOffset(0, 12)).toBeGreaterThan(0);
    showTimeline.go(); playFor(9);
    expect(get(showTimeline).isPlaying).toBe(false);
    showTimeline.play(); playFor(0.5);
    expect(showFreeRunOffset(0, 12)).toBe(0);
  });

  it('a looping Timeline starts each pass clean', () => {
    timeline([sec('v', 4, 8, { action: 'vamp', exit: 'end' }), sec('b', 8, 12)], 12, true);
    showTimeline.seek(0); showTimeline.play(); playFor(9); showTimeline.go(); playFor(8);
    expect(get(showTimeline).currentTime).toBeLessThan(4);
    expect(showFreeRunOffset(0, 12)).toBe(0);
    expect(showTimeline.sectionState().passes).toEqual({});
  });

  it('a hold paused for a minute does not run its blocks a minute ahead', () => {
    timeline([sec('h', 0, 4, { action: 'hold' }), sec('b', 4, 8)], 8);
    showTimeline.seek(0); showTimeline.play(); playFor(5);
    expect(get(showSectionStatus).holdId).toBe('h');
    const held = showFreeRunOffset(0, 8);
    showTimeline.pause();
    clock += 60;
    showTimeline.play();
    expect(showFreeRunOffset(0, 8)).toBeLessThan(held + 0.2);
    showTimeline.go();
    expect(showFreeRunOffset(0, 8)).toBeLessThan(held + 0.2);
  });
});
