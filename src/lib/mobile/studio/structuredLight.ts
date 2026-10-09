// Structured-light (Gray code) decoding for projector auto-mapping.
//
// The projector shows a stack of stripe patterns, a camera at a fixed position
// photographs each one, and this module works out which projector pixel every
// camera pixel sees, then fits a homography to that correspondence.
//
// Pure TypeScript with no DOM or Node APIs: it runs in a phone WebView and in
// Electron. `patternValue` is the single source of truth for the pattern; the
// WGSL shader that draws the stripes must match it exactly.
//
// Coordinate conventions:
// - Projector and camera coordinates are continuous, top-left origin, with
//   pixel i covering [i, i + 1). Camera pixel (x, y) is treated as the point
//   (x + 0.5, y + 0.5), so normalised corners come out right at the edges.

export type UV = { x: number; y: number };

export type PatternFrame =
  | { kind: 'white' }
  | { kind: 'black' }
  | { kind: 'bit'; axis: 'x' | 'y'; bit: number; inverted: boolean }; // bit 0 = most significant

export type PatternPlan = {
  width: number; // projector native pixels
  height: number;
  cell: number; // projector pixels per code step (finest stripe width)
  bitsX: number;
  bitsY: number;
  frames: PatternFrame[]; // white, black, then x bits (normal, inverted), then y bits likewise
};

export type Capture = {
  width: number;
  height: number;
  luma: Uint8Array | Uint8ClampedArray | Float32Array; // row-major, top-left origin, any consistent scale
};

export type Decoded = {
  width: number; // camera pixels
  height: number;
  valid: Uint8Array; // 1 where the pixel sees the projector reliably
  projX: Float32Array; // projector pixel coordinates (centre of the decoded cell) where valid
  projY: Float32Array;
  coverage: number; // fraction of camera pixels valid
};

export type HomographyFit = {
  cameraToProjector: number[]; // 3x3 row-major, camera PIXELS -> projector PIXELS
  projectorToCamera: number[]; // inverse
  cornersInPhoto: UV[]; // projector full-frame corners in the photo, normalised 0..1, order TL, TR, BR, BL
  inliers: number;
  samples: number;
  rmsPx: number; // RMS reprojection error of inliers, projector pixels
};

// ---------------------------------------------------------------------------
// Pattern
// ---------------------------------------------------------------------------

function bitsForCodes(codes: number): number {
  // Integer version of ceil(log2(codes)), so there is no float rounding risk.
  let bits = 0;
  while (2 ** bits < codes) bits++;
  return bits;
}

export function planPatterns(width: number, height: number, cell = 8): PatternPlan {
  if (!(width >= 1) || !(height >= 1) || !(cell >= 1)) {
    throw new Error('planPatterns needs a positive width, height and cell size.');
  }
  width = Math.floor(width);
  height = Math.floor(height);
  cell = Math.floor(cell);

  const bitsX = bitsForCodes(Math.ceil(width / cell));
  const bitsY = bitsForCodes(Math.ceil(height / cell));

  const frames: PatternFrame[] = [{ kind: 'white' }, { kind: 'black' }];
  for (let bit = 0; bit < bitsX; bit++) {
    frames.push({ kind: 'bit', axis: 'x', bit, inverted: false });
    frames.push({ kind: 'bit', axis: 'x', bit, inverted: true });
  }
  for (let bit = 0; bit < bitsY; bit++) {
    frames.push({ kind: 'bit', axis: 'y', bit, inverted: false });
    frames.push({ kind: 'bit', axis: 'y', bit, inverted: true });
  }
  return { width, height, cell, bitsX, bitsY, frames };
}

