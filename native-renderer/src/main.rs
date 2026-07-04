#![recursion_limit = "256"]

mod shared_texture;

use std::{
    borrow::Cow,
    collections::HashMap,
    fs,
    io::{self, BufRead, Write},
    sync::mpsc::{self, Receiver, Sender},
    thread,
    time::{Duration, Instant},
};

use base64::Engine;
use bytemuck::{Pod, Zeroable};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use shared_texture::SharedTextureSourceFrameDescriptor;
use wgpu::util::{DeviceExt, TextureBlitter, TextureBlitterBuilder};
use winit::{
    application::ApplicationHandler,
    dpi::{LogicalPosition, LogicalSize, PhysicalSize},
    event::WindowEvent,
    event_loop::{ActiveEventLoop, ControlFlow, EventLoop},
    window::{Fullscreen, Window, WindowAttributes, WindowId},
};

const MAX_SCENE_LAYERS: usize = 64;
const MAX_SOURCE_PREVIEWS: usize = 16;
const SOURCE_PREVIEW_SIZE: usize = 256;
const SOURCE_PREVIEW_PIXELS: usize = SOURCE_PREVIEW_SIZE * SOURCE_PREVIEW_SIZE;
const MAX_SOURCE_FRAME_SLOTS: usize = 8;
const SOURCE_FRAME_SIZE_PERFORMANCE: usize = 1024;
const SOURCE_FRAME_SIZE_BALANCED: usize = 1536;
const SOURCE_FRAME_SIZE_DEFAULT: usize = 2048;
const SOURCE_FRAME_SIZE_INSANE: usize = 3072;
const SOURCE_FRAME_MIP_LEVELS_MAX: u32 = 5;
const SOURCE_FRAME_FORMAT_FALLBACK: wgpu::TextureFormat = wgpu::TextureFormat::Rgba8Unorm;
const SOURCE_FRAME_FORMAT_HDR: wgpu::TextureFormat = wgpu::TextureFormat::Rgba16Float;
const DEFAULT_COMMAND_QUEUE_CAPACITY: u32 = 8192;
const DEFAULT_COMMAND_DRAIN_LIMIT: u32 = 1024;
const GHOST_AUDIO_LAYOUT_SCHEMA_VERSION: u32 = 1;
const GHOST_AUDIO0_FIELDS: [&str; 4] = ["level", "bass", "mid", "treble"];
const GHOST_AUDIO1_FIELDS: [&str; 4] = ["high", "beat", "beat_phase", "bpm"];
const GHOST_AUDIO2_FIELDS: [&str; 4] = ["centroid", "kick", "snare", "active"];

fn ghost_audio_uniform_layout() -> Value {
    json!({
        "schema_version": GHOST_AUDIO_LAYOUT_SCHEMA_VERSION,
        "audio0": GHOST_AUDIO0_FIELDS,
        "audio1": GHOST_AUDIO1_FIELDS,
        "audio2": GHOST_AUDIO2_FIELDS,
    })
}
const SOURCE_FRAME_SLOT_OFFSET: f32 = 100.0;
const NATIVE_SHADER_SOURCE_KIND: f32 = 17.0;
const GPU_TIMESTAMP_READ_BYTES: u64 = 16;
const CORE_RPC_METHODS: &[&str] = &[
    "start",
    "stop",
    "status",
    "get_status",
    "stats",
    "get_stats",
    "snapshot",
    "get_snapshot",
    "frame_snapshot",
    "get_frame_snapshot",
    "readiness",
    "get_readiness_report",
    "reset_stats",
    "submit_batch",
    "submit_commands",
    "set_output",
    "set_output_window",
    "set_present_policy",
    "set_command_drain_policy",
    "set_auto_present_policy",
    "attach_output_window",
    "detach_output_window",
    "set_target_fps",
    "set_native_quality_policy",
    "set_render_clock",
    "set_shader_precompile_policy",
    "set_texture_pool_cap",
    "set_metadata_cache_caps",
    "present",
    "capabilities",
    "get_capabilities",
    "compute_probe",
    "run_compute_probe",
    "compute_graph",
    "run_compute_graph",
    "shutdown",
];
const CORE_COMMAND_TYPES: &[&str] = &[
    "set_output",
    "set_present_policy",
    "set_command_drain_policy",
    "set_command_drain_limit",
    "set_auto_present_policy",
    "upsert_layer",
    "set_layer_visibility",
    "set_layer_color",
    "set_layer_native_params",
    "set_effect_chain",
    "set_texture_pool_cap",
    "set_shader_precompile_policy",
    "set_metadata_cache_caps",
    "present",
    "set_native_quality_policy",
    "set_audio_state",
    "set_render_clock",
    "bind_media_source",
    "upload_source_preview",
    "upload_source_frame",
    "precompile_shader",
    "bind_isf_shader",
    "update_isf_uniforms",
    "render_isf_to_layer",
    "remove_layer",
];
const NATIVE_SHADER_FULLSCREEN_VERTEX_WGSL: &str = r#"
struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

@vertex
fn vs_main(@builtin(vertex_index) vertex_index: u32) -> VertexOut {
  let pos = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -3.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>( 3.0,  1.0),
  );
  let p = pos[vertex_index];
  var out: VertexOut;
  out.position = vec4<f32>(p, 0.0, 1.0);
  out.uv = p * 0.5 + vec2<f32>(0.5);
  return out;
}
"#;

#[derive(Debug)]
enum UserEvent {
    Rpc(RpcRequest),
}

#[derive(Debug, Deserialize)]
struct RpcRequest {
    id: u64,
    method: String,
    #[serde(default)]
    params: Value,
}

#[derive(Clone, Debug, Serialize)]
struct CoreStatus {
    running: bool,
    backend: String,
    backend_ready: bool,
    adapter_name: Option<String>,
    native_caps: NativeGpuCaps,
    native_quality: NativeQualityState,
    width: u32,
    height: u32,
    target_fps: u32,
    present_mode: String,
    surface_present_mode: String,
    allow_tearing: bool,
    max_frame_latency: u32,
    use_waitable_object: bool,
    command_queue_capacity: u32,
    command_drain_limit: u32,
    auto_present_on_state_change: bool,
    command_drain_limit_hits: u64,
    queued_commands_after_drain: u64,
    source_preview_size: u32,
    source_previews_active: u32,
    source_preview_slots: u32,
    source_preview_dirty: bool,
    source_frame_size: u32,
    source_frame_format: String,
    source_frame_hdr: bool,
    source_frame_mip_levels: u32,
    source_frames_active: u32,
    source_frame_slots: u32,
    isf_shader_bindings: u32,
    isf_uniform_sets: u32,
    native_shader_layers: u32,
    native_procedural_layers: u32,
    native_instrument_layers: u32,
    native_instrument_proxy_layers: u32,
    native_graph_source_frame_layers: u32,
    shader_precompile_queue_cap: u32,
    shader_precompile_per_frame: u32,
    shader_metadata_cache_cap: u32,
    pipeline_metadata_cache_cap: u32,
    texture_pool_cap_mb: u32,
    shader_cache_entries: u32,
    pipeline_cache_entries: u32,
    precompiled_vertex_shaders: u32,
    precompiled_pixel_shaders: u32,
    shader_precompile_queued: u64,
    shader_precompile_compiled: u64,
    shader_precompile_failed: u64,
    shader_precompile_dropped: u64,
    source_frame_uploads: u64,
    source_frame_bytes_uploaded: u64,
    source_frame_cpu_fallback_uploads: u64,
    source_frame_file_uploads: u64,
    source_frame_base64_uploads: u64,
    source_frame_json_uploads: u64,
    source_frame_shared_texture_uploads: u64,
    source_frame_shared_texture_rejected_uploads: u64,
    source_frame_rejected_uploads: u64,
    source_frame_input_bytes_uploaded: u64,
    source_frame_resampled_bytes_uploaded: u64,
    source_frame_last_input_bytes: u64,
    source_frame_last_upload_bytes: u64,
    source_frame_last_upload_width: u32,
    source_frame_last_upload_height: u32,
    source_frame_last_upload_transport: String,
    source_frame_last_reject_reason: String,
    native_instrument_frame_renders: u64,
    compute_graph_runs: u64,
    compute_graph_passes: u64,
    compute_graph_render_passes: u64,
    compute_graph_snapshot_renders: u64,
    compute_graph_source_frame_renders: u64,
    compute_graph_readbacks: u64,
    compute_graph_readback_bytes: u64,
    compute_graph_persistent_buffers: u32,
    render_clock_mode: String,
    render_clock_time: f32,
    render_clock_frame_index: u64,
    render_clock_updates: u64,
    frame_snapshot_reads: u64,
    frame_snapshot_bytes_read: u64,
    frame_health_checks: u64,
    dark_frame_warnings: u64,
    last_frame_checksum: Option<String>,
    last_frame_nonzero_pixels: u64,
    last_frame_bright_pixels: u64,
    last_frame_average_luma: f64,
    last_frame_max_luma: f64,
    last_frame_dark: bool,
    last_shader_error: Option<String>,
    frames_presented: u64,
    commands_applied: u64,
    commands_dropped: u64,
    layers_seen: u32,
    output_width: u32,
    output_height: u32,
    output_refresh_hz: u32,
    output_window_attached: bool,
    output_swapchain_ready: bool,
    output_tearing_active: bool,
    output_waitable_object_active: bool,
    output_present_healthy: bool,
    output_present_consecutive_failures: u32,
    swapchain_present_attempts: u64,
    swapchain_presented: u64,
    swapchain_present_failures: u64,
    swapchain_last_present_result: String,
    swapchain_last_present_error: String,
    swapchain_present_timeouts: u64,
    swapchain_present_occluded: u64,
    swapchain_present_outdated: u64,
    swapchain_present_lost: u64,
    swapchain_present_validation_errors: u64,
    swapchain_present_max_consecutive_failures: u32,
    swapchain_present_tearing_attempts: u64,
    swapchain_waitable_waits: u64,
    swapchain_waitable_timeouts: u64,
    frames_without_swapchain_present: u64,
    supports_tearing: bool,
    supports_waitable_object: bool,
    gpu_timing_supported: bool,
    avg_render_cpu_ms: f64,
    last_render_gpu_ms: f64,
    avg_render_gpu_ms: f64,
    max_render_gpu_ms: f64,
    gpu_timing_samples: u64,
    gpu_timing_resolve_misses: u64,
    last_frame_error: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize)]
struct NativeGpuCaps {
    adapter_name: String,
    adapter_vendor: u32,
    adapter_device: u32,
    adapter_device_type: String,
    adapter_driver: String,
    adapter_driver_info: String,
    max_texture_dimension_2d: u32,
    max_texture_dimension_3d: u32,
    max_texture_array_layers: u32,
    max_bind_groups: u32,
    max_bindings_per_bind_group: u32,
    max_sampled_textures_per_shader_stage: u32,
    max_storage_buffers_per_shader_stage: u32,
    max_storage_textures_per_shader_stage: u32,
    max_uniform_buffer_binding_size: u64,
    max_storage_buffer_binding_size: u64,
    max_buffer_size: u64,
    max_compute_workgroup_storage_size: u32,
    max_compute_invocations_per_workgroup: u32,
    max_compute_workgroup_size_x: u32,
    max_compute_workgroup_size_y: u32,
    max_compute_workgroup_size_z: u32,
    max_compute_workgroups_per_dimension: u32,
    supports_shader_f16: bool,
    supports_float32_filterable: bool,
    supports_timestamp_query: bool,
    supports_timestamp_query_inside_encoders: bool,
    supports_timestamp_query_inside_passes: bool,
    supports_texture_binding_array: bool,
    supports_buffer_binding_array: bool,
    supports_storage_resource_binding_array: bool,
    supports_texture_adapter_specific_format_features: bool,
    requested_shader_f16: bool,
    requested_float32_filterable: bool,
    requested_timestamp_query: bool,
    requested_timestamp_query_inside_encoders: bool,
    requested_timestamp_query_inside_passes: bool,
    recommended_quality_tier: String,
}

#[derive(Clone, Debug, Serialize)]
struct NativeQualityState {
    policy: String,
    caps_tier: String,
    active_tier: String,
    quality_scale: f32,
    target_frame_ms: f64,
    cpu_ema_ms: f64,
    gpu_ema_ms: f64,
    overload_frames: u32,
    recovery_frames: u32,
    step_downs: u64,
    step_ups: u64,
}

impl Default for NativeQualityState {
    fn default() -> Self {
        Self {
            policy: "auto".to_string(),
            caps_tier: "balanced".to_string(),
            active_tier: "balanced".to_string(),
            quality_scale: tier_quality_scale("balanced"),
            target_frame_ms: 16.67,
            cpu_ema_ms: 0.0,
            gpu_ema_ms: 0.0,
            overload_frames: 0,
            recovery_frames: 0,
            step_downs: 0,
            step_ups: 0,
        }
    }
}

impl NativeQualityState {
    fn rebase_to_caps(&mut self, caps_tier: &str) {
        let tier = normalize_native_tier(caps_tier);
        self.caps_tier = tier.to_string();
        if self.policy == "auto" {
            self.active_tier = tier.to_string();
            self.quality_scale = tier_quality_scale(tier);
            self.overload_frames = 0;
            self.recovery_frames = 0;
        }
    }

    fn set_policy(&mut self, policy: &str) {
        let normalized = policy.trim().to_ascii_lowercase();
        if normalized == "auto" || normalized.is_empty() {
            self.policy = "auto".to_string();
            let tier = normalize_native_tier(&self.caps_tier);
            self.active_tier = tier.to_string();
            self.quality_scale = tier_quality_scale(tier);
        } else {
            let tier = normalize_native_tier(&normalized);
            self.policy = tier.to_string();
            self.active_tier = tier.to_string();
            self.quality_scale = tier_quality_scale(tier);
        }
        self.overload_frames = 0;
        self.recovery_frames = 0;
    }

    fn observe_frame(
        &mut self,
        render_ms: f64,
        render_gpu_ms: Option<f64>,
        target_fps: u32,
        native_task_count: usize,
    ) {
        let target_ms = 1000.0 / target_fps.max(1) as f64;
        self.target_frame_ms = target_ms;
        self.cpu_ema_ms = if self.cpu_ema_ms <= 0.0 {
            render_ms
        } else {
            self.cpu_ema_ms * 0.94 + render_ms * 0.06
        };
        if let Some(render_gpu_ms) = render_gpu_ms.filter(|value| value.is_finite() && *value > 0.0)
        {
            self.gpu_ema_ms = if self.gpu_ema_ms <= 0.0 {
                render_gpu_ms
            } else {
                self.gpu_ema_ms * 0.94 + render_gpu_ms * 0.06
            };
        }

        if self.policy != "auto" || native_task_count == 0 {
            self.overload_frames = 0;
            self.recovery_frames = 0;
            return;
        }

        let overload_ms = target_ms * 0.88;
        let recovery_ms = target_ms * 0.42;
        let budget_ms = if self.gpu_ema_ms > 0.0 {
            self.gpu_ema_ms
        } else {
            self.cpu_ema_ms
        };
        if budget_ms > overload_ms {
            self.overload_frames = self.overload_frames.saturating_add(1);
            self.recovery_frames = 0;
        } else if budget_ms < recovery_ms {
            self.recovery_frames = self.recovery_frames.saturating_add(1);
            self.overload_frames = 0;
        } else {
            self.overload_frames = 0;
            self.recovery_frames = 0;
        }

        if self.overload_frames >= 90 {
            if self.step_active_tier(-1) {
                self.step_downs = self.step_downs.saturating_add(1);
            }
            self.overload_frames = 0;
        } else if self.recovery_frames >= 240 {
            if self.step_active_tier(1) {
                self.step_ups = self.step_ups.saturating_add(1);
            }
            self.recovery_frames = 0;
        }
    }

    fn step_active_tier(&mut self, direction: i32) -> bool {
        let current = native_tier_index(&self.active_tier);
        let max_tier = native_tier_index(&self.caps_tier);
        let next = (current + direction).clamp(0, max_tier);
        if next == current {
            return false;
        }
        let tier = native_tier_for_index(next);
        self.active_tier = tier.to_string();
        self.quality_scale = tier_quality_scale(tier);
        true
    }

    fn instrument_scale(&self) -> f32 {
        self.quality_scale.clamp(0.45, 1.0)
    }
}

#[derive(Clone, Debug, Serialize, Default)]
struct CoreStats {
    frames_submitted: u64,
    frames_presented: u64,
    frames_presented_explicit: u64,
    frames_presented_auto: u64,
    commands_applied: u64,
    commands_dropped: u64,
    batch_commands_coalesced: u64,
    command_queue_peak: u64,
    command_drain_limit_hits: u64,
    queued_commands_after_drain: u64,
    draw_calls: u64,
    shader_precompile_queued: u64,
    shader_precompile_compiled: u64,
    shader_precompile_failed: u64,
    shader_precompile_dropped: u64,
    source_frame_uploads: u64,
    source_frame_bytes_uploaded: u64,
    source_frame_cpu_fallback_uploads: u64,
    source_frame_file_uploads: u64,
    source_frame_base64_uploads: u64,
    source_frame_json_uploads: u64,
    source_frame_shared_texture_uploads: u64,
    source_frame_shared_texture_rejected_uploads: u64,
    source_frame_rejected_uploads: u64,
    source_frame_input_bytes_uploaded: u64,
    source_frame_resampled_bytes_uploaded: u64,
    source_frame_last_input_bytes: u64,
    source_frame_last_upload_bytes: u64,
    source_frame_last_upload_width: u32,
    source_frame_last_upload_height: u32,
    source_frame_last_upload_transport: String,
    source_frame_last_reject_reason: String,
    native_shader_renders: u64,
    native_instrument_frame_renders: u64,
    compute_graph_runs: u64,
    compute_graph_passes: u64,
    compute_graph_render_passes: u64,
    compute_graph_snapshot_renders: u64,
    compute_graph_source_frame_renders: u64,
    compute_graph_readbacks: u64,
    compute_graph_readback_bytes: u64,
    compute_graph_persistent_buffers: u64,
    render_clock_updates: u64,
    frame_snapshot_reads: u64,
    frame_snapshot_bytes_read: u64,
    frame_health_checks: u64,
    dark_frame_warnings: u64,
    shader_cache_entries: u64,
    pipeline_cache_entries: u64,
    precompiled_vertex_shaders: u64,
    precompiled_pixel_shaders: u64,
    last_render_cpu_ms: f64,
    avg_render_cpu_ms: f64,
    last_render_gpu_ms: f64,
    avg_render_gpu_ms: f64,
    max_render_gpu_ms: f64,
    gpu_timing_supported: bool,
    gpu_timing_samples: u64,
    gpu_timing_disjoint: u64,
    gpu_timing_resolve_misses: u64,
    swapchain_present_attempts: u64,
    swapchain_presented: u64,
    swapchain_present_failures: u64,
    swapchain_last_present_result: String,
    swapchain_last_present_error: String,
    swapchain_present_timeouts: u64,
    swapchain_present_occluded: u64,
    swapchain_present_outdated: u64,
    swapchain_present_lost: u64,
    swapchain_present_validation_errors: u64,
    swapchain_present_consecutive_failures: u32,
    swapchain_present_max_consecutive_failures: u32,
    swapchain_present_tearing_attempts: u64,
    swapchain_waitable_waits: u64,
    swapchain_waitable_timeouts: u64,
    frames_without_swapchain_present: u64,
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct Uniforms {
    resolution: [f32; 2],
    time: f32,
    command_phase: f32,
    layer_count: f32,
    frame_count: f32,
    _pad0: [f32; 2],
    audio0: [f32; 4],
    audio1: [f32; 4],
    audio2: [f32; 4],
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct LayerGpu {
    p0: [f32; 4],
    p1: [f32; 4],
    color: [f32; 4],
    meta: [f32; 4],
    params0: [f32; 4],
    params1: [f32; 4],
    style: [f32; 4],
    uv0: [f32; 4],
    uv1: [f32; 4],
    shape: [f32; 4],
    effect0: [f32; 4],
    effect1: [f32; 4],
    effect2: [f32; 4],
    effect3: [f32; 4],
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Pod, Zeroable)]
struct PreviewPixel {
    rgba: [f32; 4],
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Pod, Zeroable)]
struct NativeInstrumentUniforms {
    resolution: [f32; 2],
    time: f32,
    source_kind: f32,
    params0: [f32; 4],
    params1: [f32; 4],
    audio0: [f32; 4],
    audio1: [f32; 4],
    audio2: [f32; 4],
    seed: f32,
    _pad0: [f32; 7],
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Pod, Zeroable)]
struct NativeShaderUniforms {
    resolution_time: [f32; 4],
    frame_seed_inputs: [f32; 4],
    date: [f32; 4],
    audio0: [f32; 4],
    audio1: [f32; 4],
    params0: [f32; 4],
    params1: [f32; 4],
    // Append-only extension so older hosted shaders keep the params0/params1 offsets.
    audio2: [f32; 4],
}

#[derive(Clone, Copy, Debug, Default)]
struct GhostAudioUniforms {
    audio0: [f32; 4],
    audio1: [f32; 4],
    audio2: [f32; 4],
}

impl GhostAudioUniforms {
    fn from_command(command: &Value) -> Self {
        let active = bool_at(command, &["active"]).unwrap_or(false);
        Self {
            audio0: [
                audio_value_at(command, GHOST_AUDIO0_FIELDS[0]),
                audio_value_at(command, GHOST_AUDIO0_FIELDS[1]),
                audio_value_at(command, GHOST_AUDIO0_FIELDS[2]),
                audio_value_at(command, GHOST_AUDIO0_FIELDS[3]),
            ],
            audio1: [
                audio_value_at(command, GHOST_AUDIO1_FIELDS[0]),
                audio_value_at(command, GHOST_AUDIO1_FIELDS[1]),
                number_at(command, &[GHOST_AUDIO1_FIELDS[2]])
                    .unwrap_or(0.0)
                    .clamp(0.0, 1.0) as f32,
                number_at(command, &[GHOST_AUDIO1_FIELDS[3]])
                    .unwrap_or(0.0)
                    .clamp(0.0, 300.0) as f32,
            ],
            audio2: [
                audio_value_at(command, GHOST_AUDIO2_FIELDS[0]),
                audio_value_at(command, GHOST_AUDIO2_FIELDS[1]),
                audio_value_at(command, GHOST_AUDIO2_FIELDS[2]),
                if active { 1.0 } else { 0.0 },
            ],
        }
    }

    fn from_isf_command(command: &Value) -> Self {
        let audio0 = [
            audio_value_at_any(command, GHOST_AUDIO0_FIELDS[0], "audio_level"),
            audio_value_at_any(command, GHOST_AUDIO0_FIELDS[1], "audio_bass"),
            audio_value_at_any(command, GHOST_AUDIO0_FIELDS[2], "audio_mid"),
            if command_has_key(command, GHOST_AUDIO0_FIELDS[3])
                || command_has_key(command, "audio_treble")
            {
                audio_value_at_any(command, GHOST_AUDIO0_FIELDS[3], "audio_treble")
            } else if command_has_key(command, GHOST_AUDIO1_FIELDS[0]) {
                audio_value_at(command, GHOST_AUDIO1_FIELDS[0])
            } else {
                audio_value_at(command, "audio_high")
            },
        ];
        let audio1 = [
            audio_value_at_any(command, GHOST_AUDIO1_FIELDS[0], "audio_high"),
            audio_value_at_any(command, GHOST_AUDIO1_FIELDS[1], "audio_beat"),
            number_at_any(command, GHOST_AUDIO1_FIELDS[2], "audio_beat_phase")
                .unwrap_or(0.0)
                .clamp(0.0, 1.0) as f32,
            number_at_any(command, GHOST_AUDIO1_FIELDS[3], "audio_bpm")
                .unwrap_or(0.0)
                .clamp(0.0, 300.0) as f32,
        ];
        let active = bool_at(command, &["active"]).unwrap_or_else(|| {
            audio0.iter().chain(audio1.iter()).any(|value| *value > 0.0)
                || audio_value_at_any(command, GHOST_AUDIO2_FIELDS[0], "audio_spectral_centroid")
                    > 0.0
                || audio_value_at_any(command, GHOST_AUDIO2_FIELDS[1], "audio_kick") > 0.0
                || audio_value_at_any(command, GHOST_AUDIO2_FIELDS[2], "audio_snare") > 0.0
        });
        Self {
            audio0,
            audio1,
            audio2: [
                audio_value_at_any(command, GHOST_AUDIO2_FIELDS[0], "audio_spectral_centroid"),
                audio_value_at_any(command, GHOST_AUDIO2_FIELDS[1], "audio_kick"),
                audio_value_at_any(command, GHOST_AUDIO2_FIELDS[2], "audio_snare"),
                if active { 1.0 } else { 0.0 },
            ],
        }
    }
}

#[derive(Clone, Debug)]
struct SourcePreview {
    slot: usize,
    seq: u64,
    pixels: Vec<PreviewPixel>,
}

#[derive(Clone, Debug)]
struct SourceFrame {
    seq: u64,
}

#[derive(Clone, Debug)]
struct NativeInstrumentTask {
    slot: usize,
    source_kind: f32,
    params0: [f32; 4],
    params1: [f32; 4],
    seed: f32,
}

struct NativeShaderPipeline {
    pipeline: wgpu::RenderPipeline,
}

struct NativeComputePipeline {
    pipeline: wgpu::ComputePipeline,
    bind_group_layout: wgpu::BindGroupLayout,
}

struct NativeGraphRenderPipeline {
    pipeline: wgpu::RenderPipeline,
    bind_group_layout: wgpu::BindGroupLayout,
}

#[derive(Clone, Copy, Debug)]
enum NativeComputeBufferBindingKind {
    Uniform,
    StorageRead,
    StorageReadWrite,
}

impl NativeComputeBufferBindingKind {
    fn signature(self) -> &'static str {
        match self {
            Self::Uniform => "uniform",
            Self::StorageRead => "storage-read",
            Self::StorageReadWrite => "storage-rw",
        }
    }

    fn buffer_usage(self) -> wgpu::BufferUsages {
        match self {
            Self::Uniform => {
                wgpu::BufferUsages::UNIFORM
                    | wgpu::BufferUsages::COPY_SRC
                    | wgpu::BufferUsages::COPY_DST
            }
            Self::StorageRead | Self::StorageReadWrite => {
                wgpu::BufferUsages::STORAGE
                    | wgpu::BufferUsages::COPY_SRC
                    | wgpu::BufferUsages::COPY_DST
            }
        }
    }

    fn binding_type(self) -> wgpu::BindingType {
        match self {
            Self::Uniform => wgpu::BindingType::Buffer {
                ty: wgpu::BufferBindingType::Uniform,
                has_dynamic_offset: false,
                min_binding_size: None,
            },
            Self::StorageRead => wgpu::BindingType::Buffer {
                ty: wgpu::BufferBindingType::Storage { read_only: true },
                has_dynamic_offset: false,
                min_binding_size: None,
            },
            Self::StorageReadWrite => wgpu::BindingType::Buffer {
                ty: wgpu::BufferBindingType::Storage { read_only: false },
                has_dynamic_offset: false,
                min_binding_size: None,
            },
        }
    }
}

#[derive(Clone, Copy, Debug)]
struct NativeComputeBindingLayoutSpec {
    binding: u32,
    kind: NativeComputeGraphBindingKind,
}

#[derive(Clone, Copy, Debug)]
enum NativeComputeGraphTextureDimension {
    D2,
    D2Array,
}

impl NativeComputeGraphTextureDimension {
    fn signature(self) -> &'static str {
        match self {
            Self::D2 => "texture-2d",
            Self::D2Array => "texture-2d-array",
        }
    }

    fn view_dimension(self) -> wgpu::TextureViewDimension {
        match self {
            Self::D2 => wgpu::TextureViewDimension::D2,
            Self::D2Array => wgpu::TextureViewDimension::D2Array,
        }
    }
}

#[derive(Clone, Copy, Debug)]
enum NativeComputeGraphBindingKind {
    Buffer(NativeComputeBufferBindingKind),
    SourceFrameTexture(NativeComputeGraphTextureDimension),
    SourceFrameSampler,
}

impl NativeComputeGraphBindingKind {
    fn signature(self) -> &'static str {
        match self {
            Self::Buffer(kind) => kind.signature(),
            Self::SourceFrameTexture(dimension) => dimension.signature(),
            Self::SourceFrameSampler => "source-frame-sampler",
        }
    }

    fn binding_type(self) -> wgpu::BindingType {
        match self {
            Self::Buffer(kind) => kind.binding_type(),
            Self::SourceFrameTexture(dimension) => wgpu::BindingType::Texture {
                sample_type: wgpu::TextureSampleType::Float { filterable: true },
                view_dimension: dimension.view_dimension(),
                multisampled: false,
            },
            Self::SourceFrameSampler => {
                wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering)
            }
        }
    }
}

#[derive(Clone, Debug)]
struct NativeComputeGraphBufferSpec {
    id: String,
    byte_length: u64,
    kind: NativeComputeBufferBindingKind,
    initial_bytes: Vec<u8>,
    persistent: bool,
    clear: bool,
    indirect: bool,
}

struct NativeComputeGraphGpuBuffer {
    buffer: wgpu::Buffer,
    byte_length: u64,
    kind: NativeComputeBufferBindingKind,
    indirect: bool,
}

#[derive(Clone, Debug)]
struct NativeComputeGraphBindingSpec {
    binding: u32,
    resource_id: String,
    kind: NativeComputeGraphBindingKind,
    source_slot: Option<usize>,
}

#[derive(Clone, Debug)]
struct NativeComputeGraphPassPlan {
    name: String,
    cache_key: String,
    source: String,
    entry: String,
    dispatch: [u32; 3],
    bindings: Vec<NativeComputeGraphBindingSpec>,
}

#[derive(Clone, Debug)]
enum NativeComputeGraphRenderTarget {
    Snapshot,
    SourceFrame {
        source_id: String,
        slot: usize,
        seq: u64,
    },
}

#[derive(Clone, Copy, Debug)]
enum NativeComputeGraphRenderBlend {
    Replace,
    Alpha,
    Add,
}

impl NativeComputeGraphRenderBlend {
    fn signature(self) -> &'static str {
        match self {
            Self::Replace => "replace",
            Self::Alpha => "alpha",
            Self::Add => "add",
        }
    }

    fn from_label(label: &str) -> Self {
        match label
            .trim()
            .to_ascii_lowercase()
            .replace('_', "-")
            .replace(' ', "-")
            .as_str()
        {
            "alpha" | "alpha-blend" | "premul" | "premultiplied-alpha" => Self::Alpha,
            "add" | "additive" | "plus" => Self::Add,
            _ => Self::Replace,
        }
    }

    fn blend_state(self) -> wgpu::BlendState {
        match self {
            Self::Replace => wgpu::BlendState::REPLACE,
            Self::Alpha => wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING,
            Self::Add => wgpu::BlendState {
                color: wgpu::BlendComponent {
                    src_factor: wgpu::BlendFactor::One,
                    dst_factor: wgpu::BlendFactor::One,
                    operation: wgpu::BlendOperation::Add,
                },
                alpha: wgpu::BlendComponent {
                    src_factor: wgpu::BlendFactor::One,
                    dst_factor: wgpu::BlendFactor::One,
                    operation: wgpu::BlendOperation::Add,
                },
            },
        }
    }
}

#[derive(Clone, Copy, Debug)]
enum NativeComputeGraphDepthCompare {
    Less,
    LessEqual,
    Always,
}

impl NativeComputeGraphDepthCompare {
    fn signature(self) -> &'static str {
        match self {
            Self::Less => "less",
            Self::LessEqual => "less-equal",
            Self::Always => "always",
        }
    }

    fn compare_function(self) -> wgpu::CompareFunction {
        match self {
            Self::Less => wgpu::CompareFunction::Less,
            Self::LessEqual => wgpu::CompareFunction::LessEqual,
            Self::Always => wgpu::CompareFunction::Always,
        }
    }

    fn from_label(label: &str) -> Self {
        match label
            .trim()
            .to_ascii_lowercase()
            .replace('_', "-")
            .replace(' ', "-")
            .as_str()
        {
            "less-equal" | "less-or-equal" | "lequal" => Self::LessEqual,
            "always" | "off" | "none" => Self::Always,
            _ => Self::Less,
        }
    }
}

#[derive(Clone, Copy, Debug)]
enum NativeComputeGraphPrimitiveTopology {
    TriangleList,
    LineList,
}

impl NativeComputeGraphPrimitiveTopology {
    fn signature(self) -> &'static str {
        match self {
            Self::TriangleList => "triangle-list",
            Self::LineList => "line-list",
        }
    }

    fn topology(self) -> wgpu::PrimitiveTopology {
        match self {
            Self::TriangleList => wgpu::PrimitiveTopology::TriangleList,
            Self::LineList => wgpu::PrimitiveTopology::LineList,
        }
    }

    fn from_label(label: &str) -> Self {
        match label
            .trim()
            .to_ascii_lowercase()
            .replace('_', "-")
            .replace(' ', "-")
            .as_str()
        {
            "line" | "lines" | "line-list" => Self::LineList,
            _ => Self::TriangleList,
        }
    }
}

