import { afterEach, describe, expect, it } from 'vitest';
import {
  DRIFT_EASE_SECONDS,
  applyDrift,
  driftCycleSeconds,
  driftNoise,
  driftRanges,
  driftSeconds,
  driftStateSize,
  normalizeDrift,
  newDrift,
  resetDriftForTest,
  toggledDrift,
  toggledHold,
  type VisualDrift,
} from './visualDrift';
import { beginRenderClock, endRenderClock, setRenderClockSeconds } from '../recording/renderClock';
import { defaultStudioSource, expandStudioLayers, normalizeStudioSource, type StudioRenderInputs, type StudioVoice } from './studioPlugin';
import { normalizeStack, voiceItem, mediaItem } from './clipStack';
import { bringStack, clearStacks, setStackClock } from './stackRuntime';
import { createLayer, type Layer } from '../types';
import { LiveFrameWriter, liveParamsTick, resetLiveValuesForTest } from '../audio/liveParams';
import { musicStudio } from './musicStudioStore';

const CODE = `/*{"INPUTS":[
  {"NAME":"zoom","TYPE":"float","MIN":0,"MAX":1,"DEFAULT":0.5},
  {"NAME":"twist","TYPE":"float","MIN":-2,"MAX":2,"DEFAULT":0},
  {"NAME":"rows","TYPE":"float","MIN":4,"MAX":64,"DEFAULT":16},
  {"NAME":"mode","TYPE":"long","VALUES":[0,1],"DEFAULT":0},
  {"NAME":"vxEnv","TYPE":"float","MIN":0,"MAX":1,"DEFAULT":0},
  {"NAME":"vxSource","TYPE":"float","MIN":0,"MAX":1,"DEFAULT":0}
]}*/ void main(){}`;
const ranges = () => driftRanges(CODE);
const drift = (patch: Partial<VisualDrift> = {}): VisualDrift => ({ ...newDrift(1234), ...patch });

afterEach(() => resetDriftForTest());

describe('drift: which settings', () => {
  it('drifts decimal looks only: not counts, choices or what the sound drives', () => {
    expect(ranges().map((r) => r.name)).toEqual(['zoom', 'twist']);
  });
});

describe('drift: the wander', () => {
  it('is smooth: no step bigger than a hair between frames, at any speed', () => {
    for (const speed of [0, 0.2, 1]) {
      const cycle = driftCycleSeconds(speed);
      let last = driftNoise(7, 'zoom', 0, cycle);
      let biggest = 0;
      for (let f = 1; f < 60 * 120; f++) {
        const n = driftNoise(7, 'zoom', f / 60, cycle);
        biggest = Math.max(biggest, Math.abs(n - last));
        last = n;
      }
      // Over a whole cycle the noise moves at most a few units: per frame a tiny fraction.
      expect(biggest).toBeLessThan((8 / (cycle * 60)) * 2);
    }
  });

  it('is slow by default: a cycle of minutes', () => {
    expect(driftCycleSeconds(newDrift().speed)).toBeGreaterThan(100);
    expect(driftCycleSeconds(1)).toBeGreaterThanOrEqual(15);
  });

  it('stays within the range and within amount either side of your value', () => {
    const d = drift({ amount: 0.4 });
    const r = ranges();
    for (let t = DRIFT_EASE_SECONDS + 1; t < 900; t += 0.37) {
      const out = applyDrift('v', { zoom: 0.9, twist: 0 }, r, d, t);
      expect(out.zoom).toBeGreaterThanOrEqual(0.9 - 0.4 * 0.5 - 1e-9);
      expect(out.zoom).toBeLessThanOrEqual(1);
      expect(Math.abs(out.twist)).toBeLessThanOrEqual(0.4 * 4 * 0.5 + 1e-9);
    }
  });

  it('really moves, and two settings (and two visuals) move differently', () => {
    const d = drift();
    const r = ranges();
    const zs: number[] = [];
    for (let t = 10; t < 400; t += 5) zs.push(applyDrift('v', { zoom: 0.5, twist: 0 }, r, d, t).zoom);
    expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(0.05);
    expect(driftNoise(1, 'zoom', 60, 120)).not.toBeCloseTo(driftNoise(1, 'twist', 60, 120), 3);
    expect(driftNoise(1, 'zoom', 60, 120)).not.toBeCloseTo(driftNoise(2, 'zoom', 60, 120), 3);
  });

  it('is deterministic: the same seed and time give the same value', () => {
    const a = applyDrift('a', { zoom: 0.5 }, ranges(), drift(), 77.25);
    resetDriftForTest();
    const b = applyDrift('a', { zoom: 0.5 }, ranges(), drift(), 77.25);
    expect(a).toEqual(b);
  });

  it('leaves the saved settings untouched, and returns them as they are with drift off', () => {
    const saved = Object.freeze({ zoom: 0.5, twist: 1, rows: 16 });
    applyDrift('v', saved, ranges(), drift(), 40);
    const out = applyDrift('v', saved, ranges(), drift(), 50);
    expect(out).not.toBe(saved);
    expect(out.rows).toBe(16);
    expect(applyDrift('w', saved, ranges(), undefined, 50)).toBe(saved);
    expect(applyDrift('w', saved, ranges(), drift({ on: false }), 50)).toBe(saved);
  });
});

