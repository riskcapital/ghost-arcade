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
  options?: { value: any; label: string; disabled?: boolean; unavailableReason?: string }[];
  /** Optional conditional visibility. When set, the param only shows in
   *  the panel if the current value of `showWhen.param` is in
   *  `showWhen.values`. Used by GhostFX to show scene-specific knobs
   *  (e.g. Vortex Strength only for Drift; Light Direction only for
   *  Ribbons). Generic — any plugin can use it. */
  showWhen?: { param: string; values: any[] };
}

// ─── Plugin Manifest ────────────────────────────────────────────────────────

/** Optional attribution for plugins that wrap third-party engines.
 *  Surfaced as a "powered by …" badge at the top of the plugin's control
 *  panel. Originals (FluidGen, Particles3D) leave this undefined — they
 *  use only the `author` field. The rule: if any meaningful rendering
 *  work is done by external code, it MUST be credited here. */
export interface PluginCredit {
  engine: string;        // e.g. "Butterchurn"
  authors?: string;      // e.g. "Jordan Berg · Milkdrop by Ryan Geiss"
  url?: string;          // upstream project page
  license?: string;      // e.g. "MIT", "AGPL-3.0"
}

export interface PluginManifest {
  id: string;                          // Unique ID: 'fluidgen', 'particles3d'
  name: string;                        // Display name: 'FluidGen'
  description: string;                 // Short description for the card
  category: string;                    // 'Generators', 'Image Processing', etc.
  version: string;                     // Semver
  author: string;                      // Creator / maintainer of the plugin integration
  tier: 'free' | 'starter' | 'pro';   // License tier required
  icon: string;                        // Emoji for quick display
  previewCSS: string;                  // CSS gradient for thumbnail
  effectType: IntegratedEffectType;    // Maps to rendering pipeline
  paramDefs: PluginParamDef[];         // UI parameter definitions (flat, no groups)
  defaultSourceParams: Record<string, any>;  // Default effectSource params
  poweredBy?: PluginCredit;            // Third-party engine credit (omit for originals)
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
  id: 'milkdrop',
  name: 'Milkdrop',
  description: 'Auto-evolving Milkdrop 2 visualizer with beat-sync, preset browser, and stem routing',
  category: 'Generators',
  version: '1.0.0',
  // Ghost Arcade only built the layer integration + panel UI + preset
  // cycling around butterchurn. All rendering and equation evaluation
  // is butterchurn's; the visual aesthetic is Ryan Geiss's Milkdrop.
  author: 'Ghost Arcade (integration)',
  poweredBy: {
    engine: 'Butterchurn',
    authors: 'Jordan Berg · Milkdrop engine by Ryan Geiss',
    url: 'https://github.com/jberg/butterchurn',
    license: 'MIT',
  },
  tier: 'free',
  icon: '🌀',
  previewCSS: 'linear-gradient(135deg, #06001a, #7c3aed 25%, #f43f5e 55%, #fb923c 80%, #06001a)',
  effectType: 'milkdrop',
  paramDefs: [
    // Stem source + routing matrix live in a custom panel block in
    // PluginLayerPanel — keeping them out of paramDefs because the generic
    // slider/select renderer can't express a matrix. Everything else is
    // plain params so the standard panel still renders them.
    { name: 'Preset Pack', param: 'milkdropPresetPack', type: 'select', default: 'full',
      options: [
        { value: 'minimal', label: 'Minimal' },
        { value: 'full', label: 'Full' },
        { value: 'extra', label: 'Extra' },
        { value: 'extra2', label: 'Extra 2' },
        { value: 'md1', label: 'MD1 (classic)' },
      ]},
    { name: 'Auto Evolve', param: 'milkdropAutoEvolve', type: 'toggle', default: true },
    { name: 'Evolve Mode', param: 'milkdropEvolveMode', type: 'select', default: 1,
      options: [
        { value: 0, label: 'Timer' },
        { value: 1, label: 'Beat-sync' },
      ]},
    { name: 'Evolve Interval (s)', param: 'milkdropEvolveInterval', type: 'slider', min: 5, max: 120, step: 1, default: 22 },
    { name: 'Evolve Bars', param: 'milkdropEvolveBars', type: 'slider', min: 1, max: 32, step: 1, default: 8 },
    { name: 'Preset Blend (s)', param: 'milkdropBlendTime', type: 'slider', min: 0, max: 10, step: 0.1, default: 2.7 },
    { name: 'Audio Sensitivity', param: 'milkdropSensitivity', type: 'slider', min: 0.5, max: 4, step: 0.05, default: 1.5 },
    { name: 'Bass Trim', param: 'milkdropBassGain', type: 'slider', min: 0, max: 3, step: 0.05, default: 1.0 },
    { name: 'Mid Trim', param: 'milkdropMidGain', type: 'slider', min: 0, max: 3, step: 0.05, default: 1.0 },
    { name: 'Treble Trim', param: 'milkdropTrebGain', type: 'slider', min: 0, max: 3, step: 0.05, default: 1.0 },
    { name: 'Hard Cut on Beat', param: 'milkdropHardCutEnabled', type: 'toggle', default: false },
    { name: 'Hard Cut Sensitivity', param: 'milkdropHardCutThreshold', type: 'slider', min: 0.3, max: 1.5, step: 0.05, default: 0.8 },
    { name: 'Warp Mesh', param: 'milkdropMeshSize', type: 'slider', min: 32, max: 96, step: 4, default: 48 },
    { name: 'Render Scale', param: 'milkdropPixelRatio', type: 'slider', min: 0.5, max: 2, step: 0.1, default: 1.0 },
  ],
  defaultSourceParams: {
    milkdropPresetPack: 'full',
    milkdropPresetName: '',
    milkdropBlendTime: 2.7,
    milkdropAutoEvolve: true,
    milkdropEvolveMode: 1,
    milkdropEvolveInterval: 22,
    milkdropEvolveBars: 8,
    milkdropSensitivity: 1.5,
    milkdropBassGain: 1.0,
    milkdropMidGain: 1.0,
    milkdropTrebGain: 1.0,
    milkdropHardCutEnabled: false,
    milkdropHardCutThreshold: 0.8,
    milkdropMeshSize: 48,
    milkdropPixelRatio: 1.0,
    milkdropStemSourceId: '',
    milkdropRoutingMatrix: {
      full:   { bass: 1, mid: 1, treb: 1 },
      drums:  { bass: 1, mid: 0, treb: 0.6 },
      bass:   { bass: 1, mid: 0, treb: 0 },
      vocals: { bass: 0, mid: 1, treb: 0.3 },
      other:  { bass: 0, mid: 0.5, treb: 1 },
    },
  },
});

