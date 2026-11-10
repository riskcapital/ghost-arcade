import { describe, expect, it, vi } from 'vitest';
import {
  executeRehearsalCommand,
  markerJumpTarget,
  normalizeAudioDelay,
  planMuxTracks,
  rehearsalAudioPlan,
  showTimeAt,
  evaluateCameraLane,
  cameraClipAt,
  formatShowClock,
  createSeekThrottle,
  rehearsalArrangementKey,
  rehearsalTransportTick,
  createClockSkewEstimator,
  clockSkewAllowsExact,
  playRate,
  type RecAudioPlan,
  type RehearsalShowState,
  type RehearsalTransport,
  type TransportSample,
} from './rehearsalBridge';
import type { DemoShot } from '../../stage3d/demoReel';

function fakeTransport(init: { t?: number; playing?: boolean; duration?: number; chasing?: boolean; markers?: number[] } = {}) {
  const st = { currentTime: init.t ?? 0, isPlaying: !!init.playing, duration: init.duration ?? 20, loop: false };
  const calls: string[] = [];
  const t: RehearsalTransport & { calls: string[]; st: typeof st } = {
    calls,
    st,
    isChasing: () => !!init.chasing,
    state: () => ({ ...st }),
    markers: () => init.markers ?? [],
    play: () => { calls.push('play'); st.isPlaying = true; },
    pause: () => { calls.push('pause'); st.isPlaying = false; },
    stop: () => { calls.push('stop'); st.isPlaying = false; st.currentTime = 0; },
    seek: (x) => { calls.push(`seek:${x}`); st.currentTime = x; },
    setLoop: (on) => { calls.push(`loop:${on}`); st.loop = on; },
    setAudioDelay: vi.fn(),
    returnTakeover: (instant) => { calls.push(`return:${instant}`); },
  };
  return t;
}

describe('show transport mirror', () => {
  it('extrapolates a playing show from its publish instant', () => {
    const s = { currentTime: 3, at: 10_000, isPlaying: true, duration: 20, loop: false };
    expect(showTimeAt(s, 10_250)).toBeCloseTo(3.25);
    expect(showTimeAt({ ...s, isPlaying: false }, 10_250)).toBe(3);
    // A stalled editor does not run the stage far ahead.
    expect(showTimeAt(s, 15_000)).toBeCloseTo(3.5);
    expect(showTimeAt({ ...s, currentTime: 19.9 }, 10_400)).toBe(20);
    expect(showTimeAt({ ...s, currentTime: 19.9, loop: true }, 10_400)).toBeCloseTo(0.3);
  });

  it('steps between markers, skipping one just passed when going back', () => {
    const m = [2, 6, 10];
    expect(markerJumpTarget(m, 3, 1)).toBe(6);
    expect(markerJumpTarget(m, 6, 1)).toBe(10);
    expect(markerJumpTarget(m, 10, 1)).toBeNull();
    expect(markerJumpTarget(m, 7, -1)).toBe(6);
    expect(markerJumpTarget(m, 6.1, -1)).toBe(2);
    expect(markerJumpTarget(m, 1, -1)).toBe(0);
    expect(markerJumpTarget([], 5, -1)).toBe(0);
  });

  it('carries out commands on the editor transport', () => {
    const t = fakeTransport({ t: 3, markers: [2, 6] });
    expect(executeRehearsalCommand({ op: 'toggle' }, t).ok).toBe(true);
    expect(t.st.isPlaying).toBe(true);
    executeRehearsalCommand({ op: 'toggle' }, t);
    expect(t.st.isPlaying).toBe(false);
    executeRehearsalCommand({ op: 'marker', dir: 1 }, t);
    expect(t.st.currentTime).toBe(6);
    executeRehearsalCommand({ op: 'home' }, t);
    expect(t.st.currentTime).toBe(0);
    executeRehearsalCommand({ op: 'seek', seconds: 99 }, t);
    expect(t.st.currentTime).toBe(20);
    executeRehearsalCommand({ op: 'playFrom', seconds: 4 }, t);
    expect(t.calls.slice(-2)).toEqual(['seek:4', 'play']);
    executeRehearsalCommand({ op: 'loop', on: true }, t);
    expect(t.st.loop).toBe(true);
  });

  it('refuses transport commands while timecode drives the show, not the audio delay', () => {
    const t = fakeTransport({ chasing: true });
    expect(executeRehearsalCommand({ op: 'play' }, t)).toEqual({ ok: false, reason: 'chasing' });
    expect(t.calls).toEqual([]);
    expect(executeRehearsalCommand({ op: 'audioDelay', enabled: true, seconds: 2 }, t).ok).toBe(true);
    expect(t.setAudioDelay).toHaveBeenCalledWith({ enabled: true, seconds: 0.5 });
  });

  it('Return hands tracks back even while a clock drives the show', () => {
    const t = fakeTransport({ chasing: true });
    expect(executeRehearsalCommand({ op: 'takeoverReturn', instant: false }, t).ok).toBe(true);
    expect(executeRehearsalCommand({ op: 'takeoverReturn', instant: true }, t).ok).toBe(true);
    expect(t.calls).toEqual(['return:false', 'return:true']);
  });

  it('an empty show ignores commands', () => {
    const t = fakeTransport({ duration: 0 });
    expect(executeRehearsalCommand({ op: 'play' }, t)).toEqual({ ok: false, reason: 'empty' });
  });

  it('normalises the audio delay', () => {
    expect(normalizeAudioDelay(null)).toEqual({ enabled: false, seconds: 0 });
    expect(normalizeAudioDelay({ enabled: true, seconds: -1 })).toEqual({ enabled: true, seconds: 0 });
    expect(normalizeAudioDelay({ enabled: true, seconds: 0.08 })).toEqual({ enabled: true, seconds: 0.08 });
  });

  it('formats the clock', () => {
    expect(formatShowClock(0)).toBe('0:00.0');
    expect(formatShowClock(75.25)).toBe('1:15.3');
  });
});

