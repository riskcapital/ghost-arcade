//! Live capture inside the core: cameras and screen or window captures that
//! the core opens itself and imports straight into a source's picture slot.
//!
//! Before this, the Electron main process ran the capture (a Node addon),
//! copied each frame into an IOSurface of its own, and the editor polled
//! main for it at 60 Hz and sent its id to the core in a command, so every
//! captured frame crossed main, the editor and the broker before the core
//! saw it. Here the capture session lives in this process
//! (`mac_live_capture.mm`), and each frame the core takes the newest
//! captured buffer of every bound source and imports its IOSurface.
//!
//! Electron still decides what to capture and asks for the system
//! permission; it starts and stops sessions by id over RPC
//! (`live_capture_start` / `_stop` / `_state` / `_list_cameras`). The
//! editor binds a layer source to a session once
//! (`bind_live_capture_source`), and the core keeps that source fed.
//!
//! Sessions are kept for the life of the process, apart from the
//! renderer: a renderer rebuilt after a device loss carries on importing.

use std::collections::HashMap;
#[cfg(target_os = "macos")]
use std::sync::Mutex;
use std::time::Instant;

use serde_json::{json, Value};

use crate::*;

/// Whether this build can capture in the core.
pub(crate) fn implemented() -> bool {
    cfg!(target_os = "macos")
}

#[cfg(target_os = "macos")]
mod ffi {
    use std::ffi::{c_char, c_void};

    #[repr(C)]
    pub(super) struct RawFrame {
        pub pixel_buffer: *mut c_void,
        pub iosurface: *mut c_void,
        pub width: u32,
        pub height: u32,
        pub pixel_format: u32,
        pub frame: u64,
        pub presentation_seconds: f64,
        pub arrived_seconds: f64,
    }

    impl Default for RawFrame {
        fn default() -> Self {
            Self {
                pixel_buffer: std::ptr::null_mut(),
                iosurface: std::ptr::null_mut(),
                width: 0,
                height: 0,
                pixel_format: 0,
                frame: 0,
                presentation_seconds: 0.0,
                arrived_seconds: 0.0,
            }
        }
    }

    #[repr(C)]
    #[derive(Default)]
    pub(super) struct RawState {
        pub frames: u64,
        pub width: u32,
        pub height: u32,
        pub running: u8,
        pub failed: u8,
    }

    unsafe extern "C" {
        pub(super) fn ghost_live_capture_start_camera(device_id: *const c_char, error: *mut c_char, capacity: usize) -> *mut c_void;
        pub(super) fn ghost_live_capture_start_screen(
            source_id: *const c_char,
            display_id: *const c_char,
            kind: *const c_char,
            error: *mut c_char,
            capacity: usize,
        ) -> *mut c_void;
        pub(super) fn ghost_live_capture_stop(capture: *mut c_void);
        pub(super) fn ghost_live_capture_latest(capture: *mut c_void, since_frame: u64, frame: *mut RawFrame) -> i32;
        pub(super) fn ghost_live_capture_state(capture: *mut c_void, state: *mut RawState);
        pub(super) fn ghost_live_capture_error(capture: *mut c_void, error: *mut c_char, capacity: usize);
        pub(super) fn ghost_live_capture_release_pixel_buffer(pixel_buffer: *mut c_void);
        pub(super) fn ghost_live_capture_list_cameras_json() -> *mut c_char;
        pub(super) fn ghost_live_capture_free_string(value: *mut c_char);
        pub(super) fn ghost_live_capture_camera_authorization() -> i32;
        pub(super) fn ghost_live_capture_screen_preflight() -> i32;
        pub(super) fn ghost_live_capture_host_seconds() -> f64;
    }
}

#[cfg(target_os = "macos")]
const ERROR_CAPACITY: usize = 512;

/// What a session captures, as Electron asked for it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum CaptureRequest {
    Camera { device_id: String },
    /// A display (`kind` "screen") or a window (`kind` "window"), named by
    /// the desktopCapturer source id the editor's picker shows.
    Screen { source_id: String, display_id: String, kind: String },
}