registerPlugin({
  id: 'wavejs',
  name: 'Wave.js',
  description: '10 canvas animations — Wave, Arcs, Circles, Cubes, Flower, Glob, Lines, Shine, Square, Turntable',
  category: 'Generators',
  version: '1.0.0',
  // Wrapper around @foobar404/wave; all visualization work is the
  // upstream library's.
  author: 'Ghost Arcade (integration)',
  poweredBy: {
    engine: '@foobar404/wave',
    authors: 'Curtis Hutten · Austin Michaud',
    url: 'https://github.com/foobar404/Wave',
    license: 'MIT',
  },
  tier: 'free',
  icon: '🌐',
  previewCSS: 'linear-gradient(135deg, #050508, #FF6B6B 45%, #FF8585 80%, #050508)',
  effectType: 'wavejs',
  paramDefs: [
    { name: 'Animation', param: 'wavejsAnimation', type: 'select', default: 'Wave',
      options: [
        { value: 'Wave',      label: 'Wave' },
        { value: 'Arcs',      label: 'Arcs' },
        { value: 'Circles',   label: 'Circles' },
        { value: 'Cubes',     label: 'Cubes' },
        { value: 'Flower',    label: 'Flower' },
        { value: 'Glob',      label: 'Glob' },
        { value: 'Lines',     label: 'Lines' },
        { value: 'Shine',     label: 'Shine' },
        { value: 'Square',    label: 'Square' },
        { value: 'Turntable', label: 'Turntable' },
      ]},
    { name: 'Flip Vertical', param: 'wavejsFlipY', type: 'toggle', default: false },
    { name: 'Sensitivity', param: 'wavejsSensitivity', type: 'slider', min: 0.25, max: 6, step: 0.05, default: 1.5 },
    { name: 'Line Width', param: 'wavejsLineWidth', type: 'slider', min: 1, max: 30, step: 0.5, default: 4 },
    { name: 'Gradient', param: 'wavejsUseGradient', type: 'toggle', default: true },
    { name: 'Gradient Angle', param: 'wavejsGradientRotate', type: 'slider', min: 0, max: 360, step: 1, default: 0 },
    { name: 'Color A', param: 'wavejsColorA', type: 'color', default: [1.0, 0.42, 0.42] },
    { name: 'Color B', param: 'wavejsColorB', type: 'color', default: [1.0, 0.55, 0.30] },
    { name: 'Glow Strength', param: 'wavejsGlowStrength', type: 'slider', min: 0, max: 50, step: 0.5, default: 15 },
    { name: 'Glow Color', param: 'wavejsGlowColor', type: 'color', default: [1.0, 0.42, 0.42] },
    { name: 'Background Opacity', param: 'wavejsBgAlpha', type: 'slider', min: 0, max: 1, step: 0.01, default: 1.0 },
  ],
  defaultSourceParams: {
    wavejsAnimation: 'Wave',
    wavejsFlipY: false,
    wavejsSensitivity: 1.5,
    wavejsLineWidth: 4,
    wavejsUseGradient: true,
    wavejsGradientRotate: 0,
    wavejsColorA: [1.0, 0.42, 0.42],
    wavejsColorB: [1.0, 0.55, 0.30],
    wavejsGlowStrength: 15,
    wavejsGlowColor: [1.0, 0.42, 0.42],
    wavejsBgAlpha: 1.0,
  },
});

