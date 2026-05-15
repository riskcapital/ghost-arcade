/**
 * WebGPUInkCloudShader — wrapper for the ink-in-water / volumetric
 * smoke particle emitter system. Continuous emission from up to 8
 * colored sources with multi-octave curl-noise advection.
 */

import { WebGPUInkCloud, type InkCloudParams } from '../webgpuInkCloud';
import type { GpuShaderImpl, ParamControl } from '../gpuShaderTypes';
import { deriveDefaults } from '../gpuShaderTypes';

export const inkCloudParamSchema: ParamControl[] = [
  // ── Emitters ──────────────────────────────────────────────────
  // The "ink drops" — each emitter is a continuous spawn source
  // with its own color, auto-arranged on a circle in the XZ plane
  // at radius `spread`. spawnY positions the whole ring vertically.
  { kind: 'slider', key: 'emitterCount', label: 'Emitter Count', group: 'Emitters',
    min: 1, max: 8, step: 1, default: 4 },
  { kind: 'slider', key: 'spread', label: 'Spread (orbital radius)', group: 'Emitters',
    min: 0, max: 1.5, step: 0.01, default: 0.4 },
  { kind: 'slider', key: 'spawnY', label: 'Spawn Y', group: 'Emitters',
    min: -1.5, max: 1.5, step: 0.01, default: -0.4 },
  { kind: 'slider', key: 'spawnJitter', label: 'Spawn Jitter', group: 'Emitters',
    min: 0, max: 0.5, step: 0.005, default: 0.04 },

  // ── Emitter Colors ────────────────────────────────────────────
  // Each emitter picks the color at index (emitter % 8). Extras
  // beyond emitterCount are unused.
  { kind: 'color', key: 'emitterColor1', label: 'Color 1', group: 'Emitter Colors', default: [255, 100, 45] },
  { kind: 'color', key: 'emitterColor2', label: 'Color 2', group: 'Emitter Colors', default: [45, 200, 255] },
  { kind: 'color', key: 'emitterColor3', label: 'Color 3', group: 'Emitter Colors', default: [220, 50, 220] },
  { kind: 'color', key: 'emitterColor4', label: 'Color 4', group: 'Emitter Colors', default: [50, 245, 140] },
  { kind: 'color', key: 'emitterColor5', label: 'Color 5', group: 'Emitter Colors', default: [255, 215, 75] },
  { kind: 'color', key: 'emitterColor6', label: 'Color 6', group: 'Emitter Colors', default: [130, 75, 255] },
  { kind: 'color', key: 'emitterColor7', label: 'Color 7', group: 'Emitter Colors', default: [255, 75, 140] },
  { kind: 'color', key: 'emitterColor8', label: 'Color 8', group: 'Emitter Colors', default: [75, 255, 240] },

  // ── Particles ─────────────────────────────────────────────────
  { kind: 'slider', key: 'particleCount', label: 'Count', group: 'Particles',
    min: 10000, max: 600000, step: 5000, default: 150000 },
  { kind: 'slider', key: 'avgLifetime', label: 'Lifetime (s)', group: 'Particles',
    min: 0.5, max: 10, step: 0.05, default: 3.0 },
  { kind: 'slider', key: 'lifetimeVar', label: 'Lifetime Variation', group: 'Particles',
    min: 0, max: 1, step: 0.01, default: 0.3 },
  { kind: 'slider', key: 'sizeStart', label: 'Size at Spawn', group: 'Particles',
    min: 0.001, max: 0.05, step: 0.0005, default: 0.008 },
  { kind: 'slider', key: 'sizeEnd', label: 'Size at Death', group: 'Particles',
    min: 0.005, max: 0.2, step: 0.001, default: 0.05 },

  // ── Color Evolution ───────────────────────────────────────────
  { kind: 'slider', key: 'colorFadeAmount', label: 'Fade Strength', group: 'Color Evolution',
    min: 0, max: 1, step: 0.01, default: 1.0 },
  { kind: 'color', key: 'fadeColor', label: 'Fade-to Color', group: 'Color Evolution',
    default: [10, 12, 26] },

  // ── Motion: Buoyancy + Wind ───────────────────────────────────
  // Buoyancy is constant +Y force — smoke rises. Wind is a vector
  // force applied to every particle each frame; great for sideways
  // drift or downward "spilling ink" effects.
  { kind: 'slider', key: 'buoyancy', label: 'Buoyancy (up)', group: 'Motion',
    min: -0.5, max: 1, step: 0.01, default: 0.18 },
  { kind: 'slider', key: 'damping', label: 'Damping', group: 'Motion',
    min: 0, max: 3, step: 0.01, default: 0.6 },
  { kind: 'slider', key: 'windX', label: 'Wind X', group: 'Motion',
    min: -1, max: 1, step: 0.01, default: 0 },
  { kind: 'slider', key: 'windY', label: 'Wind Y', group: 'Motion',
    min: -1, max: 1, step: 0.01, default: 0 },
  { kind: 'slider', key: 'windZ', label: 'Wind Z', group: 'Motion',
    min: -1, max: 1, step: 0.01, default: 0 },

  // ── Curl Noise (turbulence) ───────────────────────────────────
  // Two octaves of curl-of-noise. Octave 1 is the major swirl
  // motion at low frequency. Octave 2 adds fine wispy detail at
  // high frequency — crank this for the chunky internal cloud
  // structure of real ink-in-water photos.
  { kind: 'slider', key: 'curl1Strength', label: 'Octave 1 Strength', group: 'Curl Noise',
    min: 0, max: 2, step: 0.01, default: 0.3 },
  { kind: 'slider', key: 'curl1Scale', label: 'Octave 1 Scale', group: 'Curl Noise',
    min: 0.3, max: 8, step: 0.05, default: 1.6 },
  { kind: 'slider', key: 'curl1TimeFlow', label: 'Octave 1 Time Flow', group: 'Curl Noise',
    min: 0, max: 2, step: 0.01, default: 0.15 },
  { kind: 'slider', key: 'curl2Strength', label: 'Octave 2 Strength', group: 'Curl Noise',
    min: 0, max: 2, step: 0.01, default: 0.18 },
  { kind: 'slider', key: 'curl2Scale', label: 'Octave 2 Scale', group: 'Curl Noise',
    min: 1, max: 20, step: 0.1, default: 5.0 },
  { kind: 'slider', key: 'curl2TimeFlow', label: 'Octave 2 Time Flow', group: 'Curl Noise',
    min: 0, max: 3, step: 0.01, default: 0.4 },

  // ── Vortex ────────────────────────────────────────────────────
  // Adds a rotational pull around the origin in the plane
  // perpendicular to the axis vector. Use for "drain" or "tornado"
  // effects on the rising ink.
  { kind: 'toggle', key: 'vortexEnabled', label: 'Enable Vortex', group: 'Vortex', default: false },
  { kind: 'slider', key: 'vortexStrength', label: 'Vortex Strength', group: 'Vortex',
    min: 0, max: 3, step: 0.01, default: 0.6, showWhen: { vortexEnabled: true } },
  { kind: 'slider', key: 'vortexRadius', label: 'Vortex Falloff', group: 'Vortex',
    min: 0.05, max: 2, step: 0.01, default: 0.5, showWhen: { vortexEnabled: true } },
  { kind: 'slider', key: 'vortexAxisX', label: 'Vortex Axis X', group: 'Vortex',
    min: -1, max: 1, step: 0.01, default: 0, showWhen: { vortexEnabled: true } },
  { kind: 'slider', key: 'vortexAxisY', label: 'Vortex Axis Y', group: 'Vortex',
    min: -1, max: 1, step: 0.01, default: 1, showWhen: { vortexEnabled: true } },
  { kind: 'slider', key: 'vortexAxisZ', label: 'Vortex Axis Z', group: 'Vortex',
    min: -1, max: 1, step: 0.01, default: 0, showWhen: { vortexEnabled: true } },

  // ── Audio ─────────────────────────────────────────────────────
  { kind: 'toggle', key: 'audioReactive', label: 'Audio Reactive', group: 'Audio', default: true },
  { kind: 'slider', key: 'audioBurstStrength', label: 'Bass Burst (refresh ratio)', group: 'Audio',
    min: 0, max: 1, step: 0.01, default: 0.3 },
  { kind: 'slider', key: 'shimmerStrength', label: 'Treble Shimmer', group: 'Audio',
    min: 0, max: 0.3, step: 0.001, default: 0.04 },

  // ── Render ────────────────────────────────────────────────────
  { kind: 'slider', key: 'brightness', label: 'Brightness', group: 'Render',
    min: 0.1, max: 4, step: 0.01, default: 1.2 },
  { kind: 'slider', key: 'alphaScale', label: 'Density (alpha)', group: 'Render',
    min: 0, max: 1.5, step: 0.01, default: 0.55 },
  { kind: 'slider', key: 'density', label: 'Edge Softness', group: 'Render',
    min: 0.5, max: 8, step: 0.05, default: 2.5 },

  // ── Background ────────────────────────────────────────────────
  { kind: 'color', key: 'bgColor', label: 'Background Color', group: 'Background',
    default: [10, 10, 20] },
  { kind: 'slider', key: 'bgOpacity', label: 'Background Opacity', group: 'Background',
    min: 0, max: 1, step: 0.01, default: 1.0 },

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
  { kind: 'slider', key: 'cameraZ', label: 'Distance', group: 'Camera',
    min: 0.5, max: 8, step: 0.05, default: 2.4 },
];

