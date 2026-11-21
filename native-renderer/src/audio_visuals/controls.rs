//! Live controls for the audio-reactive instruments: the param definitions
//! the app builds its panel from (labels, groups, ranges, defaults), reading
//! params through them, and the controls every instrument shares (camera,
//! points, look, post, audio shaping, motion).
//!
//! The definitions are the single source of truth: an instrument reads a
//! param only through its definition, so the panel's range is the range the
//! core clamps to. Every param is live; the ones marked `resets` (budget,
//! file) rebuild the simulation, as they must.

use serde_json::{Value, json};

use super::audio_data::{
    AV_EVENT_CAPACITY, AV_EVENT_FLOATS, AV_EVENTS_OFFSET, AV_SPECTRUM_BINS, AV_SPECTRUM_OFFSET, AudioVisualData,
    H_BASS, H_ENV_BASS, H_ENV_HIGH, H_ENV_MID, H_EVENT_COUNT, H_HIGH, H_LEVEL, H_MID, OnsetBand,
};

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Kind {
    Slider { min: f32, max: f32, step: f32, default: f32 },
    Toggle(bool),
    Select(&'static [(&'static str, &'static str)], &'static str),
    Color([f32; 3]),
    /// A file path (the point cloud).
    File,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ParamDef {
    pub key: &'static str,
    pub label: &'static str,
    pub group: &'static str,
    pub kind: Kind,
    /// Changing it rebuilds the simulation (budget, file). Everything else
    /// is live.
    pub resets: bool,
}

pub const fn slider(key: &'static str, label: &'static str, group: &'static str, min: f32, max: f32, step: f32, default: f32) -> ParamDef {
    ParamDef { key, label, group, kind: Kind::Slider { min, max, step, default }, resets: false }
}

pub const fn toggle(key: &'static str, label: &'static str, group: &'static str, default: bool) -> ParamDef {
    ParamDef { key, label, group, kind: Kind::Toggle(default), resets: false }
}

pub const fn select(
    key: &'static str,
    label: &'static str,
    group: &'static str,
    options: &'static [(&'static str, &'static str)],
    default: &'static str,
) -> ParamDef {
    ParamDef { key, label, group, kind: Kind::Select(options, default), resets: false }
}

pub const fn color(key: &'static str, label: &'static str, group: &'static str, default: [f32; 3]) -> ParamDef {
    ParamDef { key, label, group, kind: Kind::Color(default), resets: false }
}

impl ParamDef {
    pub const fn resetting(self) -> Self {
        Self { resets: true, ..self }
    }

    /// The same shape as the app's `ParamControl` (gpuShaderTypes.ts).
    pub fn to_json(&self) -> Value {
        let mut out = match self.kind {
            Kind::Slider { min, max, step, default } => {
                json!({ "kind": "slider", "min": min, "max": max, "step": step, "default": default })
            }
            Kind::Toggle(default) => json!({ "kind": "toggle", "default": default }),
            Kind::Select(options, default) => json!({
                "kind": "select",
                "options": options.iter().map(|(value, label)| json!({ "value": value, "label": label })).collect::<Vec<_>>(),
                "default": default,
            }),
            Kind::Color(default) => json!({ "kind": "color", "default": default }),
            Kind::File => json!({ "kind": "media-source", "sources": ["file"], "accept": ".ply" }),
        };
        out["key"] = json!(self.key);
        out["label"] = json!(self.label);
        out["group"] = json!(self.group);
        if self.resets {
            out["resets"] = json!(true);
        }
        out
    }
}

/// An instrument's definitions, and reads through them.
pub struct Defs(pub Vec<ParamDef>);

impl Defs {
    pub fn def(&self, key: &str) -> &ParamDef {
        self.0.iter().find(|d| d.key == key).unwrap_or_else(|| panic!("no param definition for `{key}`"))
    }

    /// A slider's value, clamped to its range (a toggle reads as 0 or 1).
    pub fn num(&self, params: &Value, key: &str) -> f32 {
        match self.def(key).kind {
            Kind::Slider { min, max, default, .. } => params
                .get(key)
                .and_then(Value::as_f64)
                .filter(|v| v.is_finite())
                .map_or(default, |v| v as f32)
                .clamp(min, max),
            Kind::Toggle(_) => {
                if self.flag(params, key) {
                    1.0
                } else {
                    0.0
                }
            }
            _ => panic!("`{key}` is not a number"),
        }
    }

    pub fn flag(&self, params: &Value, key: &str) -> bool {
        let Kind::Toggle(default) = self.def(key).kind else { panic!("`{key}` is not a toggle") };
        match params.get(key) {
            Some(Value::Bool(b)) => *b,
            Some(Value::Number(n)) => n.as_f64().is_some_and(|v| v != 0.0),
            _ => default,
        }
    }

    /// A select's value, or its default when the value is not an option.
    pub fn choice(&self, params: &Value, key: &str) -> &'static str {
        let Kind::Select(options, default) = self.def(key).kind else { panic!("`{key}` is not a select") };
        let wanted = params
            .get(key)
            .and_then(Value::as_str)
            .map(|s| s.trim().to_ascii_lowercase().replace([' ', '_'], "-"))
            .unwrap_or_default();
        options.iter().find(|(value, _)| *value == wanted).map_or(default, |(value, _)| *value)
    }

    /// A colour as linear rgb, from `[r, g, b]` (0..1) or `"#rrggbb"` (sRGB).
    pub fn rgb(&self, params: &Value, key: &str) -> [f32; 3] {
        let Kind::Color(default) = self.def(key).kind else { panic!("`{key}` is not a colour") };
        let srgb_to_linear = |c: f32| if c <= 0.04045 { c / 12.92 } else { ((c + 0.055) / 1.055).powf(2.4) };
        match params.get(key) {
            Some(Value::Array(values)) if values.len() >= 3 => {
                let mut out = [0.0; 3];
                for (slot, v) in out.iter_mut().zip(values) {
                    *slot = srgb_to_linear(v.as_f64().unwrap_or(0.0).clamp(0.0, 1.0) as f32);
                }
                out
            }
            Some(Value::String(hex)) => {
                let hex = hex.trim().trim_start_matches('#');
                let channel = |i: usize| u8::from_str_radix(hex.get(i..i + 2).unwrap_or("00"), 16).unwrap_or(0) as f32 / 255.0;
                if hex.len() == 6 { [channel(0), channel(2), channel(4)].map(srgb_to_linear) } else { default.map(srgb_to_linear) }
            }
            _ => default.map(srgb_to_linear),
        }
    }

    pub fn json(&self) -> Value {
        Value::Array(self.0.iter().map(ParamDef::to_json).collect())
    }
}

