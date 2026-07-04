/**
 * WebGPUSmokeRidersShader — curated combo instrument.
 *
 * Pass order:
 *   1. clear transparent
 *   2. 3D Smoke volume owns the atmosphere/background
 *   3. Volumetric Spheres renders analytic spheres into the volume
 *
 * Future work can replace the loose choreography with real smoke-
 * velocity sampling once WebGPU3DSmoke exposes its velocity grid as a
 * shared frame-graph resource.
 */

import {
  WebGPU3DSmoke,
  buildSmoke3DNativeComputeGraph,
  type Smoke3DNativeGraphState,
  type Smoke3DParams,
} from '../webgpu3DSmoke';
import {
  WebGPUVolumetricSpheresShader,
  buildVolumetricSpheresNativeComputeGraph,
  type VolumetricSpheresNativeGraphState,
  type VolumetricSpheresParams,
} from './webgpuVolumetricSpheresShader';
import type { GpuShaderImpl, ParamControl } from '../gpuShaderTypes';
import { deriveDefaults } from '../gpuShaderTypes';

export const smokeRidersParamSchema: ParamControl[] = [
  { kind: 'select', key: 'quality', label: 'Quality', group: 'Core',
    options: [
      { value: 'performance', label: 'Performance' },
      { value: 'balanced', label: 'Balanced' },
      { value: 'ultra', label: 'Ultra' },
    ],
    default: 'balanced' },
  { kind: 'select', key: 'style', label: 'Style', group: 'Core',
    options: [
      { value: 'orbital', label: 'Orbital Spheres' },
      { value: 'ember', label: 'Ember Cloud' },
      { value: 'pearlescent', label: 'Pearlescent Mass' },
    ],
    default: 'orbital' },
  { kind: 'slider', key: 'intensity', label: 'Intensity', group: 'Core',
    min: 0, max: 2, step: 0.01, default: 1 },

  { kind: 'slider', key: 'smokeDensity', label: 'Smoke Density', group: 'Smoke',
    min: 0, max: 8, step: 0.05, default: 2.75 },
  { kind: 'slider', key: 'smokeGlow', label: 'Smoke Glow', group: 'Smoke',
    min: 0, max: 6, step: 0.05, default: 2.1 },
  { kind: 'slider', key: 'smokeTurbulence', label: 'Turbulence', group: 'Smoke',
    min: 0, max: 4, step: 0.01, default: 0.85 },
  { kind: 'slider', key: 'smokeSpread', label: 'Spread', group: 'Smoke',
    min: 0, max: 0.9, step: 0.01, default: 0.42 },
  { kind: 'slider', key: 'shadowSteps', label: 'Shadow Steps', group: 'Smoke',
    min: 0, max: 12, step: 1, default: 4 },

  { kind: 'slider', key: 'sphereCount', label: 'Sphere Count', group: 'Spheres',
    min: 24, max: 1200, step: 12, default: 192 },
  { kind: 'slider', key: 'sphereSize', label: 'Sphere Size', group: 'Spheres',
    min: 0.025, max: 0.22, step: 0.001, default: 0.08 },
  { kind: 'slider', key: 'sphereOpacity', label: 'Sphere Opacity', group: 'Spheres',
    min: 0, max: 1, step: 0.01, default: 0.92 },
  { kind: 'slider', key: 'sphereMotion', label: 'Sphere Motion', group: 'Spheres',
    min: 0, max: 2, step: 0.01, default: 0.72 },
  { kind: 'slider', key: 'sphereGloss', label: 'Sphere Gloss', group: 'Spheres',
    min: 0, max: 1, step: 0.01, default: 0.7 },

  { kind: 'color', key: 'colorA', label: 'Color A', group: 'Palette',
    default: [70, 170, 255] },
  { kind: 'color', key: 'colorB', label: 'Color B', group: 'Palette',
    default: [255, 72, 156] },
  { kind: 'color', key: 'colorC', label: 'Color C', group: 'Palette',
    default: [255, 205, 92] },
  { kind: 'color', key: 'colorD', label: 'Color D', group: 'Palette',
    default: [120, 255, 222] },
  { kind: 'color', key: 'smokeColor', label: 'Smoke Tint', group: 'Palette',
    default: [18, 24, 46] },

  { kind: 'toggle', key: 'audioReactive', label: 'Audio Reactive', group: 'Audio',
    default: true },
  { kind: 'slider', key: 'bassDrive', label: 'Bass Drive', group: 'Audio',
    min: 0, max: 3, step: 0.05, default: 1.2,
    showWhen: { audioReactive: true } },
  { kind: 'slider', key: 'trebleShimmer', label: 'Treble Shimmer', group: 'Audio',
    min: 0, max: 0.2, step: 0.001, default: 0.025,
    showWhen: { audioReactive: true } },

  { kind: 'slider', key: 'fovDeg', label: 'FOV', group: 'Camera',
    min: 25, max: 95, step: 1, default: 48 },
  { kind: 'slider', key: 'cameraZ', label: 'Distance', group: 'Camera',
    min: 1.4, max: 7, step: 0.05, default: 2.85 },
  { kind: 'angle', key: 'rotateX', label: 'Rotate X', group: 'Camera', default: 0 },
  { kind: 'angle', key: 'rotateY', label: 'Rotate Y', group: 'Camera', default: 0 },
  { kind: 'angle', key: 'rotateZ', label: 'Rotate Z', group: 'Camera', default: 0 },
  { kind: 'slider', key: 'autoSpin', label: 'Auto Spin', group: 'Camera',
    min: -24, max: 24, step: 0.1, default: 4.5 },
];

