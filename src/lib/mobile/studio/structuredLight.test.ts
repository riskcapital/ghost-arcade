import { describe, it, expect } from 'vitest';
import {
  planPatterns,
  patternValue,
  decodeCaptures,
  fitHomography,
  type Capture,
  type PatternPlan,
  type UV,
} from './structuredLight';

// ---------------------------------------------------------------------------
// Camera simulator
// ---------------------------------------------------------------------------

function prng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(random: () => number): number {
  const a = Math.max(1e-12, random());
  return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * random());
}

/** Independent 4-point homography solver (source quad -> destination quad), 3x3 row-major. */
function homographyFromQuad(src: UV[], dst: UV[]): number[] {
  const a: number[][] = [];
  for (let k = 0; k < 4; k++) {
    const { x, y } = src[k];
    const { x: u, y: v } = dst[k];
    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    a.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  for (let col = 0; col < 8; col++) {
    let pivot = col;
    for (let r = col + 1; r < 8; r++) if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    for (let r = 0; r < 8; r++) {
      if (r === col) continue;
      const f = a[r][col] / a[col][col];
      for (let c = col; c < 9; c++) a[r][c] -= f * a[col][c];
    }
  }
  const h = a.map((row, i) => row[8] / row[i]);
  return [...h, 1];
}

function apply(h: number[], x: number, y: number): UV {
  const w = h[6] * x + h[7] * y + h[8];
  return { x: (h[0] * x + h[1] * y + h[2]) / w, y: (h[3] * x + h[4] * y + h[5]) / w };
}

function boxBlur(src: Float32Array, width: number, height: number, radius: number): Float32Array {
  if (radius <= 0) return src;
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const size = 2 * radius + 1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let d = -radius; d <= radius; d++) sum += src[y * width + Math.min(width - 1, Math.max(0, x + d))];
      tmp[y * width + x] = sum / size;
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let d = -radius; d <= radius; d++) sum += tmp[Math.min(height - 1, Math.max(0, y + d)) * width + x];
      out[y * width + x] = sum / size;
    }
  }
  return out;
}

type Scene = {
  camWidth: number;
  camHeight: number;
  cornersPx: UV[]; // projector TL, TR, BR, BL in camera pixels
  blur?: number;
  ambient?: number;
  projector?: number; // brightness the projector adds where lit
  noise?: number; // sigma
  exposureDrift?: boolean; // a different gain per frame, 0.7 to 1.3
  occlude?: { x0: number; y0: number; x1: number; y1: number }; // camera pixels, black in every capture
  seed?: number;
};

type Simulated = {
  captures: Capture[];
  trueX: Float32Array; // true projector coordinate seen by each camera pixel
  trueY: Float32Array;
  inside: Uint8Array;
  cornersNorm: UV[];
};

function simulate(plan: PatternPlan, scene: Scene): Simulated {
  const { camWidth: w, camHeight: h } = scene;
  const random = prng(scene.seed ?? 7);
  const ambient = scene.ambient ?? 0;
  const projector = scene.projector ?? 150;
  const full: UV[] = [
    { x: 0, y: 0 },
    { x: plan.width, y: 0 },
    { x: plan.width, y: plan.height },
    { x: 0, y: plan.height },
  ];
  const camToProj = homographyFromQuad(scene.cornersPx, full);

  const trueX = new Float32Array(w * h);
  const trueY = new Float32Array(w * h);
  const inside = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = apply(camToProj, x + 0.5, y + 0.5);
      const i = y * w + x;
      trueX[i] = p.x;
      trueY[i] = p.y;
      inside[i] = p.x >= 0 && p.x < plan.width && p.y >= 0 && p.y < plan.height ? 1 : 0;
    }
  }

  const captures = plan.frames.map((frame): Capture => {
    let img: Float32Array = new Float32Array(w * h);
    for (let i = 0; i < img.length; i++) {
      const lit = inside[i] ? patternValue(plan, frame, Math.floor(trueX[i]), Math.floor(trueY[i])) : 0;
      img[i] = ambient + projector * lit;
    }
    const o = scene.occlude;
    if (o) {
      for (let y = o.y0; y < o.y1; y++) for (let x = o.x0; x < o.x1; x++) img[y * w + x] = 0;
    }
    img = boxBlur(img, w, h, scene.blur ?? 0);
    const gain = scene.exposureDrift ? 0.7 + 0.6 * random() : 1;
    const luma = new Uint8ClampedArray(w * h);
    for (let i = 0; i < img.length; i++) {
      luma[i] = img[i] * gain + (scene.noise ? scene.noise * gaussian(random) : 0);
    }
    return { width: w, height: h, luma };
  });

  return {
    captures,
    trueX,
    trueY,
    inside,
    cornersNorm: scene.cornersPx.map((c) => ({ x: c.x / w, y: c.y / h })),
  };
}

