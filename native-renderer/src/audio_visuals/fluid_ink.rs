//! Fluid Ink: two inks in a 2D stable-fluid solve. The pipeline is the one the
//! core's 3D smoke and fluid riders use (splat, advect, divergence, Jacobi
//! pressure, subtract gradient) flattened to 2D and run as fullscreen passes
//! over float textures, plus vorticity confinement for the curling filaments
//! dense ink makes. Every hit injects a jet of ink (kicks rise from below,
//! snares cut in from the sides, hats flick small wisps); the bass level
//! turns the whole tank. CPU side: params, palettes, the jet state machine and
//! the uniform (`wgsl/fluid_ink.wgsl`).

use serde_json::Value;

use super::audio_data::{AudioVisualData, OnsetBand, OnsetEvent};
use super::controls2::{
    AudioConditioner, AudioControls, AudioFrame, CameraControls, CameraKind, CommonDefaults, MotionClock, ParamDef, Reader,
    audio_controls, camera_controls, common_defs, finish_floats, palette_with_overrides, post_from, select, slider,
    view2_floats,
};
use super::hdr_post::HdrPostSettings;
use super::kit::{glow_tint, hash01, palette_floats, palette_named, pick};
use super::params::Palette3;

pub const MAX_JETS: usize = 8;
pub const JET_SECONDS: f32 = 0.22;
pub const MAX_LAUNCHES_PER_FRAME: usize = 3;
/// Every this many kicks the tank's turn reverses.
pub const KICKS_PER_TURN: u32 = 8;

/// `mid` is ink A, `fringe` ink B, `core` the hot light in fresh ink.
pub const INK_PALETTES: &[(&str, Palette3)] = &[
    (
        "vermilion-indigo",
        Palette3 { core: [1.0, 0.85, 0.7, 2.5], mid: [1.0, 0.22, 0.05, 1.0], fringe: [0.16, 0.16, 1.0, 1.0] },
    ),
    (
        "jade-gold",
        Palette3 { core: [1.0, 0.95, 0.8, 2.5], mid: [1.0, 0.62, 0.12, 1.0], fringe: [0.02, 0.6, 0.42, 1.0] },
    ),
    (
        "ultramarine-rose",
        Palette3 { core: [0.9, 0.95, 1.0, 2.5], mid: [1.0, 0.3, 0.45, 1.0], fringe: [0.05, 0.25, 0.9, 1.0] },
    ),
];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InkLook {
    /// Luminous ink on black.
    Glow,
    /// Ink in a backlit tank: the inks absorb a white light.
    Backlit,
}

pub const INK_PALETTE_NAMES: &[&str] = &["vermilion-indigo", "jade-gold", "ultramarine-rose"];

fn defaults() -> CommonDefaults {
    CommonDefaults {
        camera: CameraKind::Picture2D,
        fov: 40.0,
        post: HdrPostSettings {
            decay: 0.0,
            zoom: 0.0,
            swirl: 0.0,
            flow: 0.0,
            bloom_strength: 0.45,
            threshold: 1.0,
            split: 0.0015,
            exposure: 1.0,
            vignette: 0.3,
            dither: 1.0,
            burn: 0.3,
            tint: [1.0; 3],
        },
        level_band: "bass",
        palettes: INK_PALETTE_NAMES,
    }
}

pub fn ink_defs() -> Vec<ParamDef> {
    let mut defs = vec![
        select("look", "Look", "Ink", &["glow", "backlit"], "glow"),
        slider("amount", "Ink amount", "Ink", 0.0, 8.0, 0.01, 0.3),
        slider("burstSize", "Burst size", "Ink", 0.005, 0.5, 0.001, 0.05),
        slider("force", "Burst force", "Ink", 0.0, 8.0, 0.01, 0.55),
        slider("swirl", "Bass swirl", "Ink", 0.0, 8.0, 0.01, 1.0),
        slider("viscosity", "Viscosity", "Ink", 0.0, 0.98, 0.001, 0.3),
        slider("dissipation", "Ink fade", "Ink", 0.0, 0.98, 0.001, 0.2),
        slider("curl", "Curl", "Ink", 0.0, 4.0, 0.01, 0.18),
        slider("density", "Density", "Ink", 0.05, 8.0, 0.01, 1.0),
        slider("relief", "Relief light", "Ink", 0.0, 8.0, 0.01, 1.8),
    ];
    defs.extend(common_defs(&defaults()));
    defs
}