#[derive(Clone, Debug)]
struct NativeComputeGraphRenderPlan {
    name: String,
    cache_key: String,
    source: String,
    vertex_entry: String,
    fragment_entry: String,
    clear: bool,
    include_snapshot: bool,
    target: NativeComputeGraphRenderTarget,
    blend: NativeComputeGraphRenderBlend,
    vertex_count: u32,
    instance_count: u32,
    indirect_buffer_id: Option<String>,
    indirect_offset: u64,
    clear_color: [f64; 4],
    primitive_topology: NativeComputeGraphPrimitiveTopology,
    depth_enabled: bool,
    depth_write: bool,
    depth_compare: NativeComputeGraphDepthCompare,
    bindings: Vec<NativeComputeGraphBindingSpec>,
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct ComputeProbeUniforms {
    element_count: u32,
    frame_index: u32,
    seed: u32,
    _pad0: u32,
}

struct ComputeProbeResult {
    byte_length: u64,
    checksum: u64,
    nonzero_words: u32,
    first_words: Vec<u32>,
}

#[derive(Clone, Debug, Serialize)]
struct IsfUniformState {
    shader_id: String,
    time: f32,
    time_delta: f32,
    frame_index: u64,
    render_width: f32,
    render_height: f32,
    date: [f32; 4],
    audio0: [f32; 4],
    audio1: [f32; 4],
    audio2: [f32; 4],
    float_hash: u64,
    point_hash: u64,
    color_hash: u64,
    input_count: u32,
    seq: u64,
}

impl IsfUniformState {
    fn native_params(&self, shader_id: &str) -> [f32; 8] {
        let seed = unit_from_hash(stable_hash64(shader_id));
        let float_seed = unit_from_hash(self.float_hash);
        let point_seed = unit_from_hash(self.point_hash);
        let color_seed = unit_from_hash(self.color_hash);
        let level = self.audio0[0].clamp(0.0, 1.0);
        let bass = self.audio0[1].clamp(0.0, 1.0);
        let high = self.audio1[0].clamp(0.0, 1.0);
        let beat = self.audio1[1].clamp(0.0, 1.0);
        let bpm = self.audio1[3].clamp(0.0, 300.0);
        [
            (0.82 + level * 1.2 + beat * 0.35).clamp(0.0, 4.0),
            (0.52 + seed * 2.2 + float_seed * 0.8).clamp(0.18, 4.0),
            (0.24 + bass * 0.46 + point_seed * 0.30).clamp(0.0, 1.0),
            (0.16 + bpm / 180.0 + high * 0.45).clamp(0.0, 2.0),
            seed,
            (0.18 + color_seed * 0.72).clamp(0.0, 1.0),
            (0.20 + (self.input_count as f32 / 48.0) + float_seed * 0.24).clamp(0.0, 1.0),
            1.0,
        ]
    }
}

impl NativeShaderUniforms {
    fn from_isf(
        shader_id: &str,
        state: Option<&IsfUniformState>,
        fallback_width: u32,
        fallback_height: u32,
        params: [f32; 8],
        input_source_slot: usize,
    ) -> Self {
        let seed = unit_from_hash(stable_hash64(shader_id));
        let render_width = state
            .map(|state| state.render_width)
            .unwrap_or(fallback_width as f32)
            .max(1.0);
        let render_height = state
            .map(|state| state.render_height)
            .unwrap_or(fallback_height as f32)
            .max(1.0);
        let time = state.map(|state| state.time).unwrap_or(0.0);
        let time_delta = state.map(|state| state.time_delta).unwrap_or(1.0 / 60.0);
        let frame_index = state.map(|state| state.frame_index as f32).unwrap_or(0.0);
        let input_count = state.map(|state| state.input_count as f32).unwrap_or(0.0);
        let date = state.map(|state| state.date).unwrap_or([0.0; 4]);
        let audio0 = state.map(|state| state.audio0).unwrap_or([0.0; 4]);
        let audio1 = state.map(|state| state.audio1).unwrap_or([0.0; 4]);
        let audio2 = state.map(|state| state.audio2).unwrap_or([0.0; 4]);
        Self {
            resolution_time: [render_width, render_height, time, time_delta],
            frame_seed_inputs: [
                frame_index,
                seed,
                input_count,
                input_source_slot.min(MAX_SOURCE_FRAME_SLOTS - 1) as f32,
            ],
            date,
            audio0,
            audio1,
            params0: [params[0], params[1], params[2], params[3]],
            params1: [params[4], params[5], params[6], params[7]],
            audio2,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
struct ShaderRecord {
    shader_id: String,
    stage: String,
    entry: String,
    source_hash: u64,
    source_bytes: usize,
    entry_points: Vec<String>,
    compiled_at_ms: u64,
}

#[derive(Clone, Debug)]
struct SceneLayer {
    id: String,
    z_index: i32,
    visible: bool,
    opacity: f32,
    source_kind: f32,
    source_id: Option<String>,
    shader_id: Option<String>,
    shader_rendered: bool,
    preview_slot: Option<usize>,
    frame_slot: Option<usize>,
    color: [f32; 4],
    corners: [[f32; 2]; 4],
    native_params: [f32; 8],
    blend_code: f32,
    uv0: [f32; 4],
    uv1: [f32; 4],
    shape: [f32; 4],
    effects: [[f32; 4]; 4],
    effect_count: f32,
}

impl SceneLayer {
    fn new(id: String, z_index: i32) -> Self {
        Self {
            color: stable_layer_color(&id, 1.0),
            id,
            z_index,
            visible: true,
            opacity: 1.0,
            source_kind: 0.0,
            source_id: None,
            shader_id: None,
            shader_rendered: false,
            preview_slot: None,
            frame_slot: None,
            corners: [[0.0, 1.0], [1.0, 1.0], [1.0, 0.0], [0.0, 0.0]],
            native_params: default_native_params(),
            blend_code: 0.0,
            uv0: [0.0, 0.0, 1.0, 1.0],
            uv1: [0.0, 1.0, 0.0, 0.0],
            shape: [0.0, 0.0, 0.0, 1.0],
            effects: [[0.0; 4]; 4],
            effect_count: 0.0,
        }
    }

    fn gpu(&self) -> LayerGpu {
        LayerGpu {
            p0: [
                self.corners[0][0],
                self.corners[0][1],
                self.corners[1][0],
                self.corners[1][1],
            ],
            p1: [
                self.corners[2][0],
                self.corners[2][1],
                self.corners[3][0],
                self.corners[3][1],
            ],
            color: [
                self.color[0],
                self.color[1],
                self.color[2],
                self.opacity.clamp(0.0, 1.0) * self.color[3].clamp(0.0, 1.0),
            ],
            meta: [
                if self.visible { 1.0 } else { 0.0 },
                self.z_index as f32,
                if self.shader_rendered {
                    NATIVE_SHADER_SOURCE_KIND
                } else {
                    self.source_kind
                },
                self.frame_slot
                    .map(|slot| SOURCE_FRAME_SLOT_OFFSET + slot as f32 + 1.0)
                    .or_else(|| self.preview_slot.map(|slot| slot as f32 + 1.0))
                    .unwrap_or(0.0),
            ],
            params0: [
                self.native_params[0],
                self.native_params[1],
                self.native_params[2],
                self.native_params[3],
            ],
            params1: [
                self.native_params[4],
                self.native_params[5],
                self.native_params[6],
                self.native_params[7],
            ],
            style: [self.blend_code, self.effect_count, 0.0, 0.0],
            uv0: self.uv0,
            uv1: self.uv1,
            shape: self.shape,
            effect0: self.effects[0],
            effect1: self.effects[1],
            effect2: self.effects[2],
            effect3: self.effects[3],
        }
    }
}

struct GpuTimingState {
    query_set: wgpu::QuerySet,
    resolve_buffer: wgpu::Buffer,
    readback_buffer: wgpu::Buffer,
    timestamp_period_ns: f64,
    map_done_tx: Sender<Result<(), String>>,
    map_done_rx: Receiver<Result<(), String>>,
    map_pending: bool,
    last_render_gpu_ms: f64,
    avg_render_gpu_ms: f64,
    max_render_gpu_ms: f64,
    samples: u64,
    resolve_misses: u64,
}

impl GpuTimingState {
    fn new(device: &wgpu::Device, queue: &wgpu::Queue) -> Self {
        let query_set = device.create_query_set(&wgpu::QuerySetDescriptor {
            label: Some("Ghost Render Core Frame Timestamp Queries"),
            ty: wgpu::QueryType::Timestamp,
            count: 2,
        });
        let resolve_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Ghost Render Core Frame Timestamp Resolve"),
            size: wgpu::QUERY_RESOLVE_BUFFER_ALIGNMENT.max(GPU_TIMESTAMP_READ_BYTES),
            usage: wgpu::BufferUsages::QUERY_RESOLVE | wgpu::BufferUsages::COPY_SRC,
            mapped_at_creation: false,
        });
        let readback_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Ghost Render Core Frame Timestamp Readback"),
            size: GPU_TIMESTAMP_READ_BYTES,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });
        let (map_done_tx, map_done_rx) = mpsc::channel();
        Self {
            query_set,
            resolve_buffer,
            readback_buffer,
            timestamp_period_ns: queue.get_timestamp_period() as f64,
            map_done_tx,
            map_done_rx,
            map_pending: false,
            last_render_gpu_ms: 0.0,
            avg_render_gpu_ms: 0.0,
            max_render_gpu_ms: 0.0,
            samples: 0,
            resolve_misses: 0,
        }
    }

    fn timestamp_writes(&self) -> wgpu::RenderPassTimestampWrites<'_> {
        wgpu::RenderPassTimestampWrites {
            query_set: &self.query_set,
            beginning_of_pass_write_index: Some(0),
            end_of_pass_write_index: Some(1),
        }
    }

    fn can_record(&self) -> bool {
        !self.map_pending
    }

    fn resolve_to_readback(&self, encoder: &mut wgpu::CommandEncoder) {
        encoder.resolve_query_set(&self.query_set, 0..2, &self.resolve_buffer, 0);
        encoder.copy_buffer_to_buffer(
            &self.resolve_buffer,
            0,
            &self.readback_buffer,
            0,
            GPU_TIMESTAMP_READ_BYTES,
        );
    }

    fn begin_readback(&mut self) {
        if self.map_pending {
            self.resolve_misses = self.resolve_misses.saturating_add(1);
            return;
        }
        self.map_pending = true;
        let tx = self.map_done_tx.clone();
        self.readback_buffer
            .slice(0..GPU_TIMESTAMP_READ_BYTES)
            .map_async(wgpu::MapMode::Read, move |result| {
                let _ = tx.send(result.map_err(|err| err.to_string()));
            });
    }

    fn poll_readback(&mut self) {
        if !self.map_pending {
            return;
        }
        let Ok(result) = self.map_done_rx.try_recv() else {
            return;
        };
        self.map_pending = false;
        if result.is_err() {
            self.resolve_misses = self.resolve_misses.saturating_add(1);
            return;
        }

        let slice = self.readback_buffer.slice(0..GPU_TIMESTAMP_READ_BYTES);
        let Ok(mapped) = slice.get_mapped_range() else {
            self.resolve_misses = self.resolve_misses.saturating_add(1);
            self.readback_buffer.unmap();
            return;
        };
        let mut start_bytes = [0_u8; 8];
        let mut end_bytes = [0_u8; 8];
        start_bytes.copy_from_slice(&mapped[0..8]);
        end_bytes.copy_from_slice(&mapped[8..16]);
        drop(mapped);
        self.readback_buffer.unmap();

        let start = u64::from_le_bytes(start_bytes);
        let end = u64::from_le_bytes(end_bytes);
        if end <= start {
            self.resolve_misses = self.resolve_misses.saturating_add(1);
            return;
        }
        let gpu_ms = ((end - start) as f64 * self.timestamp_period_ns) / 1_000_000.0;
        if !gpu_ms.is_finite() || gpu_ms <= 0.0 {
            self.resolve_misses = self.resolve_misses.saturating_add(1);
            return;
        }
        self.last_render_gpu_ms = gpu_ms;
        self.avg_render_gpu_ms = if self.avg_render_gpu_ms <= 0.0 {
            gpu_ms
        } else {
            self.avg_render_gpu_ms * 0.94 + gpu_ms * 0.06
        };
        self.max_render_gpu_ms = self.max_render_gpu_ms.max(gpu_ms);
        self.samples = self.samples.saturating_add(1);
    }
}

struct RenderState {
    window: &'static Window,
    adapter_name: String,
    native_caps: NativeGpuCaps,
    surface: wgpu::Surface<'static>,
    device: wgpu::Device,
    queue: wgpu::Queue,
    config: wgpu::SurfaceConfiguration,
    supported_present_modes: Vec<wgpu::PresentMode>,
    pipeline: wgpu::RenderPipeline,
    native_instrument_pipeline: wgpu::RenderPipeline,
    uniform_buffer: wgpu::Buffer,
    native_instrument_uniform_buffer: wgpu::Buffer,
    native_shader_uniform_buffer: wgpu::Buffer,
    layer_buffer: wgpu::Buffer,
    source_preview_buffer: wgpu::Buffer,
    source_frame_texture: wgpu::Texture,
    source_frame_sampler: wgpu::Sampler,
    native_shader_input_texture: wgpu::Texture,
    source_frame_size: usize,
    source_frame_format: wgpu::TextureFormat,
    source_frame_mip_levels: u32,
    source_frame_blitter: TextureBlitter,
    native_shader_vertex_module: wgpu::ShaderModule,
    native_shader_bind_group_layout: wgpu::BindGroupLayout,
    native_shader_bind_group: wgpu::BindGroup,
    native_shader_pipelines: HashMap<String, NativeShaderPipeline>,
    native_compute_pipelines: HashMap<String, NativeComputePipeline>,
    native_graph_render_pipelines: HashMap<String, NativeGraphRenderPipeline>,
    native_compute_graph_buffers: HashMap<String, NativeComputeGraphGpuBuffer>,
    snapshot_texture: wgpu::Texture,
    snapshot_view: wgpu::TextureView,
    last_frame_metrics: Option<SnapshotMetrics>,
    bind_group: wgpu::BindGroup,
    native_instrument_bind_group: wgpu::BindGroup,
    start_time: Instant,
    gpu_timing: Option<GpuTimingState>,
    last_frame_error: Option<String>,
}

struct App {
    response_tx: Sender<String>,
    renderer: Option<RenderState>,
    adapter_name: Option<String>,
    target_fps: u32,
    last_redraw: Instant,
    running: bool,
    pending_width: u32,
    pending_height: u32,
    present_mode: String,
    allow_tearing: bool,
    max_frame_latency: u32,
    use_waitable_object: bool,
    command_queue_capacity: u32,
    command_drain_limit: u32,
    auto_present_on_state_change: bool,
    auto_present_requested: bool,
    output_window_attached: bool,
    layers_seen: u32,
    command_phase: f32,
    scene_layers: HashMap<String, SceneLayer>,
    source_previews: HashMap<String, SourcePreview>,
    source_preview_slots: HashMap<String, usize>,
    source_preview_dirty: bool,
    source_frames: HashMap<String, SourceFrame>,
    source_frame_slots: HashMap<String, usize>,
    render_clock_mode: String,
    render_clock_time: Option<f32>,
    render_clock_delta: f32,
    render_clock_frame_index: Option<u64>,
    isf_layer_bindings: HashMap<String, String>,
    isf_uniforms: HashMap<String, IsfUniformState>,
    shader_registry: HashMap<String, ShaderRecord>,
    shader_sources: HashMap<String, String>,
    shader_precompile_queue_cap: u32,
    shader_precompile_per_frame: u32,
    shader_metadata_cache_cap: u32,
    pipeline_metadata_cache_cap: u32,
    texture_pool_cap_mb: u32,
    last_shader_error: Option<String>,
    audio0: [f32; 4],
    audio1: [f32; 4],
    audio2: [f32; 4],
    stats: CoreStats,
    render_cpu_ema_ms: f64,
    native_quality: NativeQualityState,
}

#[derive(Clone, Copy, Debug)]
enum SurfacePresentOutcome {
    Presented,
    SuboptimalPresented,
    Outdated,
    Timeout,
    Occluded,
}

impl SurfacePresentOutcome {
    fn as_str(self) -> &'static str {
        match self {
            Self::Presented => "presented",
            Self::SuboptimalPresented => "suboptimal-presented",
            Self::Outdated => "outdated",
            Self::Timeout => "timeout",
            Self::Occluded => "occluded",
        }
    }

    fn presented(self) -> bool {
        matches!(self, Self::Presented | Self::SuboptimalPresented)
    }
}

impl App {
    fn new(response_tx: Sender<String>) -> Self {
        Self {
            response_tx,
            renderer: None,
            adapter_name: None,
            target_fps: 60,
            last_redraw: Instant::now(),
            running: false,
            pending_width: 1280,
            pending_height: 720,
            present_mode: "vsync".to_string(),
            allow_tearing: false,
            max_frame_latency: 2,
            use_waitable_object: false,
            command_queue_capacity: DEFAULT_COMMAND_QUEUE_CAPACITY,
            command_drain_limit: DEFAULT_COMMAND_DRAIN_LIMIT,
            auto_present_on_state_change: true,
            auto_present_requested: false,
            output_window_attached: true,
            layers_seen: 0,
            command_phase: 0.0,
            scene_layers: HashMap::new(),
            source_previews: HashMap::new(),
            source_preview_slots: HashMap::new(),
            source_preview_dirty: true,
            source_frames: HashMap::new(),
            source_frame_slots: HashMap::new(),
            render_clock_mode: "live".to_string(),
            render_clock_time: None,
            render_clock_delta: 1.0 / 60.0,
            render_clock_frame_index: None,
            isf_layer_bindings: HashMap::new(),
            isf_uniforms: HashMap::new(),
            shader_registry: HashMap::new(),
            shader_sources: HashMap::new(),
            shader_precompile_queue_cap: 4096,
            shader_precompile_per_frame: 4,
            shader_metadata_cache_cap: 16384,
            pipeline_metadata_cache_cap: 16384,
            texture_pool_cap_mb: 512,
            last_shader_error: None,
            audio0: [0.0; 4],
            audio1: [0.0; 4],
            audio2: [0.0; 4],
            stats: CoreStats::default(),
            render_cpu_ema_ms: 0.0,
            native_quality: NativeQualityState::default(),
        }
    }

    fn ensure_renderer(&mut self, event_loop: &ActiveEventLoop) -> Result<(), String> {
        if self.renderer.is_some() {
            return Ok(());
        }
        let attrs = WindowAttributes::default()
            .with_title("Ghost Render Core N0")
            .with_inner_size(LogicalSize::new(
                self.pending_width as f64,
                self.pending_height as f64,
            ))
            .with_resizable(true);
        let window = event_loop
            .create_window(attrs)
            .map_err(|err| err.to_string())?;
        let window: &'static Window = Box::leak(Box::new(window));
        let renderer = pollster::block_on(RenderState::new(
            window,
            self.pending_width.max(1),
            self.pending_height.max(1),
            &self.present_mode,
            self.allow_tearing,
            self.max_frame_latency,
        ))?;
        self.native_quality
            .rebase_to_caps(&renderer.native_caps.recommended_quality_tier);
        self.adapter_name = renderer.adapter_name();
        self.renderer = Some(renderer);
        Ok(())
    }

    fn capabilities(&self) -> Value {
        let features = json!({
            "separate_process_render_core": true,
            "managed_native_window": true,
            "audio_uniform_layout": true,
            "layer_compositor": true,
            "layer_corner_warp": true,
            "layer_uv_controls": true,
            "layer_shape_masks": true,
            "blend_modes": true,
            "effect_descriptors": true,
            "render_clock": true,
            "frame_snapshot": true,
            "frame_health": true,
            "gpu_timing": self.renderer.as_ref().is_some_and(|renderer| renderer.gpu_timing.is_some()),
            "shader_precompile": true,
            "fragment_wgsl_host": true,
            "native_instrument_proxies": true,
            "source_preview_upload": true,
            "source_frame_upload": true,
            "source_frame_file_handoff": true,
            "source_frame_mips": self.renderer.as_ref().is_some_and(|renderer| renderer.source_frame_mip_levels > 1),
            "source_frame_hdr": self.renderer.as_ref().is_some_and(|renderer| renderer.source_frame_format == SOURCE_FRAME_FORMAT_HDR),
            "compute_shader_host": true,
            "compute_graph_host": true,
            "compute_graph_render": true,
            "compute_graph_multi_render": true,
            "compute_graph_instanced_render": true,
            "compute_graph_indirect_render": true,
            "compute_graph_texture_sampling": true,
            "compute_graph_depth_render": true,
            "compute_graph_line_render": true,
            "compute_graph_clear_color": true,
            "compute_graph_source_frame_target": true,
            "persistent_compute_buffers": true,
            "native_planet_graph": true,
            "native_3d_smoke_graph": true,
            "native_particle_field_graph": true,
            "native_volumetric_spheres_graph": true,
            "native_smoke_riders_graph": true,
            "native_ink_cloud_graph": true,
            "native_flythrough_graph": true,
            "native_pixel_particles_graph": true,
            "native_point_cloud_fx_graph": true,
            "command_drain_policy": true,
            "auto_present_policy": true,
            "multi_pass_instruments": false,
            "storage_buffer_instruments": true,
            "shared_texture_source_frame_upload": cfg!(target_os = "macos"),
            "shared_texture_upload": false,
            "shared_texture_output_export": false,
            "native_texture_share_sender": false,
            "native_media_decode": false,
            "media_prefetch": false,
            "present_policy": true,
            "managed_output_attach": true,
            "managed_output_window_control": true,
            "native_recording": false,
            "native_stage3d": false,
            "native_projection_sim": false
        });
        let limits = json!({
            "max_scene_layers": MAX_SCENE_LAYERS,
            "source_preview_size": SOURCE_PREVIEW_SIZE,
            "source_preview_slots": MAX_SOURCE_PREVIEWS,
            "source_frame_slots": MAX_SOURCE_FRAME_SLOTS,
            "source_frame_size": self.renderer.as_ref().map(|renderer| renderer.source_frame_size).unwrap_or(SOURCE_FRAME_SIZE_DEFAULT),
            "source_frame_mip_levels": self.renderer.as_ref().map(|renderer| renderer.source_frame_mip_levels).unwrap_or(1),
            "command_queue_capacity": self.command_queue_capacity,
            "command_drain_limit": self.command_drain_limit
        });
        json!({
            "schema_version": 1,
            "core_version": env!("CARGO_PKG_VERSION"),
            "backend": native_backend_name(),
            "implemented_methods": CORE_RPC_METHODS,
            "implemented_command_types": CORE_COMMAND_TYPES,
            "native_graph_instruments": ["planet", "smoke-3d", "particle-field", "volumetric-spheres", "smoke-riders", "ink-cloud", "flythrough", "pixel-particles", "point-cloud-fx"],
            "native_graph_instrument_manifest": [
                {
                    "id": "planet",
                    "label": "Planet",
                    "source_uri_prefix": "native-graph://planet/",
                    "shader_ids": [
                        "planet/render"
                    ],
                    "features": [
                        "compute_graph_host",
                        "compute_graph_render",
                        "compute_graph_instanced_render",
                        "compute_graph_clear_color",
                        "compute_graph_source_frame_target",
                        "native_planet_graph"
                    ],
                    "render_target": "source_frame",
                    "parity": "single-pass-shared-wgsl"
                },
                {
                    "id": "smoke-3d",
                    "label": "3D Smoke",
                    "source_uri_prefix": "native-graph://smoke-3d/",
                    "shader_ids": ["smoke-3d"],
                    "features": [
                        "compute_graph_host",
                        "compute_graph_render",
                        "compute_graph_multi_render",
                        "compute_graph_instanced_render",
                        "compute_graph_indirect_render",
                        "compute_graph_texture_sampling",
                        "compute_graph_depth_render",
                        "compute_graph_line_render",
                        "compute_graph_clear_color",
                        "compute_graph_source_frame_target",
                        "persistent_compute_buffers",
                        "native_3d_smoke_graph"
                    ],
                    "render_target": "source_frame",
                    "parity": "fluid-sim-multipass-shared-wgsl"
                },
                {
                    "id": "particle-field",
                    "label": "Particle Field",
                    "source_uri_prefix": "native-graph://particle-field/",
                    "shader_ids": [
                        "particle-field/behavior",
                        "particle-field/fog",
                        "particle-field/render"
                    ],
                    "features": [
                        "compute_graph_host",
                        "compute_graph_render",
                        "compute_graph_multi_render",
                        "compute_graph_instanced_render",
                        "compute_graph_texture_sampling",
                        "compute_graph_depth_render",
                        "compute_graph_line_render",
                        "compute_graph_clear_color",
                        "compute_graph_source_frame_target",
                        "persistent_compute_buffers",
                        "native_particle_field_graph"
                    ],
                    "render_target": "source_frame",
                    "parity": "behavior-render-edges-and-media-source-frame-routing"
                },
                {
                    "id": "volumetric-spheres",
                    "label": "Volumetric Spheres",
                    "source_uri_prefix": "native-graph://volumetric-spheres/",
                    "shader_ids": [
                        "volumetric-spheres/sim",
                        "volumetric-spheres/render"
                    ],
                    "features": [
                        "compute_graph_host",
                        "compute_graph_render",
                        "compute_graph_instanced_render",
                        "compute_graph_depth_render",
                        "compute_graph_clear_color",
                        "compute_graph_source_frame_target",
                        "persistent_compute_buffers",
                        "native_volumetric_spheres_graph"
                    ],
                    "render_target": "source_frame",
                    "parity": "sim-render-shared-wgsl"
                },
                {
                    "id": "smoke-riders",
                    "label": "Smoke Riders",
                    "source_uri_prefix": "native-graph://smoke-riders/",
                    "shader_ids": [
                        "3d-smoke/splat",
                        "3d-smoke/advect-velocity",
                        "3d-smoke/divergence",
                        "3d-smoke/jacobi",
                        "3d-smoke/subtract-gradient",
                        "3d-smoke/advect-density",
                        "3d-smoke/render",
                        "volumetric-spheres/sim",
                        "volumetric-spheres/render"
                    ],
                    "features": [
                        "compute_graph_host",
                        "compute_graph_render",
                        "compute_graph_multi_render",
                        "compute_graph_instanced_render",
                        "compute_graph_depth_render",
                        "compute_graph_clear_color",
                        "compute_graph_source_frame_target",
                        "persistent_compute_buffers",
                        "native_3d_smoke_graph",
                        "native_volumetric_spheres_graph",
                        "native_smoke_riders_graph"
                    ],
                    "render_target": "source_frame",
                    "parity": "composed-smoke-and-volumetric-spheres-shared-wgsl"
                },
                {
                    "id": "ink-cloud",
                    "label": "Ink Cloud",
                    "source_uri_prefix": "native-graph://ink-cloud/",
                    "shader_ids": [
                        "ink-cloud/sim",
                        "ink-cloud/render",
                        "ink-cloud/background"
                    ],
                    "features": [
                        "compute_graph_host",
                        "compute_graph_render",
                        "compute_graph_multi_render",
                        "compute_graph_instanced_render",
                        "compute_graph_clear_color",
                        "compute_graph_source_frame_target",
                        "persistent_compute_buffers",
                        "native_ink_cloud_graph"
                    ],
                    "render_target": "source_frame",
                    "parity": "sim-background-render-shared-wgsl"
                },
                {
                    "id": "flythrough",
                    "label": "Flythrough",
                    "source_uri_prefix": "native-graph://flythrough/",
                    "shader_ids": [
                        "flythrough/compute",
                        "flythrough/render"
                    ],
                    "features": [
                        "compute_graph_host",
                        "compute_graph_render",
                        "compute_graph_instanced_render",
                        "compute_graph_texture_sampling",
                        "compute_graph_clear_color",
                        "compute_graph_source_frame_target",
                        "persistent_compute_buffers",
                        "native_flythrough_graph"
                    ],
                    "render_target": "source_frame",
                    "parity": "compute-render-source-frame-shared-wgsl"
                },
                {
                    "id": "pixel-particles",
                    "label": "Pixel Particles",
                    "source_uri_prefix": "native-graph://pixel-particles/",
                    "shader_ids": [
                        "pixel-particles/compute",
                        "pixel-particles/render"
                    ],
                    "features": [
                        "compute_graph_host",
                        "compute_graph_render",
                        "compute_graph_instanced_render",
                        "compute_graph_texture_sampling",
                        "compute_graph_clear_color",
                        "compute_graph_source_frame_target",
                        "persistent_compute_buffers",
                        "native_pixel_particles_graph"
                    ],
                    "render_target": "source_frame",
                    "parity": "compute-render-source-frame-shared-wgsl"
                },
                {
                    "id": "point-cloud-fx",
                    "label": "Point Cloud FX",
                    "source_uri_prefix": "native-graph://point-cloud-fx/",
                    "shader_ids": [
                        "point-cloud-fx/compute",
                        "point-cloud-fx/render"
                    ],
                    "features": [
                        "compute_graph_host",
                        "compute_graph_render",
                        "compute_graph_instanced_render",
                        "compute_graph_clear_color",
                        "compute_graph_source_frame_target",
                        "persistent_compute_buffers",
                        "native_point_cloud_fx_graph"
                    ],
                    "render_target": "source_frame",
                    "parity": "compute-render-point-buffer-shared-wgsl"
                }
            ],
            "audio_uniform_layout": ghost_audio_uniform_layout(),
            "features": features,
            "limits": limits,
            "notes": [
                "Native graph instruments use shared WGSL for 3D Smoke, Particle Field, Volumetric Spheres, Ink Cloud, Flythrough, Pixel Particles, and Point Cloud FX; legacy native instrument layers are still visual proxies.",
                "Canvas/base64 source-frame upload is a development fallback; macOS source-frame shared texture upload accepts IOSurfaceID handles, while full shared media transport remains pending."
            ]
        })
    }

