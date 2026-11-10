/**
 * Layer-track engine regressions: crossfades off stage, preset dissolves,
 * decoder anchors across crossfades, pauses and loop wraps, shader splits,
 * drift, and video clips of unknown length.
 */
import { describe, expect, it } from 'vitest';
import type { Layer, ShowClipMedia, ShowLayerClip, ShowLayerTrack } from '../../types';
import { clipRuns, evaluateShowTracks, type ShowTrackFrame } from './showTrackEval';
import { buildShowTrackScene, SHOW_XFADE_LAYER_PREFIX, showTrackLayerId, type ShowTrackSceneContext } from './showTrackScene';
import { ShowClipSources, xfadeAnchorKey } from './showClipSources';
import { selectShowPreloads } from './showPreloader';
import { showPhaseTargets } from './showVideoPhase';
import { ShowDriftWatch, type ShowDriftSession } from './showVideoDrift';
import { probeVideoDuration, unknownLengthVideoUris } from './showClipLength';
import { evaluateLanes } from './showTrackLanes';
import { splitClip } from './showTrackEdit';
import {
  buildCompositionTransitionLayers,
  compositionTransitionWeights,
  TRANSITION_LAYER_PREFIX,
} from '../../renderer/compositionTransitionLayers';
import { applyParamOverrides } from '../../keyframes/applyParamOverrides';

const video = (name = 'ramp.mp4', sourceDuration: number | undefined = 10): ShowClipMedia => ({
  kind: 'video', name, src: `ghost-asset://localhost/clips/${name}`, ...(sourceDuration ? { sourceDuration } : {}),
});
const image = (name: string): ShowClipMedia => ({ kind: 'image', name, src: `/img/${name}` });
const shader = (code = 'void main() { gl_FragColor = vec4(TIME); }'): ShowClipMedia => ({
  kind: 'shader', name: 'pulse', src: '', shaderCode: code, shaderInputs: [], shaderValues: {},
});

function clip(id: string, startTime: number, duration: number, extra: Partial<ShowLayerClip> = {}): ShowLayerClip {
  return { id, startTime, duration, media: video(), inPoint: 0, endBehaviour: 'loop', fadeIn: 0, fadeOut: 0, ...extra };
}

function layer(id: string, extra: Partial<Layer> = {}): Layer {
  return { id, name: id, type: 'media', visible: true, opacity: 1, source: { id: `own-${id}`, type: 'image', src: '/own.png', name: 'own' }, ...extra } as unknown as Layer;
}

function track(id: string, layerId: string, clips: ShowLayerClip[], extra: Partial<ShowLayerTrack> = {}): ShowLayerTrack {
  return { id, layerId, layerName: layerId, template: layer(layerId, { surfaceId: layerId }), clips, lanes: [], gap: 'layer', muted: false, locked: false, collapsed: false, ...extra };
}

function frameAt(tracks: ShowLayerTrack[], t: number, opts: { playing?: boolean; generation?: number; wrap?: ShowTrackFrame['wrap'] } = {}): ShowTrackFrame {
  return evaluateShowTracks(tracks, t, {
    playing: opts.playing ?? true,
    seekGeneration: opts.generation ?? 1,
    laneValues: (tr, time) => evaluateLanes(tr.lanes, time),
    wrap: opts.wrap,
  });
}

/** What Canvas hands the scene builder: the one shared source cache. */
function contextFor(sources: ShowClipSources, frame: ShowTrackFrame): ShowTrackSceneContext {
  return {
    sourceFor: (st) => sources.sourceFor(st, frame),
    xfadeSourceFor: (st) => sources.xfadeSourceFor(st, frame),
    warmSourceFor: (warm) => sources.warmSourceFor(warm),
  };
}

const ids = (layers: Layer[]) => layers.map((l) => l.id);
const byId = (layers: Layer[], id: string) => layers.find((l) => l.id === id)!;

