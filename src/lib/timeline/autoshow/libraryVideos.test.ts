/**
 * Measuring My library's videos: a few at a time, with a time limit per
 * video and for the whole library; every measure settles (a seek that never
 * answers included) and lets go of its video element; a stopped measure
 * keeps nothing; the cache keeps the most recent few hundred.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MediaItem } from '../../stores/media';
import {
  MAX_MEASURED, _forgetMeasures, _measuredCount, libraryCastDetailed, measureFrames, measureVideo,
  type MeasureDeps, type MeasureVideoEl,
} from './libraryVideos';

afterEach(() => {
  _forgetMeasures();
  vi.useRealTimers();
});

type Behaviour = { duration?: number; seeks?: 'answer' | 'never'; error?: boolean; taint?: boolean };

function fakeDeps(b: Behaviour = {}) {
  const made: Array<MeasureVideoEl & { released: boolean }> = [];
  const deps: MeasureDeps = {
    video() {
      let src = '';
      let time = 0;
      const v = {
        muted: false, preload: '', crossOrigin: null as string | null, released: false,
        get duration() { return b.duration ?? 10; },
        get currentTime() { return time; },
        set currentTime(t: number) {
          time = t;
          if (b.seeks !== 'never') queueMicrotask(() => v.onseeked?.({}));
        },
        get src() { return src; },
        set src(s: string) {
          src = s;
          queueMicrotask(() => (b.error ? v.onerror?.({}) : v.onloadedmetadata?.({})));
        },
        onerror: null as MeasureVideoEl['onerror'],
        onloadedmetadata: null as MeasureVideoEl['onloadedmetadata'],
        onseeked: null as MeasureVideoEl['onseeked'],
        removeAttribute(name: string) { if (name === 'src') { src = ''; v.released = true; } },
        load() {},
      };
      made.push(v);
      return v;
    },
    canvas: () => ({
      drawImage() {},
      getImageData() {
        if (b.taint) throw new Error('SecurityError');
        return { data: new Uint8ClampedArray(32 * 18 * 4).fill(128) };
      },
    }),
  };
  const clean = () => made.every((v) => v.released && !v.onseeked && !v.onloadedmetadata && !v.onerror);
  return { deps, made, clean };
}

describe('measureVideo', () => {
  it('measures a few frames, keeps the result, and lets go of the element', async () => {
    const f = fakeDeps();
    const m = await measureVideo('file:///a.mp4', { deps: f.deps });
    expect(m!.brightness).toBeCloseTo(128 / 255, 6);
    expect(m!.motion).toBe(0);
    expect(f.clean()).toBe(true);
    // Cached: no second element.
    expect(await measureVideo('file:///a.mp4', { deps: f.deps })).toEqual(m);
    expect(f.made).toHaveLength(1);
  });

  it('a seek that never answers: settles at the timeout, the frame loop ends and the element is let go', async () => {
    vi.useFakeTimers();
    const f = fakeDeps({ seeks: 'never' });
    const pending = measureVideo('file:///stuck.mp4', { deps: f.deps, timeoutMs: 1000 });
    await vi.advanceTimersByTimeAsync(999);
    expect(f.made[0].released).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toBeNull();
    expect(f.clean()).toBe(true);
  });

  it('an error, no length, or a picture it may not read: null, settled, let go', async () => {
    for (const b of [{ error: true }, { duration: 0 }, { taint: true }] as Behaviour[]) {
      const f = fakeDeps(b);
      expect(await measureVideo(`file:///${JSON.stringify(b)}.mp4`, { deps: f.deps, timeoutMs: 50 })).toBeNull();
      expect(f.clean()).toBe(true);
    }
  });

  it('stopped: null, let go, and nothing kept (the next read measures it)', async () => {
    const f = fakeDeps({ seeks: 'never' });
    const ac = new AbortController();
    const pending = measureVideo('file:///b.mp4', { deps: f.deps, signal: ac.signal, timeoutMs: 60_000 });
    await Promise.resolve();
    ac.abort();
    expect(await pending).toBeNull();
    expect(f.clean()).toBe(true);
    expect(_measuredCount()).toBe(0);
  });

  it('keeps the most recent measures only (the least recently used go first)', async () => {
    const f = fakeDeps();
    for (let i = 0; i < MAX_MEASURED; i++) await measureVideo(`file:///${i}.mp4`, { deps: f.deps, frames: 1 });
    expect(_measuredCount()).toBe(MAX_MEASURED);
    // 0 used again: 1 is now the oldest.
    await measureVideo('file:///0.mp4', { deps: f.deps });
    const made = f.made.length;
    await measureVideo('file:///new.mp4', { deps: f.deps, frames: 1 });
    expect(_measuredCount()).toBe(MAX_MEASURED);
    await measureVideo('file:///0.mp4', { deps: f.deps });
    expect(f.made.length).toBe(made + 1);
    await measureVideo('file:///1.mp4', { deps: f.deps, frames: 1 });
    expect(f.made.length).toBe(made + 2);
  });

  it('measureFrames: brightness and motion between frames', () => {
    const dark = new Uint8ClampedArray(8).fill(0);
    const light = new Uint8ClampedArray(8).fill(255);
    expect(measureFrames([dark, light])).toEqual({ brightness: 0.5, motion: 1 });
    expect(measureFrames([])).toEqual({ brightness: 0, motion: 0 });
  });
});

const videos = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `v${i}`, name: `clip ${i}.mp4`, src: `file:///v${i}.mp4`, type: 'video' })) as MediaItem[];

describe('libraryCastDetailed', () => {
  it('measures a few at a time, in the library\'s order', async () => {
    let live = 0;
    let peak = 0;
    const seen: string[] = [];
    const r = await libraryCastDetailed(videos(7), async (src) => {
      live++;
      peak = Math.max(peak, live);
      seen.push(src);
      await new Promise((res) => setTimeout(res, 5));
      live--;
      return { motion: 0.2, brightness: 0.6 };
    }, { atOnce: 3 });
    expect(peak).toBe(3);
    expect(seen).toHaveLength(7);
    expect(r.complete).toBe(true);
    expect(r.cast.map((c) => c.id)).toEqual(videos(7).map((v) => `library:${v.id}`));
    expect(r.cast.every((c) => c.tiers.includes('peak'))).toBe(true);
  });

  it('settles at the total time limit even when a measure never does; the rest sit in the middle', async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const pending = libraryCastDetailed(videos(4), (_src, signal) => { signals.push(signal); return new Promise(() => {}); }, { atOnce: 2, totalMs: 500 });
    await vi.advanceTimersByTimeAsync(500);
    const r = await pending;
    expect(r.complete).toBe(false);
    expect(r.cast).toHaveLength(4);
    expect(r.cast.every((c) => c.tiers.join() === 'groove')).toBe(true);
    // The measures in flight were told to stop (and only two were started).
    expect(signals).toHaveLength(2);
    expect(signals.every((s) => s.aborted)).toBe(true);
  });

  it('stopped from outside: settles at once, incomplete', async () => {
    const ac = new AbortController();
    const pending = libraryCastDetailed(videos(3), () => new Promise(() => {}), { signal: ac.signal, totalMs: 60_000 });
    ac.abort();
    const r = await pending;
    expect(r.complete).toBe(false);
    expect(r.cast).toHaveLength(3);
  });

  it('a measure that throws counts as not measured', async () => {
    const r = await libraryCastDetailed(videos(2), async (src) => { if (src.endsWith('v0.mp4')) throw new Error('x'); return { motion: 0, brightness: 0 }; });
    expect(r.complete).toBe(true);
    expect(r.cast[0].tiers).toEqual(['groove']);
    expect(r.cast[1].tiers).toEqual(['calm', 'groove']);
  });

  it('runs the real measuring with its element released for each video', async () => {
    const f = fakeDeps();
    const r = await libraryCastDetailed(videos(5), (src, signal) => measureVideo(src, { deps: f.deps, signal }));
    expect(r.complete).toBe(true);
    expect(f.made).toHaveLength(5);
    expect(f.clean()).toBe(true);
  });
});
