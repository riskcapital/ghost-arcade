//! Binary payload frames on the stdin/stdout RPC pipes.
//!
//! The RPC stays one JSON object per line. A message may be preceded by a
//! header line that announces raw payloads:
//!
//! ```text
//! #B <len0> <len1> ...\n
//! <len0 bytes><len1 bytes>...
//! {"id":7,"method":"submit_batch","params":{... "initial_b64":{"$blob":0} ...}}\n
//! ```
//!
//! The JSON names each payload by its index, `{"$blob": n}`, where a base64
//! string would otherwise be. Large float arrays and pixel data then cross the
//! pipe as bytes instead of as JSON numbers or base64 inside a JSON string,
//! which is what the Electron main thread spent its time serialising and
//! parsing. Everything else (ordering, ids, timeouts, errors) is unchanged:
//! it is the same pipe and the same messages.
//!
//! Inbound, a payload is turned back into the base64 string the command
//! handlers already read, on the reader thread, so no handler changes and a
//! command queued for a later frame keeps its data. Outbound, the writer
//! thread lifts large base64 values (frame snapshot pixels, JPEG previews) out
//! of a response line so the main process need not scan them as JSON.
//!
//! Outbound frames are written only when the broker asked for them with
//! `GA_CORE_IPC_FRAMES=1`; the core then says so first with a hello line
//! (`{"id":0,"ipc_frames":1}`), which tells the broker it may send frames
//! too. Inbound frames are accepted either way.
//!
//! Raw bytes: when the broker also sets `GA_CORE_IPC_BYTES=1`, a request that
//! asks with `pixel_bytes: true` gets its snapshot pixels (or JPEG) as raw
//! bytes rather than base64. The handler parks the bytes with
//! [`bytes_value`], which returns a placeholder string for the reply; the
//! writer thread swaps each placeholder for `{"$bytes": n}` and writes the
//! bytes as payload `n`. The broker hands those to the renderer as a
//! Uint8Array, so nothing on the way encodes or decodes base64. The field is
//! named `*_raw` (`rgba_raw`, `jpeg_raw`) so a reader can tell the two apart.

use base64::Engine as _;
use serde_json::Value;
use std::io::{self, BufRead, Read, Write};
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

pub(crate) const FRAMES_ENV: &str = "GA_CORE_IPC_FRAMES";
pub(crate) const FRAME_HEADER: &[u8] = b"#B ";
/// Most payloads one message may carry.
const MAX_BLOBS: usize = 4096;
/// Outbound: only lines at least this long are searched for base64 values,
/// and only values at least this long are lifted out.
const OUTBOUND_LINE_MIN: usize = 64 * 1024;
const OUTBOUND_VALUE_MIN: usize = 16 * 1024;

pub(crate) const BYTES_ENV: &str = "GA_CORE_IPC_BYTES";
/// A parked payload not written within this long belonged to a reply that
/// was never sent; it is dropped.
const PARKED_MAX_AGE: Duration = Duration::from_secs(30);
const PARKED_MAX: usize = 64;

static FRAMES_OUT: AtomicBool = AtomicBool::new(false);
static BYTES_OUT: AtomicBool = AtomicBool::new(false);
static PARKED: Mutex<VecDeque<(u64, Instant, Vec<u8>)>> = Mutex::new(VecDeque::new());
static PARKED_COUNT: AtomicUsize = AtomicUsize::new(0);
static NEXT_TOKEN: AtomicU64 = AtomicU64::new(1);
static MARKER: OnceLock<String> = OnceLock::new();

