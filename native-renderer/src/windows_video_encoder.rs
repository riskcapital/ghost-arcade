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
//! Audio is unchanged: the file is a normal MP4, so the existing Electron-side
//! remux still copies the video stream bit-for-bit and adds the audio track.

use std::path::Path;

use wgpu::hal::api::Dx12;
use windows::core::{Interface, PCWSTR};
use windows::Win32::Foundation::GENERIC_ALL;
use windows::Win32::Graphics::Direct3D11::*;
use windows::Win32::Graphics::Direct3D12::{ID3D12Fence, D3D12_FENCE_FLAG_SHARED};
use windows::Win32::Graphics::Dxgi::Common::*;
use windows::Win32::Media::MediaFoundation::*;

/// DXGI_SHARED_RESOURCE_READ. Not re-exported by the `windows` crate's D3D11
/// module, and the encoder only ever reads the composite.
const SHARED_RESOURCE_READ: u32 = 0x8000_0000;

/// 100-nanosecond units: Media Foundation's timebase.
const HNS_PER_SECOND: i64 = 10_000_000;

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

pub struct WindowsVideoEncoder {
    writer: IMFSinkWriter,
    stream: u32,
    device: ID3D11Device,
    context: ID3D11DeviceContext,
    video_device: ID3D11VideoDevice,
    video_context: ID3D11VideoContext,
    enumerator: ID3D11VideoProcessorEnumerator,
    processor: ID3D11VideoProcessor,
    /// NV12 destination the sink writer reads. One texture, reused: allocating
    /// per frame would defeat the point of staying on the GPU.
    nv12: ID3D11Texture2D,
    output_view: Option<ID3D11VideoProcessorOutputView>,
    source: Option<(String, ID3D11Texture2D)>,
    /// D3D12 renders the composite, D3D11 encodes it. Nothing orders those
    /// two devices by itself, so without a fence the encoder can read a
    /// surface the renderer has not finished writing and the take tears under
    /// load. Both sides wait on the GPU; the render thread never blocks.
    wgpu_device: wgpu::Device,
    fence12: ID3D12Fence,
    fence11: ID3D11Fence,
    fence_value: u64,
    width: u32,
    height: u32,
    fps: u32,
    frames: u64,
    /// Wall clock for pacing. The core renders as fast as it can (165fps on a
    /// high-refresh panel); stamping every rendered frame at 1/fps made a
    /// 3-second take play back as 6 seconds of slow motion.
    started: Option<std::time::Instant>,
    last_index: Option<u64>,
    finished: bool,
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

            let context = device
                .GetImmediateContext()
                .map_err(|e| mf_error("get D3D11 immediate context", e))?;
            // MF drives the device from its own threads.
            if let Ok(mt) = context.cast::<ID3D11Multithread>() {
                let _ = mt.SetMultithreadProtected(true);
            }

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
            let video_context: ID3D11VideoContext = context
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

            // Shared fence: D3D12 (renderer) signals, D3D11 (encoder) waits.
            let raw12 = wgpu_device
                .as_hal::<Dx12>()
                .ok_or_else(|| "native recording requires the renderer's D3D12 device".to_string())?;
            let fence12: ID3D12Fence = raw12
                .raw_device()
                .CreateFence(0, D3D12_FENCE_FLAG_SHARED)
                .map_err(|e| mf_error("create shared render fence", e))?;
            let shared = raw12
                .raw_device()
                .CreateSharedHandle(&fence12, None, GENERIC_ALL.0, PCWSTR::null())
                .map_err(|e| mf_error("export render fence", e))?;
            let device5: ID3D11Device5 = device
                .cast()
                .map_err(|e| mf_error("query ID3D11Device5 for fences", e))?;
            let mut fence11 = None;
            device5
                .OpenSharedFence(shared, &mut fence11)
                .map_err(|e| mf_error("open render fence on D3D11", e))?;
            let fence11 =
                fence11.ok_or_else(|| "native recording: D3D11 returned no shared fence".to_string())?;

