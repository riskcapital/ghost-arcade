//! The creative master is shared by all outputs; calibration and blackout
//! run last. Input bindings are rebuilt only when the master is resized.
use super::*;

pub(super) struct OutputPresenter {
    pipeline: wgpu::RenderPipeline,
    uniform: wgpu::Buffer,
    uniforms: wgpu::BindGroup,
    input_layout: wgpu::BindGroupLayout,
    sampler: wgpu::Sampler,
    inputs: Vec<wgpu::BindGroup>,
}

impl OutputPresenter {
    pub(super) fn new(
        device: &wgpu::Device,
        shader: &wgpu::ShaderModule,
        format: wgpu::TextureFormat,
        textures: &[wgpu::Texture; 2],
    ) -> Self {
        let uniform = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Output calibration uniforms"),
            size: std::mem::size_of::<Uniforms>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let uniform_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("Output calibration layout"),
            entries: &[wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Buffer {
                    ty: wgpu::BufferBindingType::Uniform,
                    has_dynamic_offset: false,
                    min_binding_size: None,
                },
                count: None,
            }],
        });
        let uniforms = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Output calibration"),
            layout: &uniform_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: uniform.as_entire_binding(),
            }],
        });
        let input_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("Creative master input"),
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
        let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Final output layout"),
            bind_group_layouts: &[Some(&uniform_layout), Some(&input_layout)],
            immediate_size: 0,
        });
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("Final output"),
            layout: Some(&layout),
            vertex: wgpu::VertexState {
                module: shader,
                entry_point: Some("vs_main"),
                compilation_options: Default::default(),
                buffers: &[],
            },
            fragment: Some(wgpu::FragmentState {
                module: shader,
                entry_point: Some("fs_output"),
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format,
                    blend: None,
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            primitive: Default::default(),
            depth_stencil: None,
            multisample: Default::default(),
            multiview_mask: None,
            cache: None,
        });
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });
        let mut result = Self {
            pipeline,
            uniform,
            uniforms,
            input_layout,
            sampler,
            inputs: Vec::new(),
        };
        result.set_inputs(device, textures);
        result
    }

    pub(super) fn set_inputs(&mut self, device: &wgpu::Device, textures: &[wgpu::Texture; 2]) {
        self.inputs = textures
            .iter()
            .map(|texture| {
                device.create_bind_group(&wgpu::BindGroupDescriptor {
                    label: Some("Creative master"),
                    layout: &self.input_layout,
                    entries: &[
                        wgpu::BindGroupEntry {
                            binding: 0,
                            resource: wgpu::BindingResource::TextureView(
                                &texture.create_view(&Default::default()),
                            ),
                        },
                        wgpu::BindGroupEntry {
                            binding: 1,
                            resource: wgpu::BindingResource::Sampler(&self.sampler),
                        },
                    ],
                })
            })
            .collect();
    }

    // Callers submit before another output rewrites this uniform buffer.
    pub(super) fn draw(
        &self,
        queue: &wgpu::Queue,
        encoder: &mut wgpu::CommandEncoder,
        target: &wgpu::TextureView,
        index: usize,
        width: u32,
        height: u32,
        gate: f32,
        stage: OutputStage,
        time: f32,
    ) {
        let uniforms = Uniforms {
            resolution: [width as f32, height as f32],
            time,
            output_gate: gate,
            out0: stage.out0,
            out1: stage.out1,
            edge: stage.edge,
            dome0: stage.dome0,
            dome1: stage.dome1,
            dome2: stage.dome2,
            edge_gamma: stage.edge_gamma,
            black_level: stage.black_level,
            swarp: stage.swarp,
            swarp_c0: stage.swarp_c0,
            swarp_c1: stage.swarp_c1,
            mwarp: stage.mwarp,
            mwarp_c0: stage.mwarp_c0,
            mwarp_c1: stage.mwarp_c1,
            swarp_mesh: stage.swarp_mesh,
            mwarp_mesh: stage.mwarp_mesh,
            ..Uniforms::zeroed()
        };
        queue.write_buffer(&self.uniform, 0, bytemuck::bytes_of(&uniforms));
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("Calibrated output"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: target,
                resolve_target: None,
                depth_slice: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                    store: wgpu::StoreOp::Store,
                },
            })],
            ..Default::default()
        });
        pass.set_pipeline(&self.pipeline);
        pass.set_bind_group(0, &self.uniforms, &[]);
        pass.set_bind_group(1, &self.inputs[index], &[]);
        pass.draw(0..3, 0..1);
    }
}
