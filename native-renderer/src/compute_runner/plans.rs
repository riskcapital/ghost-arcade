//! Compute graph commands and plans: graph frame jobs, bindings, passes and
//! render plans.

use crate::*;

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
pub(crate) struct ComputeProbeUniforms {
    pub(crate) element_count: u32,
    pub(crate) frame_index: u32,
    pub(crate) seed: u32,
    pub(crate) _pad0: u32,
}

pub(crate) struct ComputeProbeResult {
    pub(crate) byte_length: u64,
    pub(crate) checksum: u64,
    pub(crate) nonzero_words: u32,
    pub(crate) first_words: Vec<u32>,
    pub(crate) bytes_b64: Option<String>,
}

pub(crate) fn native_graph_binding_layout_signature(bindings: &[NativeComputeGraphBindingSpec]) -> String {
    bindings
        .iter()
        .map(|binding| format!("{}:{}", binding.binding, binding.kind.signature()))
        .collect::<Vec<_>>()
        .join(",")
}

impl App {
    pub(crate) fn compute_probe(&mut self, params: &Value) -> Result<Value, String> {
        let Some(shader_id) = string_at(params, &["shader_id"]) else {
            return Err("compute_probe requires shader_id".to_string());
        };
        let record = self
            .shader_registry
            .get(&shader_id)
            .cloned()
            .ok_or_else(|| format!("compute shader `{shader_id}` has not been precompiled"))?;
        let source = self
            .shader_sources
            .get(&shader_id)
            .ok_or_else(|| format!("compute shader source missing for `{shader_id}`"))?;
        let entry = native_compute_entry(&record, source).ok_or_else(|| {
            format!("shader `{shader_id}` is not a supported native compute shader")
        })?;
        let element_count = number_at(params, &["element_count"])
            .or_else(|| number_at(params, &["count"]))
            .unwrap_or(256.0)
            .round()
            .clamp(1.0, 1_048_576.0) as u32;
        let frame_index = number_at(params, &["frame_index"])
            .or_else(|| number_at(params, &["frame"]))
            .map(|value| value.round().clamp(0.0, u32::MAX as f64) as u32)
            .unwrap_or(self.stats.frames_presented.min(u32::MAX as u64) as u32);
        let seed = number_at(params, &["seed"])
            .map(|value| value.round().clamp(0.0, u32::MAX as f64) as u32)
            .unwrap_or_else(|| stable_hash64(&shader_id) as u32);
        let cache_key = format!("{}:{}:{:016x}", shader_id, entry, record.source_hash);
        let Some(renderer) = self.renderer.as_mut() else {
            return Err("native renderer has not created a wgpu device".to_string());
        };
        let probe = renderer.run_native_compute_probe(
            &cache_key,
            source,
            &entry,
            ComputeProbeUniforms {
                element_count,
                frame_index,
                seed,
                _pad0: 0,
            },
        )?;
        self.stats.pipeline_cache_entries = renderer.native_pipeline_cache_count() as u64;
        Ok(json!({
            "shader_id": shader_id,
            "entry": entry,
            "element_count": element_count,
            "frame_index": frame_index,
            "seed": seed,
            "byte_length": probe.byte_length,
            "checksum": format!("{:016x}", probe.checksum),
            "nonzero_words": probe.nonzero_words,
            "first_words": probe.first_words,
            "pipeline_cache_entries": renderer.native_pipeline_cache_count(),
        }))
    }

