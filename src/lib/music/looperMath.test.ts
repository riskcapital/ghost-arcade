import { describe, expect, it } from 'vitest';
import {
  DEADBAND_SECONDS,
  FOLLOW_LIMIT,
  FOLLOW_START,
  MAX_CORRECTION,
  RESYNC_CHECKS,
  RESYNC_SECONDS,
  chopPlayback,
  countInBeats,
  followStep,
  longestLength,
  loopOffset,
  loopPosition,
  nextBarBeat,
  phaseError,
  recordProgress,
  recordWindow,
  shortenWindow,
  sliceBounds,
  startRate,
  timeOfBeat,
  type FollowState,
} from './looperMath';

const SR = 48000;
/** 120 BPM. */
const BEAT_MS = 500;

describe('the next bar line', () => {
  it('is the next multiple of four beats', () => {
    expect(nextBarBeat(5.5, BEAT_MS)).toBe(8);
    expect(nextBarBeat(0.1, BEAT_MS)).toBe(4);
    expect(nextBarBeat(-2.5, BEAT_MS)).toBe(0);
  });

  it('skips a bar line too close to reach in time', () => {
    // 30 ms lead at 120 BPM is 0.06 beats: 7.95 is 25 ms before the bar.
    expect(nextBarBeat(7.95, BEAT_MS)).toBe(12);
    expect(nextBarBeat(7.9, BEAT_MS)).toBe(8);
    expect(nextBarBeat(8, BEAT_MS, 0)).toBe(8);
    expect(nextBarBeat(8, BEAT_MS)).toBe(12);
  });

  it('is timed on the audio clock from the clock reading', () => {
    expect(timeOfBeat(8, { beat: 5.5, beatMs: BEAT_MS }, 10)).toBeCloseTo(11.25, 12);
  });
});

describe('the record window', () => {
  it('runs from bar line to bar line in exact frames', () => {
    const w = recordWindow(10, { beat: 5.5, beatMs: BEAT_MS }, 2, SR);
    expect(w.startBeat).toBe(8);
    expect(w.endBeat).toBe(16);
    expect(w.startFrame).toBe(11.25 * SR);
    expect(w.endFrame - w.startFrame).toBe(4 * SR);
    expect(w.startTime).toBe(w.startFrame / SR);
    expect(w.endTime).toBe(w.endFrame / SR);
  });

  it('rounds the length once, at awkward tempos and rates', () => {
    const beatMs = 60000 / 127;
    const w = recordWindow(3.3333, { beat: 1.234, beatMs }, 4, 44100);
    expect(Number.isInteger(w.startFrame)).toBe(true);
    expect(w.endFrame - w.startFrame).toBe(Math.round(((16 * beatMs) / 1000) * 44100));
    // The start is the bar line to within a frame.
    expect(Math.abs(w.startTime - timeOfBeat(4, { beat: 1.234, beatMs }, 3.3333))).toBeLessThanOrEqual(0.5 / 44100);
  });

  it('fits every length from 60 BPM up, and leaves out what would be too long below', () => {
    expect(longestLength(500)).toBe(8);
    expect(longestLength(1000)).toBe(8);
    expect(longestLength(60000 / 59)).toBe(4);
    expect(longestLength(3000)).toBe(2);
    expect(longestLength(12000)).toBe(0);
  });

  it('ends early on the next bar line, after at least a bar, never later', () => {
    const w = recordWindow(0, { beat: 0.5, beatMs: BEAT_MS }, 4, SR);
    // Started at 1.75 s; bars are 2 s. A press 2.5 s into the recording ends it after bar 2.
    const two = shortenWindow(w, w.startTime + 2.5, SR);
    expect(two.bars).toBe(2);
    expect(two.endBeat).toBe(w.startBeat + 8);
    expect(two.endFrame - two.startFrame).toBe(2 * 2 * SR);
    // Straight after it starts: one bar.
    expect(shortenWindow(w, w.startTime + 0.1, SR).bars).toBe(1);
    // Too close to a bar line to reach it: the one after.
    expect(shortenWindow(w, w.startTime + 3.99, SR).bars).toBe(3);
    // In the last bar: as planned.
    expect(shortenWindow(w, w.startTime + 7, SR)).toBe(w);
  });

  it('counts in and shows progress', () => {
    const w = recordWindow(0, { beat: 0.5, beatMs: BEAT_MS }, 2, SR);
    expect(countInBeats(w, 0, BEAT_MS)).toBe(4);
    expect(countInBeats(w, w.startTime - 0.25, BEAT_MS)).toBe(1);
    expect(recordProgress(w, w.startTime - 1)).toEqual({ progress: 0, bar: 1 });
    expect(recordProgress(w, w.startTime + 1)).toEqual({ progress: 0.25, bar: 1 });
    expect(recordProgress(w, w.startTime + 3)).toEqual({ progress: 0.75, bar: 2 });
    expect(recordProgress(w, w.endTime + 1)).toEqual({ progress: 1, bar: 2 });
  });
});