function maxCornerError(found: UV[], truth: UV[]): number {
  let worst = 0;
  for (let k = 0; k < 4; k++) {
    worst = Math.max(worst, Math.abs(found[k].x - truth[k].x), Math.abs(found[k].y - truth[k].y));
  }
  return worst;
}

// Strong keystone, projector covering only part of a 640x480 frame.
const LANDSCAPE_QUAD: UV[] = [
  { x: 118.3, y: 71.6 },
  { x: 561.2, y: 112.4 },
  { x: 522.7, y: 418.9 },
  { x: 92.5, y: 361.3 },
];
const PORTRAIT_QUAD: UV[] = [
  { x: 92.4, y: 58.7 },
  { x: 401.6, y: 103.2 },
  { x: 378.1, y: 588.5 },
  { x: 71.9, y: 541.3 },
];
const MESSY = { blur: 2, ambient: 30, projector: 150, noise: 3, exposureDrift: true };

// ---------------------------------------------------------------------------

describe('planPatterns', () => {
  it('sizes and orders frames for 1920x1080', () => {
    const plan = planPatterns(1920, 1080);
    expect(plan).toMatchObject({ width: 1920, height: 1080, cell: 8, bitsX: 8, bitsY: 8 });
    expect(plan.frames.length).toBe(2 + 2 * 8 + 2 * 8);
    expect(plan.frames[0]).toEqual({ kind: 'white' });
    expect(plan.frames[1]).toEqual({ kind: 'black' });
    expect(plan.frames[2]).toEqual({ kind: 'bit', axis: 'x', bit: 0, inverted: false });
    expect(plan.frames[3]).toEqual({ kind: 'bit', axis: 'x', bit: 0, inverted: true });
    expect(plan.frames[17]).toEqual({ kind: 'bit', axis: 'x', bit: 7, inverted: true });
    expect(plan.frames[18]).toEqual({ kind: 'bit', axis: 'y', bit: 0, inverted: false });
    expect(plan.frames[33]).toEqual({ kind: 'bit', axis: 'y', bit: 7, inverted: true });
  });

  it('sizes a portrait projector and a custom cell', () => {
    const portrait = planPatterns(1080, 1920);
    expect(portrait).toMatchObject({ width: 1080, height: 1920, bitsX: 8, bitsY: 8 });
    expect(portrait.frames.length).toBe(34);

    const coarse = planPatterns(1080, 1920, 32); // 34 x 60 cells
    expect(coarse).toMatchObject({ cell: 32, bitsX: 6, bitsY: 6 });
    const wide = planPatterns(3840, 1080, 8); // 480 x 135 cells
    expect(wide).toMatchObject({ bitsX: 9, bitsY: 8 });
    expect(wide.frames.filter((f) => f.kind === 'bit' && f.axis === 'x').length).toBe(18);
  });
});