/* ── shared definition groups ──────────────────────────────────────────── */

pub const QUALITY_OPTIONS: &[(&str, &str)] = &[("low", "Low"), ("medium", "Medium"), ("high", "High"), ("ultra", "Ultra")];
const BAND_OPTIONS: &[(&str, &str)] = &[("all", "All bands"), ("bass", "Bass"), ("mid", "Mid"), ("high", "High")];
const LEVEL_OPTIONS: &[(&str, &str)] = &[("overall", "Overall"), ("bass", "Bass"), ("mid", "Mid"), ("high", "High")];

/// Post defaults differ per instrument (trails, bloom).
pub struct PostDefaults {
    pub bloom: f32,
    pub threshold: f32,
    pub trails: f32,
    pub drift: f32,
    pub swirl: f32,
    pub split: f32,
}

pub fn look_defs(palettes: &'static [(&'static str, &'static str)], default_palette: &'static str, color_a: [f32; 3], color_b: [f32; 3]) -> Vec<ParamDef> {
    vec![
        select("palette", "Palette", "Look", palettes, default_palette),
        toggle("customColors", "Custom colours", "Look", false),
        color("colorA", "Colour A (hot)", "Look", color_a),
        color("colorB", "Colour B (body)", "Look", color_b),
        slider("intensity", "Brightness", "Look", 0.0, 8.0, 0.01, 1.0),
        slider("exposure", "Exposure", "Look", 0.05, 8.0, 0.01, 1.0),
        slider("contrast", "Contrast", "Look", 0.5, 2.0, 0.01, 1.0),
    ]
}

