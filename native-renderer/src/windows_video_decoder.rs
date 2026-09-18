//! Synchronous, worker-owned Media Foundation / DXVA video decoding.
//!
//! SourceReader output is accepted only when it is an actual decoder-bound
//! D3D11 NV12/P010 texture on the renderer's adapter. CPU buffers, WARP devices,
//! software upload paths, and lossy geometry/format changes are rejected.
#![cfg(target_os = "windows")]

use std::{
    marker::PhantomData,
    mem::size_of,
    os::windows::ffi::OsStrExt,
    path::Path,
    ptr,
    rc::Rc,
    time::{Duration, Instant},
};
use windows::{
    Win32::{
        Foundation::HANDLE,
        Graphics::{
            Direct3D11::{
                D3D11_BIND_DECODER, D3D11_TEXTURE2D_DESC, D3D11_USAGE_DEFAULT, ID3D11Texture2D,
            },
            Dxgi::Common::{DXGI_FORMAT_NV12, DXGI_FORMAT_P010},
        },
        Media::MediaFoundation::*,
        System::{
            Com::{
                COINIT_MULTITHREADED, CoInitializeEx, CoUninitialize,
                StructuredStorage::{PROPVARIANT, PropVariantToUInt64},
            },
            Threading::{AvRevertMmThreadCharacteristics, AvSetMmThreadCharacteristicsW},
        },
    },
    core::{GUID, IUnknown, Interface, PCWSTR, w},
};

pub use crate::windows_video_texture::GpuVideoFrame;
use crate::windows_video_texture::{VideoFrameMetadata, WindowsVideoDevice, WindowsVideoWorker};

const VIDEO_STREAM: u32 = MF_SOURCE_READER_FIRST_VIDEO_STREAM.0 as u32;
const ALL_STREAMS: u32 = MF_SOURCE_READER_ALL_STREAMS.0 as u32;
const MEDIA_SOURCE: u32 = MF_SOURCE_READER_MEDIASOURCE.0 as u32;
const HNS_PER_SECOND: f64 = 10_000_000.0;
// Microsoft documents this attribute but does not declare it in SDK headers:
// https://learn.microsoft.com/windows/win32/medfound/mf-source-reader-passthrough-mode
const SOURCE_READER_PASSTHROUGH_MODE: GUID =
    GUID::from_u128(0x043ff126_fe2c_4708_a09b_da2ab435ced9);

#[derive(Clone, Copy, Debug)]
pub struct VideoMetadata {
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub duration_seconds: f64,
    /// False until prime_hardware validates a real DXVA decoder surface.
    pub hardware: bool,
}

fn failure(operation: &str, error: windows::core::Error) -> String {
    format!("{operation}: {error}")
}

struct ComApartment(PhantomData<Rc<()>>);
impl ComApartment {
    fn initialize() -> Result<Self, String> {
        unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }
            .ok()
            .map_err(|e| failure("Initialize media-worker COM apartment", e))?;
        Ok(Self(PhantomData))
    }
}
impl Drop for ComApartment {
    fn drop(&mut self) {
        unsafe { CoUninitialize() };
    }
}

/// Ask MMCSS to schedule this worker as playback work for the decoder's
/// lifetime. The standard task's default priority leaves other work runnable;
/// no real-time priority, timer-resolution change, or process-wide change is
/// needed. MMCSS may be unavailable, so failure does not reject the decoder.
struct PlaybackPriority(Option<HANDLE>);
impl PlaybackPriority {
    fn enter() -> Self {
        let mut task_index = 0;
        Self(unsafe { AvSetMmThreadCharacteristicsW(w!("Playback"), &mut task_index) }.ok())
    }
}
impl Drop for PlaybackPriority {
    fn drop(&mut self) {
        if let Some(handle) = self.0.take() {
            // AvRevert must run on the registering thread. ComApartment makes
            // the enclosing decoder !Send, including its teardown path.
            let _ = unsafe { AvRevertMmThreadCharacteristics(handle) };
        }
    }
}

struct MediaPlatform;
impl MediaPlatform {
    fn initialize() -> Result<Self, String> {
        unsafe { MFStartup(MF_VERSION, MFSTARTUP_FULL) }
            .map_err(|e| failure("Start Media Foundation", e))?;
        Ok(Self)
    }
}
impl Drop for MediaPlatform {
    fn drop(&mut self) {
        let _ = unsafe { MFShutdown() };
    }
}

#[derive(Clone, Copy, Debug)]
struct OutputFormat {
    width: u32,
    height: u32,
    color_matrix: u32,
    full_range: bool,
    p010: bool,
}

fn unpack_ratio(value: u64) -> (u32, u32) {
    ((value >> 32) as u32, value as u32)
}

fn hns(seconds: f64) -> Result<i64, String> {
    if !seconds.is_finite() || seconds < 0.0 || seconds > i64::MAX as f64 / HNS_PER_SECOND {
        return Err(
            "Video time must be finite, nonnegative, and representable in Media Foundation".into(),
        );
    }
    Ok((seconds * HNS_PER_SECOND).round() as i64)
}

