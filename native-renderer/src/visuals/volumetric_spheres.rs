//! The volumetric spheres visual.

use crate::*;

pub(crate) const VOLUMETRIC_SPHERES_STRIDE_FLOATS: usize = 16;

pub(crate) const VOLUMETRIC_SPHERES_MIN: u32 = 1;

pub(crate) const VOLUMETRIC_SPHERES_MAX: u32 = 1200;

// Mirrored from src/lib/renderer/shaders/webgpuVolumetricSpheresShader.ts.
// These size the graph's buffers and are interpolated into the WGSL, so
// they must not drift from the TS constants of the same name.
pub(crate) const VS_MAX_LINKS: u32 = 8;

pub(crate) const VS_TILE_SIZE: u32 = 16;

pub(crate) const VS_TILE_CAP: u32 = 48;

pub(crate) const VS_EDGE_TILE_CAP: u32 = 64;

pub(crate) const VS_MAX_HITS: u32 = 6;

pub(crate) const VS_GRID_DIM: u32 = 32;

pub(crate) const VS_GRID_CELLS: u64 = 32768;

pub(crate) const VS_GRID_CAP: u32 = 12;

pub(crate) const VS_SHADOW_DIM_MAX: u32 = 80;

pub(crate) const VS_SHADOW_CELLS_MAX: u64 = 512_000;

pub(crate) const VS_SIM_UNIFORM_BYTES: u64 = 112;

pub(crate) const VS_LINK_UNIFORM_BYTES: u64 = 64;

pub(crate) const VS_BIN_UNIFORM_BYTES: u64 = 112;

pub(crate) const VS_SHADOW_UNIFORM_BYTES: u64 = 96;

pub(crate) const VS_RENDER_UNIFORM_BYTES: u64 = 528;

#[derive(Clone, Debug)]
pub(crate) struct NativeVolumetricSpheresGraphState {
    pub(crate) layout_id: u32,
    pub(crate) sphere_count: u32,
    pub(crate) seed_key: String,
    pub(crate) prev_frame_time: f32,
    pub(crate) auto_rot_x_phase: f32,
    pub(crate) auto_rot_y_phase: f32,
    pub(crate) auto_rot_z_phase: f32,
}

impl NativeVolumetricSpheresGraphState {
    pub(crate) fn new(layout_id: u32, sphere_count: u32, seed_key: String, time: f32) -> Self {
        Self {
            layout_id,
            sphere_count,
            seed_key,
            prev_frame_time: time,
            auto_rot_x_phase: 0.0,
            auto_rot_y_phase: 0.0,
            auto_rot_z_phase: 0.0,
        }
    }
}

#[derive(Clone, Debug)]
pub(crate) struct NativeVolumetricSpheresParams {
    pub(crate) geometry_id: u32,
    pub(crate) layout: String,
    pub(crate) layout_id: u32,
    pub(crate) sphere_count: u32,
    pub(crate) radius_scale: f32,
    pub(crate) radius_variance: f32,
    pub(crate) roundness: f32,
    pub(crate) spin_rate: f32,
    pub(crate) spread: f32,
    pub(crate) depth: f32,

    pub(crate) connect_id: u32,
    pub(crate) connect_distance: f32,
    pub(crate) max_links: u32,
    pub(crate) edge_thickness: f32,
    pub(crate) edge_opacity: f32,
    pub(crate) edge_color_id: u32,
    pub(crate) edge_color: [f32; 3],
    pub(crate) edge_fade: f32,

    pub(crate) motion: f32,
    pub(crate) swirl: f32,
    pub(crate) pull: f32,
    pub(crate) chaos: f32,
    pub(crate) damping: f32,
    pub(crate) separation: f32,
    pub(crate) flow_scale: f32,

    pub(crate) color_a: [f32; 3],
    pub(crate) color_b: [f32; 3],
    pub(crate) color_c: [f32; 3],
    pub(crate) color_d: [f32; 3],
    pub(crate) color_cycle: f32,
    pub(crate) saturation: f32,
    pub(crate) brightness: f32,

    pub(crate) opacity: f32,
    pub(crate) roughness: f32,
    pub(crate) metalness: f32,
    pub(crate) diffuse: f32,
    pub(crate) specular: f32,
    pub(crate) reflection: f32,
    pub(crate) clear_coat: f32,
    pub(crate) coat_roughness: f32,
    pub(crate) rim: f32,
    pub(crate) ao_strength: f32,

    pub(crate) light: [f32; 3],
    pub(crate) light_distance: f32,
    pub(crate) light_strength: f32,
    pub(crate) light_color: [f32; 3],
    pub(crate) spot_angle: f32,
    pub(crate) spot_softness: f32,
    pub(crate) light_decay: f32,
    pub(crate) ambient: f32,
    pub(crate) fill_color: [f32; 3],
    pub(crate) fill_strength: f32,
    pub(crate) rim_color: [f32; 3],

    pub(crate) medium_density: f32,
    pub(crate) medium_color: [f32; 3],
    pub(crate) anisotropy: f32,
    pub(crate) medium_height: f32,
    pub(crate) medium_noise: f32,
    pub(crate) shadow_density: f32,
    pub(crate) march_steps: u32,
    pub(crate) shadow_res: u32,
    pub(crate) sphere_hits: u32,

    pub(crate) fog_density: f32,
    pub(crate) fog_color: [f32; 3],
    pub(crate) background_opacity: f32,
    pub(crate) exposure: f32,
    pub(crate) tonemap_id: u32,
    pub(crate) vignette: f32,
    pub(crate) env_strength: f32,

    pub(crate) ground_enabled: bool,
    pub(crate) ground_height: f32,
    pub(crate) ground_color: [f32; 3],
    pub(crate) ground_roughness: f32,

    pub(crate) audio_reactive: bool,
    pub(crate) bass: f32,
    pub(crate) treble: f32,
    pub(crate) bass_pulse: f32,
    pub(crate) treble_sparkle: f32,

    pub(crate) fov_deg: f32,
    pub(crate) camera_z: f32,
    pub(crate) rotate: [f32; 3],
    pub(crate) auto_rotate_x: f32,
    pub(crate) auto_rotate_y: f32,
    pub(crate) auto_rotate_z: f32,
}

pub(crate) fn volumetric_spheres_layout_id(layout: &str) -> u32 {
    match layout.trim().to_ascii_lowercase().as_str() {
        "orbital" => 1,
        "column" => 2,
        "cavern" => 3,
        "lattice" => 4,
        _ => 0,
    }
}

pub(crate) fn volumetric_spheres_layout_label(layout_id: u32) -> &'static str {
    match layout_id {
        1 => "orbital",
        2 => "column",
        3 => "cavern",
        4 => "lattice",
        _ => "cluster",
    }
}

pub(crate) fn volumetric_spheres_geometry_id(params: &Value) -> u32 {
    match params
        .get("geometry")
        .and_then(Value::as_str)
        .unwrap_or("sphere")
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "cube" => 1,
        "rounded" => 2,
        "octahedron" => 3,
        "capsule" => 4,
        "torus" => 5,
        _ => 0,
    }
}

pub(crate) fn volumetric_spheres_connect_id(params: &Value) -> u32 {
    match params
        .get("connectMode")
        .and_then(Value::as_str)
        .unwrap_or("cylinder")
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "off" => 0,
        "line" => 1,
        _ => 2,
    }
}

