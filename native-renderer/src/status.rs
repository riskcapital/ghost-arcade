//! Status, capability and stats reports.

use crate::*;

#[derive(Clone, Debug, Serialize)]
pub(crate) struct NativeVideoSessionStatus {
    pub(crate) phase_error_seconds: Option<f64>,
    pub(crate) playback_rate: f64,
    pub(crate) clock_seconds: f64,
    pub(crate) next_frame_seconds: Option<f64>,
    pub(crate) play_state_changes: u64,
    pub(crate) backend: String,
    pub(crate) fallback_reason: String,
    pub(crate) source_id: String,
    pub(crate) state: String,
    pub(crate) signature: String,
    pub(crate) buffered_frames: u32,
    pub(crate) frames_presented: u64,
    pub(crate) seek_generation: u64,
    pub(crate) source_time_seconds: Option<f64>,
    pub(crate) source_frame_duration_seconds: Option<f64>,
    pub(crate) source_fps: Option<f64>,
    pub(crate) source_duration_seconds: Option<f64>,
    pub(crate) source_frame_step_exact: bool,
    pub(crate) scrub_cache_hits: u64,
    pub(crate) scrub_cache_misses: u64,
    pub(crate) forward_continuations: u64,
    pub(crate) optional_cache_bytes: u64,
    pub(crate) frames_dropped: u64,
    pub(crate) reserved_bytes: u64,
    pub(crate) waiting_for_memory_bytes: u64,
    /// The file this session decodes, so the editor can tell which media a
    /// backend (and its fallback reason) belongs to.
    pub(crate) uri: String,
    pub(crate) decode_max_edge: Option<usize>,
}

#[derive(Clone, Debug, Serialize)]
pub(crate) struct CoreStatus {
    pub(crate) running: bool,
    pub(crate) backend: String,
    pub(crate) backend_ready: bool,
    pub(crate) adapter_name: Option<String>,
    pub(crate) adapter_is_software: bool,
    /// Windows: the renderer adapter's LUID, 16 hex digits. Presenters in
    /// Electron open the core's shared textures by name, which only works
    /// from a device on this same adapter.
    pub(crate) adapter_luid: Option<String>,
    pub(crate) native_caps: NativeGpuCaps,
    pub(crate) native_quality: NativeQualityState,
    pub(crate) width: u32,
    pub(crate) height: u32,
    pub(crate) target_fps: u32,
    pub(crate) present_mode: String,
    pub(crate) surface_present_mode: String,
    pub(crate) allow_tearing: bool,
    pub(crate) max_frame_latency: u32,
    pub(crate) use_waitable_object: bool,
    pub(crate) command_queue_capacity: u32,
    pub(crate) command_drain_limit: u32,
    pub(crate) auto_present_on_state_change: bool,
    pub(crate) decode_store_cpu_backup_frames: bool,
    pub(crate) decode_allow_synthetic_fallback: bool,
    pub(crate) media_queue_capacity: u32,
    pub(crate) decode_handoff_queue_capacity: u32,
    pub(crate) media_high_burst_limit: u32,
    pub(crate) prefetch_cache_max_entries: u32,
    pub(crate) prefetch_cache_prune_count: u32,
    pub(crate) media_drop_command_pressure_pct: u32,
    pub(crate) media_drop_decode_pressure_pct: u32,
    pub(crate) media_drop_io_pressure_pct: u32,
    pub(crate) media_drop_decode_priority_cutoff: u32,
    pub(crate) media_drop_io_priority_cutoff: u32,
    pub(crate) decode_preview_size: u32,
    pub(crate) decode_preview_cache_mb: u32,
    pub(crate) decode_use_output_resolution: bool,
    pub(crate) decode_target_width: u32,
    pub(crate) decode_target_height: u32,
    pub(crate) decode_preview_cache_bypassed: bool,
    pub(crate) decode_upload_queue_cap_mb: u32,
    pub(crate) decode_handoff_byte_cap_mb: u32,
    /// The decoded-video memory budget in force, and the GPU memory it was sized from (0 = unknown).
    pub(crate) video_decode_budget_mb: u64,
    pub(crate) gpu_memory_mb: u64,
    pub(crate) decode_handoff_predecode_shed_pct: u32,
    pub(crate) decode_predecode_estimate_cache_entries: u32,
    pub(crate) decode_predecode_estimate_cache_cap_entries: u32,
    pub(crate) decode_predecode_estimate_cache_backpressure_active: bool,
    pub(crate) decode_backpressure_active: bool,
    pub(crate) decode_jobs_submitted: u64,
    pub(crate) decode_jobs_completed: u64,
    pub(crate) decode_jobs_dropped: u64,
    pub(crate) decode_queue_peak: u64,
    pub(crate) vram_budget_mb: u32,
    pub(crate) native_graph_buffer_bytes: u64,
    pub(crate) native_graph_buffer_budget_bytes: u64,
    pub(crate) vram_evictions: u64,
    pub(crate) vram_evicted_bytes: u64,
    pub(crate) command_drain_limit_hits: u64,
    pub(crate) queued_commands_after_drain: u64,
    pub(crate) source_preview_size: u32,
    pub(crate) source_previews_active: u32,
    pub(crate) source_preview_slots: u32,
    pub(crate) source_preview_dirty: bool,
    pub(crate) source_frame_size: u32,
    pub(crate) source_frame_format: String,
    pub(crate) source_frame_hdr: bool,
    pub(crate) source_frame_mip_levels: u32,
    pub(crate) source_frames_active: u32,
    pub(crate) source_frame_slots: u32,
    /// "shared-array" or "per-source" (source_frames.rs).
    pub(crate) source_frame_store: String,
    pub(crate) isf_shader_bindings: u32,
    pub(crate) isf_uniform_sets: u32,
    /// Shaders routed through the pass-aware ISF host (PASSES or audio rows).
    pub(crate) isf_pass_host_shaders: u32,
    pub(crate) isf_multipass_renders: u64,
    /// Layers holding multi-pass buffers, the buffers, and their VRAM.
    pub(crate) isf_pass_states: u32,
    pub(crate) isf_pass_targets: u32,
    pub(crate) isf_pass_target_bytes: u64,
    pub(crate) isf_audio_spectrum_live: bool,
    pub(crate) isf_audio_spectrum_seq: u64,
    pub(crate) audio_visual_seq: u64,
    /// Cloud instruments' scan files by layer: loading, ready:<points>, failed:<reason>.
    pub(crate) audio_visual_cloud_loads: std::collections::BTreeMap<String, String>,
    pub(crate) isf_audio_fft_bins: u32,
    pub(crate) isf_audio_waveform_samples: u32,
    pub(crate) native_shader_layers: u32,
    pub(crate) native_procedural_layers: u32,
    pub(crate) native_instrument_layers: u32,
    pub(crate) native_instrument_proxy_layers: u32,
    pub(crate) native_graph_source_frame_layers: u32,
    /// Ground-truth workload the core resolved for each live instrument
    /// layer on the last built frame. Lets tooling verify that a quality
    /// tier actually reached the core instead of trusting the TS values.
    pub(crate) native_graph_workload: Vec<Value>,
    pub(crate) shader_precompile_queue_cap: u32,
    pub(crate) shader_precompile_per_frame: u32,
    pub(crate) shader_metadata_cache_cap: u32,
    pub(crate) pipeline_metadata_cache_cap: u32,
    pub(crate) texture_pool_cap_mb: u32,
    pub(crate) shader_cache_entries: u32,
    pub(crate) pipeline_cache_entries: u32,
    pub(crate) precompiled_vertex_shaders: u32,
    pub(crate) precompiled_pixel_shaders: u32,
    pub(crate) shader_precompile_queued: u64,
    pub(crate) shader_precompile_compiled: u64,
    pub(crate) shader_precompile_failed: u64,
    pub(crate) shader_precompile_dropped: u64,
    pub(crate) source_frame_uploads: u64,
    pub(crate) source_frame_bytes_uploaded: u64,
    pub(crate) source_frame_cpu_fallback_uploads: u64,
    pub(crate) source_frame_file_uploads: u64,
    pub(crate) source_frame_base64_uploads: u64,
    pub(crate) source_frame_json_uploads: u64,
    pub(crate) source_frame_shared_texture_uploads: u64,
    pub(crate) source_frame_shared_texture_rejected_uploads: u64,
    pub(crate) source_frame_rejected_uploads: u64,
    pub(crate) source_frame_input_bytes_uploaded: u64,
    pub(crate) source_frame_resampled_bytes_uploaded: u64,
    pub(crate) source_frame_last_input_bytes: u64,
    pub(crate) source_frame_last_upload_bytes: u64,
    pub(crate) source_frame_last_upload_width: u32,
    pub(crate) source_frame_last_upload_height: u32,
    pub(crate) source_frame_last_upload_transport: String,
    pub(crate) source_frame_last_reject_reason: String,
    pub(crate) native_image_decodes: u64,
    pub(crate) native_image_decode_failures: u64,
    pub(crate) native_image_decode_bytes_uploaded: u64,
    pub(crate) native_image_decode_last_error: String,
    /// Graph textures held now, and their bytes (they are freed when unused).
    pub(crate) graph_textures: usize,
    pub(crate) graph_texture_bytes: u64,
    pub(crate) native_video_frame_decodes: u64,
    pub(crate) native_video_hardware_frames: u64,
    pub(crate) native_video_hap_frames: u64,
    pub(crate) native_video_last_pixel_format: String,
    pub(crate) native_video_software_frames: u64,
    pub(crate) native_video_hardware_fallbacks: u64,
    pub(crate) native_video_frame_decode_failures: u64,
    pub(crate) native_video_frame_decode_bytes_uploaded: u64,
    pub(crate) native_video_frame_decode_last_error: String,
    pub(crate) native_video_frame_cache_entries: u32,
    pub(crate) native_video_frame_cache_bytes: u64,
    pub(crate) native_video_frame_cache_hits: u64,
    pub(crate) native_video_frame_cache_misses: u64,
    pub(crate) native_video_frame_cache_evictions: u64,
    pub(crate) native_video_sessions: Vec<NativeVideoSessionStatus>,
    pub(crate) native_video_sessions_armed: u32,
    pub(crate) native_video_sessions_prerolled: u32,
    pub(crate) native_video_sessions_playing: u32,
    pub(crate) native_video_session_evictions: u64,
    pub(crate) media_sources_active: u32,
    pub(crate) media_source_orphan_releases: u64,
    pub(crate) video_oneshot_decodes_during_playback: u64,
    pub(crate) native_video_trigger_last_latency_us: u64,
    pub(crate) native_video_trigger_max_latency_us: u64,
    pub(crate) native_video_stream_underflows: u64,
    /// Clip audio: device buffers that played a gap, the silent frames in
    /// them, the mixer's lookahead and its scheduling class.
    pub(crate) clip_audio_underflow_events: u64,
    pub(crate) clip_audio_underflow_frames: u64,
    pub(crate) clip_audio_lookahead_ms: f64,
    pub(crate) clip_audio_mixer_priority: &'static str,
    pub(crate) native_instrument_frame_renders: u64,
    pub(crate) compute_graph_runs: u64,
    pub(crate) compute_graph_passes: u64,
    pub(crate) compute_graph_render_passes: u64,
    pub(crate) compute_graph_snapshot_renders: u64,
    pub(crate) compute_graph_source_frame_renders: u64,
    pub(crate) compute_graph_readbacks: u64,
    pub(crate) compute_graph_readback_bytes: u64,
    pub(crate) compute_graph_persistent_buffers: u32,
    pub(crate) render_clock_mode: String,
    pub(crate) render_clock_time: f64,
    pub(crate) render_clock_frame_index: u64,
    pub(crate) render_clock_updates: u64,
    /// Renders that recomposited an already-stepped manual clock frame
    /// instead of double-stepping the simulation. Non-zero during an
    /// offline export is expected and healthy; it is the count of extra
    /// renders the clock lock absorbed.
    pub(crate) manual_clock_graph_steps_skipped: u64,
    pub(crate) frame_snapshot_reads: u64,
    pub(crate) frame_snapshot_bytes_read: u64,
    pub(crate) frame_health_checks: u64,
    pub(crate) dark_frame_warnings: u64,
    pub(crate) last_frame_checksum: Option<String>,
    pub(crate) last_frame_nonzero_pixels: u64,
    pub(crate) last_frame_bright_pixels: u64,
    pub(crate) last_frame_average_luma: f64,
    pub(crate) last_frame_max_luma: f64,
    pub(crate) last_frame_dark: bool,
    pub(crate) last_shader_error: Option<String>,
    pub(crate) gpu_frames_submitted: u64,
    pub(crate) gpu_frames_completed: u64,
    pub(crate) gpu_backpressure_skips: u64,
    /// Most frames the CPU may queue ahead of the GPU (frames_in_flight.rs).
    pub(crate) max_frames_in_flight: u64,
    /// How many it may queue right now, and why.
    pub(crate) frames_in_flight: frames_in_flight::AdaptiveGateReport,
    /// Start of a frame's CPU work to the end of its GPU work.
    pub(crate) gpu_frame_latency: frames_in_flight::FrameLatencyReport,
    /// Program output window: frame-start, present and acquire-wait
    /// intervals (present_pacing.rs).
    pub(crate) output_pacing: present_pacing::PacingReport,
    /// What paces the frames: the output display's refresh clock, or the
    /// frame timer (display_pacing.rs).
    pub(crate) output_display_pacing: Value,
    pub(crate) frames_presented: u64,
    /// GA_CORE_CHURN_PROBE=1 only (churn_probe.rs).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) gpu_object_churn: Option<churn_probe::ChurnCounts>,
    /// Effect passes drawn with their own pipeline / with the shared effect
    /// shader (effect_specialize.rs).
    pub(crate) effect_shader_specialised_draws: u64,
    pub(crate) effect_shader_shared_draws: u64,
    /// GA_CORE_PASS_TIMING=1 only (pass_timing.rs).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) gpu_pass_timing: Option<pass_timing::PassTimingReport>,
    pub(crate) commands_applied: u64,
    pub(crate) commands_dropped: u64,
    pub(crate) layers_seen: u32,
    pub(crate) scene_layers_active: u32,
    pub(crate) output_last_presented_layer_count: u32,
    pub(crate) output_width: u32,
    pub(crate) output_height: u32,
    pub(crate) output_format: String,
    pub(crate) output_refresh_hz: u32,
    pub(crate) output_window_attached: bool,
    pub(crate) output_swapchain_ready: bool,
    pub(crate) output_tearing_active: bool,
    pub(crate) output_waitable_object_active: bool,
    pub(crate) output_present_healthy: bool,
    pub(crate) output_present_consecutive_failures: u32,
    pub(crate) swapchain_present_attempts: u64,
    pub(crate) swapchain_presented: u64,
    pub(crate) swapchain_present_failures: u64,
    pub(crate) swapchain_last_present_result: String,
    pub(crate) swapchain_last_present_error: String,
    pub(crate) swapchain_present_timeouts: u64,
    pub(crate) swapchain_present_occluded: u64,
    pub(crate) swapchain_present_outdated: u64,
    pub(crate) swapchain_present_lost: u64,
    pub(crate) swapchain_present_validation_errors: u64,
    pub(crate) swapchain_present_max_consecutive_failures: u32,
    pub(crate) swapchain_present_tearing_attempts: u64,
    pub(crate) swapchain_waitable_waits: u64,
    pub(crate) swapchain_waitable_timeouts: u64,
    pub(crate) frames_without_swapchain_present: u64,
    pub(crate) supports_tearing: bool,
    pub(crate) supports_waitable_object: bool,
    pub(crate) gpu_timing_supported: bool,
    pub(crate) avg_render_cpu_ms: f64,
    pub(crate) last_render_gpu_ms: f64,
    pub(crate) avg_render_gpu_ms: f64,
    pub(crate) max_render_gpu_ms: f64,
    pub(crate) gpu_timing_samples: u64,
    pub(crate) gpu_timing_resolve_misses: u64,
    pub(crate) last_frame_error: Option<String>,
}

