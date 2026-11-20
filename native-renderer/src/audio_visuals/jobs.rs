//! Per-frame graph jobs for Strands and Cloud Pulse. Both are core-owned:
//! the app installs the layer with `set_native_graph_layer` and the core
//! builds the job every frame from the params, the latest audio packet and
//! the instrument's small CPU state (launched shapes / waves).

use crate::compute_graph::{
    NativeComputeBufferBindingKind, NativeComputeGraphBufferSpec, NativeComputeGraphPassPlan,
    NativeComputeGraphRenderBlend, NativeComputeGraphRenderTarget,
};
use crate::{App, NativeGraphFrameJob, NativeGraphLayer, NativeGraphLayerState, SourceFrame};

use std::sync::Arc;

use super::cloud_pulse::{WaveQueue, cloud_uniform, normalize_cloud_pulse_params};
use super::ply_reader::{CLOUD_POINT_BYTES, CloudLoad};
use super::cloud_pulse::cloud_view_uniform;
use super::depth_lights::{DepthSlices, normalize_depth_light_params};
use super::flock::{FLOCK_POINT_BYTES, FlockState, normalize_flock_params};
use super::shaders::{DEPTH_LIGHTS_DRAW, FLOCK_DRAW, FLOCK_SIM};
use super::hdr_post::{accumulation_size, buffer_binding, plan_hdr_post, render_plan, uniform_spec};
use super::shaders::{CLOUD_PULSE_DRAW, STRANDS_DRAW, STRANDS_SIM, core_shader};
use super::strands::{STRANDS_PARTICLE_BYTES, ShapeQueue, normalize_strands_params, strands_uniform};

#[derive(Clone, Debug, Default)]
pub struct StrandsState {
    /// The last real frame step. A repeat render of the same frame (dt 0)
    /// must redraw exactly what that frame drew, trails included.
    pub post_dt: f32,
    pub queue: ShapeQueue,
    pub particle_count: u32,
    pub frame: u64,
    pub prev_frame_time: f32,
}

/// The three instruments drawn from a point cloud file.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CloudInstrument {
    Pulse,
    Flock,
    DepthLights,
}

impl CloudInstrument {
    fn prefix(self) -> &'static str {
        match self {
            Self::Pulse => "cloud-pulse",
            Self::Flock => "cloud-flock",
            Self::DepthLights => "depth-lights",
        }
    }
}

/// State of a cloud instrument layer (Cloud Pulse, Cloud Flock, Depth Lights).
#[derive(Clone, Debug, Default)]
pub struct CloudPulseState {
    pub flock: FlockState,
    pub slices: DepthSlices,
    /// The last real frame step. A repeat render of the same frame (dt 0)
    /// must redraw exactly what that frame drew, trails included.
    pub post_dt: f32,
    pub waves: WaveQueue,
    /// The cloud being read (or read) for this layer.
    pub load: Option<Arc<CloudLoad>>,
    pub frame: u64,
    pub prev_frame_time: f32,
}

impl App {
    fn audio_visual_step(&self, prev_frame_time: f32, time: f32) -> f32 {
        let dt = if self.render_clock_mode == "manual" {
            self.native_graph_step_delta_this_render
        } else if prev_frame_time <= 0.0 {
            1.0 / self.target_fps.max(1) as f32
        } else {
            time - prev_frame_time
        };
        dt.clamp(0.0, 1.0 / 15.0)
    }

    fn audio_visual_output(&mut self, source_id: &str) -> Result<NativeComputeGraphRenderTarget, String> {
        let output_slot = self.assign_source_frame_slot(source_id)?;
        let seq = self.native_frame_index();
        self.source_frames.insert(source_id.to_string(), SourceFrame::full(seq));
        for layer in self.scene_layers.values_mut() {
            if layer.source_id.as_deref() == Some(source_id) {
                layer.frame_slot = Some(output_slot);
            }
        }
        Ok(NativeComputeGraphRenderTarget::SourceFrame { source_id: source_id.to_string(), slot: output_slot, seq })
    }

    fn audio_visual_buffer(&self, prefix: &str) -> NativeComputeGraphBufferSpec {
        let bytes = self.audio_visual.gpu_bytes();
        NativeComputeGraphBufferSpec {
            id: format!("{prefix}:audio"),
            byte_length: bytes.len() as u64,
            kind: NativeComputeBufferBindingKind::StorageRead,
            initial_bytes: bytes,
            persistent: true,
            clear: false,
            indirect: false,
        }
    }

