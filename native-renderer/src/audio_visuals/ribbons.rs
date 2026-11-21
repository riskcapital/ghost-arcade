//! Ribbon Field: long flat ribbons that trace a curl-noise flow in 3D. Each
//! ribbon keeps a ring of its last positions (with its width, side vector and
//! heat at that moment), so the ribbon is one continuous lit surface, not a
//! row of dots. Band levels drive thickness and speed; onsets of a ribbon's
//! band kink its path and spin its twist. CPU side: params, palettes, the
//! per-band kick state machine and the uniform (`wgsl/ribbon_field.wgsl`).

use serde_json::Value;

use super::audio_data::{AudioVisualData, OnsetEvent};
use super::controls2::{
    AudioConditioner, AudioControls, AudioFrame, CameraControls, CameraKind, CommonDefaults, MotionClock, ParamDef, Reader,
    audio_controls, camera_controls, common_defs, finish_floats, orbit_camera3, palette_with_overrides, post_from, resets,
    slider,
};
use super::hdr_post::HdrPostSettings;
use super::kit::{Camera, glow_tint, palette_floats, palette_named, pick};
use super::params::Palette3;

pub const RIBBON_HEAD_BYTES: u64 = 64;
pub const RIBBON_POINT_BYTES: u64 = 32;
pub const MAX_RIBBONS: u32 = 2048;
pub const MAX_RIBBON_POINTS: u32 = 256;
/// A kick's twist spin lasts this long.
pub const KICK_SECONDS: f32 = 0.6;

/// Silk palettes: `mid` is the front face, `fringe` the back face, `core` the
/// sheen that burns on a hit.
pub const RIBBON_PALETTES: &[(&str, Palette3)] = &[
    (
        "obsidian-silk",
        Palette3 { core: [1.0, 0.92, 0.82, 6.0], mid: [1.0, 0.3, 0.07, 0.85], fringe: [0.02, 0.05, 0.17, 0.85] },
    ),
    (
        "glacier-silk",
        Palette3 { core: [0.85, 0.97, 1.0, 6.0], mid: [0.3, 0.72, 1.0, 0.9], fringe: [0.55, 0.06, 0.12, 0.7] },
    ),
    (
        "rose-gold",
        Palette3 { core: [1.0, 0.9, 0.85, 6.0], mid: [1.0, 0.55, 0.45, 0.9], fringe: [0.18, 0.04, 0.16, 0.9] },
    ),
];

pub const RIBBON_PALETTE_NAMES: &[&str] = &["obsidian-silk", "glacier-silk", "rose-gold"];

fn defaults() -> CommonDefaults {
    CommonDefaults {
        camera: CameraKind::Orbit3D,
        quality: "medium",
        fov: 42.0,
        post: HdrPostSettings {
            decay: 0.35,
            zoom: 0.0,
            swirl: 0.0,
            flow: 0.0,
            bloom_strength: 0.7,
            threshold: 1.1,
            split: 0.002,
            exposure: 1.7,
            vignette: 0.4,
            dither: 1.0,
            burn: 0.4,
            tint: [1.0; 3],
        },
        level_band: "level",
        palettes: RIBBON_PALETTE_NAMES,
    }
}

/// Everything a VJ can change on a Ribbon Field layer.
pub fn ribbon_defs() -> Vec<ParamDef> {
    let mut defs = vec![
        resets(slider("ribbons", "Ribbons", "Ribbons", 8.0, MAX_RIBBONS as f32, 1.0, 220.0)),
        resets(slider("length", "Length (points)", "Ribbons", 16.0, MAX_RIBBON_POINTS as f32, 1.0, 160.0)),
        slider("width", "Width", "Ribbons", 0.002, 0.2, 0.001, 0.012),
        slider("widthVariation", "Width variation", "Ribbons", 0.0, 1.0, 0.01, 0.8),
        slider("twist", "Twist", "Ribbons", 0.0, 60.0, 0.1, 3.0),
        slider("kink", "Kink on hits", "Ribbons", 0.0, 1.0, 0.01, 0.3),
        slider("travel", "Travel speed", "Ribbons", 0.0, 4.0, 0.01, 1.1),
        slider("flowScale", "Flow scale", "Ribbons", 0.05, 8.0, 0.01, 0.55),
        slider("flowSpeed", "Flow speed", "Ribbons", 0.0, 4.0, 0.01, 0.08),
        slider("span", "River length", "Ribbons", 0.5, 20.0, 0.01, 4.5),
        slider("sheen", "Sheen", "Ribbons", 0.0, 8.0, 0.01, 1.0),
        slider("fog", "Fog", "Ribbons", 0.0, 4.0, 0.01, 0.28),
    ];
    defs.extend(common_defs(&defaults()));
    defs
}

