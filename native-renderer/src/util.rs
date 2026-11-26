//! Small helpers used across the core.

use crate::*;

pub(crate) fn stable_hash64(input: &str) -> u64 {
    let mut hash = 0xcbf29ce484222325_u64;
    for byte in input.as_bytes() {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

pub(crate) fn json_channel_to_unit(value: &Value) -> f32 {
    let n = value.as_f64().unwrap_or(0.0);
    if n > 1.0 {
        (n / 255.0).clamp(0.0, 1.0) as f32
    } else {
        n.clamp(0.0, 1.0) as f32
    }
}

pub(crate) fn stable_slot(id: &str, slot_count: usize) -> usize {
    let mut hash = 2166136261_u32;
    for byte in id.as_bytes() {
        hash ^= *byte as u32;
        hash = hash.wrapping_mul(16777619);
    }
    (hash as usize) % slot_count.max(1)
}

pub(crate) fn epoch_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}
