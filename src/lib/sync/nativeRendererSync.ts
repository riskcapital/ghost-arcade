import { get } from 'svelte/store';
import type { Layer } from '$lib/types';
import { project } from '$lib/stores/layers';
import { mediaLibrary, type MediaItem } from '$lib/stores/media';
import {
  resetNativeRendererRuntime,
  updateNativeRendererRuntimeFromStartup,
  updateNativeRendererRuntimeFromStatus,
} from '$lib/stores/nativeRenderer';
import { invoke, isElectron, isMac, isWindows } from '$lib/bridge';
import { getVisualAudioSnapshot, visualAudio, type VisualAudioState } from '$lib/audio/visualAudio';
import { ghostAudioCommandFieldsFromVisualAudio } from '$lib/audio/ghostAudioUniform';
import { WGSL_STDLIB, resolveGhostWgsl } from '$lib/renderer/wgsl';
import { gravityWellsDefaultParams } from '$lib/renderer/gpuShaderCatalog';
import {
  receiveSpoutTextureInfo,
  type SpoutSharedTextureInfo,
} from '$lib/renderer/spoutCanvasReceiver';
import {
  buildPlanetNativeComputeGraph,
  buildPlanetNativePrecompileCommands,
  type PlanetNativeGraphState,
} from '$lib/renderer/shaders/webgpuPlanet';
import {
  buildSmoke3DNativeComputeGraph,
  buildSmoke3DNativePrecompileCommands,
  type Smoke3DNativeGraphState,
} from '$lib/renderer/webgpu3DSmoke';
import {
  buildInkCloudNativeComputeGraph,
  buildInkCloudNativePrecompileCommands,
  type InkCloudNativeGraphState,
} from '$lib/renderer/webgpuInkCloud';
import {
  buildParticleFieldNativeComputeGraph,
  buildParticleFieldNativePrecompileCommands,
  type ParticleFieldNativeGraphState,
} from '$lib/renderer/webgpuParticleField';
import {
  buildPixelParticlesNativeComputeGraph,
  buildPixelParticlesNativePrecompileCommands,
  type PixelParticlesNativeGraphState,
} from '$lib/renderer/webgpuPixelParticles';
import {
  buildPointCloudFXNativeComputeGraph,
  buildPointCloudFXNativePointData,
  buildPointCloudFXNativePrecompileCommands,
  type PointCloudFXNativeGraphState,
  type PointCloudFXNativePointData,
} from '$lib/renderer/webgpuPointCloudFX';
import {
  buildFlythroughNativeComputeGraph,
  buildFlythroughNativePrecompileCommands,
  type FlythroughNativeGraphState,
} from '$lib/renderer/webgpuFlythrough';
import {
  buildSmokeRidersNativeComputeGraph,
  type SmokeRidersNativeGraphState,
} from '$lib/renderer/shaders/webgpuSmokeRidersShader';
import {
  buildVolumetricSpheresNativeComputeGraph,
  buildVolumetricSpheresNativePrecompileCommands,
  type VolumetricSpheresNativeGraphState,
} from '$lib/renderer/shaders/webgpuVolumetricSpheresShader';
import {
  NATIVE_EFFECT_PASS_MANIFEST,
  buildNativeEffectPassChainGraph,
  buildNativeEffectPassPrecompileCommands,
  type NativeEffectPassId,
  type NativeEffectPassOptions,
} from '$lib/renderer/nativeEffectPass';
import { parsePLYBuffer } from '$lib/splat/plyLoader';
import { parseSplatBuffer } from '$lib/splat/splatLoader';
import {
  attachNativeRendererOutputWindow,
  clearNativeRendererDecodePreviewCache,
  clearNativeRendererRuntimeCaches,
  detachNativeRendererOutputWindow,
  getNativeRendererCapabilities,
  getNativeRendererReadinessReport,
  getNativeRendererStatus,
  prefetchNativeRendererMedia,
  resetNativeRendererStats,
  runNativeRendererComputeGraph,
  setNativeRendererDecodeCpuBackupPolicy,
  setNativeRendererDecodeSyntheticFallbackPolicy,
  setNativeRendererDecodePreviewPolicy,
  setNativeRendererDecodeTargetPolicy,
  setNativeRendererDecodeUploadPolicy,
  setNativeRendererDecodeHandoffPolicy,
  setNativeRendererDecodeEstimateCachePolicy,
  setNativeRendererAutoPresentPolicy,
  setNativeRendererCommandDrainPolicy,
  setNativeRendererMediaDropPolicy,
  setNativeRendererMediaPrefetchPolicy,
  setNativeRendererPresentPolicy,
  setNativeRendererShaderPrecompilePolicy,
  setNativeRendererTargetFps,
  setNativeRendererTexturePoolCap,
  startNativeRenderer,
  stopNativeRenderer,
  submitNativeRendererBatch,
  submitNativeRendererCommands,
  type RendererStatus,
  type NativeRendererCapabilities,
  type RendererReadinessReport,
  type NativeCommandApplySummary,
  type CommandBatch,
  type RendererCommand,
  type PresentPolicyConfig,
  type BackendKind,
  type DecodeBackendKind,
} from '$lib/api/native-renderer';

type LayerSnapshot = {
  id: string;
  z: number;
  vjIndex: number | null;
  visible: boolean;
  blend: string;
  opacity: number;
  geometrySig: string;
  uvSig: string;
  shapeSig: string;
  sourceSig: string;
  nativeParamsSig: string;
  effectsSig: string;
  colorSig: string;
};

type NativeLayerSource = {
  id: string;
  uri: string;
  sourceType: string;
  source: NonNullable<Layer['source']> | null;
  shouldPrefetch: boolean;
  shouldPreview: boolean;
  previewElement?: CanvasImageSource | null;
  aspect?: number;
};

type NativeVec4 = [number, number, number, number];

type NativeLayerUvState = {
  uvTransform: NativeVec4;
  uvFlags: NativeVec4;
  signature: string;
};

type SharedTextureInfoCacheEntry = {
  info: SpoutSharedTextureInfo;
  updatedAt: number;
};

type SharedTextureUploadState = {
  sourceId: string;
  signature: string;
  seq: number;
  previousSignature: string | undefined;
  previousSeq: number | undefined;
  submittedAt: number;
};

type NativeImageDecodeState = {
  sourceId: string;
  signature: string;
  seq: number;
  previousSignature: string | undefined;
  previousSeq: number | undefined;
  submittedAt: number;
};

type NativeLayerShapeState = {
  shape: NativeVec4;
  signature: string;
};

type NativeRenderClockCommand = {
  type: 'set_render_clock';
  mode: 'live' | 'manual' | 'reset';
  time?: number;
  time_delta?: number;
  frame_index?: number;
};

export type PresentPolicyProfile = 'vsync-live' | 'low-latency-safe' | 'low-latency-aggressive';

type NativeGraphRouteKind = 'planet' | 'smoke-3d' | 'particle-field' | 'volumetric-spheres' | 'smoke-riders' | 'ink-cloud' | 'flythrough' | 'pixel-particles' | 'point-cloud-fx' | 'effect-pass';
export type NativeEffectPassRuntime = {
  effect: NativeEffectPassId;
  descriptor: string;
  amount?: number;
  params?: NativeEffectPassOptions['params'];
};
export type NativeGraphRouteRequirement = {
  kind: NativeGraphRouteKind;
  feature: string;
  instrument: string;
  shaderIds: readonly string[];
};
const NATIVE_GRAPH_ROUTE_REQUIREMENTS: ReadonlyArray<NativeGraphRouteRequirement> = [
  { kind: 'planet', feature: 'native_planet_graph', instrument: 'planet', shaderIds: ['planet/render'] },
  {
    kind: 'smoke-3d',
    feature: 'native_3d_smoke_graph',
    instrument: 'smoke-3d',
    shaderIds: [
      '3d-smoke/splat',
      '3d-smoke/advect-velocity',
      '3d-smoke/divergence',
      '3d-smoke/jacobi',
      '3d-smoke/subtract-gradient',
      '3d-smoke/advect-density',
      '3d-smoke/render',
    ],
  },
  {
    kind: 'particle-field',
    feature: 'native_particle_field_graph',
    instrument: 'particle-field',
    shaderIds: [
      'particle-field/behavior',
      'particle-field/edges',
      'particle-field/fog',
      'particle-field/render',
      'particle-field/lines',
    ],
  },
  {
    kind: 'volumetric-spheres',
    feature: 'native_volumetric_spheres_graph',
    instrument: 'volumetric-spheres',
    shaderIds: ['volumetric-spheres/sim', 'volumetric-spheres/render'],
  },
  {
    kind: 'smoke-riders',
    feature: 'native_smoke_riders_graph',
    instrument: 'smoke-riders',
    shaderIds: [
      '3d-smoke/splat',
      '3d-smoke/advect-velocity',
      '3d-smoke/divergence',
      '3d-smoke/jacobi',
      '3d-smoke/subtract-gradient',
      '3d-smoke/advect-density',
      '3d-smoke/render',
      'volumetric-spheres/sim',
      'volumetric-spheres/render',
    ],
  },
  {
    kind: 'ink-cloud',
    feature: 'native_ink_cloud_graph',
    instrument: 'ink-cloud',
    shaderIds: ['ink-cloud/sim', 'ink-cloud/render', 'ink-cloud/background'],
  },
  {
    kind: 'flythrough',
    feature: 'native_flythrough_graph',
    instrument: 'flythrough',
    shaderIds: ['flythrough/compute', 'flythrough/render'],
  },
  {
    kind: 'pixel-particles',
    feature: 'native_pixel_particles_graph',
    instrument: 'pixel-particles',
    shaderIds: ['pixel-particles/compute', 'pixel-particles/render'],
  },
  {
    kind: 'point-cloud-fx',
    feature: 'native_point_cloud_fx_graph',
    instrument: 'point-cloud-fx',
    shaderIds: [
      'point-cloud-fx/compute',
      'point-cloud-fx/sort-fill',
      'point-cloud-fx/sort-step',
      'point-cloud-fx/render',
    ],
  },
] as const;

export function nativeGraphRouteRequirements(): ReadonlyArray<NativeGraphRouteRequirement> {
  return NATIVE_GRAPH_ROUTE_REQUIREMENTS;
}

type NativeGraphRouteSimulationState =
  | PlanetNativeGraphState
  | Smoke3DNativeGraphState
  | InkCloudNativeGraphState
  | ParticleFieldNativeGraphState
  | VolumetricSpheresNativeGraphState
  | SmokeRidersNativeGraphState
  | FlythroughNativeGraphState
  | PixelParticlesNativeGraphState
  | PointCloudFXNativeGraphState;

type NativeGraphLayerRoute = {
  kind: NativeGraphRouteKind;
  key: string;
  baseSource?: NativeLayerSource;
  source: NativeLayerSource;
  inputSource: NativeLayerSource | null;
  effectPasses?: NativeEffectPassRuntime[];
};

type NativeGraphRouteState = {
  inFlight: boolean;
  seq: number;
  warnings: number;
  state: NativeGraphRouteSimulationState | null;
  bufferPrefixes: string[];
  lastGraphFrameIndex?: number;
  lastManualClockKey?: string;
};

type NativeGraphManifestEntry = NonNullable<NativeRendererCapabilities['native_graph_instrument_manifest']>[number];

export function nativeGraphInstrumentIds(capabilities: NativeRendererCapabilities | null | undefined): string[] {
  const ids = new Set<string>();
  for (const id of capabilities?.native_graph_instruments ?? []) {
    const normalized = String(id).trim().toLowerCase();
    if (normalized) ids.add(normalized);
  }
  for (const entry of capabilities?.native_graph_instrument_manifest ?? []) {
    const normalized = String(entry?.id ?? '').trim().toLowerCase();
    if (normalized) ids.add(normalized);
  }
  return Array.from(ids);
}

export function nativeGraphManifestById(
  capabilities: NativeRendererCapabilities | null | undefined,
): Map<string, NativeGraphManifestEntry> {
  const entries = new Map<string, NativeGraphManifestEntry>();
  for (const entry of capabilities?.native_graph_instrument_manifest ?? []) {
    const normalized = String(entry?.id ?? '').trim().toLowerCase();
    if (normalized) entries.set(normalized, entry);
  }
  return entries;
}

export function nativeEffectPassDescriptorIds(capabilities: NativeRendererCapabilities | null | undefined): string[] {
  const ids = new Set<string>();
  for (const entry of capabilities?.native_effect_pass_descriptors ?? []) {
    const normalized = String(entry?.id ?? '').trim().toLowerCase();
    if (normalized) ids.add(normalized);
  }
  return Array.from(ids);
}

export function missingNativeGraphRouteRequirements(
  features: Record<string, boolean>,
  instruments: ReadonlySet<string>,
  manifest: ReadonlyMap<string, NativeGraphManifestEntry>,
): string[] {
  const missing: string[] = [];
  for (const requirement of NATIVE_GRAPH_ROUTE_REQUIREMENTS) {
    missing.push(...nativeGraphRouteRequirementErrors(requirement, features, instruments, manifest));
  }
  return missing;
}

export function nativeGraphReadyRouteKinds(
  features: Record<string, boolean>,
  instruments: ReadonlySet<string>,
  manifest: ReadonlyMap<string, NativeGraphManifestEntry>,
): Set<NativeGraphRouteKind> {
  return new Set(
    NATIVE_GRAPH_ROUTE_REQUIREMENTS
      .filter((requirement) =>
        nativeGraphRouteRequirementErrors(requirement, features, instruments, manifest).length === 0,
      )
      .map((requirement) => requirement.kind),
  );
}

function nativeGraphRouteRequirementErrors(
  requirement: (typeof NATIVE_GRAPH_ROUTE_REQUIREMENTS)[number],
  features: Record<string, boolean>,
  instruments: ReadonlySet<string>,
  manifest: ReadonlyMap<string, NativeGraphManifestEntry>,
): string[] {
  const missing: string[] = [];
  if (!features[requirement.feature]) missing.push(`${requirement.kind}:feature:${requirement.feature}`);
  if (!instruments.has(requirement.instrument)) {
    missing.push(`${requirement.kind}:instrument:${requirement.instrument}`);
  }
  const entry = manifest.get(requirement.instrument);
  if (!entry) {
    missing.push(`${requirement.kind}:manifest:${requirement.instrument}`);
    return missing;
  }
  if (entry.render_target !== 'source_frame') {
    missing.push(`${requirement.kind}:render_target:source_frame`);
  }
  if (entry.source_uri_prefix !== `native-graph://${requirement.instrument}/`) {
    missing.push(`${requirement.kind}:source_uri_prefix:${requirement.instrument}`);
  }
  const manifestFeatures = new Set((entry.features ?? []).map(String));
  if (!manifestFeatures.has(requirement.feature)) {
    missing.push(`${requirement.kind}:manifest_feature:${requirement.feature}`);
  }
  const manifestShaderIds = new Set((entry.shader_ids ?? []).map(String));
  for (const shaderId of requirement.shaderIds) {
    if (!manifestShaderIds.has(shaderId)) missing.push(`${requirement.kind}:shader:${shaderId}`);
  }
  return missing;
}

const SOURCE_PREVIEW_SIZE = 256;
const SOURCE_FRAME_SIZE_FALLBACK = 2048;
const SOURCE_FRAME_SIZE_OVERLOAD = 1536;
const SOURCE_FRAME_DYNAMIC_CAPTURE_MAX = 2048;
const STATIC_PREVIEW_RETRY_MS = 1000;
const VIDEO_PREVIEW_REFRESH_MS = 360;
const NATIVE_VIDEO_PREFETCH_REFRESH_MS = 750;
const NATIVE_VIDEO_PREFETCH_OVERLOAD_REFRESH_MS = 1200;
const NATIVE_VIDEO_PREFETCH_WINDOW_FRAMES = 1;
const NATIVE_VIDEO_PREFETCH_WINDOW_FPS = 30;
const GPU_PREVIEW_REFRESH_MS = 700;
const NATIVE_POINT_CLOUD_MAX_POINTS = 500_000;

type PreviewFlushBudget = {
  staticRemaining: number;
  dynamicRemaining: number;
};

const GENERATED_LAYER_TEXTURE_KEYS = [
  '_textTexture',
  '_model3dTexture',
  '_lightPaintingGPUTexture',
  '_lightPaintingTexture',
  '_svgTexture',
  '_linesTexture',
  '_splatTexture',
] as const;

const GENERATED_LAYER_TYPES = new Set([
  'text',
  'model3d',
  'lightpainting',
  'svg',
  'lines',
  'splat',
]);

function canonicalBlendMode(mode: string): string {
  const m = String(mode || '').trim().toLowerCase();
  if (m === 'plus' || m === 'linear_dodge' || m === 'linear-dodge' || m === 'lineardodge') return 'add';
  if (m === 'minus' || m === 'linear_burn' || m === 'linear-burn' || m === 'linearburn') return 'subtract';
  if (m === 'hard_light' || m === 'hard-light') return 'hardlight';
  if (m === 'soft_light' || m === 'soft-light') return 'softlight';
  if (m === 'pin_light' || m === 'pin-light') return 'pin-light';
  if (m === 'vivid_light' || m === 'vivid-light') return 'vivid-light';
  if (m === 'linearlight' || m === 'linear_light') return 'linear-light';
  if (m === 'hardmix' || m === 'hard_mix') return 'hard-mix';
  if (m === 'avg') return 'average';
  if (m === 'color_dodge' || m === 'colordodge' || m === 'dodge') return 'color-dodge';
  if (m === 'color_burn' || m === 'colorburn' || m === 'burn') return 'color-burn';
  if (m === 'luma') return 'luminosity';
  return m || 'normal';
}

function hashString(input: string): string {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

function drawableDimensions(element: CanvasImageSource): { width: number; height: number } | null {
  if (typeof HTMLVideoElement !== 'undefined' && element instanceof HTMLVideoElement) {
    const width = element.videoWidth || element.clientWidth;
    const height = element.videoHeight || element.clientHeight;
    return width > 0 && height > 0 ? { width, height } : null;
  }
  if (typeof HTMLImageElement !== 'undefined' && element instanceof HTMLImageElement) {
    const width = element.naturalWidth || element.width;
    const height = element.naturalHeight || element.height;
    return width > 0 && height > 0 ? { width, height } : null;
  }
  if (typeof HTMLCanvasElement !== 'undefined' && element instanceof HTMLCanvasElement) {
    return element.width > 0 && element.height > 0
      ? { width: element.width, height: element.height }
      : null;
  }
  if (typeof ImageBitmap !== 'undefined' && element instanceof ImageBitmap) {
    return element.width > 0 && element.height > 0
      ? { width: element.width, height: element.height }
      : null;
  }
  if (typeof OffscreenCanvas !== 'undefined' && element instanceof OffscreenCanvas) {
    return element.width > 0 && element.height > 0
      ? { width: element.width, height: element.height }
      : null;
  }
  return null;
}

function asDrawableElement(value: unknown): CanvasImageSource | null {
  if (!value) return null;
  const candidate = value as CanvasImageSource;
  return drawableDimensions(candidate) ? candidate : null;
}

function textureDrawableElement(texture: unknown): CanvasImageSource | null {
  const tex = texture as any;
  const candidates = [
    tex?.image,
    tex?.source?.data,
    tex?.canvas,
  ];
  for (const candidate of candidates) {
    const drawable = asDrawableElement(candidate);
    if (drawable) return drawable;
  }
  return null;
}

function generatedLayerPreview(layer: Layer): { key: string; element: CanvasImageSource; signature: string; sourceType: string } | null {
  const anyLayer = layer as any;
  for (const key of GENERATED_LAYER_TEXTURE_KEYS) {
    const element = textureDrawableElement(anyLayer[key]);
    if (!element) continue;
    const dims = drawableDimensions(element);
    if (!dims) continue;
    const sourceLabel = key.replace(/^_/, '').replace(/Texture$/, '').toLowerCase();
    return {
      key,
      element,
      signature: `generated:${layer.type}:${key}:${dims.width}x${dims.height}`,
      sourceType: `generated:${layer.type}:${sourceLabel}`,
    };
  }
  return null;
}

function sourceSignature(layer: Layer): string {
  const s = layer.source;
  if (!s && layer.type === 'gpu' && layer.gpuLayerContent) {
    const c = layer.gpuLayerContent;
    return `gpu:${c.shaderId || 'gpu'}`;
  }
  if (!s) {
    return generatedLayerPreview(layer)?.signature ?? 'none';
  }
  return `${s.type}:${s.id}:${s.src}:${s.name}:${s.shaderCode ? hashString(s.shaderCode) : 'no-shader'}`;
}

function nativeEffectDescriptors(layer: Layer): string[] {
  const effects = layer.effects || [];
  if (!effects.length) return [];
  return effects
    .filter((e: any) => e && e.enabled !== false)
    .map((e: any) => effectToNativeDescriptor(e))
    .filter((d: string | null): d is string => !!d);
}

const NATIVE_EFFECT_PASS_IDS = new Set<NativeEffectPassId>(
  NATIVE_EFFECT_PASS_MANIFEST.map((entry) => entry.id),
);

const HEARTBEAT_NATIVE_EFFECT_IDS = new Set([
  'invert',
  'grayscale',
  'greyscale',
  'brightness',
  'contrast',
  'gamma',
  'saturation',
  'hue',
  'posterize',
  'noise',
]);

function nativeHeartbeatEffectDescriptors(layer: Layer): string[] {
  return nativeEffectDescriptors(layer).filter((descriptor) => {
    const effectId = descriptor.split(':', 1)[0]?.trim().toLowerCase() ?? '';
    return HEARTBEAT_NATIVE_EFFECT_IDS.has(effectId);
  });
}

function normalizeSignedUnitToMultiplier(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value >= -1 && value <= 1) return Math.max(0.001, 1 + value);
  return Math.max(0.001, value);
}

function normalizeNonNegative(value: unknown, fallback = 1): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(0.001, value);
}

function normalizeHueCycle(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value >= -1 && value <= 1) return value;
  return value / 360;
}