registerPlugin({
  id: 'ghostfx',
  name: 'GhostFX',
  description: 'WebGPU raymarched audio-reactive visualizer — original Ghost Arcade engine',
  category: 'Generators',
  version: '0.1.0',
  // Honestly ours — original WebGPU pipeline + original WGSL scenes.
  // No poweredBy: there's no third-party engine to credit.
  author: 'Ghost Arcade',
  tier: 'free',
  icon: '◈',
  previewCSS: 'linear-gradient(135deg, #050010, #FF6B6B 35%, #ff80c0 60%, #5a2acc 85%, #050010)',
  effectType: 'ghostfx',
  paramDefs: [
    { name: 'Scene', param: 'ghostfxScenePreset', type: 'select', default: 'drift',
      options: [
        { value: 'drift',   label: 'Drift — Particle Vortex' },
        { value: 'ribbons', label: 'Ribbons — Aurora Trails' },
        { value: 'liquid',  label: 'Liquid — Fluid Simulation' },
        { value: 'spheres', label: 'Spheres — Orb Flow' },
        // Next: SDF Tunnel (raymarched fractal), Nebula (volumetric
        // smoke) — each built as its own pipeline, registered here.
      ]},
    // ── Global (all scenes) ──
    { name: 'Sensitivity', param: 'ghostfxSensitivity', type: 'slider', min: 0.25, max: 4, step: 0.05, default: 1.4 },
    { name: 'Hue Drift', param: 'ghostfxHueDriftSpeed', type: 'slider', min: 0, max: 2, step: 0.05, default: 0.15 },
    { name: 'Reactivity', param: 'ghostfxReactivity', type: 'slider', min: 0, max: 1, step: 0.02, default: 0.4 },

    // ── Drift-only ──
    { name: 'Vortex Strength', param: 'ghostfxVortexStrength', type: 'slider', min: 0, max: 6, step: 0.05, default: 2.0,
      showWhen: { param: 'ghostfxScenePreset', values: ['drift'] } },
    { name: 'Trail Intensity', param: 'ghostfxTrailIntensity', type: 'slider', min: 0, max: 2, step: 0.05, default: 1.0,
      showWhen: { param: 'ghostfxScenePreset', values: ['drift'] } },
    { name: 'Lattice Range', param: 'ghostfxLatticeThreshold', type: 'slider', min: 0, max: 6, step: 0.05, default: 2.5,
      showWhen: { param: 'ghostfxScenePreset', values: ['drift'] } },

    // ── Ribbons-only ──
    { name: 'Ribbon Width', param: 'ghostfxRibbonWidth', type: 'slider', min: 0.02, max: 0.30, step: 0.005, default: 0.10,
      showWhen: { param: 'ghostfxScenePreset', values: ['ribbons'] } },
    { name: 'Spawn Density', param: 'ghostfxRibbonSpawn', type: 'slider', min: 0.2, max: 3.0, step: 0.05, default: 1.0,
      showWhen: { param: 'ghostfxScenePreset', values: ['ribbons'] } },
    { name: 'Translucency', param: 'ghostfxRibbonTranslucency', type: 'slider', min: 0, max: 1, step: 0.02, default: 0.35,
      showWhen: { param: 'ghostfxScenePreset', values: ['ribbons'] } },
    { name: 'Blend Mode', param: 'ghostfxRibbonBlend', type: 'select', default: 'additive',
      options: [
        { value: 'additive', label: 'Additive' },
        { value: 'lighten',  label: 'Lighten' },
        { value: 'glass',    label: 'Glass (alpha)' },
      ],
      showWhen: { param: 'ghostfxScenePreset', values: ['ribbons'] } },
    { name: 'Light Azimuth', param: 'ghostfxLightAzimuth', type: 'slider', min: 0, max: 360, step: 1, default: 35,
      showWhen: { param: 'ghostfxScenePreset', values: ['ribbons', 'liquid'] } },
    { name: 'Light Elevation', param: 'ghostfxLightElevation', type: 'slider', min: -90, max: 90, step: 1, default: 55,
      showWhen: { param: 'ghostfxScenePreset', values: ['ribbons', 'liquid'] } },
    { name: 'Light Strength', param: 'ghostfxLightStrength', type: 'slider', min: 0, max: 2, step: 0.05, default: 0.9,
      showWhen: { param: 'ghostfxScenePreset', values: ['ribbons', 'liquid'] } },
    { name: 'Ambient', param: 'ghostfxAmbient', type: 'slider', min: 0, max: 1, step: 0.02, default: 0.30,
      showWhen: { param: 'ghostfxScenePreset', values: ['ribbons', 'liquid', 'spheres'] } },
    { name: 'Color Amount', param: 'ghostfxRibbonColorAmount', type: 'slider', min: 0, max: 1, step: 0.02, default: 0.25,
      showWhen: { param: 'ghostfxScenePreset', values: ['ribbons'] } },
    { name: 'Depth Blur', param: 'ghostfxRibbonDof', type: 'slider', min: 0, max: 1, step: 0.02, default: 0.55,
      showWhen: { param: 'ghostfxScenePreset', values: ['ribbons'] } },

    // ── Spheres-only ──
    { name: 'Flow Speed', param: 'ghostfxSpheresFlow', type: 'slider', min: 0.2, max: 3, step: 0.05, default: 1.0,
      showWhen: { param: 'ghostfxScenePreset', values: ['spheres'] } },
    { name: 'Sphere Size', param: 'ghostfxSpheresSize', type: 'slider', min: 0.4, max: 2.2, step: 0.05, default: 1.0,
      showWhen: { param: 'ghostfxScenePreset', values: ['spheres'] } },
    { name: 'Fluid Mass', param: 'ghostfxSpheresPuffs', type: 'slider', min: 0, max: 2, step: 0.05, default: 1.0,
      showWhen: { param: 'ghostfxScenePreset', values: ['spheres'] } },
    { name: 'Palette', param: 'ghostfxSpheresPalette', type: 'select', default: 0,
      options: [
        { value: 0, label: 'Pastel (milk + aqua)' },
        { value: 1, label: 'Candy' },
        { value: 2, label: 'Ember' },
      ],
      showWhen: { param: 'ghostfxScenePreset', values: ['spheres'] } },

    // ── Liquid-only ──
    { name: 'Splat Force', param: 'ghostfxLiquidSplatForce', type: 'slider', min: 0.2, max: 3.0, step: 0.05, default: 1.0,
      showWhen: { param: 'ghostfxScenePreset', values: ['liquid'] } },
    { name: 'Splat Size', param: 'ghostfxLiquidSplatRadius', type: 'slider', min: 0.01, max: 0.20, step: 0.005, default: 0.08,
      showWhen: { param: 'ghostfxScenePreset', values: ['liquid'] } },
    { name: 'Dye Fade', param: 'ghostfxLiquidDyeDecay', type: 'slider', min: 0.985, max: 1.0, step: 0.001, default: 0.995,
      showWhen: { param: 'ghostfxScenePreset', values: ['liquid'] } },
    { name: 'Fluid Damping', param: 'ghostfxLiquidVelDecay', type: 'slider', min: 0.95, max: 1.0, step: 0.002, default: 0.992,
      showWhen: { param: 'ghostfxScenePreset', values: ['liquid'] } },
    { name: 'Bass Drop Rate', param: 'ghostfxLiquidBassRate', type: 'slider', min: 0, max: 2, step: 0.05, default: 1.0,
      showWhen: { param: 'ghostfxScenePreset', values: ['liquid'] } },
    { name: 'Swirl', param: 'ghostfxLiquidVorticity', type: 'slider', min: 0, max: 3, step: 0.05, default: 1.3,
      showWhen: { param: 'ghostfxScenePreset', values: ['liquid'] } },
    { name: 'Gloss', param: 'ghostfxLiquidGloss', type: 'slider', min: 0, max: 1, step: 0.02, default: 0.7,
      showWhen: { param: 'ghostfxScenePreset', values: ['liquid'] } },
    { name: 'Depth', param: 'ghostfxLiquidDepth', type: 'slider', min: 0.05, max: 1, step: 0.01, default: 0.35,
      showWhen: { param: 'ghostfxScenePreset', values: ['liquid'] } },
    { name: 'Bubbles', param: 'ghostfxLiquidBubbles', type: 'slider', min: 0, max: 2, step: 0.05, default: 1.0,
      showWhen: { param: 'ghostfxScenePreset', values: ['liquid'] } },

    // ── Global post-stack (all scenes) ──
    { name: 'Bloom Intensity', param: 'ghostfxBloomIntensity', type: 'slider', min: 0, max: 3, step: 0.05, default: 1.4 },
    { name: 'Bloom Threshold', param: 'ghostfxBloomThreshold', type: 'slider', min: 0, max: 2, step: 0.02, default: 0.45 },
    { name: 'Vignette', param: 'ghostfxVignette', type: 'slider', min: 0, max: 1, step: 0.02, default: 0.7 },
    { name: 'Exposure', param: 'ghostfxExposure', type: 'slider', min: -1, max: 1, step: 0.02, default: 0.1 },
    { name: 'Background Opacity', param: 'ghostfxBgAlpha', type: 'slider', min: 0, max: 1, step: 0.01, default: 0.0 },
  ],
  defaultSourceParams: {
    ghostfxScenePreset: 'drift',
    ghostfxSensitivity: 1.4,
    ghostfxHueDriftSpeed: 0.15,
    ghostfxReactivity: 0.4,
    // Drift
    ghostfxVortexStrength: 2.0,
    ghostfxTrailIntensity: 1.0,
    ghostfxLatticeThreshold: 2.5,
    // Ribbons
    ghostfxRibbonWidth: 0.10,
    ghostfxRibbonSpawn: 1.0,
    ghostfxRibbonTranslucency: 0.35,
    ghostfxRibbonBlend: 'additive',
    ghostfxRibbonColorAmount: 0.25,
    ghostfxRibbonDof: 0.55,
    ghostfxSpheresFlow: 1.0,
    ghostfxSpheresSize: 1.0,
    ghostfxSpheresPuffs: 1.0,
    ghostfxSpheresPalette: 0,
    ghostfxLightAzimuth: 35,
    ghostfxLightElevation: 55,
    ghostfxLightStrength: 0.9,
    ghostfxAmbient: 0.30,
    // Liquid
    ghostfxLiquidSplatForce: 1.0,
    ghostfxLiquidSplatRadius: 0.08,
    ghostfxLiquidDyeDecay: 0.995,
    ghostfxLiquidVelDecay: 0.996,
    ghostfxLiquidBassRate: 1.0,
    ghostfxLiquidVorticity: 1.3,
    ghostfxLiquidGloss: 0.7,
    ghostfxLiquidDepth: 0.35,
    ghostfxLiquidBubbles: 1.0,
    // Post
    ghostfxBloomIntensity: 1.4,
    ghostfxBloomThreshold: 0.45,
    ghostfxVignette: 0.7,
    ghostfxExposure: 0.1,
    ghostfxBgAlpha: 0.0,
    ghostfxFeedbackAmount: 0.35,
    ghostfxFeedbackZoom: 1.003,
  },
});

