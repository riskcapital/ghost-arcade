//! Mesh Shatter: a scanned point cloud breaks into rigid shards on drops and
//! strong hits, the shards tumble apart, then re-form. Unlike Cloud Flock
//! (a swarm of free points) every shard moves as one rigid chunk: once per
//! cloud and shard size a compute pass assigns each point to a jittered
//! Voronoi cell (its pivot) and records how close it sits to a crack. Each
//! frame the shards' motion is analytic in a few numbers from the CPU state
//! machine (how far apart, how far turned, how hot the cracks), so there is
//! no per-point simulation state and a repeat render draws the same frame.
//! CPU side: params, palettes, the break state machine and the uniform
//! (`wgsl/shatter_*.wgsl`).

use serde_json::Value;

use super::audio_data::{AudioVisualData, OnsetEvent};
use super::cloud_pulse::model_matrix;
use super::controls2::{
    TRIGGER_SEQ_BASE, AudioConditioner, AudioControls, AudioFrame, CameraControls, CameraKind, CommonDefaults, MotionClock, ParamDef,
    ParamDefault, ParamKind, Reader, audio_controls, camera_controls, common_defs, finish_floats, orbit_camera3,
    palette_with_overrides, post_from, resets, slider,
};
use super::hdr_post::HdrPostSettings;
use super::kit::{glow_tint, hash01, palette_named, pick_or};
use super::params::Palette3;

pub const SHARD_BYTES: u64 = 16;
pub const BREAK_SECONDS: f32 = 0.45;
pub const SHATTER_DATA_VEC4: usize = 24;

/// `core` lights the cracks, `mid` the glints off tumbling shard faces,
/// `fringe` tints the scan.
pub const SHATTER_PALETTES: &[(&str, Palette3)] = &[
    (
        "obsidian-magma",
        Palette3 { core: [1.0, 0.55, 0.15, 6.0], mid: [1.0, 0.62, 0.3, 2.0], fringe: [0.55, 0.6, 0.7, 0.55] },
    ),
    (
        "ice-shard",
        Palette3 { core: [0.6, 0.95, 1.0, 6.0], mid: [0.55, 0.85, 1.0, 2.0], fringe: [0.5, 0.56, 0.64, 0.5] },
    ),
    (
        "gilded",
        Palette3 { core: [1.0, 0.85, 0.45, 6.0], mid: [1.0, 0.78, 0.35, 2.2], fringe: [0.42, 0.36, 0.3, 0.6] },
    ),
];
pub const SHATTER_PALETTE_NAMES: &[&str] = &["obsidian-magma", "ice-shard", "gilded"];

fn defaults() -> CommonDefaults {
    CommonDefaults {
        camera: CameraKind::Orbit3D,
        quality: "low",
        fov: 45.0,
        post: HdrPostSettings {
            decay: 0.12,
            zoom: 0.0,
            swirl: 0.0,
            flow: 0.0,
            bloom_strength: 0.6,
            threshold: 1.0,
            split: 0.0025,
            exposure: 1.0,
            vignette: 0.35,
            dither: 1.0,
            burn: 0.45,
            tint: [1.0; 3],
            contrast: 1.0,
            opacity: 1.0,
        },
        level_band: "level",
        palettes: SHATTER_PALETTE_NAMES,
    }
}

