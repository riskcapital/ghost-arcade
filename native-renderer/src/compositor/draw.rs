//! Drawing the composite: the heartbeat compositor pipeline, its bind groups,
//! composite targets, composition effects and the frame render.

use crate::*;

/// The compositor shader with the picture-slot readers for this store.
/// The compositor shader for a picture store. `source_mips` builds in the
/// per-pixel mip level of minified pictures (heartbeat.wgsl SOURCE_MIPS);
/// without it that code is compiled out, so frames that need no mips pay
/// nothing for it.
pub(crate) fn heartbeat_wgsl(mode: SourceFrameMode, bindings: usize, source_mips: bool) -> String {
    heartbeat_wgsl_with(mode, bindings, source_mips, false)
}

/// `heartbeat_wgsl`, and with `raster_lean` the build the raster
/// compositor appends its layer passes to: generated content (gpu_proxy),
/// which those frames never draw, compiled out.
pub(crate) fn heartbeat_wgsl_with(mode: SourceFrameMode, bindings: usize, source_mips: bool, raster_lean: bool) -> String {
    let body = include_str!("../heartbeat.wgsl").replace(
        "//#SOURCE_FRAMES",
        &source_frames::compositor_source_frames_wgsl(mode, 1, 0, bindings),
    );
    format!("{}const SOURCE_MIPS: bool = {source_mips};\nconst RASTER_LEAN: bool = {raster_lean};\n{body}",
        source_frames::source_frames_enable(mode))
}

/// The compositor pipeline over `shader`'s fs_main.
pub(crate) fn compositor_pipeline(device: &wgpu::Device, layout: &wgpu::PipelineLayout, shader: &wgpu::ShaderModule,
    format: wgpu::TextureFormat, label: &str) -> wgpu::RenderPipeline {
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
            entry_point: Some("fs_main"),
            compilation_options: wgpu::PipelineCompilationOptions::default(),
            targets: &[Some(wgpu::ColorTargetState {
                format,
                blend: Some(wgpu::BlendState::REPLACE),
                write_mask: wgpu::ColorWrites::ALL,
            })],
        }),
        multiview_mask: None,
        cache: pipeline_cache::for_device(device).as_ref(),
    })
}

pub(crate) fn build_scene_bind_group(
    device: &wgpu::Device,
    layout: &wgpu::BindGroupLayout,
    uniform_buffer: &wgpu::Buffer,
    layer_buffer: &wgpu::Buffer,
    layer_pool_buffer: &wgpu::Buffer,
    source_preview_buffer: &wgpu::Buffer,
    sampler: &wgpu::Sampler,
    paint_mask_view: &wgpu::TextureView,
    layer_tile_buffer: &wgpu::Buffer,
) -> wgpu::BindGroup {
    device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("Ghost Render Core Bind Group"),
        layout,
        entries: &[
            wgpu::BindGroupEntry { binding: 0, resource: uniform_buffer.as_entire_binding() },
            wgpu::BindGroupEntry { binding: 1, resource: layer_buffer.as_entire_binding() },
            wgpu::BindGroupEntry { binding: 2, resource: source_preview_buffer.as_entire_binding() },
            wgpu::BindGroupEntry { binding: 4, resource: wgpu::BindingResource::Sampler(sampler) },
            wgpu::BindGroupEntry { binding: 5, resource: wgpu::BindingResource::TextureView(paint_mask_view) },
            wgpu::BindGroupEntry { binding: 6, resource: layer_tile_buffer.as_entire_binding() },
            wgpu::BindGroupEntry { binding: 7, resource: layer_pool_buffer.as_entire_binding() },
        ],
    })
}

pub(crate) fn texture_format_label(format: wgpu::TextureFormat) -> &'static str {
    match format {
        wgpu::TextureFormat::Rgba16Float => "rgba16float",
        wgpu::TextureFormat::Rgba8Unorm => "rgba8unorm",
        wgpu::TextureFormat::Rgba8UnormSrgb => "rgba8unorm-srgb",
        wgpu::TextureFormat::Bgra8Unorm => "bgra8unorm",
        wgpu::TextureFormat::Bgra8UnormSrgb => "bgra8unorm-srgb",
        _ => "unknown",
    }
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
pub(crate) fn texture_format_bytes_per_texel(format: wgpu::TextureFormat) -> usize {
    match format {
        wgpu::TextureFormat::Rgba16Float => 8,
        wgpu::TextureFormat::Rgba8Unorm | wgpu::TextureFormat::Bgra8Unorm => 4,
        _ => 4,
    }
}

