//! NDI senders from the render core: the program output, and every sender
//! Screen that asks for one, sent over NDI from the core's own textures.
//!
//! Before this, the Electron main process polled the core for the output
//! surface, read its pixels back on the main thread through the presenter
//! addon and handed them to the NDI addon, 60 times a second. Here each
//! sender copies its frame into one of a few readback buffers inside the
//! frame's own command buffer, maps the buffer once that submission is done
//! (the GPU completion thread's poll fires the callback), and hands the
//! mapped buffer to the sender's own thread, which passes it straight to
//! `NDIlib_send_send_video_async_v2`. The bytes are never copied on the CPU
//! by the core: NDI reads the mapped buffer, and the buffer is unmapped and
//! reused once NDI has moved on to the next frame.
//!
//! Frames are BGRA with the output's alpha, the same as the addon sent, at
//! the rate the app asks for (the core may render faster: frames in between
//! are not read back). A sender nobody receives is not read back at all.
//!
//! The NDI runtime is opened at run time (`dlopen` / `LoadLibrary`), never
//! linked: the app does not ship it, and a core on a machine without it
//! starts as usual and says why it cannot send. It is looked for where the
//! NDI installers put it, as the SDK documents.

use std::collections::HashMap;
use std::sync::Mutex;

use serde_json::{json, Value};

use crate::{App, RenderState, SliceOutputSpec};

#[cfg(any(target_os = "macos", target_os = "windows"))]
use imp::NdiSender;

/// Whether this build can send NDI from the core (the runtime may still be
/// missing at run time; `ndi_state` says).
pub(crate) fn implemented() -> bool {
    cfg!(any(target_os = "macos", target_os = "windows"))
}

#[derive(Clone, Debug, PartialEq)]
struct ProgramRequest {
    name: String,
    fps: f64,
}

/// The program sender asked for, kept apart from the renderer so a renderer
/// rebuilt after a device loss sends again without the app asking twice.
static WANTED: Mutex<Option<ProgramRequest>> = Mutex::new(None);
/// Screen senders switched on, at this frame rate.
static SLICES_WANTED: Mutex<Option<f64>> = Mutex::new(None);

fn wanted() -> Option<ProgramRequest> {
    WANTED.lock().map(|w| w.clone()).unwrap_or(None)
}

fn set_wanted(request: Option<ProgramRequest>) {
    if let Ok(mut wanted) = WANTED.lock() {
        *wanted = request;
    }
}

fn slices_wanted() -> Option<f64> {
    SLICES_WANTED.lock().map(|w| *w).unwrap_or(None)
}

fn set_slices_wanted(fps: Option<f64>) {
    if let Ok(mut wanted) = SLICES_WANTED.lock() {
        *wanted = fps;
    }
}

/// The frame rate a sender declares and paces to: what the app asked for,
/// within NDI's usual range, 60 when it said nothing usable.
fn sender_fps(value: Option<f64>) -> f64 {
    match value {
        Some(fps) if fps.is_finite() && fps >= 1.0 => fps.min(240.0),
        _ => 60.0,
    }
}

#[derive(Default)]
pub(crate) struct NdiOut {
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    program: Option<NdiSender>,
    last_error: Option<String>,
    /// One sender per Screen that sends over NDI, by Screen id.
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    slices: HashMap<String, NdiSender>,
    /// Screens whose sender could not open or send: (sender name, reason).
    /// Not retried until the Screen's sender changes or the app asks again.
    slice_errors: HashMap<String, (String, String)>,
}

