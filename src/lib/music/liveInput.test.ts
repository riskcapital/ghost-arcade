/**
 * The band inputs never leave a stream open behind them: a stop (the studio
 * closing) or a second start (a double click, a device change) while a
 * device is still opening closes the stream that arrives late. A device is
 * opened once for every input on it and split into its channels; an input
 * on a channel the device does not send says so instead of staying silent.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { LiveInputs, type BandInputSpec } from './liveInput';

type Listener = () => void;

function fakeStream(channelCount = 2) {
  const ended: Listener[] = [];
  const track = {
    stop: vi.fn(),
    addEventListener: vi.fn((type: string, fn: Listener) => { if (type === 'ended') ended.push(fn); }),
    getSettings: () => ({ channelCount }),
  };
  return { track, ended, stream: { getTracks: () => [track], getAudioTracks: () => [track] } };
}

function fakeNode() {
  return { connect: vi.fn((dest: unknown, _output?: number) => dest), disconnect: vi.fn() };
}

function fakeContext() {
  const splitters: Array<ReturnType<typeof fakeNode> & { outputs: number }> = [];
  const sources: Array<ReturnType<typeof fakeNode>> = [];
  const ctx = {
    sampleRate: 48000,
    currentTime: 0,
    createMediaStreamSource: vi.fn(() => {
      const node = fakeNode();
      sources.push(node);
      return node;
    }),
    createChannelSplitter: vi.fn((outputs: number) => {
      const node = { ...fakeNode(), outputs, numberOfOutputs: outputs };
      splitters.push(node);
      return node;
    }),
    createGain: vi.fn(() => fakeNode()),
    createAnalyser: vi.fn(() => ({ ...fakeNode(), fftSize: 0, getFloatTimeDomainData: vi.fn() })),
  };
  return { ctx: ctx as unknown as AudioContext, splitters, sources };
}

/** getUserMedia that resolves when the test says so, keeping what it was asked for. */
function deferredInputs() {
  const pending: Array<{ resolve: (s: unknown) => void; reject: (e: unknown) => void; constraints: MediaStreamConstraints }> = [];
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia: (constraints: MediaStreamConstraints) => new Promise((resolve, reject) => pending.push({ resolve, reject, constraints })),
    },
  });
  return pending;
}

