import { invoke } from '$lib/bridge';

export type BackendKind = 'd3d11' | 'vulkan' | 'metal';
export type DecodeBackendKind = 'synthetic' | 'ffmpeg_d3d11va';
export type PresentMode = 'vsync' | 'immediate';

export interface RendererStartConfig {
  backend: BackendKind;
  width: number;
  height: number;
  command_queue_capacity?: number;
  command_drain_limit?: number;
  media_queue_capacity?: number;
  decode_handoff_queue_capacity?: number;
  media_high_burst_limit?: number;
  prefetch_cache_max_entries?: number;
  prefetch_cache_prune_count?: number;
  auto_present_on_state_change?: boolean;
  decode_store_cpu_backup_frames?: boolean;
  decode_allow_synthetic_fallback?: boolean;
  target_fps?: number;
  present_mode?: PresentMode;
  allow_tearing?: boolean;
  max_frame_latency?: number;
  use_waitable_object?: boolean;
  vram_budget_mb?: number;
  decode_backend?: DecodeBackendKind;
  decode_preview_size?: number;
  decode_preview_cache_mb?: number;
  decode_use_output_resolution?: boolean;
  decode_upload_queue_cap_mb?: number;
  decode_handoff_byte_cap_mb?: number;
  decode_handoff_predecode_shed_pct?: number;
  decode_predecode_estimate_cache_cap_entries?: number;
  vertex_shader_cache_cap?: number;
  pixel_shader_cache_cap?: number;
  shader_precompile_queue_cap?: number;
  shader_precompile_per_frame?: number;
  shader_metadata_cache_cap?: number;
  pipeline_metadata_cache_cap?: number;
  texture_pool_cap_mb?: number;
  ffmpeg_path?: string;
  decode_gpu_bridge_path?: string;
}

export interface PresentPolicyConfig {
  present_mode: PresentMode;
  allow_tearing: boolean;
  max_frame_latency: number;
  use_waitable_object: boolean;
}

export interface TargetFpsConfig {
  target_fps: number;
}

export interface CommandDrainPolicyConfig {
  max_commands_per_tick: number;
}

export interface AutoPresentPolicyConfig {
  auto_present_on_state_change: boolean;
}

export interface DecodeCpuBackupPolicyConfig {
  decode_store_cpu_backup_frames: boolean;
}

export interface DecodeSyntheticFallbackPolicyConfig {
  decode_allow_synthetic_fallback: boolean;
}

export interface TexturePoolCapConfig {
  texture_pool_cap_mb: number;
}

export interface ShaderPrecompilePolicyConfig {
  shader_precompile_queue_cap: number;
  shader_precompile_per_frame: number;
}

export interface MediaPrefetchPolicyConfig {
  media_high_burst_limit: number;
  prefetch_cache_max_entries: number;
  prefetch_cache_prune_count: number;
}

export interface DecodePreviewPolicyConfig {
  decode_preview_size: number;
  decode_preview_cache_mb: number;
}

export interface DecodeTargetPolicyConfig {
  decode_use_output_resolution: boolean;
}

export interface DecodeUploadPolicyConfig {
  decode_upload_queue_cap_mb: number;
}

export interface DecodeHandoffPolicyConfig {
  decode_handoff_byte_cap_mb: number;
  decode_handoff_predecode_shed_pct: number;
}

export interface DecodeEstimateCachePolicyConfig {
  decode_predecode_estimate_cache_cap_entries: number;
}

export interface MediaDropPolicyConfig {
  command_pressure_pct: number;
  decode_queue_pressure_pct: number;
  io_queue_pressure_pct: number;
  decode_priority_cutoff: number;
  io_priority_cutoff: number;
}

export interface ClearRuntimeCachesConfig {
  clear_precompiled_shaders: boolean;
  clear_texture_pool: boolean;
  clear_metadata_caches: boolean;
  clear_prefetch_cache: boolean;
}

export interface MetadataCacheCapsConfig {
  shader_metadata_cache_cap: number;
  pipeline_metadata_cache_cap: number;
}

