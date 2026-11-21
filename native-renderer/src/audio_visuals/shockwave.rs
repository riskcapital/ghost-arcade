//! Shockwave Rings: each kick launches an expanding ring (and a faint shell)
//! of particles with a hot leading edge; snares launch thinner, faster rings.
//! A field of fine dust is pushed aside as a front passes, and the post
//! chain's feedback pass refracts the accumulated picture through every
//! front, so trails and dust bend like light through a lens. CPU side:
//! params, palettes, the ring state machine and the uniform
//! (`wgsl/shockwave_*.wgsl`). Every position is analytic in the ring's age,
//! so there is no simulation state on the GPU at all.

use serde_json::Value;

use super::audio_data::{AudioVisualData, OnsetBand, OnsetEvent};
use super::controls2::{
    AudioConditioner, AudioControls, AudioFrame, CameraControls, CameraKind, CommonDefaults, MotionClock, ParamDef, Reader,
    audio_controls, camera_controls, common_defs, finish_floats, palette_with_overrides, post_from, resets, select, slider,
    toggle, view2_floats,
};
use super::hdr_post::HdrPostSettings;
use super::kit::{glow_tint, hash01, palette_floats, palette_named, pick};
use super::params::Palette3;

pub const MAX_RINGS: usize = 16;
pub const MAX_LAUNCHES_PER_FRAME: usize = 3;
/// After this long a ring stops counting as expanding and fades out.
pub const EXPAND_SECONDS: f32 = 1.8;
pub const FADE_SECONDS: f32 = 0.6;

pub const SHOCK_PALETTES: &[(&str, Palette3)] = &[
    (
        "plasma",
        Palette3 { core: [0.85, 0.95, 1.0, 7.0], mid: [0.1, 0.6, 1.0, 1.8], fringe: [0.3, 0.02, 0.6, 1.2] },
    ),
    (
        "solar",
        Palette3 { core: [1.0, 0.93, 0.78, 7.0], mid: [1.0, 0.42, 0.06, 1.8], fringe: [0.5, 0.02, 0.02, 1.2] },
    ),
    (
        "nacre",
        Palette3 { core: [1.0, 0.97, 0.95, 6.0], mid: [0.55, 0.95, 0.85, 1.4], fringe: [0.6, 0.18, 0.5, 1.0] },
    ),
];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RingLayout {
    /// Every ring from near the centre.
    Center,
    /// Kicks from the centre, snares and hats from points around it.
    Scatter,
}

pub const SHOCK_PALETTE_NAMES: &[&str] = &["plasma", "solar", "nacre"];

fn defaults() -> CommonDefaults {
    CommonDefaults {
        camera: CameraKind::Picture2D,
        fov: 40.0,
        post: HdrPostSettings {
            decay: 0.5,
            zoom: 0.0,
            swirl: 0.0,
            flow: 0.0,
            bloom_strength: 1.0,
            threshold: 0.7,
            split: 0.003,
            exposure: 1.0,
            vignette: 0.35,
            dither: 1.0,
            burn: 0.5,
            tint: [1.0; 3],
        },
        level_band: "bass",
        palettes: SHOCK_PALETTE_NAMES,
    }
}

pub fn shock_defs() -> Vec<ParamDef> {
    let mut defs = vec![
        slider("ringSpeed", "Ring speed", "Rings", 0.1, 8.0, 0.01, 1.0),
        slider("width", "Ring width", "Rings", 0.005, 0.5, 0.001, 0.03),
        slider("reach", "Reach", "Rings", 0.1, 4.0, 0.01, 1.7),
        slider("maxRings", "Max rings", "Rings", 1.0, MAX_RINGS as f32, 1.0, MAX_RINGS as f32),
        slider("refract", "Refraction", "Rings", 0.0, 0.3, 0.001, 0.06),
        slider("chroma", "Refraction colour split", "Rings", 0.0, 2.0, 0.01, 0.12),
        slider("shell", "Ring vs shell", "Rings", 0.0, 1.0, 0.01, 0.12),
        select("layout", "Layout", "Rings", &["center", "scatter"], "center"),
        toggle("highs", "Hats launch rings", "Rings", false),
        resets(slider("particles", "Particles per ring", "Rings", 1024.0, 49152.0, 1.0, 12288.0)),
        slider("particleSize", "Particle size", "Rings", 0.3, 6.0, 0.01, 1.1),
        slider("sizeVariation", "Size variation", "Rings", 0.0, 1.0, 0.01, 0.0),
        slider("streak", "Motion blur", "Rings", 0.0, 0.2, 0.001, 0.017),
        slider("dust", "Dust", "Rings", 0.0, 8.0, 0.01, 1.0),
        slider("push", "Dust push", "Rings", 0.0, 0.5, 0.001, 0.05),
    ];
    defs.extend(common_defs(&defaults()));
    defs
}