describe('stage camera lane', () => {
  const shot = (id: string, x: number): DemoShot => ({
    id, name: id, durationSec: 5, easing: 'linear', moveId: 'custom', arc: false,
    from: { position: [x, 0, 10], target: [0, 0, 0], fov: 50 },
    to: { position: [x + 10, 0, 10], target: [0, 0, 0], fov: 50 },
    baseCamera: { position: [x, 0, 10], target: [0, 0, 0], fov: 50 },
    stage: {} as DemoShot['stage'],
  });
  const lane = [
    { id: 'a', startTime: 0, duration: 4, shotId: 's1' },
    { id: 'b', startTime: 4, duration: 2, shotId: 's2' },
    { id: 'c', startTime: 8, duration: 2, shotId: 'gone' },
  ];
  const shots = [shot('s1', 0), shot('s2', 100)];

  it('finds the clip under the playhead (half-open)', () => {
    expect(cameraClipAt(lane, 0)?.id).toBe('a');
    expect(cameraClipAt(lane, 3.999)?.id).toBe('a');
    expect(cameraClipAt(lane, 4)?.id).toBe('b');
    expect(cameraClipAt(lane, 6)).toBeNull();
  });

  it('evaluates the shot move over the clip, not the shot length', () => {
    const at = evaluateCameraLane(lane, shots, 2);
    expect(at?.shot.id).toBe('s1');
    expect(at?.progress).toBeCloseTo(0.5);
    expect(at?.camera.position[0]).toBeCloseTo(5);
    expect(evaluateCameraLane(lane, shots, 5)?.camera.position[0]).toBeCloseTo(105);
  });

  it('a gap, or a shot that no longer exists, asks for nothing', () => {
    expect(evaluateCameraLane(lane, shots, 7)).toBeNull();
    expect(evaluateCameraLane(lane, shots, 9)).toBeNull();
  });
});

