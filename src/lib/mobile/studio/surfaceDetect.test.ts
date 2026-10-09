import { describe, expect, it } from 'vitest';
import { detectSurfaces } from './surfaceDetect';
import { planPatterns, applyHomography, invertHomography } from './structuredLight';

/**
 * A pretend scan of two flat faces meeting at a fold, as the stripe decoder
 * would report it: projector positions rounded to cell centres, with a band
 * of unreadable pixels along the fold and a gap around the outside.
 */
const W = 400, H = 300, CELL = 32;
const plan = planPatterns(1920, 1080, CELL);
// Left face and right face: two planes seen by one camera and one projector
// differ by a transform that leaves their shared edge (here x = 200) in
// place, so the right face is the left one times such a transform.
const left = [3.2, 0.4, 200, 0.1, 3.0, 90, 0.0004, 0, 1];
const bend = (() => {
  const e = [0.35, 0.1, 0.0005], l = [1, 0, -200];
  const m = [1, 0, 0, 0, 1, 0, 0, 0, 1].map((v, i) => v + e[Math.floor(i / 3)] * l[i % 3]);
  return invertHomography(m);
})();
const right = (() => { const o = new Array(9).fill(0); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) o[i * 3 + j] += left[i * 3 + k] * bend[k * 3 + j]; return o; })();

function scan() {
  const valid = new Uint8Array(W * H), projX = new Float32Array(W * H), projY = new Float32Array(W * H);
  for (let y = 40; y < 260; y++) for (let x = 60; x < 340; x++) {
    if (Math.abs(x - 200) < 3) continue;
    const p = applyHomography(x < 200 ? left : right, x + 0.5, y + 0.5);
    if (p.x < 0 || p.x >= 1920 || p.y < 0 || p.y >= 1080) continue;
    const i = y * W + x;
    valid[i] = 1;
    projX[i] = (Math.floor(p.x / CELL) + 0.5) * CELL;
    projY[i] = (Math.floor(p.y / CELL) + 0.5) * CELL;
  }
  return { width: W, height: H, valid, projX, projY, coverage: 0 };
}

describe('automatic surface detection', () => {
  it('finds two faces that meet at a fold and boxes each one', () => {
    const found = detectSurfaces({ plan, decoded: scan(), width: 1920, height: 1080 });
    // The two faces are the two largest finds.
    expect(found.length).toBeGreaterThanOrEqual(2);
    const byLeft = found.slice(0, 2).sort((a, b) => a.outline[0].x - b.outline[0].x);
    const px = (s: typeof found[number]) => s.outline.map(p => [p.x * W, p.y * H]);
    const [a, b] = byLeft.map(px);
    // Left face spans x 60..200, right face 200..340, both y 40..260, within a few pixels.
    // Stripe cells here are about ten camera pixels wide, so a cell is the honest limit without a photo to snap to.
    const close = (got: number, want: number) => expect(Math.abs(got - want)).toBeLessThan(20);
    close(Math.min(...a.map(p => p[0])), 60); close(Math.max(...a.map(p => p[0])), 200);
    close(Math.min(...b.map(p => p[0])), 200); close(Math.max(...b.map(p => p[0])), 340);
    for (const quad of [a, b]) { close(Math.min(...quad.map(p => p[1])), 40); close(Math.max(...quad.map(p => p[1])), 260); }
    for (const s of found.slice(0, 2)) { expect(s.rmsPx).toBeLessThan(CELL); expect(s.solid).toBeGreaterThan(0.8); }
    // Corners carried into the projector picture agree with the plane they sit on.
    byLeft[0].outline.forEach((p, i) => {
      const want = applyHomography(left, p.x * W, p.y * H);
      expect(Math.abs(byLeft[0].points[i].x * 1920 - want.x)).toBeLessThan(CELL);
      expect(Math.abs(byLeft[0].points[i].y * 1080 - want.y)).toBeLessThan(CELL);
    });
  });
  it('returns nothing when the scan saw nothing', () => {
    const empty = { width: W, height: H, valid: new Uint8Array(W * H), projX: new Float32Array(W * H), projY: new Float32Array(W * H), coverage: 0 };
    expect(detectSurfaces({ plan, decoded: empty, width: 1920, height: 1080 })).toEqual([]);
  });
});
