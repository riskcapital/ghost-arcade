import { describe, expect, it } from 'vitest';
import type { KeyframeTrack, Layer, ShowClipMedia, ShowLayerClip, ShowLayerTrack } from '../../types';
import { crossfadeAt, evaluateShowTracks, trackTransitionWindow, clipRuns, type ShowTrackFrame } from './showTrackEval';
import { buildShowTrackScene, SHOW_XFADE_LAYER_PREFIX, showTrackLayerId } from './showTrackScene';
import { ShowClipSources } from './showClipSources';
import {
  addLane,
  carryKeysAcross,
  emptyLane,
  evaluateLanes,
  moveLaneKey,
  removeLaneKeys,
  setLaneKey,
  setLaneKeyEasing,
  shiftKeysOnLane,
} from './showTrackLanes';
import { moveClipsAcrossTracks } from './showTrackEdit';
import { compositionTransitionWeights } from '../../renderer/compositionTransitionLayers';
import { applyParamOverrides } from '../../keyframes/applyParamOverrides';

const video = (name = 'ramp.mp4', sourceDuration = 10): ShowClipMedia => ({
  kind: 'video', name, src: `ghost-asset://localhost/clips/${name}`, sourceDuration,
});
const image = (name: string): ShowClipMedia => ({ kind: 'image', name, src: `/img/${name}` });

function clip(id: string, startTime: number, duration: number, extra: Partial<ShowLayerClip> = {}): ShowLayerClip {
  return { id, startTime, duration, media: video(), inPoint: 0, endBehaviour: 'loop', fadeIn: 0, fadeOut: 0, ...extra };
}

function layer(id: string, extra: Partial<Layer> = {}): Layer {
  return { id, name: id, type: 'media', visible: true, opacity: 1, source: { id: `own-${id}`, type: 'image', src: '/own.png', name: 'own' }, ...extra } as unknown as Layer;
}

function track(id: string, layerId: string, clips: ShowLayerClip[], extra: Partial<ShowLayerTrack> = {}): ShowLayerTrack {
  return { id, layerId, layerName: layerId, template: layer(layerId, { surfaceId: layerId }), clips, lanes: [], gap: 'layer', muted: false, locked: false, collapsed: false, ...extra };
}

const opacityLane = (keys: Array<[number, number]>): KeyframeTrack => ({
  key: 'layer:opacity', label: 'Opacity', type: 'number',
  keyframes: keys.map(([time, value]) => ({ time, value, easing: 'linear' as const })), boolKeyframes: [],
});

function frameAt(tracks: ShowLayerTrack[], t: number, playing = true): ShowTrackFrame {
  return evaluateShowTracks(tracks, t, {
    playing,
    seekGeneration: 1,
    laneValues: (tr, time) => evaluateLanes(tr.lanes, time),
  });
}