describe('recording soundtrack plan', () => {
  /** Samples of a show playing from `from` at wall `startAt` (ms) for `seconds`. */
  function play(from: number, startAt: number, seconds: number, gen: number, step = 16.7): TransportSample[] {
    const out: TransportSample[] = [];
    for (let ms = 0; ms <= seconds * 1000; ms += step) out.push({ at: startAt + ms, showTime: from + ms / 1000, playing: true, seekGeneration: gen });
    return out;
  }

  it('a show playing throughout: video time 0 hears the show time at the first frame, moved by the latency', () => {
    const samples = play(10, 0, 8, 1);
    const plan = rehearsalAudioPlan(samples, 2000, 5, 0.05);
    expect(plan.kind).toBe('exact');
    if (plan.kind !== 'exact') return;
    // Frame 0 is wall 2 s = show 12 s; the picture runs 50 ms late.
    expect(plan.videoAt).toBe(0);
    expect(plan.showFrom).toBeCloseTo(12 - 0.05, 3);
    expect(plan.length).toBeCloseTo(5, 3);
  });

  it('a paused lead-in is silence, then the show from where it started', () => {
    const samples: TransportSample[] = [
      { at: 0, showTime: 3, playing: false, seekGeneration: 1 },
      ...play(3, 1500, 4, 2),
    ];
    const plan = rehearsalAudioPlan(samples, 0, 5, 0.04);
    expect(plan.kind).toBe('exact');
    if (plan.kind !== 'exact') return;
    expect(plan.showFrom).toBeCloseTo(3);
    expect(plan.videoAt).toBeCloseTo(1.54, 3);
    expect(plan.length).toBeCloseTo(5 - 1.54, 3);
  });

  it('pausing before the end cuts the sound there', () => {
    const samples = [...play(0, 0, 2, 1), { at: 2100, showTime: 2.1, playing: false, seekGeneration: 2 }];
    const plan = rehearsalAudioPlan(samples, 0, 5);
    expect(plan.kind === 'exact' && plan.length).toBeCloseTo(2.1, 3);
  });

  it('a seek, a second play or a loop wrap is a discontinuity', () => {
    const seek = [...play(0, 0, 1, 1), ...play(8, 1000, 2, 2)];
    expect(rehearsalAudioPlan(seek, 0, 3).kind).toBe('discontinuous');
    const twice = [...play(0, 0, 1, 1), { at: 1000, showTime: 1, playing: false, seekGeneration: 2 }, ...play(1, 1500, 1, 3)];
    expect(rehearsalAudioPlan(twice, 0, 3).kind).toBe('discontinuous');
    // A jump that kept the generation (should not happen, but) is caught by the clock check.
    const jump = [...play(0, 0, 1, 1), ...play(5, 1017, 1, 1)];
    expect(rehearsalAudioPlan(jump, 0, 2).kind).toBe('discontinuous');
  });

  it('a show time read late (between ticks, a busy editor) is not a jump', () => {
    const samples = play(0, 0, 3, 1);
    samples[60] = { ...samples[60], showTime: samples[60].showTime - 0.2 };
    const plan = rehearsalAudioPlan(samples, 500, 2);
    expect(plan.kind).toBe('exact');
    if (plan.kind === 'exact') expect(plan.showFrom).toBeCloseTo(0.5, 2);
  });

  it('a show that never played during the recording is silent', () => {
    expect(rehearsalAudioPlan([{ at: 0, showTime: 2, playing: false, seekGeneration: 1 }], 0, 5).kind).toBe('silent');
    // Played and stopped before the recording started.
    const before = [...play(0, 0, 1, 1), { at: 1000, showTime: 1, playing: false, seekGeneration: 2 }];
    expect(rehearsalAudioPlan(before, 5000, 2).kind).toBe('silent');
  });

  it('places each track on the recording timeline, cut to what was heard', () => {
    const tracks = [
      { path: '/a.wav', startTime: 0, offset: 1, duration: 10, volume: 1 },
      { path: '/b.wav', startTime: 12, offset: 0, duration: 5, volume: 0.5 },
      { path: '/c.wav', startTime: 30, offset: 0, duration: 5, volume: 1 },
    ];
    const out = planMuxTracks(tracks, { kind: 'exact', showFrom: 8, videoAt: 0.5, length: 5 });
    expect(out).toEqual([
      { path: '/a.wav', startTime: 0.5, offset: 9, duration: 2, volume: 1 },
      { path: '/b.wav', startTime: 4.5, offset: 0, duration: 1, volume: 0.5 },
    ]);
  });
});

/** The plan as first written (a span's end searched over the whole take):
 *  the one-pass version must agree with it exactly. */