describe('patternValue', () => {
  it('is a Gray code: adjacent cells differ in exactly one bit, inverted is the complement', () => {
    const plan = planPatterns(1920, 1080);
    for (const axis of ['x', 'y'] as const) {
      const frames = plan.frames.filter((f) => f.kind === 'bit' && f.axis === axis && !f.inverted);
      const size = axis === 'x' ? plan.width : plan.height;
      const word = (p: number) =>
        frames.map((f) => (axis === 'x' ? patternValue(plan, f, p, 3) : patternValue(plan, f, 3, p)));
      const seen = new Set<string>();
      for (let p = 0; p + plan.cell < size; p += plan.cell) {
        const a = word(p);
        const b = word(p + plan.cell);
        expect(word(p + plan.cell - 1)).toEqual(a); // constant inside a cell
        expect(a.filter((bit, i) => bit !== b[i]).length).toBe(1);
        seen.add(a.join(''));
      }
      expect(seen.size).toBe(Math.ceil(size / plan.cell) - 1); // every cell has its own word
    }
    for (const frame of plan.frames) {
      if (frame.kind !== 'bit' || frame.inverted) continue;
      const inverted = { ...frame, inverted: true };
      for (const [px, py] of [[0, 0], [7, 8], [1001, 513], [1919, 1079]]) {
        expect(patternValue(plan, inverted, px, py)).toBe(1 - patternValue(plan, frame, px, py));
      }
    }
    expect(patternValue(plan, { kind: 'white' }, 5, 5)).toBe(1);
    expect(patternValue(plan, { kind: 'black' }, 5, 5)).toBe(0);
    // Most significant bit splits the code range in half.
    expect(patternValue(plan, plan.frames[2], 0, 0)).toBe(0);
    expect(patternValue(plan, plan.frames[2], 128 * 8, 0)).toBe(1);
  });
});

describe('decodeCaptures', () => {
  it('decodes a clean synthetic stack to within one cell', () => {
    const plan = planPatterns(1920, 1080, 32);
    const sim = simulate(plan, { camWidth: 640, camHeight: 480, cornersPx: LANDSCAPE_QUAD, ambient: 10 });
    const decoded = decodeCaptures(plan, sim.captures);

    let valid = 0;
    let good = 0;
    let validOutside = 0;
    let insideCount = 0;
    let maxErr = 0;
    for (let i = 0; i < decoded.valid.length; i++) {
      insideCount += sim.inside[i];
      if (!decoded.valid[i]) continue;
      valid++;
      if (!sim.inside[i]) validOutside++;
      const err = Math.max(Math.abs(decoded.projX[i] - sim.trueX[i]), Math.abs(decoded.projY[i] - sim.trueY[i]));
      maxErr = Math.max(maxErr, err);
      if (err <= plan.cell) good++;
    }
    console.log(
      `[clean] valid=${valid} of ${insideCount} footprint px, within one cell=${((100 * good) / valid).toFixed(3)}%, ` +
        `max err=${maxErr.toFixed(1)}px (cell ${plan.cell}), valid outside=${validOutside}`,
    );
    expect(validOutside).toBe(0);
    expect(valid / insideCount).toBeGreaterThan(0.95);
    expect(good / valid).toBeGreaterThan(0.99);
    expect(decoded.coverage).toBeCloseTo(valid / decoded.valid.length, 6);
  });

  it('rejects a stack of the wrong length or mixed sizes', () => {
    const plan = planPatterns(64, 64, 8);
    const frame = (w: number, h: number): Capture => ({ width: w, height: h, luma: new Uint8Array(w * h) });
    expect(() => decodeCaptures(plan, [frame(8, 8)])).toThrow(/Expected 14 photos/);
    const mixed = plan.frames.map((_, i) => (i === 3 ? frame(4, 4) : frame(8, 8)));
    expect(() => decodeCaptures(plan, mixed)).toThrow(/same size/);
  });
});

