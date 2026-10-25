import { describe, expect, it } from 'vitest';
import { blendShaders, textureFragmentShader, warpVertexShader, withLayerRect } from './shaders';

// The engine draws a plain normal-blend layer straight into the composite
// (drawLayerDirect) instead of rendering it into its own image and blending
// that in. These tests pin the arithmetic both ways land on.

type RGBA = [number, number, number, number];

/** three.js NormalBlending (non-premultiplied) of src over dst. */
function normalBlend(src: RGBA, dst: RGBA): RGBA {
  const a = src[3];
  return [
    src[0] * a + dst[0] * (1 - a),
    src[1] * a + dst[1] * (1 - a),
    src[2] * a + dst[2] * (1 - a),
    a + dst[3] * (1 - a),
  ];
}

type Mode = 'normal' | 'multiply' | 'screen';

/** The blend shaders' per-channel math (shaders.ts blendShaders). */
const blendOf: Record<Mode, (base: number, layer: number) => number> = {
  normal: (_base, layer) => layer,
  multiply: (base, layer) => base * layer,
  screen: (base, layer) => 1 - (1 - base) * (1 - layer),
};

/** The old path: layer image, then the blend pass. */
function imagePath(color: RGBA, outA: number, opacity: number, base: RGBA | null, clear: RGBA, mode: Mode = 'normal'): RGBA {
  // The layer renders with normal blending into an image cleared to (0,0,0,0).
  const image = normalBlend([color[0], color[1], color[2], outA], [0, 0, 0, 0]);
  // The blend pass reads the previous composite (or transparent black for
  // the first layer) and mixes the blended image in by image.a * opacity...
  const b = base ?? [0, 0, 0, 0];
  const a = image[3] * opacity;
  const mixed = (c: number) => b[c] + (blendOf[mode](b[c], image[c]) - b[c]) * a;
  const shaded: RGBA = [mixed(0), mixed(1), mixed(2), Math.max(b[3], a)];
  // ...and its output is blended again over the target, which autoClear
  // has just cleared to the renderer's clear colour.
  return normalBlend(shaded, clear);
}

/** The direct path: the layer shader's uDirectOpacity output for the mode,
 *  with the engine's blend factors and a MAX alpha equation. */
function directPath(color: RGBA, outA: number, opacity: number, base: RGBA | null, clear: RGBA, mode: Mode = 'normal'): RGBA {
  const dst = base ?? clear; // the first layer clears to the clear colour
  const a = outA * opacity;
  const layer = (c: number) => color[c] * outA;
  const channel = (c: number) => {
    if (mode === 'multiply') return dst[c] * (1 - a + a * layer(c)); // ZERO, SRC_COLOR
    if (mode === 'screen') return a * layer(c) * (1 - dst[c]) + dst[c]; // ONE_MINUS_DST_COLOR, ONE
    const first = base ? 1 : a;
    const src = layer(c) * a * first;
    return src + dst[c] * (1 - a); // ONE, ONE_MINUS_SRC_ALPHA
  };
  return [channel(0), channel(1), channel(2), Math.max(dst[3], a)];
}

const OPAQUE_BLACK: RGBA = [0, 0, 0, 1];
const close = (x: RGBA, y: RGBA) => x.forEach((v, i) => expect(v).toBeCloseTo(y[i], 6));

describe('direct layer composite', () => {
  const colors: RGBA[] = [[1, 0.2, 0.1, 1], [0.3, 0.7, 0.9, 1], [0.5, 0.5, 0.5, 1]];
  const alphas = [1, 0.75, 0.3, 0];
  const opacities = [1, 0.6, 0.15];

  it('matches the image path for the first layer over the opaque clear', () => {
    for (const color of colors) for (const outA of alphas) for (const opacity of opacities) {
      close(directPath(color, outA, opacity, null, OPAQUE_BLACK), imagePath(color, outA, opacity, null, OPAQUE_BLACK));
    }
  });

  it('matches the image path for later layers over an earlier composite', () => {
    // After the first pass over an opaque clear, the composite is opaque.
    const bases: RGBA[] = [[0, 0, 0, 1], [0.2, 0.4, 0.6, 1], [0.9, 0.1, 0.3, 1]];
    for (const base of bases) for (const color of colors) for (const outA of alphas) for (const opacity of opacities) {
      close(directPath(color, outA, opacity, base, OPAQUE_BLACK), imagePath(color, outA, opacity, base, OPAQUE_BLACK));
    }
  });

  it('matches the multiply and screen passes for later layers', () => {
    const bases: RGBA[] = [[0, 0, 0, 1], [0.2, 0.4, 0.6, 1], [0.9, 0.1, 0.3, 1], [1, 1, 1, 1]];
    for (const mode of ['multiply', 'screen'] as const) {
      for (const base of bases) for (const color of colors) for (const outA of alphas) for (const opacity of opacities) {
        close(directPath(color, outA, opacity, base, OPAQUE_BLACK, mode), imagePath(color, outA, opacity, base, OPAQUE_BLACK, mode));
      }
    }
  });

  it('does not match a first-layer screen, which keeps the image path', () => {
    const direct = directPath([1, 0.5, 0.2, 1], 1, 0.6, null, OPAQUE_BLACK, 'screen');
    const image = imagePath([1, 0.5, 0.2, 1], 1, 0.6, null, OPAQUE_BLACK, 'screen');
    expect(Math.abs(direct[0] - image[0])).toBeGreaterThan(0.05);
  });

  it('does not match over a transparent clear, which is why groups keep the image path', () => {
    const transparent: RGBA = [0, 0, 0, 0];
    const base: RGBA = [0.4, 0.4, 0.4, 0.5];
    const direct = directPath([1, 0, 0, 1], 1, 0.6, base, transparent);
    const image = imagePath([1, 0, 0, 1], 1, 0.6, base, transparent);
    expect(Math.abs(direct[0] - image[0])).toBeGreaterThan(0.05);
  });

  it('wires the shaders for both paths', () => {
    expect(textureFragmentShader).toContain('uniform float uDirectOpacity;');
    expect(textureFragmentShader).toContain('uniform float uDirectFirst;');
    expect(textureFragmentShader).toContain('uniform int uDirectMode;');
    expect(warpVertexShader).toContain('clipPos * uClipXform.xy + uClipXform.zw');
  });
});

describe('bounds-sized layer images in the blend shaders', () => {
  it('reads the layer through uLayerXform in every blend mode', () => {
    for (const [mode, source] of Object.entries(blendShaders)) {
      const wrapped = withLayerRect(source);
      expect(wrapped, mode).toContain('uniform vec4 uLayerXform;');
      expect(wrapped, mode).toContain('sampleBlendLayer(vUv)');
      expect(wrapped, mode).not.toContain('texture2D(uLayer, vUv)');
    }
  });

  it('leaves a shader without a layer input alone', () => {
    const plain = 'void main() { gl_FragColor = vec4(1.0); }';
    expect(withLayerRect(plain)).toBe(plain);
  });
});