export type RendererCommand =
  | { type: 'set_output'; width: number; height: number; refresh_hz: number }
  | { type: 'set_target_fps'; target_fps: number }
  | { type: 'set_command_drain_limit'; max_commands_per_tick: number }
  | { type: 'set_auto_present_policy'; auto_present_on_state_change: boolean }
  | { type: 'set_decode_cpu_backup_policy'; decode_store_cpu_backup_frames: boolean }
  | { type: 'set_decode_synthetic_fallback_policy'; decode_allow_synthetic_fallback: boolean }
  | { type: 'set_texture_pool_cap'; texture_pool_cap_mb: number }
  | { type: 'set_shader_precompile_policy'; queue_cap: number; per_frame: number }
  | { type: 'set_present_policy'; present_mode: PresentMode; allow_tearing: boolean; max_frame_latency: number; use_waitable_object: boolean }
  | { type: 'set_metadata_cache_caps'; shader_cap: number; pipeline_cap: number }
  | { type: 'upsert_layer'; layer_id: string; z_index: number; blend_mode: string; opacity: number }
  | { type: 'set_layer_visibility'; layer_id: string; visible: boolean }
  | { type: 'set_layer_color'; layer_id: string; rgba: [number, number, number, number] }
  | { type: 'set_layer_source_color'; layer_id: string; rgb: [number, number, number] }
  | { type: 'upload_source_preview'; source_id: string; width: number; height: number; rgba: number[]; seq: number }
  | { type: 'upload_source_gpu_shared_texture'; source_id: string; width: number; height: number; shared_handle: string; seq: number }
  | { type: 'remove_layer'; layer_id: string }
  | { type: 'bind_media_source'; layer_id: string; source_id: string; uri: string; source_type: string }
  | { type: 'precompile_shader'; shader_id: string; stage: string; source: string; entry: string }
  | { type: 'set_effect_chain'; layer_id: string; effect_ids: string[] }
  | { type: 'bind_isf_shader'; layer_id: string; shader_id: string }
  | {
      type: 'update_isf_uniforms';
      shader_id: string;
      time: number;
      time_delta: number;
      frame_index: number;
      render_width: number;
      render_height: number;
      date: [number, number, number, number];
      audio_level: number;
      audio_bass: number;
      audio_mid: number;
      audio_high: number;
      audio_beat: number;
      audio_beat_phase: number;
      audio_bpm: number;
      audio_spectral_centroid: number;
      float_inputs: Record<string, number>;
      point_inputs: Record<string, [number, number]>;
      color_inputs: Record<string, [number, number, number, number]>;
    }
  | { type: 'render_isf_to_layer'; layer_id: string }
  | { type: 'present' };

export interface CommandBatch {
  frame_id: number;
  commands: RendererCommand[];
}

