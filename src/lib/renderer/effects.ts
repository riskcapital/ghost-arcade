// GLSL Effect Shaders for layer post-processing
// Shader GLSL strings live in ./shaders/; this file handles lookup, material creation, and uniform wiring.

import * as THREE from 'three';
import type { Effect, EffectParams, EffectType } from '../types';
import {
  getCustomEffect,
  registerBuiltinTypes,
  type CustomEffect,
} from '../effects/customEffects';

// ── Import all shader strings and mode mappings ──
import {
  effectVertexShader,
  vignetteShader,
  edgeFeatherShader,
  coloramaShader,
  invertShader,
  ditherShader,
  vhsShader,
  glitchShader,
  rgbShiftShader,
  scanlinesShader,
  pixelateShader,
  blurShader,
  sharpenShader,
  noiseShader,
  kaleidoscopeShader,
  mirrorShader,
  plasmaShader,
  posterizeShader,
  edgeDetectShader,
  outlineShader,
  embossShader,
  waveShader,
  fisheyeShader,
  thermalShader,
  nightVisionShader,
  polygonMaskShader,
  polygonMaskAlphaShader,
  applyExternalMaskShader,
  layerShapeMaskShader,
  brightnessShader,
  contrastShader,
  saturationShader,
  hueShader,
} from './shaders/basic';

import { proPackShader, proEffectModes } from './shaders/pro-pack';
import { premiumPackShader, premiumEffectModes } from './shaders/premium-pack';
import { premiumPack2Shader, premiumPack2Modes } from './shaders/premium-pack2';
import {
  numberGridShader,
  explode3DShader,
  terrain3DShader,
  sphereProjectShader,
  cubeProjectShader,
  cylinderWrapShader,
  torusTunnelShader,
  diamondGemShader,
  shatter3DShader,
  mobiusStripShader,
  voxelDisplaceShader,
  waveSurfaceShader,
  prismSplitShader,
  origamiFoldShader,
  mirrorRoomShader,
  hexGridShader,
  spiralTileShader,
  shingleStackShader,
  voronoiShatterShader,
} from './shaders/premium-standalone';
import {
  braillePatternShader,
  circuitBoardShader,
  stainedGlassShader,
  wovenFabricShader,
  mosaicTileShader,
  neonOutlineShader,
  pixelSortShader,
  linocutShader,
  topoMapShader,
  ledWallShader,
} from './shaders/new-text-patterns';
import {
  blobTrackShader,
  blobContourShader,
  blobHeatmapShader,
} from './shaders/blob-tracking';
import {
  timeSmearShader,
  chronoShader,
} from './shaders/time-effects';

// Re-export shader strings consumed by engine.ts and other modules
export { effectVertexShader, polygonMaskShader, polygonMaskAlphaShader, applyExternalMaskShader, layerShapeMaskShader };

// ============================================================================
// Effect shader lookup and material creation
// ============================================================================

export const effectShaders: Record<EffectType, string> = {
  // ── WebGPU effects (no GLSL shader; dispatched via gpuEffectRunner) ──
  // The engine's applyEffects() short-circuits before reaching the
  // GLSL material path for these. The empty string here is just to
  // satisfy the Record<EffectType, string> requirement.
  gpuFluidSim: '',
  // Dedicated shaders (24)
  vignette: vignetteShader,
  edgeFeather: edgeFeatherShader,
  colorama: coloramaShader,
  plasma: plasmaShader,
  invert: invertShader,
  dither: ditherShader,
  posterize: posterizeShader,
  edgeDetect: edgeDetectShader,
  outline: outlineShader,
  emboss: embossShader,
  vhs: vhsShader,
  glitch: glitchShader,
  rgbShift: rgbShiftShader,
  scanlines: scanlinesShader,
  pixelate: pixelateShader,
  blur: blurShader,
  sharpen: sharpenShader,
  noise: noiseShader,
  kaleidoscope: kaleidoscopeShader,
  mirror: mirrorShader,
  wave: waveShader,
  fisheye: fisheyeShader,
  thermal: thermalShader,
  nightVision: nightVisionShader,
  // VJ-only simple shaders (4)
  brightness: brightnessShader,
  contrast: contrastShader,
  saturation: saturationShader,
  hue: hueShader,
  // ProPack shader effects (32 modes)
  curves: proPackShader,
  liftGammaGain: proPackShader,
  exposure: proPackShader,
  gamma: proPackShader,
  temperatureTint: proPackShader,
  vibrance: proPackShader,
  colorBalance: proPackShader,
  filmGrain: proPackShader,
  bloom: proPackShader,
  chromaticAberration: proPackShader,
  lensDistortion: proPackShader,
  tiltShift: proPackShader,
  godRays: proPackShader,
  heatHaze: proPackShader,
  directionalBlur: proPackShader,
  zoomBlur: proPackShader,
  radialBlur: proPackShader,
  halftone: proPackShader,
  toon: proPackShader,
  kuwahara: proPackShader,
  oilPaint: proPackShader,
  watercolor: proPackShader,
  crt: proPackShader,
  compressionArtifacts: proPackShader,
  chromaKey: proPackShader,
  lumaKey: proPackShader,
  differenceKey: proPackShader,
  erode: proPackShader,
  dilate: proPackShader,
  displacement: proPackShader,
  twirl: proPackShader,
  pinchBulge: proPackShader,
  // Premium Pack shader effects (25 unique modes)
  filmicTonemap: premiumPackShader,
  selectiveColor: premiumPackShader,
  falseColor: premiumPackShader,
  shadowRecovery: premiumPackShader,
  highlightRolloff: premiumPackShader,
  halation: premiumPackShader,
  anamorphicStreak: premiumPackShader,
  lensDirt: premiumPackShader,
  defocusBokeh: premiumPackShader,
  diffusionPromist: premiumPackShader,
  ascii: premiumPackShader,
  comicInk: premiumPackShader,
  datamoshLite: premiumPackShader,
  scanlineDrift: premiumPackShader,
  tapeDropout: premiumPackShader,
  polarTransform: premiumPackShader,
  rippleCaustics: premiumPackShader,
  shockwave: premiumPackShader,
  drosteRecursive: premiumPackShader,
  slitScan: premiumPackShader,
  volumetricFogOverlay: premiumPackShader,
  rainFogSnowOverlay: premiumPackShader,
  particleOverlayFx: premiumPackShader,
  glintStarburst: premiumPackShader,
  embossRelight: premiumPackShader,
  dotMatrix: premiumPackShader,
  matrixRain: premiumPackShader,
  binaryCode: premiumPackShader,
  crosshatch: premiumPackShader,
  blockMosaic: premiumPackShader,
  numberGrid: numberGridShader,
  // New standalone text & pattern shaders (10)
  braillePattern: braillePatternShader,
  circuitBoard: circuitBoardShader,
  stainedGlass: stainedGlassShader,
  wovenFabric: wovenFabricShader,
  mosaicTile: mosaicTileShader,
  neonOutline: neonOutlineShader,
  pixelSort: pixelSortShader,
  linocut: linocutShader,
  topoMap: topoMapShader,
  ledWall: ledWallShader,
  // Premium Pack 2 shader effects (18 modes — 3D, Depth, Feedback, Warp, Trails)
  explode3D: explode3DShader,
  terrain3D: terrain3DShader,
  sphereProject: sphereProjectShader,
  cubeProject: cubeProjectShader,
  cylinderWrap: cylinderWrapShader,
  torusTunnel: torusTunnelShader,
  diamondGem: diamondGemShader,
  shatter3D: shatter3DShader,
  mobiusStrip: mobiusStripShader,
  voxelDisplace: voxelDisplaceShader,
  waveSurface: waveSurfaceShader,
  prismSplit: prismSplitShader,
  origamiFold: origamiFoldShader,
  mirrorRoom: mirrorRoomShader,
  hexGrid: hexGridShader,
  spiralTile: spiralTileShader,
  shingleStack: shingleStackShader,
  voronoiShatter: voronoiShatterShader,
  tunnelFlight: premiumPack2Shader,
  infiniteMirror: premiumPack2Shader,
  fractalWarp: premiumPack2Shader,
  crystalRefract: premiumPack2Shader,
  feedbackZoom: premiumPack2Shader,
  fluidDistort: premiumPack2Shader,
  wormhole: premiumPack2Shader,
  geometricTile: premiumPack2Shader,
  motionTrails: premiumPack2Shader,
  echoRepeat: premiumPack2Shader,
  ghostDouble: premiumPack2Shader,
  strobeFlash: premiumPack2Shader,
  lightPaint: premiumPack2Shader,
  recursiveEcho: premiumPack2Shader,
  // Blob Tracking
  blobTrack: blobTrackShader,
  blobContour: blobContourShader,
  blobHeatmap: blobHeatmapShader,
  // Time-based effects
  timeSmear: timeSmearShader,
  chronophoto: chronoShader,
};