/// Reads `GA_CORE_IPC_FRAMES`; returns the hello line to send first when the
/// broker asked for frames.
pub(crate) fn init_from_env() -> Option<String> {
    let enabled = std::env::var(FRAMES_ENV).map(|value| value.trim() == "1").unwrap_or(false);
    let bytes = enabled && std::env::var(BYTES_ENV).map(|value| value.trim() == "1").unwrap_or(false);
    FRAMES_OUT.store(enabled, Ordering::Release);
    BYTES_OUT.store(bytes, Ordering::Release);
    enabled.then(|| r#"{"id":0,"ipc_frames":1}"#.to_string())
}

/// True when this request's pixels may go out as raw bytes: the broker can
/// read them and the caller asked (`pixel_bytes: true`).
pub(crate) fn bytes_wanted(params: &Value) -> bool {
    BYTES_OUT.load(Ordering::Acquire) && params.get("pixel_bytes").and_then(Value::as_bool) == Some(true)
}

/// The placeholder prefix: a JSON string value starting with it names a
/// parked payload. The process id and start time keep it from matching text
/// that merely looks like it.
fn marker() -> &'static str {
    MARKER.get_or_init(|| {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.subsec_nanos())
            .unwrap_or(0);
        format!("$ga_bytes:{}:{nanos}:", std::process::id())
    })
}

/// Parks `bytes` for the writer and returns the placeholder to put in the
/// reply where the base64 string would go.
pub(crate) fn bytes_value(bytes: Vec<u8>) -> Value {
    let token = NEXT_TOKEN.fetch_add(1, Ordering::Relaxed);
    let now = Instant::now();
    if let Ok(mut parked) = PARKED.lock() {
        while parked.front().is_some_and(|(_, at, _)| now.duration_since(*at) > PARKED_MAX_AGE)
            || parked.len() >= PARKED_MAX
        {
            parked.pop_front();
        }
        parked.push_back((token, now, bytes));
        PARKED_COUNT.store(parked.len(), Ordering::Release);
    }
    Value::String(format!("{}{token}", marker()))
}

fn take_parked(token: u64) -> Option<Vec<u8>> {
    let mut parked = PARKED.lock().ok()?;
    let index = parked.iter().position(|(t, _, _)| *t == token)?;
    let (_, _, bytes) = parked.remove(index)?;
    PARKED_COUNT.store(parked.len(), Ordering::Release);
    Some(bytes)
}

/// Swaps each placeholder in `line` for `{"$bytes": n}` and returns the
/// payloads in order. A placeholder whose payload is gone becomes null (or,
/// with nothing parked at all, is left as it is): either way no bytes.
fn take_raw_values(line: &str) -> Option<(String, Vec<Vec<u8>>)> {
    if PARKED_COUNT.load(Ordering::Acquire) == 0 {
        return None;
    }
    let prefix = format!("\"{}", marker());
    if !line.contains(&prefix) {
        return None;
    }
    let mut blobs = Vec::new();
    let mut json = String::with_capacity(line.len());
    let mut rest = line;
    while let Some(found) = rest.find(&prefix) {
        let digits_start = found + prefix.len();
        let digits = rest[digits_start..].bytes().take_while(u8::is_ascii_digit).count();
        let end = digits_start + digits;
        if digits == 0 || rest.as_bytes().get(end) != Some(&b'"') {
            json.push_str(&rest[..digits_start]);
            rest = &rest[digits_start..];
            continue;
        }
        json.push_str(&rest[..found]);
        match rest[digits_start..end].parse::<u64>().ok().and_then(take_parked) {
            Some(bytes) => {
                json.push_str(&format!("{{\"$bytes\":{}}}", blobs.len()));
                blobs.push(bytes);
            }
            None => json.push_str("null"),
        }
        rest = &rest[end + 1..];
    }
    json.push_str(rest);
    Some((json, blobs))
}

/// One message read from the input: its JSON line and the payloads it names.
pub(crate) struct InboundMessage {
    pub line: Vec<u8>,
    pub blobs: Vec<Vec<u8>>,
}

impl InboundMessage {
    pub(crate) fn byte_len(&self) -> u64 {
        self.line.len() as u64 + self.blobs.iter().map(|blob| blob.len() as u64).sum::<u64>()
    }
}

