//! Texture sharing straight from the core: the program composite published
//! as a Syphon server (macOS) or a Spout sender (Windows) from the core's own
//! output texture.
//!
//! Before this, the Electron main process polled the core for the output
//! surface id over the RPC pipe at 60 Hz and handed it to a Node addon that
//! published it. Here the core copies each finished frame into one of a few
//! publish surfaces inside the frame's own command buffer, and publishes a
//! surface once the GPU has completed that submission, so a client never
//! reads a frame the GPU is still writing and the next frame never
//! overwrites one being read. On Windows the frame goes into the Spout
//! texture on a same-adapter D3D11 device, ordered after the frame (and the
//! next frame after the copy) with shared GPU fences (`win_spout.rs`).
//!
//! The wanted sender (its name) is kept for the life of the process, apart
//! from the renderer: a renderer rebuilt after a device loss starts
//! publishing again on its first frame without the app asking twice.
//!
//! Screens (slice outputs) can send too: once the app switches Screen
//! senders on (`texture_share_slices_start`), every Screen whose spec
//! carries a sender name gets its own Syphon server / Spout sender, fed from
//! the Screen's own target after its crop, warp and grade. A Screen without
//! a sender name costs nothing here.

use std::collections::HashMap;
use std::sync::Mutex;

use serde_json::{json, Value};

#[cfg(target_os = "macos")]
use std::collections::VecDeque;
#[cfg(target_os = "macos")]
use std::sync::atomic::{AtomicBool, Ordering};
#[cfg(target_os = "macos")]
use std::sync::Arc;
#[cfg(target_os = "macos")]
use std::time::Instant;

use crate::{App, RenderState, SliceOutputSpec};

#[cfg(target_os = "macos")]
use crate::mac_syphon;
#[cfg(target_os = "windows")]
use crate::win_spout;

/// Publish surfaces per sender: one the GPU fills while one is read.
#[cfg(target_os = "macos")]
const SLOTS: usize = 3;

#[derive(Clone, Debug, PartialEq)]
struct ShareRequest {
    name: String,
    /// The app's name, which clients show beside the sender name.
    app_name: Option<String>,
    /// Windows: the app's executable path, which Spout keeps as the
    /// sender's host.
    host_path: Option<String>,
}

static WANTED: Mutex<Option<ShareRequest>> = Mutex::new(None);

fn wanted() -> Option<ShareRequest> {
    WANTED.lock().map(|w| w.clone()).unwrap_or(None)
}

fn set_wanted(request: Option<ShareRequest>) {
    if let Ok(mut wanted) = WANTED.lock() {
        *wanted = request;
    }
}

/// Screen senders switched on, and what each sender says about its app.
#[derive(Clone, Debug, PartialEq)]
struct SliceShareRequest {
    app_name: Option<String>,
    host_path: Option<String>,
}

static SLICES_WANTED: Mutex<Option<SliceShareRequest>> = Mutex::new(None);

fn slices_wanted() -> Option<SliceShareRequest> {
    SLICES_WANTED.lock().map(|w| w.clone()).unwrap_or(None)
}

fn set_slices_wanted(request: Option<SliceShareRequest>) {
    if let Ok(mut wanted) = SLICES_WANTED.lock() {
        *wanted = request;
    }
}

pub(crate) fn platform() -> &'static str {
    if cfg!(target_os = "macos") {
        "syphon"
    } else if cfg!(target_os = "windows") {
        "spout"
    } else {
        "none"
    }
}

/// Whether this build can publish a sender itself (the framework or SDK it
/// needs may still be missing at run time; `texture_share_state` says).
pub(crate) fn implemented() -> bool {
    cfg!(any(target_os = "macos", target_os = "windows"))
}

#[cfg(target_os = "macos")]
struct Slot {
    surface: objc2_core_foundation::CFRetained<objc2_io_surface::IOSurfaceRef>,
    texture: wgpu::Texture,
}

