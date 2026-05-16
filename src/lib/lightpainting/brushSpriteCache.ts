/**
 * brushSpriteCache — pre-rendered brush stamps for the light-painting
 * renderer's hot path.
 *
 * Why this exists
 * ───────────────
 * The original `drawBrushPoint` allocated 1-5 `createRadialGradient`
 * objects per stamped point. With ~800 points per stroke and 20+
 * strokes accumulated, that's tens of thousands of gradient
 * allocations per frame. Chromium's Skia-on-Windows Canvas2D handles
 * this poorly compared to macOS — a 5600X + RTX 3070 user reported
 * 5fps drawing the same content a 2019 Intel Mac handled smoothly.
 *
 * The fix is the standard painting-app technique: bake each brush
 * stamp into a small offscreen bitmap ONCE, then `drawImage` it for
 * every stamp on the hot path. `drawImage` of a pre-rendered
 * `OffscreenCanvas` is ~100× faster than `createRadialGradient + fill`
 * on every browser/OS combo because the browser blits a cached
 * texture without allocating.
 *
 * Single vs. variant-bank brushes
 * ───────────────────────────────
 * Five brushes are fully deterministic — same params produce the same
 * pixel output every stamp. Those get **one sprite per (params)** key:
 *   glow, neon, laser, calligraphy, marker
 *
 * Eight brushes have per-stamp randomness or time-driven animation.
 * For those we pre-render a **bank of N variants** (default 12) and
 * cycle through them per stamp. The variation is seeded so each
 * variant is stable across renders — you don't get flicker on paused
 * frames, but you also don't get visible repetition on long strokes
 * (12 variants × random index = no perceptible pattern):
 *   flame, electric, ribbon, particle, smoke, spray, paintbrush,
 *   watercolor
 *
 * Cache key + LRU
 * ───────────────
 * Quantized key on (brushType, size_bucket, r, g, b, glow_bucket,
 * softness_bucket, variantIndex). Size is bucketed to 2-px increments,
 * color is kept full 8-bit (32M possible colors but in practice users
 * pick a handful per session), glow / softness bucketed to 8 levels.
 *
 * The cache has a hard LRU bound — default 256 entries (counting each
 * variant individually). Worst-case memory: ~256 sprites × ~32KB avg
 * = ~8MB. Easily within budget.
 */

import type { LightPaintingBrush, LightPaintingBrushType } from '../types';

/* ============================================================== */
/* Constants                                                       */
/* ============================================================== */

const VARIANTS_PER_BANK = 12;
const SIZE_BUCKET = 2;       // round size to nearest 2px
const GLOW_BUCKETS = 8;      // 0..1 → 0..7
const SOFTNESS_BUCKETS = 8;
const MAX_CACHE_ENTRIES = 256;

/** Brush types that use a single sprite (deterministic output). */
const SINGLE_SPRITE_BRUSHES = new Set<LightPaintingBrushType>([
  'glow', 'neon', 'laser', 'calligraphy', 'marker',
]);

/** Brush types whose variation is driven by elapsed time (not random).
 *  For these, variantIndex is `floor(time * speed * 8) % N` so the
 *  animation evolves smoothly as time advances. */
const TIME_DRIVEN_BRUSHES = new Set<LightPaintingBrushType>([
  'flame', 'electric', 'ribbon', 'particle',
]);

/** Brush types whose variation is per-stamp random — variant should
 *  be picked by stamp index (deterministic but distributed) so the
 *  cloud of stamps along a stroke shows visual variety while staying
 *  stable on re-render. */
// Inferred: ('smoke', 'spray', 'paintbrush', 'watercolor')

/** Brush types that consume a stroke-direction angle. The sprite is
 *  rendered axis-aligned; the renderer applies rotation via translate
 *  + rotate before drawImage. */
const ANGLE_DEPENDENT_BRUSHES = new Set<LightPaintingBrushType>([
  'calligraphy', 'marker', 'paintbrush',
]);

export function brushUsesAngle(type: LightPaintingBrushType): boolean {
  return ANGLE_DEPENDENT_BRUSHES.has(type);
}

export function brushIsTimeDriven(type: LightPaintingBrushType): boolean {
  return TIME_DRIVEN_BRUSHES.has(type);
}

export function brushIsSingleSprite(type: LightPaintingBrushType): boolean {
  return SINGLE_SPRITE_BRUSHES.has(type);
}

/** Per-brush sprite generator signature. Each generator returns a
 *  rendered offscreen canvas plus the origin offset that maps "stamp
 *  center" → bitmap (x, y). For symmetric brushes origin is the
 *  center; for asymmetric ones (flame's upward bias) the origin may
 *  shift. */
export interface BrushSprite {
  /** The pre-rendered offscreen canvas. */
  canvas: OffscreenCanvas | HTMLCanvasElement;
  /** Distance from the canvas's (0,0) corner to the brush's "stamp
   *  center" — what you'd pass as the `x, y` argument to drawImage
   *  so the sprite lands centered on the stamp position. */
  originX: number;
  originY: number;
  /** Pixel width / height of the sprite canvas. */
  w: number;
  h: number;
}

type SpriteGenerator = (
  size: number,
  r: number, g: number, b: number,
  glow: number, softness: number,
  variantIndex: number,
) => BrushSprite;