export const smokeRidersParamDefaults = deriveDefaults(smokeRidersParamSchema);

type Bands = { bass: number; mid: number; treble: number };

type SmokeRidersStyleTuning = {
  emitters: number;
  spawnY: number;
  splatRadius: number;
  splatVelocity: number;
  densityDecay: number;
  windX: number;
  windY: number;
  windZ: number;
  turbScale: number;
  spinX: number;
  spinZ: number;
  sizeScale: number;
  colorCycle: number;
  saturation: number;
  sphereLayout: VolumetricSpheresParams['layout'];
  radiusVariance: number;
  sphereSpread: number;
  sphereDepth: number;
  sphereSwirl: number;
  spherePull: number;
  sphereChaos: number;
  sphereDamping: number;
  rim: number;
};

export interface SmokeRidersInnerParams {
  smoke: Partial<Smoke3DParams>;
  spheres: Partial<VolumetricSpheresParams>;
}

export interface SmokeRidersNativeGraphState {
  smoke: Smoke3DNativeGraphState | null;
  spheres: VolumetricSpheresNativeGraphState | null;
}

export interface SmokeRidersNativeGraphOptions {
  sourceId: string;
  params?: Record<string, any> | null;
  width?: number;
  height?: number;
  time?: number;
  frameDelta?: number;
  frameIndex?: number;
  audioBass?: number;
  audioTreble?: number;
  state?: SmokeRidersNativeGraphState | null;
  reset?: boolean;
  includeSnapshot?: boolean;
}

export interface SmokeRidersNativeGraphBuildResult {
  config: {
    buffers: any[];
    passes: any[];
    render_passes: any[];
    readbacks: string[];
  };
  sourceId: string;
  state: SmokeRidersNativeGraphState;
  passCount: number;
}

function rgb01(c: any, fallback: [number, number, number]): [number, number, number] {
  if (!Array.isArray(c) || c.length < 3) return fallback;
  return [
    Math.max(0, Math.min(1, (c[0] ?? 0) / 255)),
    Math.max(0, Math.min(1, (c[1] ?? 0) / 255)),
    Math.max(0, Math.min(1, (c[2] ?? 0) / 255)),
  ];
}

