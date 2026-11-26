#![cfg(target_os = "macos")]
//! Rust side of the macOS in-core recorder.
//!
//! Mirrors `windows_video_encoder::WindowsVideoEncoder` so `main.rs` drives
//! both platforms the same way: open with a path and a frame rate, hand it the
//! composite once per rendered frame, finish to get a playable file. The work
//! happens in `mac_video_recorder.mm` against AVAssetWriter, which selects the
//! hardware H.264 encoder and does the muxing.
//!
//! The composite is addressed by IOSurface id -- the same surface Syphon and
//! the editor preview read -- so nothing is copied to system memory.
//!
//! Ordering: the frame is copied GPU-side into one of a few recorder-owned
//! IOSurfaces inside the frame's own command buffer, and only handed to the
//! encoder once that submission has completed. Appending the live export
//! straight after submit gave the encoder a surface the GPU was still
//! writing (and the next frame then overwrote it while the encoder read it
//! asynchronously), so takes tore under load.

use std::collections::VecDeque;
use std::ffi::{c_char, c_void, CString};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use objc2_core_foundation::CFRetained;
use objc2_io_surface::IOSurfaceRef;

const ERROR_CAPACITY: usize = 512;

unsafe extern "C" {
    fn ghost_mac_recorder_open(
        path: *const c_char,
        width: u32,
        height: u32,
        fps: u32,
        quality: *const c_char,
        error: *mut c_char,
        error_capacity: usize,
    ) -> *mut c_void;
    fn ghost_mac_recorder_claim(recorder: *mut c_void) -> i64;
    fn ghost_mac_recorder_append(
        recorder: *mut c_void,
        iosurface_id: u32,
        index: i64,
        error: *mut c_char,
        error_capacity: usize,
    ) -> i32;
    fn ghost_mac_recorder_finish(
        recorder: *mut c_void,
        frames: *mut u64,
        duration_seconds: *mut f64,
        error: *mut c_char,
        error_capacity: usize,
    ) -> i32;
    fn ghost_mac_recorder_frames(recorder: *const c_void) -> u64;
    fn ghost_mac_recorder_duration(recorder: *const c_void) -> f64;
    fn ghost_mac_recorder_free(recorder: *mut c_void);
}

fn take_error(buffer: &[c_char], fallback: &str) -> String {
    let bytes: Vec<u8> = buffer
        .iter()
        .take_while(|c| **c != 0)
        .map(|c| *c as u8)
        .collect();
    if bytes.is_empty() {
        fallback.to_string()
    } else {
        String::from_utf8_lossy(&bytes).into_owned()
    }
}

/// One recorder-owned capture target: an IOSurface the encoder can wrap
/// without a copy, imported into wgpu so the frame can be copied into it.
pub struct CaptureSlot {
    pub surface: CFRetained<IOSurfaceRef>,
    pub texture: wgpu::Texture,
}

struct PendingCapture {
    slot: usize,
    index: i64,
    /// Set by the queue once the submission that filled the slot is done.
    done: Arc<AtomicBool>,
}

pub struct MacVideoRecorder {
    handle: *mut c_void,
    finished: bool,
    width: u32,
    height: u32,
    slots: Vec<CaptureSlot>,
    pending: VecDeque<PendingCapture>,
    /// Captures recorded into the current frame's encoder, waiting for its
    /// submission so their completion can be tracked.
    unsubmitted: Vec<PendingCapture>,
}

// The recorder is only ever touched from the render thread, and AVAssetWriter
// is safe to drive from one thread at a time.
unsafe impl Send for MacVideoRecorder {}

impl MacVideoRecorder {
    pub fn new(
        path: &Path,
        width: u32,
        height: u32,
        fps: u32,
        quality: &str,
        slots: Vec<CaptureSlot>,
    ) -> Result<Self, String> {
        if slots.is_empty() {
            return Err("native recording: no capture surfaces".into());
        }
        let path_c = CString::new(path.to_string_lossy().as_ref())
            .map_err(|_| "native recording: recording path contains a NUL".to_string())?;
        let quality_c = CString::new(quality)
            .map_err(|_| "native recording: quality contains a NUL".to_string())?;
        let mut error = [0 as c_char; ERROR_CAPACITY];
        let handle = unsafe {
            ghost_mac_recorder_open(
                path_c.as_ptr(),
                width,
                height,
                fps,
                quality_c.as_ptr(),
                error.as_mut_ptr(),
                ERROR_CAPACITY,
            )
        };
        if handle.is_null() {
            return Err(take_error(&error, "native recording: could not open the recorder"));
        }
        Ok(Self {
            handle,
            finished: false,
            width,
            height,
            slots,
            pending: VecDeque::new(),
            unsubmitted: Vec::new(),
        })
    }

