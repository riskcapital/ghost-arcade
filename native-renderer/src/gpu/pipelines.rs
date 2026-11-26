//! Render and compute pipeline builds, the worker queue that warms them, and
//! the pipeline caches.

use crate::*;

/// Pipelines built at once on worker threads while a new graph warms.
pub(crate) const PIPELINE_WORKERS: usize = 6;

pub(crate) struct NativeShaderPipeline {
    pub(crate) pipeline: wgpu::RenderPipeline,
}

pub(crate) struct NativeComputePipeline {
    pub(crate) pipeline: wgpu::ComputePipeline,
    pub(crate) bind_group_layout: wgpu::BindGroupLayout,
}

pub(crate) enum CompiledPipeline {
    Compute(NativeComputePipeline),
    Render(NativeGraphRenderPipeline),
    Shader(NativeShaderPipeline),
}

pub(crate) struct NativeGraphRenderPipeline {
    pub(crate) pipeline: wgpu::RenderPipeline,
    pub(crate) bind_group_layout: wgpu::BindGroupLayout,
}

pub(crate) fn native_shader_pipeline_key(record: &ShaderRecord, shader_id: &str, entry: &str) -> String {
    format!(
        "{shader_id}:{}:{}:{entry}",
        record.source_kind, record.source_hash
    )
}

pub(crate) fn native_graph_render_pipeline_key(base_key: &str, output_format: wgpu::TextureFormat) -> String {
    format!(
        "{base_key}:target-format:{}",
        texture_format_label(output_format)
    )
}

/// A native shader layer's render pipeline (fragment from WGSL or ISF/GLSL), built off the frame.
pub(crate) fn build_native_shader_pipeline(
    device: &wgpu::Device,
    vertex_module: &wgpu::ShaderModule,
    bind_group_layout: &wgpu::BindGroupLayout,
    source_kind: NativeShaderSourceKind,
    source: &str,
    fragment_entry: &str,
    format: wgpu::TextureFormat,
) -> Result<NativeShaderPipeline, String> {
    let error_scope = device.push_error_scope(wgpu::ErrorFilter::Validation);
    let shader_source = match source_kind {
        NativeShaderSourceKind::Wgsl => wgpu::ShaderSource::Wgsl(source.into()),
        NativeShaderSourceKind::IsfGlsl | NativeShaderSourceKind::Glsl => wgpu::ShaderSource::Glsl {
            shader: source.into(),
            stage: naga::ShaderStage::Fragment,
            defines: &[],
        },
    };
    let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
        label: Some("Ghost Render Core Native Shader Fragment"),
        source: shader_source,
    });
    let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
        label: Some("Ghost Render Core Native Shader Pipeline Layout"),
        bind_group_layouts: &[Some(bind_group_layout)],
        immediate_size: 0,
    });
    let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: Some("Ghost Render Core Native Shader Pipeline"),
        layout: Some(&pipeline_layout),
        vertex: wgpu::VertexState {
            module: vertex_module,
            entry_point: Some("vs_main"),
            compilation_options: wgpu::PipelineCompilationOptions::default(),
            buffers: &[],
        },
        primitive: wgpu::PrimitiveState::default(),
        depth_stencil: None,
        multisample: wgpu::MultisampleState::default(),
        fragment: Some(wgpu::FragmentState {
            module: &shader,
            entry_point: Some(fragment_entry),
            compilation_options: wgpu::PipelineCompilationOptions::default(),
            targets: &[Some(wgpu::ColorTargetState {
                format,
                blend: None,
                write_mask: wgpu::ColorWrites::ALL,
            })],
        }),
        multiview_mask: None,
        cache: pipeline_cache::for_device(device).as_ref(),
    });
    let error_future = error_scope.pop();
    let _ = device.poll(wgpu::PollType::Poll);
    if let Some(err) = pollster::block_on(error_future) {
        return Err(err.to_string());
    }
    Ok(NativeShaderPipeline { pipeline })
}

