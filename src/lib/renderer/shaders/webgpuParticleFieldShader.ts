/**
 * WebGPUParticleFieldShader — GpuShaderImpl wrapper around the
 * `WebGPUParticleField` particle universe.
 *
 * The shader's wild range of looks comes from the `mode` selector
 * (galaxy / atomic / swarm / lattice / field / gravity). Each mode
 * surfaces its own param group via the `showWhen` mechanism so the
 * panel only shows the controls that affect the active mode.
 *
 * Audio bands are pumped via the duck-typed `setBands` hook (same
 * path as Flythrough and Point Cloud FX). The connection layer is
 * always available — toggle on for the cellular-scaffold look.
 */

import { WebGPUParticleField, type ParticleFieldParams, type ColorMode, type ColorMap } from '../webgpuParticleField';
import type { GpuShaderImpl, ParamControl } from '../gpuShaderTypes';
import { deriveDefaults } from '../gpuShaderTypes';

export const particleFieldParamSchema: ParamControl[] = [
  // ── Mode ──────────────────────────────────────────────────────
  // The big selector. Switching modes reseeds the particle buffer
  // with positions appropriate for the new behavior.
  { kind: 'select', key: 'mode', label: 'Behavior', group: 'Mode',
    options: [
      { value: 'galaxy',  label: 'Galaxy — spiral arms' },
      { value: 'atomic',  label: 'Atomic — orbital shells' },
      { value: 'swarm',   label: 'Swarm — flocking' },
      { value: 'lattice', label: 'Lattice — crystalline grid' },
      { value: 'field',   label: 'Field — curl-noise drift' },
      { value: 'gravity', label: 'Gravity Wells — compute attractors' },
    ],
    default: 'galaxy' },

  // ── Source (only for media mode) ──────────────────────────────
  { kind: 'media-source', key: 'source', label: 'Source', group: 'Source',
    showWhen: { mode: 'media' } },

  // ── Particles (general) ───────────────────────────────────────
  { kind: 'slider', key: 'particleCount', label: 'Count', group: 'Particles',
    min: 5000, max: 500000, step: 1000, default: 80000 },
  { kind: 'slider', key: 'baseSize',      label: 'Size',  group: 'Particles',
    min: 0.001, max: 0.12, step: 0.0005, default: 0.006 },
  { kind: 'slider', key: 'opacity',       label: 'Opacity', group: 'Particles',
    min: 0, max: 1, step: 0.01, default: 1.0 },

  // ── Topology ──────────────────────────────────────────────────
  { kind: 'select', key: 'topology', label: 'Topology', group: 'Topology',
    options: [
      { value: 'points',  label: 'Points — sharp dots' },
      { value: 'glow',    label: 'Glow — soft halos (stars)' },
      { value: 'streaks', label: 'Streaks — velocity trails' },
      { value: 'sphere',  label: 'Sphere — fake-3D orbs' },
      { value: 'softSphere', label: 'Soft Spheres — volumetric balls' },
    ],
    default: 'glow' },
  { kind: 'slider', key: 'strokeLength', label: 'Streak Length', group: 'Topology',
    min: 0.005, max: 0.2, step: 0.001, default: 0.04,
    showWhen: { topology: 'streaks' } },
  { kind: 'slider', key: 'strokeWidth', label: 'Streak Width', group: 'Topology',
    min: 0.0005, max: 0.03, step: 0.0005, default: 0.004,
    showWhen: { topology: 'streaks' } },

  // ── Galaxy params ─────────────────────────────────────────────
  { kind: 'slider', key: 'galaxyArms', label: 'Arms', group: 'Galaxy Mode',
    min: 1, max: 8, step: 1, default: 4, showWhen: { mode: 'galaxy' } },
  { kind: 'slider', key: 'galaxyRotateInner', label: 'Inner Rotation', group: 'Galaxy Mode',
    min: 0, max: 3, step: 0.01, default: 1.2, showWhen: { mode: 'galaxy' } },
  { kind: 'slider', key: 'galaxyRotateOuter', label: 'Outer Rotation', group: 'Galaxy Mode',
    min: 0, max: 3, step: 0.01, default: 0.3, showWhen: { mode: 'galaxy' } },
  { kind: 'slider', key: 'galaxyTilt', label: 'Tilt', group: 'Galaxy Mode',
    min: -0.5, max: 0.5, step: 0.01, default: 0.1, showWhen: { mode: 'galaxy' } },

  // ── Atomic params ─────────────────────────────────────────────
  { kind: 'slider', key: 'atomicNuclei', label: 'Nuclei Count', group: 'Atomic Mode',
    min: 1, max: 12, step: 1, default: 5, showWhen: { mode: 'atomic' } },
  { kind: 'slider', key: 'atomicShells', label: 'Shells per Nucleus', group: 'Atomic Mode',
    min: 1, max: 6, step: 1, default: 3, showWhen: { mode: 'atomic' } },
  { kind: 'slider', key: 'atomicShellSpacing', label: 'Shell Spacing', group: 'Atomic Mode',
    min: 0.05, max: 0.4, step: 0.005, default: 0.18, showWhen: { mode: 'atomic' } },
  { kind: 'slider', key: 'atomicOrbitSpeed', label: 'Orbit Speed', group: 'Atomic Mode',
    min: 0, max: 3, step: 0.01, default: 0.8, showWhen: { mode: 'atomic' } },

  // ── Swarm params ──────────────────────────────────────────────
  { kind: 'slider', key: 'swarmCohesion', label: 'Cohesion', group: 'Swarm Mode',
    min: 0, max: 3, step: 0.01, default: 0.6, showWhen: { mode: 'swarm' } },
  { kind: 'slider', key: 'swarmSeparation', label: 'Separation', group: 'Swarm Mode',
    min: 0, max: 1, step: 0.005, default: 0.05, showWhen: { mode: 'swarm' } },
  { kind: 'slider', key: 'swarmAlignment', label: 'Alignment', group: 'Swarm Mode',
    min: 0, max: 3, step: 0.01, default: 0.8, showWhen: { mode: 'swarm' } },
  { kind: 'slider', key: 'swarmRange', label: 'Flow Scale', group: 'Swarm Mode',
    min: 0.2, max: 5, step: 0.05, default: 1.5, showWhen: { mode: 'swarm' } },

  // ── Lattice params ────────────────────────────────────────────
  { kind: 'slider', key: 'latticeSize', label: 'Grid Size', group: 'Lattice Mode',
    min: 4, max: 32, step: 1, default: 16, showWhen: { mode: 'lattice' } },
  { kind: 'slider', key: 'latticeSpacing', label: 'Spacing', group: 'Lattice Mode',
    min: 0.5, max: 3, step: 0.01, default: 1.6, showWhen: { mode: 'lattice' } },
  { kind: 'slider', key: 'latticeVibration', label: 'Vibration', group: 'Lattice Mode',
    min: 0, max: 0.2, step: 0.001, default: 0.015, showWhen: { mode: 'lattice' } },

  // ── Field params ──────────────────────────────────────────────
  { kind: 'slider', key: 'windStrength', label: 'Wind', group: 'Field Mode',
    min: 0, max: 1, step: 0.005, default: 0.2, showWhen: { mode: 'field' } },
  { kind: 'slider', key: 'windScale', label: 'Wind Scale', group: 'Field Mode',
    min: 0.5, max: 8, step: 0.05, default: 2.0, showWhen: { mode: 'field' } },

  // ── Media params ──────────────────────────────────────────────
  { kind: 'slider', key: 'mediaDepthAmount', label: 'Depth From Luma', group: 'Media Mode',
    min: 0, max: 2, step: 0.01, default: 0.6, showWhen: { mode: 'media' } },
  { kind: 'slider', key: 'mediaSampleScale', label: 'Sample Scale', group: 'Media Mode',
    min: 0.1, max: 4, step: 0.01, default: 1.0, showWhen: { mode: 'media' } },

  // ── Gravity params ────────────────────────────────────────────
  { kind: 'slider', key: 'gravityWells', label: 'Wells', group: 'Gravity Wells',
    min: 1, max: 8, step: 1, default: 4, showWhen: { mode: 'gravity' } },
  { kind: 'slider', key: 'gravityStrength', label: 'Pull', group: 'Gravity Wells',
    min: 0, max: 0.8, step: 0.005, default: 0.18, showWhen: { mode: 'gravity' } },
  { kind: 'slider', key: 'gravityOrbit', label: 'Orbit Speed', group: 'Gravity Wells',
    min: -2, max: 2, step: 0.01, default: 0.45, showWhen: { mode: 'gravity' } },
  { kind: 'slider', key: 'gravityCoreSize', label: 'Core Size', group: 'Gravity Wells',
    min: 0.01, max: 0.35, step: 0.005, default: 0.09, showWhen: { mode: 'gravity' } },
  { kind: 'slider', key: 'gravityVortex', label: 'Vortex', group: 'Gravity Wells',
    min: -1.5, max: 1.5, step: 0.005, default: 0.34, showWhen: { mode: 'gravity' } },
  { kind: 'slider', key: 'gravityMaxVelocity', label: 'Velocity Clamp', group: 'Gravity Wells',
    min: 0.5, max: 14, step: 0.1, default: 5.0, showWhen: { mode: 'gravity' } },
  { kind: 'slider', key: 'gravityAudioDrive', label: 'Audio Drive', group: 'Gravity Wells',
    min: 0, max: 3, step: 0.05, default: 1.15, showWhen: { mode: 'gravity' } },
  { kind: 'slider', key: 'gravityChaos', label: 'Filament Chaos', group: 'Gravity Wells',
    min: 0, max: 1, step: 0.005, default: 0.18, showWhen: { mode: 'gravity' } },

  // ── Connections ───────────────────────────────────────────────
  // The cellular scaffold. Local lines connect very close pairs;
  // bridge lines connect medium-distance pairs in a different color.
  // Toggle off for pure-particle looks (galaxy without scaffold etc.)
  { kind: 'toggle', key: 'connectEnabled', label: 'Enable Connections', group: 'Connections', default: true },
  { kind: 'slider', key: 'partnerCount', label: 'Partners per Particle', group: 'Connections',
    min: 4, max: 32, step: 1, default: 12, showWhen: { connectEnabled: true } },
  { kind: 'slider', key: 'localRadius', label: 'Local Radius', group: 'Connections',
    min: 0.01, max: 0.5, step: 0.005, default: 0.12, showWhen: { connectEnabled: true } },
  { kind: 'slider', key: 'bridgeRadius', label: 'Bridge Radius', group: 'Connections',
    min: 0.05, max: 1.5, step: 0.01, default: 0.4, showWhen: { connectEnabled: true } },
  { kind: 'color', key: 'colorLocal', label: 'Local Color', group: 'Connections',
    default: [100, 255, 255], showWhen: { connectEnabled: true } },
  { kind: 'color', key: 'colorBridge', label: 'Bridge Color', group: 'Connections',
    default: [240, 80, 200], showWhen: { connectEnabled: true } },
  { kind: 'slider', key: 'alphaLocal', label: 'Local Alpha', group: 'Connections',
    min: 0, max: 1, step: 0.01, default: 0.35, showWhen: { connectEnabled: true } },
  { kind: 'slider', key: 'alphaBridge', label: 'Bridge Alpha', group: 'Connections',
    min: 0, max: 1, step: 0.01, default: 0.12, showWhen: { connectEnabled: true } },

  // ── Atmosphere ────────────────────────────────────────────────
  // Fog: depth-based exponential falloff. Higher density = thicker
  // atmosphere; particles fade into the fog color with distance.
  // Light: directional. Affects all topologies as brightness
  // modulation; sphere topology gets a proper Lambert shade.
  // Fog density controls how quickly particles tint TOWARD the fog
  // color with distance. Fog opacity controls how filled-in the
  // canvas background is — at 0 the canvas is transparent and the
  // fog only tints particles, at 1 the entire background is solid
  // fog and far particles disappear into it (true volumetric feel).
  { kind: 'slider', key: 'fogDensity', label: 'Fog Density (depth fade)', group: 'Atmosphere',
    min: 0, max: 3, step: 0.01, default: 0.6 },
  { kind: 'slider', key: 'fogOpacity', label: 'Fog Opacity (background)', group: 'Atmosphere',
    min: 0, max: 1, step: 0.01, default: 0.85 },
  { kind: 'color', key: 'fogColor', label: 'Fog Color', group: 'Atmosphere',
    default: [5, 5, 15] },
  { kind: 'slider', key: 'lightX', label: 'Light X', group: 'Atmosphere',
    min: -2, max: 2, step: 0.01, default: 0.4 },
  { kind: 'slider', key: 'lightY', label: 'Light Y', group: 'Atmosphere',
    min: -2, max: 2, step: 0.01, default: 0.6 },
  { kind: 'slider', key: 'lightZ', label: 'Light Z', group: 'Atmosphere',
    min: -2, max: 2, step: 0.01, default: 0.7 },
  { kind: 'slider', key: 'lightStrength', label: 'Light Strength', group: 'Atmosphere',
    min: 0, max: 1, step: 0.01, default: 0.6 },

  // ── Audio ─────────────────────────────────────────────────────
  { kind: 'toggle', key: 'audioReactive', label: 'Audio Reactive', group: 'Audio', default: true },
  { kind: 'slider', key: 'burstGain', label: 'Bass Burst Gain', group: 'Audio',
    min: 0, max: 3, step: 0.05, default: 0.6 },
  { kind: 'slider', key: 'burstDecay', label: 'Bass Burst Decay', group: 'Audio',
    min: 0.5, max: 8, step: 0.1, default: 2.5 },
  { kind: 'slider', key: 'shimmerStrength', label: 'Treble Shimmer', group: 'Audio',
    min: 0, max: 0.2, step: 0.001, default: 0.02 },
  { kind: 'slider', key: 'audioSmoothing', label: 'Audio Smooth', group: 'Audio',
    min: 0, max: 0.98, step: 0.01, default: 0.82 },

  // ── Damping (universal) ───────────────────────────────────────
  { kind: 'slider', key: 'damping', label: 'Damping', group: 'Motion',
    min: 0, max: 3, step: 0.01, default: 1.0 },

  // ── Color Mode ────────────────────────────────────────────────
  // The full palette/mapping system from Point Cloud FX. Drives the
  // base particle color before the global HSV adjustments.
  { kind: 'select', key: 'colorMode', label: 'Color Mode', group: 'Color Mode',
    options: [
      { value: 'solid',     label: 'Solid' },
      { value: 'gradient2', label: '2-Stop Gradient' },
      { value: 'gradient3', label: '3-Stop Gradient' },
      { value: 'palette4',  label: '4-Color Palette' },
      { value: 'rainbow',   label: 'Rainbow Cycle' },
      { value: 'random',    label: 'Random per Particle' },
      { value: 'group',     label: 'Group Color (one per cluster)' },
    ],
    default: 'palette4' },
  { kind: 'select', key: 'colorMap', label: 'Mapping', group: 'Color Mode',
    options: [
      { value: 'index',   label: 'Particle Index' },
      { value: 'group',   label: 'Cluster / Group' },
      { value: 'radial',  label: 'Radial Distance' },
      { value: 'y-axis',  label: 'Y Height' },
      { value: 'speed',   label: 'Velocity Magnitude' },
      { value: 'depth-z', label: 'Depth (World Z)' },
      { value: 'noise',   label: 'Noise — Organic Patches' },
    ],
    default: 'radial' },
  { kind: 'slider', key: 'colorMix', label: 'Mix', group: 'Color Mode',
    min: 0, max: 1, step: 0.01, default: 1.0 },
  { kind: 'slider', key: 'colorMapScale', label: 'Map Range', group: 'Color Mode',
    min: 0.1, max: 5, step: 0.05, default: 1.0 },
  { kind: 'slider', key: 'colorMapOffset', label: 'Map Offset', group: 'Color Mode',
    min: -1, max: 1, step: 0.01, default: 0.0 },
  { kind: 'slider', key: 'colorCycleSpeed', label: 'Cycle Speed', group: 'Color Mode',
    min: -2, max: 2, step: 0.01, default: 0.05 },

  // ── Color Stops ───────────────────────────────────────────────
  { kind: 'color', key: 'colorA', label: 'Color A', group: 'Color Stops', default: [45, 105, 255] },
  { kind: 'color', key: 'colorB', label: 'Color B', group: 'Color Stops', default: [245, 70, 165] },
  { kind: 'color', key: 'colorC', label: 'Color C', group: 'Color Stops', default: [255, 200, 50] },
  { kind: 'color', key: 'colorD', label: 'Color D', group: 'Color Stops', default: [50, 245, 215] },

  // ── Random Hue ────────────────────────────────────────────────
  { kind: 'slider', key: 'randomSat', label: 'Random Sat', group: 'Random Hue',
    min: 0, max: 1, step: 0.01, default: 0.85, showWhen: { colorMode: 'random' } },
  { kind: 'slider', key: 'randomVal', label: 'Random Brightness', group: 'Random Hue',
    min: 0.1, max: 2, step: 0.01, default: 1.0, showWhen: { colorMode: 'random' } },

  // ── Color Adjust (applied AFTER mode) ─────────────────────────
  { kind: 'slider', key: 'hueShiftSpeed', label: 'Hue Shift Speed', group: 'Color Adjust',
    min: -1, max: 1, step: 0.005, default: 0.02 },
  { kind: 'slider', key: 'saturation', label: 'Saturation', group: 'Color Adjust',
    min: 0, max: 2, step: 0.01, default: 1.1 },
  { kind: 'slider', key: 'brightness', label: 'Brightness', group: 'Color Adjust',
    min: 0.1, max: 3, step: 0.01, default: 1.1 },

  // ── Object Rotation ───────────────────────────────────────────
  { kind: 'angle', key: 'rotateX', label: 'Rotate X', group: 'Object Rotation', default: 0 },
  { kind: 'angle', key: 'rotateY', label: 'Rotate Y', group: 'Object Rotation', default: 0 },
  { kind: 'angle', key: 'rotateZ', label: 'Rotate Z', group: 'Object Rotation', default: 0 },
  { kind: 'slider', key: 'autoRotateX', label: 'Auto-Spin X', group: 'Object Rotation',
    min: -180, max: 180, step: 0.5, default: 0 },
  { kind: 'slider', key: 'autoRotateY', label: 'Auto-Spin Y', group: 'Object Rotation',
    min: -180, max: 180, step: 0.5, default: 6 },
  { kind: 'slider', key: 'autoRotateZ', label: 'Auto-Spin Z', group: 'Object Rotation',
    min: -180, max: 180, step: 0.5, default: 0 },

  // ── Camera ────────────────────────────────────────────────────
  { kind: 'slider', key: 'fovDeg', label: 'FOV', group: 'Camera',
    min: 20, max: 100, step: 1, default: 50 },
  { kind: 'slider', key: 'cameraZ', label: 'Distance', group: 'Camera',
    min: 0.5, max: 8, step: 0.05, default: 2.4 },
];

