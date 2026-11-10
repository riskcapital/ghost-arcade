import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import type { Layer, ShowClipMedia, ShowLayerClip, ShowLayerTrack } from '../../types';
import {
  clipFadeGain,
  clipMediaTime,
  clipRuns,
  evaluateShowTracks,
  findClipAt,
  showTrackFrameSignature,
  SHOW_CLIP_END_GUARD_SECONDS,
} from './showTrackEval';
import {
  duplicateClips,
  insertClip,
  moveClips,
  pasteClips,
  rippleDelete,
  shiftLaneKeys,
  splitClip,
  trimClip,
} from './showTrackEdit';
import { showTimeline, setShowCompositionLoader, setShowTrackFrameSink } from '../../stores/showTimeline';
import type { ShowTrackFrame } from './showTrackEval';

const video = (name = 'ramp.mp4', sourceDuration = 10): ShowClipMedia => ({
  kind: 'video',
  name,
  src: `ghost-asset://localhost/clips/${name}`,
  _assetRef: { kind: 'local-file', originalPath: `/clips/${name}`, name },
  sourceDuration,
});

function clip(id: string, startTime: number, duration: number, extra: Partial<ShowLayerClip> = {}): ShowLayerClip {
  return { id, startTime, duration, media: video(), inPoint: 0, endBehaviour: 'loop', fadeIn: 0, fadeOut: 0, ...extra };
}

function track(clips: ShowLayerClip[], extra: Partial<ShowLayerTrack> = {}): ShowLayerTrack {
  return { id: 't1', layerId: 'L1', layerName: 'Layer 1', template: null, clips, lanes: [], gap: 'layer', muted: false, locked: false, collapsed: false, ...extra };
}

let n = 0;
const ids = () => `new-${++n}`;

describe('finding the clip under the playhead', () => {
  const clips = [clip('a', 0, 5), clip('b', 5, 5), clip('c', 12, 3)];
  it('uses half-open intervals', () => {
    expect(findClipAt(clips, 0)?.id).toBe('a');
    expect(findClipAt(clips, 4.999)?.id).toBe('a');
    expect(findClipAt(clips, 5)?.id).toBe('b');
    expect(findClipAt(clips, 10)).toBeNull();
    expect(findClipAt(clips, 11.9)).toBeNull();
    expect(findClipAt(clips, 12)?.id).toBe('c');
    expect(findClipAt(clips, 15)).toBeNull();
    expect(findClipAt([], 1)).toBeNull();
  });
});

describe('media time and end behaviour', () => {
  it('maps show time to media time with in-point and speed', () => {
    const c = clip('a', 10, 4, { inPoint: 2, rate: 2 });
    expect(clipMediaTime(c, 10).time).toBeCloseTo(2, 9);
    expect(clipMediaTime(c, 11.5).time).toBeCloseTo(5, 9);
  });

  it('loops over [loopStart, end)', () => {
    const c = clip('a', 0, 30, { inPoint: 4, endBehaviour: 'loop' });
    expect(clipMediaTime(c, 5).time).toBeCloseTo(9, 9);
    // 6 s in: raw 10 = the end, wraps to 4.
    expect(clipMediaTime(c, 6).time).toBeCloseTo(4, 9);
    expect(clipMediaTime(c, 7.5).time).toBeCloseTo(5.5, 9);
    expect(clipMediaTime(c, 7.5).held).toBe(false);
  });

  it('holds one frame before the end for stop and hold', () => {
    for (const endBehaviour of ['stop', 'hold'] as const) {
      const c = clip('a', 0, 20, { endBehaviour });
      const at = clipMediaTime(c, 15);
      expect(at.held).toBe(true);
      expect(at.time).toBeCloseTo(10 - SHOW_CLIP_END_GUARD_SECONDS, 9);
      expect(clipMediaTime(c, 3)).toEqual({ time: 3, held: false });
    }
  });

  it('treats unknown-length media as never ending', () => {
    const c = clip('a', 0, 100, { media: { ...video(), sourceDuration: undefined }, endBehaviour: 'stop' });
    expect(clipMediaTime(c, 50)).toEqual({ time: 50, held: false });
  });
});

describe('fades', () => {
  it('ramps in and out linearly and multiplies', () => {
    const c = clip('a', 10, 10, { fadeIn: 2, fadeOut: 4 });
    expect(clipFadeGain(c, 10)).toBe(0);
    expect(clipFadeGain(c, 11)).toBeCloseTo(0.5, 9);
    expect(clipFadeGain(c, 14)).toBe(1);
    expect(clipFadeGain(c, 18)).toBeCloseTo(0.5, 9);
    expect(clipFadeGain(c, 20)).toBe(0);
  });

  it('scales overlapping fades down to fit the clip', () => {
    const c = clip('a', 0, 4, { fadeIn: 4, fadeOut: 4 });
    expect(clipFadeGain(c, 2)).toBeCloseTo(1, 9);
    expect(clipFadeGain(c, 1)).toBeCloseTo(0.5, 9);
  });
});

