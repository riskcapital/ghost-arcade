//! Live controls shared by the second set of instruments: the parameter
//! definitions the app shows (grouped like the other layer controls), and
//! the parsing every instrument does each frame for camera, look, post,
//! audio and motion. Everything here is read every frame, so a change takes
//! effect at once without resetting the simulation; only quality and count
//! params (marked `resets`) rebuild buffers.

use serde_json::{Value, json};

use super::audio_data::{
    AudioVisualData, H_BASS, H_ENV_BASS, H_ENV_HIGH, H_ENV_MID, H_HIGH, H_LEVEL, H_MID, OnsetBand, OnsetEvent,
};
use super::hdr_post::HdrPostSettings;
use super::kit::{Camera, fresh_hits, look_at};
use super::params::{Palette3, num, text};

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum ParamKind {
    Slider { min: f32, max: f32, step: f32 },
    Select(&'static [&'static str]),
    Toggle,
    /// A colour as "#rrggbb"; empty = the palette's own.
    Color,
    Text,
    /// A momentary button: the app bumps the number; each change fires.
    Button,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum ParamDefault {
    Num(f32),
    Str(&'static str),
    Bool(bool),
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ParamDef {
    pub key: &'static str,
    pub label: &'static str,
    pub group: &'static str,
    pub kind: ParamKind,
    pub default: ParamDefault,
    /// Changing it rebuilds the instrument's buffers (quality and counts).
    pub resets: bool,
}

pub const fn slider(key: &'static str, label: &'static str, group: &'static str, min: f32, max: f32, step: f32, default: f32) -> ParamDef {
    ParamDef { key, label, group, kind: ParamKind::Slider { min, max, step }, default: ParamDefault::Num(default), resets: false }
}

pub const fn select(key: &'static str, label: &'static str, group: &'static str, options: &'static [&'static str], default: &'static str) -> ParamDef {
    ParamDef { key, label, group, kind: ParamKind::Select(options), default: ParamDefault::Str(default), resets: false }
}

pub const fn toggle(key: &'static str, label: &'static str, group: &'static str, default: bool) -> ParamDef {
    ParamDef { key, label, group, kind: ParamKind::Toggle, default: ParamDefault::Bool(default), resets: false }
}

pub const fn resets(mut def: ParamDef) -> ParamDef {
    def.resets = true;
    def
}

pub const QUALITY: &[&str] = &["low", "medium", "high"];
pub const BANDS: &[&str] = &["bass", "mid", "high"];
pub const LAUNCH_BANDS: &[&str] = &["all", "bass", "mid", "high", "bass-mid", "mid-high"];
pub const LEVEL_BANDS: &[&str] = &["bass", "mid", "high", "level"];

/// What a 3D or a 2D instrument's camera block offers.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CameraKind {
    Orbit3D,
    Picture2D,
}

/// The defaults an instrument gives the shared groups.
#[derive(Clone, Copy, Debug)]
pub struct CommonDefaults {
    pub camera: CameraKind,
    /// The default quality tier: "low" where a base M1 would miss 60 fps.
    pub quality: &'static str,
    pub fov: f32,
    pub post: HdrPostSettings,
    pub level_band: &'static str,
    pub palettes: &'static [&'static str],
}

/// The shared groups, in the order the app shows them after the
/// instrument's own group: Camera, Look, Post, Audio, Motion.
pub fn common_defs(d: &CommonDefaults) -> Vec<ParamDef> {
    let mut defs = vec![
        resets(select("quality", "Quality", "Look", QUALITY, d.quality)),
        select("palette", "Palette", "Look", d.palettes, d.palettes[0]),
        ParamDef { key: "colorA", label: "Colour A", group: "Look", kind: ParamKind::Color, default: ParamDefault::Str(""), resets: false },
        ParamDef { key: "colorB", label: "Colour B", group: "Look", kind: ParamKind::Color, default: ParamDefault::Str(""), resets: false },
        slider("brightness", "Brightness", "Look", 0.0, 4.0, 0.01, 1.0),
        slider("contrast", "Contrast", "Look", 0.25, 3.0, 0.01, 1.0),
        slider("opacity", "Opacity", "Look", 0.0, 1.0, 0.01, 1.0),
        slider("autoRotateX", "Auto-rotate X", "Camera", -90.0, 90.0, 0.1, 0.0),
        slider("autoRotateY", "Auto-rotate Y", "Camera", -90.0, 90.0, 0.1, 0.0),
        slider("autoRotateZ", "Auto-rotate Z", "Camera", -90.0, 90.0, 0.1, 0.0),
        slider("rotateX", "Rotate X", "Camera", -180.0, 180.0, 0.1, 0.0),
        slider("rotateY", "Rotate Y", "Camera", -180.0, 180.0, 0.1, 0.0),
        slider("rotateZ", "Rotate Z", "Camera", -180.0, 180.0, 0.1, 0.0),
        slider("distance", if d.camera == CameraKind::Orbit3D { "Distance" } else { "Zoom out" }, "Camera", 0.25, 4.0, 0.01, 1.0),
        slider("fov", "Field of view", "Camera", 10.0, 120.0, 0.5, d.fov),
        slider("sway", "Orbit sway", "Camera", 0.0, 4.0, 0.01, 1.0),
        slider("offsetX", "Offset X", "Camera", -3.0, 3.0, 0.001, 0.0),
        slider("offsetY", "Offset Y", "Camera", -3.0, 3.0, 0.001, 0.0),
        slider("bloom", "Bloom", "Post", 0.0, 4.0, 0.01, d.post.bloom_strength),
        slider("bloomThreshold", "Bloom threshold", "Post", 0.0, 4.0, 0.01, d.post.threshold),
        slider("trails", "Trails", "Post", 0.0, 0.97, 0.001, d.post.decay),
        slider("drift", "Drift", "Post", 0.0, 0.02, 0.0001, d.post.zoom),
        slider("trailSwirl", "Trail swirl", "Post", -0.02, 0.02, 0.0001, d.post.swirl),
        slider("split", "RGB split", "Post", 0.0, 0.03, 0.0001, d.post.split),
        slider("sensitivity", "Sensitivity", "Audio", 0.0, 4.0, 0.01, 1.0),
        slider("bassGain", "Bass gain", "Audio", 0.0, 4.0, 0.01, 1.0),
        slider("midGain", "Mid gain", "Audio", 0.0, 4.0, 0.01, 1.0),
        slider("highGain", "High gain", "Audio", 0.0, 4.0, 0.01, 1.0),
        slider("onsetThreshold", "Onset threshold", "Audio", 0.0, 2.0, 0.01, 0.3),
        slider("attack", "Attack", "Audio", 0.0, 1.0, 0.001, 0.02),
        slider("release", "Release", "Audio", 0.0, 2.0, 0.001, 0.25),
        select("launchBands", "Hits from", "Audio", LAUNCH_BANDS, "all"),
        select("levelBand", "Level from", "Audio", LEVEL_BANDS, d.level_band),
        select("triggerBand", "Trigger band", "Audio", BANDS, "bass"),
        ParamDef { key: "trigger", label: "Trigger", group: "Audio", kind: ParamKind::Button, default: ParamDefault::Num(0.0), resets: false },
        slider("speed", "Speed", "Motion", 0.0, 4.0, 0.01, 1.0),
        toggle("freeze", "Freeze", "Motion", false),
    ];
    if d.camera == CameraKind::Orbit3D {
        defs.push(slider("offsetZ", "Offset Z", "Camera", -3.0, 3.0, 0.001, 0.0));
    }
    defs
}

pub fn defs_json(defs: &[ParamDef]) -> Value {
    Value::Array(
        defs.iter()
            .map(|d| {
                let default = match d.default {
                    ParamDefault::Num(v) => json!(v),
                    ParamDefault::Str(s) => json!(s),
                    ParamDefault::Bool(b) => json!(b),
                };
                let mut out = json!({ "key": d.key, "label": d.label, "group": d.group, "default": default, "resets": d.resets });
                match d.kind {
                    ParamKind::Slider { min, max, step } => {
                        out["type"] = json!("slider");
                        out["min"] = json!(min);
                        out["max"] = json!(max);
                        out["step"] = json!(step);
                    }
                    ParamKind::Select(options) => {
                        out["type"] = json!("select");
                        out["options"] = json!(options);
                    }
                    ParamKind::Toggle => out["type"] = json!("toggle"),
                    // "#rrggbb" in sRGB; empty = the palette's own colour.
                    ParamKind::Color => {
                        out["type"] = json!("color");
                        out["format"] = json!("#rrggbb");
                        out["allowEmpty"] = json!(true);
                    }
                    ParamKind::Text => out["type"] = json!("text"),
                    // A momentary button: the panel bumps the number on each
                    // press; each change of value fires once.
                    ParamKind::Button => {
                        out["type"] = json!("button");
                        out["momentary"] = json!(true);
                        out["fire"] = json!("increment");
                    }
                }
                out
            })
            .collect(),
    )
}

/// The definitions in the layer panel's `ParamControl` shape (kind, key,
/// label, group, range, default). Colours default to white in the panel and
/// only override the palette once set; the Trigger is a button that flips a
/// toggle; the cloud path is the panel's .ply file picker.
pub fn panel_defs_json(defs: &[ParamDef]) -> Value {
    Value::Array(
        defs.iter()
            .map(|d| {
                let mut out = match (d.kind, d.default) {
                    (ParamKind::Slider { min, max, step }, ParamDefault::Num(v)) => {
                        json!({ "kind": "slider", "min": min, "max": max, "step": step, "default": v })
                    }
                    (ParamKind::Slider { min, max, step }, _) => json!({ "kind": "slider", "min": min, "max": max, "step": step, "default": min }),
                    (ParamKind::Select(options), default) => json!({
                        "kind": "select",
                        "options": options.iter().map(|o| json!({ "value": o, "label": title_case(o) })).collect::<Vec<_>>(),
                        "default": match default { ParamDefault::Str(s) => json!(s), _ => json!(options.first()) },
                    }),
                    (ParamKind::Toggle, ParamDefault::Bool(b)) => json!({ "kind": "toggle", "default": b }),
                    (ParamKind::Toggle, _) => json!({ "kind": "toggle", "default": false }),
                    (ParamKind::Color, _) => json!({ "kind": "color", "default": [255, 255, 255] }),
                    (ParamKind::Text, _) if d.key == "path" => json!({ "kind": "media-source", "sources": ["file"], "accept": ".ply" }),
                    (ParamKind::Text, ParamDefault::Str(s)) => json!({ "kind": "text", "default": s }),
                    (ParamKind::Text, _) => json!({ "kind": "text", "default": "" }),
                    (ParamKind::Button, _) => json!({ "kind": "toggle", "default": false, "button": true }),
                };
                out["key"] = json!(d.key);
                out["label"] = json!(d.label);
                out["group"] = json!(d.group);
                if d.resets {
                    out["resets"] = json!(true);
                }
                out
            })
            .collect(),
    )
}

fn title_case(value: &str) -> String {
    value
        .split(['-', '_'])
        .filter(|w| !w.is_empty())
        .enumerate()
        .map(|(i, w)| {
            let mut c = w.chars();
            let first = c.next().map(|f| if i == 0 { f.to_uppercase().collect::<String>() } else { f.to_string() }).unwrap_or_default();
            first + c.as_str()
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Read a slider by its definition (clamped to its range).
pub fn read(params: &Value, def: &ParamDef) -> f32 {
    let (min, max) = match def.kind {
        ParamKind::Slider { min, max, .. } => (min, max),
        _ => (f32::MIN, f32::MAX),
    };
    let fallback = match def.default {
        ParamDefault::Num(v) => v,
        _ => 0.0,
    };
    num(params, def.key, fallback).clamp(min, max)
}

pub fn flag(params: &Value, key: &str, fallback: bool) -> bool {
    match params.get(key) {
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().is_some_and(|v| v != 0.0),
        _ => fallback,
    }
}

/// Find a def by key in a table (panics in tests if a key is missing).
pub fn def<'a>(defs: &'a [ParamDef], key: &str) -> &'a ParamDef {
    defs.iter().find(|d| d.key == key).unwrap_or_else(|| panic!("no param def `{key}`"))
}

/// "#rrggbb" (or "rrggbb"), or the panel's [r, g, b] in 0..255, to linear rgb.
pub fn parse_color(value: Option<&Value>) -> Option<[f32; 3]> {
    let lin = |c: f32| if c <= 0.04045 { c / 12.92 } else { ((c + 0.055) / 1.055).powf(2.4) };
    if let Some(rgb) = value?.as_array() {
        let ch = |i: usize| rgb.get(i).and_then(Value::as_f64).filter(|v| v.is_finite()).map(|v| (v as f32 / 255.0).clamp(0.0, 1.0));
        return Some([lin(ch(0)?), lin(ch(1)?), lin(ch(2)?)]);
    }
    let s = value?.as_str()?.trim().trim_start_matches('#');
    if s.len() != 6 || !s.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    let byte = |i: usize| u8::from_str_radix(&s[i..i + 2], 16).ok().map(|b| b as f32 / 255.0);
    Some([lin(byte(0)?), lin(byte(2)?), lin(byte(4)?)])
}

/// The palette with the colour overrides applied: A replaces the mid tone,
/// B the fringe (each keeps its intensity).
pub fn palette_with_overrides(mut p: Palette3, params: &Value) -> Palette3 {
    if let Some(c) = parse_color(params.get("colorA")) {
        p.mid = [c[0], c[1], c[2], p.mid[3]];
    }
    if let Some(c) = parse_color(params.get("colorB")) {
        p.fringe = [c[0], c[1], c[2], p.fringe[3]];
    }
    p
}

/// The post chain from the shared Post and Look controls over the
/// instrument's defaults.
pub fn post_from(params: &Value, d: &CommonDefaults, tint: [f32; 3]) -> HdrPostSettings {
    let defs = common_defs(d);
    let r = |key: &str| read(params, def(&defs, key));
    HdrPostSettings {
        decay: r("trails"),
        zoom: r("drift"),
        swirl: r("trailSwirl"),
        flow: d.post.flow,
        bloom_strength: r("bloom"),
        threshold: r("bloomThreshold"),
        split: r("split"),
        exposure: d.post.exposure * r("brightness"),
        vignette: d.post.vignette,
        dither: 1.0,
        burn: d.post.burn,
        tint,
    }
}

/// Contrast and opacity, applied by the instruments' composite.
pub fn finish_floats(params: &Value, d: &CommonDefaults) -> [f32; 4] {
    let defs = common_defs(d);
    [read(params, def(&defs, "contrast")), read(params, def(&defs, "opacity")), 0.0, 0.0]
}

#[derive(Clone, Debug, PartialEq)]
pub struct AudioControls {
    pub sensitivity: f32,
    pub gain: [f32; 3],
    pub threshold: f32,
    pub attack: f32,
    pub release: f32,
    /// Bit per band (bass 1, mid 2, high 4).
    pub launch_mask: u32,
    /// 0 bass, 1 mid, 2 high, 3 overall level.
    pub level_band: usize,
    pub trigger: f32,
    pub trigger_band: OnsetBand,
}

pub fn audio_controls(params: &Value, d: &CommonDefaults) -> AudioControls {
    let defs = common_defs(d);
    let r = |key: &str| read(params, def(&defs, key));
    let launch_mask = match text(params, "launchBands").as_str() {
        "bass" => 1,
        "mid" => 2,
        "high" => 4,
        "bass-mid" => 3,
        "mid-high" => 6,
        _ => 7,
    };
    let level_band = match (text(params, "levelBand").as_str(), d.level_band) {
        ("bass", _) => 0,
        ("mid", _) => 1,
        ("high", _) => 2,
        ("level", _) => 3,
        (_, "mid") => 1,
        (_, "high") => 2,
        (_, "level") => 3,
        _ => 0,
    };
    let trigger_band = match text(params, "triggerBand").as_str() {
        "mid" => OnsetBand::Mid,
        "high" => OnsetBand::High,
        _ => OnsetBand::Bass,
    };
    AudioControls {
        sensitivity: r("sensitivity"),
        gain: [r("bassGain"), r("midGain"), r("highGain")],
        threshold: r("onsetThreshold"),
        attack: r("attack"),
        release: r("release"),
        launch_mask,
        level_band,
        // The panel flips a toggle; a number still counts presses.
        trigger: match params.get("trigger") {
            Some(Value::Bool(b)) => f32::from(u8::from(*b)),
            _ => num(params, "trigger", 0.0),
        },
        trigger_band,
    }
}

/// The conditioned audio an instrument sees this frame.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct AudioFrame {
    /// Hits that pass the threshold and routing, strength already scaled.
    pub hits: Vec<(OnsetEvent, f32)>,
    /// Smoothed bass, mid, high and overall level, gain applied.
    pub levels: [f32; 4],
    /// Onset envelopes bass, mid, high, gain applied.
    pub env: [f32; 3],
    /// The level the instrument's main motion follows (`levelBand`).
    pub drive: f32,
}

/// Audio conditioning state: the hit cursor, the trigger button and the
/// attack/release smoothed levels.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct AudioConditioner {
    pub last_seq: u32,
    pub last_trigger: Option<f32>,
    pub triggers: u32,
    pub levels: [f32; 4],
}

