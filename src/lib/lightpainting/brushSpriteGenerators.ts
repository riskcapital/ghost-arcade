/**
 * brushSpriteGenerators — one renderer per brush type that bakes its
 * per-stamp drawing into an offscreen bitmap. Called LAZILY by
 * `BrushSpriteCache` the first time a (params) combination is asked
 * for; the result is cached and reused for every subsequent stamp
 * with matching quantized params.
 *
 * Visual fidelity contract
 * ────────────────────────
 * Each generator MUST produce the same pixels the original
 * `drawXxxBrush` method in renderer.ts would draw if called at the
 * sprite's center with the given params. Differences:
 *
 *   - The sprite is drawn at the canvas's origin offset (centered in
 *     the bitmap so drawImage at `x - originX, y - originY` puts it
 *     on the stamp point).
 *   - Procedural brushes that originally used `Math.random()` now
 *     use a seeded RNG keyed by `variantIndex` so each variant is
 *     stable on re-render — no flicker on paused frames.
 *   - Time-driven brushes (flame, electric, ribbon, particle) embed
 *     time INTO the variant index. The cache holds N variants
 *     representing N phases of the animation cycle; the renderer
 *     picks which phase to draw based on the current elapsed time.
 *     Animation is therefore quantized to N=12 frames per cycle,
 *     which at 60fps gives ~5 unique frames per second of animation
 *     — fast enough to read as continuous motion.
 *
 * The original drawing math is preserved exactly. If you tweak a
 * brush's look, change BOTH the legacy method in renderer.ts AND
 * the generator here. (Or remove the legacy method entirely once
 * the cache path is verified — it's vestigial after this refactor.)
 */

import type { LightPaintingBrushType } from '../types';
import { BrushSpriteCache, makeCanvas, makeRng, type BrushSprite } from './brushSpriteCache';

/* ============================================================== */
/* Helpers                                                         */
/* ============================================================== */

/** Allocate a sprite canvas sized to fit the given world-space
 *  extent, with `pad` extra pixels on each edge to avoid clipping
 *  blur / shadow. Returns the canvas + its centered origin. */
function spriteOfRadius(radius: number, pad: number = 4): {
  canvas: OffscreenCanvas | HTMLCanvasElement;
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  cx: number;
  cy: number;
  size: number;
} {
  const size = Math.max(8, Math.ceil(radius * 2 + pad * 2));
  const { canvas, ctx } = makeCanvas(size, size);
  const cx = size / 2;
  const cy = size / 2;
  return { canvas, ctx, cx, cy, size };
}

/** Standard sprite return for sprites drawn centered. */
function centered(canvas: OffscreenCanvas | HTMLCanvasElement, size: number): BrushSprite {
  return { canvas, originX: size / 2, originY: size / 2, w: size, h: size };
}

/* ============================================================== */
/* SINGLE-SPRITE BRUSHES                                           */
/* ============================================================== */

/** glow — two concentric radial gradients: a wide soft halo + a
 *  bright white-tinted core. The original spec from drawGlowBrush. */
function makeGlow(
  size: number, r: number, g: number, b: number,
  glow: number, softness: number,
  _variantIndex: number,
): BrushSprite {
  const radius = size / 2;
  const glowRadius = radius * (1 + glow * 2);
  const { canvas, ctx, cx, cy, size: sz } = spriteOfRadius(glowRadius, 6);

  // Outer glow
  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowRadius);
  gradient.addColorStop(0, `rgba(${r},${g},${b},1)`);
  gradient.addColorStop(0.2, `rgba(${r},${g},${b},0.7)`);
  gradient.addColorStop(0.5, `rgba(${r},${g},${b},${0.3 * softness})`);
  gradient.addColorStop(1, `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(cx, cy, glowRadius, 0, Math.PI * 2);
  ctx.fill();

  // Bright core
  const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius * 0.5);
  coreGrad.addColorStop(0, 'rgba(255,255,255,0.9)');
  coreGrad.addColorStop(0.5, `rgba(${Math.min(255, r + 80)},${Math.min(255, g + 80)},${Math.min(255, b + 80)},0.5)`);
  coreGrad.addColorStop(1, `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = coreGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 0.5, 0, Math.PI * 2);
  ctx.fill();

  return centered(canvas, sz);
}