#[cfg(target_os = "macos")]
struct Pending {
    slot: usize,
    done: Arc<AtomicBool>,
}

#[cfg(target_os = "macos")]
struct Publisher {
    name: String,
    server: mac_syphon::SyphonServer,
    slots: Vec<Slot>,
    width: u32,
    height: u32,
    format: Option<wgpu::TextureFormat>,
    pending: VecDeque<Pending>,
    unsubmitted: Vec<Pending>,
    published: u64,
    /// Frames not published because every slot was still in use.
    skipped: u64,
    window_started: Instant,
    window_frames: u64,
    fps: f64,
}

#[cfg(target_os = "macos")]
impl Publisher {
    fn new(name: &str, app_name: Option<&str>) -> Result<Self, String> {
        Ok(Self {
            name: name.to_string(),
            server: mac_syphon::SyphonServer::new(name, app_name)?,
            slots: Vec::new(),
            width: 0,
            height: 0,
            format: None,
            pending: VecDeque::new(),
            unsubmitted: Vec::new(),
            published: 0,
            skipped: 0,
            window_started: Instant::now(),
            window_frames: 0,
            fps: 0.0,
        })
    }

    fn slot_busy(&self, slot: usize) -> bool {
        self.pending.iter().chain(self.unsubmitted.iter()).any(|p| p.slot == slot)
            || !self.server.slot_free(slot as u32)
    }

    fn note_published(&mut self) {
        self.published += 1;
        self.window_frames += 1;
        let elapsed = self.window_started.elapsed().as_secs_f64();
        if elapsed >= 1.0 {
            self.fps = self.window_frames as f64 / elapsed;
            self.window_frames = 0;
            self.window_started = Instant::now();
        }
    }

    /// Inside `encoder`, after `source` has been written: copy it into a
    /// free publish surface. A new size or format makes new surfaces.
    fn capture(
        &mut self,
        device: &wgpu::Device,
        encoder: &mut wgpu::CommandEncoder,
        source: &wgpu::Texture,
        width: u32,
        height: u32,
        format: wgpu::TextureFormat,
    ) -> Result<(), String> {
        if self.width != width || self.height != height || self.format != Some(format) {
            // Frames still in flight belong to the old surfaces and are
            // dropped with them.
            self.pending.clear();
            self.unsubmitted.clear();
            self.slots.clear();
            self.width = width;
            self.height = height;
            self.format = Some(format);
            for index in 0..SLOTS {
                let made = RenderState::create_iosurface_texture(
                    device,
                    width,
                    height,
                    format,
                    "Ghost Render Core Syphon Publish Surface",
                    wgpu::TextureUsages::COPY_DST,
                    wgpu::TextureUses::COPY_DST,
                )
                .and_then(|(surface, texture)| {
                    self.server.set_slot(index as u32, &surface, width, height).map(|()| Slot { surface, texture })
                });
                match made {
                    Ok(slot) => self.slots.push(slot),
                    Err(error) => {
                        self.slots.clear();
                        return Err(error);
                    }
                }
            }
        }
        if self.slots.is_empty() {
            return Ok(());
        }
        let Some(slot) = (0..self.slots.len()).find(|slot| !self.slot_busy(*slot)) else {
            self.skipped += 1;
            return Ok(());
        };
        encoder.copy_texture_to_texture(
            source.as_image_copy(),
            self.slots[slot].texture.as_image_copy(),
            wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
        );
        let _keep_surface = &self.slots[slot].surface;
        self.unsubmitted.push(Pending { slot, done: Arc::new(AtomicBool::new(false)) });
        Ok(())
    }

    /// Right after the submission that carried this frame's capture.
    fn submitted(&mut self, queue: &wgpu::Queue) {
        for capture in self.unsubmitted.drain(..) {
            let done = Arc::clone(&capture.done);
            queue.on_submitted_work_done(move || done.store(true, Ordering::Release));
            self.pending.push_back(capture);
        }
    }

