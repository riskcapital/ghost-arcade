//! Hardware-only macOS decoder. All decoder operations belong on a media worker.
//! Frames own their CVPixelBuffer, including while a GPU submission is in flight.
#![cfg(target_os = "macos")]

use std::{
    ffi::{CStr, CString, c_char, c_void},
    os::unix::ffi::OsStrExt,
    path::Path,
    ptr::NonNull,
    sync::Arc,
};

#[derive(Clone, Copy, Debug)]
pub struct VideoMetadata {
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub duration_seconds: f64,
    pub hardware: bool,
}

#[derive(Debug)]
struct PixelBufferOwner(NonNull<c_void>);

// The shim only exposes completed immutable buffers. Core Video's retain/release
// is thread safe; Rust consumers never lock, map, or mutate their pixel memory.
unsafe impl Send for PixelBufferOwner {}
unsafe impl Sync for PixelBufferOwner {}

impl Drop for PixelBufferOwner {
    fn drop(&mut self) {
        unsafe { ghost_mac_video_release_pixel_buffer(self.0.as_ptr()) };
    }
}

#[derive(Clone, Debug)]
pub struct GpuVideoFrame {
    // Retain this frame until the GPU has completed reading its IOSurface.
    _pixel_buffer: Arc<PixelBufferOwner>,
    pub iosurface_id: u32,
    pub width: u32,
    pub height: u32,
    pub pixel_format: u32,
    /// 1 = BT.601, 2 = BT.709, 3 = BT.2020.
    pub color_matrix: u32,
    pub full_range: bool,
    pub pts_seconds: f64,
    pub duration_seconds: f64,
}

#[repr(C)]
#[derive(Default)]
struct RawMetadata {
    width: u32,
    height: u32,
    fps: f64,
    duration_seconds: f64,
    hardware: u8,
}

#[repr(C)]
#[derive(Default)]
struct RawFrame {
    pixel_buffer: *mut c_void,
    iosurface_id: u32,
    width: u32,
    height: u32,
    pixel_format: u32,
    color_matrix: u32,
    full_range: u8,
    pts_seconds: f64,
    duration_seconds: f64,
}

unsafe extern "C" {
    fn ghost_mac_video_open(
        path: *const c_char,
        metadata: *mut RawMetadata,
        error: *mut c_char,
        error_capacity: usize,
    ) -> *mut c_void;
    fn ghost_mac_video_seek(
        decoder: *mut c_void,
        start_seconds: f64,
        end_seconds: f64,
        error: *mut c_char,
        error_capacity: usize,
    ) -> i32;
    fn ghost_mac_video_next_frame(
        decoder: *mut c_void,
        frame: *mut RawFrame,
        error: *mut c_char,
        error_capacity: usize,
    ) -> i32;
    fn ghost_mac_video_step_frame(
        decoder: *mut c_void,
        reference_seconds: f64,
        direction: i32,
        range_start: f64,
        range_end: f64,
        frame: *mut RawFrame,
        error: *mut c_char,
        error_capacity: usize,
    ) -> i32;
    fn ghost_mac_video_set_queue_capacity(
        decoder: *mut c_void,
        capacity: usize,
        error: *mut c_char,
        error_capacity: usize,
    ) -> i32;
    fn ghost_mac_video_close(decoder: *mut c_void);
    fn ghost_mac_video_release_pixel_buffer(pixel_buffer: *mut c_void);
}

fn error_message(error: &[c_char]) -> String {
    // Every shim error is NUL-terminated, and the buffer starts zeroed.
    unsafe { CStr::from_ptr(error.as_ptr()) }
        .to_string_lossy()
        .into_owned()
}

pub struct MacVideoDecoder {
    decoder: NonNull<c_void>,
    metadata: VideoMetadata,
    queue_capacity: usize,
}

// A decoder may move between workers but may never be operated concurrently.
unsafe impl Send for MacVideoDecoder {}

impl MacVideoDecoder {
    pub fn open(path: &Path) -> Result<Self, String> {
        let path = CString::new(path.as_os_str().as_bytes())
            .map_err(|_| "Video path contains a NUL byte".to_string())?;
        let mut raw = RawMetadata::default();
        let mut error = [0; 2048];
        let decoder = unsafe {
            ghost_mac_video_open(path.as_ptr(), &mut raw, error.as_mut_ptr(), error.len())
        };
        let decoder = NonNull::new(decoder).ok_or_else(|| error_message(&error))?;
        Ok(Self {
            decoder,
            queue_capacity: 8,
            metadata: VideoMetadata {
                width: raw.width,
                height: raw.height,
                fps: raw.fps,
                duration_seconds: raw.duration_seconds,
                hardware: raw.hardware != 0,
            },
        })
    }

