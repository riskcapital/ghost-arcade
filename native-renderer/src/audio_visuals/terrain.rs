//! Spectral Terrain: the spectrogram's history as a lit landscape. A ring
//! buffer of spectrum rows (one per row tick, written on the GPU straight
//! from the audio packet) is a heightfield mesh; the newest row is the live
//! edge nearest the camera and the past recedes into fog, scrolling smoothly
//! between ticks. The camera flies low over it with a slow deterministic
//! sway. Styles: lit solid, wireframe, or solid with glowing contour lines.
//! CPU side: params, palettes, the row clock and the uniform
//! (`wgsl/terrain_*.wgsl`).

use serde_json::Value;

use super::audio_data::{AV_SPECTRUM_BINS, AudioVisualData};
use super::controls2::{
    AudioConditioner, AudioControls, AudioFrame, CameraControls, CameraKind, CommonDefaults, MotionClock, ParamDef, Reader,
    audio_controls, camera_controls, common_defs, finish_floats, orbit_camera3, palette_with_overrides, post_from, resets,
    slider, toggle,
};
use super::hdr_post::HdrPostSettings;
use super::kit::{Camera, glow_tint, palette_floats, palette_named, pick};
use super::params::Palette3;

pub const TERRAIN_BINS: u32 = AV_SPECTRUM_BINS as u32;
pub const MAX_ROWS: u32 = 512;
/// At most this many rows are written in one frame (a long stall does not
/// flush the whole history with one spectrum).
pub const MAX_ROWS_PER_FRAME: u32 = 2;

/// `fringe` is the valley floor, `mid` the slopes and peaks, `core` the lines
/// and the live edge.
pub const TERRAIN_PALETTES: &[(&str, Palette3)] = &[
    (
        "nightfall",
        Palette3 { core: [0.7, 0.86, 1.0, 4.0], mid: [0.34, 0.5, 0.74, 0.32], fringe: [0.012, 0.02, 0.05, 1.0] },
    ),
    (
        "ember-ridge",
        Palette3 { core: [1.0, 0.75, 0.35, 5.0], mid: [1.0, 0.32, 0.08, 0.55], fringe: [0.07, 0.025, 0.025, 1.0] },
    ),
    (
        "polar",
        Palette3 { core: [0.7, 1.0, 0.95, 5.0], mid: [0.8, 0.9, 1.0, 0.5], fringe: [0.015, 0.05, 0.08, 1.0] },
    ),
];

pub const TERRAIN_PALETTE_NAMES: &[&str] = &["nightfall", "ember-ridge", "polar"];

fn defaults() -> CommonDefaults {
    CommonDefaults {
        camera: CameraKind::Orbit3D,
        quality: "medium",
        fov: 52.0,
        post: HdrPostSettings {
            decay: 0.0,
            zoom: 0.0,
            swirl: 0.0,
            flow: 0.0,
            bloom_strength: 0.8,
            threshold: 0.9,
            split: 0.002,
            exposure: 1.0,
            vignette: 0.45,
            dither: 1.0,
            burn: 0.4,
            tint: [1.0; 3],
            contrast: 1.0,
            opacity: 1.0,
        },
        level_band: "bass",
        palettes: TERRAIN_PALETTE_NAMES,
    }
}

pub fn terrain_defs() -> Vec<ParamDef> {
    let mut defs = vec![
        resets(slider("history", "History (rows)", "Terrain", 16.0, MAX_ROWS as f32, 1.0, 192.0)),
        slider("heightScale", "Height", "Terrain", 0.0, 4.0, 0.01, 0.7),
        slider("flightSpeed", "Flight speed (rows/s)", "Terrain", 5.0, 120.0, 0.1, 40.0),
        slider("width", "Width", "Terrain", 1.0, 40.0, 0.01, 9.0),
        slider("spacing", "Row spacing", "Terrain", 0.005, 0.3, 0.001, 0.055),
        toggle("mirror", "Mirror (bass in the middle)", "Terrain", true),
        toggle("wireframe", "Wireframe", "Terrain", false),
        slider("wireDensity", "Wire density", "Terrain", 0.125, 2.0, 0.005, 1.0),
        toggle("contours", "Contour lines", "Terrain", true),
        slider("contourDensity", "Contour density", "Terrain", 1.0, 60.0, 0.1, 9.0),
        slider("lineWidth", "Line thickness", "Terrain", 0.3, 4.0, 0.01, 1.1),
        slider("lineGlow", "Line glow", "Terrain", 0.0, 8.0, 0.01, 1.0),
        slider("fog", "Fog", "Terrain", 0.0, 4.0, 0.01, 0.16),
        slider("cameraHeight", "Flight height", "Terrain", 0.1, 10.0, 0.01, 1.55),
    ];
    defs.extend(common_defs(&defaults()));
    defs
}

