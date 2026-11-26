//! Adapter, device and surface setup, presentation modes, and the test hook
//! that simulates a lost device.

use crate::*;

/// The GPU's memory: Metal's recommended working set (on Apple silicon a
/// share of the unified memory), or a D3D12 adapter's own memory.
/// LUID as written to the presenters: HighPart then LowPart, 8 hex digits each.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub(crate) fn format_adapter_luid(high: i32, low: u32) -> String {
    format!("{:08x}{:08x}", high as u32, low)
}

pub(crate) fn renderer_adapter_luid(device: &wgpu::Device) -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        let hal_device = unsafe { device.as_hal::<wgpu::hal::api::Dx12>() }?;
        let luid = unsafe { hal_device.raw_device().GetAdapterLuid() };
        return Some(format_adapter_luid(luid.HighPart, luid.LowPart));
    }
    #[allow(unreachable_code)]
    {
        let _ = device;
        None
    }
}

pub(crate) fn gpu_memory_bytes(device: &wgpu::Device) -> Option<u64> {
    #[cfg(target_os = "macos")]
    {
        use objc2_metal::MTLDevice;
        let hal_device = unsafe { device.as_hal::<wgpu::hal::api::Metal>() }?;
        let bytes = hal_device.raw_device().recommendedMaxWorkingSetSize();
        return (bytes > 0).then_some(bytes);
    }
    #[cfg(target_os = "windows")]
    {
        return windows_video_texture::adapter_memory_bytes(device);
    }
    #[allow(unreachable_code)]
    {
        let _ = device;
        None
    }
}

/// Env var for the device-loss test hook: the number of frames after which
/// the core destroys its own GPU device, once per core process.
pub(crate) const TEST_DEVICE_LOSS_ENV: &str = "GA_CORE_TEST_DEVICE_LOSS";

pub(crate) struct TestDeviceLoss {
    pub(crate) after_frames: u64,
    /// Read by the device-lost callback, so the destroy is reported as a loss.
    pub(crate) fired: Arc<std::sync::atomic::AtomicBool>,
}

impl TestDeviceLoss {
    pub(crate) fn parse(value: Option<&str>) -> Option<u64> {
        value.and_then(|value| value.trim().parse::<u64>().ok()).filter(|frames| *frames > 0)
    }

    pub(crate) fn from_env(fired: Arc<std::sync::atomic::AtomicBool>) -> Option<Self> {
        let after_frames = Self::parse(std::env::var(TEST_DEVICE_LOSS_ENV).ok().as_deref())?;
        eprintln!("[ghost-core] TEST: the GPU device will be destroyed after {after_frames} frames ({TEST_DEVICE_LOSS_ENV})");
        Some(Self { after_frames, fired })
    }

    pub(crate) fn due(&self, frames_submitted: u64) -> bool {
        frames_submitted >= self.after_frames
    }
}

#[cfg(test)]
mod test_device_loss_tests {
    use super::TestDeviceLoss;

    #[test]
    fn test_device_loss_hook_is_off_unless_given_a_frame_count() {
        assert_eq!(TestDeviceLoss::parse(None), None);
        assert_eq!(TestDeviceLoss::parse(Some("")), None);
        assert_eq!(TestDeviceLoss::parse(Some("0")), None);
        assert_eq!(TestDeviceLoss::parse(Some("yes")), None);
        assert_eq!(TestDeviceLoss::parse(Some(" 120 ")), Some(120));
    }
}

#[derive(Clone, Copy, Debug)]
pub(crate) enum SurfacePresentOutcome {
    Presented,
    SuboptimalPresented,
    Offscreen,
    Outdated,
    Timeout,
    Occluded,
}

impl SurfacePresentOutcome {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Presented => "presented",
            Self::SuboptimalPresented => "suboptimal-presented",
            Self::Offscreen => "offscreen",
            Self::Outdated => "outdated",
            Self::Timeout => "timeout",
            Self::Occluded => "occluded",
        }
    }

    pub(crate) fn presented(self) -> bool {
        matches!(self, Self::Presented | Self::SuboptimalPresented)
    }

    pub(crate) fn offscreen(self) -> bool {
        matches!(self, Self::Offscreen)
    }
}

/// Linux: whether the core runs on X11 and so can present Screens itself.
/// See main().
///
/// Decided once, and only after checking the libraries winit's X11 backend
/// loads at runtime. It does not fail gracefully without them: a missing
/// libxkbcommon-x11 is a panic inside xkbcommon-dl, so committing to X11 on a
/// machine that lacks it crashed the core at launch -- NATIVE OFFLINE, which
/// is worse than having no native Screens. Electron runs on X11 without that
/// library, so nothing else would flag it. If any is missing, stay on winit's
/// default backend and report Screens unavailable instead.
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub(crate) fn linux_x11_presentation() -> bool {
    linux_x11_unavailable_reason().is_none()
}

/// Why the core is not on X11, or None when it is. Reported to the editor so
/// the reason it shows is the real one.
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub(crate) fn linux_x11_unavailable_reason() -> Option<&'static str> {
    static REASON: std::sync::OnceLock<Option<String>> = std::sync::OnceLock::new();
    REASON.get_or_init(|| {
        if std::env::var("GA_LINUX_WAYLAND").is_ok_and(|value| value == "1") {
            return Some("GA_LINUX_WAYLAND=1 is set, so the core runs on Wayland, where a Screen cannot be parented into its window".to_string());
        }
        if std::env::var_os("DISPLAY").is_none() {
            let reason = "there is no X display (DISPLAY is unset), so the core cannot run on X11".to_string();
            eprintln!("[ghost-core] {reason}; native Screens are unavailable");
            return Some(reason);
        }
        const X11_LIBRARIES: [&str; 7] = [
            "libX11.so.6", "libX11-xcb.so.1", "libxcb.so.1", "libXcursor.so.1",
            "libXrandr.so.2", "libXi.so.6", "libxkbcommon-x11.so.0",
        ];
        for library in X11_LIBRARIES {
            // SAFETY: loading only to prove the library resolves; it is
            // dropped straight away and no symbol from it is called.
            if unsafe { libloading::Library::new(library) }.is_err() {
                let reason = format!("{library} is not installed, so the core cannot run on X11 (install it to enable native Screens)");
                eprintln!("[ghost-core] {reason}; staying on the default window backend");
                return Some(reason);
            }
        }
        None
    }).as_deref()
}

pub(crate) fn native_backend_name() -> &'static str {
    if cfg!(target_os = "macos") {
        "metal"
    } else if cfg!(target_os = "windows") {
        "d3d12"
    } else {
        "vulkan"
    }
}

pub(crate) fn choose_present_mode(
    supported: &[wgpu::PresentMode],
    requested: &str,
    allow_tearing: bool,
) -> wgpu::PresentMode {
    let wants_immediate = matches!(
        requested.trim().to_ascii_lowercase().as_str(),
        "immediate" | "no-vsync" | "novsync"
    );
    if wants_immediate {
        if allow_tearing && supported.contains(&wgpu::PresentMode::Immediate) {
            return wgpu::PresentMode::Immediate;
        }
        if supported.contains(&wgpu::PresentMode::Mailbox) {
            return wgpu::PresentMode::Mailbox;
        }
        if supported.contains(&wgpu::PresentMode::Immediate) {
            return wgpu::PresentMode::Immediate;
        }
        if supported.contains(&wgpu::PresentMode::AutoNoVsync) {
            return wgpu::PresentMode::AutoNoVsync;
        }
    }
    if supported.contains(&wgpu::PresentMode::Fifo) {
        return wgpu::PresentMode::Fifo;
    }
    if supported.contains(&wgpu::PresentMode::AutoVsync) {
        return wgpu::PresentMode::AutoVsync;
    }
    supported
        .first()
        .copied()
        .unwrap_or(wgpu::PresentMode::AutoVsync)
}

