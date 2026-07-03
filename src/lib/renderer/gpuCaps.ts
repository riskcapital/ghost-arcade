export type GhostGpuQualityTier = 'ultra' | 'high' | 'balanced' | 'low';

export interface GhostGpuLimits {
  maxTextureDimension1D: number;
  maxTextureDimension2D: number;
  maxTextureDimension3D: number;
  maxTextureArrayLayers: number;
  maxBindGroups: number;
  maxBindingsPerBindGroup: number;
  maxBufferSize: number;
  maxStorageBufferBindingSize: number;
  maxComputeInvocationsPerWorkgroup: number;
  maxComputeWorkgroupSizeX: number;
  maxComputeWorkgroupSizeY: number;
  maxComputeWorkgroupSizeZ: number;
}

export interface GhostGpuQualityProfile {
  tier: GhostGpuQualityTier;
  label: string;
  renderScale: number;
  particleBudget: number;
  splatBudget: number;
  volumeGrid: number;
  raymarchSteps: number;
  pressureIterations: number;
  bloomScale: number;
  useHdr: boolean;
  useSelfShadow: boolean;
}

export interface GhostGpuCaps {
  supported: boolean;
  description: string;
  vendor: string | null;
  architecture: string | null;
  device: string | null;
  presentFormat: string;
  features: string[];
  limits: GhostGpuLimits;
  isFallbackAdapter: boolean;
  shaderF16: boolean;
  timestampQuery: boolean;
  textureCompressionBC: boolean;
  float32Filterable: boolean;
  qualityTier: GhostGpuQualityTier;
  quality: GhostGpuQualityProfile;
  probedAt: number;
}

export const GHOST_GPU_QUALITY_PROFILES: Readonly<Record<GhostGpuQualityTier, GhostGpuQualityProfile>> = Object.freeze({
  ultra: Object.freeze({
    tier: 'ultra',
    label: 'Ultra',
    renderScale: 1,
    particleBudget: 1_000_000,
    splatBudget: 2_000_000,
    volumeGrid: 128,
    raymarchSteps: 96,
    pressureIterations: 32,
    bloomScale: 0.5,
    useHdr: true,
    useSelfShadow: true,
  }),
  high: Object.freeze({
    tier: 'high',
    label: 'High',
    renderScale: 1,
    particleBudget: 500_000,
    splatBudget: 1_000_000,
    volumeGrid: 96,
    raymarchSteps: 72,
    pressureIterations: 24,
    bloomScale: 0.5,
    useHdr: true,
    useSelfShadow: true,
  }),
  balanced: Object.freeze({
    tier: 'balanced',
    label: 'Balanced',
    renderScale: 0.85,
    particleBudget: 250_000,
    splatBudget: 500_000,
    volumeGrid: 64,
    raymarchSteps: 56,
    pressureIterations: 18,
    bloomScale: 0.5,
    useHdr: true,
    useSelfShadow: false,
  }),
  low: Object.freeze({
    tier: 'low',
    label: 'Live Saver',
    renderScale: 0.7,
    particleBudget: 100_000,
    splatBudget: 200_000,
    volumeGrid: 48,
    raymarchSteps: 40,
    pressureIterations: 12,
    bloomScale: 0.35,
    useHdr: false,
    useSelfShadow: false,
  }),
});

const DEFAULT_LIMITS: GhostGpuLimits = {
  maxTextureDimension1D: 8192,
  maxTextureDimension2D: 8192,
  maxTextureDimension3D: 256,
  maxTextureArrayLayers: 256,
  maxBindGroups: 4,
  maxBindingsPerBindGroup: 640,
  maxBufferSize: 256 * 1024 * 1024,
  maxStorageBufferBindingSize: 128 * 1024 * 1024,
  maxComputeInvocationsPerWorkgroup: 256,
  maxComputeWorkgroupSizeX: 256,
  maxComputeWorkgroupSizeY: 256,
  maxComputeWorkgroupSizeZ: 64,
};

function readLimit(limits: any, key: keyof GhostGpuLimits): number {
  const value = Number(limits?.[key]);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_LIMITS[key];
}

function adapterFeatures(adapter: any): string[] {
  const features: string[] = [];
  try {
    const set = adapter?.features;
    if (set && typeof set.forEach === 'function') {
      set.forEach((feature: string) => features.push(feature));
    }
  } catch {
    // Some WebGPU implementations expose a partial adapter shape.
  }
  return Array.from(new Set(features)).sort();
}

function adapterInfo(adapter: any): any {
  return adapter?.info ?? {};
}

export function inferGhostGpuQualityTier(
  limits: GhostGpuLimits,
  features: Iterable<string>,
  isFallbackAdapter = false,
): GhostGpuQualityTier {
  if (isFallbackAdapter) return 'low';
  const featureSet = new Set(features);
  let score = 0;
  if (limits.maxStorageBufferBindingSize >= 512 * 1024 * 1024) score += 2;
  else if (limits.maxStorageBufferBindingSize >= 192 * 1024 * 1024) score += 1;
  if (limits.maxBufferSize >= 1_000_000_000) score += 1;
  if (limits.maxTextureDimension2D >= 8192) score += 1;
  if (limits.maxTextureDimension3D >= 512) score += 1;
  if (limits.maxComputeInvocationsPerWorkgroup >= 256) score += 1;
  if (featureSet.has('shader-f16')) score += 1;
  if (featureSet.has('timestamp-query')) score += 1;

  if (score >= 7) return 'ultra';
  if (score >= 5) return 'high';
  if (score >= 3) return 'balanced';
  return 'low';
}