    pub(crate) fn build_native_strands_graph_job(
        &mut self,
        graph_layer: &NativeGraphLayer,
    ) -> Result<(NativeGraphLayerState, NativeGraphFrameJob), String> {
        let params = normalize_strands_params(&graph_layer.params);
        let time = self.native_graph_time_seconds();
        let prefix = format!("strands:{}", crate::native_graph_buffer_safe_id(&graph_layer.source_id));
        let particle_id = format!("{prefix}:particles:{}", params.particle_count);
        // A missing particle buffer means a new layer, a lost device or an
        // offline render starting (it drops graph buffers): start the shapes
        // afresh too, so a render never inherits live hits.
        let buffer_missing = self
            .renderer
            .as_ref()
            .is_none_or(|renderer| !renderer.native_compute_graph_buffers.contains_key(&particle_id));
        let mut state = graph_layer.strands_state.clone();
        let reset = state.particle_count != params.particle_count || buffer_missing;
        if reset {
            state = StrandsState { particle_count: params.particle_count, ..StrandsState::default() };
        }
        let dt = self.audio_visual_step(state.prev_frame_time, time);
        state.prev_frame_time = time;
        // A repeat render of the same frame (dt 0: the core's own pacing
        // loop during an offline render) must not advance anything.
        if dt > 0.0 {
            state.frame = state.frame.wrapping_add(1);
            state.post_dt = dt;
        }
        let post_dt = if dt > 0.0 { dt } else { state.post_dt };
        let (width, height) = accumulation_size(self.pending_width, self.pending_height, params.accum_scale);
        let aspect = width as f32 / height as f32;
        state.queue.ingest(&self.audio_visual, time, params.mode, aspect, params.size);
        state.queue.step(time);

        let uniform_id = format!("{prefix}:uniform");
        let audio = self.audio_visual_buffer(&prefix);
        let audio_id = audio.id.clone();
        let mut buffers = vec![
            NativeComputeGraphBufferSpec {
                id: particle_id.clone(),
                byte_length: u64::from(params.particle_count) * STRANDS_PARTICLE_BYTES,
                kind: NativeComputeBufferBindingKind::StorageReadWrite,
                // Zeroed = every particle dead, waiting for a hit.
                initial_bytes: Vec::new(),
                persistent: true,
                clear: reset,
                indirect: false,
            },
            uniform_spec(
                uniform_id.clone(),
                &strands_uniform(&params, &state.queue, &self.audio_visual, width, height, time, dt, state.frame),
            ),
            audio,
        ];

        let sim = core_shader(STRANDS_SIM);
        let sim_bindings = vec![
            buffer_binding(0, &particle_id, NativeComputeBufferBindingKind::StorageReadWrite),
            buffer_binding(1, &uniform_id, NativeComputeBufferBindingKind::Uniform),
            buffer_binding(2, &audio_id, NativeComputeBufferBindingKind::StorageRead),
        ];
        let sim_layout = crate::native_graph_binding_layout_signature(&sim_bindings);
        let pass_plans = vec![NativeComputeGraphPassPlan {
            name: format!("{prefix}:sim"),
            cache_key: format!("graph:{}:{}:cs_main:{sim_layout}", sim.id, sim.hash),
            source: sim.source.clone(),
            entry: "cs_main".to_string(),
            dispatch: [params.particle_count.div_ceil(64).max(1), 1, 1],
            bindings: sim_bindings,
        }];

        let output = self.audio_visual_output(&graph_layer.source_id)?;
        let post = plan_hdr_post(
            &prefix,
            width,
            height,
            state.frame % 2 == 1,
            &params.post,
            post_dt,
            time,
            state.frame,
            output,
        );
        buffers.extend(post.buffers);
        let draw = core_shader(STRANDS_DRAW);
        let mut render_plans = Vec::with_capacity(post.finish.len() + 2);
        render_plans.push(post.feedback);
        render_plans.push(render_plan(
            format!("{prefix}:streaks"),
            draw,
            "vs_streak",
            "fs_streak",
            NativeComputeGraphRenderTarget::GraphTexture { id: post.scene_id.clone() },
            false,
            NativeComputeGraphRenderBlend::Add,
            6,
            params.particle_count,
            vec![
                buffer_binding(0, &particle_id, NativeComputeBufferBindingKind::StorageRead),
                buffer_binding(1, &uniform_id, NativeComputeBufferBindingKind::Uniform),
            ],
        ));
        render_plans.extend(post.finish);
        Ok((
            NativeGraphLayerState::Strands(state),
            NativeGraphFrameJob {
                textures: post.textures,
                buffers,
                pass_plans,
                render_plans,
                readback_buffer_ids: Vec::new(),
            },
        ))
    }

