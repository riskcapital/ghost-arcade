/**
 * defaultSourceImage — the built-in demo image the source-driven GPU
 * shaders fall back to when the operator has not bound a source yet.
 *
 * Why this exists
 * ---------------
 * `pixel-particles`, `flythrough` and `particle-field` (media mode) all
 * derive their geometry from an input image/video. With nothing bound the
 * native route used to refuse to build at all, so picking one of them from
 * the shader list produced a black frame — which reads as "broken", not as
 * "waiting for input". This module supplies a real picture so the shader
 * has something to chew on the instant it is selected. The moment the user
 * binds their own source it takes over completely; this is a fallback, not
 * a selection, and it is never written into `layer.gpuLayerContent.params`,
 * so it can never end up in a saved project.
 *
 * Why procedural rather than a bundled file
 * -----------------------------------------
 * These shaders read STRUCTURE out of the picture: pixel-particles pulls
 * depth from luminance / inverse luma / edges / saturation, flythrough
 * replicates it into slabs along Z. A flat logo makes a flat, boring
 * cloud. Generating the image lets us guarantee exactly the properties the
 * shaders want — a wide luminance range with real depth ordering, hard
 * edges for the edge-depth mode, and saturated complementary colour for
 * the saturation mode — with no binary asset, no loader, no decode path,
 * and no way for it to go missing at runtime. It is also pure math, so it
 * is deterministic and testable in Node with no DOM or GPU.
 *
 * The picture: an arcade horizon. A banded retro sun over a perspective
 * grid floor, ridgelines behind it, stars above. Through a depth-from-luma
 * point cloud the sun becomes a raised disc, the grid a glowing lattice,
 * and the ridges fall away behind — a composition that was chosen because
 * it reads well as a 3D cloud, not just as a 2D thumbnail.
 */

/** Source-frame id the built-in demo image is uploaded under in the native
 *  core. Well-known and constant so it is uploaded once and shared by every
 *  layer and shader that falls back to it. */
export const DEFAULT_GPU_SOURCE_ID = 'ghost:builtin-demo-source';

/** Square, because the core's CPU source-frame upload resamples whatever it
 *  is given onto a square texture — an off-square demo image would arrive
 *  stretched. 1024 matches the text atlas ceiling that already ships
 *  through the same base64 upload path. */
export const DEFAULT_GPU_SOURCE_SIZE = 1024;

/** Shown in the panel so nobody thinks their own file failed to load. */
export const DEFAULT_GPU_SOURCE_LABEL = 'Built-in demo image';

export interface DefaultGpuSourceImage {
  width: number;
  height: number;
  /** Tightly packed RGBA8, row-major, top row first. */
  rgba: Uint8ClampedArray;
}

// ───────────────────────── shader eligibility ─────────────────────────

/**
 * Is this GPU shader one that falls back to the demo image?
 *
 * `point-cloud-fx` is deliberately NOT in this set: it consumes .ply /
 * .splat geometry, so an image would be meaningless to it (and it is
 * archived out of the picker anyway).
 */
export function gpuShaderUsesDefaultSource(
  shaderId: string | null | undefined,
  params?: Record<string, unknown> | null,
): boolean {
  const id = String(shaderId ?? '').trim().toLowerCase();
  if (id === 'pixel-particles' || id === 'flythrough') return true;
  if (id === 'particle-field' || id === 'gravity-wells') {
    return String(params?.mode ?? '').trim().toLowerCase() === 'media';
  }
  return false;
}

/**
 * Has the operator bound a source of their own?
 *
 * Only a genuinely EMPTY picker engages the fallback. A source that is
 * present but unresolvable (missing media item, unsupported codec) is a
 * different problem with its own messaging — masking it with the demo
 * image would hide a real failure.
 */
export function gpuSourceParamIsBound(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const source = value as Record<string, unknown>;
  const type = String(source.type ?? '').trim();
  if (!type) return false;
  switch (type) {
    case 'media': return !!String(source.mediaId ?? '').trim();
    case 'layer': return !!String(source.layerId ?? '').trim();
    case 'file': return !!String(source.url ?? '').trim();
    case 'camera': return true;
    case 'spout': return !!String(source.senderName ?? '').trim();
    default: return true;
  }
}