#[derive(Clone, Debug, Serialize, Default)]
pub(crate) struct CoreStats {
    pub(crate) frames_submitted: u64,
    pub(crate) gpu_frames_submitted: u64,
    pub(crate) gpu_frames_completed: u64,
    pub(crate) gpu_backpressure_skips: u64,
    pub(crate) frames_presented: u64,
    pub(crate) frames_presented_explicit: u64,
    pub(crate) frames_presented_auto: u64,
    pub(crate) commands_applied: u64,
    pub(crate) commands_dropped: u64,
    pub(crate) batch_commands_coalesced: u64,
    pub(crate) command_queue_peak: u64,
    pub(crate) command_drain_limit_hits: u64,
    pub(crate) queued_commands_after_drain: u64,
    pub(crate) draw_calls: u64,
    pub(crate) shader_precompile_queued: u64,
    pub(crate) shader_precompile_compiled: u64,
    pub(crate) shader_precompile_failed: u64,
    pub(crate) shader_precompile_dropped: u64,
    pub(crate) source_frame_uploads: u64,
    pub(crate) source_frame_bytes_uploaded: u64,
    pub(crate) source_frame_cpu_fallback_uploads: u64,
    pub(crate) source_frame_file_uploads: u64,
    pub(crate) source_frame_base64_uploads: u64,
    pub(crate) source_frame_json_uploads: u64,
    pub(crate) source_frame_shared_texture_uploads: u64,
    pub(crate) source_frame_shared_texture_rejected_uploads: u64,
    pub(crate) source_frame_rejected_uploads: u64,
    pub(crate) source_frame_input_bytes_uploaded: u64,
    pub(crate) source_frame_resampled_bytes_uploaded: u64,
    pub(crate) source_frame_last_input_bytes: u64,
    pub(crate) source_frame_last_upload_bytes: u64,
    pub(crate) source_frame_last_upload_width: u32,
    pub(crate) source_frame_last_upload_height: u32,
    pub(crate) source_frame_last_upload_transport: String,
    pub(crate) source_frame_last_reject_reason: String,
    pub(crate) native_image_decodes: u64,
    pub(crate) native_image_decode_failures: u64,
    pub(crate) native_image_decode_bytes_uploaded: u64,
    pub(crate) native_image_decode_last_error: String,
    /// ffmpeg processes an offline render started for its videos (one
    /// reader per source, plus a one-frame decode where a reader could not).
    pub(crate) manual_video_decoder_starts: u64,
    pub(crate) native_video_frame_decodes: u64,
    pub(crate) native_video_hardware_frames: u64,
    pub(crate) native_video_hap_frames: u64,
    pub(crate) native_video_last_pixel_format: String,
    pub(crate) native_video_software_frames: u64,
    pub(crate) native_video_hardware_fallbacks: u64,
    pub(crate) native_video_frame_decode_failures: u64,
    pub(crate) native_video_frame_decode_bytes_uploaded: u64,
    pub(crate) native_video_frame_decode_last_error: String,
    pub(crate) decode_jobs_submitted: u64,
    pub(crate) decode_jobs_completed: u64,
    pub(crate) decode_jobs_dropped: u64,
    pub(crate) decode_queue_peak: u64,
    pub(crate) native_video_frame_cache_hits: u64,
    pub(crate) native_video_frame_cache_misses: u64,
    pub(crate) native_video_frame_cache_evictions: u64,
    pub(crate) native_video_session_evictions: u64,
    pub(crate) media_source_orphan_releases: u64,
    pub(crate) video_oneshot_decodes_during_playback: u64,
    pub(crate) native_video_trigger_last_latency_us: u64,
    pub(crate) native_video_trigger_max_latency_us: u64,
    pub(crate) native_video_stream_underflows: u64,
    pub(crate) native_shader_renders: u64,
    pub(crate) native_instrument_frame_renders: u64,
    pub(crate) vram_evictions: u64,
    pub(crate) vram_evicted_bytes: u64,
    pub(crate) compute_graph_runs: u64,
    pub(crate) compute_graph_passes: u64,
    pub(crate) compute_graph_render_passes: u64,
    pub(crate) compute_graph_snapshot_renders: u64,
    pub(crate) compute_graph_source_frame_renders: u64,
    pub(crate) compute_graph_readbacks: u64,
    pub(crate) compute_graph_readback_bytes: u64,
    pub(crate) compute_graph_persistent_buffers: u64,
    pub(crate) render_clock_updates: u64,
    pub(crate) manual_clock_graph_steps_skipped: u64,
    pub(crate) frame_snapshot_reads: u64,
    pub(crate) frame_snapshot_bytes_read: u64,
    pub(crate) frame_health_checks: u64,
    pub(crate) dark_frame_warnings: u64,
    pub(crate) shader_cache_entries: u64,
    pub(crate) pipeline_cache_entries: u64,
    pub(crate) precompiled_vertex_shaders: u64,
    pub(crate) precompiled_pixel_shaders: u64,
    pub(crate) last_render_cpu_ms: f64,
    pub(crate) avg_render_cpu_ms: f64,
    pub(crate) last_render_gpu_ms: f64,
    pub(crate) avg_render_gpu_ms: f64,
    pub(crate) max_render_gpu_ms: f64,
    pub(crate) gpu_timing_supported: bool,
    pub(crate) gpu_timing_samples: u64,
    pub(crate) gpu_timing_disjoint: u64,
    pub(crate) gpu_timing_resolve_misses: u64,
    pub(crate) swapchain_present_attempts: u64,
    pub(crate) swapchain_presented: u64,
    pub(crate) swapchain_present_failures: u64,
    pub(crate) swapchain_last_present_result: String,
    pub(crate) swapchain_last_present_error: String,
    pub(crate) swapchain_present_timeouts: u64,
    pub(crate) swapchain_present_occluded: u64,
    pub(crate) swapchain_present_outdated: u64,
    pub(crate) swapchain_present_lost: u64,
    pub(crate) swapchain_present_validation_errors: u64,
    pub(crate) swapchain_present_consecutive_failures: u32,
    pub(crate) swapchain_present_max_consecutive_failures: u32,
    pub(crate) output_last_presented_layer_count: u32,
    pub(crate) swapchain_present_tearing_attempts: u64,
    pub(crate) swapchain_waitable_waits: u64,
    pub(crate) swapchain_waitable_timeouts: u64,
    pub(crate) frames_without_swapchain_present: u64,
}