describe('an off-stage track crossfading into a clip', () => {
  const red = image('red.png');
  const blue = image('blue.png');

  it('keeps the outgoing clip on screen while a faded-in clip is still invisible', () => {
    const tr = track('t', 'A', [
      clip('r', 0, 4, { media: red }),
      clip('b', 4, 4, { media: blue, transitionIn: 'dissolve', transitionDuration: 2, fadeIn: 2 }),
    ]);
    const sources = new ShowClipSources({ now: () => 0 });
    for (const t of [3, 3.4, 3.9]) {
      const frame = frameAt([tr], t);
      expect(frame.tracks[0].opacity).toBe(0);
      const scene = buildShowTrackScene([layer('Z')], frame, contextFor(sources, frame));
      expect(ids(scene)).toEqual([showTrackLayerId('A'), SHOW_XFADE_LAYER_PREFIX + 'A', 'Z']);
      const helper = byId(scene, SHOW_XFADE_LAYER_PREFIX + 'A');
      expect(helper.source!.src).toContain('red.png');
      expect(helper._showOpacityMul ?? 1).toBeCloseTo(compositionTransitionWeights('dissolve', (t - 3) / 2).outgoing, 9);
      expect(byId(scene, showTrackLayerId('A'))._showOpacityMul).toBe(0);
    }
  });

  it('shows the outgoing clip on the first frame of the window (no black frame)', () => {
    const tr = track('t', 'A', [
      clip('r', 0, 4, { media: red }),
      clip('b', 4, 4, { media: blue, transitionIn: 'dissolve', transitionDuration: 2 }),
    ]);
    const sources = new ShowClipSources({ now: () => 0 });
    const frame = frameAt([tr], 3);
    expect(frame.tracks[0].opacity).toBe(0);
    const scene = buildShowTrackScene([layer('Z')], frame, contextFor(sources, frame));
    const helper = byId(scene, SHOW_XFADE_LAYER_PREFIX + 'A');
    expect(helper.source!.src).toContain('red.png');
    expect(helper._showOpacityMul).toBeUndefined();
  });

  it('still hides a muted track', () => {
    const tr = track('t', 'A', [
      clip('r', 0, 4, { media: red }),
      clip('b', 4, 4, { media: blue, transitionIn: 'dissolve', transitionDuration: 2, fadeIn: 2 }),
    ], { muted: true });
    const frame = frameAt([tr], 3.5);
    expect(ids(buildShowTrackScene([layer('Z')], frame, { sourceFor: () => null }))).toEqual(['Z']);
  });
});

