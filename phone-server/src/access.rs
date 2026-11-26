//! Who may send what, the same rules as server/remote-access.cjs.

use crate::{js, pairing};
use serde_json::{Map, Value};

/// Only the registered desktop may send these.
pub const HOST_MESSAGES: &[&str] = &[
    "sync", "library_sync", "vj_clips_sync", "compositions_sync", "shader_library_sync",
    "beat_pulse", "output_freeze_state", "studio_scene_status", "studio_capabilities",
    "studio_calibration_status", "studio_scan_status", "studio_depth_capture_status", "studio_depth_scan_request", "phone_camera_answer",
    "studio_automap_reply",
    "phone_vision_status", "show_state",
];

pub fn is_host_message(kind: &str) -> bool {
    HOST_MESSAGES.contains(&kind)
}

/// The address as Node reports `socket.remoteAddress`.
pub fn is_loopback(address: &str) -> bool {
    address == "127.0.0.1" || address == "::1" || address == "::ffff:127.0.0.1"
}

/// `authorizedHost`: on this machine, holding the desktop credential.
pub fn authorized_host(secret: Option<&str>, presented: Option<&Value>, address: &str) -> bool {
    is_loopback(address) && pairing::tokens_equal(secret, presented.and_then(Value::as_str))
}

pub fn authorized_host_header(secret: Option<&str>, presented: Option<&str>, address: &str) -> bool {
    is_loopback(address) && pairing::tokens_equal(secret, presented)
}

/// `/^(\.?\/)?ISF\/([^/\\?#:]+\/)*[^/\\?#:]+\.fs$/`
pub fn bundled_shader(src: &str) -> bool {
    let segment_ok = |s: &str| !s.is_empty() && !s.contains(['/', '\\', '?', '#', ':']);
    let rest_ok = |rest: &str| {
        let Some(path) = rest.strip_prefix("ISF/") else { return false };
        let parts: Vec<&str> = path.split('/').collect();
        let (last, dirs) = parts.split_last().expect("split yields one part");
        dirs.iter().all(|d| segment_ok(d)) && segment_ok(last) && last.len() > 3 && last.ends_with(".fs")
    };
    [Some(src), src.strip_prefix("./"), src.strip_prefix('/')]
        .into_iter()
        .flatten()
        .any(rest_ok)
}

/// `/^#[\da-f]{6}([\da-f]{2})?$/i`
fn colour(src: &str) -> bool {
    let Some(hexes) = src.strip_prefix('#') else { return false };
    (hexes.len() == 6 || hexes.len() == 8) && hexes.bytes().all(|b| b.is_ascii_hexdigit())
}

/// `permittedSource`: a phone selects only what the desktop has advertised.
pub fn permitted_source(msg: &Map<String, Value>, media: Option<&Value>, shaders: &[Value]) -> bool {
    let (Some(src), Some(_)) = (js::string(msg.get("sourceSrc")), js::string(msg.get("layerId"))) else {
        return false;
    };
    let kind = msg.get("sourceType");
    let kind_is = |k: &str| kind.and_then(Value::as_str) == Some(k);
    if kind_is("color") {
        return colour(src);
    }
    if kind_is("shader") && bundled_shader(src) && !src.contains("..") {
        return true;
    }
    if !["shader", "video", "image", "threejs"].iter().any(|k| kind_is(k)) {
        return false;
    }
    let catalog: &[Value] = if kind_is("shader") {
        shaders
    } else {
        match media {
            Some(Value::Array(items)) => items,
            _ => return false,
        }
    };
    catalog.iter().any(|item| match item {
        Value::Object(map) => map.get("src").and_then(Value::as_str) == Some(src),
        _ => false,
    })
}

fn id_ok(v: Option<&Value>) -> bool {
    js::string(v).is_some_and(|s| {
        let n = s.chars().count();
        (1..=128).contains(&n) && s.chars().all(|c| js::is_word(c) || matches!(c, '.' | ':' | '-'))
    })
}

const SCAN_MAX_BYTES: f64 = 64.0 * 1024.0 * 1024.0;
const SCAN_MAX_CHUNK_BYTES: f64 = 2.0 * 1024.0 * 1024.0;
const SCAN_TERMINAL: &[&str] = &["saved", "declined", "failed", "aborted"];
const SCAN_STATES: &[&str] = &["waiting", "ready", "progress", "saved", "declined", "failed", "aborted"];

fn one_of(v: Option<&Value>, set: &[&str]) -> bool {
    v.and_then(Value::as_str).is_some_and(|s| set.contains(&s))
}

fn text_at_most(v: Option<&Value>, max: usize) -> bool {
    js::string(v).is_some_and(|s| js::len16(s) <= max)
}

fn kind(msg: &Map<String, Value>) -> &str {
    msg.get("type").and_then(Value::as_str).unwrap_or("")
}

