//! The point cloud visual.

use crate::*;

#[derive(Clone, Debug)]
pub(crate) struct NativePointCloudGraphState {
    pub(crate) signature: String,
    pub(crate) point_count: u32,
    pub(crate) prev_frame_time: f32,
    pub(crate) hue_shift_phase: f32,
    pub(crate) color_cycle_phase: f32,
    pub(crate) burst_impulse: f32,
    pub(crate) prev_bass: f32,
    pub(crate) wave_time: f32,
    pub(crate) auto_rot_x_phase: f32,
    pub(crate) auto_rot_y_phase: f32,
    pub(crate) auto_rot_z_phase: f32,
}

impl NativePointCloudGraphState {
    pub(crate) fn new(signature: String, point_count: u32, time: f32) -> Self {
        Self {
            signature,
            point_count,
            prev_frame_time: time,
            hue_shift_phase: 0.0,
            color_cycle_phase: 0.0,
            burst_impulse: 0.0,
            prev_bass: 0.0,
            wave_time: 0.0,
            auto_rot_x_phase: 0.0,
            auto_rot_y_phase: 0.0,
            auto_rot_z_phase: 0.0,
        }
    }
}

#[derive(Clone, Debug)]
pub(crate) struct NativePointCloudAsset {
    pub(crate) signature: String,
    pub(crate) point_count: u32,
    pub(crate) sort_count: u32,
    pub(crate) depth_sort_enabled: bool,
    // Shared so the per-frame job build clones a pointer, not tens of MB.
    pub(crate) home_bytes: Arc<[u8]>,
    pub(crate) live_bytes: Arc<[u8]>,
    pub(crate) sort_bytes: Arc<[u8]>,
}

#[derive(Clone, Debug)]
pub(crate) struct NativePointCloudParams {
    pub(crate) topology_id: u32,
    pub(crate) point_size: f32,
    pub(crate) opacity: f32,
    /// Opaque, depth-writing points (pointCloudFXSolid in webgpuPointCloudFX.ts).
    pub(crate) solid_points: bool,
    pub(crate) wind_strength: f32,
    pub(crate) wind_scale: f32,
    pub(crate) anchor_pull: f32,
    pub(crate) damping: f32,
    pub(crate) twist_amount: f32,
    pub(crate) voxel_mix: f32,
    pub(crate) voxel_size: f32,
    pub(crate) shimmer_strength: f32,
    pub(crate) burst_gain: f32,
    pub(crate) burst_decay: f32,
    pub(crate) wave_enabled: bool,
    pub(crate) wave_speed: f32,
    pub(crate) wave_orbit_radius: f32,
    pub(crate) wave_radius: f32,
    pub(crate) wave_falloff: f32,
    pub(crate) wave_strength: f32,
    pub(crate) hue_shift_speed: f32,
    pub(crate) saturation: f32,
    pub(crate) brightness: f32,
    pub(crate) color_mode_id: u32,
    pub(crate) color_map_id: u32,
    pub(crate) color_mix: f32,
    pub(crate) color_map_scale: f32,
    pub(crate) color_map_offset: f32,
    pub(crate) color_cycle_speed: f32,
    pub(crate) random_sat: f32,
    pub(crate) random_val: f32,
    pub(crate) filter_mode_id: u32,
    pub(crate) filter_axis_id: u32,
    pub(crate) filter_amount: f32,
    pub(crate) filter_speed: f32,
    pub(crate) filter_phase: f32,
    pub(crate) filter_width: f32,
    pub(crate) filter_softness: f32,
    pub(crate) contour_bands: f32,
    pub(crate) fog_density: f32,
    pub(crate) fog_opacity: f32,
    pub(crate) fog_color: [f32; 3],
    pub(crate) colors: [[f32; 3]; 4],
    pub(crate) dissolve_radius: f32,
    pub(crate) dissolve_softness: f32,
    pub(crate) stroke_length: f32,
    pub(crate) stroke_width: f32,
    pub(crate) fov_deg: f32,
    pub(crate) camera_z: f32,
    pub(crate) rotate: [f32; 3],
    pub(crate) auto_rotate: [f32; 3],
    pub(crate) audio_reactive: bool,
}