describe('a track under a preset dissolve', () => {
  const blue = image('blue.png');
  const compositions: Record<string, Layer[]> = {
    one: [layer('X'), layer('A', { opacity: 0.8 })],
    two: [layer('X'), layer('A')],
    three: [layer('X'), layer('B'), layer('A')],
  };
  const dissolve = (from: string, to: string, live: Layer[], active: string, progress: number) => buildCompositionTransitionLayers({
    liveLayers: live,
    activeCompositionId: active,
    transition: { style: 'dissolve', progress, fromCompositionId: from, toCompositionId: to },
    compositionLayers: (id) => compositions[id] ?? null,
  });

  it('drives both presets\' copies of its layer, before and after the swap', () => {
    const tr = track('t', 'A', [clip('c', 0, 20, { media: blue })]);
    const sources = new ShowClipSources({ now: () => 0 });
    for (const [active, progress] of [['one', 0.3], ['two', 0.7]] as const) {
      const live = dissolve('one', 'two', compositions[active], active, progress);
      expect(ids(live)).toContain(TRANSITION_LAYER_PREFIX + 'A');
      const frame = frameAt([tr], 5);
      const scene = buildShowTrackScene(live, frame, contextFor(sources, frame));
      // Nothing injected on top: the layer is on stage on both sides.
      expect(ids(scene)).toEqual(ids(live));
      for (const id of ['A', TRANSITION_LAYER_PREFIX + 'A']) {
        expect(byId(scene, id).source!.src).toContain('blue.png');
      }
      // Each side keeps its dissolve weight.
      expect(byId(scene, 'A').opacity).toBe(byId(live, 'A').opacity);
      expect(byId(scene, TRANSITION_LAYER_PREFIX + 'A').opacity).toBe(byId(live, TRANSITION_LAYER_PREFIX + 'A').opacity);
      // The untracked layer shows its own content on both sides.
      expect(byId(scene, TRANSITION_LAYER_PREFIX + 'X').source!.id).toBe('own-X');
    }
  });

  it('drives the incoming preset\'s copy when only that preset has the layer', () => {
    const tr = track('t', 'B', [clip('c', 0, 20, { media: blue })]);
    const live = dissolve('one', 'three', compositions.one, 'one', 0.4);
    expect(ids(live)).toContain(TRANSITION_LAYER_PREFIX + 'B');
    const frame = frameAt([tr], 5);
    const sources = new ShowClipSources({ now: () => 0 });
    const scene = buildShowTrackScene(live, frame, contextFor(sources, frame));
    expect(ids(scene)).not.toContain(showTrackLayerId('B'));
    expect(byId(scene, TRANSITION_LAYER_PREFIX + 'B').source!.src).toContain('blue.png');
  });

  it('puts a crossfade helper beneath each side', () => {
    const tr = track('t', 'A', [
      clip('r', 0, 4, { media: image('red.png') }),
      clip('b', 4, 4, { media: blue, transitionIn: 'dissolve', transitionDuration: 2 }),
    ]);
    const live = dissolve('one', 'two', compositions.one, 'one', 0.5);
    const frame = frameAt([tr], 4);
    const scene = buildShowTrackScene(live, frame, contextFor(new ShowClipSources({ now: () => 0 }), frame));
    const at = (id: string) => ids(scene).indexOf(id);
    expect(at(SHOW_XFADE_LAYER_PREFIX + 'A')).toBe(at('A') + 1);
    const fadeId = TRANSITION_LAYER_PREFIX + 'A';
    expect(at(SHOW_XFADE_LAYER_PREFIX + fadeId)).toBe(at(fadeId) + 1);
    expect(new Set(ids(scene)).size).toBe(scene.length);
  });

  it('applies the show\'s lanes after the preset keyframes on both sides', () => {
    const lane = { key: 'layer:opacity', label: 'Opacity', type: 'number' as const, keyframes: [{ time: 0, value: 0.5, easing: 'linear' as const }], boolKeyframes: [] };
    const tr = track('t', 'A', [clip('c', 0, 20, { media: blue, fadeIn: 10 })], { lanes: [lane] });
    const live = dissolve('one', 'two', compositions.one, 'one', 0.5);
    const frame = frameAt([tr], 5);
    const scene = buildShowTrackScene(live, frame, contextFor(new ShowClipSources({ now: () => 0 }), frame));
    for (const id of ['A', TRANSITION_LAYER_PREFIX + 'A']) {
      const driven = byId(scene, id);
      // The native sync: preset keyframes, then the show's lanes, then fades.
      const copy = { ...driven } as Layer;
      applyParamOverrides(copy, { 'layer:opacity': 0.2 });
      applyParamOverrides(copy, driven._showParams!);
      expect((copy.opacity as number) * (driven._showOpacityMul ?? 1)).toBeCloseTo(0.25, 9);
    }
  });
});