pub fn shatter_defs() -> Vec<ParamDef> {
    let mut defs = vec![
        ParamDef {
            key: "path",
            label: "Point cloud (.ply)",
            group: "Shatter",
            kind: ParamKind::Text,
            default: ParamDefault::Str(""),
            resets: true,
        },
        resets(slider("maxPoints", "Points", "Shatter", 10_000.0, super::ply_reader::CLOUD_MAX_POINTS as f32, 1000.0, 400_000.0)),
        slider("orientX", "Scan orientation X", "Shatter", -180.0, 180.0, 0.5, 0.0),
        slider("orientY", "Scan orientation Y", "Shatter", -180.0, 180.0, 0.5, 0.0),
        slider("orientZ", "Scan orientation Z", "Shatter", -180.0, 180.0, 0.5, 0.0),
        slider("scale", "Scan scale", "Shatter", 0.05, 10.0, 0.01, 1.0),
        slider("shardSize", "Shard size", "Shatter", 0.03, 0.6, 0.001, 0.14),
        slider("explode", "Explode force", "Shatter", 0.0, 4.0, 0.01, 0.15),
        slider("tumble", "Tumble", "Shatter", 0.0, 20.0, 0.01, 2.5),
        slider("hold", "Hold apart (s)", "Shatter", 0.0, 10.0, 0.01, 0.3),
        slider("reform", "Re-form time (s)", "Shatter", 0.1, 10.0, 0.01, 1.0),
        slider("cooldown", "Cooldown (s)", "Shatter", 0.0, 10.0, 0.01, 1.6),
        slider("stagger", "Break spread", "Shatter", 0.0, 4.0, 0.01, 1.5),
        slider("breakThreshold", "Break on hits over", "Shatter", 0.0, 2.0, 0.01, 0.8),
        slider("pointSize", "Point size", "Shatter", 0.3, 8.0, 0.01, 1.3),
        slider("sizeVariation", "Size variation", "Shatter", 0.0, 1.0, 0.01, 0.3),
        slider("crackGlow", "Crack glow", "Shatter", 0.0, 8.0, 0.01, 1.0),
        slider("glint", "Shard glint", "Shatter", 0.0, 8.0, 0.01, 1.0),
        slider("scanGlow", "Scan brightness", "Shatter", 0.0, 4.0, 0.01, 1.0),
    ];
    let mut common = common_defs(&defaults());
    // A shatter breaks on kicks and snares unless asked otherwise.
    for d in &mut common {
        if d.key == "launchBands" {
            d.default = ParamDefault::Str("bass-mid");
        }
    }
    defs.extend(common);
    defs
}

#[derive(Clone, Debug, PartialEq)]
pub struct ShatterParams {
    pub path: String,
    pub max_points: u32,
    pub orient: [f32; 3],
    pub scale: f32,
    pub shard: f32,
    pub explode: f32,
    pub tumble: f32,
    pub hold: f32,
    pub reform: f32,
    pub cooldown: f32,
    pub stagger: f32,
    pub break_threshold: f32,
    pub point_px: f32,
    pub size_var: f32,
    pub crack: f32,
    pub glint: f32,
    pub scan_glow: f32,
    pub palette: Palette3,
    pub camera: CameraControls,
    pub audio: AudioControls,
    pub finish: [f32; 4],
    pub post: HdrPostSettings,
}

pub fn normalize_shatter_params(params: &Value) -> ShatterParams {
    let r = Reader::new(params, shatter_defs());
    let d = defaults();
    let palette = palette_with_overrides(palette_named(SHATTER_PALETTES, params), params);
    let mut audio = audio_controls(params, &d);
    if params.get("launchBands").is_none() {
        audio.launch_mask = 3;
    }
    ShatterParams {
        path: super::ply_reader::scan_path_or_default(params.get("path").or_else(|| params.get("plyPath")).and_then(Value::as_str).unwrap_or("")),
        max_points: r.count("maxPoints", pick_or(params, [400_000u32, 750_000, 1_000_000], 0)),
        orient: [r.f("orientX"), r.f("orientY"), r.f("orientZ")],
        scale: r.f("scale"),
        shard: r.f("shardSize"),
        explode: r.f("explode"),
        tumble: r.f("tumble"),
        hold: r.f("hold"),
        reform: r.f("reform"),
        cooldown: r.f("cooldown"),
        stagger: r.f("stagger"),
        break_threshold: r.f("breakThreshold"),
        point_px: r.f("pointSize"),
        size_var: r.f("sizeVariation"),
        crack: r.f("crackGlow"),
        glint: r.f("glint"),
        scan_glow: r.f("scanGlow"),
        palette,
        camera: camera_controls(params, &d),
        audio,
        finish: finish_floats(params, &d),
        post: post_from(params, &d, glow_tint(&palette)),
    }
}

/// The cloud's state. Explicit, and the shards' spread `amount` is
/// continuous across every change: Intact -> Breaking -> Apart -> Reforming
/// -> Intact; a break while re-forming starts from where the shards are.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub enum ShatterPhase {
    #[default]
    Intact,
    Breaking { since: f32, from: f32 },
    Apart { since: f32 },
    Reforming { since: f32, from: f32 },
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Shatter {
    pub phase: ShatterPhase,
    /// How far each shard has turned (radians times its own rate).
    pub spin: f32,
    pub power: f32,
    pub seed: f32,
    pub last_break: Option<f32>,
    pub breaks: u32,
}

