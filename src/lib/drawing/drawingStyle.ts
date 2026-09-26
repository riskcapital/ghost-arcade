// Fill / stroke / animation uniform resolution for the drawing shape shader.
//
// This is the single place that turns a DrawingElement's fill, stroke and
// animation objects into the numbers the shape shader reads. The WebGL
// DrawingRenderer (the editor reference) writes these values into its
// uniforms, and the native render core receives the very same values for
// Edge Effects, so both renderers interpret every parameter identically.
//
// The resolution keeps the renderer's historic "only overwrite what the
// object carries" rule: a field missing from the object keeps the value in
// `prev`. The drawing-layer path passes the live uniform values as `prev`
// (unchanged behaviour); Edge Effects pass DEFAULT_DRAWING_STYLE so a
// missing field always means the documented default rather than whatever
// the previously drawn element left behind.

import type { Animation, Fill, Stroke } from './types';

export type Rgba = [number, number, number, number];

export interface DrawingStyle {
  // Stroke
  strokeType: number;
  strokeColor: Rgba;
  strokeWidth: number;
  glowSize: number;
  glowIntensity: number;
  pulseSpeed: number;
  snakeLength: number;
  snakeSpeed: number;
  snakeCount: number;
  dashLength: number;
  gapLength: number;
  electricArc: number;
  scannerBeamWidth: number;
  scannerTrail: number;
  strobeRate: number;
  // Fill
  fillType: number;
  fillColor: Rgba;
  fillSpeed: number;
  noiseScale: number;
  noiseTurbulence: number;
  holoShift: number;
  holoScanlines: number;
  gradAngle: number;
  plasmaScale: number;
  plasmaComplexity: number;
  plasmaPalette: number;
  liquidViscosity: number;
  liquidTurbulence: number;
  liquidMetallic: number;
  fireIntensity: number;
  fireTurbulence: number;
  firePalette: number;
  electricIntensity: number;
  electricArcCount: number;
  holoFlicker: number;
  noiseColor2: Rgba;
  gradColor2: Rgba;
  gradType: number;
  // Animation
  animationType: number;
  animCount: number;
  animSpacing: number;
  animSpeed: number;
  concentricDirection: number;
  breatheMin: number;
  breatheMax: number;
  rotateSpeed: number;
  rotateDir: number;
  waveAmplitude: number;
  waveFrequency: number;
  rippleDecay: number;
  glitchIntensity: number;
  glitchBlockSize: number;
}

/** The shape shader's initial uniform values. */
export const DEFAULT_DRAWING_STYLE: Readonly<DrawingStyle> = Object.freeze({
  strokeType: 2,
  strokeColor: [0, 1, 0.5, 1] as Rgba,
  strokeWidth: 4,
  glowSize: 20,
  glowIntensity: 1,
  pulseSpeed: 1,
  snakeLength: 0.3,
  snakeSpeed: 1,
  snakeCount: 1,
  dashLength: 0.3,
  gapLength: 0.2,
  electricArc: 1.0,
  scannerBeamWidth: 0.1,
  scannerTrail: 0.3,
  strobeRate: 4.0,
  fillType: 0,
  fillColor: [1, 1, 1, 0.5] as Rgba,
  fillSpeed: 1,
  noiseScale: 5.0,
  noiseTurbulence: 0.5,
  holoShift: 0.0,
  holoScanlines: 3.0,
  gradAngle: 0.0,
  plasmaScale: 8.0,
  plasmaComplexity: 3.0,
  plasmaPalette: 0,
  liquidViscosity: 0.5,
  liquidTurbulence: 0.5,
  liquidMetallic: 0.5,
  fireIntensity: 1.0,
  fireTurbulence: 0.5,
  firePalette: 0,
  electricIntensity: 1.0,
  electricArcCount: 5.0,
  holoFlicker: 0.5,
  noiseColor2: [0, 0.2, 0.4, 1] as Rgba,
  gradColor2: [1, 1, 1, 1] as Rgba,
  gradType: 0,
  animationType: 0,
  animCount: 5,
  animSpacing: 0.04,
  animSpeed: 1,
  concentricDirection: 0,
  breatheMin: 0.8,
  breatheMax: 1.2,
  rotateSpeed: 1.0,
  rotateDir: 0,
  waveAmplitude: 1.0,
  waveFrequency: 1.0,
  rippleDecay: 1.0,
  glitchIntensity: 1.0,
  glitchBlockSize: 1.0,
});

const STROKE_TYPE_INDEX: Record<string, number> = {
  none: 0,
  solid: 1,
  glow: 2,
  neon: 3,
  snake: 4,
  rainbow: 5,
  dashed: 6,
  electric: 7,
  strobe: 8,
  scanner: 9,
  fire: 10,
  pulse: 4,            // maps to snake-style rendering
  dotted: 6,           // maps to dashed
};

