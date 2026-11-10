import { describe, expect, it } from 'vitest';
import type { Layer, ShowClipMedia, ShowLayerClip, ShowLayerTrack } from '../../types';
import { evaluateShowTracks, type ShowTrackFrame } from './showTrackEval';
import { buildShowTrackScene, SHOW_WARM_LAYER_PREFIX, showTrackLayerId } from './showTrackScene';
import { predictedMediaTime, ShowClipSources, SHOW_MANUAL_REANCHOR_SECONDS } from './showClipSources';
import { selectShowPreloads } from './showPreloader';
import { projectMediaTime, showPhaseCommands, showPhaseTargets, SHOW_PHASE_MAX_PROJECTION_SECONDS } from './showVideoPhase';

const video = (name = 'ramp.mp4', sourceDuration = 10): ShowClipMedia => ({
  kind: 'video', name, src: `ghost-asset://localhost/clips/${name}`, sourceDuration,
});
const shader: ShowClipMedia = { kind: 'shader', name: 'Solid', src: 'ISF/Solid.fs', shaderCode: 'void main(){}', shaderValues: { a: 1 } };

function clip(id: string, startTime: number, duration: number, extra: Partial<ShowLayerClip> = {}): ShowLayerClip {
  return { id, startTime, duration, media: video(), inPoint: 0, endBehaviour: 'loop', fadeIn: 0, fadeOut: 0, ...extra };
}

function layer(id: string, extra: Partial<Layer> = {}): Layer {
  return { id, name: id, type: 'media', visible: true, opacity: 1, source: { id: `own-${id}`, type: 'image', src: '/own.png', name: 'own' }, ...extra } as unknown as Layer;
}

function track(id: string, layerId: string, clips: ShowLayerClip[], extra: Partial<ShowLayerTrack> = {}): ShowLayerTrack {
  return { id, layerId, layerName: layerId, template: layer(layerId, { surfaceId: layerId }), clips, lanes: [], gap: 'layer', muted: false, locked: false, collapsed: false, ...extra };
}

function frameAt(tracks: ShowLayerTrack[], t: number, extra: Partial<{ playing: boolean; seekGeneration: number; manualClock: boolean; soloTrackId: string }> = {}): ShowTrackFrame {
  return evaluateShowTracks(tracks, t, { playing: true, seekGeneration: 1, ...extra });
}

function build(live: Layer[], frame: ShowTrackFrame, sources = new ShowClipSources({ now: () => 1000 })) {
  return buildShowTrackScene(live, frame, {
    sourceFor: (st) => sources.sourceFor(st, frame),
    warmSourceFor: (w) => sources.warmSourceFor(w),
  });
}