#[derive(Clone, Debug, PartialEq)]
pub struct InkParams {
    pub sim: [u32; 2],
    pub dye_scale: f32,
    pub jacobi: u32,
    pub palette: Palette3,
    pub look: InkLook,
    pub force: f32,
    pub radius: f32,
    pub amount: f32,
    pub swirl: f32,
    pub vorticity: f32,
    pub vel_keep: f32,
    pub dye_keep: f32,
    pub density: f32,
    pub relief: f32,
    pub camera: CameraControls,
    pub audio: AudioControls,
    pub finish: [f32; 4],
    pub post: HdrPostSettings,
}

pub fn normalize_ink_params(params: &Value) -> InkParams {
    let r = Reader::new(params, ink_defs());
    let (sim_h, dye_scale, jacobi) = pick(params, [(144u32, 0.5f32, 14u32), (216, 0.75, 22), (288, 1.0, 32)]);
    let d = defaults();
    let palette = palette_with_overrides(palette_named(INK_PALETTES, params), params);
    let look = if r.s("look") == "backlit" { InkLook::Backlit } else { InkLook::Glow };
    let mut post = post_from(params, &d, glow_tint(&palette));
    if look == InkLook::Backlit && params.get("bloom").is_none() {
        post.bloom_strength = 0.15;
    }
    InkParams {
        sim: [sim_h, sim_h],
        dye_scale,
        jacobi,
        palette,
        look,
        force: r.f("force"),
        radius: r.f("burstSize"),
        amount: r.f("amount"),
        swirl: r.f("swirl"),
        vorticity: r.f("curl"),
        vel_keep: 1.0 - r.f("viscosity"),
        dye_keep: 1.0 - r.f("dissipation"),
        density: r.f("density"),
        relief: r.f("relief"),
        camera: camera_controls(params, &d),
        audio: audio_controls(params, &d),
        finish: finish_floats(params, &d),
        post,
    }
}

/// Sim grid for an output aspect: `sim[1]` rows, square cells.
pub fn sim_size(params: &InkParams, aspect: f32) -> (u32, u32) {
    let rows = params.sim[1];
    (((rows as f32) * aspect).round().max(16.0) as u32, rows)
}

/// A jet's life. Explicit: Injecting (pushes ink and force) -> gone.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Jet {
    pub band: OnsetBand,
    pub born: f32,
    pub strength: f32,
    /// Texture uv (y down), and a unit direction in picture space.
    pub pos: [f32; 2],
    pub dir: [f32; 2],
    pub radius: f32,
    /// 0 = ink A, 1 = ink B.
    pub ink: u32,
}

impl Jet {
    /// 1 while injecting, easing out over its life; 0 once spent.
    pub fn power(&self, now: f32) -> f32 {
        let t = (now - self.born) / JET_SECONDS;
        if !(0.0..1.0).contains(&t) {
            return 0.0;
        }
        (1.0 - t) * (1.0 - t)
    }
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct JetQueue {
    pub jets: Vec<Jet>,
    pub last_seq: u32,
    pub kicks: u32,
    pub snares: u32,
}

impl JetQueue {
    pub fn ingest(&mut self, hits: &[(OnsetEvent, f32)], params: &InkParams) {
        for (event, born) in hits.iter().take(MAX_LAUNCHES_PER_FRAME) {
            self.launch(event.band, event.strength, event.seq, *born, params);
        }
    }

