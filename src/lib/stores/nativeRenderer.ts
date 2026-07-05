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
  updatedAtMs: 0,
};

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
  if (readinessModeOk(readiness, 'output_driver')) return 'output-driver';
  if (readinessModeOk(readiness, 'shadow')) return 'shadow';
  if (status?.running || status?.backend_ready) return 'degraded';
  return 'offline';
}

function readinessDetailForMode(
  mode: NativeRendererDriverMode,
  status: RendererStatus | null | undefined,
  readiness: RendererReadinessReport | null | undefined,
): string {
  if (mode === 'full-v2') return readinessModeDetail(readiness, 'full_v2') || 'native renderer v2 gates are ready';
  if (mode === 'output-driver') return readinessModeDetail(readiness, 'output_driver') || 'native output driver is ready';
  if (mode === 'shadow') return readinessModeDetail(readiness, 'shadow') || 'native shadow sync is active';
  if (mode === 'degraded') return status?.last_frame_error || readiness?.blockers?.[0] || 'native renderer is running with incomplete readiness gates';
  return 'native renderer is offline';
}

function blockersForMode(
  mode: NativeRendererDriverMode,
  readiness: RendererReadinessReport | null | undefined,
): string[] {
  if (mode === 'full-v2') return [];
  const modeBlockers = readiness?.modes?.full_v2?.blockers ?? [];
  const blockers = readiness?.blockers ?? [];
  return Array.from(new Set([...blockers, ...modeBlockers].map(String).filter(Boolean)));
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
  const mode = deriveDriverMode(status, readiness);
  const graphCatalogComplete = !!(
    options.graphCatalogComplete ??
    (
      features.compute_graph_host &&
      features.compute_graph_render &&
      features.compute_graph_source_frame_target &&
      (capabilities?.native_graph_instruments?.length ?? 0) > 0
    )
  );
  const nativeGraphSourceFrames = !!(
    options.nativeGraphSourceFrames ??
    (
      features.compute_graph_host &&
      features.compute_graph_render &&
      features.compute_graph_source_frame_target
    )
  );

  return {
    running: !!status?.running,
    backendReady: !!status?.backend_ready,
    adapterName: status?.adapter_name ?? null,
    backend: status?.backend ?? capabilities?.backend ?? null,
    driverMode: mode,
    outputDriverReady: readinessModeOk(readiness, 'output_driver'),
    outputActive: readinessModeOk(readiness, 'output_active'),
    fullV2Ready: readinessModeOk(readiness, 'full_v2'),
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
    readinessDetail: readinessDetailForMode(mode, status, readiness),
    blockers: blockersForMode(mode, readiness),
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
  if (mode === 'full-v2') return 'Full V2';
  if (mode === 'output-driver') return 'Output Driver';
  if (mode === 'shadow') return 'Shadow';
  if (mode === 'degraded') return 'Degraded';
  return 'Offline';
}
