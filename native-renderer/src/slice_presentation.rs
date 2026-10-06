//! Presentation capability is independent of whether any Screen is open.
//! Electron probes this before creating a window; false forces a legacy path.
use serde_json::{json, Value};

pub(crate) fn metadata(transport: &str, slices: Vec<Value>) -> Value {
    json!({
        "available": matches!(transport, "iosurface" | "dxgi" | "x11"),
        "platform": transport,
        "slices": slices,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn slice_presentation_available_before_first_window_on_both_platforms() {
        for transport in ["dxgi", "iosurface"] {
            assert_eq!(metadata(transport, vec![])["available"], true);
        }
    }
    #[test]
    fn slice_presentation_retains_distinct_windows_texture_names_and_frames() {
        let slices = vec![json!({"id":"left","shared_name":"left-texture","frame":12}),
                          json!({"id":"right","shared_name":"right-texture","frame":13})];
        let state = metadata("dxgi", slices.clone());
        assert_eq!(state["available"], true);
        assert_eq!(state["slices"], json!(slices));
        assert_eq!(metadata("unsupported", vec![])["available"], false);
    }
}
