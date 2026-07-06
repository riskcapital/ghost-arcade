import { describe, expect, it } from 'vitest';
import {
  NATIVE_EFFECT_COVERAGE,
  PUBLIC_EFFECT_TYPES,
  nativeEffectPassIdForEffectType,
  summarizeNativeEffectCoverage,
} from './nativeEffectCoverage';
import { NATIVE_EFFECT_PASS_MANIFEST } from './nativeEffectPass';

describe('native effect coverage', () => {
  it('tracks public effect coverage separately from native helper passes', () => {
    expect(PUBLIC_EFFECT_TYPES).toHaveLength(184);
    expect(NATIVE_EFFECT_PASS_MANIFEST).toHaveLength(64);
    expect(NATIVE_EFFECT_COVERAGE.nativePublicEffectCount).toBe(63);
    expect(NATIVE_EFFECT_COVERAGE.missingPublicEffectCount).toBe(121);
    expect(NATIVE_EFFECT_COVERAGE.nativeOnlyPassIds).toEqual(['grayscale']);
    expect(NATIVE_EFFECT_COVERAGE.missingPublicEffectTypes).toContain('plasma');
    expect(NATIVE_EFFECT_COVERAGE.missingPublicEffectTypes).toContain('halftone');
    expect(NATIVE_EFFECT_COVERAGE.missingPublicEffectTypes).toContain('sphereWireframe');
    expect(NATIVE_EFFECT_COVERAGE.detail).toContain('native public effect coverage 63/184');
  });

  it('normalizes EffectType names to native pass ids', () => {
    expect(nativeEffectPassIdForEffectType('rgbShift')).toBe('rgb-shift');
    expect(nativeEffectPassIdForEffectType('temperatureTint')).toBe('temperature-tint');
    expect(nativeEffectPassIdForEffectType('pinchBulge')).toBe('pinch-bulge');
  });

  it('can summarize alternate manifests for focused readiness tests', () => {
    const summary = summarizeNativeEffectCoverage(['invert', 'rgbShift', 'plasma'], ['invert', 'rgb-shift']);
    expect(summary.nativePublicEffectCount).toBe(2);
    expect(summary.missingPublicEffectTypes).toEqual(['plasma']);
    expect(summary.nativeOnlyPassIds).toEqual([]);
    expect(summary.complete).toBe(false);
  });
});