registerPlugin({
  id: 'ghostpilot',
  name: 'Ghost Pilot',
  description: 'Playable audio-built world — fly a neon canyon with a gamepad. Bass builds the terrain; beat-quantized verbs (pulse / flip / bloom / dive) land on the drop; let go and autopilot takes the wheel.',
  category: 'Generators',
  version: '0.1.0',
  author: 'Ghost Arcade',
  tier: 'free',
  icon: '🎮',
  previewCSS: 'linear-gradient(160deg, #03030a 0%, #0a1a3a 35%, #FF2bd0 70%, #18f0ff 100%)',
  effectType: 'ghostpilot',
  paramDefs: [
    { name: 'Audio Drive', param: 'ghostpilotSensitivity', type: 'slider', min: 0.25, max: 4, step: 0.05, default: 1.4 },
    { name: 'Speed', param: 'ghostpilotSpeedScale', type: 'slider', min: 0.5, max: 2.5, step: 0.05, default: 1.0 },
    { name: 'Palette', param: 'ghostpilotHueBase', type: 'slider', min: 0, max: 1, step: 0.01, default: 0.0 },
    { name: 'Steer Assist', param: 'ghostpilotSteerAssist', type: 'slider', min: 0, max: 1, step: 0.05, default: 1.0 },
    { name: 'Idle Autopilot', param: 'ghostpilotAutopilot', type: 'toggle', default: true },
  ],
  defaultSourceParams: {
    ghostpilotSensitivity: 1.4,
    ghostpilotSpeedScale: 1.0,
    ghostpilotHueBase: 0.0,
    ghostpilotSteerAssist: 1.0,
    ghostpilotAutopilot: true,
  },
});

