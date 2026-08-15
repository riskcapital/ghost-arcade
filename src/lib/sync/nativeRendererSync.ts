import { get } from 'svelte/store';
import {
  buildVJCrossfadeGraph,
  buildVJCrossfadePrecompileCommands,
  buildVJCrossfadeUniformUpdate,
} from '$lib/renderer/vjCrossfadeNative';
import {
  buildVJMixGraph,
  buildVJMixPrecompileCommands,
  buildVJMixUniformUpdate,
  type VJMixRow,
} from '$lib/renderer/vjMixNative';
import type { Layer, Model3DContent, SplatContent } from '$lib/types';
import { project } from '$lib/stores/layers';
import { mediaLibrary, type MediaItem } from '$lib/stores/media';
import { keyframeTimeline } from '$lib/stores/keyframeTimeline';
import { settings, outputFrozen, masterWarpIsActive } from '$lib/stores/settings';
import { vjClipLauncher } from '$lib/stores/vjClipLauncher';
import { macros } from '$lib/stores/macros';
import { layerSequencer } from '$lib/stores/layerSequencer';
import {
  resetNativeRendererRuntime,
  updateNativeRendererRuntimeFromStartup,
  updateNativeRendererRuntimeFromStatus,
  nativeFailedRouteLayers,
} from '$lib/stores/nativeRenderer';
import { invoke, isElectron, isMac, isWindows } from '$lib/bridge';
import { getVisualAudioSnapshot, visualAudio, type VisualAudioState } from '$lib/audio/visualAudio';
import { mediaPipeSource } from '$lib/mediapipe/mediaPipeSource';
import { ghostAudioCommandFieldsFromVisualAudio } from '$lib/audio/ghostAudioUniform';
import { WGSL_STDLIB, resolveGhostWgsl } from '$lib/renderer/wgsl';
import { gravityWellsDefaultParams, isNativeReadyGpuShaderId } from '$lib/renderer/gpuShaderCatalog';
import { nativeShaderSourceFromJavascript } from '$lib/renderer/nativeJsShaderSource';
import { resolveAssetRefForRuntime } from '$lib/storage/assetRegistry';
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
  buildLinesNativeComputeGraph,
  buildLinesNativePrecompileCommands,
} from '$lib/renderer/linesNative';
import {
  buildSvgNativeComputeGraph,
  buildSvgNativePrecompileCommands,
} from '$lib/renderer/svgNative';
import {
  buildLightPaintingNativeComputeGraph,
  buildLightPaintingNativePrecompileCommands,
} from '$lib/renderer/lightPaintingNative';
import {
  buildTextNativeAtlas,
  buildTextNativeComputeGraph,
  buildTextNativePrecompileCommands,
  encodeAtlasBase64,
  layoutTextGlyphs,
  textAtlasSignature,
  textNativeAtlasSourceId,
  type TextGlyphMetric,
  type TextNativeAtlas,
} from '$lib/renderer/textNative';
import {
  buildSplatNativeComputeGraph,
  buildSplatNativePrecompileCommands,
  encodeSplatBufferBase64,
  packSplatNativePoints,
  SPLAT_MAX_POINTS as SPLAT_NATIVE_MAX_POINTS,
} from '$lib/renderer/splatNative';
import { splatPointer } from '$lib/stores/splatPointer';
import {
  buildModel3DNativeComputeGraph,
  buildModel3DNativePrecompileCommands,
  loadModel3DNativeMesh,
  MODEL3D_VERTEX_VEC4S,
  type Model3DNativeMesh,
} from '$lib/renderer/model3dNative';
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
  POINT_CLOUD_FX_NATIVE_DEPTH_SORT_MAX_POINTS,
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
  buildSmokeRidersNativePrecompileCommands,
  type SmokeRidersNativeGraphState,
} from '$lib/renderer/shaders/webgpuSmokeRidersShader';
import {
  buildFluidRidersNativePrecompileCommands,
} from '$lib/renderer/shaders/webgpuFluidRidersShader';
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
import {
  buildNativePluginGraph,
  buildNativeHandInputUpdate,
  buildNativePluginPrecompileCommands,
  type NativePluginGraphState,
} from '$lib/renderer/nativePluginGraphs';
import {
  nativePluginEffectType,
  nativePluginUnavailableReason,
} from '$lib/renderer/nativePluginInventory';
import { parsePLYPointBuffers, pointCloudBuffersFromPLYData } from '$lib/splat/plyLoader';
import { parseSplatBuffer } from '$lib/splat/splatLoader';
import {
  clearNativeRendererDecodePreviewCache,
  clearNativeRendererRuntimeCaches,
  detachNativeRendererOutputWindow,
  getNativeEditorPreviewStatus,
  getNativeRendererCapabilities,
  getNativeRendererReadinessReport,
  getNativeRendererFrameSnapshot,
  getNativeRendererLayersSnapshot,
  getNativeRendererStatus,
  prefetchNativeRendererMedia,
  resetNativeRendererStats,
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
  deckMonitorSig: string;
  uvSig: string;
  shapeSig: string;
  maskSig: string;
  sourceSig: string;
  nativeParamsSig: string;
  effectsSig: string;
  edgeEffectsSig: string;
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

type NativeLiveSourceType = 'webcam' | 'capture' | 'syphon' | 'ndi';

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

type NativeVideoDecodeState = {
  sourceId: string;
  signature: string;
  seq: number;
  previousSignature: string | undefined;
  previousSeq: number | undefined;
  submittedAt: number;
};

type NativeVideoPlaybackSyncState = {
  signature: string;
  timeSeconds: number;
  clockTimeSeconds: number;
  playbackRate: number;
  paused: boolean;
  seekGeneration: number;
};

type NativeLayerShapeState = {
  shape: NativeVec4;
  shape2: NativeVec4;
  shapeMeta: NativeVec4;
  shapePoints: NativeVec4[];
  signature: string;
};

type NativeLayerMaskState = {
  info: NativeVec4;
  points: NativeVec4[];
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

type NativeGraphRouteKind = 'planet' | 'fluid-riders' | 'smoke-3d' | 'particle-field' | 'volumetric-spheres' | 'smoke-riders' | 'ink-cloud' | 'flythrough' | 'pixel-particles' | 'point-cloud-fx' | 'ghostfx' | 'handfx' | 'performer-world' | 'vj-crossfade' | 'vj-mix' | 'effect-pass' | 'lines' | 'svg' | 'light-painting' | 'text' | 'splat' | 'model3d';

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

const NATIVE_CORE_OWNED_GRAPH_KINDS = new Set<NativeGraphRouteKind>([
  'planet',
  'particle-field',
  'pixel-particles',
  'flythrough',
  'point-cloud-fx',
  'smoke-riders',
  'fluid-riders',
  'ink-cloud',
  'smoke-3d',
  'volumetric-spheres',
  'ghostfx',
  'handfx',
  'performer-world',
  'vj-crossfade',
  'vj-mix',
]);

const NATIVE_EXTERNALLY_QUEUED_GRAPH_KINDS = new Set<NativeGraphRouteKind>([
  'lines',
  'svg',
  'light-painting',
  'text',
  'splat',
  'model3d',
]);

export function isNativeCoreOwnedGraphKind(kind: string): boolean {
  return NATIVE_CORE_OWNED_GRAPH_KINDS.has(kind as NativeGraphRouteKind);
}

export function isNativeExternallyQueuedGraphKind(kind: string): boolean {
  return NATIVE_EXTERNALLY_QUEUED_GRAPH_KINDS.has(kind as NativeGraphRouteKind);
}

const NATIVE_GRAPH_ROUTE_REQUIREMENTS: ReadonlyArray<NativeGraphRouteRequirement> = [
  { kind: 'planet', feature: 'native_planet_graph', instrument: 'planet', shaderIds: ['planet/render'] },
  { kind: 'lines', feature: 'native_lines_graph', instrument: 'lines', shaderIds: ['lines/render'] },
  { kind: 'svg', feature: 'native_svg_graph', instrument: 'svg', shaderIds: ['svg/render-v5'] },
  { kind: 'light-painting', feature: 'native_light_painting_graph', instrument: 'light-painting', shaderIds: ['light-painting/render-v8'] },
  { kind: 'text', feature: 'native_text_graph', instrument: 'text', shaderIds: ['text/render-v1'] },
  { kind: 'splat', feature: 'native_splat_graph', instrument: 'splat', shaderIds: ['splat/render-v1'] },
  { kind: 'model3d', feature: 'native_model3d_graph', instrument: 'model3d', shaderIds: ['model3d/render-v1'] },
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
    kind: 'fluid-riders',
    feature: 'native_smoke_riders_graph',
    instrument: 'fluid-riders',
    shaderIds: [
      '3d-smoke/splat',
      '3d-smoke/advect-velocity',
      '3d-smoke/divergence',
      '3d-smoke/jacobi',
      '3d-smoke/subtract-gradient',
      '3d-smoke/advect-density',
      'fluid-riders/vorticity',
      'fluid-riders/pressure',
      'fluid-riders/advect',
      'fluid-riders/surface',
      'fluid-riders/riders',
      'fluid-riders/tiles',
      'fluid-riders/render',
    ],
  },
  {
    kind: 'smoke-riders',
    feature: 'native_smoke_riders_graph',
    instrument: 'smoke-riders',
    // Reuses the 3D fluid chain (minus its raymarch — Smoke Riders owns
    // the single unified render pass) and adds the coupled rider passes.
    shaderIds: [
      '3d-smoke/splat',
      '3d-smoke/advect-velocity',
      '3d-smoke/divergence',
      '3d-smoke/jacobi',
      '3d-smoke/subtract-gradient',
      '3d-smoke/advect-density',
      'smoke-riders/vorticity',
      'smoke-riders/pressure',
      'smoke-riders/advect',
      'smoke-riders/surface',
      'smoke-riders/riders',
      'smoke-riders/tiles',
      'smoke-riders/render',
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
  {
    kind: 'ghostfx',
    feature: 'native_ghostfx_graph',
    instrument: 'ghostfx',
    shaderIds: [
      'ghostfx/drift-compute',
      'ghostfx/drift-render',
      'ghostfx/ribbons-compute',
      'ghostfx/ribbons-render',
      'ghostfx/spheres-compute',
      'ghostfx/spheres-render',
      'ghostfx/liquid-splat',
      'ghostfx/liquid-advect-vel',
      'ghostfx/liquid-divergence',
      'ghostfx/liquid-jacobi',
      'ghostfx/liquid-subtract',
      'ghostfx/liquid-advect-dye',
      'ghostfx/liquid-render',
      'ghostfx/liquid-bubbles-sim',
      'ghostfx/liquid-bubbles-render',
      'ghostfx/post',
    ],
  },
  {
    kind: 'handfx',
    feature: 'native_handfx_graph',
    instrument: 'handfx',
    shaderIds: ['handfx/compute', 'handfx/render'],
  },
  {
    kind: 'performer-world',
    feature: 'native_performer_world_graph',
    instrument: 'performer-world',
    shaderIds: ['performer-world/render'],
  },
  {
    kind: 'vj-crossfade',
    feature: 'native_vj_crossfade_graph',
    instrument: 'vj-crossfade',
    shaderIds: ['vj-crossfade/render'],
  },
  {
    kind: 'vj-mix',
    feature: 'native_vj_mix_graph',
    instrument: 'vj-mix',
    shaderIds: ['vj-mix/render'],
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
  | PointCloudFXNativeGraphState
  | NativePluginGraphState;

type NativeGraphLayerRoute = {
  kind: NativeGraphRouteKind;
  key: string;
  baseSource?: NativeLayerSource;
  source: NativeLayerSource;
  inputSource: NativeLayerSource | null;
  effectPasses?: NativeEffectPassRuntime[];
  /** Binding id the graph should sample for the input, when it differs from
   *  inputSource.id — core-rendered shader layers bind `layer-frame:<id>`. */
  inputBindingId?: string;
  /** Input pixels are produced BY the core (FS/ISF shader render), not by an
   *  upload/decode pipeline — readiness checks on uploads don't apply. */
  inputCoreRendered?: boolean;
};

export function nativeGraphCompositeSourceId(
  route: Pick<NativeGraphLayerRoute, 'source'>,
): string {
  return route.source.id;
}

export function nativeGraphInstrumentSourceId(
  route: Pick<NativeGraphLayerRoute, 'source' | 'baseSource'>,
): string {
  return (route.baseSource ?? route.source).id;
}

type NativeGraphRouteState = {
  inFlight: boolean;
  seq: number;
  warnings: number;
  state: NativeGraphRouteSimulationState | null;
  bufferPrefixes: string[];
  lastGraphFrameIndex?: number;
  lastManualClockKey?: string;
  lastHandFrameTimestamp?: number;
  lastVJCrossfadeTopologySig?: string;
  lastVJCrossfadeUniformSig?: string;
  lastVJMixTopologySig?: string;
  lastVJMixUniformSig?: string;
  lastQueuedClockFrame?: number;
  queuedThisClockFrame?: number;
  lastQueuedAtMs?: number;
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
const LIVE_SHARED_TEXTURE_REFRESH_MS = 16;
// Live WebGL performance canvases (SynthVision, THREE.js) — 30fps capture:
// full rate costs a GPU readback + IPC upload per frame, and 30 stays smooth
// for projection while leaving headroom for the sim itself.
const LIVE_CANVAS_REFRESH_MS = 33;
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
  const javascriptSignature = s.jsAnimation
    ? hashString(`${s.jsAnimation.htmlCode}:${JSON.stringify(s.jsAnimation.params ?? [])}:${JSON.stringify(s.jsAnimation.paramValues ?? {})}`)
    : 'no-js';
  const shaderValuesSignature = s.shaderValues
    ? hashString(stableNativeGraphKey(s.shaderValues))
    : 'no-shader-values';
  const imageInputsSignature = s.shaderImageInputs && Object.keys(s.shaderImageInputs).length
    ? hashString(JSON.stringify(s.shaderImageInputs))
    : 'no-image-inputs';
  return `${s.type}:${s.id}:${s.src}:${s.name}:${s.shaderCode ? hashString(s.shaderCode) : 'no-shader'}:${shaderValuesSignature}:${javascriptSignature}:${imageInputsSignature}`;
}

function nativeEffectDescriptors(layer: Layer): string[] {
  const effects = layer.effects || [];
  if (!effects.length) return [];
  return effects
    .filter((e: any) => e && e.enabled !== false)
    .map((e: any) => effectToNativeDescriptor(e))
    .filter((d: string | null): d is string => !!d);
}

import { nativeEffectPassIdForEffectType } from '$lib/renderer/nativeEffectCoverage';
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

function blobFlagsFromParams(
  params: Record<string, any>,
  defaults: { showCoords: number; showBBox: number; showCenter: number },
): number {
  const explicit = finiteParam(params.blobFlags);
  if (explicit !== null) return Math.max(0, Math.min(7, Math.round(explicit)));
  const showCoords = firstFiniteParam(params, ['blobShowCoords', 'showCoords'], defaults.showCoords) >= 0.5 ? 1 : 0;
  const showBBox = firstFiniteParam(params, ['blobShowBBox', 'showBBox'], defaults.showBBox) >= 0.5 ? 1 : 0;
  const showCenter = firstFiniteParam(params, ['blobShowCenter', 'showCenter'], defaults.showCenter) >= 0.5 ? 1 : 0;
  return showCoords + showBBox * 2 + showCenter * 4;
}

function blobEffectDescriptor(
  id: 'blob-track' | 'blob-contour' | 'blob-heatmap',
  params: Record<string, any>,
  defaults: {
    mix: number;
    threshold: number;
    shape: number;
    color: number;
    thickness: number;
    gridSize: number;
    trailLength: number;
    minSize: number;
    showCoords: number;
    showBBox: number;
    showCenter: number;
  },
): string {
  const mix = clampNumber(firstFiniteParam(params, ['blobMix', 'mix', 'amount'], defaults.mix), 0, 1);
  const threshold = clampNumber(firstFiniteParam(params, ['blobThreshold', 'threshold'], defaults.threshold), 0, 1);
  const shape = clampNumber(Math.round(firstFiniteParam(params, ['blobShape', 'shape'], defaults.shape)), 0, id === 'blob-track' ? 4 : 2);
  const color = clampNumber(Math.round(firstFiniteParam(params, ['blobColor', 'palette'], defaults.color)), 0, id === 'blob-heatmap' ? 3 : 7);
  const thickness = clampNumber(firstFiniteParam(params, ['blobThickness', 'thickness'], defaults.thickness), 0.25, 8);
  const gridSize = clampNumber(firstFiniteParam(params, ['blobGridSize', 'gridSize'], defaults.gridSize), 4, 128);
  const flags = blobFlagsFromParams(params, defaults);
  const trailLength = clampNumber(firstFiniteParam(params, ['blobTrailLength', 'trailLength'], defaults.trailLength), 0, 1);
  const minSize = clampNumber(firstFiniteParam(params, ['blobMinSize', 'minSize'], defaults.minSize), 0, 1);
  const colorMode = clampNumber(Math.round(firstFiniteParam(params, ['blobColorMode'], 0)), 0, 2);
  const fixedR = clampNumber(firstFiniteParam(params, ['blobFixedColorR'], 0), 0, 1);
  const fixedG = clampNumber(firstFiniteParam(params, ['blobFixedColorG'], 1), 0, 1);
  const fixedB = clampNumber(firstFiniteParam(params, ['blobFixedColorB'], 0.5), 0, 1);
  const markerSize = clampNumber(firstFiniteParam(params, ['blobMarkerSize'], 1), 0.2, 3);
  const blendMode = clampNumber(Math.round(firstFiniteParam(params, ['blobBlendMode'], 0)), 0, 4);
  return [
    id,
    mix.toFixed(4),
    threshold.toFixed(4),
    shape.toFixed(0),
    color.toFixed(0),
    thickness.toFixed(4),
    gridSize.toFixed(4),
    flags.toFixed(0),
    trailLength.toFixed(4),
    minSize.toFixed(4),
    colorMode.toFixed(0),
    fixedR.toFixed(4),
    fixedG.toFixed(4),
    fixedB.toFixed(4),
    markerSize.toFixed(4),
    blendMode.toFixed(0),
  ].join(':');
}

export function effectToNativeDescriptor(effect: any): string | null {
  if (!effect || effect.enabled === false) return null;
  const type = String(effect.type || '').toLowerCase();
  const params = effect.params || {};
  if (!type) return null;

  if (type === 'invert') {
    const invAmount = clampNumber(firstFiniteParam(params, ['invertAmount', 'amount'], 1), 0, 1);
    const invMode = clampNumber(Math.round(firstFiniteParam(params, ['invertMode', 'mode'], 0)), 0, 4);
    const invThreshold = clampNumber(firstFiniteParam(params, ['invertThreshold', 'threshold'], 0.5), 0, 1);
    const strobeRate = clampNumber(firstFiniteParam(params, ['invertStrobeRate'], 4), 0, 10);
    return `invert:${invAmount.toFixed(4)}:${invMode.toFixed(0)}:${invThreshold.toFixed(4)}:${strobeRate.toFixed(4)}`;
  }
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
    const shadows = clampNumber(firstFiniteParam(params, ['gammaShadows'], 1), 0.2, 3);
    const mids = clampNumber(firstFiniteParam(params, ['gammaMids'], 1), 0.2, 3);
    const highlights = clampNumber(firstFiniteParam(params, ['gammaHighlights'], 1), 0.2, 3);
    const gmix = clampNumber(firstFiniteParam(params, ['gammaMix'], 1), 0, 1);
    return `gamma:${p.toFixed(4)}:${shadows.toFixed(4)}:${mids.toFixed(4)}:${highlights.toFixed(4)}:${gmix.toFixed(4)}`;
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
      firstFiniteParam(params, ['exposureStops', 'exposure', 'exposureAmount', 'amount'], 0),
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
      firstFiniteParam(params, ['tempTemperature', 'temperature', 'temperatureAmount', 'amount'], 0),
      -1,
      1,
    );
    const tint = clampNumber(
      firstFiniteParam(params, ['tempTint', 'tint', 'tintAmount'], 0),
      -1,
      1,
    );
    const shadowTemp = clampNumber(
      firstFiniteParam(params, ['tempShadow', 'shadowTemp', 'temperatureShadow', 'shadowTemperature'], 0),
      -1,
      1,
    );
    const highlightTemp = clampNumber(
      firstFiniteParam(params, ['tempHighlight', 'highlightTemp', 'temperatureHighlight', 'highlightTemperature'], 0),
      -1,
      1,
    );
    const splitTone = clampNumber(
      firstFiniteParam(params, ['tempSplitTone', 'splitTone', 'temperatureSplitTone'], 0),
      0,
      1,
    );
    const autoCycle = clampNumber(
      firstFiniteParam(params, ['tempAutoCycle', 'autoCycle', 'temperatureAutoCycle'], 0),
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
    const dither = clampNumber(firstFiniteParam(params, ['posterizeDither'], 0), 0, 1);
    const animSpeed = clampNumber(firstFiniteParam(params, ['posterizeAnimSpeed'], 0), 0, 2);
    const palette = clampNumber(Math.round(firstFiniteParam(params, ['posterizePalette'], 0)), 0, 3);
    return `posterize:${levels.toFixed(0)}:${dither.toFixed(4)}:${animSpeed.toFixed(4)}:${palette.toFixed(0)}`;
  }
  if (type === 'noise') {
    const amountRaw =
      (typeof params.noiseAmount === 'number' && Number.isFinite(params.noiseAmount) ? params.noiseAmount : null)
      ?? (typeof params.amount === 'number' && Number.isFinite(params.amount) ? params.amount : null)
      ?? 0.25;
    const amount = Math.max(0, Math.min(1, amountRaw));
    const noiseType = clampNumber(Math.round(firstFiniteParam(params, ['noiseType'], 0)), 0, 4);
    const noiseMode = clampNumber(Math.round(firstFiniteParam(params, ['noiseMode'], 0)), 0, 4);
    const noiseScale = clampNumber(firstFiniteParam(params, ['noiseScale', 'scale'], 1), 0.5, 32);
    const noiseMono = clampNumber(firstFiniteParam(params, ['noiseMono'], 0), 0, 1);
    const noiseShadow = clampNumber(firstFiniteParam(params, ['noiseShadow'], 1), 0, 1);
    const noiseMid = clampNumber(firstFiniteParam(params, ['noiseMid'], 1), 0, 1);
    const noiseHigh = clampNumber(firstFiniteParam(params, ['noiseHigh'], 1), 0, 1);
    const noiseAnim = clampNumber(firstFiniteParam(params, ['noiseAnimSpeed'], 1), 0, 2);
    return [
      'noise',
      amount.toFixed(4),
      noiseType.toFixed(0),
      noiseMode.toFixed(0),
      noiseScale.toFixed(4),
      noiseMono.toFixed(4),
      noiseShadow.toFixed(4),
      noiseMid.toFixed(4),
      noiseHigh.toFixed(4),
      noiseAnim.toFixed(4),
    ].join(':');
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
  if (type === 'fmscanlines' || type === 'fm-scanlines') {
    const modeRaw = firstFiniteParam(params, ['fmLinesMode', 'mode'], 0);
    const countRaw = firstFiniteParam(params, ['fmLinesCount', 'count'], 140);
    const widthRaw = firstFiniteParam(params, ['fmLinesWidth', 'width'], 0.32);
    const freqRaw = firstFiniteParam(params, ['fmLinesFreq', 'frequency', 'freq'], 0.25);
    const depthRaw = firstFiniteParam(params, ['fmLinesFmDepth', 'fmDepth', 'depth'], 0.55);
    const ampRaw = firstFiniteParam(params, ['fmLinesAmp', 'amp', 'amplitude'], 0.5);
    const speedRaw = firstFiniteParam(params, ['fmLinesSpeed', 'speed'], 0.6);
    const colorMixRaw = firstFiniteParam(params, ['fmLinesColorMix', 'colorMix'], 0);
    const invertRaw = firstFiniteParam(params, ['fmLinesInvert', 'invert'], 0);
    return [
      'fm-scanlines',
      '1.0000',
      Math.max(0, Math.min(2, Math.round(modeRaw))).toFixed(0),
      Math.max(4, Math.min(800, countRaw)).toFixed(4),
      Math.max(0, Math.min(1, widthRaw)).toFixed(4),
      Math.max(0, Math.min(1, freqRaw)).toFixed(4),
      Math.max(0, Math.min(1, depthRaw)).toFixed(4),
      Math.max(0, Math.min(1, ampRaw)).toFixed(4),
      Math.max(0, Math.min(2, speedRaw)).toFixed(4),
      Math.max(0, Math.min(1, colorMixRaw)).toFixed(4),
      Math.max(0, Math.min(1, invertRaw)).toFixed(0),
    ].join(':');
  }
  if (type === 'vhs') {
    const trackingRaw = firstFiniteParam(params, ['vhsTracking', 'tracking'], 0.5);
    const noiseRaw = firstFiniteParam(params, ['vhsNoise', 'noise'], 0.3);
    const distortionRaw = firstFiniteParam(params, ['vhsDistortion', 'distortion'], 0.3);
    const colorBleedRaw = firstFiniteParam(params, ['vhsColorBleed', 'colorBleed'], 0.5);
    const scanlinesRaw = firstFiniteParam(params, ['vhsScanlines', 'scanlines'], 0.3);
    const headSwitchRaw = firstFiniteParam(params, ['vhsHeadSwitch', 'headSwitch'], 0);
    const tapeWobbleRaw = firstFiniteParam(params, ['vhsTapeWobble', 'tapeWobble'], 0);
    const dropoutRaw = firstFiniteParam(params, ['vhsDropout', 'dropout'], 0);
    const chromaDelayRaw = firstFiniteParam(params, ['vhsChromaDelay', 'chromaDelay'], 0);
    const trackingJumpRaw = firstFiniteParam(params, ['vhsTrackingJump', 'trackingJump'], 0);
    const saturationRaw = firstFiniteParam(params, ['vhsSaturation', 'saturation'], 1);
    return [
      'vhs',
      '1.0000',
      Math.max(0, Math.min(1, trackingRaw)).toFixed(4),
      Math.max(0, Math.min(1, noiseRaw)).toFixed(4),
      Math.max(0, Math.min(1, distortionRaw)).toFixed(4),
      Math.max(0, Math.min(1, colorBleedRaw)).toFixed(4),
      Math.max(0, Math.min(1, scanlinesRaw)).toFixed(4),
      Math.max(0, Math.min(1, headSwitchRaw)).toFixed(4),
      Math.max(0, Math.min(1, tapeWobbleRaw)).toFixed(4),
      Math.max(0, Math.min(1, dropoutRaw)).toFixed(4),
      Math.max(0, Math.min(1, chromaDelayRaw)).toFixed(4),
      Math.max(0, Math.min(1, trackingJumpRaw)).toFixed(4),
      Math.max(0, Math.min(1.5, saturationRaw)).toFixed(4),
    ].join(':');
  }
  if (type === 'plasma') {
    const amountRaw = firstFiniteParam(params, ['plasmaMix', 'outputMix', 'amount'], 0.85);
    const scaleRaw = firstFiniteParam(params, ['plasmaScale', 'scale'], 5.5);
    const speedRaw = firstFiniteParam(params, ['plasmaSpeed', 'speed'], 0.7);
    const paletteRaw = firstFiniteParam(params, ['plasmaPalette', 'palette'], 0);
    const sourceMixRaw = firstFiniteParam(params, ['plasmaSourceMix', 'sourceMix'], 0.35);
    const complexityRaw = firstFiniteParam(params, ['plasmaComplexity'], 3);
    const plasmaModeRaw = firstFiniteParam(params, ['plasmaMode'], 0);
    const blendModeRaw = firstFiniteParam(params, ['plasmaBlendMode'], 0);
    const warpRaw = firstFiniteParam(params, ['plasmaWarpAmount'], 0.4);
    const audioReactRaw = firstFiniteParam(params, ['plasmaAudioReact'], 0);
    return [
      'plasma',
      Math.max(0, Math.min(1, amountRaw)).toFixed(4),
      Math.max(0.1, Math.min(24, scaleRaw)).toFixed(4),
      Math.max(0, Math.min(3, speedRaw)).toFixed(4),
      Math.max(0, Math.min(11, Math.round(paletteRaw))).toFixed(0),
      Math.max(0, Math.min(1, sourceMixRaw)).toFixed(4),
      Math.max(1, Math.min(5, Math.round(complexityRaw))).toFixed(0),
      Math.max(0, Math.min(2, Math.round(plasmaModeRaw))).toFixed(0),
      Math.max(0, Math.min(4, Math.round(blendModeRaw))).toFixed(0),
      Math.max(0, Math.min(1, warpRaw)).toFixed(4),
      Math.max(0, Math.min(1, audioReactRaw)).toFixed(4),
    ].join(':');
  }
  if (type === 'halftone') {
    const amountRaw = firstFiniteParam(params, ['halftoneMix', 'outputMix', 'amount'], 0.9);
    const scaleRaw = firstFiniteParam(params, ['halftoneDotSize', 'halftoneScale', 'scale', 'cellSize'], 6);
    const angleRaw = firstFiniteParam(params, ['halftoneAngle', 'angle'], 45);
    const dotGainRaw = firstFiniteParam(params, ['halftoneDotGain', 'dotGain'], 1);
    const colorModeRaw = firstFiniteParam(params, ['halftoneColorMode', 'colorMode'], 0);
    const modeRaw = firstFiniteParam(params, ['halftoneMode'], 0);
    const dotShapeRaw = firstFiniteParam(params, ['halftoneDotShape'], 0);
    const angleCRaw = firstFiniteParam(params, ['halftoneAngleC'], 15);
    const angleMRaw = firstFiniteParam(params, ['halftoneAngleM'], 75);
    const angleYRaw = firstFiniteParam(params, ['halftoneAngleY'], 0);
    const angleKRaw = firstFiniteParam(params, ['halftoneAngleK'], 45);
    const driftRaw = firstFiniteParam(params, ['halftoneDrift'], 0);
    return [
      'halftone',
      Math.max(0, Math.min(1, amountRaw)).toFixed(4),
      Math.max(2, Math.min(96, scaleRaw)).toFixed(4),
      (((angleRaw % 360) + 360) % 360).toFixed(4),
      Math.max(0.25, Math.min(2, dotGainRaw)).toFixed(4),
      Math.max(0, Math.min(1, colorModeRaw)).toFixed(4),
      Math.max(0, Math.min(2, Math.round(modeRaw))).toFixed(0),
      Math.max(0, Math.min(3, Math.round(dotShapeRaw))).toFixed(0),
      Math.max(0, Math.min(180, angleCRaw)).toFixed(4),
      Math.max(0, Math.min(180, angleMRaw)).toFixed(4),
      Math.max(0, Math.min(180, angleYRaw)).toFixed(4),
      Math.max(0, Math.min(180, angleKRaw)).toFixed(4),
      Math.max(0, Math.min(2, driftRaw)).toFixed(4),
    ].join(':');
  }
  if (type === 'toon') {
    const amountRaw = firstFiniteParam(params, ['toonMix', 'outputMix', 'amount'], 0.85);
    const levelsRaw = firstFiniteParam(params, ['toonSteps', 'toonLevels', 'levels'], 4);
    const edgeRaw = firstFiniteParam(params, ['toonOutline', 'toonEdgeStrength', 'edgeStrength'], 0.8);
    const saturationRaw = firstFiniteParam(params, ['toonColorPop', 'toonSaturation', 'saturation'], 1.15);
    const thresholdRaw = firstFiniteParam(params, ['toonEdgeThreshold', 'threshold'], 0.05);
    const rampSoftRaw = firstFiniteParam(params, ['toonRampSoftness'], 0);
    const shadowBandRaw = firstFiniteParam(params, ['toonShadowBand'], 0);
    return [
      'toon',
      Math.max(0, Math.min(1, amountRaw)).toFixed(4),
      Math.max(2, Math.min(12, Math.round(levelsRaw))).toFixed(0),
      Math.max(0, Math.min(2, edgeRaw)).toFixed(4),
      Math.max(0, Math.min(2, saturationRaw)).toFixed(4),
      Math.max(0, Math.min(1, thresholdRaw)).toFixed(4),
      Math.max(0, Math.min(1, rampSoftRaw)).toFixed(4),
      Math.max(0, Math.min(1, shadowBandRaw)).toFixed(4),
    ].join(':');
  }
  if (type === 'kuwahara') {
    const amountRaw = firstFiniteParam(params, ['kuwaharaMix', 'outputMix', 'amount'], 1);
    const radiusRaw = firstFiniteParam(params, ['kuwaharaRadius', 'radius'], 3);
    const edgeRaw = firstFiniteParam(params, ['kuwaharaEdgeSharpness', 'edgeStrength'], 0.3);
    const punchRaw = firstFiniteParam(params, ['kuwaharaColorPunch', 'colorPunch', 'colorMix'], 0.2);
    return [
      'kuwahara',
      Math.max(0, Math.min(1, amountRaw)).toFixed(4),
      Math.max(1, Math.min(8, radiusRaw)).toFixed(4),
      Math.max(0, Math.min(1, edgeRaw)).toFixed(4),
      Math.max(0, Math.min(1, punchRaw)).toFixed(4),
    ].join(':');
  }
  if (type === 'defocusbokeh') {
    const radiusRaw = firstFiniteParam(params, ['bokehRadius', 'radius', 'amount'], 12);
    const samplesRaw = firstFiniteParam(params, ['bokehSamples', 'samples'], 24);
    const brightRaw = firstFiniteParam(params, ['bokehBrightWeight', 'brightWeight'], 0.8);
    const thresholdRaw = firstFiniteParam(params, ['bokehThreshold', 'threshold'], 0.7);
    const chromaRaw = firstFiniteParam(params, ['bokehChromaFringe', 'chromaFringe'], 0);
    const shapeRaw = firstFiniteParam(params, ['bokehShape', 'shape'], 0);
    const rotationRaw = firstFiniteParam(params, ['bokehRotation', 'rotation'], 0);
    const mixRaw = firstFiniteParam(params, ['bokehMix', 'outputMix', 'mix'], 1);
    return [
      'defocus-bokeh',
      Math.max(0, Math.min(30, radiusRaw)).toFixed(4),
      Math.max(8, Math.min(48, samplesRaw)).toFixed(4),
      Math.max(0, Math.min(2, brightRaw)).toFixed(4),
      Math.max(0, Math.min(1, thresholdRaw)).toFixed(4),
      Math.max(0, Math.min(1, chromaRaw)).toFixed(4),
      Math.max(0, Math.min(2, Math.round(shapeRaw))).toFixed(0),
      (((rotationRaw % 360) + 360) % 360).toFixed(4),
      Math.max(0, Math.min(1, mixRaw)).toFixed(4),
    ].join(':');
  }
  if (type === 'godrays') {
    const intensityRaw = firstFiniteParam(params, ['godRaysIntensity', 'intensity', 'amount'], 0.7);
    const decayRaw = firstFiniteParam(params, ['godRaysDecay', 'decay'], 0.95);
    const exposureRaw = firstFiniteParam(params, ['godRaysExposure', 'exposure'], 0.4);
    const densityRaw = firstFiniteParam(params, ['godRaysDensity', 'density'], 0.95);
    const thresholdRaw = firstFiniteParam(params, ['godRaysThreshold', 'threshold'], 0.7);
    const centerXRaw = firstFiniteParam(params, ['godRaysCenterX', 'centerX'], 0.5);
    const centerYRaw = firstFiniteParam(params, ['godRaysCenterY', 'centerY'], 0.2);
    const samplesRaw = firstFiniteParam(params, ['godRaysSamples', 'samples'], 64);
    const tintRRaw = firstFiniteParam(params, ['godRaysTintR', 'tintR'], 1);
    const tintGRaw = firstFiniteParam(params, ['godRaysTintG', 'tintG'], 0.95);
    const tintBRaw = firstFiniteParam(params, ['godRaysTintB', 'tintB'], 0.85);
    const mixRaw = firstFiniteParam(params, ['godRaysMix', 'outputMix', 'mix'], 1);
    return [
      'god-rays',
      Math.max(0, Math.min(2, intensityRaw)).toFixed(4),
      Math.max(0.85, Math.min(1, decayRaw)).toFixed(4),
      Math.max(0.1, Math.min(1, exposureRaw)).toFixed(4),
      Math.max(0, Math.min(1, densityRaw)).toFixed(4),
      Math.max(0, Math.min(1, thresholdRaw)).toFixed(4),
      Math.max(0, Math.min(1, centerXRaw)).toFixed(4),
      Math.max(0, Math.min(1, centerYRaw)).toFixed(4),
      Math.max(8, Math.min(128, samplesRaw)).toFixed(4),
      Math.max(0, Math.min(1.5, tintRRaw)).toFixed(4),
      Math.max(0, Math.min(1.5, tintGRaw)).toFixed(4),
      Math.max(0, Math.min(1.5, tintBRaw)).toFixed(4),
      Math.max(0, Math.min(1, mixRaw)).toFixed(4),
    ].join(':');
  }
  if (type === 'displacement') {
    const amountRaw = firstFiniteParam(params, ['dispAmount', 'amount'], 0.4);
    const scaleRaw = firstFiniteParam(params, ['dispScale', 'scale'], 6);
    const speedRaw = firstFiniteParam(params, ['dispSpeed', 'speed'], 1);
    const modeRaw = firstFiniteParam(params, ['dispMode', 'mode'], 0);
    const turbulenceRaw = firstFiniteParam(params, ['dispTurbulence', 'turbulence'], 0.5);
    const chromaticRaw = firstFiniteParam(params, ['dispChromatic', 'chromatic'], 0);
    return [
      'displacement',
      Math.max(0, Math.min(1, amountRaw)).toFixed(4),
      Math.max(1, Math.min(32, scaleRaw)).toFixed(4),
      Math.max(0, Math.min(3, speedRaw)).toFixed(4),
      Math.max(0, Math.min(3, Math.round(modeRaw))).toFixed(0),
      Math.max(0, Math.min(1, turbulenceRaw)).toFixed(4),
      Math.max(0, Math.min(1, chromaticRaw)).toFixed(4),
    ].join(':');
  }
  if (type === 'polartransform') {
    const mixRaw = firstFiniteParam(params, ['polarMix', 'outputMix', 'mix', 'amount'], 1);
    const modeRaw = firstFiniteParam(params, ['polarMode', 'mode'], 0);
    const rotationRaw = firstFiniteParam(params, ['polarRotation', 'rotation'], 0);
    const zoomRaw = firstFiniteParam(params, ['polarZoom', 'zoom'], 1);
    const centerXRaw = firstFiniteParam(params, ['polarCenterX', 'centerX'], 0.5);
    const centerYRaw = firstFiniteParam(params, ['polarCenterY', 'centerY'], 0.5);
    return [
      'polar-transform',
      Math.max(0, Math.min(1, mixRaw)).toFixed(4),
      Math.max(0, Math.min(2, Math.round(modeRaw))).toFixed(0),
      (((rotationRaw % 360) + 360) % 360).toFixed(4),
      Math.max(0.25, Math.min(4, zoomRaw)).toFixed(4),
      Math.max(0, Math.min(1, centerXRaw)).toFixed(4),
      Math.max(0, Math.min(1, centerYRaw)).toFixed(4),
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
      Math.max(0, Math.min(1, firstFiniteParam(params, ['glitchFreezeBurst', 'freezeBurst'], 0))).toFixed(4),
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
    const tintR = clampNumber(firstFiniteParam(params, ['vignetteColorR'], 0), 0, 1);
    const tintG = clampNumber(firstFiniteParam(params, ['vignetteColorG'], 0), 0, 1);
    const tintB = clampNumber(firstFiniteParam(params, ['vignetteColorB'], 0), 0, 1);
    const breathSpeed = clampNumber(firstFiniteParam(params, ['vignetteBreathSpeed'], 0.5), 0, 2);
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
      tintR.toFixed(4),
      tintG.toFixed(4),
      tintB.toFixed(4),
      breathSpeed.toFixed(4),
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
    const glowFalloffRaw = firstFiniteParam(params, ['outlineGlowFalloff'], 1);
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
      Math.max(0.1, Math.min(4, glowFalloffRaw)).toFixed(4),
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
    const normalModeRaw = firstFiniteParam(params, ['embossNormalMode'], 0);
    const metallicRaw = firstFiniteParam(params, ['embossMetallicness'], 0);
    return [
      'emboss',
      Math.max(0, Math.min(2, strengthRaw)).toFixed(4),
      (((angleRaw % 360) + 360) % 360).toFixed(4),
      Math.max(0, Math.min(4, heightRaw)).toFixed(4),
      Math.max(0, Math.min(1.5, highlightRRaw)).toFixed(4),
      Math.max(0, Math.min(1.5, highlightGRaw)).toFixed(4),
      Math.max(0, Math.min(1.5, highlightBRaw)).toFixed(4),
      Math.max(0, Math.min(1.5, shadowRRaw)).toFixed(4),
      Math.max(0, Math.min(1.5, shadowGRaw)).toFixed(4),
      Math.max(0, Math.min(1.5, shadowBRaw)).toFixed(4),
      Math.max(0, Math.min(1, Math.round(normalModeRaw))).toFixed(0),
      Math.max(0, Math.min(1, metallicRaw)).toFixed(4),
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
  if (type === 'tiltshift' || type === 'tilt-shift') {
    const mixRaw = firstFiniteParam(params, ['tiltShiftMix', 'mix', 'amount'], 1);
    const modeRaw = firstFiniteParam(params, ['tiltShiftMode', 'mode'], 0);
    const focusYRaw = firstFiniteParam(params, ['tiltShiftFocusY', 'focusY', 'centerY'], 0.5);
    const focusXRaw = firstFiniteParam(params, ['tiltShiftFocusX', 'focusX', 'centerX'], 0.5);
    const focusBandRaw = firstFiniteParam(params, ['tiltShiftFocusBand', 'focusBand'], 0.2);
    const falloffRaw = firstFiniteParam(params, ['tiltShiftFalloff', 'falloff', 'amount2'], 0.3);
    const maxBlurRaw = firstFiniteParam(params, ['tiltShiftMaxBlur', 'maxBlur'], 0.5);
    const angleRaw = firstFiniteParam(params, ['tiltShiftAngle', 'angle'], 0);
    const saturationRaw = firstFiniteParam(params, ['tiltShiftSaturation', 'saturation'], 1.2);
    return [
      'tilt-shift',
      Math.max(0, Math.min(1, mixRaw)).toFixed(4),
      Math.max(0, Math.min(3, Math.round(modeRaw))).toFixed(0),
      Math.max(0, Math.min(1, focusYRaw)).toFixed(4),
      Math.max(0, Math.min(1, focusXRaw)).toFixed(4),
      Math.max(0.001, Math.min(1, focusBandRaw)).toFixed(4),
      Math.max(0.001, Math.min(1, falloffRaw)).toFixed(4),
      Math.max(0, Math.min(1, maxBlurRaw)).toFixed(4),
      (((angleRaw % 360) + 360) % 360).toFixed(4),
      Math.max(0, Math.min(2, saturationRaw)).toFixed(4),
    ].join(':');
  }
  if (type === 'halation') {
    const amountRaw = firstFiniteParam(params, ['halationAmount', 'amount'], 0.6);
    const radiusRaw = firstFiniteParam(params, ['halationRadius', 'radius', 'amount2'], 12);
    const thresholdRaw = firstFiniteParam(params, ['halationThreshold', 'threshold'], 0.65);
    const tintRRaw = firstFiniteParam(params, ['halationTintR', 'red'], 0.9);
    const tintGRaw = firstFiniteParam(params, ['halationTintG', 'green'], 0.45);
    const tintBRaw = firstFiniteParam(params, ['halationTintB', 'blue'], 0.2);
    const modeRaw = firstFiniteParam(params, ['halationMode', 'mode'], 0);
    const mixRaw = firstFiniteParam(params, ['halationMix', 'mix', 'outputMix'], 1);
    return [
      'halation',
      Math.max(0, Math.min(2, amountRaw)).toFixed(4),
      Math.max(0, Math.min(48, radiusRaw)).toFixed(4),
      Math.max(0, Math.min(1, thresholdRaw)).toFixed(4),
      Math.max(0, Math.min(1.5, tintRRaw)).toFixed(4),
      Math.max(0, Math.min(1.5, tintGRaw)).toFixed(4),
      Math.max(0, Math.min(1.5, tintBRaw)).toFixed(4),
      Math.max(0, Math.min(2, Math.round(modeRaw))).toFixed(0),
      Math.max(0, Math.min(1, mixRaw)).toFixed(4),
    ].join(':');
  }
  if (type === 'anamorphicstreak' || type === 'anamorphic-streak') {
    const amountRaw = firstFiniteParam(params, ['anaIntensity', 'intensity', 'amount'], 0.6);
    const lengthRaw = firstFiniteParam(params, ['anaLength', 'length', 'amount2'], 0.5);
    const thresholdRaw = firstFiniteParam(params, ['anaThreshold', 'threshold'], 0.7);
    const tintRRaw = firstFiniteParam(params, ['anaTintR', 'red'], 0.6);
    const tintGRaw = firstFiniteParam(params, ['anaTintG', 'green'], 0.75);
    const tintBRaw = firstFiniteParam(params, ['anaTintB', 'blue'], 1);
    const angleRaw = firstFiniteParam(params, ['anaAngle', 'angle'], 0);
    const samplesRaw = firstFiniteParam(params, ['anaSamples', 'samples'], 32);
    const mixRaw = firstFiniteParam(params, ['anaMix', 'mix', 'outputMix'], 1);
    return [
      'anamorphic-streak',
      Math.max(0, Math.min(2, amountRaw)).toFixed(4),
      Math.max(0, Math.min(1, lengthRaw)).toFixed(4),
      Math.max(0, Math.min(1, thresholdRaw)).toFixed(4),
      Math.max(0, Math.min(1.5, tintRRaw)).toFixed(4),
      Math.max(0, Math.min(1.5, tintGRaw)).toFixed(4),
      Math.max(0, Math.min(1.5, tintBRaw)).toFixed(4),
      Math.max(0, Math.min(180, angleRaw)).toFixed(4),
      Math.max(8, Math.min(64, samplesRaw)).toFixed(4),
      Math.max(0, Math.min(1, mixRaw)).toFixed(4),
    ].join(':');
  }
  if (type === 'heathaze' || type === 'heat-haze') {
    const amountRaw = firstFiniteParam(params, ['hazeAmount', 'amount'], 0.4);
    const scaleRaw = firstFiniteParam(params, ['hazeScale', 'scale', 'amount2'], 8);
    const speedRaw = firstFiniteParam(params, ['hazeSpeed', 'speed'], 1);
    const directionYRaw = firstFiniteParam(params, ['hazeDirectionY', 'directionY'], 0.5);
    const turbulenceRaw = firstFiniteParam(params, ['hazeTurbulence', 'turbulence'], 0.5);
    const modeRaw = firstFiniteParam(params, ['hazeMode', 'mode'], 0);
    const focusYRaw = firstFiniteParam(params, ['hazeFocusY', 'focusY', 'centerY'], 0.5);
    const focusBandRaw = firstFiniteParam(params, ['hazeFocusBand', 'focusBand'], 0.4);
    return [
      'heat-haze',
      Math.max(0, Math.min(1, amountRaw)).toFixed(4),
      Math.max(1, Math.min(32, scaleRaw)).toFixed(4),
      Math.max(0, Math.min(3, speedRaw)).toFixed(4),
      Math.max(-1, Math.min(1, directionYRaw)).toFixed(4),
      Math.max(0, Math.min(1, turbulenceRaw)).toFixed(4),
      Math.max(0, Math.min(2, Math.round(modeRaw))).toFixed(0),
      Math.max(0, Math.min(1, focusYRaw)).toFixed(4),
      Math.max(0.05, Math.min(1, focusBandRaw)).toFixed(4),
    ].join(':');
  }
  if (type === 'curves') {
    const mixRaw = firstFiniteParam(params, ['curvesMix', 'mix', 'amount'], 1);
    const contrastRaw = firstFiniteParam(params, ['curvesContrast', 'contrast'], 0.4);
    const toeRaw = firstFiniteParam(params, ['curvesToe', 'toe'], 0);
    const shoulderRaw = firstFiniteParam(params, ['curvesShoulder', 'shoulder'], 0);
    const blackCrushRaw = firstFiniteParam(params, ['curvesBlackCrush', 'blackCrush'], 0);
    return [
      'curves',
      Math.max(0, Math.min(1, mixRaw)).toFixed(4),
      Math.max(0, Math.min(1, contrastRaw)).toFixed(4),
      Math.max(0, Math.min(1, toeRaw)).toFixed(4),
      Math.max(0, Math.min(1, shoulderRaw)).toFixed(4),
      Math.max(0, Math.min(1, blackCrushRaw)).toFixed(4),
    ].join(':');
  }
  if (type === 'selectivecolor' || type === 'selective-color') {
    const amountRaw = firstFiniteParam(params, ['selectiveColorMix', 'selColorMix', 'mix', 'amount'], 1);
    const targetHueRaw = firstFiniteParam(params, ['selColorTargetHue', 'targetHue'], 0);
    const rangeRaw = firstFiniteParam(params, ['selColorRange', 'hueRange', 'range'], 0.1);
    const featherRaw = firstFiniteParam(params, ['selColorFeather', 'feather'], 0.1);
    const modeRaw = firstFiniteParam(params, ['selColorMode', 'mode'], 0);
    const replaceHueRaw = firstFiniteParam(params, ['selColorReplaceHue', 'replaceHue'], 0.33);
    const satBoostRaw = firstFiniteParam(params, ['selColorSatBoost', 'satBoost', 'saturation'], 0);
    return [
      'selective-color',
      Math.max(0, Math.min(1, amountRaw)).toFixed(4),
      Math.max(0, Math.min(1, targetHueRaw)).toFixed(4),
      Math.max(0, Math.min(1, rangeRaw)).toFixed(4),
      Math.max(0, Math.min(1, featherRaw)).toFixed(4),
      Math.max(0, Math.min(1, Math.round(modeRaw))).toFixed(0),
      Math.max(0, Math.min(1, replaceHueRaw)).toFixed(4),
      Math.max(0, Math.min(1, satBoostRaw)).toFixed(4),
    ].join(':');
  }
  if (type === 'falsecolor' || type === 'false-color') {
    const mixRaw = firstFiniteParam(params, ['falseColorMix', 'mix', 'amount'], 1);
    const modeRaw = firstFiniteParam(params, ['falseColorMode', 'mode'], 0);
    const showOriginalRaw = firstFiniteParam(params, ['falseColorShowOriginal', 'showOriginal'], 1);
    const midpointRaw = firstFiniteParam(params, ['falseColorMidpoint', 'midpoint'], 0.5);
    const rangeRaw = firstFiniteParam(params, ['falseColorRange', 'range'], 0);
    return [
      'false-color',
      Math.max(0, Math.min(1, mixRaw)).toFixed(4),
      Math.max(0, Math.min(3, Math.round(modeRaw))).toFixed(0),
      Math.max(0, Math.min(1, showOriginalRaw)).toFixed(4),
      Math.max(0, Math.min(1, midpointRaw)).toFixed(4),
      Math.max(0, Math.min(0.5, rangeRaw)).toFixed(4),
    ].join(':');
  }
  if (type === 'shadowrecovery' || type === 'shadow-recovery') {
    const amountRaw = firstFiniteParam(params, ['shadowAmount', 'amount'], 0.5);
    const thresholdRaw = firstFiniteParam(params, ['shadowThreshold', 'threshold'], 0.4);
    const softnessRaw = firstFiniteParam(params, ['shadowSoftness', 'softness'], 0.3);
    const colorRecoveryRaw = firstFiniteParam(params, ['shadowColorRecovery', 'colorRecovery'], 0.3);
    const highlightProtectRaw = firstFiniteParam(params, ['shadowHighlightProtect', 'highlightProtect'], 0.6);
    const mixRaw = firstFiniteParam(params, ['shadowMix', 'mix', 'outputMix'], 1);
    return [
      'shadow-recovery',
      Math.max(0, Math.min(1, amountRaw)).toFixed(4),
      Math.max(0, Math.min(1, thresholdRaw)).toFixed(4),
      Math.max(0, Math.min(1, softnessRaw)).toFixed(4),
      Math.max(0, Math.min(1, colorRecoveryRaw)).toFixed(4),
      Math.max(0, Math.min(1, highlightProtectRaw)).toFixed(4),
      Math.max(0, Math.min(1, mixRaw)).toFixed(4),
    ].join(':');
  }
  if (type === 'highlightrolloff' || type === 'highlight-rolloff') {
    const amountRaw = firstFiniteParam(params, ['highRolloffAmount', 'amount'], 0.5);
    const thresholdRaw = firstFiniteParam(params, ['highRolloffThreshold', 'threshold'], 0.7);
    const softnessRaw = firstFiniteParam(params, ['highRolloffSoftness', 'softness'], 0.2);
    const preserveHueRaw = firstFiniteParam(params, ['highRolloffPreserveHue', 'preserveHue'], 0.5);
    const maxValueRaw = firstFiniteParam(params, ['highRolloffMaxValue', 'maxValue'], 1);
    const mixRaw = firstFiniteParam(params, ['highRolloffMix', 'mix', 'outputMix'], 1);
    return [
      'highlight-rolloff',
      Math.max(0, Math.min(1, amountRaw)).toFixed(4),
      Math.max(0, Math.min(1, thresholdRaw)).toFixed(4),
      Math.max(0, Math.min(1, softnessRaw)).toFixed(4),
      Math.max(0, Math.min(1, preserveHueRaw)).toFixed(4),
      Math.max(0.7, Math.min(1.5, maxValueRaw)).toFixed(4),
      Math.max(0, Math.min(1, mixRaw)).toFixed(4),
    ].join(':');
  }
  if (type === 'colorbalance' || type === 'color-balance') {
    const mixRaw = firstFiniteParam(params, ['cbMix', 'colorBalanceMix', 'mix', 'amount'], 1);
    const shadowRRaw = firstFiniteParam(params, ['cbShadowR', 'shadowR'], 0);
    const shadowGRaw = firstFiniteParam(params, ['cbShadowG', 'shadowG'], 0);
    const shadowBRaw = firstFiniteParam(params, ['cbShadowB', 'shadowB'], 0);
    const preserveRaw = firstFiniteParam(params, ['cbPreserveLuma', 'preserveLuma'], 0);
    const midRRaw = firstFiniteParam(params, ['cbMidR', 'midR'], 0);
    const midGRaw = firstFiniteParam(params, ['cbMidG', 'midG'], 0);
    const midBRaw = firstFiniteParam(params, ['cbMidB', 'midB'], 0);
    const highRRaw = firstFiniteParam(params, ['cbHighR', 'highR'], 0);
    const highGRaw = firstFiniteParam(params, ['cbHighG', 'highG'], 0);
    const highBRaw = firstFiniteParam(params, ['cbHighB', 'highB'], 0);
    return [
      'color-balance',
      Math.max(0, Math.min(1, mixRaw)).toFixed(4),
      Math.max(-1, Math.min(1, shadowRRaw)).toFixed(4),
      Math.max(-1, Math.min(1, shadowGRaw)).toFixed(4),
      Math.max(-1, Math.min(1, shadowBRaw)).toFixed(4),
      Math.max(0, Math.min(1, preserveRaw)).toFixed(4),
      Math.max(-1, Math.min(1, midRRaw)).toFixed(4),
      Math.max(-1, Math.min(1, midGRaw)).toFixed(4),
      Math.max(-1, Math.min(1, midBRaw)).toFixed(4),
      '0',
      Math.max(-1, Math.min(1, highRRaw)).toFixed(4),
      Math.max(-1, Math.min(1, highGRaw)).toFixed(4),
      Math.max(-1, Math.min(1, highBRaw)).toFixed(4),
      '0',
    ].join(':');
  }
  if (type === 'liftgammagain' || type === 'lift-gamma-gain') {
    const mixRaw = firstFiniteParam(params, ['lggMix', 'liftGammaGainMix', 'mix', 'amount'], 1);
    const liftRRaw = firstFiniteParam(params, ['lggLiftR', 'liftR'], 0);
    const liftGRaw = firstFiniteParam(params, ['lggLiftG', 'liftG'], 0);
    const liftBRaw = firstFiniteParam(params, ['lggLiftB', 'liftB'], 0);
    const lumaOnlyRaw = firstFiniteParam(params, ['lggLumaOnly', 'lumaOnly'], 0);
    const gammaRRaw = firstFiniteParam(params, ['lggGammaR', 'gammaR'], 1);
    const gammaGRaw = firstFiniteParam(params, ['lggGammaG', 'gammaG'], 1);
    const gammaBRaw = firstFiniteParam(params, ['lggGammaB', 'gammaB'], 1);
    const gainRRaw = firstFiniteParam(params, ['lggGainR', 'gainR'], 1);
    const gainGRaw = firstFiniteParam(params, ['lggGainG', 'gainG'], 1);
    const gainBRaw = firstFiniteParam(params, ['lggGainB', 'gainB'], 1);
    return [
      'lift-gamma-gain',
      Math.max(0, Math.min(1, mixRaw)).toFixed(4),
      Math.max(-0.5, Math.min(0.5, liftRRaw)).toFixed(4),
      Math.max(-0.5, Math.min(0.5, liftGRaw)).toFixed(4),
      Math.max(-0.5, Math.min(0.5, liftBRaw)).toFixed(4),
      Math.max(0, Math.min(1, lumaOnlyRaw)).toFixed(4),
      Math.max(0.05, Math.min(4, gammaRRaw)).toFixed(4),
      Math.max(0.05, Math.min(4, gammaGRaw)).toFixed(4),
      Math.max(0.05, Math.min(4, gammaBRaw)).toFixed(4),
      '0',
      Math.max(0.05, Math.min(4, gainRRaw)).toFixed(4),
      Math.max(0.05, Math.min(4, gainGRaw)).toFixed(4),
      Math.max(0.05, Math.min(4, gainBRaw)).toFixed(4),
      '0',
    ].join(':');
  }
  if (type === 'strobeflash' || type === 'strobe-flash') {
    const intensityRaw = firstFiniteParam(params, ['strobeIntensity', 'intensity', 'amount'], 1);
    const rateRaw = firstFiniteParam(params, ['strobeRate', 'rate', 'speed'], 4);
    const dutyRaw = firstFiniteParam(params, ['strobeDuty', 'duty'], 0.5);
    const modeRaw = firstFiniteParam(params, ['strobeMode', 'mode'], 0);
    const tintRRaw = firstFiniteParam(params, ['strobeTintR', 'tintR', 'red'], 1);
    const tintGRaw = firstFiniteParam(params, ['strobeTintG', 'tintG', 'green'], 1);
    const tintBRaw = firstFiniteParam(params, ['strobeTintB', 'tintB', 'blue'], 1);
    return [
      'strobe-flash',
      Math.max(0, Math.min(2, intensityRaw)).toFixed(4),
      Math.max(0.5, Math.min(30, rateRaw)).toFixed(4),
      Math.max(0, Math.min(1, dutyRaw)).toFixed(4),
      Math.max(0, Math.min(2, Math.round(modeRaw))).toFixed(0),
      Math.max(0, Math.min(1, tintRRaw)).toFixed(4),
      Math.max(0, Math.min(1, tintGRaw)).toFixed(4),
      Math.max(0, Math.min(1, tintBRaw)).toFixed(4),
    ].join(':');
  }
  if (type === 'blobtrack' || type === 'blob-track') {
    return blobEffectDescriptor('blob-track', params, {
      mix: 0.8,
      threshold: 0.3,
      shape: 0,
      color: 0,
      thickness: 2,
      gridSize: 16,
      trailLength: 0.3,
      minSize: 0.02,
      showCoords: 1,
      showBBox: 1,
      showCenter: 1,
    });
  }
  if (type === 'blobcontour' || type === 'blob-contour') {
    return blobEffectDescriptor('blob-contour', params, {
      mix: 0.7,
      threshold: 0.4,
      shape: 0,
      color: 1,
      thickness: 1.5,
      gridSize: 16,
      trailLength: 0.4,
      minSize: 0.5,
      showCoords: 0,
      showBBox: 0,
      showCenter: 0,
    });
  }
  if (type === 'blobheatmap' || type === 'blob-heatmap') {
    return blobEffectDescriptor('blob-heatmap', params, {
      mix: 0.85,
      threshold: 0.2,
      shape: 0,
      color: 0,
      thickness: 1,
      gridSize: 16,
      trailLength: 0,
      minSize: 0,
      showCoords: 1,
      showBBox: 1,
      showCenter: 1,
    });
  }

  // Keep explicit descriptor IDs compatible with native descriptor parser.
  const effectId = typeof effect.id === 'string' ? effect.id.trim() : '';
  if (effectId.includes(':')) return effectId.toLowerCase();

  // Generic fallback: any effect covered by the native effect-pass manifest is
  // routed through with its raw numeric params; packNativeEffectPassUniforms
  // owns the per-effect param mapping.
  const passthruId = nativeEffectPassIdForEffectType(String(effect.type || '')) as NativeEffectPassId;
  if (NATIVE_EFFECT_PASS_IDS.has(passthruId)) {
    const pairs: string[] = [];
    for (const key of Object.keys(params).sort()) {
      const value = Number((params as Record<string, unknown>)[key]);
      if (Number.isFinite(value)) pairs.push(`${key}=${value.toFixed(4)}`);
    }
    return `passthru:${passthruId}:${pairs.join(',')}`;
  }
  return null;
}

export function nativeEffectPassFromDescriptor(descriptor: string | null): NativeEffectPassRuntime | null {
  if (!descriptor) return null;
  if (descriptor.startsWith('passthru:')) {
    const rest = descriptor.slice('passthru:'.length);
    const sep = rest.indexOf(':');
    const effect = (sep >= 0 ? rest.slice(0, sep) : rest) as NativeEffectPassId;
    if (!NATIVE_EFFECT_PASS_IDS.has(effect)) return null;
    const passthruParams: Record<string, number> = {};
    if (sep >= 0) {
      for (const pair of rest.slice(sep + 1).split(',')) {
        const eq = pair.indexOf('=');
        if (eq <= 0) continue;
        const value = Number(pair.slice(eq + 1));
        if (Number.isFinite(value)) passthruParams[pair.slice(0, eq)] = value;
      }
    }
    return {
      effect,
      descriptor,
      params: passthruParams as NativeEffectPassRuntime['params'],
    };
  }
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
    rawParam8,
    rawParam9,
    rawParam10,
    rawParam11,
    rawParam12,
    rawParam13,
    rawParam14,
    rawParam15,
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
      vignetteColorR: Number(rawParam8 ?? 0),
      vignetteColorG: Number(rawParam9 ?? 0),
      vignetteColorB: Number(rawParam10 ?? 0),
      vignetteBreathSpeed: Number(rawParam11 ?? 0.5),
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
  } else if (effect === 'fm-scanlines') {
    params = {
      mode: Number(rawParam0 ?? 0),
      count: Number(rawParam1 ?? 140),
      width: Number(rawParam2 ?? 0.32),
      freq: Number(rawParam3 ?? 0.25),
      fmDepth: Number(rawParam4 ?? 0.55),
      amp: Number(rawParam5 ?? 0.5),
      speed: Number(rawParam6 ?? 0.6),
      colorMix: Number(rawParam7 ?? 0),
      invert: Number(rawParam8 ?? 0),
    };
  } else if (effect === 'vhs') {
    params = {
      tracking: Number(rawParam0 ?? 0.5),
      noise: Number(rawParam1 ?? 0.3),
      distortion: Number(rawParam2 ?? 0.3),
      colorBleed: Number(rawParam3 ?? 0.5),
      scanlines: Number(rawParam4 ?? 0.3),
      headSwitch: Number(rawParam5 ?? 0),
      tapeWobble: Number(rawParam6 ?? 0),
      dropout: Number(rawParam7 ?? 0),
      chromaDelay: Number(rawParam8 ?? 0),
      trackingJump: Number(rawParam9 ?? 0),
      saturation: Number(rawParam10 ?? 1),
    };
  } else if (effect === 'plasma') {
    params = {
      plasmaScale: Number(rawParam0 ?? 5.5),
      plasmaSpeed: Number(rawParam1 ?? 0.7),
      plasmaPalette: Number(rawParam2 ?? 0),
      plasmaSourceMix: Number(rawParam3 ?? 0.35),
      plasmaComplexity: Number(rawParam4 ?? 3),
      plasmaMode: Number(rawParam5 ?? 0),
      plasmaBlendMode: Number(rawParam6 ?? 0),
      plasmaWarpAmount: Number(rawParam7 ?? 0.4),
      plasmaAudioReact: Number(rawParam8 ?? 0),
    };
  } else if (effect === 'halftone') {
    params = {
      halftoneScale: Number(rawParam0 ?? 14),
      halftoneAngle: Number(rawParam1 ?? 35),
      halftoneDotGain: Number(rawParam2 ?? 1),
      halftoneColorMode: Number(rawParam3 ?? 0),
      halftoneMode: Number(rawParam4 ?? 0),
      halftoneDotShape: Number(rawParam5 ?? 0),
      halftoneAngleC: Number(rawParam6 ?? 15),
      halftoneAngleM: Number(rawParam7 ?? 75),
      halftoneAngleY: Number(rawParam8 ?? 0),
      halftoneAngleK: Number(rawParam9 ?? 45),
      halftoneDrift: Number(rawParam10 ?? 0),
    };
  } else if (effect === 'toon') {
    params = {
      toonLevels: Number(rawParam0 ?? 4),
      toonEdgeStrength: Number(rawParam1 ?? 0.8),
      toonSaturation: Number(rawParam2 ?? 1.15),
      toonEdgeThreshold: Number(rawParam3 ?? 0.05),
      toonRampSoftness: Number(rawParam4 ?? 0),
      toonShadowBand: Number(rawParam5 ?? 0),
    };
  } else if (effect === 'kuwahara') {
    params = {
      kuwaharaRadius: Number(rawParam0 ?? 3),
      kuwaharaEdgeSharpness: Number(rawParam1 ?? 0.3),
      kuwaharaColorPunch: Number(rawParam2 ?? 0.2),
    };
  } else if (effect === 'defocus-bokeh') {
    params = {
      bokehSamples: Number(rawParam0 ?? 24),
      bokehBrightWeight: Number(rawParam1 ?? 0.8),
      bokehThreshold: Number(rawParam2 ?? 0.7),
      bokehChromaFringe: Number(rawParam3 ?? 0),
      bokehShape: Number(rawParam4 ?? 0),
      bokehRotation: Number(rawParam5 ?? 0),
      bokehMix: Number(rawParam6 ?? 1),
    };
  } else if (effect === 'god-rays') {
    params = {
      godRaysDecay: Number(rawParam0 ?? 0.95),
      godRaysExposure: Number(rawParam1 ?? 0.4),
      godRaysDensity: Number(rawParam2 ?? 0.95),
      godRaysThreshold: Number(rawParam3 ?? 0.7),
      godRaysCenterX: Number(rawParam4 ?? 0.5),
      godRaysCenterY: Number(rawParam5 ?? 0.2),
      godRaysSamples: Number(rawParam6 ?? 64),
      godRaysTintR: Number(rawParam7 ?? 1),
      godRaysTintG: Number(rawParam8 ?? 0.95),
      godRaysTintB: Number(rawParam9 ?? 0.85),
      godRaysMix: Number(rawParam10 ?? 1),
    };
  } else if (effect === 'displacement') {
    params = {
      dispScale: Number(rawParam0 ?? 6),
      dispSpeed: Number(rawParam1 ?? 1),
      dispMode: Number(rawParam2 ?? 0),
      dispTurbulence: Number(rawParam3 ?? 0.5),
      dispChromatic: Number(rawParam4 ?? 0),
    };
  } else if (effect === 'polar-transform') {
    params = {
      polarMode: Number(rawParam0 ?? 0),
      polarRotation: Number(rawParam1 ?? 0),
      polarZoom: Number(rawParam2 ?? 1),
      polarCenterX: Number(rawParam3 ?? 0.5),
      polarCenterY: Number(rawParam4 ?? 0.5),
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
      freezeBurst: Number(rawParam8 ?? 0),
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
      outlineGlowFalloff: Number(rawParam8 ?? 1),
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
      embossNormalMode: Number(rawParam8 ?? 0),
      embossMetallicness: Number(rawParam9 ?? 0),
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
  } else if (effect === 'tilt-shift') {
    params = {
      tiltShiftMode: Number(rawParam0 ?? 0),
      tiltShiftFocusY: Number(rawParam1 ?? 0.5),
      tiltShiftFocusX: Number(rawParam2 ?? 0.5),
      tiltShiftFocusBand: Number(rawParam3 ?? 0.2),
      tiltShiftFalloff: Number(rawParam4 ?? 0.3),
      tiltShiftMaxBlur: Number(rawParam5 ?? 0.5),
      tiltShiftAngle: Number(rawParam6 ?? 0),
      tiltShiftSaturation: Number(rawParam7 ?? 1.2),
    };
  } else if (effect === 'halation') {
    params = {
      halationRadius: Number(rawParam0 ?? 12),
      halationThreshold: Number(rawParam1 ?? 0.65),
      halationTintR: Number(rawParam2 ?? 0.9),
      halationTintG: Number(rawParam3 ?? 0.45),
      halationTintB: Number(rawParam4 ?? 0.2),
      halationMode: Number(rawParam5 ?? 0),
      halationMix: Number(rawParam6 ?? 1),
    };
  } else if (effect === 'anamorphic-streak') {
    params = {
      anaLength: Number(rawParam0 ?? 0.5),
      anaThreshold: Number(rawParam1 ?? 0.7),
      anaTintR: Number(rawParam2 ?? 0.6),
      anaTintG: Number(rawParam3 ?? 0.75),
      anaTintB: Number(rawParam4 ?? 1),
      anaAngle: Number(rawParam5 ?? 0),
      anaSamples: Number(rawParam6 ?? 32),
      anaMix: Number(rawParam7 ?? 1),
    };
  } else if (effect === 'heat-haze') {
    params = {
      hazeScale: Number(rawParam0 ?? 8),
      hazeSpeed: Number(rawParam1 ?? 1),
      hazeDirectionY: Number(rawParam2 ?? 0.5),
      hazeTurbulence: Number(rawParam3 ?? 0.5),
      hazeMode: Number(rawParam4 ?? 0),
      hazeFocusY: Number(rawParam5 ?? 0.5),
      hazeFocusBand: Number(rawParam6 ?? 0.4),
    };
  } else if (effect === 'curves') {
    params = {
      curvesContrast: Number(rawParam0 ?? 0.4),
      curvesToe: Number(rawParam1 ?? 0),
      curvesShoulder: Number(rawParam2 ?? 0),
      curvesBlackCrush: Number(rawParam3 ?? 0),
    };
  } else if (effect === 'selective-color') {
    params = {
      selColorTargetHue: Number(rawParam0 ?? 0),
      selColorRange: Number(rawParam1 ?? 0.1),
      selColorFeather: Number(rawParam2 ?? 0.1),
      selColorMode: Number(rawParam3 ?? 0),
      selColorReplaceHue: Number(rawParam4 ?? 0.33),
      selColorSatBoost: Number(rawParam5 ?? 0),
    };
  } else if (effect === 'false-color') {
    params = {
      falseColorMode: Number(rawParam0 ?? 0),
      falseColorShowOriginal: Number(rawParam1 ?? 1),
      falseColorMidpoint: Number(rawParam2 ?? 0.5),
      falseColorRange: Number(rawParam3 ?? 0),
    };
  } else if (effect === 'shadow-recovery') {
    params = {
      shadowThreshold: Number(rawParam0 ?? 0.4),
      shadowSoftness: Number(rawParam1 ?? 0.3),
      shadowColorRecovery: Number(rawParam2 ?? 0.3),
      shadowHighlightProtect: Number(rawParam3 ?? 0.6),
      shadowMix: Number(rawParam4 ?? 1),
    };
  } else if (effect === 'highlight-rolloff') {
    params = {
      highRolloffThreshold: Number(rawParam0 ?? 0.7),
      highRolloffSoftness: Number(rawParam1 ?? 0.2),
      highRolloffPreserveHue: Number(rawParam2 ?? 0.5),
      highRolloffMaxValue: Number(rawParam3 ?? 1),
      highRolloffMix: Number(rawParam4 ?? 1),
    };
  } else if (effect === 'color-balance') {
    params = {
      cbShadowR: Number(rawParam0 ?? 0),
      cbShadowG: Number(rawParam1 ?? 0),
      cbShadowB: Number(rawParam2 ?? 0),
      cbPreserveLuma: Number(rawParam3 ?? 0),
      cbMidR: Number(rawParam4 ?? 0),
      cbMidG: Number(rawParam5 ?? 0),
      cbMidB: Number(rawParam6 ?? 0),
      cbHighR: Number(rawParam8 ?? 0),
      cbHighG: Number(rawParam9 ?? 0),
      cbHighB: Number(rawParam10 ?? 0),
    };
  } else if (effect === 'lift-gamma-gain') {
    params = {
      lggLiftR: Number(rawParam0 ?? 0),
      lggLiftG: Number(rawParam1 ?? 0),
      lggLiftB: Number(rawParam2 ?? 0),
      lggLumaOnly: Number(rawParam3 ?? 0),
      lggGammaR: Number(rawParam4 ?? 1),
      lggGammaG: Number(rawParam5 ?? 1),
      lggGammaB: Number(rawParam6 ?? 1),
      lggGainR: Number(rawParam8 ?? 1),
      lggGainG: Number(rawParam9 ?? 1),
      lggGainB: Number(rawParam10 ?? 1),
    };
  } else if (effect === 'strobe-flash') {
    params = {
      strobeRate: Number(rawParam0 ?? 4),
      strobeDuty: Number(rawParam1 ?? 0.5),
      strobeMode: Number(rawParam2 ?? 0),
      strobeTintR: Number(rawParam3 ?? 1),
      strobeTintG: Number(rawParam4 ?? 1),
      strobeTintB: Number(rawParam5 ?? 1),
    };
  } else if (effect === 'blob-track' || effect === 'blob-contour' || effect === 'blob-heatmap') {
    const defaultFlags = effect === 'blob-contour' ? 0 : 7;
    const flags = Number(rawParam5 ?? defaultFlags);
    params = {
      blobThreshold: Number(rawParam0 ?? (effect === 'blob-heatmap' ? 0.2 : effect === 'blob-contour' ? 0.4 : 0.3)),
      blobShape: Number(rawParam1 ?? 0),
      blobColor: Number(rawParam2 ?? (effect === 'blob-contour' ? 1 : 0)),
      blobThickness: Number(rawParam3 ?? (effect === 'blob-track' ? 2 : effect === 'blob-contour' ? 1.5 : 1)),
      blobGridSize: Number(rawParam4 ?? 16),
      blobFlags: flags,
      blobShowCoords: (Math.round(flags) & 1) ? 1 : 0,
      blobShowBBox: (Math.round(flags) & 2) ? 1 : 0,
      blobShowCenter: (Math.round(flags) & 4) ? 1 : 0,
      blobTrailLength: Number(rawParam6 ?? (effect === 'blob-heatmap' ? 0 : effect === 'blob-contour' ? 0.4 : 0.3)),
      blobMinSize: Number(rawParam7 ?? (effect === 'blob-track' ? 0.02 : effect === 'blob-contour' ? 0.5 : 0)),
      blobColorMode: Number(rawParam8 ?? 0),
      blobFixedColorR: Number(rawParam9 ?? 0),
      blobFixedColorG: Number(rawParam10 ?? 1),
      blobFixedColorB: Number(rawParam11 ?? 0.5),
      blobMarkerSize: Number(rawParam12 ?? 1),
      blobBlendMode: Number(rawParam13 ?? 0),
    };
  }
  if (effect === 'noise') {
    params = {
      noiseType: Number(rawParam0 ?? 0),
      noiseMode: Number(rawParam1 ?? 0),
      noiseScale: Number(rawParam2 ?? 1),
      noiseMono: Number(rawParam3 ?? 0),
      noiseShadow: Number(rawParam4 ?? 1),
      noiseMid: Number(rawParam5 ?? 1),
      noiseHigh: Number(rawParam6 ?? 1),
      noiseAnimSpeed: Number(rawParam7 ?? 1),
    };
  }
  if (effect === 'gamma') {
    params = {
      gammaShadows: Number(rawParam0 ?? 1),
      gammaMids: Number(rawParam1 ?? 1),
      gammaHighlights: Number(rawParam2 ?? 1),
      gammaMix: Number(rawParam3 ?? 1),
    };
  }
  if (effect === 'invert') {
    params = {
      invertMode: Number(rawParam0 ?? 0),
      invertThreshold: Number(rawParam1 ?? 0.5),
      invertStrobeRate: Number(rawParam2 ?? 4),
    };
  }
  if (effect === 'posterize') {
    params = {
      posterizeDither: Number(rawParam0 ?? 0),
      posterizeAnimSpeed: Number(rawParam1 ?? 0),
      posterizePalette: Number(rawParam2 ?? 0),
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

export function nativeUnsupportedEffectTypes(layer: Pick<Layer, 'effects'>): string[] {
  const unsupported = new Set<string>();
  for (const effect of layer.effects || []) {
    if (!effect || effect.enabled === false) continue;
    if (nativeEffectPassFromDescriptor(effectToNativeDescriptor(effect))) continue;
    unsupported.add(String(effect.type || 'unknown'));
  }
  return [...unsupported];
}

interface NativeUnsupportedSourceOptions {
  nativeVideoDecodePumpReady?: boolean;
  /** True when this layer's graph route was permanently disabled by the
   *  3-failure kill switch — a different situation from the transient
   *  route-unavailable window during startup warm-up, and one the operator
   *  must be able to see. */
  routeDisabledByFailures?: boolean;
}

const NATIVE_READY_LAYER_TYPES = new Set(['media', 'gpu', 'color', 'lines', 'svg', 'lightpainting', 'text', 'splat', 'model3d', 'screen', 'group', 'mask']);

function nativeUnsupportedGeometryReason(layer: Layer): string | null {
  const warpMode = String(layer.warpMode || 'corners').trim().toLowerCase();
  if (warpMode && warpMode !== 'corners' && warpMode !== 'none' && warpMode !== 'mesh') {
    return `warp:${warpMode}:native-compositor-pending`;
  }
  if (warpMode === 'mesh') {
    const grid = layer.meshGrid;
    if (!grid || grid.rows < 2 || grid.cols < 2 || grid.rows > 16 || grid.cols > 16) {
      return 'warp:mesh:invalid-grid';
    }
  }

  const shape = layer.layerShape;
  if (shape?.enabled) {
    const type = String(shape.type || 'rectangle').trim().toLowerCase();
    const nativeShapeTypes = ['rectangle', 'circle', 'triangle', 'ellipse', 'polygon', 'star', 'custom'];
    if (!nativeShapeTypes.includes(type)) {
      return `layer-shape:${type || 'unknown'}:not-native`;
    }
  }

  return null;
}

function nativeGpuSourceParamUnsupportedReason(
  layer: Layer,
  options: NativeUnsupportedSourceOptions = {},
): string | null {
  if (layer.type !== 'gpu' || !layer.gpuLayerContent) return null;
  const shaderId = String(layer.gpuLayerContent.shaderId || 'gpu').trim().toLowerCase();
  const params = layer.gpuLayerContent.params ?? {};
  const sourceParam = params.source;
  const requiresSource =
    shaderId === 'pixel-particles' ||
    shaderId === 'flythrough' ||
    shaderId === 'point-cloud-fx' ||
    (
      (shaderId === 'particle-field' || shaderId === 'gravity-wells') &&
      String(params.mode ?? '').trim().toLowerCase() === 'media'
    );
  if (!sourceParam || typeof sourceParam !== 'object') {
    return requiresSource ? `gpu-shader:${shaderId || 'gpu'}:source-required` : null;
  }

  if (sourceParam.type === 'media') {
    if (!sourceParam.mediaId) return `gpu-source:media:missing-id`;
    const item = get(mediaLibrary).find((media: MediaItem) => media.id === sourceParam.mediaId);
    if (!item) return `gpu-source:media:${sourceParam.mediaId}:missing`;
    const source = mediaItemToNativeLayerSource(item).source;
    return source ? nativeMediaSourceUnsupportedReason(source, options) : `gpu-source:media:${sourceParam.mediaId}:invalid`;
  }

  if (sourceParam.type === 'layer') {
    if (!sourceParam.layerId) return `gpu-source:layer:missing-id`;
    const sourceLayer = get(project).layers.find((candidate) => candidate.id === sourceParam.layerId);
    if (!sourceLayer?.source) return `gpu-source:layer:${sourceParam.layerId}:no-native-source`;
    return nativeMediaSourceUnsupportedReason(sourceLayer.source, options);
  }

  if (sourceParam.type === 'file') {
    return nativeFileSourceParamUnsupportedReason(sourceParam);
  }

  if (sourceParam.type === 'camera') {
    return 'gpu-source:camera:native-ingest-pending';
  }

  if (sourceParam.type === 'spout') {
    return 'gpu-source:shared-texture:graph-input-pending';
  }

  return `gpu-source:${String(sourceParam.type || 'unknown')}:native-ingest-pending`;
}

export function nativeUnsupportedSourceReason(
  layer: Layer,
  hasNativeGraphRoute = false,
  options: NativeUnsupportedSourceOptions = {},
): string | null {
  if (!NATIVE_READY_LAYER_TYPES.has(String(layer.type))) {
    return `layer-type:${String(layer.type || 'unknown')}:not-native`;
  }
  const geometryReason = nativeUnsupportedGeometryReason(layer);
  if (geometryReason) return geometryReason;

  if (layer.type === 'gpu' && layer.gpuLayerContent) {
    if (hasNativeGraphRoute) return null;
    const shaderId = String(layer.gpuLayerContent.shaderId || 'gpu').trim().toLowerCase();
    if (!isNativeReadyGpuShaderId(shaderId)) return `gpu-shader:${shaderId || 'unknown'}:not-native`;
    const sourceReason = nativeGpuSourceParamUnsupportedReason(layer, options);
    if (sourceReason) return sourceReason;
    if (options.routeDisabledByFailures) {
      return `gpu-shader:${shaderId || 'unknown'}:route-failed`;
    }
    return `gpu-shader:${shaderId || 'unknown'}:route-unavailable`;
  }

  // A native graph route replaces the source ingest path. Integrated plugins
  // are represented as effect media in the project model, but their pixels are
  // produced directly by the core graph rather than decoded from source.src.
  if (hasNativeGraphRoute) return null;

  const pluginReason = nativePluginUnavailableReason(layer.source?.effectSource);
  if (pluginReason) return pluginReason;

  if (layer.source) {
    return nativeMediaSourceUnsupportedReason(layer.source, options);
  }

  if (layer.type === 'mask') {
    // Hierarchy mask layers carry no source by design — the core clips
    // the composite below them from mask_info/mask_points alone.
    return null;
  }
  if (!layer.source && generatedLayerPreview(layer)) {
    return `generated-layer:${layer.type}:not-native-source`;
  }

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
  const corners = [
    c.topLeft.x, c.topLeft.y,
    c.topRight.x, c.topRight.y,
    c.bottomRight.x, c.bottomRight.y,
    c.bottomLeft.x, c.bottomLeft.y,
  ].map((v) => Number.isFinite(v) ? v.toFixed(5) : 'nan').join(':');
  if (layer.warpMode !== 'mesh' || !layer.meshGrid) return `corners:${corners}`;
  const grid = layer.meshGrid;
  const points = grid.points
    .flatMap((row) => row.flatMap((point) => [point.x, point.y]))
    .map((value) => Number.isFinite(value) ? value.toFixed(5) : 'nan')
    .join(':');
  return `mesh:${corners}:${grid.rows}x${grid.cols}:${points}`;
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


// Layer Content Fit drives how content maps into an active shape:
//   stretch -> content stretches/follows the shape surface
//   fill    -> the shape is a pure mask over layer-filling content
//   crop    -> content letterboxed (aspect-preserving) within the shape
function shapeContentModeFromFit(fit: Layer['contentFit']): 'follow' | 'mask' | 'contain' {
  if (fit === 'fill') return 'mask';
  if (fit === 'crop') return 'contain';
  return 'follow';
}

function nativeLayerShapeState(layer: Layer): NativeLayerShapeState {
  const shape = layer.layerShape;
  const activeType = shape?.enabled ? shape.type : 'rectangle';
  const params = shape?.params ?? {};
  const invert = params.invert ? 1 : 0;

  if (activeType === 'custom') {
    const customPoints = params.customPoints ?? [];
    if (params.customClosed && customPoints.length >= 3) {
      // Flatten beziers, downsample to the 32-point budget, flip y once at
      // the boundary (editor y-up -> compositor local-UV y-down). The packed
      // array carries the CURRENT (dragged) outline in vec4 slots 0-15 and
      // the BASE outline in slots 16-31 so the compositor can content-follow
      // via mean-value coordinates.
      const flattenOutline = (source: typeof customPoints): Array<{ x: number; y: number }> => {
        const tessellated = tessellateNativeMaskShape(source as any);
        const count = Math.min(32, tessellated.length);
        const flat: Array<{ x: number; y: number }> = [];
        for (let index = 0; index < count; index++) {
          const sourceIndex = count === tessellated.length
            ? index
            : Math.min(tessellated.length - 1, Math.floor(index * tessellated.length / count));
          const point = tessellated[sourceIndex];
          flat.push({
            x: quantizeNative(clampNumber(Number(point.x), -1, 2)),
            y: quantizeNative(clampNumber(1 - Number(point.y), -1, 2)),
          });
        }
        return flat;
      };
      const flat = flattenOutline(customPoints);
      const basePoints = params.customBasePoints;
      let base = basePoints?.length ? flattenOutline(basePoints) : flat;
      // Topology changed (points added/removed, beziers bent): re-anchor the
      // content mapping to the current outline.
      if (base.length !== flat.length) base = flat;
      let bbMinX = 1; let bbMinY = 1; let bbMaxX = 0; let bbMaxY = 0;
      for (const point of flat) {
        bbMinX = Math.min(bbMinX, point.x);
        bbMinY = Math.min(bbMinY, point.y);
        bbMaxX = Math.max(bbMaxX, point.x);
        bbMaxY = Math.max(bbMaxY, point.y);
      }
      const packOutline = (points: Array<{ x: number; y: number }>): NativeVec4[] => {
        const packed: NativeVec4[] = [];
        for (let index = 0; index < points.length; index += 2) {
          const a = points[index];
          const b = points[index + 1] ?? points[index];
          packed.push([a.x, a.y, b.x, b.y]);
        }
        while (packed.length < 16) packed.push([0, 0, 0, 0]);
        return packed;
      };
      const contentMode = shapeContentModeFromFit(layer.contentFit);
      const fit = contentMode === 'mask' ? 0 : contentMode === 'contain' ? 2 : 1;
      const contentFollow = contentMode === 'follow';
      const shapePoints: NativeVec4[] = [
        ...packOutline(flat),
        ...(contentFollow ? packOutline(base) : []),
      ];
      const feather = quantizeNative(clampNumber(Number(params.feather ?? 0), 0, 1));
      const payload: NativeVec4 = [6, feather, 0, 1];
      const payload2: NativeVec4 = [
        quantizeNative(bbMinX),
        quantizeNative(bbMinY),
        quantizeNative(Math.max(0.0001, bbMaxX - bbMinX)),
        quantizeNative(Math.max(0.0001, bbMaxY - bbMinY)),
      ];
      const shapeMeta: NativeVec4 = [flat.length, invert, fit, contentFollow ? 3 : 0];
      return {
        shape: payload,
        shape2: payload2,
        shapeMeta,
        shapePoints,
        signature: [
          ...payload,
          ...payload2,
          ...shapeMeta,
          ...shapePoints.flat(),
        ].map((value) => Number(value).toFixed(5)).join(':'),
      };
    }
    // Open/incomplete custom shapes render as plain rectangles.
    return {
      shape: [0, 0, 0, 1],
      shape2: [1, 0.7, 6, 0.4],
      shapeMeta: [0, 0, 0, 0],
      shapePoints: [],
      signature: 'rect',
    };
  }

  // Polygon (hexagon) with vertex handles: the handles ARE the polygon's
  // vertices — render through the MVC surface path so mask and content
  // deform together per-vertex (same feel as the triangle).
  if (activeType === 'polygon' && (shape?.controlPoints?.length ?? 0) >= 3) {
    const vertices = shape!.controlPoints!;
    const n = Math.min(12, vertices.length);
    const current: Array<{ x: number; y: number }> = [];
    for (let index = 0; index < n; index++) {
      current.push({
        x: quantizeNative(clampNumber(Number(vertices[index].x), -1, 2)),
        y: quantizeNative(clampNumber(1 - Number(vertices[index].y), -1, 2)),
      });
    }
    if (current.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))) {
      // Base outline: the regular polygon the content was authored against.
      const rotationRad = (Number(params.rotation ?? 0) * Math.PI) / 180;
      const scale = clampNumber(Number(params.scale ?? 1), 0.0001, 8);
      const circumradius = (0.4 / Math.cos(Math.PI / n)) * scale;
      const base: Array<{ x: number; y: number }> = [];
      for (let index = 0; index < n; index++) {
        const angle = ((2 * index + 1) * Math.PI) / n + rotationRad;
        base.push({
          x: quantizeNative(0.5 + circumradius * Math.cos(angle)),
          y: quantizeNative(1 - (0.5 + circumradius * Math.sin(angle))),
        });
      }
      let bbMinX = 1; let bbMinY = 1; let bbMaxX = 0; let bbMaxY = 0;
      for (const point of current) {
        bbMinX = Math.min(bbMinX, point.x);
        bbMinY = Math.min(bbMinY, point.y);
        bbMaxX = Math.max(bbMaxX, point.x);
        bbMaxY = Math.max(bbMaxY, point.y);
      }
      const packOutline = (points: Array<{ x: number; y: number }>): NativeVec4[] => {
        const packed: NativeVec4[] = [];
        for (let index = 0; index < points.length; index += 2) {
          const a = points[index];
          const b = points[index + 1] ?? points[index];
          packed.push([a.x, a.y, b.x, b.y]);
        }
        while (packed.length < 16) packed.push([0, 0, 0, 0]);
        return packed;
      };
      const feather = quantizeNative(clampNumber(Number(params.feather ?? 0), 0, 1));
      const payload: NativeVec4 = [6, feather, 0, 1];
      const payload2: NativeVec4 = [
        quantizeNative(bbMinX),
        quantizeNative(bbMinY),
        quantizeNative(Math.max(0.0001, bbMaxX - bbMinX)),
        quantizeNative(Math.max(0.0001, bbMaxY - bbMinY)),
      ];
      const contentMode = shapeContentModeFromFit(layer.contentFit);
      const polyFit = contentMode === 'mask' ? 0 : contentMode === 'contain' ? 2 : 1;
      const polyFollow = contentMode === 'follow';
      const shapeMeta: NativeVec4 = [n, invert, polyFit, polyFollow ? 3 : 0];
      const shapePoints = [...packOutline(current), ...(polyFollow ? packOutline(base) : [])];
      return {
        shape: payload,
        shape2: payload2,
        shapeMeta,
        shapePoints,
        signature: [...payload, ...payload2, ...shapeMeta, ...shapePoints.flat()]
          .map((value) => Number(value).toFixed(5)).join(':'),
      };
    }
  }

  const unsupported =
    activeType === 'line' ||
    activeType === 'polyline';
  const shapeType =
    unsupported ? 0 :
    activeType === 'circle' ? 1 :
    activeType === 'triangle' ? 2 :
    activeType === 'ellipse' ? 3 :
    activeType === 'polygon' ? 4 :
    activeType === 'star' ? 5 :
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
  // Shape geometry params (mirrors the WebGL shape-mask uniforms):
  // [radiusX, radiusY, sides, innerRadius]
  const payload2: NativeVec4 = [
    quantizeNative(clampNumber(Number(params.radiusX ?? 1), 0.01, 4)),
    quantizeNative(clampNumber(Number(params.radiusY ?? 0.7), 0.01, 4)),
    clampNumber(Math.round(Number(params.sides ?? 6)), 3, 12),
    quantizeNative(clampNumber(Number(params.innerRadius ?? 0.4), 0.05, 1)),
  ];
  // Control-point warp (canvas warp handles). Circle uses 5 points
  // (quad corners + center focus); triangle uses its 3 vertices. Points are
  // layer-local with y up in the editor — flip once to compositor space.
  let warpKind = 0;
  const shapePoints: NativeVec4[] = [];
  const controlPoints = shape?.enabled ? shape.controlPoints : undefined;
  const quadWarpFamily =
    activeType === 'circle' || activeType === 'ellipse' || activeType === 'star';
  const requiredPoints = quadWarpFamily ? 5 : activeType === 'triangle' ? 3 : 0;
  if (requiredPoints > 0 && (controlPoints?.length ?? 0) >= requiredPoints) {
    const flat = controlPoints!.slice(0, requiredPoints).map((point) => ({
      x: quantizeNative(clampNumber(Number(point.x), -1, 2)),
      y: quantizeNative(clampNumber(1 - Number(point.y), -1, 2)),
    }));
    if (flat.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))) {
      warpKind = quadWarpFamily ? 1 : 2;
      for (let index = 0; index < flat.length; index += 2) {
        const a = flat[index];
        const b = flat[index + 1] ?? flat[index];
        shapePoints.push([a.x, a.y, b.x, b.y]);
      }
    }
  }
  const parametricFollow = shapeContentModeFromFit(layer.contentFit) !== 'mask';
  const shapeMeta: NativeVec4 = [0, shapeType > 0 ? invert : 0, parametricFollow ? 1 : 0, warpKind];
  return {
    shape: payload,
    shape2: payload2,
    shapeMeta,
    shapePoints,
    signature: [...payload, ...payload2, ...shapeMeta, ...shapePoints.flat()]
      .map((value, index) => Number(value).toFixed(index === 0 ? 0 : 5))
      .join(':'),
  };
}

const NATIVE_EDGE_EFFECT_LIMIT = 4;
const NATIVE_EDGE_BLEND_CODES: Record<string, number> = {
  normal: 0, add: 1, multiply: 2, screen: 3, overlay: 4, subtract: 5,
  difference: 6, lighten: 7, darken: 8, average: 9, hardlight: 10,
  softlight: 11, exclusion: 12, 'color-dodge': 13, 'color-burn': 14,
  hue: 15, saturation: 16, color: 17, luminosity: 18, divide: 19,
  negation: 20, phoenix: 21, 'linear-light': 22, 'hard-mix': 23,
  'vivid-light': 24, 'pin-light': 25,
};
const NATIVE_EDGE_STROKE_CODES: Record<string, number> = {
  none: 0, solid: 1, glow: 2, neon: 3, snake: 4, rainbow: 5,
  dashed: 6, dotted: 6, electric: 7, pulse: 8, scanner: 9, fire: 10,
};
const NATIVE_EDGE_FILL_CODES: Record<string, number> = {
  none: 0, solid: 1, plasma: 2, liquid: 3, fire: 4, electric: 5,
  holographic: 6, noise: 7, gradient: 8, radialGradient: 8,
};
const NATIVE_EDGE_ANIMATION_CODES: Record<string, number> = {
  none: 0, concentric: 1, breathe: 2, rotate: 3, radiate: 4,
  ripple: 5, wave: 6, glitch: 7,
};

function nativeEdgeRgba(value: unknown, fallback: NativeVec4): NativeVec4 {
  if (!Array.isArray(value)) return fallback;
  return [0, 1, 2, 3].map((index) =>
    quantizeNative(clampNumber(Number(value[index] ?? fallback[index]), 0, 1)),
  ) as NativeVec4;
}

function nativeEdgePaletteCode(value: unknown): number {
  const codes: Record<string, number> = {
    rainbow: 0, neon: 1, fire: 2, orange: 2, ocean: 3, blue: 3, green: 4, purple: 5,
  };
  return codes[String(value ?? '')] ?? 0;
}

/** Seven vec4s per effect form the stable UI-to-native compositor boundary. */
export function nativeLayerEdgeEffectsState(layer: Pick<Layer, 'edgeEffects'>): {
  packed: NativeVec4[][];
  signature: string;
} {
  if (!layer.edgeEffects?.enabled) return { packed: [], signature: 'none' };
  const packed = layer.edgeEffects.effects
    .filter((effect) => effect?.enabled !== false)
    .slice(0, NATIVE_EDGE_EFFECT_LIMIT)
    .map((effect): NativeVec4[] => {
      const stroke: any = effect.stroke ?? { type: 'none' };
      const fill: any = effect.fill ?? { type: 'none' };
      const animation: any = effect.animation ?? { type: 'none' };
      const strokeType = String(stroke.type ?? 'none');
      const fillType = String(fill.type ?? 'none');
      const animationType = String(animation.type ?? 'none');
      const strokeColor = nativeEdgeRgba(stroke.color, [1, 1, 1, 1]);
      let fillColor = nativeEdgeRgba(fill.color ?? fill.color1 ?? fill.baseColor, [1, 1, 1, 1]);
      let fillColor2 = nativeEdgeRgba(fill.color2, [0.1, 0.35, 1, 1]);
      if (Array.isArray(fill.stops) && fill.stops.length) {
        fillColor = nativeEdgeRgba(fill.stops[0]?.color, fillColor);
        fillColor2 = nativeEdgeRgba(fill.stops[fill.stops.length - 1]?.color, fillColor2);
      }
      const strokeParams: NativeVec4 = [
        quantizeNative(clampNumber(Number(stroke.width ?? 3), 0, 80)),
        quantizeNative(Number(stroke.glowSize ?? stroke.length ?? stroke.dashLength ?? stroke.arcIntensity ?? stroke.pulseCount ?? stroke.beamWidth ?? stroke.intensity ?? 0)),
        quantizeNative(Number(stroke.glowIntensity ?? stroke.speed ?? stroke.animationSpeed ?? stroke.gapLength ?? 1)),
        quantizeNative(Number(stroke.pulseSpeed ?? stroke.snakeCount ?? stroke.branches ?? stroke.fadeLength ?? stroke.trailLength ?? stroke.trail ?? 0)),
      ];
      const fillParams: NativeVec4 = [
        NATIVE_EDGE_FILL_CODES[fillType] ?? 0,
        quantizeNative(Number(fill.opacity ?? fill.scale ?? fill.viscosity ?? fill.intensity ?? fill.shiftAmount ?? fill.hueShift ?? fill.angle ?? 1)),
        quantizeNative(Number(fill.complexity ?? fill.turbulence ?? fill.arcCount ?? fill.scanlines ?? fill.octaves ?? fill.speed ?? fill.animationSpeed ?? 1)),
        quantizeNative(Number(fill.speed ?? fill.metallic ?? fill.flicker ?? nativeEdgePaletteCode(fill.palette))),
      ];
      const animationParams: NativeVec4 = [
        NATIVE_EDGE_ANIMATION_CODES[animationType] ?? 0,
        quantizeNative(Number(animation.speed ?? 0)),
        quantizeNative(Number(animation.count ?? animation.minScale ?? animation.rays ?? animation.wavelength ?? animation.frequency ?? animation.intensity ?? 0)),
        quantizeNative(Number(animation.spacing ?? animation.maxScale ?? animation.length ?? animation.amplitude ?? animation.rgbSplit ?? 0)),
      ];
      return [
        [1, quantizeNative(clampNumber(Number(effect.opacity ?? 1), 0, 1)), NATIVE_EDGE_BLEND_CODES[canonicalBlendMode(effect.blendMode)] ?? 0, NATIVE_EDGE_STROKE_CODES[strokeType] ?? 0],
        strokeColor,
        strokeParams,
        fillParams,
        fillColor,
        fillColor2,
        animationParams,
      ];
    });
  return { packed, signature: packed.length ? packed.flat(2).join(':') : 'none' };
}

function tessellateNativeMaskShape(points: NonNullable<Layer['mask']>['shapes'][number]['points']): Array<{ x: number; y: number }> {
  const output: Array<{ x: number; y: number }> = [];
  for (let index = 0; index < points.length; index++) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    output.push({ x: current.x, y: current.y });
    if (!current.cpOut && !next.cpIn) continue;
    const cp1 = current.cpOut ?? current;
    const cp2 = next.cpIn ?? next;
    for (let step = 1; step < 12; step++) {
      const t = step / 12;
      const mt = 1 - t;
      output.push({
        x: mt * mt * mt * current.x + 3 * mt * mt * t * cp1.x + 3 * mt * t * t * cp2.x + t * t * t * next.x,
        y: mt * mt * mt * current.y + 3 * mt * mt * t * cp1.y + 3 * mt * t * t * cp2.y + t * t * t * next.y,
      });
    }
  }
  return output;
}

export function nativeLayerMaskState(layer: Layer): NativeLayerMaskState {
  const mask = layer.mask;
  // A polygon of >= 3 points has an implicit last-to-first edge on the native
  // path, so `closed` is treated as the default rather than a hard requirement.
  // The mask editor UI omits the flag entirely, so requiring it here silently
  // stripped every mask shape and made the mask layer a translucent no-op.
  const shapes = mask?.enabled
    ? (mask.shapes ?? []).filter((shape) => shape.closed !== false && shape.points.length >= 3).slice(0, 8)
    : [];
  if (!mask?.enabled || shapes.length === 0) {
    return { info: [0, 0, 0, 0], points: [], signature: 'none' };
  }

  const packed: NativeVec4[] = [];
  for (let shapeIndex = 0; shapeIndex < shapes.length && packed.length < 64; shapeIndex++) {
    const tessellated = tessellateNativeMaskShape(shapes[shapeIndex].points);
    const remainingShapes = shapes.length - shapeIndex;
    const shapeBudget = Math.max(3, Math.floor((64 - packed.length) / remainingShapes));
    const count = Math.min(shapeBudget, tessellated.length);
    const start = packed.length;
    for (let index = 0; index < count; index++) {
      const sourceIndex = count === tessellated.length
        ? index
        : Math.min(tessellated.length - 1, Math.floor(index * tessellated.length / count));
      const point = tessellated[sourceIndex];
      const nextIndex = index + 1 < count ? start + index + 1 : start;
      packed.push([
        quantizeNative(point.x),
        // Mask anchors are stored in the editor's canvas coordinates, where
        // y=1 is the top edge. The compositor's layer-local UV uses y=0 at
        // the top, so convert exactly once at this boundary.
        quantizeNative(1 - point.y),
        nextIndex,
        shapeIndex,
      ]);
    }
  }
  const info: NativeVec4 = [
    packed.length >= 3 ? 1 : 0,
    mask.inverted ? 1 : 0,
    quantizeNative(clampNumber(Number(mask.feather ?? 0), 0, 1)),
    packed.length,
  ];
  const signature = `${info.join(':')}:${packed.map((point) => point.join(',')).join(';')}`;
  return { info, points: packed, signature };
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

function nativeReadableMediaUri(src: NonNullable<Layer['source']>): string {
  const fallbackSrc = String(src.src ?? '');
  const ref = (src as any)._assetRef ?? (src as any).assetRef;
  return resolveAssetRefForRuntime(ref, undefined, fallbackSrc) ?? fallbackSrc;
}

function nativeReadableFileParamUri(src: Record<string, any>): string {
  const fallbackSrc = typeof src.url === 'string' ? src.url : '';
  const ref = src.assetRef ?? src._assetRef;
  return resolveAssetRefForRuntime(ref, undefined, fallbackSrc) ?? fallbackSrc;
}

function isNativeLocalMediaUri(uri: string | undefined | null): boolean {
  const value = String(uri ?? '').trim();
  if (!value) return false;
  if (/^(blob:|data:|https?:)/i.test(value)) return false;
  if (/^(ghost-asset:\/\/|file:\/\/)/i.test(value)) return true;
  if (value.startsWith('/')) return true;
  if (/^[A-Za-z]:[\\/]/.test(value)) return true;
  return false;
}

function nativeLiveSourceType(
  src: NonNullable<Layer['source']>,
): NativeLiveSourceType | null {
  const explicit = String((src as any).liveSourceType ?? '').trim().toLowerCase();
  if (explicit === 'webcam' || explicit === 'capture' || explicit === 'syphon' || explicit === 'ndi') {
    return explicit;
  }
  if ((src as any).ndiSource) return 'ndi';
  if ((src as any).spoutSource || src.type === 'spout' || isSharedTextureUri(src.src)) return 'syphon';
  const uri = String(src.src ?? '').trim().toLowerCase();
  if (uri.startsWith('live://webcam/')) return 'webcam';
  if (uri.startsWith('live://capture/')) return 'capture';
  return null;
}

function nativeLiveSourceIdentity(src: NonNullable<Layer['source']>): string {
  const kind = nativeLiveSourceType(src);
  if (kind === 'webcam' || kind === 'capture') {
    // The addon session id is carried in the URI (`live://webcam/<session>`).
    // Prefer it over `src.id`: a VJ clip's `id` is the CLIP uuid, not the
    // capture session, so reading src.id there polls a session that does not
    // exist and the layer renders empty.
    const uri = String(src.src ?? '').trim();
    const match = /^live:\/\/(?:webcam|capture)\/(.+)$/i.exec(uri);
    const fromUri = match ? decodeURIComponent(match[1]).trim() : '';
    return String((src as any).liveSourceSessionId ?? fromUri ?? src.id ?? '').trim()
      || fromUri
      || String(src.id ?? '').trim();
  }
  if (kind === 'ndi') {
    const ndiSource = (src as any).ndiSource;
    if (typeof ndiSource === 'string') return ndiSource.trim();
    if (ndiSource && typeof ndiSource === 'object') {
      return String(ndiSource.sourceName ?? ndiSource.senderName ?? ndiSource.name ?? '').trim();
    }
    return '';
  }
  if (kind === 'syphon') return sharedTextureSenderName(src);
  return '';
}

/** Animated GIFs ride the native VIDEO pipeline: FFmpeg decodes them like
 *  any other looping clip, which gives full animation everywhere (preview,
 *  output, recording) instead of the static first frame the image path
 *  uploads. Unset playback state defaults to playing + looping, which is
 *  exactly GIF semantics; a single-frame GIF just loops its one frame. */
function isAnimatedGifUri(uri: string | null | undefined): boolean {
  return typeof uri === 'string' && /\.gif(\?|#|$)/i.test(uri);
}

function nativeMediaSourceUnsupportedReason(
  src: NonNullable<Layer['source']>,
  options: NativeUnsupportedSourceOptions = {},
): string | null {
  const liveSourceType = nativeLiveSourceType(src);
  if (liveSourceType) {
    return nativeLiveSourceIdentity(src)
      ? null
      : `${liveSourceType}:native-source-identity-required`;
  }
  const sourceType = isSharedTextureUri(src.src) ? 'video' : String(src.type || 'none').trim().toLowerCase();
  if (src.type === 'spout' || isSharedTextureUri(src.src)) return null;
  if (sourceType === 'shader') {
    return typeof src.shaderCode === 'string' && src.shaderCode.trim().length > 0
      ? null
      : 'shader:source-required';
  }
  if (sourceType === 'threejs' || sourceType === 'p5js' || sourceType === 'javascript') {
    return nativeShaderSourceFromJavascript(src.jsAnimation)
      ? null
      : `${sourceType}:native-scene-graph-required`;
  }
  if (sourceType === 'image' || sourceType === 'video') {
    const uri = nativeReadableMediaUri(src);
    if (!isNativeLocalMediaUri(uri)) return `${sourceType}:native-readable-uri-required`;
    const decodesAsVideo = sourceType === 'video' || (sourceType === 'image' && isAnimatedGifUri(uri));
    if (decodesAsVideo && !options.nativeVideoDecodePumpReady) {
      return 'video:native-decode-pump-required';
    }
    return null;
  }
  return `${sourceType || 'source'}:native-ingest-pending`;
}

function nativeFileSourceParamUnsupportedReason(src: Record<string, any>): string | null {
  const uri = nativeReadableFileParamUri(src);
  return isNativeLocalMediaUri(uri) ? null : 'file:native-readable-uri-required';
}

export function nativeLayerSourceFromMediaSource(
  src: NonNullable<Layer['source']>,
  previewElement: CanvasImageSource | null = null,
): NativeLayerSource {
  const liveSourceType = nativeLiveSourceType(src);
  if (liveSourceType) {
    const identity = nativeLiveSourceIdentity(src);
    return {
      id: src.id,
      uri: `native-live://${liveSourceType}/${encodeURIComponent(identity)}`,
      sourceType: `live:${liveSourceType}`,
      source: src,
      shouldPrefetch: false,
      shouldPreview: true,
      previewElement: null,
    };
  }
  const nativeJavascript = nativeShaderSourceFromJavascript(src.jsAnimation);
  const javascriptSource = nativeJavascript
    ? {
        ...src,
        type: 'shader' as const,
        src: `native-js://${src.id}/${hashString(nativeJavascript.shaderCode)}`,
        shaderCode: nativeJavascript.shaderCode,
        shaderValues: nativeJavascript.shaderValues,
      }
    : src;
  const uri = nativeReadableMediaUri(javascriptSource);
  const normalizedSrc = uri !== javascriptSource.src ? { ...javascriptSource, src: uri } : javascriptSource;
  const rawType = javascriptSource.type || 'none';
  const sourceType = isSharedTextureUri(uri)
    ? 'video'
    : rawType === 'image' && isAnimatedGifUri(uri)
      ? 'video'
      : rawType;
  const shouldPrefetch = sourceType === 'image' || sourceType === 'video';
  const shouldPreview = shouldPrefetch || !!previewElement;
  return {
    id: src.id,
    uri,
    sourceType,
    source: normalizedSrc,
    shouldPrefetch,
    shouldPreview,
    previewElement,
  };
}

function nativeGraphOutputSource(layer: Layer, kind: NativeGraphRouteKind): NativeLayerSource {
  const pluginKind = kind === 'ghostfx'
    || kind === 'handfx'
    || kind === 'performer-world'
    || kind === 'vj-crossfade'
    || kind === 'vj-mix';
  const effectType = String(layer.source?.effectSource?.effectType ?? kind).trim().toLowerCase();
  const shaderId = layer.gpuLayerContent?.shaderId || 'gpu';
  // Lines and SVG layers have no gpuLayerContent shader id. A generic `gpu`
  // suffix lets the core reuse a stale source frame when one graph-backed
  // layer replaces another, so keep their source identities kind-specific.
  const graphSourceId = kind === 'lines' || kind === 'svg' || kind === 'light-painting' || kind === 'text' || kind === 'splat' || kind === 'model3d'
    ? `gpu:${layer.id}:${kind}`
    : `gpu:${layer.id}:${shaderId}`;
  return {
    id: pluginKind ? `plugin:${layer.id}:${effectType}` : graphSourceId,
    uri: `native-graph://${kind}/${layer.id}`,
    sourceType: `gpu:${kind}`,
    source: null,
    shouldPrefetch: false,
    shouldPreview: false,
    previewElement: null,
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
    case 'lines':
      prefixes = [`lines:${safeSourceId}`];
      break;
    case 'svg':
      prefixes = [`svg:${safeSourceId}`];
      break;
    case 'light-painting':
      prefixes = [`light-painting:${safeSourceId}`];
      break;
    case 'text':
      prefixes = [`text:${safeSourceId}`];
      break;
    case 'splat':
      prefixes = [`splat:${safeSourceId}`];
      break;
    case 'model3d':
      prefixes = [`model3d:${safeSourceId}`];
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
    case 'ghostfx':
      prefixes = [`ghostfx:${safeSourceId}`];
      break;
    case 'handfx':
      prefixes = [`handfx:${safeSourceId}`];
      break;
    case 'performer-world':
      prefixes = [`performer-world:${safeSourceId}`];
      break;
    case 'vj-crossfade':
      prefixes = [`vjxfade:${safeSourceId}`];
      break;
    case 'vj-mix':
      prefixes = [`vjmix:${safeSourceId}`];
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

function scaledIntegerParam(
  params: Record<string, any>,
  key: string,
  scale: number,
  fallback: number,
  min: number,
): number {
  const raw = Number(params[key]);
  const base = Number.isFinite(raw) && raw > 0 ? raw : fallback;
  return Math.max(min, Math.round(base * scale));
}

function scaledSmokeGrid(gridSize: unknown, scale: number): 32 | 48 | 64 {
  const raw = Math.round(Number(gridSize));
  const base = raw === 32 || raw === 48 || raw === 64 ? raw : 48;
  if (scale <= 0.6) return 32;
  if (scale <= 0.8) return base >= 48 ? 48 : 32;
  return base === 64 ? 64 : base === 32 ? 32 : 48;
}

function nativeGraphQualityLabelForScale(scale: number, current: unknown): string {
  if (scale <= 0.6) return 'performance';
  if (scale <= 0.8) return 'balanced';
  if (scale <= 0.93) return 'high';
  return String(current || 'ultra');
}

function applyNativeGraphWorkloadScale(
  params: Record<string, any>,
  kind: NativeGraphRouteKind,
  scale: number,
): Record<string, any> {
  const safeScale = clampNumber(scale, 0.45, 1);
  if (safeScale >= 0.995) return params;
  const next = { ...params };
  switch (kind) {
    case 'smoke-3d':
      next.gridSize = scaledSmokeGrid(next.gridSize, safeScale);
      next.emitterCount = scaledIntegerParam(next, 'emitterCount', safeScale, 4, 1);
      next.shadowSteps = Math.max(0, Math.round((Number(next.shadowSteps) || 4) * safeScale));
      break;
    case 'smoke-riders':
      next.quality = nativeGraphQualityLabelForScale(safeScale, next.quality);
      next.emitters = scaledIntegerParam(next, 'emitters', safeScale, 5, 1);
      next.sphereCount = scaledIntegerParam(next, 'sphereCount', safeScale, 192, 1);
      break;
    case 'ink-cloud':
      next.particleCount = scaledIntegerParam(next, 'particleCount', safeScale, 150_000, 1024);
      next.emitterCount = scaledIntegerParam(next, 'emitterCount', safeScale, 4, 1);
      break;
    case 'flythrough':
      next.particleCount = scaledIntegerParam(next, 'particleCount', safeScale, 250_000, 1024);
      next.slabCount = scaledIntegerParam(next, 'slabCount', Math.max(0.5, safeScale), 4, 1);
      break;
    case 'pixel-particles':
      next.particleCount = scaledIntegerParam(next, 'particleCount', safeScale, 250_000, 1024);
      break;
    case 'particle-field':
      next.particleCount = scaledIntegerParam(next, 'particleCount', safeScale, 80_000, 1024);
      next.partnerCount = scaledIntegerParam(next, 'partnerCount', safeScale, 6, 1);
      next.gravityWells = scaledIntegerParam(next, 'gravityWells', Math.max(0.65, safeScale), 3, 1);
      break;
    case 'volumetric-spheres':
      next.sphereCount = scaledIntegerParam(next, 'sphereCount', safeScale, 192, 1);
      break;
    default:
      break;
  }
  return next;
}

function nativeGraphParamsForLayer(layer: Layer, kind: NativeGraphRouteKind, workloadScale = 1): Record<string, any> {
  const params: Record<string, any> = kind === 'ghostfx'
    || kind === 'handfx'
    || kind === 'performer-world'
    || kind === 'vj-crossfade'
    || kind === 'vj-mix'
    ? layer.source?.effectSource ?? {}
    : layer.gpuLayerContent?.params ?? {};
  const shaderId = String(layer.gpuLayerContent?.shaderId || '').trim().toLowerCase();
  if (kind === 'particle-field' && shaderId === 'gravity-wells') {
    return applyNativeGraphWorkloadScale({
      ...gravityWellsDefaultParams,
      ...params,
      mode: params.mode ?? gravityWellsDefaultParams.mode ?? 'gravity',
    }, kind, workloadScale);
  }
  return applyNativeGraphWorkloadScale(params, kind, workloadScale);
}

function nativePointCloudBufferBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
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
    _assetRef: item._assetRef,
  } as NonNullable<Layer['source']>;
  return nativeLayerSourceFromMediaSource(source, previewElement);
}

function fileSourceParamToNativeLayerSource(layer: Layer, src: Record<string, any>): NativeLayerSource | null {
  const url = nativeReadableFileParamUri(src);
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
    // Supported GPU layers are routed through nativeGraphOutputSource before
    // this point. Unsupported GPU shaders intentionally stay blank in native
    // output instead of smuggling in the WebGPU preview canvas.
    return {
      id: `gpu:${layer.id}:${shaderId}`,
      uri: '',
      sourceType: 'none',
      source: null,
      shouldPrefetch: false,
      shouldPreview: false,
      previewElement: null,
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
  if (nativeUnsupportedEffectTypes(layer).length > 0) return false;
  // The decoder advances local videos inside the core, but effect-pass
  // graphs are still queued by this sync heartbeat. Keep every supported
  // effect chain ticking so it consumes newly decoded source textures rather
  // than preserving a black first pass submitted before pre-roll completed.
  if (nativeEffectPassesForLayer(layer)?.length) return true;
  if (layer.type === 'gpu' && layer.gpuLayerContent) {
    const shaderId = String(layer.gpuLayerContent.shaderId || '').trim().toLowerCase();
    if (isNativeReadyGpuShaderId(shaderId)) return true;
  }
  if (layer.source?.type === 'shader' && layer.source?.shaderCode) return true;
  if (layer.type === 'gpu' && !!layer.gpuLayerContent) {
    return true;
  }

  const src = layer.source;
  if (src && nativeLiveSourceType(src)) return true;
  if (src?.jsAnimation && nativeShaderSourceFromJavascript(src.jsAnimation)) return true;
  if (src?.type === 'video' && isNativeLocalMediaUri(nativeReadableMediaUri(src))) return true;
  if (
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
  if (nativeLiveSourceType(src) !== 'syphon') return '';
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
  if (nativeLiveSourceType(src)) return true;
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

// The Canvas-owned live sync instance, registered on start() so UI surfaces
// (media library hover-arming) can reach the active session without threading
// the instance through props.
let activeNativeRendererSync: NativeRendererSync | null = null;

/** The running sync instance (Canvas owns its lifecycle). Offline render
 *  uses this to drive native graph content from the virtual clock. */
export function getActiveNativeRendererSync(): NativeRendererSync | null {
  return activeNativeRendererSync;
}

type NativeLibraryVideoArmRequest = {
  id: string;
  src: string;
  /** Asset registry ref — REQUIRED to resolve a core-readable uri for
   *  imported media whose `src` is a browser blob: URL. */
  assetRef?: unknown;
  videoElement?: HTMLVideoElement | null;
  seekGeneration?: number;
  playbackRate?: number;
  playbackMode?: 'loop' | 'once';
  durationSeconds?: number;
  trimStart?: number;
  trimEnd?: number;
};

const pendingLibraryVideoArms = new Map<string, NativeLibraryVideoArmRequest>();
const armedLibraryVideoAt = new Map<string, number>();
const armedLibraryVideoSignatures = new Map<string, string>();
const LIBRARY_ARM_REFRESH_MS = 20_000;
const NATIVE_LIBRARY_TRIGGER_SEEK_GENERATION = 1;

function nativeLibraryArmGeneration(item: NativeLibraryVideoArmRequest): number {
  const generation = Number(item.seekGeneration ?? NATIVE_LIBRARY_TRIGGER_SEEK_GENERATION);
  return Number.isFinite(generation) ? Math.max(0, Math.floor(generation)) : 1;
}

function nativeLibraryArmKey(item: NativeLibraryVideoArmRequest): string {
  return `${item.id}\u0000${nativeLibraryArmGeneration(item)}`;
}

function nativeLibraryArmSignature(item: NativeLibraryVideoArmRequest): string {
  const trimStart = Math.max(0, Math.min(1, Number(item.trimStart ?? 0)));
  const trimEnd = Math.max(trimStart, Math.min(1, Number(item.trimEnd ?? 1)));
  const duration = Number(item.durationSeconds ?? item.videoElement?.duration);
  return JSON.stringify([
    item.src,
    Number(item.playbackRate ?? 1) || 1,
    item.playbackMode ?? 'loop',
    Number.isFinite(duration) && duration > 0 ? duration : null,
    trimStart,
    trimEnd,
    nativeLibraryArmGeneration(item),
  ]);
}

function prefetchArmedLibraryVideo(
  sync: NativeRendererSync,
  item: NativeLibraryVideoArmRequest,
  force = false,
): void {
  if (!sync.canArmLibraryVideos()) return;
  const now = Date.now();
  const armKey = nativeLibraryArmKey(item);
  const signature = nativeLibraryArmSignature(item);
  if (
    !force &&
    armedLibraryVideoSignatures.get(armKey) === signature &&
    now - (armedLibraryVideoAt.get(armKey) ?? 0) < LIBRARY_ARM_REFRESH_MS
  ) {
    return;
  }
  armedLibraryVideoAt.set(armKey, now);
  armedLibraryVideoSignatures.set(armKey, signature);
  const duration = Number(item.durationSeconds ?? item.videoElement?.duration);
  const durationSeconds = Number.isFinite(duration) && duration > 0 ? duration : undefined;
  const trimStart = Math.max(0, Math.min(1, Number(item.trimStart ?? 0)));
  const trimEnd = Math.max(trimStart, Math.min(1, Number(item.trimEnd ?? 1)));
  const trimStartSeconds = durationSeconds ? durationSeconds * trimStart : 0;
  const syntheticSrc = {
    id: item.id,
    src: item.src,
    _assetRef: item.assetRef,
    type: 'video',
    videoElement: item.videoElement ?? undefined,
    playbackRate: Number(item.playbackRate ?? 1) || 1,
    playbackMode: item.playbackMode ?? 'loop',
    durationSeconds,
    trimStart,
    trimEnd,
    _nativePlaybackTimeSeconds: trimStartSeconds,
    _nativePlaybackSeekSeq: nativeLibraryArmGeneration(item),
  } as unknown as NonNullable<Layer['source']>;
  const options = sync.libraryVideoPrefetchOptions(syntheticSrc);
  // The core's decoder reads files, not the browser's blob: object URLs —
  // resolve through the asset registry exactly like real layer playback
  // does. Arming with a raw blob: src spawns a session that dies on its
  // first read, which is why the warm pool sat empty ("armed:1 → 0").
  const readableUri = nativeReadableMediaUri(syntheticSrc);
  if (!isNativeLocalMediaUri(readableUri)) {
    armedLibraryVideoAt.delete(armKey);
    armedLibraryVideoSignatures.delete(armKey);
    return;
  }
  void prefetchNativeRendererMedia(
    `library:${item.id}:g${nativeLibraryArmGeneration(item)}`,
    readableUri,
    1,
    'video',
    options,
  ).catch(
    () => {
      armedLibraryVideoAt.delete(armKey);
      armedLibraryVideoSignatures.delete(armKey);
    },
  );
}

function flushPendingLibraryVideoArms(sync: NativeRendererSync): void {
  for (const item of pendingLibraryVideoArms.values()) {
    prefetchArmedLibraryVideo(sync, item, true);
  }
}

/**
 * Pre-arm a media-library video BEFORE the user commits to placing it
 * (pointer-enter / drag-start). The core pre-rolls a paused decoder under a
 * `library:` source id; when a click later binds the real source, the core's
 * warm-claim hands the prerolled session over by signature match, so
 * trigger-to-first-motion is one frame instead of a decoder cold start —
 * required for triggering clips in sync with music.
 *
 * Fire-and-forget and safe to over-call: re-arms are debounced per item, and
 * core-side the armed-session cap plus orphan GC bound the pool.
 */
export function armNativeLibraryVideo(item: NativeLibraryVideoArmRequest): void {
  if (!item?.id || !item?.src) return;
  const armKey = nativeLibraryArmKey(item);
  for (const [key, pending] of pendingLibraryVideoArms) {
    if (pending.id !== item.id || key === armKey) continue;
    pendingLibraryVideoArms.delete(key);
    armedLibraryVideoAt.delete(key);
    armedLibraryVideoSignatures.delete(key);
  }
  pendingLibraryVideoArms.set(armKey, item);
  if (activeNativeRendererSync) {
    prefetchArmedLibraryVideo(activeNativeRendererSync, item);
  }
}

export class NativeRendererSync {
  private running = false;
  private startupReady = false;
  private lifecycleGeneration = 0;
  private frameId = 0;
  private pendingSync = false;
  private pendingSyncTimer: ReturnType<typeof setTimeout> | null = null;
  private flushInFlight = false;
  private flushAgain = false;
  private urgentVideoRevision = 0;
  private desiredWidth = 0;
  private desiredHeight = 0;
  private latestLayers: Layer[] = [];
  // RAF id for the shader uniform-animation loop. Previously a setInterval
  // which kept firing even when the page was hidden or minimised — RAF
  // auto-pauses on tab visibility and lines up with the compositor so uniform
  // uploads aren't done just to be thrown away.
  private shaderAnimationRaf: number | null = null;
  private lastCompositeEffectsSig: string | null = null;
  private lastOutputStageSig: string | null = null;
  private lastSliceOutputsSig: string | null = null;
  private openSliceWindowIds: string[] = [];
  private displayBounds = new Map<number, { width: number; height: number; scaleFactor: number }>();
  private sliceWindowPoll: ReturnType<typeof setInterval> | null = null;
  private compositeEffectsFrame: number | null = null;
  private lastOutputBlackout: boolean | null = null;
  private lastOutputFrozen: boolean | null = null;
  private outputStateUnsubs: Array<() => void> = [];
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
  private armedVjSources = new Set<string>();
  private videoMetadataWatches = new WeakSet<HTMLVideoElement>();
  private videoRefreshAt = new Map<string, number>();
  private nativeVideoPrefetchAt = new Map<string, number>();
  private sourcePreviewSeq = new Map<string, number>();
  // Text layers: CPU-rasterized glyph atlas + cached layout, re-uploaded
  // only when the text signature changes (never per frame).
  private nativeTextState = new Map<string, {
    atlasSig: string;
    atlasSeq: number;
    atlasUploaded: boolean;
    atlas: TextNativeAtlas | null;
    layoutKey: string;
    letters: TextGlyphMetric[];
  }>();

  // Splat layers: parsed + packed point buffers, uploaded once per file.
  private nativeSplatState = new Map<string, {
    fileSig: string;
    uploadedSig: string;
    loading: boolean;
    packed: { buffer: Float32Array; pointCount: number } | null;
    textureSig: string;
    textureUploadedSig: string;
    texture: { rgba: Uint8ClampedArray; width: number; height: number } | null;
    textureSeq: number;
    textureVideo: HTMLVideoElement | null;
    textureCanvas: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; width: number; height: number } | null;
    textureVideoUploadedAt: number;
    /** Set by requestVideoFrameCallback whenever the element presented a
     *  new frame, so uploads pace to the video, not a timer. */
    textureVideoFrameReady: boolean;
  }>();

  private nativeSplatStateFor(layerId: string) {
    let state = this.nativeSplatState.get(layerId);
    if (!state) {
      state = {
        fileSig: '', uploadedSig: '', loading: false, packed: null,
        textureSig: '', textureUploadedSig: '', texture: null, textureSeq: 0,
        textureVideo: null, textureCanvas: null, textureVideoUploadedAt: 0,
        textureVideoFrameReady: false,
      };
      this.nativeSplatState.set(layerId, state);
    }
    return state;
  }

  private releaseNativeSplatTextureVideo(state: {
    textureVideo: HTMLVideoElement | null;
    textureCanvas: unknown | null;
  }) {
    if (state.textureVideo) {
      try {
        state.textureVideo.pause();
        state.textureVideo.removeAttribute('src');
        state.textureVideo.load();
      } catch { /* already detached */ }
      state.textureVideo = null;
    }
    state.textureCanvas = null;
  }

  /** Load the splat projection texture. Images decode once; videos become a
   *  looping muted element that the splat route pumps into the texture
   *  source frame every frame (same canvas transport the composite mirror
   *  uses — the panel stores texturePath as a data URL, so the core's own
   *  video decoder can't take it directly). */
  private async loadNativeSplatTexture(layerId: string, content: SplatContent, textureSig: string) {
    const state = this.nativeSplatStateFor(layerId);
    const path = String(content.texturePath ?? '');
    try {
      const MAX_DIM = 512;
      const makeCanvas = (srcW: number, srcH: number) => {
        const scale = Math.min(1, MAX_DIM / Math.max(srcW, srcH));
        const w = Math.max(2, Math.round(srcW * scale));
        const h = Math.max(2, Math.round(srcH * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        return ctx ? { canvas, ctx, width: w, height: h } : null;
      };
      if (content.textureType === 'video') {
        // Looping element pumped through a canvas, paced by
        // requestVideoFrameCallback so uploads track presented frames
        // instead of beating against a wall-clock throttle.
        const video = document.createElement('video');
        video.muted = true;
        video.playsInline = true;
        video.loop = true;
        video.src = path;
        await new Promise<void>((resolve, reject) => {
          video.onloadeddata = () => resolve();
          video.onerror = () => reject(new Error('video load failed'));
        });
        if (state.textureSig !== textureSig) return; // superseded
        const target = makeCanvas(video.videoWidth || 2, video.videoHeight || 2);
        if (!target) return;
        this.releaseNativeSplatTextureVideo(state);
        state.textureVideo = video;
        state.textureCanvas = target;
        state.textureVideoUploadedAt = 0;
        // First frame immediately so the texture shows before playback ticks.
        target.ctx.drawImage(video, 0, 0, target.width, target.height);
        state.texture = {
          rgba: target.ctx.getImageData(0, 0, target.width, target.height).data,
          width: target.width,
          height: target.height,
        };
        state.textureUploadedSig = '';
        const onVideoFrame = () => {
          if (state.textureVideo !== video) return; // released
          state.textureVideoFrameReady = true;
          video.requestVideoFrameCallback(onVideoFrame);
        };
        if (typeof video.requestVideoFrameCallback === 'function') {
          video.requestVideoFrameCallback(onVideoFrame);
        } else {
          state.textureVideoFrameReady = true; // legacy: fall back to throttle
        }
        void video.play().catch(() => { /* still shows the first frame */ });
      } else {
        const image = new Image();
        image.src = path;
        await image.decode();
        if (state.textureSig !== textureSig) return; // superseded
        const target = makeCanvas(image.naturalWidth || 2, image.naturalHeight || 2);
        if (!target) return;
        this.releaseNativeSplatTextureVideo(state);
        target.ctx.drawImage(image, 0, 0, target.width, target.height);
        state.texture = {
          rgba: target.ctx.getImageData(0, 0, target.width, target.height).data,
          width: target.width,
          height: target.height,
        };
        state.textureUploadedSig = '';
      }
    } catch (err) {
      console.warn('[NativeRendererSync] splat texture load failed', layerId, err);
    }
  }

  private async loadNativeSplatPoints(layerId: string, content: SplatContent, fileSig: string) {
    const state = this.nativeSplatStateFor(layerId);
    const originalName = String((content as { _originalFileName?: string })._originalFileName ?? content.filePath);
    const isSplat = /\.splat(\?|$)/i.test(originalName);
    const sourceLabel = originalName.split('/').pop() || (isSplat ? 'Gaussian splat' : 'Point cloud');
    const { beginOwnedLoading, updateOwnedLoading, endOwnedLoading } = await import('$lib/stores/loading');
    const { loadPLY } = await import('$lib/splat/plyLoader');
    const { loadSplatFromUrl } = await import('$lib/splat/splatLoader');
    const owner = beginOwnedLoading(`Loading ${sourceLabel}`, 0, 'Reading source data');
    try {
      const density = Math.min(1, Math.max(0.01, Number(content.pointDensity) || 1));
      const maxPoints = Math.max(1000, Math.round(SPLAT_NATIVE_MAX_POINTS * density));
      const onProgress = (event: { phase: 'read' | 'parse'; progress: number; sourceVertexCount?: number; loadedVertexCount?: number }) => {
        const progress = event.phase === 'read' ? event.progress * 0.15 : 0.15 + event.progress * 0.7;
        const detail = event.phase === 'read'
          ? 'Reading source data'
          : event.sourceVertexCount
            ? `Parsing ${Math.min(event.loadedVertexCount ?? 0, event.sourceVertexCount).toLocaleString()} of ${event.sourceVertexCount.toLocaleString()} points`
            : 'Parsing point data';
        updateOwnedLoading(owner, `Loading ${sourceLabel}`, progress, detail);
      };
      const plyData = isSplat
        ? await loadSplatFromUrl(content.filePath, { maxPoints, onProgress })
        : await loadPLY(content.filePath, { maxPoints, onProgress });
      if (state.fileSig !== fileSig) return; // superseded
      updateOwnedLoading(owner, `Loading ${sourceLabel}`, 0.88, 'Packing GPU point buffer');
      const pointData = pointCloudBuffersFromPLYData(plyData, { maxPoints });
      if (state.fileSig !== fileSig) return; // superseded
      state.packed = packSplatNativePoints(pointData);
      state.uploadedSig = '';
      // Surface the real counts in the panel (the release UI expects the
      // renderer that owns parsing to report them).
      try {
        const { project } = await import('$lib/stores/layers');
        project.updateSplatContent(layerId, {
          pointCount: pointData.sourceVertexCount ?? state.packed.pointCount,
          activePointCount: state.packed.pointCount,
        } as Partial<SplatContent>);
      } catch { /* store unavailable in tests */ }
    } catch (err) {
      console.warn('[NativeRendererSync] native splat point load failed', layerId, err);
    } finally {
      endOwnedLoading(owner);
      if (state.fileSig === fileSig) state.loading = false;
    }
  }

  // 3D model layers: flattened mesh + baked texture, uploaded once per file.
  private nativeModel3DState = new Map<string, {
    fileSig: string;
    meshUploadedSig: string;
    textureUploadedSig: string;
    textureSeq: number;
    mesh: Model3DNativeMesh | null;
  }>();

  private nativeModel3DStateFor(layerId: string) {
    let state = this.nativeModel3DState.get(layerId);
    if (!state) {
      state = { fileSig: '', meshUploadedSig: '', textureUploadedSig: '', textureSeq: 0, mesh: null };
      this.nativeModel3DState.set(layerId, state);
    }
    return state;
  }

  private async loadNativeModel3DMesh(layerId: string, content: Model3DContent, fileSig: string) {
    const state = this.nativeModel3DStateFor(layerId);
    const label = content.modelName || 'model';
    const { beginOwnedLoading, updateOwnedLoading, endOwnedLoading } = await import('$lib/stores/loading');
    const owner = beginOwnedLoading(`Loading ${label}`, 0, 'Reading model data');
    try {
      const mesh = await loadModel3DNativeMesh(content.modelData!, content.modelFormat, (progress, detail) => {
        updateOwnedLoading(owner, `Loading ${label}`, progress, detail);
      });
      if (state.fileSig !== fileSig) return; // superseded
      state.mesh = mesh;
      state.meshUploadedSig = '';
      state.textureUploadedSig = '';
      try {
        const { project } = await import('$lib/stores/layers');
        (project as unknown as { updateModel3DContent?: (id: string, updates: Partial<Model3DContent>) => void })
          .updateModel3DContent?.(layerId, {
            vertexCount: mesh.sourceVertexCount,
            faceCount: mesh.faceCount,
          });
      } catch { /* store unavailable in tests */ }
    } catch (err) {
      console.warn('[NativeRendererSync] native model3d mesh load failed', layerId, err);
    } finally {
      endOwnedLoading(owner);
    }
  }

  private nativeTextStateFor(layerId: string) {
    let state = this.nativeTextState.get(layerId);
    if (!state) {
      state = { atlasSig: '', atlasSeq: 0, atlasUploaded: false, atlas: null, layoutKey: '', letters: [] };
      this.nativeTextState.set(layerId, state);
    }
    return state;
  }
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
  private nativeVideoDecodePending = new Map<string, NativeVideoDecodeState>();
  private nativeVideoDecodeBypass = new Set<string>();
  private nativeVideoLastDecodeFailures = 0;
  private nativeVideoLastDecodes = 0;
  private nativeVideoDecodeWarnings = 0;
  private nativeVideoPlaybackState = new Map<string, NativeVideoPlaybackSyncState>();
  private nativeVideoDecodeDimensionCache = new Map<string, { width: number; height: number; metadata: boolean }>();
  private nativeSourceAspectCache = new Map<string, number>();
  private previewImageElements = new Map<string, HTMLImageElement>();
  private previewImageLoads = new Set<string>();
  private nativeComputeGraphSourceFrames = false;
  private nativeGraphCatalogComplete = false;
  private nativeGraphReadyKinds = new Set<NativeGraphRouteKind>();
  private nativeEffectPassDescriptorIds = new Set<string>();
  private nativeGraphRoutes = new Map<string, NativeGraphRouteState>();
  private nativeGraphRouteFailures = 0;
  private nativeGraphRouteSuppressedFailures = 0;
  private nativeGraphRouteLastFailure: string | null = null;
  private nativeBlockedLayerCount = 0;
  private nativeBlockedEffectLayerCount = 0;
  private nativeBlockedSourceLayerCount = 0;
  private nativeBlockedLayerLastReason: string | null = null;
  private nativePointCloudDataCache = new Map<string, Promise<PointCloudFXNativePointData>>();
  private nativePointCloudUploadSignatures = new Map<string, string>();
  private nativeSourceFrameSize = SOURCE_FRAME_SIZE_FALLBACK;
  private latestNativeStatus: RendererStatus | null = null;
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
  private statusPollInFlight = false;
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
  private lastStatusLogAt = 0;
  private lastStatusFrameCount = 0;
  private lastStatusPreviewFrameCount = 0;
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

  private resetNativeVideoDecodeTracking() {
    this.nativeVideoDecodePending.clear();
    this.nativeVideoDecodeBypass.clear();
    this.nativeVideoLastDecodeFailures = 0;
    this.nativeVideoLastDecodes = 0;
    this.nativeVideoDecodeWarnings = 0;
    this.nativeVideoPlaybackState.clear();
  }

  private resetNativeGraphRouteTelemetry() {
    this.nativeGraphRouteFailures = 0;
    this.nativeGraphRouteSuppressedFailures = 0;
    this.nativeGraphRouteLastFailure = null;
  }

  /** True when any of this layer's graph route keys has hit the 3-failure
   *  disable. Used to surface a distinct `route-failed` block reason. */
  private layerRouteDisabledByFailures(layer: Layer): boolean {
    if (layer.type !== 'gpu' || !layer.gpuLayerContent) return false;
    for (const [key, state] of this.nativeGraphRoutes) {
      if ((state.warnings ?? 0) >= 3 && key.includes(layer.id)) return true;
    }
    return false;
  }

  private recordNativeGraphRouteFailure(
    route: Pick<NativeGraphLayerRoute, 'kind' | 'key'>,
    layerId: string,
    err: unknown,
    routeState: NativeGraphRouteState,
  ) {
    const message = err instanceof Error ? err.message : String(err);
    const summary = `${route.kind}:${layerId}:${message}`.slice(0, 240);
    if (routeState.warnings < 3) {
      console.warn(`[NativeRendererSync] native ${route.kind} graph failed`, layerId, err);
    } else {
      this.nativeGraphRouteSuppressedFailures += 1;
    }
    routeState.warnings += 1;
    if (routeState.warnings === 3) {
      nativeFailedRouteLayers.update((ids) => (ids.includes(layerId) ? ids : [...ids, layerId]));
      // The kill switch used to trip silently AND suppress its own warnings,
      // so a failing layer just looked blank with a normal panel row. Say it
      // once, loudly, with the actual error — this is the line to search for
      // when a layer "mysteriously" stops rendering.
      console.error(
        `[NativeRendererSync] ${route.kind} route for layer ${layerId} DISABLED after 3 failures — `
        + `the layer will stay blank until it is edited or the app restarts. Last error: ${message}`,
      );
    }
    this.nativeGraphRouteFailures += 1;
    this.nativeGraphRouteLastFailure = summary;
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
        // Interpolated, not passed as an object: the Electron console
        // bridge stringifies extra args to "[object Object]", which hid the
        // core's actual rejection reason — the only useful part.
        console.warn(
          '[NativeRendererSync] native shared texture import rejected; retrying metadata/upload'
          + ` delta=${rejected - this.sharedTextureLastRejectedUploads}`
          + ` sources=${pending.map(([, upload]) => upload.sourceId).join(',')}`
          + ` reason=${status.source_frame_last_reject_reason || '(none reported)'}`,
        );
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
        console.warn('[NativeRendererSync] native image decode failed; source remains unavailable in native-only mode', {
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

  private reconcileNativeVideoDecodes(status: RendererStatus) {
    const failures = Number(status.native_video_frame_decode_failures ?? 0);
    const decodes = Number(status.native_video_frame_decodes ?? 0);
    if (!Number.isFinite(failures) || !Number.isFinite(decodes)) return;

    if (
      failures < this.nativeVideoLastDecodeFailures ||
      decodes < this.nativeVideoLastDecodes
    ) {
      this.nativeVideoLastDecodeFailures = Math.max(0, failures);
      this.nativeVideoLastDecodes = Math.max(0, decodes);
      this.nativeVideoDecodePending.clear();
      return;
    }

    if (failures > this.nativeVideoLastDecodeFailures) {
      const pending = Array.from(this.nativeVideoDecodePending.entries());
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
        this.nativeVideoDecodeBypass.add(sourceKey);
      }
      if (pending.length && this.nativeVideoDecodeWarnings < 5) {
        console.warn('[NativeRendererSync] native video decode pump failed; source remains unavailable in native-only mode', {
          failureDelta: failures - this.nativeVideoLastDecodeFailures,
          pendingSources: pending.map(([, decode]) => decode.sourceId),
          error: status.native_video_frame_decode_last_error,
        });
        this.nativeVideoDecodeWarnings += 1;
      }
      this.nativeVideoDecodePending.clear();
    } else if (decodes > this.nativeVideoLastDecodes) {
      this.nativeVideoDecodePending.clear();
    }

    this.nativeVideoLastDecodeFailures = failures;
    this.nativeVideoLastDecodes = decodes;
  }

  private syncNativeSourceFrameSize(status: RendererStatus | null) {
    const size = Number(status?.source_frame_size ?? SOURCE_FRAME_SIZE_FALLBACK);
    this.nativeSourceFrameSize = clampNumber(Math.round(size), 512, 4096);
    this.dynamicSourceFrameCaptureSize = this.nativeSourceFrameSize;
  }

  private nativeGraphWorkloadScale(): number {
    const scale = Number(this.latestNativeStatus?.native_quality?.quality_scale ?? 0);
    return Number.isFinite(scale) && scale > 0 ? clampNumber(scale, 0.45, 1) : 0.72;
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
    const unsupportedSourceOptions = {
      nativeVideoDecodePumpReady: this.nativeVideoDecodePumpReady(),
    };

    if (sourceParam.type === 'media' && sourceParam.mediaId) {
      const item = get(mediaLibrary).find((media: MediaItem) => media.id === sourceParam.mediaId);
      if (!item) return null;
      const source = mediaItemToNativeLayerSource(item);
      return source.source && !nativeMediaSourceUnsupportedReason(source.source, unsupportedSourceOptions) ? source : null;
    }

    if (sourceParam.type === 'layer' && sourceParam.layerId) {
      const layers = this.latestLayers.length ? this.latestLayers : get(project).layers;
      const sourceLayer = layers.find((candidate) => candidate.id === sourceParam.layerId);
      if (!sourceLayer?.source) return null;
      const source = nativeLayerSourceFromMediaSource(sourceLayer.source);
      return source.source && !nativeMediaSourceUnsupportedReason(source.source, unsupportedSourceOptions) ? source : null;
    }

    if (sourceParam.type === 'file') {
      if (nativeFileSourceParamUnsupportedReason(sourceParam)) return null;
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
          const pointData = isSplat
            ? pointCloudBuffersFromPLYData(parseSplatBuffer(buffer), {
                maxPoints: NATIVE_POINT_CLOUD_MAX_POINTS,
                maxGaussianPoints: POINT_CLOUD_FX_NATIVE_DEPTH_SORT_MAX_POINTS,
              })
            : parsePLYPointBuffers(buffer, {
                maxPoints: NATIVE_POINT_CLOUD_MAX_POINTS,
                maxGaussianPoints: POINT_CLOUD_FX_NATIVE_DEPTH_SORT_MAX_POINTS,
              });
          if (!pointData.sampleCount) {
            throw new Error('point cloud source contained no vertices');
          }
          return buildPointCloudFXNativePointData(pointData.positions, pointData.colors, {
            maxPoints: NATIVE_POINT_CLOUD_MAX_POINTS,
            alpha: pointData.alpha,
            splatScale: pointData.gaussian ? pointData.splatScale : undefined,
            splatRotation: pointData.gaussian ? pointData.splatRotation : undefined,
            sphericalHarmonicsRest: pointData.sphericalHarmonicsRest,
            sphericalHarmonicsRestStride: pointData.sphericalHarmonicsRestStride,
            gaussian: pointData.gaussian,
            signature: [
              cacheKey,
              buffer.byteLength,
              pointData.sourceVertexCount,
              pointData.sampleCount,
              pointData.gaussian ? 'gaussian' : 'points',
              `sh${pointData.sphericalHarmonicsDegree}:${pointData.sphericalHarmonicsCoefficientCount}`,
            ].join(':'),
            sphericalHarmonicsDegree: pointData.sphericalHarmonicsDegree,
            sphericalHarmonicsCoefficientCount: pointData.sphericalHarmonicsCoefficientCount,
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
    if (!inputSource.source || !inputSource.sourceType || inputSource.sourceType === 'none') return null;
    // FS/ISF shader sources are rendered BY the core into the layer's frame
    // slot — they never pass the upload/decode readiness checks, but their
    // pixels are always available via the layer-frame binding.
    const coreRendered = !!inputSource.source.shaderCode;
    const inputReady =
      coreRendered ||
      this.nativeSourceFrameUploaded(inputSource) ||
      this.canUseNativeStaticImageDecode(inputSource.source, inputSource.sourceType) ||
      this.canUseNativeVideoDecodePump(inputSource, inputSource.sourceType);
    if (!inputReady) return null;
    const source = nativeEffectPassOutputSource(layer, inputSource);
    const key = this.nativeGraphRouteKey('effect-pass', source.id);
    if (!includeWarningDisabled && (this.nativeGraphRoutes.get(key)?.warnings ?? 0) >= 3) {
      return null;
    }
    return {
      kind: 'effect-pass',
      key,
      source,
      inputSource,
      effectPasses,
      // Bind the layer's raw shader render (shader-frame), NOT its displayed
      // frame (layer-frame): once the effect-pass output claims the display
      // slot, layer-frame would resolve to the chain's own output — a
      // self-feedback loop that starts from the empty checkerboard slot.
      inputBindingId: coreRendered ? `shader-frame:${layer.id}` : inputSource.id,
      inputCoreRendered: coreRendered,
    };
  }

  // Route for drawing-instrument layers (lines / svg / light painting):
  // the instrument renders into its base source frame, and any layer
  // effects chain from that frame into a distinct display source — the
  // same instrument-vs-display split the GPU graph kinds use.
  private nativeInstrumentGraphRoute(
    layer: Layer,
    kind: 'lines' | 'svg' | 'light-painting' | 'text' | 'splat' | 'model3d',
    includeWarningDisabled: boolean,
  ): NativeGraphLayerRoute | null {
    const baseSource = nativeGraphOutputSource(layer, kind);
    const key = this.nativeGraphRouteKey(kind, baseSource.id);
    if (!includeWarningDisabled && (this.nativeGraphRoutes.get(key)?.warnings ?? 0) >= 3) return null;
    const candidateEffectPasses = nativeEffectPassesForLayer(layer);
    const effectPasses = candidateEffectPasses?.length && this.supportsNativeEffectPassRoute(candidateEffectPasses)
      ? candidateEffectPasses
      : null;
    return {
      kind,
      key,
      baseSource: effectPasses?.length ? baseSource : undefined,
      source: effectPasses?.length ? nativeEffectPassOutputSource(layer, baseSource) : baseSource,
      inputSource: null,
      effectPasses: effectPasses ?? undefined,
    };
  }

  private nativeGraphRouteForLayer(layer: Layer, includeWarningDisabled = false): NativeGraphLayerRoute | null {
    if (!this.nativeComputeGraphSourceFrames || !this.nativeWgslStdlibWarmed || !layer.visible) return null;
    const pluginKind = nativePluginEffectType(layer.source?.effectSource?.effectType);
    if (pluginKind) {
      if (!this.supportsNativeGraphRoute(pluginKind)) return null;
      if (nativePluginUnavailableReason(layer.source?.effectSource)) return null;
      const source = nativeGraphOutputSource(layer, pluginKind);
      const key = this.nativeGraphRouteKey(pluginKind, source.id);
      if (!includeWarningDisabled && (this.nativeGraphRoutes.get(key)?.warnings ?? 0) >= 3) return null;
      return { kind: pluginKind, key, source, inputSource: null };
    }
    const effectPassRoute = this.nativeEffectPassRouteForLayer(layer, includeWarningDisabled);
    if (effectPassRoute) return effectPassRoute;
    if (layer.type === 'lines' && layer.linesContent && this.supportsNativeGraphRoute('lines')) {
      return this.nativeInstrumentGraphRoute(layer, 'lines', includeWarningDisabled);
    }
    if (layer.type === 'svg' && layer.svgContent?.svgSource && this.supportsNativeGraphRoute('svg')) {
      return this.nativeInstrumentGraphRoute(layer, 'svg', includeWarningDisabled);
    }
    if (layer.type === 'lightpainting' && layer.lightPaintingContent && this.supportsNativeGraphRoute('light-painting')) {
      return this.nativeInstrumentGraphRoute(layer, 'light-painting', includeWarningDisabled);
    }
    if (layer.type === 'text' && layer.textContent && this.supportsNativeGraphRoute('text')) {
      return this.nativeInstrumentGraphRoute(layer, 'text', includeWarningDisabled);
    }
    if (layer.type === 'splat' && layer.splatContent?.filePath && this.supportsNativeGraphRoute('splat')) {
      return this.nativeInstrumentGraphRoute(layer, 'splat', includeWarningDisabled);
    }
    if (layer.type === 'model3d' && layer.model3dContent?.modelData && this.supportsNativeGraphRoute('model3d')) {
      return this.nativeInstrumentGraphRoute(layer, 'model3d', includeWarningDisabled);
    }
    if (layer.type !== 'gpu' || !layer.gpuLayerContent) return null;
    const shaderId = String(layer.gpuLayerContent.shaderId || '').trim();
    const normalizedShaderId = shaderId.toLowerCase();
    if (!isNativeReadyGpuShaderId(normalizedShaderId)) return null;
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
      normalizedShaderId === 'fluid-riders' &&
      this.supportsNativeGraphRoute('fluid-riders')
    ) {
      kind = 'fluid-riders';
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
    const candidateEffectPasses = nativeEffectPassesForLayer(layer);
    const effectPasses = candidateEffectPasses?.length && this.supportsNativeEffectPassRoute(candidateEffectPasses)
      ? candidateEffectPasses
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

  private nativeVideoDecodePumpReady(): boolean {
    return (
      this.supportsNativeFeature('native_media_decode') &&
      this.supportsNativeFeature('media_prefetch') &&
      this.supportsNativeFeature('native_video_decode_pump') &&
      this.supportsNativeFeature('native_video_decode_pump_window') &&
      this.supportsNativeFeature('native_video_frame_decode') &&
      this.supportsNativeFeature('native_video_frame_prefetch') &&
      this.supportsNativeFeature('native_media_source_playback_state')
    );
  }

  private canUseNativeVideoDecodePump(
    nativeSource: NativeLayerSource | null | undefined,
    sourceType: string,
  ): boolean {
    const src = nativeSource?.source;
    if (!src || sourceType !== 'video' || !nativeSource.shouldPrefetch) return false;
    return (
      this.nativeVideoDecodePumpReady() &&
      !this.nativeVideoDecodeBypass.has(this.sourceCacheKey(src.id, src.src))
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

  private markNativeVideoDecodePumpFrameReady(src: NonNullable<Layer['source']>): boolean {
    const sourceKey = this.sourceCacheKey(src.id, src.src);
    const signature = `native-video-pump:${src.src}`;
    if (this.sourcePreviewSeq.has(sourceKey) && this.sourcePreviewSig.get(sourceKey) === signature) {
      return false;
    }
    const previousSignature = this.sourcePreviewSig.get(sourceKey);
    const previousSeq = this.sourcePreviewSeq.get(sourceKey);
    const seq = (this.sourcePreviewSeq.get(sourceKey) ?? 0) + 1;
    this.sourcePreviewSeq.set(sourceKey, seq);
    this.sourcePreviewSig.set(sourceKey, signature);
    this.sourcePreviewNextAt.delete(sourceKey);
    this.nativeVideoDecodePending.set(sourceKey, {
      sourceId: src.id,
      signature,
      seq,
      previousSignature,
      previousSeq,
      submittedAt: Date.now(),
    });
    return true;
  }

  // Native group support: the group container itself renders nothing; each
  // child becomes an effective layer whose source is the group's shader.
  // Unified mode maps the child's canvas bbox onto the shared full-canvas
  // shader via the ordinary cropRegion path (top-origin normalized coords),
  // so slice strips sample exactly their screen region — same UV machinery
  // media cropping already uses, which keeps vertical ordering correct.
  private resolveNativeGroupLayers(layers: Layer[]): Layer[] {
    let hasGroups = false;
    let hasVjFeed = false;
    for (const layer of layers) {
      if (String(layer.type) === 'group' || (layer as { parentGroupId?: string | null }).parentGroupId) {
        hasGroups = true;
      }
      if (String(layer.id).startsWith('vj-')) hasVjFeed = true;
    }
    if (!hasGroups && !hasVjFeed) return layers;
    // VJ feed lookup: crossfade output preferred over single-bank rows.
    const vjFeed = new Map<number, Layer>();
    for (const layer of layers) {
      // VJ Mix carrier: the true post-crossfade composite of every row,
      // registered under the VJ Mix index (-1).
      if (String(layer.id) === '__vj-mix__') { vjFeed.set(-1, layer); continue; }
      const xfade = /^vj-xfade-(\d+)$/.exec(String(layer.id));
      if (xfade) { vjFeed.set(Number(xfade[1]), layer); continue; }
      const row = /^vj-layer-(\d+)/.exec(String(layer.id));
      if (row && !vjFeed.has(Number(row[1]))) vjFeed.set(Number(row[1]), layer);
    }
    const redirectVjSource = (target: Layer) => {
      if (String(target.id).startsWith('vj-')) return;
      const raw = Number((target as { vjLayerIndex?: number | null }).vjLayerIndex);
      if (!Number.isFinite(raw) || vjFeed.size === 0) return;
      const index = Math.round(raw);
      // VJ Mix (-1): the native composite carrier when present, else fall
      // back to the lowest active row's feed (legacy approximation).
      const feed = index < 0
        ? vjFeed.get(-1)
          ?? vjFeed.get(Math.min(...Array.from(vjFeed.keys()).filter((key) => key >= 0)))
        : vjFeed.get(index);
      if (feed?.source) {
        (target as { source: Layer['source'] }).source = feed.source;
      }
    };
    const byId = new Map(layers.map((layer) => [layer.id, layer]));
    const out: Layer[] = [];
    for (const layer of layers) {
      if (String(layer.type) === 'group') continue;
      const groupId = (layer as { parentGroupId?: string | null }).parentGroupId;
      if (!groupId) {
        const solo = { ...layer } as Layer;
        redirectVjSource(solo);
        out.push(solo);
        continue;
      }
      const group = byId.get(groupId);
      if (!group) { out.push(layer); continue; }
      if (!group.visible) continue;
      const config = (group as { groupConfig?: { shaderMode?: string; overrideStyles?: boolean; shaderSource?: Layer['source'] } }).groupConfig;
      const shaderSource = config?.shaderSource ?? group.source ?? null;
      // A group set to a VJ source (VJ Mix = -1, or a specific deck row)
      // routes that stream into every child — the group's own VJ selection
      // is the master feed for its slices.
      const groupVjRaw = Number((group as { vjLayerIndex?: number | null }).vjLayerIndex);
      const hasGroupVj = Number.isFinite(groupVjRaw);
      const child = { ...layer } as Layer;
      (child as { opacity: number }).opacity = clampNumber((layer.opacity ?? 1) * (group.opacity ?? 1), 0, 1);
      // The native scene has no group compositing pass — the container is
      // dropped and children render flat. A non-normal blend on the group
      // (the VJ MAP slot blend, or a group blend in the editor) therefore
      // rides onto each child so "this slot blends with the stack below"
      // still holds. Children keep their own blend under a 'normal' group.
      if (group.blendMode && group.blendMode !== 'normal') {
        (child as { blendMode: Layer['blendMode'] }).blendMode = group.blendMode;
      }
      if (config?.overrideStyles && (group.effects?.length ?? 0) > 0) {
        (child as { effects: Layer['effects'] }).effects = group.effects;
      }
      if (hasGroupVj) {
        (child as { vjLayerIndex?: number }).vjLayerIndex = Math.round(groupVjRaw);
      } else if (shaderSource) {
        (child as { source: Layer['source'] }).source = shaderSource;
      }
      redirectVjSource(child);
      if (hasGroupVj || shaderSource) {
        if (config?.shaderMode === 'unified') {
          const c = layer.corners;
          if (c) {
            const minX = clampNumber(Math.min(c.topLeft.x, c.topRight.x, c.bottomLeft.x, c.bottomRight.x), 0, 1);
            const maxX = clampNumber(Math.max(c.topLeft.x, c.topRight.x, c.bottomLeft.x, c.bottomRight.x), 0, 1);
            const minY = clampNumber(Math.min(c.topLeft.y, c.topRight.y, c.bottomLeft.y, c.bottomRight.y), 0, 1);
            const maxY = clampNumber(Math.max(c.topLeft.y, c.topRight.y, c.bottomLeft.y, c.bottomRight.y), 0, 1);
            // The crop pipeline's `1 - y - h` convention matches decoded
            // media frames (stored bottom-up). Core-rendered content —
            // shader/effect sources AND vj_layer_index feeds (the core
            // samples its own rendered deck frames, top-down regardless
            // of clip type) — stores top-down, which needs BOTH
            // corrections: the band-order pre-flip AND an intra-band
            // vertical flip. The core applies uv flips inside the crop
            // window (heartbeat.wgsl flips sampled_uv before the uv0
            // crop transform), so the pre-flip alone reverses band
            // order but leaves each band's content upside down — a
            // continuous image then reads as a clean global mirror.
            const src = child.source as { type?: string; shaderCode?: string } | null;
            const coreRendered = hasGroupVj
              || (!!src && (src.type === 'shader' || src.type === 'effect' || !!src.shaderCode));
            (child as { cropRegion: Layer['cropRegion'] }).cropRegion = {
              x: minX,
              y: coreRendered ? clampNumber(1 - maxY, 0, 1) : minY,
              width: Math.max(0.001, maxX - minX),
              height: Math.max(0.001, maxY - minY),
            };
            if (coreRendered) {
              (child as { flipV?: boolean }).flipV = !child.flipV;
            }
          }
          (child as { contentFit: Layer['contentFit'] }).contentFit = 'stretch';
        } else if (config?.overrideStyles && group.contentFit) {
          (child as { contentFit: Layer['contentFit'] }).contentFit = group.contentFit;
        }
      }
      out.push(child);
    }
    return out;
  }

  private async renderNativeGraphSources(
    layers: Layer[],
    width: number,
    height: number,
    clock: NativeRenderClockCommand,
    visual: VisualAudioState,
  ): Promise<RendererCommand[]> {
    const queuedCommands: RendererCommand[] = [];
    if (!this.nativeComputeGraphSourceFrames) {
      this.nativeGraphRoutes.clear();
      return queuedCommands;
    }
    const activeRouteKeys = new Set<string>();
    layers = this.resolveNativeGroupLayers(layers);
    for (const layer of layers) {
      const possibleRoute = this.nativeGraphRouteForLayer(layer, true);
      if (!possibleRoute) continue;
      if (NATIVE_CORE_OWNED_GRAPH_KINDS.has(possibleRoute.kind)) {
        activeRouteKeys.add(possibleRoute.key);
        if (possibleRoute.kind === 'point-cloud-fx') {
          const pointData = await this.nativePointCloudDataForRoute(layer, possibleRoute);
          if (pointData && this.nativePointCloudUploadSignatures.get(layer.id) !== pointData.signature) {
            queuedCommands.push({
              type: 'upload_native_point_cloud',
              layer_id: layer.id,
              signature: pointData.signature,
              point_count: pointData.pointCount,
              sort_count: pointData.sortCount,
              depth_sort_enabled: pointData.depthSortEnabled,
              home_b64: nativePointCloudBufferBase64(pointData.homeInitialBuffer),
              live_b64: nativePointCloudBufferBase64(pointData.liveInitialBuffer),
              sort_b64: nativePointCloudBufferBase64(pointData.sortInitialBuffer),
            });
            this.nativePointCloudUploadSignatures.set(layer.id, pointData.signature);
          }
        }
        if (possibleRoute.kind === 'handfx') {
          const routeState = this.nativeGraphRoutes.get(possibleRoute.key) ?? {
            inFlight: false,
            seq: 0,
            warnings: 0,
            state: null,
            bufferPrefixes: nativeGraphBufferPrefixesForRoute(possibleRoute),
          };
          this.nativeGraphRoutes.set(possibleRoute.key, routeState);
          const params = nativeGraphParamsForLayer(layer, possibleRoute.kind);
          if (params.handfxCameraOn !== false && !mediaPipeSource.isRunning()) {
            void mediaPipeSource.start({ useGesture: false, targetFps: 60, numHands: 2 }).catch((error) => {
              console.warn('[NativeRendererSync] HandFX MediaPipe input failed to start', error);
            });
          }
          const handFrame = mediaPipeSource.getLastFrame();
          if (handFrame.timestamp !== routeState.lastHandFrameTimestamp) {
            const graphTime = typeof clock.time === 'number'
              ? clock.time
              : Math.max(0, (performance.now() - this.liveClockOriginMs) / 1000);
            const graphDelta = typeof clock.time_delta === 'number' ? clock.time_delta : 1 / this.targetFps;
            const graphFrameIndex = typeof clock.frame_index === 'number' && Number.isFinite(clock.frame_index)
              ? Math.max(0, Math.round(clock.frame_index))
              : routeState.seq + 1;
            const update = buildNativeHandInputUpdate({
              sourceId: nativeGraphRenderSource(possibleRoute).id,
              params,
              width,
              height,
              time: graphTime,
              frameDelta: graphDelta,
              frameIndex: graphFrameIndex,
              audio: {
                active: visual.isActive,
                bass: visual.isActive ? Math.max(visual.bass, visual.bassFast * 0.9) : 0,
                mid: visual.isActive ? visual.mid : 0,
                treble: visual.isActive ? visual.treble : 0,
                energy: visual.isActive ? visual.energy : 0,
                beatPhase: visual.beatPhase,
                beatPulse: visual.isActive ? visual.beat : 0,
                amplitude: visual.isActive ? visual.level : 0,
              },
              handFrame,
              state: routeState.state as NativePluginGraphState | null,
              reset: false,
            });
            for (const buffer of update.buffers) {
              queuedCommands.push({
                type: 'update_native_graph_buffer',
                layer_id: layer.id,
                buffer_id: buffer.id,
                initial_b64: buffer.initialB64,
              });
            }
            routeState.state = update.state;
            routeState.lastHandFrameTimestamp = handFrame.timestamp;
            routeState.seq = graphFrameIndex;
          }
        }
        continue;
      }
      activeRouteKeys.add(possibleRoute.key);

      const route = this.nativeGraphRouteForLayer(layer);
      if (!route) continue;
      if (
        this.nativeGraphUsesSourceFrameInput(layer, route) &&
        route.inputSource &&
        !route.inputCoreRendered &&
        !this.nativeSourceFrameUploaded(route.inputSource)
      ) continue;

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
      const nativeGraphParams = nativeGraphParamsForLayer(
        layer,
        route.kind,
        this.nativeGraphWorkloadScale(),
      );
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
      // Backpressure: the core executes every queued graph, so when its
      // clock stalls behind an expensive pass, unbounded queueing turns a
      // slow frame into a death spiral. Cap submissions per core frame,
      // with a slow time-based escape hatch so paused-clock edits still
      // reach the screen.
      if (clock.mode !== 'manual') {
        const nowMs = Date.now();
        if (routeState.lastQueuedClockFrame === graphFrameIndex) {
          if (
            (routeState.queuedThisClockFrame ?? 0) >= 2 &&
            nowMs - (routeState.lastQueuedAtMs ?? 0) < 250
          ) {
            continue;
          }
        } else {
          routeState.lastQueuedClockFrame = graphFrameIndex;
          routeState.queuedThisClockFrame = 0;
        }
        routeState.queuedThisClockFrame = (routeState.queuedThisClockFrame ?? 0) + 1;
        routeState.lastQueuedAtMs = nowMs;
      }
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
          const nowMs = Date.now();
          if (nowMs - ((this as any).__fxQueueDebugAt ?? 0) > 4000) {
            (this as any).__fxQueueDebugAt = nowMs;
            console.log('[NativeRendererSync] fx-chain queue', JSON.stringify({
              layer: layer.id,
              input: route.inputBindingId ?? route.inputSource.id,
              coreRendered: !!route.inputCoreRendered,
              out: route.source.id,
              effects: route.effectPasses.map((e) => e.effect),
            }));
          }
          const effectGraph = buildNativeEffectPassChainGraph({
            sourceId: route.inputBindingId ?? route.inputSource.id,
            targetSourceId: route.source.id,
            effects: route.effectPasses.map((effectPass) => ({
              effect: effectPass.effect,
              amount: effectPass.amount,
              mix: 1,
              params: { ...effectPass.params, audioLevel: getVisualAudioSnapshot().level },
            })),
            width,
            height,
            time: graphTime,
            frameDelta: graphDelta,
            frameIndex: graphFrameIndex,
            seq: graphSeq * 16,
          });
          queuedCommands.push({
            type: 'queue_compute_graph',
            ...(effectGraph.config as unknown as Record<string, unknown>),
          });
          routeState.state = null;
          routeState.lastGraphFrameIndex = graphFrameIndex;
          routeState.lastManualClockKey = manualClockKey || undefined;
          routeState.warnings = 0;
          nativeFailedRouteLayers.update((ids) => (ids.includes(layer.id) ? ids.filter((id) => id !== layer.id) : ids));
          continue;
        }
        const graph = await (async () => {
          if (route.kind === 'lines') {
            const audio = getVisualAudioSnapshot();
            return buildLinesNativeComputeGraph({
              sourceId: graphSource.id,
              content: layer.linesContent ?? { elements: [] } as any,
              width,
              height,
              time: graphTime,
              frameDelta: graphDelta,
              frameIndex: graphFrameIndex,
              audioBass: audio.bass,
              audioTreble: audio.treble,
              audioBeat: audio.beat,
            });
          }
          if (route.kind === 'svg') {
            return buildSvgNativeComputeGraph({
              sourceId: graphSource.id,
              content: layer.svgContent!,
              width,
              height,
              time: graphTime,
              frameDelta: graphDelta,
              frameIndex: graphFrameIndex,
            });
          }
          if (route.kind === 'light-painting') {
            const audio = getVisualAudioSnapshot();
            return buildLightPaintingNativeComputeGraph({
              sourceId: graphSource.id,
              content: layer.lightPaintingContent!,
              width,
              height,
              time: graphTime,
              frameDelta: graphDelta,
              frameIndex: graphFrameIndex,
              audioBass: audio.bass,
              audioTreble: audio.treble,
              audioBeat: audio.beat,
            });
          }
          if (route.kind === 'text') {
            const content = layer.textContent!;
            const state = this.nativeTextStateFor(layer.id);
            const atlasSig = textAtlasSignature(content);
            if (!state.atlas || state.atlasSig !== atlasSig) {
              state.atlas = buildTextNativeAtlas(content);
              state.atlasSig = atlasSig;
              state.atlasUploaded = false;
            }
            if (!state.atlas) throw new Error('text atlas rasterization unavailable');
            const layoutKey = [
              content.text, content.fontFamily, content.fontSize, content.fontWeight,
              content.fontStyle, content.letterSpacing, content.lineHeight,
              content.alignment, width, height,
            ].join('|');
            if (state.layoutKey !== layoutKey) {
              state.letters = layoutTextGlyphs(content, width, height);
              state.layoutKey = layoutKey;
            }
            const atlasSourceId = textNativeAtlasSourceId(graphSource.id);
            if (!state.atlasUploaded) {
              state.atlasSeq += 1;
              queuedCommands.push({
                type: 'upload_source_frame',
                source_id: atlasSourceId,
                seq: state.atlasSeq,
                width: state.atlas.width,
                height: state.atlas.height,
                rgba_b64: encodeAtlasBase64(state.atlas.rgba),
              } as unknown as RendererCommand);
              state.atlasUploaded = true;
            }
            return buildTextNativeComputeGraph({
              sourceId: graphSource.id,
              atlasSourceId,
              content,
              atlas: state.atlas,
              letters: state.letters,
              width,
              height,
              time: graphTime,
              frameDelta: graphDelta,
              frameIndex: graphFrameIndex,
            });
          }
          if (route.kind === 'splat') {
            const content = layer.splatContent!;
            const state = this.nativeSplatStateFor(layer.id);
            const fileSig = `${content.filePath}|${content.pointDensity ?? 1}`;
            if (state.fileSig !== fileSig) {
              state.fileSig = fileSig;
              state.loading = true;
              state.packed = null;
              void this.loadNativeSplatPoints(layer.id, content, fileSig);
            }
            // While the file parses, render an empty frame — throwing here
            // would warning-disable the route before the load resolves.
            const audio = getVisualAudioSnapshot();
            const textureSourceId = `${graphSource.id}:splat-texture`;
            const textureSig = content.textureEnabled && content.texturePath
              ? `${content.texturePath}|${content.textureType ?? 'image'}`
              : '';
            if (state.textureSig !== textureSig) {
              state.textureSig = textureSig;
              state.texture = null;
              this.releaseNativeSplatTextureVideo(state);
              if (textureSig) void this.loadNativeSplatTexture(layer.id, content, textureSig);
            }
            // Upload when the element presented a new frame (rVFC-paced).
            // Under the offline render's manual clock the element must NOT
            // free-run on the wall clock — capture is slower than real time,
            // so free playback exports too fast. Seek it to the virtual time
            // instead (one frame of seek latency; constant, so the rate is
            // exact) and upload every manual frame.
            const video = state.textureVideo;
            const target = state.textureCanvas;
            const texNowMs = Date.now();
            const manualClockTime = clock.mode === 'manual' && typeof clock.time === 'number'
              ? clock.time
              : null;
            if (video && target && video.readyState >= 2 && manualClockTime !== null) {
              if (!video.paused) video.pause();
              const duration = Number.isFinite(video.duration) && video.duration > 0
                ? video.duration
                : 0;
              const seekTo = duration > 0 ? manualClockTime % duration : 0;
              if (Math.abs(video.currentTime - seekTo) > 0.001) {
                try { video.currentTime = seekTo; } catch { /* not seekable yet */ }
              }
              target.ctx.drawImage(video, 0, 0, target.width, target.height);
              state.texture = {
                rgba: target.ctx.getImageData(0, 0, target.width, target.height).data,
                width: target.width,
                height: target.height,
              };
              state.textureUploadedSig = '';
            } else if (video && target && video.readyState >= 2 && video.paused && manualClockTime === null) {
              // Leaving manual mode: resume live playback.
              state.textureVideoFrameReady = true;
              void video.play().catch(() => {});
            } else if (
              video && target && !video.paused && video.readyState >= 2 &&
              state.textureVideoFrameReady &&
              texNowMs - state.textureVideoUploadedAt >= 1000 / 45
            ) {
              state.textureVideoFrameReady = false;
              state.textureVideoUploadedAt = texNowMs;
              target.ctx.drawImage(video, 0, 0, target.width, target.height);
              state.texture = {
                rgba: target.ctx.getImageData(0, 0, target.width, target.height).data,
                width: target.width,
                height: target.height,
              };
              state.textureUploadedSig = '';
            }
            if (state.texture && state.textureUploadedSig !== state.textureSig) {
              state.textureSeq += 1;
              queuedCommands.push({
                type: 'upload_source_frame',
                source_id: textureSourceId,
                width: state.texture.width,
                height: state.texture.height,
                seq: state.textureSeq,
                rgba_b64: encodeAtlasBase64(state.texture.rgba),
              } as unknown as RendererCommand);
              state.textureUploadedSig = state.textureSig;
            }
            const graph = buildSplatNativeComputeGraph({
              sourceId: graphSource.id,
              content,
              pointCount: state.packed?.pointCount ?? 0,
              pointsBufferId: `splat:${nativeGraphBufferSafeId(graphSource.id)}:points`,
              pointsB64: state.packed && state.uploadedSig !== fileSig
                ? encodeSplatBufferBase64(state.packed.buffer)
                : null,
              textureSourceId,
              hasTexture: !!state.texture && state.textureUploadedSig === state.textureSig,
              width,
              height,
              time: graphTime,
              frameDelta: graphDelta,
              frameIndex: graphFrameIndex,
              audioLevel: audio.level ?? Math.max(audio.bass, audio.treble),
              audioBands: {
                sub: audio.sub,
                bass: audio.bass,
                lowMid: audio.lowMid,
                mid: audio.mid,
                highMid: audio.highMid,
                high: audio.high,
              },
              audioBeat: audio.beat,
              audioBeatPhase: audio.beatPhase,
              pointer: get(splatPointer),
            });
            if (state.packed) state.uploadedSig = fileSig;
            return graph;
          }
          if (route.kind === 'model3d') {
            const content = layer.model3dContent!;
            const state = this.nativeModel3DStateFor(layer.id);
            const fileSig = `${content.modelData}|${content.modelFormat}`;
            if (state.fileSig !== fileSig) {
              state.fileSig = fileSig;
              state.mesh = null;
              void this.loadNativeModel3DMesh(layer.id, content, fileSig);
            }
            const textureSourceId = `${graphSource.id}:model3d-texture`;
            if (state.mesh?.texture && state.textureUploadedSig !== fileSig) {
              state.textureSeq += 1;
              queuedCommands.push({
                type: 'upload_source_frame',
                source_id: textureSourceId,
                seq: state.textureSeq,
                width: state.mesh.texture.width,
                height: state.mesh.texture.height,
                rgba_b64: encodeAtlasBase64(state.mesh.texture.rgba),
              } as unknown as RendererCommand);
              state.textureUploadedSig = fileSig;
            }
            const audio = getVisualAudioSnapshot();
            const graph = buildModel3DNativeComputeGraph({
              sourceId: graphSource.id,
              content,
              vertexCount: state.mesh?.vertexCount ?? 0,
              indexCount: state.mesh?.indexCount ?? 0,
              meshBufferId: `model3d:${nativeGraphBufferSafeId(graphSource.id)}:mesh`,
              meshB64: state.mesh && state.meshUploadedSig !== fileSig
                ? encodeSplatBufferBase64(state.mesh.buffer)
                : null,
              meshByteLength: (state.mesh?.vertexCount ?? 0) * MODEL3D_VERTEX_VEC4S * 16,
              indexBufferId: `model3d:${nativeGraphBufferSafeId(graphSource.id)}:indices`,
              indexB64: state.mesh && state.meshUploadedSig !== fileSig
                ? encodeSplatBufferBase64(new Float32Array(state.mesh.indices.buffer, state.mesh.indices.byteOffset, state.mesh.indices.length))
                : null,
              indexByteLength: (state.mesh?.indexCount ?? 0) * 4,
              textureSourceId,
              hasTexture: !!state.mesh?.texture,
              width,
              height,
              time: graphTime,
              frameDelta: graphDelta,
              frameIndex: graphFrameIndex,
              audioLevel: audio.level ?? Math.max(audio.bass, audio.treble),
              audioSub: audio.sub,
              audioBass: audio.bass,
              audioLowMid: audio.lowMid,
              audioMid: audio.mid,
              audioHighMid: audio.highMid,
              audioHigh: audio.high,
              audioBeat: audio.beat,
              audioBeatPhase: audio.beatPhase,
            });
            if (state.mesh) state.meshUploadedSig = fileSig;
            return graph;
          }
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
        queuedCommands.push({
          type: 'queue_compute_graph',
          ...(graph.config as unknown as Record<string, unknown>),
        });
        if (route.effectPasses?.length && route.source.id !== graphSource.id) {
          const effectGraph = buildNativeEffectPassChainGraph({
            sourceId: graphSource.id,
            targetSourceId: route.source.id,
            intermediatePrefix: `${route.source.id}:chain`,
            effects: route.effectPasses.map((effectPass) => ({
              effect: effectPass.effect,
              amount: effectPass.amount,
              mix: 1,
              params: { ...effectPass.params, audioLevel: getVisualAudioSnapshot().level },
            })),
            width,
            height,
            time: graphTime,
            frameDelta: graphDelta,
            frameIndex: graphFrameIndex,
            seq: graphSeq * 16 + 8,
          });
          queuedCommands.push({
            type: 'queue_compute_graph',
            ...(effectGraph.config as unknown as Record<string, unknown>),
          });
        }
        routeState.state = graph.state ?? null;
        routeState.lastGraphFrameIndex = graphFrameIndex;
        routeState.lastManualClockKey = manualClockKey || undefined;
        routeState.warnings = 0;
          nativeFailedRouteLayers.update((ids) => (ids.includes(layer.id) ? ids.filter((id) => id !== layer.id) : ids));
      } catch (err) {
        this.recordNativeGraphRouteFailure(route, layer.id, err, routeState);
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
    return queuedCommands;
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
    const nativeTime = Number(src._nativePlaybackTimeSeconds);
    if (Number.isFinite(nativeTime) && nativeTime >= 0) {
      const anchorMs = Number(src._nativePlaybackUpdatedAtMs);
      const elapsedSeconds = src.isPlaying === false || !Number.isFinite(anchorMs)
        ? 0
        : Math.max(0, now - anchorMs) / 1000;
      return Math.max(0, nativeTime + elapsedSeconds * (Number(src.playbackRate) || 1));
    }
    const videoTime = Number(src.videoElement?.currentTime);
    return Number.isFinite(videoTime)
      ? Math.max(0, videoTime)
      : 0;
  }

  private nativeVideoPlaybackControlSignature(src: NonNullable<Layer['source']>): string {
    const element = src.videoElement ?? null;
    const duration = Number(src.durationSeconds ?? element?.duration);
    const seekGeneration = Number(src._nativePlaybackSeekSeq ?? 0);
    const explicitTime = Number(src._nativePlaybackTimeSeconds);
    return [
      src.isPlaying !== false ? 'play' : 'pause',
      Number(src.playbackRate ?? element?.playbackRate ?? 1).toFixed(6),
      src.playbackMode ?? (element?.loop ? 'loop' : 'loop'),
      Number(src.trimStart ?? 0).toFixed(6),
      Number(src.trimEnd ?? 1).toFixed(6),
      Number.isFinite(duration) && duration > 0 ? duration.toFixed(6) : 'unknown',
      Number.isFinite(seekGeneration) ? Math.max(0, Math.round(seekGeneration)) : 0,
      Number.isFinite(explicitTime) && explicitTime >= 0 ? explicitTime.toFixed(6) : 'live',
    ].join(':');
  }

  private nativeVideoPlaybackCommandIfChanged(
    src: NonNullable<Layer['source']>,
    sourceType: string,
    now: number,
    renderClock: NativeRenderClockCommand,
  ): RendererCommand | null {
    const sourceKey = this.sourceCacheKey(src.id, src.src);
    const signature = this.nativeVideoPlaybackControlSignature(src);
    const previous = this.nativeVideoPlaybackState.get(sourceKey);
    if (previous?.signature === signature) return null;
    const clockTimeSeconds = Number(renderClock.time ?? 0);
    const explicitNativeTime = Number(src._nativePlaybackTimeSeconds);
    const elementTime = Number(src.videoElement?.currentTime);
    const estimatedPreviousTime = previous
      ? previous.paused
        ? previous.timeSeconds
        : previous.timeSeconds + Math.max(0, clockTimeSeconds - previous.clockTimeSeconds) * previous.playbackRate
      : 0;
    const timeSeconds = Number.isFinite(explicitNativeTime) && explicitNativeTime >= 0
      ? explicitNativeTime
      : Number.isFinite(elementTime) && elementTime >= 0
      ? elementTime
      : Math.max(0, estimatedPreviousTime);
    const playbackRate = Number(src.playbackRate ?? src.videoElement?.playbackRate ?? 1) || 1;
    const paused = src.isPlaying === false;
    this.nativeVideoPlaybackState.set(sourceKey, {
      signature,
      timeSeconds,
      clockTimeSeconds,
      playbackRate,
      paused,
      seekGeneration: Math.max(0, Math.round(Number(src._nativePlaybackSeekSeq ?? 0))),
    });
    return this.nativeVideoPlaybackCommand(src, sourceType, now, renderClock, timeSeconds);
  }

  private nativeVideoPlaybackCommand(
    src: NonNullable<Layer['source']>,
    sourceType: string,
    now: number,
    renderClock: NativeRenderClockCommand,
    explicitTimeSeconds?: number,
  ): RendererCommand {
    const element = src.videoElement ?? null;
    const duration = Number(src.durationSeconds ?? element?.duration);
    const playbackMode = src.playbackMode ?? (element?.loop ? 'loop' : 'loop');
    const decodeDimensions = this.nativeVideoDecodeDimensions(src);
    return {
      type: 'set_media_source_playback',
      source_id: src.id,
      uri: src.src,
      source_type: sourceType,
      time_seconds: Number((explicitTimeSeconds ?? this.nativeVideoPlaybackTimeSeconds(src, now)).toFixed(6)),
      clock_time_seconds: Number((renderClock.time ?? 0).toFixed(6)),
      playback_rate: Number((Number(src.playbackRate ?? element?.playbackRate) || 1).toFixed(6)),
      paused: src.isPlaying === false,
      loop_enabled: playbackMode !== 'once',
      trim_start: Math.max(0, Math.min(1, Number(src.trimStart ?? 0))),
      trim_end: Math.max(0, Math.min(1, Number(src.trimEnd ?? 1))),
      duration_seconds: Number.isFinite(duration) && duration > 0 ? Number(duration.toFixed(6)) : undefined,
      decode_width: decodeDimensions.width,
      decode_height: decodeDimensions.height,
      seek_generation: Math.max(0, Math.round(Number(src._nativePlaybackSeekSeq ?? 0))),
      seq: Math.max(1, Math.round(now * 1000)),
    };
  }

  private nativeVideoDecodeDimensions(src: NonNullable<Layer['source']>) {
    const maxDimension = Math.max(
      64,
      Math.min(2048, Math.round(this.dynamicSourceFrameCaptureSize || this.nativeSourceFrameSize)),
    );
    const sourceKey = this.sourceCacheKey(src.id, src.src);
    const element = src.videoElement ?? null;
    if (element && !this.videoMetadataWatches.has(element)) {
      this.videoMetadataWatches.add(element);
      element.addEventListener('loadedmetadata', () => {
        const width = Number(element.videoWidth);
        const height = Number(element.videoHeight);
        if (!(width > 0 && height > 0)) return;
        const aspect = clampNumber(width / height, 0.001, 128);
        const previous = this.nativeSourceAspectCache.get(sourceKey);
        this.nativeSourceAspectCache.set(sourceKey, aspect);
        this.nativeVideoDecodeDimensionCache.delete(sourceKey);
        if (this.running && previous !== aspect) {
          this.scheduleSync(this.desiredWidth, this.desiredHeight, this.latestLayers);
        }
      }, { once: true });
    }
    const sourceWidth = Number(element?.videoWidth ?? (src as any).videoWidth ?? (src as any).width ?? 0);
    const sourceHeight = Number(element?.videoHeight ?? (src as any).videoHeight ?? (src as any).height ?? 0);
    const hasMetadata = sourceWidth > 0 && sourceHeight > 0;
    if (hasMetadata) {
      this.nativeSourceAspectCache.set(
        sourceKey,
        clampNumber(sourceWidth / sourceHeight, 0.001, 128),
      );
    }
    const fallbackAspect = this.desiredWidth > 0 && this.desiredHeight > 0
      ? this.desiredWidth / this.desiredHeight
      : 16 / 9;
    const aspect = hasMetadata
      ? sourceWidth / sourceHeight
      : fallbackAspect;
    const width = aspect >= 1 ? maxDimension : Math.max(16, Math.round(maxDimension * aspect));
    const height = aspect >= 1 ? Math.max(16, Math.round(maxDimension / aspect)) : maxDimension;
    const next = {
      width: Math.max(16, width - (width % 2)),
      height: Math.max(16, height - (height % 2)),
    };
    const cached = this.nativeVideoDecodeDimensionCache.get(sourceKey);
    if (cached) {
      const targetChanged = cached.width !== next.width || cached.height !== next.height;
      if (cached.metadata || !hasMetadata || !targetChanged) {
        return { width: cached.width, height: cached.height };
      }
    }
    this.nativeVideoDecodeDimensionCache.set(sourceKey, { ...next, metadata: hasMetadata });
    return next;
  }

  private nativeVideoPrefetchOptions(
    src: NonNullable<Layer['source']>,
    now: number,
    prefetchWindowFrames = 0,
    useNativePlaybackClock = false,
  ) {
    const timeSeconds = this.nativeVideoPlaybackTimeSeconds(src, now);
    const decodeDimensions = this.nativeVideoDecodeDimensions(src);
    return {
      timeSeconds: useNativePlaybackClock ? undefined : timeSeconds,
      decodeWidth: decodeDimensions.width,
      decodeHeight: decodeDimensions.height,
      prefetchWindowFrames,
      prefetchFps: NATIVE_VIDEO_PREFETCH_WINDOW_FPS,
      playbackRate: Number(src.playbackRate ?? 1) || 1,
      loopEnabled: (src.playbackMode ?? 'loop') !== 'once',
      durationSeconds: Number.isFinite(Number(src.durationSeconds ?? src.videoElement?.duration))
        ? Number(src.durationSeconds ?? src.videoElement?.duration)
        : undefined,
      trimStart: Math.max(0, Math.min(1, Number(src.trimStart ?? 0))),
      trimEnd: Math.max(0, Math.min(1, Number(src.trimEnd ?? 1))),
      seq: Math.max(1, Math.round(timeSeconds * 1000)),
    };
  }

  /**
   * Public wrapper so the media library can derive the exact same arm
   * parameters a real placement would produce — the core's `library:`
   * warm-claim only hands a prerolled session over when the signatures
   * (uri, decode dims, rate, trims, duration, loop) match.
   */
  libraryVideoPrefetchOptions(src: NonNullable<Layer['source']>) {
    const options = this.nativeVideoPrefetchOptions(src, Date.now());
    const duration = Number(options.durationSeconds);
    const rawSeekGeneration = Number(src._nativePlaybackSeekSeq);
    const seekGeneration = Number.isFinite(rawSeekGeneration)
      ? Math.max(0, Math.floor(rawSeekGeneration))
      : NATIVE_LIBRARY_TRIGGER_SEEK_GENERATION;
    const trimStartSeconds =
      Number.isFinite(duration) && duration > 0 ? duration * options.trimStart : 0;
    return {
      ...options,
      timeSeconds: trimStartSeconds,
      seekGeneration,
      seq: Math.max(1, Math.round(trimStartSeconds * 1000)),
    };
  }

  canArmLibraryVideos() {
    return this.running && this.startupReady;
  }

  /** Mirror blackout / freeze into the core. Both are output-stage controls
   *  that used to live only in the WebGL render body — blackout as a DOM
   *  overlay over the editor preview, freeze as a skipped render — so under
   *  the native driver neither reached the projector. */
  private pushOutputState() {
    const s = get(settings);
    const blackout = !!s?.output?.blackout;
    const frozen = !!get(outputFrozen);
    if (blackout === this.lastOutputBlackout && frozen === this.lastOutputFrozen) return;
    this.lastOutputBlackout = blackout;
    this.lastOutputFrozen = frozen;
    void submitNativeRendererCommands([
      { type: 'set_output_state', blackout, frozen },
    ]).catch(() => { /* core without output-state support */ });
  }

  /** Mirror the composite-stage effect chain into the core: composition
   *  effects first, then each open macro's effect bundle scaled by its knob.
   *  The WebGL engine ran both after layer blending (`applyEffects` on the
   *  composite, then a wet/dry mix per bundle); the native compositor now
   *  does the same inside the heartbeat shader. Effects outside the
   *  compositor's in-shader op set are reported back as skipped. */
  private scheduleCompositeEffects() {
    // Auto-pulse rewrites macro values on every animation frame, so both
    // subscriptions can fire many times per frame. Coalesce to one rebuild
    // per frame; the signature check below drops the no-op pushes.
    if (this.compositeEffectsFrame !== null) return;
    if (typeof requestAnimationFrame !== 'function') {
      this.pushCompositeEffects();
      return;
    }
    this.compositeEffectsFrame = requestAnimationFrame(() => {
      this.compositeEffectsFrame = null;
      this.pushCompositeEffects();
    });
  }

  private pushCompositeEffects() {
    const entries: Array<{ descriptor: string; mix: number }> = [];
    const unsupported: string[] = [];
    const push = (effect: any, mix: number) => {
      const descriptor = effectToNativeDescriptor(effect);
      if (!descriptor) return;
      // The composite stage runs inside the heartbeat shader, which only
      // implements the compositor's colour ops. Anything needing its own
      // pass (blur, colorama, displacement, …) is dropped by the core, so
      // name it here rather than letting it silently do nothing.
      if (!HEARTBEAT_NATIVE_EFFECT_IDS.has(descriptor.split(':', 1)[0])) {
        unsupported.push(descriptor.split(':', 1)[0]);
        return;
      }
      entries.push({ descriptor, mix });
    };
    for (const effect of get(vjClipLauncher)?.compositionEffects ?? []) {
      if (effect?.enabled === false) continue;
      push(effect, 1);
    }
    // Mapping-mode composition effects. The WebGL engine passed
    // `mappingComposition.effects` as its composite chain in mapping mode
    // (Canvas chose per-mode); this push previously read only the VJ store,
    // so mapping-mode composition FX were a silent no-op natively. The two
    // sets never coexist — mapping composition is disabled in VJ mode — so
    // including both here preserves each mode's behaviour.
    const mappingComposition = get(project)?.mappingComposition;
    if (mappingComposition?.enabled) {
      for (const effect of mappingComposition.effects ?? []) {
        if (effect?.enabled === false) continue;
        push(effect, 1);
      }
    }
    for (const macro of get(macros)?.macros ?? []) {
      if (macro.value <= 0.001 || !macro.effects?.length) continue;
      for (const effect of macro.effects) {
        if (effect.enabled === false) continue;
        push(effect, macro.value);
      }
    }
    const sig = entries.map((e) => `${e.descriptor}@${e.mix.toFixed(4)}`).join('|');
    if (sig === this.lastCompositeEffectsSig) return;
    this.lastCompositeEffectsSig = sig;
    if (unsupported.length) {
      console.warn(
        `[NativeRendererSync] composite-stage effects without a native op: ${[...new Set(unsupported)].join(', ')}`,
      );
    }
    void submitNativeRendererCommands([
      { type: 'set_composite_effects', effects: entries },
    ]).catch(() => { /* core without composite-effect support */ });
  }

  /** Mirror the output stage — crop, rotation, colour grade, projector edge
   *  blend and dome reprojection — into the core. In the WebGL build these
   *  lived on the output quad and a 2D overlay canvas, neither of which the
   *  native compositor's surface passes through. */
  private pushOutputStage() {
    const out = get(settings)?.output;
    if (!out) return;
    const domeModes = ['angular', 'stereographic', 'orthographic', 'equirectangular'];
    const payload = {
      type: 'set_output_stage' as const,
      rotation: out.outputRotation ?? 0,
      cropX: out.outputCropX ?? 0,
      cropY: out.outputCropY ?? 0,
      cropWidth: out.outputCropWidth ?? 1,
      cropHeight: out.outputCropHeight ?? 1,
      brightness: out.brightness ?? 1,
      contrast: out.contrast ?? 1,
      gamma: out.gamma ?? 1,
      edgeBlendLeft: out.edgeBlendLeft ?? 0,
      edgeBlendRight: out.edgeBlendRight ?? 0,
      edgeBlendTop: out.edgeBlendTop ?? 0,
      edgeBlendBottom: out.edgeBlendBottom ?? 0,
      edgeBlendGamma: out.edgeBlendGamma ?? 2.2,
      domeEnabled: !!out.domeEnabled,
      domeMode: Math.max(0, domeModes.indexOf(out.domeMode ?? 'angular')),
      domeFOV: out.domeFOV ?? 180,
      domeRotation: out.domeRotation ?? 0,
      domeTilt: out.domeTilt ?? 0,
      domeOffsetX: out.domeOffsetX ?? 0,
      domeOffsetY: out.domeOffsetY ?? 0,
      domeCurvature: out.domeCurvature ?? 1,
      domeTruncation: out.domeTruncation ?? 1,
      // Alignment pattern drawn by the compositor's output stage, so it
      // reaches the projector (the DOM overlay only ever covered the
      // editor preview).
      testPattern: Math.max(0,
        ['none', 'grid', 'crosshair', 'color-bars', 'white', 'gradient', 'checkerboard']
          .indexOf(String(out.testPattern ?? 'none'))),
      // Master warp travels as-is; the core reads only the mesh belonging to
      // the declared mode, so a stale grid from the other mode is ignored.
      masterWarp: out.masterWarp && masterWarpIsActive(out.masterWarp)
        ? {
            enabled: true,
            mode: out.masterWarp.mode ?? 'corners',
            corners: out.masterWarp.corners ?? null,
            meshGrid: out.masterWarp.meshGrid ?? null,
          }
        : { enabled: false },
    };
    const sig = JSON.stringify(payload);
    if (sig === this.lastOutputStageSig) return;
    this.lastOutputStageSig = sig;
    void submitNativeRendererCommands([payload])
      .catch(() => { /* core without output-stage support */ });
  }

  /** Mirror the open multi-output slice displays into the core, which then
   *  composites one full-resolution frame per projector. Only slices with a
   *  window actually open are sent — each costs a composite pass per frame,
   *  so a configured-but-closed screen must not be paying for one. */
  private pushSliceOutputs() {
    const out = get(settings)?.output;
    const open = new Set(this.openSliceWindowIds);
    const slices = (out?.slices ?? [])
      .filter((s: any) => s?.enabled !== false && open.has(s?.id))
      .map((s: any) => {
        // The window is borderless-fullscreen on its display, so render at
        // the display's own pixel resolution — that is the whole point of a
        // native slice, versus cropping a downscaled master.
        const display = this.displayBounds.get(Number(s.displayId));
        const scale = display?.scaleFactor && display.scaleFactor > 0 ? display.scaleFactor : 1;
        return {
        id: String(s.id),
        width: Math.round((display?.width ?? out?.masterCanvasWidth ?? 1920) * scale),
        height: Math.round((display?.height ?? out?.masterCanvasHeight ?? 1080) * scale),
        cropX: s.cropX ?? 0,
        cropY: s.cropY ?? 0,
        cropW: s.cropW ?? 1,
        cropH: s.cropH ?? 1,
        rotation: s.rotation ?? 0,
        brightness: s.brightness ?? 1,
        contrast: s.contrast ?? 1,
        gamma: s.gamma ?? 1,
        edgeBlendLeft: s.edgeBlendLeft ?? 0,
        edgeBlendRight: s.edgeBlendRight ?? 0,
        edgeBlendTop: s.edgeBlendTop ?? 0,
        edgeBlendBottom: s.edgeBlendBottom ?? 0,
        edgeBlendGamma: s.edgeBlendGamma ?? 2.2,
        edgeBlendLeftGamma: s.edgeBlendLeftGamma ?? s.edgeBlendGamma ?? 2.2,
        edgeBlendRightGamma: s.edgeBlendRightGamma ?? s.edgeBlendGamma ?? 2.2,
        edgeBlendTopGamma: s.edgeBlendTopGamma ?? s.edgeBlendGamma ?? 2.2,
        edgeBlendBottomGamma: s.edgeBlendBottomGamma ?? s.edgeBlendGamma ?? 2.2,
        blackLevelR: s.blackLevelR ?? 0,
        blackLevelG: s.blackLevelG ?? 0,
        blackLevelB: s.blackLevelB ?? 0,
        blackLevelFeather: s.blackLevelFeather ?? 0.5,
        warpMode: s.warpMode ?? 'rect',
        corners: s.corners ?? null,
        meshGrid: s.meshGrid ?? null,
        };
      });
    const sig = JSON.stringify(slices);
    if (sig === this.lastSliceOutputsSig) return;
    this.lastSliceOutputsSig = sig;
    // A mesh grid larger than the compositor's 16x16 cap is dropped by the
    // core rather than scrambled, so say which screen lost its warp.
    const oversized = (out?.slices ?? []).filter((s: any) => {
      if (!open.has(s?.id) || s?.warpMode !== 'mesh') return false;
      const grid = s.meshGrid;
      return !!grid && (grid.rows > 16 || grid.cols > 16);
    });
    if (oversized.length) {
      console.warn(
        '[NativeRendererSync] slice mesh warp exceeds the native 16x16 control-grid cap;'
        + ` falling back to the rect crop for: ${oversized.map((s: any) => s.name || s.id).join(', ')}`,
      );
    }
    void submitNativeRendererCommands([{ type: 'set_slice_outputs', slices }])
      .catch(() => { /* core without slice-output support */ });
  }

  /** Which slice windows are open is main-process state, so poll it. It
   *  changes only when the operator opens or closes a screen. */
  private async refreshOpenSliceWindows() {
    try {
      if (this.displayBounds.size === 0) {
        const displays = await invoke<Array<{ id: number; width: number; height: number; scaleFactor: number }>>('get_displays');
        for (const display of displays ?? []) {
          this.displayBounds.set(Number(display.id), {
            width: Number(display.width) || 1920,
            height: Number(display.height) || 1080,
            scaleFactor: Number(display.scaleFactor) || 1,
          });
        }
      }
      const ids = await invoke<string[]>('output_list_slice_windows');
      const next = Array.isArray(ids) ? ids.map(String) : [];
      if (next.join('|') !== this.openSliceWindowIds.join('|')) {
        this.openSliceWindowIds = next;
      }
      this.pushSliceOutputs();
    } catch {
      /* not in the desktop shell */
    }
  }

  async start(width: number, height: number) {
    if (this.running) return;
    const lifecycleGeneration = ++this.lifecycleGeneration;
    this.startupReady = false;
    activeNativeRendererSync = this;
    const backend: BackendKind = isMac ? 'metal' : isWindows ? 'd3d12' : 'vulkan';
    const decodeBackend: DecodeBackendKind = isWindows ? 'ffmpeg_d3d11va' : 'ffmpeg_software';
    await startNativeRenderer({
      backend,
      decode_backend: decodeBackend,
      width,
      height,
      // One coherent native baseline: canonical workload, project output
      // resolution, and the 120 Hz display budget. No adaptive governor.
      target_fps: 120,
      present_mode: 'vsync',
      allow_tearing: false,
      max_frame_latency: 1,
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
      native_quality_policy: 'fixed',
      decode_gpu_bridge_path: this.decodeGpuBridgePath,
    });
    if (!this.ownsLifecycle(lifecycleGeneration)) return;
    const startupStatus = await getNativeRendererStatus().catch(() => null);
    if (!this.ownsLifecycle(lifecycleGeneration)) return;
    this.latestNativeStatus = startupStatus;
    this.assertNativeReady(startupStatus);
    this.syncNativeSourceFrameSize(startupStatus);
    const startupCapabilities = await getNativeRendererCapabilities().catch(() => null);
    if (!this.ownsLifecycle(lifecycleGeneration)) return;
    const startupReadiness = await getNativeRendererReadinessReport().catch(() => null);
    if (!this.ownsLifecycle(lifecycleGeneration)) return;
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
    console.log(
      `[NativeRendererSync] effect-pass descriptors=${this.nativeEffectPassDescriptorIds.size}` +
      ` manifestFlag=${!!startupCapabilities?.features?.native_effect_pass_manifest}`,
    );
    this.nativeComputeGraphSourceFrames = computeGraphSourceFrameHost;
    this.nativeGraphCatalogComplete = computeGraphSourceFrameHost && missingGraphRequirements.length === 0;
    this.resetNativeGraphRouteTelemetry();
    updateNativeRendererRuntimeFromStartup(
      startupStatus,
      startupReadiness,
      startupCapabilities,
      this.nativeGraphCatalogComplete,
      this.nativeComputeGraphSourceFrames,
    );
    if (computeGraphSourceFrameHost && missingGraphRequirements.length > 0) {
      console.warn(
        '[NativeRendererSync] native graph catalog is incomplete; unsupported GPU routes will stay blank in native output',
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
    this.lastStatusLogAt = performance.now();
    this.lastStatusFrameCount = Number(startupStatus?.frames_presented ?? 0);
    this.lastStatusPreviewFrameCount = 0;
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
    if (!this.ownsLifecycle(lifecycleGeneration)) return;
    this.resetSharedTextureUploadTracking();
    this.resetNativeImageDecodeTracking();
    this.resetNativeVideoDecodeTracking();
    this.resetNativeGraphRouteTelemetry();
    this.startupReady = true;
    // Subscribe after startup so the first push lands on a live core.
    // Drop anything still registered from a previous start first: a
    // restart that did not run full teardown (a failed start, a lifecycle
    // race) would otherwise stack a second set of store subscriptions that
    // live for the process, and each one re-pushes on every settings change.
    for (const unsub of this.outputStateUnsubs) {
      try { unsub(); } catch { /* already torn down */ }
    }
    this.outputStateUnsubs = [];
    this.outputStateUnsubs.push(settings.subscribe(() => this.pushOutputState()));
    this.outputStateUnsubs.push(settings.subscribe(() => this.pushOutputStage()));
    this.outputStateUnsubs.push(settings.subscribe(() => this.pushSliceOutputs()));
    if (!this.sliceWindowPoll) {
      void this.refreshOpenSliceWindows();
      this.sliceWindowPoll = setInterval(() => { void this.refreshOpenSliceWindows(); }, 1000);
    }
    this.outputStateUnsubs.push(outputFrozen.subscribe(() => this.pushOutputState()));
    this.outputStateUnsubs.push(vjClipLauncher.subscribe(() => this.scheduleCompositeEffects()));
    this.outputStateUnsubs.push(macros.subscribe(() => this.scheduleCompositeEffects()));
    this.outputStateUnsubs.push(project.subscribe(() => this.scheduleCompositeEffects()));
    flushPendingLibraryVideoArms(this);
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
        `tier=${startupQuality?.active_tier ?? 'unknown'}`,
        `cap=${nativeCaps?.recommended_quality_tier ?? 'unknown'}`,
        `f16=${nativeCaps?.requested_shader_f16 ? 'on' : 'off'}`,
        `floatFilter=${nativeCaps?.requested_float32_filterable ? 'on' : 'off'}`,
      ].join(' '),
    );
  }

  private ownsLifecycle(generation: number): boolean {
    return this.lifecycleGeneration === generation && activeNativeRendererSync === this;
  }

  private async applyStartupPolicies() {
    await resetNativeRendererStats().catch(() => {});
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

  async stop(options: { stopCore?: boolean } = {}) {
    const stopCore = options.stopCore ?? true;
    ++this.lifecycleGeneration;
    this.running = false;
    this.startupReady = false;
    this.flushAgain = false;
    if (this.pendingSyncTimer !== null) {
      clearTimeout(this.pendingSyncTimer);
      this.pendingSyncTimer = null;
    }
    this.pendingSync = false;
    if (activeNativeRendererSync === this) {
      activeNativeRendererSync = null;
    }
    this.stopShaderAnimation();
    this.teardownOutputStateBindings();
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
    this.armedVjSources.clear();
    this.videoMetadataWatches = new WeakSet<HTMLVideoElement>();
    this.videoRefreshAt.clear();
    this.nativeVideoPrefetchAt.clear();
    this.nativeVideoDecodeDimensionCache.clear();
    this.nativeSourceAspectCache.clear();
    this.sourcePreviewSeq.clear();
    this.sourcePreviewNextAt.clear();
    this.sourcePreviewSig.clear();
    this.sourcePreviewFailures.clear();
    this.resetSharedTextureUploadTracking();
    this.resetNativeImageDecodeTracking();
    this.resetNativeVideoDecodeTracking();
    this.resetNativeGraphRouteTelemetry();
    this.latestNativeStatus = null;
    this.previewImageElements.clear();
    this.previewImageLoads.clear();
    this.nativeComputeGraphSourceFrames = false;
    this.nativeGraphCatalogComplete = false;
    this.nativeGraphReadyKinds.clear();
    this.nativeEffectPassDescriptorIds.clear();
    this.nativeGraphRoutes.clear();
    this.nativePointCloudDataCache.clear();
    this.nativePointCloudUploadSignatures.clear();
    this.nativeGraphInstruments.clear();
    this.nativeWgslStdlibWarmed = false;
    this.latestRenderClockSeconds = null;
    this.lastRenderClockSentSeconds = null;
    this.nextStatusPollAt = 0;
    this.nextReadinessPollAt = 0;
    this.statusPollInFlight = false;
    this.lastStatusLogAt = 0;
    this.lastStatusFrameCount = 0;
    this.lastStatusPreviewFrameCount = 0;
    if (!stopCore) {
      return;
    }
    // A newer Canvas may have claimed the app-level renderer while this
    // instance was tearing down. A stale owner must never stop that core.
    if (activeNativeRendererSync && activeNativeRendererSync !== this) {
      return;
    }
    if (this.supportsNativeMethod('clear_decode_preview_cache')) {
      await clearNativeRendererDecodePreviewCache().catch(() => {});
    }
    if (activeNativeRendererSync && activeNativeRendererSync !== this) return;
    await this.clearRuntimeCaches({
      clear_precompiled_shaders: false,
      clear_texture_pool: false,
      clear_metadata_caches: false,
      clear_prefetch_cache: true,
      clear_native_graph_buffers: true,
    }).catch(() => {});
    if (activeNativeRendererSync && activeNativeRendererSync !== this) return;
    if (this.supportsNativeMethod('detach_output_window')) {
      await detachNativeRendererOutputWindow().catch(() => {});
    }
    if (activeNativeRendererSync && activeNativeRendererSync !== this) return;
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

    const hasVisibleNativeLayers = layers.some((layer) => layer.visible);
    const hasContinuousNativeLayers =
      hasVisibleNativeLayers || layers.some((layer) => nativeLayerNeedsContinuousSync(layer));
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
    this.pendingSyncTimer = setTimeout(() => {
      this.pendingSyncTimer = null;
      this.pendingSync = false;
      void this.flush(this.desiredWidth, this.desiredHeight, this.latestLayers);
    }, 16);
  }

  syncNow(width: number, height: number, layers: Layer[]) {
    if (!this.running) return;
    this.desiredWidth = width;
    this.desiredHeight = height;
    this.latestLayers = layers;
    if (this.pendingSyncTimer !== null) {
      clearTimeout(this.pendingSyncTimer);
      this.pendingSyncTimer = null;
    }
    this.pendingSync = false;
    if (!this.startupReady) return;
    void this.flush(this.desiredWidth, this.desiredHeight, this.latestLayers);
  }

  /**
   * Bind a triggered VJ video without waiting for a full scene diff/graph render.
   * The clip launcher has already armed and pre-rolled these source ids, so the
   * core can claim the warm decoder and present its first moving frame in one
   * small transaction. The regular sync still follows to reconcile the scene.
   */
  syncUrgentVideoSources(
    width: number,
    height: number,
    layers: Layer[],
    sourceIds: string[],
  ) {
    if (!this.running || !this.startupReady || sourceIds.length === 0) return;

    this.desiredWidth = width;
    this.desiredHeight = height;
    this.latestLayers = layers;
    // A VJ store emission schedules a normal scene sync before the explicit
    // urgent event reaches Canvas. Cancel that timer so layer diffing and graph
    // work cannot jump ahead of the warm-decoder handoff.
    if (this.pendingSyncTimer !== null) {
      clearTimeout(this.pendingSyncTimer);
      this.pendingSyncTimer = null;
    }
    this.pendingSync = false;
    this.urgentVideoRevision += 1;

    const requested = new Set(sourceIds);
    const renderClock = this.renderClockCommand();
    const now = Date.now();
    const commands: RendererCommand[] = [renderClock];

    for (const [index, layer] of layers.entries()) {
      if (!layer.visible) continue;
      const nativeSource = nativeLayerSource(layer);
      const src = nativeSource.source;
      if (!src || nativeSource.sourceType !== 'video' || !requested.has(src.id)) continue;

      // The first clip launched on an empty VJ row has no resident compositor
      // layer yet. Create only that layer here; waiting for the full scene diff
      // would reintroduce the visible first-click delay this path avoids.
      if (!this.lastLayers.has(layer.id)) {
        const rawVjIndex = Number((layer as any).vjLayerIndex);
        const vjLayerIndex = Number.isFinite(rawVjIndex) ? Math.round(rawVjIndex) : null;
        const nativeUv = this.nativeLayerUvState(layer, nativeSource, width, height);
        const nativeShape = nativeLayerShapeState(layer);
        const nativeMask = nativeLayerMaskState(layer);
        commands.push({
          type: 'upsert_layer',
          layer_id: layer.id,
          z_index: index,
          vj_layer_index: vjLayerIndex,
          blend_mode: layer.type === 'mask' ? 'hierarchy-mask' : canonicalBlendMode(layer.blendMode),
          opacity: layer.opacity,
          deck_monitor_bank: layer._deckMonitorBank ?? null,
          deck_monitor_opacity: layer._deckMonitorOpacity ?? 1,
          corners: layer.corners,
          uv_transform: nativeUv.uvTransform,
          uv_flags: nativeUv.uvFlags,
          shape: nativeShape.shape,
          shape2: nativeShape.shape2,
          shape_meta: nativeShape.shapeMeta,
          shape_points: nativeShape.shapePoints,
          mask_info: nativeMask.info,
          mask_points: nativeMask.points,
          mesh_grid: layer.warpMode === 'mesh' ? layer.meshGrid : null,
        });
      }

      const explicitTime = Number(src._nativePlaybackTimeSeconds);
      // Playback comes first so the core claims/drains the armed session before
      // bind_media_source resolves the layer's texture for this presentation.
      commands.push(this.nativeVideoPlaybackCommand(
        src,
        'video',
        now,
        renderClock,
        Number.isFinite(explicitTime) && explicitTime >= 0 ? explicitTime : undefined,
      ));
      commands.push({
        type: 'bind_media_source',
        layer_id: layer.id,
        source_id: nativeSource.id,
        uri: nativeSource.uri,
        source_type: 'video',
      });
      commands.push({
        type: 'set_layer_visibility',
        layer_id: layer.id,
        visible: true,
      });
    }

    if (commands.length === 1) return;
    commands.push({ type: 'present' });
    return submitNativeRendererCommands(commands)
      .then((summary) => this.warnNativeCommandDrops(summary, 'urgent-vj-video-handoff'))
      .catch((error) => {
        console.warn('[NativeRendererSync] urgent VJ video handoff failed', error);
      });
  }

  forceSync(width: number, height: number, layers: Layer[]) {
    if (!this.running) return;
    this.desiredWidth = width;
    this.desiredHeight = height;
    this.latestLayers = layers;
    this.sentWidth = 0;
    this.sentHeight = 0;
    this.lastLayers.clear();
    if (this.pendingSyncTimer !== null) {
      clearTimeout(this.pendingSyncTimer);
      this.pendingSyncTimer = null;
    }
    this.pendingSync = false;
    if (!this.startupReady) return;
    void this.flush(this.desiredWidth, this.desiredHeight, this.latestLayers);
  }

  setRenderClock(seconds: number | null | undefined) {
    this.latestRenderClockSeconds =
      typeof seconds === 'number' && Number.isFinite(seconds)
        ? Math.max(0, seconds)
        : null;
  }

  /**
   * Offline render: advance every native graph (splat, model3d, text,
   * light painting, GPU instruments…) to an exact virtual time and push
   * the resulting compute/render submissions to the core BEFORE the
   * frame snapshot is taken. Without this the graphs keep animating on
   * the live wall clock while frames are captured, so exported motion
   * runs at wall speed instead of the master render clock.
   */
  async renderManualFrame(seconds: number): Promise<void> {
    this.setRenderClock(seconds);
    if (!this.running || !this.startupReady) return;
    await this.flush(this.desiredWidth, this.desiredHeight, this.latestLayers);
  }

  /** Stop the per-frame sync RAF only. This runs whenever the layer list
   *  stops needing continuous sync (e.g. all layers cleared), so it must
   *  NOT tear down session-lifetime state — that previously lived here and
   *  meant one clear-all silently killed blackout/freeze, composite
   *  effects, output stage and slice bindings for the rest of the session
   *  (they only re-register in start()). */
  private stopShaderAnimation() {
    if (this.shaderAnimationRaf !== null) {
      cancelAnimationFrame(this.shaderAnimationRaf);
      this.shaderAnimationRaf = null;
    }
  }

  /** Full teardown of the output-state store bindings; lifecycle stop only. */
  private teardownOutputStateBindings() {
    for (const unsub of this.outputStateUnsubs) unsub();
    this.outputStateUnsubs = [];
    // Stop any splat texture videos still pumping.
    this.nativeSplatState.forEach((state) => this.releaseNativeSplatTextureVideo(state));
    this.lastOutputBlackout = null;
    this.lastCompositeEffectsSig = null;
    this.lastOutputStageSig = null;
    this.lastSliceOutputsSig = null;
    if (this.sliceWindowPoll) {
      clearInterval(this.sliceWindowPoll);
      this.sliceWindowPoll = null;
    }
    if (this.compositeEffectsFrame !== null) {
      cancelAnimationFrame(this.compositeEffectsFrame);
      this.compositeEffectsFrame = null;
    }
    this.lastOutputFrozen = null;
  }

  private scheduleNativeStatusPoll(now: number) {
    if (now < this.nextStatusPollAt || this.statusPollInFlight) return;
    this.nextStatusPollAt = now + 500;
    const pollReadiness = now >= this.nextReadinessPollAt;
    if (pollReadiness) this.nextReadinessPollAt = now + 2000;
    this.statusPollInFlight = true;
    void (async () => {
      try {
        const status = await getNativeRendererStatus().catch(() => null);
        if (!status || !this.running) return;

        let readiness: RendererReadinessReport | null = null;
        if (pollReadiness) {
          readiness = await getNativeRendererReadinessReport().catch(() => null);
          if (!this.running) return;
        }

        this.latestNativeStatus = status;
        this.syncNativeSourceFrameSize(status);
        // Run the scene reconciler on the poll cadence too — a wedged layer
        // must heal while the scene is idle, not only on the next edit.
        void this.reconcileNativeLayerGeometry();
        this.reconcileSharedTextureUploads(status);
        this.reconcileNativeImageDecodes(status);
        this.reconcileNativeVideoDecodes(status);
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
          nativeGraphRouteFailures: this.nativeGraphRouteFailures,
          nativeGraphRouteSuppressedFailures: this.nativeGraphRouteSuppressedFailures,
          nativeGraphRouteLastFailure: this.nativeGraphRouteLastFailure,
          nativeBlockedLayerCount: this.nativeBlockedLayerCount,
          nativeBlockedEffectLayerCount: this.nativeBlockedEffectLayerCount,
          nativeBlockedSourceLayerCount: this.nativeBlockedSourceLayerCount,
          nativeBlockedLayerLastReason: this.nativeBlockedLayerLastReason,
        });
      } finally {
        this.statusPollInFlight = false;
      }
    })();
  }

  /** Keyframe-timeline and layer-sequencer values, applied to the layer list
   *  the same way Canvas's WebGL body applies them (stash-mutate-restore).
   *  That body never runs when the native core owns the frame, so without
   *  this the timeline ticked and the sequencer stepped while the native
   *  output ignored both. Layers are shallow-cloned — the store's objects
   *  are never mutated — and identity-sensitive fields (source.id, media
   *  elements) are carried by reference so decode sessions and prefetch
   *  keys stay stable across frames.
   *
   *  Continuous-mode sequencer rows use the same opacity gate as normal
   *  rows here: the native core re-renders content every frame regardless
   *  of opacity, so the WebGL-side `_seqGate` distinction (kept to avoid
   *  shader-state resets) has no native equivalent to preserve. */
  private applyTimelineOverrides(layers: Layer[]): Layer[] {
    const kfState = get(keyframeTimeline);
    const kfOverrides = kfState.config.isPlaying ? kfState.activeOverrides : null;
    const seqState = get(layerSequencer);
    const seqOverrides = (seqState.isPlaying || Object.keys(seqState.opacityOverrides ?? {}).length > 0)
      ? seqState.opacityOverrides
      : null;
    if (!kfOverrides && !seqOverrides) return layers;

    let changed = false;
    const mapped = layers.map((layer) => {
      const kf = kfOverrides?.[layer.id];
      const seqMult = seqOverrides?.[layer.id];
      if (!kf && seqMult === undefined) return layer;

      changed = true;
      const next: any = { ...layer };
      if (seqMult !== undefined && seqMult < 1) {
        next.opacity = (next.opacity ?? 1) * seqMult;
      }
      if (kf) {
        let shaderValues: Record<string, any> | null = null;
        let effects: any[] | null = null;
        for (const [key, value] of Object.entries(kf)) {
          if (key === 'layer:opacity') {
            next.opacity = value as number;
          } else if (key.startsWith('shader:') && next.source?.shaderValues) {
            if (shaderValues === null) {
              shaderValues = { ...next.source.shaderValues };
              next.source = { ...next.source, shaderValues };
            }
            shaderValues![key.slice(7)] = value;
          } else if (key.startsWith('fx:') && next.effects?.length) {
            const [, fxId, prop] = key.split(':');
            if (effects === null) {
              effects = next.effects.map((e: any) => ({ ...e, params: { ...e.params } }));
              next.effects = effects;
            }
            const effect = effects!.find((e: any) => e.id === fxId);
            if (effect) {
              if (prop === 'enabled') effect.enabled = !!value;
              else effect.params[prop] = value;
            }
          }
        }
      }
      return next as Layer;
    });
    return changed ? mapped : layers;
  }

  async flush(width: number, height: number, layers: Layer[]) {
    this.desiredWidth = width;
    this.desiredHeight = height;
    this.latestLayers = layers;
    if (this.flushInFlight) {
      this.flushAgain = true;
      return;
    }

    this.flushInFlight = true;
    try {
      do {
        this.flushAgain = false;
        await this.flushOnce(
          this.desiredWidth,
          this.desiredHeight,
          this.applyTimelineOverrides(this.latestLayers),
        );
      } while (this.running && this.startupReady && this.flushAgain);
    } finally {
      this.flushInFlight = false;
    }
  }

  private async flushOnce(width: number, height: number, layers: Layer[]) {
    if (!this.running || !this.startupReady) return;

    const urgentVideoRevisionAtStart = this.urgentVideoRevision;
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
    this.scheduleNativeStatusPoll(now);
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
    let blockedLayerCount = 0;
    let blockedEffectLayerCount = 0;
    let blockedSourceLayerCount = 0;
    let blockedLayerLastReason: string | null = null;
    const unsupportedSourceOptions = {
      nativeVideoDecodePumpReady: this.nativeVideoDecodePumpReady(),
    };

    // Start decoder warm-up as soon as a video enters the scene, but never let
    // pre-roll hold the whole scene flush hostage. The core handles video
    // binding transactionally once the first native frame is resident.
    const videoPrerolls = new Set<string>();
    layers = this.resolveNativeGroupLayers(layers);
    for (const layer of layers) {
      const candidate = nativeLayerSource(layer);
      const src = candidate.source;
      if (
        !layer.visible ||
        !src ||
        candidate.sourceType !== 'video' ||
        !candidate.shouldPrefetch ||
        !this.canUseNativeVideoDecodePump(candidate, candidate.sourceType)
      ) {
        continue;
      }
      const sourceKey = this.sourceCacheKey(src.id, src.src);
      if (this.prefetchedSources.has(sourceKey) || videoPrerolls.has(sourceKey)) continue;
      this.prefetchedSources.add(sourceKey);
      videoPrerolls.add(sourceKey);
      void prefetchNativeRendererMedia(
        src.id,
        src.src,
        videoPrefetchPriority,
        candidate.sourceType,
        this.nativeVideoPrefetchOptions(src, now),
      ).catch((err) => {
        this.prefetchedSources.delete(sourceKey);
        console.warn('[NativeRendererSync] native video pre-roll failed', err);
      });
    }

    layers.forEach((layer, index) => {
      const rawVjIndex = Number((layer as any).vjLayerIndex);
      const vjLayerIndex = Number.isFinite(rawVjIndex) ? Math.round(rawVjIndex) : null;
      const unsupportedNativeEffects = nativeUnsupportedEffectTypes(layer);
      const nativeGraphRouteCandidate = unsupportedNativeEffects.length > 0
        ? null
        : this.nativeGraphRouteForLayer(layer);
      const unsupportedNativeSource = unsupportedNativeEffects.length > 0
        ? null
        : nativeUnsupportedSourceReason(layer, !!nativeGraphRouteCandidate, {
            ...unsupportedSourceOptions,
            routeDisabledByFailures: this.layerRouteDisabledByFailures(layer),
          });
      const nativeLayerBlocked = unsupportedNativeEffects.length > 0 || !!unsupportedNativeSource;
      const nativeBlockSig = unsupportedNativeEffects.length > 0
        ? `native-unsupported-effects:${unsupportedNativeEffects.join(',')}`
        : unsupportedNativeSource
          ? `native-unsupported-source:${unsupportedNativeSource}`
          : '';
      if (layer.visible && nativeLayerBlocked) {
        blockedLayerCount += 1;
        if (unsupportedNativeEffects.length > 0) blockedEffectLayerCount += 1;
        if (unsupportedNativeSource) blockedSourceLayerCount += 1;
        blockedLayerLastReason = `${layer.id}:${nativeBlockSig}`.slice(0, 240);
      }
      const effectiveVisible = layer.visible && !nativeLayerBlocked;
      const nativeGraphRoute = nativeLayerBlocked ? null : nativeGraphRouteCandidate;
      const nativeSource = nativeGraphRoute?.source ?? nativeLayerSource(layer);
      const sourceType = nativeSource.sourceType;
      const nativeParams = nativeGpuParams(layer);
      const nativeUv = this.nativeLayerUvState(layer, nativeSource, width, height);
      const nativeShape = nativeLayerShapeState(layer);
      const nativeMask = nativeLayerMaskState(layer);
      const nativeEdgeEffects = nativeLayerEdgeEffectsState(layer);
      const nativeGraphWorkloadScale = this.nativeGraphWorkloadScale();
      const nativeGraphScaledParams = nativeGraphRoute
        ? nativeGraphParamsForLayer(layer, nativeGraphRoute.kind, nativeGraphWorkloadScale)
        : null;
      const nativeGraphParamsSig = nativeGraphScaledParams
        ? stableNativeGraphKey(nativeGraphScaledParams)
        : 'none';
      const nativeGraphSourceParamsSig = nativeGraphRoute?.kind === 'vj-crossfade'
        ? stableNativeGraphKey({
            layerA: nativeGraphScaledParams?.vjxfadeLayerA ?? '',
            layerB: nativeGraphScaledParams?.vjxfadeLayerB ?? '',
          })
        : nativeGraphRoute?.kind === 'vj-mix'
          ? stableNativeGraphKey({
              rows: (Array.isArray(nativeGraphScaledParams?.vjmixRows)
                ? nativeGraphScaledParams.vjmixRows
                : []).map((row: { layerId?: string }) => String(row?.layerId ?? '')).join(','),
            })
          : nativeGraphParamsSig;
      const nativeGraphEffectSig = nativeGraphRoute?.effectPasses?.map((effectPass) => effectPass.descriptor).join('>') ?? 'none';
      const effectIds = nativeLayerBlocked || nativeGraphRoute?.kind === 'effect-pass' || nativeGraphRoute?.effectPasses?.length
        ? []
        : nativeHeartbeatEffectDescriptors(layer);
      const effectsSig = effectIds.length ? effectIds.join('|') : 'none';
      const graphInputSig = nativeSourceIdentity(nativeGraphRoute?.inputSource);
      const snap: LayerSnapshot = {
        id: layer.id,
        z: index,
        vjIndex: vjLayerIndex,
        visible: effectiveVisible,
        blend: layer.type === 'mask' ? 'hierarchy-mask' : canonicalBlendMode(layer.blendMode),
        opacity: layer.opacity,
        geometrySig: geometrySignature(layer),
        deckMonitorSig: layer._deckMonitorBank
          ? `${layer._deckMonitorBank}:${quantizeNative(layer._deckMonitorOpacity ?? 1)}`
          : 'none',
        uvSig: nativeUv.signature,
        shapeSig: nativeShape.signature,
        maskSig: nativeMask.signature,
        sourceSig: nativeLayerBlocked
          ? nativeBlockSig
          : `${sourceSignature(layer)}:${sourceType}:${nativeSource.uri}:input=${graphInputSig}:graph=${nativeGraphRoute?.kind ?? 'none'}:${nativeGraphSourceParamsSig}:effects=${nativeGraphEffectSig}`,
        nativeParamsSig: nativeParamsSignature(layer),
        effectsSig: nativeLayerBlocked
          ? nativeBlockSig
          : effectsSig,
        edgeEffectsSig: nativeLayerBlocked ? nativeBlockSig : nativeEdgeEffects.signature,
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
        } else if (this.canUseNativeVideoDecodePump(graphInput, graphInput.sourceType)) {
          activeVideoKeys.add(sourceKey);
          this.markNativeVideoDecodePumpFrameReady(graphInputSrc);
          if (graphInput.shouldPrefetch && !this.prefetchedSources.has(sourceKey)) {
            this.prefetchedSources.add(sourceKey);
            void prefetchNativeRendererMedia(
              graphInputSrc.id,
              graphInputSrc.src,
              videoPrefetchPriority,
              graphInput.sourceType,
              this.nativeVideoPrefetchOptions(graphInputSrc, now),
            ).catch(() => {});
          }
          if (!playbackSourcesSent.has(sourceKey)) {
            const playbackCommand = this.nativeVideoPlaybackCommandIfChanged(
              graphInputSrc,
              graphInput.sourceType,
              now,
              renderClock,
            );
            if (playbackCommand) graphInputCommands.push(playbackCommand);
            playbackSourcesSent.add(sourceKey);
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

      if (!prev || prev.z !== snap.z || prev.vjIndex !== snap.vjIndex || prev.visible !== snap.visible || prev.blend !== snap.blend || prev.opacity !== snap.opacity || prev.deckMonitorSig !== snap.deckMonitorSig || prev.geometrySig !== snap.geometrySig || prev.uvSig !== snap.uvSig || prev.shapeSig !== snap.shapeSig || prev.maskSig !== snap.maskSig) {
        commands.push({
          type: 'upsert_layer',
          layer_id: layer.id,
          z_index: index,
          vj_layer_index: vjLayerIndex,
          blend_mode: layer.type === 'mask' ? 'hierarchy-mask' : canonicalBlendMode(layer.blendMode),
          opacity: layer.opacity,
          deck_monitor_bank: layer._deckMonitorBank ?? null,
          deck_monitor_opacity: layer._deckMonitorOpacity ?? 1,
          corners: layer.corners,
          uv_transform: nativeUv.uvTransform,
          uv_flags: nativeUv.uvFlags,
          shape: nativeShape.shape,
          shape2: nativeShape.shape2,
          shape_meta: nativeShape.shapeMeta,
          shape_points: nativeShape.shapePoints,
          mask_info: nativeMask.info,
          mask_points: nativeMask.points,
          mesh_grid: layer.warpMode === 'mesh' ? layer.meshGrid : null,
        });
        commands.push({
          type: 'set_layer_visibility',
          layer_id: layer.id,
          visible: effectiveVisible,
        });
      }

      if (nativeLayerBlocked) {
        if (!prev || prev.effectsSig !== snap.effectsSig) {
          commands.push({
            type: 'set_effect_chain',
            layer_id: layer.id,
            effect_ids: [],
          });
        }
        if (!prev || prev.sourceSig !== snap.sourceSig) {
          commands.push({
            type: 'remove_native_graph_layer',
            layer_id: layer.id,
          });
        }
        return;
      }

      if (!prev || prev.sourceSig !== snap.sourceSig) {
        commands.push({
          type: 'bind_media_source',
          layer_id: layer.id,
          source_id: nativeSource.id,
          uri: nativeSource.uri,
          source_type: sourceType,
        });
        // Real content source, not the effect route's synthetic output
        // (source: null). This block owns precompile + bind_isf_shader —
        // with the old resolution, switching shaders under an active
        // effect never re-bound, so the core kept rendering the previous
        // shader into the chain's input until the effect was toggled.
        const src = nativeGraphRoute?.inputSource?.source ?? nativeSource.source;
        if (src) {
          const sourceKey = this.sourceCacheKey(src.id, src.src);
          const sharedTextureSource = isNativeSharedTextureSource(src, sourceType);
          const nativeStaticImageDecode = this.canUseNativeStaticImageDecode(src, sourceType);
          const nativeVideoDecodePump = this.canUseNativeVideoDecodePump(nativeSource, sourceType);
          if (nativeStaticImageDecode) {
            this.markNativeStaticImageFrameReady(src);
          }
          if (nativeVideoDecodePump) {
            this.markNativeVideoDecodePumpFrameReady(src);
          }
          const dynamicSourceFrameSource = isDynamicSourceFrameSource(src, sourceType);
          if (
            nativeSource.shouldPrefetch &&
            !sharedTextureSource &&
            (sourceType !== 'video' || nativeVideoDecodePump) &&
            !this.prefetchedSources.has(sourceKey)
          ) {
            this.prefetchedSources.add(sourceKey);
            const priority = sourceType === 'video' ? videoPrefetchPriority : mediaPrefetchPriority;
            const options = sourceType === 'video'
              ? this.nativeVideoPrefetchOptions(src, now)
              : undefined;
            void prefetchNativeRendererMedia(src.id, src.src, priority, sourceType, options).catch(() => {});
          }
          if (dynamicSourceFrameSource && !nativeVideoDecodePump) {
            this.videoRefreshAt.set(sourceKey, now + videoRefreshMs);
          } else {
            this.videoRefreshAt.delete(sourceKey);
          }
          if (nativeSource.shouldPreview && !nativeStaticImageDecode && !nativeVideoDecodePump) {
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

      if (
        nativeGraphRoute &&
        NATIVE_EXTERNALLY_QUEUED_GRAPH_KINDS.has(nativeGraphRoute.kind) &&
        (
          !prev ||
          prev.sourceSig !== snap.sourceSig ||
          prev.nativeParamsSig !== snap.nativeParamsSig
        )
      ) {
        commands.push({
          type: 'set_native_graph_layer',
          layer_id: layer.id,
          kind: nativeGraphRoute.kind,
          // Lines and SVG submit their own frame graphs, but the retained
          // entry is still required for the compositor to sample that source.
          instrument_source_id: nativeGraphInstrumentSourceId(nativeGraphRoute),
          composite_source_id: nativeGraphCompositeSourceId(nativeGraphRoute),
          input_source_id: null,
          effect_graph: null,
          params: nativeGraphScaledParams ?? {},
        });
      }

      if (
        nativeGraphRoute &&
        NATIVE_CORE_OWNED_GRAPH_KINDS.has(nativeGraphRoute.kind) &&
        (
          nativeGraphRoute.kind === 'vj-crossfade' ||
          nativeGraphRoute.kind === 'vj-mix' ||
          !prev ||
          prev.sourceSig !== snap.sourceSig ||
          prev.nativeParamsSig !== snap.nativeParamsSig
        )
      ) {
        const graphSource = nativeGraphRenderSource(nativeGraphRoute);
        const graphTime = typeof renderClock.time === 'number' ? renderClock.time : 0;
        const graphDelta = typeof renderClock.time_delta === 'number' ? renderClock.time_delta : 1 / this.targetFps;
        const graphFrameIndex = typeof renderClock.frame_index === 'number' ? renderClock.frame_index : 0;
        const pluginRoute = nativeGraphRoute.kind === 'ghostfx'
          || nativeGraphRoute.kind === 'handfx'
          || nativeGraphRoute.kind === 'performer-world'
          || nativeGraphRoute.kind === 'vj-crossfade'
          || nativeGraphRoute.kind === 'vj-mix';
        const routeState = this.nativeGraphRoutes.get(nativeGraphRoute.key) ?? {
          inFlight: false,
          seq: 0,
          warnings: 0,
          state: null,
          bufferPrefixes: nativeGraphBufferPrefixesForRoute(nativeGraphRoute),
        };
        if (pluginRoute) this.nativeGraphRoutes.set(nativeGraphRoute.key, routeState);
        let installPluginGraph = true;
        let crossfadeGraphOptions: Parameters<typeof buildVJCrossfadeGraph>[0] | null = null;
        if (nativeGraphRoute.kind === 'vj-crossfade') {
          crossfadeGraphOptions = {
            outputSourceId: graphSource.id,
            sourceAId: `layer-frame:${String(nativeGraphScaledParams?.vjxfadeLayerA ?? '')}`,
            sourceBId: `layer-frame:${String(nativeGraphScaledParams?.vjxfadeLayerB ?? '')}`,
            width,
            height,
            mix: Number(nativeGraphScaledParams?.vjxfadeMix ?? 0),
            transition: String(nativeGraphScaledParams?.vjxfadeTransition ?? 'dissolve'),
            blendMode: String(nativeGraphScaledParams?.vjxfadeBlend ?? 'normal'),
            opacityA: Number(nativeGraphScaledParams?.vjxfadeOpacityA ?? 1),
            opacityB: Number(nativeGraphScaledParams?.vjxfadeOpacityB ?? 1),
            time: graphTime,
            frameIndex: graphFrameIndex,
          };
          const topologySig = [
            crossfadeGraphOptions.outputSourceId,
            crossfadeGraphOptions.sourceAId,
            crossfadeGraphOptions.sourceBId,
            width,
            height,
          ].join(':');
          const uniform = buildVJCrossfadeUniformUpdate(crossfadeGraphOptions);
          installPluginGraph = routeState.lastVJCrossfadeTopologySig !== topologySig;
          if (!installPluginGraph && routeState.lastVJCrossfadeUniformSig !== uniform.signature) {
            commands.push({
              type: 'update_native_graph_buffer',
              layer_id: layer.id,
              buffer_id: uniform.bufferId,
              initial_b64: uniform.initialB64,
            });
          }
          routeState.lastVJCrossfadeTopologySig = topologySig;
          routeState.lastVJCrossfadeUniformSig = uniform.signature;
        }
        let vjMixGraphOptions: Parameters<typeof buildVJMixGraph>[0] | null = null;
        if (nativeGraphRoute.kind === 'vj-mix') {
          const rawRows = Array.isArray(nativeGraphScaledParams?.vjmixRows)
            ? nativeGraphScaledParams.vjmixRows as Array<{ layerId?: string; opacity?: number; blendMode?: string }>
            : [];
          const rows: VJMixRow[] = rawRows
            .filter((row) => String(row?.layerId ?? '').length > 0)
            .map((row) => ({
              frameId: `layer-frame:${String(row.layerId)}`,
              opacity: Number(row.opacity ?? 1),
              blendMode: String(row.blendMode ?? 'normal'),
            }));
          if (!rows.length) {
            installPluginGraph = false;
          } else {
            vjMixGraphOptions = {
              outputSourceId: graphSource.id,
              rows,
              width,
              height,
              time: graphTime,
              frameIndex: graphFrameIndex,
            };
            const topologySig = [
              vjMixGraphOptions.outputSourceId,
              ...rows.map((row) => row.frameId),
              width,
              height,
            ].join(':');
            const uniform = buildVJMixUniformUpdate(vjMixGraphOptions);
            installPluginGraph = routeState.lastVJMixTopologySig !== topologySig;
            if (!installPluginGraph && routeState.lastVJMixUniformSig !== uniform.signature) {
              for (const entry of uniform.buffers) {
                commands.push({
                  type: 'update_native_graph_buffer',
                  layer_id: layer.id,
                  buffer_id: entry.bufferId,
                  initial_b64: entry.initialB64,
                });
              }
            }
            routeState.lastVJMixTopologySig = topologySig;
            routeState.lastVJMixUniformSig = uniform.signature;
          }
        }
        if (
          nativeGraphRoute.kind === 'handfx' &&
          nativeGraphScaledParams?.handfxCameraOn !== false &&
          !mediaPipeSource.isRunning()
        ) {
          void mediaPipeSource.start({ useGesture: false, targetFps: 60, numHands: 2 }).catch((error) => {
            console.warn('[NativeRendererSync] HandFX MediaPipe input failed to start', error);
          });
        }
        const pluginGraph = nativeGraphRoute.kind === 'vj-crossfade'
          ? installPluginGraph && crossfadeGraphOptions
            ? buildVJCrossfadeGraph(crossfadeGraphOptions)
            : null
          : nativeGraphRoute.kind === 'vj-mix'
          ? installPluginGraph && vjMixGraphOptions
            ? buildVJMixGraph(vjMixGraphOptions)
            : null
          : pluginRoute
          ? buildNativePluginGraph({
              kind: nativeGraphRoute.kind as 'ghostfx' | 'handfx' | 'performer-world',
              sourceId: graphSource.id,
              params: nativeGraphScaledParams ?? {},
              width,
              height,
              time: graphTime,
              frameDelta: graphDelta,
              frameIndex: graphFrameIndex,
              audio: {
                active: visual.isActive,
                bass: visual.isActive ? Math.max(visual.bass, visual.bassFast * 0.9) : 0,
                mid: visual.isActive ? visual.mid : 0,
                treble: visual.isActive ? visual.treble : 0,
                energy: visual.isActive ? visual.energy : 0,
                beatPhase: visual.beatPhase,
                beatPulse: visual.isActive ? visual.beat : 0,
                amplitude: visual.isActive ? visual.level : 0,
              },
              handFrame: nativeGraphRoute.kind === 'handfx' ? mediaPipeSource.getLastFrame() : null,
              state: routeState.state as NativePluginGraphState | null,
              reset: !routeState.state,
            })
          : null;
        if (pluginGraph && 'state' in pluginGraph) routeState.state = (pluginGraph as { state: NativePluginGraphState }).state;
        const effectGraph = nativeGraphRoute.effectPasses?.length && nativeGraphRoute.source.id !== graphSource.id
          ? buildNativeEffectPassChainGraph({
              sourceId: graphSource.id,
              targetSourceId: nativeGraphRoute.source.id,
              intermediatePrefix: `${nativeGraphRoute.source.id}:chain`,
              effects: nativeGraphRoute.effectPasses.map((effectPass) => ({
                effect: effectPass.effect,
                amount: effectPass.amount,
                mix: 1,
                params: { ...effectPass.params, audioLevel: getVisualAudioSnapshot().level },
              })),
              width,
              height,
              time: graphTime,
              frameDelta: graphDelta,
              frameIndex: graphFrameIndex,
              seq: graphFrameIndex * 16 + 8,
            })
          : null;
        if ((nativeGraphRoute.kind !== 'vj-crossfade' && nativeGraphRoute.kind !== 'vj-mix') || installPluginGraph) {
          commands.push({
            type: 'set_native_graph_layer',
            layer_id: layer.id,
            kind: nativeGraphRoute.kind,
            // The core renders the instrument into its base texture while the
            // compositor samples the post-effect texture. Keeping these IDs
            // distinct prevents the instrument render from overwriting effects.
            instrument_source_id: nativeGraphInstrumentSourceId(nativeGraphRoute),
            composite_source_id: nativeGraphCompositeSourceId(nativeGraphRoute),
            input_source_id: nativeGraphRoute.inputSource?.id ?? null,
            effect_graph: pluginGraph?.config ?? effectGraph?.config ?? null,
            params: nativeGraphScaledParams ?? {},
          });
        }
      } else if (!nativeGraphRoute && prev && prev.sourceSig !== snap.sourceSig) {
        commands.push({
          type: 'remove_native_graph_layer',
          layer_id: layer.id,
        });
      }

      const src = nativeSource.source;
      if (src && isDynamicSourceFrameSource(src, sourceType)) {
        const sourceKey = this.sourceCacheKey(src.id, src.src);
        activeVideoKeys.add(sourceKey);
        const nativeVideoDecodePump = this.canUseNativeVideoDecodePump(nativeSource, sourceType);
        if (sourceType === 'video' && !playbackSourcesSent.has(sourceKey)) {
          const playbackCommand = this.nativeVideoPlaybackCommandIfChanged(
            src,
            sourceType,
            now,
            renderClock,
          );
          if (playbackCommand) commands.push(playbackCommand);
          if (nativeVideoDecodePump) {
            this.markNativeVideoDecodePumpFrameReady(src);
          }
          playbackSourcesSent.add(sourceKey);
        }
        const sharedTextureSource = isNativeSharedTextureSource(src, sourceType);
        if (sharedTextureSource) this.nativeVideoPrefetchAt.delete(sourceKey);
        if (nativeSource.shouldPreview && !nativeVideoDecodePump) {
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

      if (!prev || prev.edgeEffectsSig !== snap.edgeEffectsSig) {
        commands.push({
          type: 'set_layer_edge_effects',
          layer_id: layer.id,
          edge_effects: nativeEdgeEffects.packed,
        });
      }

      // The core owns live cadence and renders every bound shader itself.
      // Electron only sends user-controlled uniforms when their source state changes.
      // Resolve the layer's REAL content source, not the effect route's
      // synthetic output (whose `source` is null). With an effect active,
      // reading nativeSource.source here meant shader rebinds and ISF
      // uniform updates never fired — switching shaders showed stale
      // content until the effect was toggled off/on, and shader params
      // froze the moment an effect was added.
      const src2 = nativeGraphRoute?.inputSource?.source ?? nativeSource.source;
      if (src2?.shaderCode && layer.visible && (!prev || prev.sourceSig !== snap.sourceSig)) {
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
              } else if (val.length >= 3) {
                colorInputs[key] = [val[0], val[1], val[2], val[3] ?? 1];
              }
            }
          }
        }

        // ISF image inputs: resolve each picker ref to a native source id the
        // core can map to a source-frame slot. Layer refs bind that layer's
        // displayed frame; media refs bind the media source (decoded on
        // demand for static images). Unresolvable refs are omitted -> the
        // shader falls back to its own input frame.
        const imageInputs: Record<string, string> = {};
        if (src2.shaderImageInputs) {
          for (const [inputName, ref] of Object.entries(src2.shaderImageInputs)) {
            if (!ref || typeof ref !== 'object' || !ref.id) continue;
            if (ref.type === 'layer') {
              imageInputs[inputName] = `layer-frame:${ref.id}`;
            } else if (ref.type === 'media') {
              const item = get(mediaLibrary).find((media: MediaItem) => media.id === ref.id);
              const mediaSource = item ? mediaItemToNativeLayerSource(item) : null;
              if (mediaSource?.source) {
                imageInputs[inputName] = mediaSource.source.id;
                const decodeKey = `isf-image:${mediaSource.source.id}`;
                if (
                  !this.prefetchedSources.has(decodeKey) &&
                  this.canUseNativeStaticImageDecode(mediaSource.source, mediaSource.sourceType)
                ) {
                  this.prefetchedSources.add(decodeKey);
                  this.markNativeStaticImageFrameReady(mediaSource.source);
                  commands.push({
                    type: 'decode_media_source',
                    source_id: mediaSource.source.id,
                    uri: mediaSource.uri,
                    source_type: mediaSource.sourceType,
                  });
                }
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
          image_inputs: imageInputs,
        });

      }
    });

    this.nativeBlockedLayerCount = blockedLayerCount;
    this.nativeBlockedEffectLayerCount = blockedEffectLayerCount;
    this.nativeBlockedSourceLayerCount = blockedSourceLayerCount;
    this.nativeBlockedLayerLastReason = blockedLayerLastReason;

    this.lastLayers.forEach((_snap, id) => {
      if (!current.has(id)) {
        this.nativePointCloudUploadSignatures.delete(id);
        const splatState = this.nativeSplatState.get(id);
        if (splatState) {
          // A removed splat layer must not leave its texture video playing.
          this.releaseNativeSplatTextureVideo(splatState);
          this.nativeSplatState.delete(id);
        }
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
    this.nativeVideoPlaybackState.forEach((_state, key) => {
      if (!activeVideoKeys.has(key)) this.nativeVideoPlaybackState.delete(key);
    });
    this.nativeVideoDecodeDimensionCache.forEach((_dimensions, key) => {
      if (!activeVideoKeys.has(key) && !this.prefetchedSources.has(key)) {
        this.nativeVideoDecodeDimensionCache.delete(key);
      }
    });

    if (graphInputCommands.length) {
      const graphInputSummary = await submitNativeRendererCommands(graphInputCommands);
      this.warnNativeCommandDrops(graphInputSummary, 'graph-input-source-frames');
    }

    const graphSourceCommands = await this.renderNativeGraphSources(layers, width, height, renderClock, visual);
    commands.push(...graphSourceCommands);

    // A clip was fired while this expensive scene frame was being assembled.
    // Do not let stale pre-trigger commands overwrite the urgent warm-session
    // handoff; the flush loop will immediately rebuild from latestLayers.
    if (urgentVideoRevisionAtStart !== this.urgentVideoRevision) {
      this.flushAgain = true;
      return;
    }

    if (!commands.length) return;

    commands.push({ type: 'present' });

    const batch: CommandBatch = {
      frame_id: ++this.frameId,
      commands,
    };

    const batchSummary = await submitNativeRendererBatch(batch);
    this.warnNativeCommandDrops(batchSummary, 'frame-batch');
    this.lastLayers = current;
    void this.reconcileNativeLayerGeometry();
  }

  private nativeLayerReconcileAt = 0;
  private nativeLayerReconcileInFlight = false;
  private nativeLayerReconcileWarnings = 0;

  // Scene reconciler: the diff-based sync only re-sends what IT believes
  // changed, so a lost or misapplied upsert_layer wedges the picture until
  // some unrelated edit happens to touch the same layer ("preview cropped
  // and misplaced"). Compare the core's actual compositor geometry against
  // what we last sent, and force a re-upsert on any drift.
  private async reconcileNativeLayerGeometry(): Promise<void> {
    const now = performance.now();
    if (this.nativeLayerReconcileInFlight || now - this.nativeLayerReconcileAt < 1000) return;
    this.nativeLayerReconcileAt = now;
    this.nativeLayerReconcileInFlight = true;
    try {
      const snapshot = await getNativeRendererLayersSnapshot().catch((err) => {
        if (this.nativeLayerReconcileWarnings < 3) {
          console.log('[NativeRendererSync] layers_snapshot RPC failed:', err?.message ?? err);
          this.nativeLayerReconcileWarnings += 1;
        }
        return null;
      });
      if (!snapshot?.layers) {
        if (snapshot && this.nativeLayerReconcileWarnings < 3) {
          console.log('[NativeRendererSync] layers_snapshot unexpected shape:', JSON.stringify(snapshot).slice(0, 300));
          this.nativeLayerReconcileWarnings += 1;
        }
        return;
      }
      const coreLayers = new Map(snapshot.layers.map((layer) => [String(layer.layer_id), layer]));
      const drifted: string[] = [];
      this.lastLayers.forEach((snap, id) => {
        const core = coreLayers.get(id);
        let drift = '';
        if (!core) {
          drift = 'missing-from-core';
        } else {
          const sigCorners = snap.geometrySig.startsWith('corners:')
            ? snap.geometrySig.slice('corners:'.length)
            : snap.geometrySig.startsWith('mesh:')
              ? snap.geometrySig.split(':').slice(1, 9).join(':')
              : '';
          if (sigCorners) {
            const sent = sigCorners.split(':').map(Number);
            const applied = (core.corners ?? []).flat().map(Number);
            if (sent.length === 8 && applied.length === 8) {
              for (let i = 0; i < 8; i += 1) {
                if (Math.abs(sent[i] - applied[i]) > 2e-4) {
                  drift = `corner[${i}] sent=${sent[i]} applied=${applied[i]}`;
                  break;
                }
              }
            }
          }
          if (!drift && snap.visible !== !!core.visible) {
            drift = `visibility sent=${snap.visible} applied=${core.visible}`;
          }
          // Wide tolerance: the core smooths opacity over frames, so a
          // mid-fade readback legitimately trails the sent value. Only a
          // wedged opacity (wrong by a lot, forever) is drift.
          if (!drift && snap.visible && Math.abs(snap.opacity - Number(core.opacity)) > 0.1) {
            drift = `opacity sent=${snap.opacity} applied=${core.opacity}`;
          }
          if (!drift && typeof snap.uvSig === 'string' && snap.uvSig.includes('|')) {
            // uvSig format: "x:y:w:h|fit:ratio:flipH:flipV" — matches the
            // core's uv0/uv1 exactly. A drifted ratio squashes the picture
            // inside the layer quad ("preview cropped/misplaced").
            const [uv0Part, uv1Part] = snap.uvSig.split('|');
            const sentUv = [...uv0Part.split(':'), ...uv1Part.split(':')].map(Number);
            const appliedUv = [...(core.uv0 ?? []), ...(core.uv1 ?? [])].map(Number);
            if (sentUv.length === 8 && appliedUv.length === 8) {
              for (let i = 0; i < 8; i += 1) {
                if (Math.abs(sentUv[i] - appliedUv[i]) > 2e-4) {
                  drift = `uv[${i}] sent=${sentUv[i]} applied=${appliedUv[i]}`;
                  break;
                }
              }
            }
          }
        }
        if (drift) drifted.push(`${id}: ${drift}`);
        if (drift) this.lastLayers.delete(id);
      });
      if ((window as any).__NATIVE_SCENE_DEBUG__ !== false) {
        const nowMs = Date.now();
        if (this.lastLayers.size > 0 && nowMs - ((this as any).__sceneBboxAt ?? 0) > 15000) {
          (this as any).__sceneBboxAt = nowMs;
          void (async () => {
            try {
              const frame = await getNativeRendererFrameSnapshot(true);
              const b64 = (frame as any)?.rgba_b64;
              const fw = Number((frame as any)?.width ?? 0);
              const fh = Number((frame as any)?.height ?? 0);
              if (!b64 || !fw || !fh) {
                console.log('[NativeRendererSync] scene-debug bbox: no pixels', JSON.stringify({ fw, fh, keys: Object.keys(frame ?? {}) }));
                return;
              }
              const bin = atob(b64);
              let minX = fw, maxX = -1, minY = fh, maxY = -1;
              for (let y = 0; y < fh; y += 2) {
                for (let x = 0; x < fw; x += 2) {
                  const o = (y * fw + x) * 4;
                  if (bin.charCodeAt(o) > 8 || bin.charCodeAt(o + 1) > 8 || bin.charCodeAt(o + 2) > 8) {
                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;
                  }
                }
              }
              let rSum = 0, gSum = 0, bSum = 0, count = 0;
              for (let y = 0; y < fh; y += 8) {
                for (let x = 0; x < fw; x += 8) {
                  const o = (y * fw + x) * 4;
                  rSum += bin.charCodeAt(o);
                  gSum += bin.charCodeAt(o + 1);
                  bSum += bin.charCodeAt(o + 2);
                  count += 1;
                }
              }
              console.log(`[NativeRendererSync] scene-debug lit bbox ${minX},${minY} -> ${maxX},${maxY} of ${fw}x${fh} meanRGB=${(rSum/count).toFixed(0)},${(gSum/count).toFixed(0)},${(bSum/count).toFixed(0)}`);
            } catch (err: any) {
              console.log('[NativeRendererSync] scene-debug bbox failed:', err?.message ?? err);
            }
          })();
        }
        if (nowMs - ((this as any).__sceneDebugAt ?? 0) > 5000) {
          (this as any).__sceneDebugAt = nowMs;
          console.log('[NativeRendererSync] scene-debug core layers', JSON.stringify(snapshot.layers));
          console.log('[NativeRendererSync] scene-debug sent sigs', JSON.stringify(
            [...this.lastLayers.entries()].map(([id, snap]) => ({
              id,
              geom: snap.geometrySig,
              uv: (snap as any).uvSig,
              shape: (snap as any).shapeSig,
              visible: snap.visible,
            })),
          ));
        }
      }
      if (!drifted.length) return;
      if (this.nativeLayerReconcileWarnings < 20) {
        console.log('[NativeRendererSync] scene reconciler repairing layer drift', JSON.stringify(drifted));
      }
      this.nativeLayerReconcileWarnings += 1;
      this.scheduleSync(this.desiredWidth || 1920, this.desiredHeight || 1080, this.latestLayers);
    } finally {
      this.nativeLayerReconcileInFlight = false;
    }
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
    const identity = nativeLiveSourceIdentity(src) || sharedTextureSenderName(src);
    if (identity) return `${sourceType || src.type || 'shared'}:${identity}`;
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

    this.sharedTextureInfoNextPollAt.set(key, now + 16);
    this.sharedTextureInfoInFlight.add(key);
    void (async () => {
      try {
        const liveSourceType = nativeLiveSourceType(src);
        const identity = nativeLiveSourceIdentity(src);
        const senderName = sharedTextureSenderName(src);
        if (liveSourceType === 'syphon' && senderName && this.sharedTextureReceiverSender !== senderName) {
          const result = await invoke<{ connected?: boolean }>('spout_start_receiver', { senderName });
          if (result?.connected === false) return;
          this.sharedTextureReceiverSender = senderName;
        }

        const info = liveSourceType === 'webcam' || liveSourceType === 'capture'
          ? await invoke<SpoutSharedTextureInfo>('native_live_capture_texture_info', { sessionId: identity })
          : liveSourceType === 'ndi'
            ? await (window as any).ghostNDI?.receiveTextureInfo?.(identity)
            : await receiveSpoutTextureInfo();
        if (!info?.available || !info.handle || !info.width || !info.height) return;
        if (liveSourceType === 'syphon' && senderName && info.senderName && info.senderName !== senderName) return;
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
    this.sourcePreviewNextAt.set(sourceKey, now + LIVE_SHARED_TEXTURE_REFRESH_MS);
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
    // SynthVision / THREE.js canvases are live performance sources — they
    // animate every rAF, so the 360ms video-poster cadence renders them as a
    // slideshow in the native compositor. Capture them at performance rate.
    const liveCanvasSource = !!src.synthVisionCanvas || !!src.threejsCanvas;
    const previewRefreshMs = isNativeSharedTextureSource(src, sourceType)
      ? LIVE_SHARED_TEXTURE_REFRESH_MS
      : liveCanvasSource
        ? LIVE_CANVAS_REFRESH_MS
        : sourceType.startsWith('gpu:')
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
    // Native 2.0 policy: the browser preview is not a renderer and is not
    // allowed to patch missing native source frames with canvas readback.
    // Unsupported sources stay blank until their native ingest path exists.
    if (isVideoLike) {
      this.sourcePreviewNextAt.set(sourceKey, now + previewRefreshMs);
    } else {
      this.sourcePreviewNextAt.set(sourceKey, now + STATIC_PREVIEW_RETRY_MS);
    }
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

    // Procedural sources (FS/ISF shaders, JS shaders, GPU instruments) are
    // rendered BY the core at whatever aspect the layer needs — they have no
    // intrinsic aspect. Measuring one from a DOM preview canvas (whose shape
    // tracks UI panels, not content) and fit-correcting with it squashes the
    // picture inside the quad — the recurring "preview cropped/misplaced".
    const proceduralSource =
      !!nativeSource.source?.shaderCode ||
      layer.type === 'gpu' ||
      nativeSource.sourceType === 'none' ||
      nativeSource.source?.type === 'shader' ||
      nativeSource.source?.type === 'effect';
    // With Stretch (the default) procedural content simply fills the layer —
    // ratio is unused. For explicit Fill/Contain, treat procedural content as
    // project-aspect footage so the fit modes act on shader layers the same
    // way they act on a 16:9 video (Contain letterboxes inside odd shapes).
    const proceduralFitActive = proceduralSource && contentFitCode(layer.contentFit) > 0;
    let sourceAspect = proceduralSource
      ? (proceduralFitActive
          ? clampNumber(outputWidth / Math.max(1, outputHeight), 0.001, 128)
          : layerAspectFromCorners(layer, outputWidth, outputHeight))
      : this.nativeLayerSourceAspect(layer, nativeSource, outputWidth, outputHeight);
    if (crop) {
      sourceAspect *= crop.width / crop.height;
    }
    const layerAspect = layerAspectFromCorners(layer, outputWidth, outputHeight);
    const ratio = clampNumber(sourceAspect / Math.max(0.001, layerAspect), 0.001, 128);
    const shapeActive = !!layer.layerShape?.enabled &&
      layer.layerShape.type !== 'rectangle' &&
      layer.layerShape.type !== 'line' &&
      layer.layerShape.type !== 'polyline';
    // A webcam reads as a mirror unless the operator says otherwise — that is
    // what everyone expects from a selfie feed, and what the WebGL build did.
    // Default it here rather than trusting `mirrorX` to have been set: the
    // tray and VJ paths do set it, but projects saved before that flag existed
    // (and any other producer of a live source) would come through reversed.
    // Still XORed with the layer's own Flip control, so ← → keeps working.
    //
    // Read this off the LAYER's source, not `nativeSource`: once an effect
    // chain or graph route is active, `nativeSource` is the route's synthetic
    // OUTPUT source, which carries neither `mirrorX` nor a live:// URI. Using
    // it made a mirrored webcam flip the moment an effect was added.
    const mirrorOwner = layer.source ?? nativeSource.source;
    const mirrorSource = mirrorOwner?.mirrorX
      ?? (!!mirrorOwner && nativeLiveSourceType(mirrorOwner) === 'webcam');
    const uvFlags: NativeVec4 = [
      shapeActive && layer.contentFit === 'fill' ? 0 : contentFitCode(layer.contentFit),
      quantizeNative(ratio),
      !!layer.flipH !== !!mirrorSource ? 1 : 0,
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
    const sourceKey = source ? this.sourceCacheKey(source.id, source.src) : null;
    if (sourceKey) {
      const cachedAspect = this.nativeSourceAspectCache.get(sourceKey);
      if (cachedAspect) return cachedAspect;
    }
    const rememberAspect = (width: number, height: number): number | null => {
      if (!(width > 0 && height > 0)) return null;
      const aspect = clampNumber(width / height, 0.001, 128);
      if (sourceKey) this.nativeSourceAspectCache.set(sourceKey, aspect);
      return aspect;
    };
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
      if (dims) return rememberAspect(dims.width, dims.height) ?? fallback;
    }
    const anySource = source as any;
    const sourceWidth = Number(anySource?.width ?? anySource?.videoWidth ?? anySource?.naturalWidth ?? 0);
    const sourceHeight = Number(anySource?.height ?? anySource?.videoHeight ?? anySource?.naturalHeight ?? 0);
    const explicitAspect = rememberAspect(sourceWidth, sourceHeight);
    if (explicitAspect) return explicitAspect;

    if (sourceKey) {
      const decodedVideo = this.nativeVideoDecodeDimensionCache.get(sourceKey);
      if (decodedVideo?.metadata) {
        return rememberAspect(decodedVideo.width, decodedVideo.height) ?? fallback;
      }
      const decodedImage = this.previewImageElements.get(sourceKey);
      if (decodedImage?.complete && decodedImage.naturalWidth > 0 && decodedImage.naturalHeight > 0) {
        return rememberAspect(decodedImage.naturalWidth, decodedImage.naturalHeight) ?? fallback;
      }
    }

    if (source && nativeSource.sourceType === 'image') {
      const resolvedImage = this.resolvePreviewElement(
        source,
        nativeSource.sourceType,
        nativeSource.previewElement ?? null,
      );
      if (resolvedImage) {
        const dims = this.previewElementDimensions(resolvedImage);
        if (dims) return rememberAspect(dims.width, dims.height) ?? fallback;
      }
    }
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
    commands.push(...buildLinesNativePrecompileCommands());
    commands.push(...buildSvgNativePrecompileCommands());
    commands.push(...buildLightPaintingNativePrecompileCommands());
    commands.push(...buildTextNativePrecompileCommands());
    commands.push(...buildSplatNativePrecompileCommands());
    commands.push(...buildModel3DNativePrecompileCommands());
    commands.push(...buildSmoke3DNativePrecompileCommands());
    commands.push(...buildInkCloudNativePrecompileCommands());
    commands.push(...buildParticleFieldNativePrecompileCommands());
    commands.push(...buildVolumetricSpheresNativePrecompileCommands());
    commands.push(...buildSmokeRidersNativePrecompileCommands());
    commands.push(...buildFluidRidersNativePrecompileCommands());
    commands.push(...buildFlythroughNativePrecompileCommands());
    commands.push(...buildPixelParticlesNativePrecompileCommands());
    commands.push(...buildPointCloudFXNativePrecompileCommands());
    commands.push(...buildNativePluginPrecompileCommands());
    commands.push(...buildVJCrossfadePrecompileCommands());
    commands.push(...buildVJMixPrecompileCommands());
    commands.push(...buildNativeEffectPassPrecompileCommands());
    await submitNativeRendererBatch({
      frame_id: ++this.frameId,
      commands,
    });
    this.nativeWgslStdlibWarmed = true;
    void this.warmNativeEffectPassPipeline();
    const status = await getNativeRendererStatus().catch(() => null);
    if (status) {
      console.log(
        `[NativeRendererSync] native WGSL warm-up cache=${status.shader_cache_entries} compiled=${status.shader_precompile_compiled} failed=${status.shader_precompile_failed} dropped=${status.shader_precompile_dropped}`,
      );
    }
  }

  /** Build one real effect-pass pipeline at startup.
   *
   *  `precompile_shader` only PARSES the effect-pass module (naga front
   *  end) — Metal's expensive MSL translation + pipeline compile happens at
   *  first `queue_compute_graph`, which is why the first effect a user
   *  added stalled the output for seconds and then "snapped in". All 184
   *  effects share one module and one entry (per-effect behaviour is a
   *  uniform code), so warming a single 16px brightness chain compiles the
   *  pipeline every standard effect chain reuses. History-buffer effects
   *  (motion-trails etc.) have a different binding layout and still pay a
   *  smaller first-use cost. */
  private async warmNativeEffectPassPipeline() {
    if (!this.running) return;
    if (
      !this.supportsNativeFeature('native_effect_pass_manifest') ||
      !this.supportsNativeFeature('compute_graph_texture_sampling') ||
      !this.supportsNativeFeature('compute_graph_source_frame_target')
    ) {
      return;
    }
    try {
      const size = 16;
      const rgba = new Uint8ClampedArray(size * size * 4);
      for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
      const commands: RendererCommand[] = [{
        type: 'upload_source_frame',
        source_id: 'warmup:effect-pass:src',
        seq: 1,
        width: size,
        height: size,
        rgba_b64: encodeAtlasBase64(rgba),
      } as unknown as RendererCommand];
      const graph = buildNativeEffectPassChainGraph({
        sourceId: 'warmup:effect-pass:src',
        targetSourceId: 'warmup:effect-pass:out',
        effects: [{ effect: 'brightness' as NativeEffectPassId, amount: 1, mix: 1, params: {} }],
        width: size,
        height: size,
        time: 0,
        frameDelta: 1 / 60,
        frameIndex: 0,
        seq: 1,
      });
      commands.push({
        type: 'queue_compute_graph',
        ...(graph.config as unknown as Record<string, unknown>),
      } as unknown as RendererCommand);
      await submitNativeRendererBatch({ frame_id: ++this.frameId, commands });
      console.log('[NativeRendererSync] effect-pass pipeline warmed at startup');
    } catch (err) {
      console.warn('[NativeRendererSync] effect-pass warm-up failed (first effect will compile lazily):', err);
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
        if (img.naturalWidth > 0 && img.naturalHeight > 0) {
          this.nativeSourceAspectCache.set(
            key,
            clampNumber(img.naturalWidth / img.naturalHeight, 0.001, 128),
          );
        }
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
    const [status, previewStatus] = await Promise.all([
      getNativeRendererStatus().catch(() => null),
      getNativeEditorPreviewStatus().catch(() => null),
    ]);
    if (status) {
      this.latestNativeStatus = status;
      void this.reconcileNativeLayerGeometry();
      this.reconcileSharedTextureUploads(status);
      this.reconcileNativeImageDecodes(status);
      this.reconcileNativeVideoDecodes(status);
      const now = performance.now();
      const elapsed = this.lastStatusLogAt > 0
        ? Math.max(0.001, (now - this.lastStatusLogAt) / 1000)
        : 0;
      const framesPresented = Number(status.frames_presented ?? 0);
      const nativeFps = elapsed > 0
        ? Math.max(0, framesPresented - this.lastStatusFrameCount) / elapsed
        : 0;
      const previewFramesPresented = Number(
        (previewStatus as any)?.framesPresented ??
        (previewStatus as any)?.addonStatus?.framesPresented ??
        0,
      );
      const previewFps = elapsed > 0
        ? Math.max(0, previewFramesPresented - this.lastStatusPreviewFrameCount) / elapsed
        : 0;
      this.lastStatusLogAt = now;
      this.lastStatusFrameCount = framesPresented;
      this.lastStatusPreviewFrameCount = previewFramesPresented;
      const sourceUploadBreakdown =
        `${status.source_frame_cpu_fallback_uploads}cpu/` +
        `${status.source_frame_file_uploads}file/` +
        `${status.source_frame_base64_uploads}b64/` +
        `${status.source_frame_json_uploads}json/` +
        `${status.source_frame_shared_texture_uploads}shared/` +
        `${status.source_frame_shared_texture_rejected_uploads}sharedReject/` +
          `${status.source_frame_rejected_uploads}reject`;
      console.log(
        `[NativeRendererSync] status backend=${status.backend} ready=${status.backend_ready} adapter=${status.adapter_name ?? 'unknown'} nativeFps=${nativeFps.toFixed(1)} previewFps=${previewFps.toFixed(1)} previewMode=${(previewStatus as any)?.mode ?? 'unknown'} previewAttached=${!!(previewStatus as any)?.attached} quality=${status.native_quality.active_tier}@${status.native_quality.quality_scale.toFixed(2)} clock=${status.render_clock_mode}@${status.render_clock_time.toFixed(3)}s#${status.render_clock_frame_index} layers=${status.layers_seen} blocked=${this.nativeBlockedLayerCount}(${this.nativeBlockedEffectLayerCount}fx/${this.nativeBlockedSourceLayerCount}src) lastBlock=${this.nativeBlockedLayerLastReason ?? 'none'} shaders=${status.shader_cache_entries} compiled=${status.shader_precompile_compiled} failed=${status.shader_precompile_failed} procedural=${status.native_procedural_layers} graphLayers=${status.native_graph_source_frame_layers} proxyLayers=${status.native_instrument_proxy_layers} nativeShaderLayers=${status.native_shader_layers}/${status.isf_shader_bindings} uniforms=${status.isf_uniform_sets} frames=${status.source_frames_active}/${status.source_frame_slots}@${status.source_frame_size}px/${status.source_frame_format}/mips${status.source_frame_mip_levels ?? 1} uploads=${status.source_frame_uploads}(${sourceUploadBreakdown}) last=${status.source_frame_last_upload_transport}:${status.source_frame_last_upload_width}x${status.source_frame_last_upload_height}/${status.source_frame_last_input_bytes}->${status.source_frame_last_upload_bytes}b graphs=${status.compute_graph_runs}/${status.compute_graph_passes} render=${status.compute_graph_render_passes} sourceGraph=${status.compute_graph_source_frame_renders} graphBuffers=${status.compute_graph_persistent_buffers} present=${status.swapchain_last_present_result}:${status.swapchain_presented}/${status.swapchain_present_attempts} fail=${status.output_present_consecutive_failures} preview=${status.source_previews_active}/${status.source_preview_slots}@${status.source_preview_size}px cpu=${status.avg_render_cpu_ms.toFixed(2)}ms gpu=${status.gpu_timing_supported ? status.avg_render_gpu_ms.toFixed(2) : 'off'}ms samples=${status.gpu_timing_samples ?? 0} vjTrig=${Number((status as any).native_video_trigger_last_latency_us ?? 0)}us/max${Number((status as any).native_video_trigger_max_latency_us ?? 0)}us sessions=armed:${Number((status as any).native_video_sessions_armed ?? 0)}+pre:${Number((status as any).native_video_sessions_prerolled ?? 0)} shaderErr=${(status as any).last_shader_error ?? 'none'}`,
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
    if (decodeStoreCpuBackupFrames) {
      console.warn('[NativeRendererSync] CPU decode backup frames are disabled in native-engine-only mode');
    }
    this.decodeStoreCpuBackupFrames = false;
    if (!this.running) return;
    if (!this.supportsNativeMethod('set_decode_cpu_backup_policy')) return;
    await setNativeRendererDecodeCpuBackupPolicy({
      decode_store_cpu_backup_frames: false,
    }).catch(() => {});
  }

  async setDecodeSyntheticFallbackPolicy(decodeAllowSyntheticFallback: boolean) {
    if (decodeAllowSyntheticFallback) {
      console.warn('[NativeRendererSync] Synthetic decode fallback is disabled in native-engine-only mode');
    }
    this.decodeAllowSyntheticFallback = false;
    if (!this.running) return;
    if (!this.supportsNativeMethod('set_decode_synthetic_fallback_policy')) return;
    await setNativeRendererDecodeSyntheticFallbackPolicy({
      decode_allow_synthetic_fallback: false,
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
