//! Strands: hits launch shapes (line, ring, square, strata) and fibres of
//! particles stream off them, shaped by the spectrum and waveform along the
//! shape. This file holds the CPU side: params, palettes, the launched-shape
//! state machine and the per-frame uniform. The GPU side is
//! `wgsl/strands_sim.wgsl` and `wgsl/strands_draw.wgsl`; the job is assembled
//! in `jobs.rs`.

use serde_json::Value;

use super::audio_data::{AudioVisualData, H_ENV_BASS, H_ENV_HIGH, H_ENV_MID, H_LEVEL, OnsetBand, OnsetEvent};
use super::emitter::EmitterKind;
use super::hdr_post::HdrPostSettings;
use super::controls::{
    AudioControls, AudioShaper, Defs, MotionControls, PostDefaults, QUALITY_OPTIONS, audio_defs, look_defs, motion_defs, post_defs, select, slider,
};
use super::params::{num, Palette3, palette_by_name, quality_from};

/// Particle state, colour and an 8-point trail (`Particle` in strands_common.wgsl).
pub const STRANDS_PARTICLE_BYTES: u64 = 128;
/// Trail segments drawn per particle.
pub const STRANDS_TRAIL_SEGMENTS: u32 = 8;
pub const STRANDS_MAX_PARTICLES: u32 = 1024 * 1024;
pub const STRANDS_MIN_PARTICLES: u32 = 16 * 1024;
pub const MAX_SHAPES: usize = 8;
/// At most this many hits launch shapes in one frame (a burst of events
/// after a stall would otherwise flush every live shape at once).
pub const MAX_LAUNCHES_PER_FRAME: usize = 2;
pub const ATTACK_SECONDS: f32 = 0.07;
pub const RELEASE_SECONDS: f32 = 0.45;
/// At most this many shapes stay on screen: the newest and two fading
/// ghosts, so a busy passage reads as one shape, not a thicket.
pub const MAX_VISIBLE_SHAPES: usize = 3;
pub const MAX_HOLD_SECONDS: f32 = 6.0;
/// Hits closer together than this feed the newest shape instead of making
/// a new one.
pub const MERGE_SECONDS: f32 = 0.06;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ShapeMode {
    Cycle,
    /// Line, ring, ring + lines, square, square + lines, strata, strata + ring.
    Sequence,
    Band,
    Fixed(EmitterKind, u32),
}

const STRANDS_PALETTE_OPTIONS: &[(&str, &str)] = &[
    ("ice-and-oxblood", "Ice and Oxblood"),
    ("molten-brass", "Molten Brass"),
    ("verdigris", "Verdigris"),
    ("violet-hour", "Violet Hour"),
];
/// How long Cycle and Sequence hold each step, in beats ("hit" = every launch).
const CHANGE_EVERY_OPTIONS: &[(&str, &str)] = &[
    ("hit", "Every hit"),
    ("1", "1 beat"),
    ("2", "2 beats"),
    ("4", "1 bar"),
    ("8", "2 bars"),
    ("16", "4 bars"),
    ("32", "8 bars"),
    ("64", "16 bars"),
];

/// Sequence steps: one or two shapes launched together.
const SEQUENCE_STEPS: &[&[(EmitterKind, u32)]] = &[
    &[(EmitterKind::Line, 0)],
    &[(EmitterKind::Ring, 0)],
    &[(EmitterKind::Ring, 0), (EmitterKind::Line, 0)],
    &[(EmitterKind::Polygon, 4)],
    &[(EmitterKind::Polygon, 4), (EmitterKind::Line, 0)],
    &[(EmitterKind::Strata, 0)],
    &[(EmitterKind::Strata, 0), (EmitterKind::Ring, 0)],
];

const SHAPE_OPTIONS: &[(&str, &str)] = &[
    ("cycle", "Cycle"),
    ("sequence", "Sequence (with combos)"),
    ("band", "Follow the band"),
    ("line", "Line"),
    ("ring", "Ring"),
    ("square", "Square"),
    ("polygon", "Polygon"),
    ("strata", "Strata"),
];

