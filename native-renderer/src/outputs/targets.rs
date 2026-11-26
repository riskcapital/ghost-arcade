//! Output targets: export, deck monitor, Screen (slice) and record targets,
//! and the bounds on what may be asked for.

use crate::*;

#[cfg(any(target_os = "macos", target_os = "windows"))]
pub(crate) struct NativeOutputExport {
    #[cfg(target_os = "macos")]
    pub(crate) surface: objc2_core_foundation::CFRetained<objc2_io_surface::IOSurfaceRef>,
    #[cfg(target_os = "windows")]
    pub(crate) shared_handle: windows::Win32::Foundation::HANDLE,
    #[cfg(target_os = "windows")]
    pub(crate) shared_name: String,
    pub(crate) texture: wgpu::Texture,
    pub(crate) view: wgpu::TextureView,
    pub(crate) blitter: TextureBlitter,
    pub(crate) width: u32,
    pub(crate) height: u32,
    pub(crate) format: wgpu::TextureFormat,
    pub(crate) frame: u64,
}

#[cfg(target_os = "windows")]
impl Drop for NativeOutputExport {
    fn drop(&mut self) {
        if !self.shared_handle.is_invalid() {
            let _ = unsafe { windows::Win32::Foundation::CloseHandle(self.shared_handle) };
        }
    }
}

/// One deck confidence monitor: the bank composite renders into
/// `render_view` (pipeline format). On macOS and Windows it then blits into
/// the shared-texture `export` the presenter imports zero-copy. Linux has no
/// shared-texture path, so there the panel reads `render_texture` back.
pub(crate) struct DeckMonitorTarget {
    pub(crate) render_texture: wgpu::Texture,
    pub(crate) render_view: wgpu::TextureView,
    pub(crate) width: u32,
    pub(crate) height: u32,
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    pub(crate) export: NativeOutputExport,
}

/// One multi-output slice presented on its own physical display. Same shape
/// as a deck monitor — an offscreen composite plus a shared-texture export —
/// but sized to the display and carrying the slice's own output transform, so
/// each projector gets a full-resolution native composite of its own region
/// instead of a second WebGL renderer cropping a downscaled master.
///
/// One Screen's own composite. On macOS and Windows it is handed to Electron
/// as a shared texture (`export`) that a native layer in the Screen window
/// presents. Linux has no shared-texture path, so there the core presents it
/// itself into a child window parented inside the Screen window
/// (`LinuxSliceWindow`), and the target only tracks its size and frame.
pub(crate) struct SliceOutputTarget {
    pub(crate) _render_texture: wgpu::Texture,
    pub(crate) render_view: wgpu::TextureView,
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    pub(crate) export: NativeOutputExport,
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    pub(crate) width: u32,
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    pub(crate) height: u32,
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    pub(crate) frame: u64,
    /// Map Sim projector view feeding this slice's output stage, when the
    /// Screen's source is a Map Sim projector: (texture, view, presenter
    /// input bind group).
    pub(crate) projector_view_source: Option<(wgpu::Texture, wgpu::TextureView, wgpu::BindGroup)>,
}

impl SliceOutputTarget {
    pub(crate) fn size(&self) -> (u32, u32) {
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        { (self.export.width, self.export.height) }
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        { (self.width, self.height) }
    }

    pub(crate) fn bump_frame(&mut self) {
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        { self.export.frame = self.export.frame.saturating_add(1); }
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        { self.frame = self.frame.saturating_add(1); }
    }
}

/// Linux: a Screen presented by the core itself. The window is an X11 child
/// of the Electron Screen window, so Electron still owns which display the
/// Screen is on and whether it is fullscreen; this only fills it.
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub(crate) struct LinuxSliceWindow {
    pub(crate) window: Arc<Window>,
    pub(crate) surface: wgpu::Surface<'static>,
    pub(crate) config: wgpu::SurfaceConfiguration,
    pub(crate) blitter: TextureBlitter,
}

/// The recording target: one extra composite pass over the layers being
/// recorded (a single layer, a VJ row, or the whole composition with its
/// transparency), at composition size, exported as a shared texture the
/// main-process recorder reads like the output export. Same shape as a deck
/// monitor.
#[cfg(any(target_os = "macos", target_os = "windows"))]
pub(crate) struct RecordOutputTarget {
    pub(crate) _render_texture: wgpu::Texture,
    pub(crate) render_view: wgpu::TextureView,
    pub(crate) export: NativeOutputExport,
    pub(crate) alpha: bool,
}

