/**
 * Regression guard for the offline render's audio clock.
 *
 * The bug: the visual-audio follower integrated every envelope, LFO and
 * beat-phase on `performance.now()`. An offline render advances the video
 * by 1/fps per frame but takes as long as it takes in wall time, so a 10 s
 * export that ran for 15 s folded 15 s of reactive motion into 10 s of
 * video — reactive content played ~1.5x too fast.
 *
 * The fix: `setVisualAudioManualTime()` / `pumpVisualAudio()` put the
 * follower on the render clock. These tests prove the follower's dt no
 * longer depends on wall time at all: the SAME number of pumps at the SAME
 * virtual spacing must land on the SAME value whether each frame cost 1 ms
 * or 40 ms of wall time — and must match live mode fed the identical dt.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { audioStore } from '../stores/audio';
import {
  getVisualAudioSnapshot,
  pumpVisualAudio,
  setVisualAudioManualTime,
  isVisualAudioManualClock,
} from './visualAudio';

const BPM = 120;
const FPS = 30;
const FRAME = 1 / FPS;

/** Controlled wall clock. Live mode reads performance.now(); the whole
 *  point of the test is to move it independently of the virtual timeline.
 *  Starts non-zero: the live path treats `lastAt === 0` as "no previous
 *  frame" and bootstraps at 1/60, so a clock that literally reads zero
 *  would bootstrap twice and skew the reference run. */
let wallMs = 1000;

function advanceWall(ms: number) {
  wallMs += ms;
}

/** Push one analyser frame into audioStore. In live mode this drives the
 *  follower directly; in manual mode it only refreshes the input the pump
 *  will read. */
function emitAudioFrame(opts: { beat?: boolean } = {}) {
  audioStore.injectBroadcastedFrame({
    isActive: true,
    fft: new Float32Array(8),
    waveform: new Float32Array(8),
    bands: {
      sub: 0.5, bass: 0.6, lowMid: 0.4, mid: 0.35,
      highMid: 0.3, treble: 0.25, air: 0.2, presence: 0.15, high: 0.2,
    },
    amplitude: 0.5,
    peak: 0.6,
    rms: 0.3,
    beat: { isBeat: !!opts.beat, beatIntensity: opts.beat ? 1 : 0, timeSinceLastBeat: 0, beatCount: 0 },
    kickSnare: {
      isKick: !!opts.beat, kickIntensity: opts.beat ? 1 : 0, timeSinceLastKick: 0,
      isSnare: false, snareIntensity: 0, timeSinceLastSnare: 0,
    },
    bpm: BPM,
    bpmConfidence: 1,
    beatPhase: 0,
    spectralCentroid: 0.4,
  });
}

/** Force the follower back to a known baseline. Entering manual mode
 *  resets it; leaving restores the pre-export snapshot and resets again,
 *  so a round trip is a clean slate for both modes. */
function resetFollower() {
  setVisualAudioManualTime(0);
  setVisualAudioManualTime(null);
}

/** Total musical phase elapsed, in beats, accumulated from the published
 *  `beatPhase` (which wraps every beat — at 120 BPM a beat is 500 ms and a
 *  step is tens of ms, so unwrapping is unambiguous). This is the value the
 *  bug corrupted: it is the integral of dt against the detected tempo. */
class BeatAccumulator {
  private previous: number | null = null;
  total = 0;

  sample() {
    const phase = getVisualAudioSnapshot().beatPhase;
    if (this.previous !== null) {
      let delta = phase - this.previous;
      if (delta < 0) delta += 1;
      this.total += delta;
    }
    this.previous = phase;
  }
}

/** Live mode: N analyser emissions, each `wallStepMs` apart on the wall
 *  clock. Returns the follower's accumulated musical phase in beats. */
function runLive(frames: number, wallStepMs: number): number {
  resetFollower();
  const beats = new BeatAccumulator();
  for (let i = 0; i < frames; i++) {
    if (i > 0) advanceWall(wallStepMs);
    emitAudioFrame();
    beats.sample();
  }
  return beats.total;
}

/** Manual mode: N pumps at exactly 1/FPS of VIRTUAL time each, while the
 *  wall clock advances `wallStepMs` per frame (i.e. a slow export). */