/** 1 = lit, 0 = dark, for projector pixel (px, py), top-left origin. */
export function patternValue(plan: PatternPlan, frame: PatternFrame, px: number, py: number): 0 | 1 {
  if (frame.kind === 'white') return 1;
  if (frame.kind === 'black') return 0;
  const bits = frame.axis === 'x' ? plan.bitsX : plan.bitsY;
  const code = Math.floor((frame.axis === 'x' ? px : py) / plan.cell);
  const gray = code ^ (code >> 1);
  const lit = (gray >> (bits - 1 - frame.bit)) & 1;
  return (frame.inverted ? 1 - lit : lit) as 0 | 1;
}

// ---------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------

type Luma = Capture['luma'];

/** Percentile (0..1) of a strided sample of the data; cheap and robust to hot pixels. */
function percentile(data: ArrayLike<number>, fraction: number): number {
  const stride = Math.max(1, Math.floor(data.length / 20000));
  const sample: number[] = [];
  for (let i = 0; i < data.length; i += stride) sample.push(data[i]);
  if (sample.length === 0) return 0;
  sample.sort((a, b) => a - b);
  const at = Math.min(sample.length - 1, Math.max(0, Math.round(fraction * (sample.length - 1))));
  return sample[at];
}

function medianInPlace(values: Float32Array, count: number): number {
  // Insertion sort: count is at most 24.
  for (let i = 1; i < count; i++) {
    const v = values[i];
    let j = i - 1;
    while (j >= 0 && values[j] > v) {
      values[j + 1] = values[j];
      j--;
    }
    values[j + 1] = v;
  }
  return count % 2 === 1 ? values[(count - 1) / 2] : 0.5 * (values[count / 2 - 1] + values[count / 2]);
}

const SPECKLE_RADIUS = 2;
const SPECKLE_MIN_NEIGHBOURS = 3;

/** Drop valid pixels that are nearly alone or disagree wildly with the pixels around them. */
function removeSpeckle(decoded: Decoded, cell: number): void {
  const { width, height, valid, projX, projY } = decoded;
  const before = valid.slice(); // judge every pixel against the same input
  const tolerance = 4 * cell;
  const side = 2 * SPECKLE_RADIUS + 1;
  const xs = new Float32Array(side * side);
  const ys = new Float32Array(side * side);

  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - SPECKLE_RADIUS);
    const y1 = Math.min(height - 1, y + SPECKLE_RADIUS);
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!before[i]) continue;
      const x0 = Math.max(0, x - SPECKLE_RADIUS);
      const x1 = Math.min(width - 1, x + SPECKLE_RADIUS);
      let count = 0;
      for (let ny = y0; ny <= y1; ny++) {
        for (let nx = x0; nx <= x1; nx++) {
          const j = ny * width + nx;
          if (j === i || !before[j]) continue;
          xs[count] = projX[j];
          ys[count] = projY[j];
          count++;
        }
      }
      if (count < SPECKLE_MIN_NEIGHBOURS) {
        valid[i] = 0;
        continue;
      }
      const mx = medianInPlace(xs, count);
      const my = medianInPlace(ys, count);
      if (Math.abs(projX[i] - mx) > tolerance || Math.abs(projY[i] - my) > tolerance) valid[i] = 0;
    }
  }
}