/// Every Strands control, as the panel shows it.
pub fn strands_defs() -> Defs {
    let mut d = vec![
        // Camera (2D: the picture turns, zooms and pans).
        slider("rotateZ", "Rotation", "Camera", -180.0, 180.0, 1.0, 0.0),
        slider("autoRotateZ", "Auto-rotate (deg/s)", "Camera", -90.0, 90.0, 0.5, 0.0),
        slider("zoom", "Zoom", "Camera", 0.25, 4.0, 0.01, 1.0),
        slider("offsetX", "Offset X", "Camera", -1.0, 1.0, 0.01, 0.0),
        slider("offsetY", "Offset Y", "Camera", -1.0, 1.0, 0.01, 0.0),
        // Points.
        select("quality", "Quality", "Points", QUALITY_OPTIONS, "medium").resetting(),
        slider("width", "Strand width (px)", "Points", 0.4, 4.0, 0.05, 0.6),
        slider("sizeVariation", "Width variation", "Points", 0.0, 1.0, 0.01, 0.0),
        slider("opacity", "Opacity", "Points", 0.0, 1.0, 0.01, 1.0),
        // Strands.
        select("shape", "Shape", "Strands", SHAPE_OPTIONS, "cycle"),
        select("changeEvery", "Change shape every", "Strands", CHANGE_EVERY_OPTIONS, "hit"),
        slider("maxShapes", "Shapes on screen", "Strands", 1.0, 8.0, 1.0, 3.0),
        slider("trail", "Fibre length (segments)", "Strands", 1.0, 8.0, 1.0, 8.0),
        slider("fray", "Fray", "Strands", 0.0, 8.0, 0.01, 1.0),
        slider("curl", "Curl scale", "Strands", 0.2, 6.0, 0.01, 1.5),
        slider("coreShare", "Contour vs strands", "Strands", 0.0, 1.0, 0.01, 0.35),
        slider("size", "Shape scale", "Strands", 0.2, 2.0, 0.01, 1.0),
        slider("sides", "Polygon sides", "Strands", 3.0, 12.0, 1.0, 4.0),
        slider("strataLines", "Strata lines (0 = auto)", "Strands", 0.0, 12.0, 1.0, 0.0),
        slider("cooldown", "Launch cooldown (s)", "Strands", 0.0, 1.0, 0.01, 0.06),
        slider("speed", "Strand speed", "Strands", 0.0, 4.0, 0.01, 0.5),
        slider("drag", "Drag", "Strands", 0.0, 12.0, 0.01, 1.2),
        slider("displacement", "Spectrum push", "Strands", 0.0, 1.0, 0.005, 0.07),
        slider("waveform", "Waveform bend", "Strands", 0.0, 2.0, 0.01, 0.6),
        slider("lifetime", "Lifetime (s)", "Strands", 0.1, 6.0, 0.01, 1.1),
        slider("fibres", "Fibres", "Strands", 16.0, 20000.0, 1.0, 420.0),
        slider("cooling", "Cooling", "Strands", 0.0, 12.0, 0.01, 1.5),
        slider("inward", "Inward share", "Strands", 0.0, 1.0, 0.01, 0.06),
    ];
    d.extend(look_defs(STRANDS_PALETTE_OPTIONS, "ice-and-oxblood", [0.85, 0.97, 1.0], [0.55, 0.12, 0.1]));
    d.extend(post_defs(PostDefaults { bloom: 0.8, threshold: 0.6, trails: 0.86, drift: 0.003, swirl: 0.0006, split: 0.0035 }));
    d.extend(audio_defs());
    d.extend(motion_defs());
    Defs(d)
}

#[derive(Clone, Debug, PartialEq)]
pub struct StrandsParams {
    pub particle_count: u32,
    pub accum_scale: f32,
    pub mode: ShapeMode,
    pub palette: Palette3,
    pub speed: f32,
    pub fray: f32,
    pub drag: f32,
    pub displacement: f32,
    pub width_px: f32,
    pub brightness: f32,
    pub lifetime: f32,
    pub fibres: f32,
    pub jitter: f32,
    pub cooling: f32,
    pub wave_mix: f32,
    pub size: f32,
    /// Share of particles that draw the burning contour itself.
    pub core_share: f32,
    pub core_life: f32,
    /// Share of strands on closed shapes that stream inward.
    pub inward: f32,
    pub max_shapes: usize,
    /// Beats each Cycle/Sequence step holds (0 = every hit).
    pub change_every: f32,
    pub trail_segments: f32,
    pub curl_scale: f32,
    pub size_variation: f32,
    pub strata_lines: u32,
    pub merge_seconds: f32,
    pub rotate_z: f32,
    pub auto_rotate_z: f32,
    pub zoom: f32,
    pub offset: [f32; 2],
    pub audio: AudioControls,
    pub motion: MotionControls,
    pub post: HdrPostSettings,
}

