//! Lightning Arcs: branching arcs struck between emitter points. Snares strike
//! across the ring of nodes, kicks strike from the hub out to the ring, hats
//! crackle short crawlers off single nodes. Each bolt is a seeded
//! midpoint-displacement curve with seeded branches, evaluated in closed form
//! on the GPU (no geometry buffers); a strike re-strikes a couple of times
//! with a new seed each time, like real lightning, and the post chain's
//! trails leave an afterimage. CPU side: params, palettes, node placement on
//! the shared emitter shapes, the arc state machine and the uniform
//! (`wgsl/arcs.wgsl`).

use serde_json::Value;

use super::audio_data::{AudioVisualData, OnsetBand, OnsetEvent};
use super::controls2::{
    AudioConditioner, AudioControls, AudioFrame, CameraControls, CameraKind, CommonDefaults, MotionClock, ParamDef, Reader,
    audio_controls, camera_controls, common_defs, finish_floats, palette_with_overrides, post_from, resets, select, slider,
    view2_floats,
};
use super::emitter::{EmitterKind, EmitterShape, emitter_sample};
use super::hdr_post::HdrPostSettings;
use super::kit::{glow_tint, palette_floats, palette_named, pick};
use super::params::Palette3;

pub const MAX_ARCS: usize = 16;
pub const MAX_NODES: usize = 11;
pub const MAX_LAUNCHES_PER_FRAME: usize = 4;
/// Segments of the main bolt, and of each branch.
pub const MAIN_SEGMENTS: u32 = 96;
pub const BRANCH_SEGMENTS: u32 = 32;
/// When each re-strike lands after the first (seconds).
pub const RESTRIKES: [f32; 3] = [0.0, 0.055, 0.12];
#[cfg(test)]
pub const LIFE_SECONDS: f32 = 0.9;

pub const ARC_PALETTES: &[(&str, Palette3)] = &[
    (
        "storm",
        Palette3 { core: [0.9, 0.93, 1.0, 9.0], mid: [0.35, 0.45, 1.0, 2.2], fringe: [0.45, 0.1, 0.9, 1.0] },
    ),
    (
        "sodium",
        Palette3 { core: [1.0, 0.95, 0.85, 9.0], mid: [1.0, 0.5, 0.1, 2.2], fringe: [0.7, 0.08, 0.02, 1.0] },
    ),
    (
        "toxic",
        Palette3 { core: [0.9, 1.0, 0.92, 9.0], mid: [0.15, 1.0, 0.55, 2.0], fringe: [0.0, 0.35, 0.45, 1.0] },
    ),
];

pub const ARC_PALETTE_NAMES: &[&str] = &["storm", "sodium", "toxic"];

fn defaults() -> CommonDefaults {
    CommonDefaults {
        camera: CameraKind::Picture2D,
        quality: "medium",
        fov: 40.0,
        post: HdrPostSettings {
            decay: 0.8,
            zoom: 0.0015,
            swirl: 0.0,
            flow: 0.0006,
            bloom_strength: 1.2,
            threshold: 0.8,
            split: 0.003,
            exposure: 1.0,
            vignette: 0.4,
            dither: 1.0,
            burn: 0.6,
            tint: [1.0; 3],
        },
        level_band: "level",
        palettes: ARC_PALETTE_NAMES,
    }
}

pub fn arc_defs() -> Vec<ParamDef> {
    let mut defs = vec![
        resets(slider("nodes", "Emitter points", "Arcs", 3.0, (MAX_NODES - 1) as f32, 1.0, 7.0)),
        select("layout", "Emitter shape", "Arcs", &["ring", "line", "polygon"], "ring"),
        slider("size", "Emitter size", "Arcs", 0.1, 2.0, 0.01, 0.62),
        slider("branchDepth", "Branch depth", "Arcs", 3.0, 9.0, 1.0, 7.0),
        slider("branches", "Branches", "Arcs", 0.0, MAX_BRANCHES as f32, 1.0, 6.0),
        slider("jagged", "Jaggedness", "Arcs", 0.0, 1.0, 0.01, 0.2),
        slider("strikeRate", "Max strikes per second", "Arcs", 0.5, 30.0, 0.1, 30.0),
        slider("afterimage", "Afterimage (s)", "Arcs", 0.15, 3.0, 0.01, 0.9),
        slider("coreWidth", "Core thickness", "Arcs", 0.5, 6.0, 0.01, 1.4),
        slider("glowWidth", "Glow width", "Arcs", 1.0, 64.0, 0.1, 12.0),
        slider("nodeGlow", "Point glow", "Arcs", 0.0, 4.0, 0.01, 1.0),
        slider("maxArcs", "Max arcs at once", "Arcs", 1.0, MAX_ARCS as f32, 1.0, 7.0),
    ];
    defs.extend(common_defs(&defaults()));
    defs
}