export interface RendererStatus {
  running: boolean;
  backend: BackendKind | null;
  backend_ready: boolean;
  adapter_name: string | null;
  decode_backend: DecodeBackendKind;
  decode_preview_size: number;
  decode_preview_cache_mb: number;
  decode_use_output_resolution: boolean;
  decode_gpu_surface_path: boolean;
  decode_target_width: number;
  decode_target_height: number;
  decode_preview_cache_bypassed: boolean;
  decode_upload_queue_cap_mb: number;
  decode_handoff_byte_cap_mb: number;
  decode_handoff_predecode_shed_pct: number;
  shader_precompile_queue_cap: number;
  shader_precompile_per_frame: number;
  shader_metadata_cache_cap: number;
  pipeline_metadata_cache_cap: number;
  decode_backend_ready: boolean;
  decode_backend_last_error: string | null;
  last_frame_error: string | null;
  ffmpeg_active_video_sessions: number;
  decode_hw_frames: number;
  decode_predecode_estimate_cache_entries: number;
  decode_predecode_estimate_cache_cap_entries: number;
  decode_predecode_estimate_cache_backpressure_active: boolean;
  shader_cache_entries: number;
  pipeline_cache_entries: number;
  precompiled_vertex_shaders: number;
  precompiled_pixel_shaders: number;
  target_fps: number;
  present_mode: PresentMode;
  allow_tearing: boolean;
  max_frame_latency: number;
  use_waitable_object: boolean;
  command_queue_capacity: number;
  command_drain_limit: number;
  auto_present_on_state_change: boolean;
  decode_store_cpu_backup_frames: boolean;
  decode_allow_synthetic_fallback: boolean;
  command_drain_limit_hits: number;
  queued_commands_after_drain: number;
  media_queue_capacity: number;
  decode_handoff_queue_capacity: number;
  media_high_burst_limit: number;
  prefetch_cache_max_entries: number;
  prefetch_cache_prune_count: number;
  media_drop_command_pressure_pct: number;
  media_drop_decode_pressure_pct: number;
  media_drop_io_pressure_pct: number;
  media_drop_decode_priority_cutoff: number;
  media_drop_io_priority_cutoff: number;
  output_width: number;
  output_height: number;
  output_refresh_hz: number;
  output_window_attached: boolean;
  output_swapchain_ready: boolean;
  output_tearing_active: boolean;
  output_waitable_object_active: boolean;
  output_present_healthy: boolean;
  output_present_consecutive_failures: number;
  frame_graph_violations: number;
  frames_without_swapchain_present: number;
  last_frame_pass_mask: number;
  last_frame_pass_expected_mask: number;
  device_recovery_attempts: number;
  device_recovery_successes: number;
  device_recovery_failures: number;
  device_recovery_rehydrate_jobs_submitted: number;
  device_recovery_rehydrate_jobs_dropped: number;
  supports_tearing: boolean;
  supports_waitable_object: boolean;
  gpu_timing_supported: boolean;
  avg_render_cpu_ms: number;
  max_render_cpu_ms: number;
  render_cpu_p95_ms: number;
  render_cpu_p99_ms: number;
  last_render_gpu_ms: number;
  avg_render_gpu_ms: number;
  max_render_gpu_ms: number;
  render_gpu_p95_ms: number;
  render_gpu_p99_ms: number;
  frame_budget_overruns: number;
  consecutive_budget_overruns: number;
  max_consecutive_budget_overruns: number;
  queued_commands: number;
  queued_decode_jobs: number;
  queued_io_jobs: number;
  pending_decode_keys: number;
  queued_decode_handoff_bytes: number;
  decode_handoff_queue_bytes_peak: number;
  decode_handoff_capacity_bytes: number;
  decode_handoff_utilization_pct: number;
  decode_pending_upload_count: number;
  decode_pending_upload_bytes: number;
  decode_pending_upload_bytes_peak: number;
  decode_pending_upload_capacity_bytes: number;
  decode_pending_upload_utilization_pct: number;
  decode_pending_upload_backpressure_active: boolean;
  decode_frame_pool_buffers: number;
  decode_frame_pool_bytes: number;
  decode_frame_pool_capacity_buffers: number;
  decode_frame_pool_capacity_bytes: number;
  decode_frame_pool_utilization_pct: number;
  decode_frame_pool_backpressure_active: boolean;
  command_backpressure_active: boolean;
  decode_backpressure_active: boolean;
  io_backpressure_active: boolean;
  decode_handoff_backpressure_active: boolean;
  degraded_mode_active: boolean;
  prefetched_sources: number;
  vram_budget_mb: number;
  vram_used_mb: number;
  vertex_shader_cache_cap: number;
  pixel_shader_cache_cap: number;
  texture_pool_cap_mb: number;
  texture_pool_mb: number;
  dropped_commands: number;
  stale_preview_drops: number;
}

