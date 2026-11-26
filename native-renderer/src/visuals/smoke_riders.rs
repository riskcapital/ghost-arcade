//! The smoke riders visual.

use crate::*;

// Ceiling on how much emission one riders frame may deposit, in whole
// splats. Mirrors SPLAT_QUOTA_CAP in the TS builders. Emission is
// continuous (`dt * splat_rate` of a splat per frame), so this is not a
// rate knob: it is a blast shield for a pathological frame.
pub(crate) const SPLAT_QUOTA_CAP: f32 = 4.0;

/// Smoke Riders keeps ONE state block: the fluid ping-pong flags plus the
/// rider population identity. The old build carried two independent states
/// (a smoke state and a sphere state) because it was two instruments
/// stacked; the coupled instrument is a single simulation.
#[derive(Clone, Debug)]
pub(crate) struct NativeSmokeRidersGraphState {
    pub(crate) grid: u32,
    pub(crate) rider_count: u32,
    pub(crate) tile_count_x: u32,
    pub(crate) tile_count_y: u32,
    pub(crate) vel_flip: bool,
    pub(crate) den_flip: bool,
    pub(crate) prs_flip: bool,
    pub(crate) prev_bass: f32,
    pub(crate) burst_hold_timer: f32,
    pub(crate) auto_rot_x_phase: f32,
    pub(crate) auto_rot_y_phase: f32,
    pub(crate) auto_rot_z_phase: f32,
    pub(crate) prev_frame_time: f32,
}

impl NativeSmokeRidersGraphState {
    pub(crate) fn new(grid: u32, rider_count: u32, tile_count_x: u32, tile_count_y: u32, time: f32) -> Self {
        Self {
            grid,
            rider_count,
            tile_count_x,
            tile_count_y,
            vel_flip: false,
            den_flip: false,
            prs_flip: false,
            prev_bass: 0.0,
            burst_hold_timer: 0.0,
            auto_rot_x_phase: 0.0,
            auto_rot_y_phase: 0.0,
            auto_rot_z_phase: 0.0,
            prev_frame_time: time,
        }
    }
}

impl Default for NativeSmokeRidersGraphState {
    fn default() -> Self {
        Self::new(48, 320, 120, 68, 0.0)
    }
}

/* ============================================================== */
/* SMOKE RIDERS — coupled fluid + rider instrument                 */
/* ============================================================== */
// Mirrors src/lib/renderer/shaders/webgpuSmokeRidersShader.ts. The WGSL
// itself ships from TS through `precompile_shader`; only the graph shape
// and the uniform packing live here, and both sides must agree byte for
// byte or the same shader would read different numbers depending on
// which builder installed the graph.

pub(crate) const SMOKE_RIDERS_TILE_SIZE: u32 = 16;

pub(crate) const SMOKE_RIDERS_TILE_CAP: u32 = 64;

pub(crate) const SMOKE_RIDERS_MIN_COUNT: u32 = 16;

pub(crate) const SMOKE_RIDERS_MAX_COUNT: u32 = 2048;

/// pos+radius, vel+tau, seed+tint+life+fade = 12 floats = 48 bytes.
/// Slot 7 used to be an arbitrary `mass`; it now carries the Stokes
/// relaxation time the integrator derived for that rider.
pub(crate) const SMOKE_RIDERS_STRIDE_FLOATS: u32 = 12;

/// Reference rider radius (world units) that "Weight" is quoted at.
/// τ ∝ r², so a rider twice this size lags four times as long.
pub(crate) const SMOKE_RIDERS_TAU_REF_RADIUS: f32 = 0.05;

/// Warm-start scale applied to the pressure field before the Jacobi
/// sweep. Mirrors SMOKE_RIDERS_PRESSURE_WARM in the TS builder.
pub(crate) const SMOKE_RIDERS_PRESSURE_WARM: f32 = 0.8;

