//! The creative master is shared by all outputs; calibration and blackout
//! run last. Input bindings are rebuilt only when the master is resized.
//!
//! Each draw takes its own slot of a uniform ring (a dynamic offset), so the
//! program, Screens, the dome view and mirror domes of one frame can all be
//! recorded before a single submit: `queue.write_buffer` only lands at the
//! next submit, so a shared uniform would leave every draw with the last
//! one's values.
use super::*;
use std::cell::RefCell;

/// Ring slots made at start; doubled whenever a frame draws more outputs.
const INITIAL_RING_SLOTS: u64 = 8;

struct UniformRing {
    buffer: wgpu::Buffer,
    bind_group: wgpu::BindGroup,
    slots: u64,
    next: u64,
}

pub(super) struct OutputPresenter {
    device: wgpu::Device,
    pipeline: wgpu::RenderPipeline,
    uniform_layout: wgpu::BindGroupLayout,
    /// Bytes between ring slots: the uniforms rounded up to the device's
    /// dynamic-offset alignment.
    ring_stride: u64,
    ring: RefCell<UniformRing>,
    input_layout: wgpu::BindGroupLayout,
    sampler: wgpu::Sampler,
    inputs: Vec<wgpu::BindGroup>,
    format: wgpu::TextureFormat,
    /// Layers placed on the dome, drawn into dome space by the compositor's
    /// dome pass and laid over the dome reprojection here. Square; made
    /// only while some layer is placed on a dome output.
    dome_layers: Option<(wgpu::Texture, wgpu::TextureView)>,
    /// One transparent texel standing in for `dome_layers` when there are none.
    dome_blank: wgpu::TextureView,
    /// Flux from a paired phone, the beat clock and the running time, set by
    /// the renderer each frame so every output drawn here plays the same Flux.
    pub(super) flux: [[f32; 4]; 2],
    pub(super) flux_regions: [[f32; 4]; MAX_FLUX_REGIONS],
    pub(super) clock: [f32; 4],
    pub(super) live_time: f32,
}

