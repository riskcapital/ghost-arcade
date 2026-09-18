//! Platform names behind the shared preparation, transport and memory policy.
#[cfg(target_os = "macos")]
pub use crate::mac_video_decoder::{GpuVideoFrame, MacVideoDecoder as HardwareVideoDecoder};
#[cfg(target_os = "windows")]
pub use crate::windows_video_decoder::{GpuVideoFrame, WindowsVideoDecoder as HardwareVideoDecoder};

#[cfg(target_os = "macos")]
pub const BACKEND: &str = "videotoolbox";
#[cfg(target_os = "windows")]
pub const BACKEND: &str = "media-foundation";
#[cfg(target_os = "macos")]
pub const TRANSPORT: &str = "native-video-iosurface";
#[cfg(target_os = "windows")]
pub const TRANSPORT: &str = "native-video-dxgi";

pub fn allocation_bytes(frame: &GpuVideoFrame) -> Result<u64, String> {
    #[cfg(target_os = "macos")]
    {
        let surface = objc2_io_surface::IOSurfaceRef::lookup(frame.iosurface_id)
            .ok_or_else(|| "Hardware video IOSurface disappeared before memory admission".to_string())?;
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
