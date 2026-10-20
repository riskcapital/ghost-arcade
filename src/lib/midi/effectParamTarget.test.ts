import { describe, expect, it } from 'vitest';
import { clampToSchema, resolveEffectParam } from './effectParamTarget';
import type { Effect } from '../types';

const effect = (id: string, type: string, params: Record<string, unknown>) => ({ id, type, params } as unknown as Effect);
const schema = { hue: { hueShift: { min: 0, max: 360 } }, cubeLut: { lutStrength: {}, lutIntensity: {} } };

describe('resolveEffectParam', () => {
  it('restores the case of effect ids and parameter keys', () => {
    expect(resolveEffectParam([effect('FX-Hue', 'hue', { hueShift: 0 })], 'fx-hue', 'hueshift', schema))
      .toEqual({ id: 'FX-Hue', key: 'hueShift' });
  });

  it('prefers the schema key over a stray lowercase key in params', () => {
    const fx = effect('lut', 'cubeLut', { lutStrength: 1, lutintensity: 0.4 });
    expect(resolveEffectParam([fx], 'lut', 'lutintensity', schema)).toEqual({ id: 'lut', key: 'lutIntensity' });
  });

  it('falls back to params for effects without a schema entry', () => {
    expect(resolveEffectParam([effect('a', 'custom', { mixAmount: 1 })], 'a', 'mixamount', schema))
      .toEqual({ id: 'a', key: 'mixAmount' });
  });

  it('holds values to the schema range when it has one', () => {
    const effects = [effect('h', 'hue', {}), effect('l', 'cubeLut', {})];
    expect(clampToSchema(effects, { id: 'h', key: 'hueShift' }, 400, schema)).toBe(360);
    expect(clampToSchema(effects, { id: 'h', key: 'hueShift' }, -5, schema)).toBe(0);
    expect(clampToSchema(effects, { id: 'l', key: 'lutStrength' }, 7, schema)).toBe(7);
  });

  it('ignores unknown effects and parameters instead of inventing keys', () => {
    expect(resolveEffectParam([effect('a', 'hue', {})], 'b', 'hueshift', schema)).toBeNull();
    expect(resolveEffectParam([effect('a', 'hue', {})], 'a', 'nonsense', schema)).toBeNull();
  });
});