pub(crate) fn smoke_riders_tile_counts(width: u32, height: u32) -> (u32, u32) {
    (
        width.max(1).div_ceil(SMOKE_RIDERS_TILE_SIZE).max(1),
        height.max(1).div_ceil(SMOKE_RIDERS_TILE_SIZE).max(1),
    )
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct NativeSmokeRidersStyle {
    pub(crate) emitters: u32,
    pub(crate) spawn_y: f32,
    pub(crate) splat_radius: f32,
    pub(crate) splat_velocity: f32,
    pub(crate) density_decay: f32,
    pub(crate) wind: [f32; 3],
    pub(crate) turb_scale: f32,
    pub(crate) spin_x: f32,
    pub(crate) spin_z: f32,
    pub(crate) size_scale: f32,
    pub(crate) buoyancy_scale: f32,
    pub(crate) gravity_scale: f32,
}

pub(crate) fn smoke_riders_style_tuning(style: &str) -> NativeSmokeRidersStyle {
    match style {
        "ember" => NativeSmokeRidersStyle {
            emitters: 6,
            spawn_y: -0.68,
            splat_radius: 0.072,
            splat_velocity: 0.95,
            density_decay: 0.987,
            wind: [0.04, 0.5, -0.02],
            turb_scale: 3.4,
            spin_x: -0.25,
            spin_z: 0.2,
            size_scale: 0.72,
            buoyancy_scale: 1.6,
            gravity_scale: 0.4,
        },
        "pearl" => NativeSmokeRidersStyle {
            emitters: 4,
            spawn_y: -0.16,
            splat_radius: 0.13,
            splat_velocity: 0.42,
            density_decay: 0.995,
            wind: [-0.03, 0.08, 0.04],
            turb_scale: 1.8,
            spin_x: 0.1,
            spin_z: -0.12,
            size_scale: 1.3,
            buoyancy_scale: 0.55,
            gravity_scale: 0.25,
        },
        _ => NativeSmokeRidersStyle {
            emitters: 5,
            spawn_y: -0.52,
            splat_radius: 0.052,
            splat_velocity: 1.05,
            density_decay: 0.9865,
            wind: [0.0, 0.18, 0.0],
            turb_scale: 5.2,
            spin_x: -0.16,
            spin_z: 0.06,
            size_scale: 1.0,
            buoyancy_scale: 1.0,
            gravity_scale: 1.0,
        },
    }
}

#[derive(Clone, Debug)]
pub(crate) struct NativeSmokeRidersParams {
    pub(crate) grid_size: u32,
    pub(crate) pressure_iterations: usize,
    pub(crate) pressure_warm: f32,
    pub(crate) mac_cormack: bool,
    pub(crate) march_steps: u32,
    pub(crate) shadow_steps: u32,
    pub(crate) shadow_step_len: f32,
    pub(crate) rider_count: u32,
    // fluid
    pub(crate) emitter_count: u32,
    pub(crate) spread: f32,
    pub(crate) spawn_y: f32,
    pub(crate) splat_radius: f32,
    pub(crate) splat_strength: f32,
    pub(crate) splat_velocity_mag: f32,
    pub(crate) splat_rate: f32,
    pub(crate) velocity_decay: f32,
    pub(crate) density_decay: f32,
    pub(crate) wind: [f32; 3],
    pub(crate) turb_strength: f32,
    pub(crate) turb_scale: f32,
    pub(crate) vorticity: f32,
    pub(crate) surface_tension: f32,
    pub(crate) paint_thickness: f32,
    pub(crate) density: f32,
    pub(crate) emission: f32,
    // riders
    pub(crate) rider_size: f32,
    pub(crate) rider_size_variance: f32,
    /// τ in seconds for a rider at the reference radius.
    pub(crate) rider_weight: f32,
    /// τ spread in decades: 1 => [0.1×, 10×].
    pub(crate) weight_spread: f32,
    /// Precomputed (1 - ρ_f/ρ_p) so the shader does no division.
    pub(crate) gravity_factor: f32,
    pub(crate) flow_coupling: f32,
    pub(crate) buoyancy: f32,
    pub(crate) gravity: f32,
    pub(crate) vortex_pull: f32,
    /// Surface-seeking spring toward the iso shell (fluid-riders
    /// defaults 1.6; smoke-riders defaults 0).
    pub(crate) surface_stick: f32,
    /// How far the surface spring's per-rider target spreads either side
    /// of the iso level. 0 collects the whole population on the one
    /// shell; higher fans it through the body of the pour.
    pub(crate) surface_bias: f32,
    pub(crate) rider_damping: f32,
    pub(crate) rider_life: f32,
    pub(crate) contain_strength: f32,
    // material
    pub(crate) roughness: f32,
    pub(crate) metalness: f32,
    pub(crate) clear_coat: f32,
    pub(crate) coat_roughness: f32,
    pub(crate) rider_opacity: f32,
    pub(crate) reflect_strength: f32,
    pub(crate) liquid_glass: f32,
    /// How far the camera can see INTO the paint at a submerged rider
    /// (fluid-riders only; the smoke kind has no isosurface).
    pub(crate) submerge_clarity: f32,
    /// Depth-sorted rider hits the render pass keeps per ray.
    pub(crate) rider_hits: u32,
    pub(crate) surface_detail: f32,
    pub(crate) detail_scale: f32,
    pub(crate) contact_ao: f32,
    // lighting
    pub(crate) anisotropy: f32,
    pub(crate) multi_scatter: f32,
    /// Key direction in CAMERA space; the packer rotates it into object space.
    pub(crate) key_dir: [f32; 3],
    /// God-ray medium filling the volume (in-scattering density).
    pub(crate) medium_density: f32,
    pub(crate) medium_color: [f32; 3],
    /// Gain over the physical extinction fed into the light-space volume.
    pub(crate) shadow_density: f32,
    /// Edge of the cubic light-space opacity volume, quality-capped.
    pub(crate) shadow_dim: u32,
    /// cos(spotAngle/2). -1 disables the cone entirely.
    pub(crate) spot_cos: f32,
    pub(crate) spot_blend: f32,
    /// Distance of the virtual spot apex from the volume centre.
    pub(crate) light_distance: f32,
    pub(crate) key_strength: f32,
    pub(crate) key_color: [f32; 3],
    pub(crate) fill_strength: f32,
    pub(crate) fill_color: [f32; 3],
    pub(crate) rim_strength: f32,
    pub(crate) rim_color: [f32; 3],
    pub(crate) ambient: f32,
    // palette
    pub(crate) color_a: [f32; 3],
    pub(crate) color_b: [f32; 3],
    pub(crate) color_c: [f32; 3],
    pub(crate) color_d: [f32; 3],
    pub(crate) smoke_color: [f32; 3],
    pub(crate) background_mode: f32,
    pub(crate) background_color: [f32; 3],
    pub(crate) background_opacity: f32,
    pub(crate) vignette: f32,
    pub(crate) exposure: f32,
    pub(crate) flow_speed: f32,
    pub(crate) iso_level: f32,
    /// Grazing-angle silhouette fade width (fluid-riders render).
    pub(crate) edge_softness: f32,
    pub(crate) viscosity: f32,
    pub(crate) color_follow: f32,
    /// 0 = AgX, 1 = ACES, 2 = Linear.
    pub(crate) tonemap: f32,
    // camera
    pub(crate) volume_scale_x: f32,
    pub(crate) volume_scale_z: f32,
    pub(crate) fov_deg: f32,
    pub(crate) camera_z: f32,
    pub(crate) rotate: [f32; 3],
    pub(crate) auto_rotate_x: f32,
    pub(crate) auto_rotate_y: f32,
    pub(crate) auto_rotate_z: f32,
    // audio
    pub(crate) bass: f32,
    pub(crate) treble: f32,
    pub(crate) audio_burst: f32,
}

/// `fluid` selects the fluid-riders defaults for the handful of knobs
/// whose out-of-the-box value differs between the two kinds (march
/// steps, flow coupling, surface stick). Everything else is shared.
pub(crate) fn normalize_smoke_riders_native_params(
    params: &Value,
    audio_bass: f32,
    audio_treble: f32,
    fluid: bool,
) -> NativeSmokeRidersParams {
    let quality = native_particle_field_enum(params, "quality", "balanced");
    let style = native_particle_field_enum(params, "style", "paint");
    let tuning = smoke_riders_style_tuning(style.as_str());
    let intensity = native_graph_param_f32(params, "intensity", 0.0, 2.0, 1.0);
    let reactive = native_graph_param_bool(params, "audioReactive", true);
    let bass_drive = native_graph_param_f32(params, "bassDrive", 0.0, 3.0, 1.2);
    let bass = if reactive {
        (audio_bass.clamp(0.0, 4.0) * bass_drive).min(1.8)
    } else {
        0.0
    };
    let treble = if reactive {
        audio_treble.clamp(0.0, 1.0)
    } else {
        0.0
    };
    let treble_shimmer = native_graph_param_f32(params, "trebleShimmer", 0.0, 0.2, 0.025);

    let grid_size = match quality.as_str() {
        "ultra" => 64,
        "performance" => 32,
        _ => 48,
    };
    // Warm-starting the pressure field is what makes these counts
    // affordable — the floor is 20, below which the projection visibly
    // fails to close and the plume smears sideways.
    let pressure_iterations = if quality == "ultra" { 24 } else { 20 };
    // MacCormack doubles the advection cost. Performance keeps the plain
    // semi-Lagrangian chain; the other tiers honour the operator's choice.
    let mac_cormack = quality != "performance"
        && native_particle_field_enum(params, "advection", "maccormack") != "semi-lagrangian";
    let count_scale = match quality.as_str() {
        "ultra" => 1.35,
        "performance" => 0.5,
        _ => 1.0,
    };
    let march_scale = match quality.as_str() {
        "ultra" => 1.4,
        "performance" => 0.5,
        _ => 1.0,
    };
    let shadow_scale = if quality == "performance" { 0.6 } else { 1.0 };
    // K nearest orb hits the render pass keeps per ray. The gather is
    // nearly free (the ray-sphere test already runs for every binned
    // rider); the cost is K PBR evaluations, and the composite early-outs
    // the moment alpha saturates — so this only bites below Orb Opacity 1.
    let rider_hits: u32 = match quality.as_str() {
        "ultra" => 4,
        "performance" => 2,
        _ => 3,
    };
    // Ceiling on the authored `shadowRes` for the light-space opacity
    // volume. The tier ALSO authors the value through `tierParams`; this
    // is the backstop that stops a project saved at 80 from dragging a
    // Performance machine down.
    let shadow_dim_cap: u32 = match quality.as_str() {
        "ultra" => 80,
        "performance" => 32,
        _ => 64,
    };

    let rider_count = ((native_graph_param_f32(
        params,
        "riderCount",
        SMOKE_RIDERS_MIN_COUNT as f32,
        SMOKE_RIDERS_MAX_COUNT as f32,
        220.0,
    ) * count_scale)
        .round() as i64)
        .clamp(SMOKE_RIDERS_MIN_COUNT as i64, SMOKE_RIDERS_MAX_COUNT as i64) as u32;
    // The animated low-discrepancy march offset buys back roughly the
    // quality a tenth of the steps used to cost, so the base step count
    // dropped from 80 to 72 without a visible change. The liquid's
    // iso-surface hunt needs finer steps than a scatter integral, so
    // fluid-riders defaults higher.
    let march_default = if fluid { 96.0 } else { 72.0 };
    let march_steps = ((native_graph_param_f32(params, "marchSteps", 16.0, 160.0, march_default)
        * march_scale)
        .round() as i64)
        .clamp(16, 192) as u32;
    let shadow_steps = ((native_graph_param_f32(params, "shadowSteps", 0.0, 12.0, 5.0)
        * shadow_scale)
        .round() as i64)
        .clamp(0, 12) as u32;
    let rider_density = native_graph_param_f32(params, "riderDensity", 0.2, 4.0, 1.9);
    let spot_angle = native_graph_param_f32(params, "spotAngle", 5.0, 180.0, 55.0);

    NativeSmokeRidersParams {
        grid_size,
        pressure_iterations,
        pressure_warm: SMOKE_RIDERS_PRESSURE_WARM,
        mac_cormack,
        march_steps,
        shadow_steps,
        shadow_step_len: 0.075,
        rider_count,

        emitter_count: native_graph_param_u32(
            params,
            "emitterCount",
            1,
            SMOKE_3D_MAX_EMITTERS as u32,
            tuning.emitters,
        ),
        spread: native_graph_param_f32(params, "smokeSpread", 0.0, 0.9, 0.38),
        spawn_y: tuning.spawn_y,
        splat_radius: tuning.splat_radius,
        splat_strength: (0.34 + bass * 0.26) * intensity.max(0.1),
        splat_velocity_mag: tuning.splat_velocity + bass * 0.4,
        splat_rate: 44.0 + bass * 20.0,
        velocity_decay: 0.984,
        density_decay: tuning.density_decay,
        wind: tuning.wind,
        turb_strength: native_graph_param_f32(params, "smokeTurbulence", 0.0, 4.0, 0.5)
            + bass * 0.45,
        turb_scale: tuning.turb_scale,
        vorticity: native_graph_param_f32(params, "vorticity", 0.0, 12.0, 3.8)
            * (1.0 + bass * 0.35),
        surface_tension: native_graph_param_f32(params, "surfaceTension", 0.0, 3.0, 0.6),
        paint_thickness: native_graph_param_f32(params, "paintThickness", 0.0, 2.0, 0.5),
        density: native_graph_param_f32(params, "smokeDensity", 0.0, 8.0, 3.0),
        emission: native_graph_param_f32(params, "smokeGlow", 0.0, 6.0, 1.35)
            * (0.85 + intensity * 0.35),

        rider_size: native_graph_param_f32(params, "riderSize", 0.01, 0.3, 0.042)
            * tuning.size_scale,
        rider_size_variance: native_graph_param_f32(params, "riderSizeVariance", 0.0, 1.0, 0.62),
        rider_weight: native_graph_param_f32(params, "riderWeight", 0.01, 1.2, 0.08),
        weight_spread: native_graph_param_f32(params, "weightSpread", 0.0, 1.0, 0.38),
        gravity_factor: 1.0 - 1.0 / rider_density,
        flow_coupling: native_graph_param_f32(
            params,
            "flowCoupling",
            0.0,
            3.0,
            if fluid { 1.35 } else { 1.05 },
        ),
        buoyancy: native_graph_param_f32(params, "buoyancy", 0.0, 4.0, 0.2)
            * tuning.buoyancy_scale
            * (1.0 + bass * 0.4),
        gravity: native_graph_param_f32(params, "gravity", 0.0, 4.0, 1.0) * tuning.gravity_scale,
        vortex_pull: native_graph_param_f32(params, "vortexPull", -1.0, 1.0, 0.0),
        surface_stick: native_graph_param_f32(
            params,
            "surfaceStick",
            0.0,
            4.0,
            if fluid { 1.6 } else { 0.0 },
        ),
        surface_bias: native_graph_param_f32(params, "surfaceBias", 0.0, 1.0, 0.62),
        rider_damping: native_graph_param_f32(params, "riderDamping", 0.0, 4.0, 0.45),
        rider_life: native_graph_param_f32(params, "riderLife", 1.0, 60.0, 6.0),
        // Velocity gain, not a spring constant: the containment is folded
        // into the velocity the rider relaxes toward, so a heavy rider is
        // eased back into the box instead of being catapulted.
        contain_strength: 6.0,

        roughness: native_graph_param_f32(params, "roughness", 0.03, 1.0, 0.17),
        metalness: native_graph_param_f32(params, "metalness", 0.0, 1.0, 0.08),
        clear_coat: native_graph_param_f32(params, "clearCoat", 0.0, 1.0, 0.75),
        coat_roughness: native_graph_param_f32(params, "coatRoughness", 0.01, 1.0, 0.08),
        rider_opacity: native_graph_param_f32(params, "riderOpacity", 0.15, 1.0, 1.0),
        reflect_strength: native_graph_param_f32(params, "reflectStrength", 0.0, 3.0, 1.0),
        liquid_glass: native_graph_param_f32(params, "liquidGlass", 0.0, 1.0, 0.0),
        submerge_clarity: native_graph_param_f32(
            params,
            "submergeClarity",
            0.0,
            1.0,
            if fluid { 0.85 } else { 0.0 },
        ),
        rider_hits,
        surface_detail: native_graph_param_f32(params, "surfaceDetail", 0.0, 1.0, 0.12),
        detail_scale: native_graph_param_f32(params, "detailScale", 1.0, 24.0, 8.0),
        contact_ao: native_graph_param_f32(params, "contactAO", 0.0, 4.0, 1.1),

        anisotropy: native_graph_param_f32(params, "anisotropy", -0.9, 0.9, 0.4),
        multi_scatter: native_graph_param_f32(params, "multiScatter", 0.0, 2.0, 0.35),
        key_dir: riders_normalize_key_dir(
            native_graph_param_f32(params, "lightX", -2.0, 2.0, -0.52),
            native_graph_param_f32(params, "lightY", -2.0, 2.0, 0.94),
            native_graph_param_f32(params, "lightZ", -2.0, 2.0, 0.24),
        ),
        // The liquid's march is an iso-surface HUNT, so every haze step
        // buys a volume lookup the hunt would not otherwise pay for —
        // it defaults lower than the smoke instrument's scatter integral.
        medium_density: native_graph_param_f32(
            params,
            "mediumDensity",
            0.0,
            3.0,
            if fluid { 0.55 } else { 0.9 },
        ),
        medium_color: native_graph_param_rgb(params, "mediumColor", [0.886, 0.910, 1.0]),
        shadow_density: native_graph_param_f32(params, "shadowDensity", 0.0, 6.0, 1.6),
        shadow_dim: riders_shadow_dim(params, shadow_dim_cap),
        spot_cos: riders_spot_cos(spot_angle),
        spot_blend: riders_spot_blend(
            spot_angle,
            native_graph_param_f32(params, "spotSoftness", 0.01, 1.0, 0.4),
        ),
        light_distance: native_graph_param_f32(params, "lightDistance", 1.0, 12.0, 3.8),
        key_strength: native_graph_param_f32(params, "keyStrength", 0.0, 8.0, 3.1)
            * (0.8 + intensity * 0.25),
        key_color: native_graph_param_rgb(params, "keyColor", [1.0, 0.933_333, 0.839_216]),
        fill_strength: native_graph_param_f32(params, "fillStrength", 0.0, 4.0, 0.6),
        fill_color: native_graph_param_rgb(params, "fillColor", [0.620, 0.722, 0.910]),
        rim_strength: native_graph_param_f32(params, "rimStrength", 0.0, 6.0, 1.15)
            * (1.0 + treble * treble_shimmer * 12.0),
        rim_color: native_graph_param_rgb(params, "rimColor", [1.0, 0.807_843, 0.658_824]),
        ambient: native_graph_param_f32(params, "ambient", 0.0, 2.0, 0.14),

        color_a: native_graph_param_rgb(params, "colorA", [1.0, 0.408, 0.039]),
        color_b: native_graph_param_rgb(params, "colorB", [0.910, 0.173, 0.024]),
        color_c: native_graph_param_rgb(params, "colorC", [1.0, 0.580, 0.149]),
        color_d: native_graph_param_rgb(params, "colorD", [0.659, 0.110, 0.016]),
        smoke_color: native_graph_param_rgb(params, "smokeColor", [1.0, 0.470, 0.118]),
        background_mode: match native_particle_field_enum(params, "backgroundMode", "studio")
            .as_str()
        {
            "transparent" => 0.0,
            "flat" => 1.0,
            _ => 2.0,
        },
        background_color: native_graph_param_rgb(
            params,
            "backgroundColor",
            [0.062_745, 0.058_824, 0.070_588],
        ),
        background_opacity: native_graph_param_f32(params, "backgroundOpacity", 0.0, 1.0, 1.0),
        vignette: native_graph_param_f32(params, "vignette", 0.0, 1.0, 0.55),
        exposure: native_graph_param_f32(params, "exposure", 0.1, 4.0, 1.5),
        flow_speed: native_graph_param_f32(params, "flowSpeed", 0.05, 2.0, 0.32),
        iso_level: native_graph_param_f32(params, "isoLevel", 0.02, 2.5, 0.42),
        edge_softness: native_graph_param_f32(params, "edgeSoftness", 0.0, 0.5, 0.18),
        viscosity: native_graph_param_f32(params, "viscosity", 0.0, 1.0, 0.72),
        color_follow: native_graph_param_f32(params, "colorFollow", 0.0, 10.0, 3.2),
        tonemap: match native_particle_field_enum(params, "tonemap", "agx").as_str() {
            "aces" => 1.0,
            "linear" => 2.0,
            _ => 0.0,
        },

        volume_scale_x: 1.72,
        volume_scale_z: 1.25,
        fov_deg: native_graph_param_f32(params, "fovDeg", 25.0, 95.0, 48.0),
        camera_z: native_graph_param_f32(params, "cameraZ", 1.4, 7.0, 2.85),
        rotate: [
            native_graph_param_f32(params, "rotateX", -3600.0, 3600.0, 0.0),
            native_graph_param_f32(params, "rotateY", -3600.0, 3600.0, 0.0),
            native_graph_param_f32(params, "rotateZ", -3600.0, 3600.0, 0.0),
        ],
        auto_rotate_x: tuning.spin_x,
        auto_rotate_y: native_graph_param_f32(params, "autoSpin", -24.0, 24.0, 1.4),
        auto_rotate_z: tuning.spin_z,

        bass,
        treble,
        audio_burst: bass_drive,
    }
}

/// Deterministic seed hash, mirrored in the TS builder so both graph
/// builders spawn the same rider population.
pub(crate) fn smoke_riders_hash(n: f32) -> f32 {
    let s = ((n * 127.1 + 311.7).sin()) * 43758.5453;
    s - s.floor()
}

/// Camera-space light direction -> volume object space. The model
/// rotation is baked into viewProj (the volume spins, not the camera),
/// so without this inverse the studio rig would orbit with the smoke.
pub(crate) fn smoke_riders_light_to_object(model: [f32; 16], dir: [f32; 3]) -> [f32; 3] {
    // Rotation-only model: inverse == transpose.
    let x = model[0] * dir[0] + model[1] * dir[1] + model[2] * dir[2];
    let y = model[4] * dir[0] + model[5] * dir[1] + model[6] * dir[2];
    let z = model[8] * dir[0] + model[9] * dir[1] + model[10] * dir[2];
    native_vec3_normalize([x, y, z], dir)
}

pub(crate) fn build_smoke_riders_sim_uniform_bytes(
    params: &NativeSmokeRidersParams,
    dt: f32,
    time: f32,
    // Fraction of one full splat this frame carries (see CONTINUOUS
    // EMISSION above), already multiplied by the audio burst gain.
    emit_mul: f32,
) -> Vec<u8> {
    let mut bytes = vec![0_u8; 96];
    write_u32_le(&mut bytes, 0, params.grid_size);
    write_u32_le(&mut bytes, 1, params.grid_size);
    write_u32_le(&mut bytes, 2, params.grid_size);
    write_u32_le(&mut bytes, 3, params.emitter_count);
    write_f32_le(&mut bytes, 4, dt);
    write_f32_le(&mut bytes, 5, time);
    write_f32_le(&mut bytes, 6, emit_mul);
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

// `vel_scale` is the same per-frame emission fraction the density term
// gets. The shared splat WGSL adds emitter velocity WITHOUT the strength
// multiplier, so rate-normalising the injected momentum has to happen
// here: without it, running the pass every frame instead of every fifth
// would quintuple the jet and the plume would change shape, not just
// stop flickering.
pub(crate) fn build_smoke_riders_emitter_bytes(
    params: &NativeSmokeRidersParams,
    vel_scale: f32,
) -> Vec<u8> {
    let mut bytes = vec![0_u8; SMOKE_3D_MAX_EMITTERS * 48];
    let emitter_count = params.emitter_count.clamp(1, SMOKE_3D_MAX_EMITTERS as u32);
    let palette = [
        params.color_a,
        params.color_b,
        params.color_c,
        params.color_d,
    ];
    for index in 0..emitter_count as usize {
        let off = index * 12;
        let angle = if emitter_count > 1 {
            index as f32 / emitter_count as f32 * std::f32::consts::TAU
        } else {
            0.0
        };
        let color = palette[index % palette.len()];
        write_f32_le(&mut bytes, off, angle.cos() * params.spread * 0.5 + 0.5);
        write_f32_le(&mut bytes, off + 1, params.spawn_y * 0.5 + 0.5);
        write_f32_le(&mut bytes, off + 2, angle.sin() * params.spread * 0.5 + 0.5);
        write_f32_le(&mut bytes, off + 3, params.splat_radius);
        write_f32_le(&mut bytes, off + 4, color[0]);
        write_f32_le(&mut bytes, off + 5, color[1]);
        write_f32_le(&mut bytes, off + 6, color[2]);
        write_f32_le(&mut bytes, off + 7, params.splat_strength);
        let vm = params.splat_velocity_mag * vel_scale;
        write_f32_le(&mut bytes, off + 8, angle.cos() * vm * 0.18);
        write_f32_le(&mut bytes, off + 9, vm);
        write_f32_le(&mut bytes, off + 10, angle.sin() * vm * 0.18);
    }
    bytes
}

pub(crate) fn build_smoke_riders_vorticity_uniform_bytes(
    params: &NativeSmokeRidersParams,
    dt: f32,
) -> Vec<u8> {
    let mut bytes = vec![0_u8; 32];
    write_u32_le(&mut bytes, 0, params.grid_size);
    write_u32_le(&mut bytes, 1, params.grid_size);
    write_u32_le(&mut bytes, 2, params.grid_size);
    write_f32_le(&mut bytes, 4, dt);
    write_f32_le(&mut bytes, 5, params.vorticity);
    write_f32_le(&mut bytes, 6, 1.0 / params.grid_size.max(1) as f32);
    write_f32_le(&mut bytes, 7, params.pressure_warm);
    bytes
}

pub(crate) fn build_smoke_riders_surface_uniform_bytes(
    params: &NativeSmokeRidersParams,
    dt: f32,
) -> Vec<u8> {
    let mut bytes = vec![0_u8; 32];
    write_u32_le(&mut bytes, 0, params.grid_size);
    write_u32_le(&mut bytes, 1, params.grid_size);
    write_u32_le(&mut bytes, 2, params.grid_size);
    write_f32_le(&mut bytes, 4, dt);
    write_f32_le(&mut bytes, 5, params.surface_tension);
    write_f32_le(&mut bytes, 6, params.paint_thickness);
    // CFL cap: no cell may be pushed more than a quarter of a cell width
    // (velocity is in uv/s, so a cell is 1/grid) by surface tension alone.
    write_f32_le(&mut bytes, 7, 0.25 / params.grid_size.max(1) as f32);
    bytes
}

pub(crate) fn build_smoke_riders_rider_uniform_bytes(
    params: &NativeSmokeRidersParams,
    dt: f32,
    time: f32,
) -> Vec<u8> {
    let mut bytes = vec![0_u8; 144];
    write_u32_le(&mut bytes, 0, params.grid_size);
    write_u32_le(&mut bytes, 1, params.grid_size);
    write_u32_le(&mut bytes, 2, params.grid_size);
    write_u32_le(&mut bytes, 3, params.rider_count);
    write_f32_le(&mut bytes, 4, dt);
    write_f32_le(&mut bytes, 5, time);
    write_f32_le(&mut bytes, 6, params.flow_coupling);
    write_f32_le(&mut bytes, 7, params.rider_weight);
    write_f32_le(&mut bytes, 8, params.buoyancy);
    write_f32_le(&mut bytes, 9, params.gravity);
    write_f32_le(&mut bytes, 10, params.vortex_pull);
    write_f32_le(&mut bytes, 11, params.rider_damping);
    write_f32_le(&mut bytes, 12, params.weight_spread);
    write_f32_le(&mut bytes, 13, params.gravity_factor);
    write_f32_le(&mut bytes, 14, 0.45);
    write_f32_le(&mut bytes, 15, 0.35 + params.rider_size_variance * 1.9);
    write_f32_le(&mut bytes, 16, params.volume_scale_x);
    write_f32_le(&mut bytes, 17, 1.0);
    write_f32_le(&mut bytes, 18, params.volume_scale_z);
    write_f32_le(&mut bytes, 19, params.contain_strength);
    write_f32_le(&mut bytes, 20, 0.0);
    write_f32_le(&mut bytes, 21, params.spawn_y);
    write_f32_le(&mut bytes, 22, 0.0);
    write_f32_le(
        &mut bytes,
        23,
        (params.spread * params.volume_scale_x + 0.2).max(0.15),
    );
    write_f32_le(&mut bytes, 24, params.rider_life);
    // Pressure-gradient gain: the solver's p lives on grid indices, so the
    // per-index difference becomes a world-space gradient by dividing by
    // the world cell size (extent/grid) — folded here as grid/extentY,
    // with extentY = 2 (the volume is 1 unit tall each way).
    write_f32_le(&mut bytes, 25, params.grid_size as f32 * 0.5);
    write_f32_le(&mut bytes, 26, params.bass);
    write_f32_le(&mut bytes, 27, params.treble);
    write_f32_le(&mut bytes, 28, params.rider_size);
    write_f32_le(&mut bytes, 29, SMOKE_RIDERS_TAU_REF_RADIUS);
    write_f32_le(&mut bytes, 30, params.surface_stick);
    write_f32_le(&mut bytes, 31, params.iso_level);
    write_f32_le(&mut bytes, 32, params.surface_bias);
    bytes
}

pub(crate) fn build_smoke_riders_bin_uniform_bytes(
    params: &NativeSmokeRidersParams,
    view_proj: [f32; 16],
    tile_count_x: u32,
    tile_count_y: u32,
    aspect: f32,
) -> Vec<u8> {
    let mut bytes = vec![0_u8; 96];
    for (index, value) in view_proj.iter().enumerate() {
        write_f32_le(&mut bytes, index, *value);
    }
    write_u32_le(&mut bytes, 16, tile_count_x);
    write_u32_le(&mut bytes, 17, tile_count_y);
    write_u32_le(&mut bytes, 18, SMOKE_RIDERS_TILE_CAP);
    write_u32_le(&mut bytes, 19, params.rider_count);
    write_f32_le(
        &mut bytes,
        20,
        1.0 / (params.fov_deg.to_radians() * 0.5).tan(),
    );
    write_f32_le(&mut bytes, 21, aspect);
    write_f32_le(&mut bytes, 22, params.rider_size);
    bytes
}

/* ── shadow volume geometry (shared by BOTH rider kinds) ────────── */
// Mirrors `ridersShadowDim` / `ridersSpotCos` / `ridersSpotBlend` /
// `ridersShadowFrame` / `ridersShadowExtinction` in
// src/lib/renderer/shaders/webgpuSmokeRidersShader.ts. The two packers
// must stay byte-identical, so these must stay value-identical.

pub(crate) const RIDERS_SHADOW_DIM_MAX: u32 = 80;

/// Render uniform size. Grew from 384 when the light-space occlusion
/// volume added its frame, the haze medium and the spot cone.
pub(crate) const SMOKE_RIDERS_RENDER_UNIFORM_BYTES: usize = 512;

pub(crate) const SMOKE_RIDERS_SHADOW_UNIFORM_BYTES: usize = 128;

pub(crate) fn riders_shadow_dim(params: &Value, cap: u32) -> u32 {
    let raw = native_graph_param_numeric(params, "shadowRes").unwrap_or(48.0);
    let n = raw.clamp(16.0, RIDERS_SHADOW_DIM_MAX as f64) as f32;
    let mut best = 48_u32;
    let mut best_d = f32::INFINITY;
    for step in [32_u32, 48, 64, 80] {
        let d = (step as f32 - n).abs();
        if d < best_d {
            best_d = d;
            best = step;
        }
    }
    best.min(cap.min(RIDERS_SHADOW_DIM_MAX)).max(16)
}

/// cos of the spot half-angle. 180 degrees returns -1, which the shader
/// treats as "no cone" — an exact no-op, so the default look is untouched.
pub(crate) fn riders_spot_cos(angle_deg: f32) -> f32 {
    if !(angle_deg < 179.5) {
        return -1.0;
    }
    (angle_deg.max(1.0).to_radians() * 0.5).cos()
}

pub(crate) fn riders_spot_blend(angle_deg: f32, softness: f32) -> f32 {
    let c = riders_spot_cos(angle_deg);
    softness.min(0.95) * (1.0 - c) + 0.002
}

pub(crate) struct RidersShadowFrame {
    pub(crate) lu: [f32; 3],
    pub(crate) lv: [f32; 3],
    pub(crate) lw: [f32; 3],
    pub(crate) extent: f32,
    pub(crate) depth: f32,
    pub(crate) cell_z: f32,
}

/// Orthonormal light frame for the opacity volume. `key_dir` points FROM
/// the scene TOWARD the light, in the volume's OBJECT space — the same
/// space the density grid and the rider positions live in, so the volume
/// spins with them for free. `lw` is the PROPAGATION direction, so the
/// prefix sum runs down +w.
pub(crate) fn riders_shadow_frame(
    key_dir: [f32; 3],
    volume_scale_x: f32,
    volume_scale_z: f32,
    dim: u32,
) -> RidersShadowFrame {
    let kl = (key_dir[0] * key_dir[0] + key_dir[1] * key_dir[1] + key_dir[2] * key_dir[2]).sqrt();
    let kl = if kl > 1.0e-6 { kl } else { 1.0 };
    let lw = [-key_dir[0] / kl, -key_dir[1] / kl, -key_dir[2] / kl];
    let up: [f32; 3] = if lw[1].abs() > 0.94 {
        [1.0, 0.0, 0.0]
    } else {
        [0.0, 1.0, 0.0]
    };
    let cross = |a: [f32; 3], b: [f32; 3]| {
        [
            a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0],
        ]
    };
    let norm = |v: [f32; 3], fb: [f32; 3]| {
        let l = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt();
        if l > 1.0e-6 {
            [v[0] / l, v[1] / l, v[2] / l]
        } else {
            fb
        }
    };
    let lu = norm(cross(up, lw), [1.0, 0.0, 0.0]);
    let lv = norm(cross(lw, lu), [0.0, 1.0, 0.0]);
    // Bounding sphere of the volume box, so the frame covers it at every
    // light angle without re-fitting per frame (which would make the
    // shadow resolution flicker as the volume spins).
    let radius =
        (volume_scale_x * volume_scale_x + 1.0 + volume_scale_z * volume_scale_z).sqrt();
    let extent = radius * 1.06;
    let depth = radius * 2.15;
    RidersShadowFrame {
        lu,
        lv,
        lw,
        extent,
        depth,
        cell_z: depth / dim.max(1) as f32,
    }
}

/// Unit key direction in camera space, with the historical rig as the
/// fallback for a degenerate (0,0,0) input.
pub(crate) fn riders_normalize_key_dir(x: f32, y: f32, z: f32) -> [f32; 3] {
    let l = (x * x + y * y + z * z).sqrt();
    if !(l > 1.0e-4) {
        return [-0.42, 0.68, 0.62];
    }
    [x / l, y / l, z / l]
}

/// Per-unit-length extinction a rider contributes to the opacity volume.
pub(crate) fn riders_shadow_extinction(rider_opacity: f32) -> f32 {
    34.0 * rider_opacity.clamp(0.0, 1.0)
}

/// Uniform for the three light-space occlusion passes. Mirrored byte for
/// byte by `buildShadowUniform` in BOTH rider shader modules.
pub(crate) fn build_smoke_riders_shadow_uniform_bytes(
    params: &NativeSmokeRidersParams,
    model: [f32; 16],
) -> Vec<u8> {
    let mut bytes = vec![0_u8; SMOKE_RIDERS_SHADOW_UNIFORM_BYTES];
    let key = smoke_riders_light_to_object(model, params.key_dir);
    let dim = params.shadow_dim;
    let frame = riders_shadow_frame(key, params.volume_scale_x, params.volume_scale_z, dim);
    write_f32_le(&mut bytes, 0, frame.lu[0]);
    write_f32_le(&mut bytes, 1, frame.lu[1]);
    write_f32_le(&mut bytes, 2, frame.lu[2]);
    write_f32_le(&mut bytes, 3, frame.extent);
    write_f32_le(&mut bytes, 4, frame.lv[0]);
    write_f32_le(&mut bytes, 5, frame.lv[1]);
    write_f32_le(&mut bytes, 6, frame.lv[2]);
    write_f32_le(&mut bytes, 7, frame.depth);
    write_f32_le(&mut bytes, 8, frame.lw[0]);
    write_f32_le(&mut bytes, 9, frame.lw[1]);
    write_f32_le(&mut bytes, 10, frame.lw[2]);
    write_u32_le(&mut bytes, 11, dim * dim * dim);
    write_f32_le(&mut bytes, 12, params.volume_scale_x);
    write_f32_le(&mut bytes, 13, 1.0);
    write_f32_le(&mut bytes, 14, params.volume_scale_z);
    write_u32_le(&mut bytes, 15, params.rider_count);
    write_u32_le(&mut bytes, 16, dim);
    write_u32_le(&mut bytes, 17, dim);
    write_u32_le(&mut bytes, 18, dim);
    write_f32_le(&mut bytes, 19, params.rider_size);
    write_u32_le(&mut bytes, 20, params.grid_size);
    write_u32_le(&mut bytes, 21, params.grid_size);
    write_u32_le(&mut bytes, 22, params.grid_size);
    write_f32_le(&mut bytes, 23, params.density);
    write_f32_le(&mut bytes, 24, riders_shadow_extinction(params.rider_opacity));
    write_f32_le(&mut bytes, 25, 0.0);
    write_f32_le(&mut bytes, 26, 0.0);
    write_f32_le(&mut bytes, 27, 0.0);
    bytes
}

pub(crate) fn build_smoke_riders_render_uniform_bytes(
    params: &NativeSmokeRidersParams,
    inv_view_proj: [f32; 16],
    model: [f32; 16],
    tile_count_x: u32,
    tile_count_y: u32,
    frame_index: u64,
    time: f32,
) -> Vec<u8> {
    let mut bytes = vec![0_u8; SMOKE_RIDERS_RENDER_UNIFORM_BYTES];
    for (index, value) in inv_view_proj.iter().enumerate() {
        write_f32_le(&mut bytes, index, *value);
    }
    let key = smoke_riders_light_to_object(model, params.key_dir);
    let fill = smoke_riders_light_to_object(model, [0.66, 0.12, 0.74]);
    let rim = smoke_riders_light_to_object(model, [0.18, 0.28, -0.94]);
    write_f32_le(&mut bytes, 16, params.smoke_color[0]);
    write_f32_le(&mut bytes, 17, params.smoke_color[1]);
    write_f32_le(&mut bytes, 18, params.smoke_color[2]);
    write_f32_le(&mut bytes, 19, params.exposure);
    write_f32_le(&mut bytes, 20, params.volume_scale_x);
    write_f32_le(&mut bytes, 21, 1.0);
    write_f32_le(&mut bytes, 22, params.volume_scale_z);
    write_f32_le(&mut bytes, 23, params.density);
    write_f32_le(&mut bytes, 24, params.background_color[0]);
    write_f32_le(&mut bytes, 25, params.background_color[1]);
    write_f32_le(&mut bytes, 26, params.background_color[2]);
    write_f32_le(&mut bytes, 27, params.background_opacity);
    write_u32_le(&mut bytes, 28, params.grid_size);
    write_u32_le(&mut bytes, 29, params.grid_size);
    write_u32_le(&mut bytes, 30, params.grid_size);
    write_u32_le(&mut bytes, 31, params.rider_count);
    write_f32_le(&mut bytes, 32, key[0]);
    write_f32_le(&mut bytes, 33, key[1]);
    write_f32_le(&mut bytes, 34, key[2]);
    write_f32_le(&mut bytes, 35, params.key_strength);
    write_f32_le(&mut bytes, 36, params.key_color[0]);
    write_f32_le(&mut bytes, 37, params.key_color[1]);
    write_f32_le(&mut bytes, 38, params.key_color[2]);
    write_f32_le(&mut bytes, 39, params.anisotropy);
    write_f32_le(&mut bytes, 40, fill[0]);
    write_f32_le(&mut bytes, 41, fill[1]);
    write_f32_le(&mut bytes, 42, fill[2]);
    write_f32_le(&mut bytes, 43, params.fill_strength);
    write_f32_le(&mut bytes, 44, params.fill_color[0]);
    write_f32_le(&mut bytes, 45, params.fill_color[1]);
    write_f32_le(&mut bytes, 46, params.fill_color[2]);
    write_f32_le(&mut bytes, 47, params.roughness);
    write_f32_le(&mut bytes, 48, rim[0]);
    write_f32_le(&mut bytes, 49, rim[1]);
    write_f32_le(&mut bytes, 50, rim[2]);
    write_f32_le(&mut bytes, 51, params.rim_strength);
    write_f32_le(&mut bytes, 52, params.rim_color[0]);
    write_f32_le(&mut bytes, 53, params.rim_color[1]);
    write_f32_le(&mut bytes, 54, params.rim_color[2]);
    write_f32_le(&mut bytes, 55, params.metalness);
    write_f32_le(&mut bytes, 56, params.color_a[0]);
    write_f32_le(&mut bytes, 57, params.color_a[1]);
    write_f32_le(&mut bytes, 58, params.color_a[2]);
    write_f32_le(&mut bytes, 59, params.emission);
    write_f32_le(&mut bytes, 60, params.color_b[0]);
    write_f32_le(&mut bytes, 61, params.color_b[1]);
    write_f32_le(&mut bytes, 62, params.color_b[2]);
    write_f32_le(&mut bytes, 63, params.multi_scatter);
    write_f32_le(&mut bytes, 64, params.color_c[0]);
    write_f32_le(&mut bytes, 65, params.color_c[1]);
    write_f32_le(&mut bytes, 66, params.color_c[2]);
    write_f32_le(&mut bytes, 67, params.shadow_step_len);
    write_f32_le(&mut bytes, 68, params.color_d[0]);
    write_f32_le(&mut bytes, 69, params.color_d[1]);
    write_f32_le(&mut bytes, 70, params.color_d[2]);
    write_f32_le(&mut bytes, 71, params.contact_ao);
    write_u32_le(&mut bytes, 72, params.shadow_steps);
    write_u32_le(&mut bytes, 73, params.march_steps);
    write_u32_le(&mut bytes, 74, tile_count_x);
    write_u32_le(&mut bytes, 75, tile_count_y);
    write_f32_le(&mut bytes, 76, params.rider_size);
    write_f32_le(&mut bytes, 77, params.ambient);
    write_f32_le(&mut bytes, 78, params.vignette);
    write_f32_le(&mut bytes, 79, params.background_mode);
    // Wrapped: the march offset only needs the frame's phase, and a u32
    // that has been counting for hours loses fp32 precision inside the
    // shader's f32(frameIndex).
    write_u32_le(&mut bytes, 80, (frame_index % 4096) as u32);
    write_f32_le(&mut bytes, 81, params.tonemap);
    write_f32_le(&mut bytes, 82, params.clear_coat);
    write_f32_le(&mut bytes, 83, params.coat_roughness);
    write_f32_le(&mut bytes, 84, params.iso_level);
    write_f32_le(&mut bytes, 85, params.paint_thickness);
    write_f32_le(&mut bytes, 86, params.color_follow);
    write_f32_le(&mut bytes, 87, params.edge_softness);
    write_f32_le(&mut bytes, 88, params.rider_opacity);
    write_f32_le(&mut bytes, 89, params.reflect_strength);
    write_f32_le(&mut bytes, 90, params.liquid_glass);
    write_f32_le(&mut bytes, 91, params.surface_detail);
    write_f32_le(&mut bytes, 92, params.detail_scale);
    write_f32_le(&mut bytes, 93, time);
    write_f32_le(&mut bytes, 94, params.submerge_clarity);
    write_u32_le(&mut bytes, 95, params.rider_hits);
    // ── Light-space occlusion volume + god rays. The frame is derived
    //    from the OBJECT-space key, so it spins with the volume exactly
    //    like the density grid and the riders do.
    let frame = riders_shadow_frame(
        key,
        params.volume_scale_x,
        params.volume_scale_z,
        params.shadow_dim,
    );
    write_f32_le(&mut bytes, 96, frame.lu[0]);
    write_f32_le(&mut bytes, 97, frame.lu[1]);
    write_f32_le(&mut bytes, 98, frame.lu[2]);
    write_f32_le(&mut bytes, 99, frame.extent);
    write_f32_le(&mut bytes, 100, frame.lv[0]);
    write_f32_le(&mut bytes, 101, frame.lv[1]);
    write_f32_le(&mut bytes, 102, frame.lv[2]);
    write_f32_le(&mut bytes, 103, frame.depth);
    write_f32_le(&mut bytes, 104, frame.lw[0]);
    write_f32_le(&mut bytes, 105, frame.lw[1]);
    write_f32_le(&mut bytes, 106, frame.lw[2]);
    write_f32_le(&mut bytes, 107, params.shadow_density);
    write_u32_le(&mut bytes, 108, params.shadow_dim);
    write_u32_le(&mut bytes, 109, params.shadow_dim);
    write_u32_le(&mut bytes, 110, params.shadow_dim);
    write_f32_le(&mut bytes, 111, frame.cell_z);
    write_f32_le(&mut bytes, 112, params.medium_color[0]);
    write_f32_le(&mut bytes, 113, params.medium_color[1]);
    write_f32_le(&mut bytes, 114, params.medium_color[2]);
    write_f32_le(&mut bytes, 115, params.medium_density);
    // Virtual spot apex: up the key direction, in the same object space.
    write_f32_le(&mut bytes, 116, key[0] * params.light_distance);
    write_f32_le(&mut bytes, 117, key[1] * params.light_distance);
    write_f32_le(&mut bytes, 118, key[2] * params.light_distance);
    write_f32_le(&mut bytes, 119, params.spot_cos);
    write_f32_le(&mut bytes, 120, params.spot_blend);
    write_f32_le(&mut bytes, 121, 0.0);
    write_f32_le(&mut bytes, 122, 0.0);
    write_f32_le(&mut bytes, 123, 0.0);
    bytes
}

pub(crate) fn build_smoke_riders_initial_rider_bytes(params: &NativeSmokeRidersParams) -> Vec<u8> {
    let rider_count = params
        .rider_count
        .clamp(SMOKE_RIDERS_MIN_COUNT, SMOKE_RIDERS_MAX_COUNT);
    let stride = SMOKE_RIDERS_STRIDE_FLOATS as usize;
    let mut bytes = vec![0_u8; rider_count as usize * stride * 4];
    let bx = params.volume_scale_x;
    let bz = params.volume_scale_z;
    for index in 0..rider_count as usize {
        let seed = index as f32 * 0.618_034 + 0.137;
        let s1 = smoke_riders_hash(seed * 3.17 + 1.7);
        let s2 = smoke_riders_hash(seed * 7.31 + 4.1);
        let s3 = smoke_riders_hash(seed * 11.93 + 8.3);
        let s4 = smoke_riders_hash(seed * 23.1 + 3.3);
        let s5 = smoke_riders_hash(seed * 13.3 + 0.9);
        let angle = s1 * std::f32::consts::TAU;
        let z = s2 * 2.0 - 1.0;
        let planar = (1.0_f32 - z * z).max(0.0).sqrt();
        let r = s3.powf(0.4);
        let off = index * stride;
        write_f32_le(&mut bytes, off, angle.cos() * planar * r * bx * 0.34);
        write_f32_le(&mut bytes, off + 1, params.spawn_y + z * r * 0.3);
        write_f32_le(&mut bytes, off + 2, angle.sin() * planar * r * bz * 0.34);
        write_f32_le(
            &mut bytes,
            off + 3,
            0.45 + s4.powf(1.7) * (0.35 + params.rider_size_variance * 1.9),
        );
        // Slot 7 (τ) is derived from radius + seed by cs_riders on every
        // step, so the seeded value is only a placeholder. Leaving it
        // zero keeps this buffer byte-identical to the TS builder's with
        // no shared formula to drift.
        write_f32_le(&mut bytes, off + 8, seed);
        write_f32_le(&mut bytes, off + 9, s5);
        write_f32_le(&mut bytes, off + 10, params.rider_life * (0.2 + s2 * 1.1));
        // Seeded riders start fully faded IN; only recycled riders ramp.
        write_f32_le(&mut bytes, off + 11, 1.0);
    }
    bytes
}

impl App {
    /// Smoke Riders: ONE coupled instrument.
    ///
    /// splat -> advect-velocity -> VORTICITY -> divergence -> jacobi xN ->
    /// subtract-gradient -> advect-density -> RIDERS -> clear-tiles ->
    /// bin-riders -> one unified raymarch.
    ///
    /// The rider pass binds the SAME velocity/density buffers the fluid
    /// solve just produced, which is the whole point: the riders are moved
    /// by the fluid, not by a parallel noise field.
    pub(crate) fn build_native_smoke_riders_graph_job(
        &mut self,
        graph_layer: &NativeGraphLayer,
        shader_prefix: &str,
    ) -> Result<(NativeGraphLayerState, NativeGraphFrameJob), String> {
        let params = normalize_smoke_riders_native_params(
            &graph_layer.params,
            self.audio0[1].clamp(0.0, 4.0),
            self.audio0[3].clamp(0.0, 4.0),
            shader_prefix == "fluid-riders",
        );
        self.record_native_graph_workload(
            &graph_layer.layer_id,
            shader_prefix,
            serde_json::json!({
                // grid / pressure / march+rider scaling are re-derived from the
                // `quality` enum HERE, not in TS, so these are the numbers that
                // prove a tier landed.
                "gridSize": params.grid_size,
                "pressureIterations": params.pressure_iterations,
                "macCormack": params.mac_cormack,
                "marchSteps": params.march_steps,
                "shadowSteps": params.shadow_steps,
                "riderCount": params.rider_count,
                "riderHits": params.rider_hits,
                "shadowDim": params.shadow_dim,
                "emitterCount": params.emitter_count,
            }),
        );
        let time = self.native_graph_time_seconds();
        let width = self.pending_width.max(1);
        let height = self.pending_height.max(1);
        let (tile_count_x, tile_count_y) = smoke_riders_tile_counts(width, height);
        let tile_count = tile_count_x.saturating_mul(tile_count_y).max(1);
        let source_id = graph_layer.source_id.clone();
        let safe_source = native_graph_buffer_safe_id(&source_id);
        let prefix = format!("smoke-riders:{safe_source}");
        let grid_size = params.grid_size;
        let rider_count = params.rider_count;
        let uid = |name: &str| format!("{prefix}:{name}");
        let gid = |name: &str| format!("{prefix}:g{grid_size}:{name}");
        let rid = |name: &str| format!("{prefix}:r{rider_count}:{name}");
        let tid = |name: &str| format!("{prefix}:t{tile_count_x}x{tile_count_y}:{name}");

        let fluid_ids = [
            gid("velocity-a"),
            gid("velocity-b"),
            gid("density-a"),
            gid("density-b"),
            gid("divergence"),
            gid("pressure-a"),
            gid("pressure-b"),
            // One scratch field shared by both MacCormack advections:
            // velocity is corrected at the top of the frame and density
            // at the bottom, so the forward result never has to survive
            // across the two.
            gid("advect-tmp"),
        ];
        let riders_id = rid("riders");
        let tile_counts_id = tid("tile-counts");
        let tile_indices_id = tid("tile-indices");
        let shadow_dim = params.shadow_dim;
        let shadow_cells = u64::from(shadow_dim)
            .saturating_mul(u64::from(shadow_dim))
            .saturating_mul(u64::from(shadow_dim));
        let sid = |name: &str| format!("{prefix}:s{shadow_dim}:{name}");
        let shadow_acc_id = sid("shadow-acc");
        let shadow_depth_id = sid("shadow-depth");
        let buffers_missing = self
            .renderer
            .as_ref()
            .map(|renderer| {
                fluid_ids
                    .iter()
                    .chain(std::iter::once(&riders_id))
                    .chain(std::iter::once(&tile_counts_id))
                    .chain(std::iter::once(&tile_indices_id))
                    .chain(std::iter::once(&shadow_acc_id))
                    .chain(std::iter::once(&shadow_depth_id))
                    .any(|buffer_id| {
                        !renderer
                            .native_compute_graph_buffers
                            .contains_key(buffer_id)
                    })
            })
            .unwrap_or(true);

        let mut state = graph_layer.smoke_riders_state.clone();
        let reset_buffers = state.grid != params.grid_size
            || state.rider_count != params.rider_count
            || state.tile_count_x != tile_count_x
            || state.tile_count_y != tile_count_y
            || buffers_missing;
        if reset_buffers {
            state = NativeSmokeRidersGraphState::new(
                params.grid_size,
                params.rider_count,
                tile_count_x,
                tile_count_y,
                time,
            );
        }

        let mut dt = if self.render_clock_mode == "manual" {
            self.native_graph_step_delta_this_render
        } else if state.prev_frame_time <= 0.0 {
            1.0 / self.target_fps.max(1) as f32
        } else {
            time - state.prev_frame_time
        };
        // Master time scale — mirrors the TS builder so both paths agree.
        dt = dt.clamp(0.0, 1.0 / 15.0) * params.flow_speed;
        state.prev_frame_time = time;
        state.auto_rot_x_phase += params.auto_rotate_x * dt;
        state.auto_rot_y_phase += params.auto_rotate_y * dt;
        state.auto_rot_z_phase += params.auto_rotate_z * dt;

        let bass_delta = (params.bass - state.prev_bass).max(0.0);
        if bass_delta > 0.05 {
            state.burst_hold_timer = state.burst_hold_timer.max(0.15);
        }
        state.burst_hold_timer = (state.burst_hold_timer - dt).max(0.0);
        state.prev_bass = params.bass;
        let burst_active = state.burst_hold_timer > 0.0;
        // ── CONTINUOUS EMISSION ──────────────────────────────────────
        // Mirrors the TS builders byte for byte. The emitter used to bank
        // dt in an accumulator and dump ONE WHOLE splat the frame it
        // crossed 1/splat_rate. At 60 fps with the default flow_speed
        // (0.32) a frame advances the sim 5.3 ms against a 22.7 ms
        // period, so the field got a lump every FIFTH frame and nothing
        // on the other four — a 12 Hz sawtooth in the glow, which is the
        // jagged flicker. The reset-to-zero also threw the remainder
        // away, realising 37.5 splats/s for a requested 44 and making
        // the realised rate depend on the framerate.
        //
        // Deposit the same mass CONTINUOUSLY instead: every frame
        // carries exactly `dt * splat_rate` of one splat. Nothing in the
        // solve changes; only the source term stops being a pulse train.
        // The cap only exists so a pathological hitch (dt is already
        // clamped to 1/15 s) cannot detonate the field in one frame; at
        // the default rate it sits 17x above the per-frame quota.
        let emit_quota = (dt * params.splat_rate).clamp(0.0, SPLAT_QUOTA_CAP);
        // Buffers were just (re)created and are zero: prime with a full
        // splat so the first frame is not empty.
        let emit_scale = if reset_buffers {
            emit_quota.max(1.0)
        } else {
            emit_quota
        };
        let fire = emit_scale > 0.0;
        let burst_mul = if burst_active {
            2.5 + params.audio_burst
        } else {
            1.0
        };

        // Camera: projection * view * model. The model rotation is baked
        // into viewProj (the volume spins, the camera does not), so the
        // studio rig is rotated into object space when it is packed.
        let aspect = (width as f32 / height as f32).max(0.05);
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

        let cell_count = u64::from(params.grid_size)
            .saturating_mul(u64::from(params.grid_size))
            .saturating_mul(u64::from(params.grid_size));
        let vec4_bytes = cell_count.saturating_mul(16);
        let f32_bytes = cell_count.saturating_mul(4);

        let sim_uniform_id = uid("sim-uniform");
        let vort_uniform_id = uid("vort-uniform");
        let surface_uniform_id = uid("surface-uniform");
        let rider_uniform_id = uid("rider-uniform");
        let bin_uniform_id = uid("bin-uniform");
        let render_uniform_id = uid("render-uniform");
        let shadow_uniform_id = uid("shadow-uniform");
        let emitters_id = uid("emitters");

        let mut buffers = vec![
            NativeComputeGraphBufferSpec {
                id: sim_uniform_id.clone(),
                byte_length: 96,
                kind: NativeComputeBufferBindingKind::Uniform,
                initial_bytes: build_smoke_riders_sim_uniform_bytes(
                    &params,
                    dt,
                    time,
                    emit_scale * burst_mul,
                ),
                persistent: true,
                clear: false,
                indirect: false,
            },
            NativeComputeGraphBufferSpec {
                id: vort_uniform_id.clone(),
                byte_length: 32,
                kind: NativeComputeBufferBindingKind::Uniform,
                initial_bytes: build_smoke_riders_vorticity_uniform_bytes(&params, dt),
                persistent: true,
                clear: false,
                indirect: false,
            },
            NativeComputeGraphBufferSpec {
                id: surface_uniform_id.clone(),
                byte_length: 32,
                kind: NativeComputeBufferBindingKind::Uniform,
                initial_bytes: build_smoke_riders_surface_uniform_bytes(&params, dt),
                persistent: true,
                clear: false,
                indirect: false,
            },
            NativeComputeGraphBufferSpec {
                id: rider_uniform_id.clone(),
                byte_length: 144,
                kind: NativeComputeBufferBindingKind::Uniform,
                initial_bytes: build_smoke_riders_rider_uniform_bytes(&params, dt, time),
                persistent: true,
                clear: false,
                indirect: false,
            },
            NativeComputeGraphBufferSpec {
                id: bin_uniform_id.clone(),
                byte_length: 96,
                kind: NativeComputeBufferBindingKind::Uniform,
                initial_bytes: build_smoke_riders_bin_uniform_bytes(
                    &params,
                    view_proj,
                    tile_count_x,
                    tile_count_y,
                    aspect,
                ),
                persistent: true,
                clear: false,
                indirect: false,
            },
            NativeComputeGraphBufferSpec {
                id: render_uniform_id.clone(),
                byte_length: SMOKE_RIDERS_RENDER_UNIFORM_BYTES as u64,
                kind: NativeComputeBufferBindingKind::Uniform,
                initial_bytes: build_smoke_riders_render_uniform_bytes(
                    &params,
                    inv_view_proj,
                    model,
                    tile_count_x,
                    tile_count_y,
                    self.native_frame_index(),
                    time,
                ),
                persistent: true,
                clear: false,
                indirect: false,
            },
            NativeComputeGraphBufferSpec {
                id: shadow_uniform_id.clone(),
                byte_length: SMOKE_RIDERS_SHADOW_UNIFORM_BYTES as u64,
                kind: NativeComputeBufferBindingKind::Uniform,
                initial_bytes: build_smoke_riders_shadow_uniform_bytes(&params, model),
                persistent: true,
                clear: false,
                indirect: false,
            },
            NativeComputeGraphBufferSpec {
                id: emitters_id.clone(),
                byte_length: (SMOKE_3D_MAX_EMITTERS * 48) as u64,
                kind: NativeComputeBufferBindingKind::StorageRead,
                initial_bytes: build_smoke_riders_emitter_bytes(&params, emit_scale),
                persistent: true,
                clear: false,
                indirect: false,
            },
        ];
        for buffer_id in fluid_ids.iter() {
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
        buffers.push(NativeComputeGraphBufferSpec {
            id: riders_id.clone(),
            byte_length: u64::from(params.rider_count)
                .saturating_mul(SMOKE_RIDERS_STRIDE_FLOATS as u64)
                .saturating_mul(4),
            kind: NativeComputeBufferBindingKind::StorageReadWrite,
            initial_bytes: if reset_buffers {
                build_smoke_riders_initial_rider_bytes(&params)
            } else {
                Vec::new()
            },
            persistent: true,
            clear: reset_buffers,
            indirect: false,
        });
        buffers.push(NativeComputeGraphBufferSpec {
            id: tile_counts_id.clone(),
            byte_length: u64::from(tile_count).saturating_mul(4),
            kind: NativeComputeBufferBindingKind::StorageReadWrite,
            initial_bytes: Vec::new(),
            persistent: true,
            clear: reset_buffers,
            indirect: false,
        });
        buffers.push(NativeComputeGraphBufferSpec {
            id: tile_indices_id.clone(),
            byte_length: u64::from(tile_count)
                .saturating_mul(SMOKE_RIDERS_TILE_CAP as u64)
                .saturating_mul(4),
            kind: NativeComputeBufferBindingKind::StorageReadWrite,
            initial_bytes: Vec::new(),
            persistent: true,
            clear: reset_buffers,
            indirect: false,
        });
        // Light-space opacity volume. `cs_shadow_fluid` stores every cell
        // so no clear pass is needed; the ids carry the edge so changing
        // Shadow Volume reallocates instead of reinterpreting.
        for buffer_id in [&shadow_acc_id, &shadow_depth_id] {
            buffers.push(NativeComputeGraphBufferSpec {
                id: buffer_id.clone(),
                byte_length: shadow_cells.saturating_mul(4),
                kind: NativeComputeBufferBindingKind::StorageReadWrite,
                initial_bytes: Vec::new(),
                persistent: true,
                clear: reset_buffers,
                indirect: false,
            });
        }

        let grid_dispatch = [params.grid_size.div_ceil(4).max(1); 3];
        let rider_dispatch = [params.rider_count.div_ceil(64).max(1), 1, 1];
        let tile_dispatch = [tile_count.div_ceil(64).max(1), 1, 1];
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
                            dispatch: [u32; 3],
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
        let ping = |flip: bool, a: &str, b: &str| if flip { gid(b) } else { gid(a) };
        let mut vel_flip = state.vel_flip;
        let mut den_flip = state.den_flip;
        let mut prs_flip = state.prs_flip;

        if fire {
            add_pass(
                "smoke-riders-splat".to_string(),
                "3d-smoke/splat",
                "cs_splat",
                grid_dispatch,
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
        if params.mac_cormack {
            // Forward advection into the scratch field, then the limited
            // correction. Both stages must see the same scratch buffer.
            let mac_bindings = || {
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
                        ping(vel_flip, "velocity-a", "velocity-b"),
                        NativeComputeBufferBindingKind::StorageRead,
                    ),
                    binding(
                        3,
                        gid("advect-tmp"),
                        NativeComputeBufferBindingKind::StorageReadWrite,
                    ),
                    binding(
                        4,
                        ping(!vel_flip, "velocity-a", "velocity-b"),
                        NativeComputeBufferBindingKind::StorageReadWrite,
                    ),
                ]
            };
            add_pass(
                "smoke-riders-advect-velocity-fwd".to_string(),
                &format!("{shader_prefix}/advect"),
                "cs_advect_fwd",
                grid_dispatch,
                mac_bindings(),
            )?;
            add_pass(
                "smoke-riders-advect-velocity".to_string(),
                &format!("{shader_prefix}/advect"),
                "cs_advect_mc_vel",
                grid_dispatch,
                mac_bindings(),
            )?;
        } else {
            add_pass(
                "smoke-riders-advect-velocity".to_string(),
                "3d-smoke/advect-velocity",
                "cs_advect_vel",
                grid_dispatch,
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
        }
        vel_flip = !vel_flip;
        // Vorticity confinement lands BEFORE the projection solve so the
        // injected swirl is made divergence-free with everything else.
        add_pass(
            "smoke-riders-vorticity".to_string(),
            &format!("{shader_prefix}/vorticity"),
            "cs_vorticity",
            grid_dispatch,
            vec![
                binding(
                    0,
                    vort_uniform_id.clone(),
                    NativeComputeBufferBindingKind::Uniform,
                ),
                binding(
                    1,
                    ping(vel_flip, "velocity-a", "velocity-b"),
                    NativeComputeBufferBindingKind::StorageRead,
                ),
                binding(
                    2,
                    ping(!vel_flip, "velocity-a", "velocity-b"),
                    NativeComputeBufferBindingKind::StorageReadWrite,
                ),
            ],
        )?;
        vel_flip = !vel_flip;
        // Surface tension + shear-thinning viscosity, also upstream of
        // the projection so the interface force comes out divergence-free.
        add_pass(
            "smoke-riders-surface-tension".to_string(),
            &format!("{shader_prefix}/surface"),
            "cs_surface_tension",
            grid_dispatch,
            vec![
                binding(
                    0,
                    surface_uniform_id.clone(),
                    NativeComputeBufferBindingKind::Uniform,
                ),
                binding(
                    1,
                    ping(den_flip, "density-a", "density-b"),
                    NativeComputeBufferBindingKind::StorageRead,
                ),
                binding(
                    2,
                    ping(vel_flip, "velocity-a", "velocity-b"),
                    NativeComputeBufferBindingKind::StorageRead,
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
            "smoke-riders-divergence".to_string(),
            "3d-smoke/divergence",
            "cs_divergence",
            grid_dispatch,
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
                    gid("divergence"),
                    NativeComputeBufferBindingKind::StorageReadWrite,
                ),
            ],
        )?;
        // Warm start: scale last frame's pressure down instead of
        // restarting from it verbatim (or from zero). One bandwidth-bound
        // pass worth roughly triple the Jacobi sweeps it precedes.
        add_pass(
            "smoke-riders-pressure-warm".to_string(),
            &format!("{shader_prefix}/pressure"),
            "cs_pressure_warm",
            [(cell_count as u32).div_ceil(64).max(1), 1, 1],
            vec![
                binding(
                    0,
                    vort_uniform_id.clone(),
                    NativeComputeBufferBindingKind::Uniform,
                ),
                binding(
                    1,
                    ping(prs_flip, "pressure-a", "pressure-b"),
                    NativeComputeBufferBindingKind::StorageReadWrite,
                ),
            ],
        )?;
        for iteration in 0..params.pressure_iterations {
            add_pass(
                format!("smoke-riders-jacobi-{}", iteration + 1),
                "3d-smoke/jacobi",
                "cs_jacobi",
                grid_dispatch,
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
                        gid("divergence"),
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
            "smoke-riders-subtract-gradient".to_string(),
            "3d-smoke/subtract-gradient",
            "cs_subtract_grad",
            grid_dispatch,
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
        if params.mac_cormack {
            let mac_bindings = || {
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
                        gid("advect-tmp"),
                        NativeComputeBufferBindingKind::StorageReadWrite,
                    ),
                    binding(
                        4,
                        ping(!den_flip, "density-a", "density-b"),
                        NativeComputeBufferBindingKind::StorageReadWrite,
                    ),
                ]
            };
            add_pass(
                "smoke-riders-advect-density-fwd".to_string(),
                &format!("{shader_prefix}/advect"),
                "cs_advect_fwd",
                grid_dispatch,
                mac_bindings(),
            )?;
            add_pass(
                "smoke-riders-advect-density".to_string(),
                &format!("{shader_prefix}/advect"),
                "cs_advect_mc_den",
                grid_dispatch,
                mac_bindings(),
            )?;
        } else {
            add_pass(
                "smoke-riders-advect-density".to_string(),
                "3d-smoke/advect-density",
                "cs_advect_den",
                grid_dispatch,
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
        }
        den_flip = !den_flip;

        // THE COUPLING: riders read the final divergence-free velocity,
        // the final density and the pressure field the projection solved.
        add_pass(
            "smoke-riders-riders".to_string(),
            &format!("{shader_prefix}/riders"),
            "cs_riders",
            rider_dispatch,
            vec![
                binding(
                    0,
                    rider_uniform_id.clone(),
                    NativeComputeBufferBindingKind::Uniform,
                ),
                binding(
                    1,
                    riders_id.clone(),
                    NativeComputeBufferBindingKind::StorageReadWrite,
                ),
                binding(
                    2,
                    ping(vel_flip, "velocity-a", "velocity-b"),
                    NativeComputeBufferBindingKind::StorageRead,
                ),
                binding(
                    3,
                    ping(den_flip, "density-a", "density-b"),
                    NativeComputeBufferBindingKind::StorageRead,
                ),
                binding(
                    4,
                    ping(prs_flip, "pressure-a", "pressure-b"),
                    NativeComputeBufferBindingKind::StorageRead,
                ),
            ],
        )?;
        let tile_bindings = || {
            vec![
                binding(
                    0,
                    bin_uniform_id.clone(),
                    NativeComputeBufferBindingKind::Uniform,
                ),
                binding(
                    1,
                    riders_id.clone(),
                    NativeComputeBufferBindingKind::StorageRead,
                ),
                binding(
                    2,
                    tile_counts_id.clone(),
                    NativeComputeBufferBindingKind::StorageReadWrite,
                ),
                binding(
                    3,
                    tile_indices_id.clone(),
                    NativeComputeBufferBindingKind::StorageReadWrite,
                ),
            ]
        };
        add_pass(
            "smoke-riders-clear-tiles".to_string(),
            &format!("{shader_prefix}/tiles"),
            "cs_clear_tiles",
            tile_dispatch,
            tile_bindings(),
        )?;
        add_pass(
            "smoke-riders-bin-riders".to_string(),
            &format!("{shader_prefix}/tiles"),
            "cs_bin_riders",
            rider_dispatch,
            tile_bindings(),
        )?;

        // ── LIGHT-SPACE OCCLUSION VOLUME. Runs last, on the FINAL density
        //    and the FINAL rider positions, so what casts is exactly what
        //    renders. fluid (gather + clear) -> riders (atomic scatter)
        //    -> prefix sum along the light axis.
        let shadow_bindings = || {
            vec![
                binding(
                    0,
                    shadow_uniform_id.clone(),
                    NativeComputeBufferBindingKind::Uniform,
                ),
                binding(
                    1,
                    ping(den_flip, "density-a", "density-b"),
                    NativeComputeBufferBindingKind::StorageRead,
                ),
                binding(
                    2,
                    riders_id.clone(),
                    NativeComputeBufferBindingKind::StorageRead,
                ),
                binding(
                    3,
                    shadow_acc_id.clone(),
                    NativeComputeBufferBindingKind::StorageReadWrite,
                ),
                binding(
                    4,
                    shadow_depth_id.clone(),
                    NativeComputeBufferBindingKind::StorageReadWrite,
                ),
            ]
        };
        add_pass(
            "smoke-riders-shadow-fluid".to_string(),
            &format!("{shader_prefix}/shadowvol"),
            "cs_shadow_fluid",
            [(shadow_cells as u32).div_ceil(64).max(1), 1, 1],
            shadow_bindings(),
        )?;
        add_pass(
            "smoke-riders-shadow-riders".to_string(),
            &format!("{shader_prefix}/shadowvol"),
            "cs_shadow_riders",
            rider_dispatch,
            shadow_bindings(),
        )?;
        add_pass(
            "smoke-riders-shadow-prefix".to_string(),
            &format!("{shader_prefix}/shadowvol"),
            "cs_shadow_prefix",
            [
                (shadow_dim * shadow_dim).div_ceil(64).max(1),
                1,
                1,
            ],
            shadow_bindings(),
        )?;

        state.grid = params.grid_size;
        state.rider_count = params.rider_count;
        state.tile_count_x = tile_count_x;
        state.tile_count_y = tile_count_y;
        state.vel_flip = vel_flip;
        state.den_flip = den_flip;
        state.prs_flip = prs_flip;

        let render_shader_id = &format!("{shader_prefix}/render");
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
            binding(2, riders_id, NativeComputeBufferBindingKind::StorageRead),
            binding(
                3,
                tile_counts_id,
                NativeComputeBufferBindingKind::StorageRead,
            ),
            binding(
                4,
                tile_indices_id,
                NativeComputeBufferBindingKind::StorageRead,
            ),
            binding(
                5,
                shadow_depth_id.clone(),
                NativeComputeBufferBindingKind::StorageRead,
            ),
        ];
        let render_layout_sig = native_graph_binding_layout_signature(&render_bindings);
        let render_plan = NativeComputeGraphRenderPlan {
            name: "smoke-riders-unified".to_string(),
            cache_key: format!(
                "graph-render:{render_shader_id}:{render_hash}:vs_main:fs_main:{}:{}:nodepth:read:{}:{render_layout_sig}",
                NativeComputeGraphRenderBlend::Alpha.signature(),
                NativeComputeGraphPrimitiveTopology::TriangleList.signature(),
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
            NativeGraphLayerState::SmokeRiders(state),
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
