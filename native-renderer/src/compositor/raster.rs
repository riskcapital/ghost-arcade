//! Rasterised layers: the program composite drawn as one draw per layer
//! instead of one fullscreen pass that loops over the layers per pixel.
//! Opt-in with GA_CORE_COMPOSITOR=raster (see raster.wgsl for the shaders).
//!
//! Each frame `plan_raster_frame` decides whether the frame can be drawn
//! this way. One that cannot (a hierarchy mask, Edge Effects, generated
//! content, source mips, an output transform, too many read-back blends)
//! is drawn whole by the legacy compositor; a frame is never part one, part
//! the other.
//!
//! The layers blend into a float accumulation target that holds what the
//! legacy shader keeps in registers, so the result is the same: Normal,
//! Screen and Multiply blend in hardware (equal to the shader's blend up to
//! float rounding, see `RASTER_TOLERANCE_LSB`), other modes read the stack
//! below from a copy of the target and blend with the shader's own code.

use crate::*;

/// Accumulation target format: what the legacy shader keeps in f32 registers.
pub(crate) const RASTER_ACCUM_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba32Float;

/// Read-back blends (modes other than Normal, Screen, Multiply) a frame may
/// have before it is cheaper to draw it with the legacy compositor: each
/// one ends the render pass and copies the pixels under the layer.
pub(crate) const RASTER_MAX_READBACK_BLENDS: usize = 4;

/// The largest difference from the legacy compositor, in 8-bit steps: the
/// hardware blends compute the shader's blend in a different order
/// (`s a + d (1 - a)` against `d + (s - d) a`), which can round a value that
/// lands on a step boundary to the next step.
#[allow(dead_code)]
pub(crate) const RASTER_TOLERANCE_LSB: u8 = 1;

/// GA_CORE_COMPOSITOR=raster.
pub(crate) fn raster_compositor_requested() -> bool {
    static ON: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *ON.get_or_init(|| std::env::var("GA_CORE_COMPOSITOR").is_ok_and(|value| value.trim().eq_ignore_ascii_case("raster")))
}

/// The raster compositor shader: heartbeat.wgsl without generated content
/// (RASTER_LEAN), plus raster.wgsl.
pub(crate) fn raster_wgsl(mode: SourceFrameMode, bindings: usize) -> String {
    let mut source = heartbeat_wgsl_with(mode, bindings, false, true);
    source.push_str(include_str!("raster.wgsl"));
    source
}

/// One layer draw: the layer and the pixel rectangle (x0, y0, x1, y1, y
/// down) its scissor cuts the fullscreen triangle to.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct RasterDraw {
    pub(crate) layer: u32,
    pub(crate) pixels: [u32; 4],
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum RasterBlend {
    Normal,
    Screen,
    Multiply,
    /// Read the stack below (any mode).
    Readback,
}

/// A run of draws with one pipeline. A read-back run is one layer, whose
/// pixels are copied first.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct RasterRun {
    pub(crate) blend: RasterBlend,
    pub(crate) first: usize,
    pub(crate) count: usize,
}

pub(crate) struct RasterPipelines {
    normal: wgpu::RenderPipeline,
    screen: wgpu::RenderPipeline,
    multiply: wgpu::RenderPipeline,
    readback: wgpu::RenderPipeline,
    resolve: wgpu::RenderPipeline,
}

struct RasterTargets {
    width: u32,
    height: u32,
    accum: wgpu::Texture,
    accum_view: wgpu::TextureView,
    scratch: wgpu::Texture,
    /// group 2 over the scratch copy (layer passes) and over the
    /// accumulation target (resolve).
    scratch_bind: wgpu::BindGroup,
    accum_bind: wgpu::BindGroup,
}