export function decodeCaptures(
  plan: PatternPlan,
  captures: Capture[],
  options?: { minContrast?: number; minBitMargin?: number },
): Decoded {
  const minContrast = options?.minContrast ?? 0.2;
  const minBitMargin = options?.minBitMargin ?? 0.15;

  if (captures.length !== plan.frames.length) {
    throw new Error(`Expected ${plan.frames.length} photos (one per pattern) but got ${captures.length}.`);
  }
  const width = captures[0].width;
  const height = captures[0].height;
  const n = width * height;
  for (const capture of captures) {
    if (capture.width !== width || capture.height !== height || capture.luma.length < n) {
      throw new Error('All photos must be the same size. The camera must not move or change resolution.');
    }
  }

  // Find each capture by what its frame says, not by assumed position.
  let white: Luma | null = null;
  let black: Luma | null = null;
  const pairsX: { normal: Luma | null; inverted: Luma | null }[] = [];
  const pairsY: { normal: Luma | null; inverted: Luma | null }[] = [];
  for (let b = 0; b < plan.bitsX; b++) pairsX.push({ normal: null, inverted: null });
  for (let b = 0; b < plan.bitsY; b++) pairsY.push({ normal: null, inverted: null });
  plan.frames.forEach((frame, index) => {
    const luma = captures[index].luma;
    if (frame.kind === 'white') white = luma;
    else if (frame.kind === 'black') black = luma;
    else {
      const pair = (frame.axis === 'x' ? pairsX : pairsY)[frame.bit];
      if (pair) {
        if (frame.inverted) pair.inverted = luma;
        else pair.normal = luma;
      }
    }
  });
  const whiteLuma = white as Luma | null;
  const blackLuma = black as Luma | null;
  const complete = (p: { normal: Luma | null; inverted: Luma | null }) => p.normal && p.inverted;
  if (!whiteLuma || !blackLuma || !pairsX.every(complete) || !pairsY.every(complete)) {
    throw new Error('The pattern plan is missing frames (white, black, or a normal/inverted bit pair).');
  }

  const decoded: Decoded = {
    width,
    height,
    valid: new Uint8Array(n),
    projX: new Float32Array(n),
    projY: new Float32Array(n),
    coverage: 0,
  };

  // Dynamic range of the scene: brightest the white frame gets, darkest the black one gets.
  const whiteHigh = percentile(whiteLuma, 0.99);
  const range = whiteHigh - percentile(blackLuma, 0.01);
  if (!(range > 0)) return decoded;

  // If even the strongest white-minus-black difference is tiny next to the image
  // brightness, the projector is not visible at all and anything we decode is noise.
  const diff = new Float32Array(n);
  for (let i = 0; i < n; i++) diff[i] = whiteLuma[i] - blackLuma[i];
  if (percentile(diff, 0.995) < 0.05 * whiteHigh) return decoded;

  const contrastFloor = minContrast * range;
  const codesX = Math.ceil(plan.width / plan.cell);
  const codesY = Math.ceil(plan.height / plan.cell);

  // Returns the decoded cell index, or -1 if any bit is too close to call.
  const decodeAxis = (pairs: typeof pairsX, i: number, margin: number): number => {
    let gray = 0;
    for (let b = 0; b < pairs.length; b++) {
      // Normal vs inverted at the same pixel cancels ambient light and most exposure drift.
      const d = (pairs[b].normal as Luma)[i] - (pairs[b].inverted as Luma)[i];
      if (Math.abs(d) < margin) return -1;
      gray = gray * 2 + (d > 0 ? 1 : 0);
    }
    let code = gray;
    for (let shift = gray >> 1; shift > 0; shift >>= 1) code ^= shift;
    return code;
  };

  for (let i = 0; i < n; i++) {
    const contrast = diff[i];
    if (!(contrast > contrastFloor)) continue;
    const margin = minBitMargin * contrast;
    const cx = decodeAxis(pairsX, i, margin);
    if (cx < 0 || cx >= codesX) continue;
    const cy = decodeAxis(pairsY, i, margin);
    if (cy < 0 || cy >= codesY) continue;
    decoded.valid[i] = 1;
    decoded.projX[i] = (cx + 0.5) * plan.cell;
    decoded.projY[i] = (cy + 0.5) * plan.cell;
  }

  removeSpeckle(decoded, plan.cell);

  let count = 0;
  for (let i = 0; i < n; i++) count += decoded.valid[i];
  decoded.coverage = n > 0 ? count / n : 0;
  return decoded;
}

// ---------------------------------------------------------------------------
// Homography
// ---------------------------------------------------------------------------

