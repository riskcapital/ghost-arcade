use serde::Serialize;

#[derive(Clone, Debug, Default, Serialize)]
pub(crate) struct NativeGpuCaps {
    pub(crate) adapter_name: String,
    pub(crate) adapter_vendor: u32,
    pub(crate) adapter_device: u32,
    pub(crate) adapter_device_type: String,
    pub(crate) adapter_driver: String,
    pub(crate) adapter_driver_info: String,
    pub(crate) max_texture_dimension_2d: u32,
    pub(crate) max_texture_dimension_3d: u32,
    pub(crate) max_texture_array_layers: u32,
    pub(crate) max_bind_groups: u32,
    pub(crate) max_bindings_per_bind_group: u32,
    pub(crate) max_sampled_textures_per_shader_stage: u32,
    pub(crate) max_storage_buffers_per_shader_stage: u32,
    pub(crate) max_storage_textures_per_shader_stage: u32,
    pub(crate) max_uniform_buffer_binding_size: u64,
    pub(crate) max_storage_buffer_binding_size: u64,
    pub(crate) max_buffer_size: u64,
    pub(crate) max_compute_workgroup_storage_size: u32,
    pub(crate) max_compute_invocations_per_workgroup: u32,
    pub(crate) max_compute_workgroup_size_x: u32,
    pub(crate) max_compute_workgroup_size_y: u32,
    pub(crate) max_compute_workgroup_size_z: u32,
    pub(crate) max_compute_workgroups_per_dimension: u32,
    pub(crate) supports_shader_f16: bool,
    pub(crate) supports_float32_filterable: bool,
    pub(crate) supports_timestamp_query: bool,
    pub(crate) supports_timestamp_query_inside_encoders: bool,
    pub(crate) supports_timestamp_query_inside_passes: bool,
    pub(crate) supports_texture_binding_array: bool,
    pub(crate) supports_buffer_binding_array: bool,
    pub(crate) supports_storage_resource_binding_array: bool,
    pub(crate) supports_texture_adapter_specific_format_features: bool,
    pub(crate) requested_shader_f16: bool,
    pub(crate) requested_float32_filterable: bool,
    pub(crate) requested_timestamp_query: bool,
    pub(crate) requested_timestamp_query_inside_encoders: bool,
    pub(crate) requested_timestamp_query_inside_passes: bool,
    pub(crate) recommended_quality_tier: String,
}

#[derive(Clone, Debug, Serialize)]
pub(crate) struct NativeQualityState {
    pub(crate) policy: String,
    pub(crate) caps_tier: String,
    pub(crate) active_tier: String,
    pub(crate) quality_scale: f32,
    pub(crate) target_frame_ms: f64,
    pub(crate) cpu_ema_ms: f64,
    pub(crate) gpu_ema_ms: f64,
    pub(crate) overload_frames: u32,
    pub(crate) recovery_frames: u32,
    pub(crate) step_downs: u64,
    pub(crate) step_ups: u64,
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
    pub(crate) fn rebase_to_caps(&mut self, caps_tier: &str) {
        let tier = normalize_native_tier(caps_tier);
        self.caps_tier = tier.to_string();
        if self.policy == "auto" {
            let startup_tier = auto_start_tier(tier);
            self.active_tier = startup_tier.to_string();
            self.quality_scale = tier_quality_scale(startup_tier);
            self.overload_frames = 0;
            self.recovery_frames = 0;
        }
    }

    pub(crate) fn set_policy(&mut self, policy: &str) {
        let normalized = policy.trim().to_ascii_lowercase();
        if normalized == "fixed" || normalized == "native" {
            self.policy = "fixed".to_string();
            self.active_tier = "native".to_string();
            self.quality_scale = 1.0;
        } else if normalized == "auto" || normalized.is_empty() {
            self.policy = "auto".to_string();
            let tier = auto_start_tier(&self.caps_tier);
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

    pub(crate) fn observe_frame(
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
}

fn auto_start_tier(caps_tier: &str) -> &'static str {
    let tier = normalize_native_tier(caps_tier);
    if native_tier_index(tier) > native_tier_index("balanced") {
        "balanced"
    } else {
        tier
    }
}

pub(crate) fn native_optional_features() -> wgpu::Features {
    wgpu::Features::SHADER_F16
        | wgpu::Features::FLOAT32_FILTERABLE
        | wgpu::Features::TIMESTAMP_QUERY
        | wgpu::Features::TIMESTAMP_QUERY_INSIDE_ENCODERS
        | wgpu::Features::TIMESTAMP_QUERY_INSIDE_PASSES
}

pub(crate) fn native_gpu_caps(
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

pub(crate) fn native_quality_tier(limits: &wgpu::Limits, features: wgpu::Features) -> &'static str {
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

pub(crate) fn normalize_native_tier(tier: &str) -> &'static str {
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
