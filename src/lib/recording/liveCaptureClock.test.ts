import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
const { createLiveCaptureClock } = createRequire(import.meta.url)('../../../electron/live-capture-clock.cjs');
afterEach(() => vi.useRealTimers());
describe('main-process recording clock', () => {
  it('captures without frontend ticks and stops cleanly', async () => {
    vi.useFakeTimers();
    const capture = vi.fn(async () => {});
    const clock = createLiveCaptureClock({fps: 30, capture, now: () => Date.now()});
    await vi.advanceTimersByTimeAsync(1000);
    expect(capture.mock.calls.length).toBeGreaterThanOrEqual(30);
    await clock.stop();
    const count = capture.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(capture).toHaveBeenCalledTimes(count);
  });
  it('bounds slow captures and waits for the last frame before stopping', async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const capture = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
    const clock = createLiveCaptureClock({fps: 60, capture, now: () => Date.now()});
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(5000);
    expect(capture).toHaveBeenCalledTimes(1);
    release(); await vi.advanceTimersByTimeAsync(1);
    expect(capture.mock.calls[1]).toEqual([1, 120]);
    let stopped = false;
    const done = clock.stop().then(() => { stopped = true; });
    await Promise.resolve(); expect(stopped).toBe(false);
    release(); await done;
    expect(clock.status().frames).toBe(121);
  });
  it('stops scheduling on capture failure', async () => {
    vi.useFakeTimers();
    const capture = vi.fn(async () => { throw new Error('Encoder disconnected'); });
    const clock = createLiveCaptureClock({fps: 30, capture});
    await vi.advanceTimersByTimeAsync(1000);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(clock.status()).toMatchObject({running: false, error: 'Encoder disconnected', frames: 0});
    await clock.stop();
  });
});
