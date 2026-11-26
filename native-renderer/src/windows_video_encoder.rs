#![cfg(target_os = "windows")]
//! GPU-side H.264 recording for Windows.
//!
//! The live recorder used to read the composite back to system memory every
//! frame -- 1920x1080x4 = 8.3MB, ~250MB/s at 30fps -- pipe it to ffmpeg, and
//! let ffmpeg upload it to the GPU again for NVENC. The pixels were already on
//! the GPU and the encoder is on the GPU; the detour through the CPU existed
//! only because the encoder lived in another process.
//!
//! This encodes in the core, from the output shared texture it already owns.
//! Nothing crosses the bus: `OpenSharedResourceByName` gives D3D11 the same
//! surface D3D12 rendered into, a VideoProcessor converts BGRA to NV12 on the
//! GPU, and the sample handed to `IMFSinkWriter` wraps that texture directly.
//! Media Foundation picks the hardware H.264 MFT (NVENC/QSV/AMF) because the
//! writer is given the renderer's own device through an `IMFDXGIDeviceManager`.
//!
//! The render thread only queues GPU work: it orders the conversion after the
//! frame (a shared fence), converts into a free NV12 texture from a small ring
//! and makes the renderer's later frames wait, on the GPU, until the
//! conversion has read the export. `IMFSinkWriter::WriteSample`, which can
//! block on the encoder and the disk, runs on the recorder's own thread. Each
//! NV12 texture stays out of the ring until Media Foundation releases the
//! sample that wraps it (a tracked sample calls back), so a texture is never
//! overwritten while the encoder may still read it. With every texture taken
//! the frame is dropped and counted, like the macOS recorder does; the render
//! thread never waits for the encoder.
//!
//! Audio is unchanged: the file is a normal MP4, so the existing Electron-side
//! remux still copies the video stream bit-for-bit and adds the audio track.

use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{Receiver, Sender, channel};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Instant;

use wgpu::hal::api::Dx12;
use windows::core::{IUnknown, Interface, PCWSTR, Ref, implement};
use windows::Win32::Foundation::{CloseHandle, E_NOTIMPL, GENERIC_ALL};
use windows::Win32::Graphics::Direct3D11::*;
use windows::Win32::Graphics::Direct3D12::{D3D12_FENCE_FLAG_SHARED, ID3D12Device, ID3D12Fence};
use windows::Win32::Graphics::Dxgi::Common::*;
use windows::Win32::Media::MediaFoundation::*;
use windows::Win32::System::Com::{COINIT_MULTITHREADED, CoInitializeEx, CoUninitialize};
// Resolved at runtime, so a PC without Media Foundation still starts the core.
use crate::windows_media_foundation::{
    MFCreateAttributes, MFCreateDXGIDeviceManager, MFCreateDXGISurfaceBuffer, MFCreateMediaType,
    MFCreateSinkWriterFromURL, MFCreateTrackedSample, MFShutdown, MFStartup,
};

/// DXGI_SHARED_RESOURCE_READ. Not re-exported by the `windows` crate's D3D11
/// module, and the encoder only ever reads the composite.
const SHARED_RESOURCE_READ: u32 = 0x8000_0000;

/// 100-nanosecond units: Media Foundation's timebase.
const HNS_PER_SECOND: i64 = 10_000_000;

/// NV12 textures the encoder can hold at once. Hardware encoders keep a
/// couple of input frames while they work; four gives them room without
/// holding much memory (3 MB each at 1080p).
const RING_SLOTS: usize = 4;

fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

fn mf_error(operation: &str, error: windows::core::Error) -> String {
    format!("native recording: {operation} failed ({error})")
}

/// Bitrate for a quality tier, matching the tiers the Electron recorder used
/// so a take does not change character when the native path takes over.
fn bitrate_for(quality: &str, width: u32, height: u32, fps: u32) -> u32 {
    let tier = match quality {
        "archive" => 40_000_000u64,
        "web" => 8_000_000,
        _ => 20_000_000,
    };
    // Those numbers are tuned for 1080p30. Scale by pixel rate so 4K or 60fps
    // is not starved, and clamp to what H.264 level 5.2 will carry.
    let reference = 1920u64 * 1080 * 30;
    let actual = (width as u64) * (height as u64) * (fps.max(1) as u64);
    let scaled = tier.saturating_mul(actual) / reference.max(1);
    scaled.clamp(2_000_000, 240_000_000) as u32
}

/// The first texture after `start` (round robin) that the encoder has let go.
fn free_slot(busy: &[AtomicBool], start: usize) -> Option<usize> {
    (0..busy.len())
        .map(|offset| (start + offset) % busy.len())
        .find(|&slot| !busy[slot].load(Ordering::Acquire))
}

/// Between the render thread and the encoder thread.
struct Shared {
    /// A texture is busy from its conversion until Media Foundation releases
    /// the sample that wraps it.
    busy: Vec<AtomicBool>,
    encoded: AtomicU64,
    error: Mutex<Option<String>>,
}

