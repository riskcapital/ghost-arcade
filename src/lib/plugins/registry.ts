/**
 * Plugin Registry — Ghost Arcade Plugin System
 *
 * Plugins are self-contained visual generators that run natively inside the app.
 * Each plugin registers metadata, parameter definitions, and maps to an
 * IntegratedEffectType for rendering via the existing Canvas pipeline.
 *
 * To add a new plugin:
 *   1. Create a renderer class (like FluidSimulation or ParticleSystem)
 *   2. Register it here with registerPlugin()
 *   3. Wire the renderer into Canvas.svelte's updateIntegratedEffectTextures()
 *   4. Add the effectType to IntegratedEffectType in types.ts (if new)
 *
 * Plugins can be gated by license tier for monetization.
 */

import type { IntegratedEffectType } from '../types';

// ─── Plugin Param Definitions ───────────────────────────────────────────────

export interface PluginParamDef {
  name: string;              // Display label
  param: string;             // Key in the effectSource (e.g., 'fluidViscosity')
  type: 'slider' | 'select' | 'color' | 'toggle';
  min?: number;
  max?: number;
  step?: number;
  default: any;
  options?: { value: any; label: string }[];
}

// ─── Plugin Manifest ────────────────────────────────────────────────────────

export interface PluginManifest {
  id: string;                          // Unique ID: 'fluidgen', 'particles3d'
  name: string;                        // Display name: 'FluidGen'
  description: string;                 // Short description for the card
  category: string;                    // 'Generators', 'Image Processing', etc.
  version: string;                     // Semver
  author: string;                      // Creator
  tier: 'free' | 'starter' | 'pro';   // License tier required
  icon: string;                        // Emoji for quick display
  previewCSS: string;                  // CSS gradient for thumbnail
  effectType: IntegratedEffectType;    // Maps to rendering pipeline
  paramDefs: PluginParamDef[];         // UI parameter definitions (flat, no groups)
  defaultSourceParams: Record<string, any>;  // Default effectSource params
}

// ─── Registry ───────────────────────────────────────────────────────────────

const _plugins = new Map<string, PluginManifest>();

export function registerPlugin(manifest: PluginManifest): void {
  if (_plugins.has(manifest.id)) {
    console.warn(`[PluginRegistry] Overwriting plugin '${manifest.id}'`);
  }
  _plugins.set(manifest.id, manifest);
}

export function getPlugin(id: string): PluginManifest | undefined {
  return _plugins.get(id);
}

export function getAllPlugins(): PluginManifest[] {
  return [..._plugins.values()];
}

export function getPluginsByCategory(): Map<string, PluginManifest[]> {
  const byCategory = new Map<string, PluginManifest[]>();
  for (const plugin of _plugins.values()) {
    const list = byCategory.get(plugin.category) || [];
    list.push(plugin);
    byCategory.set(plugin.category, list);
  }
  return byCategory;
}

export function getPluginByEffectType(effectType: IntegratedEffectType): PluginManifest | undefined {
  for (const plugin of _plugins.values()) {
    if (plugin.effectType === effectType) return plugin;
  }
  return undefined;
}

// ─── Built-in Plugins ───────────────────────────────────────────────────────