function referencePlan(samples: readonly TransportSample[], startedAt: number, durationSeconds: number, latency = 0): RecAudioPlan {
  const endAt = startedAt + durationSeconds * 1000;
  const ordered = [...samples].sort((a, b) => a.at - b.at);
  const spans: TransportSample[][] = [];
  let current: TransportSample[] | null = null;
  for (const s of ordered) {
    if (!s.playing) { current = null; continue; }
    if (!current || current[current.length - 1].seekGeneration !== s.seekGeneration) { current = [s]; spans.push(current); } else current.push(s);
  }
  const spanEnd = (span: TransportSample[]): number => {
    const last = span[span.length - 1];
    const next = ordered.find((s) => s.at > last.at && (!s.playing || s.seekGeneration !== last.seekGeneration));
    return next ? next.at : Number.POSITIVE_INFINITY;
  };
  const overlapping = spans.filter((span) => span[0].at < endAt && spanEnd(span) > startedAt);
  if (overlapping.length === 0) return { kind: 'silent' };
  if (overlapping.length > 1) return { kind: 'discontinuous', reason: 'the show was paused and played again, or jumped' };
  const span = overlapping[0];
  const offsets = span.map((s) => s.showTime - s.at / 1000).sort((a, b) => a - b);
  const offset = offsets[Math.min(offsets.length - 1, Math.floor(offsets.length * 0.9))];
  if (offsets[offsets.length - 1] - offset > 0.12 || offset - offsets[0] > 0.5) return { kind: 'discontinuous', reason: 'the show jumped while it played' };
  const playFrom = span[0].showTime;
  const playStartAt = (playFrom - offset) * 1000;
  const playEndAt = spanEnd(span);
  let videoAt = (playStartAt - startedAt) / 1000 + latency;
  let showFrom = playFrom;
  if (videoAt < 0) { showFrom -= videoAt; videoAt = 0; }
  const videoEnd = Math.min(durationSeconds, (playEndAt - startedAt) / 1000 + latency);
  const length = videoEnd - videoAt;
  if (!(length > 0)) return { kind: 'silent' };
  return { kind: 'exact', showFrom, videoAt, length };
}

describe('recording soundtrack plan, long takes', () => {
  /** A take of play runs, pauses and seeks, with equal timestamps now and then. */
  function randomTake(seed: number, n: number): TransportSample[] {
    let x = seed;
    const rnd = () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; };
    const out: TransportSample[] = [];
    let at = 1000, show = 0, gen = 0, playing = false;
    for (let i = 0; i < n; i++) {
      const r = rnd();
      if (r < 0.05) playing = !playing;
      else if (r < 0.1) { gen++; show = rnd() * 100; }
      // Shows play at normal speed here (show time follows the clock).
      const dt = r < 0.15 ? 0 : 16 + rnd() * 4;
      at += dt;
      if (playing) show += dt / 1000;
      out.push({ at, showTime: show, playing, seekGeneration: gen });
    }
    return out;
  }

  it('agrees with the plan as first written, on many random takes', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const take = randomTake(seed, 40 + (seed % 7) * 30);
      const first = take[0].at, last = take[take.length - 1].at;
      for (const [from, dur] of [[first, (last - first) / 1000], [first + (last - first) * 0.5, 0.4], [first + (last - first) * 0.8, 3], [last + 10, 1]]) {
        expect(rehearsalAudioPlan(take, from, dur, 0.05)).toEqual(referencePlan(take, from, dur, 0.05));
      }
    }
  });

  it('plans an hour of scrubbing at once (it took ~20 s at Stop)', () => {
    const samples: TransportSample[] = [];
    let gen = 0, show = 0, at = 1_700_000_000_000;
    for (let i = 0; i < 216_000; i++) {
      if (i % 180 < 60) { gen++; show = (show + 0.3) % 3000; } else show += 1 / 60;
      samples.push({ at, showTime: show, playing: true, seekGeneration: gen });
      at += 1000 / 60;
    }
    const recStart = at;
    gen++;
    for (let i = 0; i < 600; i++) { samples.push({ at, showTime: 100 + i / 60, playing: true, seekGeneration: gen }); at += 1000 / 60; }
    const t0 = performance.now();
    expect(rehearsalAudioPlan(samples, samples[0].at, 3610, 0).kind).toBe('discontinuous');
    const plan = rehearsalAudioPlan(samples, recStart, 10, 0);
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(plan.kind).toBe('exact');
  });
});

describe('scrub seeks', () => {
  it('a drag sends the latest position at most every interval; press and release go out at once', () => {
    vi.useFakeTimers();
    let now = 0;
    const sent: number[] = [];
    const th = createSeekThrottle((t) => sent.push(t), 100, () => now);
    th.seek(1, true); // press
    for (let i = 1; i <= 30; i++) { now += 10; vi.advanceTimersByTime(10); th.seek(1 + i); } // 300 ms of moves
    expect(sent).toEqual([1, 10, 20, 30]);
    now += 40; vi.advanceTimersByTime(40);
    th.seek(40); now += 5; vi.advanceTimersByTime(5);
    th.seek(41, true); // release: exact, and the pending one is dropped
    now += 200; vi.advanceTimersByTime(200);
    expect(sent).toEqual([1, 10, 20, 30, 41]);
    th.seek(50, true);
    th.seek(51); // a pointer that stops right after: its last position still goes out
    expect(sent[sent.length - 1]).toBe(50);
    now += 100; vi.advanceTimersByTime(100);
    expect(sent[sent.length - 1]).toBe(51);
    th.seek(60); th.seek(61); // pending…
    th.cancel(); // …and dropped (the bar went away)
    now += 200; vi.advanceTimersByTime(200);
    expect(sent[sent.length - 1]).toBe(51);
    vi.useRealTimers();
  });
});

