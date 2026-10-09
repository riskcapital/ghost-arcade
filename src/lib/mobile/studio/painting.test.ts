import { describe, expect, it } from 'vitest';
import { findPainting, paintingSize, rectifyPainting, clockwiseFromTopLeft } from './painting';
import { applyHomography, invertHomography } from './structuredLight';

const W = 480, H = 360;
/** A wall with a slightly skewed painting on it, as luma. */
function scene(corners: [number, number][], wall = 150, lightPainting = false) {
  const luma = new Float32Array(W * H);
  let seed = 7;
  const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const inside = (x: number, y: number) => corners.every((a, i) => { const b = corners[(i + 1) % 4]; return (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]) >= 0; });
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    luma[y * W + x] = inside(x, y)
      ? (lightPainting ? 190 : 60) + 55 * Math.sin(x * 0.21) * Math.cos(y * 0.17) + random() * 12
      : wall + (random() - 0.5) * 5;
  }
  return { width: W, height: H, luma };
}
const truth: [number, number][] = [[150, 90], [340, 100], [330, 260], [140, 250]];

describe('finding a painting on a wall', () => {
  it('boxes the painting to within a few pixels, corners clockwise from top left', () => {
    const found = findPainting(scene(truth))!;
    expect(found).toHaveLength(4);
    found.forEach((p, i) => {
      expect(Math.abs(p.x * W - truth[i][0])).toBeLessThan(8);
      expect(Math.abs(p.y * H - truth[i][1])).toBeLessThan(8);
    });
  });
  it('finds a painting lighter than its wall too', () => {
    const found = findPainting(scene(truth, 90, true))!;
    found.forEach((p, i) => { expect(Math.abs(p.x * W - truth[i][0])).toBeLessThan(10); expect(Math.abs(p.y * H - truth[i][1])).toBeLessThan(10); });
  });
  it('only looks where the projector reaches', () => {
    // A second, larger busy patch sits outside the lit area and must be ignored.
    const s = scene(truth);
    for (let y = 280; y < 350; y++) for (let x = 10; x < 470; x++) s.luma[y * W + x] = 30 + 100 * ((x + y) % 2);
    const lit = new Uint8Array(W * H);
    for (let y = 40; y < 275; y++) for (let x = 60; x < 420; x++) lit[y * W + x] = 1;
    const found = findPainting(s, lit)!;
    expect(Math.max(...found.map(p => p.y * H))).toBeLessThan(272);
  });
  it('says so when the wall is bare', () => {
    expect(findPainting({ width: W, height: H, luma: new Float32Array(W * H).fill(140) })).toBeNull();
  });
});

describe('cutting the painting out', () => {
  it('orders any four corners clockwise from the top left', () => {
    const shuffled = [{ x: 9, y: 9 }, { x: 1, y: 1 }, { x: 1, y: 9 }, { x: 9, y: 1 }];
    expect(clockwiseFromTopLeft(shuffled)).toEqual([{ x: 1, y: 1 }, { x: 9, y: 1 }, { x: 9, y: 9 }, { x: 1, y: 9 }]);
  });
  it('sizes the picture from the painting on the projector', () => {
    expect(paintingSize([{ x: 0, y: 0 }, { x: 800, y: 0 }, { x: 800, y: 400 }, { x: 0, y: 400 }], 1600)).toEqual({ width: 1600, height: 800 });
  });
  it('puts every point of the painting where the desktop will draw it, not just the corners', () => {
    // A photo in which each pixel's colour encodes its own position.
    const photo = { width: 200, height: 150, data: new Uint8ClampedArray(200 * 150 * 4) };
    for (let y = 0; y < 150; y++) for (let x = 0; x < 200; x++) { const i = (y * 200 + x) * 4; photo.data[i] = x; photo.data[i + 1] = y; photo.data[i + 3] = 255; }
    // A keystoned projector: the photo-to-projector map is a real perspective one.
    const toProjector = [4.1, 0.6, 120, -0.3, 4.4, 60, 0.0009, 0.0004, 1];
    const cornersInPhoto = [[40, 30], [160, 34], [156, 120], [44, 116]];
    const quad = cornersInPhoto.map(([x, y]) => applyHomography(toProjector, x, y));
    const size = { width: 120, height: 90 };
    const cut = rectifyPainting(photo, toProjector, quad, size);
    const toPhoto = invertHomography(toProjector);
    let worst = 0;
    for (const [u, v] of [[0.5, 0.5], [0.2, 0.8], [0.85, 0.3], [0.1, 0.1], [0.95, 0.95]]) {
      // Where the desktop draws texture point (u, v): bilinear between the pinned corners.
      const px = (1 - v) * ((1 - u) * quad[0].x + u * quad[1].x) + v * ((1 - u) * quad[3].x + u * quad[2].x);
      const py = (1 - v) * ((1 - u) * quad[0].y + u * quad[1].y) + v * ((1 - u) * quad[3].y + u * quad[2].y);
      const want = applyHomography(toPhoto, px, py);            // what the photo shows at that spot on the wall
      const o = (Math.floor(v * size.height) * size.width + Math.floor(u * size.width)) * 4;
      worst = Math.max(worst, Math.abs(cut[o] - want.x), Math.abs(cut[o + 1] - want.y));
    }
    expect(worst).toBeLessThan(2.5);
  });
});