impl RenderState {
    /// Full-resolution ping-pong target for composition FX.
    ///
    /// Deliberately NOT part of the source-frame array: that array is square
    /// and quality-tier sized (1024-3072), so pushing a 1920x1080 composite
    /// through it would resample every pixel on screen the moment a
    /// composition effect was switched on. This matches the swapchain's size
    /// and format instead, so the composite goes in and comes back untouched
    /// apart from the effects themselves.
    pub(crate) fn create_composite_frame_target(
        device: &wgpu::Device,
        width: u32,
        height: u32,
        format: wgpu::TextureFormat,
    ) -> wgpu::Texture {
        device.create_texture(&wgpu::TextureDescriptor {
            label: Some("Ghost Render Core Composite Frame"),
            size: wgpu::Extent3d {
                width: width.max(1),
                height: height.max(1),
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT
                | wgpu::TextureUsages::TEXTURE_BINDING
                | wgpu::TextureUsages::COPY_SRC
                | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        })
    }

    pub(crate) fn create_offscreen_target(
        device: &wgpu::Device,
        width: u32,
        height: u32,
        format: wgpu::TextureFormat,
        label: &'static str,
    ) -> (wgpu::Texture, wgpu::TextureView) {
        let texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some(label),
            size: wgpu::Extent3d {
                width: width.max(1),
                height: height.max(1),
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
        });
        let view = texture.create_view(&wgpu::TextureViewDescriptor {
            label: Some(label),
            ..Default::default()
        });
        (texture, view)
    }