    fn status(&self) -> CoreStatus {
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
        let native_instrument_proxy_layers = self
            .scene_layers
            .values()
            .filter(|layer| layer.visible && is_native_instrument_kind(layer.source_kind))
            .count()
            .min(1024) as u32;
        let native_graph_source_frame_layers = self
            .scene_layers
            .values()
            .filter(|layer| {
                layer.visible
                    && !layer.shader_rendered
                    && !is_native_instrument_kind(layer.source_kind)
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
        CoreStatus {
            running: self.running,
            backend: native_backend_name().to_string(),
            backend_ready: renderer_ready && last_frame_ok,
            adapter_name: self.adapter_name.clone(),
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
            source_frame_slots: MAX_SOURCE_FRAME_SLOTS as u32,
            isf_shader_bindings: self.isf_layer_bindings.len().min(1024) as u32,
            isf_uniform_sets: self.isf_uniforms.len().min(1024) as u32,
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
            render_clock_time: self.render_clock_time.unwrap_or(0.0),
            render_clock_frame_index: self
                .render_clock_frame_index
                .unwrap_or(self.stats.frames_presented),
            render_clock_updates: self.stats.render_clock_updates,
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
            frames_presented: self.stats.frames_presented,
            commands_applied: self.stats.commands_applied,
            commands_dropped: self.stats.commands_dropped,
            layers_seen: self.layers_seen,
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
            output_refresh_hz: self.target_fps,
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

    fn send_ok(&self, id: u64, result: Value) {
        let _ = self
            .response_tx
            .send(json!({ "id": id, "ok": true, "result": result }).to_string());
    }

    fn send_error(&self, id: u64, err: impl ToString) {
        let _ = self
            .response_tx
            .send(json!({ "id": id, "ok": false, "error": err.to_string() }).to_string());
    }

    fn handle_rpc(&mut self, event_loop: &ActiveEventLoop, req: RpcRequest) {
        let result = match req.method.as_str() {
            "start" => {
                self.apply_start_config(&req.params);
                self.running = true;
                let now = Instant::now();
                self.last_redraw = now.checked_sub(self.frame_duration()).unwrap_or(now);
                self.ensure_renderer(event_loop).map(|_| {
                    if let Some(renderer) = self.renderer.as_ref() {
                        renderer.window.request_redraw();
                    }
                    json!(self.status())
                })
            }
            "stop" => {
                self.running = false;
                Ok(json!(true))
            }
            "status" | "get_status" => Ok(json!(self.status())),
            "stats" | "get_stats" => {
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
                Ok(json!(self.stats.clone()))
            }
            "snapshot" | "get_snapshot" => Ok(json!({
                "timestamp_ms": epoch_ms(),
                "status": self.status(),
                "stats": self.stats,
                "shader_registry": self.shader_registry_snapshot(),
            })),
            "frame_snapshot" | "get_frame_snapshot" => self.frame_snapshot(&req.params),
            "capabilities" | "get_capabilities" => Ok(self.capabilities()),
            "compute_probe" | "run_compute_probe" => self.compute_probe(&req.params),
            "compute_graph" | "run_compute_graph" => {
                let result = self.compute_graph(&req.params);
                if result.is_ok() {
                    self.request_auto_present();
                }
                result
            }
            "readiness" | "get_readiness_report" => Ok(json!({
                "timestamp_ms": epoch_ms(),
                "overall_ready": self.renderer.is_some(),
                "blockers": if self.renderer.is_some() { Vec::<String>::new() } else { vec!["native renderer has not created a wgpu device".to_string()] },
                "capabilities": self.capabilities(),
                "checks": [
                    {
                        "id": "wgpu-device",
                        "label": "Native wgpu device",
                        "ok": self.renderer.is_some(),
                        "detail": self.adapter_name.clone().unwrap_or_else(|| "not initialized".to_string())
                    },
                    {
                        "id": "shared-texture-source-frame-upload",
                        "label": "Shared texture source-frame transport",
                        "ok": cfg!(target_os = "macos"),
                        "detail": if cfg!(target_os = "macos") { "implemented for IOSurfaceID source-frame handles" } else { "pending backend-specific shared texture import" }
                    },
                    {
                        "id": "shared-texture-upload",
                        "label": "Shared texture media transport",
                        "ok": false,
                        "detail": "full media shared texture transport is pending; source-frame shared handle upload is tracked separately"
                    },
                    {
                        "id": "shared-texture-output-export",
                        "label": "Native output shared-texture export",
                        "ok": false,
                        "detail": "pending core-to-Electron IOSurface/DXGI output texture export"
                    },
                    {
                        "id": "native-texture-share-sender",
                        "label": if cfg!(target_os = "macos") { "Native Syphon sender" } else { "Native Spout sender" },
                        "ok": false,
                        "detail": "pending zero-copy texture-share sender from the native composite"
                    },
                    {
                        "id": "compute-instrument-host",
                        "label": "Native compute/multi-pass instrument host",
                        "ok": self.renderer.is_some(),
                        "detail": if self.renderer.is_some() { "compute_graph can run real WGSL graph instruments with persistent buffers and source-frame render targets" } else { "native renderer has not created a wgpu device" }
                    },
                    {
                        "id": "native-planet-graph",
                        "label": "Native Planet graph",
                        "ok": self.renderer.is_some(),
                        "detail": if self.renderer.is_some() { "compute_graph can render Planet into native source frames" } else { "native renderer has not created a wgpu device" }
                    },
                    {
                        "id": "native-3d-smoke-graph",
                        "label": "Native 3D Smoke graph",
                        "ok": self.renderer.is_some(),
                        "detail": if self.renderer.is_some() { "compute_graph can render 3D Smoke into native source frames" } else { "native renderer has not created a wgpu device" }
                    },
                    {
                        "id": "native-particle-field-graph",
                        "label": "Native Particle Field graph",
                        "ok": self.renderer.is_some(),
                        "detail": if self.renderer.is_some() { "compute_graph can render Particle Field behavior/render passes into native source frames" } else { "native renderer has not created a wgpu device" }
                    },
                    {
                        "id": "native-volumetric-spheres-graph",
                        "label": "Native Volumetric Spheres graph",
                        "ok": self.renderer.is_some(),
                        "detail": if self.renderer.is_some() { "compute_graph can render Volumetric Spheres sim/render passes into native source frames" } else { "native renderer has not created a wgpu device" }
                    },
                    {
                        "id": "native-smoke-riders-graph",
                        "label": "Native Smoke Riders graph",
                        "ok": self.renderer.is_some(),
                        "detail": if self.renderer.is_some() { "compute_graph can compose 3D Smoke and Volumetric Spheres into native source frames" } else { "native renderer has not created a wgpu device" }
                    },
                    {
                        "id": "native-ink-cloud-graph",
                        "label": "Native Ink Cloud graph",
                        "ok": self.renderer.is_some(),
                        "detail": if self.renderer.is_some() { "compute_graph can render Ink Cloud sim/background/render passes into native source frames" } else { "native renderer has not created a wgpu device" }
                    },
                    {
                        "id": "native-flythrough-graph",
                        "label": "Native Flythrough graph",
                        "ok": self.renderer.is_some(),
                        "detail": if self.renderer.is_some() { "compute_graph can render Flythrough source-sampled particles into native source frames" } else { "native renderer has not created a wgpu device" }
                    },
                    {
                        "id": "native-pixel-particles-graph",
                        "label": "Native Pixel Particles graph",
                        "ok": self.renderer.is_some(),
                        "detail": if self.renderer.is_some() { "compute_graph can render source-driven Pixel Particles into native source frames" } else { "native renderer has not created a wgpu device" }
                    },
                    {
                        "id": "native-point-cloud-fx-graph",
                        "label": "Native Point Cloud FX graph",
                        "ok": self.renderer.is_some(),
                        "detail": if self.renderer.is_some() { "compute_graph can render PLY/splat point-buffer effects into native source frames" } else { "native renderer has not created a wgpu device" }
                    },
                    {
                        "id": "managed-output",
                        "label": "Managed output window",
                        "ok": self.status().output_present_healthy,
                        "detail": if !self.output_window_attached {
                            "native output window is detached/hidden".to_string()
                        } else if self.stats.swapchain_presented == 0 {
                            format!("waiting for first native swapchain present; last={}", if self.stats.swapchain_last_present_result.is_empty() { "none" } else { self.stats.swapchain_last_present_result.as_str() })
                        } else if self.stats.swapchain_present_consecutive_failures > 0 {
                            format!("native output present has {} consecutive failure(s); last={}", self.stats.swapchain_present_consecutive_failures, if self.stats.swapchain_last_present_result.is_empty() { "none" } else { self.stats.swapchain_last_present_result.as_str() })
                        } else {
                            format!("native output presented {} frame(s)", self.stats.swapchain_presented)
                        }
                    },
                    {
                        "id": "native-recording",
                        "label": "Native recording",
                        "ok": false,
                        "detail": "not implemented yet"
                    }
                ]
            })),
            "reset_stats" => {
                self.stats = CoreStats::default();
                self.render_cpu_ema_ms = 0.0;
                self.native_quality.cpu_ema_ms = 0.0;
                self.native_quality.overload_frames = 0;
                self.native_quality.recovery_frames = 0;
                self.native_quality.step_downs = 0;
                self.native_quality.step_ups = 0;
                Ok(json!(true))
            }
            "submit_batch" => {
                self.apply_batch(&req.params);
                self.request_auto_present();
                Ok(json!(true))
            }
            "submit_commands" => {
                self.apply_commands(req.params.get("commands").unwrap_or(&req.params));
                self.request_auto_present();
                Ok(json!(true))
            }
            "set_output" => {
                self.apply_output_config(&req.params);
                Ok(json!(true))
            }
            "set_output_window" => {
                self.apply_output_window_config(&req.params);
                Ok(json!(self.status()))
            }
            "set_present_policy" => {
                self.apply_present_policy(&req.params);
                Ok(json!(self.status()))
            }
            "set_command_drain_policy" => {
                self.apply_command_drain_policy(&req.params);
                Ok(json!(self.status()))
            }
            "set_auto_present_policy" => {
                self.apply_auto_present_policy(&req.params);
                Ok(json!(self.status()))
            }
            "attach_output_window" => {
                self.apply_output_window_attached(true);
                Ok(json!(self.status()))
            }
            "detach_output_window" => {
                self.apply_output_window_attached(false);
                Ok(json!(self.status()))
            }
            "set_target_fps" => {
                self.target_fps = number_at(&req.params, &["config", "target_fps"])
                    .or_else(|| number_at(&req.params, &["target_fps"]))
                    .unwrap_or(self.target_fps as f64)
                    .round()
                    .clamp(1.0, 240.0) as u32;
                Ok(json!(true))
            }
            "set_native_quality_policy" => {
                self.apply_native_quality_policy(&req.params);
                Ok(json!(true))
            }
            "set_render_clock" => {
                self.apply_render_clock(&req.params);
                Ok(json!(true))
            }
            "set_shader_precompile_policy" => {
                self.apply_shader_precompile_policy(&req.params);
                Ok(json!(self.status()))
            }
            "set_texture_pool_cap" => {
                self.apply_texture_pool_cap(&req.params);
                Ok(json!(self.status()))
            }
            "set_metadata_cache_caps" => {
                self.apply_metadata_cache_caps(&req.params);
                Ok(json!(self.status()))
            }
            "shutdown" => {
                self.running = false;
                event_loop.exit();
                Ok(json!(true))
            }
            _ => Err(format!(
                "unsupported native render-core RPC method `{}`",
                req.method
            )),
        };

        match result {
            Ok(value) => self.send_ok(req.id, value),
            Err(err) => self.send_error(req.id, err),
        }
    }

    fn apply_start_config(&mut self, params: &Value) {
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
        if let Some(renderer) = self.renderer.as_mut() {
            renderer.resize(PhysicalSize::new(self.pending_width, self.pending_height));
        }
    }

    fn apply_output_config(&mut self, params: &Value) {
        let width = number_at(params, &["width"]).unwrap_or(self.pending_width as f64);
        let height = number_at(params, &["height"]).unwrap_or(self.pending_height as f64);
        self.pending_width = width.round().clamp(64.0, 16384.0) as u32;
        self.pending_height = height.round().clamp(64.0, 16384.0) as u32;
        if let Some(renderer) = self.renderer.as_mut() {
            renderer.resize(PhysicalSize::new(self.pending_width, self.pending_height));
        }
    }

    fn apply_present_policy(&mut self, params: &Value) {
        let config = params.get("config").unwrap_or(params);
        if let Some(mode) = string_at(config, &["present_mode"]) {
            let normalized = mode.trim().to_ascii_lowercase();
            self.present_mode =
                if normalized == "immediate" || normalized == "no-vsync" || normalized == "novsync"
                {
                    "immediate".to_string()
                } else {
                    "vsync".to_string()
                };
        }
        self.allow_tearing = bool_at(config, &["allow_tearing"]).unwrap_or(self.allow_tearing);
        self.max_frame_latency = number_at(config, &["max_frame_latency"])
            .unwrap_or(self.max_frame_latency as f64)
            .round()
            .clamp(1.0, 8.0) as u32;
        self.use_waitable_object = false;
        if let Some(renderer) = self.renderer.as_mut() {
            renderer.set_present_policy(
                &self.present_mode,
                self.allow_tearing,
                self.max_frame_latency,
            );
        }
    }

    fn apply_command_drain_policy(&mut self, params: &Value) {
        let config = params.get("config").unwrap_or(params);
        self.command_queue_capacity = number_at(config, &["command_queue_capacity"])
            .unwrap_or(self.command_queue_capacity as f64)
            .round()
            .clamp(1.0, 1_000_000.0) as u32;
        self.command_drain_limit = number_at(config, &["max_commands_per_tick"])
            .or_else(|| number_at(config, &["command_drain_limit"]))
            .unwrap_or(self.command_drain_limit as f64)
            .round()
            .clamp(1.0, self.command_queue_capacity.max(1) as f64)
            as u32;
    }

    fn apply_auto_present_policy(&mut self, params: &Value) {
        let config = params.get("config").unwrap_or(params);
        self.auto_present_on_state_change = bool_at(config, &["auto_present_on_state_change"])
            .unwrap_or(self.auto_present_on_state_change);
    }

    fn apply_output_window_attached(&mut self, attached: bool) {
        self.output_window_attached = attached;
        if let Some(renderer) = self.renderer.as_ref() {
            renderer.window.set_visible(attached);
            if attached {
                renderer.window.request_redraw();
            }
        }
    }

    fn apply_output_window_config(&mut self, params: &Value) {
        let config = params.get("config").unwrap_or(params);
        let attached = bool_at(config, &["attached"])
            .or_else(|| bool_at(config, &["visible"]))
            .or_else(|| bool_at(config, &["enabled"]));
        if let Some(attached) = attached {
            self.output_window_attached = attached;
        }

        let width = number_at(config, &["width"])
            .or_else(|| number_at(config, &["w"]))
            .map(|value| value.round().clamp(1.0, 32768.0) as u32);
        let height = number_at(config, &["height"])
            .or_else(|| number_at(config, &["h"]))
            .map(|value| value.round().clamp(1.0, 32768.0) as u32);
        if let (Some(width), Some(height)) = (width, height) {
            self.pending_width = width;
            self.pending_height = height;
        }

        let Some(renderer) = self.renderer.as_ref() else {
            return;
        };
        if let Some(title) = string_at(config, &["title"]).or_else(|| string_at(config, &["label"]))
        {
            renderer.window.set_title(&title);
        }
        if let Some(resizable) = bool_at(config, &["resizable"]) {
            renderer.window.set_resizable(resizable);
        }
        if let Some(decorations) =
            bool_at(config, &["decorations"]).or_else(|| bool_at(config, &["decorated"]))
        {
            renderer.window.set_decorations(decorations);
        }
        if let (Some(width), Some(height)) = (width, height) {
            let _ = renderer
                .window
                .request_inner_size(LogicalSize::new(width as f64, height as f64));
        }
        let x = number_at(config, &["x"]).or_else(|| number_at(config, &["left"]));
        let y = number_at(config, &["y"]).or_else(|| number_at(config, &["top"]));
        if let (Some(x), Some(y)) = (x, y) {
            renderer
                .window
                .set_outer_position(LogicalPosition::new(x, y));
        }
        if let Some(fullscreen) = bool_at(config, &["fullscreen"])
            .or_else(|| bool_at(config, &["full_screen"]))
            .or_else(|| bool_at(config, &["borderless"]))
        {
            renderer.window.set_fullscreen(if fullscreen {
                Some(Fullscreen::Borderless(None))
            } else {
                None
            });
        }
        renderer.window.set_visible(self.output_window_attached);
        if self.output_window_attached {
            renderer.window.request_redraw();
        }
    }

    fn request_auto_present(&mut self) {
        if !self.auto_present_on_state_change {
            return;
        }
        self.auto_present_requested = true;
        self.request_present();
    }

    fn request_present(&mut self) {
        if let Some(renderer) = self.renderer.as_ref() {
            self.last_redraw = Instant::now();
            renderer.window.request_redraw();
        }
    }

    fn apply_render_clock(&mut self, params: &Value) {
        let params = params.get("config").unwrap_or(params);
        let mode = string_at(params, &["mode"])
            .unwrap_or_else(|| "live".to_string())
            .trim()
            .to_ascii_lowercase();
        if mode == "reset" {
            self.render_clock_mode = "live".to_string();
            self.render_clock_time = None;
            self.render_clock_frame_index = None;
            self.render_clock_delta = 1.0 / self.target_fps.max(1) as f32;
            self.stats.render_clock_updates = self.stats.render_clock_updates.saturating_add(1);
            return;
        }
        self.render_clock_mode = if mode == "manual" {
            "manual".to_string()
        } else {
            "live".to_string()
        };
        self.render_clock_time = number_at(params, &["time"])
            .or_else(|| number_at(params, &["time_seconds"]))
            .or_else(|| number_at(params, &["clock_time"]))
            .map(|value| value.clamp(0.0, 1.0e9) as f32);
        self.render_clock_delta = number_at(params, &["time_delta"])
            .or_else(|| number_at(params, &["delta"]))
            .unwrap_or(1.0 / self.target_fps.max(1) as f64)
            .clamp(0.0, 10.0) as f32;
        self.render_clock_frame_index = number_at(params, &["frame_index"])
            .or_else(|| number_at(params, &["frame"]))
            .map(|value| value.round().clamp(0.0, u64::MAX as f64) as u64);
        self.stats.render_clock_updates = self.stats.render_clock_updates.saturating_add(1);
    }

    fn apply_batch(&mut self, params: &Value) {
        if let Some(commands) = params
            .pointer("/batch/commands")
            .or_else(|| params.get("commands"))
        {
            self.apply_commands(commands);
        }
        self.stats.frames_submitted = self.stats.frames_submitted.saturating_add(1);
    }

    fn apply_commands(&mut self, commands: &Value) {
        let Some(commands) = commands.as_array() else {
            return;
        };
        let count = commands.len() as u64;
        let mut applied = 0u64;
        let mut dropped = 0u64;
        self.stats.command_queue_peak = self.stats.command_queue_peak.max(count);
        if count > self.command_drain_limit as u64 {
            self.stats.command_drain_limit_hits =
                self.stats.command_drain_limit_hits.saturating_add(1);
            self.stats.queued_commands_after_drain = 0;
        }

        for command in commands {
            match command
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or_default()
            {
                "set_output" => self.apply_output_config(command),
                "upsert_layer" => self.apply_upsert_layer(command),
                "set_layer_visibility" => self.apply_layer_visibility(command),
                "set_layer_color" => self.apply_layer_color(command),
                "set_layer_native_params" => self.apply_layer_native_params(command),
                "set_effect_chain" => self.apply_effect_chain(command),
                "set_present_policy" => self.apply_present_policy(command),
                "set_command_drain_policy" | "set_command_drain_limit" => {
                    self.apply_command_drain_policy(command)
                }
                "set_auto_present_policy" => self.apply_auto_present_policy(command),
                "set_texture_pool_cap" => self.apply_texture_pool_cap(command),
                "set_shader_precompile_policy" => self.apply_shader_precompile_policy(command),
                "set_metadata_cache_caps" => self.apply_metadata_cache_caps(command),
                "set_native_quality_policy" => self.apply_native_quality_policy(command),
                "present" => self.request_present(),
                "set_audio_state" => self.apply_audio_state(command),
                "set_render_clock" => self.apply_render_clock(command),
                "bind_media_source" => self.apply_media_source(command),
                "upload_source_preview" => self.apply_source_preview(command),
                "upload_source_frame" => self.apply_source_frame(command),
                "precompile_shader" => self.apply_precompile_shader(command),
                "bind_isf_shader" => self.apply_bind_isf_shader(command),
                "update_isf_uniforms" => self.apply_isf_uniforms(command),
                "render_isf_to_layer" => self.apply_render_isf_to_layer(command),
                "remove_layer" => self.apply_remove_layer(command),
                _ => {
                    dropped = dropped.saturating_add(1);
                    continue;
                }
            }
            applied = applied.saturating_add(1);
        }
        self.stats.commands_applied = self.stats.commands_applied.saturating_add(applied);
        self.stats.commands_dropped = self.stats.commands_dropped.saturating_add(dropped);
        self.command_phase = (self.command_phase + applied as f32 * 0.031).fract();
        self.layers_seen = self.scene_layers.len().min(1024) as u32;
    }

    fn prepare_native_instrument_tasks(&mut self, seq: u64) -> Vec<NativeInstrumentTask> {
        let mut candidates = self
            .scene_layers
            .values()
            .filter(|layer| layer.visible && is_native_instrument_kind(layer.source_kind))
            .map(|layer| {
                (
                    layer.id.clone(),
                    layer
                        .source_id
                        .clone()
                        .unwrap_or_else(|| format!("native-instrument:{}", layer.id)),
                    layer.source_kind,
                    layer.native_params,
                    layer.z_index,
                )
            })
            .collect::<Vec<_>>();
        candidates.sort_by(|a, b| b.4.cmp(&a.4).then_with(|| a.0.cmp(&b.0)));

        let mut tasks = Vec::new();
        let quality_scale = self.native_quality.instrument_scale();
        for (layer_id, source_id, source_kind, native_params, _) in candidates {
            let slot = self.assign_source_frame_slot(&source_id);
            self.source_frames
                .insert(source_id.clone(), SourceFrame { seq });
            if let Some(layer) = self.scene_layers.get_mut(&layer_id) {
                layer.frame_slot = Some(slot);
                layer.preview_slot = None;
            }
            let mut params0 = [
                native_params[0],
                native_params[1],
                native_params[2],
                native_params[3],
            ];
            let mut params1 = [
                native_params[4],
                native_params[5],
                native_params[6],
                native_params[7],
            ];
            let density_scale = 0.62 + quality_scale * 0.38;
            params0[2] = (params0[2] * density_scale).clamp(0.0, 1.0);
            params1[2] = (params1[2] * quality_scale).clamp(0.0, 1.0);
            tasks.push(NativeInstrumentTask {
                slot,
                source_kind,
                params0,
                params1,
                seed: unit_from_hash(stable_hash64(&source_id)),
            });
        }
        tasks
    }

    fn render(&mut self) {
        if !self.running {
            return;
        }
        let frame_index = self
            .render_clock_frame_index
            .unwrap_or(self.stats.frames_presented);
        let native_tasks = self.prepare_native_instrument_tasks(frame_index);
        let gpu_layers = self.gpu_layer_data();
        let source_preview_pixels = if self.source_preview_dirty {
            Some(self.source_preview_pixel_data())
        } else {
            None
        };
        let Some(renderer) = self.renderer.as_mut() else {
            return;
        };
        renderer.poll_gpu_timing();
        let started = Instant::now();
        match renderer.render_native_instrument_frames(
            &native_tasks,
            self.render_clock_time,
            frame_index,
            self.audio0,
            self.audio1,
            self.audio2,
        ) {
            Ok(rendered) => {
                self.stats.native_instrument_frame_renders = self
                    .stats
                    .native_instrument_frame_renders
                    .saturating_add(rendered as u64);
            }
            Err(err) => {
                renderer.last_frame_error = Some(err);
                return;
            }
        }
        self.stats.swapchain_present_attempts =
            self.stats.swapchain_present_attempts.saturating_add(1);
        match renderer.render(
            self.command_phase,
            gpu_layers.len() as u32,
            self.render_clock_time,
            frame_index,
            &gpu_layers,
            source_preview_pixels.as_deref(),
            self.audio0,
            self.audio1,
            self.audio2,
        ) {
            Ok(outcome) if outcome.presented() => {
                self.stats.swapchain_last_present_result = outcome.as_str().to_string();
                self.stats.swapchain_last_present_error.clear();
                self.stats.frames_presented = self.stats.frames_presented.saturating_add(1);
                self.stats.swapchain_presented = self.stats.swapchain_presented.saturating_add(1);
                self.stats.swapchain_present_consecutive_failures = 0;
                if self.auto_present_requested {
                    self.stats.frames_presented_auto =
                        self.stats.frames_presented_auto.saturating_add(1);
                    self.auto_present_requested = false;
                } else {
                    self.stats.frames_presented_explicit =
                        self.stats.frames_presented_explicit.saturating_add(1);
                }
                self.stats.draw_calls = self.stats.draw_calls.saturating_add(1);
                let ms = started.elapsed().as_secs_f64() * 1000.0;
                self.stats.last_render_cpu_ms = ms;
                self.render_cpu_ema_ms = if self.render_cpu_ema_ms <= 0.0 {
                    ms
                } else {
                    self.render_cpu_ema_ms * 0.94 + ms * 0.06
                };
                let gpu_ms = renderer.last_render_gpu_ms();
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
                self.native_quality
                    .observe_frame(ms, gpu_ms, self.target_fps, native_tasks.len());
                if source_preview_pixels.is_some() {
                    self.source_preview_dirty = false;
                }
            }
            Ok(outcome) => {
                self.stats.swapchain_last_present_result = outcome.as_str().to_string();
                self.stats.swapchain_last_present_error.clear();
                self.stats.swapchain_present_failures =
                    self.stats.swapchain_present_failures.saturating_add(1);
                match outcome {
                    SurfacePresentOutcome::Outdated => {
                        self.stats.swapchain_present_outdated =
                            self.stats.swapchain_present_outdated.saturating_add(1);
                    }
                    SurfacePresentOutcome::Timeout => {
                        self.stats.swapchain_present_timeouts =
                            self.stats.swapchain_present_timeouts.saturating_add(1);
                    }
                    SurfacePresentOutcome::Occluded => {
                        self.stats.swapchain_present_occluded =
                            self.stats.swapchain_present_occluded.saturating_add(1);
                    }
                    SurfacePresentOutcome::Presented
                    | SurfacePresentOutcome::SuboptimalPresented => {}
                }
                self.stats.swapchain_present_consecutive_failures = self
                    .stats
                    .swapchain_present_consecutive_failures
                    .saturating_add(1);
                self.stats.swapchain_present_max_consecutive_failures = self
                    .stats
                    .swapchain_present_max_consecutive_failures
                    .max(self.stats.swapchain_present_consecutive_failures);
                self.stats.frames_without_swapchain_present = self
                    .stats
                    .frames_without_swapchain_present
                    .saturating_add(1);
            }
            Err(err) => {
                self.stats.swapchain_last_present_result = if err.contains("surface lost") {
                    self.stats.swapchain_present_lost =
                        self.stats.swapchain_present_lost.saturating_add(1);
                    "lost".to_string()
                } else if err.contains("validation") {
                    self.stats.swapchain_present_validation_errors = self
                        .stats
                        .swapchain_present_validation_errors
                        .saturating_add(1);
                    "validation-error".to_string()
                } else {
                    "error".to_string()
                };
                self.stats.swapchain_last_present_error = err.clone();
                self.stats.swapchain_present_failures =
                    self.stats.swapchain_present_failures.saturating_add(1);
                self.stats.swapchain_present_consecutive_failures = self
                    .stats
                    .swapchain_present_consecutive_failures
                    .saturating_add(1);
                self.stats.swapchain_present_max_consecutive_failures = self
                    .stats
                    .swapchain_present_max_consecutive_failures
                    .max(self.stats.swapchain_present_consecutive_failures);
                self.stats.frames_without_swapchain_present = self
                    .stats
                    .frames_without_swapchain_present
                    .saturating_add(1);
                renderer.last_frame_error = Some(err);
            }
        }
    }

    fn frame_snapshot(&mut self, params: &Value) -> Result<Value, String> {
        let include_pixels = bool_at(params, &["include_pixels"]).unwrap_or(false);
        let snapshot_time = number_at(params, &["time"])
            .or_else(|| number_at(params, &["time_seconds"]))
            .or_else(|| number_at(params, &["clock_time"]))
            .map(|value| value.clamp(0.0, 1.0e9) as f32)
            .or(self.render_clock_time);
        let snapshot_frame_index = number_at(params, &["frame_index"])
            .or_else(|| number_at(params, &["frame"]))
            .map(|value| value.round().clamp(0.0, u64::MAX as f64) as u64)
            .or(self.render_clock_frame_index)
            .unwrap_or(self.stats.frames_presented);
        let native_tasks = self.prepare_native_instrument_tasks(snapshot_frame_index);
        let gpu_layers = self.gpu_layer_data();
        let source_preview_pixels = if self.source_preview_dirty {
            Some(self.source_preview_pixel_data())
        } else {
            None
        };
        let Some(renderer) = self.renderer.as_mut() else {
            return Err("native renderer has not created a wgpu device".to_string());
        };
        renderer.poll_gpu_timing();
        match renderer.render_native_instrument_frames(
            &native_tasks,
            snapshot_time,
            snapshot_frame_index,
            self.audio0,
            self.audio1,
            self.audio2,
        ) {
            Ok(rendered) => {
                self.stats.native_instrument_frame_renders = self
                    .stats
                    .native_instrument_frame_renders
                    .saturating_add(rendered as u64);
            }
            Err(err) => {
                renderer.last_frame_error = Some(err.clone());
                return Err(err);
            }
        }
        if let Err(err) = renderer.render_snapshot(
            self.command_phase,
            gpu_layers.len() as u32,
            snapshot_time,
            snapshot_frame_index,
            &gpu_layers,
            source_preview_pixels.as_deref(),
            self.audio0,
            self.audio1,
            self.audio2,
        ) {
            renderer.last_frame_error = Some(err.clone());
            return Err(err);
        }
        if source_preview_pixels.is_some() {
            self.source_preview_dirty = false;
        }
        let snapshot = renderer.frame_snapshot(include_pixels)?;
        renderer.poll_gpu_timing();
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
        self.stats.frame_snapshot_reads = self.stats.frame_snapshot_reads.saturating_add(1);
        self.stats.frame_health_checks = self.stats.frame_health_checks.saturating_add(1);
        if bool_at(&snapshot, &["dark_frame"]).unwrap_or(false) {
            self.stats.dark_frame_warnings = self.stats.dark_frame_warnings.saturating_add(1);
        }
        self.stats.frame_snapshot_bytes_read = self
            .stats
            .frame_snapshot_bytes_read
            .saturating_add(number_at(&snapshot, &["byte_length"]).unwrap_or(0.0) as u64);
        Ok(snapshot)
    }

    fn compute_probe(&mut self, params: &Value) -> Result<Value, String> {
        let Some(shader_id) = string_at(params, &["shader_id"]) else {
            return Err("compute_probe requires shader_id".to_string());
        };
        let record = self
            .shader_registry
            .get(&shader_id)
            .cloned()
            .ok_or_else(|| format!("compute shader `{shader_id}` has not been precompiled"))?;
        let source = self
            .shader_sources
            .get(&shader_id)
            .ok_or_else(|| format!("compute shader source missing for `{shader_id}`"))?;
        let entry = native_compute_entry(&record, source).ok_or_else(|| {
            format!("shader `{shader_id}` is not a supported native compute shader")
        })?;
        let element_count = number_at(params, &["element_count"])
            .or_else(|| number_at(params, &["count"]))
            .unwrap_or(256.0)
            .round()
            .clamp(1.0, 1_048_576.0) as u32;
        let frame_index = number_at(params, &["frame_index"])
            .or_else(|| number_at(params, &["frame"]))
            .map(|value| value.round().clamp(0.0, u32::MAX as f64) as u32)
            .unwrap_or(self.stats.frames_presented.min(u32::MAX as u64) as u32);
        let seed = number_at(params, &["seed"])
            .map(|value| value.round().clamp(0.0, u32::MAX as f64) as u32)
            .unwrap_or_else(|| stable_hash64(&shader_id) as u32);
        let cache_key = format!("{}:{}:{:016x}", shader_id, entry, record.source_hash);
        let Some(renderer) = self.renderer.as_mut() else {
            return Err("native renderer has not created a wgpu device".to_string());
        };
        let probe = renderer.run_native_compute_probe(
            &cache_key,
            source,
            &entry,
            ComputeProbeUniforms {
                element_count,
                frame_index,
                seed,
                _pad0: 0,
            },
        )?;
        self.stats.pipeline_cache_entries = renderer.native_pipeline_cache_count() as u64;
        Ok(json!({
            "shader_id": shader_id,
            "entry": entry,
            "element_count": element_count,
            "frame_index": frame_index,
            "seed": seed,
            "byte_length": probe.byte_length,
            "checksum": format!("{:016x}", probe.checksum),
            "nonzero_words": probe.nonzero_words,
            "first_words": probe.first_words,
            "pipeline_cache_entries": renderer.native_pipeline_cache_count(),
        }))
    }

    fn compute_graph(&mut self, params: &Value) -> Result<Value, String> {
        let Some(buffers_value) = params.get("buffers").and_then(Value::as_array) else {
            return Err("compute_graph requires buffers[]".to_string());
        };
        let Some(passes_value) = params.get("passes").and_then(Value::as_array) else {
            return Err("compute_graph requires passes[]".to_string());
        };
        let mut buffer_specs = Vec::with_capacity(buffers_value.len());
        for buffer in buffers_value {
            buffer_specs.push(parse_compute_graph_buffer(buffer)?);
        }
        let buffer_kinds = buffer_specs
            .iter()
            .map(|buffer| (buffer.id.clone(), buffer.kind))
            .collect::<HashMap<_, _>>();
        let mut pass_plans = Vec::with_capacity(passes_value.len());
        for (index, pass) in passes_value.iter().enumerate() {
            pass_plans.push(self.compute_graph_pass_plan(pass, index, &buffer_kinds)?);
        }
        let render_plans = self.compute_graph_render_plans(params, &buffer_kinds)?;
        let render_targets = render_plans
            .iter()
            .map(|render| render.target.clone())
            .collect::<Vec<_>>();
        let readbacks = compute_graph_readbacks(params, &buffer_specs);
        let readback_bytes = readbacks
            .iter()
            .filter_map(|id| {
                buffer_specs
                    .iter()
                    .find(|buffer| buffer.id == *id)
                    .map(|buffer| buffer.byte_length)
            })
            .fold(0u64, u64::saturating_add);
        let readback_count = readbacks.len() as u64;
        let pass_count = pass_plans.len() as u64;
        let render_pass_count = render_plans.len() as u64;
        let render_targets_for_stats = render_targets.clone();
        let render_targets_for_source_frames = render_targets;
        let result = {
            let Some(renderer) = self.renderer.as_mut() else {
                return Err("native renderer has not created a wgpu device".to_string());
            };
            let result = renderer.run_native_compute_graph(
                buffer_specs,
                pass_plans,
                readbacks,
                render_plans,
            )?;
            self.stats.pipeline_cache_entries = renderer.native_pipeline_cache_count() as u64;
            self.stats.compute_graph_persistent_buffers =
                renderer.native_compute_graph_buffer_count() as u64;
            result
        };
        self.stats.compute_graph_runs = self.stats.compute_graph_runs.saturating_add(1);
        self.stats.compute_graph_passes =
            self.stats.compute_graph_passes.saturating_add(pass_count);
        self.stats.compute_graph_readbacks = self
            .stats
            .compute_graph_readbacks
            .saturating_add(readback_count);
        self.stats.compute_graph_readback_bytes = self
            .stats
            .compute_graph_readback_bytes
            .saturating_add(readback_bytes);
        if render_pass_count > 0 {
            self.stats.compute_graph_render_passes = self
                .stats
                .compute_graph_render_passes
                .saturating_add(render_pass_count);
            for render_target in render_targets_for_stats {
                match render_target {
                    NativeComputeGraphRenderTarget::SourceFrame { .. } => {
                        self.stats.compute_graph_source_frame_renders = self
                            .stats
                            .compute_graph_source_frame_renders
                            .saturating_add(1);
                    }
                    NativeComputeGraphRenderTarget::Snapshot => {
                        self.stats.compute_graph_snapshot_renders =
                            self.stats.compute_graph_snapshot_renders.saturating_add(1);
                    }
                }
            }
        }
        for render_target in render_targets_for_source_frames {
            if let NativeComputeGraphRenderTarget::SourceFrame {
                source_id,
                slot,
                seq,
            } = render_target
            {
                self.source_frames
                    .insert(source_id.clone(), SourceFrame { seq });
                for layer in self.scene_layers.values_mut() {
                    if layer.source_id.as_deref() == Some(source_id.as_str()) {
                        layer.frame_slot = Some(slot);
                    }
                }
            }
        }
        Ok(result)
    }

    fn compute_graph_render_plans(
        &mut self,
        params: &Value,
        buffer_kinds: &HashMap<String, NativeComputeBufferBindingKind>,
    ) -> Result<Vec<NativeComputeGraphRenderPlan>, String> {
        if let Some(renders_value) = params
            .get("render_passes")
            .or_else(|| params.get("renders"))
            .or_else(|| params.get("renderPlans"))
        {
            let Some(renders) = renders_value.as_array() else {
                return Err("compute_graph render_passes must be an array".to_string());
            };
            let mut plans = Vec::with_capacity(renders.len());
            for render in renders {
                plans.push(self.compute_graph_render_plan(render, buffer_kinds)?);
            }
            return Ok(plans);
        }

        params
            .get("render")
            .or_else(|| params.get("render_pass"))
            .map(|render| {
                self.compute_graph_render_plan(render, buffer_kinds)
                    .map(|plan| vec![plan])
            })
            .transpose()
            .map(|plans| plans.unwrap_or_default())
    }

    fn compute_graph_binding_spec(
        &self,
        binding: &Value,
        shader_id: &str,
        context: &str,
        buffer_kinds: &HashMap<String, NativeComputeBufferBindingKind>,
    ) -> Result<NativeComputeGraphBindingSpec, String> {
        let binding_number = number_at(binding, &["binding"])
            .ok_or_else(|| format!("compute_graph {context} `{shader_id}` binding missing number"))?
            .round()
            .clamp(0.0, u32::MAX as f64) as u32;
        let explicit_graph_kind = compute_graph_binding_kind_from_value(binding);
        match explicit_graph_kind {
            Some(NativeComputeGraphBindingKind::SourceFrameSampler) => {
                let resource_id = string_at(binding, &["resource"])
                    .or_else(|| string_at(binding, &["resource_id"]))
                    .unwrap_or_else(|| "source-frame-sampler".to_string());
                Ok(NativeComputeGraphBindingSpec {
                    binding: binding_number,
                    resource_id,
                    kind: NativeComputeGraphBindingKind::SourceFrameSampler,
                    source_slot: None,
                })
            }
            Some(NativeComputeGraphBindingKind::SourceFrameTexture(dimension)) => {
                let is_array = matches!(dimension, NativeComputeGraphTextureDimension::D2Array);
                let allow_missing = bool_at(binding, &["allow_missing"])
                    .or_else(|| bool_at(binding, &["allowMissing"]))
                    .or_else(|| bool_at(binding, &["fallback"]))
                    .or_else(|| bool_at(binding, &["optional"]))
                    .unwrap_or(false);
                let resource_id = if is_array {
                    string_at(binding, &["resource"])
                        .or_else(|| string_at(binding, &["resource_id"]))
                        .or_else(|| string_at(binding, &["source_id"]))
                        .unwrap_or_else(|| "source-frames".to_string())
                } else {
                    let source_id = string_at(binding, &["source_id"])
                        .or_else(|| string_at(binding, &["sourceId"]))
                        .or_else(|| string_at(binding, &["source_frame_id"]))
                        .or_else(|| string_at(binding, &["sourceFrameId"]))
                        .or_else(|| string_at(binding, &["resource"]))
                        .or_else(|| string_at(binding, &["resource_id"]));
                    let Some(source_id) = source_id else {
                        if allow_missing {
                            return Ok(NativeComputeGraphBindingSpec {
                                binding: binding_number,
                                resource_id: "__source_frame_fallback__".to_string(),
                                kind: NativeComputeGraphBindingKind::SourceFrameTexture(dimension),
                                source_slot: Some(0),
                            });
                        }
                        return Err(format!(
                            "compute_graph {context} `{shader_id}` binding {binding_number} source-frame texture requires source_id"
                        ));
                    };
                    source_id
                };
                let source_slot = if is_array {
                    None
                } else {
                    Some(
                        self.source_frame_slots
                            .get(&resource_id)
                            .copied()
                            .or_else(|| allow_missing.then_some(0))
                            .ok_or_else(|| {
                                format!(
                                    "compute_graph {context} `{shader_id}` binding {binding_number} source-frame `{resource_id}` has no uploaded/generated frame"
                                )
                            })?,
                    )
                };
                Ok(NativeComputeGraphBindingSpec {
                    binding: binding_number,
                    resource_id,
                    kind: NativeComputeGraphBindingKind::SourceFrameTexture(dimension),
                    source_slot,
                })
            }
            Some(NativeComputeGraphBindingKind::Buffer(kind)) => {
                let resource_id =
                    compute_graph_binding_resource_id(binding).ok_or_else(|| {
                        format!(
                            "compute_graph {context} `{shader_id}` binding {binding_number} missing resource"
                        )
                    })?;
                Ok(NativeComputeGraphBindingSpec {
                    binding: binding_number,
                    resource_id,
                    kind: NativeComputeGraphBindingKind::Buffer(kind),
                    source_slot: None,
                })
            }
            None => {
                let resource_id =
                    compute_graph_binding_resource_id(binding).ok_or_else(|| {
                        format!(
                            "compute_graph {context} `{shader_id}` binding {binding_number} missing resource"
                        )
                    })?;
                let default_kind = buffer_kinds
                    .get(&resource_id)
                    .copied()
                    .unwrap_or(NativeComputeBufferBindingKind::StorageReadWrite);
                let kind = compute_binding_kind_from_value(binding).unwrap_or(default_kind);
                Ok(NativeComputeGraphBindingSpec {
                    binding: binding_number,
                    resource_id,
                    kind: NativeComputeGraphBindingKind::Buffer(kind),
                    source_slot: None,
                })
            }
        }
    }

    fn compute_graph_pass_plan(
        &self,
        pass: &Value,
        index: usize,
        buffer_kinds: &HashMap<String, NativeComputeBufferBindingKind>,
    ) -> Result<NativeComputeGraphPassPlan, String> {
        let Some(shader_id) = string_at(pass, &["shader_id"]) else {
            return Err(format!("compute_graph pass {index} missing shader_id"));
        };
        let record = self.shader_registry.get(&shader_id).ok_or_else(|| {
            format!("compute graph shader `{shader_id}` has not been precompiled")
        })?;
        let source = self
            .shader_sources
            .get(&shader_id)
            .ok_or_else(|| format!("compute graph shader source missing for `{shader_id}`"))?;
        let explicit_entry = string_at(pass, &["entry"]);
        let entry = if let Some(entry) = explicit_entry {
            if record
                .entry_points
                .iter()
                .any(|candidate| candidate == &entry)
            {
                entry
            } else {
                return Err(format!(
                    "shader `{shader_id}` has no compute entry `{entry}`"
                ));
            }
        } else {
            native_compute_entry(record, source)
                .ok_or_else(|| format!("shader `{shader_id}` is not a supported compute shader"))?
        };
        let Some(bindings_value) = pass.get("bindings").and_then(Value::as_array) else {
            return Err(format!(
                "compute_graph pass `{shader_id}` requires bindings[]"
            ));
        };
        let mut bindings = Vec::with_capacity(bindings_value.len());
        for binding in bindings_value {
            bindings.push(self.compute_graph_binding_spec(
                binding,
                shader_id.as_str(),
                "pass",
                buffer_kinds,
            )?);
        }
        bindings.sort_by_key(|binding| binding.binding);
        let dispatch = dispatch_from_value(pass);
        let layout_sig = bindings
            .iter()
            .map(|binding| format!("{}:{}", binding.binding, binding.kind.signature()))
            .collect::<Vec<_>>()
            .join(",");
        let name =
            string_at(pass, &["name"]).unwrap_or_else(|| format!("{shader_id}:{entry}:{index}"));
        Ok(NativeComputeGraphPassPlan {
            name,
            cache_key: format!(
                "graph:{shader_id}:{}:{entry}:{layout_sig}",
                record.source_hash
            ),
            source: source.clone(),
            entry,
            dispatch,
            bindings,
        })
    }

    fn compute_graph_render_plan(
        &mut self,
        render: &Value,
        buffer_kinds: &HashMap<String, NativeComputeBufferBindingKind>,
    ) -> Result<NativeComputeGraphRenderPlan, String> {
        let Some(shader_id) = string_at(render, &["shader_id"]) else {
            return Err("compute_graph render pass missing shader_id".to_string());
        };
        let record = self.shader_registry.get(&shader_id).ok_or_else(|| {
            format!("compute graph render shader `{shader_id}` has not been precompiled")
        })?;
        let source_hash = record.source_hash;
        let default_fragment_entry = record.entry.clone();
        let entry_points = record.entry_points.clone();
        let source = self
            .shader_sources
            .get(&shader_id)
            .cloned()
            .ok_or_else(|| {
                format!("compute graph render shader source missing for `{shader_id}`")
            })?;
        let vertex_entry =
            string_at(render, &["vertex_entry"]).unwrap_or_else(|| "vs_main".to_string());
        let fragment_entry = string_at(render, &["fragment_entry"])
            .or_else(|| string_at(render, &["entry"]))
            .unwrap_or(default_fragment_entry);
        if !entry_points.iter().any(|entry| entry == &vertex_entry) {
            return Err(format!(
                "shader `{shader_id}` has no graph render vertex entry `{vertex_entry}`"
            ));
        }
        if !entry_points.iter().any(|entry| entry == &fragment_entry) {
            return Err(format!(
                "shader `{shader_id}` has no graph render fragment entry `{fragment_entry}`"
            ));
        }
        let Some(bindings_value) = render.get("bindings").and_then(Value::as_array) else {
            return Err(format!(
                "compute_graph render pass `{shader_id}` requires bindings[]"
            ));
        };
        let mut bindings = Vec::with_capacity(bindings_value.len());
        for binding in bindings_value {
            bindings.push(self.compute_graph_binding_spec(
                binding,
                shader_id.as_str(),
                "render",
                buffer_kinds,
            )?);
        }
        bindings.sort_by_key(|binding| binding.binding);
        let layout_sig = bindings
            .iter()
            .map(|binding| format!("{}:{}", binding.binding, binding.kind.signature()))
            .collect::<Vec<_>>()
            .join(",");
        let name = string_at(render, &["name"]).unwrap_or_else(|| format!("{shader_id}:render"));
        let clear = bool_at(render, &["clear"]).unwrap_or(true);
        let include_snapshot = bool_at(render, &["include_snapshot"])
            .or_else(|| bool_at(render, &["snapshot"]))
            .unwrap_or(true);
        let blend = string_at(render, &["blend"])
            .or_else(|| string_at(render, &["blend_mode"]))
            .or_else(|| string_at(render, &["blendMode"]))
            .map(|label| NativeComputeGraphRenderBlend::from_label(&label))
            .unwrap_or(NativeComputeGraphRenderBlend::Replace);
        let vertex_count = number_at(render, &["vertex_count"])
            .or_else(|| number_at(render, &["vertices"]))
            .or_else(|| number_at(render, &["draw_vertices"]))
            .unwrap_or(3.0)
            .round()
            .clamp(1.0, u32::MAX as f64) as u32;
        let instance_count = number_at(render, &["instance_count"])
            .or_else(|| number_at(render, &["instances"]))
            .or_else(|| number_at(render, &["draw_instances"]))
            .unwrap_or(1.0)
            .round()
            .clamp(1.0, u32::MAX as f64) as u32;
        let indirect_buffer_id = string_at(render, &["draw_indirect_buffer"])
            .or_else(|| string_at(render, &["indirect_buffer"]))
            .or_else(|| string_at(render, &["indirect_buffer_id"]))
            .or_else(|| string_at(render, &["drawIndirectBuffer"]))
            .or_else(|| string_at(render, &["indirectBuffer"]));
        if let Some(indirect_buffer_id) = indirect_buffer_id.as_ref() {
            if !buffer_kinds.contains_key(indirect_buffer_id) {
                return Err(format!(
                    "compute_graph render `{shader_id}` indirect draw references missing buffer `{indirect_buffer_id}`"
                ));
            }
        }
        let indirect_offset = number_at(render, &["draw_indirect_offset"])
            .or_else(|| number_at(render, &["indirect_offset"]))
            .or_else(|| number_at(render, &["indirectOffset"]))
            .unwrap_or(0.0)
            .round()
            .max(0.0) as u64;
        let clear_color = vec4_path_at(render, &["clear_color"])
            .or_else(|| vec4_path_at(render, &["clearColor"]))
            .or_else(|| vec4_path_at(render, &["clear_value"]))
            .or_else(|| vec4_path_at(render, &["clearValue"]))
            .map(|rgba| {
                [
                    rgba[0].clamp(-64.0, 64.0) as f64,
                    rgba[1].clamp(-64.0, 64.0) as f64,
                    rgba[2].clamp(-64.0, 64.0) as f64,
                    rgba[3].clamp(0.0, 1.0) as f64,
                ]
            })
            .unwrap_or([0.0, 0.0, 0.0, 1.0]);
        let depth_enabled = bool_at(render, &["depth"])
            .or_else(|| bool_at(render, &["depth_test"]))
            .or_else(|| bool_at(render, &["depthTest"]))
            .or_else(|| bool_at(render, &["depth_write"]))
            .or_else(|| bool_at(render, &["depthWrite"]))
            .unwrap_or(false);
        let depth_write = bool_at(render, &["depth_write"])
            .or_else(|| bool_at(render, &["depthWrite"]))
            .unwrap_or(depth_enabled);
        let depth_compare = string_at(render, &["depth_compare"])
            .or_else(|| string_at(render, &["depthCompare"]))
            .map(|label| NativeComputeGraphDepthCompare::from_label(&label))
            .unwrap_or(NativeComputeGraphDepthCompare::Less);
        let primitive_topology = string_at(render, &["primitive"])
            .or_else(|| string_at(render, &["topology"]))
            .or_else(|| string_at(render, &["primitive_topology"]))
            .or_else(|| string_at(render, &["primitiveTopology"]))
            .map(|label| NativeComputeGraphPrimitiveTopology::from_label(&label))
            .unwrap_or(NativeComputeGraphPrimitiveTopology::TriangleList);
        let target_label = string_at(render, &["target"])
            .or_else(|| string_at(render, &["target_type"]))
            .or_else(|| string_at(render, &["render_target"]))
            .unwrap_or_else(|| "snapshot".to_string());
        let target_key = target_label
            .trim()
            .to_ascii_lowercase()
            .replace('_', "-")
            .replace(' ', "-");
        let target = match target_key.as_str() {
            "snapshot" | "frame-snapshot" | "snapshot-texture" => {
                NativeComputeGraphRenderTarget::Snapshot
            }
            "source" | "source-frame" | "source-texture" | "layer-source" => {
                let Some(source_id) = string_at(render, &["source_id"])
                    .or_else(|| string_at(render, &["sourceId"]))
                    .or_else(|| string_at(render, &["target_source_id"]))
                    .or_else(|| string_at(render, &["targetSourceId"]))
                else {
                    return Err(
                        "compute_graph render target `source_frame` requires source_id".to_string(),
                    );
                };
                let slot = self.assign_source_frame_slot(&source_id);
                let seq = number_at(render, &["seq"])
                    .or_else(|| number_at(render, &["frame_index"]))
                    .unwrap_or_else(|| self.stats.commands_applied.saturating_add(1) as f64)
                    .round()
                    .max(0.0) as u64;
                NativeComputeGraphRenderTarget::SourceFrame {
                    source_id,
                    slot,
                    seq,
                }
            }
            _ => {
                return Err(format!(
                    "compute_graph render target `{target_label}` is unsupported"
                ));
            }
        };
        Ok(NativeComputeGraphRenderPlan {
            name,
            cache_key: format!(
                "graph-render:{shader_id}:{}:{vertex_entry}:{fragment_entry}:{}:{}:{}:{}:{}:{layout_sig}",
                source_hash,
                blend.signature(),
                primitive_topology.signature(),
                if depth_enabled { "depth" } else { "nodepth" },
                if depth_write { "write" } else { "read" },
                depth_compare.signature()
            ),
            source,
            vertex_entry,
            fragment_entry,
            clear,
            include_snapshot,
            target,
            blend,
            vertex_count,
            instance_count,
            indirect_buffer_id,
            indirect_offset,
            clear_color,
            primitive_topology,
            depth_enabled,
            depth_write,
            depth_compare,
            bindings,
        })
    }

    fn frame_duration(&self) -> Duration {
        Duration::from_secs_f64(1.0 / self.target_fps.max(1) as f64)
    }

    fn apply_native_quality_policy(&mut self, params: &Value) {
        let config = params.get("config").unwrap_or(params);
        if let Some(policy) = string_at(config, &["native_quality_policy"])
            .or_else(|| string_at(config, &["quality_policy"]))
            .or_else(|| string_at(config, &["policy"]))
        {
            self.native_quality.set_policy(&policy);
        }
    }

    fn apply_shader_precompile_policy(&mut self, params: &Value) {
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

    fn apply_texture_pool_cap(&mut self, params: &Value) {
        self.texture_pool_cap_mb = number_at(params, &["config", "texture_pool_cap_mb"])
            .or_else(|| number_at(params, &["texture_pool_cap_mb"]))
            .unwrap_or(self.texture_pool_cap_mb as f64)
            .round()
            .clamp(16.0, 16384.0) as u32;
    }

    fn apply_metadata_cache_caps(&mut self, params: &Value) {
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
    }

    fn apply_precompile_shader(&mut self, command: &Value) {
        self.stats.shader_precompile_queued = self.stats.shader_precompile_queued.saturating_add(1);
        let Some(shader_id) = string_at(command, &["shader_id"]) else {
            self.stats.shader_precompile_dropped =
                self.stats.shader_precompile_dropped.saturating_add(1);
            return;
        };
        let Some(source) = string_at(command, &["source"]) else {
            self.stats.shader_precompile_dropped =
                self.stats.shader_precompile_dropped.saturating_add(1);
            return;
        };
        let stage = string_at(command, &["stage"]).unwrap_or_else(|| "module".to_string());
        let entry = string_at(command, &["entry"]).unwrap_or_else(|| "main".to_string());

        if self.shader_registry.len() >= self.shader_precompile_queue_cap as usize
            && !self.shader_registry.contains_key(&shader_id)
        {
            self.stats.shader_precompile_dropped =
                self.stats.shader_precompile_dropped.saturating_add(1);
            self.last_shader_error =
                Some(format!("shader registry cap reached; dropped {shader_id}"));
            return;
        }

        if !looks_like_wgsl(&source) {
            self.stats.shader_precompile_dropped =
                self.stats.shader_precompile_dropped.saturating_add(1);
            return;
        }

        match naga::front::wgsl::parse_str(&source) {
            Ok(module) => {
                let entry_points = module
                    .entry_points
                    .iter()
                    .map(|entry| entry.name.clone())
                    .collect::<Vec<_>>();
                let record = ShaderRecord {
                    shader_id: shader_id.clone(),
                    stage,
                    entry,
                    source_hash: stable_hash64(&source),
                    source_bytes: source.len(),
                    entry_points,
                    compiled_at_ms: epoch_ms().min(u64::MAX as u128) as u64,
                };
                self.shader_registry.insert(shader_id.clone(), record);
                self.shader_sources.insert(shader_id, source);
                self.stats.shader_precompile_compiled =
                    self.stats.shader_precompile_compiled.saturating_add(1);
                self.stats.shader_cache_entries = self.shader_registry.len() as u64;
                self.stats.precompiled_vertex_shaders =
                    self.precompiled_shader_count("vertex") as u64;
                self.stats.precompiled_pixel_shaders =
                    self.precompiled_shader_count("pixel") as u64;
                self.last_shader_error = None;
            }
            Err(err) => {
                self.stats.shader_precompile_failed =
                    self.stats.shader_precompile_failed.saturating_add(1);
                self.last_shader_error = Some(format!("{shader_id}: {err}"));
            }
        }
    }

    fn precompiled_shader_count(&self, stage: &str) -> u32 {
        self.shader_registry
            .values()
            .filter(|record| record.stage.eq_ignore_ascii_case(stage))
            .count()
            .min(u32::MAX as usize) as u32
    }

    fn shader_registry_snapshot(&self) -> Vec<ShaderRecord> {
        let mut shaders = self.shader_registry.values().cloned().collect::<Vec<_>>();
        shaders.sort_by(|a, b| a.shader_id.cmp(&b.shader_id));
        shaders
    }

    fn apply_upsert_layer(&mut self, command: &Value) {
        let Some(layer_id) = string_at(command, &["layer_id"]) else {
            return;
        };
        let z_index = number_at(command, &["z_index"])
            .unwrap_or(0.0)
            .round()
            .clamp(i32::MIN as f64, i32::MAX as f64) as i32;
        let entry = self
            .scene_layers
            .entry(layer_id.clone())
            .or_insert_with(|| SceneLayer::new(layer_id, z_index));
        entry.z_index = z_index;
        entry.opacity = number_at(command, &["opacity"])
            .unwrap_or(entry.opacity as f64)
            .clamp(0.0, 1.0) as f32;
        if let Some(blend_mode) = string_at(command, &["blend_mode"]) {
            entry.blend_code = blend_mode_code(&blend_mode);
        }
        if let Some(corners) = corners_at(command, &["corners"]) {
            entry.corners = corners;
        }
        if let Some(uv_transform) = vec4_path_at(command, &["uv_transform"]) {
            entry.uv0 = [
                uv_transform[0].clamp(-8.0, 8.0),
                uv_transform[1].clamp(-8.0, 8.0),
                uv_transform[2].clamp(-8.0, 8.0),
                uv_transform[3].clamp(-8.0, 8.0),
            ];
        }
        if let Some(uv_flags) = vec4_path_at(command, &["uv_flags"]) {
            entry.uv1 = [
                uv_flags[0].clamp(0.0, 2.0),
                uv_flags[1].clamp(0.001, 128.0),
                uv_flags[2].clamp(0.0, 1.0),
                uv_flags[3].clamp(0.0, 1.0),
            ];
        }
        if let Some(shape) = vec4_path_at(command, &["shape"]) {
            entry.shape = [
                shape[0].clamp(0.0, 2.0),
                shape[1].clamp(0.0, 1.0),
                shape[2].clamp(-std::f32::consts::TAU, std::f32::consts::TAU),
                shape[3].clamp(0.0001, 8.0),
            ];
        }
    }

    fn apply_layer_visibility(&mut self, command: &Value) {
        let Some(layer_id) = string_at(command, &["layer_id"]) else {
            return;
        };
        let visible = bool_at(command, &["visible"]).unwrap_or(true);
        let entry = self
            .scene_layers
            .entry(layer_id.clone())
            .or_insert_with(|| SceneLayer::new(layer_id, 0));
        entry.visible = visible;
    }

    fn apply_layer_color(&mut self, command: &Value) {
        let Some(layer_id) = string_at(command, &["layer_id"]) else {
            return;
        };
        let Some(rgba) = rgba_at(command, &["rgba"]) else {
            return;
        };
        let entry = self
            .scene_layers
            .entry(layer_id.clone())
            .or_insert_with(|| SceneLayer::new(layer_id, 0));
        entry.color = rgba;
        entry.source_kind = 1.0;
    }

    fn apply_layer_native_params(&mut self, command: &Value) {
        let Some(layer_id) = string_at(command, &["layer_id"]) else {
            return;
        };
        let Some(params) = params8_at(command, &["params"]) else {
            return;
        };
        let entry = self
            .scene_layers
            .entry(layer_id.clone())
            .or_insert_with(|| SceneLayer::new(layer_id, 0));
        entry.native_params = params;
    }

    fn apply_bind_isf_shader(&mut self, command: &Value) {
        let Some(layer_id) = string_at(command, &["layer_id"]) else {
            return;
        };
        let Some(shader_id) = string_at(command, &["shader_id"]) else {
            return;
        };
        self.isf_layer_bindings
            .insert(layer_id.clone(), shader_id.clone());
        let entry = self
            .scene_layers
            .entry(layer_id.clone())
            .or_insert_with(|| SceneLayer::new(layer_id, 0));
        entry.shader_id = Some(shader_id);
        entry.shader_rendered = false;
    }

    fn apply_isf_uniforms(&mut self, command: &Value) {
        let Some(shader_id) = string_at(command, &["shader_id"]) else {
            return;
        };
        let floats = command.get("float_inputs").unwrap_or(&Value::Null);
        let points = command.get("point_inputs").unwrap_or(&Value::Null);
        let colors = command.get("color_inputs").unwrap_or(&Value::Null);
        let input_count = json_object_len(floats)
            .saturating_add(json_object_len(points))
            .saturating_add(json_object_len(colors))
            .min(u32::MAX as usize) as u32;
        let audio = GhostAudioUniforms::from_isf_command(command);
        let state = IsfUniformState {
            shader_id: shader_id.clone(),
            time: number_at(command, &["time"])
                .unwrap_or(0.0)
                .clamp(0.0, 1.0e9) as f32,
            time_delta: number_at(command, &["time_delta"])
                .unwrap_or(1.0 / self.target_fps.max(1) as f64)
                .clamp(0.0, 10.0) as f32,
            frame_index: number_at(command, &["frame_index"])
                .unwrap_or(0.0)
                .round()
                .clamp(0.0, u64::MAX as f64) as u64,
            render_width: number_at(command, &["render_width"])
                .unwrap_or(self.pending_width as f64)
                .clamp(1.0, 65536.0) as f32,
            render_height: number_at(command, &["render_height"])
                .unwrap_or(self.pending_height as f64)
                .clamp(1.0, 65536.0) as f32,
            date: vec4_at(command, "date"),
            audio0: audio.audio0,
            audio1: audio.audio1,
            audio2: audio.audio2,
            float_hash: stable_hash64(&floats.to_string()),
            point_hash: stable_hash64(&points.to_string()),
            color_hash: stable_hash64(&colors.to_string()),
            input_count,
            seq: self.stats.commands_applied,
        };
        self.isf_uniforms.insert(shader_id, state);
    }

    fn apply_render_isf_to_layer(&mut self, command: &Value) {
        let Some(layer_id) = string_at(command, &["layer_id"]) else {
            return;
        };
        let shader_id = self.isf_layer_bindings.get(&layer_id).cloned().or_else(|| {
            self.scene_layers
                .get(&layer_id)
                .and_then(|layer| layer.shader_id.clone())
        });
        let Some(shader_id) = shader_id else {
            return;
        };
        let uniform_state = self.isf_uniforms.get(&shader_id).cloned();
        let params = uniform_state
            .as_ref()
            .map(|uniforms| uniforms.native_params(&shader_id))
            .unwrap_or_else(default_native_params);
        let input_source_slot = self
            .scene_layers
            .get(&layer_id)
            .and_then(|layer| {
                layer
                    .source_id
                    .as_deref()
                    .and_then(|source_id| self.source_frame_slots.get(source_id).copied())
                    .or(layer.frame_slot)
            })
            .unwrap_or(0);
        let shader_uniforms = NativeShaderUniforms::from_isf(
            &shader_id,
            uniform_state.as_ref(),
            self.pending_width,
            self.pending_height,
            params,
            input_source_slot,
        );
        let seq = uniform_state
            .as_ref()
            .map(|uniforms| uniforms.seq)
            .unwrap_or(self.stats.commands_applied);
        let native_shader = self.shader_registry.get(&shader_id).and_then(|record| {
            let source = self.shader_sources.get(&shader_id)?;
            native_fragment_entry(record, source).map(|entry| {
                let pipeline_key = native_shader_pipeline_key(record, &shader_id, &entry);
                (source.clone(), entry, record.source_hash, pipeline_key)
            })
        });
        let mut rendered_frame_slot = None;
        if let Some((source, fragment_entry, source_hash, pipeline_key)) = native_shader {
            let source_id = format!("native-shader:{layer_id}:{shader_id}:{source_hash:016x}");
            let slot = self.assign_source_frame_slot(&source_id);
            match self.renderer.as_mut() {
                Some(renderer) => {
                    match renderer.render_native_wgsl_shader_frame(
                        slot,
                        &pipeline_key,
                        &source,
                        &fragment_entry,
                        &shader_uniforms,
                    ) {
                        Ok(()) => {
                            self.source_frames.insert(source_id, SourceFrame { seq });
                            self.stats.pipeline_cache_entries =
                                renderer.native_shader_pipeline_count() as u64;
                            rendered_frame_slot = Some(slot);
                            self.last_shader_error = None;
                        }
                        Err(err) => {
                            self.last_shader_error = Some(format!("{shader_id}: {err}"));
                        }
                    }
                }
                None => {
                    self.last_shader_error = Some("native renderer is not ready".to_string());
                }
            }
        }
        let entry = self
            .scene_layers
            .entry(layer_id.clone())
            .or_insert_with(|| SceneLayer::new(layer_id, 0));
        entry.shader_id = Some(shader_id);
        entry.shader_rendered = true;
        entry.source_kind = NATIVE_SHADER_SOURCE_KIND;
        entry.frame_slot = rendered_frame_slot;
        entry.preview_slot = None;
        entry.native_params = params;
        if entry.color[3] <= 0.0 {
            entry.color = [0.45, 0.92, 1.0, 0.88];
        }
        self.stats.native_shader_renders = self.stats.native_shader_renders.saturating_add(1);
    }

    fn apply_effect_chain(&mut self, command: &Value) {
        let Some(layer_id) = string_at(command, &["layer_id"]) else {
            return;
        };
        let entry = self
            .scene_layers
            .entry(layer_id.clone())
            .or_insert_with(|| SceneLayer::new(layer_id, 0));
        entry.effects = [[0.0; 4]; 4];
        entry.effect_count = 0.0;
        let Some(ids) = command.get("effect_ids").and_then(Value::as_array) else {
            return;
        };
        let mut write_index = 0usize;
        for value in ids.iter().filter_map(Value::as_str) {
            if write_index >= entry.effects.len() {
                break;
            }
            if let Some(effect) = effect_descriptor_code(value) {
                entry.effects[write_index] = effect;
                write_index += 1;
                entry.effect_count += 1.0;
            }
        }
    }

    fn apply_audio_state(&mut self, command: &Value) {
        let audio = GhostAudioUniforms::from_command(command);
        self.audio0 = audio.audio0;
        self.audio1 = audio.audio1;
        self.audio2 = audio.audio2;
    }

    fn apply_media_source(&mut self, command: &Value) {
        let Some(layer_id) = string_at(command, &["layer_id"]) else {
            return;
        };
        let source_id = string_at(command, &["source_id"]);
        let source_type =
            string_at(command, &["source_type"]).unwrap_or_else(|| "none".to_string());
        let preview_slot = source_id
            .as_ref()
            .and_then(|id| self.source_preview_slots.get(id))
            .copied();
        let frame_slot = source_id
            .as_ref()
            .and_then(|id| self.source_frame_slots.get(id))
            .copied();
        let entry = self
            .scene_layers
            .entry(layer_id.clone())
            .or_insert_with(|| SceneLayer::new(layer_id.clone(), 0));
        entry.source_kind = source_kind(&source_type);
        entry.source_id = source_id;
        entry.preview_slot = preview_slot;
        entry.frame_slot = frame_slot;
        entry.shader_rendered = false;
        if source_type != "none" && entry.color[3] <= 0.0 {
            entry.color = stable_layer_color(&layer_id, 1.0);
        }
        if source_type != "color" {
            entry.color = source_type_color(&source_type, &layer_id);
        }
    }

    fn apply_source_preview(&mut self, command: &Value) {
        let Some(source_id) = string_at(command, &["source_id"]) else {
            return;
        };
        let seq = number_at(command, &["seq"]).unwrap_or(0.0).round().max(0.0) as u64;
        if let Some(existing) = self.source_previews.get(&source_id) {
            if seq < existing.seq {
                return;
            }
        }
        let width = number_at(command, &["width"])
            .unwrap_or(SOURCE_PREVIEW_SIZE as f64)
            .round()
            .clamp(1.0, 4096.0) as usize;
        let height = number_at(command, &["height"])
            .unwrap_or(SOURCE_PREVIEW_SIZE as f64)
            .round()
            .clamp(1.0, 4096.0) as usize;
        let Some(rgba) = command.get("rgba").and_then(Value::as_array) else {
            return;
        };
        if rgba.len() < width.saturating_mul(height).saturating_mul(4) {
            return;
        }

        let slot = self.assign_source_preview_slot(&source_id);
        let mut pixels = vec![PreviewPixel::zeroed(); SOURCE_PREVIEW_PIXELS];
        let scale_x = width as f32 / SOURCE_PREVIEW_SIZE as f32;
        let scale_y = height as f32 / SOURCE_PREVIEW_SIZE as f32;
        for y in 0..SOURCE_PREVIEW_SIZE {
            let sy = ((y as f32 + 0.5) * scale_y - 0.5).clamp(0.0, (height - 1) as f32);
            for x in 0..SOURCE_PREVIEW_SIZE {
                let dst_index = y * SOURCE_PREVIEW_SIZE + x;
                let sx = ((x as f32 + 0.5) * scale_x - 0.5).clamp(0.0, (width - 1) as f32);
                pixels[dst_index] = resample_preview_pixel(rgba, width, height, sx, sy);
            }
        }

        self.source_previews
            .insert(source_id.clone(), SourcePreview { slot, seq, pixels });
        self.source_preview_dirty = true;
        for layer in self.scene_layers.values_mut() {
            if layer.source_id.as_deref() == Some(source_id.as_str()) {
                layer.preview_slot = Some(slot);
            }
        }
    }

    fn apply_source_frame(&mut self, command: &Value) {
        let Some(source_id) = string_at(command, &["source_id"]) else {
            return;
        };
        let seq = number_at(command, &["seq"]).unwrap_or(0.0).round().max(0.0) as u64;
        if let Some(existing) = self.source_frames.get(&source_id) {
            if seq < existing.seq {
                return;
            }
        }
        let width = number_at(command, &["width"])
            .unwrap_or(SOURCE_FRAME_SIZE_DEFAULT as f64)
            .round()
            .clamp(1.0, SOURCE_FRAME_SIZE_INSANE as f64) as usize;
        let height = number_at(command, &["height"])
            .unwrap_or(SOURCE_FRAME_SIZE_DEFAULT as f64)
            .round()
            .clamp(1.0, SOURCE_FRAME_SIZE_INSANE as f64) as usize;
        let transport = source_frame_transport_from_command(command);
        if transport == SourceFrameTransport::SharedTexture {
            self.apply_shared_texture_source_frame(source_id, seq, command, width, height);
            return;
        }
        let Some(rgba) = rgba_bytes_from_command(command, width, height) else {
            self.reject_source_frame_upload(
                width,
                height,
                transport.as_str(),
                "missing or invalid source-frame pixel payload",
            );
            return;
        };
        let input_byte_len = rgba.len() as u64;

        let slot = self.assign_source_frame_slot(&source_id);
        let dst_size = self
            .renderer
            .as_ref()
            .map(|renderer| renderer.source_frame_size)
            .unwrap_or(SOURCE_FRAME_SIZE_DEFAULT);
        let pixels = resample_frame_bytes(&rgba, width, height, dst_size, dst_size);
        if let Some(renderer) = self.renderer.as_ref() {
            renderer.write_source_frame(slot, &pixels);
        }
        self.stats.source_frame_uploads = self.stats.source_frame_uploads.saturating_add(1);
        self.stats.source_frame_bytes_uploaded = self
            .stats
            .source_frame_bytes_uploaded
            .saturating_add(pixels.len() as u64);
        self.stats.source_frame_input_bytes_uploaded = self
            .stats
            .source_frame_input_bytes_uploaded
            .saturating_add(input_byte_len);
        self.stats.source_frame_resampled_bytes_uploaded = self
            .stats
            .source_frame_resampled_bytes_uploaded
            .saturating_add(pixels.len() as u64);
        if transport.is_cpu_fallback() {
            self.stats.source_frame_cpu_fallback_uploads = self
                .stats
                .source_frame_cpu_fallback_uploads
                .saturating_add(1);
        }
        match transport {
            SourceFrameTransport::File => {
                self.stats.source_frame_file_uploads =
                    self.stats.source_frame_file_uploads.saturating_add(1);
            }
            SourceFrameTransport::Base64 => {
                self.stats.source_frame_base64_uploads =
                    self.stats.source_frame_base64_uploads.saturating_add(1);
            }
            SourceFrameTransport::Json => {
                self.stats.source_frame_json_uploads =
                    self.stats.source_frame_json_uploads.saturating_add(1);
            }
            SourceFrameTransport::SharedTexture => {
                self.stats.source_frame_shared_texture_uploads = self
                    .stats
                    .source_frame_shared_texture_uploads
                    .saturating_add(1);
            }
            SourceFrameTransport::Unknown => {}
        }
        self.stats.source_frame_last_input_bytes = input_byte_len;
        self.stats.source_frame_last_upload_bytes = pixels.len() as u64;
        self.stats.source_frame_last_upload_width = width.min(u32::MAX as usize) as u32;
        self.stats.source_frame_last_upload_height = height.min(u32::MAX as usize) as u32;
        self.stats.source_frame_last_upload_transport = transport.as_str().to_string();
        self.stats.source_frame_last_reject_reason.clear();
        self.source_frames
            .insert(source_id.clone(), SourceFrame { seq });
        for layer in self.scene_layers.values_mut() {
            if layer.source_id.as_deref() == Some(source_id.as_str()) {
                layer.frame_slot = Some(slot);
            }
        }
    }

    fn apply_shared_texture_source_frame(
        &mut self,
        source_id: String,
        seq: u64,
        command: &Value,
        width: usize,
        height: usize,
    ) {
        let Some(descriptor) =
            SharedTextureSourceFrameDescriptor::from_command(command, width, height)
        else {
            self.reject_shared_texture_source_frame(
                width,
                height,
                "shared texture source-frame upload is not implemented yet (missing shared texture handle)",
            );
            return;
        };

        if self.renderer.is_none() {
            let reason = format!(
                "{}; native renderer is not running",
                descriptor.unsupported_reason(native_backend_name())
            );
            self.reject_shared_texture_source_frame(width, height, &reason);
            return;
        }

        let slot = self.assign_source_frame_slot(&source_id);
        let renderer = self
            .renderer
            .as_ref()
            .expect("renderer checked before shared texture import");
        let uploaded_bytes = match renderer.import_shared_texture_source_frame(slot, &descriptor) {
            Ok(uploaded_bytes) => uploaded_bytes,
            Err(err) => {
                self.source_frame_slots.remove(&source_id);
                self.reject_shared_texture_source_frame(width, height, &err);
                return;
            }
        };

        self.stats.source_frame_uploads = self.stats.source_frame_uploads.saturating_add(1);
        self.stats.source_frame_shared_texture_uploads = self
            .stats
            .source_frame_shared_texture_uploads
            .saturating_add(1);
        self.stats.source_frame_bytes_uploaded = self
            .stats
            .source_frame_bytes_uploaded
            .saturating_add(uploaded_bytes);
        self.stats.source_frame_resampled_bytes_uploaded = self
            .stats
            .source_frame_resampled_bytes_uploaded
            .saturating_add(uploaded_bytes);
        self.stats.source_frame_last_input_bytes = descriptor.handle_byte_length.unwrap_or(0);
        self.stats.source_frame_last_upload_bytes = uploaded_bytes;
        self.stats.source_frame_last_upload_width = descriptor.width;
        self.stats.source_frame_last_upload_height = descriptor.height;
        self.stats.source_frame_last_upload_transport = "shared-texture".to_string();
        self.stats.source_frame_last_reject_reason.clear();
        self.source_frames
            .insert(source_id.clone(), SourceFrame { seq });
        for layer in self.scene_layers.values_mut() {
            if layer.source_id.as_deref() == Some(source_id.as_str()) {
                layer.frame_slot = Some(slot);
            }
        }
    }

    fn reject_shared_texture_source_frame(&mut self, width: usize, height: usize, reason: &str) {
        self.stats.source_frame_shared_texture_rejected_uploads = self
            .stats
            .source_frame_shared_texture_rejected_uploads
            .saturating_add(1);
        self.reject_source_frame_upload(width, height, "shared-texture-unsupported", reason);
    }

    fn reject_source_frame_upload(
        &mut self,
        width: usize,
        height: usize,
        transport: &str,
        reason: &str,
    ) {
        self.stats.source_frame_rejected_uploads =
            self.stats.source_frame_rejected_uploads.saturating_add(1);
        self.stats.source_frame_last_input_bytes = 0;
        self.stats.source_frame_last_upload_bytes = 0;
        self.stats.source_frame_last_upload_width = width.min(u32::MAX as usize) as u32;
        self.stats.source_frame_last_upload_height = height.min(u32::MAX as usize) as u32;
        self.stats.source_frame_last_upload_transport = transport.to_string();
        self.stats.source_frame_last_reject_reason = reason.to_string();
    }

    fn assign_source_preview_slot(&mut self, source_id: &str) -> usize {
        if let Some(slot) = self.source_preview_slots.get(source_id).copied() {
            return slot;
        }
        let used: std::collections::HashSet<usize> =
            self.source_preview_slots.values().copied().collect();
        let slot = (0..MAX_SOURCE_PREVIEWS)
            .find(|candidate| !used.contains(candidate))
            .unwrap_or_else(|| stable_slot(source_id, MAX_SOURCE_PREVIEWS));
        if let Some(old_source_id) =
            self.source_preview_slots
                .iter()
                .find_map(|(id, existing_slot)| {
                    if *existing_slot == slot && id != source_id {
                        Some(id.clone())
                    } else {
                        None
                    }
                })
        {
            self.source_preview_slots.remove(&old_source_id);
            self.source_previews.remove(&old_source_id);
            for layer in self.scene_layers.values_mut() {
                if layer.source_id.as_deref() == Some(old_source_id.as_str()) {
                    layer.preview_slot = None;
                }
            }
        }
        self.source_preview_slots
            .insert(source_id.to_string(), slot);
        slot
    }

    fn assign_source_frame_slot(&mut self, source_id: &str) -> usize {
        if let Some(slot) = self.source_frame_slots.get(source_id).copied() {
            return slot;
        }
        let used: std::collections::HashSet<usize> =
            self.source_frame_slots.values().copied().collect();
        if let Some(slot) = (0..MAX_SOURCE_FRAME_SLOTS).find(|slot| !used.contains(slot)) {
            self.source_frame_slots.insert(source_id.to_string(), slot);
            return slot;
        }

        let slot = stable_slot(source_id, MAX_SOURCE_FRAME_SLOTS);
        if let Some(old_source_id) =
            self.source_frame_slots
                .iter()
                .find_map(|(id, existing_slot)| {
                    if *existing_slot == slot {
                        Some(id.clone())
                    } else {
                        None
                    }
                })
        {
            self.source_frame_slots.remove(&old_source_id);
            self.source_frames.remove(&old_source_id);
            for layer in self.scene_layers.values_mut() {
                if layer.source_id.as_deref() == Some(old_source_id.as_str()) {
                    layer.frame_slot = None;
                }
            }
        }
        self.source_frame_slots.insert(source_id.to_string(), slot);
        slot
    }

    fn apply_remove_layer(&mut self, command: &Value) {
        if let Some(layer_id) = string_at(command, &["layer_id"]) {
            self.scene_layers.remove(&layer_id);
            self.isf_layer_bindings.remove(&layer_id);
        }
    }

    fn gpu_layer_data(&self) -> Vec<LayerGpu> {
        let mut layers: Vec<&SceneLayer> = self.scene_layers.values().collect();
        // Editor layer index 0 is visually top-most, so send larger z first
        // and let z=0 blend last.
        layers.sort_by(|a, b| b.z_index.cmp(&a.z_index).then_with(|| a.id.cmp(&b.id)));
        layers
            .into_iter()
            .take(MAX_SCENE_LAYERS)
            .map(SceneLayer::gpu)
            .collect()
    }

    fn source_preview_pixel_data(&self) -> Vec<PreviewPixel> {
        let mut pixels = vec![PreviewPixel::zeroed(); MAX_SOURCE_PREVIEWS * SOURCE_PREVIEW_PIXELS];
        for preview in self.source_previews.values() {
            let slot = preview.slot.min(MAX_SOURCE_PREVIEWS - 1);
            let offset = slot * SOURCE_PREVIEW_PIXELS;
            let end = offset + SOURCE_PREVIEW_PIXELS;
            pixels[offset..end].copy_from_slice(&preview.pixels[..SOURCE_PREVIEW_PIXELS]);
        }
        pixels
    }
}

impl ApplicationHandler<UserEvent> for App {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        event_loop.set_control_flow(ControlFlow::Wait);
        if let Err(err) = self.ensure_renderer(event_loop) {
            eprintln!("[GhostRenderCore] failed to initialize renderer: {err}");
        }
    }

    fn user_event(&mut self, event_loop: &ActiveEventLoop, event: UserEvent) {
        match event {
            UserEvent::Rpc(req) => self.handle_rpc(event_loop, req),
        }
    }

    fn window_event(
        &mut self,
        event_loop: &ActiveEventLoop,
        window_id: WindowId,
        event: WindowEvent,
    ) {
        let Some(renderer) = self.renderer.as_mut() else {
            return;
        };
        if renderer.window.id() != window_id {
            return;
        }
        match event {
            WindowEvent::CloseRequested => {
                self.running = false;
                event_loop.exit();
            }
            WindowEvent::Resized(size) => {
                renderer.resize(size);
                self.pending_width = size.width.max(1);
                self.pending_height = size.height.max(1);
            }
            WindowEvent::RedrawRequested => self.render(),
            _ => {}
        }
    }

    fn about_to_wait(&mut self, event_loop: &ActiveEventLoop) {
        if !self.running {
            event_loop.set_control_flow(ControlFlow::Wait);
            return;
        }

        let frame_duration = self.frame_duration();
        let next_frame_at = self.last_redraw + frame_duration;
        let now = Instant::now();
        if now >= next_frame_at {
            if let Some(renderer) = self.renderer.as_ref() {
                renderer.window.request_redraw();
            }
            self.last_redraw = now;
            event_loop.set_control_flow(ControlFlow::WaitUntil(now + frame_duration));
        } else {
            event_loop.set_control_flow(ControlFlow::WaitUntil(next_frame_at));
        }
    }
}

impl RenderState {
    async fn new(
        window: &'static Window,
        width: u32,
        height: u32,
        present_mode: &str,
        allow_tearing: bool,
        max_frame_latency: u32,
    ) -> Result<Self, String> {
        let instance = wgpu::Instance::default();
        let surface = instance
            .create_surface(window)
            .map_err(|err| err.to_string())?;
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                force_fallback_adapter: false,
                compatible_surface: Some(&surface),
                apply_limit_buckets: false,
            })
            .await
            .map_err(|err| err.to_string())?;
        let adapter_info = adapter.get_info();
        let adapter_limits = adapter.limits();
        let adapter_features = adapter.features();
        let source_frame_format = choose_source_frame_format(&adapter);
        let source_frame_size =
            choose_source_frame_size(&adapter_limits, adapter_features, source_frame_format);
        let source_frame_mip_levels = source_frame_mip_levels(source_frame_size);
        let requested_features = adapter_features.intersection(native_optional_features());
        let native_caps = native_gpu_caps(
            &adapter_info,
            &adapter_limits,
            adapter_features,
            requested_features,
        );
        let (device, queue) = adapter
            .request_device(&wgpu::DeviceDescriptor {
                label: Some("Ghost Render Core Device"),
                required_features: requested_features,
                required_limits: wgpu::Limits::default(),
                experimental_features: wgpu::ExperimentalFeatures::disabled(),
                memory_hints: wgpu::MemoryHints::Performance,
                trace: wgpu::Trace::Off,
            })
            .await
            .map_err(|err| err.to_string())?;

        let caps = surface.get_capabilities(&adapter);
        let format = caps
            .formats
            .iter()
            .copied()
            .find(|format| format.is_srgb())
            .unwrap_or(caps.formats[0]);
        let supported_present_modes = caps.present_modes.clone();
        let present_mode =
            choose_present_mode(&supported_present_modes, present_mode, allow_tearing);
        let config = wgpu::SurfaceConfiguration {
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            format,
            color_space: wgpu::SurfaceColorSpace::Auto,
            width: width.max(1),
            height: height.max(1),
            present_mode,
            desired_maximum_frame_latency: max_frame_latency.clamp(1, 8),
            alpha_mode: caps.alpha_modes[0],
            view_formats: vec![],
        };
        surface.configure(&device, &config);

        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("Ghost Render Core Heartbeat"),
            source: wgpu::ShaderSource::Wgsl(include_str!("heartbeat.wgsl").into()),
        });
        let native_instrument_shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("Ghost Render Core Native Instruments"),
            source: wgpu::ShaderSource::Wgsl(include_str!("native_instruments.wgsl").into()),
        });
        let native_shader_vertex_module =
            device.create_shader_module(wgpu::ShaderModuleDescriptor {
                label: Some("Ghost Render Core Native Shader Fullscreen Vertex"),
                source: wgpu::ShaderSource::Wgsl(NATIVE_SHADER_FULLSCREEN_VERTEX_WGSL.into()),
            });
        let uniform_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("Ghost Render Core Uniforms"),
            contents: bytemuck::bytes_of(&Uniforms {
                resolution: [config.width as f32, config.height as f32],
                time: 0.0,
                command_phase: 0.0,
                layer_count: 0.0,
                frame_count: 0.0,
                _pad0: [0.0, 0.0],
                audio0: [0.0; 4],
                audio1: [0.0; 4],
                audio2: [0.0; 4],
            }),
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        });
        let native_instrument_uniform_buffer =
            device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("Ghost Render Core Native Instrument Uniforms"),
                contents: bytemuck::bytes_of(&NativeInstrumentUniforms::zeroed()),
                usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            });
        let native_shader_uniform_buffer =
            device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("Ghost Render Core Native Shader Uniforms"),
                contents: bytemuck::bytes_of(&NativeShaderUniforms::zeroed()),
                usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            });
        let empty_layers = vec![LayerGpu::zeroed(); MAX_SCENE_LAYERS];
        let layer_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("Ghost Render Core Scene Layers"),
            contents: bytemuck::cast_slice(&empty_layers),
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
        });
        let empty_previews =
            vec![PreviewPixel::zeroed(); MAX_SOURCE_PREVIEWS * SOURCE_PREVIEW_PIXELS];
        let source_preview_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("Ghost Render Core Source Previews"),
            contents: bytemuck::cast_slice(&empty_previews),
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
        });
        let source_frame_texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("Ghost Render Core Source Frames"),
            size: wgpu::Extent3d {
                width: source_frame_size as u32,
                height: source_frame_size as u32,
                depth_or_array_layers: MAX_SOURCE_FRAME_SLOTS as u32,
            },
            mip_level_count: source_frame_mip_levels,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: source_frame_format,
            usage: wgpu::TextureUsages::TEXTURE_BINDING
                | wgpu::TextureUsages::COPY_DST
                | wgpu::TextureUsages::COPY_SRC
                | wgpu::TextureUsages::RENDER_ATTACHMENT,
            view_formats: &[],
        });
        let source_frame_view = source_frame_texture.create_view(&wgpu::TextureViewDescriptor {
            label: Some("Ghost Render Core Source Frame View"),
            dimension: Some(wgpu::TextureViewDimension::D2Array),
            ..Default::default()
        });
        let source_frame_sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("Ghost Render Core Source Frame Sampler"),
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            address_mode_w: wgpu::AddressMode::ClampToEdge,
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            mipmap_filter: wgpu::MipmapFilterMode::Linear,
            ..Default::default()
        });
        let source_frame_blitter = TextureBlitterBuilder::new(&device, source_frame_format)
            .sample_type(wgpu::FilterMode::Linear)
            .build();
        let (snapshot_texture, snapshot_view) =
            Self::create_snapshot_target(&device, config.width, config.height, format);
        let bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("Ghost Render Core Bind Group Layout"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Storage { read_only: true },
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 2,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Storage { read_only: true },
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 3,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: true },
                        view_dimension: wgpu::TextureViewDimension::D2Array,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 4,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    count: None,
                },
            ],
        });
        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Ghost Render Core Bind Group"),
            layout: &bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: uniform_buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: layer_buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: source_preview_buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 3,
                    resource: wgpu::BindingResource::TextureView(&source_frame_view),
                },
                wgpu::BindGroupEntry {
                    binding: 4,
                    resource: wgpu::BindingResource::Sampler(&source_frame_sampler),
                },
            ],
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Ghost Render Core Pipeline Layout"),
            bind_group_layouts: &[Some(&bind_group_layout)],
            immediate_size: 0,
        });
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("Ghost Render Core Pipeline"),
            layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs_main"),
                compilation_options: wgpu::PipelineCompilationOptions::default(),
                buffers: &[],
            },
            primitive: wgpu::PrimitiveState::default(),
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fs_main"),
                compilation_options: wgpu::PipelineCompilationOptions::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format,
                    blend: Some(wgpu::BlendState::REPLACE),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            multiview_mask: None,
            cache: None,
        });

        let native_instrument_bind_group_layout =
            device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("Ghost Render Core Native Instrument Bind Group Layout"),
                entries: &[wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                }],
            });
        let native_instrument_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Ghost Render Core Native Instrument Bind Group"),
            layout: &native_instrument_bind_group_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: native_instrument_uniform_buffer.as_entire_binding(),
            }],
        });
        let native_shader_input_texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("Ghost Render Core Native Shader Input Frames"),
            size: wgpu::Extent3d {
                width: source_frame_size as u32,
                height: source_frame_size as u32,
                depth_or_array_layers: MAX_SOURCE_FRAME_SLOTS as u32,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: source_frame_format,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });
        let native_shader_input_view =
            native_shader_input_texture.create_view(&wgpu::TextureViewDescriptor {
                label: Some("Ghost Render Core Native Shader Input Frame View"),
                dimension: Some(wgpu::TextureViewDimension::D2Array),
                ..Default::default()
            });
        let native_shader_bind_group_layout =
            device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("Ghost Render Core Native Shader Bind Group Layout"),
                entries: &[
                    wgpu::BindGroupLayoutEntry {
                        binding: 0,
                        visibility: wgpu::ShaderStages::FRAGMENT,
                        ty: wgpu::BindingType::Buffer {
                            ty: wgpu::BufferBindingType::Uniform,
                            has_dynamic_offset: false,
                            min_binding_size: None,
                        },
                        count: None,
                    },
                    wgpu::BindGroupLayoutEntry {
                        binding: 1,
                        visibility: wgpu::ShaderStages::FRAGMENT,
                        ty: wgpu::BindingType::Texture {
                            sample_type: wgpu::TextureSampleType::Float { filterable: true },
                            view_dimension: wgpu::TextureViewDimension::D2Array,
                            multisampled: false,
                        },
                        count: None,
                    },
                    wgpu::BindGroupLayoutEntry {
                        binding: 2,
                        visibility: wgpu::ShaderStages::FRAGMENT,
                        ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                        count: None,
                    },
                ],
            });
        let native_shader_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Ghost Render Core Native Shader Bind Group"),
            layout: &native_shader_bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: native_shader_uniform_buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::TextureView(&native_shader_input_view),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: wgpu::BindingResource::Sampler(&source_frame_sampler),
                },
            ],
        });
        let native_instrument_pipeline_layout =
            device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some("Ghost Render Core Native Instrument Pipeline Layout"),
                bind_group_layouts: &[Some(&native_instrument_bind_group_layout)],
                immediate_size: 0,
            });
        let native_instrument_pipeline =
            device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some("Ghost Render Core Native Instrument Pipeline"),
                layout: Some(&native_instrument_pipeline_layout),
                vertex: wgpu::VertexState {
                    module: &native_instrument_shader,
                    entry_point: Some("vs_main"),
                    compilation_options: wgpu::PipelineCompilationOptions::default(),
                    buffers: &[],
                },
                primitive: wgpu::PrimitiveState::default(),
                depth_stencil: None,
                multisample: wgpu::MultisampleState::default(),
                fragment: Some(wgpu::FragmentState {
                    module: &native_instrument_shader,
                    entry_point: Some("fs_main"),
                    compilation_options: wgpu::PipelineCompilationOptions::default(),
                    targets: &[Some(wgpu::ColorTargetState {
                        format: source_frame_format,
                        blend: None,
                        write_mask: wgpu::ColorWrites::ALL,
                    })],
                }),
                multiview_mask: None,
                cache: None,
            });

        window.set_title(&format!("Ghost Render Core N0 - {}", adapter_info.name));
        let gpu_timing = requested_features
            .contains(wgpu::Features::TIMESTAMP_QUERY)
            .then(|| GpuTimingState::new(&device, &queue));

        Ok(Self {
            window,
            adapter_name: adapter_info.name,
            native_caps,
            surface,
            device,
            queue,
            config,
            supported_present_modes,
            pipeline,
            native_instrument_pipeline,
            uniform_buffer,
            native_instrument_uniform_buffer,
            native_shader_uniform_buffer,
            layer_buffer,
            source_preview_buffer,
            source_frame_texture,
            source_frame_sampler,
            native_shader_input_texture,
            source_frame_size,
            source_frame_format,
            source_frame_mip_levels,
            source_frame_blitter,
            native_shader_vertex_module,
            native_shader_bind_group_layout,
            native_shader_bind_group,
            native_shader_pipelines: HashMap::new(),
            native_compute_pipelines: HashMap::new(),
            native_graph_render_pipelines: HashMap::new(),
            native_compute_graph_buffers: HashMap::new(),
            snapshot_texture,
            snapshot_view,
            last_frame_metrics: None,
            bind_group,
            native_instrument_bind_group,
            start_time: Instant::now(),
            gpu_timing,
            last_frame_error: None,
        })
    }

    fn adapter_name(&self) -> Option<String> {
        Some(self.adapter_name.clone())
    }

    fn create_snapshot_target(
        device: &wgpu::Device,
        width: u32,
        height: u32,
        format: wgpu::TextureFormat,
    ) -> (wgpu::Texture, wgpu::TextureView) {
        let texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("Ghost Render Core Snapshot Mirror"),
            size: wgpu::Extent3d {
                width: width.max(1),
                height: height.max(1),
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let view = texture.create_view(&wgpu::TextureViewDescriptor {
            label: Some("Ghost Render Core Snapshot Mirror View"),
            ..Default::default()
        });
        (texture, view)
    }

    fn poll_gpu_timing(&mut self) {
        if self.gpu_timing.is_none() {
            return;
        }
        let _ = self.device.poll(wgpu::PollType::Poll);
        if let Some(gpu_timing) = self.gpu_timing.as_mut() {
            gpu_timing.poll_readback();
        }
    }

    fn last_render_gpu_ms(&self) -> Option<f64> {
        self.gpu_timing.as_ref().and_then(|timing| {
            (timing.last_render_gpu_ms > 0.0).then_some(timing.last_render_gpu_ms)
        })
    }

    fn gpu_timing_stats(&self) -> (bool, f64, f64, f64, u64, u64) {
        self.gpu_timing
            .as_ref()
            .map(|timing| {
                (
                    true,
                    timing.last_render_gpu_ms,
                    timing.avg_render_gpu_ms,
                    timing.max_render_gpu_ms,
                    timing.samples,
                    timing.resolve_misses,
                )
            })
            .unwrap_or((false, 0.0, 0.0, 0.0, 0, 0))
    }

    fn native_shader_pipeline_count(&self) -> u32 {
        self.native_shader_pipelines.len().min(u32::MAX as usize) as u32
    }

    fn native_pipeline_cache_count(&self) -> u32 {
        self.native_shader_pipelines
            .len()
            .saturating_add(self.native_compute_pipelines.len())
            .saturating_add(self.native_graph_render_pipelines.len())
            .min(u32::MAX as usize) as u32
    }

    fn present_mode_label(&self) -> String {
        present_mode_label(self.config.present_mode).to_string()
    }

    fn supports_tearing(&self) -> bool {
        self.supported_present_modes.iter().any(|mode| {
            matches!(
                mode,
                wgpu::PresentMode::Immediate | wgpu::PresentMode::FifoRelaxed
            )
        })
    }

    fn tearing_active(&self) -> bool {
        matches!(
            self.config.present_mode,
            wgpu::PresentMode::Immediate | wgpu::PresentMode::FifoRelaxed
        )
    }

    fn set_present_policy(
        &mut self,
        present_mode: &str,
        allow_tearing: bool,
        max_frame_latency: u32,
    ) {
        self.config.present_mode =
            choose_present_mode(&self.supported_present_modes, present_mode, allow_tearing);
        self.config.desired_maximum_frame_latency = max_frame_latency.clamp(1, 8);
        self.surface.configure(&self.device, &self.config);
    }

    fn resize(&mut self, size: PhysicalSize<u32>) {
        if size.width == 0 || size.height == 0 {
            return;
        }
        self.config.width = size.width;
        self.config.height = size.height;
        self.surface.configure(&self.device, &self.config);
        let (snapshot_texture, snapshot_view) = Self::create_snapshot_target(
            &self.device,
            self.config.width,
            self.config.height,
            self.config.format,
        );
        self.snapshot_texture = snapshot_texture;
        self.snapshot_view = snapshot_view;
    }

    fn render_native_instrument_frames(
        &mut self,
        tasks: &[NativeInstrumentTask],
        time_seconds: Option<f32>,
        _frame_count: u64,
        audio0: [f32; 4],
        audio1: [f32; 4],
        audio2: [f32; 4],
    ) -> Result<usize, String> {
        if tasks.is_empty() {
            return Ok(0);
        }
        let time = time_seconds.unwrap_or_else(|| self.start_time.elapsed().as_secs_f32());
        let mut rendered = 0usize;
        for task in tasks.iter().take(MAX_SOURCE_FRAME_SLOTS) {
            let safe_slot = task.slot.min(MAX_SOURCE_FRAME_SLOTS - 1);
            let uniforms = NativeInstrumentUniforms {
                resolution: [self.source_frame_size as f32, self.source_frame_size as f32],
                time,
                source_kind: task.source_kind,
                params0: task.params0,
                params1: task.params1,
                audio0,
                audio1,
                audio2,
                seed: task.seed,
                _pad0: [0.0; 7],
            };
            self.queue.write_buffer(
                &self.native_instrument_uniform_buffer,
                0,
                bytemuck::bytes_of(&uniforms),
            );
            let view = self
                .source_frame_texture
                .create_view(&wgpu::TextureViewDescriptor {
                    label: Some("Ghost Render Core Native Instrument Source Frame View"),
                    format: Some(self.source_frame_format),
                    dimension: Some(wgpu::TextureViewDimension::D2),
                    base_mip_level: 0,
                    mip_level_count: Some(1),
                    base_array_layer: safe_slot as u32,
                    array_layer_count: Some(1),
                    ..Default::default()
                });
            let mut encoder = self
                .device
                .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                    label: Some("Ghost Render Core Native Instrument Encoder"),
                });
            {
                let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                    label: Some("Ghost Render Core Native Instrument Pass"),
                    color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                        view: &view,
                        resolve_target: None,
                        ops: wgpu::Operations {
                            load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                            store: wgpu::StoreOp::Store,
                        },
                        depth_slice: None,
                    })],
                    depth_stencil_attachment: None,
                    timestamp_writes: None,
                    occlusion_query_set: None,
                    multiview_mask: None,
                });
                pass.set_pipeline(&self.native_instrument_pipeline);
                pass.set_bind_group(0, &self.native_instrument_bind_group, &[]);
                pass.draw(0..3, 0..1);
            }
            self.generate_source_frame_mips(&mut encoder, safe_slot);
            self.queue.submit(Some(encoder.finish()));
            rendered += 1;
        }
        self.last_frame_error = None;
        Ok(rendered)
    }

    fn ensure_native_shader_pipeline(
        &mut self,
        cache_key: &str,
        source: &str,
        fragment_entry: &str,
    ) -> Result<(), String> {
        if self.native_shader_pipelines.contains_key(cache_key) {
            return Ok(());
        }
        let error_scope = self.device.push_error_scope(wgpu::ErrorFilter::Validation);
        let shader = self
            .device
            .create_shader_module(wgpu::ShaderModuleDescriptor {
                label: Some("Ghost Render Core Native Shader Fragment"),
                source: wgpu::ShaderSource::Wgsl(source.into()),
            });
        let pipeline_layout = self
            .device
            .create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some("Ghost Render Core Native Shader Pipeline Layout"),
                bind_group_layouts: &[Some(&self.native_shader_bind_group_layout)],
                immediate_size: 0,
            });
        let pipeline = self
            .device
            .create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some("Ghost Render Core Native Shader Pipeline"),
                layout: Some(&pipeline_layout),
                vertex: wgpu::VertexState {
                    module: &self.native_shader_vertex_module,
                    entry_point: Some("vs_main"),
                    compilation_options: wgpu::PipelineCompilationOptions::default(),
                    buffers: &[],
                },
                primitive: wgpu::PrimitiveState::default(),
                depth_stencil: None,
                multisample: wgpu::MultisampleState::default(),
                fragment: Some(wgpu::FragmentState {
                    module: &shader,
                    entry_point: Some(fragment_entry),
                    compilation_options: wgpu::PipelineCompilationOptions::default(),
                    targets: &[Some(wgpu::ColorTargetState {
                        format: self.source_frame_format,
                        blend: None,
                        write_mask: wgpu::ColorWrites::ALL,
                    })],
                }),
                multiview_mask: None,
                cache: None,
            });
        let error_future = error_scope.pop();
        let _ = self.device.poll(wgpu::PollType::Poll);
        if let Some(err) = pollster::block_on(error_future) {
            return Err(err.to_string());
        }
        self.native_shader_pipelines
            .insert(cache_key.to_string(), NativeShaderPipeline { pipeline });
        Ok(())
    }

    fn ensure_native_compute_pipeline(
        &mut self,
        cache_key: &str,
        source: &str,
        compute_entry: &str,
        layout_specs: &[NativeComputeBindingLayoutSpec],
    ) -> Result<(), String> {
        if self.native_compute_pipelines.contains_key(cache_key) {
            return Ok(());
        }
        if layout_specs.is_empty() {
            return Err(format!(
                "native compute pipeline `{cache_key}` has no bindings"
            ));
        }
        let error_scope = self.device.push_error_scope(wgpu::ErrorFilter::Validation);
        let shader = self
            .device
            .create_shader_module(wgpu::ShaderModuleDescriptor {
                label: Some("Ghost Render Core Native Compute Shader"),
                source: wgpu::ShaderSource::Wgsl(source.into()),
            });
        let layout_entries = layout_specs
            .iter()
            .map(|spec| wgpu::BindGroupLayoutEntry {
                binding: spec.binding,
                visibility: wgpu::ShaderStages::COMPUTE,
                ty: spec.kind.binding_type(),
                count: None,
            })
            .collect::<Vec<_>>();
        let bind_group_layout =
            self.device
                .create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                    label: Some("Ghost Render Core Native Compute Layout"),
                    entries: &layout_entries,
                });
        let pipeline_layout = self
            .device
            .create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some("Ghost Render Core Native Compute Probe Pipeline Layout"),
                bind_group_layouts: &[Some(&bind_group_layout)],
                immediate_size: 0,
            });
        let pipeline = self
            .device
            .create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
                label: Some("Ghost Render Core Native Compute Probe Pipeline"),
                layout: Some(&pipeline_layout),
                module: &shader,
                entry_point: Some(compute_entry),
                compilation_options: wgpu::PipelineCompilationOptions::default(),
                cache: None,
            });
        let error_future = error_scope.pop();
        let _ = self.device.poll(wgpu::PollType::Poll);
        if let Some(err) = pollster::block_on(error_future) {
            return Err(err.to_string());
        }
        self.native_compute_pipelines.insert(
            cache_key.to_string(),
            NativeComputePipeline {
                pipeline,
                bind_group_layout,
            },
        );
        Ok(())
    }

    fn run_native_compute_probe(
        &mut self,
        cache_key: &str,
        source: &str,
        compute_entry: &str,
        uniforms: ComputeProbeUniforms,
    ) -> Result<ComputeProbeResult, String> {
        self.ensure_native_compute_pipeline(
            cache_key,
            source,
            compute_entry,
            &[
                NativeComputeBindingLayoutSpec {
                    binding: 0,
                    kind: NativeComputeGraphBindingKind::Buffer(
                        NativeComputeBufferBindingKind::StorageReadWrite,
                    ),
                },
                NativeComputeBindingLayoutSpec {
                    binding: 1,
                    kind: NativeComputeGraphBindingKind::Buffer(
                        NativeComputeBufferBindingKind::Uniform,
                    ),
                },
            ],
        )?;
        let element_count = uniforms.element_count.max(1);
        let byte_length = element_count as u64 * std::mem::size_of::<u32>() as u64;
        let storage_buffer = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Ghost Render Core Native Compute Probe Storage"),
            size: byte_length,
            usage: wgpu::BufferUsages::STORAGE
                | wgpu::BufferUsages::COPY_SRC
                | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let uniform_buffer = self
            .device
            .create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("Ghost Render Core Native Compute Probe Uniforms"),
                contents: bytemuck::bytes_of(&uniforms),
                usage: wgpu::BufferUsages::UNIFORM,
            });
        let readback_buffer = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Ghost Render Core Native Compute Probe Readback"),
            size: byte_length,
            usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let Some(cached) = self.native_compute_pipelines.get(cache_key) else {
            return Err(format!(
                "native compute pipeline missing after compile: {cache_key}"
            ));
        };
        let bind_group = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Ghost Render Core Native Compute Probe Bind Group"),
            layout: &cached.bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: storage_buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: uniform_buffer.as_entire_binding(),
                },
            ],
        });
        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("Ghost Render Core Native Compute Probe Encoder"),
            });
        {
            let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some("Ghost Render Core Native Compute Probe Pass"),
                timestamp_writes: None,
            });
            pass.set_pipeline(&cached.pipeline);
            pass.set_bind_group(0, &bind_group, &[]);
            pass.dispatch_workgroups(element_count.div_ceil(64), 1, 1);
        }
        encoder.copy_buffer_to_buffer(&storage_buffer, 0, &readback_buffer, 0, byte_length);
        self.queue.submit(Some(encoder.finish()));

        let slice = readback_buffer.slice(..);
        let (tx, rx) = mpsc::channel();
        slice.map_async(wgpu::MapMode::Read, move |result| {
            let _ = tx.send(result.map_err(|err| err.to_string()));
        });
        self.device
            .poll(wgpu::PollType::wait_indefinitely())
            .map_err(|err| err.to_string())?;
        rx.recv()
            .map_err(|err| err.to_string())?
            .map_err(|err| err.to_string())?;
        let mapped = slice.get_mapped_range().map_err(|err| err.to_string())?;
        let mut checksum = 0xcbf29ce484222325u64;
        let mut nonzero_words = 0u32;
        let mut first_words = Vec::new();
        for chunk in mapped.chunks_exact(4) {
            let value = u32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
            if value != 0 {
                nonzero_words = nonzero_words.saturating_add(1);
            }
            if first_words.len() < 8 {
                first_words.push(value);
            }
            checksum ^= value as u64;
            checksum = checksum.wrapping_mul(0x100000001b3);
        }
        drop(mapped);
        readback_buffer.unmap();
        self.last_frame_error = None;
        Ok(ComputeProbeResult {
            byte_length,
            checksum,
            nonzero_words,
            first_words,
        })
    }

    fn run_native_compute_graph(
        &mut self,
        buffers: Vec<NativeComputeGraphBufferSpec>,
        passes: Vec<NativeComputeGraphPassPlan>,
        readbacks: Vec<String>,
        render_plans: Vec<NativeComputeGraphRenderPlan>,
    ) -> Result<Value, String> {
        if buffers.is_empty() {
            return Err("native compute graph requires at least one buffer".to_string());
        }
        if passes.is_empty() && render_plans.is_empty() {
            return Err(
                "native compute graph requires at least one pass or render pass".to_string(),
            );
        }
        let mut transient_buffers = HashMap::<String, NativeComputeGraphGpuBuffer>::new();
        let mut persistent_buffer_count = 0usize;
        let mut transient_buffer_count = 0usize;
        for spec in buffers {
            if spec.persistent {
                self.upsert_native_compute_graph_buffer(&spec)?;
                persistent_buffer_count = persistent_buffer_count.saturating_add(1);
            } else {
                transient_buffer_count = transient_buffer_count.saturating_add(1);
                transient_buffers.insert(
                    spec.id.clone(),
                    self.create_native_compute_graph_buffer(&spec),
                );
            }
        }

        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("Ghost Native Compute Graph Encoder"),
            });
        let mut executed_passes = Vec::with_capacity(passes.len());
        for pass_plan in passes {
            let layout_specs = pass_plan
                .bindings
                .iter()
                .map(|binding| NativeComputeBindingLayoutSpec {
                    binding: binding.binding,
                    kind: binding.kind,
                })
                .collect::<Vec<_>>();
            self.ensure_native_compute_pipeline(
                &pass_plan.cache_key,
                &pass_plan.source,
                &pass_plan.entry,
                &layout_specs,
            )?;
            let Some(cached) = self.native_compute_pipelines.get(&pass_plan.cache_key) else {
                return Err(format!(
                    "native compute graph pipeline missing after compile: {}",
                    pass_plan.cache_key
                ));
            };
            let mut texture_views = Vec::new();
            let entries = self.compute_graph_bind_group_entries(
                &transient_buffers,
                &pass_plan.bindings,
                &format!("pass `{}`", pass_plan.name),
                &mut texture_views,
            )?;
            let bind_group = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some(&format!(
                    "Ghost Native Compute Graph Bind Group {}",
                    pass_plan.name
                )),
                layout: &cached.bind_group_layout,
                entries: &entries,
            });
            {
                let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                    label: Some(&format!(
                        "Ghost Native Compute Graph Pass {}",
                        pass_plan.name
                    )),
                    timestamp_writes: None,
                });
                pass.set_pipeline(&cached.pipeline);
                pass.set_bind_group(0, &bind_group, &[]);
                pass.dispatch_workgroups(
                    pass_plan.dispatch[0].max(1),
                    pass_plan.dispatch[1].max(1),
                    pass_plan.dispatch[2].max(1),
                );
            }
            executed_passes.push(json!({
                "name": pass_plan.name,
                "entry": pass_plan.entry,
                "dispatch": pass_plan.dispatch,
            }));
        }

        let render_include_snapshot = render_plans.iter().any(|render| {
            render.include_snapshot
                && matches!(render.target, NativeComputeGraphRenderTarget::Snapshot)
        });
        let mut render_results = Vec::with_capacity(render_plans.len());
        for render in &render_plans {
            render_results.push(self.render_native_compute_graph(
                &mut encoder,
                &transient_buffers,
                render,
            )?);
        }

        let mut readback_buffers = Vec::new();
        for id in &readbacks {
            let Some(buffer) = self.compute_graph_buffer(&transient_buffers, id) else {
                return Err(format!(
                    "native compute graph readback missing buffer `{id}`"
                ));
            };
            let readback_buffer = self.device.create_buffer(&wgpu::BufferDescriptor {
                label: Some(&format!("Ghost Native Compute Graph Readback {id}")),
                size: buffer.byte_length,
                usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            });
            encoder.copy_buffer_to_buffer(
                &buffer.buffer,
                0,
                &readback_buffer,
                0,
                buffer.byte_length,
            );
            readback_buffers.push((id.clone(), readback_buffer, buffer.byte_length));
        }

        self.queue.submit(Some(encoder.finish()));

        let mut readback_json = serde_json::Map::new();
        for (id, readback_buffer, byte_length) in readback_buffers {
            let probe = self.readback_u32_buffer(&readback_buffer, byte_length)?;
            readback_json.insert(
                id,
                json!({
                    "byte_length": probe.byte_length,
                    "checksum": format!("{:016x}", probe.checksum),
                    "nonzero_words": probe.nonzero_words,
                    "first_words": probe.first_words,
                }),
            );
        }
        let render_snapshot = if render_include_snapshot {
            Some(self.frame_snapshot(false)?)
        } else {
            None
        };

        self.last_frame_error = None;
        let mut result = json!({
            "pass_count": executed_passes.len(),
            "passes": executed_passes,
            "readbacks": readback_json,
            "persistent_buffers": persistent_buffer_count,
            "transient_buffers": transient_buffer_count,
            "persistent_buffer_count": self.native_compute_graph_buffers.len(),
            "pipeline_cache_entries": self.native_pipeline_cache_count(),
        });
        if render_results.len() == 1 {
            if let Some(object) = result.as_object_mut() {
                object.insert("render".to_string(), render_results[0].clone());
            }
        }
        if !render_results.is_empty() {
            if let Some(object) = result.as_object_mut() {
                object.insert("renders".to_string(), Value::Array(render_results));
            }
        }
        if let Some(snapshot) = render_snapshot {
            if let Some(object) = result.as_object_mut() {
                object.insert("render_snapshot".to_string(), snapshot);
            }
        }
        Ok(result)
    }

    fn render_native_compute_graph(
        &mut self,
        encoder: &mut wgpu::CommandEncoder,
        transient_buffers: &HashMap<String, NativeComputeGraphGpuBuffer>,
        render_plan: &NativeComputeGraphRenderPlan,
    ) -> Result<Value, String> {
        let (output_format, target_name, target_width, target_height, source_id, source_slot) =
            match &render_plan.target {
                NativeComputeGraphRenderTarget::Snapshot => (
                    self.config.format,
                    "snapshot",
                    self.config.width.max(1),
                    self.config.height.max(1),
                    None::<String>,
                    None::<usize>,
                ),
                NativeComputeGraphRenderTarget::SourceFrame {
                    source_id, slot, ..
                } => (
                    self.source_frame_format,
                    "source_frame",
                    self.source_frame_size.max(1) as u32,
                    self.source_frame_size.max(1) as u32,
                    Some(source_id.clone()),
                    Some((*slot).min(MAX_SOURCE_FRAME_SLOTS - 1)),
                ),
            };
        let pipeline_key = native_graph_render_pipeline_key(&render_plan.cache_key, output_format);
        let layout_specs = render_plan
            .bindings
            .iter()
            .map(|binding| NativeComputeBindingLayoutSpec {
                binding: binding.binding,
                kind: binding.kind,
            })
            .collect::<Vec<_>>();
        self.ensure_native_graph_render_pipeline(
            &pipeline_key,
            render_plan,
            &layout_specs,
            output_format,
        )?;
        let Some(cached) = self.native_graph_render_pipelines.get(&pipeline_key) else {
            return Err(format!(
                "native compute graph render pipeline missing after compile: {}",
                pipeline_key
            ));
        };
        let mut texture_views = Vec::new();
        let entries = self.compute_graph_bind_group_entries(
            transient_buffers,
            &render_plan.bindings,
            &format!("render `{}`", render_plan.name),
            &mut texture_views,
        )?;
        let bind_group = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some(&format!(
                "Ghost Native Compute Graph Render Bind Group {}",
                render_plan.name
            )),
            layout: &cached.bind_group_layout,
            entries: &entries,
        });
        let source_frame_target_view;
        let target_view = if let Some(slot) = source_slot {
            source_frame_target_view =
                self.source_frame_texture
                    .create_view(&wgpu::TextureViewDescriptor {
                        label: Some("Ghost Native Compute Graph Source Frame View"),
                        format: Some(self.source_frame_format),
                        dimension: Some(wgpu::TextureViewDimension::D2),
                        base_mip_level: 0,
                        mip_level_count: Some(1),
                        base_array_layer: slot as u32,
                        array_layer_count: Some(1),
                        ..Default::default()
                    });
            &source_frame_target_view
        } else {
            &self.snapshot_view
        };
        let depth_texture;
        let depth_view;
        let depth_stencil_attachment = if render_plan.depth_enabled {
            depth_texture = self.device.create_texture(&wgpu::TextureDescriptor {
                label: Some("Ghost Native Compute Graph Depth Texture"),
                size: wgpu::Extent3d {
                    width: target_width,
                    height: target_height,
                    depth_or_array_layers: 1,
                },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: wgpu::TextureFormat::Depth24Plus,
                usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
                view_formats: &[],
            });
            depth_view = depth_texture.create_view(&wgpu::TextureViewDescriptor {
                label: Some("Ghost Native Compute Graph Depth View"),
                ..Default::default()
            });
            Some(wgpu::RenderPassDepthStencilAttachment {
                view: &depth_view,
                depth_ops: Some(wgpu::Operations {
                    load: wgpu::LoadOp::Clear(1.0),
                    store: wgpu::StoreOp::Discard,
                }),
                stencil_ops: None,
            })
        } else {
            None
        };
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some(&format!(
                    "Ghost Native Compute Graph Render Pass {}",
                    render_plan.name
                )),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: target_view,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: if render_plan.clear {
                            wgpu::LoadOp::Clear(wgpu::Color {
                                r: render_plan.clear_color[0],
                                g: render_plan.clear_color[1],
                                b: render_plan.clear_color[2],
                                a: render_plan.clear_color[3],
                            })
                        } else {
                            wgpu::LoadOp::Load
                        },
                        store: wgpu::StoreOp::Store,
                    },
                    depth_slice: None,
                })],
                depth_stencil_attachment,
                timestamp_writes: None,
                occlusion_query_set: None,
                multiview_mask: None,
            });
            pass.set_pipeline(&cached.pipeline);
            pass.set_bind_group(0, &bind_group, &[]);
            if let Some(indirect_buffer_id) = render_plan.indirect_buffer_id.as_ref() {
                let Some(buffer) = self.compute_graph_buffer(transient_buffers, indirect_buffer_id)
                else {
                    return Err(format!(
                        "native compute graph render `{}` references missing indirect buffer `{}`",
                        render_plan.name, indirect_buffer_id
                    ));
                };
                if !buffer.indirect {
                    return Err(format!(
                        "native compute graph render `{}` indirect buffer `{}` was not created with indirect usage",
                        render_plan.name, indirect_buffer_id
                    ));
                }
                pass.draw_indirect(&buffer.buffer, render_plan.indirect_offset);
            } else {
                pass.draw(0..render_plan.vertex_count, 0..render_plan.instance_count);
            }
        }
        if let Some(slot) = source_slot {
            self.generate_source_frame_mips(encoder, slot);
        }
        let mut result = json!({
            "name": render_plan.name,
            "vertex_entry": render_plan.vertex_entry,
            "fragment_entry": render_plan.fragment_entry,
            "bindings": render_plan.bindings.len(),
            "target": target_name,
            "blend": render_plan.blend.signature(),
            "draw": if render_plan.indirect_buffer_id.is_some() { "indirect" } else { "direct" },
            "primitive": render_plan.primitive_topology.signature(),
            "vertex_count": render_plan.vertex_count,
            "instance_count": render_plan.instance_count,
            "depth": render_plan.depth_enabled,
            "depth_write": render_plan.depth_write,
            "depth_compare": render_plan.depth_compare.signature(),
            "format": texture_format_label(output_format),
            "include_snapshot": render_plan.include_snapshot,
            "clear_color": render_plan.clear_color,
        });
        if let Some(indirect_buffer_id) = render_plan.indirect_buffer_id.as_ref() {
            if let Some(object) = result.as_object_mut() {
                object.insert(
                    "indirect_buffer".to_string(),
                    Value::String(indirect_buffer_id.clone()),
                );
                object.insert(
                    "indirect_offset".to_string(),
                    Value::from(render_plan.indirect_offset),
                );
            }
        }
        if let Some(source_id) = source_id {
            if let Some(object) = result.as_object_mut() {
                object.insert("source_id".to_string(), json!(source_id));
                object.insert("source_slot".to_string(), json!(source_slot.unwrap_or(0)));
            }
        }
        Ok(result)
    }

    fn compute_graph_bind_group_entries<'a>(
        &'a self,
        transient_buffers: &'a HashMap<String, NativeComputeGraphGpuBuffer>,
        bindings: &'a [NativeComputeGraphBindingSpec],
        context: &str,
        texture_views: &'a mut Vec<wgpu::TextureView>,
    ) -> Result<Vec<wgpu::BindGroupEntry<'a>>, String> {
        enum PreparedBinding<'a> {
            Buffer(&'a wgpu::Buffer),
            TextureView(usize),
            Sampler,
        }

        let mut prepared = Vec::with_capacity(bindings.len());
        for binding in bindings {
            match binding.kind {
                NativeComputeGraphBindingKind::Buffer(_) => {
                    let Some(buffer) =
                        self.compute_graph_buffer(transient_buffers, &binding.resource_id)
                    else {
                        return Err(format!(
                            "native compute graph {context} references missing buffer `{}`",
                            binding.resource_id
                        ));
                    };
                    prepared.push(PreparedBinding::Buffer(&buffer.buffer));
                }
                NativeComputeGraphBindingKind::SourceFrameTexture(dimension) => {
                    let label = match dimension {
                        NativeComputeGraphTextureDimension::D2 => {
                            "Ghost Native Compute Graph Source Frame Texture View"
                        }
                        NativeComputeGraphTextureDimension::D2Array => {
                            "Ghost Native Compute Graph Source Frame Array View"
                        }
                    };
                    let slot = binding
                        .source_slot
                        .unwrap_or(0)
                        .min(MAX_SOURCE_FRAME_SLOTS - 1);
                    texture_views.push(self.source_frame_texture.create_view(
                        &wgpu::TextureViewDescriptor {
                            label: Some(label),
                            format: Some(self.source_frame_format),
                            dimension: Some(dimension.view_dimension()),
                            base_mip_level: 0,
                            mip_level_count: Some(self.source_frame_mip_levels),
                            base_array_layer: if matches!(
                                dimension,
                                NativeComputeGraphTextureDimension::D2
                            ) {
                                slot as u32
                            } else {
                                0
                            },
                            array_layer_count: if matches!(
                                dimension,
                                NativeComputeGraphTextureDimension::D2
                            ) {
                                Some(1)
                            } else {
                                Some(MAX_SOURCE_FRAME_SLOTS as u32)
                            },
                            ..Default::default()
                        },
                    ));
                    prepared.push(PreparedBinding::TextureView(texture_views.len() - 1));
                }
                NativeComputeGraphBindingKind::SourceFrameSampler => {
                    prepared.push(PreparedBinding::Sampler);
                }
            }
        }

        Ok(bindings
            .iter()
            .zip(prepared.iter())
            .map(|(binding, prepared)| wgpu::BindGroupEntry {
                binding: binding.binding,
                resource: match prepared {
                    PreparedBinding::Buffer(buffer) => buffer.as_entire_binding(),
                    PreparedBinding::TextureView(index) => {
                        wgpu::BindingResource::TextureView(&texture_views[*index])
                    }
                    PreparedBinding::Sampler => {
                        wgpu::BindingResource::Sampler(&self.source_frame_sampler)
                    }
                },
            })
            .collect())
    }

    fn ensure_native_graph_render_pipeline(
        &mut self,
        pipeline_key: &str,
        render_plan: &NativeComputeGraphRenderPlan,
        layout_specs: &[NativeComputeBindingLayoutSpec],
        output_format: wgpu::TextureFormat,
    ) -> Result<(), String> {
        if self
            .native_graph_render_pipelines
            .contains_key(pipeline_key)
        {
            return Ok(());
        }
        if layout_specs.is_empty() {
            return Err(format!(
                "native graph render pipeline `{}` has no bindings",
                pipeline_key
            ));
        }
        let error_scope = self.device.push_error_scope(wgpu::ErrorFilter::Validation);
        let shader = self
            .device
            .create_shader_module(wgpu::ShaderModuleDescriptor {
                label: Some("Ghost Render Core Native Graph Render Shader"),
                source: wgpu::ShaderSource::Wgsl(render_plan.source.clone().into()),
            });
        let layout_entries = layout_specs
            .iter()
            .map(|spec| wgpu::BindGroupLayoutEntry {
                binding: spec.binding,
                visibility: wgpu::ShaderStages::VERTEX | wgpu::ShaderStages::FRAGMENT,
                ty: spec.kind.binding_type(),
                count: None,
            })
            .collect::<Vec<_>>();
        let bind_group_layout =
            self.device
                .create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                    label: Some("Ghost Render Core Native Graph Render Layout"),
                    entries: &layout_entries,
                });
        let pipeline_layout = self
            .device
            .create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some("Ghost Render Core Native Graph Render Pipeline Layout"),
                bind_group_layouts: &[Some(&bind_group_layout)],
                immediate_size: 0,
            });
        let pipeline = self
            .device
            .create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some("Ghost Render Core Native Graph Render Pipeline"),
                layout: Some(&pipeline_layout),
                vertex: wgpu::VertexState {
                    module: &shader,
                    entry_point: Some(&render_plan.vertex_entry),
                    compilation_options: wgpu::PipelineCompilationOptions::default(),
                    buffers: &[],
                },
                primitive: wgpu::PrimitiveState {
                    topology: render_plan.primitive_topology.topology(),
                    ..Default::default()
                },
                depth_stencil: if render_plan.depth_enabled {
                    Some(wgpu::DepthStencilState {
                        format: wgpu::TextureFormat::Depth24Plus,
                        depth_write_enabled: Some(render_plan.depth_write),
                        depth_compare: Some(render_plan.depth_compare.compare_function()),
                        stencil: wgpu::StencilState::default(),
                        bias: wgpu::DepthBiasState::default(),
                    })
                } else {
                    None
                },
                multisample: wgpu::MultisampleState::default(),
                fragment: Some(wgpu::FragmentState {
                    module: &shader,
                    entry_point: Some(&render_plan.fragment_entry),
                    compilation_options: wgpu::PipelineCompilationOptions::default(),
                    targets: &[Some(wgpu::ColorTargetState {
                        format: output_format,
                        blend: Some(render_plan.blend.blend_state()),
                        write_mask: wgpu::ColorWrites::ALL,
                    })],
                }),
                multiview_mask: None,
                cache: None,
            });
        let error_future = error_scope.pop();
        let _ = self.device.poll(wgpu::PollType::Poll);
        if let Some(err) = pollster::block_on(error_future) {
            return Err(err.to_string());
        }
        self.native_graph_render_pipelines.insert(
            pipeline_key.to_string(),
            NativeGraphRenderPipeline {
                pipeline,
                bind_group_layout,
            },
        );
        Ok(())
    }

    fn create_native_compute_graph_buffer(
        &self,
        spec: &NativeComputeGraphBufferSpec,
    ) -> NativeComputeGraphGpuBuffer {
        let mut usage = spec.kind.buffer_usage();
        if spec.indirect {
            usage |= wgpu::BufferUsages::INDIRECT;
        }
        let buffer = if spec.initial_bytes.is_empty() {
            self.device.create_buffer(&wgpu::BufferDescriptor {
                label: Some(&format!("Ghost Native Compute Graph Buffer {}", spec.id)),
                size: spec.byte_length,
                usage,
                mapped_at_creation: false,
            })
        } else {
            self.device
                .create_buffer_init(&wgpu::util::BufferInitDescriptor {
                    label: Some(&format!("Ghost Native Compute Graph Buffer {}", spec.id)),
                    contents: &spec.initial_bytes,
                    usage,
                })
        };
        NativeComputeGraphGpuBuffer {
            buffer,
            byte_length: spec.byte_length,
            kind: spec.kind,
            indirect: spec.indirect,
        }
    }

    fn upsert_native_compute_graph_buffer(
        &mut self,
        spec: &NativeComputeGraphBufferSpec,
    ) -> Result<(), String> {
        let recreate = spec.clear
            || self
                .native_compute_graph_buffers
                .get(&spec.id)
                .map(|existing| {
                    existing.byte_length != spec.byte_length
                        || existing.kind.signature() != spec.kind.signature()
                        || existing.indirect != spec.indirect
                })
                .unwrap_or(true);
        if recreate {
            let buffer = self.create_native_compute_graph_buffer(spec);
            self.native_compute_graph_buffers
                .insert(spec.id.clone(), buffer);
            return Ok(());
        }
        if !spec.initial_bytes.is_empty() {
            let Some(existing) = self.native_compute_graph_buffers.get(&spec.id) else {
                return Err(format!(
                    "persistent native compute graph buffer `{}` missing after lookup",
                    spec.id
                ));
            };
            self.queue
                .write_buffer(&existing.buffer, 0, &spec.initial_bytes);
        }
        Ok(())
    }

    fn compute_graph_buffer<'a>(
        &'a self,
        transient_buffers: &'a HashMap<String, NativeComputeGraphGpuBuffer>,
        id: &str,
    ) -> Option<&'a NativeComputeGraphGpuBuffer> {
        transient_buffers
            .get(id)
            .or_else(|| self.native_compute_graph_buffers.get(id))
    }

    fn native_compute_graph_buffer_count(&self) -> u32 {
        self.native_compute_graph_buffers
            .len()
            .min(u32::MAX as usize) as u32
    }

    fn readback_u32_buffer(
        &self,
        readback_buffer: &wgpu::Buffer,
        byte_length: u64,
    ) -> Result<ComputeProbeResult, String> {
        let slice = readback_buffer.slice(..);
        let (tx, rx) = mpsc::channel();
        slice.map_async(wgpu::MapMode::Read, move |result| {
            let _ = tx.send(result.map_err(|err| err.to_string()));
        });
        self.device
            .poll(wgpu::PollType::wait_indefinitely())
            .map_err(|err| err.to_string())?;
        rx.recv()
            .map_err(|err| err.to_string())?
            .map_err(|err| err.to_string())?;
        let mapped = slice.get_mapped_range().map_err(|err| err.to_string())?;
        let mut checksum = 0xcbf29ce484222325u64;
        let mut nonzero_words = 0u32;
        let mut first_words = Vec::new();
        for chunk in mapped.chunks_exact(4) {
            let value = u32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
            if value != 0 {
                nonzero_words = nonzero_words.saturating_add(1);
            }
            if first_words.len() < 8 {
                first_words.push(value);
            }
            checksum ^= value as u64;
            checksum = checksum.wrapping_mul(0x100000001b3);
        }
        drop(mapped);
        readback_buffer.unmap();
        Ok(ComputeProbeResult {
            byte_length,
            checksum,
            nonzero_words,
            first_words,
        })
    }

    fn render_native_wgsl_shader_frame(
        &mut self,
        slot: usize,
        cache_key: &str,
        source: &str,
        fragment_entry: &str,
        uniforms: &NativeShaderUniforms,
    ) -> Result<(), String> {
        self.ensure_native_shader_pipeline(cache_key, source, fragment_entry)?;
        self.queue.write_buffer(
            &self.native_shader_uniform_buffer,
            0,
            bytemuck::bytes_of(uniforms),
        );
        let safe_slot = slot.min(MAX_SOURCE_FRAME_SLOTS - 1);
        let view = self
            .source_frame_texture
            .create_view(&wgpu::TextureViewDescriptor {
                label: Some("Ghost Render Core Native Shader Source Frame View"),
                format: Some(self.source_frame_format),
                dimension: Some(wgpu::TextureViewDimension::D2),
                base_mip_level: 0,
                mip_level_count: Some(1),
                base_array_layer: safe_slot as u32,
                array_layer_count: Some(1),
                ..Default::default()
            });
        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("Ghost Render Core Native Shader Encoder"),
            });
        let input_slot = uniforms.frame_seed_inputs[3]
            .round()
            .clamp(0.0, (MAX_SOURCE_FRAME_SLOTS - 1) as f32) as u32;
        encoder.copy_texture_to_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &self.source_frame_texture,
                mip_level: 0,
                origin: wgpu::Origin3d {
                    x: 0,
                    y: 0,
                    z: input_slot,
                },
                aspect: wgpu::TextureAspect::All,
            },
            wgpu::TexelCopyTextureInfo {
                texture: &self.native_shader_input_texture,
                mip_level: 0,
                origin: wgpu::Origin3d {
                    x: 0,
                    y: 0,
                    z: input_slot,
                },
                aspect: wgpu::TextureAspect::All,
            },
            wgpu::Extent3d {
                width: self.source_frame_size as u32,
                height: self.source_frame_size as u32,
                depth_or_array_layers: 1,
            },
        );
        {
            let Some(pipeline) = self.native_shader_pipelines.get(cache_key) else {
                return Err("native shader pipeline was not cached".to_string());
            };
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("Ghost Render Core Native Shader Pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                        store: wgpu::StoreOp::Store,
                    },
                    depth_slice: None,
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
                multiview_mask: None,
            });
            pass.set_pipeline(&pipeline.pipeline);
            pass.set_bind_group(0, &self.native_shader_bind_group, &[]);
            pass.draw(0..3, 0..1);
        }
        self.generate_source_frame_mips(&mut encoder, safe_slot);
        self.queue.submit(Some(encoder.finish()));
        self.last_frame_error = None;
        Ok(())
    }

    fn write_source_frame(&self, slot: usize, rgba: &[u8]) {
        if rgba.len() < self.source_frame_size * self.source_frame_size * 4 {
            return;
        }
        let safe_slot = slot.min(MAX_SOURCE_FRAME_SLOTS - 1);
        let (payload, bytes_per_row) =
            source_frame_upload_payload(rgba, self.source_frame_size, self.source_frame_format);
        self.queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &self.source_frame_texture,
                mip_level: 0,
                origin: wgpu::Origin3d {
                    x: 0,
                    y: 0,
                    z: safe_slot as u32,
                },
                aspect: wgpu::TextureAspect::All,
            },
            &payload,
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(bytes_per_row),
                rows_per_image: Some(self.source_frame_size as u32),
            },
            wgpu::Extent3d {
                width: self.source_frame_size as u32,
                height: self.source_frame_size as u32,
                depth_or_array_layers: 1,
            },
        );
        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("Ghost Render Core Source Frame Mip Encoder"),
            });
        self.generate_source_frame_mips(&mut encoder, safe_slot);
        self.queue.submit(Some(encoder.finish()));
    }

    fn import_shared_texture_source_frame(
        &self,
        slot: usize,
        descriptor: &SharedTextureSourceFrameDescriptor,
    ) -> Result<u64, String> {
        #[cfg(target_os = "macos")]
        {
            self.import_iosurface_source_frame(slot, descriptor)
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = slot;
            let _ = descriptor;
            Err(format!(
                "shared texture source-frame upload is not implemented yet for backend={}",
                native_backend_name()
            ))
        }
    }

    #[cfg(target_os = "macos")]
    fn import_iosurface_source_frame(
        &self,
        slot: usize,
        descriptor: &SharedTextureSourceFrameDescriptor,
    ) -> Result<u64, String> {
        use objc2_io_surface::IOSurfaceRef;
        use objc2_metal::{
            MTLDevice, MTLStorageMode, MTLTextureDescriptor, MTLTextureType, MTLTextureUsage,
        };
        use wgpu::hal::{self, api::Metal};

        if descriptor.platform != "iosurface" {
            return Err(format!(
                "shared texture platform `{}` is not supported by the Metal importer",
                descriptor.platform
            ));
        }

        let surface_id = descriptor.iosurface_id()?;
        let surface = IOSurfaceRef::lookup(surface_id)
            .ok_or_else(|| format!("IOSurfaceLookup({surface_id}) returned null"))?;
        let metal_format = metal_texture_format_for_shared_texture(descriptor);
        let wgpu_format = wgpu_texture_format_for_shared_texture(descriptor);
        let width = descriptor.width.max(1);
        let height = descriptor.height.max(1);
        let raw_device = unsafe { self.device.as_hal::<Metal>() }
            .ok_or_else(|| "native renderer is not running on the Metal backend".to_string())?;
        let texture_descriptor = unsafe {
            MTLTextureDescriptor::texture2DDescriptorWithPixelFormat_width_height_mipmapped(
                metal_format,
                width as usize,
                height as usize,
                false,
            )
        };
        texture_descriptor.setTextureType(MTLTextureType::Type2D);
        texture_descriptor.setStorageMode(MTLStorageMode::Shared);
        texture_descriptor.setUsage(MTLTextureUsage::ShaderRead);
        let raw_texture = raw_device
            .raw_device()
            .newTextureWithDescriptor_iosurface_plane(&texture_descriptor, &surface, 0)
            .ok_or_else(|| {
                format!(
                    "Metal failed to create texture from IOSurfaceID={surface_id} format={} size={}x{}",
                    descriptor.format, width, height
                )
            })?;
        let hal_texture = unsafe {
            hal::metal::Device::texture_from_raw(
                raw_texture,
                wgpu_format,
                MTLTextureType::Type2D,
                1,
                1,
                hal::CopyExtent {
                    width,
                    height,
                    depth: 1,
                },
                None,
            )
        };
        let imported_texture = unsafe {
            self.device.create_texture_from_hal::<Metal>(
                hal_texture,
                &wgpu::TextureDescriptor {
                    label: Some("Ghost Render Core Imported IOSurface Source Frame"),
                    size: wgpu::Extent3d {
                        width,
                        height,
                        depth_or_array_layers: 1,
                    },
                    mip_level_count: 1,
                    sample_count: 1,
                    dimension: wgpu::TextureDimension::D2,
                    format: wgpu_format,
                    usage: wgpu::TextureUsages::TEXTURE_BINDING,
                    view_formats: &[],
                },
                wgpu::TextureUses::RESOURCE,
            )
        };
        let source_view = imported_texture.create_view(&wgpu::TextureViewDescriptor {
            label: Some("Ghost Render Core Imported IOSurface Source View"),
            format: Some(wgpu_format),
            dimension: Some(wgpu::TextureViewDimension::D2),
            ..Default::default()
        });
        let safe_slot = slot.min(MAX_SOURCE_FRAME_SLOTS - 1);
        let target_view = self
            .source_frame_texture
            .create_view(&wgpu::TextureViewDescriptor {
                label: Some("Ghost Render Core Shared Texture Source Frame Target"),
                format: Some(self.source_frame_format),
                dimension: Some(wgpu::TextureViewDimension::D2),
                base_mip_level: 0,
                mip_level_count: Some(1),
                base_array_layer: safe_slot as u32,
                array_layer_count: Some(1),
                ..Default::default()
            });
        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("Ghost Render Core Shared Texture Source Frame Encoder"),
            });
        self.source_frame_blitter
            .copy(&self.device, &mut encoder, &source_view, &target_view);
        self.generate_source_frame_mips(&mut encoder, safe_slot);
        self.queue.submit(Some(encoder.finish()));
        Ok(self
            .source_frame_size
            .saturating_mul(self.source_frame_size)
            .saturating_mul(texture_format_bytes_per_texel(self.source_frame_format))
            .min(u64::MAX as usize) as u64)
    }

    fn generate_source_frame_mips(&self, encoder: &mut wgpu::CommandEncoder, slot: usize) {
        if self.source_frame_mip_levels <= 1 {
            return;
        }
        let safe_slot = slot.min(MAX_SOURCE_FRAME_SLOTS - 1);
        for mip_level in 1..self.source_frame_mip_levels {
            let source_view = self
                .source_frame_texture
                .create_view(&wgpu::TextureViewDescriptor {
                    label: Some("Ghost Render Core Source Frame Mip Source"),
                    format: Some(self.source_frame_format),
                    dimension: Some(wgpu::TextureViewDimension::D2),
                    base_mip_level: mip_level - 1,
                    mip_level_count: Some(1),
                    base_array_layer: safe_slot as u32,
                    array_layer_count: Some(1),
                    ..Default::default()
                });
            let target_view = self
                .source_frame_texture
                .create_view(&wgpu::TextureViewDescriptor {
                    label: Some("Ghost Render Core Source Frame Mip Target"),
                    format: Some(self.source_frame_format),
                    dimension: Some(wgpu::TextureViewDimension::D2),
                    base_mip_level: mip_level,
                    mip_level_count: Some(1),
                    base_array_layer: safe_slot as u32,
                    array_layer_count: Some(1),
                    ..Default::default()
                });
            self.source_frame_blitter
                .copy(&self.device, encoder, &source_view, &target_view);
        }
    }

    fn frame_snapshot(&mut self, include_pixels: bool) -> Result<Value, String> {
        let width = self.config.width.max(1);
        let height = self.config.height.max(1);
        let bytes_per_pixel = 4_u32;
        let unpadded_bytes_per_row = width.saturating_mul(bytes_per_pixel);
        let padded_bytes_per_row =
            align_u32(unpadded_bytes_per_row, wgpu::COPY_BYTES_PER_ROW_ALIGNMENT);
        let padded_size = padded_bytes_per_row as u64 * height as u64;
        let buffer = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Ghost Render Core Snapshot Readback"),
            size: padded_size,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });
        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("Ghost Render Core Snapshot Readback Encoder"),
            });
        encoder.copy_texture_to_buffer(
            wgpu::TexelCopyTextureInfo {
                texture: &self.snapshot_texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            wgpu::TexelCopyBufferInfo {
                buffer: &buffer,
                layout: wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(padded_bytes_per_row),
                    rows_per_image: Some(height),
                },
            },
            wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
        );
        self.queue.submit(Some(encoder.finish()));

        let slice = buffer.slice(..);
        let (tx, rx) = mpsc::channel();
        slice.map_async(wgpu::MapMode::Read, move |result| {
            let _ = tx.send(result.map_err(|err| err.to_string()));
        });
        self.device
            .poll(wgpu::PollType::wait_indefinitely())
            .map_err(|err| err.to_string())?;
        rx.recv()
            .map_err(|err| err.to_string())?
            .map_err(|err| err.to_string())?;

        let mapped = slice.get_mapped_range().map_err(|err| err.to_string())?;
        let mut compact = vec![0_u8; unpadded_bytes_per_row as usize * height as usize];
        for y in 0..height as usize {
            let src_start = y * padded_bytes_per_row as usize;
            let dst_start = y * unpadded_bytes_per_row as usize;
            compact[dst_start..dst_start + unpadded_bytes_per_row as usize]
                .copy_from_slice(&mapped[src_start..src_start + unpadded_bytes_per_row as usize]);
        }
        drop(mapped);
        buffer.unmap();

        let metrics = snapshot_metrics(&compact, self.config.format);
        self.last_frame_metrics = Some(metrics.clone());
        let mut value = json!({
            "timestamp_ms": epoch_ms(),
            "width": width,
            "height": height,
            "format": format!("{:?}", self.config.format),
            "byte_length": compact.len(),
            "bytes_per_row": unpadded_bytes_per_row,
            "padded_bytes_per_row": padded_bytes_per_row,
            "checksum": metrics.checksum,
            "nonzero_pixels": metrics.nonzero_pixels,
            "bright_pixels": metrics.bright_pixels,
            "transparent_pixels": metrics.transparent_pixels,
            "average_luma": metrics.average_luma,
            "max_luma": metrics.max_luma,
            "mean_rgba": metrics.mean_rgba,
            "dark_frame": metrics.dark_frame,
            "includes_pixels": include_pixels,
        });
        if include_pixels {
            if let Some(object) = value.as_object_mut() {
                object.insert(
                    "rgba_b64".to_string(),
                    Value::String(base64::engine::general_purpose::STANDARD.encode(&compact)),
                );
            }
        }
        Ok(value)
    }

    fn write_frame_inputs(
        &self,
        command_phase: f32,
        layers_seen: u32,
        time_seconds: Option<f32>,
        frame_count: u64,
        scene_layers: &[LayerGpu],
        source_previews: Option<&[PreviewPixel]>,
        audio0: [f32; 4],
        audio1: [f32; 4],
        audio2: [f32; 4],
    ) {
        let uniforms = Uniforms {
            resolution: [self.config.width as f32, self.config.height as f32],
            time: time_seconds.unwrap_or_else(|| self.start_time.elapsed().as_secs_f32()),
            command_phase,
            layer_count: layers_seen as f32,
            frame_count: frame_count as f32,
            _pad0: [0.0, 0.0],
            audio0,
            audio1,
            audio2,
        };
        self.queue
            .write_buffer(&self.uniform_buffer, 0, bytemuck::bytes_of(&uniforms));

        let mut gpu_layers = vec![LayerGpu::zeroed(); MAX_SCENE_LAYERS];
        for (index, layer) in scene_layers.iter().take(MAX_SCENE_LAYERS).enumerate() {
            gpu_layers[index] = *layer;
        }
        self.queue
            .write_buffer(&self.layer_buffer, 0, bytemuck::cast_slice(&gpu_layers));

        if let Some(source_previews) = source_previews {
            let mut gpu_previews =
                vec![PreviewPixel::zeroed(); MAX_SOURCE_PREVIEWS * SOURCE_PREVIEW_PIXELS];
            for (index, pixel) in source_previews
                .iter()
                .take(MAX_SOURCE_PREVIEWS * SOURCE_PREVIEW_PIXELS)
                .enumerate()
            {
                gpu_previews[index] = *pixel;
            }
            self.queue.write_buffer(
                &self.source_preview_buffer,
                0,
                bytemuck::cast_slice(&gpu_previews),
            );
        }
    }

    fn draw_fullscreen_to_view(
        &self,
        encoder: &mut wgpu::CommandEncoder,
        view: &wgpu::TextureView,
        label: &'static str,
        timestamp_writes: Option<wgpu::RenderPassTimestampWrites<'_>>,
    ) {
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some(label),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view,
                resolve_target: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                    store: wgpu::StoreOp::Store,
                },
                depth_slice: None,
            })],
            depth_stencil_attachment: None,
            timestamp_writes,
            occlusion_query_set: None,
            multiview_mask: None,
        });
        pass.set_pipeline(&self.pipeline);
        pass.set_bind_group(0, &self.bind_group, &[]);
        pass.draw(0..3, 0..1);
    }

    fn render_snapshot(
        &mut self,
        command_phase: f32,
        layers_seen: u32,
        time_seconds: Option<f32>,
        frame_count: u64,
        scene_layers: &[LayerGpu],
        source_previews: Option<&[PreviewPixel]>,
        audio0: [f32; 4],
        audio1: [f32; 4],
        audio2: [f32; 4],
    ) -> Result<(), String> {
        self.write_frame_inputs(
            command_phase,
            layers_seen,
            time_seconds,
            frame_count,
            scene_layers,
            source_previews,
            audio0,
            audio1,
            audio2,
        );
        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("Ghost Render Core Snapshot Encoder"),
            });
        let should_record_timing = self
            .gpu_timing
            .as_ref()
            .is_some_and(GpuTimingState::can_record);
        let timestamp_writes = if should_record_timing {
            self.gpu_timing
                .as_ref()
                .map(GpuTimingState::timestamp_writes)
        } else {
            None
        };
        self.draw_fullscreen_to_view(
            &mut encoder,
            &self.snapshot_view,
            "Ghost Render Core Snapshot Pass",
            timestamp_writes,
        );
        if should_record_timing {
            if let Some(gpu_timing) = self.gpu_timing.as_ref() {
                gpu_timing.resolve_to_readback(&mut encoder);
            }
        }
        self.queue.submit(Some(encoder.finish()));
        if should_record_timing {
            if let Some(gpu_timing) = self.gpu_timing.as_mut() {
                gpu_timing.begin_readback();
            }
        }
        self.last_frame_error = None;
        Ok(())
    }

    fn render(
        &mut self,
        command_phase: f32,
        layers_seen: u32,
        time_seconds: Option<f32>,
        frame_count: u64,
        scene_layers: &[LayerGpu],
        source_previews: Option<&[PreviewPixel]>,
        audio0: [f32; 4],
        audio1: [f32; 4],
        audio2: [f32; 4],
    ) -> Result<SurfacePresentOutcome, String> {
        let mut present_outcome = SurfacePresentOutcome::Presented;
        let frame = match self.surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(frame) => frame,
            wgpu::CurrentSurfaceTexture::Suboptimal(frame) => {
                self.surface.configure(&self.device, &self.config);
                present_outcome = SurfacePresentOutcome::SuboptimalPresented;
                frame
            }
            wgpu::CurrentSurfaceTexture::Outdated => {
                self.surface.configure(&self.device, &self.config);
                return Ok(SurfacePresentOutcome::Outdated);
            }
            wgpu::CurrentSurfaceTexture::Timeout => {
                return Ok(SurfacePresentOutcome::Timeout);
            }
            wgpu::CurrentSurfaceTexture::Occluded => {
                return Ok(SurfacePresentOutcome::Occluded);
            }
            wgpu::CurrentSurfaceTexture::Lost => {
                self.surface.configure(&self.device, &self.config);
                return Err("surface lost".to_string());
            }
            wgpu::CurrentSurfaceTexture::Validation => {
                return Err("surface validation error".to_string());
            }
        };
        let view = frame
            .texture
            .create_view(&wgpu::TextureViewDescriptor::default());
        self.write_frame_inputs(
            command_phase,
            layers_seen,
            time_seconds,
            frame_count,
            scene_layers,
            source_previews,
            audio0,
            audio1,
            audio2,
        );
        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("Ghost Render Core Encoder"),
            });
        let should_record_timing = self
            .gpu_timing
            .as_ref()
            .is_some_and(GpuTimingState::can_record);
        let timestamp_writes = if should_record_timing {
            self.gpu_timing
                .as_ref()
                .map(GpuTimingState::timestamp_writes)
        } else {
            None
        };
        self.draw_fullscreen_to_view(
            &mut encoder,
            &view,
            "Ghost Render Core Pass",
            timestamp_writes,
        );
        if should_record_timing {
            if let Some(gpu_timing) = self.gpu_timing.as_ref() {
                gpu_timing.resolve_to_readback(&mut encoder);
            }
        }
        self.queue.submit(Some(encoder.finish()));
        if should_record_timing {
            if let Some(gpu_timing) = self.gpu_timing.as_mut() {
                gpu_timing.begin_readback();
            }
        }
        self.queue.present(frame);
        self.last_frame_error = None;
        Ok(present_outcome)
    }
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let event_loop = EventLoop::<UserEvent>::with_user_event().build()?;
    let proxy = event_loop.create_proxy();
    let (response_tx, response_rx) = mpsc::channel::<String>();
    spawn_stdout_writer(response_rx);
    spawn_stdin_reader(proxy);

    let mut app = App::new(response_tx);
    event_loop.run_app(&mut app)?;
    Ok(())
}

