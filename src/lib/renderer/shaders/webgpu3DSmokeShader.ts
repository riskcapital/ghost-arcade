/**
 * WebGPU3DSmokeShader — GpuShaderImpl wrapper around WebGPU3DSmoke.
 * True 3D volumetric smoke: voxel-grid Navier-Stokes (Stable Fluids
 * in 3D) + raymarched volume renderer with blue-noise dither.
 *
 * Different from Fluid Smoke (which is a 2D fluid sim rendered as
 * a flat texture) in two big ways:
 *   1. The simulation runs on a full 3D voxel grid — smoke really
 *      has depth, occludes itself, has parallax.
 *   2. The renderer is a raymarcher — for each pixel it casts a ray
 *      through the volume and accumulates density along the way.
 *      Closer voxels cover farther voxels, like real smoke.
 *
 * Auto-orbital emitters splat density+velocity into the volume on a
 * configurable cadence; bass kicks trigger synchronized bursts.
 */

import { WebGPU3DSmoke, type Smoke3DParams } from '../webgpu3DSmoke';
import type { GpuShaderImpl, ParamControl } from '../gpuShaderTypes';
import { deriveDefaults } from '../gpuShaderTypes';

export const smoke3DParamSchema: ParamControl[] = [
  // ── Grid ──────────────────────────────────────────────────────
  // Larger grid = more detail + more GPU. 48³ is the sweet spot for
  // discrete GPUs at 60fps; 32³ runs on integrated; 64³ is for
  // people with serious hardware who want maximum detail.
  { kind: 'select', key: 'gridSize', label: 'Resolution', group: 'Grid',
    options: [
      { value: '32', label: '32³ (fast, integrated GPU friendly)' },
      { value: '48', label: '48³ (balanced — recommended)' },
      { value: '64', label: '64³ (high detail, discrete GPU)' },
    ],
    default: '48' },

  // ── Volume Shape ──────────────────────────────────────────────
  // The simulation grid is voxel-uniform (always cubic) but its
  // world-space FOOTPRINT can be stretched per axis to match the
  // layer canvas. Default Width=1.6 fills a 16:9 layer; bump higher
  // for ultrawide. Depth controls how "tunnel-deep" the smoke feels
  // when raymarched — Depth=2 makes the cloud read longer in the
  // camera-forward direction, Depth=0.5 makes it a thin slab.
  { kind: 'slider', key: 'volumeScaleX', label: 'Volume Width', group: 'Volume Shape',
    min: 0.5, max: 4, step: 0.05, default: 1.6 },
  { kind: 'slider', key: 'volumeScaleZ', label: 'Volume Depth', group: 'Volume Shape',
    min: 0.3, max: 4, step: 0.05, default: 1.0 },

  // ── Emitters ──────────────────────────────────────────────────
  { kind: 'slider', key: 'emitterCount', label: 'Emitter Count', group: 'Emitters',
    min: 1, max: 8, step: 1, default: 4 },
  { kind: 'slider', key: 'spread', label: 'Spread (radius)', group: 'Emitters',
    min: 0, max: 1, step: 0.01, default: 0.3 },
  { kind: 'slider', key: 'spawnY', label: 'Spawn Height', group: 'Emitters',
    min: -1, max: 1, step: 0.01, default: -0.5 },
  { kind: 'slider', key: 'splatRadius', label: 'Splat Softness', group: 'Emitters',
    min: 0.01, max: 0.2, step: 0.005, default: 0.10 },
  { kind: 'slider', key: 'splatStrength', label: 'Splat Strength', group: 'Emitters',
    min: 0.1, max: 5, step: 0.05, default: 3.0 },
  { kind: 'slider', key: 'splatVelocityMag', label: 'Splat Velocity (upward)', group: 'Emitters',
    min: 0, max: 3, step: 0.01, default: 0.6 },
  { kind: 'slider', key: 'splatRate', label: 'Splat Rate (Hz)', group: 'Emitters',
    min: 0.5, max: 60, step: 0.5, default: 60 },

  // ── Emitter Colors ────────────────────────────────────────────
  { kind: 'color', key: 'emitterColor1', label: 'Color 1', group: 'Emitter Colors', default: [255, 100, 45] },
  { kind: 'color', key: 'emitterColor2', label: 'Color 2', group: 'Emitter Colors', default: [45, 200, 255] },
  { kind: 'color', key: 'emitterColor3', label: 'Color 3', group: 'Emitter Colors', default: [220, 50, 220] },
  { kind: 'color', key: 'emitterColor4', label: 'Color 4', group: 'Emitter Colors', default: [50, 245, 140] },
  { kind: 'color', key: 'emitterColor5', label: 'Color 5', group: 'Emitter Colors', default: [255, 215, 75] },
  { kind: 'color', key: 'emitterColor6', label: 'Color 6', group: 'Emitter Colors', default: [130, 75, 255] },
  { kind: 'color', key: 'emitterColor7', label: 'Color 7', group: 'Emitter Colors', default: [255, 75, 140] },
  { kind: 'color', key: 'emitterColor8', label: 'Color 8', group: 'Emitter Colors', default: [75, 255, 240] },

  // ── Simulation ────────────────────────────────────────────────
  // Decays are per-frame multipliers (close to 1 = long-lived,
  // farther from 1 = aggressive fade). They're MULTIPLICATIVE, not
  // per-second, so they're already frame-rate aware.
  { kind: 'slider', key: 'velocityDecay', label: 'Velocity Persistence', group: 'Simulation',
    min: 0.9, max: 1.0, step: 0.001, default: 0.985 },
  { kind: 'slider', key: 'densityDecay', label: 'Density Persistence', group: 'Simulation',
    min: 0.9, max: 1.0, step: 0.001, default: 0.992 },

  // ── Wind & Turbulence ─────────────────────────────────────────
  // Wind: constant directional force on the velocity field. Use Y
  // negative for "downdraft," positive for "extra buoyancy lift."
  // Turbulence: 3D curl-noise that swirls the velocity organically;
  // makes the smoke look like it's reacting to invisible currents
  // rather than just rising in straight columns.
  { kind: 'slider', key: 'windX', label: 'Wind X', group: 'Wind & Turbulence',
    min: -3, max: 3, step: 0.01, default: 0 },
  { kind: 'slider', key: 'windY', label: 'Wind Y', group: 'Wind & Turbulence',
    min: -3, max: 3, step: 0.01, default: 0 },
  { kind: 'slider', key: 'windZ', label: 'Wind Z', group: 'Wind & Turbulence',
    min: -3, max: 3, step: 0.01, default: 0 },
  { kind: 'slider', key: 'turbStrength', label: 'Turbulence Strength', group: 'Wind & Turbulence',
    min: 0, max: 4, step: 0.01, default: 0.5 },
  { kind: 'slider', key: 'turbScale', label: 'Turbulence Scale', group: 'Wind & Turbulence',
    min: 0.5, max: 12, step: 0.05, default: 2.5 },

  // ── Lighting & Shadows ────────────────────────────────────────
  // Directional light + per-step shadow march. ShadowSteps=0 turns
  // off self-shadowing (cheap, flat-emissive smoke). 4-6 steps gives
  // visible lit/shadow split. 8+ steps for crisp definition (slower).
  { kind: 'slider', key: 'lightDirX', label: 'Light Direction X', group: 'Lighting',
    min: -1, max: 1, step: 0.01, default: 0.4 },
  { kind: 'slider', key: 'lightDirY', label: 'Light Direction Y', group: 'Lighting',
    min: -1, max: 1, step: 0.01, default: 0.6 },
  { kind: 'slider', key: 'lightDirZ', label: 'Light Direction Z', group: 'Lighting',
    min: -1, max: 1, step: 0.01, default: 0.7 },
  { kind: 'slider', key: 'lightStrength', label: 'Light Strength', group: 'Lighting',
    min: 0, max: 2, step: 0.01, default: 0.8 },
  { kind: 'color',  key: 'lightColor', label: 'Light Color', group: 'Lighting',
    default: [255, 242, 217] },
  { kind: 'slider', key: 'ambient', label: 'Ambient', group: 'Lighting',
    min: 0, max: 1, step: 0.01, default: 0.25 },
  { kind: 'slider', key: 'shadowSteps', label: 'Shadow Steps (0 = off)', group: 'Lighting',
    min: 0, max: 12, step: 1, default: 4 },
  { kind: 'slider', key: 'shadowStepLen', label: 'Shadow Step Length', group: 'Lighting',
    min: 0.01, max: 0.2, step: 0.005, default: 0.06 },

  // ── Render ────────────────────────────────────────────────────
  // Emission is the visual brightness multiplier; density controls
  // how much each voxel contributes to alpha along the ray (higher
  // = the volume looks "thicker").
  { kind: 'slider', key: 'emission', label: 'Emission', group: 'Render',
    min: 0.1, max: 6, step: 0.05, default: 2.5 },
  { kind: 'slider', key: 'density', label: 'Density (alpha)', group: 'Render',
    min: 0.1, max: 8, step: 0.05, default: 3.0 },

  // ── Atmosphere ────────────────────────────────────────────────
  { kind: 'color', key: 'fogColor', label: 'Fog Color', group: 'Atmosphere',
    default: [20, 26, 46] },
  { kind: 'slider', key: 'fogOpacity', label: 'Fog Opacity', group: 'Atmosphere',
    min: 0, max: 1, step: 0.01, default: 1.0 },

  // ── Audio ─────────────────────────────────────────────────────
  { kind: 'toggle', key: 'audioReactive', label: 'Audio Reactive', group: 'Audio', default: true },
  { kind: 'slider', key: 'audioBurst', label: 'Bass Burst Strength', group: 'Audio',
    min: 0, max: 2, step: 0.01, default: 0.5,
    showWhen: { audioReactive: true } },

  // ── Object Rotation ───────────────────────────────────────────
  { kind: 'angle', key: 'rotateX', label: 'Rotate X', group: 'Object Rotation', default: 0 },
  { kind: 'angle', key: 'rotateY', label: 'Rotate Y', group: 'Object Rotation', default: 0 },
  { kind: 'angle', key: 'rotateZ', label: 'Rotate Z', group: 'Object Rotation', default: 0 },
  { kind: 'slider', key: 'autoRotateX', label: 'Auto-Spin X', group: 'Object Rotation',
    min: -180, max: 180, step: 0.5, default: 0 },
  { kind: 'slider', key: 'autoRotateY', label: 'Auto-Spin Y', group: 'Object Rotation',
    min: -180, max: 180, step: 0.5, default: 0 },
  { kind: 'slider', key: 'autoRotateZ', label: 'Auto-Spin Z', group: 'Object Rotation',
    min: -180, max: 180, step: 0.5, default: 0 },

  // ── Camera ────────────────────────────────────────────────────
  { kind: 'slider', key: 'fovDeg', label: 'FOV', group: 'Camera',
    min: 20, max: 100, step: 1, default: 50 },
  // Default 2.7 fits the [-1,1] cube tightly within the layer's
  // height at FOV=50°. Pull farther for a wider air-gap, closer
  // (down to ~1.5) to get inside the smoke for an immersive view.
  { kind: 'slider', key: 'cameraZ', label: 'Distance', group: 'Camera',
    min: 1.0, max: 8, step: 0.05, default: 2.7 },
];