describe('splitting', () => {
  it('keeps media time continuous and the run id the same', () => {
    const whole = clip('a', 2, 6, { inPoint: 1 });
    const [left, right] = splitClip(whole, 5, 'b')!;
    expect(left).toMatchObject({ id: 'a', startTime: 2, duration: 3, inPoint: 1 });
    expect(right).toMatchObject({ id: 'b', startTime: 5, duration: 3, inPoint: 4 });
    for (const t of [5, 6.5, 7.9]) expect(clipMediaTime(right, t).time).toBeCloseTo(clipMediaTime(whole, t).time, 9);
    const runs = clipRuns([left, right]);
    expect(runs.get('a')).toBe('a');
    expect(runs.get('b')).toBe('a');
  });

  it('keeps a looping clip looping over the original range', () => {
    const whole = clip('a', 0, 30, { inPoint: 2, endBehaviour: 'loop' });
    const [left, right] = splitClip(whole, 13, 'b')!;
    expect(right.loopStart).toBe(2);
    for (const t of [13, 20, 29]) expect(clipMediaTime(right, t).time).toBeCloseTo(clipMediaTime(whole, t).time, 9);
    expect(clipRuns([left, right]).get('b')).toBe('a');
  });

  it('refuses a split too near an edge', () => {
    expect(splitClip(clip('a', 0, 5), 0.01)).toBeNull();
    expect(splitClip(clip('a', 0, 5), 4.99)).toBeNull();
  });

  it('starts a new run when the media does not carry on', () => {
    const a = clip('a', 0, 5);
    const b = clip('b', 5, 5, { inPoint: 0 });
    const c = clip('c', 10, 5, { inPoint: 5, media: video('other.mp4') });
    const runs = clipRuns([a, b, c]);
    expect(runs.get('b')).toBe('b');
    expect(runs.get('c')).toBe('c');
  });
});

describe('trimming and placing', () => {
  it('moves the in-point with a left trim', () => {
    const clips = [clip('a', 10, 6, { inPoint: 1 })];
    const out = trimClip(clips, 'a', 'start', 12)!;
    expect(out[0]).toMatchObject({ startTime: 12, duration: 4, inPoint: 3 });
    // Back past the media's first frame is clamped there.
    const back = trimClip(clips, 'a', 'start', 0)!;
    expect(back[0]).toMatchObject({ startTime: 9, inPoint: 0, duration: 7 });
  });

  it('stops a right trim at the neighbour and at the end of a stop clip\'s media', () => {
    const clips = [clip('a', 0, 4, { endBehaviour: 'stop' }), clip('b', 20, 5)];
    expect(trimClip(clips, 'a', 'end', 30)![0].duration).toBe(10);
    const looping = [clip('a', 0, 4, { endBehaviour: 'loop' }), clip('b', 20, 5)];
    expect(trimClip(looping, 'a', 'end', 30)![0].duration).toBe(20);
  });

  it('places a new clip into the free window and refuses one that does not fit', () => {
    const clips = [clip('a', 0, 5), clip('b', 8, 5)];
    expect(insertClip(clips, clip('n', 6, 2))!.map((c) => c.id)).toEqual(['a', 'n', 'b']);
    expect(insertClip(clips, clip('n', 6, 4))).toBeNull();
  });

  it('moves a selection together, refusing overlaps', () => {
    const clips = [clip('a', 0, 2), clip('b', 2, 2), clip('c', 10, 2)];
    expect(moveClips(clips, new Set(['a', 'b']), 3)!.map((c) => c.startTime)).toEqual([3, 5, 10]);
    expect(moveClips(clips, new Set(['a', 'b']), 7)).toBeNull();
    expect(moveClips(clips, new Set(['a']), -1)).toBeNull();
  });

  it('duplicates after the selection, or at the end of the track when that is taken', () => {
    const clips = [clip('a', 0, 2), clip('b', 2, 2)];
    const dup = duplicateClips(clips, new Set(['a']), ids)!;
    expect(dup.clips.map((c) => c.startTime)).toEqual([0, 2, 4]);
    const free = duplicateClips([clip('a', 0, 2)], new Set(['a']), ids)!;
    expect(free.clips.map((c) => c.startTime)).toEqual([0, 2]);
  });

  it('pastes keeping spacing and refuses an overlap', () => {
    const copied = [clip('x', 3, 1), clip('y', 5, 1)];
    const out = pasteClips([clip('a', 0, 2)], copied, 10, ids)!;
    expect(out.clips.map((c) => c.startTime)).toEqual([0, 10, 12]);
    expect(pasteClips([clip('a', 0, 2)], copied, 1, ids)).toBeNull();
  });

  it('ripple-deletes, closing the gap', () => {
    const clips = [clip('a', 0, 2), clip('b', 2, 3), clip('c', 5, 2), clip('d', 9, 1)];
    const out = rippleDelete(clips, new Set(['b', 'c']));
    expect(out.clips.map((c) => [c.id, c.startTime])).toEqual([['a', 0], ['d', 4]]);
  });

  it('carries lane keys inside a span', () => {
    const lanes = [{ key: 'layer:opacity', label: 'Opacity', type: 'number' as const, keyframes: [{ time: 1, value: 0, easing: 'linear' as const }, { time: 6, value: 1, easing: 'linear' as const }], boolKeyframes: [] }];
    expect(shiftLaneKeys(lanes, 0, 5, 2)[0].keyframes.map((k) => k.time)).toEqual([3, 6]);
  });
});

