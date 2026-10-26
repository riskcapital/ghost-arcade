import { describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import {
  adoptLiveVideo,
  buildPlaybackState,
  collectLiveVideos,
  expectedVideoTime,
  playbackSignature,
  sampleVideoClocks,
  unadoptedVideos,
  videoClockSeekTarget,
  VIDEO_CLOCK_COOLDOWN_MS,
  type VideoClockSample,
} from './playbackSync';
import { layerSequencer } from '../stores/layerSequencer';
import { keyframeTimeline } from '../stores/keyframeTimeline';

const seqPlaying = { isPlaying: true, currentStep: 3, opacityOverrides: { a: 1, b: 0 } };
const kfPaused = { config: { isPlaying: false, currentTime: 4.2 }, activeOverrides: { a: { 'layer:opacity': 0.5 } } };

describe('playback state', () => {
  it('carries the sequencer step and opacities', () => {
    const state = buildPlaybackState(seqPlaying, kfPaused);
    expect(state.seq).toEqual({ isPlaying: true, currentStep: 3, opacityOverrides: { a: 1, b: 0 } });
  });

  it('carries keyframe overrides only while the timeline plays', () => {
    expect(buildPlaybackState(seqPlaying, kfPaused).kf.activeOverrides).toEqual({});
    const playing = { ...kfPaused, config: { isPlaying: true, currentTime: 4.2 } };
    expect(buildPlaybackState(seqPlaying, playing).kf.activeOverrides).toEqual({ a: { 'layer:opacity': 0.5 } });
  });

  it('ignores a moving keyframe playhead that changes nothing on screen', () => {
    const at = (t: number) => buildPlaybackState(seqPlaying, { config: { isPlaying: true, currentTime: t }, activeOverrides: {} });
    expect(playbackSignature(at(1))).toBe(playbackSignature(at(2)));
    const keyed = (t: number) => buildPlaybackState(seqPlaying, { config: { isPlaying: true, currentTime: t }, activeOverrides: { a: { x: t } } });
    expect(playbackSignature(keyed(1))).not.toBe(playbackSignature(keyed(2)));
  });

  it('is applied in an output window without starting its own transport', () => {
    layerSequencer.applyRemotePlayback({ isPlaying: true, currentStep: 2, opacityOverrides: { a: 0.25 } });
    const seq = get(layerSequencer);
    expect(seq.isPlaying).toBe(true);
    expect(seq.currentStep).toBe(2);
    expect(seq.opacityOverrides).toEqual({ a: 0.25 });

    keyframeTimeline.applyRemotePlayback({ isPlaying: true, currentTime: 7, activeOverrides: { a: { 'layer:opacity': 0.1 } } });
    const kf = get(keyframeTimeline);
    expect(kf.config.isPlaying).toBe(true);
    expect(kf.config.currentTime).toBe(7);
    expect(kf.activeOverrides).toEqual({ a: { 'layer:opacity': 0.1 } });

    // A project import stops the sequencer; the next remote state restores it.
    layerSequencer.hydrate({ pattern: { steps: [{ activeLayers: {} }, { activeLayers: {} }, { activeLayers: {} }], stepCount: 3 } });
    expect(get(layerSequencer).isPlaying).toBe(false);
    layerSequencer.applyRemotePlayback({ isPlaying: true, currentStep: 9, opacityOverrides: {} });
    expect(get(layerSequencer).currentStep).toBe(2); // clamped to the pattern
  });
});

describe('video clocks', () => {
  const video = (currentTime: number, paused = false) => ({ currentTime, playbackRate: 1, paused, readyState: 4 });

  it('samples loaded videos only', () => {
    const samples = sampleVideoClocks([
      { id: 'a', source: { type: 'video', videoElement: video(3) } },
      { id: 'b', source: { type: 'video', videoElement: { ...video(1), readyState: 0 } } },
      { id: 'c', source: { type: 'image' } },
    ], 1000);
    expect(samples).toEqual([{ id: 'a', time: 3, rate: 1, paused: false, sentAt: 1000 }]);
  });

  const sample = (time: number, sentAt: number, paused = false): VideoClockSample => ({ id: 'a', time, rate: 1, paused, sentAt });

  it('extrapolates a playing editor video and wraps it inside the trim range', () => {
    expect(expectedVideoTime(sample(5, 0), 500, 0, 10)).toBeCloseTo(5.5);
    expect(expectedVideoTime(sample(9.8, 0), 500, 2, 10)).toBeCloseTo(2.3);
    expect(expectedVideoTime(sample(5, 0, true), 500, 0, 10)).toBe(5);
  });

  const check = (elementTime: number, extra: Partial<Parameters<typeof videoClockSeekTarget>[0]> = {}) => videoClockSeekTarget({
    sample: sample(5, 1000),
    nowMs: 1000,
    elementTime,
    seeking: false,
    rangeStart: 0,
    rangeEnd: 10,
    lastSeekAtMs: null,
    ...extra,
  });

  it('leaves a video within 100 ms alone', () => {
    expect(check(5.05)).toBeNull();
    expect(check(4.95)).toBeNull();
  });

  it('moves a video that drifted, or restarted from zero, to the editor time', () => {
    expect(check(5.4)).toBeCloseTo(5);
    expect(check(0)).toBeCloseTo(5);
  });

  it('does not count a loop wrap as drift', () => {
    const r = videoClockSeekTarget({
      sample: sample(9.97, 1000), nowMs: 1000, elementTime: 0.02, seeking: false,
      rangeStart: 0, rangeEnd: 10, lastSeekAtMs: null,
    });
    expect(r).toBeNull();
  });

  it('waits for a seek to land, and ignores stale samples', () => {
    expect(check(0, { seeking: true })).toBeNull();
    expect(check(0, { lastSeekAtMs: 1000 - VIDEO_CLOCK_COOLDOWN_MS / 2 })).toBeNull();
    expect(check(0, { nowMs: 5000 })).toBeNull();
  });
});

describe('reusing live videos across imports', () => {
  it('keeps the element for the same layer and file, and releases the rest', () => {
    const elA = { name: 'A' };
    const elB = { name: 'B' };
    const live = collectLiveVideos([
      { id: 'one', source: { type: 'video', src: 'ghost-asset:///a.mp4', videoElement: elA, isPlaying: true } },
      { id: 'two', source: { type: 'video', src: 'ghost-asset:///b.mp4', videoElement: elB } },
      { id: 'three', source: { type: 'image', src: 'x.png' } },
    ]);
    const adopted = new Set<object>();

    const same: any = { type: 'video', src: 'ghost-asset:///a.mp4' };
    const took = adoptLiveVideo('one', same, live);
    expect(took).toBe(elA);
    expect(same.videoElement).toBe(elA);
    expect(same.isPlaying).toBe(true);
    adopted.add(took!);

    // Layer two now shows another file: it gets a new element.
    const changed: any = { type: 'video', src: 'ghost-asset:///c.mp4' };
    expect(adoptLiveVideo('two', changed, live)).toBeNull();
    expect(changed.videoElement).toBeUndefined();

    expect(unadoptedVideos(live, adopted)).toEqual([elB]);
  });
});
