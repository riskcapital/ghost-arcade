//! The pixel particles visual.

use crate::*;

#[derive(Clone, Debug)]
pub(crate) struct NativePixelParticlesGraphState {
    pub(crate) mode_id: u32,
    pub(crate) particle_count: u32,
    pub(crate) input_source_id: String,
    pub(crate) prev_frame_time: f32,
    pub(crate) director: ParticleDirectorTrack,
}

impl NativePixelParticlesGraphState {
    pub(crate) fn new(mode_id: u32, particle_count: u32, input_source_id: String, time: f32) -> Self {
        Self {
            mode_id,
            particle_count,
            input_source_id,
            prev_frame_time: time,
            director: ParticleDirectorTrack::default(),
        }
    }
}

pub(crate) const PIXEL_PARTICLES_PARTICLE_BYTES: u64 = 32;

pub(crate) const PIXEL_PARTICLES_MAX: u32 = 1_000_000;

/// Must match PIXEL_PARTICLES_GLOBALS_BYTES / _RENDER_UNIFORM_BYTES in
/// webgpuPixelParticles.ts.
pub(crate) const PIXEL_PARTICLES_GLOBALS_BYTES: u64 = 208;

pub(crate) const PIXEL_PARTICLES_RENDER_UNIFORM_BYTES: u64 = 160;

pub(crate) const PIXEL_PARTICLES_NEAR: f32 = 0.1;

pub(crate) const PIXEL_PARTICLES_FAR: f32 = 100.0;

#[derive(Clone, Debug)]
pub(crate) struct NativePixelParticlesParams {
    pub(crate) particle_count: u32,
    pub(crate) mode_id: u32,
    pub(crate) knobs: [f32; 4],
    pub(crate) base_size: f32,
    pub(crate) opacity: f32,
    pub(crate) anchor_jitter: f32,
    pub(crate) fov_deg: f32,
    pub(crate) camera_z: f32,
    pub(crate) camera_yaw: f32,
    pub(crate) camera_pitch: f32,
    pub(crate) pan_x: f32,
    pub(crate) pan_y: f32,
    pub(crate) light_enabled: bool,
    pub(crate) light: [f32; 3],
    pub(crate) light_intensity: f32,
    pub(crate) light_ambient: f32,
    pub(crate) light_height_strength: f32,
    pub(crate) noise_amp_xy: f32,
    pub(crate) noise_amp_z: f32,
    pub(crate) noise_freq: f32,
    pub(crate) noise_speed: f32,
    pub(crate) depth_source_id: u32,
    pub(crate) depth_curve: f32,
    pub(crate) depth_contrast: f32,
    pub(crate) depth_smoothing: f32,
    pub(crate) depth_center: f32,
    pub(crate) depth_motion_id: u32,
    pub(crate) depth_motion_amount: f32,
    pub(crate) depth_motion_speed: f32,
    pub(crate) depth_motion_scale: f32,
    pub(crate) depth_motion_coupling: f32,
    pub(crate) depth_motion_phase: f32,
    pub(crate) mirror_x: bool,
    pub(crate) motion_reactive: f32,
    pub(crate) motion_decay: f32,
    /// Sphere grains with depth instead of the soft glow disc.
    pub(crate) grain_lit: bool,
    pub(crate) grain_specular: f32,
    pub(crate) grain_shininess: f32,
    pub(crate) shadow_strength: f32,
    pub(crate) shadow_reach: f32,
    pub(crate) shadow_softness: f32,
    /// 0 = nearest part of the relief in focus, 1 = farthest.
    pub(crate) focus_depth: f32,
    /// 0 = no depth of field.
    pub(crate) aperture: f32,
}