function runManual(frames: number, wallStepMs: number): number {
  resetFollower();
  setVisualAudioManualTime(0);
  const beats = new BeatAccumulator();
  for (let i = 0; i < frames; i++) {
    advanceWall(wallStepMs);
    emitAudioFrame();
    pumpVisualAudio(i * FRAME);
    beats.sample();
  }
  setVisualAudioManualTime(null);
  return beats.total;
}

describe('visual audio manual clock', () => {
  beforeEach(() => {
    wallMs = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => wallMs);
  });

  afterEach(() => {
    setVisualAudioManualTime(null);
    vi.restoreAllMocks();
  });

  it('advances by virtual time, not wall time', () => {
    const frames = 30;
    // Live reference: the wall clock IS the virtual clock (a render that
    // happens to keep up with real time).
    const live = runLive(frames, FRAME * 1000);
    // Same export, but each frame costs 40ms of wall time instead of 33.3.
    const manualSlow = runManual(frames, 40);
    // And again at a wildly different wall pace.
    const manualFast = runManual(frames, 1);

    expect(manualSlow).toBeCloseTo(live, 9);
    expect(manualFast).toBeCloseTo(live, 9);
    expect(manualSlow).toBeCloseTo(manualFast, 12);
  });

  it('is the wall clock that used to leak in — live mode overshoots when frames are slow', () => {
    const frames = 30;
    const live = runLive(frames, FRAME * 1000);
    // This is the OLD behaviour: the follower fed by wall-clock dt while
    // the video only advanced 1/fps per frame.
    const wallDriven = runLive(frames, 40);

    // Overshoots by roughly the wall/virtual ratio (40 / 33.3 = 1.2).
    const ratio = wallDriven / live;
    expect(ratio).toBeGreaterThan(1.15);
    expect(ratio).toBeLessThan(1.25);
    // ...and the pinned path does not.
    expect(runManual(frames, 40) / live).toBeCloseTo(1, 6);
  });

  it('pumps once per exported frame even when no analyser frame arrives', () => {
    // An export can capture several frames between two analyser callbacks
    // (or none at all). The follower must still advance exactly one frame
    // of virtual time per pump.
    resetFollower();
    setVisualAudioManualTime(0);
    emitAudioFrame();
    const beats = new BeatAccumulator();
    for (let i = 0; i < 30; i++) {
      advanceWall(40);
      pumpVisualAudio(i * FRAME); // no emitAudioFrame() in the loop
      beats.sample();
    }
    setVisualAudioManualTime(null);

    expect(beats.total).toBeCloseTo(runManual(30, 40), 9);
  });

  it('analyser callbacks do not advance the follower while pinned', () => {
    resetFollower();
    setVisualAudioManualTime(0);
    emitAudioFrame();
    pumpVisualAudio(0);
    const afterFirstPump = getVisualAudioSnapshot().beatPhase;

    // Ten wall-clock analyser frames land with no pump between them.
    for (let i = 0; i < 10; i++) {
      advanceWall(16);
      emitAudioFrame();
    }
    expect(getVisualAudioSnapshot().beatPhase).toBe(afterFirstPump);
    setVisualAudioManualTime(null);
  });

  it('releases the clock cleanly and restores the pre-export state', () => {
    resetFollower();
    // Build up some live state.
    for (let i = 0; i < 10; i++) {
      advanceWall(FRAME * 1000);
      emitAudioFrame();
    }
    const beforeExport = getVisualAudioSnapshot();
    expect(isVisualAudioManualClock()).toBe(false);

    setVisualAudioManualTime(0);
    expect(isVisualAudioManualClock()).toBe(true);
    for (let i = 0; i < 60; i++) {
      advanceWall(40);
      emitAudioFrame();
      pumpVisualAudio(i * FRAME);
    }
    expect(getVisualAudioSnapshot().beatPhase).not.toBe(beforeExport.beatPhase);

    setVisualAudioManualTime(null);
    expect(isVisualAudioManualClock()).toBe(false);
    // The live show resumes exactly where it was, not mid-export-envelope.
    expect(getVisualAudioSnapshot().beatPhase).toBe(beforeExport.beatPhase);
    expect(getVisualAudioSnapshot().bass).toBe(beforeExport.bass);
  });

  it('leaves live mode on the wall clock when never pinned', () => {
    resetFollower();
    const a = runLive(15, 20);
    const b = runLive(15, 40);
    // Sanity: live mode is *supposed* to track real time. If these matched,
    // the test above would be proving nothing.
    expect(b).toBeGreaterThan(a * 1.5);
  });
});