pub fn normalize_strands_params(params: &Value) -> StrandsParams {
    let d = strands_defs();
    let n = |key: &str| d.num(params, key);
    let (count, scale) = quality_from(params, [65_536, 131_072, 262_144, 524_288]);
    let particle_count = num(params, "particleCount", count as f32)
        .round()
        .clamp(STRANDS_MIN_PARTICLES as f32, STRANDS_MAX_PARTICLES as f32) as u32;
    let sides = n("sides").round() as u32;
    let mode = match d.choice(params, "shape") {
        "band" => ShapeMode::Band,
        "sequence" => ShapeMode::Sequence,
        "line" => ShapeMode::Fixed(EmitterKind::Line, 0),
        "ring" => ShapeMode::Fixed(EmitterKind::Ring, 0),
        "square" => ShapeMode::Fixed(EmitterKind::Polygon, 4),
        "polygon" => ShapeMode::Fixed(EmitterKind::Polygon, sides),
        "strata" => ShapeMode::Fixed(EmitterKind::Strata, 0),
        _ => ShapeMode::Cycle,
    };
    let mut palette = palette_by_name(d.choice(params, "palette"));
    if d.flag(params, "customColors") {
        let a = d.rgb(params, "colorA");
        let b = d.rgb(params, "colorB");
        palette.core = [a[0], a[1], a[2], palette.core[3]];
        palette.fringe = [b[0], b[1], b[2], palette.fringe[3]];
    }
    // The glow takes the palette's mid tone, half way to white.
    let tint = {
        let m = palette.mid;
        let peak = m[0].max(m[1]).max(m[2]).max(1e-3);
        [0.5 + 0.5 * m[0] / peak, 0.5 + 0.5 * m[1] / peak, 0.5 + 0.5 * m[2] / peak]
    };
    // Brightness is per particle; keep the overall picture steady across
    // particle budgets.
    let density = (particle_count as f32 / 262_144.0).max(0.0625);
    StrandsParams {
        particle_count,
        accum_scale: scale,
        mode,
        palette,
        speed: n("speed"),
        fray: n("fray"),
        drag: n("drag"),
        displacement: n("displacement"),
        width_px: n("width"),
        brightness: n("intensity") * 0.045 / density,
        lifetime: n("lifetime"),
        fibres: n("fibres"),
        jitter: num(params, "jitter", 0.05).clamp(0.0, 1.0),
        cooling: n("cooling"),
        wave_mix: n("waveform"),
        size: n("size"),
        core_share: n("coreShare"),
        core_life: num(params, "coreLife", 0.22).clamp(0.02, 2.0),
        inward: n("inward"),
        max_shapes: n("maxShapes").round() as usize,
        change_every: d.choice(params, "changeEvery").parse::<f32>().unwrap_or(0.0),
        trail_segments: n("trail").round(),
        curl_scale: n("curl"),
        size_variation: n("sizeVariation"),
        strata_lines: n("strataLines").round() as u32,
        merge_seconds: n("cooldown"),
        rotate_z: n("rotateZ").to_radians(),
        auto_rotate_z: n("autoRotateZ").to_radians(),
        zoom: n("zoom"),
        offset: [n("offsetX"), n("offsetY")],
        audio: AudioControls::read(&d, params),
        motion: MotionControls::read(&d, params),
        post: HdrPostSettings {
            decay: n("trails"),
            zoom: n("drift"),
            swirl: n("swirl"),
            flow: num(params, "smear", 0.0004).clamp(0.0, 0.01),
            bloom_strength: n("bloom"),
            threshold: n("bloomThreshold"),
            split: n("split"),
            exposure: n("exposure"),
            vignette: num(params, "vignette", 0.3).clamp(0.0, 1.0),
            dither: 1.0,
            tint,
            burn: num(params, "burn", 0.5).clamp(0.0, 1.0),
            contrast: n("contrast"),
            opacity: n("opacity"),
        },
    }
}

