import { writable } from 'svelte/store';
import type {
  NativeRendererCapabilities,
  RendererReadinessReport,
  RendererStatus,
} from '$lib/api/native-renderer';

export type NativeRendererDriverMode =
  | 'offline'
  | 'degraded'
  | 'shadow'
  | 'output-driver'
  | 'full-v2';

export interface NativeRendererRuntimeState {
  running: boolean;
  backendReady: boolean;
  adapterName: string | null;
  backend: string | null;
  driverMode: NativeRendererDriverMode;
  outputDriverReady: boolean;
  outputActive: boolean;
  fullV2Ready: boolean;
  shadowReady: boolean;
  graphCatalogComplete: boolean;
  nativeGraphSourceFrames: boolean;
  nativeGraphSourceFrameLayers: number;
  computeGraphRuns: number;
  computeGraphPasses: number;
  sourceFrameSize: number;
  sourceFrameFormat: string;
  sourceFrameMipLevels: number;
  averageGpuMs: number | null;
  readinessDetail: string;
  blockers: string[];
  textureShareLabel: string | null;
  textureSharePlatform: string | null;
  textureShareAvailable: boolean;
  sharedTextureSourceFrameUploadReady: boolean;
  sharedTextureMediaTransportReady: boolean;
  sharedTextureOutputExportReady: boolean;
  nativeEffectPassReady: boolean;
  nativeEffectPassDetail: string;
  nativeTextureShareSenderReady: boolean;
  nativeTextureShareSenderDetail: string;
  nativeOutputShareCapable: boolean;
  nativeOutputShareActive: boolean;
  nativeOutputShareWaitingForFrame: boolean;
  nativeOutputShareLastPublishedFrame: number;
  nativeOutputSharePendingPromotion: boolean;
  nativeOutputSharePromotionAttempts: number;
  nativeOutputSharePromotionReason: string | null;
  updatedAtMs: number;
}

export const initialNativeRendererRuntimeState: NativeRendererRuntimeState = {
  running: false,
  backendReady: false,
  adapterName: null,
  backend: null,
  driverMode: 'offline',
  outputDriverReady: false,
  outputActive: false,
  fullV2Ready: false,
  shadowReady: false,
  graphCatalogComplete: false,
  nativeGraphSourceFrames: false,
  nativeGraphSourceFrameLayers: 0,
  computeGraphRuns: 0,
  computeGraphPasses: 0,
  sourceFrameSize: 0,
  sourceFrameFormat: 'unknown',
  sourceFrameMipLevels: 1,
  averageGpuMs: null,
  readinessDetail: 'native renderer is offline',
  blockers: [],
  textureShareLabel: null,
  textureSharePlatform: null,
  textureShareAvailable: false,
  sharedTextureSourceFrameUploadReady: false,
  sharedTextureMediaTransportReady: false,
  sharedTextureOutputExportReady: false,
  nativeEffectPassReady: false,
  nativeEffectPassDetail: '',
  nativeTextureShareSenderReady: false,
  nativeTextureShareSenderDetail: '',
  nativeOutputShareCapable: false,
  nativeOutputShareActive: false,
  nativeOutputShareWaitingForFrame: false,
  nativeOutputShareLastPublishedFrame: 0,
  nativeOutputSharePendingPromotion: false,
  nativeOutputSharePromotionAttempts: 0,
  nativeOutputSharePromotionReason: null,
  updatedAtMs: 0,
};

