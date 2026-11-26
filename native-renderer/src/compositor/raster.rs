//! Rasterised layers: the program composite drawn as one draw per layer
//! instead of one fullscreen pass that loops over the layers per pixel.
//! Opt-in with GA_CORE_COMPOSITOR=raster (see raster.wgsl for the shaders).
//!
//! Each frame `plan_raster_frame` decides whether the frame can be drawn
//! this way. One that cannot (generated content, an output transform, too
//! many read-back passes) is drawn whole by the legacy compositor; a frame
//! is never part one, part the other.
//!
//! The layers blend into a float accumulation target that holds what the
//! legacy shader keeps in registers, so the result is the same: Normal,
//! Screen and Multiply blend in hardware (equal to the shader's blend up to
//! float rounding, see `RASTER_TOLERANCE_LSB`), hierarchy masks multiply
//! the target by their coverage, other modes read the stack below and blend
//! with the shader's own code. A layer cannot read the target it draws to,
//! so there are two: a pass draws into one and its read-back layers read
//! the other, which holds the stack as the pass began. Layers go in one
//! pass until one would read pixels an earlier draw of the pass changed;
//! the next pass starts with a copy of the stack (`RasterPass`).

use crate::*;

/// Accumulation target format: what the legacy shader keeps in f32 registers.
pub(crate) const RASTER_ACCUM_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba32Float;

/// Layer passes a frame may have at most: each pass after the first copies
/// the whole stack.
pub(crate) const RASTER_MAX_PASSES: usize = 32;

/// A frame whose passes copy more than this many pixels per pixel its
/// layers draw goes to the legacy compositor. Measured at 1080p on Apple
/// silicon, a copy pass costs about half what the legacy compositor spends
/// on a layer over the same pixels, so up to 2 copied pixels per drawn
/// pixel the raster frame is still the cheaper one (16 full-canvas colour
/// layers chained through read-back blends, 15 passes: 10 ms against 21).
const RASTER_COPY_PER_DRAWN_PIXEL: u64 = 2;

/// RASTER_MAX_PASSES, or GA_CORE_RASTER_MAX_PASSES (for measuring).
fn raster_max_passes() -> usize {
    static MAX: std::sync::OnceLock<usize> = std::sync::OnceLock::new();
    *MAX.get_or_init(|| std::env::var("GA_CORE_RASTER_MAX_PASSES").ok()
        .and_then(|value| value.trim().parse().ok()).unwrap_or(RASTER_MAX_PASSES))
}

/// The largest difference from the legacy compositor, in 8-bit steps: the
/// hardware blends compute the shader's blend in a different order
/// (`s a + d (1 - a)` against `d + (s - d) a`), which can round a value that
/// lands on a step boundary to the next step.
#[allow(dead_code)]
pub(crate) const RASTER_TOLERANCE_LSB: u8 = 1;

/// Added to a read-back draw's instance (its layer index) when the stack
/// below it is still empty: the first pass has no copy to read.
const RASTER_BELOW_CLEAR: u32 = 1 << 16;

/// GA_CORE_COMPOSITOR=raster.
pub(crate) fn raster_compositor_requested() -> bool {
    static ON: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *ON.get_or_init(|| std::env::var("GA_CORE_COMPOSITOR").is_ok_and(|value| value.trim().eq_ignore_ascii_case("raster")))
}

/// The raster compositor shader: heartbeat.wgsl without generated content
/// (RASTER_LEAN), plus raster.wgsl; `source_mips` for minified pictures.
pub(crate) fn raster_wgsl(mode: SourceFrameMode, bindings: usize, source_mips: bool) -> String {
    let mut source = heartbeat_wgsl_with(mode, bindings, source_mips, true);
    source.push_str(include_str!("raster.wgsl"));
    source
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum RasterBlend {
    Normal,
    Screen,
    Multiply,
    /// Read the stack below (any mode).
    Readback,
    /// A hierarchy mask: multiply the stack by its coverage.
    Mask,
}

/// The pipeline a draw uses.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct RasterPipe {
    pub(crate) blend: RasterBlend,
    /// The layer has Edge Effects (their own entry points).
    pub(crate) edges: bool,
    /// The layer reads its picture's mips (the build with source mips).
    pub(crate) mips: bool,
}

