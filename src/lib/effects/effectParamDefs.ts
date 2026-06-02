/**
 * Shared effect parameter definitions — single source of truth for both
 * desktop VJ mode and iPad/mobile VJ effects panels.
 *
 * Every effect from EFFECT_CATALOG should have an entry here so that
 * parameter sliders appear everywhere.
 */

export interface EffectParamDef {
  name: string;       // Display label
  param: string;      // Key in EffectParams
  min: number;
  max: number;
  step: number;
  default: number;
  type?: 'slider' | 'select' | 'color';   // UI widget type (default: 'slider')
  options?: { value: number; label: string }[];  // For type='select'
  colorParams?: { r: string; g: string; b: string };  // param keys for R/G/B when type='color'
}

export const EFFECT_PARAM_DEFS: Record<string, EffectParamDef[]> = {
  // ═══════════════════════════════
  // ── Masking (2) ──
  // ═══════════════════════════════
  vignette: [
    { name: 'Size', param: 'vignetteSize', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Softness', param: 'vignetteSoftness', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Roundness', param: 'vignetteRoundness', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  edgeFeather: [
    { name: 'Top', param: 'featherTop', min: 0, max: 0.5, step: 0.01, default: 0 },
    { name: 'Bottom', param: 'featherBottom', min: 0, max: 0.5, step: 0.01, default: 0 },
    { name: 'Left', param: 'featherLeft', min: 0, max: 0.5, step: 0.01, default: 0 },
    { name: 'Right', param: 'featherRight', min: 0, max: 0.5, step: 0.01, default: 0 },
    { name: 'Softness', param: 'featherSoftness', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],

  // ═══════════════════════════════
  // ── Color (15) ──
  // ═══════════════════════════════
  colorama: [
    { name: 'Offset', param: 'coloramaOffset', min: 0, max: 1, step: 0.01, default: 0 },
    { name: 'Speed', param: 'coloramaSpeed', min: 0, max: 2, step: 0.01, default: 0.5 },
    { name: 'Contrast', param: 'coloramaContrast', min: 0, max: 2, step: 0.01, default: 1 },
    { name: 'Mix', param: 'coloramaMix', min: 0, max: 1, step: 0.01, default: 1 },
  ],
  plasma: [
    { name: 'Scale', param: 'plasmaScale', min: 0.1, max: 10, step: 0.1, default: 2 },
    { name: 'Speed', param: 'plasmaSpeed', min: 0, max: 2, step: 0.01, default: 0.5 },
    { name: 'Complexity', param: 'plasmaComplexity', min: 1, max: 8, step: 1, default: 4 },
    { name: 'Mix', param: 'plasmaMix', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  invert: [],
  posterize: [
    { name: 'Levels', param: 'posterizeLevels', min: 2, max: 16, step: 1, default: 4 },
  ],
  exposure: [
    { name: 'Amount', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Detail', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  gamma: [
    { name: 'Amount', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Detail', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  vibrance: [
    { name: 'Amount', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Detail', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  temperatureTint: [
    { name: 'Temperature', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Tint', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  colorBalance: [
    { name: 'Master', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Red', param: 'red', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Green', param: 'green', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Blue', param: 'blue', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  curves: [
    { name: 'Master', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Red', param: 'red', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Green', param: 'green', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Blue', param: 'blue', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  liftGammaGain: [
    { name: 'Lift', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Red', param: 'red', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Green', param: 'green', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Blue', param: 'blue', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Gamma', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Gain', param: 'amount3', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  thermal: [
    { name: 'Intensity', param: 'thermalIntensity', min: 0, max: 1, step: 0.01, default: 1 },
  ],
  nightVision: [
    { name: 'Intensity', param: 'nightVisionIntensity', min: 0, max: 1, step: 0.01, default: 1 },
    { name: 'Noise', param: 'nightVisionNoise', min: 0, max: 1, step: 0.01, default: 0.2 },
  ],
  filmicTonemap: [
    { name: 'Amount', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Detail', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  selectiveColor: [
    { name: 'Amount', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Detail', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Threshold', param: 'threshold', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],

  // ═══════════════════════════════
  // ── Stylize (14) ──
  // ═══════════════════════════════
  dither: [
    { name: 'Intensity', param: 'ditherIntensity', min: 0, max: 1, step: 0.01, default: 1 },
    { name: 'Scale', param: 'ditherScale', min: 1, max: 8, step: 1, default: 1 },
  ],
  edgeDetect: [
    { name: 'Threshold', param: 'edgeThreshold', min: 0, max: 1, step: 0.01, default: 0.1 },
    { name: 'Strength', param: 'edgeStrength', min: 0, max: 2, step: 0.01, default: 1 },
  ],
  outline: [
    { name: 'Thickness', param: 'outlineThickness', min: 1, max: 10, step: 1, default: 2 },
    { name: 'Threshold', param: 'outlineThreshold', min: 0, max: 1, step: 0.01, default: 0.1 },
  ],
  emboss: [
    { name: 'Strength', param: 'embossStrength', min: 0, max: 4, step: 0.1, default: 1 },
  ],
  vhs: [
    { name: 'Tracking', param: 'vhsTracking', min: 0, max: 1, step: 0.01, default: 0.3 },
    { name: 'Noise', param: 'vhsNoise', min: 0, max: 1, step: 0.01, default: 0.3 },
    { name: 'Distortion', param: 'vhsDistortion', min: 0, max: 1, step: 0.01, default: 0.2 },
    { name: 'Color Bleed', param: 'vhsColorBleed', min: 0, max: 1, step: 0.01, default: 0.3 },
  ],
  glitch: [
    { name: 'Intensity', param: 'glitchIntensity', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Speed', param: 'glitchSpeed', min: 0, max: 5, step: 0.1, default: 1 },
    { name: 'RGB Split', param: 'glitchRGBSplit', min: 0, max: 1, step: 0.01, default: 0.02 },
  ],
  rgbShift: [
    { name: 'Amount', param: 'rgbShiftAmount', min: 0, max: 0.05, step: 0.001, default: 0.01 },
    { name: 'Angle', param: 'rgbShiftAngle', min: 0, max: 360, step: 1, default: 0 },
  ],
  scanlines: [
    { name: 'Intensity', param: 'scanlinesIntensity', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Count', param: 'scanlinesCount', min: 50, max: 500, step: 10, default: 200 },
  ],
  pixelate: [
    { name: 'Size', param: 'pixelateSize', min: 1, max: 64, step: 1, default: 8 },
  ],
  halftone: [
    { name: 'Amount', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Detail', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  toon: [
    { name: 'Amount', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Detail', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  kuwahara: [
    { name: 'Amount', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Detail', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  oilPaint: [
    { name: 'Amount', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Detail', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  watercolor: [
    { name: 'Amount', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Detail', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],

  // ═══════════════════════════════
  // ── Blur & Focus (7) ──
  // ═══════════════════════════════
  blur: [
    { name: 'Radius', param: 'blurRadius', min: 0, max: 30, step: 0.5, default: 5 },
  ],
  sharpen: [
    { name: 'Amount', param: 'sharpenAmount', min: 0, max: 2, step: 0.1, default: 1 },
  ],
  directionalBlur: [
    { name: 'Amount', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.25 },
    { name: 'Angle', param: 'angle', min: 0, max: 6.283, step: 0.01, default: 0 },
  ],
  zoomBlur: [
    { name: 'Amount', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Detail', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Center X', param: 'centerX', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Center Y', param: 'centerY', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  radialBlur: [
    { name: 'Amount', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Detail', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Center X', param: 'centerX', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Center Y', param: 'centerY', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  tiltShift: [
    { name: 'Amount', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Detail', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Center X', param: 'centerX', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Center Y', param: 'centerY', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  defocusBokeh: [
    { name: 'Amount', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Detail', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Threshold', param: 'threshold', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],

  // ═══════════════════════════════
  // ── Light & Glow (7) ──
  // ═══════════════════════════════
  bloom: [
    { name: 'Intensity', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.35 },
    { name: 'Radius', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Threshold', param: 'threshold', min: 0, max: 1, step: 0.01, default: 0.65 },
  ],
  chromaticAberration: [
    { name: 'Amount', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Detail', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Center X', param: 'centerX', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Center Y', param: 'centerY', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  godRays: [
    { name: 'Amount', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Detail', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Center X', param: 'centerX', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Center Y', param: 'centerY', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  halation: [
    { name: 'Amount', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Detail', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Threshold', param: 'threshold', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  anamorphicStreak: [
    { name: 'Amount', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Detail', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Threshold', param: 'threshold', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  lensDirt: [
    { name: 'Amount', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Detail', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Threshold', param: 'threshold', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  diffusionPromist: [
    { name: 'Amount', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Detail', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Threshold', param: 'threshold', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],

  // ═══════════════════════════════
  // ── Generate & Texture (4) ──
  // ═══════════════════════════════
  noise: [
    { name: 'Amount', param: 'noiseAmount', min: 0, max: 1, step: 0.01, default: 0.3 },
  ],
  filmGrain: [
    { name: 'Amount', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Detail', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  heatHaze: [
    { name: 'Amount', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Detail', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  crt: [
    { name: 'Amount', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Detail', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],

  // ═══════════════════════════════
  // ── Distort (9) ──
  // ═══════════════════════════════
  kaleidoscope: [
    { name: 'Segments', param: 'kaleidoscopeSegments', min: 2, max: 16, step: 1, default: 6 },
    { name: 'Rotation', param: 'kaleidoscopeRotation', min: 0, max: 360, step: 1, default: 0 },
  ],
  mirror: [
    { name: 'Horizontal', param: 'mirrorHorizontal', min: 0, max: 1, step: 1, default: 1 },
    { name: 'Vertical', param: 'mirrorVertical', min: 0, max: 1, step: 1, default: 0 },
  ],
  wave: [
    { name: 'Amplitude', param: 'waveAmplitude', min: 0, max: 0.1, step: 0.005, default: 0.02 },
    { name: 'Frequency', param: 'waveFrequency', min: 1, max: 20, step: 1, default: 5 },
    { name: 'Speed', param: 'waveSpeed', min: 0, max: 5, step: 0.1, default: 1 },
  ],
  fisheye: [
    { name: 'Strength', param: 'fisheyeStrength', min: -1, max: 1, step: 0.1, default: 0.5 },
  ],
  lensDistortion: [
    { name: 'Amount', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Detail', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Center X', param: 'centerX', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Center Y', param: 'centerY', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  displacement: [
    { name: 'Amount', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Detail', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  twirl: [
    { name: 'Amount', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Detail', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Center X', param: 'centerX', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Center Y', param: 'centerY', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  pinchBulge: [
    { name: 'Amount', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Detail', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Center X', param: 'centerX', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Center Y', param: 'centerY', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  polarTransform: [
    { name: 'Amount', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Detail', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Threshold', param: 'threshold', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],

  // ═══════════════════════════════
  // ── Keying (5) ──
  // ═══════════════════════════════
  chromaKey: [
    { name: 'Threshold', param: 'threshold', min: 0, max: 1, step: 0.01, default: 0.4 },
    { name: 'Softness', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.15 },
    { name: 'Red', param: 'red', min: 0, max: 1, step: 0.01, default: 0 },
    { name: 'Green', param: 'green', min: 0, max: 1, step: 0.01, default: 1 },
    { name: 'Blue', param: 'blue', min: 0, max: 1, step: 0.01, default: 0 },
  ],
  lumaKey: [
    { name: 'Threshold', param: 'threshold', min: 0, max: 1, step: 0.01, default: 0.4 },
    { name: 'Softness', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.15 },
  ],
  differenceKey: [
    { name: 'Threshold', param: 'threshold', min: 0, max: 1, step: 0.01, default: 0.4 },
    { name: 'Softness', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.15 },
  ],
  erode: [
    { name: 'Amount', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Detail', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  dilate: [
    { name: 'Amount', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Detail', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],

  // ═══════════════════════════════
  // ── Premium Color (3) ──
  // ═══════════════════════════════
  falseColor: [
    { name: 'Amount', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Detail', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Threshold', param: 'threshold', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  shadowRecovery: [
    { name: 'Amount', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Detail', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Threshold', param: 'threshold', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  highlightRolloff: [
    { name: 'Amount', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Detail', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Threshold', param: 'threshold', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],

  // ═══════════════════════════════
  // ── Premium Stylize (6) ──
  // ═══════════════════════════════
  compressionArtifacts: [
    { name: 'Amount', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Detail', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  ascii: [
    { name: 'Amount', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Detail', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Threshold', param: 'threshold', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  comicInk: [
    { name: 'Amount', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Detail', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Threshold', param: 'threshold', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  datamoshLite: [
    { name: 'Amount', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Detail', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Threshold', param: 'threshold', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  scanlineDrift: [
    { name: 'Amount', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Detail', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Threshold', param: 'threshold', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  tapeDropout: [
    { name: 'Amount', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Detail', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Threshold', param: 'threshold', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],

  // ═══════════════════════════════
  // ── Premium Warp (7) ──
  // ═══════════════════════════════
  rippleCaustics: [
    { name: 'Amount', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Detail', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Threshold', param: 'threshold', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  shockwave: [
    { name: 'Amount', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Detail', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Center X', param: 'centerX', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Center Y', param: 'centerY', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  drosteRecursive: [
    { name: 'Amount', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Detail', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Threshold', param: 'threshold', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  slitScan: [
    { name: 'Amount', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Detail', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Threshold', param: 'threshold', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  fractalWarp: [
    { name: 'Amount', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Detail', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Threshold', param: 'threshold', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  fluidDistort: [
    { name: 'Amount', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Detail', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Threshold', param: 'threshold', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  wormhole: [
    { name: 'Amount', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Detail', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Center X', param: 'centerX', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Center Y', param: 'centerY', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],

  // ═══════════════════════════════
  // ── Premium Atmosphere (5) ──
  // ═══════════════════════════════
  volumetricFogOverlay: [
    { name: 'Amount', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Detail', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Threshold', param: 'threshold', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  rainFogSnowOverlay: [
    { name: 'Amount', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Detail', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Threshold', param: 'threshold', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  particleOverlayFx: [
    { name: 'Amount', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Detail', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Threshold', param: 'threshold', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  glintStarburst: [
    { name: 'Amount', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Detail', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Threshold', param: 'threshold', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  embossRelight: [
    { name: 'Amount', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Detail', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Angle', param: 'angle', min: 0, max: 6.283, step: 0.01, default: 0.785 },
  ],

  // ═══════════════════════════════
  // ── Premium Text & Pattern (6) ──
  // ═══════════════════════════════
  dotMatrix: [
    { name: 'Amount', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Detail', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Threshold', param: 'threshold', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  matrixRain: [
    { name: 'Amount', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Detail', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Threshold', param: 'threshold', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  binaryCode: [
    { name: 'Amount', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Detail', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Threshold', param: 'threshold', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  crosshatch: [
    { name: 'Amount', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Detail', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Threshold', param: 'threshold', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  blockMosaic: [
    { name: 'Amount', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Detail', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Threshold', param: 'threshold', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  numberGrid: [
    { name: 'Amount', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Detail', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Threshold', param: 'threshold', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  braillePattern: [
    { name: 'Cell Size', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.4 },
    { name: 'Dot Size', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Color Mix', param: 'amount3', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  circuitBoard: [
    { name: 'Trace Density', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Trace Width', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Glow', param: 'amount3', min: 0, max: 1, step: 0.01, default: 0.4 },
  ],
  stainedGlass: [
    { name: 'Cell Count', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Lead Width', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.4 },
    { name: 'Saturation', param: 'amount3', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  wovenFabric: [
    { name: 'Thread Density', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Thread Width', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Shadow Depth', param: 'amount3', min: 0, max: 1, step: 0.01, default: 0.4 },
  ],
  mosaicTile: [
    { name: 'Tile Size', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Grout Width', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.3 },
    { name: 'Rotation', param: 'amount3', min: 0, max: 1, step: 0.01, default: 0.3 },
  ],
  neonOutline: [
    { name: 'Edge Sensitivity', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Glow Spread', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Glow Intensity', param: 'amount3', min: 0, max: 1, step: 0.01, default: 0.6 },
    { name: 'Red', param: 'red', min: 0, max: 1, step: 0.01, default: 1.0 },
    { name: 'Green', param: 'green', min: 0, max: 1, step: 0.01, default: 0.2 },
    { name: 'Blue', param: 'blue', min: 0, max: 1, step: 0.01, default: 0.8 },
  ],
  pixelSort: [
    { name: 'Sort Distance', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Threshold', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.4 },
    { name: 'Chromatic Sep', param: 'amount3', min: 0, max: 1, step: 0.01, default: 0.3 },
  ],
  linocut: [
    { name: 'Detail', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Groove Spacing', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.4 },
    { name: 'Ink Intensity', param: 'amount3', min: 0, max: 1, step: 0.01, default: 0.7 },
    { name: 'Threshold', param: 'threshold', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  topoMap: [
    { name: 'Contour Density', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Line Thickness', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.4 },
    { name: 'Color Fill', param: 'amount3', min: 0, max: 1, step: 0.01, default: 0.3 },
    { name: 'Red', param: 'red', min: 0, max: 1, step: 0.01, default: 0.25 },
    { name: 'Green', param: 'green', min: 0, max: 1, step: 0.01, default: 0.18 },
    { name: 'Blue', param: 'blue', min: 0, max: 1, step: 0.01, default: 0.12 },
  ],
  ledWall: [
    { name: 'LED Size', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.4 },
    { name: 'Roundness', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Bloom', param: 'amount3', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],

  // ═══════════════════════════════
  // ── Premium 3D (5) ──
  // ═══════════════════════════════
  explode3D: [
    { name: 'Amount', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Detail', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Threshold', param: 'threshold', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  terrain3D: [
    { name: 'Amount', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Detail', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Threshold', param: 'threshold', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  sphereProject: [
    { name: 'Amount', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Detail', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Threshold', param: 'threshold', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  cubeProject: [
    { name: 'Amount', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Detail', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Threshold', param: 'threshold', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  geometricTile: [
    { name: 'Amount', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Detail', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Threshold', param: 'threshold', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  geometricTilePro: [
    { name: 'Tile Count', param: 'geomProTileCount', min: 0, max: 1, step: 0.01, default: 0.4 },
    { name: 'Flip Range', param: 'geomProFlipRange', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Speed',      param: 'geomProSpeed',     min: 0, max: 1, step: 0.01, default: 0.3 },
    { name: 'Gap Size',   param: 'geomProGap',       min: 0, max: 1, step: 0.01, default: 0.1 },
  ],
  hexGrid: [
    { name: 'Blend', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.8 },
    { name: 'Hex Size', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.4 },
    { name: 'Pop Speed', param: 'amount3', min: 0, max: 1, step: 0.01, default: 0.3 },
    { name: 'Gap', param: 'threshold', min: 0, max: 1, step: 0.01, default: 0.2 },
  ],
  spiralTile: [
    { name: 'Blend', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.8 },
    { name: 'Arms / Rings', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.4 },
    { name: 'Spin Speed', param: 'amount3', min: 0, max: 1, step: 0.01, default: 0.2 },
    { name: 'Gap', param: 'threshold', min: 0, max: 1, step: 0.01, default: 0.3 },
  ],
  shingleStack: [
    { name: 'Blend', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.8 },
    { name: 'Tile Count', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.4 },
    { name: 'Slide Speed', param: 'amount3', min: 0, max: 1, step: 0.01, default: 0.25 },
    { name: 'Overlap', param: 'threshold', min: 0, max: 1, step: 0.01, default: 0.3 },
  ],
  voronoiShatter: [
    { name: 'Blend', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.8 },
    { name: 'Cell Count', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.4 },
    { name: 'Drift Speed', param: 'amount3', min: 0, max: 1, step: 0.01, default: 0.2 },
    { name: 'Gap', param: 'threshold', min: 0, max: 1, step: 0.01, default: 0.3 },
  ],

  // ═══════════════════════════════
  // ── Premium Depth (3) ──
  // ═══════════════════════════════
  tunnelFlight: [
    { name: 'Amount', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Detail', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Threshold', param: 'threshold', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  infiniteMirror: [
    { name: 'Amount', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Detail', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Threshold', param: 'threshold', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  crystalRefract: [
    { name: 'Amount', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Detail', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Threshold', param: 'threshold', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],

  // ═══════════════════════════════
  // ── Premium 3D (10) ──
  // ═══════════════════════════════
  cylinderWrap: [
    { name: 'Blend', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.8 },
    { name: 'Radius', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Spin Speed', param: 'amount3', min: 0, max: 1, step: 0.01, default: 0.2 },
    { name: 'Perspective', param: 'threshold', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Light Color', param: 'red', min: 0, max: 1, step: 0.01, default: 1.0, type: 'color', colorParams: { r: 'red', g: 'green', b: 'blue' } },
  ],
  torusTunnel: [
    { name: 'Blend', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.8 },
    { name: 'Tube Radius', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.4 },
    { name: 'Fly Speed', param: 'amount3', min: 0, max: 1, step: 0.01, default: 0.3 },
    { name: 'Twist', param: 'threshold', min: 0, max: 1, step: 0.01, default: 0.3 },
    { name: 'Fog Color', param: 'red', min: 0, max: 1, step: 0.01, default: 0.1, type: 'color', colorParams: { r: 'red', g: 'green', b: 'blue' } },
  ],
  diamondGem: [
    { name: 'Blend', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.8 },
    { name: 'Facets', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Rotation', param: 'amount3', min: 0, max: 1, step: 0.01, default: 0.15 },
    { name: 'Sparkle', param: 'threshold', min: 0, max: 1, step: 0.01, default: 0.6 },
    { name: 'Light Color', param: 'red', min: 0, max: 1, step: 0.01, default: 1.0, type: 'color', colorParams: { r: 'red', g: 'green', b: 'blue' } },
  ],
  shatter3D: [
    { name: 'Explosion', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Shard Size', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.4 },
    { name: 'Speed', param: 'amount3', min: 0, max: 1, step: 0.01, default: 0.3 },
    { name: 'Gravity', param: 'threshold', min: 0, max: 1, step: 0.01, default: 0.3 },
  ],
  mobiusStrip: [
    { name: 'Blend', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.8 },
    { name: 'Strip Width', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.4 },
    { name: 'Rotation', param: 'amount3', min: 0, max: 1, step: 0.01, default: 0.2 },
    { name: 'Twist', param: 'threshold', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Light Color', param: 'red', min: 0, max: 1, step: 0.01, default: 0.8, type: 'color', colorParams: { r: 'red', g: 'green', b: 'blue' } },
  ],
  voxelDisplace: [
    { name: 'Depth Scale', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Resolution', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.4 },
    { name: 'Rotation', param: 'amount3', min: 0, max: 1, step: 0.01, default: 0.15 },
    { name: 'Gap Size', param: 'threshold', min: 0, max: 1, step: 0.01, default: 0.2 },
    { name: 'Light Color', param: 'red', min: 0, max: 1, step: 0.01, default: 1.0, type: 'color', colorParams: { r: 'red', g: 'green', b: 'blue' } },
  ],
  waveSurface: [
    { name: 'Amplitude', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.4 },
    { name: 'Frequency', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Speed', param: 'amount3', min: 0, max: 1, step: 0.01, default: 0.3 },
    { name: 'Specular', param: 'threshold', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Sky Color', param: 'red', min: 0, max: 1, step: 0.01, default: 0.5, type: 'color', colorParams: { r: 'red', g: 'green', b: 'blue' } },
  ],
  prismSplit: [
    { name: 'Separation', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Prism Angle', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Rotation', param: 'amount3', min: 0, max: 1, step: 0.01, default: 0.0 },
    { name: 'Glass Tint', param: 'threshold', min: 0, max: 1, step: 0.01, default: 0.3 },
    { name: 'Tint Color', param: 'red', min: 0, max: 1, step: 0.01, default: 1.0, type: 'color', colorParams: { r: 'red', g: 'green', b: 'blue' } },
  ],
  origamiFold: [
    { name: 'Fold Depth', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Fold Count', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.4 },
    { name: 'Animation', param: 'amount3', min: 0, max: 1, step: 0.01, default: 0.2 },
    { name: 'Sharpness', param: 'threshold', min: 0, max: 1, step: 0.01, default: 0.6 },
  ],
  mirrorRoom: [
    { name: 'Blend', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.8 },
    { name: 'Room Size', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Camera Move', param: 'amount3', min: 0, max: 1, step: 0.01, default: 0.15 },
    { name: 'Reflection Fade', param: 'threshold', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Tint Color', param: 'red', min: 0, max: 1, step: 0.01, default: 0.9, type: 'color', colorParams: { r: 'red', g: 'green', b: 'blue' } },
  ],

  // ═══════════════════════════════
  // ── Premium Feedback (1) ──
  // ═══════════════════════════════
  feedbackZoom: [
    { name: 'Amount', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Detail', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Center X', param: 'centerX', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Center Y', param: 'centerY', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],

  // ═══════════════════════════════
  // ── Premium Trails (6) ──
  // ═══════════════════════════════
  motionTrails: [
    { name: 'Amount', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Detail', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Threshold', param: 'threshold', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  echoRepeat: [
    { name: 'Amount', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Detail', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Threshold', param: 'threshold', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  ghostDouble: [
    { name: 'Amount', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Detail', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Threshold', param: 'threshold', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  strobeFlash: [
    { name: 'Amount', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Detail', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Threshold', param: 'threshold', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  lightPaint: [
    { name: 'Amount', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Detail', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Threshold', param: 'threshold', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  recursiveEcho: [
    { name: 'Amount', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Detail', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Threshold', param: 'threshold', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],

  // ═══════════════════════════════
  // ── VJ-only Simple Effects (4) ──
  // ═══════════════════════════════
  brightness: [
    { name: 'Amount', param: 'brightnessAmount', min: -1, max: 1, step: 0.01, default: 0 },
  ],
  contrast: [
    { name: 'Amount', param: 'contrastAmount', min: -1, max: 1, step: 0.01, default: 0 },
  ],
  saturation: [
    { name: 'Amount', param: 'saturationAmount', min: -1, max: 1, step: 0.01, default: 0 },
  ],
  hue: [
    { name: 'Shift', param: 'hueShift', min: 0, max: 360, step: 1, default: 0 },
  ],

  // ═══════════════════════════════════════
  // ── Blob Tracking / Analysis (3) ──
  // ═══════════════════════════════════════
  blobTrack: [
    { name: 'Threshold', param: 'blobThreshold', min: 0, max: 1, step: 0.01, default: 0.3 },
    { name: 'Shape', param: 'blobShape', min: 0, max: 4, step: 1, default: 0 },  // 0=circle 1=square 2=triangle 3=diamond 4=crosshair
    { name: 'Color', param: 'blobColor', min: 0, max: 7, step: 1, default: 0 },  // 0=green 1=cyan 2=magenta 3=amber 4=red 5=blue 6=white 7=auto
    { name: 'Color Mode', param: 'blobColorMode', min: 0, max: 2, step: 1, default: 0, type: 'select', options: [
      { value: 0, label: 'Auto' },
      { value: 1, label: 'Fixed' },
      { value: 2, label: 'Spectrum' },
    ]},
    { name: 'Blob Color', param: 'blobFixedColorR', min: 0, max: 1, step: 0.01, default: 0, type: 'color', colorParams: { r: 'blobFixedColorR', g: 'blobFixedColorG', b: 'blobFixedColorB' } },
    { name: 'Thickness', param: 'blobThickness', min: 0.5, max: 5, step: 0.1, default: 2 },
    { name: 'Min Size', param: 'blobMinSize', min: 0, max: 0.5, step: 0.01, default: 0.02 },
    { name: 'Connectors', param: 'blobTrailLength', min: 0, max: 1, step: 0.01, default: 0.3 },
    { name: 'Coords', param: 'blobShowCoords', min: 0, max: 1, step: 1, default: 1 },
    { name: 'Brackets', param: 'blobShowBBox', min: 0, max: 1, step: 1, default: 1 },
    { name: 'Centers', param: 'blobShowCenter', min: 0, max: 1, step: 1, default: 1 },
    { name: 'Grid', param: 'blobGridSize', min: 4, max: 48, step: 1, default: 16 },
    { name: 'Mix', param: 'blobMix', min: 0, max: 1, step: 0.01, default: 0.8 },
  ],
  blobContour: [
    { name: 'Threshold', param: 'blobThreshold', min: 0, max: 1, step: 0.01, default: 0.4 },
    { name: 'Style', param: 'blobShape', min: 0, max: 2, step: 1, default: 0 },  // 0=smooth 1=stepped 2=dashed
    { name: 'Color', param: 'blobColor', min: 0, max: 7, step: 1, default: 1 },
    { name: 'Thickness', param: 'blobThickness', min: 0.5, max: 5, step: 0.1, default: 1.5 },
    { name: 'Levels', param: 'blobMinSize', min: 0.05, max: 1, step: 0.05, default: 0.5 },
    { name: 'Values', param: 'blobShowCoords', min: 0, max: 1, step: 1, default: 0 },
    { name: 'Glow', param: 'blobTrailLength', min: 0, max: 1, step: 0.01, default: 0.4 },
    { name: 'Mix', param: 'blobMix', min: 0, max: 1, step: 0.01, default: 0.7 },
  ],
  blobHeatmap: [
    { name: 'Threshold', param: 'blobThreshold', min: 0, max: 1, step: 0.01, default: 0.2 },
    { name: 'Palette', param: 'blobColor', min: 0, max: 3, step: 1, default: 0 },  // 0=inferno 1=viridis 2=plasma 3=magma
    { name: 'Style', param: 'blobShape', min: 0, max: 2, step: 1, default: 0 },  // 0=smooth 1=stepped 2=thermal
    { name: 'Grid', param: 'blobGridSize', min: 4, max: 48, step: 1, default: 16 },
    { name: 'Grid Lines', param: 'blobShowBBox', min: 0, max: 1, step: 1, default: 1 },
    { name: 'Line Width', param: 'blobThickness', min: 0.5, max: 5, step: 0.1, default: 1 },
    { name: 'Values', param: 'blobShowCoords', min: 0, max: 1, step: 1, default: 1 },
    { name: 'Peaks', param: 'blobShowCenter', min: 0, max: 1, step: 1, default: 1 },
    { name: 'Mix', param: 'blobMix', min: 0, max: 1, step: 0.01, default: 0.85 },
  ],

  // ── Time-Based Effects ──
  timeSmear: [
    { name: 'Direction', param: 'mode', min: 0, max: 3, step: 1, default: 0,
      type: 'select', options: [
        { value: 0, label: 'Horizontal' },
        { value: 1, label: 'Vertical' },
        { value: 2, label: 'Radial' },
        { value: 3, label: 'Rotational' },
      ] },
    { name: 'Line Position', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Smear Intensity', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Speed', param: 'speed', min: 0, max: 3, step: 0.01, default: 1.0 },
  ],
  chronophoto: [
    { name: 'Trail Type', param: 'mode', min: 0, max: 3, step: 1, default: 0,
      type: 'select', options: [
        { value: 0, label: 'Linear' },
        { value: 1, label: 'Circular' },
        { value: 2, label: 'Zoom' },
        { value: 3, label: 'Spiral' },
      ] },
    { name: 'Echo Count', param: 'amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Trail Spread', param: 'amount2', min: 0, max: 1, step: 0.01, default: 0.3 },
    { name: 'Speed', param: 'speed', min: 0, max: 3, step: 0.01, default: 1.0 },
  ],
};
