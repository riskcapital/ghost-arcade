import { describe, it, expect } from 'vitest';
import { drawStripeFrame } from './screenPatterns';
import { stripeFrameCode } from '../mobile/studio/structuredLightCodes';

/** A canvas stand-in that records which pixels end up white. */
function paint(width: number, height: number, number: number) {
  const lit = new Uint8Array(width * height);
  let colour = 0;
  const ctx = {
    set fillStyle(v: string) { colour = v === '#fff' ? 1 : 0; },
    fillRect(x: number, y: number, w: number, h: number) {
      for (let j = Math.max(0, y); j < Math.min(height, y + h); j++) for (let i = Math.max(0, x); i < Math.min(width, x + w); i++) lit[j * width + i] = colour;
    },
  } as unknown as CanvasRenderingContext2D;
  drawStripeFrame(ctx, width, height, number);
  return (x: number, y: number) => lit[y * width + x];
}

describe('auto-map stripe frames on a Screen', () => {
  it('draws white and black', () => {
    expect(paint(64, 32, stripeFrameCode({ kind: 'white' }))(10, 10)).toBe(1);
    expect(paint(64, 32, stripeFrameCode({ kind: 'black' }))(10, 10)).toBe(0);
  });

  it('lets every column be read back from its bit planes, from the top left', () => {
    const width = 256, height = 64, cell = 8, cells = width / cell, bits = Math.log2(cells);
    const planes = Array.from({ length: bits }, (_, bit) => paint(width, height, stripeFrameCode({ kind: 'bit', axis: 'x', bit, inverted: false }, cell)));
    for (const x of [0, 7, 8, 100, 255]) {
      let gray = 0;
      for (const plane of planes) gray = (gray << 1) | plane(x, 5);
      let value = 0;
      for (let g = gray; g; g >>= 1) value ^= g;
      expect(value).toBe(Math.floor(x / cell));
    }
  });

  it('inverts a plane, runs rows down the Screen, and widens stripes on request', () => {
    const plain = paint(128, 128, stripeFrameCode({ kind: 'bit', axis: 'y', bit: 0, inverted: false }, 8));
    const inverted = paint(128, 128, stripeFrameCode({ kind: 'bit', axis: 'y', bit: 0, inverted: true }, 8));
    expect([plain(3, 0), plain(3, 127)]).toEqual([0, 1]);
    expect([inverted(3, 0), inverted(3, 127)]).toEqual([1, 0]);
    // The same row everywhere along a line.
    expect(plain(0, 100)).toBe(plain(127, 100));
    const wide = paint(128, 32, stripeFrameCode({ kind: 'bit', axis: 'x', bit: 1, inverted: false }, 32));
    expect([0, 31, 32, 95, 96].map((x) => wide(x, 0))).toEqual([0, 0, 1, 1, 0]);
  });
});
