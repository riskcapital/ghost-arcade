//! The particle field visual.

use crate::*;

#[derive(Clone, Debug)]
pub(crate) struct NativeParticleFieldGraphState {
    pub(crate) mode_id: u32,
    pub(crate) particle_count: u32,
    pub(crate) prev_frame_time: f32,
    pub(crate) burst_impulse: f32,
    pub(crate) prev_bass: f32,
    pub(crate) hue_shift_phase: f32,
    pub(crate) color_cycle_phase: f32,
    pub(crate) auto_rot_x_phase: f32,
    pub(crate) auto_rot_y_phase: f32,
    pub(crate) auto_rot_z_phase: f32,
}

impl NativeParticleFieldGraphState {
    pub(crate) fn new(mode_id: u32, particle_count: u32, time: f32) -> Self {
        Self {
            mode_id,
            particle_count,
            prev_frame_time: time,
            burst_impulse: 0.0,
            prev_bass: 0.0,
            hue_shift_phase: 0.0,
            color_cycle_phase: 0.0,
            auto_rot_x_phase: 0.0,
            auto_rot_y_phase: 0.0,
            auto_rot_z_phase: 0.0,
        }
    }
}

pub(crate) const PARTICLE_FIELD_PARTICLE_BYTES: u64 = 64;

pub(crate) const PARTICLE_FIELD_EDGE_BYTES: u64 = 16;

pub(crate) const PARTICLE_FIELD_MAX_EDGES: u32 = 600_000;

#[derive(Clone, Debug)]
pub(crate) struct NativeParticleFieldParams {
    pub(crate) mode_id: u32,
    pub(crate) mode_label: String,
    pub(crate) particle_count: u32,
    pub(crate) base_size: f32,
    pub(crate) opacity: f32,
    pub(crate) wind_strength: f32,
    pub(crate) wind_scale: f32,
    pub(crate) anchor_pull: f32,
    pub(crate) damping: f32,
    pub(crate) bass: f32,
    pub(crate) treble: f32,
    pub(crate) shimmer_strength: f32,
    pub(crate) burst_gain: f32,
    pub(crate) burst_decay: f32,
    pub(crate) galaxy_arms: u32,
    pub(crate) galaxy_rotate_inner: f32,
    pub(crate) galaxy_rotate_outer: f32,
    pub(crate) galaxy_tilt: f32,
    pub(crate) atomic_nuclei: u32,
    pub(crate) atomic_shells: u32,
    pub(crate) atomic_shell_spacing: f32,
    pub(crate) atomic_orbit_speed: f32,
    pub(crate) swarm_cohesion: f32,
    pub(crate) swarm_separation: f32,
    pub(crate) swarm_alignment: f32,
    pub(crate) swarm_range: f32,
    pub(crate) lattice_size: u32,
    pub(crate) lattice_spacing: f32,
    pub(crate) lattice_vibration: f32,
    pub(crate) media_depth_amount: f32,
    pub(crate) media_sample_scale: f32,
    pub(crate) gravity_wells: u32,
    pub(crate) gravity_strength: f32,
    pub(crate) gravity_orbit: f32,
    pub(crate) gravity_core_size: f32,
    pub(crate) gravity_vortex: f32,
    pub(crate) gravity_max_velocity: f32,
    pub(crate) gravity_audio_drive: f32,
    pub(crate) gravity_chaos: f32,
    pub(crate) topology_id: u32,
    pub(crate) stroke_length: f32,
    pub(crate) stroke_width: f32,
    pub(crate) color_mode_id: u32,
    pub(crate) color_map_id: u32,
    pub(crate) color_mix: f32,
    pub(crate) color_map_scale: f32,
    pub(crate) color_map_offset: f32,
    pub(crate) color_cycle_speed: f32,
    pub(crate) random_sat: f32,
    pub(crate) random_val: f32,
    pub(crate) hue_shift_speed: f32,
    pub(crate) saturation: f32,
    pub(crate) brightness: f32,
    pub(crate) color_a: [f32; 3],
    pub(crate) color_b: [f32; 3],
    pub(crate) color_c: [f32; 3],
    pub(crate) color_d: [f32; 3],
    pub(crate) connect_enabled: bool,
    pub(crate) partner_count: u32,
    pub(crate) local_radius: f32,
    pub(crate) bridge_radius: f32,
    pub(crate) color_local: [f32; 3],
    pub(crate) color_bridge: [f32; 3],
    pub(crate) alpha_local: f32,
    pub(crate) alpha_bridge: f32,
    pub(crate) fog_density: f32,
    pub(crate) fog_opacity: f32,
    pub(crate) fog_color: [f32; 3],
    pub(crate) light: [f32; 3],
    pub(crate) light_strength: f32,
    pub(crate) material_ambient: f32,
    pub(crate) material_diffuse: f32,
    pub(crate) material_specular: f32,
    pub(crate) material_shininess: f32,
    pub(crate) material_reflection: f32,
    pub(crate) fov_deg: f32,
    pub(crate) camera_z: f32,
    pub(crate) rotate: [f32; 3],
    pub(crate) auto_rotate: [f32; 3],
}

pub(crate) fn native_particle_field_enum(params: &Value, key: &str, fallback: &str) -> String {
    params
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or(fallback)
        .trim()
        .to_ascii_lowercase()
}