pub(crate) fn normalize_point_cloud_native_params(params: &Value) -> NativePointCloudParams {
    let topology_id = match native_particle_field_enum(params, "topology", "points").as_str() {
        "billboards" => 1,
        "strokes" => 2,
        _ => 0,
    };
    let color_mode_id = match native_particle_field_enum(params, "colorMode", "source").as_str() {
        "solid" => 1,
        "gradient2" => 2,
        "gradient3" => 3,
        "palette4" => 4,
        "rainbow" => 5,
        "random" => 6,
        _ => 0,
    };
    let color_map_id = match native_particle_field_enum(params, "colorMap", "index").as_str() {
        "depth-z" => 1,
        "depth-cam" => 2,
        "radial" => 3,
        "y-axis" => 4,
        "luminance" => 5,
        "noise" => 6,
        _ => 0,
    };
    let filter_mode_id = match native_particle_field_enum(params, "filterMode", "none").as_str() {
        "drift" => 1,
        "swarm" => 2,
        "slice" => 3,
        "contour" => 4,
        "rift" => 5,
        "prism" => 6,
        "fog" => 7,
        _ => 0,
    };
    let filter_axis_id = match native_particle_field_enum(params, "filterAxis", "z").as_str() {
        "x" => 0,
        "y" => 1,
        "radial" => 3,
        _ => 2,
    };
    NativePointCloudParams {
        topology_id,
        point_size: native_graph_param_f32(params, "pointSize", 0.0001, 0.2, 0.006),
        opacity: native_graph_param_f32(params, "opacity", 0.0, 1.0, 1.0),
        solid_points: native_graph_param_bool(params, "solidPoints", false),
        wind_strength: native_graph_param_f32(params, "windStrength", 0.0, 8.0, 0.05),
        wind_scale: native_graph_param_f32(params, "windScale", 0.01, 24.0, 1.0),
        anchor_pull: native_graph_param_f32(params, "anchorPull", 0.0, 16.0, 2.0),
        damping: native_graph_param_f32(params, "damping", 0.0, 8.0, 0.8),
        twist_amount: native_graph_param_f32(params, "twistAmount", -32.0, 32.0, 0.0),
        voxel_mix: native_graph_param_f32(params, "voxelMix", 0.0, 1.0, 0.0),
        voxel_size: native_graph_param_f32(params, "voxelSize", 0.001, 4.0, 0.1),
        shimmer_strength: native_graph_param_f32(params, "shimmerStrength", 0.0, 2.0, 0.02),
        burst_gain: native_graph_param_f32(params, "burstGain", 0.0, 8.0, 0.6),
        burst_decay: native_graph_param_f32(params, "burstDecay", 0.01, 24.0, 2.5),
        wave_enabled: params
            .get("waveEnabled")
            .and_then(Value::as_bool)
            .unwrap_or(true),
        wave_speed: native_graph_param_f32(params, "waveSpeed", -64.0, 64.0, 0.6),
        wave_orbit_radius: native_graph_param_f32(params, "waveOrbitRadius", 0.0, 8.0, 0.8),
        wave_radius: native_graph_param_f32(params, "waveRadius", 0.001, 8.0, 0.3),
        wave_falloff: native_graph_param_f32(params, "waveFalloff", 0.001, 8.0, 0.2),
        wave_strength: native_graph_param_f32(params, "waveStrength", 0.0, 16.0, 0.8),
        hue_shift_speed: native_graph_param_f32(params, "hueShiftSpeed", -64.0, 64.0, 0.05),
        saturation: native_graph_param_f32(params, "saturation", 0.0, 8.0, 1.0),
        brightness: native_graph_param_f32(params, "brightness", 0.0, 8.0, 1.08),
        color_mode_id,
        color_map_id,
        color_mix: native_graph_param_f32(params, "colorMix", 0.0, 1.0, 1.0),
        color_map_scale: native_graph_param_f32(params, "colorMapScale", 0.001, 24.0, 1.0),
        color_map_offset: native_graph_param_f32(params, "colorMapOffset", -64.0, 64.0, 0.0),
        color_cycle_speed: native_graph_param_f32(params, "colorCycleSpeed", -64.0, 64.0, 0.0),
        random_sat: native_graph_param_f32(params, "randomSat", 0.0, 1.0, 0.85),
        random_val: native_graph_param_f32(params, "randomVal", 0.0, 8.0, 1.0),
        filter_mode_id,
        filter_axis_id,
        filter_amount: native_graph_param_f32(params, "filterAmount", 0.0, 8.0, 0.75),
        filter_speed: native_graph_param_f32(params, "filterSpeed", -64.0, 64.0, 0.2),
        filter_phase: native_graph_param_f32(params, "filterPhase", -100_000.0, 100_000.0, 0.0),
        filter_width: native_graph_param_f32(params, "filterWidth", 0.001, 8.0, 0.18),
        filter_softness: native_graph_param_f32(params, "filterSoftness", 0.001, 8.0, 0.08),
        contour_bands: native_graph_param_f32(params, "contourBands", 1.0, 128.0, 12.0),
        fog_density: native_graph_param_f32(params, "fogDensity", 0.0, 16.0, 0.0),
        fog_opacity: native_graph_param_f32(params, "fogOpacity", 0.0, 1.0, 0.0),
        fog_color: native_graph_param_rgb(params, "fogColor", [0.02, 0.025, 0.035]),
        colors: [
            native_graph_param_rgb(params, "colorA", [0.24, 0.39, 0.94]),
            native_graph_param_rgb(params, "colorB", [0.94, 0.24, 0.71]),
            native_graph_param_rgb(params, "colorC", [1.0, 0.78, 0.12]),
            native_graph_param_rgb(params, "colorD", [0.16, 0.86, 0.86]),
        ],
        dissolve_radius: native_graph_param_f32(params, "dissolveRadius", 0.0, 64.0, 10.0),
        dissolve_softness: native_graph_param_f32(params, "dissolveSoftness", 0.001, 8.0, 0.05),
        stroke_length: native_graph_param_f32(params, "strokeLength", 0.001, 4.0, 0.04),
        stroke_width: native_graph_param_f32(params, "strokeWidth", 0.0001, 2.0, 0.004),
        fov_deg: native_graph_param_f32(params, "fovDeg", 1.0, 160.0, 50.0),
        camera_z: native_graph_param_f32(params, "cameraZ", 0.05, 128.0, 2.5),
        rotate: [
            native_graph_param_f32(params, "rotateX", -3600.0, 3600.0, 0.0),
            native_graph_param_f32(params, "rotateY", -3600.0, 3600.0, 0.0),
            native_graph_param_f32(params, "rotateZ", -3600.0, 3600.0, 0.0),
        ],
        auto_rotate: [
            native_graph_param_f32(params, "autoRotateX", -3600.0, 3600.0, 0.0),
            native_graph_param_f32(params, "autoRotateY", -3600.0, 3600.0, 8.0),
            native_graph_param_f32(params, "autoRotateZ", -3600.0, 3600.0, 0.0),
        ],
        audio_reactive: params
            .get("audioReactive")
            .and_then(Value::as_bool)
            .unwrap_or(true),
    }
}

