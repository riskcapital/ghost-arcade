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
  bloomHeroShader,
  feedbackZoomHeroShader,
  exposureHeroShader,
  gammaHeroShader,
  vibranceHeroShader,
  temperatureTintHeroShader,
  colorBalanceHeroShader,
  curvesHeroShader,
  liftGammaGainHeroShader,
  filmicTonemapHeroShader,
  selectiveColorHeroShader,
  halftoneHeroShader,
  toonHeroShader,
  kuwaharaHeroShader,
  oilPaintHeroShader,
  watercolorHeroShader,
  blurHeroShader,
  sharpenHeroShader,
  directionalBlurHeroShader,
  zoomBlurHeroShader,
  radialBlurHeroShader,
  tiltShiftHeroShader,
  defocusBokehHeroShader,
  chromaticAberrationHeroShader,
  godRaysHeroShader,
  halationHeroShader,
  anamorphicStreakHeroShader,
  lensDirtHeroShader,
  diffusionPromistHeroShader,
  filmGrainHeroShader,
  heatHazeHeroShader,
  noiseHeroShader,
  crtHeroShader,
  kaleidoscopeHeroShader,
  mirrorHeroShader,
  waveHeroShader,
  fisheyeHeroShader,
  lensDistortionHeroShader,
  chromaKeyHeroShader,
  lumaKeyHeroShader,
  differenceKeyHeroShader,
  erodeHeroShader,
  dilateHeroShader,
  twirlHeroShader,
  pinchBulgeHeroShader,
  displacementHeroShader,
  polarTransformHeroShader,
  compressionArtifactsHeroShader,
  falseColorHeroShader,
  shadowRecoveryHeroShader,
  highlightRolloffHeroShader,
  asciiHeroShader,
  comicInkHeroShader,
  datamoshLiteHeroShader,
  scanlineDriftHeroShader,
  tapeDropoutHeroShader,
  rippleCausticsHeroShader,
  shockwaveHeroShader,
  drosteHeroShader,
  slitScanHeroShader,
  volumetricFogHeroShader,
  rainFogSnowHeroShader,
  particleOverlayHeroShader,
  glintStarburstHeroShader,
  embossRelightHeroShader,
  dotMatrixHeroShader,
  matrixRainHeroShader,
  binaryCodeHeroShader,
  crosshatchHeroShader,
  blockMosaicHeroShader,
  tunnelFlightHeroShader,
  infiniteMirrorHeroShader,
  fractalWarpHeroShader,
  crystalRefractHeroShader,
  fluidDistortHeroShader,
  wormholeHeroShader,
  geometricTileHeroShader,
  motionTrailsHeroShader,
  echoRepeatHeroShader,
  ghostDoubleHeroShader,
  strobeFlashHeroShader,
  lightPaintHeroShader,
  recursiveEchoHeroShader,
  // Batch A: brand-new hero effects
  opticalFlowDatamoshHeroShader,
  flowFieldTrailsHeroShader,
  reactionDiffusionHeroShader,
  neonTubeTraceHeroShader,
  depthParallaxHeroShader,
  pointCloudDissolveHeroShader,
  pixelSandHeroShader,
  liquidGlassHeroShader,
  hologramScanHeroShader,
  laserSliceHeroShader,
  // Batch B: brand-new hero effects
  auraFieldHeroShader,
  smokeDisintegrateHeroShader,
  shimmerClothHeroShader,
  glitchQuiltHeroShader,
  cellularAutomataBurnHeroShader,
  rorschachMirrorHeroShader,
  spectralPrismTunnelHeroShader,
  ledVolumeHeroShader,
  posterTearHeroShader,
  paintPeelHeroShader,
  // Batch C: brand-new hero effects
  audioShockBloomHeroShader,
  vhsFullDeckHeroShader,
  analogFeedbackRackHeroShader,
  clubLaserGridHeroShader,
  mirrorShardsHeroShader,
  ghostExposureHeroShader,
  thermalContourHeroShader,
  dreamDiffusionHeroShader,
  topoWarpHeroShader,
  strobeSequencerHeroShader,
} from './shaders/basic';

import { proPackShader, proEffectModes } from './shaders/pro-pack';
import { premiumPackShader, premiumEffectModes } from './shaders/premium-pack';
import { premiumPack2Shader, premiumPack2Modes } from './shaders/premium-pack2';
import {
  numberGridShader,
  explode3DShader,
  terrain3DShader,
  wrappedTerrainShader,
} from './shaders/premium-standalone';

import {
  stringOrbShader,
  sphereWireframeShader,
  voxelCubeClusterShader,
  mobiusLatticeShader,
  crystalShardFieldShader,
  tubeLatticeShader,
  discoMirrorBallShader,
  lissajousKnotShader,
  helixParticleStreamShader,
  donutConstellationShader,
} from './shaders/geometric-3d';

