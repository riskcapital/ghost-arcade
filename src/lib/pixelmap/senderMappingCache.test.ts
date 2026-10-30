import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { writable } from 'svelte/store';

vi.mock('../stores/layers', () => ({ project: writable({}) }));
vi.mock('../stores/settings', () => ({ settings: writable({ output: { blackout: false } }) }));
vi.mock('../bridge', () => ({ invoke: vi.fn() }));
vi.mock('./fixtures', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./fixtures')>();
  return { ...actual, resolveFixtureMapping: vi.fn(actual.resolveFixtureMapping) };
});

import { project } from '../stores/layers';
import { invoke } from '../bridge';
import type { PixelMapConfig, PixelMapFixture } from '../types';
import { createDefaultPixelMapConfig, createPixelMapFixture, resolveFixtureMapping } from './fixtures';
import { startPixelMapOutput } from './sender';

let stop: (() => void) | null = null;

const resolvesFor = (id: string) => vi.mocked(resolveFixtureMapping).mock.calls.filter(([fixture]) => fixture.id === id).length;

function pixelMap(fixtures: PixelMapFixture[]): PixelMapConfig {
  return { ...createDefaultPixelMapConfig(), enabled: true, fixtures };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(resolveFixtureMapping).mockClear();
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(async () => ({ ok: true, stats: { sending: true } }));
});

afterEach(() => {
  stop?.();
  stop = null;
  project.set({} as never);
  vi.useRealTimers();
});

it('builds each fixture map once, not on every tick, and again only for the fixture whose map changed', async () => {
  const points = Array.from({ length: 4096 }, (_, i) => ({ x: (i % 64) / 64, y: Math.floor(i / 64) / 64 }));
  const custom: PixelMapFixture = {
    ...createPixelMapFixture([]), id: 'custom', address: '127.0.0.1', type: 'custom', pixelCount: 4096,
    testPattern: 'solid', mapping: { mode: 'custom', points, sampleRadius: 0 },
  };
  const strip: PixelMapFixture = { ...createPixelMapFixture([]), id: 'strip', address: '127.0.0.1', universe: 40, pixelCount: 10, testPattern: 'solid' };
  project.set({ pixelMap: pixelMap([custom, strip]) } as never);
  stop = startPixelMapOutput();
  await vi.advanceTimersByTimeAsync(1000);
  expect(resolvesFor('custom')).toBe(1);
  expect(resolvesFor('strip')).toBe(1);

  // Brightness edit on the strip: neither map is rebuilt.
  project.set({ pixelMap: pixelMap([custom, { ...strip, brightness: 0.5 }]) } as never);
  await vi.advanceTimersByTimeAsync(500);
  expect(resolvesFor('custom')).toBe(1);
  expect(resolvesFor('strip')).toBe(1);

  // A new map for the strip rebuilds the strip only.
  project.set({ pixelMap: pixelMap([custom, { ...strip, brightness: 0.5, mapping: { ...strip.mapping!, reverse: true } }]) } as never);
  await vi.advanceTimersByTimeAsync(500);
  expect(resolvesFor('custom')).toBe(1);
  expect(resolvesFor('strip')).toBe(2);
});