pub(crate) fn point_cloud_view_proj(
    params: &NativePointCloudParams,
    state: &NativePointCloudGraphState,
    width: u32,
    height: u32,
) -> [f32; 16] {
    let aspect = width.max(1) as f32 / height.max(1) as f32;
    let proj = native_perspective(params.fov_deg, aspect, 0.05, 100.0);
    let view = native_translate(0.0, 0.0, -params.camera_z);
    let object = native_mat4_mul(
        native_rotate_z((params.rotate[2] + state.auto_rot_z_phase).to_radians()),
        native_mat4_mul(
            native_rotate_y((params.rotate[1] + state.auto_rot_y_phase).to_radians()),
            native_rotate_x((params.rotate[0] + state.auto_rot_x_phase).to_radians()),
        ),
    );
    native_mat4_mul(proj, native_mat4_mul(view, object))
}

pub(crate) fn build_point_cloud_compute_bytes(
    params: &NativePointCloudParams,
    state: &NativePointCloudGraphState,
    dt: f32,
    time: f32,
    bass: f32,
    treble: f32,
) -> Vec<u8> {
    let mut bytes = vec![0_u8; 288];
    write_f32_le(&mut bytes, 0, dt);
    write_f32_le(&mut bytes, 1, time);
    write_u32_le(&mut bytes, 2, state.point_count);
    write_f32_le(&mut bytes, 3, params.point_size);
    write_f32_le(&mut bytes, 4, params.wind_strength);
    write_f32_le(&mut bytes, 5, params.wind_scale);
    write_f32_le(&mut bytes, 6, params.anchor_pull);
    write_f32_le(&mut bytes, 7, params.damping);
    write_f32_le(&mut bytes, 8, bass);
    write_f32_le(&mut bytes, 9, treble);
    write_f32_le(&mut bytes, 10, state.burst_impulse);
    write_f32_le(&mut bytes, 11, params.shimmer_strength);
    let wave = if params.wave_enabled { 1.0 } else { 0.0 };
    write_f32_le(
        &mut bytes,
        12,
        wave * state.wave_time.cos() * params.wave_orbit_radius,
    );
    write_f32_le(
        &mut bytes,
        13,
        wave * state.wave_time.sin() * params.wave_orbit_radius * 0.6,
    );
    write_f32_le(
        &mut bytes,
        14,
        wave * (state.wave_time * 0.7).sin() * params.wave_orbit_radius * 0.4,
    );
    write_f32_le(&mut bytes, 15, params.wave_radius);
    write_f32_le(&mut bytes, 16, params.wave_strength * wave);
    write_f32_le(&mut bytes, 17, params.wave_falloff);
    write_f32_le(&mut bytes, 18, params.twist_amount);
    write_f32_le(&mut bytes, 19, params.voxel_size);
    write_f32_le(&mut bytes, 20, params.voxel_mix);
    write_f32_le(&mut bytes, 21, params.dissolve_radius);
    write_f32_le(&mut bytes, 22, params.dissolve_softness);
    write_f32_le(&mut bytes, 23, state.hue_shift_phase);
    write_f32_le(&mut bytes, 24, params.saturation);
    write_f32_le(&mut bytes, 25, params.brightness);
    write_u32_le(&mut bytes, 26, params.color_mode_id);
    write_u32_le(&mut bytes, 27, params.color_map_id);
    write_f32_le(&mut bytes, 28, params.color_mix);
    write_f32_le(&mut bytes, 29, params.color_map_scale);
    write_f32_le(&mut bytes, 30, params.color_map_offset);
    write_f32_le(&mut bytes, 31, state.color_cycle_phase);
    write_f32_le(&mut bytes, 32, params.random_sat);
    write_f32_le(&mut bytes, 33, params.random_val);
    write_u32_le(&mut bytes, 34, params.filter_mode_id);
    write_u32_le(&mut bytes, 35, params.filter_axis_id);
    for color_index in 0..4 {
        for component in 0..3 {
            write_f32_le(
                &mut bytes,
                36 + color_index * 4 + component,
                params.colors[color_index][component],
            );
        }
    }
    write_f32_le(&mut bytes, 52, params.filter_amount);
    write_f32_le(&mut bytes, 53, params.filter_speed);
    write_f32_le(&mut bytes, 54, params.filter_phase);
    write_f32_le(&mut bytes, 55, params.filter_width);
    write_f32_le(&mut bytes, 56, params.filter_softness);
    write_f32_le(&mut bytes, 57, params.contour_bands);
    write_f32_le(&mut bytes, 58, params.fog_density);
    write_f32_le(&mut bytes, 59, params.fog_opacity);
    for component in 0..3 {
        write_f32_le(&mut bytes, 60 + component, params.fog_color[component]);
    }
    bytes
}

