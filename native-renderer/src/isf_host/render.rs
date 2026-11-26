//! Native shader frames on the GPU: WGSL frames, ISF multi-pass frames,
//! batched uniform rings and shader input copies.

use crate::*;

pub(crate) const NATIVE_SHADER_FULLSCREEN_VERTEX_WGSL: &str = r#"
struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

@vertex
fn vs_main(@builtin(vertex_index) vertex_index: u32) -> VertexOut {
  let pos = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -3.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>( 3.0,  1.0),
  );
  let p = pos[vertex_index];
  var out: VertexOut;
  out.position = vec4<f32>(p, 0.0, 1.0);
  out.uv = p * 0.5 + vec2<f32>(0.5);
  return out;
}
"#;

/// Uniform slices for single-pass shaders drawn in one batch: one buffer cut
/// into aligned slices, each with its own bind group, so every shader in a
/// frame can keep its own uniforms until the batch is submitted.
pub(crate) struct NativeShaderUniformRing {
    pub(crate) buffer: wgpu::Buffer,
    pub(crate) stride: u64,
    pub(crate) bind_groups: Vec<wgpu::BindGroup>,
}

/// Single-pass shader renders recorded into one encoder and submitted once
/// (see `RenderState::begin_native_shader_batch`).
pub(crate) struct NativeShaderBatch {
    pub(crate) encoder: wgpu::CommandEncoder,
    pub(crate) uniforms: Vec<u8>,
    pub(crate) used: usize,
    pub(crate) slots: Vec<usize>,
}

/// Shaders per batch before it is submitted and a new one begun.
pub(crate) const NATIVE_SHADER_BATCH_SLOTS: usize = 64;

impl RenderState {
    /// Reduced-resolution target for a quality tier below native.
    ///
    /// Rendering into a viewport-confined corner of the slot would leave the
    /// rest of mip 0 stale, and everything downstream samples the slot over the
    /// full 0..1 range. A separate smaller texture keeps that contract intact:
    /// the shader draws at reduced size, then one linear blit fills the slot
    /// completely. The blit is a single full-target draw of trivial work, which
    /// is far cheaper than the fragment shader it saves -- these shaders run
    /// 100+ raymarch steps per pixel.
    pub(crate) fn ensure_native_shader_scale_target(&mut self, size: u32) -> wgpu::TextureView {
        if self.native_shader_scale_size != size || self.native_shader_scale_texture.is_none() {
            let texture = self.device.create_texture(&wgpu::TextureDescriptor {
                label: Some("Ghost Render Core Native Shader Scale Target"),
                size: wgpu::Extent3d {
                    width: size,
                    height: size,
                    depth_or_array_layers: 1,
                },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: self.source_frame_format,
                usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
                view_formats: &[],
            });
            self.native_shader_scale_texture = Some(texture);
            self.native_shader_scale_size = size;
        }
        self.native_shader_scale_texture
            .as_ref()
            .expect("scale target just ensured")
            .create_view(&wgpu::TextureViewDescriptor::default())
    }