pub(crate) fn normalize_pixel_particles_native_params(params: &Value) -> NativePixelParticlesParams {
    let mode = native_particle_field_enum(params, "mode", "depth-shift");
    let mode_id = match mode.as_str() {
        "identity" => 0,
        "sand-fall" => 2,
        "scatter" => 3,
        "halftone" => 4,
        "stipple-noise" => 5,
        "dissolve" => 6,
        _ => 1,
    };
    let knobs = match mode_id {
        1 => [
            native_graph_param_f32(params, "depthAmount", 0.0, 8.0, 0.6),
            0.0,
            native_graph_param_f32(params, "depthSpinSpeed", -16.0, 16.0, 0.0),
            native_graph_param_f32(params, "depthSpinAxis", 0.0, 1.0, 0.0),
        ],
        2 => [
            native_graph_param_f32(params, "sandFallSpeed", 0.001, 16.0, 0.4),
            native_graph_param_f32(params, "sandFloorY", -16.0, 16.0, -1.0),
            native_graph_param_f32(params, "sandDrift", 0.0, 8.0, 0.02),
            native_graph_param_f32(params, "sandDensity", 0.0, 1.0, 1.0),
        ],
        3 => [
            native_graph_param_f32(params, "scatterAmp", 0.0, 8.0, 0.04),
            native_graph_param_f32(params, "scatterRecovery", 0.0, 16.0, 1.5),
            native_graph_param_f32(params, "scatterFreq", 0.001, 128.0, 4.0),
            0.0,
        ],
        4 => [
            native_graph_param_f32(params, "halftoneCellSize", 0.0001, 1.0, 0.012),
            1.0,
            0.0,
            0.0,
        ],
        5 => [
            native_graph_param_f32(params, "stippleAmp", 0.0, 8.0, 0.008),
            native_graph_param_f32(params, "stippleFreq", 0.001, 256.0, 35.0),
            0.0,
            0.0,
        ],
        6 => [
            native_graph_param_f32(params, "dissolveSpread", 0.0, 16.0, 1.6),
            native_graph_param_f32(params, "dissolveSpeed", 0.001, 16.0, 0.6),
            native_graph_param_f32(params, "dissolveSwirl", -16.0, 16.0, 0.5),
            0.0,
        ],
        _ => [0.0; 4],
    };
    let depth_source_id =
        match native_particle_field_enum(params, "depthSource", "luminance").as_str() {
            "inverse-luminance" => 1,
            "edge-density" => 2,
            "saturation" => 3,
            "native-depth" => 4,
            _ => 0,
        };
    let depth_motion_id = match native_particle_field_enum(params, "depthMotion", "locked").as_str()
    {
        "drift" => 1,
        "orbit" => 2,
        "ripple" => 3,
        "swarm" => 4,
        "breathe" => 5,
        _ => 0,
    };
    NativePixelParticlesParams {
        particle_count: native_graph_param_u32(
            params,
            "particleCount",
            1_024,
            PIXEL_PARTICLES_MAX,
            250_000,
        ),
        mode_id,
        knobs,
        base_size: native_graph_param_f32(params, "baseSize", 0.0005, 0.05, 0.005),
        opacity: native_graph_param_f32(params, "opacity", 0.0, 1.0, 1.0),
        anchor_jitter: native_graph_param_f32(params, "anchorJitter", 0.0, 1.0, 0.6),
        fov_deg: native_graph_param_f32(params, "fovDeg", 10.0, 120.0, 50.0),
        camera_z: native_graph_param_f32(params, "cameraZ", 0.5, 10.0, 2.2),
        camera_yaw: native_graph_param_f32(params, "cameraYaw", -3600.0, 3600.0, 0.0),
        camera_pitch: native_graph_param_f32(params, "cameraPitch", -3600.0, 3600.0, 0.0),
        pan_x: native_graph_param_f32(params, "panX", -16.0, 16.0, 0.0),
        pan_y: native_graph_param_f32(params, "panY", -16.0, 16.0, 0.0),
        light_enabled: params
            .get("lightEnabled")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        light: [
            native_graph_param_f32(params, "lightX", -16.0, 16.0, 1.0),
            native_graph_param_f32(params, "lightY", -16.0, 16.0, 1.0),
            native_graph_param_f32(params, "lightZ", -16.0, 16.0, 1.5),
        ],
        light_intensity: native_graph_param_f32(params, "lightIntensity", 0.0, 16.0, 1.5),
        light_ambient: native_graph_param_f32(params, "lightAmbient", 0.0, 4.0, 0.25),
        light_height_strength: native_graph_param_f32(
            params,
            "lightHeightStrength",
            0.0,
            16.0,
            1.5,
        ),
        noise_amp_xy: native_graph_param_f32(params, "noiseAmpXY", 0.0, 8.0, 0.0),
        noise_amp_z: native_graph_param_f32(params, "noiseAmpZ", 0.0, 16.0, 0.0),
        noise_freq: native_graph_param_f32(params, "noiseFreq", 0.001, 128.0, 4.0),
        noise_speed: native_graph_param_f32(params, "noiseSpeed", 0.0, 16.0, 0.5),
        depth_source_id: if depth_source_id == 4 {
            0
        } else {
            depth_source_id
        },
        depth_curve: native_graph_param_f32(params, "depthCurve", 0.05, 4.0, 1.0),
        depth_contrast: native_graph_param_f32(params, "depthContrast", 0.01, 4.0, 1.0),
        depth_smoothing: native_graph_param_f32(params, "depthSmoothing", 0.0, 1.0, 0.2),
        depth_center: native_graph_param_f32(params, "depthCenter", 0.0, 1.0, 0.5),
        depth_motion_id,
        depth_motion_amount: native_graph_param_f32(params, "depthMotionAmount", 0.0, 2.0, 0.08),
        depth_motion_speed: native_graph_param_f32(params, "depthMotionSpeed", 0.0, 4.0, 0.45),
        depth_motion_scale: native_graph_param_f32(params, "depthMotionScale", 0.1, 24.0, 3.5),
        depth_motion_coupling: native_graph_param_f32(params, "depthMotionCoupling", 0.0, 3.0, 0.7),
        depth_motion_phase: native_graph_param_f32(
            params,
            "depthMotionPhase",
            -100_000.0,
            100_000.0,
            0.0,
        ),
        mirror_x: params
            .get("mirrorX")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        motion_reactive: native_graph_param_f32(params, "motionReactive", 0.0, 8.0, 0.0),
        motion_decay: native_graph_param_f32(params, "motionDecay", 0.0, 60.0, 3.0),
        grain_lit: native_particle_field_enum(params, "grainShading", "soft") == "lit",
        grain_specular: native_graph_param_f32(params, "grainSpecular", 0.0, 4.0, 0.35),
        grain_shininess: native_graph_param_f32(params, "grainShininess", 1.0, 256.0, 24.0),
        shadow_strength: native_graph_param_f32(params, "shadowStrength", 0.0, 1.0, 0.65),
        shadow_reach: native_graph_param_f32(params, "shadowReach", 0.001, 0.5, 0.06),
        shadow_softness: native_graph_param_f32(params, "shadowSoftness", 0.001, 1.0, 0.08),
        focus_depth: native_graph_param_f32(params, "focusDepth", 0.0, 1.0, 0.5),
        aperture: native_graph_param_f32(params, "aperture", 0.0, 4.0, 0.0),
    }
}