/// Where a launched shape is in its life. Explicit, so a shape can only
/// move forward: Attack -> Hold -> Release -> gone.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum ShapePhase {
    /// Just hit: fires the idle particle pool.
    Attack,
    /// The newest shape keeps emitting with the music's level.
    Hold,
    /// Replaced (or held too long): emission fades to nothing.
    Release { since: f32 },
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LaunchedShape {
    pub kind: EmitterKind,
    pub sides: u32,
    pub count: u32,
    pub center: [f32; 2],
    pub size: [f32; 2],
    pub rotation: f32,
    pub band: OnsetBand,
    pub strength: f32,
    pub seed: f32,
    pub born: f32,
    pub phase: ShapePhase,
}

impl LaunchedShape {
    pub fn emission(&self, now: f32, level: f32) -> f32 {
        let hold = self.strength * (0.004 + 0.05 * level.clamp(0.0, 1.5));
        match self.phase {
            ShapePhase::Attack => self.strength * 0.55,
            ShapePhase::Hold => hold,
            ShapePhase::Release { since } => hold * (1.0 - (now - since) / RELEASE_SECONDS).clamp(0.0, 1.0),
        }
    }
}

fn hash01(seed: u32) -> f32 {
    let mut x = seed.wrapping_mul(0x9E37_79B9) ^ 0x85EB_CA6B;
    x ^= x >> 16;
    x = x.wrapping_mul(0x7FEB_352D);
    x ^= x >> 15;
    x = x.wrapping_mul(0x846C_A68B);
    x ^= x >> 16;
    x as f32 / u32::MAX as f32
}

/// Live limits on how shapes launch and stay (from the params each frame).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ShapeRules {
    pub merge_seconds: f32,
    /// 0 = a random 4..6 lines.
    pub strata_lines: u32,
    pub max_visible: usize,
    /// Beats each Cycle/Sequence step holds; 0 = advance on every launch.
    pub change_every: f32,
}

impl Default for ShapeRules {
    fn default() -> Self {
        Self { merge_seconds: MERGE_SECONDS, strata_lines: 0, max_visible: MAX_VISIBLE_SHAPES, change_every: 0.0 }
    }
}

/// Launched shapes, bounded to `MAX_SHAPES`.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ShapeQueue {
    pub shapes: Vec<LaunchedShape>,
    pub last_seq: u32,
    pub launches: u32,
    pub rules: ShapeRules,
    /// Beats elapsed on the music clock (from the packet's bpm), for steps
    /// that hold a number of beats.
    pub beats: f32,
}

impl ShapeQueue {
    /// Launch shapes for hits the queue has not seen. `now` is the core's
    /// clock; the packet's own clock places each hit in it.
    pub fn ingest(&mut self, data: &AudioVisualData, now: f32, mode: ShapeMode, aspect: f32, size: f32) {
        if !data.active() {
            return;
        }
        let bpm = data.header(super::audio_data::H_BPM);
        if bpm.is_finite() && bpm > 1.0 {
            self.beats = data.time().max(0.0) * bpm / 60.0;
        }
        let fresh = data.events_after(self.last_seq, MAX_LAUNCHES_PER_FRAME);
        if let Some(last) = data.event(0) {
            // Older hits we skipped are never replayed.
            self.last_seq = self.last_seq.max(last.seq);
        }
        for event in fresh {
            let age = (data.time() - event.time).clamp(0.0, 0.5);
            self.launch(&event, now - age, mode, aspect, size);
        }
    }

