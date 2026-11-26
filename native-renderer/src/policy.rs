//! Runtime policies: the start config, quality, budgets, decode and cache
//! policies, and clearing the runtime caches.

use crate::*;

impl App {
    pub(crate) fn apply_start_config(&mut self, params: &Value) {
        let config = params.get("config").unwrap_or(params);
        self.pending_width = number_at(config, &["width"])
            .unwrap_or(self.pending_width as f64)
            .round()
            .clamp(64.0, 16384.0) as u32;
        self.pending_height = number_at(config, &["height"])
            .unwrap_or(self.pending_height as f64)
            .round()
            .clamp(64.0, 16384.0) as u32;
        self.target_fps = number_at(config, &["target_fps"])
            .unwrap_or(self.target_fps as f64)
            .round()
            .clamp(1.0, 240.0) as u32;
        self.apply_present_policy(config);
        self.apply_command_drain_policy(config);
        self.apply_auto_present_policy(config);
        self.apply_native_quality_policy(config);
        self.apply_vram_budget(config);
        self.apply_decode_cpu_backup_policy(config);
        self.apply_decode_synthetic_fallback_policy(config);
        self.apply_media_prefetch_policy(config);
        self.apply_media_drop_policy(config);
        self.apply_decode_preview_policy(config);
        self.apply_decode_target_policy(config);
        self.apply_decode_upload_policy(config);
        self.apply_decode_handoff_policy(config);
        self.apply_decode_estimate_cache_policy(config);
        self.editor_parent_window_handle_hex =
            string_at(config, &["editor_parent_window_handle_hex"])
                .filter(|value| !value.trim().is_empty())
                .map(|value| value.to_string());
        self.editor_parent_window_handle_platform =
            string_at(config, &["editor_parent_window_handle_platform"])
                .filter(|value| !value.trim().is_empty())
                .map(|value| value.to_string());
        if let Some(renderer) = self.renderer.as_mut() {
            renderer.resize(PhysicalSize::new(self.pending_width, self.pending_height));
        }
    }

    pub(crate) fn clear_runtime_caches(&mut self, params: &Value) -> Value {
        let config = params.get("config").unwrap_or(params);
        let clear_precompiled_shaders = bool_at(config, &["clear_precompiled_shaders"])
            .or_else(|| bool_at(config, &["clearPrecompiledShaders"]))
            .unwrap_or(false);
        let clear_native_graph_buffers = bool_at(config, &["clear_native_graph_buffers"])
            .or_else(|| bool_at(config, &["clearNativeGraphBuffers"]))
            .or_else(|| bool_at(config, &["clear_graph_buffers"]))
            .or_else(|| bool_at(config, &["clearGraphBuffers"]))
            .unwrap_or(false);
        let graph_buffer_prefixes = string_array_at(config, &["native_graph_buffer_prefixes"])
            .or_else(|| string_array_at(config, &["nativeGraphBufferPrefixes"]))
            .or_else(|| string_array_at(config, &["graph_buffer_prefixes"]))
            .or_else(|| string_array_at(config, &["graphBufferPrefixes"]))
            .unwrap_or_default();

        let cleared_shader_records = if clear_precompiled_shaders {
            let count = self.shader_registry.len();
            self.shader_registry.clear();
            self.shader_sources.clear();
            self.shader_isf_inputs.clear();
            self.shader_isf_hosts.clear();
            // Same key space as the three above: uniform state for a shader
            // whose record is gone can never be read again. It was the one
            // shader-keyed map with no removal path anywhere, so clearing the
            // caches to reclaim memory left it behind.
            self.isf_uniforms.clear();
            count
        } else {
            0
        };

        let mut cleared_pipeline_entries = 0usize;
        let mut cleared_native_graph_buffers = 0usize;
        if let Some(renderer) = self.renderer.as_mut() {
            if clear_precompiled_shaders {
                cleared_pipeline_entries = renderer.clear_native_pipeline_caches();
            }
            if clear_native_graph_buffers || !graph_buffer_prefixes.is_empty() {
                cleared_native_graph_buffers = renderer.clear_native_compute_graph_buffers(
                    clear_native_graph_buffers,
                    &graph_buffer_prefixes,
                );
            }
            self.stats.pipeline_cache_entries = renderer.native_pipeline_cache_count() as u64;
            self.stats.compute_graph_persistent_buffers =
                renderer.native_compute_graph_buffer_count() as u64;
        }
        self.stats.shader_cache_entries = self.shader_registry.len() as u64;
        self.stats.precompiled_vertex_shaders = self.precompiled_shader_count("vertex") as u64;
        self.stats.precompiled_pixel_shaders = self.precompiled_shader_count("pixel") as u64;
        let cleared_source_frame_signatures = self.source_frame_signatures.len();
        self.source_frame_signatures.clear();
        let cleared_native_video_frame_signatures = self.native_video_frame_signatures.len();
        self.native_video_frame_signatures.clear();
        let cleared_native_video_decode_failures = self.native_video_decode_failed.len();
        self.native_video_decode_failed.clear();
        let (cleared_native_video_frame_cache_entries, cleared_native_video_frame_cache_bytes) =
            self.clear_native_video_frame_cache();

        json!({
            "cleared_shader_records": cleared_shader_records,
            "cleared_pipeline_entries": cleared_pipeline_entries,
            "cleared_native_graph_buffers": cleared_native_graph_buffers,
            "cleared_source_frame_signatures": cleared_source_frame_signatures,
            "cleared_native_video_frame_signatures": cleared_native_video_frame_signatures,
            "cleared_native_video_decode_failures": cleared_native_video_decode_failures,
            "cleared_native_video_frame_cache_entries": cleared_native_video_frame_cache_entries,
            "cleared_native_video_frame_cache_bytes": cleared_native_video_frame_cache_bytes,
            "remaining_shader_records": self.shader_registry.len(),
            "remaining_pipeline_entries": self.renderer.as_ref().map(RenderState::native_pipeline_cache_count).unwrap_or(0),
            "remaining_native_graph_buffers": self.renderer.as_ref().map(RenderState::native_compute_graph_buffer_count).unwrap_or(0),
            "graph_buffer_prefixes": graph_buffer_prefixes,
        })
    }