    pub(crate) fn create_depth_target(
        device: &wgpu::Device,
        width: u32,
        height: u32,
        label: &'static str,
    ) -> (wgpu::Texture, wgpu::TextureView) {
        let texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some(label),
            size: wgpu::Extent3d {
                width: width.max(1),
                height: height.max(1),
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: NATIVE_GRAPH_DEPTH_FORMAT,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            view_formats: &[],
        });
        let view = texture.create_view(&wgpu::TextureViewDescriptor {
            label: Some(label),
            ..Default::default()
        });
        (texture, view)
    }

    /// The compositor build to draw with: with source mips when the layers
    /// want them and that build is ready, otherwise the lean one.
    pub(crate) fn compositor_pipeline_for(&self, source_mips: bool) -> &wgpu::RenderPipeline {
        if source_mips {
            if let Some(pipeline) = self.mips_pipeline.get() {
                return pipeline;
            }
        }
        &self.pipeline
    }

    pub(crate) fn draw_fullscreen_to_view(
        &self,
        encoder: &mut wgpu::CommandEncoder,
        view: &wgpu::TextureView,
        label: &'static str,
        timestamp_writes: Option<wgpu::RenderPassTimestampWrites<'_>>,
    ) {
        // The raster compositor, when this frame's plan has it draw.
        if let Some(raster) = self.raster.as_ref().filter(|raster| raster.active()) {
            let pass_time = if timestamp_writes.is_none() { pass_timing::slot(label) } else { None };
            let timestamp_writes = timestamp_writes.or_else(|| pass_timing::render_writes(&pass_time));
            raster.draw(encoder, &self.bind_group, &self.source_frames_bind_group, view, label, timestamp_writes);
            return;
        }
        self.draw_composite(encoder, &self.bind_group, self.program_wants_mips, view, label, timestamp_writes);
    }

    /// Composite view `key` (written by `write_view_inputs`) into `view`.
    pub(crate) fn draw_composite_view(&self, encoder: &mut wgpu::CommandEncoder, key: &str, view: &wgpu::TextureView, label: &'static str) {
        if let Some(composite) = self.composite_views.get(key) {
            let mips = if composite.layers.is_some() { composite.wants_mips } else { self.program_wants_mips };
            self.draw_composite(encoder, &composite.bind_group, mips, view, label, None);
        }
    }

    pub(crate) fn draw_composite(
        &self,
        encoder: &mut wgpu::CommandEncoder,
        bind_group: &wgpu::BindGroup,
        source_mips: bool,
        view: &wgpu::TextureView,
        label: &'static str,
        timestamp_writes: Option<wgpu::RenderPassTimestampWrites<'_>>,
    ) {
        // The frame timer (gpu_timing) owns this pass when it times it.
        let pass_time = if timestamp_writes.is_none() { pass_timing::slot(label) } else { None };
        let timestamp_writes = timestamp_writes.or_else(|| pass_timing::render_writes(&pass_time));
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some(label),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view,
                resolve_target: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                    store: wgpu::StoreOp::Store,
                },
                depth_slice: None,
            })],
            depth_stencil_attachment: None,
            timestamp_writes,
            occlusion_query_set: None,
            multiview_mask: None,
        });
        pass.set_pipeline(self.compositor_pipeline_for(source_mips));
        pass.set_bind_group(0, bind_group, &[]);
        pass.set_bind_group(1, &self.source_frames_bind_group, &[]);
        pass.draw(0..3, 0..1);
    }

    pub(crate) fn encode_composition_effects(&mut self, encoder: &mut wgpu::CommandEncoder,
        jobs: &[NativeGraphFrameJob], output_index: usize) -> Result<(), String> {
        self.render_native_graph_frame_jobs(encoder, jobs)?;
        self.creative_frame_index = if jobs.is_empty() { 0 } else { output_index.min(COMPOSITE_FRAME_SLOTS - 1) };
        Ok(())
    }

    pub(crate) fn render_snapshot(
        &mut self,
        command_phase: f32,
        layers_seen: u32,
        time_seconds: Option<f32>,
        frame_count: u64,
        scene_layers: &[LayerGpu],
        source_previews: Option<&[PreviewPixel]>,
        stage3d_mesh_frame: Option<&Stage3DMeshFrame>,
        stage3d_overlay_items: &[Stage3DOverlayItemGpu],
        audio0: [f32; 4],
        audio1: [f32; 4],
        audio2: [f32; 4],
        frozen: bool,
        output_gate: f32,
        post_effects: &[[f32; 4]],
        composite_graph_jobs: &[NativeGraphFrameJob],
        composite_output_index: usize,
        stage: OutputStage,
        mirror_mesh: Option<Arc<MirrorMesh>>,
    ) -> Result<(), String> {
        if let Some(mesh) = mirror_mesh.as_ref() {
            self.prepare_mirror_mesh(mesh);
        }
        self.refresh_source_frame_bind_groups();
        self.sync_dome_layers(&stage, scene_layers);
        let stage = OutputStage { dlayer: self.dome_layer_pass, ..stage };
        self.allow_async_compile = false;
        self.frame_uniform_cursor = 0;
        self.write_frame_inputs(
            command_phase,
            layers_seen,
            time_seconds,
            frame_count,
            scene_layers,
            source_previews,
            audio0,
            audio1,
            audio2,
            1.0,
            post_effects,
            OutputStage { dlayer: self.dome_layer_pass, ..OutputStage::default() },
        );
        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("Ghost Render Core Snapshot Encoder"),
            });
        let should_record_timing = self
            .gpu_timing
            .as_ref()
            .is_some_and(GpuTimingState::can_record);
        let timestamp_writes = if should_record_timing {
            self.gpu_timing
                .as_ref()
                .map(GpuTimingState::timestamp_writes)
        } else {
            None
        };
        if !frozen && output_gate > 0.0 {
        self.draw_fullscreen_to_view(
            &mut encoder,
            &gpu_object_cache::view(&self.composite_frame_textures[0], &Default::default()),
            "Ghost Render Core Snapshot Pass",
            timestamp_writes,
        );
        self.encode_composition_effects(&mut encoder, composite_graph_jobs, composite_output_index)?;
        let creative_view = gpu_object_cache::view(&self.composite_frame_textures[self.creative_frame_index], &Default::default());
        self.draw_stage3d_mesh_to_view(
            &mut encoder,
            &creative_view,
            "Ghost Render Core Stage3D Mesh Snapshot Pass",
            time_seconds,
            stage3d_mesh_frame,
        );
        self.draw_stage3d_overlay_to_view(
            &mut encoder,
            &creative_view,
            "Ghost Render Core Stage3D Snapshot Overlay Pass",
            time_seconds,
            stage3d_overlay_items,
        );
        self.draw_dome_layers(&mut encoder);
        }
        if let Some(mesh) = mirror_mesh.as_ref() {
            self.draw_mirror_dome(&mut encoder, &self.snapshot_view, self.config.width, self.config.height,
                output_gate, stage, time_seconds.unwrap_or(0.0), &mesh.id);
        } else {
            self.output_presenter.draw(&self.queue, &mut encoder, &self.snapshot_view,
                self.creative_frame_index, self.config.width, self.config.height,
                output_gate, stage, time_seconds.unwrap_or(0.0));
        }
        if should_record_timing {
            if let Some(gpu_timing) = self.gpu_timing.as_ref() {
                gpu_timing.resolve_to_readback(&mut encoder);
            }
        }
        churn_probe::submit(&self.queue, Some(encoder.finish()));
        self.begin_graph_readbacks();
        if should_record_timing {
            if let Some(gpu_timing) = self.gpu_timing.as_mut() {
                gpu_timing.begin_readback();
            }
        }
        self.last_frame_error = None;
        Ok(())
    }

    pub(crate) fn render(
        &mut self,
        command_phase: f32,
        layers_seen: u32,
        time_seconds: Option<f32>,
        frame_count: u64,
        scene_layers: &[LayerGpu],
        source_previews: Option<&[PreviewPixel]>,
        stage3d_mesh_frame: Option<&Stage3DMeshFrame>,
        stage3d_overlay_items: &[Stage3DOverlayItemGpu],
        native_graph_jobs: &[NativeGraphFrameJob],
        composite_graph_jobs: &[NativeGraphFrameJob],
        composite_output_index: usize,
        audio0: [f32; 4],
        audio1: [f32; 4],
        audio2: [f32; 4],
        present_surface: bool,
        frozen: bool,
        output_gate: f32,
        post_effects: &[[f32; 4]],
        stage: OutputStage,
    ) -> Result<SurfacePresentOutcome, String> {
        // Outputs recorded after the last frame's program (none, normally:
        // finish_frame sends them) go first; then the presenter's uniform
        // slots are free to reuse.
        self.submit_outputs();
        self.output_presenter.begin_frame();
        self.refresh_source_frame_bind_groups();
        self.sync_dome_layers(&stage, scene_layers);
        let stage = OutputStage { dlayer: self.dome_layer_pass, ..stage };
        let mut present_outcome = SurfacePresentOutcome::Offscreen;
        let surface_frame = if present_surface {
            let acquire_started = Instant::now();
            let acquired = self.surface.get_current_texture();
            self.pacing.acquired(acquire_started, Instant::now());
            match acquired {
                wgpu::CurrentSurfaceTexture::Success(frame) => {
                    present_outcome = SurfacePresentOutcome::Presented;
                    Some(frame)
                }
                wgpu::CurrentSurfaceTexture::Suboptimal(frame) => {
                    // Present this valid frame first; configuring while it is
                    // acquired panics on Vulkan after resize/fullscreen changes.
                    present_outcome = SurfacePresentOutcome::SuboptimalPresented;
                    Some(frame)
                }
                wgpu::CurrentSurfaceTexture::Outdated => {
                    self.surface.configure(&self.device, &self.config);
                    present_outcome = SurfacePresentOutcome::Outdated;
                    None
                }
                wgpu::CurrentSurfaceTexture::Timeout => {
                    present_outcome = SurfacePresentOutcome::Timeout;
                    None
                }
                wgpu::CurrentSurfaceTexture::Occluded => {
                    // Shared output must keep advancing even when the native
                    // window is covered/minimized or cannot acquire a drawable.
                    present_outcome = SurfacePresentOutcome::Occluded;
                    None
                }
                wgpu::CurrentSurfaceTexture::Lost => {
                    self.surface.configure(&self.device, &self.config);
                    return Err("surface lost".to_string());
                }
                wgpu::CurrentSurfaceTexture::Validation => {
                    return Err("surface validation error".to_string());
                }
            }
        } else {
            None
        };
        self.write_frame_inputs(
            command_phase,
            layers_seen,
            time_seconds,
            frame_count,
            scene_layers,
            source_previews,
            audio0,
            audio1,
            audio2,
            1.0,
            post_effects,
            OutputStage { dlayer: self.dome_layer_pass, ..OutputStage::default() },
        );
        let mut mirror_encoder =
            self.device
                .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                    label: Some("Ghost Render Core Output Mirror Encoder"),
                });
        // Time only frames that start on an idle GPU. A frame queued behind
        // another one has its first timestamp taken while that one is still
        // drawing, which read about twice the real GPU time and would make
        // the quality policy see a different number for the same work. At
        // one frame in flight every frame starts on an idle GPU, as before.
        let should_record_timing = self.gpu_idle_for_frame()
            && self
            .gpu_timing
            .as_ref()
            .is_some_and(GpuTimingState::can_record);
        let record_full_frame_timing = should_record_timing
            && self
                .gpu_timing
                .as_ref()
                .is_some_and(|timing| timing.inside_encoders);
        if record_full_frame_timing {
            if let Some(gpu_timing) = self.gpu_timing.as_ref() {
                mirror_encoder.write_timestamp(&gpu_timing.query_set, 0);
            }
        }
        if !frozen && output_gate > 0.0 {
        // Check the whole frame before any graph mutates simulation state.
        self.frame_uniform_cursor = 0;
        if !frozen && output_gate > 0.0 { self.admit_graph_jobs(native_graph_jobs.iter().chain(composite_graph_jobs.iter()))?; }
        self.render_native_graph_frame_jobs(&mut mirror_encoder, native_graph_jobs)?;
        // A graph that renders into a slot for the first time creates that
        // slot's texture while encoding (per-source store). Rebind before
        // compositing, or this frame reads the empty placeholder (a black
        // flash on a Screen that just switched to a crossfade copy).
        self.refresh_source_frame_bind_groups();
        let mirror_timestamp_writes = if should_record_timing && !record_full_frame_timing {
            self.gpu_timing
                .as_ref()
                .map(GpuTimingState::timestamp_writes)
        } else {
            None
        };
        self.draw_fullscreen_to_view(
            &mut mirror_encoder,
            &gpu_object_cache::view(&self.composite_frame_textures[0], &Default::default()),
            "Ghost Render Core Output Mirror Pass",
            mirror_timestamp_writes,
        );
        self.encode_composition_effects(&mut mirror_encoder, composite_graph_jobs, composite_output_index)?;
        let creative_view = gpu_object_cache::view(&self.composite_frame_textures[self.creative_frame_index], &Default::default());
        self.draw_stage3d_mesh_to_view(
            &mut mirror_encoder,
            &creative_view,
            "Ghost Render Core Stage3D Mesh Output Mirror Pass",
            time_seconds,
            stage3d_mesh_frame,
        );
        self.draw_stage3d_overlay_to_view(
            &mut mirror_encoder,
            &creative_view,
            "Ghost Render Core Stage3D Output Mirror Overlay Pass",
            time_seconds,
            stage3d_overlay_items,
        );
        self.draw_dome_layers(&mut mirror_encoder);
        }
        self.output_presenter.draw(&self.queue, &mut mirror_encoder, &self.output_mirror_view,
            self.creative_frame_index, self.config.width, self.config.height,
            output_gate, stage, time_seconds.unwrap_or(0.0));
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        self.refresh_output_export(&mut mirror_encoder);
        #[cfg(target_os = "macos")]
        self.capture_native_recording_frame(&mut mirror_encoder);
        self.capture_texture_share_frame(&mut mirror_encoder);
        self.capture_pixelmap_frame(&mut mirror_encoder);
        self.capture_ndi_frame(&mut mirror_encoder);
        if let Some(frame) = surface_frame.as_ref() {
            if self.surface_copy_dst_supported {
                mirror_encoder.copy_texture_to_texture(
                    wgpu::TexelCopyTextureInfo {
                        texture: &self.output_mirror_texture,
                        mip_level: 0,
                        origin: wgpu::Origin3d::ZERO,
                        aspect: wgpu::TextureAspect::All,
                    },
                    wgpu::TexelCopyTextureInfo {
                        texture: &frame.texture,
                        mip_level: 0,
                        origin: wgpu::Origin3d::ZERO,
                        aspect: wgpu::TextureAspect::All,
                    },
                    wgpu::Extent3d {
                        width: self.config.width,
                        height: self.config.height,
                        depth_or_array_layers: 1,
                    },
                );
            } else {
                let view = frame
                    .texture
                    .create_view(&wgpu::TextureViewDescriptor::default());
                self.composite_frame_blitter.copy(&self.device, &mut mirror_encoder,
                    &self.output_mirror_view, &view);
            }
        }
        if should_record_timing {
            if let Some(gpu_timing) = self.gpu_timing.as_ref() {
                if record_full_frame_timing {
                    mirror_encoder.write_timestamp(&gpu_timing.query_set, 1);
                }
                gpu_timing.resolve_to_readback(&mut mirror_encoder);
            }
        }
        pass_timing::resolve(&mut mirror_encoder);
        self.submit_frame(mirror_encoder);
        pass_timing::after_submit();
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        self.encode_native_recording_frame();
        self.texture_share_submitted();
        self.ndi_submitted();
        if !frozen && output_gate > 0.0 {
            self.mark_graph_frames_submitted(native_graph_jobs.iter().flat_map(|job| job.render_plans.iter()).filter_map(|plan| match plan.target {
                NativeComputeGraphRenderTarget::SourceFrame { slot, .. } => Some(slot), _ => None,
            }));
        }
        self.begin_graph_readbacks();
        if should_record_timing {
            if let Some(gpu_timing) = self.gpu_timing.as_mut() {
                gpu_timing.begin_readback();
            }
        }
        if let Some(frame) = surface_frame {
            self.queue.present(frame);
            self.pacing.presented(Instant::now());
            if matches!(present_outcome, SurfacePresentOutcome::SuboptimalPresented) {
                self.surface.configure(&self.device, &self.config);
            }
        }
        self.last_frame_error = None;
        Ok(present_outcome)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn heartbeat_slot_bounds_match_the_core() {
        let wgsl = include_str!("../heartbeat.wgsl");
        let constant = |name: &str| -> usize {
            let line = wgsl.lines().find(|line| line.starts_with(&format!("const {name}:")))
                .unwrap_or_else(|| panic!("{name} in heartbeat.wgsl"));
            line.split('=').nth(1).unwrap().trim().trim_end_matches(';').parse().unwrap()
        };
        assert_eq!(constant("MAX_SOURCE_PREVIEW_SLOTS"), MAX_SOURCE_PREVIEWS);
        assert!(wgsl.contains(&format!("layer_index >= {MAX_SCENE_LAYERS}u")), "composite loop bound must equal MAX_SCENE_LAYERS");
        assert!(wgsl.contains(&format!("clamp(u.layer_count, 0.0, {MAX_SCENE_LAYERS}.0)")), "composite loop bound must equal MAX_SCENE_LAYERS");
        // Slots are bounded by the store itself (textureNumLayers or the
        // binding-array length), never by a constant of their own.
        assert!(!wgsl.contains("MAX_SOURCE_FRAME_SLOTS"));
        assert!(wgsl.contains("//#SOURCE_FRAMES"));
    }

    #[test]
    fn compositor_and_stage3d_shaders_validate_for_both_slot_stores() {
        for mode in [SourceFrameMode::Shared, SourceFrameMode::PerSource] {
            for (name, source) in [
                ("heartbeat", heartbeat_wgsl(mode, 64, false)),
                ("heartbeat with source mips", heartbeat_wgsl(mode, 64, true)),
                ("stage3d", stage3d_mesh_wgsl(mode, 64)),
            ] {
                let module = naga::front::wgsl::parse_str(&source)
                    .unwrap_or_else(|error| panic!("{name} {mode:?} parse: {}", error.emit_to_string(&source)));
                let capabilities = match mode {
                    SourceFrameMode::Shared => naga::valid::Capabilities::empty(),
                    SourceFrameMode::PerSource => naga::valid::Capabilities::TEXTURE_AND_SAMPLER_BINDING_ARRAY
                        | naga::valid::Capabilities::TEXTURE_AND_SAMPLER_BINDING_ARRAY_NON_UNIFORM_INDEXING,
                };
                naga::valid::Validator::new(naga::valid::ValidationFlags::all(), capabilities)
                    .validate(&module)
                    .unwrap_or_else(|error| panic!("{name} {mode:?} validation: {error:?}"));
            }
        }
    }

    #[test]
    fn heartbeat_compositor_wgsl_validates_with_the_edge_effect_layout() {
        let module = naga::front::wgsl::parse_str(&heartbeat_wgsl(SourceFrameMode::Shared, 1, true))
            .unwrap_or_else(|error| panic!("heartbeat.wgsl parse: {error}"));
        naga::valid::Validator::new(
            naga::valid::ValidationFlags::all(),
            naga::valid::Capabilities::empty(),
        )
        .validate(&module)
        .unwrap_or_else(|error| panic!("heartbeat.wgsl validation: {error:?}"));
        // The storage struct must stay byte-compatible with LayerCoreGpu.
        let layer_data = module
            .types
            .iter()
            .find(|(_, ty)| ty.name.as_deref() == Some("LayerData"))
            .expect("LayerData struct");
        let naga::TypeInner::Struct { span, .. } = layer_data.1.inner else {
            panic!("LayerData is a struct");
        };
        assert_eq!(span as usize, std::mem::size_of::<LayerCoreGpu>());
        assert!(std::mem::size_of::<LayerCoreGpu>() <= 256);
        // The pool record offsets the shader reads by.
        let source = heartbeat_wgsl(SourceFrameMode::Shared, 1, true);
        for (name, value) in [
            ("POOL_SHAPE_PTS", POOL_SHAPE_PTS), ("POOL_MASK_PTS", POOL_MASK_PTS),
            ("POOL_MESH_POINTS", POOL_MESH_POINTS), ("POOL_MESH_REST", POOL_MESH_REST),
            ("POOL_MESH_TANGENTS", POOL_MESH_TANGENTS), ("POOL_EDGE_EFFECTS", POOL_EDGE_EFFECTS),
            ("POOL_EDGE_CHUNKS", POOL_EDGE_CHUNKS), ("POOL_EDGE_CORNERS", POOL_EDGE_CORNERS),
            ("POOL_EDGE_DIAGS", POOL_EDGE_DIAGS), ("POOL_EDGE_PTS", POOL_EDGE_PTS),
        ] {
            assert!(source.contains(&format!("const {name}: u32 = {value}u;")), "{name} = {value} in heartbeat.wgsl");
        }
        // And the uniform block with Uniforms, dome fields at the tail included.
        let uniforms = module
            .types
            .iter()
            .find(|(_, ty)| ty.name.as_deref() == Some("Uniforms"))
            .expect("Uniforms struct");
        let naga::TypeInner::Struct { span, .. } = uniforms.1.inner else {
            panic!("Uniforms is a struct");
        };
        assert_eq!(span as usize, std::mem::size_of::<Uniforms>());
    }

    #[test]
    fn compositor_allows_fully_opaque_layers() {
        assert!(
            STAGE3D_MESH_WGSL.contains("clamp(in.color.a * opacity, 0.0, 1.0)"),
            "solid native layers must be able to reach full opacity"
        );
        assert!(
            STAGE3D_MESH_WGSL.contains("clamp(in.color.a * opacity * tex.a, 0.0, 1.0)"),
            "textured native layers must be able to reach full opacity"
        );
        assert!(
            !STAGE3D_MESH_WGSL.contains("clamp(in.color.a * opacity, 0.0, 0.96)")
                && !STAGE3D_MESH_WGSL
                    .contains("clamp(in.color.a * opacity * tex.a, 0.0, 0.96)"),
            "the old 96% opacity ceiling must not return"
        );
    }
}
