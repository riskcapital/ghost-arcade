/**
 * Text Layer Renderer
 *
 * Renders text with advanced animations to an offscreen canvas,
 * then converts to a THREE.js texture for compositing.
 *
 * Supports 18 animation types from subtle reveals to wild 3D effects.
 */

import * as THREE from 'three';
import type { TextContent } from '../types';

interface LetterMetrics {
  char: string;
  x: number;       // Base x position
  y: number;       // Base y position (baseline)
  width: number;   // Character width
  index: number;   // Index in string
  lineIndex: number;
}

export class TextRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private texture: THREE.CanvasTexture;
  private width: number;
  private height: number;
  private startTime: number;
  private lastText: string = '';
  private letterMetrics: LetterMetrics[] = [];
  // Offscreen canvas for 3D compositing (render flat text here, then extrude onto main)
  private flatCanvas: HTMLCanvasElement | null = null;
  private flatCtx: CanvasRenderingContext2D | null = null;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: false })!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.format = THREE.RGBAFormat;
    this.startTime = performance.now() / 1000;
  }

  resize(width: number, height: number): void {
    if (this.width === width && this.height === height) return;
    this.width = width;
    this.height = height;
    this.canvas.width = width;
    this.canvas.height = height;
    this.lastText = ''; // Force re-measure
  }

  /**
   * Measure and cache letter positions for the current text
   */
  private measureLetters(content: TextContent): void {
    const key = `${content.text}|${content.fontFamily}|${content.fontSize}|${content.fontWeight}|${content.fontStyle}|${content.letterSpacing}|${content.lineHeight}|${content.alignment}`;
    if (this.lastText === key) return;
    this.lastText = key;

    const ctx = this.ctx;
    const font = `${content.fontStyle} ${content.fontWeight} ${content.fontSize}px "${content.fontFamily}"`;
    ctx.font = font;

    const lines = content.text.split('\n');
    const lineHeightPx = content.fontSize * content.lineHeight;
    const totalHeight = lines.length * lineHeightPx;
    const startY = (this.height - totalHeight) / 2 + content.fontSize * 0.8; // baseline offset

    this.letterMetrics = [];
    let globalIndex = 0;

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx];
      const chars = [...line]; // Handle unicode properly

      // Measure total line width with letter spacing
      let totalWidth = 0;
      const charWidths: number[] = [];
      for (const ch of chars) {
        const w = ctx.measureText(ch).width + content.letterSpacing;
        charWidths.push(w);
        totalWidth += w;
      }
      totalWidth -= content.letterSpacing; // Remove trailing spacing

      // Compute starting x based on alignment
      let startX: number;
      if (content.alignment === 'left') {
        startX = 40; // Small padding
      } else if (content.alignment === 'right') {
        startX = this.width - totalWidth - 40;
      } else {
        startX = (this.width - totalWidth) / 2;
      }

      let x = startX;
      for (let i = 0; i < chars.length; i++) {
        this.letterMetrics.push({
          char: chars[i],
          x,
          y: startY + lineIdx * lineHeightPx,
          width: charWidths[i],
          index: globalIndex,
          lineIndex: lineIdx,
        });
        x += charWidths[i];
        globalIndex++;
      }
    }
  }

  /**
   * Set canvas font and style from TextContent
   */
  private applyTextStyle(content: TextContent): void {
    const ctx = this.ctx;
    ctx.font = `${content.fontStyle} ${content.fontWeight} ${content.fontSize}px "${content.fontFamily}"`;
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = content.color;
    if (content.strokeWidth > 0) {
      ctx.strokeStyle = content.strokeColor;
      ctx.lineWidth = content.strokeWidth;
      ctx.lineJoin = 'round';
    }
    if (content.shadowBlur > 0 || content.shadowOffsetX !== 0 || content.shadowOffsetY !== 0) {
      ctx.shadowColor = content.shadowColor;
      ctx.shadowBlur = content.shadowBlur;
      ctx.shadowOffsetX = content.shadowOffsetX;
      ctx.shadowOffsetY = content.shadowOffsetY;
    } else {
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
    }
  }

  /**
   * Draw a single letter at position with optional transforms
   */
  private drawLetter(
    content: TextContent,
    char: string,
    x: number,
    y: number,
    alpha: number = 1,
    scaleX: number = 1,
    scaleY: number = 1,
    rotation: number = 0,
    offsetX: number = 0,
    offsetY: number = 0,
  ): void {
    if (alpha <= 0 || char === ' ') {
      if (char === ' ') {
        // Still draw space for proper spacing in stroke mode
        return;
      }
      return;
    }

    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.translate(x + offsetX, y + offsetY);
    if (rotation !== 0) ctx.rotate(rotation);
    if (scaleX !== 1 || scaleY !== 1) ctx.scale(scaleX, scaleY);

    if (content.strokeWidth > 0) {
      ctx.strokeText(char, 0, 0);
    }
    ctx.fillText(char, 0, 0);
    ctx.restore();
  }

  /**
   * Get or create the flat offscreen canvas for 3D compositing
   */
  private getFlatCanvas(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
    if (!this.flatCanvas || this.flatCanvas.width !== this.width || this.flatCanvas.height !== this.height) {
      this.flatCanvas = document.createElement('canvas');
      this.flatCanvas.width = this.width;
      this.flatCanvas.height = this.height;
      this.flatCtx = this.flatCanvas.getContext('2d')!;
    }
    return { canvas: this.flatCanvas, ctx: this.flatCtx! };
  }

  /**
   * Main render method - renders text with current animation state
   */
  render(content: TextContent, _deltaTime: number): THREE.Texture {
    const ctx = this.ctx;
    const t = performance.now() / 1000 - this.startTime;
    const speed = content.animation.speed;
    const animTime = t * speed;
    const intensity = content.animation.intensity;
    const stagger = content.animation.staggerDelay;

    // If 3D is enabled, redirect all drawing to the flat offscreen canvas first
    const use3D = content.enable3D && content.extrudeDepth > 0;
    let renderCtx: CanvasRenderingContext2D;

    if (use3D) {
      const flat = this.getFlatCanvas();
      renderCtx = flat.ctx;
      // Temporarily swap ctx so all draw methods use the flat canvas
      this.ctx = renderCtx;
      renderCtx.clearRect(0, 0, this.width, this.height);
    } else {
      renderCtx = ctx;
    }

    // Clear main canvas
    ctx.clearRect(0, 0, this.width, this.height);

    // Background (draw on main canvas always)
    if (content.backgroundColor && content.backgroundColor !== 'transparent') {
      ctx.fillStyle = content.backgroundColor;
      ctx.fillRect(0, 0, this.width, this.height);
    }

    // Measure letters
    this.measureLetters(content);
    this.applyTextStyle(content);

    const letters = this.letterMetrics;
    const anim = content.animation;

    // Dispatch to animation handler (draws to renderCtx, which is flat canvas if 3D)
    switch (anim.type) {
      case 'none':
        this.renderStatic(content, letters);
        break;
      case 'ticker':
        this.renderTicker(content, letters, animTime, intensity);
        break;
      case 'letterReveal':
        this.renderLetterReveal(content, letters, animTime, stagger, intensity);
        break;
      case 'typewriter':
        this.renderTypewriter(content, letters, animTime, stagger, intensity);
        break;
      case 'fadeInLetters':
        this.renderFadeInLetters(content, letters, animTime, stagger, intensity);
        break;
      case 'waveY':
        this.renderWaveY(content, letters, animTime, intensity);
        break;
      case 'waveX':
        this.renderWaveX(content, letters, animTime, intensity);
        break;
      case 'elastic':
        this.renderElastic(content, letters, animTime, stagger, intensity);
        break;
      case 'scramble':
        this.renderScramble(content, letters, animTime, stagger, intensity);
        break;
      case 'glitch3d':
        this.renderGlitch3D(content, letters, animTime, intensity);
        break;
      case 'perspective3d':
        this.renderPerspective3D(content, letters, animTime, intensity);
        break;
      case 'flipLetters':
        this.renderFlipLetters(content, letters, animTime, stagger, intensity);
        break;
      case 'spiralIn':
        this.renderSpiralIn(content, letters, animTime, stagger, intensity);
        break;
      case 'explode':
        this.renderExplode(content, letters, animTime, stagger, intensity);
        break;
      case 'liquid':
        this.renderLiquid(content, letters, animTime, intensity);
        break;
      case 'neonPulse':
        this.renderNeonPulse(content, letters, animTime, intensity);
        break;
      case 'matrixRain':
        this.renderMatrixRain(content, letters, animTime, intensity);
        break;
      case 'bounce':
        this.renderBounce(content, letters, animTime, stagger, intensity);
        break;
      default:
        this.renderStatic(content, letters);
    }

    // If 3D, restore ctx and composite the flat render with extrusion
    if (use3D) {
      this.ctx = ctx; // Restore original ctx
      this.render3DExtrusion(content, this.flatCanvas!);
    }

    this.texture.needsUpdate = true;
    return this.texture;
  }

  // ========================================================================
  // 3D EXTRUSION & ISOMETRIC ROTATION
  // ========================================================================

  /**
   * Takes the flat-rendered text and composites it with 3D depth extrusion
   * and isometric rotation onto the main canvas.
   */
  private render3DExtrusion(content: TextContent, flatCanvas: HTMLCanvasElement): void {
    const ctx = this.ctx;
    const depth = content.extrudeDepth;
    const rxDeg = content.rotateX;
    const ryDeg = content.rotateY;
    const rzDeg = content.rotateZ;
    const lightAngle = content.lightAngle * Math.PI / 180;
    const lightIntensity = content.lightIntensity;

    // Convert rotation to radians
    const rx = rxDeg * Math.PI / 180;
    const ry = ryDeg * Math.PI / 180;
    const rz = rzDeg * Math.PI / 180;

    // Compute the 3D extrusion direction projected into 2D
    // The depth layers go "into" the screen (negative Z).
    // After isometric rotation, the Z-axis projects onto screen as:
    const cosRx = Math.cos(rx);
    const sinRx = Math.sin(rx);
    const cosRy = Math.cos(ry);
    const sinRy = Math.sin(ry);

    // Direction a single depth step moves in screen space
    // Based on projecting (0, 0, -1) through the rotation matrix
    const stepX = sinRy;                    // X component of projected depth
    const stepY = -sinRx * cosRy;           // Y component of projected depth

    // Scale factor for the front face based on rotation
    // Mild foreshortening: cos(angle) makes the face narrower when rotated
    const scaleXFace = Math.abs(cosRy);
    const scaleYFace = Math.abs(cosRx);

    // Build 2D affine transform for the isometric "face" rotation + Z-rotate
    const cosRz = Math.cos(rz);
    const sinRz = Math.sin(rz);

    // Combined transform: scale by foreshortening, then Z-rotate
    // [a, b]   [cosRz, -sinRz]   [scaleX, 0    ]
    // [c, d] = [sinRz,  cosRz] * [0,      scaleY]
    const a = cosRz * scaleXFace;
    const b = -sinRz * scaleYFace;
    const c = sinRz * scaleXFace;
    const d = cosRz * scaleYFace;

    // Center of canvas
    const cx = this.width / 2;
    const cy = this.height / 2;

    // Parse extrude color for shading
    const baseColor = this.parseColor(content.extrudeColor);

    // Number of depth slices (1px per slice for smooth extrusion)
    const numSlices = Math.ceil(depth);

    // Draw depth slices back-to-front
    for (let i = numSlices; i >= 0; i--) {
      const t = i / Math.max(numSlices, 1);
      const offsetX = stepX * depth * t;
      const offsetY = stepY * depth * t;

      ctx.save();

      // Apply transform centered on canvas
      ctx.translate(cx + offsetX, cy + offsetY);
      ctx.transform(a, c, b, d, 0, 0);
      ctx.translate(-cx, -cy);

      if (i > 0) {
        // Depth slice: tint the flat image with the extrude color + lighting
        // Light shading: slices closer to the back get darker based on light angle
        const lightFactor = 0.5 + 0.5 * Math.cos(lightAngle - Math.atan2(stepY, stepX));
        const shade = 1.0 - lightIntensity * (1.0 - lightFactor * (1.0 - t * 0.5));

        ctx.drawImage(flatCanvas, 0, 0);

        // Tint by compositing the extrude color
        ctx.globalCompositeOperation = 'source-atop';
        ctx.fillStyle = `rgba(${Math.round(baseColor.r * shade)}, ${Math.round(baseColor.g * shade)}, ${Math.round(baseColor.b * shade)}, 1)`;
        ctx.fillRect(0, 0, this.width, this.height);
        ctx.globalCompositeOperation = 'source-over';
      } else {
        // Front face: draw the original flat text
        ctx.drawImage(flatCanvas, 0, 0);

        // Optional bevel highlight on the top face
        if (content.bevelSize > 0) {
          ctx.globalCompositeOperation = 'source-atop';
          // Create a subtle bright edge at the top of the text
          const bevelGrad = ctx.createLinearGradient(0, 0, 0, this.height);
          bevelGrad.addColorStop(0, `rgba(255,255,255,${0.3 * content.bevelSize / 10})`);
          bevelGrad.addColorStop(0.15, 'rgba(255,255,255,0)');
          bevelGrad.addColorStop(0.85, 'rgba(0,0,0,0)');
          bevelGrad.addColorStop(1, `rgba(0,0,0,${0.2 * content.bevelSize / 10})`);
          ctx.fillStyle = bevelGrad;
          ctx.fillRect(0, 0, this.width, this.height);
          ctx.globalCompositeOperation = 'source-over';
        }
      }

      ctx.restore();
    }
  }

  /**
   * Parse a CSS hex color to RGB components
   */
  private parseColor(hex: string): { r: number; g: number; b: number } {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (result) {
      return {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      };
    }
    return { r: 68, g: 68, b: 68 }; // fallback gray
  }

  // ========================================================================
  // ANIMATION IMPLEMENTATIONS
  // ========================================================================

  /** No animation - just draw text */
  private renderStatic(content: TextContent, letters: LetterMetrics[]): void {
    for (const l of letters) {
      this.drawLetter(content, l.char, l.x, l.y);
    }
  }

  /** Continuous horizontal scroll loop - classic ticker/marquee */
  private renderTicker(content: TextContent, letters: LetterMetrics[], t: number, intensity: number): void {
    if (letters.length === 0) return;

    // Calculate total text width
    const lastLetter = letters[letters.length - 1];
    const totalWidth = lastLetter.x + lastLetter.width - letters[0].x;
    const scrollWidth = totalWidth + this.width; // Full cycle includes off-screen
    const scrollSpeed = 200 * intensity; // pixels per second
    const offset = (t * scrollSpeed) % scrollWidth;

    for (const l of letters) {
      const scrolledX = l.x - offset + this.width;
      // Wrap around
      const wrappedX = ((scrolledX % scrollWidth) + scrollWidth) % scrollWidth - this.width * 0.1;
      this.drawLetter(content, l.char, wrappedX, l.y);
    }
  }

  /** Letters appear one by one with a glow burst */
  private renderLetterReveal(content: TextContent, letters: LetterMetrics[], t: number, stagger: number, intensity: number): void {
    const totalDuration = letters.length * stagger + 0.5;
    const loopT = t % (totalDuration + 1.0);

    const ctx = this.ctx;
    for (const l of letters) {
      const revealTime = l.index * stagger;
      const progress = Math.max(0, Math.min(1, (loopT - revealTime) / 0.3));

      if (progress <= 0) continue;

      // Glow burst on reveal
      const glowPhase = Math.max(0, 1 - (loopT - revealTime) / 0.5);
      if (glowPhase > 0 && intensity > 0) {
        ctx.save();
        ctx.shadowColor = content.color;
        ctx.shadowBlur = 30 * glowPhase * intensity;
        ctx.globalAlpha = glowPhase * 0.5;
        ctx.fillText(l.char, l.x, l.y);
        ctx.restore();
        this.applyTextStyle(content);
      }

      const scale = 0.5 + 0.5 * this.easeOutBack(progress);
      this.drawLetter(content, l.char, l.x, l.y, progress, scale, scale);
    }
  }

  /** Classic typewriter with blinking cursor */
  private renderTypewriter(content: TextContent, letters: LetterMetrics[], t: number, stagger: number, intensity: number): void {
    const totalDuration = letters.length * stagger + 2.0;
    const loopT = t % totalDuration;
    const visibleCount = Math.floor(loopT / stagger);

    const ctx = this.ctx;
    for (let i = 0; i < Math.min(visibleCount, letters.length); i++) {
      const l = letters[i];
      this.drawLetter(content, l.char, l.x, l.y);
    }

    // Blinking cursor
    const cursorIndex = Math.min(visibleCount, letters.length - 1);
    if (cursorIndex >= 0 && cursorIndex < letters.length) {
      const cursorBlink = Math.sin(t * 6) > 0;
      if (cursorBlink) {
        const cl = letters[cursorIndex];
        const cursorX = cl.x + cl.width + 4;
        ctx.save();
        ctx.fillStyle = content.color;
        ctx.globalAlpha = intensity;
        ctx.fillRect(cursorX, cl.y - content.fontSize * 0.8, 3, content.fontSize);
        ctx.restore();
        this.applyTextStyle(content);
      }
    }
  }

  /** Each letter fades from 0 to 1 opacity sequentially */
  private renderFadeInLetters(content: TextContent, letters: LetterMetrics[], t: number, stagger: number, _intensity: number): void {
    const totalDuration = letters.length * stagger + 1.0;
    const loopT = t % (totalDuration + 2.0);

    for (const l of letters) {
      const fadeStart = l.index * stagger;
      const alpha = Math.max(0, Math.min(1, (loopT - fadeStart) / 0.5));
      if (alpha <= 0) continue;
      this.drawLetter(content, l.char, l.x, l.y, alpha);
    }
  }

  /** Vertical sine wave displacement per letter */
  private renderWaveY(content: TextContent, letters: LetterMetrics[], t: number, intensity: number): void {
    const amplitude = 30 * intensity;
    const frequency = 0.15;
    const phase = t * 4;

    for (const l of letters) {
      const offsetY = Math.sin(l.index * frequency + phase) * amplitude;
      this.drawLetter(content, l.char, l.x, l.y, 1, 1, 1, 0, 0, offsetY);
    }
  }

  /** Horizontal sine wave displacement per letter */
  private renderWaveX(content: TextContent, letters: LetterMetrics[], t: number, intensity: number): void {
    const amplitude = 20 * intensity;
    const frequency = 0.2;
    const phase = t * 3;

    for (const l of letters) {
      const offsetX = Math.sin(l.index * frequency + phase) * amplitude;
      this.drawLetter(content, l.char, l.x, l.y, 1, 1, 1, 0, offsetX, 0);
    }
  }

  /** Letters bounce in with elastic overshoot */
  private renderElastic(content: TextContent, letters: LetterMetrics[], t: number, stagger: number, intensity: number): void {
    const totalDuration = letters.length * stagger + 1.5;
    const loopT = t % (totalDuration + 1.0);

    for (const l of letters) {
      const entryTime = l.index * stagger;
      const progress = Math.max(0, (loopT - entryTime) / 0.8);

      if (progress <= 0) continue;

      const elasticProgress = this.easeOutElastic(Math.min(1, progress));
      const scale = elasticProgress * intensity + (1 - intensity);
      const offsetY = (1 - elasticProgress) * -200 * intensity;

      this.drawLetter(content, l.char, l.x, l.y, Math.min(1, progress * 2), scale, scale, 0, 0, offsetY);
    }
  }

  /** Random characters resolve to correct ones */
  private renderScramble(content: TextContent, letters: LetterMetrics[], t: number, stagger: number, intensity: number): void {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
    const totalDuration = letters.length * stagger + 1.0;
    const loopT = t % (totalDuration + 2.0);

    for (const l of letters) {
      const resolveTime = l.index * stagger;
      const progress = Math.max(0, Math.min(1, (loopT - resolveTime) / 0.6));

      if (loopT < resolveTime - 0.2) continue;

      let displayChar: string;
      if (progress >= 1) {
        displayChar = l.char;
      } else {
        // Scramble with decreasing randomness
        const scrambleChance = (1 - progress) * intensity;
        if (Math.random() < scrambleChance) {
          displayChar = chars[Math.floor(Math.random() * chars.length)];
        } else {
          displayChar = l.char;
        }
      }

      this.drawLetter(content, displayChar, l.x, l.y, Math.min(1, progress + 0.3));
    }
  }

  /** RGB split + perspective skew + noise bursts */
  private renderGlitch3D(content: TextContent, letters: LetterMetrics[], t: number, intensity: number): void {
    const ctx = this.ctx;
    const glitchPhase = Math.sin(t * 7) * Math.sin(t * 13);
    const isGlitching = Math.abs(glitchPhase) > 0.7;
    const glitchAmount = isGlitching ? (Math.abs(glitchPhase) - 0.7) / 0.3 * intensity : 0;

    // Draw with RGB channel separation
    const offsets = [
      { color: `rgba(255,0,0,${0.7 + glitchAmount * 0.3})`, dx: -4 * glitchAmount, dy: -2 * glitchAmount },
      { color: `rgba(0,255,0,${0.7 + glitchAmount * 0.3})`, dx: 2 * glitchAmount, dy: 1 * glitchAmount },
      { color: `rgba(0,0,255,${0.7 + glitchAmount * 0.3})`, dx: -1 * glitchAmount, dy: 3 * glitchAmount },
    ];

    if (glitchAmount > 0.1) {
      // RGB split passes
      for (const offset of offsets) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = offset.color;
        ctx.font = `${content.fontStyle} ${content.fontWeight} ${content.fontSize}px "${content.fontFamily}"`;
        ctx.textBaseline = 'alphabetic';

        // Perspective skew
        const skewAngle = (Math.random() - 0.5) * 0.1 * glitchAmount;
        ctx.transform(1, skewAngle, 0, 1, 0, 0);

        for (const l of letters) {
          const jitterX = (Math.random() - 0.5) * 10 * glitchAmount;
          const jitterY = (Math.random() - 0.5) * 6 * glitchAmount;
          ctx.fillText(l.char, l.x + offset.dx * 5 + jitterX, l.y + offset.dy * 5 + jitterY);
        }
        ctx.restore();
      }

      // Noise scan lines
      if (glitchAmount > 0.5) {
        ctx.save();
        ctx.globalAlpha = glitchAmount * 0.3;
        for (let y = 0; y < this.height; y += 3) {
          if (Math.random() > 0.85) {
            ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.3})`;
            ctx.fillRect(0, y, this.width, 1 + Math.random() * 2);
          }
        }
        ctx.restore();
      }
    } else {
      // Normal rendering when not glitching
      this.applyTextStyle(content);
      for (const l of letters) {
        this.drawLetter(content, l.char, l.x, l.y);
      }
    }
  }

  /** Rotating text with faux-3D perspective transform */
  private renderPerspective3D(content: TextContent, letters: LetterMetrics[], t: number, intensity: number): void {
    const ctx = this.ctx;
    const rotationAngle = t * 0.5 * intensity;

    ctx.save();
    // Center the transform
    ctx.translate(this.width / 2, this.height / 2);

    // Simulate 3D rotation around Y axis
    const cosY = Math.cos(rotationAngle);
    const sinY = Math.sin(rotationAngle);
    const scaleX = Math.abs(cosY);

    ctx.scale(scaleX || 0.01, 1);

    // Depth shading
    const brightness = 0.5 + 0.5 * Math.abs(cosY);

    this.applyTextStyle(content);

    for (const l of letters) {
      const centeredX = l.x - this.width / 2;
      const centeredY = l.y - this.height / 2;

      // Apply perspective scaling based on horizontal position
      const depthScale = 1 + (centeredX / this.width) * sinY * 0.5 * intensity;

      ctx.save();
      ctx.translate(centeredX, centeredY);
      ctx.scale(depthScale, depthScale);
      ctx.globalAlpha = brightness;

      if (content.strokeWidth > 0) ctx.strokeText(l.char, 0, 0);
      ctx.fillText(l.char, 0, 0);
      ctx.restore();
    }

    ctx.restore();
  }

  /** Individual letter Y-axis rotation (flip) */
  private renderFlipLetters(content: TextContent, letters: LetterMetrics[], t: number, _stagger: number, intensity: number): void {
    for (const l of letters) {
      const phase = t * 2 + l.index * 0.3;
      const flipProgress = Math.cos(phase) * intensity;
      const scaleX = Math.abs(flipProgress) * 0.7 + 0.3;
      const alpha = 0.3 + 0.7 * scaleX;

      this.drawLetter(content, l.char, l.x + l.width / 2, l.y, alpha, scaleX, 1, 0, -l.width / 2 * scaleX, 0);
    }
  }

  /** Letters spiral in from outside to final position */
  private renderSpiralIn(content: TextContent, letters: LetterMetrics[], t: number, stagger: number, intensity: number): void {
    const totalDuration = letters.length * stagger + 1.5;
    const loopT = t % (totalDuration + 1.5);

    for (const l of letters) {
      const entryTime = l.index * stagger;
      const progress = Math.max(0, Math.min(1, (loopT - entryTime) / 1.0));

      if (progress <= 0) continue;

      const eased = this.easeOutCubic(progress);
      const spiralAngle = (1 - eased) * Math.PI * 4 * intensity;
      const spiralRadius = (1 - eased) * 400 * intensity;

      const targetX = l.x;
      const targetY = l.y;
      const currentX = targetX + Math.cos(spiralAngle) * spiralRadius;
      const currentY = targetY + Math.sin(spiralAngle) * spiralRadius;
      const rotation = (1 - eased) * Math.PI * 2 * intensity;

      this.drawLetter(content, l.char, currentX, currentY, eased, eased, eased, rotation);
    }
  }

  /** Letters burst outward then reassemble */
  private renderExplode(content: TextContent, letters: LetterMetrics[], t: number, _stagger: number, intensity: number): void {
    const cycleDuration = 4.0;
    const loopT = t % cycleDuration;

    // Phase: 0-1 = assembled, 1-2 = exploding, 2-3 = scattered, 3-4 = reassembling
    let phase: number;
    let progress: number;
    if (loopT < 1) {
      phase = 0; progress = 0; // Static
    } else if (loopT < 2) {
      phase = 1; progress = (loopT - 1); // Exploding
    } else if (loopT < 3) {
      phase = 2; progress = 1; // Scattered
    } else {
      phase = 3; progress = 1 - (loopT - 3); // Reassembling
    }

    const explodeAmount = phase === 0 ? 0 : phase === 1 ? this.easeOutCubic(progress) : phase === 2 ? 1 : this.easeInCubic(progress);

    for (const l of letters) {
      // Each letter has a unique explosion direction based on index
      const angle = (l.index / letters.length) * Math.PI * 2 + l.index * 1.5;
      const distance = (150 + l.index * 30) * intensity;

      const offsetX = Math.cos(angle) * distance * explodeAmount;
      const offsetY = Math.sin(angle) * distance * explodeAmount;
      const rotation = explodeAmount * (l.index % 2 === 0 ? 1 : -1) * Math.PI * intensity;
      const scale = 1 - explodeAmount * 0.3;
      const alpha = 1 - explodeAmount * 0.4;

      this.drawLetter(content, l.char, l.x, l.y, alpha, scale, scale, rotation, offsetX, offsetY);
    }
  }

  /** Fluid distortion warping each letter */
  private renderLiquid(content: TextContent, letters: LetterMetrics[], t: number, intensity: number): void {
    for (const l of letters) {
      const freq1 = 0.02, freq2 = 0.03;
      const offsetX = Math.sin(l.y * freq1 + t * 2) * 15 * intensity +
                       Math.sin(l.x * freq2 + t * 1.5) * 10 * intensity;
      const offsetY = Math.cos(l.x * freq1 + t * 1.7) * 12 * intensity +
                       Math.cos(l.y * freq2 + t * 2.3) * 8 * intensity;
      const scaleX = 1 + Math.sin(t * 3 + l.index * 0.5) * 0.15 * intensity;
      const scaleY = 1 + Math.cos(t * 2.5 + l.index * 0.7) * 0.15 * intensity;
      const rotation = Math.sin(t * 1.5 + l.index * 0.4) * 0.1 * intensity;

      this.drawLetter(content, l.char, l.x, l.y, 1, scaleX, scaleY, rotation, offsetX, offsetY);
    }
  }

  /** Glow intensity cycles with neon bloom effect */
  private renderNeonPulse(content: TextContent, letters: LetterMetrics[], t: number, intensity: number): void {
    const ctx = this.ctx;
    const pulse = (Math.sin(t * 3) + 1) / 2;
    const flickerChance = Math.sin(t * 47) * Math.sin(t * 73);
    const flicker = flickerChance > 0.95 ? 0.3 : 1.0;

    // Multiple glow passes for bloom
    const glowLayers = [
      { blur: 40 * intensity, alpha: 0.15 * pulse * flicker },
      { blur: 20 * intensity, alpha: 0.3 * pulse * flicker },
      { blur: 10 * intensity, alpha: 0.5 * flicker },
      { blur: 4, alpha: 0.8 * flicker },
    ];

    for (const glow of glowLayers) {
      ctx.save();
      ctx.shadowColor = content.color;
      ctx.shadowBlur = glow.blur;
      ctx.globalAlpha = glow.alpha;
      ctx.fillStyle = content.color;
      ctx.font = `${content.fontStyle} ${content.fontWeight} ${content.fontSize}px "${content.fontFamily}"`;
      ctx.textBaseline = 'alphabetic';

      for (const l of letters) {
        ctx.fillText(l.char, l.x, l.y);
      }
      ctx.restore();
    }

    // Core text
    ctx.save();
    ctx.globalAlpha = flicker;
    ctx.fillStyle = '#ffffff';
    ctx.font = `${content.fontStyle} ${content.fontWeight} ${content.fontSize}px "${content.fontFamily}"`;
    ctx.textBaseline = 'alphabetic';
    for (const l of letters) {
      ctx.fillText(l.char, l.x, l.y);
    }
    ctx.restore();

    this.applyTextStyle(content);
  }

  /** Characters cascade down like Matrix digital rain */
  private renderMatrixRain(content: TextContent, letters: LetterMetrics[], t: number, intensity: number): void {
    const ctx = this.ctx;
    const matrixChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789@#$%^&*()ゲギグゴザジズゼゾ';
    const columnWidth = content.fontSize * 0.7;
    const numColumns = Math.ceil(this.width / columnWidth);
    const fallSpeed = 150 * intensity;

    // Background dim
    ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
    ctx.fillRect(0, 0, this.width, this.height);

    ctx.font = `${content.fontWeight} ${content.fontSize * 0.6}px "${content.fontFamily}"`;
    ctx.textBaseline = 'top';

    // Rain columns
    for (let col = 0; col < numColumns; col++) {
      const seed = col * 7.3 + 0.1;
      const speed = (0.5 + this.pseudoRandom(seed) * 0.5) * fallSpeed;
      const offset = this.pseudoRandom(seed + 1) * this.height * 3;
      const x = col * columnWidth;

      const headY = ((t * speed + offset) % (this.height * 1.5));
      const trailLength = 10 + Math.floor(this.pseudoRandom(seed + 2) * 15);

      for (let i = 0; i < trailLength; i++) {
        const charY = headY - i * content.fontSize * 0.7;
        if (charY < -content.fontSize || charY > this.height) continue;

        const alpha = (1 - i / trailLength);
        const isHead = i === 0;

        ctx.save();
        if (isHead) {
          ctx.fillStyle = '#ffffff';
          ctx.shadowColor = '#00ff00';
          ctx.shadowBlur = 15;
          ctx.globalAlpha = 1;
        } else {
          ctx.fillStyle = `rgba(0, 255, 70, ${alpha * 0.8})`;
          ctx.globalAlpha = alpha;
        }

        const charIndex = Math.floor(this.pseudoRandom(seed + i * 3.7 + Math.floor(t * 8)) * matrixChars.length);
        ctx.fillText(matrixChars[charIndex], x, charY);
        ctx.restore();
      }
    }

    // Overlay the actual text with glow
    ctx.save();
    ctx.font = `${content.fontStyle} ${content.fontWeight} ${content.fontSize}px "${content.fontFamily}"`;
    ctx.textBaseline = 'alphabetic';
    ctx.shadowColor = '#00ff00';
    ctx.shadowBlur = 20 * intensity;
    ctx.fillStyle = '#00ff00';
    ctx.globalAlpha = 0.7 + 0.3 * Math.sin(t * 4);

    for (const l of letters) {
      // Occasionally replace with random char
      const char = Math.random() > 0.05 ? l.char : matrixChars[Math.floor(Math.random() * matrixChars.length)];
      ctx.fillText(char, l.x, l.y);
    }
    ctx.restore();

    this.applyTextStyle(content);
  }

  /** Physics-based bounce from top */
  private renderBounce(content: TextContent, letters: LetterMetrics[], t: number, stagger: number, intensity: number): void {
    const totalDuration = letters.length * stagger + 2.0;
    const loopT = t % (totalDuration + 1.0);

    for (const l of letters) {
      const dropTime = l.index * stagger;
      const elapsed = loopT - dropTime;

      if (elapsed < 0) continue;

      // Simple bouncing physics
      const startY = -100;
      const targetY = l.y;
      const dropHeight = targetY - startY;

      let currentY: number;
      let alpha = 1;

      if (elapsed < 0.5) {
        // Falling
        const fallProgress = elapsed / 0.5;
        currentY = startY + dropHeight * this.easeInQuad(fallProgress);
      } else {
        // Bouncing
        const bounceTime = elapsed - 0.5;
        const dampening = Math.exp(-bounceTime * 4);
        const bounceY = Math.abs(Math.sin(bounceTime * 8)) * 80 * dampening * intensity;
        currentY = targetY - bounceY;
      }

      // Squash and stretch
      const vy = elapsed < 0.5 ? elapsed * 4 : Math.cos((elapsed - 0.5) * 8) * Math.exp(-(elapsed - 0.5) * 4);
      const squash = 1 + Math.abs(vy) * 0.2 * intensity;
      const stretch = 1 / squash;

      this.drawLetter(content, l.char, l.x, currentY, alpha, stretch, squash);
    }
  }

  // ========================================================================
  // EASING FUNCTIONS
  // ========================================================================

  private easeOutBack(t: number): number {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  }

  private easeOutElastic(t: number): number {
    if (t === 0 || t === 1) return t;
    const c4 = (2 * Math.PI) / 3;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  }

  private easeOutCubic(t: number): number {
    return 1 - Math.pow(1 - t, 3);
  }

  private easeInCubic(t: number): number {
    return t * t * t;
  }

  private easeInQuad(t: number): number {
    return t * t;
  }

  /** Deterministic pseudo-random based on seed */
  private pseudoRandom(seed: number): number {
    const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
    return x - Math.floor(x);
  }

  // ========================================================================
  // CLEANUP
  // ========================================================================

  dispose(): void {
    this.texture.dispose();
  }
}