pub(crate) fn build_point_cloud_render_bytes(
    params: &NativePointCloudParams,
    state: &NativePointCloudGraphState,
    width: u32,
    height: u32,
    solid: bool,
) -> Vec<u8> {
    let mut bytes = vec![0_u8; 192];
    for (index, value) in point_cloud_view_proj(params, state, width, height)
        .iter()
        .enumerate()
    {
        write_f32_le(&mut bytes, index, *value);
    }
    write_f32_le(&mut bytes, 16, 1.0);
    write_f32_le(&mut bytes, 19, params.camera_z);
    write_f32_le(&mut bytes, 21, 1.0);
    write_u32_le(&mut bytes, 24, params.topology_id);
    write_f32_le(&mut bytes, 25, params.stroke_length);
    write_f32_le(&mut bytes, 26, params.stroke_width);
    write_f32_le(&mut bytes, 27, params.opacity);
    write_u32_le(&mut bytes, 28, state.point_count);
    write_f32_le(&mut bytes, 29, width.max(1) as f32);
    write_f32_le(&mut bytes, 30, height.max(1) as f32);
    write_f32_le(&mut bytes, 31, 0.75);
    for component in 0..3 {
        write_f32_le(&mut bytes, 32 + component, params.fog_color[component]);
    }
    let fog_boost = if params.filter_mode_id == 7 {
        params.filter_amount
    } else {
        0.0
    };
    write_f32_le(&mut bytes, 35, params.fog_opacity.max(fog_boost * 0.65));
    write_f32_le(
        &mut bytes,
        36,
        params.fog_density.max(if fog_boost > 0.0 {
            0.45 + fog_boost * 1.4
        } else {
            0.0
        }),
    );
    write_f32_le(&mut bytes, 37, if solid { 1.0 } else { 0.0 });
    bytes
}