    pub(crate) fn compute_graph_frame_job(&mut self, params: &Value) -> Result<NativeGraphFrameJob, String> {
        let params = params.get("config").unwrap_or(params);
        let Some(buffers_value) = params.get("buffers").and_then(Value::as_array) else {
            return Err("queued compute_graph requires buffers[]".to_string());
        };
        let Some(passes_value) = params.get("passes").and_then(Value::as_array) else {
            return Err("queued compute_graph requires passes[]".to_string());
        };
        let texture_specs = self.upsert_compute_graph_textures(params)?;
        let mut buffer_specs = Vec::with_capacity(buffers_value.len());
        for buffer in buffers_value {
            let mut spec = parse_compute_graph_buffer(buffer)?;
            if !spec.initial_bytes.is_empty() {
                spec.persistent = true;
            }
            buffer_specs.push(spec);
        }
        let buffer_kinds = buffer_specs
            .iter()
            .map(|buffer| (buffer.id.clone(), buffer.kind))
            .collect::<HashMap<_, _>>();
        let mut pass_plans = Vec::with_capacity(passes_value.len());
        for (index, pass) in passes_value.iter().enumerate() {
            pass_plans.push(self.compute_graph_pass_plan(pass, index, &buffer_kinds)?);
        }
        let render_plans = self.compute_graph_render_plans(params, &buffer_kinds)?;
        if pass_plans.is_empty() && render_plans.is_empty() {
            return Err(
                "queued compute_graph requires at least one pass or render pass".to_string(),
            );
        }
        // Hardware/HAP frames occupy an aspect-preserving rectangle in the
        // shared square texture. Effects operate in normalized content space.
        let mut render_plans = render_plans;
        for (plan, descriptor) in render_plans.iter_mut().zip(params["render_passes"].as_array().into_iter().flatten()) {
            if descriptor["shader_id"].as_str() != Some(effect_specialize::EFFECT_SHADER_ID) { continue; }
            let source = plan.bindings.iter().find(|b| b.binding == 0);
            let uniform = plan.bindings.iter().find(|b| b.binding == 2);
            if let (Some(source), Some(uniform)) = (source, uniform) {
                let rect = if let Some(id) = source.resource_id.strip_prefix("layer-frame:") {
                    self.scene_layers.get(id).map(|layer| layer.source_rect)
                } else { self.source_frames.get(&source.resource_id).map(|frame| frame.source_rect) }
                    .unwrap_or([0.0, 0.0, 1.0, 1.0]);
                if let Some(buffer) = buffer_specs.iter_mut().find(|buffer| buffer.id == uniform.resource_id)
                    && buffer.initial_bytes.len() >= 112 {
                    for (index, value) in rect.iter().enumerate() {
                        buffer.initial_bytes[96 + index * 4..100 + index * 4].copy_from_slice(&value.to_le_bytes());
                    }
                    if let Some((cache_key, source)) = effect_specialize::code_in_uniform(&buffer.initial_bytes)
                        .and_then(|code| effect_specialize::specialise(&plan.cache_key, &plan.source, code))
                    {
                        plan.cache_key = cache_key;
                        plan.source = source;
                    }
                }
            }
        }
        let readbacks = compute_graph_readbacks(params, &buffer_specs);
        if !readbacks.is_empty() {
            return Err(
                "queued compute_graph does not support readbacks; use run_compute_graph for probes, or live_readbacks on a graph layer"
                    .to_string(),
            );
        }
        let live_readbacks = graph_readbacks::live_readback_ids(params, &buffer_specs)?;
        // Install immutable LUT data before acknowledging a queued graph. Otherwise
        // coalescing could discard the first upload in favour of a reference-only job.
        // Resident jobs retain no table payload and never rewrite the table per frame.
        for (value, spec) in buffers_value.iter().zip(buffer_specs.iter_mut()) {
            if value.get("immutable_lut").and_then(Value::as_bool) != Some(true) { continue; }
            if !matches!(spec.kind.signature(), "storage-read" | "storage-rw") || spec.byte_length > 65 * 65 * 65 * 16
                || !spec.persistent || spec.clear {
                return Err("invalid immutable LUT storage buffer".to_string());
            }
            let renderer = self.renderer.as_mut().ok_or("LUT upload requires a ready renderer")?;
            let existing = renderer.native_compute_graph_buffers.get(&spec.id);
            if spec.initial_bytes.is_empty() {
                if existing.is_none_or(|buffer| buffer.byte_length != spec.byte_length) {
                    return Err(format!("LUT buffer {} was released; upload it again", spec.id));
                }
            } else {
                let growth = spec.byte_length.saturating_sub(existing.map_or(0, |buffer| buffer.byte_length));
                if renderer.native_compute_graph_buffer_bytes().saturating_add(growth) > renderer.graph_budget_bytes {
                    return Err("LUT upload exceeds the graph buffer budget".to_string());
                }
                renderer.upsert_native_compute_graph_buffer(spec)?;
                spec.initial_bytes = Vec::new();
            }
        }
        Ok(NativeGraphFrameJob {
            textures: texture_specs,
            buffers: buffer_specs,
            pass_plans,
            render_plans,
            readback_buffer_ids: live_readbacks,
        })
    }

    pub(crate) fn register_compute_graph_source_frame_targets(
        &mut self,
        render_plans: &[NativeComputeGraphRenderPlan],
    ) {
        for render_plan in render_plans {
            if let NativeComputeGraphRenderTarget::SourceFrame {
                source_id,
                slot,
                seq,
            } = &render_plan.target
            {
                self.source_frames
                    .insert(source_id.clone(), SourceFrame::full(*seq));
                for layer in self.scene_layers.values_mut() {
                    if layer.source_id.as_deref() == Some(source_id.as_str()) {
                        // Queueing allocates an effect slot before its first
                        // pass renders. Keep the raw frame visible until a
                        // successful GPU submission publishes this slot.
                        if !source_id.starts_with("effect-pass:") {
                            layer.frame_slot = Some(*slot);
                            layer.source_rect = [0.0, 0.0, 1.0, 1.0];
                        }
                    }
                }
            }
        }
    }