describe('keyframe lanes', () => {
  it('evaluate with the keyframe easings, in show seconds', () => {
    const lanes = [opacityLane([[2, 0], [4, 1]])];
    expect(evaluateLanes(lanes, 0)).toEqual({ 'layer:opacity': 0 });
    expect(evaluateLanes(lanes, 3)!['layer:opacity']).toBeCloseTo(0.5, 9);
    expect(evaluateLanes(lanes, 9)).toEqual({ 'layer:opacity': 1 });
    const eased = setLaneKeyEasing(lanes, 'layer:opacity', [2], 'ease-in');
    expect(evaluateLanes(eased, 3)!['layer:opacity']).toBeCloseTo(0.25, 9);
    expect(evaluateLanes([emptyLane({ key: 'shader:speed', label: 'Speed', type: 'number' })], 1)).toBeNull();
  });

  it('adds, moves, shifts and removes keys', () => {
    let lanes = addLane([], { key: 'layer:opacity', label: 'Opacity', type: 'number' });
    expect(addLane(lanes, { key: 'layer:opacity', label: 'Opacity', type: 'number' })).toBe(lanes);
    lanes = setLaneKey(lanes, 'layer:opacity', 1, 0.2);
    lanes = setLaneKey(lanes, 'layer:opacity', 3, 0.8);
    lanes = setLaneKey(lanes, 'layer:opacity', 1, 0.4);
    expect(lanes[0].keyframes.map((k) => [k.time, k.value])).toEqual([[1, 0.4], [3, 0.8]]);
    lanes = moveLaneKey(lanes, 'layer:opacity', 3, 5, 0.9);
    expect(lanes[0].keyframes.map((k) => [k.time, k.value])).toEqual([[1, 0.4], [5, 0.9]]);
    lanes = shiftKeysOnLane(lanes, 'layer:opacity', [1, 5], 1);
    expect(lanes[0].keyframes.map((k) => k.time)).toEqual([2, 6]);
    lanes = removeLaneKeys(lanes, 'layer:opacity', [2]);
    expect(lanes[0].keyframes.map((k) => k.time)).toEqual([6]);
  });

  it('reach the layer after the preset keyframes, with clip fades multiplying on top', () => {
    const tracks = [track('t', 'A', [clip('c', 0, 10, { fadeIn: 4 })], { lanes: [opacityLane([[0, 0.5], [10, 0.5]])] })];
    const frame = frameAt(tracks, 2);
    expect(frame.tracks[0].params).toEqual({ 'layer:opacity': 0.5 });
    const out = buildShowTrackScene([layer('A', { opacity: 0.9 })], frame, { sourceFor: () => null });
    expect(out[0]._showParams).toEqual({ 'layer:opacity': 0.5 });
    expect(out[0]._showOpacityMul).toBeCloseTo(0.5, 9);
    // What the native sync does: preset keyframes first, then the show's
    // lanes (the show wins), then the fade multiplier.
    const copy = { ...out[0] } as Layer;
    applyParamOverrides(copy, { 'layer:opacity': 0.2 });
    applyParamOverrides(copy, out[0]._showParams!);
    const finalOpacity = (copy.opacity as number) * (out[0]._showOpacityMul ?? 1);
    expect(finalOpacity).toBeCloseTo(0.25, 9);
  });

  it('keep applying in a gap (the layer shows its own content under the lane)', () => {
    const tracks = [track('t', 'A', [clip('c', 5, 2)], { lanes: [opacityLane([[0, 0.3]])] })];
    const out = buildShowTrackScene([layer('A')], frameAt(tracks, 1), { sourceFor: () => null });
    expect(out[0]._showParams).toEqual({ 'layer:opacity': 0.3 });
    expect(out[0].source!.id).toBe('own-A');
  });

  it('carry the keys inside a moved clip onto the other track', () => {
    const source = [opacityLane([[1, 0.1], [3, 0.3], [6, 0.6]])];
    const { source: left, target } = carryKeysAcross(source, [], 2, 5, 10);
    expect(left[0].keyframes.map((k) => k.time)).toEqual([1, 6]);
    expect(target).toHaveLength(1);
    expect(target[0].keyframes.map((k) => [k.time, k.value])).toEqual([[13, 0.3]]);
  });
});

describe('moving clips across tracks', () => {
  const tracks = [
    track('t1', 'A', [clip('a1', 0, 2), clip('a2', 4, 2)], { lanes: [opacityLane([[4.5, 0.5]])] }),
    track('t2', 'B', [clip('b1', 0, 3)]),
    track('t3', 'C', []),
  ];

  it('moves a selection down a row and later in time, carrying its keys', () => {
    const out = moveClipsAcrossTracks(tracks, new Set(['a2']), 1, 1)!;
    expect(out[0].clips.map((c) => c.id)).toEqual(['a1']);
    expect(out[1].clips.map((c) => [c.id, c.startTime])).toEqual([['b1', 0], ['a2', 5]]);
    expect(out[0].lanes[0].keyframes).toEqual([]);
    expect(out[1].lanes[0].keyframes.map((k) => k.time)).toEqual([5.5]);
    expect(out[2]).toBe(tracks[2]);
  });

  it('moves clips from two tracks together', () => {
    const out = moveClipsAcrossTracks(tracks, new Set(['a2', 'b1']), 4, 1)!;
    expect(out[1].clips.map((c) => [c.id, c.startTime])).toEqual([['a2', 8]]);
    expect(out[2].clips.map((c) => [c.id, c.startTime])).toEqual([['b1', 4]]);
  });

  it('refuses overlaps, locked tracks and leaving the list', () => {
    expect(moveClipsAcrossTracks(tracks, new Set(['a1']), 0, 1)).toBeNull();
    expect(moveClipsAcrossTracks(tracks, new Set(['a1']), 0, -1)).toBeNull();
    expect(moveClipsAcrossTracks(tracks, new Set(['b1']), 10, 2)).toBeNull();
    const locked = [tracks[0], { ...tracks[1], locked: true }, tracks[2]];
    expect(moveClipsAcrossTracks(locked, new Set(['a2']), 3, 1)).toBeNull();
  });

  it('moves on the same track like a plain multi-clip move', () => {
    const out = moveClipsAcrossTracks(tracks, new Set(['a1', 'a2']), 1, 0)!;
    expect(out[0].clips.map((c) => c.startTime)).toEqual([1, 5]);
    expect(out[0].lanes[0].keyframes[0].time).toBe(5.5);
  });
});

