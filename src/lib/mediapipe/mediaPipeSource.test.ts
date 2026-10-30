import { afterEach, describe, expect, it, vi } from 'vitest';
import { MediaPipeSource, MEDIAPIPE_RETRY_AFTER_FAILURE_MS, MEDIAPIPE_STOP_GRACE_MS } from './mediaPipeSource';

/** A source whose start succeeds at once without a camera. */
function fakeStartSource() {
  const source = new MediaPipeSource();
  const init = vi.spyOn(source as any, '_startInternal').mockImplementation(async () => { (source as any).running = true; });
  const stop = vi.spyOn(source, 'stop');
  return { source, init, stop };
}

describe('MediaPipe camera consumers', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('stops the camera a moment after the last consumer lets go', async () => {
    vi.useFakeTimers();
    const { source, stop } = fakeStartSource();
    source.acquire('layer-a');
    source.acquire('layer-b');
    await source.start();
    expect(source.isRunning()).toBe(true);
    source.release('layer-a');
    vi.advanceTimersByTime(MEDIAPIPE_STOP_GRACE_MS * 2);
    expect(stop).not.toHaveBeenCalled();
    source.release('layer-b');
    vi.advanceTimersByTime(MEDIAPIPE_STOP_GRACE_MS - 1);
    expect(source.isRunning()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(source.isRunning()).toBe(false);
  });

  it('keeps the camera when a consumer comes back within the grace period', async () => {
    vi.useFakeTimers();
    const { source, stop } = fakeStartSource();
    source.acquire('layer');
    await source.start();
    source.release('layer');
    vi.advanceTimersByTime(MEDIAPIPE_STOP_GRACE_MS - 100);
    source.acquire('layer');
    vi.advanceTimersByTime(MEDIAPIPE_STOP_GRACE_MS * 4);
    expect(stop).not.toHaveBeenCalled();
    expect(source.isRunning()).toBe(true);
  });

  it('lets a timed hold lapse when it is no longer renewed', async () => {
    vi.useFakeTimers();
    const { source } = fakeStartSource();
    source.acquire('handfx-layers', 1000);
    await source.start();
    // Renewed every frame for five seconds: stays on.
    for (let i = 0; i < 300; i++) { vi.advanceTimersByTime(16); source.acquire('handfx-layers', 1000); }
    expect(source.isRunning()).toBe(true);
    // The layer is gone: the hold lapses, then the grace period runs out.
    vi.advanceTimersByTime(1000 + MEDIAPIPE_STOP_GRACE_MS + 10);
    expect(source.getConsumers()).toEqual([]);
    expect(source.isRunning()).toBe(false);
  });

  it('publishes running state so the panel sees a camera a layer started', async () => {
    const { source } = fakeStartSource();
    const seen: boolean[] = [];
    source.subscribeState(state => seen.push(state.running));
    source.acquire('handfx-layers');
    await source.start();
    await source.stop();
    expect(seen[0]).toBe(false);
    expect(seen).toContain(true);
    expect(seen[seen.length - 1]).toBe(false);
  });

  it('turning off from the panel keeps layers from starting it again until started directly', async () => {
    const { source } = fakeStartSource();
    source.acquire('handfx-layers');
    source.acquire('panel');
    await source.start();
    await source.turnOff('panel');
    expect(source.isRunning()).toBe(false);
    expect(source.canAutoStart()).toBe(false);
    await source.start();
    expect(source.canAutoStart()).toBe(true);
    await source.turnOff();
    expect(source.canAutoStart()).toBe(false);
    // Once every layer has gone, a new layer may start it again.
    source.release('handfx-layers');
    expect(source.canAutoStart()).toBe(true);
  });
});

describe('MediaPipe start failures', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('makes automatic starts wait after a failure, unless the options change', async () => {
    vi.useFakeTimers();
    const getUserMedia = vi.fn(async () => { throw new Error('NotFoundError'); });
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia, addEventListener: vi.fn() } });
    const source = new MediaPipeSource();
    const opts = { useGesture: false, targetFps: 60 };
    // A render loop asking every frame for one second opens the camera once.
    let starts = 0;
    for (let i = 0; i < 60; i++) {
      if (!source.isStarting() && !source.isRunning() && source.canAutoStart(opts)) {
        starts++;
        await source.start(opts).catch(() => {});
      }
      vi.advanceTimersByTime(16);
    }
    expect(starts).toBe(1);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(source.getError()).toContain('NotFoundError');
    expect(source.canAutoStart({ ...opts, trackBody: true })).toBe(true);
    vi.advanceTimersByTime(MEDIAPIPE_RETRY_AFTER_FAILURE_MS);
    expect(source.canAutoStart(opts)).toBe(true);
  });

  it('a camera being plugged in ends the wait', async () => {
    let onDeviceChange: (() => void) | null = null;
    vi.stubGlobal('navigator', { mediaDevices: {
      getUserMedia: vi.fn(async () => { throw new Error('NotFoundError'); }),
      addEventListener: vi.fn((type: string, cb: () => void) => { if (type === 'devicechange') onDeviceChange = cb; }),
    } });
    const source = new MediaPipeSource();
    await source.start().catch(() => {});
    expect(source.canAutoStart()).toBe(false);
    onDeviceChange!();
    expect(source.canAutoStart()).toBe(true);
  });
});

describe('MediaPipe camera startup', () => {
  it('joins repeated render-frame requests into one camera/worker startup', async () => {
    const source = new MediaPipeSource();
    let finish!: () => void;
    const startup = new Promise<void>(resolve => { finish = resolve; });
    const init = vi.spyOn(source as any, '_startInternal').mockImplementation(() => startup);
    const calls = Array.from({ length: 60 }, () => source.start({ useGesture: false }));
    expect(init).toHaveBeenCalledTimes(1);
    finish();
    await Promise.all(calls);
    expect(init).toHaveBeenCalledTimes(1);
  });

  it('propagates failure to all callers and permits a deliberate retry', async () => {
    const source = new MediaPipeSource();
    let fail!: (error: Error) => void;
    const startup = new Promise<void>((_, reject) => { fail = reject; });
    const init = vi.spyOn(source as any, '_startInternal').mockImplementation(() => startup);
    const settled = Promise.allSettled([source.start(), source.start()]);
    fail(new Error('camera unavailable'));
    expect((await settled).every(result => result.status === 'rejected')).toBe(true);
    init.mockResolvedValue(undefined);
    await source.start();
    expect(init).toHaveBeenCalledTimes(2);
  });

  it('uses one mirror setting for inference and preview', () => {
    const source = new MediaPipeSource();
    expect(source.isMirrored()).toBe(true);
    source.setMirror(false);
    expect(source.getOpts().mirror).toBe(false);
    source.setMirror(true);
    expect(source.getOpts().mirror).toBe(true);
  });
});