#[derive(Clone, Debug, PartialEq)]
pub struct ShockParams {
    pub per_ring: u32,
    pub dust: [u32; 2],
    pub accum_scale: f32,
    pub palette: Palette3,
    pub layout: RingLayout,
    pub highs: bool,
    /// Final radius of a full-strength kick ring (picture heights).
    pub reach: f32,
    pub speed: f32,
    pub width: f32,
    pub max_rings: usize,
    pub brightness: f32,
    pub dust_glow: f32,
    pub push: f32,
    pub refract: f32,
    pub chroma: f32,
    pub shell: f32,
    pub size_px: f32,
    pub size_var: f32,
    pub streak: f32,
    pub camera: CameraControls,
    pub audio: AudioControls,
    pub finish: [f32; 4],
    pub post: HdrPostSettings,
}

pub fn normalize_shock_params(params: &Value) -> ShockParams {
    let r = Reader::new(params, shock_defs());
    let (per_ring, dust) = pick(params, [(6144u32, [240u32, 135u32]), (12288, [320, 180]), (24576, [480, 270])]);
    let per_ring = r.count("particles", per_ring);
    let d = defaults();
    let palette = palette_with_overrides(palette_named(SHOCK_PALETTES, params), params);
    let density = (per_ring as f32 / 12288.0).max(0.08);
    ShockParams {
        per_ring,
        dust,
        accum_scale: 1.0,
        palette,
        layout: if r.s("layout") == "scatter" { RingLayout::Scatter } else { RingLayout::Center },
        highs: r.b("highs"),
        reach: r.f("reach"),
        speed: r.f("ringSpeed"),
        width: r.f("width"),
        max_rings: r.f("maxRings").round() as usize,
        brightness: 0.04 / density,
        dust_glow: r.f("dust"),
        push: r.f("push"),
        refract: r.f("refract"),
        chroma: r.f("chroma"),
        shell: r.f("shell"),
        size_px: r.f("particleSize"),
        size_var: r.f("sizeVariation"),
        streak: r.f("streak"),
        camera: camera_controls(params, &d),
        audio: audio_controls(params, &d),
        finish: finish_floats(params, &d),
        post: post_from(params, &d, glow_tint(&palette)),
    }
}

/// A ring's life. Explicit: Expanding -> Fading -> gone.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum RingPhase {
    Expanding,
    Fading { since: f32 },
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Ring {
    pub band: OnsetBand,
    pub born: f32,
    pub strength: f32,
    pub center: [f32; 2],
    pub seed: f32,
    /// Final radius and the rate it closes in on it (1/s).
    pub reach: f32,
    pub rate: f32,
    pub width: f32,
    pub phase: RingPhase,
}

impl Ring {
    pub fn radius(&self, now: f32) -> f32 {
        self.reach * (1.0 - (-(now - self.born).max(0.0) * self.rate).exp())
    }

    /// How fast the front moves (picture heights per second).
    pub fn front_speed(&self, now: f32) -> f32 {
        self.reach * self.rate * (-(now - self.born).max(0.0) * self.rate).exp()
    }

    pub fn intensity(&self, now: f32) -> f32 {
        let age = (now - self.born).max(0.0);
        let attack = (age / 0.03).clamp(0.0, 1.0);
        let fade = match self.phase {
            RingPhase::Expanding => 1.0,
            RingPhase::Fading { since } => (1.0 - (now - since) / FADE_SECONDS).clamp(0.0, 1.0),
        };
        self.strength * attack * (-age * 0.9).exp() * fade
    }
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct RingQueue {
    pub rings: Vec<Ring>,
    pub last_seq: u32,
}

impl RingQueue {
    pub fn ingest(&mut self, hits: &[(OnsetEvent, f32)], params: &ShockParams, aspect: f32) {
        for (event, born) in hits.iter().take(MAX_LAUNCHES_PER_FRAME) {
            if event.band == OnsetBand::High && !params.highs {
                continue;
            }
            self.launch(event.band, event.strength, event.seq, *born, params, aspect);
        }
    }