const FILL_TYPE_INDEX: Record<string, number> = {
  none: 0,
  solid: 1,
  plasma: 2,
  liquid: 3,
  fire: 4,
  electric: 5,
  holographic: 6,
  noise: 7,
  gradient: 8,
  radialGradient: 8,
};

const ANIMATION_TYPE_INDEX: Record<string, number> = {
  none: 0,
  concentric: 1,
  radiate: 2,
  breathe: 3,
  rotate: 4,
  ripple: 5,
  wave: 6,
  glitch: 7,
};

export function strokeTypeIndex(type: string): number {
  return STROKE_TYPE_INDEX[type] ?? 2;
}

export function fillTypeIndex(type: string): number {
  return FILL_TYPE_INDEX[type] ?? 0;
}

export function animationTypeIndex(type: string): number {
  return ANIMATION_TYPE_INDEX[type] ?? 0;
}

function rgba(value: unknown, fallback: Rgba): Rgba {
  if (!Array.isArray(value)) return fallback;
  return [0, 1, 2, 3].map((i) => {
    const n = Number(value[i]);
    return Number.isFinite(n) ? n : fallback[i];
  }) as Rgba;
}

/** Mirror of three.js setting a float uniform: numbers pass through and a
 *  boolean becomes 1 or 0 (WebGL converts it in uniform1f). */
