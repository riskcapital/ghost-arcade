//! Cloud Pulse: a point cloud (the app's uploaded point cloud asset) lit by
//! waves of light, one family per band, launched by onsets and travelling out
//! by radius, depth or height from an origin. CPU side: params, the wave
//! state machine, the orbit camera and the uniform (`wgsl/cloud_pulse.wgsl`).

use serde_json::Value;

use super::audio_data::{AudioVisualData, H_ENV_HIGH, H_LEVEL, OnsetBand, OnsetEvent};
use super::hdr_post::HdrPostSettings;
use super::controls::{
    AudioControls, Defs, Kind, MotionControls, ParamDef, PostDefaults, QUALITY_OPTIONS, audio_defs, look_defs, motion_defs, post_defs, select,
    slider,
};
use super::params::{CloudPalette, cloud_palette_by_name, num, quality_from};

pub const MAX_WAVES: usize = 24;
pub const MAX_WAVES_PER_BAND: usize = 8;
pub const MAX_LAUNCHES_PER_FRAME: usize = 3;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WaveMetric {
    Radius = 0,
    Depth = 1,
    Height = 2,
}

/// Which cloud instrument a set of params is for (defaults differ).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CloudKind {
    Pulse,
    Flock,
    DepthLights,
}

const PULSE_PALETTES: &[(&str, &str)] = &[("survey", "Survey"), ("ice-and-oxblood", "Ice and Oxblood"), ("thermal", "Thermal")];
const FLOCK_PALETTES: &[(&str, &str)] = &[("nightjar", "Nightjar"), ("starling", "Starling"), ("ember-swarm", "Ember Swarm")];
const DEPTH_PALETTES: &[(&str, &str)] = &[("harbour", "Harbour"), ("glacier", "Glacier")];
const METRIC_OPTIONS: &[(&str, &str)] = &[("radius", "Radius"), ("depth", "Depth"), ("height", "Height")];