export function effectToNativeDescriptor(effect: any): string | null {
  if (!effect || effect.enabled === false) return null;
  const type = String(effect.type || '').toLowerCase();
  const params = effect.params || {};
  if (!type) return null;

  if (type === 'invert') return 'invert';
  if (type === 'grayscale' || type === 'greyscale') return 'grayscale';
  if (type === 'brightness') {
    const p = normalizeSignedUnitToMultiplier(params.brightnessAmount)
      ?? normalizeSignedUnitToMultiplier(params.amount)
      ?? normalizeNonNegative(params.brightness, 1);
    return `brightness:${p.toFixed(4)}`;
  }
  if (type === 'contrast') {
    const p = normalizeSignedUnitToMultiplier(params.contrastAmount)
      ?? normalizeSignedUnitToMultiplier(params.amount)
      ?? normalizeNonNegative(params.contrast, 1);
    return `contrast:${p.toFixed(4)}`;
  }
  if (type === 'gamma') {
    const p = normalizeNonNegative(params.gamma ?? params.amount, 1);
    return `gamma:${p.toFixed(4)}`;
  }
  if (type === 'saturation') {
    const p = normalizeSignedUnitToMultiplier(params.saturationAmount)
      ?? normalizeSignedUnitToMultiplier(params.amount)
      ?? normalizeNonNegative(params.saturation, 1);
    return `saturation:${p.toFixed(4)}`;
  }
  if (type === 'hue') {
    const cycle = normalizeHueCycle(params.hueShift)
      ?? normalizeHueCycle(params.shift)
      ?? normalizeHueCycle(params.amount)
      ?? 0;
    return `hue:${cycle.toFixed(4)}`;
  }
  if (type === 'colorama') {
    const mixRaw =
      firstFiniteParam(params, ['coloramaMix', 'mix', 'amount'], 1);
    const paletteRaw =
      firstFiniteParam(params, ['coloramaPalette', 'palette'], 0);
    const offsetRaw =
      firstFiniteParam(params, ['coloramaOffset', 'offset'], 0);
    const speedRaw =
      firstFiniteParam(params, ['coloramaSpeed', 'speed'], 0.2);
    const contrastRaw =
      firstFiniteParam(params, ['coloramaContrast', 'contrast'], 1);
    const bandsRaw =
      firstFiniteParam(params, ['coloramaBands', 'bands'], 0);
    const audioReactRaw =
      firstFiniteParam(params, ['coloramaAudioReact', 'audioReact'], 0);
    const hueShiftRaw =
      firstFiniteParam(params, ['coloramaHueShift', 'hueShift'], 0);
    const audioRaw =
      firstFiniteParam(params, ['audio', 'audioLevel'], getVisualAudioSnapshot().level);
    return [
      'colorama',
      Math.max(0, Math.min(1, mixRaw)).toFixed(4),
      Math.max(0, Math.min(11, Math.round(paletteRaw))).toFixed(0),
      Math.max(0, Math.min(1, offsetRaw)).toFixed(4),
      Math.max(0, Math.min(2, speedRaw)).toFixed(4),
      Math.max(0.5, Math.min(2, contrastRaw)).toFixed(4),
      Math.max(0, Math.min(32, bandsRaw)).toFixed(4),
      Math.max(0, Math.min(1, audioReactRaw)).toFixed(4),
      Math.max(0, Math.min(1, hueShiftRaw)).toFixed(4),
      Math.max(0, Math.min(1.5, audioRaw)).toFixed(4),
    ].join(':');
  }
  if (type === 'exposure') {
    const exposure = clampNumber(
      firstFiniteParam(params, ['exposure', 'exposureAmount', 'amount'], 0),
      -4,
      4,
    );
    const rollOff = clampNumber(
      firstFiniteParam(params, ['exposureRollOff', 'rollOff', 'rolloff'], 0),
      0,
      1,
    );
    const highlightProtect = clampNumber(
      firstFiniteParam(params, ['exposureHighlightProtect', 'highlightProtect', 'highlightProtection'], 0),
      0,
      1,
    );
    return `exposure:${exposure.toFixed(4)}:${rollOff.toFixed(4)}:${highlightProtect.toFixed(4)}`;
  }
  if (type === 'vibrance') {
    const vibrance = clampNumber(
      firstFiniteParam(params, ['vibranceAmount', 'vibrance', 'amount'], 0.3),
      -1,
      2,
    );
    const skinProtect = clampNumber(
      firstFiniteParam(params, ['vibranceSkinProtect', 'skinProtect', 'skinProtection'], 0.5),
      0,
      1,
    );
    const highlightProtect = clampNumber(
      firstFiniteParam(params, ['vibranceHighlightProtect', 'highlightProtect', 'highlightProtection'], 0.3),
      0,
      1,
    );
    const ceiling = clampNumber(
      firstFiniteParam(params, ['vibranceCeiling', 'ceiling', 'outputCeiling'], 1),
      0.1,
      2,
    );
    return [
      'vibrance',
      vibrance.toFixed(4),
      skinProtect.toFixed(4),
      highlightProtect.toFixed(4),
      ceiling.toFixed(4),
    ].join(':');
  }
  if (type === 'temperaturetint' || type === 'temperature-tint') {
    const temperature = clampNumber(
      firstFiniteParam(params, ['temperature', 'temperatureAmount', 'amount'], 0),
      -1,
      1,
    );
    const tint = clampNumber(
      firstFiniteParam(params, ['tint', 'tintAmount'], 0),
      -1,
      1,
    );
    const shadowTemp = clampNumber(
      firstFiniteParam(params, ['shadowTemp', 'temperatureShadow', 'shadowTemperature'], 0),
      -1,
      1,
    );
    const highlightTemp = clampNumber(
      firstFiniteParam(params, ['highlightTemp', 'temperatureHighlight', 'highlightTemperature'], 0),
      -1,
      1,
    );
    const splitTone = clampNumber(
      firstFiniteParam(params, ['splitTone', 'temperatureSplitTone'], 0),
      0,
      1,
    );
    const autoCycle = clampNumber(
      firstFiniteParam(params, ['autoCycle', 'temperatureAutoCycle'], 0),
      0,
      1,
    );
    return [
      'temperature-tint',
      temperature.toFixed(4),
      tint.toFixed(4),
      shadowTemp.toFixed(4),
      highlightTemp.toFixed(4),
      splitTone.toFixed(4),
      autoCycle.toFixed(4),
    ].join(':');
  }
  if (type === 'posterize') {
    const levelsRaw =
      (typeof params.posterizeLevels === 'number' && Number.isFinite(params.posterizeLevels) ? params.posterizeLevels : null)
      ?? (typeof params.amount === 'number' && Number.isFinite(params.amount) ? params.amount : null)
      ?? 8;
    const levels = Math.max(2, Math.min(64, Math.round(levelsRaw)));
    return `posterize:${levels.toFixed(0)}`;
  }
  if (type === 'noise') {
    const amountRaw =
      (typeof params.noiseAmount === 'number' && Number.isFinite(params.noiseAmount) ? params.noiseAmount : null)
      ?? (typeof params.amount === 'number' && Number.isFinite(params.amount) ? params.amount : null)
      ?? 0.25;
    const amount = Math.max(0, Math.min(1, amountRaw));
    return `noise:${amount.toFixed(4)}`;
  }
  if (type === 'rgbshift') {
    const amountRaw =
      (typeof params.rgbShiftAmount === 'number' && Number.isFinite(params.rgbShiftAmount) ? params.rgbShiftAmount : null)
      ?? (typeof params.amount === 'number' && Number.isFinite(params.amount) ? params.amount : null)
      ?? 5;
    const angleRaw =
      (typeof params.rgbShiftAngle === 'number' && Number.isFinite(params.rgbShiftAngle) ? params.rgbShiftAngle : null)
      ?? (typeof params.angle === 'number' && Number.isFinite(params.angle) ? params.angle : null)
      ?? 0;
    const modeRaw =
      (typeof params.rgbShiftMode === 'number' && Number.isFinite(params.rgbShiftMode) ? params.rgbShiftMode : null)
      ?? (typeof params.mode === 'number' && Number.isFinite(params.mode) ? params.mode : null)
      ?? 0;
    const centerXRaw =
      (typeof params.rgbShiftCenterX === 'number' && Number.isFinite(params.rgbShiftCenterX) ? params.rgbShiftCenterX : null)
      ?? (typeof params.centerX === 'number' && Number.isFinite(params.centerX) ? params.centerX : null)
      ?? 0.5;
    const centerYRaw =
      (typeof params.rgbShiftCenterY === 'number' && Number.isFinite(params.rgbShiftCenterY) ? params.rgbShiftCenterY : null)
      ?? (typeof params.centerY === 'number' && Number.isFinite(params.centerY) ? params.centerY : null)
      ?? 0.5;
    const prismRaw =
      (typeof params.rgbShiftPrismSpread === 'number' && Number.isFinite(params.rgbShiftPrismSpread) ? params.rgbShiftPrismSpread : null)
      ?? (typeof params.prismSpread === 'number' && Number.isFinite(params.prismSpread) ? params.prismSpread : null)
      ?? 1;
    const amount = Math.max(0, Math.min(80, amountRaw));
    const angle = ((angleRaw % 360) + 360) % 360;
    const mode = Math.max(0, Math.min(4, Math.round(modeRaw)));
    const centerX = Math.max(0, Math.min(1, centerXRaw));
    const centerY = Math.max(0, Math.min(1, centerYRaw));
    const prism = Math.max(0, Math.min(3, prismRaw));
    return `rgb-shift:${amount.toFixed(4)}:${angle.toFixed(4)}:${mode}:${centerX.toFixed(4)}:${centerY.toFixed(4)}:${prism.toFixed(4)}`;
  }
  if (type === 'scanlines') {
    const intensityRaw =
      (typeof params.scanlinesIntensity === 'number' && Number.isFinite(params.scanlinesIntensity) ? params.scanlinesIntensity : null)
      ?? (typeof params.intensity === 'number' && Number.isFinite(params.intensity) ? params.intensity : null)
      ?? 0.5;
    const countRaw =
      (typeof params.scanlinesCount === 'number' && Number.isFinite(params.scanlinesCount) ? params.scanlinesCount : null)
      ?? (typeof params.count === 'number' && Number.isFinite(params.count) ? params.count : null)
      ?? 200;
    const speedRaw =
      (typeof params.scanlinesSpeed === 'number' && Number.isFinite(params.scanlinesSpeed) ? params.scanlinesSpeed : null)
      ?? (typeof params.speed === 'number' && Number.isFinite(params.speed) ? params.speed : null)
      ?? 0;
    const phosphorRaw =
      (typeof params.scanlinesPhosphor === 'number' && Number.isFinite(params.scanlinesPhosphor) ? params.scanlinesPhosphor : null)
      ?? (typeof params.phosphor === 'number' && Number.isFinite(params.phosphor) ? params.phosphor : null)
      ?? 0;
    const rollingRaw =
      (typeof params.scanlinesRollingBar === 'number' && Number.isFinite(params.scanlinesRollingBar) ? params.scanlinesRollingBar : null)
      ?? (typeof params.rollingBar === 'number' && Number.isFinite(params.rollingBar) ? params.rollingBar : null)
      ?? 0;
    const curvatureRaw =
      (typeof params.scanlinesCurvature === 'number' && Number.isFinite(params.scanlinesCurvature) ? params.scanlinesCurvature : null)
      ?? (typeof params.curvature === 'number' && Number.isFinite(params.curvature) ? params.curvature : null)
      ?? 0;
    const interlaceRaw =
      (typeof params.scanlinesInterlace === 'number' && Number.isFinite(params.scanlinesInterlace) ? params.scanlinesInterlace : null)
      ?? (typeof params.interlace === 'number' && Number.isFinite(params.interlace) ? params.interlace : null)
      ?? 0;
    return [
      'scanlines',
      Math.max(0, Math.min(1, intensityRaw)).toFixed(4),
      Math.max(1, Math.min(1200, countRaw)).toFixed(4),
      Math.max(-4, Math.min(4, speedRaw)).toFixed(4),
      Math.max(0, Math.min(1, phosphorRaw)).toFixed(4),
      Math.max(0, Math.min(1, rollingRaw)).toFixed(4),
      Math.max(0, Math.min(1, curvatureRaw)).toFixed(4),
      Math.max(0, Math.min(1, interlaceRaw)).toFixed(4),
    ].join(':');
  }
  if (type === 'blur') {
    const radiusRaw =
      (typeof params.blurRadius === 'number' && Number.isFinite(params.blurRadius) ? params.blurRadius : null)
      ?? (typeof params.radius === 'number' && Number.isFinite(params.radius) ? params.radius : null)
      ?? (typeof params.amount === 'number' && Number.isFinite(params.amount) ? params.amount : null)
      ?? 5;
    const modeRaw =
      (typeof params.blurMode === 'number' && Number.isFinite(params.blurMode) ? params.blurMode : null)
      ?? (typeof params.mode === 'number' && Number.isFinite(params.mode) ? params.mode : null)
      ?? 1;
    const angleRaw =
      (typeof params.blurAngle === 'number' && Number.isFinite(params.blurAngle) ? params.blurAngle : null)
      ?? (typeof params.angle === 'number' && Number.isFinite(params.angle) ? params.angle : null)
      ?? 0;
    const qualityRaw =
      (typeof params.blurQuality === 'number' && Number.isFinite(params.blurQuality) ? params.blurQuality : null)
      ?? (typeof params.quality === 'number' && Number.isFinite(params.quality) ? params.quality : null)
      ?? 1;
    const edgeRaw =
      (typeof params.blurEdgeProtect === 'number' && Number.isFinite(params.blurEdgeProtect) ? params.blurEdgeProtect : null)
      ?? (typeof params.edgeProtect === 'number' && Number.isFinite(params.edgeProtect) ? params.edgeProtect : null)
      ?? 0.3;
    const mixRaw =
      (typeof params.blurMix === 'number' && Number.isFinite(params.blurMix) ? params.blurMix : null)
      ?? (typeof params.mix === 'number' && Number.isFinite(params.mix) ? params.mix : null)
      ?? 1;
    return [
      'blur',
      Math.max(0, Math.min(48, radiusRaw)).toFixed(4),
      Math.max(0, Math.min(3, Math.round(modeRaw))).toFixed(0),
      (((angleRaw % 360) + 360) % 360).toFixed(4),
      Math.max(0, Math.min(2, Math.round(qualityRaw))).toFixed(0),
      Math.max(0, Math.min(1, edgeRaw)).toFixed(4),
      Math.max(0, Math.min(1, mixRaw)).toFixed(4),
    ].join(':');
  }
  if (type === 'chromaticaberration') {
    const amountRaw =
      (typeof params.caAmount === 'number' && Number.isFinite(params.caAmount) ? params.caAmount : null)
      ?? (typeof params.amount === 'number' && Number.isFinite(params.amount) ? params.amount : null)
      ?? 0.4;
    const modeRaw =
      (typeof params.caMode === 'number' && Number.isFinite(params.caMode) ? params.caMode : null)
      ?? (typeof params.mode === 'number' && Number.isFinite(params.mode) ? params.mode : null)
      ?? 1;
    const angleRaw =
      (typeof params.caAngle === 'number' && Number.isFinite(params.caAngle) ? params.caAngle : null)
      ?? (typeof params.angle === 'number' && Number.isFinite(params.angle) ? params.angle : null)
      ?? 0;
    const centerXRaw =
      (typeof params.caCenterX === 'number' && Number.isFinite(params.caCenterX) ? params.caCenterX : null)
      ?? (typeof params.centerX === 'number' && Number.isFinite(params.centerX) ? params.centerX : null)
      ?? 0.5;
    const centerYRaw =
      (typeof params.caCenterY === 'number' && Number.isFinite(params.caCenterY) ? params.caCenterY : null)
      ?? (typeof params.centerY === 'number' && Number.isFinite(params.centerY) ? params.centerY : null)
      ?? 0.5;
    const falloffRaw =
      (typeof params.caEdgeFalloff === 'number' && Number.isFinite(params.caEdgeFalloff) ? params.caEdgeFalloff : null)
      ?? (typeof params.edgeFalloff === 'number' && Number.isFinite(params.edgeFalloff) ? params.edgeFalloff : null)
      ?? 0.5;
    const mixRaw =
      (typeof params.caMix === 'number' && Number.isFinite(params.caMix) ? params.caMix : null)
      ?? (typeof params.mix === 'number' && Number.isFinite(params.mix) ? params.mix : null)
      ?? 1;
    return [
      'chromatic-aberration',
      Math.max(0, Math.min(3, amountRaw)).toFixed(4),
      Math.max(0, Math.min(3, Math.round(modeRaw))).toFixed(0),
      (((angleRaw % 360) + 360) % 360).toFixed(4),
      Math.max(0, Math.min(1, centerXRaw)).toFixed(4),
      Math.max(0, Math.min(1, centerYRaw)).toFixed(4),
      Math.max(0, Math.min(1, falloffRaw)).toFixed(4),
      Math.max(0, Math.min(1, mixRaw)).toFixed(4),
    ].join(':');
  }
  if (type === 'sharpen') {
    const amountRaw =
      firstFiniteParam(params, ['sharpenAmount', 'amount'], 0.5);
    const modeRaw =
      firstFiniteParam(params, ['sharpenMode', 'mode'], 0);
    const radiusRaw =
      firstFiniteParam(params, ['sharpenRadius', 'radius'], 2);
    const edgeRaw =
      firstFiniteParam(params, ['sharpenEdgeProtect', 'edgeProtect'], 0.2);
    const clarityRaw =
      firstFiniteParam(params, ['sharpenClarity', 'clarity', 'intensity'], 0);
    return [
      'sharpen',
      Math.max(0, Math.min(3, amountRaw)).toFixed(4),
      Math.max(0, Math.min(1, Math.round(modeRaw))).toFixed(0),
      Math.max(1, Math.min(8, radiusRaw)).toFixed(4),
      Math.max(0, Math.min(1, edgeRaw)).toFixed(4),
      Math.max(0, Math.min(1, clarityRaw)).toFixed(4),
    ].join(':');
  }
  if (type === 'directionalblur') {
    const amountRaw =
      firstFiniteParam(params, ['dirBlurAmount', 'directionalBlurAmount', 'amount'], 0.25);
    const specificAngle =
      finiteParam(params.dirBlurAngle) ?? finiteParam(params.directionalBlurAngle);
    const genericAngle = finiteParam(params.angle);
    const angleRaw = specificAngle
      ?? (genericAngle !== null && Math.abs(genericAngle) <= Math.PI * 2
        ? genericAngle * 180 / Math.PI
        : genericAngle)
      ?? 0;
    const samplesRaw =
      firstFiniteParam(params, ['dirBlurSamples', 'directionalBlurSamples', 'samples'], 16);
    const falloffRaw =
      firstFiniteParam(params, ['dirBlurFalloff', 'directionalBlurFalloff', 'falloff', 'amount2'], 0.3);
    const centerBiasRaw =
      firstFiniteParam(params, ['dirBlurCenterBias', 'directionalBlurCenterBias', 'centerBias'], 0);
    const mixRaw =
      firstFiniteParam(params, ['dirBlurMix', 'directionalBlurMix', 'mix'], 1);
    return [
      'directional-blur',
      Math.max(0, Math.min(1, amountRaw)).toFixed(4),
      (((angleRaw % 360) + 360) % 360).toFixed(4),
      Math.max(4, Math.min(32, samplesRaw)).toFixed(4),
      Math.max(0, Math.min(1, falloffRaw)).toFixed(4),
      Math.max(0, Math.min(1, centerBiasRaw)).toFixed(4),
      Math.max(0, Math.min(1, mixRaw)).toFixed(4),
    ].join(':');
  }
  if (type === 'zoomblur') {
    const amountRaw =
      firstFiniteParam(params, ['zoomBlurAmount', 'amount'], 0.25);
    const centerXRaw =
      firstFiniteParam(params, ['zoomBlurCenterX', 'centerX'], 0.5);
    const centerYRaw =
      firstFiniteParam(params, ['zoomBlurCenterY', 'centerY'], 0.5);
    const samplesRaw =
      firstFiniteParam(params, ['zoomBlurSamples', 'samples'], 16);
    const falloffRaw =
      firstFiniteParam(params, ['zoomBlurFalloff', 'falloff', 'amount2'], 0.3);
    const chromaticRaw =
      firstFiniteParam(params, ['zoomBlurChromatic', 'chromatic'], 0);
    const mixRaw =
      firstFiniteParam(params, ['zoomBlurMix', 'mix'], 1);
    return [
      'zoom-blur',
      Math.max(0, Math.min(1, amountRaw)).toFixed(4),
      Math.max(0, Math.min(1, centerXRaw)).toFixed(4),
      Math.max(0, Math.min(1, centerYRaw)).toFixed(4),
      Math.max(4, Math.min(32, samplesRaw)).toFixed(4),
      Math.max(0, Math.min(1, falloffRaw)).toFixed(4),
      Math.max(0, Math.min(1, chromaticRaw)).toFixed(4),
      Math.max(0, Math.min(1, mixRaw)).toFixed(4),
    ].join(':');
  }
  if (type === 'radialblur') {
    const amountRaw =
      firstFiniteParam(params, ['radialBlurAmount', 'amount'], 0.25);
    const centerXRaw =
      firstFiniteParam(params, ['radialBlurCenterX', 'centerX'], 0.5);
    const centerYRaw =
      firstFiniteParam(params, ['radialBlurCenterY', 'centerY'], 0.5);
    const samplesRaw =
      firstFiniteParam(params, ['radialBlurSamples', 'samples'], 16);
    const falloffRaw =
      firstFiniteParam(params, ['radialBlurFalloff', 'falloff', 'amount2'], 0.3);
    const radiusInnerRaw =
      firstFiniteParam(params, ['radialBlurRadiusInner', 'radiusInner'], 0);
    const radiusOuterRaw =
      firstFiniteParam(params, ['radialBlurRadiusOuter', 'radiusOuter'], 0.7);
    const mixRaw =
      firstFiniteParam(params, ['radialBlurMix', 'mix'], 1);
    return [
      'radial-blur',
      Math.max(0, Math.min(1, amountRaw)).toFixed(4),
      Math.max(0, Math.min(1, centerXRaw)).toFixed(4),
      Math.max(0, Math.min(1, centerYRaw)).toFixed(4),
      Math.max(4, Math.min(32, samplesRaw)).toFixed(4),
      Math.max(0, Math.min(1, falloffRaw)).toFixed(4),
      Math.max(0, Math.min(1, radiusInnerRaw)).toFixed(4),
      Math.max(0, Math.min(1.5, radiusOuterRaw)).toFixed(4),
      Math.max(0, Math.min(1, mixRaw)).toFixed(4),
    ].join(':');
  }
  if (type === 'kaleidoscope') {
    const segmentsRaw =
      firstFiniteParam(params, ['kaleidoscopeSegments', 'segments'], 6);
    const angleRaw =
      firstFiniteParam(params, ['kaleidoscopeAngle', 'kaleidoscopeRotation', 'angle', 'rotation'], 0);
    const centerXRaw =
      firstFiniteParam(params, ['kaleidoscopeCenterX', 'centerX'], 0.5);
    const centerYRaw =
      firstFiniteParam(params, ['kaleidoscopeCenterY', 'centerY'], 0.5);
    const zoomRaw =
      firstFiniteParam(params, ['kaleidoscopeZoom', 'zoom'], 1);
    const modeRaw =
      firstFiniteParam(params, ['kaleidoscopeMode', 'mode'], 0);
    const spiralRaw =
      firstFiniteParam(params, ['kaleidoscopeSpiral', 'spiral'], 0);
    const speedRaw =
      firstFiniteParam(params, ['kaleidoscopeAnimSpeed', 'animSpeed', 'speed'], 0);
    const mixRaw =
      firstFiniteParam(params, ['kaleidoscopeMix', 'mix', 'amount'], 1);
    return [
      'kaleidoscope',
      Math.max(0, Math.min(1, mixRaw)).toFixed(4),
      Math.max(2, Math.min(32, Math.round(segmentsRaw))).toFixed(0),
      (((angleRaw % 360) + 360) % 360).toFixed(4),
      Math.max(0, Math.min(1, centerXRaw)).toFixed(4),
      Math.max(0, Math.min(1, centerYRaw)).toFixed(4),
      Math.max(0.25, Math.min(4, zoomRaw)).toFixed(4),
      Math.max(0, Math.min(2, Math.round(modeRaw))).toFixed(0),
      Math.max(0, Math.min(2, spiralRaw)).toFixed(4),
      Math.max(0, Math.min(2, speedRaw)).toFixed(4),
    ].join(':');
  }
  if (type === 'mirror') {
    const horizontal = firstFiniteParam(params, ['mirrorHorizontal'], Number.NaN);
    const vertical = firstFiniteParam(params, ['mirrorVertical'], Number.NaN);
    let modeRaw =
      firstFiniteParam(params, ['mirrorMode', 'mirrorAxis', 'mode'], 0);
    if (Number.isFinite(horizontal) || Number.isFinite(vertical)) {
      const h = Number.isFinite(horizontal) ? horizontal : 0;
      const v = Number.isFinite(vertical) ? vertical : 0;
      modeRaw = h > 0.5 && v > 0.5 ? 2 : v > 0.5 ? 1 : 0;
    }
    const positionRaw =
      firstFiniteParam(params, ['mirrorPosition', 'position'], 0.5);
    const offsetRaw =
      firstFiniteParam(params, ['mirrorOffset', 'offset'], 0.5);
    const flipRaw =
      firstFiniteParam(params, ['mirrorFlipSide', 'flipSide'], 0);
    const mixRaw =
      firstFiniteParam(params, ['mirrorMix', 'mix', 'amount'], 1);
    return [
      'mirror',
      Math.max(0, Math.min(1, mixRaw)).toFixed(4),
      Math.max(0, Math.min(3, Math.round(modeRaw))).toFixed(0),
      Math.max(0, Math.min(1, positionRaw)).toFixed(4),
      Math.max(0, Math.min(1, offsetRaw)).toFixed(4),
      Math.max(0, Math.min(1, Math.round(flipRaw))).toFixed(0),
    ].join(':');
  }
  if (type === 'wave') {
    const amplitudeRaw =
      firstFiniteParam(params, ['waveAmplitude', 'amplitude', 'amount'], 10);
    const modeRaw =
      firstFiniteParam(params, ['waveType', 'mode'], 0);
    const waveformRaw =
      firstFiniteParam(params, ['waveWaveform', 'waveform'], 0);
    const frequencyRaw =
      firstFiniteParam(params, ['waveFrequency', 'frequency'], 5);
    const speedRaw =
      firstFiniteParam(params, ['waveSpeed', 'speed'], 1);
    const phaseRaw =
      firstFiniteParam(params, ['wavePhase', 'phase'], 0);
    const secondaryRaw =
      firstFiniteParam(params, ['waveSecondary', 'secondary', 'harmonic'], 0);
    const chromaRaw =
      firstFiniteParam(params, ['waveChromaSplit', 'chromaSplit', 'chromatic'], 0);
    return [
      'wave',
      Math.max(0, Math.min(50, amplitudeRaw)).toFixed(4),
      Math.max(0, Math.min(3, Math.round(modeRaw))).toFixed(0),
      Math.max(0, Math.min(3, Math.round(waveformRaw))).toFixed(0),
      Math.max(0.5, Math.min(30, frequencyRaw)).toFixed(4),
      Math.max(0, Math.min(3, speedRaw)).toFixed(4),
      (((phaseRaw % 360) + 360) % 360).toFixed(4),
      Math.max(0, Math.min(1, secondaryRaw)).toFixed(4),
      Math.max(0, Math.min(1, chromaRaw)).toFixed(4),
    ].join(':');
  }
  if (type === 'fisheye') {
    const strengthRaw =
      firstFiniteParam(params, ['fisheyeStrength', 'strength', 'amount'], 0.5);
    const radiusRaw =
      firstFiniteParam(params, ['fisheyeRadius', 'radius'], 1);
    const centerXRaw =
      firstFiniteParam(params, ['fisheyeCenterX', 'centerX'], 0.5);
    const centerYRaw =
      firstFiniteParam(params, ['fisheyeCenterY', 'centerY'], 0.5);
    const zoomRaw =
      firstFiniteParam(params, ['fisheyeZoom', 'zoom'], 1);
    const modeRaw =
      firstFiniteParam(params, ['fisheyeMode', 'mode'], 0);
    const chromaRaw =
      firstFiniteParam(params, ['fisheyeChromaEdge', 'chromaEdge', 'chromatic'], 0);
    return [
      'fisheye',
      Math.max(-1, Math.min(1, strengthRaw)).toFixed(4),
      Math.max(0.1, Math.min(1, radiusRaw)).toFixed(4),
      Math.max(0, Math.min(1, centerXRaw)).toFixed(4),
      Math.max(0, Math.min(1, centerYRaw)).toFixed(4),
      Math.max(0.5, Math.min(2, zoomRaw)).toFixed(4),
      Math.max(0, Math.min(2, Math.round(modeRaw))).toFixed(0),
      Math.max(0, Math.min(1, chromaRaw)).toFixed(4),
    ].join(':');
  }
  if (type === 'lensdistortion' || type === 'lens-distortion') {
    const amountRaw =
      firstFiniteParam(params, ['lensDistAmount', 'amount'], 0.4);
    const modeRaw =
      firstFiniteParam(params, ['lensDistMode', 'mode'], 0);
    const centerXRaw =
      firstFiniteParam(params, ['lensDistCenterX', 'centerX'], 0.5);
    const centerYRaw =
      firstFiniteParam(params, ['lensDistCenterY', 'centerY'], 0.5);
    const cubicRaw =
      firstFiniteParam(params, ['lensDistCubic', 'cubic'], 0);
    const anamorphicRaw =
      firstFiniteParam(params, ['lensDistAnamorphicX', 'anamorphicX'], 1.3);
    const edgeFadeRaw =
      firstFiniteParam(params, ['lensDistEdgeFade', 'edgeFade'], 1);
    const chromaRaw =
      firstFiniteParam(params, ['lensDistChromaFringe', 'chromaFringe', 'chromatic'], 0);
    return [
      'lens-distortion',
      Math.max(-1, Math.min(1, amountRaw)).toFixed(4),
      Math.max(0, Math.min(3, Math.round(modeRaw))).toFixed(0),
      Math.max(0, Math.min(1, centerXRaw)).toFixed(4),
      Math.max(0, Math.min(1, centerYRaw)).toFixed(4),
      Math.max(-0.5, Math.min(0.5, cubicRaw)).toFixed(4),
      Math.max(0.5, Math.min(2, anamorphicRaw)).toFixed(4),
      Math.max(0, Math.min(1, edgeFadeRaw)).toFixed(4),
      Math.max(0, Math.min(1, chromaRaw)).toFixed(4),
    ].join(':');
  }
  if (type === 'twirl') {
    const angleRaw =
      firstFiniteParam(params, ['twirlAngle', 'angle', 'amount'], 1.5);
    const radiusRaw =
      firstFiniteParam(params, ['twirlRadius', 'radius'], 0.5);
    const centerXRaw =
      firstFiniteParam(params, ['twirlCenterX', 'centerX'], 0.5);
    const centerYRaw =
      firstFiniteParam(params, ['twirlCenterY', 'centerY'], 0.5);
    const falloffRaw =
      firstFiniteParam(params, ['twirlFalloff', 'falloff'], 1.5);
    const speedRaw =
      firstFiniteParam(params, ['twirlAnimSpeed', 'animSpeed', 'speed'], 0);
    const mixRaw =
      firstFiniteParam(params, ['twirlMix', 'mix', 'outputMix'], 1);
    return [
      'twirl',
      Math.max(-6.28319, Math.min(6.28319, angleRaw)).toFixed(4),
      Math.max(0.05, Math.min(1, radiusRaw)).toFixed(4),
      Math.max(0, Math.min(1, centerXRaw)).toFixed(4),
      Math.max(0, Math.min(1, centerYRaw)).toFixed(4),
      Math.max(0.5, Math.min(4, falloffRaw)).toFixed(4),
      Math.max(0, Math.min(2, speedRaw)).toFixed(4),
      Math.max(0, Math.min(1, mixRaw)).toFixed(4),
    ].join(':');
  }
  if (type === 'pinchbulge' || type === 'pinch-bulge') {
    const amountRaw =
      firstFiniteParam(params, ['pinchAmount', 'amount'], 0.4);
    const radiusRaw =
      firstFiniteParam(params, ['pinchRadius', 'radius'], 0.5);
    const centerXRaw =
      firstFiniteParam(params, ['pinchCenterX', 'centerX'], 0.5);
    const centerYRaw =
      firstFiniteParam(params, ['pinchCenterY', 'centerY'], 0.5);
    const falloffRaw =
      firstFiniteParam(params, ['pinchFalloff', 'falloff'], 1.5);
    const chromaRaw =
      firstFiniteParam(params, ['pinchChromatic', 'chromatic', 'chromaSplit'], 0);
    const mixRaw =
      firstFiniteParam(params, ['pinchMix', 'mix', 'outputMix'], 1);
    return [
      'pinch-bulge',
      Math.max(-1, Math.min(1, amountRaw)).toFixed(4),
      Math.max(0.1, Math.min(1, radiusRaw)).toFixed(4),
      Math.max(0, Math.min(1, centerXRaw)).toFixed(4),
      Math.max(0, Math.min(1, centerYRaw)).toFixed(4),
      Math.max(0.5, Math.min(4, falloffRaw)).toFixed(4),
      Math.max(0, Math.min(1, chromaRaw)).toFixed(4),
      Math.max(0, Math.min(1, mixRaw)).toFixed(4),
    ].join(':');
  }
  if (type === 'glitch') {
    const intensityRaw =
      (typeof params.glitchIntensity === 'number' && Number.isFinite(params.glitchIntensity) ? params.glitchIntensity : null)
      ?? (typeof params.intensity === 'number' && Number.isFinite(params.intensity) ? params.intensity : null)
      ?? 0.5;
    const speedRaw =
      (typeof params.glitchSpeed === 'number' && Number.isFinite(params.glitchSpeed) ? params.glitchSpeed : null)
      ?? (typeof params.speed === 'number' && Number.isFinite(params.speed) ? params.speed : null)
      ?? 1;
    const blockRaw =
      (typeof params.glitchBlockSize === 'number' && Number.isFinite(params.glitchBlockSize) ? params.glitchBlockSize : null)
      ?? (typeof params.blockSize === 'number' && Number.isFinite(params.blockSize) ? params.blockSize : null)
      ?? 0.3;
    const splitRaw =
      (typeof params.glitchRGBSplit === 'number' && Number.isFinite(params.glitchRGBSplit) ? params.glitchRGBSplit : null)
      ?? (typeof params.rgbSplit === 'number' && Number.isFinite(params.rgbSplit) ? params.rgbSplit : null)
      ?? 0.5;
    const jitterRaw =
      (typeof params.glitchJitter === 'number' && Number.isFinite(params.glitchJitter) ? params.glitchJitter : null)
      ?? (typeof params.jitter === 'number' && Number.isFinite(params.jitter) ? params.jitter : null)
      ?? 0.3;
    const verticalRaw =
      (typeof params.glitchVerticalSlice === 'number' && Number.isFinite(params.glitchVerticalSlice) ? params.glitchVerticalSlice : null)
      ?? (typeof params.verticalSlice === 'number' && Number.isFinite(params.verticalSlice) ? params.verticalSlice : null)
      ?? 0;
    const holdRaw =
      (typeof params.glitchBlockHold === 'number' && Number.isFinite(params.glitchBlockHold) ? params.glitchBlockHold : null)
      ?? (typeof params.blockHold === 'number' && Number.isFinite(params.blockHold) ? params.blockHold : null)
      ?? 0.3;
    const tearRaw =
      (typeof params.glitchTearChance === 'number' && Number.isFinite(params.glitchTearChance) ? params.glitchTearChance : null)
      ?? (typeof params.tearChance === 'number' && Number.isFinite(params.tearChance) ? params.tearChance : null)
      ?? 0;
    const triggerRaw =
      (typeof params.glitchTriggerMode === 'number' && Number.isFinite(params.glitchTriggerMode) ? params.glitchTriggerMode : null)
      ?? (typeof params.triggerMode === 'number' && Number.isFinite(params.triggerMode) ? params.triggerMode : null)
      ?? 0;
    return [
      'glitch',
      Math.max(0, Math.min(1, intensityRaw)).toFixed(4),
      Math.max(0, Math.min(4, speedRaw)).toFixed(4),
      Math.max(0, Math.min(1, blockRaw)).toFixed(4),
      Math.max(0, Math.min(1, splitRaw)).toFixed(4),
      Math.max(0, Math.min(1, jitterRaw)).toFixed(4),
      Math.max(0, Math.min(1, verticalRaw)).toFixed(4),
      Math.max(0, Math.min(1, holdRaw)).toFixed(4),
      Math.max(0, Math.min(1, tearRaw)).toFixed(4),
      Math.max(0, Math.min(3, Math.round(triggerRaw))).toFixed(0),
    ].join(':');
  }
  if (type === 'pixelate') {
    const sizeRaw =
      (typeof params.pixelateSize === 'number' && Number.isFinite(params.pixelateSize) ? params.pixelateSize : null)
      ?? (typeof params.size === 'number' && Number.isFinite(params.size) ? params.size : null)
      ?? (typeof params.amount === 'number' && Number.isFinite(params.amount) ? params.amount : null)
      ?? 8;
    const modeRaw =
      (typeof params.pixelateMode === 'number' && Number.isFinite(params.pixelateMode) ? params.pixelateMode : null)
      ?? (typeof params.mode === 'number' && Number.isFinite(params.mode) ? params.mode : null)
      ?? 0;
    const gridRaw =
      (typeof params.pixelateGrid === 'number' && Number.isFinite(params.pixelateGrid) ? params.pixelateGrid : null)
      ?? (typeof params.gridLines === 'number' && Number.isFinite(params.gridLines) ? params.gridLines : null)
      ?? 0;
    const animSpeedRaw =
      (typeof params.pixelateAnimSpeed === 'number' && Number.isFinite(params.pixelateAnimSpeed) ? params.pixelateAnimSpeed : null)
      ?? (typeof params.animSpeed === 'number' && Number.isFinite(params.animSpeed) ? params.animSpeed : null)
      ?? 0;
    const animAmountRaw =
      (typeof params.pixelateAnimAmount === 'number' && Number.isFinite(params.pixelateAnimAmount) ? params.pixelateAnimAmount : null)
      ?? (typeof params.animAmount === 'number' && Number.isFinite(params.animAmount) ? params.animAmount : null)
      ?? 0;
    const size = Math.max(1, Math.min(128, sizeRaw));
    const mode = Math.max(0, Math.min(3, Math.round(modeRaw)));
    const grid = Math.max(0, Math.min(1, gridRaw));
    const animSpeed = Math.max(0, Math.min(4, animSpeedRaw));
    const animAmount = Math.max(0, Math.min(1, animAmountRaw));
    return `pixelate:${size.toFixed(4)}:${mode}:${grid.toFixed(4)}:${animSpeed.toFixed(4)}:${animAmount.toFixed(4)}`;
  }
  if (type === 'vignette') {
    const sizeRaw =
      (typeof params.vignetteSize === 'number' && Number.isFinite(params.vignetteSize) ? params.vignetteSize : null)
      ?? (typeof params.size === 'number' && Number.isFinite(params.size) ? params.size : null)
      ?? 0.8;
    const softnessRaw =
      (typeof params.vignetteSoftness === 'number' && Number.isFinite(params.vignetteSoftness) ? params.vignetteSoftness : null)
      ?? (typeof params.softness === 'number' && Number.isFinite(params.softness) ? params.softness : null)
      ?? 0.4;
    const roundnessRaw =
      (typeof params.vignetteRoundness === 'number' && Number.isFinite(params.vignetteRoundness) ? params.vignetteRoundness : null)
      ?? (typeof params.roundness === 'number' && Number.isFinite(params.roundness) ? params.roundness : null)
      ?? 0.5;
    const shapeRaw =
      (typeof params.vignetteShape === 'number' && Number.isFinite(params.vignetteShape) ? params.vignetteShape : null)
      ?? (typeof params.shape === 'number' && Number.isFinite(params.shape) ? params.shape : null)
      ?? 0;
    const aspectRaw =
      (typeof params.vignetteAspect === 'number' && Number.isFinite(params.vignetteAspect) ? params.vignetteAspect : null)
      ?? (typeof params.aspect === 'number' && Number.isFinite(params.aspect) ? params.aspect : null)
      ?? 1;
    const centerXRaw =
      (typeof params.vignetteCenterX === 'number' && Number.isFinite(params.vignetteCenterX) ? params.vignetteCenterX : null)
      ?? (typeof params.centerX === 'number' && Number.isFinite(params.centerX) ? params.centerX : null)
      ?? 0.5;
    const centerYRaw =
      (typeof params.vignetteCenterY === 'number' && Number.isFinite(params.vignetteCenterY) ? params.vignetteCenterY : null)
      ?? (typeof params.centerY === 'number' && Number.isFinite(params.centerY) ? params.centerY : null)
      ?? 0.5;
    const tintRaw =
      (typeof params.vignetteTintAmount === 'number' && Number.isFinite(params.vignetteTintAmount) ? params.vignetteTintAmount : null)
      ?? (typeof params.tintAmount === 'number' && Number.isFinite(params.tintAmount) ? params.tintAmount : null)
      ?? 0;
    const breathingRaw =
      (typeof params.vignetteBreathing === 'number' && Number.isFinite(params.vignetteBreathing) ? params.vignetteBreathing : null)
      ?? (typeof params.breathing === 'number' && Number.isFinite(params.breathing) ? params.breathing : null)
      ?? 0;
    const size = Math.max(0, Math.min(2, sizeRaw));
    const softness = Math.max(0, Math.min(2, softnessRaw));
    const roundness = Math.max(0, Math.min(1, roundnessRaw));
    const shape = Math.max(0, Math.min(3, Math.round(shapeRaw)));
    const aspect = Math.max(0.1, Math.min(4, aspectRaw));
    const centerX = Math.max(-2, Math.min(3, centerXRaw));
    const centerY = Math.max(-2, Math.min(3, centerYRaw));
    const tintAmount = Math.max(0, Math.min(1, tintRaw));
    const breathing = Math.max(0, Math.min(1, breathingRaw));
    return [
      'vignette',
      size.toFixed(4),
      softness.toFixed(4),
      roundness.toFixed(4),
      shape.toFixed(0),
      aspect.toFixed(4),
      centerX.toFixed(4),
      centerY.toFixed(4),
      tintAmount.toFixed(4),
      breathing.toFixed(4),
    ].join(':');
  }
  if (type === 'chromakey') {
    const toleranceRaw =
      firstFiniteParam(params, ['chromaKeyTolerance', 'threshold', 'tolerance', 'amount'], 0.25);
    const keyRRaw =
      firstFiniteParam(params, ['chromaKeyR', 'keyR', 'red'], 0);
    const keyGRaw =
      firstFiniteParam(params, ['chromaKeyG', 'keyG', 'green'], 1);
    const keyBRaw =
      firstFiniteParam(params, ['chromaKeyB', 'keyB', 'blue'], 0);
    const softnessRaw =
      firstFiniteParam(params, ['chromaKeySoftness', 'softness', 'amount2'], 0.15);
    const spillRaw =
      firstFiniteParam(params, ['chromaKeySpill', 'spill'], 0.6);
    const matteRaw =
      firstFiniteParam(params, ['chromaKeyMatte', 'matte'], 0);
    const modeRaw =
      firstFiniteParam(params, ['chromaKeyMode', 'mode'], 1);
    return [
      'chroma-key',
      Math.max(0, Math.min(1, toleranceRaw)).toFixed(4),
      Math.max(0, Math.min(1, keyRRaw)).toFixed(4),
      Math.max(0, Math.min(1, keyGRaw)).toFixed(4),
      Math.max(0, Math.min(1, keyBRaw)).toFixed(4),
      Math.max(0, Math.min(1, softnessRaw)).toFixed(4),
      Math.max(0, Math.min(1, spillRaw)).toFixed(4),
      Math.max(0, Math.min(1, Math.round(matteRaw))).toFixed(0),
      Math.max(0, Math.min(2, Math.round(modeRaw))).toFixed(0),
    ].join(':');
  }
  if (type === 'lumakey') {
    const lowRaw =
      firstFiniteParam(params, ['lumaKeyLowCut', 'threshold', 'lowCut', 'amount'], 0.4);
    const highRaw =
      firstFiniteParam(params, ['lumaKeyHighCut', 'highCut'], 0.6);
    const invertRaw =
      firstFiniteParam(params, ['lumaKeyInvert', 'invert'], 0);
    const gammaRaw =
      firstFiniteParam(params, ['lumaKeyGamma', 'gamma'], 1);
    const matteRaw =
      firstFiniteParam(params, ['lumaKeyMatte', 'matte'], 0);
    const premultiplyRaw =
      firstFiniteParam(params, ['lumaKeyPremultiply', 'premultiply'], 0);
    return [
      'luma-key',
      Math.max(0, Math.min(1, lowRaw)).toFixed(4),
      Math.max(0, Math.min(1, highRaw)).toFixed(4),
      Math.max(0, Math.min(1, Math.round(invertRaw))).toFixed(0),
      Math.max(0.2, Math.min(3, gammaRaw)).toFixed(4),
      Math.max(0, Math.min(1, Math.round(matteRaw))).toFixed(0),
      Math.max(0, Math.min(1, Math.round(premultiplyRaw))).toFixed(0),
    ].join(':');
  }
  if (type === 'differencekey') {
    const toleranceRaw =
      firstFiniteParam(params, ['diffKeyTolerance', 'threshold', 'tolerance', 'amount'], 0.3);
    const refRRaw =
      firstFiniteParam(params, ['diffKeyR', 'refR', 'red'], 0);
    const refGRaw =
      firstFiniteParam(params, ['diffKeyG', 'refG', 'green'], 0);
    const refBRaw =
      firstFiniteParam(params, ['diffKeyB', 'refB', 'blue'], 0);
    const softnessRaw =
      firstFiniteParam(params, ['diffKeySoftness', 'softness', 'amount2'], 0.15);
    const invertRaw =
      firstFiniteParam(params, ['diffKeyInvert', 'invert'], 0);
    const matteRaw =
      firstFiniteParam(params, ['diffKeyMatte', 'matte'], 0);
    const modeRaw =
      firstFiniteParam(params, ['diffKeyMode', 'mode'], 0);
    return [
      'difference-key',
      Math.max(0, Math.min(1, toleranceRaw)).toFixed(4),
      Math.max(0, Math.min(1, refRRaw)).toFixed(4),
      Math.max(0, Math.min(1, refGRaw)).toFixed(4),
      Math.max(0, Math.min(1, refBRaw)).toFixed(4),
      Math.max(0, Math.min(1, softnessRaw)).toFixed(4),
      Math.max(0, Math.min(1, Math.round(invertRaw))).toFixed(0),
      Math.max(0, Math.min(1, Math.round(matteRaw))).toFixed(0),
      Math.max(0, Math.min(2, Math.round(modeRaw))).toFixed(0),
    ].join(':');
  }
  if (type === 'erode' || type === 'dilate') {
    const prefix = type === 'erode' ? 'erode' : 'dilate';
    const radiusRaw =
      firstFiniteParam(params, [`${prefix}Radius`, 'radius', 'amount'], 2);
    const shapeRaw =
      firstFiniteParam(params, [`${prefix}Shape`, 'shape'], 1);
    const channelRaw =
      firstFiniteParam(params, [`${prefix}Channel`, 'channel'], 0);
    const mixRaw =
      firstFiniteParam(params, [`${prefix}Mix`, 'mix', 'outputMix', 'amount2'], 1);
    return [
      type,
      Math.max(1, Math.min(8, radiusRaw)).toFixed(4),
      Math.max(0, Math.min(2, Math.round(shapeRaw))).toFixed(0),
      Math.max(0, Math.min(4, Math.round(channelRaw))).toFixed(0),
      Math.max(0, Math.min(1, mixRaw)).toFixed(4),
    ].join(':');
  }
  if (type === 'edgedetect' || type === 'edge-detect') {
    const thresholdRaw =
      firstFiniteParam(params, ['edgeThreshold', 'threshold', 'amount'], 0.1);
    const thicknessRaw =
      firstFiniteParam(params, ['edgeThickness', 'thickness', 'radius'], 1);
    const modeRaw =
      firstFiniteParam(params, ['edgeMode', 'mode'], 0);
    const invertRaw =
      firstFiniteParam(params, ['edgeInvert', 'invert'], 0);
    const edgeOnlyRaw =
      firstFiniteParam(params, ['edgeOnlyAlpha', 'edgeOnly', 'matte'], 0);
    const tintRRaw =
      firstFiniteParam(params, ['edgeTintR', 'edgeR', 'tintR', 'red'], 1);
    const tintGRaw =
      firstFiniteParam(params, ['edgeTintG', 'edgeG', 'tintG', 'green'], 1);
    const tintBRaw =
      firstFiniteParam(params, ['edgeTintB', 'edgeB', 'tintB', 'blue'], 1);
    const tintEdgesRaw =
      firstFiniteParam(params, ['edgeTintEdges', 'tintEdges'], 0);
    const glowRaw =
      firstFiniteParam(params, ['edgeGlow', 'glow'], 0);
    const flags =
      (Math.max(0, Math.min(1, Math.round(invertRaw))) > 0 ? 1 : 0) +
      (Math.max(0, Math.min(1, Math.round(edgeOnlyRaw))) > 0 ? 2 : 0);
    return [
      'edge-detect',
      Math.max(0, Math.min(1, thresholdRaw)).toFixed(4),
      Math.max(0.25, Math.min(12, thicknessRaw)).toFixed(4),
      Math.max(0, Math.min(3, Math.round(modeRaw))).toFixed(0),
      flags.toFixed(0),
      Math.max(0, Math.min(1.5, tintRRaw)).toFixed(4),
      Math.max(0, Math.min(1.5, tintGRaw)).toFixed(4),
      Math.max(0, Math.min(1.5, tintBRaw)).toFixed(4),
      Math.max(0, Math.min(1, tintEdgesRaw)).toFixed(4),
      Math.max(0, Math.min(2, glowRaw)).toFixed(4),
    ].join(':');
  }
  if (type === 'filmgrain' || type === 'film-grain') {
    const amountRaw =
      firstFiniteParam(params, ['grainAmount', 'amount'], 0.3);
    const sizeRaw =
      firstFiniteParam(params, ['grainSize', 'size'], 1);
    const shadowRaw =
      firstFiniteParam(params, ['grainShadow', 'shadow'], 0.7);
    const midRaw =
      firstFiniteParam(params, ['grainMid', 'mid'], 1);
    const highRaw =
      firstFiniteParam(params, ['grainHigh', 'high'], 0.5);
    const monoRaw =
      firstFiniteParam(params, ['grainMono', 'mono'], 0);
    const stockRaw =
      firstFiniteParam(params, ['grainStock', 'stock'], 1);
    const jitterRaw =
      firstFiniteParam(params, ['grainColorJitter', 'colorJitter'], 0);
    const speedRaw =
      firstFiniteParam(params, ['grainAnimSpeed', 'animSpeed', 'speed'], 1);
    return [
      'film-grain',
      Math.max(0, Math.min(1, amountRaw)).toFixed(4),
      Math.max(0.25, Math.min(8, sizeRaw)).toFixed(4),
      Math.max(0, Math.min(2, shadowRaw)).toFixed(4),
      Math.max(0, Math.min(2, midRaw)).toFixed(4),
      Math.max(0, Math.min(2, highRaw)).toFixed(4),
      Math.max(0, Math.min(1, Math.round(monoRaw))).toFixed(0),
      Math.max(0, Math.min(3, Math.round(stockRaw))).toFixed(0),
      Math.max(0, Math.min(1, jitterRaw)).toFixed(4),
      Math.max(0, Math.min(4, speedRaw)).toFixed(4),
    ].join(':');
  }
  if (type === 'filmictonemap' || type === 'filmic-tonemap') {
    const mixRaw =
      firstFiniteParam(params, ['tonemapMix', 'mix', 'amount'], 1);
    const curveRaw =
      firstFiniteParam(params, ['tonemapCurve', 'curve'], 0);
    const exposureRaw =
      firstFiniteParam(params, ['tonemapExposure', 'exposure'], 1);
    const contrastRaw =
      firstFiniteParam(params, ['tonemapContrast', 'contrast'], 0);
    return [
      'filmic-tonemap',
      Math.max(0, Math.min(1, mixRaw)).toFixed(4),
      Math.max(0, Math.min(5, Math.round(curveRaw))).toFixed(0),
      Math.max(0.25, Math.min(4, exposureRaw)).toFixed(4),
      Math.max(0, Math.min(1, contrastRaw)).toFixed(4),
    ].join(':');
  }
  if (type === 'bloom') {
    const amountRaw =
      firstFiniteParam(params, ['amount', 'bloomAmount', 'mix'], 0.6);
    const intensityRaw =
      firstFiniteParam(params, ['bloomIntensity', 'intensity'], 1);
    const thresholdRaw =
      firstFiniteParam(params, ['threshold', 'bloomThreshold'], 0.6);
    const kneeRaw =
      firstFiniteParam(params, ['bloomKnee', 'knee', 'softness'], 0.4);
    const radiusRaw =
      firstFiniteParam(params, ['bloomRadius', 'radius'], 0.5);
    const anamorphicRaw =
      firstFiniteParam(params, ['bloomAnamorphic', 'anamorphic'], 0);
    const redRaw =
      firstFiniteParam(params, ['red', 'bloomTintR', 'tintR'], 1);
    const greenRaw =
      firstFiniteParam(params, ['green', 'bloomTintG', 'tintG'], 1);
    const blueRaw =
      firstFiniteParam(params, ['blue', 'bloomTintB', 'tintB'], 1);
    return [
      'bloom',
      Math.max(0, Math.min(1, amountRaw)).toFixed(4),
      Math.max(0, Math.min(2, intensityRaw)).toFixed(4),
      Math.max(0, Math.min(1, thresholdRaw)).toFixed(4),
      Math.max(0, Math.min(1, kneeRaw)).toFixed(4),
      Math.max(0, Math.min(1, radiusRaw)).toFixed(4),
      Math.max(0, Math.min(1, anamorphicRaw)).toFixed(4),
      Math.max(0, Math.min(1.5, redRaw)).toFixed(4),
      Math.max(0, Math.min(1.5, greenRaw)).toFixed(4),
      Math.max(0, Math.min(1.5, blueRaw)).toFixed(4),
    ].join(':');
  }
  if (type === 'edgefeather' || type === 'edge-feather') {
    const mixRaw = firstFiniteParam(params, ['edgeFeatherMix', 'mix', 'amount'], 1);
    const topRaw = firstFiniteParam(params, ['featherTop', 'edgeFeatherTop'], 0);
    const bottomRaw = firstFiniteParam(params, ['featherBottom', 'edgeFeatherBottom'], 0);
    const leftRaw = firstFiniteParam(params, ['featherLeft', 'edgeFeatherLeft'], 0);
    const rightRaw = firstFiniteParam(params, ['featherRight', 'edgeFeatherRight'], 0);
    const softnessRaw = firstFiniteParam(params, ['featherSoftness', 'edgeFeatherSoftness', 'softness'], 0.5);
    const gammaRaw = firstFiniteParam(params, ['featherGamma', 'edgeFeatherGamma', 'gamma'], 1);
    const matteRaw = firstFiniteParam(params, ['featherMattePreview', 'edgeFeatherMattePreview', 'matte'], 0);
    return [
      'edge-feather',
      Math.max(0, Math.min(1, mixRaw)).toFixed(4),
      Math.max(0, Math.min(1, topRaw)).toFixed(4),
      Math.max(0, Math.min(1, bottomRaw)).toFixed(4),
      Math.max(0, Math.min(1, leftRaw)).toFixed(4),
      Math.max(0, Math.min(1, rightRaw)).toFixed(4),
      Math.max(0, Math.min(2, softnessRaw)).toFixed(4),
      Math.max(0.1, Math.min(4, gammaRaw)).toFixed(4),
      Math.max(0, Math.min(1, Math.round(matteRaw))).toFixed(0),
    ].join(':');
  }
  if (type === 'dither') {
    const intensityRaw = firstFiniteParam(params, ['ditherIntensity', 'intensity', 'amount'], 1);
    const typeRaw = firstFiniteParam(params, ['ditherType', 'mode'], 0);
    const scaleRaw = firstFiniteParam(params, ['ditherScale', 'scale'], 1);
    const depthRaw = firstFiniteParam(params, ['ditherColorDepth', 'colorDepth'], 2);
    const paletteRaw = firstFiniteParam(params, ['ditherPalette', 'palette'], 0);
    const pixelLockRaw = firstFiniteParam(params, ['ditherPixelLock', 'pixelLock'], 0);
    return [
      'dither',
      Math.max(0, Math.min(1, intensityRaw)).toFixed(4),
      Math.max(0, Math.min(4, Math.round(typeRaw))).toFixed(0),
      Math.max(0.5, Math.min(64, scaleRaw)).toFixed(4),
      Math.max(1, Math.min(8, depthRaw)).toFixed(4),
      Math.max(0, Math.min(5, Math.round(paletteRaw))).toFixed(0),
      Math.max(0, Math.min(1, Math.round(pixelLockRaw))).toFixed(0),
    ].join(':');
  }
  if (type === 'outline') {
    const outlineColor = Array.isArray(params.outlineColor) ? params.outlineColor : [];
    const thicknessRaw = firstFiniteParam(params, ['outlineThickness', 'thickness', 'amount'], 2);
    const redRaw = firstFiniteParam(params, ['outlineR', 'red'], Number(outlineColor[0] ?? 1));
    const greenRaw = firstFiniteParam(params, ['outlineG', 'green'], Number(outlineColor[1] ?? 1));
    const blueRaw = firstFiniteParam(params, ['outlineB', 'blue'], Number(outlineColor[2] ?? 1));
    const onlyRaw = firstFiniteParam(params, ['outlineOnly', 'only'], 0);
    const glowRaw = firstFiniteParam(params, ['outlineGlow', 'glow'], 0);
    const positionRaw = firstFiniteParam(params, ['outlinePosition', 'position'], 1);
    const crawlRaw = firstFiniteParam(params, ['outlineCrawl', 'crawl', 'speed'], 0);
    const alphaRaw = firstFiniteParam(params, ['outlineAlphaAware', 'alphaAware'], 0);
    return [
      'outline',
      Math.max(0, Math.min(12, thicknessRaw)).toFixed(4),
      Math.max(0, Math.min(1.5, redRaw)).toFixed(4),
      Math.max(0, Math.min(1.5, greenRaw)).toFixed(4),
      Math.max(0, Math.min(1.5, blueRaw)).toFixed(4),
      Math.max(0, Math.min(1, Math.round(onlyRaw))).toFixed(0),
      Math.max(0, Math.min(1, glowRaw)).toFixed(4),
      Math.max(0, Math.min(2, Math.round(positionRaw))).toFixed(0),
      Math.max(0, Math.min(1, crawlRaw)).toFixed(4),
      Math.max(0, Math.min(1, Math.round(alphaRaw))).toFixed(0),
    ].join(':');
  }
  if (type === 'emboss') {
    const strengthRaw = firstFiniteParam(params, ['embossStrength', 'strength', 'amount'], 1);
    const angleRaw = firstFiniteParam(params, ['embossAngle', 'angle'], 135);
    const heightRaw = firstFiniteParam(params, ['embossHeight', 'height'], 1);
    const highlightRRaw = firstFiniteParam(params, ['embossHighlightR', 'red'], 1);
    const highlightGRaw = firstFiniteParam(params, ['embossHighlightG', 'green'], 1);
    const highlightBRaw = firstFiniteParam(params, ['embossHighlightB', 'blue'], 1);
    const shadowRRaw = firstFiniteParam(params, ['embossShadowR'], 0);
    const shadowGRaw = firstFiniteParam(params, ['embossShadowG'], 0);
    const shadowBRaw = firstFiniteParam(params, ['embossShadowB'], 0);
    return [
      'emboss',
      Math.max(0, Math.min(2, strengthRaw)).toFixed(4),
      (((angleRaw % 360) + 360) % 360).toFixed(4),
      Math.max(0, Math.min(1, heightRaw)).toFixed(4),
      Math.max(0, Math.min(1.5, highlightRRaw)).toFixed(4),
      Math.max(0, Math.min(1.5, highlightGRaw)).toFixed(4),
      Math.max(0, Math.min(1.5, highlightBRaw)).toFixed(4),
      Math.max(0, Math.min(1.5, shadowRRaw)).toFixed(4),
      Math.max(0, Math.min(1.5, shadowGRaw)).toFixed(4),
      Math.max(0, Math.min(1.5, shadowBRaw)).toFixed(4),
    ].join(':');
  }
  if (type === 'crt') {
    const scanlinesRaw = firstFiniteParam(params, ['crtScanlines', 'scanlines', 'intensity', 'amount'], 0.5);
    const countRaw = firstFiniteParam(params, ['crtScanCount', 'scanCount', 'count'], 480);
    const maskRaw = firstFiniteParam(params, ['crtMask', 'mask'], 0.5);
    const maskTypeRaw = firstFiniteParam(params, ['crtMaskType', 'maskType', 'mode'], 0);
    const curvatureRaw = firstFiniteParam(params, ['crtCurvature', 'curvature'], 0.3);
    const vignetteRaw = firstFiniteParam(params, ['crtVignette', 'vignette'], 0.4);
    const glowRaw = firstFiniteParam(params, ['crtGlow', 'glow'], 0.5);
    const rollingRaw = firstFiniteParam(params, ['crtRollingBar', 'rollingBar'], 0);
    const chromaticRaw = firstFiniteParam(params, ['crtChromatic', 'chromatic'], 0.3);
    return [
      'crt',
      Math.max(0, Math.min(1, scanlinesRaw)).toFixed(4),
      Math.max(32, Math.min(1200, countRaw)).toFixed(4),
      Math.max(0, Math.min(1, maskRaw)).toFixed(4),
      Math.max(0, Math.min(2, Math.round(maskTypeRaw))).toFixed(0),
      Math.max(0, Math.min(1, curvatureRaw)).toFixed(4),
      Math.max(0, Math.min(1, vignetteRaw)).toFixed(4),
      Math.max(0, Math.min(1, glowRaw)).toFixed(4),
      Math.max(0, Math.min(1, rollingRaw)).toFixed(4),
      Math.max(0, Math.min(1, chromaticRaw)).toFixed(4),
    ].join(':');
  }
  if (type === 'thermal') {
    const intensityRaw = firstFiniteParam(params, ['thermalIntensity', 'intensity', 'amount'], 1);
    const paletteRaw = firstFiniteParam(params, ['thermalPalette', 'palette'], 0);
    const shimmerRaw = firstFiniteParam(params, ['thermalShimmer', 'shimmer'], 0);
    const noiseRaw = firstFiniteParam(params, ['thermalSensorNoise', 'sensorNoise', 'noise'], 0);
    return [
      'thermal',
      Math.max(0.05, Math.min(2, intensityRaw)).toFixed(4),
      Math.max(0, Math.min(4, Math.round(paletteRaw))).toFixed(0),
      Math.max(0, Math.min(1, shimmerRaw)).toFixed(4),
      Math.max(0, Math.min(1, noiseRaw)).toFixed(4),
    ].join(':');
  }
  if (type === 'nightvision' || type === 'night-vision') {
    const intensityRaw = firstFiniteParam(params, ['nightVisionIntensity', 'intensity', 'amount'], 1.5);
    const noiseRaw = firstFiniteParam(params, ['nightVisionNoise', 'noise'], 0.3);
    const vignetteRaw = firstFiniteParam(params, ['nightVisionVignette', 'vignette'], 0.5);
    const phosphorRaw = firstFiniteParam(params, ['nightVisionPhosphor', 'phosphor'], 0);
    const bloomRaw = firstFiniteParam(params, ['nightVisionBloom', 'bloom'], 0.6);
    const scopeRaw = firstFiniteParam(params, ['nightVisionScopeMask', 'scopeMask'], 1);
    const rollingRaw = firstFiniteParam(params, ['nightVisionRollingNoise', 'rollingNoise', 'rollingBar'], 0);
    return [
      'night-vision',
      Math.max(0, Math.min(2, intensityRaw)).toFixed(4),
      Math.max(0, Math.min(1, noiseRaw)).toFixed(4),
      Math.max(0, Math.min(1, vignetteRaw)).toFixed(4),
      Math.max(0, Math.min(2, Math.round(phosphorRaw))).toFixed(0),
      Math.max(0, Math.min(2, bloomRaw)).toFixed(4),
      Math.max(0, Math.min(2, Math.round(scopeRaw))).toFixed(0),
      Math.max(0, Math.min(1, rollingRaw)).toFixed(4),
    ].join(':');
  }

  // Keep explicit descriptor IDs compatible with native descriptor parser.
  const effectId = typeof effect.id === 'string' ? effect.id.trim() : '';
  if (effectId.includes(':')) return effectId.toLowerCase();
  return null;
}