/// Called by Media Foundation when the last reference to a tracked sample
/// goes: the encoder has finished with that sample's texture.
#[implement(IMFAsyncCallback)]
struct SlotRelease {
    shared: Arc<Shared>,
    slot: usize,
}

impl IMFAsyncCallback_Impl for SlotRelease_Impl {
    fn GetParameters(&self, _flags: *mut u32, _queue: *mut u32) -> windows::core::Result<()> {
        // Optional: the default work queue is fine.
        Err(E_NOTIMPL.into())
    }

    fn Invoke(&self, _result: Ref<IMFAsyncResult>) -> windows::core::Result<()> {
        self.shared.busy[self.slot].store(false, Ordering::Release);
        Ok(())
    }
}

struct Job {
    slot: usize,
    time: i64,
    duration: i64,
}

/// What the encoder thread owns. Media Foundation and D3D11 objects are
/// free-threaded; the `windows` crate just does not say so.
struct EncoderThread {
    writer: IMFSinkWriter,
    stream: u32,
    textures: Vec<ID3D11Texture2D>,
    shared: Arc<Shared>,
}

unsafe impl Send for EncoderThread {}

impl EncoderThread {
    fn run(self, jobs: Receiver<Job>) -> Result<(), String> {
        // Media Foundation's own threads are MTA; join them.
        let com = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }.is_ok();
        let mut failed: Option<String> = None;
        // Ends when the recorder drops its sender (stop), after every frame
        // already queued has been written.
        for job in jobs.iter() {
            if failed.is_some() {
                self.shared.busy[job.slot].store(false, Ordering::Release);
                continue;
            }
            match unsafe { self.write(&job) } {
                Ok(()) => {
                    self.shared.encoded.fetch_add(1, Ordering::Relaxed);
                }
                Err(err) => {
                    self.shared.busy[job.slot].store(false, Ordering::Release);
                    if let Ok(mut slot) = self.shared.error.lock() {
                        *slot = Some(err.clone());
                    }
                    failed = Some(err);
                }
            }
        }
        // Without this the file has no moov atom and will not open anywhere.
        let finalized = unsafe { self.writer.Finalize() }
            .map_err(|e| mf_error("IMFSinkWriter::Finalize", e));
        drop(self);
        if com {
            unsafe { CoUninitialize() };
        }
        match failed {
            Some(err) => Err(err),
            None => finalized,
        }
    }

    unsafe fn write(&self, job: &Job) -> Result<(), String> {
        unsafe {
            // Wrap the NV12 texture as a sample; no copy, no readback.
            let buffer =
                MFCreateDXGISurfaceBuffer(&ID3D11Texture2D::IID, &self.textures[job.slot], 0, false)
                    .map_err(|e| mf_error("MFCreateDXGISurfaceBuffer", e))?;
            if let Ok(len) = buffer.cast::<IMF2DBuffer>().and_then(|b| b.GetContiguousLength()) {
                let _ = buffer.SetCurrentLength(len);
            }
            let tracked = MFCreateTrackedSample().map_err(|e| mf_error("MFCreateTrackedSample", e))?;
            let release: IMFAsyncCallback = SlotRelease {
                shared: Arc::clone(&self.shared),
                slot: job.slot,
            }
            .into();
            tracked
                .SetAllocator(&release, None::<&IUnknown>)
                .map_err(|e| mf_error("IMFTrackedSample::SetAllocator", e))?;
            let sample: IMFSample = tracked.cast().map_err(|e| mf_error("query IMFSample", e))?;
            sample
                .AddBuffer(&buffer)
                .map_err(|e| mf_error("IMFSample::AddBuffer", e))?;
            sample
                .SetSampleTime(job.time)
                .map_err(|e| mf_error("IMFSample::SetSampleTime", e))?;
            sample
                .SetSampleDuration(job.duration)
                .map_err(|e| mf_error("IMFSample::SetSampleDuration", e))?;
            self.writer
                .WriteSample(self.stream, &sample)
                .map_err(|e| mf_error("IMFSinkWriter::WriteSample", e))?;
            // Our references go here; the slot frees when the encoder's do.
            Ok(())
        }
    }
}

struct Slot {
    output_view: ID3D11VideoProcessorOutputView,
}

/// A D3D12 fence shared with the encoder's D3D11 device.
unsafe fn shared_fence(
    device12: &ID3D12Device,
    device5: &ID3D11Device5,
    what: &str,
) -> Result<(ID3D12Fence, ID3D11Fence), String> {
    unsafe {
        let fence12: ID3D12Fence = device12
            .CreateFence(0, D3D12_FENCE_FLAG_SHARED)
            .map_err(|e| mf_error(&format!("create shared {what} fence"), e))?;
        let shared = device12
            .CreateSharedHandle(&fence12, None, GENERIC_ALL.0, PCWSTR::null())
            .map_err(|e| mf_error(&format!("export {what} fence"), e))?;
        let mut fence11 = None;
        let opened = device5.OpenSharedFence(shared, &mut fence11);
        // D3D11 holds its own reference once the fence is open; the
        // exported NT handle is ours to close either way.
        let _ = CloseHandle(shared);
        opened.map_err(|e| mf_error(&format!("open {what} fence on D3D11"), e))?;
        let fence11 = fence11
            .ok_or_else(|| format!("native recording: D3D11 returned no shared {what} fence"))?;
        Ok((fence12, fence11))
    }
}