impl CaptureRequest {
    pub(crate) fn from_params(params: &Value) -> Result<Self, String> {
        let text = |key: &str| params.get(key).and_then(Value::as_str).unwrap_or("").trim().to_string();
        match text("kind").as_str() {
            "camera" | "webcam" => Ok(Self::Camera { device_id: text("device_id") }),
            kind @ ("screen" | "window") => {
                let source_id = text("source_id");
                if source_id.is_empty() && text("display_id").is_empty() {
                    return Err("live_capture_start needs a source_id or display_id".to_string());
                }
                Ok(Self::Screen { source_id, display_id: text("display_id"), kind: kind.to_string() })
            }
            other => Err(format!("live_capture_start: unknown kind `{other}` (camera, screen or window)")),
        }
    }

    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    fn kind(&self) -> &str {
        match self {
            Self::Camera { .. } => "camera",
            Self::Screen { kind, .. } => kind,
        }
    }
}

/// One captured frame, holding its CVPixelBuffer (and so its IOSurface)
/// until dropped. Drop it only once the GPU has finished reading it.
#[cfg(target_os = "macos")]
pub(crate) struct CaptureFrame {
    pixel_buffer: std::ptr::NonNull<std::ffi::c_void>,
    iosurface: std::ptr::NonNull<std::ffi::c_void>,
    pub width: u32,
    pub height: u32,
    pub pixel_format: u32,
    pub frame: u64,
    pub presentation_seconds: f64,
    pub arrived_seconds: f64,
}

// Core Video's retain/release is thread safe, and nothing writes the
// buffer once the capture has delivered it.
#[cfg(target_os = "macos")]
unsafe impl Send for CaptureFrame {}

#[cfg(target_os = "macos")]
impl CaptureFrame {
    pub(crate) fn iosurface(&self) -> &objc2_io_surface::IOSurfaceRef {
        // SAFETY: the pointer is the retained pixel buffer's IOSurface; it
        // lives at least as long as `self`.
        unsafe { self.iosurface.cast::<objc2_io_surface::IOSurfaceRef>().as_ref() }
    }
}

#[cfg(target_os = "macos")]
impl Drop for CaptureFrame {
    fn drop(&mut self) {
        unsafe { ffi::ghost_live_capture_release_pixel_buffer(self.pixel_buffer.as_ptr()) };
    }
}

#[cfg(target_os = "macos")]
struct RawCapture(std::ptr::NonNull<std::ffi::c_void>);

// The session object is used from the core's main thread only, apart from
// its own capture queue, which it synchronises itself.
#[cfg(target_os = "macos")]
unsafe impl Send for RawCapture {}

#[cfg(target_os = "macos")]
impl Drop for RawCapture {
    fn drop(&mut self) {
        unsafe { ffi::ghost_live_capture_stop(self.0.as_ptr()) };
    }
}

#[cfg(target_os = "macos")]
struct Session {
    raw: RawCapture,
    request: CaptureRequest,
    started: Instant,
}

#[cfg(target_os = "macos")]
static SESSIONS: Mutex<Option<HashMap<String, Session>>> = Mutex::new(None);

#[cfg(target_os = "macos")]
fn with_sessions<T>(f: impl FnOnce(&mut HashMap<String, Session>) -> T) -> T {
    let mut guard = SESSIONS.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    f(guard.get_or_insert_with(HashMap::new))
}

#[cfg(target_os = "macos")]
fn c_string(value: &str) -> std::ffi::CString {
    std::ffi::CString::new(value.replace('\0', "")).unwrap_or_default()
}

#[cfg(target_os = "macos")]
fn error_text(buffer: &[std::ffi::c_char]) -> String {
    unsafe { std::ffi::CStr::from_ptr(buffer.as_ptr()) }.to_string_lossy().into_owned()
}

/// Seconds on the host clock the capture timestamps use.
pub(crate) fn host_seconds() -> f64 {
    #[cfg(target_os = "macos")]
    {
        unsafe { ffi::ghost_live_capture_host_seconds() }
    }
    #[cfg(not(target_os = "macos"))]
    {
        0.0
    }
}