    pub(crate) fn build_native_cloud_graph_job(
        &mut self,
        graph_layer: &NativeGraphLayer,
        instrument: CloudInstrument,
    ) -> Result<(NativeGraphLayerState, NativeGraphFrameJob), String> {
        let mut params = normalize_cloud_pulse_params(&graph_layer.params);
        if params.path.is_empty() {
            return Err(format!("{} needs a point cloud file", instrument.prefix()));
        }
        let mut state = graph_layer.cloud_pulse_state.clone();
        // A new file or budget starts a new read; the old one is dropped (its
        // worker finishes and frees it).
        if state.load.as_ref().is_none_or(|load| load.path != params.path || load.max_points != params.max_points) {
            state = CloudPulseState { load: Some(CloudLoad::start(params.path.clone(), params.max_points)), ..CloudPulseState::default() };
        }
        let points = match state.load.as_ref().map(|load| load.ready()) {
            Some(Ok(Some(points))) => points,
            Some(Ok(None)) => {
                // Still reading: keep the state (and its load) for next frame.
                return Ok((
                    NativeGraphLayerState::CloudPulse(state),
                    NativeGraphFrameJob {
                        textures: Vec::new(),
                        buffers: Vec::new(),
                        pass_plans: Vec::new(),
                        render_plans: Vec::new(),
                        readback_buffer_ids: Vec::new(),
                    },
                ));
            }
            Some(Err(err)) => return Err(format!("{} could not read the cloud: {err}", instrument.prefix())),
            None => unreachable!("a load was just started"),
        };
        let time = self.native_graph_time_seconds();
        let prefix = format!("{}:{}", instrument.prefix(), crate::native_graph_buffer_safe_id(&graph_layer.source_id));
        let home_id = format!("{prefix}:points:{}", points.count);
        let home_missing = self
            .renderer
            .as_ref()
            .is_none_or(|renderer| !renderer.native_compute_graph_buffers.contains_key(&home_id));
        if home_missing {
            // A new cloud, a lost device or an offline render starting.
            state.waves = WaveQueue::default();
            state.flock = FlockState::default();
            state.slices = DepthSlices::default();
            state.frame = 0;
            state.prev_frame_time = 0.0;
        }
        let dt = self.audio_visual_step(state.prev_frame_time, time);
        state.prev_frame_time = time;
        if dt > 0.0 {
            state.frame = state.frame.wrapping_add(1);
            state.post_dt = dt;
        }
        let post_dt = if dt > 0.0 { dt } else { state.post_dt };
        let uniform_id = format!("{prefix}:uniform");
        let point_count = points.count;
        let home_bytes = if home_missing { points.bytes.clone() } else { Vec::new() };
        let (width, height) = accumulation_size(self.pending_width, self.pending_height, params.accum_scale);
        let drawn = point_count;
        let flock_id = format!("{prefix}:flock:{point_count}");
        let mut pass_plans = Vec::new();
        let mut extra_buffers = Vec::new();
        let (uniform, draw, vertex_entry, third_binding) = match instrument {
            CloudInstrument::Pulse => {
                state.waves.ingest(&self.audio_visual, time, params.band_mask);
                state.waves.step(&params, time);
                let u = cloud_uniform(&params, &state.waves, &self.audio_visual, width, height, drawn, time);
                (u, core_shader(CLOUD_PULSE_DRAW), "vs_point", None)
            }
            CloudInstrument::Flock => {
                let flock_params = normalize_flock_params(&graph_layer.params);
                state.flock.ingest(&self.audio_visual, time, &flock_params);
                state.flock.step(time, &flock_params);
                let block = state.flock.block(&self.audio_visual, time, dt, &flock_params);
                // The draw shader reads "displacement" as the speed that reads hot.
                params.displacement = flock_params.heat;
                let u = cloud_view_uniform(&params, &self.audio_visual, width, height, drawn, time, 0.0, &block);
                let flock_missing = self
                    .renderer
                    .as_ref()
                    .is_none_or(|renderer| !renderer.native_compute_graph_buffers.contains_key(&flock_id));
                extra_buffers.push(NativeComputeGraphBufferSpec {
                    id: flock_id.clone(),
                    byte_length: u64::from(point_count) * FLOCK_POINT_BYTES,
                    kind: NativeComputeBufferBindingKind::StorageReadWrite,
                    // Zeroed = every point unplaced; the shader puts it at rest.
                    initial_bytes: Vec::new(),
                    persistent: true,
                    clear: home_missing || flock_missing,
                    indirect: false,
                });
                let sim = core_shader(FLOCK_SIM);
                let bindings = vec![
                    buffer_binding(0, &home_id, NativeComputeBufferBindingKind::StorageRead),
                    buffer_binding(1, &uniform_id, NativeComputeBufferBindingKind::Uniform),
                    buffer_binding(2, &flock_id, NativeComputeBufferBindingKind::StorageReadWrite),
                ];
                let layout = crate::native_graph_binding_layout_signature(&bindings);
                pass_plans.push(NativeComputeGraphPassPlan {
                    name: format!("{prefix}:flock"),
                    cache_key: format!("graph:{}:{}:cs_flock:{layout}", sim.id, sim.hash),
                    source: sim.source.clone(),
                    entry: "cs_flock".to_string(),
                    dispatch: [point_count.div_ceil(64).max(1), 1, 1],
                    bindings,
                });
                (u, core_shader(FLOCK_DRAW), "vs_flock", Some(flock_id.clone()))
            }
            CloudInstrument::DepthLights => {
                let depth_params = normalize_depth_light_params(&graph_layer.params);
                state.slices.step(&self.audio_visual, dt, &depth_params);
                // Slow drift: the orbit turns, and the camera sways up and down.
                params.pitch += depth_params.sway.to_radians() * (time * 0.11).sin();
                // The shader reads "twinkle" as the share of points that are lights.
                params.twinkle = depth_params.light_share;
                let reach = 0.6 * params.scale;
                let block = state.slices.block(params.distance - reach, params.distance + reach, &depth_params);
                let u = cloud_view_uniform(&params, &self.audio_visual, width, height, drawn, time, 0.0, &block);
                (u, core_shader(DEPTH_LIGHTS_DRAW), "vs_depth", None)
            }
        };
        let audio = self.audio_visual_buffer(&prefix);
        let audio_id = audio.id.clone();
        let mut buffers = vec![
            NativeComputeGraphBufferSpec {
                id: home_id.clone(),
                byte_length: u64::from(point_count) * CLOUD_POINT_BYTES,
                kind: NativeComputeBufferBindingKind::StorageRead,
                initial_bytes: home_bytes,
                persistent: true,
                clear: home_missing,
                indirect: false,
            },
            uniform_spec(uniform_id.clone(), &uniform),
            audio,
        ];
        buffers.extend(extra_buffers);
        let output = self.audio_visual_output(&graph_layer.source_id)?;
        let post = plan_hdr_post(&prefix, width, height, state.frame % 2 == 1, &params.post, post_dt, time, state.frame, output);
        buffers.extend(post.buffers);
        let mut render_plans = Vec::with_capacity(post.finish.len() + 2);
        render_plans.push(post.feedback);
        render_plans.push(render_plan(
            format!("{prefix}:points"),
            draw,
            vertex_entry,
            "fs_point",
            NativeComputeGraphRenderTarget::GraphTexture { id: post.scene_id.clone() },
            false,
            NativeComputeGraphRenderBlend::Add,
            6,
            drawn,
            vec![
                buffer_binding(0, &home_id, NativeComputeBufferBindingKind::StorageRead),
                buffer_binding(1, &uniform_id, NativeComputeBufferBindingKind::Uniform),
                match third_binding.as_deref() {
                    Some(flock) => buffer_binding(2, flock, NativeComputeBufferBindingKind::StorageRead),
                    None => buffer_binding(2, &audio_id, NativeComputeBufferBindingKind::StorageRead),
                },
            ],
        ));
        render_plans.extend(post.finish);
        Ok((
            NativeGraphLayerState::CloudPulse(state),
            NativeGraphFrameJob {
                textures: post.textures,
                buffers,
                pass_plans,
                render_plans,
                readback_buffer_ids: Vec::new(),
            },
        ))
    }
}
