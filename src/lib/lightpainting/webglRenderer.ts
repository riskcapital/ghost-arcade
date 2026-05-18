/**
 * webglRenderer — WebGL2 light-painting renderer.
 *
 * Replaces the Canvas2D renderer entirely. Strokes are drawn via
 * INSTANCED quads — one draw call can stamp every brush point in a
 * stroke. All brush appearances live in fragment shaders (see
 * `webglShaders.ts`); the orchestrator's job is to:
 *
 *   1. Build per-stamp attribute buffers from each stroke's
 *      sampled points.
 *   2. Bake completed strokes into a PERSISTENT framebuffer (the
 *      "committed canvas" pattern) so they stop costing per-frame
 *      work the moment the user finishes drawing them.
 *   3. Render the currently-being-drawn stroke + the live preview
 *      stroke into a CURRENT-FRAME framebuffer.
 *   4. Composite committed + current → output canvas, applying
 *      echo and multi-color glow if enabled.
 *   5. Wrap the output canvas as a Three.js CanvasTexture so the
 *      rest of the rendering pipeline sees the same API the
 *      Canvas2D renderer exposes.
 *
 * Public API matches `LightPaintingRenderer` exactly.
 *
 * Phase-3 additions (Mar 2026):
 *   - Per-stamp attribute count bumped 12 → 19 to carry the new
 *     procedural params (particleSize, internalGlow, noiseScale,
 *     noiseSpeed, noiseAmount, complexity, progress).
 *   - Draw animation now respected: when content.isPlaying, each
 *     stroke samples only up to `Math.floor(points.length * progress)`
 *     so new brushes animate during draw playback alongside legacy ones.
 */

import * as THREE from 'three';
import type {
  LightPaintingContent,
  LightPaintingStroke,
  LightPaintingBrush,
  LightPaintingBrushType,
  LightPaintingStrokePoint,
} from '../types';
import {
  STAMP_VERT,
  STAMP_FRAG,
  COMPOSITE_VERT,
  COMPOSITE_FRAG,
  STRIP_VERT,
  STRIP_FRAG,
  BLUR_FRAG,
  SPARKLE_FRAG,
} from './webglShaders';

/* ============================================================== */
/* Brush metadata                                                  */
/* ============================================================== */

// Brush types owned by the WebGPU stroke-particles compute pass in
// WebGPUCanvas — webglRenderer SKIPS these in its main draw loop so
// they don't double-render (once via WebGL2 stamps, once via WebGPU
// particles). The compute pass reads strokes directly from the
// project store; nothing here needs to forward them.
//
// Original organic set (spiral / firefly / sap-flow / water / smoke)
// has been here since the GPU brush effort started. The premium-port
// brushes (galaxy / nebula / sparkle / vortex / plasma) were
// previously rendered as WebGL2 fragment-shader stamps on instanced
// quads; they now run as real GPU compute particle systems through
// webgpuStrokeParticles.ts for the higher density + "alive" feel.
// On non-WebGPU hardware these brushes won't render — same trade-off
// as the original organic set.
const GPU_COMPUTE_BRUSH_TYPES = new Set<LightPaintingBrushType>([
  'spiral', 'firefly', 'sap-flow', 'water', 'smoke',
  'galaxy', 'nebula', 'sparkle', 'vortex', 'plasma',
]);

// Numeric brush type IDs — must match the u_brushType dispatch in
// STAMP_FRAG. Keep in lockstep with that shader. The GPU compute
// brushes (spiral/firefly/sap-flow/water/smoke) get sentinel IDs
// because they're skipped before reaching the shader; the values
// are placeholders to satisfy `Record<LightPaintingBrushType, …>`.
const BRUSH_TYPE_ID: Record<LightPaintingBrushType, number> = {
  // Phase 1 — Canvas2D-parity brushes
  glow: 0, neon: 1, laser: 2, calligraphy: 3, marker: 4,
  flame: 5, electric: 6, ribbon: 7, particle: 8,
  smoke: 9, spray: 10, paintbrush: 11, watercolor: 12,
  // Phase 2 — WebGL2-only procedural brushes
  sparkle: 13, firefly: 14, plasma: 15, galaxy: 16, lightning: 17, vortex: 18,
  // Phase 3 — additional WebGL2-only brushes
  nebula: 19, kaleido: 20, ink: 21, crystal: 22, aurora: 23, bubbles: 24,
  // GPU compute brushes — never reach the shader, sentinel IDs.
  spiral: -1, 'sap-flow': -1, water: -1,
};

// Brushes whose quad must be ROTATED by the stroke direction.
const ANGLE_DEPENDENT: Record<LightPaintingBrushType, boolean> = {
  glow: false, neon: false, laser: false,
  calligraphy: true, marker: true, paintbrush: true,
  flame: false, electric: false, ribbon: false, particle: false,
  smoke: false, spray: false, watercolor: false,
  sparkle: false, firefly: false, plasma: false, galaxy: false,
  lightning: false, vortex: false,
  nebula: false, kaleido: false, ink: false, crystal: false,
  aurora: false, bubbles: false,
  // GPU compute brushes — sentinel values, never read.
  spiral: false, 'sap-flow': false, water: false,
};

// Extent scale multiplier — how big the quad needs to be relative
// to brush.size to fully contain the brush's visual (including
// glow/halo bleed). Quad covers [-extent, +extent] in both axes.
const EXTENT_SCALE: Record<LightPaintingBrushType, number> = {
  glow: 2.5, neon: 2.5, laser: 4.0,
  calligraphy: 1.1, marker: 1.05, paintbrush: 1.05,
  flame: 1.4, electric: 1.5, ribbon: 1.2, particle: 1.5,
  smoke: 1.5, spray: 1.05, watercolor: 1.3,
  // Phase 2 — original extents.
  sparkle: 1.4, firefly: 1.4, plasma: 1.3, galaxy: 1.3,
  lightning: 1.3, vortex: 1.3,
  // Phase 3 — new procedural brushes.
  nebula: 2.2, kaleido: 1.9, ink: 1.9, crystal: 1.8,
  aurora: 2.2, bubbles: 2.0,
  // GPU compute brushes — sentinel values, never read.
  spiral: 1.0, 'sap-flow': 1.0, water: 1.0,
};

// Brushes that need to re-render every frame because their fragment
// shader is time-driven. Without this, the committed framebuffer
// holds the first-render snapshot forever — flame, electric, bubbles,
// etc. would freeze. We only want to skip per-frame work for purely
// static brush types (glow, neon, laser, calligraphy, marker, smoke,
// spray, paintbrush, watercolor).
const ANIMATED_BRUSH: Record<LightPaintingBrushType, boolean> = {
  glow: false, neon: false, laser: false,
  calligraphy: false, marker: false, paintbrush: false,
  smoke: false, spray: false, watercolor: false,
  flame: true, electric: true, ribbon: true, particle: true,
  sparkle: true, firefly: true, plasma: true, galaxy: true,
  lightning: true, vortex: true,
  nebula: true, kaleido: true, ink: true, crystal: true,
  aurora: true, bubbles: true,
  // GPU compute brushes — sentinel values, never read.
  spiral: false, 'sap-flow': false, water: false,
};