export function nativeEffectPassFromDescriptor(descriptor: string | null): NativeEffectPassRuntime | null {
  if (!descriptor) return null;
  const [
    rawId,
    rawAmount,
    rawParam0,
    rawParam1,
    rawParam2,
    rawParam3,
    rawParam4,
    rawParam5,
    rawParam6,
    rawParam7,
  ] = descriptor.split(':');
  const effect = rawId.trim().toLowerCase() as NativeEffectPassId;
  if (!NATIVE_EFFECT_PASS_IDS.has(effect)) return null;
  const amount = rawAmount !== undefined && rawAmount.trim().length > 0
    ? Number(rawAmount)
    : undefined;
  if (amount !== undefined && !Number.isFinite(amount)) return null;
  let params: NativeEffectPassRuntime['params'];
  if (effect === 'pixelate') {
    params = {
      mode: Number(rawParam0 ?? 0),
      gridLines: Number(rawParam1 ?? 0),
      animSpeed: Number(rawParam2 ?? 0),
      animAmount: Number(rawParam3 ?? 0),
    };
  } else if (effect === 'vignette') {
    params = {
      softness: Number(rawParam0 ?? 0.4),
      roundness: Number(rawParam1 ?? 0.5),
      shape: Number(rawParam2 ?? 0),
      aspect: Number(rawParam3 ?? 1),
      centerX: Number(rawParam4 ?? 0.5),
      centerY: Number(rawParam5 ?? 0.5),
      tintAmount: Number(rawParam6 ?? 0),
      breathing: Number(rawParam7 ?? 0),
    };
  } else if (effect === 'rgb-shift') {
    params = {
      angle: Number(rawParam0 ?? 0),
      mode: Number(rawParam1 ?? 0),
      centerX: Number(rawParam2 ?? 0.5),
      centerY: Number(rawParam3 ?? 0.5),
      prismSpread: Number(rawParam4 ?? 1),
    };
  } else if (effect === 'scanlines') {
    params = {
      count: Number(rawParam0 ?? 200),
      speed: Number(rawParam1 ?? 0),
      phosphor: Number(rawParam2 ?? 0),
      rollingBar: Number(rawParam3 ?? 0),
      curvature: Number(rawParam4 ?? 0),
      interlace: Number(rawParam5 ?? 0),
    };
  } else if (effect === 'blur') {
    params = {
      mode: Number(rawParam0 ?? 1),
      angle: Number(rawParam1 ?? 0),
      param2: Number(rawParam2 ?? 1),
      edgeProtect: Number(rawParam3 ?? 0.3),
      outputMix: Number(rawParam4 ?? 1),
    };
  } else if (effect === 'chromatic-aberration') {
    params = {
      mode: Number(rawParam0 ?? 1),
      angle: Number(rawParam1 ?? 0),
      centerX: Number(rawParam2 ?? 0.5),
      centerY: Number(rawParam3 ?? 0.5),
      edgeFalloff: Number(rawParam4 ?? 0.5),
      outputMix: Number(rawParam5 ?? 1),
    };
  } else if (effect === 'glitch') {
    params = {
      speed: Number(rawParam0 ?? 1),
      blockSize: Number(rawParam1 ?? 0.3),
      rgbSplit: Number(rawParam2 ?? 0.5),
      jitter: Number(rawParam3 ?? 0.3),
      verticalSlice: Number(rawParam4 ?? 0),
      blockHold: Number(rawParam5 ?? 0.3),
      tearChance: Number(rawParam6 ?? 0),
      triggerMode: Number(rawParam7 ?? 0),
    };
  } else if (effect === 'exposure') {
    params = {
      rollOff: Number(rawParam0 ?? 0),
      highlightProtect: Number(rawParam1 ?? 0),
    };
  } else if (effect === 'vibrance') {
    params = {
      skinProtect: Number(rawParam0 ?? 0.5),
      highlightProtect: Number(rawParam1 ?? 0.3),
      ceiling: Number(rawParam2 ?? 1),
    };
  } else if (effect === 'temperature-tint') {
    params = {
      tint: Number(rawParam0 ?? 0),
      shadowTemp: Number(rawParam1 ?? 0),
      highlightTemp: Number(rawParam2 ?? 0),
      splitTone: Number(rawParam3 ?? 0),
      autoCycle: Number(rawParam4 ?? 0),
    };
  } else if (effect === 'sharpen') {
    params = {
      mode: Number(rawParam0 ?? 0),
      radius: Number(rawParam1 ?? 2),
      edgeProtect: Number(rawParam2 ?? 0.2),
      intensity: Number(rawParam3 ?? 0),
    };
  } else if (effect === 'directional-blur') {
    params = {
      angle: Number(rawParam0 ?? 0),
      samples: Number(rawParam1 ?? 16),
      falloff: Number(rawParam2 ?? 0.3),
      centerBias: Number(rawParam3 ?? 0),
      outputMix: Number(rawParam4 ?? 1),
    };
  } else if (effect === 'zoom-blur') {
    params = {
      centerX: Number(rawParam0 ?? 0.5),
      centerY: Number(rawParam1 ?? 0.5),
      samples: Number(rawParam2 ?? 16),
      falloff: Number(rawParam3 ?? 0.3),
      chromatic: Number(rawParam4 ?? 0),
      outputMix: Number(rawParam5 ?? 1),
    };
  } else if (effect === 'radial-blur') {
    params = {
      centerX: Number(rawParam0 ?? 0.5),
      centerY: Number(rawParam1 ?? 0.5),
      samples: Number(rawParam2 ?? 16),
      falloff: Number(rawParam3 ?? 0.3),
      radiusInner: Number(rawParam4 ?? 0),
      radiusOuter: Number(rawParam5 ?? 0.7),
      outputMix: Number(rawParam6 ?? 1),
    };
  } else if (effect === 'kaleidoscope') {
    params = {
      segments: Number(rawParam0 ?? 6),
      angle: Number(rawParam1 ?? 0),
      centerX: Number(rawParam2 ?? 0.5),
      centerY: Number(rawParam3 ?? 0.5),
      zoom: Number(rawParam4 ?? 1),
      mode: Number(rawParam5 ?? 0),
      spiral: Number(rawParam6 ?? 0),
      animSpeed: Number(rawParam7 ?? 0),
    };
  } else if (effect === 'mirror') {
    params = {
      mode: Number(rawParam0 ?? 0),
      position: Number(rawParam1 ?? 0.5),
      offset: Number(rawParam2 ?? 0.5),
      flipSide: Number(rawParam3 ?? 0),
    };
  } else if (effect === 'wave') {
    params = {
      mode: Number(rawParam0 ?? 0),
      waveform: Number(rawParam1 ?? 0),
      frequency: Number(rawParam2 ?? 5),
      speed: Number(rawParam3 ?? 1),
      phase: Number(rawParam4 ?? 0),
      secondary: Number(rawParam5 ?? 0),
      chromaSplit: Number(rawParam6 ?? 0),
    };
  } else if (effect === 'fisheye') {
    params = {
      radius: Number(rawParam0 ?? 1),
      centerX: Number(rawParam1 ?? 0.5),
      centerY: Number(rawParam2 ?? 0.5),
      zoom: Number(rawParam3 ?? 1),
      mode: Number(rawParam4 ?? 0),
      edgeFalloff: Number(rawParam5 ?? 0),
    };
  } else if (effect === 'lens-distortion') {
    params = {
      mode: Number(rawParam0 ?? 0),
      centerX: Number(rawParam1 ?? 0.5),
      centerY: Number(rawParam2 ?? 0.5),
      cubic: Number(rawParam3 ?? 0),
      anamorphicX: Number(rawParam4 ?? 1.3),
      edgeFade: Number(rawParam5 ?? 1),
      chromatic: Number(rawParam6 ?? 0),
    };
  } else if (effect === 'twirl') {
    params = {
      radius: Number(rawParam0 ?? 0.5),
      centerX: Number(rawParam1 ?? 0.5),
      centerY: Number(rawParam2 ?? 0.5),
      falloff: Number(rawParam3 ?? 1.5),
      animSpeed: Number(rawParam4 ?? 0),
      outputMix: Number(rawParam5 ?? 1),
    };
  } else if (effect === 'pinch-bulge') {
    params = {
      radius: Number(rawParam0 ?? 0.5),
      centerX: Number(rawParam1 ?? 0.5),
      centerY: Number(rawParam2 ?? 0.5),
      falloff: Number(rawParam3 ?? 1.5),
      chromatic: Number(rawParam4 ?? 0),
      outputMix: Number(rawParam5 ?? 1),
    };
  } else if (effect === 'chroma-key') {
    params = {
      keyR: Number(rawParam0 ?? 0),
      keyG: Number(rawParam1 ?? 1),
      keyB: Number(rawParam2 ?? 0),
      softness: Number(rawParam3 ?? 0.15),
      spill: Number(rawParam4 ?? 0.6),
      matte: Number(rawParam5 ?? 0),
      mode: Number(rawParam6 ?? 1),
    };
  } else if (effect === 'luma-key') {
    params = {
      highCut: Number(rawParam0 ?? 0.6),
      invert: Number(rawParam1 ?? 0),
      gamma: Number(rawParam2 ?? 1),
      matte: Number(rawParam3 ?? 0),
      premultiply: Number(rawParam4 ?? 0),
    };
  } else if (effect === 'difference-key') {
    params = {
      refR: Number(rawParam0 ?? 0),
      refG: Number(rawParam1 ?? 0),
      refB: Number(rawParam2 ?? 0),
      softness: Number(rawParam3 ?? 0.15),
      invert: Number(rawParam4 ?? 0),
      matte: Number(rawParam5 ?? 0),
      mode: Number(rawParam6 ?? 0),
    };
  } else if (effect === 'erode' || effect === 'dilate') {
    params = {
      shape: Number(rawParam0 ?? 1),
      channel: Number(rawParam1 ?? 0),
      outputMix: Number(rawParam2 ?? 1),
    };
  } else if (effect === 'edge-detect') {
    const flags = Number(rawParam2 ?? 0);
    params = {
      thickness: Number(rawParam0 ?? 1),
      mode: Number(rawParam1 ?? 0),
      invert: flags & 1,
      edgeOnlyAlpha: (flags & 2) ? 1 : 0,
      edgeTintR: Number(rawParam3 ?? 1),
      edgeTintG: Number(rawParam4 ?? 1),
      edgeTintB: Number(rawParam5 ?? 1),
      tintEdges: Number(rawParam6 ?? 0),
      edgeGlow: Number(rawParam7 ?? 0),
    };
  } else if (effect === 'film-grain') {
    params = {
      grainSize: Number(rawParam0 ?? 1),
      grainShadow: Number(rawParam1 ?? 0.7),
      grainMid: Number(rawParam2 ?? 1),
      grainHigh: Number(rawParam3 ?? 0.5),
      grainMono: Number(rawParam4 ?? 0),
      grainStock: Number(rawParam5 ?? 1),
      grainColorJitter: Number(rawParam6 ?? 0),
      grainAnimSpeed: Number(rawParam7 ?? 1),
    };
  } else if (effect === 'filmic-tonemap') {
    params = {
      tonemapCurve: Number(rawParam0 ?? 0),
      tonemapExposure: Number(rawParam1 ?? 1),
      tonemapContrast: Number(rawParam2 ?? 0),
    };
  } else if (effect === 'bloom') {
    params = {
      bloomIntensity: Number(rawParam0 ?? 1),
      threshold: Number(rawParam1 ?? 0.6),
      bloomKnee: Number(rawParam2 ?? 0.4),
      bloomRadius: Number(rawParam3 ?? 0.5),
      bloomAnamorphic: Number(rawParam4 ?? 0),
      red: Number(rawParam5 ?? 1),
      green: Number(rawParam6 ?? 1),
      blue: Number(rawParam7 ?? 1),
    };
  } else if (effect === 'colorama') {
    params = {
      coloramaPalette: Number(rawParam0 ?? 0),
      coloramaOffset: Number(rawParam1 ?? 0),
      coloramaSpeed: Number(rawParam2 ?? 0.2),
      coloramaContrast: Number(rawParam3 ?? 1),
      coloramaBands: Number(rawParam4 ?? 0),
      coloramaAudioReact: Number(rawParam5 ?? 0),
      coloramaHueShift: Number(rawParam6 ?? 0),
      audio: Number(rawParam7 ?? 0),
    };
  } else if (effect === 'edge-feather') {
    params = {
      featherTop: Number(rawParam0 ?? 0),
      featherBottom: Number(rawParam1 ?? 0),
      featherLeft: Number(rawParam2 ?? 0),
      featherRight: Number(rawParam3 ?? 0),
      featherSoftness: Number(rawParam4 ?? 0.5),
      featherGamma: Number(rawParam5 ?? 1),
      featherMattePreview: Number(rawParam6 ?? 0),
    };
  } else if (effect === 'dither') {
    params = {
      ditherType: Number(rawParam0 ?? 0),
      ditherScale: Number(rawParam1 ?? 1),
      ditherColorDepth: Number(rawParam2 ?? 2),
      ditherPalette: Number(rawParam3 ?? 0),
      ditherPixelLock: Number(rawParam4 ?? 0),
    };
  } else if (effect === 'outline') {
    params = {
      outlineR: Number(rawParam0 ?? 1),
      outlineG: Number(rawParam1 ?? 1),
      outlineB: Number(rawParam2 ?? 1),
      outlineOnly: Number(rawParam3 ?? 0),
      outlineGlow: Number(rawParam4 ?? 0),
      outlinePosition: Number(rawParam5 ?? 1),
      outlineCrawl: Number(rawParam6 ?? 0),
      outlineAlphaAware: Number(rawParam7 ?? 0),
    };
  } else if (effect === 'emboss') {
    params = {
      embossAngle: Number(rawParam0 ?? 135),
      embossHeight: Number(rawParam1 ?? 1),
      embossHighlightR: Number(rawParam2 ?? 1),
      embossHighlightG: Number(rawParam3 ?? 1),
      embossHighlightB: Number(rawParam4 ?? 1),
      embossShadowR: Number(rawParam5 ?? 0),
      embossShadowG: Number(rawParam6 ?? 0),
      embossShadowB: Number(rawParam7 ?? 0),
    };
  } else if (effect === 'crt') {
    params = {
      crtScanCount: Number(rawParam0 ?? 480),
      crtMask: Number(rawParam1 ?? 0.5),
      crtMaskType: Number(rawParam2 ?? 0),
      crtCurvature: Number(rawParam3 ?? 0.3),
      crtVignette: Number(rawParam4 ?? 0.4),
      crtGlow: Number(rawParam5 ?? 0.5),
      crtRollingBar: Number(rawParam6 ?? 0),
      crtChromatic: Number(rawParam7 ?? 0.3),
    };
  } else if (effect === 'thermal') {
    params = {
      thermalPalette: Number(rawParam0 ?? 0),
      thermalShimmer: Number(rawParam1 ?? 0),
      thermalSensorNoise: Number(rawParam2 ?? 0),
    };
  } else if (effect === 'night-vision') {
    params = {
      nightVisionNoise: Number(rawParam0 ?? 0.3),
      nightVisionVignette: Number(rawParam1 ?? 0.5),
      nightVisionPhosphor: Number(rawParam2 ?? 0),
      nightVisionBloom: Number(rawParam3 ?? 0.6),
      nightVisionScopeMask: Number(rawParam4 ?? 1),
      nightVisionRollingNoise: Number(rawParam5 ?? 0),
    };
  }
  if (params && Object.values(params).some((value) => !Number.isFinite(value))) return null;
  return {
    effect,
    descriptor,
    amount,
    params,
  };
}