const spec = (patch: Partial<BandInputSpec> = {}): BandInputSpec => ({ deviceId: '', channel: -1, sensitivity: 0.5, low: false, ...patch });
const strips = () => {
  const nodes = [{}, {}, {}, {}] as AudioNode[];
  return { nodes, into: (i: number) => nodes[i] };
};
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('LiveInputs', () => {
  it('closes a stream that arrives after stop()', async () => {
    vi.useFakeTimers();
    const pending = deferredInputs();
    const inputs = new LiveInputs({ onEvents: () => {} });
    const { ctx } = fakeContext();
    const opening = inputs.start(ctx, [spec()], strips().into);
    inputs.stop();
    const late = fakeStream();
    pending[0].resolve(late.stream);
    await opening;
    expect(late.track.stop).toHaveBeenCalled();
    expect(inputs.running).toBe(false);
    expect(inputs.open).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps only the latest of two quick starts', async () => {
    vi.useFakeTimers();
    const pending = deferredInputs();
    const inputs = new LiveInputs({ onEvents: () => {} });
    const { ctx } = fakeContext();
    const first = inputs.start(ctx, [spec({ deviceId: 'a' })], strips().into);
    const second = inputs.start(ctx, [spec({ deviceId: 'b' })], strips().into);
    const a = fakeStream();
    const b = fakeStream();
    pending[1].resolve(b.stream);
    pending[0].resolve(a.stream);
    await Promise.all([first, second]);
    expect(a.track.stop).toHaveBeenCalled();
    expect(b.track.stop).not.toHaveBeenCalled();
    expect(inputs.isOn(0)).toBe(true);
    expect(vi.getTimerCount()).toBe(1);
    inputs.stop();
    expect(b.track.stop).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('opens a shared device once and gives each input its own channel', async () => {
    const pending = deferredInputs();
    const inputs = new LiveInputs({ onEvents: () => {} });
    const { ctx, splitters } = fakeContext();
    const { nodes, into } = strips();
    const opening = inputs.start(ctx, [spec({ deviceId: 'duo', channel: 0, low: true }), spec({ deviceId: 'duo', channel: 1 })], into);
    expect(pending).toHaveLength(1);
    const audio = pending[0].constraints.audio as MediaTrackConstraints;
    expect(audio.channelCount).toEqual({ ideal: 2 });
    expect(audio.echoCancellation).toBe(false);
    expect(audio.deviceId).toEqual({ exact: 'duo' });
    pending[0].resolve(fakeStream(2).stream);
    await opening;
    expect(inputs.isOn(0)).toBe(true);
    expect(inputs.isOn(1)).toBe(true);
    expect(splitters).toHaveLength(1);
    expect(splitters[0].outputs).toBe(2);
    // Each input's tap hangs off its own output of the splitter.
    expect(splitters[0].connect.mock.calls.map((c) => c[1])).toEqual([0, 1]);
    // The bass looks longer, for its low notes.
    const analysers = (ctx.createAnalyser as ReturnType<typeof vi.fn>).mock.results.map((r) => r.value);
    expect(analysers.map((a) => a.fftSize)).toEqual([4096, 2048]);
    const taps = (ctx.createGain as ReturnType<typeof vi.fn>).mock.results.map((r) => r.value);
    expect(taps[0].connect).toHaveBeenCalledWith(nodes[0]);
    expect(taps[1].connect).toHaveBeenCalledWith(nodes[1]);
    inputs.stop();
  });

  it('says so when the device does not send the chosen channel', async () => {
    const pending = deferredInputs();
    const statuses: unknown[] = [];
    const inputs = new LiveInputs({ onEvents: () => {}, onStatus: (s) => statuses.push(s) });
    const { ctx } = fakeContext();
    const opening = inputs.start(ctx, [spec({ channel: 1 })], strips().into);
    pending[0].resolve(fakeStream(1).stream);
    await opening;
    expect(inputs.isOn(0)).toBe(false);
    expect(inputs.open).toBe(true);
    expect(inputs.statuses()[0]).toMatchObject({ on: false, channels: 1, error: 'This device sends one channel. Choose Mix or 1.' });
    // Moving to the channel it does send wires it, without opening the device again.
    await inputs.sync(ctx, [spec({ channel: 0 })], strips().into);
    expect(pending).toHaveLength(1);
    expect(inputs.isOn(0)).toBe(true);
    expect(inputs.statuses()[0].error).toBeNull();
    inputs.stop();
  });

  it('reports a device that could not be opened, and keeps the others', async () => {
    const pending = deferredInputs();
    const inputs = new LiveInputs({ onEvents: () => {} });
    const { ctx } = fakeContext();
    const opening = inputs.start(ctx, [spec({ deviceId: 'gone' }), spec({ deviceId: 'here' })], strips().into);
    pending[0].reject(Object.assign(new Error('x'), { name: 'NotFoundError' }));
    pending[1].resolve(fakeStream().stream);
    await opening;
    expect(inputs.statuses()[0]).toMatchObject({ on: false, error: 'That audio input is not connected.' });
    expect(inputs.isOn(1)).toBe(true);
    // A failed device is not tried again on every change.
    await inputs.sync(ctx, [spec({ deviceId: 'gone', sensitivity: 0.9 }), spec({ deviceId: 'here' })], strips().into);
    expect(pending).toHaveLength(2);
    inputs.stop();
  });

  it('lets a removed input go: its tap, its held note and, with nobody on it, its device', async () => {
    vi.useFakeTimers();
    const pending = deferredInputs();
    const events: Array<[number, string]> = [];
    const inputs = new LiveInputs({ onEvents: (i, evs) => evs.forEach((e) => events.push([i, e.type])) });
    const { ctx, sources } = fakeContext();
    const opening = inputs.start(ctx, [spec({ deviceId: 'a' }), spec({ deviceId: 'b' })], strips().into);
    const a = fakeStream();
    const b = fakeStream();
    pending[0].resolve(a.stream);
    pending[1].resolve(b.stream);
    await opening;
    // Hold a note on the second input: a loud block after silence.
    const analyser = (ctx.createAnalyser as ReturnType<typeof vi.fn>).mock.results[1].value;
    analyser.getFloatTimeDomainData.mockImplementation((buf: Float32Array) => {
      for (let i = 0; i < buf.length; i++) buf[i] = 0.5 * Math.sin((2 * Math.PI * 220 * i) / 48000);
    });
    vi.advanceTimersByTime(12);
    expect(events).toContainEqual([1, 'on']);
    const tap = (ctx.createGain as ReturnType<typeof vi.fn>).mock.results[1].value;
    await inputs.sync(ctx, [spec({ deviceId: 'a' })], strips().into);
    expect(tap.disconnect).toHaveBeenCalled();
    expect(events).toContainEqual([1, 'off']);
    expect(b.track.stop).toHaveBeenCalled();
    expect(sources[1].disconnect).toHaveBeenCalled();
    expect(a.track.stop).not.toHaveBeenCalled();
    inputs.stop();
    expect(a.track.stop).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('marks the inputs of an unplugged device', async () => {
    vi.useFakeTimers();
    const pending = deferredInputs();
    const inputs = new LiveInputs({ onEvents: () => {} });
    const { ctx } = fakeContext();
    const opening = inputs.start(ctx, [spec()], strips().into);
    const s = fakeStream();
    pending[0].resolve(s.stream);
    await opening;
    expect(inputs.isOn(0)).toBe(true);
    s.ended.forEach((fn) => fn());
    expect(inputs.isOn(0)).toBe(false);
    expect(inputs.open).toBe(false);
    expect(inputs.statuses()[0].error).toBe('The audio input was disconnected.');
    expect(vi.getTimerCount()).toBe(0);
    await flush;
  });
});