/// Start (or restart) a session under `session_id`.
pub(crate) fn start(session_id: &str, request: CaptureRequest) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let mut error = [0 as std::ffi::c_char; ERROR_CAPACITY];
        // An existing session of that id stops first (as the addon does).
        with_sessions(|sessions| sessions.remove(session_id));
        let raw = match &request {
            CaptureRequest::Camera { device_id } => {
                let device = c_string(device_id);
                unsafe { ffi::ghost_live_capture_start_camera(device.as_ptr(), error.as_mut_ptr(), ERROR_CAPACITY) }
            }
            CaptureRequest::Screen { source_id, display_id, kind } => {
                let (source, display, kind) = (c_string(source_id), c_string(display_id), c_string(kind));
                unsafe {
                    ffi::ghost_live_capture_start_screen(
                        source.as_ptr(),
                        display.as_ptr(),
                        kind.as_ptr(),
                        error.as_mut_ptr(),
                        ERROR_CAPACITY,
                    )
                }
            }
        };
        let raw = std::ptr::NonNull::new(raw).ok_or_else(|| {
            let text = error_text(&error);
            if text.is_empty() { "the capture did not start".to_string() } else { text }
        })?;
        with_sessions(|sessions| {
            sessions.insert(session_id.to_string(), Session { raw: RawCapture(raw), request, started: Instant::now() })
        });
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (session_id, request);
        Err("live capture in the render core is only available on macOS".to_string())
    }
}

/// Stop a session. False when there was none.
pub(crate) fn stop(session_id: &str) -> bool {
    #[cfg(target_os = "macos")]
    {
        with_sessions(|sessions| sessions.remove(session_id)).is_some()
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = session_id;
        false
    }
}

/// The session's newest frame, when it is newer than `since`.
#[cfg(target_os = "macos")]
pub(crate) fn latest(session_id: &str, since: u64) -> Option<CaptureFrame> {
    with_sessions(|sessions| {
        let session = sessions.get(session_id)?;
        let mut raw = ffi::RawFrame::default();
        if unsafe { ffi::ghost_live_capture_latest(session.raw.0.as_ptr(), since, &mut raw) } != 1 {
            return None;
        }
        let pixel_buffer = std::ptr::NonNull::new(raw.pixel_buffer)?;
        let Some(iosurface) = std::ptr::NonNull::new(raw.iosurface) else {
            unsafe { ffi::ghost_live_capture_release_pixel_buffer(pixel_buffer.as_ptr()) };
            return None;
        };
        Some(CaptureFrame {
            pixel_buffer,
            iosurface,
            width: raw.width,
            height: raw.height,
            pixel_format: raw.pixel_format,
            frame: raw.frame,
            presentation_seconds: raw.presentation_seconds,
            arrived_seconds: raw.arrived_seconds,
        })
    })
}

fn session_state(session_id: &str) -> Option<Value> {
    #[cfg(target_os = "macos")]
    {
        with_sessions(|sessions| {
            let session = sessions.get(session_id)?;
            let mut raw = ffi::RawState::default();
            let mut error = [0 as std::ffi::c_char; ERROR_CAPACITY];
            unsafe {
                ffi::ghost_live_capture_state(session.raw.0.as_ptr(), &mut raw);
                ffi::ghost_live_capture_error(session.raw.0.as_ptr(), error.as_mut_ptr(), ERROR_CAPACITY);
            }
            let error = error_text(&error);
            Some(json!({
                "session_id": session_id,
                "kind": session.request.kind(),
                "frames": raw.frames,
                "width": raw.width,
                "height": raw.height,
                "running": raw.running != 0,
                "failed": raw.failed != 0,
                "error": if error.is_empty() { Value::Null } else { Value::String(error) },
                "age_ms": session.started.elapsed().as_millis() as u64,
            }))
        })
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = session_id;
        None
    }
}

fn session_ids() -> Vec<String> {
    #[cfg(target_os = "macos")]
    {
        with_sessions(|sessions| sessions.keys().cloned().collect())
    }
    #[cfg(not(target_os = "macos"))]
    {
        Vec::new()
    }
}