pub(crate) struct RasterCompositor {
    pipelines: Arc<std::sync::OnceLock<RasterPipelines>>,
    input_layout: wgpu::BindGroupLayout,
    targets: Option<RasterTargets>,
    draws: Vec<RasterDraw>,
    runs: Vec<RasterRun>,
    /// This frame's plan is drawable (set by `plan_raster_frame`).
    active: bool,
    pub(crate) frames: u64,
    pub(crate) fallback_frames: u64,
    pub(crate) last_fallback: &'static str,
}

fn layer_blend_state(blend: RasterBlend) -> wgpu::BlendState {
    use wgpu::{BlendComponent, BlendFactor as F, BlendOperation};
    let color = |src_factor, dst_factor| BlendComponent { src_factor, dst_factor, operation: BlendOperation::Add };
    let alpha = color(F::One, F::OneMinusSrcAlpha);
    match blend {
        RasterBlend::Normal => wgpu::BlendState { color: color(F::SrcAlpha, F::OneMinusSrcAlpha), alpha },
        RasterBlend::Screen => wgpu::BlendState { color: color(F::One, F::OneMinusSrc), alpha },
        RasterBlend::Multiply => wgpu::BlendState { color: color(F::Zero, F::Src), alpha },
        RasterBlend::Readback => wgpu::BlendState::REPLACE,
    }
}

