//! Shared-texture imports: IOSurface (macOS) and DXGI (Windows) source
//! frames, and hardware-decoded video frames.

use crate::*;

#[cfg(target_os = "macos")]
pub(crate) fn metal_texture_format_for_shared_texture(
    descriptor: &SharedTextureSourceFrameDescriptor,
) -> objc2_metal::MTLPixelFormat {
    match descriptor.normalized_format().as_str() {
        "rgba8unorm" | "70" => objc2_metal::MTLPixelFormat::RGBA8Unorm,
        "bgra8unorm" | "80" | "87" => objc2_metal::MTLPixelFormat::BGRA8Unorm,
        _ => objc2_metal::MTLPixelFormat::BGRA8Unorm,
    }
}

impl RenderState {
    /// Let go of the shared texture a slot kept open (the slot was released
    /// or is being given to another source).
    pub(crate) fn release_shared_texture_import(&self, slot: usize) {
        #[cfg(target_os = "windows")]
        if let Ok(mut cache) = self.dxgi_import_cache.lock() {
            cache.release(slot);
        }
        #[cfg(not(target_os = "windows"))]
        let _ = slot;
    }

    pub(crate) fn import_shared_texture_source_frame(
        &self,
        slot: usize,
        descriptor: &SharedTextureSourceFrameDescriptor,
    ) -> Result<u64, String> {
        #[cfg(target_os = "macos")]
        {
            self.import_iosurface_source_frame(slot, descriptor)
        }
        #[cfg(target_os = "windows")]
        {
            self.import_dxgi_source_frame(slot, descriptor)
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            let _ = slot;
            match descriptor.platform.as_str() {
                "dxgi" => {
                    let _handle = descriptor.dxgi_shared_handle()?;
                    let wgpu_format = descriptor.wgpu_texture_format();
                    Err(format!(
                        "DXGI shared texture source-frame upload received a valid HANDLE for format={} mapped_format={} size={}x{}, but D3D11/D3D12 import is pending for backend={}",
                        descriptor.format,
                        texture_format_label(wgpu_format),
                        descriptor.width,
                        descriptor.height,
                        native_backend_name()
                    ))
                }
                "iosurface" => Err(format!(
                    "IOSurface source-frame import is only available in macOS Metal builds; {}",
                    descriptor.unsupported_reason(native_backend_name())
                )),
                _ => Err(descriptor.unsupported_reason(native_backend_name())),
            }
        }
    }

    #[cfg(target_os = "macos")]
    pub(crate) fn import_iosurface_source_frame(
        &self,
        slot: usize,
        descriptor: &SharedTextureSourceFrameDescriptor,
    ) -> Result<u64, String> {
        use objc2_io_surface::IOSurfaceRef;
        use objc2_metal::{
            MTLDevice, MTLStorageMode, MTLTextureDescriptor, MTLTextureType, MTLTextureUsage,
        };
        use wgpu::hal::{self, api::Metal};

        if descriptor.platform != "iosurface" {
            return Err(format!(
                "shared texture platform `{}` is not supported by the Metal importer",
                descriptor.platform
            ));
        }

        let surface_id = descriptor.iosurface_id()?;
        let surface = IOSurfaceRef::lookup(surface_id)
            .ok_or_else(|| format!("IOSurfaceLookup({surface_id}) returned null"))?;
        let metal_format = metal_texture_format_for_shared_texture(descriptor);
        let wgpu_format = descriptor.wgpu_texture_format();
        let width = descriptor.width.max(1);
        let height = descriptor.height.max(1);
        let raw_device = unsafe { self.device.as_hal::<Metal>() }
            .ok_or_else(|| "native renderer is not running on the Metal backend".to_string())?;
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
        texture_descriptor.setUsage(MTLTextureUsage::ShaderRead);
        let raw_texture = raw_device
            .raw_device()
            .newTextureWithDescriptor_iosurface_plane(&texture_descriptor, &surface, 0)
            .ok_or_else(|| {
                format!(
                    "Metal failed to create texture from IOSurfaceID={surface_id} format={} size={}x{}",
                    descriptor.format, width, height
                )
            })?;
        let hal_texture = unsafe {
            hal::metal::Device::texture_from_raw(
                raw_texture,
                wgpu_format,
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
        let imported_texture = unsafe {
            self.device.create_texture_from_hal::<Metal>(
                hal_texture,
                &wgpu::TextureDescriptor {
                    label: Some("Ghost Render Core Imported IOSurface Source Frame"),
                    size: wgpu::Extent3d {
                        width,
                        height,
                        depth_or_array_layers: 1,
                    },
                    mip_level_count: 1,
                    sample_count: 1,
                    dimension: wgpu::TextureDimension::D2,
                    format: wgpu_format,
                    usage: wgpu::TextureUsages::TEXTURE_BINDING,
                    view_formats: &[],
                },
                wgpu::TextureUses::RESOURCE,
            )
        };
        let source_view = imported_texture.create_view(&wgpu::TextureViewDescriptor {
            label: Some("Ghost Render Core Imported IOSurface Source View"),
            format: Some(wgpu_format),
            dimension: Some(wgpu::TextureViewDimension::D2),
            ..Default::default()
        });
        let safe_slot = self.slots.clamp_slot(slot);
        let (target_width, target_height) = self.imported_frame_size(descriptor.width, descriptor.height);
        let target = self.slots.ensure(safe_slot, target_width, target_height, true);
        let target_view = target.target_view("Ghost Render Core Shared Texture Source Frame Target", 0);
        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("Ghost Render Core Shared Texture Source Frame Encoder"),
            });
        self.source_frame_blitter
            .copy(&self.device, &mut encoder, &source_view, &target_view);
        self.generate_source_frame_mips(&mut encoder, safe_slot);
        churn_probe::submit(&self.queue, Some(encoder.finish()));
        self.mark_source_frame_slots_submitted([safe_slot]);
        Ok((target.width as usize)
            .saturating_mul(target.height as usize)
            .saturating_mul(texture_format_bytes_per_texel(self.source_frame_format))
            .min(u64::MAX as usize) as u64)
    }

