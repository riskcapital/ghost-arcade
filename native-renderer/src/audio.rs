use serde_json::{Value, json};

const GHOST_AUDIO_LAYOUT_SCHEMA_VERSION: u32 = 1;
const GHOST_AUDIO0_FIELDS: [&str; 4] = ["level", "bass", "mid", "treble"];
const GHOST_AUDIO1_FIELDS: [&str; 4] = ["high", "beat", "beat_phase", "bpm"];
const GHOST_AUDIO2_FIELDS: [&str; 4] = ["centroid", "kick", "snare", "active"];

pub fn ghost_audio_uniform_layout() -> Value {
    json!({
        "schema_version": GHOST_AUDIO_LAYOUT_SCHEMA_VERSION,
        "audio0": GHOST_AUDIO0_FIELDS,
        "audio1": GHOST_AUDIO1_FIELDS,
        "audio2": GHOST_AUDIO2_FIELDS,
    })
}

#[derive(Clone, Copy, Debug, Default)]
pub struct GhostAudioUniforms {
    pub audio0: [f32; 4],
    pub audio1: [f32; 4],
    pub audio2: [f32; 4],
}

impl GhostAudioUniforms {
    pub fn from_command(command: &Value) -> Self {
        let active = bool_at(command, &["active"]).unwrap_or(false);
        Self {
            audio0: [
                audio_value_at(command, GHOST_AUDIO0_FIELDS[0]),
                audio_value_at(command, GHOST_AUDIO0_FIELDS[1]),
                audio_value_at(command, GHOST_AUDIO0_FIELDS[2]),
                audio_value_at(command, GHOST_AUDIO0_FIELDS[3]),
            ],
            audio1: [
                audio_value_at(command, GHOST_AUDIO1_FIELDS[0]),
                audio_value_at(command, GHOST_AUDIO1_FIELDS[1]),
                number_at(command, &[GHOST_AUDIO1_FIELDS[2]])
                    .unwrap_or(0.0)
                    .clamp(0.0, 1.0) as f32,
                number_at(command, &[GHOST_AUDIO1_FIELDS[3]])
                    .unwrap_or(0.0)
                    .clamp(0.0, 300.0) as f32,
            ],
            audio2: [
                audio_value_at(command, GHOST_AUDIO2_FIELDS[0]),
                audio_value_at(command, GHOST_AUDIO2_FIELDS[1]),
                audio_value_at(command, GHOST_AUDIO2_FIELDS[2]),
                if active { 1.0 } else { 0.0 },
            ],
        }
    }

    pub fn from_isf_command(command: &Value) -> Self {
        let audio0 = [
            audio_value_at_any(command, GHOST_AUDIO0_FIELDS[0], "audio_level"),
            audio_value_at_any(command, GHOST_AUDIO0_FIELDS[1], "audio_bass"),
            audio_value_at_any(command, GHOST_AUDIO0_FIELDS[2], "audio_mid"),
            if command_has_key(command, GHOST_AUDIO0_FIELDS[3])
                || command_has_key(command, "audio_treble")
            {
                audio_value_at_any(command, GHOST_AUDIO0_FIELDS[3], "audio_treble")
            } else if command_has_key(command, GHOST_AUDIO1_FIELDS[0]) {
                audio_value_at(command, GHOST_AUDIO1_FIELDS[0])
            } else {
                audio_value_at(command, "audio_high")
            },
        ];
        let audio1 = [
            audio_value_at_any(command, GHOST_AUDIO1_FIELDS[0], "audio_high"),
            audio_value_at_any(command, GHOST_AUDIO1_FIELDS[1], "audio_beat"),
            number_at_any(command, GHOST_AUDIO1_FIELDS[2], "audio_beat_phase")
                .unwrap_or(0.0)
                .clamp(0.0, 1.0) as f32,
            number_at_any(command, GHOST_AUDIO1_FIELDS[3], "audio_bpm")
                .unwrap_or(0.0)
                .clamp(0.0, 300.0) as f32,
        ];
        let active = bool_at(command, &["active"]).unwrap_or_else(|| {
            audio0.iter().chain(audio1.iter()).any(|value| *value > 0.0)
                || audio_value_at_any(command, GHOST_AUDIO2_FIELDS[0], "audio_spectral_centroid")
                    > 0.0
                || audio_value_at_any(command, GHOST_AUDIO2_FIELDS[1], "audio_kick") > 0.0
                || audio_value_at_any(command, GHOST_AUDIO2_FIELDS[2], "audio_snare") > 0.0
        });
        Self {
            audio0,
            audio1,
            audio2: [
                audio_value_at_any(command, GHOST_AUDIO2_FIELDS[0], "audio_spectral_centroid"),
                audio_value_at_any(command, GHOST_AUDIO2_FIELDS[1], "audio_kick"),
                audio_value_at_any(command, GHOST_AUDIO2_FIELDS[2], "audio_snare"),
                if active { 1.0 } else { 0.0 },
            ],
        }
    }
}

fn number_at(value: &Value, path: &[&str]) -> Option<f64> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    current.as_f64()
}

fn bool_at(value: &Value, path: &[&str]) -> Option<bool> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    current.as_bool()
}

fn audio_value_at(value: &Value, key: &str) -> f32 {
    number_at(value, &[key]).unwrap_or(0.0).clamp(0.0, 1.0) as f32
}

fn command_has_key(value: &Value, key: &str) -> bool {
    value
        .as_object()
        .is_some_and(|object| object.contains_key(key))
}

fn audio_value_at_any(value: &Value, canonical_key: &str, legacy_key: &str) -> f32 {
    if command_has_key(value, canonical_key) {
        audio_value_at(value, canonical_key)
    } else {
        audio_value_at(value, legacy_key)
    }
}

fn number_at_any(value: &Value, canonical_key: &str, legacy_key: &str) -> Option<f64> {
    if command_has_key(value, canonical_key) {
        number_at(value, &[canonical_key])
    } else {
        number_at(value, &[legacy_key])
    }
}