registerPlugin({
  id: 'hydra',
  name: 'Hydra',
  description: 'Live-codeable video synth — warping, feedback, audio-reactive sketches',
  category: 'Generators',
  version: '1.0.0',
  // Wrapper around hydra-synth; Ghost Arcade adds the layer integration,
  // panel UI, and the curated starter sketch library. All rendering and
  // the sketch DSL is hydra's.
  author: 'Ghost Arcade (integration)',
  poweredBy: {
    engine: 'hydra-synth',
    authors: 'Olivia Jack',
    url: 'https://github.com/ojack/hydra',
    license: 'AGPL-3.0',
  },
  tier: 'free',
  icon: '🌊',
  previewCSS: 'linear-gradient(135deg, #050508, #FF6B6B 35%, #FF8585 70%, #050508)',
  effectType: 'hydra',
  paramDefs: [
    // Sketch picker + transport live in the custom HydraPanel (preset
    // browser, next/prev/random, favorites). Only the global knobs that
    // make sense as flat sliders live here.
    { name: 'Sensitivity', param: 'hydraSensitivity', type: 'slider', min: 0.25, max: 6, step: 0.05, default: 1.5 },
    { name: 'Background Opacity', param: 'hydraBgAlpha', type: 'slider', min: 0, max: 1, step: 0.01, default: 1.0 },
  ],
  defaultSourceParams: {
    hydraSketchName: 'Welcome',
    hydraSketchCode: 'osc(20, 0.1, 1.4).rotate(0.1).out()',
    hydraSensitivity: 1.5,
    hydraBgAlpha: 1.0,
  },
});