/* ============================================================== */
/* Seeded RNG (Mulberry32) — replaces Math.random in generators   */
/* ============================================================== */
// Generators need reproducible randomness per variant, otherwise
// regenerating the same (variantIndex) gives different output every
// time and the cache is useless. Mulberry32 is small, fast, and
// passes basic statistical tests — perfect for visual randomness.
function makeRng(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ============================================================== */
/* Cache key generation                                            */
/* ============================================================== */
function quantizeSize(size: number): number {
  return Math.max(1, Math.round(size / SIZE_BUCKET) * SIZE_BUCKET);
}
function quantizeUnit(v: number, buckets: number): number {
  return Math.max(0, Math.min(buckets - 1, Math.floor(v * buckets)));
}

function cacheKey(
  type: LightPaintingBrushType,
  size: number,
  r: number, g: number, b: number,
  glow: number, softness: number,
  variantIndex: number,
): string {
  // Single string is faster to hash than nested maps in V8 for the
  // expected key cardinality (~hundreds, not millions).
  return `${type}|${quantizeSize(size)}|${r}|${g}|${b}|${quantizeUnit(glow, GLOW_BUCKETS)}|${quantizeUnit(softness, SOFTNESS_BUCKETS)}|${variantIndex}`;
}

/* ============================================================== */
/* The cache itself                                                */
/* ============================================================== */

export class BrushSpriteCache {
  private cache = new Map<string, BrushSprite>();
  private generators = new Map<LightPaintingBrushType, SpriteGenerator>();

  registerGenerator(type: LightPaintingBrushType, gen: SpriteGenerator): void {
    this.generators.set(type, gen);
  }

  /** Number of variants pre-rendered for a procedural brush. Single-
   *  sprite brushes always have 1 "variant" (index 0). */
  variantsFor(type: LightPaintingBrushType): number {
    return SINGLE_SPRITE_BRUSHES.has(type) ? 1 : VARIANTS_PER_BANK;
  }

  /** Pick a variant index based on the current animation context.
   *  - Time-driven brushes (flame, electric, ribbon, particle): index
   *    derived from `time * speed` so animation evolves smoothly.
   *  - Stamp-driven random brushes (smoke, spray, paintbrush,
   *    watercolor): index derived from `stampIndex` so each point
   *    gets a different sprite without time-flicker on paused frames.
   *  - Single-sprite brushes always return 0. */
  variantIndex(
    type: LightPaintingBrushType,
    stampIndex: number,
    timeS: number,
    speed: number,
  ): number {
    if (SINGLE_SPRITE_BRUSHES.has(type)) return 0;
    if (TIME_DRIVEN_BRUSHES.has(type)) {
      return Math.floor(timeS * Math.max(0.001, speed) * 8) % VARIANTS_PER_BANK;
    }
    // Random per-stamp brushes: a prime multiplier scatters indices.
    return (stampIndex * 73856093) >>> 0 & (VARIANTS_PER_BANK - 1);
  }

  /** Fetch (or lazily generate) a sprite for the given brush params
   *  + variant. Returns null if no generator is registered for the
   *  brush type — caller should fall back to the legacy code path.
   *
   *  The brush color is taken from `brush.color` directly. Size is
   *  the EFFECTIVE size after pressure + taper (caller has already
   *  applied those multipliers). */
  getSprite(
    brush: LightPaintingBrush,
    effectiveSize: number,
    variantIndex: number,
  ): BrushSprite | null {
    const [r, g, b] = brush.color;
    const key = cacheKey(brush.type, effectiveSize, r, g, b, brush.glow, brush.softness, variantIndex);
    let s = this.cache.get(key);
    if (s) {
      // LRU touch: re-insert moves to the end of the Map's iteration order.
      this.cache.delete(key);
      this.cache.set(key, s);
      return s;
    }
    const gen = this.generators.get(brush.type);
    if (!gen) return null;
    s = gen(quantizeSize(effectiveSize), r, g, b, brush.glow, brush.softness, variantIndex);
    this.cache.set(key, s);
    // Evict the oldest entry if we're over the LRU budget.
    if (this.cache.size > MAX_CACHE_ENTRIES) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) this.cache.delete(oldestKey);
    }
    return s;
  }

  /** Wipe the cache. Called when the canvas resizes (sprite sizes
   *  may have shifted relative to the new DPR) or when the user
   *  edits a brush param that affects every variant. */
  clear(): void {
    this.cache.clear();
  }

  /** Diagnostics. */
  size(): number {
    return this.cache.size;
  }
}

/* ============================================================== */
/* Canvas helper — works in Worker AND main thread                */
/* ============================================================== */
export function makeCanvas(w: number, h: number): { canvas: OffscreenCanvas | HTMLCanvasElement; ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D } {
  // OffscreenCanvas is universally supported in modern Chromium /
  // Firefox / Safari (all our targets) — but typescript-DOM is
  // picky about the discriminator, so we widen the type.
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D;
    return { canvas, ctx };
  }
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  return { canvas, ctx };
}

/* ============================================================== */
/* Seeded RNG export — generators use this for reproducible variants */
/* ============================================================== */
export { makeRng };
