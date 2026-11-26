//! Output export for texture share: IOSurface and DXGI export targets, their
//! formats, metadata and snapshots.

use crate::*;

#[cfg(any(target_os = "macos", target_os = "windows"))]
pub(crate) fn native_output_export_format(output_format: wgpu::TextureFormat) -> wgpu::TextureFormat {
    let _ = output_format;
    wgpu::TextureFormat::Bgra8Unorm
}

#[cfg(target_os = "macos")]
pub(crate) fn metal_texture_format_for_wgpu_output(
    format: wgpu::TextureFormat,
) -> objc2_metal::MTLPixelFormat {
    match format {
        wgpu::TextureFormat::Bgra8UnormSrgb | wgpu::TextureFormat::Rgba8UnormSrgb => {
            objc2_metal::MTLPixelFormat::BGRA8Unorm_sRGB
        }
        _ => objc2_metal::MTLPixelFormat::BGRA8Unorm,
    }
}

#[cfg(target_os = "windows")]
pub(crate) fn dxgi_format_for_wgpu_output(
    format: wgpu::TextureFormat,
) -> windows::Win32::Graphics::Dxgi::Common::DXGI_FORMAT {
    match format {
        wgpu::TextureFormat::Rgba8UnormSrgb => {
            windows::Win32::Graphics::Dxgi::Common::DXGI_FORMAT_R8G8B8A8_UNORM_SRGB
        }
        wgpu::TextureFormat::Rgba8Unorm => {
            windows::Win32::Graphics::Dxgi::Common::DXGI_FORMAT_R8G8B8A8_UNORM
        }
        wgpu::TextureFormat::Bgra8UnormSrgb => {
            windows::Win32::Graphics::Dxgi::Common::DXGI_FORMAT_B8G8R8A8_UNORM_SRGB
        }
        _ => windows::Win32::Graphics::Dxgi::Common::DXGI_FORMAT_B8G8R8A8_UNORM,
    }
}

#[cfg(target_os = "macos")]
/// Storage mode for an IOSurface-backed Metal texture.
///
/// Apple Silicon shares one memory pool between CPU and GPU, so `Shared` is
/// correct and cheapest there. Intel Macs with a discrete GPU have their own
/// VRAM and reject `Shared` for textures — the surface has to be `Managed`.
/// Hardcoding `Shared` therefore works on every Apple Silicon machine and
/// fails on exactly the hardware nobody tests on, with the same silent
/// no-frames symptom as a permission denial.
///
/// Intel Mac support is experimental and unverified on real hardware.
#[cfg(target_os = "macos")]
pub(crate) fn iosurface_texture_storage_mode(has_unified_memory: bool) -> objc2_metal::MTLStorageMode {
    if has_unified_memory {
        objc2_metal::MTLStorageMode::Shared
    } else {
        objc2_metal::MTLStorageMode::Managed
    }
}