export interface RendererStats {
  frames_submitted: number;
  frames_presented: number;
  frames_presented_explicit: number;
  frames_presented_auto: number;
  commands_applied: number;
  commands_dropped: number;
  batch_commands_coalesced: number;
  command_queue_peak: number;
  command_drain_limit_hits: number;
  queued_commands_after_drain: number;
  draw_calls: number;
  pipeline_switches: number;
  batched_draws: number;
  decode_jobs_submitted: number;
  decode_jobs_completed: number;
  decode_jobs_dropped: number;
  decode_jobs_stale_dropped: number;
  decode_jobs_cache_skipped: number;
  decode_jobs_pending_skipped: number;
  decode_pending_key_forced_clears: number;
  decode_forced_cache_hits: number;
  decode_jobs_policy_dropped: number;
  decode_jobs_forced: number;
  decode_hw_frames: number;
  decode_hard_failures: number;
  decode_predecode_estimate_hits: number;
  decode_predecode_estimate_misses: number;
  decode_predecode_estimate_cache_forced_clears: number;
  decode_predecode_estimate_cache_entries_peak: number;
  decode_queue_peak: number;
  decode_backend_init_attempts: number;
  decode_backend_init_failures: number;
  decode_backend_fallbacks: number;
  shader_precompile_queued: number;
  shader_precompile_compiled: number;
  shader_precompile_failed: number;
  shader_precompile_dropped: number;
  shader_cache_entries: number;
  pipeline_cache_entries: number;
  shader_cache_evictions: number;
  pipeline_cache_evictions: number;
  cache_clear_requests: number;
  metadata_cache_clears: number;
  precompiled_shader_cache_clears: number;
  texture_pool_clears: number;
  precompiled_vertex_shaders: number;
  precompiled_pixel_shaders: number;
  precompiled_shader_evictions: number;
  decode_preview_cache_hits: number;
  decode_preview_cache_misses: number;
  decode_preview_cache_clears: number;
  decode_preview_cache_entries: number;
  decode_preview_cache_bytes: number;
  ffmpeg_decode_spawns: number;
  ffmpeg_decode_successes: number;
  ffmpeg_decode_failures: number;
  decode_software_fallback_frames: number;
  decode_synthetic_fallback_frames: number;
  ffmpeg_active_video_sessions: number;
  ffmpeg_persistent_session_starts: number;
  ffmpeg_persistent_session_restarts: number;
  prefetch_cache_hits: number;
  prefetch_cache_misses: number;
  prefetch_cache_clears: number;
  image_resources: number;
  image_previews_uploaded: number;
  image_preview_bytes: number;
  image_texture_creates: number;
  image_texture_updates: number;
  image_copy_ops: number;
  preview_commands_coalesced: number;
  layer_commands_coalesced: number;
  vram_evictions: number;
  vram_evicted_bytes: number;
  stale_preview_drops: number;
  decode_preview_commits: number;
  decode_unbound_commit_drops: number;
  decode_direct_texture_uploads: number;
  decode_pending_upload_replacements: number;
  decode_pending_upload_policy_drops: number;
  decode_pending_upload_policy_trim_passes: number;
  decode_pending_upload_policy_trimmed_bytes: number;
  decode_pending_upload_count: number;
  decode_pending_upload_bytes: number;
  decode_pending_upload_peak: number;
  decode_pending_upload_bytes_peak: number;
  decode_cpu_backup_frames_stored: number;
  decode_cpu_backup_frames_skipped: number;
  decode_handoff_drops: number;
  decode_handoff_policy_drops: number;
  decode_handoff_predecode_policy_drops: number;
  decode_handoff_predecode_projected_drops: number;
  decode_handoff_predecode_saturation_drops: number;
  decode_handoff_bytes_enqueued: number;
  decode_handoff_bytes_dropped: number;
  decode_handoff_queue_bytes_peak: number;
  io_jobs_submitted: number;
  io_jobs_completed: number;
  io_jobs_dropped: number;
  io_jobs_cache_skipped: number;
  io_jobs_policy_dropped: number;
  io_queue_peak: number;
  last_render_cpu_ms: number;
  avg_render_cpu_ms: number;
  max_render_cpu_ms: number;
  render_cpu_p95_ms: number;
  render_cpu_p99_ms: number;
  last_upload_cpu_ms: number;
  last_composite_cpu_ms: number;
  last_present_cpu_ms: number;
  last_render_gpu_ms: number;
  avg_render_gpu_ms: number;
  max_render_gpu_ms: number;
  render_gpu_p95_ms: number;
  render_gpu_p99_ms: number;
  gpu_timing_supported: boolean;
  gpu_timing_samples: number;
  gpu_timing_disjoint: number;
  gpu_timing_resolve_misses: number;
  frame_budget_overruns: number;
  consecutive_budget_overruns: number;
  max_consecutive_budget_overruns: number;
  last_render_wait_ms: number;
  last_frame_budget_ms: number;
  effective_target_fps: number;
  swapchain_present_attempts: number;
  swapchain_presented: number;
  swapchain_present_failures: number;
  swapchain_present_consecutive_failures: number;
  swapchain_present_max_consecutive_failures: number;
  swapchain_present_tearing_attempts: number;
  swapchain_waitable_waits: number;
  swapchain_waitable_timeouts: number;
  frame_graph_violations: number;
  frames_without_swapchain_present: number;
  last_frame_pass_mask: number;
  last_frame_pass_expected_mask: number;
  device_recovery_attempts: number;
  device_recovery_successes: number;
  device_recovery_failures: number;
  device_recovery_rehydrate_jobs_submitted: number;
  device_recovery_rehydrate_jobs_dropped: number;
}

export interface RendererSnapshot {
  timestamp_ms: number;
  status: RendererStatus;
  stats: RendererStats;
}

