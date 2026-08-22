import { writable } from 'svelte/store';
import type {
  NativeRendererCapabilities,
  RendererReadinessCheck,
  RendererReadinessReport,
  RendererStatus,
} from '$lib/api/native-renderer';
import { NATIVE_EFFECT_COVERAGE } from '$lib/renderer/nativeEffectCoverage';

export type NativeRendererDriverMode =
  | 'offline'
  | 'native-enabled'
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
  sceneLayersActive: number;
  outputLastPresentedLayerCount: number;
  nativeGraphRouteFailures: number;
  nativeGraphRouteSuppressedFailures: number;
  nativeGraphRouteLastFailure: string | null;
  nativeBlockedLayerCount: number;
  nativeBlockedEffectLayerCount: number;
  nativeBlockedSourceLayerCount: number;
  nativeBlockedLayerLastReason: string | null;
  computeGraphRuns: number;
  computeGraphPasses: number;
  sourceFrameSize: number;
  sourceFrameFormat: string;
  sourceFrameMipLevels: number;
  averageGpuMs: number | null;
  /** True output frame rate, from the core's presented-frame counter. */
  outputFps: number | null;
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
  nativeEffectCoverageComplete: boolean;
  nativeEffectCoverageDetail: string;
  nativeEffectCoverageNative: number;
  nativeEffectCoverageTotal: number;
  nativeEffectCoverageMissing: number;
  nativeTextureShareSenderReady: boolean;
  nativeTextureShareSenderDetail: string;
  nativeRecordingReady: boolean;
  nativeStage3DReady: boolean;
  nativeProjectionSimReady: boolean;
  nativeEditorPreviewPresentation: string;
  nativeEditorPreviewParented: boolean;
  nativeEditorPreviewNeedsUnderlay: boolean;
  nativeEditorPreviewProductionReady: boolean;
  readinessChecks: NativeRendererRuntimeCheck[];
  nativeOutputShareCapable: boolean;
  nativeOutputShareActive: boolean;
  nativeOutputShareWaitingForFrame: boolean;
  nativeOutputShareLastPublishedFrame: number;
  nativeOutputSharePendingPromotion: boolean;
  nativeOutputSharePromotionAttempts: number;
  nativeOutputSharePromotionReason: string | null;
  updatedAtMs: number;
}

export interface NativeRendererRuntimeCheck {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
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
  sceneLayersActive: 0,
  outputLastPresentedLayerCount: 0,
  nativeGraphRouteFailures: 0,
  nativeGraphRouteSuppressedFailures: 0,
  nativeGraphRouteLastFailure: null,
  nativeBlockedLayerCount: 0,
  nativeBlockedEffectLayerCount: 0,
  nativeBlockedSourceLayerCount: 0,
  nativeBlockedLayerLastReason: null,
  computeGraphRuns: 0,
  computeGraphPasses: 0,
  sourceFrameSize: 0,
  sourceFrameFormat: 'unknown',
  sourceFrameMipLevels: 1,
  averageGpuMs: null,
  outputFps: null,
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
  nativeEffectCoverageComplete: NATIVE_EFFECT_COVERAGE.complete,
  nativeEffectCoverageDetail: NATIVE_EFFECT_COVERAGE.detail,
  nativeEffectCoverageNative: NATIVE_EFFECT_COVERAGE.nativeSourceFramePassEffectCount,
  nativeEffectCoverageTotal: NATIVE_EFFECT_COVERAGE.sourceFramePassEligibleEffectCount,
  nativeEffectCoverageMissing: NATIVE_EFFECT_COVERAGE.missingSourceFramePassEffectCount,
  nativeTextureShareSenderReady: false,
  nativeTextureShareSenderDetail: '',
  nativeRecordingReady: false,
  nativeStage3DReady: false,
  nativeProjectionSimReady: false,
  nativeEditorPreviewPresentation: 'unavailable',
  nativeEditorPreviewParented: false,
  nativeEditorPreviewNeedsUnderlay: true,
  nativeEditorPreviewProductionReady: false,
  readinessChecks: [],
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
  if (status?.running || status?.backend_ready) return 'native-enabled';
  return 'offline';
}