fn ease_out(t: f32) -> f32 {
    let t = t.clamp(0.0, 1.0);
    1.0 - (1.0 - t) * (1.0 - t) * (1.0 - t)
}

fn smoother(t: f32) -> f32 {
    let t = t.clamp(0.0, 1.0);
    t * t * t * (t * (t * 6.0 - 15.0) + 10.0)
}

impl Shatter {
    pub fn amount(&self, now: f32, params: &ShatterParams) -> f32 {
        match self.phase {
            ShatterPhase::Intact => 0.0,
            ShatterPhase::Breaking { since, from } => from + (1.0 - from) * ease_out((now - since) / BREAK_SECONDS),
            ShatterPhase::Apart { .. } => 1.0,
            ShatterPhase::Reforming { since, from } => from * (1.0 - smoother((now - since) / params.reform)),
        }
    }

    /// Break on a hit strong enough, outside the cooldown.
    pub fn hit(&mut self, event: &OnsetEvent, now: f32, params: &ShatterParams) {
        // The Trigger button always breaks; hits must be strong enough and
        // outside the cooldown.
        let forced = event.seq >= TRIGGER_SEQ_BASE;
        if !forced && event.strength < params.break_threshold {
            return;
        }
        if !forced && self.last_break.is_some_and(|last| now - last < params.cooldown) {
            return;
        }
        let from = self.amount(now, params);
        if from <= 0.0 {
            // A fresh break: a new fracture pattern direction.
            self.seed = hash01(event.seq.wrapping_mul(7919).wrapping_add(13));
            self.spin = 0.0;
        }
        // A kick throws hardest, a snare less, a hat least.
        let band = [1.0, 0.75, 0.5][event.band as usize];
        self.power = (event.strength * band).clamp(0.3, 1.8);
        self.last_break = Some(now);
        self.breaks = self.breaks.wrapping_add(1);
        self.phase = ShatterPhase::Breaking { since: now, from };
    }

    pub fn step(&mut self, now: f32, dt: f32, params: &ShatterParams) {
        let amount = self.amount(now, params);
        self.spin += params.tumble * dt * amount;
        self.phase = match self.phase {
            ShatterPhase::Breaking { since, .. } if now - since >= BREAK_SECONDS => ShatterPhase::Apart { since: now },
            ShatterPhase::Apart { since } if now - since >= params.hold => ShatterPhase::Reforming { since: now, from: 1.0 },
            ShatterPhase::Reforming { since, .. } if now - since >= params.reform => {
                self.spin = 0.0;
                ShatterPhase::Intact
            }
            phase => phase,
        };
    }