impl RenderState {
    /// A global BGRA IOSurface imported into wgpu as a texture.
    #[cfg(target_os = "macos")]
    pub(crate) fn create_iosurface_texture(
        device: &wgpu::Device,
        width: u32,
        height: u32,
        format: wgpu::TextureFormat,
        label: &str,
        usage: wgpu::TextureUsages,
        initial_use: wgpu::TextureUses,
    ) -> Result<(objc2_core_foundation::CFRetained<objc2_io_surface::IOSurfaceRef>, wgpu::Texture), String> {
        use objc2_core_foundation::{CFBoolean, CFDictionary, CFNumber, CFType};
        use objc2_io_surface::{
            IOSurfaceRef, kIOSurfaceAllocSize, kIOSurfaceBytesPerElement, kIOSurfaceBytesPerRow,
            kIOSurfaceHeight, kIOSurfaceIsGlobal, kIOSurfacePixelFormat, kIOSurfaceWidth,
        };
        use objc2_metal::{
            MTLDevice, MTLStorageMode, MTLTextureDescriptor, MTLTextureType, MTLTextureUsage,
        };
        use wgpu::hal::{self, api::Metal};

        let width = width.max(1);
        let height = height.max(1);
        let width_value = CFNumber::new_i32(width.min(i32::MAX as u32) as i32);
        let height_value = CFNumber::new_i32(height.min(i32::MAX as u32) as i32);
        let bytes_per_row = align_u64(u64::from(width) * 4, 16);
        let alloc_size = bytes_per_row * u64::from(height);
        let bytes_per_row_value = CFNumber::new_i64(bytes_per_row.min(i64::MAX as u64) as i64);
        let alloc_size_value = CFNumber::new_i64(alloc_size.min(i64::MAX as u64) as i64);
        let bytes_per_element_value = CFNumber::new_i32(4);
        let bgra_fourcc =
            (b'B' as i32) << 24 | (b'G' as i32) << 16 | (b'R' as i32) << 8 | b'A' as i32;
        let pixel_format_value = CFNumber::new_i32(bgra_fourcc);
        let is_global_value = CFBoolean::new(true);
        let keys: [&CFType; 7] = unsafe {
            [
                kIOSurfaceWidth.as_ref(),
                kIOSurfaceHeight.as_ref(),
                kIOSurfaceBytesPerRow.as_ref(),
                kIOSurfaceBytesPerElement.as_ref(),
                kIOSurfaceAllocSize.as_ref(),
                kIOSurfacePixelFormat.as_ref(),
                kIOSurfaceIsGlobal.as_ref(),
            ]
        };
        let values: [&CFType; 7] = [
            width_value.as_ref(),
            height_value.as_ref(),
            bytes_per_row_value.as_ref(),
            bytes_per_element_value.as_ref(),
            alloc_size_value.as_ref(),
            pixel_format_value.as_ref(),
            is_global_value.as_ref(),
        ];
        let properties = CFDictionary::<CFType, CFType>::from_slices(&keys, &values);
        let surface = unsafe { IOSurfaceRef::new(properties.as_opaque()) }.ok_or_else(|| {
            format!("IOSurfaceCreate failed for {label} {width}x{height}")
        })?;

        let raw_device = unsafe { device.as_hal::<Metal>() }
            .ok_or_else(|| "native renderer is not running on the Metal backend".to_string())?;
        let metal_format = metal_texture_format_for_wgpu_output(format);
        let texture_descriptor = unsafe {
            MTLTextureDescriptor::texture2DDescriptorWithPixelFormat_width_height_mipmapped(
                metal_format,
                width as usize,
                height as usize,
                false,
            )
        };
        texture_descriptor.setTextureType(MTLTextureType::Type2D);
        texture_descriptor.setStorageMode(iosurface_texture_storage_mode(
            raw_device.raw_device().hasUnifiedMemory(),
        ));
        texture_descriptor.setUsage(MTLTextureUsage::ShaderRead | MTLTextureUsage::RenderTarget);
        let raw_texture = raw_device
            .raw_device()
            .newTextureWithDescriptor_iosurface_plane(&texture_descriptor, &surface, 0)
            .ok_or_else(|| {
                format!("Metal failed to create {label} texture {width}x{height}")
            })?;
        let hal_texture = unsafe {
            hal::metal::Device::texture_from_raw(
                raw_texture,
                format,
                MTLTextureType::Type2D,
                1,
                1,
                hal::CopyExtent {
                    width,
                    height,
                    depth: 1,
                },
                None,
            )
        };
        let texture = unsafe {
            device.create_texture_from_hal::<Metal>(
                hal_texture,
                &wgpu::TextureDescriptor {
                    label: Some(label),
                    size: wgpu::Extent3d {
                        width,
                        height,
                        depth_or_array_layers: 1,
                    },
                    mip_level_count: 1,
                    sample_count: 1,
                    dimension: wgpu::TextureDimension::D2,
                    format,
                    usage,
                    view_formats: &[],
                },
                initial_use,
            )
        };
        Ok((surface, texture))
    }

    #[cfg(target_os = "macos")]
    pub(crate) fn create_output_export_target(
        device: &wgpu::Device,
        width: u32,
        height: u32,
        format: wgpu::TextureFormat,
    ) -> Result<NativeOutputExport, String> {
        let (surface, texture) = Self::create_iosurface_texture(
            device,
            width,
            height,
            format,
            "Ghost Render Core Output IOSurface Export",
            wgpu::TextureUsages::RENDER_ATTACHMENT
                | wgpu::TextureUsages::TEXTURE_BINDING
                | wgpu::TextureUsages::COPY_SRC,
            wgpu::TextureUses::COLOR_TARGET,
        )?;
        let width = width.max(1);
        let height = height.max(1);
        let view = texture.create_view(&wgpu::TextureViewDescriptor {
            label: Some("Ghost Render Core Output IOSurface Export View"),
            format: Some(format),
            dimension: Some(wgpu::TextureViewDimension::D2),
            ..Default::default()
        });
        let blitter = TextureBlitterBuilder::new(device, format)
            .sample_type(wgpu::FilterMode::Linear)
            .build();
        Ok(NativeOutputExport {
            surface,
            texture,
            view,
            blitter,
            width,
            height,
            format,
            frame: 0,
        })
    }

