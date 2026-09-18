//! D3D11 video processing into pooled D3D12 textures on the renderer's adapter.
//!
//! Decoded samples stay on the media worker. A shared fence orders the D3D11
//! producer before D3D12 sampling; no pixel data is mapped or read back. Callers
//! retain each frame until the wgpu submission completes, including cached-head
//! replay, so its pool slot cannot be written while D3D12 is reading it.
#![cfg(target_os = "windows")]

use std::{
    collections::VecDeque,
    mem::ManuallyDrop,
    sync::Arc,
    time::{Duration, Instant},
};
use wgpu::hal::{self, api::Dx12};
use windows::{
    Win32::{
        Foundation::{
            CloseHandle, GENERIC_ALL, HANDLE, HMODULE, RECT, WAIT_OBJECT_0, WAIT_TIMEOUT,
        },
        Graphics::{
            Direct3D::{D3D_DRIVER_TYPE_UNKNOWN, D3D_FEATURE_LEVEL_11_0, D3D_FEATURE_LEVEL_11_1},
            Direct3D11::*,
            Direct3D12::*,
            Dxgi::{
                Common::*, CreateDXGIFactory2, DXGI_ADAPTER_FLAG_SOFTWARE,
                DXGI_CREATE_FACTORY_FLAGS, IDXGIAdapter, IDXGIAdapter1, IDXGIFactory4,
            },
        },
        Media::MediaFoundation::IMFSample,
        System::Threading::{CreateEventW, WaitForSingleObject},
    },
    core::{Interface, PCWSTR},
};

const NV12: u32 = u32::from_be_bytes(*b"NV12");
const P010: u32 = u32::from_be_bytes(*b"P010");
// Slots are allocated only when every existing slot is retained. Cover the
// shared worker's admitted history (at most 96), ring, producer and GPU holds;
// this ceiling itself allocates nothing. Before lowering a peak reservation,
// the worker explicitly releases idle slots with release_unused_gpu_surfaces.
const MAX_POOL_SURFACES: usize = 128;
const MAX_PENDING_INPUTS: usize = 2;
const FENCE_TIMEOUT: Duration = Duration::from_secs(2);

fn error(operation: &str, error: windows::core::Error) -> String {
    format!("Windows GPU video {operation}: {error}")
}

struct OwnedHandle(HANDLE);
impl Drop for OwnedHandle {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseHandle(self.0);
        }
    }
}

/// Created from the renderer, then cloned into media-worker requests. There is
/// no default-adapter or WARP path: every D3D11 device uses this exact LUID.
#[derive(Clone)]
pub struct WindowsVideoDevice {
    wgpu: wgpu::Device,
    d3d12: ID3D12Device,
}

impl WindowsVideoDevice {
    pub fn new(device: &wgpu::Device) -> Result<Self, String> {
        let raw = unsafe { device.as_hal::<Dx12>() }
            .ok_or_else(|| "Windows GPU video requires the renderer's D3D12 device".to_string())?;
        Ok(Self {
            wgpu: device.clone(),
            d3d12: raw.raw_device().clone(),
        })
    }

