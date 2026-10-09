import { describe, expect, it } from 'vitest';
import { runAutoMap, mapSurface, type AutoMapLink, type AutoMapCamera } from './autoMap';
import { planPatterns, patternValue, applyHomography, type PatternFrame } from './structuredLight';
import { stripeFrameCode, STRIPE_CELL, STRIPE_CELLS } from './structuredLightCodes';

/**
 * A whole auto-map run against a pretend desktop and camera: two projectors
 * overlapping on a wall, shown one at a time, seen by one fixed camera.
 */
const CAM_W = 480, CAM_H = 360;
const screens = [
  { id: 'left', name: 'Left', width: 1920, height: 1080 },
  { id: 'right', name: 'Right', width: 1920, height: 1080 },
];
// Where each projector's picture lands in the photo (normalised TL TR BR BL).
const truth: Record<string, { x: number; y: number }[]> = {
  left: [{ x: 0.06, y: 0.2 }, { x: 0.58, y: 0.14 }, { x: 0.6, y: 0.82 }, { x: 0.08, y: 0.76 }],
  right: [{ x: 0.42, y: 0.15 }, { x: 0.95, y: 0.22 }, { x: 0.93, y: 0.78 }, { x: 0.4, y: 0.84 }],
};

/** 3x3 row-major homography taking four source points to four targets. */
function quadToQuad(from: number[][], to: number[][]): number[] {
  const a: number[][] = [];
  from.forEach(([x, y], i) => {
    const [u, v] = to[i];
    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u], [0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  });
  for (let c = 0; c < 8; c++) {
    let pivot = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(a[r][c]) > Math.abs(a[pivot][c])) pivot = r;
    [a[c], a[pivot]] = [a[pivot], a[c]];
    const d = a[c][c];
    for (let k = c; k < 9; k++) a[c][k] /= d;
    for (let r = 0; r < 8; r++) if (r !== c) { const f = a[r][c]; for (let k = c; k < 9; k++) a[r][k] -= f * a[c][k]; }
  }
  return [...a.map(row => row[8]), 1];
}

function rig() {
  let showing: { screenId: string; frame: PatternFrame } | null = null;
  const shown: string[] = [];
  let ended = false;
  const frameOf = new Map<string, Map<number, PatternFrame>>();
  const cameraToProjector = new Map<string, number[]>();
  for (const s of screens) {
    const plan = planPatterns(s.width, s.height, STRIPE_CELL);
    frameOf.set(s.id, new Map(plan.frames.map(f => [stripeFrameCode(f, STRIPE_CELL), f])));
    cameraToProjector.set(s.id, quadToQuad(
      truth[s.id].map(p => [p.x * CAM_W, p.y * CAM_H]),
      [[0, 0], [s.width, 0], [s.width, s.height], [0, s.height]]));
  }
  let noise = 12345;
  const random = () => ((noise = (noise * 1664525 + 1013904223) >>> 0) / 4294967296);
  const link: AutoMapLink = {
    async request(op, extra = {}) {
      if (op === 'screens') return { screens, cells: [...STRIPE_CELLS] };
      if (op === 'end') { ended = true; showing = null; return { done: true }; }
      const frame = frameOf.get(String(extra.screenId))?.get(Number(extra.frame));
      if (!frame) throw new Error('unknown frame');
      showing = { screenId: String(extra.screenId), frame };
      shown.push(String(extra.screenId));
      return { shown: true };
    },
  };
  const camera: AutoMapCamera = {
    async grab() {
      const luma = new Float32Array(CAM_W * CAM_H);
      const gain = 0.8 + random() * 0.4;
      const screen = screens.find(s => s.id === showing?.screenId);
      const plan = screen && planPatterns(screen.width, screen.height, STRIPE_CELL);
      const h = screen && cameraToProjector.get(screen.id)!;
      for (let y = 0; y < CAM_H; y++) for (let x = 0; x < CAM_W; x++) {
        let light = 18;
        if (screen && plan && h && showing) {
          const p = applyHomography(h, x + 0.5, y + 0.5);
          if (p.x >= 0 && p.x < screen.width && p.y >= 0 && p.y < screen.height) light += 170 * patternValue(plan, showing.frame, Math.floor(p.x), Math.floor(p.y));
        }
        luma[y * CAM_W + x] = gain * (light + (random() - 0.5) * 8);
      }
      return { width: CAM_W, height: CAM_H, luma };
    },
  };
  return { link, camera, shown, ended: () => ended };
}