/** Apply a 3x3 row-major homography to a point. */
export function applyHomography(h: number[], x: number, y: number): UV {
  const w = h[6] * x + h[7] * y + h[8];
  return { x: (h[0] * x + h[1] * y + h[2]) / w, y: (h[3] * x + h[4] * y + h[5]) / w };
}

/** Inverse of a 3x3 row-major matrix, scaled so the last element is 1 when possible. */
export function invertHomography(h: number[]): number[] {
  const [a, b, c, d, e, f, g, i, j] = h;
  const out = [
    e * j - f * i, c * i - b * j, b * f - c * e,
    f * g - d * j, a * j - c * g, c * d - a * f,
    d * i - e * g, b * g - a * i, a * e - b * d,
  ];
  const det = a * out[0] + b * out[3] + c * out[6];
  if (!isFinite(det) || Math.abs(det) < 1e-300) throw new Error('The fitted mapping is degenerate and cannot be inverted.');
  const scale = Math.abs(out[8]) > 1e-300 ? 1 / out[8] : 1 / det;
  return out.map((v) => v * scale);
}

function multiply3(a: number[], b: number[]): number[] {
  const out = new Array<number>(9);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
    }
  }
  return out;
}

/** Small seeded PRNG so RANSAC gives the same answer for the same input. */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Solve the 8x8 system m * h = rhs in place (Gaussian elimination, partial pivoting). */
function solve8(m: Float64Array, rhs: Float64Array): boolean {
  const N = 8;
  for (let col = 0; col < N; col++) {
    let pivot = col;
    for (let r = col + 1; r < N; r++) {
      if (Math.abs(m[r * N + col]) > Math.abs(m[pivot * N + col])) pivot = r;
    }
    if (Math.abs(m[pivot * N + col]) < 1e-11) return false;
    if (pivot !== col) {
      for (let c = 0; c < N; c++) {
        const t = m[col * N + c];
        m[col * N + c] = m[pivot * N + c];
        m[pivot * N + c] = t;
      }
      const t = rhs[col];
      rhs[col] = rhs[pivot];
      rhs[pivot] = t;
    }
    for (let r = col + 1; r < N; r++) {
      const factor = m[r * N + col] / m[col * N + col];
      if (factor === 0) continue;
      for (let c = col; c < N; c++) m[r * N + c] -= factor * m[col * N + c];
      rhs[r] -= factor * rhs[col];
    }
  }
  for (let r = N - 1; r >= 0; r--) {
    let sum = rhs[r];
    for (let c = r + 1; c < N; c++) sum -= m[r * N + c] * rhs[c];
    rhs[r] = sum / m[r * N + r];
  }
  return true;
}

/** Translate to the centroid and scale so the mean distance is sqrt(2) (Hartley normalisation). */
function normaliser(xs: Float64Array, ys: Float64Array): { cx: number; cy: number; scale: number } {
  const n = xs.length;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < n; i++) {
    cx += xs[i];
    cy += ys[i];
  }
  cx /= n;
  cy /= n;
  let dist = 0;
  for (let i = 0; i < n; i++) dist += Math.hypot(xs[i] - cx, ys[i] - cy);
  dist /= n;
  return { cx, cy, scale: dist > 1e-9 ? Math.SQRT2 / dist : 1 };
}

const TOO_FEW =
  'Check that the projector is on and fully in the photo, the camera did not move, and the room is not too bright.';