    pub fn launch(&mut self, event: &OnsetEvent, born: f32, mode: ShapeMode, aspect: f32, size: f32) {
        if let Some(newest) = self.shapes.last_mut()
            && born - newest.born < self.rules.merge_seconds
        {
            newest.strength = newest.strength.max(event.strength.clamp(0.3, 1.6));
            return;
        }
        let n = self.launches;
        self.launches = self.launches.wrapping_add(1);
        // Which step of Cycle/Sequence: every launch, or held for N beats.
        let step = if self.rules.change_every > 0.0 {
            (self.beats / self.rules.change_every).floor().max(0.0) as u32
        } else {
            n
        };
        if mode == ShapeMode::Sequence {
            let parts = SEQUENCE_STEPS[step as usize % SEQUENCE_STEPS.len()];
            for (index, &(kind, sides)) in parts.iter().enumerate() {
                self.push_shape(event, born, kind, sides, aspect, size, index as u32);
            }
            return;
        }
        let (kind, sides) = match mode {
            ShapeMode::Fixed(kind, sides) => (kind, sides),
            ShapeMode::Sequence => unreachable!(),
            ShapeMode::Cycle => match step % 4 {
                0 => (EmitterKind::Line, 0),
                1 => (EmitterKind::Ring, 0),
                2 => (EmitterKind::Polygon, 4),
                _ => (EmitterKind::Strata, 0),
            },
            ShapeMode::Band => match event.band {
                OnsetBand::Bass if n % 3 == 2 => (EmitterKind::Polygon, 4),
                OnsetBand::Bass => (EmitterKind::Ring, 0),
                OnsetBand::Mid => (EmitterKind::Line, 0),
                OnsetBand::High => (EmitterKind::Strata, 0),
            },
        };
        self.push_shape(event, born, kind, sides, aspect, size, 0);
    }

    #[allow(clippy::too_many_arguments)]
    fn push_shape(&mut self, event: &OnsetEvent, born: f32, kind: EmitterKind, sides: u32, aspect: f32, size: f32, salt: u32) {
        let seed = hash01(event.seq.wrapping_mul(31).wrapping_add(7 + salt * 101));
        let r = |k: u32| hash01(event.seq.wrapping_mul(977).wrapping_add(k + salt * 53));
        let jitter = |salt: u32, amount: f32| (r(salt) - 0.5) * 2.0 * amount;
        let (center, shape_size, count, rotation) = match kind {
            EmitterKind::Line => ([jitter(1, aspect * 0.15), jitter(2, 0.03)], [0.0, 0.86 * size], 1, 0.0),
            EmitterKind::Ring => {
                let radius = (0.42 + r(3) * 0.16) * size;
                ([jitter(1, 0.06), jitter(2, 0.04)], [radius, radius], 1, 0.0)
            }
            EmitterKind::Polygon => {
                let radius = (0.56 + r(3) * 0.12) * size;
                let tilt = if sides == 4 && r(4) > 0.8 { std::f32::consts::FRAC_PI_4 } else { 0.0 };
                ([jitter(1, 0.05), jitter(2, 0.03)], [radius, radius], 1, tilt)
            }
            EmitterKind::Strata => {
                let lines = if self.rules.strata_lines > 0 { self.rules.strata_lines } else { 4 + (r(5) * 3.0) as u32 };
                ([jitter(1, 0.04), jitter(2, 0.04)], [aspect * 0.78 * size, 0.42 * size], lines, 0.0)
            }
        };
        let shape = LaunchedShape {
            kind,
            sides: sides.max(3),
            count,
            center,
            size: shape_size,
            rotation,
            band: event.band,
            strength: event.strength.clamp(0.3, 1.6),
            seed,
            born,
            phase: ShapePhase::Attack,
        };
        if self.shapes.len() >= MAX_SHAPES {
            // Evict the oldest releasing shape, else the oldest of all.
            let victim = self
                .shapes
                .iter()
                .position(|s| matches!(s.phase, ShapePhase::Release { .. }))
                .unwrap_or(0);
            self.shapes.remove(victim);
        }
        self.shapes.push(shape);
    }

    /// Advance every shape's phase to `now` and drop the finished ones.
    pub fn step(&mut self, now: f32) {
        let newest_born = self.shapes.last().map(|s| s.born);
        for shape in self.shapes.iter_mut() {
            shape.phase = match shape.phase {
                ShapePhase::Attack if now - shape.born >= ATTACK_SECONDS => ShapePhase::Hold,
                ShapePhase::Hold if Some(shape.born) != newest_born || now - shape.born > MAX_HOLD_SECONDS => {
                    ShapePhase::Release { since: now }
                }
                phase => phase,
            };
        }
        // Shapes from a clock that has since jumped back go at once.
        self.shapes.retain(|shape| shape.born <= now + 0.1);
        self.shapes.retain(|shape| match shape.phase {
            ShapePhase::Release { since } => now - since < RELEASE_SECONDS,
            _ => true,
        });
        let excess = self.shapes.len().saturating_sub(self.rules.max_visible.clamp(1, MAX_SHAPES));
        self.shapes.drain(..excess);
    }
}

