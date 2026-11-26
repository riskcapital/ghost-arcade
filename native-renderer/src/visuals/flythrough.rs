//! The flythrough visual.

use crate::*;

#[derive(Clone, Debug)]
pub(crate) struct NativeFlythroughGraphState {
    pub(crate) particle_count: u32,
    pub(crate) input_source_id: String,
    pub(crate) prev_frame_time: f32,
    pub(crate) fly_distance: f32,
    pub(crate) director: ParticleDirectorTrack,
    /// Frames that included the curl bake with every pipeline already compiled.
    /// See build_native_flythrough_graph_job for why this is counted rather
    /// than inferred from the field's buffer existing.
    pub(crate) curl_bake_ready_frames: u32,
}

impl NativeFlythroughGraphState {
    pub(crate) fn new(particle_count: u32, input_source_id: String, time: f32) -> Self {
        Self {
            particle_count,
            input_source_id,
            prev_frame_time: time,
            fly_distance: 0.0,
            director: ParticleDirectorTrack::default(),
            curl_bake_ready_frames: 0,
        }
    }
}

pub(crate) const FLYTHROUGH_PARTICLE_BYTES: u64 = 48;

pub(crate) const FLYTHROUGH_MAX_PARTICLES: u32 = 1_000_000;

/// Baked curl field: FLYTHROUGH_CURL_GRID_N^3 vec4 cells covering one period of
/// FLYTHROUGH_CURL_PERIOD lattice units. Must match webgpuFlythrough.ts.
pub(crate) const FLYTHROUGH_CURL_GRID_N: u32 = 80;

pub(crate) const FLYTHROUGH_CURL_PERIOD: u32 = 24;

#[derive(Clone, Debug)]
pub(crate) struct NativeFlythroughParams {
    pub(crate) topology_id: u32,
    pub(crate) depth_source_id: u32,
    pub(crate) fly_speed: f32,
    pub(crate) tunnel_depth: f32,
    pub(crate) slab_count: u32,
    pub(crate) flow_strength: f32,
    pub(crate) flow_scale: f32,
    pub(crate) anchor_pull: f32,
    pub(crate) stroke_length: f32,
    pub(crate) stroke_width: f32,
    pub(crate) depth_strength: f32,
    pub(crate) base_size: f32,
    pub(crate) opacity: f32,
    pub(crate) fov_deg: f32,
    pub(crate) camera_yaw: f32,
    pub(crate) camera_pitch: f32,
    pub(crate) particle_count: u32,
    pub(crate) audio_reactive: bool,
    pub(crate) mirror_x: bool,
    pub(crate) wander_radius: f32,
    pub(crate) motion_reactive: f32,
    pub(crate) motion_decay: f32,
    /// Sphere grains with depth for points. Strokes always render soft.
    pub(crate) grain_lit: bool,
    pub(crate) light: [f32; 3],
    pub(crate) light_intensity: f32,
    pub(crate) light_ambient: f32,
    pub(crate) grain_specular: f32,
    pub(crate) grain_shininess: f32,
    pub(crate) focus_distance: f32,
    pub(crate) aperture: f32,
}

pub(crate) const FLYTHROUGH_NEAR: f32 = 0.05;

pub(crate) const FLYTHROUGH_FAR: f32 = 100.0;