describe('drift: easing in and out', () => {
  it('eases in from your value when turned on, and back to it when turned off', () => {
    const r = ranges();
    const base = { zoom: 0.5, twist: 0 };
    const start = 100;
    expect(applyDrift('v', base, r, drift(), start).zoom).toBeCloseTo(0.5, 9);
    const full = applyDrift('v', base, r, drift(), start + DRIFT_EASE_SECONDS + 0.1).zoom;
    expect(full).not.toBeCloseTo(0.5, 3);
    // Off: the next frame is still near where it was (no jump)...
    const offAt = start + DRIFT_EASE_SECONDS + 0.2;
    const justOff = applyDrift('v', base, r, drift({ on: false }), offAt).zoom;
    expect(Math.abs(justOff - full)).toBeLessThan(0.01);
    // ...and after the ease it is exactly the saved value, with no state left behind.
    expect(applyDrift('v', base, r, drift({ on: false }), offAt + DRIFT_EASE_SECONDS + 0.01).zoom).toBe(0.5);
    expect(driftStateSize()).toBe(0);
  });

  it('a setting held out of drift eases back to your value and stays there', () => {
    const r = ranges();
    const d = drift();
    for (let t = 0; t < 10; t += 0.5) applyDrift('v', { zoom: 0.5, twist: 0 }, r, d, t);
    const held = toggledHold(d, 'zoom');
    applyDrift('v', { zoom: 0.5, twist: 0 }, r, held, 10);
    const out = applyDrift('v', { zoom: 0.5, twist: 0 }, r, held, 10 + DRIFT_EASE_SECONDS + 0.1);
    expect(out.zoom).toBe(0.5);
    expect(out.twist).not.toBe(0);
    expect(toggledHold(held, 'zoom').hold).toBeUndefined();
  });

  it('steps aside for a setting something else drives (Auto, lines, a controller)', () => {
    const r = ranges();
    const out = applyDrift('v', { zoom: 0.5, twist: 0 }, r, drift(), 400, (name) => name === 'zoom');
    expect(out.zoom).toBe(0.5);
  });

  it('keeps its memory bounded however many visuals come and go', () => {
    for (let i = 0; i < 700; i++) applyDrift(`v${i}`, { zoom: 0.5 }, ranges(), drift(), i);
    expect(driftStateSize()).toBeLessThanOrEqual(512);
  });
});

describe('drift: Render to video', () => {
  afterEach(() => endRenderClock());
  it('runs on the render clock, so two renders drift the same', () => {
    const render = () => {
      resetDriftForTest();
      beginRenderClock(0);
      const values: number[] = [];
      for (let f = 0; f < 300; f += 7) {
        setRenderClockSeconds(f / 30);
        values.push(applyDrift('v', { zoom: 0.5 }, ranges(), drift(), driftSeconds()).zoom);
      }
      endRenderClock();
      return values;
    };
    const a = render();
    expect(render()).toEqual(a);
    beginRenderClock(3);
    setRenderClockSeconds(12.5);
    expect(driftSeconds()).toBe(12.5);
  });
});

describe('drift: saved with the visual', () => {
  it('a voice keeps its drift through a save; old voices have none', () => {
    const voice: StudioVoice = { file: 'VX-Barcode.fs', source: 'kick', auto: true, level: 1, blend: 'screen', params: {}, drift: { on: true, amount: 0.2, speed: 0.5, seed: 99, hold: ['zoom'] } };
    const src = normalizeStudioSource(JSON.parse(JSON.stringify({ musicVoices: [voice, { file: 'VX-Panels.fs', source: 'hats' }] })));
    expect(src.musicVoices[0].drift).toEqual(voice.drift);
    expect('drift' in src.musicVoices[1]).toBe(false);
  });

  it('a stack layer keeps its drift; damaged values are put right', () => {
    const stack = normalizeStack({ items: [{ ...voiceItem('a', 'VX-Barcode.fs', 'all'), drift: { on: 'yes', amount: 7, speed: -1, seed: 'x', hold: ['ok', 3, 'no way'] } }], blend: 'screen', opacity: 1, effects: [] })!;
    expect(stack.items[0].drift).toEqual({ on: false, amount: 1, speed: 0, seed: 1, hold: ['ok'] });
    expect(normalizeDrift(null)).toBeUndefined();
    expect(toggledDrift(undefined).on).toBe(true);
    expect(toggledDrift({ ...drift(), on: true }).on).toBe(false);
  });
});

// ── In the studio's frame ───────────────────────────────────────────────