export interface RendererReadinessCheck {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
}

export interface RendererReadinessReport {
  timestamp_ms: number;
  overall_ready: boolean;
  blockers: string[];
  checks: RendererReadinessCheck[];
}

export async function startNativeRenderer(config?: Partial<RendererStartConfig>) {
  return invoke<RendererStatus>('native_renderer_start', {
    config: {
      backend: config?.backend ?? 'd3d11',
      width: config?.width ?? 1920,
      height: config?.height ?? 1080,
      command_queue_capacity: config?.command_queue_capacity ?? 8192,
      command_drain_limit: config?.command_drain_limit ?? 1024,
      auto_present_on_state_change: config?.auto_present_on_state_change ?? true,
      decode_store_cpu_backup_frames: config?.decode_store_cpu_backup_frames ?? false,
      decode_allow_synthetic_fallback: config?.decode_allow_synthetic_fallback ?? false,
      media_queue_capacity: config?.media_queue_capacity ?? 2048,
      decode_handoff_queue_capacity: config?.decode_handoff_queue_capacity ?? 4096,
      media_high_burst_limit: config?.media_high_burst_limit ?? 7,
      prefetch_cache_max_entries: config?.prefetch_cache_max_entries ?? 4096,
      prefetch_cache_prune_count: config?.prefetch_cache_prune_count ?? 256,
      target_fps: config?.target_fps ?? 60,
      present_mode: config?.present_mode ?? 'vsync',
      allow_tearing: config?.allow_tearing ?? false,
      max_frame_latency: config?.max_frame_latency ?? 2,
      use_waitable_object: config?.use_waitable_object ?? false,
      vram_budget_mb: config?.vram_budget_mb ?? 4096,
      decode_backend: config?.decode_backend ?? 'ffmpeg_d3d11va',
      decode_preview_size: config?.decode_preview_size ?? 96,
      decode_preview_cache_mb: config?.decode_preview_cache_mb ?? 128,
      decode_upload_queue_cap_mb: config?.decode_upload_queue_cap_mb ?? 256,
      decode_handoff_byte_cap_mb: config?.decode_handoff_byte_cap_mb ?? 128,
      decode_handoff_predecode_shed_pct: config?.decode_handoff_predecode_shed_pct ?? 90,
      decode_predecode_estimate_cache_cap_entries:
        config?.decode_predecode_estimate_cache_cap_entries ?? 8192,
      vertex_shader_cache_cap: config?.vertex_shader_cache_cap ?? 512,
      pixel_shader_cache_cap: config?.pixel_shader_cache_cap ?? 1024,
      shader_precompile_queue_cap: config?.shader_precompile_queue_cap ?? 4096,
      shader_precompile_per_frame: config?.shader_precompile_per_frame ?? 4,
      shader_metadata_cache_cap: config?.shader_metadata_cache_cap ?? 16384,
      pipeline_metadata_cache_cap: config?.pipeline_metadata_cache_cap ?? 16384,
      texture_pool_cap_mb: config?.texture_pool_cap_mb ?? 512,
      ffmpeg_path: config?.ffmpeg_path ?? null,
      decode_gpu_bridge_path: config?.decode_gpu_bridge_path ?? null,
    },
  });
}

export async function stopNativeRenderer() {
  return invoke<void>('native_renderer_stop');
}

export async function submitNativeRendererBatch(batch: CommandBatch) {
  return invoke<void>('native_renderer_submit_batch', { batch });
}

export async function submitNativeRendererCommands(commands: RendererCommand[]) {
  return invoke<void>('native_renderer_submit_commands', { commands });
}

export async function uploadNativeRendererSourceGpuSharedTexture(
  sourceId: string,
  width: number,
  height: number,
  sharedHandle: string,
  seq: number,
) {
  return invoke<void>('native_renderer_upload_source_gpu_shared_texture', {
    source_id: sourceId,
    width,
    height,
    shared_handle: sharedHandle,
    seq,
  });
}

export async function prefetchNativeRendererMedia(sourceId: string, uri: string, priority = 1) {
  return invoke<void>('native_renderer_prefetch_media', {
    source_id: sourceId,
    uri,
    priority,
  });
}

export async function clearNativeRendererPrefetchCache() {
  return invoke<void>('native_renderer_clear_prefetch_cache');
}

export async function clearNativeRendererDecodePreviewCache() {
  return invoke<void>('native_renderer_clear_decode_preview_cache');
}

