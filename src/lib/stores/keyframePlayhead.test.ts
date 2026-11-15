/**
 * The keyframe transport with no keyframes: playing moves only the
 * playhead, so the store (read by the renderer and much of the UI) does not
 * publish at all, and only `keyframePlayhead` (the views that show the
 * time) publishes it, ten times a second. With keyframes the store publishes
 * the values every frame as before.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { keyframePlayhead, keyframeTimeline } from './keyframeTimeline';

let clock = 0;
let queue: Array<{ id: number; cb: (t: number) => void }> = [];
let nextId = 1;

function frames(count: number, ms = 1000 / 60) {
  for (let i = 0; i < count; i++) {
    clock += ms;
    const due = queue;
    queue = [];
    for (const f of due) f.cb(clock);
  }
}

function counter(store: { subscribe: (fn: (v: unknown) => void) => () => void }) {
  let n = -1;
  const stop = store.subscribe(() => { n++; });
  return { get count() { return n; }, stop };
}

beforeEach(() => {
  clock = 0;
  queue = [];
  (globalThis as any).requestAnimationFrame = (cb: (t: number) => void) => {
    const id = nextId++;
    queue.push({ id, cb });
    return id;
  };
  (globalThis as any).cancelAnimationFrame = (id: number) => { queue = queue.filter((f) => f.id !== id); };
  keyframeTimeline.reset();
  keyframeTimeline.setDuration(30);
  keyframeTimeline.setLooping(true);
});

afterEach(() => {
  keyframeTimeline.reset();
});

describe('keyframe transport with no keyframes', () => {
  it('publishes nothing from the store while it plays, and the playhead ten times a second', () => {
    keyframeTimeline.play();
    const store = counter(keyframeTimeline);
    const playhead = counter(keyframePlayhead);
    frames(1); // the first frame starts the clock
    frames(120); // 2 s
    expect(store.count).toBe(0);
    expect(playhead.count).toBeGreaterThanOrEqual(18);
    expect(playhead.count).toBeLessThanOrEqual(21);
    // The time is right whenever it is asked for.
    expect(keyframeTimeline.currentTime()).toBeCloseTo(2, 3);
    expect(get(keyframePlayhead)).toBeGreaterThan(1.85);
    store.stop(); playhead.stop();
  });

  it('a track with no keyframes on it is still no keyframes', () => {
    keyframeTimeline.ensureTrack('layer-1', 'opacity', 'Opacity', 'number');
    keyframeTimeline.play();
    const store = counter(keyframeTimeline);
    frames(61);
    expect(store.count).toBe(0);
    store.stop();
  });

  it('pausing puts the real time in the store', () => {
    keyframeTimeline.play();
    frames(91);
    keyframeTimeline.pause();
    const s = get(keyframeTimeline);
    expect(s.config.isPlaying).toBe(false);
    expect(s.config.currentTime).toBeCloseTo(1.5, 3);
    expect(get(keyframePlayhead)).toBe(s.config.currentTime);
    // Paused: nothing moves.
    frames(30);
    expect(keyframeTimeline.currentTime()).toBe(s.config.currentTime);
  });

  it('any change while playing carries the real time, and a seek moves it', () => {
    keyframeTimeline.play();
    frames(31);
    keyframeTimeline.selectLayer('x');
    expect(get(keyframeTimeline).config.currentTime).toBeCloseTo(0.5, 3);
    keyframeTimeline.seek(10);
    expect(get(keyframePlayhead)).toBe(10);
    frames(60);
    expect(keyframeTimeline.currentTime()).toBeCloseTo(11, 3);
  });

  it('loops at the end, and a timeline that does not loop stops there once', () => {
    keyframeTimeline.setDuration(1);
    keyframeTimeline.play();
    frames(91);
    expect(keyframeTimeline.currentTime()).toBeCloseTo(0.5, 2);
    keyframeTimeline.setLooping(false);
    const store = counter(keyframeTimeline);
    frames(60);
    expect(store.count).toBe(1);
    expect(get(keyframeTimeline).config).toMatchObject({ isPlaying: false, currentTime: 1 });
    store.stop();
  });

  it('a keyframe recorded while it plays lands at the playhead', () => {
    keyframeTimeline.toggleArmed('layer-1', 'opacity');
    keyframeTimeline.play();
    frames(121);
    keyframeTimeline.autoRecord('layer-1', 'opacity', 0.4, 'Opacity', 'number');
    const track = keyframeTimeline.getTrack('layer-1', 'opacity')!;
    expect(track.keyframes).toHaveLength(1);
    expect(track.keyframes[0].time).toBeCloseTo(2, 3);
  });
});

describe('keyframe transport with keyframes', () => {
  it('publishes the values every frame, at the playhead', () => {
    keyframeTimeline.addKeyframe('layer-1', 'opacity', 0, 0, 'linear', 'Opacity', 'number');
    keyframeTimeline.addKeyframe('layer-1', 'opacity', 10, 1, 'linear', 'Opacity', 'number');
    keyframeTimeline.play();
    const store = counter(keyframeTimeline);
    frames(1);
    frames(60);
    expect(store.count).toBe(61);
    const s = get(keyframeTimeline);
    expect(s.config.currentTime).toBeCloseTo(1, 3);
    expect(s.activeOverrides['layer-1'].opacity as number).toBeCloseTo(0.1, 3);
    expect(get(keyframePlayhead)).toBe(s.config.currentTime);
    store.stop();
  });

  it('removing the last keyframe while playing stops the publishing and clears the values', () => {
    keyframeTimeline.addKeyframe('layer-1', 'opacity', 5, 1, 'linear', 'Opacity', 'number');
    keyframeTimeline.play();
    frames(31);
    keyframeTimeline.removeKeyframe('layer-1', 'opacity', 5);
    expect(get(keyframeTimeline).activeOverrides).toEqual({});
    const store = counter(keyframeTimeline);
    frames(60);
    expect(store.count).toBe(0);
    expect(keyframeTimeline.currentTime()).toBeCloseTo(1.5, 3);
  });
});