/// The scene light turned into view space, where grains are shaded. Same
/// rotation order as pixel_particles_view_proj.
pub(crate) fn pixel_particles_light_view_dir(params: &NativePixelParticlesParams) -> [f32; 3] {
    let len = (params.light[0] * params.light[0]
        + params.light[1] * params.light[1]
        + params.light[2] * params.light[2])
        .sqrt();
    let len = if len > 0.0 { len } else { 1.0 };
    let (x, y, z) = (
        params.light[0] / len,
        params.light[1] / len,
        params.light[2] / len,
    );
    let (sy, cy) = params.camera_yaw.to_radians().sin_cos();
    let (sp, cp) = params.camera_pitch.to_radians().sin_cos();
    let x1 = cy * x - sy * z;
    let z1 = sy * x + cy * z;
    let y2 = cp * y - sp * z1;
    let z2 = sp * y + cp * z1;
    [x1, y2, z2]
}

/// Focus distance in view units for a 0..1 focus depth across the relief.
pub(crate) fn pixel_particles_focus_distance(params: &NativePixelParticlesParams) -> f32 {
    let depth = params.knobs[0];
    let nearest = (1.0 - params.depth_center) * depth;
    let farthest = -params.depth_center * depth;
    params.camera_z - (nearest + (farthest - nearest) * params.focus_depth)
}

pub(crate) fn build_pixel_particles_initial_bytes(count: u32) -> Vec<u8> {
    let mut bytes = vec![0_u8; count as usize * PIXEL_PARTICLES_PARTICLE_BYTES as usize];
    for index in 0..count as usize {
        // life < 0: depth-shift has not remembered this pixel's luma yet.
        write_f32_le(&mut bytes, index * 8 + 7, -1.0);
    }
    bytes
}