/// Trigger hits get seqs well above a show's worth of analyser hits, and
/// still exact as f32 (shaders seed from them).
pub const TRIGGER_SEQ_BASE: u32 = 1 << 22;

impl AudioConditioner {
    /// `dt` is the instrument's own step (0 when frozen or on a repeat render).
    #[cfg(test)]
    /// A repeat render (dt 0 with the core not frozen) must not touch the hit
    /// cursor, so callers pass the instrument step; when frozen, hits are
    /// drained and dropped so unfreezing does not replay a burst.
    pub fn step(&mut self, data: &AudioVisualData, ctl: &AudioControls, now: f32, dt: f32, limit: usize) -> AudioFrame {
        self.step_with(data, ctl, now, dt, dt > 0.0, limit)
    }

    pub fn step_with(
        &mut self,
        data: &AudioVisualData,
        ctl: &AudioControls,
        now: f32,
        dt: f32,
        advance: bool,
        limit: usize,
    ) -> AudioFrame {
        let raw = if advance { fresh_hits(data, &mut self.last_seq, now, limit) } else { Vec::new() };
        let mut hits = Vec::new();
        if dt > 0.0 {
            for (mut event, born) in raw {
                let band = event.band as usize;
                event.strength *= ctl.sensitivity * ctl.gain[band];
                if ctl.launch_mask & (1 << band) != 0 && event.strength >= ctl.threshold && event.strength > 0.0 {
                    hits.push((event, born));
                }
            }
        }
        // The Trigger button: each change of its value fires one hit.
        if let Some(last) = self.last_trigger
            && last != ctl.trigger
            && dt > 0.0
            && advance
        {
            self.triggers = self.triggers.wrapping_add(1);
            hits.push((
                OnsetEvent {
                    time: now,
                    band: ctl.trigger_band,
                    strength: 1.2,
                    seq: TRIGGER_SEQ_BASE.wrapping_add(self.triggers),
                },
                now,
            ));
        }
        if self.last_trigger.is_none() || (dt > 0.0 && advance) {
            self.last_trigger = Some(ctl.trigger);
        }
        let s = ctl.sensitivity;
        let target = [
            data.header(H_BASS) * s * ctl.gain[0],
            data.header(H_MID) * s * ctl.gain[1],
            data.header(H_HIGH) * s * ctl.gain[2],
            data.header(H_LEVEL) * s,
        ];
        if dt > 0.0 {
            for (level, target) in self.levels.iter_mut().zip(target) {
                let tau = if target > *level { ctl.attack } else { ctl.release };
                let k = if tau <= 1e-4 { 1.0 } else { 1.0 - (-dt / tau).exp() };
                *level += (target - *level) * k;
            }
        }
        let env = [
            data.header(H_ENV_BASS) * s * ctl.gain[0],
            data.header(H_ENV_MID) * s * ctl.gain[1],
            data.header(H_ENV_HIGH) * s * ctl.gain[2],
        ];
        AudioFrame { hits, levels: self.levels, env, drive: self.levels[ctl.level_band.min(3)] }
    }
}