export function inferNativeGraphRuntimeFlags(
  capabilities: NativeRendererCapabilities | null | undefined,
  readiness?: RendererReadinessReport | null,
): { graphCatalogComplete: boolean; nativeGraphSourceFrames: boolean } {
  const nativeFeatures = capabilities?.features ?? readiness?.capabilities?.features ?? {};
  const graphInstrumentIds = new Set(
    ((capabilities ?? readiness?.capabilities)?.native_graph_instruments ?? []).map(String),
  );
  const graphManifestEntries = (capabilities ?? readiness?.capabilities)?.native_graph_instrument_manifest ?? [];
  const nativeGraphSourceFrames = !!(
    nativeFeatures.compute_graph_host &&
    nativeFeatures.compute_graph_render &&
    nativeFeatures.compute_graph_source_frame_target
  );
  const graphChecks = (readiness?.checks ?? []).filter((check) =>
    isNativeGraphReadinessCheck(String(check?.id ?? '')),
  );
  const graphCatalogComplete = graphChecks.length > 0
    ? graphChecks.every((check) => !!check?.ok)
    : !!(
      nativeGraphSourceFrames &&
      graphManifestEntries.length > 0 &&
      graphManifestEntries.every((entry) => {
        const id = String(entry?.id ?? '');
        const entryShaderIds = new Set((entry?.shader_ids ?? []).map(String));
        const expectedShaderCount = Number(entry?.shader_count ?? NaN);
        const entryFeatures = (entry?.features ?? []).map(String);
        return (
          id.length > 0 &&
          graphInstrumentIds.has(id) &&
          entryFeatures.length > 0 &&
          entryFeatures.every((feature) => !!nativeFeatures[feature]) &&
          entryShaderIds.size > 0 &&
          Number.isFinite(expectedShaderCount) &&
          expectedShaderCount === entryShaderIds.size &&
          entry?.render_target === 'source_frame' &&
          entry?.source_uri_prefix === `native-graph://${id}/` &&
          String(entry?.parity ?? '').length > 0
        );
      })
    );

  return { graphCatalogComplete, nativeGraphSourceFrames };
}

function isNativeGraphReadinessCheck(id: string): boolean {
  return id.startsWith('native-graph-') || (id.startsWith('native-') && id.endsWith('-graph'));
}

function readinessModeOk(readiness: RendererReadinessReport | null | undefined, mode: string) {
  return !!readiness?.modes?.[mode]?.ok;
}

function readinessModeDetail(
  readiness: RendererReadinessReport | null | undefined,
  mode: string,
): string {
  return String(readiness?.modes?.[mode]?.detail ?? '').trim();
}

function deriveDriverMode(
  status: RendererStatus | null | undefined,
  readiness: RendererReadinessReport | null | undefined,
): NativeRendererDriverMode {
  if (readinessModeOk(readiness, 'full_v2')) return 'full-v2';
  return deriveFallbackDriverMode(status, readiness);
}

function deriveFallbackDriverMode(
  status: RendererStatus | null | undefined,
  readiness: RendererReadinessReport | null | undefined,
): NativeRendererDriverMode {
  if (readinessModeOk(readiness, 'output_driver')) return 'output-driver';
  if (readinessModeOk(readiness, 'shadow')) return 'shadow';
  if (status?.running || status?.backend_ready) return 'degraded';
  return 'offline';
}

function featureEnabled(
  features: NativeRendererCapabilities['features'] | null | undefined,
  feature: string,
): boolean {
  return features?.[feature] === true;
}

function readinessCheckOkOrFallback(
  readiness: RendererReadinessReport | null | undefined,
  id: string,
  fallback: boolean,
): boolean {
  const check = readinessCheck(readiness, id);
  return check ? !!check.ok : fallback;
}

