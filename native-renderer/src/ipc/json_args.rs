//! Readers for the JSON fields commands carry.

use crate::*;

pub(crate) fn number_at(value: &Value, path: &[&str]) -> Option<f64> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    current.as_f64()
}

pub(crate) fn bool_at(value: &Value, path: &[&str]) -> Option<bool> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    current.as_bool()
}

pub(crate) fn vec3_path_or(value: &Value, path: &[&str], fallback: [f32; 3]) -> [f32; 3] {
    let mut current = value;
    for key in path {
        let Some(next) = current.get(*key) else {
            return fallback;
        };
        current = next;
    }
    let Some(values) = current.as_array() else {
        return fallback;
    };
    let mut out = fallback;
    for (index, slot) in out.iter_mut().enumerate() {
        if let Some(value) = values.get(index).and_then(Value::as_f64) {
            *slot = value.clamp(-1.0e6, 1.0e6) as f32;
        }
    }
    out
}

pub(crate) fn color_path_or(value: &Value, path: &[&str]) -> Option<[f32; 3]> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    if let Some(text) = current.as_str() {
        return parse_hex_color(text);
    }
    let values = current.as_array()?;
    Some([
        json_channel_to_unit(values.first()?),
        json_channel_to_unit(values.get(1)?),
        json_channel_to_unit(values.get(2)?),
    ])
}

pub(crate) fn parse_hex_color(text: &str) -> Option<[f32; 3]> {
    let hex = text.trim().trim_start_matches('#');
    if hex.len() == 3 {
        let mut out = [0.0_f32; 3];
        for (index, ch) in hex.chars().enumerate() {
            let value = ch.to_digit(16)? as f32 / 15.0;
            out[index] = value;
        }
        return Some(out);
    }
    if hex.len() == 6 {
        let r = u8::from_str_radix(&hex[0..2], 16).ok()? as f32 / 255.0;
        let g = u8::from_str_radix(&hex[2..4], 16).ok()? as f32 / 255.0;
        let b = u8::from_str_radix(&hex[4..6], 16).ok()? as f32 / 255.0;
        return Some([r, g, b]);
    }
    None
}

pub(crate) fn vec4_at(value: &Value, key: &str) -> [f32; 4] {
    let Some(values) = value.get(key).and_then(Value::as_array) else {
        return [0.0; 4];
    };
    let mut out = [0.0; 4];
    for (index, slot) in out.iter_mut().enumerate() {
        *slot = values
            .get(index)
            .and_then(Value::as_f64)
            .unwrap_or(0.0)
            .clamp(-1.0e9, 1.0e9) as f32;
    }
    out
}

pub(crate) fn vec4_path_at(value: &Value, path: &[&str]) -> Option<[f32; 4]> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    let values = current.as_array()?;
    if values.len() < 4 {
        return None;
    }
    let mut out = [0.0_f32; 4];
    for (index, slot) in out.iter_mut().enumerate() {
        *slot = values
            .get(index)
            .and_then(Value::as_f64)?
            .clamp(-1.0e9, 1.0e9) as f32;
    }
    Some(out)
}

pub(crate) fn json_object_len(value: &Value) -> usize {
    value.as_object().map(|object| object.len()).unwrap_or(0)
}

pub(crate) fn command_has_key(value: &Value, key: &str) -> bool {
    value
        .as_object()
        .is_some_and(|object| object.contains_key(key))
}

pub(crate) fn number_at_any(value: &Value, canonical_key: &str, legacy_key: &str) -> Option<f64> {
    if command_has_key(value, canonical_key) {
        number_at(value, &[canonical_key])
    } else {
        number_at(value, &[legacy_key])
    }
}

pub(crate) fn unit_from_hash(hash: u64) -> f32 {
    ((hash & 0x00ff_ffff) as f32 / 0x00ff_ffff as f32).clamp(0.0, 1.0)
}

pub(crate) fn string_at(value: &Value, path: &[&str]) -> Option<String> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    current.as_str().map(ToString::to_string)
}

pub(crate) fn string_array_at(value: &Value, path: &[&str]) -> Option<Vec<String>> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    Some(
        current
            .as_array()?
            .iter()
            .filter_map(Value::as_str)
            .map(str::trim)
            .filter(|item| !item.is_empty())
            .map(ToString::to_string)
            .collect(),
    )
}

pub(crate) fn rgba_at(value: &Value, path: &[&str]) -> Option<[f32; 4]> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    let values = current.as_array()?;
    if values.len() < 4 {
        return None;
    }
    Some([
        values[0].as_f64()?.clamp(0.0, 1.0) as f32,
        values[1].as_f64()?.clamp(0.0, 1.0) as f32,
        values[2].as_f64()?.clamp(0.0, 1.0) as f32,
        values[3].as_f64()?.clamp(0.0, 1.0) as f32,
    ])
}

pub(crate) fn params8_at(value: &Value, path: &[&str]) -> Option<[f32; 8]> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    let values = current.as_array()?;
    if values.len() < 8 {
        return None;
    }
    let mut out = [0.0_f32; 8];
    for index in 0..8 {
        out[index] = values[index].as_f64()?.clamp(-16.0, 16.0) as f32;
    }
    Some(out)
}

pub(crate) fn corners_at(value: &Value, path: &[&str]) -> Option<[[f32; 2]; 4]> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    Some([
        point_at(current, "topLeft")?,
        point_at(current, "topRight")?,
        point_at(current, "bottomRight")?,
        point_at(current, "bottomLeft")?,
    ])
}

pub(crate) fn point_at(value: &Value, key: &str) -> Option<[f32; 2]> {
    let point = value.get(key)?;
    Some([
        point.get("x")?.as_f64()?.clamp(-8.0, 8.0) as f32,
        point.get("y")?.as_f64()?.clamp(-8.0, 8.0) as f32,
    ])
}
