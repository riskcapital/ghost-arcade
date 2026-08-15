/**
 * Clip audio bus tests.
 *
 * Two things have to be nailed down here, and neither needs a real
 * AudioContext (the suite runs in vitest's `node` environment):
 *
 *   1. The OPT-IN GUARANTEE. A project where no clip sets `audioPlayback`
 *      must do literally nothing — no context, no nodes, no
 *      createMediaElementSource(), no element un-muted. That is the whole
 *      "not the default" requirement, and it is cheap to regress.
 *
 *   2. THE DRIFT POLICY. The audible element is a second decoder racing the
 *      native core's render clock. The controller has to converge without
 *      oscillating and without hard-seeking every frame (which is audible).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import * as visualAudio from './visualAudio';
import {
  ClipAudioBus,
  computeClipAudioDrift,
  CLIP_AUDIO_HARD_SEEK_SECONDS,
  CLIP_AUDIO_NUDGE_SECONDS,
  CLIP_AUDIO_MAX_NUDGE,
  type ClipAudioTransport,
} from './clipAudioBus';

// ── Minimal WebAudio double ────────────────────────────────────────────────

class FakeNode {
  outputs = new Set<FakeNode>();
  connect(target: FakeNode) { this.outputs.add(target); return target; }
  disconnect(target?: FakeNode) {
    if (target) this.outputs.delete(target);
    else this.outputs.clear();
  }
}
class FakeGainNode extends FakeNode { gain = { value: 1 }; }
class FakeMediaElementSourceNode extends FakeNode {
  constructor(public element: unknown) { super(); }
}
class FakeStreamDestinationNode extends FakeNode {
  stream = { getAudioTracks: () => [{ kind: 'audio' }] };
}

class FakeAudioContext {
  state = 'running';
  destination = new FakeNode();
  gainCount = 0;
  mediaElementSourceCount = 0;
  streamDestCount = 0;
  private wired = new Set<unknown>();

  createGain() { this.gainCount++; return new FakeGainNode(); }
  createMediaStreamDestination() { this.streamDestCount++; return new FakeStreamDestinationNode(); }
  createMediaElementSource(element: unknown) {
    // Real Chromium throws InvalidStateError on the second call for the same
    // element. The WeakMap guard in the bus exists precisely to avoid this.
    if (this.wired.has(element)) {
      throw new Error('InvalidStateError: element already connected to a MediaElementSourceNode');
    }
    this.wired.add(element);
    this.mediaElementSourceCount++;
    return new FakeMediaElementSourceNode(element);
  }
  resume() { return Promise.resolve(); }
}

interface FakeMediaElement {
  muted: boolean;
  volume: number;
  paused: boolean;
  loop: boolean;
  currentTime: number;
  playbackRate: number;
  duration: number;
  playCalls: number;
  pauseCalls: number;
  play(): Promise<void>;
  pause(): void;
}

/** Structural stand-in for HTMLMediaElement — only the members the bus
 *  actually touches. Cast at the call boundary so tests keep the concrete
 *  counters (playCalls / pauseCalls) that the real DOM type doesn't have. */
function fakeMediaElement(overrides: Partial<FakeMediaElement> = {}) {
  const el: FakeMediaElement = {
    muted: true,
    volume: 1,
    paused: true,
    loop: true,
    currentTime: 0,
    playbackRate: 1,
    duration: 60,
    playCalls: 0,
    pauseCalls: 0,
    play() { el.playCalls++; el.paused = false; return Promise.resolve(); },
    pause() { el.pauseCalls++; el.paused = true; },
    ...overrides,
  };
  return el as FakeMediaElement & HTMLMediaElement;
}

function transport(overrides: Partial<ClipAudioTransport> = {}): ClipAudioTransport {
  return {
    timeSeconds: 0,
    playbackRate: 1,
    paused: false,
    loop: true,
    trimStartSeconds: 0,
    trimEndSeconds: 60,
    seekGeneration: 1,
    durationSeconds: 60,
    ...overrides,
  };
}

const buses: ClipAudioBus[] = [];
function makeBus(ctx: FakeAudioContext, onGet?: () => void) {
  const bus = new ClipAudioBus(() => {
    onGet?.();
    return ctx as unknown as AudioContext;
  });
  buses.push(bus);
  return bus;
}