describe('building the scene from layer tracks', () => {
  const live = [layer('A'), layer('B')];

  it('drives an on-stage layer in place, keeping its position in the stack', () => {
    const out = build(live, frameAt([track('t', 'B', [clip('c', 0, 5)])], 1));
    expect(out.map((l) => l.id)).toEqual(['A', 'B']);
    expect(out[0]).toBe(live[0]);
    expect(out[1].source).toMatchObject({ id: 'show:c', type: 'video', isPlaying: true });
    expect(live[1].source!.id).toBe('own-B');
  });

  it('injects a copy for an off-stage layer above the stage, only while a clip plays', () => {
    const tracks = [track('t', 'X', [clip('c', 2, 5)])];
    const during = build(live, frameAt(tracks, 3));
    expect(during.map((l) => l.id)).toEqual([showTrackLayerId('X'), 'A', 'B']);
    expect(during[0].source!.id).toBe('show:c');
    const gap = build(live, frameAt(tracks, 1));
    expect(gap).toBe(live);
  });

  it('passes the layer through in a gap, or hides it', () => {
    const passing = build(live, frameAt([track('t', 'A', [clip('c', 5, 1)])], 1));
    expect(passing).toBe(live);
    const hiding = build(live, frameAt([track('t', 'A', [clip('c', 5, 1)], { gap: 'hide' })], 1));
    expect(hiding[0]._showOpacityMul).toBe(0);
    expect(hiding[0].source!.id).toBe('own-A');
  });

  it('applies fades and clip opacity as a multiplier, never touching opacity itself', () => {
    const out = build(live, frameAt([track('t', 'A', [clip('c', 0, 10, { fadeIn: 2, opacity: 0.5 })])], 1));
    expect(out[0]._showOpacityMul).toBeCloseTo(0.25, 9);
    expect(out[0].opacity).toBe(1);
  });

  it('hides muted and soloed-out tracks', () => {
    const tracks = [track('t1', 'A', [clip('a', 0, 5)]), track('t2', 'B', [clip('b', 0, 5)])];
    const muted = build(live, frameAt([{ ...tracks[0], muted: true }], 1));
    expect(muted[0]._showOpacityMul).toBe(0);
    const solo = build(live, frameAt(tracks, 1, { soloTrackId: 't2' }));
    expect(solo[0]._showOpacityMul).toBe(0);
    expect(solo[1]._showOpacityMul).toBeUndefined();
  });

  it('keeps the layer\'s own content for a layer clip', () => {
    const out = build(live, frameAt([track('t', 'A', [clip('c', 0, 4, { media: { kind: 'layer', name: 'A', src: '' }, fadeOut: 2 })])], 3));
    expect(out[0].source!.id).toBe('own-A');
    expect(out[0]._showOpacityMul).toBeCloseTo(0.5, 9);
  });

  it('respects the scene layer cap for injected copies', () => {
    const tracks = [track('t1', 'X', [clip('a', 0, 5)]), track('t2', 'Y', [clip('b', 0, 5)])];
    const out = buildShowTrackScene(live, frameAt(tracks, 1), { sourceFor: () => null, maxLayers: 3 });
    expect(out.map((l) => l.id)).toEqual([showTrackLayerId('X'), 'A', 'B']);
  });

  it('warms an upcoming shader clip invisibly with the source it will go live with', () => {
    const sources = new ShowClipSources({ now: () => 0 });
    const tracks = [track('t', 'A', [clip('s', 5, 5, { media: shader })])];
    const before = build(live, frameAt(tracks, 4.5), sources);
    const warm = before.find((l) => l.id === SHOW_WARM_LAYER_PREFIX + 'A')!;
    expect(warm.opacity).toBe(0);
    const after = build(live, frameAt(tracks, 5.1), sources);
    expect(after.find((l) => l.id === 'A')!.source).toBe(warm.source);
    expect(after.some((l) => l.id.startsWith(SHOW_WARM_LAYER_PREFIX))).toBe(false);
    // Too early to warm.
    expect(build(live, frameAt(tracks, 3), sources)).toBe(live);
  });
});

