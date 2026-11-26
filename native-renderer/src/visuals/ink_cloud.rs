//! The ink cloud visual.

use crate::*;

pub(crate) const INK_CLOUD_PARTICLE_BYTES: u64 = 64;

pub(crate) const INK_CLOUD_DEFAULT_PARTICLES: u32 = 150_000;

pub(crate) const INK_CLOUD_MAX_PARTICLES: u32 = 600_000;

pub(crate) const INK_CLOUD_MAX_EMITTERS: usize = 8;

#[derive(Clone, Debug)]
pub(crate) struct NativeInkCloudGraphState {
    pub(crate) particle_count: u32,
    pub(crate) seed_key: String,
    pub(crate) prev_frame_time: f32,
    pub(crate) auto_rot_x_phase: f32,
    pub(crate) auto_rot_y_phase: f32,
    pub(crate) auto_rot_z_phase: f32,
    pub(crate) burst_hold_timer: f32,
    pub(crate) prev_bass: f32,
}

impl NativeInkCloudGraphState {
    pub(crate) fn new(particle_count: u32, seed_key: String, time: f32) -> Self {
        Self {
            particle_count,
            seed_key,
            prev_frame_time: time,
            auto_rot_x_phase: 0.0,
            auto_rot_y_phase: 0.0,
            auto_rot_z_phase: 0.0,
            burst_hold_timer: 0.0,
            prev_bass: 0.0,
        }
    }
}

#[derive(Clone, Debug)]
pub(crate) struct NativeInkCloudParams {
    pub(crate) particle_count: u32,
    pub(crate) emitter_count: u32,
    pub(crate) spread: f32,
    pub(crate) spawn_y: f32,
    pub(crate) spawn_jitter: f32,
    pub(crate) avg_lifetime: f32,
    pub(crate) lifetime_var: f32,
    pub(crate) size_start: f32,
    pub(crate) size_end: f32,
    pub(crate) fade_color: [f32; 3],
    pub(crate) color_fade_amount: f32,
    pub(crate) buoyancy: f32,
    pub(crate) damping: f32,
    pub(crate) wind: [f32; 3],
    pub(crate) curl1_strength: f32,
    pub(crate) curl1_scale: f32,
    pub(crate) curl1_time_flow: f32,
    pub(crate) curl2_strength: f32,
    pub(crate) curl2_scale: f32,
    pub(crate) curl2_time_flow: f32,
    pub(crate) vortex_enabled: bool,
    pub(crate) vortex_strength: f32,
    pub(crate) vortex_radius: f32,
    pub(crate) vortex_axis: [f32; 3],
    pub(crate) bass: f32,
    pub(crate) treble: f32,
    pub(crate) audio_burst_strength: f32,
    pub(crate) shimmer_strength: f32,
    pub(crate) brightness: f32,
    pub(crate) alpha_scale: f32,
    pub(crate) density: f32,
    pub(crate) bg_color: [f32; 3],
    pub(crate) bg_opacity: f32,
    pub(crate) emitter_colors: [[f32; 3]; INK_CLOUD_MAX_EMITTERS],
    pub(crate) fov_deg: f32,
    pub(crate) camera_z: f32,
    pub(crate) rotate: [f32; 3],
    pub(crate) auto_rotate_x: f32,
    pub(crate) auto_rotate_y: f32,
    pub(crate) auto_rotate_z: f32,
    pub(crate) audio_reactive: bool,
}

pub(crate) fn ink_cloud_default_emitter_colors() -> [[f32; 3]; INK_CLOUD_MAX_EMITTERS] {
    [
        [1.00, 0.40, 0.18],
        [0.18, 0.78, 1.00],
        [0.85, 0.20, 0.85],
        [0.20, 0.95, 0.55],
        [1.00, 0.85, 0.30],
        [0.50, 0.30, 1.00],
        [1.00, 0.30, 0.55],
        [0.30, 1.00, 0.95],
    ]
}