/// Speed, freeze and the camera's auto-rotation, integrated on the
/// instrument's own clock so changing a rate never jumps the picture.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct MotionClock {
    /// The instrument's own time (stops when frozen, scales with speed).
    pub time: f32,
    /// Accumulated auto-rotation, degrees.
    pub spin: [f32; 3],
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CameraControls {
    pub auto: [f32; 3],
    pub rotate: [f32; 3],
    pub distance: f32,
    pub fov: f32,
    pub sway: f32,
    pub offset: [f32; 3],
}

pub fn camera_controls(params: &Value, d: &CommonDefaults) -> CameraControls {
    let defs = common_defs(d);
    let r = |key: &str| defs.iter().find(|x| x.key == key).map(|x| read(params, x)).unwrap_or(0.0);
    CameraControls {
        auto: [r("autoRotateX"), r("autoRotateY"), r("autoRotateZ")],
        rotate: [r("rotateX"), r("rotateY"), r("rotateZ")],
        distance: r("distance"),
        fov: r("fov").to_radians(),
        sway: r("sway"),
        offset: [r("offsetX"), r("offsetY"), r("offsetZ")],
    }
}

/// (speed, frozen)
pub fn motion_controls(params: &Value) -> (f32, bool) {
    (num(params, "speed", 1.0).clamp(0.0, 4.0), flag(params, "freeze", false))
}