pub(crate) fn normalize_flythrough_native_params(params: &Value) -> NativeFlythroughParams {
    NativeFlythroughParams {
        topology_id: if native_particle_field_enum(params, "topology", "strokes") == "points" {
            0
        } else {
            1
        },
        depth_source_id: match native_particle_field_enum(params, "depthSource", "luminance")
            .as_str()
        {
            "inverse-luminance" => 1,
            "edge-density" => 2,
            _ => 0,
        },
        fly_speed: native_graph_param_f32(params, "flySpeed", -16.0, 16.0, 0.8),
        tunnel_depth: native_graph_param_f32(params, "tunnelDepth", 0.05, 64.0, 2.0),
        slab_count: native_graph_param_u32(params, "slabCount", 1, 8, 4),
        flow_strength: native_graph_param_f32(params, "flowStrength", 0.0, 16.0, 0.4),
        flow_scale: native_graph_param_f32(params, "flowScale", 0.001, 64.0, 2.0),
        anchor_pull: native_graph_param_f32(params, "anchorPull", 0.0, 16.0, 1.2),
        stroke_length: native_graph_param_f32(params, "strokeLength", 0.0, 8.0, 0.08),
        stroke_width: native_graph_param_f32(params, "strokeWidth", 0.0001, 4.0, 0.006),
        depth_strength: native_graph_param_f32(params, "depthStrength", -8.0, 8.0, 0.5),
        base_size: native_graph_param_f32(params, "baseSize", 0.0001, 2.0, 0.005),
        opacity: native_graph_param_f32(params, "opacity", 0.0, 4.0, 1.0),
        fov_deg: native_graph_param_f32(params, "fovDeg", 1.0, 160.0, 50.0),
        camera_yaw: native_graph_param_f32(params, "cameraYaw", -3600.0, 3600.0, 0.0),
        camera_pitch: native_graph_param_f32(params, "cameraPitch", -3600.0, 3600.0, 0.0),
        particle_count: native_graph_param_u32(
            params,
            "particleCount",
            1_024,
            FLYTHROUGH_MAX_PARTICLES,
            250_000,
        ),
        audio_reactive: params
            .get("audioReactive")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        mirror_x: params
            .get("mirrorX")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        // Limit Wander + Wander Radius in the panel; 0 means unbounded.
        wander_radius: if params
            .get("limitWander")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            native_graph_param_f32(params, "wanderRadius", 0.0, 8.0, 0.2)
        } else {
            0.0
        },
        motion_reactive: native_graph_param_f32(params, "motionReactive", 0.0, 8.0, 0.0),
        motion_decay: native_graph_param_f32(params, "motionDecay", 0.0, 60.0, 3.0),
        grain_lit: native_particle_field_enum(params, "grainShading", "soft") == "lit",
        light: [
            native_graph_param_f32(params, "lightX", -16.0, 16.0, 0.5),
            native_graph_param_f32(params, "lightY", -16.0, 16.0, 0.7),
            native_graph_param_f32(params, "lightZ", -16.0, 16.0, -0.5),
        ],
        light_intensity: native_graph_param_f32(params, "lightIntensity", 0.0, 16.0, 1.2),
        light_ambient: native_graph_param_f32(params, "lightAmbient", 0.0, 4.0, 0.25),
        grain_specular: native_graph_param_f32(params, "grainSpecular", 0.0, 4.0, 0.35),
        grain_shininess: native_graph_param_f32(params, "grainShininess", 1.0, 256.0, 24.0),
        focus_distance: native_graph_param_f32(params, "focusDistance", 0.05, 64.0, 1.5),
        aperture: native_graph_param_f32(params, "aperture", 0.0, 4.0, 0.0),
    }
}

/// The world light in a billboard's own frame (x along camRight, y along camUp,
/// z toward the camera), which is where fs_lit builds its sphere normal.
pub(crate) fn flythrough_light_sprite_dir(params: &NativeFlythroughParams, rot: &[f32; 16]) -> [f32; 3] {
    let len = (params.light[0] * params.light[0]
        + params.light[1] * params.light[1]
        + params.light[2] * params.light[2])
        .sqrt();
    let len = if len > 0.0 { len } else { 1.0 };
    let l = [params.light[0] / len, params.light[1] / len, params.light[2] / len];
    let right = [rot[0], rot[1], rot[2]];
    let up = [rot[4], rot[5], rot[6]];
    // The camera looks down +Z, so toward-camera is -(right x up).
    let to_cam = [
        -(right[1] * up[2] - right[2] * up[1]),
        -(right[2] * up[0] - right[0] * up[2]),
        -(right[0] * up[1] - right[1] * up[0]),
    ];
    let dot = |a: [f32; 3]| l[0] * a[0] + l[1] * a[1] + l[2] * a[2];
    [dot(right), dot(up), dot(to_cam)]
}

pub(crate) fn reverse_bits_32(mut bits: u32) -> u32 {
    bits = ((bits >> 1) & 0x5555_5555) | ((bits & 0x5555_5555) << 1);
    bits = ((bits >> 2) & 0x3333_3333) | ((bits & 0x3333_3333) << 2);
    bits = ((bits >> 4) & 0x0f0f_0f0f) | ((bits & 0x0f0f_0f0f) << 4);
    bits = ((bits >> 8) & 0x00ff_00ff) | ((bits & 0x00ff_00ff) << 8);
    bits.rotate_left(16)
}