describe('a loop against the bar grid', () => {
  // Two bars recorded from beat 8 (4 s at 120 BPM).
  const origin = 8;
  const beats = 8;
  const duration = 4;

  it('starts on a bar line in the phase it was recorded in', () => {
    expect(loopOffset(16, origin, beats, duration)).toBe(0);
    expect(loopOffset(20, origin, beats, duration)).toBe(2);
    expect(loopOffset(4, origin, beats, duration)).toBe(2);
    expect(loopOffset(1024, origin, beats, duration)).toBe(0);
    expect(loopOffset(18, origin, beats, duration)).toBe(1);
  });

  it('never starts at its very end', () => {
    expect(loopOffset(16 - 1e-9, origin, beats, duration)).toBe(0);
  });

  it('tracks where it is through rate changes, around the loop', () => {
    expect(loopPosition(3.5, 10, 1, 11, duration)).toBeCloseTo(0.5, 12);
    expect(loopPosition(1, 10, 1.01, 12, duration)).toBeCloseTo(3.02, 12);
    expect(phaseError(0.1, 3.9, duration)).toBeCloseTo(0.2, 12);
    expect(phaseError(3.9, 0.1, duration)).toBeCloseTo(-0.2, 12);
    expect(phaseError(1, 1, duration)).toBe(0);
  });
});

describe('following the clock', () => {
  it('follows a small tempo move and keeps its own length past it', () => {
    expect(startRate(1.02)).toBe(1.02);
    expect(startRate(1 + FOLLOW_LIMIT + 0.01)).toBe(1);
    const far = followStep(FOLLOW_START, 1.1, 0.5);
    expect(far).toMatchObject({ rate: 1, ownLength: true, resync: false });
    expect(followStep(FOLLOW_START, 0.99, 0)).toMatchObject({ rate: 0.99, ownLength: false, resync: false });
  });

  it('leaves jitter alone and closes a real error slowly', () => {
    expect(followStep(FOLLOW_START, 1, DEADBAND_SECONDS / 2).rate).toBe(1);
    let state: FollowState = FOLLOW_START;
    let rate = 1;
    for (let i = 0; i < 30; i++) ({ state, rate } = followStep(state, 1, 0.05));
    expect(rate).toBeGreaterThan(1);
    expect(rate).toBeLessThanOrEqual(1 + MAX_CORRECTION);
    for (let i = 0; i < 30; i++) ({ state, rate } = followStep(state, 1, -0.05));
    expect(rate).toBeLessThan(1);
    expect(rate).toBeGreaterThanOrEqual(1 - MAX_CORRECTION);
  });

  it('jumps back into phase only when it stays far out', () => {
    let state: FollowState = FOLLOW_START;
    for (let i = 0; i < RESYNC_CHECKS - 1; i++) {
      const step = followStep(state, 1, RESYNC_SECONDS * 2);
      expect(step.resync).toBe(false);
      // A far reading is not trusted until it repeats.
      expect(step.state.error).toBe(0);
      state = step.state;
    }
    expect(followStep(state, 1, RESYNC_SECONDS * 2).resync).toBe(true);
    // One far reading between near ones does not count.
    const once = followStep(followStep(FOLLOW_START, 1, 1).state, 1, 0);
    expect(once.state.far).toBe(0);
  });

  /** Play a loop against a clock for `seconds`, checking every 100 ms as the looper does. */
  function simulate(opts: { beatMs: number; clockRate?: number; startError?: number; seconds: number }) {
    const duration = 4;
    const origin = 0;
    const recordedBeatMs = 500;
    const clockRate = opts.clockRate ?? 1;
    const beatAt = (t: number) => origin + (t * clockRate * 1000) / opts.beatMs;
    // The loop starts `startError` seconds behind where the clock says it should be.
    let anchorPos = ((-(opts.startError ?? 0) % duration) + duration) % duration;
    let anchorTime = 0;
    let rate = startRate(recordedBeatMs / opts.beatMs);
    let state: FollowState = FOLLOW_START;
    let worst = 0;
    let error = 0;
    for (let t = 0.1; t <= opts.seconds; t += 0.1) {
      const expected = loopOffset(beatAt(t), origin, 8, duration);
      const actual = loopPosition(anchorPos, anchorTime, rate, t, duration);
      error = phaseError(expected, actual, duration);
      if (t > opts.seconds / 2) worst = Math.max(worst, Math.abs(error));
      const step = followStep(state, recordedBeatMs / opts.beatMs, error);
      state = step.state;
      anchorPos = actual;
      anchorTime = t;
      rate = step.rate;
    }
    return { worst, error, rate };
  }

  it('stays in time with a tempo 1% faster than it was recorded at', () => {
    const { worst, rate } = simulate({ beatMs: 495, startError: 0.02, seconds: 60 });
    expect(worst).toBeLessThan(0.006);
    expect(rate).toBeCloseTo(500 / 495, 2);
  });

  it('takes up the drift between the audio clock and the launch clock', () => {
    // The launch clock runs 100 ppm fast against the audio clock: 6 ms a minute.
    const { worst } = simulate({ beatMs: 500, clockRate: 1.0001, seconds: 300 });
    expect(worst).toBeLessThan(0.006);
  });
});