fn spawn_stdout_writer(response_rx: Receiver<String>) {
    thread::spawn(move || {
        let stdout = io::stdout();
        let mut lock = stdout.lock();
        while let Ok(line) = response_rx.recv() {
            let _ = writeln!(lock, "{line}");
            let _ = lock.flush();
        }
    });
}

fn spawn_stdin_reader(proxy: winit::event_loop::EventLoopProxy<UserEvent>) {
    thread::spawn(move || {
        for line in io::stdin().lock().lines() {
            let Ok(line) = line else {
                break;
            };
            if line.trim().is_empty() {
                continue;
            }
            match serde_json::from_str::<RpcRequest>(&line) {
                Ok(req) => {
                    let _ = proxy.send_event(UserEvent::Rpc(req));
                }
                Err(err) => {
                    eprintln!("[GhostRenderCore] bad rpc: {err}; line={line}");
                }
            }
        }
    });
}

fn number_at(value: &Value, path: &[&str]) -> Option<f64> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    current.as_f64()
}

fn bool_at(value: &Value, path: &[&str]) -> Option<bool> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    current.as_bool()
}

fn vec4_at(value: &Value, key: &str) -> [f32; 4] {
    let Some(values) = value.get(key).and_then(Value::as_array) else {
        return [0.0; 4];
    };
    let mut out = [0.0; 4];
    for (index, slot) in out.iter_mut().enumerate() {
        *slot = values
            .get(index)
            .and_then(Value::as_f64)
            .unwrap_or(0.0)
            .clamp(-1.0e9, 1.0e9) as f32;
    }
    out
}

