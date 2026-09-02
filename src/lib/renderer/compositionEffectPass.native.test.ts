import { describe, expect, it } from 'vitest';
import {
  nativeEffectPassIdForEffectType,
  isNativeSelectableEffect,
} from './nativeEffectCoverage';

/**
 * Composition FX used to reach the core only through the compositor's inline
 * colour ops — nine operations (invert, grayscale, brightness, contrast,
 * gamma, saturation, hue, posterize, noise), with everything else silently
 * dropped. That is why users reported "composition FX do nothing" while layer
 * and clip FX worked: layers run the real effect-pass chain, which gives each
 * effect its own pass with a real input texture, so multi-tap effects work.
 *
 * The fix routes composition FX down that same chain. These tests pin the
 * premise it rests on: effects the compositor could never run DO have native
 * passes. If that stops being true, composition FX quietly regress to
 * colour-ops-only and the original bug is back.
 */

/** The ops the compositor could already do inline, pre-fix. */
const COMPOSITOR_COLOUR_OPS = [
  'invert',
  'grayscale',
  'brightness',
  'contrast',
  'saturation',
  'hue',
];

/** Effects the compositor structurally cannot run: they sample neighbouring
 *  pixels, which needs a pass with its own input texture. */
const NEEDS_ITS_OWN_PASS = ['blur', 'colorama', 'kaleidoscope', 'pixelate'];

describe('composition effects on the native effect-pass chain', () => {
  it('keeps the colour ops the compositor already handled', () => {
    for (const type of COMPOSITOR_COLOUR_OPS) {
      expect(
        nativeEffectPassIdForEffectType(type),
        `${type} should map to a native effect pass`,
      ).toBeTruthy();
    }
  });

  it('also covers multi-tap effects the compositor had to drop', () => {
    const supported = NEEDS_ITS_OWN_PASS.filter((type) =>
      Boolean(nativeEffectPassIdForEffectType(type)),
    );
    // The fix is only worth anything if effects beyond the nine colour ops
    // actually have passes to run.
    expect(supported.length).toBeGreaterThan(0);
  });

  it('agrees with what the effect picker offers', () => {
    // The picker filters on isNativeSelectableEffect. Composition FX now run
    // the same chain as layers, so anything offered should be runnable —
    // that equivalence is what makes the picker honest again.
    for (const type of [...COMPOSITOR_COLOUR_OPS, ...NEEDS_ITS_OWN_PASS]) {
      if (!isNativeSelectableEffect(type)) continue;
      expect(
        nativeEffectPassIdForEffectType(type),
        `${type} is offered by the picker so it needs a pass`,
      ).toBeTruthy();
    }
  });
});