function nativeEffectPassesForLayer(layer: Layer): NativeEffectPassRuntime[] | null {
  const enabled = (layer.effects || []).filter((effect: any) => effect && effect.enabled !== false);
  if (!enabled.length || enabled.length > 4) return null;
  const passes = enabled.map((effect: any) =>
    nativeEffectPassFromDescriptor(effectToNativeDescriptor(effect)),
  );
  if (passes.some((effect) => !effect)) return null;
  return passes as NativeEffectPassRuntime[];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hh = ((h % 360) + 360) % 360;
  const ss = Math.max(0, Math.min(1, s / 100));
  const ll = Math.max(0, Math.min(1, l / 100));
  const c = (1 - Math.abs(2 * ll - 1)) * ss;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = ll - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hh < 60) {
    r = c; g = x; b = 0;
  } else if (hh < 120) {
    r = x; g = c; b = 0;
  } else if (hh < 180) {
    r = 0; g = c; b = x;
  } else if (hh < 240) {
    r = 0; g = x; b = c;
  } else if (hh < 300) {
    r = x; g = 0; b = c;
  } else {
    r = c; g = 0; b = x;
  }
  return [r + m, g + m, b + m];
}

function layerRgba(layer: Layer): [number, number, number, number] | null {
  if (layer.type !== 'color' || !layer.colorContent) return null;
  const c = layer.colorContent;
  const [r, g, b] = hslToRgb(c.hue, c.saturation, c.lightness);
  const a = Math.max(0, Math.min(1, c.alpha));
  return [r, g, b, a];
}

function colorSignature(layer: Layer): string {
  const rgba = layerRgba(layer);
  if (!rgba) return 'none';
  return `${rgba[0].toFixed(4)}:${rgba[1].toFixed(4)}:${rgba[2].toFixed(4)}:${rgba[3].toFixed(4)}`;
}

function geometrySignature(layer: Layer): string {
  const c = layer.corners;
  if (!c) return 'none';
  return [
    c.topLeft.x, c.topLeft.y,
    c.topRight.x, c.topRight.y,
    c.bottomRight.x, c.bottomRight.y,
    c.bottomLeft.x, c.bottomLeft.y,
  ].map((v) => Number.isFinite(v) ? v.toFixed(5) : 'nan').join(':');
}

function contentFitCode(value: Layer['contentFit']): number {
  if (value === 'fill') return 1;
  if (value === 'crop') return 2;
  return 0;
}

function quantizeNative(value: number, digits = 5): number {
  return Number((Number.isFinite(value) ? value : 0).toFixed(digits));
}

function normalizedCropRegion(layer: Layer): { x: number; y: number; width: number; height: number } | null {
  const crop = layer.cropRegion;
  if (!crop) return null;
  const width = clampNumber(Number(crop.width), 0.001, 1);
  const height = clampNumber(Number(crop.height), 0.001, 1);
  const x = clampNumber(Number(crop.x), 0, 1 - width);
  const y = clampNumber(Number(crop.y), 0, 1 - height);
  return { x, y, width, height };
}

function layerAspectFromCorners(layer: Layer, outputWidth: number, outputHeight: number): number {
  const c = layer.corners;
  if (!c) return Math.max(0.001, outputWidth / Math.max(1, outputHeight));
  const minX = Math.min(c.topLeft.x, c.bottomLeft.x, c.topRight.x, c.bottomRight.x);
  const maxX = Math.max(c.topLeft.x, c.bottomLeft.x, c.topRight.x, c.bottomRight.x);
  const minY = Math.min(c.topLeft.y, c.bottomLeft.y, c.topRight.y, c.bottomRight.y);
  const maxY = Math.max(c.topLeft.y, c.bottomLeft.y, c.topRight.y, c.bottomRight.y);
  const width = (maxX - minX) * Math.max(1, outputWidth);
  const height = (maxY - minY) * Math.max(1, outputHeight);
  return height > 0 ? clampNumber(width / height, 0.001, 128) : 1;
}

function nativeLayerShapeState(layer: Layer): NativeLayerShapeState {
  const shape = layer.layerShape;
  const activeType = shape?.enabled ? shape.type : 'rectangle';
  const params = shape?.params ?? {};
  const unsupported = !!params.invert || activeType === 'custom';
  const shapeType =
    unsupported ? 0 :
    activeType === 'circle' ? 1 :
    activeType === 'triangle' ? 2 :
    0;
  const feather = shapeType > 0 ? clampNumber(Number(params.feather ?? 0), 0, 1) : 0;
  const rotation = shapeType > 0 ? (Number(params.rotation ?? 0) * Math.PI) / 180 : 0;
  const scale = shapeType > 0 ? clampNumber(Number(params.scale ?? 1), 0.0001, 8) : 1;
  const payload: NativeVec4 = [
    shapeType,
    quantizeNative(feather),
    quantizeNative(rotation),
    quantizeNative(scale),
  ];
  return {
    shape: payload,
    signature: payload.map((value, index) => value.toFixed(index === 0 ? 0 : 5)).join(':'),
  };
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function finiteParam(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function firstFiniteParam(params: Record<string, any>, keys: string[], fallback: number): number {
  for (const key of keys) {
    const n = finiteParam(params[key]);
    if (n !== null) return n;
  }
  return fallback;
}

function hashUnit(input: string): number {
  const hex = hashString(input);
  const n = parseInt(hex.slice(-6), 16);
  if (!Number.isFinite(n)) return 0;
  return n / 0xffffff;
}

function normalizeCountParam(value: unknown): number | null {
  const n = finiteParam(value);
  if (n === null) return null;
  const count = clampNumber(n, 1000, 1_000_000);
  return clampNumber((Math.log10(count) - 3) / 3, 0, 1);
}

function normalizeRangeParam(value: unknown, min: number, max: number): number | null {
  const n = finiteParam(value);
  if (n === null || max <= min) return null;
  return clampNumber((n - min) / (max - min), 0, 1);
}

function normalizeScaleParam(params: Record<string, any>, shaderId = ''): number {
  const baseSize = finiteParam(params.baseSize);
  if (baseSize !== null) return clampNumber(baseSize / 0.006, 0.18, 4);
  const radius = finiteParam(params.radiusScale);
  if (radius !== null) {
    if (shaderId === 'volumetric-balls') return clampNumber(radius / 0.085, 0.18, 4);
    return clampNumber(radius, 0.18, 4);
  }
  const zoom = finiteParam(params.zoom);
  if (zoom !== null) return clampNumber(zoom, 0.18, 4);
  const distance = finiteParam(params.distance);
  if (distance !== null) return clampNumber(1.45 / Math.max(0.1, distance), 0.18, 4);
  return 1;
}

function nativeGpuParams(layer: Layer): [number, number, number, number, number, number, number, number] | null {
  if (layer.type !== 'gpu' || !layer.gpuLayerContent) return null;
  const content = layer.gpuLayerContent;
  const params = content.params ?? {};
  const shaderId = content.shaderId || 'gpu';
  const normalizedShaderId = String(shaderId).trim().toLowerCase();
  const isVolumetricBalls = normalizedShaderId === 'volumetric-balls';
  const intensity = clampNumber(
    firstFiniteParam(params, ['brightness', 'sunBrightness', 'exposure', 'opacity', 'sphereOpacity'], 1),
    0,
    4,
  );
  const scale = normalizeScaleParam(params, normalizedShaderId);
  const sphereCountDensity = normalizeRangeParam(params.sphereCount, 24, 1200);
  const density =
    (isVolumetricBalls ? sphereCountDensity : null)
    ?? normalizeCountParam(params.particleCount)
    ?? clampNumber(firstFiniteParam(params, ['smokeDensity', 'cloudCoverage', 'starDensity', 'fogDensity', 'density'], 0.5) / 4, 0, 1);
  const rawSpeed = firstFiniteParam(params, ['cloudSpeed', 'autoSpin', 'motionSpeed', 'speed', 'autoRotateY', 'autoRotateX', 'autoRotateZ', 'colorCycleSpeed', 'hueShiftSpeed'], 1);
  const speed = clampNumber(Math.abs(rawSpeed) / 8, 0, 2);
  const palette = hashUnit([
    shaderId,
    params.planet ?? '',
    params.topology ?? '',
    params.mode ?? '',
    params.style ?? '',
    params.colorMode ?? '',
    params.colorMap ?? '',
    params.palette ?? '',
  ].join(':'));
  const variation = clampNumber(
    firstFiniteParam(params, ['radiusVariance', 'ringOpacity', 'cloudThickness', 'fogOpacity', 'materialReflection', 'shimmerStrength'], 0.5)
      / (isVolumetricBalls ? 1 : 2),
    0,
    1,
  );
  const detail = isVolumetricBalls
    ? clampNumber(0.5 + (sphereCountDensity ?? 0.2) * 0.5, 0, 1)
    : clampNumber(
        firstFiniteParam(params, ['ringDetail', 'partnerCount', 'emitterCount', 'shadowSteps', 'gravityWells'], 1) / 16,
        0,
        1,
      );
  const bgOpacity = clampNumber(finiteParam(content.bgOpacity) ?? 1, 0, 1);
  return [
    intensity,
    scale,
    density,
    speed,
    palette,
    variation,
    detail,
    bgOpacity,
  ].map((value) => Number(value.toFixed(4))) as [number, number, number, number, number, number, number, number];
}

function nativeParamsSignature(layer: Layer): string {
  const params = nativeGpuParams(layer);
  return params ? params.map((value) => value.toFixed(4)).join(':') : 'none';
}

function stableNativeGraphKey(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Number(value.toFixed(5)).toString() : '0';
  }
  if (typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableNativeGraphKey).join(',')}]`;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableNativeGraphKey(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(String(value));
}

function toSourceType(layer: Layer): string {
  return nativeLayerSource(layer).sourceType;
}

function gpuNativeSourceType(shaderId: string | undefined | null): string {
  const id = String(shaderId || 'gpu').trim().toLowerCase();
  return `gpu:${id || 'gpu'}`;
}

function nativeLayerSourceFromMediaSource(
  src: NonNullable<Layer['source']>,
  previewElement: CanvasImageSource | null = null,
): NativeLayerSource {
  const sourceType = isSharedTextureUri(src.src) ? 'video' : (src.type || 'none');
  return {
    id: src.id,
    uri: src.src,
    sourceType,
    source: src,
    shouldPrefetch: true,
    shouldPreview: true,
    previewElement,
  };
}

function nativeGraphOutputSource(layer: Layer, kind: NativeGraphRouteKind): NativeLayerSource {
  const shaderId = layer.gpuLayerContent?.shaderId || 'gpu';
  const previewElement = ((layer as any)._gpuLayerPreviewCanvas ?? null) as CanvasImageSource | null;
  return {
    id: `gpu:${layer.id}:${shaderId}`,
    uri: `native-graph://${kind}/${layer.id}`,
    sourceType: 'image',
    source: null,
    shouldPrefetch: false,
    shouldPreview: false,
    previewElement,
  };
}

