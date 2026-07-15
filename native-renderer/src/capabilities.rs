use serde_json::Value;

const SHARED_TEXTURE_IMPORT_UNSUPPORTED_DETAIL: &str = "native source-frame shared texture import is only implemented for Metal IOSurface and D3D12 DXGI";
const OUTPUT_TEXTURE_EXPORT_UNSUPPORTED_DETAIL: &str =
    "native output shared-texture export is only implemented for Metal IOSurface and D3D12 DXGI";

pub const COMPUTE_INSTRUMENT_HOST_FEATURES: &[&str] = &[
    "compute_shader_host",
    "compute_graph_host",
    "compute_graph_render",
    "compute_graph_source_frame_target",
    "persistent_compute_buffers",
];

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NativeReadinessCheck {
    pub id: String,
    pub label: String,
    pub ok: bool,
    pub detail: String,
}

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
    "output_shared_texture_snapshot",
    "get_output_shared_texture_snapshot",
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
    "set_native_graph_layer",
    "remove_native_graph_layer",
    "queue_compute_graph",
    "enqueue_compute_graph",
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
    "Native source-frame ingest uses IOSurfaceID on macOS and DXGI HANDLE on Windows; browser canvas/base64 upload is not a native-engine presentation path."
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

fn native_feature_enabled(capabilities: &Value, feature: &str) -> bool {
    capabilities
        .get("features")
        .and_then(|features| features.get(feature))
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

fn native_missing_features(capabilities: &Value, required: &[&str]) -> Vec<String> {
    required
        .iter()
        .filter(|feature| !native_feature_enabled(capabilities, feature))
        .map(|feature| (*feature).to_string())
        .collect()
}

fn string_array_contains(value: Option<&Value>, needle: &str) -> bool {
    value
        .and_then(Value::as_array)
        .is_some_and(|items| items.iter().any(|item| item.as_str() == Some(needle)))
}

fn string_array_missing(value: Option<&Value>, required: &[&str]) -> Vec<String> {
    required
        .iter()
        .filter(|needle| !string_array_contains(value, needle))
        .map(|needle| (*needle).to_string())
        .collect()
}

fn contract_string<'a>(contract: &'a Value, key: &str) -> &'a str {
    contract.get(key).and_then(Value::as_str).unwrap_or("")
}

fn contract_reason(contract: &Value) -> Option<String> {
    contract
        .get("reason")
        .and_then(Value::as_str)
        .filter(|reason| !reason.trim().is_empty())
        .map(ToString::to_string)
}

pub fn source_frame_shared_texture_import_readiness(capabilities: &Value) -> (bool, String) {
    let Some(contract) = capabilities.get("source_frame_shared_texture_import") else {
        return (
            false,
            "missing source_frame_shared_texture_import contract".to_string(),
        );
    };

    let (expected_backend, expected_platform, expected_importer, expected_handle_scope) =
        if cfg!(target_os = "macos") {
            ("metal", "iosurface", "metal-iosurface", "global-id")
        } else if cfg!(target_os = "windows") {
            (
                "d3d12",
                "dxgi",
                "d3d12-open-shared-handle",
                "process-handle",
            )
        } else {
            return (
                false,
                contract_reason(contract)
                    .unwrap_or_else(|| SHARED_TEXTURE_IMPORT_UNSUPPORTED_DETAIL.to_string()),
            );
        };

    let mut missing = Vec::new();
    if !contract
        .get("available")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        missing.push(
            contract_reason(contract).unwrap_or_else(|| "contract available=false".to_string()),
        );
    }

    for (key, expected) in [
        ("backend", expected_backend),
        ("platform", expected_platform),
        ("importer", expected_importer),
        ("handle_scope", expected_handle_scope),
    ] {
        let actual = contract_string(contract, key);
        if actual != expected {
            missing.push(format!("{key} {actual:?} != {expected:?}"));
        }
    }

    missing.extend(
        string_array_missing(
            contract.get("accepted_handle_encodings"),
            &["integer", "base64", "hex", "opaque"],
        )
        .into_iter()
        .map(|encoding| format!("handle encoding {encoding}")),
    );
    missing.extend(
        string_array_missing(
            contract.get("accepted_formats"),
            &["bgra8unorm", "rgba8unorm", "80", "87", "28", "70"],
        )
        .into_iter()
        .map(|format| format!("format {format}")),
    );

    if missing.is_empty() {
        (
            true,
            format!(
                "{expected_importer} import active for {expected_platform} {expected_handle_scope} source-frame handles"
            ),
        )
    } else {
        (
            false,
            format!(
                "source-frame shared texture import contract incomplete: {}",
                missing.join("; ")
            ),
        )
    }
}