pub struct WindowsVideoEncoder {
    device: ID3D11Device,
    context: ID3D11DeviceContext4,
    /// Media Foundation drives the same immediate context from its threads.
    multithread: ID3D11Multithread,
    video_device: ID3D11VideoDevice,
    video_context: ID3D11VideoContext,
    enumerator: ID3D11VideoProcessorEnumerator,
    processor: ID3D11VideoProcessor,
    slots: Vec<Slot>,
    next_slot: usize,
    source: Option<(String, ID3D11Texture2D)>,
    /// D3D12 renders the composite, D3D11 encodes it. Nothing orders those
    /// two devices by itself, so the conversion waits for the frame
    /// (`frame_done`, D3D12 signals) and the renderer's later frames wait for
    /// the conversion to have read the export (`export_read`, D3D11
    /// signals). Both waits are on the GPU; neither thread stalls.
    wgpu_device: wgpu::Device,
    frame_done12: ID3D12Fence,
    frame_done11: ID3D11Fence,
    export_read12: ID3D12Fence,
    export_read11: ID3D11Fence,
    fence_value: u64,
    fps: u32,
    /// Wall clock for pacing. The core renders as fast as it can (165fps on a
    /// high-refresh panel); stamping every rendered frame at 1/fps made a
    /// 3-second take play back as 6 seconds of slow motion.
    started: Option<Instant>,
    last_index: Option<u64>,
    /// Last frame handed to the encoder thread: the end of the file.
    last_queued_index: Option<u64>,
    dropped: u64,
    render_thread_ns: u64,
    render_thread_max_ns: u64,
    render_thread_frames: u64,
    shared: Arc<Shared>,
    jobs: Option<Sender<Job>>,
    thread: Option<JoinHandle<Result<(), String>>>,
    finished: Option<Result<(), String>>,
}

impl WindowsVideoEncoder {
    /// `device` must be the same-adapter D3D11 device the renderer's D3D12
    /// device produced (see WindowsVideoDevice); the sink writer is handed
    /// that device, so a different adapter would silently fall back to a
    /// software MFT and defeat the whole exercise.
    pub fn new(
        device: &ID3D11Device,
        wgpu_device: &wgpu::Device,
        path: &Path,
        width: u32,
        height: u32,
        fps: u32,
        quality: &str,
    ) -> Result<Self, String> {
        if width == 0 || height == 0 {
            return Err("native recording: refusing a zero-sized recording".into());
        }
        // H.264 requires even dimensions, and NV12 chroma is half-resolution.
        if width % 2 != 0 || height % 2 != 0 {
            return Err(format!(
                "native recording: {width}x{height} is not an even size; H.264 needs both dimensions even"
            ));
        }
        let fps = fps.clamp(1, 240);

        unsafe {
            MFStartup(MF_VERSION, MFSTARTUP_NOSOCKET).map_err(|e| mf_error("MFStartup", e))?;
            // From here on a failure must still shut Media Foundation down.
            let built = Self::build(device, wgpu_device, path, width, height, fps, quality);
            if built.is_err() {
                let _ = MFShutdown();
            }
            built
        }
    }

