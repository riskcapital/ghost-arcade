import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNativeClipTransitionCoordinator, type NativeClipTransitionTask } from './nativeClipTransitionCoordinator';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('native clip transition coordination', () => {
  let now: number;
  let nextFrame: number;
  let frames: Map<number, FrameRequestCallback>;
  let tasks: NativeClipTransitionTask[];
  let coordinator: ReturnType<typeof createNativeClipTransitionCoordinator> | undefined;
  const task = (token = 1, patch: Partial<NativeClipTransitionTask> = {}): NativeClipTransitionTask => ({
    key: 'A:0', token, duration: 1, startedAtMs: null, requiresSnapshot: false, ...patch,
  });
  const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
  const draw = async (time: number) => {
    now = time;
    const scheduled = Array.from(frames.values());
    frames.clear();
    for (const callback of scheduled) callback(time);
    await settle();
  };
  function start(overrides: Partial<Parameters<typeof createNativeClipTransitionCoordinator<NativeClipTransitionTask>>[0]> = {}) {
    const options = {
      read: () => tasks,
      capture: vi.fn(async () => 'snapshot-a'),
      ready: vi.fn(async () => true),
      release: vi.fn(async () => ({ released: true })),
      onFrozen: vi.fn((entry: NativeClipTransitionTask, sourceId: string) => {
        tasks = tasks.map(value => value.key === entry.key && value.token === entry.token
          ? { ...value, requiresSnapshot: false, frozenSourceId: sourceId } : value);
      }),
      onReady: vi.fn((entry: NativeClipTransitionTask, time: number) => {
        tasks = tasks.map(value => value.key === entry.key && value.token === entry.token
          ? { ...value, startedAtMs: time } : value);
      }),
      onComplete: vi.fn((entry: NativeClipTransitionTask) => { tasks = tasks.filter(value => value.token !== entry.token); }),
      onFrame: vi.fn(),
      onError: vi.fn(),
      ...overrides,
    };
    coordinator = createNativeClipTransitionCoordinator(options);
    coordinator.refresh();
    return options;
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    now = 0;
    nextFrame = 0;
    frames = new Map();
    tasks = [task()];
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = ++nextFrame; frames.set(id, callback); return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  });
  afterEach(async () => {
    tasks = [];
    coordinator?.destroy();
    await settle();
    coordinator = undefined;
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('does not start or complete a fade owned by the native launch queue', async () => {
    tasks=[task(1,{queuedTriggerId:'pending'})];
    const options=start();
    await draw(0);await draw(20000);
    expect(options.ready).not.toHaveBeenCalled();
    expect(options.onReady).not.toHaveBeenCalled();expect(options.onComplete).not.toHaveBeenCalled();
  });

  it('starts duration at the first ready picture and completes only after that duration', async () => {
    const pending = deferred<boolean>();
    const options = start({ ready: vi.fn(() => pending.promise) });
    await draw(0);
    await draw(3000);
    expect(options.onReady).not.toHaveBeenCalled();
    expect(options.onComplete).not.toHaveBeenCalled();
    now = 4000;
    pending.resolve(true);
    await settle();
    expect(options.onReady).toHaveBeenCalledWith(expect.objectContaining({ token: 1 }), 4000);
    await draw(4999);
    expect(options.onComplete).not.toHaveBeenCalled();
    await draw(5000);
    expect(options.onComplete).toHaveBeenCalledOnce();
    expect(tasks).toEqual([]);
  });

  it('ignores stale readiness and keeps rapid retriggers to one readiness call per row', async () => {
    const pending = deferred<boolean>();
    const ready = vi.fn().mockImplementationOnce(() => pending.promise).mockResolvedValue(true);
    const options = start({ ready });
    await draw(0);
    for (let token = 2; token <= 20; token++) {
      tasks = [task(token)];
      await draw(token * 16);
    }
    expect(ready).toHaveBeenCalledOnce();
    pending.resolve(true);
    await settle();
    expect(options.onReady).not.toHaveBeenCalled();
    await draw(336);
    expect(ready).toHaveBeenCalledTimes(2);
    expect(options.onReady).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ token: 20 }), 336);
  });

  it('adopts one captured picture for the latest trigger while the old scene is held', async () => {
    tasks = [task(1, { requiresSnapshot: true })];
    const pending = deferred<string | null>();
    const options = start({ capture: vi.fn(() => pending.promise) });
    await draw(0);
    tasks = [task(2, { requiresSnapshot: true })];
    await draw(16);
    tasks = [task(3, { requiresSnapshot: true })];
    await draw(32);
    pending.resolve('snapshot-a');
    await settle();
    expect(options.capture).toHaveBeenCalledOnce();
    expect(options.onFrozen).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ token: 3 }), 'snapshot-a');
    expect(options.release).not.toHaveBeenCalled();
    expect(tasks[0].frozenSourceId).toBe('snapshot-a');
  });

  it('reports a sustained readiness wait and restarts its timer for a new trigger', async () => {
    const options = start({ ready: vi.fn(async () => false) });
    await draw(0);
    await draw(5000);
    await draw(10001);
    expect(options.onError).toHaveBeenCalledExactlyOnceWith('The next clip is still preparing. The previous picture is being held.');
    tasks = [task(2)];
    await draw(15002);
    expect(options.onError).toHaveBeenCalledOnce();
  });

  it('retires a capture that resolves after the row has stopped', async () => {
    tasks = [task(1, { requiresSnapshot: true })];
    const pending = deferred<string | null>();
    const options = start({ capture: vi.fn(() => pending.promise) });
    await draw(0);
    tasks = [];
    await draw(16);
    pending.resolve('snapshot-a');
    await settle();
    await draw(32);
    expect(options.onFrozen).not.toHaveBeenCalled();
    expect(options.release).toHaveBeenCalledExactlyOnceWith('snapshot-a');
  });

  it('drains a capture that resolves after destroy without restarting the animation loop', async () => {
    tasks = [task(1, { requiresSnapshot: true })];
    const pending = deferred<string | null>();
    const options = start({ capture: vi.fn(() => pending.promise) });
    await draw(0);
    coordinator!.destroy();
    pending.resolve('snapshot-a');
    await settle();
    expect(options.onFrozen).not.toHaveBeenCalled();
    expect(options.release).toHaveBeenCalledExactlyOnceWith('snapshot-a');
    expect(frames.size).toBe(0);
  });

  it('protects a snapshot adopted by the latest task and retries retirement after the native reader leaves', async () => {
    tasks = [task(1, { frozenSourceId: 'snapshot-a', startedAtMs: 0, duration: 100 })];
    const release = vi.fn().mockResolvedValueOnce({ referenced: true }).mockResolvedValue({ released: true });
    start({ release });
    coordinator!.retire('snapshot-a');
    await draw(0);
    expect(release).not.toHaveBeenCalled();
    tasks = [];
    await draw(16);
    expect(release).toHaveBeenCalledOnce();
    await draw(32);
    expect(release).toHaveBeenCalledOnce();
    await draw(266);
    expect(release).toHaveBeenCalledTimes(2);
    await draw(282);
    expect(release).toHaveBeenCalledTimes(2);
  });

  it('does not release a reused snapshot id while capture is overwriting it', async () => {
    tasks = [task(1, { requiresSnapshot: true })];
    const pending = deferred<string | null>();
    const options = start({ capture: vi.fn(() => pending.promise) });
    coordinator!.retire('snapshot-a');
    await draw(0);
    await draw(16);
    expect(options.release).not.toHaveBeenCalled();
    pending.resolve('snapshot-a');
    await settle();
    await draw(32);
    expect(options.release).not.toHaveBeenCalled();
    tasks = [];
    await draw(48);
    expect(options.release).toHaveBeenCalledExactlyOnceWith('snapshot-a');
  });

  it('finishes referenced snapshot cleanup after destroy once scene reconciliation drops the reader', async () => {
    tasks = [task(1, { frozenSourceId: 'snapshot-a', startedAtMs: 0 })];
    const release = vi.fn().mockResolvedValueOnce({ referenced: true }).mockResolvedValue({ released: true });
    start({ release });
    coordinator!.destroy();
    await settle();
    expect(release).toHaveBeenCalledOnce();
    now = 250;
    await vi.advanceTimersByTimeAsync(250);
    expect(release).toHaveBeenCalledTimes(2);
    expect(frames.size).toBe(0);
  });

  it('lets a newer trigger retry immediately after an older capture failure', async () => {
    tasks = [task(1, { requiresSnapshot: true })];
    const capture = vi.fn().mockRejectedValueOnce(new Error('not ready')).mockResolvedValue('snapshot-a');
    const options = start({ capture });
    await draw(0);
    expect(options.onError).toHaveBeenCalledWith('not ready');
    tasks = [task(2, { requiresSnapshot: true })];
    await draw(16);
    expect(capture).toHaveBeenCalledTimes(2);
    expect(options.onFrozen).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ token: 2 }), 'snapshot-a');
  });
});