pub fn scan_message_allowed(msg: &Map<String, Value>) -> bool {
    if !id_ok(msg.get("requestId")) {
        return false;
    }
    match kind(msg) {
        "studio_scan_offer" => {
            text_at_most(msg.get("name"), 300)
                && js::integer(msg.get("bytes")).is_some_and(|b| b > 0.0 && b <= SCAN_MAX_BYTES)
                && js::string(msg.get("sha256")).is_some_and(|s| s.len() == 64 && s.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')))
                && js::integer(msg.get("chunkBytes")).is_some_and(|b| b > 0.0 && b <= SCAN_MAX_CHUNK_BYTES)
        }
        "studio_scan_chunk" => {
            let max = (SCAN_MAX_CHUNK_BYTES / 3.0).ceil() as usize * 4 + 4;
            js::integer(msg.get("index")).is_some_and(|i| (0.0..4096.0).contains(&i)) && text_at_most(msg.get("data"), max)
        }
        "studio_scan_abort" => true,
        "studio_scan_status" => one_of(msg.get("state"), SCAN_STATES),
        _ => false,
    }
}

pub fn scan_message_ends(msg: &Map<String, Value>) -> bool {
    kind(msg) == "studio_scan_abort" || (kind(msg) == "studio_scan_status" && one_of(msg.get("state"), SCAN_TERMINAL))
}

const DEPTH_MAX_BYTES: usize = 8_000_000;
const DEPTH_TERMINAL: &[&str] = &["applied", "declined", "error"];
const DEPTH_STATES: &[&str] = &["received", "applied", "declined", "error"];
const DEPTH_STAGES: &[&str] = &["ready", "measuring", "patterns", "solving", "sending", "cancelled", "error"];

/// `shortText`: absent, or a string no longer than `max`.
fn short_text(v: Option<&Value>, max: usize) -> bool {
    v.is_none() || text_at_most(v, max)
}

/// `bytes` is the JSON size of the offer's capture.
pub fn depth_message_allowed(msg: &Map<String, Value>, bytes: usize) -> bool {
    if !id_ok(msg.get("requestId")) {
        return false;
    }
    match kind(msg) {
        "studio_depth_capture_offer" => js::plain_object(msg.get("capture")).is_some() && bytes > 0 && bytes <= DEPTH_MAX_BYTES,
        "studio_depth_capture_status" => one_of(msg.get("state"), DEPTH_STATES) && short_text(msg.get("message"), 500),
        "studio_depth_scan_request" => {
            let dim = |v: Option<&Value>| js::integer(v).is_some_and(|d| d > 0.0 && d <= 32768.0);
            let output = msg.get("output");
            text_at_most(msg.get("to"), 120)
                && text_at_most(msg.get("layerId"), 128)
                && (msg.get("screenId").is_none() || text_at_most(msg.get("screenId"), 128))
                && js::truthy(output)
                && dim(js::get(output, "width").ok().flatten())
                && dim(js::get(output, "height").ok().flatten())
        }
        "studio_depth_scan_progress" => {
            one_of(msg.get("stage"), DEPTH_STAGES)
                && short_text(msg.get("message"), 300)
                && match msg.get("pct") {
                    None => true,
                    Some(v) => v.as_f64().is_some_and(|p| (0.0..=100.0).contains(&p)),
                }
        }
        _ => false,
    }
}

pub fn depth_message_ends(msg: &Map<String, Value>) -> bool {
    (kind(msg) == "studio_depth_capture_status" && one_of(msg.get("state"), DEPTH_TERMINAL))
        || (kind(msg) == "studio_depth_scan_progress" && one_of(msg.get("stage"), &["cancelled", "error"]))
}

fn chunk_allowed(msg: &Map<String, Value>, kind_name: &str, max_count: f64, max_data: usize) -> bool {
    kind(msg) == kind_name
        && id_ok(msg.get("requestId"))
        && match (js::integer(msg.get("count")), js::integer(msg.get("index"))) {
            (Some(count), Some(index)) => count >= 1.0 && count <= max_count && index >= 0.0 && index < count,
            _ => false,
        }
        && text_at_most(msg.get("data"), max_data)
}

pub fn diagnostics_message_allowed(msg: &Map<String, Value>) -> bool {
    chunk_allowed(msg, "studio_automap_diagnostics", 64.0, 4 * 1024 * 1024)
}

pub fn calibration_chunk_allowed(msg: &Map<String, Value>) -> bool {
    chunk_allowed(msg, "studio_calibration_chunk", 24.0, 1024 * 1024)
}

/// `describeClient`: the phone app a capabilities request names, short and plain.
pub fn describe_client(raw: Option<&Value>) -> Option<Map<String, Value>> {
    if !js::truthy(raw) || !matches!(raw, Some(Value::Object(_) | Value::Array(_))) {
        return None;
    }
    let part = |key: &str| -> String {
        let v = js::get(raw, key).ok().flatten();
        match v {
            Some(Value::String(_) | Value::Number(_)) => {
                let s: String = js::to_string(v).chars().filter(|&c| js::is_word(c) || matches!(c, '.' | '+' | ' ' | '-')).collect();
                js::slice16(&s, 40)
            }
            _ => String::new(),
        }
    };
    let mut client = Map::new();
    for key in ["app", "version", "build", "name"] {
        client.insert(key.into(), Value::String(part(key)));
    }
    let has = |k: &str| client.get(k).and_then(Value::as_str).is_some_and(|s| !s.is_empty());
    (has("app") || has("version")).then_some(client)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn obj(v: Value) -> Map<String, Value> {
        v.as_object().unwrap().clone()
    }

    #[test]
    fn bundled_shader_paths() {
        for ok in ["ISF/a.fs", "./ISF/a.fs", "/ISF/x/y.fs", "ISF/DM-Plasma%20Wave.fs", "ISF/..fs"] {
            assert!(bundled_shader(ok), "{ok}");
        }
        for bad in ["ISF/.fs", "ISF/a.fsx", "ISF//a.fs", "//ISF/a.fs", ".ISF/a.fs", "ISF/a:b.fs", "ISF/a?.fs", "isf/a.fs", "ISF/a.fs\n"] {
            assert!(!bundled_shader(bad), "{bad}");
        }
    }

    #[test]
    fn sources_must_be_advertised() {
        let shaders = vec![json!({"src": "/ISF/Safe.fs"})];
        let src = |kind: &str, s: &str| obj(json!({"layerId": "L", "sourceType": kind, "sourceSrc": s}));
        assert!(permitted_source(&src("shader", "/ISF/Safe.fs"), None, &shaders));
        assert!(!permitted_source(&src("shader", "http://169.254.169.254/"), None, &shaders));
        assert!(!permitted_source(&src("shader", "./ISF/../x.fs"), None, &shaders));
        assert!(permitted_source(&src("color", "#A0b1c2"), None, &shaders));
        assert!(!permitted_source(&src("color", "#A0b1c"), None, &shaders));
        assert!(permitted_source(&src("video", "v.mp4"), Some(&json!([{"src": "v.mp4"}])), &shaders));
        assert!(!permitted_source(&src("video", "v.mp4"), Some(&json!({"src": "v.mp4"})), &shaders));
        assert!(!permitted_source(&src("p5", "/ISF/Safe.fs"), None, &shaders));
    }

    #[test]
    fn scan_and_depth_shapes() {
        let sha = "a".repeat(64);
        assert!(scan_message_allowed(&obj(json!({"type": "studio_scan_offer", "requestId": "r1", "name": "n", "bytes": 10, "sha256": sha, "chunkBytes": 4}))));
        assert!(!scan_message_allowed(&obj(json!({"type": "studio_scan_offer", "requestId": "r1", "name": "n", "bytes": 10.5, "sha256": sha, "chunkBytes": 4}))));
        assert!(!scan_message_allowed(&obj(json!({"type": "studio_scan_chunk", "requestId": "r 1", "index": 0, "data": ""}))));
        assert!(scan_message_allowed(&obj(json!({"type": "studio_scan_chunk", "requestId": "r1", "index": 0, "data": "x".repeat(2796208)}))));
        assert!(!scan_message_allowed(&obj(json!({"type": "studio_scan_chunk", "requestId": "r1", "index": 0, "data": "x".repeat(2796209)}))));
        assert!(depth_message_allowed(&obj(json!({"type": "studio_depth_capture_offer", "requestId": "d", "capture": {}})), 2));
        assert!(!depth_message_allowed(&obj(json!({"type": "studio_depth_capture_offer", "requestId": "d", "capture": []})), 2));
        assert!(!depth_message_allowed(&obj(json!({"type": "studio_depth_capture_status", "requestId": "d", "state": "applied", "message": null})), 0));
        assert!(depth_message_allowed(&obj(json!({"type": "studio_depth_scan_request", "requestId": "d", "to": "a", "layerId": "l", "output": {"width": 10, "height": 2.0}})), 0));
        assert!(!depth_message_allowed(&obj(json!({"type": "studio_depth_scan_request", "requestId": "d", "to": "a", "layerId": "l", "output": "x"})), 0));
        assert!(calibration_chunk_allowed(&obj(json!({"type": "studio_calibration_chunk", "requestId": "c", "count": 24, "index": 23, "data": ""}))));
        assert!(!calibration_chunk_allowed(&obj(json!({"type": "studio_calibration_chunk", "requestId": "c", "count": 25, "index": 0, "data": ""}))));
    }

    #[test]
    fn clients_and_hosts() {
        let c = describe_client(Some(&json!({"app": "Ghost<script>", "version": 1.5}))).unwrap();
        assert_eq!(c["app"], "Ghostscript");
        assert_eq!(c["version"], "1.5");
        assert!(describe_client(Some(&json!({"name": "x"}))).is_none());
        assert!(authorized_host(Some("s3cret"), Some(&json!("s3cret")), "127.0.0.1"));
        assert!(!authorized_host(Some("s3cret"), Some(&json!("s3cret")), "127.0.0.2"));
        assert!(!authorized_host(Some("s3cret"), Some(&json!("s3cret")), "192.168.1.4"));
    }
}
