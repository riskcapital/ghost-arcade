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
use super::params::{num, text, Palette3, palette_by_name, quality_from};

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
pub const RELEASE_SECONDS: f32 = 0.9;
pub const MAX_HOLD_SECONDS: f32 = 6.0;
/// Hits closer together than this feed the newest shape instead of making
/// a new one.
pub const MERGE_SECONDS: f32 = 0.06;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ShapeMode {
    Cycle,
    Band,
    Fixed(EmitterKind, u32),
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
    pub streak: f32,
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
    pub post: HdrPostSettings,
}

pub fn normalize_strands_params(params: &Value) -> StrandsParams {
    let (count, scale) = quality_from(params, [65_536, 131_072, 262_144, 524_288]);
    let particle_count = num(params, "particleCount", count as f32)
        .round()
        .clamp(STRANDS_MIN_PARTICLES as f32, STRANDS_MAX_PARTICLES as f32) as u32;
    let sides = num(params, "sides", 4.0).round().clamp(3.0, 12.0) as u32;
    let mode = match text(params, "shape").as_str() {
        "band" => ShapeMode::Band,
        "line" => ShapeMode::Fixed(EmitterKind::Line, 0),
        "ring" | "circle" => ShapeMode::Fixed(EmitterKind::Ring, 0),
        "square" => ShapeMode::Fixed(EmitterKind::Polygon, 4),
        "polygon" => ShapeMode::Fixed(EmitterKind::Polygon, sides),
        "strata" => ShapeMode::Fixed(EmitterKind::Strata, 0),
        _ => ShapeMode::Cycle,
    };
    let palette = palette_by_name(&text(params, "palette"));
    // The glow takes the palette's mid tone, half way to white.
    let tint = {
        let m = palette.mid;
        let peak = m[0].max(m[1]).max(m[2]).max(1e-3);
        [0.5 + 0.5 * m[0] / peak, 0.5 + 0.5 * m[1] / peak, 0.5 + 0.5 * m[2] / peak]
    };
    // Brightness is per particle; keep the overall picture steady across
    // particle budgets.
    let density = (particle_count as f32 / 262_144.0).max(0.0625);
    let trails = num(params, "trails", 0.9).clamp(0.0, 0.97);
    StrandsParams {
        particle_count,
        accum_scale: scale,
        mode,
        palette,
        speed: num(params, "speed", 0.5).clamp(0.0, 4.0),
        fray: num(params, "fray", 1.0).clamp(0.0, 8.0),
        drag: num(params, "drag", 1.2).clamp(0.0, 12.0),
        displacement: num(params, "displacement", 0.07).clamp(0.0, 1.0),
        streak: num(params, "streak", 0.03).clamp(0.0, 0.2),
        width_px: num(params, "width", 0.6).clamp(0.4, 4.0),
        brightness: num(params, "intensity", 1.0).clamp(0.0, 8.0) * 0.045 / density,
        lifetime: num(params, "lifetime", 1.4).clamp(0.1, 6.0),
        fibres: num(params, "fibres", 420.0).clamp(16.0, 20_000.0),
        jitter: num(params, "jitter", 0.05).clamp(0.0, 1.0),
        cooling: num(params, "cooling", 1.5).clamp(0.0, 12.0),
        wave_mix: num(params, "waveform", 0.6).clamp(0.0, 2.0),
        size: num(params, "size", 1.0).clamp(0.2, 2.0),
        core_share: num(params, "coreShare", 0.35).clamp(0.0, 1.0),
        core_life: num(params, "coreLife", 0.22).clamp(0.02, 2.0),
        inward: num(params, "inward", 0.06).clamp(0.0, 1.0),
        post: HdrPostSettings {
            decay: trails,
            zoom: num(params, "drift", 0.003).clamp(0.0, 0.02),
            swirl: num(params, "swirl", 0.0006).clamp(-0.02, 0.02),
            flow: num(params, "smear", 0.0004).clamp(0.0, 0.01),
            bloom_strength: num(params, "bloom", 0.8).clamp(0.0, 4.0),
            threshold: num(params, "bloomThreshold", 0.6).clamp(0.0, 4.0),
            split: num(params, "split", 0.0035).clamp(0.0, 0.03),
            exposure: num(params, "exposure", 1.0).clamp(0.05, 8.0),
            vignette: num(params, "vignette", 0.3).clamp(0.0, 1.0),
            dither: 1.0,
            tint,
            burn: num(params, "burn", 0.5).clamp(0.0, 1.0),
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

/// Launched shapes, bounded to `MAX_SHAPES`.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ShapeQueue {
    pub shapes: Vec<LaunchedShape>,
    pub last_seq: u32,
    pub launches: u32,
}

impl ShapeQueue {
    /// Launch shapes for hits the queue has not seen. `now` is the core's
    /// clock; the packet's own clock places each hit in it.
    pub fn ingest(&mut self, data: &AudioVisualData, now: f32, mode: ShapeMode, aspect: f32, size: f32) {
        if !data.active() {
            return;
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
            && born - newest.born < MERGE_SECONDS
        {
            newest.strength = newest.strength.max(event.strength.clamp(0.3, 1.6));
            return;
        }
        let n = self.launches;
        self.launches = self.launches.wrapping_add(1);
        let seed = hash01(event.seq.wrapping_mul(31).wrapping_add(7));
        let r = |salt: u32| hash01(event.seq.wrapping_mul(977).wrapping_add(salt));
        let (kind, sides) = match mode {
            ShapeMode::Fixed(kind, sides) => (kind, sides),
            ShapeMode::Cycle => match n % 4 {
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
                let lines = 4 + (r(5) * 3.0) as u32;
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
        let newest = self.shapes.len().saturating_sub(1);
        for (index, shape) in self.shapes.iter_mut().enumerate() {
            shape.phase = match shape.phase {
                ShapePhase::Attack if now - shape.born >= ATTACK_SECONDS => ShapePhase::Hold,
                ShapePhase::Hold if index != newest || now - shape.born > MAX_HOLD_SECONDS => {
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
    }
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
    let live = queue.shapes.len().min(MAX_SHAPES);
    shapes.resize(MAX_SHAPES * 16, 0.0);
    let p = &params.palette;
    let mut u = vec![
        width as f32, height as f32, width as f32 / height.max(1) as f32, params.particle_count as f32,
        time, dt, (frame % 16_777_216) as f32, total,
        params.speed, params.fray, params.drag, params.displacement,
        params.streak, params.width_px, params.brightness, params.lifetime,
        params.fibres, params.jitter, params.cooling, params.wave_mix,
        level, data.header(H_ENV_BASS), data.header(H_ENV_MID), data.header(H_ENV_HIGH),
        p.core[0], p.core[1], p.core[2], p.core[3],
        p.mid[0], p.mid[1], p.mid[2], p.mid[3],
        p.fringe[0], p.fringe[1], p.fringe[2], p.fringe[3],
        live as f32, params.core_share, params.core_life, params.inward,
    ];
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
    fn hits_closer_than_the_merge_window_feed_the_newest_shape() {
        let mut queue = ShapeQueue::default();
        queue.launch(&OnsetEvent { strength: 0.5, ..event(1, OnsetBand::Bass) }, 0.0, ShapeMode::Cycle, 1.78, 1.0);
        queue.launch(&OnsetEvent { strength: 1.2, ..event(2, OnsetBand::High) }, 0.03, ShapeMode::Cycle, 1.78, 1.0);
        assert_eq!(queue.shapes.len(), 1);
        assert_eq!(queue.shapes[0].strength, 1.2);
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
        // 10 vec4 header + 8 shapes x 4 vec4.
        assert_eq!(u.len(), 10 * 4 + MAX_SHAPES * 16);
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