impl App {
    pub(crate) fn capabilities(&self) -> Value {
        let shared_texture_media_transport = self.shared_texture_media_transport_ready();
        let source_frame_shared_texture_import = self.source_frame_shared_texture_import_contract();
        let output_shared_texture_export = self.output_shared_texture_export_contract();
        let source_frame_shared_texture_import_ready = source_frame_shared_texture_import
            .get("available")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let output_shared_texture_export_ready = output_shared_texture_export
            .get("available")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        // The render core can publish the one true composite frame before the
        // editor has a production presenter for it. Do not treat the old
        // child-window/underlay probe as ready: on macOS it can be compositor
        // occluded and it still competes with DOM z-order. Full native waits for
        // the embedded shared-texture presenter.
        let native_editor_preview_frame_source_ready = output_shared_texture_export_ready;
        let native_editor_preview = json!({
            "available": false,
            "mode": if native_editor_preview_frame_source_ready {
                "embedded-presenter-pending"
            } else {
                "unavailable"
            },
            "presentation": if self.editor_preview_parented_window { "parented-underlay-probe" } else { "unavailable" },
            "needs_underlay_lock_in": true,
            "production_ready": false,
            "parented": self.editor_preview_parented_window,
            "source": if native_editor_preview_frame_source_ready { "core-output-composite" } else { "native-unavailable" },
            "single_render": native_editor_preview_frame_source_ready,
            "transport": if native_editor_preview_frame_source_ready {
                output_shared_texture_export
                    .get("platform")
                    .and_then(Value::as_str)
                    .unwrap_or("shared-texture")
            } else {
                "none"
            },
            "color_space": "srgb",
            "storage_format": "bgra8unorm",
            "storage_encoding": "srgb-encoded-bgra8unorm",
            "alpha_mode": "opaque",
            "premultiplied_alpha": false,
            "zero_conversions": true,
            "reason": if native_editor_preview_frame_source_ready {
                json!("native core-output composite is available; editor embedded shared-texture presenter is pending")
            } else {
                json!("native output shared-texture export is unavailable")
            },
        });
        let features = json!({
            "separate_process_render_core": true,
            "managed_native_window": true,
            "audio_uniform_layout": true,
            "layer_compositor": true,
            "layer_corner_warp": true,
            "layer_uv_controls": true,
            "layer_shape_masks": true,
            "layer_mesh_warp": true,
            "blend_modes": true,
            "effect_descriptors": true,
            "native_compositor_manifest": true,
            "render_clock": true,
            "frame_snapshot": true,
            "frame_snapshot_export": true,
            "native_frame_export": true,
            "native_frame_sequence_export": true,
            "frame_health": true,
            "gpu_timing": self.renderer.as_ref().is_some_and(|renderer| renderer.gpu_timing.is_some()),
            "shader_precompile": true,
            "fragment_wgsl_host": true,
            "isf_glsl_parse_probe": true,
            "isf_glsl_host": true,
            "native_instrument_proxies": false,
            "source_preview_upload": true,
            "source_frame_upload": true,
            "source_frame_file_handoff": true,
            "source_frame_mips": self.renderer.as_ref().is_some_and(|renderer| renderer.source_frame_mip_levels > 1),
            // The compositor build that reads minified pictures' mips is made
            // on a worker after start; until then frames read level zero.
            "compositor_source_mips_ready": self.renderer.as_ref().is_some_and(|renderer| renderer.mips_pipeline.get().is_some()),
            "source_frame_hdr": self.renderer.as_ref().is_some_and(|renderer| renderer.source_frame_format == SOURCE_FRAME_FORMAT_HDR),
            "native_static_image_decode": true,
            "native_static_image_prefetch": true,
            "native_video_frame_decode": true,
            "native_video_frame_prefetch": true,
            "native_video_frame_prefetch_window": true,
            "video_frame_prefetch": true,
            "native_media_source_playback_state": true,
            "native_video_decode_pump": true,
            "native_hap_compressed_textures": cfg!(any(target_os = "macos", target_os = "windows")) && self.renderer.as_ref().is_some_and(|r| r.device.features().contains(wgpu::Features::TEXTURE_COMPRESSION_BC)),
            "native_hap_formats": ["Hap1", "Hap5", "HapY", "HapM", "Hap7"],
            "native_video_decode_pump_window": true,
            "decode_policy_controls": true,
            "decode_preview_cache_clear": true,
            "media_policy_controls": true,
            "vram_budget_policy": true,
            "vram_budget_enforcement": true,
            "runtime_cache_clear": true,
            "native_graph_buffer_prune": true,
            // Interactive replay leaves unmodulated uniform values to the app,
            // so they can be changed with update_native_graph_buffer alone.
            "native_interactive_value_updates": true,
            "compute_shader_host": true,
            "compute_graph_host": true,
            "compute_graph_render": true,
            "compute_graph_multi_render": true,
            "compute_graph_instanced_render": true,
            "compute_graph_indirect_render": true,
            "compute_graph_texture_sampling": true,
            // Graph-owned textures (upsert_compute_graph_textures): an
            // Interactive 3D scene's and a video synthesizer's own targets.
            "compute_graph_textures": true,
            "compute_graph_depth_render": true,
            "compute_graph_line_render": true,
            "compute_graph_clear_color": true,
            "compute_graph_source_frame_target": true,
            "native_effect_pass_manifest": true,
            "persistent_compute_buffers": true,
            "native_planet_graph": true,
            "native_lines_graph": true,
            "native_svg_graph": true,
            "native_light_painting_graph": true,
            "native_text_graph": true,
            "native_splat_graph": true,
            "native_model3d_graph": true,
            "native_3d_smoke_graph": true,
            "native_particle_field_graph": true,
            "native_volumetric_spheres_graph": true,
            "native_strands_graph": true,
            "native_cloud_pulse_graph": true,
            "native_cloud_flock_graph": true,
            "native_depth_lights_graph": true,
            "native_ribbon_field_graph": true,
            "native_shockwave_rings_graph": true,
            "native_fluid_ink_graph": true,
            "native_lightning_arcs_graph": true,
            "native_spectral_terrain_graph": true,
            "native_mesh_shatter_graph": true,
            "native_audio_visual_data": true,
            "native_hdr_post_chain": true,
            "native_smoke_riders_graph": true,
            "native_ink_cloud_graph": true,
            "native_flythrough_graph": true,
            "native_pixel_particles_graph": true,
            "native_point_cloud_fx_graph": true,
            "native_ghostfx_graph": true,
            "native_handfx_graph": true,
            "native_performer_world_graph": true,
            "native_scene3d_graph": true,
            "native_videosynth_graph": true,
            "native_vj_crossfade_graph": true,
            "native_vj_mix_graph": true,
            "command_drain_policy": true,
            "auto_present_policy": true,
            "multi_pass_instruments": true,
            "storage_buffer_instruments": true,
            "shared_texture_source_frame_upload": source_frame_shared_texture_import_ready,
            "native_output_mirror_texture": true,
            "native_post_composite_graph": true,
            "shared_texture_upload": shared_texture_media_transport,
            "shared_texture_output_export": output_shared_texture_export_ready,
            "native_texture_share_sender": texture_share::implemented(),
            "native_editor_preview_frame_source": output_shared_texture_export_ready,
            "native_media_decode": true,
            "media_prefetch": true,
            "present_policy": true,
            "managed_output_attach": true,
            "managed_output_window_control": true,
            "native_stage3d_scene_ingest": true,
            "native_stage3d_overlay_preview": true,
            "native_stage3d_mesh_preview": true,
            "native_stage3d_textured_mesh_preview": true,
            "native_stage3d_primitive_meshes": true,
            "native_stage3d_xyz_mesh_transforms": true,
            "native_stage3d_lighting_preview": true,
            "native_stage3d_output_renderer": true,
            "native_stage3d_recording_parity": true,
            "native_projection_sim_scene_ingest": true,
            "native_projection_sim_overlay_preview": true,
            "native_projection_sim_mesh_preview": true,
            "native_projection_sim_textured_mesh_preview": true,
            "native_projection_sim_xyz_mesh_transforms": true,
            "native_projection_sim_output_renderer": true,
            "native_projection_sim_projector_view": true,
            "native_projection_sim_recording_parity": true,
            "native_launch_resource_fences": true,
            "native_scheduled_transition_start": true,
            "native_clip_audio_tap": true,
            "native_clip_audio_transition_fades": true,
            "native_prepared_fade_playback": true,
            "native_mixed_column_launch": true,
            "native_recording": false,
            "native_stage3d": true,
            "native_projection_sim": true
        });
        let limits = json!({
            "max_scene_layers": MAX_SCENE_LAYERS,
            "source_preview_size": SOURCE_PREVIEW_SIZE,
            "source_preview_slots": MAX_SOURCE_PREVIEWS,
            "source_frame_slots": self.source_frame_capacity(),
            "source_frame_slot_ceiling": self.renderer.as_ref().map(|renderer| renderer.slots.max_capacity()).unwrap_or(INITIAL_SOURCE_FRAME_SLOTS),
            "source_frame_store": self.renderer.as_ref().map(|renderer| renderer.slots.mode().label()).unwrap_or("none"),
            "source_frame_size": self.renderer.as_ref().map(|renderer| renderer.source_frame_size).unwrap_or(SOURCE_FRAME_SIZE_DEFAULT),
            "source_frame_mip_levels": self.renderer.as_ref().map(|renderer| renderer.source_frame_mip_levels).unwrap_or(1),
            "command_queue_capacity": self.command_queue_capacity,
            "command_drain_limit": self.command_drain_limit,
            "media_queue_capacity": self.media_queue_capacity,
            "decode_handoff_queue_capacity": self.decode_handoff_queue_capacity,
            "vram_budget_mb": self.vram_budget_mb
        });
        json!({
            "schema_version": 1,
            "core_version": env!("CARGO_PKG_VERSION"),
            "backend": native_backend_name(),
            "implemented_methods": CORE_RPC_METHODS,
            "implemented_command_types": CORE_COMMAND_TYPES,
            "native_compositor_blend_modes": native_compositor_blend_manifest(),
            "native_compositor_effect_descriptors": native_compositor_effect_manifest(),
            "native_effect_pass_descriptors": native_effect_pass_manifest(),
            "native_graph_instruments": native_graph_instrument_ids(),
            "native_graph_instrument_manifest": native_graph_instrument_manifest(),
            "audio_uniform_layout": ghost_audio_uniform_layout(),
            "scene3d_frame_layout": scene_frame::layout(),
            "source_frame_shared_texture_import": source_frame_shared_texture_import,
            "output_shared_texture_export": output_shared_texture_export,
            "native_editor_preview": native_editor_preview,
            "native_scene_bridge": {
                "stage3d": self.stage3d_scene_summary,
                "projection_sim": self.projection_sim_scene_summary,
            },
            "features": features,
            "limits": limits,
            "notes": [
                native_graph_instruments_note(),
                shared_texture_media_transport_note(),
                "Native frame export is owned by the render core; MP4/JPEG sequence encoding is completed by the Electron bridge.",
                "Local video media decode is render-clock driven in the native core: visible video sources pump FFmpeg-decoded frame windows into native source-frame textures with adjacent-frame cache prefetch."
            ]
        })
    }

