import { beforeEach, describe, expect, it, vi } from 'vitest';

const { clock, linkStore } = await vi.hoisted(async () => {
  const { writable } = await import('svelte/store');
  return { clock: { beat: 0, beatMs: 500, link: false }, linkStore: writable({ tempo: 120, offsetMs: 0 }) };
});
vi.mock('../stores/launchClock', () => ({
  launchClockPosition: () => ({ beat: clock.beat, beatMs: clock.beatMs }),
  launchClockFollowsLink: () => clock.link,
  resyncLaunchClock: () => !clock.link,
}));
vi.mock('../sync/abletonLink', () => ({ abletonLink: linkStore }));

import { AudioLoopEngine } from './audioLoopEngine';
import type { MusicAudioEngine } from './audioEngine';

/** Just enough of an AudioContext to see when and how fast loops play. */
function fakeContext() {
  const param = (value = 0) => ({ value, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), setTargetAtTime: vi.fn(), cancelAndHoldAtTime: vi.fn() });
  const node = () => ({ connect: (n: unknown) => n, disconnect: () => {} });
  const sources: Array<{ startAt: number; offset: number; playbackRate: ReturnType<typeof param> }> = [];
  const ctx = {
    currentTime: 0,
    sampleRate: 48000,
    baseLatency: 0.005,
    outputLatency: 0.02,
    createGain: () => ({ ...node(), gain: param(1) }),
    createAnalyser: () => ({ ...node(), fftSize: 512, getFloatTimeDomainData: () => {} }),
    createBuffer: (_c: number, length: number, sr: number) => ({ length, duration: length / sr, copyToChannel: () => {} }),
    createBufferSource() {
      const src = { ...node(), buffer: null as unknown, loop: false, playbackRate: param(1), onended: null, startAt: 0, offset: 0, start(at: number, offset: number) { src.startAt = at; src.offset = offset; }, stop: () => {} };
      sources.push(src);
      return src;
    },
  };
  return { ctx, sources };
}

function engineWithLoop() {
  const { ctx, sources } = fakeContext();
  const music = { loopGraph: () => ({ ctx, out: {} }) } as unknown as MusicAudioEngine;
  const engine = new AudioLoopEngine(music);
  // Two bars recorded at 120 BPM: 4 s.
  const frames = 4 * 48000;
  engine.restoreLayers(0, [[new Float32Array(frames), new Float32Array(frames)]], 2, 500, 0);
  return { engine, ctx, sources };
}

beforeEach(() => {
  vi.useFakeTimers();
  clock.beat = 0.5;
  clock.beatMs = 500;
  clock.link = false;
  linkStore.set({ tempo: 120, offsetMs: 0 });
});

describe('audio loops against Ableton Link', () => {
  it('without Link, starts on the bar line as the launch clock has it', () => {
    const { engine, sources } = engineWithLoop();
    engine.play(0);
    // Beat 0.5 now, the next bar (beat 4) is 1.75 s away.
    expect(sources[0].startAt).toBeCloseTo(1.75, 9);
    engine.dispose();
  });

  it('under Link, starts early by the output latency and the trim, so it is heard on the bar', () => {
    clock.link = true;
    linkStore.set({ tempo: 120, offsetMs: 10 });
    const { engine, sources } = engineWithLoop();
    engine.play(0);
    expect(sources[0].startAt).toBeCloseTo(1.75 - 0.035, 9);
    engine.dispose();
  });

  it('repitches with a 25% Link tempo jump as soon as the session reports it', () => {
    clock.link = true;
    const { engine, ctx, sources } = engineWithLoop();
    engine.play(0);
    ctx.currentTime = 2;
    clock.beat = 4.5;
    vi.advanceTimersByTime(100);
    // Live's looper jumps the tempo to 150 BPM.
    clock.beatMs = 400;
    linkStore.set({ tempo: 150, offsetMs: 0 });
    const voice = sources[sources.length - 1];
    expect(voice.playbackRate.setValueAtTime).toHaveBeenCalled();
    const rate = voice.playbackRate.setValueAtTime.mock.calls.at(-1)![0];
    expect(rate).toBeCloseTo(1.25, 2);
    engine.dispose();
  });

  it('without Link, a jump past 3% still plays at its own speed, as before', () => {
    const { engine, ctx, sources } = engineWithLoop();
    engine.play(0);
    ctx.currentTime = 2;
    clock.beat = 4.5;
    clock.beatMs = 400;
    vi.advanceTimersByTime(100);
    const voice = sources[sources.length - 1];
    const calls = voice.playbackRate.setValueAtTime.mock.calls;
    expect(calls.length === 0 || calls.at(-1)![0] === 1).toBe(true);
    engine.dispose();
  });
});
