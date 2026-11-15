/**
 * GhostFX defaults shared by the plugin registry (the panel and new
 * layers), the native uniform and the browser fallback, so a layer that
 * never set them looks the same in each.
 */
import type { IntegratedEffectSource } from '../../types';
import type { GhostFXParams } from './ghostfxVisualizer';

/** Background opacity: 0 = the scene floats over the layers beneath it. */
export const GHOSTFX_DEFAULT_BG_ALPHA = 0;

/** Every parameter the browser fallback takes, at the value a new layer
 *  gets from the registry (`defaultSourceParams`). */
export const GHOSTFX_DEFAULTS: Readonly<GhostFXParams> = Object.freeze({
  scenePreset: 'drift',
  voyageMotion: 0.6,
  voyageDetail: 6,
  voyageDepth: 1,
  voyagePalette: 0,
  sensitivity: 1.4,
  hueDriftSpeed: 0.15,
  exposure: 0.1,
  bloomIntensity: 1.4,
  bloomThreshold: 0.45,
  vignette: 0.7,
  bgAlpha: GHOSTFX_DEFAULT_BG_ALPHA,
  vortexStrength: 2.0,
  latticeThreshold: 2.5,
  trailIntensity: 1.0,
  feedbackAmount: 0.35,
  feedbackZoom: 1.003,
  ribbonWidth: 0.10,
  ribbonSpawn: 1.0,
  ribbonTranslucency: 0.35,
  ribbonBlend: 'additive',
  lightAzimuth: 35,
  lightElevation: 55,
  lightStrength: 0.9,
  ambient: 0.30,
  liquidSplatForce: 1.0,
  liquidSplatRadius: 0.08,
  liquidDyeDecay: 0.995,
  liquidVelDecay: 0.996,
  liquidBassRate: 1.0,
});

/** A layer's GhostFX settings as the browser fallback's params; anything the
 *  layer never set takes its default. */
export function ghostfxFallbackParams(source: IntegratedEffectSource): GhostFXParams {
  const d = GHOSTFX_DEFAULTS;
  return {
    scenePreset: source.ghostfxScenePreset ?? d.scenePreset,
    voyageMotion: source.ghostfxVoyageMotion ?? d.voyageMotion,
    voyageDetail: source.ghostfxVoyageDetail ?? d.voyageDetail,
    voyageDepth: source.ghostfxVoyageDepth ?? d.voyageDepth,
    voyagePalette: source.ghostfxVoyagePalette ?? d.voyagePalette,
    sensitivity: source.ghostfxSensitivity ?? d.sensitivity,
    hueDriftSpeed: source.ghostfxHueDriftSpeed ?? d.hueDriftSpeed,
    exposure: source.ghostfxExposure ?? d.exposure,
    bloomIntensity: source.ghostfxBloomIntensity ?? d.bloomIntensity,
    bloomThreshold: source.ghostfxBloomThreshold ?? d.bloomThreshold,
    vignette: source.ghostfxVignette ?? d.vignette,
    bgAlpha: source.ghostfxBgAlpha ?? d.bgAlpha,
    vortexStrength: source.ghostfxVortexStrength ?? d.vortexStrength,
    latticeThreshold: source.ghostfxLatticeThreshold ?? d.latticeThreshold,
    trailIntensity: source.ghostfxTrailIntensity ?? d.trailIntensity,
    feedbackAmount: source.ghostfxFeedbackAmount ?? d.feedbackAmount,
    feedbackZoom: source.ghostfxFeedbackZoom ?? d.feedbackZoom,
    ribbonWidth: source.ghostfxRibbonWidth ?? d.ribbonWidth,
    ribbonSpawn: source.ghostfxRibbonSpawn ?? d.ribbonSpawn,
    ribbonTranslucency: source.ghostfxRibbonTranslucency ?? d.ribbonTranslucency,
    ribbonBlend: source.ghostfxRibbonBlend ?? d.ribbonBlend,
    lightAzimuth: source.ghostfxLightAzimuth ?? d.lightAzimuth,
    lightElevation: source.ghostfxLightElevation ?? d.lightElevation,
    lightStrength: source.ghostfxLightStrength ?? d.lightStrength,
    ambient: source.ghostfxAmbient ?? d.ambient,
    liquidSplatForce: source.ghostfxLiquidSplatForce ?? d.liquidSplatForce,
    liquidSplatRadius: source.ghostfxLiquidSplatRadius ?? d.liquidSplatRadius,
    liquidDyeDecay: source.ghostfxLiquidDyeDecay ?? d.liquidDyeDecay,
    liquidVelDecay: source.ghostfxLiquidVelDecay ?? d.liquidVelDecay,
    liquidBassRate: source.ghostfxLiquidBassRate ?? d.liquidBassRate,
  };
}