pub(crate) fn build_point_cloud_sort_fill_bytes(
    params: &NativePointCloudParams,
    state: &NativePointCloudGraphState,
    width: u32,
    height: u32,
    sort_count: u32,
) -> Vec<u8> {
    let mut bytes = vec![0_u8; 80];
    for (index, value) in point_cloud_view_proj(params, state, width, height)
        .iter()
        .enumerate()
    {
        write_f32_le(&mut bytes, index, *value);
    }
    write_u32_le(&mut bytes, 16, state.point_count);
    write_u32_le(&mut bytes, 17, sort_count.max(1));
    bytes
}

impl App {
    pub(crate) fn build_native_point_cloud_graph_job(
        &mut self,
        graph_layer: &NativeGraphLayer,
    ) -> Result<(NativeGraphLayerState, NativeGraphFrameJob), String> {
        let asset = self
            .native_point_cloud_assets
            .get(&graph_layer.layer_id)
            .cloned()
            .ok_or_else(|| "point cloud native buffers are not uploaded yet".to_string())?;
        let params = normalize_point_cloud_native_params(&graph_layer.params);
        let time = self.native_graph_time_seconds();
        let mut state = graph_layer.point_cloud_state.clone();
        let mut reset =
            state.signature != asset.signature || state.point_count != asset.point_count;
        if reset {
            state =
                NativePointCloudGraphState::new(asset.signature.clone(), asset.point_count, time);
        }
        let mut dt = if self.render_clock_mode == "manual" {
            self.native_graph_step_delta_this_render
        } else if state.prev_frame_time <= 0.0 {
            1.0 / self.target_fps.max(1) as f32
        } else {
            time - state.prev_frame_time
        };
        dt = dt.clamp(0.0, 1.0 / 15.0);
        state.prev_frame_time = time;
        let bass = if params.audio_reactive {
            self.audio0[1].clamp(0.0, 4.0)
        } else {
            0.0
        };
        let treble = if params.audio_reactive {
            self.audio0[3].clamp(0.0, 4.0)
        } else {
            0.0
        };
        let bass_delta = (bass - state.prev_bass).max(0.0);
        if bass_delta > 0.04 {
            state.burst_impulse += bass_delta * params.burst_gain * 8.0;
        }
        state.burst_impulse =
            (state.burst_impulse - state.burst_impulse * params.burst_decay * dt).max(0.0);
        state.prev_bass = bass;
        state.hue_shift_phase =
            (state.hue_shift_phase + params.hue_shift_speed * dt).rem_euclid(1.0);
        state.color_cycle_phase =
            (state.color_cycle_phase + params.color_cycle_speed * dt).rem_euclid(1.0);
        state.wave_time += params.wave_speed * dt;
        state.auto_rot_x_phase += params.auto_rotate[0] * dt;
        state.auto_rot_y_phase += params.auto_rotate[1] * dt;
        state.auto_rot_z_phase += params.auto_rotate[2] * dt;

        let compute_shader_id = "point-cloud-fx/compute";
        let sort_fill_shader_id = "point-cloud-fx/sort-fill";
        let sort_step_shader_id = "point-cloud-fx/sort-step";
        let render_shader_id = "point-cloud-fx/render";
        let (compute_hash, compute_source) =
            self.native_graph_shader_source(compute_shader_id, "cs_main")?;
        let (render_hash, render_source) =
            self.native_graph_shader_source(render_shader_id, "fs_main")?;
        self.native_graph_shader_source(render_shader_id, "vs_main")?;
        let should_sort = asset.depth_sort_enabled && asset.sort_count > 1;
        // Solid points: plain clouds as points or billboards write depth, so
        // the near side hides the far side. Strokes and Gaussian splats (the
        // only clouds that are depth sorted) stay soft and blended.
        let solid_points =
            params.solid_points && params.topology_id != 2 && !asset.depth_sort_enabled;
        let (sort_fill_hash, sort_fill_source, sort_step_hash, sort_step_source) = if should_sort {
            let fill = self.native_graph_shader_source(sort_fill_shader_id, "cs_main")?;
            let step = self.native_graph_shader_source(sort_step_shader_id, "cs_main")?;
            (Some(fill.0), Some(fill.1), Some(step.0), Some(step.1))
        } else {
            (None, None, None, None)
        };

        let prefix = format!("{}:point-cloud-fx", graph_layer.source_id);
        let id = |name: &str| format!("{prefix}:{name}");
        let home_id = id("home");
        let live_id = id("live");
        let sort_id = id("sort-pairs");
        let compute_uniform_id = id("compute-uniform");
        let render_uniform_id = id("render-uniform");
        let buffers_missing = self
            .renderer
            .as_ref()
            .map(|renderer| {
                !renderer.native_compute_graph_buffers.contains_key(&home_id)
                    || !renderer.native_compute_graph_buffers.contains_key(&live_id)
                    || !renderer.native_compute_graph_buffers.contains_key(&sort_id)
            })
            .unwrap_or(true);
        reset |= buffers_missing;
        let mut buffers = vec![
            NativeComputeGraphBufferSpec {
                id: home_id.clone(),
                byte_length: asset.home_bytes.len() as u64,
                kind: NativeComputeBufferBindingKind::StorageRead,
                initial_bytes: if reset {
                    asset.home_bytes.to_vec()
                } else {
                    Vec::new()
                },
                persistent: true,
                clear: reset,
                indirect: false,
            },
            NativeComputeGraphBufferSpec {
                id: live_id.clone(),
                byte_length: asset.live_bytes.len() as u64,
                kind: NativeComputeBufferBindingKind::StorageReadWrite,
                initial_bytes: if reset {
                    asset.live_bytes.to_vec()
                } else {
                    Vec::new()
                },
                persistent: true,
                clear: reset,
                indirect: false,
            },
            NativeComputeGraphBufferSpec {
                id: sort_id.clone(),
                byte_length: asset.sort_bytes.len() as u64,
                kind: NativeComputeBufferBindingKind::StorageReadWrite,
                initial_bytes: if reset {
                    asset.sort_bytes.to_vec()
                } else {
                    Vec::new()
                },
                persistent: true,
                clear: reset,
                indirect: false,
            },
            NativeComputeGraphBufferSpec {
                id: compute_uniform_id.clone(),
                byte_length: 288,
                kind: NativeComputeBufferBindingKind::Uniform,
                initial_bytes: build_point_cloud_compute_bytes(
                    &params, &state, dt, time, bass, treble,
                ),
                persistent: true,
                clear: false,
                indirect: false,
            },
            NativeComputeGraphBufferSpec {
                id: render_uniform_id.clone(),
                byte_length: 192,
                kind: NativeComputeBufferBindingKind::Uniform,
                initial_bytes: build_point_cloud_render_bytes(
                    &params,
                    &state,
                    self.pending_width,
                    self.pending_height,
                    solid_points,
                ),
                persistent: true,
                clear: false,
                indirect: false,
            },
        ];
        let compute_bindings = vec![
            NativeComputeGraphBindingSpec {
                binding: 0,
                resource_id: home_id.clone(),
                kind: NativeComputeGraphBindingKind::Buffer(
                    NativeComputeBufferBindingKind::StorageRead,
                ),
                source_slot: None,
            },
            NativeComputeGraphBindingSpec {
                binding: 1,
                resource_id: live_id.clone(),
                kind: NativeComputeGraphBindingKind::Buffer(
                    NativeComputeBufferBindingKind::StorageReadWrite,
                ),
                source_slot: None,
            },
            NativeComputeGraphBindingSpec {
                binding: 2,
                resource_id: compute_uniform_id,
                kind: NativeComputeGraphBindingKind::Buffer(
                    NativeComputeBufferBindingKind::Uniform,
                ),
                source_slot: None,
            },
        ];
        let compute_layout = native_graph_binding_layout_signature(&compute_bindings);
        let mut pass_plans = vec![NativeComputeGraphPassPlan {
            name: "point-cloud-fx/sim".to_string(),
            cache_key: format!("graph:{compute_shader_id}:{compute_hash}:cs_main:{compute_layout}"),
            source: compute_source,
            entry: "cs_main".to_string(),
            dispatch: [asset.point_count.div_ceil(64).max(1), 1, 1],
            bindings: compute_bindings,
        }];
        if should_sort {
            let fill_uniform_id = id("sort-fill-uniform");
            buffers.push(NativeComputeGraphBufferSpec {
                id: fill_uniform_id.clone(),
                byte_length: 80,
                kind: NativeComputeBufferBindingKind::Uniform,
                initial_bytes: build_point_cloud_sort_fill_bytes(
                    &params,
                    &state,
                    self.pending_width,
                    self.pending_height,
                    asset.sort_count,
                ),
                persistent: true,
                clear: false,
                indirect: false,
            });
            let fill_bindings = vec![
                NativeComputeGraphBindingSpec {
                    binding: 0,
                    resource_id: live_id.clone(),
                    kind: NativeComputeGraphBindingKind::Buffer(
                        NativeComputeBufferBindingKind::StorageRead,
                    ),
                    source_slot: None,
                },
                NativeComputeGraphBindingSpec {
                    binding: 1,
                    resource_id: sort_id.clone(),
                    kind: NativeComputeGraphBindingKind::Buffer(
                        NativeComputeBufferBindingKind::StorageReadWrite,
                    ),
                    source_slot: None,
                },
                NativeComputeGraphBindingSpec {
                    binding: 2,
                    resource_id: fill_uniform_id,
                    kind: NativeComputeGraphBindingKind::Buffer(
                        NativeComputeBufferBindingKind::Uniform,
                    ),
                    source_slot: None,
                },
            ];
            let fill_layout = native_graph_binding_layout_signature(&fill_bindings);
            pass_plans.push(NativeComputeGraphPassPlan {
                name: "point-cloud-fx/sort-fill".to_string(),
                cache_key: format!(
                    "graph:{sort_fill_shader_id}:{}:cs_main:{fill_layout}",
                    sort_fill_hash.expect("sort fill hash")
                ),
                source: sort_fill_source.expect("sort fill source"),
                entry: "cs_main".to_string(),
                dispatch: [asset.sort_count.div_ceil(64).max(1), 1, 1],
                bindings: fill_bindings,
            });
            let mut pass_index = 0_u32;
            let mut sequence_size = 2_u32;
            while sequence_size <= asset.sort_count {
                let mut stride = sequence_size / 2;
                while stride >= 1 {
                    let uniform_id = id(&format!("sort-step-uniform-{pass_index}"));
                    let mut uniform = vec![0_u8; 16];
                    write_u32_le(&mut uniform, 0, asset.point_count);
                    write_u32_le(&mut uniform, 1, asset.sort_count);
                    write_u32_le(&mut uniform, 2, sequence_size);
                    write_u32_le(&mut uniform, 3, stride);
                    buffers.push(NativeComputeGraphBufferSpec {
                        id: uniform_id.clone(),
                        byte_length: 16,
                        kind: NativeComputeBufferBindingKind::Uniform,
                        initial_bytes: uniform,
                        persistent: true,
                        clear: false,
                        indirect: false,
                    });
                    let bindings = vec![
                        NativeComputeGraphBindingSpec {
                            binding: 0,
                            resource_id: sort_id.clone(),
                            kind: NativeComputeGraphBindingKind::Buffer(
                                NativeComputeBufferBindingKind::StorageReadWrite,
                            ),
                            source_slot: None,
                        },
                        NativeComputeGraphBindingSpec {
                            binding: 1,
                            resource_id: uniform_id,
                            kind: NativeComputeGraphBindingKind::Buffer(
                                NativeComputeBufferBindingKind::Uniform,
                            ),
                            source_slot: None,
                        },
                    ];
                    let layout = native_graph_binding_layout_signature(&bindings);
                    pass_plans.push(NativeComputeGraphPassPlan {
                        name: format!("point-cloud-fx/sort-step-{pass_index}"),
                        cache_key: format!(
                            "graph:{sort_step_shader_id}:{}:cs_main:{layout}",
                            sort_step_hash.expect("sort step hash")
                        ),
                        source: sort_step_source.clone().expect("sort step source"),
                        entry: "cs_main".to_string(),
                        dispatch: [asset.sort_count.div_ceil(64).max(1), 1, 1],
                        bindings,
                    });
                    pass_index += 1;
                    if stride == 1 {
                        break;
                    }
                    stride /= 2;
                }
                if sequence_size > asset.sort_count / 2 {
                    break;
                }
                sequence_size *= 2;
            }
        }

        let output_slot = self.assign_source_frame_slot(&graph_layer.source_id)?;
        let seq = self.native_frame_index();
        let render_bindings = vec![
            NativeComputeGraphBindingSpec {
                binding: 0,
                resource_id: home_id,
                kind: NativeComputeGraphBindingKind::Buffer(
                    NativeComputeBufferBindingKind::StorageRead,
                ),
                source_slot: None,
            },
            NativeComputeGraphBindingSpec {
                binding: 1,
                resource_id: live_id,
                kind: NativeComputeGraphBindingKind::Buffer(
                    NativeComputeBufferBindingKind::StorageRead,
                ),
                source_slot: None,
            },
            NativeComputeGraphBindingSpec {
                binding: 2,
                resource_id: render_uniform_id,
                kind: NativeComputeGraphBindingKind::Buffer(
                    NativeComputeBufferBindingKind::Uniform,
                ),
                source_slot: None,
            },
            NativeComputeGraphBindingSpec {
                binding: 3,
                resource_id: sort_id,
                kind: NativeComputeGraphBindingKind::Buffer(
                    NativeComputeBufferBindingKind::StorageRead,
                ),
                source_slot: None,
            },
        ];
        let render_layout = native_graph_binding_layout_signature(&render_bindings);
        let render_plans = vec![NativeComputeGraphRenderPlan {
            name: "point-cloud-fx/render".to_string(),
            cache_key: format!(
                "graph-render:{render_shader_id}:{render_hash}:vs_main:fs_main:{}:{}:{}:{}:{render_layout}",
                NativeComputeGraphRenderBlend::Alpha.signature(),
                NativeComputeGraphPrimitiveTopology::TriangleList.signature(),
                if solid_points { "depth:write" } else { "nodepth:read" },
                NativeComputeGraphDepthCompare::Less.signature(),
            ),
            source: render_source,
            vertex_entry: "vs_main".to_string(),
            fragment_entry: "fs_main".to_string(),
            clear: true,
            include_snapshot: false,
            generate_mips: false,
            target: NativeComputeGraphRenderTarget::SourceFrame {
                source_id: graph_layer.source_id.clone(),
                slot: output_slot,
                seq,
            },
            blend: NativeComputeGraphRenderBlend::Alpha,
            vertex_count: 6,
            instance_count: asset.point_count,
            indirect_buffer_id: None,
            indirect_offset: 0,
            clear_color: [0.0, 0.0, 0.0, 0.0],
            primitive_topology: NativeComputeGraphPrimitiveTopology::TriangleList,
            depth_enabled: solid_points,
            depth_write: solid_points,
            depth_compare: NativeComputeGraphDepthCompare::Less,
            depth_load: false,
            depth_texture_id: None,
            depth_only: false,
            bindings: render_bindings,
        }];
        self.source_frames
            .insert(graph_layer.source_id.clone(), SourceFrame::full(seq));
        for layer in self.scene_layers.values_mut() {
            if layer.source_id.as_deref() == Some(graph_layer.source_id.as_str()) {
                layer.frame_slot = Some(output_slot);
            }
        }
        Ok((
            NativeGraphLayerState::PointCloudFx(state),
            NativeGraphFrameJob {
                textures: Vec::new(),
                buffers,
                pass_plans,
                render_plans,
                readback_buffer_ids: Vec::new(),
            },
        ))
    }