/// Every control of a cloud instrument, as the panel shows it.
pub fn cloud_defs(kind: CloudKind) -> Defs {
    let (palettes, palette, base_glow, post, sway) = match kind {
        CloudKind::Pulse => (PULSE_PALETTES, "survey", 0.003,
            PostDefaults { bloom: 0.25, threshold: 1.5, trails: 0.4, drift: 0.0, swirl: 0.0, split: 0.0025 }, 0.0),
        CloudKind::Flock => (FLOCK_PALETTES, "nightjar", 0.012,
            PostDefaults { bloom: 0.25, threshold: 1.5, trails: 0.0, drift: 0.0, swirl: 0.0, split: 0.0 }, 0.0),
        CloudKind::DepthLights => (DEPTH_PALETTES, "harbour", 0.004,
            PostDefaults { bloom: 0.25, threshold: 1.5, trails: 0.4, drift: 0.0, swirl: 0.0, split: 0.0025 }, 4.0),
    };
    let mut d = vec![
        ParamDef { key: "path", label: "Point cloud (.ply)", group: "Scan", kind: Kind::File, resets: true },
        slider("orientX", "Scan orientation X", "Scan", -180.0, 180.0, 1.0, 0.0),
        slider("orientY", "Scan orientation Y", "Scan", -180.0, 180.0, 1.0, 0.0),
        slider("orientZ", "Scan orientation Z", "Scan", -180.0, 180.0, 1.0, 0.0),
        slider("scale", "Scan scale", "Scan", 0.01, 10.0, 0.01, 1.0),
        slider("autoRotateX", "Auto-rotate X (deg/s)", "Camera", -90.0, 90.0, 0.5, 0.0),
        slider("autoRotateY", "Auto-rotate Y (deg/s)", "Camera", -90.0, 90.0, 0.5, 0.0),
        slider("autoRotateZ", "Auto-rotate Z (deg/s)", "Camera", -90.0, 90.0, 0.5, 0.0),
        slider("rotateX", "Rotation X", "Camera", -180.0, 180.0, 1.0, 0.0),
        slider("rotateY", "Rotation Y", "Camera", -180.0, 180.0, 1.0, 0.0),
        slider("rotateZ", "Rotation Z", "Camera", -180.0, 180.0, 1.0, 0.0),
        slider("distance", "Distance", "Camera", 0.05, 10.0, 0.01, 1.15),
        slider("fov", "Field of view", "Camera", 10.0, 120.0, 0.5, 45.0),
        slider("yaw", "Orbit angle", "Camera", -180.0, 180.0, 1.0, 30.0),
        slider("pitch", "Orbit height", "Camera", -89.0, 89.0, 1.0, 14.0),
        slider("orbit", "Orbit speed (deg/s)", "Camera", -90.0, 90.0, 0.5, 4.0),
        slider("sway", "Sway (deg)", "Camera", 0.0, 45.0, 0.5, sway),
        slider("offsetX", "Offset X", "Camera", -2.0, 2.0, 0.01, 0.0),
        slider("offsetY", "Offset Y", "Camera", -2.0, 2.0, 0.01, 0.0),
        slider("offsetZ", "Offset Z", "Camera", -2.0, 2.0, 0.01, 0.0),
        select("quality", "Quality", "Points", QUALITY_OPTIONS, "medium").resetting(),
        slider("pointSize", "Point size (px)", "Points", 0.3, 8.0, 0.05, 1.3),
        slider("sizeVariation", "Size variation", "Points", 0.0, 1.0, 0.01, 0.0),
        slider("opacity", "Opacity", "Points", 0.0, 1.0, 0.01, 1.0),
        slider("baseGlow", "Scan brightness", "Points", 0.0, 0.2, 0.001, base_glow),
        slider("waveGain", "Light gain", "Points", 0.0, 8.0, 0.01, 0.5),
    ];
    match kind {
        CloudKind::Pulse => d.extend([
            select("metric", "Wave travels by", "Waves", METRIC_OPTIONS, "radius"),
            slider("originX", "Origin X", "Waves", -2.0, 2.0, 0.01, 0.0),
            slider("originY", "Origin Y", "Waves", -2.0, 2.0, 0.01, 0.0),
            slider("originZ", "Origin Z", "Waves", -2.0, 2.0, 0.01, 0.0),
            slider("waveSpeed", "Wave speed", "Waves", 0.02, 8.0, 0.01, 0.75),
            slider("waveWidth", "Wave width", "Waves", 0.002, 1.0, 0.001, 0.006),
            slider("wake", "Wake falloff", "Waves", 0.1, 3.0, 0.01, 0.7),
            slider("maxWaves", "Waves per band", "Waves", 1.0, 8.0, 1.0, 8.0),
            slider("reach", "Reach", "Waves", 0.2, 20.0, 0.01, 1.2),
            slider("twinkle", "Twinkle", "Waves", 0.0, 4.0, 0.01, 0.6),
            slider("displacement", "Ripple", "Waves", 0.0, 0.5, 0.001, 0.012),
        ]),
        CloudKind::Flock => d.extend(super::flock::flock_defs()),
        CloudKind::DepthLights => d.extend(super::depth_lights::depth_light_defs()),
    }
    d.extend(look_defs(palettes, palette, [1.0, 0.92, 0.78], [0.16, 0.09, 0.05]));
    d.extend(post_defs(post));
    d.extend(audio_defs());
    d.extend(motion_defs());
    let mut defs = Defs(d);
    if kind == CloudKind::Flock {
        // Kicks scatter the flock: bass hits by default.
        for def in defs.0.iter_mut().filter(|def| def.key == "hitsFrom") {
            if let Kind::Select(options, _) = def.kind {
                def.kind = Kind::Select(options, "bass");
            }
        }
    }
    defs
}

