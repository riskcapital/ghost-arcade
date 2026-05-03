// Light Painting Renderer
// Renders animated light trail strokes to a Canvas2D texture
// Uses additive blending and glow effects for long-exposure light painting look

import * as THREE from 'three';
import type {
  LightPaintingContent,
  LightPaintingStroke,
  LightPaintingBrush,
  LightPaintingLoopMode,
} from '../types';

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

    // Create Three.js texture
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.format = THREE.RGBAFormat;
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
  }

  /**
   * Calculate total animation duration based on content settings
   */
  private calculateTotalDuration(content: LightPaintingContent): number {
    if (content.strokes.length === 0) return 0;

    if (content.staggerStrokes) {
      // Staggered: each stroke starts after the previous one + delay
      let total = 0;
      for (const stroke of content.strokes) {
        if (!stroke.visible) continue;
        total += (stroke.duration / content.drawSpeed) + content.staggerDelay;
      }
      return total;
    } else {
      // Simultaneous: duration is the longest stroke
      let max = 0;
      for (const stroke of content.strokes) {
        if (!stroke.visible) continue;
        max = Math.max(max, stroke.duration / content.drawSpeed);
      }
      return max;
    }
  }

  /**
   * Get the animation progress for a stroke (0 = not started, 1 = fully drawn)
   */
  private getStrokeProgress(
    _strokeIndex: number,
    stroke: LightPaintingStroke,
    content: LightPaintingContent,
    currentTime: number
  ): number {
    const strokeDuration = stroke.duration / content.drawSpeed;
    let strokeStart = 0;

    if (content.staggerStrokes) {
      // Calculate when this stroke starts
      let offset = 0;
      const visibleStrokes = content.strokes.filter(s => s.visible);
      for (let i = 0; i < visibleStrokes.length; i++) {
        if (visibleStrokes[i].id === stroke.id) break;
        offset += (visibleStrokes[i].duration / content.drawSpeed) + content.staggerDelay;
      }
      strokeStart = offset;
    }

    const elapsed = currentTime - strokeStart;
    if (elapsed <= 0) return 0;
    if (strokeDuration <= 0) return 1;
    return Math.min(1, elapsed / strokeDuration);
  }

  /**
   * Apply loop mode to get the effective animation time
   */
  private getLoopedTime(rawTime: number, duration: number, mode: LightPaintingLoopMode): number {
    if (duration <= 0) return 0;
    if (mode === 'once') return Math.min(rawTime, duration);

    if (mode === 'forward') {
      return rawTime % duration;
    }

    if (mode === 'reverse') {
      return duration - (rawTime % duration);
    }

    if (mode === 'pingpong') {
      const cycle = rawTime % (duration * 2);
      if (cycle <= duration) return cycle;
      return duration * 2 - cycle;
    }

    return rawTime % duration;
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
    timeS: number = 0   // elapsed time in seconds (for animated brushes)
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
    const alpha = brush.opacity * taperMult;

    // Apply jitter
    let jx = x, jy = y;
    if (brush.jitter > 0) {
      jx += (Math.random() - 0.5) * brush.jitter * brush.size * 2;
      jy += (Math.random() - 0.5) * brush.jitter * brush.size * 2;
    }

    ctx.save();

    switch (brush.type) {
      case 'glow':
        this.drawGlowBrush(ctx, jx, jy, finalSize, r, g, b, alpha, brush.glow, brush.softness);
        break;
      case 'neon':
        this.drawNeonBrush(ctx, jx, jy, finalSize, r, g, b, alpha, brush.glow);
        break;
      case 'flame':
        this.drawFlameBrush(ctx, jx, jy, finalSize, r, g, b, alpha, brush.glow, progress, timeS * (brush.speed ?? 1));
        break;
      case 'electric':
        this.drawElectricBrush(ctx, jx, jy, finalSize, r, g, b, alpha, brush.glow, timeS * (brush.speed ?? 1));
        break;
      case 'ribbon':
        this.drawRibbonBrush(ctx, jx, jy, finalSize, r, g, b, alpha, progress, timeS * (brush.speed ?? 1));
        break;
      case 'particle':
        this.drawParticleBrush(ctx, jx, jy, finalSize, r, g, b, alpha, brush.glow, timeS * (brush.speed ?? 1));
        break;
      case 'smoke':
        this.drawSmokeBrush(ctx, jx, jy, finalSize, r, g, b, alpha, brush.softness);
        break;
      case 'laser':
        this.drawLaserBrush(ctx, jx, jy, finalSize, r, g, b, alpha, brush.glow);
        break;
      case 'calligraphy':
        this.drawCalligraphyBrush(ctx, jx, jy, finalSize, r, g, b, alpha, angle);
        break;
      case 'spray':
        this.drawSprayBrush(ctx, jx, jy, finalSize, r, g, b, alpha, brush.softness);
        break;
      case 'paintbrush':
        this.drawPaintBrushBrush(ctx, jx, jy, finalSize, r, g, b, alpha, angle, brush.softness);
        break;
      case 'marker':
        this.drawMarkerBrush(ctx, jx, jy, finalSize, r, g, b, alpha, angle);
        break;
      case 'watercolor':
        this.drawWatercolorBrush(ctx, jx, jy, finalSize, r, g, b, alpha, brush.softness);
        break;
      default:
        // Unknown brush type — fallback to glow
        this.drawGlowBrush(ctx, jx, jy, finalSize, r, g, b, alpha, brush.glow, brush.softness);
        break;
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
    multiColorGlow: boolean = false
  ) {
    if (stroke.points.length < 2 || progress <= 0) return;

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
        const px = p.x * this.width;
        const py = p.y * this.height;
        let trailAlpha = 1;
        if (trailLength > 0 && drawUpTo > 0) {
          const distFromHead = (drawUpTo - i) / Math.max(1, drawUpTo - trailStart);
          trailAlpha = 1 - distFromHead;
          trailAlpha = trailAlpha * trailAlpha;
        }
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

    // Brush types that need tight stamp spacing (direction-aware / textured)
    const tightStampBrushes = new Set(['calligraphy', 'paintbrush', 'marker', 'ribbon']);
    // Brush types that benefit from a continuous line overlay
    const lineBrushes = new Set(['glow', 'neon', 'laser']);

    // Stamp spacing: tighter for direction-aware brushes, moderate for others
    const step = tightStampBrushes.has(brush.type)
      ? Math.max(1, Math.ceil(brush.size * 0.04))
      : Math.max(1, Math.ceil(brush.size * 0.08));

    for (let i = trailStart; i < drawUpTo; i++) {
      const p = points[i];
      const px = p.x * this.width;
      const py = p.y * this.height;

      // Calculate trail fade
      let trailAlpha = 1;
      if (trailLength > 0 && drawUpTo > 0) {
        const distFromHead = (drawUpTo - i) / Math.max(1, drawUpTo - trailStart);
        trailAlpha = 1 - distFromHead;
        trailAlpha = trailAlpha * trailAlpha; // Quadratic falloff
      }

      const strokeProgress = i / Math.max(1, totalPoints - 1);

      // Compute stroke direction angle for direction-aware brushes
      let angle = 0;
      if (i > 0) {
        const prev = points[i - 1];
        angle = Math.atan2((p.y - prev.y) * this.height, (p.x - prev.x) * this.width);
      } else if (i < totalPoints - 1) {
        const next = points[i + 1];
        angle = Math.atan2((next.y - p.y) * this.height, (next.x - p.x) * this.width);
      }

      // Modulate brush with trail alpha
      const modBrush = { ...brush, opacity: brush.opacity * trailAlpha };

      // Align step to trailStart so we don't skip initial points
      if ((i - trailStart) % step === 0 || i === drawUpTo - 1) {
        this.drawBrushPoint(ctx, px, py, modBrush, p.pressure, strokeProgress, angle, this.animationTime / 1000);
      }
    }

    // Draw continuous line overlay ONLY for line-type brushes (glow, neon, laser)
    // Stamp-based brushes (spray, calligraphy, watercolor, etc.) rely purely on stamps
    if (lineBrushes.has(brush.type)) {
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
        ctx.moveTo(points[startIdx].x * this.width, points[startIdx].y * this.height);
        for (let i = startIdx + 1; i < drawUpTo; i++) {
          // Smooth with quadratic bezier
          if (i < drawUpTo - 1) {
            const curr = points[i];
            const next = points[i + 1];
            const mx = (curr.x + next.x) / 2 * this.width;
            const my = (curr.y + next.y) / 2 * this.height;
            ctx.quadraticCurveTo(curr.x * this.width, curr.y * this.height, mx, my);
          } else {
            ctx.lineTo(points[i].x * this.width, points[i].y * this.height);
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

  /**
   * Main render function - called every frame
   * Returns a Three.js texture suitable for compositing
   */
  render(content: LightPaintingContent, deltaTime: number): THREE.Texture {
    // Update animation time
    if (content.isPlaying) {
      this.animationTime += deltaTime * 1000 * content.animationSpeed;
    }

    // Calculate total duration
    this.totalDuration = this.calculateTotalDuration(content);

    // Get looped time
    const effectiveTime = this.getLoopedTime(
      this.animationTime,
      this.totalDuration,
      content.loopMode
    );

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

    // Draw each visible stroke (with echo and snake effects)
    const visibleStrokes = content.strokes.filter(s => s.visible);
    for (let i = 0; i < visibleStrokes.length; i++) {
      const stroke = visibleStrokes[i];
      let progress = content.isPlaying
        ? this.getStrokeProgress(i, stroke, content, effectiveTime)
        : 1; // Show fully drawn when not playing

      // Snake effect: override trail to create a moving head
      let trailLen = content.isPlaying ? content.trailLength : 0;
      if (content.snake > 0 && content.isPlaying) {
        trailLen = 1 - content.snake;
      }

      // Echo effect: draw offset copies behind the main stroke
      if (content.echo > 0) {
        const echoCount = Math.round(content.echo);
        for (let e = echoCount; e >= 1; e--) {
          this.ctx.save();
          this.ctx.globalAlpha = Math.pow(1 - content.echoDecay, e) * globalAlpha;
          const offsetPx = e * content.echoOffset * this.width * 0.5;
          this.ctx.translate(0, -offsetPx);
          this.drawStroke(this.ctx, stroke, progress, trailLen, colorShiftAngle, content.multiColorGlow);
          this.ctx.restore();
          this.ctx.save();
          this.ctx.globalAlpha = Math.pow(1 - content.echoDecay, e) * globalAlpha;
          this.ctx.translate(0, offsetPx);
          this.drawStroke(this.ctx, stroke, progress, trailLen, colorShiftAngle, content.multiColorGlow);
          this.ctx.restore();
        }
      }

      // Draw main stroke
      this.drawStroke(
        this.ctx,
        stroke,
        progress,
        trailLen,
        colorShiftAngle,
        content.multiColorGlow
      );

      // Sparkle: random bright dots along visible stroke points
      if (content.sparkle > 0 && content.isPlaying && stroke.points.length > 2) {
        this.ctx.save();
        this.ctx.globalCompositeOperation = 'lighter';
        const sparkCount = Math.floor(content.sparkle * 15);
        const drawUpTo = Math.floor(stroke.points.length * progress);
        for (let s = 0; s < sparkCount; s++) {
          const idx = Math.floor(Math.random() * drawUpTo);
          if (idx >= stroke.points.length) continue;
          const p = stroke.points[idx];
          const sx = p.x * this.width + (Math.random() - 0.5) * stroke.brush.size;
          const sy = p.y * this.height + (Math.random() - 0.5) * stroke.brush.size;
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
        }, 1, 0, colorShiftAngle, content.multiColorGlow);
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
    return this.texture;
  }

  /**
   * Reset animation to beginning
   */
  resetAnimation() {
    this.animationTime = 0;
    this.persistCtx.clearRect(0, 0, this.width, this.height);
  }

  /**
   * Set playback position (0-1)
   */
  setPlaybackPosition(position: number) {
    this.animationTime = position * this.totalDuration;
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
