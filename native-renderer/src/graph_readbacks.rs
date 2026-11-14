//! Live readbacks for graph layers the app describes.
//!
//! A graph may name a few small, persistent buffers under `live_readbacks`.
//! Each frame the layer draws, the core copies them out (one copy in flight
//! per buffer, see `render_native_graph_frame_jobs`), and the newest bytes
//! wait in `graph_readback_results` until the app takes them with the
//! `take_graph_readbacks` RPC. The Interactive Studio reads its 3D world's
//! zone counters this way, a few frames late, which is fine for firing show
//! actions.

use std::collections::HashMap;

use base64::Engine;
use serde_json::{Map, Value};

use crate::compute_graph::NativeComputeGraphBufferSpec;

/// The most buffers one graph may read back live, and the most bytes each.
pub(crate) const MAX_LIVE_READBACKS: usize = 4;
pub(crate) const MAX_LIVE_READBACK_BYTES: u64 = 4096;

/// The buffers a graph reads back live: declared, persistent and small.
pub(crate) fn live_readback_ids(
    params: &Value,
    buffers: &[NativeComputeGraphBufferSpec],
) -> Result<Vec<String>, String> {
    let Some(values) = params.get("live_readbacks") else {
        return Ok(Vec::new());
    };
    let values = values
        .as_array()
        .ok_or("compute_graph live_readbacks must be a list of buffer ids")?;
    if values.len() > MAX_LIVE_READBACKS {
        return Err(format!("compute_graph reads back at most {MAX_LIVE_READBACKS} buffers live"));
    }
    let mut ids = Vec::new();
    for value in values {
        let id = value
            .as_str()
            .ok_or("compute_graph live_readbacks must be a list of buffer ids")?;
        let buffer = buffers
            .iter()
            .find(|buffer| buffer.id == id)
            .ok_or_else(|| format!("compute_graph live readback `{id}` is not a declared buffer"))?;
        if !buffer.persistent {
            return Err(format!("compute_graph live readback `{id}` must be persistent"));
        }
        if buffer.byte_length > MAX_LIVE_READBACK_BYTES {
            return Err(format!(
                "compute_graph live readback `{id}` is {} bytes; the most is {MAX_LIVE_READBACK_BYTES}",
                buffer.byte_length
            ));
        }
        if !ids.iter().any(|known: &String| known == id) {
            ids.push(id.to_string());
        }
    }
    Ok(ids)
}

/// The `take_graph_readbacks` RPC: the newest bytes of each asked-for buffer
/// that has landed since the last take, base64, keyed by id. Taken bytes are
/// gone; a buffer with nothing new is left out.
pub(crate) fn take_readbacks(results: &mut HashMap<String, Vec<u8>>, params: &Value) -> Result<Value, String> {
    let ids = params
        .get("ids")
        .and_then(Value::as_array)
        .ok_or("take_graph_readbacks needs `ids`, a list of buffer ids")?;
    if ids.len() > 64 {
        return Err("take_graph_readbacks takes at most 64 ids".to_string());
    }
    let mut out = Map::new();
    for id in ids.iter().filter_map(Value::as_str) {
        if let Some(bytes) = results.remove(id) {
            out.insert(id.to_string(), Value::String(base64::engine::general_purpose::STANDARD.encode(bytes)));
        }
    }
    Ok(Value::Object(Map::from_iter([("readbacks".to_string(), Value::Object(out))])))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::compute_graph::NativeComputeBufferBindingKind;
    use serde_json::json;

    fn buffer(id: &str, byte_length: u64, persistent: bool) -> NativeComputeGraphBufferSpec {
        NativeComputeGraphBufferSpec {
            id: id.to_string(),
            byte_length,
            kind: NativeComputeBufferBindingKind::StorageReadWrite,
            initial_bytes: Vec::new(),
            persistent,
            clear: false,
            indirect: false,
        }
    }

    #[test]
    fn reads_back_only_small_persistent_declared_buffers() {
        let buffers = [buffer("a", 64, true), buffer("big", 8192, true), buffer("t", 64, false)];
        assert_eq!(live_readback_ids(&json!({}), &buffers).unwrap(), Vec::<String>::new());
        assert_eq!(live_readback_ids(&json!({ "live_readbacks": ["a", "a"] }), &buffers).unwrap(), vec!["a"]);
        assert!(live_readback_ids(&json!({ "live_readbacks": ["big"] }), &buffers).is_err());
        assert!(live_readback_ids(&json!({ "live_readbacks": ["t"] }), &buffers).is_err());
        assert!(live_readback_ids(&json!({ "live_readbacks": ["nope"] }), &buffers).is_err());
        assert!(live_readback_ids(&json!({ "live_readbacks": "a" }), &buffers).is_err());
        assert!(live_readback_ids(&json!({ "live_readbacks": ["a", "a", "a", "a", "a"] }), &buffers).is_err());
    }

    #[test]
    fn take_hands_over_what_landed_once() {
        let mut results = HashMap::from([("a".to_string(), vec![1u8, 2, 3]), ("other".to_string(), vec![9u8])]);
        let taken = take_readbacks(&mut results, &json!({ "ids": ["a", "missing"] })).unwrap();
        assert_eq!(taken, json!({ "readbacks": { "a": "AQID" } }));
        // Gone once taken; buffers not asked for stay for their owner.
        assert_eq!(take_readbacks(&mut results, &json!({ "ids": ["a"] })).unwrap(), json!({ "readbacks": {} }));
        assert!(results.contains_key("other"));
        assert!(take_readbacks(&mut results, &json!({})).is_err());
    }
}