impl MotionClock {
    /// Advance by the core's real step; returns the instrument's step.
    pub fn step(&mut self, params: &Value, cam: &CameraControls, dt: f32) -> f32 {
        let (speed, frozen) = motion_controls(params);
        let step = if frozen { 0.0 } else { dt * speed };
        self.time += step;
        for (spin, rate) in self.spin.iter_mut().zip(cam.auto) {
            *spin = (*spin + rate * step).rem_euclid(360.0);
        }
        step
    }

    /// Manual plus automatic rotation, radians.
    pub fn angles(&self, cam: &CameraControls) -> [f32; 3] {
        [
            (cam.rotate[0] + self.spin[0]).to_radians(),
            (cam.rotate[1] + self.spin[1]).to_radians(),
            (cam.rotate[2] + self.spin[2]).to_radians(),
        ]
    }
}

fn rot_x(v: [f32; 3], a: f32) -> [f32; 3] {
    let (s, c) = a.sin_cos();
    [v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c]
}

fn rot_y(v: [f32; 3], a: f32) -> [f32; 3] {
    let (s, c) = a.sin_cos();
    [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c]
}

/// A 3D camera from an instrument's base eye and target with the shared
/// controls applied: rotation about the target (X tilts, Y orbits, Z rolls),
/// distance as a multiplier, an offset that moves eye and target together,
/// and the field of view.
pub fn orbit_camera3(
    base_eye: [f32; 3],
    target: [f32; 3],
    base_roll: f32,
    cam: &CameraControls,
    angles: [f32; 3],
    aspect: f32,
    far: f32,
) -> Camera {
    let rel = [base_eye[0] - target[0], base_eye[1] - target[1], base_eye[2] - target[2]];
    let rel = rot_y(rot_x(rel, -angles[0]), angles[1]);
    let o = cam.offset;
    let t = [target[0] + o[0], target[1] + o[1], target[2] + o[2]];
    let eye = [t[0] + rel[0] * cam.distance, t[1] + rel[1] * cam.distance, t[2] + rel[2] * cam.distance];
    let near = (0.02 * cam.distance).max(0.01);
    look_at(eye, t, base_roll + angles[2], cam.fov, aspect, near, far * cam.distance.max(1.0))
}