describe('decoder anchors through a crossfade', () => {
  const vclips = [
    clip('v1', 0, 4, { media: video('one.mp4') }),
    clip('v2', 4, 4, { media: video('two.mp4'), transitionIn: 'dissolve', transitionDuration: 2 }),
  ];
  const tr = track('t', 'A', vclips);

  /** Build the scene for `t` the way Canvas does; the helper's source. */
  function scene(sources: ShowClipSources, t: number, generation: number) {
    const frame = frameAt([tr], t, { generation });
    const out = buildShowTrackScene([layer('A')], frame, contextFor(sources, frame));
    sources.retainFrame(frame);
    return out;
  }

  it('hands the playing run over again on the second pass through a loop', () => {
    const sources = new ShowClipSources({ now: () => 0 });
    for (const generation of [1, 2]) {
      // Each pass starts at the top of the show (a loop wrap or a seek).
      scene(sources, 0.1, generation);
      const playing = byId(scene(sources, 2.9, generation), 'A').source!;
      const during = scene(sources, 3.1, generation);
      const helper = byId(during, SHOW_XFADE_LAYER_PREFIX + 'A').source!;
      expect(helper).toBe(playing);
      expect(helper._nativePlaybackSeekSeq).toBe(playing._nativePlaybackSeekSeq);
      scene(sources, 5.5, generation);
    }
    // The helper's anchor went with the crossfade.
    expect(sources.xfadeAnchorFor('t')).toBeNull();
  });

  it('phase-follows both sides mid-crossfade, each on its own decoder', () => {
    const sources = new ShowClipSources({ now: () => 0 });
    const vt = track('t', 'A', [
      clip('v1', 0, 4, { media: video('one.mp4') }),
      clip('v2', 4, 4, { media: video('two.mp4'), transitionIn: 'dissolve', transitionDuration: 2, inPoint: 3 }),
    ]);
    const before = frameAt([vt], 2.9);
    buildShowTrackScene([layer('A')], before, contextFor(sources, before));
    const frame = { ...frameAt([vt], 3.5), evaluatedAtMs: 1000 };
    buildShowTrackScene([layer('A')], frame, contextFor(sources, frame));
    const targets = showPhaseTargets(frame, sources, 1016);
    expect(targets.map((t) => t.sourceId).sort()).toEqual(['show:v1', 'show:v2']);
    const outgoing = targets.find((t) => t.sourceId === 'show:v1')!;
    const incoming = targets.find((t) => t.sourceId === 'show:v2')!;
    expect(outgoing.timeSeconds).toBeCloseTo(3.5 + 0.016, 6);
    expect(incoming.timeSeconds).toBeCloseTo(3 - 0.5 + 0.016, 6);
    expect(outgoing.seekGeneration).toBe(sources.xfadeAnchorFor('t')!.nativeSeekSeq);
    expect(incoming.seekGeneration).toBe(sources.anchorFor('t')!.nativeSeekSeq);
  });
});

describe('pause and resume', () => {
  const tr = track('t', 'A', [clip('c', 0, 60, { media: video('long-gop.mp4', 60) })]);
  const at = (sources: ShowClipSources, t: number, playing: boolean, generation: number) => {
    const frame = frameAt([tr], t, { playing, generation });
    return sources.sourceFor(frame.tracks[0], frame)!;
  };

  it('pauses on the exact frame and resumes from it without a seek', () => {
    const sources = new ShowClipSources({ now: () => 0 });
    const playing = at(sources, 2, true, 1);
    const paused = at(sources, 3, false, 2);
    expect(paused.isPlaying).toBe(false);
    expect(paused._nativePlaybackTimeSeconds).toBe(3);
    expect(paused._nativePlaybackSeekSeq).toBe(playing._nativePlaybackSeekSeq! + 1);
    const resumed = at(sources, 3, true, 3);
    expect(resumed.isPlaying).toBe(true);
    expect(resumed._nativePlaybackTimeSeconds).toBe(3);
    // Same generation: the core carries on decoding instead of seeking.
    expect(resumed._nativePlaybackSeekSeq).toBe(paused._nativePlaybackSeekSeq);
  });

  it('seeks on resume when the paused picture is not where the show is', () => {
    const sources = new ShowClipSources({ now: () => 0 });
    // A paused scrub still in the native scrubber's hands.
    sources.scrubHandler = () => true;
    at(sources, 2, true, 1);
    const paused = at(sources, 3, false, 2);
    at(sources, 7, false, 3);
    const resumed = at(sources, 7, true, 4);
    expect(resumed._nativePlaybackTimeSeconds).toBe(7);
    expect(resumed._nativePlaybackSeekSeq).toBe(paused._nativePlaybackSeekSeq! + 1);
  });

  it('starts a waiting crossfade clip from its pre-rolled frame without a seek', () => {
    const vt = track('t', 'A', [clip('v1', 0, 4), clip('v2', 4, 4, { media: video('two.mp4'), transitionIn: 'dissolve', transitionDuration: 2 })]);
    const sources = new ShowClipSources({ now: () => 0 });
    const waiting = frameAt([vt], 3.5);
    const first = sources.sourceFor(waiting.tracks[0], waiting)!;
    expect(first.isPlaying).toBe(false);
    const started = frameAt([vt], 4.016);
    const next = sources.sourceFor(started.tracks[0], started)!;
    expect(next.isPlaying).toBe(true);
    expect(next._nativePlaybackSeekSeq).toBe(first._nativePlaybackSeekSeq);
  });
});