/// One layer draw: the layer, the pixel rectangle (x0, y0, x1, y1, y down)
/// its scissor cuts the fullscreen triangle to and its pipeline.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct RasterDraw {
    pub(crate) layer: u32,
    pub(crate) pixels: [u32; 4],
    pub(crate) pipe: RasterPipe,
}

/// A run of draws in one render pass. The first pass starts on a cleared
/// target; each later one on the other target, with a copy of the stack.
/// No read-back draw of a pass touches pixels an earlier draw of it did.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct RasterPass {
    pub(crate) first: usize,
    pub(crate) count: usize,
}

/// Layer pipelines of one shader build, by blend (Normal, Screen,
/// Multiply, Readback), without and with Edge Effects.
struct RasterLayerPipelines {
    plain: [wgpu::RenderPipeline; 4],
    edges: [wgpu::RenderPipeline; 4],
}

impl RasterLayerPipelines {
    fn get(&self, blend: RasterBlend, edges: bool) -> &wgpu::RenderPipeline {
        let set = if edges { &self.edges } else { &self.plain };
        match blend {
            RasterBlend::Normal => &set[0],
            RasterBlend::Screen => &set[1],
            RasterBlend::Multiply => &set[2],
            RasterBlend::Readback | RasterBlend::Mask => &set[3],
        }
    }
}

pub(crate) struct RasterPipelines {
    layers: RasterLayerPipelines,
    mask: wgpu::RenderPipeline,
    copy: wgpu::RenderPipeline,
    resolve: wgpu::RenderPipeline,
}

struct RasterTargets {
    width: u32,
    height: u32,
    views: [wgpu::TextureView; 2],
    /// group 2 over each target.
    binds: [wgpu::BindGroup; 2],
}

pub(crate) struct RasterCompositor {
    pipelines: Arc<std::sync::OnceLock<RasterPipelines>>,
    /// The layer pipelines of the build with source mips (made after the
    /// others, only with source mips on).
    mips_pipelines: Arc<std::sync::OnceLock<RasterLayerPipelines>>,
    input_layout: wgpu::BindGroupLayout,
    targets: Option<RasterTargets>,
    draws: Vec<RasterDraw>,
    passes: Vec<RasterPass>,
    /// This frame's plan is drawable (set by `plan_raster_frame`).
    active: bool,
    pub(crate) frames: u64,
    pub(crate) fallback_frames: u64,
    pub(crate) last_fallback: &'static str,
    /// Layer passes of the last frame drawn.
    pub(crate) last_passes: usize,
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
        RasterBlend::Mask => wgpu::BlendState { color: color(F::Zero, F::Src), alpha: color(F::Zero, F::SrcAlpha) },
    }
}

fn raster_pipeline(device: &wgpu::Device, layout: &wgpu::PipelineLayout, shader: &wgpu::ShaderModule, entry: &str,
    format: wgpu::TextureFormat, blend: wgpu::BlendState, label: &str) -> wgpu::RenderPipeline {
    device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: Some(label),
        layout: Some(layout),
        vertex: wgpu::VertexState {
            module: shader,
            entry_point: Some("vs_main"),
            compilation_options: wgpu::PipelineCompilationOptions::default(),
            buffers: &[],
        },
        primitive: wgpu::PrimitiveState::default(),
        depth_stencil: None,
        multisample: wgpu::MultisampleState::default(),
        fragment: Some(wgpu::FragmentState {
            module: shader,
            entry_point: Some(entry),
            compilation_options: wgpu::PipelineCompilationOptions::default(),
            targets: &[Some(wgpu::ColorTargetState { format, blend: Some(blend), write_mask: wgpu::ColorWrites::ALL })],
        }),
        multiview_mask: None,
        cache: pipeline_cache::for_device(device).as_ref(),
    })
}