    pub fn launch(&mut self, band: OnsetBand, strength: f32, seq: u32, born: f32, params: &InkParams) {
        let r = |salt: u32| hash01(seq.wrapping_mul(977).wrapping_add(salt));
        let strength = strength.clamp(0.3, 1.6);
        let (pos, angle, radius, ink) = match band {
            OnsetBand::Bass => {
                self.kicks = self.kicks.wrapping_add(1);
                // Up from the bottom, leaning left or right.
                let lean = (r(1) - 0.5) * 0.9;
                ([0.5 + (r(2) - 0.5) * 0.3, 0.9], -std::f32::consts::FRAC_PI_2 + lean, params.radius * 1.3, 0)
            }
            OnsetBand::Mid => {
                self.snares = self.snares.wrapping_add(1);
                // Alternately from the left and right, toward the middle.
                let left = self.snares % 2 == 0;
                let x = if left { 0.08 } else { 0.92 };
                let base = if left { 0.0 } else { std::f32::consts::PI };
                ([x, 0.3 + r(3) * 0.4], base + (r(4) - 0.5) * 0.7, params.radius, 1)
            }
            OnsetBand::High => (
                [0.2 + r(5) * 0.6, 0.2 + r(6) * 0.6],
                r(7) * std::f32::consts::TAU,
                params.radius * 0.45,
                (seq % 2) as u32,
            ),
        };
        if self.jets.len() >= MAX_JETS {
            self.jets.remove(0);
        }
        self.jets.push(Jet { band, born, strength, pos, dir: [angle.cos(), angle.sin()], radius, ink });
    }

    pub fn step(&mut self, now: f32) {
        self.jets.retain(|jet| now - jet.born < JET_SECONDS);
    }

    /// The tank turns one way, then the other, every `KICKS_PER_TURN` kicks.
    pub fn turn(&self) -> f32 {
        if (self.kicks / KICKS_PER_TURN) % 2 == 0 { 1.0 } else { -1.0 }
    }
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct InkState {
    pub audio: AudioConditioner,
    pub motion: MotionClock,
    pub jets: JetQueue,
}

pub struct InkFrame {
    pub params: InkParams,
    pub uniform: Vec<f32>,
    /// The instrument's step: the solver runs only when it is > 0.
    pub step: f32,
}

pub fn ink_frame(json: &Value, state: &mut InkState, data: &AudioVisualData, sim: (u32, u32), dye: (u32, u32), aspect: f32, core_dt: f32) -> InkFrame {
    let params = normalize_ink_params(json);
    let step = state.motion.step(json, &params.camera, core_dt);
    let now = state.motion.time;
    let audio = state.audio.step_with(data, &params.audio, now, step, core_dt > 0.0, MAX_LAUNCHES_PER_FRAME * 2);
    if step > 0.0 {
        state.jets.ingest(&audio.hits, &params);
    }
    let view = view2_floats(&params.camera, state.motion.angles(&params.camera), now);
    let uniform = ink_uniform(&params, &state.jets, &audio, &view, sim, dye, aspect, now, step);
    if step > 0.0 {
        state.jets.step(now);
    }
    InkFrame { params, uniform, step }
}

/// The uniform every Fluid Ink pass reads (`InkU`).
#[allow(clippy::too_many_arguments)]
pub fn ink_uniform(
    params: &InkParams,
    queue: &JetQueue,
    audio: &AudioFrame,
    view: &[f32; 16],
    sim: (u32, u32),
    dye: (u32, u32),
    aspect: f32,
    time: f32,
    dt: f32,
) -> Vec<f32> {
    let swirl = params.swirl * audio.drive.clamp(0.0, 1.5) * queue.turn();
    let mut u = vec![
        sim.0 as f32, sim.1 as f32, 1.0 / sim.0 as f32, 1.0 / sim.1 as f32,
        dye.0 as f32, dye.1 as f32, 1.0 / dye.0 as f32, 1.0 / dye.1 as f32,
        time, dt, aspect, queue.jets.len().min(MAX_JETS) as f32,
        params.vel_keep, params.dye_keep, params.vorticity, swirl,
        params.density, params.relief, if params.look == InkLook::Backlit { 1.0 } else { 0.0 }, audio.levels[3],
    ];
    u.extend_from_slice(view);
    u.extend_from_slice(&palette_floats(&params.palette));
    for jet in queue.jets.iter().take(MAX_JETS) {
        let power = jet.power(time) * jet.strength;
        // Force in sim cells per second; a kick throws hardest.
        let force = params.force * power * sim.1 as f32 * if jet.band == OnsetBand::Bass { 5.0 } else { 3.5 };
        u.extend_from_slice(&[
            jet.pos[0], jet.pos[1], jet.dir[0], jet.dir[1],
            jet.radius, force, params.amount * power, jet.ink as f32,
        ]);
    }
    u.resize(INK_HEADER_FLOATS + MAX_JETS * 8, 0.0);
    u
}

pub const INK_HEADER_FLOATS: usize = 20 + 16 + 12;

#[cfg(test)]
mod tests {
    use super::super::controls2::probe;
    use super::*;