    pub(crate) fn source_frame_shared_texture_import_contract(&self) -> Value {
        let renderer_ready = self.renderer.is_some();
        #[cfg(target_os = "macos")]
        {
            json!({
                "available": renderer_ready,
                "backend": native_backend_name(),
                "platform": "iosurface",
                "importer": "metal-iosurface",
                "handle_scope": "global-id",
                "accepted_handle_encodings": ["integer", "base64", "hex", "opaque"],
                "accepted_formats": ["bgra8unorm", "rgba8unorm", "80", "87", "28", "70"],
                "reason": if renderer_ready { Value::Null } else { json!("native renderer is not running") },
            })
        }
        #[cfg(target_os = "windows")]
        {
            json!({
                "available": renderer_ready,
                "backend": native_backend_name(),
                "platform": "dxgi",
                "importer": "d3d12-open-shared-handle",
                "handle_scope": "process-handle",
                "accepted_handle_encodings": ["integer", "base64", "hex", "opaque"],
                "accepted_formats": ["bgra8unorm", "rgba8unorm", "80", "87", "28", "70"],
                "reason": if renderer_ready { Value::Null } else { json!("native renderer is not running") },
            })
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            json!({
                "available": false,
                "backend": native_backend_name(),
                "platform": "unsupported",
                "importer": "none",
                "handle_scope": "",
                "accepted_handle_encodings": [],
                "accepted_formats": [],
                "reason": "native source-frame shared texture import is only implemented for Metal IOSurface and D3D12 DXGI",
            })
        }
    }

    pub(crate) fn output_shared_texture_export_contract(&self) -> Value {
        let output_export_ready = self
            .renderer
            .as_ref()
            .is_some_and(RenderState::output_export_ready);
        #[cfg(target_os = "macos")]
        {
            json!({
                "available": output_export_ready,
                "backend": native_backend_name(),
                "platform": "iosurface",
                "exporter": "metal-iosurface",
                "handle_scope": "global-id",
                "preferred_transport": "handle",
                "handle_encoding": "integer",
                "handle_byte_length": 4,
                "exported_formats": ["bgra8unorm"],
                "color_space": "srgb",
                "storage_format": "bgra8unorm",
                "storage_encoding": "srgb-encoded-bgra8unorm",
                "alpha_mode": "opaque",
                "premultiplied_alpha": false,
                "single_render_source": "core-output-composite",
                "zero_conversions": true,
                "publisher": "SyphonOutput.publishIOSurface",
                "reason": if output_export_ready { Value::Null } else { json!("native output IOSurface export target is unavailable") },
            })
        }
        #[cfg(target_os = "windows")]
        {
            json!({
                "available": output_export_ready,
                "backend": native_backend_name(),
                "platform": "dxgi",
                "exporter": "d3d12-shared-resource-name",
                "handle_scope": "process-local",
                "preferred_transport": "shared_name",
                "handle_encoding": "integer",
                "handle_byte_length": 8,
                "name_scope": "local-session",
                "exported_formats": ["bgra8unorm"],
                "color_space": "srgb",
                "storage_format": "bgra8unorm",
                "storage_encoding": "srgb-encoded-bgra8unorm",
                "alpha_mode": "opaque",
                "premultiplied_alpha": false,
                "single_render_source": "core-output-composite",
                "zero_conversions": true,
                "publisher": "SpoutOutput.sendTextureByName",
                "reason": if output_export_ready { Value::Null } else { json!("native output DXGI export target is unavailable") },
            })
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            json!({
                "available": false,
                "backend": native_backend_name(),
                "platform": "unsupported",
                "exporter": "none",
                "handle_scope": "",
                "preferred_transport": "",
                "handle_encoding": "",
                "handle_byte_length": 0,
                "exported_formats": [],
                "color_space": "srgb",
                "storage_format": "bgra8unorm",
                "storage_encoding": "srgb-encoded-bgra8unorm",
                "alpha_mode": "opaque",
                "premultiplied_alpha": false,
                "single_render_source": "core-output-composite",
                "zero_conversions": true,
                "publisher": "none",
                "reason": "native output shared-texture export is only implemented for Metal IOSurface and D3D12 DXGI",
            })
        }
    }

    pub(crate) fn shared_texture_media_transport_ready(&self) -> bool {
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        {
            self.renderer.is_some()
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            false
        }
    }