// Register built-in types with the custom-effects module so it can reject name collisions at import time.
registerBuiltinTypes(Object.keys(effectShaders));

/** Convert a [r,g,b] or [r,g,b,a] tuple into THREE.Vector3 (effects consume RGB only). */
function colorToVector3(c: unknown): THREE.Vector3 {
  if (Array.isArray(c) && c.length >= 3) {
    return new THREE.Vector3(Number(c[0]) || 0, Number(c[1]) || 0, Number(c[2]) || 0);
  }
  return new THREE.Vector3(1, 1, 1);
}

/**
 * Build the uniform map + material for a custom effect. Custom effects use a generic
 * uniform plumbing: every param.default becomes a uniform keyed by param.param.
 */
function createCustomMaterial(ce: CustomEffect): THREE.ShaderMaterial {
  const uniforms: Record<string, { value: unknown }> = {
    uTexture: { value: null },
    uResolution: { value: new THREE.Vector2(1920, 1080) },
    uTime: { value: 0 },
  };

  for (const [name, def] of Object.entries(ce.defaults)) {
    if (Array.isArray(def)) {
      uniforms[name] = { value: colorToVector3(def) };
    } else {
      uniforms[name] = { value: def };
    }
  }

  return new THREE.ShaderMaterial({
    vertexShader: effectVertexShader,
    fragmentShader: ce.shader,
    uniforms,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
}

/**
 * Create a shader material for an effect type with default uniforms
 */
export function createEffectMaterial(effectType: EffectType): THREE.ShaderMaterial {
  // Custom user-imported effects take precedence — they can't collide because
  // `registerBuiltinTypes` above blocks name overlap at import time.
  const custom = getCustomEffect(effectType as unknown as string);
  if (custom) {
    return createCustomMaterial(custom);
  }

  const fragmentShader = effectShaders[effectType];

  // Base uniforms all effects need
  const uniforms: Record<string, { value: unknown }> = {
    uTexture: { value: null },
    uResolution: { value: new THREE.Vector2(1920, 1080) },
    uTime: { value: 0 },
  };

  // Add effect-specific uniforms
  switch (effectType) {
    case 'vignette':
      uniforms.uSize = { value: 0.8 };
      uniforms.uSoftness = { value: 0.4 };
      uniforms.uRoundness = { value: 0.5 };
      break;

    case 'edgeFeather':
      uniforms.uTop = { value: 0 };
      uniforms.uBottom = { value: 0 };
      uniforms.uLeft = { value: 0 };
      uniforms.uRight = { value: 0 };
      uniforms.uSoftness = { value: 0.5 };
      break;

    case 'colorama':
      uniforms.uPalette = { value: 0 };
      uniforms.uOffset = { value: 0 };
      uniforms.uSpeed = { value: 0.2 };
      uniforms.uContrast = { value: 1 };
      uniforms.uMix = { value: 1 };
      break;

    case 'dither':
      uniforms.uType = { value: 0 };
      uniforms.uIntensity = { value: 1.0 };
      uniforms.uScale = { value: 1 };
      uniforms.uColorDepth = { value: 2 };
      break;

    case 'vhs':
      uniforms.uTracking = { value: 0.5 };
      uniforms.uNoise = { value: 0.3 };
      uniforms.uDistortion = { value: 0.3 };
      uniforms.uColorBleed = { value: 0.5 };
      uniforms.uScanlines = { value: 0.3 };
      break;

    case 'glitch':
      uniforms.uIntensity = { value: 0.5 };
      uniforms.uSpeed = { value: 1 };
      uniforms.uBlockSize = { value: 0.3 };
      uniforms.uRGBSplit = { value: 0.5 };
      uniforms.uJitter = { value: 0.3 };
      break;

    case 'rgbShift':
      uniforms.uAmount = { value: 5 };
      uniforms.uAngle = { value: 0 };
      break;

    case 'scanlines':
      uniforms.uIntensity = { value: 0.5 };
      uniforms.uCount = { value: 200 };
      uniforms.uSpeed = { value: 0 };
      break;

    case 'pixelate':
      uniforms.uSize = { value: 8 };
      break;

    case 'blur':
      uniforms.uRadius = { value: 5 };
      break;

    case 'sharpen':
      uniforms.uAmount = { value: 0.5 };
      break;

    case 'noise':
      uniforms.uAmount = { value: 0.2 };
      uniforms.uType = { value: 0 };
      break;

    case 'kaleidoscope':
      uniforms.uSegments = { value: 6 };
      uniforms.uAngle = { value: 0 };
      break;

    case 'mirror':
      uniforms.uAxis = { value: 0 };
      uniforms.uPosition = { value: 0.5 };
      break;

    case 'plasma':
      uniforms.uSpeed = { value: 1 };
      uniforms.uScale = { value: 5 };
      uniforms.uComplexity = { value: 3 };
      uniforms.uPalette = { value: 0 };
      break;

    case 'posterize':
      uniforms.uLevels = { value: 8 };
      break;

    case 'edgeDetect':
      uniforms.uThreshold = { value: 0.1 };
      uniforms.uThickness = { value: 1 };
      uniforms.uMode = { value: 0 };
      uniforms.uInvert = { value: 0 };
      break;

    case 'outline':
      uniforms.uThickness = { value: 2 };
      uniforms.uColor = { value: new THREE.Vector3(1, 1, 1) };
      uniforms.uOnly = { value: 0 };
      uniforms.uGlow = { value: 0 };
      break;

    case 'emboss':
      uniforms.uStrength = { value: 1 };
      uniforms.uAngle = { value: 135 };
      break;

    case 'wave':
      uniforms.uAmplitude = { value: 10 };
      uniforms.uFrequency = { value: 5 };
      uniforms.uSpeed = { value: 1 };
      uniforms.uType = { value: 0 };
      break;

    case 'fisheye':
      uniforms.uStrength = { value: 0.5 };
      uniforms.uRadius = { value: 1 };
      break;

    case 'thermal':
      uniforms.uIntensity = { value: 1 };
      uniforms.uPalette = { value: 0 };
      break;

    case 'nightVision':
      uniforms.uIntensity = { value: 1.5 };
      uniforms.uNoise = { value: 0.3 };
      uniforms.uVignette = { value: 0.5 };
      break;

    case 'brightness':
    case 'contrast':
    case 'saturation':
      uniforms.uAmount = { value: 0 };
      break;

    case 'hue':
      uniforms.uAmount = { value: 0 };
      break;

    // ProPack shader effects (32 modes)
    case 'curves':
    case 'liftGammaGain':
    case 'exposure':
    case 'gamma':
    case 'temperatureTint':
    case 'vibrance':
    case 'colorBalance':
    case 'filmGrain':
    case 'bloom':
    case 'chromaticAberration':
    case 'lensDistortion':
    case 'tiltShift':
    case 'godRays':
    case 'heatHaze':
    case 'directionalBlur':
    case 'zoomBlur':
    case 'radialBlur':
    case 'halftone':
    case 'toon':
    case 'kuwahara':
    case 'oilPaint':
    case 'watercolor':
    case 'crt':
    case 'compressionArtifacts':
    case 'chromaKey':
    case 'lumaKey':
    case 'differenceKey':
    case 'erode':
    case 'dilate':
    case 'displacement':
    case 'twirl':
    case 'pinchBulge':
      uniforms.uMode = { value: proEffectModes[effectType] ?? 0 };
      uniforms.uAmount = { value: 0.5 };
      uniforms.uAmount2 = { value: 0.5 };
      uniforms.uAmount3 = { value: 0.5 };
      uniforms.uThreshold = { value: 0.5 };
      uniforms.uAngle = { value: 0 };
      uniforms.uCenter = { value: new THREE.Vector2(0.5, 0.5) };
      uniforms.uColor = { value: new THREE.Vector3(0.5, 0.5, 0.5) };
      break;

    // Premium Pack shader effects (25 unique modes)
    case 'filmicTonemap':
    case 'selectiveColor':
    case 'falseColor':
    case 'shadowRecovery':
    case 'highlightRolloff':
    case 'halation':
    case 'anamorphicStreak':
    case 'lensDirt':
    case 'defocusBokeh':
    case 'diffusionPromist':
    case 'ascii':
    case 'comicInk':
    case 'datamoshLite':
    case 'scanlineDrift':
    case 'tapeDropout':
    case 'polarTransform':
    case 'rippleCaustics':
    case 'shockwave':
    case 'drosteRecursive':
    case 'slitScan':
    case 'volumetricFogOverlay':
    case 'rainFogSnowOverlay':
    case 'particleOverlayFx':
    case 'glintStarburst':
    case 'embossRelight':
    case 'dotMatrix':
    case 'matrixRain':
    case 'binaryCode':
    case 'crosshatch':
    case 'blockMosaic':
      uniforms.uMode = { value: premiumEffectModes[effectType] ?? 0 };
      uniforms.uAmount = { value: 0.5 };
      uniforms.uAmount2 = { value: 0.5 };
      uniforms.uAmount3 = { value: 0.5 };
      uniforms.uThreshold = { value: 0.5 };
      uniforms.uAngle = { value: 0 };
      uniforms.uCenter = { value: new THREE.Vector2(0.5, 0.5) };
      uniforms.uColor = { value: new THREE.Vector3(0.5, 0.5, 0.5) };
      break;

    // Dedicated standalone shaders (extracted from packs for GPU compatibility)
    case 'numberGrid':
    case 'explode3D':
    case 'terrain3D':
    case 'sphereProject':
    case 'cubeProject':
    case 'cylinderWrap':
    case 'torusTunnel':
    case 'diamondGem':
    case 'shatter3D':
    case 'mobiusStrip':
    case 'voxelDisplace':
    case 'waveSurface':
    case 'prismSplit':
    case 'origamiFold':
    case 'mirrorRoom':
    case 'hexGrid':
    case 'spiralTile':
    case 'shingleStack':
    case 'voronoiShatter':
    // New standalone text & pattern shaders
    case 'braillePattern':
    case 'circuitBoard':
    case 'stainedGlass':
    case 'wovenFabric':
    case 'mosaicTile':
    case 'neonOutline':
    case 'pixelSort':
    case 'linocut':
    case 'topoMap':
    case 'ledWall':
      uniforms.uMode = { value: 0 };
      uniforms.uAmount = { value: 0.5 };
      uniforms.uAmount2 = { value: 0.5 };
      uniforms.uAmount3 = { value: 0.5 };
      uniforms.uThreshold = { value: 0.5 };
      uniforms.uAngle = { value: 0 };
      uniforms.uCenter = { value: new THREE.Vector2(0.5, 0.5) };
      uniforms.uColor = { value: new THREE.Vector3(0.5, 0.5, 0.5) };
      break;

    // Premium Pack 2 — 3D, Depth, Feedback, Warp, Trails (remaining modes)
    case 'tunnelFlight':
    case 'infiniteMirror':
    case 'fractalWarp':
    case 'crystalRefract':
    case 'feedbackZoom':
    case 'fluidDistort':
    case 'wormhole':
    case 'geometricTile':
    case 'motionTrails':
    case 'echoRepeat':
    case 'ghostDouble':
    case 'strobeFlash':
    case 'lightPaint':
    case 'recursiveEcho':
      uniforms.uMode = { value: premiumPack2Modes[effectType] ?? 0 };
      uniforms.uAmount = { value: 0.5 };
      uniforms.uAmount2 = { value: 0.5 };
      uniforms.uAmount3 = { value: 0.5 };
      uniforms.uThreshold = { value: 0.5 };
      uniforms.uAngle = { value: 0 };
      uniforms.uCenter = { value: new THREE.Vector2(0.5, 0.5) };
      uniforms.uColor = { value: new THREE.Vector3(0.5, 0.5, 0.5) };
      break;

    case 'invert':
      // Invert has no params - it's a simple toggle
      break;

    // Blob Tracking effects
    case 'blobTrack':
    case 'blobContour':
    case 'blobHeatmap':
      uniforms.uThreshold = { value: 0.3 };
      uniforms.uShape = { value: 0 };
      uniforms.uColor = { value: 0 };
      uniforms.uThickness = { value: 2.0 };
      uniforms.uMinSize = { value: 0.02 };
      uniforms.uMaxBlobs = { value: 32 };
      uniforms.uShowCoords = { value: 1 };
      uniforms.uShowBBox = { value: 1 };
      uniforms.uShowCenter = { value: 1 };
      uniforms.uTrailLength = { value: 0.3 };
      uniforms.uGridSize = { value: 16 };
      uniforms.uMix = { value: 0.8 };
      uniforms.uColorMode = { value: 0 };
      uniforms.uFixedColor = { value: new THREE.Vector3(0.0, 1.0, 0.4) };
      uniforms.uMarkerSize = { value: 1.0 };
      uniforms.uBlendMode = { value: 0 };
      break;

    // Time-based effects
    case 'timeSmear':
    case 'chronophoto':
      uniforms.uMode = { value: 0 };
      uniforms.uAmount = { value: 0.5 };
      uniforms.uAmount2 = { value: 0.5 };
      uniforms.uAmount3 = { value: 0.7 };
      uniforms.uSpeed = { value: 1.0 };
      break;

  }

  return new THREE.ShaderMaterial({
    vertexShader: effectVertexShader,
    fragmentShader,
    uniforms,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
}

/**
 * Update effect material uniforms from effect params
 */
export function updateEffectUniforms(
  material: THREE.ShaderMaterial,
  effect: Effect,
  width: number,
  height: number,
  time: number
): void {
  const u = material.uniforms;
  const p = effect.params;

  // Update common uniforms
  if (u.uResolution) u.uResolution.value.set(width, height);
  if (u.uTime) u.uTime.value = time;

  // Custom user-imported effects: plumb every param generically by its uniform name.
  const custom = getCustomEffect(effect.type as unknown as string);
  if (custom) {
    for (const def of custom.params) {
      const key = def.param;
      const uniform = u[key];
      if (!uniform) continue;
      const val = (p as Record<string, unknown>)[key];
      if (val === undefined) continue;
      if (def.type === 'color') {
        if (Array.isArray(val) && val.length >= 3 && uniform.value instanceof THREE.Vector3) {
          uniform.value.set(Number(val[0]) || 0, Number(val[1]) || 0, Number(val[2]) || 0);
        }
      } else if (typeof val === 'number') {
        uniform.value = val;
      }
    }
    return;
  }

  // Update effect-specific uniforms
  switch (effect.type) {
    case 'vignette':
      if (u.uSize && p.vignetteSize !== undefined) u.uSize.value = p.vignetteSize;
      if (u.uSoftness && p.vignetteSoftness !== undefined) u.uSoftness.value = p.vignetteSoftness;
      if (u.uRoundness && p.vignetteRoundness !== undefined) u.uRoundness.value = p.vignetteRoundness;
      break;

    case 'edgeFeather':
      if (u.uTop && p.featherTop !== undefined) u.uTop.value = p.featherTop;
      if (u.uBottom && p.featherBottom !== undefined) u.uBottom.value = p.featherBottom;
      if (u.uLeft && p.featherLeft !== undefined) u.uLeft.value = p.featherLeft;
      if (u.uRight && p.featherRight !== undefined) u.uRight.value = p.featherRight;
      if (u.uSoftness && p.featherSoftness !== undefined) u.uSoftness.value = p.featherSoftness;
      break;

    case 'colorama':
      if (u.uPalette && p.coloramaPalette !== undefined) u.uPalette.value = p.coloramaPalette;
      if (u.uOffset && p.coloramaOffset !== undefined) u.uOffset.value = p.coloramaOffset;
      if (u.uSpeed && p.coloramaSpeed !== undefined) u.uSpeed.value = p.coloramaSpeed;
      if (u.uContrast && p.coloramaContrast !== undefined) u.uContrast.value = p.coloramaContrast;
      if (u.uMix && p.coloramaMix !== undefined) u.uMix.value = p.coloramaMix;
      break;

    case 'dither':
      if (u.uType && p.ditherType !== undefined) u.uType.value = p.ditherType;
      if (u.uIntensity && p.ditherIntensity !== undefined) u.uIntensity.value = p.ditherIntensity;
      if (u.uScale && p.ditherScale !== undefined) u.uScale.value = p.ditherScale;
      if (u.uColorDepth && p.ditherColorDepth !== undefined) u.uColorDepth.value = p.ditherColorDepth;
      break;

    case 'vhs':
      if (u.uTracking && p.vhsTracking !== undefined) u.uTracking.value = p.vhsTracking;
      if (u.uNoise && p.vhsNoise !== undefined) u.uNoise.value = p.vhsNoise;
      if (u.uDistortion && p.vhsDistortion !== undefined) u.uDistortion.value = p.vhsDistortion;
      if (u.uColorBleed && p.vhsColorBleed !== undefined) u.uColorBleed.value = p.vhsColorBleed;
      if (u.uScanlines && p.vhsScanlines !== undefined) u.uScanlines.value = p.vhsScanlines;
      break;

    case 'glitch':
      if (u.uIntensity && p.glitchIntensity !== undefined) u.uIntensity.value = p.glitchIntensity;
      if (u.uSpeed && p.glitchSpeed !== undefined) u.uSpeed.value = p.glitchSpeed;
      if (u.uBlockSize && p.glitchBlockSize !== undefined) u.uBlockSize.value = p.glitchBlockSize;
      if (u.uRGBSplit && p.glitchRGBSplit !== undefined) u.uRGBSplit.value = p.glitchRGBSplit;
      if (u.uJitter && p.glitchJitter !== undefined) u.uJitter.value = p.glitchJitter;
      break;

    case 'rgbShift':
      if (u.uAmount && p.rgbShiftAmount !== undefined) u.uAmount.value = p.rgbShiftAmount;
      if (u.uAngle && p.rgbShiftAngle !== undefined) u.uAngle.value = p.rgbShiftAngle;
      break;

    case 'scanlines':
      if (u.uIntensity && p.scanlinesIntensity !== undefined) u.uIntensity.value = p.scanlinesIntensity;
      if (u.uCount && p.scanlinesCount !== undefined) u.uCount.value = p.scanlinesCount;
      if (u.uSpeed && p.scanlinesSpeed !== undefined) u.uSpeed.value = p.scanlinesSpeed;
      break;

    case 'pixelate':
      if (u.uSize && p.pixelateSize !== undefined) u.uSize.value = p.pixelateSize;
      break;

    case 'blur':
      if (u.uRadius && p.blurRadius !== undefined) u.uRadius.value = p.blurRadius;
      break;

    case 'sharpen':
      if (u.uAmount && p.sharpenAmount !== undefined) u.uAmount.value = p.sharpenAmount;
      break;

    case 'noise':
      if (u.uAmount && p.noiseAmount !== undefined) u.uAmount.value = p.noiseAmount;
      if (u.uType && p.noiseType !== undefined) u.uType.value = p.noiseType;
      break;

    case 'kaleidoscope':
      if (u.uSegments && p.kaleidoscopeSegments !== undefined) u.uSegments.value = p.kaleidoscopeSegments;
      if (u.uAngle && p.kaleidoscopeAngle !== undefined) u.uAngle.value = p.kaleidoscopeAngle;
      break;

    case 'mirror':
      if (u.uAxis && p.mirrorAxis !== undefined) u.uAxis.value = p.mirrorAxis;
      if (u.uPosition && p.mirrorPosition !== undefined) u.uPosition.value = p.mirrorPosition;
      break;

    case 'plasma':
      if (u.uSpeed && p.plasmaSpeed !== undefined) u.uSpeed.value = p.plasmaSpeed;
      if (u.uScale && p.plasmaScale !== undefined) u.uScale.value = p.plasmaScale;
      if (u.uComplexity && p.plasmaComplexity !== undefined) u.uComplexity.value = p.plasmaComplexity;
      if (u.uPalette && p.plasmaPalette !== undefined) u.uPalette.value = p.plasmaPalette;
      break;

    case 'posterize':
      if (u.uLevels && p.posterizeLevels !== undefined) u.uLevels.value = p.posterizeLevels;
      break;

    case 'edgeDetect':
      if (u.uThreshold && p.edgeThreshold !== undefined) u.uThreshold.value = p.edgeThreshold;
      if (u.uThickness && p.edgeThickness !== undefined) u.uThickness.value = p.edgeThickness;
      if (u.uMode && p.edgeMode !== undefined) u.uMode.value = p.edgeMode;
      if (u.uInvert && p.edgeInvert !== undefined) u.uInvert.value = p.edgeInvert;
      break;

    case 'outline':
      if (u.uThickness && p.outlineThickness !== undefined) u.uThickness.value = p.outlineThickness;
      if (u.uColor && p.outlineColor !== undefined) {
        const c = p.outlineColor;
        u.uColor.value.set(c[0] || 1, c[1] || 1, c[2] || 1);
      }
      if (u.uOnly && p.outlineOnly !== undefined) u.uOnly.value = p.outlineOnly;
      if (u.uGlow && p.outlineGlow !== undefined) u.uGlow.value = p.outlineGlow;
      break;

    case 'emboss':
      if (u.uStrength && p.embossStrength !== undefined) u.uStrength.value = p.embossStrength;
      if (u.uAngle && p.embossAngle !== undefined) u.uAngle.value = p.embossAngle;
      break;

    case 'wave':
      if (u.uAmplitude && p.waveAmplitude !== undefined) u.uAmplitude.value = p.waveAmplitude;
      if (u.uFrequency && p.waveFrequency !== undefined) u.uFrequency.value = p.waveFrequency;
      if (u.uSpeed && p.waveSpeed !== undefined) u.uSpeed.value = p.waveSpeed;
      if (u.uType && p.waveType !== undefined) u.uType.value = p.waveType;
      break;

    case 'fisheye':
      if (u.uStrength && p.fisheyeStrength !== undefined) u.uStrength.value = p.fisheyeStrength;
      if (u.uRadius && p.fisheyeRadius !== undefined) u.uRadius.value = p.fisheyeRadius;
      break;

    case 'thermal':
      if (u.uIntensity && p.thermalIntensity !== undefined) u.uIntensity.value = p.thermalIntensity;
      if (u.uPalette && p.thermalPalette !== undefined) u.uPalette.value = p.thermalPalette;
      break;

    case 'nightVision':
      if (u.uIntensity && p.nightVisionIntensity !== undefined) u.uIntensity.value = p.nightVisionIntensity;
      if (u.uNoise && p.nightVisionNoise !== undefined) u.uNoise.value = p.nightVisionNoise;
      if (u.uVignette && p.nightVisionVignette !== undefined) u.uVignette.value = p.nightVisionVignette;
      break;

    case 'brightness':
      if (u.uAmount && p.brightnessAmount !== undefined) u.uAmount.value = p.brightnessAmount;
      break;

    case 'contrast':
      if (u.uAmount && p.contrastAmount !== undefined) u.uAmount.value = p.contrastAmount;
      break;

    case 'saturation':
      if (u.uAmount && p.saturationAmount !== undefined) u.uAmount.value = p.saturationAmount;
      break;

    case 'hue':
      if (u.uAmount && p.hueShift !== undefined) u.uAmount.value = p.hueShift;
      break;

    // ProPack shader effects
    case 'curves':
    case 'liftGammaGain':
    case 'exposure':
    case 'gamma':
    case 'temperatureTint':
    case 'vibrance':
    case 'colorBalance':
    case 'filmGrain':
    case 'bloom':
    case 'chromaticAberration':
    case 'lensDistortion':
    case 'tiltShift':
    case 'godRays':
    case 'heatHaze':
    case 'directionalBlur':
    case 'zoomBlur':
    case 'radialBlur':
    case 'halftone':
    case 'toon':
    case 'kuwahara':
    case 'oilPaint':
    case 'watercolor':
    case 'crt':
    case 'compressionArtifacts':
    case 'chromaKey':
    case 'lumaKey':
    case 'differenceKey':
    case 'erode':
    case 'dilate':
    case 'displacement':
    case 'twirl':
    case 'pinchBulge':
      if (u.uMode) u.uMode.value = proEffectModes[effect.type] ?? 0;
      if (u.uAmount) u.uAmount.value = p.amount ?? p.intensity ?? 0.5;
      if (u.uAmount2) u.uAmount2.value = p.amount2 ?? p.size ?? 0.5;
      if (u.uAmount3) u.uAmount3.value = p.amount3 ?? p.softness ?? 0.5;
      if (u.uThreshold) u.uThreshold.value = p.threshold ?? 0.5;
      if (u.uAngle) u.uAngle.value = p.angle ?? 0;
      if (u.uCenter) {
        const cx = p.centerX ?? 0.5;
        const cy = p.centerY ?? 0.5;
        u.uCenter.value.set(cx, cy);
      }
      if (u.uColor) {
        u.uColor.value.set(
          p.red ?? 0.5,
          p.green ?? 0.5,
          p.blue ?? 0.5
        );
      }
      break;

    // Premium Pack shader effects
    case 'filmicTonemap':
    case 'selectiveColor':
    case 'falseColor':
    case 'shadowRecovery':
    case 'highlightRolloff':
    case 'halation':
    case 'anamorphicStreak':
    case 'lensDirt':
    case 'defocusBokeh':
    case 'diffusionPromist':
    case 'ascii':
    case 'comicInk':
    case 'datamoshLite':
    case 'scanlineDrift':
    case 'tapeDropout':
    case 'polarTransform':
    case 'rippleCaustics':
    case 'shockwave':
    case 'drosteRecursive':
    case 'slitScan':
    case 'volumetricFogOverlay':
    case 'rainFogSnowOverlay':
    case 'particleOverlayFx':
    case 'glintStarburst':
    case 'embossRelight':
    case 'dotMatrix':
    case 'matrixRain':
    case 'binaryCode':
    case 'crosshatch':
    case 'blockMosaic': {
      if (u.uMode) u.uMode.value = premiumEffectModes[effect.type] ?? 0;
      if (u.uAmount) u.uAmount.value = p.amount ?? p.intensity ?? 0.5;
      if (u.uAmount2) u.uAmount2.value = p.amount2 ?? p.size ?? 0.5;
      if (u.uAmount3) u.uAmount3.value = p.amount3 ?? p.softness ?? 0.5;
      if (u.uThreshold) u.uThreshold.value = p.threshold ?? 0.5;
      if (u.uAngle) u.uAngle.value = p.angle ?? 0;
      if (u.uCenter) {
        const pcx = p.centerX ?? 0.5;
        const pcy = p.centerY ?? 0.5;
        u.uCenter.value.set(pcx, pcy);
      }
      if (u.uColor) {
        u.uColor.value.set(
          p.red ?? 0.5,
          p.green ?? 0.5,
          p.blue ?? 0.5
        );
      }
      break;
    }

    // Dedicated standalone shaders (same uniform interface, no mode dispatch)
    case 'numberGrid':
    case 'explode3D':
    case 'terrain3D':
    case 'sphereProject':
    case 'cubeProject':
    case 'cylinderWrap':
    case 'torusTunnel':
    case 'diamondGem':
    case 'shatter3D':
    case 'mobiusStrip':
    case 'voxelDisplace':
    case 'waveSurface':
    case 'prismSplit':
    case 'origamiFold':
    case 'mirrorRoom':
    case 'hexGrid':
    case 'spiralTile':
    case 'shingleStack':
    case 'voronoiShatter':
    // New standalone text & pattern shaders
    case 'braillePattern':
    case 'circuitBoard':
    case 'stainedGlass':
    case 'wovenFabric':
    case 'mosaicTile':
    case 'neonOutline':
    case 'pixelSort':
    case 'linocut':
    case 'topoMap':
    case 'ledWall': {
      if (u.uAmount) u.uAmount.value = p.amount ?? p.intensity ?? 0.5;
      if (u.uAmount2) u.uAmount2.value = p.amount2 ?? p.size ?? 0.5;
      if (u.uAmount3) u.uAmount3.value = p.amount3 ?? p.softness ?? 0.5;
      if (u.uThreshold) u.uThreshold.value = p.threshold ?? 0.5;
      if (u.uAngle) u.uAngle.value = p.angle ?? 0;
      if (u.uCenter) {
        const pcx = p.centerX ?? 0.5;
        const pcy = p.centerY ?? 0.5;
        u.uCenter.value.set(pcx, pcy);
      }
      if (u.uColor) {
        u.uColor.value.set(
          p.red ?? 0.5,
          p.green ?? 0.5,
          p.blue ?? 0.5
        );
      }
      break;
    }

    // Premium Pack 2 — 3D, Depth, Feedback, Warp, Trails (remaining modes)
    case 'tunnelFlight':
    case 'infiniteMirror':
    case 'fractalWarp':
    case 'crystalRefract':
    case 'feedbackZoom':
    case 'fluidDistort':
    case 'wormhole':
    case 'geometricTile':
    case 'motionTrails':
    case 'echoRepeat':
    case 'ghostDouble':
    case 'strobeFlash':
    case 'lightPaint':
    case 'recursiveEcho': {
      if (u.uMode) u.uMode.value = premiumPack2Modes[effect.type] ?? 0;
      if (u.uAmount) u.uAmount.value = p.amount ?? p.intensity ?? 0.5;
      if (u.uAmount2) u.uAmount2.value = p.amount2 ?? p.size ?? 0.5;
      if (u.uAmount3) u.uAmount3.value = p.amount3 ?? p.softness ?? 0.5;
      if (u.uThreshold) u.uThreshold.value = p.threshold ?? 0.5;
      if (u.uAngle) u.uAngle.value = p.angle ?? 0;
      if (u.uCenter) {
        const pcx = p.centerX ?? 0.5;
        const pcy = p.centerY ?? 0.5;
        u.uCenter.value.set(pcx, pcy);
      }
      if (u.uColor) {
        u.uColor.value.set(
          p.red ?? 0.5,
          p.green ?? 0.5,
          p.blue ?? 0.5
        );
      }
      break;
    }

    case 'invert':
      // No params to update
      break;

    // Blob Tracking
    case 'blobTrack':
    case 'blobContour':
    case 'blobHeatmap':
      if (u.uThreshold) u.uThreshold.value = p.blobThreshold ?? 0.3;
      if (u.uShape) u.uShape.value = p.blobShape ?? 0;
      if (u.uColor) u.uColor.value = p.blobColor ?? 0;
      if (u.uThickness) u.uThickness.value = p.blobThickness ?? 2.0;
      if (u.uMinSize) u.uMinSize.value = p.blobMinSize ?? 0.02;
      if (u.uMaxBlobs) u.uMaxBlobs.value = p.blobMaxBlobs ?? 32;
      if (u.uShowCoords) u.uShowCoords.value = p.blobShowCoords ?? 1;
      if (u.uShowBBox) u.uShowBBox.value = p.blobShowBBox ?? 1;
      if (u.uShowCenter) u.uShowCenter.value = p.blobShowCenter ?? 1;
      if (u.uTrailLength) u.uTrailLength.value = p.blobTrailLength ?? 0.3;
      if (u.uGridSize) u.uGridSize.value = p.blobGridSize ?? 16;
      if (u.uMix) u.uMix.value = p.blobMix ?? 0.8;
      if (u.uColorMode) u.uColorMode.value = p.blobColorMode ?? 0;
      if (u.uFixedColor) u.uFixedColor.value.set(
        p.blobFixedColorR ?? 0.0,
        p.blobFixedColorG ?? 1.0,
        p.blobFixedColorB ?? 0.4
      );
      if (u.uMarkerSize) u.uMarkerSize.value = p.blobMarkerSize ?? 1.0;
      if (u.uBlendMode) u.uBlendMode.value = p.blobBlendMode ?? 0;
      break;

    // Time-based effects
    case 'timeSmear':
    case 'chronophoto':
      if (u.uMode) u.uMode.value = p.mode ?? 0;
      if (u.uAmount) u.uAmount.value = p.amount ?? 0.5;
      if (u.uAmount2) u.uAmount2.value = p.amount2 ?? 0.5;
      if (u.uAmount3) u.uAmount3.value = p.amount3 ?? 0.7;
      if (u.uSpeed) u.uSpeed.value = p.speed ?? 1.0;
      break;

  }
}

/**
 * Get default params for an effect type
 */
export function getDefaultEffectParams(type: EffectType): EffectParams {
  // Custom effects: return their stored defaults (scalars keyed by uniform name;
  // colors stay as the [r,g,b,a] tuple in params so the slider UI can read them).
  const custom = getCustomEffect(type as unknown as string);
  if (custom) {
    return custom.defaults as unknown as EffectParams;
  }
  switch (type) {
    case 'vignette':
      return { vignetteSize: 0.8, vignetteSoftness: 0.4, vignetteRoundness: 0.5 };
    case 'edgeFeather':
      return { featherTop: 0, featherBottom: 0, featherLeft: 0, featherRight: 0, featherSoftness: 0.5 };
    case 'colorama':
      return { coloramaPalette: 0, coloramaOffset: 0, coloramaSpeed: 0.2, coloramaContrast: 1, coloramaMix: 1 };
    case 'dither':
      return { ditherType: 0, ditherIntensity: 1.0, ditherScale: 1, ditherColorDepth: 2 };
    case 'vhs':
      return { vhsTracking: 0.5, vhsNoise: 0.3, vhsDistortion: 0.3, vhsColorBleed: 0.5, vhsScanlines: 0.3 };
    case 'glitch':
      return { glitchIntensity: 0.5, glitchSpeed: 1, glitchBlockSize: 0.3, glitchRGBSplit: 0.5, glitchJitter: 0.3 };
    case 'rgbShift':
      return { rgbShiftAmount: 5, rgbShiftAngle: 0 };
    case 'scanlines':
      return { scanlinesIntensity: 0.5, scanlinesCount: 200, scanlinesSpeed: 0 };
    case 'pixelate':
      return { pixelateSize: 8 };
    case 'blur':
      return { blurRadius: 5 };
    case 'sharpen':
      return { sharpenAmount: 0.5 };
    case 'noise':
      return { noiseAmount: 0.2, noiseType: 0 };
    case 'kaleidoscope':
      return { kaleidoscopeSegments: 6, kaleidoscopeAngle: 0 };
    case 'mirror':
      return { mirrorAxis: 0, mirrorPosition: 0.5 };
    case 'plasma':
      return { plasmaSpeed: 1, plasmaScale: 5, plasmaComplexity: 3, plasmaPalette: 0 };
    case 'posterize':
      return { posterizeLevels: 8 };
    case 'edgeDetect':
      return { edgeThreshold: 0.1, edgeThickness: 1, edgeMode: 0, edgeInvert: 0 };
    case 'outline':
      return { outlineThickness: 2, outlineColor: [1, 1, 1], outlineOnly: 0, outlineGlow: 0 };
    case 'emboss':
      return { embossStrength: 1, embossAngle: 135 };
    case 'wave':
      return { waveAmplitude: 10, waveFrequency: 5, waveSpeed: 1, waveType: 0 };
    case 'fisheye':
      return { fisheyeStrength: 0.5, fisheyeRadius: 1 };
    case 'thermal':
      return { thermalIntensity: 1, thermalPalette: 0 };
    case 'nightVision':
      return { nightVisionIntensity: 1.5, nightVisionNoise: 0.3, nightVisionVignette: 0.5 };
    case 'brightness':
      return { brightnessAmount: 0 };
    case 'contrast':
      return { contrastAmount: 0 };
    case 'saturation':
      return { saturationAmount: 0 };
    case 'hue':
      return { hueShift: 0 };
    case 'curves':
      return { amount: 0.5, red: 0.5, green: 0.5, blue: 0.5 };
    case 'liftGammaGain':
      return { amount: 0.5, amount2: 0.5, amount3: 0.5, red: 0.5, green: 0.5, blue: 0.5 };
    case 'exposure':
      return { amount: 0.5 };
    case 'gamma':
      return { amount: 0.5 };
    case 'temperatureTint':
      return { amount: 0.5, amount2: 0.5 };
    case 'vibrance':
      return { amount: 0.5 };
    case 'colorBalance':
      return { amount: 0.5, red: 0.5, green: 0.5, blue: 0.5 };
    case 'filmGrain':
      return { amount: 0.2 };
    case 'bloom':
      return { amount: 0.35, amount2: 0.5, threshold: 0.65 };
    case 'chromaticAberration':
      return { amount: 0.3, centerX: 0.5, centerY: 0.5 };
    case 'lensDistortion':
      return { amount: 0.5, centerX: 0.5, centerY: 0.5 };
    case 'tiltShift':
      return { amount: 0.35, amount2: 0.35, centerY: 0.5 };
    case 'godRays':
      return { amount: 0.5, amount2: 0.35, threshold: 0.7, centerX: 0.5, centerY: 0.5 };
    case 'heatHaze':
      return { amount: 0.3 };
    case 'directionalBlur':
      return { amount: 0.25, angle: 0.0 };
    case 'zoomBlur':
      return { amount: 0.25, centerX: 0.5, centerY: 0.5 };
    case 'radialBlur':
      return { amount: 0.25, centerX: 0.5, centerY: 0.5 };
    case 'halftone':
      return { amount: 0.5 };
    case 'toon':
      return { amount: 0.5, amount2: 0.4 };
    case 'kuwahara':
      return { amount: 0.4 };
    case 'oilPaint':
      return { amount: 0.4, amount2: 0.4 };
    case 'watercolor':
      return { amount: 0.45, amount2: 0.4 };
    case 'crt':
      return { amount: 0.4, amount2: 0.5, amount3: 0.5 };
    case 'compressionArtifacts':
      return { amount: 0.55, amount2: 0.45 };
    case 'chromaKey':
      return { threshold: 0.25, amount: 0.12, red: 0.0, green: 1.0, blue: 0.0 };
    case 'lumaKey':
      return { threshold: 0.4, amount: 0.15 };
    case 'differenceKey':
      return { amount: 0.2, amount2: 0.2, threshold: 0.5 };
    case 'erode':
      return { amount: 0.25 };
    case 'dilate':
      return { amount: 0.25 };
    case 'displacement':
      return { amount: 0.3 };
    case 'twirl':
      return { amount: 0.4, amount2: 0.6, centerX: 0.5, centerY: 0.5 };
    case 'pinchBulge':
      return { amount: 0.5, centerX: 0.5, centerY: 0.5 };
    // ── Premium Pack effects (unique defaults per effect) ──
    case 'filmicTonemap':
      return { amount: 0.6, amount2: 0.5, amount3: 0.3, threshold: 0.9 };
    case 'selectiveColor':
      return { amount: 0.5, amount2: 0.15, amount3: 0.5, red: 0, green: 0.5, blue: 0.5 };
    case 'falseColor':
      return { amount: 0.8, amount2: 0.5, threshold: 0.85 };
    case 'shadowRecovery':
      return { amount: 0.5, amount2: 0.4, threshold: 0.6 };
    case 'highlightRolloff':
      return { amount: 0.5, amount2: 0.5, threshold: 0.7 };
    case 'halation':
      return { amount: 0.5, amount2: 0.5, threshold: 0.6, red: 0.8, green: 0.4, blue: 0.2 };
    case 'anamorphicStreak':
      return { amount: 0.5, amount2: 0.5, threshold: 0.65, red: 0.6, green: 0.7, blue: 1.0 };
    case 'lensDirt':
      return { amount: 0.4, amount2: 0.5, amount3: 0.5, threshold: 0.6 };
    case 'defocusBokeh':
      return { amount: 0.4, amount2: 0.5, amount3: 0.5, threshold: 0.3 };
    case 'diffusionPromist':
      return { amount: 0.45, amount2: 0.5, amount3: 0.3, threshold: 0.5 };
    case 'ascii':
      return { amount: 0.35, amount2: 0.6, amount3: 0.3 };
    case 'comicInk':
      return { amount: 0.5, amount2: 0.5, amount3: 0.6, threshold: 0.3 };
    case 'datamoshLite':
      return { amount: 0.5, amount2: 0.3, amount3: 0.4 };
    case 'scanlineDrift':
      return { amount: 0.4, amount2: 0.3, amount3: 0.5 };
    case 'tapeDropout':
      return { amount: 0.3, amount2: 0.3, amount3: 0.5 };
    case 'polarTransform':
      return { amount: 0.5, amount2: 0, centerX: 0.5, centerY: 0.5 };
    case 'rippleCaustics':
      return { amount: 0.3, amount2: 0.5, amount3: 0.4 };
    case 'shockwave':
      return { amount: 0.5, amount2: 0.5, amount3: 0.3, centerX: 0.5, centerY: 0.5 };
    case 'drosteRecursive':
      return { amount: 0.5, amount2: 0.3, amount3: 0.5, centerX: 0.5, centerY: 0.5 };
    case 'slitScan':
      return { amount: 0.5, amount2: 0.4, amount3: 0 };
    case 'volumetricFogOverlay':
      return { amount: 0.4, amount2: 0.5, amount3: 0.3, red: 0.7, green: 0.75, blue: 0.8 };
    case 'rainFogSnowOverlay':
      return { amount: 0.5, amount2: 0.5, amount3: 0.3, angle: 0.3 };
    case 'particleOverlayFx':
      return { amount: 0.4, amount2: 0.3, amount3: 0.3, threshold: 0.7 };
    case 'glintStarburst':
      return { amount: 0.5, amount2: 0.5, threshold: 0.7, angle: 0 };
    case 'embossRelight':
      return { amount: 0.5, angle: 2.35, red: 0.7, green: 0.8, blue: 1.0 };
    // ── Premium Text & Pattern ──
    case 'dotMatrix':
      return { amount: 0.4, amount2: 0.5, amount3: 0.5 };
    case 'matrixRain':
      return { amount: 0.5, amount2: 0.5, amount3: 0.4, threshold: 0.6 };
    case 'binaryCode':
      return { amount: 0.35, amount2: 0.6, amount3: 0.3 };
    case 'crosshatch':
      return { amount: 0.5, amount2: 0.4, amount3: 0.5, threshold: 0.5 };
    case 'blockMosaic':
      return { amount: 0.4, amount2: 0.5, amount3: 0.4 };
    case 'numberGrid':
      return { amount: 0.35, amount2: 0.6, amount3: 0.3 };
    // ── New Standalone Text & Pattern ──
    case 'braillePattern':
      return { amount: 0.4, amount2: 0.5, amount3: 0.5 };
    case 'circuitBoard':
      return { amount: 0.5, amount2: 0.5, amount3: 0.4 };
    case 'stainedGlass':
      return { amount: 0.5, amount2: 0.4, amount3: 0.5 };
    case 'wovenFabric':
      return { amount: 0.5, amount2: 0.5, amount3: 0.4 };
    case 'mosaicTile':
      return { amount: 0.5, amount2: 0.3, amount3: 0.3 };
    case 'neonOutline':
      return { amount: 0.5, amount2: 0.5, amount3: 0.6, red: 1.0, green: 0.2, blue: 0.8 };
    case 'pixelSort':
      return { amount: 0.5, amount2: 0.4, amount3: 0.3 };
    case 'linocut':
      return { amount: 0.5, amount2: 0.4, amount3: 0.7, threshold: 0.5 };
    case 'topoMap':
      return { amount: 0.5, amount2: 0.4, amount3: 0.3, red: 0.25, green: 0.18, blue: 0.12 };
    case 'ledWall':
      return { amount: 0.4, amount2: 0.5, amount3: 0.5 };
    // ── Premium 3D ──
    case 'explode3D':
      return { amount: 0.3, amount2: 0, amount3: 0.3, threshold: 0.7, angle: 0, red: 1.0, green: 0.95, blue: 0.9 };
    case 'terrain3D':
      return { amount: 0.5, amount2: 0.3, amount3: 0.3, threshold: 0.3, angle: 0, centerX: 0.5, centerY: 0, red: 0.5, green: 0.6, blue: 0.8 };
    case 'sphereProject':
      return { amount: 0.8, amount2: 0.4, amount3: 0.2, threshold: 0.5, red: 1.0, green: 0.95, blue: 0.9 };
    case 'cubeProject':
      return { amount: 0.6, amount2: 0.3, amount3: 0.2, angle: 0.5, red: 1.0, green: 0.95, blue: 0.9 };
    case 'cylinderWrap':
      return { amount: 0.8, amount2: 0.5, amount3: 0.2, threshold: 0.5, red: 1.0, green: 0.95, blue: 0.9 };
    case 'torusTunnel':
      return { amount: 0.8, amount2: 0.4, amount3: 0.3, threshold: 0.3, red: 0.1, green: 0.1, blue: 0.15 };
    case 'diamondGem':
      return { amount: 0.8, amount2: 0.5, amount3: 0.15, threshold: 0.6, red: 1.0, green: 0.95, blue: 0.9 };
    case 'shatter3D':
      return { amount: 0.5, amount2: 0.4, amount3: 0.3, threshold: 0.3 };
    case 'mobiusStrip':
      return { amount: 0.8, amount2: 0.4, amount3: 0.2, threshold: 0.5, red: 0.8, green: 0.8, blue: 0.9 };
    case 'voxelDisplace':
      return { amount: 0.5, amount2: 0.4, amount3: 0.15, threshold: 0.2, red: 1.0, green: 0.95, blue: 0.9 };
    case 'waveSurface':
      return { amount: 0.4, amount2: 0.5, amount3: 0.3, threshold: 0.5, red: 0.5, green: 0.7, blue: 0.9 };
    case 'prismSplit':
      return { amount: 0.5, amount2: 0.5, amount3: 0.0, threshold: 0.3, red: 1.0, green: 1.0, blue: 1.0 };
    case 'origamiFold':
      return { amount: 0.5, amount2: 0.4, amount3: 0.2, threshold: 0.6 };
    case 'mirrorRoom':
      return { amount: 0.8, amount2: 0.5, amount3: 0.15, threshold: 0.5, red: 0.9, green: 0.9, blue: 1.0 };
    case 'hexGrid':
      return { amount: 0.8, amount2: 0.4, amount3: 0.3, threshold: 0.2 };
    case 'spiralTile':
      return { amount: 0.8, amount2: 0.4, amount3: 0.2, threshold: 0.3 };
    case 'shingleStack':
      return { amount: 0.8, amount2: 0.4, amount3: 0.25, threshold: 0.3 };
    case 'voronoiShatter':
      return { amount: 0.8, amount2: 0.4, amount3: 0.2, threshold: 0.3 };
    case 'geometricTile':
      return { amount: 0.4, amount2: 0.5, amount3: 0.3, threshold: 0.1 };
    // ── Premium Depth ──
    case 'tunnelFlight':
      return { amount: 0.5, amount2: 0, amount3: 0.3, threshold: 0.4, angle: 0, red: 0.3, green: 0.2, blue: 0.4 };
    case 'infiniteMirror':
      return { amount: 0.6, amount2: 0.4, amount3: 0.1, threshold: 0.5, red: 0.5, green: 0.5, blue: 0.6 };
    case 'crystalRefract':
      return { amount: 0.5, amount2: 0.5, amount3: 0.3, threshold: 0.5, angle: 0, red: 0.9, green: 0.95, blue: 1.0 };
    // ── Premium Feedback ──
    case 'feedbackZoom':
      return { amount: 0.4, amount2: 0.5, amount3: 0.2, threshold: 0.3, centerX: 0.5, centerY: 0.5 };
    // ── Premium Warp ──
    case 'fractalWarp':
      return { amount: 0.7, amount2: 0, amount3: 0.2, threshold: 0.5, centerX: 0.5, centerY: 0.5, red: 0.2, green: 0.1, blue: 0.5 };
    case 'fluidDistort':
      return { amount: 0.4, amount2: 0.5, amount3: 0.3, threshold: 0.5, angle: 0 };
    case 'wormhole':
      return { amount: 0.5, amount2: 0.3, amount3: 0.3, threshold: 0.6, centerX: 0.5, centerY: 0.5, red: 1.0, green: 0.6, blue: 0.2 };
    // ── Premium Trails ──
    case 'motionTrails':
      return { amount: 0.5, amount2: 0.2, amount3: 0.5, threshold: 0.6, angle: 0, red: 1.0, green: 0.8, blue: 0.5 };
    case 'echoRepeat':
      return { amount: 0.4, amount2: 0.3, amount3: 0.5, threshold: 0.5, angle: 2.35, red: 0.5, green: 0.5, blue: 0.5 };
    case 'ghostDouble':
      return { amount: 0.3, amount2: 0.3, amount3: 0.4, threshold: 0.5, angle: 0 };
    case 'strobeFlash':
      return { amount: 0.3, amount2: 0.5, amount3: 0, threshold: 0.8, red: 1.0, green: 1.0, blue: 1.0 };
    case 'lightPaint':
      return { amount: 0.5, amount2: 0.5, amount3: 0.3, threshold: 0.4, red: 1.0, green: 0.8, blue: 0.3 };
    case 'recursiveEcho':
      return { amount: 0.5, amount2: 0.3, amount3: 0.5, threshold: 0.5, angle: 2.35, red: 0.5, green: 0.3, blue: 0.7 };
    case 'invert':
      return { invertAmount: 1 };
    // Blob Tracking
    case 'blobTrack':
      return { blobThreshold: 0.3, blobShape: 0, blobColor: 0, blobColorMode: 0, blobFixedColorR: 0, blobFixedColorG: 1, blobFixedColorB: 0.4, blobThickness: 2, blobMinSize: 0.02, blobMaxBlobs: 32, blobShowCoords: 1, blobShowBBox: 1, blobShowCenter: 1, blobTrailLength: 0.3, blobGridSize: 16, blobMix: 0.8, blobMarkerSize: 1.0, blobBlendMode: 0 };
    case 'blobContour':
      return { blobThreshold: 0.4, blobShape: 0, blobColor: 1, blobThickness: 1.5, blobMinSize: 0.5, blobShowCoords: 0, blobTrailLength: 0.4, blobGridSize: 16, blobMix: 0.7 };
    case 'blobHeatmap':
      return { blobThreshold: 0.2, blobShape: 0, blobColor: 0, blobThickness: 1, blobShowCoords: 1, blobShowBBox: 1, blobShowCenter: 1, blobGridSize: 16, blobMix: 0.85 };
    // Time-based effects
    case 'timeSmear':
      return { mode: 0, amount: 0.5, amount2: 0.5, amount3: 0.7, speed: 1.0 };
    case 'chronophoto':
      return { mode: 0, amount: 0.5, amount2: 0.3, amount3: 0.5, speed: 1.0 };
    default:
      return {};
  }
}
