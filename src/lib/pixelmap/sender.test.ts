import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { writable, type Writable } from 'svelte/store';

vi.mock('../stores/layers', () => ({ project: writable({}) }));
vi.mock('../stores/settings', () => ({ settings: writable({ output: { blackout: false } }) }));
vi.mock('../bridge', () => ({ invoke: vi.fn() }));

import { project } from '../stores/layers';
import { settings as settingsStore } from '../stores/settings';
import { invoke } from '../bridge';
import type { PixelMapConfig, PixelMapFixture } from '../types';
import { createDefaultPixelMapConfig, createPixelMapFixture } from './fixtures';
import { pixelMapBlackout, startPixelMapOutput } from './sender';

const settings = settingsStore as unknown as Writable<unknown>;

type FakeImage = { width: number; height: number; data: Uint8ClampedArray };

/** Two-pixel snapshot: red on the left, blue on the right. */
const SNAPSHOT = { width: 2, height: 1, format: 'rgba8unorm', rgba_b64: btoa(String.fromCharCode(255, 0, 0, 255, 0, 0, 255, 255)) };

let stop: (() => void) | null = null;

function frames() {
  return vi.mocked(invoke).mock.calls
    .filter(([command]) => command === 'pixelmap_send_frame')
    .map(([, frame]) => frame as { fps: number; universes: Array<{ protocol: string; host: string | null; universe: number; data: Uint8Array }> });
}
const stops = () => vi.mocked(invoke).mock.calls.filter(([command]) => command === 'pixelmap_stop');
const snapshots = () => vi.mocked(invoke).mock.calls.filter(([command]) => command === 'native_renderer_get_frame_snapshot');

function configure(fixtures: Array<Partial<PixelMapFixture>>, fields: Partial<PixelMapConfig> = {}) {
  const config: PixelMapConfig = {
    ...createDefaultPixelMapConfig(),
    enabled: true,
    ...fields,
    fixtures: fixtures.map(fixture => ({ ...createPixelMapFixture([]), address: '127.0.0.1', ...fixture }) as PixelMapFixture),
  };
  project.set({ pixelMap: config } as never);
  return config;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('ImageData', class {
    data: Uint8ClampedArray;
    constructor(public width: number, public height: number) { this.data = new Uint8ClampedArray(width * height * 4); }
  });
  vi.stubGlobal('document', {
    createElement: () => {
      const canvas: { width: number; height: number; image: FakeImage | null; getContext: () => unknown } = {
        width: 1,
        height: 1,
        image: null,
        getContext: () => ({
          putImageData(image: FakeImage) { canvas.image = image; },
          drawImage(source: { image: FakeImage | null }) { canvas.image = source.image; },
          getImageData() { return canvas.image; },
        }),
      };
      return canvas;
    },
  });
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(async command => {
    if (command === 'native_renderer_get_frame_snapshot') return SNAPSHOT;
    if (command === 'pixelmap_send_frame') return { ok: true, stats: { framesSent: 1, fps: 40, sending: true } };
    return { ok: true, stats: { sending: false } };
  });
  pixelMapBlackout.set(false);
  settings.set({ output: { blackout: false } } as never);
});