// Per-stamp attribute layout. 19 floats per instance (76 bytes).
// Position(2) + size(1) + angle(1) + color(3) + alpha(1) + glow(1)
//   + softness(1) + seed(1) + time(1) + progress(1)
//   + particleSize(1) + internalGlow(1) + noiseScale(1) + noiseSpeed(1)
//   + noiseAmount(1) + complexity(1)
// = 19 floats per instance.
const FLOATS_PER = 19;
const STRIDE_BYTES = FLOATS_PER * 4;

/* ============================================================== */
/* Stroke geometry builder                                         */
/* ============================================================== */

interface StampSample {
  x: number;
  y: number;
  size: number;
  angle: number;
  pressure: number;
  progress: number;
  alpha: number;
  seed: number;
  time: number;
}

/** Sample a stroke into per-stamp records ready for the GPU.
 *  Mirrors the legacy Canvas2D renderer's resampling + taper +
 *  progress math 1:1 so visual output stays consistent. */
function sampleStroke(
  stroke: LightPaintingStroke,
  width: number,
  height: number,
  drawUpTo: number,
  trailLen: number,
  timeS: number,
  opacityScale: number,
): StampSample[] {
  const points = stroke.points;
  if (points.length === 0) return [];
  const brush = stroke.brush;

  const totalPoints = points.length;
  const trailStart = trailLen > 0 ? Math.max(0, drawUpTo - trailLen) : 0;

  const tightBrush = brush.type === 'calligraphy' || brush.type === 'paintbrush'
                  || brush.type === 'marker' || brush.type === 'ribbon';
  const stepSpacing = tightBrush ? 0.04 : 0.08;
  const step = Math.max(1, Math.ceil(brush.size * stepSpacing));

  const samples: StampSample[] = [];
  let stampIndex = 0;
  for (let i = trailStart; i < drawUpTo; i++) {
    const aligned = (i - trailStart) % step === 0 || i === drawUpTo - 1;
    if (!aligned) continue;

    const p = points[i];
    const px = p.x * width;
    const py = p.y * height;

    const progress = totalPoints > 1 ? i / (totalPoints - 1) : 0;

    let taperMult = 1;
    if (brush.taper) {
      const taperIn  = Math.min(1, progress * 5);
      const taperOut = Math.min(1, (1 - progress) * 5);
      taperMult = taperIn * taperOut;
    }

    const pressure = brush.pressureSensitive ? p.pressure : 1;
    const size = Math.max(1, brush.size * pressure * taperMult);
    const alpha = Math.max(0, Math.min(1, brush.opacity * taperMult * opacityScale));

    let trailAlpha = 1;
    if (trailLen > 0 && trailLen < totalPoints) {
      const trailIdx = i - trailStart;
      trailAlpha = trailIdx / Math.max(1, trailLen - 1);
    }

    let jx = px, jy = py;
    if (brush.jitter > 0) {
      const h1 = Math.sin(i * 12.9898) * 43758.5453;
      const h2 = Math.sin(i * 78.233) * 43758.5453;
      jx += (h1 - Math.floor(h1) - 0.5) * brush.jitter * brush.size * 2;
      jy += (h2 - Math.floor(h2) - 0.5) * brush.jitter * brush.size * 2;
    }

    let angle = 0;
    if (i > 0) {
      const prev = points[i - 1];
      angle = Math.atan2(py - prev.y * height, px - prev.x * width);
    } else if (i < totalPoints - 1) {
      const next = points[i + 1];
      angle = Math.atan2(next.y * height - py, next.x * width - px);
    }

    samples.push({
      x: jx, y: jy,
      size,
      angle,
      pressure,
      progress,
      alpha: alpha * trailAlpha,
      seed: stampIndex * 0.137 + i * 0.013,
      time: timeS * (brush.speed ?? 1),
    });
    stampIndex++;
  }
  return samples;
}

/* ============================================================== */
/* WebGL2 helpers                                                  */
/* ============================================================== */

function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`Shader compile failed: ${log}\n\nSource:\n${src}`);
  }
  return sh;
}