describe('a looping show at its wrap', () => {
  it('keeps a video whose media carries on through the wrap', () => {
    // A 10 s show looping a 10 s video: the wrap is seamless.
    const tr = track('t', 'A', [clip('c', 0, 10, { media: video('bg.mp4', 10) })]);
    const sources = new ShowClipSources({ now: () => 0 });
    const before = frameAt([tr], 9.98, { generation: 4 });
    const a = sources.sourceFor(before.tracks[0], before)!;
    const after = frameAt([tr], 0.006, { generation: 5, wrap: { fromGeneration: 4, shift: 10 } });
    const b = sources.sourceFor(after.tracks[0], after)!;
    expect(b).toBe(a);
    expect(sources.expectedMediaTime('t', 0.5)).toBeCloseTo(0.5, 9);
  });

  it('re-anchors one whose media does not', () => {
    const tr = track('t', 'A', [clip('c', 0, 10, { media: video('long.mp4', 30) })]);
    const sources = new ShowClipSources({ now: () => 0 });
    const before = frameAt([tr], 9.98, { generation: 4 });
    const a = sources.sourceFor(before.tracks[0], before)!;
    const after = frameAt([tr], 0.006, { generation: 5, wrap: { fromGeneration: 4, shift: 10 } });
    const b = sources.sourceFor(after.tracks[0], after)!;
    expect(b._nativePlaybackSeekSeq).toBe(a._nativePlaybackSeekSeq! + 1);
    expect(b._nativePlaybackTimeSeconds).toBeCloseTo(0.006, 9);
  });

  it('pre-rolls the clips at the top of the show before it wraps', () => {
    const tracks = [
      track('t1', 'A', [clip('a', 0, 5, { media: video('a.mp4') }), clip('b', 5, 5, { media: video('b.mp4') })]),
      track('t2', 'B', [clip('c', 1, 5, { media: video('c.mp4', 30) })]),
    ];
    expect(selectShowPreloads(tracks, 8)).toEqual([]);
    const picks = selectShowPreloads(tracks, 8, { loopDuration: 10 });
    expect(picks.map((p) => [p.clip.id, p.startsIn])).toEqual([['a', 2], ['c', 3]]);
    // A run playing on its track now is not pre-rolled over itself.
    const single = [track('t', 'A', [clip('x', 0, 10)])];
    expect(selectShowPreloads(single, 8, { loopDuration: 10 })).toEqual([]);
  });
});

