import { get } from 'svelte/store';
import type { Layer } from '$lib/types';
import { project } from '$lib/stores/layers';
import { mediaLibrary, type MediaItem } from '$lib/stores/media';
import { isMac, isWindows } from '$lib/bridge';
import { getVisualAudioSnapshot, visualAudio, type VisualAudioState } from '$lib/audio/visualAudio';
import { ghostAudioCommandFieldsFromVisualAudio } from '$lib/audio/ghostAudioUniform';
import { WGSL_STDLIB, resolveGhostWgsl } from '$lib/renderer/wgsl';
import { gravityWellsDefaultParams } from '$lib/renderer/gpuShaderCatalog';
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
import { parsePLYBuffer } from '$lib/splat/plyLoader';
import { parseSplatBuffer } from '$lib/splat/splatLoader';
import {
  attachNativeRendererOutputWindow,
  clearNativeRendererDecodePreviewCache,
  clearNativeRendererRuntimeCaches,
  detachNativeRendererOutputWindow,
  getNativeRendererCapabilities,
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
  type CommandBatch,
  type RendererCommand,
  type PresentPolicyConfig,
  type BackendKind,
  type DecodeBackendKind,
} from '$lib/api/native-renderer';

type LayerSnapshot = {
  id: string;
  z: number;
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
};

type NativeVec4 = [number, number, number, number];

type NativeLayerUvState = {
  uvTransform: NativeVec4;
  uvFlags: NativeVec4;
  signature: string;
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

type NativeGraphRouteKind = 'planet' | 'smoke-3d' | 'particle-field' | 'volumetric-spheres' | 'smoke-riders' | 'ink-cloud' | 'flythrough' | 'pixel-particles' | 'point-cloud-fx';
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
  source: NativeLayerSource;
  inputSource: NativeLayerSource | null;
};

type NativeGraphRouteState = {
  inFlight: boolean;
  seq: number;
  warnings: number;
  state: NativeGraphRouteSimulationState | null;
};

