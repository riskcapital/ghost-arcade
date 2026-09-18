//! Import decoder IOSurfaces and convert their native planes directly on Metal.
//!
//! The caller must retain the `GpuVideoFrame` (and therefore its CVPixelBuffer)
//! until the submission containing `encode` completes. Keeping the Metal texture
//! alive alone does not prevent a decoder's pixel-buffer pool from recycling it.

#![cfg(target_os = "macos")]

use crate::mac_video_decoder::GpuVideoFrame;
use objc2_io_surface::IOSurfaceRef;
use objc2_metal::{
    MTLDevice, MTLPixelFormat, MTLStorageMode, MTLTextureDescriptor, MTLTextureType,
    MTLTextureUsage,
};
use wgpu::hal::{self, api::Metal};
use wgpu::util::DeviceExt;

const NV12_VIDEO: u32 = u32::from_be_bytes(*b"420v");
const NV12_FULL: u32 = u32::from_be_bytes(*b"420f");
const P010_VIDEO: u32 = u32::from_be_bytes(*b"x420");
const P010_FULL: u32 = u32::from_be_bytes(*b"xf20");
const BGRA: u32 = u32::from_be_bytes(*b"BGRA");

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum PixelLayout {
    Nv12,
    P010,
    Bgra,
}

impl PixelLayout {
    fn from_fourcc(format: u32) -> Result<Self, String> {
        match format {
            NV12_VIDEO | NV12_FULL => Ok(Self::Nv12),
            P010_VIDEO | P010_FULL => Ok(Self::P010),
            BGRA => Ok(Self::Bgra),
            _ => Err(format!("unsupported GPU video pixel format 0x{format:08x}")),
        }
    }

    fn plane_formats(self, plane: usize) -> (wgpu::TextureFormat, MTLPixelFormat) {
        match (self, plane) {
            (Self::Nv12, 0) => (wgpu::TextureFormat::R8Unorm, MTLPixelFormat::R8Unorm),
            (Self::Nv12, _) => (wgpu::TextureFormat::Rg8Unorm, MTLPixelFormat::RG8Unorm),
            (Self::P010, 0) => (wgpu::TextureFormat::R16Unorm, MTLPixelFormat::R16Unorm),
            (Self::P010, _) => (wgpu::TextureFormat::Rg16Unorm, MTLPixelFormat::RG16Unorm),
            (Self::Bgra, _) => (wgpu::TextureFormat::Bgra8Unorm, MTLPixelFormat::BGRA8Unorm),
        }
    }
}

#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
struct ColorConversion {
    red: [f32; 4],
    green: [f32; 4],
    blue: [f32; 4],
    flags: [u32; 4],
}

impl ColorConversion {
    fn new(layout: PixelLayout, color_matrix: u32, full_range: bool) -> Self {
        // Matrix coefficients act on Y', Cb and Cr. Keep the result in the same
        // encoded RGB space as the existing BGRA video upload path. The source
        // atlas uses non-sRGB texture formats, so do not linearize a second time.
        // This matrix/range contract does not perform HDR transfer or gamut mapping.
        let (kr, kb) = match color_matrix {
            1 => (0.299_f32, 0.114_f32), // ITU-R BT.601
            3 => (0.2627, 0.0593),       // ITU-R BT.2020 non-constant luminance
            _ => (0.2126, 0.0722),       // ITU-R BT.709 (decoder's default)
        };
        let kg = 1.0 - kr - kb;
        let (sample_max, code_shift, code_max, black, luma_range, chroma_mid, chroma_range) =
            if layout == PixelLayout::P010 {
                // CoreVideo x420/xf20 stores each ten-bit code in bits 15..6.
                (65535.0, 64.0, 1023.0, 64.0, 876.0, 512.0, 896.0)
            } else {
                (255.0, 1.0, 255.0, 16.0, 219.0, 128.0, 224.0)
            };
        let (y_min, y_range, uv_range) = if full_range {
            (0.0, code_max, code_max)
        } else {
            (black, luma_range, chroma_range)
        };
        let y_scale = sample_max / (code_shift * y_range);
        let y_offset = -y_min / y_range;
        let uv_scale = sample_max / (code_shift * uv_range);
        let uv_offset = -chroma_mid / uv_range;
        let row = |cb: f32, cr: f32| {
            [
                y_scale,
                cb * uv_scale,
                cr * uv_scale,
                y_offset + (cb + cr) * uv_offset,
            ]
        };
        Self {
            red: row(0.0, 2.0 * (1.0 - kr)),
            green: row(-2.0 * kb * (1.0 - kb) / kg, -2.0 * kr * (1.0 - kr) / kg),
            blue: row(2.0 * (1.0 - kb), 0.0),
            flags: [u32::from(layout == PixelLayout::Bgra), 0, 0, 0],
        }
    }
}