function smokeRidersStyleTuning(style: string): SmokeRidersStyleTuning {
  if (style === 'ember') {
    return {
      emitters: 6,
      spawnY: -0.62,
      splatRadius: 0.075,
      splatVelocity: 0.9,
      densityDecay: 0.988,
      windX: 0.05,
      windY: 0.42,
      windZ: -0.03,
      turbScale: 3.4,
      spinX: -0.25,
      spinZ: 0.2,
      sizeScale: 0.72,
      colorCycle: 0.05,
      saturation: 1.25,
      sphereLayout: 'column',
      radiusVariance: 0.85,
      sphereSpread: 0.86,
      sphereDepth: 1.18,
      sphereSwirl: 0.82,
      spherePull: 0.1,
      sphereChaos: 0.52,
      sphereDamping: 1.9,
      rim: 0.62,
    };
  }
  if (style === 'pearlescent') {
    return {
      emitters: 4,
      spawnY: -0.18,
      splatRadius: 0.12,
      splatVelocity: 0.45,
      densityDecay: 0.994,
      windX: -0.03,
      windY: 0.1,
      windZ: 0.04,
      turbScale: 1.9,
      spinX: 0.1,
      spinZ: -0.12,
      sizeScale: 1.25,
      colorCycle: 0.012,
      saturation: 0.88,
      sphereLayout: 'cluster',
      radiusVariance: 0.58,
      sphereSpread: 1.0,
      sphereDepth: 1.0,
      sphereSwirl: 0.22,
      spherePull: 0.42,
      sphereChaos: 0.12,
      sphereDamping: 2.2,
      rim: 0.36,
    };
  }
  return {
    emitters: 5,
    spawnY: -0.38,
    splatRadius: 0.095,
    splatVelocity: 0.64,
    densityDecay: 0.991,
    windX: 0,
    windY: 0.18,
    windZ: 0,
    turbScale: 2.6,
    spinX: -0.2,
    spinZ: 0.08,
    sizeScale: 1,
    colorCycle: 0.028,
    saturation: 1.08,
    sphereLayout: 'orbital',
    radiusVariance: 0.72,
    sphereSpread: 1.08,
    sphereDepth: 1.32,
    sphereSwirl: 0.55,
    spherePull: 0.28,
    sphereChaos: 0.32,
    sphereDamping: 1.7,
    rim: 0.46,
  };
}