function nativeGraphInstrumentIds(capabilities: NativeRendererCapabilities | null | undefined): string[] {
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

const SOURCE_PREVIEW_SIZE = 256;
const SOURCE_FRAME_SIZE_FALLBACK = 2048;
const SOURCE_FRAME_SIZE_OVERLOAD = 1536;
const SOURCE_FRAME_DYNAMIC_CAPTURE_MAX = 2048;
const STATIC_PREVIEW_RETRY_MS = 1000;
const VIDEO_PREVIEW_REFRESH_MS = 360;
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

function bytesToBase64(bytes: Uint8ClampedArray): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
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

function effectToNativeDescriptor(effect: any): string | null {
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

  // Keep explicit descriptor IDs compatible with native descriptor parser.
  const effectId = typeof effect.id === 'string' ? effect.id.trim() : '';
  if (effectId.includes(':')) return effectId.toLowerCase();
  return null;
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
    return {
      id: `gpu:${layer.id}:${shaderId}`,
      uri: `gpu://${shaderId}`,
      sourceType: gpuNativeSourceType(shaderId),
      source: null,
      shouldPrefetch: false,
      shouldPreview: false,
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
  if (
    (layer.source?.type === 'shader' && layer.source?.shaderCode) ||
    (layer.type === 'gpu' && !!layer.gpuLayerContent)
  ) {
    return true;
  }

  const src = layer.source;
  if (
    src?.type === 'video' ||
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

export class NativeRendererSync {
  private running = false;
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
  private sourcePreviewSeq = new Map<string, number>();
  private sourcePreviewNextAt = new Map<string, number>();
  private sourcePreviewSig = new Map<string, string>();
  private sourcePreviewFailures = new Map<string, number>();
  private previewImageElements = new Map<string, HTMLImageElement>();
  private previewImageLoads = new Set<string>();
  private previewCanvas: HTMLCanvasElement | null = null;
  private previewContext: CanvasRenderingContext2D | null = null;
  private nativeComputeGraphSourceFrames = false;
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
  private nextStatusPollAt = 0;
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

  private supportsNativeGraphInstrument(id: string): boolean {
    return this.nativeGraphInstruments.has(String(id).trim().toLowerCase());
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
          for (let i = 0; i < vertices.length; i++) {
            const v = vertices[i];
            positions[i * 3 + 0] = v.x;
            positions[i * 3 + 1] = v.y;
            positions[i * 3 + 2] = v.z;
            colors[i * 3 + 0] = clampNumber((v.r ?? 255) / 255, 0, 1);
            colors[i * 3 + 1] = clampNumber((v.g ?? 255) / 255, 0, 1);
            colors[i * 3 + 2] = clampNumber((v.b ?? 255) / 255, 0, 1);
          }
          return buildPointCloudFXNativePointData(positions, colors, {
            maxPoints: NATIVE_POINT_CLOUD_MAX_POINTS,
            signature: [
              cacheKey,
              buffer.byteLength,
              vertices.length,
              Math.min(vertices.length, NATIVE_POINT_CLOUD_MAX_POINTS),
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

  private nativeGraphRouteForLayer(layer: Layer, includeWarningDisabled = false): NativeGraphLayerRoute | null {
    if (!this.nativeComputeGraphSourceFrames || !this.nativeWgslStdlibWarmed || !layer.visible) return null;
    if (layer.type !== 'gpu' || !layer.gpuLayerContent) return null;
    const shaderId = String(layer.gpuLayerContent.shaderId || '').trim();
    const normalizedShaderId = shaderId.toLowerCase();
    let kind: NativeGraphRouteKind | null = null;
    if (
      normalizedShaderId === 'planet' &&
      this.supportsNativeFeature('native_planet_graph') &&
      this.supportsNativeGraphInstrument('planet')
    ) {
      kind = 'planet';
    } else if (
      normalizedShaderId === 'smoke-3d' &&
      this.supportsNativeFeature('native_3d_smoke_graph') &&
      this.supportsNativeGraphInstrument('smoke-3d')
    ) {
      kind = 'smoke-3d';
    } else if (
      normalizedShaderId === 'smoke-riders' &&
      this.supportsNativeFeature('native_smoke_riders_graph') &&
      this.supportsNativeGraphInstrument('smoke-riders')
    ) {
      kind = 'smoke-riders';
    } else if (
      (normalizedShaderId === 'particle-field' || normalizedShaderId === 'gravity-wells') &&
      this.supportsNativeFeature('native_particle_field_graph') &&
      this.supportsNativeGraphInstrument('particle-field')
    ) {
      kind = 'particle-field';
    } else if (
      (normalizedShaderId === 'volumetric-balls' || normalizedShaderId === 'volumetric-spheres') &&
      this.supportsNativeFeature('native_volumetric_spheres_graph') &&
      this.supportsNativeGraphInstrument('volumetric-spheres')
    ) {
      kind = 'volumetric-spheres';
    } else if (
      normalizedShaderId === 'ink-cloud' &&
      this.supportsNativeFeature('native_ink_cloud_graph') &&
      this.supportsNativeGraphInstrument('ink-cloud')
    ) {
      kind = 'ink-cloud';
    } else if (
      normalizedShaderId === 'flythrough' &&
      this.supportsNativeFeature('native_flythrough_graph') &&
      this.supportsNativeGraphInstrument('flythrough')
    ) {
      kind = 'flythrough';
    } else if (
      normalizedShaderId === 'pixel-particles' &&
      this.supportsNativeFeature('native_pixel_particles_graph') &&
      this.supportsNativeGraphInstrument('pixel-particles')
    ) {
      kind = 'pixel-particles';
    } else if (
      normalizedShaderId === 'point-cloud-fx' &&
      this.supportsNativeFeature('native_point_cloud_fx_graph') &&
      this.supportsNativeGraphInstrument('point-cloud-fx')
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
    const source = nativeGraphOutputSource(layer, kind);
    const key = this.nativeGraphRouteKey(kind, source.id);
    if (!includeWarningDisabled && (this.nativeGraphRoutes.get(key)?.warnings ?? 0) >= 3) {
      return null;
    }
    return { kind, key, source, inputSource };
  }

  private nativeSourceFrameUploaded(source: NativeLayerSource | null): boolean {
    const src = source?.source;
    if (!src) return false;
    return this.sourcePreviewSeq.has(this.sourceCacheKey(src.id, src.src));
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
      };
      this.nativeGraphRoutes.set(route.key, routeState);
      if (routeState.inFlight) continue;
      routeState.inFlight = true;
      try {
        const graphSeq = routeState.seq + 1;
        routeState.seq = graphSeq;
        const graphTime = typeof clock.time === 'number'
          ? clock.time
          : Math.max(0, (performance.now() - this.liveClockOriginMs) / 1000);
        const graphDelta = typeof clock.time_delta === 'number' ? clock.time_delta : 1 / this.targetFps;
        const graph = await (async () => {
          const audioBass = visual.isActive ? Math.max(visual.bass, visual.bassFast * 0.9) : 0;
          const audioTreble = visual.isActive ? visual.treble : 0;
          const nativeGraphParams = nativeGraphParamsForLayer(layer, route.kind);
          if (route.kind === 'planet') {
            return buildPlanetNativeComputeGraph({
              sourceId: route.source.id,
              params: nativeGraphParams,
              width,
              height,
              time: graphTime,
              frameDelta: graphDelta,
              frameIndex: graphSeq,
              state: routeState.state as PlanetNativeGraphState | null,
              reset: !routeState.state,
            });
          }
          if (route.kind === 'smoke-3d') {
            return buildSmoke3DNativeComputeGraph({
              sourceId: route.source.id,
              params: nativeGraphParams,
              width,
              height,
              time: graphTime,
              frameDelta: graphDelta,
              frameIndex: graphSeq,
              audioBass,
              audioTreble,
              state: routeState.state as Smoke3DNativeGraphState | null,
              reset: !routeState.state,
            });
          }
          if (route.kind === 'particle-field') {
            return buildParticleFieldNativeComputeGraph({
              sourceId: route.source.id,
              params: nativeGraphParams,
              width,
              height,
              time: graphTime,
              frameDelta: graphDelta,
              frameIndex: graphSeq,
              audioBass,
              audioTreble,
              mediaSourceId: route.inputSource?.id ?? null,
              state: routeState.state as ParticleFieldNativeGraphState | null,
              reset: !routeState.state,
            });
          }
          if (route.kind === 'smoke-riders') {
            return buildSmokeRidersNativeComputeGraph({
              sourceId: route.source.id,
              params: nativeGraphParams,
              width,
              height,
              time: graphTime,
              frameDelta: graphDelta,
              frameIndex: graphSeq,
              audioBass,
              audioTreble,
              state: routeState.state as SmokeRidersNativeGraphState | null,
              reset: !routeState.state,
            });
          }
          if (route.kind === 'ink-cloud') {
            return buildInkCloudNativeComputeGraph({
              sourceId: route.source.id,
              params: nativeGraphParams,
              width,
              height,
              time: graphTime,
              frameDelta: graphDelta,
              frameIndex: graphSeq,
              audioBass,
              audioTreble,
              state: routeState.state as InkCloudNativeGraphState | null,
              reset: !routeState.state,
            });
          }
          if (route.kind === 'flythrough') {
            return buildFlythroughNativeComputeGraph({
              sourceId: route.source.id,
              mediaSourceId: route.inputSource?.id ?? null,
              params: nativeGraphParams,
              width,
              height,
              time: graphTime,
              frameDelta: graphDelta,
              frameIndex: graphSeq,
              audioBass,
              audioTreble,
              state: routeState.state as FlythroughNativeGraphState | null,
              reset: !routeState.state,
            });
          }
          if (route.kind === 'pixel-particles') {
            return buildPixelParticlesNativeComputeGraph({
              sourceId: route.source.id,
              mediaSourceId: route.inputSource?.id ?? null,
              params: nativeGraphParams,
              width,
              height,
              sourceFrameSize: this.nativeSourceFrameSize,
              time: graphTime,
              frameDelta: graphDelta,
              frameIndex: graphSeq,
              state: routeState.state as PixelParticlesNativeGraphState | null,
              reset: !routeState.state,
            });
          }
          if (route.kind === 'point-cloud-fx') {
            const pointData = await this.nativePointCloudDataForRoute(layer, route);
            if (!pointData) {
              throw new Error('native point-cloud data is not available yet');
            }
            return buildPointCloudFXNativeComputeGraph({
              sourceId: route.source.id,
              pointData,
              params: nativeGraphParams,
              width,
              height,
              time: graphTime,
              frameDelta: graphDelta,
              frameIndex: graphSeq,
              audioBass,
              audioTreble,
              state: routeState.state as PointCloudFXNativeGraphState | null,
              reset: !routeState.state,
            });
          }
          return buildVolumetricSpheresNativeComputeGraph({
            sourceId: route.source.id,
            params: nativeGraphParams,
            width,
            height,
            time: graphTime,
            frameDelta: graphDelta,
            frameIndex: graphSeq,
            audioBass,
            audioTreble,
            state: routeState.state as VolumetricSpheresNativeGraphState | null,
            reset: !routeState.state,
          });
        })();
        const result = await runNativeRendererComputeGraph(graph.config as unknown as Record<string, unknown>);
        const renders = Array.isArray((result as any)?.renders)
          ? (result as any).renders
          : [(result as any)?.render].filter(Boolean);
        const renderedSourceFrame = renders.some((render: any) =>
          render?.target === 'source_frame' && render?.source_id === route.source.id,
        );
        if (!renderedSourceFrame) {
          throw new Error(`native ${route.kind} graph returned no source-frame render`);
        }
        routeState.state = graph.state;
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
    for (const [key, routeState] of Array.from(this.nativeGraphRoutes.entries())) {
      if (!activeRouteKeys.has(key) && !routeState.inFlight) {
        this.nativeGraphRoutes.delete(key);
      }
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

  async start(width: number, height: number) {
    if (this.running) return;
    const backend: BackendKind = isMac ? 'metal' : isWindows ? 'd3d12' : 'vulkan';
    const decodeBackend: DecodeBackendKind = isWindows ? 'ffmpeg_d3d11va' : 'synthetic';
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
    this.nativeCoreMethods = new Set((startupCapabilities?.implemented_methods ?? []).map(String));
    this.nativeFeatureFlags = startupCapabilities?.features ?? {};
    this.nativeGraphInstruments = new Set(nativeGraphInstrumentIds(startupCapabilities));
    const computeGraphSourceFrameHost = !!(
      this.supportsNativeFeature('compute_graph_host') &&
      this.supportsNativeFeature('compute_graph_render') &&
      this.supportsNativeFeature('compute_graph_source_frame_target')
    );
    this.nativeComputeGraphSourceFrames = computeGraphSourceFrameHost && !!(
      (
        this.supportsNativeFeature('native_planet_graph') &&
        this.supportsNativeGraphInstrument('planet')
      ) ||
      (
        this.supportsNativeFeature('native_3d_smoke_graph') &&
        this.supportsNativeGraphInstrument('smoke-3d')
      ) ||
      (
        this.supportsNativeFeature('native_particle_field_graph') &&
        this.supportsNativeGraphInstrument('particle-field')
      ) ||
      (
        this.supportsNativeFeature('native_volumetric_spheres_graph') &&
        this.supportsNativeGraphInstrument('volumetric-spheres')
      ) ||
      (
        this.supportsNativeFeature('native_ink_cloud_graph') &&
        this.supportsNativeGraphInstrument('ink-cloud')
      ) ||
      (
        this.supportsNativeFeature('native_flythrough_graph') &&
        this.supportsNativeGraphInstrument('flythrough')
      ) ||
      (
        this.supportsNativeFeature('native_pixel_particles_graph') &&
        this.supportsNativeGraphInstrument('pixel-particles')
      ) ||
      (
        this.supportsNativeFeature('native_point_cloud_fx_graph') &&
        this.supportsNativeGraphInstrument('point-cloud-fx')
      )
    );
    const startupQuality = startupStatus?.native_quality;
    console.log(
      `[NativeRendererSync] GPU pipeline active: backend=${startupStatus?.backend}, adapter=${startupStatus?.adapter_name ?? 'unknown'} quality=${startupQuality?.active_tier ?? 'unknown'}@${(startupQuality?.quality_scale ?? 0).toFixed(2)} policy=${startupQuality?.policy ?? 'unknown'}`
    );
    this.running = true;
    this.liveClockOriginMs = performance.now();
    this.latestRenderClockSeconds = null;
    this.lastRenderClockSentSeconds = null;
    this.lastAudioSig = '';
    this.audioUnsub?.();
    this.audioUnsub = visualAudio.subscribe(() => this.scheduleAudioSync());
    this.desiredWidth = width;
    this.desiredHeight = height;
    this.sentWidth = 0;
    this.sentHeight = 0;
    void this.applyStartupPolicies().catch((err) => {
      console.warn('[NativeRendererSync] native startup policy task failed', err);
    });
    const nativeCaps = startupStatus?.native_caps;
    console.log(
      `[NativeRendererSync] start complete preview=${SOURCE_PREVIEW_SIZE}px sourceFrame=${this.nativeSourceFrameSize}px mips=${startupStatus?.source_frame_mip_levels ?? 1} nativeGraphs=${this.nativeComputeGraphSourceFrames ? 'on' : 'off'} tier=${nativeCaps?.recommended_quality_tier ?? 'unknown'} f16=${nativeCaps?.requested_shader_f16 ? 'on' : 'off'} floatFilter=${nativeCaps?.requested_float32_filterable ? 'on' : 'off'}`,
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
    void this.warmNativeWgslStdlib().catch((err) => {
      console.warn('[NativeRendererSync] native WGSL stdlib warm-up failed', err);
    });
    await Promise.allSettled(tasks);
  }

  async stop() {
    if (!this.running) return;
    this.running = false;
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
    this.previewImageElements.clear();
    this.previewImageLoads.clear();
    this.nativeComputeGraphSourceFrames = false;
    this.nativeGraphRoutes.clear();
    this.nativePointCloudDataCache.clear();
    this.nativeGraphInstruments.clear();
    this.nativeWgslStdlibWarmed = false;
    this.latestRenderClockSeconds = null;
    this.lastRenderClockSentSeconds = null;
    if (this.supportsNativeMethod('clear_decode_preview_cache')) {
      await clearNativeRendererDecodePreviewCache().catch(() => {});
    }
    await this.clearRuntimeCaches({
      clear_precompiled_shaders: false,
      clear_texture_pool: false,
      clear_metadata_caches: false,
      clear_prefetch_cache: true,
    }).catch(() => {});
    if (this.supportsNativeMethod('detach_output_window')) {
      await detachNativeRendererOutputWindow().catch(() => {});
    }
    await stopNativeRenderer().catch(() => {});
    this.nativeCoreMethods.clear();
    this.nativeFeatureFlags = {};
  }

  scheduleSync(width: number, height: number, layers: Layer[]) {
    if (!this.running) return;
    this.desiredWidth = width;
    this.desiredHeight = height;
    this.latestLayers = layers;

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
    if (!this.running) return;

    this.latestLayers = layers;
    const commands: RendererCommand[] = [];
    const graphInputCommands: RendererCommand[] = [];
    const current = new Map<string, LayerSnapshot>();
    const activeVideoKeys = new Set<string>();
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
        this.syncNativeSourceFrameSize(status);
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
      const nativeGraphRoute = this.nativeGraphRouteForLayer(layer);
      const nativeSource = nativeGraphRoute?.source ?? nativeLayerSource(layer);
      const sourceType = nativeSource.sourceType;
      const nativeParams = nativeGpuParams(layer);
      const nativeUv = this.nativeLayerUvState(layer, nativeSource, width, height);
      const nativeShape = nativeLayerShapeState(layer);
      const effectIds = nativeEffectDescriptors(layer);
      const effectsSig = effectIds.length ? effectIds.join('|') : 'none';
      const graphInputSig = nativeSourceIdentity(nativeGraphRoute?.inputSource);
      const snap: LayerSnapshot = {
        id: layer.id,
        z: index,
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

      if (!prev || prev.z !== snap.z || prev.visible !== snap.visible || prev.blend !== snap.blend || prev.opacity !== snap.opacity || prev.geometrySig !== snap.geometrySig || prev.uvSig !== snap.uvSig || prev.shapeSig !== snap.shapeSig) {
        commands.push({
          type: 'upsert_layer',
          layer_id: layer.id,
          z_index: index,
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
          const sharedTextureSource = isSharedTextureUri(src.src);
          if (nativeSource.shouldPrefetch && !sharedTextureSource && !this.prefetchedSources.has(sourceKey)) {
            this.prefetchedSources.add(sourceKey);
            const priority = sourceType === 'video' ? videoPrefetchPriority : mediaPrefetchPriority;
            void prefetchNativeRendererMedia(src.id, src.src, priority).catch(() => {});
          }
          if (sourceType === 'video') {
            this.videoRefreshAt.set(sourceKey, now + videoRefreshMs);
          } else {
            this.videoRefreshAt.delete(sourceKey);
          }
          if (nativeSource.shouldPreview) {
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
      if (src && sourceType === 'video') {
        const sourceKey = this.sourceCacheKey(src.id, src.src);
        activeVideoKeys.add(sourceKey);
        const dueAt = this.videoRefreshAt.get(sourceKey) ?? 0;
        const sharedTextureSource = isSharedTextureUri(src.src);
        if (!sharedTextureSource && now >= dueAt) {
          this.videoRefreshAt.set(sourceKey, now + videoRefreshMs);
          void prefetchNativeRendererMedia(src.id, src.src, videoPrefetchPriority).catch(() => {});
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
          time: now / 1000, // performance.now() → seconds
          time_delta: 1.0 / this.targetFps,
          frame_index: this.frameId,
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

    if (graphInputCommands.length) {
      await submitNativeRendererCommands(graphInputCommands);
    }

    await this.renderNativeGraphSources(layers, width, height, renderClock, visual);

    if (!commands.length) return;

    commands.push({ type: 'present' });

    const batch: CommandBatch = {
      frame_id: ++this.frameId,
      commands,
    };

    await submitNativeRendererBatch(batch);
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
      sourceType.startsWith('gpu:');
    if (!previewable) return;

    const sourceKey = this.sourceCacheKey(src.id, src.src);
    const dueAt = this.sourcePreviewNextAt.get(sourceKey) ?? 0;
    const isVideoLike =
      sourceType === 'video' ||
      sourceType.startsWith('gpu:') ||
      !!previewElement ||
      !!src.videoElement ||
      !!src.threejsCanvas ||
      !!src.synthVisionCanvas;
    const previewRefreshMs = sourceType.startsWith('gpu:')
      ? GPU_PREVIEW_REFRESH_MS
      : VIDEO_PREVIEW_REFRESH_MS;
    if (!force && now < dueAt) return;
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
      rgba_b64: captured.rgbaB64,
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
  ): { rgbaB64: string; signature: string } | null {
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
        rgbaB64: bytesToBase64(imageData.data),
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
      console.log(
        `[NativeRendererSync] status backend=${status.backend} ready=${status.backend_ready} adapter=${status.adapter_name ?? 'unknown'} quality=${status.native_quality.active_tier}@${status.native_quality.quality_scale.toFixed(2)} clock=${status.render_clock_mode}@${status.render_clock_time.toFixed(3)}s#${status.render_clock_frame_index} layers=${status.layers_seen} shaders=${status.shader_cache_entries} compiled=${status.shader_precompile_compiled} failed=${status.shader_precompile_failed} procedural=${status.native_procedural_layers} nativeShaderLayers=${status.native_shader_layers}/${status.isf_shader_bindings} uniforms=${status.isf_uniform_sets} frames=${status.source_frames_active}/${status.source_frame_slots}@${status.source_frame_size}px/${status.source_frame_format}/mips${status.source_frame_mip_levels ?? 1} uploads=${status.source_frame_uploads} graphs=${status.compute_graph_runs}/${status.compute_graph_passes} render=${status.compute_graph_render_passes} sourceGraph=${status.compute_graph_source_frame_renders} graphBuffers=${status.compute_graph_persistent_buffers} preview=${status.source_previews_active}/${status.source_preview_slots}@${status.source_preview_size}px cpu=${status.avg_render_cpu_ms.toFixed(2)}ms gpu=${status.gpu_timing_supported ? status.avg_render_gpu_ms.toFixed(2) : 'off'}ms samples=${status.gpu_timing_samples ?? 0}`,
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
  }) {
    if (!this.supportsNativeMethod('clear_runtime_caches')) return;
    await clearNativeRendererRuntimeCaches(config).catch(() => {});
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