#[derive(Clone, Debug, PartialEq)]
pub struct RibbonParams {
    pub ribbons: u32,
    pub points: u32,
    pub accum_scale: f32,
    pub palette: Palette3,
    pub speed: f32,
    pub flow_scale: f32,
    pub flow_speed: f32,
    /// Half the length of the river (it runs along x from -span to +span).
    pub span: f32,
    pub width: f32,
    pub width_var: f32,
    pub kink: f32,
    pub twist: f32,
    pub fog: f32,
    pub sheen: f32,
    pub camera: CameraControls,
    pub audio: AudioControls,
    pub finish: [f32; 4],
    pub post: HdrPostSettings,
}

pub fn normalize_ribbon_params(params: &Value) -> RibbonParams {
    let r = Reader::new(params, ribbon_defs());
    let (ribbons, points) = pick(params, [(120u32, 128u32), (220, 160), (420, 200)]);
    let d = defaults();
    let palette = palette_with_overrides(palette_named(RIBBON_PALETTES, params), params);
    RibbonParams {
        ribbons: r.count("ribbons", ribbons),
        points: r.count("length", points),
        accum_scale: 1.0,
        palette,
        speed: r.f("travel"),
        flow_scale: r.f("flowScale"),
        flow_speed: r.f("flowSpeed"),
        span: r.f("span"),
        width: r.f("width"),
        width_var: r.f("widthVariation"),
        kink: r.f("kink"),
        twist: r.f("twist"),
        fog: r.f("fog"),
        sheen: r.f("sheen"),
        camera: camera_controls(params, &d),
        audio: audio_controls(params, &d),
        finish: finish_floats(params, &d),
        post: post_from(params, &d, glow_tint(&palette)),
    }
}

/// One band's kick. Explicit: Idle -> Struck (the frame of the hit gives the
/// kink impulse) -> Spinning (the twist spin fades) -> Idle.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub enum KickPhase {
    #[default]
    Idle,
    Struck { at: f32, strength: f32, seq: u32 },
    Spinning { since: f32, strength: f32, seq: u32 },
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct RibbonKicks {
    pub bands: [KickPhase; 3],
    pub last_seq: u32,
}

impl RibbonKicks {
    pub fn ingest(&mut self, hits: &[(OnsetEvent, f32)]) {
        for (event, born) in hits {
            let band = event.band as usize;
            let strength = event.strength.clamp(0.2, 1.6);
            self.bands[band] = KickPhase::Struck { at: *born, strength, seq: event.seq };
        }
    }

    /// Call once per real frame, after the uniform for the frame was built:
    /// a strike gives its impulse in exactly one frame.
    pub fn step(&mut self, now: f32) {
        for phase in &mut self.bands {
            *phase = match *phase {
                KickPhase::Struck { at, strength, seq } => KickPhase::Spinning { since: at, strength, seq },
                KickPhase::Spinning { since, .. } if now - since > KICK_SECONDS => KickPhase::Idle,
                other => other,
            };
        }
    }

    /// (kink impulse this frame, twist spin, hit seq) for a band.
    pub fn band(&self, band: usize, now: f32) -> [f32; 3] {
        match self.bands[band] {
            KickPhase::Idle => [0.0, 0.0, 0.0],
            KickPhase::Struck { strength, seq, .. } => [strength, strength, seq as f32],
            KickPhase::Spinning { since, strength, seq } => {
                let left = (1.0 - (now - since) / KICK_SECONDS).clamp(0.0, 1.0);
                [0.0, strength * left * left, seq as f32]
            }
        }
    }
}