pub fn post_defs(d: PostDefaults) -> Vec<ParamDef> {
    vec![
        slider("bloom", "Bloom", "Post", 0.0, 4.0, 0.01, d.bloom),
        slider("bloomThreshold", "Bloom threshold", "Post", 0.0, 4.0, 0.01, d.threshold),
        slider("trails", "Trail decay", "Post", 0.0, 0.97, 0.01, d.trails),
        slider("drift", "Drift", "Post", 0.0, 0.02, 0.0005, d.drift),
        slider("swirl", "Swirl", "Post", -0.02, 0.02, 0.0005, d.swirl),
        slider("split", "RGB split", "Post", 0.0, 0.03, 0.0005, d.split),
    ]
}

pub fn audio_defs() -> Vec<ParamDef> {
    vec![
        slider("sensitivity", "Sensitivity", "Audio", 0.0, 4.0, 0.01, 1.0),
        slider("bassGain", "Bass gain", "Audio", 0.0, 4.0, 0.01, 1.0),
        slider("midGain", "Mid gain", "Audio", 0.0, 4.0, 0.01, 1.0),
        slider("highGain", "High gain", "Audio", 0.0, 4.0, 0.01, 1.0),
        slider("onsetThreshold", "Hit threshold", "Audio", 0.0, 2.0, 0.01, 0.0),
        slider("attack", "Attack (s)", "Audio", 0.0, 1.0, 0.005, 0.0),
        slider("release", "Release (s)", "Audio", 0.0, 2.0, 0.005, 0.0),
        select("hitsFrom", "Hits from", "Audio", BAND_OPTIONS, "all"),
        select("levelFrom", "Level from", "Audio", LEVEL_OPTIONS, "overall"),
        toggle("trigger", "Trigger hit", "Audio", false),
    ]
}

pub fn motion_defs() -> Vec<ParamDef> {
    vec![
        slider("timeScale", "Speed", "Motion", 0.0, 4.0, 0.01, 1.0),
        toggle("freeze", "Freeze", "Motion", false),
    ]
}

/// The panel definitions of the audio-reactive instruments, by id, for the
/// instrument manifest.
pub fn param_defs_json(id: &str) -> Option<Value> {
    use super::cloud_pulse::{CloudKind, cloud_defs};
    Some(match id {
        "strands" => super::strands::strands_defs().json(),
        "cloud-pulse" => cloud_defs(CloudKind::Pulse).json(),
        "cloud-flock" => cloud_defs(CloudKind::Flock).json(),
        "depth-lights" => cloud_defs(CloudKind::DepthLights).json(),
        _ => return None,
    })
}

/* ── shared controls ───────────────────────────────────────────────────── */

#[derive(Clone, Debug, PartialEq)]
pub struct AudioControls {
    pub sensitivity: f32,
    pub gains: [f32; 3],
    pub threshold: f32,
    pub attack: f32,
    pub release: f32,
    /// Bit per band (bass 1, mid 2, high 4) whose hits reach the instrument.
    pub hits_mask: u32,
    /// Header slot read as "the level": overall, bass, mid or high.
    pub level_slot: usize,
    pub trigger: bool,
}