impl RasterCompositor {
    /// Starts building the pipelines on a worker; frames are drawn by the
    /// legacy compositor until they are ready. None when the device cannot
    /// blend float targets.
    pub(crate) fn new(device: &wgpu::Device, scene_layout: &wgpu::BindGroupLayout,
        source_frames_layout: &wgpu::BindGroupLayout, mode: SourceFrameMode, bindings: usize,
        output_format: wgpu::TextureFormat) -> Option<Self> {
        if !device.features().contains(wgpu::Features::FLOAT32_BLENDABLE) {
            eprintln!("[GhostRenderCore] raster compositor unavailable: no float32 blending");
            return None;
        }
        let input_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("Ghost Render Core Raster Input Layout"),
            entries: &[wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Texture {
                    sample_type: wgpu::TextureSampleType::Float { filterable: false },
                    view_dimension: wgpu::TextureViewDimension::D2,
                    multisampled: false,
                },
                count: None,
            }],
        });
        let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Ghost Render Core Raster Pipeline Layout"),
            bind_group_layouts: &[Some(scene_layout), Some(source_frames_layout), Some(&input_layout)],
            immediate_size: 0,
        });
        let pipelines = Arc::new(std::sync::OnceLock::new());
        let (worker_device, slot) = (device.clone(), Arc::clone(&pipelines));
        let _ = thread::Builder::new().name("ghost-compositor-raster".to_string()).spawn(move || {
            let device = worker_device;
            let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
                label: Some("Ghost Render Core Raster Compositor"),
                source: wgpu::ShaderSource::Wgsl(raster_wgsl(mode, bindings).into()),
            });
            let layer_pipeline = |entry: &str, blend: RasterBlend, label: &str| {
                device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                    label: Some(label),
                    layout: Some(&layout),
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
                        entry_point: Some(entry),
                        compilation_options: wgpu::PipelineCompilationOptions::default(),
                        targets: &[Some(wgpu::ColorTargetState {
                            format: RASTER_ACCUM_FORMAT,
                            blend: Some(layer_blend_state(blend)),
                            write_mask: wgpu::ColorWrites::ALL,
                        })],
                    }),
                    multiview_mask: None,
                    cache: pipeline_cache::for_device(&device).as_ref(),
                })
            };
            let normal = layer_pipeline("fs_raster", RasterBlend::Normal, "Ghost Render Core Raster Normal");
            let screen = layer_pipeline("fs_raster", RasterBlend::Screen, "Ghost Render Core Raster Screen");
            let multiply = layer_pipeline("fs_raster", RasterBlend::Multiply, "Ghost Render Core Raster Multiply");
            let readback = layer_pipeline("fs_raster_dst", RasterBlend::Readback, "Ghost Render Core Raster Readback");
            let resolve = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some("Ghost Render Core Raster Resolve"),
                layout: Some(&layout),
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
                    entry_point: Some("fs_resolve"),
                    compilation_options: wgpu::PipelineCompilationOptions::default(),
                    targets: &[Some(wgpu::ColorTargetState {
                        format: output_format,
                        blend: Some(wgpu::BlendState::REPLACE),
                        write_mask: wgpu::ColorWrites::ALL,
                    })],
                }),
                multiview_mask: None,
                cache: pipeline_cache::for_device(&device).as_ref(),
            });
            let _ = slot.set(RasterPipelines { normal, screen, multiply, readback, resolve });
        });
        Some(Self {
            pipelines,
            input_layout,
            targets: None,
            draws: Vec::new(),
            runs: Vec::new(),
            active: false,
            frames: 0,
            fallback_frames: 0,
            last_fallback: "",
        })
    }

    pub(crate) fn ready(&self) -> bool {
        self.pipelines.get().is_some()
    }

    fn ensure_targets(&mut self, device: &wgpu::Device, width: u32, height: u32) {
        if self.targets.as_ref().is_some_and(|targets| targets.width == width && targets.height == height) {
            return;
        }
        let texture = |label: &str, usage: wgpu::TextureUsages| device.create_texture(&wgpu::TextureDescriptor {
            label: Some(label),
            size: wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: RASTER_ACCUM_FORMAT,
            usage,
            view_formats: &[],
        });
        let accum = texture("Ghost Render Core Raster Accumulation",
            wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_SRC);
        let scratch = texture("Ghost Render Core Raster Readback Copy",
            wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST);
        let accum_view = accum.create_view(&Default::default());
        let scratch_view = scratch.create_view(&Default::default());
        let bind = |view: &wgpu::TextureView| device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Ghost Render Core Raster Input"),
            layout: &self.input_layout,
            entries: &[wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(view) }],
        });
        let scratch_bind = bind(&scratch_view);
        let accum_bind = bind(&accum_view);
        self.targets = Some(RasterTargets { width, height, accum, accum_view, scratch, scratch_bind, accum_bind });
    }

    /// Plan this frame from the layers as uploaded (`layers`, cull filled
    /// in). Err names why the frame goes to the legacy compositor.
    pub(crate) fn plan(&mut self, device: &wgpu::Device, layers: &[LayerGpu],
        uniforms: &Uniforms, mips: bool, hdr_sources: bool) -> Result<(), &'static str> {
        self.active = false;
        if !self.ready() {
            return Err("pipelines not ready");
        }
        if mips {
            return Err("source mips");
        }
        if !stage_is_identity(uniforms) {
            return Err("output transform");
        }
        let width = uniforms.resolution[0].max(1.0) as u32;
        let height = uniforms.resolution[1].max(1.0) as u32;
        let count = (uniforms.layer_count.max(0.0) as usize).min(layers.len());
        plan_raster_layers(&layers[..count], uniforms.dlayer[0] > 0.5, hdr_sources, width, height,
            &mut self.draws, &mut self.runs)?;
        self.ensure_targets(device, width, height);
        self.active = true;
        Ok(())
    }

    pub(crate) fn active(&self) -> bool {
        self.active
    }

    /// Draw the planned frame into `view` (the legacy composite's target):
    /// the layers into the accumulation target, then its finish.
    pub(crate) fn draw(&self, encoder: &mut wgpu::CommandEncoder, scene: &wgpu::BindGroup,
        source_frames: &wgpu::BindGroup, view: &wgpu::TextureView, label: &'static str,
        timestamp_writes: Option<wgpu::RenderPassTimestampWrites<'_>>) {
        let (Some(pipelines), Some(targets)) = (self.pipelines.get(), self.targets.as_ref()) else { return };
        let (mut first_writes, last_writes) = match timestamp_writes {
            Some(writes) => (
                Some(wgpu::RenderPassTimestampWrites { query_set: writes.query_set,
                    beginning_of_pass_write_index: writes.beginning_of_pass_write_index, end_of_pass_write_index: None }),
                Some(wgpu::RenderPassTimestampWrites { query_set: writes.query_set,
                    beginning_of_pass_write_index: None, end_of_pass_write_index: writes.end_of_pass_write_index }),
            ),
            None => (None, None),
        };
        let layer_pass = |encoder: &mut wgpu::CommandEncoder, load: wgpu::LoadOp<wgpu::Color>,
            timestamp_writes: Option<wgpu::RenderPassTimestampWrites<'_>>| {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some(label),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &targets.accum_view,
                    resolve_target: None,
                    ops: wgpu::Operations { load, store: wgpu::StoreOp::Store },
                    depth_slice: None,
                })],
                depth_stencil_attachment: None,
                timestamp_writes,
                occlusion_query_set: None,
                multiview_mask: None,
            }).forget_lifetime();
            pass.set_bind_group(0, scene, &[]);
            pass.set_bind_group(1, source_frames, &[]);
            pass.set_bind_group(2, &targets.scratch_bind, &[]);
            pass
        };
        let mut pass = Some(layer_pass(encoder, wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT), first_writes.take()));
        for run in &self.runs {
            let draws = &self.draws[run.first..run.first + run.count];
            if run.blend == RasterBlend::Readback {
                drop(pass.take());
                let [x0, y0, x1, y1] = draws[0].pixels;
                let origin = wgpu::Origin3d { x: x0, y: y0, z: 0 };
                encoder.copy_texture_to_texture(
                    wgpu::TexelCopyTextureInfo { texture: &targets.accum, mip_level: 0, origin, aspect: wgpu::TextureAspect::All },
                    wgpu::TexelCopyTextureInfo { texture: &targets.scratch, mip_level: 0, origin, aspect: wgpu::TextureAspect::All },
                    wgpu::Extent3d { width: x1 - x0, height: y1 - y0, depth_or_array_layers: 1 },
                );
                pass = Some(layer_pass(encoder, wgpu::LoadOp::Load, None));
            }
            let pipeline = match run.blend {
                RasterBlend::Normal => &pipelines.normal,
                RasterBlend::Screen => &pipelines.screen,
                RasterBlend::Multiply => &pipelines.multiply,
                RasterBlend::Readback => &pipelines.readback,
            };
            let pass = pass.as_mut().expect("layer pass");
            pass.set_pipeline(pipeline);
            for draw in draws {
                let [x0, y0, x1, y1] = draw.pixels;
                pass.set_scissor_rect(x0, y0, x1 - x0, y1 - y0);
                pass.draw(0..3, draw.layer..draw.layer + 1);
            }
        }
        drop(pass);
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some(label),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view,
                resolve_target: None,
                ops: wgpu::Operations { load: wgpu::LoadOp::Clear(wgpu::Color::BLACK), store: wgpu::StoreOp::Store },
                depth_slice: None,
            })],
            depth_stencil_attachment: None,
            timestamp_writes: last_writes,
            occlusion_query_set: None,
            multiview_mask: None,
        });
        pass.set_pipeline(&pipelines.resolve);
        pass.set_bind_group(0, scene, &[]);
        pass.set_bind_group(1, source_frames, &[]);
        pass.set_bind_group(2, &targets.accum_bind, &[]);
        pass.draw(0..3, 0..1);
    }
}

