/**
 * Filling in an SVG layer's settings read from a project file.
 *
 * Files from older versions leave out fields that were added later. The
 * renderer draws a missing field with its own fallback (a missing effect is
 * off, a missing render mode is Original SVG), so the panel must fill each
 * gap with exactly that value: anything else would change how an existing
 * project looks the moment it is opened. A field the renderer does not read
 * takes the old default, which is what the panel always showed for it.
 */
import { createLegacySVGContent, type SVGContent } from '../types';

/** What the native renderer draws for a field that is not there, where that
 *  differs from the old defaults. Checked against the renderer in
 *  svgContentDefaults.test.ts. */
const MISSING_FIELD_VALUES: Partial<SVGContent> = {
  renderMode: 'source',
  fillMode: 'solid',
  colorMode: 'perShape',
  materialPreset: 'holographic',
  lightPreset: 'studio',

  colorCycleEnabled: false,
  liquidEnabled: false,
  particlesEnabled: false,
  energyEnabled: false,
  connectionsEnabled: false,
  glowEnabled: false,
  ripplesEnabled: false,
  lightningEnabled: false,
  edgeFlowEnabled: false,
  innerGlowEnabled: false,
  nebulaEnabled: false,
  heartbeatEnabled: false,
  plasmaEnabled: false,
  particleLinksEnabled: false,
  echoEnabled: false,
  arcBridgesEnabled: false,
  particleFillEnabled: false,
  organicWarpEnabled: false,
  growthEnabled: false,
  breatheEnabled: false,
  bevelEnabled: false,

  outlineThickness: 2,
  monochromeHue: 190,
  colorCycleSpeed: 0.15,
  colorCycleSaturation: 0.85,
  gradientAngle: 0,
  gradientSpread: 0.4,
  shimmerScale: 0.08,
  shimmerIntensity: 0.6,
  pulseSpeed: 2,
  noiseScale: 0.03,
  innerGlowIntensity: 0.4,
  extrudeDepth: 24,
  cameraFov: 45,
  materialMetalness: 0.4,
  materialRoughness: 0.2,
  iridescence: 0.8,
  floatAmount: 0,
  rotateSpeedY: 0,
  bloomStrength: 0,
  bloomThreshold: 0.25,
  chromatic: 0,
  vignette: 0,
  warpAmount: 0,
  warpSpeed: 1,
  fluidScale: 2,
  fluidSpeed: 1,
  fluidTurbulence: 0.8,
  echoLayers: 3,
  echoOpacity: 0.25,
};

/**
 * A stored SVG layer's settings with every field present. Stored values are
 * kept as they are; only missing ones are filled.
 */
export function normalizeStoredSVGContent(stored: unknown): SVGContent {
  const base = { ...createLegacySVGContent(), ...MISSING_FIELD_VALUES };
  if (!stored || typeof stored !== 'object') return base;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(stored as Record<string, unknown>)) {
    if (value === undefined) continue;
    if (value === null) {
      // JSON writes a NaN as null. The renderer reads a null number as 0 and
      // a null switch as off; a null choice falls back like a missing one.
      const fallback = base[key as keyof SVGContent];
      if (typeof fallback === 'number') out[key] = 0;
      else if (typeof fallback === 'boolean') out[key] = false;
      continue;
    }
    out[key] = value;
  }
  if (typeof out.svgSource !== 'string') out.svgSource = '';
  return out as unknown as SVGContent;
}