afterEach(() => {
  while (buses.length) buses.pop()!.dispose();
  vi.restoreAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. Default OFF
// ═══════════════════════════════════════════════════════════════════════════

describe('opt-in guarantee', () => {
  it('constructs nothing when no clip opts in', () => {
    const ctx = new FakeAudioContext();
    let contextRequests = 0;
    const bus = makeBus(ctx, () => { contextRequests++; });

    // Everything a caller might poll during normal operation.
    expect(bus.hasActiveOutput()).toBe(false);
    expect(bus.contextIfReady()).toBeNull();
    expect(bus.masterNode()).toBeNull();
    expect(bus.getMixStream()).toBeNull();
    expect(bus.attachedClipCount()).toBe(0);
    bus.tick();

    // The AudioContext was never even asked for.
    expect(contextRequests).toBe(0);
    expect(ctx.gainCount).toBe(0);
    expect(ctx.mediaElementSourceCount).toBe(0);
    expect(ctx.streamDestCount).toBe(0);
  });

  it('leaves elements muted until they are attached, and re-mutes on detach', () => {
    const ctx = new FakeAudioContext();
    const bus = makeBus(ctx);
    const el = fakeMediaElement();

    expect(el.muted).toBe(true);
    bus.attachClip('clip-a', el);
    expect(el.muted).toBe(false);

    bus.detachClip('clip-a');
    expect(el.muted).toBe(true);
    // Muted, NOT paused: for a mapping-mode media layer this element is also
    // the layer's texture source under the legacy engine, so turning audio
    // off must not freeze the picture.
    expect(el.pauseCalls).toBe(0);
  });

  it('setClipVolume / setClipMuted on an unknown clip build no graph', () => {
    const ctx = new FakeAudioContext();
    let contextRequests = 0;
    const bus = makeBus(ctx, () => { contextRequests++; });

    bus.setClipVolume('never-attached', 0.5);
    bus.setClipMuted('never-attached', true);

    expect(contextRequests).toBe(0);
    expect(bus.hasActiveOutput()).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Attach / detach lifecycle + the WeakMap guard
// ═══════════════════════════════════════════════════════════════════════════

describe('attach/detach lifecycle', () => {
  it('wires master → destination once and routes the clip through its own gain', () => {
    const ctx = new FakeAudioContext();
    const bus = makeBus(ctx);
    const el = fakeMediaElement();

    expect(bus.attachClip('clip-a', el)).toBe(true);
    expect(bus.hasActiveOutput()).toBe(true);
    expect(bus.attachedClipCount()).toBe(1);
    expect(ctx.mediaElementSourceCount).toBe(1);

    const master = bus.masterNode() as unknown as FakeNode;
    expect(master.outputs.has(ctx.destination)).toBe(true);
  });

  it('attaching the SAME element twice does not throw and does not double-wire', () => {
    const ctx = new FakeAudioContext();
    const bus = makeBus(ctx);
    const el = fakeMediaElement();

    expect(bus.attachClip('clip-a', el)).toBe(true);
    // The real hazard: createMediaElementSource() throws on the second call.
    expect(() => bus.attachClip('clip-a', el)).not.toThrow();
    expect(bus.attachClip('clip-a', el)).toBe(true);

    expect(ctx.mediaElementSourceCount).toBe(1);
    expect(bus.attachedClipCount()).toBe(1);
  });

  it('re-attaching an element AFTER a detach reuses the original source node', () => {
    const ctx = new FakeAudioContext();
    const bus = makeBus(ctx);
    const el = fakeMediaElement();

    bus.attachClip('clip-a', el);
    bus.detachClip('clip-a');
    expect(bus.attachedClipCount()).toBe(0);

    // An element is divorced from the default output permanently, so the
    // WeakMap must survive detach or this call would throw.
    expect(() => bus.attachClip('clip-a', el)).not.toThrow();
    expect(ctx.mediaElementSourceCount).toBe(1);
    expect(el.muted).toBe(false);
  });

  it('swapping a clip to a new element retires the old wiring', () => {
    const ctx = new FakeAudioContext();
    const bus = makeBus(ctx);
    const first = fakeMediaElement();
    const second = fakeMediaElement();

    bus.attachClip('clip-a', first);
    bus.attachClip('clip-a', second);

    expect(ctx.mediaElementSourceCount).toBe(2);
    expect(bus.attachedClipCount()).toBe(1);
    expect(first.muted).toBe(true);
    expect(second.muted).toBe(false);
  });

  it('detachElement unwires by element identity', () => {
    const ctx = new FakeAudioContext();
    const bus = makeBus(ctx);
    const el = fakeMediaElement();
    bus.attachClip('clip-a', el);
    bus.detachElement(el);
    expect(bus.attachedClipCount()).toBe(0);
    expect(bus.hasClip('clip-a')).toBe(false);
  });

  it('holds independent gains for multiple clips', () => {
    const ctx = new FakeAudioContext();
    const bus = makeBus(ctx);
    bus.attachClip('a', fakeMediaElement(), { volume: 0.25 });
    bus.attachClip('b', fakeMediaElement(), { volume: 0.75 });
    expect(bus.attachedClipCount()).toBe(2);
    expect(ctx.mediaElementSourceCount).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Volume / mute math
// ═══════════════════════════════════════════════════════════════════════════

describe('volume and mute', () => {
  it('master gain reflects volume, mute and suspend', () => {
    const ctx = new FakeAudioContext();
    const bus = makeBus(ctx);
    bus.attachClip('a', fakeMediaElement());
    const master = bus.masterNode() as unknown as FakeGainNode;

    expect(master.gain.value).toBe(1);

    bus.setMasterVolume(0.4);
    expect(master.gain.value).toBeCloseTo(0.4, 6);

    bus.setMasterMuted(true);
    expect(master.gain.value).toBe(0);

    bus.setMasterMuted(false);
    expect(master.gain.value).toBeCloseTo(0.4, 6);

    bus.suspend();
    expect(master.gain.value).toBe(0);
    bus.resume();
    expect(master.gain.value).toBeCloseTo(0.4, 6);
  });

  it('clamps master volume into 0..1 and survives garbage input', () => {
    const ctx = new FakeAudioContext();
    const bus = makeBus(ctx);
    bus.attachClip('a', fakeMediaElement());
    const master = bus.masterNode() as unknown as FakeGainNode;

    bus.setMasterVolume(5);
    expect(master.gain.value).toBe(1);
    bus.setMasterVolume(-3);
    expect(master.gain.value).toBe(0);
    bus.setMasterVolume(Number.NaN);
    expect(master.gain.value).toBe(1);
  });

  it('per-clip mute zeroes only that clip, master untouched', () => {
    const ctx = new FakeAudioContext();
    const bus = makeBus(ctx);
    bus.attachClip('a', fakeMediaElement(), { volume: 0.6 });
    const master = bus.masterNode() as unknown as FakeGainNode;

    bus.setClipMuted('a', true);
    expect(master.gain.value).toBe(1);

    bus.setClipVolume('a', 0.3);
    bus.setClipMuted('a', false);
    expect(master.gain.value).toBe(1);
  });

  it('a muted clip is left alone rather than chased', () => {
    const ctx = new FakeAudioContext();
    const bus = makeBus(ctx);
    const el = fakeMediaElement({ paused: false, currentTime: 10 });
    bus.attachClip('a', el, { provider: () => transport({ timeSeconds: 0 }) });

    bus.setClipMuted('a', true);
    bus.tick();
    // The 10 s of drift was NOT chased — nothing audible to correct — and the
    // element keeps playing so any texture it feeds keeps moving.
    expect(el.currentTime).toBe(10);
    expect(el.paused).toBe(false);
  });

  it('unmuting resyncs the accumulated drift with a single hard seek', () => {
    const ctx = new FakeAudioContext();
    const bus = makeBus(ctx);
    const el = fakeMediaElement({ paused: false, currentTime: 10 });
    bus.attachClip('a', el, { provider: () => transport({ timeSeconds: 3 }) });

    bus.setClipMuted('a', true);
    bus.tick();
    expect(el.currentTime).toBe(10);

    bus.setClipMuted('a', false);
    bus.tick();
    expect(el.currentTime).toBeCloseTo(3, 3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. Drift policy — pure math
// ═══════════════════════════════════════════════════════════════════════════

describe('computeClipAudioDrift', () => {
  it('does nothing inside the deadband', () => {
    const c = computeClipAudioDrift({
      authorityTime: 10,
      elementTime: 10 + CLIP_AUDIO_NUDGE_SECONDS * 0.5,
      baseRate: 1,
    });
    expect(c.seekTo).toBeNull();
    expect(c.playbackRate).toBe(1);
  });

  it('slows a leading element and speeds up a lagging one', () => {
    const ahead = computeClipAudioDrift({ authorityTime: 10, elementTime: 10.03, baseRate: 1 });
    expect(ahead.seekTo).toBeNull();
    expect(ahead.playbackRate).toBeCloseTo(1 - CLIP_AUDIO_MAX_NUDGE, 6);

    const behind = computeClipAudioDrift({ authorityTime: 10, elementTime: 9.97, baseRate: 1 });
    expect(behind.seekTo).toBeNull();
    expect(behind.playbackRate).toBeCloseTo(1 + CLIP_AUDIO_MAX_NUDGE, 6);
  });

  it('scales the nudge with the transport rate', () => {
    const c = computeClipAudioDrift({ authorityTime: 10, elementTime: 10.03, baseRate: 2 });
    expect(c.playbackRate).toBeCloseTo(2 * (1 - CLIP_AUDIO_MAX_NUDGE), 6);
  });

  it('hard-seeks past the threshold', () => {
    const c = computeClipAudioDrift({
      authorityTime: 10,
      elementTime: 10 + CLIP_AUDIO_HARD_SEEK_SECONDS + 0.001,
      baseRate: 1,
    });
    expect(c.seekTo).toBe(10);
    expect(c.playbackRate).toBe(1);
  });

  it('forceSeek overrides an otherwise-fine drift (loop wrap / seek generation)', () => {
    const c = computeClipAudioDrift({
      authorityTime: 3, elementTime: 3.001, baseRate: 1, forceSeek: true,
    });
    expect(c.seekTo).toBe(3);
  });

  it('tolerates non-finite input without producing a NaN rate', () => {
    const c = computeClipAudioDrift({ authorityTime: 5, elementTime: Number.NaN, baseRate: 1 });
    expect(c.seekTo).toBe(5);
    expect(Number.isFinite(c.playbackRate)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. Drift policy — convergence simulation (the numbers in the report)
// ═══════════════════════════════════════════════════════════════════════════

interface SimResult {
  seeks: number;
  frames: number;
  framesToConverge: number;
  finalDrift: number;
  maxAbsDriftAfterConverge: number;
  signFlips: number;
  peakRateDeviation: number;
}

/**
 * Run the controller against a synthetic authority clock.
 *
 * `authority` advances at exactly `baseRate` seconds of media per second of
 * wall time — that is the native core's render clock. `element` advances at
 * whatever rate the controller last asked for. Everything is in seconds.
 */
function simulate(opts: {
  baseRate: number;
  initialOffset: number;
  seconds?: number;
  fps?: number;
  /** Fractional clock error baked into the element, e.g. 0.002 = 0.2% fast. */
  elementClockError?: number;
}): SimResult {
  const fps = opts.fps ?? 60;
  const dt = 1 / fps;
  const frames = Math.round((opts.seconds ?? 5) * fps);
  const err = opts.elementClockError ?? 0;

  let authority = 0;
  let element = opts.initialOffset;
  let rate = opts.baseRate;
  let seeks = 0;
  let framesToConverge = -1;
  let maxAbsDriftAfterConverge = 0;
  let signFlips = 0;
  let peakRateDeviation = 0;
  let lastSign = 0;

  for (let i = 0; i < frames; i++) {
    const c = computeClipAudioDrift({
      authorityTime: authority,
      elementTime: element,
      baseRate: opts.baseRate,
    });
    if (c.seekTo !== null) { element = c.seekTo; seeks++; }
    rate = c.playbackRate;
    peakRateDeviation = Math.max(peakRateDeviation, Math.abs(rate / opts.baseRate - 1));

    const drift = element - authority;
    if (framesToConverge < 0 && Math.abs(drift) <= CLIP_AUDIO_NUDGE_SECONDS) {
      framesToConverge = i;
    }
    if (framesToConverge >= 0) {
      maxAbsDriftAfterConverge = Math.max(maxAbsDriftAfterConverge, Math.abs(drift));
      const sign = drift > 1e-9 ? 1 : drift < -1e-9 ? -1 : 0;
      if (sign !== 0 && lastSign !== 0 && sign !== lastSign) signFlips++;
      if (sign !== 0) lastSign = sign;
    }

    authority += opts.baseRate * dt;
    element += rate * (1 + err) * dt;
  }

  return {
    seeks,
    frames,
    framesToConverge,
    finalDrift: element - authority,
    maxAbsDriftAfterConverge,
    signFlips,
    peakRateDeviation,
  };
}

describe('drift convergence', () => {
  it('1x: a 50 ms lead closes by nudging only — no seeks, no oscillation', () => {
    const r = simulate({ baseRate: 1, initialOffset: 0.05, seconds: 5 });

    expect(r.seeks).toBe(0);
    expect(r.framesToConverge).toBeGreaterThan(0);
    // Slew is maxNudge * baseRate = 0.05 s of drift per second, so closing
    // 50 → 12 ms takes ~0.76 s ≈ 46 frames at 60 fps.
    expect(r.framesToConverge).toBeLessThanOrEqual(50);
    expect(Math.abs(r.finalDrift)).toBeLessThanOrEqual(CLIP_AUDIO_NUDGE_SECONDS);
    // Once inside the deadband the controller stops; it never overshoots
    // through zero, so the drift never changes sign.
    expect(r.signFlips).toBe(0);
    expect(r.maxAbsDriftAfterConverge).toBeLessThanOrEqual(CLIP_AUDIO_NUDGE_SECONDS + 1e-9);
    expect(r.peakRateDeviation).toBeCloseTo(CLIP_AUDIO_MAX_NUDGE, 6);
  });

  it('2x: a 40 ms lag closes twice as fast, still without seeking', () => {
    const r = simulate({ baseRate: 2, initialOffset: -0.04, seconds: 5 });

    expect(r.seeks).toBe(0);
    // Slew at 2x is 0.1 s/s, so 40 → 12 ms is ~0.28 s ≈ 17 frames.
    expect(r.framesToConverge).toBeGreaterThan(0);
    expect(r.framesToConverge).toBeLessThanOrEqual(20);
    expect(Math.abs(r.finalDrift)).toBeLessThanOrEqual(CLIP_AUDIO_NUDGE_SECONDS);
    expect(r.signFlips).toBe(0);
  });

  it('a large offset costs exactly one hard seek, then never seeks again', () => {
    const r = simulate({ baseRate: 1, initialOffset: 0.5, seconds: 5 });
    expect(r.seeks).toBe(1);
    expect(r.framesToConverge).toBe(0);
    expect(Math.abs(r.finalDrift)).toBeLessThanOrEqual(CLIP_AUDIO_NUDGE_SECONDS);
    expect(r.signFlips).toBe(0);
  });

  it('a persistently fast element clock is held inside the seek threshold', () => {
    // 0.5% clock error is far worse than any real decoder; the controller
    // must still never reach the hard-seek threshold (which would be an
    // audible glitch every few seconds).
    const r = simulate({ baseRate: 1, initialOffset: 0, seconds: 60, elementClockError: 0.005 });
    expect(r.seeks).toBe(0);
    expect(r.maxAbsDriftAfterConverge).toBeLessThan(CLIP_AUDIO_HARD_SEEK_SECONDS);
    expect(Math.abs(r.finalDrift)).toBeLessThan(CLIP_AUDIO_HARD_SEEK_SECONDS);
  });

  it('the per-frame correction is an order of magnitude below the deadband', () => {
    // This is *why* it cannot oscillate: one frame of full-magnitude nudge
    // moves the drift by far less than the width of the deadband, so the
    // controller can never step from one side of it to the other.
    const perFrameSlew = CLIP_AUDIO_MAX_NUDGE * 1 * (1 / 60);
    expect(perFrameSlew).toBeLessThan(CLIP_AUDIO_NUDGE_SECONDS / 10);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. Sync tick behaviour
// ═══════════════════════════════════════════════════════════════════════════

describe('sync tick', () => {
  it('pauses the element when the authority says paused', () => {
    const ctx = new FakeAudioContext();
    const bus = makeBus(ctx);
    const el = fakeMediaElement({ paused: false });
    bus.attachClip('a', el, { provider: () => transport({ paused: true }) });

    bus.tick();
    expect(el.paused).toBe(true);
  });

  it('starts a paused element when the authority is rolling', () => {
    const ctx = new FakeAudioContext();
    const bus = makeBus(ctx);
    const el = fakeMediaElement({ paused: true, currentTime: 0 });
    bus.attachClip('a', el, { provider: () => transport({ timeSeconds: 0 }) });

    bus.tick();
    expect(el.paused).toBe(false);
  });

  it('hard-seeks on a seek-generation bump even when drift is tiny', () => {
    const ctx = new FakeAudioContext();
    const bus = makeBus(ctx);
    const el = fakeMediaElement({ paused: false, currentTime: 20 });
    let generation = 1;
    bus.attachClip('a', el, {
      provider: () => transport({ timeSeconds: 20.001, seekGeneration: generation }),
    });

    bus.tick();          // first tick establishes the generation, and seeks
    el.currentTime = 20.001;
    bus.tick();          // same generation, drift inside deadband → no seek
    expect(el.currentTime).toBeCloseTo(20.001, 6);

    generation = 2;      // an explicit restart / scrub
    el.currentTime = 25;
    bus.tick();
    expect(el.currentTime).toBeCloseTo(20.001, 3);
  });

  it('wraps at the trim out-point instead of running past it', () => {
    const ctx = new FakeAudioContext();
    const bus = makeBus(ctx);
    const el = fakeMediaElement({ paused: false, currentTime: 9.9 });
    bus.attachClip('a', el, {
      provider: () => transport({
        timeSeconds: 2.05, trimStartSeconds: 2, trimEndSeconds: 9.9, seekGeneration: 1,
      }),
    });

    bus.tick();
    expect(el.currentTime).toBeGreaterThanOrEqual(2);
    expect(el.currentTime).toBeLessThan(9.9);
  });

  it('turns the element\'s own loop off — the bus owns wrapping to trimStart', () => {
    const ctx = new FakeAudioContext();
    const bus = makeBus(ctx);
    const el = fakeMediaElement({ paused: false, loop: true, currentTime: 5 });
    bus.attachClip('a', el, { provider: () => transport({ timeSeconds: 5 }) });

    bus.tick();
    expect(el.loop).toBe(false);
  });

  it('is inert for clips with no transport provider', () => {
    const ctx = new FakeAudioContext();
    const bus = makeBus(ctx);
    const el = fakeMediaElement({ paused: true, currentTime: 3 });
    bus.attachClip('a', el);

    bus.tick();
    expect(el.currentTime).toBe(3);
    expect(el.playCalls).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. Offline export must never be audible
// ═══════════════════════════════════════════════════════════════════════════

describe('manual clock (offline render)', () => {
  it('silences the master and parks elements instead of chasing virtual time', () => {
    const ctx = new FakeAudioContext();
    const bus = makeBus(ctx);
    const el = fakeMediaElement({ paused: false, currentTime: 4 });
    bus.attachClip('a', el, { provider: () => transport({ timeSeconds: 4 }) });
    const master = bus.masterNode() as unknown as FakeGainNode;

    bus.tick();
    expect(master.gain.value).toBe(1);
    expect(el.paused).toBe(false);

    const manual = vi.spyOn(visualAudio, 'isVisualAudioManualClock').mockReturnValue(true);
    bus.tick();
    expect(master.gain.value).toBe(0);
    // Silenced, not paused — under the legacy engine this element can be the
    // layer's texture source, and pausing it would freeze the export.
    expect(el.paused).toBe(false);

    // Sync stays parked for the whole export — a virtual timeline jumping
    // around must not turn into a scrub-fest on the live element.
    el.currentTime = 999;
    bus.tick();
    expect(el.currentTime).toBe(999);

    manual.mockReturnValue(false);
    bus.tick();
    expect(master.gain.value).toBe(1);
  });

  it('respects an explicit master mute even after the export releases the clock', () => {
    const ctx = new FakeAudioContext();
    const bus = makeBus(ctx);
    bus.attachClip('a', fakeMediaElement({ paused: false }));
    const master = bus.masterNode() as unknown as FakeGainNode;

    bus.setMasterMuted(true);
    const manual = vi.spyOn(visualAudio, 'isVisualAudioManualClock').mockReturnValue(true);
    bus.tick();
    expect(master.gain.value).toBe(0);

    manual.mockReturnValue(false);
    bus.tick();
    expect(master.gain.value).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. Recording tap
// ═══════════════════════════════════════════════════════════════════════════

describe('mix stream', () => {
  it('is null until a clip is attached, then stable across calls', () => {
    const ctx = new FakeAudioContext();
    const bus = makeBus(ctx);
    expect(bus.getMixStream()).toBeNull();
    expect(ctx.streamDestCount).toBe(0);

    bus.attachClip('a', fakeMediaElement());
    const first = bus.getMixStream();
    expect(first).not.toBeNull();
    // Repeated recordings must not stack destination nodes on the master.
    expect(bus.getMixStream()).toBe(first);
    expect(ctx.streamDestCount).toBe(1);
  });
});
