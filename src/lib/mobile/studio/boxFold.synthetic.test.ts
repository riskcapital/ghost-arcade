import { describe, expect, it } from 'vitest';
import { runRoom } from './boxScanHarness';
import { twoBoxRoom, type RenderOptions } from './syntheticRoom';
import type { AutoMapped } from './autoMapSurfaces';

/**
 * A box's front and top share one fold. After detection and edge snapping the
 * two outlines must still meet along it: each face's side on the fold lies on
 * the other's (in the projector's picture, where the slices are drawn), so no
 * gap or overlap opens up along the crease.
 */
type P = { x: number; y: number };

/** The widest gap between two outlines along their shared side, projector pixels; and that side's length. */
function seamGap(a: P[], b: P[]): { gap: number; length: number } {
  const lineDistance = (p: P, s0: P, s1: P) => Math.abs((s1.x - s0.x) * (s0.y - p.y) - (s0.x - p.x) * (s1.y - s0.y)) / (Math.hypot(s1.x - s0.x, s1.y - s0.y) || 1);
  let best = { gap: Infinity, length: 0 };
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    const a0 = a[i], a1 = a[(i + 1) % 4], b0 = b[j], b1 = b[(j + 1) % 4];
    const gap = Math.max(lineDistance(b0, a0, a1), lineDistance(b1, a0, a1), lineDistance(a0, b0, b1), lineDistance(a1, b0, b1));
    if (gap < best.gap) best = { gap, length: Math.min(Math.hypot(a1.x - a0.x, a1.y - a0.y), Math.hypot(b1.x - b0.x, b1.y - b0.y)) };
  }
  return best;
}

describe('box folds stay joined', () => {
  const renders: [string, RenderOptions][] = [
    ['clean', {}],
    ['dim and noisy', { exposure: 170, noise: 3, ambient: 0.1, seed: 9 }],
  ];
  // Not here: glare with a hand-held phone, where box A's front still merges with the floor before any
  // fold is found (the known stacked-room gap in boxScan.synthetic.test.ts).
  for (const [label, render] of renders) it(`keeps each box front and top meeting on one line after snapping to the photo (${label})`, () => {
    const room = twoBoxRoom();
    const { mapped, faces } = runRoom(room, { depth: false, render });
    const { width, height } = room.projector.lens;
    const pixels = (m: AutoMapped) => m.points.map(p => ({ x: p.x * width, y: p.y * height }));
    const surfaceOf = (id: string) => mapped[faces.find(f => f.id === id)!.surface];
    for (const box of ['A', 'B']) {
      const seam = seamGap(pixels(surfaceOf(`${box}-front`)), pixels(surfaceOf(`${box}-top`)));
      console.log(`${label} ${box}: seam gap ${seam.gap.toFixed(2)} px over ${seam.length.toFixed(0)} px`);
      expect(seam.length).toBeGreaterThan(50);
      expect(seam.gap).toBeLessThan(0.75);
    }
  }, 120_000);
});