/// One frame of Strands on the CPU: the instrument's clock (scaled, or held
/// while frozen), the shaped audio, the manual trigger, the shapes, and the
/// uniform. Pure, so tests drive it exactly as the job builder does.
#[allow(clippy::too_many_arguments)]
pub fn step_strands_frame(
    queue: &mut ShapeQueue,
    shaper: &mut AudioShaper,
    clock: &mut f32,
    params: &StrandsParams,
    data: &AudioVisualData,
    dt: f32,
    width: u32,
    height: u32,
    frame: u64,
) -> (Vec<f32>, AudioVisualData) {
    let sim_dt = params.motion.sim_dt(dt);
    *clock += sim_dt;
    let now = *clock;
    let shaped = shaper.shape(data, &params.audio, sim_dt);
    let aspect = width as f32 / height.max(1) as f32;
    queue.rules = ShapeRules {
        merge_seconds: params.merge_seconds,
        strata_lines: params.strata_lines,
        max_visible: params.max_shapes,
        change_every: params.change_every,
    };
    if shaper.take_trigger(params.audio.trigger) {
        let manual = OnsetEvent { time: shaped.time(), band: OnsetBand::Bass, strength: 1.0, seq: 0 };
        queue.launch(&manual, now, params.mode, aspect, params.size);
    }
    queue.ingest(&shaped, now, params.mode, aspect, params.size);
    queue.step(now);
    (strands_uniform(params, queue, &shaped, width, height, now, sim_dt, frame), shaped)
}

/// The uniform both strands shaders read (`StrandsU`), as floats.
#[allow(clippy::too_many_arguments)]
pub fn strands_uniform(
    params: &StrandsParams,
    queue: &ShapeQueue,
    data: &AudioVisualData,
    width: u32,
    height: u32,
    time: f32,
    dt: f32,
    frame: u64,
) -> Vec<f32> {
    let level = data.header(H_LEVEL);
    let mut total = 0.0;
    let mut shapes = Vec::with_capacity(MAX_SHAPES * 16);
    for shape in queue.shapes.iter().take(MAX_SHAPES) {
        let emission = shape.emission(time, level);
        total += emission;
        let band_speed = match shape.band {
            OnsetBand::Bass => 1.0,
            OnsetBand::Mid => 1.15,
            OnsetBand::High => 1.3,
        };
        let spread = if shape.kind == EmitterKind::Strata { 0.6 } else { 0.25 };
        shapes.extend_from_slice(&[
            shape.kind as u32 as f32, shape.sides as f32, shape.count as f32, shape.seed,
            shape.center[0], shape.center[1], shape.size[0], shape.size[1],
            shape.rotation, emission, shape.strength, time - shape.born,
            shape.band as u32 as f32, 1.0, band_speed, spread,
        ]);
    }
    let mut live = queue.shapes.len().min(MAX_SHAPES);
    if live == 0 {
        // Silence: a faint resting ring keeps breathing, so a set never
        // opens on black. It draws only the dim fringe tone.
        let emission = 0.03;
        total += emission;
        shapes.extend_from_slice(&[
            EmitterKind::Ring as u32 as f32, 0.0, 1.0, 0.37,
            0.0, 0.0, 0.46, 0.46,
            0.0, emission, 0.7, 1.0,
            0.0, 0.8, 0.6, 0.25,
        ]);
        live = 1;
    }
    shapes.resize(MAX_SHAPES * 16, 0.0);
    let p = &params.palette;
    let mut u = vec![
        width as f32, height as f32, width as f32 / height.max(1) as f32, params.particle_count as f32,
        time, dt, (frame % 16_777_216) as f32, total,
        params.speed, params.fray, params.drag, params.displacement,
        0.0, params.width_px, params.brightness, params.lifetime,
        params.fibres, params.jitter, params.cooling, params.wave_mix,
        level, data.header(H_ENV_BASS), data.header(H_ENV_MID), data.header(H_ENV_HIGH),
        p.core[0], p.core[1], p.core[2], p.core[3],
        p.mid[0], p.mid[1], p.mid[2], p.mid[3],
        p.fringe[0], p.fringe[1], p.fringe[2], p.fringe[3],
        live as f32, params.core_share, params.core_life, params.inward,
    ];
    // The 2D camera: the whole picture turns, zooms and pans.
    let angle = params.rotate_z + params.auto_rotate_z * time;
    u.extend_from_slice(&[angle.cos(), angle.sin(), params.zoom, params.size_variation]);
    u.extend_from_slice(&[params.offset[0], params.offset[1], params.curl_scale, params.trail_segments]);
    u.extend_from_slice(&shapes);
    u
}

