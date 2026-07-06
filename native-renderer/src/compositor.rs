use serde_json::{Value, json};

pub fn blend_mode_code(mode: &str) -> f32 {
    match mode.trim().to_ascii_lowercase().as_str() {
        "add" | "plus" | "linear-dodge" | "linear_dodge" => 1.0,
        "multiply" => 2.0,
        "screen" => 3.0,
        "overlay" => 4.0,
        "subtract" | "minus" => 5.0,
        "difference" => 6.0,
        "lighten" => 7.0,
        "darken" => 8.0,
        "average" | "avg" => 9.0,
        "hardlight" | "hard-light" | "hard_light" => 10.0,
        "softlight" | "soft-light" | "soft_light" => 11.0,
        "exclusion" => 12.0,
        "color-dodge" | "color_dodge" | "colordodge" | "dodge" => 13.0,
        "color-burn" | "color_burn" | "colorburn" | "burn" => 14.0,
        "hue" => 15.0,
        "saturation" => 16.0,
        "color" => 17.0,
        "luminosity" | "luma" => 18.0,
        "divide" => 19.0,
        "negation" => 20.0,
        "phoenix" => 21.0,
        "linear-light" | "linear_light" | "linearlight" => 22.0,
        "hard-mix" | "hard_mix" | "hardmix" => 23.0,
        "vivid-light" | "vivid_light" | "vividlight" => 24.0,
        "pin-light" | "pin_light" | "pinlight" => 25.0,
        _ => 0.0,
    }
}

pub fn effect_descriptor_code(descriptor: &str) -> Option<[f32; 4]> {
    let descriptor = descriptor.trim().to_ascii_lowercase();
    if descriptor.is_empty() {
        return None;
    }
    let mut parts = descriptor.split(':');
    let name = parts.next().unwrap_or_default();
    let amount = parts
        .next()
        .and_then(|value| value.parse::<f32>().ok())
        .unwrap_or(1.0);
    match name {
        "invert" => Some([1.0, amount.clamp(0.0, 1.0), 0.0, 0.0]),
        "grayscale" | "greyscale" => Some([2.0, amount.clamp(0.0, 1.0), 0.0, 0.0]),
        "brightness" => Some([3.0, amount.clamp(0.0, 8.0), 0.0, 0.0]),
        "contrast" => Some([4.0, amount.clamp(0.0, 8.0), 0.0, 0.0]),
        "gamma" => Some([5.0, amount.clamp(0.05, 8.0), 0.0, 0.0]),
        "saturation" => Some([6.0, amount.clamp(0.0, 8.0), 0.0, 0.0]),
        "hue" => Some([7.0, amount.clamp(-4.0, 4.0), 0.0, 0.0]),
        "posterize" => Some([8.0, amount.clamp(2.0, 64.0), 0.0, 0.0]),
        "noise" => Some([9.0, amount.clamp(0.0, 1.0), 0.0, 0.0]),
        _ => None,
    }
}

pub fn native_compositor_blend_manifest() -> Value {
    json!([
        {"id": "normal", "code": 0},
        {"id": "add", "code": 1},
        {"id": "multiply", "code": 2},
        {"id": "screen", "code": 3},
        {"id": "overlay", "code": 4},
        {"id": "subtract", "code": 5},
        {"id": "difference", "code": 6},
        {"id": "lighten", "code": 7},
        {"id": "darken", "code": 8},
        {"id": "average", "code": 9},
        {"id": "hardlight", "code": 10},
        {"id": "softlight", "code": 11},
        {"id": "exclusion", "code": 12},
        {"id": "color-dodge", "code": 13},
        {"id": "color-burn", "code": 14},
        {"id": "hue", "code": 15},
        {"id": "saturation", "code": 16},
        {"id": "color", "code": 17},
        {"id": "luminosity", "code": 18},
        {"id": "divide", "code": 19},
        {"id": "negation", "code": 20},
        {"id": "phoenix", "code": 21},
        {"id": "linear-light", "code": 22},
        {"id": "hard-mix", "code": 23},
        {"id": "vivid-light", "code": 24},
        {"id": "pin-light", "code": 25}
    ])
}

pub fn native_compositor_effect_manifest() -> Value {
    json!([
        {"id": "invert", "code": 1, "amount_min": 0.0, "amount_max": 1.0},
        {"id": "grayscale", "aliases": ["greyscale"], "code": 2, "amount_min": 0.0, "amount_max": 1.0},
        {"id": "brightness", "code": 3, "amount_min": 0.0, "amount_max": 8.0},
        {"id": "contrast", "code": 4, "amount_min": 0.0, "amount_max": 8.0},
        {"id": "gamma", "code": 5, "amount_min": 0.05, "amount_max": 8.0},
        {"id": "saturation", "code": 6, "amount_min": 0.0, "amount_max": 8.0},
        {"id": "hue", "code": 7, "amount_min": -4.0, "amount_max": 4.0},
        {"id": "posterize", "code": 8, "amount_min": 2.0, "amount_max": 64.0},
        {"id": "noise", "code": 9, "amount_min": 0.0, "amount_max": 1.0}
    ])
}

pub fn stable_layer_color(id: &str, alpha: f32) -> [f32; 4] {
    let mut hash = 2166136261_u32;
    for byte in id.as_bytes() {
        hash ^= *byte as u32;
        hash = hash.wrapping_mul(16777619);
    }
    let hue = (hash % 360) as f32 / 360.0;
    let r = 0.5 + 0.5 * ((hue + 0.00) * std::f32::consts::TAU).cos();
    let g = 0.5 + 0.5 * ((hue + 0.33) * std::f32::consts::TAU).cos();
    let b = 0.5 + 0.5 * ((hue + 0.67) * std::f32::consts::TAU).cos();
    [r.max(0.18), g.max(0.18), b.max(0.18), alpha.clamp(0.0, 1.0)]
}