describe('chops', () => {
  it('slices a loop into equal parts covering every frame once', () => {
    const slices = sliceBounds(192000, 8);
    expect(slices).toHaveLength(8);
    expect(slices[0]).toEqual({ start: 0, end: 24000 });
    expect(slices[7]).toEqual({ start: 168000, end: 192000 });
    const odd = sliceBounds(1001, 8);
    expect(odd[0].start).toBe(0);
    expect(odd[7].end).toBe(1001);
    for (let i = 1; i < 8; i++) expect(odd[i].start).toBe(odd[i - 1].end);
    const sizes = odd.map((s) => s.end - s.start);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
  });

  it('plays its slice as recorded with the knobs in the middle', () => {
    const p = chopPlayback(24000, 48000, 192000, SR, { size: 0.5, tail: 0.5, tone: 0.5 });
    expect(p).toEqual({ offset: 0.5, length: 0.5, rate: 1, heard: 0.5, lowpass: null, highpass: null });
  });

  it('reads the pads knobs: Size pitch, Tail length, Tone dark to thin', () => {
    expect(chopPlayback(0, 24000, 192000, SR, { size: 0, tail: 0.5, tone: 0.5 })).toMatchObject({ rate: 2, heard: 0.25 });
    expect(chopPlayback(0, 24000, 192000, SR, { size: 1, tail: 0.5, tone: 0.5 })).toMatchObject({ rate: 0.5, heard: 1 });
    expect(chopPlayback(0, 24000, 192000, SR, { size: 0.5, tail: 0, tone: 0.5 }).length).toBeCloseTo(0.125, 12);
    expect(chopPlayback(0, 24000, 192000, SR, { size: 0.5, tail: 1, tone: 0.5 }).length).toBeCloseTo(1, 12);
    // The last slice cannot run on past the end of the loop.
    expect(chopPlayback(168000, 192000, 192000, SR, { size: 0.5, tail: 1, tone: 0.5 }).length).toBeCloseTo(0.5, 12);
    expect(chopPlayback(0, 24000, 192000, SR, { size: 0.5, tail: 0.5, tone: 0 }).lowpass).toBeCloseTo(250, 6);
    expect(chopPlayback(0, 24000, 192000, SR, { size: 0.5, tail: 0.5, tone: 1 }).highpass).toBeCloseTo(1200, 6);
  });
});
