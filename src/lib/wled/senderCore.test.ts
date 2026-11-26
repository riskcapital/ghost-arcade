import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { get, writable } from 'svelte/store';

vi.mock('../stores/layers', () => ({ project: writable({}) }));
vi.mock('../stores/audio', () => ({ audioStore: writable({ bpm: 120 }) }));
vi.mock('../bridge', () => ({ invoke: vi.fn() }));

import { project } from '../stores/layers';
import { invoke } from '../bridge';
import type { Project, WLEDController } from '../types';
import { setWLEDForceBlack, startWLEDNativeOutput, wledTelemetry } from './sender';
import { createWLEDEffect } from './effects';
import { publishLedTimeline } from '../timeline/leds/ledRuntime';
import { publishLineFrame } from '../timeline/lines/lineRuntime';
import { ledSpotId } from '../timeline/where/spatialOrder';

let stop: (() => void) | null = null;
let coreAnswer: { ok: boolean; reason?: string } = { ok: true };
let coreStats: Record<string, unknown> = {};

const calls = (command: string) => vi.mocked(invoke).mock.calls.filter(([name]) => name === command) as unknown as Array<[string, any]>;
const lastPlan = () => calls('wled_core_configure').at(-1)?.[1];
const sentTo = (id: string) => calls('wled_send_frame').filter(([, args]) => args.controllerId === id).length;

const controller = (id: string, extra: Partial<WLEDController> = {}): WLEDController => ({
  id, name: id.toUpperCase(), ipAddr: '10.0.0.5', port: 21324, ledCount: 2, enabled: true, brightness: 1, gamma: 1, ...extra,
});

function setProject(controllers: WLEDController[], extra: Partial<Project> = {}) {
  project.set({ wledControllers: controllers, ...extra } as never);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('ImageData', class {
    data: Uint8ClampedArray;
    constructor(public width: number, public height: number) { this.data = new Uint8ClampedArray(width * height * 4); }
  });
  vi.stubGlobal('document', {
    createElement: () => ({ width: 1, height: 1, getContext: () => ({ putImageData() {}, drawImage() {}, setTransform() {}, clearRect() {}, save() {}, restore() {}, getImageData: () => ({ width: 1, height: 1, data: new Uint8ClampedArray(4) }) }) }),
  });
  vi.mocked(invoke).mockReset();
  coreAnswer = { ok: true };
  coreStats = { core: true, controllers: [{ controllerId: 'a', live: true, source: '102030405060', rgb: '0a0b0c0d0e0f' }], pictureWidth: 192, pictureHeight: 108 };
  vi.mocked(invoke).mockImplementation(async (command: string) => {
    if (command === 'wled_core_configure') return coreAnswer;
    if (command === 'wled_get_stats') return coreStats;
    if (command === 'native_renderer_get_frame_snapshot') {
      return { width: 2, height: 1, format: 'rgba8unorm', rgba_b64: btoa(String.fromCharCode(255, 0, 0, 255, 0, 0, 255, 255)) };
    }
    return { ok: true };
  });
});