function linkProgram(gl: WebGL2RenderingContext, vsrc: string, fsrc: string): WebGLProgram {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsrc);
  const program = gl.createProgram()!;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Program link failed: ${log}`);
  }
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  return program;
}

function makeRenderTarget(gl: WebGL2RenderingContext, w: number, h: number): {
  tex: WebGLTexture;
  fb: WebGLFramebuffer;
} {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const fb = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);

  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error(`Framebuffer incomplete: 0x${status.toString(16)}`);
  }

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fb };
}

/* ============================================================== */
/* The renderer                                                    */
/* ============================================================== */

// Stable anchor for animation time (matches the legacy renderer's
// LP_TIME_ANCHOR_MS — see renderer.ts comment). Anchor at midnight
// so the FP arithmetic stays bounded.
const LP_TIME_ANCHOR_MS = (() => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
})();

export class LightPaintingWebGLRenderer {
  private canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private texture: THREE.CanvasTexture;
  private width: number;
  private height: number;

  private stampProgram: WebGLProgram;
  private compositeProgram: WebGLProgram;
  private stripProgram: WebGLProgram;
  private blurProgram: WebGLProgram;
  private sparkleProgram: WebGLProgram;

  private stampUniforms: {
    resolution: WebGLUniformLocation | null;
    brushType: WebGLUniformLocation | null;
    useAngle: WebGLUniformLocation | null;
    extentScale: WebGLUniformLocation | null;
  };
  private compositeUniforms: {
    tex: WebGLUniformLocation | null;
    offsetPx: WebGLUniformLocation | null;
    alpha: WebGLUniformLocation | null;
    tint: WebGLUniformLocation | null;
    useHueShift: WebGLUniformLocation | null;
    hueShift: WebGLUniformLocation | null;
    outputScale: WebGLUniformLocation | null;
  };
  private sparkleUniforms: {
    tex:    WebGLUniformLocation | null;
    amount: WebGLUniformLocation | null;
    time:   WebGLUniformLocation | null;
  };
  private stripUniforms: {
    resolution: WebGLUniformLocation | null;
    halfWidth:  WebGLUniformLocation | null;
    color:      WebGLUniformLocation | null;
    intensity:  WebGLUniformLocation | null;
    softness:   WebGLUniformLocation | null;
  };
  private blurUniforms: {
    tex:        WebGLUniformLocation | null;
    texelSize:  WebGLUniformLocation | null;
    direction:  WebGLUniformLocation | null;
    radius:     WebGLUniformLocation | null;
  };
  // Per-vertex strip-attribute buffer (4 floats: position.xy +
  // perpendicular.xy, plus 2 more for side and along, plus 1 for alpha).
  // Re-uploaded per draw — long strokes can require thousands of
  // vertices, so we let it grow dynamically.
  private stripBuffer!: WebGLBuffer;

  private cornerBuffer: WebGLBuffer;
  private instanceBuffer: WebGLBuffer;
  private fullscreenBuffer: WebGLBuffer;

  private committedRT!: { tex: WebGLTexture; fb: WebGLFramebuffer };
  private currentRT!:   { tex: WebGLTexture; fb: WebGLFramebuffer };
  private workRT!:      { tex: WebGLTexture; fb: WebGLFramebuffer };
  // Final-frame composite target — receives committed + current +
  // multi-color glow halo, before bloom + persistence post-processing.
  private finalRT!:     { tex: WebGLTexture; fb: WebGLFramebuffer };
  // Persistence buffer — holds the previous frame's final image for
  // the afterglow / motion-blur effects. Decayed and composited back
  // each frame to produce the trailing-ghost effect.
  private persistRT!:   { tex: WebGLTexture; fb: WebGLFramebuffer };
  // Two low-resolution targets for the bloom blur passes
  // (downscaled → horizontal blur → vertical blur → composite back).
  // 1/4 resolution gives a wide-feeling bloom at low GPU cost.
  private bloomRT_A!:   { tex: WebGLTexture; fb: WebGLFramebuffer };
  private bloomRT_B!:   { tex: WebGLTexture; fb: WebGLFramebuffer };
  private bloomW = 0;
  private bloomH = 0;

  private bakedHashes = new Map<string, string>();
  private bakedOrder: string[] = [];

  // Animation time — advances only while content.isPlaying. Matches
  // the legacy renderer's behavior so the WebGL2 path produces the
  // same draw-animation curves.
  private animationTime = 0;

  private perfStampCount = 0;
  private perfDrawCalls = 0;
  private perfLastRenderMs = 0;
  private loggedBrushTypes = new Set<string>();

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;

    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;

    const gl = this.canvas.getContext('webgl2', {
      premultipliedAlpha: true,
      alpha: true,
      antialias: false,
      preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error('WebGL2 unavailable');
    this.gl = gl;

    this.stampProgram = linkProgram(gl, STAMP_VERT, STAMP_FRAG);
    this.compositeProgram = linkProgram(gl, COMPOSITE_VERT, COMPOSITE_FRAG);
    this.stripProgram = linkProgram(gl, STRIP_VERT, STRIP_FRAG);
    this.blurProgram = linkProgram(gl, COMPOSITE_VERT, BLUR_FRAG);
    this.sparkleProgram = linkProgram(gl, COMPOSITE_VERT, SPARKLE_FRAG);

    this.stampUniforms = {
      resolution:     gl.getUniformLocation(this.stampProgram, 'u_resolution'),
      brushType:      gl.getUniformLocation(this.stampProgram, 'u_brushType'),
      useAngle:       gl.getUniformLocation(this.stampProgram, 'u_useAngle'),
      extentScale:    gl.getUniformLocation(this.stampProgram, 'u_extentScale'),
    };
    this.stripUniforms = {
      resolution: gl.getUniformLocation(this.stripProgram, 'u_resolution'),
      halfWidth:  gl.getUniformLocation(this.stripProgram, 'u_halfWidth'),
      color:      gl.getUniformLocation(this.stripProgram, 'u_color'),
      intensity:  gl.getUniformLocation(this.stripProgram, 'u_intensity'),
      softness:   gl.getUniformLocation(this.stripProgram, 'u_softness'),
    };
    this.blurUniforms = {
      tex:       gl.getUniformLocation(this.blurProgram, 'u_tex'),
      texelSize: gl.getUniformLocation(this.blurProgram, 'u_texelSize'),
      direction: gl.getUniformLocation(this.blurProgram, 'u_direction'),
      radius:    gl.getUniformLocation(this.blurProgram, 'u_radius'),
    };
    this.stripBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.stripBuffer);
    // Pre-allocate ~10000 vertices worth (6 floats each = 240KB).
    gl.bufferData(gl.ARRAY_BUFFER, 10000 * 6 * 4, gl.DYNAMIC_DRAW);

    this.compositeUniforms = {
      tex:         gl.getUniformLocation(this.compositeProgram, 'u_tex'),
      offsetPx:    gl.getUniformLocation(this.compositeProgram, 'u_offsetPx'),
      alpha:       gl.getUniformLocation(this.compositeProgram, 'u_alpha'),
      tint:        gl.getUniformLocation(this.compositeProgram, 'u_tint'),
      useHueShift: gl.getUniformLocation(this.compositeProgram, 'u_useHueShift'),
      hueShift:    gl.getUniformLocation(this.compositeProgram, 'u_hueShift'),
      outputScale: gl.getUniformLocation(this.compositeProgram, 'u_outputScale'),
    };
    this.sparkleUniforms = {
      tex:    gl.getUniformLocation(this.sparkleProgram, 'u_tex'),
      amount: gl.getUniformLocation(this.sparkleProgram, 'u_amount'),
      time:   gl.getUniformLocation(this.sparkleProgram, 'u_time'),
    };

    this.cornerBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1,  1, -1,  -1, 1,  1, 1,
    ]), gl.STATIC_DRAW);

    this.instanceBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, 5000 * STRIDE_BYTES, gl.DYNAMIC_DRAW);

    this.fullscreenBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.fullscreenBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1,  1, -1,  -1, 1,
      -1,  1,  1, -1,   1, 1,
    ]), gl.STATIC_DRAW);

    this.allocateRenderTargets(width, height);

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.format = THREE.RGBAFormat;

    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const adapter = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown';
    console.log(`[LightPaintingWebGL] initialised — ${width}×${height} — GPU: ${adapter}`);
  }

  private allocateRenderTargets(w: number, h: number): void {
    const gl = this.gl;
    if (this.committedRT) {
      gl.deleteTexture(this.committedRT.tex);
      gl.deleteFramebuffer(this.committedRT.fb);
    }
    if (this.currentRT) {
      gl.deleteTexture(this.currentRT.tex);
      gl.deleteFramebuffer(this.currentRT.fb);
    }
    if (this.workRT) {
      gl.deleteTexture(this.workRT.tex);
      gl.deleteFramebuffer(this.workRT.fb);
    }
    if (this.finalRT) {
      gl.deleteTexture(this.finalRT.tex);
      gl.deleteFramebuffer(this.finalRT.fb);
    }
    if (this.persistRT) {
      gl.deleteTexture(this.persistRT.tex);
      gl.deleteFramebuffer(this.persistRT.fb);
    }
    if (this.bloomRT_A) {
      gl.deleteTexture(this.bloomRT_A.tex);
      gl.deleteFramebuffer(this.bloomRT_A.fb);
    }
    if (this.bloomRT_B) {
      gl.deleteTexture(this.bloomRT_B.tex);
      gl.deleteFramebuffer(this.bloomRT_B.fb);
    }
    this.committedRT = makeRenderTarget(gl, w, h);
    this.currentRT   = makeRenderTarget(gl, w, h);
    this.workRT      = makeRenderTarget(gl, w, h);
    this.finalRT     = makeRenderTarget(gl, w, h);
    this.persistRT   = makeRenderTarget(gl, w, h);
    // Bloom render targets at 1/4 resolution — wide blur for cheap.
    this.bloomW = Math.max(64, Math.floor(w / 4));
    this.bloomH = Math.max(64, Math.floor(h / 4));
    this.bloomRT_A = makeRenderTarget(gl, this.bloomW, this.bloomH);
    this.bloomRT_B = makeRenderTarget(gl, this.bloomW, this.bloomH);
    this.bakedHashes.clear();
    this.bakedOrder = [];
  }

  getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  resize(width: number, height: number): void {
    if (this.width === width && this.height === height) return;
    this.width = width;
    this.height = height;
    this.canvas.width = width;
    this.canvas.height = height;
    this.allocateRenderTargets(width, height);
  }

  /** Hash a stroke's renderable state. */
  private hashStroke(stroke: LightPaintingStroke): string {
    const b = stroke.brush;
    const c = b.color;
    // Include all new params so brush-tweak triggers a re-bake.
    return [
      stroke.points.length,
      b.type,
      b.size,
      `${c[0]},${c[1]},${c[2]}`,
      b.opacity, b.glow, b.softness, b.jitter,
      b.taper ? 1 : 0,
      b.pressureSensitive ? 1 : 0,
      b.speed,
      b.particleSize ?? 1,
      b.internalGlow ?? 1,
      b.noiseScale ?? 1,
      b.noiseSpeed ?? 1,
      b.noiseAmount ?? 0.6,
      b.complexity ?? 1,
      stroke.visible ? 1 : 0,
    ].join('|');
  }

  /** Stamp a batch of samples into the currently-bound framebuffer. */
  private drawStampBatch(samples: StampSample[], brush: LightPaintingBrush): void {
    if (samples.length === 0) return;
    const gl = this.gl;

    const arr = new Float32Array(samples.length * FLOATS_PER);
    const [r, g, b] = brush.color;
    const rN = r / 255, gN = g / 255, bN = b / 255;
    const particleSize  = brush.particleSize  ?? 1;
    const internalGlow  = brush.internalGlow  ?? 1;
    const noiseScale    = brush.noiseScale    ?? 1;
    const noiseSpeed    = brush.noiseSpeed    ?? 1;
    const noiseAmount   = brush.noiseAmount   ?? 0.6;
    const complexity    = brush.complexity    ?? 1;

    // PROC_PACK_LAYOUT: floats 13-15 = pack1 (particleSize, internalGlow,
    // complexity), floats 16-18 = pack2 (noiseScale, noiseSpeed, noiseAmount).
    // Packing keeps total per-instance attribute LOCATIONS at 13, well
    // inside the WebGL2 MAX_VERTEX_ATTRIBS=16 minimum that
    // Chromium/ANGLE enforces. Must match the i_pack1 / i_pack2
    // declarations in webglShaders.ts.
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      const off = i * FLOATS_PER;
      arr[off + 0]  = s.x;
      arr[off + 1]  = s.y;
      arr[off + 2]  = s.size;
      arr[off + 3]  = s.angle;
      arr[off + 4]  = rN;
      arr[off + 5]  = gN;
      arr[off + 6]  = bN;
      arr[off + 7]  = s.alpha;
      arr[off + 8]  = brush.glow;
      arr[off + 9]  = brush.softness;
      arr[off + 10] = s.seed;
      arr[off + 11] = s.time;
      arr[off + 12] = s.progress;
      // pack1: particleSize, internalGlow, complexity
      arr[off + 13] = particleSize;
      arr[off + 14] = internalGlow;
      arr[off + 15] = complexity;
      // pack2: noiseScale, noiseSpeed, noiseAmount
      arr[off + 16] = noiseScale;
      arr[off + 17] = noiseSpeed;
      arr[off + 18] = noiseAmount;
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, arr, gl.DYNAMIC_DRAW);

    gl.useProgram(this.stampProgram);
    gl.uniform2f(this.stampUniforms.resolution, this.width, this.height);
    const brushId = BRUSH_TYPE_ID[brush.type];
    gl.uniform1i(this.stampUniforms.brushType, brushId);
    gl.uniform1f(this.stampUniforms.useAngle, ANGLE_DEPENDENT[brush.type] ? 1 : 0);
    // For line-type brushes (glow / neon / laser), grow the quad
    // extent with brush.glow so the wider halo isn't clipped at the
    // quad edge. Matches Canvas2D's glowRadius = radius * (1 + glow * 2).
    // Without this, the glow slider appears to do nothing because the
    // wider halo just gets cut off at the same quad boundary.
    let extentScale = EXTENT_SCALE[brush.type];
    if (brush.type === 'glow' || brush.type === 'neon' || brush.type === 'laser') {
      extentScale = 1.0 + brush.glow * 2.0;
    }
    gl.uniform1f(this.stampUniforms.extentScale, extentScale);

    if (!this.loggedBrushTypes.has(brush.type)) {
      this.loggedBrushTypes.add(brush.type);
      console.log(`[LightPaintingWebGL] first stamp — brush.type="${brush.type}" → u_brushType=${brushId} (samples=${samples.length})`);
    }

    // Bind a_corner from cornerBuffer at attribute 0.
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerBuffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(0, 0);

    // Bind per-instance attributes from instanceBuffer.
    // Locations 1..12 must match the layout(location = N) qualifiers in
    // webglShaders.ts STAMP_VERT. Total locations in use: 13 (0..12),
    // within the WebGL2 MAX_VERTEX_ATTRIBS=16 minimum.
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    const ATTR_LAYOUT: Array<[number, number, number]> = [
      [1, 2, 0],    // i_position
      [2, 1, 2],    // i_size
      [3, 1, 3],    // i_angle
      [4, 3, 4],    // i_color
      [5, 1, 7],    // i_alpha
      [6, 1, 8],    // i_glow
      [7, 1, 9],    // i_softness
      [8, 1, 10],   // i_seed
      [9, 1, 11],   // i_time
      [10, 1, 12],  // i_progress
      [11, 3, 13],  // i_pack1 = (particleSize, internalGlow, complexity)
      [12, 3, 16],  // i_pack2 = (noiseScale, noiseSpeed, noiseAmount)
    ];
    for (const [loc, count, ofloats] of ATTR_LAYOUT) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, count, gl.FLOAT, false, FLOATS_PER * 4, ofloats * 4);
      gl.vertexAttribDivisor(loc, 1);
    }

    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, samples.length);
    this.perfStampCount += samples.length;
    this.perfDrawCalls++;
  }

  /** Render the bright centerline overlay for a line-type stroke
   *  (glow / neon / laser). Each polyline segment becomes one
   *  INSTANCED quad; the fragment shader computes the geometric
   *  distance from each pixel to that segment and applies the
   *  cross-section brightness profile.
   *
   *  No triangle strip → no miter joints → no spike artifacts at
   *  sharp turns. Adjacent segments naturally produce rounded joints
   *  via additive overlap at shared endpoints, and endpoint round
   *  caps come for free from the t = clamp(0, 1) in the segment
   *  distance formula.
   *
   *  Drawn additively (gl.ONE / gl.ONE) on top of the gradient
   *  stamp pass — emulates Canvas2D's `globalCompositeOperation =
   *  'lighter'` overlay line. */
  private drawStripBatch(samples: StampSample[], brush: LightPaintingBrush): void {
    if (samples.length < 2) return;
    const gl = this.gl;

    // Per-instance data: one segment per pair of consecutive samples.
    // Layout: endA.x, endA.y, endB.x, endB.y, alpha = 5 floats.
    const FLOATS_PER_INST = 5;
    const segCount = samples.length - 1;
    const arr = new Float32Array(segCount * FLOATS_PER_INST);
    for (let i = 0; i < segCount; i++) {
      const a = samples[i];
      const b = samples[i + 1];
      const off = i * FLOATS_PER_INST;
      arr[off + 0] = a.x;
      arr[off + 1] = a.y;
      arr[off + 2] = b.x;
      arr[off + 3] = b.y;
      // Per-segment alpha = average of the two endpoint alphas.
      arr[off + 4] = (a.alpha + b.alpha) * 0.5;
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, this.stripBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, arr, gl.DYNAMIC_DRAW);

    gl.useProgram(this.stripProgram);
    gl.uniform2f(this.stripUniforms.resolution, this.width, this.height);
    // Centerline width scales with softness so the bright bridge
    // widens proportionally with the diffuse halo. At softness=0
    // (sharp), width = size × 0.125. At softness=1 (max), width
    // = size × 0.5 — still well inside the halo footprint of a
    // high-glow stroke.
    const halfWidth = brush.size * (0.125 + brush.softness * 0.375);
    gl.uniform1f(this.stripUniforms.halfWidth, halfWidth);
    const [r, g, b] = brush.color;
    gl.uniform3f(this.stripUniforms.color, r / 255, g / 255, b / 255);
    // Per-brush overlay intensity. Adjacent segments overlap at
    // shared endpoints contributing additively, so use a moderate
    // base value — high enough to read through the halo but not so
    // high that joint-overlap pixels saturate to white.
    const baseIntensity = brush.type === 'laser' ? 0.55
                        : brush.type === 'neon'  ? 0.45
                        : 0.40;
    const intensity = baseIntensity * (1.0 - brush.softness * 0.3);
    gl.uniform1f(this.stripUniforms.intensity, intensity);
    gl.uniform1f(this.stripUniforms.softness, brush.softness);

    // Switch to ADDITIVE blending — emulates Canvas2D's `lighter`
    // composite for the overlay pass. Restored to premultiplied
    // source-over after the draw so subsequent draws composite
    // normally.
    gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ONE, gl.ONE);

    // Per-vertex: unit quad corner (-1, -1), (+1, -1), (-1, +1), (+1, +1).
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerBuffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(0, 0);

    // Per-instance: segment endpoints + alpha.
    const STRIDE = FLOATS_PER_INST * 4;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.stripBuffer);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, STRIDE, 0);    // i_endA
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, STRIDE, 2 * 4); // i_endB
    gl.vertexAttribDivisor(2, 1);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, STRIDE, 4 * 4); // i_alpha
    gl.vertexAttribDivisor(3, 1);

    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, segCount);

    // Restore premultiplied alpha-over blending for subsequent draws.
    gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    // Reset per-instance divisors so the next stamp draw doesn't
    // accidentally inherit them on locations 1-3 (which it sets up
    // again, but clarity beats relying on the next setup).
    gl.vertexAttribDivisor(1, 0);
    gl.vertexAttribDivisor(2, 0);
    gl.vertexAttribDivisor(3, 0);

    this.perfStampCount += segCount;
    this.perfDrawCalls++;
  }

  private composite(opts: {
    sourceTex: WebGLTexture;
    offsetPx?: [number, number];
    alpha?: number;
    tint?: [number, number, number];
    hueShift?: number;
    outputScale?: number;   // 1.0 = identity, > 1 = output zooms in
  }): void {
    const gl = this.gl;
    gl.useProgram(this.compositeProgram);

    const offX = (opts.offsetPx?.[0] ?? 0) / this.width;
    const offY = (opts.offsetPx?.[1] ?? 0) / this.height;
    gl.uniform2f(this.compositeUniforms.offsetPx, offX, offY);
    gl.uniform1f(this.compositeUniforms.alpha, opts.alpha ?? 1);
    const tint = opts.tint ?? [1, 1, 1];
    gl.uniform3f(this.compositeUniforms.tint, tint[0], tint[1], tint[2]);
    gl.uniform1f(this.compositeUniforms.useHueShift, opts.hueShift !== undefined ? 1 : 0);
    gl.uniform1f(this.compositeUniforms.hueShift, opts.hueShift ?? 0);
    gl.uniform1f(this.compositeUniforms.outputScale, opts.outputScale ?? 1);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, opts.sourceTex);
    gl.uniform1i(this.compositeUniforms.tex, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.fullscreenBuffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(0, 0);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
    this.perfDrawCalls++;
  }

  /** Sparkle pass — additive bright pinpoints scattered along
   *  alpha-positive pixels of `sourceTex`. Drawn additively (call site
   *  switches blend mode to gl.ONE/gl.ONE for this pass). */
  private drawSparkle(sourceTex: WebGLTexture, amount: number, timeS: number): void {
    const gl = this.gl;
    gl.useProgram(this.sparkleProgram);
    gl.uniform1f(this.sparkleUniforms.amount, amount);
    gl.uniform1f(this.sparkleUniforms.time, timeS);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex);
    gl.uniform1i(this.sparkleUniforms.tex, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.fullscreenBuffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    this.perfDrawCalls++;
  }

  private clearTarget(rt: { fb: WebGLFramebuffer }, r: number, g: number, b: number, a: number): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, rt.fb);
    gl.viewport(0, 0, this.width, this.height);
    gl.clearColor(r, g, b, a);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  /** Run the separable Gaussian blur. Reads from `srcTex` (full-res
   *  source), writes to `bloomRT_A`. radius = pixel spacing per tap
   *  (controls blur width). Two passes, ping-ponging between
   *  bloomRT_A and bloomRT_B. Final output sits in bloomRT_A. */
  private gaussianBlur(srcTex: WebGLTexture, radius: number): void {
    const gl = this.gl;
    // Pass 1: downscale + horizontal blur (src full-res → bloomRT_A low-res).
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomRT_A.fb);
    gl.viewport(0, 0, this.bloomW, this.bloomH);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.blurProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, srcTex);
    gl.uniform1i(this.blurUniforms.tex, 0);
    gl.uniform2f(this.blurUniforms.texelSize, 1 / this.bloomW, 1 / this.bloomH);
    gl.uniform2f(this.blurUniforms.direction, 1, 0);
    gl.uniform1f(this.blurUniforms.radius, radius);
    // Disable blending — overwrite target.
    gl.disable(gl.BLEND);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.fullscreenBuffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // Pass 2: vertical blur (bloomRT_A → bloomRT_B).
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomRT_B.fb);
    gl.viewport(0, 0, this.bloomW, this.bloomH);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.bloomRT_A.tex);
    gl.uniform1i(this.blurUniforms.tex, 0);
    gl.uniform2f(this.blurUniforms.direction, 0, 1);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // Result is in bloomRT_B. Copy ref back to A so caller can read
    // from a single known target.
    [this.bloomRT_A, this.bloomRT_B] = [this.bloomRT_B, this.bloomRT_A];

    gl.enable(gl.BLEND);
    this.perfDrawCalls += 2;
  }

  /** Compute per-stroke "drawUpTo" — how many of the stroke's points
   *  to render this frame given the global animation state.
   *
   *  Mirrors the legacy renderer's getStrokeProgress: each stroke
   *  has its own start offset (when staggerStrokes is true) and its
   *  own duration scaled by drawSpeed. With loopMode='once' the
   *  stroke stops at full once finished; with the others it loops.
   *
   *  When content.isPlaying is false, we just draw the full stroke. */
  private computeDrawUpTo(
    stroke: LightPaintingStroke,
    strokeIndex: number,
    visibleStrokes: LightPaintingStroke[],
    content: LightPaintingContent,
  ): { drawUpTo: number; progress: number; trailLen: number } {
    const totalPts = stroke.points.length;
    if (!content.isPlaying || totalPts <= 1) {
      return { drawUpTo: totalPts, progress: 1, trailLen: 0 };
    }

    // Total animation duration of the layer.
    let totalDuration = 0;
    if (content.staggerStrokes) {
      for (const s of visibleStrokes) {
        if (!s.visible) continue;
        totalDuration += (s.duration / Math.max(0.01, content.drawSpeed)) + content.staggerDelay;
      }
    } else {
      for (const s of visibleStrokes) {
        if (!s.visible) continue;
        totalDuration = Math.max(totalDuration, s.duration / Math.max(0.01, content.drawSpeed));
      }
    }

    // Where this stroke starts in the layer's timeline.
    let strokeStart = 0;
    if (content.staggerStrokes) {
      for (let i = 0; i < strokeIndex; i++) {
        const s = visibleStrokes[i];
        if (!s.visible) continue;
        strokeStart += (s.duration / Math.max(0.01, content.drawSpeed)) + content.staggerDelay;
      }
    }
    const strokeDuration = stroke.duration / Math.max(0.01, content.drawSpeed);

    // Effective animation time, looped.
    let effectiveTime = this.animationTime;
    if (totalDuration > 0) {
      if (content.loopMode === 'forward') {
        effectiveTime = effectiveTime % totalDuration;
      } else if (content.loopMode === 'reverse') {
        effectiveTime = totalDuration - (effectiveTime % totalDuration);
      } else if (content.loopMode === 'pingpong') {
        const hold = Math.max(0, content.pingPongHold ?? 0);
        const cycle = totalDuration * 2 + hold * 2;
        const t = effectiveTime % cycle;
        if (t < totalDuration) effectiveTime = t;
        else if (t < totalDuration + hold) effectiveTime = totalDuration;
        else if (t < totalDuration * 2 + hold) effectiveTime = totalDuration - (t - totalDuration - hold);
        else effectiveTime = 0;
      } else if (content.loopMode === 'once') {
        effectiveTime = Math.min(effectiveTime, totalDuration);
      }
    }

    const elapsed = effectiveTime - strokeStart;
    let progress = 0;
    if (strokeDuration <= 0) progress = 1;
    else progress = Math.max(0, Math.min(1, elapsed / strokeDuration));

    const drawUpTo = Math.max(0, Math.min(totalPts, Math.floor(totalPts * progress)));

    let trailLen = 0;
    if (content.trailLength > 0) {
      trailLen = Math.floor(totalPts * (1 - content.trailLength));
    }
    if (content.snake > 0) {
      // Snake mode: only the head segment of length = (1-snake) renders.
      trailLen = Math.floor(totalPts * (1 - content.snake));
    }

    return { drawUpTo, progress, trailLen };
  }

  /** Rebuild the committed-strokes framebuffer from scratch. */
  private rebuildCommitted(
    visibleStrokes: LightPaintingStroke[],
    timeS: number,
    content: LightPaintingContent,
  ): void {
    const gl = this.gl;
    this.clearTarget(this.committedRT, 0, 0, 0, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.committedRT.fb);
    gl.viewport(0, 0, this.width, this.height);

    this.bakedHashes.clear();
    this.bakedOrder = [];
    for (let i = 0; i < visibleStrokes.length; i++) {
      const stroke = visibleStrokes[i];
      if (!stroke.visible) continue;
      // GPU compute brushes (spiral / firefly / sap-flow / water /
      // smoke) are owned by the WebGPU stroke-particles pass in
      // WebGPUCanvas — we MUST skip them here or the same stroke
      // renders twice (once via WebGL2 stamps, once via WebGPU
      // particles). Matches the same skip block in renderer.ts (the
      // Canvas2D rasteriser). Brush types listed in
      // GPU_COMPUTE_BRUSH_TYPES below stay GPU-only.
      if (GPU_COMPUTE_BRUSH_TYPES.has(stroke.brush.type)) continue;
      const { drawUpTo, trailLen } = this.computeDrawUpTo(stroke, i, visibleStrokes, content);
      if (drawUpTo <= 0) continue;
      const samples = sampleStroke(stroke, this.width, this.height,
        drawUpTo, trailLen, timeS, 1.0);
      // Line brushes (glow / neon / laser) render in two passes —
      // first the gradient stamps for the soft halo, then a thin
      // additive bright line through the centerline that bridges
      // any stamp-spacing gaps. Matches Canvas2D's drawGlowBrush +
      // continuous bezier line overlay approach.
      this.drawStampBatch(samples, stroke.brush);
      const bt = stroke.brush.type;
      if (bt === 'glow' || bt === 'neon' || bt === 'laser') {
        this.drawStripBatch(samples, stroke.brush);
      }
      this.bakedHashes.set(stroke.id, this.hashStroke(stroke));
      this.bakedOrder.push(stroke.id);
    }
  }

  render(content: LightPaintingContent, deltaTime: number): THREE.Texture {
    void deltaTime;
    const gl = this.gl;
    const renderStart = performance.now();
    this.perfStampCount = 0;
    this.perfDrawCalls = 0;

    // Advance animation clock if playing — matches the legacy
    // renderer (see renderer.ts line ~1179).
    if (content.isPlaying) {
      this.animationTime = (Date.now() - LP_TIME_ANCHOR_MS) * content.animationSpeed;
    }

    const timeS = (Date.now() % 1000000) / 1000;
    const visibleStrokes = content.strokes.filter(s => s.visible);

    let needRebuild = false;
    const visibleIds = visibleStrokes.map(s => s.id);
    if (visibleIds.length !== this.bakedOrder.length) {
      needRebuild = true;
    } else {
      for (let i = 0; i < visibleIds.length; i++) {
        if (visibleIds[i] !== this.bakedOrder[i]) {
          needRebuild = true; break;
        }
        const cur = this.hashStroke(visibleStrokes[i]);
        if (this.bakedHashes.get(visibleIds[i]) !== cur) {
          needRebuild = true; break;
        }
      }
    }

    // While playing OR while any visible stroke uses a time-driven
    // brush (flame, electric, bubbles, plasma, etc.), rebuild every
    // frame so the brush keeps animating. Without this the committed
    // framebuffer holds the first-render snapshot and bubbles/firefly/
    // plasma freeze in place after the user finishes drawing.
    const hasAnimatedBrush = visibleStrokes.some(s => ANIMATED_BRUSH[s.brush.type]);
    // Effects that need per-frame post-processing recomposition: the
    // committed/current framebuffers themselves don't change, but the
    // FINAL canvas does (because afterglow/motion-blur trail and the
    // hue rotates on each tick). The composite stage runs every render
    // anyway, so we don't need to invalidate the committed cache for
    // these — only the brush-animation case forces rebuild.
    if (content.isPlaying || hasAnimatedBrush) {
      needRebuild = true;
    }

    if (needRebuild) {
      this.rebuildCommitted(visibleStrokes, timeS, content);
    }

    this.clearTarget(this.currentRT, 0, 0, 0, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.currentRT.fb);
    gl.viewport(0, 0, this.width, this.height);

    const preview = (content as any).livePreviewStroke as { points: LightPaintingStrokePoint[]; brush: LightPaintingBrush } | undefined;
    if (preview && preview.points?.length >= 2 && preview.brush
        && !GPU_COMPUTE_BRUSH_TYPES.has(preview.brush.type)) {
      // Same skip as the bake path — GPU compute brushes are owned by
      // the WebGPU stroke-particles pass, not by us. Without this, an
      // in-progress spiral/firefly/sap-flow stroke would render once
      // here as WebGL2 stamps and again as WebGPU particles.
      const previewStroke: LightPaintingStroke = {
        id: '__preview__',
        points: preview.points,
        brush: preview.brush,
        duration: 0,
        visible: true,
        locked: false,
        drawMode: 'freehand' as any,
      };
      const samples = sampleStroke(previewStroke, this.width, this.height,
        previewStroke.points.length, 0, timeS, 1.0);
      this.drawStampBatch(samples, preview.brush);
      const bt = preview.brush.type;
      if (bt === 'glow' || bt === 'neon' || bt === 'laser') {
        this.drawStripBatch(samples, preview.brush);
      }
    }

    // ── COMPOSITING + POST-PROCESSING ──────────────────────────────
    // Stage 1: build the "raw" final frame (committed strokes + live
    // preview + multi-color glow halo + echoes) into finalRT.
    // Stage 2: bloom — blur finalRT and composite the blurred result
    // back on top of finalRT for a soft glow halo.
    // Stage 3: final canvas composite — afterglow + motion blur
    // (persist buffer first), then finalRT (with pulse/strobe/flicker
    // alpha mods + breathe scale + wave offset), then sparkle pass,
    // then save current frame back to persistRT.
    const globalAlphaBase = (content as any).globalOpacity ?? 1;
    const colorShift = content.colorShift ?? 0;
    const bloom = content.bloom ?? 0;
    const afterglow = content.afterglow ?? 0;
    const motionBlur = content.motionBlur ?? 0;
    const multiColorGlow = !!(content as any).multiColorGlow;

    // Per-frame dynamic modifiers — only active while playing, matches
    // Canvas2D semantics (the sliders animate effects driven by
    // animationTime which only advances during playback).
    const pulse = content.pulse ?? 0;
    const pulseSpeed = content.pulseSpeed ?? 1;
    const strobe = content.strobe ?? 0;
    const flicker = content.flicker ?? 0;
    const breathe = content.breathe ?? 0;
    const breatheSpeed = content.breatheSpeed ?? 1;
    const wave = content.wave ?? 0;
    const waveFreq = content.waveFreq ?? 1;
    const waveSpeed = content.waveSpeed ?? 1;
    const sparkle = content.sparkle ?? 0;

    // Pulse: smooth sinusoidal alpha modulation. Alpha dips by up to
    // pulse/2 at the troughs.
    let pulseMult = 1;
    if (pulse > 0 && content.isPlaying) {
      const s = Math.sin(timeS * pulseSpeed * Math.PI * 2);
      pulseMult = 1 - pulse * 0.5 * (0.5 - s * 0.5);
    }
    // Strobe: hard on/off flicker. Frequency scales with slider.
    let strobeMult = 1;
    if (strobe > 0 && content.isPlaying) {
      const strobeFreq = strobe * 20;             // 0..20 Hz
      strobeMult = Math.sin(timeS * strobeFreq * Math.PI * 2) > 0 ? 1 : 0.05;
    }
    // Flicker: random per-frame alpha drop.
    let flickerMult = 1;
    if (flicker > 0 && content.isPlaying) {
      flickerMult = 1 - flicker * Math.random() * 0.6;
    }
    // Breathe: scale modulation around canvas center.
    let breatheScale = 1;
    if (breathe > 0 && content.isPlaying) {
      breatheScale = 1 + breathe * 0.3 * Math.sin(timeS * breatheSpeed * Math.PI * 2);
    }
    // Wave: Lissajous translate offset.
    let waveOffsetX = 0, waveOffsetY = 0;
    if (wave > 0 && content.isPlaying) {
      const waveAmt = wave * 15;
      const wavePhase = timeS * waveSpeed * Math.PI * 2;
      waveOffsetX = Math.sin(wavePhase) * waveAmt;
      waveOffsetY = Math.cos(wavePhase * waveFreq) * waveAmt * 0.5;
    }

    // Two alpha values:
    //  - globalAlphaBase: applied when BUILDING finalRT (committed +
    //    preview + multi-color glow + echoes + bloom). This is the
    //    "raw" content alpha — saved to persistRT for afterglow.
    //  - finalAlpha: applied at the FINAL composite from finalRT to
    //    the canvas. Includes the per-frame dynamic modifiers
    //    (pulse/strobe/flicker) so they affect the visible output
    //    each frame WITHOUT contaminating the persistence buffer.
    const globalAlpha = globalAlphaBase;
    const finalAlpha = globalAlphaBase * pulseMult * strobeMult * flickerMult;

    // Animated global hue rotation. `colorShift` = 0..1 maps to one
    // full rotation per ~3 seconds (matches Canvas2D's behavior).
    const hueShiftRadians = colorShift > 0 && content.isPlaying
      ? ((this.animationTime / 3000) * colorShift % 1) * Math.PI * 2
      : 0;

    // ── STAGE 1: composite into finalRT ────────────────────────────
    this.clearTarget(this.finalRT, 0, 0, 0, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.finalRT.fb);
    gl.viewport(0, 0, this.width, this.height);

    // Multi-color glow: draw a hue-shifted halo BEHIND the main stroke.
    // Uses a complementary hue offset so the halo reads as a different
    // color from the stroke. Drawn at lower alpha so it's a halo, not
    // a full second stroke.
    if (multiColorGlow) {
      // 90° hue offset for a strong complementary halo. Combined with
      // the per-frame colorShift so animated hue rotation still works.
      const haloHue = hueShiftRadians + Math.PI * 0.5;
      this.composite({
        sourceTex: this.committedRT.tex,
        alpha: globalAlpha * 0.5,
        hueShift: haloHue,
      });
      this.composite({
        sourceTex: this.currentRT.tex,
        alpha: globalAlpha * 0.5,
        hueShift: haloHue,
      });
    }

    // Echo passes (committed strokes only — preview shouldn't echo).
    const echoCount = Math.round(((content as any).echo ?? 0));
    if (echoCount > 0) {
      const echoDecay = (content as any).echoDecay ?? 0.4;
      const echoOffset = (content as any).echoOffset ?? 0.05;
      for (let e = echoCount; e >= 1; e--) {
        const echoAlpha = Math.pow(1 - echoDecay, e) * globalAlpha;
        if (echoAlpha <= 0.001) continue;
        const offsetPx = e * echoOffset * this.width * 0.5;
        this.composite({
          sourceTex: this.committedRT.tex,
          offsetPx: [0, -offsetPx],
          alpha: echoAlpha,
          hueShift: hueShiftRadians || undefined,
        });
        this.composite({
          sourceTex: this.committedRT.tex,
          offsetPx: [0,  offsetPx],
          alpha: echoAlpha,
          hueShift: hueShiftRadians || undefined,
        });
      }
    }

    // Main composite pass: committed strokes, then live preview,
    // both with the global hue shift applied.
    this.composite({
      sourceTex: this.committedRT.tex,
      alpha: globalAlpha,
      hueShift: hueShiftRadians || undefined,
    });
    this.composite({
      sourceTex: this.currentRT.tex,
      alpha: globalAlpha,
      hueShift: hueShiftRadians || undefined,
    });

    // ── STAGE 2: bloom ─────────────────────────────────────────────
    // Blur finalRT into bloomRT_A, then composite back onto finalRT
    // additively. Bloom strength scales the additive intensity. The
    // 4-12 pixel radius gives a wide soft halo around bright areas.
    if (bloom > 0) {
      const blurRadius = 2.0 + bloom * 3.0;   // 2..11 pixels at the low-res
      this.gaussianBlur(this.finalRT.tex, blurRadius);
      // Additive composite the blurred result back onto finalRT.
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.finalRT.fb);
      gl.viewport(0, 0, this.width, this.height);
      gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ONE, gl.ONE);
      this.composite({
        sourceTex: this.bloomRT_A.tex,
        alpha: Math.min(1, bloom * 0.5),
      });
      gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    }

    // ── STAGE 3: composite to canvas with afterglow + motion blur ──
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // Afterglow: bring back previous frame at a faded alpha so old
    // strokes leave a slow-decaying ghost. Higher afterglow = ghost
    // persists longer.
    if (afterglow > 0) {
      const persistAlpha = 0.4 + afterglow * 0.55;  // 0.4..0.95
      this.composite({ sourceTex: this.persistRT.tex, alpha: persistAlpha });
    }

    // Motion blur: composite previous frame at slight horizontal
    // offsets, additive. Several taps build up a streaking smear.
    // Scaled by motionBlur strength (0..1).
    if (motionBlur > 0) {
      gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ONE, gl.ONE);
      const taps = 4;
      for (let i = 1; i <= taps; i++) {
        const tapAlpha = motionBlur * 0.25 * (1 - i / (taps + 1));
        const offset = i * motionBlur * 8;  // up to ~32 px streak
        this.composite({
          sourceTex: this.persistRT.tex,
          offsetPx: [-offset, 0],
          alpha: tapAlpha,
        });
        this.composite({
          sourceTex: this.persistRT.tex,
          offsetPx: [offset, 0],
          alpha: tapAlpha,
        });
      }
      gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    }

    // Main pass: paint the post-processed final frame on top.
    // finalAlpha = globalAlphaBase × pulse × strobe × flicker — applied
    // ONLY here so the persistence buffer (saved further below) holds
    // unmodulated content. Breathe = output zoom, wave = output offset.
    this.composite({
      sourceTex:    this.finalRT.tex,
      alpha:        finalAlpha,
      outputScale:  breatheScale,
      offsetPx:     [waveOffsetX, waveOffsetY],
    });

    // Sparkle pass — additive bright pinpoints scattered along the
    // painted strokes. Drawn on top of everything else.
    if (sparkle > 0 && content.isPlaying) {
      gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ONE, gl.ONE);
      this.drawSparkle(this.finalRT.tex, sparkle, timeS);
      gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    }

    // Save current frame to persistRT for next frame's afterglow /
    // motion blur. Skipped if neither is active to avoid the copy.
    if (afterglow > 0 || motionBlur > 0) {
      this.clearTarget(this.persistRT, 0, 0, 0, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.persistRT.fb);
      gl.viewport(0, 0, this.width, this.height);
      this.composite({ sourceTex: this.finalRT.tex, alpha: 1 });
    }

    this.texture.needsUpdate = true;
    this.perfLastRenderMs = performance.now() - renderStart;
    return this.texture;
  }

  resetAnimation(): void {
    this.animationTime = 0;
    this.bakedHashes.clear();
    this.bakedOrder = [];
  }

  setPlaybackPosition(position: number): void {
    // Map normalized 0..1 to absolute animation time. We don't know
    // the total duration here (caller has it) — best effort: scale
    // by 60s. The renderer will reconcile against the actual
    // duration on the next render.
    this.animationTime = position * 60000;
    this.bakedHashes.clear();
    this.bakedOrder = [];
  }

  getPerfStats(): {
    renderMs: number;
    stampCount: number;
    drawCalls: number;
    backend: 'webgl2';
  } {
    return {
      renderMs: this.perfLastRenderMs,
      stampCount: this.perfStampCount,
      drawCalls: this.perfDrawCalls,
      backend: 'webgl2',
    };
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.stampProgram);
    gl.deleteProgram(this.compositeProgram);
    gl.deleteProgram(this.stripProgram);
    gl.deleteProgram(this.blurProgram);
    gl.deleteProgram(this.sparkleProgram);
    gl.deleteBuffer(this.cornerBuffer);
    gl.deleteBuffer(this.instanceBuffer);
    gl.deleteBuffer(this.stripBuffer);
    gl.deleteBuffer(this.fullscreenBuffer);
    gl.deleteTexture(this.committedRT.tex);
    gl.deleteFramebuffer(this.committedRT.fb);
    gl.deleteTexture(this.currentRT.tex);
    gl.deleteFramebuffer(this.currentRT.fb);
    gl.deleteTexture(this.workRT.tex);
    gl.deleteFramebuffer(this.workRT.fb);
    gl.deleteTexture(this.finalRT.tex);
    gl.deleteFramebuffer(this.finalRT.fb);
    gl.deleteTexture(this.persistRT.tex);
    gl.deleteFramebuffer(this.persistRT.fb);
    gl.deleteTexture(this.bloomRT_A.tex);
    gl.deleteFramebuffer(this.bloomRT_A.fb);
    gl.deleteTexture(this.bloomRT_B.tex);
    gl.deleteFramebuffer(this.bloomRT_B.fb);
    this.texture.dispose();
  }
}