    #[cfg(target_os = "windows")]
    pub(crate) fn import_dxgi_source_frame(
        &self,
        slot: usize,
        descriptor: &SharedTextureSourceFrameDescriptor,
    ) -> Result<u64, String> {
        use wgpu::hal::{self, api::Dx12};
        use windows::Win32::Foundation::{CloseHandle, HANDLE};
        use windows::Win32::Graphics::Direct3D12::ID3D12Resource;

        if descriptor.platform != "dxgi" {
            return Err(format!(
                "shared texture platform `{}` is not supported by the D3D12 importer",
                descriptor.platform
            ));
        }

        let shared_handle = descriptor.dxgi_shared_handle()?;
        if shared_handle == 0 {
            return Err("DXGI shared texture HANDLE was zero".to_string());
        }

        // The handle is a fresh duplicate on every upload, but a camera's
        // texture behind it lasts the session: reuse the one already opened
        // and only close the duplicate.
        let import_key = shared_texture::SharedTextureImportKey::for_descriptor(descriptor);
        if let Some(key) = import_key.as_ref() {
            let cached = self.dxgi_import_cache.lock().ok().and_then(|cache| cache.get(slot, key));
            if let Some(texture) = cached {
                if descriptor.close_handle_after_import {
                    let _ = unsafe { CloseHandle(HANDLE(shared_handle as *mut core::ffi::c_void)) };
                }
                return self.copy_imported_source_texture(slot, &texture, descriptor);
            }
        }

        let width = descriptor.width.max(1);
        let height = descriptor.height.max(1);
        let wgpu_format = descriptor.wgpu_texture_format();
        let raw_device = unsafe { self.device.as_hal::<Dx12>() }
            .ok_or_else(|| "native renderer is not running on the D3D12 backend".to_string())?;
        let mut raw_resource: Option<ID3D12Resource> = None;
        let os_handle = HANDLE(shared_handle as *mut core::ffi::c_void);
        let open_result = unsafe {
            raw_device
                .raw_device()
                .OpenSharedHandle(os_handle, &mut raw_resource)
        };
        if descriptor.close_handle_after_import {
            let _ = unsafe { CloseHandle(os_handle) };
        }
        open_result.map_err(|err| {
            format!(
                "D3D12 OpenSharedHandle failed for HANDLE=0x{shared_handle:x} format={} mapped_format={} size={}x{}: {err}",
                descriptor.format,
                texture_format_label(wgpu_format),
                width,
                height
            )
        })?;
        let raw_resource = raw_resource.ok_or_else(|| {
            format!(
                "D3D12 OpenSharedHandle returned no ID3D12Resource for HANDLE=0x{shared_handle:x}"
            )
        })?;
        let hal_texture = unsafe {
            hal::dx12::Device::texture_from_raw(
                raw_resource,
                wgpu_format,
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
        let imported_texture = unsafe {
            self.device.create_texture_from_hal::<Dx12>(
                hal_texture,
                &wgpu::TextureDescriptor {
                    label: Some("Ghost Render Core Imported DXGI Source Frame"),
                    size: wgpu::Extent3d {
                        width,
                        height,
                        depth_or_array_layers: 1,
                    },
                    mip_level_count: 1,
                    sample_count: 1,
                    dimension: wgpu::TextureDimension::D2,
                    format: wgpu_format,
                    usage: wgpu::TextureUsages::TEXTURE_BINDING,
                    view_formats: &[],
                },
                wgpu::TextureUses::RESOURCE,
            )
        };
        let uploaded = self.copy_imported_source_texture(slot, &imported_texture, descriptor)?;
        if let Some(key) = import_key {
            if let Ok(mut cache) = self.dxgi_import_cache.lock() {
                cache.insert(slot, key, imported_texture);
            }
        }
        Ok(uploaded)
    }

    #[cfg(target_os = "windows")]
    pub(crate) fn copy_imported_source_texture(
        &self,
        slot: usize,
        imported_texture: &wgpu::Texture,
        descriptor: &SharedTextureSourceFrameDescriptor,
    ) -> Result<u64, String> {
        let wgpu_format = descriptor.wgpu_texture_format();
        let source_view = imported_texture.create_view(&wgpu::TextureViewDescriptor {
            label: Some("Ghost Render Core Imported Shared Source View"),
            format: Some(wgpu_format),
            dimension: Some(wgpu::TextureViewDimension::D2),
            ..Default::default()
        });
        let safe_slot = self.slots.clamp_slot(slot);
        let (target_width, target_height) = self.imported_frame_size(descriptor.width, descriptor.height);
        let target = self.slots.ensure(safe_slot, target_width, target_height, true);
        let target_view = target.target_view("Ghost Render Core Shared Texture Source Frame Target", 0);
        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("Ghost Render Core Shared Texture Source Frame Encoder"),
            });
        self.source_frame_blitter
            .copy(&self.device, &mut encoder, &source_view, &target_view);
        self.generate_source_frame_mips(&mut encoder, safe_slot);
        churn_probe::submit(&self.queue, Some(encoder.finish()));
        self.mark_source_frame_slots_submitted([safe_slot]);
        Ok((target.width as usize)
            .saturating_mul(target.height as usize)
            .saturating_mul(texture_format_bytes_per_texel(self.source_frame_format))
            .min(u64::MAX as usize) as u64)
    }

