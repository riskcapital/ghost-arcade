//! Running compute graphs and native graph frame jobs on the GPU: passes,
//! bind groups, graph buffers and textures, and readbacks.

use crate::*;

impl RenderState {
    pub(crate) fn run_native_compute_probe(
        &mut self,
        cache_key: &str,
        source: &str,
        compute_entry: &str,
        uniforms: ComputeProbeUniforms,
    ) -> Result<ComputeProbeResult, String> {
        self.ensure_native_compute_pipeline(
            cache_key,
            source,
            compute_entry,
            &[
                NativeComputeBindingLayoutSpec {
                    binding: 0,
                    kind: NativeComputeGraphBindingKind::Buffer(
                        NativeComputeBufferBindingKind::StorageReadWrite,
                    ),
                },
                NativeComputeBindingLayoutSpec {
                    binding: 1,
                    kind: NativeComputeGraphBindingKind::Buffer(
                        NativeComputeBufferBindingKind::Uniform,
                    ),
                },
            ],
            false,
        )?;
        let element_count = uniforms.element_count.max(1);
        let byte_length = element_count as u64 * std::mem::size_of::<u32>() as u64;
        let storage_buffer = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Ghost Render Core Native Compute Probe Storage"),
            size: byte_length,
            usage: wgpu::BufferUsages::STORAGE
                | wgpu::BufferUsages::COPY_SRC
                | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let uniform_buffer = self
            .device
            .create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("Ghost Render Core Native Compute Probe Uniforms"),
                contents: bytemuck::bytes_of(&uniforms),
                usage: wgpu::BufferUsages::UNIFORM,
            });
        let readback_buffer = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Ghost Render Core Native Compute Probe Readback"),
            size: byte_length,
            usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let Some(cached) = self.native_compute_pipelines.get(cache_key) else {
            return Err(format!(
                "native compute pipeline missing after compile: {cache_key}"
            ));
        };
        let bind_group = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Ghost Render Core Native Compute Probe Bind Group"),
            layout: &cached.bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: storage_buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: uniform_buffer.as_entire_binding(),
                },
            ],
        });
        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("Ghost Render Core Native Compute Probe Encoder"),
            });
        {
            let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some("Ghost Render Core Native Compute Probe Pass"),
                timestamp_writes: None,
            });
            pass.set_pipeline(&cached.pipeline);
            pass.set_bind_group(0, &bind_group, &[]);
            pass.dispatch_workgroups(element_count.div_ceil(64), 1, 1);
        }
        encoder.copy_buffer_to_buffer(&storage_buffer, 0, &readback_buffer, 0, byte_length);
        churn_probe::submit(&self.queue, Some(encoder.finish()));

        let slice = readback_buffer.slice(..);
        let (tx, rx) = mpsc::channel();
        slice.map_async(wgpu::MapMode::Read, move |result| {
            let _ = tx.send(result.map_err(|err| err.to_string()));
        });
        wait_for_gpu_map(&self.device, &rx)?;
        let mapped = slice.get_mapped_range().map_err(|err| err.to_string())?;
        let mut checksum = 0xcbf29ce484222325u64;
        let mut nonzero_words = 0u32;
        let mut first_words = Vec::new();
        for chunk in mapped.chunks_exact(4) {
            let value = u32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
            if value != 0 {
                nonzero_words = nonzero_words.saturating_add(1);
            }
            if first_words.len() < COMPUTE_READBACK_PREVIEW_WORDS {
                first_words.push(value);
            }
            checksum ^= value as u64;
            checksum = checksum.wrapping_mul(0x100000001b3);
        }
        drop(mapped);
        readback_buffer.unmap();
        self.last_frame_error = None;
        Ok(ComputeProbeResult {
            byte_length,
            checksum,
            nonzero_words,
            first_words,
            bytes_b64: None,
        })
    }

    pub(crate) fn run_native_compute_graph(
        &mut self,
        buffers: Vec<NativeComputeGraphBufferSpec>,
        passes: Vec<NativeComputeGraphPassPlan>,
        readbacks: Vec<NativeComputeGraphReadbackSpec>,
        render_plans: Vec<NativeComputeGraphRenderPlan>,
    ) -> Result<Value, String> {
        if buffers.is_empty() {
            return Err("native compute graph requires at least one buffer".to_string());
        }
        if passes.is_empty() && render_plans.is_empty() {
            return Err(
                "native compute graph requires at least one pass or render pass".to_string(),
            );
        }
        let mut transient_buffers = HashMap::<String, NativeComputeGraphGpuBuffer>::new();
        let mut persistent_buffer_count = 0usize;
        let mut transient_buffer_count = 0usize;
        for spec in buffers {
            if spec.persistent {
                self.upsert_native_compute_graph_buffer(&spec)?;
                persistent_buffer_count = persistent_buffer_count.saturating_add(1);
            } else {
                transient_buffer_count = transient_buffer_count.saturating_add(1);
                transient_buffers.insert(
                    spec.id.clone(),
                    self.create_native_compute_graph_buffer(&spec),
                );
            }
        }

        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("Ghost Native Compute Graph Encoder"),
            });
        let mut executed_passes = Vec::with_capacity(passes.len());
        for pass_plan in passes {
            let layout_specs = pass_plan
                .bindings
                .iter()
                .map(|binding| NativeComputeBindingLayoutSpec {
                    binding: binding.binding,
                    kind: binding.kind,
                })
                .collect::<Vec<_>>();
            self.ensure_native_compute_pipeline(
                &pass_plan.cache_key,
                &pass_plan.source,
                &pass_plan.entry,
                &layout_specs,
                false,
        )?;
            let Some(cached) = self.native_compute_pipelines.get(&pass_plan.cache_key) else {
                return Err(format!(
                    "native compute graph pipeline missing after compile: {}",
                    pass_plan.cache_key
                ));
            };
            let mut texture_views = Vec::new();
            let entries = self.compute_graph_bind_group_entries(
                &transient_buffers,
                &pass_plan.bindings,
                &format!("pass `{}`", pass_plan.name),
                &mut texture_views,
                &[],
            )?;
            churn_probe::bind_group();
            let bind_group = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some(&format!(
                    "Ghost Native Compute Graph Bind Group {}",
                    pass_plan.name
                )),
                layout: &cached.bind_group_layout,
                entries: &entries,
            });
            {
                let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                    label: Some(&format!(
                        "Ghost Native Compute Graph Pass {}",
                        pass_plan.name
                    )),
                    timestamp_writes: None,
                });
                pass.set_pipeline(&cached.pipeline);
                pass.set_bind_group(0, &bind_group, &[]);
                pass.dispatch_workgroups(
                    pass_plan.dispatch[0].max(1),
                    pass_plan.dispatch[1].max(1),
                    pass_plan.dispatch[2].max(1),
                );
            }
            executed_passes.push(json!({
                "name": pass_plan.name,
                "entry": pass_plan.entry,
                "dispatch": pass_plan.dispatch,
            }));
        }

        let render_include_snapshot = render_plans.iter().any(|render| {
            render.include_snapshot
                && matches!(render.target, NativeComputeGraphRenderTarget::Snapshot)
        });
        let mut render_results = Vec::with_capacity(render_plans.len());
        for (index, render) in render_plans.iter().enumerate() {
            let store_depth = render_plans
                .get(index + 1)
                .is_some_and(|next| next.depth_load);
            render_results.push(self.render_native_compute_graph(
                &mut encoder,
                &transient_buffers,
                render,
                true,
                store_depth,
            )?);
        }

        let mut readback_buffers = Vec::new();
        for readback in &readbacks {
            let Some(buffer) = self.compute_graph_buffer(&transient_buffers, &readback.id) else {
                return Err(format!(
                    "native compute graph readback missing buffer `{}`",
                    readback.id
                ));
            };
            let readback_buffer = self.device.create_buffer(&wgpu::BufferDescriptor {
                label: Some(&format!(
                    "Ghost Native Compute Graph Readback {}",
                    readback.id
                )),
                size: buffer.byte_length,
                usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            });
            encoder.copy_buffer_to_buffer(
                &buffer.buffer,
                0,
                &readback_buffer,
                0,
                buffer.byte_length,
            );
            readback_buffers.push((readback.clone(), readback_buffer, buffer.byte_length));
        }

        churn_probe::submit(&self.queue, Some(encoder.finish()));
        self.mark_graph_frames_submitted(render_plans.iter().filter_map(|plan| match plan.target {
            NativeComputeGraphRenderTarget::SourceFrame { slot, .. } => Some(slot), _ => None,
        }));

        let mut readback_json = serde_json::Map::new();
        for (readback, readback_buffer, byte_length) in readback_buffers {
            let probe =
                self.readback_u32_buffer(&readback_buffer, byte_length, readback.include_bytes)?;
            let mut value = json!({
                "byte_length": probe.byte_length,
                "checksum": format!("{:016x}", probe.checksum),
                "nonzero_words": probe.nonzero_words,
                "first_words": probe.first_words,
            });
            if let Some(bytes_b64) = probe.bytes_b64 {
                if let Some(object) = value.as_object_mut() {
                    object.insert("bytes_b64".to_string(), Value::String(bytes_b64));
                }
            }
            readback_json.insert(readback.id, value);
        }
        let render_snapshot = if render_include_snapshot {
            Some(self.frame_snapshot(false)?)
        } else {
            None
        };

        self.last_frame_error = None;
        let mut result = json!({
            "pass_count": executed_passes.len(),
            "passes": executed_passes,
            "readbacks": readback_json,
            "persistent_buffers": persistent_buffer_count,
            "transient_buffers": transient_buffer_count,
            "persistent_buffer_count": self.native_compute_graph_buffers.len(),
            "pipeline_cache_entries": self.native_pipeline_cache_count(),
        });
        if render_results.len() == 1 {
            if let Some(object) = result.as_object_mut() {
                object.insert("render".to_string(), render_results[0].clone());
            }
        }
        if !render_results.is_empty() {
            if let Some(object) = result.as_object_mut() {
                object.insert("renders".to_string(), Value::Array(render_results));
            }
        }
        if let Some(snapshot) = render_snapshot {
            if let Some(object) = result.as_object_mut() {
                object.insert("render_snapshot".to_string(), snapshot);
            }
        }
        Ok(result)
    }

    pub(crate) fn render_native_graph_frame_jobs(
        &mut self,
        encoder: &mut wgpu::CommandEncoder,
        jobs: &[NativeGraphFrameJob],
    ) -> Result<(), String> {
        // Queued per-clip FX/generator jobs can arrive after persistent
        // transition carriers. Their actual slot writers still run first.
        // Keep the outer list intact so compile retries retain queued jobs.
        for index in graph_frame_job_order(jobs) {
            let job = &jobs[index];
            let mut transient_buffers = HashMap::<String, NativeComputeGraphGpuBuffer>::new();
            for spec in &job.buffers {
                if spec.persistent {
                    self.upsert_native_compute_graph_buffer(spec)?;
                } else {
                    transient_buffers.insert(
                        spec.id.clone(),
                        self.frame_graph_buffer(spec),
                    );
                }
            }
            // `report: false` — this is the per-frame path and the returned
            // `Value` was dropped on the floor. Building it cost a fresh
            // serde_json map (18 entries for a render plan) for every pass of
            // every graph layer, every frame.
            // A pipeline still building does not stop the job here: the rest
            // of its passes are still asked for, so every missing pipeline is
            // queued at once instead of one per frame. A graph with dozens of
            // passes otherwise took minutes to appear. The frame is not
            // submitted while any is warming (the caller retries the job).
            let mut warming: Option<String> = None;
            for pass_plan in &job.pass_plans {
                match self.encode_native_compute_graph_pass(encoder, &transient_buffers, pass_plan, false) {
                    Err(err) if err.starts_with("native pipeline is warming") => { warming.get_or_insert(err); }
                    result => { result?; }
                }
            }
            for (index, render_plan) in job.render_plans.iter().enumerate() {
                let store_depth = job
                    .render_plans
                    .get(index + 1)
                    .is_some_and(|next| next.depth_load);
                match self.render_native_compute_graph(encoder, &transient_buffers, render_plan, false, store_depth) {
                    Err(err) if err.starts_with("native pipeline is warming") => { warming.get_or_insert(err); }
                    result => { result?; }
                }
            }
            if let Some(err) = warming {
                return Err(err);
            }
            for id in &job.readback_buffer_ids {
                // One in flight per buffer: a slow map must not pile up copies.
                if self.pending_graph_readbacks.iter().any(|pending| &pending.id == id) {
                    continue;
                }
                let Some(source) = self.compute_graph_buffer(&transient_buffers, id) else {
                    continue;
                };
                let byte_length = source.byte_length;
                let source_buffer = source.buffer.clone();
                // Only when someone has asked since the last copy: the app
                // reads zone counters ten times a second, not every frame.
                if !self.graph_live_readbacks.take_ask(id) {
                    continue;
                }
                let device = &self.device;
                let staging = self.graph_live_readbacks.staging(id, byte_length, || {
                    device.create_buffer(&wgpu::BufferDescriptor {
                        label: Some("Ghost Graph Readback Staging"),
                        size: byte_length,
                        usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
                        mapped_at_creation: false,
                    })
                });
                encoder.copy_buffer_to_buffer(&source_buffer, 0, &staging, 0, byte_length);
                self.pending_graph_readbacks.push(PendingGraphReadback {
                    id: id.clone(),
                    staging,
                    byte_length,
                    mapped: None,
                });
            }
        }
        Ok(())
    }

    /// Start mapping every readback copied in the frame just submitted.
    pub(crate) fn begin_graph_readbacks(&mut self) {
        for pending in &mut self.pending_graph_readbacks {
            if pending.mapped.is_some() {
                continue;
            }
            let (tx, rx) = mpsc::channel();
            pending
                .staging
                .slice(0..pending.byte_length)
                .map_async(wgpu::MapMode::Read, move |result| {
                    let _ = tx.send(result);
                });
            pending.mapped = Some(rx);
        }
    }

    /// Collect finished readbacks without waiting on the GPU.
    pub(crate) fn poll_graph_readbacks(&mut self) {
        let mut index = 0;
        while index < self.pending_graph_readbacks.len() {
            let landed = match self.pending_graph_readbacks[index].mapped.as_ref() {
                Some(rx) => rx.try_recv().ok(),
                None => None,
            };
            let Some(result) = landed else {
                index += 1;
                continue;
            };
            let pending = self.pending_graph_readbacks.swap_remove(index);
            if result.is_ok() {
                let slice = pending.staging.slice(0..pending.byte_length);
                if let Ok(view) = slice.get_mapped_range() {
                    self.graph_readback_results
                        .insert(pending.id.clone(), view.to_vec());
                }
                pending.staging.unmap();
            } else {
                // A failed map leaves the buffer unusable: the next copy gets a new one.
                self.graph_live_readbacks.forget_staging(&pending.id);
            }
        }
    }

    pub(crate) fn encode_native_compute_graph_pass(
        &mut self,
        encoder: &mut wgpu::CommandEncoder,
        transient_buffers: &HashMap<String, NativeComputeGraphGpuBuffer>,
        pass_plan: &NativeComputeGraphPassPlan,
        report: bool,
    ) -> Result<Value, String> {
        let layout_specs = pass_plan
            .bindings
            .iter()
            .map(|binding| NativeComputeBindingLayoutSpec {
                binding: binding.binding,
                kind: binding.kind,
            })
            .collect::<Vec<_>>();
        self.ensure_native_compute_pipeline(
            &pass_plan.cache_key,
            &pass_plan.source,
            &pass_plan.entry,
            &layout_specs,
            !report && self.allow_async_compile,
        )?;
        let Some(cached) = self.native_compute_pipelines.get(&pass_plan.cache_key) else {
            return Err(format!(
                "native compute graph pipeline missing after compile: {}",
                pass_plan.cache_key
            ));
        };
        let mut texture_views = Vec::new();
        // Labels are borrowed from the plan rather than `format!`ed: the plan
        // already owns the name, and formatting cost a String allocation per
        // pass per frame purely to decorate a debug label.
        let entries = self.compute_graph_bind_group_entries(
            transient_buffers,
            &pass_plan.bindings,
            &pass_plan.name,
            &mut texture_views,
            &[],
        )?;
        let bind_group = gpu_object_cache::bind_group(
            &self.device,
            Some(&pass_plan.name),
            &cached.bind_group_layout,
            &entries,
        );
        {
            let pass_time = pass_timing::slot(&pass_plan.name);
            let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some(&pass_plan.name),
                timestamp_writes: pass_timing::compute_writes(&pass_time),
            });
            pass.set_pipeline(&cached.pipeline);
            pass.set_bind_group(0, &bind_group, &[]);
            pass.dispatch_workgroups(
                pass_plan.dispatch[0].max(1),
                pass_plan.dispatch[1].max(1),
                pass_plan.dispatch[2].max(1),
            );
        }
        if !report {
            return Ok(Value::Null);
        }
        Ok(json!({
            "name": pass_plan.name,
            "entry": pass_plan.entry,
            "dispatch": pass_plan.dispatch,
        }))
    }

    pub(crate) fn render_native_compute_graph(
        &mut self,
        encoder: &mut wgpu::CommandEncoder,
        transient_buffers: &HashMap<String, NativeComputeGraphGpuBuffer>,
        render_plan: &NativeComputeGraphRenderPlan,
        report: bool,
        // Keep this pass's depth for the next one. Only set when the next pass
        // in the same graph is depth_load: storing is not free on tile-based
        // GPUs, which can otherwise leave depth in on-chip memory.
        store_depth: bool,
    ) -> Result<Value, String> {
        let (output_format, target_name, target_width, target_height, source_id, source_slot) =
            match &render_plan.target {
                NativeComputeGraphRenderTarget::Snapshot => (
                    self.config.format,
                    "snapshot",
                    self.config.width.max(1),
                    self.config.height.max(1),
                    None::<String>,
                    None::<usize>,
                ),
                NativeComputeGraphRenderTarget::SourceFrame {
                    source_id, slot, ..
                } => {
                    let (width, height) = self.generated_frame_size();
                    let target = self.slots.ensure_generated(*slot, width, height);
                    (
                        self.source_frame_format,
                        "source_frame",
                        target.width,
                        target.height,
                        Some(source_id.clone()),
                        Some(self.slots.clamp_slot(*slot)),
                    )
                }
                // Full output resolution, and the swapchain's format so the
                // finished chain can go straight back to the mirror.
                NativeComputeGraphRenderTarget::CompositeFrame { .. } => (
                    self.config.format,
                    "composite_frame",
                    self.config.width.max(1),
                    self.config.height.max(1),
                    None::<String>,
                    None::<usize>,
                ),
                NativeComputeGraphRenderTarget::GraphTexture { id } => {
                    let Some(texture) = self.native_graph_textures.get(id) else {
                        return Err(format!(
                            "native compute graph render `{}` targets missing texture `{id}`",
                            render_plan.name
                        ));
                    };
                    (
                        texture.spec.format.texture_format(),
                        "graph_texture",
                        texture.spec.width,
                        texture.spec.height,
                        None::<String>,
                        None::<usize>,
                    )
                }
            };
        let graph_target_id = match &render_plan.target {
            NativeComputeGraphRenderTarget::GraphTexture { id } => Some(id.as_str()),
            _ => None,
        };
        if let Some(depth_id) = render_plan.depth_texture_id.as_deref() {
            let Some(depth) = self.native_graph_textures.get(depth_id) else {
                return Err(format!(
                    "native compute graph render `{}` uses missing depth texture `{depth_id}`",
                    render_plan.name
                ));
            };
            graph_textures::check_depth_size(&render_plan.name, &depth.spec, target_width, target_height)?;
        }
        let composite_target_index = match &render_plan.target {
            NativeComputeGraphRenderTarget::CompositeFrame { index } => {
                Some((*index).min(COMPOSITE_FRAME_SLOTS - 1))
            }
            _ => None,
        };
        let layout_specs = render_plan
            .bindings
            .iter()
            .map(|binding| NativeComputeBindingLayoutSpec {
                binding: binding.binding,
                kind: binding.kind,
            })
            .collect::<Vec<_>>();
        // An effect pass with its own pipeline (effect_specialize.rs) draws
        // with the shared effect shader until that pipeline is built, when
        // the pipeline budget is nearly used up, or if it fails to build.
        let generic_plan;
        let render_plan = match effect_specialize::generic_for(&render_plan.cache_key) {
            Some(generic) => {
                // Keep the shared pipeline from aging out of the budget: it
                // is what a newly added effect draws with while its own builds.
                let generic_key = native_graph_render_pipeline_key(&generic.cache_key, output_format);
                if self.native_graph_render_pipelines.contains_key(&generic_key) {
                    self.pipeline_used.insert(generic_key, self.frame_epoch);
                }
                let key = native_graph_render_pipeline_key(&render_plan.cache_key, output_format);
                let room = self.native_graph_render_pipelines.contains_key(&key)
                    || (self.native_pipeline_cache_count() as usize) + 16 < self.pipeline_cap;
                let ready = room && self
                    .ensure_native_graph_render_pipeline(&key, render_plan, &layout_specs, output_format, !report && self.allow_async_compile)
                    .is_ok();
                effect_specialize::note_draw(ready);
                if ready {
                    render_plan
                } else {
                    generic_plan = NativeComputeGraphRenderPlan {
                        cache_key: generic.cache_key,
                        source: generic.source,
                        ..render_plan.clone()
                    };
                    &generic_plan
                }
            }
            None => render_plan,
        };
        let pipeline_key = native_graph_render_pipeline_key(&render_plan.cache_key, output_format);
        self.ensure_native_graph_render_pipeline(
            &pipeline_key,
            render_plan,
            &layout_specs,
            output_format,
            !report && self.allow_async_compile,
        )?;
        let Some(cached) = self.native_graph_render_pipelines.get(&pipeline_key) else {
            return Err(format!(
                "native compute graph render pipeline missing after compile: {}",
                pipeline_key
            ));
        };
        let target_slot = source_slot.map(|slot| self.slots.slot(slot));
        let sample_overrides = self.prepare_graph_sample_copies(encoder, render_plan, target_slot.as_ref());
        let mut texture_views = Vec::new();
        let entries = self.compute_graph_bind_group_entries(
            transient_buffers,
            &render_plan.bindings,
            &render_plan.name,
            &mut texture_views,
            &sample_overrides,
        )?;
        let bind_group = gpu_object_cache::bind_group(
            &self.device,
            Some(&render_plan.name),
            &cached.bind_group_layout,
            &entries,
        );
        let source_frame_target_view;
        let composite_target_view;
        let target_view = if let Some(index) = composite_target_index {
            composite_target_view = gpu_object_cache::view(
                &self.composite_frame_textures[index],
                &wgpu::TextureViewDescriptor {
                    label: Some("Ghost Native Composite Frame Target View"),
                    format: Some(self.config.format),
                    dimension: Some(wgpu::TextureViewDimension::D2),
                    base_mip_level: 0,
                    mip_level_count: Some(1),
                    base_array_layer: 0,
                    array_layer_count: Some(1),
                    ..Default::default()
                },
            );
            &composite_target_view
        } else if let Some(target) = target_slot.as_ref() {
            source_frame_target_view = target.target_view("Ghost Native Compute Graph Source Frame View", 0);
            &source_frame_target_view
        } else if let Some(texture) = graph_target_id.and_then(|id| self.native_graph_textures.get(id)) {
            &texture.target_view
        } else {
            &self.snapshot_view
        };
        let graph_depth = render_plan
            .depth_texture_id
            .as_deref()
            .and_then(|id| self.native_graph_textures.get(id));
        let depth_stencil_attachment = if let Some(depth) = graph_depth {
            Some(wgpu::RenderPassDepthStencilAttachment {
                view: &depth.view,
                depth_ops: Some(wgpu::Operations {
                    load: if render_plan.depth_load {
                        wgpu::LoadOp::Load
                    } else {
                        wgpu::LoadOp::Clear(1.0)
                    },
                    // A graph depth texture exists to be read later.
                    store: wgpu::StoreOp::Store,
                }),
                stencil_ops: None,
            })
        } else if render_plan.depth_enabled {
            let depth_view = if source_slot.is_some()
                && target_width == self.source_frame_size as u32
                && target_height == self.source_frame_size as u32
            {
                &self.native_graph_source_depth_view
            } else {
                &self.stage3d_mesh_depth_view
            };
            Some(wgpu::RenderPassDepthStencilAttachment {
                view: depth_view,
                depth_ops: Some(wgpu::Operations {
                    // A depth_load pass reads what the pass before it stored.
                    load: if render_plan.depth_load {
                        wgpu::LoadOp::Load
                    } else {
                        wgpu::LoadOp::Clear(1.0)
                    },
                    store: if store_depth {
                        wgpu::StoreOp::Store
                    } else {
                        wgpu::StoreOp::Discard
                    },
                }),
                stencil_ops: None,
            })
        } else {
            None
        };
        {
            let color_attachment = wgpu::RenderPassColorAttachment {
                view: target_view,
                resolve_target: None,
                ops: wgpu::Operations {
                    load: if render_plan.clear {
                        wgpu::LoadOp::Clear(wgpu::Color {
                            r: render_plan.clear_color[0],
                            g: render_plan.clear_color[1],
                            b: render_plan.clear_color[2],
                            a: render_plan.clear_color[3],
                        })
                    } else {
                        wgpu::LoadOp::Load
                    },
                    store: wgpu::StoreOp::Store,
                },
                depth_slice: None,
            };
            let color_attachments = [Some(color_attachment)];
            let pass_time = pass_timing::slot(&render_plan.name);
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some(&render_plan.name),
                // A depth-only pass (a shadow map) has no colour output.
                color_attachments: if render_plan.depth_only { &[] } else { &color_attachments },
                depth_stencil_attachment,
                timestamp_writes: pass_timing::render_writes(&pass_time),
                occlusion_query_set: None,
                multiview_mask: None,
            });
            pass.set_pipeline(&cached.pipeline);
            pass.set_bind_group(0, &bind_group, &[]);
            if let Some(indirect_buffer_id) = render_plan.indirect_buffer_id.as_ref() {
                let Some(buffer) = self.compute_graph_buffer(transient_buffers, indirect_buffer_id)
                else {
                    return Err(format!(
                        "native compute graph render `{}` references missing indirect buffer `{}`",
                        render_plan.name, indirect_buffer_id
                    ));
                };
                if !buffer.indirect {
                    return Err(format!(
                        "native compute graph render `{}` indirect buffer `{}` was not created with indirect usage",
                        render_plan.name, indirect_buffer_id
                    ));
                }
                pass.draw_indirect(&buffer.buffer, render_plan.indirect_offset);
            } else {
                pass.draw(0..render_plan.vertex_count, 0..render_plan.instance_count);
            }
        }
        if let Some(slot) = source_slot.filter(|_| render_plan.generate_mips) {
            self.generate_source_frame_mips(encoder, slot);
        }
        if let Some(id) = graph_target_id {
            self.native_graph_textures.generate_mips(encoder, id);
        }
        if !report {
            return Ok(Value::Null);
        }
        let mut result = json!({
            "name": render_plan.name,
            "vertex_entry": render_plan.vertex_entry,
            "fragment_entry": render_plan.fragment_entry,
            "bindings": render_plan.bindings.len(),
            "target": target_name,
            "blend": render_plan.blend.signature(),
            "draw": if render_plan.indirect_buffer_id.is_some() { "indirect" } else { "direct" },
            "primitive": render_plan.primitive_topology.signature(),
            "vertex_count": render_plan.vertex_count,
            "instance_count": render_plan.instance_count,
            "depth": render_plan.depth_enabled,
            "depth_write": render_plan.depth_write,
            "depth_compare": render_plan.depth_compare.signature(),
            "depth_load": render_plan.depth_load,
            "format": texture_format_label(output_format),
            "include_snapshot": render_plan.include_snapshot,
            "generate_mips": render_plan.generate_mips,
            "clear_color": render_plan.clear_color,
        });
        if let Some(indirect_buffer_id) = render_plan.indirect_buffer_id.as_ref() {
            if let Some(object) = result.as_object_mut() {
                object.insert(
                    "indirect_buffer".to_string(),
                    Value::String(indirect_buffer_id.clone()),
                );
                object.insert(
                    "indirect_offset".to_string(),
                    Value::from(render_plan.indirect_offset),
                );
            }
        }
        if let Some(source_id) = source_id {
            if let Some(object) = result.as_object_mut() {
                object.insert("source_id".to_string(), json!(source_id));
                object.insert("source_slot".to_string(), json!(source_slot.unwrap_or(0)));
            }
        }
        Ok(result)
    }

    /// A pass may not sample the texture it renders into. Any picture a
    /// binding reads from that texture (every slot of the shared array, or
    /// the pass's own slot when each slot has its own texture) is copied to
    /// scratch first; the result names the copy per binding.
    pub(crate) fn prepare_graph_sample_copies(
        &self,
        encoder: &mut wgpu::CommandEncoder,
        render_plan: &NativeComputeGraphRenderPlan,
        target: Option<&SlotRef>,
    ) -> Vec<Option<SlotRef>> {
        let mut overrides = vec![None; render_plan.bindings.len()];
        let Some(target) = target else { return overrides };
        let mut scratch = self.graph_sample_scratch.borrow_mut();
        let mut used = 0usize;
        for (index, binding) in render_plan.bindings.iter().enumerate() {
            if !matches!(binding.kind, NativeComputeGraphBindingKind::SourceFrameTexture(
                NativeComputeGraphTextureDimension::D2)) {
                continue;
            }
            let source = self.slots.slot(binding.source_slot.unwrap_or(0));
            if source.texture != target.texture {
                continue;
            }
            let fits = |copy: &SlotRef| copy.width == source.width && copy.height == source.height
                && copy.mips == source.mips;
            if scratch.get(used).is_none_or(|copy| !fits(copy)) {
                let texture = self.device.create_texture(&wgpu::TextureDescriptor {
                    label: Some("Ghost Native Graph Source Frame Sample Scratch"),
                    size: wgpu::Extent3d { width: source.width, height: source.height, depth_or_array_layers: 1 },
                    mip_level_count: source.mips,
                    sample_count: 1,
                    dimension: wgpu::TextureDimension::D2,
                    format: self.source_frame_format,
                    usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
                    view_formats: &[],
                });
                let copy = SlotRef { texture, layer: 0, width: source.width, height: source.height, mips: source.mips };
                if used < scratch.len() { scratch[used] = copy } else { scratch.push(copy) }
            }
            let copy = scratch[used].clone();
            for mip_level in 0..source.mips {
                let (width, height) = source.mip_size(mip_level);
                encoder.copy_texture_to_texture(
                    source.copy_info(mip_level),
                    copy.copy_info(mip_level),
                    wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
                );
            }
            overrides[index] = Some(copy);
            used += 1;
        }
        overrides
    }

    pub(crate) fn compute_graph_bind_group_entries<'a>(
        &'a self,
        transient_buffers: &'a HashMap<String, NativeComputeGraphGpuBuffer>,
        bindings: &'a [NativeComputeGraphBindingSpec],
        context: &str,
        texture_views: &'a mut Vec<wgpu::TextureView>,
        sample_overrides: &[Option<SlotRef>],
    ) -> Result<Vec<wgpu::BindGroupEntry<'a>>, String> {
        enum PreparedBinding<'a> {
            Buffer(&'a wgpu::Buffer),
            TextureView(usize),
            GraphTextureView(&'a wgpu::TextureView),
            Sampler,
        }

        let mut prepared = Vec::with_capacity(bindings.len());
        for binding in bindings {
            match binding.kind {
                NativeComputeGraphBindingKind::Buffer(_) => {
                    let Some(buffer) =
                        self.compute_graph_buffer(transient_buffers, &binding.resource_id)
                    else {
                        return Err(format!(
                            "native compute graph {context} references missing buffer `{}`",
                            binding.resource_id
                        ));
                    };
                    prepared.push(PreparedBinding::Buffer(&buffer.buffer));
                }
                NativeComputeGraphBindingKind::SourceFrameTexture(dimension) => {
                    let binding_index = prepared.len();
                    let view = match dimension {
                        NativeComputeGraphTextureDimension::D2 => sample_overrides
                            .get(binding_index)
                            .cloned()
                            .flatten()
                            .unwrap_or_else(|| self.slots.slot(binding.source_slot.unwrap_or(0)))
                            .sample_view("Ghost Native Compute Graph Source Frame Texture View"),
                        // The whole shared array. A pass rendering into a
                        // slot cannot also read the array it is part of, and
                        // per-source slots have no array to bind.
                        NativeComputeGraphTextureDimension::D2Array => {
                            if self.slots.mode() == SourceFrameMode::PerSource || !sample_overrides.is_empty()
                                && sample_overrides.iter().any(Option::is_some)
                            {
                                return Err(format!(
                                    "native compute graph {context}: a whole-array source binding is not available with {} picture slots",
                                    self.slots.mode().label()
                                ));
                            }
                            self.slots.shared_array_view().expect("shared source-frame array")
                        }
                    };
                    texture_views.push(view);
                    prepared.push(PreparedBinding::TextureView(texture_views.len() - 1));
                }
                NativeComputeGraphBindingKind::CompositeFrameTexture => {
                    let index = binding
                        .source_slot
                        .unwrap_or(0)
                        .min(COMPOSITE_FRAME_SLOTS - 1);
                    texture_views.push(gpu_object_cache::view(
                        &self.composite_frame_textures[index],
                        &wgpu::TextureViewDescriptor {
                            label: Some("Ghost Native Composite Frame Texture View"),
                            format: Some(self.config.format),
                            dimension: Some(wgpu::TextureViewDimension::D2),
                            base_mip_level: 0,
                            mip_level_count: Some(1),
                            base_array_layer: 0,
                            array_layer_count: Some(1),
                            ..Default::default()
                        },
                    ));
                    prepared.push(PreparedBinding::TextureView(texture_views.len() - 1));
                }
                NativeComputeGraphBindingKind::SourceFrameSampler => {
                    prepared.push(PreparedBinding::Sampler);
                }
                NativeComputeGraphBindingKind::GraphTexture
                | NativeComputeGraphBindingKind::GraphDepthTexture => {
                    let Some(texture) = self.native_graph_textures.get(&binding.resource_id) else {
                        return Err(format!(
                            "native compute graph {context} references missing texture `{}`",
                            binding.resource_id
                        ));
                    };
                    prepared.push(PreparedBinding::GraphTextureView(&texture.view));
                }
            }
        }

        Ok(bindings
            .iter()
            .zip(prepared.iter())
            .map(|(binding, prepared)| wgpu::BindGroupEntry {
                binding: binding.binding,
                resource: match prepared {
                    PreparedBinding::Buffer(buffer) => buffer.as_entire_binding(),
                    PreparedBinding::TextureView(index) => {
                        wgpu::BindingResource::TextureView(&texture_views[*index])
                    }
                    PreparedBinding::GraphTextureView(view) => {
                        wgpu::BindingResource::TextureView(view)
                    }
                    PreparedBinding::Sampler => {
                        wgpu::BindingResource::Sampler(&self.source_frame_sampler)
                    }
                },
            })
            .collect())
    }

    pub(crate) fn ensure_native_graph_render_pipeline(
        &mut self,
        pipeline_key: &str,
        render_plan: &NativeComputeGraphRenderPlan,
        layout_specs: &[NativeComputeBindingLayoutSpec],
        output_format: wgpu::TextureFormat,
        deferred: bool,
    ) -> Result<(), String> {
        self.poll_pipeline_work();
        self.reserve_pipeline(pipeline_key)?;
        if self
            .native_graph_render_pipelines
            .contains_key(pipeline_key)
        {
            return Ok(());
        }
        if layout_specs.is_empty() {
            return Err(format!(
                "native graph render pipeline `{}` has no bindings",
                pipeline_key
            ));
        }
        if deferred {
            let device = self.device.clone();
            let plan = render_plan.clone();
            let specs = layout_specs.to_vec();
            return self.queue_pipeline_work(pipeline_key, move || build_graph_render_pipeline(&device, &plan, &specs, output_format).map(CompiledPipeline::Render));
        }
        let pipeline = build_graph_render_pipeline(&self.device, render_plan, layout_specs, output_format)?;
        self.native_graph_render_pipelines.insert(pipeline_key.to_string(), pipeline);
        self.pipeline_used.insert(pipeline_key.to_string(), self.frame_epoch);
        Ok(())
    }

    pub(crate) fn frame_graph_buffer(&mut self, spec: &NativeComputeGraphBufferSpec) -> NativeComputeGraphGpuBuffer {
        if !matches!(spec.kind, NativeComputeBufferBindingKind::Uniform)
            || spec.initial_bytes.len() as u64 != spec.byte_length || spec.byte_length > 64 * 1024
            || self.frame_uniform_cursor >= 128 {
            return self.create_native_compute_graph_buffer(spec);
        }
        let index = self.frame_uniform_cursor;
        self.frame_uniform_cursor += 1;
        if index >= self.frame_uniform_pool.len() {
            let buffer = self.create_native_compute_graph_buffer(spec);
            self.frame_uniform_pool.push(buffer);
        } else if self.frame_uniform_pool[index].byte_length != spec.byte_length {
            self.frame_uniform_pool[index] = self.create_native_compute_graph_buffer(spec);
        } else {
            churn_probe::write_buffer(&self.queue, &self.frame_uniform_pool[index].buffer, 0, &spec.initial_bytes);
        }
        self.frame_uniform_pool[index].clone()
    }

    pub(crate) fn create_native_compute_graph_buffer(
        &self,
        spec: &NativeComputeGraphBufferSpec,
    ) -> NativeComputeGraphGpuBuffer {
        let mut usage = spec.kind.buffer_usage();
        if spec.indirect {
            usage |= wgpu::BufferUsages::INDIRECT;
        }
        let buffer = if spec.initial_bytes.is_empty() {
            self.device.create_buffer(&wgpu::BufferDescriptor {
                label: Some(&format!("Ghost Native Compute Graph Buffer {}", spec.id)),
                size: spec.byte_length,
                usage,
                mapped_at_creation: false,
            })
        } else {
            self.device
                .create_buffer_init(&wgpu::util::BufferInitDescriptor {
                    label: Some(&format!("Ghost Native Compute Graph Buffer {}", spec.id)),
                    contents: &spec.initial_bytes,
                    usage,
                })
        };
        NativeComputeGraphGpuBuffer {
            buffer,
            byte_length: spec.byte_length,
            kind: spec.kind,
            indirect: spec.indirect,
        }
    }

    pub(crate) fn upsert_native_graph_texture(
        &mut self,
        spec: &NativeComputeGraphTextureSpec,
    ) -> Result<(), String> {
        self.native_graph_textures.upsert(&self.device, spec)
    }

    pub(crate) fn upsert_native_compute_graph_buffer(
        &mut self,
        spec: &NativeComputeGraphBufferSpec,
    ) -> Result<(), String> {
        let recreate = spec.clear
            || self
                .native_compute_graph_buffers
                .get(&spec.id)
                .map(|existing| {
                    existing.byte_length != spec.byte_length
                        || existing.kind.signature() != spec.kind.signature()
                        || existing.indirect != spec.indirect
                })
                .unwrap_or(true);
        if recreate {
            // Reserved LUT references must never become zero-filled after eviction.
            if spec.id.contains(":uniform:lut:") && spec.initial_bytes.is_empty() {
                return Err(format!("LUT buffer {} needs its initial upload", spec.id));
            }
            let previous = self.native_compute_graph_buffers.get(&spec.id).map_or(0, |b| b.byte_length);
            if self.native_compute_graph_buffer_bytes().saturating_sub(previous).saturating_add(spec.byte_length) > self.graph_budget_bytes {
                return Err("persistent graph buffer budget exceeded".to_string());
            }
            let buffer = self.create_native_compute_graph_buffer(spec);
            self.native_compute_graph_buffers
                .insert(spec.id.clone(), buffer);
            return Ok(());
        }
        if !spec.initial_bytes.is_empty() {
            let Some(existing) = self.native_compute_graph_buffers.get(&spec.id) else {
                return Err(format!(
                    "persistent native compute graph buffer `{}` missing after lookup",
                    spec.id
                ));
            };
            churn_probe::write_buffer(&self.queue, &existing.buffer, 0, &spec.initial_bytes);
        }
        Ok(())
    }

    pub(crate) fn compute_graph_buffer<'a>(
        &'a self,
        transient_buffers: &'a HashMap<String, NativeComputeGraphGpuBuffer>,
        id: &str,
    ) -> Option<&'a NativeComputeGraphGpuBuffer> {
        transient_buffers
            .get(id)
            .or_else(|| self.native_compute_graph_buffers.get(id))
    }

    pub(crate) fn native_compute_graph_buffer_count(&self) -> u32 {
        self.native_compute_graph_buffers
            .len()
            .min(u32::MAX as usize) as u32
    }

    pub(crate) fn native_compute_graph_buffer_bytes(&self) -> u64 {
        self.native_compute_graph_buffers
            .values()
            .map(|buffer| buffer.byte_length)
            .fold(0u64, u64::saturating_add)
    }

    pub(crate) fn prune_native_compute_graph_buffers_to_budget(&mut self, max_bytes: u64) -> (usize, u64) {
        let mut current_bytes = self.native_compute_graph_buffer_bytes();
        if current_bytes <= max_bytes {
            return (0, 0);
        }
        let mut entries = self
            .native_compute_graph_buffers
            .iter()
            .filter(|(id, _)| !self.pinned_buffers.contains(*id))
            .map(|(id, buffer)| (id.clone(), buffer.byte_length))
            .collect::<Vec<_>>();
        entries.sort_by(|left, right| left.0.cmp(&right.0));

        let mut evicted = 0usize;
        let mut evicted_bytes = 0u64;
        for (id, byte_length) in entries {
            if current_bytes <= max_bytes {
                break;
            }
            if self.native_compute_graph_buffers.remove(&id).is_some() {
                evicted = evicted.saturating_add(1);
                evicted_bytes = evicted_bytes.saturating_add(byte_length);
                current_bytes = current_bytes.saturating_sub(byte_length);
            }
        }
        (evicted, evicted_bytes)
    }

    pub(crate) fn clear_native_compute_graph_buffers(
        &mut self,
        clear_all: bool,
        prefixes: &[String],
    ) -> usize {
        if clear_all {
            let count = self.native_compute_graph_buffers.len();
            self.native_compute_graph_buffers.clear();
            self.prune_graph_readbacks(|_| false);
            return count;
        }
        let prefixes = prefixes
            .iter()
            .map(|prefix| prefix.trim())
            .filter(|prefix| !prefix.is_empty())
            .collect::<Vec<_>>();
        if prefixes.is_empty() {
            return 0;
        }
        let before = self.native_compute_graph_buffers.len();
        self.native_compute_graph_buffers
            .retain(|id, _| !prefixes.iter().any(|prefix| id.starts_with(prefix)));
        self.prune_graph_readbacks(|id| !prefixes.iter().any(|prefix| id.starts_with(prefix)));
        before.saturating_sub(self.native_compute_graph_buffers.len())
    }

    /// Forget the readbacks of buffers that are gone: their asks, staging
    /// buffers, copies in flight and bytes nobody took.
    pub(crate) fn prune_graph_readbacks(&mut self, keep: impl Fn(&str) -> bool) {
        self.graph_live_readbacks.retain(&keep);
        self.graph_readback_results.retain(|id, _| keep(id));
        self.pending_graph_readbacks.retain(|pending| keep(&pending.id));
    }

    /// Free every persistent graph buffer whose id contains `token`.
    ///
    /// Buffer ids are `<kind>:<safe-source-id>:<...>`, so the source id sits
    /// in the middle and prefix matching cannot reach it. Used when a graph
    /// layer is removed: the builders already re-seed any buffer they find
    /// missing (that is how budget eviction works), so dropping these is how
    /// a re-added layer id gets a fresh simulation instead of resuming the
    /// deleted layer's state.
    pub(crate) fn drop_native_compute_graph_buffers_containing(&mut self, token: &str) -> usize {
        if token.is_empty() {
            return 0;
        }
        let before = self.native_compute_graph_buffers.len();
        self.native_compute_graph_buffers
            .retain(|id, _| !id.contains(token));
        self.prune_graph_readbacks(|id| !id.contains(token));
        before.saturating_sub(self.native_compute_graph_buffers.len())
    }

    pub(crate) fn readback_u32_buffer(
        &self,
        readback_buffer: &wgpu::Buffer,
        byte_length: u64,
        include_bytes: bool,
    ) -> Result<ComputeProbeResult, String> {
        if include_bytes && byte_length > COMPUTE_READBACK_BYTES_MAX {
            return Err(format!(
                "compute graph readback bytes request is too large: {byte_length} > {COMPUTE_READBACK_BYTES_MAX}"
            ));
        }
        let slice = readback_buffer.slice(..);
        let (tx, rx) = mpsc::channel();
        slice.map_async(wgpu::MapMode::Read, move |result| {
            let _ = tx.send(result.map_err(|err| err.to_string()));
        });
        wait_for_gpu_map(&self.device, &rx)?;
        let mapped = slice.get_mapped_range().map_err(|err| err.to_string())?;
        let mut checksum = 0xcbf29ce484222325u64;
        let mut nonzero_words = 0u32;
        let mut first_words = Vec::new();
        for chunk in mapped.chunks_exact(4) {
            let value = u32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
            if value != 0 {
                nonzero_words = nonzero_words.saturating_add(1);
            }
            if first_words.len() < COMPUTE_READBACK_PREVIEW_WORDS {
                first_words.push(value);
            }
            checksum ^= value as u64;
            checksum = checksum.wrapping_mul(0x100000001b3);
        }
        let bytes_b64 = if include_bytes {
            Some(base64::engine::general_purpose::STANDARD.encode(mapped.as_ref()))
        } else {
            None
        };
        drop(mapped);
        readback_buffer.unmap();
        Ok(ComputeProbeResult {
            byte_length,
            checksum,
            nonzero_words,
            first_words,
            bytes_b64,
        })
    }
}