fn vec4_path_at(value: &Value, path: &[&str]) -> Option<[f32; 4]> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    let values = current.as_array()?;
    if values.len() < 4 {
        return None;
    }
    let mut out = [0.0_f32; 4];
    for (index, slot) in out.iter_mut().enumerate() {
        *slot = values
            .get(index)
            .and_then(Value::as_f64)?
            .clamp(-1.0e9, 1.0e9) as f32;
    }
    Some(out)
}

fn json_object_len(value: &Value) -> usize {
    value.as_object().map(|object| object.len()).unwrap_or(0)
}

fn audio_value_at(value: &Value, key: &str) -> f32 {
    value
        .get(key)
        .and_then(Value::as_f64)
        .unwrap_or(0.0)
        .clamp(0.0, 1.0) as f32
}

fn command_has_key(value: &Value, key: &str) -> bool {
    value
        .as_object()
        .is_some_and(|object| object.contains_key(key))
}

fn audio_value_at_any(value: &Value, canonical_key: &str, legacy_key: &str) -> f32 {
    if command_has_key(value, canonical_key) {
        audio_value_at(value, canonical_key)
    } else {
        audio_value_at(value, legacy_key)
    }
}

fn number_at_any(value: &Value, canonical_key: &str, legacy_key: &str) -> Option<f64> {
    if command_has_key(value, canonical_key) {
        number_at(value, &[canonical_key])
    } else {
        number_at(value, &[legacy_key])
    }
}

