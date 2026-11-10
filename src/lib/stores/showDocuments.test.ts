/**
 * The Show and the Timeline are two documents in one engine: each keeps its
 * own content, song and tempo, only one plays, both save with the project,
 * old files split between them, undo covers both, a Timeline block's media
 * can be replaced from the library, and the Looks row reaches the frame.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import type { Layer, ShowClipMedia, ShowLayerClip } from '../types';
import {
  showTimeline,
  parkedShowDoc,
  setShowCompositionLoader,
  setShowTrackFrameSink,
  type ShowArrangement,
} from './showTimeline';
import { rowTrackId } from '../show/tracks/showStageRows';
import type { ShowTrackFrame } from '../show/tracks/showTrackEval';
import { toasts } from './errorToast';

function layer(id: string): Layer {
  return { id, name: id, type: 'media', visible: true, opacity: 1, blendMode: 'normal', source: null } as unknown as Layer;
}
const image = (name = 'a.png'): ShowClipMedia => ({ kind: 'image', name, src: `/media/${name}` });
const shader = (values: Record<string, number>): ShowClipMedia => ({
  kind: 'shader', name: 'Glow', src: 'ISF/Glow.fs', shaderCode: 'void main(){}',
  shaderInputs: [{ NAME: 'amount', TYPE: 'float', MIN: 0, MAX: 1, DEFAULT: 0.5 }], shaderValues: values,
});
const audio = (id: string) => ({ id, name: `${id}.wav`, url: `/media/${id}.wav`, startTime: 0, duration: 20, offset: 0, sourceDuration: 20, volume: 1, muted: false, lane: 0, peaks: [0.1, 0.2] });

function clip(id: string, startTime: number, duration: number, extra: Partial<ShowLayerClip> = {}): ShowLayerClip {
  return { id, startTime, duration, media: image(), inPoint: 0, endBehaviour: 'loop', fadeIn: 0, fadeOut: 0, ...extra };
}

beforeEach(() => {
  showTimeline._resetForTest();
  setShowCompositionLoader(() => {});
});
afterEach(() => {
  setShowTrackFrameSink(null);
  setShowCompositionLoader(null);
  showTimeline._resetForTest();
});

describe('two documents', () => {
  it('a new project starts on the Show; the Timeline is its own document', () => {
    expect(showTimeline.activeDoc()).toBe('show');
    showTimeline.addPresetClip('comp-a', 10);
    showTimeline.openDoc('timeline');
    const s = get(showTimeline);
    expect(s.doc).toBe('timeline');
    expect(s.isOpen).toBe(true);
    // The Timeline has no presets; the Show's wait parked.
    expect(s.presetClips).toEqual([]);
    expect(get(parkedShowDoc).presetClips.map((c) => c.compositionId)).toEqual(['comp-a']);
    showTimeline.syncStageRows([layer('A')], []);
    showTimeline.addLayerClip(rowTrackId('A'), image(), 0);
    showTimeline.setTempo({ offset: 0, segments: [{ bar: 1, bpm: 90, beatsPerBar: 4, beatUnit: 4 }], source: 'manual' });
    showTimeline.openDoc('show');
    // The Show has no rows, and keeps its own (no) tempo.
    expect(get(showTimeline).layerTracks).toEqual([]);
    expect(get(showTimeline).tempo).toBeNull();
    expect(get(showTimeline).presetClips).toHaveLength(1);
    expect(get(parkedShowDoc).tempo?.segments[0].bpm).toBe(90);
  });

  it('the pill toggles its own tab and switches between them', () => {
    showTimeline.toggleDoc('show');
    expect([get(showTimeline).isOpen, get(showTimeline).doc]).toEqual([true, 'show']);
    showTimeline.toggleDoc('timeline');
    expect([get(showTimeline).isOpen, get(showTimeline).doc]).toEqual([true, 'timeline']);
    showTimeline.toggleDoc('timeline');
    expect(get(showTimeline).isOpen).toBe(false);
  });

  it('only one plays: opening the other stops the playing one, says so, and keeps its playhead', () => {
    showTimeline.addPresetClip('comp-a', 30);
    showTimeline.seek(12);
    showTimeline.play();
    expect(get(showTimeline).isPlaying).toBe(true);
    showTimeline.openDoc('timeline');
    expect(get(showTimeline).isPlaying).toBe(false);
    expect(get(toasts).map((t) => t.message).join('\n')).toMatch(/Show stopped: only one plays at a time/);
    expect(get(parkedShowDoc).currentTime).toBeCloseTo(12, 1);
    // The Timeline is empty: its own play does nothing.
    showTimeline.play();
    expect(get(showTimeline).isPlaying).toBe(false);
    showTimeline.openDoc('show');
    expect(get(showTimeline).currentTime).toBeCloseTo(12, 1);
    expect(get(showTimeline).isPlaying).toBe(false);
  });

  it('the Show publishes no rows; the Timeline\'s blocks reach the frame', () => {
    let frame: ShowTrackFrame | null = null;
    setShowTrackFrameSink((f) => { frame = f; });
    showTimeline.openDoc('timeline');
    showTimeline.syncStageRows([layer('A')], []);
    showTimeline.addLayerClip(rowTrackId('A'), image(), 0, { duration: 4 });
    showTimeline.seek(1);
    expect(frame!.tracks.map((t) => t.layerId)).toEqual(['A']);
    showTimeline.openDoc('show');
    expect(frame).toBeNull();
    showTimeline.openDoc('timeline');
    expect(frame!.tracks.map((t) => t.layerId)).toEqual(['A']);
  });
});

describe('saving both documents', () => {
  it('saves the Show at the top and the Timeline under `timeline`, and opens both', () => {
    showTimeline.addPresetClip('comp-a', 10);
    showTimeline.openDoc('timeline');
    showTimeline.syncStageRows([layer('A')], []);
    showTimeline.addLayerClip(rowTrackId('A'), image(), 2, { duration: 3 });
    showTimeline.addLookClip('neon-pulse', 'ice', 1, { duration: 5 });
    const saved = JSON.parse(JSON.stringify(showTimeline.serialize()));
    expect(saved.version).toBe(7);
    expect(saved.activeDoc).toBe('timeline');
    expect(saved.presetClips).toHaveLength(1);
    expect(saved.layerTracks).toEqual([]);
    expect(saved.timeline.presetClips).toEqual([]);
    expect(saved.timeline.layerTracks.map((t: any) => t.id)).toEqual([rowTrackId('A')]);
    expect(saved.timeline.lookClips.map((c: any) => [c.lookId, c.paletteId, c.startTime, c.duration])).toEqual([['neon-pulse', 'ice', 1, 5]]);

    showTimeline._resetForTest();
    showTimeline.hydrate(saved);
    expect(showTimeline.activeDoc()).toBe('timeline');
    expect(get(showTimeline).lookClips).toHaveLength(1);
    expect(get(showTimeline).layerTracks.map((t) => t.id)).toEqual([rowTrackId('A')]);
    expect(get(parkedShowDoc).presetClips.map((c) => c.compositionId)).toEqual(['comp-a']);
    expect(get(showTimeline).duration).toBe(6);
  });

  it('splits an old file: presets to the Show, rows to the Timeline, the song to both', () => {
    const old = {
      version: 3, isOpen: false, loop: true, zoom: 20, snapEnabled: true,
      audioTracks: [audio('song')],
      presetClips: [{ id: 'p1', compositionId: 'comp-a', startTime: 0, duration: 20 }],
      layerTracks: [{ id: rowTrackId('A'), layerId: 'A', layerName: 'A', template: layer('A'), clips: [clip('c1', 0, 4)], lanes: [], gap: 'hide', muted: false, locked: false, collapsed: false }],
      tempo: { offset: 0, segments: [{ bar: 1, bpm: 120, beatsPerBar: 4, beatUnit: 4 }], source: 'manual' },
    };
    showTimeline.hydrate(old);
    const show = get(showTimeline);
    expect(show.doc).toBe('show');
    expect(show.presetClips).toHaveLength(1);
    expect(show.layerTracks).toEqual([]);
    expect(show.audioTracks.map((t) => t.name)).toEqual(['song.wav']);
    expect(show.tempo?.segments[0].bpm).toBe(120);
    const timeline = get(parkedShowDoc);
    expect(timeline.presetClips).toEqual([]);
    expect(timeline.layerTracks.map((t) => t.id)).toEqual([rowTrackId('A')]);
    expect(timeline.audioTracks.map((t) => t.name)).toEqual(['song.wav']);
    // Its own copy of the song: never the same audio element.
    expect(timeline.audioTracks[0].id).not.toBe(show.audioTracks[0].id);
    expect(timeline.tempo?.segments[0].bpm).toBe(120);
    expect(timeline.loop).toBe(true);
  });

  it('an old file with rows only opens on the Timeline; presets only, on the Show', () => {
    showTimeline.hydrate({
      version: 3, audioTracks: [], presetClips: [],
      layerTracks: [{ id: 'old-1', layerId: 'A', layerName: 'A', template: layer('A'), clips: [clip('c1', 0, 4)], lanes: [], gap: 'layer', muted: false, locked: false, collapsed: false }],
    });
    expect(showTimeline.activeDoc()).toBe('timeline');
    expect(get(showTimeline).layerTracks.map((t) => t.id)).toEqual(['old-1']);
    expect(showTimeline.anyContent()).toBe(true);
    showTimeline.hydrate({ version: 1, audioTracks: [], presetClips: [{ id: 'p1', compositionId: 'comp-a', startTime: 0, duration: 5 }] });
    expect(showTimeline.activeDoc()).toBe('show');
    expect(get(parkedShowDoc).layerTracks).toEqual([]);
  });
});

describe('undo covers both documents', () => {
  it('a step holds both; putting it back restores the parked one too, without switching tabs', () => {
    showTimeline.addPresetClip('comp-a', 10);
    showTimeline.openDoc('timeline');
    showTimeline.syncStageRows([layer('A')], []);
    const before = showTimeline.exportArrangement();
    expect(before.presetClips).toHaveLength(1);
    expect(before.timeline?.presetClips).toEqual([]);
    showTimeline.addLookClip('neon-pulse', 'neon', 0);
    showTimeline.openDoc('show');
    showTimeline.removePresetClip(get(showTimeline).presetClips[0].id);
    showTimeline.restoreArrangement(before as ShowArrangement);
    expect(showTimeline.activeDoc()).toBe('show');
    expect(get(showTimeline).presetClips).toHaveLength(1);
    expect(get(parkedShowDoc).lookClips).toEqual([]);
  });
});

describe('the Looks row in the store', () => {
  it('adds, moves, trims and removes look blocks; the frame carries them only inside their span', () => {
    let frame: ShowTrackFrame | null = null;
    setShowTrackFrameSink((f) => { frame = f; });
    showTimeline.openDoc('timeline');
    const id = showTimeline.addLookClip('neon-pulse', 'neon', 2, { duration: 4 })!;
    expect(get(showTimeline).selection).toEqual({ kind: 'lookClip', id });
    expect(get(showTimeline).duration).toBe(6);
    showTimeline.seek(3);
    expect(frame!.looks?.map((l) => [l.clipId, l.weight])).toEqual([[id, 1]]);
    showTimeline.seek(7);
    expect(frame).toBeNull();
    showTimeline.moveLookClip(id, 10);
    showTimeline.resizeLookClip(id, 'end', 12);
    expect(showTimeline.findLookClip(id)).toMatchObject({ startTime: 10, duration: 2 });
    showTimeline.updateLookClip(id, { scope: 'pieces', layerIds: ['A'], paletteId: 'fire' }, { discrete: true });
    expect(showTimeline.findLookClip(id)).toMatchObject({ scope: 'pieces', layerIds: ['A'], paletteId: 'fire' });
    showTimeline.removeLookClip(id);
    expect(get(showTimeline).lookClips).toEqual([]);
    expect(get(showTimeline).selection).toBeNull();
  });
});

describe('replacing a block\'s media', () => {
  it('keeps timing, fades, blend and opacity; the new media starts from its own start; undo puts it back', () => {
    showTimeline.openDoc('timeline');
    showTimeline.syncStageRows([layer('A')], []);
    const id = showTimeline.addLayerClip(rowTrackId('A'), { kind: 'video', name: 'one.mp4', src: '/one.mp4', sourceDuration: 60 }, 2, {
      duration: 6, fadeIn: 1, fadeOut: 2, blendMode: 'add', opacity: 0.5, inPoint: 7, endBehaviour: 'loop',
    })!;
    const before = showTimeline.exportArrangement();
    expect(showTimeline.replaceLayerClipMedia(id, shader({ amount: 0.5 }))).toBe(true);
    const after = showTimeline.findLayerClip(id)!.clip;
    expect(after.media.kind).toBe('shader');
    expect(after).toMatchObject({ startTime: 2, duration: 6, fadeIn: 1, fadeOut: 2, blendMode: 'add', opacity: 0.5, inPoint: 0 });
    showTimeline.restoreArrangement(before);
    expect(showTimeline.findLayerClip(id)!.clip.media.name).toBe('one.mp4');
    expect(showTimeline.findLayerClip(id)!.clip.inPoint).toBe(7);
  });
});
