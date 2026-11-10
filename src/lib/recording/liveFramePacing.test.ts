import { describe, expect, it } from 'vitest';
import { createLiveFramePacer, liveFrameRepeat, streamFramesInFlight } from './liveFramePacing';

describe('live frame pacing', () => {
  it('writes one slot per capture when captures keep up', () => {
    expect(liveFrameRepeat(0, 0, 30)).toBe(1);
    expect(liveFrameRepeat(1, 34, 30)).toBe(1);
    expect(liveFrameRepeat(2, 67, 30)).toBe(1);
  });

  it('fills the slots a late capture missed so playback stays real time', () => {
    // 23 fps view recorded at 30 fps: the second capture lands at 87 ms,
    // which is slot 2, so it covers slots 1 and 2.
    expect(liveFrameRepeat(1, 87, 30)).toBe(2);
    // One second in with 20 frames queued: due 31 → write 11.
    expect(liveFrameRepeat(20, 1000, 30)).toBe(11);
  });

  it('never writes less than one slot or more than five seconds at once', () => {
    expect(liveFrameRepeat(100, 1000, 30)).toBe(1);
    expect(liveFrameRepeat(0, 60_000, 30)).toBe(150);
  });
});

/** Feed renders at `intervalMs` (plus optional jitter) and collect the kept ones. */
function run(fps: number, intervalMs: number, durationMs: number, jitter: (i: number) => number = () => 0) {
  const pacer = createLiveFramePacer(fps, 1000);
  const kept: ReturnType<typeof pacer.take>[] = [];
  for (let i = 0; 1000 + i * intervalMs <= 1000 + durationMs; i++) {
    const slot = pacer.take(1000 + i * intervalMs + jitter(i));
    if (slot) kept.push(slot);
  }
  return { pacer, kept: kept as NonNullable<(typeof kept)[number]>[] };
}

describe('live frame pacer', () => {
  it('keeps every second render of a 60 Hz view for a 30 fps file, with no repeats', () => {
    const { pacer, kept } = run(30, 1000 / 60, 10_000);
    expect(kept.length).toBe(pacer.queued);
    expect(kept.every((s) => s.repeat === 1)).toBe(true);
    expect(pacer.queued).toBeGreaterThanOrEqual(300);
    expect(pacer.queued).toBeLessThanOrEqual(301);
  });

  it('holds steady when render times jitter around the slot edges', () => {
    // ±3 ms of frame-timing noise on a 60 Hz view whose renders land right
    // on the 30 fps slot boundaries: still one render per slot.
    const { kept } = run(30, 1000 / 60, 10_000, (i) => ((i * 7919) % 7) - 3);
    expect(kept.filter((s) => s.repeat > 1)).toEqual([]);
    expect(kept.length).toBeGreaterThanOrEqual(300);
  });

  it('keeps one render in four at 120 Hz and every render at 30 Hz', () => {
    expect(run(30, 1000 / 120, 5000).kept.length).toBe(151);
    const at30 = run(30, 1000 / 30, 5000);
    expect(at30.kept.length).toBe(151);
    expect(at30.kept.every((s) => s.repeat === 1)).toBe(true);
  });

  it('fills the slots a late render missed, and only those', () => {
    const pacer = createLiveFramePacer(30, 0);
    for (let t = 0; t <= 100; t += 1000 / 60) pacer.take(t);
    const before = pacer.queued;
    // A 150 ms stall: the next render covers the slots that went by.
    const slot = pacer.take(100 + 150)!;
    expect(slot.first).toBe(before);
    // Slot 7 (due at 233 ms) has passed; slot 8 (267 ms) is at most half a
    // frame away. Nothing later is claimed.
    const last = slot.first + slot.repeat - 1;
    expect(last).toBeGreaterThanOrEqual(7);
    expect(last).toBeLessThanOrEqual(8);
    expect(slot.repeat).toBeGreaterThan(1);
  });

  it('peek does not claim; commit claims; slots carry their due time', () => {
    const pacer = createLiveFramePacer(30, 500);
    const slot = pacer.peek(500)!;
    expect(slot).toEqual({ first: 0, repeat: 1, dueAtMs: 500 });
    expect(pacer.queued).toBe(0);
    expect(pacer.peek(500)).toEqual(slot);
    pacer.commit(slot);
    expect(pacer.queued).toBe(1);
    // A stale slot is ignored.
    pacer.commit(slot);
    expect(pacer.queued).toBe(1);
    expect(pacer.peek(510)).toBeNull();
    expect(pacer.take(500 + 1000 / 30)?.dueAtMs).toBeCloseTo(500 + 1000 / 30);
  });
});

describe('stream frames in flight', () => {
  it('queues about a second of 1080p, less at 4K, never under three', () => {
    expect(streamFramesInFlight(1920, 1080, 30)).toBe(30);
    expect(streamFramesInFlight(3840, 2160, 30)).toBe(7);
    expect(streamFramesInFlight(1920, 1080, 60)).toBe(30);
    expect(streamFramesInFlight(8192, 8192, 30)).toBe(3);
  });
});