/** Convenience: this layer's shader wants pixels and the picker is empty. */
export function gpuLayerNeedsDefaultSource(
  shaderId: string | null | undefined,
  params?: Record<string, unknown> | null,
): boolean {
  return gpuShaderUsesDefaultSource(shaderId, params) && !gpuSourceParamIsBound(params?.source);
}

// ───────────────────────── tiny math kit ─────────────────────────

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge1 === edge0) return x < edge0 ? 0 : 1;
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t;

function mix3(a: readonly [number, number, number], b: readonly [number, number, number], t: number): [number, number, number] {
  return [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
}

/** Deterministic 2D hash in [0,1). Integer-lattice input. */
function hash2(x: number, y: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x2545f491);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/** Value noise over a 1D lattice — the ridgeline generator. */
function valueNoise1(x: number, seed: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return mix(hash2(i, seed), hash2(i + 1, seed), u);
}

function ridge(x: number, seed: number): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  for (let o = 0; o < 5; o += 1) {
    sum += (valueNoise1(x * freq, seed + o * 37) - 0.5) * amp;
    amp *= 0.52;
    freq *= 2.07;
  }
  return sum;
}

// ───────────────────────── the picture ─────────────────────────

const HORIZON = 0.615;
const SUN_X = 0.5;
const SUN_Y = 0.410;
const SUN_R = 0.190;

const SKY_TOP: readonly [number, number, number] = [0.043, 0.024, 0.169];
const SKY_MID: readonly [number, number, number] = [0.180, 0.043, 0.376];
const SKY_LOW: readonly [number, number, number] = [0.565, 0.090, 0.435];
const SKY_RIM: readonly [number, number, number] = [0.976, 0.365, 0.302];

const SUN_HOT: readonly [number, number, number] = [1.0, 0.898, 0.396];
const SUN_COOL: readonly [number, number, number] = [1.0, 0.157, 0.478];

const FLOOR_NEAR: readonly [number, number, number] = [0.125, 0.027, 0.204];
const FLOOR_FAR: readonly [number, number, number] = [0.027, 0.012, 0.071];

const GRID_WARM: readonly [number, number, number] = [1.0, 0.243, 0.678];
const GRID_COOL: readonly [number, number, number] = [0.235, 0.949, 1.0];

const RIDGE_FAR: readonly [number, number, number] = [0.180, 0.075, 0.318];
const RIDGE_NEAR: readonly [number, number, number] = [0.055, 0.024, 0.118];

// Star lattice. Resolved once into a table rather than re-hashed per
// pixel: the 3x3 neighbourhood lookup runs for every sky pixel, and
// hashing it inline was the single largest cost in the render.
const STAR_CELLS = 96;

interface StarField {
  cols: number;
  rows: number;
  x: Float64Array;
  y: Float64Array;
  /** 0..1 brightness, or -1 for an empty cell. */
  bright: Float64Array;
  warm: Float64Array;
}

function buildStarField(): StarField {
  const cols = STAR_CELLS;
  const rows = Math.ceil(HORIZON * STAR_CELLS) + 2;
  const count = cols * rows;
  const field: StarField = {
    cols,
    rows,
    x: new Float64Array(count),
    y: new Float64Array(count),
    bright: new Float64Array(count).fill(-1),
    warm: new Float64Array(count),
  };
  for (let gy = 0; gy < rows; gy += 1) {
    for (let gx = 0; gx < cols; gx += 1) {
      const h = hash2(gx, gy * 31 + 7);
      if (h < 0.78) continue;
      const k = gy * cols + gx;
      const jx = hash2(gx + 91, gy) - 0.5;
      const jy = hash2(gx, gy + 57) - 0.5;
      field.x[k] = (gx + 0.5 + jx * 0.85) / cols;
      field.y[k] = (gy + 0.5 + jy * 0.85) / cols;
      field.bright[k] = (h - 0.78) / 0.22;
      field.warm[k] = hash2(gx + 5, gy + 13);
    }
  }
  return field;
}