describe('video anchors', () => {
  let clock = 0;
  const sources = () => new ShowClipSources({ now: () => clock });
  const tr = (clips: ShowLayerClip[]) => [track('t', 'A', clips)];

  it('anchors when a clip starts and then leaves the source alone while playing', () => {
    const s = sources();
    const tracks = tr([clip('c', 2, 8, { inPoint: 1 })]);
    const f1 = frameAt(tracks, 2.5);
    const a = s.sourceFor(f1.tracks[0], f1)!;
    expect(a).toMatchObject({ _nativePlaybackTimeSeconds: 1.5, _nativePlaybackSeekSeq: 1, isPlaying: true, playbackMode: 'loop' });
    const f2 = frameAt(tracks, 4);
    expect(s.sourceFor(f2.tracks[0], f2)).toBe(a);
  });

  it('re-anchors on a new seek generation, and on pause and resume', () => {
    const s = sources();
    const tracks = tr([clip('c', 0, 8)]);
    const f1 = frameAt(tracks, 1);
    const a = s.sourceFor(f1.tracks[0], f1)!;
    const seek = frameAt(tracks, 5, { seekGeneration: 2 });
    const b = s.sourceFor(seek.tracks[0], seek)!;
    expect(b).not.toBe(a);
    expect(b).toMatchObject({ _nativePlaybackTimeSeconds: 5, _nativePlaybackSeekSeq: 2 });
    const paused = frameAt(tracks, 5.5, { seekGeneration: 2, playing: false });
    const c = s.sourceFor(paused.tracks[0], paused)!;
    expect(c).toMatchObject({ isPlaying: false, _nativePlaybackTimeSeconds: 5.5, _nativePlaybackSeekSeq: 3 });
  });

  it('pauses a hold clip at its end', () => {
    const s = sources();
    const tracks = tr([clip('c', 0, 20, { endBehaviour: 'hold' })]);
    const f = frameAt(tracks, 15);
    expect(s.sourceFor(f.tracks[0], f)).toMatchObject({ isPlaying: false, _nativePlaybackTimeSeconds: 10 - 1 / 30 });
  });

  it('keeps one decoder across a split (same source id, no new anchor)', () => {
    const s = sources();
    // What splitClip leaves: the right half keeps the loop range.
    const tracks = tr([clip('a', 0, 3), clip('b', 3, 3, { inPoint: 3, loopStart: 0 })]);
    const f1 = frameAt(tracks, 2);
    const first = s.sourceFor(f1.tracks[0], f1)!;
    const f2 = frameAt(tracks, 4);
    expect(s.sourceFor(f2.tracks[0], f2)).toBe(first);
    expect(first.id).toBe('show:a');
  });

  it('trims a looping source to the loop range so the core wraps it the same way', () => {
    const s = sources();
    const tracks = tr([clip('c', 0, 30, { inPoint: 2 })]);
    const f = frameAt(tracks, 1);
    expect(s.sourceFor(f.tracks[0], f)).toMatchObject({ trimStart: 0.2, trimEnd: 1, durationSeconds: 10 });
    expect(predictedMediaTime({ mediaTime: 3, showTime: 1, paused: false, rate: 1, loopStart: 2, duration: 10 }, 9)).toBeCloseTo(3, 9);
  });

  it('under an offline render re-anchors only past half a frame of drift', () => {
    const s = sources();
    const tracks = tr([clip('c', 0, 8)]);
    const f1 = frameAt(tracks, 1, { manualClock: true, seekGeneration: 10 });
    const a = s.sourceFor(f1.tracks[0], f1)!;
    // Every export frame is a seek; the anchor still predicts it exactly.
    for (let i = 1; i < 30; i++) {
      const f = frameAt(tracks, 1 + i / 30, { manualClock: true, seekGeneration: 10 + i });
      expect(s.sourceFor(f.tracks[0], f)).toBe(a);
    }
    // A jump the anchor already predicts (same linear clip) needs no seek…
    const jump = frameAt(tracks, 6, { manualClock: true, seekGeneration: 99 });
    expect(s.sourceFor(jump.tracks[0], jump)).toBe(a);
    // …one it does not (the media was moved under it) does.
    const moved = [track('t', 'A', [clip('c', 0, 8, { inPoint: 2 })])];
    const f = frameAt(moved, 6.1, { manualClock: true, seekGeneration: 100 });
    const b = s.sourceFor(f.tracks[0], f)!;
    expect(b).not.toBe(a);
    expect(b._nativePlaybackTimeSeconds).toBeCloseTo(8.1, 9);
    expect(SHOW_MANUAL_REANCHOR_SECONDS).toBeLessThan(1 / 60);
  });

  it('routes a paused scrub through the scrubber and takes its anchor', () => {
    const s = sources();
    const seeks: number[] = [];
    s.scrubHandler = (_t, _src, time, commit) => {
      seeks.push(time);
      commit({ _nativePlaybackTimeSeconds: time, _nativePlaybackUpdatedAtMs: 5, _nativePlaybackSeekSeq: 7 });
      return true;
    };
    const tracks = tr([clip('c', 0, 8)]);
    const p1 = frameAt(tracks, 1, { playing: false, seekGeneration: 1 });
    s.sourceFor(p1.tracks[0], p1);
    const p2 = frameAt(tracks, 2, { playing: false, seekGeneration: 2 });
    const out = s.sourceFor(p2.tracks[0], p2)!;
    expect(seeks).toEqual([2]);
    expect(out).toMatchObject({ _nativePlaybackTimeSeconds: 2, _nativePlaybackSeekSeq: 7 });
    // The next fresh anchor for that source moves past the scrubber's generation.
    expect(s.nextSeekSeqFor('show:c')).toBe(8);
  });
});