pub(crate) enum ReadOutcome {
    Message(InboundMessage),
    /// End of input or a read error: the owner is gone.
    Closed,
    /// Over the size limit or a malformed header; the stream cannot be
    /// trusted past this point.
    Fatal(String),
}

/// Reads the next message (an optional frame header and its payloads, then
/// one JSON line), no more than `max_bytes` in all.
pub(crate) fn read_message<R: BufRead>(input: &mut R, max_bytes: u64) -> ReadOutcome {
    let mut line = Vec::new();
    match input.by_ref().take(max_bytes + 1).read_until(b'\n', &mut line) {
        Ok(n) if n > 0 => {}
        _ => return ReadOutcome::Closed,
    }
    if line.len() as u64 > max_bytes {
        return ReadOutcome::Fatal(format!("RPC exceeds {} MiB limit", max_bytes / (1024 * 1024)));
    }
    if !line.starts_with(FRAME_HEADER) {
        return ReadOutcome::Message(InboundMessage { line, blobs: Vec::new() });
    }
    let lengths = match parse_header(&line) {
        Ok(lengths) => lengths,
        Err(err) => return ReadOutcome::Fatal(err),
    };
    let total: u64 = lengths.iter().sum();
    if total > max_bytes {
        return ReadOutcome::Fatal(format!("RPC payloads exceed {} MiB limit", max_bytes / (1024 * 1024)));
    }
    let mut blobs = Vec::with_capacity(lengths.len());
    for length in lengths {
        let mut blob = vec![0u8; length as usize];
        if input.read_exact(&mut blob).is_err() {
            return ReadOutcome::Closed;
        }
        blobs.push(blob);
    }
    let mut json = Vec::new();
    match input.by_ref().take(max_bytes - total + 1).read_until(b'\n', &mut json) {
        Ok(n) if n > 0 => {}
        _ => return ReadOutcome::Closed,
    }
    if json.len() as u64 + total > max_bytes {
        return ReadOutcome::Fatal(format!("RPC exceeds {} MiB limit", max_bytes / (1024 * 1024)));
    }
    if json.starts_with(FRAME_HEADER) {
        return ReadOutcome::Fatal("frame header without a message".to_string());
    }
    ReadOutcome::Message(InboundMessage { line: json, blobs })
}

fn parse_header(line: &[u8]) -> Result<Vec<u64>, String> {
    let text = std::str::from_utf8(&line[FRAME_HEADER.len()..])
        .map_err(|_| "frame header is not text".to_string())?;
    let mut lengths = Vec::new();
    for part in text.split_ascii_whitespace() {
        if lengths.len() >= MAX_BLOBS {
            return Err("frame header names too many payloads".to_string());
        }
        lengths.push(part.parse::<u64>().map_err(|_| format!("bad frame payload length `{part}`"))?);
    }
    if lengths.is_empty() {
        return Err("frame header names no payloads".to_string());
    }
    Ok(lengths)
}

/// Replaces each `{"$blob": n}` in `value` with payload `n` as the base64
/// string the command handlers expect. A reference to a missing payload is
/// an error, so a message is never applied with a hole in it.
pub(crate) fn splice_blobs(value: &mut Value, blobs: &[Vec<u8>]) -> Result<(), String> {
    if blobs.is_empty() {
        return Ok(());
    }
    splice(value, blobs, 0)
}

fn blob_index(value: &Value) -> Option<Option<usize>> {
    let object = value.as_object()?;
    if object.len() != 1 {
        return None;
    }
    let index = object.get("$blob")?;
    Some(index.as_u64().map(|n| n as usize))
}

