import { describe, expect, it } from 'vitest';
import {
  NATIVE_EFFECT_COVERAGE,
  PUBLIC_EFFECT_TYPES,
  isNativeSelectableEffect,
  nativeEffectPassIdForEffectType,
  summarizeNativeEffectCoverage,
} from './nativeEffectCoverage';
import { NATIVE_EFFECT_PASS_MANIFEST } from './nativeEffectPass';

describe('native effect coverage', () => {
  it('tracks public effect coverage separately from native helper passes', () => {
    expect(PUBLIC_EFFECT_TYPES).toHaveLength(184);
    expect(NATIVE_EFFECT_PASS_MANIFEST).toHaveLength(183);
    expect(NATIVE_EFFECT_COVERAGE.nativePublicEffectCount).toBe(182);
    expect(NATIVE_EFFECT_COVERAGE.missingPublicEffectCount).toBe(2);
    expect(NATIVE_EFFECT_COVERAGE.sourceFramePassEligibleEffectCount).toBe(182);
    expect(NATIVE_EFFECT_COVERAGE.nativeSourceFramePassEffectCount).toBe(182);
    expect(NATIVE_EFFECT_COVERAGE.missingSourceFramePassEffectCount).toBe(0);
    expect(NATIVE_EFFECT_COVERAGE.deferredNativeGraphEffectTypes).toEqual([
      'gpuFluidSim',
      'eulerianMagnify',
    ]);
    expect(NATIVE_EFFECT_COVERAGE.nativeOnlyPassIds).toEqual(['grayscale']);
    expect(NATIVE_EFFECT_COVERAGE.nativePublicEffectTypes).toContain('plasma');
    expect(NATIVE_EFFECT_COVERAGE.nativePublicEffectTypes).toContain('halftone');
    expect(NATIVE_EFFECT_COVERAGE.nativePublicEffectTypes).toContain('toon');
    expect(NATIVE_EFFECT_COVERAGE.nativePublicEffectTypes).toContain('kuwahara');
    expect(NATIVE_EFFECT_COVERAGE.nativePublicEffectTypes).toContain('sphereWireframe');
    expect(NATIVE_EFFECT_COVERAGE.missingPublicEffectTypes).toContain('gpuFluidSim');
    expect(NATIVE_EFFECT_COVERAGE.missingPublicEffectTypes).toContain('eulerianMagnify');
    expect(NATIVE_EFFECT_COVERAGE.missingSourceFramePassEffectTypes).not.toContain('gpuFluidSim');
    expect(NATIVE_EFFECT_COVERAGE.missingSourceFramePassEffectTypes).not.toContain('eulerianMagnify');
    expect(NATIVE_EFFECT_COVERAGE.missingSourceFramePassEffectTypes).not.toContain('kuwahara');
    expect(NATIVE_EFFECT_COVERAGE.missingSourceFramePassEffectTypes).not.toContain('phaseLab');
    expect(NATIVE_EFFECT_COVERAGE.missingSourceFramePassEffectTypes).toHaveLength(0);
    expect(NATIVE_EFFECT_COVERAGE.detail).toContain('native source-frame effect-pass coverage 182/182');
    expect(NATIVE_EFFECT_COVERAGE.detail).toContain('stateful/multi-frame effects tracked outside the effect-pass route');
  });

  it('normalizes EffectType names to native pass ids', () => {
    expect(nativeEffectPassIdForEffectType('rgbShift')).toBe('rgb-shift');
    expect(nativeEffectPassIdForEffectType('temperatureTint')).toBe('temperature-tint');
    expect(nativeEffectPassIdForEffectType('pinchBulge')).toBe('pinch-bulge');
  });

  it('exposes the strict native-only picker inventory', () => {
    expect(isNativeSelectableEffect('invert')).toBe(true);
    expect(isNativeSelectableEffect('rgbShift')).toBe(true);
    expect(isNativeSelectableEffect('phaseLab')).toBe(true);
    expect(isNativeSelectableEffect('gpuFluidSim')).toBe(false);
  });

  it('can summarize alternate manifests for focused readiness tests', () => {
    const summary = summarizeNativeEffectCoverage(
      ['gpuFluidSim', 'invert', 'rgbShift', 'plasma'],
      ['invert', 'rgb-shift'],
    );
    expect(summary.nativePublicEffectCount).toBe(2);
    expect(summary.missingPublicEffectTypes).toEqual(['gpuFluidSim', 'plasma']);
    expect(summary.sourceFramePassEligibleEffectCount).toBe(3);
    expect(summary.missingSourceFramePassEffectTypes).toEqual(['plasma']);
    expect(summary.deferredNativeGraphEffectTypes).toEqual(['gpuFluidSim']);
    expect(summary.nativeOnlyPassIds).toEqual([]);
    expect(summary.complete).toBe(false);
  });
});