describe('crossfades between clips on one track', () => {
  const red = image('red.png');
  const blue = image('blue.png');
  const clips = [
    clip('r', 0, 4, { media: red }),
    clip('b', 4, 4, { media: blue, transitionIn: 'dissolve', transitionDuration: 2 }),
  ];
  const tr = track('t', 'A', clips);

  it('centres the window on the cut and clamps it like the preset lane', () => {
    expect(trackTransitionWindow(clips, clips[1])).toMatchObject({ start: 3, end: 5, duration: 2 });
    const long = [clips[0], { ...clips[1], transitionDuration: 30 }];
    expect(trackTransitionWindow(long, long[1])!.duration).toBe(4);
    expect(trackTransitionWindow(clips, clips[0])).toBeNull();
    const apart = [clips[0], { ...clips[1], startTime: 5 }];
    expect(trackTransitionWindow(apart, apart[1])).toBeNull();
  });

  it('reports the incoming clip on the layer and the outgoing one for the helper', () => {
    expect(crossfadeAt(clips, 2.9)).toBeNull();
    expect(crossfadeAt(clips, 5)).toBeNull();
    for (const t of [3, 3.5, 4, 4.5, 4.99]) {
      const p = (t - 3) / 2;
      const w = compositionTransitionWeights('dissolve', p);
      const state = frameAt([tr], t).tracks[0];
      expect(state.clip!.clipId).toBe('b');
      expect(state.xfade!.clip.clipId).toBe('r');
      expect(state.opacity).toBeCloseTo(w.incoming, 9);
      expect(state.xfade!.opacity).toBeCloseTo(w.outgoing, 9);
    }
  });

  it('puts a helper copy directly beneath the layer, on stage and off stage', () => {
    const sources = new ShowClipSources({ now: () => 0 });
    const frame = frameAt([tr], 4);
    const ctx = {
      sourceFor: (st: ShowTrackFrame['tracks'][number]) => sources.sourceFor(st, frame),
      xfadeSourceFor: (st: ShowTrackFrame['tracks'][number]) => sources.xfadeSourceFor(st, frame),
    };
    const onStage = buildShowTrackScene([layer('Z'), layer('A'), layer('Y')], frame, ctx);
    expect(onStage.map((l) => l.id)).toEqual(['Z', 'A', SHOW_XFADE_LAYER_PREFIX + 'A', 'Y']);
    expect(onStage[1].source!.src).toContain('blue.png');
    expect(onStage[2].source!.src).toContain('red.png');
    expect(onStage[1]._showOpacityMul).toBeCloseTo(Math.sin(Math.PI / 4), 9);
    expect(onStage[2]._showOpacityMul).toBeCloseTo(Math.cos(Math.PI / 4), 9);
    const offStage = buildShowTrackScene([layer('Z')], frame, ctx);
    expect(offStage.map((l) => l.id)).toEqual([showTrackLayerId('A'), SHOW_XFADE_LAYER_PREFIX + 'A', 'Z']);
    // Outside the window: no helper.
    const after = frameAt([tr], 5.5);
    expect(buildShowTrackScene([layer('A')], after, { sourceFor: (st) => sources.sourceFor(st, after) }).map((l) => l.id)).toEqual(['A']);
  });

  it('keeps the outgoing video on its decoder when the crossfade begins', () => {
    const vclips = [
      clip('v1', 0, 4, { media: video('one.mp4') }),
      clip('v2', 4, 4, { media: video('two.mp4'), transitionIn: 'dissolve', transitionDuration: 2, inPoint: 3 }),
    ];
    const vt = track('t', 'A', vclips);
    const sources = new ShowClipSources({ now: () => 0 });
    const before = frameAt([vt], 2.9);
    sources.sourceFor(before.tracks[0], before);
    const playing = sources.anchorFor('t')!;
    const during = frameAt([vt], 3.1);
    const helper = sources.xfadeSourceFor(during.tracks[0], during)!;
    const incoming = sources.sourceFor(during.tracks[0], during)!;
    expect(helper).toBe(playing.source);
    expect(helper.id).toBe('show:v1');
    expect(incoming.id).toBe('show:v2');
    // The incoming clip runs from before its in-point (it has 3 s of media there).
    expect(incoming._nativePlaybackTimeSeconds).toBeCloseTo(3 - 0.9, 6);
  });

  it('waits on the first frame when the incoming clip has no media before its in-point', () => {
    const vclips = [clip('v1', 0, 4), clip('v2', 4, 4, { media: video('two.mp4'), transitionIn: 'dissolve', transitionDuration: 2 })];
    const state = frameAt([track('t', 'A', vclips)], 3.5).tracks[0];
    expect(state.clip!.mediaTime).toBe(0);
    expect(state.clip!.paused).toBe(true);
    expect(frameAt([track('t', 'A', vclips)], 4.2).tracks[0].clip!.paused).toBe(false);
  });

  it('gives a crossfaded clip a decoder of its own even when the media carries on', () => {
    const a = clip('a', 0, 4);
    const b = clip('b', 4, 4, { inPoint: 4, loopStart: 0 });
    expect(clipRuns([a, b]).get('b')).toBe('a');
    expect(clipRuns([a, { ...b, transitionIn: 'dissolve', transitionDuration: 1 }]).get('b')).toBe('b');
  });
});