export const smoke3DParamDefaults = deriveDefaults(smoke3DParamSchema);

export class WebGPU3DSmokeShader implements GpuShaderImpl {
  private inner: WebGPU3DSmoke;
  private bands: { bass: number; mid: number; treble: number } | null = null;
  private lastParams: Record<string, any> = { ...smoke3DParamDefaults };

  constructor(device: any, presentFormat: any) {
    this.inner = new WebGPU3DSmoke(device, presentFormat);
  }

  setBands(bass: number, mid: number, treble: number): void {
    this.bands = { bass, mid, treble };
    this.applyParamsToInner();
  }

  setParams(p: Record<string, any>): void {
    this.lastParams = { ...smoke3DParamDefaults, ...p };
    this.applyParamsToInner();
  }

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
    const liveBass = reactive ? this.bands!.bass : 0;
    const liveTreble = reactive ? this.bands!.treble : 0;
    // gridSize stored as string from select; parse to enum int
    const gridStr = p.gridSize ?? '48';
    const gridNum: 32 | 48 | 64 = (gridStr === '32' || gridStr === '64') ? Number(gridStr) as any : 48;
    this.inner.setParams({
      gridSize: gridNum,
      emission: p.emission ?? 1.4,
      density: p.density ?? 1.5,
      velocityDecay: p.velocityDecay ?? 0.985,
      densityDecay: p.densityDecay ?? 0.992,
      emitterCount: Math.max(1, Math.min(8, Math.round(p.emitterCount ?? 4))),
      spread: p.spread ?? 0.3,
      spawnY: p.spawnY ?? -0.5,
      splatRadius: p.splatRadius ?? 0.06,
      splatStrength: p.splatStrength ?? 1.4,
      splatVelocityMag: p.splatVelocityMag ?? 0.6,
      splatRate: p.splatRate ?? 6,
      bass: liveBass,
      treble: liveTreble,
      audioBurst: p.audioBurst ?? 0.5,
      emitterColors: [
        this.rgb01(p.emitterColor1, [1.00, 0.40, 0.18]),
        this.rgb01(p.emitterColor2, [0.18, 0.78, 1.00]),
        this.rgb01(p.emitterColor3, [0.85, 0.20, 0.85]),
        this.rgb01(p.emitterColor4, [0.20, 0.95, 0.55]),
        this.rgb01(p.emitterColor5, [1.00, 0.85, 0.30]),
        this.rgb01(p.emitterColor6, [0.50, 0.30, 1.00]),
        this.rgb01(p.emitterColor7, [1.00, 0.30, 0.55]),
        this.rgb01(p.emitterColor8, [0.30, 1.00, 0.95]),
      ],
      volumeScaleX: p.volumeScaleX ?? 1.6,
      volumeScaleZ: p.volumeScaleZ ?? 1.0,
      windX: p.windX ?? 0,
      windY: p.windY ?? 0,
      windZ: p.windZ ?? 0,
      turbStrength: p.turbStrength ?? 0.5,
      turbScale: p.turbScale ?? 2.5,
      lightDirX: p.lightDirX ?? 0.4,
      lightDirY: p.lightDirY ?? 0.6,
      lightDirZ: p.lightDirZ ?? 0.7,
      lightStrength: p.lightStrength ?? 0.8,
      lightColor: this.rgb01(p.lightColor, [1.0, 0.95, 0.85]),
      ambient: p.ambient ?? 0.25,
      shadowSteps: Math.max(0, Math.min(12, Math.round(p.shadowSteps ?? 4))),
      shadowStepLen: p.shadowStepLen ?? 0.06,
      fovDeg: p.fovDeg ?? 50,
      cameraZ: p.cameraZ ?? 2.7,
      rotateX: p.rotateX ?? 0,
      rotateY: p.rotateY ?? 0,
      rotateZ: p.rotateZ ?? 0,
      autoRotateX: p.autoRotateX ?? 0,
      autoRotateY: p.autoRotateY ?? 0,
      autoRotateZ: p.autoRotateZ ?? 0,
      fogColor: this.rgb01(p.fogColor, [0.08, 0.10, 0.18]),
      fogOpacity: p.fogOpacity ?? 1.0,
    });
  }

  encodeFrame(encoder: any, targetView: any, _format: any, w: number, h: number, _dt: number): void {
    this.inner.setViewport(w, h);
    // Clear to transparent — the raymarcher's fog-bg accumulation
    // produces the background tint inside the same render pass.
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

  resize(_w: number, _h: number): void { /* no-op — raymarcher reads viewport via setViewport */ }
  dispose(): void { try { this.inner.dispose(); } catch { /* */ } }
}
