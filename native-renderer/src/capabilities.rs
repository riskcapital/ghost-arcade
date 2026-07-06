pub const COMPUTE_INSTRUMENT_HOST_FEATURES: &[&str] = &[
    "compute_shader_host",
    "compute_graph_host",
    "compute_graph_render",
    "compute_graph_source_frame_target",
    "persistent_compute_buffers",
];

pub const CORE_RPC_METHODS: &[&str] = &[
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
    "export_frame_snapshot",
    "prefetch_media",
    "clear_prefetch_cache",
    "clear_decode_preview_cache",
    "decode_capabilities",
    "get_decode_capabilities",
    "upload_source_gpu_shared_texture",
    "output_shared_texture",
    "get_output_shared_texture",
    "set_stage3d_scene",
    "get_stage3d_scene_summary",
    "set_projection_sim_scene",
    "get_projection_sim_scene_summary",
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
    "set_vram_budget",
    "set_decode_cpu_backup_policy",
    "set_decode_synthetic_fallback_policy",
    "set_media_prefetch_policy",
    "set_media_drop_policy",
    "set_decode_preview_policy",
    "set_decode_target_policy",
    "set_decode_upload_policy",
    "set_decode_handoff_policy",
    "set_decode_estimate_cache_policy",
    "set_metadata_cache_caps",
    "clear_runtime_caches",
    "present",
    "capabilities",
    "get_capabilities",
    "compute_probe",
    "run_compute_probe",
    "compute_graph",
    "run_compute_graph",
    "shutdown",
];

pub const CORE_COMMAND_TYPES: &[&str] = &[
    "set_output",
    "set_present_policy",
    "set_command_drain_policy",
    "set_command_drain_limit",
    "set_auto_present_policy",
    "set_vram_budget",
    "set_decode_cpu_backup_policy",
    "set_decode_synthetic_fallback_policy",
    "set_media_prefetch_policy",
    "set_media_drop_policy",
    "set_decode_preview_policy",
    "set_decode_target_policy",
    "set_decode_upload_policy",
    "set_decode_handoff_policy",
    "set_decode_estimate_cache_policy",
    "set_media_source_playback",
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
    "decode_media_source",
    "upload_source_preview",
    "upload_source_frame",
    "upload_source_gpu_shared_texture",
    "set_stage3d_scene",
    "set_projection_sim_scene",
    "precompile_shader",
    "bind_isf_shader",
    "update_isf_uniforms",
    "render_isf_to_layer",
    "remove_layer",
];

pub fn shared_texture_media_transport_note() -> &'static str {
    "Canvas/base64 source-frame upload is a development fallback; native shared-texture source-frame handles ingest through IOSurfaceID on macOS and DXGI HANDLE on Windows."
}

pub fn shared_texture_source_frame_upload_detail() -> &'static str {
    if cfg!(target_os = "macos") {
        "implemented for IOSurfaceID source-frame handles"
    } else if cfg!(target_os = "windows") {
        "implemented for DXGI shared HANDLE source-frame imports"
    } else {
        "pending backend-specific shared texture import"
    }
}

pub fn shared_texture_media_transport_ready_detail() -> &'static str {
    if cfg!(target_os = "macos") {
        "native shared texture media transport is active for IOSurfaceID source-frame handles; local video/still media bypasses canvas/base64 through native decode"
    } else if cfg!(target_os = "windows") {
        "native shared texture media transport is active for DXGI shared HANDLE source-frame imports; local video/still media bypasses canvas/base64 through native decode"
    } else {
        "native shared texture media transport is active for platform source-frame handles; local video/still media bypasses canvas/base64 through native decode"
    }
}

pub fn output_shared_texture_export_ready_detail() -> &'static str {
    if cfg!(target_os = "macos") {
        "native output mirror is exported as an IOSurface handle"
    } else if cfg!(target_os = "windows") {
        "native output mirror is exported as a DXGI shared HANDLE"
    } else {
        "native output mirror is exported as a platform shared texture"
    }
}

pub fn output_shared_texture_export_unavailable_detail() -> &'static str {
    if cfg!(target_os = "macos") {
        "native output IOSurface export target is unavailable"
    } else if cfg!(target_os = "windows") {
        "native output DXGI export target is unavailable"
    } else {
        "pending backend-specific output shared-texture export"
    }
}

pub fn texture_share_sender_label() -> &'static str {
    if cfg!(target_os = "macos") {
        "Electron Syphon bridge"
    } else if cfg!(target_os = "windows") {
        "Electron Spout bridge"
    } else {
        "Electron texture-share bridge"
    }
}

pub fn texture_share_sender_ready_detail() -> &'static str {
    if cfg!(target_os = "macos") {
        "native core exports the composite as an IOSurface; Electron owns Syphon publication"
    } else if cfg!(target_os = "windows") {
        "native core exports the composite as a DXGI shared HANDLE; Electron owns Spout publication when supported"
    } else {
        "native core output is ready; Electron owns platform texture-share publication when supported"
    }
}

pub fn texture_share_sender_pending_detail() -> &'static str {
    if cfg!(target_os = "macos") {
        "native output IOSurface export must be ready before Electron can publish Syphon"
    } else if cfg!(target_os = "windows") {
        "native output DXGI export must be ready before Electron can publish Spout"
    } else {
        "pending core-to-Electron output texture export for platform texture-share publication"
    }
}