describe('phase follower and preloader', () => {
  it('targets every playing video clip, and releases what stopped', () => {
    const s = new ShowClipSources({ now: () => 0 });
    const tracks = [track('t', 'A', [clip('c', 0, 8)])];
    const f = frameAt(tracks, 2);
    s.sourceFor(f.tracks[0], f);
    const targets = showPhaseTargets(f, s);
    expect(targets).toEqual([{ sourceId: 'show:c', uri: 'ghost-asset://localhost/clips/ramp.mp4', seekGeneration: 1, timeSeconds: 2 }]);
    const first = showPhaseCommands(targets, new Set());
    expect(first.commands).toHaveLength(1);
    const stopped = showPhaseCommands(showPhaseTargets(frameAt(tracks, 2, { playing: false }), s), first.following);
    expect(stopped.commands).toEqual([{ type: 'set_media_source_phase', source_id: 'show:c', enabled: false }]);
    expect(showPhaseTargets(frameAt(tracks, 2, { manualClock: true }), s)).toEqual([]);
  });

  it('picks video and image clips starting soon, skipping run continuations', () => {
    const tracks = [
      track('t1', 'A', [clip('a', 0, 3), clip('b', 3, 3, { inPoint: 3, loopStart: 0 }), clip('c', 7, 2), clip('far', 20, 2)]),
      track('t2', 'B', [clip('img', 2, 2, { media: { kind: 'image', name: 'i', src: '/i.png' } }), clip('sh', 4, 1, { media: shader })]),
      track('t3', 'C', [clip('m', 2, 2)], { muted: true }),
    ];
    const picks = selectShowPreloads(tracks, 1);
    expect(picks.map((p) => p.clip.id)).toEqual(['img']);
    expect(selectShowPreloads(tracks, 3.5).map((p) => p.clip.id)).toEqual(['c']);
    expect(selectShowPreloads(tracks, 1, { horizonSeconds: 10 }).map((p) => p.clip.id)).toEqual(['img', 'c']);
  });
});

describe('phase targets are projected to when they are sent', () => {
  it('moves the target on by the frame age, at the clip rate, wrapping past the end', () => {
    const s = new ShowClipSources({ now: () => 0 });
    const tracks = [track('t', 'A', [clip('c', 0, 60, { rate: 2 })])];
    const f = evaluateShowTracks(tracks, 2, { playing: true, seekGeneration: 1, evaluatedAtMs: 1000 });
    expect(f.evaluatedAtMs).toBe(1000);
    s.sourceFor(f.tracks[0], f);
    expect(showPhaseTargets(f, s, 1016)[0].timeSeconds).toBeCloseTo(4.032, 9);
    // No clock to project with, or a reader that is behind the frame: as is.
    expect(showPhaseTargets(f, s)[0].timeSeconds).toBe(4);
    expect(showPhaseTargets(f, s, 990)[0].timeSeconds).toBe(4);
    // A stalled show is not projected further than SHOW_PHASE_MAX_PROJECTION_SECONDS.
    expect(showPhaseTargets(f, s, 6000)[0].timeSeconds).toBeCloseTo(4 + 2 * SHOW_PHASE_MAX_PROJECTION_SECONDS, 9);
  });

  it('wraps like the core loops a trimmed source', () => {
    expect(projectMediaTime(9.99, 0.02, 1, 2, 10)).toBeCloseTo(2.01, 9);
    expect(projectMediaTime(5, 0.02, 1, 2, 10)).toBeCloseTo(5.02, 9);
    expect(projectMediaTime(9.99, 0.02, 1, 0)).toBeCloseTo(10.01, 9);
  });
});