    unsafe fn build(
        device: &ID3D11Device,
        wgpu_device: &wgpu::Device,
        path: &Path,
        width: u32,
        height: u32,
        fps: u32,
        quality: &str,
    ) -> Result<Self, String> {
        unsafe {
            let immediate = device
                .GetImmediateContext()
                .map_err(|e| mf_error("get D3D11 immediate context", e))?;
            // MF drives the device from its own threads.
            let multithread: ID3D11Multithread = immediate
                .cast()
                .map_err(|e| mf_error("query ID3D11Multithread", e))?;
            let _ = multithread.SetMultithreadProtected(true);
            let context: ID3D11DeviceContext4 = immediate
                .cast()
                .map_err(|e| mf_error("query ID3D11DeviceContext4", e))?;

            // Handing the writer the renderer's device is what selects the
            // hardware encoder and lets samples stay as textures.
            let mut reset_token = 0u32;
            let mut manager: Option<IMFDXGIDeviceManager> = None;
            MFCreateDXGIDeviceManager(&mut reset_token, &mut manager)
                .map_err(|e| mf_error("MFCreateDXGIDeviceManager", e))?;
            let manager = manager
                .ok_or_else(|| "native recording: no DXGI device manager".to_string())?;
            manager
                .ResetDevice(device, reset_token)
                .map_err(|e| mf_error("IMFDXGIDeviceManager::ResetDevice", e))?;

            let mut attributes: Option<IMFAttributes> = None;
            MFCreateAttributes(&mut attributes, 4).map_err(|e| mf_error("MFCreateAttributes", e))?;
            let attributes =
                attributes.ok_or_else(|| "native recording: no sink attributes".to_string())?;
            attributes
                .SetUINT32(&MF_READWRITE_ENABLE_HARDWARE_TRANSFORMS, 1)
                .map_err(|e| mf_error("enable hardware transforms", e))?;
            attributes
                .SetUnknown(&MF_SINK_WRITER_D3D_MANAGER, &manager)
                .map_err(|e| mf_error("bind D3D manager", e))?;
            // Live capture: never trade latency for compression efficiency.
            let _ = attributes.SetUINT32(&MF_LOW_LATENCY, 1);

            let url = wide(&path.to_string_lossy());
            let writer = MFCreateSinkWriterFromURL(
                PCWSTR::from_raw(url.as_ptr()),
                None,
                &attributes,
            )
            .map_err(|e| mf_error("MFCreateSinkWriterFromURL", e))?;

            // Output: H.264 in the MP4 the sink writer is building.
            let out_type = MFCreateMediaType().map_err(|e| mf_error("create output type", e))?;
            out_type
                .SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)
                .map_err(|e| mf_error("set output major type", e))?;
            out_type
                .SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_H264)
                .map_err(|e| mf_error("set output subtype", e))?;
            out_type
                .SetUINT32(&MF_MT_AVG_BITRATE, bitrate_for(quality, width, height, fps))
                .map_err(|e| mf_error("set bitrate", e))?;
            out_type
                .SetUINT32(&MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive.0 as u32)
                .map_err(|e| mf_error("set interlace mode", e))?;
            // Without this the sink writer settles on Constrained Baseline,
            // which is the software MFT's default and gives up both quality
            // and B-frames. High is what every hardware H.264 encoder does.
            let _ = out_type.SetUINT32(&MF_MT_MPEG2_PROFILE, eAVEncH264VProfile_High.0 as u32);
            set_frame_size(&out_type, width, height)?;
            set_ratio(&out_type, &MF_MT_FRAME_RATE, fps, 1)?;
            set_ratio(&out_type, &MF_MT_PIXEL_ASPECT_RATIO, 1, 1)?;
            let stream = writer
                .AddStream(&out_type)
                .map_err(|e| mf_error("AddStream", e))?;