    pub fn create_worker(&self) -> Result<WindowsVideoWorker, String> {
        unsafe {
            let factory: IDXGIFactory4 = CreateDXGIFactory2(DXGI_CREATE_FACTORY_FLAGS(0))
                .map_err(|e| error("create DXGI factory", e))?;
            let adapter: IDXGIAdapter1 = factory
                .EnumAdapterByLuid(self.d3d12.GetAdapterLuid())
                .map_err(|e| error("find renderer adapter", e))?;
            let adapter_desc = adapter
                .GetDesc1()
                .map_err(|e| error("inspect renderer adapter", e))?;
            if adapter_desc.Flags & DXGI_ADAPTER_FLAG_SOFTWARE.0 as u32 != 0 {
                return Err(
                    "Windows GPU video requires a hardware adapter; WARP is not supported".into(),
                );
            }
            let adapter: IDXGIAdapter = adapter
                .cast()
                .map_err(|e| error("query renderer adapter", e))?;
            let mut device = None;
            let mut immediate = None;
            D3D11CreateDevice(
                &adapter,
                D3D_DRIVER_TYPE_UNKNOWN,
                HMODULE::default(),
                D3D11_CREATE_DEVICE_VIDEO_SUPPORT | D3D11_CREATE_DEVICE_BGRA_SUPPORT,
                Some(&[D3D_FEATURE_LEVEL_11_1, D3D_FEATURE_LEVEL_11_0]),
                D3D11_SDK_VERSION,
                Some(&mut device),
                None,
                Some(&mut immediate),
            )
            .map_err(|e| error("create same-adapter D3D11 device", e))?;
            let device = device.ok_or("D3D11 returned no video device")?;
            let immediate = immediate.ok_or("D3D11 returned no immediate context")?;
            // Media Foundation may enter the same device from its own threads.
            // Processor state itself belongs exclusively to this worker.
            let multithread: ID3D11Multithread = immediate
                .cast()
                .map_err(|e| error("query multithread protection", e))?;
            let _ = multithread.SetMultithreadProtected(true);
            let context: ID3D11DeviceContext4 = immediate
                .cast()
                .map_err(|e| error("require D3D11 GPU fences", e))?;
            let video: ID3D11VideoDevice =
                device.cast().map_err(|e| error("query video device", e))?;
            let video_context: ID3D11VideoContext1 = immediate
                .cast()
                .map_err(|e| error("require explicit video color spaces", e))?;
            let device5: ID3D11Device5 =
                device.cast().map_err(|e| error("query fence device", e))?;
            let fence12: ID3D12Fence = self
                .d3d12
                .CreateFence(0, D3D12_FENCE_FLAG_SHARED)
                .map_err(|e| error("create shared producer fence", e))?;
            let shared = OwnedHandle(
                self.d3d12
                    .CreateSharedHandle(&fence12, None, GENERIC_ALL.0, PCWSTR::null())
                    .map_err(|e| error("export producer fence", e))?,
            );
            let mut fence11 = None;
            device5
                .OpenSharedFence(shared.0, &mut fence11)
                .map_err(|e| error("open producer fence on D3D11", e))?;
            let fence11 = fence11.ok_or("D3D11 returned no shared fence")?;
            Ok(WindowsVideoWorker {
                owner: self.clone(),
                device,
                context,
                video,
                video_context,
                fence: Arc::new(ProducerFence {
                    d3d11: fence11,
                    d3d12: fence12,
                    device12: self.d3d12.clone(),
                }),
                next_fence: 0,
                pending: VecDeque::new(),
                pending_limit: MAX_PENDING_INPUTS,
                processor: None,
                pool: Vec::new(),
            })
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub struct VideoFrameMetadata {
    pub width: u32,
    pub height: u32,
    pub pixel_format: u32,
    pub color_matrix: u32,
    pub full_range: bool,
    pub pts_seconds: f64,
    pub duration_seconds: f64,
}

#[derive(Debug)]
struct ProducerFence {
    d3d11: ID3D11Fence,
    d3d12: ID3D12Fence,
    device12: ID3D12Device,
}

#[derive(Debug)]
struct OutputSurface {
    // Keep both API resources/views with the same allocation for the whole slot.
    _texture11: ID3D11Texture2D,
    output_view: ID3D11VideoProcessorOutputView,
    _texture: wgpu::Texture,
    view: wgpu::TextureView,
    allocation_bytes: usize,
}

#[derive(Clone, Debug)]
pub struct GpuVideoFrame {
    surface: Arc<OutputSurface>,
    fence: Arc<ProducerFence>,
    fence_value: u64,
    pub width: u32,
    pub height: u32,
    /// Original decoder format, not the RGB interop texture's format.
    pub pixel_format: u32,
    pub color_matrix: u32,
    pub full_range: bool,
    pub pts_seconds: f64,
    pub duration_seconds: f64,
    /// Conservative per-frame input + exact shared-output allocation charge.
    pub allocation_bytes: usize,
}

struct PendingInput {
    _sample: IMFSample,
    _input_view: ID3D11VideoProcessorInputView,
    _output: Arc<OutputSurface>,
    fence_value: u64,
}

#[derive(Clone, Copy, PartialEq, Eq)]
struct ProcessorKey {
    coded_width: u32,
    coded_height: u32,
    width: u32,
    height: u32,
    pixel_format: u32,
    color_matrix: u32,
    full_range: bool,
}

#[derive(Clone, Copy)]
struct OutputFormat {
    dxgi: DXGI_FORMAT,
    wgpu: wgpu::TextureFormat,
}
const BGRA8: OutputFormat = OutputFormat {
    dxgi: DXGI_FORMAT_B8G8R8A8_UNORM,
    wgpu: wgpu::TextureFormat::Bgra8Unorm,
};
const RGBA16: OutputFormat = OutputFormat {
    dxgi: DXGI_FORMAT_R16G16B16A16_FLOAT,
    wgpu: wgpu::TextureFormat::Rgba16Float,
};
const RGB10: OutputFormat = OutputFormat {
    dxgi: DXGI_FORMAT_R10G10B10A2_UNORM,
    wgpu: wgpu::TextureFormat::Rgb10a2Unorm,
};

struct Processor {
    key: ProcessorKey,
    enumerator: ID3D11VideoProcessorEnumerator,
    processor: ID3D11VideoProcessor,
    output_format: OutputFormat,
}

pub struct WindowsVideoWorker {
    owner: WindowsVideoDevice,
    device: ID3D11Device,
    context: ID3D11DeviceContext4,
    video: ID3D11VideoDevice,
    video_context: ID3D11VideoContext1,
    fence: Arc<ProducerFence>,
    next_fence: u64,
    pending: VecDeque<PendingInput>,
    pending_limit: usize,
    processor: Option<Processor>,
    pool: Vec<Arc<OutputSurface>>,
}

fn input_format(fourcc: u32) -> Result<DXGI_FORMAT, String> {
    match fourcc {
        NV12 => Ok(DXGI_FORMAT_NV12),
        P010 => Ok(DXGI_FORMAT_P010),
        _ => Err(format!(
            "Unsupported Windows GPU video format 0x{fourcc:08x}"
        )),
    }
}

fn color_spaces(
    matrix: u32,
    full: bool,
) -> Result<(DXGI_COLOR_SPACE_TYPE, DXGI_COLOR_SPACE_TYPE), String> {
    let source = match (matrix, full) {
        (1, false) => DXGI_COLOR_SPACE_YCBCR_STUDIO_G22_LEFT_P601,
        (1, true) => DXGI_COLOR_SPACE_YCBCR_FULL_G22_LEFT_P601,
        (2, false) => DXGI_COLOR_SPACE_YCBCR_STUDIO_G22_LEFT_P709,
        (2, true) => DXGI_COLOR_SPACE_YCBCR_FULL_G22_LEFT_P709,
        (3, false) => DXGI_COLOR_SPACE_YCBCR_STUDIO_G22_LEFT_P2020,
        (3, true) => DXGI_COLOR_SPACE_YCBCR_FULL_G22_LEFT_P2020,
        _ => {
            return Err(format!(
                "Unsupported Windows GPU video color matrix {matrix}"
            ));
        }
    };
    // The atlas/display use encoded BT.709/sRGB primaries. Require the video
    // processor's advertised 2020-to-709 conversion for SDR wide-gamut input,
    // rather than relabeling 2020 RGB. G10 would incorrectly linearize the atlas.
    Ok((source, DXGI_COLOR_SPACE_RGB_FULL_G22_NONE_P709))
}

fn output_candidates(fourcc: u32) -> &'static [OutputFormat] {
    if fourcc == P010 {
        &[RGBA16, RGB10]
    } else {
        &[BGRA8]
    }
}

impl WindowsVideoWorker {
    pub fn device(&self) -> &ID3D11Device {
        &self.device
    }

    /// Input retirement only; output slots must also cover ring, opening-cache
    /// and in-flight renderer frames, so do not cap the output pool to this hint.
    pub fn set_queue_capacity(&mut self, capacity: usize) -> Result<(), String> {
        if capacity == 0 {
            return Err("Windows video queue capacity must be positive".into());
        }
        self.pending_limit = capacity.min(MAX_PENDING_INPUTS);
        Ok(())
    }

    /// Drop idle bridge allocations before the media worker gives optional
    /// history memory back to the shared budget. Pending producer work and
    /// renderer/cache frames own extra Arcs, so their slots remain resident.
    pub fn release_unused_gpu_surfaces(&mut self) -> Result<(), String> {
        self.reap_inputs()?;
        self.pool.retain(|slot| Arc::strong_count(slot) > 1);
        Ok(())
    }

    fn reap_inputs(&mut self) -> Result<(), String> {
        let completed = unsafe { self.fence.d3d11.GetCompletedValue() };
        if completed == u64::MAX {
            return Err("Windows video conversion device was removed".into());
        }
        while self
            .pending
            .front()
            .is_some_and(|entry| entry.fence_value <= completed)
        {
            self.pending.pop_front();
        }
        Ok(())
    }

    fn wait_for_conversion(&self, value: u64) -> Result<(), String> {
        unsafe {
            let completed = self.fence.d3d11.GetCompletedValue();
            if completed == u64::MAX {
                return Err("Windows video conversion device was removed".into());
            }
            if completed >= value {
                return Ok(());
            }
            let event = OwnedHandle(
                CreateEventW(None, false, false, PCWSTR::null())
                    .map_err(|e| error("create conversion-completion event", e))?,
            );
            self.fence
                .d3d11
                .SetEventOnCompletion(value, event.0)
                .map_err(|e| error("arm conversion-completion fence", e))?;
            let started = Instant::now();
            loop {
                match WaitForSingleObject(event.0, 50) {
                    WAIT_OBJECT_0 => return Ok(()),
                    WAIT_TIMEOUT => {
                        self.device
                            .GetDeviceRemovedReason()
                            .map_err(|e| error("conversion device removed", e))?;
                        if started.elapsed() >= FENCE_TIMEOUT {
                            return Err("Windows video conversion GPU fence timed out".into());
                        }
                    }
                    _ => return Err("Windows video conversion fence wait failed".into()),
                }
            }
        }
    }

    fn configure(&mut self, key: ProcessorKey) -> Result<(), String> {
        if self
            .processor
            .as_ref()
            .is_some_and(|processor| processor.key == key)
        {
            return Ok(());
        }
        let input_format = input_format(key.pixel_format)?;
        let (input_color, output_color) = color_spaces(key.color_matrix, key.full_range)?;
        unsafe {
            let enumerator = self
                .video
                .CreateVideoProcessorEnumerator(&D3D11_VIDEO_PROCESSOR_CONTENT_DESC {
                    InputFrameFormat: D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE,
                    InputFrameRate: DXGI_RATIONAL {
                        Numerator: 30,
                        Denominator: 1,
                    },
                    InputWidth: key.coded_width,
                    InputHeight: key.coded_height,
                    OutputFrameRate: DXGI_RATIONAL {
                        Numerator: 30,
                        Denominator: 1,
                    },
                    OutputWidth: key.width,
                    OutputHeight: key.height,
                    Usage: D3D11_VIDEO_USAGE_PLAYBACK_NORMAL,
                })
                .map_err(|e| error("create video processor enumerator", e))?;
            let enumerator1: ID3D11VideoProcessorEnumerator1 = enumerator
                .cast()
                .map_err(|e| error("require video conversion capability query", e))?;
            let processor = self
                .video
                .CreateVideoProcessor(&enumerator, 0)
                .map_err(|e| error("create video processor", e))?;
            let rectangle = RECT {
                left: 0,
                top: 0,
                right: key.width as i32,
                bottom: key.height as i32,
            };
            self.video_context.VideoProcessorSetStreamFrameFormat(
                &processor,
                0,
                D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE,
            );
            self.video_context
                .VideoProcessorSetStreamAutoProcessingMode(&processor, 0, false);
            self.video_context.VideoProcessorSetStreamSourceRect(
                &processor,
                0,
                true,
                Some(&rectangle),
            );
            self.video_context.VideoProcessorSetStreamDestRect(
                &processor,
                0,
                true,
                Some(&rectangle),
            );
            self.video_context.VideoProcessorSetOutputTargetRect(
                &processor,
                true,
                Some(&rectangle),
            );
            self.video_context
                .VideoProcessorSetStreamAlpha(&processor, 0, true, 1.0);
            self.video_context.VideoProcessorSetOutputAlphaFillMode(
                &processor,
                D3D11_VIDEO_PROCESSOR_ALPHA_FILL_MODE_OPAQUE,
                0,
            );
            self.video_context
                .VideoProcessorSetStreamColorSpace1(&processor, 0, input_color);
            self.video_context
                .VideoProcessorSetOutputColorSpace1(&processor, output_color);
            let mut last_error = format!(
                "Windows video processor does not support {:?} matrix={} full_range={} without losing bit depth",
                input_format, key.color_matrix, key.full_range
            );
            for output_format in output_candidates(key.pixel_format).iter().copied() {
                if !enumerator1
                    .CheckVideoProcessorFormatConversion(
                        input_format,
                        input_color,
                        output_format.dxgi,
                        output_color,
                    )
                    .is_ok_and(|supported| supported.as_bool())
                {
                    continue;
                }
                let candidate = Processor {
                    key,
                    enumerator: enumerator.clone(),
                    processor: processor.clone(),
                    output_format,
                };
                // Float video processing may be supported while float resource
                // sharing is not. Try the precision-preserving RGB10 alternative
                // at initialization too, never falling back to eight-bit RGB.
                match self.create_output(&candidate) {
                    Ok(output) => {
                        // Existing frames retain their old, immutable slots.
                        self.pool.clear();
                        self.pool.push(output);
                        self.processor = Some(candidate);
                        return Ok(());
                    }
                    Err(error) => last_error = error,
                }
            }
            return Err(last_error);
        }
    }

    fn create_output(&self, processor: &Processor) -> Result<Arc<OutputSurface>, String> {
        let width = processor.key.width;
        let height = processor.key.height;
        let format = processor.output_format;
        unsafe {
            // D3D12 owns the shared allocation, with its interop state explicit.
            // SIMULTANEOUS_ACCESS permits shader-read promotion from COMMON and
            // decay to COMMON when ExecuteCommandLists completes. Pool reuse
            // waits for the caller's submission retain to be released.
            let desc = D3D12_RESOURCE_DESC {
                Dimension: D3D12_RESOURCE_DIMENSION_TEXTURE2D,
                Width: width as u64,
                Height: height,
                DepthOrArraySize: 1,
                MipLevels: 1,
                Format: format.dxgi,
                SampleDesc: DXGI_SAMPLE_DESC {
                    Count: 1,
                    Quality: 0,
                },
                Layout: D3D12_TEXTURE_LAYOUT_UNKNOWN,
                Flags: D3D12_RESOURCE_FLAG_ALLOW_RENDER_TARGET
                    | D3D12_RESOURCE_FLAG_ALLOW_SIMULTANEOUS_ACCESS,
                ..Default::default()
            };
            let allocation = self.owner.d3d12.GetResourceAllocationInfo(0, &[desc]);
            if allocation.SizeInBytes == 0 || allocation.SizeInBytes == u64::MAX {
                return Err("Windows video shared texture has an invalid allocation size".into());
            }
            let mut resource: Option<ID3D12Resource> = None;
            self.owner
                .d3d12
                .CreateCommittedResource(
                    &D3D12_HEAP_PROPERTIES {
                        Type: D3D12_HEAP_TYPE_DEFAULT,
                        CreationNodeMask: 1,
                        VisibleNodeMask: 1,
                        ..Default::default()
                    },
                    D3D12_HEAP_FLAG_SHARED,
                    &desc,
                    D3D12_RESOURCE_STATE_COMMON,
                    None,
                    &mut resource,
                )
                .map_err(|e| error("allocate shared video output", e))?;
            let resource = resource.ok_or("D3D12 returned no shared video output")?;
            let shared = OwnedHandle(
                self.owner
                    .d3d12
                    .CreateSharedHandle(&resource, None, GENERIC_ALL.0, PCWSTR::null())
                    .map_err(|e| error("export video output", e))?,
            );
            let device1: ID3D11Device1 = self
                .device
                .cast()
                .map_err(|e| error("query shared resource device", e))?;
            let texture11: ID3D11Texture2D = device1
                .OpenSharedResource1(shared.0)
                .map_err(|e| error("open D3D12 video output in D3D11", e))?;
            let mut output_view = None;
            self.video
                .CreateVideoProcessorOutputView(
                    &texture11,
                    &processor.enumerator,
                    &D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC {
                        ViewDimension: D3D11_VPOV_DIMENSION_TEXTURE2D,
                        Anonymous: D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC_0 {
                            Texture2D: D3D11_TEX2D_VPOV { MipSlice: 0 },
                        },
                    },
                    Some(&mut output_view),
                )
                .map_err(|e| error("create video output view", e))?;
            let output_view = output_view.ok_or("D3D11 returned no video output view")?;
            let size = wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            };
            let raw = hal::dx12::Device::texture_from_raw(
                resource,
                format.wgpu,
                wgpu::TextureDimension::D2,
                size,
                1,
                1,
            );
            let texture = self.owner.wgpu.create_texture_from_hal::<Dx12>(
                raw,
                &wgpu::TextureDescriptor {
                    label: Some("Windows Native Video Shared Output"),
                    size,
                    mip_level_count: 1,
                    sample_count: 1,
                    dimension: wgpu::TextureDimension::D2,
                    format: format.wgpu,
                    usage: wgpu::TextureUsages::TEXTURE_BINDING,
                    view_formats: &[],
                },
                // On D3D12 PRESENT maps to COMMON. This is the exact state at
                // import; the first sampling use emits COMMON -> RESOURCE.
                // Later read-only uses can implicitly promote after decay.
                wgpu::TextureUses::PRESENT,
            );
            let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
            Ok(Arc::new(OutputSurface {
                _texture11: texture11,
                output_view,
                _texture: texture,
                view,
                allocation_bytes: allocation.SizeInBytes.min(usize::MAX as u64) as usize,
            }))
        }
    }

    pub fn convert(
        &mut self,
        sample: &IMFSample,
        texture: &ID3D11Texture2D,
        subresource: u32,
        metadata: VideoFrameMetadata,
    ) -> Result<GpuVideoFrame, String> {
        self.reap_inputs()?;
        if self.pending.len() >= self.pending_limit {
            self.wait_for_conversion(self.pending.front().unwrap().fence_value)?;
            self.reap_inputs()?;
        }
        let mut desc = D3D11_TEXTURE2D_DESC::default();
        unsafe {
            texture.GetDesc(&mut desc);
        }
        if metadata.width == 0
            || metadata.height == 0
            || metadata.width > desc.Width
            || metadata.height > desc.Height
            || desc.MipLevels != 1
            || desc.SampleDesc.Count != 1
            || subresource >= desc.ArraySize
            || desc.Format != input_format(metadata.pixel_format)?
            || desc.CPUAccessFlags != 0
        {
            return Err(
                "Windows video decoder returned incompatible GPU texture geometry or format".into(),
            );
        }
        let input_device =
            unsafe { texture.GetDevice() }.map_err(|e| error("query decoded texture device", e))?;
        if input_device != self.device {
            return Err("Windows decoded video texture belongs to a different D3D11 device".into());
        }
        let key = ProcessorKey {
            coded_width: desc.Width,
            coded_height: desc.Height,
            width: metadata.width,
            height: metadata.height,
            pixel_format: metadata.pixel_format,
            color_matrix: metadata.color_matrix,
            full_range: metadata.full_range,
        };
        self.configure(key)?;
        let processor = self.processor.as_ref().unwrap();
        let output = if let Some(slot) = self.pool.iter().find(|slot| Arc::strong_count(slot) == 1)
        {
            slot.clone()
        } else {
            if self.pool.len() >= MAX_POOL_SURFACES {
                return Err("Windows GPU video output pool is exhausted; retained frames exceed the bounded handoff".into());
            }
            let output = self.create_output(processor)?;
            self.pool.push(output.clone());
            output
        };
        let mut input_view = None;
        unsafe {
            self.video
                .CreateVideoProcessorInputView(
                    texture,
                    &processor.enumerator,
                    &D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC {
                        FourCC: 0,
                        ViewDimension: D3D11_VPIV_DIMENSION_TEXTURE2D,
                        Anonymous: D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC_0 {
                            Texture2D: D3D11_TEX2D_VPIV {
                                MipSlice: 0,
                                ArraySlice: subresource,
                            },
                        },
                    },
                    Some(&mut input_view),
                )
                .map_err(|e| error("create decoded input view", e))?;
        }
        let input_view = input_view.ok_or("D3D11 returned no decoded input view")?;
        let value = self
            .next_fence
            .checked_add(1)
            .ok_or("Windows video fence exhausted")?;
        let mut stream = D3D11_VIDEO_PROCESSOR_STREAM {
            Enable: true.into(),
            pInputSurface: ManuallyDrop::new(Some(input_view.clone())),
            ..Default::default()
        };
        let converted = unsafe {
            self.video_context.VideoProcessorBlt(
                &processor.processor,
                &output.output_view,
                0,
                std::slice::from_ref(&stream),
            )
        };
        unsafe {
            ManuallyDrop::drop(&mut stream.pInputSurface);
        }
        converted.map_err(|e| error("GPU video color conversion", e))?;
        // Retain BEFORE signaling: even a failed signal must not return the
        // source sample to its decode pool while the submitted blit can read it.
        self.pending.push_back(PendingInput {
            _sample: sample.clone(),
            _input_view: input_view,
            _output: output.clone(),
            fence_value: value,
        });
        unsafe {
            self.context
                .Signal(&self.fence.d3d11, value)
                .map_err(|e| error("signal converted video", e))?;
            self.context.Flush();
        }
        self.next_fence = value;
        // Decode output allocation is opaque to D3D11. Budget a padded planar
        // surface conservatively, plus the exact D3D12 output allocation.
        let component_bytes = if metadata.pixel_format == P010 {
            2usize
        } else {
            1
        };
        let row = (desc.Width as usize * component_bytes).div_ceil(256) * 256;
        let input_bytes = (row * (desc.Height as usize).div_ceil(2) * 3).div_ceil(65536) * 65536;
        Ok(GpuVideoFrame {
            allocation_bytes: output.allocation_bytes.saturating_add(input_bytes),
            surface: output,
            fence: self.fence.clone(),
            fence_value: value,
            width: metadata.width,
            height: metadata.height,
            pixel_format: metadata.pixel_format,
            color_matrix: metadata.color_matrix,
            full_range: metadata.full_range,
            pts_seconds: metadata.pts_seconds,
            duration_seconds: metadata.duration_seconds,
        })
    }
}

impl Drop for WindowsVideoWorker {
    fn drop(&mut self) {
        // The decoder drops its SourceReader before this worker. Normally this
        // drains two tiny conversions; device loss/timeouts must not hang app
        // shutdown forever. On failure the closed decoder can no longer reuse
        // input samples, and D3D11 retains submitted resource references itself.
        unsafe {
            self.context.Flush();
        }
        if let Some(last) = self.pending.back() {
            if let Err(error) = self.wait_for_conversion(last.fence_value) {
                eprintln!("{error} during Windows video shutdown");
            }
        }
        self.pending.clear();
    }
}

const BLIT_SHADER: &str = include_str!("windows_video_blit.wgsl");

/// The render thread only waits on the GPU fence and samples the shared output.
pub struct GpuVideoConverter {
    pipeline: wgpu::RenderPipeline,
    layout: wgpu::BindGroupLayout,
    sampler: wgpu::Sampler,
}

impl GpuVideoConverter {
    pub fn new(device: &wgpu::Device, target_format: wgpu::TextureFormat) -> Self {
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("Windows Video Blit Layout"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: true },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    count: None,
                },
            ],
        });
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("Windows Video GPU Scaling"),
            source: wgpu::ShaderSource::Wgsl(BLIT_SHADER.into()),
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Windows Video Pipeline Layout"),
            bind_group_layouts: &[Some(&layout)],
            immediate_size: 0,
        });
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("Windows Video Scaling Pipeline"),
            layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs_main"),
                compilation_options: Default::default(),
                buffers: &[],
            },
            primitive: Default::default(),
            depth_stencil: None,
            multisample: Default::default(),
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fs_main"),
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format: target_format,
                    blend: None,
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            multiview_mask: None,
            cache: None,
        });
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("Windows Video Scaling Sampler"),
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });
        Self {
            pipeline,
            layout,
            sampler,
        }
    }

    pub fn encode(
        &self,
        device: &wgpu::Device,
        _queue: &wgpu::Queue,
        encoder: &mut wgpu::CommandEncoder,
        frame: &GpuVideoFrame,
        target: &wgpu::TextureView,
        viewport: [f32; 4],
    ) -> Result<(), String> {
        if !viewport.iter().all(|value| value.is_finite())
            || viewport[0] < 0.0
            || viewport[1] < 0.0
            || viewport[2] <= 0.0
            || viewport[3] <= 0.0
        {
            return Err("Windows video viewport is invalid".into());
        }
        let raw = unsafe { device.as_hal::<Dx12>() }.ok_or("Windows video requires D3D12")?;
        if raw.raw_device() != &frame.fence.device12 {
            return Err("Windows video frame belongs to a previous renderer device".into());
        }
        unsafe {
            frame
                .fence
                .device12
                .GetDeviceRemovedReason()
                .map_err(|e| error("renderer device removed", e))?;
            if frame.fence.d3d12.GetCompletedValue() == u64::MAX {
                return Err("Windows video producer fence device was removed".into());
            }
            // Queue::Wait is GPU-side; the render thread never waits for the
            // producer or copies pixels. This queue is the wgpu device's queue.
            raw.raw_queue()
                .Wait(&frame.fence.d3d12, frame.fence_value)
                .map_err(|e| error("queue GPU wait for converted video", e))?;
        }
        let bindings = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Windows Video Frame Bindings"),
            layout: &self.layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(&frame.surface.view),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::Sampler(&self.sampler),
                },
            ],
        });
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("Windows Native Video GPU Blit"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: target,
                depth_slice: None,
                resolve_target: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                    store: wgpu::StoreOp::Store,
                },
            })],
            depth_stencil_attachment: None,
            timestamp_writes: None,
            occlusion_query_set: None,
            multiview_mask: None,
        });
        pass.set_pipeline(&self.pipeline);
        pass.set_bind_group(0, &bindings, &[]);
        pass.set_viewport(viewport[0], viewport[1], viewport[2], viewport[3], 0.0, 1.0);
        pass.draw(0..3, 0..1);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_video_p010_never_chooses_eight_bit_output() {
        assert!(output_candidates(P010).iter().all(|format| matches!(
            format.wgpu,
            wgpu::TextureFormat::Rgba16Float | wgpu::TextureFormat::Rgb10a2Unorm
        )));
        assert_eq!(
            output_candidates(NV12)[0].wgpu,
            wgpu::TextureFormat::Bgra8Unorm
        );
        assert!(input_format(u32::from_be_bytes(*b"YUY2")).is_err());
    }

    #[test]
    fn windows_video_color_space_preserves_matrix_and_range() {
        assert_eq!(
            color_spaces(1, false).unwrap().0,
            DXGI_COLOR_SPACE_YCBCR_STUDIO_G22_LEFT_P601
        );
        assert_eq!(
            color_spaces(1, true).unwrap().0,
            DXGI_COLOR_SPACE_YCBCR_FULL_G22_LEFT_P601
        );
        assert_eq!(
            color_spaces(2, false).unwrap().0,
            DXGI_COLOR_SPACE_YCBCR_STUDIO_G22_LEFT_P709
        );
        assert_eq!(
            color_spaces(2, true).unwrap().0,
            DXGI_COLOR_SPACE_YCBCR_FULL_G22_LEFT_P709
        );
        assert_eq!(
            color_spaces(3, false).unwrap().0,
            DXGI_COLOR_SPACE_YCBCR_STUDIO_G22_LEFT_P2020
        );
        assert_eq!(
            color_spaces(3, true).unwrap().1,
            DXGI_COLOR_SPACE_RGB_FULL_G22_NONE_P709
        );
        assert!(color_spaces(99, false).is_err());
    }

    #[test]
    fn windows_video_scaling_shader_validates() {
        let shader = naga::front::wgsl::parse_str(BLIT_SHADER).unwrap();
        naga::valid::Validator::new(
            naga::valid::ValidationFlags::all(),
            naga::valid::Capabilities::empty(),
        )
        .validate(&shader)
        .unwrap();
    }
}