export async function clearNativeRendererRuntimeCaches(config: ClearRuntimeCachesConfig) {
  return invoke<void>('native_renderer_clear_runtime_caches', { config });
}

export async function setNativeRendererVramBudget(vramBudgetMb: number) {
  return invoke<void>('native_renderer_set_vram_budget', { vram_budget_mb: vramBudgetMb });
}

export async function setNativeRendererTargetFps(config: TargetFpsConfig) {
  return invoke<void>('native_renderer_set_target_fps', { config });
}

export async function setNativeRendererCommandDrainPolicy(config: CommandDrainPolicyConfig) {
  return invoke<void>('native_renderer_set_command_drain_policy', { config });
}

export async function setNativeRendererAutoPresentPolicy(config: AutoPresentPolicyConfig) {
  return invoke<void>('native_renderer_set_auto_present_policy', { config });
}

export async function setNativeRendererDecodeCpuBackupPolicy(
  config: DecodeCpuBackupPolicyConfig,
) {
  return invoke<void>('native_renderer_set_decode_cpu_backup_policy', { config });
}

export async function setNativeRendererDecodeSyntheticFallbackPolicy(
  config: DecodeSyntheticFallbackPolicyConfig,
) {
  return invoke<void>('native_renderer_set_decode_synthetic_fallback_policy', { config });
}

export async function setNativeRendererTexturePoolCap(config: TexturePoolCapConfig) {
  return invoke<void>('native_renderer_set_texture_pool_cap', { config });
}

export async function setNativeRendererShaderPrecompilePolicy(config: ShaderPrecompilePolicyConfig) {
  return invoke<void>('native_renderer_set_shader_precompile_policy', { config });
}

export async function setNativeRendererMediaPrefetchPolicy(config: MediaPrefetchPolicyConfig) {
  return invoke<void>('native_renderer_set_media_prefetch_policy', { config });
}

export async function setNativeRendererMediaDropPolicy(config: MediaDropPolicyConfig) {
  return invoke<void>('native_renderer_set_media_drop_policy', { config });
}

export async function setNativeRendererDecodePreviewPolicy(config: DecodePreviewPolicyConfig) {
  return invoke<void>('native_renderer_set_decode_preview_policy', { config });
}

export async function setNativeRendererDecodeTargetPolicy(config: DecodeTargetPolicyConfig) {
  return invoke<void>('native_renderer_set_decode_target_policy', { config });
}

export async function setNativeRendererDecodeUploadPolicy(config: DecodeUploadPolicyConfig) {
  return invoke<void>('native_renderer_set_decode_upload_policy', { config });
}

export async function setNativeRendererDecodeHandoffPolicy(config: DecodeHandoffPolicyConfig) {
  return invoke<void>('native_renderer_set_decode_handoff_policy', { config });
}

export async function setNativeRendererDecodeEstimateCachePolicy(
  config: DecodeEstimateCachePolicyConfig,
) {
  return invoke<void>('native_renderer_set_decode_estimate_cache_policy', { config });
}

export async function setNativeRendererPresentPolicy(config: PresentPolicyConfig) {
  return invoke<void>('native_renderer_set_present_policy', { config });
}

export async function setNativeRendererMetadataCacheCaps(config: MetadataCacheCapsConfig) {
  return invoke<void>('native_renderer_set_metadata_cache_caps', { config });
}

export async function attachNativeRendererOutputWindow(label?: string) {
  return invoke<void>('native_renderer_attach_output_window', { label: label ?? null });
}

export async function detachNativeRendererOutputWindow() {
  return invoke<void>('native_renderer_detach_output_window');
}

export async function getNativeRendererStatus() {
  return invoke<RendererStatus>('native_renderer_get_status');
}

export async function getNativeRendererStats() {
  return invoke<RendererStats>('native_renderer_get_stats');
}

export async function getNativeRendererSnapshot() {
  return invoke<RendererSnapshot>('native_renderer_get_snapshot');
}

export async function getNativeRendererReadinessReport() {
  return invoke<RendererReadinessReport>('native_renderer_get_readiness_report');
}

export async function exportNativeRendererSnapshotJson(path: string) {
  return invoke<void>('native_renderer_export_snapshot_json', { path });
}

export async function resetNativeRendererStats() {
  return invoke<void>('native_renderer_reset_stats');
}