/// The 2D view block (4 vec4): a picture-plane rotation with perspective,
/// a zoom and an offset. `view2` in the shaders applies it.
pub fn view2_floats(cam: &CameraControls, angles: [f32; 3], time: f32) -> [f32; 16] {
    let (sx, cx) = angles[0].sin_cos();
    let (sy, cy) = angles[1].sin_cos();
    let (sz, cz) = angles[2].sin_cos();
    // R = Ry * Rx * Rz, rows.
    let rz = [[cz, -sz, 0.0], [sz, cz, 0.0], [0.0, 0.0, 1.0]];
    let rx = [[1.0, 0.0, 0.0], [0.0, cx, -sx], [0.0, sx, cx]];
    let ry = [[cy, 0.0, sy], [0.0, 1.0, 0.0], [-sy, 0.0, cy]];
    let mul = |a: [[f32; 3]; 3], b: [[f32; 3]; 3]| {
        let mut o = [[0.0; 3]; 3];
        for (i, row) in o.iter_mut().enumerate() {
            for (j, cell) in row.iter_mut().enumerate() {
                *cell = (0..3).map(|k| a[i][k] * b[k][j]).sum();
            }
        }
        o
    };
    let r = mul(ry, mul(rx, rz));
    let zoom = 1.0 / cam.distance.max(0.05);
    // Wider field of view = stronger perspective on a tilted picture.
    let persp = (cam.fov * 0.5).tan() * 0.8;
    [
        r[0][0], r[0][1], r[0][2], zoom,
        r[1][0], r[1][1], r[1][2], persp,
        r[2][0], r[2][1], r[2][2], 0.0,
        // Sway: a slow wander of the picture.
        cam.offset[0] + 0.03 * cam.sway * (time * 0.13).sin(),
        cam.offset[1] + 0.02 * cam.sway * (time * 0.11).cos(),
        0.0,
        0.0,
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn defaults() -> CommonDefaults {
        CommonDefaults {
            camera: CameraKind::Picture2D,
            quality: "medium",
            fov: 45.0,
            post: HdrPostSettings::default(),
            level_band: "bass",
            palettes: &["a", "b"],
        }
    }

    fn packet(events: &[(f32, f32, f32, f32)], level: f32) -> AudioVisualData {
        let mut f = vec![0.0_f32; super::super::audio_data::AV_TOTAL_FLOATS];
        f[0] = 1.0;
        f[1] = 1.0;
        f[2] = 1.0;
        f[3] = events.len() as f32;
        f[4] = level;
        f[8] = level;
        f[13] = 128.0;
        f[14] = 512.0;
        f[15] = events.iter().map(|e| e.3).fold(0.0, f32::max);
        for (i, e) in events.iter().enumerate() {
            f[16 + i * 4..20 + i * 4].copy_from_slice(&[e.0, e.1, e.2, e.3]);
        }
        let mut d = AudioVisualData::default();
        d.set_from_bytes(bytemuck::cast_slice(&f)).unwrap();
        d
    }

    #[test]
    fn threshold_gain_and_routing_filter_hits() {
        let d = defaults();
        let data = packet(&[(1.0, 1.0, 0.5, 2.0), (1.0, 0.0, 0.5, 1.0)], 0.5);
        let mut c = AudioConditioner::default();
        let f = c.step(&data, &audio_controls(&json!({"onsetThreshold": 0.6}), &d), 1.0, 0.016, 8);
        assert!(f.hits.is_empty(), "both under the threshold");
        let mut c = AudioConditioner::default();
        let f = c.step(&data, &audio_controls(&json!({"onsetThreshold": 0.6, "midGain": 2.0}), &d), 1.0, 0.016, 8);
        assert_eq!(f.hits.len(), 1);
        assert_eq!(f.hits[0].0.band, OnsetBand::Mid);
        let mut c = AudioConditioner::default();
        let f = c.step(&data, &audio_controls(&json!({"launchBands": "bass"}), &d), 1.0, 0.016, 8);
        assert!(f.hits.iter().all(|h| h.0.band == OnsetBand::Bass) && f.hits.len() == 1);
    }

    #[test]
    fn the_trigger_fires_once_per_press_even_without_audio() {
        let d = defaults();
        let silent = AudioVisualData::default();
        let mut c = AudioConditioner::default();
        assert!(c.step(&silent, &audio_controls(&json!({"trigger": 0}), &d), 0.0, 0.016, 8).hits.is_empty());
        let f = c.step(&silent, &audio_controls(&json!({"trigger": 1, "triggerBand": "mid"}), &d), 0.1, 0.016, 8);
        assert_eq!(f.hits.len(), 1);
        assert_eq!(f.hits[0].0.band, OnsetBand::Mid);
        assert!(c.step(&silent, &audio_controls(&json!({"trigger": 1}), &d), 0.2, 0.016, 8).hits.is_empty());
    }

    #[test]
    fn attack_and_release_smooth_the_levels_and_freeze_holds_them() {
        let d = defaults();
        let loud = packet(&[], 1.0);
        let mut c = AudioConditioner::default();
        let slow = audio_controls(&json!({"attack": 0.5}), &d);
        let f = c.step(&loud, &slow, 0.0, 0.016, 8);
        assert!(f.levels[0] > 0.0 && f.levels[0] < 0.1);
        let held = c.step(&loud, &slow, 0.0, 0.0, 8);
        assert_eq!(held.levels, f.levels);
        let mut c = AudioConditioner::default();
        let fast = c.step(&loud, &audio_controls(&json!({"attack": 0.0}), &d), 0.0, 0.016, 8);
        assert_eq!(fast.levels[0], 1.0);
    }

    #[test]
    fn motion_clock_freezes_and_scales_and_spins_without_jumps() {
        let d = CommonDefaults { camera: CameraKind::Orbit3D, ..defaults() };
        let cam = camera_controls(&json!({"autoRotateY": 30.0}), &d);
        let mut m = MotionClock::default();
        m.step(&json!({"speed": 2.0}), &cam, 0.5);
        assert_eq!(m.time, 1.0);
        assert_eq!(m.spin[1], 30.0);
        m.step(&json!({"freeze": true}), &cam, 0.5);
        assert_eq!(m.time, 1.0);
        let cam2 = camera_controls(&json!({"autoRotateY": -30.0}), &d);
        m.step(&json!({}), &cam2, 0.5);
        assert_eq!(m.spin[1], 15.0, "a new rate continues from where it was");
    }

    #[test]
    fn colours_parse_and_override_the_palette() {
        assert_eq!(parse_color(Some(&json!("#ffffff"))), Some([1.0, 1.0, 1.0]));
        assert_eq!(parse_color(Some(&json!("nope"))), None);
        let p = Palette3 { core: [1.0; 4], mid: [0.0, 0.0, 0.0, 2.0], fringe: [0.0; 4] };
        let o = palette_with_overrides(p, &json!({"colorA": "#ff0000"}));
        assert_eq!(o.mid, [1.0, 0.0, 0.0, 2.0]);
    }

    #[test]
    fn every_common_def_is_well_formed_and_serialises() {
        for camera in [CameraKind::Orbit3D, CameraKind::Picture2D] {
            let defs = common_defs(&CommonDefaults { camera, ..defaults() });
            let mut keys: Vec<&str> = defs.iter().map(|d| d.key).collect();
            keys.sort();
            keys.dedup();
            assert_eq!(keys.len(), defs.len(), "keys are unique");
            for d in &defs {
                if let (ParamKind::Slider { min, max, .. }, ParamDefault::Num(v)) = (d.kind, d.default) {
                    assert!(min < max && v >= min && v <= max, "{}", d.key);
                }
            }
            assert_eq!(defs_json(&defs).as_array().unwrap().len(), defs.len());
        }
    }
}

/// Reads an instrument's params through its definitions, so the ranges the
/// app shows and the clamping the core does are one table.
pub struct Reader<'a> {
    pub params: &'a Value,
    pub defs: Vec<ParamDef>,
}