function num(value: unknown, fallback: number): number {
  if (typeof value === 'boolean') return value ? 1 : 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Resolve the fill, stroke and animation uniforms of one element. Each
 * `'field' in object` test below is exactly the one DrawingRenderer used
 * when it wrote the uniforms directly, so drawing layers render as before.
 */
export function resolveDrawingStyle(
  element: { fill: Fill; stroke: Stroke; animation: Animation },
  prev: Readonly<DrawingStyle> = DEFAULT_DRAWING_STYLE,
): DrawingStyle {
  const u: DrawingStyle = {
    ...prev,
    strokeColor: [...prev.strokeColor] as Rgba,
    fillColor: [...prev.fillColor] as Rgba,
    noiseColor2: [...prev.noiseColor2] as Rgba,
    gradColor2: [...prev.gradColor2] as Rgba,
  };
  const stroke = element.stroke as any;
  const fill = element.fill as any;
  const animation = element.animation as any;

  // Stroke
  u.strokeType = strokeTypeIndex(stroke.type);
  if (stroke.type !== 'none' && 'color' in stroke) u.strokeColor = rgba(stroke.color, u.strokeColor);
  if (stroke.type !== 'none' && 'width' in stroke) u.strokeWidth = num(stroke.width, u.strokeWidth);
  if ('glowSize' in stroke) u.glowSize = num(stroke.glowSize, u.glowSize);
  if ('glowIntensity' in stroke) u.glowIntensity = num(stroke.glowIntensity, u.glowIntensity);
  if ('pulseSpeed' in stroke) u.pulseSpeed = num(stroke.pulseSpeed, u.pulseSpeed);
  if ('flickerSpeed' in stroke) u.pulseSpeed = num(stroke.flickerSpeed, u.pulseSpeed);
  if ('length' in stroke) u.snakeLength = num(stroke.length, u.snakeLength);
  if ('speed' in stroke) u.snakeSpeed = num(stroke.speed, u.snakeSpeed);
  u.snakeCount = 'snakeCount' in stroke ? num(stroke.snakeCount, 1) : 1;
  if ('dashLength' in stroke) u.dashLength = num(stroke.dashLength, u.dashLength);
  if ('gapLength' in stroke) u.gapLength = num(stroke.gapLength, u.gapLength);
  if ('arcIntensity' in stroke) u.electricArc = num(stroke.arcIntensity, u.electricArc);
  if ('beamWidth' in stroke) u.scannerBeamWidth = num(stroke.beamWidth, u.scannerBeamWidth);
  if ('trail' in stroke) u.scannerTrail = num(stroke.trail, u.scannerTrail);
  if ('rate' in stroke) u.strobeRate = num(stroke.rate, u.strobeRate);

  // Fill
  u.fillType = fillTypeIndex(fill.type);
  if (fill.type !== 'none' && 'color' in fill) u.fillColor = rgba(fill.color, u.fillColor);
  if ('speed' in fill) u.fillSpeed = num(fill.speed, u.fillSpeed);
  if ('scale' in fill) u.noiseScale = num(fill.scale, u.noiseScale);
  if ('turbulence' in fill) u.noiseTurbulence = num(fill.turbulence, u.noiseTurbulence);
  if ('shiftAmount' in fill) u.holoShift = num(fill.shiftAmount, u.holoShift);
  if ('scanlines' in fill) u.holoScanlines = num(fill.scanlines, u.holoScanlines);
  if ('angle' in fill) u.gradAngle = num(fill.angle, u.gradAngle);
  if (fill.type === 'plasma') {
    u.plasmaScale = num(fill.scale ?? 8, 8);
    u.plasmaComplexity = num(fill.complexity ?? 3, 3);
    const paletteMap: Record<string, number> = { rainbow: 0, fire: 1, ocean: 2, neon: 3 };
    u.plasmaPalette = paletteMap[fill.palette] ?? 0;
  }
  if (fill.type === 'liquid') {
    u.liquidViscosity = num(fill.viscosity ?? 0.5, 0.5);
    u.liquidTurbulence = num(fill.turbulence ?? 0.5, 0.5);
    u.liquidMetallic = num(fill.metallic ?? 0.5, 0.5);
  }
  if (fill.type === 'fire') {
    u.fireIntensity = num(fill.intensity ?? 1, 1);
    u.fireTurbulence = num(fill.turbulence ?? 0.5, 0.5);
    const firePaletteMap: Record<string, number> = { orange: 0, blue: 1, green: 2, purple: 3 };
    u.firePalette = firePaletteMap[fill.palette] ?? 0;
  }
  if (fill.type === 'electric') {
    u.electricIntensity = num(fill.intensity ?? 1, 1);
    u.electricArcCount = num(fill.arcCount ?? 5, 5);
  }
  if (fill.type === 'holographic') {
    u.holoFlicker = num(fill.flicker ?? 0.5, 0.5);
  }
  if (fill.type === 'noise' && 'color2' in fill) {
    u.noiseColor2 = rgba(fill.color2, u.noiseColor2);
    if ('color1' in fill) u.fillColor = rgba(fill.color1, u.fillColor);
  }
  if (fill.type === 'gradient') {
    if ('color2' in fill) u.gradColor2 = rgba(fill.color2, u.gradColor2);
    if ('color' in fill) u.fillColor = rgba(fill.color, u.fillColor);
    const gradTypeMap: Record<string, number> = { linear: 0, radial: 1, angular: 2 };
    u.gradType = gradTypeMap[fill.gradientType] ?? 0;
  }

  // Animation
  u.animationType = animationTypeIndex(animation.type);
  if (animation.type === 'concentric') {
    u.animCount = num(animation.count, u.animCount);
    u.animSpacing = num(animation.spacing, u.animSpacing);
    u.animSpeed = num(animation.speed, u.animSpeed);
    const directionMap: Record<string, number> = { out: 0, in: 1, both: 2 };
    u.concentricDirection = directionMap[animation.direction] ?? 0;
  } else if (animation.type === 'breathe') {
    u.animSpeed = num(animation.speed ?? 1, 1);
    u.breatheMin = num(animation.minScale ?? 0.8, 0.8);
    u.breatheMax = num(animation.maxScale ?? 1.2, 1.2);
  } else if (animation.type === 'rotate') {
    u.animSpeed = num(animation.speed ?? 1, 1);
    u.rotateSpeed = u.animSpeed;
    u.rotateDir = animation.direction === 'ccw' ? 1 : 0;
  } else if (animation.type === 'radiate') {
    u.animCount = num(animation.rays ?? 8, 8);
    u.animSpeed = num(animation.speed ?? 1, 1);
  } else if (animation.type === 'ripple') {
    u.animCount = num(animation.count ?? 5, 5);
    u.animSpacing = num(animation.spacing ?? 0.04, 0.04);
    u.animSpeed = num(animation.speed ?? 1, 1);
    u.rippleDecay = num(animation.decay ?? 1, 1);
  } else if (animation.type === 'wave') {
    u.animSpeed = num(animation.speed ?? 1, 1);
    u.waveAmplitude = num(animation.amplitude ?? 1, 1);
    u.waveFrequency = num(animation.frequency ?? 1, 1);
  } else if (animation.type === 'glitch') {
    u.animSpeed = num(animation.speed ?? 1, 1);
    u.glitchIntensity = num(animation.intensity ?? 1, 1);
    u.glitchBlockSize = num(animation.blockSize ?? 1, 1);
  } else {
    u.animCount = 0;
  }
  return u;
}

/** Continuous rotation (radians) the rotate animation adds at `time`. */
export function drawingRotation(style: Pick<DrawingStyle, 'animationType' | 'rotateSpeed' | 'rotateDir'>, time: number): number {
  if (style.animationType !== ANIMATION_TYPE_INDEX.rotate) return 0;
  return time * style.rotateSpeed * (style.rotateDir === 1 ? -1 : 1);
}