pub(crate) fn normalize_particle_field_native_params(params: &Value) -> NativeParticleFieldParams {
    let mode_label = native_particle_field_enum(params, "mode", "galaxy");
    let mode_id = match mode_label.as_str() {
        "atomic" => 1,
        "swarm" => 2,
        "lattice" => 3,
        "field" => 4,
        "media" => 5,
        "gravity" => 6,
        _ => 0,
    };
    let topology_id = match native_particle_field_enum(params, "topology", "glow").as_str() {
        "points" => 0,
        "streaks" => 2,
        "sphere" => 3,
        "softsphere" | "soft-sphere" => 4,
        _ => 1,
    };
    let color_mode_id = match native_particle_field_enum(params, "colorMode", "palette4").as_str() {
        "solid" => 0,
        "gradient2" => 1,
        "gradient3" => 2,
        "rainbow" => 4,
        "random" => 5,
        "group" => 6,
        _ => 3,
    };
    let color_map_id = match native_particle_field_enum(params, "colorMap", "radial").as_str() {
        "index" => 0,
        "group" => 1,
        "y-axis" => 3,
        "speed" => 4,
        "depth-z" => 5,
        "noise" => 6,
        _ => 2,
    };
    NativeParticleFieldParams {
        mode_id,
        mode_label,
        particle_count: native_graph_param_u32(params, "particleCount", 1_024, 500_000, 80_000),
        base_size: native_graph_param_f32(params, "baseSize", 0.0001, 0.2, 0.006),
        opacity: native_graph_param_f32(params, "opacity", 0.0, 4.0, 1.0),
        wind_strength: native_graph_param_f32(params, "windStrength", -8.0, 8.0, 0.2),
        wind_scale: native_graph_param_f32(params, "windScale", 0.001, 64.0, 2.0),
        anchor_pull: native_graph_param_f32(params, "anchorPull", -8.0, 8.0, 0.0),
        damping: native_graph_param_f32(params, "damping", 0.0, 16.0, 1.0),
        bass: native_graph_param_f32(params, "bass", 0.0, 4.0, 0.0),
        treble: native_graph_param_f32(params, "treble", 0.0, 4.0, 0.0),
        shimmer_strength: native_graph_param_f32(params, "shimmerStrength", 0.0, 4.0, 0.02),
        burst_gain: native_graph_param_f32(params, "burstGain", 0.0, 16.0, 0.6),
        burst_decay: native_graph_param_f32(params, "burstDecay", 0.0, 24.0, 2.5),
        galaxy_arms: native_graph_param_u32(params, "galaxyArms", 1, 16, 4),
        galaxy_rotate_inner: native_graph_param_f32(params, "galaxyRotateInner", -16.0, 16.0, 1.2),
        galaxy_rotate_outer: native_graph_param_f32(params, "galaxyRotateOuter", -16.0, 16.0, 0.3),
        galaxy_tilt: native_graph_param_f32(params, "galaxyTilt", -4.0, 4.0, 0.1),
        atomic_nuclei: native_graph_param_u32(params, "atomicNuclei", 1, 32, 5),
        atomic_shells: native_graph_param_u32(params, "atomicShells", 1, 16, 3),
        atomic_shell_spacing: native_graph_param_f32(
            params,
            "atomicShellSpacing",
            0.001,
            4.0,
            0.18,
        ),
        atomic_orbit_speed: native_graph_param_f32(params, "atomicOrbitSpeed", -16.0, 16.0, 0.8),
        swarm_cohesion: native_graph_param_f32(params, "swarmCohesion", -8.0, 8.0, 0.6),
        swarm_separation: native_graph_param_f32(params, "swarmSeparation", -8.0, 8.0, 0.05),
        swarm_alignment: native_graph_param_f32(params, "swarmAlignment", -8.0, 8.0, 0.8),
        swarm_range: native_graph_param_f32(params, "swarmRange", 0.001, 32.0, 1.5),
        lattice_size: native_graph_param_u32(params, "latticeSize", 2, 128, 16),
        lattice_spacing: native_graph_param_f32(params, "latticeSpacing", 0.001, 8.0, 1.6),
        lattice_vibration: native_graph_param_f32(params, "latticeVibration", 0.0, 4.0, 0.015),
        media_depth_amount: native_graph_param_f32(params, "mediaDepthAmount", -8.0, 8.0, 0.6),
        media_sample_scale: native_graph_param_f32(params, "mediaSampleScale", 0.001, 16.0, 1.0),
        gravity_wells: native_graph_param_u32(params, "gravityWells", 1, 8, 4),
        gravity_strength: native_graph_param_f32(params, "gravityStrength", -8.0, 8.0, 0.18),
        gravity_orbit: native_graph_param_f32(params, "gravityOrbit", -16.0, 16.0, 0.45),
        gravity_core_size: native_graph_param_f32(params, "gravityCoreSize", 0.001, 4.0, 0.09),
        gravity_vortex: native_graph_param_f32(params, "gravityVortex", -16.0, 16.0, 0.34),
        gravity_max_velocity: native_graph_param_f32(
            params,
            "gravityMaxVelocity",
            0.001,
            64.0,
            5.0,
        ),
        gravity_audio_drive: native_graph_param_f32(params, "gravityAudioDrive", 0.0, 16.0, 1.15),
        gravity_chaos: native_graph_param_f32(params, "gravityChaos", 0.0, 16.0, 0.18),
        topology_id,
        stroke_length: native_graph_param_f32(params, "strokeLength", 0.0, 4.0, 0.04),
        stroke_width: native_graph_param_f32(params, "strokeWidth", 0.0, 2.0, 0.004),
        color_mode_id,
        color_map_id,
        color_mix: native_graph_param_f32(params, "colorMix", 0.0, 1.0, 1.0),
        color_map_scale: native_graph_param_f32(params, "colorMapScale", -16.0, 16.0, 1.0),
        color_map_offset: native_graph_param_f32(params, "colorMapOffset", -16.0, 16.0, 0.0),
        color_cycle_speed: native_graph_param_f32(params, "colorCycleSpeed", -16.0, 16.0, 0.05),
        random_sat: native_graph_param_f32(params, "randomSat", 0.0, 2.0, 0.85),
        random_val: native_graph_param_f32(params, "randomVal", 0.0, 4.0, 1.0),
        hue_shift_speed: native_graph_param_f32(params, "hueShiftSpeed", -16.0, 16.0, 0.02),
        saturation: native_graph_param_f32(params, "saturation", 0.0, 4.0, 1.1),
        brightness: native_graph_param_f32(params, "brightness", 0.0, 8.0, 1.1),
        color_a: native_graph_param_rgb(params, "colorA", [0.18, 0.42, 1.0]),
        color_b: native_graph_param_rgb(params, "colorB", [0.95, 0.28, 0.65]),
        color_c: native_graph_param_rgb(params, "colorC", [1.0, 0.78, 0.2]),
        color_d: native_graph_param_rgb(params, "colorD", [0.2, 0.95, 0.85]),
        connect_enabled: native_graph_param_bool(params, "connectEnabled", true),
        partner_count: native_graph_param_u32(params, "partnerCount", 1, 32, 12),
        local_radius: native_graph_param_f32(params, "localRadius", 0.0, 8.0, 0.12),
        bridge_radius: native_graph_param_f32(params, "bridgeRadius", 0.0, 8.0, 0.4),
        color_local: native_graph_param_rgb(params, "colorLocal", [0.4, 1.0, 1.0]),
        color_bridge: native_graph_param_rgb(params, "colorBridge", [0.95, 0.3, 0.8]),
        alpha_local: native_graph_param_f32(params, "alphaLocal", 0.0, 1.0, 0.35),
        alpha_bridge: native_graph_param_f32(params, "alphaBridge", 0.0, 1.0, 0.12),
        fog_density: native_graph_param_f32(params, "fogDensity", 0.0, 16.0, 0.6),
        fog_opacity: native_graph_param_f32(params, "fogOpacity", 0.0, 1.0, 0.85),
        fog_color: native_graph_param_rgb(params, "fogColor", [0.02, 0.02, 0.06]),
        light: [
            native_graph_param_f32(params, "lightX", -8.0, 8.0, 0.4),
            native_graph_param_f32(params, "lightY", -8.0, 8.0, 0.6),
            native_graph_param_f32(params, "lightZ", -8.0, 8.0, 0.7),
        ],
        light_strength: native_graph_param_f32(params, "lightStrength", 0.0, 8.0, 0.6),
        material_ambient: native_graph_param_f32(params, "materialAmbient", 0.0, 4.0, 0.34),
        material_diffuse: native_graph_param_f32(params, "materialDiffuse", 0.0, 4.0, 0.92),
        material_specular: native_graph_param_f32(params, "materialSpecular", 0.0, 4.0, 0.58),
        material_shininess: native_graph_param_f32(params, "materialShininess", 1.0, 256.0, 56.0),
        material_reflection: native_graph_param_f32(params, "materialReflection", 0.0, 4.0, 0.18),
        fov_deg: native_graph_param_f32(params, "fovDeg", 1.0, 160.0, 50.0),
        camera_z: native_graph_param_f32(params, "cameraZ", 0.05, 100.0, 2.4),
        rotate: [
            native_graph_param_f32(params, "rotateX", -3600.0, 3600.0, 0.0),
            native_graph_param_f32(params, "rotateY", -3600.0, 3600.0, 0.0),
            native_graph_param_f32(params, "rotateZ", -3600.0, 3600.0, 0.0),
        ],
        auto_rotate: [
            native_graph_param_f32(params, "autoRotateX", -3600.0, 3600.0, 0.0),
            native_graph_param_f32(params, "autoRotateY", -3600.0, 3600.0, 6.0),
            native_graph_param_f32(params, "autoRotateZ", -3600.0, 3600.0, 0.0),
        ],
    }
}

