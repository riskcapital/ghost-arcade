import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url);
const { createPacedFramePump } = require('../../../electron/recording-frame-pump.cjs');
const { createLiveCaptureClock } = require('../../../electron/live-capture-clock.cjs');

afterEach(() => vi.useRealTimers());

/** A capture source whose frames carry the wall-clock time they were taken,
 *  and an encoder that reads nothing for `warmupMs` (VideoToolbox start). */
function harness({ warmupMs, frameBytes = 64 }: { warmupMs: number; frameBytes?: number }) {
  const t0 = Date.now();
  const writes: number[] = [];
  const capture = vi.fn(() => {
    const frame = Buffer.alloc(frameBytes);
    frame.writeDoubleLE(Date.now() - t0, 0);
    return frame;
  });
  let ready: Promise<void> | null = new Promise(resolve => setTimeout(resolve, warmupMs));
  const write = vi.fn(async (data: Buffer) => {
    if (ready) { await ready; ready = null; }
    writes.push(data.readDoubleLE(0));
  });
  return { t0, writes, capture, write };
}

describe('recording frame pump', () => {
  it('keeps the start of a recording through a slow encoder start', async () => {
    vi.useFakeTimers();
    const fps = 60;
    const h = harness({ warmupMs: 1800 });
    // REC was pressed 15 ms before the main process got the request.
    const pump = createPacedFramePump({ fps, startedAt: h.t0 - 15, capture: h.capture, write: h.write });
    await vi.advanceTimersByTimeAsync(3000);
    const result = await pump.stop();
    const requestedSeconds = (Date.now() - (h.t0 - 15)) / 1000;
    // Muxed duration matches REC press to stop within one frame.
    expect(Math.abs(result.written / fps - requestedSeconds)).toBeLessThanOrEqual(1 / fps);
    expect(result.written).toBe(h.writes.length);
    // Frame 0 is a capture from the press, not from when the encoder woke.
    expect(h.writes[0]).toBeLessThan(1000 / fps);
    // The warm-up is real motion, not one frozen frame.
    const warmup = h.writes.slice(0, Math.round(1.8 * fps));
    expect(new Set(warmup).size).toBeGreaterThan(fps);
    // Every written frame sits within one frame of its slot's time.
    h.writes.forEach((capturedAt, slot) => {
      expect(Math.abs(capturedAt - ((slot * 1000) / fps - 15))).toBeLessThanOrEqual(1000 / fps + 1);
    });
  });

  it('bounds memory during the warm-up by thinning the queue, not by dropping time', async () => {
    vi.useFakeTimers();
    const fps = 60;
    const frameBytes = 1000;
    const h = harness({ warmupMs: 2000, frameBytes });
    const pump = createPacedFramePump({ fps, startedAt: h.t0, capture: h.capture, write: h.write, maxQueuedBytes: 20 * frameBytes });
    await vi.advanceTimersByTimeAsync(4000);
    const result = await pump.stop();
    expect(result.peakQueuedBytes).toBeLessThanOrEqual(20 * frameBytes);
    expect(Math.abs(result.written / fps - (Date.now() - h.t0) / 1000)).toBeLessThanOrEqual(1 / fps);
    // Frames stay in capture order and still move through the warm-up.
    expect([...h.writes].sort((a, b) => a - b)).toEqual(h.writes);
    expect(new Set(h.writes.slice(0, 2 * fps)).size).toBeGreaterThanOrEqual(10);
    // Once the encoder has caught up the full cadence comes back.
    const tail = h.writes.slice(-fps);
    expect(new Set(tail).size).toBeGreaterThan(fps * 0.9);
  });

  it('covers slots before the first good capture with that capture', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const t0 = Date.now();
    const write = vi.fn(async () => {});
    const pump = createPacedFramePump({
      fps: 30, startedAt: t0, write,
      capture: () => (++calls <= 3 ? null : Buffer.alloc(8)),
    });
    await vi.advanceTimersByTimeAsync(1000);
    const result = await pump.stop();
    expect(Math.abs(result.written / 30 - (Date.now() - t0) / 1000)).toBeLessThanOrEqual(1 / 30);
  });

  it('stops cleanly when the encoder fails', async () => {
    vi.useFakeTimers();
    const pump = createPacedFramePump({
      fps: 30, startedAt: Date.now(), capture: () => Buffer.alloc(8),
      write: async () => { throw new Error('Recorder encoder stdin closed.'); },
    });
    await vi.advanceTimersByTimeAsync(500);
    const result = await pump.stop();
    expect(result.error?.message).toBe('Recorder encoder stdin closed.');
    expect(result.written).toBe(0);
  });
});

describe('live capture clock origin (fallback recorder)', () => {
  it('fills the setup time before the first capture from the REC press', async () => {
    vi.useFakeTimers();
    const capture = vi.fn(async () => {});
    // The renderer spent 500 ms probing the core and starting the encoder.
    const clock = createLiveCaptureClock({ fps: 30, capture, now: Date.now, started: Date.now() - 500 });
    await vi.advanceTimersByTimeAsync(0);
    expect(capture.mock.calls[0]).toEqual([0, 15]);
    await vi.advanceTimersByTimeAsync(2500);
    const { frames } = await clock.stop();
    expect(Math.abs(frames / 30 - 3)).toBeLessThanOrEqual(1 / 30);
  });
});