describe('show state publish split', () => {
  const state: RehearsalShowState = {
    hasShow: true, currentTime: 3, at: 1000, isPlaying: true, duration: 20, loop: false, seekGeneration: 2, chasing: false,
    tempo: null, hasAudio: true, presets: [{ id: 'p', start: 0, duration: 4, label: 'A' }], markers: [{ id: 'm', time: 2, label: '' }],
    cameraLane: [], audioDelay: { enabled: false, seconds: 0 }, takeover: null,
  };
  it('the tick carries the playhead; the arrangement key ignores it', () => {
    expect(rehearsalTransportTick(state)).toEqual({ currentTime: 3, at: 1000, isPlaying: true, seekGeneration: 2, chasing: false });
    const moved = { ...state, currentTime: 9, at: 5000, isPlaying: false, seekGeneration: 7, chasing: true };
    expect(rehearsalArrangementKey(moved)).toBe(rehearsalArrangementKey(state));
    expect(rehearsalArrangementKey({ ...state, presets: [{ ...state.presets[0], label: 'B' }] })).not.toBe(rehearsalArrangementKey(state));
    expect(rehearsalArrangementKey({ ...state, loop: true })).not.toBe(rehearsalArrangementKey(state));
  });
});


describe('recording soundtrack plan: show speed', () => {
  /** 10 s of play logged at 60 Hz with a little read jitter, at `rate` show seconds per second. */
  function take(rate: number, from = 20): TransportSample[] {
    const out: TransportSample[] = [];
    let x = 7;
    const rnd = () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; };
    for (let i = 0; i <= 600; i++) {
      const at = 1_000_000 + (i * 1000) / 60;
      out.push({ at, showTime: from + ((at - 1_000_000) / 1000) * rate - rnd() * 0.012, playing: true, seekGeneration: 3 });
    }
    return out;
  }

  it('takes the song files when the show plays at normal speed', () => {
    const plan = rehearsalAudioPlan(take(1), 1_000_000, 10, 0.1);
    expect(plan.kind).toBe('exact');
    expect(playRate(take(1), 0, 600)).toBeCloseTo(1, 3);
  });

  it('refuses them while chasing at another tempo (it accepted ~0.5 s of drift)', () => {
    // 95% speed: the show falls 0.5 s behind the song file over 10 s.
    const plan = rehearsalAudioPlan(take(0.95), 1_000_000, 10, 0.1);
    expect(plan).toMatchObject({ kind: 'discontinuous' });
    expect((plan as { reason: string }).reason).toMatch(/95\.0% speed/);
    expect(rehearsalAudioPlan(take(1.03), 1_000_000, 10, 0.1).kind).toBe('discontinuous');
    // A drift smaller than a frame over the take is fine.
    expect(rehearsalAudioPlan(take(1.002), 1_000_000, 10, 0.1).kind).toBe('exact');
  });
});

describe('clock skew between the two windows', () => {
  it('estimates from the quickest message and judges whether the plan can be trusted', () => {
    const est = createClockSkewEstimator(4);
    expect(est.value()).toBeNull();
    expect(clockSkewAllowsExact(est.value())).toBe(false);
    // Stage clock 2 ms behind; transit 3-40 ms.
    for (const transit of [40, 3, 12, 25]) est.note(1000, 1000 + 2 + transit);
    expect(est.value()).toBe(5);
    expect(clockSkewAllowsExact(est.value())).toBe(true);
    // After a sleep the stage window runs 120 s behind.
    est.reset();
    for (const transit of [4, 9]) est.note(1000, 1000 + 120_000 + transit);
    expect(est.value()).toBe(120_004);
    expect(clockSkewAllowsExact(est.value())).toBe(false);
    expect(clockSkewAllowsExact(-300)).toBe(false);
  });
});