fn presentation_hns(seconds: f64) -> Result<i64, String> {
    if !seconds.is_finite()
        || seconds < i64::MIN as f64 / HNS_PER_SECOND
        || seconds > i64::MAX as f64 / HNS_PER_SECOND
    {
        return Err("Video presentation timestamp is invalid".into());
    }
    Ok((seconds * HNS_PER_SECOND).round() as i64)
}

fn sample_end(pts: i64, duration: i64) -> Option<i64> {
    (duration > 0).then(|| pts.checked_add(duration)).flatten()
}

fn validate_geometry(media_type: &IMFMediaType) -> Result<(u32, u32), String> {
    let size = unsafe { media_type.GetUINT64(&MF_MT_FRAME_SIZE) }
        .map_err(|e| failure("Read video frame dimensions", e))?;
    let (width, height) = unpack_ratio(size);
    if width == 0 || height == 0 || width > 16384 || height > 16384 {
        return Err("Video has invalid or unsupported frame dimensions".into());
    }
    if unsafe { media_type.GetUINT32(&MF_MT_ALPHA_MODE) }.unwrap_or(0) != 0 {
        return Err(
            "Video alpha requires the compatibility decoder to preserve transparency".into(),
        );
    }
    if unsafe { media_type.GetUINT32(&MF_MT_VIDEO_ROTATION) }.unwrap_or(0) != 0 {
        return Err("Rotated video requires the compatibility decoder to preserve geometry".into());
    }
    if let Ok(ratio) = unsafe { media_type.GetUINT64(&MF_MT_PIXEL_ASPECT_RATIO) } {
        let (x, y) = unpack_ratio(ratio);
        if x == 0 || x != y {
            return Err(
                "Non-square video pixels require the compatibility decoder to preserve geometry"
                    .into(),
            );
        }
    }
    if let Ok(interlace) = unsafe { media_type.GetUINT32(&MF_MT_INTERLACE_MODE) } {
        if interlace != 0 && interlace != MFVideoInterlace_Progressive.0 as u32 {
            return Err("Interlaced video requires the compatibility decoder".into());
        }
    }
    if unsafe { media_type.GetUINT32(&MF_MT_PAN_SCAN_ENABLED) }.unwrap_or(0) != 0 {
        return Err(
            "Video pan-and-scan requires the compatibility decoder to preserve geometry".into(),
        );
    }
    for key in [MF_MT_GEOMETRIC_APERTURE, MF_MT_MINIMUM_DISPLAY_APERTURE] {
        if let Ok(length) = unsafe { media_type.GetBlobSize(&key) } {
            if length as usize != size_of::<MFVideoArea>() {
                return Err("Video has an invalid display aperture".into());
            }
            let mut bytes = [0u8; size_of::<MFVideoArea>()];
            unsafe { media_type.GetBlob(&key, &mut bytes, None) }
                .map_err(|e| failure("Read video display aperture", e))?;
            let area = unsafe { ptr::read_unaligned(bytes.as_ptr().cast::<MFVideoArea>()) };
            if area.OffsetX.value != 0
                || area.OffsetX.fract != 0
                || area.OffsetY.value != 0
                || area.OffsetY.fract != 0
                || area.Area.cx != width as i32
                || area.Area.cy != height as i32
            {
                return Err("Video display-aperture cropping requires the compatibility decoder to preserve geometry".into());
            }
        }
    }
    Ok((width, height))
}

fn color_info(media_type: &IMFMediaType, height: u32) -> Result<(u32, bool), String> {
    let matrix = unsafe { media_type.GetUINT32(&MF_MT_YUV_MATRIX) }.unwrap_or(0);
    let matrix = match matrix {
        0 => {
            if height <= 576 {
                1
            } else {
                2
            }
        }
        1 => 2, // MFVideoTransferMatrix_BT709
        2 => 1, // MFVideoTransferMatrix_BT601
        4 => 3, // MFVideoTransferMatrix_BT2020_10
        _ => return Err("Video color matrix requires the compatibility decoder".into()),
    };
    let range = unsafe { media_type.GetUINT32(&MF_MT_VIDEO_NOMINAL_RANGE) }.unwrap_or(0);
    if range > 2 {
        return Err("Video nominal range requires the compatibility decoder".into());
    }
    let transfer = unsafe { media_type.GetUINT32(&MF_MT_TRANSFER_FUNCTION) }.unwrap_or(0);
    if transfer == MFVideoTransFunc_2020_const.0 as u32 {
        return Err("Constant-luminance BT.2020 video requires the compatibility decoder".into());
    }
    if transfer == MFVideoTransFunc_2084.0 as u32 || transfer == MFVideoTransFunc_HLG.0 as u32 {
        return Err(
            "HDR video requires the compatibility decoder until HDR tone mapping is available"
                .into(),
        );
    }
    // The converter uses the standard SDR DXGI G22 spaces. Do not silently
    // reinterpret explicitly linear, logarithmic, or custom-gamma content.
    if !matches!(transfer, 0 | 4 | 5 | 7 | 13) {
        return Err("Video transfer function requires the compatibility decoder".into());
    }
    let primaries = unsafe { media_type.GetUINT32(&MF_MT_VIDEO_PRIMARIES) }.unwrap_or(0);
    let supported_primaries = match matrix {
        1 => matches!(primaries, 0 | 4 | 5 | 8), // BT.601 SD families
        2 => matches!(primaries, 0 | 2),         // BT.709
        3 => matches!(primaries, 0 | 9),         // BT.2020
        _ => false,
    };
    if !supported_primaries {
        return Err("Video color primaries require the compatibility decoder".into());
    }
    Ok((matrix, range == MFNominalRange_0_255.0 as u32))
}