pub(crate) fn native_graph_param_emitter_color(params: &Value, index: usize, fallback: [f32; 3]) -> [f32; 3] {
    let keyed = format!("emitterColor{}", index + 1);
    if let Some(color) = color_path_or(params, &[keyed.as_str()]) {
        return color;
    }
    params
        .get("emitterColors")
        .and_then(Value::as_array)
        .and_then(|colors| colors.get(index))
        .and_then(|color| {
            if let Some(text) = color.as_str() {
                return parse_hex_color(text);
            }
            let values = color.as_array()?;
            Some([
                json_channel_to_unit(values.first()?),
                json_channel_to_unit(values.get(1)?),
                json_channel_to_unit(values.get(2)?),
            ])
        })
        .unwrap_or(fallback)
}

pub(crate) fn normalize_ink_cloud_native_params(params: &Value) -> NativeInkCloudParams {
    let defaults = ink_cloud_default_emitter_colors();
    let mut emitter_colors = defaults;
    for index in 0..INK_CLOUD_MAX_EMITTERS {
        emitter_colors[index] = native_graph_param_emitter_color(params, index, defaults[index]);
    }
    NativeInkCloudParams {
        particle_count: native_graph_param_u32(
            params,
            "particleCount",
            1024,
            INK_CLOUD_MAX_PARTICLES,
            INK_CLOUD_DEFAULT_PARTICLES,
        ),
        emitter_count: native_graph_param_u32(params, "emitterCount", 1, 8, 4),
        spread: native_graph_param_f32(params, "spread", 0.0, 16.0, 0.4),
        spawn_y: native_graph_param_f32(params, "spawnY", -16.0, 16.0, -0.4),
        spawn_jitter: native_graph_param_f32(params, "spawnJitter", 0.0, 4.0, 0.04),
        avg_lifetime: native_graph_param_f32(params, "avgLifetime", 0.05, 60.0, 3.0),
        lifetime_var: native_graph_param_f32(params, "lifetimeVar", 0.0, 4.0, 0.3),
        size_start: native_graph_param_f32(params, "sizeStart", 0.0001, 2.0, 0.008),
        size_end: native_graph_param_f32(params, "sizeEnd", 0.0001, 4.0, 0.05),
        fade_color: native_graph_param_rgb(params, "fadeColor", [0.04, 0.05, 0.10]),
        color_fade_amount: native_graph_param_f32(params, "colorFadeAmount", 0.0, 4.0, 1.0),
        buoyancy: native_graph_param_f32(params, "buoyancy", -16.0, 16.0, 0.18),
        damping: native_graph_param_f32(params, "damping", 0.0, 32.0, 0.6),
        wind: [
            native_graph_param_f32(params, "windX", -16.0, 16.0, 0.0),
            native_graph_param_f32(params, "windY", -16.0, 16.0, 0.0),
            native_graph_param_f32(params, "windZ", -16.0, 16.0, 0.0),
        ],
        curl1_strength: native_graph_param_f32(params, "curl1Strength", 0.0, 16.0, 0.3),
        curl1_scale: native_graph_param_f32(params, "curl1Scale", 0.01, 64.0, 1.6),
        curl1_time_flow: native_graph_param_f32(params, "curl1TimeFlow", 0.0, 16.0, 0.15),
        curl2_strength: native_graph_param_f32(params, "curl2Strength", 0.0, 16.0, 0.18),
        curl2_scale: native_graph_param_f32(params, "curl2Scale", 0.01, 128.0, 5.0),
        curl2_time_flow: native_graph_param_f32(params, "curl2TimeFlow", 0.0, 16.0, 0.4),
        vortex_enabled: native_graph_param_bool(params, "vortexEnabled", false),
        vortex_strength: native_graph_param_f32(params, "vortexStrength", 0.0, 32.0, 0.6),
        vortex_radius: native_graph_param_f32(params, "vortexRadius", 0.001, 32.0, 0.5),
        vortex_axis: [
            native_graph_param_f32(params, "vortexAxisX", -16.0, 16.0, 0.0),
            native_graph_param_f32(params, "vortexAxisY", -16.0, 16.0, 1.0),
            native_graph_param_f32(params, "vortexAxisZ", -16.0, 16.0, 0.0),
        ],
        bass: native_graph_param_f32(params, "bass", 0.0, 4.0, 0.0),
        treble: native_graph_param_f32(params, "treble", 0.0, 4.0, 0.0),
        audio_burst_strength: native_graph_param_f32(params, "audioBurstStrength", 0.0, 4.0, 0.3),
        shimmer_strength: native_graph_param_f32(params, "shimmerStrength", 0.0, 4.0, 0.04),
        brightness: native_graph_param_f32(params, "brightness", 0.0, 16.0, 1.2),
        alpha_scale: native_graph_param_f32(params, "alphaScale", 0.0, 8.0, 0.55),
        density: native_graph_param_f32(params, "density", 0.01, 64.0, 2.5),
        bg_color: native_graph_param_rgb(params, "bgColor", [0.04, 0.04, 0.08]),
        bg_opacity: native_graph_param_f32(params, "bgOpacity", 0.0, 1.0, 1.0),
        emitter_colors,
        fov_deg: native_graph_param_f32(params, "fovDeg", 1.0, 160.0, 50.0),
        camera_z: native_graph_param_f32(params, "cameraZ", 0.05, 100.0, 2.4),
        rotate: [
            native_graph_param_f32(params, "rotateX", -3600.0, 3600.0, 0.0),
            native_graph_param_f32(params, "rotateY", -3600.0, 3600.0, 0.0),
            native_graph_param_f32(params, "rotateZ", -3600.0, 3600.0, 0.0),
        ],
        auto_rotate_x: native_graph_param_f32(params, "autoRotateX", -3600.0, 3600.0, 0.0),
        auto_rotate_y: native_graph_param_f32(params, "autoRotateY", -3600.0, 3600.0, 0.0),
        auto_rotate_z: native_graph_param_f32(params, "autoRotateZ", -3600.0, 3600.0, 0.0),
        audio_reactive: native_graph_param_bool(params, "audioReactive", true),
    }
}