pub(crate) fn build_compute_pipeline(device: &wgpu::Device, cache_key: &str, source: &str, compute_entry: &str, layout_specs: &[NativeComputeBindingLayoutSpec]) -> Result<NativeComputePipeline, String> {
        let error_scope = device.push_error_scope(wgpu::ErrorFilter::Validation);
        let shader = device
            .create_shader_module(wgpu::ShaderModuleDescriptor {
                label: Some("Ghost Render Core Native Compute Shader"),
                source: wgpu::ShaderSource::Wgsl(source.into()),
            });
        let layout_entries = layout_specs
            .iter()
            .map(|spec| wgpu::BindGroupLayoutEntry {
                binding: spec.binding,
                visibility: wgpu::ShaderStages::COMPUTE,
                ty: spec.kind.binding_type(),
                count: None,
            })
            .collect::<Vec<_>>();
        let bind_group_layout =
            device
                .create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                    label: Some("Ghost Render Core Native Compute Layout"),
                    entries: &layout_entries,
                });
        let pipeline_layout = device
            .create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some("Ghost Render Core Native Compute Probe Pipeline Layout"),
                bind_group_layouts: &[Some(&bind_group_layout)],
                immediate_size: 0,
            });
        let pipeline = device
            .create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
                label: Some("Ghost Render Core Native Compute Probe Pipeline"),
                layout: Some(&pipeline_layout),
                module: &shader,
                entry_point: Some(compute_entry),
                compilation_options: wgpu::PipelineCompilationOptions::default(),
                cache: pipeline_cache::for_device(device).as_ref(),
            });
        let error_future = error_scope.pop();
        let _ = device.poll(wgpu::PollType::Poll);
        if let Some(err) = pollster::block_on(error_future) {
            // Name the pipeline: "validation error" without the cache key made
            // binding-layout mismatches undebuggable from the app logs.
            return Err(format!("native compute pipeline `{cache_key}`: {err}"));
        }
        Ok(NativeComputePipeline { pipeline, bind_group_layout })
}

pub(crate) fn build_graph_render_pipeline(device: &wgpu::Device, render_plan: &NativeComputeGraphRenderPlan, layout_specs: &[NativeComputeBindingLayoutSpec], output_format: wgpu::TextureFormat) -> Result<NativeGraphRenderPipeline, String> {
        let error_scope = device.push_error_scope(wgpu::ErrorFilter::Validation);
        let shader = device
            .create_shader_module(wgpu::ShaderModuleDescriptor {
                label: Some("Ghost Render Core Native Graph Render Shader"),
                source: wgpu::ShaderSource::Wgsl(render_plan.source.as_ref().into()),
            });
        let layout_entries = layout_specs
            .iter()
            .map(|spec| wgpu::BindGroupLayoutEntry {
                binding: spec.binding,
                visibility: wgpu::ShaderStages::VERTEX | wgpu::ShaderStages::FRAGMENT,
                ty: spec.kind.binding_type(),
                count: None,
            })
            .collect::<Vec<_>>();
        let bind_group_layout =
            device
                .create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                    label: Some("Ghost Render Core Native Graph Render Layout"),
                    entries: &layout_entries,
                });
        let pipeline_layout = device
            .create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some("Ghost Render Core Native Graph Render Pipeline Layout"),
                bind_group_layouts: &[Some(&bind_group_layout)],
                immediate_size: 0,
            });
        let color_targets = [Some(wgpu::ColorTargetState {
            format: output_format,
            blend: Some(render_plan.blend.blend_state()),
            write_mask: wgpu::ColorWrites::ALL,
        })];
        let pipeline = device
            .create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some("Ghost Render Core Native Graph Render Pipeline"),
                layout: Some(&pipeline_layout),
                vertex: wgpu::VertexState {
                    module: &shader,
                    entry_point: Some(&render_plan.vertex_entry),
                    compilation_options: wgpu::PipelineCompilationOptions::default(),
                    buffers: &[],
                },
                primitive: wgpu::PrimitiveState {
                    topology: render_plan.primitive_topology.topology(),
                    ..Default::default()
                },
                depth_stencil: if render_plan.depth_enabled {
                    Some(wgpu::DepthStencilState {
                        format: NATIVE_GRAPH_DEPTH_FORMAT,
                        depth_write_enabled: Some(render_plan.depth_write),
                        depth_compare: Some(render_plan.depth_compare.compare_function()),
                        stencil: wgpu::StencilState::default(),
                        bias: wgpu::DepthBiasState::default(),
                    })
                } else {
                    None
                },
                multisample: wgpu::MultisampleState::default(),
                // A depth-only pass (a shadow map) runs no fragment shader.
                fragment: if render_plan.depth_only { None } else { Some(wgpu::FragmentState {
                    module: &shader,
                    entry_point: Some(&render_plan.fragment_entry),
                    compilation_options: wgpu::PipelineCompilationOptions::default(),
                    targets: &color_targets,
                }) },
                multiview_mask: None,
                cache: pipeline_cache::for_device(device).as_ref(),
            });
        let error_future = error_scope.pop();
        let _ = device.poll(wgpu::PollType::Poll);
        if let Some(err) = pollster::block_on(error_future) {
            return Err(err.to_string());
        }
        Ok(NativeGraphRenderPipeline { pipeline, bind_group_layout })
}