function nativeLayerSourceAspectHint(source: NativeLayerSource): number | undefined {
  const previewDims = source.previewElement ? drawableDimensions(source.previewElement) : null;
  if (previewDims) return clampNumber(previewDims.width / previewDims.height, 0.001, 128);
  const src = source.source as any;
  const candidates: Array<CanvasImageSource | null | undefined> = [
    src?.videoElement,
    src?.synthVisionCanvas,
    src?.threejsCanvas,
    src?.texture?.image as CanvasImageSource | undefined,
  ];
  for (const candidate of candidates) {
    const dims = candidate ? drawableDimensions(candidate) : null;
    if (dims) return clampNumber(dims.width / dims.height, 0.001, 128);
  }
  const width = Number(src?.width ?? src?.videoWidth ?? src?.naturalWidth ?? 0);
  const height = Number(src?.height ?? src?.videoHeight ?? src?.naturalHeight ?? 0);
  if (width > 0 && height > 0) return clampNumber(width / height, 0.001, 128);
  return undefined;
}

function nativeEffectPassOutputSource(layer: Layer, inputSource: NativeLayerSource): NativeLayerSource {
  return {
    id: `effect-pass:${layer.id}`,
    uri: `native-effect-pass://${layer.id}`,
    sourceType: 'image',
    source: null,
    shouldPrefetch: false,
    shouldPreview: false,
    previewElement: inputSource.previewElement ?? null,
    aspect: nativeLayerSourceAspectHint(inputSource),
  };
}

function nativeGraphBufferSafeId(value: string): string {
  return String(value || 'source').replace(/[^a-zA-Z0-9:_-]+/g, '_').slice(0, 160);
}

function nativeGraphRenderSource(route: NativeGraphLayerRoute): NativeLayerSource {
  return route.baseSource ?? route.source;
}

function nativeGraphBufferPrefixesForRoute(route: NativeGraphLayerRoute): string[] {
  const sourceId = String(nativeGraphRenderSource(route).id || '');
  const safeSourceId = nativeGraphBufferSafeId(sourceId);
  let prefixes: string[];
  switch (route.kind) {
    case 'planet':
      prefixes = [`planet:${safeSourceId}`];
      break;
    case 'smoke-3d':
      prefixes = [`3d-smoke:${safeSourceId}`];
      break;
    case 'particle-field':
      prefixes = [`particle-field:${safeSourceId}`];
      break;
    case 'volumetric-spheres':
      prefixes = [`volumetric-spheres:${safeSourceId}`];
      break;
    case 'smoke-riders':
      prefixes = [`3d-smoke:${safeSourceId}`, `volumetric-spheres:${safeSourceId}`];
      break;
    case 'ink-cloud':
      prefixes = [`ink-cloud:${safeSourceId}`];
      break;
    case 'flythrough':
      prefixes = [`flythrough:${safeSourceId}`];
      break;
    case 'pixel-particles':
      prefixes = [`pixel-particles:${safeSourceId}`];
      break;
    case 'point-cloud-fx':
      prefixes = [`${sourceId}:point-cloud-fx:`];
      break;
    case 'effect-pass':
      prefixes = [`effect-pass:${safeSourceId}`];
      break;
    default:
      prefixes = [];
      break;
  }
  if (route.effectPasses?.length) {
    prefixes.push(`effect-pass:${nativeGraphBufferSafeId(route.source.id)}`);
  }
  return prefixes;
}

function nativeSourceIdentity(source: NativeLayerSource | null | undefined): string {
  if (!source) return 'none';
  const src = source.source;
  if (src) return `${source.sourceType}:${src.id}:${src.src}:${src.name}`;
  return `${source.sourceType}:${source.id}:${source.uri}`;
}

function nativeGraphParamsForLayer(layer: Layer, kind: NativeGraphRouteKind): Record<string, any> {
  const params = layer.gpuLayerContent?.params ?? {};
  const shaderId = String(layer.gpuLayerContent?.shaderId || '').trim().toLowerCase();
  if (kind === 'particle-field' && shaderId === 'gravity-wells') {
    return {
      ...gravityWellsDefaultParams,
      ...params,
      mode: params.mode ?? gravityWellsDefaultParams.mode ?? 'gravity',
    };
  }
  return params;
}

function mediaItemToNativeLayerSource(item: MediaItem): NativeLayerSource {
  const previewElement =
    item.videoElement ??
    ((item.texture?.image ?? null) as CanvasImageSource | null);
  const source = {
    id: item.id,
    src: item.src,
    name: item.name,
    type: item.type,
    videoElement: item.videoElement,
    texture: item.texture,
  } as NonNullable<Layer['source']>;
  return nativeLayerSourceFromMediaSource(source, previewElement);
}

function fileSourceParamToNativeLayerSource(layer: Layer, src: Record<string, any>): NativeLayerSource | null {
  const url = typeof src.url === 'string' ? src.url : '';
  if (!url) return null;
  const mime = String(src.mime ?? '');
  const filename = String(src.name ?? url);
  const isVideo = mime.startsWith('video/') || /\.(mp4|webm|mov|m4v)(\?|$)/i.test(filename);
  const isPointCloud = /\.(ply|splat)(\?|$)/i.test(filename);
  const sourceType = isPointCloud ? 'point-cloud' : (isVideo ? 'video' : 'image');
  const source = {
    id: `gpu-file:${layer.id}:${hashString(String(src.assetRef?.id ?? src.assetRef?.path ?? url))}`,
    src: url,
    name: filename || 'GPU media source',
    type: sourceType,
  } as NonNullable<Layer['source']>;
  if (isPointCloud) {
    return {
      id: source.id,
      uri: source.src,
      sourceType,
      source,
      shouldPrefetch: false,
      shouldPreview: false,
    };
  }
  return nativeLayerSourceFromMediaSource(source);
}

function nativeLayerSource(layer: Layer): NativeLayerSource {
  const src = layer.source;
  if (src) {
    return nativeLayerSourceFromMediaSource(src);
  }

  if (layer.type === 'gpu' && layer.gpuLayerContent) {
    const shaderId = layer.gpuLayerContent.shaderId || 'gpu';
    const previewElement = ((layer as any)._gpuLayerPreviewCanvas ?? null) as CanvasImageSource | null;
    // Supported GPU layers are routed through nativeGraphOutputSource before
    // this fallback. Unsupported GPU layers use the actual WebGPU preview
    // canvas instead of legacy native lookalike proxies.
    return {
      id: `gpu:${layer.id}:${shaderId}`,
      uri: `gpu-preview://${shaderId}`,
      sourceType: 'image',
      source: null,
      shouldPrefetch: false,
      shouldPreview: !!previewElement,
      previewElement,
    };
  }

  const generated = generatedLayerPreview(layer);
  if (generated) {
    return {
      id: `generated:${layer.id}:${generated.key}`,
      uri: `generated://${layer.type}/${layer.id}/${generated.key.replace(/^_/, '')}`,
      sourceType: generated.sourceType,
      source: null,
      shouldPrefetch: false,
      shouldPreview: true,
      previewElement: generated.element,
    };
  }

  return {
    id: `none:${layer.id}`,
    uri: '',
    sourceType: 'none',
    source: null,
    shouldPrefetch: false,
    shouldPreview: false,
  };
}

function nativeLayerNeedsContinuousSync(layer: Layer): boolean {
  if (!layer.visible) return false;
  if (nativeEffectPassesForLayer(layer)?.some((effect) => effect.effect === 'noise')) return true;
  if (
    (layer.source?.type === 'shader' && layer.source?.shaderCode) ||
    (layer.type === 'gpu' && !!layer.gpuLayerContent)
  ) {
    return true;
  }

  const src = layer.source;
  if (
    src?.type === 'video' ||
    src?.type === 'spout' ||
    isSharedTextureUri(src?.src) ||
    !!src?.videoElement ||
    !!src?.threejsCanvas ||
    !!src?.synthVisionCanvas
  ) {
    return true;
  }

  if (generatedLayerPreview(layer)) return true;
  return GENERATED_LAYER_TYPES.has(String(layer.type));
}

function isSharedTextureUri(uri: string | undefined | null): boolean {
  if (!uri) return false;
  const u = String(uri).trim().toLowerCase();
  return u.startsWith('sharedtex:') || u.startsWith('sharedtex://');
}

function sharedTextureSenderName(src: NonNullable<Layer['source']>): string {
  const spoutSource = (src as any).spoutSource;
  if (typeof spoutSource === 'string') return spoutSource.trim();
  if (spoutSource && typeof spoutSource === 'object') {
    return String(spoutSource.senderName ?? spoutSource.name ?? '').trim();
  }
  if (src.type === 'spout') {
    const raw = String(src.src ?? '').trim();
    if (raw && !raw.toLowerCase().startsWith('live://')) return raw;
  }
  return '';
}

function isNativeSharedTextureSource(
  src: NonNullable<Layer['source']>,
  sourceType: string,
): boolean {
  return (
    src.type === 'spout' ||
    sourceType === 'spout' ||
    sourceType === 'syphon' ||
    isSharedTextureUri(src.src)
  );
}

export function buildNativeSharedTextureSourceFrameCommand(args: {
  sourceId: string;
  width: number;
  height: number;
  info: SpoutSharedTextureInfo & { handle: string };
  senderName?: string;
  seq: number;
}): RendererCommand {
  return {
    type: 'upload_source_gpu_shared_texture',
    source_id: args.sourceId,
    width: args.width,
    height: args.height,
    shared_handle: args.info.handle,
    platform: args.info.platform,
    format: args.info.format ?? undefined,
    handle_encoding: args.info.handleEncoding ?? 'base64',
    handle_byte_length: args.info.handleByteLength,
    frame: args.info.frame ?? undefined,
    sender_name: (args.info.senderName ?? args.senderName) || undefined,
    seq: args.seq,
  };
}

function isDynamicSourceFrameSource(
  src: NonNullable<Layer['source']>,
  sourceType: string,
): boolean {
  return sourceType === 'video' || isNativeSharedTextureSource(src, sourceType);
}

function isNativeStaticImageDecodeUri(uri: string | undefined | null): boolean {
  const value = String(uri ?? '').trim();
  if (!value) return false;
  const lower = value.toLowerCase();
  if (
    lower.startsWith('http://') ||
    lower.startsWith('https://') ||
    lower.startsWith('blob:') ||
    lower.startsWith('data:')
  ) {
    return false;
  }
  return (
    lower.startsWith('ghost-asset://') ||
    lower.startsWith('file://') ||
    value.startsWith('/') ||
    /^[A-Za-z]:[\\/]/.test(value)
  );
}

export class NativeRendererSync {
  private running = false;
  private startupReady = false;
  private frameId = 0;
  private pendingSync = false;
  private desiredWidth = 0;
  private desiredHeight = 0;
  private latestLayers: Layer[] = [];
  // RAF id for the shader uniform-animation loop. Previously a setInterval
  // which kept firing even when the page was hidden or minimised — RAF
  // auto-pauses on tab visibility and lines up with the compositor so uniform
  // uploads aren't done just to be thrown away.
  private shaderAnimationRaf: number | null = null;
  private audioSyncRaf: number | null = null;
  private audioUnsub: (() => void) | null = null;
  private lastAudioSig = '';
  private liveClockOriginMs = performance.now();
  private latestRenderClockSeconds: number | null = null;
  private lastRenderClockSentSeconds: number | null = null;
  private sentWidth = 0;
  private sentHeight = 0;
  private lastLayers = new Map<string, LayerSnapshot>();
  private precompiledShaders = new Set<string>();
  private nativeWgslStdlibWarmed = false;
  private nativeCoreMethods = new Set<string>();
  private nativeFeatureFlags: Record<string, boolean> = {};
  private nativeGraphInstruments = new Set<string>();
  private prefetchedSources = new Set<string>();
  private videoRefreshAt = new Map<string, number>();
  private nativeVideoPrefetchAt = new Map<string, number>();
  private sourcePreviewSeq = new Map<string, number>();
  private sourcePreviewNextAt = new Map<string, number>();
  private sourcePreviewSig = new Map<string, string>();
  private sourcePreviewFailures = new Map<string, number>();
  private sharedTextureUploadPending = new Map<string, SharedTextureUploadState>();
  private sharedTextureLastRejectedUploads = 0;
  private sharedTextureLastSuccessfulUploads = 0;
  private sharedTextureRejectWarnings = 0;
  private nativeImageDecodePending = new Map<string, NativeImageDecodeState>();
  private nativeImageDecodeBypass = new Set<string>();
  private nativeImageLastDecodeFailures = 0;
  private nativeImageLastDecodes = 0;
  private nativeImageDecodeWarnings = 0;
  private previewImageElements = new Map<string, HTMLImageElement>();
  private previewImageLoads = new Set<string>();
  private previewCanvas: HTMLCanvasElement | null = null;
  private previewContext: CanvasRenderingContext2D | null = null;
  private nativeComputeGraphSourceFrames = false;
  private nativeGraphCatalogComplete = false;
  private nativeGraphReadyKinds = new Set<NativeGraphRouteKind>();
  private nativeEffectPassDescriptorIds = new Set<string>();
  private nativeGraphRoutes = new Map<string, NativeGraphRouteState>();
  private nativePointCloudDataCache = new Map<string, Promise<PointCloudFXNativePointData>>();
  private nativeSourceFrameSize = SOURCE_FRAME_SIZE_FALLBACK;
  private dynamicSourceFrameCaptureSize = SOURCE_FRAME_SIZE_FALLBACK;
  private presentProfile: PresentPolicyProfile = 'low-latency-safe';
  private targetFps = 60;
  private commandDrainLimit = 1024;
  private autoPresentOnStateChange = true;
  private decodeStoreCpuBackupFrames = false;
  private decodeAllowSyntheticFallback = false;
  private texturePoolCapMb = 512;
  private shaderPrecompileQueueCap = 4096;
  private shaderPrecompilePerFrame = 4;
  private mediaHighBurstLimit = 7;
  private prefetchCacheMaxEntries = 4096;
  private prefetchCachePruneCount = 256;
  private decodePreviewSize = 96;
  private decodePreviewCacheMb = 128;
  private decodeUseOutputResolution = true;
  private decodeUploadQueueCapMb = 256;
  private decodeHandoffByteCapMb = 128;
  private decodeHandoffPredecodeShedPct = 90;
  private decodePredecodeEstimateCacheCapEntries = 8192;
  private mediaDropCommandPressurePct = 90;
  private mediaDropDecodePressurePct = 90;
  private mediaDropIoPressurePct = 90;
  private mediaDropDecodePriorityCutoff = 180;
  private mediaDropIoPriorityCutoff = 128;
  private adaptiveOverloadPrefetchState: boolean | null = null;
  private adaptiveOverloadHandoffState: boolean | null = null;
  private adaptiveOverloadEstimateCacheState: boolean | null = null;
  private sharedTextureInfoCache = new Map<string, SharedTextureInfoCacheEntry>();
  private sharedTextureInfoInFlight = new Set<string>();
  private sharedTextureInfoNextPollAt = new Map<string, number>();
  private sharedTextureReceiverSender: string | null = null;
  private nextStatusPollAt = 0;
  private nextReadinessPollAt = 0;
  private degradedModeActive = false;
  private decodeBackpressureActive = false;
  private decodeHandoffBackpressureActive = false;
  private decodeHandoffUtilizationPct = 0;
  private decodePendingUploadBackpressureActive = false;
  private decodePendingUploadUtilizationPct = 0;
  private decodeFramePoolBackpressureActive = false;
  private decodeFramePoolUtilizationPct = 0;
  private decodeEstimateCacheBackpressureActive = false;
  private commandBackpressureActive = false;
  private nativeCommandDropWarnings = 0;
  private decodeGpuBridgePath: string | undefined =
    (import.meta as any)?.env?.VITE_DECODE_GPU_BRIDGE_PATH || undefined;

  private assertNativeReady(status: RendererStatus | null) {
    if (!status) {
      throw new Error('Native renderer status unavailable after startup');
    }
    if (!status.backend_ready) {
      throw new Error(`Native renderer backend reported not ready: ${status.last_frame_error ?? 'unknown error'}`);
    }
  }

  private warnNativeCommandDrops(
    summary: NativeCommandApplySummary | null | undefined,
    context: string,
  ) {
    const dropped = Number(summary?.dropped ?? 0);
    if (!Number.isFinite(dropped) || dropped <= 0) return;
    if (this.nativeCommandDropWarnings < 5) {
      console.warn('[NativeRendererSync] native command(s) dropped', {
        context,
        dropped,
        total: summary?.total,
        unknownTypes: summary?.unknown_types,
      });
    }
    this.nativeCommandDropWarnings += 1;
  }

  private resetSharedTextureUploadTracking() {
    this.sharedTextureUploadPending.clear();
    this.sharedTextureLastRejectedUploads = 0;
    this.sharedTextureLastSuccessfulUploads = 0;
    this.sharedTextureRejectWarnings = 0;
  }

  private resetNativeImageDecodeTracking() {
    this.nativeImageDecodePending.clear();
    this.nativeImageDecodeBypass.clear();
    this.nativeImageLastDecodeFailures = 0;
    this.nativeImageLastDecodes = 0;
    this.nativeImageDecodeWarnings = 0;
  }

  private reconcileSharedTextureUploads(status: RendererStatus) {
    const rejected = Number(status.source_frame_shared_texture_rejected_uploads ?? 0);
    const successful = Number(status.source_frame_shared_texture_uploads ?? 0);
    if (!Number.isFinite(rejected) || !Number.isFinite(successful)) return;

    if (
      rejected < this.sharedTextureLastRejectedUploads ||
      successful < this.sharedTextureLastSuccessfulUploads
    ) {
      this.sharedTextureLastRejectedUploads = Math.max(0, rejected);
      this.sharedTextureLastSuccessfulUploads = Math.max(0, successful);
      this.sharedTextureUploadPending.clear();
      return;
    }

    if (rejected > this.sharedTextureLastRejectedUploads) {
      const pending = Array.from(this.sharedTextureUploadPending.entries());
      for (const [sourceKey, upload] of pending) {
        if (this.sourcePreviewSig.get(sourceKey) === upload.signature) {
          if (upload.previousSignature) this.sourcePreviewSig.set(sourceKey, upload.previousSignature);
          else this.sourcePreviewSig.delete(sourceKey);
        }
        if (this.sourcePreviewSeq.get(sourceKey) === upload.seq) {
          if (typeof upload.previousSeq === 'number') this.sourcePreviewSeq.set(sourceKey, upload.previousSeq);
          else this.sourcePreviewSeq.delete(sourceKey);
        }
        this.sourcePreviewNextAt.delete(sourceKey);
      }
      if (pending.length && this.sharedTextureRejectWarnings < 5) {
        console.warn('[NativeRendererSync] native shared texture import rejected; retrying metadata/upload', {
          rejectedDelta: rejected - this.sharedTextureLastRejectedUploads,
          pendingSources: pending.map(([, upload]) => upload.sourceId),
          reason: status.source_frame_last_reject_reason,
        });
        this.sharedTextureRejectWarnings += 1;
      }
      this.sharedTextureUploadPending.clear();
    } else if (successful > this.sharedTextureLastSuccessfulUploads) {
      this.sharedTextureUploadPending.clear();
    }

    this.sharedTextureLastRejectedUploads = rejected;
    this.sharedTextureLastSuccessfulUploads = successful;
  }

  private reconcileNativeImageDecodes(status: RendererStatus) {
    const failures = Number(status.native_image_decode_failures ?? 0);
    const decodes = Number(status.native_image_decodes ?? 0);
    if (!Number.isFinite(failures) || !Number.isFinite(decodes)) return;

    if (
      failures < this.nativeImageLastDecodeFailures ||
      decodes < this.nativeImageLastDecodes
    ) {
      this.nativeImageLastDecodeFailures = Math.max(0, failures);
      this.nativeImageLastDecodes = Math.max(0, decodes);
      this.nativeImageDecodePending.clear();
      return;
    }

    if (failures > this.nativeImageLastDecodeFailures) {
      const pending = Array.from(this.nativeImageDecodePending.entries());
      for (const [sourceKey, decode] of pending) {
        if (this.sourcePreviewSig.get(sourceKey) === decode.signature) {
          if (decode.previousSignature) this.sourcePreviewSig.set(sourceKey, decode.previousSignature);
          else this.sourcePreviewSig.delete(sourceKey);
        }
        if (this.sourcePreviewSeq.get(sourceKey) === decode.seq) {
          if (typeof decode.previousSeq === 'number') this.sourcePreviewSeq.set(sourceKey, decode.previousSeq);
          else this.sourcePreviewSeq.delete(sourceKey);
        }
        this.sourcePreviewNextAt.delete(sourceKey);
        this.nativeImageDecodeBypass.add(sourceKey);
      }
      if (pending.length && this.nativeImageDecodeWarnings < 5) {
        console.warn('[NativeRendererSync] native image decode failed; source frame will use preview fallback', {
          failureDelta: failures - this.nativeImageLastDecodeFailures,
          pendingSources: pending.map(([, decode]) => decode.sourceId),
          error: status.native_image_decode_last_error,
        });
        this.nativeImageDecodeWarnings += 1;
      }
      this.nativeImageDecodePending.clear();
    } else if (decodes > this.nativeImageLastDecodes) {
      this.nativeImageDecodePending.clear();
    }

    this.nativeImageLastDecodeFailures = failures;
    this.nativeImageLastDecodes = decodes;
  }

  private syncNativeSourceFrameSize(status: RendererStatus | null) {
    const size = Number(status?.source_frame_size ?? SOURCE_FRAME_SIZE_FALLBACK);
    this.nativeSourceFrameSize = clampNumber(Math.round(size), 512, 4096);
    this.dynamicSourceFrameCaptureSize = this.nativeSourceFrameSize;
  }

  private supportsNativeMethod(method: string): boolean {
    return this.nativeCoreMethods.has(method);
  }

  private supportsNativeFeature(feature: string): boolean {
    return !!this.nativeFeatureFlags[feature];
  }

  private supportsNativeGraphRoute(kind: NativeGraphRouteKind): boolean {
    return this.nativeGraphReadyKinds.has(kind);
  }

  private supportsNativeEffectPassRoute(effectPasses: NativeEffectPassRuntime[]): boolean {
    if (!this.supportsNativeFeature('native_effect_pass_manifest')) return false;
    if (!this.supportsNativeFeature('compute_graph_texture_sampling')) return false;
    if (!this.supportsNativeFeature('compute_graph_source_frame_target')) return false;
    return effectPasses.every((effectPass) => this.nativeEffectPassDescriptorIds.has(effectPass.effect));
  }

  private audioSignature(audio: VisualAudioState): string {
    const q = (value: number, scale = 1000) =>
      Math.round((Number.isFinite(value) ? value : 0) * scale);
    return [
      audio.isActive ? 1 : 0,
      q(audio.level),
      q(audio.bass),
      q(audio.mid),
      q(audio.treble),
      q(audio.high),
      q(audio.beat),
      q(audio.beatPhase),
      q(audio.bpm, 10),
      q(audio.centroid),
      q(audio.kick),
      q(audio.snare),
    ].join(':');
  }

  private audioCommand(audio: VisualAudioState): RendererCommand | null {
    const sig = this.audioSignature(audio);
    if (sig === this.lastAudioSig) return null;
    this.lastAudioSig = sig;
    return {
      type: 'set_audio_state',
      ...ghostAudioCommandFieldsFromVisualAudio(audio),
    };
  }

  private nativeGraphRouteKey(kind: NativeGraphRouteKind, sourceId: string): string {
    return `${kind}:${sourceId}`;
  }

  private nativeGraphSourceParamForLayer(layer: Layer): NativeLayerSource | null {
    const params = layer.gpuLayerContent?.params ?? {};
    const sourceParam = params.source;
    if (!sourceParam || typeof sourceParam !== 'object') return null;

    if (sourceParam.type === 'media' && sourceParam.mediaId) {
      const item = get(mediaLibrary).find((media: MediaItem) => media.id === sourceParam.mediaId);
      return item ? mediaItemToNativeLayerSource(item) : null;
    }

    if (sourceParam.type === 'layer' && sourceParam.layerId) {
      const layers = this.latestLayers.length ? this.latestLayers : get(project).layers;
      const sourceLayer = layers.find((candidate) => candidate.id === sourceParam.layerId);
      return sourceLayer?.source ? nativeLayerSourceFromMediaSource(sourceLayer.source) : null;
    }

    if (sourceParam.type === 'file') {
      return fileSourceParamToNativeLayerSource(layer, sourceParam);
    }

    return null;
  }

  private nativeGraphInputSourceForLayer(layer: Layer, kind: NativeGraphRouteKind): NativeLayerSource | null {
    if (kind === 'flythrough') return this.nativeGraphSourceParamForLayer(layer);
    if (kind === 'pixel-particles') return this.nativeGraphSourceParamForLayer(layer);
    if (kind === 'point-cloud-fx') return this.nativeGraphSourceParamForLayer(layer);
    if (kind !== 'particle-field') return null;
    const params = layer.gpuLayerContent?.params ?? {};
    const mode = String(params.mode ?? '').trim().toLowerCase();
    if (mode !== 'media') return null;
    return this.nativeGraphSourceParamForLayer(layer);
  }

  private nativeGraphUsesSourceFrameInput(layer: Layer, route: NativeGraphLayerRoute): boolean {
    if (!route.inputSource) return false;
    if (route.kind === 'effect-pass') return true;
    if (route.kind === 'flythrough' || route.kind === 'pixel-particles') return true;
    if (route.kind !== 'particle-field') return false;
    const mode = String(layer.gpuLayerContent?.params?.mode ?? '').trim().toLowerCase();
    return mode === 'media';
  }

  private nativePointCloudCacheKey(source: NativeLayerSource): string {
    const src = source.source;
    return src
      ? `${source.id}:${src.src}:${src.name}`
      : `${source.id}:${source.uri}`;
  }

  private async nativePointCloudDataForRoute(
    layer: Layer,
    route: NativeGraphLayerRoute,
  ): Promise<PointCloudFXNativePointData | null> {
    const input = route.inputSource;
    const src = input?.source;
    if (!input || !src?.src) return null;
    const filename = String(src.name || src.src);
    const isSplat = /\.splat(\?|$)/i.test(filename);
    const isPly = /\.ply(\?|$)/i.test(filename);
    if (!isPly && !isSplat) return null;

    const cacheKey = this.nativePointCloudCacheKey(input);
    let promise = this.nativePointCloudDataCache.get(cacheKey);
    if (!promise) {
      promise = fetch(src.src)
        .then(async (response) => {
          if (!response.ok) {
            throw new Error(`point cloud fetch failed: ${response.status} ${response.statusText}`);
          }
          const buffer = await response.arrayBuffer();
          const parsed = isSplat ? parseSplatBuffer(buffer) : parsePLYBuffer(buffer);
          const vertices = parsed.vertices ?? [];
          if (!vertices.length) {
            throw new Error('point cloud source contained no vertices');
          }
          const positions = new Float32Array(vertices.length * 3);
          const colors = new Float32Array(vertices.length * 3);
          const alpha = new Float32Array(vertices.length);
          const splatScale = new Float32Array(vertices.length * 3);
          const splatRotation = new Float32Array(vertices.length * 4);
          let gaussian = parsed.dataType === 'gaussian';
          for (let i = 0; i < vertices.length; i++) {
            const v = vertices[i];
            positions[i * 3 + 0] = v.x;
            positions[i * 3 + 1] = v.y;
            positions[i * 3 + 2] = v.z;
            colors[i * 3 + 0] = clampNumber((v.r ?? 255) / 255, 0, 1);
            colors[i * 3 + 1] = clampNumber((v.g ?? 255) / 255, 0, 1);
            colors[i * 3 + 2] = clampNumber((v.b ?? 255) / 255, 0, 1);
            alpha[i] = clampNumber((v.a ?? 255) / 255, 0, 1);
            const scaleOff = i * 3;
            splatScale[scaleOff + 0] = Number.isFinite(v.scale_0) ? v.scale_0! : 0;
            splatScale[scaleOff + 1] = Number.isFinite(v.scale_1) ? v.scale_1! : 0;
            splatScale[scaleOff + 2] = Number.isFinite(v.scale_2) ? v.scale_2! : 0;
            if (
              Number.isFinite(v.scale_0) ||
              Number.isFinite(v.scale_1) ||
              Number.isFinite(v.scale_2)
            ) {
              gaussian = true;
            }
            const rotOff = i * 4;
            splatRotation[rotOff + 0] = Number.isFinite(v.rot_0) ? v.rot_0! : 1;
            splatRotation[rotOff + 1] = Number.isFinite(v.rot_1) ? v.rot_1! : 0;
            splatRotation[rotOff + 2] = Number.isFinite(v.rot_2) ? v.rot_2! : 0;
            splatRotation[rotOff + 3] = Number.isFinite(v.rot_3) ? v.rot_3! : 0;
          }
          return buildPointCloudFXNativePointData(positions, colors, {
            maxPoints: NATIVE_POINT_CLOUD_MAX_POINTS,
            alpha,
            splatScale: gaussian ? splatScale : undefined,
            splatRotation: gaussian ? splatRotation : undefined,
            gaussian,
            signature: [
              cacheKey,
              buffer.byteLength,
              vertices.length,
              Math.min(vertices.length, NATIVE_POINT_CLOUD_MAX_POINTS),
              gaussian ? 'gaussian' : 'points',
            ].join(':'),
          });
        })
        .catch((err) => {
          this.nativePointCloudDataCache.delete(cacheKey);
          throw err;
        });
      this.nativePointCloudDataCache.set(cacheKey, promise);
    }
    try {
      return await promise;
    } catch (err) {
      console.warn('[NativeRendererSync] native point-cloud data load failed', layer.id, err);
      return null;
    }
  }