pub(crate) fn build_flythrough_initial_bytes(count: u32) -> Vec<u8> {
    let mut bytes = vec![0_u8; count as usize * FLYTHROUGH_PARTICLE_BYTES as usize];
    for i in 0..count {
        let u1 = (i as f32 + 0.5) / count.max(1) as f32;
        let u2 = reverse_bits_32(i) as f32 / 4_294_967_296.0;
        let ax = u1 * 2.0 - 1.0;
        let ay = u2 * 2.0 - 1.0;
        let base = i as usize * 12;
        write_f32_le(&mut bytes, base, ax);
        write_f32_le(&mut bytes, base + 1, ay);
        write_f32_le(&mut bytes, base + 3, 1.0);
        write_f32_le(
            &mut bytes,
            base + 7,
            (ax * 7.3 + ay * 11.1).sin() * 0.5 + 0.5,
        );
        write_f32_le(&mut bytes, base + 8, ax);
        write_f32_le(&mut bytes, base + 9, ay);
        // signal.x < 0: the particle has not read its pixel yet, so the first
        // frame does not register the whole image as a change.
        write_f32_le(&mut bytes, base + 10, -1.0);
    }
    bytes
}

pub(crate) fn build_flythrough_compute_bytes(
    params: &NativeFlythroughParams,
    state: &NativeFlythroughGraphState,
    dt: f32,
    time: f32,
    treble: f32,
) -> Vec<u8> {
    let mut bytes = vec![0_u8; 64];
    let flow_scale = if params.audio_reactive {
        1.0 + treble * 1.5
    } else {
        1.0
    };
    write_f32_le(&mut bytes, 0, dt);
    write_f32_le(&mut bytes, 1, time);
    write_f32_le(&mut bytes, 2, params.flow_strength * flow_scale);
    write_f32_le(&mut bytes, 3, params.flow_scale);
    write_f32_le(&mut bytes, 4, params.anchor_pull);
    write_f32_le(&mut bytes, 5, params.tunnel_depth);
    write_f32_le(&mut bytes, 6, params.depth_strength);
    write_u32_le(&mut bytes, 7, params.particle_count);
    write_u32_le(&mut bytes, 8, params.depth_source_id);
    write_f32_le(&mut bytes, 9, state.fly_distance);
    write_u32_le(&mut bytes, 10, u32::from(params.mirror_x));
    write_f32_le(&mut bytes, 11, params.wander_radius);
    write_f32_le(&mut bytes, 12, params.motion_reactive);
    write_f32_le(&mut bytes, 13, params.motion_decay);
    write_u32_le(&mut bytes, 14, FLYTHROUGH_CURL_GRID_N);
    write_f32_le(&mut bytes, 15, FLYTHROUGH_CURL_PERIOD as f32);
    bytes
}

pub(crate) fn flythrough_view_proj(
    params: &NativeFlythroughParams,
    width: u32,
    height: u32,
) -> ([f32; 16], [f32; 16]) {
    let aspect = width.max(1) as f32 / height.max(1) as f32;
    let near = FLYTHROUGH_NEAR;
    let far = FLYTHROUGH_FAR;
    let f = 1.0 / (params.fov_deg.to_radians() * 0.5).tan();
    let mut proj = [0.0_f32; 16];
    proj[0] = f / aspect.max(0.0001);
    proj[5] = f;
    proj[10] = far / (far - near);
    proj[11] = 1.0;
    proj[14] = -(near * far) / (far - near);
    let (sy, cy) = params.camera_yaw.to_radians().sin_cos();
    let (sp, cp) = params.camera_pitch.to_radians().sin_cos();
    let ry = [
        cy, 0.0, sy, 0.0, 0.0, 1.0, 0.0, 0.0, -sy, 0.0, cy, 0.0, 0.0, 0.0, 0.0, 1.0,
    ];
    let rx = [
        1.0, 0.0, 0.0, 0.0, 0.0, cp, -sp, 0.0, 0.0, sp, cp, 0.0, 0.0, 0.0, 0.0, 1.0,
    ];
    let rot = native_mat4_mul(ry, rx);
    let view = native_mat4_mul(rot, native_translate(0.0, 0.0, -0.1));
    (native_mat4_mul(proj, view), rot)
}

