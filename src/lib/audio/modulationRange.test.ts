import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

// The stores touch DOM / storage globals at import time.
vi.hoisted(() => {
  function installDomShim(): void {
    const storage = new Map<string, string>();
    (globalThis as any).localStorage = {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => void storage.set(k, String(v)),
      removeItem: (k: string) => void storage.delete(k),
      clear: () => storage.clear(), key: () => null, length: 0,
    };
    const makeEl = (): any => ({
      style: { setProperty() {}, removeProperty() {}, getPropertyValue: () => '' },
      dataset: {}, classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
      setAttribute() {}, removeAttribute() {}, getAttribute: () => null,
      appendChild: (c: any) => c, removeChild: (c: any) => c,
      addEventListener() {}, removeEventListener() {},
      querySelector: () => null, querySelectorAll: () => [],
      load() {}, play: () => Promise.resolve(), pause() {},
    });
    (globalThis as any).document = {
      documentElement: makeEl(), body: makeEl(), head: makeEl(), createElement: () => makeEl(),
      querySelector: () => null, querySelectorAll: () => [], getElementById: () => null,
      addEventListener() {}, removeEventListener() {}, visibilityState: 'visible',
    };
    (globalThis as any).window = globalThis;
    (globalThis as any).dispatchEvent = () => true;
    (globalThis as any).CustomEvent ??= class extends Event {
      detail: unknown;
      constructor(name: string, options: any) { super(name); this.detail = options?.detail; }
    };
    (globalThis as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
    (globalThis as any).requestAnimationFrame = (cb: (t: number) => void) => setTimeout(() => cb(Date.now()), 0) as unknown as number;
    (globalThis as any).cancelAnimationFrame = (id: number) => clearTimeout(id as never);
  }
  installDomShim();
});

// Drive the modulation engine with a hand-set audio level instead of the
// live Milkdrop follower.
const visual = vi.hoisted(() => ({ bass: 0, level: 0, kick: 0, beatPhase: 0 }));
vi.mock('./visualAudio', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./visualAudio')>();
  return {
    ...actual,
    getVisualAudioSnapshot: () => ({ ...actual.getVisualAudioSnapshot(), ...visual, bands: { ...actual.getVisualAudioSnapshot().bands, bass: visual.bass } }),
  };
});

import {
  computeModulatedValue, defaultModRange, rangeWithRestAt, hasModRange,
  type ParamModulation,
} from './modulation';

const mod = (patch: Partial<ParamModulation>): ParamModulation =>
  ({ source: 'bass', amount: 1, speed: 1, invert: false, bpmSync: false, ...patch });

describe('modulation value maths', () => {
  it('keeps the 2.0.12 formula exactly for modulations saved without a range', () => {
    // 2.0.12: base + ((0.5 + v × 0.5, inverted) − 0.5) × amount × span, clamped.
    const legacy = (m: ParamModulation, v: number, base: number, lo: number, hi: number) => {
      let signal = ['lfo-sine', 'lfo-saw', 'lfo-tri', 'lfo-square', 'beatPhase'].includes(m.source) ? v : 0.5 + v * 0.5;
      if (m.invert) signal = 1 - signal;
      return Math.max(lo, Math.min(hi, base + (signal - 0.5) * m.amount * (hi - lo)));
    };
    for (const m of [mod({}), mod({ amount: 0.3 }), mod({ invert: true }), mod({ source: 'kick', amount: 0.6 }),
      mod({ source: 'lfo-sine', amount: 0.8 }), mod({ source: 'beatPhase', invert: true })]) {
      for (const v of [0, 0.2, 0.5, 1]) {
        expect(hasModRange(m)).toBe(false);
        expect(computeModulatedValue(m, v, 25, 0, 100)).toBeCloseTo(legacy(m, v, 25, 0, 100), 10);
      }
    }
    // Depth does change a legacy modulation: full level at 100% vs 30%.
    expect(computeModulatedValue(mod({ amount: 1 }), 1, 25, 0, 100)).toBe(75);
    expect(computeModulatedValue(mod({ amount: 0.3 }), 1, 25, 0, 100)).toBe(40);
  });

  it('maps the source straight onto Min..Max in range mode, inverted on request', () => {
    const ranged = mod({ rangeMin: 0.1, rangeMax: 0.6 });
    expect(computeModulatedValue(ranged, 0, 99, 0, 100)).toBeCloseTo(10);
    expect(computeModulatedValue(ranged, 0.5, 99, 0, 100)).toBeCloseTo(35);
    expect(computeModulatedValue(ranged, 1, 99, 0, 100)).toBeCloseTo(60);
    const inverted = { ...ranged, invert: true };
    expect(computeModulatedValue(inverted, 0, 99, 0, 100)).toBeCloseTo(60);
    expect(computeModulatedValue(inverted, 1, 99, 0, 100)).toBeCloseTo(10);
    // Depth is not part of range mode; the range is in the param's own units.
    expect(computeModulatedValue({ ...ranged, amount: 0.2 }, 1, 0, 0, 100)).toBeCloseTo(60);
    expect(computeModulatedValue(mod({ source: 'lfo-tri', rangeMin: 0.25, rangeMax: 0.75 }), 0.5, 0, -2, 2)).toBeCloseTo(0);
  });

  it('defaults a new range to slider..max and moves the resting end with the slider', () => {
    expect(defaultModRange(25, 0, 100)).toEqual({ rangeMin: 0.25, rangeMax: 1 });
    expect(defaultModRange(100, 0, 100)).toEqual({ rangeMin: 0, rangeMax: 1 });
    expect(defaultModRange(3, 2, 4)).toEqual({ rangeMin: 0.5, rangeMax: 1 });
    expect(rangeWithRestAt({ invert: false, rangeMin: 0.2, rangeMax: 0.6 }, 0.4)).toEqual({ rangeMin: 0.4, rangeMax: 0.6 });
    expect(rangeWithRestAt({ invert: false, rangeMin: 0.2, rangeMax: 0.6 }, 0.8)).toEqual({ rangeMin: 0.8, rangeMax: 0.8 });
    expect(rangeWithRestAt({ invert: true, rangeMin: 0.2, rangeMax: 0.6 }, 0.1)).toEqual({ rangeMin: 0.1, rangeMax: 0.1 });
  });
});

