import { describe, expect, it } from 'vitest';
// The desktop renderer's own list of blend ids and codes.
import desktopCompositor from '../../../../native-renderer/src/compositor.rs?raw';
import {
  BASIC_BLENDS, BLEND_CODE, BLEND_DESCRIPTIONS, BLEND_GLSL, BLEND_GROUPS, BLEND_MODES, basicBlendCode, blendCode, blendLabel,
  blendReference, compositeReference, isBlendMode, normalizeBlend, normalizeSurfaceMix, surfaceOpacity, swatchPixels,
  type BlendMode, type RGB,
} from './blendModes';
import { surfaceBounds, surfaceVertices } from './compositor';
import { newSurface, cornerPoints } from './model';
import { CROSSFADE_BLENDS } from './crossfade';

// Worked by hand from the desktop renderer's native_blend (an independent implementation, with
// Python's colorsys for the four HSV modes), not from the code under test.
const PAIR_A: { beneath: RGB; picture: RGB; expect: Record<BlendMode, number[]> } = {
  beneath: [0.2, 0.7, 0.5],
  picture: [0.6, 0.3, 0.9],
  expect: {
    normal: [0.6, 0.3, 0.9], add: [0.8, 1, 1], multiply: [0.12, 0.21, 0.45], screen: [0.68, 0.79, 0.95],
    overlay: [0.24, 0.58, 0.9], subtract: [0, 0.4, 0], difference: [0.4, 0.4, 0.4], lighten: [0.6, 0.7, 0.9],
    darken: [0.2, 0.3, 0.5], average: [0.4, 0.5, 0.7], hardlight: [0.36, 0.42, 0.9], softlight: [0.232, 0.616, 0.7],
    exclusion: [0.56, 0.58, 0.5], 'color-dodge': [0.5, 1, 1], 'color-burn': [0, 0, 0.444444], hue: [0.45, 0.2, 0.7],
    saturation: [0.233333, 0.7, 0.513333], color: [0.466667, 0.233333, 0.7], luminosity: [0.257143, 0.9, 0.642857],
    divide: [0.333333, 1, 0.555556], negation: [0.8, 1, 0.6], phoenix: [0.6, 0.6, 0.6], 'linear-light': [0.4, 0.3, 1],
    'hard-mix': [0, 0, 1], 'vivid-light': [0.25, 0.5, 1], 'pin-light': [0.2, 0.6, 0.8],
  },
};
// Black, white and a quarter: the divide-by-zero guards and the clamps.
const PAIR_B: typeof PAIR_A = {
  beneath: [0, 1, 0.5],
  picture: [1, 0, 0.25],
  expect: {
    normal: [1, 0, 0.25], add: [1, 1, 0.75], multiply: [0, 0, 0.125], screen: [1, 1, 0.625], overlay: [0, 1, 0.25],
    subtract: [0, 1, 0.25], difference: [1, 1, 0.25], lighten: [1, 1, 0.5], darken: [0, 0, 0.25], average: [0.5, 0.5, 0.375],
    hardlight: [1, 0, 0.25], softlight: [0, 1, 0.375], exclusion: [1, 1, 0.5], 'color-dodge': [0, 1, 0.666667],
    'color-burn': [0, 1, 0], hue: [1, 0, 0.25], saturation: [0, 1, 0.5], color: [1, 0, 0.25], luminosity: [0, 1, 0.5],
    divide: [0, 1, 1], negation: [1, 1, 0.75], phoenix: [0, 0, 0.75], 'linear-light': [1, 0, 0], 'hard-mix': [1, 0, 0],
    'vivid-light': [0, 1, 0], 'pin-light': [1, 0, 0.5],
  },
};
const close = (actual: RGB, expected: number[], digits = 5) => actual.forEach((v, i) => expect(v).toBeCloseTo(expected[i], digits));

