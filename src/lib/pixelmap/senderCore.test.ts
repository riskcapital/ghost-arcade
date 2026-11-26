import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { writable } from 'svelte/store';

vi.mock('../stores/layers', () => ({ project: writable({}) }));
vi.mock('../stores/settings', () => ({ settings: writable({ output: { blackout: false } }) }));
vi.mock('../bridge', () => ({ invoke: vi.fn() }));

import { project } from '../stores/layers';
import { invoke } from '../bridge';
import type { PixelMapConfig, PixelMapFixture, Project } from '../types';
import { createDefaultPixelMapConfig, createPixelMapFixture } from './fixtures';
import { getPixelMapFixturePixels, pixelMapBlackout, pixelMapStats, startPixelMapOutput } from './sender';
import { createWLEDEffect } from '../wled/effects';
import { get } from 'svelte/store';

let stop: (() => void) | null = null;
let coreAnswer: { ok: boolean; reason?: string } = { ok: true };
let coreStats: Record<string, unknown> = { core: true, framesSent: 5, fps: 40, sending: true };

const calls = (command: string) => vi.mocked(invoke).mock.calls.filter(([name]) => name === command);

function setProject(fixtures: Array<Partial<PixelMapFixture>>, extra: Partial<Project> = {}) {
  const pixelMap: PixelMapConfig = {
    ...createDefaultPixelMapConfig(),
    enabled: true,
    fixtures: fixtures.map(fixture => ({ ...createPixelMapFixture([]), address: '10.0.0.7', ...fixture }) as PixelMapFixture),
  };
  project.set({ pixelMap, ...extra } as never);
  return pixelMap;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('document', {
    createElement: () => ({ width: 1, height: 1, getContext: () => ({ putImageData() {}, drawImage() {}, getImageData: () => null }) }),
  });
  vi.mocked(invoke).mockReset();
  coreAnswer = { ok: true };
  coreStats = { core: true, framesSent: 5, fps: 40, sending: true, fixtureId: 'f1', fixturePixels: [9, 8, 7] };
  vi.mocked(invoke).mockImplementation(async (command: string) => {
    if (command === 'pixelmap_core_configure') return coreAnswer;
    if (command === 'pixelmap_get_stats') return coreStats;
    if (command === 'native_renderer_get_frame_snapshot') return null;
    return { ok: true, stats: { sending: true } };
  });
  pixelMapBlackout.set(false);
});

afterEach(() => {
  stop?.();
  stop = null;
  project.set({} as never);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('hands a ready plan to the render core and stops sampling and sending here', async () => {
  setProject([{ id: 'f1', pixelCount: 3, universe: 2, channel: 10, colorOrder: 'GRB' }, { id: 'off', enabled: false }]);
  stop = startPixelMapOutput();
  await vi.advanceTimersByTimeAsync(10);
  const [[, plan]] = calls('pixelmap_core_configure') as unknown as Array<[string, any]>;
  expect(plan.fixtures).toHaveLength(1);
  expect(plan.fixtures[0]).toMatchObject({ id: 'f1', protocol: 'artnet', host: '10.0.0.7', colorOrder: 'GRB',
    segments: [{ universe: 2, channel: 10, firstPixel: 0, pixelCount: 3 }] });
  expect(plan.fixtures[0].points).toHaveLength(6);
  const sentBefore = calls('pixelmap_send_frame').length;
  await vi.advanceTimersByTimeAsync(1000);
  expect(calls('pixelmap_send_frame').length).toBe(sentBefore);
  expect(calls('native_renderer_get_frame_snapshot').length).toBeLessThanOrEqual(1);
  // Stats and the preview come from the core.
  expect(get(pixelMapStats)).toMatchObject({ core: true, framesSent: 5 });
  getPixelMapFixturePixels('f1');
  await vi.advanceTimersByTimeAsync(300);
  expect(Array.from(getPixelMapFixturePixels('f1') ?? [])).toEqual([9, 8, 7]);
  expect(calls('pixelmap_get_stats').at(-1)?.[1]).toEqual({ fixtureId: 'f1' });
});

it('sends a changed plan once, and stops the core on blackout', async () => {
  const config = setProject([{ id: 'f1', pixelCount: 3 }]);
  stop = startPixelMapOutput();
  await vi.advanceTimersByTimeAsync(10);
  project.set({ pixelMap: { ...config, fixtures: [{ ...config.fixtures[0], pixelCount: 4 }] } } as never);
  await vi.advanceTimersByTimeAsync(10);
  project.update(current => ({ ...current }));
  await vi.advanceTimersByTimeAsync(10);
  expect(calls('pixelmap_core_configure')).toHaveLength(2);
  pixelMapBlackout.set(true);
  await vi.advanceTimersByTimeAsync(10);
  expect(calls('pixelmap_stop')).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(1000);
  expect(calls('pixelmap_send_frame')).toHaveLength(0);
});

it('keeps sending from here when the core refuses, and does not ask again for the same plan', async () => {
  coreAnswer = { ok: false, reason: 'old core' };
  setProject([{ id: 'f1', pixelCount: 3, testPattern: 'solid' }]);
  stop = startPixelMapOutput();
  await vi.advanceTimersByTimeAsync(1000);
  expect(calls('pixelmap_core_configure')).toHaveLength(1);
  expect(calls('pixelmap_send_frame').length).toBeGreaterThanOrEqual(38);
});

it('falls back to sending from here when the core output is lost', async () => {
  setProject([{ id: 'f1', pixelCount: 3, testPattern: 'solid' }]);
  stop = startPixelMapOutput();
  await vi.advanceTimersByTimeAsync(300);
  expect(calls('pixelmap_send_frame')).toHaveLength(0);
  coreStats = { core: false, coreLost: true };
  await vi.advanceTimersByTimeAsync(1000);
  expect(calls('pixelmap_send_frame').length).toBeGreaterThan(20);
});

it('leaves fixtures an LED FX reaches on the editor path, and moves when the effect stops', async () => {
  const effect = { ...createWLEDEffect('chase'), active: true, target: { mode: 'all' as const } };
  const config = setProject([{ id: 'f1', pixelCount: 3, testPattern: 'solid' }], { wledEffects: [effect] } as never);
  stop = startPixelMapOutput();
  await vi.advanceTimersByTimeAsync(500);
  expect(calls('pixelmap_core_configure')).toHaveLength(0);
  expect(calls('pixelmap_send_frame').length).toBeGreaterThan(10);
  project.set({ pixelMap: config, wledEffects: [{ ...effect, active: false }] } as never);
  await vi.advanceTimersByTimeAsync(10);
  expect(calls('pixelmap_core_configure')).toHaveLength(1);
  const sent = calls('pixelmap_send_frame').length;
  await vi.advanceTimersByTimeAsync(500);
  expect(calls('pixelmap_send_frame').length).toBe(sent);
});