impl<'a> Reader<'a> {
    pub fn new(params: &'a Value, defs: Vec<ParamDef>) -> Self {
        Self { params, defs }
    }

    pub fn f(&self, key: &str) -> f32 {
        read(self.params, def(&self.defs, key))
    }

    /// A count whose default follows the quality tier.
    pub fn count(&self, key: &str, tier_default: u32) -> u32 {
        let d = def(&self.defs, key);
        let explicit = self.params.get(key).and_then(Value::as_f64).filter(|v| v.is_finite());
        match (explicit, d.kind) {
            (Some(v), ParamKind::Slider { min, max, .. }) => (v as f32).clamp(min, max).round() as u32,
            _ => tier_default,
        }
    }

    pub fn b(&self, key: &str) -> bool {
        let fallback = matches!(def(&self.defs, key).default, ParamDefault::Bool(true));
        flag(self.params, key, fallback)
    }

    /// A select's value (its default if the value is not one of its options).
    pub fn s(&self, key: &str) -> String {
        let d = def(&self.defs, key);
        let value = text(self.params, key);
        match (d.kind, d.default) {
            (ParamKind::Select(options), ParamDefault::Str(default)) => {
                if options.contains(&value.as_str()) { value } else { default.to_string() }
            }
            _ => value,
        }
    }
}