export const particleFieldParamDefaults = deriveDefaults(particleFieldParamSchema);

export class WebGPUParticleFieldShader implements GpuShaderImpl {
  private inner: WebGPUParticleField;
  private bands: { bass: number; mid: number; treble: number } | null = null;
  private smoothedBands = { bass: 0, mid: 0, treble: 0 };
  private lastBandTime = 0;
  private lastParams: Record<string, any> = { ...particleFieldParamDefaults };

  constructor(device: any, presentFormat: any) {
    this.inner = new WebGPUParticleField(device, presentFormat);
  }

  setBands(bass: number, mid: number, treble: number): void {
    const now = performance.now() / 1000;
    const dt = this.lastBandTime === 0
      ? 1 / 60
      : Math.min(Math.max(now - this.lastBandTime, 1 / 240), 0.25);
    this.lastBandTime = now;

    const smoothing = Math.max(0, Math.min(0.98, Number(this.lastParams.audioSmoothing ?? 0.82)));
    const attack = 1 - Math.pow(smoothing, dt * 90);
    const release = 1 - Math.pow(smoothing, dt * 28);
    const follow = (prev: number, target: number) => {
      const amount = target > prev ? attack : release;
      return prev + (target - prev) * amount;
    };

    this.smoothedBands = {
      bass: follow(this.smoothedBands.bass, bass),
      mid: follow(this.smoothedBands.mid, mid),
      treble: follow(this.smoothedBands.treble, treble),
    };
    this.bands = this.smoothedBands;
    this.applyParamsToInner();
  }