    pub(crate) fn apply_queue_compute_graph(&mut self, command: &Value) -> Result<(), String> {
        let job = self.compute_graph_frame_job(command)?;
        self.register_compute_graph_source_frame_targets(&job.render_plans);
        // A job that renders into the composite ping-pong is composition FX:
        // it reads the finished composite, so it has to run after the
        // compositor rather than alongside the per-source graphs. Route it to
        // the post-composite queue, replacing whatever was queued last frame
        // — the chain is rebuilt each frame and only the newest is wanted.
        if job.render_plans.iter().any(|plan| {
            matches!(
                plan.target,
                NativeComputeGraphRenderTarget::CompositeFrame { .. }
            )
        }) {
            let output_index = job
                .render_plans
                .iter()
                .rev()
                .find_map(|plan| match plan.target {
                    NativeComputeGraphRenderTarget::CompositeFrame { index } => Some(index),
                    _ => None,
                })
                .unwrap_or(0);
            self.pending_composite_graph_jobs = Arc::new(Vec::new());
            self.pending_composite_output_index = output_index.min(COMPOSITE_FRAME_SLOTS - 1);
            self.pending_composite_graph_jobs = Arc::new(vec![job]);
            return Ok(());
        }
        // Coalesce: a newer job rendering into the same source frame(s)
        // REPLACES any still-pending job for those targets. The render
        // loop executes every pending job per frame, so a submission
        // rate above the core's render rate would otherwise accumulate
        // stale jobs quadratically — renders slow, more jobs pile on,
        // presentation starves (observed as ~1fps splat playback with a
        // 60fps submitter), and the queue eventually kills the process.
        // Only the freshest time step per target matters.
        let new_targets: Vec<String> = job
            .render_plans
            .iter()
            .filter_map(|plan| match &plan.target {
                NativeComputeGraphRenderTarget::SourceFrame { source_id, .. } => {
                    Some(source_id.clone())
                }
                _ => None,
            })
            .collect();
        let mut job = job;
        if !new_targets.is_empty() {
            // A replaced job may carry the ONE upload of a persistent buffer
            // (a point cloud, a mesh): the sender queues it once and from
            // then on only refers to the buffer. Dropping it with the stale
            // job left the layer black for good whenever the next frame's
            // graph arrived before this one had run. Hand the data on to the
            // job that replaces it.
            let mut carried: Vec<(String, usize, bool, Vec<u8>)> = Vec::new();
            self.pending_native_graph_jobs.retain_mut(|pending| {
                let replaced = pending.render_plans.iter().any(|plan| match &plan.target {
                    NativeComputeGraphRenderTarget::SourceFrame { source_id, .. } => {
                        new_targets.iter().any(|target| target == source_id)
                    }
                    _ => false,
                });
                if replaced {
                    for buffer in pending.buffers.iter_mut() {
                        if buffer.persistent && !buffer.initial_bytes.is_empty() {
                            carried.push((
                                buffer.id.clone(),
                                buffer.byte_length as usize,
                                buffer.clear,
                                std::mem::take(&mut buffer.initial_bytes),
                            ));
                        }
                    }
                }
                !replaced
            });
            for (id, byte_length, clear, bytes) in carried {
                if let Some(buffer) = job.buffers.iter_mut().find(|buffer| buffer.id == id) {
                    if buffer.persistent
                        && buffer.initial_bytes.is_empty()
                        && buffer.byte_length as usize == byte_length
                    {
                        buffer.initial_bytes = bytes;
                        buffer.clear = buffer.clear || clear;
                    }
                }
            }
        }
        self.pending_native_graph_jobs.push(job);
        Ok(())
    }

    pub(crate) fn compute_graph(&mut self, params: &Value) -> Result<Value, String> {
        let Some(buffers_value) = params.get("buffers").and_then(Value::as_array) else {
            return Err("compute_graph requires buffers[]".to_string());
        };
        let Some(passes_value) = params.get("passes").and_then(Value::as_array) else {
            return Err("compute_graph requires passes[]".to_string());
        };
        self.upsert_compute_graph_textures(params)?;
        let mut buffer_specs = Vec::with_capacity(buffers_value.len());
        for buffer in buffers_value {
            buffer_specs.push(parse_compute_graph_buffer(buffer)?);
        }
        let buffer_kinds = buffer_specs
            .iter()
            .map(|buffer| (buffer.id.clone(), buffer.kind))
            .collect::<HashMap<_, _>>();
        let mut pass_plans = Vec::with_capacity(passes_value.len());
        for (index, pass) in passes_value.iter().enumerate() {
            pass_plans.push(self.compute_graph_pass_plan(pass, index, &buffer_kinds)?);
        }
        let render_plans = self.compute_graph_render_plans(params, &buffer_kinds)?;
        let render_targets = render_plans
            .iter()
            .map(|render| render.target.clone())
            .collect::<Vec<_>>();
        let readbacks = compute_graph_readbacks(params, &buffer_specs);
        let readback_bytes = readbacks
            .iter()
            .filter_map(|readback| {
                buffer_specs
                    .iter()
                    .find(|buffer| buffer.id == readback.id)
                    .map(|buffer| buffer.byte_length)
            })
            .fold(0u64, u64::saturating_add);
        let readback_count = readbacks.len() as u64;
        let pass_count = pass_plans.len() as u64;
        let render_pass_count = render_plans.len() as u64;
        let render_targets_for_stats = render_targets.clone();
        let render_targets_for_source_frames = render_targets;
        let native_graph_buffer_budget_bytes = self.native_graph_buffer_budget_bytes();
        let result = {
            let Some(renderer) = self.renderer.as_mut() else {
                return Err("native renderer has not created a wgpu device".to_string());
            };
            let mut result = renderer.run_native_compute_graph(
                buffer_specs,
                pass_plans,
                readbacks,
                render_plans,
            )?;
            let (evicted_buffers, evicted_bytes) = renderer
                .prune_native_compute_graph_buffers_to_budget(native_graph_buffer_budget_bytes);
            if evicted_buffers > 0 || evicted_bytes > 0 {
                self.stats.vram_evictions = self
                    .stats
                    .vram_evictions
                    .saturating_add(evicted_buffers as u64);
                self.stats.vram_evicted_bytes =
                    self.stats.vram_evicted_bytes.saturating_add(evicted_bytes);
                if let Some(object) = result.as_object_mut() {
                    object.insert("vram_evicted_buffers".to_string(), json!(evicted_buffers));
                    object.insert("vram_evicted_bytes".to_string(), json!(evicted_bytes));
                }
            }
            if let Some(object) = result.as_object_mut() {
                object.insert(
                    "persistent_buffer_bytes".to_string(),
                    json!(renderer.native_compute_graph_buffer_bytes()),
                );
                object.insert(
                    "persistent_buffer_budget_bytes".to_string(),
                    json!(native_graph_buffer_budget_bytes),
                );
            }
            self.stats.pipeline_cache_entries = renderer.native_pipeline_cache_count() as u64;
            self.stats.compute_graph_persistent_buffers =
                renderer.native_compute_graph_buffer_count() as u64;
            result
        };
        self.stats.compute_graph_runs = self.stats.compute_graph_runs.saturating_add(1);
        self.stats.compute_graph_passes =
            self.stats.compute_graph_passes.saturating_add(pass_count);
        self.stats.compute_graph_readbacks = self
            .stats
            .compute_graph_readbacks
            .saturating_add(readback_count);
        self.stats.compute_graph_readback_bytes = self
            .stats
            .compute_graph_readback_bytes
            .saturating_add(readback_bytes);
        if render_pass_count > 0 {
            self.stats.compute_graph_render_passes = self
                .stats
                .compute_graph_render_passes
                .saturating_add(render_pass_count);
            for render_target in render_targets_for_stats {
                match render_target {
                    NativeComputeGraphRenderTarget::SourceFrame { .. } => {
                        self.stats.compute_graph_source_frame_renders = self
                            .stats
                            .compute_graph_source_frame_renders
                            .saturating_add(1);
                    }
                    NativeComputeGraphRenderTarget::Snapshot => {
                        self.stats.compute_graph_snapshot_renders =
                            self.stats.compute_graph_snapshot_renders.saturating_add(1);
                    }
                    NativeComputeGraphRenderTarget::GraphTexture { .. } => {}
                    NativeComputeGraphRenderTarget::CompositeFrame { .. } => {
                        self.stats.compute_graph_source_frame_renders = self
                            .stats
                            .compute_graph_source_frame_renders
                            .saturating_add(1);
                    }
                }
            }
        }
        for render_target in render_targets_for_source_frames {
            if let NativeComputeGraphRenderTarget::SourceFrame {
                source_id,
                slot,
                seq,
            } = render_target
            {
                self.source_frames
                    .insert(source_id.clone(), SourceFrame::full(seq));
                for layer in self.scene_layers.values_mut() {
                    if layer.source_id.as_deref() == Some(source_id.as_str()) {
                        layer.frame_slot = Some(slot);
                        layer.source_rect = [0.0, 0.0, 1.0, 1.0];
                    }
                }
            }
        }
        Ok(result)
    }

