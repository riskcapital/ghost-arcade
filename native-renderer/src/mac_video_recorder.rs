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

use std::ffi::{c_char, c_void, CString};
use std::path::Path;

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
    fn ghost_mac_recorder_append(
        recorder: *mut c_void,
        iosurface_id: u32,
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

pub struct MacVideoRecorder {
    handle: *mut c_void,
    finished: bool,
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
    ) -> Result<Self, String> {
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
        Ok(Self { handle, finished: false })
    }

    /// Append the composite. Returns false when the frame was paced out --
    /// the core renders faster than the recording rate, and that is normal.
    pub fn append_iosurface(&mut self, iosurface_id: u32) -> Result<bool, String> {
        if self.finished {
            return Err("native recording: recorder already finished".into());
        }
        let mut error = [0 as c_char; ERROR_CAPACITY];
        let result = unsafe {
            ghost_mac_recorder_append(
                self.handle,
                iosurface_id,
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
