//! Upload BC blocks directly; GPU sampling performs color decompression.
use crate::hap_video::{HapFormat, HapFrame};
use std::{collections::HashMap, sync::Mutex};
use wgpu::util::DeviceExt;
struct TextureSlot {
    width: u32,
    height: u32,
    format: HapFormat,
    texture: wgpu::Texture,
    /// HAP Q Alpha's separate RGTC1 (BC4) alpha image.
    alpha: Option<wgpu::Texture>,
    bindings: wgpu::BindGroup,
    source_width: u32,
    source_height: u32,
}
pub struct HapTextureConverter {
    pipeline: wgpu::RenderPipeline,
    layout: wgpu::BindGroupLayout,
    sampler: wgpu::Sampler,
    /// Bound as the alpha image for formats that have none.
    no_alpha: wgpu::TextureView,
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
                wgpu::BindGroupLayoutEntry {
                    binding: 3,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: true },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
            ],
        });
        let no_alpha = device
            .create_texture(&wgpu::TextureDescriptor {
                label: Some("HAP no alpha image"),
                size: wgpu::Extent3d { width: 1, height: 1, depth_or_array_layers: 1 },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: wgpu::TextureFormat::R8Unorm,
                usage: wgpu::TextureUsages::TEXTURE_BINDING,
                view_formats: &[],
            })
            .create_view(&Default::default());
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
            cache: crate::pipeline_cache::for_device(device).as_ref(),
        });
        Self {
            pipeline,
            layout,
            sampler,
            no_alpha,
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
            let blocks_texture = |label, format| {
                device.create_texture(&wgpu::TextureDescriptor {
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
                    usage: wgpu::TextureUsages::COPY_DST | wgpu::TextureUsages::TEXTURE_BINDING,
                    view_formats: &[],
                })
            };
            let texture = blocks_texture(
                "HAP BC video blocks",
                match frame.format {
                    HapFormat::Rgb => wgpu::TextureFormat::Bc1RgbaUnorm,
                    HapFormat::Bptc => wgpu::TextureFormat::Bc7RgbaUnorm,
                    HapFormat::Alpha | HapFormat::YCoCg | HapFormat::YCoCgAlpha => {
                        wgpu::TextureFormat::Bc3RgbaUnorm
                    }
                },
            );
            let alpha = (frame.format == HapFormat::YCoCgAlpha)
                .then(|| blocks_texture("HAP BC4 alpha blocks", wgpu::TextureFormat::Bc4RUnorm));
            let alpha_view = alpha.as_ref().map(|t| t.create_view(&Default::default()));
            let view = texture.create_view(&Default::default());
            let settings = [
                frame.width as f32 / width as f32,
                frame.height as f32 / height as f32,
                match frame.format {
                    HapFormat::Rgb => 0.0,
                    HapFormat::Alpha | HapFormat::Bptc => 1.0,
                    HapFormat::YCoCg => 2.0,
                    HapFormat::YCoCgAlpha => 3.0,
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
                    wgpu::BindGroupEntry {
                        binding: 3,
                        resource: wgpu::BindingResource::TextureView(
                            alpha_view.as_ref().unwrap_or(&self.no_alpha),
                        ),
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
                    alpha,
                    bindings,
                    source_width: frame.width,
                    source_height: frame.height,
                },
            );
        }
        let slot_textures = &textures[&slot];
        let rows = height / 4;
        let color_bytes = (width / 4 * rows) as usize * frame.format.color_block_bytes();
        if frame.blocks.len() != (width / 4 * rows) as usize * frame.format.block_bytes() {
            return Err("HAP block data does not match texture dimensions".into());
        }
        let mut staging = self.staging.lock().map_err(|_| "HAP staging lock poisoned")?;
        let (color, alpha) = frame.blocks.split_at(color_bytes);
        upload_blocks(
            &mut staging,
            encoder,
            &slot_textures.texture,
            color,
            frame.format.color_block_bytes() as u32,
            width,
            height,
        )?;
        if let Some(texture) = &slot_textures.alpha {
            upload_blocks(&mut staging, encoder, texture, alpha, 8, width, height)?;
        }
        drop(staging);
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

/// Copies one image's BC blocks into its texture through the staging belt:
/// mapped upload memory is reused instead of queue.write_texture's fresh
/// staging allocation for every video frame. Padding is in BC rows, not
/// pixel rows, and the GPU performs the actual texture transfer.
fn upload_blocks(
    staging: &mut wgpu::util::StagingBelt,
    encoder: &mut wgpu::CommandEncoder,
    texture: &wgpu::Texture,
    blocks: &[u8],
    block_bytes: u32,
    width: u32,
    height: u32,
) -> Result<(), String> {
    let row_bytes = width / 4 * block_bytes;
    let pitch = row_bytes.div_ceil(wgpu::COPY_BYTES_PER_ROW_ALIGNMENT)
        * wgpu::COPY_BYTES_PER_ROW_ALIGNMENT;
    let rows = height / 4;
    if blocks.len() != row_bytes as usize * rows as usize {
        return Err("HAP block data does not match texture dimensions".into());
    }
    let upload = staging.allocate(
        wgpu::BufferSize::new(pitch as u64 * rows as u64).ok_or("Empty HAP frame")?,
        wgpu::BufferSize::new(wgpu::COPY_BYTES_PER_ROW_ALIGNMENT as u64).unwrap(),
    );
    {
        let mut mapped = upload.get_mapped_range_mut().map_err(|e| e.to_string())?;
        if row_bytes == pitch {
            mapped.copy_from_slice(blocks);
        } else {
            for (row, source) in blocks.chunks_exact(row_bytes as usize).enumerate() {
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
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hap_video::{test_media as media, HapVideoDecoder};

    const W: usize = 64;
    const H: usize = 48;

    fn device() -> Option<(wgpu::Device, wgpu::Queue)> {
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle());
        let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::HighPerformance,
            force_fallback_adapter: false,
            compatible_surface: None,
            apply_limit_buckets: false,
        }))
        .ok()?;
        if !adapter.features().contains(wgpu::Features::TEXTURE_COMPRESSION_BC) {
            eprintln!("skipped: this adapter has no BC texture compression");
            return None;
        }
        pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor {
            required_features: wgpu::Features::TEXTURE_COMPRESSION_BC,
            ..Default::default()
        }))
        .ok()
    }

    /// Draws a frame through the HAP converter and reads back RGBA8.
    fn draw(device: &wgpu::Device, queue: &wgpu::Queue, frame: &HapFrame) -> Vec<u8> {
        let converter = HapTextureConverter::new(device, wgpu::TextureFormat::Rgba8Unorm);
        let (w, h) = (frame.width, frame.height);
        let target = device.create_texture(&wgpu::TextureDescriptor {
            label: None,
            size: wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let view = target.create_view(&Default::default());
        let pitch = (w * 4).div_ceil(256) * 256;
        let readback = device.create_buffer(&wgpu::BufferDescriptor {
            label: None,
            size: (pitch * h) as u64,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });
        let mut encoder = device.create_command_encoder(&Default::default());
        converter.encode(device, &mut encoder, 0, frame, &view, [0.0, 0.0, w as f32, h as f32]).unwrap();
        converter.finish_uploads(&encoder);
        encoder.copy_texture_to_buffer(
            target.as_image_copy(),
            wgpu::TexelCopyBufferInfo {
                buffer: &readback,
                layout: wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(pitch), rows_per_image: Some(h) },
            },
            wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
        );
        queue.submit([encoder.finish()]);
        readback.slice(..).map_async(wgpu::MapMode::Read, |r| r.unwrap());
        device.poll(wgpu::PollType::wait_indefinitely()).unwrap();
        let mapped = readback.slice(..).get_mapped_range().unwrap();
        mapped.chunks(pitch as usize).flat_map(|row| row[..(w * 4) as usize].to_vec()).collect()
    }

    fn max_difference(a: &[u8], b: &[u8], channels: std::ops::Range<usize>) -> u8 {
        assert_eq!(a.len(), b.len());
        a.chunks(4)
            .zip(b.chunks(4))
            .flat_map(|(x, y)| channels.clone().map(move |c| x[c].abs_diff(y[c])))
            .max()
            .unwrap()
    }

    fn first_frame(dir: &std::path::Path, name: &str, movie: &[u8]) -> HapFrame {
        let path = dir.join(name);
        std::fs::write(&path, movie).unwrap();
        let mut decoder = HapVideoDecoder::open(&path).unwrap();
        decoder.next_frame().unwrap().unwrap()
    }

    fn temp_dir(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("ghost-hap-{tag}-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// HAP Q Alpha (colour plus a separate RGTC1 alpha image) and HAP R
    /// (BC7) movies open, decode and draw with straight alpha.
    #[test]
    fn hap_q_alpha_and_hap_r_draw_on_the_gpu() {
        let Some((device, queue)) = device() else { return };
        let dir = temp_dir("formats");
        let picture = media::picture(W, H, 0);
        // HAP Q Alpha: flat YCoCg DXT5 blocks (exact on any GPU) and the
        // picture's alpha as RGTC1, in a chunked Snappy section.
        let (bw, bh) = (W / 4, H / 4);
        let mut color = Vec::new();
        let mut expected = vec![0u8; W * H * 4];
        for by in 0..bh {
            for bx in 0..bw {
                let (co, cg, y) = ((bx * 2 + 3) as u16 & 31, (by * 5 + 10) as u16 & 63, (90 + bx * 7 + by * 3) as u8);
                let c = (co << 11) | (cg << 5);
                color.extend([y, y, 0, 0, 0, 0, 0, 0]);
                color.extend(c.to_le_bytes());
                color.extend(c.to_le_bytes());
                color.extend([0; 4]);
                let (co, cg, y) = (co as f64 / 31.0 - 128.0 / 255.0, cg as f64 / 63.0 - 128.0 / 255.0, y as f64 / 255.0);
                let rgb = [y + co - cg, y + cg, y - co - cg].map(|v| (v.clamp(0.0, 1.0) * 255.0).round() as u8);
                for i in 0..16 {
                    let at = ((by * 4 + i / 4) * W + bx * 4 + i % 4) * 4;
                    expected[at..at + 3].copy_from_slice(&rgb);
                }
            }
        }
        let alpha_values: Vec<u8> = picture.chunks(4).map(|p| p[3]).collect();
        let alpha = media::bc4(&alpha_values, W, H);
        for (i, a) in media::bc4_decode(&alpha, W, H).into_iter().enumerate() {
            expected[i * 4 + 3] = a;
        }
        let packet = media::section(0x0d, &[media::section(0xaf, &color), media::chunked(0x01, &alpha, 3)].concat());
        let frame = first_frame(&dir, "q-alpha.mov", &media::mov(b"HapM", W as u16, H as u16, &[packet.clone(), packet]));
        assert_eq!(frame.format, HapFormat::YCoCgAlpha);
        let drawn = draw(&device, &queue, &frame);
        assert!(max_difference(&drawn, &expected, 0..3) <= 2, "HAP Q Alpha colour");
        assert!(max_difference(&drawn, &expected, 3..4) <= 2, "HAP Q Alpha alpha");
        assert!(drawn.chunks(4).any(|p| p[3] == 0) && drawn.chunks(4).any(|p| p[3] == 255));

        // HAP R: BC7 blocks, against a CPU decode of the same blocks and,
        // loosely, the picture itself (orientation and channel order).
        let blocks = media::bc7(&picture, W, H);
        let packet = media::section(0xbc, &snap::raw::Encoder::new().compress_vec(&blocks).unwrap());
        let frame = first_frame(&dir, "hap-r.mov", &media::mov(b"Hap7", W as u16, H as u16, &[packet]));
        assert_eq!(frame.format, HapFormat::Bptc);
        let drawn = draw(&device, &queue, &frame);
        assert!(max_difference(&drawn, &media::bc7_decode(&blocks, W, H), 0..4) <= 1, "HAP R against its blocks");
        assert!(max_difference(&drawn, &picture, 0..4) <= 40, "HAP R against the picture");
        std::fs::remove_dir_all(dir).unwrap();
    }

    fn ffmpeg_rgba(ffmpeg: &str, path: &std::path::Path) -> Vec<u8> {
        let out = std::process::Command::new(ffmpeg)
            .args(["-v", "error", "-i"])
            .arg(path)
            .args(["-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "-"])
            .output()
            .unwrap();
        assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
        out.stdout
    }

    /// HAP Q and HAP Q Alpha against FFmpeg's own decode of the same files.
    /// The HAP Q Alpha movie pairs FFmpeg's HAP Q colour image with an
    /// RGTC1 alpha image built here: no available encoder writes HapM.
    #[test]
    #[ignore = "Requires GA_TEST_FFMPEG pointing at the bundled FFmpeg"]
    fn hap_q_and_hap_q_alpha_match_ffmpeg() {
        let ffmpeg = std::env::var("GA_TEST_FFMPEG").expect("Set GA_TEST_FFMPEG");
        let Some((device, queue)) = device() else { return };
        let dir = temp_dir("ffmpeg");
        let picture = media::picture(W, H, 0);
        let raw = dir.join("picture.rgba");
        std::fs::write(&raw, &picture).unwrap();
        let hap_q = dir.join("hap-q.mov");
        let status = std::process::Command::new(&ffmpeg)
            .args(["-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", &format!("{W}x{H}"), "-r", "25", "-i"])
            .arg(&raw)
            .args(["-c:v", "hap", "-format", "hap_q", "-chunks", "2"])
            .arg(&hap_q)
            .status()
            .unwrap();
        assert!(status.success());
        let q_frame = HapVideoDecoder::open(&hap_q).unwrap().next_frame().unwrap().unwrap();
        let reference = ffmpeg_rgba(&ffmpeg, &hap_q);
        let drawn = draw(&device, &queue, &q_frame);
        let q_error = max_difference(&drawn, &reference, 0..3);
        assert!(q_error <= 3, "HAP Q differs from FFmpeg by {q_error}");

        let alpha_values: Vec<u8> = picture.chunks(4).map(|p| p[3]).collect();
        let alpha = media::bc4(&alpha_values, W, H);
        let packet = media::section(0x0d, &[media::section(0xaf, &q_frame.blocks), media::chunked(0x01, &alpha, 2)].concat());
        let path = dir.join("q-alpha.mov");
        std::fs::write(&path, media::mov(b"HapM", W as u16, H as u16, &[packet])).unwrap();
        let reference = ffmpeg_rgba(&ffmpeg, &path);
        let frame = HapVideoDecoder::open(&path).unwrap().next_frame().unwrap().unwrap();
        let drawn = draw(&device, &queue, &frame);
        let color_error = max_difference(&drawn, &reference, 0..3);
        let alpha_error = max_difference(&drawn, &reference, 3..4);
        println!("HAP Q {q_error}, HAP Q Alpha colour {color_error}, alpha {alpha_error} (max 8-bit level difference from FFmpeg)");
        assert!(color_error <= 3 && alpha_error <= 2);
        // FFmpeg really read the alpha image (not an opaque frame).
        assert!(max_difference(&reference, &picture, 3..4) <= 8);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