pub fn ribbon_camera(params: &RibbonParams, time: f32, angles: [f32; 3], aspect: f32) -> Camera {
    // A slow deterministic swing across the river with a gentle rise and fall.
    let sway = params.camera.sway;
    let yaw = 0.55 + 0.21 * sway * (time * 0.05).sin();
    // Rotation about Y swings across the river and back instead of going
    // round: seen end-on the river reads as a tangle.
    let angles = [angles[0], 0.5 * angles[1].sin(), angles[2]];
    let h = 0.7 + 0.25 * sway * (time * 0.13).sin();
    let r = 3.6 * (1.0 + 0.04 * sway * (time * 0.09).sin());
    let eye = [r * yaw.sin(), h, r * yaw.cos()];
    orbit_camera3(eye, [0.0, 0.0, 0.0], 0.05 * sway * (time * 0.07).sin(), &params.camera, angles, aspect, 40.0)
}

/// The ribbon state a layer keeps between frames (all bounded).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct RibbonState {
    pub audio: AudioConditioner,
    pub motion: MotionClock,
    pub kicks: RibbonKicks,
    /// Real simulation steps since the ring buffers were made.
    pub steps: u64,
}

pub struct RibbonFrame {
    pub params: RibbonParams,
    pub uniform: Vec<f32>,
    /// The instrument's own step (0 = do not run the simulation).
    pub step: f32,
}

/// One frame of Ribbon Field's CPU side. `core_dt` 0 is a repeat render.
pub fn ribbon_frame(json: &Value, state: &mut RibbonState, data: &AudioVisualData, size: (u32, u32), core_dt: f32) -> RibbonFrame {
    let params = normalize_ribbon_params(json);
    let step = state.motion.step(json, &params.camera, core_dt);
    let now = state.motion.time;
    let audio = state.audio.step_with(data, &params.audio, now, step, core_dt > 0.0, 6);
    if step > 0.0 {
        state.kicks.ingest(&audio.hits);
        state.steps += 1;
    }
    let uniform = ribbon_uniform(&params, &state.kicks, &audio, state.motion.angles(&params.camera), size, now, step, state.steps);
    if step > 0.0 {
        // A strike's kink impulse is in this frame's uniform; spend it.
        state.kicks.step(now);
    }
    RibbonFrame { params, uniform, step }
}

/// The uniform both ribbon shaders read (`RibbonU`).
#[allow(clippy::too_many_arguments)]
pub fn ribbon_uniform(
    params: &RibbonParams,
    kicks: &RibbonKicks,
    audio: &AudioFrame,
    angles: [f32; 3],
    size: (u32, u32),
    time: f32,
    dt: f32,
    step: u64,
) -> Vec<f32> {
    let (width, height) = size;
    let aspect = width as f32 / height.max(1) as f32;
    let cam = ribbon_camera(params, time, angles, aspect);
    let mut u = cam.floats(params.fog);
    let head = (step % u64::from(params.points)) as f32;
    let filled = step.min(u64::from(params.points)) as f32;
    let k: Vec<[f32; 3]> = (0..3).map(|b| kicks.band(b, time)).collect();
    let l = audio.levels;
    u.extend_from_slice(&[width as f32, height as f32, aspect, params.ribbons as f32]);
    u.extend_from_slice(&[time, dt, head, params.points as f32]);
    u.extend_from_slice(&[filled, params.width, params.kink, params.twist]);
    u.extend_from_slice(&[params.speed, params.flow_scale, params.flow_speed, params.span]);
    u.extend_from_slice(&[l[0], l[1], l[2], l[3]]);
    u.extend_from_slice(&[audio.env[0], audio.env[1], audio.env[2], params.sheen]);
    u.extend_from_slice(&[k[0][0], k[1][0], k[2][0], step as f32]);
    u.extend_from_slice(&[k[0][1], k[1][1], k[2][1], params.width_var]);
    u.extend_from_slice(&[k[0][2], k[1][2], k[2][2], audio.drive]);
    u.extend_from_slice(&palette_floats(&params.palette));
    u
}