describe('splitting a shader or sketch clip', () => {
  it('keeps one program running across the cut', () => {
    const whole = clip('s', 0, 10, { media: shader() });
    const [left, right] = splitClip(whole, 4, 's2')!;
    expect(clipRuns([left, right]).get('s2')).toBe('s');
    const tr = track('t', 'A', [left, right]);
    const sources = new ShowClipSources({ now: () => 0 });
    const ctx = (f: ShowTrackFrame) => contextFor(sources, f);
    const before = frameAt([tr], 3.5);
    // The rest of the run needs no warm copy: its program is running.
    expect(before.tracks[0].warm).toBeNull();
    const a = byId(buildShowTrackScene([layer('A')], before, ctx(before)), 'A').source;
    const after = frameAt([tr], 4.5);
    const b = byId(buildShowTrackScene([layer('A')], after, ctx(after)), 'A').source;
    expect(b).toBe(a);
    expect(b!.id).toBe('show:s');
  });

  it('still starts a different program afresh', () => {
    const a = clip('s', 0, 4, { media: shader() });
    const b = clip('t', 4, 4, { media: shader('void main() { gl_FragColor = vec4(1.0); }'), inPoint: 4 });
    expect(clipRuns([a, b]).get('t')).toBe('t');
    // Or the same program restarted from its beginning.
    expect(clipRuns([a, { ...b, media: a.media, inPoint: 0 }]).get('t')).toBe('t');
  });
});

describe('the drift fallback', () => {
  const tr = track('t', 'A', [clip('c', 0, 60, { media: video('soft.mp4', 60) })]);

  function playing(t: number) {
    const sources = new ShowClipSources({ now: () => 0 });
    const frame = { ...frameAt([tr], t), evaluatedAtMs: 1000 };
    sources.sourceFor(frame.tracks[0], frame);
    const anchor = sources.anchorFor('t')!;
    const session = (pts: number): ShowDriftSession => ({
      source_id: anchor.sourceId, state: 'playing', seek_generation: anchor.nativeSeekSeq,
      frames_presented: 100, source_time_seconds: pts, source_frame_duration_seconds: 1 / 30,
    });
    return { sources, frame, session };
  }

  it('leaves a decoder within two frames alone', () => {
    const { sources, frame, session } = playing(10);
    const watch = new ShowDriftWatch();
    for (let i = 0; i < 4; i++) {
      // 100 ms after the frame the show is at 10.1; the decoder shows 10.05.
      expect(watch.check(frame, sources.anchorEntries(), [session(10.05)], 1100)).toEqual([]);
    }
  });

  it('re-anchors one that stays more than two frames off (software decode: no phase error)', () => {
    const { sources, frame, session } = playing(10);
    const watch = new ShowDriftWatch();
    const before = sources.anchorFor('t')!.nativeSeekSeq;
    expect(watch.check(frame, sources.anchorEntries(), [session(9.9)], 1100)).toEqual([]);
    const keys = watch.check(frame, sources.anchorEntries(), [session(9.9)], 1100);
    expect(keys).toEqual(['t']);
    for (const key of keys) sources.reanchor(key);
    const now = frameAt([tr], 10.1);
    const source = sources.sourceFor(now.tracks[0], now)!;
    expect(source._nativePlaybackSeekSeq).toBe(before + 1);
    expect(source._nativePlaybackTimeSeconds).toBeCloseTo(10.1, 9);
  });

  it('ignores a single bad read and a decoder still settling after a seek', () => {
    const { sources, frame, session } = playing(10);
    const watch = new ShowDriftWatch();
    expect(watch.check(frame, sources.anchorEntries(), [session(9.5)], 1100)).toEqual([]);
    expect(watch.check(frame, sources.anchorEntries(), [session(10.08)], 1100)).toEqual([]);
    expect(watch.check(frame, sources.anchorEntries(), [session(9.5)], 1100)).toEqual([]);
    expect(watch.check(frame, sources.anchorEntries(), [{ ...session(9.5), frames_presented: 1 }], 1100)).toEqual([]);
  });

  it('watches a crossfade\'s outgoing clip too', () => {
    const vt = track('t', 'A', [
      clip('v1', 0, 4, { media: video('one.mp4') }),
      clip('v2', 4, 4, { media: video('two.mp4'), transitionIn: 'dissolve', transitionDuration: 2, inPoint: 3 }),
    ]);
    const sources = new ShowClipSources({ now: () => 0 });
    const frame = { ...frameAt([vt], 3.5), evaluatedAtMs: 1000 };
    buildShowTrackScene([layer('A')], frame, contextFor(sources, frame));
    const out = sources.xfadeAnchorFor('t')!;
    const sessions: ShowDriftSession[] = [{
      source_id: out.sourceId, state: 'playing', seek_generation: out.nativeSeekSeq, frames_presented: 50,
      source_time_seconds: 3.2, source_frame_duration_seconds: 1 / 25,
    }];
    const watch = new ShowDriftWatch();
    watch.check(frame, sources.anchorEntries(), sessions, 1000);
    expect(watch.check(frame, sources.anchorEntries(), sessions, 1000)).toEqual([xfadeAnchorKey('t')]);
  });
});