pub(crate) fn volumetric_spheres_edge_color_id(params: &Value) -> u32 {
    match params
        .get("edgeColorMode")
        .and_then(Value::as_str)
        .unwrap_or("gradient")
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "own" => 0,
        "endpoints" => 1,
        _ => 2,
    }
}

pub(crate) fn volumetric_spheres_tonemap_id(params: &Value) -> u32 {
    match params
        .get("tonemap")
        .and_then(Value::as_str)
        .unwrap_or("agx")
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "aces" => 1,
        "none" => 2,
        _ => 0,
    }
}

pub(crate) fn volumetric_spheres_shadow_res(params: &Value) -> u32 {
    let raw = native_graph_param_numeric(params, "shadowRes").unwrap_or(48.0);
    let n = raw.clamp(16.0, VS_SHADOW_DIM_MAX as f64) as f32;
    let mut best = 32_u32;
    let mut best_d = f32::INFINITY;
    for step in [32_u32, 48, 64, 80] {
        let d = (step as f32 - n).abs();
        if d < best_d {
            best_d = d;
            best = step;
        }
    }
    best
}

pub(crate) fn normalize_volumetric_spheres_native_params(params: &Value) -> NativeVolumetricSpheresParams {
    let layout = params
        .get("layout")
        .and_then(Value::as_str)
        .unwrap_or("cluster")
        .trim()
        .to_ascii_lowercase();
    let layout_id = volumetric_spheres_layout_id(&layout);
    // Projects saved before the PBR rewrite carry `shininess` and no
    // `roughness`; convert instead of snapping every one of them to the
    // new default. Same conversion as the TS normaliser.
    let roughness = if params.get("roughness").is_some() {
        native_graph_param_f32(params, "roughness", 0.03, 1.0, 0.22)
    } else if let Some(sh) = native_graph_param_numeric(params, "shininess") {
        ((2.0 / (sh.max(1.0) + 2.0)).sqrt() as f32).clamp(0.03, 1.0)
    } else {
        0.22
    };
    NativeVolumetricSpheresParams {
        geometry_id: volumetric_spheres_geometry_id(params),
        layout: volumetric_spheres_layout_label(layout_id).to_string(),
        layout_id,
        sphere_count: native_graph_param_u32(
            params,
            "sphereCount",
            VOLUMETRIC_SPHERES_MIN,
            VOLUMETRIC_SPHERES_MAX,
            260,
        ),
        radius_scale: native_graph_param_f32(params, "radiusScale", 0.001, 2.0, 0.058),
        radius_variance: native_graph_param_f32(params, "radiusVariance", 0.0, 4.0, 0.6),
        roundness: native_graph_param_f32(params, "roundness", 0.0, 1.0, 0.45),
        spin_rate: native_graph_param_f32(params, "spinRate", 0.0, 16.0, 0.5),
        spread: native_graph_param_f32(params, "spread", 0.01, 16.0, 1.2),
        depth: native_graph_param_f32(params, "depth", 0.01, 16.0, 1.3),

        connect_id: volumetric_spheres_connect_id(params),
        connect_distance: native_graph_param_f32(params, "connectDistance", 0.01, 8.0, 0.45),
        max_links: native_graph_param_u32(params, "maxLinks", 0, VS_MAX_LINKS, 4),
        edge_thickness: native_graph_param_f32(params, "edgeThickness", 0.0002, 0.5, 0.011),
        edge_opacity: native_graph_param_f32(params, "edgeOpacity", 0.0, 1.0, 0.7),
        edge_color_id: volumetric_spheres_edge_color_id(params),
        edge_color: native_graph_param_rgb(
            params,
            "edgeColor",
            [150.0 / 255.0, 205.0 / 255.0, 1.0],
        ),
        edge_fade: native_graph_param_f32(params, "edgeFade", 0.0, 1.0, 0.55),

        motion: native_graph_param_f32(params, "motion", 0.0, 16.0, 0.7),
        swirl: native_graph_param_f32(params, "swirl", -16.0, 16.0, 0.42),
        pull: native_graph_param_f32(params, "pull", -16.0, 16.0, 0.34),
        chaos: native_graph_param_f32(params, "chaos", 0.0, 16.0, 0.38),
        damping: native_graph_param_f32(params, "damping", 0.0, 32.0, 1.55),
        separation: native_graph_param_f32(params, "separation", 0.0, 8.0, 0.65),
        flow_scale: native_graph_param_f32(params, "flowScale", 0.05, 16.0, 1.15),

        color_a: native_graph_param_rgb(params, "colorA", [70.0 / 255.0, 170.0 / 255.0, 1.0]),
        color_b: native_graph_param_rgb(params, "colorB", [1.0, 78.0 / 255.0, 166.0 / 255.0]),
        color_c: native_graph_param_rgb(params, "colorC", [1.0, 218.0 / 255.0, 94.0 / 255.0]),
        color_d: native_graph_param_rgb(params, "colorD", [84.0 / 255.0, 1.0, 214.0 / 255.0]),
        color_cycle: native_graph_param_f32(params, "colorCycle", -16.0, 16.0, 0.018),
        saturation: native_graph_param_f32(params, "saturation", 0.0, 8.0, 1.3),
        brightness: native_graph_param_f32(params, "brightness", 0.0, 16.0, 1.0),

        opacity: native_graph_param_f32(params, "opacity", 0.0, 1.0, 1.0),
        roughness,
        metalness: native_graph_param_f32(params, "metalness", 0.0, 1.0, 0.15),
        diffuse: native_graph_param_f32(params, "diffuse", 0.0, 8.0, 1.5),
        specular: native_graph_param_f32(params, "specular", 0.0, 16.0, 1.4),
        reflection: native_graph_param_f32(params, "reflection", 0.0, 8.0, 0.45),
        clear_coat: native_graph_param_f32(params, "clearCoat", 0.0, 1.0, 0.4),
        coat_roughness: native_graph_param_f32(params, "coatRoughness", 0.03, 1.0, 0.1),
        rim: native_graph_param_f32(params, "rim", 0.0, 8.0, 0.35),
        ao_strength: native_graph_param_f32(params, "aoStrength", 0.0, 8.0, 0.85),

        light: [
            native_graph_param_f32(params, "lightX", -16.0, 16.0, -0.72),
            native_graph_param_f32(params, "lightY", -16.0, 16.0, 1.22),
            native_graph_param_f32(params, "lightZ", -16.0, 16.0, -0.22),
        ],
        light_distance: native_graph_param_f32(params, "lightDistance", 0.2, 64.0, 5.5),
        light_strength: native_graph_param_f32(params, "lightStrength", 0.0, 32.0, 4.2),
        light_color: native_graph_param_rgb(
            params,
            "lightColor",
            [1.0, 238.0 / 255.0, 214.0 / 255.0],
        ),
        spot_angle: native_graph_param_f32(params, "spotAngle", 2.0, 180.0, 34.0),
        spot_softness: native_graph_param_f32(params, "spotSoftness", 0.005, 2.0, 0.85),
        light_decay: native_graph_param_f32(params, "lightDecay", 0.0, 16.0, 0.5),
        ambient: native_graph_param_f32(params, "ambient", 0.0, 8.0, 0.09),
        fill_color: native_graph_param_rgb(
            params,
            "fillColor",
            [86.0 / 255.0, 122.0 / 255.0, 178.0 / 255.0],
        ),
        fill_strength: native_graph_param_f32(params, "fillStrength", 0.0, 8.0, 0.5),
        rim_color: native_graph_param_rgb(
            params,
            "rimColor",
            [150.0 / 255.0, 200.0 / 255.0, 1.0],
        ),

        medium_density: native_graph_param_f32(params, "mediumDensity", 0.0, 16.0, 0.5),
        medium_color: native_graph_param_rgb(
            params,
            "mediumColor",
            [214.0 / 255.0, 226.0 / 255.0, 1.0],
        ),
        anisotropy: native_graph_param_f32(params, "anisotropy", -0.95, 0.95, 0.55),
        medium_height: native_graph_param_f32(params, "mediumHeight", 0.0, 16.0, 0.2),
        medium_noise: native_graph_param_f32(params, "mediumNoise", 0.0, 4.0, 0.5),
        shadow_density: native_graph_param_f32(params, "shadowDensity", 0.0, 32.0, 6.5),
        march_steps: native_graph_param_u32(params, "marchSteps", 4, 128, 40),
        shadow_res: volumetric_spheres_shadow_res(params),
        sphere_hits: native_graph_param_u32(params, "sphereHits", 1, VS_MAX_HITS, 3),

        fog_density: native_graph_param_f32(params, "fogDensity", 0.0, 16.0, 0.16),
        fog_color: native_graph_param_rgb(
            params,
            "fogColor",
            [12.0 / 255.0, 16.0 / 255.0, 30.0 / 255.0],
        ),
        background_opacity: native_graph_param_f32(params, "backgroundOpacity", 0.0, 1.0, 1.0),
        exposure: native_graph_param_f32(params, "exposure", 0.01, 16.0, 1.05),
        tonemap_id: volumetric_spheres_tonemap_id(params),
        vignette: native_graph_param_f32(params, "vignette", 0.0, 1.0, 0.45),
        env_strength: native_graph_param_f32(params, "envStrength", 0.0, 8.0, 0.6),

        ground_enabled: native_graph_param_bool(params, "groundEnabled", true),
        ground_height: native_graph_param_f32(params, "groundHeight", -16.0, 16.0, -1.55),
        ground_color: native_graph_param_rgb(
            params,
            "groundColor",
            [40.0 / 255.0, 44.0 / 255.0, 54.0 / 255.0],
        ),
        ground_roughness: native_graph_param_f32(params, "groundRoughness", 0.03, 1.0, 0.38),

        audio_reactive: native_graph_param_bool(params, "audioReactive", true),
        bass: native_graph_param_f32(params, "bass", 0.0, 2.0, 0.0),
        treble: native_graph_param_f32(params, "treble", 0.0, 2.0, 0.0),
        bass_pulse: native_graph_param_f32(params, "bassPulse", 0.0, 16.0, 1.05),
        treble_sparkle: native_graph_param_f32(params, "trebleSparkle", 0.0, 16.0, 0.32),

        fov_deg: native_graph_param_f32(params, "fovDeg", 1.0, 160.0, 46.0),
        camera_z: native_graph_param_f32(params, "cameraZ", 0.05, 100.0, 3.8),
        rotate: [
            native_graph_param_f32(params, "rotateX", -3600.0, 3600.0, 10.0),
            native_graph_param_f32(params, "rotateY", -3600.0, 3600.0, 0.0),
            native_graph_param_f32(params, "rotateZ", -3600.0, 3600.0, 0.0),
        ],
        auto_rotate_x: native_graph_param_f32(params, "autoRotateX", -3600.0, 3600.0, 0.0),
        auto_rotate_y: native_graph_param_f32(params, "autoRotateY", -3600.0, 3600.0, 4.0),
        auto_rotate_z: native_graph_param_f32(params, "autoRotateZ", -3600.0, 3600.0, 0.0),
    }
}

