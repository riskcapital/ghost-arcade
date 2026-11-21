//! Cloud Pulse: a point cloud (the app's uploaded point cloud asset) lit by
//! waves of light, one family per band, launched by onsets and travelling out
//! by radius, depth or height from an origin. CPU side: params, the wave
//! state machine, the orbit camera and the uniform (`wgsl/cloud_pulse.wgsl`).

use serde_json::Value;

use super::audio_data::{AudioVisualData, H_ENV_HIGH, H_LEVEL, OnsetBand, OnsetEvent};
use super::hdr_post::HdrPostSettings;
use super::params::{CloudPalette, cloud_palette_by_name, num, quality_from, text};

pub const MAX_WAVES: usize = 24;
pub const MAX_WAVES_PER_BAND: usize = 8;
pub const MAX_LAUNCHES_PER_FRAME: usize = 3;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WaveMetric {
    Radius = 0,
    Depth = 1,
    Height = 2,
}

#[derive(Clone, Debug, PartialEq)]
pub struct CloudPulseParams {
    pub accum_scale: f32,
    /// Which bands launch waves: bit 0 bass, 1 mid, 2 high.
    pub band_mask: u32,
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
    pub reach: f32,
    pub point_px: f32,
    pub base_glow: f32,
    pub wave_gain: f32,
    pub exposure: f32,
    pub displacement: f32,
    pub twinkle: f32,
    pub yaw: f32,
    pub pitch: f32,
    pub distance: f32,
    pub fov: f32,
    pub orbit: f32,
    pub target: [f32; 3],
    pub orient: [f32; 3],
    pub scale: f32,
    pub post: HdrPostSettings,
}

fn vec3_param(params: &Value, key: &str, fallback: [f32; 3]) -> [f32; 3] {
    let Some(values) = params.get(key).and_then(Value::as_array) else {
        return fallback;
    };
    let mut out = fallback;
    for (slot, value) in out.iter_mut().zip(values.iter()) {
        if let Some(v) = value.as_f64().filter(|v| v.is_finite()) {
            *slot = (v as f32).clamp(-1000.0, 1000.0);
        }
    }
    out
}

pub fn normalize_cloud_pulse_params(params: &Value) -> CloudPulseParams {
    let (budget, scale) = quality_from(params, [400_000, 750_000, 1_000_000, 2_000_000]);
    let metric = match text(params, "metric").as_str() {
        "depth" => WaveMetric::Depth,
        "height" => WaveMetric::Height,
        _ => WaveMetric::Radius,
    };
    let speed = num(params, "waveSpeed", 0.75).clamp(0.02, 8.0);
    let width = num(params, "waveWidth", 0.006).clamp(0.002, 1.0);
    let band_mask = match text(params, "bands").as_str() {
        "bass" => 1,
        "mid" => 2,
        "high" => 4,
        "bass-mid" => 3,
        "mid-high" => 6,
        _ => 7,
    };
    CloudPulseParams {
        accum_scale: scale,
        band_mask,
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
        palette: cloud_palette_by_name(&text(params, "palette")),
        origin: vec3_param(params, "origin", [0.0, 0.0, 0.0]),
        // Bass rolls slow and wide, highs flick fast and thin.
        speed: [speed * 0.8, speed, speed * 1.35],
        width: [width * 1.6, width, width * 0.55],
        fade: [1.2, 1.6, 2.2],
        reach: num(params, "reach", 1.2).clamp(0.2, 20.0),
        point_px: num(params, "pointSize", 1.3).clamp(0.3, 8.0),
        base_glow: num(params, "baseGlow", 0.003).clamp(0.0, 2.0),
        wave_gain: num(params, "waveGain", 0.5).clamp(0.0, 8.0),
        exposure: num(params, "intensity", 1.0).clamp(0.0, 8.0),
        displacement: num(params, "displacement", 0.012).clamp(0.0, 0.5),
        twinkle: num(params, "twinkle", 0.6).clamp(0.0, 4.0),
        yaw: num(params, "yaw", 30.0).to_radians(),
        pitch: num(params, "pitch", 14.0).clamp(-89.0, 89.0).to_radians(),
        distance: num(params, "distance", 1.15).clamp(0.05, 50.0),
        fov: num(params, "fov", 45.0).clamp(10.0, 120.0).to_radians(),
        orbit: num(params, "orbit", 4.0).clamp(-90.0, 90.0).to_radians(),
        target: vec3_param(params, "target", [0.0, 0.0, 0.0]),
        orient: vec3_param(params, "orient", [0.0, 0.0, 0.0]),
        scale: num(params, "scale", 1.0).clamp(0.01, 100.0),
        post: HdrPostSettings {
            decay: num(params, "trails", 0.4).clamp(0.0, 0.97),
            zoom: 0.0,
            swirl: 0.0,
            flow: 0.0,
            bloom_strength: num(params, "bloom", 0.25).clamp(0.0, 4.0),
            threshold: num(params, "bloomThreshold", 1.5).clamp(0.0, 4.0),
            split: num(params, "split", 0.0025).clamp(0.0, 0.03),
            exposure: num(params, "exposure", 1.0).clamp(0.05, 8.0),
            vignette: num(params, "vignette", 0.35).clamp(0.0, 1.0),
            dither: 1.0,
            tint: [1.0, 1.0, 1.0],
            burn: num(params, "burn", 0.45).clamp(0.0, 1.0),
        },
    }
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
}

impl WaveQueue {
    pub fn ingest(&mut self, data: &AudioVisualData, now: f32, band_mask: u32) {
        if !data.active() {
            return;
        }
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
        if band_count >= MAX_WAVES_PER_BAND || self.waves.len() >= MAX_WAVES {
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
    let (sp, cp) = params.pitch.sin_cos();
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
pub const CLOUD_UNIFORM_FLOATS: usize = 32 + 10 * 4 + CLOUD_DATA_FLOATS;

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
    let model = model_matrix(params.orient, params.scale);
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
        let params = normalize_cloud_pulse_params(&serde_json::json!({ "target": [0.1, 0.2, -0.3] }));
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
        // 2 mat4 + 10 vec4 + 24 waves.
        assert_eq!(u.len(), 32 + 40 + MAX_WAVES * 4);
        assert_eq!(u[32 + 36 + 3], 1.0, "one wave");
        assert!(u[32 + 40] > 0.0, "the wave has left the origin");
    }

    #[test]
    fn model_matrix_rotates_about_x() {
        let m = model_matrix([90.0, 0.0, 0.0], 1.0);
        let y = [0.0_f32, 1.0, 0.0, 1.0];
        let out: Vec<f32> = (0..4).map(|r| (0..4).map(|c| m[c][r] * y[c]).sum()).collect();
        assert!(out[1].abs() < 1e-5 && (out[2] - 1.0).abs() < 1e-5);
    }
}