describe('fitHomography', () => {
  it('fits a messy landscape capture (blur, noise, ambient, exposure drift)', () => {
    const plan = planPatterns(1920, 1080, 32);
    const sim = simulate(plan, { camWidth: 640, camHeight: 480, cornersPx: LANDSCAPE_QUAD, ...MESSY });
    const decoded = decodeCaptures(plan, sim.captures);
    const fit = fitHomography(plan, decoded);
    const err = maxCornerError(fit.cornersInPhoto, sim.cornersNorm);
    console.log(
      `[messy landscape] coverage=${decoded.coverage.toFixed(3)} corner err=${err.toFixed(5)} ` +
        `rms=${fit.rmsPx.toFixed(2)}px inliers=${fit.inliers}/${fit.samples}`,
    );
    expect(err).toBeLessThan(0.004);
    expect(fit.rmsPx).toBeLessThan(plan.cell);
    expect(fit.inliers / fit.samples).toBeGreaterThan(0.9);

    // The two matrices are inverses, and the same seed gives the same answer.
    const p = apply(fit.cameraToProjector, 300, 250);
    const back = apply(fit.projectorToCamera, p.x, p.y);
    expect(back.x).toBeCloseTo(300, 6);
    expect(back.y).toBeCloseTo(250, 6);
    expect(fitHomography(plan, decoded).cameraToProjector).toEqual(fit.cameraToProjector);
  });

  it('fits a portrait projector (1080x1920)', () => {
    const plan = planPatterns(1080, 1920, 32);
    const sim = simulate(plan, { camWidth: 480, camHeight: 640, cornersPx: PORTRAIT_QUAD, ...MESSY, seed: 11 });
    const decoded = decodeCaptures(plan, sim.captures);
    const fit = fitHomography(plan, decoded);
    const err = maxCornerError(fit.cornersInPhoto, sim.cornersNorm);
    console.log(
      `[messy portrait] coverage=${decoded.coverage.toFixed(3)} corner err=${err.toFixed(5)} ` +
        `rms=${fit.rmsPx.toFixed(2)}px inliers=${fit.inliers}/${fit.samples}`,
    );
    expect(err).toBeLessThan(0.004);
    expect(fit.rmsPx).toBeLessThan(plan.cell);
  });

  it('still fits when part of the view is blocked', () => {
    const plan = planPatterns(1920, 1080, 32);
    const occlude = { x0: 250, y0: 150, x1: 420, y1: 330 };
    const sim = simulate(plan, {
      camWidth: 640, camHeight: 480, cornersPx: LANDSCAPE_QUAD, ...MESSY, occlude, seed: 23,
    });
    const decoded = decodeCaptures(plan, sim.captures);
    let validInBlock = 0;
    for (let y = occlude.y0 + 4; y < occlude.y1 - 4; y++) {
      for (let x = occlude.x0 + 4; x < occlude.x1 - 4; x++) validInBlock += decoded.valid[y * 640 + x];
    }
    const fit = fitHomography(plan, decoded);
    const err = maxCornerError(fit.cornersInPhoto, sim.cornersNorm);
    console.log(
      `[occluded] coverage=${decoded.coverage.toFixed(3)} corner err=${err.toFixed(5)} ` +
        `rms=${fit.rmsPx.toFixed(2)}px inliers=${fit.inliers}/${fit.samples} validInBlock=${validInBlock}`,
    );
    expect(validInBlock).toBe(0);
    expect(err).toBeLessThan(0.004);
    expect(fit.rmsPx).toBeLessThan(plan.cell);
  });

  it('throws a readable error when there is too little signal', () => {
    const plan = planPatterns(1920, 1080, 32);
    const w = 320;
    const h = 240;
    const random = prng(5);
    // The same scene in every frame: the projector is off or out of shot.
    const stack = (base: (x: number, y: number) => number, sigma: number): Capture[] =>
      plan.frames.map(() => {
        const luma = new Float32Array(w * h);
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) luma[y * w + x] = base(x, y) + sigma * gaussian(random);
        }
        return { width: w, height: h, luma };
      });

    const cases: [string, Capture[]][] = [
      ['textured room', stack((x, y) => 40 + 0.5 * x + 0.2 * y, 1.5)],
      ['flat wall, light noise', stack(() => 100, 1)],
      ['flat wall, heavy noise', stack(() => 100, 4)],
    ];
    for (const [name, captures] of cases) {
      const decoded = decodeCaptures(plan, captures);
      let message = '';
      try {
        fitHomography(plan, decoded);
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        message = (error as Error).message;
      }
      console.log(`[no signal: ${name}] coverage=${decoded.coverage.toFixed(5)} -> ${message || 'NO THROW'}`);
      expect(message).toMatch(/projector/i);
      expect(message.length).toBeGreaterThan(40);
    }
  });
});
