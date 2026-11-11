/**
 * Sections on the playing Timeline (the store's transport with a fake frame
 * clock): a hold stops the playhead and the song until GO, a vamp loops the
 * section (and its audio: a hard seek), a jump goes after N passes, blocks
 * run on through a hold and a loop unless marked to stop, show:go reaches the
 * sections, an export plays straight through and is the same whatever was
 * done live, and sections save, reopen and undo with the Timeline.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import type { Layer, ShowClipMedia, ShowLayerClip } from '../../types';
import {
  currentShowTrackFrame,
  onShowFrame,
  setShowAudioClockReader,
  setShowCompositionLoader,
  setShowTrackFrameSink,
  showSectionStatus,
  showTimeline,
  type ShowFrameTick,
} from '../../stores/showTimeline';
import type { ShowTrackFrame } from '../../show/tracks/showTrackEval';
import { rowTrackId } from '../../show/tracks/showStageRows';
import { setVisualAudioManualTime } from '../../audio/visualAudio';
import type { TimelineSection } from './sectionModel';
import { HOLD_EPSILON } from './sectionPlayer';
import { handleSectionEvent, timelineTakesGo } from './sectionRuntime';
import { setShowSectionEffects } from '../../stores/showTimeline';
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
const shader: ShowClipMedia = { kind: 'shader', name: 'Glow', src: 'ISF/Glow.fs', shaderCode: 'void main(){}', shaderValues: {} };
const sec = (id: string, start: number, end: number, extra: Partial<TimelineSection> = {}): TimelineSection =>
  ({ id, name: id, color: '#5b8def', start, end, action: 'through', ...extra });

function timeline(sections: TimelineSection[], opts: { audio?: boolean; length?: number } = {}) {
  const length = opts.length ?? 24;
  showTimeline.hydrate({
    version: 8,
    activeDoc: 'timeline',
    audioTracks: [],
    presetClips: [],
    timeline: {
      version: 8,
      audioTracks: opts.audio === false ? [] : [{ id: 'song', name: 'Song', url: 'blob:song', startTime: 0, duration: length, offset: 0, sourceDuration: length, volume: 1, muted: false, lane: 0, peaks: [1] }],
      presetClips: [],
      sections,
      tempo: { offset: 0, segments: [{ bar: 1, bpm: 120, beatsPerBar: 4, beatUnit: 4 }], source: 'manual' },
    },
  });
  showTimeline.syncStageRows([layer('A'), layer('B')], []);
}

let ticks: ShowFrameTick[] = [];
let lastFrame: ShowTrackFrame | null = null;
let offTick: (() => void) | null = null;

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
  ticks = [];
  offTick = onShowFrame((t) => ticks.push(t));
  setShowTrackFrameSink((f) => { lastFrame = f; });
});
afterEach(() => {
  offTick?.();
  setShowTrackFrameSink(null);
  setShowCompositionLoader(null);
  setVisualAudioManualTime(null);
  showTimeline._resetForTest();
  vi.unstubAllGlobals();
});

const clipState = (layerId: string) => currentShowTrackFrame()?.tracks.find((t) => t.layerId === layerId)?.clip ?? null;

describe('hold', () => {
  it('stops the playhead (and the song) on the section end until GO; the transport stays running', () => {
    timeline([sec('a', 0, 4, { action: 'hold' }), sec('b', 4, 12)]);
    showTimeline.seek(3);
    showTimeline.play();
    playFor(3);
    let s = get(showTimeline);
    expect(s.isPlaying).toBe(true);
    expect(s.currentTime).toBeCloseTo(4 - HOLD_EPSILON, 6);
    expect(get(showSectionStatus).holdId).toBe('a');
    // The song (and Live clips, sound rows) see a stopped transport.
    expect(ticks[ticks.length - 1].playing).toBe(false);
    expect(showTimeline.go().kind).toBe('resume');
    playFor(1);
    s = get(showTimeline);
    expect(s.currentTime).toBeGreaterThan(4.8);
    expect(ticks[ticks.length - 1].playing).toBe(true);
    expect(get(showSectionStatus).holdId).toBeNull();
  });

  it('blocks keep running through a hold; one marked to stop is paused', () => {
    timeline([sec('a', 0, 4, { action: 'hold' }), sec('b', 4, 12)]);
    showTimeline.addLayerClip(rowTrackId('A'), shader, 0, { duration: 10 });
    showTimeline.addLayerClip(rowTrackId('B'), shader, 0, { duration: 10 });
    const stopId = get(showTimeline).layerTracks.find((t) => t.layerId === 'B')!.clips[0].id;
    showTimeline.updateLayerClip(stopId, { holdStops: true } as Partial<ShowLayerClip>);
    showTimeline.seek(3.5);
    showTimeline.play();
    playFor(2.5); // holds at 4 after 0.5 s, then 2 s held
    // Re-evaluate at the held playhead.
    expect(clipState('A')!.paused).toBe(false);
    expect(clipState('A')!.mediaTime).toBeCloseTo(4 + 1.95, 1);
    expect(clipState('B')!.paused).toBe(true);
    expect(clipState('B')!.mediaTime).toBeCloseTo(4, 2);
    showTimeline.go();
    playFor(1);
    // A carries on from where it ran to; B from where it stopped.
    expect(clipState('A')!.mediaTime - get(showTimeline).currentTime).toBeCloseTo(1.95, 1);
    expect(clipState('B')!.mediaTime).toBeCloseTo(get(showTimeline).currentTime, 6);
  });
});

describe('vamp and jump', () => {
  it('a vamp loops its own bars until GO; the loop is a hard seek for the song; GO leaves at the end of the pass', () => {
    timeline([sec('intro', 0, 4), sec('loop', 4, 8, { action: 'vamp' }), sec('out', 8, 16)]);
    showTimeline.seek(3);
    showTimeline.play();
    const seekBefore = showTimeline.seekGeneration();
    playFor(10); // 1 s to the loop + two passes + 1 s
    const t = get(showTimeline).currentTime;
    expect(t).toBeGreaterThanOrEqual(4);
    expect(t).toBeLessThan(8);
    expect(showTimeline.seekGeneration() - seekBefore).toBeGreaterThanOrEqual(2);
    showTimeline.go();
    expect(get(showSectionStatus).vampExitId).toBe('loop');
    playFor(4.2);
    expect(get(showTimeline).currentTime).toBeGreaterThan(8);
  });

  it('a block spanning the vamp runs on through each pass instead of jumping back', () => {
    timeline([sec('loop', 0, 4, { action: 'vamp' })], { length: 20 });
    showTimeline.addLayerClip(rowTrackId('A'), shader, 0, { duration: 16 });
    showTimeline.seek(0);
    showTimeline.play();
    playFor(6);
    const t = get(showTimeline).currentTime;
    expect(t).toBeLessThan(4);
    // One pass behind it: the block ran on by the loop's length.
    expect(clipState('A')!.mediaTime - t).toBeCloseTo(4, 6);
  });

  it('jump after 2 passes', () => {
    timeline([sec('a', 0, 4, { action: 'jump', jumpTo: 'c', passes: 2 }), sec('b', 4, 8), sec('c', 8, 16)]);
    showTimeline.seek(0);
    showTimeline.play();
    playFor(9);
    // The first frame anchors the clock: 8.95 s played = a twice (8 s), then 0.95 s into c.
    expect(get(showTimeline).currentTime).toBeCloseTo(8.95, 6);
  });
});

describe('GO, Live and export', () => {
  it('show:go reaches the sections only on a Timeline that has them', () => {
    timeline([]);
    expect(timelineTakesGo()).toBe(false);
    showTimeline.setSections([sec('a', 0, 4, { action: 'hold' })], { quiet: true });
    expect(timelineTakesGo()).toBe(true);
    showTimeline.openDoc('show');
    expect(timelineTakesGo()).toBe(false);
  });

  it('a Live section hands its pieces to the VJ decks, and GO takes them back', () => {
    timeline([sec('live', 0, 4, { action: 'live', livePieces: ['A'], liveSource: { kind: 'vjMix' } }), sec('b', 4, 8)]);
    setShowSectionEffects(handleSectionEvent);
    liveTakeover.reset();
    showTimeline.seek(0);
    showTimeline.play();
    playFor(1);
    expect(liveTakeover.isTakenOver('A')).toBe(true);
    expect(liveTakeover.isTakenOver('B')).toBe(false);
    playFor(4);
    expect(get(showSectionStatus).holdId).toBe('live');
    showTimeline.go();
    const st = liveTakeover.state.surfaces.A;
    expect(st?.phase === 'pendingRelease' || st?.phase === 'releasing' || !st).toBe(true);
    liveTakeover.reset();
  });

  it('an export plays straight through: the same frames whatever was held or looped live', () => {
    const sections = [sec('a', 0, 4, { action: 'hold' }), sec('loop', 4, 8, { action: 'vamp' }), sec('c', 8, 12)];
    timeline(sections);
    showTimeline.addLayerClip(rowTrackId('A'), shader, 0, { duration: 12 });
    const render = () => {
      setVisualAudioManualTime(0);
      const out: Array<[number, number]> = [];
      for (let f = 0; f <= 11 * 10; f++) {
        const t = f / 10;
        setVisualAudioManualTime(t);
        showTimeline.seek(t);
        out.push([get(showTimeline).currentTime, clipState('A')!.mediaTime]);
      }
      setVisualAudioManualTime(null);
      return out;
    };
    const fresh = render();
    expect(fresh.every(([t, m], i) => Math.abs(t - i / 10) < 1e-9 && Math.abs(m - i / 10) < 1e-6)).toBe(true);
    // Live: hold, GO, loop twice.
    showTimeline.seek(3);
    showTimeline.play();
    playFor(2);
    showTimeline.go();
    playFor(9);
    showTimeline.pause();
    expect(render()).toEqual(fresh);
  });

  it('sections save and reopen with the Timeline (version 8), and come back with an undo arrangement', () => {
    timeline([sec('a', 0, 4, { action: 'vamp', exit: 'bar' }), sec('b', 4, 8, { action: 'live', livePieces: 'all', liveSource: { kind: 'vjRow', deck: 'B', row: 2 } })]);
    const saved = showTimeline.serialize();
    expect(saved.version).toBe(9);
    expect(saved.timeline?.sections?.map((s) => s.id)).toEqual(['a', 'b']);
    const before = showTimeline.exportArrangement();
    showTimeline.replaceTimelineParts({ sections: [], lookClips: [{ id: 'l', lookId: 'neon-pulse', paletteId: 'neon', startTime: 0, duration: 4, scope: 'all', fadeIn: 0, fadeOut: 0 }] });
    expect(get(showTimeline).sections).toEqual([]);
    showTimeline.restoreArrangement(before);
    expect(get(showTimeline).sections.map((s) => s.id)).toEqual(['a', 'b']);
    expect(get(showTimeline).lookClips).toEqual([]);
    showTimeline.hydrate(saved);
    const s = get(showTimeline);
    expect(s.doc).toBe('timeline');
    expect(s.sections[1].liveSource).toEqual({ kind: 'vjRow', deck: 'B', row: 2 });
    expect(s.sections[0].exit).toBe('bar');
  });
});