pub fn output_shared_texture_export_readiness(capabilities: &Value) -> (bool, String) {
    let Some(contract) = capabilities.get("output_shared_texture_export") else {
        return (
            false,
            "missing output_shared_texture_export contract".to_string(),
        );
    };

    let (
        expected_backend,
        expected_platform,
        expected_exporter,
        expected_handle_scope,
        expected_preferred_transport,
        expected_handle_byte_length,
    ) = if cfg!(target_os = "macos") {
        (
            "metal",
            "iosurface",
            "metal-iosurface",
            "global-id",
            "handle",
            4_u64,
        )
    } else if cfg!(target_os = "windows") {
        (
            "d3d12",
            "dxgi",
            "d3d12-shared-resource-name",
            "process-local",
            "shared_name",
            8_u64,
        )
    } else {
        return (
            false,
            contract_reason(contract)
                .unwrap_or_else(|| OUTPUT_TEXTURE_EXPORT_UNSUPPORTED_DETAIL.to_string()),
        );
    };

    let mut missing = Vec::new();
    if !contract
        .get("available")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        missing.push(
            contract_reason(contract).unwrap_or_else(|| "contract available=false".to_string()),
        );
    }

    for (key, expected) in [
        ("backend", expected_backend),
        ("platform", expected_platform),
        ("exporter", expected_exporter),
        ("handle_scope", expected_handle_scope),
        ("preferred_transport", expected_preferred_transport),
        ("handle_encoding", "integer"),
    ] {
        let actual = contract_string(contract, key);
        if actual != expected {
            missing.push(format!("{key} {actual:?} != {expected:?}"));
        }
    }

    let actual_handle_byte_length = contract
        .get("handle_byte_length")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    if actual_handle_byte_length != expected_handle_byte_length {
        missing.push(format!(
            "handle_byte_length {actual_handle_byte_length} != {expected_handle_byte_length}"
        ));
    }

    let exported_formats = contract
        .get("exported_formats")
        .and_then(Value::as_array)
        .map(|items| items.iter().filter_map(Value::as_str).collect::<Vec<_>>())
        .unwrap_or_default();
    if exported_formats != ["bgra8unorm"] {
        missing.push(format!(
            "exported_formats {:?} != [\"bgra8unorm\"]",
            exported_formats
        ));
    }

    for (key, expected) in [
        ("color_space", "srgb"),
        ("storage_format", "bgra8unorm"),
        ("storage_encoding", "srgb-encoded-bgra8unorm"),
        ("alpha_mode", "opaque"),
        ("single_render_source", "core-output-composite"),
    ] {
        let actual = contract_string(contract, key);
        if actual != expected {
            missing.push(format!("{key} {actual:?} != {expected:?}"));
        }
    }
    if contract.get("premultiplied_alpha").and_then(Value::as_bool) != Some(false) {
        missing.push("premultiplied_alpha must be false".to_string());
    }
    if contract.get("zero_conversions").and_then(Value::as_bool) != Some(true) {
        missing.push("zero_conversions must be true".to_string());
    }

    if missing.is_empty() {
        (
            true,
            format!(
                "{expected_exporter} output export active for {expected_platform} {expected_preferred_transport} transport"
            ),
        )
    } else {
        (
            false,
            format!(
                "output shared texture export contract incomplete: {}",
                missing.join("; ")
            ),
        )
    }
}

