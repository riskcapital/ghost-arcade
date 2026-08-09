import { describe, expect, it } from 'vitest';
import {
  buildWLEDBasePoints,
  fillWLEDTestPattern,
  resolveWLEDMapping,
  resolveWLEDSourceRegion,
  sampleWLEDPixels,
  sanitizeWLEDCount,
} from './mapping';

describe('WLED physical mapping', () => {
  it('sanitizes controller pixel counts to the DRGB transport limit', () => {
    expect(sanitizeWLEDCount(0)).toBe(1);
    expect(sanitizeWLEDCount(900)).toBe(490);
    expect(sanitizeWLEDCount(24.9)).toBe(24);
  });

  it('lays out a horizontal strip from edge to edge', () => {
    expect(buildWLEDBasePoints(3, { mode: 'strip', axis: 'horizontal' })).toEqual([
      { x: 0, y: 0.5 },
      { x: 0.5, y: 0.5 },
      { x: 1, y: 0.5 },
    ]);
  });

  it('follows physical serpentine order through a matrix', () => {
    expect(buildWLEDBasePoints(6, {
      mode: 'matrix',
      axis: 'horizontal',
      columns: 3,
      serpentine: true,
    })).toEqual([
      { x: 1 / 6, y: 0.25 },
      { x: 0.5, y: 0.25 },
      { x: 5 / 6, y: 0.25 },
      { x: 5 / 6, y: 0.75 },
      { x: 0.5, y: 0.75 },
      { x: 1 / 6, y: 0.75 },
    ]);
  });

  it('maps custom points into a cropped source region in LED order', () => {
    const resolved = resolveWLEDMapping(3, {
      mode: 'custom',
      points: [
        { x: 0, y: 0 },
        { x: 0.5, y: 0.5 },
        { x: 1, y: 1 },
      ],
      sourceRegion: { x: 0.25, y: 0.2, width: 0.5, height: 0.4 },
      reverse: true,
    });
    expect(resolved.points).toEqual([
      { x: 0.75, y: 0.6000000000000001 },
      { x: 0.5, y: 0.4 },
      { x: 0.25, y: 0.2 },
    ]);
  });

  it('keeps source regions inside normalized bounds', () => {
    const region = resolveWLEDSourceRegion({ x: 1, y: 2, width: 1, height: 1 });
    expect(region.x).toBe(0.99);
    expect(region.y).toBe(0.99);
    expect(region.width).toBeCloseTo(0.01);
    expect(region.height).toBeCloseTo(0.01);
    expect(region.x + region.width).toBeLessThanOrEqual(1);
    expect(region.y + region.height).toBeLessThanOrEqual(1);
  });
});

describe('WLED pixel sampling', () => {
  it('samples exact RGBA locations into packed RGB output', () => {
    const rgba = new Uint8ClampedArray([
      255, 0, 0, 255, 0, 255, 0, 255,
      0, 0, 255, 255, 255, 255, 255, 255,
    ]);
    const output = new Uint8Array(12);
    sampleWLEDPixels(rgba, 2, 2, [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ], 0, output);
    expect(Array.from(output)).toEqual([
      255, 0, 0,
      0, 255, 0,
      0, 0, 255,
      255, 255, 255,
    ]);
  });

  it('spatially averages a configurable area around each LED point', () => {
    const rgba = new Uint8ClampedArray(8 * 8 * 4);
    for (let pixel = 0; pixel < 64; pixel += 1) rgba[pixel * 4 + 3] = 255;
    const centerOffset = (4 * 8 + 4) * 4;
    rgba[centerOffset] = 255;
    const output = new Uint8Array(3);
    sampleWLEDPixels(rgba, 8, 8, [{ x: 0.5, y: 0.5 }], 0.12, output);
    // Spatial reduction happens in linear light, then returns to sRGB.
    expect(Array.from(output)).toEqual([94, 0, 0]);
  });

  it('applies color calibration, brightness, and temporal smoothing', () => {
    const rgba = new Uint8ClampedArray([100, 50, 0, 255]);
    const output = new Uint8Array(3);
    const previous = new Uint8Array([200, 200, 200]);
    sampleWLEDPixels(rgba, 1, 1, [{ x: 0.5, y: 0.5 }], 0, output, {
      brightness: 0.5,
      gamma: 1,
      calibration: {
        redGain: 2,
        greenGain: 1,
        blueGain: 1,
        saturation: 1,
        smoothing: 0.5,
      },
    }, previous);
    expect(Array.from(output)).toEqual([150, 117, 100]);
  });

  it('generates visible order and chase setup patterns', () => {
    const rainbow = new Uint8Array(12);
    fillWLEDTestPattern('rainbow', '#ffffff', 0, rainbow);
    expect(Array.from(rainbow.slice(0, 3))).toEqual([255, 0, 0]);
    expect(new Set(Array.from(rainbow))).not.toEqual(new Set([0]));

    const chase = new Uint8Array(12);
    fillWLEDTestPattern('chase', '#ff4000', 160, chase);
    expect(Array.from(chase)).toEqual([
      0, 0, 0,
      0, 0, 0,
      255, 64, 0,
      0, 0, 0,
    ]);
  });
});