            Ok(Self {
                writer,
                stream,
                device: device.clone(),
                context,
                video_device,
                video_context,
                enumerator,
                processor,
                nv12,
                output_view: None,
                source: None,
                wgpu_device: wgpu_device.clone(),
                fence12,
                fence11,
                fence_value: 0,
                width,
                height,
                fps,
                frames: 0,
                started: None,
                last_index: None,
                finished: false,
            })
        }
    }

    /// Encode one frame from the core's named output shared texture.
    ///
    /// `shared_name` is the same name the preview and Spout open, so the
    /// encoder reads exactly the composite that went to screen rather than a
    /// second render of it.
    pub fn encode_shared_texture(&mut self, shared_name: &str) -> Result<(), String> {
        if self.finished {
            return Err("native recording: encoder already finished".into());
        }
        // Which output frame does *now* belong to? Renders that land inside a
        // slot already written are dropped, so the file stays in step with
        // real time however fast the core happens to be running.
        let started = *self.started.get_or_insert_with(std::time::Instant::now);
        let elapsed = started.elapsed().as_secs_f64();
        let index = (elapsed * self.fps as f64).floor().max(0.0) as u64;
        if let Some(last) = self.last_index {
            if index <= last {
                return Ok(());
            }
        }
        self.last_index = Some(index);

        unsafe {
            let source = self.source_texture(shared_name)?;

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
                    .CreateVideoProcessorInputView(&source, &self.enumerator, &desc, Some(&mut view))
                    .map_err(|e| mf_error("CreateVideoProcessorInputView", e))?;
                view.ok_or_else(|| "native recording: no processor input view".to_string())?
            };

            if self.output_view.is_none() {
                let desc = D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC {
                    ViewDimension: D3D11_VPOV_DIMENSION_TEXTURE2D,
                    Anonymous: D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC_0 {
                        Texture2D: D3D11_TEX2D_VPOV { MipSlice: 0 },
                    },
                };
                let mut view = None;
                self.video_device
                    .CreateVideoProcessorOutputView(
                        &self.nv12,
                        &self.enumerator,
                        &desc,
                        Some(&mut view),
                    )
                    .map_err(|e| mf_error("CreateVideoProcessorOutputView", e))?;
                self.output_view = view;
            }
            let output_view = self
                .output_view
                .clone()
                .ok_or_else(|| "native recording: no processor output view".to_string())?;

            // Order this read after everything the renderer has submitted for
            // this frame. Both calls are GPU-side; neither thread stalls.
            self.fence_value += 1;
            {
                let raw12 = self.wgpu_device.as_hal::<Dx12>().ok_or_else(|| {
                    "native recording lost the renderer's D3D12 device".to_string()
                })?;
                raw12
                    .raw_queue()
                    .Signal(&self.fence12, self.fence_value)
                    .map_err(|e| mf_error("signal render fence", e))?;
            }
            let context4: ID3D11DeviceContext4 = self
                .context
                .cast()
                .map_err(|e| mf_error("query ID3D11DeviceContext4", e))?;
            context4
                .Wait(&self.fence11, self.fence_value)
                .map_err(|e| mf_error("wait on render fence", e))?;

            // BGRA -> NV12, on the GPU.
            let stream = D3D11_VIDEO_PROCESSOR_STREAM {
                Enable: true.into(),
                OutputIndex: 0,
                InputFrameOrField: 0,
                PastFrames: 0,
                FutureFrames: 0,
                pInputSurface: std::mem::ManuallyDrop::new(Some(input_view.clone())),
                ..Default::default()
            };
            let blt = self
                .video_context
                .VideoProcessorBlt(&self.processor, &output_view, 0, &[stream]);
            blt.map_err(|e| mf_error("VideoProcessorBlt (BGRA->NV12)", e))?;
            self.context.Flush();

            // Wrap the NV12 texture as a sample; no copy, no readback.
            let buffer = MFCreateDXGISurfaceBuffer(
                &ID3D11Texture2D::IID,
                &self.nv12,
                0,
                false,
            )
            .map_err(|e| mf_error("MFCreateDXGISurfaceBuffer", e))?;
            if let Ok(len) = buffer.cast::<IMF2DBuffer>().and_then(|b| b.GetContiguousLength()) {
                let _ = buffer.SetCurrentLength(len);
            }

            let sample = MFCreateSample().map_err(|e| mf_error("MFCreateSample", e))?;
            sample
                .AddBuffer(&buffer)
                .map_err(|e| mf_error("IMFSample::AddBuffer", e))?;
            // Constant cadence: the pump calls us once per output frame, and a
            // recording that drifts against its own frame rate is unusable in
            // an NLE even when every frame is present.
            let duration = HNS_PER_SECOND / self.fps.max(1) as i64;
            sample
                .SetSampleTime(index as i64 * duration)
                .map_err(|e| mf_error("IMFSample::SetSampleTime", e))?;
            sample
                .SetSampleDuration(duration)
                .map_err(|e| mf_error("IMFSample::SetSampleDuration", e))?;

            self.writer
                .WriteSample(self.stream, &sample)
                .map_err(|e| mf_error("IMFSinkWriter::WriteSample", e))?;
            self.frames += 1;
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

    pub fn frames_encoded(&self) -> u64 {
        self.frames
    }

    /// Real duration of the take. Frame count is not it: a static scene makes
    /// the core render rarely, so the file can hold three frames spread
    /// across five seconds. The last timestamp is what a player sees.
    pub fn duration_seconds(&self) -> f64 {
        match self.last_index {
            Some(index) => (index + 1) as f64 / self.fps.max(1) as f64,
            None => 0.0,
        }
    }

    /// Finalize the MP4. Without this the file has no moov atom and will not
    /// open anywhere, so it runs on the stop path AND on drop.
    pub fn finish(&mut self) -> Result<(), String> {
        if self.finished {
            return Ok(());
        }
        self.finished = true;
        unsafe {
            self.writer
                .Finalize()
                .map_err(|e| mf_error("IMFSinkWriter::Finalize", e))?;
        }
        Ok(())
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
    use super::bitrate_for;

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
}