/// Upper bound on simultaneously-presented slice displays. Each one costs a
/// full composite pass per frame, so this is a guardrail against a project
/// with dozens of configured screens stalling the render loop.
pub(crate) const MAX_SLICE_OUTPUTS: usize = 32;

pub(crate) const MAX_SLICE_TEXTURE_BYTES: u64 = 512 * 1024 * 1024;

pub(crate) fn validate_slice_outputs(params: &Value) -> Result<(), String> {
    let entries = params.get("slices").and_then(Value::as_array)
        .ok_or_else(|| "screen outputs must be an array".to_string())?;
    if entries.len() > MAX_SLICE_OUTPUTS {
        return Err(format!("At most {MAX_SLICE_OUTPUTS} screen outputs can be open at once."));
    }
    let mut ids = HashSet::new();
    let mut bytes = 0u64;
    for entry in entries {
        let id = entry.get("id").and_then(Value::as_str).filter(|id| !id.trim().is_empty())
            .ok_or_else(|| "Every screen output needs an ID.".to_string())?;
        if !ids.insert(id) { return Err(format!("Duplicate screen output: {id}")); }
        let width = number_at(entry, &["width"]).unwrap_or(1920.0).clamp(16.0, 16384.0) as u64;
        let height = number_at(entry, &["height"]).unwrap_or(1080.0).clamp(16.0, 16384.0) as u64;
        bytes = bytes.saturating_add(width * height * 8);
    }
    if bytes > MAX_SLICE_TEXTURE_BYTES {
        return Err("Screen outputs exceed the 512 MiB texture budget. Close an output or lower its display resolution.".to_string());
    }
    Ok(())
}

/// Editor-side description of a slice output: where it presents and how the
/// master composition maps onto it.
#[derive(Clone)]
pub(crate) struct SliceOutputSpec {
    pub(crate) id: String,
    pub(crate) width: u32,
    pub(crate) height: u32,
    pub(crate) stage: OutputStage,
    /// Map Sim projector whose view this slice shows instead of a crop of
    /// the master.
    pub(crate) projector_view: Option<String>,
    /// A mirror dome: the Screen shows the dome picture through this warp
    /// mesh instead of a crop of the master (`draw_mirror_dome`). The id
    /// stays when the mesh has not arrived yet, so it attaches when it does.
    pub(crate) mirror_mesh_id: Option<String>,
    pub(crate) mirror_mesh: Option<Arc<MirrorMesh>>,
    /// The Syphon / Spout sender this Screen publishes under, when it is a
    /// sender Screen and the app has the core publish Screen senders
    /// (texture_share.rs).
    pub(crate) sender: Option<String>,
}

pub(crate) fn output_dimensions_admitted(width: u32, height: u32) -> bool {
    // Mirror, two creative ping-pong targets, snapshot, depth, and export.
    width > 0 && height > 0 && width <= 8192 && height <= 8192
        && (width as u64).saturating_mul(height as u64).saturating_mul(24) <= 512 * 1024 * 1024
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn screen_output_admission_is_bounded_by_count_and_memory() {
        use serde_json::json;
        let screens = |count: usize, width: u32, height: u32| json!({ "slices": (0..count)
            .map(|i| json!({ "id": format!("screen-{i}"), "width": width, "height": height })).collect::<Vec<_>>() });
        assert!(super::validate_slice_outputs(&screens(32, 1920, 1080)).is_ok());
        assert!(super::validate_slice_outputs(&screens(33, 64, 64)).is_err());
        assert!(super::validate_slice_outputs(&screens(9, 3840, 2160)).is_err());
        assert!(super::validate_slice_outputs(&screens(8, 3840, 2160)).is_ok());
        assert!(super::validate_slice_outputs(&screens(0, 64, 64)).is_ok());
        assert!(super::validate_slice_outputs(&json!({})).is_err());
        assert!(super::validate_slice_outputs(&json!({ "slices": [{"id":"a"}, {"id":"a"}] })).is_err());
        assert!(super::validate_slice_outputs(&json!({ "slices": [{"id":" "}] })).is_err());
    }
}
