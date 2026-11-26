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

use crate::{App, RenderState};

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
    fn new(request: &ShareRequest) -> Result<Self, String> {
        Ok(Self {
            name: request.name.clone(),
            server: mac_syphon::SyphonServer::new(&request.name, request.app_name.as_deref())?,
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
}

#[derive(Default)]
pub(crate) struct TextureShare {
    #[cfg(target_os = "macos")]
    publisher: Option<Publisher>,
    #[cfg(target_os = "windows")]
    publisher: Option<win_spout::SpoutSender>,
    last_error: Option<String>,
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
            match Publisher::new(&request) {
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
        if publisher.width != export.width
            || publisher.height != export.height
            || publisher.format != Some(export.format)
        {
            // A new output size: new surfaces. Frames still in flight belong
            // to the old ones and are dropped with them.
            publisher.pending.clear();
            publisher.unsubmitted.clear();
            publisher.slots.clear();
            for index in 0..SLOTS {
                let made = RenderState::create_iosurface_texture(
                    &self.device,
                    export.width,
                    export.height,
                    export.format,
                    "Ghost Render Core Syphon Publish Surface",
                    wgpu::TextureUsages::COPY_DST,
                    wgpu::TextureUses::COPY_DST,
                )
                .and_then(|(surface, texture)| {
                    publisher
                        .server
                        .set_slot(index as u32, &surface, export.width, export.height)
                        .map(|()| Slot { surface, texture })
                });
                match made {
                    Ok(slot) => publisher.slots.push(slot),
                    Err(error) => {
                        share.last_error = Some(error);
                        publisher.slots.clear();
                        break;
                    }
                }
            }
            publisher.width = export.width;
            publisher.height = export.height;
            publisher.format = Some(export.format);
        }
        if publisher.slots.is_empty() {
            return;
        }
        let Some(slot) = (0..publisher.slots.len()).find(|slot| !publisher.slot_busy(*slot)) else {
            publisher.skipped += 1;
            return;
        };
        encoder.copy_texture_to_texture(
            export.texture.as_image_copy(),
            publisher.slots[slot].texture.as_image_copy(),
            wgpu::Extent3d { width: export.width, height: export.height, depth_or_array_layers: 1 },
        );
        let _keep_surface = &publisher.slots[slot].surface;
        publisher.unsubmitted.push(Pending { slot, done: Arc::new(AtomicBool::new(false)) });
    }

    #[cfg(not(target_os = "macos"))]
    pub(crate) fn capture_texture_share_frame(&mut self, _encoder: &mut wgpu::CommandEncoder) {}

    /// Right after the frame that carried the capture was submitted.
    pub(crate) fn texture_share_submitted(&mut self) {
        #[cfg(target_os = "macos")]
        {
            let Some(publisher) = self.texture_share.publisher.as_mut() else {
                return;
            };
            for capture in publisher.unsubmitted.drain(..) {
                let done = Arc::clone(&capture.done);
                self.queue.on_submitted_work_done(move || done.store(true, Ordering::Release));
                publisher.pending.push_back(capture);
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
            let Some(publisher) = self.texture_share.publisher.as_mut() else {
                return;
            };
            let mut newest = None;
            while publisher
                .pending
                .front()
                .is_some_and(|capture| capture.done.load(Ordering::Acquire))
            {
                newest = publisher.pending.pop_front().map(|capture| capture.slot);
            }
            if let Some(slot) = newest {
                // Metal writes rows top down; Syphon's frames are OpenGL's,
                // bottom up, so the surface is published as flipped.
                if publisher.server.publish(slot as u32, true) {
                    publisher.note_published();
                }
            }
        }
    }

    pub(crate) fn texture_share_state(&self) -> Value {
        #[cfg(target_os = "macos")]
        if let Some(publisher) = self.texture_share.publisher.as_ref() {
            return json!({
                "available": true,
                "active": true,
                "platform": platform(),
                "name": publisher.name,
                "width": publisher.width,
                "height": publisher.height,
                "frames_published": publisher.published,
                "frames_skipped": publisher.skipped,
                "fps": (publisher.fps * 10.0).round() / 10.0,
                "has_clients": publisher.server.has_clients(),
                "last_error": self.texture_share.last_error,
            });
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
    /// `texture_share_start` / `_stop` / `_state`.
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
            }),
        }
    }
}