fn splice(value: &mut Value, blobs: &[Vec<u8>], depth: usize) -> Result<(), String> {
    if depth > 64 {
        return Ok(());
    }
    if let Some(index) = blob_index(value) {
        let blob = index
            .and_then(|n| blobs.get(n))
            .ok_or_else(|| "message names a payload it did not carry".to_string())?;
        *value = Value::String(base64::engine::general_purpose::STANDARD.encode(blob));
        return Ok(());
    }
    match value {
        Value::Object(map) => {
            for child in map.values_mut() {
                splice(child, blobs, depth + 1)?;
            }
        }
        Value::Array(items) => {
            // Plain number arrays hold no references; skip them cheaply.
            if items.first().is_some_and(Value::is_number) {
                return Ok(());
            }
            for child in items.iter_mut() {
                splice(child, blobs, depth + 1)?;
            }
        }
        _ => {}
    }
    Ok(())
}

/// Writes one response line, as a frame when outbound frames are on and the
/// line carries raw payloads or large base64 values.
pub(crate) fn write_line<W: Write>(out: &mut W, line: &str) -> io::Result<()> {
    if !FRAMES_OUT.load(Ordering::Acquire) {
        out.write_all(line.as_bytes())?;
        return out.write_all(b"\n");
    }
    let (raw_json, raw) = match take_raw_values(line) {
        Some((json, raw)) => (Some(json), raw),
        None => (None, Vec::new()),
    };
    let line = raw_json.as_deref().unwrap_or(line);
    let lifted = if line.len() >= OUTBOUND_LINE_MIN { lift_base64_values(line, raw.len()) } else { None };
    let (json, text) = match lifted {
        Some((json, text)) => (json, text),
        None if raw.is_empty() => {
            out.write_all(line.as_bytes())?;
            return out.write_all(b"\n");
        }
        None => (line.to_string(), Vec::new()),
    };
    let mut header = String::from("#B");
    for length in raw.iter().map(Vec::len).chain(text.iter().map(|blob| blob.len())) {
        header.push(' ');
        header.push_str(&length.to_string());
    }
    header.push('\n');
    out.write_all(header.as_bytes())?;
    for blob in &raw {
        out.write_all(blob)?;
    }
    for blob in &text {
        out.write_all(blob)?;
    }
    out.write_all(json.as_bytes())?;
    out.write_all(b"\n")
}

fn is_base64_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'+' || byte == b'/' || byte == b'='
}