describe('evaluating tracks', () => {
  const opts = { playing: true, seekGeneration: 3 };

  it('reports the clip, media time and opacity at an instant', () => {
    const frame = evaluateShowTracks([track([clip('a', 2, 6, { inPoint: 1, fadeIn: 2, opacity: 0.5 })])], 3, opts);
    const st = frame.tracks[0];
    expect(st.clip).toMatchObject({ clipId: 'a', runId: 'a', mediaTime: 2, paused: false });
    expect(st.opacity).toBeCloseTo(0.25, 9);
  });

  it('passes the layer through in a gap, or hides it', () => {
    expect(evaluateShowTracks([track([clip('a', 5, 1)])], 1, opts).tracks[0]).toMatchObject({ clip: null, opacity: 1 });
    expect(evaluateShowTracks([track([clip('a', 5, 1)], { gap: 'hide' })], 1, opts).tracks[0]).toMatchObject({ clip: null, opacity: 0 });
  });

  it('hides muted tracks and everything but a solo', () => {
    const tracks = [track([clip('a', 0, 5)]), track([clip('b', 0, 5)], { id: 't2', layerId: 'L2' })];
    expect(evaluateShowTracks([{ ...tracks[0], muted: true }], 1, opts).tracks[0].opacity).toBe(0);
    const solo = evaluateShowTracks(tracks, 1, { ...opts, soloTrackId: 't2' });
    expect(solo.tracks.map((t) => t.opacity)).toEqual([0, 1]);
  });

  it('pauses video when the transport is stopped or the clip is held', () => {
    expect(evaluateShowTracks([track([clip('a', 0, 5)])], 1, { ...opts, playing: false }).tracks[0].clip!.paused).toBe(true);
    expect(evaluateShowTracks([track([clip('a', 0, 20, { endBehaviour: 'hold' })])], 15, opts).tracks[0].clip!.paused).toBe(true);
  });

  it('runs video under an offline render even though the show is not playing', () => {
    const frame = evaluateShowTracks([track([clip('a', 0, 5)])], 1, { playing: false, seekGeneration: 9, manualClock: true });
    expect(frame.tracks[0].clip!.paused).toBe(false);
  });

  it('signature ignores media time while playing but not while paused', () => {
    const tr = [track([clip('a', 0, 5)])];
    const a = showTrackFrameSignature(evaluateShowTracks(tr, 1, opts));
    const b = showTrackFrameSignature(evaluateShowTracks(tr, 1.5, opts));
    expect(a).toBe(b);
    const pa = showTrackFrameSignature(evaluateShowTracks(tr, 1, { ...opts, playing: false }));
    const pb = showTrackFrameSignature(evaluateShowTracks(tr, 1.5, { ...opts, playing: false }));
    expect(pa).not.toBe(pb);
  });
});

