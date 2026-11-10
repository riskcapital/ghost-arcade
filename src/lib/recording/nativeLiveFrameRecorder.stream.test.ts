import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StageFrameSink } from '../stage3d/store';

const writes: { index: number; repeat: number; tag: number }[] = [];
/** Frame tags released by the recorder, and the writes done at that moment. */
const releases: { tag: number; writesDone: number }[] = [];
let writeDelayMs = 0;

vi.mock('../bridge', () => ({ isElectron: true, invoke: vi.fn() }));
vi.mock('../stores/media', () => ({ mediaLibrary: { addItem: vi.fn() } }));
vi.mock('../storage/assetRegistry', () => ({ pathToFileUrl: (p: string) => `file://${p}` }));
vi.mock('../api/native-renderer', () => ({
  getNativeRendererCapabilities: vi.fn(),
  getNativeRendererFrameSnapshot: vi.fn(),
  getNativeRendererStatus: vi.fn(),
  submitNativeRendererCommands: vi.fn(),
}));
vi.mock('./offlineRender', () => ({
  startNativeMp4FrameEncoder: vi.fn(async (s: { width: number; height: number; fps: number }) => ({
    jobId: 'job', width: s.width, height: s.height, fps: s.fps, pixelFormat: 'rgba', extension: 'mp4', mime: 'video/mp4', tempDir: '/tmp',
  })),
  writeNativeMp4Frame: vi.fn(async (_s: unknown, index: number, frame: { data: Uint8Array }, repeat = 1) => {
    if (writeDelayMs) await new Promise((r) => setTimeout(r, writeDelayMs));
    writes.push({ index, repeat, tag: frame.data[0] });
  }),
  finishNativeMp4FrameEncoder: vi.fn(async () => ({ outputPath: '/tmp/out.mp4', size: 1, frames: writes.length, nativeAudio: false })),
  cancelNativeMp4FrameEncoder: vi.fn(async () => {}),
  promptSaveMp4: vi.fn(async () => null),
  thumbnailFromVideoUrl: vi.fn(async () => undefined),
  writeNativeRendererMp4Frame: vi.fn(),
  formatErr: (e: unknown) => String(e),
}));

import { startNativeLiveFrameRecording } from './nativeLiveFrameRecorder';

/** A stand-in stage view: renders every `intervalMs`, hands kept frames
 *  over `delayMs` later (the async read-back). */
function fakeStage(intervalMs: number, delayMs: number) {
  let sink: StageFrameSink | null = null;
  let renders = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  const streamFrames = (_w: number, _h: number, s: StageFrameSink) => {
    sink = s;
    timer = setInterval(() => {
      if (!sink) return;
      const n = ++renders;
      const tag = sink.beforeRender(performance.now());
      if (tag === null || tag === undefined) return;
      const own = sink;
      const data = new Uint8Array([n % 256, 0, 0, 255]);
      const release = () => releases.push({ tag: data[0], writesDone: writes.length });
      setTimeout(() => own.frame({ data, width: 1, height: 1, release }, tag), delayMs);
    }, intervalMs);
    return () => { sink = null; };
  };
  return { streamFrames, stop: () => { if (timer) clearInterval(timer); }, renders: () => renders };
}