/// A conversion pipeline shared by all video sources with the same target format.
pub struct GpuVideoConverter {
    pipeline: wgpu::RenderPipeline,
    bind_group_layout: wgpu::BindGroupLayout,
    sampler: wgpu::Sampler,
}

impl GpuVideoConverter {
    pub fn new(device: &wgpu::Device, target_format: wgpu::TextureFormat) -> Self {
        let texture_binding = |binding| wgpu::BindGroupLayoutEntry {
            binding,
            visibility: wgpu::ShaderStages::FRAGMENT,
            ty: wgpu::BindingType::Texture {
                sample_type: wgpu::TextureSampleType::Float { filterable: true },
                view_dimension: wgpu::TextureViewDimension::D2,
                multisampled: false,
            },
            count: None,
        };
        let bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("Native Video Plane Layout"),
            entries: &[
                texture_binding(0),
                texture_binding(1),
                wgpu::BindGroupLayoutEntry {
                    binding: 2,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 3,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: wgpu::BufferSize::new(
                            std::mem::size_of::<ColorConversion>() as u64,
                        ),
                    },
                    count: None,
                },
            ],
        });
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("Native Video Plane Sampler"),
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("Native Video Color Conversion"),
            source: wgpu::ShaderSource::Wgsl(include_str!("video_texture.wgsl").into()),
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Native Video Conversion Layout"),
            bind_group_layouts: &[Some(&bind_group_layout)],
            immediate_size: 0,
        });
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("Native Video Conversion Pipeline"),
            layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs_main"),
                compilation_options: wgpu::PipelineCompilationOptions::default(),
                buffers: &[],
            },
            primitive: wgpu::PrimitiveState::default(),
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fs_main"),
                compilation_options: wgpu::PipelineCompilationOptions::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format: target_format,
                    blend: None,
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            multiview_mask: None,
            cache: None,
        });
        Self {
            pipeline,
            bind_group_layout,
            sampler,
        }
    }

    /// Clear the target to black and convert into a pixel-space x/y/w/h viewport.
    /// Only a small color uniform is uploaded; pixel data stays in IOSurface GPU
    /// storage. Imported texture resources are retained by the command encoder.
    pub fn encode(
        &self,
        device: &wgpu::Device,
        encoder: &mut wgpu::CommandEncoder,
        frame: &GpuVideoFrame,
        target: &wgpu::TextureView,
        viewport: [f32; 4],
    ) -> Result<(), String> {
        if !viewport.iter().all(|v| v.is_finite())
            || viewport[0] < 0.0
            || viewport[1] < 0.0
            || viewport[2] <= 0.0
            || viewport[3] <= 0.0
        {
            return Err("GPU video viewport must have finite non-negative coordinates and positive dimensions".into());
        }
        let layout = PixelLayout::from_fourcc(frame.pixel_format)?;
        if layout == PixelLayout::P010
            && !device
                .features()
                .contains(wgpu::Features::TEXTURE_FORMAT_16BIT_NORM)
        {
            return Err(
                "P010 video requires the wgpu TEXTURE_FORMAT_16BIT_NORM device feature".into(),
            );
        }
        let surface = IOSurfaceRef::lookup(frame.iosurface_id).ok_or_else(|| {
            format!(
                "video IOSurfaceLookup({}) returned null",
                frame.iosurface_id
            )
        })?;
        validate_surface(&surface, frame, layout)?;
        let luma = import_plane(device, &surface, layout, 0)?;
        let luma_view = luma.create_view(&wgpu::TextureViewDescriptor::default());
        let chroma = if layout == PixelLayout::Bgra {
            None
        } else {
            Some(import_plane(device, &surface, layout, 1)?)
        };
        let chroma_view = chroma
            .as_ref()
            .map(|texture| texture.create_view(&wgpu::TextureViewDescriptor::default()));
        let conversion = ColorConversion::new(layout, frame.color_matrix, frame.full_range);
        // A distinct uniform for each encoding prevents later videos encoded in
        // the same submission from overwriting an earlier video's matrix.
        let uniform = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("Native Video Color Uniform"),
            contents: bytemuck::bytes_of(&conversion),
            usage: wgpu::BufferUsages::UNIFORM,
        });
        let bindings = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Native Video Plane Bindings"),
            layout: &self.bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(&luma_view),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::TextureView(
                        chroma_view.as_ref().unwrap_or(&luma_view),
                    ),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: wgpu::BindingResource::Sampler(&self.sampler),
                },
                wgpu::BindGroupEntry {
                    binding: 3,
                    resource: uniform.as_entire_binding(),
                },
            ],
        });
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("Native Video GPU Conversion"),
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