describe('the show store with layer tracks', () => {
  const layer = { id: 'L1', name: 'Wall', type: 'media', opacity: 1, source: null, _assetRef: undefined } as unknown as Layer;
  let frames: Array<ShowTrackFrame | null>;

  beforeEach(() => {
    showTimeline._resetForTest();
    setShowCompositionLoader(() => {});
    frames = [];
    setShowTrackFrameSink((f) => frames.push(f));
  });
  afterEach(() => {
    setShowTrackFrameSink(null);
    setShowCompositionLoader(null);
    showTimeline._resetForTest();
  });

  it('keeps one track per layer', () => {
    const a = showTimeline.addLayerTrack(layer);
    const b = showTimeline.addLayerTrack(layer);
    expect(a).toBe(b);
    expect(get(showTimeline).layerTracks).toHaveLength(1);
  });

  it('adds clips, extends the show and publishes the frame at the playhead', () => {
    const t = showTimeline.addLayerTrack(layer);
    const id = showTimeline.addLayerClip(t, video(), 2)!;
    const s = get(showTimeline);
    expect(s.duration).toBe(12);
    expect(s.layerTracks[0].clips[0]).toMatchObject({ id, startTime: 2, duration: 10, endBehaviour: 'stop' });
    showTimeline.seek(3);
    const last = frames[frames.length - 1]!;
    expect(last.tracks[0].clip).toMatchObject({ clipId: id, mediaTime: 1 });
  });

  it('refuses edits on a locked track', () => {
    const t = showTimeline.addLayerTrack(layer);
    showTimeline.updateLayerTrack(t, { locked: true });
    expect(showTimeline.addLayerClip(t, video(), 0)).toBeNull();
  });

  it('splits at the playhead and the halves share a run', () => {
    const t = showTimeline.addLayerTrack(layer);
    showTimeline.addLayerClip(t, video(), 0);
    showTimeline.selectLayerClips([]);
    const [right] = showTimeline.splitLayerClips(4);
    const clips = get(showTimeline).layerTracks[0].clips;
    expect(clips.map((c) => c.startTime)).toEqual([0, 4]);
    expect(clips[1].id).toBe(right);
    expect(clips[1].inPoint).toBe(4);
    showTimeline.seek(5);
    expect(frames[frames.length - 1]!.tracks[0].clip!.runId).toBe(clips[0].id);
  });

  it('ripple-deletes and removes tracks', () => {
    const t = showTimeline.addLayerTrack(layer);
    const a = showTimeline.addLayerClip(t, video(), 0, { duration: 2 })!;
    showTimeline.addLayerClip(t, video(), 2, { duration: 2 });
    showTimeline.removeLayerClips([a], { ripple: true });
    expect(get(showTimeline).layerTracks[0].clips[0].startTime).toBe(0);
    showTimeline.removeLayerTrack(t);
    expect(get(showTimeline).layerTracks).toHaveLength(0);
    expect(frames[frames.length - 1]).toBeNull();
  });

  it('snaps clip moves to the beat grid when there is one', () => {
    const t = showTimeline.addLayerTrack(layer);
    const id = showTimeline.addLayerClip(t, video(), 0, { duration: 1 })!;
    showTimeline.setTempo({ offset: 0, segments: [{ bar: 1, bpm: 100, beatsPerBar: 4, beatUnit: 4 }], source: 'manual' });
    expect(get(showTimeline).snapGrid).toBe('beat');
    showTimeline.setZoom(120);
    // Beats every 0.6 s; 3.05 snaps to 3.0.
    showTimeline.moveLayerClip(id, 3.05);
    expect(get(showTimeline).layerTracks[0].clips[0].startTime).toBeCloseTo(3, 9);
  });

  it('round-trips through serialize and hydrate with asset refs', () => {
    const t = showTimeline.addLayerTrack(layer);
    showTimeline.addLayerClip(t, video(), 1, { fadeIn: 0.5, rate: 2, duration: 3 });
    showTimeline.setTempo({ offset: 0.2, segments: [{ bar: 1, bpm: 128, beatsPerBar: 4, beatUnit: 4 }], source: 'analysis' });
    const saved = JSON.parse(JSON.stringify(showTimeline.serialize()));
    expect(saved.version).toBe(6);
    // The runtime URL is blanked: the AssetRef rebuilds it.
    expect(saved.layerTracks[0].clips[0].media.src).toBe('');
    showTimeline._resetForTest();
    showTimeline.hydrate(saved, '/project');
    const s = get(showTimeline);
    expect(s.layerTracks[0].clips[0]).toMatchObject({ startTime: 1, duration: 3, rate: 2, fadeIn: 0.5 });
    expect(s.layerTracks[0].clips[0].media.src).toMatch(/clips\/ramp\.mp4$/);
    expect(s.tempo?.segments[0].bpm).toBe(128);
    expect(s.duration).toBe(4);
  });

  it('opens a version 1 show unchanged, with no tracks', () => {
    showTimeline.hydrate({ version: 1, isOpen: false, loop: false, zoom: 12, snapEnabled: true, audioTracks: [], presetClips: [{ id: 'p', compositionId: 'c', startTime: 0, duration: 5, transitionIn: 'cut' }] });
    const s = get(showTimeline);
    expect(s.layerTracks).toEqual([]);
    expect(s.tempo).toBeNull();
    expect(s.snapGrid).toBe('seconds');
    expect(s.presetClips).toHaveLength(1);
    expect(s.duration).toBe(5);
  });
});