function localMainDriverBlockers(options: {
  status: RendererStatus | null | undefined;
  readiness: RendererReadinessReport | null | undefined;
  capabilities: NativeRendererCapabilities | null | undefined;
  graphCatalogComplete: boolean;
  nativeGraphSourceFrames: boolean;
}): string[] {
  const {
    status,
    readiness,
    capabilities,
    graphCatalogComplete,
    nativeGraphSourceFrames,
  } = options;
  const features = capabilities?.features ?? readiness?.capabilities?.features ?? {};
  const blockers: string[] = [];
  if (!nativeGraphSourceFrames) blockers.push('native graph source-frame rendering is unavailable');
  if (!graphCatalogComplete) blockers.push('native graph instrument catalog is incomplete');

  const nativeEffectPassReady = readinessCheckOkOrFallback(
    readiness,
    'native-effect-pass-manifest',
    !!(
      featureEnabled(features, 'native_effect_pass_manifest') &&
      featureEnabled(features, 'compute_graph_render') &&
      featureEnabled(features, 'compute_graph_texture_sampling') &&
      featureEnabled(features, 'compute_graph_source_frame_target')
    ),
  );
  const nativeOutputDriverReady = readinessCheckOkOrFallback(
    readiness,
    'native-output-driver',
    !!(
      status?.backend_ready &&
      featureEnabled(features, 'native_output_mirror_texture') &&
      featureEnabled(features, 'managed_output_attach') &&
      featureEnabled(features, 'managed_output_window_control') &&
      nativeGraphSourceFrames &&
      graphCatalogComplete &&
      nativeEffectPassReady &&
      featureEnabled(features, 'native_static_image_decode') &&
      featureEnabled(features, 'native_static_image_prefetch')
    ),
  );
  const sharedTextureUploadReady = readinessCheckOkOrFallback(
    readiness,
    'shared-texture-upload',
    featureEnabled(features, 'shared_texture_upload'),
  );
  const outputSharedTextureExportReady = readinessCheckOkOrFallback(
    readiness,
    'shared-texture-output-export',
    featureEnabled(features, 'shared_texture_output_export'),
  );
  const nativeTextureShareSenderReady = readinessCheckOkOrFallback(
    readiness,
    'native-texture-share-sender',
    featureEnabled(features, 'native_texture_share_sender'),
  );
  const nativeMediaDecodeReady = readinessCheckOkOrFallback(
    readiness,
    'native-media-decode',
    !!(
      featureEnabled(features, 'native_media_decode') &&
      featureEnabled(features, 'media_prefetch') &&
      featureEnabled(features, 'native_video_frame_decode') &&
      featureEnabled(features, 'native_video_frame_prefetch') &&
      featureEnabled(features, 'native_video_decode_pump') &&
      featureEnabled(features, 'native_video_decode_pump_window')
    ),
  );
  const nativeRecordingReady = readinessCheckOkOrFallback(
    readiness,
    'native-recording',
    featureEnabled(features, 'native_recording'),
  );
  const nativeStage3DReady = !!(
    featureEnabled(features, 'native_stage3d') &&
    featureEnabled(features, 'native_stage3d_output_renderer') &&
    featureEnabled(features, 'native_stage3d_recording_parity')
  );
  const nativeProjectionSimReady = !!(
    featureEnabled(features, 'native_projection_sim') &&
    featureEnabled(features, 'native_projection_sim_output_renderer') &&
    featureEnabled(features, 'native_projection_sim_recording_parity')
  );

  if (!nativeOutputDriverReady) blockers.push('native output driver is not ready');
  if (!nativeEffectPassReady) blockers.push('native source-frame effect-pass route is incomplete');
  if (!sharedTextureUploadReady) blockers.push('full shared-texture media transport is pending');
  if (!outputSharedTextureExportReady) blockers.push('native output shared-texture export is unavailable');
  if (!nativeTextureShareSenderReady) blockers.push('native texture-share sender is not active-ready');
  if (!nativeMediaDecodeReady) blockers.push('native render-clock video decode pump is not fully ready');
  if (!nativeRecordingReady) blockers.push('native recording/MP4 frame path is not fully ready');
  if (!nativeStage3DReady) blockers.push('native Stage3D renderer/recording parity is pending');
  if (!nativeProjectionSimReady) blockers.push('native projection simulator/recording parity is pending');

  return blockers;
}

function readinessDetailForMode(
  mode: NativeRendererDriverMode,
  status: RendererStatus | null | undefined,
  readiness: RendererReadinessReport | null | undefined,
): string {
  if (mode === 'full-v2') return readinessModeDetail(readiness, 'full_v2') || 'native main driver gates are ready';
  if (mode === 'output-driver') return readinessModeDetail(readiness, 'output_driver') || 'native output driver is ready';
  if (mode === 'shadow') return readinessModeDetail(readiness, 'shadow') || 'native scene sync is active';
  if (mode === 'degraded') return status?.last_frame_error || readiness?.blockers?.[0] || 'native renderer is starting with incomplete readiness gates';
  return 'native renderer is offline';
}

function blockersForMode(
  mode: NativeRendererDriverMode,
  readiness: RendererReadinessReport | null | undefined,
  extraBlockers: string[] = [],
): string[] {
  if (mode === 'full-v2') return [];
  const modeBlockers = readiness?.modes?.full_v2?.blockers ?? [];
  const blockers = readiness?.blockers ?? [];
  return Array.from(new Set([...blockers, ...modeBlockers, ...extraBlockers].map(String).filter(Boolean)));
}

function readinessCheck(
  readiness: RendererReadinessReport | null | undefined,
  id: string,
) {
  return readiness?.checks?.find((check) => check?.id === id) ?? null;
}