pub(crate) fn pixel_particles_view_proj(
    params: &NativePixelParticlesParams,
    width: u32,
    height: u32,
) -> [f32; 16] {
    let aspect = width.max(1) as f32 / height.max(1) as f32;
    let near = PIXEL_PARTICLES_NEAR;
    let far = PIXEL_PARTICLES_FAR;
    let f = 1.0 / (params.fov_deg.to_radians() * 0.5).tan();
    let mut proj = [0.0_f32; 16];
    proj[0] = f / aspect.max(0.0001);
    proj[5] = f;
    proj[10] = (far + near) / (near - far);
    proj[11] = -1.0;
    proj[14] = (2.0 * far * near) / (near - far);
    let yaw = params.camera_yaw.to_radians();
    let pitch = params.camera_pitch.to_radians();
    let (sy, cy) = yaw.sin_cos();
    let (sp, cp) = pitch.sin_cos();
    let rot_y = [
        cy, 0.0, sy, 0.0, 0.0, 1.0, 0.0, 0.0, -sy, 0.0, cy, 0.0, 0.0, 0.0, 0.0, 1.0,
    ];
    let rot_x = [
        1.0, 0.0, 0.0, 0.0, 0.0, cp, sp, 0.0, 0.0, -sp, cp, 0.0, 0.0, 0.0, 0.0, 1.0,
    ];
    let trans = native_translate(params.pan_x, params.pan_y, -params.camera_z);
    native_mat4_mul(proj, native_mat4_mul(trans, native_mat4_mul(rot_x, rot_y)))
}

pub(crate) fn build_pixel_particles_globals_bytes(
    params: &NativePixelParticlesParams,
    time: f32,
    dt: f32,
    width: u32,
    height: u32,
    source_frame_size: [f32; 2],
) -> Vec<u8> {
    let mut bytes = vec![0_u8; PIXEL_PARTICLES_GLOBALS_BYTES as usize];
    write_f32_le(&mut bytes, 0, time);
    write_f32_le(&mut bytes, 1, dt);
    write_u32_le(&mut bytes, 2, params.particle_count);
    write_u32_le(&mut bytes, 3, params.mode_id);
    for (index, value) in params.knobs.iter().enumerate() {
        write_f32_le(&mut bytes, 4 + index, *value);
    }
    write_f32_le(&mut bytes, 8, source_frame_size[0]);
    write_f32_le(&mut bytes, 9, source_frame_size[1]);
    write_f32_le(&mut bytes, 10, params.anchor_jitter);
    write_f32_le(&mut bytes, 11, if params.light_enabled { 1.0 } else { 0.0 });
    for index in 0..3 {
        write_f32_le(&mut bytes, 12 + index, params.light[index]);
    }
    write_f32_le(&mut bytes, 15, params.light_intensity);
    write_f32_le(&mut bytes, 16, params.light_ambient);
    write_f32_le(&mut bytes, 17, params.light_height_strength);
    write_f32_le(&mut bytes, 20, params.noise_amp_xy);
    write_f32_le(&mut bytes, 21, params.noise_amp_z);
    write_f32_le(&mut bytes, 22, params.noise_freq);
    write_f32_le(&mut bytes, 23, params.noise_speed);
    let aspect = width.max(1) as f32 / height.max(1) as f32;
    let view_y = (params.fov_deg.to_radians() * 0.5).tan() * params.camera_z;
    write_f32_le(&mut bytes, 24, if params.mirror_x { 1.0 } else { 0.0 });
    write_f32_le(&mut bytes, 25, aspect);
    write_f32_le(&mut bytes, 26, view_y * aspect);
    write_f32_le(&mut bytes, 27, view_y);
    write_f32_le(&mut bytes, 28, params.depth_source_id as f32);
    write_f32_le(&mut bytes, 29, params.depth_curve);
    write_f32_le(&mut bytes, 30, params.depth_contrast);
    write_f32_le(&mut bytes, 31, params.depth_smoothing);
    write_f32_le(&mut bytes, 32, params.depth_motion_id as f32);
    write_f32_le(&mut bytes, 33, params.depth_motion_amount);
    write_f32_le(&mut bytes, 34, params.depth_motion_speed);
    write_f32_le(&mut bytes, 35, params.depth_motion_scale);
    write_f32_le(&mut bytes, 36, params.depth_center);
    write_f32_le(&mut bytes, 37, params.depth_motion_coupling);
    write_f32_le(&mut bytes, 38, params.depth_motion_phase);
    write_f32_le(&mut bytes, 42, 1.0);
    write_f32_le(&mut bytes, 44, params.motion_reactive);
    write_f32_le(&mut bytes, 45, params.motion_decay);
    write_f32_le(&mut bytes, 48, if params.grain_lit { 1.0 } else { 0.0 });
    write_f32_le(&mut bytes, 49, params.shadow_strength);
    write_f32_le(&mut bytes, 50, params.shadow_reach);
    write_f32_le(&mut bytes, 51, params.shadow_softness);
    bytes
}