    #[cfg(target_os = "windows")]
    pub(crate) fn create_output_export_target(
        device: &wgpu::Device,
        width: u32,
        height: u32,
        format: wgpu::TextureFormat,
    ) -> Result<NativeOutputExport, String> {
        use wgpu::hal::{self, api::Dx12};
        use windows::Win32::Foundation::GENERIC_ALL;
        use windows::Win32::Graphics::Direct3D12::{
            D3D12_CLEAR_VALUE, D3D12_CLEAR_VALUE_0, D3D12_CPU_PAGE_PROPERTY_UNKNOWN,
            D3D12_HEAP_FLAG_SHARED, D3D12_HEAP_PROPERTIES, D3D12_HEAP_TYPE_DEFAULT,
            D3D12_MEMORY_POOL_UNKNOWN, D3D12_RESOURCE_DESC, D3D12_RESOURCE_DIMENSION_TEXTURE2D,
            D3D12_RESOURCE_FLAG_ALLOW_RENDER_TARGET, D3D12_RESOURCE_FLAG_ALLOW_SIMULTANEOUS_ACCESS,
            D3D12_RESOURCE_STATE_RENDER_TARGET, D3D12_TEXTURE_LAYOUT_UNKNOWN, ID3D12Resource,
        };
        use windows::Win32::Graphics::Dxgi::Common::DXGI_SAMPLE_DESC;

        let width = width.max(1);
        let height = height.max(1);
        let shared_name = format!(
            "Local\\GhostArcadeNativeOutput-{}-{}x{}-{}",
            std::process::id(),
            width,
            height,
            epoch_ms()
        );
        let shared_name_wide: Vec<u16> = shared_name
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
        let raw_device = unsafe { device.as_hal::<Dx12>() }
            .ok_or_else(|| "native renderer is not running on the D3D12 backend".to_string())?;
        let dxgi_format = dxgi_format_for_wgpu_output(format);
        let heap_properties = D3D12_HEAP_PROPERTIES {
            Type: D3D12_HEAP_TYPE_DEFAULT,
            CPUPageProperty: D3D12_CPU_PAGE_PROPERTY_UNKNOWN,
            MemoryPoolPreference: D3D12_MEMORY_POOL_UNKNOWN,
            CreationNodeMask: 0,
            VisibleNodeMask: 0,
        };
        let resource_desc = D3D12_RESOURCE_DESC {
            Dimension: D3D12_RESOURCE_DIMENSION_TEXTURE2D,
            Alignment: 0,
            Width: width as u64,
            Height: height,
            DepthOrArraySize: 1,
            MipLevels: 1,
            Format: dxgi_format,
            SampleDesc: DXGI_SAMPLE_DESC {
                Count: 1,
                Quality: 0,
            },
            Layout: D3D12_TEXTURE_LAYOUT_UNKNOWN,
            Flags: D3D12_RESOURCE_FLAG_ALLOW_RENDER_TARGET
                | D3D12_RESOURCE_FLAG_ALLOW_SIMULTANEOUS_ACCESS,
        };
        let clear_value = D3D12_CLEAR_VALUE {
            Format: dxgi_format,
            Anonymous: D3D12_CLEAR_VALUE_0 { Color: [0.0; 4] },
        };
        let mut raw_resource: Option<ID3D12Resource> = None;
        unsafe {
            raw_device
                .raw_device()
                .CreateCommittedResource(
                    &heap_properties,
                    D3D12_HEAP_FLAG_SHARED,
                    &resource_desc,
                    D3D12_RESOURCE_STATE_RENDER_TARGET,
                    Some(&clear_value),
                    &mut raw_resource,
                )
                .map_err(|err| {
                    format!(
                        "D3D12 failed to create native output shared texture {}x{} format={}: {err}",
                        width,
                        height,
                        texture_format_label(format)
                    )
                })?;
        }
        let raw_resource = raw_resource.ok_or_else(|| {
            format!("D3D12 returned no output export resource for {width}x{height}")
        })?;
        let shared_handle = unsafe {
            raw_device
                .raw_device()
                .CreateSharedHandle(
                    &raw_resource,
                    None,
                    GENERIC_ALL.0,
                    windows::core::PCWSTR::from_raw(shared_name_wide.as_ptr()),
                )
                .map_err(|err| {
                    format!(
                        "D3D12 failed to create native output shared HANDLE {}x{} format={}: {err}",
                        width,
                        height,
                        texture_format_label(format)
                    )
                })?
        };
        let hal_texture = unsafe {
            hal::dx12::Device::texture_from_raw(
                raw_resource,
                format,
                wgpu::TextureDimension::D2,
                wgpu::Extent3d {
                    width,
                    height,
                    depth_or_array_layers: 1,
                },
                1,
                1,
            )
        };
        let texture = unsafe {
            device.create_texture_from_hal::<Dx12>(
                hal_texture,
                &wgpu::TextureDescriptor {
                    label: Some("Ghost Render Core Output DXGI Export"),
                    size: wgpu::Extent3d {
                        width,
                        height,
                        depth_or_array_layers: 1,
                    },
                    mip_level_count: 1,
                    sample_count: 1,
                    dimension: wgpu::TextureDimension::D2,
                    format,
                    usage: wgpu::TextureUsages::RENDER_ATTACHMENT
                        | wgpu::TextureUsages::TEXTURE_BINDING
                        | wgpu::TextureUsages::COPY_SRC,
                    view_formats: &[],
                },
                wgpu::TextureUses::COLOR_TARGET,
            )
        };
        let view = texture.create_view(&wgpu::TextureViewDescriptor {
            label: Some("Ghost Render Core Output DXGI Export View"),
            format: Some(format),
            dimension: Some(wgpu::TextureViewDimension::D2),
            ..Default::default()
        });
        let blitter = TextureBlitterBuilder::new(device, format)
            .sample_type(wgpu::FilterMode::Linear)
            .build();
        Ok(NativeOutputExport {
            shared_handle,
            shared_name,
            texture,
            view,
            blitter,
            width,
            height,
            format,
            frame: 0,
        })
    }

