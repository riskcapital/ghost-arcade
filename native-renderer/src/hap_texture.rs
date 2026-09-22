//! Upload BC blocks directly; GPU sampling performs color decompression.
use crate::hap_video::{HapFormat, HapFrame};
use std::{collections::HashMap, sync::Mutex};
use wgpu::util::DeviceExt;
struct TextureSlot {
    width: u32,
    height: u32,
    format: HapFormat,
    texture: wgpu::Texture,
    bindings: wgpu::BindGroup,
    source_width: u32,
    source_height: u32,
}
pub struct HapTextureConverter {
    pipeline: wgpu::RenderPipeline,
    layout: wgpu::BindGroupLayout,
    sampler: wgpu::Sampler,
    textures: Mutex<HashMap<usize, TextureSlot>>,
    staging: Mutex<wgpu::util::StagingBelt>,
}
impl HapTextureConverter {
    pub fn release(&self, slot: usize) {
        if let Ok(mut textures) = self.textures.lock() {
            textures.remove(&slot);
        }
    }
    /// Call once after encoding all HAP frames in a submission. Mapping is
    /// deferred until GPU completion, so in-flight pixels cannot be overwritten.
    pub fn finish_uploads(&self, encoder: &wgpu::CommandEncoder) {
        self.staging.lock().expect("HAP staging lock poisoned")
            .finish_and_recall_on_submit(encoder);
    }
    pub fn new(device: &wgpu::Device, target: wgpu::TextureFormat) -> Self {
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("HAP texture layout"),
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
                wgpu::BindGroupLayoutEntry {
                    binding: 2,
                    visibility: wgpu::ShaderStages::VERTEX_FRAGMENT,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: wgpu::BufferSize::new(16),
                    },
                    count: None,
                },
            ],
        });
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("HAP texture shader"),
            source: wgpu::ShaderSource::Wgsl(include_str!("hap_texture.wgsl").into()),
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("HAP pipeline layout"),
            bind_group_layouts: &[Some(&layout)],
            immediate_size: 0,
        });
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("HAP GPU decompression"),
            layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs_main"),
                buffers: &[],
                compilation_options: Default::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fs_main"),
                targets: &[Some(wgpu::ColorTargetState {
                    format: target,
                    blend: None,
                    write_mask: wgpu::ColorWrites::ALL,
                })],
                compilation_options: Default::default(),
            }),
            primitive: Default::default(),
            depth_stencil: None,
            multisample: Default::default(),
            multiview_mask: None,
            cache: None,
        });
        Self {
            pipeline,
            layout,
            sampler,
            textures: Mutex::new(HashMap::new()),
            staging: Mutex::new(wgpu::util::StagingBelt::new(device.clone(), 4 * 1024 * 1024)),
        }
    }
    pub fn encode(
        &self,
        device: &wgpu::Device,
        encoder: &mut wgpu::CommandEncoder,
        slot: usize,
        frame: &HapFrame,
        target: &wgpu::TextureView,
        viewport: [f32; 4],
    ) -> Result<(), String> {
        if !device
            .features()
            .contains(wgpu::Features::TEXTURE_COMPRESSION_BC)
        {
            return Err("GPU does not support HAP compressed textures".into());
        }
        let width = frame.width.div_ceil(4) * 4;
        let height = frame.height.div_ceil(4) * 4;
        if width > device.limits().max_texture_dimension_2d
            || height > device.limits().max_texture_dimension_2d
        {
            return Err("HAP frame exceeds GPU texture limits".into());
        }
        let mut textures = self
            .textures
            .lock()
            .map_err(|_| "HAP texture lock poisoned")?;
        if textures.get(&slot).is_none_or(|t| {
            t.width != width
                || t.height != height
                || t.format != frame.format
                || t.source_width != frame.width
                || t.source_height != frame.height
        }) {
            let texture = device.create_texture(&wgpu::TextureDescriptor {
                label: Some("HAP BC video blocks"),
                size: wgpu::Extent3d {
                    width,
                    height,
                    depth_or_array_layers: 1,
                },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: if frame.format == HapFormat::Rgb {
                    wgpu::TextureFormat::Bc1RgbaUnorm
                } else {
                    wgpu::TextureFormat::Bc3RgbaUnorm
                },
                usage: wgpu::TextureUsages::COPY_DST | wgpu::TextureUsages::TEXTURE_BINDING,
                view_formats: &[],
            });
            let view = texture.create_view(&Default::default());
            let settings = [
                frame.width as f32 / width as f32,
                frame.height as f32 / height as f32,
                match frame.format {
                    HapFormat::Rgb => 0.0,
                    HapFormat::Alpha => 1.0,
                    HapFormat::YCoCg => 2.0,
                },
                0.0,
            ];
            let uniform = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("HAP sampling settings"),
                contents: bytemuck::cast_slice(&settings),
                usage: wgpu::BufferUsages::UNIFORM,
            });
            let bindings = device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("HAP bindings"),
                layout: &self.layout,
                entries: &[
                    wgpu::BindGroupEntry {
                        binding: 0,
                        resource: wgpu::BindingResource::TextureView(&view),
                    },
                    wgpu::BindGroupEntry {
                        binding: 1,
                        resource: wgpu::BindingResource::Sampler(&self.sampler),
                    },
                    wgpu::BindGroupEntry {
                        binding: 2,
                        resource: uniform.as_entire_binding(),
                    },
                ],
            });
            textures.insert(
                slot,
                TextureSlot {
                    width,
                    height,
                    format: frame.format,
                    texture,
                    bindings,
                    source_width: frame.width,
                    source_height: frame.height,
                },
            );
        }
        let texture = &textures[&slot].texture;
        // Reuse mapped upload memory instead of queue.write_texture's fresh
        // staging allocation for every video frame. Padding is in BC rows,
        // not pixel rows, and the GPU performs the actual texture transfer.
        let row_bytes = width / 4 * frame.format.block_bytes() as u32;
        let pitch = row_bytes.div_ceil(wgpu::COPY_BYTES_PER_ROW_ALIGNMENT)
            * wgpu::COPY_BYTES_PER_ROW_ALIGNMENT;
        let rows = height / 4;
        if frame.blocks.len() != row_bytes as usize * rows as usize {
            return Err("HAP block data does not match texture dimensions".into());
        }
        let mut staging = self.staging.lock().map_err(|_| "HAP staging lock poisoned")?;
        let upload = staging.allocate(
            wgpu::BufferSize::new(pitch as u64 * rows as u64).ok_or("Empty HAP frame")?,
            wgpu::BufferSize::new(wgpu::COPY_BYTES_PER_ROW_ALIGNMENT as u64).unwrap(),
        );
        {
            let mut mapped = upload.get_mapped_range_mut().map_err(|e| e.to_string())?;
            if row_bytes == pitch {
                mapped.copy_from_slice(&frame.blocks);
            } else {
                for (row, source) in frame.blocks.chunks_exact(row_bytes as usize).enumerate() {
                    let start = row * pitch as usize;
                    mapped.slice(start..start + row_bytes as usize).copy_from_slice(source);
                }
            }
        }
        encoder.copy_buffer_to_texture(
            wgpu::TexelCopyBufferInfo {
                buffer: upload.buffer(),
                layout: wgpu::TexelCopyBufferLayout {
                    offset: upload.offset(), bytes_per_row: Some(pitch), rows_per_image: Some(rows),
                },
            },
            wgpu::TexelCopyTextureInfo {
                texture, mip_level: 0, origin: wgpu::Origin3d::ZERO, aspect: wgpu::TextureAspect::All,
            },
            wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
        );
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("HAP GPU color conversion"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: target,
                depth_slice: None,
                resolve_target: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                    store: wgpu::StoreOp::Store,
                },
            })],
            depth_stencil_attachment: None,
            timestamp_writes: None,
            occlusion_query_set: None,
            multiview_mask: None,
        });
        pass.set_pipeline(&self.pipeline);
        pass.set_bind_group(0, &textures[&slot].bindings, &[]);
        pass.set_viewport(viewport[0], viewport[1], viewport[2], viewport[3], 0.0, 1.0);
        pass.draw(0..3, 0..1);
        Ok(())
    }
}