fn native_graph_manifest_entry<'a>(capabilities: &'a Value, id: &str) -> Option<&'a Value> {
    capabilities
        .get("native_graph_instrument_manifest")
        .and_then(Value::as_array)
        .and_then(|entries| {
            entries
                .iter()
                .find(|entry| entry.get("id").and_then(Value::as_str) == Some(id))
        })
}

pub fn native_compute_host_readiness(capabilities: &Value, renderer_ready: bool) -> (bool, String) {
    if !renderer_ready {
        return (
            false,
            "native renderer has not created a wgpu device".to_string(),
        );
    }
    let missing = native_missing_features(capabilities, COMPUTE_INSTRUMENT_HOST_FEATURES);
    if missing.is_empty() {
        (
            true,
            "compute_graph can run real WGSL graph instruments with persistent buffers and source-frame render targets".to_string(),
        )
    } else {
        (false, format!("missing {}", missing.join("; ")))
    }
}

pub fn native_graph_readiness(
    capabilities: &Value,
    renderer_ready: bool,
    id: &str,
    label: &str,
    shader_ids: &[&str],
    capability_features: &[&str],
    manifest_features: &[&str],
) -> (bool, String) {
    if !renderer_ready {
        return (
            false,
            "native renderer has not created a wgpu device".to_string(),
        );
    }

    let mut missing = native_missing_features(capabilities, capability_features);
    if !string_array_contains(capabilities.get("native_graph_instruments"), id) {
        missing.push(format!("{id} instrument list entry"));
    }

    if let Some(entry) = native_graph_manifest_entry(capabilities, id) {
        let expected_prefix = format!("native-graph://{id}/");
        if entry.get("source_uri_prefix").and_then(Value::as_str) != Some(expected_prefix.as_str())
        {
            missing.push("native-graph URI prefix".to_string());
        }
        if entry.get("render_target").and_then(Value::as_str) != Some("source_frame") {
            missing.push("source_frame target".to_string());
        }
        if entry
            .get("parity")
            .and_then(Value::as_str)
            .is_none_or(|parity| parity.is_empty())
        {
            missing.push("parity metadata".to_string());
        }

        missing.extend(
            string_array_missing(entry.get("features"), manifest_features)
                .into_iter()
                .map(|feature| format!("manifest feature {feature}")),
        );
        let missing_shaders = string_array_missing(entry.get("shader_ids"), shader_ids);
        if !missing_shaders.is_empty() {
            missing.push(format!("shader_ids {}", missing_shaders.join(",")));
        }
    } else {
        missing.push(format!("{id} manifest entry"));
    }

    if missing.is_empty() {
        (
            true,
            format!(
                "{label} is implemented via compute_graph source-frame route ({} shared WGSL shader(s))",
                shader_ids.len()
            ),
        )
    } else {
        (false, format!("missing {}", missing.join("; ")))
    }
}

pub fn native_graph_readiness_id(id: &str) -> String {
    if id == "smoke-3d" {
        "native-3d-smoke-graph".to_string()
    } else {
        format!("native-{id}-graph")
    }
}