    /// Crack heat: hot at the break, cooling over a second or so.
    pub fn heat(&self, now: f32) -> f32 {
        self.last_break.map_or(0.0, |t| (-(now - t).max(0.0) * 2.2).exp())
    }
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct ShatterState {
    pub audio: AudioConditioner,
    pub motion: MotionClock,
    pub shatter: Shatter,
    /// Brightness that brings this scan's mean colour to a common level.
    pub scan_gain: f32,
}

pub const SHATTER_DRAWN_BYTES: u64 = 32;

/// A gain that brings a cloud's mean colour (the packed RGBA in each
/// point's `w`) to a common level, so every scan reads alike.
pub fn scan_gain(bytes: &[u8]) -> f32 {
    let floats: &[f32] = bytemuck::cast_slice(bytes);
    let mut sum = 0.0_f64;
    let mut n = 0u32;
    for point in floats.chunks_exact(4).step_by(97) {
        let c = point[3].to_bits().to_le_bytes();
        if c[3] > 5 {
            sum += f64::from(0.2126 * f32::from(c[0]) + 0.7152 * f32::from(c[1]) + 0.0722 * f32::from(c[2])) / 255.0;
            n += 1;
        }
    }
    if n == 0 {
        return 1.0;
    }
    (0.6 / (sum / f64::from(n)) as f32).clamp(0.4, 4.0)
}

pub struct ShatterFrame {
    pub params: ShatterParams,
    pub uniform: Vec<f32>,
    /// How far apart the shards are (0 = whole), for tests and diagnostics.
    #[allow(dead_code)]
    pub amount: f32,
}

pub fn shatter_camera(params: &ShatterParams, time: f32, angles: [f32; 3], aspect: f32) -> super::kit::Camera {
    let sway = params.camera.sway;
    let yaw = 0.5 + 0.35 * sway * (time * 0.08).sin();
    let pitch = 0.2 + 0.05 * sway * (time * 0.11).sin();
    let r = 1.3;
    let eye = [r * pitch.cos() * yaw.sin(), r * pitch.sin(), r * pitch.cos() * yaw.cos()];
    orbit_camera3(eye, [0.0, 0.0, 0.0], 0.0, &params.camera, angles, aspect, 30.0)
}

pub fn shatter_frame(
    json: &Value,
    state: &mut ShatterState,
    data: &AudioVisualData,
    size: (u32, u32),
    points: u32,
    core_dt: f32,
) -> ShatterFrame {
    let params = normalize_shatter_params(json);
    let step = state.motion.step(json, &params.camera, core_dt);
    let now = state.motion.time;
    let audio = state.audio.step_with(data, &params.audio, now, step, core_dt > 0.0, 6);
    if step > 0.0 {
        for (event, _) in &audio.hits {
            state.shatter.hit(event, now, &params);
        }
        state.shatter.step(now, step, &params);
    }
    let amount = state.shatter.amount(now, &params);
    let gain = if state.scan_gain > 0.0 { state.scan_gain } else { 1.0 };
    let uniform = shatter_uniform(&params, &state.shatter, &audio, state.motion.angles(&params.camera), size, points, now, gain);
    ShatterFrame { params, uniform, amount }
}

/// `CloudU` (cloud_common.wgsl) with the shatter block in `data`.
pub fn shatter_uniform(
    params: &ShatterParams,
    shatter: &Shatter,
    audio: &AudioFrame,
    angles: [f32; 3],
    size: (u32, u32),
    points: u32,
    time: f32,
    gain: f32,
) -> Vec<f32> {
    let (width, height) = size;
    let aspect = width as f32 / height.max(1) as f32;
    let cam = shatter_camera(params, time, angles, aspect);
    let model = model_matrix(params.orient, params.scale);
    let mut u: Vec<f32> = cam.view_proj.iter().flatten().copied().collect();
    u.extend(model.iter().flatten().copied());
    let p = &params.palette;
    let density = (points.max(1) as f32 / 500_000.0).sqrt().clamp(0.2, 2.0);
    u.extend_from_slice(&[cam.eye[0], cam.eye[1], cam.eye[2], params.point_px]);
    u.extend_from_slice(&[width as f32, height as f32, aspect, points as f32]);
    u.extend_from_slice(&[0.0, 0.0, 0.0, 0.0]);
    u.extend_from_slice(&[params.scan_glow, 1.0, 1.0 / density, 0.0]);
    u.extend_from_slice(&[cam.forward[0], cam.forward[1], cam.forward[2], 0.0]);
    u.extend_from_slice(&p.fringe);
    u.extend_from_slice(&p.mid);
    u.extend_from_slice(&p.core);
    u.extend_from_slice(&[p.fringe[0], p.fringe[1], p.fringe[2], 0.6]);
    u.extend_from_slice(&[time, audio.levels[3], audio.env[2], 0.0]);
    // look2 (CloudU in cloud_common.wgsl): the block must start at data[0].
    u.extend_from_slice(&[params.size_var, 0.0, 0.0, 0.0]);
    let amount = shatter.amount(time, params);
    let block = [
        amount, shatter.spin, shatter.heat(time), params.explode * shatter.power.max(0.3),
        params.shard, shatter.seed, params.crack, params.glint,
        params.size_var, audio.drive, audio.levels[1], audio.levels[2],
        params.stagger, gain, 0.0, 0.0,
    ];
    u.extend_from_slice(&block);
    u.resize(32 + 11 * 4 + SHATTER_DATA_VEC4 * 4, 0.0);
    u
}

/// The shard pass's own key: re-assign when the cloud or the shard size
/// changes (a live change, not a reset of the motion).
pub fn shard_key(points: u32, shard: f32) -> String {
    format!("{points}:{:.4}", shard)
}

#[cfg(test)]
mod tests {
    use super::super::audio_data::OnsetBand;
    use super::super::controls2::probe;
    use super::*;

    fn params() -> ShatterParams {
        normalize_shatter_params(&serde_json::json!({}))
    }

    fn kick(seq: u32, strength: f32) -> OnsetEvent {
        OnsetEvent { time: 0.0, band: OnsetBand::Bass, strength, seq }
    }