/// Test support: a packet with levels and a hit in every band, and a probe
/// that runs an instrument's CPU frame a few times and returns every float
/// it hands the GPU (uniform, post, finish, counts), pressing the Trigger
/// button part way through.
#[cfg(test)]
pub mod probe {
    use super::*;

    pub fn packet(time: f32, seq0: u32) -> AudioVisualData {
        let mut f = vec![0.0_f32; super::super::audio_data::AV_TOTAL_FLOATS];
        f[0] = 1.0;
        f[1] = time;
        f[2] = 1.0;
        f[3] = 3.0;
        f[4] = 0.6;
        f[5] = 0.9;
        f[6] = 0.7;
        f[7] = 0.5;
        f[8] = 0.8;
        f[9] = 0.5;
        f[10] = 0.3;
        f[13] = 128.0;
        f[14] = 512.0;
        f[15] = (seq0 + 2) as f32;
        for (i, (band, strength)) in [(2.0, 0.9), (1.0, 1.1), (0.0, 1.4)].iter().enumerate() {
            f[16 + i * 4..20 + i * 4].copy_from_slice(&[time, *band, *strength, (seq0 + 2 - i as u32) as f32]);
        }
        for (i, v) in f[144..272].iter_mut().enumerate() {
            *v = 0.8 * (1.0 - i as f32 / 128.0);
        }
        for (i, v) in f[272..784].iter_mut().enumerate() {
            *v = (i as f32 * 0.1).sin() * 0.5;
        }
        let mut d = AudioVisualData::default();
        d.set_from_bytes(bytemuck::cast_slice(&f)).unwrap();
        d
    }