    pub(crate) fn status(&self) -> CoreStatus {
        let clip_audio_health = self.clip_audio.as_ref().map(clip_audio::ClipAudio::health)
            .unwrap_or((0, 0, 0.0, "idle"));
        let gpu_frames_submitted = self
            .renderer
            .as_ref()
            .map(|renderer| renderer.gpu_frames_submitted)
            .unwrap_or(self.stats.gpu_frames_submitted);
        let gpu_frames_completed = self
            .renderer
            .as_ref()
            .map(RenderState::gpu_frames_completed)
            .unwrap_or(self.stats.gpu_frames_completed);
        let last_frame_error = self
            .renderer
            .as_ref()
            .and_then(|r| r.last_frame_error.clone());
        let last_frame_metrics = self
            .renderer
            .as_ref()
            .and_then(|renderer| renderer.last_frame_metrics.as_ref());
        let (
            gpu_timing_supported,
            last_render_gpu_ms,
            avg_render_gpu_ms,
            max_render_gpu_ms,
            gpu_timing_samples,
            gpu_timing_resolve_misses,
        ) = self
            .renderer
            .as_ref()
            .map(|renderer| renderer.gpu_timing_stats())
            .unwrap_or((false, 0.0, 0.0, 0.0, 0, 0));
        let native_instrument_proxy_layers = 0;
        let scene_layers_active = self
            .scene_layers
            .values()
            .filter(|layer| layer.visible && layer.opacity > 0.0)
            .count()
            .min(1024) as u32;
        let native_graph_source_frame_layers = self
            .scene_layers
            .values()
            .filter(|layer| {
                layer.visible
                    && !layer.shader_rendered
                    && layer.source_id.as_deref().is_some_and(|source_id| {
                        self.source_frame_slots.contains_key(source_id)
                            && self.source_frames.contains_key(source_id)
                    })
            })
            .count()
            .min(1024) as u32;
        let renderer_ready = self.renderer.is_some();
        let last_frame_ok = last_frame_error.is_none();
        let output_window_attached = self.output_window_attached && renderer_ready;
        let output_has_presented = self.stats.swapchain_presented > 0;
        let output_swapchain_ready =
            output_window_attached && last_frame_ok && output_has_presented;
        let output_present_healthy =
            output_swapchain_ready && self.stats.swapchain_present_consecutive_failures == 0;
        let native_video_sessions = self
            .native_video_streams
            .iter()
            .map(|(source_id, session)| {
                let buffered_frames =
                    session.stream.buffered_frames().min(u32::MAX as usize) as u32;
                let (clock_seconds, next_frame_seconds, play_state_changes) = session.stream.timing();
                let (source_time_seconds, source_frame_duration_seconds, source_fps, source_duration_seconds) = session.stream.source_timing();
                let (scrub_cache_hits, scrub_cache_misses, forward_continuations) = session.stream.scrub_cache_stats();
                NativeVideoSessionStatus {
                    phase_error_seconds: session.phase_error_seconds,
                    playback_rate: self.media_sources.get(source_id).map_or(1.0, |state| state.playback_rate),
                    clock_seconds, next_frame_seconds, play_state_changes,
                    backend: session.stream.backend().to_string(),
                    fallback_reason: session.stream.fallback_reason(),
                    source_id: source_id.clone(),
                    signature: session.signature.clone(),
                    state: if session.playing {
                        "playing".to_string()
                    } else if buffered_frames >= session.stream.ready_frames() as u32 {
                        "prerolled".to_string()
                    } else {
                        "armed".to_string()
                    },
                    buffered_frames,
                    frames_presented: session.frames_presented,
                    seek_generation: session.seek_generation,
                    source_time_seconds, source_frame_duration_seconds, source_fps, source_duration_seconds,
                    source_frame_step_exact: session.stream.frame_step_exact(),
                    scrub_cache_hits, scrub_cache_misses, forward_continuations,
                    optional_cache_bytes: session.stream.optional_memory_bytes(),
                    frames_dropped: session.stream.dropped_frames(),
                    reserved_bytes: session.stream.memory_bytes() as u64,
                    waiting_for_memory_bytes: session.stream.memory_waiting_bytes(),
                    uri: self.media_sources.get(source_id).map(|state| state.uri.clone()).unwrap_or_default(),
                    decode_max_edge: session.decode_max_edge,
                }
            })
            .collect::<Vec<_>>();
        let native_video_sessions_playing = native_video_sessions
            .iter()
            .filter(|session| session.state == "playing")
            .count()
            .min(u32::MAX as usize) as u32;
        let native_video_sessions_prerolled = native_video_sessions
            .iter()
            .filter(|session| session.state == "prerolled")
            .count()
            .min(u32::MAX as usize) as u32;
        let native_video_sessions_armed = native_video_sessions
            .len()
            .saturating_sub(native_video_sessions_playing as usize)
            .saturating_sub(native_video_sessions_prerolled as usize)
            .min(u32::MAX as usize) as u32;
        CoreStatus {
            running: self.running,
            backend: native_backend_name().to_string(),
            backend_ready: renderer_ready && last_frame_ok,
            adapter_name: self.adapter_name.clone(),
            adapter_is_software: self.adapter_is_software,
            adapter_luid: self.adapter_luid.clone(),
            native_caps: self
                .renderer
                .as_ref()
                .map(|renderer| renderer.native_caps.clone())
                .unwrap_or_default(),
            native_quality: self.native_quality.clone(),
            width: self.pending_width,
            height: self.pending_height,
            target_fps: self.target_fps,
            present_mode: self.present_mode.clone(),
            surface_present_mode: self
                .renderer
                .as_ref()
                .map(RenderState::present_mode_label)
                .unwrap_or_else(|| "unconfigured".to_string()),
            allow_tearing: self.allow_tearing,
            max_frame_latency: self.max_frame_latency,
            use_waitable_object: false,
            command_queue_capacity: self.command_queue_capacity,
            command_drain_limit: self.command_drain_limit,
            auto_present_on_state_change: self.auto_present_on_state_change,
            decode_store_cpu_backup_frames: self.decode_store_cpu_backup_frames,
            decode_allow_synthetic_fallback: self.decode_allow_synthetic_fallback,
            media_queue_capacity: self.media_queue_capacity,
            decode_handoff_queue_capacity: self.decode_handoff_queue_capacity,
            media_high_burst_limit: self.media_high_burst_limit,
            prefetch_cache_max_entries: self.prefetch_cache_max_entries,
            prefetch_cache_prune_count: self.prefetch_cache_prune_count,
            media_drop_command_pressure_pct: self.media_drop_command_pressure_pct,
            media_drop_decode_pressure_pct: self.media_drop_decode_pressure_pct,
            media_drop_io_pressure_pct: self.media_drop_io_pressure_pct,
            media_drop_decode_priority_cutoff: self.media_drop_decode_priority_cutoff,
            media_drop_io_priority_cutoff: self.media_drop_io_priority_cutoff,
            decode_preview_size: self.decode_preview_size,
            decode_preview_cache_mb: self.decode_preview_cache_mb,
            decode_use_output_resolution: self.decode_use_output_resolution,
            decode_target_width: if self.decode_use_output_resolution {
                self.pending_width
            } else {
                self.decode_preview_size
            },
            decode_target_height: if self.decode_use_output_resolution {
                self.pending_height
            } else {
                self.decode_preview_size
            },
            decode_preview_cache_bypassed: false,
            decode_upload_queue_cap_mb: self.decode_upload_queue_cap_mb,
            decode_handoff_byte_cap_mb: self.decode_handoff_byte_cap_mb,
            video_decode_budget_mb: self.video_memory_budget.limit_bytes() / (1024 * 1024),
            gpu_memory_mb: self.gpu_memory_bytes.unwrap_or(0) / (1024 * 1024),
            decode_handoff_predecode_shed_pct: self.decode_handoff_predecode_shed_pct,
            decode_predecode_estimate_cache_entries: 0,
            decode_predecode_estimate_cache_cap_entries: self
                .decode_predecode_estimate_cache_cap_entries,
            decode_predecode_estimate_cache_backpressure_active: false,
            decode_backpressure_active: self.native_video_decode_pending.len()
                >= NATIVE_VIDEO_DECODE_MAX_IN_FLIGHT,
            decode_jobs_submitted: self.stats.decode_jobs_submitted,
            decode_jobs_completed: self.stats.decode_jobs_completed,
            decode_jobs_dropped: self.stats.decode_jobs_dropped,
            decode_queue_peak: self.stats.decode_queue_peak,
            vram_budget_mb: self.vram_budget_mb,
            native_graph_buffer_bytes: self
                .renderer
                .as_ref()
                .map(RenderState::native_compute_graph_buffer_bytes)
                .unwrap_or(0),
            native_graph_buffer_budget_bytes: self.native_graph_buffer_budget_bytes(),
            vram_evictions: self.stats.vram_evictions,
            vram_evicted_bytes: self.stats.vram_evicted_bytes,
            command_drain_limit_hits: self.stats.command_drain_limit_hits,
            queued_commands_after_drain: self.stats.queued_commands_after_drain,
            source_preview_size: SOURCE_PREVIEW_SIZE as u32,
            source_previews_active: self.source_previews.len().min(1024) as u32,
            source_preview_slots: MAX_SOURCE_PREVIEWS as u32,
            source_preview_dirty: self.source_preview_dirty,
            source_frame_size: self
                .renderer
                .as_ref()
                .map(|renderer| renderer.source_frame_size as u32)
                .unwrap_or(SOURCE_FRAME_SIZE_DEFAULT as u32),
            source_frame_format: self
                .renderer
                .as_ref()
                .map(|renderer| texture_format_label(renderer.source_frame_format).to_string())
                .unwrap_or_else(|| texture_format_label(SOURCE_FRAME_FORMAT_FALLBACK).to_string()),
            source_frame_hdr: self
                .renderer
                .as_ref()
                .map(|renderer| renderer.source_frame_format == SOURCE_FRAME_FORMAT_HDR)
                .unwrap_or(false),
            source_frame_mip_levels: self
                .renderer
                .as_ref()
                .map(|renderer| renderer.source_frame_mip_levels)
                .unwrap_or(1),
            source_frames_active: self.source_frames.len().min(1024) as u32,
            source_frame_slots: self.source_frame_capacity().min(u32::MAX as usize) as u32,
            source_frame_store: self.renderer.as_ref().map(|r| r.slots.mode().label()).unwrap_or("none").to_string(),
            isf_shader_bindings: self.isf_layer_bindings.len().min(1024) as u32,
            isf_uniform_sets: self.isf_uniforms.len().min(1024) as u32,
            isf_pass_host_shaders: self.shader_isf_hosts.len().min(u32::MAX as usize) as u32,
            isf_multipass_renders: self.isf_multipass_renders,
            isf_pass_states: self
                .renderer
                .as_ref()
                .map(|renderer| renderer.isf_pass_state_summary().0 as u32)
                .unwrap_or(0),
            isf_pass_targets: self
                .renderer
                .as_ref()
                .map(|renderer| renderer.isf_pass_state_summary().1 as u32)
                .unwrap_or(0),
            isf_pass_target_bytes: self
                .renderer
                .as_ref()
                .map(|renderer| renderer.isf_pass_state_summary().2)
                .unwrap_or(0),
            isf_audio_spectrum_live: self.isf_audio_spectrum.is_live(Instant::now()),
            isf_audio_spectrum_seq: self.isf_audio_spectrum.seq,
            audio_visual_seq: self.audio_visual.seq,
            audio_visual_cloud_loads: self.audio_visual_cloud_loads(),
            isf_audio_fft_bins: self.isf_audio_spectrum.fft.len() as u32,
            isf_audio_waveform_samples: self.isf_audio_spectrum.waveform.len() as u32,
            native_shader_layers: self
                .scene_layers
                .values()
                .filter(|layer| layer.shader_rendered)
                .count()
                .min(1024) as u32,
            native_procedural_layers: self
                .scene_layers
                .values()
                .filter(|layer| {
                    layer.visible
                        && layer.frame_slot.is_none()
                        && (layer.shader_rendered || layer.source_kind >= 9.0)
                })
                .count()
                .min(1024) as u32,
            native_instrument_layers: native_instrument_proxy_layers,
            native_instrument_proxy_layers,
            native_graph_source_frame_layers,
            native_graph_workload: self.native_graph_workload.values().cloned().collect(),
            shader_precompile_queue_cap: self.shader_precompile_queue_cap,
            shader_precompile_per_frame: self.shader_precompile_per_frame,
            shader_metadata_cache_cap: self.shader_metadata_cache_cap,
            pipeline_metadata_cache_cap: self.pipeline_metadata_cache_cap,
            texture_pool_cap_mb: self.texture_pool_cap_mb,
            shader_cache_entries: self.shader_registry.len().min(u32::MAX as usize) as u32,
            pipeline_cache_entries: self
                .renderer
                .as_ref()
                .map(RenderState::native_pipeline_cache_count)
                .unwrap_or(0),
            precompiled_vertex_shaders: self.precompiled_shader_count("vertex"),
            precompiled_pixel_shaders: self.precompiled_shader_count("pixel"),
            shader_precompile_queued: self.stats.shader_precompile_queued,
            shader_precompile_compiled: self.stats.shader_precompile_compiled,
            shader_precompile_failed: self.stats.shader_precompile_failed,
            shader_precompile_dropped: self.stats.shader_precompile_dropped,
            source_frame_uploads: self.stats.source_frame_uploads,
            source_frame_bytes_uploaded: self.stats.source_frame_bytes_uploaded,
            source_frame_cpu_fallback_uploads: self.stats.source_frame_cpu_fallback_uploads,
            source_frame_file_uploads: self.stats.source_frame_file_uploads,
            source_frame_base64_uploads: self.stats.source_frame_base64_uploads,
            source_frame_json_uploads: self.stats.source_frame_json_uploads,
            source_frame_shared_texture_uploads: self.stats.source_frame_shared_texture_uploads,
            source_frame_shared_texture_rejected_uploads: self
                .stats
                .source_frame_shared_texture_rejected_uploads,
            source_frame_rejected_uploads: self.stats.source_frame_rejected_uploads,
            source_frame_input_bytes_uploaded: self.stats.source_frame_input_bytes_uploaded,
            source_frame_resampled_bytes_uploaded: self.stats.source_frame_resampled_bytes_uploaded,
            source_frame_last_input_bytes: self.stats.source_frame_last_input_bytes,
            source_frame_last_upload_bytes: self.stats.source_frame_last_upload_bytes,
            source_frame_last_upload_width: self.stats.source_frame_last_upload_width,
            source_frame_last_upload_height: self.stats.source_frame_last_upload_height,
            source_frame_last_upload_transport: if self
                .stats
                .source_frame_last_upload_transport
                .is_empty()
            {
                "none".to_string()
            } else {
                self.stats.source_frame_last_upload_transport.clone()
            },
            source_frame_last_reject_reason: if self
                .stats
                .source_frame_last_reject_reason
                .is_empty()
            {
                "none".to_string()
            } else {
                self.stats.source_frame_last_reject_reason.clone()
            },
            native_image_decodes: self.stats.native_image_decodes,
            native_image_decode_failures: self.stats.native_image_decode_failures,
            native_image_decode_bytes_uploaded: self.stats.native_image_decode_bytes_uploaded,
            native_image_decode_last_error: if self.stats.native_image_decode_last_error.is_empty()
            {
                "none".to_string()
            } else {
                self.stats.native_image_decode_last_error.clone()
            },
            graph_textures: self.renderer.as_ref().map_or(0, |renderer| renderer.native_graph_textures.len()),
            graph_texture_bytes: self.renderer.as_ref().map_or(0, |renderer| renderer.native_graph_textures.total_bytes()),
            native_video_frame_decodes: self.stats.native_video_frame_decodes,
            native_video_hardware_frames: self.stats.native_video_hardware_frames,
            native_video_hap_frames: self.stats.native_video_hap_frames,
            native_video_last_pixel_format: self.stats.native_video_last_pixel_format.clone(),
            native_video_software_frames: self.stats.native_video_software_frames,
            native_video_hardware_fallbacks: self.stats.native_video_hardware_fallbacks,
            native_video_frame_decode_failures: self.stats.native_video_frame_decode_failures,
            native_video_frame_decode_bytes_uploaded: self
                .stats
                .native_video_frame_decode_bytes_uploaded,
            native_video_frame_decode_last_error: if self
                .stats
                .native_video_frame_decode_last_error
                .is_empty()
            {
                "none".to_string()
            } else {
                self.stats.native_video_frame_decode_last_error.clone()
            },
            native_video_frame_cache_entries: self
                .native_video_frame_cache
                .len()
                .min(u32::MAX as usize) as u32,
            native_video_frame_cache_bytes: self.native_video_frame_cache_bytes as u64,
            native_video_frame_cache_hits: self.stats.native_video_frame_cache_hits,
            native_video_frame_cache_misses: self.stats.native_video_frame_cache_misses,
            native_video_frame_cache_evictions: self.stats.native_video_frame_cache_evictions,
            native_video_sessions,
            native_video_sessions_armed,
            native_video_sessions_prerolled,
            native_video_sessions_playing,
            native_video_session_evictions: self.stats.native_video_session_evictions,
            media_sources_active: self.media_sources.len().min(u32::MAX as usize) as u32,
            media_source_orphan_releases: self.stats.media_source_orphan_releases,
            video_oneshot_decodes_during_playback: self.stats.video_oneshot_decodes_during_playback,
            native_video_trigger_last_latency_us: self.stats.native_video_trigger_last_latency_us,
            native_video_trigger_max_latency_us: self.stats.native_video_trigger_max_latency_us,
            native_video_stream_underflows: self.stats.native_video_stream_underflows,
            clip_audio_underflow_events: clip_audio_health.0,
            clip_audio_underflow_frames: clip_audio_health.1,
            clip_audio_lookahead_ms: clip_audio_health.2,
            clip_audio_mixer_priority: clip_audio_health.3,
            native_instrument_frame_renders: self.stats.native_instrument_frame_renders,
            compute_graph_runs: self.stats.compute_graph_runs,
            compute_graph_passes: self.stats.compute_graph_passes,
            compute_graph_render_passes: self.stats.compute_graph_render_passes,
            compute_graph_snapshot_renders: self.stats.compute_graph_snapshot_renders,
            compute_graph_source_frame_renders: self.stats.compute_graph_source_frame_renders,
            compute_graph_readbacks: self.stats.compute_graph_readbacks,
            compute_graph_readback_bytes: self.stats.compute_graph_readback_bytes,
            compute_graph_persistent_buffers: self
                .renderer
                .as_ref()
                .map(RenderState::native_compute_graph_buffer_count)
                .unwrap_or(0),
            render_clock_mode: self.render_clock_mode.clone(),
            render_clock_time: self.native_clock_seconds(),
            render_clock_frame_index: self.native_frame_index(),
            render_clock_updates: self.stats.render_clock_updates,
            manual_clock_graph_steps_skipped: self.stats.manual_clock_graph_steps_skipped,
            frame_snapshot_reads: self.stats.frame_snapshot_reads,
            frame_snapshot_bytes_read: self.stats.frame_snapshot_bytes_read,
            frame_health_checks: self.stats.frame_health_checks,
            dark_frame_warnings: self.stats.dark_frame_warnings,
            last_frame_checksum: last_frame_metrics.map(|metrics| metrics.checksum.clone()),
            last_frame_nonzero_pixels: last_frame_metrics
                .map(|metrics| metrics.nonzero_pixels)
                .unwrap_or(0),
            last_frame_bright_pixels: last_frame_metrics
                .map(|metrics| metrics.bright_pixels)
                .unwrap_or(0),
            last_frame_average_luma: last_frame_metrics
                .map(|metrics| metrics.average_luma)
                .unwrap_or(0.0),
            last_frame_max_luma: last_frame_metrics
                .map(|metrics| metrics.max_luma)
                .unwrap_or(0.0),
            last_frame_dark: last_frame_metrics
                .map(|metrics| metrics.dark_frame)
                .unwrap_or(false),
            last_shader_error: self.last_shader_error.clone(),
            gpu_frames_submitted,
            gpu_frames_completed,
            gpu_backpressure_skips: self.stats.gpu_backpressure_skips,
            max_frames_in_flight: self.renderer.as_ref()
                .map_or_else(frames_in_flight::from_env, |renderer| renderer.frames_in_flight.report().cap),
            frames_in_flight: self.renderer.as_ref()
                .map(|renderer| renderer.frames_in_flight.report())
                .unwrap_or_default(),
            gpu_frame_latency: self.renderer.as_ref()
                .map(|renderer| renderer.gpu_frame_latency.report())
                .unwrap_or_default(),
            output_pacing: self.output_pacing_report(),
            output_display_pacing: self.display_pacing_report(),
            frames_presented: gpu_frames_completed,
            gpu_object_churn: churn_probe::counts(),
            gpu_pass_timing: pass_timing::report(),
            effect_shader_specialised_draws: effect_specialize::draws().0,
            effect_shader_shared_draws: effect_specialize::draws().1,
            commands_applied: self.stats.commands_applied,
            commands_dropped: self.stats.commands_dropped,
            layers_seen: self.layers_seen,
            scene_layers_active,
            output_last_presented_layer_count: self.output_last_presented_layer_count,
            output_width: self
                .renderer
                .as_ref()
                .map(|renderer| renderer.config.width)
                .unwrap_or(self.pending_width),
            output_height: self
                .renderer
                .as_ref()
                .map(|renderer| renderer.config.height)
                .unwrap_or(self.pending_height),
            output_format: self
                .renderer
                .as_ref()
                .map(|renderer| texture_format_label(renderer.config.format).to_string())
                .unwrap_or_else(|| "unknown".to_string()),
            output_refresh_hz: self
                .output_refresh_hz
                .filter(|_| self.output_window_attached)
                .map(|hz| hz.round() as u32)
                .unwrap_or(self.target_fps),
            output_window_attached,
            output_swapchain_ready,
            output_tearing_active: self
                .renderer
                .as_ref()
                .is_some_and(RenderState::tearing_active),
            output_waitable_object_active: false,
            output_present_healthy,
            output_present_consecutive_failures: self.stats.swapchain_present_consecutive_failures,
            swapchain_present_attempts: self.stats.swapchain_present_attempts,
            swapchain_presented: self.stats.swapchain_presented,
            swapchain_present_failures: self.stats.swapchain_present_failures,
            swapchain_last_present_result: if self.stats.swapchain_last_present_result.is_empty() {
                "none".to_string()
            } else {
                self.stats.swapchain_last_present_result.clone()
            },
            swapchain_last_present_error: if self.stats.swapchain_last_present_error.is_empty() {
                "none".to_string()
            } else {
                self.stats.swapchain_last_present_error.clone()
            },
            swapchain_present_timeouts: self.stats.swapchain_present_timeouts,
            swapchain_present_occluded: self.stats.swapchain_present_occluded,
            swapchain_present_outdated: self.stats.swapchain_present_outdated,
            swapchain_present_lost: self.stats.swapchain_present_lost,
            swapchain_present_validation_errors: self.stats.swapchain_present_validation_errors,
            swapchain_present_max_consecutive_failures: self
                .stats
                .swapchain_present_max_consecutive_failures,
            swapchain_present_tearing_attempts: self.stats.swapchain_present_tearing_attempts,
            swapchain_waitable_waits: self.stats.swapchain_waitable_waits,
            swapchain_waitable_timeouts: self.stats.swapchain_waitable_timeouts,
            frames_without_swapchain_present: self.stats.frames_without_swapchain_present,
            supports_tearing: self
                .renderer
                .as_ref()
                .is_some_and(RenderState::supports_tearing),
            supports_waitable_object: false,
            gpu_timing_supported,
            avg_render_cpu_ms: self.render_cpu_ema_ms,
            last_render_gpu_ms,
            avg_render_gpu_ms,
            max_render_gpu_ms,
            gpu_timing_samples,
            gpu_timing_resolve_misses,
            last_frame_error,
        }
    }