fn native_output_is_p010(native: &IMFMediaType) -> Result<bool, String> {
    let subtype = unsafe { native.GetGUID(&MF_MT_SUBTYPE) }
        .map_err(|e| failure("Read compressed video codec", e))?;
    let profile = unsafe { native.GetUINT32(&MF_MT_MPEG2_PROFILE) }.unwrap_or(0);
    if subtype == MFVideoFormat_H264 || subtype == MFVideoFormat_H264_ES {
        if !matches!(profile, 0 | 66 | 77 | 88 | 100) {
            return Err(
                "This H.264 profile requires the compatibility decoder to preserve precision"
                    .into(),
            );
        }
        return Ok(false);
    }
    if subtype == MFVideoFormat_HEVC
        || subtype == MFVideoFormat_HEVC_ES
        || subtype == MFVideoFormat_H265
    {
        if profile > 2 {
            return Err(
                "This HEVC profile requires the compatibility decoder to preserve precision".into(),
            );
        }
        // Unknown HEVC precision is kept at ten bits instead of silently
        // truncating Main10. Explicit Main profile may use native NV12.
        return Ok(profile != 1);
    }
    Err("This video codec requires the compatibility decoder; native DXVA currently accepts H.264 and HEVC".into())
}

fn set_position(reader: &IMFSourceReader, position: i64) -> Result<(), String> {
    unsafe { reader.Flush(VIDEO_STREAM) }.map_err(|e| failure("Flush video reader for seek", e))?;
    let value = PROPVARIANT::from(position);
    unsafe { reader.SetCurrentPosition(&GUID::zeroed(), &value) }
        .map_err(|e| failure("Seek persistent video reader", e))
}

/// Probe compressed timestamps only, before an uncompressed decoder is loaded.
/// This avoids a longer audio tail becoming a freeze at every video loop.
fn video_duration(reader: &IMFSourceReader, container_end: i64, fps: f64) -> Result<i64, String> {
    let deadline = Instant::now() + Duration::from_secs(5);
    let fallback_duration = (HNS_PER_SECOND / fps).round().max(1.0) as i64;
    let mut window = 10_000_000i64;
    for _ in 0..16 {
        let start = container_end.saturating_sub(window).max(0);
        set_position(reader, start)?;
        let mut maximum_end = None::<i64>;
        for _ in 0..4096 {
            if Instant::now() >= deadline {
                return Err("Video duration probe exceeded its preparation deadline".into());
            }
            let mut flags = 0;
            let mut timestamp = 0;
            let mut sample = None;
            unsafe {
                reader.ReadSample(
                    VIDEO_STREAM,
                    0,
                    None,
                    Some(&mut flags),
                    Some(&mut timestamp),
                    Some(&mut sample),
                )
            }
            .map_err(|e| failure("Read compressed video tail timing", e))?;
            if flags & MF_SOURCE_READERF_ERROR.0 as u32 != 0 {
                return Err("Compressed video timing probe failed".into());
            }
            if let Some(sample) = sample {
                let pts = unsafe { sample.GetSampleTime() }.unwrap_or(timestamp);
                let duration = unsafe { sample.GetSampleDuration() }
                    .ok()
                    .filter(|duration| *duration > 0)
                    .unwrap_or(fallback_duration);
                if let Some(end) = sample_end(pts, duration) {
                    maximum_end = Some(maximum_end.map_or(end, |old| old.max(end)));
                }
            }
            if flags & MF_SOURCE_READERF_ENDOFSTREAM.0 as u32 != 0 {
                if let Some(end) = maximum_end.filter(|end| *end > 0) {
                    set_position(reader, 0)?;
                    return Ok(end.min(container_end));
                }
                break;
            }
        }
        if start == 0 {
            break;
        }
        window = window.saturating_mul(2);
    }
    Err("Cannot establish a bounded, reliable video-only duration".into())
}

pub struct WindowsVideoDecoder {
    // Explicit teardown order: reader, converter's pending input samples,
    // device manager, MF platform, and finally this worker's COM apartment.
    reader: Option<IMFSourceReader>,
    worker: Option<WindowsVideoWorker>,
    manager: Option<IMFDXGIDeviceManager>,
    metadata: VideoMetadata,
    output: OutputFormat,
    pending: Option<GpuVideoFrame>,
    start_hns: i64,
    end_hns: i64,
    last_hns: Option<i64>,
    ended: bool,
    queue_capacity: usize,
    pristine_prime: bool,
    _priority: PlaybackPriority,
    _platform: MediaPlatform,
    // This makes the decoder !Send/!Sync. Construct, operate, and drop it on
    // its media worker; completed converted frames are independently Send.
    _apartment: ComApartment,
}

