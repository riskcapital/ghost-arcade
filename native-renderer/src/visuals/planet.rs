//! The planet visual.

use crate::*;

#[derive(Clone, Debug)]
pub(crate) struct NativePlanetGraphState {
    pub(crate) prev_frame_time: f32,
    pub(crate) accum_rotation: f32,
    pub(crate) cloud_phase: f32,
}

impl NativePlanetGraphState {
    pub(crate) fn new(time: f32) -> Self {
        Self {
            prev_frame_time: time,
            accum_rotation: 0.0,
            cloud_phase: 0.0,
        }
    }
}

pub(crate) fn native_planet_id(params: &Value) -> u32 {
    match params
        .get("planet")
        .and_then(Value::as_str)
        .unwrap_or("earth")
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "mars" => 1,
        "jupiter" => 2,
        "saturn" => 3,
        _ => 0,
    }
}

pub(crate) fn build_planet_native_uniform_bytes(
    params: &Value,
    state: &NativePlanetGraphState,
    width: u32,
    height: u32,
    time: f32,
) -> Vec<u8> {
    let mut bytes = vec![0_u8; 176];
    write_f32_le(&mut bytes, 0, width.max(1) as f32);
    write_f32_le(&mut bytes, 1, height.max(1) as f32);
    write_f32_le(&mut bytes, 2, time.max(0.0));
    write_u32_le(&mut bytes, 3, native_planet_id(params));
    write_f32_le(
        &mut bytes,
        4,
        native_graph_param_f32(params, "cameraDistance", 0.01, 128.0, 4.0),
    );
    write_f32_le(
        &mut bytes,
        5,
        native_graph_param_f32(params, "fovDeg", 1.0, 160.0, 50.0),
    );
    write_f32_le(
        &mut bytes,
        6,
        native_graph_param_f32(params, "cameraYaw", -3600.0, 3600.0, 0.0),
    );
    write_f32_le(
        &mut bytes,
        7,
        native_graph_param_f32(params, "cameraPitch", -3600.0, 3600.0, 0.0),
    );
    write_f32_le(
        &mut bytes,
        8,
        native_graph_param_f32(params, "rotationOffset", -3600.0, 3600.0, 0.0),
    );
    write_f32_le(&mut bytes, 9, state.accum_rotation);
    write_f32_le(
        &mut bytes,
        10,
        native_graph_param_f32(params, "sunYaw", -3600.0, 3600.0, -45.0),
    );
    write_f32_le(
        &mut bytes,
        11,
        native_graph_param_f32(params, "sunPitch", -3600.0, 3600.0, 15.0),
    );
    write_f32_le(
        &mut bytes,
        12,
        native_graph_param_f32(params, "cloudCoverage", 0.0, 4.0, 0.65),
    );
    write_f32_le(&mut bytes, 13, state.cloud_phase);
    write_f32_le(
        &mut bytes,
        14,
        native_graph_param_f32(params, "atmosphereHeight", 0.0, 4.0, 0.06),
    );
    write_f32_le(
        &mut bytes,
        15,
        native_graph_param_f32(params, "auroraStrength", 0.0, 8.0, 0.8),
    );
    write_f32_le(
        &mut bytes,
        16,
        native_graph_param_f32(params, "starDensity", 0.0, 8.0, 1.0),
    );
    write_f32_le(
        &mut bytes,
        17,
        native_graph_param_f32(params, "ringInner", 0.001, 16.0, 1.25),
    );
    write_f32_le(
        &mut bytes,
        18,
        native_graph_param_f32(params, "ringOuter", 0.001, 32.0, 2.3),
    );
    write_f32_le(
        &mut bytes,
        19,
        native_graph_param_f32(params, "ringOpacity", 0.0, 4.0, 0.95),
    );
    let cloud = native_graph_param_rgb(params, "cloudColor", [1.0, 1.0, 1.0]);
    write_f32_le(&mut bytes, 20, cloud[0]);
    write_f32_le(&mut bytes, 21, cloud[1]);
    write_f32_le(&mut bytes, 22, cloud[2]);
    write_f32_le(
        &mut bytes,
        23,
        native_graph_param_f32(params, "sunBrightness", 0.0, 16.0, 1.0),
    );
    write_f32_le(
        &mut bytes,
        24,
        native_graph_param_f32(params, "planetX", -32.0, 32.0, 0.0),
    );
    write_f32_le(
        &mut bytes,
        25,
        native_graph_param_f32(params, "planetY", -32.0, 32.0, 0.0),
    );
    write_f32_le(
        &mut bytes,
        26,
        native_graph_param_f32(params, "ringDetail", 0.0, 16.0, 1.0),
    );
    write_f32_le(
        &mut bytes,
        28,
        native_graph_param_f32(params, "emission", 0.0, 16.0, 0.35),
    );
    write_f32_le(
        &mut bytes,
        29,
        native_graph_param_f32(params, "outerGlow", 0.0, 16.0, 0.0),
    );
    let land = native_graph_param_rgb(
        params,
        "landColor",
        [110.0 / 255.0, 175.0 / 255.0, 70.0 / 255.0],
    );
    write_f32_le(&mut bytes, 32, land[0]);
    write_f32_le(&mut bytes, 33, land[1]);
    write_f32_le(&mut bytes, 34, land[2]);
    write_f32_le(
        &mut bytes,
        35,
        native_graph_param_f32(params, "shorelineIntensity", 0.0, 32.0, 1.6),
    );
    let shore = native_graph_param_rgb(
        params,
        "shorelineColor",
        [60.0 / 255.0, 230.0 / 255.0, 220.0 / 255.0],
    );
    write_f32_le(&mut bytes, 36, shore[0]);
    write_f32_le(&mut bytes, 37, shore[1]);
    write_f32_le(&mut bytes, 38, shore[2]);
    write_f32_le(
        &mut bytes,
        39,
        native_graph_param_f32(params, "shorelineWidth", 0.0, 4.0, 0.04),
    );
    write_f32_le(
        &mut bytes,
        40,
        native_graph_param_f32(params, "cloudThickness", 0.0, 16.0, 1.8),
    );
    bytes
}

