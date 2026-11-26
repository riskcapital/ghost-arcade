//! The 3D smoke visual.

use crate::*;

pub(crate) const SMOKE_3D_MAX_EMITTERS: usize = 8;

pub(crate) const SMOKE_3D_PRESSURE_ITERATIONS: usize = 20;

#[derive(Clone, Debug)]
pub(crate) struct NativeSmoke3DGraphState {
    pub(crate) grid: u32,
    pub(crate) vel_flip: bool,
    pub(crate) den_flip: bool,
    pub(crate) prs_flip: bool,
    pub(crate) splat_timer: f32,
    pub(crate) prev_bass: f32,
    pub(crate) burst_hold_timer: f32,
    pub(crate) auto_rot_x_phase: f32,
    pub(crate) auto_rot_y_phase: f32,
    pub(crate) auto_rot_z_phase: f32,
    pub(crate) prev_frame_time: f32,
}

impl NativeSmoke3DGraphState {
    pub(crate) fn new(grid: u32, time: f32) -> Self {
        Self {
            grid,
            vel_flip: false,
            den_flip: false,
            prs_flip: false,
            splat_timer: 0.0,
            prev_bass: 0.0,
            burst_hold_timer: 0.0,
            auto_rot_x_phase: 0.0,
            auto_rot_y_phase: 0.0,
            auto_rot_z_phase: 0.0,
            prev_frame_time: time,
        }
    }
}

#[derive(Clone, Debug)]
pub(crate) struct NativeSmoke3DParams {
    pub(crate) grid_size: u32,
    pub(crate) emission: f32,
    pub(crate) density: f32,
    pub(crate) velocity_decay: f32,
    pub(crate) density_decay: f32,
    pub(crate) emitter_count: u32,
    pub(crate) spread: f32,
    pub(crate) spawn_y: f32,
    pub(crate) splat_radius: f32,
    pub(crate) splat_strength: f32,
    pub(crate) splat_velocity_mag: f32,
    pub(crate) splat_rate: f32,
    pub(crate) bass: f32,
    pub(crate) audio_burst: f32,
    pub(crate) emitter_colors: [[f32; 3]; SMOKE_3D_MAX_EMITTERS],
    pub(crate) volume_scale_x: f32,
    pub(crate) volume_scale_z: f32,
    pub(crate) wind: [f32; 3],
    pub(crate) turb_strength: f32,
    pub(crate) turb_scale: f32,
    pub(crate) fov_deg: f32,
    pub(crate) camera_z: f32,
    pub(crate) rotate: [f32; 3],
    pub(crate) auto_rotate_x: f32,
    pub(crate) auto_rotate_y: f32,
    pub(crate) auto_rotate_z: f32,
    pub(crate) fog_color: [f32; 3],
    pub(crate) fog_opacity: f32,
    pub(crate) light_dir: [f32; 3],
    pub(crate) light_strength: f32,
    pub(crate) light_color: [f32; 3],
    pub(crate) ambient: f32,
    pub(crate) shadow_steps: u32,
    pub(crate) shadow_step_len: f32,
}

