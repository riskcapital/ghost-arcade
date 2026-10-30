/**
 * The live input never leaves a stream open behind it: a stop (the studio
 * closing) or a second start (a double click, a device change) while the
 * input is still opening closes the stream that arrives late.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { LiveInput } from './liveInput';

function fakeStream() {
  const track = { stop: vi.fn(), addEventListener: vi.fn() };
  return { track, stream: { getTracks: () => [track], getAudioTracks: () => [track] } };
}

function fakeContext() {
  const node = () => ({ connect: vi.fn(), disconnect: vi.fn() });
  return {
    sampleRate: 48000,
    currentTime: 0,
    createMediaStreamSource: vi.fn(() => node()),
    createAnalyser: vi.fn(() => ({ ...node(), fftSize: 0, getFloatTimeDomainData: vi.fn() })),
  } as unknown as AudioContext;
}

/** getUserMedia that resolves when the test says so. */
function deferredInputs() {
  const pending: Array<(s: unknown) => void> = [];
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: () => new Promise((resolve) => pending.push(resolve)) } });
  return pending;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('LiveInput', () => {
  it('closes a stream that arrives after stop()', async () => {
    vi.useFakeTimers();
    const pending = deferredInputs();
    const input = new LiveInput(0.5, () => {});
    const ctx = fakeContext();
    const opening = input.start(ctx, '', {} as AudioNode);
    input.stop();
    const late = fakeStream();
    pending[0](late.stream);
    expect(await opening).toBe(false);
    expect(late.track.stop).toHaveBeenCalled();
    expect(input.running).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps only the latest of two quick starts', async () => {
    vi.useFakeTimers();
    const pending = deferredInputs();
    const input = new LiveInput(0.5, () => {});
    const ctx = fakeContext();
    const first = input.start(ctx, 'a', {} as AudioNode);
    const second = input.start(ctx, 'b', {} as AudioNode);
    const a = fakeStream();
    const b = fakeStream();
    pending[1](b.stream);
    pending[0](a.stream);
    expect(await second).toBe(true);
    expect(await first).toBe(false);
    expect(a.track.stop).toHaveBeenCalled();
    expect(b.track.stop).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);
    input.stop();
    expect(b.track.stop).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