    /// Publish the newest capture whose GPU work has completed. Older
    /// completed captures are passed over: a client wants the latest frame.
    fn drain(&mut self) {
        let mut newest = None;
        while self.pending.front().is_some_and(|capture| capture.done.load(Ordering::Acquire)) {
            newest = self.pending.pop_front().map(|capture| capture.slot);
        }
        if let Some(slot) = newest {
            // Metal writes rows top down; Syphon's frames are OpenGL's,
            // bottom up, so the surface is published as flipped.
            if self.server.publish(slot as u32, true) {
                self.note_published();
            }
        }
    }

    fn state(&self) -> Value {
        json!({
            "name": self.name,
            "width": self.width,
            "height": self.height,
            "frames_published": self.published,
            "frames_skipped": self.skipped,
            "fps": (self.fps * 10.0).round() / 10.0,
            "has_clients": self.server.has_clients(),
        })
    }
}

#[derive(Default)]
pub(crate) struct TextureShare {
    #[cfg(target_os = "macos")]
    publisher: Option<Publisher>,
    #[cfg(target_os = "windows")]
    publisher: Option<win_spout::SpoutSender>,
    last_error: Option<String>,
    /// One sender per Screen that sends, by Screen id.
    #[cfg(target_os = "macos")]
    slices: HashMap<String, Publisher>,
    #[cfg(target_os = "windows")]
    slices: HashMap<String, win_spout::SpoutSender>,
    /// Screens rendered this frame whose sender is fed after the submit
    /// (Windows): (Screen id, sender name).
    #[cfg(target_os = "windows")]
    slice_frame: Vec<(String, String)>,
    /// Screens whose sender could not open or send: (sender name, reason).
    /// Not retried until the Screen's sender changes or the app asks again.
    slice_errors: HashMap<String, (String, String)>,
}

#[cfg(target_os = "macos")]
fn slice_sender_name(publisher: &Publisher) -> &str {
    &publisher.name
}

#[cfg(target_os = "windows")]
fn slice_sender_name(sender: &win_spout::SpoutSender) -> &str {
    sender.name()
}

impl RenderState {
    /// Inside the frame's encoder, after the output export has been written:
    /// copy the composite into a free publish surface.
    #[cfg(target_os = "macos")]
    pub(crate) fn capture_texture_share_frame(&mut self, encoder: &mut wgpu::CommandEncoder) {
        let Some(request) = wanted() else {
            self.texture_share.publisher = None;
            return;
        };
        let Some(export) = self.output_export.as_ref() else {
            return;
        };
        let share = &mut self.texture_share;
        if share.publisher.as_ref().is_some_and(|p| p.name != request.name) {
            share.publisher = None;
        }
        if share.publisher.is_none() {
            match Publisher::new(&request.name, request.app_name.as_deref()) {
                Ok(publisher) => {
                    share.publisher = Some(publisher);
                    share.last_error = None;
                }
                Err(error) => {
                    // Asking again every frame would not help; the app sees
                    // the reason in the state and keeps its older path.
                    if share.last_error.as_deref() != Some(error.as_str()) {
                        eprintln!("[ghost-core] Syphon server unavailable: {error}");
                    }
                    share.last_error = Some(error);
                    set_wanted(None);
                    return;
                }
            }
        }
        let publisher = share.publisher.as_mut().expect("publisher just ensured");
        if let Err(error) =
            publisher.capture(&self.device, encoder, &export.texture, export.width, export.height, export.format)
        {
            share.last_error = Some(error);
        }
    }

    #[cfg(not(target_os = "macos"))]
    pub(crate) fn capture_texture_share_frame(&mut self, _encoder: &mut wgpu::CommandEncoder) {}