pub const MAX_BRANCHES: u32 = 12;
const BUCKET: f32 = 3.0;

#[derive(Clone, Debug, PartialEq)]
pub struct ArcParams {
    pub branches: u32,
    pub levels: u32,
    pub palette: Palette3,
    pub nodes: u32,
    pub layout: EmitterKind,
    pub size: f32,
    pub jagged: f32,
    pub strike_rate: f32,
    pub life: f32,
    pub core_px: f32,
    pub glow_px: f32,
    pub node_glow: f32,
    pub max_arcs: usize,
    pub brightness: f32,
    pub camera: CameraControls,
    pub audio: AudioControls,
    pub finish: [f32; 4],
    pub post: HdrPostSettings,
}

pub fn normalize_arc_params(params: &Value) -> ArcParams {
    let r = Reader::new(params, arc_defs());
    let (branches, levels) = pick(params, [(3u32, 6u32), (6, 7), (8, 7)]);
    let d = defaults();
    let palette = palette_with_overrides(palette_named(ARC_PALETTES, params), params);
    let layout = match r.s("layout").as_str() {
        "line" => EmitterKind::Line,
        "polygon" => EmitterKind::Polygon,
        _ => EmitterKind::Ring,
    };
    ArcParams {
        branches: r.count("branches", branches),
        levels: r.count("branchDepth", levels),
        palette,
        nodes: r.count("nodes", 7),
        layout,
        size: r.f("size"),
        jagged: r.f("jagged"),
        strike_rate: r.f("strikeRate"),
        life: r.f("afterimage"),
        core_px: r.f("coreWidth"),
        glow_px: r.f("glowWidth"),
        node_glow: r.f("nodeGlow"),
        max_arcs: r.f("maxArcs").round() as usize,
        brightness: 1.0,
        camera: camera_controls(params, &d),
        audio: audio_controls(params, &d),
        finish: finish_floats(params, &d),
        post: post_from(params, &d, glow_tint(&palette)),
    }
}