pub(crate) fn particle_field_rand(seed: u32) -> f32 {
    let mut x = seed;
    x ^= x.wrapping_shl(13);
    x ^= x.wrapping_shr(17);
    x ^= x.wrapping_shl(5);
    (x as f64 / 4_294_967_296.0) as f32
}

pub(crate) fn build_particle_field_initial_bytes(params: &NativeParticleFieldParams) -> Vec<u8> {
    let count = params.particle_count.max(1_024);
    let mut bytes = vec![0_u8; count as usize * PARTICLE_FIELD_PARTICLE_BYTES as usize];
    for i in 0..count {
        let base = i as usize * 16;
        let r0 = particle_field_rand(i.wrapping_mul(747_796_405).wrapping_add(2_891_336_453));
        let r1 = particle_field_rand(i.wrapping_mul(2_891_336_453).wrapping_add(747_796_405));
        let r2 = particle_field_rand(i.wrapping_mul(1_597_334_677).wrapping_add(3_812_015_801));
        let r3 = particle_field_rand(i.wrapping_mul(3_812_015_801).wrapping_add(1_597_334_677));
        let (x, y, z, group, radius_var) = match params.mode_id {
            0 => {
                let group = i % params.galaxy_arms.max(1);
                let arm_phase = group as f32 / params.galaxy_arms.max(1) as f32;
                let radius = r0.sqrt() * 0.95;
                let theta = arm_phase * std::f32::consts::TAU + radius * 3.0 + (r1 - 0.5) * 0.4;
                (
                    theta.cos() * radius,
                    (r2 - 0.5) * 0.04 * (1.0 - radius),
                    theta.sin() * radius,
                    group,
                    0.72 + r3.powf(1.8) * 1.35,
                )
            }
            1 => {
                let nuclei = params.atomic_nuclei.max(1);
                let shells = params.atomic_shells.max(1);
                let nucleus = i % nuclei;
                let shell = (i / nuclei) % shells;
                let nucleus_t = nucleus as f32 / nuclei as f32 * std::f32::consts::TAU;
                let radius = (shell + 1) as f32 * params.atomic_shell_spacing;
                let phase = r0 * std::f32::consts::TAU;
                (
                    nucleus_t.cos() * 0.5 + phase.cos() * radius,
                    (r1 - 0.5) * radius * 0.5,
                    nucleus_t.sin() * 0.5 + phase.sin() * radius * 0.6,
                    nucleus + shell * nuclei,
                    0.72 + r3.powf(1.8) * 1.35,
                )
            }
            3 => {
                let size = params.lattice_size.max(2);
                let ix = i % size;
                let iy = (i / size) % size;
                let iz = (i / (size * size)) % size;
                (
                    ((ix as f32 / size as f32) - 0.5) * params.lattice_spacing,
                    ((iy as f32 / size as f32) - 0.5) * params.lattice_spacing,
                    ((iz as f32 / size as f32) - 0.5) * params.lattice_spacing,
                    i,
                    0.72 + r3.powf(1.8) * 1.35,
                )
            }
            6 => {
                let wells = params.gravity_wells.clamp(1, 8);
                let group = i % wells;
                let phase = group as f32 / wells as f32 * std::f32::consts::TAU;
                let shell = r0.powf(0.55) * 0.9 + 0.08;
                let theta = r1 * std::f32::consts::TAU;
                let phi = (r2 * 2.0 - 1.0).acos();
                let radius_var = if i % 233 == 0 {
                    4.2 + r3 * 2.4
                } else {
                    0.36 + r3.powf(2.35) * 2.8
                };
                (
                    phase.cos() * 0.45 + phi.sin() * theta.cos() * shell,
                    (r3 - 0.5) * 0.75 + phi.cos() * shell * 0.35,
                    phase.sin() * 0.45 + phi.sin() * theta.sin() * shell,
                    group,
                    radius_var,
                )
            }
            _ => {
                let theta = r0 * std::f32::consts::TAU;
                let phi = (r1 * 2.0 - 1.0).acos();
                let radius = r2.cbrt();
                (
                    phi.sin() * theta.cos() * radius,
                    phi.cos() * radius,
                    phi.sin() * theta.sin() * radius,
                    i & 15,
                    0.72 + r3.powf(1.8) * 1.35,
                )
            }
        };
        write_f32_le(&mut bytes, base, x);
        write_f32_le(&mut bytes, base + 1, y);
        write_f32_le(&mut bytes, base + 2, z);
        write_f32_le(&mut bytes, base + 3, 1.0);
        write_f32_le(&mut bytes, base + 7, params.base_size);
        write_f32_le(&mut bytes, base + 8, 0.6);
        write_f32_le(&mut bytes, base + 9, 0.7);
        write_f32_le(&mut bytes, base + 10, 0.95);
        write_f32_le(&mut bytes, base + 11, radius_var);
        write_u32_le(&mut bytes, base + 12, group);
    }
    bytes
}

