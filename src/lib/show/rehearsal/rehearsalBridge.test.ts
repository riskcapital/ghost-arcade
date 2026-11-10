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