describe('video clips of unknown length', () => {
  it('lists the files to measure, once each', () => {
    const tracks = [
      track('t1', 'A', [clip('a', 0, 5, { media: video('x.mp4', 0) }), clip('b', 5, 5, { media: video('x.mp4', 0) })]),
      track('t2', 'B', [clip('c', 0, 5, { media: video('y.mp4', 8) }), clip('d', 5, 5, { media: image('i.png') })]),
    ];
    expect(unknownLengthVideoUris(tracks, (m) => m.src)).toEqual(['ghost-asset://localhost/clips/x.mp4']);
  });

  it('asks the core, then the file, and says when nobody could answer', async () => {
    const probe = (duration: number, backend = 'videotoolbox') => async () => ({ uri: 'u', backend, hardware: true, reason: '', width: 1, height: 1, fps: 30, duration_seconds: duration, reverse_supported: true });
    expect(await probeVideoDuration('u', probe(12.5), async () => 0)).toBe(12.5);
    expect(await probeVideoDuration('u', probe(0, 'failed'), async () => 7)).toBe(7);
    expect(await probeVideoDuration('u', probe(0, 'failed'), async () => 0)).toBe(0);
    expect(await probeVideoDuration('u', probe(0, 'busy'), async () => 0)).toBeNull();
    expect(await probeVideoDuration('u', async () => null, async () => 0)).toBeNull();
    expect(await probeVideoDuration('u', null, async () => 0)).toBe(0);
  });

  it('a stop clip holds at the end once the length is known, and its source re-trims', () => {
    const c = clip('c', 0, 30, { media: video('x.mp4', 0), endBehaviour: 'stop', loopStart: 2 });
    const sources = new ShowClipSources({ now: () => 0 });
    const unknown = frameAt([track('t', 'A', [c])], 12);
    expect(unknown.tracks[0].clip!.held).toBe(false);
    const first = sources.sourceFor(unknown.tracks[0], unknown)!;
    expect(first.durationSeconds).toBeUndefined();
    const known = frameAt([track('t', 'A', [{ ...c, media: { ...c.media, sourceDuration: 10 } }])], 12);
    expect(known.tracks[0].clip!.held).toBe(true);
    const second = sources.sourceFor(known.tracks[0], known)!;
    expect(second.durationSeconds).toBe(10);
    expect(second.trimStart).toBeCloseTo(0.2, 9);
  });
});

describe('the anchors a frame keeps', () => {
  it('drops a crossfade helper\'s anchor once the crossfade is over, and tracks that are gone', () => {
    const sources = new ShowClipSources({ now: () => 0 });
    const vt = track('t', 'A', [clip('v1', 0, 4), clip('v2', 4, 4, { media: video('two.mp4'), transitionIn: 'dissolve', transitionDuration: 2 })]);
    const other = track('u', 'B', [clip('w', 0, 8, { media: video('w.mp4') })]);
    const during = frameAt([vt, other], 3.5);
    buildShowTrackScene([layer('A'), layer('B')], during, contextFor(sources, during));
    sources.retainFrame(during);
    expect(sources.xfadeAnchorFor('t')).not.toBeNull();
    const after = frameAt([vt], 6);
    sources.retainFrame(after);
    expect(sources.xfadeAnchorFor('t')).toBeNull();
    expect(sources.anchorFor('u')).toBeNull();
    expect(sources.anchorFor('t')).not.toBeNull();
  });
});