  private nativeEffectPassRouteForLayer(layer: Layer, includeWarningDisabled = false): NativeGraphLayerRoute | null {
    if (layer.type === 'gpu') return null;
    const effectPasses = nativeEffectPassesForLayer(layer);
    if (!effectPasses?.length) return null;
    if (!this.supportsNativeEffectPassRoute(effectPasses)) return null;
    const inputSource = nativeLayerSource(layer);
    if (!inputSource.source || !inputSource.shouldPreview || inputSource.sourceType === 'none') return null;
    const inputReady =
      this.nativeSourceFrameUploaded(inputSource) ||
      this.canUseNativeStaticImageDecode(inputSource.source, inputSource.sourceType) ||
      !!this.resolvePreviewElement(inputSource.source, inputSource.sourceType, inputSource.previewElement ?? null);
    if (!inputReady) return null;
    const source = nativeEffectPassOutputSource(layer, inputSource);
    const key = this.nativeGraphRouteKey('effect-pass', source.id);
    if (!includeWarningDisabled && (this.nativeGraphRoutes.get(key)?.warnings ?? 0) >= 3) {
      return null;
    }
    return { kind: 'effect-pass', key, source, inputSource, effectPasses };
  }

  private nativeGraphRouteForLayer(layer: Layer, includeWarningDisabled = false): NativeGraphLayerRoute | null {
    if (!this.nativeComputeGraphSourceFrames || !this.nativeWgslStdlibWarmed || !layer.visible) return null;
    const effectPassRoute = this.nativeEffectPassRouteForLayer(layer, includeWarningDisabled);
    if (effectPassRoute) return effectPassRoute;
    if (layer.type !== 'gpu' || !layer.gpuLayerContent) return null;
    const shaderId = String(layer.gpuLayerContent.shaderId || '').trim();
    const normalizedShaderId = shaderId.toLowerCase();
    let kind: NativeGraphRouteKind | null = null;
    if (
      normalizedShaderId === 'planet' &&
      this.supportsNativeGraphRoute('planet')
    ) {
      kind = 'planet';
    } else if (
      normalizedShaderId === 'smoke-3d' &&
      this.supportsNativeGraphRoute('smoke-3d')
    ) {
      kind = 'smoke-3d';
    } else if (
      normalizedShaderId === 'smoke-riders' &&
      this.supportsNativeGraphRoute('smoke-riders')
    ) {
      kind = 'smoke-riders';
    } else if (
      (normalizedShaderId === 'particle-field' || normalizedShaderId === 'gravity-wells') &&
      this.supportsNativeGraphRoute('particle-field')
    ) {
      kind = 'particle-field';
    } else if (
      (normalizedShaderId === 'volumetric-balls' || normalizedShaderId === 'volumetric-spheres') &&
      this.supportsNativeGraphRoute('volumetric-spheres')
    ) {
      kind = 'volumetric-spheres';
    } else if (
      normalizedShaderId === 'ink-cloud' &&
      this.supportsNativeGraphRoute('ink-cloud')
    ) {
      kind = 'ink-cloud';
    } else if (
      normalizedShaderId === 'flythrough' &&
      this.supportsNativeGraphRoute('flythrough')
    ) {
      kind = 'flythrough';
    } else if (
      normalizedShaderId === 'pixel-particles' &&
      this.supportsNativeGraphRoute('pixel-particles')
    ) {
      kind = 'pixel-particles';
    } else if (
      normalizedShaderId === 'point-cloud-fx' &&
      this.supportsNativeGraphRoute('point-cloud-fx')
    ) {
      kind = 'point-cloud-fx';
    }
    if (!kind) return null;
    const inputSource = this.nativeGraphInputSourceForLayer(layer, kind);
    if (
      kind === 'particle-field' &&
      String(layer.gpuLayerContent.params?.mode ?? '').trim().toLowerCase() === 'media' &&
      !inputSource
    ) {
      return null;
    }
    if (kind === 'flythrough' && !inputSource) {
      return null;
    }
    if (kind === 'pixel-particles' && !inputSource) {
      return null;
    }
    if (kind === 'point-cloud-fx' && !inputSource) {
      return null;
    }
    const baseSource = nativeGraphOutputSource(layer, kind);
    const effectPasses = this.supportsNativeFeature('compute_graph_texture_sampling')
      ? nativeEffectPassesForLayer(layer)
      : null;
    const source = effectPasses?.length
      ? nativeEffectPassOutputSource(layer, baseSource)
      : baseSource;
    const key = this.nativeGraphRouteKey(kind, baseSource.id);
    if (!includeWarningDisabled && (this.nativeGraphRoutes.get(key)?.warnings ?? 0) >= 3) {
      return null;
    }
    return {
      kind,
      key,
      baseSource: effectPasses?.length ? baseSource : undefined,
      source,
      inputSource,
      effectPasses: effectPasses ?? undefined,
    };
  }

  private nativeSourceFrameUploaded(source: NativeLayerSource | null): boolean {
    const src = source?.source;
    if (!src) return false;
    return this.sourcePreviewSeq.has(this.sourceCacheKey(src.id, src.src));
  }

  private canUseNativeStaticImageDecode(
    src: NonNullable<Layer['source']>,
    sourceType: string,
  ): boolean {
    return (
      sourceType === 'image' &&
      this.supportsNativeFeature('native_static_image_decode') &&
      isNativeStaticImageDecodeUri(src.src) &&
      !this.nativeImageDecodeBypass.has(this.sourceCacheKey(src.id, src.src))
    );
  }

  private markNativeStaticImageFrameReady(src: NonNullable<Layer['source']>): boolean {
    const sourceKey = this.sourceCacheKey(src.id, src.src);
    const signature = `native-image:${src.src}`;
    if (this.sourcePreviewSeq.has(sourceKey) && this.sourcePreviewSig.get(sourceKey) === signature) {
      return false;
    }
    const previousSignature = this.sourcePreviewSig.get(sourceKey);
    const previousSeq = this.sourcePreviewSeq.get(sourceKey);
    const seq = (this.sourcePreviewSeq.get(sourceKey) ?? 0) + 1;
    this.sourcePreviewSeq.set(sourceKey, seq);
    this.sourcePreviewSig.set(sourceKey, signature);
    this.sourcePreviewNextAt.delete(sourceKey);
    this.nativeImageDecodePending.set(sourceKey, {
      sourceId: src.id,
      signature,
      seq,
      previousSignature,
      previousSeq,
      submittedAt: Date.now(),
    });
    return true;
  }

  private async renderNativeGraphSources(
    layers: Layer[],
    width: number,
    height: number,
    clock: NativeRenderClockCommand,
    visual: VisualAudioState,
  ) {
    if (!this.nativeComputeGraphSourceFrames) {
      this.nativeGraphRoutes.clear();
      return;
    }
    const activeRouteKeys = new Set<string>();
    for (const layer of layers) {
      const possibleRoute = this.nativeGraphRouteForLayer(layer, true);
      if (!possibleRoute) continue;
      activeRouteKeys.add(possibleRoute.key);

      const route = this.nativeGraphRouteForLayer(layer);
      if (!route) continue;
      if (this.nativeGraphUsesSourceFrameInput(layer, route) && route.inputSource && !this.nativeSourceFrameUploaded(route.inputSource)) continue;

      const routeState = this.nativeGraphRoutes.get(route.key) ?? {
        inFlight: false,
        seq: 0,
        warnings: 0,
        state: null,
        bufferPrefixes: nativeGraphBufferPrefixesForRoute(route),
      };
      this.nativeGraphRoutes.set(route.key, routeState);
      const graphTime = typeof clock.time === 'number'
        ? clock.time
        : Math.max(0, (performance.now() - this.liveClockOriginMs) / 1000);
      const graphDelta = typeof clock.time_delta === 'number' ? clock.time_delta : 1 / this.targetFps;
      const graphFrameIndex = typeof clock.frame_index === 'number' && Number.isFinite(clock.frame_index)
        ? Math.max(0, Math.round(clock.frame_index))
        : routeState.seq + 1;
      const audioBass = visual.isActive ? Math.max(visual.bass, visual.bassFast * 0.9) : 0;
      const audioTreble = visual.isActive ? visual.treble : 0;
      const nativeGraphParams = nativeGraphParamsForLayer(layer, route.kind);
      const graphSource = nativeGraphRenderSource(route);
      const effectPassSig = route.effectPasses?.map((effectPass) => effectPass.descriptor).join('>') ?? 'none';
      const inputSourceFrameSeq = route.inputSource?.source
        ? this.sourcePreviewSeq.get(this.sourceCacheKey(route.inputSource.source.id, route.inputSource.source.src)) ?? 0
        : 0;
      const graphInputSig = `${nativeSourceIdentity(route.inputSource)}:${inputSourceFrameSeq}`;
      const manualClockKey = clock.mode === 'manual'
        ? [
            route.kind,
            graphFrameIndex,
            graphTime.toFixed(6),
            graphDelta.toFixed(6),
            audioBass.toFixed(4),
            audioTreble.toFixed(4),
            graphInputSig,
            effectPassSig,
            stableNativeGraphKey(nativeGraphParams),
          ].join('|')
        : '';
      if (manualClockKey && routeState.lastManualClockKey === manualClockKey && routeState.state) continue;
      if (routeState.inFlight) continue;
      routeState.inFlight = true;
      try {
        const graphSeq = routeState.seq + 1;
        routeState.seq = graphSeq;
        const resetGraphState =
          !routeState.state ||
          (clock.mode === 'manual' &&
            typeof routeState.lastGraphFrameIndex === 'number' &&
            graphFrameIndex < routeState.lastGraphFrameIndex);
        if (route.kind === 'effect-pass') {
          if (!route.inputSource || !route.effectPasses?.length) {
            throw new Error('native effect-pass route is missing input source or effect metadata');
          }
          const effectGraph = buildNativeEffectPassChainGraph({
            sourceId: route.inputSource.id,
            targetSourceId: route.source.id,
            effects: route.effectPasses.map((effectPass) => ({
              effect: effectPass.effect,
              amount: effectPass.amount,
              mix: 1,
              params: effectPass.params,
            })),
            width,
            height,
            time: graphTime,
            frameDelta: graphDelta,
            frameIndex: graphFrameIndex,
            seq: graphSeq * 16,
          });
          const result = await runNativeRendererComputeGraph(effectGraph.config as unknown as Record<string, unknown>);
          const renders = Array.isArray((result as any)?.renders)
            ? (result as any).renders
            : [(result as any)?.render].filter(Boolean);
          const renderedSourceFrame = renders.some((render: any) =>
            render?.target === 'source_frame' && render?.source_id === route.source.id,
          );
          if (!renderedSourceFrame) {
            throw new Error(`native effect-pass graph returned no source-frame render for ${route.source.id}`);
          }
          routeState.state = null;
          routeState.lastGraphFrameIndex = graphFrameIndex;
          routeState.lastManualClockKey = manualClockKey || undefined;
          routeState.warnings = 0;
          continue;
        }
        const graph = await (async () => {
          if (route.kind === 'planet') {
            return buildPlanetNativeComputeGraph({
              sourceId: graphSource.id,
              params: nativeGraphParams,
              width,
              height,
              time: graphTime,
              frameDelta: graphDelta,
              frameIndex: graphFrameIndex,
              state: routeState.state as PlanetNativeGraphState | null,
              reset: resetGraphState,
            });
          }
          if (route.kind === 'smoke-3d') {
            return buildSmoke3DNativeComputeGraph({
              sourceId: graphSource.id,
              params: nativeGraphParams,
              width,
              height,
              time: graphTime,
              frameDelta: graphDelta,
              frameIndex: graphFrameIndex,
              audioBass,
              audioTreble,
              state: routeState.state as Smoke3DNativeGraphState | null,
              reset: resetGraphState,
            });
          }
          if (route.kind === 'particle-field') {
            return buildParticleFieldNativeComputeGraph({
              sourceId: graphSource.id,
              params: nativeGraphParams,
              width,
              height,
              time: graphTime,
              frameDelta: graphDelta,
              frameIndex: graphFrameIndex,
              audioBass,
              audioTreble,
              mediaSourceId: route.inputSource?.id ?? null,
              state: routeState.state as ParticleFieldNativeGraphState | null,
              reset: resetGraphState,
            });
          }
          if (route.kind === 'smoke-riders') {
            return buildSmokeRidersNativeComputeGraph({
              sourceId: graphSource.id,
              params: nativeGraphParams,
              width,
              height,
              time: graphTime,
              frameDelta: graphDelta,
              frameIndex: graphFrameIndex,
              audioBass,
              audioTreble,
              state: routeState.state as SmokeRidersNativeGraphState | null,
              reset: resetGraphState,
            });
          }
          if (route.kind === 'ink-cloud') {
            return buildInkCloudNativeComputeGraph({
              sourceId: graphSource.id,
              params: nativeGraphParams,
              width,
              height,
              time: graphTime,
              frameDelta: graphDelta,
              frameIndex: graphFrameIndex,
              audioBass,
              audioTreble,
              state: routeState.state as InkCloudNativeGraphState | null,
              reset: resetGraphState,
            });
          }
          if (route.kind === 'flythrough') {
            return buildFlythroughNativeComputeGraph({
              sourceId: graphSource.id,
              mediaSourceId: route.inputSource?.id ?? null,
              params: nativeGraphParams,
              width,
              height,
              time: graphTime,
              frameDelta: graphDelta,
              frameIndex: graphFrameIndex,
              audioBass,
              audioTreble,
              state: routeState.state as FlythroughNativeGraphState | null,
              reset: resetGraphState,
            });
          }
          if (route.kind === 'pixel-particles') {
            return buildPixelParticlesNativeComputeGraph({
              sourceId: graphSource.id,
              mediaSourceId: route.inputSource?.id ?? null,
              params: nativeGraphParams,
              width,
              height,
              sourceFrameSize: this.nativeSourceFrameSize,
              time: graphTime,
              frameDelta: graphDelta,
              frameIndex: graphFrameIndex,
              state: routeState.state as PixelParticlesNativeGraphState | null,
              reset: resetGraphState,
            });
          }
          if (route.kind === 'point-cloud-fx') {
            const pointData = await this.nativePointCloudDataForRoute(layer, route);
            if (!pointData) {
              throw new Error('native point-cloud data is not available yet');
            }
            return buildPointCloudFXNativeComputeGraph({
              sourceId: graphSource.id,
              pointData,
              params: nativeGraphParams,
              width,
              height,
              time: graphTime,
              frameDelta: graphDelta,
              frameIndex: graphFrameIndex,
              audioBass,
              audioTreble,
              state: routeState.state as PointCloudFXNativeGraphState | null,
              reset: resetGraphState,
            });
          }
          return buildVolumetricSpheresNativeComputeGraph({
            sourceId: graphSource.id,
            params: nativeGraphParams,
            width,
            height,
            time: graphTime,
            frameDelta: graphDelta,
            frameIndex: graphFrameIndex,
            audioBass,
            audioTreble,
            state: routeState.state as VolumetricSpheresNativeGraphState | null,
            reset: resetGraphState,
          });
        })();
        const result = await runNativeRendererComputeGraph(graph.config as unknown as Record<string, unknown>);
        const renders = Array.isArray((result as any)?.renders)
          ? (result as any).renders
          : [(result as any)?.render].filter(Boolean);
        const renderedSourceFrame = renders.some((render: any) =>
          render?.target === 'source_frame' && render?.source_id === graphSource.id,
        );
        if (!renderedSourceFrame) {
          throw new Error(`native ${route.kind} graph returned no source-frame render`);
        }
        if (route.effectPasses?.length && route.source.id !== graphSource.id) {
          const effectGraph = buildNativeEffectPassChainGraph({
            sourceId: graphSource.id,
            targetSourceId: route.source.id,
            intermediatePrefix: `${route.source.id}:chain`,
            effects: route.effectPasses.map((effectPass) => ({
              effect: effectPass.effect,
              amount: effectPass.amount,
              mix: 1,
              params: effectPass.params,
            })),
            width,
            height,
            time: graphTime,
            frameDelta: graphDelta,
            frameIndex: graphFrameIndex,
            seq: graphSeq * 16 + 8,
          });
          const effectResult = await runNativeRendererComputeGraph(effectGraph.config as unknown as Record<string, unknown>);
          const effectRenders = Array.isArray((effectResult as any)?.renders)
            ? (effectResult as any).renders
            : [(effectResult as any)?.render].filter(Boolean);
          const renderedEffectFrame = effectRenders.some((render: any) =>
            render?.target === 'source_frame' && render?.source_id === route.source.id,
          );
          if (!renderedEffectFrame) {
            throw new Error(`native ${route.kind} effect-pass graph returned no source-frame render`);
          }
        }
        routeState.state = graph.state ?? null;
        routeState.lastGraphFrameIndex = graphFrameIndex;
        routeState.lastManualClockKey = manualClockKey || undefined;
        routeState.warnings = 0;
      } catch (err) {
        if (routeState.warnings < 3) {
          console.warn(`[NativeRendererSync] native ${route.kind} graph failed`, layer.id, err);
        }
        routeState.warnings += 1;
      } finally {
        routeState.inFlight = false;
      }
    }
    const inactiveGraphBufferPrefixes: string[] = [];
    for (const [key, routeState] of Array.from(this.nativeGraphRoutes.entries())) {
      if (!activeRouteKeys.has(key) && !routeState.inFlight) {
        inactiveGraphBufferPrefixes.push(...routeState.bufferPrefixes);
        this.nativeGraphRoutes.delete(key);
      }
    }
    if (inactiveGraphBufferPrefixes.length > 0) {
      await this.clearNativeGraphBuffers(inactiveGraphBufferPrefixes);
    }
  }

  private scheduleAudioSync() {
    if (!this.running || this.audioSyncRaf !== null) return;
    const audio = getVisualAudioSnapshot();
    const nextSig = this.audioSignature(audio);
    if (!audio.isActive && nextSig === this.lastAudioSig) return;
    this.audioSyncRaf = requestAnimationFrame(() => {
      this.audioSyncRaf = null;
      void this.flush(this.desiredWidth, this.desiredHeight, this.latestLayers);
    });
  }

  private sourceCacheKey(sourceId: string, uri: string): string {
    return `${sourceId}::${uri}`;
  }

  private nativeVideoPlaybackTimeSeconds(src: NonNullable<Layer['source']>, now: number) {
    if (this.latestRenderClockSeconds !== null) {
      return this.latestRenderClockSeconds;
    }
    const videoTime = Number(src.videoElement?.currentTime);
    return Number.isFinite(videoTime)
      ? Math.max(0, videoTime)
      : Math.max(0, (now - this.liveClockOriginMs) / 1000);
  }

  private nativeVideoPlaybackCommand(
    src: NonNullable<Layer['source']>,
    sourceType: string,
    now: number,
    renderClock: NativeRenderClockCommand,
  ): RendererCommand {
    const element = src.videoElement ?? null;
    const duration = Number(element?.duration);
    return {
      type: 'set_media_source_playback',
      source_id: src.id,
      uri: src.src,
      source_type: sourceType,
      time_seconds: Number(this.nativeVideoPlaybackTimeSeconds(src, now).toFixed(6)),
      clock_time_seconds: Number((renderClock.time ?? 0).toFixed(6)),
      playback_rate: Number((Number(element?.playbackRate) || 1).toFixed(6)),
      paused: !!element?.paused,
      loop_enabled: !!element?.loop,
      duration_seconds: Number.isFinite(duration) && duration > 0 ? Number(duration.toFixed(6)) : undefined,
      seq: Math.max(1, Math.round((renderClock.time ?? 0) * 1000)),
    };
  }

  private nativeVideoPrefetchOptions(
    src: NonNullable<Layer['source']>,
    now: number,
    prefetchWindowFrames = 0,
    useNativePlaybackClock = false,
  ) {
    const timeSeconds = this.nativeVideoPlaybackTimeSeconds(src, now);
    const decodeSize = Math.max(64, Math.min(2048, Math.round(this.dynamicSourceFrameCaptureSize || this.nativeSourceFrameSize)));
    return {
      timeSeconds: useNativePlaybackClock ? undefined : timeSeconds,
      decodeWidth: decodeSize,
      decodeHeight: decodeSize,
      prefetchWindowFrames,
      prefetchFps: NATIVE_VIDEO_PREFETCH_WINDOW_FPS,
      seq: Math.max(1, Math.round(timeSeconds * 1000)),
    };
  }

  async start(width: number, height: number) {
    if (this.running) return;
    this.startupReady = false;
    const backend: BackendKind = isMac ? 'metal' : isWindows ? 'd3d12' : 'vulkan';
    const decodeBackend: DecodeBackendKind = isWindows ? 'ffmpeg_d3d11va' : 'ffmpeg_software';
    await startNativeRenderer({
      backend,
      decode_backend: decodeBackend,
      width,
      height,
      target_fps: 60,
      present_mode: 'immediate',
      allow_tearing: false,
      max_frame_latency: 2,
      use_waitable_object: true,
      shader_metadata_cache_cap: 16384,
      pipeline_metadata_cache_cap: 16384,
      vram_budget_mb: 4096,
      decode_upload_queue_cap_mb: this.decodeUploadQueueCapMb,
      decode_handoff_byte_cap_mb: this.decodeHandoffByteCapMb,
      decode_handoff_predecode_shed_pct: this.decodeHandoffPredecodeShedPct,
      decode_predecode_estimate_cache_cap_entries:
        this.decodePredecodeEstimateCacheCapEntries,
      decode_use_output_resolution: this.decodeUseOutputResolution,
      native_quality_policy: 'auto',
      decode_gpu_bridge_path: this.decodeGpuBridgePath,
    });
    const startupStatus = await getNativeRendererStatus().catch(() => null);
    this.assertNativeReady(startupStatus);
    this.syncNativeSourceFrameSize(startupStatus);
    const startupCapabilities = await getNativeRendererCapabilities().catch(() => null);
    const startupReadiness = await getNativeRendererReadinessReport().catch(() => null);
    this.nativeCoreMethods = new Set((startupCapabilities?.implemented_methods ?? []).map(String));
    this.nativeFeatureFlags = startupCapabilities?.features ?? {};
    this.nativeGraphInstruments = new Set(nativeGraphInstrumentIds(startupCapabilities));
    const nativeGraphManifest = nativeGraphManifestById(startupCapabilities);
    const computeGraphSourceFrameHost = !!(
      this.supportsNativeFeature('compute_graph_host') &&
      this.supportsNativeFeature('compute_graph_render') &&
      this.supportsNativeFeature('compute_graph_source_frame_target')
    );
    const missingGraphRequirements = missingNativeGraphRouteRequirements(
      this.nativeFeatureFlags,
      this.nativeGraphInstruments,
      nativeGraphManifest,
    );
    this.nativeGraphReadyKinds = nativeGraphReadyRouteKinds(
      this.nativeFeatureFlags,
      this.nativeGraphInstruments,
      nativeGraphManifest,
    );
    this.nativeEffectPassDescriptorIds = new Set(nativeEffectPassDescriptorIds(startupCapabilities));
    this.nativeComputeGraphSourceFrames = computeGraphSourceFrameHost;
    this.nativeGraphCatalogComplete = computeGraphSourceFrameHost && missingGraphRequirements.length === 0;
    updateNativeRendererRuntimeFromStartup(
      startupStatus,
      startupReadiness,
      startupCapabilities,
      this.nativeGraphCatalogComplete,
      this.nativeComputeGraphSourceFrames,
    );
    if (computeGraphSourceFrameHost && missingGraphRequirements.length > 0) {
      console.warn(
        '[NativeRendererSync] native graph catalog is incomplete; unsupported routes will fall back to WebGL',
        missingGraphRequirements,
      );
    }
    const startupQuality = startupStatus?.native_quality;
    const graphCatalogStatus = !this.nativeComputeGraphSourceFrames
      ? 'off'
      : this.nativeGraphCatalogComplete
        ? 'complete'
        : 'partial';
    console.log(
      `[NativeRendererSync] GPU pipeline active: backend=${startupStatus?.backend}, adapter=${startupStatus?.adapter_name ?? 'unknown'} quality=${startupQuality?.active_tier ?? 'unknown'}@${(startupQuality?.quality_scale ?? 0).toFixed(2)} policy=${startupQuality?.policy ?? 'unknown'} graphHost=${this.nativeComputeGraphSourceFrames ? 'on' : 'off'} graphCatalog=${graphCatalogStatus}`
    );
    this.running = true;
    this.liveClockOriginMs = performance.now();
    this.latestRenderClockSeconds = null;
    this.lastRenderClockSentSeconds = null;
    this.lastAudioSig = '';
    this.nativeCommandDropWarnings = 0;
    this.audioUnsub?.();
    this.audioUnsub = visualAudio.subscribe(() => this.scheduleAudioSync());
    this.desiredWidth = width;
    this.desiredHeight = height;
    this.sentWidth = 0;
    this.sentHeight = 0;
    this.nextReadinessPollAt = 0;
    await this.applyStartupPolicies().catch((err) => {
      console.warn('[NativeRendererSync] native startup policy task failed', err);
    });
    this.resetSharedTextureUploadTracking();
    this.resetNativeImageDecodeTracking();
    this.startupReady = true;
    if (this.latestLayers.length) {
      this.scheduleSync(this.desiredWidth || width, this.desiredHeight || height, this.latestLayers);
    }
    const nativeCaps = startupStatus?.native_caps;
    console.log(
      [
        `[NativeRendererSync] start complete preview=${SOURCE_PREVIEW_SIZE}px`,
        `sourceFrame=${this.nativeSourceFrameSize}px`,
        `mips=${startupStatus?.source_frame_mip_levels ?? 1}`,
        `sharedTexSrc=${this.supportsNativeFeature('shared_texture_source_frame_upload') ? 'on' : 'off'}`,
        `videoDecodePump=${this.supportsNativeFeature('native_video_decode_pump') ? 'on' : 'off'}`,
        `pumpWindow=${this.supportsNativeFeature('native_video_decode_pump_window') ? 'on' : 'off'}`,
        `nativeGraphs=${graphCatalogStatus === 'complete' ? 'on' : graphCatalogStatus}`,
        `driver=${startupReadiness?.modes?.output_driver?.ok ? 'on' : 'pending'}`,
        `fullV2=${startupReadiness?.modes?.full_v2?.ok ? 'ready' : 'pending'}`,
        `tier=${nativeCaps?.recommended_quality_tier ?? 'unknown'}`,
        `f16=${nativeCaps?.requested_shader_f16 ? 'on' : 'off'}`,
        `floatFilter=${nativeCaps?.requested_float32_filterable ? 'on' : 'off'}`,
      ].join(' '),
    );
  }