pub(crate) fn ink_cloud_seed_key(params: &NativeInkCloudParams) -> String {
    format!(
        "{}|{}|{:.4}|{:.4}|{:.4}|{:.4}",
        params.particle_count,
        params.emitter_count,
        params.avg_lifetime,
        params.size_start,
        params.spread,
        params.spawn_y,
    )
}

pub(crate) fn ink_cloud_hash(value: f32) -> f32 {
    let x = (value as f64 * 12.9898).sin() * 43758.5453;
    (x - x.floor()) as f32
}

pub(crate) fn build_ink_cloud_initial_particle_buffer_bytes(params: &NativeInkCloudParams) -> Vec<u8> {
    let count = params.particle_count.max(1024).min(INK_CLOUD_MAX_PARTICLES) as usize;
    let mut bytes = vec![0_u8; count.saturating_mul(INK_CLOUD_PARTICLE_BYTES as usize)];
    let emitter_count = params.emitter_count.clamp(1, INK_CLOUD_MAX_EMITTERS as u32);
    for i in 0..count {
        let off = i * 16;
        let init_age = ink_cloud_hash(i as f32 * 17.13 + 4.7) * params.avg_lifetime;
        write_f32_le(&mut bytes, off + 3, init_age);
        write_f32_le(&mut bytes, off + 7, params.avg_lifetime);
        write_f32_le(&mut bytes, off + 11, params.size_start);
        write_u32_le(&mut bytes, off + 15, (i as u32) % emitter_count);
    }
    bytes
}

pub(crate) fn build_ink_cloud_emitter_buffer_bytes(params: &NativeInkCloudParams) -> Vec<u8> {
    let mut bytes = vec![0_u8; INK_CLOUD_MAX_EMITTERS * 32];
    let emitter_count = params.emitter_count.clamp(1, INK_CLOUD_MAX_EMITTERS as u32) as f32;
    for index in 0..INK_CLOUD_MAX_EMITTERS {
        let off = index * 8;
        let angle = if emitter_count > 1.0 {
            index as f32 / emitter_count * std::f32::consts::TAU
        } else {
            0.0
        };
        let color = params.emitter_colors[index % params.emitter_colors.len()];
        write_f32_le(&mut bytes, off, angle.cos() * params.spread);
        write_f32_le(&mut bytes, off + 1, params.spawn_y);
        write_f32_le(&mut bytes, off + 2, angle.sin() * params.spread);
        write_f32_le(&mut bytes, off + 4, color[0]);
        write_f32_le(&mut bytes, off + 5, color[1]);
        write_f32_le(&mut bytes, off + 6, color[2]);
    }
    bytes
}