afterEach(() => {
  stop?.();
  stop = null;
  project.set({} as never);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('sends a solid red test pattern at the configured 40fps without a composite frame', async () => {
  configure([{ pixelCount: 170, universe: 0, testPattern: 'solid', testColor: '#ff0000' }]);
  stop = startPixelMapOutput();
  await vi.advanceTimersByTimeAsync(1000);
  expect(frames().length).toBe(40);
  expect(snapshots()).toHaveLength(0);
  const [universe] = frames()[0].universes;
  expect(universe).toMatchObject({ protocol: 'artnet', host: '127.0.0.1', universe: 0 });
  for (let channel = 0; channel < 510; channel += 3) {
    expect([universe.data[channel], universe.data[channel + 1], universe.data[channel + 2]]).toEqual([255, 0, 0]);
  }
  expect([universe.data[510], universe.data[511]]).toEqual([0, 0]);
});

it('follows a 60fps setting', async () => {
  configure([{ pixelCount: 1, testPattern: 'solid' }], { fps: 60 });
  stop = startPixelMapOutput();
  await vi.advanceTimersByTimeAsync(1000);
  // setInterval rounds 16.67ms to 17ms.
  expect(frames().length).toBeGreaterThanOrEqual(58);
  expect(frames()[0].fps).toBe(60);
});

it('samples the native composite upright, in physical order and colour order', async () => {
  configure([{ pixelCount: 2, colorOrder: 'GRB', mapping: { mode: 'strip', sampleRadius: 0 } }]);
  stop = startPixelMapOutput();
  await vi.advanceTimersByTimeAsync(100);
  expect(snapshots().length).toBeGreaterThan(0);
  const last = frames().at(-1)!;
  // Pixel 1 is red (GRB: 0,255,0), pixel 2 is blue (0,0,255).
  expect(Array.from(last.universes[0].data.subarray(0, 6))).toEqual([0, 255, 0, 0, 0, 255]);
});

it('never queues a second frame while one is in flight', async () => {
  configure([{ pixelCount: 1, testPattern: 'solid' }]);
  let finish!: (value: unknown) => void;
  vi.mocked(invoke).mockImplementation(command => command === 'pixelmap_send_frame'
    ? new Promise(resolve => { finish = resolve; })
    : Promise.resolve({ ok: true }));
  stop = startPixelMapOutput();
  await vi.advanceTimersByTimeAsync(500);
  expect(frames()).toHaveLength(1);
  finish({ ok: true });
  await vi.advanceTimersByTimeAsync(30);
  expect(frames()).toHaveLength(2);
});

it('stops cleanly on lighting blackout, output blackout, disable and teardown', async () => {
  const config = configure([{ pixelCount: 1, testPattern: 'solid' }]);
  stop = startPixelMapOutput();
  await vi.advanceTimersByTimeAsync(100);
  pixelMapBlackout.set(true);
  const count = frames().length;
  await vi.advanceTimersByTimeAsync(500);
  expect(frames()).toHaveLength(count);
  expect(stops()).toHaveLength(1);

  pixelMapBlackout.set(false);
  await vi.advanceTimersByTimeAsync(100);
  expect(frames().length).toBeGreaterThan(count);
  settings.set({ output: { blackout: true } } as never);
  const afterOutputBlackout = frames().length;
  await vi.advanceTimersByTimeAsync(500);
  expect(frames()).toHaveLength(afterOutputBlackout);
  expect(stops()).toHaveLength(2);

  settings.set({ output: { blackout: false } } as never);
  await vi.advanceTimersByTimeAsync(100);
  project.set({ pixelMap: { ...config, enabled: false } } as never);
  const afterDisable = frames().length;
  await vi.advanceTimersByTimeAsync(500);
  expect(frames()).toHaveLength(afterDisable);
  expect(stops()).toHaveLength(3);

  project.set({ pixelMap: config } as never);
  await vi.advanceTimersByTimeAsync(100);
  stop();
  stop = null;
  const afterTeardown = frames().length;
  await vi.advanceTimersByTimeAsync(500);
  expect(frames()).toHaveLength(afterTeardown);
  expect(stops()).toHaveLength(4);
});

it('skips fixtures that are disabled or have no node address', async () => {
  configure([
    { id: 'ready', pixelCount: 1, universe: 0, testPattern: 'solid' },
    { id: 'off', pixelCount: 1, universe: 1, testPattern: 'solid', enabled: false },
    { id: 'blank', pixelCount: 1, universe: 2, testPattern: 'solid', address: '' },
  ]);
  stop = startPixelMapOutput();
  await vi.advanceTimersByTimeAsync(100);
  expect(frames().at(-1)!.universes.map(universe => universe.universe)).toEqual([0]);
});