fn unit_from_hash(hash: u64) -> f32 {
    ((hash & 0x00ff_ffff) as f32 / 0x00ff_ffff as f32).clamp(0.0, 1.0)
}

fn string_at(value: &Value, path: &[&str]) -> Option<String> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    current.as_str().map(ToString::to_string)
}

fn compute_binding_kind_from_value(value: &Value) -> Option<NativeComputeBufferBindingKind> {
    string_at(value, &["kind"])
        .or_else(|| string_at(value, &["type"]))
        .or_else(|| string_at(value, &["buffer_type"]))
        .and_then(|kind| compute_binding_kind_from_str(&kind))
}

fn compute_graph_binding_resource_id(value: &Value) -> Option<String> {
    string_at(value, &["resource"])
        .or_else(|| string_at(value, &["resource_id"]))
        .or_else(|| string_at(value, &["buffer"]))
}

fn compute_graph_binding_kind_from_value(value: &Value) -> Option<NativeComputeGraphBindingKind> {
    for label in [
        string_at(value, &["resource_kind"]),
        string_at(value, &["resource_type"]),
        string_at(value, &["binding_kind"]),
        string_at(value, &["kind"]),
        string_at(value, &["type"]),
        compute_graph_binding_resource_id(value),
    ]
    .into_iter()
    .flatten()
    {
        if let Some(kind) = compute_graph_binding_kind_from_str(&label) {
            return Some(kind);
        }
    }
    None
}