pub(crate) fn build_flythrough_render_bytes(
    params: &NativeFlythroughParams,
    state: &NativeFlythroughGraphState,
    width: u32,
    height: u32,
) -> Vec<u8> {
    let mut bytes = vec![0_u8; 256];
    let (view_proj, rot) = flythrough_view_proj(params, width, height);
    for (index, value) in view_proj.iter().enumerate() {
        write_f32_le(&mut bytes, index, *value);
    }
    for index in 0..3 {
        write_f32_le(&mut bytes, 16 + index, rot[index]);
    }
    for index in 0..3 {
        write_f32_le(&mut bytes, 20 + index, rot[4 + index]);
    }
    write_f32_le(&mut bytes, 24, params.base_size);
    write_f32_le(&mut bytes, 25, params.stroke_length);
    write_f32_le(&mut bytes, 26, params.stroke_width);
    write_u32_le(&mut bytes, 27, params.topology_id);
    write_u32_le(&mut bytes, 28, params.slab_count);
    write_f32_le(&mut bytes, 29, params.tunnel_depth);
    write_f32_le(&mut bytes, 30, state.fly_distance);
    write_u32_le(&mut bytes, 31, params.particle_count);
    write_f32_le(&mut bytes, 32, params.opacity);
    write_f32_le(&mut bytes, 33, 1.0);
    write_f32_le(&mut bytes, 34, 1.0);
    write_u32_le(&mut bytes, 35, u32::from(params.mirror_x));
    write_f32_le(&mut bytes, 36, params.motion_reactive);
    let light = flythrough_light_sprite_dir(params, &rot);
    write_f32_le(&mut bytes, 40, light[0]);
    write_f32_le(&mut bytes, 41, light[1]);
    write_f32_le(&mut bytes, 42, light[2]);
    write_f32_le(&mut bytes, 43, params.light_ambient);
    write_f32_le(&mut bytes, 44, params.light_intensity);
    write_f32_le(&mut bytes, 45, params.grain_specular);
    write_f32_le(&mut bytes, 46, params.grain_shininess);
    write_f32_le(&mut bytes, 48, params.focus_distance);
    write_f32_le(
        &mut bytes,
        49,
        if params.topology_id == 0 { params.aperture } else { 0.0 },
    );
    write_f32_le(&mut bytes, 50, 0.03);
    write_f32_le(&mut bytes, 52, FLYTHROUGH_NEAR);
    write_f32_le(&mut bytes, 53, FLYTHROUGH_FAR);
    write_f32_le(&mut bytes, 54, 1.0 / (params.fov_deg.to_radians() * 0.5).tan());
    bytes
}