    /// Create or resize the textures a graph declares. Done when the graph is
    /// parsed, not when it runs, so a queued job never meets a missing one.
    pub(crate) fn upsert_compute_graph_textures(&mut self, params: &Value) -> Result<Vec<NativeComputeGraphTextureSpec>, String> {
        let Some(textures) = params.get("textures").and_then(Value::as_array) else {
            return Ok(Vec::new());
        };
        let renderer = self
            .renderer
            .as_mut()
            .ok_or("graph textures require a ready renderer")?;
        let mut specs = Vec::with_capacity(textures.len());
        for value in textures {
            let spec = parse_compute_graph_texture(value)?;
            renderer.upsert_native_graph_texture(&spec)?;
            specs.push(spec);
        }
        Ok(specs)
    }

    pub(crate) fn graph_texture_format(&self, id: &str) -> Option<NativeGraphTextureFormat> {
        self.renderer
            .as_ref()
            .and_then(|renderer| renderer.native_graph_textures.spec(id))
            .map(|spec| spec.format)
    }

    pub(crate) fn compute_graph_render_plans(
        &mut self,
        params: &Value,
        buffer_kinds: &HashMap<String, NativeComputeBufferBindingKind>,
    ) -> Result<Vec<NativeComputeGraphRenderPlan>, String> {
        if let Some(renders_value) = params
            .get("render_passes")
            .or_else(|| params.get("renders"))
            .or_else(|| params.get("renderPlans"))
        {
            let Some(renders) = renders_value.as_array() else {
                return Err("compute_graph render_passes must be an array".to_string());
            };
            let mut plans = Vec::with_capacity(renders.len());
            for render in renders {
                plans.push(self.compute_graph_render_plan(render, buffer_kinds)?);
            }
            return Ok(plans);
        }

        params
            .get("render")
            .or_else(|| params.get("render_pass"))
            .map(|render| {
                self.compute_graph_render_plan(render, buffer_kinds)
                    .map(|plan| vec![plan])
            })
            .transpose()
            .map(|plans| plans.unwrap_or_default())
    }

