import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GPU_SOURCE_ID,
  DEFAULT_GPU_SOURCE_SIZE,
  getDefaultGpuSourceImage,
  gpuLayerNeedsDefaultSource,
  gpuShaderUsesDefaultSource,
  gpuSourceParamIsBound,
  renderDefaultGpuSourceImage,
} from './defaultSourceImage';

describe('built-in demo source eligibility', () => {
  it('covers exactly the image-driven shaders', () => {
    expect(gpuShaderUsesDefaultSource('pixel-particles')).toBe(true);
    expect(gpuShaderUsesDefaultSource('flythrough')).toBe(true);
    expect(gpuShaderUsesDefaultSource('particle-field', { mode: 'media' })).toBe(true);
    // `gravity-wells` is the legacy alias the native route normalises to
    // particle-field; it has to answer the same way.
    expect(gpuShaderUsesDefaultSource('gravity-wells', { mode: 'media' })).toBe(true);

    // Procedural particle-field modes never wanted pixels.
    expect(gpuShaderUsesDefaultSource('particle-field', { mode: 'galaxy' })).toBe(false);
    expect(gpuShaderUsesDefaultSource('particle-field')).toBe(false);
    // Point Cloud FX takes .ply/.splat geometry — an image is meaningless.
    expect(gpuShaderUsesDefaultSource('point-cloud-fx')).toBe(false);
    expect(gpuShaderUsesDefaultSource('planet')).toBe(false);
    expect(gpuShaderUsesDefaultSource(null)).toBe(false);
  });

  it('treats only a genuinely empty picker as unbound', () => {
    expect(gpuSourceParamIsBound(null)).toBe(false);
    expect(gpuSourceParamIsBound(undefined)).toBe(false);
    expect(gpuSourceParamIsBound({})).toBe(false);
    expect(gpuSourceParamIsBound({ type: 'media' })).toBe(false);
    expect(gpuSourceParamIsBound({ type: 'media', mediaId: '' })).toBe(false);
    expect(gpuSourceParamIsBound({ type: 'file' })).toBe(false);

    expect(gpuSourceParamIsBound({ type: 'media', mediaId: 'm1' })).toBe(true);
    expect(gpuSourceParamIsBound({ type: 'layer', layerId: 'l1' })).toBe(true);
    expect(gpuSourceParamIsBound({ type: 'file', url: 'blob:x' })).toBe(true);
    expect(gpuSourceParamIsBound({ type: 'camera', deviceId: '' })).toBe(true);
    expect(gpuSourceParamIsBound({ type: 'spout', senderName: 'Resolume' })).toBe(true);
  });

  it('engages with no source and disengages once one is bound', () => {
    expect(gpuLayerNeedsDefaultSource('pixel-particles', {})).toBe(true);
    expect(gpuLayerNeedsDefaultSource('pixel-particles', { source: null })).toBe(true);
    expect(gpuLayerNeedsDefaultSource('pixel-particles', { source: { type: 'media', mediaId: 'm1' } })).toBe(false);
    // Clearing it again re-engages the fallback rather than going black.
    expect(gpuLayerNeedsDefaultSource('pixel-particles', { source: null })).toBe(true);
    // Never engages for a shader that does not consume pixels.
    expect(gpuLayerNeedsDefaultSource('point-cloud-fx', { source: null })).toBe(false);
  });
});

describe('built-in demo source image', () => {
  it('has a stable source-frame id', () => {
    expect(DEFAULT_GPU_SOURCE_ID).toBe('ghost:builtin-demo-source');
  });

  it('renders a fully opaque square with the structure the depth modes need', () => {
    // Small size keeps the test fast; the shading is resolution-independent.
    const image = renderDefaultGpuSourceImage(128);
    expect(image.width).toBe(128);
    expect(image.height).toBe(128);
    expect(image.rgba.length).toBe(128 * 128 * 4);

    const total = image.width * image.height;
    let minLuma = 1;
    let maxLuma = 0;
    let sum = 0;
    let sumSq = 0;
    let opaque = 0;
    let saturated = 0;
    for (let i = 0; i < total; i += 1) {
      const r = image.rgba[i * 4] / 255;
      const g = image.rgba[i * 4 + 1] / 255;
      const b = image.rgba[i * 4 + 2] / 255;
      if (image.rgba[i * 4 + 3] === 255) opaque += 1;
      const luma = 0.299 * r + 0.587 * g + 0.114 * b;
      minLuma = Math.min(minLuma, luma);
      maxLuma = Math.max(maxLuma, luma);
      sum += luma;
      sumSq += luma * luma;
      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      if (mx > 0 && (mx - mn) / mx > 0.35) saturated += 1;
    }
    const mean = sum / total;
    const std = Math.sqrt(Math.max(0, sumSq / total - mean * mean));

    expect(opaque).toBe(total);
    // Nothing is pure black: a point cloud built from this has a body
    // everywhere, not holes.
    expect(minLuma).toBeGreaterThan(0.01);
    // Wide luminance range + real variance is what depth-from-luma eats.
    expect(maxLuma).toBeGreaterThan(0.85);
    expect(std).toBeGreaterThan(0.12);
    // Mostly saturated colour, so the saturation depth mode has signal too.
    expect(saturated / total).toBeGreaterThan(0.5);
  });

  it('is deterministic and memoised at the shipping size', () => {
    const a = renderDefaultGpuSourceImage(64);
    const b = renderDefaultGpuSourceImage(64);
    expect(Array.from(a.rgba)).toEqual(Array.from(b.rgba));

    const cached = getDefaultGpuSourceImage();
    expect(getDefaultGpuSourceImage()).toBe(cached);
    expect(cached.width).toBe(DEFAULT_GPU_SOURCE_SIZE);
    expect(cached.height).toBe(DEFAULT_GPU_SOURCE_SIZE);
  });
});