let now = 0;
const inputs: StudioRenderInputs = { code: () => CODE, driven: () => ({ vxEnv: 0.75, vxBars: 0, vxBar: 0 }), seconds: () => now };
function host(voices: StudioVoice[]): Layer {
  return {
    ...createLayer('host', 'Studio', 'media'),
    source: { id: 'c', type: 'effect', name: 'S', src: 'plugin://musicstudio', effectSource: { ...defaultStudioSource(), musicVoices: voices, musicFinish: { glow: 0, trails: 0, grade: 'neutral' as const, grain: 0 } } },
  } as Layer;
}
const valuesOf = (out: Layer[], id: string) => out.find((l) => l.id === id)!.source!.shaderValues as Record<string, number>;

describe('drift in the studio frame', () => {
  afterEach(() => {
    clearStacks();
    setStackClock(() => performance.now());
    resetLiveValuesForTest();
  });

  it('moves a voice\'s look under the sound: the driven inputs still land on top, the saved look stays', () => {
    const voice: StudioVoice = { file: 'VX-Barcode.fs', source: 'kick', auto: true, level: 1, params: { zoom: 0.5 }, drift: drift() };
    const layer = host([voice]);
    const before = JSON.stringify(layer);
    const zooms: number[] = [];
    for (now = 0; now < 200; now += 2) {
      const v = valuesOf(expandStudioLayers([layer], inputs), 'music-voice:host:0');
      expect(v.vxEnv).toBe(0.75);
      zooms.push(v.zoom);
    }
    expect(Math.max(...zooms) - Math.min(...zooms)).toBeGreaterThan(0.02);
    expect(JSON.stringify(layer)).toBe(before);
  });

  it('a stack layer drifts too (audio shader and library shader)', () => {
    const shader = { kind: 'shader' as const, name: 'Tunnel', src: 'ISF/Tunnel.fs', shaderCode: CODE, shaderValues: { zoom: 0.5 } };
    const stack = { items: [{ ...voiceItem('v', 'VX-Barcode.fs', 'all'), params: { zoom: 0.5 }, drift: drift() }, { ...mediaItem('m', shader)!, drift: drift({ seed: 5 }) }], blend: 'screen' as const, opacity: 1, effects: [] };
    setStackClock(() => 0);
    bringStack({ track: 'studio:lead', order: 1, trackName: 'Lead', clipName: 'Hook', clipId: 'c1', resolve: () => stack }, 0);
    const layer = host([]);
    const seen = { v: new Set<number>(), m: new Set<number>() };
    for (now = 10; now < 200; now += 10) {
      const out = expandStudioLayers([layer], inputs);
      seen.v.add(+(out.find((l) => /:stack:s\d+:v$/.test(l.id))!.source!.shaderValues as Record<string, number>).zoom.toFixed(4));
      seen.m.add(+(out.find((l) => /:stack:s\d+:m$/.test(l.id))!.source!.shaderValues as Record<string, number>).zoom.toFixed(4));
    }
    expect(seen.v.size).toBeGreaterThan(5);
    expect(seen.m.size).toBeGreaterThan(5);
    expect(stack.items[0].params.zoom).toBe(0.5);
  });

  it('yields to a value another engine drives on the voice this frame, easing back to it', () => {
    const voice: StudioVoice = { file: 'VX-Barcode.fs', source: 'kick', auto: true, level: 1, params: { zoom: 0.5 }, drift: drift() };
    const frame = () => valuesOf(expandStudioLayers([host([voice])], inputs), 'music-voice:host:0');
    // Drifting freely first.
    for (now = 300; now < 300 + DRIFT_EASE_SECONDS * 2; now += 0.5) frame();
    expect(frame().zoom).not.toBe(0.5);
    // Something drives zoom on this voice now: drift lets go of it (and only it).
    const w = new LiveFrameWriter('auto');
    w.layer('music-voice:host:0', 'music-voice:host:0:VX-Barcode.fs', 'shader:zoom', 0.9);
    w.commit();
    for (let end = now + DRIFT_EASE_SECONDS + 0.5; now < end; now += 0.5) frame();
    const v = frame();
    expect(v.zoom).toBe(0.5);
    expect(typeof v.twist).toBe('number');
    expect(v.twist).not.toBe(0);
  });

  it('publishes nothing while it moves: no store, no live-value or panel tick per frame', () => {
    const voice: StudioVoice = { file: 'VX-Barcode.fs', source: 'kick', auto: true, level: 1, params: { zoom: 0.5 }, drift: drift() };
    const layer = host([voice]);
    let studioTicks = 0;
    let liveTicks = 0;
    const a = musicStudio.subscribe(() => studioTicks++);
    const b = liveParamsTick.subscribe(() => liveTicks++);
    for (now = 0; now < 120; now += 1 / 60) expandStudioLayers([layer], inputs);
    a();
    b();
    // Only the call each subscription makes when it starts.
    expect(studioTicks).toBe(1);
    expect(liveTicks).toBe(1);
  });
});