    pub(crate) fn compute_graph_binding_spec(
        &mut self,
        binding: &Value,
        shader_id: &str,
        context: &str,
        buffer_kinds: &HashMap<String, NativeComputeBufferBindingKind>,
    ) -> Result<NativeComputeGraphBindingSpec, String> {
        let binding_number = number_at(binding, &["binding"])
            .ok_or_else(|| format!("compute_graph {context} `{shader_id}` binding missing number"))?
            .round()
            .clamp(0.0, u32::MAX as f64) as u32;
        let explicit_graph_kind = compute_graph_binding_kind_from_value(binding);
        match explicit_graph_kind {
            Some(NativeComputeGraphBindingKind::CompositeFrameTexture) => {
                // Composition FX read one layer of the full-resolution
                // composite ping-pong; the layer index rides in `slot`.
                let resource_id = string_at(binding, &["resource"])
                    .or_else(|| string_at(binding, &["resource_id"]))
                    .unwrap_or_else(|| "composite-frame".to_string());
                let index = number_at(binding, &["slot"])
                    .or_else(|| number_at(binding, &["index"]))
                    .unwrap_or(0.0)
                    .round()
                    .clamp(0.0, (COMPOSITE_FRAME_SLOTS - 1) as f64)
                    as usize;
                Ok(NativeComputeGraphBindingSpec {
                    binding: binding_number,
                    resource_id,
                    kind: NativeComputeGraphBindingKind::CompositeFrameTexture,
                    source_slot: Some(index),
                })
            }
            Some(
                kind @ (NativeComputeGraphBindingKind::GraphTexture
                | NativeComputeGraphBindingKind::GraphDepthTexture),
            ) => {
                let resource_id = string_at(binding, &["texture"])
                    .or_else(|| string_at(binding, &["texture_id"]))
                    .or_else(|| string_at(binding, &["resource"]))
                    .ok_or_else(|| {
                        format!(
                            "compute_graph {context} `{shader_id}` binding {binding_number} graph texture requires `texture`"
                        )
                    })?;
                let wants_depth = matches!(kind, NativeComputeGraphBindingKind::GraphDepthTexture);
                match graph_textures::check_binding(self.graph_texture_format(&resource_id), wants_depth) {
                    Ok(()) => {}
                    Err(graph_textures::BindingProblem::Undeclared) => {
                        return Err(format!(
                            "compute_graph {context} `{shader_id}` binding {binding_number} references undeclared texture `{resource_id}`"
                        ));
                    }
                    Err(graph_textures::BindingProblem::KindMismatch(format)) => {
                        return Err(format!(
                            "compute_graph {context} `{shader_id}` binding {binding_number}: texture `{resource_id}` is {format:?}, which does not match its `{}` binding",
                            kind.signature()
                        ));
                    }
                }
                Ok(NativeComputeGraphBindingSpec {
                    binding: binding_number,
                    resource_id,
                    kind,
                    source_slot: None,
                })
            }
            Some(NativeComputeGraphBindingKind::SourceFrameSampler) => {
                let resource_id = string_at(binding, &["resource"])
                    .or_else(|| string_at(binding, &["resource_id"]))
                    .unwrap_or_else(|| "source-frame-sampler".to_string());
                Ok(NativeComputeGraphBindingSpec {
                    binding: binding_number,
                    resource_id,
                    kind: NativeComputeGraphBindingKind::SourceFrameSampler,
                    source_slot: None,
                })
            }
            Some(NativeComputeGraphBindingKind::SourceFrameTexture(dimension)) => {
                let is_array = matches!(dimension, NativeComputeGraphTextureDimension::D2Array);
                let resource_id = if is_array {
                    string_at(binding, &["resource"])
                        .or_else(|| string_at(binding, &["resource_id"]))
                        .or_else(|| string_at(binding, &["source_id"]))
                        .unwrap_or_else(|| "source-frames".to_string())
                } else {
                    let source_id = string_at(binding, &["source_id"])
                        .or_else(|| string_at(binding, &["sourceId"]))
                        .or_else(|| string_at(binding, &["source_frame_id"]))
                        .or_else(|| string_at(binding, &["sourceFrameId"]))
                        .or_else(|| string_at(binding, &["resource"]))
                        .or_else(|| string_at(binding, &["resource_id"]));
                    let Some(source_id) = source_id else {
                        let allow_missing = bool_at(binding, &["allow_missing"])
                            .or_else(|| bool_at(binding, &["allowMissing"]))
                            .or_else(|| bool_at(binding, &["optional"]))
                            .unwrap_or(false);
                        if allow_missing {
                            let slot = self.ensure_empty_source_frame_slot();
                            return Ok(NativeComputeGraphBindingSpec {
                                binding: binding_number,
                                resource_id: EMPTY_SOURCE_FRAME_ID.to_string(),
                                kind: NativeComputeGraphBindingKind::SourceFrameTexture(dimension),
                                source_slot: Some(slot),
                            });
                        }
                        return Err(format!(
                            "compute_graph {context} `{shader_id}` binding {binding_number} source-frame texture requires source_id"
                        ));
                    };
                    source_id
                };
                let source_slot = if is_array {
                    None
                } else if let Some(layer_id) = resource_id.strip_prefix("shader-frame:") {
                    // Binds the layer's core-rendered shader frame explicitly,
                    // independent of what the layer currently DISPLAYS.
                    Some(
                        self.scene_layers
                            .get(layer_id)
                            .and_then(|layer| layer.shader_frame_slot)
                            .unwrap_or_else(|| self.ensure_empty_source_frame_slot()),
                    )
                } else if let Some(layer_id) = resource_id.strip_prefix("layer-frame:") {
                    // `layer-frame:<layer_id>` binds whatever frame that scene
                    // layer currently displays (video slot, rendered shader
                    // slot, …) without the sender knowing internal source ids.
                    // Used by the VJ crossfade to sample bank composites.
                    Some(
                        self.scene_layers
                            .get(layer_id)
                            .and_then(|layer| layer.frame_slot)
                            .unwrap_or_else(|| self.ensure_empty_source_frame_slot()),
                    )
                } else {
                    Some(match self.source_frame_slots.get(&resource_id).copied() {
                        Some(slot) => slot,
                        // Assign instead of failing: a missing slot here is
                        // either a frame produced later in this same job or a
                        // source that has not uploaded yet. Failing kills the
                        // whole template install (frozen layer, no retry);
                        // assigning binds the slot the frame will land in.
                        None => {
                            eprintln!(
                                "[GhostRenderCore] compute_graph {context} `{shader_id}` binding {binding_number} source-frame `{resource_id}` has no frame yet; assigning a slot"
                            );
                            self.assign_source_frame_slot(&resource_id)?
                        }
                    })
                };
                Ok(NativeComputeGraphBindingSpec {
                    binding: binding_number,
                    resource_id,
                    kind: NativeComputeGraphBindingKind::SourceFrameTexture(dimension),
                    source_slot,
                })
            }
            Some(NativeComputeGraphBindingKind::Buffer(kind)) => {
                let resource_id =
                    compute_graph_binding_resource_id(binding).ok_or_else(|| {
                        format!(
                            "compute_graph {context} `{shader_id}` binding {binding_number} missing resource"
                        )
                    })?;
                Ok(NativeComputeGraphBindingSpec {
                    binding: binding_number,
                    resource_id,
                    kind: NativeComputeGraphBindingKind::Buffer(kind),
                    source_slot: None,
                })
            }
            None => {
                let resource_id =
                    compute_graph_binding_resource_id(binding).ok_or_else(|| {
                        format!(
                            "compute_graph {context} `{shader_id}` binding {binding_number} missing resource"
                        )
                    })?;
                let default_kind = buffer_kinds
                    .get(&resource_id)
                    .copied()
                    .unwrap_or(NativeComputeBufferBindingKind::StorageReadWrite);
                let kind = compute_binding_kind_from_value(binding).unwrap_or(default_kind);
                Ok(NativeComputeGraphBindingSpec {
                    binding: binding_number,
                    resource_id,
                    kind: NativeComputeGraphBindingKind::Buffer(kind),
                    source_slot: None,
                })
            }
        }
    }