    /// Answer `probe_video` from a worker: opening a decoder (and on Windows
    /// decoding a first frame) must not hold up rendering.
    pub(crate) fn start_video_probe(&mut self, req: &RpcRequest) {
        let id = req.id;
        let Some(uri) = string_at(&req.params, &["uri"]).or_else(|| string_at(&req.params, &["path"])) else {
            self.send_error(id, "probe_video requires uri");
            return;
        };
        let Some(path) = local_media_path_from_uri(&uri) else {
            self.send_ok(id, json!({
                "uri": uri, "backend": "failed", "hardware": false,
                "reason": "Only video files on this computer can be checked",
            }));
            return;
        };
        let hap_supported = self.renderer.as_ref()
            .is_some_and(|r| r.device.features().contains(wgpu::Features::TEXTURE_COMPRESSION_BC));
        #[cfg(target_os = "windows")]
        let video_device = self.renderer.as_ref()
            .ok_or_else(|| "Renderer unavailable for hardware video".to_string())
            .and_then(|renderer| renderer.video_device.clone());
        #[cfg(target_os = "windows")]
        let video_memory = Some(self.video_memory_budget.clone());
        let responses = self.response_tx.clone();
        media_decode::spawn_probe(move || {
            let probe = media_decode::probe_native_video(
                &path,
                hap_supported,
                #[cfg(target_os = "windows")]
                video_device,
                #[cfg(target_os = "windows")]
                video_memory,
            );
            let mut result = serde_json::to_value(&probe).unwrap_or_else(|_| json!({}));
            result["uri"] = json!(uri);
            if id != 0 {
                let _ = responses.send(json!({ "id": id, "ok": true, "result": result }).to_string());
            }
        });
    }

