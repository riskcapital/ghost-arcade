import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { writable } from 'svelte/store';

vi.mock('../stores/layers', () => ({ project: writable({ wledControllers: [] }) }));
vi.mock('../stores/audio', () => ({ audioStore: writable({ bpm: 120, manualBPM: null }) }));
vi.mock('../bridge', () => ({ invoke: vi.fn() }));
vi.mock('./mapping', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./mapping')>();
  return { ...actual, resolveWLEDMapping: vi.fn(actual.resolveWLEDMapping) };
});

import { project } from '../stores/layers';
import { invoke } from '../bridge';
import { resolveWLEDMapping } from './mapping';
import { startWLEDSenders, stopWLEDSenders, tickWLEDSenders, WLED_KEEPALIVE_MS } from './sender';
import type { WLEDController } from '../types';

const canvas = { width: 160, height: 90, isConnected: true } as unknown as HTMLCanvasElement;
const sends = () => vi.mocked(invoke).mock.calls.filter(([command]) => command === 'wled_send_frame');
const controller = (fields: Partial<WLEDController> = {}): WLEDController => ({
  id: 'strip', name: 'Strip', ipAddr: '127.0.0.1', port: 21324, enabled: true, ledCount: 30, brightness: 1, gamma: 1,
  testPattern: 'solid', testColor: '#ff0000', ...fields,
} as WLEDController);

let now = 1000;

/** Run the render loop for `ms` at 60 fps, letting each send resolve. */
async function run(ms: number) {
  const end = now + ms;
  while (now < end) {
    now += 1000 / 60;
    tickWLEDSenders(canvas);
    await Promise.resolve();
    await Promise.resolve();
  }
}

beforeEach(() => {
  now = 1000;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(async () => ({ ok: true }));
  vi.mocked(resolveWLEDMapping).mockClear();
  project.set({ wledControllers: [controller()] } as never);
  startWLEDSenders(canvas, 'editor');
});

afterEach(() => {
  stopWLEDSenders(canvas);
  vi.restoreAllMocks();
});

it('skips identical frames but keeps the controller in realtime mode once a second', async () => {
  await run(3000);
  // One frame, then a keepalive about every second (not 180 frames). The
  // keepalive must beat the 2 s realtime timeout set in each packet.
  expect(sends().length).toBeGreaterThanOrEqual(3);
  expect(sends().length).toBeLessThanOrEqual(4);
  expect(WLED_KEEPALIVE_MS).toBeLessThan(2000);
});

it('sends a changed frame at once', async () => {
  await run(200);
  const before = sends().length;
  project.set({ wledControllers: [controller({ testColor: '#00ff00' })] } as never);
  await run(20);
  expect(sends().length).toBe(before + 1);
  const pixels = (sends().at(-1)![1] as { pixels: Uint8Array }).pixels;
  expect(Array.from(pixels.subarray(0, 3))).toEqual([0, 255, 0]);
});

it('works out the LED map once rather than on every frame', async () => {
  await run(1000);
  expect(vi.mocked(resolveWLEDMapping).mock.calls.length).toBe(1);
  // A brightness change keeps the map; a new map is worked out once.
  project.set({ wledControllers: [controller({ brightness: 0.5 })] } as never);
  await run(200);
  expect(vi.mocked(resolveWLEDMapping).mock.calls.length).toBe(1);
  project.set({ wledControllers: [controller({ brightness: 0.5, mapping: { mode: 'strip', sampleRadius: 0.02 } })] } as never);
  await run(200);
  expect(vi.mocked(resolveWLEDMapping).mock.calls.length).toBe(2);
});