    fn quieter(d: &AudioVisualData) -> AudioVisualData {
        let mut f: Vec<f32> = (0..super::super::audio_data::AV_TOTAL_FLOATS).map(|i| if i < 16 { d.header(i) } else { 0.0 }).collect();
        let full = d.gpu_bytes();
        let all: &[f32] = bytemuck::cast_slice(&full);
        f.copy_from_slice(all);
        for i in 4..11 {
            f[i] *= 0.2;
        }
        let mut out = AudioVisualData::default();
        out.set_from_bytes(bytemuck::cast_slice(&f)).unwrap();
        out
    }

    /// Runs `frame` 6 times at 60 fps with fresh hits on frames 0 and 3 and
    /// a Trigger press on frame 4.
    pub fn run(params: &Value, frame: impl FnMut(&Value, &AudioVisualData, f32, f32) -> Vec<f32>) -> Vec<f32> {
        run_for(params, 6, frame)
    }

    pub fn run_for(params: &Value, frames: usize, mut frame: impl FnMut(&Value, &AudioVisualData, f32, f32) -> Vec<f32>) -> Vec<f32> {
        let mut out = Vec::new();
        for i in 0..frames {
            let t = i as f32 / 60.0 + 0.5;
            let mut data = packet(t, if i < 3 { 1 } else { 10 });
            if i >= 3 {
                // The music drops away: release smoothing shows.
                data = quieter(&data);
            }
            let mut p = params.clone();
            if i >= 4 {
                let pressed = p.get("trigger").and_then(Value::as_f64).unwrap_or(0.0) + 1.0;
                p["trigger"] = json!(pressed);
            }
            out = frame(&p, &data, t, 1.0 / 60.0);
        }
        out
    }

    pub fn post_floats(p: &HdrPostSettings) -> Vec<f32> {
        vec![p.decay, p.zoom, p.swirl, p.flow, p.bloom_strength, p.threshold, p.split, p.exposure, p.vignette, p.burn, p.tint[0], p.tint[1], p.tint[2]]
    }

    /// Every declared param parses (garbage = default), clamps (beyond the
    /// range = the range's end) and reaches what the instrument hands the GPU.
    pub fn check_all(name: &str, defs: &[ParamDef], mut probe: impl FnMut(&Value) -> Vec<f32>, skip: &[&str]) {
        let base = probe(&json!({}));
        let mut keys: Vec<&str> = defs.iter().map(|d| d.key).collect();
        keys.sort_unstable();
        let unique = keys.len();
        keys.dedup();
        assert_eq!(keys.len(), unique, "{name}: every param key is unique");
        for d in defs {
            if skip.contains(&d.key) {
                continue;
            }
            let with = |v: Value| {
                let mut p = json!({});
                p[d.key] = v;
                p
            };
            assert_eq!(probe(&with(json!("not a value"))), base, "{name}.{}: garbage reads as the default", d.key);
            match d.kind {
                ParamKind::Slider { min, max, .. } => {
                    let lo = probe(&with(json!(min)));
                    let hi = probe(&with(json!(max)));
                    assert_ne!(lo, hi, "{name}.{}: min and max give the same frame", d.key);
                    assert_eq!(probe(&with(json!(max + (max - min) * 10.0 + 100.0))), hi, "{name}.{}: clamps high", d.key);
                    assert_eq!(probe(&with(json!(min - (max - min) * 10.0 - 100.0))), lo, "{name}.{}: clamps low", d.key);
                }
                ParamKind::Select(options) => {
                    let frames: Vec<Vec<f32>> = options.iter().map(|o| probe(&with(json!(o)))).collect();
                    assert!(frames.iter().any(|f| *f != frames[0]), "{name}.{}: every option gives the same frame", d.key);
                }
                ParamKind::Toggle => {
                    assert_ne!(probe(&with(json!(true))), probe(&with(json!(false))), "{name}.{}", d.key);
                }
                ParamKind::Color => {
                    assert_ne!(probe(&with(json!("#ff2200"))), base, "{name}.{}", d.key);
                }
                ParamKind::Button => {
                    let pressed = probe(&with(json!(5.0)));
                    assert_eq!(pressed, probe(&with(json!(5.0))), "{name}.{}: deterministic", d.key);
                }
                ParamKind::Text => {}
            }
        }
    }
}