            // Input: NV12 textures produced by the VideoProcessor below.
            let in_type = MFCreateMediaType().map_err(|e| mf_error("create input type", e))?;
            in_type
                .SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)
                .map_err(|e| mf_error("set input major type", e))?;
            in_type
                .SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_NV12)
                .map_err(|e| mf_error("set input subtype", e))?;
            in_type
                .SetUINT32(&MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive.0 as u32)
                .map_err(|e| mf_error("set input interlace mode", e))?;
            set_frame_size(&in_type, width, height)?;
            set_ratio(&in_type, &MF_MT_FRAME_RATE, fps, 1)?;
            set_ratio(&in_type, &MF_MT_PIXEL_ASPECT_RATIO, 1, 1)?;
            writer
                .SetInputMediaType(stream, &in_type, None)
                .map_err(|e| mf_error("SetInputMediaType", e))?;

            writer.BeginWriting().map_err(|e| mf_error("BeginWriting", e))?;

            let video_device: ID3D11VideoDevice = device
                .cast()
                .map_err(|e| mf_error("query ID3D11VideoDevice", e))?;
            let video_context: ID3D11VideoContext = immediate
                .cast()
                .map_err(|e| mf_error("query ID3D11VideoContext", e))?;

            let content_desc = D3D11_VIDEO_PROCESSOR_CONTENT_DESC {
                InputFrameFormat: D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE,
                InputFrameRate: DXGI_RATIONAL { Numerator: fps, Denominator: 1 },
                InputWidth: width,
                InputHeight: height,
                OutputFrameRate: DXGI_RATIONAL { Numerator: fps, Denominator: 1 },
                OutputWidth: width,
                OutputHeight: height,
                Usage: D3D11_VIDEO_USAGE_PLAYBACK_NORMAL,
            };
            let enumerator = video_device
                .CreateVideoProcessorEnumerator(&content_desc)
                .map_err(|e| mf_error("CreateVideoProcessorEnumerator", e))?;
            let processor = video_device
                .CreateVideoProcessor(&enumerator, 0)
                .map_err(|e| mf_error("CreateVideoProcessor", e))?;
            // The composite is opaque sRGB; say so rather than letting the
            // driver guess, or the recording comes out in the wrong range.
            video_context.VideoProcessorSetStreamFrameFormat(
                &processor,
                0,
                D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE,
            );
            let _ = video_context.VideoProcessorSetStreamAutoProcessingMode(&processor, 0, false);

            // The ring of NV12 destinations the sink writer reads. Made once:
            // allocating per frame would defeat the point of staying on the GPU.
            let mut textures = Vec::with_capacity(RING_SLOTS);
            let mut slots = Vec::with_capacity(RING_SLOTS);
            for _ in 0..RING_SLOTS {
                let mut nv12 = None;
                device
                    .CreateTexture2D(
                        &D3D11_TEXTURE2D_DESC {
                            Width: width,
                            Height: height,
                            MipLevels: 1,
                            ArraySize: 1,
                            Format: DXGI_FORMAT_NV12,
                            SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
                            Usage: D3D11_USAGE_DEFAULT,
                            BindFlags: (D3D11_BIND_RENDER_TARGET.0 | D3D11_BIND_SHADER_RESOURCE.0) as u32,
                            CPUAccessFlags: 0,
                            MiscFlags: 0,
                        },
                        None,
                        Some(&mut nv12),
                    )
                    .map_err(|e| mf_error("create NV12 encode target", e))?;
                let nv12 = nv12.ok_or_else(|| "native recording: no NV12 texture".to_string())?;
                let desc = D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC {
                    ViewDimension: D3D11_VPOV_DIMENSION_TEXTURE2D,
                    Anonymous: D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC_0 {
                        Texture2D: D3D11_TEX2D_VPOV { MipSlice: 0 },
                    },
                };
                let mut view = None;
                video_device
                    .CreateVideoProcessorOutputView(&nv12, &enumerator, &desc, Some(&mut view))
                    .map_err(|e| mf_error("CreateVideoProcessorOutputView", e))?;
                let output_view =
                    view.ok_or_else(|| "native recording: no processor output view".to_string())?;
                textures.push(nv12);
                slots.push(Slot { output_view });
            }

            let raw12 = wgpu_device
                .as_hal::<Dx12>()
                .ok_or_else(|| "native recording requires the renderer's D3D12 device".to_string())?;
            let device5: ID3D11Device5 = device
                .cast()
                .map_err(|e| mf_error("query ID3D11Device5 for fences", e))?;
            let (frame_done12, frame_done11) = shared_fence(raw12.raw_device(), &device5, "render")?;
            let (export_read12, export_read11) =
                shared_fence(raw12.raw_device(), &device5, "export read")?;
            drop(raw12);

            let shared = Arc::new(Shared {
                busy: (0..RING_SLOTS).map(|_| AtomicBool::new(false)).collect(),
                encoded: AtomicU64::new(0),
                error: Mutex::new(None),
            });
            let (jobs, receiver) = channel::<Job>();
            let encoder_thread = EncoderThread {
                writer,
                stream,
                textures,
                shared: Arc::clone(&shared),
            };
            let thread = std::thread::Builder::new()
                .name("ghost-windows-recorder".to_string())
                .spawn(move || encoder_thread.run(receiver))
                .map_err(|e| format!("native recording: could not start the encoder thread ({e})"))?;

            Ok(Self {
                device: device.clone(),
                context,
                multithread,
                video_device,
                video_context,
                enumerator,
                processor,
                slots,
                next_slot: 0,
                source: None,
                wgpu_device: wgpu_device.clone(),
                frame_done12,
                frame_done11,
                export_read12,
                export_read11,
                fence_value: 0,
                fps,
                started: None,
                last_index: None,
                last_queued_index: None,
                dropped: 0,
                render_thread_ns: 0,
                render_thread_max_ns: 0,
                render_thread_frames: 0,
                shared,
                jobs: Some(jobs),
                thread: Some(thread),
                finished: None,
            })
        }
    }

    /// Encode one frame from the core's named output shared texture.
    ///
    /// `shared_name` is the same name the preview and Spout open, so the
    /// encoder reads exactly the composite that went to screen rather than a
    /// second render of it. Call right after the frame that wrote it was
    /// submitted.
    pub fn encode_shared_texture(&mut self, shared_name: &str) -> Result<(), String> {
        let source = unsafe { self.source_texture(shared_name)? };
        self.encode_texture(&source)
    }

    /// Encode one frame from a BGRA texture on the encoder's D3D11 device.
    pub fn encode_texture(&mut self, source: &ID3D11Texture2D) -> Result<(), String> {
        if self.finished.is_some() {
            return Err("native recording: encoder already finished".into());
        }
        if let Some(err) = self.shared.error.lock().ok().and_then(|error| error.clone()) {
            return Err(err);
        }
        let call_started = Instant::now();
        // Which output frame does *now* belong to? Renders that land inside a
        // slot already written are dropped, so the file stays in step with
        // real time however fast the core happens to be running.
        let started = *self.started.get_or_insert(call_started);
        let elapsed = started.elapsed().as_secs_f64();
        let index = (elapsed * self.fps as f64).floor().max(0.0) as u64;
        if let Some(last) = self.last_index {
            if index <= last {
                return Ok(());
            }
        }
        self.last_index = Some(index);

        // Every texture still with the encoder: drop this frame rather than
        // wait for it (disk or encoder backpressure must not stall a show).
        let Some(slot) = free_slot(&self.shared.busy, self.next_slot) else {
            self.dropped += 1;
            return Ok(());
        };
        self.next_slot = (slot + 1) % self.slots.len();
        self.shared.busy[slot].store(true, Ordering::Release);
        if let Err(err) = unsafe { self.convert(slot, source) } {
            self.shared.busy[slot].store(false, Ordering::Release);
            return Err(err);
        }
        // Constant cadence: a recording that drifts against its own frame
        // rate is unusable in an NLE even when every frame is present. The
        // time is the render time's slot, not when the encoder gets to it.
        let duration = HNS_PER_SECOND / self.fps.max(1) as i64;
        let job = Job { slot, time: index as i64 * duration, duration };
        let sent = self.jobs.as_ref().is_some_and(|jobs| jobs.send(job).is_ok());
        if !sent {
            self.shared.busy[slot].store(false, Ordering::Release);
            return Err(self
                .shared
                .error
                .lock()
                .ok()
                .and_then(|error| error.clone())
                .unwrap_or_else(|| "native recording: the encoder thread stopped".to_string()));
        }
        self.last_queued_index = Some(index);
        let spent = call_started.elapsed().as_nanos().min(u64::MAX as u128) as u64;
        self.render_thread_ns = self.render_thread_ns.saturating_add(spent);
        self.render_thread_max_ns = self.render_thread_max_ns.max(spent);
        self.render_thread_frames += 1;
        Ok(())
    }

    /// BGRA -> NV12 into `slot`, ordered after the frame on the GPU, with the
    /// renderer's later frames ordered after this read. Only queues GPU work.
    unsafe fn convert(&mut self, slot: usize, source: &ID3D11Texture2D) -> Result<(), String> {
        unsafe {
            self.fence_value += 1;
            let value = self.fence_value;
            {
                let raw12 = self.wgpu_device.as_hal::<Dx12>().ok_or_else(|| {
                    "native recording lost the renderer's D3D12 device".to_string()
                })?;
                raw12
                    .raw_queue()
                    .Signal(&self.frame_done12, value)
                    .map_err(|e| mf_error("signal render fence", e))?;
            }

            self.multithread.Enter();
            let queued = self.queue_conversion(slot, source, value);
            self.multithread.Leave();
            queued?;

            // Everything the renderer submits from now on (the next frame's
            // write to the export included) waits until the conversion above
            // has read the export. Only after D3D11 has the signal queued, or
            // the D3D12 queue could wait forever.
            let raw12 = self
                .wgpu_device
                .as_hal::<Dx12>()
                .ok_or_else(|| "native recording lost the renderer's D3D12 device".to_string())?;
            raw12
                .raw_queue()
                .Wait(&self.export_read12, value)
                .map_err(|e| mf_error("order the next frame after the encoder's read", e))?;
            Ok(())
        }
    }

    /// The D3D11 half of `convert`, under the device lock.
    unsafe fn queue_conversion(
        &self,
        slot: usize,
        source: &ID3D11Texture2D,
        value: u64,
    ) -> Result<(), String> {
        unsafe {
            let input_view = {
                let desc = D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC {
                    FourCC: 0,
                    ViewDimension: D3D11_VPIV_DIMENSION_TEXTURE2D,
                    Anonymous: D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC_0 {
                        Texture2D: D3D11_TEX2D_VPIV { MipSlice: 0, ArraySlice: 0 },
                    },
                };
                let mut view = None;
                self.video_device
                    .CreateVideoProcessorInputView(source, &self.enumerator, &desc, Some(&mut view))
                    .map_err(|e| mf_error("CreateVideoProcessorInputView", e))?;
                view.ok_or_else(|| "native recording: no processor input view".to_string())?
            };

            // Read the export only once the frame that wrote it is done.
            self.context
                .Wait(&self.frame_done11, value)
                .map_err(|e| mf_error("wait on render fence", e))?;

            // BGRA -> NV12, on the GPU.
            let mut stream = D3D11_VIDEO_PROCESSOR_STREAM {
                Enable: true.into(),
                OutputIndex: 0,
                InputFrameOrField: 0,
                PastFrames: 0,
                FutureFrames: 0,
                pInputSurface: std::mem::ManuallyDrop::new(Some(input_view.clone())),
                ..Default::default()
            };
            let blt = self.video_context.VideoProcessorBlt(
                &self.processor,
                &self.slots[slot].output_view,
                0,
                std::slice::from_ref(&stream),
            );
            // The stream struct holds its own reference to the input view and
            // never releases it by itself; without this every recorded frame
            // leaked a view that kept the shared composite alive.
            std::mem::ManuallyDrop::drop(&mut stream.pInputSurface);
            if let Err(e) = blt {
                // The wait above is already queued; let it go so the next
                // conversion's wait is not stuck behind it.
                self.context.Flush();
                return Err(mf_error("VideoProcessorBlt (BGRA->NV12)", e));
            }
            self.context
                .Signal(&self.export_read11, value)
                .map_err(|e| mf_error("signal the encoder's read", e))?;
            self.context.Flush();
            Ok(())
        }
    }

    /// Open (and cache) the shared composite in this D3D11 device.
    unsafe fn source_texture(&mut self, shared_name: &str) -> Result<ID3D11Texture2D, String> {
        if let Some((name, texture)) = &self.source {
            if name == shared_name {
                return Ok(texture.clone());
            }
        }
        let device1: ID3D11Device1 = self
            .device
            .cast()
            .map_err(|e| mf_error("query ID3D11Device1", e))?;
        let name = wide(shared_name);
        let texture: ID3D11Texture2D = unsafe {
            device1
                .OpenSharedResourceByName(PCWSTR::from_raw(name.as_ptr()), SHARED_RESOURCE_READ)
        }
        .map_err(|e| mf_error(&format!("OpenSharedResourceByName(\"{shared_name}\")"), e))?;
        self.source = Some((shared_name.to_string(), texture.clone()));
        Ok(texture)
    }

    /// Frames written to the file so far (final once `finish` returns).
    pub fn frames_encoded(&self) -> u64 {
        self.shared.encoded.load(Ordering::Relaxed)
    }

    /// Frames skipped because the encoder still held every texture.
    pub fn frames_dropped(&self) -> u64 {
        self.dropped
    }

    /// Render-thread time per recorded frame: (mean, max) in microseconds.
    pub fn render_thread_us(&self) -> (f64, f64) {
        if self.render_thread_frames == 0 {
            return (0.0, 0.0);
        }
        (
            self.render_thread_ns as f64 / self.render_thread_frames as f64 / 1000.0,
            self.render_thread_max_ns as f64 / 1000.0,
        )
    }

    /// Real duration of the take. Frame count is not it: a static scene makes
    /// the core render rarely, so the file can hold three frames spread
    /// across five seconds. The last timestamp is what a player sees.
    pub fn duration_seconds(&self) -> f64 {
        match self.last_queued_index {
            Some(index) => (index + 1) as f64 / self.fps.max(1) as f64,
            None => 0.0,
        }
    }

    /// Write every queued frame and finalize the MP4. Without this the file
    /// has no moov atom and will not open anywhere, so it runs on the stop
    /// path AND on drop.
    pub fn finish(&mut self) -> Result<(), String> {
        if let Some(result) = &self.finished {
            return result.clone();
        }
        // Closing the queue lets the encoder thread drain it and finalize.
        drop(self.jobs.take());
        let result = match self.thread.take() {
            Some(thread) => thread
                .join()
                .unwrap_or_else(|_| Err("native recording: the encoder thread panicked".to_string())),
            None => Ok(()),
        };
        self.finished = Some(result.clone());
        result
    }
}

