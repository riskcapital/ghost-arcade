// Light Painting Renderer
// Renders animated light trail strokes to a Canvas2D texture
// Uses additive blending and glow effects for long-exposure light painting look

import * as THREE from 'three';
import type {
  LightPaintingContent,
  LightPaintingStroke,
  LightPaintingBrush,
} from '../types';
import { BrushSpriteCache, brushUsesAngle } from './brushSpriteCache';
import { registerAllBrushGenerators } from './brushSpriteGenerators';

// Local-midnight wall-clock anchor used to derive `animationTime` from
// Date.now(). Any process on the same machine computes the same value, so
// renderer instances in the main viewport and the output window stay in
// lock-step instead of drifting based on when each was constructed.
const LP_TIME_ANCHOR_MS = (() => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
})();

const TIGHT_STAMP_BRUSH_TYPES = new Set(['calligraphy', 'paintbrush', 'marker', 'ribbon']);
const LINE_BRUSH_TYPES = new Set(['glow', 'neon', 'laser']);

export class LightPaintingRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private texture: THREE.CanvasTexture;
  private width: number;
  private height: number;

  // Animation state
  private animationTime = 0;        // Current time in ms
  private totalDuration = 0;        // Total animation duration
  // direction and lastFrameTime reserved for future pingpong playback

  // Persistence buffer for afterglow effect
  private persistCanvas: HTMLCanvasElement;
  private persistCtx: CanvasRenderingContext2D;

  // Bloom buffer
  private bloomCanvas: HTMLCanvasElement;
  private bloomCtx: CanvasRenderingContext2D;

  // Full-size stroke buffer used to apply echo copies without re-stamping
  // every brush point for every echo layer.
  private strokeCanvas: HTMLCanvasElement;
  private strokeCtx: CanvasRenderingContext2D;

  // Static render cache. Canvas.svelte still asks every frame, but paused
  // light-painting layers only need a redraw when their content object changes.
  private staticCacheContent: LightPaintingContent | null = null;
  private staticCacheWidth = 0;
  private staticCacheHeight = 0;

  // Sprite cache — the big perf win. Pre-renders each brush stamp into
  // an offscreen bitmap once per (quantized params + variant) tuple,
  // then drawImage's it for every stamp on the hot path. Eliminates
  // ~95% of `createRadialGradient` + `fill` calls that previously
  // dominated frame time on Windows/Chromium.
  private brushCache = new BrushSpriteCache();

  // Per-frame perf probe. Reset at start of render(), accumulated by
  // drawBrushPoint, surfaced via getPerfStats() for the diagnostics
  // pill. Probe is essentially free (~5 integer increments per stamp).
  private perfStampCount = 0;
  private perfSpriteHits = 0;
  private perfSpriteMisses = 0;
  private perfFallbackPath = 0;
  private perfLastRenderMs = 0;
  // Tracks which stamp index along a stroke we're currently rendering,
  // used by the sprite cache to pick a deterministic variant for
  // stamp-random brushes (smoke, spray, paintbrush, watercolor) so
  // each stamp gets a different sprite without re-render flicker.
  private currentStampIndex = 0;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;

    // Main render canvas
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: false })!;

    // Persistence canvas (for afterglow/trail fade)
    this.persistCanvas = document.createElement('canvas');
    this.persistCanvas.width = width;
    this.persistCanvas.height = height;
    this.persistCtx = this.persistCanvas.getContext('2d')!;

    // Bloom canvas (for glow post-process)
    this.bloomCanvas = document.createElement('canvas');
    this.bloomCanvas.width = Math.floor(width / 4);
    this.bloomCanvas.height = Math.floor(height / 4);
    this.bloomCtx = this.bloomCanvas.getContext('2d')!;

    // Stroke buffer canvas (full size so drawImage echo copies are cheap)
    this.strokeCanvas = document.createElement('canvas');
    this.strokeCanvas.width = width;
    this.strokeCanvas.height = height;
    this.strokeCtx = this.strokeCanvas.getContext('2d')!;

    // Create Three.js texture
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.format = THREE.RGBAFormat;

    // Wire up brush sprite generators once. The cache is sized for a
    // typical session (~hundreds of unique brush states) and evicts
    // LRU — won't grow unbounded.
    registerAllBrushGenerators(this.brushCache);
  }

  /**
   * Perf probe snapshot — used by the diagnostics pill / DevTools.
   * Returns the LAST FRAME's render time + stamp counts.
   */
  getPerfStats(): {
    renderMs: number;
    stampCount: number;
    spriteHits: number;
    spriteMisses: number;
    fallbackPath: number;
    cacheSize: number;
  } {
    return {
      renderMs: this.perfLastRenderMs,
      stampCount: this.perfStampCount,
      spriteHits: this.perfSpriteHits,
      spriteMisses: this.perfSpriteMisses,
      fallbackPath: this.perfFallbackPath,
      cacheSize: this.brushCache.size(),
    };
  }

  /**
   * Expose the underlying canvas — used by mobile clients to mirror the
   * drawing surface without needing a THREE.js context.
   */
  getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  resize(width: number, height: number) {
    if (this.width === width && this.height === height) return;
    this.width = width;
    this.height = height;
    this.canvas.width = width;
    this.canvas.height = height;
    this.persistCanvas.width = width;
    this.persistCanvas.height = height;
    this.bloomCanvas.width = Math.floor(width / 4);
    this.bloomCanvas.height = Math.floor(height / 4);
    this.strokeCanvas.width = width;
    this.strokeCanvas.height = height;
    this.invalidateStaticCache();
  }

  private invalidateStaticCache() {
    this.staticCacheContent = null;
    this.staticCacheWidth = 0;
    this.staticCacheHeight = 0;
  }

  private canUseStaticCache(content: LightPaintingContent): boolean {
    return !content.isPlaying;
  }

  private isStaticCacheHit(content: LightPaintingContent): boolean {
    return this.canUseStaticCache(content)
      && this.staticCacheContent === content
      && this.staticCacheWidth === this.width
      && this.staticCacheHeight === this.height;
  }

  private markStaticCache(content: LightPaintingContent) {
    if (!this.canUseStaticCache(content)) {
      this.invalidateStaticCache();
      return;
    }
    this.staticCacheContent = content;
    this.staticCacheWidth = this.width;
    this.staticCacheHeight = this.height;
  }

  /**
   * Calculate total animation duration based on content settings
   */
  private calculateTotalDuration(
    content: LightPaintingContent,
    visibleStrokes: LightPaintingStroke[]
  ): number {
    if (visibleStrokes.length === 0) return 0;

    if (content.staggerStrokes) {
      // Staggered: each stroke starts after the previous one + delay
      let total = 0;
      for (const stroke of visibleStrokes) {
        total += (stroke.duration / content.drawSpeed) + content.staggerDelay;
      }
      return total;
    } else {
      // Simultaneous: duration is the longest stroke
      let max = 0;
      for (const stroke of visibleStrokes) {
        max = Math.max(max, stroke.duration / content.drawSpeed);
      }
      return max;
    }
  }

  private calculateStrokeStartTimes(
    visibleStrokes: LightPaintingStroke[],
    content: LightPaintingContent
  ): number[] {
    const startTimes = new Array(visibleStrokes.length).fill(0);
    if (!content.staggerStrokes) return startTimes;

    let offset = 0;
    for (let i = 0; i < visibleStrokes.length; i++) {
      const stroke = visibleStrokes[i];
      startTimes[i] = offset;
      offset += (stroke.duration / content.drawSpeed) + content.staggerDelay;
    }
    return startTimes;
  }

  private hashString(value: string): number {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i++) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  private hashToUnit(value: string | number): number {
    const hash = typeof value === 'number' ? value >>> 0 : this.hashString(value);
    return ((hash ^ (hash >>> 16)) >>> 0) / 4294967295;
  }

  private seededRandom(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
      state = (Math.imul(1664525, state) + 1013904223) >>> 0;
      return state / 4294967296;
    };
  }

  private getStrokeCenter(stroke: LightPaintingStroke): { x: number; y: number } {
    if (stroke.points.length === 0) return { x: 0.5, y: 0.5 };
    let sx = 0;
    let sy = 0;
    for (const point of stroke.points) {
      sx += point.x;
      sy += point.y;
    }
    return { x: sx / stroke.points.length, y: sy / stroke.points.length };
  }

  private getLoopCycleDuration(duration: number, content: LightPaintingContent): number {
    if (duration <= 0) return 1;
    if (content.loopMode === 'pingpong') {
      const hold = Math.max(0, content.pingPongHold ?? 0);
      return duration * 2 + hold * 2;
    }
    return duration;
  }

  private getSequenceCycleIndex(rawTime: number, duration: number, content: LightPaintingContent): number {
    if (content.loopMode === 'once') return 0;
    return Math.max(0, Math.floor(rawTime / this.getLoopCycleDuration(duration, content)));
  }

  private orderVisibleStrokes(
    visibleStrokes: LightPaintingStroke[],
    content: LightPaintingContent,
    cycleIndex: number
  ): LightPaintingStroke[] {
    const mode = content.sequenceMode ?? 'recorded';
    if (mode === 'recorded' || visibleStrokes.length <= 1) return visibleStrokes;

    const ordered = visibleStrokes.slice();
    switch (mode) {
      case 'random': {
        const seed = ((content.randomSequenceSeed ?? 1337) + cycleIndex * 1013904223) >>> 0;
        const rand = this.seededRandom(seed);
        for (let i = ordered.length - 1; i > 0; i--) {
          const j = Math.floor(rand() * (i + 1));
          [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
        }
        return ordered;
      }
      case 'alternating': {
        const result: LightPaintingStroke[] = [];
        let left = 0;
        let right = ordered.length - 1;
        while (left <= right) {
          result.push(ordered[left++]);
          if (left <= right) result.push(ordered[right--]);
        }
        return result;
      }
      case 'bottomUp':
        return ordered.sort((a, b) => this.getStrokeCenter(b).y - this.getStrokeCenter(a).y);
      case 'topDown':
        return ordered.sort((a, b) => this.getStrokeCenter(a).y - this.getStrokeCenter(b).y);
      case 'centerOut':
      case 'outsideIn': {
        const distanceFromCenter = (stroke: LightPaintingStroke) => {
          const c = this.getStrokeCenter(stroke);
          const dx = c.x - 0.5;
          const dy = c.y - 0.5;
          return dx * dx + dy * dy;
        };
        return ordered.sort((a, b) => {
          const delta = distanceFromCenter(a) - distanceFromCenter(b);
          return mode === 'centerOut' ? delta : -delta;
        });
      }
      default:
        return ordered;
    }
  }

  /**
   * Get the animation progress for a stroke (0 = not started, 1 = fully drawn)
   */
  private getStrokeProgress(
    stroke: LightPaintingStroke,
    content: LightPaintingContent,
    currentTime: number,
    strokeStart: number
  ): number {
    const strokeDuration = stroke.duration / content.drawSpeed;

    const elapsed = currentTime - strokeStart;
    if (elapsed <= 0) return 0;
    if (strokeDuration <= 0) return 1;
    return Math.min(1, elapsed / strokeDuration);
  }

  /**
   * Apply loop mode to get the effective animation time
   */
  private getLoopedTime(rawTime: number, duration: number, content: LightPaintingContent): number {
    if (duration <= 0) return 0;
    const mode = content.loopMode;
    if (mode === 'once') return Math.min(rawTime, duration);

    if (mode === 'forward') {
      return rawTime % duration;
    }

    if (mode === 'reverse') {
      return duration - (rawTime % duration);
    }

    if (mode === 'pingpong') {
      const hold = Math.max(0, content.pingPongHold ?? 0);
      const cycle = rawTime % (duration * 2 + hold * 2);
      if (cycle <= duration) return cycle;
      if (cycle <= duration + hold) return duration;
      if (cycle <= duration + hold + duration) {
        return duration - (cycle - duration - hold);
      }
      return 0;
    }

    return rawTime % duration;
  }

  private getAnimatedPointPosition(
    stroke: LightPaintingStroke,
    point: { x: number; y: number },
    content: LightPaintingContent | null,
    strokeProgress: number
  ): { x: number; y: number } {
    let x = point.x * this.width;
    let y = point.y * this.height;
    const sway = content?.isPlaying ? (content.windSway ?? 0) : 0;
    if (content && sway > 0) {
      const timeS = this.animationTime / 1000;
      const phase = this.hashToUnit(stroke.id) * Math.PI * 2;
      const speed = Math.max(0.05, content.windSpeed ?? 1);
      const scale = Math.max(0.1, content.windScale ?? 2);
      const anchor = Math.max(0, Math.min(1, content.windAnchor ?? 0.7));
      const topWeight = Math.pow(1 - point.y, 1.35);
      const anchorWeight = (1 - anchor) + anchor * topWeight;
      const amp = sway * Math.min(this.width, this.height) * 0.045 * anchorWeight;
      const wave = Math.sin(timeS * speed * Math.PI * 2 + point.y * scale * Math.PI * 2 + phase);
      const detail = Math.sin(timeS * speed * Math.PI * 3.1 + point.x * scale * Math.PI * 2 - phase) * 0.35;
      x += (wave + detail) * amp;
      y += Math.cos(timeS * speed * Math.PI * 1.3 + strokeProgress * Math.PI * 2 + phase) * amp * 0.18;
    }
    return { x, y };
  }

  private getFlowPulseMultiplier(
    stroke: LightPaintingStroke,
    content: LightPaintingContent | null,
    strokeProgress: number
  ): number {
    const amount = content?.isPlaying ? (content.flowPulse ?? 0) : 0;
    if (!content || amount <= 0) return 1;
    const phase = this.hashToUnit(stroke.id) * 0.23;
    const speed = Math.max(0.05, content.flowSpeed ?? 1);
    const width = Math.max(0.02, content.flowWidth ?? 0.12);
    const head = ((this.animationTime / 1000) * speed * 0.25 + phase) % 1;
    const dist = Math.abs(strokeProgress - head);
    const wrappedDist = Math.min(dist, 1 - dist);
    const pulse = Math.exp(-(wrappedDist * wrappedDist) / (2 * width * width));
    return 1 + pulse * amount * 1.8;
  }

  /**
   * Draw a single brush point at the given position
   */
  private drawBrushPoint(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    brush: LightPaintingBrush,
    pressure: number,
    progress: number, // 0-1 along stroke for taper
    angle: number = 0,  // stroke direction in radians
    timeS: number = 0,  // elapsed time in seconds (for animated brushes)
    opacityScale: number = 1
  ) {
    const size = brush.size * (brush.pressureSensitive ? pressure : 1);

    // Apply taper
    let taperMult = 1;
    if (brush.taper) {
      const taperIn = Math.min(1, progress * 5);   // Quick fade in
      const taperOut = Math.min(1, (1 - progress) * 5); // Quick fade out
      taperMult = taperIn * taperOut;
    }

    const finalSize = Math.max(1, size * taperMult);
    const [r, g, b] = brush.color;
    const alpha = Math.max(0, Math.min(1, brush.opacity * taperMult * opacityScale));

    // Apply jitter
    let jx = x, jy = y;
    if (brush.jitter > 0) {
      jx += (Math.random() - 0.5) * brush.jitter * brush.size * 2;
      jy += (Math.random() - 0.5) * brush.jitter * brush.size * 2;
    }

    this.perfStampCount++;

    // ── Sprite cache fast path ─────────────────────────────────
    // The cache pre-renders this brush's stamp into an OffscreenCanvas
    // keyed by quantized (brushType, size, color, glow, softness) +
    // variantIndex. Reduces every stamp to a single drawImage call.
    // For procedural brushes (smoke, spray, etc.) the variant index
    // distributes stamps across N pre-rendered variations so the
    // stroke retains visual variety. For time-driven brushes (flame,
    // electric, ribbon, particle) the variant tracks the animation
    // phase.
    const variantIdx = this.brushCache.variantIndex(
      brush.type,
      this.currentStampIndex,
      timeS,
      brush.speed ?? 1,
    );
    const sprite = this.brushCache.getSprite(brush, finalSize, variantIdx);

    if (sprite) {
      this.perfSpriteHits++;
      ctx.save();
      ctx.globalAlpha *= alpha;
      // Angle-dependent brushes (calligraphy, marker, paintbrush)
      // need the sprite rotated by the stroke direction; the sprite
      // is baked in canonical orientation.
      if (brushUsesAngle(brush.type)) {
        ctx.translate(jx, jy);
        ctx.rotate(angle);
        ctx.drawImage(sprite.canvas as any, -sprite.originX, -sprite.originY);
      } else {
        ctx.drawImage(sprite.canvas as any, jx - sprite.originX, jy - sprite.originY);
      }
      ctx.restore();
      return;
    }

    // ── Fallback: legacy per-stamp gradient path ──────────────
    // Reaches here only if a brush type has no registered generator
    // (shouldn't happen for any built-in brush after init). Kept so
    // any future custom brush type still renders something rather
    // than disappearing.
    this.perfFallbackPath++;
    ctx.save();
    switch (brush.type) {
      case 'glow':        this.drawGlowBrush(ctx, jx, jy, finalSize, r, g, b, alpha, brush.glow, brush.softness); break;
      case 'neon':        this.drawNeonBrush(ctx, jx, jy, finalSize, r, g, b, alpha, brush.glow); break;
      case 'flame':       this.drawFlameBrush(ctx, jx, jy, finalSize, r, g, b, alpha, brush.glow, progress, timeS * (brush.speed ?? 1)); break;
      case 'electric':    this.drawElectricBrush(ctx, jx, jy, finalSize, r, g, b, alpha, brush.glow, timeS * (brush.speed ?? 1)); break;
      case 'ribbon':      this.drawRibbonBrush(ctx, jx, jy, finalSize, r, g, b, alpha, progress, timeS * (brush.speed ?? 1)); break;
      case 'particle':    this.drawParticleBrush(ctx, jx, jy, finalSize, r, g, b, alpha, brush.glow, timeS * (brush.speed ?? 1)); break;
      case 'smoke':       this.drawSmokeBrush(ctx, jx, jy, finalSize, r, g, b, alpha, brush.softness); break;
      case 'laser':       this.drawLaserBrush(ctx, jx, jy, finalSize, r, g, b, alpha, brush.glow); break;
      case 'calligraphy': this.drawCalligraphyBrush(ctx, jx, jy, finalSize, r, g, b, alpha, angle); break;
      case 'spray':       this.drawSprayBrush(ctx, jx, jy, finalSize, r, g, b, alpha, brush.softness); break;
      case 'paintbrush':  this.drawPaintBrushBrush(ctx, jx, jy, finalSize, r, g, b, alpha, angle, brush.softness); break;
      case 'marker':      this.drawMarkerBrush(ctx, jx, jy, finalSize, r, g, b, alpha, angle); break;
      case 'watercolor':  this.drawWatercolorBrush(ctx, jx, jy, finalSize, r, g, b, alpha, brush.softness); break;
      default:            this.drawGlowBrush(ctx, jx, jy, finalSize, r, g, b, alpha, brush.glow, brush.softness); break;
    }
    ctx.restore();
  }

  // === BRUSH IMPLEMENTATIONS ===

  private drawGlowBrush(
    ctx: CanvasRenderingContext2D,
    x: number, y: number, size: number,
    r: number, g: number, b: number, alpha: number,
    glow: number, softness: number
  ) {
    const radius = size / 2;
    const glowRadius = radius * (1 + glow * 2);

    // Outer glow
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, glowRadius);
    gradient.addColorStop(0, `rgba(${r},${g},${b},${alpha})`);
    gradient.addColorStop(0.2, `rgba(${r},${g},${b},${alpha * 0.7})`);
    gradient.addColorStop(0.5, `rgba(${r},${g},${b},${alpha * 0.3 * softness})`);
    gradient.addColorStop(1, `rgba(${r},${g},${b},0)`);

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, glowRadius, 0, Math.PI * 2);
    ctx.fill();

    // Bright core
    const coreGrad = ctx.createRadialGradient(x, y, 0, x, y, radius * 0.5);
    coreGrad.addColorStop(0, `rgba(255,255,255,${alpha * 0.9})`);
    coreGrad.addColorStop(0.5, `rgba(${Math.min(255, r + 80)},${Math.min(255, g + 80)},${Math.min(255, b + 80)},${alpha * 0.5})`);
    coreGrad.addColorStop(1, `rgba(${r},${g},${b},0)`);

    ctx.fillStyle = coreGrad;
    ctx.beginPath();
    ctx.arc(x, y, radius * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawNeonBrush(
    ctx: CanvasRenderingContext2D,
    x: number, y: number, size: number,
    r: number, g: number, b: number, alpha: number,
    glow: number
  ) {
    const radius = size / 2;

    // Outer glow (wide, colored)
    ctx.shadowColor = `rgba(${r},${g},${b},${alpha})`;
    ctx.shadowBlur = radius * glow * 3;
    ctx.fillStyle = `rgba(${r},${g},${b},${alpha * 0.8})`;
    ctx.beginPath();
    ctx.arc(x, y, radius * 0.6, 0, Math.PI * 2);
    ctx.fill();

    // Hard bright center
    ctx.shadowBlur = 0;
    ctx.fillStyle = `rgba(255,255,255,${alpha * 0.95})`;
    ctx.beginPath();
    ctx.arc(x, y, radius * 0.25, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawFlameBrush(
    ctx: CanvasRenderingContext2D,
    x: number, y: number, size: number,
    r: number, g: number, b: number, alpha: number,
    glow: number, _progress: number, time: number = 0
  ) {
    const radius = size / 2;
    // Time-based flicker: smooth sine waves at different frequencies for organic feel
    const t = time * 4; // base frequency
    const flicker = 0.7 + 0.3 * (Math.sin(t * 2.7 + x * 0.01) * 0.5 + 0.5)
                       + 0.15 * (Math.sin(t * 5.3 + y * 0.01) * 0.5 + 0.5)
                       + 0.15 * Math.random(); // small random for organic texture
    const flickRadius = radius * flicker;

    // Flame uses warm gradient regardless of base color
    const yOff = radius * 0.2 * Math.sin(t * 1.8);
    const gradient = ctx.createRadialGradient(x, y - yOff, 0, x, y, flickRadius * (1 + glow));
    gradient.addColorStop(0, `rgba(255,255,200,${alpha * flicker})`);
    gradient.addColorStop(0.2, `rgba(${r},${Math.min(g + 50, 255)},${b},${alpha * 0.8 * flicker})`);
    gradient.addColorStop(0.6, `rgba(${r},${Math.max(g - 50, 0)},0,${alpha * 0.4 * flicker})`);
    gradient.addColorStop(1, `rgba(${Math.floor(r * 0.5)},0,0,0)`);

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, flickRadius * (1 + glow), 0, Math.PI * 2);
    ctx.fill();
  }

  private drawElectricBrush(
    ctx: CanvasRenderingContext2D,
    x: number, y: number, size: number,
    r: number, g: number, b: number, alpha: number,
    glow: number, time: number = 0
  ) {
    const radius = size / 2;
    const t = time * 6; // fast base frequency for sparks

    // Time-based sparks — angles change smoothly with time
    ctx.strokeStyle = `rgba(${r},${g},${b},${alpha * 0.6})`;
    ctx.lineWidth = 1;
    const sparkCount = 3 + Math.floor(Math.sin(t * 1.3) + 1.5);
    for (let i = 0; i < sparkCount; i++) {
      const angle = (i / sparkCount) * Math.PI * 2 + Math.sin(t * 2.1 + i * 1.7) * 0.8;
      const lenMod = 0.5 + 0.5 * Math.sin(t * 3.7 + i * 2.3);
      const len = radius * (0.5 + lenMod * glow);
      ctx.beginPath();
      ctx.moveTo(x, y);
      const bend = Math.sin(t * 4.3 + i * 1.1) * 0.5;
      const mx = x + Math.cos(angle + bend) * len * 0.5;
      const my = y + Math.sin(angle + bend) * len * 0.5;
      ctx.quadraticCurveTo(mx, my, x + Math.cos(angle) * len, y + Math.sin(angle) * len);
      ctx.stroke();
    }

    // Core pulses with time
    const corePulse = 0.35 + 0.05 * Math.sin(t * 5);
    const coreGrad = ctx.createRadialGradient(x, y, 0, x, y, radius * corePulse);
    coreGrad.addColorStop(0, `rgba(255,255,255,${alpha})`);
    coreGrad.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = coreGrad;
    ctx.beginPath();
    ctx.arc(x, y, radius * corePulse, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawRibbonBrush(
    ctx: CanvasRenderingContext2D,
    x: number, y: number, size: number,
    r: number, g: number, b: number, alpha: number,
    progress: number, time: number = 0
  ) {
    const width = size;
    const height = size * 0.15;

    ctx.save();
    ctx.translate(x, y);
    // Use time for smooth rotation when playing, fall back to progress for static
    const rotAngle = time > 0 ? time * Math.PI * 2 : progress * Math.PI * 2;
    ctx.rotate(rotAngle);

    const gradient = ctx.createLinearGradient(-width / 2, 0, width / 2, 0);
    gradient.addColorStop(0, `rgba(${r},${g},${b},0)`);
    gradient.addColorStop(0.3, `rgba(${r},${g},${b},${alpha})`);
    gradient.addColorStop(0.7, `rgba(${r},${g},${b},${alpha})`);
    gradient.addColorStop(1, `rgba(${r},${g},${b},0)`);

    ctx.fillStyle = gradient;
    ctx.fillRect(-width / 2, -height / 2, width, height);
    ctx.restore();
  }

  private drawParticleBrush(
    ctx: CanvasRenderingContext2D,
    x: number, y: number, size: number,
    r: number, g: number, b: number, alpha: number,
    glow: number, time: number = 0
  ) {
    const t = time * 3;
    const count = 3 + Math.floor(Math.sin(t * 1.7) * 2 + 2);
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + Math.sin(t * 2.3 + i * 1.1) * 1.5;
      const dist = (0.3 + 0.7 * Math.abs(Math.sin(t * 1.9 + i * 2.7))) * size * 0.5;
      const px = x + Math.cos(angle) * dist;
      const py = y + Math.sin(angle) * dist;
      const psize = 1 + Math.abs(Math.sin(t * 3.1 + i * 0.8)) * size * 0.15;

      const grad = ctx.createRadialGradient(px, py, 0, px, py, psize * (1 + glow));
      grad.addColorStop(0, `rgba(255,255,255,${alpha})`);
      grad.addColorStop(0.3, `rgba(${r},${g},${b},${alpha * 0.8})`);
      grad.addColorStop(1, `rgba(${r},${g},${b},0)`);

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(px, py, psize * (1 + glow), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawSmokeBrush(
    ctx: CanvasRenderingContext2D,
    x: number, y: number, size: number,
    r: number, g: number, b: number, alpha: number,
    softness: number
  ) {
    const radius = size / 2;
    const smokeRadius = radius * (1 + softness * 3);

    const gradient = ctx.createRadialGradient(x, y, 0, x, y, smokeRadius);
    gradient.addColorStop(0, `rgba(${r},${g},${b},${alpha * 0.3})`);
    gradient.addColorStop(0.4, `rgba(${r},${g},${b},${alpha * 0.15})`);
    gradient.addColorStop(1, `rgba(${r},${g},${b},0)`);

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x + (Math.random() - 0.5) * size * 0.3, y + (Math.random() - 0.5) * size * 0.3, smokeRadius, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawLaserBrush(
    ctx: CanvasRenderingContext2D,
    x: number, y: number, size: number,
    r: number, g: number, b: number, alpha: number,
    glow: number
  ) {
    const radius = size * 0.15; // Thin

    // Wide colored glow
    ctx.shadowColor = `rgba(${r},${g},${b},${alpha})`;
    ctx.shadowBlur = size * glow;

    // Bright white core
    ctx.fillStyle = `rgba(255,255,255,${alpha})`;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowBlur = 0;
  }

  // ── NEW BRUSH TYPES ─────────────────────────────────────────────────────

  private drawCalligraphyBrush(
    ctx: CanvasRenderingContext2D,
    x: number, y: number, size: number,
    r: number, g: number, b: number, alpha: number,
    angle: number
  ) {
    const nibAngle = Math.PI / 4; // 45° nib
    const angleDiff = Math.abs(Math.sin(angle - nibAngle));
    const width = size * (0.15 + 0.85 * angleDiff);
    const height = size * 0.12;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(nibAngle);
    ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
    ctx.beginPath();
    ctx.ellipse(0, 0, width / 2, height / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawSprayBrush(
    ctx: CanvasRenderingContext2D,
    x: number, y: number, size: number,
    r: number, g: number, b: number, alpha: number,
    softness: number
  ) {
    const radius = size / 2;
    const density = Math.min(40, 15 + Math.floor(size * 0.5));
    const spread = 0.3 + softness * 0.7;

    ctx.fillStyle = `rgba(${r},${g},${b},${alpha * 0.15})`;
    for (let i = 0; i < density; i++) {
      // Box-Muller for Gaussian distribution
      const u1 = Math.random(), u2 = Math.random();
      const mag = radius * spread * Math.sqrt(-2 * Math.log(Math.max(u1, 0.001)));
      const a = 2 * Math.PI * u2;
      const dx = mag * Math.cos(a);
      const dy = mag * Math.sin(a);
      if (Math.sqrt(dx * dx + dy * dy) > radius) continue;
      const dotSize = 0.5 + Math.random() * 1.5;
      ctx.beginPath();
      ctx.arc(x + dx, y + dy, dotSize, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawPaintBrushBrush(
    ctx: CanvasRenderingContext2D,
    x: number, y: number, size: number,
    r: number, g: number, b: number, alpha: number,
    angle: number, softness: number
  ) {
    const bristleCount = 5 + Math.floor(size * 0.15);
    const perpAngle = angle + Math.PI / 2;

    for (let i = 0; i < bristleCount; i++) {
      const t = (i / (bristleCount - 1)) - 0.5; // -0.5 to 0.5
      const offset = t * size;
      const jitter = (Math.random() - 0.5) * size * 0.1;
      const bx = x + Math.cos(perpAngle) * (offset + jitter);
      const by = y + Math.sin(perpAngle) * (offset + jitter);
      const bristleAlpha = alpha * (0.3 + 0.7 * (1 - Math.abs(t) * 2));
      const bristleSize = 1 + Math.random() * 2;

      ctx.fillStyle = `rgba(${r},${g},${b},${bristleAlpha * (0.3 + softness * 0.7)})`;
      ctx.beginPath();
      ctx.arc(bx, by, bristleSize, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawMarkerBrush(
    ctx: CanvasRenderingContext2D,
    x: number, y: number, size: number,
    r: number, g: number, b: number, alpha: number,
    angle: number
  ) {
    const width = size;
    const height = size * 0.25;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = `rgba(${r},${g},${b},${alpha * 0.7})`;
    // Rounded rect
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
  }

  private drawWatercolorBrush(
    ctx: CanvasRenderingContext2D,
    x: number, y: number, size: number,
    r: number, g: number, b: number, alpha: number,
    softness: number
  ) {
    const radius = size / 2;

    for (let layer = 0; layer < 3; layer++) {
      const spread = radius * (1 + layer * 0.4 * softness);
      const ox = (Math.random() - 0.5) * size * 0.2;
      const oy = (Math.random() - 0.5) * size * 0.2;
      const layerAlpha = alpha * (0.08 - layer * 0.02);

      const grad = ctx.createRadialGradient(
        x + ox, y + oy, spread * 0.3,
        x + ox, y + oy, spread
      );
      grad.addColorStop(0, `rgba(${r},${g},${b},${layerAlpha})`);
      grad.addColorStop(0.6, `rgba(${r},${g},${b},${layerAlpha * 0.5})`);
      grad.addColorStop(0.8, `rgba(${r},${g},${b},${layerAlpha * 0.2})`);
      grad.addColorStop(1, `rgba(${r},${g},${b},0)`);

      ctx.fillStyle = grad;
      ctx.beginPath();
      // Wobbly circle for irregular wet edge
      const segments = 12;
      for (let s = 0; s <= segments; s++) {
        const a = (s / segments) * Math.PI * 2;
        const wobble = spread * (0.85 + Math.random() * 0.3);
        const px = x + ox + Math.cos(a) * wobble;
        const py = y + oy + Math.sin(a) * wobble;
        if (s === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
    }
  }

  /**
   * Draw a stroke up to a given progress (0-1)
   */
  private drawStroke(
    ctx: CanvasRenderingContext2D,
    stroke: LightPaintingStroke,
    progress: number,
    trailLength: number,
    colorShiftAngle: number,
    multiColorGlow: boolean = false,
    content: LightPaintingContent | null = null
  ) {
    if (stroke.points.length < 2 || progress <= 0) return;
    // GPU compute brushes are owned by WebGPUStrokeParticles in the
    // WebGPU bridge overlay, NOT by this CPU rasteriser. Skip them
    // here so the same stroke isn't rendered twice (CPU faint + GPU
    // bright). The GPU pass reads strokes directly from the project
    // store. Same skip lives in webglRenderer.ts via the
    // GPU_COMPUTE_BRUSH_TYPES set.
    if (stroke.brush.type === 'spiral' || stroke.brush.type === 'firefly' ||
        stroke.brush.type === 'sap-flow' || stroke.brush.type === 'water' ||
        stroke.brush.type === 'smoke') {
      return;
    }

    const points = stroke.points;
    const totalPoints = points.length;
    const drawUpTo = Math.floor(totalPoints * progress);
    if (drawUpTo < 1) return;

    // Calculate trail start (for fading old parts)
    const trailStart = trailLength > 0
      ? Math.max(0, drawUpTo - Math.floor(totalPoints * (1 - trailLength)))
      : 0;

    // Apply color shift
    let brush = stroke.brush;
    if (colorShiftAngle > 0) {
      brush = { ...brush, color: this.shiftHue(brush.color, colorShiftAngle) };
    }

    // Multi-color glow: draw a secondary color halo behind the main stroke
    if (multiColorGlow && brush.secondaryColor) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const sc = brush.secondaryColor;
      const haloSize = brush.size * 2.5;
      const step2 = Math.max(1, Math.floor(haloSize * 0.2));
      for (let i = trailStart; i < drawUpTo; i++) {
        if (i % step2 !== 0 && i !== drawUpTo - 1) continue;
        const p = points[i];
        const strokeProgress = i / Math.max(1, totalPoints - 1);
        const { x: px, y: py } = this.getAnimatedPointPosition(stroke, p, content, strokeProgress);
        let trailAlpha = 1;
        if (trailLength > 0 && drawUpTo > 0) {
          const distFromHead = (drawUpTo - i) / Math.max(1, drawUpTo - trailStart);
          trailAlpha = 1 - distFromHead;
          trailAlpha = trailAlpha * trailAlpha;
        }
        trailAlpha *= this.getFlowPulseMultiplier(stroke, content, strokeProgress);
        const grad = ctx.createRadialGradient(px, py, 0, px, py, haloSize);
        grad.addColorStop(0, `rgba(${sc[0]},${sc[1]},${sc[2]},${brush.opacity * trailAlpha * 0.25})`);
        grad.addColorStop(0.5, `rgba(${sc[0]},${sc[1]},${sc[2]},${brush.opacity * trailAlpha * 0.1})`);
        grad.addColorStop(1, `rgba(${sc[0]},${sc[1]},${sc[2]},0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(px, py, haloSize, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // Draw smooth curve through points
    ctx.save();
    ctx.globalCompositeOperation = 'lighter'; // Additive blending

    // Stamp spacing: tighter for direction-aware brushes, moderate for others
    const step = TIGHT_STAMP_BRUSH_TYPES.has(brush.type)
      ? Math.max(1, Math.ceil(brush.size * 0.04))
      : Math.max(1, Math.ceil(brush.size * 0.08));

    for (let i = trailStart; i < drawUpTo; i++) {
      const p = points[i];
      const strokeProgress = i / Math.max(1, totalPoints - 1);
      const { x: px, y: py } = this.getAnimatedPointPosition(stroke, p, content, strokeProgress);

      // Calculate trail fade
      let trailAlpha = 1;
      if (trailLength > 0 && drawUpTo > 0) {
        const distFromHead = (drawUpTo - i) / Math.max(1, drawUpTo - trailStart);
        trailAlpha = 1 - distFromHead;
        trailAlpha = trailAlpha * trailAlpha; // Quadratic falloff
      }
      trailAlpha *= this.getFlowPulseMultiplier(stroke, content, strokeProgress);

      // Compute stroke direction angle for direction-aware brushes
      let angle = 0;
      if (i > 0) {
        const prev = points[i - 1];
        const prevProgress = (i - 1) / Math.max(1, totalPoints - 1);
        const prevPos = this.getAnimatedPointPosition(stroke, prev, content, prevProgress);
        angle = Math.atan2(py - prevPos.y, px - prevPos.x);
      } else if (i < totalPoints - 1) {
        const next = points[i + 1];
        const nextProgress = (i + 1) / Math.max(1, totalPoints - 1);
        const nextPos = this.getAnimatedPointPosition(stroke, next, content, nextProgress);
        angle = Math.atan2(nextPos.y - py, nextPos.x - px);
      }

      // Align step to trailStart so we don't skip initial points
      if ((i - trailStart) % step === 0 || i === drawUpTo - 1) {
        this.drawBrushPoint(ctx, px, py, brush, p.pressure, strokeProgress, angle, this.animationTime / 1000, trailAlpha);
        // Bump the stamp index so stamp-random brushes (smoke, spray,
        // paintbrush, watercolor) get a different sprite variant per
        // stamp. Wraps via modulo inside the cache; pre-increment so
        // first stamp = variant 0.
        this.currentStampIndex++;
      }
    }

    // Draw continuous line overlay ONLY for line-type brushes (glow, neon, laser)
    // Stamp-based brushes (spray, calligraphy, watercolor, etc.) rely purely on stamps
    if (LINE_BRUSH_TYPES.has(brush.type)) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = `rgba(${brush.color[0]},${brush.color[1]},${brush.color[2]},${brush.opacity * 0.25})`;
      ctx.lineWidth = brush.size * 0.25;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      if (brush.type === 'neon' || brush.type === 'laser') {
        ctx.shadowColor = `rgba(${brush.color[0]},${brush.color[1]},${brush.color[2]},${brush.opacity})`;
        ctx.shadowBlur = brush.size * brush.glow;
      }

      ctx.beginPath();
      const startIdx = Math.max(trailStart, 0);
      if (startIdx < drawUpTo) {
        const startProgress = startIdx / Math.max(1, totalPoints - 1);
        const startPos = this.getAnimatedPointPosition(stroke, points[startIdx], content, startProgress);
        ctx.moveTo(startPos.x, startPos.y);
        for (let i = startIdx + 1; i < drawUpTo; i++) {
          // Smooth with quadratic bezier
          if (i < drawUpTo - 1) {
            const curr = points[i];
            const next = points[i + 1];
            const currProgress = i / Math.max(1, totalPoints - 1);
            const nextProgress = (i + 1) / Math.max(1, totalPoints - 1);
            const currPos = this.getAnimatedPointPosition(stroke, curr, content, currProgress);
            const nextPos = this.getAnimatedPointPosition(stroke, next, content, nextProgress);
            const mx = (currPos.x + nextPos.x) / 2;
            const my = (currPos.y + nextPos.y) / 2;
            ctx.quadraticCurveTo(currPos.x, currPos.y, mx, my);
          } else {
            const lineProgress = i / Math.max(1, totalPoints - 1);
            const linePos = this.getAnimatedPointPosition(stroke, points[i], content, lineProgress);
            ctx.lineTo(linePos.x, linePos.y);
          }
        }
        ctx.stroke();
      }

      ctx.shadowBlur = 0;
    }

    ctx.restore();
  }

  /**
   * Shift a color's hue by the given angle (0-1 maps to 0-360 degrees)
   */
  private shiftHue(color: [number, number, number], shift: number): [number, number, number] {
    // Convert RGB to HSL
    const r = color[0] / 255, g = color[1] / 255, b = color[2] / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (max + min) / 2;

    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
      else if (max === g) h = ((b - r) / d + 2) / 6;
      else h = ((r - g) / d + 4) / 6;
    }

    // Shift hue
    h = (h + shift) % 1;

    // Convert back to RGB
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };

    if (s === 0) {
      return [Math.round(l * 255), Math.round(l * 255), Math.round(l * 255)];
    }

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    return [
      Math.round(hue2rgb(p, q, h + 1/3) * 255),
      Math.round(hue2rgb(p, q, h) * 255),
      Math.round(hue2rgb(p, q, h - 1/3) * 255),
    ];
  }

  /**
   * Apply bloom post-process effect
   */
  private applyBloom(bloom: number) {
    if (bloom <= 0) return;

    const bw = this.bloomCanvas.width;
    const bh = this.bloomCanvas.height;

    // Downscale to bloom canvas
    this.bloomCtx.clearRect(0, 0, bw, bh);
    this.bloomCtx.drawImage(this.canvas, 0, 0, bw, bh);

    // Blur (simple box blur by drawing at offset)
    this.bloomCtx.globalAlpha = 0.5;
    this.bloomCtx.drawImage(this.bloomCanvas, -2, 0);
    this.bloomCtx.drawImage(this.bloomCanvas, 2, 0);
    this.bloomCtx.drawImage(this.bloomCanvas, 0, -2);
    this.bloomCtx.drawImage(this.bloomCanvas, 0, 2);
    this.bloomCtx.globalAlpha = 1;

    // Composite bloom back at full size
    this.ctx.save();
    this.ctx.globalCompositeOperation = 'lighter';
    this.ctx.globalAlpha = bloom * 0.4;
    this.ctx.drawImage(this.bloomCanvas, 0, 0, this.width, this.height);
    this.ctx.restore();
  }

  private drawSparkles(
    stroke: LightPaintingStroke,
    progress: number,
    content: LightPaintingContent
  ) {
    if (content.sparkle <= 0 || !content.isPlaying || stroke.points.length <= 2) return;

    const drawUpTo = Math.floor(stroke.points.length * progress);
    if (drawUpTo <= 0) return;

    this.ctx.save();
    this.ctx.globalCompositeOperation = 'lighter';
    const sparkCount = Math.floor(content.sparkle * 15);
    for (let s = 0; s < sparkCount; s++) {
      const idx = Math.floor(Math.random() * drawUpTo);
      if (idx >= stroke.points.length) continue;
      const p = stroke.points[idx];
      const strokeProgress = idx / Math.max(1, stroke.points.length - 1);
      const pos = this.getAnimatedPointPosition(stroke, p, content, strokeProgress);
      const sx = pos.x + (Math.random() - 0.5) * stroke.brush.size;
      const sy = pos.y + (Math.random() - 0.5) * stroke.brush.size;
      const sparkSize = 1 + Math.random() * 3;
      const sparkAlpha = 0.5 + Math.random() * 0.5;
      const [cr, cg, cb] = stroke.brush.color;
      const grad = this.ctx.createRadialGradient(sx, sy, 0, sx, sy, sparkSize * 3);
      grad.addColorStop(0, `rgba(255,255,255,${sparkAlpha})`);
      grad.addColorStop(0.3, `rgba(${cr},${cg},${cb},${sparkAlpha * 0.6})`);
      grad.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
      this.ctx.fillStyle = grad;
      this.ctx.beginPath();
      this.ctx.arc(sx, sy, sparkSize * 3, 0, Math.PI * 2);
      this.ctx.fill();
    }
    this.ctx.restore();
  }

  /**
   * Main render function - called every frame
   * Returns a Three.js texture suitable for compositing
   */
  render(content: LightPaintingContent, deltaTime: number): THREE.Texture {
    if (this.isStaticCacheHit(content)) {
      return this.texture;
    }

    // Reset perf probe counters for this frame.
    const renderStart = performance.now();
    this.perfStampCount = 0;
    this.perfSpriteHits = 0;
    this.perfSpriteMisses = 0;
    this.perfFallbackPath = 0;
    this.currentStampIndex = 0;

    // Update animation time — derived from a globally-shared wall clock so
    // the main viewport and the output window converge on the SAME value at
    // any given wall-clock moment. Previously each renderer self-incremented
    // an animationTime accumulator from its own deltaTime, which drifted:
    // the output window opens later, so its accumulator is always behind,
    // and even when both are running they tick at slightly different rates
    // depending on frame load.
    //
    // We anchor at today's local midnight (a stable per-day value identical
    // in every process on the machine) so the elapsed milliseconds are a
    // reasonable size for FP math.
    //
    // Pause: when content.isPlaying flips false we leave animationTime at
    // its last value. On resume it jumps to the current wall-clock value —
    // continuity across pauses is sacrificed in exchange for guaranteed
    // sync between the two windows. (No UI currently surfaces pause/resume
    // for light-painting playback, so this trade-off is invisible today.)
    if (content.isPlaying) {
      this.animationTime = (Date.now() - LP_TIME_ANCHOR_MS) * content.animationSpeed;
    }
    void deltaTime;

    const visibleStrokes = content.strokes.filter(s => s.visible);

    // Calculate total duration
    this.totalDuration = this.calculateTotalDuration(content, visibleStrokes);
    const sequenceCycle = this.getSequenceCycleIndex(this.animationTime, this.totalDuration, content);
    const orderedVisibleStrokes = this.orderVisibleStrokes(visibleStrokes, content, sequenceCycle);

    // Get looped time
    const effectiveTime = this.getLoopedTime(
      this.animationTime,
      this.totalDuration,
      content
    );

    const strokeStartTimes = this.calculateStrokeStartTimes(orderedVisibleStrokes, content);

    // Clear canvas
    const [bgR, bgG, bgB, bgA] = content.backgroundColor;
    this.ctx.clearRect(0, 0, this.width, this.height);

    // Fill background
    if (bgA > 0) {
      this.ctx.fillStyle = `rgba(${Math.floor(bgR * 255)},${Math.floor(bgG * 255)},${Math.floor(bgB * 255)},${bgA})`;
      this.ctx.fillRect(0, 0, this.width, this.height);
    }

    // Handle afterglow (persistence)
    if (content.afterglow > 0 && content.isPlaying) {
      this.persistCtx.globalAlpha = 1 - (1 - content.afterglow) * 0.3;
      this.ctx.drawImage(this.persistCanvas, 0, 0);
    }

    // Calculate color shift based on time
    const colorShiftAngle = content.colorShift > 0
      ? (this.animationTime / 3000 * content.colorShift) % 1
      : 0;

    // Calculate global animated multipliers
    const timeS = this.animationTime / 1000;

    // Pulse: smooth sine brightness modulation
    let pulseMult = 1;
    if (content.pulse > 0 && content.isPlaying) {
      pulseMult = 1 - content.pulse * 0.5 * (1 - Math.sin(timeS * content.pulseSpeed * Math.PI * 2) * 0.5 - 0.5);
    }

    // Strobe: hard on/off flicker
    let strobeMult = 1;
    if (content.strobe > 0 && content.isPlaying) {
      const strobeFreq = content.strobe * 20; // 0-20 Hz
      strobeMult = Math.sin(timeS * strobeFreq * Math.PI * 2) > 0 ? 1 : 0.05;
    }

    // Flicker: random brightness variation per frame
    let flickerMult = 1;
    if (content.flicker > 0 && content.isPlaying) {
      flickerMult = 1 - content.flicker * Math.random() * 0.6;
    }

    // Breathe: smooth size modulation
    let breatheScale = 1;
    if (content.breathe > 0 && content.isPlaying) {
      breatheScale = 1 + content.breathe * 0.3 * Math.sin(timeS * content.breatheSpeed * Math.PI * 2);
    }

    // Apply global brightness modifiers
    const globalAlpha = pulseMult * strobeMult * flickerMult;
    if (globalAlpha < 1) {
      this.ctx.save();
      this.ctx.globalAlpha = globalAlpha;
    }

    // Apply breathe as a scale from center
    if (breatheScale !== 1) {
      this.ctx.save();
      this.ctx.translate(this.width / 2, this.height / 2);
      this.ctx.scale(breatheScale, breatheScale);
      this.ctx.translate(-this.width / 2, -this.height / 2);
    }

    // Wave distortion: apply sine offset to the canvas transform
    if (content.wave > 0 && content.isPlaying) {
      const waveAmt = content.wave * 15;
      const wavePhase = timeS * content.waveSpeed * Math.PI * 2;
      // Apply per-line wave by re-drawing after strokes (approximate with translate)
      this.ctx.save();
      const waveOffsetX = Math.sin(wavePhase) * waveAmt;
      const waveOffsetY = Math.cos(wavePhase * content.waveFreq) * waveAmt * 0.5;
      this.ctx.translate(waveOffsetX, waveOffsetY);
    }

    const strokeRenderItems = orderedVisibleStrokes.map((stroke, i) => {
      const progress = content.isPlaying
        ? this.getStrokeProgress(stroke, content, effectiveTime, strokeStartTimes[i])
        : 1; // Show fully drawn when not playing

      let trailLen = content.isPlaying ? content.trailLength : 0;
      if (content.snake > 0 && content.isPlaying) {
        trailLen = 1 - content.snake;
      }

      return { stroke, progress, trailLen };
    });

    // Echo uses a full-size stroke buffer, so each stroke is stamped once and
    // repeated with cheap drawImage copies instead of replaying every point.
    if (content.echo > 0 && strokeRenderItems.length > 0) {
      this.strokeCtx.setTransform(1, 0, 0, 1, 0, 0);
      this.strokeCtx.globalAlpha = 1;
      this.strokeCtx.globalCompositeOperation = 'source-over';
      this.strokeCtx.clearRect(0, 0, this.width, this.height);

      for (const item of strokeRenderItems) {
        this.drawStroke(
          this.strokeCtx,
          item.stroke,
          item.progress,
          item.trailLen,
          colorShiftAngle,
          content.multiColorGlow,
          content
        );
      }

      this.ctx.save();
      this.ctx.globalCompositeOperation = 'lighter';

      const echoCount = Math.round(content.echo);
      for (let e = echoCount; e >= 1; e--) {
        const echoAlpha = Math.pow(1 - content.echoDecay, e) * globalAlpha;
        if (echoAlpha <= 0.001) continue;

        const offsetPx = e * content.echoOffset * this.width * 0.5;
        this.ctx.save();
        this.ctx.globalAlpha = echoAlpha;
        this.ctx.translate(0, -offsetPx);
        this.ctx.drawImage(this.strokeCanvas, 0, 0);
        this.ctx.restore();

        this.ctx.save();
        this.ctx.globalAlpha = echoAlpha;
        this.ctx.translate(0, offsetPx);
        this.ctx.drawImage(this.strokeCanvas, 0, 0);
        this.ctx.restore();
      }

      this.ctx.drawImage(this.strokeCanvas, 0, 0);
      this.ctx.restore();

      for (const item of strokeRenderItems) {
        this.drawSparkles(item.stroke, item.progress, content);
      }
    } else {
      for (const item of strokeRenderItems) {
        this.drawStroke(
          this.ctx,
          item.stroke,
          item.progress,
          item.trailLen,
          colorShiftAngle,
          content.multiColorGlow,
          content
        );
        this.drawSparkles(item.stroke, item.progress, content);
      }
    }

    // Draw in-progress live preview stroke (sent from LightPaintingPanel
    // during active drawing so the output window can show it in real-time)
    if ((content as any).livePreviewStroke) {
      const preview = (content as any).livePreviewStroke;
      if (preview.points?.length >= 2 && preview.brush) {
        this.drawStroke(this.ctx, {
          id: '__preview__',
          points: preview.points,
          brush: preview.brush,
          duration: 0,
          visible: true,
          locked: false,
          drawMode: 'freehand',
        }, 1, 0, colorShiftAngle, content.multiColorGlow, content);
      }
    }

    // Restore wave transform
    if (content.wave > 0 && content.isPlaying) {
      this.ctx.restore();
    }

    // Restore breathe transform
    if (breatheScale !== 1) {
      this.ctx.restore();
    }

    // Restore global alpha
    if (globalAlpha < 1) {
      this.ctx.restore();
    }

    // Apply bloom
    if (content.bloom > 0) {
      this.applyBloom(content.bloom);
    }

    // Save to persistence buffer
    if (content.afterglow > 0) {
      this.persistCtx.clearRect(0, 0, this.width, this.height);
      this.persistCtx.globalAlpha = content.afterglow;
      this.persistCtx.drawImage(this.canvas, 0, 0);
    }

    // Update texture
    this.texture.needsUpdate = true;
    this.markStaticCache(content);
    this.perfLastRenderMs = performance.now() - renderStart;
    return this.texture;
  }

  /**
   * Reset animation to beginning
   */
  resetAnimation() {
    this.animationTime = 0;
    this.persistCtx.clearRect(0, 0, this.width, this.height);
    this.invalidateStaticCache();
  }

  /**
   * Set playback position (0-1)
   */
  setPlaybackPosition(position: number) {
    this.animationTime = position * this.totalDuration;
    this.invalidateStaticCache();
  }

  /**
   * Get current texture
   */
  getTexture(): THREE.Texture {
    return this.texture;
  }

  /**
   * Dispose resources
   */
  dispose() {
    this.texture.dispose();
  }
}