#[derive(Clone, Debug, PartialEq)]
pub struct CloudPulseParams {
    pub accum_scale: f32,
    /// The PLY to read, and how many of its points (spread over the file).
    pub path: String,
    pub max_points: u32,
    pub metric: WaveMetric,
    pub palette: CloudPalette,
    pub origin: [f32; 3],
    /// Units per second, per band (bass, mid, high).
    pub speed: [f32; 3],
    pub width: [f32; 3],
    /// Strength lost per second.
    pub fade: [f32; 3],
    pub wake: f32,
    pub max_per_band: usize,
    pub reach: f32,
    pub point_px: f32,
    pub size_variation: f32,
    pub base_glow: f32,
    pub wave_gain: f32,
    pub exposure: f32,
    pub displacement: f32,
    pub twinkle: f32,
    pub yaw: f32,
    pub pitch: f32,
    pub sway: f32,
    pub distance: f32,
    pub fov: f32,
    pub orbit: f32,
    pub target: [f32; 3],
    pub orient: [f32; 3],
    pub rotate: [f32; 3],
    pub auto_rotate: [f32; 3],
    pub scale: f32,
    /// Depth Lights: the level a light needs before it starts to come on.
    pub light_threshold: f32,
    pub audio: AudioControls,
    pub motion: MotionControls,
    pub post: HdrPostSettings,
}

pub fn normalize_cloud_params(params: &Value, kind: CloudKind) -> CloudPulseParams {
    let d = cloud_defs(kind);
    let n = |key: &str| d.num(params, key);
    let (budget, scale) = quality_from(params, [400_000, 750_000, 1_000_000, 2_000_000]);
    let metric = if kind == CloudKind::Pulse {
        match d.choice(params, "metric") {
            "depth" => WaveMetric::Depth,
            "height" => WaveMetric::Height,
            _ => WaveMetric::Radius,
        }
    } else {
        WaveMetric::Radius
    };
    let pulse = |key: &str, fallback: f32| if kind == CloudKind::Pulse { n(key) } else { fallback };
    let speed = pulse("waveSpeed", 0.75);
    let width = pulse("waveWidth", 0.006);
    // The older array form of the scan orientation still loads.
    let legacy_orient = params.get("orient").and_then(Value::as_array).map(|v| {
        let at = |i: usize| v.get(i).and_then(Value::as_f64).unwrap_or(0.0) as f32;
        [at(0), at(1), at(2)]
    });
    let orient_axis = |key: &str, i: usize| {
        if params.get(key).is_none() && let Some(o) = legacy_orient { o[i].clamp(-180.0, 180.0) } else { n(key) }
    };
    let mut palette = cloud_palette_by_name(d.choice(params, "palette"));
    if d.flag(params, "customColors") {
        let a = d.rgb(params, "colorA");
        let b = d.rgb(params, "colorB");
        palette.high = [a[0], a[1], a[2], palette.high[3]];
        palette.mid = [b[0], b[1], b[2], palette.mid[3]];
    }
    let light_threshold = if kind == CloudKind::DepthLights { n("lightThreshold") } else { 0.12 };
    CloudPulseParams {
        accum_scale: scale,
        path: params
            .get("path")
            .or_else(|| params.get("plyPath"))
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        max_points: num(params, "maxPoints", budget as f32)
            .round()
            .clamp(10_000.0, super::ply_reader::CLOUD_MAX_POINTS as f32) as u32,
        metric,
        palette,
        origin: if kind == CloudKind::Pulse { [n("originX"), n("originY"), n("originZ")] } else { [0.0; 3] },
        // Bass rolls slow and wide, highs flick fast and thin.
        speed: [speed * 0.8, speed, speed * 1.35],
        width: [width * 1.6, width, width * 0.55],
        fade: [1.2, 1.6, 2.2],
        wake: pulse("wake", 0.7),
        max_per_band: pulse("maxWaves", 8.0).round() as usize,
        reach: pulse("reach", 1.2),
        point_px: n("pointSize"),
        size_variation: n("sizeVariation"),
        base_glow: n("baseGlow"),
        wave_gain: n("waveGain"),
        exposure: n("intensity"),
        displacement: pulse("displacement", 0.012),
        twinkle: pulse("twinkle", 0.6),
        yaw: n("yaw").to_radians(),
        pitch: n("pitch").to_radians(),
        sway: n("sway").to_radians(),
        distance: n("distance"),
        fov: n("fov").to_radians(),
        orbit: n("orbit").to_radians(),
        target: [n("offsetX"), n("offsetY"), n("offsetZ")],
        orient: [orient_axis("orientX", 0), orient_axis("orientY", 1), orient_axis("orientZ", 2)],
        rotate: [n("rotateX"), n("rotateY"), n("rotateZ")],
        auto_rotate: [n("autoRotateX"), n("autoRotateY"), n("autoRotateZ")],
        scale: n("scale"),
        light_threshold,
        audio: AudioControls::read(&d, params),
        motion: MotionControls::read(&d, params),
        post: HdrPostSettings {
            decay: n("trails"),
            zoom: n("drift"),
            swirl: n("swirl"),
            flow: 0.0,
            bloom_strength: n("bloom"),
            threshold: n("bloomThreshold"),
            split: n("split"),
            exposure: n("exposure"),
            vignette: num(params, "vignette", 0.35).clamp(0.0, 1.0),
            dither: 1.0,
            tint: [1.0, 1.0, 1.0],
            burn: num(params, "burn", 0.45).clamp(0.0, 1.0),
            contrast: n("contrast"),
            opacity: n("opacity"),
        },
    }
}