/// Present mode for a Linux Screen (slice) window. Every Screen is acquired
/// and presented in turn on the main thread, so with FIFO each one waited for
/// its own vblank and N projectors divided the frame rate by N. Mailbox never
/// blocks and never tears, so it comes first; then the non-blocking modes the
/// surface has; FIFO, the one mode every surface must support, last. The
/// program window keeps its own pacing (`choose_present_mode`).
#[cfg_attr(any(target_os = "macos", target_os = "windows"), allow(dead_code))]
pub(crate) fn linux_slice_present_mode(supported: &[wgpu::PresentMode]) -> wgpu::PresentMode {
    [wgpu::PresentMode::Mailbox, wgpu::PresentMode::Immediate, wgpu::PresentMode::FifoRelaxed]
        .into_iter()
        .find(|mode| supported.contains(mode))
        .unwrap_or(wgpu::PresentMode::Fifo)
}

pub(crate) fn present_mode_label(mode: wgpu::PresentMode) -> &'static str {
    match mode {
        wgpu::PresentMode::AutoVsync => "auto-vsync",
        wgpu::PresentMode::AutoNoVsync => "auto-no-vsync",
        wgpu::PresentMode::Fifo => "fifo",
        wgpu::PresentMode::FifoRelaxed => "fifo-relaxed",
        wgpu::PresentMode::Immediate => "immediate",
        wgpu::PresentMode::Mailbox => "mailbox",
    }
}

impl App {
    pub(crate) fn ensure_renderer(&mut self, event_loop: &ActiveEventLoop) -> Result<(), String> {
        if self.renderer.as_ref().is_some_and(|r| r.gpu_fault) {
            return Err("GPU fault: restart the renderer process before starting output".to_string());
        }
        if self.renderer.is_some() {
            return Ok(());
        }
        let mut attrs = WindowAttributes::default()
            .with_title("Ghost Render Core")
            .with_inner_size(LogicalSize::new(
                self.pending_width as f64,
                self.pending_height as f64,
            ))
            .with_resizable(true)
            .with_visible(self.output_window_attached);
        self.editor_preview_parented_window = false;
        let mut editor_parent_handle_for_underlay: Option<RawWindowHandle> = None;
        if cfg!(target_os = "macos") {
            if let Some(handle_hex) = self.editor_parent_window_handle_hex.as_deref() {
                if matches!(
                    self.editor_parent_window_handle_platform.as_deref(),
                    Some("appkit-nsview") | Some("darwin") | Some("macos") | None
                ) {
                    if let Some(parent_handle) = appkit_parent_window_handle(handle_hex) {
                        // SAFETY: Electron owns this NSView for the lifetime of the main window.
                        // If the handle is stale, winit returns a creation error instead of
                        // silently making an unparented preview.
                        attrs = unsafe { attrs.with_parent_window(Some(parent_handle)) };
                        self.editor_preview_parented_window = true;
                        editor_parent_handle_for_underlay = Some(parent_handle);
                    }
                }
            }
        }
        let window = event_loop
            .create_window(attrs)
            .map_err(|err| err.to_string())?;
        let window = Arc::new(window);
        if let Some(parent_handle) = editor_parent_handle_for_underlay {
            self.editor_preview_parented_window =
                promote_appkit_child_window_to_underlay(parent_handle, &window);
        }
        let renderer = pollster::block_on(RenderState::new(
            window,
            self.pending_width.max(1),
            self.pending_height.max(1),
            &self.present_mode,
            self.allow_tearing,
            self.max_frame_latency,
            &self.native_quality.policy,
            self.event_proxy.clone(),
        ))?;
        self.native_quality
            .rebase_to_caps(&renderer.native_caps.recommended_quality_tier);
        self.adapter_name = renderer.adapter_name();
        self.adapter_is_software = renderer.adapter_is_software;
        self.adapter_luid = renderer_adapter_luid(&renderer.device);
        self.frame_counter_name = renderer.frame_counter_name.clone();
        self.gpu_memory_bytes = gpu_memory_bytes(&renderer.device);
        self.renderer = Some(renderer);
        self.apply_video_memory_budget();
        Ok(())
    }
}

