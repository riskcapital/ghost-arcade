import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type NativeAudio = typeof import('./nativeAudio');

/** A frame as GhostAudio.frameData() writes it. */
function frame(sequence: number, code: number, arriving: boolean, spectrumValue = 0, waveValue = 128, magic = 0x47414146) {
  const buffer = new ArrayBuffer(20 + 512 + 1024);
  const view = new DataView(buffer);
  view.setUint32(0, magic, true);
  view.setUint32(4, sequence, true);
  view.setUint32(8, code, true);
  view.setFloat32(12, 48000, true);
  view.setUint32(16, arriving ? 1 : 0, true);
  new Uint8Array(buffer, 20, 512).fill(spectrumValue);
  new Uint8Array(buffer, 532, 1024).fill(waveValue);
  return buffer;
}

let audio: NativeAudio;
let calls: { method: string; args: Record<string, unknown> }[];
let nativeSource: string;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  calls = [];
  nativeSource = 'off';
  vi.stubGlobal('Capacitor', {
    getPlatform: () => 'ios',
    nativePromise: vi.fn(async (_plugin: string, method: string, args: Record<string, unknown>) => {
      calls.push({ method, args });
      if (method === 'audioSetSource') nativeSource = String(args.source);
      return { source: nativeSource, arriving: false, playing: false, loop: true, tracks: [] };
    }),
  });
  vi.stubGlobal('fetch', vi.fn(async () => nativeSource === 'off'
    ? new Response(null, { status: 204 })
    : new Response(frame(1, nativeSource === 'mic' ? 1 : nativeSource === 'player' ? 2 : 3, true, 200), { status: 200 })));
  audio = await import('./nativeAudio');
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

const sourceCalls = () => calls.filter(c => c.method === 'audioSetSource').map(c => c.args.source);

describe('parseAudioFrame', () => {
  it('reads the header, spectrum and waveform GhostAudio writes', () => {
    const parsed = audio.parseAudioFrame(frame(9, 3, true, 77, 200));
    expect(parsed).toMatchObject({ sequence: 9, source: 'phone', sampleRate: 48000, arriving: true });
    expect(parsed.spectrum).toHaveLength(512);
    expect(parsed.waveform).toHaveLength(1024);
    expect(parsed.spectrum[511]).toBe(77);
    expect(parsed.waveform[0]).toBe(200);
  });
  it('rejects foreign or cut-off data', () => {
    expect(() => audio.parseAudioFrame(frame(1, 1, true, 0, 128, 0x12345678))).toThrow(/Invalid/);
    expect(() => audio.parseAudioFrame(frame(1, 7, true))).toThrow(/Invalid/);
    expect(() => audio.parseAudioFrame(new ArrayBuffer(100))).toThrow(/Incomplete/);
  });
});

describe('the shared native source', () => {
  it('switches the app to the source asked for and serves its frames', async () => {
    const handle = await audio.acquireNativeAudio('player');
    expect(sourceCalls()).toEqual(['player']);
    await vi.advanceTimersByTimeAsync(40);
    expect(handle.frame()?.source).toBe('player');
    expect(handle.frame()?.spectrum[0]).toBe(200);
    handle.release();
    expect(handle.frame()).toBeNull();
  });

  it('keeps the source while anyone listens and switches it off after the last one leaves', async () => {
    const studio = await audio.acquireNativeAudio('mic');
    const interactive = await audio.acquireNativeAudio('mic');
    expect(sourceCalls()).toEqual(['mic']);
    studio.release();
    await vi.advanceTimersByTimeAsync(1000);
    expect(sourceCalls()).toEqual(['mic']);
    interactive.release();
    await vi.advanceTimersByTimeAsync(1000);
    expect(sourceCalls()).toEqual(['mic', 'off']);
    expect(audio.nativeAudioSource()).toBe('off');
  });

  it('does not stop the player when the visuals restart and take the source straight back', async () => {
    const before = await audio.acquireNativeAudio('player');
    before.release();
    const after = await audio.acquireNativeAudio('player');
    await vi.advanceTimersByTimeAsync(1000);
    expect(sourceCalls()).toEqual(['player']);
    expect(after.frame()?.source).toBe('player');
  });

  it('reads a stalled feed as silence', async () => {
    const handle = await audio.acquireNativeAudio('phone');
    await vi.advanceTimersByTimeAsync(40);
    expect(handle.frame()).not.toBeNull();
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
    await vi.advanceTimersByTimeAsync(1500);
    expect(handle.frame()).toBeNull();
  });

  it('passes the app’s refusal on, for example a declined microphone', async () => {
    vi.stubGlobal('Capacitor', { getPlatform: () => 'ios', nativePromise: vi.fn(async () => { throw new Error('Microphone access is off.'); }) });
    await expect(audio.acquireNativeAudio('mic')).rejects.toThrow('Microphone access is off.');
  });

  it('is only offered in the iPhone and iPad app', () => {
    expect(audio.hasNativeAudio()).toBe(true);
    vi.stubGlobal('Capacitor', { getPlatform: () => 'android', nativePromise: vi.fn() });
    expect(audio.hasNativeAudio()).toBe(false);
  });
});
