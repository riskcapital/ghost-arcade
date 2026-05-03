import type { Effect, EffectParams, EffectType } from '../types';
import { getDefaultEffectParams } from '../renderer/effects';

export interface EffectPreset {
  name: string;
  params: Partial<EffectParams>;
}

// ── Parameter metadata for UI labels ──
export interface ParamMeta {
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
  type?: 'slider' | 'select' | 'color';
  options?: { value: number; label: string }[];
  // For color type: maps to 3 separate R/G/B param keys
  colorParams?: { r: string; g: string; b: string };
}

// Human-readable parameter labels, ranges, and defaults for every effect.
// The keys match the generic param names in EffectParams (amount, amount2, etc.)
// but the labels give them meaningful names in the UI.
export const effectParamLabels: Partial<Record<EffectType, Record<string, ParamMeta>>> = {
  // ── Masking ──
  vignette: {
    vignetteSize: { label: 'Size', min: 0, max: 1.5, step: 0.01, default: 0.8 },
    vignetteSoftness: { label: 'Softness', min: 0, max: 1, step: 0.01, default: 0.4 },
    vignetteRoundness: { label: 'Roundness', min: 0, max: 1, step: 0.01, default: 0.5 },
  },
  edgeFeather: {
    featherTop: { label: 'Top', min: 0, max: 1, step: 0.01, default: 0 },
    featherBottom: { label: 'Bottom', min: 0, max: 1, step: 0.01, default: 0 },
    featherLeft: { label: 'Left', min: 0, max: 1, step: 0.01, default: 0 },
    featherRight: { label: 'Right', min: 0, max: 1, step: 0.01, default: 0 },
    featherSoftness: { label: 'Softness', min: 0, max: 1, step: 0.01, default: 0.5 },
  },
  // ── Color ──
  colorama: {
    coloramaPalette: { label: 'Palette', min: 0, max: 7, step: 1, default: 0 },
    coloramaOffset: { label: 'Offset', min: 0, max: 1, step: 0.01, default: 0 },
    coloramaSpeed: { label: 'Speed', min: 0, max: 2, step: 0.01, default: 0.2 },
    coloramaContrast: { label: 'Contrast', min: 0.5, max: 2, step: 0.01, default: 1 },
    coloramaMix: { label: 'Mix', min: 0, max: 1, step: 0.01, default: 1 },
  },
  plasma: {
    plasmaSpeed: { label: 'Speed', min: 0, max: 2, step: 0.01, default: 1 },
    plasmaScale: { label: 'Scale', min: 1, max: 20, step: 0.1, default: 5 },
    plasmaComplexity: { label: 'Complexity', min: 1, max: 5, step: 1, default: 3 },
    plasmaPalette: { label: 'Palette', min: 0, max: 4, step: 1, default: 0 },
  },
  posterize: {
    posterizeLevels: { label: 'Levels', min: 2, max: 32, step: 1, default: 8 },
  },
  exposure: {
    amount: { label: 'Exposure', min: 0, max: 1, step: 0.01, default: 0.5 },
  },
  gamma: {
    amount: { label: 'Gamma', min: 0, max: 1, step: 0.01, default: 0.5 },
  },
  vibrance: {
    amount: { label: 'Vibrance', min: 0, max: 1, step: 0.01, default: 0.5 },
  },
  temperatureTint: {
    amount: { label: 'Temperature', min: 0, max: 1, step: 0.01, default: 0.5 },
    amount2: { label: 'Tint', min: 0, max: 1, step: 0.01, default: 0.5 },
  },
  colorBalance: {
    amount: { label: 'Strength', min: 0, max: 1, step: 0.01, default: 0.5 },
    red: { label: 'Red', min: 0, max: 1, step: 0.01, default: 0.5 },
    green: { label: 'Green', min: 0, max: 1, step: 0.01, default: 0.5 },
    blue: { label: 'Blue', min: 0, max: 1, step: 0.01, default: 0.5 },
  },
  curves: {
    amount: { label: 'Master', min: 0, max: 1, step: 0.01, default: 0.5 },
    red: { label: 'Red Curve', min: 0, max: 1, step: 0.01, default: 0.5 },
    green: { label: 'Green Curve', min: 0, max: 1, step: 0.01, default: 0.5 },
    blue: { label: 'Blue Curve', min: 0, max: 1, step: 0.01, default: 0.5 },
  },
  liftGammaGain: {
    amount: { label: 'Lift', min: 0, max: 1, step: 0.01, default: 0.5 },
    amount2: { label: 'Gamma', min: 0, max: 1, step: 0.01, default: 0.5 },
    amount3: { label: 'Gain', min: 0, max: 1, step: 0.01, default: 0.5 },
    red: { label: 'Red', min: 0, max: 1, step: 0.01, default: 0.5 },
    green: { label: 'Green', min: 0, max: 1, step: 0.01, default: 0.5 },
    blue: { label: 'Blue', min: 0, max: 1, step: 0.01, default: 0.5 },
  },
  thermal: {
    thermalIntensity: { label: 'Intensity', min: 0, max: 2, step: 0.01, default: 1 },
    thermalPalette: { label: 'Palette', min: 0, max: 2, step: 1, default: 0 },
  },
  nightVision: {
    nightVisionIntensity: { label: 'Intensity', min: 0, max: 2, step: 0.01, default: 1.5 },
    nightVisionNoise: { label: 'Noise', min: 0, max: 1, step: 0.01, default: 0.3 },
    nightVisionVignette: { label: 'Vignette', min: 0, max: 1, step: 0.01, default: 0.5 },
  },
  filmicTonemap: {
    amount: { label: 'Intensity', min: 0, max: 1, step: 0.01, default: 0.6 },
    amount2: { label: 'Shoulder', min: 0, max: 1, step: 0.01, default: 0.5 },
    amount3: { label: 'Toe', min: 0, max: 1, step: 0.01, default: 0.3 },
    threshold: { label: 'White Point', min: 0, max: 1, step: 0.01, default: 0.9 },
  },
  selectiveColor: {
    amount: { label: 'Hue Range', min: 0, max: 1, step: 0.01, default: 0.5 },
    amount2: { label: 'Hue Width', min: 0, max: 1, step: 0.01, default: 0.15 },
    amount3: { label: 'Saturation Shift', min: 0, max: 1, step: 0.01, default: 0.5 },
    red: { label: 'Target Hue', min: 0, max: 1, step: 0.01, default: 0 },
    green: { label: 'Hue Shift', min: 0, max: 1, step: 0.01, default: 0.5 },
    blue: { label: 'Lightness', min: 0, max: 1, step: 0.01, default: 0.5 },
  },
  // ── Stylize ──
  dither: {
    ditherType: { label: 'Algorithm', min: 0, max: 3, step: 1, default: 0 },
    ditherIntensity: { label: 'Intensity', min: 0, max: 1, step: 0.01, default: 1 },
    ditherScale: { label: 'Scale', min: 1, max: 16, step: 1, default: 1 },
    ditherColorDepth: { label: 'Color Depth', min: 1, max: 8, step: 1, default: 2 },
  },
  edgeDetect: {
    edgeThreshold: { label: 'Threshold', min: 0, max: 1, step: 0.01, default: 0.1 },
    edgeThickness: { label: 'Thickness', min: 0.5, max: 3, step: 0.1, default: 1 },
    edgeMode: { label: 'Algorithm', min: 0, max: 3, step: 1, default: 0 },
    edgeInvert: { label: 'Invert', min: 0, max: 1, step: 1, default: 0 },
  },
  outline: {
    outlineThickness: { label: 'Thickness', min: 1, max: 10, step: 0.5, default: 2 },
    outlineOnly: { label: 'Outline Only', min: 0, max: 1, step: 1, default: 0 },
    outlineGlow: { label: 'Glow', min: 0, max: 1, step: 0.01, default: 0 },
  },
  emboss: {
    embossStrength: { label: 'Strength', min: 0, max: 2, step: 0.01, default: 1 },
    embossAngle: { label: 'Light Angle', min: 0, max: 360, step: 1, default: 135 },
  },
  vhs: {
    vhsTracking: { label: 'Tracking', min: 0, max: 1, step: 0.01, default: 0.5 },
    vhsNoise: { label: 'Noise', min: 0, max: 1, step: 0.01, default: 0.3 },
    vhsDistortion: { label: 'Distortion', min: 0, max: 1, step: 0.01, default: 0.3 },
    vhsColorBleed: { label: 'Color Bleed', min: 0, max: 1, step: 0.01, default: 0.5 },
    vhsScanlines: { label: 'Scanlines', min: 0, max: 1, step: 0.01, default: 0.3 },
  },
  glitch: {
    glitchIntensity: { label: 'Intensity', min: 0, max: 1, step: 0.01, default: 0.5 },
    glitchSpeed: { label: 'Speed', min: 0, max: 2, step: 0.01, default: 1 },
    glitchBlockSize: { label: 'Block Size', min: 0, max: 1, step: 0.01, default: 0.3 },
    glitchRGBSplit: { label: 'RGB Split', min: 0, max: 1, step: 0.01, default: 0.5 },
    glitchJitter: { label: 'Jitter', min: 0, max: 1, step: 0.01, default: 0.3 },
  },
  rgbShift: {
    rgbShiftAmount: { label: 'Amount', min: 0, max: 50, step: 0.5, default: 5 },
    rgbShiftAngle: { label: 'Angle', min: 0, max: 360, step: 1, default: 0 },
  },
  scanlines: {
    scanlinesIntensity: { label: 'Intensity', min: 0, max: 1, step: 0.01, default: 0.5 },
    scanlinesCount: { label: 'Count', min: 50, max: 500, step: 10, default: 200 },
    scanlinesSpeed: { label: 'Scroll Speed', min: 0, max: 2, step: 0.01, default: 0 },
  },
  pixelate: {
    pixelateSize: { label: 'Pixel Size', min: 1, max: 64, step: 1, default: 8 },
  },
  halftone: {
    amount: { label: 'Dot Size', min: 0, max: 1, step: 0.01, default: 0.5 },
  },
  toon: {
    amount: { label: 'Edge Strength', min: 0, max: 1, step: 0.01, default: 0.5 },
    amount2: { label: 'Shade Levels', min: 0, max: 1, step: 0.01, default: 0.4 },
  },
  kuwahara: {
    amount: { label: 'Radius', min: 0, max: 1, step: 0.01, default: 0.4 },
  },
  oilPaint: {
    amount: { label: 'Radius', min: 0, max: 1, step: 0.01, default: 0.4 },
    amount2: { label: 'Quantize', min: 0, max: 1, step: 0.01, default: 0.4 },
  },
  watercolor: {
    amount: { label: 'Bleed', min: 0, max: 1, step: 0.01, default: 0.45 },
    amount2: { label: 'Edge Darken', min: 0, max: 1, step: 0.01, default: 0.4 },
  },
  // ── Blur & Focus ──
  blur: {
    blurRadius: { label: 'Radius', min: 0, max: 20, step: 0.1, default: 5 },
  },
  sharpen: {
    sharpenAmount: { label: 'Amount', min: 0, max: 2, step: 0.01, default: 0.5 },
  },
  directionalBlur: {
    amount: { label: 'Blur Amount', min: 0, max: 1, step: 0.01, default: 0.25 },
    angle: { label: 'Angle', min: 0, max: 6.28, step: 0.01, default: 0 },
  },
  zoomBlur: {
    amount: { label: 'Blur Amount', min: 0, max: 1, step: 0.01, default: 0.25 },
    centerX: { label: 'Center X', min: 0, max: 1, step: 0.01, default: 0.5 },
    centerY: { label: 'Center Y', min: 0, max: 1, step: 0.01, default: 0.5 },
  },
  radialBlur: {
    amount: { label: 'Spin Amount', min: 0, max: 1, step: 0.01, default: 0.25 },
    centerX: { label: 'Center X', min: 0, max: 1, step: 0.01, default: 0.5 },
    centerY: { label: 'Center Y', min: 0, max: 1, step: 0.01, default: 0.5 },
  },
  tiltShift: {
    amount: { label: 'Blur Amount', min: 0, max: 1, step: 0.01, default: 0.35 },
    amount2: { label: 'Focus Band', min: 0, max: 1, step: 0.01, default: 0.35 },
    centerY: { label: 'Focus Position', min: 0, max: 1, step: 0.01, default: 0.5 },
  },
  defocusBokeh: {
    amount: { label: 'Blur Radius', min: 0, max: 1, step: 0.01, default: 0.4 },
    amount2: { label: 'Bokeh Shape', min: 0, max: 1, step: 0.01, default: 0.5 },
    threshold: { label: 'Highlight Boost', min: 0, max: 1, step: 0.01, default: 0.3 },
    amount3: { label: 'Ring Width', min: 0, max: 1, step: 0.01, default: 0.5 },
  },
  // ── Light & Glow ──
  bloom: {
    amount: { label: 'Intensity', min: 0, max: 1, step: 0.01, default: 0.35 },
    amount2: { label: 'Spread', min: 0, max: 1, step: 0.01, default: 0.5 },
    threshold: { label: 'Threshold', min: 0, max: 1, step: 0.01, default: 0.65 },
  },
  chromaticAberration: {
    amount: { label: 'Amount', min: 0, max: 1, step: 0.01, default: 0.3 },
    centerX: { label: 'Center X', min: 0, max: 1, step: 0.01, default: 0.5 },
    centerY: { label: 'Center Y', min: 0, max: 1, step: 0.01, default: 0.5 },
  },
  godRays: {
    amount: { label: 'Ray Length', min: 0, max: 1, step: 0.01, default: 0.5 },
    amount2: { label: 'Intensity', min: 0, max: 1, step: 0.01, default: 0.35 },
    threshold: { label: 'Threshold', min: 0, max: 1, step: 0.01, default: 0.7 },
    centerX: { label: 'Source X', min: 0, max: 1, step: 0.01, default: 0.5 },
    centerY: { label: 'Source Y', min: 0, max: 1, step: 0.01, default: 0.5 },
  },
  halation: {
    amount: { label: 'Intensity', min: 0, max: 1, step: 0.01, default: 0.5 },
    amount2: { label: 'Spread', min: 0, max: 1, step: 0.01, default: 0.5 },
    threshold: { label: 'Threshold', min: 0, max: 1, step: 0.01, default: 0.6 },
    red: { label: 'Warmth R', min: 0, max: 1, step: 0.01, default: 0.8 },
    green: { label: 'Warmth G', min: 0, max: 1, step: 0.01, default: 0.4 },
    blue: { label: 'Warmth B', min: 0, max: 1, step: 0.01, default: 0.2 },
  },
  anamorphicStreak: {
    amount: { label: 'Streak Length', min: 0, max: 1, step: 0.01, default: 0.5 },
    amount2: { label: 'Intensity', min: 0, max: 1, step: 0.01, default: 0.5 },
    threshold: { label: 'Threshold', min: 0, max: 1, step: 0.01, default: 0.65 },
    red: { label: 'Tint R', min: 0, max: 1, step: 0.01, default: 0.6 },
    green: { label: 'Tint G', min: 0, max: 1, step: 0.01, default: 0.7 },
    blue: { label: 'Tint B', min: 0, max: 1, step: 0.01, default: 1.0 },
  },
  lensDirt: {
    amount: { label: 'Intensity', min: 0, max: 1, step: 0.01, default: 0.4 },
    amount2: { label: 'Scale', min: 0, max: 1, step: 0.01, default: 0.5 },
    threshold: { label: 'Threshold', min: 0, max: 1, step: 0.01, default: 0.6 },
    amount3: { label: 'Complexity', min: 0, max: 1, step: 0.01, default: 0.5 },
  },
  diffusionPromist: {
    amount: { label: 'Diffusion', min: 0, max: 1, step: 0.01, default: 0.45 },
    amount2: { label: 'Glow Spread', min: 0, max: 1, step: 0.01, default: 0.5 },
    threshold: { label: 'Highlight Threshold', min: 0, max: 1, step: 0.01, default: 0.5 },
    amount3: { label: 'Warmth', min: 0, max: 1, step: 0.01, default: 0.3 },
  },
  // ── Generate & Texture ──
  noise: {
    noiseAmount: { label: 'Amount', min: 0, max: 1, step: 0.01, default: 0.2 },
    noiseType: { label: 'Animated', min: 0, max: 1, step: 1, default: 0 },
  },
  filmGrain: {
    amount: { label: 'Grain Amount', min: 0, max: 1, step: 0.01, default: 0.2 },
  },
  heatHaze: {
    amount: { label: 'Distortion', min: 0, max: 1, step: 0.01, default: 0.3 },
  },
  crt: {
    amount: { label: 'Scanlines', min: 0, max: 1, step: 0.01, default: 0.4 },
    amount2: { label: 'RGB Mask', min: 0, max: 1, step: 0.01, default: 0.5 },
    amount3: { label: 'Curvature', min: 0, max: 1, step: 0.01, default: 0.5 },
  },
  // ── Distort ──
  kaleidoscope: {
    kaleidoscopeSegments: { label: 'Segments', min: 2, max: 16, step: 1, default: 6 },
    kaleidoscopeAngle: { label: 'Rotation', min: 0, max: 360, step: 1, default: 0 },
  },
  mirror: {
    mirrorAxis: { label: 'Axis', min: 0, max: 2, step: 1, default: 0 },
    mirrorPosition: { label: 'Position', min: 0, max: 1, step: 0.01, default: 0.5 },
  },
  wave: {
    waveAmplitude: { label: 'Amplitude', min: 0, max: 50, step: 0.5, default: 10 },
    waveFrequency: { label: 'Frequency', min: 1, max: 20, step: 0.5, default: 5 },
    waveSpeed: { label: 'Speed', min: 0, max: 2, step: 0.01, default: 1 },
    waveType: { label: 'Direction', min: 0, max: 2, step: 1, default: 0 },
  },
  fisheye: {
    fisheyeStrength: { label: 'Strength', min: -1, max: 1, step: 0.01, default: 0.5 },
    fisheyeRadius: { label: 'Radius', min: 0, max: 1, step: 0.01, default: 1 },
  },
  lensDistortion: {
    amount: { label: 'Distortion', min: 0, max: 1, step: 0.01, default: 0.5 },
    centerX: { label: 'Center X', min: 0, max: 1, step: 0.01, default: 0.5 },
    centerY: { label: 'Center Y', min: 0, max: 1, step: 0.01, default: 0.5 },
  },
  displacement: {
    amount: { label: 'Displacement', min: 0, max: 1, step: 0.01, default: 0.3 },
  },
  twirl: {
    amount: { label: 'Twirl Angle', min: 0, max: 1, step: 0.01, default: 0.4 },
    amount2: { label: 'Radius', min: 0, max: 1, step: 0.01, default: 0.6 },
    centerX: { label: 'Center X', min: 0, max: 1, step: 0.01, default: 0.5 },
    centerY: { label: 'Center Y', min: 0, max: 1, step: 0.01, default: 0.5 },
  },
  pinchBulge: {
    amount: { label: 'Amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    centerX: { label: 'Center X', min: 0, max: 1, step: 0.01, default: 0.5 },
    centerY: { label: 'Center Y', min: 0, max: 1, step: 0.01, default: 0.5 },
  },
  polarTransform: {
    amount: { label: 'Amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    amount2: { label: 'Rotation', min: 0, max: 1, step: 0.01, default: 0 },
    centerX: { label: 'Center X', min: 0, max: 1, step: 0.01, default: 0.5 },
    centerY: { label: 'Center Y', min: 0, max: 1, step: 0.01, default: 0.5 },
  },
  // ── Keying ──
  chromaKey: {
    threshold: { label: 'Tolerance', min: 0, max: 1, step: 0.01, default: 0.25 },
    amount: { label: 'Spill Suppression', min: 0, max: 1, step: 0.01, default: 0.12 },
    red: { label: 'Key Red', min: 0, max: 1, step: 0.01, default: 0 },
    green: { label: 'Key Green', min: 0, max: 1, step: 0.01, default: 1 },
    blue: { label: 'Key Blue', min: 0, max: 1, step: 0.01, default: 0 },
  },
  lumaKey: {
    threshold: { label: 'Threshold', min: 0, max: 1, step: 0.01, default: 0.4 },
    amount: { label: 'Softness', min: 0, max: 1, step: 0.01, default: 0.15 },
  },
  differenceKey: {
    amount: { label: 'Clip Black', min: 0, max: 1, step: 0.01, default: 0.2 },
    amount2: { label: 'Clip White', min: 0, max: 1, step: 0.01, default: 0.2 },
    threshold: { label: 'Reference', min: 0, max: 1, step: 0.01, default: 0.5 },
  },
  erode: {
    amount: { label: 'Erode Amount', min: 0, max: 1, step: 0.01, default: 0.25 },
  },
  dilate: {
    amount: { label: 'Dilate Amount', min: 0, max: 1, step: 0.01, default: 0.25 },
  },
  // ── Premium Color ──
  falseColor: {
    amount: { label: 'Intensity', min: 0, max: 1, step: 0.01, default: 0.8 },
    amount2: { label: 'Bands', min: 0, max: 1, step: 0.01, default: 0.5 },
    threshold: { label: 'Overexposure', min: 0, max: 1, step: 0.01, default: 0.85 },
  },
  shadowRecovery: {
    amount: { label: 'Shadow Lift', min: 0, max: 1, step: 0.01, default: 0.5 },
    amount2: { label: 'Range', min: 0, max: 1, step: 0.01, default: 0.4 },
    threshold: { label: 'Protect Highlights', min: 0, max: 1, step: 0.01, default: 0.6 },
  },
  highlightRolloff: {
    amount: { label: 'Rolloff', min: 0, max: 1, step: 0.01, default: 0.5 },
    amount2: { label: 'Knee', min: 0, max: 1, step: 0.01, default: 0.5 },
    threshold: { label: 'Threshold', min: 0, max: 1, step: 0.01, default: 0.7 },
  },
  // ── Premium Stylize ──
  compressionArtifacts: {
    amount: { label: 'Block Size', min: 0, max: 1, step: 0.01, default: 0.55 },
    amount2: { label: 'Quality Loss', min: 0, max: 1, step: 0.01, default: 0.45 },
  },
  ascii: {
    amount: { label: 'Cell Size', min: 0, max: 1, step: 0.01, default: 0.35 },
    amount2: { label: 'Contrast', min: 0, max: 1, step: 0.01, default: 0.6 },
    amount3: { label: 'Color Mix', min: 0, max: 1, step: 0.01, default: 0.3 },
  },
  comicInk: {
    amount: { label: 'Ink Thickness', min: 0, max: 1, step: 0.01, default: 0.5 },
    amount2: { label: 'Halftone', min: 0, max: 1, step: 0.01, default: 0.5 },
    amount3: { label: 'Contrast', min: 0, max: 1, step: 0.01, default: 0.6 },
    threshold: { label: 'Edge Threshold', min: 0, max: 1, step: 0.01, default: 0.3 },
  },
  datamoshLite: {
    amount: { label: 'Sort Intensity', min: 0, max: 1, step: 0.01, default: 0.5 },
    amount2: { label: 'Band Width', min: 0, max: 1, step: 0.01, default: 0.3 },
    amount3: { label: 'Color Shift', min: 0, max: 1, step: 0.01, default: 0.4 },
  },
  scanlineDrift: {
    amount: { label: 'Drift Amount', min: 0, max: 1, step: 0.01, default: 0.4 },
    amount2: { label: 'Band Height', min: 0, max: 1, step: 0.01, default: 0.3 },
    amount3: { label: 'Speed', min: 0, max: 1, step: 0.01, default: 0.5 },
  },
  tapeDropout: {
    amount: { label: 'Dropout Rate', min: 0, max: 1, step: 0.01, default: 0.3 },
    amount2: { label: 'Band Height', min: 0, max: 1, step: 0.01, default: 0.3 },
    amount3: { label: 'Noise', min: 0, max: 1, step: 0.01, default: 0.5 },
  },
  // ── Premium Warp ──
  rippleCaustics: {
    amount: { label: 'Distortion', min: 0, max: 1, step: 0.01, default: 0.3 },
    amount2: { label: 'Scale', min: 0, max: 1, step: 0.01, default: 0.5 },
    amount3: { label: 'Speed', min: 0, max: 1, step: 0.01, default: 0.4 },
  },
  shockwave: {
    amount: { label: 'Ring Width', min: 0, max: 1, step: 0.01, default: 0.5 },
    amount2: { label: 'Distortion', min: 0, max: 1, step: 0.01, default: 0.5 },
    amount3: { label: 'Speed', min: 0, max: 1, step: 0.01, default: 0.3 },
    centerX: { label: 'Center X', min: 0, max: 1, step: 0.01, default: 0.5 },
    centerY: { label: 'Center Y', min: 0, max: 1, step: 0.01, default: 0.5 },
  },
  drosteRecursive: {
    amount: { label: 'Zoom', min: 0, max: 1, step: 0.01, default: 0.5 },
    amount2: { label: 'Spiral', min: 0, max: 1, step: 0.01, default: 0.3 },
    amount3: { label: 'Branches', min: 0, max: 1, step: 0.01, default: 0.5 },
    centerX: { label: 'Center X', min: 0, max: 1, step: 0.01, default: 0.5 },
    centerY: { label: 'Center Y', min: 0, max: 1, step: 0.01, default: 0.5 },
  },
  slitScan: {
    amount: { label: 'Slit Width', min: 0, max: 1, step: 0.01, default: 0.5 },
    amount2: { label: 'Scan Speed', min: 0, max: 1, step: 0.01, default: 0.4 },
    amount3: { label: 'Direction', min: 0, max: 1, step: 0.01, default: 0 },
  },
  // ── Premium Atmosphere ──
  volumetricFogOverlay: {
    amount: { label: 'Density', min: 0, max: 1, step: 0.01, default: 0.4 },
    amount2: { label: 'Scale', min: 0, max: 1, step: 0.01, default: 0.5 },
    amount3: { label: 'Speed', min: 0, max: 1, step: 0.01, default: 0.3 },
    red: { label: 'Fog R', min: 0, max: 1, step: 0.01, default: 0.7 },
    green: { label: 'Fog G', min: 0, max: 1, step: 0.01, default: 0.75 },
    blue: { label: 'Fog B', min: 0, max: 1, step: 0.01, default: 0.8 },
  },
  rainFogSnowOverlay: {
    amount: { label: 'Density', min: 0, max: 1, step: 0.01, default: 0.5 },
    amount2: { label: 'Speed', min: 0, max: 1, step: 0.01, default: 0.5 },
    amount3: { label: 'Size', min: 0, max: 1, step: 0.01, default: 0.3 },
    angle: { label: 'Wind Angle', min: 0, max: 6.28, step: 0.01, default: 0.3 },
  },
  particleOverlayFx: {
    amount: { label: 'Scatter', min: 0, max: 1, step: 0.01, default: 0.5 },
    amount2: { label: 'Particle Size', min: 0, max: 1, step: 0.01, default: 0.4 },
    amount3: { label: 'Rotation Speed', min: 0, max: 1, step: 0.01, default: 0.3 },
    threshold: { label: 'Light Intensity', min: 0, max: 1, step: 0.01, default: 0.7 },
    red: { label: 'Light R', min: 0, max: 1, step: 0.01, default: 1.0 },
    green: { label: 'Light G', min: 0, max: 1, step: 0.01, default: 0.9 },
    blue: { label: 'Light B', min: 0, max: 1, step: 0.01, default: 0.8 },
  },
  glintStarburst: {
    amount: { label: 'Intensity', min: 0, max: 1, step: 0.01, default: 0.5 },
    amount2: { label: 'Spike Length', min: 0, max: 1, step: 0.01, default: 0.5 },
    threshold: { label: 'Threshold', min: 0, max: 1, step: 0.01, default: 0.7 },
    angle: { label: 'Rotation', min: 0, max: 6.28, step: 0.01, default: 0 },
  },
  embossRelight: {
    amount: { label: 'Strength', min: 0, max: 1, step: 0.01, default: 0.5 },
    angle: { label: 'Light Angle', min: 0, max: 6.28, step: 0.01, default: 2.35 },
    red: { label: 'Light R', min: 0, max: 1, step: 0.01, default: 0.7 },
    green: { label: 'Light G', min: 0, max: 1, step: 0.01, default: 0.8 },
    blue: { label: 'Light B', min: 0, max: 1, step: 0.01, default: 1.0 },
  },
  // ── Premium Text & Pattern ──
  dotMatrix: {
    amount: { label: 'Dot Size', min: 0, max: 1, step: 0.01, default: 0.4 },
    amount2: { label: 'Spacing', min: 0, max: 1, step: 0.01, default: 0.5 },
    amount3: { label: 'Color Mix', min: 0, max: 1, step: 0.01, default: 0.5 },
  },
  matrixRain: {
    amount: { label: 'Density', min: 0, max: 1, step: 0.01, default: 0.5 },
    amount2: { label: 'Speed', min: 0, max: 1, step: 0.01, default: 0.5 },
    amount3: { label: 'Glow', min: 0, max: 1, step: 0.01, default: 0.4 },
    threshold: { label: 'Fade Depth', min: 0, max: 1, step: 0.01, default: 0.6 },
  },
  binaryCode: {
    amount: { label: 'Cell Size', min: 0, max: 1, step: 0.01, default: 0.35 },
    amount2: { label: 'Contrast', min: 0, max: 1, step: 0.01, default: 0.6 },
    amount3: { label: 'Color Mix', min: 0, max: 1, step: 0.01, default: 0.3 },
  },
  crosshatch: {
    amount: { label: 'Line Density', min: 0, max: 1, step: 0.01, default: 0.5 },
    amount2: { label: 'Line Thickness', min: 0, max: 1, step: 0.01, default: 0.4 },
    amount3: { label: 'Angle Spread', min: 0, max: 1, step: 0.01, default: 0.5 },
    threshold: { label: 'Dark Threshold', min: 0, max: 1, step: 0.01, default: 0.5 },
  },
  blockMosaic: {
    amount: { label: 'Block Size', min: 0, max: 1, step: 0.01, default: 0.4 },
    amount2: { label: 'Contrast', min: 0, max: 1, step: 0.01, default: 0.5 },
    amount3: { label: 'Color Mix', min: 0, max: 1, step: 0.01, default: 0.4 },
  },
  numberGrid: {
    amount: { label: 'Cell Size', min: 0, max: 1, step: 0.01, default: 0.35 },
    amount2: { label: 'Contrast', min: 0, max: 1, step: 0.01, default: 0.6 },
    amount3: { label: 'Color Mix', min: 0, max: 1, step: 0.01, default: 0.3 },
  },
  // ── Premium 3D ──
  explode3D: {
    amount: { label: 'Scatter', min: 0, max: 1, step: 0.01, default: 0.3 },
    amount2: { label: 'Shape', min: 0, max: 1, step: 0.01, default: 0 },
    amount3: { label: 'Spin Speed', min: 0, max: 1, step: 0.01, default: 0.3 },
    threshold: { label: 'Brightness', min: 0, max: 1, step: 0.01, default: 0.7 },
    angle: { label: 'Camera Angle', min: 0, max: 6.28, step: 0.01, default: 0 },
    red: { label: 'Light R', min: 0, max: 1, step: 0.01, default: 1.0 },
    green: { label: 'Light G', min: 0, max: 1, step: 0.01, default: 0.95 },
    blue: { label: 'Light B', min: 0, max: 1, step: 0.01, default: 0.9 },
  },
  terrain3D: {
    amount: { label: 'Height Scale', min: 0, max: 1, step: 0.01, default: 0.5 },
    amount2: { label: 'Camera Height', min: 0, max: 1, step: 0.01, default: 0.5 },
    amount3: { label: 'Flight Speed', min: 0, max: 1, step: 0.01, default: 0.3 },
    threshold: { label: 'Fog Density', min: 0, max: 1, step: 0.01, default: 0.5 },
    angle: { label: 'Yaw (Y Rot)', min: 0, max: 6.28, step: 0.01, default: 0 },
    centerX: { label: 'Pitch (X Rot)', min: 0, max: 1, step: 0.01, default: 0.15 },
    centerY: { label: 'Roll (Z Rot)', min: 0, max: 1, step: 0.01, default: 0.0 },
    red: { label: 'Fog R', min: 0, max: 1, step: 0.01, default: 0.5 },
    green: { label: 'Fog G', min: 0, max: 1, step: 0.01, default: 0.6 },
    blue: { label: 'Fog B', min: 0, max: 1, step: 0.01, default: 0.8 },
  },
  sphereProject: {
    amount: { label: 'Sphere Blend', min: 0, max: 1, step: 0.01, default: 0.8 },
    amount2: { label: 'Roughness', min: 0, max: 1, step: 0.01, default: 0.4 },
    amount3: { label: 'Spin Speed', min: 0, max: 1, step: 0.01, default: 0.2 },
    threshold: { label: 'Rim Glow', min: 0, max: 1, step: 0.01, default: 0.5 },
    red: { label: 'Light R', min: 0, max: 1, step: 0.01, default: 1.0 },
    green: { label: 'Light G', min: 0, max: 1, step: 0.01, default: 0.95 },
    blue: { label: 'Light B', min: 0, max: 1, step: 0.01, default: 0.9 },
  },
  cubeProject: {
    amount: { label: 'Cube Size', min: 0, max: 1, step: 0.01, default: 0.6 },
    amount2: { label: 'Edge Glow', min: 0, max: 1, step: 0.01, default: 0.3 },
    amount3: { label: 'Spin Speed', min: 0, max: 1, step: 0.01, default: 0.2 },
    angle: { label: 'Rotation', min: 0, max: 6.28, step: 0.01, default: 0.5 },
    red: { label: 'Light R', min: 0, max: 1, step: 0.01, default: 1.0 },
    green: { label: 'Light G', min: 0, max: 1, step: 0.01, default: 0.95 },
    blue: { label: 'Light B', min: 0, max: 1, step: 0.01, default: 0.9 },
  },
  cylinderWrap: {
    amount: { label: 'Blend', min: 0, max: 1, step: 0.01, default: 0.8 },
    amount2: { label: 'Radius', min: 0, max: 1, step: 0.01, default: 0.5 },
    amount3: { label: 'Spin Speed', min: 0, max: 1, step: 0.01, default: 0.2 },
    threshold: { label: 'Perspective', min: 0, max: 1, step: 0.01, default: 0.5 },
    red: { label: 'Light R', min: 0, max: 1, step: 0.01, default: 1.0 },
    green: { label: 'Light G', min: 0, max: 1, step: 0.01, default: 0.95 },
    blue: { label: 'Light B', min: 0, max: 1, step: 0.01, default: 0.9 },
  },
  torusTunnel: {
    amount: { label: 'Blend', min: 0, max: 1, step: 0.01, default: 0.8 },
    amount2: { label: 'Tube Radius', min: 0, max: 1, step: 0.01, default: 0.4 },
    amount3: { label: 'Fly Speed', min: 0, max: 1, step: 0.01, default: 0.3 },
    threshold: { label: 'Twist', min: 0, max: 1, step: 0.01, default: 0.3 },
    red: { label: 'Fog R', min: 0, max: 1, step: 0.01, default: 0.1 },
    green: { label: 'Fog G', min: 0, max: 1, step: 0.01, default: 0.1 },
    blue: { label: 'Fog B', min: 0, max: 1, step: 0.01, default: 0.15 },
  },
  diamondGem: {
    amount: { label: 'Blend', min: 0, max: 1, step: 0.01, default: 0.8 },
    amount2: { label: 'Facets', min: 0, max: 1, step: 0.01, default: 0.5 },
    amount3: { label: 'Rotation', min: 0, max: 1, step: 0.01, default: 0.15 },
    threshold: { label: 'Sparkle', min: 0, max: 1, step: 0.01, default: 0.6 },
    red: { label: 'Light R', min: 0, max: 1, step: 0.01, default: 1.0 },
    green: { label: 'Light G', min: 0, max: 1, step: 0.01, default: 0.95 },
    blue: { label: 'Light B', min: 0, max: 1, step: 0.01, default: 0.9 },
  },
  shatter3D: {
    amount: { label: 'Explosion', min: 0, max: 1, step: 0.01, default: 0.5 },
    amount2: { label: 'Shard Size', min: 0, max: 1, step: 0.01, default: 0.4 },
    amount3: { label: 'Speed', min: 0, max: 1, step: 0.01, default: 0.3 },
    threshold: { label: 'Gravity', min: 0, max: 1, step: 0.01, default: 0.3 },
  },
  mobiusStrip: {
    amount: { label: 'Blend', min: 0, max: 1, step: 0.01, default: 0.8 },
    amount2: { label: 'Strip Width', min: 0, max: 1, step: 0.01, default: 0.4 },
    amount3: { label: 'Rotation', min: 0, max: 1, step: 0.01, default: 0.2 },
    threshold: { label: 'Twist', min: 0, max: 1, step: 0.01, default: 0.5 },
    red: { label: 'Light R', min: 0, max: 1, step: 0.01, default: 0.8 },
    green: { label: 'Light G', min: 0, max: 1, step: 0.01, default: 0.8 },
    blue: { label: 'Light B', min: 0, max: 1, step: 0.01, default: 0.9 },
  },
  voxelDisplace: {
    amount: { label: 'Depth Scale', min: 0, max: 1, step: 0.01, default: 0.5 },
    amount2: { label: 'Resolution', min: 0, max: 1, step: 0.01, default: 0.4 },
    amount3: { label: 'Rotation', min: 0, max: 1, step: 0.01, default: 0.15 },
    threshold: { label: 'Gap Size', min: 0, max: 1, step: 0.01, default: 0.2 },
    red: { label: 'Light R', min: 0, max: 1, step: 0.01, default: 1.0 },
    green: { label: 'Light G', min: 0, max: 1, step: 0.01, default: 0.95 },
    blue: { label: 'Light B', min: 0, max: 1, step: 0.01, default: 0.9 },
  },
  waveSurface: {
    amount: { label: 'Amplitude', min: 0, max: 1, step: 0.01, default: 0.4 },
    amount2: { label: 'Frequency', min: 0, max: 1, step: 0.01, default: 0.5 },
    amount3: { label: 'Speed', min: 0, max: 1, step: 0.01, default: 0.3 },
    threshold: { label: 'Specular', min: 0, max: 1, step: 0.01, default: 0.5 },
    red: { label: 'Sky R', min: 0, max: 1, step: 0.01, default: 0.5 },
    green: { label: 'Sky G', min: 0, max: 1, step: 0.01, default: 0.7 },
    blue: { label: 'Sky B', min: 0, max: 1, step: 0.01, default: 0.9 },
  },
  prismSplit: {
    amount: { label: 'Separation', min: 0, max: 1, step: 0.01, default: 0.5 },
    amount2: { label: 'Prism Angle', min: 0, max: 1, step: 0.01, default: 0.5 },
    amount3: { label: 'Rotation', min: 0, max: 1, step: 0.01, default: 0.0 },
    threshold: { label: 'Glass Tint', min: 0, max: 1, step: 0.01, default: 0.3 },
    red: { label: 'Tint R', min: 0, max: 1, step: 0.01, default: 1.0 },
    green: { label: 'Tint G', min: 0, max: 1, step: 0.01, default: 1.0 },
    blue: { label: 'Tint B', min: 0, max: 1, step: 0.01, default: 1.0 },
  },
  origamiFold: {
    amount: { label: 'Fold Depth', min: 0, max: 1, step: 0.01, default: 0.5 },
    amount2: { label: 'Fold Count', min: 0, max: 1, step: 0.01, default: 0.4 },
    amount3: { label: 'Animation', min: 0, max: 1, step: 0.01, default: 0.2 },
    threshold: { label: 'Sharpness', min: 0, max: 1, step: 0.01, default: 0.6 },
  },
  mirrorRoom: {
    amount: { label: 'Blend', min: 0, max: 1, step: 0.01, default: 0.8 },
    amount2: { label: 'Room Size', min: 0, max: 1, step: 0.01, default: 0.5 },
    amount3: { label: 'Camera Move', min: 0, max: 1, step: 0.01, default: 0.15 },
    threshold: { label: 'Reflection Fade', min: 0, max: 1, step: 0.01, default: 0.5 },
    red: { label: 'Tint R', min: 0, max: 1, step: 0.01, default: 0.9 },
    green: { label: 'Tint G', min: 0, max: 1, step: 0.01, default: 0.9 },
    blue: { label: 'Tint B', min: 0, max: 1, step: 0.01, default: 1.0 },
  },
  geometricTile: {
    amount: { label: 'Tile Count', min: 0, max: 1, step: 0.01, default: 0.4 },
    amount2: { label: 'Flip Range', min: 0, max: 1, step: 0.01, default: 0.5 },
    amount3: { label: 'Speed', min: 0, max: 1, step: 0.01, default: 0.3 },
    threshold: { label: 'Gap Size', min: 0, max: 1, step: 0.01, default: 0.1 },
  },
  hexGrid: {
    amount: { label: 'Blend', min: 0, max: 1, step: 0.01, default: 0.8 },
    amount2: { label: 'Hex Size', min: 0, max: 1, step: 0.01, default: 0.4 },
    amount3: { label: 'Pop Speed', min: 0, max: 1, step: 0.01, default: 0.3 },
    threshold: { label: 'Gap', min: 0, max: 1, step: 0.01, default: 0.2 },
  },
  spiralTile: {
    amount: { label: 'Blend', min: 0, max: 1, step: 0.01, default: 0.8 },
    amount2: { label: 'Arms / Rings', min: 0, max: 1, step: 0.01, default: 0.4 },
    amount3: { label: 'Spin Speed', min: 0, max: 1, step: 0.01, default: 0.2 },
    threshold: { label: 'Gap', min: 0, max: 1, step: 0.01, default: 0.3 },
  },
  shingleStack: {
    amount: { label: 'Blend', min: 0, max: 1, step: 0.01, default: 0.8 },
    amount2: { label: 'Tile Count', min: 0, max: 1, step: 0.01, default: 0.4 },
    amount3: { label: 'Slide Speed', min: 0, max: 1, step: 0.01, default: 0.25 },
    threshold: { label: 'Overlap', min: 0, max: 1, step: 0.01, default: 0.3 },
  },
  voronoiShatter: {
    amount: { label: 'Blend', min: 0, max: 1, step: 0.01, default: 0.8 },
    amount2: { label: 'Cell Count', min: 0, max: 1, step: 0.01, default: 0.4 },
    amount3: { label: 'Drift Speed', min: 0, max: 1, step: 0.01, default: 0.2 },
    threshold: { label: 'Gap', min: 0, max: 1, step: 0.01, default: 0.3 },
  },
  // ── Premium Depth ──
  tunnelFlight: {
    amount: { label: 'Tunnel Width', min: 0, max: 1, step: 0.01, default: 0.5 },
    amount2: { label: 'Shape', min: 0, max: 1, step: 0.01, default: 0 },
    amount3: { label: 'Flight Speed', min: 0, max: 1, step: 0.01, default: 0.3 },
    threshold: { label: 'Fog Depth', min: 0, max: 1, step: 0.01, default: 0.4 },
    angle: { label: 'Twist', min: 0, max: 6.28, step: 0.01, default: 0 },
    red: { label: 'Fog R', min: 0, max: 1, step: 0.01, default: 0.3 },
    green: { label: 'Fog G', min: 0, max: 1, step: 0.01, default: 0.2 },
    blue: { label: 'Fog B', min: 0, max: 1, step: 0.01, default: 0.4 },
  },
  infiniteMirror: {
    amount: { label: 'Depth', min: 0, max: 1, step: 0.01, default: 0.6 },
    amount2: { label: 'Zoom', min: 0, max: 1, step: 0.01, default: 0.4 },
    amount3: { label: 'Twist', min: 0, max: 1, step: 0.01, default: 0.1 },
    threshold: { label: 'Fade', min: 0, max: 1, step: 0.01, default: 0.5 },
    red: { label: 'Tint R', min: 0, max: 1, step: 0.01, default: 0.5 },
    green: { label: 'Tint G', min: 0, max: 1, step: 0.01, default: 0.5 },
    blue: { label: 'Tint B', min: 0, max: 1, step: 0.01, default: 0.6 },
  },
  crystalRefract: {
    amount: { label: 'Crystal Size', min: 0, max: 1, step: 0.01, default: 0.5 },
    amount2: { label: 'Refraction', min: 0, max: 1, step: 0.01, default: 0.5 },
    amount3: { label: 'Dispersion', min: 0, max: 1, step: 0.01, default: 0.3 },
    threshold: { label: 'Fresnel', min: 0, max: 1, step: 0.01, default: 0.5 },
    angle: { label: 'Rotation', min: 0, max: 6.28, step: 0.01, default: 0 },
    red: { label: 'Facet R', min: 0, max: 1, step: 0.01, default: 0.9 },
    green: { label: 'Facet G', min: 0, max: 1, step: 0.01, default: 0.95 },
    blue: { label: 'Facet B', min: 0, max: 1, step: 0.01, default: 1.0 },
  },
  // ── Premium Feedback ──
  feedbackZoom: {
    amount: { label: 'Zoom Rate', min: 0, max: 1, step: 0.01, default: 0.4 },
    amount2: { label: 'Feedback Mix', min: 0, max: 1, step: 0.01, default: 0.5 },
    amount3: { label: 'Rotation', min: 0, max: 1, step: 0.01, default: 0.2 },
    threshold: { label: 'Hue Cycle', min: 0, max: 1, step: 0.01, default: 0.3 },
    centerX: { label: 'Focus X', min: 0, max: 1, step: 0.01, default: 0.5 },
    centerY: { label: 'Focus Y', min: 0, max: 1, step: 0.01, default: 0.5 },
  },
  // ── Premium Warp (extension) ──
  fractalWarp: {
    amount: { label: 'Blend', min: 0, max: 1, step: 0.01, default: 0.7 },
    amount2: { label: 'Fractal Type', min: 0, max: 1, step: 0.01, default: 0 },
    amount3: { label: 'Zoom Speed', min: 0, max: 1, step: 0.01, default: 0.2 },
    threshold: { label: 'Iterations', min: 0, max: 1, step: 0.01, default: 0.5 },
    centerX: { label: 'Seed X', min: 0, max: 1, step: 0.01, default: 0.5 },
    centerY: { label: 'Seed Y', min: 0, max: 1, step: 0.01, default: 0.5 },
    red: { label: 'Border R', min: 0, max: 1, step: 0.01, default: 0.2 },
    green: { label: 'Border G', min: 0, max: 1, step: 0.01, default: 0.1 },
    blue: { label: 'Border B', min: 0, max: 1, step: 0.01, default: 0.5 },
  },
  fluidDistort: {
    amount: { label: 'Distortion', min: 0, max: 1, step: 0.01, default: 0.4 },
    amount2: { label: 'Scale', min: 0, max: 1, step: 0.01, default: 0.5 },
    amount3: { label: 'Speed', min: 0, max: 1, step: 0.01, default: 0.3 },
    threshold: { label: 'Vorticity', min: 0, max: 1, step: 0.01, default: 0.5 },
    angle: { label: 'Flow Bias', min: 0, max: 6.28, step: 0.01, default: 0 },
  },
  wormhole: {
    amount: { label: 'Mass', min: 0, max: 1, step: 0.01, default: 0.5 },
    amount2: { label: 'Ring Size', min: 0, max: 1, step: 0.01, default: 0.3 },
    amount3: { label: 'Disk Spin', min: 0, max: 1, step: 0.01, default: 0.3 },
    threshold: { label: 'Glow', min: 0, max: 1, step: 0.01, default: 0.6 },
    centerX: { label: 'Center X', min: 0, max: 1, step: 0.01, default: 0.5 },
    centerY: { label: 'Center Y', min: 0, max: 1, step: 0.01, default: 0.5 },
    red: { label: 'Disk R', min: 0, max: 1, step: 0.01, default: 1.0 },
    green: { label: 'Disk G', min: 0, max: 1, step: 0.01, default: 0.6 },
    blue: { label: 'Disk B', min: 0, max: 1, step: 0.01, default: 0.2 },
  },
  // ── Premium Trails ──
  motionTrails: {
    amount: { label: 'Trail Length', min: 0, max: 1, step: 0.01, default: 0.5 },
    amount2: { label: 'Brightness Gate', min: 0, max: 1, step: 0.01, default: 0.2 },
    amount3: { label: 'Fade Curve', min: 0, max: 1, step: 0.01, default: 0.5 },
    threshold: { label: 'Intensity', min: 0, max: 1, step: 0.01, default: 0.6 },
    angle: { label: 'Direction', min: 0, max: 6.28, step: 0.01, default: 0 },
    red: { label: 'Trail R', min: 0, max: 1, step: 0.01, default: 1.0 },
    green: { label: 'Trail G', min: 0, max: 1, step: 0.01, default: 0.8 },
    blue: { label: 'Trail B', min: 0, max: 1, step: 0.01, default: 0.5 },
  },
  echoRepeat: {
    amount: { label: 'Echo Count', min: 0, max: 1, step: 0.01, default: 0.4 },
    amount2: { label: 'Spacing', min: 0, max: 1, step: 0.01, default: 0.3 },
    amount3: { label: 'Scale', min: 0, max: 1, step: 0.01, default: 0.5 },
    threshold: { label: 'Fade Rate', min: 0, max: 1, step: 0.01, default: 0.5 },
    angle: { label: 'Direction', min: 0, max: 6.28, step: 0.01, default: 2.35 },
    red: { label: 'Echo R', min: 0, max: 1, step: 0.01, default: 0.5 },
    green: { label: 'Echo G', min: 0, max: 1, step: 0.01, default: 0.5 },
    blue: { label: 'Echo B', min: 0, max: 1, step: 0.01, default: 0.5 },
  },
  ghostDouble: {
    amount: { label: 'Separation', min: 0, max: 1, step: 0.01, default: 0.3 },
    amount2: { label: 'Ghost Count', min: 0, max: 1, step: 0.01, default: 0.3 },
    amount3: { label: 'Chroma Shift', min: 0, max: 1, step: 0.01, default: 0.4 },
    threshold: { label: 'Opacity', min: 0, max: 1, step: 0.01, default: 0.5 },
    angle: { label: 'Spread Angle', min: 0, max: 6.28, step: 0.01, default: 0 },
  },
  strobeFlash: {
    amount: { label: 'Rate', min: 0, max: 1, step: 0.01, default: 0.3 },
    amount2: { label: 'Duty Cycle', min: 0, max: 1, step: 0.01, default: 0.5 },
    amount3: { label: 'Mode', min: 0, max: 1, step: 0.01, default: 0 },
    threshold: { label: 'Intensity', min: 0, max: 1, step: 0.01, default: 0.8 },
    red: { label: 'Flash R', min: 0, max: 1, step: 0.01, default: 1.0 },
    green: { label: 'Flash G', min: 0, max: 1, step: 0.01, default: 1.0 },
    blue: { label: 'Flash B', min: 0, max: 1, step: 0.01, default: 1.0 },
  },
  lightPaint: {
    amount: { label: 'Trail Length', min: 0, max: 1, step: 0.01, default: 0.5 },
    amount2: { label: 'Flow Scale', min: 0, max: 1, step: 0.01, default: 0.5 },
    amount3: { label: 'Speed', min: 0, max: 1, step: 0.01, default: 0.3 },
    threshold: { label: 'Luma Gate', min: 0, max: 1, step: 0.01, default: 0.4 },
    red: { label: 'Paint R', min: 0, max: 1, step: 0.01, default: 1.0 },
    green: { label: 'Paint G', min: 0, max: 1, step: 0.01, default: 0.8 },
    blue: { label: 'Paint B', min: 0, max: 1, step: 0.01, default: 0.3 },
  },
  recursiveEcho: {
    amount: { label: 'Echo Depth', min: 0, max: 1, step: 0.01, default: 0.5 },
    amount2: { label: 'Offset Amount', min: 0, max: 1, step: 0.01, default: 0.3 },
    amount3: { label: 'Scale', min: 0, max: 1, step: 0.01, default: 0.5 },
    threshold: { label: 'Fade', min: 0, max: 1, step: 0.01, default: 0.5 },
    angle: { label: 'Direction', min: 0, max: 6.28, step: 0.01, default: 2.35 },
    red: { label: 'Color Shift R', min: 0, max: 1, step: 0.01, default: 0.5 },
    green: { label: 'Color Shift G', min: 0, max: 1, step: 0.01, default: 0.3 },
    blue: { label: 'Color Shift B', min: 0, max: 1, step: 0.01, default: 0.7 },
  },
  // ── Blob Tracking ──
  blobTrack: {
    blobThreshold: { label: 'Threshold', min: 0, max: 1, step: 0.01, default: 0.3 },
    blobShape: { label: 'Shape', min: 0, max: 3, step: 1, default: 0, type: 'select', options: [
      { value: 0, label: 'Circle' }, { value: 1, label: 'Square' }, { value: 2, label: 'Triangle' }, { value: 3, label: 'Diamond' },
    ] },
    blobColorMode: { label: 'Color Mode', min: 0, max: 2, step: 1, default: 0, type: 'select', options: [
      { value: 0, label: 'Auto' }, { value: 1, label: 'Fixed Color' }, { value: 2, label: 'Spectrum' },
    ] },
    blobFixedColorR: { label: 'Blob Color', min: 0, max: 1, step: 0.01, default: 0, type: 'color', colorParams: { r: 'blobFixedColorR', g: 'blobFixedColorG', b: 'blobFixedColorB' } },
    blobMarkerSize: { label: 'Size', min: 0.2, max: 3, step: 0.05, default: 1.0 },
    blobBlendMode: { label: 'Blend', min: 0, max: 4, step: 1, default: 0, type: 'select', options: [
      { value: 0, label: 'Add' }, { value: 1, label: 'Screen' }, { value: 2, label: 'Multiply' }, { value: 3, label: 'Overlay' }, { value: 4, label: 'Replace' },
    ] },
    blobThickness: { label: 'Thickness', min: 0.5, max: 5, step: 0.1, default: 1.5 },
    blobMinSize: { label: 'Min Size', min: 0, max: 1, step: 0.01, default: 0.02 },
    blobTrailLength: { label: 'Connectors', min: 0, max: 1, step: 0.01, default: 0.3 },
    blobShowCoords: { label: 'Coords', min: 0, max: 1, step: 1, default: 1 },
    blobShowBBox: { label: 'Brackets', min: 0, max: 1, step: 1, default: 1 },
    blobShowCenter: { label: 'Centers', min: 0, max: 1, step: 1, default: 1 },
    blobGridSize: { label: 'Grid', min: 4, max: 48, step: 1, default: 16 },
    blobMix: { label: 'Mix', min: 0, max: 1, step: 0.01, default: 0.8 },
  },
  blobContour: {
    blobThreshold: { label: 'Threshold', min: 0, max: 1, step: 0.01, default: 0.4 },
    blobShape: { label: 'Style', min: 0, max: 2, step: 1, default: 0 },
    blobColor: { label: 'Color', min: 0, max: 7, step: 1, default: 1 },
    blobThickness: { label: 'Thickness', min: 0.5, max: 5, step: 0.1, default: 1.5 },
    blobMinSize: { label: 'Levels', min: 0.05, max: 1, step: 0.05, default: 0.5 },
    blobShowCoords: { label: 'Values', min: 0, max: 1, step: 1, default: 0 },
    blobTrailLength: { label: 'Glow', min: 0, max: 1, step: 0.01, default: 0.4 },
    blobMix: { label: 'Mix', min: 0, max: 1, step: 0.01, default: 0.7 },
  },
  blobHeatmap: {
    blobThreshold: { label: 'Threshold', min: 0, max: 1, step: 0.01, default: 0.2 },
    blobColor: { label: 'Palette', min: 0, max: 3, step: 1, default: 0 },
    blobShape: { label: 'Style', min: 0, max: 2, step: 1, default: 0 },
    blobGridSize: { label: 'Grid', min: 4, max: 48, step: 1, default: 16 },
    blobShowBBox: { label: 'Grid Lines', min: 0, max: 1, step: 1, default: 1 },
    blobThickness: { label: 'Line Width', min: 0.5, max: 5, step: 0.1, default: 1 },
    blobShowCoords: { label: 'Values', min: 0, max: 1, step: 1, default: 1 },
    blobMix: { label: 'Mix', min: 0, max: 1, step: 0.01, default: 0.7 },
  },
};

// ── Presets ──
export const effectPresets: Partial<Record<EffectType, EffectPreset[]>> = {
  bloom: [
    { name: 'Subtle Glow', params: { amount: 0.2, amount2: 0.35, threshold: 0.75 } },
    { name: 'Club Wash', params: { amount: 0.55, amount2: 0.6, threshold: 0.55 } },
    { name: 'Dreamy', params: { amount: 0.8, amount2: 0.85, threshold: 0.4 } },
  ],
  chromaKey: [
    { name: 'Green Screen', params: { red: 0, green: 1, blue: 0, threshold: 0.25, amount: 0.15 } },
    { name: 'Blue Screen', params: { red: 0, green: 0, blue: 1, threshold: 0.25, amount: 0.15 } },
    { name: 'Soft Matte', params: { threshold: 0.35, amount: 0.3 } },
  ],
  colorBalance: [
    { name: 'Warm Stage', params: { amount: 0.6, red: 0.65, green: 0.5, blue: 0.4 } },
    { name: 'Cool Steel', params: { amount: 0.6, red: 0.4, green: 0.5, blue: 0.65 } },
    { name: 'Neon Pop', params: { amount: 0.8, red: 0.75, green: 0.55, blue: 0.75 } },
  ],
  directionalBlur: [
    { name: 'Soft Smear', params: { amount: 0.2, angle: 0.2 } },
    { name: 'Speed Lines', params: { amount: 0.55, angle: 1.2 } },
    { name: 'Diagonal Rush', params: { amount: 0.45, angle: 4.1 } },
  ],
  crt: [
    { name: 'Broadcast', params: { amount: 0.25, amount2: 0.45, amount3: 0.4 } },
    { name: 'Arcade', params: { amount: 0.45, amount2: 0.65, amount3: 0.55 } },
    { name: 'Broken Tube', params: { amount: 0.75, amount2: 0.85, amount3: 0.85 } },
  ],
  filmGrain: [
    { name: 'Clean 35mm', params: { amount: 0.12 } },
    { name: 'Dirty 16mm', params: { amount: 0.28 } },
    { name: 'Heavy Texture', params: { amount: 0.45 } },
  ],
  lensDistortion: [
    { name: 'Subtle Barrel', params: { amount: 0.6, centerX: 0.5, centerY: 0.5 } },
    { name: 'Pincushion', params: { amount: 0.35, centerX: 0.5, centerY: 0.5 } },
    { name: 'Off-center Warp', params: { amount: 0.65, centerX: 0.6, centerY: 0.4 } },
  ],
  twirl: [
    { name: 'Mild Twist', params: { amount: 0.25, amount2: 0.75, centerX: 0.5, centerY: 0.5 } },
    { name: 'Tunnel Spin', params: { amount: 0.65, amount2: 0.55, centerX: 0.5, centerY: 0.5 } },
    { name: 'Corner Twirl', params: { amount: 0.55, amount2: 0.7, centerX: 0.2, centerY: 0.2 } },
  ],
  pinchBulge: [
    { name: 'Pinch', params: { amount: 0.35, centerX: 0.5, centerY: 0.5 } },
    { name: 'Bulge', params: { amount: 0.8, centerX: 0.5, centerY: 0.5 } },
    { name: 'Offset Bubble', params: { amount: 0.75, centerX: 0.62, centerY: 0.38 } },
  ],
  godRays: [
    { name: 'Subtle Rays', params: { amount: 0.35, amount2: 0.25, threshold: 0.75, centerX: 0.5, centerY: 0.2 } },
    { name: 'Sun Burst', params: { amount: 0.6, amount2: 0.5, threshold: 0.6, centerX: 0.5, centerY: 0.15 } },
    { name: 'Hard Beam', params: { amount: 0.85, amount2: 0.7, threshold: 0.5, centerX: 0.5, centerY: 0.1 } },
  ],
  // New premium presets
  filmicTonemap: [
    { name: 'Subtle Film', params: { amount: 0.3, amount2: 0.4, amount3: 0.2, threshold: 0.95 } },
    { name: 'Cinematic', params: { amount: 0.6, amount2: 0.5, amount3: 0.3, threshold: 0.85 } },
    { name: 'Heavy Grade', params: { amount: 0.9, amount2: 0.7, amount3: 0.5, threshold: 0.7 } },
  ],
  halation: [
    { name: 'Gentle Warmth', params: { amount: 0.3, amount2: 0.4, threshold: 0.7, red: 0.8, green: 0.5, blue: 0.3 } },
    { name: 'Film Print', params: { amount: 0.5, amount2: 0.6, threshold: 0.55, red: 0.9, green: 0.4, blue: 0.2 } },
    { name: 'Heavy Bleed', params: { amount: 0.8, amount2: 0.8, threshold: 0.4, red: 1.0, green: 0.3, blue: 0.1 } },
  ],
  ascii: [
    { name: 'Terminal', params: { amount: 0.3, amount2: 0.7, amount3: 0 } },
    { name: 'Fine Print', params: { amount: 0.15, amount2: 0.5, amount3: 0.3 } },
    { name: 'Bold Blocks', params: { amount: 0.6, amount2: 0.8, amount3: 0.1 } },
  ],
  shockwave: [
    { name: 'Gentle Ripple', params: { amount: 0.3, amount2: 0.3, amount3: 0.2 } },
    { name: 'Impact Wave', params: { amount: 0.5, amount2: 0.6, amount3: 0.3 } },
    { name: 'Heavy Blast', params: { amount: 0.7, amount2: 0.8, amount3: 0.5 } },
  ],
  vhs: [
    { name: 'Clean Tape', params: { vhsTracking: 0.2, vhsNoise: 0.1, vhsDistortion: 0.1, vhsColorBleed: 0.3, vhsScanlines: 0.2 } },
    { name: 'Worn Out', params: { vhsTracking: 0.6, vhsNoise: 0.4, vhsDistortion: 0.4, vhsColorBleed: 0.6, vhsScanlines: 0.4 } },
    { name: 'Destroyed', params: { vhsTracking: 0.9, vhsNoise: 0.7, vhsDistortion: 0.7, vhsColorBleed: 0.8, vhsScanlines: 0.6 } },
  ],
  glitch: [
    { name: 'Subtle Glitch', params: { glitchIntensity: 0.2, glitchSpeed: 0.5, glitchBlockSize: 0.1, glitchRGBSplit: 0.2, glitchJitter: 0.1 } },
    { name: 'Digital Chaos', params: { glitchIntensity: 0.6, glitchSpeed: 1.5, glitchBlockSize: 0.4, glitchRGBSplit: 0.6, glitchJitter: 0.5 } },
    { name: 'Corrupted', params: { glitchIntensity: 0.9, glitchSpeed: 2.0, glitchBlockSize: 0.7, glitchRGBSplit: 0.8, glitchJitter: 0.8 } },
  ],
  // New 3D & Trails presets
  explode3D: [
    { name: 'Sphere', params: { amount: 0.3, amount2: 0, amount3: 0.3, threshold: 0.7 } },
    { name: 'Cube', params: { amount: 0.3, amount2: 0.2, amount3: 0.3, threshold: 0.7 } },
    { name: 'Pyramid', params: { amount: 0.3, amount2: 0.4, amount3: 0.3, threshold: 0.7 } },
    { name: 'Torus', params: { amount: 0.3, amount2: 0.6, amount3: 0.3, threshold: 0.7 } },
  ],
  terrain3D: [
    { name: 'Front Facing', params: { amount: 0.3, amount2: 0.8, amount3: 0.0, threshold: 0.1, centerX: 1.0, centerY: 0.0, angle: 0 } },
    { name: 'Rolling Hills', params: { amount: 0.3, amount2: 0.6, amount3: 0.2, threshold: 0.5, centerX: 0.15 } },
    { name: 'Mountains', params: { amount: 0.7, amount2: 0.4, amount3: 0.2, threshold: 0.3, centerX: 0.15 } },
    { name: 'Flyover', params: { amount: 0.5, amount2: 0.5, amount3: 0.5, threshold: 0.4, centerX: 0.15 } },
  ],
  tunnelFlight: [
    { name: 'Round Tunnel', params: { amount: 0.5, amount2: 0, amount3: 0.3, threshold: 0.4 } },
    { name: 'Hex Corridor', params: { amount: 0.5, amount2: 0.5, amount3: 0.3, threshold: 0.4 } },
    { name: 'Twisted Square', params: { amount: 0.5, amount2: 1.0, amount3: 0.3, threshold: 0.4, angle: 1.0 } },
  ],
  feedbackZoom: [
    { name: 'Gentle Spiral', params: { amount: 0.3, amount2: 0.4, amount3: 0.15, threshold: 0.2 } },
    { name: 'Vortex', params: { amount: 0.5, amount2: 0.6, amount3: 0.4, threshold: 0.5 } },
    { name: 'Infinite Zoom', params: { amount: 0.6, amount2: 0.5, amount3: 0, threshold: 0 } },
  ],
  echoRepeat: [
    { name: 'Subtle Echo', params: { amount: 0.2, amount2: 0.2, amount3: 0.5, threshold: 0.6 } },
    { name: 'Cascade', params: { amount: 0.5, amount2: 0.3, amount3: 0.4, threshold: 0.4 } },
    { name: 'Heavy Delay', params: { amount: 0.8, amount2: 0.4, amount3: 0.3, threshold: 0.3 } },
  ],
};

export function getNumericEffectParams(type: EffectType): string[] {
  const defaults = getDefaultEffectParams(type) as Record<string, unknown>;
  return Object.entries(defaults)
    .filter(([, value]) => typeof value === 'number')
    .map(([key]) => key);
}

export function getEffectPresets(type: EffectType): EffectPreset[] {
  return effectPresets[type] || [];
}

export function getEffectPresetLabel(type: EffectType, index: number): string {
  const presets = getEffectPresets(type);
  if (index < 0 || index >= presets.length) return '';
  return presets[index].name;
}

export function applyPresetToEffect(effect: Effect, presetIndex: number): Partial<EffectParams> | null {
  const presets = getEffectPresets(effect.type);
  if (presetIndex < 0 || presetIndex >= presets.length) return null;
  return presets[presetIndex].params;
}

// Get the label for a param key, falling back to the key itself
export function getParamLabel(effectType: EffectType, paramKey: string): string {
  const meta = effectParamLabels[effectType]?.[paramKey];
  return meta?.label ?? paramKey;
}

// Get full param metadata
export function getParamMeta(effectType: EffectType, paramKey: string): ParamMeta | null {
  return effectParamLabels[effectType]?.[paramKey] ?? null;
}