pub(crate) fn build_particle_field_behavior_uniform_bytes(
    params: &NativeParticleFieldParams,
    state: &NativeParticleFieldGraphState,
    dt: f32,
    time: f32,
    bass: f32,
    treble: f32,
) -> Vec<u8> {
    let mut bytes = vec![0_u8; 384];
    write_f32_le(&mut bytes, 0, dt);
    write_f32_le(&mut bytes, 1, time);
    write_u32_le(&mut bytes, 2, params.particle_count);
    write_f32_le(&mut bytes, 3, params.base_size);
    write_u32_le(&mut bytes, 4, params.mode_id);
    write_u32_le(&mut bytes, 5, params.topology_id);
    write_u32_le(&mut bytes, 6, u32::from(params.connect_enabled));
    write_f32_le(&mut bytes, 8, params.wind_strength);
    write_f32_le(&mut bytes, 9, params.wind_scale);
    write_f32_le(&mut bytes, 10, params.anchor_pull);
    write_f32_le(&mut bytes, 11, params.damping);
    write_f32_le(&mut bytes, 12, bass);
    write_f32_le(&mut bytes, 13, treble);
    write_f32_le(&mut bytes, 14, state.burst_impulse);
    write_f32_le(&mut bytes, 15, params.shimmer_strength);
    write_f32_le(&mut bytes, 16, params.galaxy_arms as f32);
    write_f32_le(&mut bytes, 17, params.galaxy_rotate_inner);
    write_f32_le(&mut bytes, 18, params.galaxy_rotate_outer);
    write_f32_le(&mut bytes, 19, params.galaxy_tilt);
    write_f32_le(&mut bytes, 20, params.atomic_nuclei as f32);
    write_f32_le(&mut bytes, 21, params.atomic_shells as f32);
    write_f32_le(&mut bytes, 22, params.atomic_shell_spacing);
    write_f32_le(&mut bytes, 23, params.atomic_orbit_speed);
    write_f32_le(&mut bytes, 24, params.swarm_cohesion);
    write_f32_le(&mut bytes, 25, params.swarm_separation);
    write_f32_le(&mut bytes, 26, params.swarm_alignment);
    write_f32_le(&mut bytes, 27, params.swarm_range);
    write_f32_le(&mut bytes, 28, params.lattice_size as f32);
    write_f32_le(&mut bytes, 29, params.lattice_spacing);
    write_f32_le(&mut bytes, 30, params.lattice_vibration);
    write_f32_le(&mut bytes, 32, params.media_depth_amount);
    write_f32_le(&mut bytes, 33, params.media_sample_scale);
    write_f32_le(&mut bytes, 36, params.fog_density);
    write_f32_le(&mut bytes, 37, params.light[0]);
    write_f32_le(&mut bytes, 38, params.light[1]);
    write_f32_le(&mut bytes, 39, params.light[2]);
    write_f32_le(&mut bytes, 40, params.saturation);
    write_f32_le(&mut bytes, 41, params.brightness);
    write_u32_le(&mut bytes, 42, params.color_mode_id);
    write_u32_le(&mut bytes, 43, params.color_map_id);
    write_f32_le(&mut bytes, 44, params.color_mix);
    write_f32_le(&mut bytes, 45, params.color_map_scale);
    write_f32_le(&mut bytes, 46, params.color_map_offset);
    write_f32_le(&mut bytes, 47, state.color_cycle_phase);
    write_f32_le(&mut bytes, 48, params.random_sat);
    write_f32_le(&mut bytes, 49, params.random_val);
    write_f32_le(&mut bytes, 50, state.hue_shift_phase);
    for (offset, color) in [
        (52, params.color_a),
        (56, params.color_b),
        (60, params.color_c),
        (64, params.color_d),
    ] {
        write_f32_le(&mut bytes, offset, color[0]);
        write_f32_le(&mut bytes, offset + 1, color[1]);
        write_f32_le(&mut bytes, offset + 2, color[2]);
    }
    write_f32_le(&mut bytes, 68, params.gravity_wells as f32);
    write_f32_le(&mut bytes, 69, params.gravity_strength);
    write_f32_le(&mut bytes, 70, params.gravity_orbit);
    write_f32_le(&mut bytes, 71, params.gravity_core_size);
    write_f32_le(&mut bytes, 72, params.gravity_vortex);
    write_f32_le(&mut bytes, 73, params.gravity_max_velocity);
    write_f32_le(&mut bytes, 74, params.gravity_audio_drive);
    write_f32_le(&mut bytes, 75, params.gravity_chaos);
    bytes
}