    pub fn launch(&mut self, band: OnsetBand, strength: f32, seq: u32, born: f32, params: &ShockParams, aspect: f32) {
        let r = |salt: u32| hash01(seq.wrapping_mul(977).wrapping_add(salt));
        let strength = strength.clamp(0.3, 1.6);
        // Kicks are wide, heavy and slow; snares thin and fast; hats tiny.
        let (reach, rate, width) = match band {
            OnsetBand::Bass => (params.reach * (0.75 + 0.25 * strength.min(1.2)), 1.5, params.width),
            OnsetBand::Mid => (params.reach * 0.85, 2.6, params.width * 0.35),
            OnsetBand::High => (params.reach * 0.35, 4.0, params.width * 0.25),
        };
        let center = match (params.layout, band) {
            (RingLayout::Center, _) | (RingLayout::Scatter, OnsetBand::Bass) => {
                [(r(1) - 0.5) * 0.06, (r(2) - 0.5) * 0.06]
            }
            (RingLayout::Scatter, _) => {
                // Golden-angle steps spread successive hits evenly around.
                let a = seq as f32 * 2.399_963 + r(3) * 0.5;
                let d = 0.35 + 0.3 * r(4);
                [a.cos() * d * aspect.min(1.8) * 0.8, a.sin() * d]
            }
        };
        while self.rings.len() >= params.max_rings.clamp(1, MAX_RINGS) {
            let victim = self.rings.iter().position(|ring| matches!(ring.phase, RingPhase::Fading { .. })).unwrap_or(0);
            self.rings.remove(victim);
        }
        self.rings.push(Ring {
            band,
            born,
            strength,
            center,
            seed: r(5),
            reach,
            rate: rate * params.speed,
            width,
            phase: RingPhase::Expanding,
        });
    }

    pub fn step(&mut self, now: f32) {
        for ring in &mut self.rings {
            if ring.phase == RingPhase::Expanding
                && (now - ring.born > EXPAND_SECONDS / ring.rate.max(0.1) * 1.5 || ring.intensity(now) < 0.05)
            {
                ring.phase = RingPhase::Fading { since: now };
            }
        }
        self.rings.retain(|ring| match ring.phase {
            RingPhase::Fading { since } => now - since < FADE_SECONDS,
            RingPhase::Expanding => true,
        });
    }
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct ShockState {
    pub audio: AudioConditioner,
    pub motion: MotionClock,
    pub rings: RingQueue,
}

pub struct ShockFrame {
    pub params: ShockParams,
    pub uniform: Vec<f32>,
    pub live: u32,
}

pub fn shock_frame(json: &Value, state: &mut ShockState, data: &AudioVisualData, size: (u32, u32), core_dt: f32) -> ShockFrame {
    let params = normalize_shock_params(json);
    let step = state.motion.step(json, &params.camera, core_dt);
    let now = state.motion.time;
    let audio = state.audio.step_with(data, &params.audio, now, step, core_dt > 0.0, MAX_LAUNCHES_PER_FRAME * 2);
    let aspect = size.0 as f32 / size.1.max(1) as f32;
    if step > 0.0 {
        state.rings.ingest(&audio.hits, &params, aspect);
        state.rings.step(now);
    }
    let view = view2_floats(&params.camera, state.motion.angles(&params.camera), now);
    let uniform = shock_uniform(&params, &state.rings, &audio, &view, size, now);
    ShockFrame { live: state.rings.rings.len().min(MAX_RINGS) as u32, params, uniform }
}

/// The uniform the shockwave shaders read (`ShockU`).
pub fn shock_uniform(
    params: &ShockParams,
    queue: &RingQueue,
    audio: &AudioFrame,
    view: &[f32; 16],
    size: (u32, u32),
    time: f32,
) -> Vec<f32> {
    let (width, height) = size;
    let live = queue.rings.len().min(MAX_RINGS);
    let mut u = vec![
        width as f32, height as f32, width as f32 / height.max(1) as f32, params.per_ring as f32,
        time, live as f32, audio.levels[3], audio.drive,
        params.brightness, params.dust_glow, params.streak, params.chroma,
        params.push, params.refract, params.dust[0] as f32, params.dust[1] as f32,
        params.size_px, params.size_var, params.shell, audio.levels[2],
    ];
    u.extend_from_slice(view);
    u.extend_from_slice(&palette_floats(&params.palette));
    for ring in queue.rings.iter().take(MAX_RINGS) {
        u.extend_from_slice(&[
            ring.center[0], ring.center[1], ring.radius(time), ring.width,
            ring.intensity(time), ring.band as u32 as f32, ring.front_speed(time), ring.seed,
        ]);
    }
    u.resize(SHOCK_HEADER_FLOATS + MAX_RINGS * 8, 0.0);
    u
}

pub const SHOCK_HEADER_FLOATS: usize = 20 + 16 + 12;

#[cfg(test)]
mod tests {
    use super::super::controls2::probe;
    use super::*;