impl Drop for WindowsVideoEncoder {
    fn drop(&mut self) {
        // A dropped encoder still owes the file its moov atom.
        let _ = self.finish();
        unsafe {
            let _ = MFShutdown();
        }
    }
}

fn set_frame_size(media_type: &IMFMediaType, width: u32, height: u32) -> Result<(), String> {
    let packed = ((width as u64) << 32) | height as u64;
    unsafe { media_type.SetUINT64(&MF_MT_FRAME_SIZE, packed) }
        .map_err(|e| mf_error("set frame size", e))
}

fn set_ratio(
    media_type: &IMFMediaType,
    key: &windows::core::GUID,
    numerator: u32,
    denominator: u32,
) -> Result<(), String> {
    let packed = ((numerator as u64) << 32) | denominator as u64;
    unsafe { media_type.SetUINT64(key, packed) }.map_err(|e| mf_error("set ratio", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bitrate_scales_with_pixel_rate_and_stays_in_h264_range() {
        // The tiers are defined at 1080p30 and must come back unchanged there.
        assert_eq!(bitrate_for("high", 1920, 1080, 30), 20_000_000);
        assert_eq!(bitrate_for("archive", 1920, 1080, 30), 40_000_000);
        assert_eq!(bitrate_for("web", 1920, 1080, 30), 8_000_000);
        // 4K60 is 8x the pixel rate: scaled, not starved at the 1080p number.
        assert!(bitrate_for("high", 3840, 2160, 60) > 20_000_000);
        // A tiny or absurd size must not produce an unusable bitrate.
        assert!(bitrate_for("web", 64, 64, 1) >= 2_000_000);
        assert!(bitrate_for("archive", 7680, 4320, 120) <= 240_000_000);
    }

    #[test]
    fn a_frame_takes_the_next_texture_the_encoder_has_let_go() {
        let busy: Vec<AtomicBool> = (0..4).map(|_| AtomicBool::new(false)).collect();
        assert_eq!(free_slot(&busy, 0), Some(0));
        busy[0].store(true, Ordering::Release);
        busy[1].store(true, Ordering::Release);
        // Round robin from where the last frame left off, wrapping around.
        assert_eq!(free_slot(&busy, 1), Some(2));
        busy[2].store(true, Ordering::Release);
        busy[3].store(true, Ordering::Release);
        // All with the encoder: the frame is dropped, never waited for.
        assert_eq!(free_slot(&busy, 3), None);
        busy[1].store(false, Ordering::Release);
        assert_eq!(free_slot(&busy, 3), Some(1));
    }

    /// The renderer's D3D12 device, made without a window. None (with the
    /// reason) where the runner has no D3D12 adapter.
    fn renderer_device() -> Result<wgpu::Device, String> {
        let mut descriptor = wgpu::InstanceDescriptor::new_without_display_handle();
        descriptor.backends = wgpu::Backends::DX12;
        let instance = wgpu::Instance::new(descriptor);
        let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::HighPerformance,
            force_fallback_adapter: false,
            compatible_surface: None,
            apply_limit_buckets: false,
        }))
        .map_err(|e| format!("no D3D12 adapter ({e})"))?;
        let (device, _queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor {
            label: Some("Windows recorder test"),
            required_features: wgpu::Features::empty(),
            required_limits: wgpu::Limits::default(),
            experimental_features: wgpu::ExperimentalFeatures::disabled(),
            memory_hints: wgpu::MemoryHints::Performance,
            trace: wgpu::Trace::Off,
        }))
        .map_err(|e| format!("no D3D12 device ({e})"))?;
        Ok(device)
    }

    /// Encodes about a second of frames to a temporary MP4 through the real
    /// path: hardware encoder, NV12 ring, encoder thread, finalize on stop.
    /// Needs a hardware GPU with a D3D11 video processor and an H.264
    /// encoder MFT; skips, saying why, on a runner without them.
    #[test]
    fn windows_video_encoder_records_frames_to_an_mp4() {
        let device = match renderer_device() {
            Ok(device) => device,
            Err(reason) => {
                eprintln!("SKIP windows_video_encoder_records_frames_to_an_mp4: {reason}");
                return;
            }
        };
        let worker = match crate::windows_video_texture::WindowsVideoDevice::new(&device)
            .and_then(|video| video.create_worker())
        {
            Ok(worker) => worker,
            Err(reason) => {
                eprintln!("SKIP windows_video_encoder_records_frames_to_an_mp4: {reason}");
                return;
            }
        };
        const W: u32 = 640;
        const H: u32 = 360;
        const FPS: u32 = 30;
        let path = std::env::temp_dir().join(format!("ga-recorder-test-{}.mp4", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let mut encoder =
            match WindowsVideoEncoder::new(worker.device(), &device, &path, W, H, FPS, "web") {
                Ok(encoder) => encoder,
                Err(reason) => {
                    eprintln!(
                        "SKIP windows_video_encoder_records_frames_to_an_mp4: no usable H.264 encoder or video processor ({reason})"
                    );
                    return;
                }
            };

        // A BGRA source like the core's output export, cleared to a new
        // colour every frame.
        let source = unsafe {
            let mut texture = None;
            worker
                .device()
                .CreateTexture2D(
                    &D3D11_TEXTURE2D_DESC {
                        Width: W,
                        Height: H,
                        MipLevels: 1,
                        ArraySize: 1,
                        Format: DXGI_FORMAT_B8G8R8A8_UNORM,
                        SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
                        Usage: D3D11_USAGE_DEFAULT,
                        BindFlags: (D3D11_BIND_RENDER_TARGET.0 | D3D11_BIND_SHADER_RESOURCE.0) as u32,
                        CPUAccessFlags: 0,
                        MiscFlags: 0,
                    },
                    None,
                    Some(&mut texture),
                )
                .expect("create the BGRA source");
            texture.expect("a BGRA source")
        };
        let target = unsafe {
            let mut view = None;
            worker
                .device()
                .CreateRenderTargetView(&source, None, Some(&mut view))
                .expect("create the source's render target view");
            view.expect("a render target view")
        };
        let context = unsafe { worker.device().GetImmediateContext() }.expect("immediate context");

        let frames = FPS as usize;
        let mut sent = 0;
        let started = Instant::now();
        while sent < frames {
            let shade = sent as f32 / frames as f32;
            unsafe { context.ClearRenderTargetView(&target, &[shade, 0.2, 1.0 - shade, 1.0]) };
            encoder.encode_texture(&source).expect("encode a frame");
            sent += 1;
            // One render per output frame, on the render clock.
            let due = started + std::time::Duration::from_secs_f64(sent as f64 / FPS as f64);
            if let Some(wait) = due.checked_duration_since(Instant::now()) {
                std::thread::sleep(wait);
            }
        }
        let (mean_us, max_us) = encoder.render_thread_us();
        let dropped = encoder.frames_dropped();
        encoder.finish().expect("finalize the MP4");
        let encoded = encoder.frames_encoded();
        let duration = encoder.duration_seconds();
        drop(encoder);

        let bytes = std::fs::read(&path).expect("the MP4 exists");
        let _ = std::fs::remove_file(&path);
        eprintln!(
            "windows recorder: {encoded} frames written, {dropped} dropped, {duration:.2} s, {} bytes; render thread {mean_us:.0} us mean, {max_us:.0} us max per recorded frame",
            bytes.len()
        );
        assert!(encoded + dropped >= frames as u64 - 2, "frames went missing: {encoded} written, {dropped} dropped");
        assert!(encoded >= frames as u64 / 2, "only {encoded} of {frames} frames were written");
        assert!(duration > 0.8, "take is {duration} s");
        // Finalized: the moov atom is there.
        assert!(bytes.windows(4).any(|window| window == b"moov"), "the MP4 was not finalized");
    }
}