describe('blend modes', () => {
  it('are the desktop renderer\'s ids and codes, every one', () => {
    const manifest = Object.fromEntries([...desktopCompositor.matchAll(/\{"id": "([a-z-]+)", "code": (\d+)\}/g)].map((m) => [m[1], Number(m[2])]));
    expect(manifest).toEqual(BLEND_CODE);
    expect([...BLEND_MODES].sort()).toEqual(Object.keys(BLEND_CODE).sort());
    expect(BLEND_MODES).toHaveLength(26);
  });

  it('keep the five of app 1.1 in the small shader, drawn exactly as before', () => {
    expect(BASIC_BLENDS).toEqual(['normal', 'add', 'screen', 'multiply', 'difference']);
    const basic = BLEND_GLSL.split('#else')[1];
    const handled = new Set([...basic.matchAll(/mode==(\d+)/g)].map((m) => Number(m[1])));
    expect(handled).toEqual(new Set(BASIC_BLENDS.filter((m) => m !== 'normal').map((m) => BLEND_CODE[m])));
    for (const mode of BLEND_MODES) expect(basicBlendCode(BLEND_CODE[mode])).toBe(BASIC_BLENDS.includes(mode));
    expect(basicBlendCode(-1)).toBe(true);
    expect(basicBlendCode(-2)).toBe(true);
  });

  it('the full shader handles every code', () => {
    const full = BLEND_GLSL.split('#else')[0];
    const handled = new Set([...full.matchAll(/mode==(\d+)/g)].map((m) => Number(m[1])));
    for (const mode of BLEND_MODES) if (mode !== 'normal') expect(handled.has(BLEND_CODE[mode]), mode).toBe(true);
  });

  for (const [name, pair] of [['mid tones', PAIR_A], ['black and white', PAIR_B]] as const)
    it(`match the desktop formula on ${name}`, () => {
      for (const mode of BLEND_MODES) close(blendReference(mode, pair.beneath, pair.picture), pair.expect[mode]);
    });

  it('mix in by coverage: picture alpha times opacity', () => {
    const { beneath, picture } = PAIR_A;
    close(compositeReference('multiply', beneath, picture, 0), [...beneath]);
    close(compositeReference('multiply', beneath, picture, 1), PAIR_A.expect.multiply);
    close(compositeReference('multiply', beneath, picture, 0.5), [0.16, 0.455, 0.475]);
    close(compositeReference('normal', beneath, picture, 0.25), [0.3, 0.6, 0.6]);
    close(compositeReference('screen', beneath, picture, 2), PAIR_A.expect.screen);
  });

  it('include the crossfade\'s blends under the same ids', () => {
    for (const mode of CROSSFADE_BLENDS) expect(isBlendMode(mode), mode).toBe(true);
  });

  it('read saved values safely', () => {
    expect(isBlendMode('pin-light')).toBe(true);
    expect(isBlendMode('toString')).toBe(false);
    expect(isBlendMode('Overlay')).toBe(false);
    expect(normalizeBlend('glow')).toBe('normal');
    expect(normalizeBlend(undefined)).toBe('normal');
    expect(blendCode('screen')).toBe(3);
    expect(blendCode(42)).toBe(0);
  });

  it('are on six shelves, each mode once, with menu text and a plain line', () => {
    expect(BLEND_GROUPS.map((g) => g.label)).toEqual(['Normal', 'Darken', 'Lighten', 'Contrast', 'Difference', 'Color']);
    const shelved = BLEND_GROUPS.flatMap((g) => g.modes);
    expect([...shelved].sort()).toEqual([...BLEND_MODES].sort());
    expect(new Set(shelved).size).toBe(shelved.length);
    for (const mode of BLEND_MODES) {
      expect(BLEND_DESCRIPTIONS[mode].length, mode).toBeGreaterThan(20);
      expect(BLEND_DESCRIPTIONS[mode].length, mode).toBeLessThanOrEqual(70);
    }
    expect(blendLabel('color-dodge')).toBe('Color dodge');
    expect(blendLabel('hardlight')).toBe('Hard light');
    expect(blendLabel('softlight')).toBe('Soft light');
    expect(blendLabel('pin-light')).toBe('Pin light');
    expect(blendLabel('normal')).toBe('Normal');
  });

  it('draw a different swatch for every mode', () => {
    const seen = new Map<string, BlendMode>();
    for (const mode of BLEND_MODES) {
      const pixels = swatchPixels(mode, 28, 18);
      expect(pixels).toHaveLength(28 * 18 * 4);
      for (let i = 3; i < pixels.length; i += 4) expect(pixels[i]).toBe(255);
      const key = Array.from(pixels).join(',');
      expect(seen.get(key), `${mode} looks like ${seen.get(key)}`).toBeUndefined();
      seen.set(key, mode);
    }
  });
});

describe('surface opacity and blend as saved', () => {
  it('are left out at full and Normal, so an untouched surface saves as before', () => {
    expect(normalizeSurfaceMix({})).toEqual({});
    expect(normalizeSurfaceMix({ opacity: 1, blend: 'normal' })).toEqual({});
    expect(normalizeSurfaceMix({ opacity: 3 })).toEqual({});
    expect(normalizeSurfaceMix({ opacity: NaN, blend: 'glow' })).toEqual({});
    expect(normalizeSurfaceMix({ opacity: '0.5', blend: 7 })).toEqual({});
    expect(normalizeSurfaceMix({ opacity: -2 })).toEqual({ opacity: 0 });
    expect(normalizeSurfaceMix({ opacity: 0.4, blend: 'screen' })).toEqual({ opacity: 0.4, blend: 'screen' });
  });
  it('play at full when absent or damaged', () => {
    expect(surfaceOpacity({})).toBe(1);
    expect(surfaceOpacity({ opacity: NaN })).toBe(1);
    expect(surfaceOpacity({ opacity: 0.25 })).toBe(0.25);
    expect(surfaceOpacity({ opacity: 5 })).toBe(1);
  });
});

describe('the part of the output a surface blend reads', () => {
  it('is the warp\'s box in pixels, bottom-left origin, one pixel wider', () => {
    const s = { ...newSurface(0), points: cornerPoints({ x: 0.25, y: 0.1 }, { x: 0.75, y: 0.1 }, { x: 0.75, y: 0.5 }, { x: 0.25, y: 0.5 }) };
    // 1280 x 720: x 320..960, y from the top 72..360, so from the bottom 360..648.
    expect(surfaceBounds(surfaceVertices(s), 1280, 720)).toEqual([319, 359, 642, 290]);
  });
  it('stays inside the frame and is nothing when the surface is off it', () => {
    const wide = { ...newSurface(0), points: cornerPoints({ x: -0.5, y: -0.5 }, { x: 1.5, y: -0.5 }, { x: 1.5, y: 1.5 }, { x: -0.5, y: 1.5 }) };
    expect(surfaceBounds(surfaceVertices(wide), 640, 360)).toEqual([0, 0, 640, 360]);
    const off = new Float32Array([1.2, 0.1, 0, 0, 1.4, 0.1, 1, 0, 1.3, 0.4, 1, 1]);
    expect(surfaceBounds(off, 640, 360)).toBeNull();
  });
});
