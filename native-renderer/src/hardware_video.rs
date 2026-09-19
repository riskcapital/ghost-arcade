//! Platform and HAP frames behind the shared preparation/transport policy.
use crate::hap_video::{HapFrame, HapVideoDecoder};
#[cfg(target_os = "macos")]
use crate::mac_video_decoder::{
    GpuVideoFrame as NativeGpuVideoFrame, MacVideoDecoder as NativeDecoder, VideoMetadata,
};
#[cfg(target_os = "windows")]
use crate::windows_video_decoder::{
    GpuVideoFrame as NativeGpuVideoFrame, VideoMetadata, WindowsVideoDecoder as NativeDecoder,
};
use std::path::Path;
#[cfg(target_os = "macos")]
pub const BACKEND: &str = "videotoolbox";
#[cfg(target_os = "windows")]
pub const BACKEND: &str = "media-foundation";
#[cfg(target_os = "macos")]
pub const TRANSPORT: &str = "native-video-iosurface";
#[cfg(target_os = "windows")]
pub const TRANSPORT: &str = "native-video-dxgi";
#[derive(Clone, Debug)]
pub enum FrameStorage {
    Native(NativeGpuVideoFrame),
    Hap(HapFrame),
}
#[derive(Clone, Debug)]
pub struct GpuVideoFrame {
    pub width: u32,
    pub height: u32,
    pub pts_seconds: f64,
    pub duration_seconds: f64,
    pub pixel_format: u32,
    pub storage: FrameStorage,
}
impl From<NativeGpuVideoFrame> for GpuVideoFrame {
    fn from(f: NativeGpuVideoFrame) -> Self {
        Self {
            width: f.width,
            height: f.height,
            pts_seconds: f.pts_seconds,
            duration_seconds: f.duration_seconds,
            pixel_format: f.pixel_format,
            storage: FrameStorage::Native(f),
        }
    }
}
impl From<HapFrame> for GpuVideoFrame {
    fn from(f: HapFrame) -> Self {
        Self {
            width: f.width,
            height: f.height,
            pts_seconds: f.pts_seconds,
            duration_seconds: f.duration_seconds,
            pixel_format: f.format.fourcc(),
            storage: FrameStorage::Hap(f),
        }
    }
}
pub enum HardwareVideoDecoder {
    Native(NativeDecoder),
    Hap(HapVideoDecoder),
}
impl HardwareVideoDecoder {
    #[cfg(target_os = "macos")]
    pub fn open(path: &Path, hap_supported: bool) -> Result<Self, String> {
        if hap_supported && let Ok(hap) = HapVideoDecoder::open(path) {
            return Ok(Self::Hap(hap));
        }
        NativeDecoder::open(path).map(Self::Native)
    }
    #[cfg(target_os = "windows")]
    pub fn open_with_device(
        path: &Path,
        device: Result<crate::windows_video_texture::WindowsVideoDevice, String>,
        hap_supported: bool,
    ) -> Result<Self, String> {
        if hap_supported && let Ok(hap) = HapVideoDecoder::open(path) {
            return Ok(Self::Hap(hap));
        }
        NativeDecoder::open_with_device(path, &device?).map(Self::Native)
    }
    pub fn backend_id(&self) -> u64 {
        if matches!(self, Self::Hap(_)) { 5 } else { 1 }
    }
    pub fn metadata(&self) -> VideoMetadata {
        match self {
            Self::Native(d) => d.metadata(),
            Self::Hap(d) => {
                let m = d.metadata();
                VideoMetadata {
                    width: m.width,
                    height: m.height,
                    fps: m.fps,
                    duration_seconds: m.duration_seconds,
                    hardware: true,
                }
            }
        }
    }
    pub fn queue_capacity(&self) -> usize {
        match self {
            Self::Native(d) => d.queue_capacity(),
            Self::Hap(_) => 1,
        }
    }
    pub fn index_bytes(&self) -> u64 {
        match self {
            Self::Hap(d) => d.index_bytes() as u64,
            _ => 0,
        }
    }
    pub fn probe_surface_bytes(&self) -> u64 {
        match self {
            Self::Hap(d) => d.frame_budget_bytes(),
            Self::Native(d) => {
                let m = d.metadata();
                (m.width as u64)
                    .saturating_mul(m.height as u64)
                    .saturating_mul(if cfg!(target_os = "windows") { 12 } else { 3 })
                    .saturating_add(65536)
            }
        }
    }
    pub fn set_queue_capacity(&mut self, n: usize) -> Result<(), String> {
        match self {
            Self::Native(d) => d.set_queue_capacity(n),
            Self::Hap(_) => Ok(()),
        }
    }
    pub fn release_unused_gpu_surfaces(&mut self) -> Result<(), String> {
        match self {
            Self::Native(d) => d.release_unused_gpu_surfaces(),
            Self::Hap(_) => Ok(()),
        }
    }
    pub fn seek(&mut self, t: f64, end: Option<f64>) -> Result<(), String> {
        match self {
            Self::Native(d) => d.seek(t, end),
            Self::Hap(d) => d.seek(t, end),
        }
    }
    pub fn next_frame(&mut self) -> Result<Option<GpuVideoFrame>, String> {
        match self {
            Self::Native(d) => d.next_frame().map(|f| f.map(Into::into)),
            Self::Hap(d) => d.next_frame().map(|f| f.map(Into::into)),
        }
    }
    pub fn step_frame(
        &mut self,
        r: f64,
        direction: i32,
        start: f64,
        end: f64,
    ) -> Result<Option<GpuVideoFrame>, String> {
        match self {
            Self::Native(d) => d
                .step_frame(r, direction, start, end)
                .map(|f| f.map(Into::into)),
            Self::Hap(d) => d
                .step_frame(r, direction, start, end)
                .map(|f| f.map(Into::into)),
        }
    }
    #[cfg(target_os = "windows")]
    pub fn prime_hardware(&mut self) -> Result<(), String> {
        match self {
            Self::Native(d) => d.prime_hardware(),
            Self::Hap(_) => Ok(()),
        }
    }
}
pub fn allocation_bytes(frame: &GpuVideoFrame) -> Result<u64, String> {
    match &frame.storage {
        FrameStorage::Native(f) => native_allocation_bytes(f),
        FrameStorage::Hap(f) => Ok((f.blocks.len() as u64) * 3 + 65536),
    }
}
fn native_allocation_bytes(frame: &NativeGpuVideoFrame) -> Result<u64, String> {
    #[cfg(target_os = "macos")]
    {
        let surface =
            objc2_io_surface::IOSurfaceRef::lookup(frame.iosurface_id).ok_or_else(|| {
                "Hardware video IOSurface disappeared before memory admission".to_string()
            })?;
        Ok(surface.alloc_size() as u64)
    }
    #[cfg(target_os = "windows")]
    {
        Ok(frame.allocation_bytes as u64)
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn windows_video_blit_shader_validates_on_every_hardware_host() {
        let shader = naga::front::wgsl::parse_str(include_str!("windows_video_blit.wgsl"))
            .expect("Windows video blit must parse");
        naga::valid::Validator::new(
            naga::valid::ValidationFlags::all(),
            naga::valid::Capabilities::empty(),
        )
        .validate(&shader)
        .expect("Windows video blit must validate");
    }
}
