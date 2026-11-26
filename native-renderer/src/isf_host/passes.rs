//! ISF passes and inputs, and the commands that bind shaders to layers and
//! render them.

use crate::*;

pub(crate) struct NativeIsfAudioRow {
    pub(crate) texture: wgpu::Texture,
    pub(crate) view: wgpu::TextureView,
    /// Identity of the uploaded content (spectrum seq, or a hash of the band
    /// fallback inputs) so an unchanged frame is not re-uploaded.
    pub(crate) stamp: Option<u64>,
}

pub(crate) struct NativeIsfPassTarget {
    /// Owned alongside the views so the pair lives exactly as long as the
    /// target does.
    pub(crate) _textures: [wgpu::Texture; 2],
    pub(crate) views: [wgpu::TextureView; 2],
    /// Index of the view holding the latest contents; passes read it and
    /// render into the other one, then swap.
    pub(crate) front: usize,
    pub(crate) width: u32,
    pub(crate) height: u32,
    pub(crate) format: wgpu::TextureFormat,
}

pub(crate) struct NativeIsfPassState {
    /// Shader identity + reload generation + output geometry. A change drops
    /// every target, which is how persistent buffers reset on reload/resize.
    pub(crate) signature: u64,
    pub(crate) targets: Vec<Option<NativeIsfPassTarget>>,
    pub(crate) uniform_buffers: Vec<wgpu::Buffer>,
}

/// The key a pass-aware shader's buffers live under: its output source id
/// without the trailing quality and size parts. Those change with the quality
/// tier (which moves under load mid-show); keyed on them, every tier change
/// started the shader again from empty buffers. A layer's own quality
/// override stays in the key: two layers showing the shader at different
/// qualities render it separately, and sharing one set of buffers stepped
/// them twice a frame.
pub(crate) fn isf_pass_state_key(source_id: &str, layer_quality: Option<f32>) -> String {
    let mut parts = source_id.rsplitn(3, ':');
    let size = parts.next();
    let quality = parts.next();
    match (size, quality, parts.next(), layer_quality) {
        (Some(size), Some(_), Some(rest), None) if size.contains('x') => format!("{rest}:state"),
        (Some(size), Some(_), Some(rest), Some(quality)) if size.contains('x') => {
            format!("{rest}:q{:08x}:state", quality.to_bits())
        }
        _ => source_id.to_string(),
    }
}

/// One pass target as this render needs it.
pub(crate) struct IsfJobTarget {
    /// Size in the shader's virtual pixels.
    pub(crate) size: (f32, f32),
    pub(crate) float: bool,
    /// Whether each side is a fixed number of pixels (no $WIDTH/$HEIGHT).
    pub(crate) fixed: (bool, bool),
    /// Read back next frame (feedback, clocks): kept at full density so a
    /// quality-tier change never rebuilds it and wipes what it holds.
    pub(crate) persistent: bool,
}

/// Per-render description of a pass-aware ISF shader, resolved by the core.
pub(crate) struct NativeIsfPassJob<'a> {
    pub(crate) state_key: &'a str,
    pub(crate) generation: u64,
    pub(crate) passes: &'a [isf_passes::IsfPassSpec],
    pub(crate) targets: Vec<IsfJobTarget>,
    pub(crate) fft_width: Option<u32>,
    pub(crate) waveform_width: Option<u32>,
}

/// Audio data for this render: the live analyser spectrum when one is
/// flowing, otherwise the band levels the fallback rows are built from.
pub(crate) struct NativeIsfAudioFrame<'a> {
    pub(crate) live: Option<(&'a [f32], &'a [f32], u64)>,
    pub(crate) bass: f32,
    pub(crate) mid: f32,
    pub(crate) high: f32,
    pub(crate) level: f32,
    pub(crate) time: f32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum NativeIsfInputKind {
    Float,
    Bool,
    Long,
    Point2D,
    Color,
    Event,
    Image,
    /// ISF `audioFFT`: a 1-row texture of spectrum magnitudes 0..1.
    AudioFft,
    /// ISF `audio`: a 1-row texture of waveform samples mapped to 0..1.
    AudioWaveform,
    Unsupported,
}

#[derive(Clone, Debug)]
pub(crate) struct NativeIsfInputBinding {
    pub(crate) name: String,
    pub(crate) kind: NativeIsfInputKind,
    pub(crate) offset: Option<usize>,
    pub(crate) components: usize,
    pub(crate) default_values: [f32; 4],
    /// Audio row width (the input's MAX); 0 for non-audio inputs.
    pub(crate) audio_width: u32,
}

