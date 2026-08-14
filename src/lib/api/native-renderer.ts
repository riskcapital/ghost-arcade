import { invoke } from '$lib/bridge';

export type BackendKind = 'd3d11' | 'd3d12' | 'vulkan' | 'metal';
export type DecodeBackendKind = 'synthetic' | 'ffmpeg_software' | 'ffmpeg_d3d11va';
export type PresentMode = 'vsync' | 'immediate';
export type NativeQualityPolicy = 'fixed' | 'auto' | 'performance' | 'balanced' | 'ultra' | 'insane';

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
  native_quality_policy?: NativeQualityPolicy;
  ffmpeg_path?: string;
  decode_gpu_bridge_path?: string;
  editor_parent_window_handle_hex?: string;
  editor_parent_window_handle_platform?: 'appkit-nsview' | 'win32-hwnd' | string;
}

export interface PresentPolicyConfig {
  present_mode: PresentMode;
  allow_tearing: boolean;
  max_frame_latency: number;
  use_waitable_object: boolean;
}

export interface OutputWindowConfig {
  title?: string;
  label?: string;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  attached?: boolean;
  visible?: boolean;
  enabled?: boolean;
  fullscreen?: boolean;
  full_screen?: boolean;
  borderless?: boolean;
  resizable?: boolean;
  decorations?: boolean;
  decorated?: boolean;
  cursor_hittest?: boolean;
  input_enabled?: boolean;
  input_transparent?: boolean;
  click_through?: boolean;
  always_on_top?: boolean;
  always_on_bottom?: boolean;
  underlay?: boolean;
}

export interface NativeEditorPreviewRect {
  x: number;
  y: number;
  width: number;
  height: number;
  contentX?: number;
  contentY?: number;
  contentWidth?: number;
  contentHeight?: number;
  generation?: number;
}

export interface NativeEditorPreviewPresenterStatus {
  available: boolean;
  attached: boolean;
  pumpActive?: boolean;
  addonPath?: string | null;
  candidates?: readonly string[];
  error?: string | null;
  mode?: 'shared-texture-import-blit' | 'unavailable' | string;
  presentation?: 'underlay-zero-copy' | 'unavailable' | string;
  transport?: 'iosurface' | 'dxgi' | 'none' | string;
  lastPresentedFrame?: number;
  framesPresented?: number;
  failCount?: number;
  width?: number;
  height?: number;
  lastSurfaceID?: number;
  rect?: NativeEditorPreviewRect;
  geometryMatches?: boolean;
  addonStatus?: Record<string, unknown> | null;
}

export interface TargetFpsConfig {
  target_fps: number;
}