#[derive(Clone, Debug, PartialEq)]
pub struct TerrainParams {
    pub rows: u32,
    pub mirror: bool,
    pub row_rate: f32,
    pub width: f32,
    pub spacing: f32,
    pub amp: f32,
    pub wire: bool,
    pub wire_density: f32,
    pub contour: bool,
    pub contours: f32,
    pub line_width: f32,
    pub line_glow: f32,
    pub fog: f32,
    pub palette: Palette3,
    pub height: f32,
    pub camera: CameraControls,
    pub audio: AudioControls,
    pub finish: [f32; 4],
    pub post: HdrPostSettings,
}

pub fn normalize_terrain_params(params: &Value) -> TerrainParams {
    let r = Reader::new(params, terrain_defs());
    let d = defaults();
    let palette = palette_with_overrides(palette_named(TERRAIN_PALETTES, params), params);
    TerrainParams {
        rows: r.count("history", pick(params, [128u32, 192, 256])),
        mirror: r.b("mirror"),
        row_rate: r.f("flightSpeed"),
        width: r.f("width"),
        spacing: r.f("spacing"),
        amp: r.f("heightScale"),
        wire: r.b("wireframe"),
        wire_density: r.f("wireDensity"),
        contour: r.b("contours"),
        contours: r.f("contourDensity"),
        line_width: r.f("lineWidth"),
        line_glow: r.f("lineGlow"),
        fog: r.f("fog"),
        palette,
        height: r.f("cameraHeight"),
        camera: camera_controls(params, &d),
        audio: audio_controls(params, &d),
        finish: finish_floats(params, &d),
        post: post_from(params, &d, glow_tint(&palette)),
    }
}