impl RenderState {
    pub(crate) async fn new(
        window: Arc<Window>,
        width: u32,
        height: u32,
        present_mode: &str,
        allow_tearing: bool,
        max_frame_latency: u32,
        source_frame_quality_policy: &str,
        event_proxy: EventLoopProxy<UserEvent>,
    ) -> Result<Self, String> {
        // Pin the backend to the one `native_backend_name()` reports and the
        // shared-texture transports are written against. `Instance::default()`
        // enables Backends::all(), and on Windows wgpu will happily pick Vulkan
        // for an NVIDIA adapter — which makes every `as_hal::<Dx12>()` call
        // (output export, DXGI source import, slice export) return None while
        // the status line still claims `backend=d3d12`.
        let mut instance_descriptor = wgpu::InstanceDescriptor::new_without_display_handle();
        #[cfg(target_os = "windows")]
        {
            instance_descriptor.backends = wgpu::Backends::DX12;
            // Use DXC rather than FXC. wgpu's default `Auto` only reaches DXC if
            // it is statically linked or already discoverable; otherwise it
            // silently falls back to FXC, which spends ~50s compiling the shader
            // warm-up set on every cold start. dxcompiler.dll (and dxil.dll, for
            // shader signing) are copied next to the executable at build time, so
            // the plain filename resolves via the standard DLL search order.
            instance_descriptor.backend_options.dx12.shader_compiler =
                wgpu::Dx12Compiler::default_dynamic_dxc();
        }
        #[cfg(target_os = "macos")]
        {
            instance_descriptor.backends = wgpu::Backends::METAL;
        }
        let instance = wgpu::Instance::new(instance_descriptor);
        let surface = instance
            .create_surface(Arc::clone(&window))
            .map_err(|err| err.to_string())?;
        // Prefer a real GPU, but never let adapter selection be the difference
        // between "runs slowly" and "does not run at all": the desktop app is
        // native-only, so a failure here leaves it with no renderer whatsoever.
        // The retry asks for the platform's software adapter (WARP on D3D12),
        // which is slow but crucially still the SAME backend — so the
        // shared-texture transports (Spout/Syphon out, source import, slice and
        // deck exports) keep working. Falling back to a different backend would
        // render faster and silently lose every texture-sharing feature, which
        // is the worse outcome for a tool whose job is getting pixels out.
        let adapter = match instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                force_fallback_adapter: false,
                compatible_surface: Some(&surface),
                apply_limit_buckets: false,
            })
            .await
        {
            Ok(adapter) => adapter,
            Err(primary_err) => {
                eprintln!(
                    "[ghost-core] no hardware adapter for backend {} ({primary_err}); retrying with the software fallback adapter",
                    native_backend_name()
                );
                instance
                    .request_adapter(&wgpu::RequestAdapterOptions {
                        power_preference: wgpu::PowerPreference::LowPower,
                        force_fallback_adapter: true,
                        compatible_surface: Some(&surface),
                        apply_limit_buckets: false,
                    })
                    .await
                    .map_err(|fallback_err| {
                        format!(
                            "No compatible GPU found. Ghost Arcade needs a {} capable graphics adapter. \
                             Hardware adapter error: {primary_err}. Software fallback error: {fallback_err}.",
                            native_backend_name().to_uppercase()
                        )
                    })?
            }
        };
        let adapter_info = adapter.get_info();
        let adapter_is_software = adapter_info.device_type == wgpu::DeviceType::Cpu;
        if adapter_is_software {
            eprintln!(
                "[ghost-core] WARNING: running on a SOFTWARE adapter ({}). Expect very low frame rates; this is a compatibility fallback, not a supported configuration.",
                adapter_info.name
            );
        }
        eprintln!(
            "[ghost-core] adapter selected: name={} backend={:?} driver={} driver_info={} vendor={:#06x} device={:#06x} type={:?} reported_backend_name={}",
            adapter_info.name,
            adapter_info.backend,
            adapter_info.driver,
            adapter_info.driver_info,
            adapter_info.vendor,
            adapter_info.device,
            adapter_info.device_type,
            native_backend_name()
        );
        let adapter_limits = adapter.limits();
        let adapter_features = adapter.features();
        let source_frame_format = choose_source_frame_format(&adapter);
        let source_frame_size = choose_source_frame_size(
            &adapter_limits,
            adapter_features,
            source_frame_format,
            source_frame_quality_policy,
        );
        let source_frame_mip_levels = source_frame_mip_levels(source_frame_size);
        let source_frame_bindings = PER_SOURCE_SLOT_BINDINGS
            .min(adapter_limits.max_binding_array_elements_per_shader_stage as usize);
        let source_frame_mode = choose_source_frame_mode(adapter_features, source_frame_bindings);
        let mut requested_features = adapter_features.intersection(native_optional_features());
        if source_frame_mode == SourceFrameMode::PerSource {
            requested_features |= PER_SOURCE_SLOT_FEATURES;
        }
        // Compiled pipelines saved between runs, where the backend offers it
        // (pipeline_cache.rs). Not part of the reported capabilities.
        let caps_features = requested_features;
        if pipeline_cache::wanted() {
            requested_features |= adapter_features & wgpu::Features::PIPELINE_CACHE;
        }
        // The raster compositor's accumulation target blends in f32.
        if raster_compositor_requested() {
            requested_features |= adapter_features & wgpu::Features::FLOAT32_BLENDABLE;
        }
        eprintln!(
            "[GhostRenderCore] picture slots: {} (slot edge {}, binding array {})",
            source_frame_mode.label(), source_frame_size,
            if source_frame_mode == SourceFrameMode::PerSource { source_frame_bindings } else { 0 }
        );
        let native_caps = native_gpu_caps(
            &adapter_info,
            &adapter_limits,
            adapter_features,
            caps_features,
        );
        let (device, queue) = adapter
            .request_device(&wgpu::DeviceDescriptor {
                label: Some("Ghost Render Core Device"),
                required_features: requested_features,
                required_limits: wgpu::Limits {
                    // The shared slot array grows toward the device's limit.
                    max_texture_array_layers: adapter_limits.max_texture_array_layers,
                    max_binding_array_elements_per_shader_stage:
                        if source_frame_mode == SourceFrameMode::PerSource { source_frame_bindings as u32 } else { 0 },
                    ..wgpu::Limits::default()
                },
                experimental_features: wgpu::ExperimentalFeatures::disabled(),
                memory_hints: wgpu::MemoryHints::Performance,
                trace: wgpu::Trace::Off,
            })
            .await
            .map_err(|err| err.to_string())?;
        // Before any pipeline is built, so all of them can use it.
        let disk_pipeline_cache = pipeline_cache::DiskPipelineCache::open(&device, &adapter_info);
        let test_device_loss_fired = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let test_device_loss = TestDeviceLoss::from_env(Arc::clone(&test_device_loss_fired));
        // A driver reset (Windows TDR), a hung GPU or an unplugged external
        // GPU ends the device. Say so in the log with the adapter, so a support
        // log tells a GPU fault from a fault in the app, and raise the same
        // GPU fault the completion watchdog raises: the core stops rendering
        // on a dead device and the app restarts it instead of the show
        // freezing on the last frame.
        {
            let adapter_label = format!(
                "{} ({:?}, driver {} {})",
                adapter_info.name, adapter_info.backend, adapter_info.driver, adapter_info.driver_info
            );
            let lost_proxy = event_proxy.clone();
            let forced = Arc::clone(&test_device_loss_fired);
            device.set_device_lost_callback(move |reason, message| {
                // The core destroys its own device on shutdown; that is not a
                // loss. The test hook's destroy is, and goes the same way.
                if matches!(reason, wgpu::DeviceLostReason::Destroyed) && !forced.load(Ordering::Acquire) {
                    return;
                }
                eprintln!("[ghost-core] GPU DEVICE LOST on {adapter_label}: reason={reason:?} {message}");
                let _ = lost_proxy.send_event(UserEvent::GpuFrameFailed(format!(
                    "GPU device lost ({reason:?}: {message}); restart the renderer process to recover"
                )));
            });
        }
        // Without a handler wgpu panics on any error no error scope caught,
        // which aborts the process mid-show. A validation error only
        // invalidates the work it was raised on, so log it and keep going;
        // running out of GPU memory or an internal driver error leaves the
        // device unreliable, so report it as a GPU fault for a restart.
        {
            let error_proxy = event_proxy.clone();
            let validation_errors = Arc::new(AtomicU64::new(0));
            device.on_uncaptured_error(Arc::new(move |error: wgpu::Error| match error {
                wgpu::Error::Validation { description, .. } => {
                    let count = validation_errors.fetch_add(1, Ordering::Relaxed) + 1;
                    // The same error usually repeats every frame: log the
                    // first few, then a periodic count.
                    if count <= 5 || count.is_power_of_two() {
                        eprintln!("[ghost-core] GPU validation error #{count} (frame work skipped): {description}");
                    }
                }
                wgpu::Error::OutOfMemory { source } => {
                    eprintln!("[ghost-core] GPU out of memory: {source}");
                    let _ = error_proxy.send_event(UserEvent::GpuFrameFailed(format!(
                        "GPU out of memory ({source}); restart the renderer process to recover"
                    )));
                }
                wgpu::Error::Internal { description, .. } => {
                    eprintln!("[ghost-core] GPU internal error: {description}");
                    let _ = error_proxy.send_event(UserEvent::GpuFrameFailed(format!(
                        "GPU internal error ({description}); restart the renderer process to recover"
                    )));
                }
            }));
        }

        let caps = surface.get_capabilities(&adapter);
        // Boundary contract: render linear internally, then store/publish
        // sRGB-encoded BGRA8 at every app-visible output boundary. Prefer the
        // exact storage format first and fall back only if the platform does
        // not expose it.
        let format = caps
            .formats
            .iter()
            .copied()
            .find(|format| *format == wgpu::TextureFormat::Bgra8Unorm)
            .or_else(|| {
                caps.formats
                    .iter()
                    .copied()
                    .find(|format| !format.is_srgb())
            })
            .unwrap_or(caps.formats[0]);
        let supported_present_modes = caps.present_modes.clone();
        let present_mode =
            choose_present_mode(&supported_present_modes, present_mode, allow_tearing);
        let surface_copy_dst_supported = caps.usages.contains(wgpu::TextureUsages::COPY_DST);
        if !output_dimensions_admitted(width, height) || width > device.limits().max_texture_dimension_2d || height > device.limits().max_texture_dimension_2d {
            return Err("output dimensions exceed texture budget or device limits".to_string());
        }
        let config = wgpu::SurfaceConfiguration {
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT
                | if surface_copy_dst_supported {
                    wgpu::TextureUsages::COPY_DST
                } else {
                    wgpu::TextureUsages::empty()
                },
            format,
            color_space: wgpu::SurfaceColorSpace::Srgb,
            width: width.max(1),
            height: height.max(1),
            present_mode,
            desired_maximum_frame_latency: max_frame_latency.clamp(1, 8),
            alpha_mode: caps.alpha_modes[0],
            view_formats: vec![],
        };
        surface.configure(&device, &config);

        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("Ghost Render Core Heartbeat"),
            source: wgpu::ShaderSource::Wgsl(
                heartbeat_wgsl(source_frame_mode, source_frame_bindings, false).into(),
            ),
        });
        let native_shader_vertex_module =
            device.create_shader_module(wgpu::ShaderModuleDescriptor {
                label: Some("Ghost Render Core Native Shader Fullscreen Vertex"),
                source: wgpu::ShaderSource::Wgsl(NATIVE_SHADER_FULLSCREEN_VERTEX_WGSL.into()),
            });
        let uniform_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("Ghost Render Core Uniforms"),
            contents: bytemuck::bytes_of(&Uniforms {
                resolution: [config.width as f32, config.height as f32],
                time: 0.0,
                command_phase: 0.0,
                layer_count: 0.0,
                frame_count: 0.0,
                output_gate: 1.0,
                post_count: 0.0,
                post: [[0.0; 4]; 8],
                out0: [0.0, 0.0, 1.0, 1.0],
                out1: [0.0, 1.0, 1.0, 1.0],
                edge: [0.0; 4],
                dome0: [0.0; 4],
                dome1: [0.0; 4],
                dome2: [1.0, 2.2, 0.0, 0.0],
                edge_gamma: [2.2; 4],
                black_level: [0.0; 4],
                projector_calibration: [[0.0; 4]; 5],
                swarp: [0.0; 4],
                swarp_c0: [0.0, 0.0, 1.0, 0.0],
                swarp_c1: [1.0, 1.0, 0.0, 1.0],
                mwarp: [0.0; 4],
                mwarp_c0: [0.0, 0.0, 1.0, 0.0],
                mwarp_c1: [1.0, 1.0, 0.0, 1.0],
                swarp_mesh: [[0.0; 4]; 128],
                mwarp_mesh: [[0.0; 4]; 128],
                smask: [0.0; 4],
                smask_info: [[0.0; 4]; MAX_SCREEN_MASKS],
                smask_bounds: [[0.0; 4]; MAX_SCREEN_MASKS],
                smask_pts: [[0.0; 4]; MAX_SCREEN_MASK_VEC4S],
                swarp_tangents: [[0.0; 4]; WARP_MESH_TANGENT_VEC4S],
                mwarp_tangents: [[0.0; 4]; WARP_MESH_TANGENT_VEC4S],
                audio0: [0.0; 4],
                audio1: [0.0; 4],
                audio2: [0.0; 4],
                clock: [0.0, 120.0, 0.0, 0.0],
                flux0: [0.0; 4],
                flux1: [0.0; 4],
                flux_regions: [[0.0; 4]; MAX_FLUX_REGIONS],
                dome3: OutputStage::default().dome3,
                dome4: OutputStage::default().dome4,
                dlayer: [0.0; 4],
                dview: [0.0; 4],
                dview1: [0.0; 4],
                dproj0: [0.0; 4],
                dproj1: [0.0; 4],
                dprojs: [[0.0; 4]; 32],
            }),
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        });
        let native_shader_uniform_buffer =
            device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("Ghost Render Core Native Shader Uniforms"),
                contents: bytemuck::bytes_of(&NativeShaderUniforms::zeroed()),
                usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            });
        let empty_layers = vec![LayerCoreGpu::zeroed(); MAX_SCENE_LAYERS];
        let layer_pool = LayerPoolState::new(&device, "Ghost Render Core Layer Pool");
        let layer_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("Ghost Render Core Scene Layers"),
            contents: bytemuck::cast_slice(&empty_layers),
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
        });
        // Starts with binning off (enabled = 0): every pixel walks the layers.
        // Mesh cell bounds follow the tiles; their directory starts at zero
        // (no layer has boxes) as the buffer does.
        let layer_tile_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Ghost Render Core Layer Tiles"),
            size: ((LAYER_TILE_BUFFER_WORDS + MESH_CELL_BOUNDS_WORDS) * std::mem::size_of::<u32>()) as u64,
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let empty_previews =
            vec![PreviewPixel::zeroed(); MAX_SOURCE_PREVIEWS * SOURCE_PREVIEW_PIXELS];
        let source_preview_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("Ghost Render Core Source Previews"),
            contents: bytemuck::cast_slice(&empty_previews),
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
        });
        let source_frame_store = SourceFrameStore::new(
            &device,
            &queue,
            source_frame_mode,
            source_frame_format,
            source_frame_size as u32,
            source_frame_mip_levels,
            INITIAL_SOURCE_FRAME_SLOTS,
            match source_frame_mode {
                SourceFrameMode::Shared => shared_source_frame_slot_ceiling(
                    &adapter_limits, source_frame_size, source_frame_format, source_frame_quality_policy,
                    adapter_features),
                SourceFrameMode::PerSource => source_frame_bindings,
            },
            PER_SOURCE_MAX_DIMENSION.min(adapter_limits.max_texture_dimension_2d),
        );
        let source_frame_sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("Ghost Render Core Source Frame Sampler"),
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            address_mode_w: wgpu::AddressMode::ClampToEdge,
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            mipmap_filter: wgpu::MipmapFilterMode::Linear,
            lod_min_clamp: 0.0,
            lod_max_clamp: 0.0,
            ..Default::default()
        });
        // Every compositor read names its level (textureSampleLevel), so
        // opening the levels changes only the reads that ask for one.
        let compositor_sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("Ghost Render Core Compositor Sampler"),
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            address_mode_w: wgpu::AddressMode::ClampToEdge,
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            mipmap_filter: wgpu::MipmapFilterMode::Linear,
            lod_min_clamp: 0.0,
            lod_max_clamp: 32.0,
            ..Default::default()
        });
        let source_frame_mips = graph_textures::BoxMips::new(&device, source_frame_format);
        let source_frame_blitter = TextureBlitterBuilder::new(&device, source_frame_format)
            .sample_type(wgpu::FilterMode::Linear)
            .build();
        let hap_converter = hap_texture::HapTextureConverter::new(&device, source_frame_format);
        #[cfg(target_os = "macos")]
        let video_converter = video_texture::GpuVideoConverter::new(&device, source_frame_format);
        #[cfg(target_os = "windows")]
        let video_converter = windows_video_texture::GpuVideoConverter::new(&device, source_frame_format);
        #[cfg(target_os = "windows")]
        let video_device = windows_video_texture::WindowsVideoDevice::new(&device);
        // Same size and format as the mirror, so this is a straight copy of
        // the pixels rather than a rescale.
        let composite_frame_blitter = TextureBlitterBuilder::new(&device, format)
            .sample_type(wgpu::FilterMode::Linear)
            .build();
        let (output_mirror_texture, output_mirror_view) = Self::create_offscreen_target(
            &device,
            config.width,
            config.height,
            format,
            "Ghost Render Core Output Mirror",
        );
        let composite_frame_textures = [
            Self::create_composite_frame_target(&device, config.width, config.height, format),
            Self::create_composite_frame_target(&device, config.width, config.height, format),
        ];
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        let output_export = Self::create_output_export_target(
            &device,
            config.width,
            config.height,
            native_output_export_format(format),
        )
        .map_err(|err| {
            eprintln!("[ghost-core] output export target failed at init: {err}");
            err
        })
        .ok();
        let (snapshot_texture, snapshot_view) = Self::create_offscreen_target(
            &device,
            config.width,
            config.height,
            format,
            "Ghost Render Core Snapshot Mirror",
        );
        // Picture slots get a bind group of their own (group 1): a binding
        // array may not share a group with uniform buffers.
        let source_frames_bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("Ghost Render Core Source Frames Layout"),
            entries: &[source_frames::source_frames_layout_entry(
                source_frame_mode, 0, source_frame_bindings, wgpu::ShaderStages::FRAGMENT)],
        });
        let source_frames_bind_group = build_source_frames_bind_group(
            &device, &source_frames_bind_group_layout, &source_frame_store, source_frame_bindings);
        let bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("Ghost Render Core Bind Group Layout"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Storage { read_only: true },
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 2,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Storage { read_only: true },
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 4,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    count: None,
                },
                // Painted masks (paint_mask.rs): one R8 array layer per
                // painted layer. A 1x1 placeholder until something is painted.
                wgpu::BindGroupLayoutEntry {
                    binding: 5,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: true },
                        view_dimension: wgpu::TextureViewDimension::D2Array,
                        multisampled: false,
                    },
                    count: None,
                },
                // Tile bins for the composite (LAYER_TILES).
                wgpu::BindGroupLayoutEntry {
                    binding: 6,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Storage { read_only: true },
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                // Layer pool records (pack_layer_pools).
                wgpu::BindGroupLayoutEntry {
                    binding: 7,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Storage { read_only: true },
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
            ],
        });
        let paint_mask_texture = Self::create_paint_mask_texture(&device, 1, 1);
        let paint_mask_view = paint_mask_texture.create_view(&wgpu::TextureViewDescriptor {
            label: Some("Ghost Render Core Paint Mask View"),
            dimension: Some(wgpu::TextureViewDimension::D2Array),
            ..Default::default()
        });
        queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &paint_mask_texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            &[255u8],
            wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(1), rows_per_image: Some(1) },
            wgpu::Extent3d { width: 1, height: 1, depth_or_array_layers: 1 },
        );
        let bind_group = build_scene_bind_group(
            &device,
            &bind_group_layout,
            &uniform_buffer,
            &layer_buffer,
            &layer_pool.buffer,
            &source_preview_buffer,
            &compositor_sampler,
            &paint_mask_view,
            &layer_tile_buffer,
        );
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Ghost Render Core Pipeline Layout"),
            bind_group_layouts: &[Some(&bind_group_layout), Some(&source_frames_bind_group_layout)],
            immediate_size: 0,
        });
        let pipeline = compositor_pipeline(&device, &pipeline_layout, &shader, format, "Ghost Render Core Pipeline");
        // The build with source mips, made on a worker: until it is ready a
        // frame that wants mips draws with `pipeline` (level zero, as before).
        let mips_pipeline: Arc<std::sync::OnceLock<wgpu::RenderPipeline>> = Arc::new(std::sync::OnceLock::new());
        if source_mips_enabled() {
            let (device, layout, slot) = (device.clone(), pipeline_layout.clone(), Arc::clone(&mips_pipeline));
            let _ = thread::Builder::new().name("ghost-compositor-mips".to_string()).spawn(move || {
                let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
                    label: Some("Ghost Render Core Heartbeat (source mips)"),
                    source: wgpu::ShaderSource::Wgsl(
                        heartbeat_wgsl(source_frame_mode, source_frame_bindings, true).into()),
                });
                let _ = slot.set(compositor_pipeline(&device, &layout, &shader, format,
                    "Ghost Render Core Pipeline (source mips)"));
            });
        }

        let raster = if raster_compositor_requested() {
            RasterCompositor::new(&device, &bind_group_layout, &source_frames_bind_group_layout,
                source_frame_mode, source_frame_bindings, format)
        } else {
            None
        };

        let output_presenter = output_present::OutputPresenter::new(&device, &shader, format, &composite_frame_textures);

        let stage3d_overlay_shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("Ghost Render Core Stage3D Overlay"),
            source: wgpu::ShaderSource::Wgsl(STAGE3D_OVERLAY_WGSL.into()),
        });
        let stage3d_overlay_uniform_buffer =
            device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("Ghost Render Core Stage3D Overlay Uniforms"),
                contents: bytemuck::bytes_of(&Stage3DOverlayUniforms {
                    resolution: [config.width as f32, config.height as f32],
                    item_count: 0.0,
                    time: 0.0,
                }),
                usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            });
        let empty_stage3d_items = vec![Stage3DOverlayItemGpu::zeroed(); MAX_STAGE3D_OVERLAY_ITEMS];
        let stage3d_overlay_item_buffer =
            device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("Ghost Render Core Stage3D Overlay Items"),
                contents: bytemuck::cast_slice(&empty_stage3d_items),
                usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
            });
        let stage3d_overlay_bind_group_layout =
            device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("Ghost Render Core Stage3D Overlay Bind Group Layout"),
                entries: &[
                    wgpu::BindGroupLayoutEntry {
                        binding: 0,
                        visibility: wgpu::ShaderStages::FRAGMENT,
                        ty: wgpu::BindingType::Buffer {
                            ty: wgpu::BufferBindingType::Uniform,
                            has_dynamic_offset: false,
                            min_binding_size: None,
                        },
                        count: None,
                    },
                    wgpu::BindGroupLayoutEntry {
                        binding: 1,
                        visibility: wgpu::ShaderStages::FRAGMENT,
                        ty: wgpu::BindingType::Buffer {
                            ty: wgpu::BufferBindingType::Storage { read_only: true },
                            has_dynamic_offset: false,
                            min_binding_size: None,
                        },
                        count: None,
                    },
                ],
            });
        let stage3d_overlay_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Ghost Render Core Stage3D Overlay Bind Group"),
            layout: &stage3d_overlay_bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: stage3d_overlay_uniform_buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: stage3d_overlay_item_buffer.as_entire_binding(),
                },
            ],
        });
        let stage3d_overlay_pipeline_layout =
            device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some("Ghost Render Core Stage3D Overlay Pipeline Layout"),
                bind_group_layouts: &[Some(&stage3d_overlay_bind_group_layout)],
                immediate_size: 0,
            });
        let stage3d_overlay_pipeline =
            device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some("Ghost Render Core Stage3D Overlay Pipeline"),
                layout: Some(&stage3d_overlay_pipeline_layout),
                vertex: wgpu::VertexState {
                    module: &stage3d_overlay_shader,
                    entry_point: Some("vs_main"),
                    compilation_options: wgpu::PipelineCompilationOptions::default(),
                    buffers: &[],
                },
                primitive: wgpu::PrimitiveState::default(),
                depth_stencil: None,
                multisample: wgpu::MultisampleState::default(),
                fragment: Some(wgpu::FragmentState {
                    module: &stage3d_overlay_shader,
                    entry_point: Some("fs_main"),
                    compilation_options: wgpu::PipelineCompilationOptions::default(),
                    targets: &[Some(wgpu::ColorTargetState {
                        format,
                        blend: Some(wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING),
                        write_mask: wgpu::ColorWrites::ALL,
                    })],
                }),
                multiview_mask: None,
                cache: pipeline_cache::for_device(&device).as_ref(),
            });

        let stage3d_mesh_shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("Ghost Render Core Stage3D Mesh"),
            source: wgpu::ShaderSource::Wgsl(
                stage3d_mesh_wgsl(source_frame_mode, source_frame_bindings).into(),
            ),
        });
        let stage3d_mesh_uniform_buffer =
            device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("Ghost Render Core Stage3D Mesh Uniforms"),
                contents: bytemuck::bytes_of(&Stage3DMeshUniforms::zeroed()),
                usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            });
        let empty_stage3d_mesh_items = vec![Stage3DMeshItemGpu::zeroed(); MAX_STAGE3D_MESH_ITEMS];
        let stage3d_mesh_item_buffer =
            device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("Ghost Render Core Stage3D Mesh Items"),
                contents: bytemuck::cast_slice(&empty_stage3d_mesh_items),
                usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
            });
        let stage3d_mesh_bind_group_layout =
            device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("Ghost Render Core Stage3D Mesh Bind Group Layout"),
                entries: &[
                    wgpu::BindGroupLayoutEntry {
                        binding: 0,
                        visibility: wgpu::ShaderStages::VERTEX | wgpu::ShaderStages::FRAGMENT,
                        ty: wgpu::BindingType::Buffer {
                            ty: wgpu::BufferBindingType::Uniform,
                            has_dynamic_offset: false,
                            min_binding_size: None,
                        },
                        count: None,
                    },
                    wgpu::BindGroupLayoutEntry {
                        binding: 1,
                        visibility: wgpu::ShaderStages::VERTEX,
                        ty: wgpu::BindingType::Buffer {
                            ty: wgpu::BufferBindingType::Storage { read_only: true },
                            has_dynamic_offset: false,
                            min_binding_size: None,
                        },
                        count: None,
                    },
                    wgpu::BindGroupLayoutEntry {
                        binding: 3,
                        visibility: wgpu::ShaderStages::FRAGMENT,
                        ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                        count: None,
                    },
                ],
            });
        let stage3d_mesh_bind_group = build_stage3d_mesh_bind_group(
            &device,
            &stage3d_mesh_bind_group_layout,
            &stage3d_mesh_uniform_buffer,
            &stage3d_mesh_item_buffer,
            &source_frame_sampler,
        );
        let stage3d_mesh_pipeline_layout =
            device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some("Ghost Render Core Stage3D Mesh Pipeline Layout"),
                bind_group_layouts: &[Some(&stage3d_mesh_bind_group_layout), Some(&source_frames_bind_group_layout)],
                immediate_size: 0,
            });
        let stage3d_mesh_pipeline =
            device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some("Ghost Render Core Stage3D Mesh Pipeline"),
                layout: Some(&stage3d_mesh_pipeline_layout),
                vertex: wgpu::VertexState {
                    module: &stage3d_mesh_shader,
                    entry_point: Some("vs_main"),
                    compilation_options: wgpu::PipelineCompilationOptions::default(),
                    buffers: &[],
                },
                primitive: wgpu::PrimitiveState {
                    cull_mode: Some(wgpu::Face::Back),
                    ..Default::default()
                },
                depth_stencil: Some(wgpu::DepthStencilState {
                    format: wgpu::TextureFormat::Depth32Float,
                    depth_write_enabled: Some(true),
                    depth_compare: Some(wgpu::CompareFunction::Less),
                    stencil: wgpu::StencilState::default(),
                    bias: wgpu::DepthBiasState::default(),
                }),
                multisample: wgpu::MultisampleState::default(),
                fragment: Some(wgpu::FragmentState {
                    module: &stage3d_mesh_shader,
                    entry_point: Some("fs_main"),
                    compilation_options: wgpu::PipelineCompilationOptions::default(),
                    targets: &[Some(wgpu::ColorTargetState {
                        format,
                        blend: Some(wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING),
                        write_mask: wgpu::ColorWrites::ALL,
                    })],
                }),
                multiview_mask: None,
                cache: pipeline_cache::for_device(&device).as_ref(),
            });
        let (stage3d_mesh_depth_texture, stage3d_mesh_depth_view) = Self::create_depth_target(
            &device,
            config.width,
            config.height,
            "Ghost Render Core Stage3D Mesh Depth",
        );
        let (native_graph_source_depth_texture, native_graph_source_depth_view) =
            Self::create_depth_target(
                &device,
                source_frame_size as u32,
                source_frame_size as u32,
                "Ghost Native Graph Source Depth",
            );

        let native_shader_input_texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("Ghost Render Core Native Shader Input Frames"),
            size: wgpu::Extent3d {
                width: source_frame_size as u32,
                height: source_frame_size as u32,
                depth_or_array_layers: NATIVE_SHADER_INPUT_LAYERS as u32,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: source_frame_format,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST
                | wgpu::TextureUsages::RENDER_ATTACHMENT,
            view_formats: &[],
        });
        let native_shader_input_view =
            native_shader_input_texture.create_view(&wgpu::TextureViewDescriptor {
                label: Some("Ghost Render Core Native Shader Input Frame View"),
                dimension: Some(wgpu::TextureViewDimension::D2Array),
                ..Default::default()
            });
        // ISF pass targets (3..=10) and audio rows (11, 12) share the one
        // native shader layout, so single-pass pipelines stay compatible and
        // bind a 1x1 placeholder in those slots.
        let isf_dummy_texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("Ghost Render Core ISF Placeholder Texture"),
            size: wgpu::Extent3d { width: 1, height: 1, depth_or_array_layers: 1 },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        });
        let isf_dummy_texture_view = isf_dummy_texture.create_view(&wgpu::TextureViewDescriptor::default());
        let mut native_shader_layout_entries = Vec::with_capacity(3 + NATIVE_ISF_EXTRA_TEXTURE_BINDINGS as usize);
        native_shader_layout_entries.extend([
                    wgpu::BindGroupLayoutEntry {
                        binding: 0,
                        visibility: wgpu::ShaderStages::FRAGMENT,
                        ty: wgpu::BindingType::Buffer {
                            ty: wgpu::BufferBindingType::Uniform,
                            has_dynamic_offset: false,
                            min_binding_size: None,
                        },
                        count: None,
                    },
                    wgpu::BindGroupLayoutEntry {
                        binding: 1,
                        visibility: wgpu::ShaderStages::FRAGMENT,
                        ty: wgpu::BindingType::Texture {
                            sample_type: wgpu::TextureSampleType::Float { filterable: true },
                            view_dimension: wgpu::TextureViewDimension::D2Array,
                            multisampled: false,
                        },
                        count: None,
                    },
                    wgpu::BindGroupLayoutEntry {
                        binding: 2,
                        visibility: wgpu::ShaderStages::FRAGMENT,
                        ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                        count: None,
                    },
        ]);
        for binding in NATIVE_ISF_FIRST_EXTRA_BINDING..NATIVE_ISF_FIRST_EXTRA_BINDING + NATIVE_ISF_EXTRA_TEXTURE_BINDINGS {
            native_shader_layout_entries.push(wgpu::BindGroupLayoutEntry {
                binding,
                visibility: wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Texture {
                    sample_type: wgpu::TextureSampleType::Float { filterable: true },
                    view_dimension: wgpu::TextureViewDimension::D2,
                    multisampled: false,
                },
                count: None,
            });
        }
        let native_shader_bind_group_layout =
            device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("Ghost Render Core Native Shader Bind Group Layout"),
                entries: &native_shader_layout_entries,
            });
        let mut native_shader_bind_entries = vec![
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: native_shader_uniform_buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::TextureView(&native_shader_input_view),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: wgpu::BindingResource::Sampler(&source_frame_sampler),
                },
        ];
        for binding in NATIVE_ISF_FIRST_EXTRA_BINDING..NATIVE_ISF_FIRST_EXTRA_BINDING + NATIVE_ISF_EXTRA_TEXTURE_BINDINGS {
            native_shader_bind_entries.push(wgpu::BindGroupEntry {
                binding,
                resource: wgpu::BindingResource::TextureView(&isf_dummy_texture_view),
            });
        }
        let native_shader_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Ghost Render Core Native Shader Bind Group"),
            layout: &native_shader_bind_group_layout,
            entries: &native_shader_bind_entries,
        });

        window.set_title(&format!("Ghost Render Core - {}", adapter_info.name));
        pass_timing::init(&device, &queue);
        effect_specialize::set_backend(adapter_info.backend);
        let gpu_timing = requested_features
            .contains(wgpu::Features::TIMESTAMP_QUERY)
            .then(|| {
                GpuTimingState::new(
                    &device,
                    &queue,
                    requested_features.contains(wgpu::Features::TIMESTAMP_QUERY_INSIDE_ENCODERS),
                )
            });
        let gpu_frames_completed = Arc::new(AtomicU64::new(0));
        let (gpu_completion_tx, gpu_completion_rx) = mpsc::channel::<(wgpu::SubmissionIndex, Instant, Instant)>();
        let completion_device = device.clone();
        let completion_counter = Arc::clone(&gpu_frames_completed);
        let gpu_frame_latency = Arc::new(frames_in_flight::FrameLatency::default());
        let completion_latency = Arc::clone(&gpu_frame_latency);
        // Windows: completed frames are also published to the presenters,
        // which skip vblanks that would only re-copy the same frame.
        #[cfg(target_os = "windows")]
        let frame_counter = core_frame_counter::FrameCounterPublisher::create(
            &core_frame_counter::frame_counter_name(std::process::id()),
        );
        #[cfg(target_os = "windows")]
        let frame_counter_name = frame_counter.as_ref().map(|counter| counter.name().to_string());
        #[cfg(not(target_os = "windows"))]
        let frame_counter_name: Option<String> = None;
        thread::Builder::new()
            .name("ghost-gpu-completion".to_string())
            .spawn(move || {
                // A submission taking longer than one wait slice is SLOW, not
                // broken. The previous version waited a flat 5s and, on
                // timeout, reported a fault and `break`ed out of the loop --
                // killing the completion thread for the life of the process.
                // Every later frame then went unwatched, `running` stayed
                // false and the app was dead until restart.
                //
                // A 400k-point cloud exceeds 5s on its first submit, so
                // loading one bricked the session. Keep waiting across slices
                // instead, and only call it a fault once the device has failed
                // to retire a single submission for GPU_COMPLETION_HARD_LIMIT
                // -- which is a hang, not a heavy frame.
                const GPU_COMPLETION_WAIT_SLICE: Duration = Duration::from_secs(2);
                const GPU_COMPLETION_HARD_LIMIT: Duration = Duration::from_secs(60);
                let mut previous_done: Option<Instant> = None;
                'completion: while let Ok((submission, frame_started, submitted_at)) = gpu_completion_rx.recv() {
                    // This thread lives for the whole session and polls the
                    // device every frame: without a pool of its own, what
                    // the poll autoreleases is never released.
                    let _pool = autorelease_pool::IterationPool::new();
                    let started = Instant::now();
                    let mut slow_reported = false;
                    loop {
                        match completion_device.poll(wgpu::PollType::Wait {
                            submission_index: Some(submission.clone()),
                            timeout: Some(GPU_COMPLETION_WAIT_SLICE),
                        }) {
                            Ok(_) => break,
                            Err(wgpu::PollError::Timeout) => {
                                let waited = started.elapsed();
                                if waited >= GPU_COMPLETION_HARD_LIMIT {
                                    let _ = event_proxy.send_event(UserEvent::GpuFrameFailed(format!(
                                        "GPU completion stalled for {}s (device is not retiring work); restart the renderer process to recover",
                                        waited.as_secs(),
                                    )));
                                    break 'completion;
                                }
                                if !slow_reported {
                                    slow_reported = true;
                                    eprintln!(
                                        "[ghost-core] GPU submission still running after {}s; continuing to wait (heavy frame, not a fault)",
                                        waited.as_secs().max(1),
                                    );
                                }
                            }
                            Err(error) => {
                                let _ = event_proxy.send_event(UserEvent::GpuFrameFailed(format!("GPU completion failed: {error}; restart the renderer process to recover")));
                                break 'completion;
                            }
                        }
                    }
                    let done = Instant::now();
                    completion_latency.record_completion(frame_started, submitted_at, done, previous_done);
                    previous_done = Some(done);
                    let _completed = completion_counter.fetch_add(1, Ordering::Release) + 1;
                    #[cfg(target_os = "windows")]
                    if let Some(counter) = frame_counter.as_ref() {
                        counter.publish(_completed);
                    }
                    let _ = event_proxy.send_event(UserEvent::GpuFrameCompleted);
                }
            })
            .map_err(|err| format!("failed to start GPU completion worker: {err}"))?;

        // Renderers made on first use (mirror dome and projector view Screens,
        // graph mip chains) compile their pipelines then, on the render
        // thread: up to ~100 ms each with a cold driver cache. Compile them
        // once on a worker now, so first use finds them in the driver's cache
        // (and, on Vulkan, in the pipeline cache).
        {
            let (device, queue, format) = (device.clone(), queue.clone(), config.format);
            let _ = thread::Builder::new()
                .name("ghost-pipeline-prewarm".into())
                .spawn(move || {
                    MirrorRenderer::prewarm(&device, format);
                    projector_view::ProjectorViewRenderer::prewarm(&device, &queue, format);
                    graph_textures::prewarm_mip_builders(&device);
                });
        }

        Ok(Self {
            window,
            adapter_name: adapter_info.name,
            frame_counter_name,
            adapter_is_software,
            native_caps,
            surface,
            device,
            queue,
            config,
            supported_present_modes,
            pipeline,
            mips_pipeline,
            program_wants_mips: false,
            raster,
            uniform_buffer,
            native_shader_uniform_buffer,
            layer_buffer,
            source_preview_buffer,
            layer_upload_scratch: Vec::new(),
            layer_upload_last: Vec::new(),
            layer_pool,
            layer_pack_scratch: LayerPackScratch::default(),
            layer_tile_buffer,
            layer_tile_scratch: Vec::with_capacity(LAYER_TILE_HEADER + LAYER_TILE_CELLS + 1),
            layer_tile_last: Vec::new(),
            mesh_cell_bounds_scratch: Vec::with_capacity(MAX_SCENE_LAYERS),
            mesh_cell_bounds_last: Vec::new(),
            composite_views: HashMap::new(),
            outputs_encoder: None,
            frame_submission: None,
            #[cfg(not(any(target_os = "macos", target_os = "windows")))]
            pending_slice_presents: Vec::new(),
            source_frame_bind_generation: source_frame_store.generation(),
            slots: source_frame_store,
            source_frame_bindings,
            source_frame_gpu_readiness: std::cell::RefCell::new((0..INITIAL_SOURCE_FRAME_SLOTS)
                .map(|_| Arc::new(SourceFrameGpuReadiness::default())).collect()),
            graph_sample_scratch: std::cell::RefCell::new(Vec::new()),
            source_frame_sampler,
            compositor_sampler,
            native_shader_input_texture,
            source_frame_size,
            source_frame_format,
            source_frame_mip_levels,
            source_frame_blitter,
            source_frame_mips,
            hap_converter,
            #[cfg(target_os = "windows")]
            dxgi_import_cache: Mutex::new(shared_texture::SharedTextureImportCache::new()),
            #[cfg(any(target_os = "macos", target_os = "windows"))]
            hap_upload_batch: Mutex::new(None),
            #[cfg(any(target_os = "macos", target_os = "windows"))]
            video_converter,
            #[cfg(target_os = "windows")]
            video_device,
            composite_frame_blitter,
            output_presenter,
            dome_layer_pass: [0.0; 4],
            creative_frame_index: 0,
            frame_epoch: 0,
            pipeline_cap: NATIVE_PIPELINE_CACHE_CAP as usize,
            pipeline_used: HashMap::new(),
            graph_budget_bytes: 512 * 1024 * 1024,
            pinned_buffers: HashSet::new(),
            frame_uniform_pool: Vec::new(),
            frame_uniform_cursor: 0,
            allow_async_compile: false,
            shader_async_compile: false,
            pipeline_work: HashMap::new(),
            pipeline_failures: HashMap::new(),
            native_shader_scale_texture: None,
            native_shader_scale_size: 0,
            native_shader_vertex_module,
            native_shader_bind_group_layout,
            native_shader_bind_group,
            native_shader_ring: None,
            native_shader_batch: None,
            native_shader_input_view,
            isf_dummy_texture_view,
            isf_audio_rows: HashMap::new(),
            isf_audio_scratch: Vec::with_capacity(isf_passes::ISF_AUDIO_MAX_WIDTH as usize * 4),
            isf_pass_states: HashMap::new(),
            stage3d_overlay_pipeline,
            stage3d_overlay_uniform_buffer,
            stage3d_overlay_item_buffer,
            stage3d_overlay_bind_group,
            stage3d_mesh_pipeline,
            stage3d_mesh_uniform_buffer,
            stage3d_mesh_item_buffer,
            stage3d_mesh_bind_group,
            source_frames_bind_group_layout,
            source_frames_bind_group,
            stage3d_mesh_depth_texture,
            stage3d_mesh_depth_view,
            _native_graph_source_depth_texture: native_graph_source_depth_texture,
            native_graph_source_depth_view,
            native_shader_pipelines: HashMap::new(),
            native_compute_pipelines: HashMap::new(),
            native_graph_render_pipelines: HashMap::new(),
            native_compute_graph_buffers: HashMap::new(),
            native_graph_textures: graph_textures::GraphTexturePool::default(),
            pending_graph_readbacks: Vec::new(),
            graph_readback_results: HashMap::new(),
            graph_live_readbacks: graph_readbacks::LiveReadbacks::default(),
            output_mirror_texture,
            composite_frame_textures,
            output_mirror_view,
            surface_copy_dst_supported,
            #[cfg(any(target_os = "macos", target_os = "windows"))]
            output_export,
            #[cfg(any(target_os = "macos", target_os = "windows"))]
            native_recorder: None,
            #[cfg(any(target_os = "macos", target_os = "windows"))]
            native_recorder_error: None,
            texture_share: Default::default(),
            pixelmap_capture: Default::default(),
            deck_monitor_targets: None,
            dome_view_target: None,
            mirror: None,
            slice_targets: HashMap::new(),
            #[cfg(not(any(target_os = "macos", target_os = "windows")))]
            linux_slice_windows: HashMap::new(),
            wgpu_instance: instance.clone(),
            #[cfg(not(any(target_os = "macos", target_os = "windows")))]
            wgpu_adapter: adapter.clone(),
            #[cfg(any(target_os = "macos", target_os = "windows"))]
            record_target: None,
            projector_view: None,
            snapshot_texture,
            snapshot_view,
            snapshot_preview: None,
            source_crop_preview: None,
            last_frame_metrics: None,
            bind_group,
            scene_bind_group_layout: bind_group_layout,
            paint_mask_texture,
            paint_mask_view,
            scene_bindings_generation: 0,
            disk_pipeline_cache,
            paint_mask_size: 1,
            paint_mask_layers: 1,
            start_time: Instant::now(),
            beat_clock: BeatClock::default(),
            output_flux: [[0.0; 4]; 2],
            output_flux_regions: [[0.0; 4]; MAX_FLUX_REGIONS],
            gpu_timing,
            gpu_frames_submitted: 0,
            gpu_frames_completed,
            gpu_fault: false,
            test_device_loss,
            gpu_completion_tx,
            frames_in_flight: frames_in_flight::AdaptiveGate::new(frames_in_flight::from_env()),
            gpu_frame_latency,
            pacing: present_pacing::PacingProbe::default(),
            last_frame_error: None,
        })
    }

    pub(crate) fn adapter_name(&self) -> Option<String> {
        Some(self.adapter_name.clone())
    }

    pub(crate) fn present_mode_label(&self) -> String {
        present_mode_label(self.config.present_mode).to_string()
    }

    pub(crate) fn supports_tearing(&self) -> bool {
        self.supported_present_modes.iter().any(|mode| {
            matches!(
                mode,
                wgpu::PresentMode::Immediate | wgpu::PresentMode::FifoRelaxed
            )
        })
    }

    pub(crate) fn tearing_active(&self) -> bool {
        matches!(
            self.config.present_mode,
            wgpu::PresentMode::Immediate | wgpu::PresentMode::FifoRelaxed
        )
    }

    pub(crate) fn set_present_policy(
        &mut self,
        present_mode: &str,
        allow_tearing: bool,
        max_frame_latency: u32,
    ) {
        self.config.present_mode =
            choose_present_mode(&self.supported_present_modes, present_mode, allow_tearing);
        self.config.desired_maximum_frame_latency = max_frame_latency.clamp(1, 8);
        self.surface.configure(&self.device, &self.config);
    }

    pub(crate) fn resize(&mut self, size: PhysicalSize<u32>) {
        if size.width == 0 || size.height == 0 { return; }
        if !output_dimensions_admitted(size.width, size.height)
            || size.width > self.device.limits().max_texture_dimension_2d
            || size.height > self.device.limits().max_texture_dimension_2d {
            self.last_frame_error = Some("output resize exceeds texture budget or device limits".to_string());
            return;
        }
        if (size.width == self.config.width && size.height == self.config.height) || size.width == 0 || size.height == 0 {
            return;
        }
        self.config.width = size.width;
        self.config.height = size.height;
        self.surface.configure(&self.device, &self.config);
        let (output_mirror_texture, output_mirror_view) = Self::create_offscreen_target(
            &self.device,
            self.config.width,
            self.config.height,
            self.config.format,
            "Ghost Render Core Output Mirror",
        );
        self.output_mirror_texture = output_mirror_texture;
        self.output_mirror_view = output_mirror_view;
        self.composite_frame_textures = [
            Self::create_composite_frame_target(
                &self.device,
                self.config.width,
                self.config.height,
                self.config.format,
            ),
            Self::create_composite_frame_target(
                &self.device,
                self.config.width,
                self.config.height,
                self.config.format,
            ),
        ];
        self.output_presenter.set_inputs(&self.device, &self.composite_frame_textures);
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        {
            self.output_export = Self::create_output_export_target(
                &self.device,
                self.config.width,
                self.config.height,
                native_output_export_format(self.config.format),
            )
            .map_err(|err| {
                eprintln!("[ghost-core] output export target failed on resize: {err}");
                err
            })
            .ok();
        }
        let (snapshot_texture, snapshot_view) = Self::create_offscreen_target(
            &self.device,
            self.config.width,
            self.config.height,
            self.config.format,
            "Ghost Render Core Snapshot Mirror",
        );
        self.snapshot_texture = snapshot_texture;
        self.snapshot_view = snapshot_view;
        let (stage3d_mesh_depth_texture, stage3d_mesh_depth_view) = Self::create_depth_target(
            &self.device,
            self.config.width,
            self.config.height,
            "Ghost Render Core Stage3D Mesh Depth",
        );
        self.stage3d_mesh_depth_texture = stage3d_mesh_depth_texture;
        self.stage3d_mesh_depth_view = stage3d_mesh_depth_view;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn linux_screens_prefer_a_present_mode_that_does_not_wait_for_vblank() {
        use super::linux_slice_present_mode;
        use wgpu::PresentMode::*;
        assert_eq!(linux_slice_present_mode(&[Fifo, Immediate, Mailbox]), Mailbox);
        assert_eq!(linux_slice_present_mode(&[Fifo, FifoRelaxed, Immediate]), Immediate);
        assert_eq!(linux_slice_present_mode(&[Fifo, FifoRelaxed]), FifoRelaxed);
        assert_eq!(linux_slice_present_mode(&[Fifo]), Fifo);
        assert_eq!(linux_slice_present_mode(&[]), Fifo);
    }

    #[test]
    fn adapter_luids_print_high_part_first_as_presenters_parse_them() {
        assert_eq!(super::format_adapter_luid(0, 0x0001_2345), "0000000000012345");
        // HighPart is signed in the Windows LUID; keep its bits as they are.
        assert_eq!(super::format_adapter_luid(-1, 0xdead_beef), "ffffffffdeadbeef");
    }
}