fn validate_surface(
    surface: &IOSurfaceRef,
    frame: &GpuVideoFrame,
    layout: PixelLayout,
) -> Result<(), String> {
    if frame.width == 0
        || frame.height == 0
        || surface.width() != frame.width as usize
        || surface.height() != frame.height as usize
    {
        return Err(format!(
            "video dimensions {}x{} do not match IOSurface {}x{}",
            frame.width,
            frame.height,
            surface.width(),
            surface.height()
        ));
    }
    if surface.pixel_format() != frame.pixel_format {
        return Err(format!(
            "video pixel format 0x{:08x} does not match IOSurface 0x{:08x}",
            frame.pixel_format,
            surface.pixel_format()
        ));
    }
    if layout == PixelLayout::Bgra {
        if surface.plane_count() != 0 || surface.bytes_per_element() != 4 {
            return Err("BGRA video IOSurface must be a packed four-byte surface".into());
        }
        return Ok(());
    }
    if surface.plane_count() != 2 {
        return Err(format!(
            "bi-planar video IOSurface has {} planes, expected two",
            surface.plane_count()
        ));
    }
    let bytes_per_component = if layout == PixelLayout::P010 { 2 } else { 1 };
    for plane in 0..2 {
        let (width, height, bytes_per_element) = if plane == 0 {
            (frame.width, frame.height, bytes_per_component)
        } else {
            (
                frame.width.div_ceil(2),
                frame.height.div_ceil(2),
                2 * bytes_per_component,
            )
        };
        if surface.width_of_plane(plane) != width as usize
            || surface.height_of_plane(plane) != height as usize
            || surface.bytes_per_element_of_plane(plane) != bytes_per_element
        {
            return Err(format!(
                "video IOSurface plane {plane} has an incompatible size or element stride"
            ));
        }
    }
    Ok(())
}