    pub(crate) fn render_native_wgsl_shader_frame(
        &mut self,
        slot: usize,
        cache_key: &str,
        source_kind: NativeShaderSourceKind,
        source: &str,
        fragment_entry: &str,
        uniforms: &NativeShaderUniforms,
        input_slots: &[usize],
        quality_scale: f32,
        frame_size: (u32, u32),
    ) -> Result<(), String> {
        self.ensure_native_shader_pipeline(cache_key, source_kind, source, fragment_entry)?;
        if self.native_shader_batch.as_ref().is_some_and(|batch| batch.used >= NATIVE_SHADER_BATCH_SLOTS) {
            self.flush_native_shader_batch();
        }
        // In a batch the uniforms go into this shader's own slice, uploaded
        // with the rest when the batch is submitted; alone they go straight
        // into the shared buffer as before.
        let mut batch = self.native_shader_batch.take();
        let ring_index = match batch.as_mut() {
            Some(batch) => {
                let stride = self.native_shader_ring.as_ref().map_or(0, |ring| ring.stride as usize);
                let index = batch.used;
                batch.used += 1;
                batch.uniforms.resize(batch.used * stride, 0);
                let bytes = bytemuck::bytes_of(uniforms);
                batch.uniforms[index * stride..index * stride + bytes.len()].copy_from_slice(bytes);
                Some(index)
            }
            None => {
                churn_probe::write_buffer(&self.queue, &self.native_shader_uniform_buffer, 0, bytemuck::bytes_of(uniforms));
                None
            }
        };
        let full_size = self.source_frame_size as u32;
        // Per-source slots take the layer's own size. Shared slots are all
        // one square, so there the size becomes a render scale instead.
        let per_source = self.slots.mode() == SourceFrameMode::PerSource;
        let (frame_w, frame_h) = (frame_size.0.clamp(1, full_size), frame_size.1.clamp(1, full_size));
        // Drawn at (at least) the size it is shown, the picture needs no mip
        // chain: building one was four more passes per shader per frame.
        let output = if per_source {
            self.slots.ensure(slot, frame_w, frame_h, false)
        } else {
            self.slots.ensure_generated(slot, full_size, full_size)
        };
        let footprint_scale = if per_source { 1.0 } else { frame_w.max(frame_h) as f32 / full_size as f32 };
        let safe_slot = self.slots.clamp_slot(slot);

        /*
         * Quality tier. Below native, the shader draws into a smaller target
         * and one linear blit expands it into the slot; at native it renders
         * straight into the slot as before, with no extra texture and no extra
         * pass. The saving is real because these shaders are fragment-bound --
         * a tier of 0.56 is a third of the pixels, and each pixel is a full
         * raymarch.
         *
         * Rounded to a multiple of 8 and floored at 128: a scale that lands on
         * an awkward size gains nothing and can miss tile alignment, and below
         * 128 the mip chain built from it is coarser than the mip levels the
         * slot expects.
         */
        let scale = (quality_scale.clamp(0.2, 1.0) * footprint_scale).clamp(0.05, 1.0);
        let full_size = output.width.min(output.height);
        let scaled_size = if scale >= 0.995 {
            full_size
        } else {
            (((full_size as f32 * scale) as u32) / 8 * 8).clamp(128, full_size)
        };
        let use_scaled = scaled_size < full_size;

        let slot_view = output.target_view("Ghost Render Core Native Shader Source Frame View", 0);
        let scale_view = if use_scaled {
            Some(self.ensure_native_shader_scale_target(scaled_size))
        } else {
            None
        };
        let view = scale_view.as_ref().unwrap_or(&slot_view);
        let mut own_encoder = batch.is_none().then(|| {
            self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("Ghost Render Core Native Shader Encoder"),
            })
        });
        let encoder = match (batch.as_mut(), own_encoder.as_mut()) {
            (Some(batch), _) => &mut batch.encoder,
            (None, Some(encoder)) => encoder,
            (None, None) => unreachable!("an encoder exists either way"),
        };
        self.encode_native_shader_input_copies(encoder, input_slots);
        {
            let Some(pipeline) = self.native_shader_pipelines.get(cache_key) else {
                self.native_shader_batch = batch;
                return Err("native shader pipeline was not cached".to_string());
            };
            let bind_group = match (ring_index, self.native_shader_ring.as_ref()) {
                (Some(index), Some(ring)) => &ring.bind_groups[index],
                _ => &self.native_shader_bind_group,
            };
            let pass_time = pass_timing::slot("native-shader");
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("Ghost Render Core Native Shader Pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                        store: wgpu::StoreOp::Store,
                    },
                    depth_slice: None,
                })],
                depth_stencil_attachment: None,
                timestamp_writes: pass_timing::render_writes(&pass_time),
                occlusion_query_set: None,
                multiview_mask: None,
            });
            pass.set_pipeline(&pipeline.pipeline);
            pass.set_bind_group(0, bind_group, &[]);
            pass.draw(0..3, 0..1);
        }
        if let Some(scale_view) = scale_view.as_ref() {
            /* Expand the reduced render into the slot so every downstream
               sampler still sees a fully populated mip 0 over 0..1. */
            self.source_frame_blitter
                .copy(&self.device, encoder, scale_view, &slot_view);
        }
        self.generate_source_frame_mips(encoder, safe_slot);
        match batch {
            Some(mut batch) => {
                batch.slots.push(safe_slot);
                self.native_shader_batch = Some(batch);
            }
            None => {
                if let Some(encoder) = own_encoder {
                    churn_probe::submit(&self.queue, Some(encoder.finish()));
                }
                self.mark_source_frame_slots_submitted([safe_slot]);
            }
        }
        self.last_frame_error = None;
        Ok(())
    }

    /// Record single-pass shader renders into one encoder from here until
    /// `finish_native_shader_batch`: one uniform upload and one submit for
    /// all of them instead of an encoder, a staging buffer and a submit each.
    pub(crate) fn begin_native_shader_batch(&mut self) {
        if self.native_shader_batch.is_some() {
            return;
        }
        if self.native_shader_ring.is_none() {
            let size = std::mem::size_of::<NativeShaderUniforms>() as u64;
            let align = self.device.limits().min_uniform_buffer_offset_alignment.max(1) as u64;
            let stride = size.div_ceil(align) * align;
            let buffer = self.device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("Ghost Render Core Native Shader Uniform Ring"),
                size: stride * NATIVE_SHADER_BATCH_SLOTS as u64,
                usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            });
            let bind_groups = (0..NATIVE_SHADER_BATCH_SLOTS)
                .map(|index| {
                    let mut entries = vec![
                        wgpu::BindGroupEntry {
                            binding: 0,
                            resource: wgpu::BindingResource::Buffer(wgpu::BufferBinding {
                                buffer: &buffer,
                                offset: index as u64 * stride,
                                size: std::num::NonZeroU64::new(size),
                            }),
                        },
                        wgpu::BindGroupEntry {
                            binding: 1,
                            resource: wgpu::BindingResource::TextureView(&self.native_shader_input_view),
                        },
                        wgpu::BindGroupEntry {
                            binding: 2,
                            resource: wgpu::BindingResource::Sampler(&self.source_frame_sampler),
                        },
                    ];
                    for binding in NATIVE_ISF_FIRST_EXTRA_BINDING..NATIVE_ISF_FIRST_EXTRA_BINDING + NATIVE_ISF_EXTRA_TEXTURE_BINDINGS {
                        entries.push(wgpu::BindGroupEntry {
                            binding,
                            resource: wgpu::BindingResource::TextureView(&self.isf_dummy_texture_view),
                        });
                    }
                    churn_probe::bind_group();
                    self.device.create_bind_group(&wgpu::BindGroupDescriptor {
                        label: Some("Ghost Render Core Native Shader Ring Bind Group"),
                        layout: &self.native_shader_bind_group_layout,
                        entries: &entries,
                    })
                })
                .collect();
            self.native_shader_ring = Some(NativeShaderUniformRing { buffer, stride, bind_groups });
        }
        self.native_shader_batch = Some(NativeShaderBatch {
            encoder: self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("Ghost Render Core Native Shader Batch Encoder"),
            }),
            uniforms: Vec::new(),
            used: 0,
            slots: Vec::new(),
        });
    }

    /// Upload the batch's uniforms and submit its renders.
    pub(crate) fn finish_native_shader_batch(&mut self) {
        let Some(batch) = self.native_shader_batch.take() else {
            return;
        };
        if batch.used == 0 {
            return;
        }
        if let Some(ring) = self.native_shader_ring.as_ref() {
            churn_probe::write_buffer(&self.queue, &ring.buffer, 0, &batch.uniforms);
        }
        churn_probe::submit(&self.queue, Some(batch.encoder.finish()));
        self.mark_source_frame_slots_submitted(batch.slots);
    }

    /// Submit what the batch holds and keep batching. Anything that submits
    /// its own work (a multi-pass shader) does this first, so it runs after
    /// the renders recorded before it.
    pub(crate) fn flush_native_shader_batch(&mut self) {
        if self.native_shader_batch.is_some() {
            self.finish_native_shader_batch();
            self.begin_native_shader_batch();
        }
    }

    /// Make sure the (kind, width) audio row exists and holds this frame's
    /// data. Uploads only when the content identity changed; the RGBA
    /// staging is a reused buffer, so steady-state audio allocates nothing.
    pub(crate) fn prepare_isf_audio_row(&mut self, kind: IsfAudioKind, width: u32, audio: &NativeIsfAudioFrame) {
        let width = width.clamp(1, isf_passes::ISF_AUDIO_MAX_WIDTH);
        let stamp = match audio.live {
            Some((_, _, seq)) => seq & !(1u64 << 63),
            None => {
                let mut hash = 0xcbf29ce484222325_u64 | (1u64 << 63);
                for value in [audio.bass, audio.mid, audio.high, audio.level, audio.time] {
                    hash = (hash ^ value.to_bits() as u64).wrapping_mul(0x100000001b3);
                }
                hash | (1u64 << 63)
            }
        };
        let device = &self.device;
        let row = self.isf_audio_rows.entry((kind, width)).or_insert_with(|| {
            let texture = device.create_texture(&wgpu::TextureDescriptor {
                label: Some(match kind {
                    IsfAudioKind::Fft => "Ghost Render Core ISF audioFFT Row",
                    IsfAudioKind::Waveform => "Ghost Render Core ISF audio Waveform Row",
                }),
                size: wgpu::Extent3d { width, height: 1, depth_or_array_layers: 1 },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: wgpu::TextureFormat::Rgba8Unorm,
                usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
                view_formats: &[],
            });
            let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
            NativeIsfAudioRow { texture, view, stamp: None }
        });
        if row.stamp == Some(stamp) {
            return;
        }
        let scratch = &mut self.isf_audio_scratch;
        scratch.clear();
        scratch.resize(width as usize * 4, 0);
        match audio.live {
            Some((fft, waveform, _)) => {
                let source = match kind {
                    IsfAudioKind::Fft => fft,
                    IsfAudioKind::Waveform => waveform,
                };
                fill_isf_audio_row(kind, source, scratch);
            }
            None => fill_isf_audio_row_from_bands(
                kind, audio.bass, audio.mid, audio.high, audio.level, audio.time, scratch,
            ),
        }
        self.queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &row.texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            scratch,
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(width * 4),
                rows_per_image: Some(1),
            },
            wgpu::Extent3d { width, height: 1, depth_or_array_layers: 1 },
        );
        row.stamp = Some(stamp);
    }

    pub(crate) fn native_shader_output_edge(&self, quality_scale: f32) -> u32 {
        let scale = quality_scale.clamp(0.2, 1.0);
        let full_size = self.source_frame_size as u32;
        if scale >= 0.995 {
            full_size
        } else {
            (((full_size as f32 * scale) as u32) / 8 * 8).clamp(128, full_size)
        }
    }

    /// Shader inputs are packed per draw: layer k of the shader-input array
    /// holds `input_slots[k]` (the layer's own input first, then each bound
    /// image), and the shader's image codes name those layers. A shader
    /// renders into a slot, so it reads these copies rather than the slots.
    pub(crate) fn encode_native_shader_input_copies(
        &self,
        encoder: &mut wgpu::CommandEncoder,
        input_slots: &[usize],
    ) {
        let edge = self.source_frame_size as u32;
        for (layer, slot) in input_slots.iter().copied().take(NATIVE_SHADER_INPUT_LAYERS).enumerate() {
            let source = self.slots.slot(slot);
            if self.slots.mode() == SourceFrameMode::Shared {
                encoder.copy_texture_to_texture(
                    source.copy_info(0),
                    wgpu::TexelCopyTextureInfo {
                        texture: &self.native_shader_input_texture,
                        mip_level: 0,
                        origin: wgpu::Origin3d { x: 0, y: 0, z: layer as u32 },
                        aspect: wgpu::TextureAspect::All,
                    },
                    wgpu::Extent3d { width: edge, height: edge, depth_or_array_layers: 1 },
                );
            } else {
                let target = gpu_object_cache::view(&self.native_shader_input_texture, &wgpu::TextureViewDescriptor {
                    label: Some("Ghost Render Core Native Shader Input Layer"),
                    dimension: Some(wgpu::TextureViewDimension::D2),
                    base_array_layer: layer as u32,
                    array_layer_count: Some(1),
                    ..Default::default()
                });
                let source_view = source.view("Ghost Render Core Native Shader Input Source", 0, 1);
                self.source_frame_blitter.copy(&self.device, encoder, &source_view, &target);
            }
        }
    }

    /// Drop multi-pass ISF buffers of layers that no longer render ISF.
    pub(crate) fn retain_isf_pass_states(&mut self, keep: impl Fn(&str) -> bool) {
        self.isf_pass_states.retain(|key, _| keep(key));
    }

    pub(crate) fn isf_pass_state_summary(&self) -> (usize, usize, u64) {
        let mut targets = 0usize;
        let mut bytes = 0u64;
        for state in self.isf_pass_states.values() {
            for target in state.targets.iter().flatten() {
                targets += 1;
                let texel = match target.format {
                    wgpu::TextureFormat::Rgba16Float => 8u64,
                    _ => 4u64,
                };
                bytes = bytes.saturating_add(2 * texel * target.width as u64 * target.height as u64);
            }
        }
        (self.isf_pass_states.len(), targets, bytes)
    }

    /// Render a pass-aware ISF shader: each PASSES entry in order, named
    /// targets ping-ponged so a pass can read the buffer it writes (feedback),
    /// persistent contents kept across frames until the shader or output
    /// geometry changes, and audio rows bound next to the pass targets. The
    /// output pass lands in `slot` exactly like the single-pass path.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn render_native_isf_pass_host_frame(
        &mut self,
        slot: usize,
        cache_key: &str,
        source_kind: NativeShaderSourceKind,
        source: &str,
        fragment_entry: &str,
        base_uniforms: &NativeShaderUniforms,
        job: &NativeIsfPassJob,
        input_slots: &[usize],
        quality_scale: f32,
        audio: &NativeIsfAudioFrame,
    ) -> Result<(), String> {
        const INTERMEDIATE_8BIT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba8Unorm;
        const INTERMEDIATE_FLOAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba16Float;
        let target_format = |float: bool| if float { INTERMEDIATE_FLOAT } else { INTERMEDIATE_8BIT };

        // Pipelines: the output format always, target formats as used.
        self.ensure_native_shader_pipeline(cache_key, source_kind, source, fragment_entry)?;
        let mut formats_needed = Vec::new();
        for pass in job.passes {
            if let Some(index) = pass.target
                && let Some(IsfJobTarget { float, .. }) = job.targets.get(index)
            {
                let format = target_format(*float);
                if !formats_needed.contains(&format) {
                    formats_needed.push(format);
                }
            }
        }
        for format in &formats_needed {
            let key = self.native_shader_pipeline_key_for_format(cache_key, *format);
            self.ensure_native_shader_pipeline_for_format(&key, source_kind, source, fragment_entry, *format)?;
        }
        // Re-mark the output pipeline: a variant reservation must not have
        // evicted it (they share this frame's epoch, but be explicit).
        if !self.native_shader_pipelines.contains_key(cache_key) {
            self.ensure_native_shader_pipeline(cache_key, source_kind, source, fragment_entry)?;
        }

        // Audio rows.
        if let Some(width) = job.fft_width {
            self.prepare_isf_audio_row(IsfAudioKind::Fft, width, audio);
        }
        if let Some(width) = job.waveform_width {
            self.prepare_isf_audio_row(IsfAudioKind::Waveform, width, audio);
        }

        let output_edge = self.native_shader_output_edge(quality_scale);
        let full_size = self.source_frame_size as u32;
        let use_scaled = output_edge < full_size;
        let base_w = base_uniforms.resolution_time[0].max(1.0);
        let base_h = base_uniforms.resolution_time[1].max(1.0);

        // Pass state: a signature change (shader/source, reload generation,
        // render size) drops every buffer. Output density (the quality tier)
        // is left out: the tier moves under load mid-show, and dropping state
        // then reset every running visual's clocks, springs and trails.
        // Render-sized targets still follow the density (they are rebuilt
        // below when their size changes); fixed-size ones never move.
        let mut signature = 0xcbf29ce484222325_u64;
        for value in [
            stable_hash64(cache_key),
            job.generation,
            base_w.to_bits() as u64,
            base_h.to_bits() as u64,
            job.passes.len() as u64,
            job.targets.len() as u64,
        ] {
            signature = (signature ^ value).wrapping_mul(0x100000001b3);
        }
        let (state_key, mut state) = match self.isf_pass_states.remove_entry(job.state_key) {
            Some((key, state)) if state.signature == signature => (key, state),
            _ => (
                job.state_key.to_string(),
                NativeIsfPassState {
                    signature,
                    targets: Vec::new(),
                    uniform_buffers: Vec::new(),
                },
            ),
        };
        state.targets.resize_with(job.targets.len(), || None);
        for (index, target) in job.targets.iter().enumerate() {
            let (virtual_w, virtual_h) = &target.size;
            let (float, fixed) = (&target.float, &target.fixed);
            // Persistent targets stay at full density; the rest follow the tier.
            let density = if target.persistent { full_size } else { output_edge };
            let (scaled_w, scaled_h) =
                isf_physical_target_size((*virtual_w, *virtual_h), (base_w, base_h), density);
            // A fixed-size target (a 1x1 clock, a 128x1 history) is the same
            // pixels at every density.
            let exact = |value: f32| (value.round() as u32).clamp(1, isf_passes::ISF_PASS_TARGET_MAX_EDGE);
            let width = if fixed.0 { exact(*virtual_w) } else { scaled_w };
            let height = if fixed.1 { exact(*virtual_h) } else { scaled_h };
            let format = target_format(*float);
            let fits = state.targets[index]
                .as_ref()
                .is_some_and(|target| target.width == width && target.height == height && target.format == format);
            if fits {
                continue;
            }
            // New textures are zero-initialised: a (re)created buffer starts
            // transparent black, which is the ISF reset state.
            let make = |label: &'static str| {
                self.device.create_texture(&wgpu::TextureDescriptor {
                    label: Some(label),
                    size: wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
                    mip_level_count: 1,
                    sample_count: 1,
                    dimension: wgpu::TextureDimension::D2,
                    format,
                    usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
                    view_formats: &[],
                })
            };
            let textures = [make("Ghost Render Core ISF Pass Target A"), make("Ghost Render Core ISF Pass Target B")];
            churn_probe::texture_view(); churn_probe::texture_view();
            let views = [
                textures[0].create_view(&wgpu::TextureViewDescriptor::default()),
                textures[1].create_view(&wgpu::TextureViewDescriptor::default()),
            ];
            state.targets[index] = Some(NativeIsfPassTarget { _textures: textures, views, front: 0, width, height, format });
        }
        let uniform_size = std::mem::size_of::<NativeShaderUniforms>() as u64;
        while state.uniform_buffers.len() < job.passes.len() {
            state.uniform_buffers.push(self.device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("Ghost Render Core ISF Pass Uniforms"),
                size: uniform_size,
                usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            }));
        }

        let mut pass_sizes = [[0.0f32; 4]; MAX_ISF_PASS_TARGETS / 2];
        for (index, IsfJobTarget { size: (w, h), .. }) in job.targets.iter().enumerate().take(MAX_ISF_PASS_TARGETS) {
            pass_sizes[index / 2][(index % 2) * 2] = *w;
            pass_sizes[index / 2][(index % 2) * 2 + 1] = *h;
        }
        let audio_info = [
            if audio.live.is_some() { 1.0 } else { 0.0 },
            job.fft_width.unwrap_or(0) as f32,
            job.waveform_width.unwrap_or(0) as f32,
            0.0,
        ];

        let edge = self.source_frame_size as u32;
        let output = self.slots.ensure_generated(slot, edge, edge);
        let safe_slot = self.slots.clamp_slot(slot);
        let slot_view = output.target_view("Ghost Render Core ISF Pass Host Output View", 0);
        let scale_view = if use_scaled { Some(self.ensure_native_shader_scale_target(output_edge)) } else { None };
        let output_view = scale_view.as_ref().unwrap_or(&slot_view);

        let mut encoder = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("Ghost Render Core ISF Pass Host Encoder"),
        });
        self.encode_native_shader_input_copies(&mut encoder, input_slots);

        let pass_count = job.passes.len();
        let mut output_written = false;
        for (pass_index, pass) in job.passes.iter().enumerate() {
            let is_last = pass_index + 1 == pass_count;
            let target_index = pass.target.filter(|index| *index < state.targets.len());
            if target_index.is_none() && !is_last {
                // Non-final output passes are overwritten by the last pass.
                continue;
            }
            let (pass_w, pass_h) = target_index
                .map(|index| job.targets[index].size)
                .unwrap_or((base_w, base_h));
            let mut uniforms = *base_uniforms;
            uniforms.resolution_time[0] = pass_w;
            uniforms.resolution_time[1] = pass_h;
            uniforms.isf_pass = [pass_index as f32, pass_count as f32, base_w, base_h];
            uniforms.isf_pass_sizes = pass_sizes;
            uniforms.isf_audio = audio_info;
            churn_probe::write_buffer(&self.queue, &state.uniform_buffers[pass_index], 0, bytemuck::bytes_of(&uniforms));

            let mut entries = Vec::with_capacity(3 + NATIVE_ISF_EXTRA_TEXTURE_BINDINGS as usize);
            entries.push(wgpu::BindGroupEntry {
                binding: 0,
                resource: state.uniform_buffers[pass_index].as_entire_binding(),
            });
            entries.push(wgpu::BindGroupEntry {
                binding: 1,
                resource: wgpu::BindingResource::TextureView(&self.native_shader_input_view),
            });
            entries.push(wgpu::BindGroupEntry {
                binding: 2,
                resource: wgpu::BindingResource::Sampler(&self.source_frame_sampler),
            });
            for index in 0..MAX_ISF_PASS_TARGETS {
                let view = state
                    .targets
                    .get(index)
                    .and_then(Option::as_ref)
                    .map(|target| &target.views[target.front])
                    .unwrap_or(&self.isf_dummy_texture_view);
                entries.push(wgpu::BindGroupEntry {
                    binding: NATIVE_ISF_FIRST_EXTRA_BINDING + index as u32,
                    resource: wgpu::BindingResource::TextureView(view),
                });
            }
            for (binding, kind, width) in [
                (NATIVE_ISF_AUDIO_FFT_BINDING, IsfAudioKind::Fft, job.fft_width),
                (NATIVE_ISF_AUDIO_WAVEFORM_BINDING, IsfAudioKind::Waveform, job.waveform_width),
            ] {
                let view = width
                    .and_then(|width| self.isf_audio_rows.get(&(kind, width.clamp(1, isf_passes::ISF_AUDIO_MAX_WIDTH))))
                    .map(|row| &row.view)
                    .unwrap_or(&self.isf_dummy_texture_view);
                entries.push(wgpu::BindGroupEntry {
                    binding,
                    resource: wgpu::BindingResource::TextureView(view),
                });
            }
            let bind_group = gpu_object_cache::bind_group(
                &self.device,
                Some("Ghost Render Core ISF Pass Bind Group"),
                &self.native_shader_bind_group_layout,
                &entries,
            );

            let (dest_view, pipeline_key) = match target_index {
                Some(index) => {
                    let target = state.targets[index].as_ref().expect("target allocated above");
                    (
                        &target.views[1 - target.front],
                        self.native_shader_pipeline_key_for_format(cache_key, target.format),
                    )
                }
                None => (output_view, cache_key.to_string()),
            };
            let Some(pipeline) = self.native_shader_pipelines.get(&pipeline_key) else {
                self.isf_pass_states.insert(state_key, state);
                return Err(format!("ISF pass {pass_index} pipeline was not cached"));
            };
            {
                let pass_time = pass_timing::slot("isf-pass");
                let mut render_pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                    label: Some("Ghost Render Core ISF Pass"),
                    color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                        view: dest_view,
                        resolve_target: None,
                        ops: wgpu::Operations {
                            load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                            store: wgpu::StoreOp::Store,
                        },
                        depth_slice: None,
                    })],
                    depth_stencil_attachment: None,
                    timestamp_writes: pass_timing::render_writes(&pass_time),
                    occlusion_query_set: None,
                    multiview_mask: None,
                });
                render_pass.set_pipeline(&pipeline.pipeline);
                render_pass.set_bind_group(0, &bind_group, &[]);
                render_pass.draw(0..3, 0..1);
            }
            match target_index {
                Some(index) => {
                    let target = state.targets[index].as_mut().expect("target allocated above");
                    target.front = 1 - target.front;
                    if is_last {
                        // The final pass wrote a named buffer: that buffer is
                        // the shader's output.
                        let front = &target.views[target.front];
                        self.source_frame_blitter.copy(&self.device, &mut encoder, front, output_view);
                        output_written = true;
                    }
                }
                None => output_written = true,
            }
        }
        if !output_written {
            // No pass rendered the output (every pass skipped): clear it
            // rather than show the previous owner's pixels.
            let _ = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("Ghost Render Core ISF Pass Host Clear"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: output_view,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                        store: wgpu::StoreOp::Store,
                    },
                    depth_slice: None,
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
                multiview_mask: None,
            });
        }
        if let Some(scale_view) = scale_view.as_ref() {
            self.source_frame_blitter.copy(&self.device, &mut encoder, scale_view, &slot_view);
        }
        self.generate_source_frame_mips(&mut encoder, safe_slot);
        churn_probe::submit(&self.queue, Some(encoder.finish()));
        self.isf_pass_states.insert(state_key, state);
        self.mark_source_frame_slots_submitted([safe_slot]);
        self.last_frame_error = None;
        Ok(())
    }
}
