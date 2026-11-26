//! Per-frame compositor inputs: uniforms, layer uploads, composite views and
//! paint masks.

use crate::*;

impl RenderState {
    /// The compositor uniforms for one view of this frame. Also hands the
    /// output presenter the clock and Flux every output plays.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn frame_uniforms(
        &mut self,
        command_phase: f32,
        layers_seen: u32,
        time_seconds: Option<f32>,
        frame_count: u64,
        audio0: [f32; 4],
        audio1: [f32; 4],
        audio2: [f32; 4],
        output_gate: f32,
        post_effects: &[[f32; 4]],
        stage: OutputStage,
    ) -> Uniforms {
        // The beat clock runs on the unwrapped clock; shaders get it wrapped
        // (see SHADER_CLOCK_WRAP_SECONDS). A manual clock arrives wrapped.
        let clock_seconds = time_seconds.map(f64::from).unwrap_or_else(|| self.start_time.elapsed().as_secs_f64());
        let time = shader_clock_seconds(clock_seconds);
        let clock = self.beat_clock.uniform(clock_seconds);
        self.output_presenter.clock = clock;
        self.output_presenter.live_time = time;
        self.output_presenter.flux = self.output_flux;
        self.output_presenter.flux_regions = self.output_flux_regions;
        Uniforms {
            resolution: [self.config.width as f32, self.config.height as f32],
            time,
            clock,
            flux0: self.output_flux[0],
            flux1: self.output_flux[1],
            flux_regions: self.output_flux_regions,
            command_phase,
            layer_count: layers_seen as f32,
            frame_count: frame_count as f32,
            output_gate,
            post_count: post_effects.len().min(8) as f32,
            audio0,
            audio1,
            audio2,
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
            post: {
                let mut slots = [[0.0f32; 4]; 8];
                for (slot, value) in slots.iter_mut().zip(post_effects.iter().take(8)) {
                    *slot = *value;
                }
                slots
            },
        }
    }

    /// Uniforms and layers for the program composite (`self.bind_group`).
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn write_frame_inputs(
        &mut self,
        command_phase: f32,
        layers_seen: u32,
        time_seconds: Option<f32>,
        frame_count: u64,
        scene_layers: &[LayerGpu],
        source_previews: Option<&[PreviewPixel]>,
        audio0: [f32; 4],
        audio1: [f32; 4],
        audio2: [f32; 4],
        output_gate: f32,
        post_effects: &[[f32; 4]],
        stage: OutputStage,
    ) {
        let uniforms = self.frame_uniforms(command_phase, layers_seen, time_seconds, frame_count,
            audio0, audio1, audio2, output_gate, post_effects, stage);
        churn_probe::write_buffer(&self.queue, &self.uniform_buffer, 0, bytemuck::bytes_of(&uniforms));
        let (filled, upload_len) = self.stage_layer_upload(scene_layers, layers_seen);
        self.program_wants_mips = layers_want_mips(&self.layer_upload_scratch[..filled]);
        self.plan_raster_frame(filled, &uniforms);
        let grown = upload_composite_layers(
            &self.device,
            &self.queue,
            &self.layer_upload_scratch[..upload_len],
            filled,
            CompositeLayerState {
                layer_buffer: &self.layer_buffer,
                pool: &mut self.layer_pool,
                tile_buffer: &self.layer_tile_buffer,
                layer_last: &mut self.layer_upload_last,
                mesh_cell_bounds_last: &mut self.mesh_cell_bounds_last,
                tile_last: &mut self.layer_tile_last,
            },
            &mut self.layer_pack_scratch,
            &mut self.mesh_cell_bounds_scratch,
            &mut self.layer_tile_scratch,
        );
        if grown {
            self.rebind_program_scene();
        }

        if let Some(source_previews) = source_previews {
            // `source_preview_pixel_data` already hands us an exactly-sized,
            // zero-filled array, so the old staging copy through a second
            // 16 MB `vec!` was pure duplication. Upload the caller's slice.
            let preview_len = source_previews
                .len()
                .min(MAX_SOURCE_PREVIEWS * SOURCE_PREVIEW_PIXELS);
            churn_probe::write_buffer(&self.queue, 
                &self.source_preview_buffer,
                0,
                bytemuck::cast_slice(&source_previews[..preview_len]),
            );
        }
    }

    /// Uniforms (and, with `own_layers`, layers) for a view composited after
    /// the program in the same frame: a deck monitor, the record target or a
    /// full-detail Screen. Each view has its own buffers, so it no longer
    /// overwrites the program's and every view's unchanged layers stay
    /// uploaded from one frame to the next. A view without its own layers
    /// draws the program's (a Screen shows the program's layers).
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn write_view_inputs(
        &mut self,
        key: &str,
        own_layers: bool,
        command_phase: f32,
        layers_seen: u32,
        time_seconds: Option<f32>,
        frame_count: u64,
        scene_layers: &[LayerGpu],
        audio0: [f32; 4],
        audio1: [f32; 4],
        audio2: [f32; 4],
        output_gate: f32,
        post_effects: &[[f32; 4]],
        stage: OutputStage,
    ) {
        let uniforms = self.frame_uniforms(command_phase, layers_seen, time_seconds, frame_count,
            audio0, audio1, audio2, output_gate, post_effects, stage);
        let (filled, upload_len) = if own_layers {
            self.stage_layer_upload(scene_layers, layers_seen)
        } else {
            (0, 0)
        };
        self.ensure_composite_view(key, own_layers, upload_len);
        let Some(view) = self.composite_views.get_mut(key) else { return; };
        churn_probe::write_buffer(&self.queue, &view.uniform_buffer, 0, bytemuck::bytes_of(&uniforms));
        let Some(layers) = view.layers.as_mut() else { return; };
        view.wants_mips = layers_want_mips(&self.layer_upload_scratch[..filled]);
        let grown = upload_composite_layers(
            &self.device,
            &self.queue,
            &self.layer_upload_scratch[..upload_len],
            filled,
            CompositeLayerState {
                layer_buffer: &layers.layer_buffer,
                pool: &mut layers.pool,
                tile_buffer: &layers.tile_buffer,
                layer_last: &mut layers.layer_last,
                mesh_cell_bounds_last: &mut layers.mesh_cell_bounds_last,
                tile_last: &mut layers.tile_last,
            },
            &mut self.layer_pack_scratch,
            &mut self.mesh_cell_bounds_scratch,
            &mut self.layer_tile_scratch,
        );
        if grown {
            view.bind_group = build_scene_bind_group(
                &self.device,
                &self.scene_bind_group_layout,
                &view.uniform_buffer,
                &layers.layer_buffer,
                &layers.pool.buffer,
                &self.source_preview_buffer,
                &self.compositor_sampler,
                &self.paint_mask_view,
                &layers.tile_buffer,
            );
        }
    }

    /// Copy `scene_layers` into the upload scratch as the compositor reads
    /// them. Returns (layers filled, slots to upload).
    pub(crate) fn stage_layer_upload(&mut self, scene_layers: &[LayerGpu], layers_seen: u32) -> (usize, usize) {
        // Only the slots the compositor will actually read need to reach the
        // GPU: `heartbeat.wgsl` walks `for i in 0..64 { if f32(i) >= layer_count
        // { break } ... }`, so anything at or beyond `layer_count` is dead.
        // Write `layers_seen` slots (and at least as many as the caller handed
        // us), zero-filling any tail inside that prefix exactly as the old
        // full-array upload did.
        let filled = scene_layers.len().min(MAX_SCENE_LAYERS);
        let upload_len = (layers_seen as usize).max(filled).min(MAX_SCENE_LAYERS);
        fit_layer_upload_scratch(&mut self.layer_upload_scratch, upload_len);
        for (slot, layer) in self.layer_upload_scratch[..filled]
            .iter_mut()
            .zip(scene_layers.iter())
        {
            *slot = *layer;
            slot.cull = layer_cull_bounds(layer);
        }
        for slot in &mut self.layer_upload_scratch[filled..upload_len] {
            *slot = LayerGpu::zeroed();
        }
        (filled, upload_len)
    }

    /// Make (or refit) the buffers and bind group of composite view `key`.
    pub(crate) fn ensure_composite_view(&mut self, key: &str, own_layers: bool, upload_len: usize) {
        let epoch = self.frame_epoch;
        let slots_needed = upload_len.max(1);
        let rebuild = match self.composite_views.get_mut(key) {
            Some(view) if view.layers.is_some() == own_layers => {
                view.used_epoch = epoch;
                let grow = view.layers.as_ref().is_some_and(|layers| layers.slots < slots_needed);
                grow || view.scene_bindings_generation != self.scene_bindings_generation
            }
            _ => {
                self.composite_views.remove(key);
                true
            }
        };
        if !rebuild {
            return;
        }
        let existing = self.composite_views.remove(key);
        let uniform_buffer = existing.as_ref().map(|view| view.uniform_buffer.clone()).unwrap_or_else(|| {
            self.device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("Ghost Render Core View Uniforms"),
                size: std::mem::size_of::<Uniforms>() as u64,
                usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            })
        });
        let layers = own_layers.then(|| {
            match existing.and_then(|view| view.layers) {
                Some(layers) if layers.slots >= slots_needed => layers,
                previous => {
                    // Grown in powers of two, so a scene that adds layers
                    // one by one reallocates a handful of times.
                    let slots = slots_needed.next_power_of_two().min(MAX_SCENE_LAYERS);
                    let layer_buffer = self.device.create_buffer(&wgpu::BufferDescriptor {
                        label: Some("Ghost Render Core View Layers"),
                        size: (slots * std::mem::size_of::<LayerCoreGpu>()) as u64,
                        usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
                        mapped_at_creation: false,
                    });
                    // Tiles and mesh bounds keep their contents: only the
                    // layer array is new and has to be sent again.
                    match previous {
                        Some(previous) => CompositeViewLayers {
                            layer_buffer,
                            slots,
                            layer_last: Vec::new(),
                            pool: LayerPoolState { core_last: Vec::new(), ..previous.pool },
                            ..previous
                        },
                        None => CompositeViewLayers {
                            layer_buffer,
                            slots,
                            pool: LayerPoolState::new(&self.device, "Ghost Render Core View Layer Pool"),
                            // Zeroed like the program's: binning off and
                            // no mesh boxes until the first upload.
                            tile_buffer: self.device.create_buffer(&wgpu::BufferDescriptor {
                                label: Some("Ghost Render Core View Layer Tiles"),
                                size: ((LAYER_TILE_BUFFER_WORDS + MESH_CELL_BOUNDS_WORDS) * std::mem::size_of::<u32>()) as u64,
                                usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
                                mapped_at_creation: false,
                            }),
                            layer_last: Vec::new(),
                            mesh_cell_bounds_last: Vec::new(),
                            tile_last: Vec::new(),
                        },
                    }
                }
            }
        });
        let (layer_buffer, pool_buffer, tile_buffer) = match layers.as_ref() {
            Some(layers) => (&layers.layer_buffer, &layers.pool.buffer, &layers.tile_buffer),
            None => (&self.layer_buffer, &self.layer_pool.buffer, &self.layer_tile_buffer),
        };
        let bind_group = build_scene_bind_group(
            &self.device,
            &self.scene_bind_group_layout,
            &uniform_buffer,
            layer_buffer,
            pool_buffer,
            &self.source_preview_buffer,
            &self.compositor_sampler,
            &self.paint_mask_view,
            tile_buffer,
        );
        self.composite_views.insert(key.to_string(), CompositeView {
            uniform_buffer,
            layers,
            bind_group,
            wants_mips: false,
            scene_bindings_generation: self.scene_bindings_generation,
            used_epoch: epoch,
        });
    }

    /// Let go of views not drawn for a while (a closed Screen, a finished
    /// recording, deck monitors gone idle).
    pub(crate) fn prune_composite_views(&mut self) {
        let epoch = self.frame_epoch;
        self.composite_views.retain(|_, view| epoch.wrapping_sub(view.used_epoch) <= COMPOSITE_VIEW_KEEP_FRAMES);
    }

    pub(crate) fn create_paint_mask_texture(device: &wgpu::Device, size: u32, layers: u32) -> wgpu::Texture {
        device.create_texture(&wgpu::TextureDescriptor {
            label: Some("Ghost Render Core Paint Masks"),
            size: wgpu::Extent3d { width: size, height: size, depth_or_array_layers: layers },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::R8Unorm,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        })
    }

    /// Make the paint-mask array `size`² with room for `slots` layers
    /// (grown in powers of two). True when the texture was recreated and
    /// every mask has to be uploaded again.
    pub(crate) fn ensure_paint_mask_capacity(&mut self, size: u32, slots: usize) -> bool {
        let slots = (slots.max(1) as u32).next_power_of_two().min(paint_mask::PAINT_MASK_MAX_SLOTS as u32);
        if self.paint_mask_size == size && self.paint_mask_layers >= slots {
            return false;
        }
        let layers = if self.paint_mask_size == size { slots.max(self.paint_mask_layers) } else { slots };
        self.paint_mask_texture = Self::create_paint_mask_texture(&self.device, size, layers);
        self.paint_mask_size = size;
        self.paint_mask_layers = layers;
        let paint_mask_view = self.paint_mask_texture.create_view(&wgpu::TextureViewDescriptor {
            label: Some("Ghost Render Core Paint Mask View"),
            dimension: Some(wgpu::TextureViewDimension::D2Array),
            ..Default::default()
        });
        self.paint_mask_view = paint_mask_view;
        self.rebind_program_scene();
        true
    }

    /// Rebuild the program's scene bind group (a buffer or view in it was
    /// replaced) and have every composite view rebuild its own.
    pub(crate) fn rebind_program_scene(&mut self) {
        self.bind_group = build_scene_bind_group(
            &self.device,
            &self.scene_bind_group_layout,
            &self.uniform_buffer,
            &self.layer_buffer,
            &self.layer_pool.buffer,
            &self.source_preview_buffer,
            &self.compositor_sampler,
            &self.paint_mask_view,
            &self.layer_tile_buffer,
        );
        self.scene_bindings_generation = self.scene_bindings_generation.wrapping_add(1);
    }

    pub(crate) fn write_paint_mask(&self, upload: &paint_mask::PaintMaskUpload) {
        if upload.slot as u32 >= self.paint_mask_layers
            || upload.rect.x1 > self.paint_mask_size
            || upload.rect.y1 > self.paint_mask_size
            || upload.bytes.len() != (upload.rect.width() * upload.rect.height()) as usize
        {
            return;
        }
        self.queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &self.paint_mask_texture,
                mip_level: 0,
                origin: wgpu::Origin3d { x: upload.rect.x0, y: upload.rect.y0, z: upload.slot as u32 },
                aspect: wgpu::TextureAspect::All,
            },
            &upload.bytes,
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(upload.rect.width()),
                rows_per_image: Some(upload.rect.height()),
            },
            wgpu::Extent3d { width: upload.rect.width(), height: upload.rect.height(), depth_or_array_layers: 1 },
        );
    }
}