#[cfg(test)]
mod tests {
    use super::*;

    fn event(seq: u32, band: OnsetBand) -> OnsetEvent {
        OnsetEvent { time: 0.0, band, strength: 1.0, seq }
    }

    #[test]
    fn a_shape_moves_attack_hold_release_then_leaves() {
        let mut queue = ShapeQueue::default();
        queue.launch(&event(1, OnsetBand::Bass), 0.0, ShapeMode::Cycle, 1.78, 1.0);
        assert_eq!(queue.shapes[0].phase, ShapePhase::Attack);
        queue.step(0.03);
        assert_eq!(queue.shapes[0].phase, ShapePhase::Attack);
        queue.step(0.1);
        assert_eq!(queue.shapes[0].phase, ShapePhase::Hold);
        queue.launch(&event(2, OnsetBand::Mid), 0.5, ShapeMode::Cycle, 1.78, 1.0);
        queue.step(0.5);
        assert!(matches!(queue.shapes[0].phase, ShapePhase::Release { since } if since == 0.5));
        assert_eq!(queue.shapes[1].phase, ShapePhase::Attack);
        queue.step(0.5 + RELEASE_SECONDS + 0.01);
        assert_eq!(queue.shapes.len(), 1);
        assert_eq!(queue.shapes[0].band, OnsetBand::Mid);
    }

    #[test]
    fn the_newest_shape_holds_only_so_long() {
        let mut queue = ShapeQueue::default();
        queue.launch(&event(1, OnsetBand::Bass), 0.0, ShapeMode::Cycle, 1.78, 1.0);
        queue.step(1.0);
        assert_eq!(queue.shapes[0].phase, ShapePhase::Hold);
        queue.step(MAX_HOLD_SECONDS + 0.1);
        assert!(matches!(queue.shapes[0].phase, ShapePhase::Release { .. }));
        queue.step(MAX_HOLD_SECONDS + 0.2 + RELEASE_SECONDS);
        assert!(queue.shapes.is_empty());
    }

    #[test]
    fn queue_is_bounded_and_evicts_a_releasing_shape_first() {
        let mut queue = ShapeQueue::default();
        for seq in 0..20 {
            queue.launch(&event(seq + 1, OnsetBand::Bass), seq as f32 * 0.1, ShapeMode::Cycle, 1.78, 1.0);
            queue.step(seq as f32 * 0.1);
            assert!(queue.shapes.len() <= MAX_SHAPES);
        }
        assert_eq!(queue.shapes.last().unwrap().born, 1.9);
    }

    #[test]
    fn only_three_shapes_stay_visible_and_silence_keeps_a_resting_ring() {
        let mut queue = ShapeQueue::default();
        for seq in 0..6 {
            queue.launch(&event(seq + 1, OnsetBand::Bass), seq as f32 * 0.1, ShapeMode::Cycle, 1.78, 1.0);
            queue.step(seq as f32 * 0.1);
        }
        assert_eq!(queue.shapes.len(), MAX_VISIBLE_SHAPES);
        assert_eq!(queue.shapes.last().unwrap().born, 0.5);
        let params = normalize_strands_params(&serde_json::json!({}));
        let quiet = strands_uniform(&params, &ShapeQueue::default(), &AudioVisualData::default(), 1920, 1080, 0.0, 1.0 / 60.0, 1);
        assert_eq!(quiet[36], 1.0, "one resting shape");
        assert!(quiet[7] > 0.0 && quiet[7] < 0.1, "a faint one");
    }

    #[test]
    fn hits_closer_than_the_merge_window_feed_the_newest_shape() {
        let mut queue = ShapeQueue::default();
        queue.launch(&OnsetEvent { strength: 0.5, ..event(1, OnsetBand::Bass) }, 0.0, ShapeMode::Cycle, 1.78, 1.0);
        queue.launch(&OnsetEvent { strength: 1.2, ..event(2, OnsetBand::High) }, 0.03, ShapeMode::Cycle, 1.78, 1.0);
        assert_eq!(queue.shapes.len(), 1);
        assert_eq!(queue.shapes[0].strength, 1.2);
    }