registerPlugin({
  id: 'fluidgen',
  name: 'FluidGen',
  description: 'GPU fluid dynamics with audio reactivity',
  category: 'Generators',
  version: '1.0.0',
  author: 'Ghost Arcade',
  tier: 'pro',
  icon: '🌊',
  previewCSS: 'linear-gradient(135deg, #0c0c1d, #0ea5e9 40%, #06b6d4 60%, #0c0c1d)',
  effectType: 'fluid',
  paramDefs: [
    { name: 'Mode', param: 'fluidMode', type: 'select', default: 0,
      options: [
        { value: 0, label: 'Smoke' },
        { value: 1, label: 'Fire' },
        { value: 2, label: 'Ink' },
        { value: 3, label: 'Neon' },
        { value: 4, label: 'Thermal' },
      ]},
    { name: 'Camera Feed', param: 'cameraEnabled', type: 'toggle', default: false },
    { name: 'Camera Strength', param: 'fluidCameraStrength', type: 'slider', min: 0.5, max: 10, step: 0.5, default: 3.0 },
    { name: 'Viscosity', param: 'fluidViscosity', type: 'slider', min: 0.00001, max: 0.01, step: 0.00001, default: 0.0001 },
    { name: 'Vorticity', param: 'fluidVorticity', type: 'slider', min: 0, max: 50, step: 0.5, default: 30 },
    { name: 'Dissipation', param: 'fluidDissipation', type: 'slider', min: 0, max: 5, step: 0.05, default: 1.0 },
    { name: 'Vel. Dissipation', param: 'fluidVelDissipation', type: 'slider', min: 0, max: 5, step: 0.05, default: 0.5 },
    { name: 'Force Scale', param: 'fluidForceScale', type: 'slider', min: 50, max: 2000, step: 50, default: 500 },
    { name: 'Pressure Iters', param: 'fluidPressureIters', type: 'slider', min: 2, max: 40, step: 1, default: 12 },
    { name: 'Intensity', param: 'fluidIntensity', type: 'slider', min: 0.1, max: 3, step: 0.05, default: 1.0 },
    { name: 'Contrast', param: 'fluidContrast', type: 'slider', min: 0.5, max: 2, step: 0.05, default: 1.0 },
    { name: 'Saturation', param: 'fluidSaturation', type: 'slider', min: 0, max: 2, step: 0.05, default: 1.0 },
    { name: 'Hue Shift', param: 'fluidHueShift', type: 'slider', min: 0, max: 1, step: 0.01, default: 0 },
    { name: 'Glow', param: 'fluidGlow', type: 'slider', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'Fluid Color', param: 'fluidColor', type: 'color', default: [0.2, 0.5, 1.0] },
    { name: 'Background', param: 'fluidBgColor', type: 'color', default: [0.0, 0.0, 0.0] },
  ],
  defaultSourceParams: {
    cameraEnabled: false,
    fluidCameraStrength: 3.0,
    fluidMode: 0,
    fluidViscosity: 0.0001,
    fluidVorticity: 30,
    fluidDissipation: 1.0,
    fluidVelDissipation: 0.5,
    fluidForceScale: 500,
    fluidPressureIters: 12,
    fluidIntensity: 1.0,
    fluidContrast: 1.0,
    fluidSaturation: 1.0,
    fluidHueShift: 0,
    fluidGlow: 0.5,
    fluidColor: [0.2, 0.5, 1.0],
    fluidBgColor: [0.0, 0.0, 0.0],
  },
});