  private async applyStartupPolicies() {
    await resetNativeRendererStats().catch(() => {});
    // Prefer dedicated output window if present; fallback to main window.
    if (this.supportsNativeMethod('attach_output_window')) {
      await attachNativeRendererOutputWindow('output')
        .catch(() => attachNativeRendererOutputWindow('main'))
        .catch(() => {});
    }
    const tasks: Promise<unknown>[] = [
      this.applyPresentPolicyProfile(this.presentProfile),
      this.setTargetFps(this.targetFps),
      this.setCommandDrainPolicy(this.commandDrainLimit),
      this.setAutoPresentPolicy(this.autoPresentOnStateChange),
      this.setDecodeCpuBackupPolicy(this.decodeStoreCpuBackupFrames),
      this.setDecodeSyntheticFallbackPolicy(this.decodeAllowSyntheticFallback),
      this.setTexturePoolCapMb(this.texturePoolCapMb),
      this.setMediaPrefetchPolicy(
        this.mediaHighBurstLimit,
        this.prefetchCacheMaxEntries,
        this.prefetchCachePruneCount,
      ),
      this.setDecodePreviewPolicy(
        this.decodePreviewSize,
        this.decodePreviewCacheMb,
      ),
      this.setDecodeTargetPolicy(this.decodeUseOutputResolution),
      this.setDecodeUploadPolicy(this.decodeUploadQueueCapMb),
      this.setDecodeHandoffPolicy(
        this.decodeHandoffByteCapMb,
        this.decodeHandoffPredecodeShedPct,
      ),
      this.setDecodeEstimateCachePolicy(
        this.decodePredecodeEstimateCacheCapEntries,
      ),
      this.setMediaDropPolicy(
        this.mediaDropCommandPressurePct,
        this.mediaDropDecodePressurePct,
        this.mediaDropIoPressurePct,
        this.mediaDropDecodePriorityCutoff,
        this.mediaDropIoPriorityCutoff,
      ),
    ];
    await this.setShaderPrecompilePolicy(
      this.shaderPrecompileQueueCap,
      this.shaderPrecompilePerFrame,
    ).catch(() => {});
    await this.warmNativeWgslStdlib().catch((err) => {
      console.warn('[NativeRendererSync] native WGSL stdlib warm-up failed', err);
    });
    await Promise.allSettled(tasks);
  }

  async stop() {
    if (!this.running) return;
    this.running = false;
    this.startupReady = false;
    this.stopShaderAnimation();
    if (this.audioSyncRaf !== null) {
      cancelAnimationFrame(this.audioSyncRaf);
      this.audioSyncRaf = null;
    }
    this.audioUnsub?.();
    this.audioUnsub = null;
    this.lastAudioSig = '';
    this.lastLayers.clear();
    this.latestLayers = [];
    this.precompiledShaders.clear();
    this.prefetchedSources.clear();
    this.videoRefreshAt.clear();
    this.sourcePreviewSeq.clear();
    this.sourcePreviewNextAt.clear();
    this.sourcePreviewSig.clear();
    this.sourcePreviewFailures.clear();
    this.resetSharedTextureUploadTracking();
    this.resetNativeImageDecodeTracking();
    this.previewImageElements.clear();
    this.previewImageLoads.clear();
    this.nativeComputeGraphSourceFrames = false;
    this.nativeGraphCatalogComplete = false;
    this.nativeGraphReadyKinds.clear();
    this.nativeEffectPassDescriptorIds.clear();
    this.nativeGraphRoutes.clear();
    this.nativePointCloudDataCache.clear();
    this.nativeGraphInstruments.clear();
    this.nativeWgslStdlibWarmed = false;
    this.latestRenderClockSeconds = null;
    this.lastRenderClockSentSeconds = null;
    this.nextReadinessPollAt = 0;
    if (this.supportsNativeMethod('clear_decode_preview_cache')) {
      await clearNativeRendererDecodePreviewCache().catch(() => {});
    }
    await this.clearRuntimeCaches({
      clear_precompiled_shaders: false,
      clear_texture_pool: false,
      clear_metadata_caches: false,
      clear_prefetch_cache: true,
      clear_native_graph_buffers: true,
    }).catch(() => {});
    if (this.supportsNativeMethod('detach_output_window')) {
      await detachNativeRendererOutputWindow().catch(() => {});
    }
    await stopNativeRenderer().catch(() => {});
    this.nativeCoreMethods.clear();
    this.nativeFeatureFlags = {};
    resetNativeRendererRuntime('native renderer stopped');
  }

  scheduleSync(width: number, height: number, layers: Layer[]) {
    if (!this.running) return;
    this.desiredWidth = width;
    this.desiredHeight = height;
    this.latestLayers = layers;
    if (!this.startupReady) return;

    const hasContinuousNativeLayers = layers.some((layer) => nativeLayerNeedsContinuousSync(layer));
    if (hasContinuousNativeLayers && this.shaderAnimationRaf === null) {
      const loop = () => {
        if (!this.running) {
          this.stopShaderAnimation();
          return;
        }
        void this.flush(this.desiredWidth, this.desiredHeight, this.latestLayers);
        this.shaderAnimationRaf = requestAnimationFrame(loop);
      };
      this.shaderAnimationRaf = requestAnimationFrame(loop);
    } else if (!hasContinuousNativeLayers && this.shaderAnimationRaf !== null) {
      this.stopShaderAnimation();
    }

    if (this.pendingSync) return;
    this.pendingSync = true;
    setTimeout(() => {
      this.pendingSync = false;
      void this.flush(this.desiredWidth, this.desiredHeight, this.latestLayers);
    }, 16);
  }

  setRenderClock(seconds: number | null | undefined) {
    this.latestRenderClockSeconds =
      typeof seconds === 'number' && Number.isFinite(seconds)
        ? Math.max(0, seconds)
        : null;
  }

  private stopShaderAnimation() {
    if (this.shaderAnimationRaf !== null) {
      cancelAnimationFrame(this.shaderAnimationRaf);
      this.shaderAnimationRaf = null;
    }
  }

  async flush(width: number, height: number, layers: Layer[]) {
    if (!this.running || !this.startupReady) return;

    this.latestLayers = layers;
    const commands: RendererCommand[] = [];
    const graphInputCommands: RendererCommand[] = [];
    const current = new Map<string, LayerSnapshot>();
    const activeVideoKeys = new Set<string>();
    const playbackSourcesSent = new Set<string>();
    const visual = getVisualAudioSnapshot();

    if (width !== this.sentWidth || height !== this.sentHeight) {
      commands.push({
        type: 'set_output',
        width,
        height,
        refresh_hz: 60,
      });
      this.sentWidth = width;
      this.sentHeight = height;
    }

    const renderClock = this.renderClockCommand();
    commands.push(renderClock);

    const audioCommand = this.audioCommand(visual);
    if (audioCommand) commands.push(audioCommand);

    const now = Date.now();
    if (now >= this.nextStatusPollAt) {
      this.nextStatusPollAt = now + 500;
      const status = await getNativeRendererStatus().catch(() => null);
      if (status) {
        let readiness: RendererReadinessReport | null = null;
        if (now >= this.nextReadinessPollAt) {
          this.nextReadinessPollAt = now + 2000;
          readiness = await getNativeRendererReadinessReport().catch(() => null);
        }
        this.syncNativeSourceFrameSize(status);
        this.reconcileSharedTextureUploads(status);
        this.reconcileNativeImageDecodes(status);
        this.degradedModeActive = !!status.degraded_mode_active;
        this.decodeBackpressureActive = !!status.decode_backpressure_active;
        this.decodeHandoffBackpressureActive = !!status.decode_handoff_backpressure_active;
        this.decodeHandoffUtilizationPct = Math.max(
          0,
          Math.min(100, Math.round(status.decode_handoff_utilization_pct ?? 0)),
        );
        this.decodePendingUploadBackpressureActive =
          !!status.decode_pending_upload_backpressure_active;
        this.decodePendingUploadUtilizationPct = Math.max(
          0,
          Math.min(100, Math.round(status.decode_pending_upload_utilization_pct ?? 0)),
        );
        this.decodeFramePoolBackpressureActive =
          !!status.decode_frame_pool_backpressure_active;
        this.decodeFramePoolUtilizationPct = Math.max(
          0,
          Math.min(100, Math.round(status.decode_frame_pool_utilization_pct ?? 0)),
        );
        this.decodeEstimateCacheBackpressureActive =
          !!status.decode_predecode_estimate_cache_backpressure_active;
        this.commandBackpressureActive = !!status.command_backpressure_active;
        updateNativeRendererRuntimeFromStatus(status, {
          readiness,
          capabilities: readiness?.capabilities,
          graphCatalogComplete: this.nativeGraphCatalogComplete,
          nativeGraphSourceFrames: this.nativeComputeGraphSourceFrames,
        });
      }
    }
    const overloadActive =
      this.degradedModeActive ||
      this.decodeBackpressureActive ||
      this.decodeHandoffBackpressureActive ||
      this.decodeHandoffUtilizationPct >= 85 ||
      this.decodePendingUploadBackpressureActive ||
      this.decodePendingUploadUtilizationPct >= 85 ||
      this.decodeFramePoolBackpressureActive ||
      this.decodeFramePoolUtilizationPct >= 85 ||
      this.decodeEstimateCacheBackpressureActive ||
      this.commandBackpressureActive;
    if (this.adaptiveOverloadPrefetchState !== overloadActive) {
      this.adaptiveOverloadPrefetchState = overloadActive;
      const overloadBurst = Math.max(1, Math.floor(this.mediaHighBurstLimit / 2));
      const overloadPrune = Math.min(
        16384,
        Math.max(this.prefetchCachePruneCount, Math.floor(this.prefetchCacheMaxEntries / 8)),
      );
      void setNativeRendererMediaPrefetchPolicy({
        media_high_burst_limit: overloadActive ? overloadBurst : this.mediaHighBurstLimit,
        prefetch_cache_max_entries: this.prefetchCacheMaxEntries,
        prefetch_cache_prune_count: overloadActive ? overloadPrune : this.prefetchCachePruneCount,
      }).catch(() => {});
    }
    if (this.adaptiveOverloadHandoffState !== overloadActive) {
      this.adaptiveOverloadHandoffState = overloadActive;
      const overloadShedPct = Math.max(50, Math.min(99, this.decodeHandoffPredecodeShedPct - 10));
      void this.setDecodeHandoffPolicy(
        this.decodeHandoffByteCapMb,
        overloadActive ? overloadShedPct : this.decodeHandoffPredecodeShedPct,
      ).catch(() => {});
    }
    if (this.adaptiveOverloadEstimateCacheState !== overloadActive) {
      this.adaptiveOverloadEstimateCacheState = overloadActive;
      const overloadEstimateCap = Math.max(
        256,
        Math.floor(this.decodePredecodeEstimateCacheCapEntries / 2),
      );
      void this.setDecodeEstimateCachePolicy(
        overloadActive ? overloadEstimateCap : this.decodePredecodeEstimateCacheCapEntries,
      ).catch(() => {});
    }
    const videoRefreshMs = overloadActive ? 160 : 80;
    this.dynamicSourceFrameCaptureSize = overloadActive
      ? Math.min(this.nativeSourceFrameSize, SOURCE_FRAME_SIZE_OVERLOAD)
      : Math.min(this.nativeSourceFrameSize, SOURCE_FRAME_DYNAMIC_CAPTURE_MAX);
    const videoPrefetchPriority = overloadActive ? 140 : 180;
    const mediaPrefetchPriority = overloadActive ? 72 : 96;
    const previewBudget: PreviewFlushBudget = {
      staticRemaining: overloadActive ? 1 : 3,
      dynamicRemaining: overloadActive ? 1 : 2,
    };
    layers.forEach((layer, index) => {
      const rawVjIndex = Number((layer as any).vjLayerIndex);
      const vjLayerIndex = Number.isFinite(rawVjIndex) ? Math.round(rawVjIndex) : null;
      const nativeGraphRoute = this.nativeGraphRouteForLayer(layer);
      const nativeSource = nativeGraphRoute?.source ?? nativeLayerSource(layer);
      const sourceType = nativeSource.sourceType;
      const nativeParams = nativeGpuParams(layer);
      const nativeUv = this.nativeLayerUvState(layer, nativeSource, width, height);
      const nativeShape = nativeLayerShapeState(layer);
      const effectIds = nativeGraphRoute?.kind === 'effect-pass' || nativeGraphRoute?.effectPasses?.length
        ? []
        : nativeHeartbeatEffectDescriptors(layer);
      const effectsSig = effectIds.length ? effectIds.join('|') : 'none';
      const graphInputSig = nativeSourceIdentity(nativeGraphRoute?.inputSource);
      const snap: LayerSnapshot = {
        id: layer.id,
        z: index,
        vjIndex: vjLayerIndex,
        visible: layer.visible,
        blend: canonicalBlendMode(layer.blendMode),
        opacity: layer.opacity,
        geometrySig: geometrySignature(layer),
        uvSig: nativeUv.signature,
        shapeSig: nativeShape.signature,
        sourceSig: `${sourceSignature(layer)}:${sourceType}:${nativeSource.uri}:input=${graphInputSig}`,
        nativeParamsSig: nativeParamsSignature(layer),
        effectsSig,
        colorSig: colorSignature(layer),
      };
      current.set(layer.id, snap);
      const prev = this.lastLayers.get(layer.id);

      const graphInput = nativeGraphRoute?.inputSource;
      const graphInputSrc = graphInput?.source ?? null;
      if (graphInput && graphInputSrc && graphInput.shouldPreview) {
        const sourceKey = this.sourceCacheKey(graphInputSrc.id, graphInputSrc.src);
        if (this.canUseNativeStaticImageDecode(graphInputSrc, graphInput.sourceType)) {
          if (this.markNativeStaticImageFrameReady(graphInputSrc)) {
            graphInputCommands.push({
              type: 'decode_media_source',
              source_id: graphInput.id,
              uri: graphInput.uri,
              source_type: graphInput.sourceType,
            });
          }
        } else {
          this.appendSourcePreviewCommand(
            graphInputCommands,
            graphInputSrc,
            graphInput.sourceType,
            now,
            !this.sourcePreviewSeq.has(sourceKey),
            graphInput.previewElement ?? null,
            previewBudget,
          );
        }
      }

      if (!prev || prev.z !== snap.z || prev.vjIndex !== snap.vjIndex || prev.visible !== snap.visible || prev.blend !== snap.blend || prev.opacity !== snap.opacity || prev.geometrySig !== snap.geometrySig || prev.uvSig !== snap.uvSig || prev.shapeSig !== snap.shapeSig) {
        commands.push({
          type: 'upsert_layer',
          layer_id: layer.id,
          z_index: index,
          vj_layer_index: vjLayerIndex,
          blend_mode: canonicalBlendMode(layer.blendMode),
          opacity: layer.opacity,
          corners: layer.corners,
          uv_transform: nativeUv.uvTransform,
          uv_flags: nativeUv.uvFlags,
          shape: nativeShape.shape,
        });
        commands.push({
          type: 'set_layer_visibility',
          layer_id: layer.id,
          visible: layer.visible,
        });
      }

      if (!prev || prev.sourceSig !== snap.sourceSig) {
        commands.push({
          type: 'bind_media_source',
          layer_id: layer.id,
          source_id: nativeSource.id,
          uri: nativeSource.uri,
          source_type: sourceType,
        });
        const src = nativeSource.source;
        if (src) {
          const sourceKey = this.sourceCacheKey(src.id, src.src);
          const sharedTextureSource = isNativeSharedTextureSource(src, sourceType);
          const nativeStaticImageDecode = this.canUseNativeStaticImageDecode(src, sourceType);
          if (nativeStaticImageDecode) {
            this.markNativeStaticImageFrameReady(src);
          }
          const dynamicSourceFrameSource = isDynamicSourceFrameSource(src, sourceType);
          if (
            nativeSource.shouldPrefetch &&
            !sharedTextureSource &&
            !this.prefetchedSources.has(sourceKey)
          ) {
            this.prefetchedSources.add(sourceKey);
            const priority = sourceType === 'video' ? videoPrefetchPriority : mediaPrefetchPriority;
            const options = sourceType === 'video'
              ? this.nativeVideoPrefetchOptions(src, now)
              : undefined;
            void prefetchNativeRendererMedia(src.id, src.src, priority, sourceType, options).catch(() => {});
          }
          if (dynamicSourceFrameSource) {
            this.videoRefreshAt.set(sourceKey, now + videoRefreshMs);
          } else {
            this.videoRefreshAt.delete(sourceKey);
          }
          if (nativeSource.shouldPreview && !nativeStaticImageDecode) {
            this.appendSourcePreviewCommand(commands, src, sourceType, now, true, null, previewBudget);
          }
          if (src.shaderCode) {
            const shaderId = `${src.id}:${hashString(src.shaderCode)}`;
            if (!this.precompiledShaders.has(shaderId)) {
              this.precompiledShaders.add(shaderId);
              commands.push({
                type: 'precompile_shader',
                shader_id: shaderId,
                stage: 'pixel',
                source: src.shaderCode,
                entry: 'main',
              });
            }
            // Bind ISF shader to layer (sent when source changes)
            commands.push({
              type: 'bind_isf_shader',
              layer_id: layer.id,
              shader_id: shaderId,
            });
          }
        }
      }

      if (nativeParams && (!prev || prev.nativeParamsSig !== snap.nativeParamsSig)) {
        commands.push({
          type: 'set_layer_native_params',
          layer_id: layer.id,
          params: nativeParams,
        });
      }

      const src = nativeSource.source;
      if (src && isDynamicSourceFrameSource(src, sourceType)) {
        const sourceKey = this.sourceCacheKey(src.id, src.src);
        activeVideoKeys.add(sourceKey);
        if (sourceType === 'video' && !playbackSourcesSent.has(sourceKey)) {
          commands.push(this.nativeVideoPlaybackCommand(src, sourceType, now, renderClock));
          playbackSourcesSent.add(sourceKey);
        }
        const dueAt = this.videoRefreshAt.get(sourceKey) ?? 0;
        const sharedTextureSource = isNativeSharedTextureSource(src, sourceType);
        const continuousNativeVideoPrefetch =
          this.supportsNativeFeature('native_media_decode') &&
          this.supportsNativeFeature('media_prefetch');
        const nativeVideoDecodePump =
          this.supportsNativeFeature('native_video_decode_pump') &&
          this.supportsNativeFeature('native_video_frame_decode') &&
          this.supportsNativeFeature('native_media_source_playback_state');
        const brokerVideoFramePrefetch =
          this.supportsNativeFeature('native_video_frame_prefetch') ||
          this.supportsNativeFeature('video_frame_prefetch');
        if (
          !sharedTextureSource &&
          !nativeVideoDecodePump &&
          sourceType === 'video' &&
          nativeSource.shouldPrefetch &&
          (continuousNativeVideoPrefetch || brokerVideoFramePrefetch)
        ) {
          const prefetchDueAt = this.nativeVideoPrefetchAt.get(sourceKey) ?? 0;
          if (now >= prefetchDueAt) {
            const prefetchRefreshMs = overloadActive
              ? NATIVE_VIDEO_PREFETCH_OVERLOAD_REFRESH_MS
              : NATIVE_VIDEO_PREFETCH_REFRESH_MS;
            this.nativeVideoPrefetchAt.set(sourceKey, now + prefetchRefreshMs);
            void prefetchNativeRendererMedia(
              src.id,
              src.src,
              videoPrefetchPriority,
              sourceType,
              this.nativeVideoPrefetchOptions(
                src,
                now,
                overloadActive ? 0 : NATIVE_VIDEO_PREFETCH_WINDOW_FRAMES,
                !!prev && this.supportsNativeFeature('native_media_source_playback_state'),
              ),
            ).catch(() => {});
          }
        }
        if (nativeSource.shouldPreview) {
          this.appendSourcePreviewCommand(commands, src, sourceType, now, false, null, previewBudget);
        }
      } else if (!src && nativeSource.shouldPreview) {
        const previewSrc = {
          id: nativeSource.id,
          src: nativeSource.uri,
          name: nativeSource.id,
          type: 'image',
        } as NonNullable<Layer['source']>;
        this.appendSourcePreviewCommand(
          commands,
          previewSrc,
          sourceType,
          now,
          !prev || prev.sourceSig !== snap.sourceSig,
          nativeSource.previewElement ?? null,
          previewBudget,
        );
      }

      if (!prev || prev.colorSig !== snap.colorSig) {
        const rgba = layerRgba(layer);
        if (rgba) {
          commands.push({
            type: 'set_layer_color',
            layer_id: layer.id,
            rgba,
          });
        }
      }

      if (!prev || prev.effectsSig !== snap.effectsSig) {
        commands.push({
          type: 'set_effect_chain',
          layer_id: layer.id,
          effect_ids: effectIds,
        });
      }

      // ── ISF shader: send uniforms + render every frame ──
      const src2 = layer.source;
      if (src2?.shaderCode && layer.visible) {
        const shaderId = `${src2.id}:${hashString(src2.shaderCode)}`;
        const shaderTime =
          typeof renderClock.time === 'number' && Number.isFinite(renderClock.time)
            ? renderClock.time
            : now / 1000;
        const shaderDelta =
          typeof renderClock.time_delta === 'number' && Number.isFinite(renderClock.time_delta)
            ? renderClock.time_delta
            : 1.0 / this.targetFps;
        const shaderFrameIndex =
          typeof renderClock.frame_index === 'number' && Number.isFinite(renderClock.frame_index)
            ? Math.max(0, Math.round(renderClock.frame_index))
            : this.frameId;
        const nowDate = new Date();
        const secsSinceMidnight =
          nowDate.getHours() * 3600 + nowDate.getMinutes() * 60 + nowDate.getSeconds() + nowDate.getMilliseconds() / 1000;

        // Collect user shader input values
        const floatInputs: Record<string, number> = {};
        const pointInputs: Record<string, [number, number]> = {};
        const colorInputs: Record<string, [number, number, number, number]> = {};
        if (src2.shaderValues) {
          for (const [key, val] of Object.entries(src2.shaderValues)) {
            if (typeof val === 'number') {
              floatInputs[key] = val;
            } else if (typeof val === 'boolean') {
              floatInputs[key] = val ? 1.0 : 0.0;
            } else if (Array.isArray(val)) {
              if (val.length === 2) {
                pointInputs[key] = [val[0], val[1]];
              } else if (val.length >= 4) {
                colorInputs[key] = [val[0], val[1], val[2], val[3]];
              }
            }
          }
        }

        const audioFields = ghostAudioCommandFieldsFromVisualAudio(visual);
        commands.push({
          type: 'update_isf_uniforms',
          shader_id: shaderId,
          time: shaderTime,
          time_delta: shaderDelta,
          frame_index: shaderFrameIndex,
          render_width: this.desiredWidth || 1920,
          render_height: this.desiredHeight || 1080,
          date: [nowDate.getFullYear(), nowDate.getMonth() + 1, nowDate.getDate(), secsSinceMidnight],
          ...audioFields,
          audio_level: audioFields.active ? audioFields.level : 0,
          audio_bass: audioFields.active ? audioFields.bass : 0,
          audio_mid: audioFields.active ? audioFields.mid : 0,
          audio_treble: audioFields.active ? audioFields.treble : 0,
          audio_high: audioFields.active ? audioFields.high : 0,
          audio_beat: audioFields.active ? audioFields.beat : 0,
          audio_beat_phase: audioFields.beat_phase,
          audio_bpm: audioFields.bpm,
          audio_spectral_centroid: audioFields.active ? audioFields.centroid : 0,
          audio_kick: audioFields.active ? audioFields.kick : 0,
          audio_snare: audioFields.active ? audioFields.snare : 0,
          float_inputs: floatInputs,
          point_inputs: pointInputs,
          color_inputs: colorInputs,
        });

        commands.push({
          type: 'render_isf_to_layer',
          layer_id: layer.id,
        });
      }
    });

    this.lastLayers.forEach((_snap, id) => {
      if (!current.has(id)) {
        commands.push({
          type: 'remove_layer',
          layer_id: id,
        });
      }
    });
    this.videoRefreshAt.forEach((_due, key) => {
      if (!activeVideoKeys.has(key)) this.videoRefreshAt.delete(key);
    });
    this.nativeVideoPrefetchAt.forEach((_due, key) => {
      if (!activeVideoKeys.has(key)) this.nativeVideoPrefetchAt.delete(key);
    });

    if (graphInputCommands.length) {
      const graphInputSummary = await submitNativeRendererCommands(graphInputCommands);
      this.warnNativeCommandDrops(graphInputSummary, 'graph-input-source-frames');
    }

    await this.renderNativeGraphSources(layers, width, height, renderClock, visual);

    if (!commands.length) return;

    commands.push({ type: 'present' });

    const batch: CommandBatch = {
      frame_id: ++this.frameId,
      commands,
    };

    const batchSummary = await submitNativeRendererBatch(batch);
    this.warnNativeCommandDrops(batchSummary, 'frame-batch');
    this.lastLayers = current;
  }

  private renderClockCommand(): NativeRenderClockCommand {
    const manualTime = this.latestRenderClockSeconds;
    const time =
      manualTime !== null
        ? manualTime
        : Math.max(0, (performance.now() - this.liveClockOriginMs) / 1000);
    const previous = this.lastRenderClockSentSeconds;
    const timeDelta =
      previous !== null && time >= previous
        ? clampNumber(time - previous, 0, 0.1)
        : 1 / Math.max(1, this.targetFps);
    this.lastRenderClockSentSeconds = time;
    return {
      type: 'set_render_clock',
      mode: manualTime !== null ? 'manual' : 'live',
      time: Number(time.toFixed(6)),
      time_delta: Number(timeDelta.toFixed(6)),
      frame_index: this.frameId + 1,
    };
  }

  private sharedTextureInfoKey(src: NonNullable<Layer['source']>, sourceType: string): string {
    const senderName = sharedTextureSenderName(src);
    if (senderName) return `${sourceType || src.type || 'shared'}:${senderName}`;
    return this.sourceCacheKey(src.id, src.src);
  }

  private queueSharedTextureInfoRefresh(
    src: NonNullable<Layer['source']>,
    sourceType: string,
    now: number,
  ) {
    if (!isElectron || !isNativeSharedTextureSource(src, sourceType)) return;

    const key = this.sharedTextureInfoKey(src, sourceType);
    const nextPollAt = this.sharedTextureInfoNextPollAt.get(key) ?? 0;
    if (now < nextPollAt || this.sharedTextureInfoInFlight.has(key)) return;

    this.sharedTextureInfoNextPollAt.set(key, now + 80);
    this.sharedTextureInfoInFlight.add(key);
    void (async () => {
      try {
        const senderName = sharedTextureSenderName(src);
        if (senderName && this.sharedTextureReceiverSender !== senderName) {
          const result = await invoke<{ connected?: boolean }>('spout_start_receiver', { senderName });
          if (result?.connected === false) return;
          this.sharedTextureReceiverSender = senderName;
        }

        const info = await receiveSpoutTextureInfo();
        if (!info?.available || !info.handle || !info.width || !info.height) return;
        if (senderName && info.senderName && info.senderName !== senderName) return;
        this.sharedTextureInfoCache.set(key, { info, updatedAt: performance.now() });
      } catch (err) {
        const failures = this.sharedTextureInfoNextPollAt.get(`${key}:failures`) ?? 0;
        if (failures < 3) {
          console.warn('[NativeRendererSync] shared texture metadata unavailable:', err);
        }
        this.sharedTextureInfoNextPollAt.set(`${key}:failures`, failures + 1);
      } finally {
        this.sharedTextureInfoInFlight.delete(key);
      }
    })();
  }