    pub fn metadata(&self) -> VideoMetadata {
        self.metadata
    }

    /// Maximum app-retained decoded surfaces inside the shim, including all
    /// callbacks in flight. VideoToolbox's private codec-reference pool is not
    /// exposed by Apple and is separate from this application queue budget.
    pub fn queue_capacity(&self) -> usize {
        self.queue_capacity
    }

    /// macOS has no application-owned conversion pool: dropping a history
    /// frame releases its CVPixelBuffer retain immediately. The shim queue and
    /// opaque codec reference pool remain separate from optional history.
    pub fn release_unused_gpu_surfaces(&mut self) -> Result<(), String> {
        Ok(())
    }

    pub fn set_queue_capacity(&mut self, capacity: usize) -> Result<(), String> {
        let mut error = [0; 2048];
        let status = unsafe {
            ghost_mac_video_set_queue_capacity(
                self.decoder.as_ptr(),
                capacity,
                error.as_mut_ptr(),
                error.len(),
            )
        };
        if status == 0 {
            self.queue_capacity = capacity;
            Ok(())
        } else {
            Err(error_message(&error))
        }
    }

    /// Seek the existing hardware session. PTS remains on the source timeline;
    /// the first returned frame may straddle `start_seconds`.
    pub fn seek(&mut self, start_seconds: f64, end_seconds: Option<f64>) -> Result<(), String> {
        let mut error = [0; 2048];
        let status = unsafe {
            ghost_mac_video_seek(
                self.decoder.as_ptr(),
                start_seconds,
                end_seconds.unwrap_or(f64::INFINITY),
                error.as_mut_ptr(),
                error.len(),
            )
        };
        if status == 0 {
            Ok(())
        } else {
            Err(error_message(&error))
        }
    }

    pub fn next_frame(&mut self) -> Result<Option<GpuVideoFrame>, String> {
        let mut raw = RawFrame::default();
        let mut error = [0; 2048];
        let status = unsafe {
            ghost_mac_video_next_frame(
                self.decoder.as_ptr(),
                &mut raw,
                error.as_mut_ptr(),
                error.len(),
            )
        };
        Self::frame_result(status, raw, &error)
    }

    /// Select the adjacent presentation sample, including variable-rate
    /// video. Trim edges clamp without looping; next_frame resumes after it.
    pub fn step_frame(
        &mut self,
        reference_seconds: f64,
        direction: i32,
        range_start: f64,
        range_end: f64,
    ) -> Result<Option<GpuVideoFrame>, String> {
        let mut raw = RawFrame::default();
        let mut error = [0; 2048];
        let status = unsafe {
            ghost_mac_video_step_frame(
                self.decoder.as_ptr(),
                reference_seconds,
                direction,
                range_start,
                range_end,
                &mut raw,
                error.as_mut_ptr(),
                error.len(),
            )
        };
        Self::frame_result(status, raw, &error)
    }

    fn frame_result(
        status: i32,
        raw: RawFrame,
        error: &[c_char],
    ) -> Result<Option<GpuVideoFrame>, String> {
        match status {
            0 => Ok(None),
            1 => {
                let pixel_buffer = NonNull::new(raw.pixel_buffer)
                    .ok_or_else(|| "Hardware decoder returned an empty pixel buffer".to_string())?;
                Ok(Some(GpuVideoFrame {
                    _pixel_buffer: Arc::new(PixelBufferOwner(pixel_buffer)),
                    iosurface_id: raw.iosurface_id,
                    width: raw.width,
                    height: raw.height,
                    pixel_format: raw.pixel_format,
                    color_matrix: raw.color_matrix,
                    full_range: raw.full_range != 0,
                    pts_seconds: raw.pts_seconds,
                    duration_seconds: raw.duration_seconds,
                }))
            }
            _ => Err(error_message(&error)),
        }
    }
}