/** neon — bright fill with shadowBlur halo + hard white center.
 *  Note: shadowBlur is ALSO slow at draw-time, but baking it into
 *  the sprite means we pay the cost ONCE per (size, color, glow)
 *  combination instead of per stamp. */
function makeNeon(
  size: number, r: number, g: number, b: number,
  glow: number, _softness: number,
  _variantIndex: number,
): BrushSprite {
  const radius = size / 2;
  const shadowBlur = radius * glow * 3;
  const extent = radius + shadowBlur;
  const { canvas, ctx, cx, cy, size: sz } = spriteOfRadius(extent, 4);

  ctx.shadowColor = `rgba(${r},${g},${b},1)`;
  ctx.shadowBlur = shadowBlur;
  ctx.fillStyle = `rgba(${r},${g},${b},0.8)`;
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 0.6, 0, Math.PI * 2);
  ctx.fill();

  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 0.25, 0, Math.PI * 2);
  ctx.fill();

  return centered(canvas, sz);
}

/** laser — thin bright core + wide colored shadow halo. */
function makeLaser(
  size: number, r: number, g: number, b: number,
  glow: number, _softness: number,
  _variantIndex: number,
): BrushSprite {
  const radius = size * 0.15;
  const shadowBlur = size * glow;
  const extent = radius + shadowBlur;
  const { canvas, ctx, cx, cy, size: sz } = spriteOfRadius(extent, 4);

  ctx.shadowColor = `rgba(${r},${g},${b},1)`;
  ctx.shadowBlur = shadowBlur;
  ctx.fillStyle = 'rgba(255,255,255,1)';
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();

  return centered(canvas, sz);
}

/** calligraphy — flat ellipse at a fixed 45° nib angle. The angle
 *  reactivity (width modulated by stroke direction) happens at the
 *  RENDERER level by rotating the sprite, so we bake at zero
 *  rotation. */