fn import_plane(
    device: &wgpu::Device,
    surface: &IOSurfaceRef,
    layout: PixelLayout,
    plane: usize,
) -> Result<wgpu::Texture, String> {
    let (width, height) = if layout == PixelLayout::Bgra {
        (surface.width() as u32, surface.height() as u32)
    } else {
        (
            surface.width_of_plane(plane) as u32,
            surface.height_of_plane(plane) as u32,
        )
    };
    let (format, metal_format) = layout.plane_formats(plane);
    // SAFETY: This only imports textures created from this exact Metal device.
    // The caller owns the CVPixelBuffer until the submission has completed.
    let raw_device = unsafe { device.as_hal::<Metal>() }
        .ok_or_else(|| "native GPU video conversion requires the Metal backend".to_string())?;
    let descriptor = unsafe {
        MTLTextureDescriptor::texture2DDescriptorWithPixelFormat_width_height_mipmapped(
            metal_format,
            width as usize,
            height as usize,
            false,
        )
    };
    descriptor.setTextureType(MTLTextureType::Type2D);
    descriptor.setStorageMode(if raw_device.raw_device().hasUnifiedMemory() {
        MTLStorageMode::Shared
    } else {
        MTLStorageMode::Managed
    });
    descriptor.setUsage(MTLTextureUsage::ShaderRead);
    let raw_texture = raw_device.raw_device()
        .newTextureWithDescriptor_iosurface_plane(&descriptor, surface, plane)
        .ok_or_else(|| format!("Metal could not import video IOSurface plane {plane} ({width}x{height}, {format:?})"))?;
    // SAFETY: The format, size, texture type and single sample/mip agree with
    // the descriptor above, and the imported texture is used only for sampling.
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
    Ok(unsafe {
        device.create_texture_from_hal::<Metal>(
            hal_texture,
            &wgpu::TextureDescriptor {
                label: Some("Native Video IOSurface Plane"),
                size: wgpu::Extent3d {
                    width,
                    height,
                    depth_or_array_layers: 1,
                },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format,
                usage: wgpu::TextureUsages::TEXTURE_BINDING,
                view_formats: &[],
            },
            wgpu::TextureUses::RESOURCE,
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn convert(matrix: ColorConversion, y: f32, cb: f32, cr: f32) -> [f32; 3] {
        [matrix.red, matrix.green, matrix.blue]
            .map(|row| row[0] * y + row[1] * cb + row[2] * cr + row[3])
    }

    fn assert_rgb(actual: [f32; 3], expected: [f32; 3]) {
        for (actual, expected) in actual.into_iter().zip(expected) {
            assert!(
                (actual - expected).abs() < 0.00001,
                "{actual} != {expected}"
            );
        }
    }

    #[test]
    fn neutral_black_and_white_match_both_code_ranges_and_bit_depths() {
        for matrix in [1, 2, 3] {
            for full in [false, true] {
                for layout in [PixelLayout::Nv12, PixelLayout::P010] {
                    let (black, white, mid, normalization) = match (layout, full) {
                        (PixelLayout::Nv12, false) => (16.0, 235.0, 128.0, 1.0 / 255.0),
                        (PixelLayout::Nv12, true) => (0.0, 255.0, 128.0, 1.0 / 255.0),
                        (PixelLayout::P010, false) => (64.0, 940.0, 512.0, 64.0 / 65535.0),
                        (PixelLayout::P010, true) => (0.0, 1023.0, 512.0, 64.0 / 65535.0),
                        _ => unreachable!(),
                    };
                    let conversion = ColorConversion::new(layout, matrix, full);
                    assert_rgb(
                        convert(
                            conversion,
                            black * normalization,
                            mid * normalization,
                            mid * normalization,
                        ),
                        [0.0; 3],
                    );
                    assert_rgb(
                        convert(
                            conversion,
                            white * normalization,
                            mid * normalization,
                            mid * normalization,
                        ),
                        [1.0; 3],
                    );
                }
            }
        }
    }

    #[test]
    fn limited_range_bt709_color_bars_decode_without_swapped_chroma() {
        // Standard normalized BT.709 Y'CbCr values for red and blue, converted
        // to unquantized 8-bit video-range samples to test the matrix precisely.
        let matrix = ColorConversion::new(PixelLayout::Nv12, 2, false);
        let y = |value: f32| (16.0 + 219.0 * value) / 255.0;
        let c = |value: f32| (128.0 + 224.0 * value) / 255.0;
        assert_rgb(
            convert(matrix, y(0.2126), c(-0.114572106), c(0.5)),
            [1.0, 0.0, 0.0],
        );
        assert_rgb(
            convert(matrix, y(0.0722), c(0.5), c(-0.04584709)),
            [0.0, 0.0, 1.0],
        );
    }

    #[test]
    fn supported_fourccs_distinguish_native_plane_layouts() {
        assert_eq!(
            PixelLayout::from_fourcc(NV12_VIDEO).unwrap(),
            PixelLayout::Nv12
        );
        assert_eq!(
            PixelLayout::from_fourcc(NV12_FULL).unwrap(),
            PixelLayout::Nv12
        );
        assert_eq!(
            PixelLayout::from_fourcc(P010_VIDEO).unwrap(),
            PixelLayout::P010
        );
        assert_eq!(
            PixelLayout::from_fourcc(P010_FULL).unwrap(),
            PixelLayout::P010
        );
        assert_eq!(PixelLayout::from_fourcc(BGRA).unwrap(), PixelLayout::Bgra);
        assert!(PixelLayout::from_fourcc(u32::from_be_bytes(*b"y420")).is_err());
    }

    #[test]
    fn conversion_shader_validates() {
        let shader = naga::front::wgsl::parse_str(include_str!("video_texture.wgsl"))
            .expect("video shader must parse");
        naga::valid::Validator::new(
            naga::valid::ValidationFlags::all(),
            naga::valid::Capabilities::empty(),
        )
        .validate(&shader)
        .expect("video shader must validate");
    }
}