describe('effect-param modulation in the engine', () => {
  let layers: typeof import('../stores/layers');
  let m: typeof import('./modulation');
  let now = 10000;
  let nextFrame = 0;
  const frames = new Map<number, FrameRequestCallback>();
  const flush = () => new Promise<void>(resolve => queueMicrotask(resolve));
  async function tick() {
    await flush();
    now += 16;
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach(callback => callback(now));
  }
  const amount = () => get(layers.project).layers[0].effects[0].params.amount as number;
  const key = 'map:0:fx:fx1:amount';
  const setSource = (patch: Partial<ParamModulation>) =>
    m.modulationStore.setEffectModulation(0, 'fx1', 'amount', mod(patch), 'A', 'mapping');

  beforeAll(async () => {
    layers = await import('../stores/layers');
    m = await import('./modulation');
  });
  beforeEach(async () => {
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.set(++nextFrame, cb); return nextFrame; });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
    m.modulationStore.clearAll(); m.modulationEngine.stop();
    const types = await import('../types');
    expect(layers.project.importProject({ version: '2.0.13', project: { id: 'range', name: 'Range', width: 1920, height: 1080,
      layers: [{ ...types.createLayer('lay', 'Layer', 'media'), effects: [{ id: 'fx1', type: 'blur', enabled: true, params: { amount: 25 } }] }] } })).toBe(true);
    m.registerEffectParamRange(0, 'fx1', 'amount', 0, 100);
    Object.assign(visual, { bass: 0, level: 0, kick: 0, beatPhase: 0 });
  });
  afterEach(async () => {
    m.modulationStore.clearAll(); m.modulationEngine.stop();
    (await import('../stores/audio')).audioStore.setSensitivity(1);
    frames.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  });

  it('starts from the current slider after Manual → slider 0 → audio (the reported 25..100 bug)', async () => {
    visual.bass = 1;
    setSource({});            // slider at 25, audio on
    await tick();
    expect(amount()).toBe(75);
    setSource({ source: 'manual' });
    await tick();
    expect(amount()).toBe(25); // Manual puts the slider value back
    layers.project.updateEffectParams('lay', 'fx1', { amount: 0 });
    setSource({});            // audio again, from 0 this time
    await tick();
    expect(amount()).toBe(50);
    visual.bass = 0;
    await tick();
    expect(amount()).toBe(0);  // silence sits on the new slider value, not 25
  });

  it('follows the slider while modulated', async () => {
    setSource({});
    await tick();
    m.setModulationBase(key, 40);
    layers.project.updateEffectParams('lay', 'fx1', { amount: 40 });
    visual.bass = 0.5;
    await tick();
    expect(amount()).toBe(65);
    setSource({ source: 'manual' });
    await tick();
    expect(amount()).toBe(40);
  });

  it('keeps a range-mode param inside Min..Max, following the audio', async () => {
    setSource({ rangeMin: 0.1, rangeMax: 0.6 });
    const seen: number[] = [];
    for (const level of [0, 0.25, 0.5, 1, 0.75, 0]) {
      visual.bass = level;
      await tick();
      seen.push(amount());
    }
    expect(seen.map(v => +v.toFixed(3))).toEqual([10, 22.5, 35, 60, 47.5, 10]);
    setSource({ rangeMin: 0.1, rangeMax: 0.6, invert: true });
    visual.bass = 1;
    await tick();
    expect(amount()).toBeCloseTo(10);
    setSource({ source: 'manual' });
    await tick();
    expect(amount()).toBe(25);
  });

  it('applies the audio panel sensitivity to the modulation signal', async () => {
    const { audioStore } = await import('../stores/audio');
    setSource({ rangeMin: 0, rangeMax: 1 });
    visual.bass = 0.25;
    await tick();
    expect(amount()).toBeCloseTo(25);
    audioStore.setSensitivity(2);
    await tick();
    expect(amount()).toBeCloseTo(50);
  });

  it('saves and reloads the range, and loads range-less saves unchanged', async () => {
    m.modulationStore.bulkLoad([
      { key, mod: mod({ rangeMin: 0.1, rangeMax: 0.6, invert: true }) },
      { key: 'map:0:fx:fx1:other', mod: mod({ amount: 0.4 }) },
    ]);
    const saved = JSON.parse(JSON.stringify(layers.project.exportProject()));
    m.modulationStore.clearAll();
    expect(layers.project.importProject(saved)).toBe(true);
    const map = get(m.modulationStore);
    expect(map.get(key)).toMatchObject({ rangeMin: 0.1, rangeMax: 0.6, invert: true });
    expect(hasModRange(map.get('map:0:fx:fx1:other'))).toBe(false);
    expect(map.get('map:0:fx:fx1:other')).not.toHaveProperty('rangeMin');
  });
});