#[cfg(test)]
mod tests {
    use super::super::audio_data::OnsetBand;
    use super::super::controls2::probe;
    use super::*;

    #[test]
    fn a_kick_gives_its_impulse_once_then_spins_down() {
        let mut kicks = RibbonKicks::default();
        kicks.bands[1] = KickPhase::Struck { at: 1.0, strength: 1.2, seq: 7 };
        assert_eq!(kicks.band(1, 1.0), [1.2, 1.2, 7.0]);
        kicks.step(1.0);
        let spin = kicks.band(1, 1.1);
        assert_eq!(spin[0], 0.0, "the kink impulse lasts one frame");
        assert!(spin[1] > 0.0 && spin[1] < 1.2);
        kicks.step(1.0 + KICK_SECONDS + 0.01);
        assert_eq!(kicks.bands[1], KickPhase::Idle);
        assert_eq!(kicks.band(1, 2.0), [0.0; 3]);
    }

    #[test]
    fn hits_only_kick_their_own_band() {
        let mut kicks = RibbonKicks::default();
        kicks.ingest(&[(OnsetEvent { time: 2.0, band: OnsetBand::High, strength: 1.0, seq: 3 }, 2.0)]);
        assert!(matches!(kicks.bands[OnsetBand::High as usize], KickPhase::Struck { seq: 3, .. }));
        assert_eq!(kicks.bands[0], KickPhase::Idle);
    }

    #[test]
    fn a_repeat_render_changes_nothing() {
        let mut state = RibbonState::default();
        let data = probe::packet(0.5, 1);
        ribbon_frame(&serde_json::json!({}), &mut state, &data, (1920, 1080), 1.0 / 60.0);
        let before = state.clone();
        let again = ribbon_frame(&serde_json::json!({}), &mut state, &data, (1920, 1080), 0.0);
        assert_eq!(again.step, 0.0);
        assert_eq!(state, before);
    }

    #[test]
    fn uniform_layout_and_ring_head() {
        let params = normalize_ribbon_params(&serde_json::json!({}));
        assert_eq!((params.ribbons, params.points), (220, 160));
        let u = ribbon_uniform(&params, &RibbonKicks::default(), &AudioFrame::default(), [0.0; 3], (1920, 1080), 1.0, 0.016, 130);
        assert_eq!(u.len(), 16 + 4 + 9 * 4 + 12);
        assert_eq!(u[20 + 6], 130.0);
        let high = normalize_ribbon_params(&serde_json::json!({"quality": "high", "ribbons": 1e9}));
        assert_eq!(high.ribbons, MAX_RIBBONS);
        assert_eq!(normalize_ribbon_params(&serde_json::json!({"quality": "low"})).ribbons, 120);
    }

    #[test]
    fn buffers_stay_bounded_at_the_highest_settings() {
        let p = normalize_ribbon_params(&serde_json::json!({"ribbons": 1e9, "length": 1e9}));
        let bytes = u64::from(p.ribbons) * (RIBBON_HEAD_BYTES + u64::from(p.points) * RIBBON_POINT_BYTES);
        assert!(bytes <= 20 * 1024 * 1024, "{bytes}");
    }

    pub fn probe_frame(json: &Value) -> Vec<f32> {
        let mut state = RibbonState::default();
        probe::run(json, |p, data, _t, dt| {
            let f = ribbon_frame(p, &mut state, data, (1920, 1080), dt);
            let mut out = f.uniform;
            out.extend(probe::post_floats(&f.params.post));
            out.extend(f.params.finish);
            out.extend([f.params.ribbons as f32, f.params.points as f32]);
            out
        })
    }

    #[test]
    fn every_param_parses_clamps_and_reaches_the_gpu() {
        probe::check_all("ribbon-field", &ribbon_defs(), probe_frame, &[]);
    }
}