/// Cloud Pulse's params (tests).
#[cfg(test)]
pub fn normalize_cloud_pulse_params(params: &Value) -> CloudPulseParams {
    normalize_cloud_params(params, CloudKind::Pulse)
}

/// One travelling wave. Explicit life: Travelling until it leaves the cloud
/// or fades out, then it is dropped.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Wave {
    pub band: OnsetBand,
    pub born: f32,
    pub strength: f32,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct WaveQueue {
    pub waves: Vec<Wave>,
    pub last_seq: u32,
    /// Live cap per band (0 = MAX_WAVES_PER_BAND).
    pub max_per_band: usize,
}

impl WaveQueue {
    pub fn ingest(&mut self, data: &AudioVisualData, now: f32, band_mask: u32) {
        if !data.active() {
            return;
        }
        // The audio controls already kept only the chosen bands' hits.
        let mut fresh = data.events_after(self.last_seq, MAX_LAUNCHES_PER_FRAME * 2);
        fresh.retain(|event| band_mask & (1 << event.band as u32) != 0);
        let skip = fresh.len().saturating_sub(MAX_LAUNCHES_PER_FRAME);
        fresh.drain(..skip);
        if let Some(last) = data.event(0) {
            self.last_seq = self.last_seq.max(last.seq);
        }
        for event in fresh {
            let age = (data.time() - event.time).clamp(0.0, 0.5);
            self.launch(&event, now - age);
        }
    }

    pub fn launch(&mut self, event: &OnsetEvent, born: f32) {
        let band_count = self.waves.iter().filter(|w| w.band == event.band).count();
        let cap = if self.max_per_band == 0 { MAX_WAVES_PER_BAND } else { self.max_per_band.min(MAX_WAVES_PER_BAND) };
        if band_count >= cap || self.waves.len() >= MAX_WAVES {
            // Drop the oldest of this band (or of all, if the band has none).
            let victim = self
                .waves
                .iter()
                .position(|w| w.band == event.band)
                .filter(|_| band_count > 0)
                .unwrap_or(0);
            self.waves.remove(victim);
        }
        self.waves.push(Wave { band: event.band, born, strength: event.strength.clamp(0.2, 2.0) });
    }

    pub fn radius(params: &CloudPulseParams, wave: &Wave, now: f32) -> f32 {
        (now - wave.born).max(0.0) * params.speed[wave.band as usize]
    }

    pub fn strength(params: &CloudPulseParams, wave: &Wave, now: f32) -> f32 {
        wave.strength * (-(now - wave.born).max(0.0) * params.fade[wave.band as usize]).exp()
    }