pub(crate) fn build_ink_cloud_sim_uniform_bytes(
    params: &NativeInkCloudParams,
    dt: f32,
    time: f32,
    bass: f32,
    treble: f32,
    audio_burst: f32,
) -> Vec<u8> {
    let mut bytes = vec![0_u8; 192];
    write_f32_le(&mut bytes, 0, dt);
    write_f32_le(&mut bytes, 1, time);
    write_u32_le(&mut bytes, 2, params.particle_count);
    write_u32_le(
        &mut bytes,
        3,
        params.emitter_count.clamp(1, INK_CLOUD_MAX_EMITTERS as u32),
    );
    write_f32_le(&mut bytes, 4, params.avg_lifetime);
    write_f32_le(&mut bytes, 5, params.lifetime_var);
    write_f32_le(&mut bytes, 6, params.size_start);
    write_f32_le(&mut bytes, 7, params.size_end);
    write_f32_le(&mut bytes, 8, params.fade_color[0]);
    write_f32_le(&mut bytes, 9, params.fade_color[1]);
    write_f32_le(&mut bytes, 10, params.fade_color[2]);
    write_f32_le(&mut bytes, 11, params.color_fade_amount);
    write_f32_le(&mut bytes, 12, params.buoyancy);
    write_f32_le(&mut bytes, 13, params.damping);
    write_f32_le(&mut bytes, 14, params.spawn_jitter);
    write_f32_le(&mut bytes, 15, audio_burst);
    write_f32_le(&mut bytes, 16, params.wind[0]);
    write_f32_le(&mut bytes, 17, params.wind[1]);
    write_f32_le(&mut bytes, 18, params.wind[2]);
    write_f32_le(&mut bytes, 20, params.curl1_strength);
    write_f32_le(&mut bytes, 21, params.curl1_scale);
    write_f32_le(&mut bytes, 22, params.curl1_time_flow);
    write_f32_le(&mut bytes, 24, params.curl2_strength);
    write_f32_le(&mut bytes, 25, params.curl2_scale);
    write_f32_le(&mut bytes, 26, params.curl2_time_flow);
    let vortex_enabled = if params.vortex_enabled { 1.0 } else { 0.0 };
    write_f32_le(&mut bytes, 31, params.vortex_strength * vortex_enabled);
    write_f32_le(&mut bytes, 32, params.vortex_axis[0]);
    write_f32_le(&mut bytes, 33, params.vortex_axis[1]);
    write_f32_le(&mut bytes, 34, params.vortex_axis[2]);
    write_f32_le(&mut bytes, 35, params.vortex_radius);
    write_f32_le(&mut bytes, 36, bass);
    write_f32_le(&mut bytes, 37, treble);
    write_f32_le(&mut bytes, 38, params.shimmer_strength);
    bytes
}

pub(crate) fn build_ink_cloud_render_uniform_bytes(
    params: &NativeInkCloudParams,
    state: &NativeInkCloudGraphState,
    width: u32,
    height: u32,
    time: f32,
) -> Vec<u8> {
    let aspect = width.max(1) as f32 / height.max(1) as f32;
    let proj = native_perspective(params.fov_deg, aspect, 0.05, 100.0);
    let view = native_translate(0.0, 0.0, -params.camera_z);
    let model = native_mat4_mul(
        native_rotate_z((params.rotate[2] + state.auto_rot_z_phase).to_radians()),
        native_mat4_mul(
            native_rotate_y((params.rotate[1] + state.auto_rot_y_phase).to_radians()),
            native_rotate_x((params.rotate[0] + state.auto_rot_x_phase).to_radians()),
        ),
    );
    let view_proj = native_mat4_mul(proj, native_mat4_mul(view, model));
    let mut bytes = vec![0_u8; 128];
    for (index, value) in view_proj.iter().enumerate() {
        write_f32_le(&mut bytes, index, *value);
    }
    write_f32_le(&mut bytes, 16, 1.0);
    write_f32_le(&mut bytes, 17, 0.0);
    write_f32_le(&mut bytes, 18, 0.0);
    write_f32_le(&mut bytes, 20, 0.0);
    write_f32_le(&mut bytes, 21, 1.0);
    write_f32_le(&mut bytes, 22, 0.0);
    write_f32_le(&mut bytes, 24, params.brightness);
    write_f32_le(&mut bytes, 25, params.alpha_scale);
    write_f32_le(&mut bytes, 26, params.density);
    write_f32_le(&mut bytes, 27, time);
    bytes
}