    #[test]
    fn the_uniform_matches_the_shared_cloud_layout() {
        let u = shatter_uniform(&params(), &Shatter::default(), &Default::default(), [0.0; 3], (640, 360), 1000, 0.0, 1.0);
        assert_eq!(u.len(), super::super::cloud_pulse::CLOUD_UNIFORM_FLOATS, "CloudU is 688 bytes");
        assert_eq!(u[32 + 11 * 4 + 13], 1.0, "scan gain lands in data[3].y");
    }

    #[test]
    fn a_break_runs_intact_breaking_apart_reforming_intact() {
        let p = params();
        let mut s = Shatter::default();
        s.hit(&kick(1, 1.5), 0.0, &p);
        assert!(matches!(s.phase, ShatterPhase::Breaking { .. }));
        assert!(s.amount(0.2, &p) > 0.5 && s.amount(0.2, &p) < 1.0);
        s.step(BREAK_SECONDS, 0.016, &p);
        assert!(matches!(s.phase, ShatterPhase::Apart { .. }));
        s.step(BREAK_SECONDS + p.hold, 0.016, &p);
        assert!(matches!(s.phase, ShatterPhase::Reforming { .. }));
        let mid = BREAK_SECONDS + p.hold + p.reform * 0.5;
        assert!(s.amount(mid, &p) > 0.0 && s.amount(mid, &p) < 1.0);
        s.step(BREAK_SECONDS + p.hold + p.reform + 0.01, 0.016, &p);
        assert_eq!(s.phase, ShatterPhase::Intact);
        assert_eq!(s.spin, 0.0, "the shards are home and square again");
    }

    #[test]
    fn weak_hits_and_hits_in_the_cooldown_do_not_break() {
        let p = params();
        let mut s = Shatter::default();
        s.hit(&kick(1, 0.5), 0.0, &p);
        assert_eq!(s.phase, ShatterPhase::Intact);
        s.hit(&kick(2, 1.5), 0.0, &p);
        let breaks = s.breaks;
        s.hit(&kick(3, 1.5), 0.1, &p);
        assert_eq!(s.breaks, breaks, "inside the cooldown");
    }

    #[test]
    fn a_break_while_reforming_continues_from_where_the_shards_are() {
        let p = params();
        let mut s = Shatter::default();
        s.hit(&kick(1, 1.5), 0.0, &p);
        s.step(BREAK_SECONDS, 0.016, &p);
        s.step(BREAK_SECONDS + p.hold, 0.016, &p);
        let t = BREAK_SECONDS + p.hold + p.reform * 0.4;
        let before = s.amount(t, &p);
        let seed = s.seed;
        s.hit(&kick(9, 1.5), t, &p);
        assert!((s.amount(t, &p) - before).abs() < 1e-5, "no jump");
        assert_eq!(s.seed, seed, "the same fracture pattern");
    }

    fn probe_frame(json: &Value) -> Vec<f32> {
        let mut state = ShatterState::default();
        probe::run_for(json, 75, |p, data, _t, dt| {
            let f = shatter_frame(p, &mut state, data, (1920, 1080), 750_000, dt);
            let mut out = f.uniform;
            out.extend(probe::post_floats(&f.params.post));
            out.extend(f.params.finish);
            out.extend([f.params.max_points as f32, f.amount]);
            out
        })
    }

    #[test]
    fn every_param_parses_clamps_and_reaches_the_gpu() {
        // The path is a file, checked by the loader; the rest must all reach the GPU.
        probe::check_all("mesh-shatter", &shatter_defs(), probe_frame, &["path"]);
        assert_eq!(normalize_shatter_params(&serde_json::json!({"path": "/x.ply"})).path, "/x.ply");
    }

    #[test]
    fn scan_gain_brings_dark_and_bright_scans_together() {
        let cloud = |grey: u8| -> Vec<u8> {
            (0..1000)
                .flat_map(|_| {
                    let c = f32::from_bits(u32::from_le_bytes([grey, grey, grey, 255]));
                    [0.0_f32, 0.0, 0.0, c]
                })
                .flat_map(f32::to_le_bytes)
                .collect()
        };
        let dark = scan_gain(&cloud(40));
        let bright = scan_gain(&cloud(200));
        assert!(dark > bright);
        assert!(((40.0 / 255.0) * dark - (200.0 / 255.0) * bright).abs() < 0.1);
    }
}