fn list_cameras() -> Value {
    #[cfg(target_os = "macos")]
    {
        let raw = unsafe { ffi::ghost_live_capture_list_cameras_json() };
        if raw.is_null() {
            return json!([]);
        }
        let text = unsafe { std::ffi::CStr::from_ptr(raw) }.to_string_lossy().into_owned();
        unsafe { ffi::ghost_live_capture_free_string(raw) };
        serde_json::from_str(&text).unwrap_or_else(|_| json!([]))
    }
    #[cfg(not(target_os = "macos"))]
    {
        json!([])
    }
}

fn permissions() -> Value {
    #[cfg(target_os = "macos")]
    {
        let camera = match unsafe { ffi::ghost_live_capture_camera_authorization() } {
            0 => "not-determined",
            1 => "restricted",
            2 => "denied",
            3 => "granted",
            _ => "unknown",
        };
        let screen = unsafe { ffi::ghost_live_capture_screen_preflight() } == 1;
        json!({ "camera": camera, "screen": if screen { "granted" } else { "not-granted" } })
    }
    #[cfg(not(target_os = "macos"))]
    {
        json!({})
    }
}

/// Capture-to-core timing of one bound source, in milliseconds.
#[derive(Clone, Debug, Default)]
struct Latency {
    samples: u64,
    last_ms: f64,
    mean_ms: f64,
    max_ms: f64,
    /// From the frame callback (not the sample's presentation time).
    arrival_last_ms: f64,
    arrival_mean_ms: f64,
}

impl Latency {
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    fn add(&mut self, presented_ms: f64, arrived_ms: f64) {
        self.samples += 1;
        let n = self.samples as f64;
        self.last_ms = presented_ms;
        self.arrival_last_ms = arrived_ms;
        self.mean_ms += (presented_ms - self.mean_ms) / n;
        self.arrival_mean_ms += (arrived_ms - self.arrival_mean_ms) / n;
        self.max_ms = self.max_ms.max(presented_ms);
    }

    fn value(&self) -> Value {
        let round = |v: f64| (v * 1000.0).round() / 1000.0;
        json!({
            "samples": self.samples,
            "last_ms": round(self.last_ms),
            "mean_ms": round(self.mean_ms),
            "max_ms": round(self.max_ms),
            "arrival_last_ms": round(self.arrival_last_ms),
            "arrival_mean_ms": round(self.arrival_mean_ms),
        })
    }
}

#[derive(Clone, Debug)]
struct Binding {
    session_id: String,
    /// The editor's sequence number for the source when it bound it, so a
    /// later upload of the editor's own (after a fallback) still wins.
    seq: u64,
    last_frame: u64,
    imports: u64,
    /// Captured frames a newer one replaced before the core took them.
    superseded: u64,
    last_error: Option<String>,
    latency: Latency,
    bound_at: Instant,
}

/// Which layer sources are fed by which capture session.
#[derive(Debug, Default)]
pub(crate) struct LiveCaptureBindings {
    bindings: HashMap<String, Binding>,
}

impl LiveCaptureBindings {
    pub(crate) fn unbind(&mut self, source_id: &str) {
        self.bindings.remove(source_id);
    }

    pub(crate) fn is_empty(&self) -> bool {
        self.bindings.is_empty()
    }
}