afterEach(() => {
  stop?.();
  stop = null;
  publishLedTimeline(null);
  publishLineFrame(null);
  setWLEDForceBlack(false);
  project.set({} as never);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('hands every controller the core can drive to it and stops the mirror and the sends here', async () => {
  setProject([controller('a', { brightness: 0.5, samplingMode: 'average' }), controller('off', { enabled: false })]);
  stop = startWLEDNativeOutput();
  await vi.advanceTimersByTimeAsync(10);
  expect(calls('wled_core_configure')).toHaveLength(1);
  expect(lastPlan()).toMatchObject({ fps: 20, maxDim: 192, forceBlack: false, controllers: [{ id: 'a', ip: '10.0.0.5', port: 21324, brightness: 0.5, samplingMode: 'average', testPattern: 'off' }] });
  expect(lastPlan().controllers[0].points).toHaveLength(4);
  const snapshots = calls('native_renderer_get_frame_snapshot').length;
  await vi.advanceTimersByTimeAsync(1000);
  expect(sentTo('a')).toBe(0);
  expect(calls('native_renderer_get_frame_snapshot').length).toBe(snapshots);
  // The map preview's telemetry comes from the core.
  expect(get(wledTelemetry).a).toMatchObject({ sourceColor: '#283848', outputColor: '#0c0d0e', timeline: false });
  expect(Array.from(get(wledTelemetry).a.pixels!)).toEqual([10, 11, 12, 13, 14, 15]);
});

it('keeps what the editor computes per frame on the app path: LED FX, Timeline rows and lines, host names', async () => {
  const fx = { ...createWLEDEffect('chase'), active: true, target: { mode: 'controller' as const, controllerId: 'fx' } };
  setProject([controller('a'), controller('fx'), controller('host', { ipAddr: 'wled-bar.local' })], { wledEffects: [fx] } as Partial<Project>);
  stop = startWLEDNativeOutput();
  await vi.advanceTimersByTimeAsync(200);
  expect(lastPlan().controllers.map((c: { id: string }) => c.id)).toEqual(['a']);
  expect(sentTo('fx')).toBeGreaterThan(0);
  expect(sentTo('host')).toBeGreaterThan(0);
  expect(sentTo('a')).toBe(0);

  // The Timeline's LED rows take 'a': straight back to the app path.
  publishLedTimeline({ time: 0, bpm: 120, clips: [{ id: 'c1', rowId: ledSpotId('a'), startTime: 0, duration: 10, fadeIn: 0, fadeOut: 0, kind: 'solid', color: '#ff0000' } as never], lines: new Map(), where: new Map(), looks: [], allDriven: false });
  await vi.advanceTimersByTimeAsync(200);
  expect(calls('wled_core_stop').length).toBe(1);
  expect(sentTo('a')).toBeGreaterThan(0);

  // Timeline gone: 'a' goes back to the core.
  publishLedTimeline(null);
  await vi.advanceTimersByTimeAsync(10);
  expect(lastPlan().controllers.map((c: { id: string }) => c.id)).toEqual(['a']);

  // A Timeline line on its brightness: the app path again.
  const configures = calls('wled_core_configure').length;
  publishLineFrame({ leds: { 'led:a:brightness': 0.4 } } as never);
  await vi.advanceTimersByTimeAsync(200);
  expect(calls('wled_core_stop').length).toBe(2);
  expect(calls('wled_core_configure').length).toBe(configures);
});

it('sends install mode black through the plan', async () => {
  setProject([controller('a')]);
  stop = startWLEDNativeOutput();
  await vi.advanceTimersByTimeAsync(10);
  setWLEDForceBlack(true);
  await vi.advanceTimersByTimeAsync(10);
  expect(lastPlan().forceBlack).toBe(true);
  setWLEDForceBlack(false);
  await vi.advanceTimersByTimeAsync(10);
  expect(lastPlan().forceBlack).toBe(false);
  expect(sentTo('a')).toBe(0);
});

it('sends from the app when the core refuses, and when it is lost', async () => {
  coreAnswer = { ok: false, reason: 'disabled by GA_CORE_WLED=0' };
  setProject([controller('a')]);
  stop = startWLEDNativeOutput();
  await vi.advanceTimersByTimeAsync(200);
  expect(sentTo('a')).toBeGreaterThan(0);
  // Disabled: not asked again on the next edit.
  setProject([controller('a', { brightness: 0.7 })]);
  await vi.advanceTimersByTimeAsync(50);
  expect(calls('wled_core_configure')).toHaveLength(1);
  stop();

  vi.mocked(invoke).mockClear();
  coreAnswer = { ok: true };
  setProject([controller('b')]);
  stop = startWLEDNativeOutput();
  await vi.advanceTimersByTimeAsync(10);
  expect(sentTo('b')).toBe(0);
  coreStats = { core: false, coreLost: true };
  await vi.advanceTimersByTimeAsync(600);
  expect(sentTo('b')).toBeGreaterThan(0);
});

it('rebuilds the plan when the core picture has another aspect', async () => {
  coreStats = { core: true, controllers: [], pictureWidth: 144, pictureHeight: 192 };
  setProject([controller('a', { ledCount: 12 })]);
  stop = startWLEDNativeOutput();
  await vi.advanceTimersByTimeAsync(10);
  const first = lastPlan().controllers[0].points;
  await vi.advanceTimersByTimeAsync(300);
  expect(calls('wled_core_configure').length).toBe(2);
  expect(lastPlan().controllers[0].points).not.toEqual(first);
});