impl App {
    pub(crate) fn build_native_planet_graph_job(
        &mut self,
        graph_layer: &NativeGraphLayer,
    ) -> Result<(NativeGraphLayerState, NativeGraphFrameJob), String> {
        let shader_id = "planet/render";
        let Some(record) = self.shader_registry.get(shader_id) else {
            return Err("planet/render shader has not been precompiled".to_string());
        };
        if NativeShaderSourceKind::from_label(&record.source_kind) != NativeShaderSourceKind::Wgsl {
            return Err(format!(
                "planet/render shader is {}, but native graph instruments require WGSL",
                record.source_kind
            ));
        }
        let source_hash = record.source_hash;
        let entry_points = record.entry_points.clone();
        let source = self
            .shader_sources
            .get(shader_id)
            .cloned()
            .ok_or_else(|| "planet/render shader source missing".to_string())?;
        let vertex_entry = "vs_full".to_string();
        let fragment_entry = "fs_planet".to_string();
        if !entry_points.iter().any(|entry| entry == &vertex_entry) {
            return Err("planet/render shader is missing vertex entry vs_full".to_string());
        }
        if !entry_points.iter().any(|entry| entry == &fragment_entry) {
            return Err("planet/render shader is missing fragment entry fs_planet".to_string());
        }
        let time = self.native_graph_time_seconds();
        let mut state = graph_layer.planet_state.clone();
        let mut dt = if self.render_clock_mode == "manual" {
            self.native_graph_step_delta_this_render
        } else if state.prev_frame_time <= 0.0 {
            1.0 / self.target_fps.max(1) as f32
        } else {
            time - state.prev_frame_time
        };
        dt = dt.clamp(0.0, 0.1);
        state.prev_frame_time = time;
        state.accum_rotation = (state.accum_rotation
            + native_graph_param_f32(&graph_layer.params, "rotationSpeed", -3600.0, 3600.0, 4.0)
                * dt)
            % 360.0;
        state.cloud_phase +=
            native_graph_param_f32(&graph_layer.params, "cloudSpeed", 0.0, 32.0, 0.7) * dt;

        let uniform = build_planet_native_uniform_bytes(
            &graph_layer.params,
            &state,
            self.pending_width,
            self.pending_height,
            time,
        );
        let source_id = graph_layer.source_id.clone();
        let slot = self.assign_source_frame_slot(&source_id)?;
        let uniform_id = format!("planet:{}:uniform", native_graph_buffer_safe_id(&source_id));
        let seq = self.native_frame_index();
        let buffer_spec = NativeComputeGraphBufferSpec {
            id: uniform_id.clone(),
            byte_length: 176,
            kind: NativeComputeBufferBindingKind::Uniform,
            initial_bytes: uniform,
            persistent: true,
            clear: false,
            indirect: false,
        };
        let binding = NativeComputeGraphBindingSpec {
            binding: 0,
            resource_id: uniform_id,
            kind: NativeComputeGraphBindingKind::Buffer(NativeComputeBufferBindingKind::Uniform),
            source_slot: None,
        };
        let blend = NativeComputeGraphRenderBlend::Alpha;
        let primitive_topology = NativeComputeGraphPrimitiveTopology::TriangleList;
        let depth_compare = NativeComputeGraphDepthCompare::Less;
        let layout_sig = format!("{}:{}", binding.binding, binding.kind.signature());
        let render_plan = NativeComputeGraphRenderPlan {
            name: "planet-render".to_string(),
            cache_key: format!(
                "graph-render:{shader_id}:{}:{vertex_entry}:{fragment_entry}:{}:{}:{}:{}:{}:{layout_sig}",
                source_hash,
                blend.signature(),
                primitive_topology.signature(),
                "nodepth",
                "read",
                depth_compare.signature()
            ),
            source,
            vertex_entry,
            fragment_entry,
            clear: true,
            include_snapshot: false,
            generate_mips: false,
            target: NativeComputeGraphRenderTarget::SourceFrame {
                source_id: source_id.clone(),
                slot,
                seq,
            },
            blend,
            vertex_count: 3,
            instance_count: 1,
            indirect_buffer_id: None,
            indirect_offset: 0,
            clear_color: [0.0, 0.0, 0.0, 1.0],
            primitive_topology,
            depth_enabled: false,
            depth_write: false,
            depth_compare,
            depth_load: false,
            depth_texture_id: None,
            depth_only: false,
            bindings: vec![binding],
        };
        self.source_frames
            .insert(source_id.clone(), SourceFrame::full(seq));
        for layer in self.scene_layers.values_mut() {
            if layer.source_id.as_deref() == Some(source_id.as_str()) {
                layer.frame_slot = Some(slot);
            }
        }
        Ok((
            NativeGraphLayerState::Planet(state),
            NativeGraphFrameJob {
                textures: Vec::new(),
                buffers: vec![buffer_spec],
                pass_plans: Vec::new(),
                render_plans: vec![render_plan],
                readback_buffer_ids: Vec::new(),
            },
        ))
    }
}