export function buildSmokeRidersInnerParams(
  params?: Record<string, any> | null,
  bands?: { bass?: number; treble?: number } | null,
): SmokeRidersInnerParams {
  const p = { ...smokeRidersParamDefaults, ...(params ?? {}) };
  const style = String(p.style ?? 'orbital');
  const quality = String(p.quality ?? 'balanced');
  const intensity = Number(p.intensity ?? 1);
  const reactive = !!p.audioReactive;
  const bass = reactive ? Math.min(1.8, Number(bands?.bass ?? 0) * Number(p.bassDrive ?? 1.2)) : 0;
  const treble = reactive ? Number(bands?.treble ?? 0) : 0;
  const colorA = rgb01(p.colorA, [0.28, 0.66, 1.0]);
  const colorB = rgb01(p.colorB, [1.0, 0.28, 0.62]);
  const colorC = rgb01(p.colorC, [1.0, 0.8, 0.36]);
  const colorD = rgb01(p.colorD, [0.47, 1.0, 0.87]);
  const smokeTint = rgb01(p.smokeColor, [0.07, 0.09, 0.18]);
  const gridSize = quality === 'ultra' ? 64 : quality === 'performance' ? 32 : 48;
  const countScale = quality === 'ultra' ? 1.25 : quality === 'performance' ? 0.55 : 1;
  const styleTuning = smokeRidersStyleTuning(style);
  const sphereCount = Math.max(24, Math.round(Number(p.sphereCount ?? 192) * countScale));
  const sphereSize = Number(p.sphereSize ?? 0.08) * styleTuning.sizeScale;

  return {
    smoke: {
      gridSize: gridSize as Smoke3DParams['gridSize'],
      emitterCount: styleTuning.emitters,
      spread: Number(p.smokeSpread ?? 0.42),
      spawnY: styleTuning.spawnY,
      splatRadius: styleTuning.splatRadius,
      splatStrength: (2.4 + bass * 1.8) * Math.max(0.1, intensity),
      splatVelocityMag: styleTuning.splatVelocity + bass * 0.35,
      splatRate: 42 + bass * 18,
      velocityDecay: 0.982,
      densityDecay: styleTuning.densityDecay,
      windX: styleTuning.windX,
      windY: styleTuning.windY,
      windZ: styleTuning.windZ,
      turbStrength: Number(p.smokeTurbulence ?? 0.85) + bass * 0.5,
      turbScale: styleTuning.turbScale,
      emission: Number(p.smokeGlow ?? 2.1) * (0.85 + intensity * 0.35),
      density: Number(p.smokeDensity ?? 2.75),
      fogColor: smokeTint,
      fogOpacity: 1,
      lightDirX: -0.35,
      lightDirY: 0.62,
      lightDirZ: 0.74,
      lightStrength: 0.75 + intensity * 0.16,
      lightColor: colorC,
      ambient: 0.18,
      shadowSteps: Math.round(Number(p.shadowSteps ?? 4)),
      shadowStepLen: 0.06,
      volumeScaleX: 1.72,
      volumeScaleZ: 1.25,
      fovDeg: Number(p.fovDeg ?? 48),
      cameraZ: Number(p.cameraZ ?? 2.85),
      rotateX: Number(p.rotateX ?? 0),
      rotateY: Number(p.rotateY ?? 0),
      rotateZ: Number(p.rotateZ ?? 0),
      autoRotateX: styleTuning.spinX,
      autoRotateY: Number(p.autoSpin ?? 4.5),
      autoRotateZ: styleTuning.spinZ,
      bass,
      treble,
      audioBurst: Number(p.bassDrive ?? 1.2),
      emitterColors: [colorA, colorB, colorC, colorD, colorA, colorB, colorC, colorD],
    },
    spheres: {
      layout: styleTuning.sphereLayout,
      sphereCount,
      radiusScale: sphereSize,
      radiusVariance: styleTuning.radiusVariance,
      spread: styleTuning.sphereSpread,
      depth: styleTuning.sphereDepth,
      opacity: Number(p.sphereOpacity ?? 0.92),
      fogDensity: 0.34 + Number(p.smokeDensity ?? 2.75) * 0.04,
      backgroundOpacity: 0,
      fogColor: smokeTint,
      clearBackground: false,
      lightX: -0.46,
      lightY: 0.72,
      lightZ: 1.08,
      lightStrength: 0.68 + intensity * 0.18,
      ambient: 0.24,
      diffuse: 1.05,
      specular: 0.45 + Number(p.sphereGloss ?? 0.7) * 0.9,
      shininess: 30 + Number(p.sphereGloss ?? 0.7) * 120,
      reflection: 0.12 + Number(p.sphereGloss ?? 0.7) * 0.25,
      rim: styleTuning.rim,
      colorCycle: styleTuning.colorCycle + bass * 0.02,
      saturation: styleTuning.saturation,
      brightness: 1.0 + intensity * 0.14,
      colorA: p.colorA,
      colorB: p.colorB,
      colorC: p.colorC,
      colorD: p.colorD,
      motion: Number(p.sphereMotion ?? 0.72),
      swirl: styleTuning.sphereSwirl,
      pull: styleTuning.spherePull,
      chaos: styleTuning.sphereChaos,
      damping: styleTuning.sphereDamping,
      audioReactive: !!p.audioReactive,
      bassPulse: Number(p.bassDrive ?? 1.2),
      trebleSparkle: Number(p.trebleShimmer ?? 0.025) * 10,
      fovDeg: Number(p.fovDeg ?? 48),
      cameraZ: Number(p.cameraZ ?? 2.85),
      rotateX: Number(p.rotateX ?? 0),
      rotateY: Number(p.rotateY ?? 0),
      rotateZ: Number(p.rotateZ ?? 0),
      autoRotateX: styleTuning.spinX * 0.45,
      autoRotateY: Number(p.autoSpin ?? 4.5) * 0.72,
      autoRotateZ: styleTuning.spinZ * 0.45,
    },
  };
}

function smokeRidersInitialState(): SmokeRidersNativeGraphState {
  return { smoke: null, spheres: null };
}