    pub(crate) fn apply_native_point_cloud(&mut self, command: &Value) -> Result<(), String> {
        let layer_id = string_at(command, &["layer_id"])
            .ok_or_else(|| "native point cloud upload requires layer_id".to_string())?;
        let signature = string_at(command, &["signature"])
            .ok_or_else(|| "native point cloud upload requires signature".to_string())?;
        let point_count = number_at(command, &["point_count"])
            .unwrap_or(0.0)
            .round()
            .clamp(1.0, 1_000_000.0) as u32;
        let sort_count = number_at(command, &["sort_count"])
            .unwrap_or(point_count as f64)
            .round()
            .clamp(point_count as f64, 1_048_576.0) as u32;
        let decode = |key: &str| -> Result<Vec<u8>, String> {
            let encoded = command
                .get(key)
                .and_then(Value::as_str)
                .ok_or_else(|| format!("native point cloud upload requires {key}"))?;
            base64::engine::general_purpose::STANDARD
                .decode(encoded.as_bytes())
                .map_err(|err| format!("native point cloud {key} decode failed: {err}"))
        };
        let home_bytes = decode("home_b64")?;
        let live_bytes = decode("live_b64")?;
        let sort_bytes = decode("sort_b64")?;
        let expected_home = point_count as usize * 112;
        let expected_live = point_count as usize * 48;
        let expected_sort = sort_count as usize * 8;
        if home_bytes.len() != expected_home
            || live_bytes.len() != expected_live
            || sort_bytes.len() != expected_sort
        {
            return Err(format!(
                "native point cloud buffer lengths do not match counts (home={}/{expected_home}, live={}/{expected_live}, sort={}/{expected_sort})",
                home_bytes.len(),
                live_bytes.len(),
                sort_bytes.len(),
            ));
        }
        self.native_point_cloud_assets.insert(
            layer_id,
            NativePointCloudAsset {
                signature,
                point_count,
                sort_count,
                depth_sort_enabled: bool_at(command, &["depth_sort_enabled"]).unwrap_or(false),
                home_bytes: home_bytes.into(),
                live_bytes: live_bytes.into(),
                sort_bytes: sort_bytes.into(),
            },
        );
        Ok(())
    }
}