pub(crate) fn smoke_3d_default_emitter_colors() -> [[f32; 3]; SMOKE_3D_MAX_EMITTERS] {
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

pub(crate) fn smoke_3d_grid_size(params: &Value) -> u32 {
    match native_graph_param_u32(params, "gridSize", 32, 64, 48) {
        32 => 32,
        64 => 64,
        _ => 48,
    }
}

pub(crate) fn normalize_smoke_3d_native_params(params: &Value) -> NativeSmoke3DParams {
    let defaults = smoke_3d_default_emitter_colors();
    let mut emitter_colors = defaults;
    for index in 0..SMOKE_3D_MAX_EMITTERS {
        emitter_colors[index] = native_graph_param_emitter_color(params, index, defaults[index]);
    }
    NativeSmoke3DParams {
        grid_size: smoke_3d_grid_size(params),
        emission: native_graph_param_f32(params, "emission", 0.0, 16.0, 2.5),
        density: native_graph_param_f32(params, "density", 0.0, 16.0, 3.0),
        velocity_decay: native_graph_param_f32(params, "velocityDecay", 0.0, 1.0, 0.985),
        density_decay: native_graph_param_f32(params, "densityDecay", 0.0, 1.0, 0.992),
        emitter_count: native_graph_param_u32(
            params,
            "emitterCount",
            1,
            SMOKE_3D_MAX_EMITTERS as u32,
            4,
        ),
        spread: native_graph_param_f32(params, "spread", 0.0, 1.0, 0.3),
        spawn_y: native_graph_param_f32(params, "spawnY", -1.0, 1.0, -0.5),
        splat_radius: native_graph_param_f32(params, "splatRadius", 0.001, 0.5, 0.10),
        splat_strength: native_graph_param_f32(params, "splatStrength", 0.0, 32.0, 3.0),
        splat_velocity_mag: native_graph_param_f32(params, "splatVelocityMag", -16.0, 16.0, 0.6),
        splat_rate: native_graph_param_f32(params, "splatRate", 0.1, 240.0, 60.0),
        bass: native_graph_param_f32(params, "bass", 0.0, 1.0, 0.0),
        audio_burst: native_graph_param_f32(params, "audioBurst", 0.0, 8.0, 0.5),
        emitter_colors,
        volume_scale_x: native_graph_param_f32(params, "volumeScaleX", 0.05, 8.0, 1.6),
        volume_scale_z: native_graph_param_f32(params, "volumeScaleZ", 0.05, 8.0, 1.0),
        wind: [
            native_graph_param_f32(params, "windX", -8.0, 8.0, 0.0),
            native_graph_param_f32(params, "windY", -8.0, 8.0, 0.0),
            native_graph_param_f32(params, "windZ", -8.0, 8.0, 0.0),
        ],
        turb_strength: native_graph_param_f32(params, "turbStrength", 0.0, 16.0, 0.5),
        turb_scale: native_graph_param_f32(params, "turbScale", 0.01, 64.0, 2.5),
        fov_deg: native_graph_param_f32(params, "fovDeg", 10.0, 140.0, 50.0),
        camera_z: native_graph_param_f32(params, "cameraZ", 0.1, 40.0, 2.7),
        rotate: [
            native_graph_param_f32(params, "rotateX", -3600.0, 3600.0, 0.0),
            native_graph_param_f32(params, "rotateY", -3600.0, 3600.0, 0.0),
            native_graph_param_f32(params, "rotateZ", -3600.0, 3600.0, 0.0),
        ],
        auto_rotate_x: native_graph_param_f32(params, "autoRotateX", -720.0, 720.0, 0.0),
        auto_rotate_y: native_graph_param_f32(params, "autoRotateY", -720.0, 720.0, 0.0),
        auto_rotate_z: native_graph_param_f32(params, "autoRotateZ", -720.0, 720.0, 0.0),
        fog_color: native_graph_param_rgb(params, "fogColor", [0.08, 0.10, 0.18]),
        fog_opacity: native_graph_param_f32(params, "fogOpacity", 0.0, 1.0, 1.0),
        light_dir: [
            native_graph_param_f32(params, "lightDirX", -8.0, 8.0, 0.4),
            native_graph_param_f32(params, "lightDirY", -8.0, 8.0, 0.6),
            native_graph_param_f32(params, "lightDirZ", -8.0, 8.0, 0.7),
        ],
        light_strength: native_graph_param_f32(params, "lightStrength", 0.0, 16.0, 0.8),
        light_color: native_graph_param_rgb(params, "lightColor", [1.0, 0.95, 0.85]),
        ambient: native_graph_param_f32(params, "ambient", 0.0, 8.0, 0.25),
        shadow_steps: native_graph_param_u32(params, "shadowSteps", 0, 16, 4),
        shadow_step_len: native_graph_param_f32(params, "shadowStepLen", 0.0, 2.0, 0.06),
    }
}

pub(crate) fn build_smoke_3d_sim_uniform_bytes(
    params: &NativeSmoke3DParams,
    dt: f32,
    time: f32,
    fire: bool,
    burst_mul: f32,
) -> Vec<u8> {
    let mut bytes = vec![0_u8; 96];
    write_u32_le(&mut bytes, 0, params.grid_size);
    write_u32_le(&mut bytes, 1, params.grid_size);
    write_u32_le(&mut bytes, 2, params.grid_size);
    write_u32_le(&mut bytes, 3, params.emitter_count);
    write_f32_le(&mut bytes, 4, dt);
    write_f32_le(&mut bytes, 5, time);
    write_f32_le(&mut bytes, 6, if fire { burst_mul } else { 0.0 });
    write_f32_le(&mut bytes, 8, params.density_decay);
    write_f32_le(&mut bytes, 9, params.velocity_decay);
    write_f32_le(&mut bytes, 10, params.splat_radius);
    write_f32_le(&mut bytes, 12, params.wind[0]);
    write_f32_le(&mut bytes, 13, params.wind[1]);
    write_f32_le(&mut bytes, 14, params.wind[2]);
    write_f32_le(&mut bytes, 15, params.turb_strength);
    write_f32_le(&mut bytes, 16, params.turb_scale);
    bytes
}

pub(crate) fn build_smoke_3d_emitters_bytes(params: &NativeSmoke3DParams) -> Vec<u8> {
    let mut bytes = vec![0_u8; SMOKE_3D_MAX_EMITTERS * 48];
    let emitter_count = params.emitter_count.clamp(1, SMOKE_3D_MAX_EMITTERS as u32) as f32;
    for index in 0..SMOKE_3D_MAX_EMITTERS {
        let off = index * 12;
        if index as f32 >= emitter_count {
            continue;
        }
        let angle = if emitter_count > 1.0 {
            index as f32 / emitter_count * std::f32::consts::TAU
        } else {
            0.0
        };
        let color = params.emitter_colors[index % params.emitter_colors.len()];
        write_f32_le(&mut bytes, off, angle.cos() * params.spread * 0.5 + 0.5);
        write_f32_le(&mut bytes, off + 1, params.spawn_y * 0.5 + 0.5);
        write_f32_le(&mut bytes, off + 2, angle.sin() * params.spread * 0.5 + 0.5);
        write_f32_le(&mut bytes, off + 3, params.splat_radius);
        write_f32_le(&mut bytes, off + 4, color[0]);
        write_f32_le(&mut bytes, off + 5, color[1]);
        write_f32_le(&mut bytes, off + 6, color[2]);
        write_f32_le(&mut bytes, off + 7, params.splat_strength);
        write_f32_le(
            &mut bytes,
            off + 8,
            angle.cos() * params.splat_velocity_mag * 0.3,
        );
        write_f32_le(&mut bytes, off + 9, params.splat_velocity_mag);
        write_f32_le(
            &mut bytes,
            off + 10,
            angle.sin() * params.splat_velocity_mag * 0.3,
        );
    }
    bytes
}

pub(crate) fn build_smoke_3d_render_uniform_bytes(
    params: &NativeSmoke3DParams,
    state: &NativeSmoke3DGraphState,
    width: u32,
    height: u32,
) -> Vec<u8> {
    let aspect = width.max(1) as f32 / height.max(1) as f32;
    let proj = native_perspective(params.fov_deg, aspect, 0.01, 100.0);
    let view = native_translate(0.0, 0.0, -params.camera_z);
    let model = native_mat4_mul(
        native_rotate_z((params.rotate[2] + state.auto_rot_z_phase).to_radians()),
        native_mat4_mul(
            native_rotate_y((params.rotate[1] + state.auto_rot_y_phase).to_radians()),
            native_rotate_x((params.rotate[0] + state.auto_rot_x_phase).to_radians()),
        ),
    );
    let view_proj = native_mat4_mul(proj, native_mat4_mul(view, model));
    let inv_view_proj = native_mat4_invert(view_proj);
    let mut bytes = vec![0_u8; 192];
    for (index, value) in inv_view_proj.iter().enumerate() {
        write_f32_le(&mut bytes, index, *value);
    }
    write_f32_le(&mut bytes, 16, 0.0);
    write_f32_le(&mut bytes, 17, 0.0);
    write_f32_le(&mut bytes, 18, params.camera_z);
    write_f32_le(&mut bytes, 19, params.emission);
    write_f32_le(&mut bytes, 20, params.volume_scale_x);
    write_f32_le(&mut bytes, 21, 1.0);
    write_f32_le(&mut bytes, 22, params.volume_scale_z);
    write_f32_le(&mut bytes, 23, params.density);
    write_f32_le(&mut bytes, 24, params.fog_color[0]);
    write_f32_le(&mut bytes, 25, params.fog_color[1]);
    write_f32_le(&mut bytes, 26, params.fog_color[2]);
    write_f32_le(&mut bytes, 27, params.fog_opacity);
    write_u32_le(&mut bytes, 28, params.grid_size);
    write_u32_le(&mut bytes, 29, params.grid_size);
    write_u32_le(&mut bytes, 30, params.grid_size);
    let light = native_vec3_normalize(params.light_dir, [0.4, 0.6, 0.7]);
    write_f32_le(&mut bytes, 32, light[0]);
    write_f32_le(&mut bytes, 33, light[1]);
    write_f32_le(&mut bytes, 34, light[2]);
    write_f32_le(&mut bytes, 35, params.light_strength);
    write_f32_le(&mut bytes, 36, params.light_color[0]);
    write_f32_le(&mut bytes, 37, params.light_color[1]);
    write_f32_le(&mut bytes, 38, params.light_color[2]);
    write_f32_le(&mut bytes, 39, params.ambient);
    write_u32_le(&mut bytes, 40, params.shadow_steps);
    write_f32_le(&mut bytes, 41, params.shadow_step_len);
    bytes
}

impl App {
    pub(crate) fn build_native_smoke_3d_graph_job(
        &mut self,
        graph_layer: &NativeGraphLayer,
    ) -> Result<(NativeGraphLayerState, NativeGraphFrameJob), String> {
        let params = normalize_smoke_3d_native_params(&graph_layer.params);
        self.record_native_graph_workload(
            &graph_layer.layer_id,
            "smoke-3d",
            serde_json::json!({
                "gridSize": params.grid_size,
                "shadowSteps": params.shadow_steps,
                "emitterCount": params.emitter_count,
            }),
        );
        let time = self.native_graph_time_seconds();
        let source_id = graph_layer.source_id.clone();
        let safe_source = native_graph_buffer_safe_id(&source_id);
        let prefix = format!("3d-smoke:{}:{}", safe_source, params.grid_size);
        let id = |name: &str| format!("{prefix}:{name}");
        let persistent_ids = [
            id("velocity-a"),
            id("velocity-b"),
            id("density-a"),
            id("density-b"),
            id("divergence"),
            id("pressure-a"),
            id("pressure-b"),
        ];
        let buffers_missing = self
            .renderer
            .as_ref()
            .map(|renderer| {
                persistent_ids.iter().any(|buffer_id| {
                    !renderer
                        .native_compute_graph_buffers
                        .contains_key(buffer_id)
                })
            })
            .unwrap_or(true);
        let mut state = graph_layer.smoke_3d_state.clone();
        let reset_buffers = state.grid != params.grid_size || buffers_missing;
        if reset_buffers {
            state = NativeSmoke3DGraphState::new(params.grid_size, time);
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
        state.auto_rot_x_phase += params.auto_rotate_x * dt;
        state.auto_rot_y_phase += params.auto_rotate_y * dt;
        state.auto_rot_z_phase += params.auto_rotate_z * dt;

        let bass = params.bass.max(self.audio0[1]).clamp(0.0, 1.0);
        let bass_delta = (bass - state.prev_bass).max(0.0);
        if bass_delta > 0.05 {
            state.burst_hold_timer = state.burst_hold_timer.max(0.15);
        }
        state.burst_hold_timer = (state.burst_hold_timer - dt).max(0.0);
        state.prev_bass = bass;
        state.splat_timer += dt;
        let splat_period = 1.0 / params.splat_rate.max(0.1);
        let scheduled_fire = state.splat_timer >= splat_period;
        if scheduled_fire {
            state.splat_timer = 0.0;
        }
        let burst_active = state.burst_hold_timer > 0.0;
        let fire = scheduled_fire || burst_active || reset_buffers;
        let burst_mul = if burst_active {
            2.5 + params.audio_burst
        } else {
            1.0
        };

        let cell_count = u64::from(params.grid_size)
            .saturating_mul(u64::from(params.grid_size))
            .saturating_mul(u64::from(params.grid_size));
        let vec4_bytes = cell_count.saturating_mul(16);
        let f32_bytes = cell_count.saturating_mul(4);
        let sim_uniform_id = id("sim-uniform");
        let render_uniform_id = id("render-uniform");
        let emitters_id = id("emitters");
        let mut buffers = vec![
            NativeComputeGraphBufferSpec {
                id: sim_uniform_id.clone(),
                byte_length: 96,
                kind: NativeComputeBufferBindingKind::Uniform,
                initial_bytes: build_smoke_3d_sim_uniform_bytes(&params, dt, time, fire, burst_mul),
                persistent: true,
                clear: false,
                indirect: false,
            },
            NativeComputeGraphBufferSpec {
                id: render_uniform_id.clone(),
                byte_length: 192,
                kind: NativeComputeBufferBindingKind::Uniform,
                initial_bytes: build_smoke_3d_render_uniform_bytes(
                    &params,
                    &state,
                    self.pending_width,
                    self.pending_height,
                ),
                persistent: true,
                clear: false,
                indirect: false,
            },
            NativeComputeGraphBufferSpec {
                id: emitters_id.clone(),
                byte_length: (SMOKE_3D_MAX_EMITTERS * 48) as u64,
                kind: NativeComputeBufferBindingKind::StorageRead,
                initial_bytes: build_smoke_3d_emitters_bytes(&params),
                persistent: true,
                clear: false,
                indirect: false,
            },
        ];
        for buffer_id in persistent_ids.iter() {
            let byte_length = if buffer_id.ends_with("divergence")
                || buffer_id.ends_with("pressure-a")
                || buffer_id.ends_with("pressure-b")
            {
                f32_bytes
            } else {
                vec4_bytes
            };
            buffers.push(NativeComputeGraphBufferSpec {
                id: buffer_id.clone(),
                byte_length,
                kind: NativeComputeBufferBindingKind::StorageReadWrite,
                initial_bytes: Vec::new(),
                persistent: true,
                clear: reset_buffers,
                indirect: false,
            });
        }

        let dispatch = [params.grid_size.div_ceil(4).max(1); 3];
        let binding =
            |binding: u32, resource_id: String, buffer_kind: NativeComputeBufferBindingKind| {
                NativeComputeGraphBindingSpec {
                    binding,
                    resource_id,
                    kind: NativeComputeGraphBindingKind::Buffer(buffer_kind),
                    source_slot: None,
                }
            };
        let mut pass_plans = Vec::new();
        let mut add_pass = |name: String,
                            shader_id: &str,
                            entry: &str,
                            bindings: Vec<NativeComputeGraphBindingSpec>|
         -> Result<(), String> {
            let (hash, source) = self.native_graph_shader_source(shader_id, entry)?;
            let layout_sig = native_graph_binding_layout_signature(&bindings);
            pass_plans.push(NativeComputeGraphPassPlan {
                name,
                cache_key: format!("graph:{shader_id}:{hash}:{entry}:{layout_sig}"),
                source,
                entry: entry.to_string(),
                dispatch,
                bindings,
            });
            Ok(())
        };
        let ping = |flip: bool, a: &str, b: &str| if flip { id(b) } else { id(a) };
        let mut vel_flip = state.vel_flip;
        let mut den_flip = state.den_flip;
        let mut prs_flip = state.prs_flip;
        if fire {
            add_pass(
                "3d-smoke-splat".to_string(),
                "3d-smoke/splat",
                "cs_splat",
                vec![
                    binding(
                        0,
                        sim_uniform_id.clone(),
                        NativeComputeBufferBindingKind::Uniform,
                    ),
                    binding(
                        1,
                        ping(vel_flip, "velocity-a", "velocity-b"),
                        NativeComputeBufferBindingKind::StorageReadWrite,
                    ),
                    binding(
                        2,
                        ping(den_flip, "density-a", "density-b"),
                        NativeComputeBufferBindingKind::StorageReadWrite,
                    ),
                    binding(
                        3,
                        emitters_id.clone(),
                        NativeComputeBufferBindingKind::StorageRead,
                    ),
                ],
            )?;
        }
        add_pass(
            "3d-smoke-advect-velocity".to_string(),
            "3d-smoke/advect-velocity",
            "cs_advect_vel",
            vec![
                binding(
                    0,
                    sim_uniform_id.clone(),
                    NativeComputeBufferBindingKind::Uniform,
                ),
                binding(
                    1,
                    ping(vel_flip, "velocity-a", "velocity-b"),
                    NativeComputeBufferBindingKind::StorageRead,
                ),
                binding(
                    2,
                    ping(den_flip, "density-a", "density-b"),
                    NativeComputeBufferBindingKind::StorageReadWrite,
                ),
                binding(
                    3,
                    ping(!vel_flip, "velocity-a", "velocity-b"),
                    NativeComputeBufferBindingKind::StorageReadWrite,
                ),
            ],
        )?;
        vel_flip = !vel_flip;
        add_pass(
            "3d-smoke-divergence".to_string(),
            "3d-smoke/divergence",
            "cs_divergence",
            vec![
                binding(
                    0,
                    sim_uniform_id.clone(),
                    NativeComputeBufferBindingKind::Uniform,
                ),
                binding(
                    1,
                    ping(vel_flip, "velocity-a", "velocity-b"),
                    NativeComputeBufferBindingKind::StorageRead,
                ),
                binding(
                    2,
                    ping(den_flip, "density-a", "density-b"),
                    NativeComputeBufferBindingKind::StorageReadWrite,
                ),
                binding(
                    3,
                    id("divergence"),
                    NativeComputeBufferBindingKind::StorageReadWrite,
                ),
            ],
        )?;
        for iteration in 0..SMOKE_3D_PRESSURE_ITERATIONS {
            add_pass(
                format!("3d-smoke-jacobi-{}", iteration + 1),
                "3d-smoke/jacobi",
                "cs_jacobi",
                vec![
                    binding(
                        0,
                        sim_uniform_id.clone(),
                        NativeComputeBufferBindingKind::Uniform,
                    ),
                    binding(
                        1,
                        ping(vel_flip, "velocity-a", "velocity-b"),
                        NativeComputeBufferBindingKind::StorageRead,
                    ),
                    binding(
                        2,
                        ping(den_flip, "density-a", "density-b"),
                        NativeComputeBufferBindingKind::StorageReadWrite,
                    ),
                    binding(
                        3,
                        id("divergence"),
                        NativeComputeBufferBindingKind::StorageRead,
                    ),
                    binding(
                        4,
                        ping(prs_flip, "pressure-a", "pressure-b"),
                        NativeComputeBufferBindingKind::StorageRead,
                    ),
                    binding(
                        5,
                        ping(!prs_flip, "pressure-a", "pressure-b"),
                        NativeComputeBufferBindingKind::StorageReadWrite,
                    ),
                ],
            )?;
            prs_flip = !prs_flip;
        }
        add_pass(
            "3d-smoke-subtract-gradient".to_string(),
            "3d-smoke/subtract-gradient",
            "cs_subtract_grad",
            vec![
                binding(
                    0,
                    sim_uniform_id.clone(),
                    NativeComputeBufferBindingKind::Uniform,
                ),
                binding(
                    1,
                    ping(vel_flip, "velocity-a", "velocity-b"),
                    NativeComputeBufferBindingKind::StorageRead,
                ),
                binding(
                    2,
                    ping(den_flip, "density-a", "density-b"),
                    NativeComputeBufferBindingKind::StorageReadWrite,
                ),
                binding(
                    3,
                    ping(prs_flip, "pressure-a", "pressure-b"),
                    NativeComputeBufferBindingKind::StorageRead,
                ),
                binding(
                    4,
                    ping(!vel_flip, "velocity-a", "velocity-b"),
                    NativeComputeBufferBindingKind::StorageReadWrite,
                ),
            ],
        )?;
        vel_flip = !vel_flip;
        add_pass(
            "3d-smoke-advect-density".to_string(),
            "3d-smoke/advect-density",
            "cs_advect_den",
            vec![
                binding(
                    0,
                    sim_uniform_id.clone(),
                    NativeComputeBufferBindingKind::Uniform,
                ),
                binding(
                    1,
                    ping(vel_flip, "velocity-a", "velocity-b"),
                    NativeComputeBufferBindingKind::StorageRead,
                ),
                binding(
                    2,
                    ping(den_flip, "density-a", "density-b"),
                    NativeComputeBufferBindingKind::StorageRead,
                ),
                binding(
                    3,
                    ping(!den_flip, "density-a", "density-b"),
                    NativeComputeBufferBindingKind::StorageReadWrite,
                ),
            ],
        )?;
        den_flip = !den_flip;

        state.grid = params.grid_size;
        state.vel_flip = vel_flip;
        state.den_flip = den_flip;
        state.prs_flip = prs_flip;

        let render_shader_id = "3d-smoke/render";
        let (render_hash, render_source) =
            self.native_graph_shader_source(render_shader_id, "fs_main")?;
        self.native_graph_shader_source(render_shader_id, "vs_main")?;
        let slot = self.assign_source_frame_slot(&source_id)?;
        let seq = self.native_frame_index();
        let render_bindings = vec![
            binding(
                0,
                render_uniform_id,
                NativeComputeBufferBindingKind::Uniform,
            ),
            binding(
                1,
                ping(den_flip, "density-a", "density-b"),
                NativeComputeBufferBindingKind::StorageRead,
            ),
        ];
        let render_layout_sig = native_graph_binding_layout_signature(&render_bindings);
        let render_plan = NativeComputeGraphRenderPlan {
            name: "3d-smoke-raymarch".to_string(),
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
            clear: true,
            include_snapshot: false,
            generate_mips: false,
            target: NativeComputeGraphRenderTarget::SourceFrame {
                source_id: source_id.clone(),
                slot,
                seq,
            },
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
            bindings: render_bindings,
        };
        self.source_frames
            .insert(source_id.clone(), SourceFrame::full(seq));
        for layer in self.scene_layers.values_mut() {
            if layer.source_id.as_deref() == Some(source_id.as_str()) {
                layer.frame_slot = Some(slot);
            }
        }
        Ok((
            NativeGraphLayerState::Smoke3D(state),
            NativeGraphFrameJob {
                textures: Vec::new(),
                buffers,
                pass_plans,
                render_plans: vec![render_plan],
                readback_buffer_ids: Vec::new(),
            },
        ))
    }
}