impl Drop for MacVideoDecoder {
    fn drop(&mut self) {
        unsafe { ghost_mac_video_close(self.decoder.as_ptr()) };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    unsafe extern "C" {
        fn CVPixelBufferGetWidth(pixel_buffer: *mut c_void) -> usize;
        fn CVPixelBufferGetHeight(pixel_buffer: *mut c_void) -> usize;
    }

    #[test]
    fn completed_gpu_frames_can_cross_worker_and_submission_threads() {
        fn assert_send_sync<T: Send + Sync>() {}
        assert_send_sync::<GpuVideoFrame>();
    }

    // These integration tests require actual Mac video-decoder access. The
    // sandbox may reject session creation with -12911 even on supported Macs.
    // Generate the fixtures outside playback code, for example:
    // ffmpeg -f lavfi -i testsrc2=size=320x180:rate=30:duration=3 -c:v libx264
    //   -bf 3 -g 30 -pix_fmt yuv420p /tmp/ghost-h264.mp4
    // ffmpeg -f lavfi -i testsrc2=size=320x180:rate=30:duration=3 -c:v libx265
    //   -x265-params bframes=4:keyint=30 -pix_fmt yuv420p10le /tmp/ghost-hevc10.mp4
    // Set GHOST_TEST_H264_PATH / GHOST_TEST_HEVC10_PATH, then run the respective
    // hardware_* test with --ignored. Fixture creation is never on the playback
    // path. The fixtures deliberately have reordered frames and MP4 edit lists.
    fn check_hardware_fixture(variable: &str, expected_format: u32) {
        let path = std::env::var_os(variable)
            .unwrap_or_else(|| panic!("Set {variable} to a 3-second 30fps B-frame test fixture"));
        let mut decoder = MacVideoDecoder::open(Path::new(&path)).expect("hardware decoder");
        let metadata = decoder.metadata();
        assert!(metadata.hardware);
        assert_eq!((metadata.width, metadata.height), (320, 180));
        assert!((metadata.duration_seconds - 3.0).abs() < 1e-8);
        assert_eq!(decoder.queue_capacity(), 8);
        decoder.set_queue_capacity(8).unwrap();
        assert!(decoder.set_queue_capacity(0).is_err());
        assert!(decoder.set_queue_capacity(25).is_err());

        let mut timestamps = Vec::new();
        let mut retained = None;
        while let Some(frame) = decoder.next_frame().expect("decode frame") {
            assert_eq!(frame.pixel_format, expected_format);
            assert_ne!(frame.iosurface_id, 0);
            assert!(frame.duration_seconds > 0.0);
            assert!(
                timestamps
                    .last()
                    .is_none_or(|last| frame.pts_seconds > *last)
            );
            timestamps.push(frame.pts_seconds);
            if retained.is_none() {
                retained = Some(frame.clone());
            }
        }
        assert_eq!(
            timestamps.len(),
            90,
            "MP4 edit-list offsets must preserve every frame"
        );
        for (index, pts) in timestamps.iter().enumerate() {
            assert!((pts - index as f64 / 30.0).abs() < 1e-8);
        }
        assert!(decoder.next_frame().unwrap().is_none());
        check_frame_steps(&mut decoder, &timestamps);

        // A cut between frame boundaries must return the frame displayed at
        // the cut, preserve original PTS, and exclude frames starting at end.
        for _ in 0..20 {
            decoder.seek(0.517, Some(1.233)).unwrap();
            let mut actual = Vec::new();
            while let Some(frame) = decoder.next_frame().unwrap() {
                actual.push(frame.pts_seconds);
                assert!(frame.pts_seconds < 1.233);
                assert!(frame.pts_seconds + frame.duration_seconds > 0.517);
            }
            assert_eq!(actual, timestamps[15..37]);
        }
        // Reset to the beginning on the same VT session and then stop before
        // EOF, exercising teardown with a full internal reorder/prefetch queue.
        decoder.seek(0.0, None).unwrap();
        assert_eq!(decoder.next_frame().unwrap().unwrap().pts_seconds, 0.0);
        drop(decoder);

        let retained = retained.expect("first frame retained across seeks and decoder teardown");
        // This reads only immutable buffer metadata, never pixel memory.
        let raw = retained._pixel_buffer.0.as_ptr();
        assert_eq!(unsafe { CVPixelBufferGetWidth(raw) }, 320);
        assert_eq!(unsafe { CVPixelBufferGetHeight(raw) }, 180);
        let another_owner = retained.clone();
        drop(retained);
        assert_eq!(
            unsafe { CVPixelBufferGetWidth(another_owner._pixel_buffer.0.as_ptr()) },
            320
        );

        // A deliberately insufficient queue must fail visibly instead of
        // leaking surfaces, losing B-frames, or waiting forever for capacity.
        let mut limited = MacVideoDecoder::open(Path::new(&path)).unwrap();
        limited.set_queue_capacity(1).unwrap();
        let mut capacity_error = None;
        for _ in 0..90 {
            match limited.next_frame() {
                Ok(Some(_)) => {}
                Ok(None) => break,
                Err(error) => {
                    capacity_error = Some(error);
                    break;
                }
            }
        }
        assert!(capacity_error.is_some_and(|error| error.contains("reorder window")));
        // Moving a decoder must transfer its temporary worker-priority boost;
        // closing it on the new worker also releases the process activity.
        std::thread::spawn(move || {
            limited.seek(0.0, None).unwrap();
            limited.set_queue_capacity(8).unwrap();
            assert_eq!(limited.next_frame().unwrap().unwrap().pts_seconds, 0.0);
        })
        .join()
        .unwrap();
    }

    fn check_frame_steps(decoder: &mut MacVideoDecoder, timestamps: &[f64]) {
        for (index, &pts) in timestamps.iter().enumerate() {
            decoder.seek(pts, None).unwrap();
            assert_eq!(
                decoder.next_frame().unwrap().unwrap().pts_seconds,
                pts,
                "exact rational seek boundary at sample {index}"
            );
        }
        for (first, last) in [
            (0, timestamps.len() - 1),
            (timestamps.len() / 4, timestamps.len() * 3 / 4),
        ] {
            let start = timestamps[first] + if first > 0 { 0.001 } else { 0.0 };
            let end = timestamps
                .get(last + 1)
                .copied()
                .unwrap_or(decoder.metadata().duration_seconds);
            for direction in [-1, 1] {
                for current in first..=last {
                    let expected = if direction < 0 {
                        current.saturating_sub(1).max(first)
                    } else {
                        (current + 1).min(last)
                    };
                    let frame = decoder
                        .step_frame(timestamps[current], direction, start, end)
                        .unwrap()
                        .unwrap();
                    assert_eq!(
                        frame.pts_seconds, timestamps[expected],
                        "step {direction} from sample {current}, trim {first}..={last}"
                    );
                    let next = decoder.next_frame().unwrap();
                    if expected < last {
                        assert_eq!(next.unwrap().pts_seconds, timestamps[expected + 1]);
                    } else {
                        assert!(next.is_none(), "trim end must remain exclusive");
                    }
                }
            }
        }
    }

    #[test]
    #[ignore = "requires Mac hardware decoder access and GHOST_TEST_VFR_PATH fixture"]
    fn hardware_vfr_steps_actual_samples_and_clamps_trim_edges() {
        let path = std::env::var_os("GHOST_TEST_VFR_PATH").expect("Set GHOST_TEST_VFR_PATH");
        let mut decoder = MacVideoDecoder::open(Path::new(&path)).unwrap();
        let mut timestamps = Vec::new();
        while let Some(frame) = decoder.next_frame().unwrap() {
            timestamps.push(frame.pts_seconds);
        }
        assert!(timestamps.len() > 8);
        assert!(
            timestamps
                .windows(3)
                .any(|pts| ((pts[2] - pts[1]) - (pts[1] - pts[0])).abs() > 0.0001),
            "fixture must contain varying frame intervals"
        );
        check_frame_steps(&mut decoder, &timestamps);
    }

    #[test]
    #[ignore = "requires Mac hardware decoder access and GHOST_TEST_H264_PATH fixture"]
    fn hardware_h264_order_seek_and_gpu_frame_lifetime() {
        check_hardware_fixture("GHOST_TEST_H264_PATH", u32::from_be_bytes(*b"420v"));
    }

    #[test]
    #[ignore = "requires Mac hardware decoder access and GHOST_TEST_HEVC10_PATH fixture"]
    fn hardware_hevc_main10_order_seek_and_gpu_frame_lifetime() {
        check_hardware_fixture("GHOST_TEST_HEVC10_PATH", u32::from_be_bytes(*b"x420"));
    }

    #[test]
    #[ignore = "requires Mac hardware decoder access and GHOST_TEST_AUDIO_TAIL_PATH fixture"]
    fn hardware_video_duration_excludes_a_longer_audio_tail() {
        // Same 3-second H.264 fixture, muxed with an audio track longer than 3s.
        check_hardware_fixture("GHOST_TEST_AUDIO_TAIL_PATH", u32::from_be_bytes(*b"420v"));
    }

    #[test]
    #[ignore = "requires GHOST_TEST_ALPHA_PATH and GHOST_TEST_NONSQUARE_PATH fixtures"]
    fn alpha_and_non_square_pixels_require_preserving_compatibility_path() {
        for (variable, expected_reason) in [
            ("GHOST_TEST_ALPHA_PATH", "preserve transparency"),
            ("GHOST_TEST_NONSQUARE_PATH", "preserve geometry"),
        ] {
            let path = std::env::var_os(variable)
                .unwrap_or_else(|| panic!("Set {variable} to its metadata test fixture"));
            let error = match MacVideoDecoder::open(Path::new(&path)) {
                Ok(_) => panic!("{variable} should require the compatibility decoder"),
                Err(error) => error,
            };
            assert!(error.contains(expected_reason), "{error}");
        }
    }
}