/// Everything the graph derives from the params ONCE per frame. The TS
/// twin is `volumetricSpheresScene`; these two must agree or the shadow
/// volume and the link grid stop lining up with what the shader expects.
#[derive(Clone, Debug)]
pub(crate) struct NativeVolumetricSpheresScene {
    pub(crate) bounds: [f32; 3],
    pub(crate) volume_radius: f32,
    pub(crate) grid_dim: [u32; 3],
    pub(crate) grid_cell_count: u32,
    pub(crate) grid_min: [f32; 3],
    pub(crate) cell_size: f32,
    pub(crate) max_edges: u32,
    pub(crate) light_pos: [f32; 3],
    pub(crate) light_dir: [f32; 3],
    pub(crate) sh_u: [f32; 3],
    pub(crate) sh_v: [f32; 3],
    pub(crate) sh_extent: f32,
    pub(crate) sh_depth: f32,
    pub(crate) shadow_dim: u32,
    pub(crate) shadow_cells: u32,
}

pub(crate) fn vs_cross3(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

pub(crate) fn volumetric_spheres_scene(
    params: &NativeVolumetricSpheresParams,
    count: u32,
) -> NativeVolumetricSpheresScene {
    let bounds = [
        (params.spread * 1.24).max(0.2),
        (params.spread * 0.92).max(0.2),
        (params.depth * 1.16).max(0.2),
    ];
    let max_bound = bounds[0].max(bounds[1]).max(bounds[2]);
    let volume_radius = (max_bound * 1.28)
        .max(params.ground_height.abs() * 1.08)
        .max(0.4);

    // The cell must never be smaller than the connect distance — that is
    // the invariant that makes the 27-cell gather in `cs_build_links`
    // complete, and therefore the whole neighbour search O(N).
    let grid_extent = [bounds[0] * 1.06, bounds[1] * 1.06, bounds[2] * 1.06];
    let widest = grid_extent[0].max(grid_extent[1]).max(grid_extent[2]);
    let cell_size = params
        .connect_distance
        .max((2.0 * widest) / VS_GRID_DIM as f32)
        .max(1.0e-3);
    let dim = |half: f32| -> u32 {
        (((2.0 * half) / cell_size).ceil() as i64).clamp(1, VS_GRID_DIM as i64) as u32
    };
    let grid_dim = [dim(grid_extent[0]), dim(grid_extent[1]), dim(grid_extent[2])];
    let grid_min = [-grid_extent[0], -grid_extent[1], -grid_extent[2]];

    let light_axis = native_vec3_normalize(params.light, [-0.62, 1.05, 0.72]);
    let light_pos = [
        light_axis[0] * params.light_distance,
        light_axis[1] * params.light_distance,
        light_axis[2] * params.light_distance,
    ];
    let light_dir = [-light_axis[0], -light_axis[1], -light_axis[2]];
    let up = if light_dir[1].abs() > 0.94 {
        [1.0, 0.0, 0.0]
    } else {
        [0.0, 1.0, 0.0]
    };
    let sh_u = native_vec3_normalize(vs_cross3(up, light_dir), [1.0, 0.0, 0.0]);
    let sh_v = native_vec3_normalize(vs_cross3(light_dir, sh_u), [0.0, 1.0, 0.0]);

    let shadow_dim = params.shadow_res.clamp(8, VS_SHADOW_DIM_MAX);
    NativeVolumetricSpheresScene {
        bounds,
        volume_radius,
        grid_dim,
        grid_cell_count: grid_dim[0] * grid_dim[1] * grid_dim[2],
        grid_min,
        cell_size,
        max_edges: count.saturating_mul(params.max_links.max(1)).max(1),
        light_pos,
        light_dir,
        sh_u,
        sh_v,
        sh_extent: volume_radius * 1.1,
        sh_depth: volume_radius * 2.9,
        shadow_dim,
        shadow_cells: shadow_dim * shadow_dim * shadow_dim,
    }
}

pub(crate) fn volumetric_spheres_seed_key(params: &NativeVolumetricSpheresParams) -> String {
    format!(
        "{}|{}|{:.6}|{:.6}|{:.6}|{:.6},{:.6},{:.6}|{:.6},{:.6},{:.6}|{:.6},{:.6},{:.6}|{:.6},{:.6},{:.6}",
        params.sphere_count,
        params.layout,
        params.radius_variance,
        params.spread,
        params.depth,
        params.color_a[0],
        params.color_a[1],
        params.color_a[2],
        params.color_b[0],
        params.color_b[1],
        params.color_b[2],
        params.color_c[0],
        params.color_c[1],
        params.color_c[2],
        params.color_d[0],
        params.color_d[1],
        params.color_d[2],
    )
}

pub(crate) fn volumetric_spheres_hash(value: f32) -> f32 {
    let x = (value as f64 * 12.9898).sin() * 43758.5453;
    (x - x.floor()) as f32
}

pub(crate) fn volumetric_spheres_random_unit(a: f32, b: f32, c: f32) -> [f32; 3] {
    let theta = a * std::f32::consts::TAU;
    let z = b * 2.0 - 1.0;
    let r = (1.0 - z * z).max(0.0).sqrt();
    let squash = 0.72 + c * 0.36;
    [theta.cos() * r, z * squash, theta.sin() * r]
}

pub(crate) fn build_volumetric_spheres_initial_buffer_bytes(
    params: &NativeVolumetricSpheresParams,
) -> Vec<u8> {
    let sphere_count = params
        .sphere_count
        .clamp(VOLUMETRIC_SPHERES_MIN, VOLUMETRIC_SPHERES_MAX) as usize;
    let mut bytes = vec![0_u8; sphere_count * VOLUMETRIC_SPHERES_STRIDE_FLOATS * 4];
    let colors = [
        params.color_a,
        params.color_b,
        params.color_c,
        params.color_d,
    ];
    for i in 0..sphere_count {
        let seed = volumetric_spheres_hash(i as f32 * 17.13 + 9.7);
        let seed2 = volumetric_spheres_hash(i as f32 * 43.91 + 2.3);
        let seed3 = volumetric_spheres_hash(i as f32 * 71.17 + 5.9);
        let (x, y, z) = match params.layout_id {
            1 => {
                let ring = (i % 5) as f32;
                let a = (i as f32 / sphere_count.max(1) as f32
                    * std::f32::consts::TAU
                    * (2.5 + ring * 0.23))
                    + seed * std::f32::consts::TAU;
                let r = 0.24 + ring * 0.17 + seed2 * 0.18;
                (
                    a.cos() * r,
                    (ring - 2.0) * 0.12 + (seed2 - 0.5) * 0.18,
                    a.sin() * r * (0.74 + seed3 * 0.32),
                )
            }
            2 => {
                let a = seed * std::f32::consts::TAU;
                let r = seed2.powf(0.65) * 0.52;
                (
                    a.cos() * r,
                    (i as f32 / sphere_count.saturating_sub(1).max(1) as f32 - 0.5) * 1.8
                        + (seed3 - 0.5) * 0.18,
                    a.sin() * r * 0.7,
                )
            }
            3 => {
                let dir = volumetric_spheres_random_unit(seed, seed2, seed3);
                let shell = 0.62 + seed.powf(2.0) * 0.3;
                (dir[0] * shell, dir[1] * shell * 0.72, dir[2] * shell)
            }
            4 => {
                // Cube-root packing, so the node graph starts as a readable
                // grid and the connectors immediately draw the lattice.
                let side = ((sphere_count as f64).powf(1.0 / 3.0).ceil() as i64).max(2) as usize;
                let ix = (i % side) as f32;
                let iy = ((i / side) % side) as f32;
                let iz = ((i / (side * side)) % side) as f32;
                let step = 1.6 / (side.saturating_sub(1).max(1)) as f32;
                (
                    (ix * step - 0.8) + (seed - 0.5) * step * 0.22,
                    (iy * step - 0.8) * 0.78 + (seed2 - 0.5) * step * 0.22,
                    (iz * step - 0.8) + (seed3 - 0.5) * step * 0.22,
                )
            }
            _ => {
                let dir = volumetric_spheres_random_unit(seed, seed2, seed3);
                let r = volumetric_spheres_hash(i as f32 * 11.31 + 4.2).powf(0.42);
                (dir[0] * r, dir[1] * r * 0.76, dir[2] * r)
            }
        };
        let radius_jitter = 0.55
            + volumetric_spheres_hash(i as f32 * 29.71 + 1.1).powf(1.8)
                * (0.65 + params.radius_variance * 1.75);
        let color = colors[i % colors.len()];
        // Shoemake's uniform random rotation: unit norm by construction
        // and genuinely uniform over SO(3).
        let qu = volumetric_spheres_hash(i as f32 * 13.51 + 2.2);
        let qa = volumetric_spheres_hash(i as f32 * 5.37 + 0.9) * std::f32::consts::TAU;
        let qb = volumetric_spheres_hash(i as f32 * 8.19 + 3.1) * std::f32::consts::TAU;
        let s1 = (1.0 - qu).max(0.0).sqrt();
        let s2 = qu.max(0.0).sqrt();
        let off = i * VOLUMETRIC_SPHERES_STRIDE_FLOATS;
        write_f32_le(&mut bytes, off, x * params.spread);
        write_f32_le(&mut bytes, off + 1, y * params.spread);
        write_f32_le(&mut bytes, off + 2, z * params.depth);
        write_f32_le(&mut bytes, off + 3, radius_jitter);
        write_f32_le(&mut bytes, off + 4, (seed2 - 0.5) * 0.04);
        write_f32_le(&mut bytes, off + 5, (seed3 - 0.5) * 0.04);
        write_f32_le(&mut bytes, off + 6, (seed - 0.5) * 0.04);
        write_f32_le(&mut bytes, off + 7, seed);
        write_f32_le(&mut bytes, off + 8, color[0]);
        write_f32_le(&mut bytes, off + 9, color[1]);
        write_f32_le(&mut bytes, off + 10, color[2]);
        write_f32_le(&mut bytes, off + 11, (i % 16) as f32);
        write_f32_le(&mut bytes, off + 12, s1 * qa.sin());
        write_f32_le(&mut bytes, off + 13, s1 * qa.cos());
        write_f32_le(&mut bytes, off + 14, s2 * qb.sin());
        write_f32_le(&mut bytes, off + 15, s2 * qb.cos());
    }
    bytes
}

pub(crate) fn build_volumetric_spheres_sim_uniform_bytes(
    params: &NativeVolumetricSpheresParams,
    scene: &NativeVolumetricSpheresScene,
    count: u32,
    dt: f32,
    time: f32,
    bass: f32,
    treble: f32,
) -> Vec<u8> {
    let mut bytes = vec![0_u8; VS_SIM_UNIFORM_BYTES as usize];
    write_f32_le(&mut bytes, 0, dt);
    write_f32_le(&mut bytes, 1, time);
    write_u32_le(&mut bytes, 2, count);
    write_u32_le(&mut bytes, 3, params.layout_id);
    write_f32_le(&mut bytes, 4, scene.bounds[0]);
    write_f32_le(&mut bytes, 5, scene.bounds[1]);
    write_f32_le(&mut bytes, 6, scene.bounds[2]);
    write_f32_le(&mut bytes, 7, params.motion);
    write_f32_le(&mut bytes, 8, params.swirl);
    write_f32_le(&mut bytes, 9, params.pull);
    write_f32_le(&mut bytes, 10, 0.65 + params.chaos * 0.75);
    write_f32_le(&mut bytes, 11, params.damping);
    write_f32_le(&mut bytes, 12, bass);
    write_f32_le(&mut bytes, 13, treble);
    write_f32_le(&mut bytes, 14, params.bass_pulse);
    write_f32_le(&mut bytes, 15, params.chaos);
    write_u32_le(&mut bytes, 16, scene.grid_dim[0]);
    write_u32_le(&mut bytes, 17, scene.grid_dim[1]);
    write_u32_le(&mut bytes, 18, scene.grid_dim[2]);
    write_u32_le(&mut bytes, 19, VS_GRID_CAP);
    write_f32_le(&mut bytes, 20, scene.grid_min[0]);
    write_f32_le(&mut bytes, 21, scene.grid_min[1]);
    write_f32_le(&mut bytes, 22, scene.grid_min[2]);
    write_f32_le(&mut bytes, 23, scene.cell_size);
    write_f32_le(&mut bytes, 24, params.separation);
    write_f32_le(&mut bytes, 25, params.spin_rate);
    write_f32_le(&mut bytes, 26, params.radius_scale);
    write_f32_le(&mut bytes, 27, params.flow_scale);
    bytes
}

pub(crate) fn build_volumetric_spheres_link_uniform_bytes(
    params: &NativeVolumetricSpheresParams,
    scene: &NativeVolumetricSpheresScene,
    count: u32,
) -> Vec<u8> {
    let mut bytes = vec![0_u8; VS_LINK_UNIFORM_BYTES as usize];
    write_u32_le(&mut bytes, 0, count);
    write_u32_le(&mut bytes, 1, VS_GRID_CAP);
    write_u32_le(
        &mut bytes,
        2,
        if params.connect_id == 0 {
            0
        } else {
            params.max_links
        },
    );
    write_u32_le(&mut bytes, 3, scene.max_edges);
    write_u32_le(&mut bytes, 4, scene.grid_dim[0]);
    write_u32_le(&mut bytes, 5, scene.grid_dim[1]);
    write_u32_le(&mut bytes, 6, scene.grid_dim[2]);
    write_u32_le(&mut bytes, 7, scene.grid_cell_count);
    write_f32_le(&mut bytes, 8, scene.grid_min[0]);
    write_f32_le(&mut bytes, 9, scene.grid_min[1]);
    write_f32_le(&mut bytes, 10, scene.grid_min[2]);
    write_f32_le(&mut bytes, 11, scene.cell_size);
    write_f32_le(&mut bytes, 12, params.connect_distance);
    write_f32_le(&mut bytes, 13, params.connect_distance * 0.72);
    write_f32_le(&mut bytes, 14, params.radius_scale);
    write_f32_le(&mut bytes, 15, params.edge_fade);
    bytes
}

pub(crate) fn build_volumetric_spheres_bin_uniform_bytes(
    params: &NativeVolumetricSpheresParams,
    scene: &NativeVolumetricSpheresScene,
    view_proj: [f32; 16],
    tile_count_x: u32,
    tile_count_y: u32,
    count: u32,
    aspect: f32,
) -> Vec<u8> {
    let mut bytes = vec![0_u8; VS_BIN_UNIFORM_BYTES as usize];
    for (index, value) in view_proj.iter().enumerate() {
        write_f32_le(&mut bytes, index, *value);
    }
    write_u32_le(&mut bytes, 16, tile_count_x);
    write_u32_le(&mut bytes, 17, tile_count_y);
    write_u32_le(&mut bytes, 18, VS_TILE_CAP);
    write_u32_le(&mut bytes, 19, count);
    write_u32_le(&mut bytes, 20, VS_EDGE_TILE_CAP);
    write_u32_le(&mut bytes, 21, scene.max_edges);
    write_f32_le(
        &mut bytes,
        22,
        1.0 / (params.fov_deg.to_radians() * 0.5).tan(),
    );
    write_f32_le(&mut bytes, 23, aspect);
    write_f32_le(&mut bytes, 24, params.radius_scale * 1.08);
    write_f32_le(&mut bytes, 25, params.edge_thickness * 1.35);
    write_u32_le(&mut bytes, 26, params.geometry_id);
    write_f32_le(&mut bytes, 27, 0.0);
    bytes
}

pub(crate) fn build_volumetric_spheres_shadow_uniform_bytes(
    params: &NativeVolumetricSpheresParams,
    scene: &NativeVolumetricSpheresScene,
    count: u32,
) -> Vec<u8> {
    let mut bytes = vec![0_u8; VS_SHADOW_UNIFORM_BYTES as usize];
    write_f32_le(&mut bytes, 0, scene.sh_u[0]);
    write_f32_le(&mut bytes, 1, scene.sh_u[1]);
    write_f32_le(&mut bytes, 2, scene.sh_u[2]);
    write_f32_le(&mut bytes, 3, scene.sh_extent);
    write_f32_le(&mut bytes, 4, scene.sh_v[0]);
    write_f32_le(&mut bytes, 5, scene.sh_v[1]);
    write_f32_le(&mut bytes, 6, scene.sh_v[2]);
    write_f32_le(&mut bytes, 7, scene.sh_depth);
    write_f32_le(&mut bytes, 8, scene.light_dir[0]);
    write_f32_le(&mut bytes, 9, scene.light_dir[1]);
    write_f32_le(&mut bytes, 10, scene.light_dir[2]);
    write_u32_le(&mut bytes, 11, scene.shadow_cells);
    write_f32_le(&mut bytes, 12, 0.0);
    write_f32_le(&mut bytes, 13, 0.0);
    write_f32_le(&mut bytes, 14, 0.0);
    write_u32_le(&mut bytes, 15, count);
    write_u32_le(&mut bytes, 16, scene.shadow_dim);
    write_u32_le(&mut bytes, 17, scene.shadow_dim);
    write_u32_le(&mut bytes, 18, scene.shadow_dim);
    write_f32_le(&mut bytes, 19, params.radius_scale);
    write_f32_le(&mut bytes, 20, params.shadow_density);
    write_u32_le(&mut bytes, 21, params.geometry_id);
    write_f32_le(&mut bytes, 22, 0.55);
    write_f32_le(&mut bytes, 23, 0.0);
    bytes
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn build_volumetric_spheres_render_uniform_bytes(
    params: &NativeVolumetricSpheresParams,
    scene: &NativeVolumetricSpheresScene,
    inv_view_proj: [f32; 16],
    camera_pos: [f32; 3],
    tile_count_x: u32,
    tile_count_y: u32,
    count: u32,
    frame_index: u32,
    time: f32,
    bass: f32,
    treble: f32,
) -> Vec<u8> {
    let mut bytes = vec![0_u8; VS_RENDER_UNIFORM_BYTES as usize];
    let spot_cos = (params.spot_angle.min(179.5).to_radians() * 0.5).cos();
    for (index, value) in inv_view_proj.iter().enumerate() {
        write_f32_le(&mut bytes, index, *value);
    }
    write_f32_le(&mut bytes, 16, camera_pos[0]);
    write_f32_le(&mut bytes, 17, camera_pos[1]);
    write_f32_le(&mut bytes, 18, camera_pos[2]);
    write_f32_le(&mut bytes, 19, params.exposure);
    write_f32_le(&mut bytes, 20, scene.light_pos[0]);
    write_f32_le(&mut bytes, 21, scene.light_pos[1]);
    write_f32_le(&mut bytes, 22, scene.light_pos[2]);
    write_f32_le(&mut bytes, 23, params.light_strength * (1.0 + bass * 0.22));
    write_f32_le(&mut bytes, 24, scene.light_dir[0]);
    write_f32_le(&mut bytes, 25, scene.light_dir[1]);
    write_f32_le(&mut bytes, 26, scene.light_dir[2]);
    write_f32_le(&mut bytes, 27, spot_cos);
    write_f32_le(&mut bytes, 28, params.light_color[0]);
    write_f32_le(&mut bytes, 29, params.light_color[1]);
    write_f32_le(&mut bytes, 30, params.light_color[2]);
    write_f32_le(
        &mut bytes,
        31,
        params.spot_softness.min(0.95) * (1.0 - spot_cos) + 0.002,
    );
    write_f32_le(&mut bytes, 32, params.fill_color[0]);
    write_f32_le(&mut bytes, 33, params.fill_color[1]);
    write_f32_le(&mut bytes, 34, params.fill_color[2]);
    write_f32_le(&mut bytes, 35, params.fill_strength);
    write_f32_le(&mut bytes, 36, params.rim_color[0]);
    write_f32_le(&mut bytes, 37, params.rim_color[1]);
    write_f32_le(&mut bytes, 38, params.rim_color[2]);
    write_f32_le(&mut bytes, 39, params.rim);
    write_f32_le(&mut bytes, 40, params.fog_color[0]);
    write_f32_le(&mut bytes, 41, params.fog_color[1]);
    write_f32_le(&mut bytes, 42, params.fog_color[2]);
    write_f32_le(&mut bytes, 43, params.fog_density);
    write_f32_le(&mut bytes, 44, params.fog_color[0]);
    write_f32_le(&mut bytes, 45, params.fog_color[1]);
    write_f32_le(&mut bytes, 46, params.fog_color[2]);
    write_f32_le(&mut bytes, 47, params.background_opacity);
    write_f32_le(&mut bytes, 48, params.color_a[0]);
    write_f32_le(&mut bytes, 49, params.color_a[1]);
    write_f32_le(&mut bytes, 50, params.color_a[2]);
    write_f32_le(&mut bytes, 51, params.color_cycle);
    write_f32_le(&mut bytes, 52, params.color_b[0]);
    write_f32_le(&mut bytes, 53, params.color_b[1]);
    write_f32_le(&mut bytes, 54, params.color_b[2]);
    write_f32_le(&mut bytes, 55, params.saturation);
    write_f32_le(&mut bytes, 56, params.color_c[0]);
    write_f32_le(&mut bytes, 57, params.color_c[1]);
    write_f32_le(&mut bytes, 58, params.color_c[2]);
    write_f32_le(&mut bytes, 59, params.brightness);
    write_f32_le(&mut bytes, 60, params.color_d[0]);
    write_f32_le(&mut bytes, 61, params.color_d[1]);
    write_f32_le(&mut bytes, 62, params.color_d[2]);
    write_f32_le(&mut bytes, 63, params.ambient);
    write_f32_le(&mut bytes, 64, params.ground_color[0]);
    write_f32_le(&mut bytes, 65, params.ground_color[1]);
    write_f32_le(&mut bytes, 66, params.ground_color[2]);
    write_f32_le(&mut bytes, 67, params.ground_height);
    write_f32_le(&mut bytes, 68, params.medium_color[0]);
    write_f32_le(&mut bytes, 69, params.medium_color[1]);
    write_f32_le(&mut bytes, 70, params.medium_color[2]);
    write_f32_le(&mut bytes, 71, params.medium_density);
    write_f32_le(&mut bytes, 72, 0.0);
    write_f32_le(&mut bytes, 73, 0.0);
    write_f32_le(&mut bytes, 74, 0.0);
    write_f32_le(&mut bytes, 75, scene.volume_radius);
    write_f32_le(&mut bytes, 76, scene.sh_u[0]);
    write_f32_le(&mut bytes, 77, scene.sh_u[1]);
    write_f32_le(&mut bytes, 78, scene.sh_u[2]);
    write_f32_le(&mut bytes, 79, scene.sh_extent);
    write_f32_le(&mut bytes, 80, scene.sh_v[0]);
    write_f32_le(&mut bytes, 81, scene.sh_v[1]);
    write_f32_le(&mut bytes, 82, scene.sh_v[2]);
    write_f32_le(&mut bytes, 83, scene.sh_depth);
    write_f32_le(&mut bytes, 84, scene.light_dir[0]);
    write_f32_le(&mut bytes, 85, scene.light_dir[1]);
    write_f32_le(&mut bytes, 86, scene.light_dir[2]);
    write_f32_le(&mut bytes, 87, params.shadow_density);
    write_f32_le(&mut bytes, 88, params.edge_color[0]);
    write_f32_le(&mut bytes, 89, params.edge_color[1]);
    write_f32_le(&mut bytes, 90, params.edge_color[2]);
    write_f32_le(&mut bytes, 91, params.edge_opacity);
    write_u32_le(&mut bytes, 92, tile_count_x);
    write_u32_le(&mut bytes, 93, tile_count_y);
    write_u32_le(&mut bytes, 94, VS_TILE_CAP);
    write_u32_le(&mut bytes, 95, VS_EDGE_TILE_CAP);
    write_u32_le(&mut bytes, 96, count);
    write_u32_le(&mut bytes, 97, scene.max_edges);
    write_u32_le(&mut bytes, 98, params.march_steps);
    write_u32_le(&mut bytes, 99, params.sphere_hits);
    write_u32_le(&mut bytes, 100, scene.shadow_dim);
    write_u32_le(&mut bytes, 101, scene.shadow_dim);
    write_u32_le(&mut bytes, 102, scene.shadow_dim);
    write_u32_le(&mut bytes, 103, frame_index % 4096);
    write_u32_le(&mut bytes, 104, params.geometry_id);
    write_u32_le(&mut bytes, 105, params.connect_id);
    write_u32_le(&mut bytes, 106, params.edge_color_id);
    write_u32_le(&mut bytes, 107, params.tonemap_id);
    write_f32_le(&mut bytes, 108, params.radius_scale);
    write_f32_le(&mut bytes, 109, params.edge_thickness);
    write_f32_le(&mut bytes, 110, params.roughness);
    write_f32_le(&mut bytes, 111, params.metalness);
    write_f32_le(&mut bytes, 112, params.specular);
    write_f32_le(&mut bytes, 113, params.diffuse);
    write_f32_le(&mut bytes, 114, params.reflection);
    write_f32_le(&mut bytes, 115, params.clear_coat);
    write_f32_le(&mut bytes, 116, params.coat_roughness);
    write_f32_le(&mut bytes, 117, params.anisotropy);
    write_f32_le(&mut bytes, 118, params.medium_height);
    write_f32_le(&mut bytes, 119, params.vignette);
    write_f32_le(&mut bytes, 120, params.opacity);
    write_f32_le(&mut bytes, 121, time);
    write_f32_le(&mut bytes, 122, treble);
    write_f32_le(&mut bytes, 123, bass);
    write_f32_le(&mut bytes, 124, params.light_decay);
    write_f32_le(
        &mut bytes,
        125,
        if params.ground_enabled { 1.0 } else { 0.0 },
    );
    write_f32_le(&mut bytes, 126, params.ground_roughness);
    write_f32_le(&mut bytes, 127, params.env_strength);
    write_f32_le(&mut bytes, 128, params.ao_strength);
    write_f32_le(&mut bytes, 129, params.roundness);
    write_f32_le(&mut bytes, 130, params.medium_noise);
    write_f32_le(&mut bytes, 131, params.light_distance);
    bytes
}

impl App {
    pub(crate) fn build_native_volumetric_spheres_graph_job(
        &mut self,
        graph_layer: &NativeGraphLayer,
    ) -> Result<(NativeGraphLayerState, NativeGraphFrameJob), String> {
        let params = normalize_volumetric_spheres_native_params(&graph_layer.params);
        let count = params
            .sphere_count
            .clamp(VOLUMETRIC_SPHERES_MIN, VOLUMETRIC_SPHERES_MAX);
        let scene = volumetric_spheres_scene(&params, count);
        let seed_key = volumetric_spheres_seed_key(&params);
        let time = self.native_graph_time_seconds();
        let source_id = graph_layer.source_id.clone();
        let safe_source = native_graph_buffer_safe_id(&source_id);
        let prefix = format!("volumetric-spheres:{safe_source}");
        let uid = |name: &str| format!("{prefix}:{name}");
        let nid = |name: &str| format!("{prefix}:n{count}:{name}");

        let width = self.pending_width.max(1);
        let height = self.pending_height.max(1);
        let tile_count_x = width.div_ceil(VS_TILE_SIZE).max(1);
        let tile_count_y = height.div_ceil(VS_TILE_SIZE).max(1);
        let tile_count = tile_count_x.saturating_mul(tile_count_y);
        let tid = |name: &str| format!("{prefix}:t{tile_count_x}x{tile_count_y}:{name}");

        let spheres_id = nid("spheres");
        let mut state = graph_layer.volumetric_spheres_state.clone();
        let sphere_buffer_missing = self
            .renderer
            .as_ref()
            .map(|renderer| {
                !renderer
                    .native_compute_graph_buffers
                    .contains_key(&spheres_id)
            })
            .unwrap_or(true);
        let reset_buffers = state.sphere_count != count
            || state.layout_id != params.layout_id
            || state.seed_key != seed_key
            || sphere_buffer_missing;
        if reset_buffers {
            state = NativeVolumetricSpheresGraphState::new(
                params.layout_id,
                count,
                seed_key.clone(),
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
        dt = dt.clamp(0.0, 1.0 / 15.0);
        state.prev_frame_time = time;
        state.auto_rot_x_phase += params.auto_rotate_x * dt;
        state.auto_rot_y_phase += params.auto_rotate_y * dt;
        state.auto_rot_z_phase += params.auto_rotate_z * dt;

        let bass = if params.audio_reactive {
            (params.bass.max(self.audio0[1]).clamp(0.0, 2.0) * params.bass_pulse).min(2.0)
        } else {
            0.0
        };
        let treble = if params.audio_reactive {
            (params.treble.max(self.audio0[3]).clamp(0.0, 2.0) * params.treble_sparkle).min(2.0)
        } else {
            0.0
        };

        // Rays are built in MODEL space, so the auto-spin orbits the
        // camera around a scene whose ground and light stay put.
        let aspect = (width as f32 / height as f32).max(0.05);
        let proj = native_perspective(params.fov_deg, aspect, 0.05, 120.0);
        let view = native_translate(0.0, 0.0, -params.camera_z);
        // Yaw FIRST, then pitch, then roll. The other order spins the pitch
        // axis with the yaw, so an auto-spinning scene rolls its own
        // horizon over.
        let model = native_mat4_mul(
            native_rotate_z((params.rotate[2] + state.auto_rot_z_phase).to_radians()),
            native_mat4_mul(
                native_rotate_x((params.rotate[0] + state.auto_rot_x_phase).to_radians()),
                native_rotate_y((params.rotate[1] + state.auto_rot_y_phase).to_radians()),
            ),
        );
        let view_proj = native_mat4_mul(proj, native_mat4_mul(view, model));
        let inv_view_proj = native_mat4_invert(view_proj);
        let camera_pos = [
            model[2] * params.camera_z,
            model[6] * params.camera_z,
            model[10] * params.camera_z,
        ];

        let sim_uniform_id = uid("sim-uniform");
        let link_uniform_id = uid("link-uniform");
        let bin_uniform_id = uid("bin-uniform");
        let shadow_uniform_id = uid("shadow-uniform");
        let render_uniform_id = uid("render-uniform");
        let grid_counts_id = uid("grid-counts");
        let grid_items_id = uid("grid-items");
        let edges_id = nid("edges");
        let edge_count_id = uid("edge-count");
        let node_tile_counts_id = tid("node-tile-counts");
        let node_tile_items_id = tid("node-tile-items");
        let edge_tile_counts_id = tid("edge-tile-counts");
        let edge_tile_items_id = tid("edge-tile-items");
        let shadow_acc_id = uid("shadow-acc");
        let shadow_depth_id = uid("shadow-depth");

        let storage = |id: &String, byte_length: u64, clear: bool| NativeComputeGraphBufferSpec {
            id: id.clone(),
            byte_length,
            kind: NativeComputeBufferBindingKind::StorageReadWrite,
            initial_bytes: Vec::new(),
            persistent: true,
            clear,
            indirect: false,
        };
        let uniform =
            |id: &String, byte_length: u64, initial_bytes: Vec<u8>| NativeComputeGraphBufferSpec {
                id: id.clone(),
                byte_length,
                kind: NativeComputeBufferBindingKind::Uniform,
                initial_bytes,
                persistent: true,
                clear: false,
                indirect: false,
            };

        let buffers = vec![
            uniform(
                &sim_uniform_id,
                VS_SIM_UNIFORM_BYTES,
                build_volumetric_spheres_sim_uniform_bytes(
                    &params, &scene, count, dt, time, bass, treble,
                ),
            ),
            uniform(
                &link_uniform_id,
                VS_LINK_UNIFORM_BYTES,
                build_volumetric_spheres_link_uniform_bytes(&params, &scene, count),
            ),
            uniform(
                &bin_uniform_id,
                VS_BIN_UNIFORM_BYTES,
                build_volumetric_spheres_bin_uniform_bytes(
                    &params,
                    &scene,
                    view_proj,
                    tile_count_x,
                    tile_count_y,
                    count,
                    aspect,
                ),
            ),
            uniform(
                &shadow_uniform_id,
                VS_SHADOW_UNIFORM_BYTES,
                build_volumetric_spheres_shadow_uniform_bytes(&params, &scene, count),
            ),
            uniform(
                &render_uniform_id,
                VS_RENDER_UNIFORM_BYTES,
                build_volumetric_spheres_render_uniform_bytes(
                    &params,
                    &scene,
                    inv_view_proj,
                    camera_pos,
                    tile_count_x,
                    tile_count_y,
                    count,
                    self.native_frame_index() as u32,
                    time,
                    bass,
                    treble,
                ),
            ),
            NativeComputeGraphBufferSpec {
                id: spheres_id.clone(),
                byte_length: u64::from(count)
                    .saturating_mul(VOLUMETRIC_SPHERES_STRIDE_FLOATS as u64)
                    .saturating_mul(4),
                kind: NativeComputeBufferBindingKind::StorageReadWrite,
                initial_bytes: if reset_buffers {
                    build_volumetric_spheres_initial_buffer_bytes(&params)
                } else {
                    Vec::new()
                },
                persistent: true,
                clear: reset_buffers,
                indirect: false,
            },
            storage(&grid_counts_id, VS_GRID_CELLS * 4, reset_buffers),
            storage(
                &grid_items_id,
                VS_GRID_CELLS * u64::from(VS_GRID_CAP) * 4,
                reset_buffers,
            ),
            storage(&edges_id, u64::from(scene.max_edges) * 16, reset_buffers),
            storage(&edge_count_id, 16, reset_buffers),
            storage(
                &node_tile_counts_id,
                u64::from(tile_count) * 4,
                reset_buffers,
            ),
            storage(
                &node_tile_items_id,
                u64::from(tile_count) * u64::from(VS_TILE_CAP) * 4,
                reset_buffers,
            ),
            storage(
                &edge_tile_counts_id,
                u64::from(tile_count) * 4,
                reset_buffers,
            ),
            storage(
                &edge_tile_items_id,
                u64::from(tile_count) * u64::from(VS_EDGE_TILE_CAP) * 4,
                reset_buffers,
            ),
            storage(&shadow_acc_id, VS_SHADOW_CELLS_MAX * 4, reset_buffers),
            storage(&shadow_depth_id, VS_SHADOW_CELLS_MAX * 4, reset_buffers),
        ];

        let binding =
            |binding: u32, resource_id: String, buffer_kind: NativeComputeBufferBindingKind| {
                NativeComputeGraphBindingSpec {
                    binding,
                    resource_id,
                    kind: NativeComputeGraphBindingKind::Buffer(buffer_kind),
                    source_slot: None,
                }
            };
        let uni = NativeComputeBufferBindingKind::Uniform;
        let ro = NativeComputeBufferBindingKind::StorageRead;
        let rw = NativeComputeBufferBindingKind::StorageReadWrite;
        let sim_bindings = || {
            vec![
                binding(0, spheres_id.clone(), rw),
                binding(1, sim_uniform_id.clone(), uni),
                binding(2, grid_counts_id.clone(), ro),
                binding(3, grid_items_id.clone(), ro),
            ]
        };
        let link_bindings = || {
            vec![
                binding(0, link_uniform_id.clone(), uni),
                binding(1, spheres_id.clone(), ro),
                binding(2, grid_counts_id.clone(), rw),
                binding(3, grid_items_id.clone(), rw),
                binding(4, edges_id.clone(), rw),
                binding(5, edge_count_id.clone(), rw),
            ]
        };
        let bin_bindings = || {
            vec![
                binding(0, bin_uniform_id.clone(), uni),
                binding(1, spheres_id.clone(), ro),
                binding(2, edges_id.clone(), ro),
                binding(3, node_tile_counts_id.clone(), rw),
                binding(4, node_tile_items_id.clone(), rw),
                binding(5, edge_tile_counts_id.clone(), rw),
                binding(6, edge_tile_items_id.clone(), rw),
                binding(7, edge_count_id.clone(), ro),
            ]
        };
        let shadow_bindings = || {
            vec![
                binding(0, shadow_uniform_id.clone(), uni),
                binding(1, spheres_id.clone(), ro),
                binding(2, shadow_acc_id.clone(), rw),
                binding(3, shadow_depth_id.clone(), rw),
            ]
        };

        let sim_shader = "volumetric-spheres/sim";
        let links_shader = "volumetric-spheres/links";
        let tiles_shader = "volumetric-spheres/tiles";
        let shadow_shader = "volumetric-spheres/shadow";
        let render_shader = "volumetric-spheres/render";

        let node_dispatch = [count.div_ceil(64).max(1), 1, 1];
        let links_active = params.connect_id != 0 && params.max_links > 0;
        let mut queued: Vec<(String, &str, &str, [u32; 3], Vec<NativeComputeGraphBindingSpec>)> =
            Vec::new();
        // The sim reads LAST frame's grid, so the grid rebuild has to
        // follow it; that ordering is what keeps separation to one
        // bounded 27-cell gather instead of an O(N²) sweep.
        queued.push((
            "volumetric-spheres-sim".to_string(),
            sim_shader,
            "cs_main",
            node_dispatch,
            sim_bindings(),
        ));
        queued.push((
            "volumetric-spheres-clear-grid".to_string(),
            links_shader,
            "cs_clear_grid",
            [scene.grid_cell_count.div_ceil(64).max(1), 1, 1],
            link_bindings(),
        ));
        queued.push((
            "volumetric-spheres-bin-grid".to_string(),
            links_shader,
            "cs_bin_particles",
            node_dispatch,
            link_bindings(),
        ));
        if links_active {
            queued.push((
                "volumetric-spheres-links".to_string(),
                links_shader,
                "cs_build_links",
                node_dispatch,
                link_bindings(),
            ));
        }
        queued.push((
            "volumetric-spheres-clear-tiles".to_string(),
            tiles_shader,
            "cs_clear_tiles",
            [tile_count.div_ceil(64).max(1), 1, 1],
            bin_bindings(),
        ));
        queued.push((
            "volumetric-spheres-bin-nodes".to_string(),
            tiles_shader,
            "cs_bin_nodes",
            node_dispatch,
            bin_bindings(),
        ));
        if links_active {
            queued.push((
                "volumetric-spheres-bin-edges".to_string(),
                tiles_shader,
                "cs_bin_edges",
                [scene.max_edges.div_ceil(64).max(1), 1, 1],
                bin_bindings(),
            ));
        }
        queued.push((
            "volumetric-spheres-clear-shadow".to_string(),
            shadow_shader,
            "cs_clear_shadow",
            [scene.shadow_cells.div_ceil(64).max(1), 1, 1],
            shadow_bindings(),
        ));
        queued.push((
            "volumetric-spheres-splat-shadow".to_string(),
            shadow_shader,
            "cs_splat_shadow",
            node_dispatch,
            shadow_bindings(),
        ));
        queued.push((
            "volumetric-spheres-prefix-shadow".to_string(),
            shadow_shader,
            "cs_prefix_shadow",
            [
                (scene.shadow_dim * scene.shadow_dim).div_ceil(64).max(1),
                1,
                1,
            ],
            shadow_bindings(),
        ));

        let mut pass_plans = Vec::with_capacity(queued.len());
        for (name, shader_id, entry, dispatch, bindings) in queued {
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
        }

        let (render_hash, render_source) =
            self.native_graph_shader_source(render_shader, "fs_main")?;
        self.native_graph_shader_source(render_shader, "vs_main")?;
        let seq = self.native_frame_index();
        let slot = self.assign_source_frame_slot(&source_id)?;
        let render_bindings = vec![
            binding(0, render_uniform_id, uni),
            binding(1, spheres_id, ro),
            binding(2, edges_id, ro),
            binding(3, node_tile_counts_id, ro),
            binding(4, node_tile_items_id, ro),
            binding(5, edge_tile_counts_id, ro),
            binding(6, edge_tile_items_id, ro),
            binding(7, shadow_depth_id, ro),
            binding(8, edge_count_id, ro),
        ];
        let render_layout_sig = native_graph_binding_layout_signature(&render_bindings);
        let render_plan = NativeComputeGraphRenderPlan {
            name: "volumetric-spheres-render".to_string(),
            cache_key: format!(
                "graph-render:{render_shader}:{render_hash}:vs_main:fs_main:{}:{}:nodepth:{render_layout_sig}",
                NativeComputeGraphRenderBlend::Alpha.signature(),
                NativeComputeGraphPrimitiveTopology::TriangleList.signature(),
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
            NativeGraphLayerState::VolumetricSpheres(state),
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