fn raster_layer_pipelines(device: &wgpu::Device, layout: &wgpu::PipelineLayout, shader: &wgpu::ShaderModule,
    build: &str) -> RasterLayerPipelines {
    let blends = [RasterBlend::Normal, RasterBlend::Screen, RasterBlend::Multiply, RasterBlend::Readback];
    let make = |edges: bool| blends.map(|blend| {
        let entry = match (blend == RasterBlend::Readback, edges) {
            (false, false) => "fs_raster",
            (false, true) => "fs_raster_edges",
            (true, false) => "fs_raster_dst",
            (true, true) => "fs_raster_dst_edges",
        };
        let label = format!("Ghost Render Core Raster {blend:?}{} ({build})", if edges { " Edge Effects" } else { "" });
        raster_pipeline(device, layout, shader, entry, RASTER_ACCUM_FORMAT, layer_blend_state(blend), &label)
    });
    RasterLayerPipelines { plain: make(false), edges: make(true) }
}

impl RasterCompositor {
    /// Starts building the pipelines on a worker; frames are drawn by the
    /// legacy compositor until they are ready. None when the device cannot
    /// blend float targets.
    pub(crate) fn new(device: &wgpu::Device, scene_layout: &wgpu::BindGroupLayout,
        source_frames_layout: &wgpu::BindGroupLayout, mode: SourceFrameMode, bindings: usize,
        output_format: wgpu::TextureFormat, source_mips: bool) -> Option<Self> {
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
        let mips_pipelines = Arc::new(std::sync::OnceLock::new());
        let (worker_device, slot, mips_slot) = (device.clone(), Arc::clone(&pipelines), Arc::clone(&mips_pipelines));
        let _ = thread::Builder::new().name("ghost-compositor-raster".to_string()).spawn(move || {
            let device = worker_device;
            let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
                label: Some("Ghost Render Core Raster Compositor"),
                source: wgpu::ShaderSource::Wgsl(raster_wgsl(mode, bindings, false).into()),
            });
            let layers = raster_layer_pipelines(&device, &layout, &shader, "lean");
            let mask = raster_pipeline(&device, &layout, &shader, "fs_raster_mask", RASTER_ACCUM_FORMAT,
                layer_blend_state(RasterBlend::Mask), "Ghost Render Core Raster Mask");
            let copy = raster_pipeline(&device, &layout, &shader, "fs_raster_copy", RASTER_ACCUM_FORMAT,
                wgpu::BlendState::REPLACE, "Ghost Render Core Raster Copy");
            let resolve = raster_pipeline(&device, &layout, &shader, "fs_resolve", output_format,
                wgpu::BlendState::REPLACE, "Ghost Render Core Raster Resolve");
            let _ = slot.set(RasterPipelines { layers, mask, copy, resolve });
            if source_mips {
                let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
                    label: Some("Ghost Render Core Raster Compositor (source mips)"),
                    source: wgpu::ShaderSource::Wgsl(raster_wgsl(mode, bindings, true).into()),
                });
                let _ = mips_slot.set(raster_layer_pipelines(&device, &layout, &shader, "source mips"));
            }
        });
        Some(Self {
            pipelines,
            mips_pipelines,
            input_layout,
            targets: None,
            draws: Vec::new(),
            passes: Vec::new(),
            active: false,
            frames: 0,
            fallback_frames: 0,
            last_fallback: "",
            last_passes: 0,
        })
    }

    pub(crate) fn ready(&self) -> bool {
        self.pipelines.get().is_some()
    }

    /// Every pipeline it builds is ready, the source mips build included
    /// when source mips are on.
    pub(crate) fn all_ready(&self) -> bool {
        self.ready() && (!source_mips_enabled() || self.mips_pipelines.get().is_some())
    }

    fn ensure_targets(&mut self, device: &wgpu::Device, width: u32, height: u32) {
        if self.targets.as_ref().is_some_and(|targets| targets.width == width && targets.height == height) {
            return;
        }
        let view = |label: &str| device.create_texture(&wgpu::TextureDescriptor {
            label: Some(label),
            size: wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: RASTER_ACCUM_FORMAT,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        }).create_view(&Default::default());
        let views = [view("Ghost Render Core Raster Accumulation A"), view("Ghost Render Core Raster Accumulation B")];
        let bind = |view: &wgpu::TextureView| device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Ghost Render Core Raster Input"),
            layout: &self.input_layout,
            entries: &[wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(view) }],
        });
        let binds = [bind(&views[0]), bind(&views[1])];
        self.targets = Some(RasterTargets { width, height, views, binds });
    }

    /// Plan this frame from the layers as uploaded (`layers`, cull filled
    /// in). `mips`: the frame draws minified pictures from their mips. Err
    /// names why the frame goes to the legacy compositor.
    pub(crate) fn plan(&mut self, device: &wgpu::Device, layers: &[LayerGpu],
        uniforms: &Uniforms, mips: bool, hdr_sources: bool) -> Result<(), &'static str> {
        self.active = false;
        if !self.ready() {
            return Err("pipelines not ready");
        }
        if mips && self.mips_pipelines.get().is_none() {
            return Err("source mips");
        }
        if !stage_is_identity(uniforms) {
            return Err("output transform");
        }
        let width = uniforms.resolution[0].max(1.0) as u32;
        let height = uniforms.resolution[1].max(1.0) as u32;
        let count = (uniforms.layer_count.max(0.0) as usize).min(layers.len());
        plan_raster_layers(&layers[..count], uniforms.dlayer[0] > 0.5, hdr_sources, mips, width, height,
            &mut self.draws, &mut self.passes)?;
        self.ensure_targets(device, width, height);
        self.active = true;
        Ok(())
    }

    pub(crate) fn active(&self) -> bool {
        self.active
    }

    /// Draw the planned frame into `view` (the legacy composite's target):
    /// the layers into the accumulation targets, then their finish.
    pub(crate) fn draw(&self, encoder: &mut wgpu::CommandEncoder, scene: &wgpu::BindGroup,
        source_frames: &wgpu::BindGroup, view: &wgpu::TextureView, label: &'static str,
        timestamp_writes: Option<wgpu::RenderPassTimestampWrites<'_>>) {
        let (Some(pipelines), Some(targets)) = (self.pipelines.get(), self.targets.as_ref()) else { return };
        let mips_pipelines = self.mips_pipelines.get();
        let (mut first_writes, last_writes) = match timestamp_writes {
            Some(writes) => (
                Some(wgpu::RenderPassTimestampWrites { query_set: writes.query_set,
                    beginning_of_pass_write_index: writes.beginning_of_pass_write_index, end_of_pass_write_index: None }),
                Some(wgpu::RenderPassTimestampWrites { query_set: writes.query_set,
                    beginning_of_pass_write_index: None, end_of_pass_write_index: writes.end_of_pass_write_index }),
            ),
            None => (None, None),
        };
        for (index, layer_pass) in self.passes.iter().enumerate() {
            // Pass `index` draws into target index % 2 and reads the other.
            let (target, input) = (index % 2, (index + 1) % 2);
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some(label),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &targets.views[target],
                    resolve_target: None,
                    ops: wgpu::Operations { load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT), store: wgpu::StoreOp::Store },
                    depth_slice: None,
                })],
                depth_stencil_attachment: None,
                timestamp_writes: first_writes.take(),
                occlusion_query_set: None,
                multiview_mask: None,
            });
            pass.set_bind_group(0, scene, &[]);
            pass.set_bind_group(1, source_frames, &[]);
            pass.set_bind_group(2, &targets.binds[input], &[]);
            if index > 0 {
                pass.set_pipeline(&pipelines.copy);
                pass.draw(0..3, 0..1);
            }
            let mut bound: Option<RasterPipe> = None;
            for draw in &self.draws[layer_pass.first..layer_pass.first + layer_pass.count] {
                if bound != Some(draw.pipe) {
                    let pipeline = match draw.pipe.blend {
                        RasterBlend::Mask => &pipelines.mask,
                        blend => match (draw.pipe.mips, mips_pipelines) {
                            (true, Some(mips)) => mips.get(blend, draw.pipe.edges),
                            _ => pipelines.layers.get(blend, draw.pipe.edges),
                        },
                    };
                    pass.set_pipeline(pipeline);
                    bound = Some(draw.pipe);
                }
                let [x0, y0, x1, y1] = draw.pixels;
                pass.set_scissor_rect(x0, y0, x1 - x0, y1 - y0);
                let instance = if index == 0 && draw.pipe.blend == RasterBlend::Readback {
                    draw.layer + RASTER_BELOW_CLEAR
                } else {
                    draw.layer
                };
                pass.draw(0..3, instance..instance + 1);
            }
        }
        let last = (self.passes.len().max(1) - 1) % 2;
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
        pass.set_bind_group(2, &targets.binds[last], &[]);
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