    /// Ground truth for the Electron-side scene reconciler: what geometry the
    /// core is ACTUALLY compositing with, so a lost or misapplied upsert_layer
    /// can be detected and repaired instead of wedging the picture until the
    /// next unrelated edit.
    pub(crate) fn layers_snapshot_payload(&self) -> Value {
        let layers = self
            .scene_layers
            .values()
            .map(|layer| {
                // A shader dropped at the registry cap that this layer was
                // bound to again: the editor must send its source again.
                let evicted_shader_id = self.isf_layer_bindings.get(&layer.id).or(layer.shader_id.as_ref())
                    .filter(|id| !self.shader_registry.contains_key(*id) && self.evicted_shader_ids.contains(&stable_hash64(id)));
                json!({
                    "layer_id": layer.id,
                    "evicted_shader_id": evicted_shader_id,
                    "z_index": layer.z_index,
                    "visible": layer.visible,
                    "opacity": layer.opacity,
                    "blend_code": layer.blend_code,
                    "corners": layer.corners,
                    "uv0": layer.uv0,
                    "uv1": layer.uv1,
                    "source_id": layer.source_id,
                    "frame_slot": layer.frame_slot,
                    // The stored picture's size: the slot edge in the shared
                    // array, the picture's own size when per-source.
                    "frame_size": layer.frame_slot.and_then(|slot| self.renderer.as_ref()
                        .map(|renderer| { let stored = renderer.slots.slot(slot); [stored.width, stored.height] })),
                    "shader_frame_slot": layer.shader_frame_slot,
                    "source_kind": layer.source_kind,
                    "shader_rendered": layer.shader_rendered,
                    "held_source_id": layer.held.as_ref().map(|held| held.source_id.clone()),
                    "mesh_rows": layer.mesh_rows,
                    "mesh_cols": layer.mesh_cols,
                    "mask_info": layer.mask_info,
                    "mask_points_count": layer.mask_points.len(),
                    "paint_mask": self.paint_masks.layer_summary(&layer.id),
                })
            })
            .collect::<Vec<_>>();
        json!({ "layers": layers })
    }