impl WindowsVideoDecoder {
    pub fn open_with_device(path: &Path, device: &WindowsVideoDevice) -> Result<Self, String> {
        let apartment = ComApartment::initialize()?;
        let priority = PlaybackPriority::enter();
        let platform = MediaPlatform::initialize()?;
        let worker = device.create_worker()?;
        let mut token = 0;
        let mut manager = None;
        unsafe { MFCreateDXGIDeviceManager(&mut token, &mut manager) }
            .map_err(|e| failure("Create DXGI decoder device manager", e))?;
        let manager = manager.ok_or("Media Foundation returned no DXGI device manager")?;
        unsafe { manager.ResetDevice(worker.device(), token) }
            .map_err(|e| failure("Bind renderer adapter to hardware decoder", e))?;
        let mut attributes = None;
        unsafe { MFCreateAttributes(&mut attributes, 8) }
            .map_err(|e| failure("Create native video reader attributes", e))?;
        let attributes = attributes.ok_or("Media Foundation returned no reader attributes")?;
        unsafe {
            attributes
                .SetUnknown(&MF_SOURCE_READER_D3D_MANAGER, &manager)
                .and_then(|_| attributes.SetUINT32(&MF_READWRITE_ENABLE_HARDWARE_TRANSFORMS, 1))
                .and_then(|_| attributes.SetUINT32(&MF_SOURCE_READER_DISABLE_DXVA, 0))
                .and_then(|_| attributes.SetUINT32(&MF_READWRITE_D3D_OPTIONAL, 0))
                .and_then(|_| attributes.SetUINT32(&SOURCE_READER_PASSTHROUGH_MODE, 1))
                .and_then(|_| attributes.SetUINT32(&MF_SOURCE_READER_ENABLE_VIDEO_PROCESSING, 0))
                .and_then(|_| {
                    attributes.SetUINT32(&MF_SOURCE_READER_ENABLE_ADVANCED_VIDEO_PROCESSING, 0)
                })
        }
        .map_err(|e| failure("Require native D3D video output", e))?;
        // In particular, do not set SOURCE_READER_D3D11_BIND_FLAGS: an upload
        // texture must not be artificially tagged DECODER to pass our proof.
        let mut filename: Vec<u16> = path.as_os_str().encode_wide().collect();
        if filename.contains(&0) {
            return Err("Video path contains a NUL character".into());
        }
        filename.push(0);
        let reader = unsafe { MFCreateSourceReaderFromURL(PCWSTR(filename.as_ptr()), &attributes) }
            .map_err(|e| failure("Open native video source reader", e))?;
        unsafe {
            reader
                .SetStreamSelection(ALL_STREAMS, false)
                .and_then(|_| reader.SetStreamSelection(VIDEO_STREAM, true))
        }
        .map_err(|e| failure("Select video-only source stream", e))?;
        let native = unsafe { reader.GetNativeMediaType(VIDEO_STREAM, 0) }
            .map_err(|e| failure("Read native compressed video type", e))?;
        let (width, height) = validate_geometry(&native)?;
        let p010 = native_output_is_p010(&native)?;
        let (color_matrix, full_range) = color_info(&native, height)?;
        let (numerator, denominator) =
            unpack_ratio(unsafe { native.GetUINT64(&MF_MT_FRAME_RATE) }.unwrap_or(30u64 << 32 | 1));
        let fps = if numerator > 0 && denominator > 0 {
            numerator as f64 / denominator as f64
        } else {
            30.0
        };
        if !fps.is_finite() || !(0.1..=1000.0).contains(&fps) {
            return Err("Video has an invalid frame rate".into());
        }
        let duration_value =
            unsafe { reader.GetPresentationAttribute(MEDIA_SOURCE, &MF_PD_DURATION) }
                .map_err(|e| failure("Read video asset duration", e))?;
        let container_end = unsafe { PropVariantToUInt64(&duration_value) }
            .map_err(|e| failure("Read video asset duration value", e))?;
        let container_end = i64::try_from(container_end)
            .ok()
            .filter(|duration| *duration > 0)
            .ok_or("Video asset duration is invalid")?;
        unsafe { reader.SetCurrentMediaType(VIDEO_STREAM, None, &native) }
            .map_err(|e| failure("Select compressed video timing probe", e))?;
        let end_hns = video_duration(&reader, container_end, fps)?;
        let requested = unsafe { MFCreateMediaType() }
            .map_err(|e| failure("Create hardware output format", e))?;
        unsafe {
            requested
                .SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)
                .and_then(|_| {
                    requested.SetGUID(
                        &MF_MT_SUBTYPE,
                        if p010 {
                            &MFVideoFormat_P010
                        } else {
                            &MFVideoFormat_NV12
                        },
                    )
                })
                .and_then(|_| reader.SetCurrentMediaType(VIDEO_STREAM, None, &requested))
        }
        .map_err(|e| failure("Negotiate native NV12/P010 hardware output", e))?;
        let mut decoder = Self {
            reader: Some(reader),
            worker: Some(worker),
            manager: Some(manager),
            metadata: VideoMetadata {
                width,
                height,
                fps,
                duration_seconds: end_hns as f64 / HNS_PER_SECOND,
                hardware: false,
            },
            output: OutputFormat {
                width,
                height,
                color_matrix,
                full_range,
                p010,
            },
            pending: None,
            start_hns: 0,
            end_hns,
            last_hns: None,
            ended: false,
            queue_capacity: 2,
            pristine_prime: true,
            _priority: priority,
            _platform: platform,
            _apartment: apartment,
        };
        decoder.refresh_output_format()?;
        Ok(decoder)
    }

    pub fn metadata(&self) -> VideoMetadata {
        self.metadata
    }

    pub fn queue_capacity(&self) -> usize {
        self.queue_capacity
    }

    pub fn set_queue_capacity(&mut self, capacity: usize) -> Result<(), String> {
        if !(1..=24).contains(&capacity) {
            return Err("Windows video queue capacity must be 1 to 24".into());
        }
        // Synchronous ReadSample has at most one application-held decoder
        // sample; the converter separately bounds its GPU submissions.
        self.worker.as_mut().unwrap().set_queue_capacity(capacity)?;
        self.queue_capacity = capacity;
        Ok(())
    }

    pub fn release_unused_gpu_surfaces(&mut self) -> Result<(), String> {
        self.worker.as_mut().unwrap().release_unused_gpu_surfaces()
    }

    /// Call after admitting the first native input/output surfaces to the
    /// handoff budget. No frame is published before real DXVA proof succeeds.
    pub fn prime_hardware(&mut self) -> Result<(), String> {
        if self.metadata.hardware {
            return Ok(());
        }
        let frame = self
            .read_converted_frame()?
            .ok_or("Video contains no hardware-decodable frames")?;
        self.metadata.hardware = true;
        self.pending = Some(frame);
        Ok(())
    }

    pub fn seek(&mut self, start_seconds: f64, end_seconds: Option<f64>) -> Result<(), String> {
        let start = hns(start_seconds)?;
        let end = end_seconds.unwrap_or(self.metadata.duration_seconds);
        let end = if end.is_infinite() && end.is_sign_positive() {
            self.metadata.duration_seconds
        } else {
            end
        };
        let end = hns(end)?.min(hns(self.metadata.duration_seconds)?);
        if end < start {
            return Err("Video trim end precedes its start".into());
        }
        if self.pristine_prime && self.pending.is_some() && start == 0 {
            self.start_hns = start;
            self.end_hns = end;
            self.ended = start == end;
            if self.ended {
                self.pending = None;
            }
            self.pristine_prime = false;
            return Ok(());
        }
        self.pending = None;
        self.pristine_prime = false;
        self.last_hns = None;
        self.start_hns = start;
        self.end_hns = end;
        self.ended = start == end;
        if !self.ended {
            set_position(self.reader.as_ref().unwrap(), start)?;
        }
        Ok(())
    }

    pub fn next_frame(&mut self) -> Result<Option<GpuVideoFrame>, String> {
        if let Some(frame) = self.pending.take() {
            self.pristine_prime = false;
            return Ok(Some(frame));
        }
        if self.ended {
            return Ok(None);
        }
        let frame = self.read_converted_frame()?;
        if frame.is_some() {
            self.metadata.hardware = true;
        }
        Ok(frame)
    }

    /// Select an adjacent actual presentation timestamp. Media Foundation
    /// exposes no compressed sample cursor, so reverse steps scan a bounded,
    /// progressively wider interval using the same persistent Source Reader.
    /// At most the candidate and its successor are retained by this method.
    pub fn step_frame(
        &mut self,
        reference_seconds: f64,
        direction: i32,
        range_start: f64,
        range_end: f64,
    ) -> Result<Option<GpuVideoFrame>, String> {
        // A presentation sample can straddle zero after a container edit;
        // its negative PTS is valid even though a seek request is nonnegative.
        let reference = presentation_hns(reference_seconds)?;
        let range_start_hns = hns(range_start)?;
        if range_end.is_nan() || range_end < range_start {
            return Err("Video frame step requires a valid trim".into());
        }
        let range_end = range_end.min(self.metadata.duration_seconds);
        let range_end_hns = hns(range_end)?;
        if !matches!(direction, -1 | 1) || range_end_hns < range_start_hns {
            return Err("Video frame step requires a valid trim and direction -1 or 1".into());
        }
        if range_start_hns == range_end_hns {
            self.seek(range_start, Some(range_end))?;
            return Ok(None);
        }
        let reference = reference.clamp(range_start_hns, range_end_hns);
        let deadline = Instant::now() + Duration::from_secs(2);
        let mut remaining_samples = 4096usize;
        // This is only a search window, never a guessed frame duration. Long
        // VFR holds expand the window until their real preceding sample exists.
        let mut lookback = 10_000_000i64;
        loop {
            let window_start = if direction > 0 {
                reference
                    .min(range_end_hns.saturating_sub(1))
                    .max(range_start_hns)
            } else {
                reference.saturating_sub(lookback).max(range_start_hns)
            };
            self.seek(window_start as f64 / HNS_PER_SECOND, Some(range_end))?;
            let mut candidate = None;
            while !self.ended || self.pending.is_some() {
                if remaining_samples == 0 || Instant::now() >= deadline {
                    return Err("Video frame step exceeded its bounded seek budget".into());
                }
                remaining_samples -= 1;
                let Some(frame) = self.next_frame()? else {
                    break;
                };
                let frame_pts = presentation_hns(frame.pts_seconds)?;
                if direction > 0 {
                    if frame_pts > reference {
                        return Ok(Some(frame));
                    }
                    candidate = Some(frame);
                } else if frame_pts < reference {
                    candidate = Some(frame);
                } else {
                    if let Some(previous) = candidate {
                        // We read one sample past the answer. Retain it as the
                        // next output rather than decoding or skipping it again.
                        self.pending = Some(frame);
                        return Ok(Some(previous));
                    }
                    if window_start == range_start_hns {
                        return Ok(Some(frame)); // Already at the trim's first frame.
                    }
                    break;
                }
            }
            if candidate.is_some() {
                return Ok(candidate); // Clamp to the last frame at end of range.
            }
            if direction > 0 || window_start == range_start_hns {
                return Ok(None);
            }
            lookback = lookback.saturating_mul(2);
        }
    }

    fn refresh_output_format(&mut self) -> Result<(), String> {
        let output = unsafe {
            self.reader
                .as_ref()
                .unwrap()
                .GetCurrentMediaType(VIDEO_STREAM)
        }
        .map_err(|e| failure("Inspect negotiated hardware output", e))?;
        let (width, height) = validate_geometry(&output)?;
        if (width, height) != (self.metadata.width, self.metadata.height) {
            return Err("Video resolution changes require a new frame memory budget".into());
        }
        let subtype = unsafe { output.GetGUID(&MF_MT_SUBTYPE) }
            .map_err(|e| failure("Inspect hardware output subtype", e))?;
        let expected = if self.output.p010 {
            MFVideoFormat_P010
        } else {
            MFVideoFormat_NV12
        };
        if subtype != expected {
            return Err("Decoder did not preserve the negotiated video bit depth".into());
        }
        let (matrix, range) = color_info(&output, height)?;
        // Decoders sometimes omit color metadata; retain the source values.
        if unsafe { output.GetUINT32(&MF_MT_YUV_MATRIX) }.is_ok() {
            self.output.color_matrix = matrix;
        }
        if unsafe { output.GetUINT32(&MF_MT_VIDEO_NOMINAL_RANGE) }.is_ok() {
            self.output.full_range = range;
        }
        Ok(())
    }

    fn read_converted_frame(&mut self) -> Result<Option<GpuVideoFrame>, String> {
        // Source Reader delivers decoded frames in presentation order. Its
        // documented seek may start at a prior keyframe; discard only frames
        // ending at/before the requested cut, preserving a straddling frame.
        let mut empty_events = 0;
        while !self.ended {
            let mut flags = 0;
            let mut timestamp = 0;
            let mut sample = None;
            unsafe {
                self.reader.as_ref().unwrap().ReadSample(
                    VIDEO_STREAM,
                    0,
                    None,
                    Some(&mut flags),
                    Some(&mut timestamp),
                    Some(&mut sample),
                )
            }
            .map_err(|e| failure("Decode hardware video frame", e))?;
            if flags & MF_SOURCE_READERF_ERROR.0 as u32 != 0 {
                return Err("Media Foundation reported a video decoder error".into());
            }
            if flags & MF_SOURCE_READERF_NATIVEMEDIATYPECHANGED.0 as u32 != 0 {
                return Err(
                    "Compressed video format changes require the compatibility decoder".into(),
                );
            }
            if flags & MF_SOURCE_READERF_CURRENTMEDIATYPECHANGED.0 as u32 != 0 {
                self.refresh_output_format()?;
            }
            if flags & MF_SOURCE_READERF_ENDOFSTREAM.0 as u32 != 0 {
                self.ended = true;
            }
            let Some(sample) = sample else {
                empty_events += 1;
                if empty_events > 1024 {
                    return Err("Hardware video reader made no frame progress".into());
                }
                continue;
            };
            let pts = unsafe { sample.GetSampleTime() }.unwrap_or(timestamp);
            let duration = unsafe { sample.GetSampleDuration() }
                .ok()
                .filter(|duration| *duration > 0)
                .unwrap_or_else(|| (HNS_PER_SECOND / self.metadata.fps).round().max(1.0) as i64);
            if self.last_hns.is_some_and(|previous| pts <= previous) {
                return Err(
                    "Hardware decoder returned non-monotonic presentation timestamps".into(),
                );
            }
            self.last_hns = Some(pts);
            if sample_end(pts, duration).is_none_or(|end| end <= self.start_hns) {
                continue;
            }
            if pts >= self.end_hns {
                self.ended = true;
                return Ok(None);
            }
            if unsafe { sample.GetBufferCount() }
                .map_err(|e| failure("Inspect hardware video sample", e))?
                != 1
            {
                return Err("Hardware video sample does not contain a single DXGI texture".into());
            }
            let buffer = unsafe { sample.GetBufferByIndex(0) }
                .map_err(|e| failure("Read hardware video buffer", e))?;
            let dxgi: IMFDXGIBuffer = buffer.cast().map_err(|_| {
                "Decoder returned CPU video pixels instead of a DXGI decoder surface".to_string()
            })?;
            let mut raw = ptr::null_mut();
            unsafe { dxgi.GetResource(&ID3D11Texture2D::IID, &mut raw) }
                .map_err(|e| failure("Get hardware decoder texture", e))?;
            if raw.is_null() {
                return Err("Hardware decoder returned a null D3D11 texture".into());
            }
            let texture = unsafe { ID3D11Texture2D::from_raw(raw) };
            let subresource = unsafe { dxgi.GetSubresourceIndex() }
                .map_err(|e| failure("Get decoder texture subresource", e))?;
            let mut desc = D3D11_TEXTURE2D_DESC::default();
            unsafe { texture.GetDesc(&mut desc) };
            let expected = if self.output.p010 {
                DXGI_FORMAT_P010
            } else {
                DXGI_FORMAT_NV12
            };
            if desc.Format != expected
                || desc.Usage != D3D11_USAGE_DEFAULT
                || desc.CPUAccessFlags != 0
                || desc.BindFlags & D3D11_BIND_DECODER.0 as u32 == 0
                || desc.MipLevels != 1
                || subresource >= desc.ArraySize
                || desc.Width < self.output.width
                || desc.Height < self.output.height
            {
                return Err(
                    "Video output is not a native, GPU-only NV12/P010 decoder-bound texture".into(),
                );
            }
            let texture_device = unsafe { texture.GetDevice() }
                .map_err(|e| failure("Inspect decoder texture device", e))?;
            let owner: IUnknown = texture_device
                .cast()
                .map_err(|e| failure("Inspect decoder device identity", e))?;
            let expected_owner: IUnknown = self
                .worker
                .as_ref()
                .unwrap()
                .device()
                .cast()
                .map_err(|e| failure("Inspect renderer device identity", e))?;
            if owner.as_raw() != expected_owner.as_raw() {
                return Err(
                    "Hardware video texture belongs to a different renderer adapter/device".into(),
                );
            }
            let metadata = VideoFrameMetadata {
                width: self.output.width,
                height: self.output.height,
                pixel_format: u32::from_be_bytes(if self.output.p010 {
                    *b"P010"
                } else {
                    *b"NV12"
                }),
                color_matrix: self.output.color_matrix,
                full_range: self.output.full_range,
                pts_seconds: pts as f64 / HNS_PER_SECOND,
                duration_seconds: duration as f64 / HNS_PER_SECOND,
            };
            let converted =
                self.worker
                    .as_mut()
                    .unwrap()
                    .convert(&sample, &texture, subresource, metadata)?;
            return Ok(Some(converted));
        }
        Ok(None)
    }
}