impl App {
    pub(crate) fn build_native_flythrough_graph_job(
        &mut self,
        graph_layer: &NativeGraphLayer,
    ) -> Result<(NativeGraphLayerState, NativeGraphFrameJob), String> {
        let params = normalize_flythrough_native_params(&graph_layer.params);
        if graph_layer.input_source_id.is_empty() {
            return Err("flythrough requires a native input source".to_string());
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
                    "flythrough input `{}` is not ready",
                    graph_layer.input_source_id
                )
            })?;
        let time = self.native_graph_time_seconds();
        let mut state = graph_layer.flythrough_state.clone();
        let mut reset = state.particle_count != params.particle_count
            || state.input_source_id != graph_layer.input_source_id;
        if reset {
            // Keep the Auto Camera through a Count or input change.
            let director = std::mem::take(&mut state.director);
            state = NativeFlythroughGraphState::new(
                params.particle_count,
                graph_layer.input_source_id.clone(),
                time,
            );
            state.director = director;
        }
        let director_params = normalize_particle_director_params(&graph_layer.params);
        let mut director_buffers = Vec::new();
        let mut director_passes = Vec::new();
        let mut readback_buffer_ids = Vec::new();
        let mut track = std::mem::take(&mut state.director);
        let camera = self.step_particle_director(
            &mut track,
            &director_params,
            &format!("flythrough:{}", native_graph_buffer_safe_id(&graph_layer.source_id)),
            &graph_layer.input_source_id,
            input_slot,
            time,
            &mut director_buffers,
            &mut director_passes,
            &mut readback_buffer_ids,
        )?;
        state.director = track;
        let mut view_params = params.clone();
        // Flight slows as the shot tightens, so a detail shot looks at its
        // subject instead of rushing past it.
        let mut director_speed = 1.0;
        if director_params.enabled {
            apply_director_to_flythrough(
                &mut view_params,
                &params,
                &camera,
                director_params.depth_of_field,
            );
            director_speed = (1.4 / camera.zoom()).clamp(0.25, 1.0);
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
        let bass = self.audio0[1].clamp(0.0, 4.0);
        let treble = self.audio0[3].clamp(0.0, 4.0);
        state.fly_distance += params.fly_speed
            * director_speed
            * if params.audio_reactive {
                1.0 + bass * 1.8
            } else {
                1.0
            }
            * dt;

        let curl_bake_shader_id = "flythrough/curl-bake";
        let compute_shader_id = "flythrough/compute";
        let render_shader_id = "flythrough/render";
        let (compute_hash, compute_source) =
            self.native_graph_shader_source(compute_shader_id, "cs_main")?;
        let (render_hash, render_source) =
            self.native_graph_shader_source(render_shader_id, "fs_main")?;
        self.native_graph_shader_source(render_shader_id, "vs_main")?;
        let source_id = graph_layer.source_id.clone();
        let prefix = format!(
            "flythrough:{}:{}",
            native_graph_buffer_safe_id(&source_id),
            params.particle_count
        );
        let id = |name: &str| format!("{prefix}:{name}");
        let compute_uniform_id = id("compute-uniform");
        let render_uniform_id = id("render-uniform");
        let particle_id = id("particles");
        // Keyed on the layer's source, not the particle count, so changing
        // Count keeps the field it already baked instead of allocating a
        // second 8 MB copy under the new prefix.
        let curl_field_id = format!(
            "flythrough:{}:curl-field",
            native_graph_buffer_safe_id(&source_id)
        );
        let curl_bake_uniform_id = id("curl-bake-uniform");
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
        // The curl field is baked in the frame its buffer is created and only
        // read after that. Keyed on the buffer, not on `reset`, so a particle
        // reset (count change, new input) reuses the field it already has.
        let curl_field_missing = self
            .renderer
            .as_ref()
            .map(|renderer| {
                !renderer
                    .native_compute_graph_buffers
                    .contains_key(&curl_field_id)
            })
            .unwrap_or(true);
        // Bake until a frame that includes the bake has every pipeline it needs
        // already compiled, twice. Keying the bake on "the buffer is missing"
        // was the first version, and it never worked in the app: per-frame
        // jobs compile pipelines asynchronously, so the first frames of a new
        // layer fail with "pipeline is warming" AFTER their persistent buffers
        // were upserted. The field's buffer then existed, zeroed, the bake was
        // never scheduled again, and the flow was silently zero forever. The
        // RPC graph path compiles synchronously, which is why an A/B through
        // it looked fine. Two ready frames rather than one covers a frame that
        // fails for some other reason after its pipelines were warm.
        if curl_field_missing {
            state.curl_bake_ready_frames = 0;
        }
        let include_curl_bake = state.curl_bake_ready_frames < 2;
        let mut curl_bake_cache_key: Option<String> = None;
        let mut buffers = vec![
            NativeComputeGraphBufferSpec {
                id: compute_uniform_id.clone(),
                byte_length: 64,
                kind: NativeComputeBufferBindingKind::Uniform,
                initial_bytes: build_flythrough_compute_bytes(&params, &state, dt, time, treble),
                persistent: true,
                clear: false,
                indirect: false,
            },
            NativeComputeGraphBufferSpec {
                id: render_uniform_id.clone(),
                byte_length: 256,
                kind: NativeComputeBufferBindingKind::Uniform,
                initial_bytes: build_flythrough_render_bytes(
                    &view_params,
                    &state,
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
                    .saturating_mul(FLYTHROUGH_PARTICLE_BYTES),
                kind: NativeComputeBufferBindingKind::StorageReadWrite,
                initial_bytes: if reset {
                    build_flythrough_initial_bytes(params.particle_count)
                } else {
                    Vec::new()
                },
                persistent: true,
                clear: reset,
                indirect: false,
            },
            NativeComputeGraphBufferSpec {
                id: curl_field_id.clone(),
                byte_length: u64::from(FLYTHROUGH_CURL_GRID_N).pow(3) * 16,
                kind: NativeComputeBufferBindingKind::StorageReadWrite,
                initial_bytes: Vec::new(),
                persistent: true,
                clear: curl_field_missing,
                indirect: false,
            },
        ];
        if include_curl_bake {
            let mut bake_uniform = vec![0_u8; 16];
            write_u32_le(&mut bake_uniform, 0, FLYTHROUGH_CURL_GRID_N);
            write_u32_le(&mut bake_uniform, 1, FLYTHROUGH_CURL_PERIOD);
            buffers.push(NativeComputeGraphBufferSpec {
                id: curl_bake_uniform_id.clone(),
                byte_length: 16,
                kind: NativeComputeBufferBindingKind::Uniform,
                initial_bytes: bake_uniform,
                persistent: false,
                clear: false,
                indirect: false,
            });
        }
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
                resource_id: compute_uniform_id,
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
                resource_id: curl_field_id.clone(),
                kind: NativeComputeGraphBindingKind::Buffer(
                    NativeComputeBufferBindingKind::StorageRead,
                ),
                source_slot: None,
            },
        ];
        let compute_layout = native_graph_binding_layout_signature(&compute_bindings);
        let compute_cache_key =
            format!("graph:{compute_shader_id}:{compute_hash}:cs_main:{compute_layout}");
        let mut pass_plans = Vec::with_capacity(2);
        if include_curl_bake {
            let (bake_hash, bake_source) =
                self.native_graph_shader_source(curl_bake_shader_id, "cs_bake")?;
            let bake_bindings = vec![
                NativeComputeGraphBindingSpec {
                    binding: 0,
                    resource_id: curl_field_id.clone(),
                    kind: NativeComputeGraphBindingKind::Buffer(
                        NativeComputeBufferBindingKind::StorageReadWrite,
                    ),
                    source_slot: None,
                },
                NativeComputeGraphBindingSpec {
                    binding: 1,
                    resource_id: curl_bake_uniform_id,
                    kind: NativeComputeGraphBindingKind::Buffer(
                        NativeComputeBufferBindingKind::Uniform,
                    ),
                    source_slot: None,
                },
            ];
            let bake_layout = native_graph_binding_layout_signature(&bake_bindings);
            let groups = FLYTHROUGH_CURL_GRID_N.div_ceil(4);
            let bake_cache_key =
                format!("graph:{curl_bake_shader_id}:{bake_hash}:cs_bake:{bake_layout}");
            curl_bake_cache_key = Some(bake_cache_key.clone());
            pass_plans.push(NativeComputeGraphPassPlan {
                name: "flythrough-curl-bake".to_string(),
                cache_key: bake_cache_key,
                source: bake_source,
                entry: "cs_bake".to_string(),
                dispatch: [groups, groups, groups],
                bindings: bake_bindings,
            });
        }
        pass_plans.push(NativeComputeGraphPassPlan {
            name: "flythrough-compute".to_string(),
            cache_key: compute_cache_key.clone(),
            source: compute_source,
            entry: "cs_main".to_string(),
            dispatch: [params.particle_count.div_ceil(64).max(1), 1, 1],
            bindings: compute_bindings,
        });
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
        let instance_count = params.slab_count.saturating_mul(params.particle_count);
        // Soft (and all strokes): one blended pass. Lit points: opaque grains
        // with depth; with an aperture, sharp then blurred grains over them
        // against the kept depth. buildFlythroughRenderPasses mirrors this.
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
                instance_count,
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
        let render_plans = if !view_params.grain_lit || view_params.topology_id != 0 {
            vec![make_plan(
                "flythrough-render",
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
            let lit_shader_id = "flythrough/render-lit";
            let (lit_hash, lit_source) = self.native_graph_shader_source(lit_shader_id, "fs_lit")?;
            if view_params.aperture <= 0.0 {
                self.native_graph_shader_source(lit_shader_id, "vs_lit")?;
                vec![make_plan(
                    "flythrough-render-lit",
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
                        "flythrough-render-sharp",
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
                        "flythrough-render-blur",
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
        // A bake only counts once everything this frame runs is compiled, so a
        // frame that is about to fail with "pipeline is warming" does not.
        if let Some(bake_key) = curl_bake_cache_key.as_deref() {
            let ready = self
                .renderer
                .as_ref()
                .map(|renderer| {
                    renderer.native_compute_pipelines.contains_key(bake_key)
                        && renderer
                            .native_compute_pipelines
                            .contains_key(&compute_cache_key)
                        && render_plans.iter().all(|plan| {
                            renderer
                                .native_graph_render_pipelines
                                .contains_key(&plan.cache_key)
                        })
                })
                .unwrap_or(false);
            if ready {
                state.curl_bake_ready_frames = state.curl_bake_ready_frames.saturating_add(1);
            }
        }
        Ok((
            NativeGraphLayerState::Flythrough(state),
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

    /// The selfie flip has to survive the whole hop from the panel's `mirrorX`
    /// toggle into both flythrough uniform buffers. The shader reads it as a
    /// u32 at a fixed word, so a wrong offset silently mirrors nothing --
    /// exactly the failure this pins.
    #[test]
    fn flythrough_mirror_reaches_both_uniform_buffers() {
        let read_u32 = |bytes: &[u8], word: usize| {
            u32::from_le_bytes(bytes[word * 4..word * 4 + 4].try_into().unwrap())
        };
        let state = NativeFlythroughGraphState::new(1024, "src".to_string(), 0.0);

        let off = normalize_flythrough_native_params(&serde_json::json!({}));
        assert!(!off.mirror_x, "mirror defaults to off");
        assert_eq!(read_u32(&build_flythrough_compute_bytes(&off, &state, 0.016, 1.0, 0.0), 10), 0);
        assert_eq!(read_u32(&build_flythrough_render_bytes(&off, &state, 160, 90), 35), 0);

        let on = normalize_flythrough_native_params(&serde_json::json!({ "mirrorX": true }));
        assert!(on.mirror_x);
        assert_eq!(read_u32(&build_flythrough_compute_bytes(&on, &state, 0.016, 1.0, 0.0), 10), 1);
        assert_eq!(read_u32(&build_flythrough_render_bytes(&on, &state, 160, 90), 35), 1);
    }

    /// Wander, motion and the curl grid land in the slots the WGSL `U` struct
    /// declares, matching webgpuFlythrough.ts word for word.
    #[test]
    fn flythrough_wander_motion_and_curl_grid_uniform_slots() {
        let read_f32 = |bytes: &[u8], word: usize| {
            f32::from_le_bytes(bytes[word * 4..word * 4 + 4].try_into().unwrap())
        };
        let read_u32 = |bytes: &[u8], word: usize| {
            u32::from_le_bytes(bytes[word * 4..word * 4 + 4].try_into().unwrap())
        };
        let state = NativeFlythroughGraphState::new(1024, "src".to_string(), 0.0);

        let defaults = normalize_flythrough_native_params(&serde_json::json!({}));
        let bytes = build_flythrough_compute_bytes(&defaults, &state, 0.016, 1.0, 0.0);
        assert_eq!(read_f32(&bytes, 11), 0.0, "wander is unbounded by default");
        assert_eq!(read_f32(&bytes, 12), 0.0, "motion reactivity is off by default");
        assert_eq!(read_f32(&bytes, 13), 3.0);
        assert_eq!(read_u32(&bytes, 14), FLYTHROUGH_CURL_GRID_N);
        assert_eq!(read_f32(&bytes, 15), FLYTHROUGH_CURL_PERIOD as f32);

        // A radius alone is inert; Limit Wander arms it.
        let radius_only =
            normalize_flythrough_native_params(&serde_json::json!({ "wanderRadius": 0.4 }));
        assert_eq!(radius_only.wander_radius, 0.0);

        let on = normalize_flythrough_native_params(&serde_json::json!({
            "limitWander": true,
            "wanderRadius": 0.4,
            "motionReactive": 1.25,
            "motionDecay": 6.0
        }));
        let bytes = build_flythrough_compute_bytes(&on, &state, 0.016, 1.0, 0.0);
        assert!((read_f32(&bytes, 11) - 0.4).abs() < 1e-6);
        assert!((read_f32(&bytes, 12) - 1.25).abs() < 1e-6);
        assert!((read_f32(&bytes, 13) - 6.0).abs() < 1e-6);
        let render = build_flythrough_render_bytes(&on, &state, 160, 90);
        assert!((read_f32(&render, 36) - 1.25).abs() < 1e-6);

        // Every particle starts without a remembered luma, so the first frame
        // is not read as the whole image changing at once.
        let init = build_flythrough_initial_bytes(1024);
        for particle in (0..1024).step_by(97) {
            assert_eq!(read_f32(&init, particle * 12 + 10), -1.0);
        }
    }
}
