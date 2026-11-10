/**
 * The show store's side of the layer-track engine: reopening a show, the
 * loop wrap, track templates (refresh, AssetRefs) and measured clip lengths.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import type { Layer, ShowClipMedia } from '../types';
import {
  setShowAudioClockReader,
  setShowCompositionLoader,
  setShowTemplateLayerSource,
  setShowTrackFrameSink,
  showTimeline,
  trackTemplateFromLayer,
} from './showTimeline';
import { ShowClipSources } from '../show/tracks/showClipSources';
import type { ShowTrackFrame } from '../show/tracks/showTrackEval';

const video = (name = 'ramp.mp4', sourceDuration = 10): ShowClipMedia => ({
  kind: 'video',
  name,
  src: `ghost-asset://localhost/clips/${name}`,
  _assetRef: { kind: 'local-file', originalPath: `/clips/${name}`, name },
  ...(sourceDuration > 0 ? { sourceDuration } : {}),
});

const wall = { id: 'L1', name: 'Wall', type: 'media', visible: true, opacity: 1, source: null } as unknown as Layer;

let frames: Array<ShowTrackFrame | null>;
let rafs: Array<(now: number) => void>;
let nowMs: number;

function step(ms: number) {
  nowMs += ms;
  const pending = rafs;
  rafs = [];
  for (const cb of pending) cb(nowMs);
}

beforeEach(() => {
  showTimeline._resetForTest();
  setShowCompositionLoader(() => {});
  setShowAudioClockReader(() => null);
  frames = [];
  rafs = [];
  nowMs = 1000;
  vi.stubGlobal('requestAnimationFrame', (cb: (now: number) => void) => { rafs.push(cb); return rafs.length; });
  vi.stubGlobal('cancelAnimationFrame', () => { rafs = []; });
  setShowTrackFrameSink((f) => frames.push(f));
});

afterEach(() => {
  setShowTrackFrameSink(null);
  setShowCompositionLoader(null);
  setShowTemplateLayerSource(null);
  showTimeline._resetForTest();
  vi.unstubAllGlobals();
});

/** What Canvas does with every published frame: ask for the track's source. */
function sourceOf(sources: ShowClipSources, frame: ShowTrackFrame | null) {
  const state = frame!.tracks[0];
  return sources.sourceFor(state, frame!)!;
}

describe('reopening a show', () => {
  it('does not show the paused frame the last show left', () => {
    const t = showTimeline.addLayerTrack(wall);
    showTimeline.addLayerClip(t, video('long.mp4', 60), 0, { duration: 60 });
    const saved = JSON.parse(JSON.stringify(showTimeline.serialize()));
    const sources = new ShowClipSources({ now: () => 0 });
    showTimeline.seek(37);
    expect(sourceOf(sources, frames.at(-1)!)._nativePlaybackTimeSeconds).toBe(37);
    // Open the same project again: the playhead is back at 0.
    showTimeline.hydrate(saved, '/project');
    const reopened = sourceOf(sources, frames.at(-1)!);
    expect(reopened._nativePlaybackTimeSeconds).toBe(0);
  });

  it('a cleared show starts every video afresh too', () => {
    const before = showTimeline.seekGeneration();
    showTimeline.clear();
    expect(showTimeline.seekGeneration()).toBeGreaterThan(before);
    const again = showTimeline.seekGeneration();
    showTimeline.hydrate(null);
    expect(showTimeline.seekGeneration()).toBeGreaterThan(again);
  });
});

describe('the loop wrap', () => {
  function loopShow(mediaSeconds: number) {
    const t = showTimeline.addLayerTrack(wall);
    showTimeline.addLayerClip(t, video('bg.mp4', mediaSeconds), 0, { duration: 10, endBehaviour: 'loop' });
    showTimeline.setLoop(true);
    showTimeline.play();
    step(16);
  }

  it('leaves a video that loops with the show on its decoder', () => {
    loopShow(10);
    const sources = new ShowClipSources({ now: () => 0 });
    const first = sourceOf(sources, frames.at(-1)!);
    step(9990);
    for (let i = 0; i < 3; i++) step(16);
    const last = frames.at(-1)!;
    expect(last.time).toBeLessThan(1);
    expect(last.wrap).toMatchObject({ shift: 10 });
    expect(sourceOf(sources, last)).toBe(first);
  });

  it('seeks one that does not', () => {
    loopShow(30);
    const sources = new ShowClipSources({ now: () => 0 });
    const first = sourceOf(sources, frames.at(-1)!);
    step(9990);
    for (let i = 0; i < 3; i++) step(16);
    const after = sourceOf(sources, frames.at(-1)!);
    expect(after._nativePlaybackSeekSeq).toBe(first._nativePlaybackSeekSeq! + 1);
  });

  it('a seek is never taken for a wrap', () => {
    loopShow(10);
    const sources = new ShowClipSources({ now: () => 0 });
    const first = sourceOf(sources, frames.at(-1)!);
    showTimeline.seek(9.99);
    showTimeline.seek(0.01);
    expect(frames.at(-1)!.wrap).toBeUndefined();
    expect(sourceOf(sources, frames.at(-1)!)._nativePlaybackSeekSeq).toBe(first._nativePlaybackSeekSeq! + 1);
  });
});

