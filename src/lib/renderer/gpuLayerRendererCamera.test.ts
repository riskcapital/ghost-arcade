import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GpuLayerRenderer } from './gpuLayerRenderer';

class FakeOffscreenCanvas {
  constructor(public width: number, public height: number) {}
  getContext() {
    return { configure() {}, unconfigure() {} };
  }
}

function fakeStream() {
  const track = { stop: vi.fn() };
  return { track, stream: { getTracks: () => [track] } };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('GpuLayerRenderer camera source', () => {
  let getUserMedia: ReturnType<typeof vi.fn>;
  let now = 1000;

  beforeEach(() => {
    now = 1000;
    getUserMedia = vi.fn();
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    vi.stubGlobal('document', {
      createElement: () => ({ play: () => Promise.resolve(), srcObject: null }),
    });
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function renderer() {
    const r = new GpuLayerRenderer({}, 'bgra8unorm', 64, 64, { handoffMode: 'canvas' }) as any;
    r.impl = { setSource: vi.fn() };
    return r;
  }

  const feed = (r: any, deviceId = '') =>
    r.feedSource('pixel-fx', { source: { type: 'camera', deviceId } }, { layers: [], mediaItems: [] });

  it('asks once while the request is pending', async () => {
    const pending = deferred<any>();
    getUserMedia.mockReturnValue(pending.promise);
    const r = renderer();
    feed(r);
    feed(r);
    feed(r);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    const { stream, track } = fakeStream();
    pending.resolve(stream);
    await flush();
    feed(r);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(r.impl.setSource).toHaveBeenCalled();
    expect(track.stop).not.toHaveBeenCalled();
  });

  it('stops a stream that arrives after dispose', async () => {
    const pending = deferred<any>();
    getUserMedia.mockReturnValue(pending.promise);
    const r = renderer();
    feed(r);
    r.dispose();
    const { stream, track } = fakeStream();
    pending.resolve(stream);
    await flush();
    expect(track.stop).toHaveBeenCalled();
    expect(r.cameraStream).toBeNull();
  });

  it('stops a stream that a newer device request replaced', async () => {
    const first = deferred<any>();
    const second = deferred<any>();
    getUserMedia.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const r = renderer();
    feed(r, 'cam-a');
    feed(r, 'cam-b');
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    const late = fakeStream();
    first.resolve(late.stream);
    const current = fakeStream();
    second.resolve(current.stream);
    await flush();
    expect(late.track.stop).toHaveBeenCalled();
    expect(current.track.stop).not.toHaveBeenCalled();
    expect(r.cameraStream).toBe(current.stream);
  });

  it('stops a pending request when the source moves off the camera', async () => {
    const pending = deferred<any>();
    getUserMedia.mockReturnValue(pending.promise);
    const r = renderer();
    feed(r);
    r.feedSource('pixel-fx', { source: null }, { layers: [], mediaItems: [] });
    const { stream, track } = fakeStream();
    pending.resolve(stream);
    await flush();
    expect(track.stop).toHaveBeenCalled();
    expect(r.cameraStream).toBeNull();
  });

  it('waits longer after each denial instead of asking every frame', async () => {
    getUserMedia.mockRejectedValue(Object.assign(new Error('denied'), { name: 'NotAllowedError' }));
    const r = renderer();
    feed(r);
    await flush();
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 10; i++) feed(r);
    expect(getUserMedia).toHaveBeenCalledTimes(1);

    now += 2_001;
    feed(r);
    await flush();
    expect(getUserMedia).toHaveBeenCalledTimes(2);

    now += 2_001;
    feed(r);
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    now += 2_000;
    feed(r);
    await flush();
    expect(getUserMedia).toHaveBeenCalledTimes(3);
  });

  it('asks again right away for a different device or after leaving the camera', async () => {
    getUserMedia.mockRejectedValue(new Error('denied'));
    const r = renderer();
    feed(r, 'cam-a');
    await flush();
    feed(r, 'cam-b');
    await flush();
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    r.feedSource('pixel-fx', { source: null }, { layers: [], mediaItems: [] });
    feed(r, 'cam-b');
    expect(getUserMedia).toHaveBeenCalledTimes(3);
  });
});