impl App {
    pub(crate) fn live_capture_rpc(&mut self, method: &str, params: &Value) -> Result<Value, String> {
        let session_id = || {
            params
                .get("session_id")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|id| !id.is_empty())
                .map(str::to_string)
                .ok_or_else(|| format!("{method} needs a session_id"))
        };
        match method {
            "live_capture_list_cameras" => Ok(list_cameras()),
            "live_capture_start" => {
                if !implemented() {
                    return Err("live capture in the render core is only available on macOS".to_string());
                }
                let id = session_id()?;
                let request = CaptureRequest::from_params(params)?;
                start(&id, request)?;
                Ok(self.live_capture_state_value(Some(&id)))
            }
            "live_capture_stop" => {
                let id = session_id()?;
                let stopped = stop(&id);
                self.live_capture.bindings.retain(|_, binding| binding.session_id != id);
                Ok(json!({ "stopped": stopped, "session_id": id }))
            }
            "live_capture_state" => {
                let id = params.get("session_id").and_then(Value::as_str).filter(|id| !id.is_empty());
                Ok(self.live_capture_state_value(id))
            }
            _ => Err(format!("unknown live capture method {method}")),
        }
    }

    fn live_capture_state_value(&self, only: Option<&str>) -> Value {
        let ids = match only {
            Some(id) => vec![id.to_string()],
            None => session_ids(),
        };
        let mut sessions = serde_json::Map::new();
        for id in ids {
            let Some(mut state) = session_state(&id) else { continue };
            let bound = self
                .live_capture
                .bindings
                .iter()
                .filter(|(_, binding)| binding.session_id == id)
                .map(|(source_id, binding)| {
                    json!({
                        "source_id": source_id,
                        "imports": binding.imports,
                        "superseded": binding.superseded,
                        "last_frame": binding.last_frame,
                        "last_error": binding.last_error,
                        "latency": binding.latency.value(),
                        "bound_ms": binding.bound_at.elapsed().as_millis() as u64,
                    })
                })
                .collect::<Vec<_>>();
            state["sources"] = Value::Array(bound);
            sessions.insert(id, state);
        }
        json!({
            "implemented": implemented(),
            "permissions": permissions(),
            "sessions": sessions,
            "session": only.and_then(|id| sessions.get(id).cloned()).unwrap_or(Value::Null),
        })
    }

    /// `bind_live_capture_source`: feed a layer source from a session.
    pub(crate) fn apply_bind_live_capture_source(&mut self, command: &Value) {
        let text = |key: &str| command.get(key).and_then(Value::as_str).map(str::trim).unwrap_or("").to_string();
        let (source_id, session_id) = (text("source_id"), text("session_id"));
        if source_id.is_empty() {
            return;
        }
        if session_id.is_empty() {
            self.live_capture.unbind(&source_id);
            return;
        }
        let seq = command.get("seq").and_then(Value::as_f64).unwrap_or(0.0).max(0.0) as u64;
        let same = self.live_capture.bindings.get(&source_id).is_some_and(|b| b.session_id == session_id);
        if same {
            if let Some(binding) = self.live_capture.bindings.get_mut(&source_id) {
                binding.seq = binding.seq.max(seq);
            }
            return;
        }
        self.live_capture.bindings.insert(
            source_id,
            Binding {
                session_id,
                seq,
                last_frame: 0,
                imports: 0,
                superseded: 0,
                last_error: None,
                latency: Latency::default(),
                bound_at: Instant::now(),
            },
        );
        self.request_present();
    }

    /// Import the newest captured frame of every bound source a layer
    /// uses. Runs with the frame clock, before the frame is drawn.
    pub(crate) fn pump_live_captures(&mut self) {
        if self.live_capture.is_empty() || self.renderer.is_none() {
            return;
        }
        #[cfg(target_os = "macos")]
        {
            let sources = self.live_capture.bindings.keys().cloned().collect::<Vec<_>>();
            let mut imported_any = false;
            for source_id in sources {
                if !self.media_source_is_referenced(&source_id) {
                    continue;
                }
                let Some((session_id, since)) = self.live_capture.bindings.get(&source_id).map(|binding| {
                    // A source with no picture (a renderer rebuilt, a slot
                    // evicted) takes the newest frame again.
                    let since = if self.source_frames.contains_key(&source_id) { binding.last_frame } else { 0 };
                    (binding.session_id.clone(), since)
                }) else {
                    continue;
                };
                let Some(frame) = latest(&session_id, since) else { continue };
                imported_any |= self.import_live_capture_frame(&source_id, frame);
            }
            if imported_any {
                self.request_present();
            }
        }
    }

    #[cfg(target_os = "macos")]
    fn import_live_capture_frame(&mut self, source_id: &str, frame: CaptureFrame) -> bool {
        const BGRA: u32 = u32::from_be_bytes(*b"BGRA");
        let fail = |app: &mut App, error: String| {
            if let Some(binding) = app.live_capture.bindings.get_mut(source_id) {
                binding.last_error = Some(error.clone());
            }
            app.reject_shared_texture_source_frame(frame.width as usize, frame.height as usize, &error);
            false
        };
        if frame.pixel_format != BGRA {
            let error = format!("captured frame has pixel format 0x{:08x}, not BGRA", frame.pixel_format);
            return fail(self, error);
        }
        let slot = match self.assign_source_frame_slot(source_id) {
            Ok(slot) => slot,
            Err(error) => return fail(self, error),
        };
        let (width, height, frame_number) = (frame.width, frame.height, frame.frame);
        let (presented, arrived) = (frame.presentation_seconds, frame.arrived_seconds);
        let renderer = self.renderer.as_ref().expect("renderer checked before live capture import");
        let uploaded = match renderer.import_iosurface_into_slot(
            slot,
            frame.iosurface(),
            objc2_metal::MTLPixelFormat::BGRA8Unorm,
            wgpu::TextureFormat::Bgra8Unorm,
            width,
            height,
        ) {
            Ok(uploaded) => uploaded,
            Err(error) => {
                self.release_source_frame_slot(source_id);
                return fail(self, error);
            }
        };
        // The capture pool may reuse the buffer only once the GPU has read it.
        renderer.queue.on_submitted_work_done(move || drop(frame));
        let now = host_seconds();
        let seq = {
            let binding = self.live_capture.bindings.get_mut(source_id).expect("bound source");
            if binding.last_frame > 0 && frame_number > binding.last_frame + 1 {
                binding.superseded += frame_number - binding.last_frame - 1;
            }
            binding.last_frame = frame_number;
            binding.imports += 1;
            binding.last_error = None;
            binding.latency.add((now - presented) * 1000.0, (now - arrived) * 1000.0);
            binding.seq
        };
        self.stats.source_frame_uploads = self.stats.source_frame_uploads.saturating_add(1);
        self.stats.source_frame_bytes_uploaded = self.stats.source_frame_bytes_uploaded.saturating_add(uploaded);
        self.stats.source_frame_last_input_bytes = 0;
        self.stats.source_frame_last_upload_bytes = uploaded;
        self.stats.source_frame_last_upload_width = width;
        self.stats.source_frame_last_upload_height = height;
        self.stats.source_frame_last_upload_transport = "core-capture".to_string();
        self.stats.source_frame_last_reject_reason.clear();
        self.source_frame_signatures.remove(source_id);
        self.native_video_frame_signatures.remove(source_id);
        self.source_frames.insert(source_id.to_string(), SourceFrame::full(seq));
        for layer in self.scene_layers.values_mut() {
            if layer.source_id.as_deref() == Some(source_id) {
                layer.frame_slot = Some(slot);
            }
        }
        self.commit_pending_media_bindings_for_source(source_id, slot, [0.0, 0.0, 1.0, 1.0]);
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn requests_parse_like_the_addon_arguments() {
        assert_eq!(
            CaptureRequest::from_params(&json!({ "kind": "camera", "device_id": "abc" })).unwrap(),
            CaptureRequest::Camera { device_id: "abc".to_string() }
        );
        assert_eq!(
            CaptureRequest::from_params(&json!({ "kind": "webcam" })).unwrap(),
            CaptureRequest::Camera { device_id: String::new() }
        );
        assert_eq!(
            CaptureRequest::from_params(&json!({ "kind": "window", "source_id": "window:42:0" })).unwrap(),
            CaptureRequest::Screen { source_id: "window:42:0".to_string(), display_id: String::new(), kind: "window".to_string() }
        );
        assert!(CaptureRequest::from_params(&json!({ "kind": "screen" })).is_err());
        assert!(CaptureRequest::from_params(&json!({ "kind": "microphone" })).is_err());
    }

    #[test]
    fn latency_keeps_mean_and_max() {
        let mut latency = Latency::default();
        latency.add(10.0, 2.0);
        latency.add(20.0, 4.0);
        assert_eq!(latency.samples, 2);
        assert!((latency.mean_ms - 15.0).abs() < 1e-9);
        assert!((latency.arrival_mean_ms - 3.0).abs() < 1e-9);
        assert_eq!(latency.max_ms, 20.0);
    }

    #[test]
    fn stopping_an_unknown_session_is_harmless() {
        assert!(!stop("no-such-session"));
    }
}