pub(crate) fn build_pixel_particles_render_bytes(
    params: &NativePixelParticlesParams,
    width: u32,
    height: u32,
) -> Vec<u8> {
    let mut bytes = vec![0_u8; PIXEL_PARTICLES_RENDER_UNIFORM_BYTES as usize];
    for (index, value) in pixel_particles_view_proj(params, width, height)
        .iter()
        .enumerate()
    {
        write_f32_le(&mut bytes, index, *value);
    }
    write_f32_le(&mut bytes, 16, width.max(1) as f32 / height.max(1) as f32);
    write_f32_le(&mut bytes, 17, params.base_size);
    write_f32_le(&mut bytes, 18, params.mode_id as f32);
    write_f32_le(&mut bytes, 19, params.opacity);
    write_f32_le(&mut bytes, 20, if params.mirror_x { 1.0 } else { 0.0 });
    write_f32_le(&mut bytes, 21, params.particle_count as f32);
    write_f32_le(&mut bytes, 22, params.anchor_jitter);
    write_f32_le(&mut bytes, 23, if params.motion_reactive > 0.0 { 2.5 } else { 0.0 });
    let light = pixel_particles_light_view_dir(params);
    write_f32_le(&mut bytes, 24, light[0]);
    write_f32_le(&mut bytes, 25, light[1]);
    write_f32_le(&mut bytes, 26, light[2]);
    write_f32_le(&mut bytes, 27, params.light_ambient);
    write_f32_le(&mut bytes, 28, params.light_intensity);
    write_f32_le(&mut bytes, 29, params.grain_specular);
    write_f32_le(&mut bytes, 30, params.grain_shininess);
    write_f32_le(&mut bytes, 32, pixel_particles_focus_distance(params));
    write_f32_le(&mut bytes, 33, params.aperture);
    write_f32_le(&mut bytes, 34, 0.03);
    write_f32_le(&mut bytes, 36, PIXEL_PARTICLES_NEAR);
    write_f32_le(&mut bytes, 37, PIXEL_PARTICLES_FAR);
    write_f32_le(
        &mut bytes,
        38,
        1.0 / (params.fov_deg.to_radians() * 0.5).tan(),
    );
    bytes
}