    /// Right after the frame that carried the capture was submitted.
    pub(crate) fn texture_share_submitted(&mut self) {
        #[cfg(target_os = "macos")]
        {
            if let Some(publisher) = self.texture_share.publisher.as_mut() {
                publisher.submitted(&self.queue);
            }
        }
        #[cfg(target_os = "windows")]
        self.send_spout_frame();
        self.drain_texture_share();
    }

    /// Windows: copy the frame just submitted into the Spout texture.
    #[cfg(target_os = "windows")]
    fn send_spout_frame(&mut self) {
        let Some(request) = wanted() else {
            self.texture_share.publisher = None;
            return;
        };
        let Some(shared_name) = self.output_export.as_ref().map(|export| export.shared_name.clone()) else {
            return;
        };
        let share = &mut self.texture_share;
        if share.publisher.as_ref().is_some_and(|p| p.name() != request.name) {
            share.publisher = None;
        }
        if share.publisher.is_none() {
            match win_spout::SpoutSender::new(&self.device, &request.name, request.host_path.as_deref()) {
                Ok(sender) => {
                    share.publisher = Some(sender);
                    share.last_error = None;
                }
                Err(error) => {
                    eprintln!("[ghost-core] Spout sender unavailable: {error}");
                    share.last_error = Some(error);
                    set_wanted(None);
                    return;
                }
            }
        }
        let sender = share.publisher.as_mut().expect("sender just ensured");
        if let Err(error) = sender.send(&self.device, &shared_name) {
            // Keep rendering; the app reads the reason and falls back.
            eprintln!("[ghost-core] Spout send failed: {error}");
            share.last_error = Some(error);
            share.publisher = None;
            set_wanted(None);
        }
    }

    /// Publish the newest capture whose GPU work has completed. Older
    /// completed captures are passed over: a client wants the latest frame.
    pub(crate) fn drain_texture_share(&mut self) {
        #[cfg(target_os = "macos")]
        {
            if let Some(publisher) = self.texture_share.publisher.as_mut() {
                publisher.drain();
            }
            for publisher in self.texture_share.slices.values_mut() {
                publisher.drain();
            }
        }
    }

    /// Drop the senders of Screens that closed, were renamed or stopped
    /// sending. Nothing to do (and no cost) while no Screen sends.
    pub(crate) fn retain_slice_shares(&mut self, specs: &[SliceOutputSpec]) {
        let share = &mut self.texture_share;
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        let idle = share.slices.is_empty() && share.slice_errors.is_empty();
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        let idle = share.slice_errors.is_empty();
        if idle {
            return;
        }
        let on = slices_wanted().is_some();
        let keep = |id: &str, name: &str| {
            on && specs.iter().any(|spec| spec.id == id && spec.sender.as_deref() == Some(name))
        };
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        share.slices.retain(|id, sender| keep(id, slice_sender_name(sender)));
        share.slice_errors.retain(|id, (name, _)| keep(id, name));
    }