export interface RenderClockConfig {
  mode: 'live' | 'manual' | 'reset';
  time?: number;
  time_delta?: number;
  frame_index?: number;
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

export interface NativeQualityPolicyConfig {
  native_quality_policy: NativeQualityPolicy;
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
  clear_native_graph_buffers?: boolean;
  native_graph_buffer_prefixes?: string[];
}

export interface MetadataCacheCapsConfig {
  shader_metadata_cache_cap: number;
  pipeline_metadata_cache_cap: number;
}

export type RendererCommand =
  | { type: 'set_output'; width: number; height: number; refresh_hz: number }
  | { type: 'set_output_state'; blackout?: boolean; frozen?: boolean }
  | {
      type: 'set_composite_effects';
      effects: Array<{ descriptor: string; mix?: number }>;
    }
  | {
      type: 'set_output_stage';
      rotation?: number;
      cropX?: number;
      cropY?: number;
      cropWidth?: number;
      cropHeight?: number;
      brightness?: number;
      contrast?: number;
      gamma?: number;
      edgeBlendLeft?: number;
      edgeBlendRight?: number;
      edgeBlendTop?: number;
      edgeBlendBottom?: number;
      edgeBlendGamma?: number;
      domeEnabled?: boolean;
      domeMode?: number;
      domeFOV?: number;
      domeRotation?: number;
      domeTilt?: number;
      domeOffsetX?: number;
      domeOffsetY?: number;
      domeCurvature?: number;
      domeTruncation?: number;
      testPattern?: number;
      masterWarp?: Record<string, unknown>;
    }
  | {
      type: 'set_slice_outputs';
      slices: Array<Record<string, unknown>>;
    }
  | { type: 'set_target_fps'; target_fps: number }
  | { type: 'set_render_clock'; mode: 'live' | 'manual' | 'reset'; time?: number; time_delta?: number; frame_index?: number }
  | {
      type: 'set_media_source_playback';
      source_id: string;
      uri: string;
      source_type: string;
      time_seconds: number;
      clock_time_seconds: number;
      playback_rate: number;
      paused: boolean;
      loop_enabled: boolean;
      trim_start?: number;
      trim_end?: number;
      duration_seconds?: number;
      decode_width?: number;
      decode_height?: number;
      seek_generation?: number;
      seq?: number;
    }
  | { type: 'set_command_drain_limit'; max_commands_per_tick: number }
  | { type: 'set_auto_present_policy'; auto_present_on_state_change: boolean }
  | { type: 'set_vram_budget'; vram_budget_mb: number }
  | { type: 'set_decode_cpu_backup_policy'; decode_store_cpu_backup_frames: boolean }
  | { type: 'set_decode_synthetic_fallback_policy'; decode_allow_synthetic_fallback: boolean }
  | {
      type: 'set_media_prefetch_policy';
      media_queue_capacity?: number;
      decode_handoff_queue_capacity?: number;
      media_high_burst_limit: number;
      prefetch_cache_max_entries: number;
      prefetch_cache_prune_count: number;
    }
  | {
      type: 'set_media_drop_policy';
      command_pressure_pct: number;
      decode_queue_pressure_pct: number;
      io_queue_pressure_pct: number;
      decode_priority_cutoff: number;
      io_priority_cutoff: number;
    }
  | { type: 'set_decode_preview_policy'; decode_preview_size: number; decode_preview_cache_mb: number }
  | { type: 'set_decode_target_policy'; decode_use_output_resolution: boolean }
  | { type: 'set_decode_upload_policy'; decode_upload_queue_cap_mb: number }
  | {
      type: 'set_decode_handoff_policy';
      decode_handoff_byte_cap_mb: number;
      decode_handoff_predecode_shed_pct: number;
    }
  | {
      type: 'set_decode_estimate_cache_policy';
      decode_predecode_estimate_cache_cap_entries: number;
    }
  | { type: 'set_texture_pool_cap'; texture_pool_cap_mb: number }
  | { type: 'set_shader_precompile_policy'; queue_cap: number; per_frame: number }
  | { type: 'set_present_policy'; present_mode: PresentMode; allow_tearing: boolean; max_frame_latency: number; use_waitable_object: boolean }
  | { type: 'set_metadata_cache_caps'; shader_cap: number; pipeline_cap: number }
  | {
      type: 'upsert_layer';
      layer_id: string;
      z_index: number;
      vj_layer_index?: number | null;
      blend_mode: string;
      opacity: number;
      /** Deck confidence monitor tag — bank the core re-renders this layer
       *  into ('a'/'b'), at deck_monitor_opacity (true pre-crossfader level). */
      deck_monitor_bank?: 'a' | 'b' | null;
      deck_monitor_opacity?: number;
      corners?: {
        topLeft: { x: number; y: number };
        topRight: { x: number; y: number };
        bottomLeft: { x: number; y: number };
        bottomRight: { x: number; y: number };
      };
      uv_transform?: [number, number, number, number];
      uv_flags?: [number, number, number, number];
      shape?: [number, number, number, number];
      shape2?: [number, number, number, number];
      shape_meta?: [number, number, number, number];
      shape_points?: Array<[number, number, number, number]>;
      mesh_grid?: {
        rows: number;
        cols: number;
        points: Array<Array<{ x: number; y: number }>>;
      } | null;
      mask_info?: [number, number, number, number];
      mask_points?: Array<[number, number, number, number]>;
    }
  | { type: 'set_layer_visibility'; layer_id: string; visible: boolean }
  | { type: 'set_layer_color'; layer_id: string; rgba: [number, number, number, number] }
  | { type: 'set_layer_source_color'; layer_id: string; rgb: [number, number, number] }
  | { type: 'set_layer_native_params'; layer_id: string; params: [number, number, number, number, number, number, number, number] }
  | { type: 'set_layer_edge_effects'; layer_id: string; edge_effects: number[][][] }
  | {
      type: 'set_native_graph_layer';
      layer_id: string;
      kind: string;
      instrument_source_id: string;
      composite_source_id: string;
      input_source_id?: string | null;
      effect_graph: Record<string, unknown> | null;
      params: Record<string, unknown>;
    }
  | {
      type: 'update_native_graph_buffer';
      layer_id: string;
      buffer_id: string;
      initial_b64: string;
    }
  | { type: 'remove_native_graph_layer'; layer_id: string }
  | {
      type: 'upload_native_point_cloud';
      layer_id: string;
      signature: string;
      point_count: number;
      sort_count: number;
      depth_sort_enabled: boolean;
      home_b64: string;
      live_b64: string;
      sort_b64: string;
    }
  | {
      type: 'set_audio_state';
      active: boolean;
      level: number;
      bass: number;
      mid: number;
      treble: number;
      high: number;
      beat: number;
      beat_phase: number;
      bpm: number;
      centroid: number;
      kick: number;
      snare: number;
    }
  | { type: 'upload_source_preview'; source_id: string; width: number; height: number; rgba: number[]; seq: number }
  | {
      type: 'upload_source_frame';
      source_id: string;
      width: number;
      height: number;
      rgba?: number[];
      rgba_buffer?: ArrayBuffer | Uint8Array | Uint8ClampedArray;
      rgba_b64?: string;
      rgba_file?: string;
      rgba_byte_length?: number;
      rgba_file_delete?: boolean;
      shared_handle?: string;
      shared_texture?: string | Record<string, unknown>;
      shared_texture_platform?: 'spout' | 'syphon' | 'dxgi' | 'iosurface' | string;
      shared_texture_format?: number | string;
      shared_texture_handle_encoding?: string;
      shared_texture_handle_byte_length?: number;
      shared_texture_frame?: number;
      shared_texture_sender_name?: string;
      seq: number;
    }
  | {
      type: 'upload_source_gpu_shared_texture';
      source_id: string;
      width: number;
      height: number;
      shared_handle: string;
      seq: number;
      platform?: 'spout' | 'syphon' | 'dxgi' | 'iosurface' | string;
      format?: number | string;
      handle_encoding?: string;
      handle_byte_length?: number;
      frame?: number;
      sender_name?: string;
    }
  | { type: 'remove_layer'; layer_id: string }
  | { type: 'bind_media_source'; layer_id: string; source_id: string; uri: string; source_type: string }
  | {
      type: 'decode_media_source';
      source_id: string;
      uri: string;
      source_type: string;
      decode_width?: number;
      decode_height?: number;
      time_seconds?: number;
      prefetch_window_frames?: number;
      prefetch_fps?: number;
      scrub_preview?: boolean;
      seq?: number;
    }
  | { type: 'set_stage3d_scene'; scene: unknown }
  | { type: 'set_projection_sim_scene'; scene: unknown }
  | { type: 'set_native_quality_policy'; native_quality_policy: NativeQualityPolicy }
  | { type: 'precompile_shader'; shader_id: string; stage: string; source: string; entry: string }
  | { type: 'set_effect_chain'; layer_id: string; effect_ids: string[] }
  | { type: 'bind_isf_shader'; layer_id: string; shader_id: string; input_source_id?: string | null }
  | {
      type: 'update_isf_uniforms';
      shader_id: string;
      time: number;
      time_delta: number;
      frame_index: number;
      render_width: number;
      render_height: number;
      date: [number, number, number, number];
      active: boolean;
      level: number;
      bass: number;
      mid: number;
      treble: number;
      high: number;
      beat: number;
      beat_phase: number;
      bpm: number;
      centroid: number;
      kick: number;
      snare: number;
      audio_level: number;
      audio_bass: number;
      audio_mid: number;
      audio_treble: number;
      audio_high: number;
      audio_beat: number;
      audio_beat_phase: number;
      audio_bpm: number;
      audio_spectral_centroid: number;
      audio_kick: number;
      audio_snare: number;
      float_inputs: Record<string, number>;
      point_inputs: Record<string, [number, number]>;
      color_inputs: Record<string, [number, number, number, number]>;
      /** ISF image inputs: input name -> native source id (media source id,
       *  or `layer-frame:<layerId>` for another layer's displayed frame). */
      image_inputs?: Record<string, string>;
    }
  | { type: 'render_isf_to_layer'; layer_id: string }
  | ({ type: 'queue_compute_graph' } & Record<string, unknown>)
  | { type: 'present' };

export interface CommandBatch {
  frame_id: number;
  commands: RendererCommand[];
}

export interface NativeQualityState {
  policy: NativeQualityPolicy | string;
  caps_tier: NativeQualityPolicy | string;
  active_tier: NativeQualityPolicy | string;
  quality_scale: number;
  target_frame_ms: number;
  cpu_ema_ms: number;
  gpu_ema_ms: number;
  overload_frames: number;
  recovery_frames: number;
  step_downs: number;
  step_ups: number;
}

export interface NativeGraphInstrumentManifestEntry {
  id: string;
  label?: string;
  source_uri_prefix?: string;
  shader_ids?: string[];
  shader_count?: number;
  features?: string[];
  render_target?: string;
  parity?: string;
}

export interface NativeCompositorBlendManifestEntry {
  id: string;
  code: number;
}

export interface NativeCompositorEffectManifestEntry {
  id: string;
  code: number;
  aliases?: string[];
  amount_min?: number;
  amount_max?: number;
}

export interface NativeEffectPassManifestEntry {
  id: string;
  code: number;
}

export interface NativeRendererCapabilities {
  schema_version: number;
  core_version: string | null;
  backend: BackendKind | string | null;
  core_capabilities_confirmed?: boolean;
  core_capabilities_error?: string | null;
  implemented_methods: string[];
  implemented_command_types: string[];
  native_graph_instruments?: string[];
  native_graph_instrument_manifest?: NativeGraphInstrumentManifestEntry[];
  native_compositor_blend_modes?: NativeCompositorBlendManifestEntry[];
  native_compositor_effect_descriptors?: NativeCompositorEffectManifestEntry[];
  native_effect_pass_descriptors?: NativeEffectPassManifestEntry[];
  audio_uniform_layout?: {
    schema_version: number;
    audio0: readonly string[];
    audio1: readonly string[];
    audio2: readonly string[];
  };
  source_frame_shared_texture_import?: {
    available: boolean;
    backend: string;
    platform: 'iosurface' | 'dxgi' | 'unsupported' | string;
    importer: string;
    handle_scope: string;
    accepted_handle_encodings: readonly string[];
    accepted_formats: readonly string[];
    reason?: string | null;
  };
	  output_shared_texture_export?: {
	    available: boolean;
	    backend: string;
	    platform: 'iosurface' | 'dxgi' | 'unsupported' | string;
	    exporter: string;
	    handle_scope: string;
	    preferred_transport: 'handle' | 'shared_name' | string;
	    handle_encoding: string;
	    handle_byte_length: number;
	    name_scope?: string;
	    exported_formats: readonly string[];
	    color_space?: 'srgb' | string;
	    storage_format?: 'bgra8unorm' | string;
	    storage_encoding?: 'srgb-encoded-bgra8unorm' | string;
	    alpha_mode?: 'opaque' | string;
	    premultiplied_alpha?: boolean;
	    single_render_source?: 'core-output-composite' | string;
	    zero_conversions?: boolean;
	    publisher?: string;
	    reason?: string | null;
	  };
	  native_editor_preview?: {
	    available: boolean;
	    mode: 'embedded-presenter-pending' | 'managed-native-overlay-window' | 'managed-native-underlay-window' | 'managed-native-output-window' | 'shared-texture-import-blit' | 'unavailable' | string;
	    presentation?: 'floating-overlay' | 'parented-overlay' | 'parented-underlay-probe' | 'underlay' | 'underlay-zero-copy' | 'frame-stream' | 'unavailable' | string;
	    production_ready?: boolean;
	    needs_underlay_lock_in?: boolean;
	    parented?: boolean;
	    source: 'core-output-composite' | 'native-unavailable' | string;
	    single_render: boolean;
	    transport: 'iosurface' | 'dxgi' | 'none' | string;
	    color_space: 'srgb' | string;
	    storage_format: 'bgra8unorm' | string;
	    storage_encoding: 'srgb-encoded-bgra8unorm' | string;
	    alpha_mode: 'opaque' | string;
	    premultiplied_alpha: boolean;
	    zero_conversions: boolean;
	    reason?: string | null;
	  };
  native_scene_bridge?: {
    stage3d: NativeSceneBridgeSummary;
    projection_sim: NativeSceneBridgeSummary;
  };
  features: Record<string, boolean>;
  limits: Record<string, number>;
  notes: string[];
}

export interface RendererStatus {
  running: boolean;
  backend: BackendKind | null;
  backend_ready: boolean;
  adapter_name: string | null;
  /** True when the core is running on a software rasterizer (WARP) — the
   *  no-usable-GPU compatibility fallback. */
  adapter_is_software?: boolean;
  native_caps: NativeGpuCaps;
  native_quality: NativeQualityState;
  source_preview_size: number;
  source_previews_active: number;
  source_preview_slots: number;
  source_preview_dirty: boolean;
  source_frame_size: number;
  source_frame_format: string;
  source_frame_hdr: boolean;
  source_frame_mip_levels: number;
  source_frames_active: number;
  source_frame_slots: number;
  isf_shader_bindings: number;
  isf_uniform_sets: number;
  native_shader_layers: number;
  native_procedural_layers: number;
  native_instrument_layers: number;
  native_instrument_proxy_layers: number;
  native_graph_source_frame_layers: number;
  source_frame_uploads: number;
  source_frame_bytes_uploaded: number;
  source_frame_cpu_fallback_uploads: number;
  source_frame_file_uploads: number;
  source_frame_base64_uploads: number;
  source_frame_json_uploads: number;
  source_frame_shared_texture_uploads: number;
  source_frame_shared_texture_rejected_uploads: number;
  source_frame_rejected_uploads: number;
  source_frame_input_bytes_uploaded: number;
  source_frame_resampled_bytes_uploaded: number;
  source_frame_last_input_bytes: number;
  source_frame_last_upload_bytes: number;
  source_frame_last_upload_width: number;
  source_frame_last_upload_height: number;
  source_frame_last_upload_transport: string;
  source_frame_last_reject_reason: string;
  native_image_decodes: number;
  native_image_decode_failures: number;
  native_image_decode_bytes_uploaded: number;
  native_image_decode_last_error: string;
  native_video_frame_decodes: number;
  native_video_frame_decode_failures: number;
  native_video_frame_decode_bytes_uploaded: number;
  native_video_frame_decode_last_error: string;
  native_video_frame_cache_entries: number;
  native_video_frame_cache_bytes: number;
  native_video_frame_cache_hits: number;
  native_video_frame_cache_misses: number;
  native_video_frame_cache_evictions: number;
  native_video_sessions: Array<{
    source_id: string;
    state: 'armed' | 'prerolled' | 'playing' | 'evicted';
    buffered_frames: number;
    frames_presented: number;
  }>;
  native_video_sessions_armed: number;
  native_video_sessions_prerolled: number;
  native_video_sessions_playing: number;
  native_video_session_evictions: number;
  video_oneshot_decodes_during_playback: number;
  native_video_trigger_last_latency_us: number;
  native_video_trigger_max_latency_us: number;
  native_video_stream_underflows: number;
  native_instrument_frame_renders: number;
  compute_graph_runs: number;
  compute_graph_passes: number;
  compute_graph_render_passes: number;
  compute_graph_snapshot_renders: number;
  compute_graph_source_frame_renders: number;
  compute_graph_readbacks: number;
  compute_graph_readback_bytes: number;
  compute_graph_persistent_buffers: number;
  render_clock_mode: 'live' | 'manual';
  render_clock_time: number;
  render_clock_frame_index: number;
  render_clock_updates: number;
  frame_snapshot_reads: number;
  frame_snapshot_bytes_read: number;
  frame_health_checks: number;
  dark_frame_warnings: number;
  last_frame_checksum: string | null;
  last_frame_nonzero_pixels: number;
  last_frame_bright_pixels: number;
  last_frame_average_luma: number;
  last_frame_max_luma: number;
  last_frame_dark: boolean;
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
  last_rpc_error?: string | null;
  last_rpc_error_method?: string | null;
  last_rpc_error_at_ms?: number;
  ffmpeg_active_video_sessions: number;
  decode_hw_frames: number;
  decode_predecode_estimate_cache_entries: number;
  decode_predecode_estimate_cache_cap_entries: number;
  decode_predecode_estimate_cache_backpressure_active: boolean;
  shader_cache_entries: number;
  pipeline_cache_entries: number;
  precompiled_vertex_shaders: number;
  precompiled_pixel_shaders: number;
  shader_precompile_queued: number;
  shader_precompile_compiled: number;
  shader_precompile_failed: number;
  shader_precompile_dropped: number;
  last_shader_error: string | null;
  layers_seen: number;
  scene_layers_active: number;
  output_last_presented_layer_count: number;
  target_fps: number;
  present_mode: PresentMode;
  surface_present_mode: string;
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
  video_frame_prefetch_cache_entries: number;
  video_frame_prefetch_cache_bytes: number;
  video_frame_prefetch_cache_hits: number;
  video_frame_prefetch_cache_misses: number;
  video_frame_prefetch_cache_clears: number;
  video_frame_prefetch_cache_max_entries: number;
  media_drop_command_pressure_pct: number;
  media_drop_decode_pressure_pct: number;
  media_drop_io_pressure_pct: number;
  media_drop_decode_priority_cutoff: number;
  media_drop_io_priority_cutoff: number;
  output_width: number;
  output_height: number;
  output_format: string;
  output_refresh_hz: number;
  output_window_attached: boolean;
  output_swapchain_ready: boolean;
  output_tearing_active: boolean;
  output_waitable_object_active: boolean;
  output_present_healthy: boolean;
  output_present_consecutive_failures: number;
  swapchain_present_attempts: number;
  swapchain_presented: number;
  gpu_frames_submitted: number;
  gpu_frames_completed: number;
  gpu_backpressure_skips: number;
  frames_presented?: number;
  swapchain_present_failures: number;
  swapchain_last_present_result: string;
  swapchain_last_present_error: string;
  swapchain_present_timeouts: number;
  swapchain_present_occluded: number;
  swapchain_present_outdated: number;
  swapchain_present_lost: number;
  swapchain_present_validation_errors: number;
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
  supports_tearing: boolean;
  supports_waitable_object: boolean;
  gpu_timing_supported: boolean;
  gpu_timing_samples: number;
  gpu_timing_resolve_misses: number;
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
  decode_jobs_submitted: number;
  decode_jobs_completed: number;
  decode_jobs_dropped: number;
  decode_queue_peak: number;
  io_backpressure_active: boolean;
  decode_handoff_backpressure_active: boolean;
  degraded_mode_active: boolean;
  prefetched_sources: number;
  vram_budget_mb: number;
  native_graph_buffer_bytes: number;
  native_graph_buffer_budget_bytes: number;
  vram_evictions: number;
  vram_evicted_bytes: number;
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
  gpu_frames_submitted: number;
  gpu_frames_completed: number;
  gpu_backpressure_skips: number;
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
  source_frame_uploads: number;
  source_frame_bytes_uploaded: number;
  source_frame_cpu_fallback_uploads: number;
  source_frame_file_uploads: number;
  source_frame_base64_uploads: number;
  source_frame_json_uploads: number;
  source_frame_shared_texture_uploads: number;
  source_frame_shared_texture_rejected_uploads: number;
  source_frame_rejected_uploads: number;
  source_frame_input_bytes_uploaded: number;
  source_frame_resampled_bytes_uploaded: number;
  source_frame_last_input_bytes: number;
  source_frame_last_upload_bytes: number;
  source_frame_last_upload_width: number;
  source_frame_last_upload_height: number;
  source_frame_last_upload_transport: string;
  source_frame_last_reject_reason: string;
  native_image_decodes: number;
  native_image_decode_failures: number;
  native_image_decode_bytes_uploaded: number;
  native_image_decode_last_error: string;
  native_video_frame_decodes: number;
  native_video_frame_decode_failures: number;
  native_video_frame_decode_bytes_uploaded: number;
  native_video_frame_decode_last_error: string;
  native_video_frame_cache_entries: number;
  native_video_frame_cache_bytes: number;
  native_video_frame_cache_hits: number;
  native_video_frame_cache_misses: number;
  native_video_frame_cache_evictions: number;
  native_shader_renders: number;
  native_instrument_frame_renders: number;
  render_clock_updates: number;
  frame_snapshot_reads: number;
  frame_snapshot_bytes_read: number;
  frame_health_checks: number;
  dark_frame_warnings: number;
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
  video_frame_prefetch_cache_hits: number;
  video_frame_prefetch_cache_misses: number;
  video_frame_prefetch_cache_clears: number;
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
  compute_graph_runs: number;
  compute_graph_passes: number;
  compute_graph_render_passes: number;
  compute_graph_snapshot_renders: number;
  compute_graph_source_frame_renders: number;
  compute_graph_readbacks: number;
  compute_graph_readback_bytes: number;
  compute_graph_persistent_buffers: number;
  frame_budget_overruns: number;
  consecutive_budget_overruns: number;
  max_consecutive_budget_overruns: number;
  last_render_wait_ms: number;
  last_frame_budget_ms: number;
  effective_target_fps: number;
  output_last_presented_layer_count: number;
  swapchain_present_attempts: number;
  swapchain_presented: number;
  swapchain_present_failures: number;
  swapchain_last_present_result: string;
  swapchain_last_present_error: string;
  swapchain_present_timeouts: number;
  swapchain_present_occluded: number;
  swapchain_present_outdated: number;
  swapchain_present_lost: number;
  swapchain_present_validation_errors: number;
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

export interface NativeCommandApplySummary {
  total: number;
  applied: number;
  dropped: number;
  unknown_types: string[];
  invalid_payload: boolean;
  command_drain_limit: number;
  command_queue_peak?: number;
  frames_submitted?: number;
}

export interface RendererSnapshot {
  timestamp_ms: number;
  status: RendererStatus;
  stats: RendererStats;
  capabilities?: NativeRendererCapabilities;
}

export interface RendererFrameSnapshot {
  timestamp_ms: number;
  width: number;
  height: number;
  format: string;
  byte_length: number;
  bytes_per_row: number;
  padded_bytes_per_row: number;
  checksum: string;
  nonzero_pixels: number;
  bright_pixels: number;
  transparent_pixels: number;
  average_luma: number;
  max_luma: number;
  mean_rgba: [number, number, number, number];
  dark_frame: boolean;
  includes_pixels: boolean;
  rgba_b64?: string;
}

export interface NativeRendererFrameSnapshotExportResult extends RendererFrameSnapshot {
  path: string;
  bytes_written: number;
  storage_format: 'raw-texture' | string;
  frame_index: number;
  time_seconds: number | null;
}

export interface NativeRendererOutputSharedTexture {
  available: boolean;
  platform: 'iosurface' | 'dxgi' | 'unsupported' | string;
  handle?: string;
  handle_encoding?: string;
  handle_scope?: string;
  preferred_transport?: 'handle' | 'shared_name' | string;
  handle_byte_length?: number;
  name?: string;
  shared_name?: string;
	  width?: number;
	  height?: number;
	  format?: string;
	  color_space?: 'srgb' | string;
	  storage_format?: 'bgra8unorm' | string;
	  storage_encoding?: 'srgb-encoded-bgra8unorm' | string;
	  alpha_mode?: 'opaque' | string;
	  premultiplied_alpha?: boolean;
	  single_render_source?: 'core-output-composite' | string;
	  zero_conversions?: boolean;
	  frame?: number;
	  flipped?: boolean;
  reason?: string;
}

export interface NativeSceneBridgeSummary {
  schema_version: number;
  scene_kind: 'stage3d' | 'projection-sim' | string;
  scene_id: string;
  scene_name: string;
  source_schema_version: number;
  payload_bytes: number;
  updated_at_ms: number;
  node_count: number;
  screen_count: number;
  primitive_count: number;
  truss_count: number;
  light_count: number;
  laser_count: number;
  fog_volume_count: number;
  user_element_count: number;
  scenery_override_count: number;
  projector_count: number;
  object_count: number;
  model_count: number;
  point_cloud_count: number;
}

export interface NativeRendererSnapshotExportResult {
  path: string;
  bytes: number;
  timestamp_ms: number;
}

export interface NativeGpuCaps {
  adapter_name: string;
  adapter_vendor: number;
  adapter_device: number;
  adapter_device_type: string;
  adapter_driver: string;
  adapter_driver_info: string;
  max_texture_dimension_2d: number;
  max_texture_dimension_3d: number;
  max_texture_array_layers: number;
  max_bind_groups: number;
  max_bindings_per_bind_group: number;
  max_sampled_textures_per_shader_stage: number;
  max_storage_buffers_per_shader_stage: number;
  max_storage_textures_per_shader_stage: number;
  max_uniform_buffer_binding_size: number;
  max_storage_buffer_binding_size: number;
  max_buffer_size: number;
  max_compute_workgroup_storage_size: number;
  max_compute_invocations_per_workgroup: number;
  max_compute_workgroup_size_x: number;
  max_compute_workgroup_size_y: number;
  max_compute_workgroup_size_z: number;
  max_compute_workgroups_per_dimension: number;
  supports_shader_f16: boolean;
  supports_float32_filterable: boolean;
  supports_timestamp_query: boolean;
  supports_timestamp_query_inside_encoders: boolean;
  supports_timestamp_query_inside_passes: boolean;
  supports_texture_binding_array: boolean;
  supports_buffer_binding_array: boolean;
  supports_storage_resource_binding_array: boolean;
  supports_texture_adapter_specific_format_features: boolean;
  requested_shader_f16: boolean;
  requested_float32_filterable: boolean;
  requested_timestamp_query: boolean;
  requested_timestamp_query_inside_encoders: boolean;
  requested_timestamp_query_inside_passes: boolean;
  recommended_quality_tier: 'performance' | 'balanced' | 'ultra' | 'insane' | string;
}

export interface RendererReadinessCheck {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
}

export interface RendererReadinessMode {
  ok: boolean;
  detail: string;
  blockers?: string[];
}

export interface NativeRendererTextureShareStatus {
  platform: 'spout' | 'syphon' | string;
  label: string;
  available: boolean;
  addonPath?: string | null;
  candidates?: string[];
  error?: string | null;
  cpuFallbackAllowed?: boolean;
  senderMode?: string;
  osrActive?: boolean;
  osrFailureReason?: string | null;
  nativeOutputCapable?: boolean;
  nativeOutputTransport?: string;
  nativeOutputRequiresNamedTexture?: boolean;
  nativeOutputActive?: boolean;
  nativeOutputWaitingForFrame?: boolean;
  nativeOutputLastPublishedFrame?: number;
  nativeOutputFailures?: number;
  nativeOutputPendingPromotion?: boolean;
  nativeOutputPromotionAttempts?: number;
  nativeOutputPromotionReason?: string | null;
}

export interface RendererReadinessReport {
  timestamp_ms: number;
  overall_ready: boolean;
  blockers: string[];
  modes?: Record<string, RendererReadinessMode>;
  capabilities?: NativeRendererCapabilities;
  texture_share?: NativeRendererTextureShareStatus | null;
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
      target_fps: config?.target_fps ?? 120,
      present_mode: config?.present_mode ?? 'vsync',
      allow_tearing: config?.allow_tearing ?? false,
      max_frame_latency: config?.max_frame_latency ?? 2,
      use_waitable_object: config?.use_waitable_object ?? false,
      vram_budget_mb: config?.vram_budget_mb ?? 4096,
      decode_backend: config?.decode_backend ?? 'ffmpeg_software',
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
      native_quality_policy: config?.native_quality_policy ?? 'fixed',
      ffmpeg_path: config?.ffmpeg_path ?? null,
      decode_gpu_bridge_path: config?.decode_gpu_bridge_path ?? null,
      editor_parent_window_handle_hex: config?.editor_parent_window_handle_hex ?? null,
      editor_parent_window_handle_platform: config?.editor_parent_window_handle_platform ?? null,
    },
  });
}