registerPlugin({
  id: 'particles3d',
  name: 'Particles3D',
  description: '3D particle system with PBR lighting and bloom',
  category: 'Generators',
  version: '1.0.0',
  author: 'Ghost Arcade',
  tier: 'pro',
  icon: '✨',
  previewCSS: 'linear-gradient(135deg, #0a0a2e, #6366f1 30%, #ec4899 60%, #0a0a2e)',
  effectType: 'particles',
  paramDefs: [
    { name: 'Mode', param: 'particleMode', type: 'select', default: 0,
      options: [
        { value: 0, label: 'Spheres' },
        { value: 1, label: 'Tendrils' },
        { value: 2, label: 'Voxels' },
        { value: 3, label: 'Point Cloud' },
      ]},
    { name: 'Material', param: 'particleMaterial', type: 'select', default: 0,
      options: [
        { value: 0, label: 'Chrome' },
        { value: 1, label: 'Glass' },
        { value: 2, label: 'Neon' },
        { value: 3, label: 'Wire' },
        { value: 4, label: 'Soft' },
      ]},
    { name: 'Count', param: 'particleCount', type: 'slider', min: 100, max: 10000, step: 100, default: 3000 },
    { name: 'Size', param: 'particleSize', type: 'slider', min: 0.1, max: 3.0, step: 0.05, default: 0.8 },
    { name: 'Speed', param: 'particleSpeed', type: 'slider', min: 0, max: 10, step: 0.1, default: 2.0 },
    { name: 'Gravity', param: 'particleGravity', type: 'slider', min: -5, max: 5, step: 0.1, default: -0.5 },
    { name: 'Turbulence', param: 'particleTurbulence', type: 'slider', min: 0, max: 10, step: 0.1, default: 2.0 },
    { name: 'Vortex', param: 'particleVortex', type: 'slider', min: 0, max: 10, step: 0.1, default: 1.0 },
    { name: 'Drag', param: 'particleDrag', type: 'slider', min: 0.9, max: 1.0, step: 0.005, default: 0.98 },
    { name: 'Mouse Force', param: 'particleMouseForce', type: 'slider', min: 0, max: 200, step: 1, default: 50 },
    { name: 'Mouse Radius', param: 'particleMouseRadius', type: 'slider', min: 1, max: 50, step: 0.5, default: 15 },
    { name: 'Emission', param: 'particleEmission', type: 'slider', min: 0, max: 10, step: 0.1, default: 2.0 },
    { name: 'Bloom', param: 'particleBloom', type: 'slider', min: 0, max: 2, step: 0.05, default: 0.6 },
    { name: 'Bloom Threshold', param: 'particleBloomThreshold', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.35 },
    { name: 'Color A', param: 'particleColorA', type: 'color', default: [0.2, 0.5, 1.0] },
    { name: 'Color B', param: 'particleColorB', type: 'color', default: [1.0, 0.3, 0.8] },
    { name: 'Color C', param: 'particleColorC', type: 'color', default: [0.3, 1.0, 0.5] },
    { name: 'Color Mode', param: 'particleColorMode', type: 'select', default: 0,
      options: [
        { value: 0, label: 'Tri-color' },
        { value: 1, label: 'Rainbow' },
        { value: 2, label: 'Monochrome' },
        { value: 3, label: 'Temperature' },
        { value: 4, label: 'Pulse' },
      ]},
    { name: 'Connectors', param: 'particleConnectors', type: 'toggle', default: false },
    { name: 'Connector Distance', param: 'particleConnectorDist', type: 'slider', min: 1, max: 20, step: 0.5, default: 5 },
    { name: 'Connector Opacity', param: 'particleConnectorOpacity', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.4 },
    { name: 'Spotlights', param: 'particleLightCount', type: 'slider', min: 0, max: 3, step: 1, default: 3 },
    { name: 'Spot Intensity', param: 'particleLightIntensity', type: 'slider', min: 0, max: 20, step: 0.5, default: 4.0 },
    { name: 'Spot Orbit Speed', param: 'particleLightOrbitSpeed', type: 'slider', min: 0, max: 3, step: 0.05, default: 0.5 },
    { name: 'Spot Cone Width', param: 'particleLightConeAngle', type: 'slider', min: 0.1, max: 1.2, step: 0.05, default: 0.6 },
    { name: 'Spot Color A', param: 'particleLightColorA', type: 'color', default: [0.3, 0.5, 1.0] },
    { name: 'Spot Color B', param: 'particleLightColorB', type: 'color', default: [1.0, 0.3, 0.6] },
    { name: 'Ambient', param: 'particleAmbient', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.35 },
    { name: 'Auto Rotate', param: 'particleAutoRotate', type: 'toggle', default: true },
    { name: 'Rotation Speed', param: 'particleRotationSpeed', type: 'slider', min: 0, max: 2, step: 0.01, default: 0.15 },
  ],
  defaultSourceParams: {
    particleMode: 0,
    particleCount: 3000,
    particleSize: 0.8,
    particleSpeed: 2.0,
    particleGravity: -0.5,
    particleTurbulence: 2.0,
    particleVortex: 1.0,
    particleDrag: 0.98,
    particleMouseForce: 50,
    particleMouseRadius: 15,
    particleEmission: 2.0,
    particleBloom: 0.6,
    particleBloomThreshold: 0.35,
    particleMaterial: 0,
    particleColorA: [0.2, 0.5, 1.0],
    particleColorB: [1.0, 0.3, 0.8],
    particleColorC: [0.3, 1.0, 0.5],
    particleColorMode: 0,
    particleTextureUrl: '',
    particleConnectors: false,
    particleConnectorDist: 5,
    particleConnectorOpacity: 0.4,
    particleLightCount: 3,
    particleLightIntensity: 4.0,
    particleLightOrbitSpeed: 0.5,
    particleLightConeAngle: 0.6,
    particleLightColorA: [0.3, 0.5, 1.0],
    particleLightColorB: [1.0, 0.3, 0.6],
    particleAmbient: 0.35,
    particleAutoRotate: true,
    particleRotationSpeed: 0.15,
  },
});
