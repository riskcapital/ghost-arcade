import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
import { createWLEDEffect } from '../wled/effects';
import { audioStore } from '../stores/audio';

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

describe('LED FX on pixel-map fixtures', () => {
  function brightestPixel(data: Uint8Array, pixels: number): number {
    let best = -1;
    let bestValue = -1;
    for (let pixel = 0; pixel < pixels; pixel += 1) {
      if (data[pixel * 3] > bestValue) { bestValue = data[pixel * 3]; best = pixel; }
    }
    return best;
  }

  it('runs a grouped chase on a fixture and leaves fixtures outside the group alone', async () => {
    const config = configure([
      { id: 'fx-strip', pixelCount: 20, universe: 0, mapping: { mode: 'strip', sampleRadius: 0 } },
      { id: 'other', pixelCount: 2, universe: 1, mapping: { mode: 'strip', sampleRadius: 0 } },
    ]);
    const chase = {
      ...createWLEDEffect('chase'),
      id: 'chase-1',
      active: true,
      speed: 1,
      speedMode: 'manual' as const,
      colorSource: 'custom' as const,
      color: '#ff0000',
      secondaryColor: '#ff0000',
      blendMode: 'replace' as const,
      params: { width: 0.05, tail: 0, density: 0.5 },
      target: { mode: 'group' as const, groupId: 'group-1' },
    };
    project.set({
      pixelMap: config,
      wledGroups: [{ id: 'group-1', name: 'Truss', members: [{ controllerId: 'fx-strip' }] }],
      wledEffects: [chase],
    } as never);
    stop = startPixelMapOutput();
    await vi.advanceTimersByTimeAsync(250);
    const early = frames().at(-1)!;
    await vi.advanceTimersByTimeAsync(250);
    const later = frames().at(-1)!;
    const strip = (frame: typeof early) => frame.universes.find(universe => universe.universe === 0)!.data;
    const first = brightestPixel(strip(early), 20);
    const second = brightestPixel(strip(later), 20);
    // One cycle per second across 20 pixels: a quarter second moves ~5 pixels.
    expect(strip(early)[first * 3]).toBeGreaterThan(200);
    expect(second).not.toBe(first);
    expect(((second - first + 20) % 20)).toBeGreaterThanOrEqual(3);
    expect(((second - first + 20) % 20)).toBeLessThanOrEqual(7);
    // Most of the strip is dark: a chase, not a wash.
    const lit = Array.from({ length: 20 }, (_, pixel) => strip(later)[pixel * 3]).filter(value => value > 40).length;
    expect(lit).toBeLessThanOrEqual(4);
    // The fixture outside the group still shows the composite (red, blue).
    const other = later.universes.find(universe => universe.universe === 1)!.data;
    expect(Array.from(other.subarray(0, 6))).toEqual([255, 0, 0, 0, 0, 255]);
  });

  it('targets a single fixture and follows the manual BPM', async () => {
    const config = configure([{ id: 'solo', pixelCount: 4, universe: 0, mapping: { mode: 'strip', sampleRadius: 0 } }]);
    const strobe = {
      ...createWLEDEffect('strobe'),
      id: 'strobe-1',
      active: true,
      speedMode: 'bpm' as const,
      beatDivision: 1,
      colorSource: 'custom' as const,
      color: '#00ff00',
      secondaryColor: '#00ff00',
      blendMode: 'replace' as const,
      target: { mode: 'controller' as const, controllerId: 'solo' },
    };
    project.set({ pixelMap: config, wledEffects: [strobe], wledGroups: [] } as never);
    audioStore.setManualBPM(60);
    stop = startPixelMapOutput();
    // At 60 BPM one strobe cycle is a second: on for the first 35%, then off.
    const greens: number[] = [];
    for (let step = 0; step < 20; step += 1) {
      await vi.advanceTimersByTimeAsync(50);
      greens.push(frames().at(-1)!.universes[0].data[1]);
    }
    const on = greens.filter(value => value > 200).length;
    const off = greens.filter(value => value === 0).length;
    expect(on).toBeGreaterThanOrEqual(5);
    expect(off).toBeGreaterThanOrEqual(10);
    audioStore.clearManualBPM();
  });
});