  setParams(p: Record<string, any>): void {
    this.lastParams = { ...particleFieldParamDefaults, ...p };
    this.applyParamsToInner();
  }

  /** Convert the panel's 0-255 [r,g,b] tuples to 0..1 RGB. */
  private rgb01(c: any, fallback: [number, number, number]): [number, number, number] {
    if (!Array.isArray(c) || c.length < 3) return fallback;
    return [
      Math.max(0, Math.min(1, (c[0] ?? 0) / 255)),
      Math.max(0, Math.min(1, (c[1] ?? 0) / 255)),
      Math.max(0, Math.min(1, (c[2] ?? 0) / 255)),
    ];
  }

  private applyParamsToInner(): void {
    const p = this.lastParams;
    const reactive = !!p.audioReactive && this.bands;
    const liveBass = reactive ? Math.min(1.5, this.bands!.bass * 0.9 + this.bands!.mid * 0.28) : 0;
    const liveTreble = reactive ? this.bands!.treble : 0;
    this.inner.setParams({
      mode: (p.mode ?? 'galaxy') as ParticleFieldParams['mode'],
      particleCount: Math.round(p.particleCount ?? 80000),
      baseSize: p.baseSize ?? 0.006,
      opacity: p.opacity ?? 1.0,
      windStrength: p.windStrength ?? 0.2,
      windScale: p.windScale ?? 2.0,
      anchorPull: p.anchorPull ?? 0,
      damping: p.damping ?? 1.0,
      bass: liveBass,
      treble: liveTreble,
      shimmerStrength: p.shimmerStrength ?? 0.02,
      burstGain: p.burstGain ?? 0.6,
      burstDecay: p.burstDecay ?? 2.5,
      galaxyArms: p.galaxyArms ?? 4,
      galaxyRotateInner: p.galaxyRotateInner ?? 1.2,
      galaxyRotateOuter: p.galaxyRotateOuter ?? 0.3,
      galaxyTilt: p.galaxyTilt ?? 0.1,
      atomicNuclei: p.atomicNuclei ?? 5,
      atomicShells: p.atomicShells ?? 3,
      atomicShellSpacing: p.atomicShellSpacing ?? 0.18,
      atomicOrbitSpeed: p.atomicOrbitSpeed ?? 0.8,
      swarmCohesion: p.swarmCohesion ?? 0.6,
      swarmSeparation: p.swarmSeparation ?? 0.05,
      swarmAlignment: p.swarmAlignment ?? 0.8,
      swarmRange: p.swarmRange ?? 1.5,
      latticeSize: p.latticeSize ?? 16,
      latticeSpacing: p.latticeSpacing ?? 1.6,
      latticeVibration: p.latticeVibration ?? 0.015,
      mediaDepthAmount: p.mediaDepthAmount ?? 0.6,
      mediaSampleScale: p.mediaSampleScale ?? 1.0,
      gravityWells: Math.max(1, Math.min(8, Math.round(p.gravityWells ?? 4))),
      gravityStrength: p.gravityStrength ?? 0.18,
      gravityOrbit: p.gravityOrbit ?? 0.45,
      gravityCoreSize: p.gravityCoreSize ?? 0.09,
      gravityVortex: p.gravityVortex ?? 0.34,
      gravityMaxVelocity: p.gravityMaxVelocity ?? 5.0,
      gravityAudioDrive: p.gravityAudioDrive ?? 1.15,
      gravityChaos: p.gravityChaos ?? 0.18,
      topology: (p.topology ?? 'glow') as ParticleFieldParams['topology'],
      strokeLength: p.strokeLength ?? 0.04,
      strokeWidth: p.strokeWidth ?? 0.004,
      colorMode: (p.colorMode ?? 'palette4') as ColorMode,
      colorMap:  (p.colorMap  ?? 'radial')   as ColorMap,
      colorMix: p.colorMix ?? 1.0,
      colorMapScale: p.colorMapScale ?? 1.0,
      colorMapOffset: p.colorMapOffset ?? 0.0,
      colorCycleSpeed: p.colorCycleSpeed ?? 0.05,
      randomSat: p.randomSat ?? 0.85,
      randomVal: p.randomVal ?? 1.0,
      hueShiftSpeed: p.hueShiftSpeed ?? 0.02,
      saturation: p.saturation ?? 1.1,
      brightness: p.brightness ?? 1.1,
      colorA: this.rgb01(p.colorA, [0.18, 0.42, 1.00]),
      colorB: this.rgb01(p.colorB, [0.95, 0.28, 0.65]),
      colorC: this.rgb01(p.colorC, [1.00, 0.78, 0.20]),
      colorD: this.rgb01(p.colorD, [0.20, 0.95, 0.85]),
      connectEnabled: !!p.connectEnabled,
      partnerCount: Math.max(1, Math.min(32, Math.round(p.partnerCount ?? 12))),
      localRadius: p.localRadius ?? 0.12,
      bridgeRadius: p.bridgeRadius ?? 0.4,
      colorLocal: this.rgb01(p.colorLocal, [0.4, 1.0, 1.0]),
      colorBridge: this.rgb01(p.colorBridge, [0.95, 0.3, 0.8]),
      alphaLocal: p.alphaLocal ?? 0.35,
      alphaBridge: p.alphaBridge ?? 0.12,
      fogDensity: p.fogDensity ?? 0.6,
      fogOpacity: p.fogOpacity ?? 0.85,
      fogColor: this.rgb01(p.fogColor, [0.02, 0.02, 0.06]),
      lightX: p.lightX ?? 0.4,
      lightY: p.lightY ?? 0.6,
      lightZ: p.lightZ ?? 0.7,
      lightStrength: p.lightStrength ?? 0.6,
      fovDeg: p.fovDeg ?? 50,
      cameraZ: p.cameraZ ?? 2.4,
      rotateX: p.rotateX ?? 0,
      rotateY: p.rotateY ?? 0,
      rotateZ: p.rotateZ ?? 0,
      autoRotateX: p.autoRotateX ?? 0,
      autoRotateY: p.autoRotateY ?? 6,
      autoRotateZ: p.autoRotateZ ?? 0,
    });
  }

  setSource(src: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement | ImageBitmap): void {
    if (src instanceof HTMLVideoElement) {
      this.inner.updateSourceFromVideo(src);
    } else if (src instanceof HTMLCanvasElement) {
      this.inner.updateSourceFromCanvas(src);
    } else {
      void this.inner.setSourceImage(src);
    }
  }

  encodeFrame(encoder: any, targetView: any, _format: any, w: number, h: number, _dt: number): void {
    this.inner.setViewport(w, h);
    // Clear our layer canvas — additive blend in the inner pipelines
    // accumulates onto whatever's there, but we want a fresh frame.
    const clearPass = encoder.beginRenderPass({
      colorAttachments: [{
        view: targetView,
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    clearPass.end();
    this.inner.encodeFrame(encoder, targetView);
  }

  resize(_w: number, _h: number): void { /* no-op */ }
  dispose(): void { try { this.inner.dispose(); } catch { /* */ } }
}