/// The program composite's output stage maps each pixel to the same canvas
/// point (no crop, rotation, warp, calibration or dome), which the layer
/// draws assume.
pub(crate) fn stage_is_identity(u: &Uniforms) -> bool {
    u.out0 == [0.0, 0.0, 1.0, 1.0]
        && (u.out1[0] + 0.5).floor() as i32 == 0
        && (u.swarp[0] + 0.5).floor() as i32 == 0
        && u.mwarp[0] < 0.5
        && u.dome0[0] <= 0.5
        && u.projector_calibration[2][3] < 0.5
}

/// Fill `draws` and `runs` for `layers` (bottom to top) on a
/// `width` x `height` canvas. Err names what the raster path does not draw.
/// `hdr_sources`: pictures may hold colour past 1.0.
pub(crate) fn plan_raster_layers(layers: &[LayerGpu], dome_layers_apart: bool, hdr_sources: bool, width: u32, height: u32,
    draws: &mut Vec<RasterDraw>, runs: &mut Vec<RasterRun>) -> Result<(), &'static str> {
    draws.clear();
    runs.clear();
    let mut multiply = false;
    let mut screen = false;
    // A read-back mode other than Add, which can take the stack past 1.5
    // when it blends colour past 1.0.
    let mut unbounded = false;
    let mut bright = hdr_sources;
    let mut readbacks = 0usize;
    let (w, h) = (width as f32, height as f32);
    // fs_main reads pixels within this much of the canvas edge at the edge
    // (its `border`): a layer reaching it reaches those pixels too.
    let border = 1.6 / w.min(h).max(64.0);
    for (index, layer) in layers.iter().enumerate() {
        let cull = layer.cull;
        if !(cull[0] <= cull[2] && cull[1] <= cull[3]) {
            continue; // hidden or transparent: fs_main skips it
        }
        let mode = (layer.style[0] + 0.5).floor() as i32;
        if (25.5..26.5).contains(&layer.style[0]) {
            return Err("hierarchy mask");
        }
        if layer.edge_info[1] > 0.5 && layer.edge_info[0] > 2.5 {
            return Err("edge effects");
        }
        let plain_rect = layer.fast_flags[0] != 0;
        let card = layer.edge_extra[2] > 0.5 && layer.meta[3] <= 0.5;
        if !plain_rect && !card && layer.meta[3] <= 0.5 && layer.meta[2] >= 9.0 {
            return Err("generated content");
        }
        if layer.fast_flags[2] == 1 && dome_layers_apart {
            continue; // drawn by the dome pass
        }
        // Colour past 1.0 only comes from these (and HDR pictures). Without
        // it every blend keeps the stack inside 0..1, where the hardware
        // blends are exact; see the end of this function for with it.
        bright |= [layer.effect0, layer.effect1, layer.effect2, layer.effect3].iter().any(|effect| effect[0] != 0.0)
            || layer.tint[..3].iter().any(|value| *value > 1.0)
            || layer.color[..3].iter().any(|value| *value > 1.0);
        let blend = match mode {
            0 => RasterBlend::Normal,
            3 => {
                screen = true;
                RasterBlend::Screen
            }
            2 => {
                multiply = true;
                RasterBlend::Multiply
            }
            _ => {
                readbacks += 1;
                unbounded |= mode != 1;
                RasterBlend::Readback
            }
        };
        // Pixel rectangle (y down) of the cull rectangle, a pixel wider all
        // round, stretched to the canvas edge where the layer reaches the
        // border fs_main clamps to.
        let mut u0 = cull[0];
        let mut u1 = cull[2];
        let mut v0 = cull[1];
        let mut v1 = cull[3];
        if u0 <= border * 2.0 { u0 = 0.0; }
        if v0 <= border * 2.0 { v0 = 0.0; }
        if u1 >= 1.0 - border * 2.0 { u1 = 1.0; }
        if v1 >= 1.0 - border * 2.0 { v1 = 1.0; }
        let px = |value: f32, size: f32, round: fn(f32) -> f32| -> u32 {
            if !value.is_finite() { return if value > 0.0 { size as u32 } else { 0 }; }
            round(value * size).clamp(0.0, size) as u32
        };
        let x0 = px(u0 - 1.0 / w, w, f32::floor);
        let x1 = px(u1 + 1.0 / w, w, f32::ceil);
        let y0 = px(1.0 - v1 - 1.0 / h, h, f32::floor);
        let y1 = px(1.0 - v0 + 1.0 / h, h, f32::ceil);
        if x0 >= x1 || y0 >= y1 {
            continue;
        }
        draws.push(RasterDraw { layer: index as u32, pixels: [x0, y0, x1, y1] });
        match runs.last_mut() {
            Some(run) if run.blend == blend && blend != RasterBlend::Readback => run.count += 1,
            _ => runs.push(RasterRun { blend, first: draws.len() - 1, count: 1 }),
        }
    }
    // With colour past 1.0 the shader's Screen and Multiply clamp the stack
    // below to 1.5 first, the hardware blends do not. Normal, Screen and Add
    // keep the stack under 1.5 (a mix of it and at most 1.5); Multiply and
    // the other modes can take it past.
    if bright && (multiply || (screen && unbounded)) {
        return Err("screen or multiply over colour past 1.0");
    }
    if readbacks > RASTER_MAX_READBACK_BLENDS {
        return Err("too many read-back blends");
    }
    Ok(())
}