fn compute_graph_binding_kind_from_str(kind: &str) -> Option<NativeComputeGraphBindingKind> {
    let kind = kind
        .trim()
        .to_ascii_lowercase()
        .replace('_', "-")
        .replace(' ', "-");
    match kind.as_str() {
        "source-frame-texture"
        | "source-frame-texture-2d"
        | "source-texture"
        | "source-texture-2d"
        | "texture-2d" => Some(NativeComputeGraphBindingKind::SourceFrameTexture(
            NativeComputeGraphTextureDimension::D2,
        )),
        "source-frame-texture-array"
        | "source-frame-texture-2d-array"
        | "source-texture-array"
        | "source-texture-2d-array"
        | "texture-2d-array" => Some(NativeComputeGraphBindingKind::SourceFrameTexture(
            NativeComputeGraphTextureDimension::D2Array,
        )),
        "source-frame-sampler" | "source-sampler" => {
            Some(NativeComputeGraphBindingKind::SourceFrameSampler)
        }
        _ => compute_binding_kind_from_str(&kind).map(NativeComputeGraphBindingKind::Buffer),
    }
}

fn compute_binding_kind_from_str(kind: &str) -> Option<NativeComputeBufferBindingKind> {
    let kind = kind.trim().to_ascii_lowercase();
    match kind.as_str() {
        "uniform" | "uniform-buffer" | "uniform_buffer" => {
            Some(NativeComputeBufferBindingKind::Uniform)
        }
        "read" | "readonly" | "read-only" | "read_only" | "read-only-storage"
        | "read_only_storage" | "storage-read" | "storage_read" => {
            Some(NativeComputeBufferBindingKind::StorageRead)
        }
        "storage" | "readwrite" | "read-write" | "read_write" | "read_write_storage"
        | "read-write-storage" | "storage-rw" | "storage_rw" => {
            Some(NativeComputeBufferBindingKind::StorageReadWrite)
        }
        _ => None,
    }
}

fn parse_compute_graph_buffer(value: &Value) -> Result<NativeComputeGraphBufferSpec, String> {
    let Some(id) = string_at(value, &["id"])
        .or_else(|| string_at(value, &["name"]))
        .or_else(|| string_at(value, &["resource"]))
    else {
        return Err("compute_graph buffer missing id".to_string());
    };
    let kind = compute_binding_kind_from_value(value)
        .unwrap_or(NativeComputeBufferBindingKind::StorageReadWrite);
    let mut initial_bytes = compute_initial_bytes(value)?;
    let declared_size = number_at(value, &["byte_length"])
        .or_else(|| number_at(value, &["size"]))
        .or_else(|| number_at(value, &["bytes"]))
        .unwrap_or(initial_bytes.len().max(4) as f64)
        .round()
        .clamp(4.0, 512.0 * 1024.0 * 1024.0) as u64;
    let alignment = if matches!(kind, NativeComputeBufferBindingKind::Uniform) {
        16
    } else {
        4
    };
    let byte_length = align_u64(
        declared_size.max(initial_bytes.len() as u64).max(4),
        alignment,
    );
    if !initial_bytes.is_empty() {
        initial_bytes.resize(byte_length as usize, 0);
    }
    let persistent = bool_at(value, &["persistent"])
        .or_else(|| bool_at(value, &["persist"]))
        .or_else(|| bool_at(value, &["reuse"]))
        .unwrap_or(false);
    let clear = bool_at(value, &["clear"])
        .or_else(|| bool_at(value, &["reset"]))
        .unwrap_or(false);
    let indirect = bool_at(value, &["indirect"])
        .or_else(|| bool_at(value, &["draw_indirect"]))
        .or_else(|| bool_at(value, &["drawIndirect"]))
        .unwrap_or(false);
    Ok(NativeComputeGraphBufferSpec {
        id,
        byte_length,
        kind,
        initial_bytes,
        persistent,
        clear,
        indirect,
    })
}

fn compute_initial_bytes(value: &Value) -> Result<Vec<u8>, String> {
    if let Some(encoded) = string_at(value, &["initial_b64"])
        .or_else(|| string_at(value, &["data_b64"]))
        .or_else(|| string_at(value, &["bytes_b64"]))
    {
        return base64::engine::general_purpose::STANDARD
            .decode(encoded.as_bytes())
            .map_err(|err| err.to_string());
    }
    if let Some(values) = value
        .get("initial_u32")
        .or_else(|| value.get("u32"))
        .and_then(Value::as_array)
    {
        let mut bytes = Vec::with_capacity(values.len() * 4);
        for value in values {
            let n = value
                .as_f64()
                .unwrap_or(0.0)
                .round()
                .clamp(0.0, u32::MAX as f64) as u32;
            bytes.extend_from_slice(&n.to_le_bytes());
        }
        return Ok(bytes);
    }
    if let Some(values) = value
        .get("initial_i32")
        .or_else(|| value.get("i32"))
        .and_then(Value::as_array)
    {
        let mut bytes = Vec::with_capacity(values.len() * 4);
        for value in values {
            let n = value
                .as_f64()
                .unwrap_or(0.0)
                .round()
                .clamp(i32::MIN as f64, i32::MAX as f64) as i32;
            bytes.extend_from_slice(&n.to_le_bytes());
        }
        return Ok(bytes);
    }
    if let Some(values) = value
        .get("initial_f32")
        .or_else(|| value.get("f32"))
        .and_then(Value::as_array)
    {
        let mut bytes = Vec::with_capacity(values.len() * 4);
        for value in values {
            let n = value.as_f64().unwrap_or(0.0).clamp(-1.0e20, 1.0e20) as f32;
            bytes.extend_from_slice(&n.to_le_bytes());
        }
        return Ok(bytes);
    }
    Ok(Vec::new())
}

fn dispatch_from_value(value: &Value) -> [u32; 3] {
    if let Some(values) = value.get("dispatch").and_then(Value::as_array) {
        return [
            values
                .first()
                .and_then(Value::as_f64)
                .unwrap_or(1.0)
                .round()
                .clamp(1.0, u32::MAX as f64) as u32,
            values
                .get(1)
                .and_then(Value::as_f64)
                .unwrap_or(1.0)
                .round()
                .clamp(1.0, u32::MAX as f64) as u32,
            values
                .get(2)
                .and_then(Value::as_f64)
                .unwrap_or(1.0)
                .round()
                .clamp(1.0, u32::MAX as f64) as u32,
        ];
    }
    [
        number_at(value, &["dispatch_x"])
            .or_else(|| number_at(value, &["x"]))
            .unwrap_or(1.0)
            .round()
            .clamp(1.0, u32::MAX as f64) as u32,
        number_at(value, &["dispatch_y"])
            .or_else(|| number_at(value, &["y"]))
            .unwrap_or(1.0)
            .round()
            .clamp(1.0, u32::MAX as f64) as u32,
        number_at(value, &["dispatch_z"])
            .or_else(|| number_at(value, &["z"]))
            .unwrap_or(1.0)
            .round()
            .clamp(1.0, u32::MAX as f64) as u32,
    ]
}

fn compute_graph_readbacks(
    params: &Value,
    buffers: &[NativeComputeGraphBufferSpec],
) -> Vec<String> {
    if let Some(values) = params.get("readbacks").and_then(Value::as_array) {
        let mut out = Vec::new();
        for value in values {
            if let Some(id) = value.as_str() {
                out.push(id.to_string());
            } else if let Some(id) =
                string_at(value, &["id"]).or_else(|| string_at(value, &["buffer"]))
            {
                out.push(id);
            }
        }
        return out;
    }
    buffers
        .iter()
        .filter(|buffer| !matches!(buffer.kind, NativeComputeBufferBindingKind::Uniform))
        .last()
        .map(|buffer| vec![buffer.id.clone()])
        .unwrap_or_default()
}

fn rgba_at(value: &Value, path: &[&str]) -> Option<[f32; 4]> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    let values = current.as_array()?;
    if values.len() < 4 {
        return None;
    }
    Some([
        values[0].as_f64()?.clamp(0.0, 1.0) as f32,
        values[1].as_f64()?.clamp(0.0, 1.0) as f32,
        values[2].as_f64()?.clamp(0.0, 1.0) as f32,
        values[3].as_f64()?.clamp(0.0, 1.0) as f32,
    ])
}

fn params8_at(value: &Value, path: &[&str]) -> Option<[f32; 8]> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    let values = current.as_array()?;
    if values.len() < 8 {
        return None;
    }
    let mut out = [0.0_f32; 8];
    for index in 0..8 {
        out[index] = values[index].as_f64()?.clamp(-16.0, 16.0) as f32;
    }
    Some(out)
}

fn corners_at(value: &Value, path: &[&str]) -> Option<[[f32; 2]; 4]> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    Some([
        point_at(current, "topLeft")?,
        point_at(current, "topRight")?,
        point_at(current, "bottomRight")?,
        point_at(current, "bottomLeft")?,
    ])
}

fn point_at(value: &Value, key: &str) -> Option<[f32; 2]> {
    let point = value.get(key)?;
    Some([
        point.get("x")?.as_f64()?.clamp(-8.0, 8.0) as f32,
        point.get("y")?.as_f64()?.clamp(-8.0, 8.0) as f32,
    ])
}

fn default_native_params() -> [f32; 8] {
    [1.0, 1.0, 0.5, 0.125, 0.0, 0.5, 0.25, 1.0]
}

fn blend_mode_code(mode: &str) -> f32 {
    match mode.trim().to_ascii_lowercase().as_str() {
        "add" | "plus" | "linear-dodge" | "linear_dodge" => 1.0,
        "multiply" => 2.0,
        "screen" => 3.0,
        "overlay" => 4.0,
        "subtract" | "minus" => 5.0,
        "difference" => 6.0,
        "lighten" => 7.0,
        "darken" => 8.0,
        "average" | "avg" => 9.0,
        "hardlight" | "hard-light" | "hard_light" => 10.0,
        "softlight" | "soft-light" | "soft_light" => 11.0,
        "exclusion" => 12.0,
        "color-dodge" | "color_dodge" | "colordodge" | "dodge" => 13.0,
        "color-burn" | "color_burn" | "colorburn" | "burn" => 14.0,
        "hue" => 15.0,
        "saturation" => 16.0,
        "color" => 17.0,
        "luminosity" | "luma" => 18.0,
        "divide" => 19.0,
        "negation" => 20.0,
        "phoenix" => 21.0,
        "linear-light" | "linear_light" | "linearlight" => 22.0,
        "hard-mix" | "hard_mix" | "hardmix" => 23.0,
        "vivid-light" | "vivid_light" | "vividlight" => 24.0,
        "pin-light" | "pin_light" | "pinlight" => 25.0,
        _ => 0.0,
    }
}

fn effect_descriptor_code(descriptor: &str) -> Option<[f32; 4]> {
    let descriptor = descriptor.trim().to_ascii_lowercase();
    if descriptor.is_empty() {
        return None;
    }
    let mut parts = descriptor.split(':');
    let name = parts.next().unwrap_or_default();
    let amount = parts
        .next()
        .and_then(|value| value.parse::<f32>().ok())
        .unwrap_or(1.0);
    match name {
        "invert" => Some([1.0, amount.clamp(0.0, 1.0), 0.0, 0.0]),
        "grayscale" | "greyscale" => Some([2.0, amount.clamp(0.0, 1.0), 0.0, 0.0]),
        "brightness" => Some([3.0, amount.clamp(0.0, 8.0), 0.0, 0.0]),
        "contrast" => Some([4.0, amount.clamp(0.0, 8.0), 0.0, 0.0]),
        "gamma" => Some([5.0, amount.clamp(0.05, 8.0), 0.0, 0.0]),
        "saturation" => Some([6.0, amount.clamp(0.0, 8.0), 0.0, 0.0]),
        "hue" => Some([7.0, amount.clamp(-4.0, 4.0), 0.0, 0.0]),
        "posterize" => Some([8.0, amount.clamp(2.0, 64.0), 0.0, 0.0]),
        "noise" => Some([9.0, amount.clamp(0.0, 1.0), 0.0, 0.0]),
        _ => None,
    }
}

fn stable_layer_color(id: &str, alpha: f32) -> [f32; 4] {
    let mut hash = 2166136261_u32;
    for byte in id.as_bytes() {
        hash ^= *byte as u32;
        hash = hash.wrapping_mul(16777619);
    }
    let hue = (hash % 360) as f32 / 360.0;
    let r = 0.5 + 0.5 * ((hue + 0.00) * std::f32::consts::TAU).cos();
    let g = 0.5 + 0.5 * ((hue + 0.33) * std::f32::consts::TAU).cos();
    let b = 0.5 + 0.5 * ((hue + 0.67) * std::f32::consts::TAU).cos();
    [r.max(0.18), g.max(0.18), b.max(0.18), alpha.clamp(0.0, 1.0)]
}

fn choose_source_frame_format(adapter: &wgpu::Adapter) -> wgpu::TextureFormat {
    let features = adapter.get_texture_format_features(SOURCE_FRAME_FORMAT_HDR);
    let required_usages = wgpu::TextureUsages::TEXTURE_BINDING
        | wgpu::TextureUsages::COPY_DST
        | wgpu::TextureUsages::RENDER_ATTACHMENT;
    if features.allowed_usages.contains(required_usages)
        && features
            .flags
            .contains(wgpu::TextureFormatFeatureFlags::FILTERABLE)
    {
        SOURCE_FRAME_FORMAT_HDR
    } else {
        SOURCE_FRAME_FORMAT_FALLBACK
    }
}