function featureEnabled(
  features: NativeRendererCapabilities['features'] | null | undefined,
  feature: string,
): boolean {
  return features?.[feature] === true;
}

function nativeEditorPreviewProductionReady(
  preview: NativeRendererCapabilities['native_editor_preview'] | null | undefined,
): boolean {
  if (!preview || preview.source !== 'core-output-composite' || preview.single_render !== true) return false;
  if (preview.production_ready !== true || preview.needs_underlay_lock_in !== false) return false;
  const mode = String(preview.mode ?? '');
  const presentation = String(preview.presentation ?? '');
  return (
    presentation === 'underlay-zero-copy' ||
    mode === 'shared-texture-import-blit' ||
    mode === 'external-texture-import'
  );
}

function readinessCheckOkOrCapability(
  readiness: RendererReadinessReport | null | undefined,
  id: string,
  capabilityValue: boolean,
): boolean {
  const check = readinessCheck(readiness, id);
  return check ? !!check.ok : capabilityValue;
}

function localMainDriverBlockers(options: {
  status: RendererStatus | null | undefined;
  readiness: RendererReadinessReport | null | undefined;
  capabilities: NativeRendererCapabilities | null | undefined;
  graphCatalogComplete: boolean;
  nativeGraphSourceFrames: boolean;
  nativeGraphRouteFailures?: number;
  nativeBlockedLayerCount?: number;
  nativeBlockedLayerLastReason?: string | null;
}): string[] {
  const {
    status,
    readiness,
    capabilities,
    graphCatalogComplete,
    nativeGraphSourceFrames,
    nativeGraphRouteFailures = 0,
    nativeBlockedLayerCount = 0,
    nativeBlockedLayerLastReason = null,
  } = options;
  const features = capabilities?.features ?? readiness?.capabilities?.features ?? {};
  const blockers: string[] = [];
  if (status?.adapter_is_software) {
    // WARP / software rasterizer: the compatibility fallback for machines
    // with no usable GPU. Everything renders, slowly — the operator needs
    // to know this is a degraded mode, not a broken install.
    blockers.push(
      `SOFTWARE RENDERING — no usable GPU was found (adapter: ${status?.adapter_name ?? 'software'}). ` +
      'Expect very low frame rates. Ghost Arcade is designed for a Metal (macOS) or Direct3D 12 (Windows) capable GPU.',
    );
  }
  if (!nativeGraphSourceFrames) blockers.push('native graph source-frame rendering is unavailable');
  if (!graphCatalogComplete) blockers.push('native graph instrument catalog is incomplete');
  if (nativeGraphRouteFailures > 0) {
    blockers.push(`${nativeGraphRouteFailures} native graph route miss${nativeGraphRouteFailures === 1 ? '' : 'es'}`);
  }
  if (nativeBlockedLayerCount > 0) {
    blockers.push(
      `${nativeBlockedLayerCount} visible layer${nativeBlockedLayerCount === 1 ? '' : 's'} blocked by native inventory${nativeBlockedLayerLastReason ? `: ${nativeBlockedLayerLastReason}` : ''}`,
    );
  }

  const nativeEffectPassReady = readinessCheckOkOrCapability(
    readiness,
    'native-effect-pass-manifest',
    !!(
      featureEnabled(features, 'native_effect_pass_manifest') &&
      featureEnabled(features, 'compute_graph_render') &&
      featureEnabled(features, 'compute_graph_texture_sampling') &&
      featureEnabled(features, 'compute_graph_source_frame_target')
    ),
  );
  const nativeOutputDriverReady = readinessCheckOkOrCapability(
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
  const sharedTextureUploadReady = readinessCheckOkOrCapability(
    readiness,
    'shared-texture-upload',
    featureEnabled(features, 'shared_texture_upload'),
  );
  const outputSharedTextureExportReady = readinessCheckOkOrCapability(
    readiness,
    'shared-texture-output-export',
    featureEnabled(features, 'shared_texture_output_export'),
  );
  const nativeTextureShareSenderReady = readinessCheckOkOrCapability(
    readiness,
    'native-texture-share-sender',
    featureEnabled(features, 'native_texture_share_sender'),
  );
  const nativeEditorPreviewFrameSourceReady = readinessCheckOkOrCapability(
    readiness,
    'native-editor-preview-frame-source',
    featureEnabled(features, 'native_editor_preview_frame_source'),
  );
  const nativeEditorPreviewProductionCheck = readinessCheck(readiness, 'native-editor-preview-production');
  const nativeEditorPreviewProductionReadyValue = !!(
    nativeEditorPreviewProductionCheck?.ok ??
    nativeEditorPreviewProductionReady(capabilities?.native_editor_preview)
  );
  const nativeMediaDecodeReady = readinessCheckOkOrCapability(
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
  const nativeRecordingReady = readinessCheckOkOrCapability(
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
  if (!nativeEditorPreviewFrameSourceReady) blockers.push('editor preview is not consuming the native core frame source');
  if (!nativeEditorPreviewProductionReadyValue) blockers.push('editor preview presenter is not production zero-copy');
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
  if (mode === 'native-enabled') {
    const blocker = readiness?.modes?.full_v2?.blockers?.[0] || readiness?.blockers?.[0];
    return blocker
      ? `native surfaces enabled; full-v2 pending: ${blocker}`
      : status?.last_frame_error || readinessModeDetail(readiness, 'full_v2') || 'native surfaces enabled';
  }
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

function normalizeRuntimeChecks(
  checks: RendererReadinessCheck[] | null | undefined,
): NativeRendererRuntimeCheck[] {
  return (checks ?? []).map((check) => ({
    id: String(check?.id ?? ''),
    label: String(check?.label ?? check?.id ?? ''),
    ok: !!check?.ok,
    detail: String(check?.detail ?? ''),
  })).filter((check) => check.id.length > 0);
}

export function deriveNativeRendererRuntimeState(
  status: RendererStatus | null | undefined,
  readiness: RendererReadinessReport | null | undefined,
  options: {
    capabilities?: NativeRendererCapabilities | null;
    graphCatalogComplete?: boolean;
    nativeGraphSourceFrames?: boolean;
    nativeGraphRouteFailures?: number;
    nativeGraphRouteSuppressedFailures?: number;
    nativeGraphRouteLastFailure?: string | null;
    nativeBlockedLayerCount?: number;
    nativeBlockedEffectLayerCount?: number;
    nativeBlockedSourceLayerCount?: number;
    nativeBlockedLayerLastReason?: string | null;
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
    nativeGraphRouteFailures: options.nativeGraphRouteFailures,
    nativeBlockedLayerCount: options.nativeBlockedLayerCount,
    nativeBlockedLayerLastReason: options.nativeBlockedLayerLastReason,
  });
  const mode = advertisedMode === 'full-v2' && localBlockers.length > 0
    ? 'native-enabled'
    : advertisedMode;
  const readinessDetail = advertisedMode === 'full-v2' && localBlockers.length > 0
    ? `native surfaces enabled; full-v2 pending: ${localBlockers[0]}`
    : readinessDetailForMode(mode, status, readiness);
  const textureShare = readiness?.texture_share ?? null;
  const sourceFrameUploadCheck = readinessCheck(readiness, 'shared-texture-source-frame-upload');
  const sharedTextureUploadCheck = readinessCheck(readiness, 'shared-texture-upload');
  const outputExportCheck = readinessCheck(readiness, 'shared-texture-output-export');
  const nativeEffectPassCheck = readinessCheck(readiness, 'native-effect-pass-manifest');
  const nativeTextureShareCheck = readinessCheck(readiness, 'native-texture-share-sender');
  const nativeRecordingCheck = readinessCheck(readiness, 'native-recording');
  const nativeStage3DOutputCheck = readinessCheck(readiness, 'native-stage3d-output-renderer');
  const nativeStage3DRecordingCheck = readinessCheck(readiness, 'native-stage3d-recording-parity');
  const nativeProjectionOutputCheck = readinessCheck(readiness, 'native-projection-sim-output-renderer');
  const nativeProjectionRecordingCheck = readinessCheck(readiness, 'native-projection-sim-recording-parity');
  const nativeEditorPreviewProductionCheck = readinessCheck(readiness, 'native-editor-preview-production');
  const nativeEditorPreview = (capabilities?.native_editor_preview ?? {}) as NonNullable<
    NativeRendererCapabilities['native_editor_preview']
  >;
  const nativeEditorPreviewPresentation = String(nativeEditorPreview.presentation ?? 'unavailable');
  const nativeEditorPreviewProductionReadyValue = !!(
    nativeEditorPreviewProductionCheck?.ok ??
    nativeEditorPreviewProductionReady(nativeEditorPreview)
  );

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
    sceneLayersActive: Number(status?.scene_layers_active ?? 0),
    outputLastPresentedLayerCount: Number(status?.output_last_presented_layer_count ?? 0),
    nativeGraphRouteFailures: Math.max(0, Number(options.nativeGraphRouteFailures ?? 0)),
    nativeGraphRouteSuppressedFailures: Math.max(0, Number(options.nativeGraphRouteSuppressedFailures ?? 0)),
    nativeGraphRouteLastFailure: options.nativeGraphRouteLastFailure !== undefined
      ? options.nativeGraphRouteLastFailure
      : null,
    nativeBlockedLayerCount: Math.max(0, Number(options.nativeBlockedLayerCount ?? 0)),
    nativeBlockedEffectLayerCount: Math.max(0, Number(options.nativeBlockedEffectLayerCount ?? 0)),
    nativeBlockedSourceLayerCount: Math.max(0, Number(options.nativeBlockedSourceLayerCount ?? 0)),
    nativeBlockedLayerLastReason: options.nativeBlockedLayerLastReason !== undefined
      ? options.nativeBlockedLayerLastReason
      : null,
    computeGraphRuns: Number(status?.compute_graph_runs ?? 0),
    computeGraphPasses: Number(status?.compute_graph_passes ?? 0),
    sourceFrameSize: Number(status?.source_frame_size ?? capabilities?.limits?.source_frame_size ?? 0),
    sourceFrameFormat: String(status?.source_frame_format ?? 'unknown'),
    sourceFrameMipLevels: Number(status?.source_frame_mip_levels ?? capabilities?.limits?.source_frame_mip_levels ?? 1),
    averageGpuMs: Number.isFinite(status?.avg_render_gpu_ms) ? Number(status?.avg_render_gpu_ms) : null,
    outputFps: null,   /* filled per poll by updateNativeRendererRuntimeFromStatus */
    readinessDetail,
    blockers: blockersForMode(mode, readiness, localBlockers),
    textureShareLabel: textureShare?.label ?? null,
    textureSharePlatform: textureShare?.platform ?? null,
    textureShareAvailable: !!textureShare?.available,
    sharedTextureSourceFrameUploadReady: !!(sourceFrameUploadCheck?.ok ?? features.shared_texture_source_frame_upload),
    sharedTextureMediaTransportReady: !!(sharedTextureUploadCheck?.ok ?? features.shared_texture_upload),
    sharedTextureOutputExportReady: !!(outputExportCheck?.ok ?? features.shared_texture_output_export),
    nativeEffectPassReady: !!(nativeEffectPassCheck?.ok ?? features.native_effect_pass_manifest),
    nativeEffectPassDetail: String(nativeEffectPassCheck?.detail ?? ''),
    nativeEffectCoverageComplete: NATIVE_EFFECT_COVERAGE.complete,
    nativeEffectCoverageDetail: NATIVE_EFFECT_COVERAGE.detail,
    nativeEffectCoverageNative: NATIVE_EFFECT_COVERAGE.nativeSourceFramePassEffectCount,
    nativeEffectCoverageTotal: NATIVE_EFFECT_COVERAGE.sourceFramePassEligibleEffectCount,
    nativeEffectCoverageMissing: NATIVE_EFFECT_COVERAGE.missingSourceFramePassEffectCount,
    nativeTextureShareSenderReady: !!(nativeTextureShareCheck?.ok ?? features.native_texture_share_sender),
    nativeTextureShareSenderDetail: String(nativeTextureShareCheck?.detail ?? ''),
    nativeRecordingReady: !!(nativeRecordingCheck?.ok ?? features.native_recording),
    nativeStage3DReady: !!(
      (nativeStage3DOutputCheck?.ok ?? features.native_stage3d_output_renderer) &&
      (nativeStage3DRecordingCheck?.ok ?? features.native_stage3d_recording_parity)
    ),
    nativeProjectionSimReady: !!(
      (nativeProjectionOutputCheck?.ok ?? features.native_projection_sim_output_renderer) &&
      (nativeProjectionRecordingCheck?.ok ?? features.native_projection_sim_recording_parity)
    ),
    nativeEditorPreviewPresentation,
    nativeEditorPreviewParented: nativeEditorPreview.parented === true ||
      nativeEditorPreviewPresentation === 'parented-overlay' ||
      nativeEditorPreviewPresentation === 'parented-underlay-probe',
    nativeEditorPreviewNeedsUnderlay: nativeEditorPreview.needs_underlay_lock_in !== false,
    nativeEditorPreviewProductionReady: nativeEditorPreviewProductionReadyValue,
    readinessChecks: normalizeRuntimeChecks(readiness?.checks),
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

/** Layer ids whose native graph route was permanently disabled by the
 *  3-failure kill switch. Feeds the Layer Panel badge so a blanked layer is
 *  visibly failed rather than silently empty. Cleared per-layer when the
 *  route recovers (edit, or restart). */
export const nativeFailedRouteLayers = writable<string[]>([]);

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

/*
 * Output frame rate, measured from the core's own presented-frame counter.
 *
 * The FPS readout used to show only the editor's render loop, labelled "UI"
 * because that is honestly what it was -- with the native core owning
 * rendering, the editor's loop says nothing about what reaches a projector. The
 * core does not report a rate, but it counts frames_presented, so the real
 * figure is a delta over wall time.
 *
 * Deliberately computed HERE rather than in deriveNativeRendererRuntimeState:
 * that function is pure and may be called more than once for the same status
 * (and is, from tests), and every extra call would divide a zero frame delta by
 * a near-zero interval and produce garbage. This is the one place that runs
 * exactly once per poll.
 */
let lastPresentedFrames = 0;
let lastPresentedAt = 0;
let smoothedOutputFps: number | null = null;

export function resetOutputFpsTracking() {
  lastPresentedFrames = 0;
  lastPresentedAt = 0;
  smoothedOutputFps = null;
}

function measureOutputFps(status: RendererStatus | null | undefined): number | null {
  const presented = Number((status as any)?.frames_presented ?? NaN);
  if (!Number.isFinite(presented) || !status?.running) {
    resetOutputFpsTracking();
    return null;
  }
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  if (lastPresentedAt === 0) {
    lastPresentedFrames = presented;
    lastPresentedAt = now;
    return null;                        /* no interval yet; do not guess */
  }
  const elapsed = (now - lastPresentedAt) / 1000;
  if (elapsed < 0.25) return smoothedOutputFps;   /* too short to be meaningful */

  const delta = presented - lastPresentedFrames;
  lastPresentedFrames = presented;
  lastPresentedAt = now;
  if (delta < 0) { smoothedOutputFps = null; return null; }   /* core restarted */

  const instant = delta / elapsed;
  /* Light smoothing: the poll interval is not locked to the frame clock, so the
     raw ratio jitters by a few frames even when output is perfectly steady. */
  smoothedOutputFps = smoothedOutputFps === null
    ? instant
    : smoothedOutputFps + (instant - smoothedOutputFps) * 0.35;
  return smoothedOutputFps;
}

export function updateNativeRendererRuntimeFromStatus(
  status: RendererStatus | null | undefined,
  options: {
    readiness?: RendererReadinessReport | null;
    capabilities?: NativeRendererCapabilities | null;
    graphCatalogComplete?: boolean;
    nativeGraphSourceFrames?: boolean;
    nativeGraphRouteFailures?: number;
    nativeGraphRouteSuppressedFailures?: number;
    nativeGraphRouteLastFailure?: string | null;
    nativeBlockedLayerCount?: number;
    nativeBlockedEffectLayerCount?: number;
    nativeBlockedSourceLayerCount?: number;
    nativeBlockedLayerLastReason?: string | null;
  } = {},
) {
  const measuredFps = measureOutputFps(status);
  nativeRendererRuntime.update((current) => {
    const next = deriveNativeRendererRuntimeState(
      status,
      options.readiness,
      {
        capabilities: options.capabilities,
        graphCatalogComplete: options.graphCatalogComplete ?? current.graphCatalogComplete,
        nativeGraphSourceFrames: options.nativeGraphSourceFrames ?? current.nativeGraphSourceFrames,
        nativeGraphRouteFailures: options.nativeGraphRouteFailures ?? current.nativeGraphRouteFailures,
        nativeGraphRouteSuppressedFailures: options.nativeGraphRouteSuppressedFailures ??
          current.nativeGraphRouteSuppressedFailures,
        nativeGraphRouteLastFailure: options.nativeGraphRouteLastFailure !== undefined
          ? options.nativeGraphRouteLastFailure
          : current.nativeGraphRouteLastFailure,
        nativeBlockedLayerCount: options.nativeBlockedLayerCount ?? current.nativeBlockedLayerCount,
        nativeBlockedEffectLayerCount: options.nativeBlockedEffectLayerCount ?? current.nativeBlockedEffectLayerCount,
        nativeBlockedSourceLayerCount: options.nativeBlockedSourceLayerCount ?? current.nativeBlockedSourceLayerCount,
        nativeBlockedLayerLastReason: options.nativeBlockedLayerLastReason !== undefined
          ? options.nativeBlockedLayerLastReason
          : current.nativeBlockedLayerLastReason,
      },
    );
    next.outputFps = measuredFps;
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
      nativeRecordingReady: current.nativeRecordingReady,
      nativeStage3DReady: current.nativeStage3DReady,
      nativeProjectionSimReady: current.nativeProjectionSimReady,
      readinessChecks: current.readinessChecks,
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
  if (mode === 'native-enabled') return 'Native Enabled';
  return 'Native Offline';
}

export function nativeRendererOutputShareTransportLabel(
  state: Pick<NativeRendererRuntimeState, 'textureShareLabel' | 'textureSharePlatform'>,
): string {
  const label = `${state.textureShareLabel ?? ''} ${state.textureSharePlatform ?? ''}`.toLowerCase();
  if (label.includes('syphon') || label.includes('iosurface')) return 'IOSurface';
  if (label.includes('spout') || label.includes('dxgi')) return 'DXGI';
  return 'shared texture';
}

export function nativeRendererOutputShareSummary(
  state: Pick<
    NativeRendererRuntimeState,
    | 'textureShareLabel'
    | 'textureSharePlatform'
    | 'textureShareAvailable'
    | 'nativeTextureShareSenderReady'
    | 'nativeOutputShareCapable'
    | 'nativeOutputShareActive'
    | 'nativeOutputShareWaitingForFrame'
    | 'nativeOutputSharePendingPromotion'
    | 'nativeOutputSharePromotionAttempts'
  >,
): string {
  const label = state.textureShareLabel || state.textureSharePlatform || 'Texture share';
  const transport = nativeRendererOutputShareTransportLabel(state);
  if (state.nativeOutputShareActive) return `${label}: native output ${transport} active`;
  if (state.nativeOutputShareWaitingForFrame) return `${label}: waiting for first native output frame`;
  if (state.nativeOutputSharePendingPromotion) {
    return `${label}: promoting native output (${state.nativeOutputSharePromotionAttempts} check${state.nativeOutputSharePromotionAttempts === 1 ? '' : 's'})`;
  }
  if (state.nativeTextureShareSenderReady) return `${label}: native output ready`;
  if (state.nativeOutputShareCapable) return `${label}: native output capable when sender starts`;
  if (state.textureShareAvailable) return `${label}: OSR texture-share bridge available`;
  return state.textureShareLabel ? `${label}: unavailable` : '';
}

export function nativeRendererMainDriverGateChecks(
  state: NativeRendererRuntimeState,
): NativeRendererRuntimeCheck[] {
  const checks = new Map(state.readinessChecks.map((check) => [check.id, check]));
  const gate = (
    id: string,
    label: string,
    ok: boolean,
    detail: string,
  ): NativeRendererRuntimeCheck => checks.get(id) ?? { id, label, ok, detail };
  const graphReady = state.nativeGraphSourceFrames && state.graphCatalogComplete;
  const stageReady = state.nativeStage3DReady && state.nativeProjectionSimReady;

  return [
    {
      id: 'native-inventory',
      label: 'Native inventory',
      ok: state.nativeBlockedLayerCount === 0,
      detail: state.nativeBlockedLayerCount === 0
        ? 'all visible project layers are owned by the native renderer'
        : `${state.nativeBlockedLayerCount} blocked layer${state.nativeBlockedLayerCount === 1 ? '' : 's'} (${state.nativeBlockedEffectLayerCount} effect, ${state.nativeBlockedSourceLayerCount} source); ${state.nativeBlockedLayerLastReason ?? 'reason unavailable'}`,
    },
    {
      id: 'native-graph-routing',
      label: 'Native graph routing',
      ok: graphReady,
      detail: graphReady
        ? 'all native instrument graph routes are cataloged and source-frame ready'
        : 'native instrument graph catalog/source-frame routing is incomplete',
    },
    gate(
      'native-effect-pass-manifest',
      'Effect pass route',
      state.nativeEffectPassReady,
      state.nativeEffectPassDetail || 'native source-frame effect pass manifest is not ready',
    ),
    {
      id: 'native-effect-coverage',
      label: 'Effect coverage',
      ok: state.nativeEffectCoverageComplete,
      detail: state.nativeEffectCoverageDetail,
    },
    gate(
      'shared-texture-upload',
      'Media texture transport',
      state.sharedTextureMediaTransportReady,
      state.sharedTextureMediaTransportReady
        ? 'full shared-texture media transport is ready'
        : 'full shared-texture media transport is pending',
    ),
    gate(
      'shared-texture-output-export',
      'Output texture export',
      state.sharedTextureOutputExportReady,
      state.sharedTextureOutputExportReady
        ? 'native output is exported as a shared GPU texture'
        : 'native output shared-texture export is unavailable',
    ),
    gate(
      'native-texture-share-sender',
      `${state.textureShareLabel || 'Texture-share'} sender`,
      state.nativeTextureShareSenderReady,
      state.nativeTextureShareSenderDetail || 'native texture-share sender is not active-ready',
    ),
    gate(
      'native-editor-preview-frame-source',
      'Editor preview source',
      !!checks.get('native-editor-preview-frame-source')?.ok,
      checks.get('native-editor-preview-frame-source')?.detail ||
        'editor preview is not consuming the native core frame source',
    ),
    gate(
      'native-editor-preview-production',
      'Editor preview zero-copy',
      state.nativeEditorPreviewProductionReady,
      checks.get('native-editor-preview-production')?.detail ||
        'editor preview presenter is not production zero-copy',
    ),
    gate(
      'native-output-driver',
      'Output driver',
      state.outputDriverReady,
      state.outputDriverReady ? 'native output driver is ready' : 'native output driver is not ready',
    ),
    gate(
      'native-recording',
      'Recording path',
      state.nativeRecordingReady,
      state.nativeRecordingReady ? 'native recording path is ready' : 'native recording path is not fully ready',
    ),
    {
      id: 'native-3d-scene-renderers',
      label: 'Stage/Projection parity',
      ok: stageReady,
      detail: stageReady
        ? 'Stage3D and Projection Sim render/record through the native path'
        : 'Stage3D or Projection Sim native renderer/recording parity is pending',
    },
  ];
}
