import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioAnalyzer, type AudioAnalysis } from './analyzer';

/** A fake browser audio stack with one pluggable input. */
function fakeAudio() {
  const listeners = new Set<() => void>();
  const devices = {
    plugged: true,
    getUserMedia: vi.fn(async (constraints: MediaStreamConstraints) => {
      const audio = constraints.audio as MediaTrackConstraints;
      if (!devices.plugged && audio?.deviceId) throw new Error('OverconstrainedError: Requested device not found');
      return { getTracks: () => [{ stop() {} }], getAudioTracks: () => [{}] };
    }),
    addEventListener: vi.fn((type: string, cb: () => void) => { if (type === 'devicechange') listeners.add(cb); }),
    removeEventListener: vi.fn((type: string, cb: () => void) => { if (type === 'devicechange') listeners.delete(cb); }),
  };
  class FakeContext {
    state = 'running';
    sampleRate = 48000;
    addEventListener() {}
    removeEventListener() {}
    resume() { return Promise.resolve(); }
    createAnalyser() {
      return {
        fftSize: 2048, frequencyBinCount: 1024, smoothingTimeConstant: 0, minDecibels: -90, maxDecibels: -10,
        // A loud signal, so a frozen level would show.
        getFloatFrequencyData(out: Float32Array) { out.fill(-20); },
        getFloatTimeDomainData(out: Float32Array) { out.fill(0.4); },
        connect() {}, disconnect() {},
      };
    }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
  }
  vi.stubGlobal('navigator', { mediaDevices: devices });
  vi.stubGlobal('AudioContext', FakeContext);
  let frame: FrameRequestCallback | null = null;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frame = cb; return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => { frame = null; });
  return {
    devices,
    deviceChange: () => [...listeners].forEach(cb => cb()),
    listening: () => listeners.size > 0,
    runFrame: () => { const cb = frame; frame = null; cb?.(performance.now()); },
  };
}

describe('audio input unplugged and plugged back in', () => {
  let analyzer: AudioAnalyzer;
  let frames: AudioAnalysis[];

  beforeEach(() => {
    vi.useFakeTimers();
    analyzer = new AudioAnalyzer();
    frames = [];
    analyzer.setCallback(a => frames.push(a));
  });
  afterEach(async () => {
    await analyzer.stop();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('drops the levels to zero and recovers the same input when it returns', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const audio = fakeAudio();
    await analyzer.startMicrophone('usb-interface');
    for (let i = 0; i < 5; i++) audio.runFrame();
    expect(frames.at(-1)!.amplitude).toBeGreaterThan(0.2);

    // Unplug: recovery with the exact device fails.
    audio.devices.plugged = false;
    audio.deviceChange();
    await vi.advanceTimersByTimeAsync(400);
    expect(analyzer.running).toBe(false);
    const last = frames.at(-1)!;
    expect(last.amplitude).toBe(0);
    expect(last.bands.bass).toBe(0);
    expect(last.bpm).toBe(0);
    expect(audio.listening()).toBe(true);

    // Plug back in: the same device comes back.
    audio.devices.plugged = true;
    audio.deviceChange();
    await vi.advanceTimersByTimeAsync(400);
    expect(analyzer.running).toBe(true);
    const lastCall = audio.devices.getUserMedia.mock.calls.at(-1)![0] as MediaStreamConstraints;
    expect((lastCall.audio as MediaTrackConstraints).deviceId).toEqual({ exact: 'usb-interface' });
  });

  it('stops listening for devices once the user stops audio', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const audio = fakeAudio();
    await analyzer.startMicrophone('usb-interface');
    audio.devices.plugged = false;
    audio.deviceChange();
    await vi.advanceTimersByTimeAsync(400);
    expect(audio.listening()).toBe(true);
    await analyzer.stop();
    expect(audio.listening()).toBe(false);
  });

  it('a stop during the recovery wait is not undone by the recovery', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const audio = fakeAudio();
    await analyzer.startMicrophone('usb-interface');
    audio.deviceChange();
    await vi.advanceTimersByTimeAsync(100);
    await analyzer.stop();
    await vi.advanceTimersByTimeAsync(400);
    expect(analyzer.running).toBe(false);
    expect(audio.devices.getUserMedia).toHaveBeenCalledTimes(1);
  });
});