function makeCalligraphy(
  size: number, r: number, g: number, b: number,
  _glow: number, _softness: number,
  _variantIndex: number,
): BrushSprite {
  // Use max possible width (full size, when stroke perpendicular to nib)
  // so the sprite never gets visually clipped. The renderer scales width
  // dynamically by the stroke-angle factor.
  const width = size;
  const height = size * 0.12;
  const extent = Math.max(width, height) / 2;
  const { canvas, ctx, cx, cy, size: sz } = spriteOfRadius(extent, 4);

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(Math.PI / 4); // 45° nib baked in
  ctx.fillStyle = `rgba(${r},${g},${b},1)`;
  ctx.beginPath();
  ctx.ellipse(0, 0, width / 2, height / 2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  return centered(canvas, sz);
}

/** marker — rounded rectangle, alpha 0.7. Drawn axis-aligned; the
 *  renderer rotates by stroke angle at draw time. */
function makeMarker(
  size: number, r: number, g: number, b: number,
  _glow: number, _softness: number,
  _variantIndex: number,
): BrushSprite {
  const width = size;
  const height = size * 0.25;
  const extent = Math.max(width, height) / 2;
  const { canvas, ctx, cx, cy, size: sz } = spriteOfRadius(extent, 4);

  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = `rgba(${r},${g},${b},0.7)`;
  const hw = width / 2, hh = height / 2, cr = Math.min(hh, 3);
  ctx.beginPath();
  ctx.moveTo(-hw + cr, -hh);
  ctx.lineTo(hw - cr, -hh);
  ctx.quadraticCurveTo(hw, -hh, hw, -hh + cr);
  ctx.lineTo(hw, hh - cr);
  ctx.quadraticCurveTo(hw, hh, hw - cr, hh);
  ctx.lineTo(-hw + cr, hh);
  ctx.quadraticCurveTo(-hw, hh, -hw, hh - cr);
  ctx.lineTo(-hw, -hh + cr);
  ctx.quadraticCurveTo(-hw, -hh, -hw + cr, -hh);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  return centered(canvas, sz);
}

/* ============================================================== */
/* VARIANT-BANK BRUSHES (time-driven)                              */
/* ============================================================== */

/** flame — warm radial gradient with sine-driven flicker. Each
 *  variant represents a different phase of the flicker cycle.
 *  variantIndex 0..VARIANTS_PER_BANK-1 maps to the time domain
 *  `t = (variantIndex / N) * 2π` so cycling through variants is
 *  smooth animation. */
function makeFlame(
  size: number, r: number, g: number, b: number,
  glow: number, _softness: number,
  variantIndex: number,
): BrushSprite {
  const rng = makeRng(variantIndex * 1337 + 1);
  const radius = size / 2;
  // Embed time INTO the variant: each index = a different phase.
  const t = (variantIndex / 12) * Math.PI * 8;  // 4 cycles per variant bank → busy flicker
  const flicker = 0.7
    + 0.3 * (Math.sin(t * 2.7) * 0.5 + 0.5)
    + 0.15 * (Math.sin(t * 5.3) * 0.5 + 0.5)
    + 0.15 * rng();
  const flickRadius = radius * flicker;
  const totalRadius = flickRadius * (1 + glow);
  const { canvas, ctx, cx, cy, size: sz } = spriteOfRadius(totalRadius, 6);

  const yOff = radius * 0.2 * Math.sin(t * 1.8);
  const gradient = ctx.createRadialGradient(cx, cy - yOff, 0, cx, cy, totalRadius);
  gradient.addColorStop(0, `rgba(255,255,200,${flicker})`);
  gradient.addColorStop(0.2, `rgba(${r},${Math.min(g + 50, 255)},${b},${0.8 * flicker})`);
  gradient.addColorStop(0.6, `rgba(${r},${Math.max(g - 50, 0)},0,${0.4 * flicker})`);
  gradient.addColorStop(1, `rgba(${Math.floor(r * 0.5)},0,0,0)`);
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(cx, cy, totalRadius, 0, Math.PI * 2);
  ctx.fill();

  return centered(canvas, sz);
}

/** electric — radiating spark lines + bright core. Each variant
 *  captures one frame of the spark animation. */
function makeElectric(
  size: number, r: number, g: number, b: number,
  glow: number, _softness: number,
  variantIndex: number,
): BrushSprite {
  const radius = size / 2;
  const t = (variantIndex / 12) * Math.PI * 8;
  // Spark extent — sparks reach up to `radius * (0.5 + glow * 0.5)` each.
  const maxSparkLen = radius * (0.5 + 1.0 * glow);
  const { canvas, ctx, cx, cy, size: sz } = spriteOfRadius(maxSparkLen, 4);

  ctx.strokeStyle = `rgba(${r},${g},${b},0.6)`;
  ctx.lineWidth = 1;
  const sparkCount = 3 + Math.floor(Math.sin(t * 1.3) + 1.5);
  for (let i = 0; i < sparkCount; i++) {
    const angle = (i / sparkCount) * Math.PI * 2 + Math.sin(t * 2.1 + i * 1.7) * 0.8;
    const lenMod = 0.5 + 0.5 * Math.sin(t * 3.7 + i * 2.3);
    const len = radius * (0.5 + lenMod * glow);
    const bend = Math.sin(t * 4.3 + i * 1.1) * 0.5;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    const mx = cx + Math.cos(angle + bend) * len * 0.5;
    const my = cy + Math.sin(angle + bend) * len * 0.5;
    ctx.quadraticCurveTo(mx, my, cx + Math.cos(angle) * len, cy + Math.sin(angle) * len);
    ctx.stroke();
  }

  const corePulse = 0.35 + 0.05 * Math.sin(t * 5);
  const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius * corePulse);
  coreGrad.addColorStop(0, 'rgba(255,255,255,1)');
  coreGrad.addColorStop(1, `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = coreGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, radius * corePulse, 0, Math.PI * 2);
  ctx.fill();

  return centered(canvas, sz);
}

/** ribbon — flat rectangle drawn at a rotation. The renderer
 *  applies stroke-angle rotation on top of this baked rotation.
 *  variantIndex picks the time phase of the rotation cycle. */
function makeRibbon(
  size: number, r: number, g: number, b: number,
  _glow: number, _softness: number,
  variantIndex: number,
): BrushSprite {
  const width = size;
  const height = size * 0.15;
  const extent = Math.max(width, height) / 2 + 4;
  const { canvas, ctx, cx, cy, size: sz } = spriteOfRadius(extent, 4);

  const t = variantIndex / 12;
  const rotAngle = t * Math.PI * 2;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rotAngle);
  const gradient = ctx.createLinearGradient(-width / 2, 0, width / 2, 0);
  gradient.addColorStop(0, `rgba(${r},${g},${b},0)`);
  gradient.addColorStop(0.3, `rgba(${r},${g},${b},1)`);
  gradient.addColorStop(0.7, `rgba(${r},${g},${b},1)`);
  gradient.addColorStop(1, `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = gradient;
  ctx.fillRect(-width / 2, -height / 2, width, height);
  ctx.restore();

  return centered(canvas, sz);
}

/** particle — cluster of orbiting glowing dots. Each variant is
 *  one moment in the orbital animation. */
function makeParticle(
  size: number, r: number, g: number, b: number,
  glow: number, _softness: number,
  variantIndex: number,
): BrushSprite {
  const t = (variantIndex / 12) * Math.PI * 6;
  const maxDist = size * 0.5;
  const maxParticleSize = 1 + size * 0.15;
  const extent = maxDist + maxParticleSize * (1 + glow);
  const { canvas, ctx, cx, cy, size: sz } = spriteOfRadius(extent, 4);

  const count = 3 + Math.floor(Math.sin(t * 1.7) * 2 + 2);
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + Math.sin(t * 2.3 + i * 1.1) * 1.5;
    const dist = (0.3 + 0.7 * Math.abs(Math.sin(t * 1.9 + i * 2.7))) * maxDist;
    const px = cx + Math.cos(angle) * dist;
    const py = cy + Math.sin(angle) * dist;
    const psize = 1 + Math.abs(Math.sin(t * 3.1 + i * 0.8)) * size * 0.15;
    const radius = psize * (1 + glow);

    const grad = ctx.createRadialGradient(px, py, 0, px, py, radius);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.3, `rgba(${r},${g},${b},0.8)`);
    grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(px, py, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  return centered(canvas, sz);
}

/* ============================================================== */
/* VARIANT-BANK BRUSHES (stamp-random)                             */
/* ============================================================== */

/** smoke — soft wide radial gradient with a small random center
 *  offset. variantIndex seeds the offset. */
function makeSmoke(
  size: number, r: number, g: number, b: number,
  _glow: number, softness: number,
  variantIndex: number,
): BrushSprite {
  const rng = makeRng(variantIndex * 7919 + 2);
  const radius = size / 2;
  const smokeRadius = radius * (1 + softness * 3);
  const offX = (rng() - 0.5) * size * 0.3;
  const offY = (rng() - 0.5) * size * 0.3;
  const extent = smokeRadius + Math.max(Math.abs(offX), Math.abs(offY)) + 4;
  const { canvas, ctx, cx, cy, size: sz } = spriteOfRadius(extent, 4);

  const gradient = ctx.createRadialGradient(cx + offX, cy + offY, 0, cx + offX, cy + offY, smokeRadius);
  gradient.addColorStop(0, `rgba(${r},${g},${b},0.3)`);
  gradient.addColorStop(0.4, `rgba(${r},${g},${b},0.15)`);
  gradient.addColorStop(1, `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(cx + offX, cy + offY, smokeRadius, 0, Math.PI * 2);
  ctx.fill();

  return centered(canvas, sz);
}

/** spray — Gaussian-distributed dots. variantIndex seeds the
 *  scatter pattern. */
function makeSpray(
  size: number, r: number, g: number, b: number,
  _glow: number, softness: number,
  variantIndex: number,
): BrushSprite {
  const rng = makeRng(variantIndex * 7333 + 3);
  const radius = size / 2;
  const density = Math.min(40, 15 + Math.floor(size * 0.5));
  const spread = 0.3 + softness * 0.7;
  const { canvas, ctx, cx, cy, size: sz } = spriteOfRadius(radius, 4);

  ctx.fillStyle = `rgba(${r},${g},${b},0.15)`;
  for (let i = 0; i < density; i++) {
    const u1 = rng();
    const u2 = rng();
    const mag = radius * spread * Math.sqrt(-2 * Math.log(Math.max(u1, 0.001)));
    const a = 2 * Math.PI * u2;
    const dx = mag * Math.cos(a);
    const dy = mag * Math.sin(a);
    if (Math.sqrt(dx * dx + dy * dy) > radius) continue;
    const dotSize = 0.5 + rng() * 1.5;
    ctx.beginPath();
    ctx.arc(cx + dx, cy + dy, dotSize, 0, Math.PI * 2);
    ctx.fill();
  }

  return centered(canvas, sz);
}

/** paintbrush — row of jittered bristle dots. The renderer rotates
 *  the sprite by stroke angle; the sprite is baked with bristles
 *  arranged along the X axis (perpendicular to a horizontal stroke). */
function makePaintbrush(
  size: number, r: number, g: number, b: number,
  _glow: number, softness: number,
  variantIndex: number,
): BrushSprite {
  const rng = makeRng(variantIndex * 5557 + 4);
  const bristleCount = 5 + Math.floor(size * 0.15);
  // Bristles extend ±size/2 perpendicular to the stroke; jitter ±10%.
  const maxOffset = size / 2 + size * 0.1 + 4;
  const { canvas, ctx, cx, cy, size: sz } = spriteOfRadius(maxOffset, 4);

  for (let i = 0; i < bristleCount; i++) {
    const t = (i / (bristleCount - 1)) - 0.5;
    const offset = t * size;
    const jitter = (rng() - 0.5) * size * 0.1;
    // Bristles laid out along the local X axis (the "across" direction).
    const bx = cx + (offset + jitter);
    const by = cy + (rng() - 0.5) * size * 0.05;
    const bristleAlpha = (0.3 + 0.7 * (1 - Math.abs(t) * 2));
    const bristleSize = 1 + rng() * 2;

    ctx.fillStyle = `rgba(${r},${g},${b},${bristleAlpha * (0.3 + softness * 0.7)})`;
    ctx.beginPath();
    ctx.arc(bx, by, bristleSize, 0, Math.PI * 2);
    ctx.fill();
  }

  return centered(canvas, sz);
}

/** watercolor — three wobbly translucent radial gradients stacked.
 *  variantIndex seeds both the offsets and the wobble. */
function makeWatercolor(
  size: number, r: number, g: number, b: number,
  _glow: number, softness: number,
  variantIndex: number,
): BrushSprite {
  const rng = makeRng(variantIndex * 4421 + 5);
  const radius = size / 2;
  const maxSpread = radius * (1 + 2 * 0.4 * softness);
  // Wobble can extend up to ~1.15× spread.
  const extent = maxSpread * 1.2 + size * 0.2;
  const { canvas, ctx, cx, cy, size: sz } = spriteOfRadius(extent, 4);

  for (let layer = 0; layer < 3; layer++) {
    const spread = radius * (1 + layer * 0.4 * softness);
    const ox = (rng() - 0.5) * size * 0.2;
    const oy = (rng() - 0.5) * size * 0.2;
    const layerAlpha = (0.08 - layer * 0.02);

    const grad = ctx.createRadialGradient(
      cx + ox, cy + oy, spread * 0.3,
      cx + ox, cy + oy, spread,
    );
    grad.addColorStop(0, `rgba(${r},${g},${b},${layerAlpha})`);
    grad.addColorStop(0.6, `rgba(${r},${g},${b},${layerAlpha * 0.5})`);
    grad.addColorStop(0.8, `rgba(${r},${g},${b},${layerAlpha * 0.2})`);
    grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    const segments = 12;
    for (let s = 0; s <= segments; s++) {
      const a = (s / segments) * Math.PI * 2;
      const wobble = spread * (0.85 + rng() * 0.3);
      const px = cx + ox + Math.cos(a) * wobble;
      const py = cy + oy + Math.sin(a) * wobble;
      if (s === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  }

  return centered(canvas, sz);
}

/* ============================================================== */
/* Registry — one-shot register-all helper                         */
/* ============================================================== */
export function registerAllBrushGenerators(cache: BrushSpriteCache): void {
  const generators: Array<[LightPaintingBrushType, (s: number, r: number, g: number, b: number, glow: number, soft: number, vi: number) => BrushSprite]> = [
    // Single-sprite
    ['glow', makeGlow],
    ['neon', makeNeon],
    ['laser', makeLaser],
    ['calligraphy', makeCalligraphy],
    ['marker', makeMarker],
    // Variant bank (time-driven)
    ['flame', makeFlame],
    ['electric', makeElectric],
    ['ribbon', makeRibbon],
    ['particle', makeParticle],
    // Variant bank (stamp-random)
    ['smoke', makeSmoke],
    ['spray', makeSpray],
    ['paintbrush', makePaintbrush],
    ['watercolor', makeWatercolor],
  ];
  for (const [type, gen] of generators) {
    cache.registerGenerator(type, gen);
  }
}