export function deriveNativeRendererRuntimeState(
  status: RendererStatus | null | undefined,
  readiness: RendererReadinessReport | null | undefined,
  options: {
    capabilities?: NativeRendererCapabilities | null;
    graphCatalogComplete?: boolean;
    nativeGraphSourceFrames?: boolean;
    updatedAtMs?: number;
  } = {},
): NativeRendererRuntimeState {
  const capabilities = options.capabilities ?? readiness?.capabilities ?? null;
  const features = capabilities?.features ?? {};
  const inferredGraphFlags = inferNativeGraphRuntimeFlags(capabilities, readiness);
  const graphCatalogComplete = !!(options.graphCatalogComplete ?? inferredGraphFlags.graphCatalogComplete);
  const nativeGraphSourceFrames = !!(options.nativeGraphSourceFrames ?? inferredGraphFlags.nativeGraphSourceFrames);
  const advertisedMode = deriveDriverMode(status, readiness);
  const localBlockers = localMainDriverBlockers({
    status,
    readiness,
    capabilities,
    graphCatalogComplete,
    nativeGraphSourceFrames,
  });
  const exposedLocalBlockers = advertisedMode === 'full-v2' ? localBlockers : [];
  const mode = advertisedMode === 'full-v2' && localBlockers.length > 0
    ? deriveFallbackDriverMode(status, readiness)
    : advertisedMode;
  const readinessDetail = advertisedMode === 'full-v2' && localBlockers.length > 0
    ? `native output driver is ready; main driver waiting on ${localBlockers[0]}`
    : readinessDetailForMode(mode, status, readiness);
  const textureShare = readiness?.texture_share ?? null;
  const sourceFrameUploadCheck = readinessCheck(readiness, 'shared-texture-source-frame-upload');
  const sharedTextureUploadCheck = readinessCheck(readiness, 'shared-texture-upload');
  const outputExportCheck = readinessCheck(readiness, 'shared-texture-output-export');
  const nativeEffectPassCheck = readinessCheck(readiness, 'native-effect-pass-manifest');
  const nativeTextureShareCheck = readinessCheck(readiness, 'native-texture-share-sender');

  return {
    running: !!status?.running,
    backendReady: !!status?.backend_ready,
    adapterName: status?.adapter_name ?? null,
    backend: status?.backend ?? capabilities?.backend ?? null,
    driverMode: mode,
    outputDriverReady: readinessModeOk(readiness, 'output_driver'),
    outputActive: readinessModeOk(readiness, 'output_active'),
    fullV2Ready: readinessModeOk(readiness, 'full_v2') && localBlockers.length === 0,
    shadowReady: readinessModeOk(readiness, 'shadow'),
    graphCatalogComplete,
    nativeGraphSourceFrames,
    nativeGraphSourceFrameLayers: Number(status?.native_graph_source_frame_layers ?? 0),
    computeGraphRuns: Number(status?.compute_graph_runs ?? 0),
    computeGraphPasses: Number(status?.compute_graph_passes ?? 0),
    sourceFrameSize: Number(status?.source_frame_size ?? capabilities?.limits?.source_frame_size ?? 0),
    sourceFrameFormat: String(status?.source_frame_format ?? 'unknown'),
    sourceFrameMipLevels: Number(status?.source_frame_mip_levels ?? capabilities?.limits?.source_frame_mip_levels ?? 1),
    averageGpuMs: Number.isFinite(status?.avg_render_gpu_ms) ? Number(status?.avg_render_gpu_ms) : null,
    readinessDetail,
    blockers: blockersForMode(mode, readiness, exposedLocalBlockers),
    textureShareLabel: textureShare?.label ?? null,
    textureSharePlatform: textureShare?.platform ?? null,
    textureShareAvailable: !!textureShare?.available,
    sharedTextureSourceFrameUploadReady: !!(sourceFrameUploadCheck?.ok ?? features.shared_texture_source_frame_upload),
    sharedTextureMediaTransportReady: !!(sharedTextureUploadCheck?.ok ?? features.shared_texture_upload),
    sharedTextureOutputExportReady: !!(outputExportCheck?.ok ?? features.shared_texture_output_export),
    nativeEffectPassReady: !!(nativeEffectPassCheck?.ok ?? features.native_effect_pass_manifest),
    nativeEffectPassDetail: String(nativeEffectPassCheck?.detail ?? ''),
    nativeTextureShareSenderReady: !!(nativeTextureShareCheck?.ok ?? features.native_texture_share_sender),
    nativeTextureShareSenderDetail: String(nativeTextureShareCheck?.detail ?? ''),
    nativeOutputShareCapable: !!textureShare?.nativeOutputCapable,
    nativeOutputShareActive: !!textureShare?.nativeOutputActive,
    nativeOutputShareWaitingForFrame: !!textureShare?.nativeOutputWaitingForFrame,
    nativeOutputShareLastPublishedFrame: Number(textureShare?.nativeOutputLastPublishedFrame ?? 0),
    nativeOutputSharePendingPromotion: !!textureShare?.nativeOutputPendingPromotion,
    nativeOutputSharePromotionAttempts: Number(textureShare?.nativeOutputPromotionAttempts ?? 0),
    nativeOutputSharePromotionReason: textureShare?.nativeOutputPromotionReason ?? null,
    updatedAtMs: options.updatedAtMs ?? Date.now(),
  };
}