registerPlugin({
  id: 'audiomotion',
  name: 'AudioMotion',
  description: 'High-resolution spectrum analyzer — octave bands, radial, LED meters, line / area modes',
  category: 'Generators',
  version: '1.0.0',
  // Wrapper around audiomotion-analyzer; all rendering work is the
  // upstream library's. Ghost Arcade only adds the layer integration.
  author: 'Ghost Arcade (integration)',
  poweredBy: {
    engine: 'audioMotion-analyzer',
    authors: 'Henrique Vianna',
    url: 'https://github.com/hvianna/audioMotion-analyzer',
    license: 'AGPL-3.0',
  },
  tier: 'free',
  icon: '📊',
  previewCSS: 'linear-gradient(135deg, #050508, #FF6B6B 40%, #FF8585 75%, #050508)',
  effectType: 'audiomotion',
  paramDefs: [
    { name: 'Mode', param: 'audiomotionMode', type: 'select', default: 4,
      options: [
        { value: 0, label: 'Discrete' },
        { value: 1, label: '1/24 Oct' },
        { value: 2, label: '1/12 Oct' },
        { value: 3, label: '1/8 Oct' },
        { value: 4, label: '1/6 Oct' },
        { value: 5, label: '1/4 Oct' },
        { value: 6, label: '1/3 Oct' },
        { value: 7, label: '1/2 Oct' },
        { value: 8, label: 'Full Oct' },
        { value: 10, label: 'Line' },
        { value: 11, label: 'Area' },
      ]},
    { name: 'Gradient', param: 'audiomotionGradient', type: 'select', default: 'orangered',
      options: [
        { value: 'classic',   label: 'Classic' },
        { value: 'prism',     label: 'Prism' },
        { value: 'rainbow',   label: 'Rainbow' },
        { value: 'orangered', label: 'Orange-Red' },
        { value: 'steelblue', label: 'Steel Blue' },
      ]},
    { name: 'Radial', param: 'audiomotionRadial', type: 'toggle', default: false },
    { name: 'Flip Vertical', param: 'audiomotionFlipY', type: 'toggle', default: false },
    { name: 'Bar Style', param: 'audiomotionBarStyle', type: 'select', default: 'normal',
      options: [
        { value: 'normal',  label: 'Normal' },
        { value: 'led',     label: 'LED' },
        { value: 'lumi',    label: 'Lumi' },
        { value: 'alpha',   label: 'Alpha' },
        { value: 'outline', label: 'Outline' },
      ]},
    { name: 'Show Peaks (bars)', param: 'audiomotionShowPeaks', type: 'toggle', default: true },
    { name: 'Peak Line (line/area)', param: 'audiomotionPeakLine', type: 'toggle', default: false },
    { name: 'Mirror', param: 'audiomotionMirror', type: 'select', default: 0,
      options: [
        { value: -1, label: 'Left' },
        { value: 0,  label: 'Off' },
        { value: 1,  label: 'Right' },
      ]},
    { name: 'Reflex', param: 'audiomotionReflexRatio', type: 'slider', min: 0, max: 0.9, step: 0.05, default: 0 },
    { name: 'Bar Spacing', param: 'audiomotionBarSpace', type: 'slider', min: 0, max: 1, step: 0.02, default: 0.1 },
    { name: 'Min Freq (Hz)', param: 'audiomotionMinFreq', type: 'slider', min: 20, max: 500, step: 5, default: 30 },
    { name: 'Max Freq (Hz)', param: 'audiomotionMaxFreq', type: 'slider', min: 2000, max: 22000, step: 100, default: 16000 },
    { name: 'Sensitivity', param: 'audiomotionSensitivity', type: 'select', default: 1,
      options: [
        { value: 0, label: 'Low' },
        { value: 1, label: 'Normal' },
        { value: 2, label: 'High' },
      ]},
    { name: 'Smoothing', param: 'audiomotionSmoothing', type: 'slider', min: 0, max: 0.99, step: 0.01, default: 0.5 },
    { name: 'Background Opacity', param: 'audiomotionBgAlpha', type: 'slider', min: 0, max: 1, step: 0.01, default: 1.0 },
  ],
  defaultSourceParams: {
    audiomotionMode: 4,
    audiomotionGradient: 'orangered',
    audiomotionRadial: false,
    audiomotionBarStyle: 'normal',
    audiomotionPeakLine: false,
    audiomotionShowPeaks: true,
    audiomotionMirror: 0,
    audiomotionFlipY: false,
    audiomotionReflexRatio: 0,
    audiomotionBarSpace: 0.1,
    audiomotionMinFreq: 30,
    audiomotionMaxFreq: 16000,
    audiomotionSensitivity: 1,
    audiomotionSmoothing: 0.5,
    audiomotionBgAlpha: 1.0,
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

// ─── HandFX (MediaPipe POC) ────────────────────────────────────────────
// Original hand-gesture visualizer driven by the shared MediaPipe worker.
// 5 modes; the headline "Panel" mode pairs with the layer's Difference
// blend mode to invert colors of layers beneath the rectangle between
// the user's palms.
registerPlugin({
  id: 'handfx',
  name: 'HandFX',
  description: 'Conduct visuals with your hands — paint, ink, pinch spray, neon skeleton, blend-mode panel',
  category: 'Generators',
  version: '0.2.0',
  author: 'Ghost Arcade (original) · MediaPipe by Google (Apache-2.0)',
  tier: 'free',
  icon: '✋',
  previewCSS: 'radial-gradient(circle at 30% 50%, #FF6B6B 0%, transparent 30%), radial-gradient(circle at 70% 50%, #ff80c0 0%, transparent 30%), #0a0a10',
  effectType: 'handfx',
  paramDefs: [
    { name: 'Mode', param: 'handfxMode', type: 'select', default: 'trails',
      options: [
        { value: 'trails',   label: 'Paint (velocity brushstrokes + sparks)' },
        { value: 'aurora',   label: 'Ink (drifting smoke blobs)' },
        { value: 'bursts',   label: 'Pinch Spray (continuous from pinch)' },
        { value: 'skeleton', label: 'Neon Skeleton' },
        { value: 'panel',    label: 'Panel (set blend → Difference to invert)' },
      ]},
    { name: 'Camera On', param: 'handfxCameraOn', type: 'toggle', default: false },
    { name: 'Smoothing', param: 'handfxSmoothing', type: 'slider', min: 0, max: 1, step: 0.01, default: 0.15 },
    { name: 'Predict Ahead (ms)', param: 'handfxPredictMs', type: 'slider', min: 0, max: 40, step: 1, default: 18 },
    { name: 'Background Opacity', param: 'handfxBgAlpha', type: 'slider', min: 0, max: 1, step: 0.01, default: 0.0 },
    // ── Panel ──
    { name: 'Panel Opacity', param: 'handfxPanelOpacity', type: 'slider', min: 0, max: 1, step: 0.01, default: 1.0,
      showWhen: { param: 'handfxMode', values: ['panel'] } },
    { name: 'Panel Padding', param: 'handfxPanelPadding', type: 'slider', min: 0, max: 0.2, step: 0.005, default: 0.04,
      showWhen: { param: 'handfxMode', values: ['panel'] } },
    { name: 'Panel Corner Radius', param: 'handfxPanelCornerRadius', type: 'slider', min: 0, max: 0.1, step: 0.005, default: 0.02,
      showWhen: { param: 'handfxMode', values: ['panel'] } },

    // ── Paint (mode: 'trails') ──
    { name: 'Paint Color', param: 'handfxTrailColorMode', type: 'select', default: 'rainbow',
      options: [
        { value: 'rainbow', label: 'Rainbow (per finger)' },
        { value: 'coral',   label: 'Coral' },
        { value: 'cyan',    label: 'Cyan' },
        { value: 'white',   label: 'White' },
      ],
      showWhen: { param: 'handfxMode', values: ['trails'] } },
    { name: 'Linger', param: 'handfxTrailFade', type: 'slider', min: 0.9, max: 0.999, step: 0.001, default: 0.985,
      showWhen: { param: 'handfxMode', values: ['trails'] } },
    { name: 'Brush Thickness', param: 'handfxTrailThickness', type: 'slider', min: 1, max: 8, step: 0.5, default: 3,
      showWhen: { param: 'handfxMode', values: ['trails'] } },
    { name: 'Velocity → Width', param: 'handfxTrailVelocityScale', type: 'slider', min: 0, max: 3, step: 0.05, default: 1.5,
      showWhen: { param: 'handfxMode', values: ['trails'] } },
    { name: 'Spark Density', param: 'handfxTrailSparkDensity', type: 'slider', min: 0, max: 2, step: 0.05, default: 0.5,
      showWhen: { param: 'handfxMode', values: ['trails'] } },
    { name: 'Flow Strength', param: 'handfxTrailFlowStrength', type: 'slider', min: 0, max: 2, step: 0.05, default: 0.7,
      showWhen: { param: 'handfxMode', values: ['trails'] } },

    // ── Ink (mode: 'aurora') ──
    { name: 'Ink Color', param: 'handfxInkColorMode', type: 'select', default: 'coral',
      options: [
        { value: 'rainbow', label: 'Rainbow (per finger)' },
        { value: 'coral',   label: 'Coral' },
        { value: 'cyan',    label: 'Cyan' },
        { value: 'white',   label: 'White' },
      ],
      showWhen: { param: 'handfxMode', values: ['aurora'] } },
    { name: 'Blob Size', param: 'handfxInkSize', type: 'slider', min: 10, max: 120, step: 2, default: 55,
      showWhen: { param: 'handfxMode', values: ['aurora'] } },
    { name: 'Blob Opacity', param: 'handfxInkOpacity', type: 'slider', min: 0, max: 1, step: 0.01, default: 0.28,
      showWhen: { param: 'handfxMode', values: ['aurora'] } },
    { name: 'Drift Speed', param: 'handfxInkDrift', type: 'slider', min: 0, max: 3, step: 0.05, default: 1.0,
      showWhen: { param: 'handfxMode', values: ['aurora'] } },

    // ── Skeleton ──
    { name: 'Skeleton Glow', param: 'handfxSkeletonGlow', type: 'slider', min: 0, max: 3, step: 0.1, default: 1.5,
      showWhen: { param: 'handfxMode', values: ['skeleton'] } },

    // ── Pinch Spray (mode: 'bursts') ──
    { name: 'Spray Color', param: 'handfxSprayColorMode', type: 'select', default: 'rainbow',
      options: [
        { value: 'rainbow', label: 'Rainbow' },
        { value: 'coral',   label: 'Coral' },
        { value: 'cyan',    label: 'Cyan' },
        { value: 'white',   label: 'White' },
      ],
      showWhen: { param: 'handfxMode', values: ['bursts'] } },
    { name: 'Spray Intensity', param: 'handfxSprayIntensity', type: 'slider', min: 0.1, max: 3, step: 0.05, default: 1.5,
      showWhen: { param: 'handfxMode', values: ['bursts'] } },
    { name: 'Pinch Threshold', param: 'handfxSprayThreshold', type: 'slider', min: 0.05, max: 0.5, step: 0.01, default: 0.25,
      showWhen: { param: 'handfxMode', values: ['bursts'] } },
  ],
  defaultSourceParams: {
    handfxMode: 'trails',
    handfxCameraOn: false,
    handfxSmoothing: 0.15,
    handfxPredictMs: 18,
    handfxShowHelp: true,
    handfxBgAlpha: 0.0,
    handfxShowCamera: false,
    handfxCameraOpacity: 0.5,
    handfxPanelColor: '#FFFFFF',
    handfxPanelOpacity: 1.0,
    handfxPanelPadding: 0.04,
    handfxPanelCornerRadius: 0.02,
    handfxTrailFade: 0.985,
    handfxTrailColorMode: 'rainbow',
    handfxTrailThickness: 3,
    handfxTrailVelocityScale: 1.5,
    handfxTrailSparkDensity: 0.5,
    handfxTrailFlowStrength: 0.7,
    handfxInkColorMode: 'coral',
    handfxInkSize: 55,
    handfxInkOpacity: 0.28,
    handfxInkDrift: 1.0,
    handfxSkeletonColor: '#FF6B6B',
    handfxSkeletonGlow: 1.5,
    handfxSprayColorMode: 'rainbow',
    handfxSprayIntensity: 1.5,
    handfxSprayThreshold: 0.25,
  },
});