import {
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
  blur: blurHeroShader,
  sharpen: sharpenHeroShader,
  noise: noiseHeroShader,
  kaleidoscope: kaleidoscopeHeroShader,
  mirror: mirrorHeroShader,
  wave: waveHeroShader,
  fisheye: fisheyeHeroShader,
  thermal: thermalShader,
  nightVision: nightVisionShader,
  // VJ-only simple shaders (4)
  brightness: brightnessShader,
  contrast: contrastShader,
  saturation: saturationShader,
  hue: hueShader,
  // ProPack shader effects (32 modes) — color-grading effects below have
  // been carved out into dedicated hero shaders.
  curves: curvesHeroShader,
  liftGammaGain: liftGammaGainHeroShader,
  exposure: exposureHeroShader,
  gamma: gammaHeroShader,
  temperatureTint: temperatureTintHeroShader,
  vibrance: vibranceHeroShader,
  colorBalance: colorBalanceHeroShader,
  filmGrain: filmGrainHeroShader,
  bloom: bloomHeroShader,
  chromaticAberration: chromaticAberrationHeroShader,
  lensDistortion: lensDistortionHeroShader,
  tiltShift: tiltShiftHeroShader,
  godRays: godRaysHeroShader,
  heatHaze: heatHazeHeroShader,
  directionalBlur: directionalBlurHeroShader,
  zoomBlur: zoomBlurHeroShader,
  radialBlur: radialBlurHeroShader,
  halftone: halftoneHeroShader,
  toon: toonHeroShader,
  kuwahara: kuwaharaHeroShader,
  oilPaint: oilPaintHeroShader,
  watercolor: watercolorHeroShader,
  crt: crtHeroShader,
  compressionArtifacts: compressionArtifactsHeroShader,
  chromaKey: chromaKeyHeroShader,
  lumaKey: lumaKeyHeroShader,
  differenceKey: differenceKeyHeroShader,
  erode: erodeHeroShader,
  dilate: dilateHeroShader,
  displacement: displacementHeroShader,
  twirl: twirlHeroShader,
  pinchBulge: pinchBulgeHeroShader,
  // Premium Pack shader effects (25 unique modes)
  filmicTonemap: filmicTonemapHeroShader,
  selectiveColor: selectiveColorHeroShader,
  falseColor: falseColorHeroShader,
  shadowRecovery: shadowRecoveryHeroShader,
  highlightRolloff: highlightRolloffHeroShader,
  halation: halationHeroShader,
  anamorphicStreak: anamorphicStreakHeroShader,
  lensDirt: lensDirtHeroShader,
  defocusBokeh: defocusBokehHeroShader,
  diffusionPromist: diffusionPromistHeroShader,
  ascii: asciiHeroShader,
  comicInk: comicInkHeroShader,
  // datamoshLite reverted to original premiumPack pixel-sort behavior
  datamoshLite: premiumPackShader,
  scanlineDrift: scanlineDriftHeroShader,
  tapeDropout: tapeDropoutHeroShader,
  polarTransform: polarTransformHeroShader,
  rippleCaustics: rippleCausticsHeroShader,
  shockwave: shockwaveHeroShader,
  drosteRecursive: drosteHeroShader,
  slitScan: slitScanHeroShader,
  volumetricFogOverlay: volumetricFogHeroShader,
  rainFogSnowOverlay: rainFogSnowHeroShader,
  particleOverlayFx: particleOverlayHeroShader,
  glintStarburst: glintStarburstHeroShader,
  embossRelight: embossRelightHeroShader,
  dotMatrix: dotMatrixHeroShader,
  matrixRain: matrixRainHeroShader,
  binaryCode: binaryCodeHeroShader,
  crosshatch: crosshatchHeroShader,
  blockMosaic: blockMosaicHeroShader,
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
  wrappedTerrain: wrappedTerrainShader,
  // Geometric 3D (10)
  stringOrb: stringOrbShader,
  sphereWireframe: sphereWireframeShader,
  voxelCubeCluster: voxelCubeClusterShader,
  mobiusLattice: mobiusLatticeShader,
  crystalShardField: crystalShardFieldShader,
  tubeLattice: tubeLatticeShader,
  discoMirrorBall: discoMirrorBallShader,
  lissajousKnot: lissajousKnotShader,
  helixParticleStream: helixParticleStreamShader,
  donutConstellation: donutConstellationShader,
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
  tunnelFlight: tunnelFlightHeroShader,
  infiniteMirror: infiniteMirrorHeroShader,
  fractalWarp: fractalWarpHeroShader,
  crystalRefract: crystalRefractHeroShader,
  feedbackZoom: feedbackZoomHeroShader,
  fluidDistort: fluidDistortHeroShader,
  wormhole: wormholeHeroShader,
  geometricTile: geometricTileHeroShader,
  motionTrails: motionTrailsHeroShader,
  echoRepeat: echoRepeatHeroShader,
  ghostDouble: ghostDoubleHeroShader,
  strobeFlash: strobeFlashHeroShader,
  lightPaint: lightPaintHeroShader,
  recursiveEcho: recursiveEchoHeroShader,
  // Blob Tracking
  blobTrack: blobTrackShader,
  blobContour: blobContourShader,
  blobHeatmap: blobHeatmapShader,
  // Time-based effects
  timeSmear: timeSmearShader,
  chronophoto: chronoShader,
  // ── New Hero Effects (Batch A) ──
  opticalFlowDatamosh: opticalFlowDatamoshHeroShader,
  flowFieldTrails: flowFieldTrailsHeroShader,
  reactionDiffusion: reactionDiffusionHeroShader,
  neonTubeTrace: neonTubeTraceHeroShader,
  depthParallax: depthParallaxHeroShader,
  pointCloudDissolve: pointCloudDissolveHeroShader,
  pixelSand: pixelSandHeroShader,
  liquidGlass: liquidGlassHeroShader,
  hologramScan: hologramScanHeroShader,
  laserSlice: laserSliceHeroShader,
  // ── New Hero Effects (Batch B) ──
  auraField: auraFieldHeroShader,
  smokeDisintegrate: smokeDisintegrateHeroShader,
  shimmerCloth: shimmerClothHeroShader,
  glitchQuilt: glitchQuiltHeroShader,
  cellularAutomataBurn: cellularAutomataBurnHeroShader,
  rorschachMirror: rorschachMirrorHeroShader,
  spectralPrismTunnel: spectralPrismTunnelHeroShader,
  ledVolume: ledVolumeHeroShader,
  posterTear: posterTearHeroShader,
  paintPeel: paintPeelHeroShader,
  // ── New Hero Effects (Batch C) ──
  audioShockBloom: audioShockBloomHeroShader,
  vhsFullDeck: vhsFullDeckHeroShader,
  analogFeedbackRack: analogFeedbackRackHeroShader,
  clubLaserGrid: clubLaserGridHeroShader,
  mirrorShards: mirrorShardsHeroShader,
  ghostExposure: ghostExposureHeroShader,
  thermalContour: thermalContourHeroShader,
  dreamDiffusion: dreamDiffusionHeroShader,
  topoWarp: topoWarpHeroShader,
  strobeSequencer: strobeSequencerHeroShader,
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
      // Hero rewrite — shape modes, center, color tint, breathing.
      uniforms.uSize = { value: 0.8 };
      uniforms.uSoftness = { value: 0.4 };
      uniforms.uRoundness = { value: 0.5 };
      uniforms.uShape = { value: 0 };
      uniforms.uAspect = { value: 1.0 };
      uniforms.uCenterX = { value: 0.5 };
      uniforms.uCenterY = { value: 0.5 };
      uniforms.uColorR = { value: 0 };
      uniforms.uColorG = { value: 0 };
      uniforms.uColorB = { value: 0 };
      uniforms.uTintAmount = { value: 0 };
      uniforms.uBreathing = { value: 0 };
      uniforms.uBreathSpeed = { value: 0.5 };
      break;

    case 'edgeFeather':
      // Hero rewrite — gamma curve + matte preview.
      uniforms.uTop = { value: 0 };
      uniforms.uBottom = { value: 0 };
      uniforms.uLeft = { value: 0 };
      uniforms.uRight = { value: 0 };
      uniforms.uSoftness = { value: 0.5 };
      uniforms.uGamma = { value: 1.0 };
      uniforms.uMattePreview = { value: 0 };
      break;

    case 'colorama':
      // Hero rewrite: 12 named palettes, posterize bands, audio reactivity,
      // hue shift. uAudio is set per-frame by the renderer from the audio
      // store (see updateEffectUniforms below).
      uniforms.uPalette = { value: 0 };
      uniforms.uOffset = { value: 0 };
      uniforms.uSpeed = { value: 0.2 };
      uniforms.uContrast = { value: 1 };
      uniforms.uMix = { value: 1 };
      uniforms.uBands = { value: 0 };
      uniforms.uAudioReact = { value: 0 };
      uniforms.uHueShift = { value: 0 };
      uniforms.uAudio = { value: 0 };
      break;

    case 'dither':
      // Hero — palette lock + pixel-lock added.
      uniforms.uType = { value: 0 };
      uniforms.uIntensity = { value: 1.0 };
      uniforms.uScale = { value: 1 };
      uniforms.uColorDepth = { value: 2 };
      uniforms.uPalette = { value: 0 };
      uniforms.uPixelLock = { value: 0 };
      break;

    case 'vhs':
      uniforms.uTracking = { value: 0.5 };
      uniforms.uNoise = { value: 0.3 };
      uniforms.uDistortion = { value: 0.3 };
      uniforms.uColorBleed = { value: 0.5 };
      uniforms.uScanlines = { value: 0.3 };
      uniforms.uHeadSwitch = { value: 0 };
      uniforms.uTapeWobble = { value: 0 };
      uniforms.uDropout = { value: 0 };
      uniforms.uChromaDelay = { value: 0 };
      uniforms.uTrackingJump = { value: 0 };
      uniforms.uSaturation = { value: 1 };
      break;

    case 'glitch':
      uniforms.uIntensity = { value: 0.5 };
      uniforms.uSpeed = { value: 1 };
      uniforms.uBlockSize = { value: 0.3 };
      uniforms.uRGBSplit = { value: 0.5 };
      uniforms.uJitter = { value: 0.3 };
      uniforms.uTriggerMode = { value: 0 };
      uniforms.uBlockHold = { value: 0.3 };
      uniforms.uVerticalSlice = { value: 0 };
      uniforms.uFreezeBurst = { value: 0 };
      uniforms.uTearChance = { value: 0 };
      uniforms.uAudio = { value: 0 };
      break;

    case 'rgbShift':
      // Hero — directional/radial/prism/luma/edge modes + center picker.
      uniforms.uAmount = { value: 5 };
      uniforms.uAngle = { value: 0 };
      uniforms.uMode = { value: 0 };
      uniforms.uCenterX = { value: 0.5 };
      uniforms.uCenterY = { value: 0.5 };
      uniforms.uPrismSpread = { value: 0 };
      break;

    case 'scanlines':
      // Hero — phosphor mask + rolling bar + curvature + interlace.
      uniforms.uIntensity = { value: 0.5 };
      uniforms.uCount = { value: 200 };
      uniforms.uSpeed = { value: 0 };
      uniforms.uPhosphor = { value: 0 };
      uniforms.uRollingBar = { value: 0 };
      uniforms.uCurvature = { value: 0 };
      uniforms.uInterlace = { value: 0 };
      break;

    case 'pixelate':
      // Hero — modes + grid lines + animated size.
      uniforms.uSize = { value: 8 };
      uniforms.uMode = { value: 0 };
      uniforms.uGridLines = { value: 0 };
      uniforms.uAnimSpeed = { value: 0 };
      uniforms.uAnimAmount = { value: 0 };
      break;

    case 'blur':
      // Hero — modes (box/gaussian/motion/bilateral) + quality + edge protect.
      uniforms.uRadius = { value: 5 };
      uniforms.uMode = { value: 1 };
      uniforms.uAngle = { value: 0 };
      uniforms.uQuality = { value: 1 };
      uniforms.uEdgeProtect = { value: 0.3 };
      uniforms.uMix = { value: 1 };
      break;

    case 'sharpen':
      // Hero — laplacian/unsharp + radius + edge protect + clarity.
      uniforms.uAmount = { value: 0.5 };
      uniforms.uMode = { value: 0 };
      uniforms.uRadius = { value: 2 };
      uniforms.uEdgeProtect = { value: 0.2 };
      uniforms.uClarity = { value: 0 };
      break;

    case 'directionalBlur':
      // Hero — angle + samples + falloff + center bias + mix.
      uniforms.uAmount = { value: 0.25 };
      uniforms.uAngle = { value: 0 };
      uniforms.uSamples = { value: 16 };
      uniforms.uFalloff = { value: 0.3 };
      uniforms.uCenterBias = { value: 0 };
      uniforms.uMix = { value: 1 };
      break;

    case 'zoomBlur':
      // Hero — center + samples + chromatic split + mix.
      uniforms.uAmount = { value: 0.25 };
      uniforms.uCenterX = { value: 0.5 };
      uniforms.uCenterY = { value: 0.5 };
      uniforms.uSamples = { value: 16 };
      uniforms.uFalloff = { value: 0.3 };
      uniforms.uChromatic = { value: 0 };
      uniforms.uMix = { value: 1 };
      break;

    case 'radialBlur':
      // Hero — spin + center + samples + radius mask.
      uniforms.uAmount = { value: 0.25 };
      uniforms.uCenterX = { value: 0.5 };
      uniforms.uCenterY = { value: 0.5 };
      uniforms.uSamples = { value: 16 };
      uniforms.uFalloff = { value: 0.3 };
      uniforms.uRadiusInner = { value: 0 };
      uniforms.uRadiusOuter = { value: 0.7 };
      uniforms.uMix = { value: 1 };
      break;

    case 'oilPaint':
      // Hero — bristle painterly with directional brush.
      uniforms.uRadius = { value: 4 };
      uniforms.uIntensity = { value: 12 };
      uniforms.uBrushLength = { value: 0.6 };
      uniforms.uBristle = { value: 0.4 };
      uniforms.uColorPunch = { value: 0.3 };
      uniforms.uHighlight = { value: 0.2 };
      uniforms.uMode = { value: 0 };
      break;

    case 'watercolor':
      // Hero — pigment bleed + edge darken + paper texture.
      uniforms.uBleed = { value: 0.5 };
      uniforms.uEdgeDarken = { value: 0.5 };
      uniforms.uPaperTexture = { value: 0.4 };
      uniforms.uPaperScale = { value: 8 };
      uniforms.uWetness = { value: 0.3 };
      uniforms.uGranulation = { value: 0.2 };
      uniforms.uPaperHue = { value: 0 };
      break;

    case 'noise':
      // Hero — multi-type generator + tonal weighting + blend modes.
      uniforms.uAmount = { value: 0.2 };
      uniforms.uType = { value: 0 };
      uniforms.uMode = { value: 0 };
      uniforms.uScale = { value: 1 };
      uniforms.uMono = { value: 0 };
      uniforms.uShadowAmt = { value: 1 };
      uniforms.uMidAmt = { value: 1 };
      uniforms.uHighAmt = { value: 1 };
      uniforms.uAnimSpeed = { value: 1 };
      break;

    case 'kaleidoscope':
      // Hero — segments + center pick + zoom + spiral + auto-rotate.
      uniforms.uSegments = { value: 6 };
      uniforms.uAngle = { value: 0 };
      uniforms.uCenterX = { value: 0.5 };
      uniforms.uCenterY = { value: 0.5 };
      uniforms.uZoom = { value: 1 };
      uniforms.uMode = { value: 0 };
      uniforms.uSpiralAmount = { value: 0 };
      uniforms.uAnimSpeed = { value: 0 };
      uniforms.uMix = { value: 1 };
      break;

    case 'mirror':
      // Hero — modes (h/v/quad/diag) + position + offset + flip side.
      uniforms.uMode = { value: 0 };
      uniforms.uPosition = { value: 0.5 };
      uniforms.uOffset = { value: 0.5 };
      uniforms.uFlipSide = { value: 0 };
      uniforms.uMix = { value: 1 };
      break;

    case 'plasma':
      uniforms.uSpeed = { value: 1 };
      uniforms.uScale = { value: 5 };
      uniforms.uComplexity = { value: 3 };
      uniforms.uPalette = { value: 0 };
      uniforms.uMode = { value: 0 };
      uniforms.uBlendMode = { value: 0 };
      uniforms.uMix = { value: 1 };
      uniforms.uWarpAmount = { value: 0.4 };
      uniforms.uAudioReact = { value: 0 };
      uniforms.uAudio = { value: 0 };
      break;

    case 'posterize':
      // Hero rewrite — Bayer dither pairing, animated stepping, palette lock.
      uniforms.uLevels = { value: 8 };
      uniforms.uDitherAmount = { value: 0 };
      uniforms.uAnimSpeed = { value: 0 };
      uniforms.uPaletteLock = { value: 0 };
      break;

    case 'edgeDetect':
      // Hero — adds color-edge mode, edge tint, glow, edge-only alpha.
      uniforms.uThreshold = { value: 0.1 };
      uniforms.uThickness = { value: 1 };
      uniforms.uMode = { value: 0 };
      uniforms.uInvert = { value: 0 };
      uniforms.uEdgeR = { value: 0 };
      uniforms.uEdgeG = { value: 1 };
      uniforms.uEdgeB = { value: 1 };
      uniforms.uTintEdges = { value: 0 };
      uniforms.uGlow = { value: 0 };
      uniforms.uEdgeOnly = { value: 0 };
      break;

    case 'outline':
      // Hero — inner/outer/both, animated crawl, glow falloff, alpha-aware.
      uniforms.uThickness = { value: 2 };
      uniforms.uColor = { value: new THREE.Vector3(1, 1, 1) };
      uniforms.uOnly = { value: 0 };
      uniforms.uGlow = { value: 0 };
      uniforms.uPosition = { value: 2 };
      uniforms.uCrawl = { value: 0 };
      uniforms.uGlowFalloff = { value: 1.5 };
      uniforms.uAlphaAware = { value: 0 };
      break;

    case 'emboss':
      // Hero — relight + colored hi/lo + normal-map preview + metallic.
      uniforms.uStrength = { value: 1 };
      uniforms.uAngle = { value: 135 };
      uniforms.uHeight = { value: 0.5 };
      uniforms.uHighlightR = { value: 1 };
      uniforms.uHighlightG = { value: 1 };
      uniforms.uHighlightB = { value: 1 };
      uniforms.uShadowR = { value: 0 };
      uniforms.uShadowG = { value: 0 };
      uniforms.uShadowB = { value: 0 };
      uniforms.uNormalMode = { value: 0 };
      uniforms.uMetallicness = { value: 0 };
      break;

    case 'wave':
      // Hero — multi-type, multi-waveform, secondary harmonic, RGB phase.
      uniforms.uAmplitude = { value: 10 };
      uniforms.uFrequency = { value: 5 };
      uniforms.uSpeed = { value: 1 };
      uniforms.uType = { value: 0 };
      uniforms.uWaveform = { value: 0 };
      uniforms.uPhase = { value: 0 };
      uniforms.uSecondaryAmt = { value: 0 };
      uniforms.uChromaSplit = { value: 0 };
      break;

    case 'fisheye':
      // Hero — center + zoom + mode + chromatic edge.
      uniforms.uStrength = { value: 0.5 };
      uniforms.uRadius = { value: 1 };
      uniforms.uCenterX = { value: 0.5 };
      uniforms.uCenterY = { value: 0.5 };
      uniforms.uZoom = { value: 1 };
      uniforms.uMode = { value: 0 };
      uniforms.uChromaEdge = { value: 0 };
      break;

    case 'crt':
      // Hero — phosphor mask + scanlines + curvature + glow + rolling bar.
      uniforms.uScanlines = { value: 0.5 };
      uniforms.uScanCount = { value: 480 };
      uniforms.uMask = { value: 0.5 };
      uniforms.uMaskType = { value: 0 };
      uniforms.uCurvature = { value: 0.3 };
      uniforms.uVignette = { value: 0.4 };
      uniforms.uGlow = { value: 0.5 };
      uniforms.uRollingBar = { value: 0 };
      uniforms.uChromatic = { value: 0.3 };
      break;

    case 'lensDistortion':
      // Hero — multi-mode lens warp.
      uniforms.uAmount = { value: 0.4 };
      uniforms.uMode = { value: 0 };
      uniforms.uCenterX = { value: 0.5 };
      uniforms.uCenterY = { value: 0.5 };
      uniforms.uCubic = { value: 0 };
      uniforms.uAnamorphicX = { value: 1.3 };
      uniforms.uEdgeFade = { value: 1 };
      uniforms.uChromaFringe = { value: 0 };
      break;

    case 'chromaKey':
      // Hero — green/blue screen with hue band + soft + spill suppress.
      uniforms.uKeyR = { value: 0 };
      uniforms.uKeyG = { value: 1 };
      uniforms.uKeyB = { value: 0 };
      uniforms.uTolerance = { value: 0.25 };
      uniforms.uSoftness = { value: 0.15 };
      uniforms.uSpillSuppress = { value: 0.6 };
      uniforms.uMatte = { value: 0 };
      uniforms.uMode = { value: 1 };
      break;

    case 'lumaKey':
      // Hero — brightness key with low/high cut + invert + gamma.
      uniforms.uLowCut = { value: 0.4 };
      uniforms.uHighCut = { value: 0.6 };
      uniforms.uInvert = { value: 0 };
      uniforms.uGamma = { value: 1 };
      uniforms.uMatte = { value: 0 };
      uniforms.uPremultiply = { value: 0 };
      break;

    case 'differenceKey':
      // Hero — key based on difference from a reference colour.
      uniforms.uRefR = { value: 0 };
      uniforms.uRefG = { value: 0 };
      uniforms.uRefB = { value: 0 };
      uniforms.uTolerance = { value: 0.3 };
      uniforms.uSoftness = { value: 0.15 };
      uniforms.uInvert = { value: 0 };
      uniforms.uMatte = { value: 0 };
      uniforms.uMode = { value: 0 };
      break;

    case 'thermal':
      // Hero rewrite — 5 palettes + heat shimmer + sensor noise.
      uniforms.uIntensity = { value: 1 };
      uniforms.uPalette = { value: 0 };
      uniforms.uShimmer = { value: 0 };
      uniforms.uSensorNoise = { value: 0 };
      break;

    case 'nightVision':
      // Hero rewrite — phosphor color + bloom + scope mask + rolling noise.
      uniforms.uIntensity = { value: 1.5 };
      uniforms.uNoise = { value: 0.3 };
      uniforms.uVignette = { value: 0.5 };
      uniforms.uPhosphor = { value: 0 };
      uniforms.uBloom = { value: 0.6 };
      uniforms.uScopeMask = { value: 1 };
      uniforms.uRollingNoise = { value: 0 };
      break;

    case 'brightness':
    case 'contrast':
    case 'saturation':
      uniforms.uAmount = { value: 0 };
      break;

    case 'hue':
      uniforms.uAmount = { value: 0 };
      break;

    case 'exposure':
      // Hero rewrite — dedicated shader. Photographic stops, roll-off,
      // and highlight protect.
      uniforms.uExposure = { value: 0 };
      uniforms.uRollOff = { value: 0 };
      uniforms.uHighlightProtect = { value: 0 };
      break;

    case 'gamma':
      // Hero rewrite — three-zone gamma split (shadows / mids / highlights).
      uniforms.uShadows = { value: 1 };
      uniforms.uMids = { value: 1 };
      uniforms.uHighlights = { value: 1 };
      uniforms.uMix = { value: 1 };
      break;

    case 'vibrance':
      // Hero rewrite — skin/highlight protect + ceiling.
      uniforms.uVibrance = { value: 0.3 };
      uniforms.uSkinProtect = { value: 0.5 };
      uniforms.uHighlightProtect = { value: 0.3 };
      uniforms.uCeiling = { value: 1 };
      break;

    case 'temperatureTint':
      // Hero rewrite — kelvin temp + tint + split-tone + auto cycle.
      uniforms.uTemperature = { value: 0 };
      uniforms.uTint = { value: 0 };
      uniforms.uShadowTemp = { value: 0 };
      uniforms.uHighlightTemp = { value: 0 };
      uniforms.uSplitTone = { value: 0 };
      uniforms.uAutoCycle = { value: 0 };
      break;

    case 'colorBalance':
      // Hero rewrite — three-zone RGB balance.
      uniforms.uShadowR = { value: 0 }; uniforms.uShadowG = { value: 0 }; uniforms.uShadowB = { value: 0 };
      uniforms.uMidR = { value: 0 };    uniforms.uMidG = { value: 0 };    uniforms.uMidB = { value: 0 };
      uniforms.uHighR = { value: 0 };   uniforms.uHighG = { value: 0 };   uniforms.uHighB = { value: 0 };
      uniforms.uPreserveLuma = { value: 1 };
      uniforms.uMix = { value: 1 };
      break;

    case 'curves':
      // Hero rewrite — S-curve + toe + shoulder + black crush.
      uniforms.uContrast = { value: 0.4 };
      uniforms.uToe = { value: 0 };
      uniforms.uShoulder = { value: 0 };
      uniforms.uBlackCrush = { value: 0 };
      uniforms.uMix = { value: 1 };
      break;

    case 'liftGammaGain':
      // Hero rewrite — three-zone color wheels (R/G/B per zone).
      uniforms.uLiftR = { value: 0 };  uniforms.uLiftG = { value: 0 };  uniforms.uLiftB = { value: 0 };
      uniforms.uGammaR = { value: 1 }; uniforms.uGammaG = { value: 1 }; uniforms.uGammaB = { value: 1 };
      uniforms.uGainR = { value: 1 };  uniforms.uGainG = { value: 1 };  uniforms.uGainB = { value: 1 };
      uniforms.uLumaOnly = { value: 0 };
      uniforms.uMix = { value: 1 };
      break;

    case 'filmicTonemap':
      // Hero rewrite — multi-curve selector with exposure pre-gain.
      uniforms.uCurve = { value: 0 };       // 0=ACES
      uniforms.uExposure = { value: 1.0 };
      uniforms.uContrast = { value: 0 };
      uniforms.uMix = { value: 1 };
      break;

    case 'selectiveColor':
      // Hero rewrite — hue target + isolate/replace mode.
      uniforms.uTargetHue = { value: 0 };   // red
      uniforms.uHueRange = { value: 0.1 };
      uniforms.uFeather = { value: 0.1 };
      uniforms.uMode = { value: 0 };        // isolate
      uniforms.uReplaceHue = { value: 0.33 };
      uniforms.uSatBoost = { value: 0 };
      break;

    case 'halftone':
      // Hero — CMYK separation, dot shape/angle, animated drift, spot color.
      uniforms.uDotSize = { value: 6 };
      uniforms.uDotShape = { value: 0 };
      uniforms.uAngleC = { value: 15 };
      uniforms.uAngleM = { value: 75 };
      uniforms.uAngleY = { value: 0 };
      uniforms.uAngleK = { value: 45 };
      uniforms.uMode = { value: 0 };
      uniforms.uDriftSpeed = { value: 0 };
      uniforms.uSpotColor = { value: new THREE.Vector3(0, 0, 0) };
      break;

    case 'toon':
      // Hero — color quantization + outlines + shadow band + ramp softness.
      uniforms.uSteps = { value: 4 };
      uniforms.uOutline = { value: 0.6 };
      uniforms.uOutlineColor = { value: 0 };
      uniforms.uShadowBand = { value: 0.3 };
      uniforms.uRampSoftness = { value: 0 };
      uniforms.uColorPop = { value: 0.3 };
      break;

    case 'kuwahara':
      // Hero — painterly oil-paint smoothing.
      uniforms.uRadius = { value: 3 };
      uniforms.uEdgeSharpness = { value: 0.3 };
      uniforms.uColorPunch = { value: 0.2 };
      break;

    case 'tiltShift':
      // Hero — focus band + smooth blur falloff with multiple modes.
      uniforms.uMode = { value: 0 };
      uniforms.uFocusY = { value: 0.5 };
      uniforms.uFocusX = { value: 0.5 };
      uniforms.uFocusBand = { value: 0.2 };
      uniforms.uFalloff = { value: 0.3 };
      uniforms.uMaxBlur = { value: 0.5 };
      uniforms.uAngle = { value: 0 };
      uniforms.uSaturation = { value: 1.2 };
      break;

    case 'defocusBokeh':
      // Hero — disc-kernel bokeh with chroma fringe + bright weight.
      uniforms.uRadius = { value: 12 };
      uniforms.uSamples = { value: 24 };
      uniforms.uBrightWeight = { value: 0.8 };
      uniforms.uThreshold = { value: 0.7 };
      uniforms.uChromaFringe = { value: 0 };
      uniforms.uShape = { value: 0 };
      uniforms.uRotation = { value: 0 };
      uniforms.uMix = { value: 1 };
      break;

    case 'chromaticAberration':
      // Hero — linear/radial/lens/prism modes.
      uniforms.uAmount = { value: 0.4 };
      uniforms.uMode = { value: 1 };
      uniforms.uAngle = { value: 0 };
      uniforms.uCenterX = { value: 0.5 };
      uniforms.uCenterY = { value: 0.5 };
      uniforms.uEdgeFalloff = { value: 0.5 };
      uniforms.uMix = { value: 1 };
      break;

    case 'godRays':
      // Hero — radial light shafts with samples + decay + tint.
      uniforms.uIntensity = { value: 0.7 };
      uniforms.uDecay = { value: 0.95 };
      uniforms.uExposure = { value: 0.4 };
      uniforms.uDensity = { value: 0.95 };
      uniforms.uThreshold = { value: 0.7 };
      uniforms.uCenterX = { value: 0.5 };
      uniforms.uCenterY = { value: 0.2 };
      uniforms.uSamples = { value: 64 };
      uniforms.uTintR = { value: 1 };
      uniforms.uTintG = { value: 0.95 };
      uniforms.uTintB = { value: 0.85 };
      uniforms.uMix = { value: 1 };
      break;

    case 'halation':
      // Hero — warm bleed around bright areas (film print).
      uniforms.uAmount = { value: 0.6 };
      uniforms.uRadius = { value: 12 };
      uniforms.uThreshold = { value: 0.65 };
      uniforms.uTintR = { value: 0.9 };
      uniforms.uTintG = { value: 0.45 };
      uniforms.uTintB = { value: 0.2 };
      uniforms.uMode = { value: 0 };
      uniforms.uMix = { value: 1 };
      break;

    case 'anamorphicStreak':
      // Hero — horizontal lens flare streaks.
      uniforms.uIntensity = { value: 0.6 };
      uniforms.uLength = { value: 0.5 };
      uniforms.uThreshold = { value: 0.7 };
      uniforms.uTintR = { value: 0.6 };
      uniforms.uTintG = { value: 0.75 };
      uniforms.uTintB = { value: 1 };
      uniforms.uAngle = { value: 0 };
      uniforms.uSamples = { value: 32 };
      uniforms.uMix = { value: 1 };
      break;

    case 'lensDirt':
      // Hero — dust/scratch overlay on bright areas.
      uniforms.uAmount = { value: 0.5 };
      uniforms.uScale = { value: 8 };
      uniforms.uThreshold = { value: 0.6 };
      uniforms.uTintWarmth = { value: 0.4 };
      uniforms.uScratches = { value: 0.2 };
      uniforms.uSpots = { value: 0.6 };
      uniforms.uMode = { value: 0 };
      uniforms.uAnimSpeed = { value: 0 };
      break;

    case 'diffusionPromist':
      // Hero — soft diffusion + glow on highlights.
      uniforms.uAmount = { value: 0.5 };
      uniforms.uRadius = { value: 12 };
      uniforms.uThreshold = { value: 0.6 };
      uniforms.uShadowLift = { value: 0.3 };
      uniforms.uHighlightBloom = { value: 0.5 };
      uniforms.uHaze = { value: 0.3 };
      uniforms.uHazeWarmth = { value: 0.5 };
      uniforms.uMix = { value: 1 };
      break;

    case 'filmGrain':
      // Hero — multi-stock grain with tonal response.
      uniforms.uAmount = { value: 0.3 };
      uniforms.uSize = { value: 1 };
      uniforms.uShadowGrain = { value: 0.7 };
      uniforms.uMidGrain = { value: 1 };
      uniforms.uHighGrain = { value: 0.5 };
      uniforms.uMono = { value: 0 };
      uniforms.uStock = { value: 1 };
      uniforms.uColorJitter = { value: 0 };
      uniforms.uAnimSpeed = { value: 1 };
      break;

    case 'heatHaze':
      // Hero — animated displacement with directional bias.
      uniforms.uAmount = { value: 0.4 };
      uniforms.uScale = { value: 8 };
      uniforms.uSpeed = { value: 1 };
      uniforms.uDirectionY = { value: 0.5 };
      uniforms.uTurbulence = { value: 0.5 };
      uniforms.uMode = { value: 0 };
      uniforms.uFocusY = { value: 0.5 };
      uniforms.uFocusBand = { value: 0.4 };
      break;

    case 'compressionArtifacts':
      // Hero — block DCT + chroma subsample + banding.
      uniforms.uBlockSize = { value: 8 };
      uniforms.uQuality = { value: 0.4 };
      uniforms.uChromaSubsample = { value: 0.6 };
      uniforms.uBlockNoise = { value: 0.2 };
      uniforms.uMode = { value: 0 };
      uniforms.uMix = { value: 1 };
      break;

    case 'erode':
      // Hero — morphological min filter.
      uniforms.uRadius = { value: 2 };
      uniforms.uShape = { value: 1 };
      uniforms.uChannel = { value: 0 };
      uniforms.uMix = { value: 1 };
      break;

    case 'dilate':
      // Hero — morphological max filter.
      uniforms.uRadius = { value: 2 };
      uniforms.uShape = { value: 1 };
      uniforms.uChannel = { value: 0 };
      uniforms.uMix = { value: 1 };
      break;

    case 'displacement':
      // Hero — procedural noise-driven displacement.
      uniforms.uAmount = { value: 0.4 };
      uniforms.uScale = { value: 6 };
      uniforms.uSpeed = { value: 1 };
      uniforms.uMode = { value: 0 };
      uniforms.uTurbulence = { value: 0.5 };
      uniforms.uChromatic = { value: 0 };
      break;

    case 'twirl':
      // Hero — spiral warp with falloff + animated.
      uniforms.uAngle = { value: 1.5 };
      uniforms.uRadius = { value: 0.5 };
      uniforms.uCenterX = { value: 0.5 };
      uniforms.uCenterY = { value: 0.5 };
      uniforms.uFalloff = { value: 1.5 };
      uniforms.uAnimSpeed = { value: 0 };
      uniforms.uMix = { value: 1 };
      break;

    case 'pinchBulge':
      // Hero — pinch/bulge with chromatic.
      uniforms.uAmount = { value: 0.4 };
      uniforms.uRadius = { value: 0.5 };
      uniforms.uCenterX = { value: 0.5 };
      uniforms.uCenterY = { value: 0.5 };
      uniforms.uFalloff = { value: 1.5 };
      uniforms.uChromatic = { value: 0 };
      uniforms.uMix = { value: 1 };
      break;

    case 'polarTransform':
      // Hero — polar/cartesian conversion.
      uniforms.uMode = { value: 0 };
      uniforms.uRotation = { value: 0 };
      uniforms.uZoom = { value: 1 };
      uniforms.uCenterX = { value: 0.5 };
      uniforms.uCenterY = { value: 0.5 };
      uniforms.uMix = { value: 1 };
      break;

    case 'falseColor':
      // Hero — exposure / zone false colour.
      uniforms.uMode = { value: 0 };
      uniforms.uMix = { value: 1 };
      uniforms.uShowOriginal = { value: 1 };
      uniforms.uMidpoint = { value: 0.5 };
      uniforms.uRange = { value: 0 };
      break;

    case 'shadowRecovery':
      // Hero — lift shadows without crushing highlights.
      uniforms.uAmount = { value: 0.5 };
      uniforms.uThreshold = { value: 0.4 };
      uniforms.uSoftness = { value: 0.3 };
      uniforms.uColorRecovery = { value: 0.3 };
      uniforms.uHighlightProtect = { value: 0.6 };
      uniforms.uMix = { value: 1 };
      break;

    case 'highlightRolloff':
      // Hero — soft compression of highlights.
      uniforms.uAmount = { value: 0.5 };
      uniforms.uThreshold = { value: 0.7 };
      uniforms.uSoftness = { value: 0.2 };
      uniforms.uPreserveHue = { value: 0.5 };
      uniforms.uMaxValue = { value: 1 };
      uniforms.uMix = { value: 1 };
      break;

    case 'bloom':
      uniforms.uAmount = { value: 0.6 };
      uniforms.uIntensity = { value: 1.0 };
      uniforms.uThreshold = { value: 0.6 };
      uniforms.uKnee = { value: 0.4 };
      uniforms.uRadius = { value: 0.5 };
      uniforms.uAnamorphic = { value: 0 };
      uniforms.uTintR = { value: 1 };
      uniforms.uTintG = { value: 1 };
      uniforms.uTintB = { value: 1 };
      break;

    case 'ascii':
      uniforms.uCellSize = { value: 12 };
      uniforms.uContrast = { value: 1.2 };
      uniforms.uColorMix = { value: 0.3 };
      uniforms.uMode = { value: 0 };
      uniforms.uInvert = { value: 0 };
      uniforms.uTintR = { value: 0 };
      uniforms.uTintG = { value: 1 };
      uniforms.uTintB = { value: 0.4 };
      break;

    case 'comicInk':
      uniforms.uInkStrength = { value: 1.2 };
      uniforms.uInkThreshold = { value: 0.3 };
      uniforms.uPosterize = { value: 5 };
      uniforms.uHalftoneShadow = { value: 0.4 };
      uniforms.uHalftoneSize = { value: 6 };
      uniforms.uColorMix = { value: 0.3 };
      uniforms.uInkR = { value: 0 };
      uniforms.uInkG = { value: 0 };
      uniforms.uInkB = { value: 0 };
      break;

    case 'datamoshLite':
      // Reverted: original premiumPack pixel-sort by luma bands (mode 12).
      uniforms.uMode = { value: premiumEffectModes['datamoshLite'] ?? 12 };
      uniforms.uAmount = { value: 0.5 };
      uniforms.uAmount2 = { value: 0.3 };
      uniforms.uAmount3 = { value: 0.4 };
      uniforms.uThreshold = { value: 0.5 };
      uniforms.uAngle = { value: 0 };
      uniforms.uCenter = { value: new THREE.Vector2(0.5, 0.5) };
      uniforms.uColor = { value: new THREE.Vector3(0.5, 0.5, 0.5) };
      break;

    case 'scanlineDrift':
      uniforms.uIntensity = { value: 0.5 };
      uniforms.uFrequency = { value: 80 };
      uniforms.uSpeed = { value: 1 };
      uniforms.uWaveform = { value: 0 };
      uniforms.uChromaSplit = { value: 0.3 };
      uniforms.uChunkiness = { value: 0 };
      break;

    case 'tapeDropout':
      uniforms.uDensity = { value: 0.4 };
      uniforms.uLength = { value: 0.5 };
      uniforms.uColor = { value: 0 };
      uniforms.uSpeed = { value: 1 };
      uniforms.uNoiseAmp = { value: 0.7 };
      uniforms.uMix = { value: 1 };
      break;

    case 'rippleCaustics':
      uniforms.uIntensity = { value: 0.6 };
      uniforms.uScale = { value: 8 };
      uniforms.uSpeed = { value: 0.6 };
      uniforms.uRefraction = { value: 0.4 };
      uniforms.uTintR = { value: 0.6 };
      uniforms.uTintG = { value: 0.85 };
      uniforms.uTintB = { value: 1 };
      uniforms.uMode = { value: 0 };
      break;

    case 'shockwave':
      uniforms.uTriggerTime = { value: 0 };
      uniforms.uSpeed = { value: 0.6 };
      uniforms.uAmplitude = { value: 0.06 };
      uniforms.uRingWidth = { value: 0.15 };
      uniforms.uCenterX = { value: 0.5 };
      uniforms.uCenterY = { value: 0.5 };
      uniforms.uChromatic = { value: 0.3 };
      uniforms.uMode = { value: 0 };
      break;

    case 'drosteRecursive':
      uniforms.uZoom = { value: 1.5 };
      uniforms.uRotation = { value: 5 };
      uniforms.uIterations = { value: 6 };
      uniforms.uOffsetX = { value: 0.5 };
      uniforms.uOffsetY = { value: 0.5 };
      uniforms.uFrameSize = { value: 0.4 };
      uniforms.uMix = { value: 1 };
      break;

    case 'slitScan':
      uniforms.uIntensity = { value: 0.5 };
      uniforms.uMode = { value: 0 };
      uniforms.uPattern = { value: 0 };
      uniforms.uSpeed = { value: 1 };
      uniforms.uChromaSplit = { value: 0 };
      break;

    case 'volumetricFogOverlay':
      uniforms.uDensity = { value: 0.5 };
      uniforms.uScale = { value: 6 };
      uniforms.uSpeed = { value: 0.5 };
      uniforms.uHeightFalloff = { value: -0.3 };
      uniforms.uDepthSim = { value: 0.5 };
      uniforms.uColorR = { value: 0.85 };
      uniforms.uColorG = { value: 0.9 };
      uniforms.uColorB = { value: 0.95 };
      uniforms.uTurbulence = { value: 1 };
      uniforms.uMode = { value: 1 };
      break;

    case 'rainFogSnowOverlay':
      uniforms.uType = { value: 0 };
      uniforms.uDensity = { value: 0.5 };
      uniforms.uSpeed = { value: 1 };
      uniforms.uAngle = { value: 10 };
      uniforms.uSize = { value: 1 };
      uniforms.uFogAmount = { value: 0.2 };
      uniforms.uColorR = { value: 0.85 };
      uniforms.uColorG = { value: 0.9 };
      uniforms.uColorB = { value: 1 };
      break;

    case 'particleOverlayFx':
      uniforms.uMode = { value: 0 };
      uniforms.uDensity = { value: 0.4 };
      uniforms.uSize = { value: 1 };
      uniforms.uSpeed = { value: 1 };
      uniforms.uTwinkle = { value: 0.5 };
      uniforms.uColorR = { value: 1 };
      uniforms.uColorG = { value: 1 };
      uniforms.uColorB = { value: 0.9 };
      uniforms.uBlend = { value: 0 };
      break;

    case 'glintStarburst':
      uniforms.uIntensity = { value: 0.7 };
      uniforms.uThreshold = { value: 0.75 };
      uniforms.uLength = { value: 0.4 };
      uniforms.uPoints = { value: 4 };
      uniforms.uRotation = { value: 0 };
      uniforms.uColorR = { value: 1 };
      uniforms.uColorG = { value: 0.95 };
      uniforms.uColorB = { value: 0.85 };
      break;

    case 'embossRelight':
      uniforms.uStrength = { value: 1 };
      uniforms.uAngle = { value: 135 };
      uniforms.uHeight = { value: 1 };
      uniforms.uDetail = { value: 1 };
      uniforms.uSpecular = { value: 0.3 };
      uniforms.uColorPreserve = { value: 0.5 };
      uniforms.uAmbient = { value: 0.3 };
      break;

    case 'dotMatrix':
      uniforms.uDotSize = { value: 12 };
      uniforms.uDotShape = { value: 0 };
      uniforms.uGap = { value: 0.2 };
      uniforms.uPosterize = { value: 4 };
      uniforms.uGlow = { value: 0.4 };
      uniforms.uBgR = { value: 0 };
      uniforms.uBgG = { value: 0 };
      uniforms.uBgB = { value: 0 };
      break;

    case 'matrixRain':
      uniforms.uDensity = { value: 0.6 };
      uniforms.uSpeed = { value: 1 };
      uniforms.uCellSize = { value: 14 };
      uniforms.uTrailLength = { value: 0.5 };
      uniforms.uColorR = { value: 0 };
      uniforms.uColorG = { value: 1 };
      uniforms.uColorB = { value: 0.4 };
      uniforms.uBgMix = { value: 0.5 };
      break;

    case 'binaryCode':
      uniforms.uDensity = { value: 0.7 };
      uniforms.uSpeed = { value: 0.5 };
      uniforms.uCellSize = { value: 12 };
      uniforms.uColorR = { value: 0 };
      uniforms.uColorG = { value: 1 };
      uniforms.uColorB = { value: 0.3 };
      uniforms.uBgMix = { value: 0.5 };
      uniforms.uContrast = { value: 1 };
      break;

    case 'crosshatch':
      uniforms.uDensity = { value: 1 };
      uniforms.uAngle = { value: 30 };
      uniforms.uLineWidth = { value: 1 };
      uniforms.uContrast = { value: 1 };
      uniforms.uPaperR = { value: 0.95 };
      uniforms.uPaperG = { value: 0.93 };
      uniforms.uPaperB = { value: 0.88 };
      uniforms.uInkR = { value: 0.1 };
      uniforms.uInkG = { value: 0.1 };
      uniforms.uInkB = { value: 0.1 };
      break;

    case 'blockMosaic':
      uniforms.uTileSize = { value: 24 };
      uniforms.uMode = { value: 0 };
      uniforms.uGrout = { value: 0.15 };
      uniforms.uColorJitter = { value: 0.1 };
      uniforms.uGroutR = { value: 0.1 };
      uniforms.uGroutG = { value: 0.1 };
      uniforms.uGroutB = { value: 0.1 };
      break;

    case 'terrain3D':
      uniforms.uMode = { value: 1 }; // default to "fade horizon" mode
      uniforms.uAmount = { value: 0.5 };
      uniforms.uAmount2 = { value: 0.5 };
      uniforms.uAmount3 = { value: 0.5 };
      uniforms.uThreshold = { value: 0.4 };
      uniforms.uAngle = { value: 0 };
      uniforms.uCenter = { value: new THREE.Vector2(0.5, 0.5) };
      uniforms.uColor = { value: new THREE.Vector3(0.05, 0.07, 0.12) };
      uniforms.uHorizonFade = { value: 0.7 };
      uniforms.uSourceMix = { value: 0 };
      break;

    case 'wrappedTerrain':
      uniforms.uShape = { value: 0 }; // sphere
      uniforms.uHeight = { value: 0.4 };
      uniforms.uRotateX = { value: 0.5 };
      uniforms.uRotateY = { value: 0.5 };
      uniforms.uAutoRotate = { value: 0.4 };
      uniforms.uCamDistance = { value: 2.5 };
      uniforms.uSpecular = { value: 0.4 };
      uniforms.uAmbient = { value: 0.3 };
      uniforms.uFogDistance = { value: 0.2 };
      uniforms.uFogColor = { value: new THREE.Vector3(0.05, 0.07, 0.12) };
      uniforms.uHorizonFade = { value: 0.6 };
      uniforms.uSourceMix = { value: 0 };
      uniforms.uTileScale = { value: 1 };
      break;

    // ── Geometric 3D (10) ──

    case 'stringOrb':
      uniforms.uRadius = { value: 0.85 };
      uniforms.uHeight = { value: 0.4 };
      uniforms.uLatCount = { value: 16 };
      uniforms.uLonCount = { value: 24 };
      uniforms.uDiagCount = { value: 8 };
      uniforms.uSlope = { value: 1.5 };
      uniforms.uWidth = { value: 0.012 };
      uniforms.uSpin = { value: 0.4 };
      uniforms.uTilt = { value: 0.15 };
      uniforms.uFlow = { value: 0.5 };
      uniforms.uIntensity = { value: 1 };
      uniforms.uGlow = { value: 0.7 };
      uniforms.uGlowColor = { value: new THREE.Vector3(0.4, 0.85, 1) };
      uniforms.uHorizonFade = { value: 0.7 };
      uniforms.uTileScale = { value: 1 };
      uniforms.uAudioBass = { value: 0 };
      uniforms.uAudioHigh = { value: 0 };
      uniforms.uAudioBeatPulse = { value: 0 };
      break;

    case 'sphereWireframe':
      uniforms.uRadius = { value: 0.85 };
      uniforms.uHeight = { value: 0.4 };
      uniforms.uMeridians = { value: 16 };
      uniforms.uParallels = { value: 12 };
      uniforms.uWidth = { value: 0.012 };
      uniforms.uSpin = { value: 0.4 };
      uniforms.uTilt = { value: 0.2 };
      uniforms.uIntensity = { value: 1.2 };
      uniforms.uHaloGlow = { value: 0.7 };
      uniforms.uColor = { value: new THREE.Vector3(0.5, 0.9, 1) };
      uniforms.uHorizonFade = { value: 0.7 };
      uniforms.uFillSource = { value: 0.4 };
      uniforms.uTileScale = { value: 1 };
      uniforms.uAudioBass = { value: 0 };
      uniforms.uAudioHigh = { value: 0 };
      uniforms.uAudioBeatPulse = { value: 0 };
      break;

    case 'voxelCubeCluster':
      uniforms.uGridSize = { value: 4 };
      uniforms.uCubeSize = { value: 0.22 };
      uniforms.uSpacing = { value: 0.7 };
      uniforms.uHeight = { value: 0.5 };
      uniforms.uSpin = { value: 0.5 };
      uniforms.uTilt = { value: 0.5 };
      uniforms.uCamDistance = { value: 4 };
      uniforms.uSpecular = { value: 0.4 };
      uniforms.uAmbient = { value: 0.3 };
      uniforms.uHorizonFade = { value: 0.6 };
      uniforms.uBgColor = { value: new THREE.Vector3(0.04, 0.05, 0.08) };
      uniforms.uAudioBass = { value: 0 };
      uniforms.uAudioBeatPulse = { value: 0 };
      break;

    case 'mobiusLattice':
      uniforms.uMajorR = { value: 0.85 };
      uniforms.uRibbonW = { value: 0.3 };
      uniforms.uTwists = { value: 1 };
      uniforms.uSpin = { value: 0.5 };
      uniforms.uTilt = { value: 0.25 };
      uniforms.uLineDensity = { value: 16 };
      uniforms.uLineWidth = { value: 0.015 };
      uniforms.uIntensity = { value: 1 };
      uniforms.uLineColor = { value: new THREE.Vector3(1, 0.85, 0.4) };
      uniforms.uHorizonFade = { value: 0.6 };
      uniforms.uAudioBass = { value: 0 };
      uniforms.uAudioBeatPulse = { value: 0 };
      break;

    case 'crystalShardField':
      uniforms.uShardCount = { value: 16 };
      uniforms.uShardSize = { value: 0.28 };
      uniforms.uSpread = { value: 1.2 };
      uniforms.uChromaEdge = { value: 0.4 };
      uniforms.uRefraction = { value: 0.5 };
      uniforms.uSpin = { value: 0.4 };
      uniforms.uIntensity = { value: 1 };
      uniforms.uTint = { value: new THREE.Vector3(0.85, 0.95, 1) };
      uniforms.uHorizonFade = { value: 0.6 };
      uniforms.uAudioBass = { value: 0 };
      uniforms.uAudioBeatPulse = { value: 0 };
      break;

    case 'tubeLattice':
      uniforms.uTubeCount = { value: 6 };
      uniforms.uTubeRadius = { value: 0.15 };
      uniforms.uSpread = { value: 0.9 };
      uniforms.uSpin = { value: 0.4 };
      uniforms.uTilt = { value: 0.3 };
      uniforms.uTwist = { value: 0.5 };
      uniforms.uIntensity = { value: 1 };
      uniforms.uRimColor = { value: new THREE.Vector3(0, 0.95, 1) };
      uniforms.uHorizonFade = { value: 0.6 };
      uniforms.uAudioBass = { value: 0 };
      uniforms.uAudioBeatPulse = { value: 0 };
      break;

    case 'discoMirrorBall':
      uniforms.uRadius = { value: 1 };
      uniforms.uFacetCount = { value: 16 };
      uniforms.uSpin = { value: 0.6 };
      uniforms.uTilt = { value: 0.2 };
      uniforms.uChaseSpeed = { value: 1.2 };
      uniforms.uChaseHueWidth = { value: 0.3 };
      uniforms.uSparkle = { value: 0.5 };
      uniforms.uIntensity = { value: 1.2 };
      uniforms.uHighlightColor = { value: new THREE.Vector3(1, 1, 0.85) };
      uniforms.uHorizonFade = { value: 0.5 };
      uniforms.uAudioBass = { value: 0 };
      uniforms.uAudioBeatPulse = { value: 0 };
      break;

    case 'lissajousKnot':
      uniforms.uRatioX = { value: 3 };
      uniforms.uRatioY = { value: 4 };
      uniforms.uRatioZ = { value: 5 };
      uniforms.uPhaseX = { value: 0.25 };
      uniforms.uPhaseY = { value: 0 };
      uniforms.uTubeRadius = { value: 0.08 };
      uniforms.uScale = { value: 1 };
      uniforms.uSpin = { value: 0.4 };
      uniforms.uTilt = { value: 0.25 };
      uniforms.uIntensity = { value: 1 };
      uniforms.uTubeColor = { value: new THREE.Vector3(1, 0.5, 0.85) };
      uniforms.uHorizonFade = { value: 0.6 };
      uniforms.uAudioBass = { value: 0 };
      uniforms.uAudioBeatPulse = { value: 0 };
      break;

    case 'helixParticleStream':
      uniforms.uHelices = { value: 2 };
      uniforms.uHelixRadius = { value: 0.5 };
      uniforms.uTurns = { value: 3 };
      uniforms.uHeight = { value: 2 };
      uniforms.uTubeRadius = { value: 0.06 };
      uniforms.uRiseSpeed = { value: 1 };
      uniforms.uSpin = { value: 0.3 };
      uniforms.uTilt = { value: 0.2 };
      uniforms.uIntensity = { value: 1 };
      uniforms.uTint = { value: new THREE.Vector3(0.4, 1, 0.7) };
      uniforms.uHorizonFade = { value: 0.6 };
      uniforms.uAudioBass = { value: 0 };
      uniforms.uAudioBeatPulse = { value: 0 };
      break;

    case 'donutConstellation':
      uniforms.uMajorR = { value: 1 };
      uniforms.uMinorR = { value: 0.18 };
      uniforms.uStarCount = { value: 12 };
      uniforms.uStarSize = { value: 0.025 };
      uniforms.uSpin = { value: 0.4 };
      uniforms.uTilt = { value: 0.4 };
      uniforms.uTintIntensity = { value: 1 };
      uniforms.uTorusColor = { value: new THREE.Vector3(0.8, 0.4, 1) };
      uniforms.uStarColor = { value: new THREE.Vector3(1, 1, 0.85) };
      uniforms.uHorizonFade = { value: 0.6 };
      uniforms.uAudioBass = { value: 0 };
      uniforms.uAudioBeatPulse = { value: 0 };
      break;

    // Dedicated standalone shaders (extracted from packs for GPU compatibility)
    case 'numberGrid':
    case 'explode3D':
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

    case 'feedbackZoom':
      // Hero rewrite — real previous-frame feedback. Defaults tuned for
      // immediate visual impact when the effect is dropped on a layer:
      // 4% zoom + 1.2° rotation per frame creates obvious spirals in
      // ~10 frames. User can dial down for subtle, up for vortex.
      uniforms.uTexture = { value: null };
      uniforms.uFeedback = { value: null };
      uniforms.uHasFeedback = { value: 0 };
      uniforms.uAmount = { value: 0.85 };
      uniforms.uZoom = { value: 1.04 };
      uniforms.uRotation = { value: 0.02 };
      uniforms.uDecay = { value: 0.04 };
      uniforms.uHueShift = { value: 0 };
      uniforms.uMaskCenter = { value: 0 };
      break;

    case 'tunnelFlight':
      uniforms.uSpeed = { value: 1 };
      uniforms.uTwist = { value: 0.5 };
      uniforms.uTunnelDepth = { value: 1.5 };
      uniforms.uCenterX = { value: 0.5 };
      uniforms.uCenterY = { value: 0.5 };
      uniforms.uMode = { value: 0 };
      uniforms.uChromatic = { value: 0.2 };
      break;

    case 'infiniteMirror':
      uniforms.uIterations = { value: 5 };
      uniforms.uShrink = { value: 0.8 };
      uniforms.uRotation = { value: 5 };
      uniforms.uTintFade = { value: 0.4 };
      uniforms.uHueShift = { value: 0.05 };
      uniforms.uMode = { value: 0 };
      uniforms.uOffsetX = { value: 0.5 };
      uniforms.uOffsetY = { value: 0.5 };
      break;

    case 'fractalWarp':
      uniforms.uAmount = { value: 0.5 };
      uniforms.uScale = { value: 4 };
      uniforms.uOctaves = { value: 4 };
      uniforms.uSpeed = { value: 0.7 };
      uniforms.uChromatic = { value: 0.2 };
      uniforms.uMode = { value: 0 };
      break;

    case 'crystalRefract':
      uniforms.uScale = { value: 6 };
      uniforms.uRefraction = { value: 0.4 };
      uniforms.uSparkle = { value: 0.4 };
      uniforms.uEdgeGlow = { value: 0.5 };
      uniforms.uTintR = { value: 0.85 };
      uniforms.uTintG = { value: 0.95 };
      uniforms.uTintB = { value: 1 };
      uniforms.uMode = { value: 0 };
      break;

    case 'fluidDistort':
      uniforms.uAmount = { value: 0.5 };
      uniforms.uScale = { value: 4 };
      uniforms.uSpeed = { value: 0.8 };
      uniforms.uTurbulence = { value: 0.5 };
      uniforms.uMode = { value: 0 };
      break;

    case 'wormhole':
      uniforms.uPullStrength = { value: 0.5 };
      uniforms.uRotation = { value: 1 };
      uniforms.uCenterX = { value: 0.5 };
      uniforms.uCenterY = { value: 0.5 };
      uniforms.uTwist = { value: 0.5 };
      uniforms.uChromatic = { value: 0.3 };
      uniforms.uAnimSpeed = { value: 0.5 };
      break;

    case 'geometricTile':
      uniforms.uTiles = { value: 4 };
      uniforms.uMode = { value: 0 };
      uniforms.uRotation = { value: 90 };
      uniforms.uOffsetX = { value: 0 };
      uniforms.uMix = { value: 1 };
      break;

    case 'motionTrails':
      uniforms.uLength = { value: 0.4 };
      uniforms.uAngle = { value: 0 };
      uniforms.uSamples = { value: 16 };
      uniforms.uFalloff = { value: 0.5 };
      uniforms.uChromaSplit = { value: 0.2 };
      uniforms.uMode = { value: 0 };
      break;

    case 'echoRepeat':
      uniforms.uCount = { value: 5 };
      uniforms.uOffsetX = { value: 0.05 };
      uniforms.uOffsetY = { value: 0.05 };
      uniforms.uDecay = { value: 0.7 };
      uniforms.uHueShift = { value: 0.02 };
      uniforms.uMode = { value: 0 };
      break;

    case 'ghostDouble':
      uniforms.uOpacity = { value: 0.5 };
      uniforms.uOffsetX = { value: 0.05 };
      uniforms.uOffsetY = { value: 0 };
      uniforms.uMirror = { value: 0 };
      uniforms.uTintR = { value: 1 };
      uniforms.uTintG = { value: 1 };
      uniforms.uTintB = { value: 1 };
      uniforms.uBlend = { value: 0 };
      break;

    case 'strobeFlash':
      uniforms.uRate = { value: 4 };
      uniforms.uDuty = { value: 0.5 };
      uniforms.uIntensity = { value: 1 };
      uniforms.uMode = { value: 0 };
      uniforms.uTintR = { value: 1 };
      uniforms.uTintG = { value: 1 };
      uniforms.uTintB = { value: 1 };
      break;

    case 'lightPaint':
      uniforms.uIntensity = { value: 0.7 };
      uniforms.uThreshold = { value: 0.5 };
      uniforms.uTrailLength = { value: 0.4 };
      uniforms.uFlowAngle = { value: 0 };
      uniforms.uFlowScale = { value: 6 };
      uniforms.uChromaShift = { value: 0.3 };
      uniforms.uTintR = { value: 1 };
      uniforms.uTintG = { value: 0.8 };
      uniforms.uTintB = { value: 0.3 };
      break;

    case 'recursiveEcho':
      uniforms.uDepth = { value: 5 };
      uniforms.uZoom = { value: 0.95 };
      uniforms.uRotation = { value: 5 };
      uniforms.uOpacity = { value: 0.6 };
      uniforms.uHueShift = { value: 0.05 };
      uniforms.uOffsetX = { value: 0.02 };
      uniforms.uOffsetY = { value: 0.02 };
      uniforms.uMode = { value: 0 };
      break;

    case 'invert':
      // Hero rewrite — modes (RGB / luma / hue / strobe / threshold)
      // plus partial-invert amount, threshold, strobe rate.
      uniforms.uMode = { value: 0 };
      uniforms.uAmount = { value: 1 };
      uniforms.uThreshold = { value: 0.5 };
      uniforms.uStrobeRate = { value: 4 };
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

    // ── Batch A: brand-new hero effects ──

    case 'opticalFlowDatamosh':
      uniforms.uIntensity = { value: 0.7 };
      uniforms.uMotionScale = { value: 1 };
      uniforms.uPersistence = { value: 0.7 };
      uniforms.uChromaSplit = { value: 0.3 };
      uniforms.uBlockSize = { value: 12 };
      uniforms.uFreeze = { value: 0 };
      uniforms.uMode = { value: 0 };
      uniforms.uFeedback = { value: null };
      uniforms.uHasFeedback = { value: 0 };
      break;

    case 'flowFieldTrails':
      uniforms.uFlowScale = { value: 4 };
      uniforms.uTrailLength = { value: 0.4 };
      uniforms.uSamples = { value: 24 };
      uniforms.uSpeed = { value: 0.8 };
      uniforms.uChromaSplit = { value: 0.3 };
      uniforms.uContrast = { value: 1 };
      uniforms.uMode = { value: 0 };
      uniforms.uColorCycle = { value: 0 };
      break;

    case 'reactionDiffusion':
      uniforms.uFeedRate = { value: 0.055 };
      uniforms.uKillRate = { value: 0.062 };
      uniforms.uDiffusionA = { value: 1.0 };
      uniforms.uDiffusionB = { value: 0.5 };
      uniforms.uPatternScale = { value: 1 };
      uniforms.uLumaMask = { value: 0.5 };
      uniforms.uMode = { value: 0 };
      uniforms.uColorR = { value: 0.4 };
      uniforms.uColorG = { value: 0.85 };
      uniforms.uColorB = { value: 1 };
      uniforms.uMix = { value: 0.6 };
      uniforms.uReseed = { value: 0.3 };
      uniforms.uFeedback = { value: null };
      uniforms.uHasFeedback = { value: 0 };
      break;

    case 'neonTubeTrace':
      uniforms.uEdgeThreshold = { value: 0.15 };
      uniforms.uTubeWidth = { value: 1.5 };
      uniforms.uGlow = { value: 1 };
      uniforms.uGlowRadius = { value: 6 };
      uniforms.uTintR = { value: 1 };
      uniforms.uTintG = { value: 0.2 };
      uniforms.uTintB = { value: 0.7 };
      uniforms.uChase = { value: 0 };
      uniforms.uChaseSpeed = { value: 1 };
      uniforms.uFlicker = { value: 0 };
      uniforms.uBg = { value: 2 };
      break;

    case 'depthParallax':
      uniforms.uDepthStrength = { value: 0.5 };
      uniforms.uPushIn = { value: 0.3 };
      uniforms.uLayers = { value: 4 };
      uniforms.uChromatic = { value: 0.3 };
      uniforms.uDepthBoost = { value: 1 };
      uniforms.uMode = { value: 0 };
      uniforms.uPanX = { value: 0 };
      uniforms.uPanY = { value: 0 };
      break;

    case 'pointCloudDissolve':
      uniforms.uDissolve = { value: 0 };
      uniforms.uDotSize = { value: 4 };
      uniforms.uScatterRadius = { value: 0.4 };
      uniforms.uAttract = { value: 0 };
      uniforms.uTurbulence = { value: 0.3 };
      uniforms.uMode = { value: 1 };
      uniforms.uBgR = { value: 0 };
      uniforms.uBgG = { value: 0 };
      uniforms.uBgB = { value: 0 };
      uniforms.uHueShift = { value: 0 };
      break;

    case 'pixelSand':
      uniforms.uGravity = { value: 1 };
      uniforms.uTurbulence = { value: 0.3 };
      uniforms.uThreshold = { value: 0.6 };
      uniforms.uPersistence = { value: 0.92 };
      uniforms.uMode = { value: 0 };
      uniforms.uReplenish = { value: 0.6 };
      uniforms.uChromaSplit = { value: 0 };
      uniforms.uGrainSize = { value: 3 };
      uniforms.uFeedback = { value: null };
      uniforms.uHasFeedback = { value: 0 };
      break;

    case 'liquidGlass':
      uniforms.uBlobs = { value: 3 };
      uniforms.uBlobSize = { value: 0.18 };
      uniforms.uRefraction = { value: 0.5 };
      uniforms.uChromatic = { value: 0.4 };
      uniforms.uSpecular = { value: 0.5 };
      uniforms.uCausticAmount = { value: 0.3 };
      uniforms.uSpeed = { value: 0.5 };
      uniforms.uTintR = { value: 0.85 };
      uniforms.uTintG = { value: 0.95 };
      uniforms.uTintB = { value: 1 };
      break;

    case 'hologramScan':
      uniforms.uIntensity = { value: 0.7 };
      uniforms.uScanFreq = { value: 200 };
      uniforms.uScanSpeed = { value: 1 };
      uniforms.uGridSpacing = { value: 12 };
      uniforms.uRGBFlicker = { value: 0.4 };
      uniforms.uBrokenBands = { value: 0.3 };
      uniforms.uTintR = { value: 0.4 };
      uniforms.uTintG = { value: 0.95 };
      uniforms.uTintB = { value: 1 };
      uniforms.uOpacityFlicker = { value: 0.3 };
      uniforms.uEdgeGlow = { value: 0.6 };
      break;

    case 'laserSlice':
      uniforms.uMode = { value: 0 };
      uniforms.uSpeed = { value: 1 };
      uniforms.uBeamWidth = { value: 0.02 };
      uniforms.uGlow = { value: 1.2 };
      uniforms.uSparks = { value: 0.4 };
      uniforms.uEraseAmount = { value: 0.5 };
      uniforms.uTintR = { value: 1 };
      uniforms.uTintG = { value: 0.1 };
      uniforms.uTintB = { value: 0.1 };
      uniforms.uReveal = { value: 1 };
      uniforms.uPersistence = { value: 0.92 };
      uniforms.uFeedback = { value: null };
      uniforms.uHasFeedback = { value: 0 };
      break;

    // ── Batch B: brand-new hero effects ──

    case 'auraField':
      uniforms.uIntensity = { value: 1 };
      uniforms.uRadius = { value: 12 };
      uniforms.uEdgeAmount = { value: 0.6 };
      uniforms.uLumaAmount = { value: 0.4 };
      uniforms.uAudioReact = { value: 0.5 };
      uniforms.uHueShift = { value: 0 };
      uniforms.uTintR = { value: 0.6 };
      uniforms.uTintG = { value: 0.85 };
      uniforms.uTintB = { value: 1 };
      uniforms.uMode = { value: 1 };
      break;

    case 'smokeDisintegrate':
      uniforms.uAmount = { value: 0.4 };
      uniforms.uScale = { value: 4 };
      uniforms.uSpeed = { value: 1 };
      uniforms.uDirection = { value: 90 };
      uniforms.uEdgeFade = { value: 0.5 };
      uniforms.uSmokeColorR = { value: 0.85 };
      uniforms.uSmokeColorG = { value: 0.85 };
      uniforms.uSmokeColorB = { value: 0.9 };
      uniforms.uMode = { value: 0 };
      break;

    case 'shimmerCloth':
      uniforms.uAmplitude = { value: 0.3 };
      uniforms.uFrequency = { value: 8 };
      uniforms.uSpeed = { value: 0.7 };
      uniforms.uThreadDensity = { value: 60 };
      uniforms.uThreadDepth = { value: 0.5 };
      uniforms.uShimmer = { value: 0.5 };
      uniforms.uMode = { value: 0 };
      break;

    case 'glitchQuilt':
      uniforms.uTileSize = { value: 32 };
      uniforms.uShuffleAmount = { value: 0.4 };
      uniforms.uRotateAmount = { value: 0.3 };
      uniforms.uDelayAmount = { value: 0.3 };
      uniforms.uChromaSplit = { value: 0.3 };
      uniforms.uTriggerRate = { value: 1 };
      uniforms.uMode = { value: 0 };
      uniforms.uFeedback = { value: null };
      uniforms.uHasFeedback = { value: 0 };
      break;

    case 'cellularAutomataBurn':
      uniforms.uCellSize = { value: 2 };
      uniforms.uBirthThreshold = { value: 0.5 };
      uniforms.uSurvivalLow = { value: 1.5 };
      uniforms.uSurvivalHigh = { value: 3.5 };
      uniforms.uColorR = { value: 1 };
      uniforms.uColorG = { value: 0.5 };
      uniforms.uColorB = { value: 0.1 };
      uniforms.uMode = { value: 0 };
      uniforms.uMix = { value: 0.7 };
      uniforms.uFeedback = { value: null };
      uniforms.uHasFeedback = { value: 0 };
      break;

    case 'rorschachMirror':
      uniforms.uMode = { value: 0 };
      uniforms.uInkAmount = { value: 0.4 };
      uniforms.uFluidEdges = { value: 0.3 };
      uniforms.uTintR = { value: 0.05 };
      uniforms.uTintG = { value: 0.05 };
      uniforms.uTintB = { value: 0.05 };
      uniforms.uBgR = { value: 0.95 };
      uniforms.uBgG = { value: 0.95 };
      uniforms.uBgB = { value: 0.92 };
      uniforms.uMixOriginal = { value: 0 };
      break;

    case 'spectralPrismTunnel':
      uniforms.uTunnelDepth = { value: 1.5 };
      uniforms.uPrismSpread = { value: 1 };
      uniforms.uRotation = { value: 1 };
      uniforms.uSpeed = { value: 1 };
      uniforms.uSlices = { value: 12 };
      uniforms.uFade = { value: 0.5 };
      break;

    case 'ledVolume':
      uniforms.uVoxelSize = { value: 16 };
      uniforms.uDepthPulse = { value: 0.4 };
      uniforms.uDepthSpeed = { value: 1 };
      uniforms.uPosterize = { value: 4 };
      uniforms.uGlow = { value: 0.5 };
      uniforms.uPerspective = { value: 0.4 };
      uniforms.uMode = { value: 1 };
      uniforms.uBgR = { value: 0 };
      uniforms.uBgG = { value: 0 };
      uniforms.uBgB = { value: 0 };
      break;

    case 'posterTear':
      uniforms.uTearAmount = { value: 0.3 };
      uniforms.uTearAngle = { value: 35 };
      uniforms.uTearJitter = { value: 0.5 };
      uniforms.uShiftBelow = { value: 0.5 };
      uniforms.uOffsetX = { value: 0.05 };
      uniforms.uOffsetY = { value: 0.02 };
      uniforms.uTearGlow = { value: 0.3 };
      uniforms.uMode = { value: 0 };
      break;

    case 'paintPeel':
      uniforms.uAmount = { value: 0.3 };
      uniforms.uScale = { value: 4 };
      uniforms.uLumaBias = { value: 0.5 };
      uniforms.uCurl = { value: 0.5 };
      uniforms.uShadow = { value: 0.5 };
      uniforms.uBgR = { value: 0.15 };
      uniforms.uBgG = { value: 0.13 };
      uniforms.uBgB = { value: 0.1 };
      uniforms.uMode = { value: 0 };
      break;

    // ── Batch C: brand-new hero effects ──

    case 'audioShockBloom':
      uniforms.uIntensity = { value: 1 };
      uniforms.uBloomThreshold = { value: 0.6 };
      uniforms.uBloomRadius = { value: 12 };
      uniforms.uShockSpeed = { value: 0.8 };
      uniforms.uShockAmplitude = { value: 0.05 };
      uniforms.uChromaSplit = { value: 0.4 };
      uniforms.uStrobeAmount = { value: 0.4 };
      uniforms.uTintR = { value: 1 };
      uniforms.uTintG = { value: 0.95 };
      uniforms.uTintB = { value: 0.85 };
      uniforms.uAudioGate = { value: 0.3 };
      break;

    case 'vhsFullDeck':
      uniforms.uTracking = { value: 0.5 };
      uniforms.uHeadSwitch = { value: 0.4 };
      uniforms.uChromaBleed = { value: 0.5 };
      uniforms.uDropouts = { value: 0.3 };
      uniforms.uTapeNoise = { value: 0.4 };
      uniforms.uScanlines = { value: 0.4 };
      uniforms.uColorBleed = { value: 0.3 };
      uniforms.uSaturation = { value: 0.85 };
      uniforms.uTrackingJump = { value: 0.1 };
      uniforms.uMode = { value: 1 };
      break;

    case 'analogFeedbackRack':
      uniforms.uMix = { value: 0.7 };
      uniforms.uZoom = { value: 1.02 };
      uniforms.uRotation = { value: 0.005 };
      uniforms.uDecay = { value: 0.04 };
      uniforms.uHueShift = { value: 0.01 };
      uniforms.uMaskCenter = { value: 0 };
      uniforms.uChromaSplit = { value: 0.2 };
      uniforms.uOffsetX = { value: 0 };
      uniforms.uOffsetY = { value: 0 };
      uniforms.uMode = { value: 0 };
      uniforms.uFeedback = { value: null };
      uniforms.uHasFeedback = { value: 0 };
      break;

    case 'clubLaserGrid':
      uniforms.uIntensity = { value: 1 };
      uniforms.uGridDensity = { value: 12 };
      uniforms.uPerspective = { value: 0.7 };
      uniforms.uSpeed = { value: 1 };
      uniforms.uIntersectionGlow = { value: 0.7 };
      uniforms.uLineWidth = { value: 1.5 };
      uniforms.uTintR = { value: 0.2 };
      uniforms.uTintG = { value: 1 };
      uniforms.uTintB = { value: 0.5 };
      uniforms.uAudioReact = { value: 0.7 };
      uniforms.uMode = { value: 0 };
      break;

    case 'mirrorShards':
      uniforms.uShards = { value: 8 };
      uniforms.uShardSize = { value: 0.2 };
      uniforms.uRotation = { value: 60 };
      uniforms.uDelayAmount = { value: 0.3 };
      uniforms.uChromatic = { value: 0.3 };
      uniforms.uMode = { value: 0 };
      uniforms.uFeedback = { value: null };
      uniforms.uHasFeedback = { value: 0 };
      break;

    case 'ghostExposure':
      uniforms.uExposure = { value: 0.3 };
      uniforms.uDecay = { value: 0.04 };
      uniforms.uHueShiftPerFrame = { value: 0.005 };
      uniforms.uIntensity = { value: 1 };
      uniforms.uMode = { value: 0 };
      uniforms.uClamp = { value: 0.85 };
      uniforms.uFeedback = { value: null };
      uniforms.uHasFeedback = { value: 0 };
      break;

    case 'thermalContour':
      uniforms.uPalette = { value: 0 };
      uniforms.uContourCount = { value: 8 };
      uniforms.uContourWidth = { value: 0.005 };
      uniforms.uContourGlow = { value: 0.5 };
      uniforms.uIntensity = { value: 1 };
      uniforms.uTrackBlobs = { value: 0.4 };
      uniforms.uMix = { value: 0.85 };
      break;

    case 'dreamDiffusion':
      uniforms.uBloomAmount = { value: 1.2 };
      uniforms.uBloomRadius = { value: 14 };
      uniforms.uHalation = { value: 0.5 };
      uniforms.uChromaticBlur = { value: 0.4 };
      uniforms.uPastelRolloff = { value: 0.6 };
      uniforms.uShadowLift = { value: 0.15 };
      uniforms.uSoftness = { value: 0.4 };
      uniforms.uTintR = { value: 1.05 };
      uniforms.uTintG = { value: 1 };
      uniforms.uTintB = { value: 0.95 };
      break;

    case 'topoWarp':
      uniforms.uContourCount = { value: 12 };
      uniforms.uContourWidth = { value: 0.008 };
      uniforms.uDisplacement = { value: 0.5 };
      uniforms.uChromaticEdge = { value: 0.3 };
      uniforms.uColorR = { value: 0 };
      uniforms.uColorG = { value: 0.85 };
      uniforms.uColorB = { value: 1 };
      uniforms.uShadowRidges = { value: 0.5 };
      uniforms.uMix = { value: 0.85 };
      break;

    case 'strobeSequencer':
      uniforms.uBPM = { value: 120 };
      uniforms.uSteps = { value: 16 };
      uniforms.uPattern = { value: 21845 }; // 0101010101010101 (every other step)
      uniforms.uMode = { value: 0 };
      uniforms.uIntensity = { value: 1 };
      uniforms.uTintR = { value: 1 };
      uniforms.uTintG = { value: 1 };
      uniforms.uTintB = { value: 1 };
      uniforms.uSwing = { value: 0 };
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
  time: number,
  audioRms: number = 0
): void {
  const u = material.uniforms;
  const p = effect.params;

  // Update common uniforms
  if (u.uResolution) u.uResolution.value.set(width, height);
  if (u.uTime) u.uTime.value = time;
  // Global audio rms — set on any shader that declares uAudio. Saves us
  // from having to wire audio per-effect; audio-reactive effects just
  // pick up the value automatically. Clamped 0..1.5 to allow for slight
  // overshoot on loud peaks.
  if (u.uAudio) u.uAudio.value = Math.max(0, Math.min(1.5, audioRms));

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
      if (u.uShape && p.vignetteShape !== undefined) u.uShape.value = p.vignetteShape;
      if (u.uAspect && p.vignetteAspect !== undefined) u.uAspect.value = p.vignetteAspect;
      if (u.uCenterX && p.vignetteCenterX !== undefined) u.uCenterX.value = p.vignetteCenterX;
      if (u.uCenterY && p.vignetteCenterY !== undefined) u.uCenterY.value = p.vignetteCenterY;
      if (u.uColorR && p.vignetteColorR !== undefined) u.uColorR.value = p.vignetteColorR;
      if (u.uColorG && p.vignetteColorG !== undefined) u.uColorG.value = p.vignetteColorG;
      if (u.uColorB && p.vignetteColorB !== undefined) u.uColorB.value = p.vignetteColorB;
      if (u.uTintAmount && p.vignetteTintAmount !== undefined) u.uTintAmount.value = p.vignetteTintAmount;
      if (u.uBreathing && p.vignetteBreathing !== undefined) u.uBreathing.value = p.vignetteBreathing;
      if (u.uBreathSpeed && p.vignetteBreathSpeed !== undefined) u.uBreathSpeed.value = p.vignetteBreathSpeed;
      break;

    case 'edgeFeather':
      if (u.uTop && p.featherTop !== undefined) u.uTop.value = p.featherTop;
      if (u.uBottom && p.featherBottom !== undefined) u.uBottom.value = p.featherBottom;
      if (u.uLeft && p.featherLeft !== undefined) u.uLeft.value = p.featherLeft;
      if (u.uRight && p.featherRight !== undefined) u.uRight.value = p.featherRight;
      if (u.uSoftness && p.featherSoftness !== undefined) u.uSoftness.value = p.featherSoftness;
      if (u.uGamma && p.featherGamma !== undefined) u.uGamma.value = p.featherGamma;
      if (u.uMattePreview && p.featherMattePreview !== undefined) u.uMattePreview.value = p.featherMattePreview;
      break;

    case 'colorama':
      if (u.uPalette && p.coloramaPalette !== undefined) u.uPalette.value = p.coloramaPalette;
      if (u.uOffset && p.coloramaOffset !== undefined) u.uOffset.value = p.coloramaOffset;
      if (u.uSpeed && p.coloramaSpeed !== undefined) u.uSpeed.value = p.coloramaSpeed;
      if (u.uContrast && p.coloramaContrast !== undefined) u.uContrast.value = p.coloramaContrast;
      if (u.uMix && p.coloramaMix !== undefined) u.uMix.value = p.coloramaMix;
      if (u.uBands && p.coloramaBands !== undefined) u.uBands.value = p.coloramaBands;
      if (u.uAudioReact && p.coloramaAudioReact !== undefined) u.uAudioReact.value = p.coloramaAudioReact;
      if (u.uHueShift && p.coloramaHueShift !== undefined) u.uHueShift.value = p.coloramaHueShift;
      // uAudio is plumbed globally — audio-reactive shaders pick it up.
      break;

    case 'dither':
      if (u.uType && p.ditherType !== undefined) u.uType.value = p.ditherType;
      if (u.uIntensity && p.ditherIntensity !== undefined) u.uIntensity.value = p.ditherIntensity;
      if (u.uScale && p.ditherScale !== undefined) u.uScale.value = p.ditherScale;
      if (u.uColorDepth && p.ditherColorDepth !== undefined) u.uColorDepth.value = p.ditherColorDepth;
      if (u.uPalette && p.ditherPalette !== undefined) u.uPalette.value = p.ditherPalette;
      if (u.uPixelLock && p.ditherPixelLock !== undefined) u.uPixelLock.value = p.ditherPixelLock;
      break;

    case 'vhs':
      if (u.uTracking && p.vhsTracking !== undefined) u.uTracking.value = p.vhsTracking;
      if (u.uNoise && p.vhsNoise !== undefined) u.uNoise.value = p.vhsNoise;
      if (u.uDistortion && p.vhsDistortion !== undefined) u.uDistortion.value = p.vhsDistortion;
      if (u.uColorBleed && p.vhsColorBleed !== undefined) u.uColorBleed.value = p.vhsColorBleed;
      if (u.uScanlines && p.vhsScanlines !== undefined) u.uScanlines.value = p.vhsScanlines;
      if (u.uHeadSwitch && p.vhsHeadSwitch !== undefined) u.uHeadSwitch.value = p.vhsHeadSwitch;
      if (u.uTapeWobble && p.vhsTapeWobble !== undefined) u.uTapeWobble.value = p.vhsTapeWobble;
      if (u.uDropout && p.vhsDropout !== undefined) u.uDropout.value = p.vhsDropout;
      if (u.uChromaDelay && p.vhsChromaDelay !== undefined) u.uChromaDelay.value = p.vhsChromaDelay;
      if (u.uTrackingJump && p.vhsTrackingJump !== undefined) u.uTrackingJump.value = p.vhsTrackingJump;
      if (u.uSaturation && p.vhsSaturation !== undefined) u.uSaturation.value = p.vhsSaturation;
      break;

    case 'glitch':
      if (u.uIntensity && p.glitchIntensity !== undefined) u.uIntensity.value = p.glitchIntensity;
      if (u.uSpeed && p.glitchSpeed !== undefined) u.uSpeed.value = p.glitchSpeed;
      if (u.uBlockSize && p.glitchBlockSize !== undefined) u.uBlockSize.value = p.glitchBlockSize;
      if (u.uRGBSplit && p.glitchRGBSplit !== undefined) u.uRGBSplit.value = p.glitchRGBSplit;
      if (u.uJitter && p.glitchJitter !== undefined) u.uJitter.value = p.glitchJitter;
      if (u.uTriggerMode && p.glitchTriggerMode !== undefined) u.uTriggerMode.value = p.glitchTriggerMode;
      if (u.uBlockHold && p.glitchBlockHold !== undefined) u.uBlockHold.value = p.glitchBlockHold;
      if (u.uVerticalSlice && p.glitchVerticalSlice !== undefined) u.uVerticalSlice.value = p.glitchVerticalSlice;
      if (u.uFreezeBurst && p.glitchFreezeBurst !== undefined) u.uFreezeBurst.value = p.glitchFreezeBurst;
      if (u.uTearChance && p.glitchTearChance !== undefined) u.uTearChance.value = p.glitchTearChance;
      break;

    case 'rgbShift':
      if (u.uAmount && p.rgbShiftAmount !== undefined) u.uAmount.value = p.rgbShiftAmount;
      if (u.uAngle && p.rgbShiftAngle !== undefined) u.uAngle.value = p.rgbShiftAngle;
      if (u.uMode && p.rgbShiftMode !== undefined) u.uMode.value = p.rgbShiftMode;
      if (u.uCenterX && p.rgbShiftCenterX !== undefined) u.uCenterX.value = p.rgbShiftCenterX;
      if (u.uCenterY && p.rgbShiftCenterY !== undefined) u.uCenterY.value = p.rgbShiftCenterY;
      if (u.uPrismSpread && p.rgbShiftPrismSpread !== undefined) u.uPrismSpread.value = p.rgbShiftPrismSpread;
      break;

    case 'scanlines':
      if (u.uIntensity && p.scanlinesIntensity !== undefined) u.uIntensity.value = p.scanlinesIntensity;
      if (u.uCount && p.scanlinesCount !== undefined) u.uCount.value = p.scanlinesCount;
      if (u.uSpeed && p.scanlinesSpeed !== undefined) u.uSpeed.value = p.scanlinesSpeed;
      if (u.uPhosphor && p.scanlinesPhosphor !== undefined) u.uPhosphor.value = p.scanlinesPhosphor;
      if (u.uRollingBar && p.scanlinesRollingBar !== undefined) u.uRollingBar.value = p.scanlinesRollingBar;
      if (u.uCurvature && p.scanlinesCurvature !== undefined) u.uCurvature.value = p.scanlinesCurvature;
      if (u.uInterlace && p.scanlinesInterlace !== undefined) u.uInterlace.value = p.scanlinesInterlace;
      break;

    case 'pixelate':
      if (u.uSize && p.pixelateSize !== undefined) u.uSize.value = p.pixelateSize;
      if (u.uMode && p.pixelateMode !== undefined) u.uMode.value = p.pixelateMode;
      if (u.uGridLines && p.pixelateGrid !== undefined) u.uGridLines.value = p.pixelateGrid;
      if (u.uAnimSpeed && p.pixelateAnimSpeed !== undefined) u.uAnimSpeed.value = p.pixelateAnimSpeed;
      if (u.uAnimAmount && p.pixelateAnimAmount !== undefined) u.uAnimAmount.value = p.pixelateAnimAmount;
      break;

    case 'blur':
      if (u.uRadius && p.blurRadius !== undefined) u.uRadius.value = p.blurRadius;
      if (u.uMode && p.blurMode !== undefined) u.uMode.value = p.blurMode;
      if (u.uAngle && p.blurAngle !== undefined) u.uAngle.value = p.blurAngle;
      if (u.uQuality && p.blurQuality !== undefined) u.uQuality.value = p.blurQuality;
      if (u.uEdgeProtect && p.blurEdgeProtect !== undefined) u.uEdgeProtect.value = p.blurEdgeProtect;
      if (u.uMix && p.blurMix !== undefined) u.uMix.value = p.blurMix;
      break;

    case 'sharpen':
      if (u.uAmount && p.sharpenAmount !== undefined) u.uAmount.value = p.sharpenAmount;
      if (u.uMode && p.sharpenMode !== undefined) u.uMode.value = p.sharpenMode;
      if (u.uRadius && p.sharpenRadius !== undefined) u.uRadius.value = p.sharpenRadius;
      if (u.uEdgeProtect && p.sharpenEdgeProtect !== undefined) u.uEdgeProtect.value = p.sharpenEdgeProtect;
      if (u.uClarity && p.sharpenClarity !== undefined) u.uClarity.value = p.sharpenClarity;
      break;

    case 'directionalBlur':
      if (u.uAmount && p.dirBlurAmount !== undefined) u.uAmount.value = p.dirBlurAmount;
      if (u.uAngle && p.dirBlurAngle !== undefined) u.uAngle.value = p.dirBlurAngle;
      if (u.uSamples && p.dirBlurSamples !== undefined) u.uSamples.value = p.dirBlurSamples;
      if (u.uFalloff && p.dirBlurFalloff !== undefined) u.uFalloff.value = p.dirBlurFalloff;
      if (u.uCenterBias && p.dirBlurCenterBias !== undefined) u.uCenterBias.value = p.dirBlurCenterBias;
      if (u.uMix && p.dirBlurMix !== undefined) u.uMix.value = p.dirBlurMix;
      break;

    case 'zoomBlur':
      if (u.uAmount && p.zoomBlurAmount !== undefined) u.uAmount.value = p.zoomBlurAmount;
      if (u.uCenterX && p.zoomBlurCenterX !== undefined) u.uCenterX.value = p.zoomBlurCenterX;
      if (u.uCenterY && p.zoomBlurCenterY !== undefined) u.uCenterY.value = p.zoomBlurCenterY;
      if (u.uSamples && p.zoomBlurSamples !== undefined) u.uSamples.value = p.zoomBlurSamples;
      if (u.uFalloff && p.zoomBlurFalloff !== undefined) u.uFalloff.value = p.zoomBlurFalloff;
      if (u.uChromatic && p.zoomBlurChromatic !== undefined) u.uChromatic.value = p.zoomBlurChromatic;
      if (u.uMix && p.zoomBlurMix !== undefined) u.uMix.value = p.zoomBlurMix;
      break;

    case 'radialBlur':
      if (u.uAmount && p.radialBlurAmount !== undefined) u.uAmount.value = p.radialBlurAmount;
      if (u.uCenterX && p.radialBlurCenterX !== undefined) u.uCenterX.value = p.radialBlurCenterX;
      if (u.uCenterY && p.radialBlurCenterY !== undefined) u.uCenterY.value = p.radialBlurCenterY;
      if (u.uSamples && p.radialBlurSamples !== undefined) u.uSamples.value = p.radialBlurSamples;
      if (u.uFalloff && p.radialBlurFalloff !== undefined) u.uFalloff.value = p.radialBlurFalloff;
      if (u.uRadiusInner && p.radialBlurRadiusInner !== undefined) u.uRadiusInner.value = p.radialBlurRadiusInner;
      if (u.uRadiusOuter && p.radialBlurRadiusOuter !== undefined) u.uRadiusOuter.value = p.radialBlurRadiusOuter;
      if (u.uMix && p.radialBlurMix !== undefined) u.uMix.value = p.radialBlurMix;
      break;

    case 'oilPaint':
      if (u.uRadius && p.oilPaintRadius !== undefined) u.uRadius.value = p.oilPaintRadius;
      if (u.uIntensity && p.oilPaintIntensity !== undefined) u.uIntensity.value = p.oilPaintIntensity;
      if (u.uBrushLength && p.oilPaintBrushLength !== undefined) u.uBrushLength.value = p.oilPaintBrushLength;
      if (u.uBristle && p.oilPaintBristle !== undefined) u.uBristle.value = p.oilPaintBristle;
      if (u.uColorPunch && p.oilPaintColorPunch !== undefined) u.uColorPunch.value = p.oilPaintColorPunch;
      if (u.uHighlight && p.oilPaintHighlight !== undefined) u.uHighlight.value = p.oilPaintHighlight;
      if (u.uMode && p.oilPaintMode !== undefined) u.uMode.value = p.oilPaintMode;
      break;

    case 'watercolor':
      if (u.uBleed && p.watercolorBleed !== undefined) u.uBleed.value = p.watercolorBleed;
      if (u.uEdgeDarken && p.watercolorEdgeDarken !== undefined) u.uEdgeDarken.value = p.watercolorEdgeDarken;
      if (u.uPaperTexture && p.watercolorPaperTexture !== undefined) u.uPaperTexture.value = p.watercolorPaperTexture;
      if (u.uPaperScale && p.watercolorPaperScale !== undefined) u.uPaperScale.value = p.watercolorPaperScale;
      if (u.uWetness && p.watercolorWetness !== undefined) u.uWetness.value = p.watercolorWetness;
      if (u.uGranulation && p.watercolorGranulation !== undefined) u.uGranulation.value = p.watercolorGranulation;
      if (u.uPaperHue && p.watercolorPaperHue !== undefined) u.uPaperHue.value = p.watercolorPaperHue;
      break;

    case 'noise':
      if (u.uAmount && p.noiseAmount !== undefined) u.uAmount.value = p.noiseAmount;
      if (u.uType && p.noiseType !== undefined) u.uType.value = p.noiseType;
      if (u.uMode && p.noiseMode !== undefined) u.uMode.value = p.noiseMode;
      if (u.uScale && p.noiseScale !== undefined) u.uScale.value = p.noiseScale;
      if (u.uMono && p.noiseMono !== undefined) u.uMono.value = p.noiseMono;
      if (u.uShadowAmt && p.noiseShadow !== undefined) u.uShadowAmt.value = p.noiseShadow;
      if (u.uMidAmt && p.noiseMid !== undefined) u.uMidAmt.value = p.noiseMid;
      if (u.uHighAmt && p.noiseHigh !== undefined) u.uHighAmt.value = p.noiseHigh;
      if (u.uAnimSpeed && p.noiseAnimSpeed !== undefined) u.uAnimSpeed.value = p.noiseAnimSpeed;
      break;

    case 'kaleidoscope':
      if (u.uSegments && p.kaleidoscopeSegments !== undefined) u.uSegments.value = p.kaleidoscopeSegments;
      if (u.uAngle && p.kaleidoscopeAngle !== undefined) u.uAngle.value = p.kaleidoscopeAngle;
      if (u.uCenterX && p.kaleidoscopeCenterX !== undefined) u.uCenterX.value = p.kaleidoscopeCenterX;
      if (u.uCenterY && p.kaleidoscopeCenterY !== undefined) u.uCenterY.value = p.kaleidoscopeCenterY;
      if (u.uZoom && p.kaleidoscopeZoom !== undefined) u.uZoom.value = p.kaleidoscopeZoom;
      if (u.uMode && p.kaleidoscopeMode !== undefined) u.uMode.value = p.kaleidoscopeMode;
      if (u.uSpiralAmount && p.kaleidoscopeSpiral !== undefined) u.uSpiralAmount.value = p.kaleidoscopeSpiral;
      if (u.uAnimSpeed && p.kaleidoscopeAnimSpeed !== undefined) u.uAnimSpeed.value = p.kaleidoscopeAnimSpeed;
      if (u.uMix && p.kaleidoscopeMix !== undefined) u.uMix.value = p.kaleidoscopeMix;
      break;

    case 'mirror':
      if (u.uMode && p.mirrorMode !== undefined) u.uMode.value = p.mirrorMode;
      if (u.uPosition && p.mirrorPosition !== undefined) u.uPosition.value = p.mirrorPosition;
      if (u.uOffset && p.mirrorOffset !== undefined) u.uOffset.value = p.mirrorOffset;
      if (u.uFlipSide && p.mirrorFlipSide !== undefined) u.uFlipSide.value = p.mirrorFlipSide;
      if (u.uMix && p.mirrorMix !== undefined) u.uMix.value = p.mirrorMix;
      break;

    case 'plasma':
      if (u.uSpeed && p.plasmaSpeed !== undefined) u.uSpeed.value = p.plasmaSpeed;
      if (u.uScale && p.plasmaScale !== undefined) u.uScale.value = p.plasmaScale;
      if (u.uComplexity && p.plasmaComplexity !== undefined) u.uComplexity.value = p.plasmaComplexity;
      if (u.uPalette && p.plasmaPalette !== undefined) u.uPalette.value = p.plasmaPalette;
      if (u.uMode && p.plasmaMode !== undefined) u.uMode.value = p.plasmaMode;
      if (u.uBlendMode && p.plasmaBlendMode !== undefined) u.uBlendMode.value = p.plasmaBlendMode;
      if (u.uMix && p.plasmaMix !== undefined) u.uMix.value = p.plasmaMix;
      if (u.uWarpAmount && p.plasmaWarpAmount !== undefined) u.uWarpAmount.value = p.plasmaWarpAmount;
      if (u.uAudioReact && p.plasmaAudioReact !== undefined) u.uAudioReact.value = p.plasmaAudioReact;
      break;

    case 'posterize':
      if (u.uLevels && p.posterizeLevels !== undefined) u.uLevels.value = p.posterizeLevels;
      if (u.uDitherAmount && p.posterizeDither !== undefined) u.uDitherAmount.value = p.posterizeDither;
      if (u.uAnimSpeed && p.posterizeAnimSpeed !== undefined) u.uAnimSpeed.value = p.posterizeAnimSpeed;
      if (u.uPaletteLock && p.posterizePalette !== undefined) u.uPaletteLock.value = p.posterizePalette;
      break;

    case 'edgeDetect':
      if (u.uThreshold && p.edgeThreshold !== undefined) u.uThreshold.value = p.edgeThreshold;
      if (u.uThickness && p.edgeThickness !== undefined) u.uThickness.value = p.edgeThickness;
      if (u.uMode && p.edgeMode !== undefined) u.uMode.value = p.edgeMode;
      if (u.uInvert && p.edgeInvert !== undefined) u.uInvert.value = p.edgeInvert;
      if (u.uEdgeR && p.edgeTintR !== undefined) u.uEdgeR.value = p.edgeTintR;
      if (u.uEdgeG && p.edgeTintG !== undefined) u.uEdgeG.value = p.edgeTintG;
      if (u.uEdgeB && p.edgeTintB !== undefined) u.uEdgeB.value = p.edgeTintB;
      if (u.uTintEdges && p.edgeTintEdges !== undefined) u.uTintEdges.value = p.edgeTintEdges;
      if (u.uGlow && p.edgeGlow !== undefined) u.uGlow.value = p.edgeGlow;
      if (u.uEdgeOnly && p.edgeOnlyAlpha !== undefined) u.uEdgeOnly.value = p.edgeOnlyAlpha;
      break;

    case 'outline':
      if (u.uThickness && p.outlineThickness !== undefined) u.uThickness.value = p.outlineThickness;
      if (u.uColor && p.outlineColor !== undefined) {
        const c = p.outlineColor;
        u.uColor.value.set(c[0] || 1, c[1] || 1, c[2] || 1);
      }
      if (u.uOnly && p.outlineOnly !== undefined) u.uOnly.value = p.outlineOnly;
      if (u.uGlow && p.outlineGlow !== undefined) u.uGlow.value = p.outlineGlow;
      if (u.uPosition && p.outlinePosition !== undefined) u.uPosition.value = p.outlinePosition;
      if (u.uCrawl && p.outlineCrawl !== undefined) u.uCrawl.value = p.outlineCrawl;
      if (u.uGlowFalloff && p.outlineGlowFalloff !== undefined) u.uGlowFalloff.value = p.outlineGlowFalloff;
      if (u.uAlphaAware && p.outlineAlphaAware !== undefined) u.uAlphaAware.value = p.outlineAlphaAware;
      break;

    case 'emboss':
      if (u.uStrength && p.embossStrength !== undefined) u.uStrength.value = p.embossStrength;
      if (u.uAngle && p.embossAngle !== undefined) u.uAngle.value = p.embossAngle;
      if (u.uHeight && p.embossHeight !== undefined) u.uHeight.value = p.embossHeight;
      if (u.uHighlightR && p.embossHighlightR !== undefined) u.uHighlightR.value = p.embossHighlightR;
      if (u.uHighlightG && p.embossHighlightG !== undefined) u.uHighlightG.value = p.embossHighlightG;
      if (u.uHighlightB && p.embossHighlightB !== undefined) u.uHighlightB.value = p.embossHighlightB;
      if (u.uShadowR && p.embossShadowR !== undefined) u.uShadowR.value = p.embossShadowR;
      if (u.uShadowG && p.embossShadowG !== undefined) u.uShadowG.value = p.embossShadowG;
      if (u.uShadowB && p.embossShadowB !== undefined) u.uShadowB.value = p.embossShadowB;
      if (u.uNormalMode && p.embossNormalMode !== undefined) u.uNormalMode.value = p.embossNormalMode;
      if (u.uMetallicness && p.embossMetallicness !== undefined) u.uMetallicness.value = p.embossMetallicness;
      break;

    case 'halftone':
      if (u.uDotSize && p.halftoneDotSize !== undefined) u.uDotSize.value = p.halftoneDotSize;
      if (u.uDotShape && p.halftoneDotShape !== undefined) u.uDotShape.value = p.halftoneDotShape;
      if (u.uAngleC && p.halftoneAngleC !== undefined) u.uAngleC.value = p.halftoneAngleC;
      if (u.uAngleM && p.halftoneAngleM !== undefined) u.uAngleM.value = p.halftoneAngleM;
      if (u.uAngleY && p.halftoneAngleY !== undefined) u.uAngleY.value = p.halftoneAngleY;
      if (u.uAngleK && p.halftoneAngleK !== undefined) u.uAngleK.value = p.halftoneAngleK;
      if (u.uMode && p.halftoneMode !== undefined) u.uMode.value = p.halftoneMode;
      if (u.uDriftSpeed && p.halftoneDrift !== undefined) u.uDriftSpeed.value = p.halftoneDrift;
      if (u.uSpotColor && p.halftoneSpotColor !== undefined) {
        const c = p.halftoneSpotColor;
        u.uSpotColor.value.set(c[0] || 0, c[1] || 0, c[2] || 0);
      }
      break;

    case 'toon':
      if (u.uSteps && p.toonSteps !== undefined) u.uSteps.value = p.toonSteps;
      if (u.uOutline && p.toonOutline !== undefined) u.uOutline.value = p.toonOutline;
      if (u.uOutlineColor && p.toonOutlineColor !== undefined) {
        const c = p.toonOutlineColor;
        u.uOutlineColor.value.set(c[0] || 0, c[1] || 0, c[2] || 0);
      }
      if (u.uShadowBand && p.toonShadowBand !== undefined) u.uShadowBand.value = p.toonShadowBand;
      if (u.uRampSoftness && p.toonRampSoftness !== undefined) u.uRampSoftness.value = p.toonRampSoftness;
      if (u.uColorPop && p.toonColorPop !== undefined) u.uColorPop.value = p.toonColorPop;
      break;

    case 'kuwahara':
      if (u.uRadius && p.kuwaharaRadius !== undefined) u.uRadius.value = p.kuwaharaRadius;
      if (u.uEdgeSharpness && p.kuwaharaEdgeSharpness !== undefined) u.uEdgeSharpness.value = p.kuwaharaEdgeSharpness;
      if (u.uColorPunch && p.kuwaharaColorPunch !== undefined) u.uColorPunch.value = p.kuwaharaColorPunch;
      break;

    case 'tiltShift':
      if (u.uMode && p.tiltShiftMode !== undefined) u.uMode.value = p.tiltShiftMode;
      if (u.uFocusY && p.tiltShiftFocusY !== undefined) u.uFocusY.value = p.tiltShiftFocusY;
      if (u.uFocusX && p.tiltShiftFocusX !== undefined) u.uFocusX.value = p.tiltShiftFocusX;
      if (u.uFocusBand && p.tiltShiftFocusBand !== undefined) u.uFocusBand.value = p.tiltShiftFocusBand;
      if (u.uFalloff && p.tiltShiftFalloff !== undefined) u.uFalloff.value = p.tiltShiftFalloff;
      if (u.uMaxBlur && p.tiltShiftMaxBlur !== undefined) u.uMaxBlur.value = p.tiltShiftMaxBlur;
      if (u.uAngle && p.tiltShiftAngle !== undefined) u.uAngle.value = p.tiltShiftAngle;
      if (u.uSaturation && p.tiltShiftSaturation !== undefined) u.uSaturation.value = p.tiltShiftSaturation;
      break;

    case 'defocusBokeh':
      if (u.uRadius && p.bokehRadius !== undefined) u.uRadius.value = p.bokehRadius;
      if (u.uSamples && p.bokehSamples !== undefined) u.uSamples.value = p.bokehSamples;
      if (u.uBrightWeight && p.bokehBrightWeight !== undefined) u.uBrightWeight.value = p.bokehBrightWeight;
      if (u.uThreshold && p.bokehThreshold !== undefined) u.uThreshold.value = p.bokehThreshold;
      if (u.uChromaFringe && p.bokehChromaFringe !== undefined) u.uChromaFringe.value = p.bokehChromaFringe;
      if (u.uShape && p.bokehShape !== undefined) u.uShape.value = p.bokehShape;
      if (u.uRotation && p.bokehRotation !== undefined) u.uRotation.value = p.bokehRotation;
      if (u.uMix && p.bokehMix !== undefined) u.uMix.value = p.bokehMix;
      break;

    case 'chromaticAberration':
      if (u.uAmount && p.caAmount !== undefined) u.uAmount.value = p.caAmount;
      if (u.uMode && p.caMode !== undefined) u.uMode.value = p.caMode;
      if (u.uAngle && p.caAngle !== undefined) u.uAngle.value = p.caAngle;
      if (u.uCenterX && p.caCenterX !== undefined) u.uCenterX.value = p.caCenterX;
      if (u.uCenterY && p.caCenterY !== undefined) u.uCenterY.value = p.caCenterY;
      if (u.uEdgeFalloff && p.caEdgeFalloff !== undefined) u.uEdgeFalloff.value = p.caEdgeFalloff;
      if (u.uMix && p.caMix !== undefined) u.uMix.value = p.caMix;
      break;

    case 'godRays':
      if (u.uIntensity && p.godRaysIntensity !== undefined) u.uIntensity.value = p.godRaysIntensity;
      if (u.uDecay && p.godRaysDecay !== undefined) u.uDecay.value = p.godRaysDecay;
      if (u.uExposure && p.godRaysExposure !== undefined) u.uExposure.value = p.godRaysExposure;
      if (u.uDensity && p.godRaysDensity !== undefined) u.uDensity.value = p.godRaysDensity;
      if (u.uThreshold && p.godRaysThreshold !== undefined) u.uThreshold.value = p.godRaysThreshold;
      if (u.uCenterX && p.godRaysCenterX !== undefined) u.uCenterX.value = p.godRaysCenterX;
      if (u.uCenterY && p.godRaysCenterY !== undefined) u.uCenterY.value = p.godRaysCenterY;
      if (u.uSamples && p.godRaysSamples !== undefined) u.uSamples.value = p.godRaysSamples;
      if (u.uTintR && p.godRaysTintR !== undefined) u.uTintR.value = p.godRaysTintR;
      if (u.uTintG && p.godRaysTintG !== undefined) u.uTintG.value = p.godRaysTintG;
      if (u.uTintB && p.godRaysTintB !== undefined) u.uTintB.value = p.godRaysTintB;
      if (u.uMix && p.godRaysMix !== undefined) u.uMix.value = p.godRaysMix;
      break;

    case 'halation':
      if (u.uAmount && p.halationAmount !== undefined) u.uAmount.value = p.halationAmount;
      if (u.uRadius && p.halationRadius !== undefined) u.uRadius.value = p.halationRadius;
      if (u.uThreshold && p.halationThreshold !== undefined) u.uThreshold.value = p.halationThreshold;
      if (u.uTintR && p.halationTintR !== undefined) u.uTintR.value = p.halationTintR;
      if (u.uTintG && p.halationTintG !== undefined) u.uTintG.value = p.halationTintG;
      if (u.uTintB && p.halationTintB !== undefined) u.uTintB.value = p.halationTintB;
      if (u.uMode && p.halationMode !== undefined) u.uMode.value = p.halationMode;
      if (u.uMix && p.halationMix !== undefined) u.uMix.value = p.halationMix;
      break;

    case 'anamorphicStreak':
      if (u.uIntensity && p.anaIntensity !== undefined) u.uIntensity.value = p.anaIntensity;
      if (u.uLength && p.anaLength !== undefined) u.uLength.value = p.anaLength;
      if (u.uThreshold && p.anaThreshold !== undefined) u.uThreshold.value = p.anaThreshold;
      if (u.uTintR && p.anaTintR !== undefined) u.uTintR.value = p.anaTintR;
      if (u.uTintG && p.anaTintG !== undefined) u.uTintG.value = p.anaTintG;
      if (u.uTintB && p.anaTintB !== undefined) u.uTintB.value = p.anaTintB;
      if (u.uAngle && p.anaAngle !== undefined) u.uAngle.value = p.anaAngle;
      if (u.uSamples && p.anaSamples !== undefined) u.uSamples.value = p.anaSamples;
      if (u.uMix && p.anaMix !== undefined) u.uMix.value = p.anaMix;
      break;

    case 'lensDirt':
      if (u.uAmount && p.dirtAmount !== undefined) u.uAmount.value = p.dirtAmount;
      if (u.uScale && p.dirtScale !== undefined) u.uScale.value = p.dirtScale;
      if (u.uThreshold && p.dirtThreshold !== undefined) u.uThreshold.value = p.dirtThreshold;
      if (u.uTintWarmth && p.dirtTintWarmth !== undefined) u.uTintWarmth.value = p.dirtTintWarmth;
      if (u.uScratches && p.dirtScratches !== undefined) u.uScratches.value = p.dirtScratches;
      if (u.uSpots && p.dirtSpots !== undefined) u.uSpots.value = p.dirtSpots;
      if (u.uMode && p.dirtMode !== undefined) u.uMode.value = p.dirtMode;
      if (u.uAnimSpeed && p.dirtAnimSpeed !== undefined) u.uAnimSpeed.value = p.dirtAnimSpeed;
      break;

    case 'diffusionPromist':
      if (u.uAmount && p.diffAmount !== undefined) u.uAmount.value = p.diffAmount;
      if (u.uRadius && p.diffRadius !== undefined) u.uRadius.value = p.diffRadius;
      if (u.uThreshold && p.diffThreshold !== undefined) u.uThreshold.value = p.diffThreshold;
      if (u.uShadowLift && p.diffShadowLift !== undefined) u.uShadowLift.value = p.diffShadowLift;
      if (u.uHighlightBloom && p.diffHighlightBloom !== undefined) u.uHighlightBloom.value = p.diffHighlightBloom;
      if (u.uHaze && p.diffHaze !== undefined) u.uHaze.value = p.diffHaze;
      if (u.uHazeWarmth && p.diffHazeWarmth !== undefined) u.uHazeWarmth.value = p.diffHazeWarmth;
      if (u.uMix && p.diffMix !== undefined) u.uMix.value = p.diffMix;
      break;

    case 'filmGrain':
      if (u.uAmount && p.grainAmount !== undefined) u.uAmount.value = p.grainAmount;
      if (u.uSize && p.grainSize !== undefined) u.uSize.value = p.grainSize;
      if (u.uShadowGrain && p.grainShadow !== undefined) u.uShadowGrain.value = p.grainShadow;
      if (u.uMidGrain && p.grainMid !== undefined) u.uMidGrain.value = p.grainMid;
      if (u.uHighGrain && p.grainHigh !== undefined) u.uHighGrain.value = p.grainHigh;
      if (u.uMono && p.grainMono !== undefined) u.uMono.value = p.grainMono;
      if (u.uStock && p.grainStock !== undefined) u.uStock.value = p.grainStock;
      if (u.uColorJitter && p.grainColorJitter !== undefined) u.uColorJitter.value = p.grainColorJitter;
      if (u.uAnimSpeed && p.grainAnimSpeed !== undefined) u.uAnimSpeed.value = p.grainAnimSpeed;
      break;

    case 'heatHaze':
      if (u.uAmount && p.hazeAmount !== undefined) u.uAmount.value = p.hazeAmount;
      if (u.uScale && p.hazeScale !== undefined) u.uScale.value = p.hazeScale;
      if (u.uSpeed && p.hazeSpeed !== undefined) u.uSpeed.value = p.hazeSpeed;
      if (u.uDirectionY && p.hazeDirectionY !== undefined) u.uDirectionY.value = p.hazeDirectionY;
      if (u.uTurbulence && p.hazeTurbulence !== undefined) u.uTurbulence.value = p.hazeTurbulence;
      if (u.uMode && p.hazeMode !== undefined) u.uMode.value = p.hazeMode;
      if (u.uFocusY && p.hazeFocusY !== undefined) u.uFocusY.value = p.hazeFocusY;
      if (u.uFocusBand && p.hazeFocusBand !== undefined) u.uFocusBand.value = p.hazeFocusBand;
      break;

    case 'wave':
      if (u.uAmplitude && p.waveAmplitude !== undefined) u.uAmplitude.value = p.waveAmplitude;
      if (u.uFrequency && p.waveFrequency !== undefined) u.uFrequency.value = p.waveFrequency;
      if (u.uSpeed && p.waveSpeed !== undefined) u.uSpeed.value = p.waveSpeed;
      if (u.uType && p.waveType !== undefined) u.uType.value = p.waveType;
      if (u.uWaveform && p.waveWaveform !== undefined) u.uWaveform.value = p.waveWaveform;
      if (u.uPhase && p.wavePhase !== undefined) u.uPhase.value = p.wavePhase;
      if (u.uSecondaryAmt && p.waveSecondary !== undefined) u.uSecondaryAmt.value = p.waveSecondary;
      if (u.uChromaSplit && p.waveChromaSplit !== undefined) u.uChromaSplit.value = p.waveChromaSplit;
      break;

    case 'fisheye':
      if (u.uStrength && p.fisheyeStrength !== undefined) u.uStrength.value = p.fisheyeStrength;
      if (u.uRadius && p.fisheyeRadius !== undefined) u.uRadius.value = p.fisheyeRadius;
      if (u.uCenterX && p.fisheyeCenterX !== undefined) u.uCenterX.value = p.fisheyeCenterX;
      if (u.uCenterY && p.fisheyeCenterY !== undefined) u.uCenterY.value = p.fisheyeCenterY;
      if (u.uZoom && p.fisheyeZoom !== undefined) u.uZoom.value = p.fisheyeZoom;
      if (u.uMode && p.fisheyeMode !== undefined) u.uMode.value = p.fisheyeMode;
      if (u.uChromaEdge && p.fisheyeChromaEdge !== undefined) u.uChromaEdge.value = p.fisheyeChromaEdge;
      break;

    case 'crt':
      if (u.uScanlines && p.crtScanlines !== undefined) u.uScanlines.value = p.crtScanlines;
      if (u.uScanCount && p.crtScanCount !== undefined) u.uScanCount.value = p.crtScanCount;
      if (u.uMask && p.crtMask !== undefined) u.uMask.value = p.crtMask;
      if (u.uMaskType && p.crtMaskType !== undefined) u.uMaskType.value = p.crtMaskType;
      if (u.uCurvature && p.crtCurvature !== undefined) u.uCurvature.value = p.crtCurvature;
      if (u.uVignette && p.crtVignette !== undefined) u.uVignette.value = p.crtVignette;
      if (u.uGlow && p.crtGlow !== undefined) u.uGlow.value = p.crtGlow;
      if (u.uRollingBar && p.crtRollingBar !== undefined) u.uRollingBar.value = p.crtRollingBar;
      if (u.uChromatic && p.crtChromatic !== undefined) u.uChromatic.value = p.crtChromatic;
      break;

    case 'lensDistortion':
      if (u.uAmount && p.lensDistAmount !== undefined) u.uAmount.value = p.lensDistAmount;
      if (u.uMode && p.lensDistMode !== undefined) u.uMode.value = p.lensDistMode;
      if (u.uCenterX && p.lensDistCenterX !== undefined) u.uCenterX.value = p.lensDistCenterX;
      if (u.uCenterY && p.lensDistCenterY !== undefined) u.uCenterY.value = p.lensDistCenterY;
      if (u.uCubic && p.lensDistCubic !== undefined) u.uCubic.value = p.lensDistCubic;
      if (u.uAnamorphicX && p.lensDistAnamorphicX !== undefined) u.uAnamorphicX.value = p.lensDistAnamorphicX;
      if (u.uEdgeFade && p.lensDistEdgeFade !== undefined) u.uEdgeFade.value = p.lensDistEdgeFade;
      if (u.uChromaFringe && p.lensDistChromaFringe !== undefined) u.uChromaFringe.value = p.lensDistChromaFringe;
      break;

    case 'chromaKey':
      if (u.uKeyR && p.chromaKeyR !== undefined) u.uKeyR.value = p.chromaKeyR;
      if (u.uKeyG && p.chromaKeyG !== undefined) u.uKeyG.value = p.chromaKeyG;
      if (u.uKeyB && p.chromaKeyB !== undefined) u.uKeyB.value = p.chromaKeyB;
      if (u.uTolerance && p.chromaKeyTolerance !== undefined) u.uTolerance.value = p.chromaKeyTolerance;
      if (u.uSoftness && p.chromaKeySoftness !== undefined) u.uSoftness.value = p.chromaKeySoftness;
      if (u.uSpillSuppress && p.chromaKeySpill !== undefined) u.uSpillSuppress.value = p.chromaKeySpill;
      if (u.uMatte && p.chromaKeyMatte !== undefined) u.uMatte.value = p.chromaKeyMatte;
      if (u.uMode && p.chromaKeyMode !== undefined) u.uMode.value = p.chromaKeyMode;
      break;

    case 'lumaKey':
      if (u.uLowCut && p.lumaKeyLowCut !== undefined) u.uLowCut.value = p.lumaKeyLowCut;
      if (u.uHighCut && p.lumaKeyHighCut !== undefined) u.uHighCut.value = p.lumaKeyHighCut;
      if (u.uInvert && p.lumaKeyInvert !== undefined) u.uInvert.value = p.lumaKeyInvert;
      if (u.uGamma && p.lumaKeyGamma !== undefined) u.uGamma.value = p.lumaKeyGamma;
      if (u.uMatte && p.lumaKeyMatte !== undefined) u.uMatte.value = p.lumaKeyMatte;
      if (u.uPremultiply && p.lumaKeyPremultiply !== undefined) u.uPremultiply.value = p.lumaKeyPremultiply;
      break;

    case 'differenceKey':
      if (u.uRefR && p.diffKeyR !== undefined) u.uRefR.value = p.diffKeyR;
      if (u.uRefG && p.diffKeyG !== undefined) u.uRefG.value = p.diffKeyG;
      if (u.uRefB && p.diffKeyB !== undefined) u.uRefB.value = p.diffKeyB;
      if (u.uTolerance && p.diffKeyTolerance !== undefined) u.uTolerance.value = p.diffKeyTolerance;
      if (u.uSoftness && p.diffKeySoftness !== undefined) u.uSoftness.value = p.diffKeySoftness;
      if (u.uInvert && p.diffKeyInvert !== undefined) u.uInvert.value = p.diffKeyInvert;
      if (u.uMatte && p.diffKeyMatte !== undefined) u.uMatte.value = p.diffKeyMatte;
      if (u.uMode && p.diffKeyMode !== undefined) u.uMode.value = p.diffKeyMode;
      break;

    case 'thermal':
      if (u.uIntensity && p.thermalIntensity !== undefined) u.uIntensity.value = p.thermalIntensity;
      if (u.uPalette && p.thermalPalette !== undefined) u.uPalette.value = p.thermalPalette;
      if (u.uShimmer && p.thermalShimmer !== undefined) u.uShimmer.value = p.thermalShimmer;
      if (u.uSensorNoise && p.thermalSensorNoise !== undefined) u.uSensorNoise.value = p.thermalSensorNoise;
      break;

    case 'nightVision':
      if (u.uIntensity && p.nightVisionIntensity !== undefined) u.uIntensity.value = p.nightVisionIntensity;
      if (u.uNoise && p.nightVisionNoise !== undefined) u.uNoise.value = p.nightVisionNoise;
      if (u.uVignette && p.nightVisionVignette !== undefined) u.uVignette.value = p.nightVisionVignette;
      if (u.uPhosphor && p.nightVisionPhosphor !== undefined) u.uPhosphor.value = p.nightVisionPhosphor;
      if (u.uBloom && p.nightVisionBloom !== undefined) u.uBloom.value = p.nightVisionBloom;
      if (u.uScopeMask && p.nightVisionScopeMask !== undefined) u.uScopeMask.value = p.nightVisionScopeMask;
      if (u.uRollingNoise && p.nightVisionRollingNoise !== undefined) u.uRollingNoise.value = p.nightVisionRollingNoise;
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

    case 'bloom':
      if (u.uAmount && p.amount !== undefined) u.uAmount.value = p.amount;
      if (u.uIntensity && p.bloomIntensity !== undefined) u.uIntensity.value = p.bloomIntensity;
      if (u.uThreshold && p.threshold !== undefined) u.uThreshold.value = p.threshold;
      if (u.uKnee && p.bloomKnee !== undefined) u.uKnee.value = p.bloomKnee;
      if (u.uRadius && p.bloomRadius !== undefined) u.uRadius.value = p.bloomRadius;
      if (u.uAnamorphic && p.bloomAnamorphic !== undefined) u.uAnamorphic.value = p.bloomAnamorphic;
      if (u.uTintR && p.red !== undefined) u.uTintR.value = p.red;
      if (u.uTintG && p.green !== undefined) u.uTintG.value = p.green;
      if (u.uTintB && p.blue !== undefined) u.uTintB.value = p.blue;
      break;

    case 'feedbackZoom':
      if (u.uAmount && p.amount !== undefined) u.uAmount.value = p.amount;
      if (u.uZoom && p.feedbackZoom !== undefined) u.uZoom.value = p.feedbackZoom;
      if (u.uRotation && p.feedbackRotation !== undefined) u.uRotation.value = p.feedbackRotation;
      if (u.uDecay && p.feedbackDecay !== undefined) u.uDecay.value = p.feedbackDecay;
      if (u.uHueShift && p.feedbackHueShift !== undefined) u.uHueShift.value = p.feedbackHueShift;
      if (u.uMaskCenter && p.feedbackMaskCenter !== undefined) u.uMaskCenter.value = p.feedbackMaskCenter;
      break;

    case 'exposure':
      if (u.uExposure && p.exposureStops !== undefined) u.uExposure.value = p.exposureStops;
      if (u.uRollOff && p.exposureRollOff !== undefined) u.uRollOff.value = p.exposureRollOff;
      if (u.uHighlightProtect && p.exposureHighlightProtect !== undefined) u.uHighlightProtect.value = p.exposureHighlightProtect;
      break;

    case 'gamma':
      if (u.uShadows && p.gammaShadows !== undefined) u.uShadows.value = p.gammaShadows;
      if (u.uMids && p.gammaMids !== undefined) u.uMids.value = p.gammaMids;
      if (u.uHighlights && p.gammaHighlights !== undefined) u.uHighlights.value = p.gammaHighlights;
      if (u.uMix && p.gammaMix !== undefined) u.uMix.value = p.gammaMix;
      break;

    case 'vibrance':
      if (u.uVibrance && p.vibranceAmount !== undefined) u.uVibrance.value = p.vibranceAmount;
      if (u.uSkinProtect && p.vibranceSkinProtect !== undefined) u.uSkinProtect.value = p.vibranceSkinProtect;
      if (u.uHighlightProtect && p.vibranceHighlightProtect !== undefined) u.uHighlightProtect.value = p.vibranceHighlightProtect;
      if (u.uCeiling && p.vibranceCeiling !== undefined) u.uCeiling.value = p.vibranceCeiling;
      break;

    case 'temperatureTint':
      if (u.uTemperature && p.tempTemperature !== undefined) u.uTemperature.value = p.tempTemperature;
      if (u.uTint && p.tempTint !== undefined) u.uTint.value = p.tempTint;
      if (u.uShadowTemp && p.tempShadow !== undefined) u.uShadowTemp.value = p.tempShadow;
      if (u.uHighlightTemp && p.tempHighlight !== undefined) u.uHighlightTemp.value = p.tempHighlight;
      if (u.uSplitTone && p.tempSplitTone !== undefined) u.uSplitTone.value = p.tempSplitTone;
      if (u.uAutoCycle && p.tempAutoCycle !== undefined) u.uAutoCycle.value = p.tempAutoCycle;
      break;

    case 'colorBalance':
      if (u.uShadowR && p.cbShadowR !== undefined) u.uShadowR.value = p.cbShadowR;
      if (u.uShadowG && p.cbShadowG !== undefined) u.uShadowG.value = p.cbShadowG;
      if (u.uShadowB && p.cbShadowB !== undefined) u.uShadowB.value = p.cbShadowB;
      if (u.uMidR && p.cbMidR !== undefined) u.uMidR.value = p.cbMidR;
      if (u.uMidG && p.cbMidG !== undefined) u.uMidG.value = p.cbMidG;
      if (u.uMidB && p.cbMidB !== undefined) u.uMidB.value = p.cbMidB;
      if (u.uHighR && p.cbHighR !== undefined) u.uHighR.value = p.cbHighR;
      if (u.uHighG && p.cbHighG !== undefined) u.uHighG.value = p.cbHighG;
      if (u.uHighB && p.cbHighB !== undefined) u.uHighB.value = p.cbHighB;
      if (u.uPreserveLuma && p.cbPreserveLuma !== undefined) u.uPreserveLuma.value = p.cbPreserveLuma;
      if (u.uMix && p.cbMix !== undefined) u.uMix.value = p.cbMix;
      break;

    case 'curves':
      if (u.uContrast && p.curvesContrast !== undefined) u.uContrast.value = p.curvesContrast;
      if (u.uToe && p.curvesToe !== undefined) u.uToe.value = p.curvesToe;
      if (u.uShoulder && p.curvesShoulder !== undefined) u.uShoulder.value = p.curvesShoulder;
      if (u.uBlackCrush && p.curvesBlackCrush !== undefined) u.uBlackCrush.value = p.curvesBlackCrush;
      if (u.uMix && p.curvesMix !== undefined) u.uMix.value = p.curvesMix;
      break;

    case 'liftGammaGain':
      if (u.uLiftR && p.lggLiftR !== undefined) u.uLiftR.value = p.lggLiftR;
      if (u.uLiftG && p.lggLiftG !== undefined) u.uLiftG.value = p.lggLiftG;
      if (u.uLiftB && p.lggLiftB !== undefined) u.uLiftB.value = p.lggLiftB;
      if (u.uGammaR && p.lggGammaR !== undefined) u.uGammaR.value = p.lggGammaR;
      if (u.uGammaG && p.lggGammaG !== undefined) u.uGammaG.value = p.lggGammaG;
      if (u.uGammaB && p.lggGammaB !== undefined) u.uGammaB.value = p.lggGammaB;
      if (u.uGainR && p.lggGainR !== undefined) u.uGainR.value = p.lggGainR;
      if (u.uGainG && p.lggGainG !== undefined) u.uGainG.value = p.lggGainG;
      if (u.uGainB && p.lggGainB !== undefined) u.uGainB.value = p.lggGainB;
      if (u.uLumaOnly && p.lggLumaOnly !== undefined) u.uLumaOnly.value = p.lggLumaOnly;
      if (u.uMix && p.lggMix !== undefined) u.uMix.value = p.lggMix;
      break;

    case 'filmicTonemap':
      if (u.uCurve && p.tonemapCurve !== undefined) u.uCurve.value = p.tonemapCurve;
      if (u.uExposure && p.tonemapExposure !== undefined) u.uExposure.value = p.tonemapExposure;
      if (u.uContrast && p.tonemapContrast !== undefined) u.uContrast.value = p.tonemapContrast;
      if (u.uMix && p.tonemapMix !== undefined) u.uMix.value = p.tonemapMix;
      break;

    case 'selectiveColor':
      if (u.uTargetHue && p.selColorTargetHue !== undefined) u.uTargetHue.value = p.selColorTargetHue;
      if (u.uHueRange && p.selColorRange !== undefined) u.uHueRange.value = p.selColorRange;
      if (u.uFeather && p.selColorFeather !== undefined) u.uFeather.value = p.selColorFeather;
      if (u.uMode && p.selColorMode !== undefined) u.uMode.value = p.selColorMode;
      if (u.uReplaceHue && p.selColorReplaceHue !== undefined) u.uReplaceHue.value = p.selColorReplaceHue;
      if (u.uSatBoost && p.selColorSatBoost !== undefined) u.uSatBoost.value = p.selColorSatBoost;
      break;

    case 'compressionArtifacts':
      if (u.uBlockSize && p.compArtBlockSize !== undefined) u.uBlockSize.value = p.compArtBlockSize;
      if (u.uQuality && p.compArtQuality !== undefined) u.uQuality.value = p.compArtQuality;
      if (u.uChromaSubsample && p.compArtChromaSubsample !== undefined) u.uChromaSubsample.value = p.compArtChromaSubsample;
      if (u.uBlockNoise && p.compArtBlockNoise !== undefined) u.uBlockNoise.value = p.compArtBlockNoise;
      if (u.uMode && p.compArtMode !== undefined) u.uMode.value = p.compArtMode;
      if (u.uMix && p.compArtMix !== undefined) u.uMix.value = p.compArtMix;
      break;

    case 'erode':
      if (u.uRadius && p.erodeRadius !== undefined) u.uRadius.value = p.erodeRadius;
      if (u.uShape && p.erodeShape !== undefined) u.uShape.value = p.erodeShape;
      if (u.uChannel && p.erodeChannel !== undefined) u.uChannel.value = p.erodeChannel;
      if (u.uMix && p.erodeMix !== undefined) u.uMix.value = p.erodeMix;
      break;

    case 'dilate':
      if (u.uRadius && p.dilateRadius !== undefined) u.uRadius.value = p.dilateRadius;
      if (u.uShape && p.dilateShape !== undefined) u.uShape.value = p.dilateShape;
      if (u.uChannel && p.dilateChannel !== undefined) u.uChannel.value = p.dilateChannel;
      if (u.uMix && p.dilateMix !== undefined) u.uMix.value = p.dilateMix;
      break;

    case 'displacement':
      if (u.uAmount && p.dispAmount !== undefined) u.uAmount.value = p.dispAmount;
      if (u.uScale && p.dispScale !== undefined) u.uScale.value = p.dispScale;
      if (u.uSpeed && p.dispSpeed !== undefined) u.uSpeed.value = p.dispSpeed;
      if (u.uMode && p.dispMode !== undefined) u.uMode.value = p.dispMode;
      if (u.uTurbulence && p.dispTurbulence !== undefined) u.uTurbulence.value = p.dispTurbulence;
      if (u.uChromatic && p.dispChromatic !== undefined) u.uChromatic.value = p.dispChromatic;
      break;

    case 'twirl':
      if (u.uAngle && p.twirlAngle !== undefined) u.uAngle.value = p.twirlAngle;
      if (u.uRadius && p.twirlRadius !== undefined) u.uRadius.value = p.twirlRadius;
      if (u.uCenterX && p.twirlCenterX !== undefined) u.uCenterX.value = p.twirlCenterX;
      if (u.uCenterY && p.twirlCenterY !== undefined) u.uCenterY.value = p.twirlCenterY;
      if (u.uFalloff && p.twirlFalloff !== undefined) u.uFalloff.value = p.twirlFalloff;
      if (u.uAnimSpeed && p.twirlAnimSpeed !== undefined) u.uAnimSpeed.value = p.twirlAnimSpeed;
      if (u.uMix && p.twirlMix !== undefined) u.uMix.value = p.twirlMix;
      break;

    case 'pinchBulge':
      if (u.uAmount && p.pinchAmount !== undefined) u.uAmount.value = p.pinchAmount;
      if (u.uRadius && p.pinchRadius !== undefined) u.uRadius.value = p.pinchRadius;
      if (u.uCenterX && p.pinchCenterX !== undefined) u.uCenterX.value = p.pinchCenterX;
      if (u.uCenterY && p.pinchCenterY !== undefined) u.uCenterY.value = p.pinchCenterY;
      if (u.uFalloff && p.pinchFalloff !== undefined) u.uFalloff.value = p.pinchFalloff;
      if (u.uChromatic && p.pinchChromatic !== undefined) u.uChromatic.value = p.pinchChromatic;
      if (u.uMix && p.pinchMix !== undefined) u.uMix.value = p.pinchMix;
      break;

    case 'polarTransform':
      if (u.uMode && p.polarMode !== undefined) u.uMode.value = p.polarMode;
      if (u.uRotation && p.polarRotation !== undefined) u.uRotation.value = p.polarRotation;
      if (u.uZoom && p.polarZoom !== undefined) u.uZoom.value = p.polarZoom;
      if (u.uCenterX && p.polarCenterX !== undefined) u.uCenterX.value = p.polarCenterX;
      if (u.uCenterY && p.polarCenterY !== undefined) u.uCenterY.value = p.polarCenterY;
      if (u.uMix && p.polarMix !== undefined) u.uMix.value = p.polarMix;
      break;

    case 'falseColor':
      if (u.uMode && p.falseColorMode !== undefined) u.uMode.value = p.falseColorMode;
      if (u.uMix && p.falseColorMix !== undefined) u.uMix.value = p.falseColorMix;
      if (u.uShowOriginal && p.falseColorShowOriginal !== undefined) u.uShowOriginal.value = p.falseColorShowOriginal;
      if (u.uMidpoint && p.falseColorMidpoint !== undefined) u.uMidpoint.value = p.falseColorMidpoint;
      if (u.uRange && p.falseColorRange !== undefined) u.uRange.value = p.falseColorRange;
      break;

    case 'shadowRecovery':
      if (u.uAmount && p.shadowAmount !== undefined) u.uAmount.value = p.shadowAmount;
      if (u.uThreshold && p.shadowThreshold !== undefined) u.uThreshold.value = p.shadowThreshold;
      if (u.uSoftness && p.shadowSoftness !== undefined) u.uSoftness.value = p.shadowSoftness;
      if (u.uColorRecovery && p.shadowColorRecovery !== undefined) u.uColorRecovery.value = p.shadowColorRecovery;
      if (u.uHighlightProtect && p.shadowHighlightProtect !== undefined) u.uHighlightProtect.value = p.shadowHighlightProtect;
      if (u.uMix && p.shadowMix !== undefined) u.uMix.value = p.shadowMix;
      break;

    case 'highlightRolloff':
      if (u.uAmount && p.highRolloffAmount !== undefined) u.uAmount.value = p.highRolloffAmount;
      if (u.uThreshold && p.highRolloffThreshold !== undefined) u.uThreshold.value = p.highRolloffThreshold;
      if (u.uSoftness && p.highRolloffSoftness !== undefined) u.uSoftness.value = p.highRolloffSoftness;
      if (u.uPreserveHue && p.highRolloffPreserveHue !== undefined) u.uPreserveHue.value = p.highRolloffPreserveHue;
      if (u.uMaxValue && p.highRolloffMaxValue !== undefined) u.uMaxValue.value = p.highRolloffMaxValue;
      if (u.uMix && p.highRolloffMix !== undefined) u.uMix.value = p.highRolloffMix;
      break;

    case 'ascii':
      if (u.uCellSize && p.asciiCellSize !== undefined) u.uCellSize.value = p.asciiCellSize;
      if (u.uContrast && p.asciiContrast !== undefined) u.uContrast.value = p.asciiContrast;
      if (u.uColorMix && p.asciiColorMix !== undefined) u.uColorMix.value = p.asciiColorMix;
      if (u.uMode && p.asciiMode !== undefined) u.uMode.value = p.asciiMode;
      if (u.uInvert && p.asciiInvert !== undefined) u.uInvert.value = p.asciiInvert;
      if (u.uTintR && p.asciiTintR !== undefined) u.uTintR.value = p.asciiTintR;
      if (u.uTintG && p.asciiTintG !== undefined) u.uTintG.value = p.asciiTintG;
      if (u.uTintB && p.asciiTintB !== undefined) u.uTintB.value = p.asciiTintB;
      break;

    case 'comicInk':
      if (u.uInkStrength && p.comicInkStrength !== undefined) u.uInkStrength.value = p.comicInkStrength;
      if (u.uInkThreshold && p.comicInkThreshold !== undefined) u.uInkThreshold.value = p.comicInkThreshold;
      if (u.uPosterize && p.comicInkPosterize !== undefined) u.uPosterize.value = p.comicInkPosterize;
      if (u.uHalftoneShadow && p.comicInkHalftone !== undefined) u.uHalftoneShadow.value = p.comicInkHalftone;
      if (u.uHalftoneSize && p.comicInkHalftoneSize !== undefined) u.uHalftoneSize.value = p.comicInkHalftoneSize;
      if (u.uColorMix && p.comicInkColorMix !== undefined) u.uColorMix.value = p.comicInkColorMix;
      if (u.uInkR && p.comicInkR !== undefined) u.uInkR.value = p.comicInkR;
      if (u.uInkG && p.comicInkG !== undefined) u.uInkG.value = p.comicInkG;
      if (u.uInkB && p.comicInkB !== undefined) u.uInkB.value = p.comicInkB;
      break;

    case 'datamoshLite':
      // Reverted: route generic premiumPack params (amount/amount2/amount3).
      if (u.uMode) u.uMode.value = premiumEffectModes['datamoshLite'] ?? 12;
      if (u.uAmount) u.uAmount.value = p.amount ?? p.datamoshIntensity ?? 0.5;
      if (u.uAmount2) u.uAmount2.value = p.amount2 ?? p.datamoshSmear ?? 0.3;
      if (u.uAmount3) u.uAmount3.value = p.amount3 ?? p.datamoshChannelSplit ?? 0.4;
      break;

    case 'scanlineDrift':
      if (u.uIntensity && p.scanDriftIntensity !== undefined) u.uIntensity.value = p.scanDriftIntensity;
      if (u.uFrequency && p.scanDriftFrequency !== undefined) u.uFrequency.value = p.scanDriftFrequency;
      if (u.uSpeed && p.scanDriftSpeed !== undefined) u.uSpeed.value = p.scanDriftSpeed;
      if (u.uWaveform && p.scanDriftWaveform !== undefined) u.uWaveform.value = p.scanDriftWaveform;
      if (u.uChromaSplit && p.scanDriftChromaSplit !== undefined) u.uChromaSplit.value = p.scanDriftChromaSplit;
      if (u.uChunkiness && p.scanDriftChunkiness !== undefined) u.uChunkiness.value = p.scanDriftChunkiness;
      break;

    case 'tapeDropout':
      if (u.uDensity && p.tapeDropoutDensity !== undefined) u.uDensity.value = p.tapeDropoutDensity;
      if (u.uLength && p.tapeDropoutLength !== undefined) u.uLength.value = p.tapeDropoutLength;
      if (u.uColor && p.tapeDropoutColor !== undefined) u.uColor.value = p.tapeDropoutColor;
      if (u.uSpeed && p.tapeDropoutSpeed !== undefined) u.uSpeed.value = p.tapeDropoutSpeed;
      if (u.uNoiseAmp && p.tapeDropoutNoise !== undefined) u.uNoiseAmp.value = p.tapeDropoutNoise;
      if (u.uMix && p.tapeDropoutMix !== undefined) u.uMix.value = p.tapeDropoutMix;
      break;

    case 'rippleCaustics':
      if (u.uIntensity && p.causticsIntensity !== undefined) u.uIntensity.value = p.causticsIntensity;
      if (u.uScale && p.causticsScale !== undefined) u.uScale.value = p.causticsScale;
      if (u.uSpeed && p.causticsSpeed !== undefined) u.uSpeed.value = p.causticsSpeed;
      if (u.uRefraction && p.causticsRefraction !== undefined) u.uRefraction.value = p.causticsRefraction;
      if (u.uTintR && p.causticsTintR !== undefined) u.uTintR.value = p.causticsTintR;
      if (u.uTintG && p.causticsTintG !== undefined) u.uTintG.value = p.causticsTintG;
      if (u.uTintB && p.causticsTintB !== undefined) u.uTintB.value = p.causticsTintB;
      if (u.uMode && p.causticsMode !== undefined) u.uMode.value = p.causticsMode;
      break;

    case 'shockwave':
      if (u.uTriggerTime && p.shockTriggerTime !== undefined) u.uTriggerTime.value = p.shockTriggerTime;
      if (u.uSpeed && p.shockSpeed !== undefined) u.uSpeed.value = p.shockSpeed;
      if (u.uAmplitude && p.shockAmplitude !== undefined) u.uAmplitude.value = p.shockAmplitude;
      if (u.uRingWidth && p.shockRingWidth !== undefined) u.uRingWidth.value = p.shockRingWidth;
      if (u.uCenterX && p.shockCenterX !== undefined) u.uCenterX.value = p.shockCenterX;
      if (u.uCenterY && p.shockCenterY !== undefined) u.uCenterY.value = p.shockCenterY;
      if (u.uChromatic && p.shockChromatic !== undefined) u.uChromatic.value = p.shockChromatic;
      if (u.uMode && p.shockMode !== undefined) u.uMode.value = p.shockMode;
      break;

    case 'drosteRecursive':
      if (u.uZoom && p.drosteZoom !== undefined) u.uZoom.value = p.drosteZoom;
      if (u.uRotation && p.drosteRotation !== undefined) u.uRotation.value = p.drosteRotation;
      if (u.uIterations && p.drosteIterations !== undefined) u.uIterations.value = p.drosteIterations;
      if (u.uOffsetX && p.drosteOffsetX !== undefined) u.uOffsetX.value = p.drosteOffsetX;
      if (u.uOffsetY && p.drosteOffsetY !== undefined) u.uOffsetY.value = p.drosteOffsetY;
      if (u.uFrameSize && p.drosteFrameSize !== undefined) u.uFrameSize.value = p.drosteFrameSize;
      if (u.uMix && p.drosteMix !== undefined) u.uMix.value = p.drosteMix;
      break;

    case 'slitScan':
      if (u.uIntensity && p.slitScanIntensity !== undefined) u.uIntensity.value = p.slitScanIntensity;
      if (u.uMode && p.slitScanMode !== undefined) u.uMode.value = p.slitScanMode;
      if (u.uPattern && p.slitScanPattern !== undefined) u.uPattern.value = p.slitScanPattern;
      if (u.uSpeed && p.slitScanSpeed !== undefined) u.uSpeed.value = p.slitScanSpeed;
      if (u.uChromaSplit && p.slitScanChromaSplit !== undefined) u.uChromaSplit.value = p.slitScanChromaSplit;
      break;

    case 'volumetricFogOverlay':
      if (u.uDensity && p.fogDensity !== undefined) u.uDensity.value = p.fogDensity;
      if (u.uScale && p.fogScale !== undefined) u.uScale.value = p.fogScale;
      if (u.uSpeed && p.fogSpeed !== undefined) u.uSpeed.value = p.fogSpeed;
      if (u.uHeightFalloff && p.fogHeightFalloff !== undefined) u.uHeightFalloff.value = p.fogHeightFalloff;
      if (u.uDepthSim && p.fogDepthSim !== undefined) u.uDepthSim.value = p.fogDepthSim;
      if (u.uColorR && p.fogColorR !== undefined) u.uColorR.value = p.fogColorR;
      if (u.uColorG && p.fogColorG !== undefined) u.uColorG.value = p.fogColorG;
      if (u.uColorB && p.fogColorB !== undefined) u.uColorB.value = p.fogColorB;
      if (u.uTurbulence && p.fogTurbulence !== undefined) u.uTurbulence.value = p.fogTurbulence;
      if (u.uMode && p.fogMode !== undefined) u.uMode.value = p.fogMode;
      break;

    case 'rainFogSnowOverlay':
      if (u.uType && p.weatherType !== undefined) u.uType.value = p.weatherType;
      if (u.uDensity && p.weatherDensity !== undefined) u.uDensity.value = p.weatherDensity;
      if (u.uSpeed && p.weatherSpeed !== undefined) u.uSpeed.value = p.weatherSpeed;
      if (u.uAngle && p.weatherAngle !== undefined) u.uAngle.value = p.weatherAngle;
      if (u.uSize && p.weatherSize !== undefined) u.uSize.value = p.weatherSize;
      if (u.uFogAmount && p.weatherFog !== undefined) u.uFogAmount.value = p.weatherFog;
      if (u.uColorR && p.weatherColorR !== undefined) u.uColorR.value = p.weatherColorR;
      if (u.uColorG && p.weatherColorG !== undefined) u.uColorG.value = p.weatherColorG;
      if (u.uColorB && p.weatherColorB !== undefined) u.uColorB.value = p.weatherColorB;
      break;

    case 'particleOverlayFx':
      if (u.uMode && p.partMode !== undefined) u.uMode.value = p.partMode;
      if (u.uDensity && p.partDensity !== undefined) u.uDensity.value = p.partDensity;
      if (u.uSize && p.partSize !== undefined) u.uSize.value = p.partSize;
      if (u.uSpeed && p.partSpeed !== undefined) u.uSpeed.value = p.partSpeed;
      if (u.uTwinkle && p.partTwinkle !== undefined) u.uTwinkle.value = p.partTwinkle;
      if (u.uColorR && p.partColorR !== undefined) u.uColorR.value = p.partColorR;
      if (u.uColorG && p.partColorG !== undefined) u.uColorG.value = p.partColorG;
      if (u.uColorB && p.partColorB !== undefined) u.uColorB.value = p.partColorB;
      if (u.uBlend && p.partBlend !== undefined) u.uBlend.value = p.partBlend;
      break;

    case 'glintStarburst':
      if (u.uIntensity && p.glintIntensity !== undefined) u.uIntensity.value = p.glintIntensity;
      if (u.uThreshold && p.glintThreshold !== undefined) u.uThreshold.value = p.glintThreshold;
      if (u.uLength && p.glintLength !== undefined) u.uLength.value = p.glintLength;
      if (u.uPoints && p.glintPoints !== undefined) u.uPoints.value = p.glintPoints;
      if (u.uRotation && p.glintRotation !== undefined) u.uRotation.value = p.glintRotation;
      if (u.uColorR && p.glintColorR !== undefined) u.uColorR.value = p.glintColorR;
      if (u.uColorG && p.glintColorG !== undefined) u.uColorG.value = p.glintColorG;
      if (u.uColorB && p.glintColorB !== undefined) u.uColorB.value = p.glintColorB;
      break;

    case 'embossRelight':
      if (u.uStrength && p.embRelStrength !== undefined) u.uStrength.value = p.embRelStrength;
      if (u.uAngle && p.embRelAngle !== undefined) u.uAngle.value = p.embRelAngle;
      if (u.uHeight && p.embRelHeight !== undefined) u.uHeight.value = p.embRelHeight;
      if (u.uDetail && p.embRelDetail !== undefined) u.uDetail.value = p.embRelDetail;
      if (u.uSpecular && p.embRelSpecular !== undefined) u.uSpecular.value = p.embRelSpecular;
      if (u.uColorPreserve && p.embRelColorPreserve !== undefined) u.uColorPreserve.value = p.embRelColorPreserve;
      if (u.uAmbient && p.embRelAmbient !== undefined) u.uAmbient.value = p.embRelAmbient;
      break;

    case 'dotMatrix':
      if (u.uDotSize && p.dmDotSize !== undefined) u.uDotSize.value = p.dmDotSize;
      if (u.uDotShape && p.dmDotShape !== undefined) u.uDotShape.value = p.dmDotShape;
      if (u.uGap && p.dmGap !== undefined) u.uGap.value = p.dmGap;
      if (u.uPosterize && p.dmPosterize !== undefined) u.uPosterize.value = p.dmPosterize;
      if (u.uGlow && p.dmGlow !== undefined) u.uGlow.value = p.dmGlow;
      if (u.uBgR && p.dmBgR !== undefined) u.uBgR.value = p.dmBgR;
      if (u.uBgG && p.dmBgG !== undefined) u.uBgG.value = p.dmBgG;
      if (u.uBgB && p.dmBgB !== undefined) u.uBgB.value = p.dmBgB;
      break;

    case 'matrixRain':
      if (u.uDensity && p.matrixDensity !== undefined) u.uDensity.value = p.matrixDensity;
      if (u.uSpeed && p.matrixSpeed !== undefined) u.uSpeed.value = p.matrixSpeed;
      if (u.uCellSize && p.matrixCellSize !== undefined) u.uCellSize.value = p.matrixCellSize;
      if (u.uTrailLength && p.matrixTrailLength !== undefined) u.uTrailLength.value = p.matrixTrailLength;
      if (u.uColorR && p.matrixColorR !== undefined) u.uColorR.value = p.matrixColorR;
      if (u.uColorG && p.matrixColorG !== undefined) u.uColorG.value = p.matrixColorG;
      if (u.uColorB && p.matrixColorB !== undefined) u.uColorB.value = p.matrixColorB;
      if (u.uBgMix && p.matrixBgMix !== undefined) u.uBgMix.value = p.matrixBgMix;
      break;

    case 'binaryCode':
      if (u.uDensity && p.binDensity !== undefined) u.uDensity.value = p.binDensity;
      if (u.uSpeed && p.binSpeed !== undefined) u.uSpeed.value = p.binSpeed;
      if (u.uCellSize && p.binCellSize !== undefined) u.uCellSize.value = p.binCellSize;
      if (u.uColorR && p.binColorR !== undefined) u.uColorR.value = p.binColorR;
      if (u.uColorG && p.binColorG !== undefined) u.uColorG.value = p.binColorG;
      if (u.uColorB && p.binColorB !== undefined) u.uColorB.value = p.binColorB;
      if (u.uBgMix && p.binBgMix !== undefined) u.uBgMix.value = p.binBgMix;
      if (u.uContrast && p.binContrast !== undefined) u.uContrast.value = p.binContrast;
      break;

    case 'crosshatch':
      if (u.uDensity && p.hatchDensity !== undefined) u.uDensity.value = p.hatchDensity;
      if (u.uAngle && p.hatchAngle !== undefined) u.uAngle.value = p.hatchAngle;
      if (u.uLineWidth && p.hatchLineWidth !== undefined) u.uLineWidth.value = p.hatchLineWidth;
      if (u.uContrast && p.hatchContrast !== undefined) u.uContrast.value = p.hatchContrast;
      if (u.uPaperR && p.hatchPaperR !== undefined) u.uPaperR.value = p.hatchPaperR;
      if (u.uPaperG && p.hatchPaperG !== undefined) u.uPaperG.value = p.hatchPaperG;
      if (u.uPaperB && p.hatchPaperB !== undefined) u.uPaperB.value = p.hatchPaperB;
      if (u.uInkR && p.hatchInkR !== undefined) u.uInkR.value = p.hatchInkR;
      if (u.uInkG && p.hatchInkG !== undefined) u.uInkG.value = p.hatchInkG;
      if (u.uInkB && p.hatchInkB !== undefined) u.uInkB.value = p.hatchInkB;
      break;

    case 'blockMosaic':
      if (u.uTileSize && p.mosaicTileSize !== undefined) u.uTileSize.value = p.mosaicTileSize;
      if (u.uMode && p.mosaicMode !== undefined) u.uMode.value = p.mosaicMode;
      if (u.uGrout && p.mosaicGrout !== undefined) u.uGrout.value = p.mosaicGrout;
      if (u.uColorJitter && p.mosaicColorJitter !== undefined) u.uColorJitter.value = p.mosaicColorJitter;
      if (u.uGroutR && p.mosaicGroutR !== undefined) u.uGroutR.value = p.mosaicGroutR;
      if (u.uGroutG && p.mosaicGroutG !== undefined) u.uGroutG.value = p.mosaicGroutG;
      if (u.uGroutB && p.mosaicGroutB !== undefined) u.uGroutB.value = p.mosaicGroutB;
      break;

    case 'terrain3D':
      if (u.uMode) u.uMode.value = p.terrainMode ?? p.mode ?? 1;
      if (u.uAmount) u.uAmount.value = p.terrainHeight ?? p.amount ?? 0.5;
      if (u.uAmount2) u.uAmount2.value = p.terrainCamHeight ?? p.amount2 ?? 0.5;
      if (u.uAmount3) u.uAmount3.value = p.terrainSpeed ?? p.amount3 ?? 0.5;
      if (u.uThreshold) u.uThreshold.value = p.terrainFog ?? p.threshold ?? 0.4;
      if (u.uAngle) u.uAngle.value = p.terrainYaw ?? p.angle ?? 0;
      if (u.uCenter) {
        const tx = p.terrainPitch ?? p.centerX ?? 0.5;
        const ty = p.terrainRoll ?? p.centerY ?? 0.5;
        u.uCenter.value.set(tx, ty);
      }
      if (u.uColor) {
        u.uColor.value.set(
          p.terrainFogR ?? p.red ?? 0.05,
          p.terrainFogG ?? p.green ?? 0.07,
          p.terrainFogB ?? p.blue ?? 0.12
        );
      }
      if (u.uHorizonFade && p.terrainHorizonFade !== undefined) u.uHorizonFade.value = p.terrainHorizonFade;
      if (u.uSourceMix && p.terrainSourceMix !== undefined) u.uSourceMix.value = p.terrainSourceMix;
      break;

    case 'wrappedTerrain':
      if (u.uShape && p.wtShape !== undefined) u.uShape.value = p.wtShape;
      if (u.uHeight && p.wtHeight !== undefined) u.uHeight.value = p.wtHeight;
      if (u.uRotateX && p.wtRotateX !== undefined) u.uRotateX.value = p.wtRotateX;
      if (u.uRotateY && p.wtRotateY !== undefined) u.uRotateY.value = p.wtRotateY;
      if (u.uAutoRotate && p.wtAutoRotate !== undefined) u.uAutoRotate.value = p.wtAutoRotate;
      if (u.uCamDistance && p.wtCamDistance !== undefined) u.uCamDistance.value = p.wtCamDistance;
      if (u.uSpecular && p.wtSpecular !== undefined) u.uSpecular.value = p.wtSpecular;
      if (u.uAmbient && p.wtAmbient !== undefined) u.uAmbient.value = p.wtAmbient;
      if (u.uFogDistance && p.wtFogDistance !== undefined) u.uFogDistance.value = p.wtFogDistance;
      if (u.uFogColor) {
        u.uFogColor.value.set(p.wtFogR ?? 0.05, p.wtFogG ?? 0.07, p.wtFogB ?? 0.12);
      }
      if (u.uHorizonFade && p.wtHorizonFade !== undefined) u.uHorizonFade.value = p.wtHorizonFade;
      if (u.uSourceMix && p.wtSourceMix !== undefined) u.uSourceMix.value = p.wtSourceMix;
      if (u.uTileScale && p.wtTileScale !== undefined) u.uTileScale.value = p.wtTileScale;
      break;

    // ── Geometric 3D (10) ──

    case 'stringOrb':
      if (u.uRadius && p.soRadius !== undefined) u.uRadius.value = p.soRadius;
      if (u.uHeight && p.soHeight !== undefined) u.uHeight.value = p.soHeight;
      if (u.uLatCount && p.soLatCount !== undefined) u.uLatCount.value = p.soLatCount;
      if (u.uLonCount && p.soLonCount !== undefined) u.uLonCount.value = p.soLonCount;
      if (u.uDiagCount && p.soDiagCount !== undefined) u.uDiagCount.value = p.soDiagCount;
      if (u.uSlope && p.soSlope !== undefined) u.uSlope.value = p.soSlope;
      if (u.uWidth && p.soWidth !== undefined) u.uWidth.value = p.soWidth;
      if (u.uSpin && p.soSpin !== undefined) u.uSpin.value = p.soSpin;
      if (u.uTilt && p.soTilt !== undefined) u.uTilt.value = p.soTilt;
      if (u.uFlow && p.soFlow !== undefined) u.uFlow.value = p.soFlow;
      if (u.uIntensity && p.soIntensity !== undefined) u.uIntensity.value = p.soIntensity;
      if (u.uGlow && p.soGlow !== undefined) u.uGlow.value = p.soGlow;
      if (u.uGlowColor) u.uGlowColor.value.set(p.soGlowR ?? 0.4, p.soGlowG ?? 0.85, p.soGlowB ?? 1);
      if (u.uHorizonFade && p.soHorizonFade !== undefined) u.uHorizonFade.value = p.soHorizonFade;
      if (u.uTileScale && p.soTileScale !== undefined) u.uTileScale.value = p.soTileScale;
      break;

    case 'sphereWireframe':
      if (u.uRadius && p.swRadius !== undefined) u.uRadius.value = p.swRadius;
      if (u.uHeight && p.swHeight !== undefined) u.uHeight.value = p.swHeight;
      if (u.uMeridians && p.swMeridians !== undefined) u.uMeridians.value = p.swMeridians;
      if (u.uParallels && p.swParallels !== undefined) u.uParallels.value = p.swParallels;
      if (u.uWidth && p.swWidth !== undefined) u.uWidth.value = p.swWidth;
      if (u.uSpin && p.swSpin !== undefined) u.uSpin.value = p.swSpin;
      if (u.uTilt && p.swTilt !== undefined) u.uTilt.value = p.swTilt;
      if (u.uIntensity && p.swIntensity !== undefined) u.uIntensity.value = p.swIntensity;
      if (u.uHaloGlow && p.swHaloGlow !== undefined) u.uHaloGlow.value = p.swHaloGlow;
      if (u.uColor) u.uColor.value.set(p.swColorR ?? 0.5, p.swColorG ?? 0.9, p.swColorB ?? 1);
      if (u.uHorizonFade && p.swHorizonFade !== undefined) u.uHorizonFade.value = p.swHorizonFade;
      if (u.uFillSource && p.swFillSource !== undefined) u.uFillSource.value = p.swFillSource;
      if (u.uTileScale && p.swTileScale !== undefined) u.uTileScale.value = p.swTileScale;
      break;

    case 'voxelCubeCluster':
      if (u.uGridSize && p.vccGridSize !== undefined) u.uGridSize.value = p.vccGridSize;
      if (u.uCubeSize && p.vccCubeSize !== undefined) u.uCubeSize.value = p.vccCubeSize;
      if (u.uSpacing && p.vccSpacing !== undefined) u.uSpacing.value = p.vccSpacing;
      if (u.uHeight && p.vccHeight !== undefined) u.uHeight.value = p.vccHeight;
      if (u.uSpin && p.vccSpin !== undefined) u.uSpin.value = p.vccSpin;
      if (u.uTilt && p.vccTilt !== undefined) u.uTilt.value = p.vccTilt;
      if (u.uCamDistance && p.vccCamDistance !== undefined) u.uCamDistance.value = p.vccCamDistance;
      if (u.uSpecular && p.vccSpecular !== undefined) u.uSpecular.value = p.vccSpecular;
      if (u.uAmbient && p.vccAmbient !== undefined) u.uAmbient.value = p.vccAmbient;
      if (u.uHorizonFade && p.vccHorizonFade !== undefined) u.uHorizonFade.value = p.vccHorizonFade;
      if (u.uBgColor) u.uBgColor.value.set(p.vccBgR ?? 0.04, p.vccBgG ?? 0.05, p.vccBgB ?? 0.08);
      break;

    case 'mobiusLattice':
      if (u.uMajorR && p.mlMajorR !== undefined) u.uMajorR.value = p.mlMajorR;
      if (u.uRibbonW && p.mlRibbonW !== undefined) u.uRibbonW.value = p.mlRibbonW;
      if (u.uTwists && p.mlTwists !== undefined) u.uTwists.value = p.mlTwists;
      if (u.uSpin && p.mlSpin !== undefined) u.uSpin.value = p.mlSpin;
      if (u.uTilt && p.mlTilt !== undefined) u.uTilt.value = p.mlTilt;
      if (u.uLineDensity && p.mlLineDensity !== undefined) u.uLineDensity.value = p.mlLineDensity;
      if (u.uLineWidth && p.mlLineWidth !== undefined) u.uLineWidth.value = p.mlLineWidth;
      if (u.uIntensity && p.mlIntensity !== undefined) u.uIntensity.value = p.mlIntensity;
      if (u.uLineColor) u.uLineColor.value.set(p.mlLineR ?? 1, p.mlLineG ?? 0.85, p.mlLineB ?? 0.4);
      if (u.uHorizonFade && p.mlHorizonFade !== undefined) u.uHorizonFade.value = p.mlHorizonFade;
      break;

    case 'crystalShardField':
      if (u.uShardCount && p.csfShardCount !== undefined) u.uShardCount.value = p.csfShardCount;
      if (u.uShardSize && p.csfShardSize !== undefined) u.uShardSize.value = p.csfShardSize;
      if (u.uSpread && p.csfSpread !== undefined) u.uSpread.value = p.csfSpread;
      if (u.uChromaEdge && p.csfChromaEdge !== undefined) u.uChromaEdge.value = p.csfChromaEdge;
      if (u.uRefraction && p.csfRefraction !== undefined) u.uRefraction.value = p.csfRefraction;
      if (u.uSpin && p.csfSpin !== undefined) u.uSpin.value = p.csfSpin;
      if (u.uIntensity && p.csfIntensity !== undefined) u.uIntensity.value = p.csfIntensity;
      if (u.uTint) u.uTint.value.set(p.csfTintR ?? 0.85, p.csfTintG ?? 0.95, p.csfTintB ?? 1);
      if (u.uHorizonFade && p.csfHorizonFade !== undefined) u.uHorizonFade.value = p.csfHorizonFade;
      break;

    case 'tubeLattice':
      if (u.uTubeCount && p.tlTubeCount !== undefined) u.uTubeCount.value = p.tlTubeCount;
      if (u.uTubeRadius && p.tlTubeRadius !== undefined) u.uTubeRadius.value = p.tlTubeRadius;
      if (u.uSpread && p.tlSpread !== undefined) u.uSpread.value = p.tlSpread;
      if (u.uSpin && p.tlSpin !== undefined) u.uSpin.value = p.tlSpin;
      if (u.uTilt && p.tlTilt !== undefined) u.uTilt.value = p.tlTilt;
      if (u.uTwist && p.tlTwist !== undefined) u.uTwist.value = p.tlTwist;
      if (u.uIntensity && p.tlIntensity !== undefined) u.uIntensity.value = p.tlIntensity;
      if (u.uRimColor) u.uRimColor.value.set(p.tlRimR ?? 0, p.tlRimG ?? 0.95, p.tlRimB ?? 1);
      if (u.uHorizonFade && p.tlHorizonFade !== undefined) u.uHorizonFade.value = p.tlHorizonFade;
      break;

    case 'discoMirrorBall':
      if (u.uRadius && p.dmbRadius !== undefined) u.uRadius.value = p.dmbRadius;
      if (u.uFacetCount && p.dmbFacetCount !== undefined) u.uFacetCount.value = p.dmbFacetCount;
      if (u.uSpin && p.dmbSpin !== undefined) u.uSpin.value = p.dmbSpin;
      if (u.uTilt && p.dmbTilt !== undefined) u.uTilt.value = p.dmbTilt;
      if (u.uChaseSpeed && p.dmbChaseSpeed !== undefined) u.uChaseSpeed.value = p.dmbChaseSpeed;
      if (u.uChaseHueWidth && p.dmbChaseHueWidth !== undefined) u.uChaseHueWidth.value = p.dmbChaseHueWidth;
      if (u.uSparkle && p.dmbSparkle !== undefined) u.uSparkle.value = p.dmbSparkle;
      if (u.uIntensity && p.dmbIntensity !== undefined) u.uIntensity.value = p.dmbIntensity;
      if (u.uHighlightColor) u.uHighlightColor.value.set(p.dmbHighlightR ?? 1, p.dmbHighlightG ?? 1, p.dmbHighlightB ?? 0.85);
      if (u.uHorizonFade && p.dmbHorizonFade !== undefined) u.uHorizonFade.value = p.dmbHorizonFade;
      break;

    case 'lissajousKnot':
      if (u.uRatioX && p.lkRatioX !== undefined) u.uRatioX.value = p.lkRatioX;
      if (u.uRatioY && p.lkRatioY !== undefined) u.uRatioY.value = p.lkRatioY;
      if (u.uRatioZ && p.lkRatioZ !== undefined) u.uRatioZ.value = p.lkRatioZ;
      if (u.uPhaseX && p.lkPhaseX !== undefined) u.uPhaseX.value = p.lkPhaseX;
      if (u.uPhaseY && p.lkPhaseY !== undefined) u.uPhaseY.value = p.lkPhaseY;
      if (u.uTubeRadius && p.lkTubeRadius !== undefined) u.uTubeRadius.value = p.lkTubeRadius;
      if (u.uScale && p.lkScale !== undefined) u.uScale.value = p.lkScale;
      if (u.uSpin && p.lkSpin !== undefined) u.uSpin.value = p.lkSpin;
      if (u.uTilt && p.lkTilt !== undefined) u.uTilt.value = p.lkTilt;
      if (u.uIntensity && p.lkIntensity !== undefined) u.uIntensity.value = p.lkIntensity;
      if (u.uTubeColor) u.uTubeColor.value.set(p.lkTubeR ?? 1, p.lkTubeG ?? 0.5, p.lkTubeB ?? 0.85);
      if (u.uHorizonFade && p.lkHorizonFade !== undefined) u.uHorizonFade.value = p.lkHorizonFade;
      break;

    case 'helixParticleStream':
      if (u.uHelices && p.hpsHelices !== undefined) u.uHelices.value = p.hpsHelices;
      if (u.uHelixRadius && p.hpsHelixRadius !== undefined) u.uHelixRadius.value = p.hpsHelixRadius;
      if (u.uTurns && p.hpsTurns !== undefined) u.uTurns.value = p.hpsTurns;
      if (u.uHeight && p.hpsHeight !== undefined) u.uHeight.value = p.hpsHeight;
      if (u.uTubeRadius && p.hpsTubeRadius !== undefined) u.uTubeRadius.value = p.hpsTubeRadius;
      if (u.uRiseSpeed && p.hpsRiseSpeed !== undefined) u.uRiseSpeed.value = p.hpsRiseSpeed;
      if (u.uSpin && p.hpsSpin !== undefined) u.uSpin.value = p.hpsSpin;
      if (u.uTilt && p.hpsTilt !== undefined) u.uTilt.value = p.hpsTilt;
      if (u.uIntensity && p.hpsIntensity !== undefined) u.uIntensity.value = p.hpsIntensity;
      if (u.uTint) u.uTint.value.set(p.hpsTintR ?? 0.4, p.hpsTintG ?? 1, p.hpsTintB ?? 0.7);
      if (u.uHorizonFade && p.hpsHorizonFade !== undefined) u.uHorizonFade.value = p.hpsHorizonFade;
      break;

    case 'donutConstellation':
      if (u.uMajorR && p.dcMajorR !== undefined) u.uMajorR.value = p.dcMajorR;
      if (u.uMinorR && p.dcMinorR !== undefined) u.uMinorR.value = p.dcMinorR;
      if (u.uStarCount && p.dcStarCount !== undefined) u.uStarCount.value = p.dcStarCount;
      if (u.uStarSize && p.dcStarSize !== undefined) u.uStarSize.value = p.dcStarSize;
      if (u.uSpin && p.dcSpin !== undefined) u.uSpin.value = p.dcSpin;
      if (u.uTilt && p.dcTilt !== undefined) u.uTilt.value = p.dcTilt;
      if (u.uTintIntensity && p.dcTintIntensity !== undefined) u.uTintIntensity.value = p.dcTintIntensity;
      if (u.uTorusColor) u.uTorusColor.value.set(p.dcTorusR ?? 0.8, p.dcTorusG ?? 0.4, p.dcTorusB ?? 1);
      if (u.uStarColor) u.uStarColor.value.set(p.dcStarR ?? 1, p.dcStarG ?? 1, p.dcStarB ?? 0.85);
      if (u.uHorizonFade && p.dcHorizonFade !== undefined) u.uHorizonFade.value = p.dcHorizonFade;
      break;

    // Dedicated standalone shaders (same uniform interface, no mode dispatch)
    case 'numberGrid':
    case 'explode3D':
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
      if (u.uSpeed && p.tunnelSpeed !== undefined) u.uSpeed.value = p.tunnelSpeed;
      if (u.uTwist && p.tunnelTwist !== undefined) u.uTwist.value = p.tunnelTwist;
      if (u.uTunnelDepth && p.tunnelDepth !== undefined) u.uTunnelDepth.value = p.tunnelDepth;
      if (u.uCenterX && p.tunnelCenterX !== undefined) u.uCenterX.value = p.tunnelCenterX;
      if (u.uCenterY && p.tunnelCenterY !== undefined) u.uCenterY.value = p.tunnelCenterY;
      if (u.uMode && p.tunnelMode !== undefined) u.uMode.value = p.tunnelMode;
      if (u.uChromatic && p.tunnelChromatic !== undefined) u.uChromatic.value = p.tunnelChromatic;
      break;

    case 'infiniteMirror':
      if (u.uIterations && p.infMirrorIterations !== undefined) u.uIterations.value = p.infMirrorIterations;
      if (u.uShrink && p.infMirrorShrink !== undefined) u.uShrink.value = p.infMirrorShrink;
      if (u.uRotation && p.infMirrorRotation !== undefined) u.uRotation.value = p.infMirrorRotation;
      if (u.uTintFade && p.infMirrorTintFade !== undefined) u.uTintFade.value = p.infMirrorTintFade;
      if (u.uHueShift && p.infMirrorHueShift !== undefined) u.uHueShift.value = p.infMirrorHueShift;
      if (u.uMode && p.infMirrorMode !== undefined) u.uMode.value = p.infMirrorMode;
      if (u.uOffsetX && p.infMirrorOffsetX !== undefined) u.uOffsetX.value = p.infMirrorOffsetX;
      if (u.uOffsetY && p.infMirrorOffsetY !== undefined) u.uOffsetY.value = p.infMirrorOffsetY;
      break;

    case 'fractalWarp':
      if (u.uAmount && p.fractalWarpAmount !== undefined) u.uAmount.value = p.fractalWarpAmount;
      if (u.uScale && p.fractalWarpScale !== undefined) u.uScale.value = p.fractalWarpScale;
      if (u.uOctaves && p.fractalWarpOctaves !== undefined) u.uOctaves.value = p.fractalWarpOctaves;
      if (u.uSpeed && p.fractalWarpSpeed !== undefined) u.uSpeed.value = p.fractalWarpSpeed;
      if (u.uChromatic && p.fractalWarpChromatic !== undefined) u.uChromatic.value = p.fractalWarpChromatic;
      if (u.uMode && p.fractalWarpMode !== undefined) u.uMode.value = p.fractalWarpMode;
      break;

    case 'crystalRefract':
      if (u.uScale && p.crystalScale !== undefined) u.uScale.value = p.crystalScale;
      if (u.uRefraction && p.crystalRefraction !== undefined) u.uRefraction.value = p.crystalRefraction;
      if (u.uSparkle && p.crystalSparkle !== undefined) u.uSparkle.value = p.crystalSparkle;
      if (u.uEdgeGlow && p.crystalEdgeGlow !== undefined) u.uEdgeGlow.value = p.crystalEdgeGlow;
      if (u.uTintR && p.crystalTintR !== undefined) u.uTintR.value = p.crystalTintR;
      if (u.uTintG && p.crystalTintG !== undefined) u.uTintG.value = p.crystalTintG;
      if (u.uTintB && p.crystalTintB !== undefined) u.uTintB.value = p.crystalTintB;
      if (u.uMode && p.crystalMode !== undefined) u.uMode.value = p.crystalMode;
      break;

    case 'fluidDistort':
      if (u.uAmount && p.fluidDistAmount !== undefined) u.uAmount.value = p.fluidDistAmount;
      if (u.uScale && p.fluidDistScale !== undefined) u.uScale.value = p.fluidDistScale;
      if (u.uSpeed && p.fluidDistSpeed !== undefined) u.uSpeed.value = p.fluidDistSpeed;
      if (u.uTurbulence && p.fluidDistTurbulence !== undefined) u.uTurbulence.value = p.fluidDistTurbulence;
      if (u.uMode && p.fluidDistMode !== undefined) u.uMode.value = p.fluidDistMode;
      break;

    case 'wormhole':
      if (u.uPullStrength && p.wormholePullStrength !== undefined) u.uPullStrength.value = p.wormholePullStrength;
      if (u.uRotation && p.wormholeRotation !== undefined) u.uRotation.value = p.wormholeRotation;
      if (u.uCenterX && p.wormholeCenterX !== undefined) u.uCenterX.value = p.wormholeCenterX;
      if (u.uCenterY && p.wormholeCenterY !== undefined) u.uCenterY.value = p.wormholeCenterY;
      if (u.uTwist && p.wormholeTwist !== undefined) u.uTwist.value = p.wormholeTwist;
      if (u.uChromatic && p.wormholeChromatic !== undefined) u.uChromatic.value = p.wormholeChromatic;
      if (u.uAnimSpeed && p.wormholeAnimSpeed !== undefined) u.uAnimSpeed.value = p.wormholeAnimSpeed;
      break;

    case 'geometricTile':
      if (u.uTiles && p.geomTiles !== undefined) u.uTiles.value = p.geomTiles;
      if (u.uMode && p.geomMode !== undefined) u.uMode.value = p.geomMode;
      if (u.uRotation && p.geomRotation !== undefined) u.uRotation.value = p.geomRotation;
      if (u.uOffsetX && p.geomOffsetX !== undefined) u.uOffsetX.value = p.geomOffsetX;
      if (u.uMix && p.geomMix !== undefined) u.uMix.value = p.geomMix;
      break;

    case 'motionTrails':
      if (u.uLength && p.motionTrailsLength !== undefined) u.uLength.value = p.motionTrailsLength;
      if (u.uAngle && p.motionTrailsAngle !== undefined) u.uAngle.value = p.motionTrailsAngle;
      if (u.uSamples && p.motionTrailsSamples !== undefined) u.uSamples.value = p.motionTrailsSamples;
      if (u.uFalloff && p.motionTrailsFalloff !== undefined) u.uFalloff.value = p.motionTrailsFalloff;
      if (u.uChromaSplit && p.motionTrailsChromaSplit !== undefined) u.uChromaSplit.value = p.motionTrailsChromaSplit;
      if (u.uMode && p.motionTrailsMode !== undefined) u.uMode.value = p.motionTrailsMode;
      break;

    case 'echoRepeat':
      if (u.uCount && p.echoCount !== undefined) u.uCount.value = p.echoCount;
      if (u.uOffsetX && p.echoOffsetX !== undefined) u.uOffsetX.value = p.echoOffsetX;
      if (u.uOffsetY && p.echoOffsetY !== undefined) u.uOffsetY.value = p.echoOffsetY;
      if (u.uDecay && p.echoDecay !== undefined) u.uDecay.value = p.echoDecay;
      if (u.uHueShift && p.echoHueShift !== undefined) u.uHueShift.value = p.echoHueShift;
      if (u.uMode && p.echoMode !== undefined) u.uMode.value = p.echoMode;
      break;

    case 'ghostDouble':
      if (u.uOpacity && p.ghostOpacity !== undefined) u.uOpacity.value = p.ghostOpacity;
      if (u.uOffsetX && p.ghostOffsetX !== undefined) u.uOffsetX.value = p.ghostOffsetX;
      if (u.uOffsetY && p.ghostOffsetY !== undefined) u.uOffsetY.value = p.ghostOffsetY;
      if (u.uMirror && p.ghostMirror !== undefined) u.uMirror.value = p.ghostMirror;
      if (u.uTintR && p.ghostTintR !== undefined) u.uTintR.value = p.ghostTintR;
      if (u.uTintG && p.ghostTintG !== undefined) u.uTintG.value = p.ghostTintG;
      if (u.uTintB && p.ghostTintB !== undefined) u.uTintB.value = p.ghostTintB;
      if (u.uBlend && p.ghostBlend !== undefined) u.uBlend.value = p.ghostBlend;
      break;

    case 'strobeFlash':
      if (u.uRate && p.strobeRate !== undefined) u.uRate.value = p.strobeRate;
      if (u.uDuty && p.strobeDuty !== undefined) u.uDuty.value = p.strobeDuty;
      if (u.uIntensity && p.strobeIntensity !== undefined) u.uIntensity.value = p.strobeIntensity;
      if (u.uMode && p.strobeMode !== undefined) u.uMode.value = p.strobeMode;
      if (u.uTintR && p.strobeTintR !== undefined) u.uTintR.value = p.strobeTintR;
      if (u.uTintG && p.strobeTintG !== undefined) u.uTintG.value = p.strobeTintG;
      if (u.uTintB && p.strobeTintB !== undefined) u.uTintB.value = p.strobeTintB;
      break;

    case 'lightPaint':
      if (u.uIntensity && p.lightPaintIntensity !== undefined) u.uIntensity.value = p.lightPaintIntensity;
      if (u.uThreshold && p.lightPaintThreshold !== undefined) u.uThreshold.value = p.lightPaintThreshold;
      if (u.uTrailLength && p.lightPaintTrailLength !== undefined) u.uTrailLength.value = p.lightPaintTrailLength;
      if (u.uFlowAngle && p.lightPaintFlowAngle !== undefined) u.uFlowAngle.value = p.lightPaintFlowAngle;
      if (u.uFlowScale && p.lightPaintFlowScale !== undefined) u.uFlowScale.value = p.lightPaintFlowScale;
      if (u.uChromaShift && p.lightPaintChromaShift !== undefined) u.uChromaShift.value = p.lightPaintChromaShift;
      if (u.uTintR && p.lightPaintTintR !== undefined) u.uTintR.value = p.lightPaintTintR;
      if (u.uTintG && p.lightPaintTintG !== undefined) u.uTintG.value = p.lightPaintTintG;
      if (u.uTintB && p.lightPaintTintB !== undefined) u.uTintB.value = p.lightPaintTintB;
      break;

    case 'recursiveEcho':
      if (u.uDepth && p.recEchoDepth !== undefined) u.uDepth.value = p.recEchoDepth;
      if (u.uZoom && p.recEchoZoom !== undefined) u.uZoom.value = p.recEchoZoom;
      if (u.uRotation && p.recEchoRotation !== undefined) u.uRotation.value = p.recEchoRotation;
      if (u.uOpacity && p.recEchoOpacity !== undefined) u.uOpacity.value = p.recEchoOpacity;
      if (u.uHueShift && p.recEchoHueShift !== undefined) u.uHueShift.value = p.recEchoHueShift;
      if (u.uOffsetX && p.recEchoOffsetX !== undefined) u.uOffsetX.value = p.recEchoOffsetX;
      if (u.uOffsetY && p.recEchoOffsetY !== undefined) u.uOffsetY.value = p.recEchoOffsetY;
      if (u.uMode && p.recEchoMode !== undefined) u.uMode.value = p.recEchoMode;
      break;

    case 'invert':
      if (u.uMode && p.invertMode !== undefined) u.uMode.value = p.invertMode;
      if (u.uAmount && p.invertAmount !== undefined) u.uAmount.value = p.invertAmount;
      if (u.uThreshold && p.invertThreshold !== undefined) u.uThreshold.value = p.invertThreshold;
      if (u.uStrobeRate && p.invertStrobeRate !== undefined) u.uStrobeRate.value = p.invertStrobeRate;
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

    // ── Batch A: brand-new hero effects ──

    case 'opticalFlowDatamosh':
      if (u.uIntensity && p.ofdmIntensity !== undefined) u.uIntensity.value = p.ofdmIntensity;
      if (u.uMotionScale && p.ofdmMotionScale !== undefined) u.uMotionScale.value = p.ofdmMotionScale;
      if (u.uPersistence && p.ofdmPersistence !== undefined) u.uPersistence.value = p.ofdmPersistence;
      if (u.uChromaSplit && p.ofdmChromaSplit !== undefined) u.uChromaSplit.value = p.ofdmChromaSplit;
      if (u.uBlockSize && p.ofdmBlockSize !== undefined) u.uBlockSize.value = p.ofdmBlockSize;
      if (u.uFreeze && p.ofdmFreeze !== undefined) u.uFreeze.value = p.ofdmFreeze;
      if (u.uMode && p.ofdmMode !== undefined) u.uMode.value = p.ofdmMode;
      break;

    case 'flowFieldTrails':
      if (u.uFlowScale && p.fftFlowScale !== undefined) u.uFlowScale.value = p.fftFlowScale;
      if (u.uTrailLength && p.fftTrailLength !== undefined) u.uTrailLength.value = p.fftTrailLength;
      if (u.uSamples && p.fftSamples !== undefined) u.uSamples.value = p.fftSamples;
      if (u.uSpeed && p.fftSpeed !== undefined) u.uSpeed.value = p.fftSpeed;
      if (u.uChromaSplit && p.fftChromaSplit !== undefined) u.uChromaSplit.value = p.fftChromaSplit;
      if (u.uContrast && p.fftContrast !== undefined) u.uContrast.value = p.fftContrast;
      if (u.uMode && p.fftMode !== undefined) u.uMode.value = p.fftMode;
      if (u.uColorCycle && p.fftColorCycle !== undefined) u.uColorCycle.value = p.fftColorCycle;
      break;

    case 'reactionDiffusion':
      if (u.uFeedRate && p.rdFeedRate !== undefined) u.uFeedRate.value = p.rdFeedRate;
      if (u.uKillRate && p.rdKillRate !== undefined) u.uKillRate.value = p.rdKillRate;
      if (u.uDiffusionA && p.rdDiffusionA !== undefined) u.uDiffusionA.value = p.rdDiffusionA;
      if (u.uDiffusionB && p.rdDiffusionB !== undefined) u.uDiffusionB.value = p.rdDiffusionB;
      if (u.uPatternScale && p.rdPatternScale !== undefined) u.uPatternScale.value = p.rdPatternScale;
      if (u.uLumaMask && p.rdLumaMask !== undefined) u.uLumaMask.value = p.rdLumaMask;
      if (u.uMode && p.rdMode !== undefined) u.uMode.value = p.rdMode;
      if (u.uColorR && p.rdColorR !== undefined) u.uColorR.value = p.rdColorR;
      if (u.uColorG && p.rdColorG !== undefined) u.uColorG.value = p.rdColorG;
      if (u.uColorB && p.rdColorB !== undefined) u.uColorB.value = p.rdColorB;
      if (u.uMix && p.rdMix !== undefined) u.uMix.value = p.rdMix;
      if (u.uReseed && p.rdReseed !== undefined) u.uReseed.value = p.rdReseed;
      break;

    case 'neonTubeTrace':
      if (u.uEdgeThreshold && p.ntEdgeThreshold !== undefined) u.uEdgeThreshold.value = p.ntEdgeThreshold;
      if (u.uTubeWidth && p.ntTubeWidth !== undefined) u.uTubeWidth.value = p.ntTubeWidth;
      if (u.uGlow && p.ntGlow !== undefined) u.uGlow.value = p.ntGlow;
      if (u.uGlowRadius && p.ntGlowRadius !== undefined) u.uGlowRadius.value = p.ntGlowRadius;
      if (u.uTintR && p.ntTintR !== undefined) u.uTintR.value = p.ntTintR;
      if (u.uTintG && p.ntTintG !== undefined) u.uTintG.value = p.ntTintG;
      if (u.uTintB && p.ntTintB !== undefined) u.uTintB.value = p.ntTintB;
      if (u.uChase && p.ntChase !== undefined) u.uChase.value = p.ntChase;
      if (u.uChaseSpeed && p.ntChaseSpeed !== undefined) u.uChaseSpeed.value = p.ntChaseSpeed;
      if (u.uFlicker && p.ntFlicker !== undefined) u.uFlicker.value = p.ntFlicker;
      if (u.uBg && p.ntBg !== undefined) u.uBg.value = p.ntBg;
      break;

    case 'depthParallax':
      if (u.uDepthStrength && p.dpDepthStrength !== undefined) u.uDepthStrength.value = p.dpDepthStrength;
      if (u.uPushIn && p.dpPushIn !== undefined) u.uPushIn.value = p.dpPushIn;
      if (u.uLayers && p.dpLayers !== undefined) u.uLayers.value = p.dpLayers;
      if (u.uChromatic && p.dpChromatic !== undefined) u.uChromatic.value = p.dpChromatic;
      if (u.uDepthBoost && p.dpDepthBoost !== undefined) u.uDepthBoost.value = p.dpDepthBoost;
      if (u.uMode && p.dpMode !== undefined) u.uMode.value = p.dpMode;
      if (u.uPanX && p.dpPanX !== undefined) u.uPanX.value = p.dpPanX;
      if (u.uPanY && p.dpPanY !== undefined) u.uPanY.value = p.dpPanY;
      break;

    case 'pointCloudDissolve':
      if (u.uDissolve && p.pcdDissolve !== undefined) u.uDissolve.value = p.pcdDissolve;
      if (u.uDotSize && p.pcdDotSize !== undefined) u.uDotSize.value = p.pcdDotSize;
      if (u.uScatterRadius && p.pcdScatterRadius !== undefined) u.uScatterRadius.value = p.pcdScatterRadius;
      if (u.uAttract && p.pcdAttract !== undefined) u.uAttract.value = p.pcdAttract;
      if (u.uTurbulence && p.pcdTurbulence !== undefined) u.uTurbulence.value = p.pcdTurbulence;
      if (u.uMode && p.pcdMode !== undefined) u.uMode.value = p.pcdMode;
      if (u.uBgR && p.pcdBgR !== undefined) u.uBgR.value = p.pcdBgR;
      if (u.uBgG && p.pcdBgG !== undefined) u.uBgG.value = p.pcdBgG;
      if (u.uBgB && p.pcdBgB !== undefined) u.uBgB.value = p.pcdBgB;
      if (u.uHueShift && p.pcdHueShift !== undefined) u.uHueShift.value = p.pcdHueShift;
      break;

    case 'pixelSand':
      if (u.uGravity && p.psGravity !== undefined) u.uGravity.value = p.psGravity;
      if (u.uTurbulence && p.psTurbulence !== undefined) u.uTurbulence.value = p.psTurbulence;
      if (u.uThreshold && p.psThreshold !== undefined) u.uThreshold.value = p.psThreshold;
      if (u.uPersistence && p.psPersistence !== undefined) u.uPersistence.value = p.psPersistence;
      if (u.uMode && p.psMode !== undefined) u.uMode.value = p.psMode;
      if (u.uReplenish && p.psReplenish !== undefined) u.uReplenish.value = p.psReplenish;
      if (u.uChromaSplit && p.psChromaSplit !== undefined) u.uChromaSplit.value = p.psChromaSplit;
      if (u.uGrainSize && p.psGrainSize !== undefined) u.uGrainSize.value = p.psGrainSize;
      break;

    case 'liquidGlass':
      if (u.uBlobs && p.lgBlobs !== undefined) u.uBlobs.value = p.lgBlobs;
      if (u.uBlobSize && p.lgBlobSize !== undefined) u.uBlobSize.value = p.lgBlobSize;
      if (u.uRefraction && p.lgRefraction !== undefined) u.uRefraction.value = p.lgRefraction;
      if (u.uChromatic && p.lgChromatic !== undefined) u.uChromatic.value = p.lgChromatic;
      if (u.uSpecular && p.lgSpecular !== undefined) u.uSpecular.value = p.lgSpecular;
      if (u.uCausticAmount && p.lgCausticAmount !== undefined) u.uCausticAmount.value = p.lgCausticAmount;
      if (u.uSpeed && p.lgSpeed !== undefined) u.uSpeed.value = p.lgSpeed;
      if (u.uTintR && p.lgTintR !== undefined) u.uTintR.value = p.lgTintR;
      if (u.uTintG && p.lgTintG !== undefined) u.uTintG.value = p.lgTintG;
      if (u.uTintB && p.lgTintB !== undefined) u.uTintB.value = p.lgTintB;
      break;

    case 'hologramScan':
      if (u.uIntensity && p.hsIntensity !== undefined) u.uIntensity.value = p.hsIntensity;
      if (u.uScanFreq && p.hsScanFreq !== undefined) u.uScanFreq.value = p.hsScanFreq;
      if (u.uScanSpeed && p.hsScanSpeed !== undefined) u.uScanSpeed.value = p.hsScanSpeed;
      if (u.uGridSpacing && p.hsGridSpacing !== undefined) u.uGridSpacing.value = p.hsGridSpacing;
      if (u.uRGBFlicker && p.hsRGBFlicker !== undefined) u.uRGBFlicker.value = p.hsRGBFlicker;
      if (u.uBrokenBands && p.hsBrokenBands !== undefined) u.uBrokenBands.value = p.hsBrokenBands;
      if (u.uTintR && p.hsTintR !== undefined) u.uTintR.value = p.hsTintR;
      if (u.uTintG && p.hsTintG !== undefined) u.uTintG.value = p.hsTintG;
      if (u.uTintB && p.hsTintB !== undefined) u.uTintB.value = p.hsTintB;
      if (u.uOpacityFlicker && p.hsOpacityFlicker !== undefined) u.uOpacityFlicker.value = p.hsOpacityFlicker;
      if (u.uEdgeGlow && p.hsEdgeGlow !== undefined) u.uEdgeGlow.value = p.hsEdgeGlow;
      break;

    case 'laserSlice':
      if (u.uMode && p.lsMode !== undefined) u.uMode.value = p.lsMode;
      if (u.uSpeed && p.lsSpeed !== undefined) u.uSpeed.value = p.lsSpeed;
      if (u.uBeamWidth && p.lsBeamWidth !== undefined) u.uBeamWidth.value = p.lsBeamWidth;
      if (u.uGlow && p.lsGlow !== undefined) u.uGlow.value = p.lsGlow;
      if (u.uSparks && p.lsSparks !== undefined) u.uSparks.value = p.lsSparks;
      if (u.uEraseAmount && p.lsEraseAmount !== undefined) u.uEraseAmount.value = p.lsEraseAmount;
      if (u.uTintR && p.lsTintR !== undefined) u.uTintR.value = p.lsTintR;
      if (u.uTintG && p.lsTintG !== undefined) u.uTintG.value = p.lsTintG;
      if (u.uTintB && p.lsTintB !== undefined) u.uTintB.value = p.lsTintB;
      if (u.uReveal && p.lsReveal !== undefined) u.uReveal.value = p.lsReveal;
      if (u.uPersistence && p.lsPersistence !== undefined) u.uPersistence.value = p.lsPersistence;
      break;

    // ── Batch B: brand-new hero effects ──

    case 'auraField':
      if (u.uIntensity && p.afIntensity !== undefined) u.uIntensity.value = p.afIntensity;
      if (u.uRadius && p.afRadius !== undefined) u.uRadius.value = p.afRadius;
      if (u.uEdgeAmount && p.afEdgeAmount !== undefined) u.uEdgeAmount.value = p.afEdgeAmount;
      if (u.uLumaAmount && p.afLumaAmount !== undefined) u.uLumaAmount.value = p.afLumaAmount;
      if (u.uAudioReact && p.afAudioReact !== undefined) u.uAudioReact.value = p.afAudioReact;
      if (u.uHueShift && p.afHueShift !== undefined) u.uHueShift.value = p.afHueShift;
      if (u.uTintR && p.afTintR !== undefined) u.uTintR.value = p.afTintR;
      if (u.uTintG && p.afTintG !== undefined) u.uTintG.value = p.afTintG;
      if (u.uTintB && p.afTintB !== undefined) u.uTintB.value = p.afTintB;
      if (u.uMode && p.afMode !== undefined) u.uMode.value = p.afMode;
      break;

    case 'smokeDisintegrate':
      if (u.uAmount && p.smokeAmount !== undefined) u.uAmount.value = p.smokeAmount;
      if (u.uScale && p.smokeScale !== undefined) u.uScale.value = p.smokeScale;
      if (u.uSpeed && p.smokeSpeed !== undefined) u.uSpeed.value = p.smokeSpeed;
      if (u.uDirection && p.smokeDirection !== undefined) u.uDirection.value = p.smokeDirection;
      if (u.uEdgeFade && p.smokeEdgeFade !== undefined) u.uEdgeFade.value = p.smokeEdgeFade;
      if (u.uSmokeColorR && p.smokeColorR !== undefined) u.uSmokeColorR.value = p.smokeColorR;
      if (u.uSmokeColorG && p.smokeColorG !== undefined) u.uSmokeColorG.value = p.smokeColorG;
      if (u.uSmokeColorB && p.smokeColorB !== undefined) u.uSmokeColorB.value = p.smokeColorB;
      if (u.uMode && p.smokeMode !== undefined) u.uMode.value = p.smokeMode;
      break;

    case 'shimmerCloth':
      if (u.uAmplitude && p.clothAmplitude !== undefined) u.uAmplitude.value = p.clothAmplitude;
      if (u.uFrequency && p.clothFrequency !== undefined) u.uFrequency.value = p.clothFrequency;
      if (u.uSpeed && p.clothSpeed !== undefined) u.uSpeed.value = p.clothSpeed;
      if (u.uThreadDensity && p.clothThreadDensity !== undefined) u.uThreadDensity.value = p.clothThreadDensity;
      if (u.uThreadDepth && p.clothThreadDepth !== undefined) u.uThreadDepth.value = p.clothThreadDepth;
      if (u.uShimmer && p.clothShimmer !== undefined) u.uShimmer.value = p.clothShimmer;
      if (u.uMode && p.clothMode !== undefined) u.uMode.value = p.clothMode;
      break;

    case 'glitchQuilt':
      if (u.uTileSize && p.gqTileSize !== undefined) u.uTileSize.value = p.gqTileSize;
      if (u.uShuffleAmount && p.gqShuffleAmount !== undefined) u.uShuffleAmount.value = p.gqShuffleAmount;
      if (u.uRotateAmount && p.gqRotateAmount !== undefined) u.uRotateAmount.value = p.gqRotateAmount;
      if (u.uDelayAmount && p.gqDelayAmount !== undefined) u.uDelayAmount.value = p.gqDelayAmount;
      if (u.uChromaSplit && p.gqChromaSplit !== undefined) u.uChromaSplit.value = p.gqChromaSplit;
      if (u.uTriggerRate && p.gqTriggerRate !== undefined) u.uTriggerRate.value = p.gqTriggerRate;
      if (u.uMode && p.gqMode !== undefined) u.uMode.value = p.gqMode;
      break;

    case 'cellularAutomataBurn':
      if (u.uCellSize && p.caCellSize !== undefined) u.uCellSize.value = p.caCellSize;
      if (u.uBirthThreshold && p.caBirthThreshold !== undefined) u.uBirthThreshold.value = p.caBirthThreshold;
      if (u.uSurvivalLow && p.caSurvivalLow !== undefined) u.uSurvivalLow.value = p.caSurvivalLow;
      if (u.uSurvivalHigh && p.caSurvivalHigh !== undefined) u.uSurvivalHigh.value = p.caSurvivalHigh;
      if (u.uColorR && p.caColorR !== undefined) u.uColorR.value = p.caColorR;
      if (u.uColorG && p.caColorG !== undefined) u.uColorG.value = p.caColorG;
      if (u.uColorB && p.caColorB !== undefined) u.uColorB.value = p.caColorB;
      if (u.uMode && p.caMode !== undefined) u.uMode.value = p.caMode;
      if (u.uMix && p.caMix !== undefined) u.uMix.value = p.caMix;
      break;

    case 'rorschachMirror':
      if (u.uMode && p.rmMode !== undefined) u.uMode.value = p.rmMode;
      if (u.uInkAmount && p.rmInkAmount !== undefined) u.uInkAmount.value = p.rmInkAmount;
      if (u.uFluidEdges && p.rmFluidEdges !== undefined) u.uFluidEdges.value = p.rmFluidEdges;
      if (u.uTintR && p.rmTintR !== undefined) u.uTintR.value = p.rmTintR;
      if (u.uTintG && p.rmTintG !== undefined) u.uTintG.value = p.rmTintG;
      if (u.uTintB && p.rmTintB !== undefined) u.uTintB.value = p.rmTintB;
      if (u.uBgR && p.rmBgR !== undefined) u.uBgR.value = p.rmBgR;
      if (u.uBgG && p.rmBgG !== undefined) u.uBgG.value = p.rmBgG;
      if (u.uBgB && p.rmBgB !== undefined) u.uBgB.value = p.rmBgB;
      if (u.uMixOriginal && p.rmMixOriginal !== undefined) u.uMixOriginal.value = p.rmMixOriginal;
      break;

    case 'spectralPrismTunnel':
      if (u.uTunnelDepth && p.sptTunnelDepth !== undefined) u.uTunnelDepth.value = p.sptTunnelDepth;
      if (u.uPrismSpread && p.sptPrismSpread !== undefined) u.uPrismSpread.value = p.sptPrismSpread;
      if (u.uRotation && p.sptRotation !== undefined) u.uRotation.value = p.sptRotation;
      if (u.uSpeed && p.sptSpeed !== undefined) u.uSpeed.value = p.sptSpeed;
      if (u.uSlices && p.sptSlices !== undefined) u.uSlices.value = p.sptSlices;
      if (u.uFade && p.sptFade !== undefined) u.uFade.value = p.sptFade;
      break;

    case 'ledVolume':
      if (u.uVoxelSize && p.ledVoxelSize !== undefined) u.uVoxelSize.value = p.ledVoxelSize;
      if (u.uDepthPulse && p.ledDepthPulse !== undefined) u.uDepthPulse.value = p.ledDepthPulse;
      if (u.uDepthSpeed && p.ledDepthSpeed !== undefined) u.uDepthSpeed.value = p.ledDepthSpeed;
      if (u.uPosterize && p.ledPosterize !== undefined) u.uPosterize.value = p.ledPosterize;
      if (u.uGlow && p.ledGlow !== undefined) u.uGlow.value = p.ledGlow;
      if (u.uPerspective && p.ledPerspective !== undefined) u.uPerspective.value = p.ledPerspective;
      if (u.uMode && p.ledMode !== undefined) u.uMode.value = p.ledMode;
      if (u.uBgR && p.ledBgR !== undefined) u.uBgR.value = p.ledBgR;
      if (u.uBgG && p.ledBgG !== undefined) u.uBgG.value = p.ledBgG;
      if (u.uBgB && p.ledBgB !== undefined) u.uBgB.value = p.ledBgB;
      break;

    case 'posterTear':
      if (u.uTearAmount && p.ptTearAmount !== undefined) u.uTearAmount.value = p.ptTearAmount;
      if (u.uTearAngle && p.ptTearAngle !== undefined) u.uTearAngle.value = p.ptTearAngle;
      if (u.uTearJitter && p.ptTearJitter !== undefined) u.uTearJitter.value = p.ptTearJitter;
      if (u.uShiftBelow && p.ptShiftBelow !== undefined) u.uShiftBelow.value = p.ptShiftBelow;
      if (u.uOffsetX && p.ptOffsetX !== undefined) u.uOffsetX.value = p.ptOffsetX;
      if (u.uOffsetY && p.ptOffsetY !== undefined) u.uOffsetY.value = p.ptOffsetY;
      if (u.uTearGlow && p.ptTearGlow !== undefined) u.uTearGlow.value = p.ptTearGlow;
      if (u.uMode && p.ptMode !== undefined) u.uMode.value = p.ptMode;
      break;

    case 'paintPeel':
      if (u.uAmount && p.ppAmount !== undefined) u.uAmount.value = p.ppAmount;
      if (u.uScale && p.ppScale !== undefined) u.uScale.value = p.ppScale;
      if (u.uLumaBias && p.ppLumaBias !== undefined) u.uLumaBias.value = p.ppLumaBias;
      if (u.uCurl && p.ppCurl !== undefined) u.uCurl.value = p.ppCurl;
      if (u.uShadow && p.ppShadow !== undefined) u.uShadow.value = p.ppShadow;
      if (u.uBgR && p.ppBgR !== undefined) u.uBgR.value = p.ppBgR;
      if (u.uBgG && p.ppBgG !== undefined) u.uBgG.value = p.ppBgG;
      if (u.uBgB && p.ppBgB !== undefined) u.uBgB.value = p.ppBgB;
      if (u.uMode && p.ppMode !== undefined) u.uMode.value = p.ppMode;
      break;

    // ── Batch C: brand-new hero effects ──

    case 'audioShockBloom':
      if (u.uIntensity && p.asbIntensity !== undefined) u.uIntensity.value = p.asbIntensity;
      if (u.uBloomThreshold && p.asbBloomThreshold !== undefined) u.uBloomThreshold.value = p.asbBloomThreshold;
      if (u.uBloomRadius && p.asbBloomRadius !== undefined) u.uBloomRadius.value = p.asbBloomRadius;
      if (u.uShockSpeed && p.asbShockSpeed !== undefined) u.uShockSpeed.value = p.asbShockSpeed;
      if (u.uShockAmplitude && p.asbShockAmplitude !== undefined) u.uShockAmplitude.value = p.asbShockAmplitude;
      if (u.uChromaSplit && p.asbChromaSplit !== undefined) u.uChromaSplit.value = p.asbChromaSplit;
      if (u.uStrobeAmount && p.asbStrobeAmount !== undefined) u.uStrobeAmount.value = p.asbStrobeAmount;
      if (u.uTintR && p.asbTintR !== undefined) u.uTintR.value = p.asbTintR;
      if (u.uTintG && p.asbTintG !== undefined) u.uTintG.value = p.asbTintG;
      if (u.uTintB && p.asbTintB !== undefined) u.uTintB.value = p.asbTintB;
      if (u.uAudioGate && p.asbAudioGate !== undefined) u.uAudioGate.value = p.asbAudioGate;
      break;

    case 'vhsFullDeck':
      if (u.uTracking && p.vhsFdTracking !== undefined) u.uTracking.value = p.vhsFdTracking;
      if (u.uHeadSwitch && p.vhsFdHeadSwitch !== undefined) u.uHeadSwitch.value = p.vhsFdHeadSwitch;
      if (u.uChromaBleed && p.vhsFdChromaBleed !== undefined) u.uChromaBleed.value = p.vhsFdChromaBleed;
      if (u.uDropouts && p.vhsFdDropouts !== undefined) u.uDropouts.value = p.vhsFdDropouts;
      if (u.uTapeNoise && p.vhsFdTapeNoise !== undefined) u.uTapeNoise.value = p.vhsFdTapeNoise;
      if (u.uScanlines && p.vhsFdScanlines !== undefined) u.uScanlines.value = p.vhsFdScanlines;
      if (u.uColorBleed && p.vhsFdColorBleed !== undefined) u.uColorBleed.value = p.vhsFdColorBleed;
      if (u.uSaturation && p.vhsFdSaturation !== undefined) u.uSaturation.value = p.vhsFdSaturation;
      if (u.uTrackingJump && p.vhsFdTrackingJump !== undefined) u.uTrackingJump.value = p.vhsFdTrackingJump;
      if (u.uMode && p.vhsFdMode !== undefined) u.uMode.value = p.vhsFdMode;
      break;

    case 'analogFeedbackRack':
      if (u.uMix && p.afrMix !== undefined) u.uMix.value = p.afrMix;
      if (u.uZoom && p.afrZoom !== undefined) u.uZoom.value = p.afrZoom;
      if (u.uRotation && p.afrRotation !== undefined) u.uRotation.value = p.afrRotation;
      if (u.uDecay && p.afrDecay !== undefined) u.uDecay.value = p.afrDecay;
      if (u.uHueShift && p.afrHueShift !== undefined) u.uHueShift.value = p.afrHueShift;
      if (u.uMaskCenter && p.afrMaskCenter !== undefined) u.uMaskCenter.value = p.afrMaskCenter;
      if (u.uChromaSplit && p.afrChromaSplit !== undefined) u.uChromaSplit.value = p.afrChromaSplit;
      if (u.uOffsetX && p.afrOffsetX !== undefined) u.uOffsetX.value = p.afrOffsetX;
      if (u.uOffsetY && p.afrOffsetY !== undefined) u.uOffsetY.value = p.afrOffsetY;
      if (u.uMode && p.afrMode !== undefined) u.uMode.value = p.afrMode;
      break;

    case 'clubLaserGrid':
      if (u.uIntensity && p.clgIntensity !== undefined) u.uIntensity.value = p.clgIntensity;
      if (u.uGridDensity && p.clgGridDensity !== undefined) u.uGridDensity.value = p.clgGridDensity;
      if (u.uPerspective && p.clgPerspective !== undefined) u.uPerspective.value = p.clgPerspective;
      if (u.uSpeed && p.clgSpeed !== undefined) u.uSpeed.value = p.clgSpeed;
      if (u.uIntersectionGlow && p.clgIntersectionGlow !== undefined) u.uIntersectionGlow.value = p.clgIntersectionGlow;
      if (u.uLineWidth && p.clgLineWidth !== undefined) u.uLineWidth.value = p.clgLineWidth;
      if (u.uTintR && p.clgTintR !== undefined) u.uTintR.value = p.clgTintR;
      if (u.uTintG && p.clgTintG !== undefined) u.uTintG.value = p.clgTintG;
      if (u.uTintB && p.clgTintB !== undefined) u.uTintB.value = p.clgTintB;
      if (u.uAudioReact && p.clgAudioReact !== undefined) u.uAudioReact.value = p.clgAudioReact;
      if (u.uMode && p.clgMode !== undefined) u.uMode.value = p.clgMode;
      break;

    case 'mirrorShards':
      if (u.uShards && p.msShards !== undefined) u.uShards.value = p.msShards;
      if (u.uShardSize && p.msShardSize !== undefined) u.uShardSize.value = p.msShardSize;
      if (u.uRotation && p.msRotation !== undefined) u.uRotation.value = p.msRotation;
      if (u.uDelayAmount && p.msDelayAmount !== undefined) u.uDelayAmount.value = p.msDelayAmount;
      if (u.uChromatic && p.msChromatic !== undefined) u.uChromatic.value = p.msChromatic;
      if (u.uMode && p.msMode !== undefined) u.uMode.value = p.msMode;
      break;

    case 'ghostExposure':
      if (u.uExposure && p.geExposure !== undefined) u.uExposure.value = p.geExposure;
      if (u.uDecay && p.geDecay !== undefined) u.uDecay.value = p.geDecay;
      if (u.uHueShiftPerFrame && p.geHueShiftPerFrame !== undefined) u.uHueShiftPerFrame.value = p.geHueShiftPerFrame;
      if (u.uIntensity && p.geIntensity !== undefined) u.uIntensity.value = p.geIntensity;
      if (u.uMode && p.geMode !== undefined) u.uMode.value = p.geMode;
      if (u.uClamp && p.geClamp !== undefined) u.uClamp.value = p.geClamp;
      break;

    case 'thermalContour':
      if (u.uPalette && p.tcPalette !== undefined) u.uPalette.value = p.tcPalette;
      if (u.uContourCount && p.tcContourCount !== undefined) u.uContourCount.value = p.tcContourCount;
      if (u.uContourWidth && p.tcContourWidth !== undefined) u.uContourWidth.value = p.tcContourWidth;
      if (u.uContourGlow && p.tcContourGlow !== undefined) u.uContourGlow.value = p.tcContourGlow;
      if (u.uIntensity && p.tcIntensity !== undefined) u.uIntensity.value = p.tcIntensity;
      if (u.uTrackBlobs && p.tcTrackBlobs !== undefined) u.uTrackBlobs.value = p.tcTrackBlobs;
      if (u.uMix && p.tcMix !== undefined) u.uMix.value = p.tcMix;
      break;

    case 'dreamDiffusion':
      if (u.uBloomAmount && p.ddBloomAmount !== undefined) u.uBloomAmount.value = p.ddBloomAmount;
      if (u.uBloomRadius && p.ddBloomRadius !== undefined) u.uBloomRadius.value = p.ddBloomRadius;
      if (u.uHalation && p.ddHalation !== undefined) u.uHalation.value = p.ddHalation;
      if (u.uChromaticBlur && p.ddChromaticBlur !== undefined) u.uChromaticBlur.value = p.ddChromaticBlur;
      if (u.uPastelRolloff && p.ddPastelRolloff !== undefined) u.uPastelRolloff.value = p.ddPastelRolloff;
      if (u.uShadowLift && p.ddShadowLift !== undefined) u.uShadowLift.value = p.ddShadowLift;
      if (u.uSoftness && p.ddSoftness !== undefined) u.uSoftness.value = p.ddSoftness;
      if (u.uTintR && p.ddTintR !== undefined) u.uTintR.value = p.ddTintR;
      if (u.uTintG && p.ddTintG !== undefined) u.uTintG.value = p.ddTintG;
      if (u.uTintB && p.ddTintB !== undefined) u.uTintB.value = p.ddTintB;
      break;

    case 'topoWarp':
      if (u.uContourCount && p.twContourCount !== undefined) u.uContourCount.value = p.twContourCount;
      if (u.uContourWidth && p.twContourWidth !== undefined) u.uContourWidth.value = p.twContourWidth;
      if (u.uDisplacement && p.twDisplacement !== undefined) u.uDisplacement.value = p.twDisplacement;
      if (u.uChromaticEdge && p.twChromaticEdge !== undefined) u.uChromaticEdge.value = p.twChromaticEdge;
      if (u.uColorR && p.twColorR !== undefined) u.uColorR.value = p.twColorR;
      if (u.uColorG && p.twColorG !== undefined) u.uColorG.value = p.twColorG;
      if (u.uColorB && p.twColorB !== undefined) u.uColorB.value = p.twColorB;
      if (u.uShadowRidges && p.twShadowRidges !== undefined) u.uShadowRidges.value = p.twShadowRidges;
      if (u.uMix && p.twMix !== undefined) u.uMix.value = p.twMix;
      break;

    case 'strobeSequencer':
      if (u.uBPM && p.ssBPM !== undefined) u.uBPM.value = p.ssBPM;
      if (u.uSteps && p.ssSteps !== undefined) u.uSteps.value = p.ssSteps;
      if (u.uPattern && p.ssPattern !== undefined) u.uPattern.value = p.ssPattern;
      if (u.uMode && p.ssMode !== undefined) u.uMode.value = p.ssMode;
      if (u.uIntensity && p.ssIntensity !== undefined) u.uIntensity.value = p.ssIntensity;
      if (u.uTintR && p.ssTintR !== undefined) u.uTintR.value = p.ssTintR;
      if (u.uTintG && p.ssTintG !== undefined) u.uTintG.value = p.ssTintG;
      if (u.uTintB && p.ssTintB !== undefined) u.uTintB.value = p.ssTintB;
      if (u.uSwing && p.ssSwing !== undefined) u.uSwing.value = p.ssSwing;
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
    case 'gpuFluidSim':
      // Tuned defaults — punchy but stable. Higher dye/velocity decay than
      // the conservative baseline so trails settle quickly instead of
      // smearing the canvas; vorticity dialled back from the noisy 1.5
      // baseline; inject + velocity push at ~half max for legible motion.
      return {
        injectStrength: 1.5,
        velocityFromGradient: 1.4,
        vorticity: 1.0,
        dyeDecay: 2.4,
        velocityDecay: 2.3,
        outputBoost: 0.7,
        timeScale: 1.6,
      };
    case 'vignette':
      return {
        vignetteSize: 0.8, vignetteSoftness: 0.4, vignetteRoundness: 0.5,
        vignetteShape: 0, vignetteAspect: 1.0,
        vignetteCenterX: 0.5, vignetteCenterY: 0.5,
        vignetteColorR: 0, vignetteColorG: 0, vignetteColorB: 0,
        vignetteTintAmount: 0,
        vignetteBreathing: 0, vignetteBreathSpeed: 0.5,
      };
    case 'edgeFeather':
      return {
        featherTop: 0, featherBottom: 0, featherLeft: 0, featherRight: 0, featherSoftness: 0.5,
        featherGamma: 1.0, featherMattePreview: 0,
      };
    case 'colorama':
      return {
        coloramaPalette: 0,
        coloramaOffset: 0,
        coloramaSpeed: 0.2,
        coloramaContrast: 1,
        coloramaMix: 1,
        coloramaBands: 0,
        coloramaAudioReact: 0,
        coloramaHueShift: 0,
      };
    case 'dither':
      return { ditherType: 0, ditherIntensity: 1.0, ditherScale: 1, ditherColorDepth: 2, ditherPalette: 0, ditherPixelLock: 0 };
    case 'vhs':
      return {
        vhsTracking: 0.5, vhsNoise: 0.3, vhsDistortion: 0.3,
        vhsColorBleed: 0.5, vhsScanlines: 0.3,
        vhsHeadSwitch: 0, vhsTapeWobble: 0, vhsDropout: 0,
        vhsChromaDelay: 0, vhsTrackingJump: 0, vhsSaturation: 1,
      };
    case 'glitch':
      return {
        glitchIntensity: 0.5, glitchSpeed: 1, glitchBlockSize: 0.3,
        glitchRGBSplit: 0.5, glitchJitter: 0.3,
        glitchTriggerMode: 0, glitchBlockHold: 0.3,
        glitchVerticalSlice: 0, glitchFreezeBurst: 0, glitchTearChance: 0,
      };
    case 'rgbShift':
      return {
        rgbShiftAmount: 5, rgbShiftAngle: 0, rgbShiftMode: 0,
        rgbShiftCenterX: 0.5, rgbShiftCenterY: 0.5, rgbShiftPrismSpread: 1,
      };
    case 'scanlines':
      return {
        scanlinesIntensity: 0.5, scanlinesCount: 200, scanlinesSpeed: 0,
        scanlinesPhosphor: 0, scanlinesRollingBar: 0, scanlinesCurvature: 0, scanlinesInterlace: 0,
      };
    case 'pixelate':
      return {
        pixelateSize: 8, pixelateMode: 0, pixelateGrid: 0,
        pixelateAnimSpeed: 0, pixelateAnimAmount: 0,
      };
    case 'blur':
      return {
        blurRadius: 5, blurMode: 1, blurAngle: 0,
        blurQuality: 1, blurEdgeProtect: 0.3, blurMix: 1,
      };
    case 'sharpen':
      return {
        sharpenAmount: 0.5, sharpenMode: 0, sharpenRadius: 2,
        sharpenEdgeProtect: 0.2, sharpenClarity: 0,
      };
    case 'noise':
      return {
        noiseAmount: 0.2, noiseType: 0, noiseMode: 0, noiseScale: 1, noiseMono: 0,
        noiseShadow: 1, noiseMid: 1, noiseHigh: 1, noiseAnimSpeed: 1,
      };
    case 'kaleidoscope':
      return {
        kaleidoscopeSegments: 6, kaleidoscopeAngle: 0,
        kaleidoscopeCenterX: 0.5, kaleidoscopeCenterY: 0.5, kaleidoscopeZoom: 1,
        kaleidoscopeMode: 0, kaleidoscopeSpiral: 0, kaleidoscopeAnimSpeed: 0, kaleidoscopeMix: 1,
      };
    case 'mirror':
      return {
        mirrorMode: 0, mirrorPosition: 0.5, mirrorOffset: 0.5,
        mirrorFlipSide: 0, mirrorMix: 1,
      };
    case 'plasma':
      return {
        plasmaSpeed: 1, plasmaScale: 5, plasmaComplexity: 3, plasmaPalette: 0,
        plasmaMode: 0, plasmaBlendMode: 0, plasmaMix: 1,
        plasmaWarpAmount: 0.4, plasmaAudioReact: 0,
      };
    case 'posterize':
      return {
        posterizeLevels: 8,
        posterizeDither: 0,
        posterizeAnimSpeed: 0,
        posterizePalette: 0,
      };
    case 'edgeDetect':
      return {
        edgeThreshold: 0.1, edgeThickness: 1, edgeMode: 0, edgeInvert: 0,
        edgeTintR: 1, edgeTintG: 1, edgeTintB: 1, edgeTintEdges: 0, edgeGlow: 0, edgeOnlyAlpha: 0,
      };
    case 'outline':
      return {
        outlineThickness: 2, outlineColor: [1, 1, 1], outlineOnly: 0, outlineGlow: 0,
        outlinePosition: 1, outlineCrawl: 0, outlineGlowFalloff: 1, outlineAlphaAware: 0,
      };
    case 'emboss':
      return {
        embossStrength: 1, embossAngle: 135, embossHeight: 1,
        embossHighlightR: 1, embossHighlightG: 1, embossHighlightB: 1,
        embossShadowR: 0, embossShadowG: 0, embossShadowB: 0,
        embossNormalMode: 0, embossMetallicness: 0,
      };
    case 'wave':
      return {
        waveAmplitude: 10, waveFrequency: 5, waveSpeed: 1, waveType: 0,
        waveWaveform: 0, wavePhase: 0, waveSecondary: 0, waveChromaSplit: 0,
      };
    case 'fisheye':
      return {
        fisheyeStrength: 0.5, fisheyeRadius: 1,
        fisheyeCenterX: 0.5, fisheyeCenterY: 0.5, fisheyeZoom: 1,
        fisheyeMode: 0, fisheyeChromaEdge: 0,
      };
    case 'thermal':
      return {
        thermalIntensity: 1, thermalPalette: 0,
        thermalShimmer: 0, thermalSensorNoise: 0,
      };
    case 'nightVision':
      return {
        nightVisionIntensity: 1.5, nightVisionNoise: 0.3, nightVisionVignette: 0.5,
        nightVisionPhosphor: 0, nightVisionBloom: 0.6,
        nightVisionScopeMask: 1, nightVisionRollingNoise: 0,
      };
    case 'brightness':
      return { brightnessAmount: 0 };
    case 'contrast':
      return { contrastAmount: 0 };
    case 'saturation':
      return { saturationAmount: 0 };
    case 'hue':
      return { hueShift: 0 };
    case 'curves':
      return { curvesContrast: 0.4, curvesToe: 0, curvesShoulder: 0, curvesBlackCrush: 0, curvesMix: 1 };
    case 'liftGammaGain':
      return {
        lggLiftR: 0, lggLiftG: 0, lggLiftB: 0,
        lggGammaR: 1, lggGammaG: 1, lggGammaB: 1,
        lggGainR: 1, lggGainG: 1, lggGainB: 1,
        lggLumaOnly: 0, lggMix: 1,
      };
    case 'exposure':
      return { exposureStops: 0, exposureRollOff: 0, exposureHighlightProtect: 0 };
    case 'gamma':
      return { gammaShadows: 1, gammaMids: 1, gammaHighlights: 1, gammaMix: 1 };
    case 'temperatureTint':
      return {
        tempTemperature: 0, tempTint: 0,
        tempShadow: 0, tempHighlight: 0,
        tempSplitTone: 0, tempAutoCycle: 0,
      };
    case 'vibrance':
      return { vibranceAmount: 0.3, vibranceSkinProtect: 0.5, vibranceHighlightProtect: 0.3, vibranceCeiling: 1 };
    case 'colorBalance':
      return {
        cbShadowR: 0, cbShadowG: 0, cbShadowB: 0,
        cbMidR: 0, cbMidG: 0, cbMidB: 0,
        cbHighR: 0, cbHighG: 0, cbHighB: 0,
        cbPreserveLuma: 1, cbMix: 1,
      };
    case 'filmGrain':
      return {
        grainAmount: 0.3, grainSize: 1, grainShadow: 0.7, grainMid: 1, grainHigh: 0.5,
        grainMono: 0, grainStock: 1, grainColorJitter: 0, grainAnimSpeed: 1,
      };
    case 'bloom':
      return {
        amount: 0.6,
        bloomIntensity: 1.0,
        threshold: 0.6,
        bloomKnee: 0.4,
        bloomRadius: 0.5,
        bloomAnamorphic: 0,
        red: 1, green: 1, blue: 1,
      };
    case 'chromaticAberration':
      return {
        caAmount: 0.4, caMode: 1, caAngle: 0,
        caCenterX: 0.5, caCenterY: 0.5, caEdgeFalloff: 0.5, caMix: 1,
      };
    case 'lensDistortion':
      return {
        lensDistAmount: 0.4, lensDistMode: 0,
        lensDistCenterX: 0.5, lensDistCenterY: 0.5, lensDistCubic: 0,
        lensDistAnamorphicX: 1.3, lensDistEdgeFade: 1, lensDistChromaFringe: 0,
      };
    case 'tiltShift':
      return {
        tiltShiftMode: 0, tiltShiftFocusY: 0.5, tiltShiftFocusX: 0.5,
        tiltShiftFocusBand: 0.2, tiltShiftFalloff: 0.3, tiltShiftMaxBlur: 0.5,
        tiltShiftAngle: 0, tiltShiftSaturation: 1.2,
      };
    case 'godRays':
      return {
        godRaysIntensity: 0.7, godRaysDecay: 0.95, godRaysExposure: 0.4,
        godRaysDensity: 0.95, godRaysThreshold: 0.7,
        godRaysCenterX: 0.5, godRaysCenterY: 0.2, godRaysSamples: 64,
        godRaysTintR: 1, godRaysTintG: 0.95, godRaysTintB: 0.85, godRaysMix: 1,
      };
    case 'heatHaze':
      return {
        hazeAmount: 0.4, hazeScale: 8, hazeSpeed: 1, hazeDirectionY: 0.5,
        hazeTurbulence: 0.5, hazeMode: 0, hazeFocusY: 0.5, hazeFocusBand: 0.4,
      };
    case 'directionalBlur':
      return {
        dirBlurAmount: 0.25, dirBlurAngle: 0, dirBlurSamples: 16,
        dirBlurFalloff: 0.3, dirBlurCenterBias: 0, dirBlurMix: 1,
      };
    case 'zoomBlur':
      return {
        zoomBlurAmount: 0.25, zoomBlurCenterX: 0.5, zoomBlurCenterY: 0.5,
        zoomBlurSamples: 16, zoomBlurFalloff: 0.3, zoomBlurChromatic: 0, zoomBlurMix: 1,
      };
    case 'radialBlur':
      return {
        radialBlurAmount: 0.25, radialBlurCenterX: 0.5, radialBlurCenterY: 0.5,
        radialBlurSamples: 16, radialBlurFalloff: 0.3,
        radialBlurRadiusInner: 0, radialBlurRadiusOuter: 0.7, radialBlurMix: 1,
      };
    case 'halftone':
      return {
        halftoneDotSize: 6, halftoneDotShape: 0,
        halftoneAngleC: 15, halftoneAngleM: 75, halftoneAngleY: 0, halftoneAngleK: 45,
        halftoneMode: 0, halftoneDrift: 0, halftoneSpotColor: [0, 0, 0],
      };
    case 'toon':
      return {
        toonSteps: 4, toonOutline: 0.6, toonOutlineColor: [0, 0, 0],
        toonShadowBand: 0.3, toonRampSoftness: 0, toonColorPop: 0.3,
      };
    case 'kuwahara':
      return { kuwaharaRadius: 3, kuwaharaEdgeSharpness: 0.3, kuwaharaColorPunch: 0.2 };
    case 'oilPaint':
      return {
        oilPaintRadius: 4, oilPaintIntensity: 12, oilPaintBrushLength: 0.6,
        oilPaintBristle: 0.4, oilPaintColorPunch: 0.3, oilPaintHighlight: 0.2, oilPaintMode: 0,
      };
    case 'watercolor':
      return {
        watercolorBleed: 0.5, watercolorEdgeDarken: 0.5, watercolorPaperTexture: 0.4,
        watercolorPaperScale: 8, watercolorWetness: 0.3, watercolorGranulation: 0.2, watercolorPaperHue: 0,
      };
    case 'crt':
      return {
        crtScanlines: 0.5, crtScanCount: 480, crtMask: 0.5, crtMaskType: 0,
        crtCurvature: 0.3, crtVignette: 0.4, crtGlow: 0.5, crtRollingBar: 0, crtChromatic: 0.3,
      };
    case 'compressionArtifacts':
      return {
        compArtBlockSize: 8, compArtQuality: 0.4,
        compArtChromaSubsample: 0.6, compArtBlockNoise: 0.2,
        compArtMode: 0, compArtMix: 1,
      };
    case 'chromaKey':
      return {
        chromaKeyR: 0, chromaKeyG: 1, chromaKeyB: 0,
        chromaKeyTolerance: 0.25, chromaKeySoftness: 0.15,
        chromaKeySpill: 0.6, chromaKeyMatte: 0, chromaKeyMode: 1,
      };
    case 'lumaKey':
      return {
        lumaKeyLowCut: 0.4, lumaKeyHighCut: 0.6, lumaKeyInvert: 0,
        lumaKeyGamma: 1, lumaKeyMatte: 0, lumaKeyPremultiply: 0,
      };
    case 'differenceKey':
      return {
        diffKeyR: 0, diffKeyG: 0, diffKeyB: 0,
        diffKeyTolerance: 0.3, diffKeySoftness: 0.15,
        diffKeyInvert: 0, diffKeyMatte: 0, diffKeyMode: 0,
      };
    case 'erode':
      return { erodeRadius: 2, erodeShape: 1, erodeChannel: 0, erodeMix: 1 };
    case 'dilate':
      return { dilateRadius: 2, dilateShape: 1, dilateChannel: 0, dilateMix: 1 };
    case 'displacement':
      return {
        dispAmount: 0.4, dispScale: 6, dispSpeed: 1,
        dispMode: 0, dispTurbulence: 0.5, dispChromatic: 0,
      };
    case 'twirl':
      return {
        twirlAngle: 1.5, twirlRadius: 0.5,
        twirlCenterX: 0.5, twirlCenterY: 0.5, twirlFalloff: 1.5,
        twirlAnimSpeed: 0, twirlMix: 1,
      };
    case 'pinchBulge':
      return {
        pinchAmount: 0.4, pinchRadius: 0.5,
        pinchCenterX: 0.5, pinchCenterY: 0.5, pinchFalloff: 1.5,
        pinchChromatic: 0, pinchMix: 1,
      };
    // ── Premium Pack effects (unique defaults per effect) ──
    case 'filmicTonemap':
      return { tonemapCurve: 0, tonemapExposure: 1.0, tonemapContrast: 0, tonemapMix: 1 };
    case 'selectiveColor':
      return {
        selColorTargetHue: 0, selColorRange: 0.1, selColorFeather: 0.1,
        selColorMode: 0, selColorReplaceHue: 0.33, selColorSatBoost: 0,
      };
    case 'falseColor':
      return {
        falseColorMode: 0, falseColorMix: 1, falseColorShowOriginal: 1,
        falseColorMidpoint: 0.5, falseColorRange: 0,
      };
    case 'shadowRecovery':
      return {
        shadowAmount: 0.5, shadowThreshold: 0.4, shadowSoftness: 0.3,
        shadowColorRecovery: 0.3, shadowHighlightProtect: 0.6, shadowMix: 1,
      };
    case 'highlightRolloff':
      return {
        highRolloffAmount: 0.5, highRolloffThreshold: 0.7, highRolloffSoftness: 0.2,
        highRolloffPreserveHue: 0.5, highRolloffMaxValue: 1, highRolloffMix: 1,
      };
    case 'halation':
      return {
        halationAmount: 0.6, halationRadius: 12, halationThreshold: 0.65,
        halationTintR: 0.9, halationTintG: 0.45, halationTintB: 0.2,
        halationMode: 0, halationMix: 1,
      };
    case 'anamorphicStreak':
      return {
        anaIntensity: 0.6, anaLength: 0.5, anaThreshold: 0.7,
        anaTintR: 0.6, anaTintG: 0.75, anaTintB: 1,
        anaAngle: 0, anaSamples: 32, anaMix: 1,
      };
    case 'lensDirt':
      return {
        dirtAmount: 0.5, dirtScale: 8, dirtThreshold: 0.6, dirtTintWarmth: 0.4,
        dirtScratches: 0.2, dirtSpots: 0.6, dirtMode: 0, dirtAnimSpeed: 0,
      };
    case 'defocusBokeh':
      return {
        bokehRadius: 12, bokehSamples: 24, bokehBrightWeight: 0.8, bokehThreshold: 0.7,
        bokehChromaFringe: 0, bokehShape: 0, bokehRotation: 0, bokehMix: 1,
      };
    case 'diffusionPromist':
      return {
        diffAmount: 0.5, diffRadius: 12, diffThreshold: 0.6,
        diffShadowLift: 0.3, diffHighlightBloom: 0.5,
        diffHaze: 0.3, diffHazeWarmth: 0.5, diffMix: 1,
      };
    case 'ascii':
      return {
        asciiCellSize: 12, asciiContrast: 1.2, asciiColorMix: 0.3,
        asciiMode: 0, asciiInvert: 0,
        asciiTintR: 0, asciiTintG: 1, asciiTintB: 0.4,
      };
    case 'comicInk':
      return {
        comicInkStrength: 1.2, comicInkThreshold: 0.3, comicInkPosterize: 5,
        comicInkHalftone: 0.4, comicInkHalftoneSize: 6, comicInkColorMix: 0.3,
        comicInkR: 0, comicInkG: 0, comicInkB: 0,
      };
    case 'datamoshLite':
      // Reverted: original premiumPack pixel-sort schema.
      return { amount: 0.5, amount2: 0.3, amount3: 0.4 };
    case 'scanlineDrift':
      return {
        scanDriftIntensity: 0.5, scanDriftFrequency: 80,
        scanDriftSpeed: 1, scanDriftWaveform: 0,
        scanDriftChromaSplit: 0.3, scanDriftChunkiness: 0,
      };
    case 'tapeDropout':
      return {
        tapeDropoutDensity: 0.4, tapeDropoutLength: 0.5,
        tapeDropoutColor: 0, tapeDropoutSpeed: 1,
        tapeDropoutNoise: 0.7, tapeDropoutMix: 1,
      };
    case 'polarTransform':
      return {
        polarMode: 0, polarRotation: 0, polarZoom: 1,
        polarCenterX: 0.5, polarCenterY: 0.5, polarMix: 1,
      };
    case 'rippleCaustics':
      return {
        causticsIntensity: 0.6, causticsScale: 8, causticsSpeed: 0.6,
        causticsRefraction: 0.4, causticsTintR: 0.6, causticsTintG: 0.85,
        causticsTintB: 1, causticsMode: 0,
      };
    case 'shockwave':
      return {
        shockTriggerTime: 0, shockSpeed: 0.6, shockAmplitude: 0.06,
        shockRingWidth: 0.15, shockCenterX: 0.5, shockCenterY: 0.5,
        shockChromatic: 0.3, shockMode: 0,
      };
    case 'drosteRecursive':
      return {
        drosteZoom: 1.5, drosteRotation: 5, drosteIterations: 6,
        drosteOffsetX: 0.5, drosteOffsetY: 0.5, drosteFrameSize: 0.4, drosteMix: 1,
      };
    case 'slitScan':
      return {
        slitScanIntensity: 0.5, slitScanMode: 0, slitScanPattern: 0,
        slitScanSpeed: 1, slitScanChromaSplit: 0,
      };
    case 'volumetricFogOverlay':
      return {
        fogDensity: 0.5, fogScale: 6, fogSpeed: 0.5, fogHeightFalloff: -0.3,
        fogDepthSim: 0.5, fogColorR: 0.85, fogColorG: 0.9, fogColorB: 0.95,
        fogTurbulence: 1, fogMode: 1,
      };
    case 'rainFogSnowOverlay':
      return {
        weatherType: 0, weatherDensity: 0.5, weatherSpeed: 1, weatherAngle: 10,
        weatherSize: 1, weatherFog: 0.2,
        weatherColorR: 0.85, weatherColorG: 0.9, weatherColorB: 1,
      };
    case 'particleOverlayFx':
      return {
        partMode: 0, partDensity: 0.4, partSize: 1, partSpeed: 1, partTwinkle: 0.5,
        partColorR: 1, partColorG: 1, partColorB: 0.9, partBlend: 0,
      };
    case 'glintStarburst':
      return {
        glintIntensity: 0.7, glintThreshold: 0.75, glintLength: 0.4,
        glintPoints: 4, glintRotation: 0,
        glintColorR: 1, glintColorG: 0.95, glintColorB: 0.85,
      };
    case 'embossRelight':
      return {
        embRelStrength: 1, embRelAngle: 135, embRelHeight: 1, embRelDetail: 1,
        embRelSpecular: 0.3, embRelColorPreserve: 0.5, embRelAmbient: 0.3,
      };
    // ── Premium Text & Pattern ──
    case 'dotMatrix':
      return {
        dmDotSize: 12, dmDotShape: 0, dmGap: 0.2, dmPosterize: 4, dmGlow: 0.4,
        dmBgR: 0, dmBgG: 0, dmBgB: 0,
      };
    case 'matrixRain':
      return {
        matrixDensity: 0.6, matrixSpeed: 1, matrixCellSize: 14, matrixTrailLength: 0.5,
        matrixColorR: 0, matrixColorG: 1, matrixColorB: 0.4, matrixBgMix: 0.5,
      };
    case 'binaryCode':
      return {
        binDensity: 0.7, binSpeed: 0.5, binCellSize: 12,
        binColorR: 0, binColorG: 1, binColorB: 0.3,
        binBgMix: 0.5, binContrast: 1,
      };
    case 'crosshatch':
      return {
        hatchDensity: 1, hatchAngle: 30, hatchLineWidth: 1, hatchContrast: 1,
        hatchPaperR: 0.95, hatchPaperG: 0.93, hatchPaperB: 0.88,
        hatchInkR: 0.1, hatchInkG: 0.1, hatchInkB: 0.1,
      };
    case 'blockMosaic':
      return {
        mosaicTileSize: 24, mosaicMode: 0, mosaicGrout: 0.15, mosaicColorJitter: 0.1,
        mosaicGroutR: 0.1, mosaicGroutG: 0.1, mosaicGroutB: 0.1,
      };
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
      return {
        terrainMode: 1, terrainHeight: 0.5, terrainCamHeight: 0.5, terrainSpeed: 0.3,
        terrainFog: 0.4, terrainYaw: 0, terrainPitch: 0.5, terrainRoll: 0,
        terrainFogR: 0.05, terrainFogG: 0.07, terrainFogB: 0.12,
        terrainHorizonFade: 0.7, terrainSourceMix: 0,
      };
    case 'wrappedTerrain':
      return {
        wtShape: 0, wtHeight: 0.4,
        wtRotateX: 0.5, wtRotateY: 0.5, wtAutoRotate: 0.4,
        wtCamDistance: 2.5, wtSpecular: 0.4, wtAmbient: 0.3,
        wtFogDistance: 0.2, wtFogR: 0.05, wtFogG: 0.07, wtFogB: 0.12,
        wtHorizonFade: 0.6, wtSourceMix: 0, wtTileScale: 1,
      };

    // ── Geometric 3D (10) ──
    case 'stringOrb':
      return {
        soRadius: 0.85, soHeight: 0.4, soLatCount: 16, soLonCount: 24, soDiagCount: 8, soSlope: 1.5,
        soWidth: 0.012, soSpin: 0.4, soTilt: 0.15, soFlow: 0.5,
        soIntensity: 1, soGlow: 0.7, soGlowR: 0.4, soGlowG: 0.85, soGlowB: 1,
        soHorizonFade: 0.7, soTileScale: 1,
      };
    case 'sphereWireframe':
      return {
        swRadius: 0.85, swHeight: 0.4, swMeridians: 16, swParallels: 12, swWidth: 0.012,
        swSpin: 0.4, swTilt: 0.2, swIntensity: 1.2, swHaloGlow: 0.7,
        swColorR: 0.5, swColorG: 0.9, swColorB: 1, swHorizonFade: 0.7, swFillSource: 0.4, swTileScale: 1,
      };
    case 'voxelCubeCluster':
      return {
        vccGridSize: 4, vccCubeSize: 0.22, vccSpacing: 0.7, vccHeight: 0.5,
        vccSpin: 0.5, vccTilt: 0.5, vccCamDistance: 4,
        vccSpecular: 0.4, vccAmbient: 0.3, vccHorizonFade: 0.6,
        vccBgR: 0.04, vccBgG: 0.05, vccBgB: 0.08,
      };
    case 'mobiusLattice':
      return {
        mlMajorR: 0.85, mlRibbonW: 0.3, mlTwists: 1, mlSpin: 0.5, mlTilt: 0.25,
        mlLineDensity: 16, mlLineWidth: 0.015, mlIntensity: 1,
        mlLineR: 1, mlLineG: 0.85, mlLineB: 0.4, mlHorizonFade: 0.6,
      };
    case 'crystalShardField':
      return {
        csfShardCount: 16, csfShardSize: 0.28, csfSpread: 1.2,
        csfChromaEdge: 0.4, csfRefraction: 0.5, csfSpin: 0.4, csfIntensity: 1,
        csfTintR: 0.85, csfTintG: 0.95, csfTintB: 1, csfHorizonFade: 0.6,
      };
    case 'tubeLattice':
      return {
        tlTubeCount: 6, tlTubeRadius: 0.15, tlSpread: 0.9,
        tlSpin: 0.4, tlTilt: 0.3, tlTwist: 0.5, tlIntensity: 1,
        tlRimR: 0, tlRimG: 0.95, tlRimB: 1, tlHorizonFade: 0.6,
      };
    case 'discoMirrorBall':
      return {
        dmbRadius: 1, dmbFacetCount: 16, dmbSpin: 0.6, dmbTilt: 0.2,
        dmbChaseSpeed: 1.2, dmbChaseHueWidth: 0.3, dmbSparkle: 0.5, dmbIntensity: 1.2,
        dmbHighlightR: 1, dmbHighlightG: 1, dmbHighlightB: 0.85, dmbHorizonFade: 0.5,
      };
    case 'lissajousKnot':
      return {
        lkRatioX: 3, lkRatioY: 4, lkRatioZ: 5, lkPhaseX: 0.25, lkPhaseY: 0,
        lkTubeRadius: 0.08, lkScale: 1, lkSpin: 0.4, lkTilt: 0.25, lkIntensity: 1,
        lkTubeR: 1, lkTubeG: 0.5, lkTubeB: 0.85, lkHorizonFade: 0.6,
      };
    case 'helixParticleStream':
      return {
        hpsHelices: 2, hpsHelixRadius: 0.5, hpsTurns: 3, hpsHeight: 2,
        hpsTubeRadius: 0.06, hpsRiseSpeed: 1, hpsSpin: 0.3, hpsTilt: 0.2, hpsIntensity: 1,
        hpsTintR: 0.4, hpsTintG: 1, hpsTintB: 0.7, hpsHorizonFade: 0.6,
      };
    case 'donutConstellation':
      return {
        dcMajorR: 1, dcMinorR: 0.18, dcStarCount: 12, dcStarSize: 0.025,
        dcSpin: 0.4, dcTilt: 0.4, dcTintIntensity: 1,
        dcTorusR: 0.8, dcTorusG: 0.4, dcTorusB: 1,
        dcStarR: 1, dcStarG: 1, dcStarB: 0.85, dcHorizonFade: 0.6,
      };
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
      return {
        geomTiles: 4, geomMode: 0, geomRotation: 90, geomOffsetX: 0, geomMix: 1,
      };
    // ── Premium Depth ──
    case 'tunnelFlight':
      return {
        tunnelSpeed: 1, tunnelTwist: 0.5, tunnelDepth: 1.5,
        tunnelCenterX: 0.5, tunnelCenterY: 0.5,
        tunnelMode: 0, tunnelChromatic: 0.2,
      };
    case 'infiniteMirror':
      return {
        infMirrorIterations: 5, infMirrorShrink: 0.8, infMirrorRotation: 5,
        infMirrorTintFade: 0.4, infMirrorHueShift: 0.05,
        infMirrorMode: 0, infMirrorOffsetX: 0.5, infMirrorOffsetY: 0.5,
      };
    case 'crystalRefract':
      return {
        crystalScale: 6, crystalRefraction: 0.4, crystalSparkle: 0.4, crystalEdgeGlow: 0.5,
        crystalTintR: 0.85, crystalTintG: 0.95, crystalTintB: 1, crystalMode: 0,
      };
    // ── Premium Feedback ──
    case 'feedbackZoom':
      // Defaults tuned for obvious spirals out of the box. Subtle looks
      // are achievable by dialing down (zoom→1.01, rotation→0.003).
      return {
        amount: 0.85,
        feedbackZoom: 1.04,
        feedbackRotation: 0.02,
        feedbackDecay: 0.04,
        feedbackHueShift: 0,
        feedbackMaskCenter: 0,
      };
    // ── Premium Warp ──
    case 'fractalWarp':
      return {
        fractalWarpAmount: 0.5, fractalWarpScale: 4, fractalWarpOctaves: 4,
        fractalWarpSpeed: 0.7, fractalWarpChromatic: 0.2, fractalWarpMode: 0,
      };
    case 'fluidDistort':
      return {
        fluidDistAmount: 0.5, fluidDistScale: 4, fluidDistSpeed: 0.8,
        fluidDistTurbulence: 0.5, fluidDistMode: 0,
      };
    case 'wormhole':
      return {
        wormholePullStrength: 0.5, wormholeRotation: 1,
        wormholeCenterX: 0.5, wormholeCenterY: 0.5, wormholeTwist: 0.5,
        wormholeChromatic: 0.3, wormholeAnimSpeed: 0.5,
      };
    // ── Premium Trails ──
    case 'motionTrails':
      return {
        motionTrailsLength: 0.4, motionTrailsAngle: 0, motionTrailsSamples: 16,
        motionTrailsFalloff: 0.5, motionTrailsChromaSplit: 0.2, motionTrailsMode: 0,
      };
    case 'echoRepeat':
      return {
        echoCount: 5, echoOffsetX: 0.05, echoOffsetY: 0.05,
        echoDecay: 0.7, echoHueShift: 0.02, echoMode: 0,
      };
    case 'ghostDouble':
      return {
        ghostOpacity: 0.5, ghostOffsetX: 0.05, ghostOffsetY: 0,
        ghostMirror: 0, ghostTintR: 1, ghostTintG: 1, ghostTintB: 1, ghostBlend: 0,
      };
    case 'strobeFlash':
      return {
        strobeRate: 4, strobeDuty: 0.5, strobeIntensity: 1, strobeMode: 0,
        strobeTintR: 1, strobeTintG: 1, strobeTintB: 1,
      };
    case 'lightPaint':
      return {
        lightPaintIntensity: 0.7, lightPaintThreshold: 0.5, lightPaintTrailLength: 0.4,
        lightPaintFlowAngle: 0, lightPaintFlowScale: 6, lightPaintChromaShift: 0.3,
        lightPaintTintR: 1, lightPaintTintG: 0.8, lightPaintTintB: 0.3,
      };
    case 'recursiveEcho':
      return {
        recEchoDepth: 5, recEchoZoom: 0.95, recEchoRotation: 5, recEchoOpacity: 0.6,
        recEchoHueShift: 0.05, recEchoOffsetX: 0.02, recEchoOffsetY: 0.02, recEchoMode: 0,
      };
    case 'invert':
      // Hero defaults — full RGB invert at amount=1 (matches legacy).
      return {
        invertMode: 0,
        invertAmount: 1,
        invertThreshold: 0.5,
        invertStrobeRate: 4,
      };
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

    // ── Batch A: brand-new hero effects ──
    case 'opticalFlowDatamosh':
      return {
        ofdmIntensity: 0.7, ofdmMotionScale: 1, ofdmPersistence: 0.7,
        ofdmChromaSplit: 0.3, ofdmBlockSize: 12, ofdmFreeze: 0, ofdmMode: 0,
      };
    case 'flowFieldTrails':
      return {
        fftFlowScale: 4, fftTrailLength: 0.4, fftSamples: 24, fftSpeed: 0.8,
        fftChromaSplit: 0.3, fftContrast: 1, fftMode: 0, fftColorCycle: 0,
      };
    case 'reactionDiffusion':
      return {
        rdFeedRate: 0.055, rdKillRate: 0.062, rdDiffusionA: 1.0, rdDiffusionB: 0.5,
        rdPatternScale: 1, rdLumaMask: 0.5, rdMode: 0,
        rdColorR: 0.4, rdColorG: 0.85, rdColorB: 1, rdMix: 0.6, rdReseed: 0.3,
      };
    case 'neonTubeTrace':
      return {
        ntEdgeThreshold: 0.15, ntTubeWidth: 1.5, ntGlow: 1, ntGlowRadius: 6,
        ntTintR: 1, ntTintG: 0.2, ntTintB: 0.7,
        ntChase: 0, ntChaseSpeed: 1, ntFlicker: 0, ntBg: 2,
      };
    case 'depthParallax':
      return {
        dpDepthStrength: 0.5, dpPushIn: 0.3, dpLayers: 4,
        dpChromatic: 0.3, dpDepthBoost: 1, dpMode: 0, dpPanX: 0, dpPanY: 0,
      };
    case 'pointCloudDissolve':
      return {
        pcdDissolve: 0, pcdDotSize: 4, pcdScatterRadius: 0.4,
        pcdAttract: 0, pcdTurbulence: 0.3, pcdMode: 1,
        pcdBgR: 0, pcdBgG: 0, pcdBgB: 0, pcdHueShift: 0,
      };
    case 'pixelSand':
      return {
        psGravity: 1, psTurbulence: 0.3, psThreshold: 0.6, psPersistence: 0.92,
        psMode: 0, psReplenish: 0.6, psChromaSplit: 0, psGrainSize: 3,
      };
    case 'liquidGlass':
      return {
        lgBlobs: 3, lgBlobSize: 0.18, lgRefraction: 0.5, lgChromatic: 0.4,
        lgSpecular: 0.5, lgCausticAmount: 0.3, lgSpeed: 0.5,
        lgTintR: 0.85, lgTintG: 0.95, lgTintB: 1,
      };
    case 'hologramScan':
      return {
        hsIntensity: 0.7, hsScanFreq: 200, hsScanSpeed: 1, hsGridSpacing: 12,
        hsRGBFlicker: 0.4, hsBrokenBands: 0.3,
        hsTintR: 0.4, hsTintG: 0.95, hsTintB: 1,
        hsOpacityFlicker: 0.3, hsEdgeGlow: 0.6,
      };
    case 'laserSlice':
      return {
        lsMode: 0, lsSpeed: 1, lsBeamWidth: 0.02, lsGlow: 1.2,
        lsSparks: 0.4, lsEraseAmount: 0.5,
        lsTintR: 1, lsTintG: 0.1, lsTintB: 0.1,
        lsReveal: 1, lsPersistence: 0.92,
      };

    // ── Batch B: brand-new hero effects ──
    case 'auraField':
      return {
        afIntensity: 1, afRadius: 12, afEdgeAmount: 0.6, afLumaAmount: 0.4,
        afAudioReact: 0.5, afHueShift: 0,
        afTintR: 0.6, afTintG: 0.85, afTintB: 1, afMode: 1,
      };
    case 'smokeDisintegrate':
      return {
        smokeAmount: 0.4, smokeScale: 4, smokeSpeed: 1, smokeDirection: 90,
        smokeEdgeFade: 0.5,
        smokeColorR: 0.85, smokeColorG: 0.85, smokeColorB: 0.9, smokeMode: 0,
      };
    case 'shimmerCloth':
      return {
        clothAmplitude: 0.3, clothFrequency: 8, clothSpeed: 0.7,
        clothThreadDensity: 60, clothThreadDepth: 0.5, clothShimmer: 0.5, clothMode: 0,
      };
    case 'glitchQuilt':
      return {
        gqTileSize: 32, gqShuffleAmount: 0.4, gqRotateAmount: 0.3,
        gqDelayAmount: 0.3, gqChromaSplit: 0.3, gqTriggerRate: 1, gqMode: 0,
      };
    case 'cellularAutomataBurn':
      return {
        caCellSize: 2, caBirthThreshold: 0.5, caSurvivalLow: 1.5, caSurvivalHigh: 3.5,
        caColorR: 1, caColorG: 0.5, caColorB: 0.1, caMode: 0, caMix: 0.7,
      };
    case 'rorschachMirror':
      return {
        rmMode: 0, rmInkAmount: 0.4, rmFluidEdges: 0.3,
        rmTintR: 0.05, rmTintG: 0.05, rmTintB: 0.05,
        rmBgR: 0.95, rmBgG: 0.95, rmBgB: 0.92, rmMixOriginal: 0,
      };
    case 'spectralPrismTunnel':
      return {
        sptTunnelDepth: 1.5, sptPrismSpread: 1, sptRotation: 1,
        sptSpeed: 1, sptSlices: 12, sptFade: 0.5,
      };
    case 'ledVolume':
      return {
        ledVoxelSize: 16, ledDepthPulse: 0.4, ledDepthSpeed: 1, ledPosterize: 4,
        ledGlow: 0.5, ledPerspective: 0.4, ledMode: 1,
        ledBgR: 0, ledBgG: 0, ledBgB: 0,
      };
    case 'posterTear':
      return {
        ptTearAmount: 0.3, ptTearAngle: 35, ptTearJitter: 0.5,
        ptShiftBelow: 0.5, ptOffsetX: 0.05, ptOffsetY: 0.02, ptTearGlow: 0.3, ptMode: 0,
      };
    case 'paintPeel':
      return {
        ppAmount: 0.3, ppScale: 4, ppLumaBias: 0.5,
        ppCurl: 0.5, ppShadow: 0.5,
        ppBgR: 0.15, ppBgG: 0.13, ppBgB: 0.1, ppMode: 0,
      };

    // ── Batch C: brand-new hero effects ──
    case 'audioShockBloom':
      return {
        asbIntensity: 1, asbBloomThreshold: 0.6, asbBloomRadius: 12,
        asbShockSpeed: 0.8, asbShockAmplitude: 0.05,
        asbChromaSplit: 0.4, asbStrobeAmount: 0.4,
        asbTintR: 1, asbTintG: 0.95, asbTintB: 0.85, asbAudioGate: 0.3,
      };
    case 'vhsFullDeck':
      return {
        vhsFdTracking: 0.5, vhsFdHeadSwitch: 0.4, vhsFdChromaBleed: 0.5,
        vhsFdDropouts: 0.3, vhsFdTapeNoise: 0.4, vhsFdScanlines: 0.4,
        vhsFdColorBleed: 0.3, vhsFdSaturation: 0.85, vhsFdTrackingJump: 0.1, vhsFdMode: 1,
      };
    case 'analogFeedbackRack':
      return {
        afrMix: 0.7, afrZoom: 1.02, afrRotation: 0.005, afrDecay: 0.04,
        afrHueShift: 0.01, afrMaskCenter: 0, afrChromaSplit: 0.2,
        afrOffsetX: 0, afrOffsetY: 0, afrMode: 0,
      };
    case 'clubLaserGrid':
      return {
        clgIntensity: 1, clgGridDensity: 12, clgPerspective: 0.7, clgSpeed: 1,
        clgIntersectionGlow: 0.7, clgLineWidth: 1.5,
        clgTintR: 0.2, clgTintG: 1, clgTintB: 0.5,
        clgAudioReact: 0.7, clgMode: 0,
      };
    case 'mirrorShards':
      return {
        msShards: 8, msShardSize: 0.2, msRotation: 60,
        msDelayAmount: 0.3, msChromatic: 0.3, msMode: 0,
      };
    case 'ghostExposure':
      return {
        geExposure: 0.3, geDecay: 0.04, geHueShiftPerFrame: 0.005,
        geIntensity: 1, geMode: 0, geClamp: 0.85,
      };
    case 'thermalContour':
      return {
        tcPalette: 0, tcContourCount: 8, tcContourWidth: 0.005,
        tcContourGlow: 0.5, tcIntensity: 1, tcTrackBlobs: 0.4, tcMix: 0.85,
      };
    case 'dreamDiffusion':
      return {
        ddBloomAmount: 1.2, ddBloomRadius: 14, ddHalation: 0.5,
        ddChromaticBlur: 0.4, ddPastelRolloff: 0.6, ddShadowLift: 0.15, ddSoftness: 0.4,
        ddTintR: 1.05, ddTintG: 1, ddTintB: 0.95,
      };
    case 'topoWarp':
      return {
        twContourCount: 12, twContourWidth: 0.008, twDisplacement: 0.5, twChromaticEdge: 0.3,
        twColorR: 0, twColorG: 0.85, twColorB: 1,
        twShadowRidges: 0.5, twMix: 0.85,
      };
    case 'strobeSequencer':
      return {
        ssBPM: 120, ssSteps: 16, ssPattern: 21845, ssMode: 0,
        ssIntensity: 1, ssTintR: 1, ssTintG: 1, ssTintB: 1, ssSwing: 0,
      };

    default:
      return {};
  }
}