export const inkCloudParamDefaults = deriveDefaults(inkCloudParamSchema);

export class WebGPUInkCloudShader implements GpuShaderImpl {
  private inner: WebGPUInkCloud;
  private bands: { bass: number; mid: number; treble: number } | null = null;
  private lastParams: Record<string, any> = { ...inkCloudParamDefaults };

  constructor(device: any, presentFormat: any) {
    this.inner = new WebGPUInkCloud(device, presentFormat);
  }

  setBands(bass: number, mid: number, treble: number): void {
    this.bands = { bass, mid, treble };
    this.applyParamsToInner();
  }

  setParams(p: Record<string, any>): void {
    this.lastParams = { ...inkCloudParamDefaults, ...p };
    this.applyParamsToInner();
  }

  /** 0-255 → 0..1 */
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
    this.inner.setParams({
      particleCount: Math.round(p.particleCount ?? 150000),
      emitterCount: Math.max(1, Math.min(8, Math.round(p.emitterCount ?? 4))),
      spread: p.spread ?? 0.4,
      spawnY: p.spawnY ?? -0.4,
      spawnJitter: p.spawnJitter ?? 0.04,
      avgLifetime: p.avgLifetime ?? 3.0,
      lifetimeVar: p.lifetimeVar ?? 0.3,
      sizeStart: p.sizeStart ?? 0.008,
      sizeEnd: p.sizeEnd ?? 0.05,
      fadeColor: this.rgb01(p.fadeColor, [0.04, 0.05, 0.10]),
      colorFadeAmount: p.colorFadeAmount ?? 1.0,
      buoyancy: p.buoyancy ?? 0.18,
      damping: p.damping ?? 0.6,
      windX: p.windX ?? 0,
      windY: p.windY ?? 0,
      windZ: p.windZ ?? 0,
      curl1Strength: p.curl1Strength ?? 0.3,
      curl1Scale: p.curl1Scale ?? 1.6,
      curl1TimeFlow: p.curl1TimeFlow ?? 0.15,
      curl2Strength: p.curl2Strength ?? 0.18,
      curl2Scale: p.curl2Scale ?? 5.0,
      curl2TimeFlow: p.curl2TimeFlow ?? 0.4,
      vortexEnabled: !!p.vortexEnabled,
      vortexStrength: p.vortexStrength ?? 0.6,
      vortexRadius: p.vortexRadius ?? 0.5,
      vortexAxisX: p.vortexAxisX ?? 0,
      vortexAxisY: p.vortexAxisY ?? 1,
      vortexAxisZ: p.vortexAxisZ ?? 0,
      bass: liveBass,
      treble: liveTreble,
      audioBurstStrength: p.audioBurstStrength ?? 0.3,
      shimmerStrength: p.shimmerStrength ?? 0.04,
      brightness: p.brightness ?? 1.2,
      alphaScale: p.alphaScale ?? 0.55,
      density: p.density ?? 2.5,
      bgColor: this.rgb01(p.bgColor, [0.04, 0.04, 0.08]),
      bgOpacity: p.bgOpacity ?? 1.0,
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
      fovDeg: p.fovDeg ?? 50,
      cameraZ: p.cameraZ ?? 2.4,
      rotateX: p.rotateX ?? 0,
      rotateY: p.rotateY ?? 0,
      rotateZ: p.rotateZ ?? 0,
      autoRotateX: p.autoRotateX ?? 0,
      autoRotateY: p.autoRotateY ?? 0,
      autoRotateZ: p.autoRotateZ ?? 0,
    });
  }

  encodeFrame(encoder: any, targetView: any, _format: any, w: number, h: number, _dt: number): void {
    this.inner.setViewport(w, h);
    // Clear the layer canvas first — the inner's render pass uses
    // loadOp:'load' and composites onto whatever's there. We clear
    // transparent so the bg fill pass inside encodeFrame paints in
    // the user's background color over our transparent start.
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
