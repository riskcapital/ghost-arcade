import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GPU_SOURCE_SIZE,
  getDefaultGpuSourceImage,
  renderDefaultGpuSourceImage,
} from './defaultSourceImage';

describe('bench test picture', () => {
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