impl OutputPresenter {
    pub(super) fn new(
        device: &wgpu::Device,
        shader: &wgpu::ShaderModule,
        format: wgpu::TextureFormat,
        textures: &[wgpu::Texture; 2],
    ) -> Self {
        let uniform_size = std::mem::size_of::<Uniforms>() as u64;
        let uniform_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("Output calibration layout"),
            entries: &[wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Buffer {
                    ty: wgpu::BufferBindingType::Uniform,
                    has_dynamic_offset: true,
                    min_binding_size: wgpu::BufferSize::new(uniform_size),
                },
                count: None,
            }],
        });
        let align = u64::from(device.limits().min_uniform_buffer_offset_alignment.max(1));
        let ring_stride = uniform_size.div_ceil(align) * align;
        let ring = RefCell::new(Self::make_ring(device, &uniform_layout, ring_stride, INITIAL_RING_SLOTS));
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
                wgpu::BindGroupLayoutEntry {
                    binding: 2,
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
            cache: crate::pipeline_cache::for_device(device).as_ref(),
        });
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });
        // Textures start zeroed: a transparent texel.
        let dome_blank = Self::dome_texture(device, 1, format).create_view(&Default::default());
        let mut result = Self {
            device: device.clone(),
            format,
            dome_layers: None,
            dome_blank,
            pipeline,
            uniform_layout,
            ring_stride,
            ring,
            flux: [[0.0; 4]; 2],
            flux_regions: [[0.0; 4]; MAX_FLUX_REGIONS],
            clock: [0.0, 120.0, 0.0, 0.0],
            live_time: 0.0,
            input_layout,
            sampler,
            inputs: Vec::new(),
        };
        result.set_inputs(device, textures);
        result
    }

    fn make_ring(device: &wgpu::Device, layout: &wgpu::BindGroupLayout, stride: u64, slots: u64) -> UniformRing {
        let buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Output calibration uniforms"),
            size: stride * slots,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Output calibration"),
            layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: wgpu::BindingResource::Buffer(wgpu::BufferBinding {
                    buffer: &buffer,
                    offset: 0,
                    size: wgpu::BufferSize::new(std::mem::size_of::<Uniforms>() as u64),
                }),
            }],
        });
        UniformRing { buffer, bind_group, slots, next: 0 }
    }

    /// A new frame's draws start again at the first ring slot. Call only once
    /// every draw recorded since the last call has been submitted.
    pub(super) fn begin_frame(&self) {
        self.ring.borrow_mut().next = 0;
    }

    /// The next free ring slot: its buffer, bind group and offset. A full
    /// ring is replaced by one twice the size; draws already recorded keep
    /// the old buffer alive and read their own slots from it.
    fn next_slot(&self) -> (wgpu::Buffer, wgpu::BindGroup, u64) {
        let mut ring = self.ring.borrow_mut();
        if ring.next >= ring.slots {
            *ring = Self::make_ring(&self.device, &self.uniform_layout, self.ring_stride, ring.slots * 2);
        }
        let offset = ring.next * self.ring_stride;
        ring.next += 1;
        (ring.buffer.clone(), ring.bind_group.clone(), offset)
    }

    fn dome_texture(device: &wgpu::Device, size: u32, format: wgpu::TextureFormat) -> wgpu::Texture {
        device.create_texture(&wgpu::TextureDescriptor {
            label: Some("Dome layers"),
            size: wgpu::Extent3d { width: size, height: size, depth_or_array_layers: 1 },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        })
    }

    /// Keeps the dome-layer picture at `size` square (Some) or drops it
    /// (None), rebuilding the inputs when that changes what they bind.
    pub(super) fn set_dome_layers(&mut self, device: &wgpu::Device, textures: &[wgpu::Texture; 2], size: Option<u32>) {
        let current = self.dome_layers.as_ref().map(|(texture, _)| texture.width());
        if current == size {
            return;
        }
        self.dome_layers = size.map(|size| {
            let texture = Self::dome_texture(device, size, self.format);
            let view = texture.create_view(&Default::default());
            (texture, view)
        });
        self.set_inputs(device, textures);
    }

    /// Where the compositor's dome pass draws, while any layer is placed on the dome.
    pub(super) fn dome_layers_view(&self) -> Option<&wgpu::TextureView> {
        self.dome_layers.as_ref().map(|(_, view)| view)
    }

    pub(super) fn set_inputs(&mut self, device: &wgpu::Device, textures: &[wgpu::Texture; 2]) {
        self.inputs = textures
            .iter()
            .map(|texture| self.input_bind_group(device, &texture.create_view(&Default::default())))
            .collect();
    }

    /// Presenter input for any texture the size of an output, such as a
    /// Map Sim projector view feeding a Screen.
    pub(super) fn input_bind_group(&self, device: &wgpu::Device, view: &wgpu::TextureView) -> wgpu::BindGroup {
        device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Creative master"),
            layout: &self.input_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(view),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::Sampler(&self.sampler),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: wgpu::BindingResource::TextureView(self.dome_layers_view().unwrap_or(&self.dome_blank)),
                },
            ],
        })
    }

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
        self.draw_input(queue, encoder, target, &self.inputs[index], width, height, gate, stage, time);
    }

    /// Same as `draw`, from an explicit input bind group.
    #[allow(clippy::too_many_arguments)]
    pub(super) fn draw_input(
        &self,
        queue: &wgpu::Queue,
        encoder: &mut wgpu::CommandEncoder,
        target: &wgpu::TextureView,
        input: &wgpu::BindGroup,
        width: u32,
        height: u32,
        gate: f32,
        stage: OutputStage,
        time: f32,
    ) {
        let uniforms = Uniforms {
            resolution: [width as f32, height as f32],
            // Callers pass 0 when they have no clock of their own; Flux needs one that runs.
            time: if time > 0.0 { time } else { self.live_time },
            clock: self.clock,
            flux0: self.flux[0],
            flux1: self.flux[1],
            flux_regions: self.flux_regions,
            output_gate: gate,
            out0: stage.out0,
            out1: stage.out1,
            edge: stage.edge,
            dome0: stage.dome0,
            dome1: stage.dome1,
            dome2: stage.dome2,
            dome3: stage.dome3,
            dome4: stage.dome4,
            dlayer: stage.dlayer,
            dview: stage.dview,
            dview1: stage.dview1,
            dproj0: stage.dproj0,
            dproj1: stage.dproj1,
            dprojs: stage.dprojs,
            edge_gamma: stage.edge_gamma,
            black_level: stage.black_level,
            projector_calibration: stage.projector_calibration,
            swarp: stage.swarp,
            swarp_c0: stage.swarp_c0,
            swarp_c1: stage.swarp_c1,
            mwarp: stage.mwarp,
            mwarp_c0: stage.mwarp_c0,
            mwarp_c1: stage.mwarp_c1,
            swarp_mesh: stage.swarp_mesh,
            mwarp_mesh: stage.mwarp_mesh,
            smask: stage.smask,
            smask_info: stage.smask_info,
            smask_bounds: stage.smask_bounds,
            smask_pts: stage.smask_pts,
            swarp_tangents: stage.swarp_tangents,
            mwarp_tangents: stage.mwarp_tangents,
            ..Uniforms::zeroed()
        };
        let (buffer, bind_group, offset) = self.next_slot();
        crate::churn_probe::write_buffer(queue, &buffer, offset, bytemuck::bytes_of(&uniforms));
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
        pass.set_bind_group(0, &bind_group, &[offset as u32]);
        pass.set_bind_group(1, input, &[]);
        pass.draw(0..3, 0..1);
    }
}