  private appendSharedTextureSourceFrameCommand(
    commands: RendererCommand[],
    src: NonNullable<Layer['source']>,
    sourceType: string,
    now: number,
    force: boolean,
    budget: PreviewFlushBudget | null,
  ): boolean {
    if (!isNativeSharedTextureSource(src, sourceType)) return false;
    if (!this.supportsNativeFeature('shared_texture_source_frame_upload')) return false;

    this.queueSharedTextureInfoRefresh(src, sourceType, now);
    const cacheKey = this.sharedTextureInfoKey(src, sourceType);
    const cached = this.sharedTextureInfoCache.get(cacheKey);
    const info = cached?.info;
    if (!info?.handle) return false;

    const width = Math.floor(Number(info.width ?? 0));
    const height = Math.floor(Number(info.height ?? 0));
    if (width <= 0 || height <= 0) return false;

    const sourceKey = this.sourceCacheKey(src.id, src.src);
    const signature = [
      'shared',
      info.platform,
      info.senderName ?? sharedTextureSenderName(src),
      info.frame ?? 0,
      width,
      height,
      info.format ?? 'unknown',
      info.handleByteLength ?? 0,
      info.handle,
    ].join(':');
    if (!force && this.sourcePreviewSig.get(sourceKey) === signature) {
      return true;
    }
    if (budget && budget.dynamicRemaining <= 0) return true;

    const previousSignature = this.sourcePreviewSig.get(sourceKey);
    const previousSeq = this.sourcePreviewSeq.get(sourceKey);
    const seq = (this.sourcePreviewSeq.get(sourceKey) ?? 0) + 1;
    this.sourcePreviewSeq.set(sourceKey, seq);
    this.sourcePreviewSig.set(sourceKey, signature);
    this.sourcePreviewNextAt.set(sourceKey, now + VIDEO_PREVIEW_REFRESH_MS);
    this.sharedTextureUploadPending.set(sourceKey, {
      sourceId: src.id,
      signature,
      seq,
      previousSignature,
      previousSeq,
      submittedAt: now,
    });
    if (budget) budget.dynamicRemaining -= 1;

    commands.push(buildNativeSharedTextureSourceFrameCommand({
      sourceId: src.id,
      width,
      height,
      info: info as SpoutSharedTextureInfo & { handle: string },
      senderName: sharedTextureSenderName(src),
      seq,
    }));
    return true;
  }

  private appendSourcePreviewCommand(
    commands: RendererCommand[],
    src: NonNullable<Layer['source']>,
    sourceType: string,
    now: number,
    force: boolean,
    previewElement: CanvasImageSource | null = null,
    budget: PreviewFlushBudget | null = null,
  ) {
    const previewable =
      sourceType === 'image' ||
      sourceType === 'video' ||
      sourceType === 'threejs' ||
      sourceType === 'p5js' ||
      sourceType === 'javascript' ||
      sourceType === 'synthvision' ||
      sourceType.startsWith('generated:') ||
      sourceType.startsWith('gpu:') ||
      isNativeSharedTextureSource(src, sourceType);
    if (!previewable) return;

    const sourceKey = this.sourceCacheKey(src.id, src.src);
    const dueAt = this.sourcePreviewNextAt.get(sourceKey) ?? 0;
    const isVideoLike =
      sourceType === 'video' ||
      isNativeSharedTextureSource(src, sourceType) ||
      sourceType.startsWith('gpu:') ||
      !!previewElement ||
      !!src.videoElement ||
      !!src.threejsCanvas ||
      !!src.synthVisionCanvas;
    const previewRefreshMs = sourceType.startsWith('gpu:')
      ? GPU_PREVIEW_REFRESH_MS
      : VIDEO_PREVIEW_REFRESH_MS;
    if (!force && now < dueAt) return;
    if (
      this.appendSharedTextureSourceFrameCommand(
        commands,
        src,
        sourceType,
        now,
        force,
        budget,
      )
    ) {
      return;
    }
    if (budget) {
      const remaining = isVideoLike ? budget.dynamicRemaining : budget.staticRemaining;
      if (remaining <= 0) return;
    }

    const captureSize = this.sourcePreviewCaptureSize(sourceType, isVideoLike);
    const captured = this.captureSourcePreview(src, sourceType, previewElement, captureSize);
    if (!captured) {
      if (isVideoLike) {
        this.sourcePreviewNextAt.set(sourceKey, now + previewRefreshMs);
      }
      return;
    }

    const previousSig = this.sourcePreviewSig.get(sourceKey);
    if (!force && previousSig === captured.signature && !isVideoLike) return;

    const seq = (this.sourcePreviewSeq.get(sourceKey) ?? 0) + 1;
    this.sourcePreviewSeq.set(sourceKey, seq);
    this.sourcePreviewSig.set(sourceKey, captured.signature);
    this.sourcePreviewNextAt.set(
      sourceKey,
      now + (isVideoLike ? previewRefreshMs : STATIC_PREVIEW_RETRY_MS),
    );
    if (budget) {
      if (isVideoLike) budget.dynamicRemaining -= 1;
      else budget.staticRemaining -= 1;
    }
    commands.push({
      type: 'upload_source_frame',
      source_id: src.id,
      width: captureSize,
      height: captureSize,
      rgba_buffer: captured.rgbaBuffer,
      seq,
    });
  }

  private sourcePreviewCaptureSize(sourceType: string, isVideoLike: boolean): number {
    if (sourceType.startsWith('gpu:')) return this.dynamicSourceFrameCaptureSize;
    if (isVideoLike) return this.dynamicSourceFrameCaptureSize;
    return this.nativeSourceFrameSize;
  }

  private nativeLayerUvState(
    layer: Layer,
    nativeSource: NativeLayerSource,
    outputWidth: number,
    outputHeight: number,
  ): NativeLayerUvState {
    const crop = normalizedCropRegion(layer);
    const uvTransform: NativeVec4 = crop
      ? [
          quantizeNative(crop.x),
          quantizeNative(1 - crop.y - crop.height),
          quantizeNative(crop.width),
          quantizeNative(crop.height),
        ]
      : [0, 0, 1, 1];

    let sourceAspect = this.nativeLayerSourceAspect(layer, nativeSource, outputWidth, outputHeight);
    if (crop) {
      sourceAspect *= crop.width / crop.height;
    }
    const layerAspect = layerAspectFromCorners(layer, outputWidth, outputHeight);
    const ratio = clampNumber(sourceAspect / Math.max(0.001, layerAspect), 0.001, 128);
    const uvFlags: NativeVec4 = [
      contentFitCode(layer.contentFit),
      quantizeNative(ratio),
      !!layer.flipH !== !!nativeSource.source?.mirrorX ? 1 : 0,
      layer.flipV ? 1 : 0,
    ];

    return {
      uvTransform,
      uvFlags,
      signature: `${uvTransform.map((v) => v.toFixed(5)).join(':')}|${uvFlags.map((v, i) => v.toFixed(i === 1 ? 5 : 0)).join(':')}`,
    };
  }

  private nativeLayerSourceAspect(
    layer: Layer,
    nativeSource: NativeLayerSource,
    outputWidth: number,
    outputHeight: number,
  ): number {
    const fallback = clampNumber(outputWidth / Math.max(1, outputHeight), 0.001, 128);
    if (typeof nativeSource.aspect === 'number' && Number.isFinite(nativeSource.aspect)) {
      return clampNumber(nativeSource.aspect, 0.001, 128);
    }
    const source = nativeSource.source;
    const candidates: Array<CanvasImageSource | null | undefined> = [
      nativeSource.previewElement,
      source?.videoElement,
      source?.synthVisionCanvas,
      source?.threejsCanvas,
      source?.texture?.image as CanvasImageSource | undefined,
      (layer as any)._gpuLayerPreviewCanvas as CanvasImageSource | undefined,
    ];
    for (const candidate of candidates) {
      if (!candidate) continue;
      const dims = this.previewElementDimensions(candidate);
      if (dims) return clampNumber(dims.width / dims.height, 0.001, 128);
    }
    const anySource = source as any;
    const sourceWidth = Number(anySource?.width ?? anySource?.videoWidth ?? anySource?.naturalWidth ?? 0);
    const sourceHeight = Number(anySource?.height ?? anySource?.videoHeight ?? anySource?.naturalHeight ?? 0);
    if (sourceWidth > 0 && sourceHeight > 0) return clampNumber(sourceWidth / sourceHeight, 0.001, 128);
    return fallback;
  }

  private async warmNativeWgslStdlib() {
    if (!this.running || this.nativeWgslStdlibWarmed) return;
    const commands: RendererCommand[] = Object.entries(WGSL_STDLIB).map(([name, source]) => ({
      type: 'precompile_shader',
      shader_id: `stdlib:${name}:${hashString(source)}`,
      stage: 'module',
      source,
      entry: '',
    }));
    const probeSource = resolveGhostWgsl(
      `#include <tonemap>

@fragment
fn fs_main() -> @location(0) vec4<f32> {
  let color = ghost_display_aces(vec3<f32>(0.22, 0.48, 1.6), 0.0);
  return vec4<f32>(color, 1.0);
}
`,
      'native-startup-probe',
    );
    commands.push({
      type: 'precompile_shader',
      shader_id: `probe:native-startup:${hashString(probeSource)}`,
      stage: 'pixel',
      source: probeSource,
      entry: 'fs_main',
    });
    commands.push(...buildPlanetNativePrecompileCommands());
    commands.push(...buildSmoke3DNativePrecompileCommands());
    commands.push(...buildInkCloudNativePrecompileCommands());
    commands.push(...buildParticleFieldNativePrecompileCommands());
    commands.push(...buildVolumetricSpheresNativePrecompileCommands());
    commands.push(...buildFlythroughNativePrecompileCommands());
    commands.push(...buildPixelParticlesNativePrecompileCommands());
    commands.push(...buildPointCloudFXNativePrecompileCommands());
    commands.push(...buildNativeEffectPassPrecompileCommands());
    await submitNativeRendererBatch({
      frame_id: ++this.frameId,
      commands,
    });
    this.nativeWgslStdlibWarmed = true;
    const status = await getNativeRendererStatus().catch(() => null);
    if (status) {
      console.log(
        `[NativeRendererSync] native WGSL warm-up cache=${status.shader_cache_entries} compiled=${status.shader_precompile_compiled} failed=${status.shader_precompile_failed} dropped=${status.shader_precompile_dropped}`,
      );
    }
  }

  private captureSourcePreview(
    src: NonNullable<Layer['source']>,
    sourceType: string,
    previewElement: CanvasImageSource | null = null,
    captureSize = SOURCE_PREVIEW_SIZE,
  ): { rgbaBuffer: Uint8Array; signature: string } | null {
    const element = this.resolvePreviewElement(src, sourceType, previewElement);
    if (!element) return null;
    const dimensions = this.previewElementDimensions(element);
    if (!dimensions) return null;

    if (!this.previewCanvas) {
      this.previewCanvas = document.createElement('canvas');
      this.previewContext = this.previewCanvas.getContext('2d', { willReadFrequently: true });
    }
    const canvas = this.previewCanvas;
    const ctx = this.previewContext;
    if (!ctx) return null;
    if (canvas.width !== captureSize || canvas.height !== captureSize) {
      canvas.width = captureSize;
      canvas.height = captureSize;
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    try {
      ctx.clearRect(0, 0, captureSize, captureSize);
      ctx.drawImage(element, 0, 0, captureSize, captureSize);
      const imageData = ctx.getImageData(0, 0, captureSize, captureSize);
      const videoTime =
        element instanceof HTMLVideoElement
          ? Math.floor((element.currentTime || 0) * 8)
          : 0;
      return {
        rgbaBuffer: new Uint8Array(imageData.data),
        signature: `${src.id}:${sourceType}:${captureSize}:${dimensions.width}x${dimensions.height}:${videoTime}:${hashString(src.src || '')}`,
      };
    } catch (err) {
      const key = this.sourceCacheKey(src.id, src.src);
      const seen = this.sourcePreviewFailures.get(key) ?? 0;
      if (seen < 3) {
        console.warn('[NativeRendererSync] source preview capture failed', src.name || src.id, err);
        this.sourcePreviewFailures.set(key, seen + 1);
      }
      return null;
    } finally {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  private resolvePreviewElement(
    src: NonNullable<Layer['source']>,
    sourceType: string,
    previewElement: CanvasImageSource | null = null,
  ): CanvasImageSource | null {
    if (previewElement && this.previewElementDimensions(previewElement)) return previewElement;
    if (src.videoElement && src.videoElement.readyState >= 2) return src.videoElement;
    if (src.synthVisionCanvas) return src.synthVisionCanvas;
    if (src.threejsCanvas) return src.threejsCanvas;

    const textureImage = src.texture?.image as CanvasImageSource | undefined;
    if (textureImage && this.previewElementDimensions(textureImage)) return textureImage;

    if (sourceType !== 'image' || !src.src) return null;
    const key = this.sourceCacheKey(src.id, src.src);
    const cached = this.previewImageElements.get(key);
    if (cached && cached.complete && cached.naturalWidth > 0) return cached;
    if (!this.previewImageLoads.has(key)) {
      this.previewImageLoads.add(key);
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        this.previewImageElements.set(key, img);
        this.sourcePreviewFailures.delete(key);
        if (this.running) this.scheduleSync(this.desiredWidth, this.desiredHeight, this.latestLayers);
      };
      img.onerror = () => {
        this.previewImageLoads.delete(key);
        this.sourcePreviewFailures.set(key, (this.sourcePreviewFailures.get(key) ?? 0) + 1);
      };
      img.src = src.src;
    }
    return null;
  }

  private previewElementDimensions(element: CanvasImageSource): { width: number; height: number } | null {
    if (element instanceof HTMLVideoElement) {
      const width = element.videoWidth || element.clientWidth;
      const height = element.videoHeight || element.clientHeight;
      return width > 0 && height > 0 ? { width, height } : null;
    }
    if (element instanceof HTMLImageElement) {
      const width = element.naturalWidth || element.width;
      const height = element.naturalHeight || element.height;
      return width > 0 && height > 0 ? { width, height } : null;
    }
    if (element instanceof HTMLCanvasElement) {
      return element.width > 0 && element.height > 0
        ? { width: element.width, height: element.height }
        : null;
    }
    if (typeof ImageBitmap !== 'undefined' && element instanceof ImageBitmap) {
      return element.width > 0 && element.height > 0
        ? { width: element.width, height: element.height }
        : null;
    }
    if (typeof OffscreenCanvas !== 'undefined' && element instanceof OffscreenCanvas) {
      return element.width > 0 && element.height > 0
        ? { width: element.width, height: element.height }
        : null;
    }
    const anyElement = element as any;
    const width = Number(anyElement.width ?? anyElement.videoWidth ?? anyElement.naturalWidth ?? 0);
    const height = Number(anyElement.height ?? anyElement.videoHeight ?? anyElement.naturalHeight ?? 0);
    return width > 0 && height > 0 ? { width, height } : null;
  }

  async logStatus() {
    if (!this.running) return;
    const status = await getNativeRendererStatus().catch(() => null);
    if (status) {
      this.reconcileSharedTextureUploads(status);
      this.reconcileNativeImageDecodes(status);
      const sourceUploadBreakdown =
        `${status.source_frame_cpu_fallback_uploads}cpu/` +
        `${status.source_frame_file_uploads}file/` +
        `${status.source_frame_base64_uploads}b64/` +
        `${status.source_frame_json_uploads}json/` +
        `${status.source_frame_shared_texture_uploads}shared/` +
        `${status.source_frame_shared_texture_rejected_uploads}sharedReject/` +
        `${status.source_frame_rejected_uploads}reject`;
      console.log(
        `[NativeRendererSync] status backend=${status.backend} ready=${status.backend_ready} adapter=${status.adapter_name ?? 'unknown'} quality=${status.native_quality.active_tier}@${status.native_quality.quality_scale.toFixed(2)} clock=${status.render_clock_mode}@${status.render_clock_time.toFixed(3)}s#${status.render_clock_frame_index} layers=${status.layers_seen} shaders=${status.shader_cache_entries} compiled=${status.shader_precompile_compiled} failed=${status.shader_precompile_failed} procedural=${status.native_procedural_layers} graphLayers=${status.native_graph_source_frame_layers} proxyLayers=${status.native_instrument_proxy_layers} nativeShaderLayers=${status.native_shader_layers}/${status.isf_shader_bindings} uniforms=${status.isf_uniform_sets} frames=${status.source_frames_active}/${status.source_frame_slots}@${status.source_frame_size}px/${status.source_frame_format}/mips${status.source_frame_mip_levels ?? 1} uploads=${status.source_frame_uploads}(${sourceUploadBreakdown}) last=${status.source_frame_last_upload_transport}:${status.source_frame_last_upload_width}x${status.source_frame_last_upload_height}/${status.source_frame_last_input_bytes}->${status.source_frame_last_upload_bytes}b graphs=${status.compute_graph_runs}/${status.compute_graph_passes} render=${status.compute_graph_render_passes} sourceGraph=${status.compute_graph_source_frame_renders} graphBuffers=${status.compute_graph_persistent_buffers} present=${status.swapchain_last_present_result}:${status.swapchain_presented}/${status.swapchain_present_attempts} fail=${status.output_present_consecutive_failures} preview=${status.source_previews_active}/${status.source_preview_slots}@${status.source_preview_size}px cpu=${status.avg_render_cpu_ms.toFixed(2)}ms gpu=${status.gpu_timing_supported ? status.avg_render_gpu_ms.toFixed(2) : 'off'}ms samples=${status.gpu_timing_samples ?? 0}`,
      );
    }
  }

  async applyPresentPolicyProfile(profile: PresentPolicyProfile = this.presentProfile) {
    if (!this.running) return;
    this.presentProfile = profile;
    if (!this.supportsNativeMethod('set_present_policy')) return;
    const status = await getNativeRendererStatus().catch(() => null);
    if (!status) return;

    const supportsTearing = !!status.supports_tearing;
    const supportsWaitable = !!status.supports_waitable_object;

    let policy: PresentPolicyConfig;
    if (profile === 'vsync-live') {
      policy = {
        present_mode: 'vsync',
        allow_tearing: false,
        max_frame_latency: 2,
        use_waitable_object: false,
      };
    } else if (profile === 'low-latency-aggressive') {
      policy = {
        present_mode: 'immediate',
        allow_tearing: supportsTearing,
        max_frame_latency: 1,
        use_waitable_object: supportsWaitable,
      };
    } else {
      policy = {
        present_mode: 'immediate',
        allow_tearing: false,
        max_frame_latency: 2,
        use_waitable_object: supportsWaitable,
      };
    }

    await setNativeRendererPresentPolicy(policy).catch(() => {});
  }

  async setTargetFps(targetFps: number) {
    const clamped = Math.max(1, Math.min(480, Math.round(targetFps)));
    this.targetFps = clamped;
    if (!this.running) return;
    if (!this.supportsNativeMethod('set_target_fps')) return;
    await setNativeRendererTargetFps({ target_fps: clamped }).catch(() => {});
  }

  async setCommandDrainPolicy(maxCommandsPerTick: number) {
    const clamped = Math.max(64, Math.min(16384, Math.round(maxCommandsPerTick)));
    this.commandDrainLimit = clamped;
    if (!this.running) return;
    if (!this.supportsNativeMethod('set_command_drain_policy')) return;
    await setNativeRendererCommandDrainPolicy({
      max_commands_per_tick: clamped,
    }).catch(() => {});
  }

  async setAutoPresentPolicy(autoPresentOnStateChange: boolean) {
    this.autoPresentOnStateChange = !!autoPresentOnStateChange;
    if (!this.running) return;
    if (!this.supportsNativeMethod('set_auto_present_policy')) return;
    await setNativeRendererAutoPresentPolicy({
      auto_present_on_state_change: this.autoPresentOnStateChange,
    }).catch(() => {});
  }

  async setDecodeCpuBackupPolicy(decodeStoreCpuBackupFrames: boolean) {
    this.decodeStoreCpuBackupFrames = !!decodeStoreCpuBackupFrames;
    if (!this.running) return;
    if (!this.supportsNativeMethod('set_decode_cpu_backup_policy')) return;
    await setNativeRendererDecodeCpuBackupPolicy({
      decode_store_cpu_backup_frames: this.decodeStoreCpuBackupFrames,
    }).catch(() => {});
  }

  async setDecodeSyntheticFallbackPolicy(decodeAllowSyntheticFallback: boolean) {
    this.decodeAllowSyntheticFallback = !!decodeAllowSyntheticFallback;
    if (!this.running) return;
    if (!this.supportsNativeMethod('set_decode_synthetic_fallback_policy')) return;
    await setNativeRendererDecodeSyntheticFallbackPolicy({
      decode_allow_synthetic_fallback: this.decodeAllowSyntheticFallback,
    }).catch(() => {});
  }

  async setTexturePoolCapMb(texturePoolCapMb: number) {
    const clamped = Math.max(64, Math.min(16384, Math.round(texturePoolCapMb)));
    this.texturePoolCapMb = clamped;
    if (!this.running) return;
    if (!this.supportsNativeMethod('set_texture_pool_cap')) return;
    await setNativeRendererTexturePoolCap({ texture_pool_cap_mb: clamped }).catch(() => {});
  }

  async setShaderPrecompilePolicy(queueCap: number, perFrame: number) {
    const clampedQueueCap = Math.max(64, Math.min(65536, Math.round(queueCap)));
    const clampedPerFrame = Math.max(1, Math.min(128, Math.round(perFrame)));
    this.shaderPrecompileQueueCap = clampedQueueCap;
    this.shaderPrecompilePerFrame = clampedPerFrame;
    if (!this.running) return;
    if (!this.supportsNativeMethod('set_shader_precompile_policy')) return;
    await setNativeRendererShaderPrecompilePolicy({
      shader_precompile_queue_cap: clampedQueueCap,
      shader_precompile_per_frame: clampedPerFrame,
    }).catch(() => {});
  }

  async setMediaPrefetchPolicy(
    mediaHighBurstLimit: number,
    prefetchCacheMaxEntries: number,
    prefetchCachePruneCount: number,
  ) {
    const clampedBurst = Math.max(1, Math.min(255, Math.round(mediaHighBurstLimit)));
    const clampedMax = Math.max(256, Math.min(262144, Math.round(prefetchCacheMaxEntries)));
    const clampedPrune = Math.max(16, Math.min(16384, Math.round(prefetchCachePruneCount)));
    this.mediaHighBurstLimit = clampedBurst;
    this.prefetchCacheMaxEntries = clampedMax;
    this.prefetchCachePruneCount = clampedPrune;
    this.adaptiveOverloadPrefetchState = null;
    if (!this.running) return;
    if (!this.supportsNativeMethod('set_media_prefetch_policy')) return;
    await setNativeRendererMediaPrefetchPolicy({
      media_high_burst_limit: clampedBurst,
      prefetch_cache_max_entries: clampedMax,
      prefetch_cache_prune_count: clampedPrune,
    }).catch(() => {});
  }

  async setDecodePreviewPolicy(previewSize: number, previewCacheMb: number) {
    const clampedSize = Math.max(16, Math.min(4096, Math.round(previewSize)));
    const clampedCacheMb = Math.max(16, Math.min(1024, Math.round(previewCacheMb)));
    this.decodePreviewSize = clampedSize;
    this.decodePreviewCacheMb = clampedCacheMb;
    if (!this.running) return;
    if (!this.supportsNativeMethod('set_decode_preview_policy')) return;
    await setNativeRendererDecodePreviewPolicy({
      decode_preview_size: clampedSize,
      decode_preview_cache_mb: clampedCacheMb,
    }).catch(() => {});
  }

  async setDecodeTargetPolicy(useOutputResolution: boolean) {
    this.decodeUseOutputResolution = !!useOutputResolution;
    if (!this.running) return;
    if (!this.supportsNativeMethod('set_decode_target_policy')) return;
    await setNativeRendererDecodeTargetPolicy({
      decode_use_output_resolution: this.decodeUseOutputResolution,
    }).catch(() => {});
  }

  async setDecodeUploadPolicy(decodeUploadQueueCapMb: number) {
    const clampedCapMb = Math.max(16, Math.min(1024, Math.round(decodeUploadQueueCapMb)));
    this.decodeUploadQueueCapMb = clampedCapMb;
    if (!this.running) return;
    if (!this.supportsNativeMethod('set_decode_upload_policy')) return;
    await setNativeRendererDecodeUploadPolicy({
      decode_upload_queue_cap_mb: clampedCapMb,
    }).catch(() => {});
  }

  async setDecodeHandoffPolicy(
    decodeHandoffByteCapMb: number,
    decodeHandoffPredecodeShedPct: number,
  ) {
    const clampedCapMb = Math.max(16, Math.min(1024, Math.round(decodeHandoffByteCapMb)));
    const clampedShedPct = Math.max(50, Math.min(99, Math.round(decodeHandoffPredecodeShedPct)));
    this.decodeHandoffByteCapMb = clampedCapMb;
    this.decodeHandoffPredecodeShedPct = clampedShedPct;
    if (!this.running) return;
    if (!this.supportsNativeMethod('set_decode_handoff_policy')) return;
    await setNativeRendererDecodeHandoffPolicy({
      decode_handoff_byte_cap_mb: clampedCapMb,
      decode_handoff_predecode_shed_pct: clampedShedPct,
    }).catch(() => {});
  }

  async setDecodeEstimateCachePolicy(decodePredecodeEstimateCacheCapEntries: number) {
    const clampedCap = Math.max(
      256,
      Math.min(262144, Math.round(decodePredecodeEstimateCacheCapEntries)),
    );
    this.decodePredecodeEstimateCacheCapEntries = clampedCap;
    if (!this.running) return;
    if (!this.supportsNativeMethod('set_decode_estimate_cache_policy')) return;
    await setNativeRendererDecodeEstimateCachePolicy({
      decode_predecode_estimate_cache_cap_entries: clampedCap,
    }).catch(() => {});
  }

  setDecodeGpuBridgePath(path?: string) {
    const next = (path || '').trim();
    this.decodeGpuBridgePath = next.length ? next : undefined;
  }

  async clearRuntimeCaches(config: {
    clear_precompiled_shaders: boolean;
    clear_texture_pool: boolean;
    clear_metadata_caches: boolean;
    clear_prefetch_cache: boolean;
    clear_native_graph_buffers?: boolean;
    native_graph_buffer_prefixes?: string[];
  }) {
    if (!this.supportsNativeMethod('clear_runtime_caches')) return;
    await clearNativeRendererRuntimeCaches(config).catch(() => {});
  }

  private async clearNativeGraphBuffers(prefixes: string[]) {
    if (!this.running) return;
    if (!this.supportsNativeMethod('clear_runtime_caches')) return;
    if (!this.supportsNativeFeature('native_graph_buffer_prune')) return;
    const uniquePrefixes = Array.from(new Set(
      prefixes
        .map((prefix) => String(prefix || '').trim())
        .filter(Boolean),
    ));
    if (uniquePrefixes.length === 0) return;
    await clearNativeRendererRuntimeCaches({
      clear_precompiled_shaders: false,
      clear_texture_pool: false,
      clear_metadata_caches: false,
      clear_prefetch_cache: false,
      native_graph_buffer_prefixes: uniquePrefixes,
    }).catch((err) => {
      console.warn('[NativeRendererSync] native graph buffer prune failed', err);
    });
  }

  async setMediaDropPolicy(
    commandPressurePct: number,
    decodeQueuePressurePct: number,
    ioQueuePressurePct: number,
    decodePriorityCutoff: number,
    ioPriorityCutoff: number,
  ) {
    const commandPct = Math.max(50, Math.min(99, Math.round(commandPressurePct)));
    const decodePct = Math.max(50, Math.min(99, Math.round(decodeQueuePressurePct)));
    const ioPct = Math.max(50, Math.min(99, Math.round(ioQueuePressurePct)));
    const decodeCutoff = Math.max(0, Math.min(255, Math.round(decodePriorityCutoff)));
    const ioCutoff = Math.max(0, Math.min(255, Math.round(ioPriorityCutoff)));
    this.mediaDropCommandPressurePct = commandPct;
    this.mediaDropDecodePressurePct = decodePct;
    this.mediaDropIoPressurePct = ioPct;
    this.mediaDropDecodePriorityCutoff = decodeCutoff;
    this.mediaDropIoPriorityCutoff = ioCutoff;
    if (!this.running) return;
    if (!this.supportsNativeMethod('set_media_drop_policy')) return;
    await setNativeRendererMediaDropPolicy({
      command_pressure_pct: commandPct,
      decode_queue_pressure_pct: decodePct,
      io_queue_pressure_pct: ioPct,
      decode_priority_cutoff: decodeCutoff,
      io_priority_cutoff: ioCutoff,
    }).catch(() => {});
  }
}

export function getProjectOutputSize() {
  const p = get(project) as any;
  return {
    width: p.width || 1920,
    height: p.height || 1080,
  };
}