    /// Copy `source` into a free capture surface inside the frame's encoder,
    /// if this render starts a new recording slot. Never blocks: when every
    /// surface is still owned by the GPU or the encoder, the frame is dropped
    /// the same way the writer's own backpressure drops it.
    pub fn capture(
        &mut self,
        encoder: &mut wgpu::CommandEncoder,
        source: &wgpu::Texture,
        width: u32,
        height: u32,
    ) {
        if self.finished || width != self.width || height != self.height {
            return;
        }
        let Some(slot) = (0..self.slots.len()).find(|slot| {
            !self.pending.iter().chain(self.unsubmitted.iter()).any(|p| p.slot == *slot)
                // CoreVideo holds a use count while the encoder still owns
                // the pixel buffer wrapping this surface.
                && !self.slots[*slot].surface.is_in_use()
        }) else {
            return;
        };
        let index = unsafe { ghost_mac_recorder_claim(self.handle) };
        if index < 0 {
            return;
        }
        encoder.copy_texture_to_texture(
            source.as_image_copy(),
            self.slots[slot].texture.as_image_copy(),
            wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
        );
        self.unsubmitted.push(PendingCapture {
            slot,
            index,
            done: Arc::new(AtomicBool::new(false)),
        });
    }

    /// Call right after the frame that carried `capture` was submitted.
    pub fn submitted(&mut self, queue: &wgpu::Queue) {
        for capture in self.unsubmitted.drain(..) {
            let done = Arc::clone(&capture.done);
            queue.on_submitted_work_done(move || done.store(true, Ordering::Release));
            self.pending.push_back(capture);
        }
    }

    /// Whether captured frames are still waiting for the GPU.
    pub fn has_pending(&self) -> bool {
        !self.pending.is_empty()
    }

    /// Hand every capture whose GPU work has completed to the encoder, in
    /// order.
    pub fn drain_completed(&mut self) -> Result<(), String> {
        while self
            .pending
            .front()
            .is_some_and(|capture| capture.done.load(Ordering::Acquire))
        {
            let capture = self.pending.pop_front().expect("front checked");
            self.append(capture.slot, capture.index)?;
        }
        Ok(())
    }

    fn append(&mut self, slot: usize, index: i64) -> Result<bool, String> {
        if self.finished {
            return Err("native recording: recorder already finished".into());
        }
        let surface_id = self.slots[slot].surface.id();
        let mut error = [0 as c_char; ERROR_CAPACITY];
        let result = unsafe {
            ghost_mac_recorder_append(
                self.handle,
                surface_id,
                index,
                error.as_mut_ptr(),
                ERROR_CAPACITY,
            )
        };
        match result {
            1 => Ok(true),
            0 => Ok(false),
            _ => Err(take_error(&error, "native recording: could not append a frame")),
        }
    }

    pub fn frames_encoded(&self) -> u64 {
        unsafe { ghost_mac_recorder_frames(self.handle) }
    }

    pub fn duration_seconds(&self) -> f64 {
        unsafe { ghost_mac_recorder_duration(self.handle) }
    }

    pub fn finish(&mut self) -> Result<(), String> {
        if self.finished {
            return Ok(());
        }
        self.finished = true;
        self.pending.clear();
        self.unsubmitted.clear();
        let mut error = [0 as c_char; ERROR_CAPACITY];
        let result = unsafe {
            ghost_mac_recorder_finish(
                self.handle,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                error.as_mut_ptr(),
                ERROR_CAPACITY,
            )
        };
        if result < 0 {
            return Err(take_error(&error, "native recording: could not finish the file"));
        }
        Ok(())
    }
}

impl Drop for MacVideoRecorder {
    fn drop(&mut self) {
        // free() finalizes an unfinished file rather than leaving it headless.
        unsafe { ghost_mac_recorder_free(self.handle) };
    }
}
