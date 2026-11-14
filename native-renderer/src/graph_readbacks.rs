//! Live readbacks for graph layers the app describes.
//!
//! A graph may name a few small, persistent buffers under `live_readbacks`.
//! The core copies one out only after someone has asked for it (`LiveReadbacks::ask`:
//! the `take_graph_readbacks` RPC asks for the next copy of each id it takes),
//! so a buffer read ten times a second is copied ten times a second, not on
//! every frame. One copy is in flight per buffer, into a staging buffer kept
//! for that id (see `render_native_graph_frame_jobs`), and the newest bytes
//! wait in `graph_readback_results` until the app takes them. The
//! Interactive Studio reads its 3D world's zone counters this way, a read or
//! two late, which is fine for firing show actions. Everything kept for a
//! buffer goes when its graph's buffers are dropped.

use std::collections::HashMap;

use base64::Engine;
use serde_json::{Map, Value};

use crate::compute_graph::NativeComputeGraphBufferSpec;

/// The most buffers one graph may read back live, and the most bytes each.
pub(crate) const MAX_LIVE_READBACKS: usize = 4;
pub(crate) const MAX_LIVE_READBACK_BYTES: u64 = 4096;

/// The most ids waiting for a copy; past it the oldest ask is dropped.
pub(crate) const MAX_ASKED_READBACKS: usize = 256;

/// The readbacks someone has asked for, and the staging buffer each copies into.
pub(crate) struct LiveReadbacks<B> {
    /// Oldest first.
    asked: Vec<String>,
    staging: HashMap<String, (B, u64)>,
}

impl<B> Default for LiveReadbacks<B> {
    fn default() -> Self {
        Self { asked: Vec::new(), staging: HashMap::new() }
    }
}

impl<B: Clone> LiveReadbacks<B> {
    /// Copy `id` out the next time a frame has it.
    pub(crate) fn ask(&mut self, id: &str) {
        if self.asked.iter().any(|known| known == id) {
            return;
        }
        if self.asked.len() >= MAX_ASKED_READBACKS {
            self.asked.remove(0);
        }
        self.asked.push(id.to_string());
    }

    /// True (and the ask is used up) when `id` was asked for.
    pub(crate) fn take_ask(&mut self, id: &str) -> bool {
        match self.asked.iter().position(|known| known == id) {
            Some(at) => {
                self.asked.remove(at);
                true
            }
            None => false,
        }
    }

    /// The staging buffer for `id`: the one it had when the size is the same, else a new one.
    pub(crate) fn staging(&mut self, id: &str, byte_length: u64, create: impl FnOnce() -> B) -> B {
        if let Some((buffer, size)) = self.staging.get(id)
            && *size == byte_length
        {
            return buffer.clone();
        }
        let buffer = create();
        self.staging.insert(id.to_string(), (buffer.clone(), byte_length));
        buffer
    }

    /// Drop `id`'s staging buffer (its last map failed).
    pub(crate) fn forget_staging(&mut self, id: &str) {
        self.staging.remove(id);
    }

    /// Forget every id `keep` turns down.
    pub(crate) fn retain(&mut self, keep: impl Fn(&str) -> bool) {
        self.asked.retain(|id| keep(id));
        self.staging.retain(|id, _| keep(id));
    }

    #[cfg(test)]
    fn counts(&self) -> (usize, usize) {
        (self.asked.len(), self.staging.len())
    }
}

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
/// gone; a buffer with nothing new is left out. Each id is asked for again,
/// so the next frame that has it copies it out for the next take.
pub(crate) fn take_readbacks<B: Clone>(
    results: &mut HashMap<String, Vec<u8>>,
    live: &mut LiveReadbacks<B>,
    params: &Value,
) -> Result<Value, String> {
    let ids = params
        .get("ids")
        .and_then(Value::as_array)
        .ok_or("take_graph_readbacks needs `ids`, a list of buffer ids")?;
    if ids.len() > 64 {
        return Err("take_graph_readbacks takes at most 64 ids".to_string());
    }
    let mut out = Map::new();
    for id in ids.iter().filter_map(Value::as_str) {
        live.ask(id);
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
        let mut live = LiveReadbacks::<u32>::default();
        let taken = take_readbacks(&mut results, &mut live, &json!({ "ids": ["a", "missing"] })).unwrap();
        assert_eq!(taken, json!({ "readbacks": { "a": "AQID" } }));
        // Gone once taken; buffers not asked for stay for their owner.
        assert_eq!(take_readbacks(&mut results, &mut live, &json!({ "ids": ["a"] })).unwrap(), json!({ "readbacks": {} }));
        assert!(results.contains_key("other"));
        assert!(take_readbacks(&mut results, &mut live, &json!({})).is_err());
    }

    #[test]
    fn copies_only_what_was_asked_for_once_per_ask() {
        let mut results = HashMap::new();
        let mut live = LiveReadbacks::<u32>::default();
        // Nothing asked: a frame copies nothing.
        assert!(!live.take_ask("zones"));
        // A take asks for the next copy of each id it names, once.
        take_readbacks(&mut results, &mut live, &json!({ "ids": ["zones", "zones"] })).unwrap();
        assert!(live.take_ask("zones"));
        assert!(!live.take_ask("zones"));
        // Asking twice before a frame is still one copy.
        live.ask("zones");
        live.ask("zones");
        assert!(live.take_ask("zones"));
        assert!(!live.take_ask("zones"));
    }

    #[test]
    fn reuses_one_staging_buffer_per_id_until_its_size_changes() {
        let mut live = LiveReadbacks::<u32>::default();
        let made = std::cell::Cell::new(0);
        let make = || {
            made.set(made.get() + 1);
            made.get()
        };
        let first = live.staging("zones", 64, make);
        for _ in 0..100 {
            assert_eq!(live.staging("zones", 64, make), first);
        }
        assert_eq!(made.get(), 1);
        let bigger = live.staging("zones", 128, make);
        assert_ne!(bigger, first);
        assert_eq!(made.get(), 2);
        assert_eq!(live.counts(), (0, 1));
    }

    #[test]
    fn keeps_a_bounded_list_of_asks_and_forgets_removed_buffers() {
        let mut live = LiveReadbacks::<u32>::default();
        for i in 0..(MAX_ASKED_READBACKS + 10) {
            live.ask(&format!("scene3d:layer-{i}:zone-hits"));
        }
        assert_eq!(live.counts().0, MAX_ASKED_READBACKS);
        // The oldest asks went first.
        assert!(!live.take_ask("scene3d:layer-0:zone-hits"));
        assert!(live.take_ask(&format!("scene3d:layer-{}:zone-hits", MAX_ASKED_READBACKS + 9)));
        live.staging("scene3d:layer-20:zone-hits", 64, || 1);
        live.staging("scene3d:layer-21:zone-hits", 64, || 2);
        // A removed layer's graph buffers go, and with them its readback state.
        live.retain(|id| !id.contains(":layer-20:"));
        assert!(!live.take_ask("scene3d:layer-20:zone-hits"));
        assert!(live.take_ask("scene3d:layer-21:zone-hits"));
        assert_eq!(live.counts().1, 1);
    }
}