    pub(crate) fn apply_native_quality_policy(&mut self, params: &Value) {
        let config = params.get("config").unwrap_or(params);
        if let Some(policy) = string_at(config, &["native_quality_policy"])
            .or_else(|| string_at(config, &["quality_policy"]))
            .or_else(|| string_at(config, &["policy"]))
        {
            self.native_quality.set_policy(&policy);
        }
    }

    pub(crate) fn apply_shader_precompile_policy(&mut self, params: &Value) {
        self.shader_precompile_queue_cap =
            number_at(params, &["config", "shader_precompile_queue_cap"])
                .or_else(|| number_at(params, &["config", "queue_cap"]))
                .or_else(|| number_at(params, &["shader_precompile_queue_cap"]))
                .or_else(|| number_at(params, &["queue_cap"]))
                .unwrap_or(self.shader_precompile_queue_cap as f64)
                .round()
                .clamp(1.0, 65536.0) as u32;
        self.shader_precompile_per_frame =
            number_at(params, &["config", "shader_precompile_per_frame"])
                .or_else(|| number_at(params, &["config", "per_frame"]))
                .or_else(|| number_at(params, &["shader_precompile_per_frame"]))
                .or_else(|| number_at(params, &["per_frame"]))
                .unwrap_or(self.shader_precompile_per_frame as f64)
                .round()
                .clamp(1.0, 256.0) as u32;
    }

    pub(crate) fn apply_texture_pool_cap(&mut self, params: &Value) {
        self.texture_pool_cap_mb = number_at(params, &["config", "texture_pool_cap_mb"])
            .or_else(|| number_at(params, &["texture_pool_cap_mb"]))
            .unwrap_or(self.texture_pool_cap_mb as f64)
            .round()
            .clamp(16.0, 16384.0) as u32;
    }

    pub(crate) fn apply_vram_budget(&mut self, params: &Value) {
        self.vram_budget_mb = number_at(params, &["config", "vram_budget_mb"])
            .or_else(|| number_at(params, &["vram_budget_mb"]))
            .unwrap_or(self.vram_budget_mb as f64)
            .round()
            .clamp(64.0, 131_072.0) as u32;
    }