export function fitHomography(
  plan: PatternPlan,
  decoded: Decoded,
  options?: { maxSamples?: number; inlierPx?: number; iterations?: number; seed?: number },
): HomographyFit {
  const maxSamples = Math.max(8, Math.floor(options?.maxSamples ?? 4000));
  const inlierPx = options?.inlierPx ?? 1.5 * plan.cell;
  const iterations = Math.max(1, Math.floor(options?.iterations ?? 400));
  const random = mulberry32(options?.seed ?? 1);
  const MIN_SAMPLES = 24;

  const { width, height, valid } = decoded;
  const total = width * height;
  let validCount = 0;
  for (let i = 0; i < total; i++) validCount += valid[i];
  if (validCount < MIN_SAMPLES) {
    throw new Error(`Could not find the projector in the photos (only ${validCount} usable points). ${TOO_FEW}`);
  }

  // Take every k-th valid pixel in raster order, which spreads samples over the whole footprint.
  const n = Math.min(validCount, maxSamples);
  const step = validCount / n;
  const camX = new Float64Array(n);
  const camY = new Float64Array(n);
  const prjX = new Float64Array(n);
  const prjY = new Float64Array(n);
  let seen = 0;
  let taken = 0;
  for (let i = 0; i < total && taken < n; i++) {
    if (!valid[i]) continue;
    if (seen >= Math.floor(taken * step)) {
      camX[taken] = (i % width) + 0.5;
      camY[taken] = Math.floor(i / width) + 0.5;
      prjX[taken] = decoded.projX[i];
      prjY[taken] = decoded.projY[i];
      taken++;
    }
    seen++;
  }

  // Work in normalised coordinates so the linear systems are well conditioned.
  const nc = normaliser(camX, camY);
  const np = normaliser(prjX, prjY);
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const u = new Float64Array(n);
  const v = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    x[i] = (camX[i] - nc.cx) * nc.scale;
    y[i] = (camY[i] - nc.cy) * nc.scale;
    u[i] = (prjX[i] - np.cx) * np.scale;
    v[i] = (prjY[i] - np.cy) * np.scale;
  }
  const threshold2 = (inlierPx * np.scale) ** 2;

  const m = new Float64Array(64);
  const rhs = new Float64Array(8);
  const row = new Float64Array(8);

  // Least-squares DLT with h33 fixed at 1 (safe in centred coordinates), via normal equations.
  // `previous` reweights rows by 1/w so the algebraic error approximates pixel error.
  const solveFor = (indices: ArrayLike<number>, count: number, previous: Float64Array | null): Float64Array | null => {
    m.fill(0);
    rhs.fill(0);
    const add = (target: number, weight: number) => {
      for (let r = 0; r < 8; r++) {
        const wr = row[r] * weight;
        if (wr === 0) continue;
        for (let c = 0; c < 8; c++) m[r * 8 + c] += wr * row[c];
        rhs[r] += wr * target;
      }
    };
    for (let k = 0; k < count; k++) {
      const i = indices[k];
      let weight = 1;
      if (previous) {
        const w = previous[6] * x[i] + previous[7] * y[i] + 1;
        weight = 1 / Math.max(1e-6, w * w);
      }
      row[0] = x[i]; row[1] = y[i]; row[2] = 1; row[3] = 0; row[4] = 0; row[5] = 0;
      row[6] = -u[i] * x[i]; row[7] = -u[i] * y[i];
      add(u[i], weight);
      row[0] = 0; row[1] = 0; row[2] = 0; row[3] = x[i]; row[4] = y[i]; row[5] = 1;
      row[6] = -v[i] * x[i]; row[7] = -v[i] * y[i];
      add(v[i], weight);
    }
    if (!solve8(m, rhs)) return null;
    const h = Float64Array.from(rhs);
    for (let k = 0; k < 8; k++) if (!isFinite(h[k])) return null;
    return h;
  };

  const error2 = (h: Float64Array, i: number): number => {
    const w = h[6] * x[i] + h[7] * y[i] + 1;
    if (w <= 1e-9) return Infinity; // behind the camera: never a real match
    const du = (h[0] * x[i] + h[1] * y[i] + h[2]) / w - u[i];
    const dv = (h[3] * x[i] + h[4] * y[i] + h[5]) / w - v[i];
    return du * du + dv * dv;
  };

  const collectInliers = (h: Float64Array, into: Int32Array): number => {
    let count = 0;
    for (let i = 0; i < n; i++) if (error2(h, i) < threshold2) into[count++] = i;
    return count;
  };

  // RANSAC over minimal 4-point samples.
  let best: Float64Array | null = null;
  let bestCount = 0;
  const pick = new Int32Array(4);
  const scratch = new Int32Array(n);
  for (let iter = 0; iter < iterations; iter++) {
    for (let k = 0; k < 4; k++) {
      let candidate = 0;
      let unique = false;
      while (!unique) {
        candidate = Math.floor(random() * n);
        unique = true;
        for (let j = 0; j < k; j++) if (pick[j] === candidate) unique = false;
      }
      pick[k] = candidate;
    }
    const h = solveFor(pick, 4, null);
    if (!h) continue;
    let count = 0;
    for (let i = 0; i < n; i++) if (error2(h, i) < threshold2) count++;
    if (count > bestCount) {
      bestCount = count;
      best = h;
    }
  }

  const noFit = () =>
    new Error(`The decoded points do not agree on one flat projector image (${bestCount} of ${n} fit). ${TOO_FEW}`);
  if (!best || bestCount < Math.max(12, 0.25 * n)) throw noFit();

  // Refit on the inliers, then re-pick inliers with the better model, a few times.
  let inliers = scratch;
  let inlierCount = collectInliers(best, inliers);
  for (let round = 0; round < 3; round++) {
    let h = solveFor(inliers, inlierCount, null);
    for (let pass = 0; h && pass < 2; pass++) h = solveFor(inliers, inlierCount, h) ?? h;
    if (!h) break;
    const next = new Int32Array(n);
    const nextCount = collectInliers(h, next);
    if (nextCount < inlierCount) break;
    best = h;
    inliers = next;
    inlierCount = nextCount;
  }
  bestCount = inlierCount;
  if (inlierCount < Math.max(12, 0.25 * n)) throw noFit();

  // Points that all decode to (nearly) one spot cannot pin down a mapping.
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (let k = 0; k < inlierCount; k++) {
    const i = inliers[k];
    minU = Math.min(minU, prjX[i]); maxU = Math.max(maxU, prjX[i]);
    minV = Math.min(minV, prjY[i]); maxV = Math.max(maxV, prjY[i]);
  }
  if (maxU - minU < 4 * plan.cell || maxV - minV < 4 * plan.cell) {
    throw new Error(`Too little of the projector image is visible to map it. ${TOO_FEW}`);
  }

  // Undo the normalisation: H = Tp^-1 * Hn * Tc.
  const hn = [best[0], best[1], best[2], best[3], best[4], best[5], best[6], best[7], 1];
  const tc = [nc.scale, 0, -nc.cx * nc.scale, 0, nc.scale, -nc.cy * nc.scale, 0, 0, 1];
  const tpInv = [1 / np.scale, 0, np.cx, 0, 1 / np.scale, np.cy, 0, 0, 1];
  let cameraToProjector = multiply3(tpInv, multiply3(hn, tc));
  if (Math.abs(cameraToProjector[8]) > 1e-300) {
    const s = 1 / cameraToProjector[8];
    cameraToProjector = cameraToProjector.map((value) => value * s);
  }
  const projectorToCamera = invertHomography(cameraToProjector);

  let sum = 0;
  for (let k = 0; k < inlierCount; k++) sum += error2(best, inliers[k]);
  const rmsPx = Math.sqrt(sum / inlierCount) / np.scale;

  const corners: [number, number][] = [[0, 0], [plan.width, 0], [plan.width, plan.height], [0, plan.height]];
  const cornersInPhoto = corners.map(([px, py]) => {
    const p = applyHomography(projectorToCamera, px, py);
    return { x: p.x / width, y: p.y / height };
  });
  if (!cornersInPhoto.every((c) => isFinite(c.x) && isFinite(c.y))) throw noFit();

  return { cameraToProjector, projectorToCamera, cornersInPhoto, inliers: inlierCount, samples: n, rmsPx };
}