/// Node positions (picture heights, y up): the ring of nodes on the chosen
/// emitter shape, drifting a little, and the hub last.
pub fn node_positions(params: &ArcParams, aspect: f32, time: f32) -> Vec<[f32; 2]> {
    let sway = params.camera.sway;
    let shape = match params.layout {
        EmitterKind::Line => EmitterShape {
            kind: EmitterKind::Line,
            sides: 0,
            count: 1,
            center: [0.0, 0.0],
            size: [0.0, params.size * aspect.min(2.0) * 1.2],
            rotation: std::f32::consts::FRAC_PI_2,
        },
        EmitterKind::Polygon => EmitterShape {
            kind: EmitterKind::Polygon,
            sides: params.nodes,
            count: 1,
            center: [0.0, 0.0],
            size: [params.size, params.size],
            rotation: 0.0,
        },
        _ => EmitterShape {
            kind: EmitterKind::Ring,
            sides: 0,
            count: 1,
            center: [0.0, 0.0],
            size: [params.size * 1.25, params.size],
            rotation: 0.0,
        },
    };
    let n = params.nodes as usize;
    let closed = shape.kind != EmitterKind::Line;
    let mut nodes: Vec<[f32; 2]> = (0..n)
        .map(|i| {
            let u = if closed { i as f32 / n as f32 } else { (i as f32 + 0.5) / n as f32 };
            let p = emitter_sample(&shape, u).pos;
            let fi = i as f32;
            [p[0] + 0.018 * sway * (time * 0.7 + fi * 1.9).sin(), p[1] + 0.018 * sway * (time * 0.53 + fi * 1.3).cos()]
        })
        .collect();
    let hub = if closed { [0.0, 0.0] } else { [0.0, -params.size * 0.9] };
    nodes.push(hub);
    nodes
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ArcEnd {
    Node(usize),
    /// A node plus an offset (a crawler's free end).
    Free(usize, [i32; 2]),
}

/// An arc's life. Explicit: Striking (re-strikes land) -> Fading -> gone.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum ArcPhase {
    Striking,
    Fading,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Arc {
    pub band: OnsetBand,
    pub from: ArcEnd,
    pub to: ArcEnd,
    pub born: f32,
    pub strength: f32,
    pub seed: u32,
    pub restrikes: usize,
    pub phase: ArcPhase,
}

impl Arc {
    fn age(&self, now: f32) -> f32 {
        (now - self.born).max(0.0)
    }

    /// Which strike is showing (each one has its own shape).
    pub fn strike(&self, now: f32) -> usize {
        let age = self.age(now);
        RESTRIKES[..self.restrikes].iter().rposition(|t| *t <= age).unwrap_or(0)
    }

    pub fn brightness(&self, now: f32, life: f32) -> f32 {
        let age = self.age(now);
        let k = self.strike(now);
        let flash = (-(age - RESTRIKES[k]) * 22.0).exp();
        let glow = (-age * 4.5 / life.max(0.05)).exp();
        self.strength * (0.3 * glow + flash) * (1.0 - age / life.max(0.05)).clamp(0.0, 1.0)
    }
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct ArcQueue {
    pub arcs: Vec<Arc>,
    /// The live cap (`maxArcs`): busy passages never pile into a web.
    pub cap: usize,
    /// The strike-rate limit: a bucket of strikes that refills at the rate
    /// (up to 3, so a kick and a snare together both strike), and when it
    /// was last topped up.
    pub tokens: f32,
    pub refilled: Option<f32>,
}

impl ArcQueue {
    pub fn ingest(&mut self, hits: &[(OnsetEvent, f32)], nodes: usize, strike_rate: f32) {
        for (event, born) in hits.iter().take(MAX_LAUNCHES_PER_FRAME) {
            self.tokens = match self.refilled {
                None => BUCKET,
                Some(at) => (self.tokens + (*born - at).max(0.0) * strike_rate).min(BUCKET),
            };
            self.refilled = Some(*born);
            if self.tokens < 1.0 {
                continue;
            }
            self.tokens -= 1.0;
            self.launch(event.band, event.strength, event.seq, *born, nodes);
        }
    }

    /// `nodes` counts the ring nodes (the hub is index `nodes`).
    pub fn launch(&mut self, band: OnsetBand, strength: f32, seq: u32, born: f32, nodes: usize) {
        let strength = strength.clamp(0.3, 1.6);
        let n = nodes.max(3);
        let s = seq as usize;
        let mut push = |from: ArcEnd, to: ArcEnd, strength: f32, salt: u32| {
            if self.arcs.len() >= if self.cap == 0 { MAX_ARCS } else { self.cap.min(MAX_ARCS) } {
                let victim = self.arcs.iter().position(|a| a.phase == ArcPhase::Fading).unwrap_or(0);
                self.arcs.remove(victim);
            }
            let restrikes = if strength > 1.1 { 3 } else if strength > 0.7 { 2 } else { 1 };
            self.arcs.push(Arc {
                band,
                from,
                to,
                born,
                strength,
                seed: seq.wrapping_mul(2_654_435_761).wrapping_add(salt),
                restrikes,
                phase: ArcPhase::Striking,
            });
        };
        match band {
            // A snare strikes a chord across the ring.
            OnsetBand::Mid => {
                let a = s % n;
                let b = (a + 2 + (s / n) % (n - 3).max(1)) % n;
                push(ArcEnd::Node(a), ArcEnd::Node(b), strength, 1);
            }
            // A kick strikes from the hub out to two nodes.
            OnsetBand::Bass => {
                let a = (s * 3) % n;
                let b = (a + n / 2) % n;
                push(ArcEnd::Node(n), ArcEnd::Node(a), strength, 2);
                push(ArcEnd::Node(n), ArcEnd::Node(b), strength * 0.8, 3);
            }
            // A hat crackles a short crawler off one node.
            OnsetBand::High => {
                let a = (s * 7) % n;
                let angle = (s as f32 * 2.399_963).rem_euclid(std::f32::consts::TAU);
                let off = [(angle.cos() * 1000.0) as i32, (angle.sin() * 1000.0) as i32];
                push(ArcEnd::Node(a), ArcEnd::Free(a, off), strength * 0.55, 4);
            }
        }
    }

    pub fn step(&mut self, now: f32, life: f32) {
        for arc in &mut self.arcs {
            if arc.phase == ArcPhase::Striking && arc.age(now) > RESTRIKES[arc.restrikes - 1] + 0.08 {
                arc.phase = ArcPhase::Fading;
            }
        }
        self.arcs.retain(|arc| arc.age(now) < life);
    }
}

fn end_point(end: ArcEnd, nodes: &[[f32; 2]], reach: f32) -> [f32; 2] {
    match end {
        ArcEnd::Node(i) => nodes[i.min(nodes.len() - 1)],
        ArcEnd::Free(i, off) => {
            let p = nodes[i.min(nodes.len() - 1)];
            [p[0] + off[0] as f32 / 1000.0 * reach, p[1] + off[1] as f32 / 1000.0 * reach]
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct ArcState {
    pub audio: AudioConditioner,
    pub motion: MotionClock,
    pub arcs: ArcQueue,
}

pub struct ArcFrame {
    pub params: ArcParams,
    pub uniform: Vec<f32>,
    pub live: u32,
}

pub fn arc_frame(json: &Value, state: &mut ArcState, data: &AudioVisualData, size: (u32, u32), core_dt: f32) -> ArcFrame {
    let params = normalize_arc_params(json);
    let step = state.motion.step(json, &params.camera, core_dt);
    let now = state.motion.time;
    let audio = state.audio.step_with(data, &params.audio, now, step, core_dt > 0.0, MAX_LAUNCHES_PER_FRAME * 2);
    if step > 0.0 {
        state.arcs.cap = params.max_arcs;
        while state.arcs.arcs.len() > params.max_arcs.max(1) {
            state.arcs.arcs.remove(0);
        }
        state.arcs.ingest(&audio.hits, params.nodes as usize, params.strike_rate);
        state.arcs.step(now, params.life);
    }
    let view = view2_floats(&params.camera, state.motion.angles(&params.camera), now);
    let uniform = arc_uniform(&params, &state.arcs, &audio, &view, size, now);
    ArcFrame { live: state.arcs.arcs.len().min(MAX_ARCS) as u32, params, uniform }
}

/// The uniform the arc shader reads (`ArcU`).
pub fn arc_uniform(params: &ArcParams, queue: &ArcQueue, audio: &AudioFrame, view: &[f32; 16], size: (u32, u32), time: f32) -> Vec<f32> {
    let (width, height) = size;
    let aspect = width as f32 / height.max(1) as f32;
    let nodes = node_positions(params, aspect, time);
    let live = queue.arcs.len().min(MAX_ARCS);
    let mut flare = vec![0.0_f32; nodes.len()];
    let mut arcs = Vec::with_capacity(MAX_ARCS * 8);
    for arc in queue.arcs.iter().take(MAX_ARCS) {
        let b = arc.brightness(time, params.life) * params.brightness;
        for end in [arc.from, arc.to] {
            if let ArcEnd::Node(i) = end {
                flare[i.min(nodes.len() - 1)] += b;
            }
        }
        let a = end_point(arc.from, &nodes, params.size * 0.35);
        let z = end_point(arc.to, &nodes, params.size * 0.35);
        let seed = arc.seed.wrapping_add(arc.strike(time) as u32 * 7919);
        let width = match arc.band {
            OnsetBand::Bass => 1.25,
            OnsetBand::Mid => 1.0,
            OnsetBand::High => 0.6,
        };
        arcs.extend_from_slice(&[a[0], a[1], z[0], z[1], b, (seed % 65_536) as f32, arc.band as u32 as f32, width]);
    }
    arcs.resize(MAX_ARCS * 8, 0.0);
    let mut u = vec![
        width as f32, height as f32, aspect, live as f32,
        params.core_px, params.glow_px, params.brightness, params.jagged,
        time, nodes.len() as f32, params.levels as f32, params.branches as f32,
        audio.levels[3], audio.env[2], audio.drive, params.node_glow,
    ];
    u.extend_from_slice(view);
    u.extend_from_slice(&palette_floats(&params.palette));
    for i in 0..MAX_NODES + 1 {
        match nodes.get(i) {
            Some(p) => u.extend_from_slice(&[p[0], p[1], flare[i], if i + 1 == nodes.len() { 1.2 } else { 1.0 }]),
            None => u.extend_from_slice(&[0.0; 4]),
        }
    }
    u.extend_from_slice(&arcs);
    u
}

#[cfg(test)]
pub const ARC_HEADER_FLOATS: usize = 16 + 16 + 12 + (MAX_NODES + 1) * 4;

/// Segments per arc for a branch count.
pub fn segments_per_arc(branches: u32) -> u32 {
    MAIN_SEGMENTS + branches * BRANCH_SEGMENTS
}

#[cfg(test)]
mod tests {
    use super::super::controls2::probe;
    use super::*;

    #[test]
    fn an_arc_restrikes_then_fades_and_leaves() {
        let mut q = ArcQueue::default();
        q.launch(OnsetBand::Mid, 1.5, 5, 0.0, 7);
        let arc = q.arcs[0];
        assert_eq!(arc.restrikes, 3);
        assert_eq!(arc.strike(0.0), 0);
        assert_eq!(arc.strike(0.06), 1);
        assert_eq!(arc.strike(0.2), 2);
        assert!(arc.brightness(0.055, LIFE_SECONDS) > arc.brightness(0.05, LIFE_SECONDS), "a re-strike flashes again");
        q.step(0.1, LIFE_SECONDS);
        assert_eq!(q.arcs[0].phase, ArcPhase::Striking);
        q.step(0.3, LIFE_SECONDS);
        assert_eq!(q.arcs[0].phase, ArcPhase::Fading);
        q.step(LIFE_SECONDS + 0.01, LIFE_SECONDS);
        assert!(q.arcs.is_empty());
    }

    #[test]
    fn kicks_strike_from_the_hub_and_snares_across_the_ring() {
        let mut q = ArcQueue::default();
        q.launch(OnsetBand::Bass, 1.0, 1, 0.0, 7);
        assert_eq!(q.arcs.len(), 2);
        assert!(q.arcs.iter().all(|a| a.from == ArcEnd::Node(7)));
        q.launch(OnsetBand::Mid, 1.0, 9, 0.0, 7);
        let chord = q.arcs[2];
        match (chord.from, chord.to) {
            (ArcEnd::Node(a), ArcEnd::Node(b)) => assert!(a != b && a < 7 && b < 7),
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn the_queue_is_bounded_and_the_uniform_has_its_layout() {
        let p = normalize_arc_params(&serde_json::json!({}));
        let mut q = ArcQueue::default();
        for seq in 0..50 {
            q.launch(OnsetBand::Bass, 1.0, seq, seq as f32 * 0.01, 7);
            assert!(q.arcs.len() <= MAX_ARCS);
        }
        let u = arc_uniform(&p, &q, &AudioFrame::default(), &[0.0; 16], (1920, 1080), 0.3);
        assert_eq!(u.len(), ARC_HEADER_FLOATS + MAX_ARCS * 8);
        assert_eq!(node_positions(&p, 1.78, 0.0).len(), 8);
    }

    #[test]
    fn the_same_strike_always_has_the_same_shape_seed() {
        let mut a = ArcQueue::default();
        let mut b = ArcQueue::default();
        a.launch(OnsetBand::Mid, 1.0, 42, 1.0, 7);
        b.launch(OnsetBand::Mid, 1.0, 42, 1.0, 7);
        assert_eq!(a.arcs[0].seed, b.arcs[0].seed);
    }

    #[test]
    fn the_strike_rate_limits_launches() {
        let mut q = ArcQueue::default();
        let hit = |seq: u32, t: f32| (OnsetEvent { time: t, band: OnsetBand::Mid, strength: 1.0, seq }, t);
        let hits: Vec<_> = (0..8).map(|i| hit(i + 1, i as f32 * 0.2)).collect();
        q.ingest(&hits[..4], 7, 2.0);
        q.ingest(&hits[4..], 7, 2.0);
        assert_eq!(q.arcs.len(), 5, "a burst from the full bucket, then the refill rate");
    }

    fn probe_frame(json: &Value) -> Vec<f32> {
        let mut state = ArcState::default();
        probe::run(json, |p, data, _t, dt| {
            let f = arc_frame(p, &mut state, data, (1920, 1080), dt);
            let mut out = f.uniform;
            out.extend(probe::post_floats(&f.params.post));
            out.extend(f.params.finish);
            out.extend([f.live as f32, f.params.branches as f32]);
            out
        })
    }

    #[test]
    fn every_param_parses_clamps_and_reaches_the_gpu() {
        probe::check_all("lightning-arcs", &arc_defs(), probe_frame, &[]);
    }
}