/**
 * Shade one pixel of the demo image.
 *
 * `px` is the pixel pitch in UV units — used as the analytic
 * antialiasing width so the grid resolves cleanly toward the horizon
 * instead of turning into a moiré field (which would read as noise to
 * the edge-depth mode).
 */
function shadeDemoPixel(
  u: number,
  v: number,
  px: number,
  farY: number,
  nearY: number,
  stars: StarField,
): [number, number, number] {
  // ── Sky ───────────────────────────────────────────────────────────
  const skyT = clamp01(v / HORIZON);
  let color: [number, number, number] = skyT < 0.55
    ? mix3(SKY_TOP, SKY_MID, smoothstep(0, 0.55, skyT))
    : mix3(SKY_MID, SKY_LOW, smoothstep(0.55, 1, skyT));
  // Warm band hugging the horizon.
  const rim = Math.pow(smoothstep(0.72, 1.0, skyT), 2.2);
  color = mix3(color, SKY_RIM, rim * 0.55);

  // ── Stars ─────────────────────────────────────────────────────────
  // Jittered lattice, sampled across the 3x3 neighbourhood so a star's
  // falloff is never clipped to its own cell (which is what turns a star
  // field into a grid of squares — and squares would read as hard edges
  // to the edge-depth mode).
  if (v < HORIZON * 0.96) {
    const cell = STAR_CELLS;
    const cx = Math.floor(u * cell);
    const cy = Math.floor(v * cell);
    let star = 0;
    let warm = 0;
    for (let oy = -1; oy <= 1; oy += 1) {
      const gy = cy + oy;
      if (gy < 0 || gy >= stars.rows) continue;
      for (let ox = -1; ox <= 1; ox += 1) {
        const gx = cx + ox;
        if (gx < 0 || gx >= stars.cols) continue;
        const k = gy * stars.cols + gx;
        const bright = stars.bright[k];
        if (bright < 0) continue;
        const ddx = u - stars.x[k];
        const ddy = v - stars.y[k];
        const d = Math.sqrt(ddx * ddx + ddy * ddy);
        const radius = px * (0.9 + bright * bright * 2.6);
        const core = 1 - smoothstep(0, radius, d);
        const halo = Math.exp(-d / (radius * 2.2)) * 0.22 * bright;
        star = Math.max(star, core * (0.35 + bright * 0.65) + halo);
        warm = Math.max(warm, stars.warm[k]);
      }
    }
    // Thin out toward the horizon so the sky reads as depth, not wallpaper.
    star *= (1 - skyT * 0.72);
    color = [
      color[0] + star * mix(0.72, 1.0, warm),
      color[1] + star * mix(0.86, 0.74, warm),
      color[2] + star,
    ];
  }

  // ── Sun ───────────────────────────────────────────────────────────
  const sdx = u - SUN_X;
  const sdy = v - SUN_Y;
  const sd = Math.sqrt(sdx * sdx + sdy * sdy);
  // Outer bloom, present whether or not the disc itself is visible here.
  const bloom = Math.exp(-Math.max(0, sd - SUN_R) * 9.5);
  color = [
    color[0] + bloom * 0.62,
    color[1] + bloom * 0.16,
    color[2] + bloom * 0.30,
  ];
  if (sd < SUN_R + px * 2) {
    const inner = 1 - smoothstep(SUN_R - px * 1.5, SUN_R + px * 1.5, sd);
    // Vertical gradient across the disc: hot at the crown, magenta at the
    // base — the retro sun everybody recognises.
    const g = clamp01((v - (SUN_Y - SUN_R)) / (SUN_R * 2));
    let disc = mix3(SUN_HOT, SUN_COOL, Math.pow(g, 0.85));
    // Horizontal cut bands, thin at the equator and widening toward the
    // base. These are the sun's signature — and they hand the depth modes
    // a stack of clean, high-contrast horizontal edges to bite on.
    const below = clamp01((v - SUN_Y + SUN_R * 0.12) / SUN_R);
    const bandPhase = (v - SUN_Y + SUN_R * 0.12) / (SUN_R * 0.148);
    const bandD = Math.abs(bandPhase - Math.round(bandPhase));
    const cutWidth = 0.10 + below * below * 0.34;
    const cut = below > 0.0
      ? (1 - smoothstep(cutWidth - 0.045, cutWidth + 0.045, bandD)) * smoothstep(0, 0.08, below)
      : 0;
    // Cut bands show the sky behind, but keep a faint ember so the disc
    // still reads as one object rather than a pile of stripes.
    disc = mix3(disc, [color[0] * 0.45 + 0.06, color[1] * 0.45 + 0.012, color[2] * 0.45 + 0.05], cut);
    color = mix3(color, disc, inner);
    // Thin hot rim so the silhouette stays crisp against the bloom.
    const rimRing = (1 - smoothstep(0, px * 2.2, Math.abs(sd - SUN_R))) * 0.55;
    color = [color[0] + rimRing, color[1] + rimRing * 0.55, color[2] + rimRing * 0.45];
  }

  // ── Ridgelines ────────────────────────────────────────────────────
  // Two ranges, the far one lighter so the silhouette has depth ordering
  // that survives a luminance-to-depth mapping. Crest heights depend only
  // on `u`, so the caller evaluates the noise once per column.
  if (v > farY - px * 2 && v < HORIZON) {
    const inFar = smoothstep(farY - px, farY + px, v);
    color = mix3(color, RIDGE_FAR, inFar * 0.94);
    // Rim light along the crest.
    const crest = (1 - smoothstep(0, px * 2.6, Math.abs(v - farY))) * 0.7;
    color = [color[0] + crest * 0.35, color[1] + crest * 0.62, color[2] + crest * 0.75];
  }
  if (v > nearY - px * 2 && v < HORIZON) {
    const inNear = smoothstep(nearY - px, nearY + px, v);
    color = mix3(color, RIDGE_NEAR, inNear);
    const crest = (1 - smoothstep(0, px * 2.2, Math.abs(v - nearY))) * 0.9;
    color = [color[0] + crest * 0.85, color[1] + crest * 0.30, color[2] + crest * 0.70];
  }

  // ── Horizon glow ──────────────────────────────────────────────────
  const hg = Math.exp(-Math.abs(v - HORIZON) * 240) * 0.9;
  color = [color[0] + hg * 0.85, color[1] + hg * 0.95, color[2] + hg];

  // ── Grid floor ────────────────────────────────────────────────────
  if (v > HORIZON) {
    const depth = (v - HORIZON) / (1 - HORIZON);   // 0 at horizon → 1 at bottom
    const persp = depth + 0.018;
    const floorBase = mix3(FLOOR_FAR, FLOOR_NEAR, smoothstep(0, 0.6, depth));
    let floor: [number, number, number] = [...floorBase] as [number, number, number];

    // Sun reflection column pooling on the plate.
    const refl = Math.exp(-Math.abs(u - SUN_X) * 6.5) * Math.exp(-depth * 2.4);
    floor = [floor[0] + refl * 0.55, floor[1] + refl * 0.10, floor[2] + refl * 0.28];

    // Lines that recede: coordinate ∝ 1/depth, AA width from its analytic
    // derivative so far lines dim out instead of aliasing.
    // Once a line's period shrinks below a couple of pixels it can only
    // alias, so each family is faded out by its own derivative rather than
    // left to speckle — a moiré band at the horizon would read as noise to
    // the edge-depth mode and as grit to the eye.
    const lineFade = (deriv: number) => 1 / (1 + deriv * 14 + deriv * deriv * 900);

    const rowC = 0.42 / persp;
    const rowDeriv = Math.abs((0.42 / (persp * persp)) * (px / (1 - HORIZON)));
    const rowD = Math.abs(rowC - Math.round(rowC));
    const rowLine = Math.max(0, 1 - rowD / (rowDeriv * 1.6 + 0.020)) * lineFade(rowDeriv);

    const colC = ((u - 0.5) / persp) * 0.72;
    const colDeriv = Math.abs((0.72 / persp) * px);
    const colD = Math.abs(colC - Math.round(colC));
    const colLine = Math.max(0, 1 - colD / (colDeriv * 1.6 + 0.020)) * lineFade(colDeriv);

    const grid = clamp01(rowLine + colLine);
    const gridColor = mix3(GRID_COOL, GRID_WARM, clamp01(rowLine * 0.85 + depth * 0.35));
    // Hold the lattice off the first slice under the horizon. Both line
    // families crowd together down there and their intersections beat into
    // a dotted moiré; letting distance haze eat them is both the honest
    // look and the clean one.
    const gridFade = smoothstep(0.012, 0.115, depth) * (0.55 + 0.45 * (1 - depth * 0.5));
    floor = [
      floor[0] + gridColor[0] * grid * gridFade,
      floor[1] + gridColor[1] * grid * gridFade,
      floor[2] + gridColor[2] * grid * gridFade,
    ];

    const seam = smoothstep(HORIZON - px, HORIZON + px, v);
    color = mix3(color, floor, seam);
  }

  // ── Vignette + gentle filmic knee ─────────────────────────────────
  const vdx = u - 0.5;
  const vdy = v - 0.5;
  const vr = Math.sqrt(vdx * vdx + vdy * vdy);
  const vig = 1 - smoothstep(0.45, 0.95, vr) * 0.30;
  return [
    clamp01(color[0] * vig) ** 0.94,
    clamp01(color[1] * vig) ** 0.94,
    clamp01(color[2] * vig) ** 0.94,
  ];
}

