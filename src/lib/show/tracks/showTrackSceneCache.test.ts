/**
 * The show scene while a show plays: a frame that only moves the values the
 * driven layers carry reuses the last scene with those values, and the result
 * is what a full build gives; anything else builds afresh. And the frame
 * signature: a fade publishes once per visible step, never past an end.
 */
import { describe, expect, it } from 'vitest';
import type { KeyframeTrack, Layer, ShowClipMedia, ShowLayerClip, ShowLayerTrack } from '../../types';
import { evaluateShowTracks, showTrackFrameSignature, type ShowTrackFrame } from './showTrackEval';
import { buildShowTrackScene, ShowTrackSceneCache, showTrackSceneShape, type ShowTrackSceneContext } from './showTrackScene';
import { ShowClipSources } from './showClipSources';
import { evaluateLanes } from './showTrackLanes';

const video = (name: string, sourceDuration = 10): ShowClipMedia => ({ kind: 'video', name, src: `ghost-asset://localhost/clips/${name}`, sourceDuration });
const image = (name: string): ShowClipMedia => ({ kind: 'image', name, src: `/img/${name}` });
const shader = (name: string): ShowClipMedia => ({ kind: 'shader', name, src: `/isf/${name}.fs`, shaderCode: 'void main(){}', shaderValues: {} } as ShowClipMedia);

function clip(id: string, startTime: number, duration: number, media: ShowClipMedia, extra: Partial<ShowLayerClip> = {}): ShowLayerClip {
  return { id, startTime, duration, media, inPoint: 0, endBehaviour: 'loop', fadeIn: 0, fadeOut: 0, ...extra };
}

function layer(id: string, extra: Partial<Layer> = {}): Layer {
  return { id, name: id, type: 'media', visible: true, opacity: 1, effects: [], source: { id: `own-${id}`, type: 'image', src: '/own.png', name: 'own' }, ...extra } as unknown as Layer;
}

function track(id: string, layerId: string, clips: ShowLayerClip[], lanes: KeyframeTrack[] = []): ShowLayerTrack {
  return { id, layerId, layerName: layerId, template: layer(layerId, { surfaceId: layerId }), clips, lanes, gap: 'layer', muted: false, locked: false, collapsed: false };
}

const lane = (key: string, keys: Array<[number, number]>): KeyframeTrack => ({
  key, label: key, type: 'number', keyframes: keys.map(([time, value]) => ({ time, value, easing: 'linear' as const })), boolKeyframes: [],
});

function frameAt(tracks: ShowLayerTrack[], t: number, seekGeneration = 1, playing = true): ShowTrackFrame {
  return evaluateShowTracks(tracks, t, { playing, seekGeneration, laneValues: (tr, time) => (tr.lanes.length ? evaluateLanes(tr.lanes, time) : null) });
}

function contextFor(sources: ShowClipSources, frame: ShowTrackFrame): ShowTrackSceneContext {
  return {
    sourceFor: (st) => sources.sourceFor(st, frame),
    xfadeSourceFor: (st) => sources.xfadeSourceFor(st, frame),
    warmSourceFor: (warm) => sources.warmSourceFor(warm),
  };
}

// On stage: A (video crossfades, a fade in, an opacity lane), B (images with a
// dissolve and a shader lane), C (a pass-through gap then a clip, a fade
// out). Off stage: D (injected copies crossfading, a shader warmed ahead).
const live = [layer('A'), layer('Z'), layer('B'), layer('C')];
const tracks = [
  track('ta', 'A', [
    clip('a1', 0, 4, video('one.mp4'), { fadeIn: 1 }),
    clip('a2', 4, 4, video('two.mp4'), { transitionIn: 'dissolve', transitionDuration: 2 }),
  ], [lane('layer:opacity', [[0, 0.3], [8, 1]])]),
  track('tb', 'B', [
    clip('b1', 0, 3, image('red.png')),
    clip('b2', 3, 5, image('blue.png'), { transitionIn: 'dissolve', transitionDuration: 1.5 }),
  ], [lane('shader:speed', [[0, 0], [8, 4]])]),
  track('tc', 'C', [clip('c1', 2, 6, image('green.png'), { fadeOut: 2 })]),
  track('td', 'D', [
    clip('d1', 0, 3, image('d1.png')),
    clip('d2', 3, 2, image('d2.png'), { transitionIn: 'dissolve', transitionDuration: 1 }),
    clip('d3', 6, 2, shader('Plasma')),
  ]),
];