    #[cfg(any(target_os = "macos", target_os = "windows"))]
    pub(crate) fn import_native_video_frame(&self, slot: usize, frame: hardware_video::GpuVideoFrame,
        memory_lease: Option<Arc<NativeVideoMemoryLease>>) -> Result<[f32; 4], String> {
        let safe_slot = self.slots.clamp_slot(slot);
        // Shared slots hold the frame centred at up to the slot edge; a
        // per-source slot is the frame, at its decoded size.
        let (slot_ref, viewport, source_rect) = if self.slots.mode() == SourceFrameMode::PerSource {
            let (width, height) = self.slots.fitted_size(frame.width, frame.height);
            let slot_ref = self.slots.ensure(safe_slot, width, height, false);
            (slot_ref, [0.0, 0.0, width as f32, height as f32], [0.0, 0.0, 1.0, 1.0])
        } else {
            let size = self.source_frame_size as f32;
            let scale = (size / frame.width.max(1) as f32).min(size / frame.height.max(1) as f32).min(1.0);
            let width = (frame.width as f32 * scale).round().max(1.0);
            let height = (frame.height as f32 * scale).round().max(1.0);
            let viewport = [((size - width) * 0.5).floor(), ((size - height) * 0.5).floor(), width, height];
            // Level zero only: the slot's mip chain no longer matches it.
            self.slots.set_mips_current(safe_slot, false);
            (self.slots.slot(safe_slot), viewport,
                [viewport[0] / size, viewport[1] / size, width / size, height / size])
        };
        let target = slot_ref.target_view("Native hardware video target", 0);
        let is_hap = matches!(&frame.storage, hardware_video::FrameStorage::Hap(_));
        // Inside a stream drain every frame, HAP or not, joins the drain's
        // one encoder and submit: each source occurs once per drain, so no
        // two frames write the same slot. A hardware frame's conversion
        // writes nothing through the queue, so it batches as is.
        let mut batch_guard = self.hap_upload_batch.lock().unwrap();
        let mut encoder = batch_guard.as_mut().and_then(|batch| batch.encoder.take())
            .unwrap_or_else(|| self.device.create_command_encoder(
                &wgpu::CommandEncoderDescriptor { label: Some("Native video conversion batch") }));
        match &frame.storage {
            hardware_video::FrameStorage::Hap(hap) => self.hap_converter.encode(&self.device, &mut encoder, safe_slot, hap, &target, viewport)?,
            hardware_video::FrameStorage::Native(native) => {
                self.hap_converter.release(safe_slot);
                #[cfg(target_os = "macos")]
                self.video_converter.encode(&self.device, &mut encoder, native, &target, viewport)?;
                #[cfg(target_os = "windows")]
                self.video_converter.encode(&self.device, &self.queue, &mut encoder, native, &target, viewport)?;
            }
        }
        // Live-source sampling is explicitly clamped to level zero (as on
        // the software-video path). Building four unused mip levels for
        // every decoded frame multiplies render-pass/driver work for no
        // visible benefit; static sources still generate their mip chain.
        let gpu_lease = memory_lease.as_ref().map(|lease| lease.begin_gpu_work());
        if let Some(batch) = batch_guard.as_mut() {
            batch.encoder = Some(encoder);
            batch.frames.push((frame, gpu_lease));
            batch.slots.push(safe_slot);
            return Ok(source_rect);
        }
        if is_hap {
            self.hap_converter.finish_uploads(&encoder);
        }
        drop(batch_guard);
        churn_probe::submit(&self.queue, Some(encoder.finish()));
        self.mark_source_frame_slots_submitted([safe_slot]);
        // The decoder/bridge may recycle this surface only after rendering
        // has completed. Submission alone does not establish lifetime.
        self.queue.on_submitted_work_done(move || { drop(frame); drop(gpu_lease); });
        Ok(source_rect)
    }
}