    fn params() -> ShockParams {
        normalize_shock_params(&serde_json::json!({}))
    }

    #[test]
    fn a_ring_expands_slows_fades_and_leaves() {
        let p = params();
        let mut q = RingQueue::default();
        q.launch(OnsetBand::Bass, 1.0, 1, 0.0, &p, 1.78);
        let ring = q.rings[0];
        assert!(ring.radius(0.2) < ring.radius(0.6) && ring.radius(0.6) < ring.reach);
        assert!(ring.front_speed(0.6) < ring.front_speed(0.1), "the front decelerates");
        q.step(0.5);
        assert_eq!(q.rings[0].phase, RingPhase::Expanding);
        q.step(4.0);
        assert!(matches!(q.rings[0].phase, RingPhase::Fading { .. }));
        q.step(4.0 + FADE_SECONDS + 0.01);
        assert!(q.rings.is_empty());
    }

    #[test]
    fn snares_are_thinner_and_faster_than_kicks() {
        let p = params();
        let mut q = RingQueue::default();
        q.launch(OnsetBand::Bass, 1.0, 1, 0.0, &p, 1.78);
        q.launch(OnsetBand::Mid, 1.0, 2, 0.0, &p, 1.78);
        let (kick, snare) = (q.rings[0], q.rings[1]);
        assert!(snare.width < kick.width * 0.5);
        assert!(snare.front_speed(0.0) > kick.front_speed(0.0));
    }

    #[test]
    fn hats_launch_only_when_asked_and_the_queue_is_bounded() {
        let p = params();
        let mut q = RingQueue::default();
        for seq in 0..40 {
            q.launch(OnsetBand::Bass, 1.0, seq, seq as f32 * 0.05, &p, 1.78);
            q.step(seq as f32 * 0.05);
            assert!(q.rings.len() <= MAX_RINGS);
        }
        let u = shock_uniform(&p, &q, &AudioFrame::default(), &[0.0; 16], (1920, 1080), 2.0);
        assert_eq!(u.len(), SHOCK_HEADER_FLOATS + MAX_RINGS * 8);
        assert!(!p.highs);
    }

    #[test]
    fn max_rings_bounds_the_queue_live() {
        let p = normalize_shock_params(&serde_json::json!({"maxRings": 3}));
        let mut q = RingQueue::default();
        for seq in 0..10 {
            q.launch(OnsetBand::Bass, 1.0, seq, 0.0, &p, 1.78);
        }
        assert_eq!(q.rings.len(), 3);
    }

    fn probe_frame(json: &Value) -> Vec<f32> {
        let mut state = ShockState::default();
        probe::run(json, |p, data, _t, dt| {
            let f = shock_frame(p, &mut state, data, (1920, 1080), dt);
            let mut out = f.uniform;
            out.extend(probe::post_floats(&f.params.post));
            out.extend(f.params.finish);
            out.push(f.live as f32);
            out
        })
    }

    #[test]
    fn every_param_parses_clamps_and_reaches_the_gpu() {
        probe::check_all("shockwave-rings", &shock_defs(), probe_frame, &[]);
    }
}