    #[cfg(any(target_os = "macos", target_os = "windows"))]
    pub(crate) fn refresh_output_export(&mut self, encoder: &mut wgpu::CommandEncoder) {
        if let Some(export) = self.output_export.as_mut() {
            let _keep_texture_alive = &export.texture;
            export.blitter.copy(
                &self.device,
                encoder,
                &self.output_mirror_view,
                &export.view,
            );
            export.frame = export.frame.saturating_add(1);
        }
    }

    pub(crate) fn output_export_ready(&self) -> bool {
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        {
            self.output_export.is_some()
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            false
        }
    }

    pub(crate) fn output_export_metadata(&self) -> Value {
        #[cfg(target_os = "macos")]
        {
            if let Some(export) = self.output_export.as_ref() {
                return json!({
                    "available": true,
                    "platform": "iosurface",
                    "handle": export.surface.id().to_string(),
                    "handle_encoding": "integer",
                    "handle_scope": "global-id",
                    "preferred_transport": "handle",
                    "handle_byte_length": 4,
                    "width": export.width,
                    "height": export.height,
                    "format": texture_format_label(export.format),
                    "color_space": "srgb",
                    "storage_format": "bgra8unorm",
                    "storage_encoding": "srgb-encoded-bgra8unorm",
                    "alpha_mode": "opaque",
                    "premultiplied_alpha": false,
                    "single_render_source": "core-output-composite",
                    "zero_conversions": true,
                    "frame": export.frame,
                    "flipped": false,
                });
            }
        }
        #[cfg(target_os = "windows")]
        {
            if let Some(export) = self.output_export.as_ref() {
                return json!({
                    "available": true,
                    "platform": "dxgi",
                    "handle": (export.shared_handle.0 as usize).to_string(),
                    "handle_encoding": "integer",
                    "handle_scope": "process-local",
                    "preferred_transport": "shared_name",
                    "handle_byte_length": 8,
                    "name": export.shared_name.clone(),
                    "shared_name": export.shared_name.clone(),
                    "width": export.width,
                    "height": export.height,
                    "format": texture_format_label(export.format),
                    "color_space": "srgb",
                    "storage_format": "bgra8unorm",
                    "storage_encoding": "srgb-encoded-bgra8unorm",
                    "alpha_mode": "opaque",
                    "premultiplied_alpha": false,
                    "single_render_source": "core-output-composite",
                    "zero_conversions": true,
                    "frame": export.frame,
                    "flipped": false,
                });
            }
        }
        json!({
            "available": false,
            "platform": if cfg!(target_os = "macos") { "iosurface" } else if cfg!(target_os = "windows") { "dxgi" } else { "unsupported" },
            "reason": if cfg!(target_os = "macos") {
                "native output IOSurface export target is unavailable"
            } else if cfg!(target_os = "windows") {
                "native output DXGI export target is unavailable"
            } else {
                "native output shared texture export is pending for this backend"
            },
        })
    }