/// The row clock. Explicit: Filling (the ring is not yet full, the far edge
/// grows) -> Scrolling (every tick overwrites the oldest row).
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub enum RowPhase {
    #[default]
    Filling,
    Scrolling,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct RowClock {
    pub phase: RowPhase,
    /// Rows written since the ring was made.
    pub written: u64,
    /// Row ticks counted so far on the core clock.
    pub ticks: i64,
}

impl RowClock {
    /// Advance to `now`; returns how many rows to write this frame.
    pub fn step(&mut self, now: f32, rate: f32, rows: u32) -> u32 {
        let ticks = (now.max(0.0) * rate).floor() as i64;
        let due = if self.written == 0 { 1 } else { (ticks - self.ticks).clamp(0, MAX_ROWS_PER_FRAME as i64) as u32 };
        self.ticks = ticks;
        self.written += u64::from(due);
        if self.written >= u64::from(rows) {
            self.phase = RowPhase::Scrolling;
        }
        due
    }

    /// The ring slot of the newest row.
    pub fn head(&self, rows: u32) -> u32 {
        (self.written.saturating_sub(1) % u64::from(rows)) as u32
    }

    pub fn filled(&self, rows: u32) -> u32 {
        self.written.min(u64::from(rows)) as u32
    }
}

pub fn terrain_camera(params: &TerrainParams, time: f32, angles: [f32; 3], aspect: f32) -> Camera {
    let sway = params.camera.sway * 0.6;
    let x = sway * (time * 0.11).sin();
    let y = params.height + 0.12 * (time * 0.17).sin();
    let eye = [x, y, 2.3];
    let target = [x * 0.4, 0.0, -4.0];
    orbit_camera3(eye, target, -0.04 * (time * 0.11).cos() * sway, &params.camera, angles, aspect, 60.0)
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct TerrainState {
    pub audio: AudioConditioner,
    pub motion: MotionClock,
    pub rows: RowClock,
    /// A hit flashes the live edge and the contours; it fades in about a
    /// quarter second.
    pub flash: f32,
}

pub struct TerrainFrame {
    pub params: TerrainParams,
    pub uniform: Vec<f32>,
    /// Rows the row pass writes this frame.
    pub due: u32,
}

pub fn terrain_frame(json: &Value, state: &mut TerrainState, data: &AudioVisualData, size: (u32, u32), core_dt: f32) -> TerrainFrame {
    let params = normalize_terrain_params(json);
    let step = state.motion.step(json, &params.camera, core_dt);
    let now = state.motion.time;
    let audio = state.audio.step_with(data, &params.audio, now, step, core_dt > 0.0, 4);
    let due = if step > 0.0 { state.rows.step(now, params.row_rate, params.rows) } else { 0 };
    if step > 0.0 {
        state.flash *= (-step * 4.0).exp();
        for (event, _) in &audio.hits {
            let lift = match event.band {
                super::audio_data::OnsetBand::Bass => 1.0,
                super::audio_data::OnsetBand::Mid => 0.7,
                super::audio_data::OnsetBand::High => 0.4,
            };
            state.flash = (state.flash + event.strength * lift).min(6.0);
        }
    }
    let uniform = terrain_uniform(&params, &state.rows, due, &audio, state.flash, state.motion.angles(&params.camera), size, now);
    TerrainFrame { params, uniform, due }
}

/// The uniform both terrain shaders read (`TerrainU`). `due` is how many rows
/// the row pass writes this frame (after `clock.step`).
pub fn terrain_uniform(
    params: &TerrainParams,
    clock: &RowClock,
    due: u32,
    audio: &AudioFrame,
    flash: f32,
    angles: [f32; 3],
    size: (u32, u32),
    time: f32,
) -> Vec<f32> {
    let (width, height) = size;
    let aspect = width as f32 / height.max(1) as f32;
    let cam = terrain_camera(params, time, angles, aspect);
    let mut u = cam.floats(params.fog);
    let cols = if params.mirror { (TERRAIN_BINS - 1) * 2 } else { TERRAIN_BINS - 1 };
    let frac = (time.max(0.0) * params.row_rate).fract();
    let head = clock.head(params.rows);
    // The slot the row pass starts writing at.
    let write_start = (head + params.rows + 1 - due.min(params.rows)) % params.rows;
    let flags = u32::from(params.wire) + 2 * u32::from(params.contour);
    let a = &params.audio;
    u.extend_from_slice(&[width as f32, height as f32, aspect, due as f32]);
    u.extend_from_slice(&[cols as f32, params.rows as f32, TERRAIN_BINS as f32, if params.mirror { 1.0 } else { 0.0 }]);
    u.extend_from_slice(&[time, frac, head as f32, clock.filled(params.rows) as f32]);
    u.extend_from_slice(&[params.width, params.spacing, params.amp, flags as f32]);
    u.extend_from_slice(&[params.contours, params.line_glow, write_start as f32, params.line_width]);
    u.extend_from_slice(&[a.sensitivity * a.gain[0], a.sensitivity * a.gain[1], a.sensitivity * a.gain[2], audio.levels[3]]);
    u.extend_from_slice(&[params.wire_density, audio.drive, flash.min(2.5), flash]);
    u.extend_from_slice(&palette_floats(&params.palette));
    u
}

#[cfg(test)]
mod tests {
    use super::super::controls2::probe;
    use super::*;

    #[test]
    fn rows_fill_then_scroll_at_the_row_rate() {
        let mut clock = RowClock::default();
        assert_eq!(clock.step(0.0, 40.0, 4), 1, "the first frame writes a row");
        assert_eq!(clock.phase, RowPhase::Filling);
        assert_eq!(clock.step(1.0 / 60.0, 40.0, 4), 0);
        assert_eq!(clock.step(2.0 / 60.0, 40.0, 4), 1);
        assert_eq!(clock.step(3.0 / 60.0, 40.0, 4), 1);
        assert_eq!(clock.step(4.0 / 60.0, 40.0, 4), 0);
        assert_eq!(clock.step(5.0 / 60.0, 40.0, 4), 1);
        assert_eq!(clock.phase, RowPhase::Scrolling);
        assert_eq!(clock.filled(4), 4);
        assert_eq!(clock.head(4), 3);
        clock.step(6.0 / 60.0, 40.0, 4);
        assert_eq!(clock.head(4), 0, "the ring wraps");
    }

    #[test]
    fn a_stall_writes_at_most_two_rows() {
        let mut clock = RowClock::default();
        clock.step(0.0, 40.0, 64);
        assert_eq!(clock.step(5.0, 40.0, 64), MAX_ROWS_PER_FRAME);
    }

    #[test]
    fn uniform_layout_and_write_start() {
        let p = normalize_terrain_params(&serde_json::json!({}));
        assert_eq!(p.rows, 192);
        let mut clock = RowClock::default();
        let due = clock.step(0.0, p.row_rate, p.rows);
        let u = terrain_uniform(&p, &clock, due, &AudioFrame::default(), 0.0, [0.0; 3], (1920, 1080), 0.0);
        assert_eq!(u.len(), 16 + 4 + 7 * 4 + 12);
        assert_eq!(u[20 + 16 + 2], 0.0, "the first row goes in slot 0");
        assert_eq!(u[20 + 4], 254.0, "mirrored: bass in the middle");
    }

    fn probe_frame(json: &Value) -> Vec<f32> {
        let mut state = TerrainState::default();
        probe::run(json, |p, data, _t, dt| {
            let f = terrain_frame(p, &mut state, data, (1920, 1080), dt);
            let mut out = f.uniform;
            out.extend(probe::post_floats(&f.params.post));
            out.extend(f.params.finish);
            out.push(f.due as f32);
            out
        })
    }

    #[test]
    fn every_param_parses_clamps_and_reaches_the_gpu() {
        probe::check_all("spectral-terrain", &terrain_defs(), probe_frame, &[]);
    }
}