impl Drop for WindowsVideoDecoder {
    fn drop(&mut self) {
        self.pending = None;
        if let Some(reader) = self.reader.take() {
            let _ = unsafe { reader.Flush(VIDEO_STREAM) };
            drop(reader);
        }
        // Worker drains its conversion fence and releases source IMFSamples.
        self.worker = None;
        self.manager = None;
        // Field teardown then shuts down MF and balances COM on this worker.
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "requires a Windows hardware GPU and GHOST_TEST_WINDOWS_STEP_PATH fixture"]
    fn hardware_steps_actual_samples_and_preserves_successor() {
        let path = std::env::var_os("GHOST_TEST_WINDOWS_STEP_PATH")
            .expect("Set GHOST_TEST_WINDOWS_STEP_PATH to a short B-frame or VFR fixture");
        let mut descriptor = wgpu::InstanceDescriptor::new_without_display_handle();
        descriptor.backends = wgpu::Backends::DX12;
        let instance = wgpu::Instance::new(descriptor);
        let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::HighPerformance,
            force_fallback_adapter: false,
            compatible_surface: None,
            apply_limit_buckets: false,
        }))
        .unwrap();
        let (device, _queue) =
            pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor::default())).unwrap();
        let context = WindowsVideoDevice::new(&device).unwrap();
        let mut decoder =
            WindowsVideoDecoder::open_with_device(Path::new(&path), &context).unwrap();
        decoder.prime_hardware().unwrap();
        let mut timestamps = Vec::new();
        while let Some(frame) = decoder.next_frame().unwrap() {
            timestamps.push(frame.pts_seconds);
        }
        assert!(timestamps.len() > 8);
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
                    assert_eq!(frame.pts_seconds, timestamps[expected]);
                    let next = decoder.next_frame().unwrap();
                    if expected < last {
                        assert_eq!(next.unwrap().pts_seconds, timestamps[expected + 1]);
                    } else {
                        assert!(next.is_none());
                    }
                }
            }
        }
    }

    #[test]
    fn source_timestamps_keep_subframe_seek_precision() {
        assert_eq!(hns(0.517).unwrap(), 5_170_000);
        assert_eq!(hns(8.0).unwrap(), 80_000_000);
        assert!(hns(f64::NAN).is_err());
        assert!(hns(f64::INFINITY).is_err());
        assert!(hns(-0.1).is_err());
        assert_eq!(presentation_hns(-0.1).unwrap(), -1_000_000);
        for timestamp in [-333_333i64, 0, 333_333, 666_667, 300_300_000] {
            assert_eq!(
                presentation_hns(timestamp as f64 / HNS_PER_SECOND).unwrap(),
                timestamp
            );
        }
    }

    #[test]
    fn compressed_tail_uses_presentation_end_not_decode_order() {
        let reordered = [(0, 10), (30, 10), (10, 10), (20, 10)];
        assert_eq!(
            reordered
                .into_iter()
                .filter_map(|(pts, duration)| sample_end(pts, duration))
                .max(),
            Some(40)
        );
        assert_eq!(sample_end(i64::MAX, 1), None);
        assert_eq!(sample_end(3, 0), None);
    }

    #[test]
    fn media_foundation_dimensions_and_rates_unpack_without_float_loss() {
        assert_eq!(unpack_ratio((960u64 << 32) | 540), (960, 540));
        assert_eq!(unpack_ratio((30000u64 << 32) | 1001), (30000, 1001));
    }

    #[test]
    fn media_foundation_color_metadata_preserves_supported_sdr_spaces() {
        let _apartment = ComApartment::initialize().unwrap();
        let _platform = MediaPlatform::initialize().unwrap();
        let media_type = unsafe { MFCreateMediaType() }.unwrap();
        // Missing attributes follow the documented SD/HD, limited-range
        // inference. Explicit primaries must agree with the selected matrix.
        assert_eq!(color_info(&media_type, 480).unwrap(), (1, false));
        assert_eq!(color_info(&media_type, 1080).unwrap(), (2, false));
        for (matrix, primaries, transfer, expected) in [(1, 2, 5, 2), (2, 5, 5, 1), (4, 9, 13, 3)] {
            unsafe {
                media_type.SetUINT32(&MF_MT_YUV_MATRIX, matrix).unwrap();
                media_type
                    .SetUINT32(&MF_MT_VIDEO_PRIMARIES, primaries)
                    .unwrap();
                media_type
                    .SetUINT32(&MF_MT_TRANSFER_FUNCTION, transfer)
                    .unwrap();
                media_type.SetUINT32(&MF_MT_VIDEO_NOMINAL_RANGE, 2).unwrap();
            }
            assert_eq!(color_info(&media_type, 1080).unwrap(), (expected, false));
            unsafe { media_type.SetUINT32(&MF_MT_VIDEO_NOMINAL_RANGE, 1) }.unwrap();
            assert_eq!(color_info(&media_type, 1080).unwrap(), (expected, true));
        }
    }

    #[test]
    fn media_foundation_color_metadata_rejects_unrepresented_colors() {
        let _apartment = ComApartment::initialize().unwrap();
        let _platform = MediaPlatform::initialize().unwrap();
        let media_type = unsafe { MFCreateMediaType() }.unwrap();
        unsafe {
            media_type.SetUINT32(&MF_MT_YUV_MATRIX, 1).unwrap();
            media_type.SetUINT32(&MF_MT_VIDEO_PRIMARIES, 2).unwrap();
        }
        for transfer in [1, 8, 12, 15, 16] {
            unsafe { media_type.SetUINT32(&MF_MT_TRANSFER_FUNCTION, transfer) }.unwrap();
            assert!(color_info(&media_type, 1080).is_err());
        }
        unsafe {
            media_type.SetUINT32(&MF_MT_TRANSFER_FUNCTION, 5).unwrap();
            media_type.SetUINT32(&MF_MT_VIDEO_PRIMARIES, 9).unwrap();
        }
        assert!(
            color_info(&media_type, 1080)
                .unwrap_err()
                .contains("primaries")
        );
        unsafe { media_type.SetUINT32(&MF_MT_YUV_MATRIX, 5) }.unwrap();
        assert!(
            color_info(&media_type, 1080)
                .unwrap_err()
                .contains("matrix")
        );
        unsafe {
            media_type.SetUINT32(&MF_MT_YUV_MATRIX, 4).unwrap();
            media_type.SetUINT32(&MF_MT_TRANSFER_FUNCTION, 13).unwrap();
            media_type.SetUINT32(&MF_MT_VIDEO_NOMINAL_RANGE, 3).unwrap();
        }
        assert!(color_info(&media_type, 1080).unwrap_err().contains("range"));
    }
}