impl RenderState {
    pub(crate) fn poll_pipeline_work(&mut self) {
        let completed: Vec<_> = self.pipeline_work.iter().filter_map(|(key, rx)| {
            match rx.try_recv() {
                Ok(result) => Some((key.clone(), result)),
                Err(mpsc::TryRecvError::Disconnected) => Some((key.clone(), Err("pipeline worker disconnected".to_string()))),
                Err(mpsc::TryRecvError::Empty) => None,
            }
        }).collect();
        for (key, result) in completed {
            self.pipeline_work.remove(&key);
            match result {
                Ok(pipeline) => {
                    if self.reserve_pipeline(&key).is_err() { continue; }
                    match pipeline {
                        CompiledPipeline::Compute(p) => { self.native_compute_pipelines.insert(key.clone(), p); }
                        CompiledPipeline::Render(p) => { self.native_graph_render_pipelines.insert(key.clone(), p); }
                        CompiledPipeline::Shader(p) => { self.native_shader_pipelines.insert(key.clone(), p); }
                    }
                    self.pipeline_used.insert(key, self.frame_epoch);
                }
                Err(error) => {
                    if self.pipeline_failures.len() >= 256 { self.pipeline_failures.clear(); }
                    self.pipeline_failures.insert(key, error);
                }
            }
        }
    }

    pub(crate) fn queue_pipeline_work(&mut self, key: &str, build: impl FnOnce() -> Result<CompiledPipeline, String> + Send + 'static) -> Result<(), String> {
        if let Some(error) = self.pipeline_failures.get(key) { return Err(error.clone()); }
        if !self.pipeline_work.contains_key(key) && self.pipeline_work.len() < PIPELINE_WORKERS {
            let (tx, rx) = mpsc::channel();
            self.pipeline_work.insert(key.to_string(), rx);
            thread::spawn(move || { let _ = tx.send(build()); });
        }
        Err("native pipeline is warming; preserving the last program frame".to_string())
    }

    pub(crate) fn reserve_pipeline(&mut self, key: &str) -> Result<(), String> {
        if self.native_shader_pipelines.contains_key(key) || self.native_compute_pipelines.contains_key(key)
            || self.native_graph_render_pipelines.contains_key(key) {
            self.pipeline_used.insert(key.to_string(), self.frame_epoch);
            return Ok(());
        }
        while self.native_pipeline_cache_count() as usize >= self.pipeline_cap {
            let victim = self.pipeline_used.iter().filter(|(_, epoch)| **epoch != self.frame_epoch)
                .min_by_key(|(_, epoch)| **epoch).map(|(key, _)| key.clone());
            let Some(victim) = victim else { return Err("active shader pipelines exceed the pipeline budget".to_string()); };
            self.native_shader_pipelines.remove(&victim);
            self.native_compute_pipelines.remove(&victim);
            self.native_graph_render_pipelines.remove(&victim);
            self.pipeline_used.remove(&victim);
        }
        Ok(())
    }