    pub(crate) fn compute_graph_pass_plan(
        &mut self,
        pass: &Value,
        index: usize,
        buffer_kinds: &HashMap<String, NativeComputeBufferBindingKind>,
    ) -> Result<NativeComputeGraphPassPlan, String> {
        let Some(shader_id) = string_at(pass, &["shader_id"]) else {
            return Err(format!("compute_graph pass {index} missing shader_id"));
        };
        let record = self
            .shader_registry
            .get(&shader_id)
            .cloned()
            .ok_or_else(|| {
                format!("compute graph shader `{shader_id}` has not been precompiled")
            })?;
        if NativeShaderSourceKind::from_label(&record.source_kind) != NativeShaderSourceKind::Wgsl {
            return Err(format!(
                "compute graph shader `{shader_id}` is {}, but compute graph passes require WGSL",
                record.source_kind
            ));
        }
        let source = self
            .shader_sources
            .get(&shader_id)
            .cloned()
            .ok_or_else(|| format!("compute graph shader source missing for `{shader_id}`"))?;
        let explicit_entry = string_at(pass, &["entry"]);
        let entry = if let Some(entry) = explicit_entry {
            if record
                .entry_points
                .iter()
                .any(|candidate| candidate == &entry)
            {
                entry
            } else {
                return Err(format!(
                    "shader `{shader_id}` has no compute entry `{entry}`"
                ));
            }
        } else {
            native_compute_entry(&record, source.as_ref())
                .ok_or_else(|| format!("shader `{shader_id}` is not a supported compute shader"))?
        };
        let Some(bindings_value) = pass.get("bindings").and_then(Value::as_array) else {
            return Err(format!(
                "compute_graph pass `{shader_id}` requires bindings[]"
            ));
        };
        let mut bindings = Vec::with_capacity(bindings_value.len());
        for binding in bindings_value {
            bindings.push(self.compute_graph_binding_spec(
                binding,
                shader_id.as_str(),
                "pass",
                buffer_kinds,
            )?);
        }
        bindings.sort_by_key(|binding| binding.binding);
        let dispatch = dispatch_from_value(pass);
        let layout_sig = bindings
            .iter()
            .map(|binding| format!("{}:{}", binding.binding, binding.kind.signature()))
            .collect::<Vec<_>>()
            .join(",");
        let name =
            string_at(pass, &["name"]).unwrap_or_else(|| format!("{shader_id}:{entry}:{index}"));
        Ok(NativeComputeGraphPassPlan {
            name,
            cache_key: format!(
                "graph:{shader_id}:{}:{entry}:{layout_sig}",
                record.source_hash
            ),
            source: source.clone(),
            entry,
            dispatch,
            bindings,
        })
    }