export async function stopNativeRenderer() {
  return invoke<void>('native_renderer_stop');
}

export async function submitNativeRendererBatch(batch: CommandBatch) {
  return invoke<NativeCommandApplySummary>('native_renderer_submit_batch', { batch });
}

export async function submitNativeRendererCommands(commands: RendererCommand[]) {
  return invoke<NativeCommandApplySummary>('native_renderer_submit_commands', { commands });
}

export async function runNativeRendererComputeGraph(config: Record<string, unknown>) {
  return invoke<Record<string, unknown>>('native_renderer_run_compute_graph', config);
}

export async function uploadNativeRendererSourceGpuSharedTexture(
  sourceId: string,
  width: number,
  height: number,
  sharedHandle: string,
  seq: number,
  metadata: {
    platform?: string;
    format?: number | string;
    handleEncoding?: string;
    handleByteLength?: number;
    frame?: number;
    senderName?: string;
  } = {},
) {
  return invoke<RendererStatus>('native_renderer_upload_source_gpu_shared_texture', {
    source_id: sourceId,
    width,
    height,
    shared_handle: sharedHandle,
    seq,
    platform: metadata.platform,
    format: metadata.format,
    handle_encoding: metadata.handleEncoding,
    handle_byte_length: metadata.handleByteLength,
    frame: metadata.frame,
    sender_name: metadata.senderName,
  });
}