export const nativeRendererRuntime = writable<NativeRendererRuntimeState>({
  ...initialNativeRendererRuntimeState,
});

export function updateNativeRendererRuntimeFromStartup(
  status: RendererStatus | null | undefined,
  readiness: RendererReadinessReport | null | undefined,
  capabilities: NativeRendererCapabilities | null | undefined,
  graphCatalogComplete: boolean,
  nativeGraphSourceFrames: boolean,
) {
  nativeRendererRuntime.set(deriveNativeRendererRuntimeState(status, readiness, {
    capabilities,
    graphCatalogComplete,
    nativeGraphSourceFrames,
  }));
}

export function updateNativeRendererRuntimeFromStatus(
  status: RendererStatus | null | undefined,
  options: {
    readiness?: RendererReadinessReport | null;
    capabilities?: NativeRendererCapabilities | null;
    graphCatalogComplete?: boolean;
    nativeGraphSourceFrames?: boolean;
  } = {},
) {
  nativeRendererRuntime.update((current) => {
    const next = deriveNativeRendererRuntimeState(
      status,
      options.readiness,
      {
        capabilities: options.capabilities,
        graphCatalogComplete: options.graphCatalogComplete ?? current.graphCatalogComplete,
        nativeGraphSourceFrames: options.nativeGraphSourceFrames ?? current.nativeGraphSourceFrames,
      },
    );
    if (options.readiness || !status?.running) return next;
    return {
      ...next,
      driverMode: current.driverMode === 'offline' ? next.driverMode : current.driverMode,
      outputDriverReady: current.outputDriverReady,
      outputActive: current.outputActive,
      fullV2Ready: current.fullV2Ready,
      shadowReady: current.shadowReady,
      readinessDetail: current.readinessDetail,
      blockers: current.blockers,
      textureShareLabel: current.textureShareLabel,
      textureSharePlatform: current.textureSharePlatform,
      textureShareAvailable: current.textureShareAvailable,
      sharedTextureSourceFrameUploadReady: current.sharedTextureSourceFrameUploadReady,
      sharedTextureMediaTransportReady: current.sharedTextureMediaTransportReady,
      sharedTextureOutputExportReady: current.sharedTextureOutputExportReady,
      nativeEffectPassReady: current.nativeEffectPassReady,
      nativeEffectPassDetail: current.nativeEffectPassDetail,
      nativeTextureShareSenderReady: current.nativeTextureShareSenderReady,
      nativeTextureShareSenderDetail: current.nativeTextureShareSenderDetail,
      nativeOutputShareCapable: current.nativeOutputShareCapable,
      nativeOutputShareActive: current.nativeOutputShareActive,
      nativeOutputShareWaitingForFrame: current.nativeOutputShareWaitingForFrame,
      nativeOutputShareLastPublishedFrame: current.nativeOutputShareLastPublishedFrame,
      nativeOutputSharePendingPromotion: current.nativeOutputSharePendingPromotion,
      nativeOutputSharePromotionAttempts: current.nativeOutputSharePromotionAttempts,
      nativeOutputSharePromotionReason: current.nativeOutputSharePromotionReason,
    };
  });
}

export function resetNativeRendererRuntime(reason = 'native renderer is offline') {
  nativeRendererRuntime.set({
    ...initialNativeRendererRuntimeState,
    readinessDetail: reason,
    updatedAtMs: Date.now(),
  });
}

export function nativeRendererModeLabel(mode: NativeRendererDriverMode): string {
  if (mode === 'full-v2') return 'Native Main Driver';
  if (mode === 'output-driver') return 'Native Output Driver';
  if (mode === 'shadow') return 'Native Scene Sync';
  if (mode === 'degraded') return 'Native Starting';
  return 'WebGL Fallback';
}