    pub(crate) fn compute_graph_render_plan(
        &mut self,
        render: &Value,
        buffer_kinds: &HashMap<String, NativeComputeBufferBindingKind>,
    ) -> Result<NativeComputeGraphRenderPlan, String> {
        let Some(shader_id) = string_at(render, &["shader_id"]) else {
            return Err("compute_graph render pass missing shader_id".to_string());
        };
        let record = self.shader_registry.get(&shader_id).ok_or_else(|| {
            format!("compute graph render shader `{shader_id}` has not been precompiled")
        })?;
        if NativeShaderSourceKind::from_label(&record.source_kind) != NativeShaderSourceKind::Wgsl {
            return Err(format!(
                "compute graph render shader `{shader_id}` is {}, but graph render passes require WGSL",
                record.source_kind
            ));
        }
        let source_hash = record.source_hash;
        let default_fragment_entry = record.entry.clone();
        let entry_points = record.entry_points.clone();
        let source = self
            .shader_sources
            .get(&shader_id)
            .cloned()
            .ok_or_else(|| {
                format!("compute graph render shader source missing for `{shader_id}`")
            })?;
        let vertex_entry =
            string_at(render, &["vertex_entry"]).unwrap_or_else(|| "vs_main".to_string());
        let fragment_entry = string_at(render, &["fragment_entry"])
            .or_else(|| string_at(render, &["entry"]))
            .unwrap_or(default_fragment_entry);
        if !entry_points.iter().any(|entry| entry == &vertex_entry) {
            return Err(format!(
                "shader `{shader_id}` has no graph render vertex entry `{vertex_entry}`"
            ));
        }
        if !entry_points.iter().any(|entry| entry == &fragment_entry) {
            return Err(format!(
                "shader `{shader_id}` has no graph render fragment entry `{fragment_entry}`"
            ));
        }
        let Some(bindings_value) = render.get("bindings").and_then(Value::as_array) else {
            return Err(format!(
                "compute_graph render pass `{shader_id}` requires bindings[]"
            ));
        };
        let mut bindings = Vec::with_capacity(bindings_value.len());
        for binding in bindings_value {
            bindings.push(self.compute_graph_binding_spec(
                binding,
                shader_id.as_str(),
                "render",
                buffer_kinds,
            )?);
        }
        bindings.sort_by_key(|binding| binding.binding);
        let layout_sig = bindings
            .iter()
            .map(|binding| format!("{}:{}", binding.binding, binding.kind.signature()))
            .collect::<Vec<_>>()
            .join(",");
        let name = string_at(render, &["name"]).unwrap_or_else(|| format!("{shader_id}:render"));
        let clear = bool_at(render, &["clear"]).unwrap_or(true);
        let include_snapshot = bool_at(render, &["include_snapshot"])
            .or_else(|| bool_at(render, &["snapshot"]))
            .unwrap_or(true);
        let generate_mips = bool_at(render, &["generate_mips"])
            .or_else(|| bool_at(render, &["generateMips"]))
            .or_else(|| bool_at(render, &["mips"]))
            // Default ON: sampling a scaled source frame without mips aliases
            // (and drifts from the WebGL/Three.js reference, which always mips).
            // Same-size blit passes opt out explicitly with generate_mips: false.
            .unwrap_or(true);
        let blend = string_at(render, &["blend"])
            .or_else(|| string_at(render, &["blend_mode"]))
            .or_else(|| string_at(render, &["blendMode"]))
            .map(|label| NativeComputeGraphRenderBlend::from_label(&label))
            .unwrap_or(NativeComputeGraphRenderBlend::Replace);
        let vertex_count = number_at(render, &["vertex_count"])
            .or_else(|| number_at(render, &["vertices"]))
            .or_else(|| number_at(render, &["draw_vertices"]))
            .unwrap_or(3.0)
            .round()
            .clamp(1.0, u32::MAX as f64) as u32;
        let instance_count = number_at(render, &["instance_count"])
            .or_else(|| number_at(render, &["instances"]))
            .or_else(|| number_at(render, &["draw_instances"]))
            .unwrap_or(1.0)
            .round()
            .clamp(1.0, u32::MAX as f64) as u32;
        let indirect_buffer_id = string_at(render, &["draw_indirect_buffer"])
            .or_else(|| string_at(render, &["indirect_buffer"]))
            .or_else(|| string_at(render, &["indirect_buffer_id"]))
            .or_else(|| string_at(render, &["drawIndirectBuffer"]))
            .or_else(|| string_at(render, &["indirectBuffer"]));
        if let Some(indirect_buffer_id) = indirect_buffer_id.as_ref() {
            if !buffer_kinds.contains_key(indirect_buffer_id) {
                return Err(format!(
                    "compute_graph render `{shader_id}` indirect draw references missing buffer `{indirect_buffer_id}`"
                ));
            }
        }
        let indirect_offset = number_at(render, &["draw_indirect_offset"])
            .or_else(|| number_at(render, &["indirect_offset"]))
            .or_else(|| number_at(render, &["indirectOffset"]))
            .unwrap_or(0.0)
            .round()
            .max(0.0) as u64;
        let clear_color = vec4_path_at(render, &["clear_color"])
            .or_else(|| vec4_path_at(render, &["clearColor"]))
            .or_else(|| vec4_path_at(render, &["clear_value"]))
            .or_else(|| vec4_path_at(render, &["clearValue"]))
            .map(|rgba| {
                [
                    rgba[0].clamp(-64.0, 64.0) as f64,
                    rgba[1].clamp(-64.0, 64.0) as f64,
                    rgba[2].clamp(-64.0, 64.0) as f64,
                    rgba[3].clamp(0.0, 1.0) as f64,
                ]
            })
            .unwrap_or([0.0, 0.0, 0.0, 1.0]);
        let depth_enabled = bool_at(render, &["depth"])
            .or_else(|| bool_at(render, &["depth_test"]))
            .or_else(|| bool_at(render, &["depthTest"]))
            .or_else(|| bool_at(render, &["depth_write"]))
            .or_else(|| bool_at(render, &["depthWrite"]))
            .unwrap_or(false);
        let depth_write = bool_at(render, &["depth_write"])
            .or_else(|| bool_at(render, &["depthWrite"]))
            .unwrap_or(depth_enabled);
        let depth_compare = string_at(render, &["depth_compare"])
            .or_else(|| string_at(render, &["depthCompare"]))
            .map(|label| NativeComputeGraphDepthCompare::from_label(&label))
            .unwrap_or(NativeComputeGraphDepthCompare::Less);
        // Resolved against the depth the pass ends up with (below): a pass
        // into a depth texture has depth without asking for it.
        let depth_load_requested = bool_at(render, &["depth_load"])
            .or_else(|| bool_at(render, &["depthLoad"]))
            .unwrap_or(false);
        let primitive_topology = string_at(render, &["primitive"])
            .or_else(|| string_at(render, &["topology"]))
            .or_else(|| string_at(render, &["primitive_topology"]))
            .or_else(|| string_at(render, &["primitiveTopology"]))
            .map(|label| NativeComputeGraphPrimitiveTopology::from_label(&label))
            .unwrap_or(NativeComputeGraphPrimitiveTopology::TriangleList);
        let target_label = string_at(render, &["target"])
            .or_else(|| string_at(render, &["target_type"]))
            .or_else(|| string_at(render, &["render_target"]))
            .unwrap_or_else(|| "snapshot".to_string());
        let target_key = target_label
            .trim()
            .to_ascii_lowercase()
            .replace('_', "-")
            .replace(' ', "-");
        let target = match target_key.as_str() {
            "snapshot" | "frame-snapshot" | "snapshot-texture" => {
                NativeComputeGraphRenderTarget::Snapshot
            }
            "composite" | "composite-frame" | "composite-texture" => {
                // number_at walks a NESTED path, so alternatives must be
                // chained rather than listed.
                let index = number_at(render, &["slot"])
                    .or_else(|| number_at(render, &["index"]))
                    .or_else(|| number_at(render, &["composite_index"]))
                    .unwrap_or(0.0)
                    .round()
                    .clamp(0.0, (COMPOSITE_FRAME_SLOTS - 1) as f64)
                    as usize;
                NativeComputeGraphRenderTarget::CompositeFrame { index }
            }
            "source" | "source-frame" | "source-texture" | "layer-source" => {
                let Some(source_id) = string_at(render, &["source_id"])
                    .or_else(|| string_at(render, &["sourceId"]))
                    .or_else(|| string_at(render, &["target_source_id"]))
                    .or_else(|| string_at(render, &["targetSourceId"]))
                else {
                    return Err(
                        "compute_graph render target `source_frame` requires source_id".to_string(),
                    );
                };
                let slot = self.assign_source_frame_slot(&source_id)?;
                let seq = number_at(render, &["seq"])
                    .or_else(|| number_at(render, &["frame_index"]))
                    .unwrap_or_else(|| self.stats.commands_applied.saturating_add(1) as f64)
                    .round()
                    .max(0.0) as u64;
                NativeComputeGraphRenderTarget::SourceFrame {
                    source_id,
                    slot,
                    seq,
                }
            }
            "texture" | "graph-texture" => {
                let Some(id) = string_at(render, &["texture"])
                    .or_else(|| string_at(render, &["texture_id"]))
                else {
                    return Err("compute_graph render target `texture` requires texture".to_string());
                };
                NativeComputeGraphRenderTarget::GraphTexture { id }
            }
            _ => {
                return Err(format!(
                    "compute_graph render target `{target_label}` is unsupported"
                ));
            }
        };
        let mut generate_mips = generate_mips;
        let graph_target = match &target {
            NativeComputeGraphRenderTarget::GraphTexture { id } => {
                generate_mips = false;
                Some(id.as_str())
            }
            _ => None,
        };
        let graph_textures::RenderDepth {
            enabled: depth_enabled,
            write: depth_write,
            depth_only,
            texture_id: depth_texture_id,
        } = graph_textures::resolve_render_depth(
            &shader_id,
            graph_target,
            string_at(render, &["depth_texture"]).or_else(|| string_at(render, &["depth_texture_id"])),
            depth_enabled,
            depth_write,
            |id| self.graph_texture_format(id),
        )?;
        let depth_load = graph_textures::resolve_depth_load(depth_load_requested, depth_enabled);
        Ok(NativeComputeGraphRenderPlan {
            name,
            cache_key: format!(
                "graph-render:{shader_id}:{}:{vertex_entry}:{fragment_entry}:{}:{}:{}:{}:{}:{layout_sig}",
                source_hash,
                blend.signature(),
                primitive_topology.signature(),
                if depth_only { "depthonly" } else if depth_enabled { "depth" } else { "nodepth" },
                if depth_write { "write" } else { "read" },
                depth_compare.signature()
            ),
            source,
            vertex_entry,
            fragment_entry,
            clear,
            include_snapshot,
            generate_mips,
            target,
            blend,
            vertex_count,
            instance_count,
            indirect_buffer_id,
            indirect_offset,
            clear_color,
            primitive_topology,
            depth_enabled,
            depth_write,
            depth_compare,
            depth_load,
            depth_texture_id,
            depth_only,
            bindings,
        })
    }
}
