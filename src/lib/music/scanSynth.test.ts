import { describe, expect, it } from 'vitest';
import { columnBands, scanBars, scanPosition } from './scanSynth';

/** A width x height RGBA picture, white where `lit` says so. */
function picture(width: number, height: number, lit: (x: number, y: number) => boolean): Uint8Array {
  const px = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = lit(x, y) ? 255 : 0;
      px.set([v, v, v, 255], (y * width + x) * 4);
    }
  }
  return px;
}

describe('scan synth', () => {
  it('sweeps once every few bars, slow to fast', () => {
    expect(scanBars(0)).toBe(16);
    expect(scanBars(1)).toBe(1);
    expect(scanPosition(0, 1)).toBe(0);
    expect(scanPosition(2, 1)).toBe(0.5);
    expect(scanPosition(4, 1)).toBe(0);
    expect(scanPosition(-1, 1)).toBe(0.75);
  });

  it('hears the picture down one column, bottom band first', () => {
    // Bright only in the bottom half of the left side.
    const px = picture(8, 8, (x, y) => x < 4 && y >= 4);
    const left = columnBands(px, 8, 8, 32, 0, 4);
    expect(left[0]).toBeCloseTo(1);
    expect(left[1]).toBeCloseTo(1);
    expect(left[2]).toBeCloseTo(0);
    expect(left[3]).toBeCloseTo(0);
    expect(columnBands(px, 8, 8, 32, 1, 4).every((b) => b === 0)).toBe(true);
  });
});