pub(crate) fn build_ink_cloud_background_uniform_bytes(params: &NativeInkCloudParams) -> Vec<u8> {
    let mut bytes = vec![0_u8; 16];
    write_f32_le(&mut bytes, 0, params.bg_color[0]);
    write_f32_le(&mut bytes, 1, params.bg_color[1]);
    write_f32_le(&mut bytes, 2, params.bg_color[2]);
    write_f32_le(&mut bytes, 3, params.bg_opacity);
    bytes
}

impl App {
    pub(crate) fn build_native_ink_cloud_graph_job(
        &mut self,
        graph_layer: &NativeGraphLayer,
    ) -> Result<(NativeGraphLayerState, NativeGraphFrameJob), String> {
        let params = normalize_ink_cloud_native_params(&graph_layer.params);
        let seed_key = ink_cloud_seed_key(&params);
        let time = self.native_graph_time_seconds();
        let mut state = graph_layer.ink_cloud_state.clone();
        let mut reset_particles =
            state.particle_count != params.particle_count || state.seed_key != seed_key;
        if reset_particles {
            state = NativeInkCloudGraphState::new(params.particle_count, seed_key.clone(), time);
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
            params.bass.max(self.audio0[1]).clamp(0.0, 2.0)
        } else {
            0.0
        };
        let treble = if params.audio_reactive {
            params.treble.max(self.audio0[3]).clamp(0.0, 2.0)
        } else {
            0.0
        };
        let bass_delta = (bass - state.prev_bass).max(0.0);
        if bass_delta > 0.05 {
            state.burst_hold_timer = state.burst_hold_timer.max(0.15);
        }
        state.burst_hold_timer = (state.burst_hold_timer - dt).max(0.0);
        state.prev_bass = bass;
        let audio_burst = if state.burst_hold_timer > 0.0 {
            params.audio_burst_strength
        } else {
            0.0
        };
        state.auto_rot_x_phase += params.auto_rotate_x * dt;
        state.auto_rot_y_phase += params.auto_rotate_y * dt;
        state.auto_rot_z_phase += params.auto_rotate_z * dt;

        let sim_shader_id = "ink-cloud/sim";
        let bg_shader_id = "ink-cloud/background";
        let render_shader_id = "ink-cloud/render";
        let (sim_hash, sim_source) = self.native_graph_shader_source(sim_shader_id, "cs_main")?;
        let (bg_hash, bg_source) = self.native_graph_shader_source(bg_shader_id, "fs_main")?;
        let (render_hash, render_source) =
            self.native_graph_shader_source(render_shader_id, "fs_main")?;

        let source_id = graph_layer.source_id.clone();
        let safe_source = native_graph_buffer_safe_id(&source_id);
        let prefix = format!("ink-cloud:{}:{}", safe_source, params.particle_count.max(1));
        let id = |name: &str| format!("{prefix}:{name}");
        let particle_id = id("particles");
        let sim_uniform_id = id("sim-uniform");
        let render_uniform_id = id("render-uniform");
        let bg_uniform_id = id("bg-uniform");
        let emitter_id = id("emitters");
        let particle_buffer_missing = self
            .renderer
            .as_ref()
            .map(|renderer| {
                !renderer
                    .native_compute_graph_buffers
                    .contains_key(&particle_id)
            })
            .unwrap_or(true);
        if particle_buffer_missing {
            reset_particles = true;
            state = NativeInkCloudGraphState::new(params.particle_count, seed_key.clone(), time);
            dt = 1.0 / self.target_fps.max(1) as f32;
        }
        let seq = self.native_frame_index();

        let buffers = vec![
            NativeComputeGraphBufferSpec {
                id: sim_uniform_id.clone(),
                byte_length: 192,
                kind: NativeComputeBufferBindingKind::Uniform,
                initial_bytes: build_ink_cloud_sim_uniform_bytes(
                    &params,
                    dt,
                    time,
                    bass,
                    treble,
                    audio_burst,
                ),
                persistent: true,
                clear: false,
                indirect: false,
            },
            NativeComputeGraphBufferSpec {
                id: render_uniform_id.clone(),
                byte_length: 128,
                kind: NativeComputeBufferBindingKind::Uniform,
                initial_bytes: build_ink_cloud_render_uniform_bytes(
                    &params,
                    &state,
                    self.pending_width,
                    self.pending_height,
                    time,
                ),
                persistent: true,
                clear: false,
                indirect: false,
            },
            NativeComputeGraphBufferSpec {
                id: bg_uniform_id.clone(),
                byte_length: 16,
                kind: NativeComputeBufferBindingKind::Uniform,
                initial_bytes: build_ink_cloud_background_uniform_bytes(&params),
                persistent: true,
                clear: false,
                indirect: false,
            },
            NativeComputeGraphBufferSpec {
                id: emitter_id.clone(),
                byte_length: (INK_CLOUD_MAX_EMITTERS * 32) as u64,
                kind: NativeComputeBufferBindingKind::StorageRead,
                initial_bytes: build_ink_cloud_emitter_buffer_bytes(&params),
                persistent: true,
                clear: false,
                indirect: false,
            },
            NativeComputeGraphBufferSpec {
                id: particle_id.clone(),
                byte_length: u64::from(params.particle_count)
                    .saturating_mul(INK_CLOUD_PARTICLE_BYTES),
                kind: NativeComputeBufferBindingKind::StorageReadWrite,
                initial_bytes: if reset_particles {
                    build_ink_cloud_initial_particle_buffer_bytes(&params)
                } else {
                    Vec::new()
                },
                persistent: true,
                clear: reset_particles,
                indirect: false,
            },
        ];

        let sim_bindings = vec![
            NativeComputeGraphBindingSpec {
                binding: 0,
                resource_id: particle_id.clone(),
                kind: NativeComputeGraphBindingKind::Buffer(
                    NativeComputeBufferBindingKind::StorageReadWrite,
                ),
                source_slot: None,
            },
            NativeComputeGraphBindingSpec {
                binding: 1,
                resource_id: sim_uniform_id,
                kind: NativeComputeGraphBindingKind::Buffer(
                    NativeComputeBufferBindingKind::Uniform,
                ),
                source_slot: None,
            },
            NativeComputeGraphBindingSpec {
                binding: 2,
                resource_id: emitter_id,
                kind: NativeComputeGraphBindingKind::Buffer(
                    NativeComputeBufferBindingKind::StorageRead,
                ),
                source_slot: None,
            },
        ];
        let sim_layout_sig = native_graph_binding_layout_signature(&sim_bindings);
        let pass_plans = vec![NativeComputeGraphPassPlan {
            name: "ink-cloud-sim".to_string(),
            cache_key: format!("graph:{sim_shader_id}:{sim_hash}:cs_main:{sim_layout_sig}"),
            source: sim_source,
            entry: "cs_main".to_string(),
            dispatch: [params.particle_count.div_ceil(64).max(1), 1, 1],
            bindings: sim_bindings,
        }];

        let slot = self.assign_source_frame_slot(&source_id)?;
        let target = NativeComputeGraphRenderTarget::SourceFrame {
            source_id: source_id.clone(),
            slot,
            seq,
        };
        let bg_bindings = vec![NativeComputeGraphBindingSpec {
            binding: 0,
            resource_id: bg_uniform_id,
            kind: NativeComputeGraphBindingKind::Buffer(NativeComputeBufferBindingKind::Uniform),
            source_slot: None,
        }];
        let bg_layout_sig = native_graph_binding_layout_signature(&bg_bindings);
        let render_bindings = vec![
            NativeComputeGraphBindingSpec {
                binding: 0,
                resource_id: particle_id,
                kind: NativeComputeGraphBindingKind::Buffer(
                    NativeComputeBufferBindingKind::StorageRead,
                ),
                source_slot: None,
            },
            NativeComputeGraphBindingSpec {
                binding: 1,
                resource_id: render_uniform_id,
                kind: NativeComputeGraphBindingKind::Buffer(
                    NativeComputeBufferBindingKind::Uniform,
                ),
                source_slot: None,
            },
        ];
        let render_layout_sig = native_graph_binding_layout_signature(&render_bindings);
        let render_plans = vec![
            NativeComputeGraphRenderPlan {
                name: "ink-cloud-background".to_string(),
                cache_key: format!(
                    "graph-render:{bg_shader_id}:{bg_hash}:vs_main:fs_main:{}:{}:{}:{}:{}:{bg_layout_sig}",
                    NativeComputeGraphRenderBlend::Alpha.signature(),
                    NativeComputeGraphPrimitiveTopology::TriangleList.signature(),
                    "nodepth",
                    "read",
                    NativeComputeGraphDepthCompare::Less.signature(),
                ),
                source: bg_source,
                vertex_entry: "vs_main".to_string(),
                fragment_entry: "fs_main".to_string(),
                clear: true,
                include_snapshot: false,
                generate_mips: false,
                target: target.clone(),
                blend: NativeComputeGraphRenderBlend::Alpha,
                vertex_count: 3,
                instance_count: 1,
                indirect_buffer_id: None,
                indirect_offset: 0,
                clear_color: [0.0, 0.0, 0.0, 0.0],
                primitive_topology: NativeComputeGraphPrimitiveTopology::TriangleList,
                depth_enabled: false,
                depth_write: false,
                depth_compare: NativeComputeGraphDepthCompare::Less,
                depth_load: false,
                depth_texture_id: None,
                depth_only: false,
                bindings: bg_bindings,
            },
            NativeComputeGraphRenderPlan {
                name: "ink-cloud-render".to_string(),
                cache_key: format!(
                    "graph-render:{render_shader_id}:{render_hash}:vs_main:fs_main:{}:{}:{}:{}:{}:{render_layout_sig}",
                    NativeComputeGraphRenderBlend::Alpha.signature(),
                    NativeComputeGraphPrimitiveTopology::TriangleList.signature(),
                    "nodepth",
                    "read",
                    NativeComputeGraphDepthCompare::Less.signature(),
                ),
                source: render_source,
                vertex_entry: "vs_main".to_string(),
                fragment_entry: "fs_main".to_string(),
                clear: false,
                include_snapshot: false,
                generate_mips: false,
                target,
                blend: NativeComputeGraphRenderBlend::Alpha,
                vertex_count: 6,
                instance_count: params.particle_count.max(1),
                indirect_buffer_id: None,
                indirect_offset: 0,
                clear_color: [0.0, 0.0, 0.0, 0.0],
                primitive_topology: NativeComputeGraphPrimitiveTopology::TriangleList,
                depth_enabled: false,
                depth_write: false,
                depth_compare: NativeComputeGraphDepthCompare::Less,
                depth_load: false,
                depth_texture_id: None,
                depth_only: false,
                bindings: render_bindings,
            },
        ];
        self.source_frames
            .insert(source_id.clone(), SourceFrame::full(seq));
        for layer in self.scene_layers.values_mut() {
            if layer.source_id.as_deref() == Some(source_id.as_str()) {
                layer.frame_slot = Some(slot);
            }
        }
        Ok((
            NativeGraphLayerState::InkCloud(state),
            NativeGraphFrameJob {
                textures: Vec::new(),
                buffers,
                pass_plans,
                render_plans,
                readback_buffer_ids: Vec::new(),
            },
        ))
    }
}