describe('auto-map run', () => {
  it('finds both projectors in the photo and always clears the stripes', async () => {
    const { link, camera, shown, ended } = rig();
    const notes: string[] = [];
    const result = await runAutoMap(link, camera, text => notes.push(text), { settleMs: 0, encode: () => 'data:image/jpeg;base64,' });
    expect(result.projectors.map(p => p.id)).toEqual(['left', 'right']);
    for (const projector of result.projectors) {
      projector.corners.forEach((corner, i) => {
        expect(Math.abs(corner.x - truth[projector.id][i].x)).toBeLessThan(0.004);
        expect(Math.abs(corner.y - truth[projector.id][i].y)).toBeLessThan(0.004);
      });
      expect(projector.rmsPx).toBeLessThan(STRIPE_CELL);
    }
    expect(result.reference.width).toBe(CAM_W);
    expect(new Set(shown)).toEqual(new Set(['left', 'right']));
    expect(ended()).toBe(true);
    expect(notes.some(n => n.includes('pattern 1 of'))).toBe(true);
  }, 30000);

  it('clears the stripes and explains when a projector cannot be seen', async () => {
    const { link, ended } = rig();
    const blind: AutoMapCamera = { async grab() { return { width: CAM_W, height: CAM_H, luma: new Float32Array(CAM_W * CAM_H).fill(20) }; } };
    await expect(runAutoMap(link, blind, () => {}, { settleMs: 0, encode: () => '' })).rejects.toThrow(/Left: .*projector/);
    expect(ended()).toBe(true);
  }, 30000);

  it('says what to do when no Screen is open', async () => {
    const none: AutoMapLink = { async request() { return { screens: [] }; } };
    await expect(runAutoMap(none, { async grab() { throw new Error('unused'); } })).rejects.toThrow(/Open on display/);
  });
});

describe('outlined surface', () => {
  it('maps an outline traced on the photo into the projector picture', async () => {
    const { link, camera } = rig();
    const result = await runAutoMap(link, camera, () => {}, { settleMs: 0, encode: () => '' });
    const left = result.projectors[0];
    // A patch well inside the left projector's footprint, traced on the photo.
    const outline = [{ x: 0.2, y: 0.35 }, { x: 0.45, y: 0.33 }, { x: 0.46, y: 0.6 }, { x: 0.21, y: 0.62 }];
    const mapped = mapSurface(left, outline);
    const h = quadToQuad(truth.left.map(p => [p.x * CAM_W, p.y * CAM_H]), [[0, 0], [1920, 0], [1920, 1080], [0, 1080]]);
    outline.forEach((p, i) => {
      const want = applyHomography(h, p.x * CAM_W, p.y * CAM_H);
      expect(Math.abs(mapped.points[i].x * 1920 - want.x)).toBeLessThan(12);
      expect(Math.abs(mapped.points[i].y * 1080 - want.y)).toBeLessThan(12);
    });
    expect(mapped.agree).toBeGreaterThan(0.9);
    // Outside the lit area there is nothing to fit.
    expect(() => mapSurface(left, [{ x: 0.9, y: 0.02 }, { x: 0.98, y: 0.02 }, { x: 0.98, y: 0.08 }, { x: 0.9, y: 0.08 }])).toThrow(/does not light/);
  }, 30000);
});
