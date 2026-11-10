/**
 * Per-instance seeds for the effects that break the picture up at random
 * (Glitch, Block Corrupt, Data Bend), and the shader clock the editor packs
 * into uniforms. Pixel behaviour is pinned in nativeGlitchEffects.native.test.ts
 * and nativeShaderClock.native.test.ts; this covers the editor side.
 */
import { describe, expect, it, vi } from 'vitest';

// The sync module reads browser globals when it loads.
vi.hoisted(() => {
  const storage = new Map<string, string>();
  const g = globalThis as any;
  g.localStorage ??= { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v), removeItem: (k: string) => storage.delete(k), clear: () => storage.clear() };
  g.document ??= { documentElement: { style: { setProperty: () => {} } } };
  g.window ??= { addEventListener: () => {}, removeEventListener: () => {}, matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }) };
  g.requestAnimationFrame ??= () => 1;
  g.cancelAnimationFrame ??= () => {};
});
import { getDefaultEffectParams, newEffectSeed, reseedEffectCopies } from './effects';
import { nativeEffectSeed, packNativeEffectPassUniforms } from './nativeEffectPass';
import {
  effectToNativeDescriptor,
  nativeEffectPassFromDescriptor,
  nativeShaderClockSeconds,
  NATIVE_SHADER_CLOCK_WRAP_SECONDS,
} from '../sync/nativeRendererSync';

const glitchParams = { glitchIntensity: 0.5, glitchSpeed: 1, glitchBlockSize: 0.3, glitchRGBSplit: 0.5, glitchJitter: 0.3, glitchTriggerMode: 0, glitchBlockHold: 0.3, glitchVerticalSlice: 0, glitchFreezeBurst: 0, glitchTearChance: 0 };

describe('effect seeds', () => {
  it('new instances get a seed; each one its own', () => {
    const seeds = new Set<number>();
    for (let i = 0; i < 50; i++) {
      for (const [type, key] of [['glitch', 'glitchSeed'], ['blockCorrupt', 'bcSeed'], ['dataBend', 'dbSeed']] as const) {
        const seed = (getDefaultEffectParams(type) as Record<string, number>)[key];
        expect(Number.isInteger(seed) && seed >= 1 && seed < 2 ** 24).toBe(true);
        seeds.add(seed);
      }
    }
    expect(seeds.size).toBeGreaterThan(140);
    expect(newEffectSeed()).not.toBe(0);
  });

  it('a duplicated layer re-seeds its copies, seedless ones included; other effects are untouched', () => {
    const effects: Array<{ id: string; type: any; enabled: boolean; params: Record<string, any> }> = [
      { id: 'a', type: 'glitch' as const, enabled: true, params: { ...glitchParams, glitchSeed: 5 } },
      { id: 'b', type: 'glitch' as const, enabled: true, params: { ...glitchParams } },
      { id: 'c', type: 'blockCorrupt' as const, enabled: true, params: { bcIntensity: 0.5 } },
      { id: 'd', type: 'invert' as const, enabled: true, params: {} },
    ];
    const copies = reseedEffectCopies(effects)!;
    expect(copies[0].params.glitchSeed).not.toBe(5);
    expect(copies[1].params.glitchSeed).toBeGreaterThan(0);
    expect((copies[2].params as any).bcSeed).toBeGreaterThan(0);
    expect(copies[3]).toBe(effects[3]);
    // Everything else is copied as it was.
    expect({ ...copies[0].params, glitchSeed: 5 }).toEqual(effects[0].params);
    expect(effects[1].params).not.toHaveProperty('glitchSeed');
  });

  it('the seed reaches the shader slot; a seedless (saved before seeds) instance packs 0', () => {
    const pack = (params: Record<string, unknown>) => {
      const pass = nativeEffectPassFromDescriptor(effectToNativeDescriptor({ id: 'g', type: 'glitch', enabled: true, params }))!;
      return packNativeEffectPassUniforms({ effect: pass.effect, amount: pass.amount, params: pass.params, width: 1, height: 1 } as any);
    };
    // params2.w (index 8 + 11) is Glitch's seed.
    expect(pack(glitchParams)[19]).toBe(0);
    expect(pack({ ...glitchParams, glitchSeed: 4242 })[19]).toBe(4242);
    // Seedless and seed-0 instances pack the same uniforms as before seeds existed.
    expect(pack(glitchParams)).toEqual(pack({ ...glitchParams, glitchSeed: 0 }));
    const bc = (params: Record<string, unknown>) => {
      const pass = nativeEffectPassFromDescriptor(effectToNativeDescriptor({ id: 'b', type: 'blockCorrupt', enabled: true, params }))!;
      return packNativeEffectPassUniforms({ effect: pass.effect, amount: pass.amount, params: pass.params, width: 1, height: 1 } as any);
    };
    expect(bc({ bcIntensity: 0.5 })[16]).toBe(0);
    expect(bc({ bcIntensity: 0.5, bcSeed: 99 })[16]).toBe(99);
    const db = (params: Record<string, unknown>) => {
      const pass = nativeEffectPassFromDescriptor(effectToNativeDescriptor({ id: 'd', type: 'dataBend', enabled: true, params }))!;
      return packNativeEffectPassUniforms({ effect: pass.effect, amount: pass.amount, params: pass.params, width: 1, height: 1 } as any);
    };
    expect(db({ dbIntensity: 0.5 })[15]).toBe(0);
    expect(db({ dbIntensity: 0.5, dbSeed: 99 })[15]).toBe(99);
    expect([nativeEffectSeed(undefined), nativeEffectSeed(-3), nativeEffectSeed('x'), nativeEffectSeed(2 ** 30), nativeEffectSeed(12.4)]).toEqual([0, 0, 0, 16777215, 12]);
  });
});

describe('shader clock packed by the editor', () => {
  it('is the live clock in a show and never coarser than 2 ms after it', () => {
    for (const t of [0, 1 / 60, 10, 3600.5, 9 * 3600]) expect(nativeShaderClockSeconds(t)).toBe(t);
    expect(nativeShaderClockSeconds(-1)).toBe(0);
    expect(nativeShaderClockSeconds(Number.NaN)).toBe(0);
    for (const hours of [12, 24, 24 * 7, 24 * 365]) {
      const start = hours * 3600 + 0.123;
      for (let frame = 0; frame < 120; frame++) {
        const a = Math.fround(nativeShaderClockSeconds(start + frame / 60));
        const b = Math.fround(nativeShaderClockSeconds(start + (frame + 1) / 60));
        if (b < a) continue; // the wrap moment
        expect(Math.abs(b - a - 1 / 60)).toBeLessThan(0.002);
      }
      // The f32 the old clock packed: a week in, 60 fps frames repeat.
      if (hours >= 24 * 7) expect(Math.fround(start + 1 / 60) - Math.fround(start)).not.toBeCloseTo(1 / 60, 3);
    }
    expect(NATIVE_SHADER_CLOCK_WRAP_SECONDS).toBe(32768);
  });
});