describe('track templates', () => {
  it('keep the AssetRefs of a splat texture and a PixelFX source', () => {
    const textureRef = { kind: 'local-file', originalPath: '/media/tex.png', name: 'tex.png' };
    const sourceRef = { kind: 'local-file', originalPath: '/media/px.mp4', name: 'px.mp4' };
    const layer = {
      ...wall,
      _showOpacityMul: 0.5,
      splatContent: { texturePath: 'blob:dead', _textureAssetRef: textureRef, texture: { gpu: true } },
      pixelFXContent: { sourceUrl: 'blob:gone', _sourceAssetRef: sourceRef, _runtime: 1 },
    } as unknown as Layer;
    const template = trackTemplateFromLayer(layer) as any;
    expect(template._showOpacityMul).toBeUndefined();
    expect(template.splatContent.texture).toBeUndefined();
    expect(template.pixelFXContent._runtime).toBeUndefined();
    expect(template.splatContent._textureAssetRef).toEqual(textureRef);
    expect(template.pixelFXContent._sourceAssetRef).toEqual(sourceRef);
    // And they survive a save and reopen, resolved to the files again.
    showTimeline.addLayerTrack(layer);
    const saved = JSON.parse(JSON.stringify(showTimeline.serialize()));
    showTimeline._resetForTest();
    showTimeline.hydrate(saved, '/project');
    const reopened = get(showTimeline).layerTracks[0].template as any;
    expect(reopened.splatContent._textureAssetRef).toEqual(textureRef);
    expect(reopened.splatContent.texturePath).toMatch(/media\/tex\.png$/);
    expect(reopened.pixelFXContent.sourceUrl).toMatch(/media\/px\.mp4$/);
  });

  it('are saved as the layer is now, not as the last refresh left them', () => {
    showTimeline.addLayerTrack(wall);
    const edited = { ...wall, opacity: 0.4, name: 'Wall left' } as Layer;
    setShowTemplateLayerSource(() => [edited]);
    const saved = showTimeline.serialize();
    expect(saved.layerTracks![0].template!.opacity).toBe(0.4);
    expect(saved.layerTracks![0].layerName).toBe('Wall left');
  });
});

describe('measured clip lengths', () => {
  it('fill in every clip of the file that had none, as part of the step they are in', () => {
    const t = showTimeline.addLayerTrack(wall);
    showTimeline.addLayerClip(t, video('x.mp4', 0), 0, { duration: 5 });
    showTimeline.addLayerClip(t, video('x.mp4', 0), 5, { duration: 30, endBehaviour: 'stop' });
    showTimeline.addLayerClip(t, video('y.mp4', 0), 35, { duration: 5 });
    const uriOf = (m: ShowClipMedia) => m.src;
    showTimeline.applyClipMediaLength('ghost-asset://localhost/clips/x.mp4', 12, uriOf);
    const clips = get(showTimeline).layerTracks[0].clips;
    expect(clips.map((c) => c.media.sourceDuration)).toEqual([12, 12, undefined]);
    // The 'stop' clip now holds at the end of its media instead of looping.
    showTimeline.seek(5 + 20);
    expect(frames.at(-1)!.tracks[0].clip!.held).toBe(true);
  });
});

describe('the arrangement an undo step holds', () => {
  it('round-trips layer tracks, lanes, crossfades, tempo and the camera lane', () => {
    const t = showTimeline.addLayerTrack(wall);
    showTimeline.addLayerClip(t, video('a.mp4'), 0, { duration: 4, fadeIn: 0.5 });
    showTimeline.addLayerClip(t, video('b.mp4'), 4, { duration: 4, transitionIn: 'dissolve', transitionDuration: 1, rate: 1.5, loopStart: 1 });
    showTimeline.addTrackLane(t, { key: 'layer:opacity', label: 'Opacity', type: 'number' });
    showTimeline.setLaneKey(t, 'layer:opacity', 2, 0.25);
    showTimeline.setTempo({ offset: 0.1, segments: [{ bar: 1, bpm: 124, beatsPerBar: 4, beatUnit: 4 }], source: 'manual' });
    showTimeline.setCameraLane([{ id: 'cam', startTime: 0, duration: 6, shotId: 'wide' }]);
    const before = showTimeline.exportArrangement();
    const copy = JSON.parse(JSON.stringify(before));
    showTimeline.clear();
    showTimeline.restoreArrangement(copy);
    const after = showTimeline.exportArrangement();
    expect(JSON.parse(JSON.stringify(after))).toEqual(copy);
    expect(get(showTimeline).duration).toBe(8);
  });
});