describe('ShowTrackSceneCache', () => {
  it('gives what a full build gives, frame by frame, reusing the scene between changes of shape', () => {
    const cachedSources = new ShowClipSources({ now: () => 0 });
    const freshSources = new ShowClipSources({ now: () => 0 });
    const cache = new ShowTrackSceneCache();
    let reused = 0;
    let built = 0;
    let previous: Layer[] | null = null;
    for (let i = 0; i <= 480; i++) {
      const t = i / 60;
      const frame = frameAt(tracks, t);
      const prepared = cache.prepare(live, frame, contextFor(cachedSources, frame), [live]);
      let scene: Layer[];
      if (prepared.reusable) {
        scene = prepared.reuse();
        reused++;
        // Only the driven layers are new objects.
        const changed = scene.filter((l, k) => l !== previous![k]).map((l) => l.id);
        expect(changed.every((id) => /^(A|B|C|showtrack::D|showxf::[ABD])$/.test(id))).toBe(true);
      } else {
        scene = prepared.build(live.map((l) => ({ ...l })));
        prepared.commit(scene);
        built++;
      }
      const fresh = buildShowTrackScene(live.map((l) => ({ ...l })), frame, contextFor(freshSources, frame));
      expect(scene).toEqual(fresh);
      previous = scene;
    }
    // Most frames only move values.
    expect(reused).toBeGreaterThan(400);
    expect(built).toBeLessThan(60);
  });

  it('builds afresh when an input, a template, a source or the shape changes', () => {
    const sources = new ShowClipSources({ now: () => 0 });
    const cache = new ShowTrackSceneCache();
    const prime = (frame: ShowTrackFrame, deps: unknown[], list = live) => {
      const prepared = cache.prepare(list, frame, contextFor(sources, frame), deps);
      const scene = prepared.build(list.map((l) => ({ ...l })));
      prepared.commit(scene);
      return scene;
    };
    const reusable = (frame: ShowTrackFrame, deps: unknown[], list = live, ts = tracks) =>
      cache.prepare(list, frame, contextFor(sources, frame), deps).reusable;
    const deps = [live, 'surfaces'];
    prime(frameAt(tracks, 0.5), deps);
    expect(reusable(frameAt(tracks, 0.55), deps)).toBe(true);
    // Another input (the takeover, the map surfaces, the live layers).
    expect(reusable(frameAt(tracks, 0.6), [live, 'other'])).toBe(false);
    const otherLive = [...live];
    prime(frameAt(tracks, 0.6), [otherLive, 'surfaces'], otherLive);
    expect(reusable(frameAt(tracks, 0.65), [live, 'surfaces'])).toBe(false);
    // A refreshed template.
    prime(frameAt(tracks, 0.7), deps);
    const retemplated = tracks.map((tr) => (tr.id === 'td' ? { ...tr, template: layer('D', { surfaceId: 'D', opacity: 0.5 }) } : tr));
    expect(reusable(frameAt(retemplated, 0.75), deps)).toBe(false);
    // A seek: the video re-anchors, so its source changes.
    prime(frameAt(tracks, 0.8), deps);
    expect(reusable(frameAt(tracks, 0.85, 2), deps)).toBe(false);
    // The shape: a crossfade begins.
    prime(frameAt(tracks, 1.9, 2), deps);
    expect(reusable(frameAt(tracks, 2.1, 2), deps)).toBe(false);
  });

  it('shape ignores values but not the ends of a fade or the lane keys', () => {
    const a = frameAt(tracks, 0.5);
    const b = frameAt(tracks, 0.6);
    expect(a.tracks[0].opacity).not.toBe(b.tracks[0].opacity);
    expect(showTrackSceneShape(a)).toBe(showTrackSceneShape(b));
    const at = (frame: ShowTrackFrame, patch: Partial<ShowTrackFrame['tracks'][number]>) => ({ ...frame, tracks: [{ ...frame.tracks[0], ...patch }, ...frame.tracks.slice(1)] });
    expect(showTrackSceneShape(at(a, { opacity: 0 }))).not.toBe(showTrackSceneShape(a));
    expect(showTrackSceneShape(at(a, { opacity: 1 }))).not.toBe(showTrackSceneShape(a));
    expect(showTrackSceneShape(at(a, { params: { 'layer:opacity': 0.5, 'shader:x': 1 } }))).not.toBe(showTrackSceneShape(a));
  });
});

describe('showTrackFrameSignature', () => {
  const fade = [track('t', 'A', [clip('a', 0, 60, image('a.png'), { fadeIn: 30 })], [lane('shader:speed', [[0, 0], [60, 1]])])];

  it('publishes a slow fade once per visible step, and the exact lane values', () => {
    const fadeOnly = [track('t', 'A', [clip('a', 0, 60, image('a.png'), { fadeIn: 30 })])];
    let published = 0;
    let last = '';
    for (let i = 0; i < 600; i++) {
      const sig = showTrackFrameSignature(frameAt(fadeOnly, 5 + i / 60));
      if (sig !== last) published++;
      last = sig;
    }
    // 10 s of a 30 s fade: a third of 255 steps, not 600 frames.
    expect(published).toBeGreaterThan(80);
    expect(published).toBeLessThan(90);
    // Lane values other than opacity change the signature at float precision.
    expect(showTrackFrameSignature(frameAt(fade, 10))).not.toBe(showTrackFrameSignature(frameAt(fade, 10 + 1 / 60)));
  });

  it('always publishes reaching either end of a fade', () => {
    const at = (opacity: number) => {
      const frame = frameAt(fade, 10);
      return showTrackFrameSignature({ ...frame, tracks: [{ ...frame.tracks[0], opacity, params: null }] });
    };
    expect(at(0)).not.toBe(at(0.0001));
    expect(at(1)).not.toBe(at(0.9999));
    expect(at(0.5)).toBe(at(0.5005));
    expect(at(0.5)).not.toBe(at(0.505));
  });

  it('rounds an opacity lane to 8-bit steps like the clip opacity', () => {
    const lanes = [track('t', 'A', [clip('a', 0, 60, image('a.png'))], [lane('layer:opacity', [[0, 0], [60, 1]])])];
    expect(showTrackFrameSignature(frameAt(lanes, 30))).toBe(showTrackFrameSignature(frameAt(lanes, 30 + 1 / 60)));
    expect(showTrackFrameSignature(frameAt(lanes, 30))).not.toBe(showTrackFrameSignature(frameAt(lanes, 30.5)));
  });
});