    pub(crate) fn admit_graph_jobs<'a>(&mut self, jobs: impl Iterator<Item = &'a NativeGraphFrameJob>) -> Result<(), String> {
        let mut required = HashMap::<String, u64>::new();
        let mut transient = 0u64;
        for job in jobs {
            for spec in &job.textures {
                self.native_graph_textures.upsert(&self.device, spec)?;
            }
            for spec in &job.buffers {
                if spec.persistent { required.insert(spec.id.clone(), spec.byte_length); }
                else { transient = transient.saturating_add(spec.byte_length); }
            }
            for binding in job.pass_plans.iter().flat_map(|p| p.bindings.iter())
                .chain(job.render_plans.iter().flat_map(|p| p.bindings.iter())) {
                if let Some(buffer) = self.native_compute_graph_buffers.get(&binding.resource_id) {
                    required.entry(binding.resource_id.clone()).or_insert(buffer.byte_length);
                }
            }
        }
        let bytes = required.values().fold(transient, |sum, bytes| sum.saturating_add(*bytes));
        if bytes > self.graph_budget_bytes {
            return Err(format!("active graph allocation needs {bytes} bytes; budget is {}", self.graph_budget_bytes));
        }
        let growth = required.iter().fold(0u64, |sum, (id, bytes)| {
            sum.saturating_add(bytes.saturating_sub(self.native_compute_graph_buffers.get(id).map_or(0, |b| b.byte_length)))
        });
        self.pinned_buffers = required.into_keys().collect();
        // Keep direct-RPC simulation state warm between submissions. Retire only
        // unreferenced buffers when new active work actually needs the space.
        self.prune_native_compute_graph_buffers_to_budget(self.graph_budget_bytes.saturating_sub(transient).saturating_sub(growth));
        Ok(())
    }

    pub(crate) fn native_shader_pipeline_count(&self) -> u32 {
        self.native_shader_pipelines.len().min(u32::MAX as usize) as u32
    }

    pub(crate) fn native_pipeline_cache_count(&self) -> u32 {
        self.native_shader_pipelines
            .len()
            .saturating_add(self.native_compute_pipelines.len())
            .saturating_add(self.native_graph_render_pipelines.len())
            .min(u32::MAX as usize) as u32
    }

    pub(crate) fn clear_native_pipeline_caches(&mut self) -> usize {
        self.pipeline_failures.clear();
        let count = self
            .native_shader_pipelines
            .len()
            .saturating_add(self.native_compute_pipelines.len())
            .saturating_add(self.native_graph_render_pipelines.len());
        self.pipeline_used.clear();
        self.native_shader_pipelines.clear();
        self.native_compute_pipelines.clear();
        self.native_graph_render_pipelines.clear();
        count
    }

    pub(crate) fn ensure_native_shader_pipeline(
        &mut self,
        cache_key: &str,
        source_kind: NativeShaderSourceKind,
        source: &str,
        fragment_entry: &str,
    ) -> Result<(), String> {
        let format = self.source_frame_format;
        self.ensure_native_shader_pipeline_for_format(cache_key, source_kind, source, fragment_entry, format)
    }

    /// Pipeline key for an ISF pass that renders into a target of `format`.
    /// Output passes (source-frame format) keep the plain key so single-pass
    /// and multi-pass renders of one shader share a pipeline.
    pub(crate) fn native_shader_pipeline_key_for_format(&self, cache_key: &str, format: wgpu::TextureFormat) -> String {
        if format == self.source_frame_format {
            cache_key.to_string()
        } else {
            format!("{cache_key}@{format:?}")
        }
    }

    pub(crate) fn ensure_native_shader_pipeline_for_format(
        &mut self,
        cache_key: &str,
        source_kind: NativeShaderSourceKind,
        source: &str,
        fragment_entry: &str,
        format: wgpu::TextureFormat,
    ) -> Result<(), String> {
        self.poll_pipeline_work();
        self.reserve_pipeline(cache_key)?;
        if self.native_shader_pipelines.contains_key(cache_key) {
            return Ok(());
        }
        // Built on a worker thread, like graph pipelines: a shader seen for
        // the first time (a new visual coming in) never stalls the frame.
        // Until it lands this layer is skipped and everything else renders.
        // Outside the frame's own shader pass (a command asking for a render
        // now, or a manual render clock) it is built at once, so the render
        // that asked for it has its picture.
        if !self.shader_async_compile {
            let pipeline = build_native_shader_pipeline(
                &self.device, &self.native_shader_vertex_module, &self.native_shader_bind_group_layout,
                source_kind, source, fragment_entry, format,
            )?;
            self.native_shader_pipelines.insert(cache_key.to_string(), pipeline);
            self.pipeline_used.insert(cache_key.to_string(), self.frame_epoch);
            return Ok(());
        }
        let device = self.device.clone();
        let vertex = self.native_shader_vertex_module.clone();
        let layout = self.native_shader_bind_group_layout.clone();
        let source = source.to_string();
        let entry = fragment_entry.to_string();
        self.queue_pipeline_work(cache_key, move || {
            build_native_shader_pipeline(&device, &vertex, &layout, source_kind, &source, &entry, format)
                .map(CompiledPipeline::Shader)
        })
    }

    pub(crate) fn ensure_native_compute_pipeline(
        &mut self,
        cache_key: &str,
        source: &str,
        compute_entry: &str,
        layout_specs: &[NativeComputeBindingLayoutSpec],
        deferred: bool,
    ) -> Result<(), String> {
        self.poll_pipeline_work();
        self.reserve_pipeline(cache_key)?;
        if self.native_compute_pipelines.contains_key(cache_key) {
            return Ok(());
        }
        if layout_specs.is_empty() {
            return Err(format!(
                "native compute pipeline `{cache_key}` has no bindings"
            ));
        }
        if deferred {
            let device = self.device.clone();
            let owned_key = cache_key.to_string();
            let source = source.to_string();
            let entry = compute_entry.to_string();
            let specs = layout_specs.to_vec();
            return self.queue_pipeline_work(cache_key, move || build_compute_pipeline(&device, &owned_key, &source, &entry, &specs).map(CompiledPipeline::Compute));
        }
        let pipeline = build_compute_pipeline(&self.device, cache_key, source, compute_entry, layout_specs)?;
        self.native_compute_pipelines.insert(cache_key.to_string(), pipeline);
        self.pipeline_used.insert(cache_key.to_string(), self.frame_epoch);
        Ok(())
    }
}