pub(crate) fn particle_field_view_proj(
    params: &NativeParticleFieldParams,
    state: &NativeParticleFieldGraphState,
    width: u32,
    height: u32,
) -> [f32; 16] {
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
    native_mat4_mul(proj, native_mat4_mul(view, model))
}

pub(crate) fn build_particle_field_render_uniform_bytes(
    params: &NativeParticleFieldParams,
    state: &NativeParticleFieldGraphState,
    width: u32,
    height: u32,
) -> Vec<u8> {
    let mut bytes = vec![0_u8; 192];
    for (index, value) in particle_field_view_proj(params, state, width, height)
        .iter()
        .enumerate()
    {
        write_f32_le(&mut bytes, index, *value);
    }
    write_f32_le(&mut bytes, 16, 1.0);
    write_f32_le(&mut bytes, 21, 1.0);
    write_f32_le(&mut bytes, 26, params.camera_z);
    write_u32_le(&mut bytes, 27, params.topology_id);
    write_f32_le(&mut bytes, 28, params.stroke_length);
    write_f32_le(&mut bytes, 29, params.stroke_width);
    write_f32_le(&mut bytes, 30, params.opacity);
    for index in 0..3 {
        write_f32_le(&mut bytes, 32 + index, params.fog_color[index]);
    }
    write_f32_le(&mut bytes, 35, params.fog_density);
    let len = (params.light[0] * params.light[0]
        + params.light[1] * params.light[1]
        + params.light[2] * params.light[2])
        .sqrt()
        .max(0.0001);
    for index in 0..3 {
        write_f32_le(&mut bytes, 36 + index, params.light[index] / len);
    }
    write_f32_le(&mut bytes, 39, params.light_strength);
    write_f32_le(&mut bytes, 40, params.material_ambient);
    write_f32_le(&mut bytes, 41, params.material_diffuse);
    write_f32_le(&mut bytes, 42, params.material_specular);
    write_f32_le(&mut bytes, 43, params.material_shininess);
    write_f32_le(&mut bytes, 44, params.material_reflection);
    bytes
}

pub(crate) fn build_particle_field_fog_uniform_bytes(params: &NativeParticleFieldParams) -> Vec<u8> {
    let mut bytes = vec![0_u8; 16];
    for index in 0..3 {
        write_f32_le(&mut bytes, index, params.fog_color[index]);
    }
    write_f32_le(&mut bytes, 3, params.fog_opacity);
    bytes
}