fn choose_source_frame_size(
    limits: &wgpu::Limits,
    features: wgpu::Features,
    format: wgpu::TextureFormat,
) -> usize {
    let tier = native_quality_tier(limits, features);
    let target = match normalize_native_tier(tier) {
        "insane" => SOURCE_FRAME_SIZE_INSANE,
        "ultra" => SOURCE_FRAME_SIZE_DEFAULT,
        "balanced" => SOURCE_FRAME_SIZE_BALANCED,
        "performance" => SOURCE_FRAME_SIZE_PERFORMANCE,
        _ => SOURCE_FRAME_SIZE_DEFAULT,
    };
    let max_dimension = limits.max_texture_dimension_2d as usize;
    let budget_bytes = source_frame_size_budget_bytes(tier);
    let bytes_per_texel = if format == SOURCE_FRAME_FORMAT_HDR {
        8usize
    } else {
        4usize
    };
    [
        SOURCE_FRAME_SIZE_INSANE,
        SOURCE_FRAME_SIZE_DEFAULT,
        SOURCE_FRAME_SIZE_BALANCED,
        SOURCE_FRAME_SIZE_PERFORMANCE,
    ]
    .into_iter()
    .filter(|size| *size <= target)
    .filter(|size| *size <= max_dimension)
    .find(|size| estimate_source_frame_texture_bytes(*size, bytes_per_texel) <= budget_bytes)
    .unwrap_or(SOURCE_FRAME_SIZE_PERFORMANCE.min(max_dimension.max(1)))
}

fn source_frame_mip_levels(size: usize) -> u32 {
    let mut levels = 1u32;
    let mut dimension = size.max(1) as u32;
    while dimension > 1 && levels < SOURCE_FRAME_MIP_LEVELS_MAX {
        dimension = (dimension / 2).max(1);
        levels += 1;
    }
    levels
}

fn source_frame_size_budget_bytes(tier: &str) -> usize {
    let mb = match normalize_native_tier(tier) {
        "insane" => 896usize,
        "ultra" => 384usize,
        "balanced" => 256usize,
        "performance" => 128usize,
        _ => 256usize,
    };
    mb * 1024 * 1024
}

fn estimate_source_frame_texture_bytes(size: usize, bytes_per_texel: usize) -> usize {
    size.saturating_mul(size)
        .saturating_mul(bytes_per_texel)
        .saturating_mul(MAX_SOURCE_FRAME_SLOTS)
}

fn texture_format_label(format: wgpu::TextureFormat) -> &'static str {
    match format {
        wgpu::TextureFormat::Rgba16Float => "rgba16float",
        wgpu::TextureFormat::Rgba8Unorm => "rgba8unorm",
        wgpu::TextureFormat::Bgra8Unorm => "bgra8unorm",
        _ => "unknown",
    }
}

fn texture_format_bytes_per_texel(format: wgpu::TextureFormat) -> usize {
    match format {
        wgpu::TextureFormat::Rgba16Float => 8,
        wgpu::TextureFormat::Rgba8Unorm | wgpu::TextureFormat::Bgra8Unorm => 4,
        _ => 4,
    }
}

fn wgpu_texture_format_for_shared_texture(
    descriptor: &SharedTextureSourceFrameDescriptor,
) -> wgpu::TextureFormat {
    match normalized_shared_texture_format(descriptor).as_str() {
        "rgba8unorm" | "70" => wgpu::TextureFormat::Rgba8Unorm,
        "bgra8unorm" | "80" | "87" => wgpu::TextureFormat::Bgra8Unorm,
        _ => wgpu::TextureFormat::Bgra8Unorm,
    }
}

#[cfg(target_os = "macos")]
fn metal_texture_format_for_shared_texture(
    descriptor: &SharedTextureSourceFrameDescriptor,
) -> objc2_metal::MTLPixelFormat {
    match normalized_shared_texture_format(descriptor).as_str() {
        "rgba8unorm" | "70" => objc2_metal::MTLPixelFormat::RGBA8Unorm,
        "bgra8unorm" | "80" | "87" => objc2_metal::MTLPixelFormat::BGRA8Unorm,
        _ => objc2_metal::MTLPixelFormat::BGRA8Unorm,
    }
}

fn normalized_shared_texture_format(descriptor: &SharedTextureSourceFrameDescriptor) -> String {
    descriptor
        .format
        .trim()
        .to_ascii_lowercase()
        .replace(['-', '_'], "")
}

fn source_frame_upload_payload<'a>(
    rgba: &'a [u8],
    frame_size: usize,
    format: wgpu::TextureFormat,
) -> (Cow<'a, [u8]>, u32) {
    if format != SOURCE_FRAME_FORMAT_HDR {
        return (Cow::Borrowed(rgba), (frame_size * 4) as u32);
    }

    let channel_count = frame_size * frame_size * 4;
    let mut payload = Vec::with_capacity(channel_count * 2);
    for channel in rgba.iter().take(channel_count) {
        payload.extend_from_slice(&unorm8_to_f16_bits(*channel).to_le_bytes());
    }
    (Cow::Owned(payload), (frame_size * 8) as u32)
}

fn unorm8_to_f16_bits(channel: u8) -> u16 {
    if channel == 0 {
        return 0;
    }
    f32_to_f16_bits(channel as f32 / 255.0)
}

fn f32_to_f16_bits(value: f32) -> u16 {
    let bits = value.to_bits();
    let sign = ((bits >> 16) & 0x8000) as u16;
    let exponent = ((bits >> 23) & 0xff) as i32 - 127 + 15;
    let mantissa = bits & 0x7f_ffff;

    if exponent <= 0 {
        if exponent < -10 {
            return sign;
        }
        let normalized = mantissa | 0x80_0000;
        let shift = (14 - exponent) as u32;
        let mut half = (normalized >> shift) as u16;
        if ((normalized >> (shift - 1)) & 1) != 0 {
            half = half.saturating_add(1);
        }
        sign | half
    } else if exponent >= 31 {
        sign | 0x7c00
    } else {
        let mut half = sign | ((exponent as u16) << 10) | ((mantissa >> 13) as u16);
        if (mantissa & 0x1000) != 0 {
            half = half.saturating_add(1);
        }
        half
    }
}

fn source_kind(source_type: &str) -> f32 {
    if source_type.starts_with("gpu:") {
        return match source_type {
            "gpu:planet" => 10.0,
            "gpu:pixel-particles" => 11.0,
            "gpu:flythrough" => 12.0,
            "gpu:point-cloud-fx" => 13.0,
            "gpu:particle-field" | "gpu:gravity-wells" => 14.0,
            "gpu:volumetric-balls" => 15.0,
            "gpu:smoke-riders" | "gpu:ink-cloud" | "gpu:smoke-3d" => 16.0,
            _ => 9.0,
        };
    }
    match source_type {
        "color" => 1.0,
        "shader" => 2.0,
        "video" => 3.0,
        "image" => 4.0,
        _ => 0.0,
    }
}

fn is_native_instrument_kind(source_kind: f32) -> bool {
    matches!(source_kind.round() as i32, 10 | 11 | 12 | 13 | 14 | 15 | 16)
}

fn source_type_color(source_type: &str, id: &str) -> [f32; 4] {
    if source_type.starts_with("gpu:") {
        return match source_type {
            "gpu:planet" => [0.22, 0.62, 1.0, 0.86],
            "gpu:pixel-particles" | "gpu:flythrough" | "gpu:point-cloud-fx" => {
                [1.0, 0.35, 0.82, 0.82]
            }
            "gpu:particle-field" | "gpu:gravity-wells" => [0.25, 1.0, 0.78, 0.84],
            "gpu:volumetric-balls" => [0.78, 0.58, 1.0, 0.86],
            "gpu:smoke-riders" | "gpu:ink-cloud" | "gpu:smoke-3d" => [0.62, 0.82, 1.0, 0.80],
            _ => stable_layer_color(id, 0.76),
        };
    }
    match source_type {
        "shader" => [0.45, 0.92, 1.0, 0.74],
        "video" => [0.28, 1.0, 0.55, 0.70],
        "image" => [1.0, 0.62, 0.26, 0.70],
        "none" => [0.3, 0.34, 0.42, 0.35],
        _ => stable_layer_color(id, 0.66),
    }
}

#[derive(Clone, Debug)]
struct SnapshotMetrics {
    checksum: String,
    nonzero_pixels: u64,
    bright_pixels: u64,
    transparent_pixels: u64,
    average_luma: f64,
    max_luma: f64,
    mean_rgba: [f64; 4],
    dark_frame: bool,
}

fn align_u32(value: u32, alignment: u32) -> u32 {
    if alignment == 0 {
        return value;
    }
    value.div_ceil(alignment).saturating_mul(alignment)
}

fn align_u64(value: u64, alignment: u64) -> u64 {
    if alignment == 0 {
        return value;
    }
    value.div_ceil(alignment).saturating_mul(alignment)
}

fn snapshot_metrics(bytes: &[u8], format: wgpu::TextureFormat) -> SnapshotMetrics {
    let bgra = matches!(
        format,
        wgpu::TextureFormat::Bgra8Unorm | wgpu::TextureFormat::Bgra8UnormSrgb
    );
    let mut checksum = 0xcbf29ce484222325_u64;
    let mut nonzero_pixels = 0_u64;
    let mut bright_pixels = 0_u64;
    let mut transparent_pixels = 0_u64;
    let mut luma_sum = 0.0_f64;
    let mut max_luma = 0.0_f64;
    let mut rgba_sum = [0.0_f64; 4];
    let mut pixel_count = 0_u64;
    for pixel in bytes.chunks_exact(4) {
        for byte in pixel {
            checksum ^= *byte as u64;
            checksum = checksum.wrapping_mul(0x100000001b3);
        }
        let (r, g, b, a) = if bgra {
            (pixel[2], pixel[1], pixel[0], pixel[3])
        } else {
            (pixel[0], pixel[1], pixel[2], pixel[3])
        };
        let luma = 0.2126 * r as f64 + 0.7152 * g as f64 + 0.0722 * b as f64;
        if a > 0 && luma > 2.0 {
            nonzero_pixels = nonzero_pixels.saturating_add(1);
        }
        if a > 0 && luma > 96.0 {
            bright_pixels = bright_pixels.saturating_add(1);
        }
        if a == 0 {
            transparent_pixels = transparent_pixels.saturating_add(1);
        }
        rgba_sum[0] += r as f64;
        rgba_sum[1] += g as f64;
        rgba_sum[2] += b as f64;
        rgba_sum[3] += a as f64;
        luma_sum += luma;
        max_luma = max_luma.max(luma);
        pixel_count = pixel_count.saturating_add(1);
    }
    let average_luma = if pixel_count == 0 {
        0.0
    } else {
        luma_sum / pixel_count as f64 / 255.0
    };
    let mean_rgba = if pixel_count == 0 {
        [0.0; 4]
    } else {
        [
            rgba_sum[0] / pixel_count as f64 / 255.0,
            rgba_sum[1] / pixel_count as f64 / 255.0,
            rgba_sum[2] / pixel_count as f64 / 255.0,
            rgba_sum[3] / pixel_count as f64 / 255.0,
        ]
    };
    SnapshotMetrics {
        checksum: format!("{checksum:016x}"),
        nonzero_pixels,
        bright_pixels,
        transparent_pixels,
        average_luma,
        max_luma: max_luma / 255.0,
        mean_rgba,
        dark_frame: nonzero_pixels < (pixel_count / 200).max(1) || average_luma < 0.006,
    }
}

fn looks_like_wgsl(source: &str) -> bool {
    let s = source.trim();
    s.contains("@vertex")
        || s.contains("@fragment")
        || s.contains("@compute")
        || s.contains("var<")
        || s.contains("vec2<")
        || s.contains("vec3<")
        || s.contains("vec4<")
        || (s.contains("fn ") && s.contains("->"))
}

fn native_fragment_entry(record: &ShaderRecord, source: &str) -> Option<String> {
    if !native_wgsl_fragment_supported(source) {
        return None;
    }
    let preferred = record.entry.trim();
    if !preferred.is_empty() && record.entry_points.iter().any(|entry| entry == preferred) {
        return Some(preferred.to_string());
    }
    ["fs_main", "main"].iter().find_map(|candidate| {
        record
            .entry_points
            .iter()
            .any(|entry| entry == candidate)
            .then(|| candidate.to_string())
    })
}

fn native_compute_entry(record: &ShaderRecord, source: &str) -> Option<String> {
    if !source.trim().contains("@compute") {
        return None;
    }
    let preferred = record.entry.trim();
    if !preferred.is_empty() && record.entry_points.iter().any(|entry| entry == preferred) {
        return Some(preferred.to_string());
    }
    ["cs_main", "main"].iter().find_map(|candidate| {
        record
            .entry_points
            .iter()
            .any(|entry| entry == candidate)
            .then(|| candidate.to_string())
    })
}

fn native_wgsl_fragment_supported(source: &str) -> bool {
    let source = source.trim();
    source.contains("@fragment") && native_wgsl_bindings_supported(source)
}

fn native_wgsl_bindings_supported(source: &str) -> bool {
    if !source.contains("@group") && !source.contains("@binding") {
        return true;
    }
    all_wgsl_attribute_indices_at_most(source, "@group", 0)
        && all_wgsl_attribute_indices_at_most(source, "@binding", 2)
}

fn all_wgsl_attribute_indices_at_most(source: &str, attribute: &str, max_supported: u32) -> bool {
    let mut rest = source;
    while let Some(index) = rest.find(attribute) {
        rest = &rest[index + attribute.len()..];
        let Some(open_index) = rest.find('(') else {
            return false;
        };
        rest = &rest[open_index + 1..];
        let trimmed = rest.trim_start();
        let digits = trimmed
            .chars()
            .take_while(|ch| ch.is_ascii_digit())
            .collect::<String>();
        let Ok(value) = digits.parse::<u32>() else {
            return false;
        };
        if value > max_supported {
            return false;
        }
    }
    true
}

fn native_shader_pipeline_key(record: &ShaderRecord, shader_id: &str, entry: &str) -> String {
    format!("{shader_id}:{}:{entry}", record.source_hash)
}

fn native_graph_render_pipeline_key(base_key: &str, output_format: wgpu::TextureFormat) -> String {
    format!(
        "{base_key}:target-format:{}",
        texture_format_label(output_format)
    )
}

fn stable_hash64(input: &str) -> u64 {
    let mut hash = 0xcbf29ce484222325_u64;
    for byte in input.as_bytes() {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

fn json_channel_to_unit(value: &Value) -> f32 {
    let n = value.as_f64().unwrap_or(0.0);
    if n > 1.0 {
        (n / 255.0).clamp(0.0, 1.0) as f32
    } else {
        n.clamp(0.0, 1.0) as f32
    }
}

fn preview_rgba_at(rgba: &[Value], width: usize, height: usize, x: usize, y: usize) -> [f32; 4] {
    let sx = x.min(width.saturating_sub(1));
    let sy = y.min(height.saturating_sub(1));
    let index = (sy * width + sx) * 4;
    [
        json_channel_to_unit(&rgba[index]),
        json_channel_to_unit(&rgba[index + 1]),
        json_channel_to_unit(&rgba[index + 2]),
        json_channel_to_unit(&rgba[index + 3]),
    ]
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum SourceFrameTransport {
    File,
    Base64,
    Json,
    SharedTexture,
    Unknown,
}

impl SourceFrameTransport {
    fn as_str(self) -> &'static str {
        match self {
            Self::File => "file",
            Self::Base64 => "base64",
            Self::Json => "json",
            Self::SharedTexture => "shared-texture",
            Self::Unknown => "unknown",
        }
    }

    fn is_cpu_fallback(self) -> bool {
        matches!(self, Self::File | Self::Base64 | Self::Json)
    }
}

fn source_frame_transport_from_command(command: &Value) -> SourceFrameTransport {
    if command.get("shared_handle").is_some() || command.get("shared_texture").is_some() {
        return SourceFrameTransport::SharedTexture;
    }
    if command.get("rgba_file").is_some() {
        return SourceFrameTransport::File;
    }
    if command.get("rgba_b64").is_some() {
        return SourceFrameTransport::Base64;
    }
    if command.get("rgba").is_some() {
        return SourceFrameTransport::Json;
    }
    SourceFrameTransport::Unknown
}

fn rgba_bytes_from_command(command: &Value, width: usize, height: usize) -> Option<Vec<u8>> {
    let expected = width.saturating_mul(height).saturating_mul(4);
    if let Some(file_path) = command.get("rgba_file").and_then(Value::as_str) {
        let bytes = fs::read(file_path).ok()?;
        if command
            .get("rgba_file_delete")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            let _ = fs::remove_file(file_path);
        }
        let declared_len = command
            .get("rgba_byte_length")
            .and_then(Value::as_u64)
            .unwrap_or(bytes.len() as u64) as usize;
        if bytes.len() < declared_len || bytes.len() < expected {
            return None;
        }
        return Some(bytes);
    }
    if let Some(encoded) = command.get("rgba_b64").and_then(Value::as_str) {
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(encoded.as_bytes())
            .ok()?;
        return (decoded.len() >= expected).then_some(decoded);
    }
    let rgba = command.get("rgba").and_then(Value::as_array)?;
    if rgba.len() < expected {
        return None;
    }
    let mut bytes = Vec::with_capacity(expected);
    for value in rgba.iter().take(expected) {
        let n = value.as_f64().unwrap_or(0.0);
        bytes.push(n.round().clamp(0.0, 255.0) as u8);
    }
    Some(bytes)
}

fn frame_rgba_at(rgba: &[u8], width: usize, height: usize, x: usize, y: usize) -> [f32; 4] {
    let sx = x.min(width.saturating_sub(1));
    let sy = y.min(height.saturating_sub(1));
    let index = (sy * width + sx) * 4;
    [
        rgba[index] as f32,
        rgba[index + 1] as f32,
        rgba[index + 2] as f32,
        rgba[index + 3] as f32,
    ]
}

fn resample_frame_bytes(
    rgba: &[u8],
    width: usize,
    height: usize,
    dst_width: usize,
    dst_height: usize,
) -> Vec<u8> {
    let mut out = vec![0u8; dst_width.saturating_mul(dst_height).saturating_mul(4)];
    let scale_x = width as f32 / dst_width.max(1) as f32;
    let scale_y = height as f32 / dst_height.max(1) as f32;
    for y in 0..dst_height {
        let source_y = ((y as f32 + 0.5) * scale_y - 0.5).clamp(0.0, (height - 1) as f32);
        let y0 = source_y.floor().max(0.0) as usize;
        let y1 = (y0 + 1).min(height.saturating_sub(1));
        let ty = (source_y - y0 as f32).clamp(0.0, 1.0);
        for x in 0..dst_width {
            let source_x = ((x as f32 + 0.5) * scale_x - 0.5).clamp(0.0, (width - 1) as f32);
            let x0 = source_x.floor().max(0.0) as usize;
            let x1 = (x0 + 1).min(width.saturating_sub(1));
            let tx = (source_x - x0 as f32).clamp(0.0, 1.0);
            let top = mix_rgba(
                frame_rgba_at(rgba, width, height, x0, y0),
                frame_rgba_at(rgba, width, height, x1, y0),
                tx,
            );
            let bottom = mix_rgba(
                frame_rgba_at(rgba, width, height, x0, y1),
                frame_rgba_at(rgba, width, height, x1, y1),
                tx,
            );
            let mixed = mix_rgba(top, bottom, ty);
            let dst = (y * dst_width + x) * 4;
            out[dst] = mixed[0].round().clamp(0.0, 255.0) as u8;
            out[dst + 1] = mixed[1].round().clamp(0.0, 255.0) as u8;
            out[dst + 2] = mixed[2].round().clamp(0.0, 255.0) as u8;
            out[dst + 3] = mixed[3].round().clamp(0.0, 255.0) as u8;
        }
    }
    out
}

fn mix_rgba(a: [f32; 4], b: [f32; 4], t: f32) -> [f32; 4] {
    let mix = |x: f32, y: f32| x + (y - x) * t;
    [
        mix(a[0], b[0]),
        mix(a[1], b[1]),
        mix(a[2], b[2]),
        mix(a[3], b[3]),
    ]
}

fn resample_preview_pixel(
    rgba: &[Value],
    width: usize,
    height: usize,
    source_x: f32,
    source_y: f32,
) -> PreviewPixel {
    let x0 = source_x.floor().max(0.0) as usize;
    let y0 = source_y.floor().max(0.0) as usize;
    let x1 = (x0 + 1).min(width.saturating_sub(1));
    let y1 = (y0 + 1).min(height.saturating_sub(1));
    let tx = (source_x - x0 as f32).clamp(0.0, 1.0);
    let ty = (source_y - y0 as f32).clamp(0.0, 1.0);

    let top = mix_rgba(
        preview_rgba_at(rgba, width, height, x0, y0),
        preview_rgba_at(rgba, width, height, x1, y0),
        tx,
    );
    let bottom = mix_rgba(
        preview_rgba_at(rgba, width, height, x0, y1),
        preview_rgba_at(rgba, width, height, x1, y1),
        tx,
    );

    PreviewPixel {
        rgba: mix_rgba(top, bottom, ty),
    }
}

fn stable_slot(id: &str, slot_count: usize) -> usize {
    let mut hash = 2166136261_u32;
    for byte in id.as_bytes() {
        hash ^= *byte as u32;
        hash = hash.wrapping_mul(16777619);
    }
    (hash as usize) % slot_count.max(1)
}

fn epoch_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

fn native_backend_name() -> &'static str {
    if cfg!(target_os = "macos") {
        "metal"
    } else if cfg!(target_os = "windows") {
        "d3d12"
    } else {
        "vulkan"
    }
}

fn choose_present_mode(
    supported: &[wgpu::PresentMode],
    requested: &str,
    allow_tearing: bool,
) -> wgpu::PresentMode {
    let wants_immediate = matches!(
        requested.trim().to_ascii_lowercase().as_str(),
        "immediate" | "no-vsync" | "novsync"
    );
    if wants_immediate {
        if allow_tearing && supported.contains(&wgpu::PresentMode::Immediate) {
            return wgpu::PresentMode::Immediate;
        }
        if supported.contains(&wgpu::PresentMode::Mailbox) {
            return wgpu::PresentMode::Mailbox;
        }
        if supported.contains(&wgpu::PresentMode::Immediate) {
            return wgpu::PresentMode::Immediate;
        }
        if supported.contains(&wgpu::PresentMode::AutoNoVsync) {
            return wgpu::PresentMode::AutoNoVsync;
        }
    }
    if supported.contains(&wgpu::PresentMode::Fifo) {
        return wgpu::PresentMode::Fifo;
    }
    if supported.contains(&wgpu::PresentMode::AutoVsync) {
        return wgpu::PresentMode::AutoVsync;
    }
    supported
        .first()
        .copied()
        .unwrap_or(wgpu::PresentMode::AutoVsync)
}

fn present_mode_label(mode: wgpu::PresentMode) -> &'static str {
    match mode {
        wgpu::PresentMode::AutoVsync => "auto-vsync",
        wgpu::PresentMode::AutoNoVsync => "auto-no-vsync",
        wgpu::PresentMode::Fifo => "fifo",
        wgpu::PresentMode::FifoRelaxed => "fifo-relaxed",
        wgpu::PresentMode::Immediate => "immediate",
        wgpu::PresentMode::Mailbox => "mailbox",
    }
}

fn native_optional_features() -> wgpu::Features {
    wgpu::Features::SHADER_F16
        | wgpu::Features::FLOAT32_FILTERABLE
        | wgpu::Features::TIMESTAMP_QUERY
        | wgpu::Features::TIMESTAMP_QUERY_INSIDE_ENCODERS
        | wgpu::Features::TIMESTAMP_QUERY_INSIDE_PASSES
}

fn native_gpu_caps(
    adapter_info: &wgpu::AdapterInfo,
    limits: &wgpu::Limits,
    supported: wgpu::Features,
    requested: wgpu::Features,
) -> NativeGpuCaps {
    NativeGpuCaps {
        adapter_name: adapter_info.name.clone(),
        adapter_vendor: adapter_info.vendor,
        adapter_device: adapter_info.device,
        adapter_device_type: format!("{:?}", adapter_info.device_type),
        adapter_driver: adapter_info.driver.clone(),
        adapter_driver_info: adapter_info.driver_info.clone(),
        max_texture_dimension_2d: limits.max_texture_dimension_2d,
        max_texture_dimension_3d: limits.max_texture_dimension_3d,
        max_texture_array_layers: limits.max_texture_array_layers,
        max_bind_groups: limits.max_bind_groups,
        max_bindings_per_bind_group: limits.max_bindings_per_bind_group,
        max_sampled_textures_per_shader_stage: limits.max_sampled_textures_per_shader_stage,
        max_storage_buffers_per_shader_stage: limits.max_storage_buffers_per_shader_stage,
        max_storage_textures_per_shader_stage: limits.max_storage_textures_per_shader_stage,
        max_uniform_buffer_binding_size: limits.max_uniform_buffer_binding_size,
        max_storage_buffer_binding_size: limits.max_storage_buffer_binding_size,
        max_buffer_size: limits.max_buffer_size,
        max_compute_workgroup_storage_size: limits.max_compute_workgroup_storage_size,
        max_compute_invocations_per_workgroup: limits.max_compute_invocations_per_workgroup,
        max_compute_workgroup_size_x: limits.max_compute_workgroup_size_x,
        max_compute_workgroup_size_y: limits.max_compute_workgroup_size_y,
        max_compute_workgroup_size_z: limits.max_compute_workgroup_size_z,
        max_compute_workgroups_per_dimension: limits.max_compute_workgroups_per_dimension,
        supports_shader_f16: supported.contains(wgpu::Features::SHADER_F16),
        supports_float32_filterable: supported.contains(wgpu::Features::FLOAT32_FILTERABLE),
        supports_timestamp_query: supported.contains(wgpu::Features::TIMESTAMP_QUERY),
        supports_timestamp_query_inside_encoders: supported
            .contains(wgpu::Features::TIMESTAMP_QUERY_INSIDE_ENCODERS),
        supports_timestamp_query_inside_passes: supported
            .contains(wgpu::Features::TIMESTAMP_QUERY_INSIDE_PASSES),
        supports_texture_binding_array: supported.contains(wgpu::Features::TEXTURE_BINDING_ARRAY),
        supports_buffer_binding_array: supported.contains(wgpu::Features::BUFFER_BINDING_ARRAY),
        supports_storage_resource_binding_array: supported
            .contains(wgpu::Features::STORAGE_RESOURCE_BINDING_ARRAY),
        supports_texture_adapter_specific_format_features: supported
            .contains(wgpu::Features::TEXTURE_ADAPTER_SPECIFIC_FORMAT_FEATURES),
        requested_shader_f16: requested.contains(wgpu::Features::SHADER_F16),
        requested_float32_filterable: requested.contains(wgpu::Features::FLOAT32_FILTERABLE),
        requested_timestamp_query: requested.contains(wgpu::Features::TIMESTAMP_QUERY),
        requested_timestamp_query_inside_encoders: requested
            .contains(wgpu::Features::TIMESTAMP_QUERY_INSIDE_ENCODERS),
        requested_timestamp_query_inside_passes: requested
            .contains(wgpu::Features::TIMESTAMP_QUERY_INSIDE_PASSES),
        recommended_quality_tier: native_quality_tier(limits, supported).to_string(),
    }
}

fn native_quality_tier(limits: &wgpu::Limits, features: wgpu::Features) -> &'static str {
    let storage_mb = limits.max_storage_buffer_binding_size / (1024 * 1024);
    let buffer_mb = limits.max_buffer_size / (1024 * 1024);
    let has_f16 = features.contains(wgpu::Features::SHADER_F16);
    let has_float_filter = features.contains(wgpu::Features::FLOAT32_FILTERABLE);
    let compute = limits.max_compute_invocations_per_workgroup;

    if has_f16
        && has_float_filter
        && limits.max_texture_dimension_3d >= 2048
        && storage_mb >= 512
        && buffer_mb >= 1024
        && compute >= 512
    {
        return "insane";
    }
    if has_f16
        && limits.max_texture_dimension_3d >= 1024
        && storage_mb >= 256
        && buffer_mb >= 512
        && compute >= 256
    {
        return "ultra";
    }
    if limits.max_texture_dimension_3d >= 512 && storage_mb >= 128 && buffer_mb >= 256 {
        return "balanced";
    }
    "performance"
}

fn normalize_native_tier(tier: &str) -> &'static str {
    match tier.trim().to_ascii_lowercase().as_str() {
        "insane" => "insane",
        "ultra" => "ultra",
        "balanced" | "balance" => "balanced",
        "performance" | "perf" | "low" => "performance",
        _ => "balanced",
    }
}

fn native_tier_index(tier: &str) -> i32 {
    match normalize_native_tier(tier) {
        "performance" => 0,
        "balanced" => 1,
        "ultra" => 2,
        "insane" => 3,
        _ => 1,
    }
}

fn native_tier_for_index(index: i32) -> &'static str {
    match index {
        0 => "performance",
        1 => "balanced",
        2 => "ultra",
        3 => "insane",
        _ if index < 0 => "performance",
        _ => "insane",
    }
}

fn tier_quality_scale(tier: &str) -> f32 {
    match normalize_native_tier(tier) {
        "performance" => 0.56,
        "balanced" => 0.72,
        "ultra" => 0.90,
        "insane" => 1.0,
        _ => 0.72,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ghost_audio_uniform_layout_documents_the_native_slots() {
        let layout = ghost_audio_uniform_layout();
        assert_eq!(layout["schema_version"], json!(1));
        assert_eq!(layout["audio0"], json!(["level", "bass", "mid", "treble"]));
        assert_eq!(
            layout["audio1"],
            json!(["high", "beat", "beat_phase", "bpm"])
        );
        assert_eq!(
            layout["audio2"],
            json!(["centroid", "kick", "snare", "active"])
        );
    }

    #[test]
    fn ghost_audio_uniforms_pack_and_clamp_command_fields() {
        let audio = GhostAudioUniforms::from_command(&json!({
            "active": true,
            "level": 1.2,
            "bass": 0.54,
            "mid": 0.35,
            "treble": 0.45,
            "high": 0.55,
            "beat": 0.65,
            "beat_phase": -1.0,
            "bpm": 900.0,
            "centroid": 0.42,
            "kick": 0.8,
            "snare": 0.15,
        }));

        assert_eq!(audio.audio0, [1.0, 0.54, 0.35, 0.45]);
        assert_eq!(audio.audio1, [0.55, 0.65, 0.0, 300.0]);
        assert_eq!(audio.audio2, [0.42, 0.8, 0.15, 1.0]);
    }

    #[test]
    fn isf_audio_uniforms_accept_canonical_and_legacy_fields() {
        let canonical = GhostAudioUniforms::from_isf_command(&json!({
            "active": true,
            "level": 0.1,
            "bass": 0.2,
            "mid": 0.3,
            "treble": 0.4,
            "high": 0.5,
            "beat": 0.6,
            "beat_phase": 0.7,
            "bpm": 128,
            "centroid": 0.8,
            "kick": 0.9,
            "snare": 1.2,
        }));
        assert_eq!(canonical.audio0, [0.1, 0.2, 0.3, 0.4]);
        assert_eq!(canonical.audio1, [0.5, 0.6, 0.7, 128.0]);
        assert_eq!(canonical.audio2, [0.8, 0.9, 1.0, 1.0]);

        let legacy = GhostAudioUniforms::from_isf_command(&json!({
            "audio_level": 0.11,
            "audio_bass": 0.22,
            "audio_mid": 0.33,
            "audio_high": 0.44,
            "audio_beat": 0.55,
            "audio_beat_phase": 0.66,
            "audio_bpm": 92,
            "audio_spectral_centroid": 0.77,
            "audio_kick": 0.88,
            "audio_snare": 0.99,
        }));
        assert_eq!(legacy.audio0, [0.11, 0.22, 0.33, 0.44]);
        assert_eq!(legacy.audio1, [0.44, 0.55, 0.66, 92.0]);
        assert_eq!(legacy.audio2, [0.77, 0.88, 0.99, 1.0]);
    }

    #[test]
    fn native_shader_uniforms_append_audio2_without_moving_params() {
        assert!(
            std::mem::offset_of!(NativeShaderUniforms, audio2)
                > std::mem::offset_of!(NativeShaderUniforms, params1)
        );

        let state = IsfUniformState {
            shader_id: "shader".to_string(),
            time: 1.25,
            time_delta: 1.0 / 30.0,
            frame_index: 7,
            render_width: 320.0,
            render_height: 180.0,
            date: [2026.0, 7.0, 3.0, 123.0],
            audio0: [0.1, 0.2, 0.3, 0.4],
            audio1: [0.5, 0.6, 0.7, 128.0],
            audio2: [0.8, 0.9, 1.0, 1.0],
            float_hash: 0,
            point_hash: 0,
            color_hash: 0,
            input_count: 0,
            seq: 1,
        };
        let uniforms =
            NativeShaderUniforms::from_isf("shader", Some(&state), 640, 360, [0.0; 8], 0);
        assert_eq!(uniforms.audio0, state.audio0);
        assert_eq!(uniforms.audio1, state.audio1);
        assert_eq!(uniforms.audio2, state.audio2);
        assert_eq!(uniforms.params0, [0.0; 4]);
        assert_eq!(uniforms.params1, [0.0; 4]);
    }
}