    pub(crate) fn native_graph_buffer_budget_bytes(&self) -> u64 {
        let vram_budget_bytes = u64::from(self.vram_budget_mb).saturating_mul(1024 * 1024);
        let texture_pool_bytes = u64::from(self.texture_pool_cap_mb).saturating_mul(1024 * 1024);
        let graph_slice = (vram_budget_bytes / 4).max(NATIVE_GRAPH_BUFFER_BUDGET_MIN_BYTES);
        graph_slice.min(texture_pool_bytes.max(NATIVE_GRAPH_BUFFER_BUDGET_MIN_BYTES))
    }

    pub(crate) fn apply_decode_cpu_backup_policy(&mut self, params: &Value) {
        let config = params.get("config").unwrap_or(params);
        self.decode_store_cpu_backup_frames = bool_at(config, &["decode_store_cpu_backup_frames"])
            .unwrap_or(self.decode_store_cpu_backup_frames);
    }

    pub(crate) fn apply_decode_synthetic_fallback_policy(&mut self, params: &Value) {
        let _config = params.get("config").unwrap_or(params);
        self.decode_allow_synthetic_fallback = false;
    }

    pub(crate) fn apply_media_prefetch_policy(&mut self, params: &Value) {
        let config = params.get("config").unwrap_or(params);
        self.media_queue_capacity = number_at(config, &["media_queue_capacity"])
            .unwrap_or(self.media_queue_capacity as f64)
            .round()
            .clamp(1.0, 1_000_000.0) as u32;
        self.decode_handoff_queue_capacity = number_at(config, &["decode_handoff_queue_capacity"])
            .unwrap_or(self.decode_handoff_queue_capacity as f64)
            .round()
            .clamp(1.0, 1_000_000.0) as u32;
        self.media_high_burst_limit = number_at(config, &["media_high_burst_limit"])
            .unwrap_or(self.media_high_burst_limit as f64)
            .round()
            .clamp(1.0, 255.0) as u32;
        self.prefetch_cache_max_entries = number_at(config, &["prefetch_cache_max_entries"])
            .unwrap_or(self.prefetch_cache_max_entries as f64)
            .round()
            .clamp(1.0, 1_000_000.0) as u32;
        self.prefetch_cache_prune_count = number_at(config, &["prefetch_cache_prune_count"])
            .unwrap_or(self.prefetch_cache_prune_count as f64)
            .round()
            .clamp(1.0, self.prefetch_cache_max_entries.max(1) as f64)
            as u32;
    }

    pub(crate) fn apply_media_drop_policy(&mut self, params: &Value) {
        let config = params.get("config").unwrap_or(params);
        self.media_drop_command_pressure_pct = number_at(config, &["command_pressure_pct"])
            .or_else(|| number_at(config, &["media_drop_command_pressure_pct"]))
            .unwrap_or(self.media_drop_command_pressure_pct as f64)
            .round()
            .clamp(1.0, 100.0) as u32;
        self.media_drop_decode_pressure_pct = number_at(config, &["decode_queue_pressure_pct"])
            .or_else(|| number_at(config, &["media_drop_decode_pressure_pct"]))
            .unwrap_or(self.media_drop_decode_pressure_pct as f64)
            .round()
            .clamp(1.0, 100.0) as u32;
        self.media_drop_io_pressure_pct = number_at(config, &["io_queue_pressure_pct"])
            .or_else(|| number_at(config, &["media_drop_io_pressure_pct"]))
            .unwrap_or(self.media_drop_io_pressure_pct as f64)
            .round()
            .clamp(1.0, 100.0) as u32;
        self.media_drop_decode_priority_cutoff = number_at(config, &["decode_priority_cutoff"])
            .or_else(|| number_at(config, &["media_drop_decode_priority_cutoff"]))
            .unwrap_or(self.media_drop_decode_priority_cutoff as f64)
            .round()
            .clamp(0.0, 255.0) as u32;
        self.media_drop_io_priority_cutoff = number_at(config, &["io_priority_cutoff"])
            .or_else(|| number_at(config, &["media_drop_io_priority_cutoff"]))
            .unwrap_or(self.media_drop_io_priority_cutoff as f64)
            .round()
            .clamp(0.0, 255.0) as u32;
    }