pub(crate) fn build_particle_field_line_uniform_bytes(
    params: &NativeParticleFieldParams,
    state: &NativeParticleFieldGraphState,
    width: u32,
    height: u32,
) -> Vec<u8> {
    let mut bytes = vec![0_u8; 160];
    for (index, value) in particle_field_view_proj(params, state, width, height)
        .iter()
        .enumerate()
    {
        write_f32_le(&mut bytes, index, *value);
    }
    write_f32_le(&mut bytes, 18, params.camera_z);
    for index in 0..3 {
        write_f32_le(&mut bytes, 20 + index, params.color_local[index]);
    }
    write_f32_le(&mut bytes, 23, params.alpha_local);
    for index in 0..3 {
        write_f32_le(&mut bytes, 24 + index, params.color_bridge[index]);
    }
    write_f32_le(&mut bytes, 27, params.alpha_bridge);
    for index in 0..3 {
        write_f32_le(&mut bytes, 28 + index, params.fog_color[index]);
    }
    write_f32_le(&mut bytes, 31, params.fog_density);
    bytes
}

impl App {
    pub(crate) fn build_native_particle_field_graph_job(
        &mut self,
        graph_layer: &NativeGraphLayer,
    ) -> Result<(NativeGraphLayerState, NativeGraphFrameJob), String> {
        let params = normalize_particle_field_native_params(&graph_layer.params);
        self.record_native_graph_workload(
            &graph_layer.layer_id,
            "particle-field",
            serde_json::json!({
                "particleCount": params.particle_count,
                "partnerCount": params.partner_count,
                "connectEnabled": params.connect_enabled,
                "modeId": params.mode_id,
            }),
        );
        let time = self.native_graph_time_seconds();
        let mut state = graph_layer.particle_field_state.clone();
        let mut reset_particles =
            state.mode_id != params.mode_id || state.particle_count != params.particle_count;
        if reset_particles {
            state = NativeParticleFieldGraphState::new(params.mode_id, params.particle_count, time);
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

        let bass = params.bass.max(self.audio0[1]).clamp(0.0, 4.0);
        let treble = params.treble.max(self.audio0[3]).clamp(0.0, 4.0);
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
        state.auto_rot_x_phase += params.auto_rotate[0] * dt;
        state.auto_rot_y_phase += params.auto_rotate[1] * dt;
        state.auto_rot_z_phase += params.auto_rotate[2] * dt;

        let behavior_shader_id = "particle-field/behavior";
        let edge_shader_id = "particle-field/edges";
        let fog_shader_id = "particle-field/fog";
        let render_shader_id = "particle-field/render";
        let line_shader_id = "particle-field/lines";
        let (behavior_hash, behavior_source) =
            self.native_graph_shader_source(behavior_shader_id, "cs_main")?;
        let (render_hash, render_source) =
            self.native_graph_shader_source(render_shader_id, "fs_main")?;
        self.native_graph_shader_source(render_shader_id, "vs_main")?;
        let (fog_hash, fog_source) = self.native_graph_shader_source(fog_shader_id, "fs_main")?;
        self.native_graph_shader_source(fog_shader_id, "vs_main")?;
        let (edge_hash, edge_source) = if params.connect_enabled {
            let value = self.native_graph_shader_source(edge_shader_id, "cs_edges")?;
            (Some(value.0), Some(value.1))
        } else {
            (None, None)
        };
        let (line_hash, line_source) = if params.connect_enabled {
            let value = self.native_graph_shader_source(line_shader_id, "fs_main")?;
            self.native_graph_shader_source(line_shader_id, "vs_main")?;
            (Some(value.0), Some(value.1))
        } else {
            (None, None)
        };

        let source_id = graph_layer.source_id.clone();
        let prefix = format!(
            "particle-field:{}:{}:{}",
            native_graph_buffer_safe_id(&source_id),
            params.mode_label,
            params.particle_count
        );
        let id = |name: &str| format!("{prefix}:{name}");
        let behavior_uniform_id = id("behavior-uniform");
        let render_uniform_id = id("render-uniform");
        let fog_uniform_id = id("fog-uniform");
        let particle_id = id("particles");
        let edge_uniform_id = id("edge-uniform");
        let line_uniform_id = id("line-uniform");
        let indirect_id = id("indirect");
        let edges_id = id("edges");
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
            state = NativeParticleFieldGraphState::new(params.mode_id, params.particle_count, time);
            dt = 1.0 / self.target_fps.max(1) as f32;
        }

        let mut buffers = vec![
            NativeComputeGraphBufferSpec {
                id: behavior_uniform_id.clone(),
                byte_length: 384,
                kind: NativeComputeBufferBindingKind::Uniform,
                initial_bytes: build_particle_field_behavior_uniform_bytes(
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
                initial_bytes: build_particle_field_render_uniform_bytes(
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
                id: fog_uniform_id.clone(),
                byte_length: 16,
                kind: NativeComputeBufferBindingKind::Uniform,
                initial_bytes: build_particle_field_fog_uniform_bytes(&params),
                persistent: true,
                clear: false,
                indirect: false,
            },
            NativeComputeGraphBufferSpec {
                id: particle_id.clone(),
                byte_length: u64::from(params.particle_count)
                    .saturating_mul(PARTICLE_FIELD_PARTICLE_BYTES),
                kind: NativeComputeBufferBindingKind::StorageReadWrite,
                initial_bytes: if reset_particles {
                    build_particle_field_initial_bytes(&params)
                } else {
                    Vec::new()
                },
                persistent: true,
                clear: reset_particles,
                indirect: false,
            },
        ];
        if params.connect_enabled {
            let mut indirect_bytes = vec![0_u8; 16];
            write_u32_le(&mut indirect_bytes, 0, 2);
            buffers.extend([
                NativeComputeGraphBufferSpec {
                    id: edge_uniform_id.clone(),
                    byte_length: 64,
                    kind: NativeComputeBufferBindingKind::Uniform,
                    initial_bytes: {
                        let mut bytes = vec![0_u8; 64];
                        write_u32_le(&mut bytes, 0, params.particle_count);
                        write_u32_le(&mut bytes, 1, params.partner_count);
                        write_u32_le(&mut bytes, 2, PARTICLE_FIELD_MAX_EDGES);
                        write_f32_le(&mut bytes, 4, params.local_radius);
                        write_f32_le(&mut bytes, 5, params.bridge_radius);
                        bytes
                    },
                    persistent: true,
                    clear: false,
                    indirect: false,
                },
                NativeComputeGraphBufferSpec {
                    id: line_uniform_id.clone(),
                    byte_length: 160,
                    kind: NativeComputeBufferBindingKind::Uniform,
                    initial_bytes: build_particle_field_line_uniform_bytes(
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
                    id: indirect_id.clone(),
                    byte_length: 16,
                    kind: NativeComputeBufferBindingKind::StorageReadWrite,
                    initial_bytes: indirect_bytes,
                    persistent: true,
                    clear: false,
                    indirect: true,
                },
                NativeComputeGraphBufferSpec {
                    id: edges_id.clone(),
                    byte_length: u64::from(PARTICLE_FIELD_MAX_EDGES)
                        .saturating_mul(PARTICLE_FIELD_EDGE_BYTES),
                    kind: NativeComputeBufferBindingKind::StorageReadWrite,
                    initial_bytes: Vec::new(),
                    persistent: true,
                    clear: reset_particles,
                    indirect: false,
                },
            ]);
        }

        let empty_source_slot = self.ensure_empty_source_frame_slot();
        // Media mode positions and colours every particle from the input
        // picture. Binding 2 was pinned to the empty frame, so it sampled
        // solid black and media mode collapsed to a flat plate no matter
        // what the operator picked. Bind the layer's real input when the
        // renderer has one resident, and fall back to empty otherwise so
        // the graph still builds while a source is still arriving.
        let (media_resource_id, media_source_slot) = self
            .source_frame_slots
            .get(&graph_layer.input_source_id)
            .copied()
            .map(|slot| (graph_layer.input_source_id.clone(), slot))
            .unwrap_or_else(|| (EMPTY_SOURCE_FRAME_ID.to_string(), empty_source_slot));
        let behavior_bindings = vec![
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
                resource_id: behavior_uniform_id,
                kind: NativeComputeGraphBindingKind::Buffer(
                    NativeComputeBufferBindingKind::Uniform,
                ),
                source_slot: None,
            },
            NativeComputeGraphBindingSpec {
                binding: 2,
                resource_id: media_resource_id,
                kind: NativeComputeGraphBindingKind::SourceFrameTexture(
                    NativeComputeGraphTextureDimension::D2,
                ),
                source_slot: Some(media_source_slot),
            },
            NativeComputeGraphBindingSpec {
                binding: 3,
                resource_id: "source-frame-sampler".to_string(),
                kind: NativeComputeGraphBindingKind::SourceFrameSampler,
                source_slot: None,
            },
        ];
        let behavior_layout = native_graph_binding_layout_signature(&behavior_bindings);
        let mut pass_plans = vec![NativeComputeGraphPassPlan {
            name: "particle-behavior".to_string(),
            cache_key: format!(
                "graph:{behavior_shader_id}:{behavior_hash}:cs_main:{behavior_layout}"
            ),
            source: behavior_source,
            entry: "cs_main".to_string(),
            dispatch: [params.particle_count.div_ceil(64).max(1), 1, 1],
            bindings: behavior_bindings,
        }];
        if params.connect_enabled {
            let edge_bindings = vec![
                NativeComputeGraphBindingSpec {
                    binding: 0,
                    resource_id: particle_id.clone(),
                    kind: NativeComputeGraphBindingKind::Buffer(
                        NativeComputeBufferBindingKind::StorageRead,
                    ),
                    source_slot: None,
                },
                NativeComputeGraphBindingSpec {
                    binding: 1,
                    resource_id: edge_uniform_id,
                    kind: NativeComputeGraphBindingKind::Buffer(
                        NativeComputeBufferBindingKind::Uniform,
                    ),
                    source_slot: None,
                },
                NativeComputeGraphBindingSpec {
                    binding: 2,
                    resource_id: indirect_id.clone(),
                    kind: NativeComputeGraphBindingKind::Buffer(
                        NativeComputeBufferBindingKind::StorageReadWrite,
                    ),
                    source_slot: None,
                },
                NativeComputeGraphBindingSpec {
                    binding: 3,
                    resource_id: edges_id.clone(),
                    kind: NativeComputeGraphBindingKind::Buffer(
                        NativeComputeBufferBindingKind::StorageReadWrite,
                    ),
                    source_slot: None,
                },
            ];
            let edge_layout = native_graph_binding_layout_signature(&edge_bindings);
            pass_plans.push(NativeComputeGraphPassPlan {
                name: "particle-edges".to_string(),
                cache_key: format!(
                    "graph:{edge_shader_id}:{}:cs_edges:{edge_layout}",
                    edge_hash.expect("edge shader hash")
                ),
                source: edge_source.expect("edge shader source"),
                entry: "cs_edges".to_string(),
                dispatch: [params.particle_count.div_ceil(64).max(1), 1, 1],
                bindings: edge_bindings,
            });
        }

        let slot = self.assign_source_frame_slot(&source_id)?;
        let seq = self.native_frame_index();
        let target = NativeComputeGraphRenderTarget::SourceFrame {
            source_id: source_id.clone(),
            slot,
            seq,
        };
        let mut render_plans = Vec::new();
        if params.fog_opacity > 0.001 {
            let bindings = vec![NativeComputeGraphBindingSpec {
                binding: 0,
                resource_id: fog_uniform_id,
                kind: NativeComputeGraphBindingKind::Buffer(
                    NativeComputeBufferBindingKind::Uniform,
                ),
                source_slot: None,
            }];
            let layout = native_graph_binding_layout_signature(&bindings);
            render_plans.push(NativeComputeGraphRenderPlan {
                name: "particle-fog".to_string(),
                cache_key: format!(
                    "graph-render:{fog_shader_id}:{fog_hash}:vs_main:fs_main:{}:{}:nodepth:read:{}:{layout}",
                    NativeComputeGraphRenderBlend::Alpha.signature(),
                    NativeComputeGraphPrimitiveTopology::TriangleList.signature(),
                    NativeComputeGraphDepthCompare::Less.signature(),
                ),
                source: fog_source,
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
                bindings,
            });
        }
        let sphere_depth = matches!(params.topology_id, 3 | 4);
        let bindings = vec![
            NativeComputeGraphBindingSpec {
                binding: 0,
                resource_id: particle_id.clone(),
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
        let layout = native_graph_binding_layout_signature(&bindings);
        render_plans.push(NativeComputeGraphRenderPlan {
            name: "particle-render".to_string(),
            cache_key: format!(
                "graph-render:{render_shader_id}:{render_hash}:vs_main:fs_main:{}:{}:{}:write:{}:{layout}",
                if sphere_depth { NativeComputeGraphRenderBlend::Alpha.signature() } else { NativeComputeGraphRenderBlend::Add.signature() },
                NativeComputeGraphPrimitiveTopology::TriangleList.signature(),
                if sphere_depth { "depth" } else { "nodepth" },
                NativeComputeGraphDepthCompare::Less.signature(),
            ),
            source: render_source,
            vertex_entry: "vs_main".to_string(),
            fragment_entry: "fs_main".to_string(),
            clear: render_plans.is_empty(),
            include_snapshot: false,
            generate_mips: false,
            target: target.clone(),
            blend: if sphere_depth {
                NativeComputeGraphRenderBlend::Alpha
            } else {
                NativeComputeGraphRenderBlend::Add
            },
            vertex_count: 6,
            instance_count: params.particle_count,
            indirect_buffer_id: None,
            indirect_offset: 0,
            clear_color: [0.0, 0.0, 0.0, 0.0],
            primitive_topology: NativeComputeGraphPrimitiveTopology::TriangleList,
            depth_enabled: sphere_depth,
            depth_write: sphere_depth,
            depth_compare: NativeComputeGraphDepthCompare::Less,
            depth_load: false,
            depth_texture_id: None,
            depth_only: false,
            bindings,
        });
        if params.connect_enabled {
            let bindings = vec![
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
                    resource_id: edges_id,
                    kind: NativeComputeGraphBindingKind::Buffer(
                        NativeComputeBufferBindingKind::StorageRead,
                    ),
                    source_slot: None,
                },
                NativeComputeGraphBindingSpec {
                    binding: 2,
                    resource_id: line_uniform_id,
                    kind: NativeComputeGraphBindingKind::Buffer(
                        NativeComputeBufferBindingKind::Uniform,
                    ),
                    source_slot: None,
                },
            ];
            let layout = native_graph_binding_layout_signature(&bindings);
            render_plans.push(NativeComputeGraphRenderPlan {
                name: "particle-lines".to_string(),
                cache_key: format!(
                    "graph-render:{line_shader_id}:{}:vs_main:fs_main:{}:{}:nodepth:read:{}:{layout}",
                    line_hash.expect("line shader hash"),
                    NativeComputeGraphRenderBlend::Alpha.signature(),
                    NativeComputeGraphPrimitiveTopology::LineList.signature(),
                    NativeComputeGraphDepthCompare::Less.signature(),
                ),
                source: line_source.expect("line shader source"),
                vertex_entry: "vs_main".to_string(),
                fragment_entry: "fs_main".to_string(),
                clear: false,
                include_snapshot: false,
                generate_mips: false,
                target,
                blend: NativeComputeGraphRenderBlend::Alpha,
                vertex_count: 2,
                instance_count: 0,
                indirect_buffer_id: Some(indirect_id),
                indirect_offset: 0,
                clear_color: [0.0, 0.0, 0.0, 0.0],
                primitive_topology: NativeComputeGraphPrimitiveTopology::LineList,
                depth_enabled: false,
                depth_write: false,
                depth_compare: NativeComputeGraphDepthCompare::Less,
                depth_load: false,
                depth_texture_id: None,
                depth_only: false,
                bindings,
            });
        }
        self.source_frames
            .insert(source_id.clone(), SourceFrame::full(seq));
        for layer in self.scene_layers.values_mut() {
            if layer.source_id.as_deref() == Some(source_id.as_str()) {
                layer.frame_slot = Some(slot);
            }
        }
        Ok((
            NativeGraphLayerState::ParticleField(state),
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