    fn params() -> InkParams {
        normalize_ink_params(&serde_json::json!({}))
    }

    #[test]
    fn a_jet_injects_then_is_spent() {
        let p = params();
        let mut q = JetQueue::default();
        q.launch(OnsetBand::Bass, 1.0, 1, 0.0, &p);
        let jet = q.jets[0];
        assert!(jet.power(0.0) > jet.power(0.1) && jet.power(0.1) > 0.0);
        assert_eq!(jet.power(JET_SECONDS + 0.01), 0.0);
        q.step(0.1);
        assert_eq!(q.jets.len(), 1);
        q.step(JET_SECONDS + 0.01);
        assert!(q.jets.is_empty());
    }

    #[test]
    fn kicks_rise_from_below_and_snares_alternate_sides() {
        let p = params();
        let mut q = JetQueue::default();
        q.launch(OnsetBand::Bass, 1.0, 1, 0.0, &p);
        assert!(q.jets[0].pos[1] > 0.8 && q.jets[0].dir[1] < -0.5, "up from the bottom (uv y down)");
        q.launch(OnsetBand::Mid, 1.0, 2, 0.0, &p);
        q.launch(OnsetBand::Mid, 1.0, 3, 0.0, &p);
        assert!((q.jets[1].pos[0] - 0.5).signum() != (q.jets[2].pos[0] - 0.5).signum());
        assert!(q.jets[1].dir[0] * (0.5 - q.jets[1].pos[0]) > 0.0, "toward the middle");
    }

    #[test]
    fn the_turn_reverses_every_few_kicks_and_jets_are_bounded() {
        let p = params();
        let mut q = JetQueue::default();
        assert_eq!(q.turn(), 1.0);
        for seq in 0..KICKS_PER_TURN {
            q.launch(OnsetBand::Bass, 1.0, seq, 0.0, &p);
            assert!(q.jets.len() <= MAX_JETS);
        }
        assert_eq!(q.turn(), -1.0);
        let u = ink_uniform(&p, &q, &AudioFrame::default(), &[0.0; 16], (384, 216), (1440, 810), 1.78, 0.0, 1.0 / 60.0);
        assert_eq!(u.len(), INK_HEADER_FLOATS + MAX_JETS * 8);
    }

    #[test]
    fn quality_picks_the_grid_and_the_solve_stays_even() {
        for q in ["low", "medium", "high"] {
            let p = normalize_ink_params(&serde_json::json!({ "quality": q }));
            assert_eq!(p.jacobi % 2, 0, "the pressure must end where it started");
        }
        let (w, h) = sim_size(&params(), 16.0 / 9.0);
        assert_eq!((w, h), (384, 216));
    }

    fn probe_frame(json: &Value) -> Vec<f32> {
        let mut state = InkState::default();
        probe::run(json, |p, data, _t, dt| {
            let params = normalize_ink_params(p);
            let sim = sim_size(&params, 16.0 / 9.0);
            let f = ink_frame(p, &mut state, data, sim, (1440, 810), 16.0 / 9.0, dt);
            let mut out = f.uniform;
            out.extend(probe::post_floats(&f.params.post));
            out.extend(f.params.finish);
            out.extend([f.params.jacobi as f32, f.params.dye_scale, sim.0 as f32]);
            out
        })
    }

    #[test]
    fn every_param_parses_clamps_and_reaches_the_gpu() {
        probe::check_all("fluid-ink", &ink_defs(), probe_frame, &[]);
    }
}