export function buildSmokeRidersNativeComputeGraph(options: SmokeRidersNativeGraphOptions): SmokeRidersNativeGraphBuildResult {
  const sourceId = String(options.sourceId || 'smoke-riders-native-source');
  const width = Math.round(options.width || 1920);
  const height = Math.round(options.height || 1080);
  const time = Math.max(0, Number.isFinite(options.time) ? Number(options.time) : 0);
  const frameDelta = typeof options.frameDelta === 'number' && Number.isFinite(options.frameDelta)
    ? options.frameDelta
    : 1 / 60;
  const frameIndex = Math.max(0, Math.round(options.frameIndex ?? 0));
  const prevState = options.state ?? smokeRidersInitialState();
  const mapped = buildSmokeRidersInnerParams(options.params ?? {}, {
    bass: options.audioBass ?? 0,
    treble: options.audioTreble ?? 0,
  });

  const smokeGraph = buildSmoke3DNativeComputeGraph({
    sourceId,
    params: mapped.smoke,
    width,
    height,
    time,
    frameDelta,
    frameIndex,
    state: prevState.smoke,
    reset: !!options.reset || !prevState.smoke,
    includeSnapshot: false,
  });
  const sphereGraph = buildVolumetricSpheresNativeComputeGraph({
    sourceId,
    params: mapped.spheres,
    width,
    height,
    time,
    frameDelta,
    frameIndex,
    state: prevState.spheres,
    reset: !!options.reset || !prevState.spheres,
    includeSnapshot: !!options.includeSnapshot,
  });

  const smokeRender = {
    ...(smokeGraph.config.render as Record<string, any>),
    source_id: sourceId,
    seq: frameIndex,
    clear: true,
    include_snapshot: false,
    blend: 'replace',
  };
  const sphereRenderPasses = sphereGraph.config.render_passes.map((pass, index, passes) => {
    const rest = { ...(pass as Record<string, any>) };
    delete rest.clear_color;
    return {
      ...rest,
      source_id: sourceId,
      seq: frameIndex,
      clear: false,
      include_snapshot: !!options.includeSnapshot && index === passes.length - 1,
    };
  });

  return {
    config: {
      buffers: [...smokeGraph.config.buffers, ...sphereGraph.config.buffers],
      passes: [...smokeGraph.config.passes, ...sphereGraph.config.passes],
      render_passes: [smokeRender, ...sphereRenderPasses],
      readbacks: [],
    },
    sourceId,
    state: {
      smoke: smokeGraph.state,
      spheres: sphereGraph.state,
    },
    passCount: smokeGraph.passCount + sphereGraph.passCount + 1,
  };
}

export class WebGPUSmokeRidersShader implements GpuShaderImpl {
  private smoke: WebGPU3DSmoke;
  private particles: WebGPUVolumetricSpheresShader;
  private bands: Bands | null = null;
  private smoothedBands: Bands = { bass: 0, mid: 0, treble: 0 };
  private lastBandTime = 0;
  private lastParams: Record<string, any> = { ...smokeRidersParamDefaults };

  constructor(device: any, presentFormat: any) {
    this.smoke = new WebGPU3DSmoke(device, presentFormat);
    this.particles = new WebGPUVolumetricSpheresShader(device, presentFormat);
    this.applyParams();
  }

  setBands(bass: number, mid: number, treble: number): void {
    const now = performance.now() / 1000;
    const dt = this.lastBandTime === 0
      ? 1 / 60
      : Math.min(Math.max(now - this.lastBandTime, 1 / 240), 0.25);
    this.lastBandTime = now;

    const smoothing = 0.86;
    const attack = 1 - Math.pow(smoothing, dt * 90);
    const release = 1 - Math.pow(smoothing, dt * 26);
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
    this.applyParams();
  }

  setParams(params: Record<string, any>): void {
    this.lastParams = { ...smokeRidersParamDefaults, ...params };
    this.applyParams();
  }

  encodeFrame(encoder: any, targetView: any, format: any, width: number, height: number, dt: number, time?: number): void {
    this.smoke.setViewport(width, height);
    this.particles.resize(width, height);

    const clearPass = encoder.beginRenderPass({
      colorAttachments: [{
        view: targetView,
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    clearPass.end();

    this.smoke.encodeFrame(encoder, targetView, time, dt);
    this.particles.encodeFrame(encoder, targetView, format, width, height, dt, time);
  }

  resize(_width: number, _height: number): void {
    // Both inner renderers receive viewport dimensions per frame.
  }

  getDebugStats(): Record<string, any> {
    return {
      instrument: 'smoke-riders',
      smoke: this.smoke.getDebugStats(),
      particles: typeof (this.particles as any).getDebugStats === 'function'
        ? (this.particles as any).getDebugStats()
        : { instrument: 'volumetric-spheres' },
    };
  }

  dispose(): void {
    try { this.smoke.dispose(); } catch { /* */ }
    try { this.particles.dispose(); } catch { /* */ }
  }

  private applyParams(): void {
    const mapped = buildSmokeRidersInnerParams(this.lastParams, this.bands);
    this.smoke.setParams(mapped.smoke);
    this.particles.setParams(mapped.spheres);
  }
}