/**
 * Render the demo image to a packed RGBA buffer. Pure, deterministic,
 * DOM-free — the same bytes on every platform and in Node.
 */
export function renderDefaultGpuSourceImage(size: number = DEFAULT_GPU_SOURCE_SIZE): DefaultGpuSourceImage {
  const side = Math.max(16, Math.round(size));
  const rgba = new Uint8ClampedArray(side * side * 4);
  const px = 1 / side;
  // Ridge crests are a function of x alone — five noise octaves per pixel
  // for two ranges was over half the render cost. Evaluate per column.
  const farCrest = new Float64Array(side);
  const nearCrest = new Float64Array(side);
  for (let x = 0; x < side; x += 1) {
    const u = (x + 0.5) * px;
    farCrest[x] = HORIZON - 0.052 - ridge(u * 3.1 + 11.3, 3) * 0.115;
    nearCrest[x] = HORIZON - 0.014 - Math.abs(ridge(u * 4.7 + 41.7, 9)) * 0.135;
  }
  const stars = buildStarField();
  let o = 0;
  for (let y = 0; y < side; y += 1) {
    const v = (y + 0.5) * px;
    for (let x = 0; x < side; x += 1) {
      const u = (x + 0.5) * px;
      const c = shadeDemoPixel(u, v, px, farCrest[x], nearCrest[x], stars);
      rgba[o] = c[0] * 255;
      rgba[o + 1] = c[1] * 255;
      rgba[o + 2] = c[2] * 255;
      rgba[o + 3] = 255;
      o += 4;
    }
  }
  return { width: side, height: side, rgba };
}

let cachedImage: DefaultGpuSourceImage | null = null;

/** Cached accessor — the image is generated at most once per process. */
export function getDefaultGpuSourceImage(): DefaultGpuSourceImage {
  if (!cachedImage) cachedImage = renderDefaultGpuSourceImage();
  return cachedImage;
}

let cachedBitmap: ImageBitmap | HTMLCanvasElement | null = null;

/**
 * Browser-path handle for shaders that only accept a `CanvasImageSource`.
 * Shaders that implement `setSourceFromBytes` should use
 * `getDefaultGpuSourceImage()` directly and skip this entirely.
 */
export function getDefaultGpuSourceCanvas(): HTMLCanvasElement | ImageBitmap | null {
  if (cachedBitmap) return cachedBitmap;
  if (typeof document === 'undefined') return null;
  const image = getDefaultGpuSourceImage();
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const imageData = ctx.createImageData(image.width, image.height);
  imageData.data.set(image.rgba);
  ctx.putImageData(imageData, 0, 0);
  cachedBitmap = canvas;
  return cachedBitmap;
}

/** Test seam — drops the memoised image/canvas. */
export function resetDefaultGpuSourceCache(): void {
  cachedImage = null;
  cachedBitmap = null;
}