/// Finds `..._b64":"<long base64>"` in a compact JSON line and moves each
/// such value out. The pattern cannot occur inside a JSON string, where the
/// quotes would be escaped. Payload numbers start at `first`. Returns None
/// when there is nothing to lift.
fn lift_base64_values(line: &str, first: usize) -> Option<(String, Vec<&[u8]>)> {
    const KEY_END: &str = "_b64\":\"";
    let bytes = line.as_bytes();
    let mut blobs: Vec<&[u8]> = Vec::new();
    let mut json = String::new();
    let mut copied = 0usize;
    let mut search = 0usize;
    while let Some(found) = line[search..].find(KEY_END) {
        let value_start = search + found + KEY_END.len();
        let Some(length) = bytes[value_start..].iter().position(|&b| b == b'"') else { break };
        let value_end = value_start + length;
        search = value_end + 1;
        let value = &bytes[value_start..value_end];
        if value.len() < OUTBOUND_VALUE_MIN || !value.iter().all(|&b| is_base64_byte(b)) {
            continue;
        }
        // Up to the key's closing quote and colon, then the reference.
        json.push_str(&line[copied..value_start - 1]);
        json.push_str(&format!("{{\"$blob\":{}}}", first + blobs.len()));
        copied = value_end + 1;
        blobs.push(value);
        if search >= line.len() {
            break;
        }
    }
    if blobs.is_empty() {
        return None;
    }
    json.push_str(&line[copied..]);
    Some((json, blobs))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::io::Cursor;

    /// Tests that switch outbound frames on take turns.
    static FRAMES_TEST: Mutex<()> = Mutex::new(());

    fn read_all(bytes: &[u8]) -> Vec<InboundMessage> {
        let mut cursor = Cursor::new(bytes.to_vec());
        let mut messages = Vec::new();
        loop {
            match read_message(&mut cursor, 1024 * 1024) {
                ReadOutcome::Message(message) => messages.push(message),
                ReadOutcome::Closed => return messages,
                ReadOutcome::Fatal(err) => panic!("{err}"),
            }
        }
    }

    #[test]
    fn plain_lines_read_as_before() {
        let messages = read_all(b"{\"id\":1}\n{\"id\":2}\n");
        assert_eq!(messages.len(), 2);
        assert!(messages.iter().all(|m| m.blobs.is_empty()));
        assert_eq!(messages[1].line, b"{\"id\":2}\n");
    }

    #[test]
    fn a_frame_carries_its_payloads_into_the_next_line() {
        let floats: Vec<u8> = [1.5f32, -2.0, 0.25].iter().flat_map(|f| f.to_le_bytes()).collect();
        let mut input = format!("#B {} 3\n", floats.len()).into_bytes();
        input.extend_from_slice(&floats);
        input.extend_from_slice(b"\n\n\x00");
        input.extend_from_slice(b"{\"id\":3,\"method\":\"m\",\"params\":{\"a\":{\"$blob\":0},\"b\":[{\"c\":{\"$blob\":1}}]}}\n{\"id\":4}\n");
        let messages = read_all(&input);
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].blobs, vec![floats.clone(), b"\n\n\x00".to_vec()]);
        assert_eq!(messages[0].byte_len() as usize, messages[0].line.len() + floats.len() + 3);
        let mut value: Value = serde_json::from_slice(&messages[0].line).unwrap();
        splice_blobs(&mut value, &messages[0].blobs).unwrap();
        let engine = base64::engine::general_purpose::STANDARD;
        assert_eq!(value["params"]["a"], json!(engine.encode(&floats)));
        assert_eq!(value["params"]["b"][0]["c"], json!(engine.encode(b"\n\n\x00")));
        assert!(messages[1].blobs.is_empty());
    }

    #[test]
    fn a_reference_without_a_payload_is_refused() {
        let mut value = json!({"a": {"$blob": 2}});
        assert!(splice_blobs(&mut value, &[vec![1]]).is_err());
        // Without a frame nothing is touched.
        let mut value = json!({"a": {"$blob": 0}});
        splice_blobs(&mut value, &[]).unwrap();
        assert_eq!(value, json!({"a": {"$blob": 0}}));
    }

    #[test]
    fn malformed_or_oversized_frames_are_fatal() {
        for input in [&b"#B x\n"[..], b"#B \n", b"#B 2000000\n"] {
            let mut cursor = Cursor::new(input.to_vec());
            assert!(matches!(read_message(&mut cursor, 1024 * 1024), ReadOutcome::Fatal(_)), "{input:?}");
        }
        let mut cursor = Cursor::new(b"#B 1\nx#B 1\n".to_vec());
        assert!(matches!(read_message(&mut cursor, 1024 * 1024), ReadOutcome::Fatal(_)));
    }

    #[test]
    fn large_base64_values_are_lifted_out_of_a_response() {
        let engine = base64::engine::general_purpose::STANDARD;
        let pixels: Vec<u8> = (0..70_000u32).map(|i| (i * 7) as u8).collect();
        let small = engine.encode([1u8, 2, 3]);
        let line = json!({"id": 9, "ok": true, "result": {
            "width": 4, "rgba_b64": engine.encode(&pixels), "thumb_b64": small, "note": "a _b64\":\" b",
        }})
        .to_string();
        let (json, blobs) = lift_base64_values(&line, 0).unwrap();
        assert_eq!(blobs.len(), 1);
        assert_eq!(blobs[0], engine.encode(&pixels).as_bytes());
        let parsed: Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["result"]["rgba_b64"], json!({"$blob": 0}));
        assert_eq!(parsed["result"]["thumb_b64"], json!(small));
        assert_eq!(parsed["result"]["note"], json!("a _b64\":\" b"));
        assert_eq!(parsed["result"]["width"], json!(4));
        assert!(lift_base64_values(&json!({"id": 1, "note": "x".repeat(70_000)}).to_string(), 0).is_none());
    }

    #[test]
    fn written_frames_read_back_as_the_same_message() {
        let engine = base64::engine::general_purpose::STANDARD;
        let pixels: Vec<u8> = (0..90_000u32).map(|i| (i * 13) as u8).collect();
        let line = json!({"id": 5, "ok": true, "result": {"jpeg_b64": engine.encode(&pixels)}}).to_string();
        let _turn = FRAMES_TEST.lock().unwrap_or_else(|e| e.into_inner());
        FRAMES_OUT.store(true, Ordering::Release);
        let mut out = Vec::new();
        write_line(&mut out, &line).unwrap();
        write_line(&mut out, "{\"id\":6}").unwrap();
        FRAMES_OUT.store(false, Ordering::Release);
        assert!(out.starts_with(FRAME_HEADER));
        let messages = read_all(&out);
        assert_eq!(messages.len(), 2);
        // The lifted value is base64 text; read back it is the same string.
        let mut value: Value = serde_json::from_slice(&messages[0].line).unwrap();
        let text = String::from_utf8(messages[0].blobs[0].clone()).unwrap();
        assert_eq!(text, engine.encode(&pixels));
        value["result"]["jpeg_b64"] = json!(text);
        assert_eq!(value.to_string(), line);
        assert_eq!(messages[1].line, b"{\"id\":6}\n");
    }

    #[test]
    fn parked_bytes_go_out_raw_beside_lifted_base64() {
        let engine = base64::engine::general_purpose::STANDARD;
        let pixels: Vec<u8> = (0..5_000u32).map(|i| (i * 31) as u8).collect();
        let big: Vec<u8> = (0..90_000u32).map(|i| (i * 3) as u8).collect();
        let line = json!({"id": 8, "ok": true, "result": {
            "rgba_raw": bytes_value(pixels.clone()), "jpeg_b64": engine.encode(&big), "width": 2,
        }})
        .to_string();
        let _turn = FRAMES_TEST.lock().unwrap_or_else(|e| e.into_inner());
        FRAMES_OUT.store(true, Ordering::Release);
        let mut out = Vec::new();
        write_line(&mut out, &line).unwrap();
        // Once written the payload is gone: a repeat finds nothing to send.
        let mut again = Vec::new();
        write_line(&mut again, &line).unwrap();
        FRAMES_OUT.store(false, Ordering::Release);
        let messages = read_all(&out);
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].blobs[0], pixels);
        assert_eq!(messages[0].blobs[1], engine.encode(&big).as_bytes());
        let value: Value = serde_json::from_slice(&messages[0].line).unwrap();
        assert_eq!(value["result"]["rgba_raw"], json!({"$bytes": 0}));
        assert_eq!(value["result"]["jpeg_b64"], json!({"$blob": 1}));
        assert_eq!(value["result"]["width"], json!(2));
        let value: Value = serde_json::from_slice(&read_all(&again)[0].line).unwrap();
        assert!(!value["result"]["rgba_raw"].is_object());
    }

    #[test]
    fn small_replies_with_parked_bytes_are_framed_too() {
        let line = json!({"id": 3, "ok": true, "result": {"rgba_raw": bytes_value(vec![1, 2, 3, 4]), "note": "$ga_bytes:1"}})
            .to_string();
        let _turn = FRAMES_TEST.lock().unwrap_or_else(|e| e.into_inner());
        FRAMES_OUT.store(true, Ordering::Release);
        let mut out = Vec::new();
        write_line(&mut out, &line).unwrap();
        FRAMES_OUT.store(false, Ordering::Release);
        let messages = read_all(&out);
        assert_eq!(messages[0].blobs, vec![vec![1u8, 2, 3, 4]]);
        let value: Value = serde_json::from_slice(&messages[0].line).unwrap();
        assert_eq!(value["result"]["rgba_raw"], json!({"$bytes": 0}));
        assert_eq!(value["result"]["note"], json!("$ga_bytes:1"));
    }
}