    #[test]
    fn sequence_holds_each_step_for_the_chosen_beats_and_launches_combos() {
        let mut queue = ShapeQueue::default();
        queue.rules.change_every = 4.0;
        queue.rules.max_visible = 8;
        // Beats 0..3: step 0 (a line), every hit.
        for seq in 0..3u32 {
            queue.beats = seq as f32;
            queue.launch(&event(seq + 1, OnsetBand::Bass), seq as f32, ShapeMode::Sequence, 1.78, 1.0);
            assert_eq!(queue.shapes.last().unwrap().kind, EmitterKind::Line);
        }
        // Beats 8..: step 2 = ring + lines, launched together and both held.
        queue.beats = 8.5;
        let before = queue.shapes.len();
        queue.launch(&event(10, OnsetBand::Bass), 10.0, ShapeMode::Sequence, 1.78, 1.0);
        let added: Vec<_> = queue.shapes[before..].iter().map(|s| s.kind).collect();
        assert_eq!(added, vec![EmitterKind::Ring, EmitterKind::Line]);
        queue.step(10.5);
        queue.step(10.6);
        let held = queue.shapes.iter().filter(|s| matches!(s.phase, ShapePhase::Hold | ShapePhase::Attack)).count();
        assert_eq!(held, 2);
        // Cycle held for a bar keeps one shape over many hits.
        let mut cycle = ShapeQueue::default();
        cycle.rules.change_every = 4.0;
        for seq in 0..4u32 {
            cycle.beats = 1.0 + seq as f32 * 0.5;
            cycle.launch(&event(seq + 1, OnsetBand::Bass), seq as f32, ShapeMode::Cycle, 1.78, 1.0);
        }
        assert!(cycle.shapes.iter().all(|s| s.kind == EmitterKind::Line));
    }

    #[test]
    fn shape_choice_cycles_or_follows_the_band() {
        let mut cycle = ShapeQueue::default();
        let kinds: Vec<EmitterKind> = (0..4)
            .map(|seq| {
                cycle.launch(&event(seq + 1, OnsetBand::Bass), seq as f32, ShapeMode::Cycle, 1.78, 1.0);
                cycle.shapes.last().unwrap().kind
            })
            .collect();
        assert_eq!(kinds, vec![EmitterKind::Line, EmitterKind::Ring, EmitterKind::Polygon, EmitterKind::Strata]);
        let mut band = ShapeQueue::default();
        band.launch(&event(1, OnsetBand::High), 0.0, ShapeMode::Band, 1.78, 1.0);
        band.launch(&event(2, OnsetBand::Mid), 1.0, ShapeMode::Band, 1.78, 1.0);
        assert_eq!(band.shapes[0].kind, EmitterKind::Strata);
        assert_eq!(band.shapes[1].kind, EmitterKind::Line);
    }

    #[test]
    fn uniform_has_the_layout_the_shader_declares() {
        let params = normalize_strands_params(&serde_json::json!({}));
        let mut queue = ShapeQueue::default();
        queue.launch(&event(1, OnsetBand::Bass), 0.0, ShapeMode::Cycle, 1.78, 1.0);
        let u = strands_uniform(&params, &queue, &AudioVisualData::default(), 1920, 1080, 0.01, 1.0 / 60.0, 1);
        // 12 vec4 header + 8 shapes x 4 vec4.
        assert_eq!(u.len(), 12 * 4 + MAX_SHAPES * 16);
        assert_eq!(u[36], 1.0, "one live shape");
        assert!(u[7] > 0.5, "an attacking shape fires the pool");
    }

    #[test]
    fn params_are_bounded_and_quality_picks_the_budget() {
        let p = normalize_strands_params(&serde_json::json!({ "particleCount": 1e9, "shape": "square" }));
        assert_eq!(p.particle_count, STRANDS_MAX_PARTICLES);
        assert_eq!(p.mode, ShapeMode::Fixed(EmitterKind::Polygon, 4));
        let low = normalize_strands_params(&serde_json::json!({ "quality": "low" }));
        assert_eq!(low.particle_count, 65_536);
        let ultra = normalize_strands_params(&serde_json::json!({ "quality": "ultra" }));
        assert_eq!(ultra.particle_count, 524_288);
    }
}
