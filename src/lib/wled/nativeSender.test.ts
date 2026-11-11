import { afterEach, expect, it, vi } from 'vitest';
import { writable } from 'svelte/store';

vi.mock('../stores/layers', () => ({ project: writable({ wledControllers: [] }) }));
vi.mock('../stores/audio', () => ({ audioStore: writable({ bpm: 120, manualBPM: 92 }) }));
vi.mock('../bridge', () => ({ invoke: vi.fn() }));
vi.mock('./effects', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./effects')>()),
  applyWLEDEffects: vi.fn((source, target) => target.set(source)),
}));

import { project } from '../stores/layers';
import { invoke } from '../bridge';
import { applyWLEDEffects } from './effects';
import { acquireNativeCompositeMirror } from '../sync/nativeCompositeMirror';
import { startWLEDSenders, stopWLEDSenders, tickWLEDSenders } from './sender';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('sends fresh detached native frames upright, uses manual BPM, and stops on release', async () => {
  vi.useFakeTimers();
  vi.spyOn(performance, 'now').mockReturnValue(1000);
  const transforms = vi.fn();
  vi.stubGlobal('ImageData', class {
    data: Uint8ClampedArray;
    constructor(public width: number, public height: number) { this.data = new Uint8ClampedArray(width * height * 4); }
  });
  vi.stubGlobal('document', { createElement: () => {
    let pixels: Uint8ClampedArray = new Uint8ClampedArray(4);
    return { width: 1, height: 1, isConnected: false, readPixels: () => pixels, getContext: () => ({
      setTransform: transforms, clearRect() {}, save() {}, restore() {}, drawImage(source: { readPixels: () => Uint8ClampedArray }) { pixels = source.readPixels(); },
      putImageData(image: ImageData) { pixels = image.data; },
      getImageData() { return { width: 1, height: 1, data: pixels }; },
    }) };
  } });
  vi.mocked(invoke).mockImplementation(async command => command === 'native_renderer_get_frame_snapshot'
    ? { width: 1, height: 1, format: 'rgba8unorm', rgba_b64: btoa(String.fromCharCode(255, 0, 0, 255)) }
    : { ok: true });
  project.update(p => ({ ...p, wledControllers: [{ id: 'test', name: 'Test', ipAddr: '127.0.0.1', port: 21324, enabled: true, ledCount: 1, brightness: 1, gamma: 1 }] }));
  const mirror = acquireNativeCompositeMirror({ fps: 20, onFrame: () => tickWLEDSenders(mirror.canvas) });
  startWLEDSenders(mirror.canvas, 'native');
  try {
    await vi.advanceTimersByTimeAsync(0);
    const sends = () => vi.mocked(invoke).mock.calls.filter(([command]) => command === 'wled_send_frame');
    expect(sends()).toHaveLength(1);
    expect(Array.from((sends()[0][1] as { pixels: Uint8Array }).pixels)).toEqual([255, 0, 0]);
    expect(transforms.mock.calls.some(call => call[3] === -1)).toBe(false);
    expect(vi.mocked(applyWLEDEffects).mock.calls[0][7]).toBe(92);
    // Hold a send open: subsequent mirror frames must not queue more packets.
    let finishSend!: (value: unknown) => void;
    vi.mocked(invoke).mockImplementation(command => command === 'native_renderer_get_frame_snapshot'
      ? Promise.resolve({ width: 1, height: 1, format: 'rgba8unorm', rgba_b64: btoa(String.fromCharCode(255, 0, 0, 255)) })
      : new Promise(resolve => { finishSend = resolve; }));
    vi.mocked(performance.now).mockReturnValue(2000);
    await vi.advanceTimersByTimeAsync(50);
    expect(sends()).toHaveLength(2);
    vi.mocked(performance.now).mockReturnValue(3000);
    await vi.advanceTimersByTimeAsync(100);
    expect(sends()).toHaveLength(2);
    finishSend({ ok: true });
    project.update(p => ({ ...p, wledControllers: p.wledControllers!.map(c => ({ ...c, enabled: false })) }));
    await vi.advanceTimersByTimeAsync(100);
    expect(sends()).toHaveLength(2);
    mirror.release();
    stopWLEDSenders(mirror.canvas);
    const calls = vi.mocked(invoke).mock.calls.length;
    await vi.advanceTimersByTimeAsync(200);
    expect(vi.mocked(invoke).mock.calls).toHaveLength(calls);
  } finally { mirror.release(); stopWLEDSenders(mirror.canvas); }
});

it('samples the native mirror from its decoded pixels, without reading the canvas back', async () => {
  vi.useFakeTimers();
  vi.spyOn(performance, 'now').mockReturnValue(10_000);
  vi.mocked(invoke).mockClear();
  const reads = { getImageData: 0, drawImage: 0 };
  vi.stubGlobal('ImageData', class {
    data: Uint8ClampedArray;
    constructor(public width: number, public height: number) { this.data = new Uint8ClampedArray(width * height * 4); }
  });
  vi.stubGlobal('document', { createElement: () => ({ width: 1, height: 1, getContext: () => ({
    setTransform() {}, clearRect() {}, save() {}, restore() {}, putImageData() {},
    drawImage() { reads.drawImage++; },
    getImageData() { reads.getImageData++; return { width: 1, height: 1, data: new Uint8ClampedArray(4) }; },
  }) }) });
  // 2×1: left green, right blue (BGRA from the core).
  vi.mocked(invoke).mockImplementation(async command => command === 'native_renderer_get_frame_snapshot'
    ? { width: 2, height: 1, format: 'bgra8unorm', rgba_b64: btoa(String.fromCharCode(0, 255, 0, 255, 255, 0, 0, 255)) }
    : { ok: true });
  project.update(p => ({ ...p, wledControllers: [{ id: 'px', name: 'Px', ipAddr: '127.0.0.1', port: 21324, enabled: true, ledCount: 2, brightness: 1, gamma: 1, samplingMode: 'average',
    mapping: { mode: 'strip', axis: 'horizontal', sourceRegion: { x: 0, y: 0, width: 1, height: 1 }, sampleRadius: 0 } }] }));
  const mirror = acquireNativeCompositeMirror({ maxDim: 192, fps: 20, onFrame: () => tickWLEDSenders(mirror.canvas) });
  startWLEDSenders(mirror.canvas, 'native');
  try {
    await vi.advanceTimersByTimeAsync(0);
    const sends = vi.mocked(invoke).mock.calls.filter(([command]) => command === 'wled_send_frame');
    expect(sends).toHaveLength(1);
    expect(Array.from((sends[0][1] as { pixels: Uint8Array }).pixels)).toEqual([0, 255, 0, 0, 0, 255]);
    expect(reads).toEqual({ getImageData: 0, drawImage: 0 });
  } finally { mirror.release(); stopWLEDSenders(mirror.canvas); project.update(p => ({ ...p, wledControllers: [] })); }
});