impl App {
    pub(crate) fn apply_bind_isf_shader(&mut self, command: &Value) {
        let Some(layer_id) = string_at(command, &["layer_id"]) else {
            return;
        };
        let Some(shader_id) = string_at(command, &["shader_id"]) else {
            return;
        };
        self.isf_layer_bindings
            .insert(layer_id.clone(), shader_id.clone());
        self.isf_shader_use_tick += 1;
        self.isf_shader_last_used.insert(shader_id.clone(), self.isf_shader_use_tick);
        let input_source_id = string_at(command, &["input_source_id"])
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| EMPTY_SOURCE_FRAME_ID.to_string());
        let input_slot = if input_source_id == EMPTY_SOURCE_FRAME_ID {
            self.ensure_empty_source_frame_slot()
        } else {
            self.source_frame_slots
                .get(&input_source_id)
                .copied()
                .unwrap_or_else(|| self.ensure_empty_source_frame_slot())
        };
        let entry = self
            .scene_layers
            .entry(layer_id.clone())
            .or_insert_with(|| SceneLayer::new(layer_id, 0));
        entry.shader_id = Some(shader_id);
        entry.shader_rendered = false;
        // `bind_isf_shader` describes the shader's INPUT, so it must not steal
        // the display binding when that display is a core-generated effect
        // chain output. Under an effect-pass route the layer displays
        // `effect-pass:<layer>` while the shader renders underneath as the
        // chain's input; resetting source_id to the empty frame here sent the
        // layer back to its raw shader frame, so every layer effect rendered
        // but was never shown. Narrow on purpose: a shader layer with no
        // effect route still rebinds exactly as before.
        let effect_output_displayed = entry
            .source_id
            .as_deref()
            .is_some_and(|source_id| source_id.starts_with("effect-pass:"));
        if input_source_id != EMPTY_SOURCE_FRAME_ID || !effect_output_displayed {
            entry.source_id = Some(input_source_id);
            entry.frame_slot = Some(input_slot);
        }
    }

    pub(crate) fn resolve_isf_image_source_slot(&self, source_id: &str) -> Option<usize> {
        let trimmed = source_id.trim();
        if trimmed.is_empty() {
            return None;
        }
        if let Some(layer_id) = trimmed.strip_prefix("layer-frame:") {
            return self
                .scene_layers
                .get(layer_id)
                .and_then(|layer| layer.frame_slot.or(layer.shader_frame_slot));
        }
        if let Some(layer_id) = trimmed.strip_prefix("shader-frame:") {
            return self
                .scene_layers
                .get(layer_id)
                .and_then(|layer| layer.shader_frame_slot.or(layer.frame_slot));
        }
        self.source_frame_slots.get(trimmed).copied()
    }

    /// Anchor a shader's TIME: `time_seconds` now (or, on the export clock,
    /// at `clock_time_seconds`), running at `rate` unless `paused`.
    /// `enabled: false` hands it back to the render clock.
    pub(crate) fn apply_isf_time_anchor(&mut self, command: &Value) {
        let Some(shader_id) = string_at(command, &["shader_id"]) else { return; };
        if bool_at(command, &["enabled"]) == Some(false) {
            self.isf_time_anchors.remove(&shader_id);
            return;
        }
        let Some(time) = number_at(command, &["time_seconds"]).filter(|time| time.is_finite()) else { return; };
        // Anchors run on the unwrapped clock: the wrapped shader clock jumps
        // back every SHADER_CLOCK_WRAP_SECONDS and would jump a clip's TIME.
        let now = self.native_clock_seconds();
        let clock = if self.render_clock_mode == "manual" {
            number_at(command, &["clock_time_seconds"]).filter(|clock| clock.is_finite()).unwrap_or(now)
        } else {
            now
        };
        let rate = number_at(command, &["rate"]).filter(|rate| rate.is_finite()).unwrap_or(1.0).clamp(-16.0, 16.0);
        let paused = bool_at(command, &["paused"]).unwrap_or(false);
        if self.isf_time_anchors.len() >= 4096 && !self.isf_time_anchors.contains_key(&shader_id) {
            self.isf_time_anchors.clear();
        }
        self.isf_time_anchors.insert(shader_id, IsfTimeAnchor { time: time.max(0.0), clock, rate, paused });
    }

    pub(crate) fn apply_isf_uniforms(&mut self, command: &Value) {
        let Some(shader_id) = string_at(command, &["shader_id"]) else {
            return;
        };
        let floats = command.get("float_inputs").unwrap_or(&Value::Null);
        let points = command.get("point_inputs").unwrap_or(&Value::Null);
        let colors = command.get("color_inputs").unwrap_or(&Value::Null);
        let input_count = json_object_len(floats)
            .saturating_add(json_object_len(points))
            .saturating_add(json_object_len(colors))
            .min(u32::MAX as usize) as u32;
        let audio = GhostAudioUniforms::from_isf_command(command);
        let input_bindings = self
            .shader_isf_inputs
            .get(&shader_id)
            .cloned()
            .unwrap_or_default();
        let input_params = native_isf_input_params(command, &input_bindings);
        // Image inputs arrive as source-id strings. Store (offset, id) pairs;
        // the render path resolves them to live source-frame slots so LRU
        // churn between the uniforms push and the render can't go stale.
        let image_inputs = command.get("image_inputs");
        let mut image_sources = Vec::new();
        for binding in &input_bindings {
            if !matches!(binding.kind, NativeIsfInputKind::Image) {
                continue;
            }
            let Some(offset) = binding.offset else {
                continue;
            };
            let Some(source_id) = image_inputs
                .and_then(|images| images.get(&binding.name))
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
            else {
                continue;
            };
            image_sources.push((offset, source_id.to_string()));
        }
        let state = IsfUniformState {
            time: number_at(command, &["time"])
                .unwrap_or(0.0)
                .clamp(0.0, 1.0e9) as f32,
            time_delta: number_at(command, &["time_delta"])
                .unwrap_or(1.0 / self.target_fps.max(1) as f64)
                .clamp(0.0, 10.0) as f32,
            frame_index: number_at(command, &["frame_index"])
                .unwrap_or(0.0)
                .round()
                .clamp(0.0, u64::MAX as f64) as u64,
            render_width: number_at(command, &["render_width"])
                .unwrap_or(self.pending_width as f64)
                .clamp(1.0, 65536.0) as f32,
            render_height: number_at(command, &["render_height"])
                .unwrap_or(self.pending_height as f64)
                .clamp(1.0, 65536.0) as f32,
            date: vec4_at(command, "date"),
            audio0: audio.audio0,
            audio1: audio.audio1,
            audio2: audio.audio2,
            float_hash: stable_hash64(&floats.to_string()),
            point_hash: stable_hash64(&points.to_string()),
            color_hash: stable_hash64(&colors.to_string()),
            input_count: input_count.max(input_bindings.len().min(u32::MAX as usize) as u32),
            input_params,
            image_sources,
            seq: self.stats.commands_applied,
        };
        self.isf_uniforms.insert(shader_id, state);
    }

    pub(crate) fn render_bound_isf_layers(&mut self) {
        // Free multi-pass buffers of layers that stopped rendering ISF.
        if let Some(renderer) = self.renderer.as_mut() {
            let bindings = &self.isf_layer_bindings;
            let layers = &self.scene_layers;
            renderer.retain_isf_pass_states(|key| {
                bindings.contains_key(key)
                    || layers.get(key).is_some_and(|layer| layer.shader_id.is_some())
                    || layers.values().any(|layer| {
                        layer.shader_source_id.as_deref() == Some(key)
                            || layer
                                .shader_source_id
                                .as_deref()
                                .map(|source_id| isf_pass_state_key(source_id, layer.render_quality))
                                .as_deref()
                                == Some(key)
                    })
            });
        }
        if self.isf_layer_bindings.is_empty() {
            self.isf_shader_first_frame.clear();
            return;
        }
        // The export clock counts 0, 1, 2... while the live one counts every
        // submitted frame: a first frame taken on one clock is meaningless on
        // the other (an export would see FRAMEINDEX 0 on every frame).
        let manual_clock = self.render_clock_mode == "manual";
        if manual_clock != self.isf_first_frame_manual_clock {
            self.isf_first_frame_manual_clock = manual_clock;
            self.isf_shader_first_frame.clear();
        }
        let time = self.native_graph_time_seconds();
        let frame_index = self.native_frame_index();
        let frame_delta = self.native_frame_delta();
        let shader_ids = self
            .isf_layer_bindings
            .values()
            .cloned()
            .collect::<HashSet<_>>();
        self.isf_shader_use_tick += 1;
        // A shader that stopped rendering starts counting again when it returns.
        self.isf_shader_first_frame.retain(|id, _| shader_ids.contains(id));
        for shader_id in shader_ids {
            let origin = self.isf_shader_first_frame.entry(shader_id.clone()).or_default();
            let shader_frame_index = isf_frame_index_since(origin, frame_index);
            if let Some(used) = self.isf_shader_last_used.get_mut(&shader_id) {
                *used = self.isf_shader_use_tick;
            }
            let shader_time = self.isf_time_anchors.get(&shader_id).map_or(time, |anchor| shader_clock_seconds(anchor.time_at(self.native_clock_seconds())));
            if let Some(state) = self.isf_uniforms.get_mut(&shader_id) {
                state.time = shader_time;
                state.time_delta = frame_delta;
                state.frame_index = shader_frame_index;
                state.audio0 = self.audio0;
                state.audio1 = self.audio1;
                state.audio2 = self.audio2;
                state.seq = self.stats.gpu_frames_submitted;
            }
        }
        let current_frame = self.native_frame_index();
        self.isf_frame_outputs.retain(|_, (_, frame)| *frame == current_frame);
        let mut layer_ids = self.isf_layer_bindings.keys().cloned().collect::<Vec<_>>();
        // A fixed order: when layers share one render, the same layer draws
        // it (and steps its pass buffers) every frame.
        layer_ids.sort_unstable();
        // Layers that will share a render draw it at the largest size any
        // of them needs (see `isf_shared_footprints`).
        self.isf_shared_footprints.clear();
        let max_edge = self.renderer.as_ref().map_or(1024, |renderer| renderer.source_frame_size as u32);
        for layer_id in &layer_ids {
            if let Some((key, size)) = self.isf_share_key(layer_id, max_edge) {
                let entry = self.isf_shared_footprints.entry(key).or_insert(size);
                *entry = (entry.0.max(size.0), entry.1.max(size.1));
            }
        }
        // One encoder and one submit for all single-pass shaders this frame.
        let async_compile = self.render_clock_mode != "manual";
        if let Some(renderer) = self.renderer.as_mut() {
            renderer.begin_native_shader_batch();
            renderer.shader_async_compile = async_compile;
        }
        for layer_id in layer_ids {
            self.apply_render_isf_to_layer(&json!({ "layer_id": layer_id }));
        }
        if let Some(renderer) = self.renderer.as_mut() {
            renderer.shader_async_compile = false;
            renderer.finish_native_shader_batch();
        }
    }

    /// What a single-pass shader layer's render is shared by, and the size
    /// the layer alone would need: the same shader, source, input picture
    /// and quality give the same picture at any size, so layers with the
    /// same key draw one render (`isf_shared_footprints`). None for layers
    /// that do not render a single-pass shader.
    pub(crate) fn isf_share_key(&self, layer_id: &str, max_edge: u32) -> Option<(String, (u32, u32))> {
        let shader_id = self.isf_layer_bindings.get(layer_id).cloned().or_else(|| {
            self.scene_layers.get(layer_id).and_then(|layer| layer.shader_id.clone())
        })?;
        if self.shader_isf_hosts.contains_key(&shader_id) {
            return None;
        }
        let record = self.shader_registry.get(&shader_id)?;
        let layer = self.scene_layers.get(layer_id);
        let input_source_slot = layer
            .and_then(|layer| {
                layer
                    .source_id
                    .as_deref()
                    .and_then(|source_id| self.source_frame_slots.get(source_id).copied())
                    .or(layer.frame_slot)
            })
            .unwrap_or(0);
        let quality = layer
            .and_then(|layer| layer.render_quality)
            .unwrap_or(self.native_quality.quality_scale);
        Some((
            isf_share_key_for(&shader_id, record.source_hash, input_source_slot, quality),
            self.layer_render_footprint(layer_id, max_edge),
        ))
    }

    /// The pixels a layer covers on the composite, for sizing what is
    /// rendered for it: the bounding box of its corners (stretched by a mesh
    /// warp that reaches past them), with a quarter more for Screens that show
    /// it in finer detail, rounded up to 128 pixels and kept between 256 and
    /// `max_edge`. Rounding keeps a drag from reallocating every frame.
    pub(crate) fn layer_render_footprint(&self, layer_id: &str, max_edge: u32) -> (u32, u32) {
        let Some(layer) = self.scene_layers.get(layer_id) else {
            return (max_edge, max_edge);
        };
        layer_render_footprint_for(layer, self.pending_width, self.pending_height, max_edge)
    }

    /// How much of the full decode size a video needs: the largest share of
    /// the composite that a layer showing it covers, with the same headroom
    /// as shaders, in coarse steps so resizing a layer rarely restarts its
    /// decoder. Twenty videos on twenty small slices decoded twenty full
    /// frames each and ran out of the decoder memory budget, so each one
    /// played at a few frames a second. A video no layer shows directly (an
    /// effect input, a splat texture) decodes in full.
    pub(crate) fn video_decode_scale(&self, source_id: &str) -> f32 {
        video_decode_scale_for_layers(
            self.scene_layers
                .values()
                .filter(|layer| layer.source_id.as_deref() == Some(source_id)),
        )
    }

    pub(crate) fn apply_render_isf_to_layer(&mut self, command: &Value) {
        let Some(layer_id) = string_at(command, &["layer_id"]) else {
            return;
        };
        let shader_id = self.isf_layer_bindings.get(&layer_id).cloned().or_else(|| {
            self.scene_layers
                .get(&layer_id)
                .and_then(|layer| layer.shader_id.clone())
        });
        let Some(shader_id) = shader_id else {
            return;
        };
        let uniform_state = self.isf_uniforms.get(&shader_id).cloned();
        let has_declared_isf_inputs = self
            .shader_isf_inputs
            .get(&shader_id)
            .map(|bindings| bindings.iter().any(|binding| binding.offset.is_some()))
            .unwrap_or(false);
        let mut params = uniform_state
            .as_ref()
            .map(|uniforms| {
                if has_declared_isf_inputs {
                    uniforms.declared_input_params()
                } else {
                    uniforms.native_params(&shader_id)
                }
            })
            .unwrap_or_else(default_native_isf_params);
        let input_source_slot = self
            .scene_layers
            .get(&layer_id)
            .and_then(|layer| {
                layer
                    .source_id
                    .as_deref()
                    .and_then(|source_id| self.source_frame_slots.get(source_id).copied())
                    .or(layer.frame_slot)
            })
            .unwrap_or(0);
        // The shader reads its inputs from the shader-input array, packed in
        // this order: its own input in layer 0, then each bound image. Image
        // codes name those layers (1-based; 0 = none).
        let mut image_input_slots: Vec<usize> = vec![input_source_slot];
        if let Some(uniforms) = uniform_state.as_ref() {
            for (offset, source_id) in &uniforms.image_sources {
                let layer = self.resolve_isf_image_source_slot(source_id).and_then(|slot| {
                    match image_input_slots.iter().position(|bound| *bound == slot) {
                        Some(layer) => Some(layer),
                        None if image_input_slots.len() < NATIVE_SHADER_INPUT_LAYERS => {
                            image_input_slots.push(slot);
                            Some(image_input_slots.len() - 1)
                        }
                        None => None,
                    }
                });
                if let Some(value) = params.get_mut(*offset) {
                    *value = layer.map(|layer| (layer + 1) as f32).unwrap_or(0.0);
                }
            }
        }
        let shader_uniforms = NativeShaderUniforms::from_isf(
            &shader_id,
            uniform_state.as_ref(),
            self.pending_width,
            self.pending_height,
            params,
            // Layer 0 of the packed shader inputs.
            0,
        );
        let seq = uniform_state
            .as_ref()
            .map(|uniforms| uniforms.seq)
            .unwrap_or(self.stats.commands_applied);
        let native_shader = self.shader_registry.get(&shader_id).and_then(|record| {
            let source = self.shader_sources.get(&shader_id)?;
            native_fragment_entry(record, source).map(|entry| {
                let pipeline_key = native_shader_pipeline_key(record, &shader_id, &entry);
                (
                    source.clone(),
                    NativeShaderSourceKind::from_label(&record.source_kind),
                    entry,
                    record.source_hash,
                    pipeline_key,
                )
            })
        });
        let mut rendered_frame_slot = None;
        let mut shader_output_source_id = None;
        if let Some((source, source_kind, fragment_entry, source_hash, pipeline_key)) =
            native_shader
        {
            let quality_scale_for_key = self
                .scene_layers
                .get(&layer_id)
                .and_then(|layer| layer.render_quality)
                .unwrap_or(self.native_quality.quality_scale);
            // A single-pass shader draws at the size its layer covers on the
            // composite, not at the full source-frame size: a slice that is a
            // sixteenth of the stage no longer renders a full 2–3K frame every
            // frame. Multi-pass shaders keep their targets as authored.
            let max_edge = self.renderer.as_ref().map_or(1024, |renderer| renderer.source_frame_size as u32);
            let frame_size = if self.shader_isf_hosts.contains_key(&shader_id) {
                (max_edge, max_edge)
            } else {
                let own = self.layer_render_footprint(&layer_id, max_edge);
                let key = isf_share_key_for(&shader_id, source_hash, input_source_slot, quality_scale_for_key);
                self.isf_shared_footprints.get(&key).copied().unwrap_or(own)
            };
            // Same shader, same input picture, same quality, same size: the
            // output is identical, so it is rendered once per frame and shared.
            let source_id = format!(
                "native-shader:{shader_id}:{source_hash:016x}:{input_source_slot}:{:08x}:{}x{}",
                quality_scale_for_key.to_bits(),
                frame_size.0,
                frame_size.1,
            );
            // A shader that reads no image (a generator) gets no input copies:
            // they were a full-size copy per shader per frame.
            let reads_inputs = *self
                .shader_reads_inputs
                .entry(source_hash)
                .or_insert_with(|| native_shader_reads_inputs(&source));
            let copy_slots: &[usize] = if reads_inputs { &image_input_slots } else { &[] };
            // Free the frame this layer drew before (another clip, an edited
            // shader) first, so the new render reuses a free slot instead of
            // displacing another layer's.
            self.release_layer_shader_output(&layer_id, Some(&source_id));
            let frame_now = self.native_frame_index();
            let already = self.isf_frame_outputs.get(&source_id)
                .filter(|(slot, frame)| *frame == frame_now && self.source_frame_slots.get(&source_id) == Some(slot))
                .map(|(slot, _)| *slot);
            let slot = match already {
                Some(slot) => slot,
                None => match self.assign_source_frame_slot(&source_id) {
                    Ok(slot) => slot,
                    Err(error) => { self.last_shader_error = Some(error); return; }
                },
            };
            shader_output_source_id = Some(source_id.clone());
            if already.is_some() {
                rendered_frame_slot = Some(slot);
            } else {
            /* The quality tier finally reaches the renderer. quality_scale has
               been maintained and reported in status since this was written and
               never applied to anything, so every tier rendered identically.
               A per-layer override, when set, wins outright over the tier
               rather than multiplying with it: two independent scales that
               compound would make "50% on a layer" mean something different on
               every global setting. */
            let quality_scale = self
                .scene_layers
                .get(&layer_id)
                .and_then(|layer| layer.render_quality)
                .unwrap_or(self.native_quality.quality_scale);
            let layer_quality_override = self.scene_layers.get(&layer_id).and_then(|layer| layer.render_quality);
            let pass_host = self.shader_isf_hosts.get(&shader_id).cloned();
            let target_sizes = pass_host
                .as_ref()
                .map(|(host, _)| {
                    let bindings = self.shader_isf_inputs.get(&shader_id);
                    let input_value = |name: &str| -> Option<f64> {
                        let binding = bindings?.iter().find(|binding| binding.name == name)?;
                        let offset = binding.offset?;
                        params.get(offset).map(|value| *value as f64)
                    };
                    let render_w = shader_uniforms.resolution_time[0];
                    let render_h = shader_uniforms.resolution_time[1];
                    host.plan
                        .targets
                        .iter()
                        .map(|target| {
                            IsfJobTarget {
                                size: resolve_isf_target_size(target, render_w, render_h, &input_value),
                                float: target.float,
                                fixed: isf_target_fixed_sides(target),
                                persistent: target.persistent,
                            }
                        })
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            // An offline render's frame can take longer than the live
            // staleness window: its spectrum is this frame's, by definition.
            let spectrum_live = if self.render_clock_mode == "manual" {
                self.isf_audio_spectrum.active
            } else {
                self.isf_audio_spectrum.is_live(Instant::now())
            };
            let spectrum = &self.isf_audio_spectrum;
            match self.renderer.as_mut() {
                Some(renderer) => {
                    let result = if let Some((host, generation)) = pass_host.as_ref() {
                        let passes = host.plan.effective_passes();
                        let state_key = isf_pass_state_key(&source_id, layer_quality_override);
                        let job = NativeIsfPassJob {
                            state_key: &state_key,
                            generation: *generation,
                            passes: &passes,
                            targets: target_sizes,
                            fft_width: host.fft_width,
                            waveform_width: host.waveform_width,
                        };
                        let audio = NativeIsfAudioFrame {
                            live: spectrum_live.then(|| {
                                (spectrum.fft.as_slice(), spectrum.waveform.as_slice(), spectrum.seq)
                            }),
                            bass: shader_uniforms.audio0[1],
                            mid: shader_uniforms.audio0[2],
                            high: shader_uniforms.audio1[0],
                            level: shader_uniforms.audio0[0],
                            time: shader_uniforms.resolution_time[2],
                        };
                        self.isf_multipass_renders = self.isf_multipass_renders.saturating_add(1);
                        // It submits on its own: run the batched renders first.
                        renderer.flush_native_shader_batch();
                        renderer.render_native_isf_pass_host_frame(
                            slot,
                            &pipeline_key,
                            source_kind,
                            &source,
                            &fragment_entry,
                            &shader_uniforms,
                            &job,
                            copy_slots,
                            quality_scale,
                            &audio,
                        )
                    } else {
                        renderer.render_native_wgsl_shader_frame(
                            slot,
                            &pipeline_key,
                            source_kind,
                            &source,
                            &fragment_entry,
                            &shader_uniforms,
                            copy_slots,
                            quality_scale,
                            frame_size,
                        )
                    };
                    match result {
                        Ok(()) => {
                            self.source_frames.insert(source_id.clone(), SourceFrame::full(seq));
                            self.stats.pipeline_cache_entries =
                                renderer.native_shader_pipeline_count() as u64;
                            rendered_frame_slot = Some(slot);
                            // FRAMEINDEX starts counting from this frame.
                            if let Some(origin) = self.isf_shader_first_frame.get_mut(&shader_id) {
                                origin.rendered = true;
                            }
                            self.last_shader_error = None;
                        }
                        // A pipeline still building is not an error: the layer comes in when it lands.
                        Err(err) if err.starts_with("native pipeline is warming") => {}
                        Err(err) => {
                            self.last_shader_error = Some(format!("{shader_id}: {err}"));
                        }
                    }
                }
                None => {
                    self.last_shader_error = Some("native renderer is not ready".to_string());
                }
            }
            if let Some(slot) = rendered_frame_slot {
                self.isf_frame_outputs.insert(source_id.clone(), (slot, frame_now));
            }
            }
        } else {
            self.release_layer_shader_output(&layer_id, None);
        }
        let entry = self
            .scene_layers
            .entry(layer_id.clone())
            .or_insert_with(|| SceneLayer::new(layer_id, 0));
        entry.shader_id = Some(shader_id);
        entry.shader_source_id = shader_output_source_id;
        entry.shader_rendered = rendered_frame_slot.is_some();
        entry.source_kind = if rendered_frame_slot.is_some() {
            NATIVE_SHADER_SOURCE_KIND
        } else {
            0.0
        };
        entry.shader_frame_slot = rendered_frame_slot;
        // Claim the display slot only when no other source owns it — a bound
        // effect-pass output (or any generated/media source with frames)
        // must keep displaying while the shader renders underneath as input.
        let display_claimed = entry
            .source_id
            .as_deref()
            .filter(|source_id| *source_id != EMPTY_SOURCE_FRAME_ID)
            .is_some_and(|source_id| self.source_frame_slots.contains_key(source_id));
        if !display_claimed {
            entry.frame_slot = rendered_frame_slot;
        }
        entry.preview_slot = None;
        entry.native_params.copy_from_slice(&params[..8]);
        if entry.color[3] <= 0.0 {
            entry.color = [0.45, 0.92, 1.0, 0.88];
        }
        // The new shader has drawn: it replaces the held picture.
        let shows_shader = entry.shader_rendered && entry.frame_slot == entry.shader_frame_slot;
        let held_layer = (shows_shader && entry.held.is_some()).then(|| entry.id.clone());
        self.stats.native_shader_renders = self.stats.native_shader_renders.saturating_add(1);
        if let Some(layer_id) = held_layer {
            self.end_layer_hold(&layer_id);
        }
    }

    pub(crate) fn apply_effect_chain(&mut self, command: &Value) {
        let Some(layer_id) = string_at(command, &["layer_id"]) else {
            return;
        };
        let entry = self
            .scene_layers
            .entry(layer_id.clone())
            .or_insert_with(|| SceneLayer::new(layer_id, 0));
        entry.effects = [[0.0; 4]; 4];
        entry.effect_count = 0.0;
        let Some(ids) = command.get("effect_ids").and_then(Value::as_array) else {
            return;
        };
        let mut write_index = 0usize;
        for value in ids.iter().filter_map(Value::as_str) {
            if write_index >= entry.effects.len() {
                break;
            }
            if let Some(effect) = effect_descriptor_code(value) {
                entry.effects[write_index] = effect;
                write_index += 1;
                entry.effect_count += 1.0;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn isf_pass_state_survives_quality_and_size_changes() {
        use super::isf_pass_state_key as key;
        let a = key("native-shader:music-voice:L1:0:VX-Nebula.fs:abc:00000000000000ff:0:3f400000:1024x1024", None);
        let b = key("native-shader:music-voice:L1:0:VX-Nebula.fs:abc:00000000000000ff:0:3f800000:2048x2048", None);
        assert_eq!(a, b);
        assert_ne!(a, key("native-shader:music-voice:L1:1:VX-Nebula.fs:abc:00000000000000ff:0:3f800000:2048x2048", None));
        // Anything not in the output id's shape is its own key.
        assert_eq!(key("layer-7", None), "layer-7");
    }

    #[test]
    fn isf_pass_state_is_separate_per_layer_quality_override() {
        use super::isf_pass_state_key as key;
        let half = "native-shader:trails.fs:00000000000000ff:0:3f000000:2048x2048";
        let full = "native-shader:trails.fs:00000000000000ff:0:3f800000:2048x2048";
        // Two layers at different overrides keep their own buffers...
        assert_ne!(key(half, Some(0.5)), key(full, Some(1.0)));
        // ...and neither shares the buffers of a layer following the tier.
        assert_ne!(key(half, Some(0.5)), key(full, None));
        // An override keeps its buffers when the output size changes.
        assert_eq!(
            key(half, Some(0.5)),
            key("native-shader:trails.fs:00000000000000ff:0:3f000000:1024x1024", Some(0.5)),
        );
    }

    #[test]
    fn a_shader_on_a_cropped_piece_renders_the_whole_picture_at_the_detail_it_shows() {
        use super::{SceneLayer, isf_share_key_for, layer_render_footprint_for};
        let piece = |corners: [[f32; 2]; 4], crop: [f32; 4]| {
            let mut layer = SceneLayer::new("piece".to_string(), 0);
            layer.corners = corners;
            layer.uv0 = crop;
            layer
        };
        let small = [[0.0, 0.0], [0.1, 0.0], [0.1, 0.1], [0.0, 0.1]];
        // An uncropped cube face a tenth of the output: drawn at its own size.
        assert_eq!(layer_render_footprint_for(&piece(small, [0.0, 0.0, 1.0, 1.0]), 1920, 1080, 1024), (256, 256));
        // The same face showing its tenth of a picture spread over the
        // stage: the whole picture, at the detail of that tenth.
        assert_eq!(layer_render_footprint_for(&piece(small, [0.3, 0.6, 0.1, 0.1]), 1920, 1080, 1024), (1024, 1024));
        // Half the picture on a quarter-width piece: twice its width.
        let quarter = [[0.0, 0.0], [0.25, 0.0], [0.25, 0.25], [0.0, 0.25]];
        assert_eq!(layer_render_footprint_for(&piece(quarter, [0.0, 0.0, 0.5, 1.0]), 1920, 1080, 4096), (1280, 384));
        // Sizes are not part of the share key: one render serves every size.
        assert_eq!(isf_share_key_for("s", 7, 0, 1.0), isf_share_key_for("s", 7, 0, 1.0));
        assert_ne!(isf_share_key_for("s", 7, 0, 1.0), isf_share_key_for("s", 7, 3, 1.0));
        assert_ne!(isf_share_key_for("s", 7, 0, 1.0), isf_share_key_for("s", 7, 0, 0.5));
    }
}