    pub fn step(&mut self, params: &CloudPulseParams, now: f32) {
        self.waves.retain(|wave| {
            wave.born <= now + 0.1 && Self::radius(params, wave, now) < params.reach && Self::strength(params, wave, now) > 0.01
        });
    }
}

type Mat4 = [[f32; 4]; 4];

fn mat_mul(a: &Mat4, b: &Mat4) -> Mat4 {
    // Column-major: m[col][row].
    let mut out = [[0.0; 4]; 4];
    for (c, column) in out.iter_mut().enumerate() {
        for (r, cell) in column.iter_mut().enumerate() {
            *cell = (0..4).map(|k| a[k][r] * b[c][k]).sum();
        }
    }
    out
}

fn sub(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

fn cross(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

fn dot3(a: [f32; 3], b: [f32; 3]) -> f32 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

fn norm(a: [f32; 3]) -> [f32; 3] {
    let len = dot3(a, a).sqrt().max(1e-8);
    [a[0] / len, a[1] / len, a[2] / len]
}

pub struct OrbitCamera {
    pub eye: [f32; 3],
    pub forward: [f32; 3],
    pub view_proj: Mat4,
}

/// Right-handed look-at, depth 0..1 (wgpu clip space).
pub fn orbit_camera(params: &CloudPulseParams, time: f32, aspect: f32) -> OrbitCamera {
    let yaw = params.yaw + params.orbit * time;
    let (sy, cy) = yaw.sin_cos();
    // Sway: the camera drifts slowly up and down.
    let (sp, cp) = (params.pitch + params.sway * (time * 0.11).sin()).clamp(-1.55, 1.55).sin_cos();
    let t = params.target;
    let eye = [t[0] + params.distance * cp * sy, t[1] + params.distance * sp, t[2] + params.distance * cp * cy];
    let f = norm(sub(t, eye));
    let s = norm(cross(f, [0.0, 1.0, 0.0]));
    let u = cross(s, f);
    let view: Mat4 = [
        [s[0], u[0], -f[0], 0.0],
        [s[1], u[1], -f[1], 0.0],
        [s[2], u[2], -f[2], 0.0],
        [-dot3(s, eye), -dot3(u, eye), dot3(f, eye), 1.0],
    ];
    let near = (params.distance * 0.01).max(0.001);
    let far = params.distance * 20.0 + 10.0;
    let g = 1.0 / (params.fov * 0.5).tan();
    let proj: Mat4 = [
        [g / aspect.max(1e-3), 0.0, 0.0, 0.0],
        [0.0, g, 0.0, 0.0],
        [0.0, 0.0, far / (near - far), -1.0],
        [0.0, 0.0, near * far / (near - far), 0.0],
    ];
    OrbitCamera { eye, forward: f, view_proj: mat_mul(&proj, &view) }
}

/// Orientation (degrees, X then Y then Z) and uniform scale for the scan.
pub fn model_matrix(orient_deg: [f32; 3], scale: f32) -> Mat4 {
    let [rx, ry, rz] = orient_deg.map(f32::to_radians);
    let (sx, cx) = rx.sin_cos();
    let (sy, cy) = ry.sin_cos();
    let (sz, cz) = rz.sin_cos();
    let mx: Mat4 = [[1.0, 0.0, 0.0, 0.0], [0.0, cx, sx, 0.0], [0.0, -sx, cx, 0.0], [0.0, 0.0, 0.0, 1.0]];
    let my: Mat4 = [[cy, 0.0, -sy, 0.0], [0.0, 1.0, 0.0, 0.0], [sy, 0.0, cy, 0.0], [0.0, 0.0, 0.0, 1.0]];
    let mz: Mat4 = [[cz, sz, 0.0, 0.0], [-sz, cz, 0.0, 0.0], [0.0, 0.0, 1.0, 0.0], [0.0, 0.0, 0.0, 1.0]];
    let s: Mat4 = [[scale, 0.0, 0.0, 0.0], [0.0, scale, 0.0, 0.0], [0.0, 0.0, scale, 0.0], [0.0, 0.0, 0.0, 1.0]];
    mat_mul(&mz, &mat_mul(&my, &mat_mul(&mx, &s)))
}

/// Floats in the instrument-specific block at the end of `CloudU`
/// (`data: array<vec4<f32>, 24>`): waves for Cloud Pulse, depth slice levels
/// for Depth Lights, flock forces for Cloud Flock.
pub const CLOUD_DATA_FLOATS: usize = MAX_WAVES * 4;
pub const CLOUD_UNIFORM_FLOATS: usize = 32 + 11 * 4 + CLOUD_DATA_FLOATS;

/// The view half of `CloudU`, shared by every cloud instrument, followed by
/// the instrument's own block. `audio_w` is the fourth float of the audio
/// vec4 (wave count for Cloud Pulse).
#[allow(clippy::too_many_arguments)]
pub fn cloud_view_uniform(
    params: &CloudPulseParams,
    data: &AudioVisualData,
    width: u32,
    height: u32,
    point_count: u32,
    time: f32,
    audio_w: f32,
    block: &[f32],
) -> Vec<f32> {
    let aspect = width as f32 / height.max(1) as f32;
    let camera = orbit_camera(params, time, aspect);
    // Manual rotation plus auto-rotation, applied after the scan's own
    // orientation (which fixes its up axis).
    let turn = [0, 1, 2].map(|i| params.rotate[i] + params.auto_rotate[i] * time);
    let model = mat_mul(&model_matrix(turn, 1.0), &model_matrix(params.orient, params.scale));
    let mut u = Vec::with_capacity(CLOUD_UNIFORM_FLOATS);
    for column in camera.view_proj.iter().chain(model.iter()) {
        u.extend_from_slice(column);
    }
    let p = &params.palette;
    // Fewer points draw brighter each, so a sparse cloud is not dimmer.
    let density = (point_count as f32 / 500_000.0).sqrt().clamp(0.2, 2.0);
    u.extend_from_slice(&[camera.eye[0], camera.eye[1], camera.eye[2], params.point_px]);
    u.extend_from_slice(&[width as f32, height as f32, aspect, point_count as f32]);
    u.extend_from_slice(&[params.origin[0], params.origin[1], params.origin[2], params.metric as u32 as f32]);
    u.extend_from_slice(&[params.base_glow, params.wave_gain, params.exposure / density, params.displacement]);
    u.extend_from_slice(&[camera.forward[0], camera.forward[1], camera.forward[2], params.twinkle]);
    u.extend_from_slice(&p.bass);
    u.extend_from_slice(&p.mid);
    u.extend_from_slice(&p.high);
    u.extend_from_slice(&p.base);
    u.extend_from_slice(&[time, data.header(H_LEVEL), data.header(H_ENV_HIGH), audio_w]);
    u.extend_from_slice(&[params.size_variation, params.wake, params.light_threshold, 0.0]);
    u.extend_from_slice(&block[..block.len().min(CLOUD_DATA_FLOATS)]);
    u.resize(CLOUD_UNIFORM_FLOATS, 0.0);
    u
}

#[allow(clippy::too_many_arguments)]
pub fn cloud_uniform(
    params: &CloudPulseParams,
    queue: &WaveQueue,
    data: &AudioVisualData,
    width: u32,
    height: u32,
    point_count: u32,
    time: f32,
) -> Vec<f32> {
    let waves = queue.waves.len().min(MAX_WAVES);
    let mut block = Vec::with_capacity(CLOUD_DATA_FLOATS);
    for wave in queue.waves.iter().take(MAX_WAVES) {
        block.extend_from_slice(&[
            WaveQueue::radius(params, wave, time),
            params.width[wave.band as usize],
            WaveQueue::strength(params, wave, time),
            wave.band as u32 as f32,
        ]);
    }
    cloud_view_uniform(params, data, width, height, point_count, time, waves as f32, &block)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn event(seq: u32, band: OnsetBand) -> OnsetEvent {
        OnsetEvent { time: 0.0, band, strength: 1.0, seq }
    }

    #[test]
    fn waves_travel_fade_and_leave_the_cloud() {
        let params = normalize_cloud_pulse_params(&serde_json::json!({ "waveSpeed": 1.0, "reach": 1.0 }));
        let mut queue = WaveQueue::default();
        queue.launch(&event(1, OnsetBand::Mid), 0.0);
        let wave = queue.waves[0];
        assert!((WaveQueue::radius(&params, &wave, 0.5) - 0.5).abs() < 1e-5);
        assert!(WaveQueue::strength(&params, &wave, 0.5) < 1.0);
        queue.step(&params, 0.9);
        assert_eq!(queue.waves.len(), 1);
        queue.step(&params, 1.01);
        assert!(queue.waves.is_empty(), "past the reach");
    }

    #[test]
    fn band_filter_launches_only_the_chosen_bands() {
        let mut floats = vec![0.0_f32; crate::audio_visuals::audio_data::AV_TOTAL_FLOATS];
        floats[0] = 1.0;
        floats[1] = 1.0;
        floats[2] = 1.0;
        floats[3] = 3.0;
        for (i, band) in [0.0_f32, 1.0, 2.0].iter().enumerate() {
            let at = 16 + i * 4;
            floats[at..at + 4].copy_from_slice(&[0.9, *band, 1.0, (3 - i) as f32]);
        }
        let mut data = AudioVisualData::default();
        data.set_from_bytes(bytemuck::cast_slice(&floats)).unwrap();
        let mut queue = WaveQueue::default();
        queue.ingest(&data, 5.0, 4);
        assert_eq!(queue.waves.len(), 1);
        assert_eq!(queue.waves[0].band, OnsetBand::High);
        let mut all = WaveQueue::default();
        all.ingest(&data, 5.0, 7);
        assert_eq!(all.waves.len(), 3);
        assert_eq!(all.last_seq, 3);
    }

    #[test]
    fn each_band_keeps_its_own_bounded_family() {
        let mut queue = WaveQueue::default();
        for seq in 0..30 {
            queue.launch(&event(seq + 1, OnsetBand::Bass), seq as f32);
        }
        assert_eq!(queue.waves.len(), MAX_WAVES_PER_BAND);
        queue.launch(&event(100, OnsetBand::High), 40.0);
        assert_eq!(queue.waves.len(), MAX_WAVES_PER_BAND + 1);
        for seq in 0..40 {
            queue.launch(&event(200 + seq, if seq % 2 == 0 { OnsetBand::Mid } else { OnsetBand::High }), 50.0);
        }
        assert!(queue.waves.len() <= MAX_WAVES);
    }

    #[test]
    fn camera_puts_the_target_in_the_middle_of_the_frame() {
        let params = normalize_cloud_pulse_params(&serde_json::json!({ "offsetX": 0.1, "offsetY": 0.2, "offsetZ": -0.3 }));
        let camera = orbit_camera(&params, 0.0, 16.0 / 9.0);
        let m = camera.view_proj;
        let p = [0.1_f32, 0.2, -0.3, 1.0];
        let clip: Vec<f32> = (0..4).map(|r| (0..4).map(|c| m[c][r] * p[c]).sum()).collect();
        assert!(clip[3] > 0.0);
        assert!((clip[0] / clip[3]).abs() < 1e-4 && (clip[1] / clip[3]).abs() < 1e-4);
        let z = clip[2] / clip[3];
        assert!((0.0..1.0).contains(&z), "depth {z}");
    }

    #[test]
    fn uniform_matches_the_shader_layout() {
        let params = normalize_cloud_pulse_params(&serde_json::json!({}));
        let mut queue = WaveQueue::default();
        queue.launch(&event(1, OnsetBand::High), 0.0);
        let u = cloud_uniform(&params, &queue, &AudioVisualData::default(), 1920, 1080, 500_000, 0.1);
        // 2 mat4 + 11 vec4 + 24 waves.
        assert_eq!(u.len(), 32 + 44 + MAX_WAVES * 4);
        assert_eq!(u[32 + 36 + 3], 1.0, "one wave");
        assert!(u[32 + 44] > 0.0, "the wave has left the origin");
    }

    #[test]
    fn model_matrix_rotates_about_x() {
        let m = model_matrix([90.0, 0.0, 0.0], 1.0);
        let y = [0.0_f32, 1.0, 0.0, 1.0];
        let out: Vec<f32> = (0..4).map(|r| (0..4).map(|c| m[c][r] * y[c]).sum()).collect();
        assert!(out[1].abs() < 1e-5 && (out[2] - 1.0).abs() < 1e-5);
    }
}

/// The CPU state of one cloud instrument layer, whichever it is.
#[derive(Clone, Debug, Default)]
pub struct CloudSim {
    pub waves: WaveQueue,
    pub flock: super::flock::FlockState,
    pub slices: super::depth_lights::DepthSlices,
    /// The instrument's own clock: scaled by Speed, held by Freeze.
    pub clock: f32,
    pub shaper: super::controls::AudioShaper,
}

/// One frame of a cloud instrument on the CPU: clock, shaped audio, the
/// manual trigger, the instrument's state machine, and the uniform. Pure,
/// so tests drive it exactly as the job builder does. `dt` is the frame
/// step (0 on a repeat render).
#[allow(clippy::too_many_arguments)]
pub fn step_cloud_frame(
    sim: &mut CloudSim,
    kind: CloudKind,
    params: &CloudPulseParams,
    raw: &Value,
    data: &AudioVisualData,
    dt: f32,
    width: u32,
    height: u32,
    point_count: u32,
) -> Vec<f32> {
    let sim_dt = params.motion.sim_dt(dt);
    sim.clock += sim_dt;
    let now = sim.clock;
    let shaped = sim.shaper.shape(data, &params.audio, sim_dt);
    let fired = sim.shaper.take_trigger(params.audio.trigger);
    match kind {
        CloudKind::Pulse => {
            sim.waves.max_per_band = params.max_per_band;
            if fired {
                for band in [OnsetBand::Bass, OnsetBand::Mid, OnsetBand::High] {
                    sim.waves.launch(&OnsetEvent { time: shaped.time(), band, strength: 1.0, seq: 0 }, now);
                }
            }
            sim.waves.ingest(&shaped, now, params.audio.hits_mask);
            sim.waves.step(params, now);
            cloud_uniform(params, &sim.waves, &shaped, width, height, point_count, now)
        }
        CloudKind::Flock => {
            let flock_params = super::flock::normalize_flock_params(raw);
            if fired {
                sim.flock.trigger(now, &flock_params);
            }
            sim.flock.ingest(&shaped, now, &flock_params);
            sim.flock.step(now, &flock_params);
            let block = sim.flock.block(&shaped, now, sim_dt, &flock_params);
            // The shader reads "displacement" as the speed that reads hot.
            let mut view = params.clone();
            view.displacement = flock_params.heat;
            cloud_view_uniform(&view, &shaped, width, height, point_count, now, 0.0, &block)
        }
        CloudKind::DepthLights => {
            let depth_params = super::depth_lights::normalize_depth_light_params(raw);
            sim.slices.step(&shaped, sim_dt, &depth_params);
            if fired {
                sim.slices.flash();
            }
            // The shader reads "twinkle" as the share of points that are lights.
            let mut view = params.clone();
            view.twinkle = depth_params.light_share;
            let reach = 0.6 * params.scale;
            let block = sim.slices.block(params.distance - reach, params.distance + reach, &depth_params);
            cloud_view_uniform(&view, &shaped, width, height, point_count, now, 0.0, &block)
        }
    }
}