    /// Sizes of the core's maps, lists and GPU resource registries: cheap
    /// (lengths and a few sums), for the soak test's checkpoints, to see which
    /// one grows over a long session.
    pub(crate) fn memory_stats(&self) -> Value {
        let mut counts = serde_json::Map::new();
        counts.insert("mirror_meshes".into(), json!(self.mirror_meshes.len()));
        counts.insert("scene_layers".into(), json!(self.scene_layers.len()));
        counts.insert("pending_media_bindings".into(), json!(self.pending_media_bindings.len()));
        counts.insert("native_graph_layers".into(), json!(self.native_graph_layers.len()));
        counts.insert("native_graph_workload".into(), json!(self.native_graph_workload.len()));
        counts.insert("native_plugin_liquid_states".into(), json!(self.native_plugin_liquid_states.len()));
        counts.insert("native_plugin_templates_initialized".into(), json!(self.native_plugin_templates_initialized.len()));
        counts.insert("native_plugin_audio_smooth".into(), json!(self.native_plugin_audio_smooth.len()));
        counts.insert("native_point_cloud_assets".into(), json!(self.native_point_cloud_assets.len()));
        counts.insert("pending_native_graph_jobs".into(), json!(self.pending_native_graph_jobs.len()));
        counts.insert("pending_composite_graph_jobs".into(), json!(self.pending_composite_graph_jobs.len()));
        counts.insert("ready_composite_graph_jobs".into(), json!(self.ready_composite_graph_jobs.len()));
        counts.insert("source_previews".into(), json!(self.source_previews.len()));
        counts.insert("source_preview_slots".into(), json!(self.source_preview_slots.len()));
        counts.insert("source_frames".into(), json!(self.source_frames.len()));
        counts.insert("source_frame_slots".into(), json!(self.source_frame_slots.len()));
        counts.insert("captured_graph_holds".into(), json!(self.captured_graph_holds.len()));
        counts.insert("source_frame_signatures".into(), json!(self.source_frame_signatures.len()));
        counts.insert("image_decode_queue".into(), json!(self.image_decode_queue.len()));
        counts.insert("video_prefetch_versions".into(), json!(self.video_prefetch_versions.len()));
        counts.insert("image_prefetch_waiters".into(), json!(self.image_prefetch_waiters.len()));
        counts.insert("native_video_frame_signatures".into(), json!(self.native_video_frame_signatures.len()));
        counts.insert("native_video_frame_cache".into(), json!(self.native_video_frame_cache.len()));
        counts.insert("native_video_frame_cache_order".into(), json!(self.native_video_frame_cache_order.len()));
        counts.insert("media_sources".into(), json!(self.media_sources.len()));
        counts.insert("clip_audio_fades".into(), json!(self.clip_audio_fades.len()));
        counts.insert("scheduled_transition_tokens".into(), json!(self.scheduled_transition_tokens.len()));
        counts.insert("transition_clocks".into(), json!(self.transition_clocks.len()));
        counts.insert("scheduled_binding_guards".into(), json!(self.scheduled_binding_guards.len()));
        counts.insert("prepared_launch_sources".into(), json!(self.prepared_launch_sources.len()));
        counts.insert("link_phase_anchors".into(), json!(self.link_phase_anchors.len()));
        counts.insert("deferred_source_releases".into(), json!(self.deferred_source_releases.len()));
        counts.insert("native_video_decode_pending".into(), json!(self.native_video_decode_pending.len()));
        counts.insert("native_video_decode_failed".into(), json!(self.native_video_decode_failed.len()));
        counts.insert("native_video_streams".into(), json!(self.native_video_streams.len()));
        counts.insert("native_video_scrub_requests".into(), json!(self.native_video_scrub_requests.len()));
        counts.insert("projection_sim_meshes".into(), json!(self.projection_sim_meshes.len()));
        counts.insert("projection_sim_overlays".into(), json!(self.projection_sim_overlays.len()));
        counts.insert("composite_effects".into(), json!(self.composite_effects.len()));
        counts.insert("slice_outputs".into(), json!(self.slice_outputs.len()));
        counts.insert("video_source_fps".into(), json!(self.video_source_fps.len()));
        counts.insert("manual_video_readers".into(), json!(self.manual_video_readers.len()));
        counts.insert("manual_video_report".into(), json!(self.manual_video_report.len()));
        counts.insert("isf_layer_bindings".into(), json!(self.isf_layer_bindings.len()));
        counts.insert("isf_frame_outputs".into(), json!(self.isf_frame_outputs.len()));
        counts.insert("isf_shared_footprints".into(), json!(self.isf_shared_footprints.len()));
        counts.insert("isf_uniforms".into(), json!(self.isf_uniforms.len()));
        counts.insert("isf_time_anchors".into(), json!(self.isf_time_anchors.len()));
        counts.insert("shader_registry".into(), json!(self.shader_registry.len()));
        counts.insert("shader_sources".into(), json!(self.shader_sources.len()));
        counts.insert("shader_isf_inputs".into(), json!(self.shader_isf_inputs.len()));
        counts.insert("shader_isf_hosts".into(), json!(self.shader_isf_hosts.len()));
        counts.insert("shader_reads_inputs".into(), json!(self.shader_reads_inputs.len()));
        counts.insert("isf_shader_last_used".into(), json!(self.isf_shader_last_used.len()));
        counts.insert("isf_shader_first_frame".into(), json!(self.isf_shader_first_frame.len()));
        counts.insert("evicted_shader_ids".into(), json!(self.evicted_shader_ids.len()));
        counts.insert("manual_clock_media_stash".into(), json!(self.manual_clock_media_stash.as_ref().map_or(0, |m| m.len())));
        counts.insert("batch_orphan_candidates".into(), json!(self.batch_orphan_candidates.as_ref().map_or(0, |m| m.len())));
        counts.insert("media_sources.unreferenced_tracked".into(), json!(self.orphan_sweep.tracked()));
        counts.insert("media_sources.library".into(), json!(self.media_sources.keys().filter(|id| id.starts_with("library:")).count()));
        counts.insert("media_sources.without_session".into(), json!(self.media_sources.keys().filter(|id| !self.native_video_streams.contains_key(*id)).count()));
        counts.insert("native_video_streams.library".into(), json!(self.native_video_streams.keys().filter(|id| id.starts_with("library:")).count()));
        let mut bytes = serde_json::Map::new();
        bytes.insert("shader_sources".into(), json!(self.shader_sources.values().map(|src| src.len() as u64).sum::<u64>()));
        bytes.insert("native_video_reserved".into(), json!(self.native_video_streams.values().map(|v| v.stream.memory_bytes() as u64).sum::<u64>()));
        bytes.insert("native_video_optional".into(), json!(self.native_video_streams.values().map(|v| v.stream.optional_memory_bytes() as u64).sum::<u64>()));
        bytes.insert("isf_audio_decode_scratch".into(), json!(self.isf_audio_decode_scratch.capacity()));
        bytes.insert("manual_video_report".into(), json!(self.manual_video_report.len()));
        let mut gpu = serde_json::Map::new();
        if let Some(r) = self.renderer.as_ref() {
            counts.insert("render.pipeline_used".into(), json!(r.pipeline_used.len()));
            counts.insert("render.pinned_buffers".into(), json!(r.pinned_buffers.len()));
            counts.insert("render.frame_uniform_pool".into(), json!(r.frame_uniform_pool.len()));
            counts.insert("render.pipeline_work".into(), json!(r.pipeline_work.len()));
            counts.insert("render.pipeline_failures".into(), json!(r.pipeline_failures.len()));
            counts.insert("render.isf_audio_rows".into(), json!(r.isf_audio_rows.len()));
            counts.insert("render.isf_pass_states".into(), json!(r.isf_pass_states.len()));
            counts.insert("render.native_shader_pipelines".into(), json!(r.native_shader_pipelines.len()));
            counts.insert("render.native_compute_pipelines".into(), json!(r.native_compute_pipelines.len()));
            counts.insert("render.native_graph_render_pipelines".into(), json!(r.native_graph_render_pipelines.len()));
            counts.insert("render.native_compute_graph_buffers".into(), json!(r.native_compute_graph_buffers.len()));
            counts.insert("render.pending_graph_readbacks".into(), json!(r.pending_graph_readbacks.len()));
            counts.insert("render.graph_readback_results".into(), json!(r.graph_readback_results.len()));
            counts.insert("render.slice_targets".into(), json!(r.slice_targets.len()));
            counts.insert("render.source_frame_gpu_readiness".into(), json!(r.source_frame_gpu_readiness.borrow().len()));
            counts.insert("render.graph_textures".into(), json!(r.native_graph_textures.len()));
            bytes.insert("render.graph_textures".into(), json!(r.native_graph_textures.total_bytes()));
            bytes.insert("render.source_frame_slots".into(), json!(r.slots.resident_bytes()));
            bytes.insert("render.graph_readback_results".into(), json!(r.graph_readback_results.values().map(|v| v.len() as u64).sum::<u64>()));
            bytes.insert("render.layer_upload_scratch".into(), json!(r.layer_upload_scratch.capacity() * std::mem::size_of::<LayerGpu>()));
            counts.insert("render.source_frame_capacity".into(), json!(r.slots.capacity()));
            if let Some(report) = r.wgpu_instance.generate_report() {
                let hub = report.hub_report();
                for (name, reg) in [
                    ("buffers", &hub.buffers), ("textures", &hub.textures), ("texture_views", &hub.texture_views),
                    ("samplers", &hub.samplers), ("bind_groups", &hub.bind_groups),
                    ("bind_group_layouts", &hub.bind_group_layouts), ("pipeline_layouts", &hub.pipeline_layouts),
                    ("shader_modules", &hub.shader_modules), ("render_pipelines", &hub.render_pipelines),
                    ("compute_pipelines", &hub.compute_pipelines), ("query_sets", &hub.query_sets),
                    ("command_encoders", &hub.command_encoders), ("command_buffers", &hub.command_buffers),
                ] {
                    gpu.insert(name.into(), json!(reg.num_kept_from_user));
                }
            }
        }
        // A few ids of the maps that should empty on a blank project, to tell
        // what stays behind (ids only, at most 32 each).
        let ids = |keys: Vec<&String>| keys.into_iter().take(32).cloned().collect::<Vec<_>>();
        let held_by = self.media_sources.keys().filter(|id| !id.starts_with("library:")).take(32)
            .map(|id| (id.clone(), json!(self.media_source_holders(id)))).collect::<serde_json::Map<_, _>>();
        let samples = json!({
            "media_source_holders": held_by,
            "media_sources": ids(self.media_sources.keys().collect()),
            "native_video_streams": ids(self.native_video_streams.keys().collect()),
            "source_frames": ids(self.source_frames.keys().collect()),
        });
        json!({ "counts": counts, "bytes": bytes, "wgpu": gpu, "samples": samples })
    }

    pub(crate) fn stats_payload(&mut self) -> Value {
        self.stats.avg_render_cpu_ms = self.render_cpu_ema_ms;
        if let Some(renderer) = self.renderer.as_ref() {
            let (
                gpu_timing_supported,
                last_render_gpu_ms,
                avg_render_gpu_ms,
                max_render_gpu_ms,
                gpu_timing_samples,
                gpu_timing_resolve_misses,
            ) = renderer.gpu_timing_stats();
            self.stats.gpu_timing_supported = gpu_timing_supported;
            self.stats.last_render_gpu_ms = last_render_gpu_ms;
            self.stats.avg_render_gpu_ms = avg_render_gpu_ms;
            self.stats.max_render_gpu_ms = max_render_gpu_ms;
            self.stats.gpu_timing_samples = gpu_timing_samples;
            self.stats.gpu_timing_resolve_misses = gpu_timing_resolve_misses;
            self.stats.compute_graph_persistent_buffers =
                renderer.native_compute_graph_buffer_count() as u64;
        }
        let mut value = json!(self.stats.clone());
        let intervals = &self.submitted_intervals_ms;
        value["submission_intervals"] = json!({ "samples": intervals.len(), "p99_ms": intervals.percentile(0.99),
            "p999_ms": intervals.percentile(0.999), "max_ms": intervals.max(), "coverage": "program submission cadence, not physical display timing" });
        value["live_resources"] = json!({
            "rpc_queued_bytes": self.fast_path.queued_bytes.load(Ordering::Acquire),
            "rpc_queued_requests": self.fast_path.queued.load(Ordering::Acquire).saturating_sub(self.fast_path.applied.load(Ordering::Acquire)),
            "video_prefetch_workers": self.video_prefetch_active, "video_prefetch_reserved_bytes": self.video_prefetch_bytes,
            "video_reserved_bytes": self.native_video_streams.values().map(|s| s.stream.memory_bytes() as u64).sum::<u64>(),
            "video_dropped_frames": self.native_video_streams.values().map(|s| s.stream.dropped_frames()).sum::<u64>(),
            "pipeline_workers": self.renderer.as_ref().map_or(0, |r| r.pipeline_work.len()),
            "image_decode_active": self.image_decode_active, "image_decode_queued": self.image_decode_queue.len(),
            "capture_busy": LIVE_CAPTURE_BUSY.load(Ordering::Acquire),
            "diagnostic_readback_busy": LIVE_DIAGNOSTIC_BUSY.load(Ordering::Acquire),
            "output_texture_bytes": self.renderer.as_ref().map_or(0, |r| r.config.width as u64 * r.config.height as u64 * 24),
            "slice_output_limit": MAX_SLICE_OUTPUTS,
            "slice_texture_budget_bytes": MAX_SLICE_TEXTURE_BYTES,
            "slice_texture_bytes": self.slice_outputs.iter().map(|s| s.width as u64 * s.height as u64 * 8).sum::<u64>(),
            "source_array_texture_bytes": self.renderer.as_ref().map_or(0, |r| r.slots.resident_bytes()),
            "source_frame_slots": self.source_frame_capacity(),
            "source_frame_store": self.renderer.as_ref().map(|r| r.slots.mode().label()).unwrap_or("none"),
            "decoded_video_cache_bytes": self.native_video_frame_cache_bytes,
            "graph_buffer_bytes": self.renderer.as_ref().map_or(0, |r| r.native_compute_graph_buffer_bytes()),
            "uniform_pool_bytes": self.renderer.as_ref().map_or(0, |r| r.frame_uniform_pool.iter().map(|b| b.byte_length).sum::<u64>()),
        });
        value["gpu_sample_age_ms"] = self.renderer.as_ref().and_then(|r| r.gpu_timing.as_ref()).filter(|t| t.sampled_at_ms > 0).map_or(Value::Null, |t| json!(epoch_ms().saturating_sub(t.sampled_at_ms)));
        value["last_media_pump_cpu_ms"] = json!(self.media_pump_ms);
        value["timing_coverage"] = json!({ "cpu": "graph preparation, program and auxiliary output encoding; media pump reported separately",
            "gpu_timestamps": "program encoder only; auxiliary work is included in completion fence", "completion": "program, deck monitors and slices" });
        value
    }
}