    /// Inside the encoder that drew a Screen, after its export was written:
    /// hand the Screen's frame to its sender. macOS copies it into a publish
    /// surface here; Windows sends it once the frame is submitted.
    pub(crate) fn capture_slice_share(&mut self, encoder: &mut wgpu::CommandEncoder, spec: &SliceOutputSpec) {
        let Some(name) = spec.sender.as_deref() else {
            return;
        };
        let Some(request) = slices_wanted() else {
            return;
        };
        if self.texture_share.slice_errors.contains_key(&spec.id) {
            return;
        }
        #[cfg(target_os = "macos")]
        {
            let Some(target) = self.slice_targets.get(&spec.id) else {
                return;
            };
            let share = &mut self.texture_share;
            if !share.slices.contains_key(&spec.id) {
                match Publisher::new(name, request.app_name.as_deref()) {
                    Ok(publisher) => {
                        share.slices.insert(spec.id.clone(), publisher);
                    }
                    Err(error) => {
                        eprintln!("[ghost-core] Syphon server for Screen \"{name}\" unavailable: {error}");
                        share.slice_errors.insert(spec.id.clone(), (name.to_string(), error));
                        return;
                    }
                }
            }
            let publisher = share.slices.get_mut(&spec.id).expect("slice publisher just ensured");
            let export = &target.export;
            if let Err(error) =
                publisher.capture(&self.device, encoder, &export.texture, export.width, export.height, export.format)
            {
                eprintln!("[ghost-core] Syphon server for Screen \"{name}\" failed: {error}");
                share.slices.remove(&spec.id);
                share.slice_errors.insert(spec.id.clone(), (name.to_string(), error));
            }
        }
        #[cfg(target_os = "windows")]
        {
            let _ = (encoder, &request);
            self.texture_share.slice_frame.push((spec.id.clone(), name.to_string()));
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        let _ = (encoder, request, name);
    }

    /// Right after the frame's last submission, which carried the Screens.
    pub(crate) fn slice_shares_submitted(&mut self) {
        #[cfg(target_os = "macos")]
        for publisher in self.texture_share.slices.values_mut() {
            publisher.submitted(&self.queue);
        }
        #[cfg(target_os = "windows")]
        {
            if self.texture_share.slice_frame.is_empty() {
                return;
            }
            let frame = std::mem::take(&mut self.texture_share.slice_frame);
            let Some(request) = slices_wanted() else {
                return;
            };
            for (id, name) in frame {
                let Some(target) = self.slice_targets.get(&id) else {
                    continue;
                };
                let share = &mut self.texture_share;
                if !share.slices.contains_key(&id) {
                    match win_spout::SpoutSender::new(&self.device, &name, request.host_path.as_deref()) {
                        Ok(sender) => {
                            share.slices.insert(id.clone(), sender);
                        }
                        Err(error) => {
                            eprintln!("[ghost-core] Spout sender for Screen \"{name}\" unavailable: {error}");
                            share.slice_errors.insert(id, (name, error));
                            continue;
                        }
                    }
                }
                let sender = share.slices.get_mut(&id).expect("slice sender just ensured");
                if let Err(error) = sender.send(&self.device, &target.export.shared_name) {
                    eprintln!("[ghost-core] Spout send for Screen \"{name}\" failed: {error}");
                    share.slices.remove(&id);
                    share.slice_errors.insert(id, (name, error));
                }
            }
        }
    }

    pub(crate) fn texture_share_state(&self) -> Value {
        let mut state = self.main_texture_share_state();
        if let Some(object) = state.as_object_mut() {
            object.insert("slices_enabled".into(), json!(slices_wanted().is_some()));
            object.insert("slices".into(), self.slice_share_state());
            object.insert(
                "slice_errors".into(),
                Value::Array(
                    self.texture_share
                        .slice_errors
                        .iter()
                        .map(|(id, (name, error))| json!({ "id": id, "name": name, "error": error }))
                        .collect(),
                ),
            );
        }
        state
    }

    fn slice_share_state(&self) -> Value {
        #[cfg(target_os = "macos")]
        {
            Value::Array(
                self.texture_share
                    .slices
                    .iter()
                    .map(|(id, publisher)| {
                        let mut entry = publisher.state();
                        entry["id"] = json!(id);
                        entry
                    })
                    .collect(),
            )
        }
        #[cfg(target_os = "windows")]
        {
            Value::Array(
                self.texture_share
                    .slices
                    .iter()
                    .map(|(id, sender)| {
                        let (width, height) = sender.size();
                        json!({ "id": id, "name": sender.name(), "width": width, "height": height, "frames_published": sender.frames })
                    })
                    .collect(),
            )
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            Value::Array(Vec::new())
        }
    }

    fn main_texture_share_state(&self) -> Value {
        #[cfg(target_os = "macos")]
        if let Some(publisher) = self.texture_share.publisher.as_ref() {
            let mut state = publisher.state();
            if let Some(object) = state.as_object_mut() {
                object.insert("available".into(), json!(true));
                object.insert("active".into(), json!(true));
                object.insert("platform".into(), json!(platform()));
                object.insert("last_error".into(), json!(self.texture_share.last_error));
            }
            return state;
        }
        #[cfg(target_os = "windows")]
        if let Some(sender) = self.texture_share.publisher.as_ref() {
            let (width, height) = sender.size();
            return json!({
                "available": true,
                "active": true,
                "platform": platform(),
                "name": sender.name(),
                "width": width,
                "height": height,
                "frames_published": sender.frames,
                "last_error": self.texture_share.last_error,
            });
        }
        json!({
            "available": implemented(),
            "active": false,
            "platform": platform(),
            "wanted": wanted().map(|request| request.name),
            "last_error": self.texture_share.last_error,
        })
    }
}

impl App {
    /// `texture_share_start` / `_stop` / `_state`, and
    /// `texture_share_slices_start` / `_stop` for the Screens' senders.
    pub(crate) fn texture_share_rpc(&mut self, method: &str, params: &Value) -> Result<Value, String> {
        match method {
            "texture_share_start" => {
                if !implemented() {
                    return Err(format!("{} from the render core is not available on this platform", platform()));
                }
                #[cfg(target_os = "macos")]
                mac_syphon::load_framework()?;
                let name = params
                    .get("name")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|name| !name.is_empty())
                    .ok_or_else(|| "texture_share_start needs a name".to_string())?;
                let app_name = params
                    .get("app_name")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|app| !app.is_empty())
                    .map(str::to_string);
                let host_path = params
                    .get("host_path")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|path| !path.is_empty())
                    .map(str::to_string);
                set_wanted(Some(ShareRequest { name: name.to_string(), app_name, host_path }));
                if let Some(renderer) = self.renderer.as_mut() {
                    renderer.texture_share.last_error = None;
                }
                // The server starts with the next rendered frame.
                self.request_auto_present();
                Ok(self.texture_share_state_value())
            }
            "texture_share_stop" => {
                set_wanted(None);
                #[cfg(any(target_os = "macos", target_os = "windows"))]
                if let Some(renderer) = self.renderer.as_mut() {
                    renderer.texture_share.publisher = None;
                }
                Ok(self.texture_share_state_value())
            }
            "texture_share_slices_start" => {
                if !implemented() {
                    return Err(format!("{} from the render core is not available on this platform", platform()));
                }
                #[cfg(target_os = "macos")]
                mac_syphon::load_framework()?;
                let text = |key: &str| {
                    params
                        .get(key)
                        .and_then(Value::as_str)
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .map(str::to_string)
                };
                set_slices_wanted(Some(SliceShareRequest { app_name: text("app_name"), host_path: text("host_path") }));
                // Asked again (a fallback retried, or an app restart): try
                // the Screens that failed before once more.
                if let Some(renderer) = self.renderer.as_mut() {
                    renderer.texture_share.slice_errors.clear();
                }
                self.request_auto_present();
                Ok(self.texture_share_state_value())
            }
            "texture_share_slices_stop" => {
                set_slices_wanted(None);
                if let Some(renderer) = self.renderer.as_mut() {
                    #[cfg(any(target_os = "macos", target_os = "windows"))]
                    renderer.texture_share.slices.clear();
                    renderer.texture_share.slice_errors.clear();
                }
                Ok(self.texture_share_state_value())
            }
            _ => Ok(self.texture_share_state_value()),
        }
    }

    fn texture_share_state_value(&self) -> Value {
        match self.renderer.as_ref() {
            Some(renderer) => renderer.texture_share_state(),
            None => json!({
                "available": implemented(),
                "active": false,
                "platform": platform(),
                "wanted": wanted().map(|request| request.name),
                "slices_enabled": slices_wanted().is_some(),
                "slices": [],
                "slice_errors": [],
            }),
        }
    }
}