describe('native live recorder, stream mode', () => {
  beforeEach(() => {
    writes.length = 0;
    releases.length = 0;
    writeDelayMs = 0;
    vi.stubGlobal('window', {
      setInterval, clearInterval, setTimeout, clearTimeout,
      requestAnimationFrame: (cb: () => void) => setTimeout(cb, 16),
      cancelAnimationFrame: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('writes one render per frame slot, in order, with no gaps', async () => {
    const stage = fakeStage(1000 / 60, 20);
    const dues: number[] = [];
    let complete = false;
    const handle = await startNativeLiveFrameRecording({
      captureFrame: async () => { throw new Error('the stream is used instead'); },
      streamFrames: stage.streamFrames,
      onFrameDue: (at) => dues.push(at),
      width: 1, height: 1, fps: 30,
      onComplete: () => { complete = true; },
      onError: (e) => { throw e; },
    });
    await new Promise((r) => setTimeout(r, 700));
    handle!.stop();
    for (let i = 0; i < 100 && !complete; i++) await new Promise((r) => setTimeout(r, 20));
    stage.stop();
    expect(complete).toBe(true);
    // Contiguous slots from 0, each write starting where the last ended.
    let next = 0;
    for (const w of writes) {
      expect(w.index).toBe(next);
      next += w.repeat;
    }
    expect(next).toBeGreaterThanOrEqual(18);
    // Timer-driven renders are not vsync-steady; most slots still get their own render.
    expect(writes.length).toBeGreaterThan(next * 0.6);
    // Each kept render told the sound when its frame is due, 1/30 s apart.
    expect(dues.length).toBe(writes.length);
    expect(dues[1] - dues[0]).toBeCloseTo((1000 / 30) * writes[0].repeat, 2);
  });

  it('lets renders pass while the encoder is backed up, then fills the held slots', async () => {
    writeDelayMs = 120;
    const stage = fakeStage(1000 / 60, 5);
    let complete = false;
    const handle = await startNativeLiveFrameRecording({
      captureFrame: async () => { throw new Error('unused'); },
      streamFrames: stage.streamFrames,
      width: 4096, height: 4096, fps: 30, // 64 MB frames: at most three in flight
      onComplete: () => { complete = true; },
      onError: (e) => { throw e; },
    });
    await new Promise((r) => setTimeout(r, 800));
    handle!.stop();
    for (let i = 0; i < 200 && !complete; i++) await new Promise((r) => setTimeout(r, 20));
    stage.stop();
    expect(complete).toBe(true);
    let next = 0;
    for (const w of writes) {
      expect(w.index).toBe(next);
      next += w.repeat;
    }
    // Real time is kept: the slots cover the recording, with repeats.
    expect(next).toBeGreaterThanOrEqual(20);
    expect(writes.some((w) => w.repeat > 1)).toBe(true);
  });

  it('hands each frame buffer back only after its write is done', async () => {
    writeDelayMs = 30;
    const stage = fakeStage(1000 / 60, 5);
    let complete = false;
    const handle = await startNativeLiveFrameRecording({
      captureFrame: async () => { throw new Error('unused'); },
      streamFrames: stage.streamFrames,
      width: 1, height: 1, fps: 30,
      onComplete: () => { complete = true; },
      onError: (e) => { throw e; },
    });
    await new Promise((r) => setTimeout(r, 400));
    handle!.stop();
    for (let i = 0; i < 100 && !complete; i++) await new Promise((r) => setTimeout(r, 20));
    stage.stop();
    expect(complete).toBe(true);
    // Every written frame was released once, after its own write.
    expect(releases.length).toBe(writes.length);
    releases.forEach((r, i) => {
      expect(r.tag).toBe(writes[i].tag);
      expect(r.writesDone).toBe(i + 1);
    });
  });

  it('Stop with seconds of frames still queued saves them all (it used to delete the take)', async () => {
    // A loaded machine: each encoder write takes 200 ms, so ~5 s queue up.
    writeDelayMs = 200;
    const stage = fakeStage(1000 / 60, 5);
    let complete = false;
    let error: Error | null = null;
    const { cancelNativeMp4FrameEncoder, finishNativeMp4FrameEncoder } = await import('./offlineRender');
    const handle = await startNativeLiveFrameRecording({
      captureFrame: async () => { throw new Error('unused'); },
      streamFrames: stage.streamFrames,
      width: 1, height: 1, fps: 30,
      onComplete: () => { complete = true; },
      onError: (e) => { error = e; },
    });
    await new Promise((r) => setTimeout(r, 1200));
    handle!.stop();
    stage.stop();
    for (let i = 0; i < 600 && !complete && !error; i++) await new Promise((r) => setTimeout(r, 20));
    expect(error).toBeNull();
    expect(complete).toBe(true);
    expect(cancelNativeMp4FrameEncoder).not.toHaveBeenCalled();
    expect(finishNativeMp4FrameEncoder).toHaveBeenCalled();
    // Every frame claimed before Stop reached the encoder, in order.
    let next = 0;
    for (const w of writes) {
      expect(w.index).toBe(next);
      next += w.repeat;
    }
    expect(writes.length).toBeGreaterThan(15);
  }, 20_000);

  it('a kept render that is lost leaves no gap: the next frame fills its slots', async () => {
    let sink: StageFrameSink | null = null;
    const streamFrames = (_w: number, _h: number, s: StageFrameSink) => { sink = s; return () => { sink = null; }; };
    let complete = false;
    let error: Error | null = null;
    const handle = await startNativeLiveFrameRecording({
      captureFrame: async () => { throw new Error('unused'); },
      streamFrames,
      width: 1, height: 1, fps: 30,
      onComplete: () => { complete = true; },
      onError: (e) => { error = e; },
    });
    const t0 = performance.now();
    const at = (ms: number) => t0 + ms;
    const frame = (n: number) => ({ data: new Uint8Array([n, 0, 0, 255]), width: 1, height: 1 });
    // Slot 0 kept and delivered; slot 1 kept but lost (context loss); slot 2 delivered.
    const s = sink as unknown as StageFrameSink;
    const t0Tag = s.beforeRender(at(0));
    s.frame(frame(1), t0Tag);
    const lostTag = s.beforeRender(at(1000 / 30));
    s.lost?.(lostTag);
    const t2Tag = s.beforeRender(at(2000 / 30));
    s.frame(frame(3), t2Tag);
    await new Promise((r) => setTimeout(r, 30));
    handle!.stop();
    for (let i = 0; i < 100 && !complete && !error; i++) await new Promise((r) => setTimeout(r, 20));
    expect(error).toBeNull();
    expect(complete).toBe(true);
    // Before: frame 3 was written at index 2 while the encoder expected 1
    // ("MP4 frame order mismatch") and the take was lost.
    expect(writes.map((w) => [w.index, w.repeat, w.tag])).toEqual([[0, 1, 1], [1, 2, 3]]);
  });
});