pub fn native_graph_readiness_checks(
    capabilities: &Value,
    renderer_ready: bool,
) -> Vec<NativeReadinessCheck> {
    let Some(entries) = capabilities
        .get("native_graph_instrument_manifest")
        .and_then(Value::as_array)
    else {
        return Vec::new();
    };

    entries
        .iter()
        .filter_map(|entry| {
            let id = entry.get("id").and_then(Value::as_str)?;
            let label = entry.get("label").and_then(Value::as_str).unwrap_or(id);
            let shader_ids = entry
                .get("shader_ids")
                .and_then(Value::as_array)
                .map(|items| items.iter().filter_map(Value::as_str).collect::<Vec<_>>())
                .unwrap_or_default();
            let manifest_features = entry
                .get("features")
                .and_then(Value::as_array)
                .map(|items| items.iter().filter_map(Value::as_str).collect::<Vec<_>>())
                .unwrap_or_default();
            let mut capability_features = Vec::with_capacity(manifest_features.len() + 1);
            capability_features.push("compute_shader_host");
            capability_features.extend(manifest_features.iter().copied());
            let (ok, detail) = native_graph_readiness(
                capabilities,
                renderer_ready,
                id,
                label,
                &shader_ids,
                &capability_features,
                &manifest_features,
            );
            Some(NativeReadinessCheck {
                id: native_graph_readiness_id(id),
                label: label.to_string(),
                ok,
                detail,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn native_compute_host_readiness_reports_missing_features() {
        let capabilities = json!({
            "features": {
                "compute_shader_host": true,
                "compute_graph_host": true
            }
        });

        let (ok, detail) = native_compute_host_readiness(&capabilities, true);

        assert!(!ok);
        assert!(detail.contains("compute_graph_render"));
        assert!(detail.contains("persistent_compute_buffers"));
    }

    #[test]
    fn source_frame_shared_texture_import_readiness_rejects_missing_contract() {
        let capabilities = json!({});

        let (ok, detail) = source_frame_shared_texture_import_readiness(&capabilities);

        assert!(!ok);
        assert!(detail.contains("source_frame_shared_texture_import"));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn source_frame_shared_texture_import_readiness_accepts_macos_contract() {
        let capabilities = json!({
            "source_frame_shared_texture_import": {
                "available": true,
                "backend": "metal",
                "platform": "iosurface",
                "importer": "metal-iosurface",
                "handle_scope": "global-id",
                "accepted_handle_encodings": ["integer", "base64", "hex", "opaque"],
                "accepted_formats": ["bgra8unorm", "rgba8unorm", "80", "87", "28", "70"],
                "reason": null
            }
        });

        let (ok, detail) = source_frame_shared_texture_import_readiness(&capabilities);

        assert!(ok);
        assert!(detail.contains("metal-iosurface"));
        assert!(detail.contains("global-id"));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn source_frame_shared_texture_import_readiness_accepts_windows_contract() {
        let capabilities = json!({
            "source_frame_shared_texture_import": {
                "available": true,
                "backend": "d3d12",
                "platform": "dxgi",
                "importer": "d3d12-open-shared-handle",
                "handle_scope": "process-handle",
                "accepted_handle_encodings": ["integer", "base64", "hex", "opaque"],
                "accepted_formats": ["bgra8unorm", "rgba8unorm", "80", "87", "28", "70"],
                "reason": null
            }
        });

        let (ok, detail) = source_frame_shared_texture_import_readiness(&capabilities);

        assert!(ok);
        assert!(detail.contains("d3d12-open-shared-handle"));
        assert!(detail.contains("process-handle"));
    }

    #[cfg(any(target_os = "macos", target_os = "windows"))]
    #[test]
    fn source_frame_shared_texture_import_readiness_rejects_incomplete_contract() {
        let capabilities = json!({
            "source_frame_shared_texture_import": {
                "available": true,
                "backend": "metal",
                "platform": "iosurface",
                "importer": "none",
                "handle_scope": "",
                "accepted_handle_encodings": ["integer"],
                "accepted_formats": ["bgra8unorm"]
            }
        });

        let (ok, detail) = source_frame_shared_texture_import_readiness(&capabilities);

        assert!(!ok);
        assert!(detail.contains("importer"));
        assert!(detail.contains("handle encoding base64"));
        assert!(detail.contains("format rgba8unorm"));
    }

    #[test]
    fn output_shared_texture_export_readiness_rejects_missing_contract() {
        let capabilities = json!({});

        let (ok, detail) = output_shared_texture_export_readiness(&capabilities);

        assert!(!ok);
        assert!(detail.contains("output_shared_texture_export"));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn output_shared_texture_export_readiness_accepts_macos_contract() {
        let capabilities = json!({
            "output_shared_texture_export": {
                "available": true,
                "backend": "metal",
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
                "reason": null
            }
        });

        let (ok, detail) = output_shared_texture_export_readiness(&capabilities);

        assert!(ok);
        assert!(detail.contains("metal-iosurface"));
        assert!(detail.contains("handle"));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn output_shared_texture_export_readiness_accepts_windows_contract() {
        let capabilities = json!({
            "output_shared_texture_export": {
                "available": true,
                "backend": "d3d12",
                "platform": "dxgi",
                "exporter": "d3d12-shared-resource-name",
                "handle_scope": "process-local",
                "preferred_transport": "shared_name",
                "handle_encoding": "integer",
                "handle_byte_length": 8,
                "exported_formats": ["bgra8unorm"],
                "color_space": "srgb",
                "storage_format": "bgra8unorm",
                "storage_encoding": "srgb-encoded-bgra8unorm",
                "alpha_mode": "opaque",
                "premultiplied_alpha": false,
                "single_render_source": "core-output-composite",
                "zero_conversions": true,
                "reason": null
            }
        });

        let (ok, detail) = output_shared_texture_export_readiness(&capabilities);

        assert!(ok);
        assert!(detail.contains("d3d12-shared-resource-name"));
        assert!(detail.contains("shared_name"));
    }

    #[cfg(any(target_os = "macos", target_os = "windows"))]
    #[test]
    fn output_shared_texture_export_readiness_rejects_incomplete_contract() {
        let capabilities = json!({
            "output_shared_texture_export": {
                "available": true,
                "backend": "metal",
                "platform": "iosurface",
                "exporter": "none",
                "handle_scope": "",
                "preferred_transport": "",
                "handle_encoding": "opaque",
                "handle_byte_length": 0,
                "exported_formats": []
            }
        });

        let (ok, detail) = output_shared_texture_export_readiness(&capabilities);

        assert!(!ok);
        assert!(detail.contains("exporter"));
        assert!(detail.contains("preferred_transport"));
        assert!(detail.contains("exported_formats"));
        assert!(detail.contains("color_space"));
        assert!(detail.contains("single_render_source"));
    }

    #[test]
    fn native_graph_readiness_accepts_matching_manifest_entry() {
        let capabilities = json!({
            "features": {
                "compute_graph_host": true,
                "compute_graph_render": true,
                "compute_graph_source_frame_target": true,
                "native_test_graph": true
            },
            "native_graph_instruments": ["test"],
            "native_graph_instrument_manifest": [
                {
                    "id": "test",
                    "source_uri_prefix": "native-graph://test/",
                    "shader_ids": ["test/render"],
                    "features": [
                        "compute_graph_host",
                        "compute_graph_render",
                        "compute_graph_source_frame_target",
                        "native_test_graph"
                    ],
                    "render_target": "source_frame",
                    "parity": "test-shared-wgsl"
                }
            ]
        });

        let (ok, detail) = native_graph_readiness(
            &capabilities,
            true,
            "test",
            "Test Graph",
            &["test/render"],
            &[
                "compute_graph_host",
                "compute_graph_render",
                "compute_graph_source_frame_target",
                "native_test_graph",
            ],
            &[
                "compute_graph_host",
                "compute_graph_render",
                "compute_graph_source_frame_target",
                "native_test_graph",
            ],
        );

        assert!(ok);
        assert!(detail.contains("Test Graph is implemented"));
    }

    #[test]
    fn native_graph_readiness_checks_are_manifest_driven() {
        let capabilities = json!({
            "features": {
                "compute_shader_host": true,
                "compute_graph_host": true,
                "compute_graph_render": true,
                "compute_graph_source_frame_target": true,
                "native_test_graph": true
            },
            "native_graph_instruments": ["test"],
            "native_graph_instrument_manifest": [
                {
                    "id": "test",
                    "label": "Test Graph",
                    "source_uri_prefix": "native-graph://test/",
                    "shader_ids": ["test/render"],
                    "features": [
                        "compute_graph_host",
                        "compute_graph_render",
                        "compute_graph_source_frame_target",
                        "native_test_graph"
                    ],
                    "render_target": "source_frame",
                    "parity": "test-shared-wgsl"
                }
            ]
        });

        let checks = native_graph_readiness_checks(&capabilities, true);

        assert_eq!(checks.len(), 1);
        assert_eq!(checks[0].id, "native-test-graph");
        assert_eq!(checks[0].label, "Test Graph");
        assert!(checks[0].ok);
        assert!(checks[0].detail.contains("1 shared WGSL shader"));
    }
}