export type NativeMediaPrefetchOptions = {
  timeSeconds?: number;
  decodeWidth?: number;
  decodeHeight?: number;
  prefetchWindowFrames?: number;
  prefetchFps?: number;
  seekGeneration?: number;
  playbackRate?: number;
  loopEnabled?: boolean;
  durationSeconds?: number;
  trimStart?: number;
  trimEnd?: number;
  seq?: number;
};

export async function prefetchNativeRendererMedia(
  sourceId: string,
  uri: string,
  priority = 1,
  sourceType?: string,
  options: NativeMediaPrefetchOptions = {},
) {
  return invoke<RendererStatus>('native_renderer_prefetch_media', {
    source_id: sourceId,
    uri,
    priority,
    source_type: sourceType,
    time_seconds: options.timeSeconds,
    decode_width: options.decodeWidth,
    decode_height: options.decodeHeight,
    prefetch_window_frames: options.prefetchWindowFrames,
    prefetch_fps: options.prefetchFps,
    seek_generation: options.seekGeneration,
    playback_rate: options.playbackRate,
    loop_enabled: options.loopEnabled,
    duration_seconds: options.durationSeconds,
    trim_start: options.trimStart,
    trim_end: options.trimEnd,
    seq: options.seq,
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

export async function setNativeRendererRenderClock(config: RenderClockConfig) {
  return invoke<void>('native_renderer_set_render_clock', config);
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

export async function setNativeRendererQualityPolicy(config: NativeQualityPolicyConfig) {
  return invoke<void>('native_renderer_set_native_quality_policy', { config });
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

export async function setNativeRendererOutputWindow(config: OutputWindowConfig) {
  return invoke<RendererStatus>('native_renderer_set_output_window', { config });
}

export async function detachNativeRendererOutputWindow() {
  return invoke<void>('native_renderer_detach_output_window');
}

export async function attachNativeEditorPreview(rect: NativeEditorPreviewRect) {
  return invoke<NativeEditorPreviewPresenterStatus>('native_preview_attach', { rect });
}

export async function updateNativeEditorPreview(rect: NativeEditorPreviewRect) {
  return invoke<NativeEditorPreviewPresenterStatus>('native_preview_update', { rect });
}

export interface NativeEditorPreviewOverlayPoint {
  x: number;
  y: number;
}

export interface NativeEditorPreviewOverlayHandle extends NativeEditorPreviewOverlayPoint {
  kind: 'corner' | 'mesh' | 'edge-horizontal' | 'edge-vertical' | 'move' | 'rotate' | 'scale';
}

export interface NativeEditorPreviewOverlay {
  lines: NativeEditorPreviewOverlayPoint[];
  points: NativeEditorPreviewOverlayPoint[];
  handles?: NativeEditorPreviewOverlayHandle[];
}

export interface NativeViewportLayerInteraction {
  layer_id: string;
  corners?: {
    topLeft: NativeEditorPreviewOverlayPoint;
    topRight: NativeEditorPreviewOverlayPoint;
    bottomRight: NativeEditorPreviewOverlayPoint;
    bottomLeft: NativeEditorPreviewOverlayPoint;
  };
  mesh_grid?: {
    rows: number;
    cols: number;
    points: NativeEditorPreviewOverlayPoint[][];
  } | null;
}

export async function setNativeEditorPreviewOverlay(overlay: NativeEditorPreviewOverlay) {
  return invoke<NativeEditorPreviewPresenterStatus>('native_preview_set_overlay', { overlay });
}

export function setNativeViewportLayerInteraction(interaction: NativeViewportLayerInteraction): void {
  // Deliberately fire-and-forget. The Electron main process coalesces this
  // pointer-rate stream by layer, and the core accepts it as an id=0 RPC.
  void invoke<{ accepted: boolean }>('native_viewport_set_layer_interaction', interaction).catch(() => {});
}

export async function detachNativeEditorPreview(reason = 'renderer-detach') {
  return invoke<NativeEditorPreviewPresenterStatus>('native_preview_detach', { reason });
}

export async function getNativeEditorPreviewStatus() {
  return invoke<NativeEditorPreviewPresenterStatus>('native_preview_get_status');
}

export async function getNativeRendererStatus() {
  return invoke<RendererStatus>('native_renderer_get_status');
}

export type NativeRendererLayerSnapshot = {
  layer_id: string;
  z_index: number;
  visible: boolean;
  opacity: number;
  blend_code: number;
  corners: [number, number][];
  uv0: number[];
  uv1: number[];
  source_id: string | null;
  mesh_rows: number;
  mesh_cols: number;
};

// Ground truth of the core's compositor state, used by the sync's scene
// reconciler to detect and repair lost/misapplied layer updates.
export async function getNativeRendererLayersSnapshot() {
  return invoke<{ layers: NativeRendererLayerSnapshot[] }>('native_renderer_get_layers_snapshot');
}

export async function getNativeRendererStats() {
  return invoke<RendererStats>('native_renderer_get_stats');
}

export async function getNativeRendererSnapshot() {
  return invoke<RendererSnapshot>('native_renderer_get_snapshot');
}

export async function getNativeRendererFrameSnapshot(
  includePixels = false,
  options: { time?: number; frame_index?: number } = {},
) {
  return invoke<RendererFrameSnapshot>('native_renderer_get_frame_snapshot', {
    include_pixels: includePixels,
    ...options,
  });
}

export async function exportNativeRendererFrameSnapshot(
  path: string,
  options: { time?: number; frame_index?: number; format?: string; source?: 'render' | 'output' } = {},
) {
  return invoke<NativeRendererFrameSnapshotExportResult>('native_renderer_export_frame_snapshot', {
    path,
    ...options,
  });
}

export async function getNativeRendererOutputSharedTexture() {
  return invoke<NativeRendererOutputSharedTexture>('native_renderer_get_output_shared_texture');
}

export async function getNativeRendererOutputSharedTextureSnapshot(options: { include_pixels?: boolean } = {}) {
  return invoke<RendererFrameSnapshot | null>('native_renderer_get_output_shared_texture_snapshot', options);
}

export async function setNativeRendererStage3DScene(scene: unknown) {
  return invoke<NativeSceneBridgeSummary>('native_renderer_set_stage3d_scene', { scene });
}

export async function getNativeRendererStage3DSceneSummary() {
  return invoke<NativeSceneBridgeSummary>('native_renderer_get_stage3d_scene_summary');
}

export async function setNativeRendererProjectionSimScene(scene: unknown) {
  return invoke<NativeSceneBridgeSummary>('native_renderer_set_projection_sim_scene', { scene });
}

export async function getNativeRendererProjectionSimSceneSummary() {
  return invoke<NativeSceneBridgeSummary>('native_renderer_get_projection_sim_scene_summary');
}

export async function getNativeRendererCapabilities() {
  return invoke<NativeRendererCapabilities>('native_renderer_get_capabilities');
}

export async function getNativeRendererReadinessReport() {
  return invoke<RendererReadinessReport>('native_renderer_get_readiness_report');
}

export async function exportNativeRendererSnapshotJson(path: string) {
  return invoke<NativeRendererSnapshotExportResult>('native_renderer_export_snapshot_json', { path });
}

export async function resetNativeRendererStats() {
  return invoke<void>('native_renderer_reset_stats');
}