impl RenderState {
    /// Plan the raster compositor for the program composite just uploaded
    /// (`write_frame_inputs`).
    pub(crate) fn plan_raster_frame(&mut self, filled: usize, uniforms: &Uniforms) {
        let mips = self.program_wants_mips && self.mips_pipeline.get().is_some();
        let hdr_sources = self.source_frame_format == SOURCE_FRAME_FORMAT_HDR;
        let Some(raster) = self.raster.as_mut() else { return };
        match raster.plan(&self.device, &self.layer_upload_scratch[..filled], uniforms, mips, hdr_sources) {
            Ok(()) => raster.frames += 1,
            Err(reason) => {
                raster.fallback_frames += 1;
                raster.last_fallback = reason;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn quad(x0: f32, y0: f32, x1: f32, y1: f32, mode: f32) -> LayerGpu {
        let mut layer = LayerGpu::zeroed();
        layer.meta[0] = 1.0;
        layer.color = [1.0, 1.0, 1.0, 1.0];
        layer.style[0] = mode;
        layer.p0 = [x0, y1, x1, y1];
        layer.p1 = [x1, y0, x0, y0];
        layer.cull = layer_cull_bounds(&layer);
        layer
    }

    #[test]
    fn raster_wgsl_validates_for_both_slot_stores() {
        for mode in [SourceFrameMode::Shared, SourceFrameMode::PerSource] {
            let source = raster_wgsl(mode, 64);
            let module = naga::front::wgsl::parse_str(&source)
                .unwrap_or_else(|error| panic!("raster {mode:?} parse: {}", error.emit_to_string(&source)));
            let capabilities = match mode {
                SourceFrameMode::Shared => naga::valid::Capabilities::empty(),
                SourceFrameMode::PerSource => naga::valid::Capabilities::TEXTURE_AND_SAMPLER_BINDING_ARRAY
                    | naga::valid::Capabilities::TEXTURE_AND_SAMPLER_BINDING_ARRAY_NON_UNIFORM_INDEXING,
            };
            naga::valid::Validator::new(naga::valid::ValidationFlags::all(), capabilities)
                .validate(&module)
                .unwrap_or_else(|error| panic!("raster {mode:?} validation: {error:?}"));
        }
    }

    #[test]
    fn raster_plan_batches_hardware_blends_and_splits_readbacks() {
        let layers = [
            quad(0.0, 0.0, 0.5, 0.5, 0.0),
            quad(0.25, 0.25, 0.75, 0.75, 0.0),
            quad(0.5, 0.5, 1.0, 1.0, 3.0),
            quad(0.1, 0.1, 0.2, 0.2, 1.0),
            quad(0.1, 0.1, 0.2, 0.2, 1.0),
            quad(0.0, 0.0, 1.0, 1.0, 2.0),
        ];
        let (mut draws, mut runs) = (Vec::new(), Vec::new());
        plan_raster_layers(&layers, false, false, 200, 100, &mut draws, &mut runs).unwrap();
        assert_eq!(draws.len(), 6);
        let blends: Vec<_> = runs.iter().map(|run| (run.blend, run.first, run.count)).collect();
        assert_eq!(blends, vec![
            (RasterBlend::Normal, 0, 2), (RasterBlend::Screen, 2, 1),
            (RasterBlend::Readback, 3, 1), (RasterBlend::Readback, 4, 1), (RasterBlend::Multiply, 5, 1),
        ]);
        // The read-back copies the layer's pixels (y down), a pixel wider.
        let [x0, y0, x1, y1] = draws[3].pixels;
        assert!(x0 <= 20 && x1 >= 40 && y0 <= 80 && y1 >= 90 && x1 <= 42 && y0 >= 78, "{:?}", draws[3].pixels);
        // A layer reaching the canvas edge covers the edge pixels.
        assert_eq!(draws[5].pixels, [0, 0, 200, 100]);
    }

    #[test]
    fn raster_plan_falls_back_for_what_it_does_not_draw() {
        let (mut draws, mut runs) = (Vec::new(), Vec::new());
        let mut plan = |layers: &[LayerGpu]| plan_raster_layers(layers, false, false, 64, 64, &mut draws, &mut runs);
        assert_eq!(plan(&[quad(0.0, 0.0, 1.0, 1.0, 26.0)]), Err("hierarchy mask"));
        let mut edged = quad(0.0, 0.0, 1.0, 1.0, 0.0);
        edged.edge_info = [3.0, 1.0, 0.0, 0.0];
        edged.cull = layer_cull_bounds(&edged);
        assert_eq!(plan(&[edged]), Err("edge effects"));
        let mut bright = quad(0.0, 0.0, 1.0, 1.0, 0.0);
        bright.effect0 = [3.0, 2.0, 0.0, 1.0];
        let past = Err("screen or multiply over colour past 1.0");
        assert_eq!(plan(&[bright, quad(0.0, 0.0, 1.0, 1.0, 2.0)]), past);
        assert_eq!(plan(&[bright, quad(0.0, 0.0, 1.0, 1.0, 3.0), quad(0.0, 0.0, 1.0, 1.0, 1.0)]), Ok(()));
        assert_eq!(plan(&[bright, quad(0.0, 0.0, 1.0, 1.0, 11.0), quad(0.0, 0.0, 1.0, 1.0, 3.0)]), past);
        assert_eq!(plan(&[bright, quad(0.0, 0.0, 1.0, 1.0, 11.0)]), Ok(()));
        let mut hdr = |layers: &[LayerGpu]| plan_raster_layers(layers, false, true, 64, 64, &mut Vec::new(), &mut Vec::new());
        assert_eq!(hdr(&[quad(0.0, 0.0, 1.0, 1.0, 2.0)]), past);
        let many: Vec<_> = (0..=RASTER_MAX_READBACK_BLENDS).map(|_| quad(0.0, 0.0, 1.0, 1.0, 6.0)).collect();
        assert_eq!(plan(&many), Err("too many read-back blends"));
        // Hidden layers are left out, not a reason to fall back.
        let mut hidden = quad(0.0, 0.0, 1.0, 1.0, 26.0);
        hidden.meta[0] = 0.0;
        hidden.cull = layer_cull_bounds(&hidden);
        assert_eq!(plan(&[hidden]), Ok(()));
        assert!(draws.is_empty());
    }

    #[test]
    fn identity_stage_is_the_default_one() {
        let mut uniforms = Uniforms::zeroed();
        let stage = OutputStage::default();
        uniforms.out0 = stage.out0;
        uniforms.out1 = stage.out1;
        uniforms.swarp = stage.swarp;
        uniforms.mwarp = stage.mwarp;
        uniforms.dome0 = stage.dome0;
        uniforms.projector_calibration = stage.projector_calibration;
        assert!(stage_is_identity(&uniforms));
        uniforms.out1[0] = 1.0;
        assert!(!stage_is_identity(&uniforms));
    }
}