export function buildGhostGpuCaps(adapter: any, _device: any, presentFormat: string): GhostGpuCaps {
  const info = adapterInfo(adapter);
  const features = adapterFeatures(adapter);
  const featureSet = new Set(features);
  const rawLimits = adapter?.limits ?? {};
  const limits: GhostGpuLimits = {
    maxTextureDimension1D: readLimit(rawLimits, 'maxTextureDimension1D'),
    maxTextureDimension2D: readLimit(rawLimits, 'maxTextureDimension2D'),
    maxTextureDimension3D: readLimit(rawLimits, 'maxTextureDimension3D'),
    maxTextureArrayLayers: readLimit(rawLimits, 'maxTextureArrayLayers'),
    maxBindGroups: readLimit(rawLimits, 'maxBindGroups'),
    maxBindingsPerBindGroup: readLimit(rawLimits, 'maxBindingsPerBindGroup'),
    maxBufferSize: readLimit(rawLimits, 'maxBufferSize'),
    maxStorageBufferBindingSize: readLimit(rawLimits, 'maxStorageBufferBindingSize'),
    maxComputeInvocationsPerWorkgroup: readLimit(rawLimits, 'maxComputeInvocationsPerWorkgroup'),
    maxComputeWorkgroupSizeX: readLimit(rawLimits, 'maxComputeWorkgroupSizeX'),
    maxComputeWorkgroupSizeY: readLimit(rawLimits, 'maxComputeWorkgroupSizeY'),
    maxComputeWorkgroupSizeZ: readLimit(rawLimits, 'maxComputeWorkgroupSizeZ'),
  };
  const isFallbackAdapter = !!adapter?.isFallbackAdapter;
  const qualityTier = inferGhostGpuQualityTier(limits, features, isFallbackAdapter);
  const description = info?.description
    || [info?.vendor, info?.architecture].filter(Boolean).join(' ')
    || 'unknown WebGPU adapter';

  return {
    supported: true,
    description,
    vendor: info?.vendor ?? null,
    architecture: info?.architecture ?? null,
    device: info?.device ?? null,
    presentFormat,
    features,
    limits,
    isFallbackAdapter,
    shaderF16: featureSet.has('shader-f16'),
    timestampQuery: featureSet.has('timestamp-query'),
    textureCompressionBC: featureSet.has('texture-compression-bc'),
    float32Filterable: featureSet.has('float32-filterable'),
    qualityTier,
    quality: GHOST_GPU_QUALITY_PROFILES[qualityTier],
    probedAt: Date.now(),
  };
}

export interface GhostGpuFrameBudget {
  targetMs: number;
  warnMs: number;
  panicMs: number;
}

export interface GhostGpuGovernorSnapshot {
  averageMs: number;
  qualityScale: number;
  suggestedTier: GhostGpuQualityTier;
  overBudgetFrames: number;
  underBudgetFrames: number;
}

const TIER_ORDER: GhostGpuQualityTier[] = ['low', 'balanced', 'high', 'ultra'];

function stepTier(tier: GhostGpuQualityTier, delta: number): GhostGpuQualityTier {
  const i = Math.max(0, Math.min(TIER_ORDER.length - 1, TIER_ORDER.indexOf(tier) + delta));
  return TIER_ORDER[i];
}

export class GhostGpuAdaptiveGovernor {
  private emaMs = 0;
  private overBudgetFrames = 0;
  private underBudgetFrames = 0;
  private suggestedTier: GhostGpuQualityTier;
  private qualityScale = 1;

  constructor(initialTier: GhostGpuQualityTier, private budget: GhostGpuFrameBudget = {
    targetMs: 16.67,
    warnMs: 20,
    panicMs: 28,
  }) {
    this.suggestedTier = initialTier;
  }

  recordFrame(frameMs: number): GhostGpuGovernorSnapshot {
    const ms = Math.max(0, frameMs);
    this.emaMs = this.emaMs === 0 ? ms : this.emaMs * 0.92 + ms * 0.08;

    if (this.emaMs > this.budget.panicMs) {
      this.overBudgetFrames += 2;
      this.underBudgetFrames = 0;
    } else if (this.emaMs > this.budget.warnMs) {
      this.overBudgetFrames += 1;
      this.underBudgetFrames = 0;
    } else if (this.emaMs < this.budget.targetMs * 0.72) {
      this.underBudgetFrames += 1;
      this.overBudgetFrames = 0;
    } else {
      this.overBudgetFrames = Math.max(0, this.overBudgetFrames - 1);
      this.underBudgetFrames = Math.max(0, this.underBudgetFrames - 1);
    }

    if (this.overBudgetFrames >= 45) {
      this.suggestedTier = stepTier(this.suggestedTier, -1);
      this.qualityScale = Math.max(0.5, this.qualityScale * 0.9);
      this.overBudgetFrames = 0;
    } else if (this.underBudgetFrames >= 240) {
      this.suggestedTier = stepTier(this.suggestedTier, 1);
      this.qualityScale = Math.min(1, this.qualityScale * 1.05);
      this.underBudgetFrames = 0;
    }

    return this.snapshot;
  }

  get snapshot(): GhostGpuGovernorSnapshot {
    return {
      averageMs: this.emaMs,
      qualityScale: this.qualityScale,
      suggestedTier: this.suggestedTier,
      overBudgetFrames: this.overBudgetFrames,
      underBudgetFrames: this.underBudgetFrames,
    };
  }
}