fn rects_overlap(a: [u32; 4], b: [u32; 4]) -> bool {
    a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]
}

/// Fill `draws` and `passes` for `layers` (bottom to top) on a
/// `width` x `height` canvas. Err names what the raster path does not draw.
/// `hdr_sources`: pictures may hold colour past 1.0. `mips`: minified
/// pictures read their mips.
pub(crate) fn plan_raster_layers(layers: &[LayerGpu], dome_layers_apart: bool, hdr_sources: bool, mips: bool,
    width: u32, height: u32, draws: &mut Vec<RasterDraw>, passes: &mut Vec<RasterPass>) -> Result<(), &'static str> {
    draws.clear();
    passes.clear();
    passes.push(RasterPass { first: 0, count: 0 });
    let mut multiply = false;
    let mut screen = false;
    // A read-back mode other than Add, which can take the stack past 1.5
    // when it blends colour past 1.0.
    let mut unbounded = false;
    let mut bright = hdr_sources;
    // What the current pass has drawn so far: its bounding box, and each
    // draw's rectangle. A read-back draw reads the stack as the pass began,
    // so one over any of these starts the next pass.
    let mut pass_box: Option<[u32; 4]> = None;
    let mut pass_rects: Vec<[u32; 4]> = Vec::new();
    let (w, h) = (width as f32, height as f32);
    // fs_main reads pixels within this much of the canvas edge at the edge
    // (its `border`): a layer reaching it reaches those pixels too.
    let border = 1.6 / w.min(h).max(64.0);
    for (index, layer) in layers.iter().enumerate() {
        let cull = layer.cull;
        if !(cull[0] <= cull[2] && cull[1] <= cull[3]) {
            continue; // hidden or transparent: fs_main skips it
        }
        if layer.fast_flags[2] == 1 && dome_layers_apart {
            continue; // drawn by the dome pass
        }
        let mode = (layer.style[0] + 0.5).floor() as i32;
        let mask = (25.5..26.5).contains(&layer.style[0]);
        if mask && !(layer.mask_info[0] > 0.5 && layer.mask_info[3] >= 2.5) {
            continue; // a mask without a shape: fs_main leaves the stack be
        }
        let edges = !mask && layer.edge_info[1] > 0.5 && layer.edge_info[0] > 2.5;
        let plain_rect = layer.fast_flags[0] != 0;
        let card = layer.edge_extra[2] > 0.5 && layer.meta[3] <= 0.5;
        if !mask && !plain_rect && !card && layer.meta[3] <= 0.5 && layer.meta[2] >= 9.0 {
            return Err("generated content");
        }
        // Colour past 1.0 only comes from these (and HDR pictures). Without
        // it every blend keeps the stack inside 0..1, where the hardware
        // blends are exact; see the end of this function for with it. The
        // edge stack adds none: its effects' colours are clamped to 0..1
        // and every blend mode keeps 0..1 inside 0..1.
        bright |= [layer.effect0, layer.effect1, layer.effect2, layer.effect3].iter().any(|effect| effect[0] != 0.0)
            || layer.tint[..3].iter().any(|value| *value > 1.0)
            || layer.color[..3].iter().any(|value| *value > 1.0);
        let blend = match mode {
            _ if mask => RasterBlend::Mask,
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
        let rect = [x0, y0, x1, y1];
        if blend == RasterBlend::Readback && pass_box.is_some_and(|bounds| rects_overlap(bounds, rect))
            && pass_rects.iter().any(|drawn| rects_overlap(*drawn, rect)) {
            passes.push(RasterPass { first: draws.len(), count: 0 });
            pass_box = None;
            pass_rects.clear();
        }
        pass_box = Some(match pass_box {
            Some(b) => [b[0].min(x0), b[1].min(y0), b[2].max(x1), b[3].max(y1)],
            None => rect,
        });
        pass_rects.push(rect);
        let pipe = RasterPipe { blend, edges, mips: mips && !mask && layer.fast_flags[3] & 4 != 0 };
        draws.push(RasterDraw { layer: index as u32, pixels: rect, pipe });
        passes.last_mut().expect("a pass").count += 1;
    }
    // With colour past 1.0 the shader's Screen and Multiply clamp the stack
    // below to 1.5 first, the hardware blends do not. Normal, Screen and Add
    // keep the stack under 1.5 (a mix of it and at most 1.5), and a mask
    // only scales it down; Multiply and the other modes can take it past.
    if bright && (multiply || (screen && unbounded)) {
        return Err("screen or multiply over colour past 1.0");
    }
    if passes.len() > raster_max_passes() {
        return Err("too many read-back passes");
    }
    let drawn: u64 = draws.iter().map(|draw| {
        let [x0, y0, x1, y1] = draw.pixels;
        u64::from(x1 - x0) * u64::from(y1 - y0)
    }).sum();
    let copied = (passes.len() as u64 - 1) * u64::from(width) * u64::from(height);
    if copied > drawn * RASTER_COPY_PER_DRAWN_PIXEL {
        return Err("read-back passes copy more than the layers draw");
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
            Ok(()) => {
                raster.frames += 1;
                raster.last_passes = raster.passes.len();
            }
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

    fn mask(x0: f32, y0: f32, x1: f32, y1: f32) -> LayerGpu {
        let mut layer = quad(x0, y0, x1, y1, 26.0);
        layer.color[3] = 0.0;
        layer.mask_info = [1.0, 0.0, 0.0, 4.0];
        layer.cull = layer_cull_bounds(&layer);
        layer
    }

    fn plan(layers: &[LayerGpu]) -> (Result<(), &'static str>, Vec<RasterDraw>, Vec<RasterPass>) {
        let (mut draws, mut passes) = (Vec::new(), Vec::new());
        let result = plan_raster_layers(layers, false, false, false, 200, 100, &mut draws, &mut passes);
        (result, draws, passes)
    }

    #[test]
    fn raster_wgsl_validates_for_both_slot_stores() {
        for mode in [SourceFrameMode::Shared, SourceFrameMode::PerSource] {
            for mips in [false, true] {
                let source = raster_wgsl(mode, 64, mips);
                let module = naga::front::wgsl::parse_str(&source)
                    .unwrap_or_else(|error| panic!("raster {mode:?} parse: {}", error.emit_to_string(&source)));
                let capabilities = match mode {
                    SourceFrameMode::Shared => naga::valid::Capabilities::empty(),
                    SourceFrameMode::PerSource => naga::valid::Capabilities::TEXTURE_AND_SAMPLER_BINDING_ARRAY
                        | naga::valid::Capabilities::TEXTURE_AND_SAMPLER_BINDING_ARRAY_NON_UNIFORM_INDEXING,
                };
                naga::valid::Validator::new(naga::valid::ValidationFlags::all(), capabilities)
                    .validate(&module)
                    .unwrap_or_else(|error| panic!("raster {mode:?} mips {mips} validation: {error:?}"));
            }
        }
    }

    #[test]
    fn raster_plan_keeps_read_backs_in_a_pass_until_one_overlaps_what_it_drew() {
        let (result, draws, passes) = plan(&[
            quad(0.0, 0.0, 0.5, 0.5, 0.0),
            quad(0.25, 0.25, 0.75, 0.75, 0.0),
            quad(0.5, 0.5, 1.0, 1.0, 3.0),
            // Clear of everything so far: reads the empty stack in pass 0.
            quad(0.8, 0.05, 0.9, 0.2, 1.0),
            // Over the layer above: the next pass.
            quad(0.8, 0.05, 0.9, 0.2, 1.0),
            quad(0.0, 0.0, 1.0, 1.0, 2.0),
            // Clear of the draw before it in its pass, but not of the Multiply.
            quad(0.1, 0.1, 0.2, 0.2, 6.0),
        ]);
        assert_eq!(result, Ok(()));
        assert_eq!(draws.len(), 7);
        let blends: Vec<_> = draws.iter().map(|draw| draw.pipe.blend).collect();
        assert_eq!(blends, vec![RasterBlend::Normal, RasterBlend::Normal, RasterBlend::Screen, RasterBlend::Readback,
            RasterBlend::Readback, RasterBlend::Multiply, RasterBlend::Readback]);
        assert_eq!(passes, vec![RasterPass { first: 0, count: 4 }, RasterPass { first: 4, count: 2 },
            RasterPass { first: 6, count: 1 }]);
        // The read-back draws the layer's pixels (y down), a pixel wider.
        let [x0, y0, x1, y1] = draws[3].pixels;
        assert!(x0 <= 160 && x1 >= 180 && y0 <= 80 && y1 >= 95 && x1 <= 182 && y0 >= 78, "{:?}", draws[3].pixels);
        // A layer reaching the canvas edge covers the edge pixels.
        assert_eq!(draws[5].pixels, [0, 0, 200, 100]);
    }

    #[test]
    fn raster_plan_draws_masks_and_edge_effects() {
        let mut edged = quad(0.2, 0.2, 0.4, 0.4, 0.0);
        edged.edge_info = [3.0, 1.0, 0.0, 0.0];
        edged.edge_bounds = [0.1, 0.1, 0.5, 0.5];
        edged.cull = layer_cull_bounds(&edged);
        let mut no_shape = mask(0.0, 0.0, 0.5, 0.5);
        no_shape.mask_info[0] = 0.0;
        let (result, draws, passes) = plan(&[quad(0.0, 0.0, 1.0, 1.0, 0.0), mask(0.0, 0.0, 0.5, 0.5), no_shape, edged,
            quad(0.6, 0.6, 0.7, 0.7, 11.0)]);
        assert_eq!(result, Ok(()));
        let pipes: Vec<_> = draws.iter().map(|draw| (draw.layer, draw.pipe.blend, draw.pipe.edges)).collect();
        assert_eq!(pipes, vec![(0, RasterBlend::Normal, false), (1, RasterBlend::Mask, false),
            (3, RasterBlend::Normal, true), (4, RasterBlend::Readback, false)]);
        // A mask reaches every pixel (outside its shape it clears the stack).
        assert_eq!(draws[1].pixels, [0, 0, 200, 100]);
        // Edge Effects reach their bounds, past the quad.
        let [x0, y0, x1, y1] = draws[2].pixels;
        assert!(x0 <= 20 && y0 <= 50 && x1 >= 100 && y1 >= 90, "{:?}", draws[2].pixels);
        // The read-back lies under the mask: a pass of its own.
        assert_eq!(passes.len(), 2);
    }

    #[test]
    fn raster_plan_falls_back_for_what_it_does_not_draw() {
        let mut bright = quad(0.0, 0.0, 1.0, 1.0, 0.0);
        bright.effect0 = [3.0, 2.0, 0.0, 1.0];
        let past = Err("screen or multiply over colour past 1.0");
        assert_eq!(plan(&[bright, quad(0.0, 0.0, 1.0, 1.0, 2.0)]).0, past);
        assert_eq!(plan(&[bright, quad(0.0, 0.0, 1.0, 1.0, 3.0), quad(0.0, 0.0, 1.0, 1.0, 1.0)]).0, Ok(()));
        assert_eq!(plan(&[bright, quad(0.0, 0.0, 1.0, 1.0, 11.0), quad(0.0, 0.0, 1.0, 1.0, 3.0)]).0, past);
        assert_eq!(plan(&[bright, quad(0.0, 0.0, 1.0, 1.0, 11.0)]).0, Ok(()));
        let mut edged = quad(0.0, 0.0, 1.0, 1.0, 0.0);
        edged.edge_info = [3.0, 1.0, 0.0, 0.0];
        edged.cull = layer_cull_bounds(&edged);
        assert_eq!(plan(&[edged, quad(0.0, 0.0, 1.0, 1.0, 2.0)]).0, Ok(()));
        let hdr = plan_raster_layers(&[quad(0.0, 0.0, 1.0, 1.0, 2.0)], false, true, false, 64, 64,
            &mut Vec::new(), &mut Vec::new());
        assert_eq!(hdr, past);
        let mut generated = quad(0.0, 0.0, 1.0, 1.0, 0.0);
        generated.meta[2] = 9.0;
        assert_eq!(plan(&[generated]).0, Err("generated content"));
        let many: Vec<_> = (0..RASTER_MAX_PASSES).map(|_| quad(0.0, 0.0, 1.0, 1.0, 6.0)).collect();
        assert_eq!(plan(&many).0, Ok(()));
        let many: Vec<_> = (0..=RASTER_MAX_PASSES).map(|_| quad(0.0, 0.0, 1.0, 1.0, 6.0)).collect();
        assert_eq!(plan(&many).0, Err("too many read-back passes"));
        // Small read-backs over each other: each pass copies far more than
        // the layers draw.
        let chain: Vec<_> = (0..6).map(|_| quad(0.4, 0.4, 0.5, 0.5, 6.0)).collect();
        assert_eq!(plan(&chain).0, Err("read-back passes copy more than the layers draw"));
        // Read-backs that do not overlap share a pass, however many.
        let side: Vec<_> = (0..20).map(|i| quad(i as f32 * 0.05, 0.4, i as f32 * 0.05 + 0.03, 0.6, 6.0)).collect();
        let (result, _, passes) = plan(&side);
        assert_eq!((result, passes.len()), (Ok(()), 1));
        // Hidden layers are left out, not a reason to fall back.
        let mut hidden = quad(0.0, 0.0, 1.0, 1.0, 26.0);
        hidden.meta[0] = 0.0;
        hidden.cull = layer_cull_bounds(&hidden);
        let (result, draws, _) = plan(&[hidden]);
        assert_eq!(result, Ok(()));
        assert!(draws.is_empty());
    }

    #[test]
    fn raster_plan_reads_mips_only_for_layers_that_want_them() {
        let mut minified = quad(0.0, 0.0, 0.5, 0.5, 0.0);
        minified.fast_flags[3] = 4;
        let (mut draws, mut passes) = (Vec::new(), Vec::new());
        plan_raster_layers(&[minified, quad(0.5, 0.5, 1.0, 1.0, 0.0)], false, false, true, 64, 64, &mut draws, &mut passes)
            .unwrap();
        assert_eq!(draws.iter().map(|draw| draw.pipe.mips).collect::<Vec<_>>(), vec![true, false]);
        plan_raster_layers(&[minified], false, false, false, 64, 64, &mut draws, &mut passes).unwrap();
        assert!(!draws[0].pipe.mips);
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