impl App {
    pub(crate) fn build_native_pixel_particles_graph_job(
        &mut self,
        graph_layer: &NativeGraphLayer,
    ) -> Result<(NativeGraphLayerState, NativeGraphFrameJob), String> {
        let params = normalize_pixel_particles_native_params(&graph_layer.params);
        if graph_layer.input_source_id.is_empty() {
            return Err("pixel particles requires a native input source".to_string());
        }
        let input_slot = self
            .source_frame_slots
            .get(&graph_layer.input_source_id)
            .copied()
            .ok_or_else(|| {
                if std::env::var("GHOST_DEBUG_LAYERS").is_ok() {
                    let mut keys: Vec<&str> =
                        self.source_frame_slots.keys().map(|k| k.as_str()).collect();
                    keys.sort_unstable();
                    eprintln!(
                        "[slot-debug] want `{}` have {:?}",
                        graph_layer.input_source_id, keys
                    );
                }
                format!(
                    "pixel particles input `{}` is not ready",
                    graph_layer.input_source_id
                )
            })?;
        let time = self.native_graph_time_seconds();
        let mut state = graph_layer.pixel_particles_state.clone();
        let mut reset = state.mode_id != params.mode_id
            || state.particle_count != params.particle_count
            || state.input_source_id != graph_layer.input_source_id;
        if reset {
            // The camera is not part of what a reset clears: switching mode or
            // count mid-shot must not snap the Auto Camera back to rest.
            let director = std::mem::take(&mut state.director);
            state = NativePixelParticlesGraphState::new(
                params.mode_id,
                params.particle_count,
                graph_layer.input_source_id.clone(),
                time,
            );
            state.director = director;
        }
        let mut dt = if self.render_clock_mode == "manual" {
            self.native_graph_step_delta_this_render
        } else if state.prev_frame_time <= 0.0 {
            1.0 / self.target_fps.max(1) as f32
        } else {
            time - state.prev_frame_time
        };
        dt = dt.clamp(0.0, 0.05);
        state.prev_frame_time = time;

        let compute_shader_id = "pixel-particles/compute";
        let render_shader_id = "pixel-particles/render";
        let (compute_hash, compute_source) =
            self.native_graph_shader_source(compute_shader_id, "cs_main")?;
        let (render_hash, render_source) =
            self.native_graph_shader_source(render_shader_id, "fs_main")?;
        self.native_graph_shader_source(render_shader_id, "vs_main")?;

        let source_id = graph_layer.source_id.clone();
        let prefix = format!(
            "pixel-particles:{}:{}:{}",
            native_graph_buffer_safe_id(&source_id),
            params.mode_id,
            params.particle_count
        );
        let id = |name: &str| format!("{prefix}:{name}");
        let globals_id = id("globals");
        let render_uniform_id = id("render-uniform");
        let particle_id = id("particles");
        let particle_buffer_missing = self
            .renderer
            .as_ref()
            .map(|renderer| {
                !renderer
                    .native_compute_graph_buffers
                    .contains_key(&particle_id)
            })
            .unwrap_or(true);
        reset |= particle_buffer_missing;
        // The input picture's stored size: square in the shared array, its
        // own size when it has a texture of its own.
        let source_frame_size = self
            .renderer
            .as_ref()
            .map(|renderer| {
                let input = renderer.slots.slot(input_slot);
                [input.width.max(1) as f32, input.height.max(1) as f32]
            })
            .unwrap_or_else(|| [self.pending_width.max(1) as f32, self.pending_height.max(1) as f32]);
        let director_params = normalize_particle_director_params(&graph_layer.params);
        let mut director_buffers = Vec::new();
        let mut director_passes = Vec::new();
        let mut readback_buffer_ids = Vec::new();
        let mut track = std::mem::take(&mut state.director);
        let camera = self.step_particle_director(
            &mut track,
            &director_params,
            &format!("pixel-particles:{}", native_graph_buffer_safe_id(&source_id)),
            &graph_layer.input_source_id,
            input_slot,
            time,
            &mut director_buffers,
            &mut director_passes,
            &mut readback_buffer_ids,
        )?;
        state.director = track;
        let mut view_params = params.clone();
        if director_params.enabled {
            apply_director_to_pixel_particles(
                &mut view_params,
                &params,
                &camera,
                self.pending_width,
                self.pending_height,
                director_params.depth_of_field,
            );
        }
        let mut buffers = vec![
            NativeComputeGraphBufferSpec {
                id: globals_id.clone(),
                byte_length: PIXEL_PARTICLES_GLOBALS_BYTES,
                kind: NativeComputeBufferBindingKind::Uniform,
                initial_bytes: build_pixel_particles_globals_bytes(
                    &params,
                    time,
                    dt,
                    self.pending_width,
                    self.pending_height,
                    source_frame_size,
                ),
                persistent: true,
                clear: false,
                indirect: false,
            },
            NativeComputeGraphBufferSpec {
                id: render_uniform_id.clone(),
                byte_length: PIXEL_PARTICLES_RENDER_UNIFORM_BYTES,
                kind: NativeComputeBufferBindingKind::Uniform,
                initial_bytes: build_pixel_particles_render_bytes(
                    &view_params,
                    self.pending_width,
                    self.pending_height,
                ),
                persistent: true,
                clear: false,
                indirect: false,
            },
            NativeComputeGraphBufferSpec {
                id: particle_id.clone(),
                byte_length: u64::from(params.particle_count)
                    .saturating_mul(PIXEL_PARTICLES_PARTICLE_BYTES),
                kind: NativeComputeBufferBindingKind::StorageReadWrite,
                initial_bytes: if reset {
                    build_pixel_particles_initial_bytes(params.particle_count)
                } else {
                    Vec::new()
                },
                persistent: true,
                clear: reset,
                indirect: false,
            },
        ];
        let empty_slot = self.ensure_empty_source_frame_slot();
        let source_texture = NativeComputeGraphBindingSpec {
            binding: 2,
            resource_id: graph_layer.input_source_id.clone(),
            kind: NativeComputeGraphBindingKind::SourceFrameTexture(
                NativeComputeGraphTextureDimension::D2,
            ),
            source_slot: Some(input_slot),
        };
        let compute_bindings = vec![
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
                resource_id: globals_id,
                kind: NativeComputeGraphBindingKind::Buffer(
                    NativeComputeBufferBindingKind::Uniform,
                ),
                source_slot: None,
            },
            source_texture.clone(),
            NativeComputeGraphBindingSpec {
                binding: 3,
                resource_id: "source-frame-sampler".to_string(),
                kind: NativeComputeGraphBindingKind::SourceFrameSampler,
                source_slot: None,
            },
            NativeComputeGraphBindingSpec {
                binding: 4,
                resource_id: EMPTY_SOURCE_FRAME_ID.to_string(),
                kind: NativeComputeGraphBindingKind::SourceFrameTexture(
                    NativeComputeGraphTextureDimension::D2,
                ),
                source_slot: Some(empty_slot),
            },
        ];
        let compute_layout = native_graph_binding_layout_signature(&compute_bindings);
        let mut pass_plans = vec![NativeComputeGraphPassPlan {
            name: "pixel-particles-compute".to_string(),
            cache_key: format!("graph:{compute_shader_id}:{compute_hash}:cs_main:{compute_layout}"),
            source: compute_source,
            entry: "cs_main".to_string(),
            dispatch: [params.particle_count.div_ceil(64).max(1), 1, 1],
            bindings: compute_bindings,
        }];
        buffers.extend(director_buffers);
        pass_plans.extend(director_passes);