impl RenderState {
    /// Inside the frame's encoder, after the output export has been written:
    /// read the program back for its NDI sender when one is due.
    pub(crate) fn capture_ndi_frame(&mut self, encoder: &mut wgpu::CommandEncoder) {
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        {
            let Some(request) = wanted() else {
                self.ndi_out.program = None;
                return;
            };
            let Some(export) = self.output_export.as_ref() else {
                return;
            };
            let out = &mut self.ndi_out;
            if out.program.as_ref().is_some_and(|p| p.name() != request.name) {
                out.program = None;
            }
            if out.program.is_none() {
                match NdiSender::new(&request.name, request.fps) {
                    Ok(sender) => {
                        out.program = Some(sender);
                        out.last_error = None;
                    }
                    Err(error) => {
                        eprintln!("[ghost-core] NDI sender \"{}\" unavailable: {error}", request.name);
                        out.last_error = Some(error);
                        set_wanted(None);
                        return;
                    }
                }
            }
            let sender = out.program.as_mut().expect("sender just ensured");
            sender.set_fps(request.fps);
            if let Err(error) =
                sender.capture(&self.device, encoder, &export.texture, export.width, export.height, export.format)
            {
                eprintln!("[ghost-core] NDI sender \"{}\" failed: {error}", request.name);
                out.last_error = Some(error);
                out.program = None;
                set_wanted(None);
            }
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        let _ = encoder;
    }

    /// Right after the submission that carried the program's capture.
    pub(crate) fn ndi_submitted(&mut self) {
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        if let Some(sender) = self.ndi_out.program.as_mut() {
            sender.submitted();
            if let Some(error) = sender.take_failure() {
                eprintln!("[ghost-core] NDI sender \"{}\" stopped: {error}", sender.name());
                self.ndi_out.last_error = Some(error);
                self.ndi_out.program = None;
                set_wanted(None);
            }
        }
    }

    /// Drop the senders of Screens that closed, were renamed or stopped
    /// sending. Nothing to do (and no cost) while no Screen sends over NDI.
    pub(crate) fn retain_slice_ndi(&mut self, specs: &[SliceOutputSpec]) {
        let out = &mut self.ndi_out;
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        let idle = out.slices.is_empty() && out.slice_errors.is_empty();
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        let idle = out.slice_errors.is_empty();
        if idle {
            return;
        }
        let on = slices_wanted().is_some();
        let keep = |id: &str, name: &str| {
            on && specs.iter().any(|spec| spec.id == id && spec.ndi_sender.as_deref() == Some(name))
        };
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        out.slices.retain(|id, sender| keep(id, sender.name()));
        out.slice_errors.retain(|id, (name, _)| keep(id, name));
    }

    /// Inside the encoder that drew a Screen, after its export was written:
    /// read the Screen back for its NDI sender when one is due.
    pub(crate) fn capture_slice_ndi(&mut self, encoder: &mut wgpu::CommandEncoder, spec: &SliceOutputSpec) {
        let Some(name) = spec.ndi_sender.as_deref() else {
            return;
        };
        let Some(fps) = slices_wanted() else {
            return;
        };
        if self.ndi_out.slice_errors.contains_key(&spec.id) {
            return;
        }
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        {
            let Some(target) = self.slice_targets.get(&spec.id) else {
                return;
            };
            let out = &mut self.ndi_out;
            if !out.slices.contains_key(&spec.id) {
                match NdiSender::new(name, fps) {
                    Ok(sender) => {
                        out.slices.insert(spec.id.clone(), sender);
                    }
                    Err(error) => {
                        eprintln!("[ghost-core] NDI sender for Screen \"{name}\" unavailable: {error}");
                        out.slice_errors.insert(spec.id.clone(), (name.to_string(), error));
                        return;
                    }
                }
            }
            let sender = out.slices.get_mut(&spec.id).expect("slice sender just ensured");
            sender.set_fps(fps);
            let export = &target.export;
            if let Err(error) =
                sender.capture(&self.device, encoder, &export.texture, export.width, export.height, export.format)
            {
                eprintln!("[ghost-core] NDI sender for Screen \"{name}\" failed: {error}");
                out.slices.remove(&spec.id);
                out.slice_errors.insert(spec.id.clone(), (name.to_string(), error));
            }
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        let _ = (encoder, name, fps);
    }

    /// Right after the frame's last submission, which carried the Screens.
    pub(crate) fn slice_ndi_submitted(&mut self) {
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        {
            let out = &mut self.ndi_out;
            if out.slices.is_empty() {
                return;
            }
            let mut failed = Vec::new();
            for (id, sender) in out.slices.iter_mut() {
                sender.submitted();
                if let Some(error) = sender.take_failure() {
                    failed.push((id.clone(), sender.name().to_string(), error));
                }
            }
            for (id, name, error) in failed {
                eprintln!("[ghost-core] NDI sender for Screen \"{name}\" stopped: {error}");
                out.slices.remove(&id);
                out.slice_errors.insert(id, (name, error));
            }
        }
    }

    pub(crate) fn ndi_state(&self) -> Value {
        let out = &self.ndi_out;
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        let (program, slices) = (
            out.program.as_ref().map(NdiSender::state),
            Value::Array(
                out.slices
                    .iter()
                    .map(|(id, sender)| {
                        let mut entry = sender.state();
                        entry["id"] = json!(id);
                        entry
                    })
                    .collect(),
            ),
        );
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        let (program, slices): (Option<Value>, Value) = (None, Value::Array(Vec::new()));
        state_value(program, slices, out.last_error.clone(), &out.slice_errors)
    }
}

fn state_value(
    program: Option<Value>,
    slices: Value,
    last_error: Option<String>,
    slice_errors: &HashMap<String, (String, String)>,
) -> Value {
    let mut state = json!({
        "implemented": implemented(),
        "active": program.is_some(),
        "wanted": wanted().map(|request| request.name),
        "last_error": last_error,
        "slices_enabled": slices_wanted().is_some(),
        "slices": slices,
        "slice_errors": slice_errors
            .iter()
            .map(|(id, (name, error))| json!({ "id": id, "name": name, "error": error }))
            .collect::<Vec<_>>(),
    });
    if let Some(Value::Object(program)) = program {
        if let Some(object) = state.as_object_mut() {
            object.extend(program);
        }
    }
    runtime_fields(&mut state, false);
    state
}

/// The runtime's state: whether it was found, from where, which version,
/// or why not. `load` opens it when nothing has tried yet.
fn runtime_fields(state: &mut Value, load: bool) {
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    {
        let runtime = if load { Some(imp::runtime()) } else { imp::runtime_if_loaded() };
        let Some(object) = state.as_object_mut() else {
            return;
        };
        match runtime {
            Some(Ok(lib)) => {
                object.insert("available".into(), json!(true));
                object.insert("runtime_path".into(), json!(lib.path));
                object.insert("runtime_version".into(), json!(lib.version));
            }
            Some(Err(error)) => {
                object.insert("available".into(), json!(false));
                object.insert("runtime_error".into(), json!(error));
            }
            None => {
                object.insert("available".into(), Value::Null);
            }
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = load;
        if let Some(object) = state.as_object_mut() {
            object.insert("available".into(), json!(false));
            object.insert("runtime_error".into(), json!("NDI from the render core is not available on this platform"));
        }
    }
}

fn text_param(params: &Value, key: &str) -> Option<String> {
    params
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

impl App {
    /// `ndi_send_start` / `_stop` for the program sender,
    /// `ndi_slices_start` / `_stop` for the Screens' senders, `ndi_state`.
    pub(crate) fn ndi_rpc(&mut self, method: &str, params: &Value) -> Result<Value, String> {
        match method {
            "ndi_send_start" => {
                let name = text_param(params, "name").ok_or_else(|| "ndi_send_start needs a name".to_string())?;
                Self::ndi_runtime_ready()?;
                let fps = sender_fps(params.get("fps").and_then(Value::as_f64));
                set_wanted(Some(ProgramRequest { name, fps }));
                if let Some(renderer) = self.renderer.as_mut() {
                    renderer.ndi_out.last_error = None;
                }
                // The sender opens with the next rendered frame.
                self.request_auto_present();
                Ok(self.ndi_state_value())
            }
            "ndi_send_stop" => {
                set_wanted(None);
                #[cfg(any(target_os = "macos", target_os = "windows"))]
                if let Some(renderer) = self.renderer.as_mut() {
                    renderer.ndi_out.program = None;
                }
                Ok(self.ndi_state_value())
            }
            "ndi_slices_start" => {
                Self::ndi_runtime_ready()?;
                set_slices_wanted(Some(sender_fps(params.get("fps").and_then(Value::as_f64))));
                // Asked again (a fallback retried, or an app restart): try
                // the Screens that failed before once more.
                if let Some(renderer) = self.renderer.as_mut() {
                    renderer.ndi_out.slice_errors.clear();
                }
                self.request_auto_present();
                Ok(self.ndi_state_value())
            }
            "ndi_slices_stop" => {
                set_slices_wanted(None);
                if let Some(renderer) = self.renderer.as_mut() {
                    #[cfg(any(target_os = "macos", target_os = "windows"))]
                    renderer.ndi_out.slices.clear();
                    renderer.ndi_out.slice_errors.clear();
                }
                Ok(self.ndi_state_value())
            }
            _ => {
                let mut state = self.ndi_state_value();
                // `probe: true` opens the runtime to say whether NDI can work
                // here before anything is sent.
                if params.get("probe").and_then(Value::as_bool) == Some(true) {
                    runtime_fields(&mut state, true);
                }
                Ok(state)
            }
        }
    }

    fn ndi_runtime_ready() -> Result<(), String> {
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        {
            imp::runtime().map(|_| ())
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            Err("NDI from the render core is not available on this platform".to_string())
        }
    }

    fn ndi_state_value(&self) -> Value {
        match self.renderer.as_ref() {
            Some(renderer) => renderer.ndi_state(),
            None => state_value(None, Value::Array(Vec::new()), None, &HashMap::new()),
        }
    }
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
mod imp {
    use std::ffi::{c_char, c_int, c_void, CStr, CString};
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicBool, AtomicI32, AtomicU64, Ordering};
    use std::sync::mpsc;
    use std::sync::{Arc, Mutex, OnceLock};
    use std::thread::JoinHandle;
    use std::time::{Duration, Instant};

    use serde_json::{json, Value};

    /// Readback buffers per sender: one NDI is still reading, one handed to
    /// it, one the GPU fills.
    const SLOTS: usize = 3;
    /// How often a sender asks NDI how many receivers it has.
    const CONNECTIONS_EVERY: Duration = Duration::from_millis(250);

    // The few NDI entry points the senders use, with the SDK's C layouts
    // (Processing.NDI.Send.h / Processing.NDI.structs.h).
    #[repr(C)]
    struct SendCreate {
        p_ndi_name: *const c_char,
        p_groups: *const c_char,
        clock_video: bool,
        clock_audio: bool,
    }

    #[repr(C)]
    struct VideoFrameV2 {
        xres: c_int,
        yres: c_int,
        four_cc: u32,
        frame_rate_n: c_int,
        frame_rate_d: c_int,
        picture_aspect_ratio: f32,
        frame_format_type: c_int,
        timecode: i64,
        p_data: *mut u8,
        line_stride_in_bytes: c_int,
        p_metadata: *const c_char,
        timestamp: i64,
    }

    const fn four_cc(code: &[u8; 4]) -> u32 {
        (code[0] as u32) | ((code[1] as u32) << 8) | ((code[2] as u32) << 16) | ((code[3] as u32) << 24)
    }
    const FOURCC_BGRA: u32 = four_cc(b"BGRA");
    const FOURCC_RGBA: u32 = four_cc(b"RGBA");
    const FRAME_FORMAT_PROGRESSIVE: c_int = 1;
    /// `NDIlib_send_timecode_synthesize`: NDI makes the timecode.
    const TIMECODE_SYNTHESIZE: i64 = i64::MAX;

    type InitializeFn = unsafe extern "C" fn() -> bool;
    type VersionFn = unsafe extern "C" fn() -> *const c_char;
    type SendCreateFn = unsafe extern "C" fn(*const SendCreate) -> *mut c_void;
    type SendDestroyFn = unsafe extern "C" fn(*mut c_void);
    type SendVideoAsyncFn = unsafe extern "C" fn(*mut c_void, *const VideoFrameV2);
    type ConnectionsFn = unsafe extern "C" fn(*mut c_void, u32) -> c_int;

    pub(super) struct NdiLib {
        pub(super) path: String,
        pub(super) version: Option<String>,
        send_create: SendCreateFn,
        send_destroy: SendDestroyFn,
        send_video_async: SendVideoAsyncFn,
        connections: ConnectionsFn,
    }

    static RUNTIME: OnceLock<Result<NdiLib, String>> = OnceLock::new();

    /// The NDI runtime, opened (and initialised) on first use. The library
    /// stays loaded for the life of the process.
    pub(super) fn runtime() -> Result<&'static NdiLib, String> {
        RUNTIME.get_or_init(load).as_ref().map_err(Clone::clone)
    }

    pub(super) fn runtime_if_loaded() -> Option<Result<&'static NdiLib, String>> {
        RUNTIME.get().map(|runtime| runtime.as_ref().map_err(Clone::clone))
    }

    #[cfg(target_os = "macos")]
    const LIBRARY_NAME: &str = "libndi.dylib";
    #[cfg(target_os = "windows")]
    const LIBRARY_NAME: &str = "Processing.NDI.Lib.x64.dll";

    /// Where NDI installers put the runtime, in the order tried.
    /// `GA_NDI_RUNTIME` (a library path) replaces the list, for tests.
    fn candidates() -> Vec<PathBuf> {
        if let Some(path) = std::env::var_os("GA_NDI_RUNTIME").filter(|path| !path.is_empty()) {
            return vec![PathBuf::from(path)];
        }
        let mut paths = Vec::new();
        // The installers publish the runtime folder by major version.
        for key in ["NDI_RUNTIME_DIR_V6", "NDI_RUNTIME_DIR_V5"] {
            if let Some(dir) = std::env::var_os(key).filter(|dir| !dir.is_empty()) {
                paths.push(PathBuf::from(dir).join(LIBRARY_NAME));
            }
        }
        #[cfg(target_os = "macos")]
        {
            // The NDI runtime installer (and NDI Tools), then the SDKs.
            paths.push(PathBuf::from("/usr/local/lib").join(LIBRARY_NAME));
            paths.push(PathBuf::from("/Library/NDI SDK for Apple/lib/macOS").join(LIBRARY_NAME));
            paths.push(PathBuf::from("/Library/NDI Advanced SDK for Apple/lib/macOS").join(LIBRARY_NAME));
        }
        paths
    }

    fn load() -> Result<NdiLib, String> {
        let mut tried = Vec::new();
        for path in candidates() {
            if !path.is_file() {
                tried.push(path.display().to_string());
                continue;
            }
            match open(&path) {
                Ok(lib) => return Ok(lib),
                Err(error) => {
                    eprintln!("[ghost-core] NDI runtime at {} unusable: {error}", path.display());
                    tried.push(format!("{} ({error})", path.display()));
                }
            }
        }
        Err(format!(
            "NDI runtime not found. Install NDI Tools or the NDI runtime from ndi.video and restart. Looked in: {}",
            tried.join(", ")
        ))
    }

    fn open(path: &std::path::Path) -> Result<NdiLib, String> {
        let handle = dl::open(path)?;
        let symbol = |name: &str| dl::symbol(handle, name).ok_or_else(|| format!("{name} missing"));
        // SAFETY: the symbols are the NDI SDK's exported C functions with
        // the signatures above.
        unsafe {
            let initialize: InitializeFn = std::mem::transmute(symbol("NDIlib_initialize")?);
            let lib = NdiLib {
                path: path.display().to_string(),
                version: dl::symbol(handle, "NDIlib_version").and_then(|version| {
                    let version: VersionFn = std::mem::transmute(version);
                    let text = version();
                    (!text.is_null()).then(|| CStr::from_ptr(text).to_string_lossy().into_owned())
                }),
                send_create: std::mem::transmute(symbol("NDIlib_send_create")?),
                send_destroy: std::mem::transmute(symbol("NDIlib_send_destroy")?),
                send_video_async: std::mem::transmute(symbol("NDIlib_send_send_video_async_v2")?),
                connections: std::mem::transmute(symbol("NDIlib_send_get_no_connections")?),
            };
            if !initialize() {
                return Err("NDI cannot run on this CPU".to_string());
            }
            Ok(lib)
        }
    }

    #[cfg(target_os = "macos")]
    mod dl {
        use std::ffi::{c_char, c_int, c_void, CStr, CString};
        use std::os::unix::ffi::OsStrExt;

        const RTLD_LAZY: c_int = 0x1;
        const RTLD_LOCAL: c_int = 0x4;

        unsafe extern "C" {
            fn dlopen(path: *const c_char, mode: c_int) -> *mut c_void;
            fn dlsym(handle: *mut c_void, name: *const c_char) -> *mut c_void;
            fn dlerror() -> *const c_char;
        }

        #[derive(Clone, Copy)]
        pub(super) struct Handle(*mut c_void);

        pub(super) fn open(path: &std::path::Path) -> Result<Handle, String> {
            let path = CString::new(path.as_os_str().as_bytes()).map_err(|_| "bad path".to_string())?;
            // SAFETY: plain dlopen of a library path.
            let handle = unsafe { dlopen(path.as_ptr(), RTLD_LAZY | RTLD_LOCAL) };
            if handle.is_null() {
                // SAFETY: dlerror's text is valid until the next dl call.
                let error = unsafe { dlerror() };
                return Err(if error.is_null() {
                    "dlopen failed".to_string()
                } else {
                    unsafe { CStr::from_ptr(error) }.to_string_lossy().into_owned()
                });
            }
            Ok(Handle(handle))
        }

        pub(super) fn symbol(handle: Handle, name: &str) -> Option<*mut c_void> {
            let name = CString::new(name).ok()?;
            // SAFETY: dlsym on a live handle.
            let symbol = unsafe { dlsym(handle.0, name.as_ptr()) };
            (!symbol.is_null()).then_some(symbol)
        }
    }

    #[cfg(target_os = "windows")]
    mod dl {
        use std::ffi::{c_void, CString};
        use std::os::windows::ffi::OsStrExt;
        use windows::core::{PCSTR, PCWSTR};
        use windows::Win32::Foundation::HMODULE;
        use windows::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryW};

        #[derive(Clone, Copy)]
        pub(super) struct Handle(HMODULE);

        pub(super) fn open(path: &std::path::Path) -> Result<Handle, String> {
            let wide: Vec<u16> = path.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
            // SAFETY: LoadLibraryW of a NUL-terminated path.
            unsafe { LoadLibraryW(PCWSTR(wide.as_ptr())) }.map(Handle).map_err(|error| error.to_string())
        }

        pub(super) fn symbol(handle: Handle, name: &str) -> Option<*mut c_void> {
            let name = CString::new(name).ok()?;
            // SAFETY: GetProcAddress on a live module.
            unsafe { GetProcAddress(handle.0, PCSTR(name.as_ptr() as *const u8)) }.map(|f| f as *mut c_void)
        }
    }

    /// The bytes of one frame, shared between the render thread (which
    /// copies into it), the map callback and the sender thread (which hands
    /// it to NDI and gives it back).
    struct Slot {
        buffer: wgpu::Buffer,
        busy: AtomicBool,
        width: u32,
        height: u32,
        stride: u32,
        four_cc: u32,
    }

    impl Slot {
        fn release(&self) {
            self.buffer.unmap();
            self.busy.store(false, Ordering::Release);
        }
    }

    enum Msg {
        Frame(Arc<Slot>),
        Rate(f64),
        Stop,
    }

    struct Shared {
        sent: AtomicU64,
        /// Frames the sender thread passed over to send a newer one.
        dropped: AtomicU64,
        connections: AtomicI32,
        failure: Mutex<Option<String>>,
    }

    struct Instance(*mut c_void);
    // SAFETY: an NDI send instance may be used from any one thread at a
    // time; only the sender thread uses it after creation.
    unsafe impl Send for Instance {}

    pub(crate) struct NdiSender {
        name: String,
        fps: f64,
        slots: Vec<Arc<Slot>>,
        width: u32,
        height: u32,
        format: Option<wgpu::TextureFormat>,
        unsubmitted: Vec<Arc<Slot>>,
        tx: mpsc::Sender<Msg>,
        thread: Option<JoinHandle<()>>,
        shared: Arc<Shared>,
        next_due: Option<Instant>,
        captured: u64,
        /// Frames due but not read back because every buffer was in use.
        skipped: u64,
        window_started: Instant,
        window_sent: u64,
        rate: f64,
    }

    impl NdiSender {
        pub(crate) fn new(name: &str, fps: f64) -> Result<Self, String> {
            let lib = runtime()?;
            let c_name = CString::new(name).map_err(|_| "sender name contains a NUL".to_string())?;
            let create = SendCreate {
                p_ndi_name: c_name.as_ptr(),
                p_groups: std::ptr::null(),
                // The core paces the frames; NDI must not block its thread.
                clock_video: false,
                clock_audio: false,
            };
            // SAFETY: valid create settings; the name is copied by NDI.
            let instance = unsafe { (lib.send_create)(&create) };
            if instance.is_null() {
                return Err("NDIlib_send_create failed".to_string());
            }
            let shared = Arc::new(Shared {
                sent: AtomicU64::new(0),
                dropped: AtomicU64::new(0),
                connections: AtomicI32::new(0),
                failure: Mutex::new(None),
            });
            let (tx, rx) = mpsc::channel();
            let thread_shared = Arc::clone(&shared);
            let instance = Instance(instance);
            let thread = std::thread::Builder::new()
                .name(format!("ghost-ndi-{name}"))
                .spawn(move || run_sender(lib, instance, rx, thread_shared, fps))
                .map_err(|error| error.to_string())?;
            Ok(Self {
                name: name.to_string(),
                fps,
                slots: Vec::new(),
                width: 0,
                height: 0,
                format: None,
                unsubmitted: Vec::new(),
                tx,
                thread: Some(thread),
                shared,
                next_due: None,
                captured: 0,
                skipped: 0,
                window_started: Instant::now(),
                window_sent: 0,
                rate: 0.0,
            })
        }

        pub(crate) fn name(&self) -> &str {
            &self.name
        }

        pub(crate) fn set_fps(&mut self, fps: f64) {
            if (fps - self.fps).abs() > f64::EPSILON {
                self.fps = fps;
                self.next_due = None;
                let _ = self.tx.send(Msg::Rate(fps));
            }
        }

        /// Whether this frame is one to send: frames arrive at the core's
        /// render rate, the sender sends at its own. A little early counts,
        /// so display jitter does not halve the rate.
        fn due(&mut self, now: Instant) -> bool {
            let interval = Duration::from_secs_f64(1.0 / self.fps);
            match self.next_due {
                Some(due) if now + interval / 4 < due => false,
                Some(due) => {
                    let next = due + interval;
                    // Fell behind (a stall): start again from now.
                    self.next_due = Some(if next + interval < now { now + interval } else { next });
                    true
                }
                None => {
                    self.next_due = Some(now + interval);
                    true
                }
            }
        }

        /// Inside `encoder`, after `source` has been written: copy it into a
        /// free readback buffer if a frame is due and someone receives.
        pub(crate) fn capture(
            &mut self,
            device: &wgpu::Device,
            encoder: &mut wgpu::CommandEncoder,
            source: &wgpu::Texture,
            width: u32,
            height: u32,
            format: wgpu::TextureFormat,
        ) -> Result<(), String> {
            if self.shared.connections.load(Ordering::Relaxed) <= 0 {
                self.next_due = None;
                return Ok(());
            }
            if !self.due(Instant::now()) {
                return Ok(());
            }
            if self.width != width || self.height != height || self.format != Some(format) {
                let four_cc = match format {
                    wgpu::TextureFormat::Bgra8Unorm | wgpu::TextureFormat::Bgra8UnormSrgb => FOURCC_BGRA,
                    wgpu::TextureFormat::Rgba8Unorm | wgpu::TextureFormat::Rgba8UnormSrgb => FOURCC_RGBA,
                    other => return Err(format!("NDI cannot send {other:?} frames")),
                };
                let stride = (width * 4).div_ceil(wgpu::COPY_BYTES_PER_ROW_ALIGNMENT) * wgpu::COPY_BYTES_PER_ROW_ALIGNMENT;
                // Buffers still in use by NDI or the GPU are let go here and
                // freed once their owner is done with them.
                self.unsubmitted.clear();
                self.slots = (0..SLOTS)
                    .map(|_| {
                        Arc::new(Slot {
                            buffer: device.create_buffer(&wgpu::BufferDescriptor {
                                label: Some("Ghost Render Core NDI Readback"),
                                size: stride as u64 * height as u64,
                                usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
                                mapped_at_creation: false,
                            }),
                            busy: AtomicBool::new(false),
                            width,
                            height,
                            stride,
                            four_cc,
                        })
                    })
                    .collect();
                self.width = width;
                self.height = height;
                self.format = Some(format);
            }
            let Some(slot) = self.slots.iter().find(|slot| !slot.busy.load(Ordering::Acquire)) else {
                self.skipped += 1;
                return Ok(());
            };
            slot.busy.store(true, Ordering::Release);
            encoder.copy_texture_to_buffer(
                source.as_image_copy(),
                wgpu::TexelCopyBufferInfo {
                    buffer: &slot.buffer,
                    layout: wgpu::TexelCopyBufferLayout {
                        offset: 0,
                        bytes_per_row: Some(slot.stride),
                        rows_per_image: Some(height),
                    },
                },
                wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
            );
            self.captured += 1;
            self.unsubmitted.push(Arc::clone(slot));
            Ok(())
        }

        /// Right after the submission that carried this frame's copy: map the
        /// buffer; the GPU completion thread's poll hands it to the sender.
        pub(crate) fn submitted(&mut self) {
            for slot in self.unsubmitted.drain(..) {
                let tx = self.tx.clone();
                let mapped = Arc::clone(&slot);
                slot.buffer.map_async(wgpu::MapMode::Read, .., move |result| match result {
                    Ok(()) => {
                        if let Err(mpsc::SendError(Msg::Frame(slot))) = tx.send(Msg::Frame(mapped)) {
                            slot.release();
                        }
                    }
                    Err(_) => mapped.busy.store(false, Ordering::Release),
                });
            }
            let sent = self.shared.sent.load(Ordering::Relaxed);
            let elapsed = self.window_started.elapsed().as_secs_f64();
            if elapsed >= 1.0 {
                self.rate = (sent - self.window_sent) as f64 / elapsed;
                self.window_sent = sent;
                self.window_started = Instant::now();
            }
        }

        pub(crate) fn take_failure(&mut self) -> Option<String> {
            self.shared.failure.lock().ok().and_then(|mut failure| failure.take())
        }

        pub(crate) fn state(&self) -> Value {
            json!({
                "name": self.name,
                "width": self.width,
                "height": self.height,
                "fps_target": self.fps,
                "fps": (self.rate * 10.0).round() / 10.0,
                "frames_captured": self.captured,
                "frames_sent": self.shared.sent.load(Ordering::Relaxed),
                "frames_skipped": self.skipped + self.shared.dropped.load(Ordering::Relaxed),
                "connections": self.shared.connections.load(Ordering::Relaxed),
            })
        }
    }

    impl Drop for NdiSender {
        fn drop(&mut self) {
            let _ = self.tx.send(Msg::Stop);
            // Waits for NDI to finish with the last frame and the sender to
            // close, so the same name can be opened again straight away.
            if let Some(thread) = self.thread.take() {
                let _ = thread.join();
            }
        }
    }

    /// NDI's frame rate as a ratio: whole rates over 1000, the NTSC rates
    /// (59.94, 29.97, …) over 1001.
    fn frame_rate(fps: f64) -> (c_int, c_int) {
        let ntsc = fps * 1001.0 / 1000.0;
        if (ntsc - ntsc.round()).abs() < 0.01 && (fps - fps.round()).abs() > 0.01 {
            ((ntsc.round() * 1000.0) as c_int, 1001)
        } else {
            ((fps * 1000.0).round() as c_int, 1000)
        }
    }

    fn run_sender(lib: &'static NdiLib, instance: Instance, rx: mpsc::Receiver<Msg>, shared: Arc<Shared>, fps: f64) {
        let instance = instance;
        let mut rate = frame_rate(fps);
        // The frame NDI may still be reading, with its mapped view.
        let mut held: Option<(Arc<Slot>, wgpu::BufferView)> = None;
        let mut last_connections = Instant::now() - CONNECTIONS_EVERY;
        loop {
            if last_connections.elapsed() >= CONNECTIONS_EVERY {
                // SAFETY: live instance, no wait.
                let connections = unsafe { (lib.connections)(instance.0, 0) };
                shared.connections.store(connections, Ordering::Relaxed);
                last_connections = Instant::now();
            }
            let message = match rx.recv_timeout(CONNECTIONS_EVERY) {
                Ok(message) => message,
                Err(mpsc::RecvTimeoutError::Timeout) => continue,
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            };
            let mut slot = match message {
                Msg::Frame(slot) => slot,
                Msg::Rate(fps) => {
                    rate = frame_rate(fps);
                    continue;
                }
                Msg::Stop => break,
            };
            // Behind: send only the newest frame that is ready.
            let mut stop = false;
            while let Ok(next) = rx.try_recv() {
                match next {
                    Msg::Frame(newer) => {
                        slot.release();
                        shared.dropped.fetch_add(1, Ordering::Relaxed);
                        slot = newer;
                    }
                    Msg::Rate(fps) => rate = frame_rate(fps),
                    Msg::Stop => {
                        stop = true;
                        break;
                    }
                }
            }
            if stop {
                slot.release();
                break;
            }
            let view = match slot.buffer.slice(..).get_mapped_range() {
                Ok(view) => view,
                Err(error) => {
                    slot.busy.store(false, Ordering::Release);
                    if let Ok(mut failure) = shared.failure.lock() {
                        *failure = Some(format!("readback buffer could not be read: {error}"));
                    }
                    continue;
                }
            };
            let frame = VideoFrameV2 {
                xres: slot.width as c_int,
                yres: slot.height as c_int,
                four_cc: slot.four_cc,
                frame_rate_n: rate.0,
                frame_rate_d: rate.1,
                picture_aspect_ratio: slot.width as f32 / slot.height.max(1) as f32,
                frame_format_type: FRAME_FORMAT_PROGRESSIVE,
                timecode: TIMECODE_SYNTHESIZE,
                p_data: view.as_ptr() as *mut u8,
                line_stride_in_bytes: slot.stride as c_int,
                p_metadata: std::ptr::null(),
                timestamp: 0,
            };
            // SAFETY: the view stays mapped until NDI is done with it, which
            // is when the next send returns (held below).
            unsafe { (lib.send_video_async)(instance.0, &frame) };
            // NDI has finished with the previous frame.
            if let Some((previous, previous_view)) = held.take() {
                drop(previous_view);
                previous.release();
            }
            held = Some((slot, view));
            shared.sent.fetch_add(1, Ordering::Relaxed);
        }
        // A null frame waits until NDI has finished with the last one.
        // SAFETY: live instance.
        unsafe { (lib.send_video_async)(instance.0, std::ptr::null()) };
        if let Some((slot, view)) = held.take() {
            drop(view);
            slot.release();
        }
        // Frames mapped after the stop are let go too.
        while let Ok(message) = rx.try_recv() {
            if let Msg::Frame(slot) = message {
                slot.release();
            }
        }
        // SAFETY: nothing uses the instance after this.
        unsafe { (lib.send_destroy)(instance.0) };
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn frame_rates_are_ndi_ratios() {
            assert_eq!(frame_rate(60.0), (60000, 1000));
            assert_eq!(frame_rate(30.0), (30000, 1000));
            assert_eq!(frame_rate(59.94), (60000, 1001));
            assert_eq!(frame_rate(29.97), (30000, 1001));
            assert_eq!(frame_rate(50.0), (50000, 1000));
        }

        #[test]
        fn four_cc_matches_the_sdk() {
            // 'B','G','R','A' little-endian, as NDI_LIB_FOURCC builds it.
            assert_eq!(FOURCC_BGRA, 0x4152_4742);
        }

        #[test]
        fn a_missing_runtime_is_an_error_not_a_crash() {
            // SAFETY: only this test reads the variable, before any load.
            unsafe { std::env::set_var("GA_NDI_RUNTIME", "/nonexistent/libndi-for-test") };
            let paths = candidates();
            unsafe { std::env::remove_var("GA_NDI_RUNTIME") };
            assert_eq!(paths, vec![PathBuf::from("/nonexistent/libndi-for-test")]);
        }
    }
}