    pub(crate) fn apply_decode_preview_policy(&mut self, params: &Value) {
        let config = params.get("config").unwrap_or(params);
        self.decode_preview_size = number_at(config, &["decode_preview_size"])
            .unwrap_or(self.decode_preview_size as f64)
            .round()
            .clamp(16.0, 4096.0) as u32;
        self.decode_preview_cache_mb = number_at(config, &["decode_preview_cache_mb"])
            .unwrap_or(self.decode_preview_cache_mb as f64)
            .round()
            .clamp(1.0, 65_536.0) as u32;
    }

    pub(crate) fn apply_decode_target_policy(&mut self, params: &Value) {
        let config = params.get("config").unwrap_or(params);
        self.decode_use_output_resolution = bool_at(config, &["decode_use_output_resolution"])
            .unwrap_or(self.decode_use_output_resolution);
    }

    pub(crate) fn apply_decode_upload_policy(&mut self, params: &Value) {
        let config = params.get("config").unwrap_or(params);
        self.decode_upload_queue_cap_mb = number_at(config, &["decode_upload_queue_cap_mb"])
            .unwrap_or(self.decode_upload_queue_cap_mb as f64)
            .round()
            .clamp(1.0, 65_536.0) as u32;
    }

    /// Memory the playing videos' decoded frames may hold. 0 MB from the
    /// editor means automatic: a quarter of the GPU's memory, between 512 MB
    /// and 8 GB, so a machine with a large GPU can play many more videos at
    /// once than the old fixed 512 MB allowed. Any other value is the
    /// user's own choice and is used as given.
    pub(crate) fn video_memory_budget_bytes(&self) -> u64 {
        const MIB: u64 = 1024 * 1024;
        if self.decode_handoff_byte_cap_mb > 0 {
            return u64::from(self.decode_handoff_byte_cap_mb) * MIB;
        }
        self.gpu_memory_bytes
            .map(|bytes| (bytes / 4).clamp(512 * MIB, 8192 * MIB))
            .unwrap_or(1024 * MIB)
    }

    pub(crate) fn apply_video_memory_budget(&mut self) {
        self.video_memory_budget.set_limit(self.video_memory_budget_bytes());
    }

    pub(crate) fn apply_decode_handoff_policy(&mut self, params: &Value) {
        let config = params.get("config").unwrap_or(params);
        self.decode_handoff_byte_cap_mb = number_at(config, &["decode_handoff_byte_cap_mb"])
            .unwrap_or(self.decode_handoff_byte_cap_mb as f64)
            .round()
            .clamp(0.0, 65_536.0) as u32;
        self.apply_video_memory_budget();
        self.decode_handoff_predecode_shed_pct =
            number_at(config, &["decode_handoff_predecode_shed_pct"])
                .unwrap_or(self.decode_handoff_predecode_shed_pct as f64)
                .round()
                .clamp(1.0, 100.0) as u32;
    }

    pub(crate) fn apply_decode_estimate_cache_policy(&mut self, params: &Value) {
        let config = params.get("config").unwrap_or(params);
        self.decode_predecode_estimate_cache_cap_entries =
            number_at(config, &["decode_predecode_estimate_cache_cap_entries"])
                .unwrap_or(self.decode_predecode_estimate_cache_cap_entries as f64)
                .round()
                .clamp(1.0, 1_000_000.0) as u32;
    }

    pub(crate) fn apply_metadata_cache_caps(&mut self, params: &Value) {
        self.shader_metadata_cache_cap = number_at(params, &["config", "shader_metadata_cache_cap"])
            .or_else(|| number_at(params, &["config", "shader_cap"]))
            .or_else(|| number_at(params, &["shader_metadata_cache_cap"]))
            .or_else(|| number_at(params, &["shader_cap"]))
            .unwrap_or(self.shader_metadata_cache_cap as f64)
            .round()
            .clamp(1.0, 262_144.0) as u32;
        self.pipeline_metadata_cache_cap =
            number_at(params, &["config", "pipeline_metadata_cache_cap"])
                .or_else(|| number_at(params, &["config", "pipeline_cap"]))
                .or_else(|| number_at(params, &["pipeline_metadata_cache_cap"]))
                .or_else(|| number_at(params, &["pipeline_cap"]))
                .unwrap_or(self.pipeline_metadata_cache_cap as f64)
                .round()
                .clamp(1.0, 262_144.0) as u32;
        if let Some(renderer) = self.renderer.as_mut() {
            renderer.pipeline_cap = self.pipeline_metadata_cache_cap.max(1) as usize;
        }
    }
}