        let output_slot = self.assign_source_frame_slot(&source_id)?;
        let seq = self.native_frame_index();
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
            source_texture,
            NativeComputeGraphBindingSpec {
                binding: 3,
                resource_id: "source-frame-sampler".to_string(),
                kind: NativeComputeGraphBindingKind::SourceFrameSampler,
                source_slot: None,
            },
        ];
        let render_layout = native_graph_binding_layout_signature(&render_bindings);
        let target = NativeComputeGraphRenderTarget::SourceFrame {
            source_id: source_id.clone(),
            slot: output_slot,
            seq,
        };
        // Soft: one blended pass, no depth (the original look). Lit: opaque
        // sphere grains with depth; with an aperture, sharp grains first and
        // blurred grains blended over them, depth-tested against what the
        // sharp pass kept. buildPixelParticlesRenderPasses mirrors this.
        let make_plan = |name: &str,
                         shader_id: &str,
                         hash: u64,
                         source: &Arc<str>,
                         vertex_entry: &str,
                         fragment_entry: &str,
                         blend: NativeComputeGraphRenderBlend,
                         clear: bool,
                         depth: (bool, bool, bool)| {
            let (depth_enabled, depth_write, depth_load) = depth;
            NativeComputeGraphRenderPlan {
                name: name.to_string(),
                cache_key: format!(
                    "graph-render:{shader_id}:{hash}:{vertex_entry}:{fragment_entry}:{}:{}:{}:{}:{}:{render_layout}",
                    blend.signature(),
                    NativeComputeGraphPrimitiveTopology::TriangleList.signature(),
                    if depth_enabled { "depth" } else { "nodepth" },
                    if depth_write { "write" } else { "read" },
                    NativeComputeGraphDepthCompare::Less.signature(),
                ),
                source: source.clone(),
                vertex_entry: vertex_entry.to_string(),
                fragment_entry: fragment_entry.to_string(),
                clear,
                include_snapshot: false,
                generate_mips: false,
                target: target.clone(),
                blend,
                vertex_count: 6,
                instance_count: params.particle_count,
                indirect_buffer_id: None,
                indirect_offset: 0,
                clear_color: [0.0, 0.0, 0.0, 0.0],
                primitive_topology: NativeComputeGraphPrimitiveTopology::TriangleList,
                depth_enabled,
                depth_write,
                depth_compare: NativeComputeGraphDepthCompare::Less,
                depth_load,
                depth_texture_id: None,
                depth_only: false,
                bindings: render_bindings.clone(),
            }
        };
        let render_plans = if !view_params.grain_lit {
            vec![make_plan(
                "pixel-particles-render",
                render_shader_id,
                render_hash,
                &render_source,
                "vs_main",
                "fs_main",
                NativeComputeGraphRenderBlend::Alpha,
                true,
                (false, false, false),
            )]
        } else {
            let lit_shader_id = "pixel-particles/render-lit";
            let (lit_hash, lit_source) = self.native_graph_shader_source(lit_shader_id, "fs_lit")?;
            if view_params.aperture <= 0.0 {
                self.native_graph_shader_source(lit_shader_id, "vs_lit")?;
                vec![make_plan(
                    "pixel-particles-render-lit",
                    lit_shader_id,
                    lit_hash,
                    &lit_source,
                    "vs_lit",
                    "fs_lit",
                    NativeComputeGraphRenderBlend::Replace,
                    true,
                    (true, true, false),
                )]
            } else {
                self.native_graph_shader_source(lit_shader_id, "vs_sharp")?;
                self.native_graph_shader_source(lit_shader_id, "vs_blur")?;
                self.native_graph_shader_source(lit_shader_id, "fs_bokeh")?;
                vec![
                    make_plan(
                        "pixel-particles-render-sharp",
                        lit_shader_id,
                        lit_hash,
                        &lit_source,
                        "vs_sharp",
                        "fs_lit",
                        NativeComputeGraphRenderBlend::Replace,
                        true,
                        (true, true, false),
                    ),
                    make_plan(
                        "pixel-particles-render-blur",
                        lit_shader_id,
                        lit_hash,
                        &lit_source,
                        "vs_blur",
                        "fs_bokeh",
                        NativeComputeGraphRenderBlend::Alpha,
                        false,
                        (true, false, true),
                    ),
                ]
            }
        };
        self.source_frames
            .insert(source_id.clone(), SourceFrame::full(seq));
        for layer in self.scene_layers.values_mut() {
            if layer.source_id.as_deref() == Some(source_id.as_str()) {
                layer.frame_slot = Some(output_slot);
            }
        }
        Ok((
            NativeGraphLayerState::PixelParticles(state),
            NativeGraphFrameJob {
                textures: Vec::new(),
                buffers,
                pass_plans,
                render_plans,
                readback_buffer_ids,
            },
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Grain, focus and motion fields land where RENDER_LIT_WGSL and the
    /// compute Globals read them, matching webgpuPixelParticles.ts.
    #[test]
    fn pixel_particles_grain_focus_and_motion_uniform_slots() {
        let read_f32 = |bytes: &[u8], word: usize| {
            f32::from_le_bytes(bytes[word * 4..word * 4 + 4].try_into().unwrap())
        };
        let defaults = normalize_pixel_particles_native_params(&serde_json::json!({}));
        assert!(!defaults.grain_lit, "soft glow stays the default look");
        let globals = build_pixel_particles_globals_bytes(&defaults, 1.0, 0.016, 160, 90, [1024.0, 1024.0]);
        assert_eq!(globals.len() as u64, PIXEL_PARTICLES_GLOBALS_BYTES);
        assert_eq!(read_f32(&globals, 44), 0.0);
        assert_eq!(read_f32(&globals, 48), 0.0);
        assert_eq!(
            build_pixel_particles_render_bytes(&defaults, 160, 90).len() as u64,
            PIXEL_PARTICLES_RENDER_UNIFORM_BYTES
        );

        let lit = normalize_pixel_particles_native_params(&serde_json::json!({
            "grainShading": "lit",
            "shadowStrength": 0.5,
            "aperture": 0.8,
            "focusDepth": 0.0,
            "cameraZ": 2.0,
            "depthAmount": 0.6,
            "depthCenter": 0.5,
            "motionReactive": 1.0,
            "lightX": 0.0, "lightY": 0.0, "lightZ": 1.0
        }));
        let globals = build_pixel_particles_globals_bytes(&lit, 1.0, 0.016, 160, 90, [1024.0, 1024.0]);
        assert_eq!(read_f32(&globals, 44), 1.0);
        assert_eq!(read_f32(&globals, 48), 1.0);
        assert!((read_f32(&globals, 49) - 0.5).abs() < 1e-6);
        let render = build_pixel_particles_render_bytes(&lit, 160, 90);
        assert!((read_f32(&render, 26) - 1.0).abs() < 1e-5, "unrotated light faces the camera");
        // Relief spans z in [-0.3, 0.3]; focus depth 0 is its nearest point.
        assert!((read_f32(&render, 32) - 1.7).abs() < 1e-5);
        assert!((read_f32(&render, 33) - 0.8).abs() < 1e-6);
        assert_eq!(read_f32(&render, 36), PIXEL_PARTICLES_NEAR);
        assert_eq!(read_f32(&render, 37), PIXEL_PARTICLES_FAR);

        let turned = normalize_pixel_particles_native_params(&serde_json::json!({
            "lightX": 0.0, "lightY": 0.0, "lightZ": 1.0, "cameraYaw": 90.0
        }));
        let dir = pixel_particles_light_view_dir(&turned);
        assert!((dir[0].abs() - 1.0).abs() < 1e-5 && dir[2].abs() < 1e-5);

        let init = build_pixel_particles_initial_bytes(1024);
        for particle in (0..1024).step_by(101) {
            assert_eq!(read_f32(&init, particle * 8 + 7), -1.0);
        }
    }
}