    /// Read the ALREADY-RENDERED output export texture (the frame the
    /// presenter/Syphon are showing) without re-compositing the scene —
    /// the cheap capture path for live recording.
    pub(crate) fn read_output_export_frame(&mut self) -> Result<FrameSnapshotReadback, String> {
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        {
            let Some(export) = self.output_export.as_ref() else {
                return Err(
                    "native output shared-texture export target is unavailable".to_string(),
                );
            };
            let readback = read_texture_to_frame(
                &self.device,
                &self.queue,
                &export.texture,
                export.format,
                export.width.max(1),
                export.height.max(1),
                "Ghost Render Core Output Export Frame",
            )?;
            self.last_frame_metrics = Some(readback.metrics.clone());
            return Ok(readback);
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            Err("output export capture is not available on this platform".to_string())
        }
    }

    pub(crate) fn output_export_snapshot(&mut self, include_pixels: bool) -> Result<Value, String> {
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        {
            let Some(export) = self.output_export.as_ref() else {
                return Err("native output shared-texture export target is unavailable".to_string());
            };
            let mut value = read_texture_to_frame(
                &self.device,
                &self.queue,
                &export.texture,
                export.format,
                export.width.max(1),
                export.height.max(1),
                "Ghost Render Core Output Export",
            )?
            .to_json(include_pixels);
            if let Some(object) = value.as_object_mut() {
                object.insert("source".to_string(), json!("output-shared-texture-export"));
                object.insert("color_space".to_string(), json!("srgb"));
                object.insert("storage_format".to_string(), json!("bgra8unorm"));
                object.insert(
                    "storage_encoding".to_string(),
                    json!("srgb-encoded-bgra8unorm"),
                );
                object.insert("alpha_mode".to_string(), json!("opaque"));
                object.insert("premultiplied_alpha".to_string(), json!(false));
                object.insert(
                    "single_render_source".to_string(),
                    json!("core-output-composite"),
                );
                object.insert("zero_conversions".to_string(), json!(true));
                object.insert("export_frame".to_string(), json!(export.frame));
            }
            Ok(value)
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            let _ = include_pixels;
            Err("native output shared-texture export is pending for this backend".to_string())
        }
    }
}

impl App {
    /// Shared-texture metadata tagged with what a presenter in another
    /// process needs besides the texture: the adapter the textures live on,
    /// so it opens them on the same GPU, and where the completed-frame count
    /// is published, so it copies only new frames.
    pub(crate) fn tag_presenter_info(&self, mut value: Value) -> Value {
        if let Some(map) = value.as_object_mut() {
            if let Some(luid) = self.adapter_luid.as_ref() {
                map.insert("adapter_luid".to_string(), json!(luid));
            }
            if let Some(name) = self.frame_counter_name.as_ref() {
                map.insert("frame_counter_name".to_string(), json!(name));
            }
        }
        value
    }

    pub(crate) fn output_shared_texture(&self) -> Value {
        if let Some(renderer) = self.renderer.as_ref() {
            return self.tag_presenter_info(renderer.output_export_metadata());
        }
        json!({
            "available": false,
            "platform": if cfg!(target_os = "macos") { "iosurface" } else if cfg!(target_os = "windows") { "dxgi" } else { "unsupported" },
            "reason": "native renderer has not created a wgpu device",
        })
    }

    pub(crate) fn output_shared_texture_snapshot(&mut self, params: &Value) -> Result<Value, String> {
        let include_pixels = bool_at(params, &["include_pixels"])
            .or_else(|| bool_at(params, &["pixels"]))
            .unwrap_or(false);
        let renderer = self
            .renderer
            .as_mut()
            .ok_or_else(|| "native renderer is not running".to_string())?;
        renderer.output_export_snapshot(include_pixels)
    }
}