impl AudioControls {
    pub fn read(defs: &Defs, params: &Value) -> Self {
        Self {
            sensitivity: defs.num(params, "sensitivity"),
            gains: [defs.num(params, "bassGain"), defs.num(params, "midGain"), defs.num(params, "highGain")],
            threshold: defs.num(params, "onsetThreshold"),
            attack: defs.num(params, "attack"),
            release: defs.num(params, "release"),
            hits_mask: match defs.choice(params, "hitsFrom") {
                "bass" => 1,
                "mid" => 2,
                "high" => 4,
                _ => 7,
            },
            level_slot: match defs.choice(params, "levelFrom") {
                "bass" => H_BASS,
                "mid" => H_MID,
                "high" => H_HIGH,
                _ => H_LEVEL,
            },
            trigger: defs.flag(params, "trigger"),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MotionControls {
    pub time_scale: f32,
    pub freeze: bool,
}

impl MotionControls {
    pub fn read(defs: &Defs, params: &Value) -> Self {
        Self { time_scale: defs.num(params, "timeScale"), freeze: defs.flag(params, "freeze") }
    }

    /// The simulation's step for a frame step `dt`: scaled, or 0 when frozen
    /// (0 is also what a repeat render gets, so frozen means nothing moves).
    pub fn sim_dt(&self, dt: f32) -> f32 {
        if self.freeze { 0.0 } else { dt * self.time_scale }
    }
}

/// Which band a spectrum bin belongs to (30 Hz..16 kHz log axis; bass below
/// 160 Hz, high above 2.8 kHz, as the editor's onset bands).
fn bin_band(bin: usize) -> usize {
    let hz = 30.0 * (16_000.0_f32 / 30.0).powf(bin as f32 / AV_SPECTRUM_BINS as f32);
    if hz < 160.0 {
        0
    } else if hz < 2800.0 {
        1
    } else {
        2
    }
}

/// Per-instrument shaping of the shared audio packet: sensitivity and band
/// gains, attack/release smoothing of the spectrum, which bands' hits get
/// through and how hard a hit must be. Deterministic: it depends only on the
/// packets and steps it is given (a 0 step changes no smoothing).
#[derive(Clone, Debug, PartialEq)]
pub struct AudioShaper {
    spectrum: Vec<f32>,
    /// Smoothed level, band levels and onset envelopes.
    levels: [f32; 7],
    /// The manual trigger's last value: a change fires a hit.
    pub last_trigger: Option<bool>,
}

impl Default for AudioShaper {
    fn default() -> Self {
        Self { spectrum: vec![0.0; AV_SPECTRUM_BINS], levels: [0.0; 7], last_trigger: None }
    }
}

impl AudioShaper {
    pub fn shape(&mut self, data: &AudioVisualData, c: &AudioControls, dt: f32) -> AudioVisualData {
        let mut out = data.clone();
        let floats = out.floats_mut();
        for bin in 0..AV_SPECTRUM_BINS {
            let gain = c.sensitivity * c.gains[bin_band(bin)];
            let target = (floats[AV_SPECTRUM_OFFSET + bin] * gain).clamp(0.0, 1.0);
            let s = &mut self.spectrum[bin];
            if dt > 0.0 {
                let tau = if target > *s { c.attack } else { c.release };
                let k = if tau <= 1e-4 { 1.0 } else { 1.0 - (-dt / tau).exp() };
                *s += (target - *s) * k;
            }
            floats[AV_SPECTRUM_OFFSET + bin] = *s;
        }
        for (slot, band) in [(H_BASS, 0), (H_MID, 1), (H_HIGH, 2), (H_ENV_BASS, 0), (H_ENV_MID, 1), (H_ENV_HIGH, 2)] {
            floats[slot] = (floats[slot] * c.sensitivity * c.gains[band]).clamp(0.0, 2.0);
        }
        floats[H_LEVEL] = (floats[c.level_slot] * if c.level_slot == H_LEVEL { c.sensitivity } else { 1.0 }).clamp(0.0, 2.0);
        // The levels and envelopes take the same attack / release.
        for (i, slot) in [H_LEVEL, H_BASS, H_MID, H_HIGH, H_ENV_BASS, H_ENV_MID, H_ENV_HIGH].into_iter().enumerate() {
            let target = floats[slot];
            let s = &mut self.levels[i];
            if dt > 0.0 {
                let tau = if target > *s { c.attack } else { c.release };
                let k = if tau <= 1e-4 { 1.0 } else { 1.0 - (-dt / tau).exp() };
                *s += (target - *s) * k;
            }
            floats[slot] = *s;
        }
        // Rebuild the ring with only the hits that get through.
        let count = floats[H_EVENT_COUNT] as usize;
        let mut kept = Vec::with_capacity(count);
        for index in 0..count.min(AV_EVENT_CAPACITY) {
            let at = AV_EVENTS_OFFSET + index * AV_EVENT_FLOATS;
            let Some(band) = OnsetBand::from_f32(floats[at + 1]) else { continue };
            let strength = floats[at + 2] * c.sensitivity * c.gains[band as usize];
            if c.hits_mask & (1 << band as u32) != 0 && strength > 0.0 && strength >= c.threshold {
                kept.push([floats[at], floats[at + 1], strength.min(4.0), floats[at + 3]]);
            }
        }
        for (index, event) in kept.iter().enumerate() {
            let at = AV_EVENTS_OFFSET + index * AV_EVENT_FLOATS;
            floats[at..at + 4].copy_from_slice(event);
        }
        floats[H_EVENT_COUNT] = kept.len() as f32;
        out
    }

    /// True once per change of the trigger param (not on its first sight).
    pub fn take_trigger(&mut self, value: bool) -> bool {
        let fired = self.last_trigger.is_some_and(|last| last != value);
        self.last_trigger = Some(value);
        fired
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn defs() -> Defs {
        let mut d = audio_defs();
        d.extend(motion_defs());
        d.extend(look_defs(&[("a", "A"), ("b", "B")], "a", [1.0, 0.5, 0.0], [0.0, 0.0, 1.0]));
        Defs(d)
    }

    #[test]
    fn reads_clamp_to_the_definition() {
        let d = defs();
        assert_eq!(d.num(&json!({ "sensitivity": 99 }), "sensitivity"), 4.0);
        assert_eq!(d.num(&json!({}), "sensitivity"), 1.0);
        assert_eq!(d.choice(&json!({ "palette": "B" }), "palette"), "b");
        assert_eq!(d.choice(&json!({ "palette": "zzz" }), "palette"), "a");
        assert!(d.flag(&json!({ "freeze": true }), "freeze"));
        let white = d.rgb(&json!({ "colorA": "#ffffff" }), "colorA");
        assert!((white[0] - 1.0).abs() < 1e-5);
        let mid = d.rgb(&json!({ "colorA": [0.5, 0.5, 0.5] }), "colorA");
        assert!((mid[0] - 0.214).abs() < 0.01, "sRGB 0.5 is linear ~0.214");
        let json = d.json();
        assert!(json.as_array().unwrap().iter().all(|p| p["key"].is_string() && p["label"].is_string() && p["group"].is_string()));
    }

    fn packet() -> AudioVisualData {
        let mut floats = vec![0.0_f32; super::super::audio_data::AV_TOTAL_FLOATS];
        floats[0] = 1.0;
        floats[2] = 1.0;
        floats[H_EVENT_COUNT] = 3.0;
        floats[H_LEVEL] = 0.5;
        floats[H_BASS] = 0.4;
        for (i, ev) in [[1.0, 0.0, 1.0, 3.0], [0.9, 1.0, 0.5, 2.0], [0.8, 2.0, 0.2, 1.0]].iter().enumerate() {
            floats[AV_EVENTS_OFFSET + i * 4..AV_EVENTS_OFFSET + i * 4 + 4].copy_from_slice(ev);
        }
        for bin in 0..AV_SPECTRUM_BINS {
            floats[AV_SPECTRUM_OFFSET + bin] = 0.5;
        }
        let mut data = AudioVisualData::default();
        data.set_from_bytes(bytemuck::cast_slice(&floats)).unwrap();
        data
    }

    #[test]
    fn shaping_filters_hits_scales_bands_and_smooths() {
        let d = defs();
        let c = AudioControls::read(&d, &json!({ "hitsFrom": "bass", "bassGain": 2.0, "attack": 0.5 }));
        let mut shaper = AudioShaper::default();
        let out = shaper.shape(&packet(), &c, 1.0 / 60.0);
        assert_eq!(out.event_count(), 1);
        assert_eq!(out.event(0).unwrap().strength, 2.0);
        assert!(out.spectrum()[0] < 0.1, "attack smooths the rise");
        let thresholded = AudioShaper::default().shape(&packet(), &AudioControls::read(&d, &json!({ "onsetThreshold": 0.6 })), 0.0);
        assert_eq!(thresholded.event_count(), 1, "only the strong hit");
        let level = AudioShaper::default().shape(&packet(), &AudioControls::read(&d, &json!({ "levelFrom": "bass" })), 1.0 / 60.0);
        assert!((level.header(H_LEVEL) - 0.4).abs() < 1e-6);
    }

    #[test]
    fn the_trigger_fires_on_each_change_only() {
        let mut shaper = AudioShaper::default();
        assert!(!shaper.take_trigger(false));
        assert!(!shaper.take_trigger(false));
        assert!(shaper.take_trigger(true));
        assert!(!shaper.take_trigger(true));
        assert!(shaper.take_trigger(false));
    }

    #[test]
    fn freeze_and_speed_scale_the_step() {
        let d = defs();
        assert_eq!(MotionControls::read(&d, &json!({ "freeze": true })).sim_dt(0.1), 0.0);
        assert!((MotionControls::read(&d, &json!({ "timeScale": 2.0 })).sim_dt(0.1) - 0.2).abs() < 1e-6);
    }
}
