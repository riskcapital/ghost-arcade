//! Per-frame graph jobs for the second set of audio-reactive instruments:
//! Ribbon Field, Shockwave Rings, Fluid Ink, Lightning Arcs, Spectral
//! Terrain and Mesh Shatter. Like `jobs.rs`, every one is core-owned: each
//! instrument's CPU side is a pure frame function in its own module (params,
//! conditioned audio, state machine, uniform), and this file only turns its
//! result into buffers, passes and draws.
//!
//! The repeat-render rule holds throughout: during an offline render the core
//! re-renders a frame with dt 0. State only advances, and compute or solver
//! passes only run, when the instrument's step is > 0 (Freeze holds it at 0
//! too); the post chain reuses the last real dt.

use std::sync::Arc;

use crate::compute_graph::{
    NativeComputeBufferBindingKind, NativeComputeGraphBindingSpec, NativeComputeGraphBufferSpec,
    NativeComputeGraphPassPlan, NativeComputeGraphRenderBlend, NativeComputeGraphRenderPlan,
    NativeComputeGraphRenderTarget, NativeComputeGraphTextureSpec,
};
use crate::{App, NativeGraphFrameJob, NativeGraphLayer, NativeGraphLayerState, SourceFrame};

use super::arcs::{ArcState, MAX_ARCS, arc_frame, segments_per_arc};
use super::controls2::{ParamDef, defs_json};
use super::fluid_ink::{InkState, ink_frame, normalize_ink_params, sim_size};
use super::hdr_post::{HdrPostPlan, HdrPostSettings, accumulation_size, buffer_binding, plan_hdr_post, render_plan, uniform_spec};
use super::kit::{depth_plan, depth_texture, full_pass, hdr_texture, sampler_binding, texture_binding};
use super::ply_reader::{CLOUD_POINT_BYTES, CloudLoad};
use super::ribbons::{RIBBON_HEAD_BYTES, RIBBON_POINT_BYTES, RibbonState, ribbon_frame};
use super::shaders::{CoreShader, core_shader};
use super::shaders2::{
    ARCS_DRAW, AV2_FINISH, FLUID_INK, RIBBON_DRAW, RIBBON_SIM, SHATTER_DRAW, SHATTER_POINTS, SHATTER_SHARDS, SHOCKWAVE_DRAW,
    SHOCKWAVE_REFRACT, TERRAIN_DRAW, TERRAIN_ROW,
};
use super::shatter::{SHARD_BYTES, SHATTER_DRAWN_BYTES, ShatterState, normalize_shatter_params, scan_gain, shard_key, shatter_frame};
use super::shockwave::{ShockState, shock_frame};
use super::terrain::{TERRAIN_BINS, TerrainState, terrain_frame};

/// The second-set instruments.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Instrument2 {
    RibbonField,
    ShockwaveRings,
    FluidInk,
    LightningArcs,
    SpectralTerrain,
    MeshShatter,
}

impl Instrument2 {
    pub const ALL: [Self; 6] =
        [Self::RibbonField, Self::ShockwaveRings, Self::FluidInk, Self::LightningArcs, Self::SpectralTerrain, Self::MeshShatter];

    /// The layer kind, and the prefix of every buffer and texture it owns.
    pub fn prefix(self) -> &'static str {
        match self {
            Self::RibbonField => "ribbon-field",
            Self::ShockwaveRings => "shockwave-rings",
            Self::FluidInk => "fluid-ink",
            Self::LightningArcs => "lightning-arcs",
            Self::SpectralTerrain => "spectral-terrain",
            Self::MeshShatter => "mesh-shatter",
        }
    }

    pub fn from_kind(kind: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|instrument| instrument.prefix() == kind)
    }

    /// Every param the app shows for this instrument.
    pub fn defs(self) -> Vec<ParamDef> {
        match self {
            Self::RibbonField => super::ribbons::ribbon_defs(),
            Self::ShockwaveRings => super::shockwave::shock_defs(),
            Self::FluidInk => super::fluid_ink::ink_defs(),
            Self::LightningArcs => super::arcs::arc_defs(),
            Self::SpectralTerrain => super::terrain::terrain_defs(),
            Self::MeshShatter => super::shatter::shatter_defs(),
        }
    }
}

/// The param definitions for a manifest instrument id, if it is one of these.
pub fn manifest_params(id: &str) -> Option<serde_json::Value> {
    Instrument2::from_kind(id).map(|instrument| defs_json(&instrument.defs()))
}

/// The same definitions in the layer panel's `ParamControl` shape, which the
/// first set publishes as `param_defs`.
pub fn param_defs_json(id: &str) -> Option<serde_json::Value> {
    Instrument2::from_kind(id).map(|instrument| super::controls2::panel_defs_json(&instrument.defs()))
}

/// The frame clock every second-set instrument keeps for the post chain.
#[derive(Clone, Debug, Default)]
pub struct Clock2 {
    /// The last real frame step; a dt-0 repeat reuses it for the post chain.
    pub post_dt: f32,
    pub frame: u64,
    pub prev_frame_time: f32,
}

/// State of a second-set layer. Only the part for the layer's instrument is
/// used; everything is bounded.
#[derive(Clone, Debug, Default)]
pub struct Av2State {
    pub clock: Clock2,
    /// What the persistent buffers were sized for; a change starts afresh.
    pub key: String,
    pub ribbon: RibbonState,
    pub shock: ShockState,
    pub ink: InkState,
    pub arcs: ArcState,
    pub terrain: TerrainState,
    pub shatter: ShatterState,
    /// Mesh Shatter: the cloud being read, and what the shard pass last ran for.
    pub load: Option<Arc<CloudLoad>>,
    pub shard_key: String,
}

pub(crate) struct Frame2 {
    pub time: f32,
    pub dt: f32,
    pub post_dt: f32,
}

fn job(
    textures: Vec<NativeComputeGraphTextureSpec>,
    buffers: Vec<NativeComputeGraphBufferSpec>,
    pass_plans: Vec<NativeComputeGraphPassPlan>,
    render_plans: Vec<NativeComputeGraphRenderPlan>,
) -> NativeGraphFrameJob {
    NativeGraphFrameJob { textures, buffers, pass_plans, render_plans, readback_buffer_ids: Vec::new() }
}

fn storage(id: &str, bytes: u64, clear: bool) -> NativeComputeGraphBufferSpec {
    NativeComputeGraphBufferSpec {
        id: id.to_string(),
        byte_length: bytes,
        kind: NativeComputeBufferBindingKind::StorageReadWrite,
        initial_bytes: Vec::new(),
        persistent: true,
        clear,
        indirect: false,
    }
}

fn compute(
    name: String,
    shader: &CoreShader,
    entry: &str,
    threads: u32,
    bindings: Vec<NativeComputeGraphBindingSpec>,
) -> NativeComputeGraphPassPlan {
    let layout = crate::native_graph_binding_layout_signature(&bindings);
    NativeComputeGraphPassPlan {
        name,
        cache_key: format!("graph:{}:{}:{entry}:{layout}", shader.id, shader.hash),
        source: shader.source.clone(),
        entry: entry.to_string(),
        dispatch: [threads.div_ceil(64).max(1), 1, 1],
        bindings,
    }
}

fn uniform_binding(binding: u32, id: &str) -> NativeComputeGraphBindingSpec {
    buffer_binding(binding, id, NativeComputeBufferBindingKind::Uniform)
}

fn read_binding(binding: u32, id: &str) -> NativeComputeGraphBindingSpec {
    buffer_binding(binding, id, NativeComputeBufferBindingKind::StorageRead)
}

fn write_binding(binding: u32, id: &str) -> NativeComputeGraphBindingSpec {
    buffer_binding(binding, id, NativeComputeBufferBindingKind::StorageReadWrite)
}

impl App {
    fn av2_clock(&self, clock: &mut Clock2) -> Frame2 {
        let time = self.native_graph_time_seconds();
        let dt = if self.render_clock_mode == "manual" {
            self.native_graph_step_delta_this_render
        } else if clock.prev_frame_time <= 0.0 {
            1.0 / self.target_fps.max(1) as f32
        } else {
            time - clock.prev_frame_time
        }
        .clamp(0.0, 1.0 / 15.0);
        clock.prev_frame_time = time;
        if dt > 0.0 {
            clock.frame = clock.frame.wrapping_add(1);
            clock.post_dt = dt;
        }
        Frame2 { time, dt, post_dt: if dt > 0.0 { dt } else { clock.post_dt } }
    }

    fn av2_buffer_missing(&self, id: &str) -> bool {
        self.renderer.as_ref().is_none_or(|renderer| !renderer.native_compute_graph_buffers.contains_key(id))
    }

    fn av2_output(&mut self, source_id: &str) -> Result<NativeComputeGraphRenderTarget, String> {
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

    fn av2_audio_buffer(&self, prefix: &str) -> NativeComputeGraphBufferSpec {
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

    /// Plan the post chain and the output for a layer. The composite is the
    /// instruments' own (contrast and opacity), or `lens` for an instrument
    /// that bends the picture (its shader, entry and uniform at binding 4).
    #[allow(clippy::too_many_arguments)]
    fn av2_post(
        &mut self,
        prefix: &str,
        source_id: &str,
        settings: &HdrPostSettings,
        finish: [f32; 4],
        size: (u32, u32),
        clock: &Clock2,
        frame: &Frame2,
        lens: Option<(&CoreShader, &str, &str)>,
    ) -> Result<(HdrPostPlan, Vec<NativeComputeGraphBufferSpec>), String> {
        let output = self.av2_output(source_id)?;
        let mut post = plan_hdr_post(
            prefix,
            size.0,
            size.1,
            clock.frame % 2 == 1,
            settings,
            frame.post_dt,
            frame.time,
            clock.frame,
            output,
        );
        let finish_id = format!("{prefix}:post:u:finish");
        let composite = post.finish.pop().expect("the post chain ends in a composite");
        let mut bindings = composite.bindings.clone();
        let (shader, entry) = match lens {
            Some((shader, entry, uniform)) => {
                bindings.push(uniform_binding(4, uniform));
                (shader, entry)
            }
            None => (core_shader(AV2_FINISH), "fs_composite_finish"),
        };
        bindings.push(uniform_binding(5, &finish_id));
        post.finish.push(render_plan(
            composite.name.clone(),
            shader,
            "vs_full",
            entry,
            composite.target.clone(),
            true,
            NativeComputeGraphRenderBlend::Replace,
            3,
            1,
            bindings,
        ));
        Ok((post, vec![uniform_spec(finish_id, &finish)]))
    }

    pub(crate) fn build_native_av2_graph_job(
        &mut self,
        graph_layer: &NativeGraphLayer,
        instrument: Instrument2,
    ) -> Result<(NativeGraphLayerState, NativeGraphFrameJob), String> {
        let prefix = format!("{}:{}", instrument.prefix(), crate::native_graph_buffer_safe_id(&graph_layer.source_id));
        let state = graph_layer.av2_state.clone();
        let (state, job) = match instrument {
            Instrument2::RibbonField => self.ribbon_field_job(graph_layer, &prefix, state)?,
            Instrument2::ShockwaveRings => self.shockwave_job(graph_layer, &prefix, state)?,
            Instrument2::FluidInk => self.fluid_ink_job(graph_layer, &prefix, state)?,
            Instrument2::LightningArcs => self.arcs_job(graph_layer, &prefix, state)?,
            Instrument2::SpectralTerrain => self.terrain_job(graph_layer, &prefix, state)?,
            Instrument2::MeshShatter => self.shatter_job(graph_layer, &prefix, state)?,
        };
        Ok((NativeGraphLayerState::Av2(state), job))
    }

    fn ribbon_field_job(
        &mut self,
        graph_layer: &NativeGraphLayer,
        prefix: &str,
        mut state: Av2State,
    ) -> Result<(Av2State, NativeGraphFrameJob), String> {
        let peek = super::ribbons::normalize_ribbon_params(&graph_layer.params);
        let key = format!("{}x{}", peek.ribbons, peek.points);
        let heads_id = format!("{prefix}:heads:{key}");
        let trail_id = format!("{prefix}:trail:{key}");
        // A new size, a new layer, a lost device or an offline render
        // starting (it drops graph buffers): start afresh.
        let reset = state.key != key || self.av2_buffer_missing(&heads_id);
        if reset {
            state = Av2State { key: key.clone(), ..Av2State::default() };
        }
        let frame = self.av2_clock(&mut state.clock);
        let size = accumulation_size(self.pending_width, self.pending_height, 1.0);
        let f = ribbon_frame(&graph_layer.params, &mut state.ribbon, &self.audio_visual, size, frame.dt);
        let params = f.params;
        let uniform_id = format!("{prefix}:uniform");
        let mut buffers = vec![
            storage(&heads_id, u64::from(params.ribbons) * RIBBON_HEAD_BYTES, reset),
            storage(&trail_id, u64::from(params.ribbons) * u64::from(params.points) * RIBBON_POINT_BYTES, reset),
            uniform_spec(uniform_id.clone(), &f.uniform),
        ];
        let mut pass_plans = Vec::new();
        if f.step > 0.0 {
            pass_plans.push(compute(
                format!("{prefix}:sim"),
                core_shader(RIBBON_SIM),
                "cs_ribbons",
                params.ribbons,
                vec![write_binding(0, &heads_id), write_binding(1, &trail_id), uniform_binding(2, &uniform_id)],
            ));
        }
        let (post, extra) =
            self.av2_post(prefix, &graph_layer.source_id, &params.post, params.finish, size, &state.clock, &frame, None)?;
        let depth_id = format!("{prefix}:depth");
        let mut textures = post.textures;
        textures.push(depth_texture(depth_id.clone(), size.0, size.1));
        buffers.extend(post.buffers);
        buffers.extend(extra);
        let mut render_plans = vec![post.feedback];
        render_plans.push(depth_plan(
            format!("{prefix}:ribbons"),
            core_shader(RIBBON_DRAW),
            "vs_ribbon",
            "fs_ribbon",
            NativeComputeGraphRenderTarget::GraphTexture { id: post.scene_id.clone() },
            NativeComputeGraphRenderBlend::Replace,
            &depth_id,
            true,
            false,
            6,
            params.ribbons * (params.points - 1),
            vec![read_binding(0, &trail_id), uniform_binding(1, &uniform_id), read_binding(2, &heads_id)],
        ));
        render_plans.extend(post.finish);
        Ok((state, job(textures, buffers, pass_plans, render_plans)))
    }

    fn shockwave_job(
        &mut self,
        graph_layer: &NativeGraphLayer,
        prefix: &str,
        mut state: Av2State,
    ) -> Result<(Av2State, NativeGraphFrameJob), String> {
        let uniform_id = format!("{prefix}:uniform");
        // A missing uniform means a new layer, a lost device or an offline
        // render starting: start without rings, so a render never inherits
        // live hits.
        if self.av2_buffer_missing(&uniform_id) {
            state = Av2State::default();
        }
        let frame = self.av2_clock(&mut state.clock);
        let size = accumulation_size(self.pending_width, self.pending_height, 1.0);
        let f = shock_frame(&graph_layer.params, &mut state.shock, &self.audio_visual, size, frame.dt);
        let params = f.params;
        let mut buffers = vec![uniform_spec(uniform_id.clone(), &f.uniform)];
        let refract = core_shader(SHOCKWAVE_REFRACT);
        let (post, extra) = self.av2_post(
            prefix,
            &graph_layer.source_id,
            &params.post,
            params.finish,
            size,
            &state.clock,
            &frame,
            Some((refract, "fs_composite_refract", &uniform_id)),
        )?;
        buffers.extend(post.buffers);
        buffers.extend(extra);
        let draw = core_shader(SHOCKWAVE_DRAW);
        let scene = NativeComputeGraphRenderTarget::GraphTexture { id: post.scene_id.clone() };
        let bindings = vec![uniform_binding(0, &uniform_id)];
        let mut render_plans = vec![post.feedback];
        render_plans.push(render_plan(
            format!("{prefix}:dust"),
            draw,
            "vs_dust",
            "fs_soft",
            scene.clone(),
            false,
            NativeComputeGraphRenderBlend::Add,
            6,
            params.dust[0] * params.dust[1],
            bindings.clone(),
        ));
        if f.live > 0 {
            render_plans.push(render_plan(
                format!("{prefix}:rings"),
                draw,
                "vs_ring",
                "fs_soft",
                scene,
                false,
                NativeComputeGraphRenderBlend::Add,
                6,
                f.live * params.per_ring,
                bindings,
            ));
        }
        render_plans.extend(post.finish);
        Ok((state, job(post.textures, buffers, Vec::new(), render_plans)))
    }

    fn fluid_ink_job(
        &mut self,
        graph_layer: &NativeGraphLayer,
        prefix: &str,
        mut state: Av2State,
    ) -> Result<(Av2State, NativeGraphFrameJob), String> {
        let peek = normalize_ink_params(&graph_layer.params);
        let size = accumulation_size(self.pending_width, self.pending_height, 1.0);
        let aspect = size.0 as f32 / size.1.max(1) as f32;
        let sim = sim_size(&peek, aspect);
        let dye = accumulation_size(self.pending_width, self.pending_height, peek.dye_scale);
        let key = format!("{}x{}:{}x{}", sim.0, sim.1, dye.0, dye.1);
        let uniform_id = format!("{prefix}:uniform");
        // A new size, a new layer, a lost device or an offline render
        // starting: an empty tank, so a render never inherits live ink.
        let reset = state.key != key || self.av2_buffer_missing(&uniform_id);
        if reset {
            state = Av2State { key: key.clone(), ..Av2State::default() };
        }
        let frame = self.av2_clock(&mut state.clock);
        let f = ink_frame(&graph_layer.params, &mut state.ink, &self.audio_visual, sim, dye, aspect, frame.dt);
        let params = f.params;
        let shader = core_shader(FLUID_INK);
        let tex = |name: &str| format!("{prefix}:{name}:{key}");
        let (vel_a, vel_b, aux, prs_a, prs_b, dye_a, dye_b) =
            (tex("vel-a"), tex("vel-b"), tex("aux"), tex("prs-a"), tex("prs-b"), tex("dye-a"), tex("dye-b"));
        let mut textures = vec![
            hdr_texture(vel_a.clone(), sim.0, sim.1),
            hdr_texture(vel_b.clone(), sim.0, sim.1),
            hdr_texture(aux.clone(), sim.0, sim.1),
            hdr_texture(prs_a.clone(), sim.0, sim.1),
            hdr_texture(prs_b.clone(), sim.0, sim.1),
            hdr_texture(dye_a.clone(), dye.0, dye.1),
            hdr_texture(dye_b.clone(), dye.0, dye.1),
        ];
        let bind = |src: &str, extra: Option<&str>| {
            let mut b = vec![uniform_binding(0, &uniform_id), texture_binding(1, src), sampler_binding(2)];
            if let Some(extra) = extra {
                b.push(texture_binding(3, extra));
            }
            b
        };
        let mut passes = Vec::new();
        let mut pass = |name: &str, entry: &str, target: &str, src: &str, extra: Option<&str>| {
            passes.push(full_pass(format!("{prefix}:{name}"), shader, entry, target, bind(src, extra)));
        };
        if reset {
            for target in [&vel_a, &prs_a, &dye_a] {
                // fs_clear never reads its source; any declared texture does.
                pass("clear", "fs_clear", target, &aux, None);
            }
        }
        // The solve: splat, advect, vorticity, pressure, then the ink.
        if f.step > 0.0 {
            pass("splat-v", "fs_splat_velocity", &vel_b, &vel_a, None);
            pass("advect-v", "fs_advect_velocity", &vel_a, &vel_b, None);
            pass("curl", "fs_curl", &aux, &vel_a, None);
            pass("vorticity", "fs_vorticity", &vel_b, &vel_a, Some(&aux));
            pass("divergence", "fs_divergence", &aux, &vel_b, None);
            for i in 0..params.jacobi {
                let (from, to) = if i % 2 == 0 { (&prs_a, &prs_b) } else { (&prs_b, &prs_a) };
                pass("jacobi", "fs_jacobi", to, from, Some(&aux));
            }
            pass("gradient", "fs_gradient", &vel_a, &vel_b, Some(&prs_a));
            pass("splat-d", "fs_splat_dye", &dye_b, &dye_a, None);
            pass("advect-d", "fs_advect_dye", &dye_a, &dye_b, Some(&vel_a));
        }
        let mut buffers = vec![uniform_spec(uniform_id.clone(), &f.uniform)];
        let (post, extra) =
            self.av2_post(prefix, &graph_layer.source_id, &params.post, params.finish, size, &state.clock, &frame, None)?;
        textures.extend(post.textures);
        buffers.extend(post.buffers);
        buffers.extend(extra);
        let mut render_plans = passes;
        render_plans.push(post.feedback);
        render_plans.push(render_plan(
            format!("{prefix}:display"),
            shader,
            "vs_full",
            "fs_display",
            NativeComputeGraphRenderTarget::GraphTexture { id: post.scene_id.clone() },
            false,
            NativeComputeGraphRenderBlend::Add,
            3,
            1,
            bind(&dye_a, None),
        ));
        render_plans.extend(post.finish);
        Ok((state, job(textures, buffers, Vec::new(), render_plans)))
    }

    fn arcs_job(
        &mut self,
        graph_layer: &NativeGraphLayer,
        prefix: &str,
        mut state: Av2State,
    ) -> Result<(Av2State, NativeGraphFrameJob), String> {
        let uniform_id = format!("{prefix}:uniform");
        let nodes = super::arcs::normalize_arc_params(&graph_layer.params).nodes;
        let key = format!("{nodes}");
        if state.key != key || self.av2_buffer_missing(&uniform_id) {
            state = Av2State { key, ..Av2State::default() };
        }
        let frame = self.av2_clock(&mut state.clock);
        let size = accumulation_size(self.pending_width, self.pending_height, 1.0);
        let f = arc_frame(&graph_layer.params, &mut state.arcs, &self.audio_visual, size, frame.dt);
        let params = f.params;
        let mut buffers = vec![uniform_spec(uniform_id.clone(), &f.uniform)];
        let (post, extra) =
            self.av2_post(prefix, &graph_layer.source_id, &params.post, params.finish, size, &state.clock, &frame, None)?;
        buffers.extend(post.buffers);
        buffers.extend(extra);
        let shader = core_shader(ARCS_DRAW);
        let scene = NativeComputeGraphRenderTarget::GraphTexture { id: post.scene_id.clone() };
        let bindings = vec![uniform_binding(0, &uniform_id)];
        let mut render_plans = vec![post.feedback];
        if f.live > 0 {
            render_plans.push(render_plan(
                format!("{prefix}:arcs"),
                shader,
                "vs_arc",
                "fs_arc",
                scene.clone(),
                false,
                NativeComputeGraphRenderBlend::Add,
                12,
                f.live.min(MAX_ARCS as u32) * segments_per_arc(params.branches),
                bindings.clone(),
            ));
        }
        render_plans.push(render_plan(
            format!("{prefix}:nodes"),
            shader,
            "vs_node",
            "fs_node",
            scene,
            false,
            NativeComputeGraphRenderBlend::Add,
            6,
            params.nodes + 1,
            bindings,
        ));
        render_plans.extend(post.finish);
        Ok((state, job(post.textures, buffers, Vec::new(), render_plans)))
    }

    fn terrain_job(
        &mut self,
        graph_layer: &NativeGraphLayer,
        prefix: &str,
        mut state: Av2State,
    ) -> Result<(Av2State, NativeGraphFrameJob), String> {
        let peek = super::terrain::normalize_terrain_params(&graph_layer.params);
        let key = format!("{}", peek.rows);
        let rows_id = format!("{prefix}:rows:{key}");
        let reset = state.key != key || self.av2_buffer_missing(&rows_id);
        if reset {
            state = Av2State { key: key.clone(), ..Av2State::default() };
        }
        let frame = self.av2_clock(&mut state.clock);
        let size = accumulation_size(self.pending_width, self.pending_height, 1.0);
        let f = terrain_frame(&graph_layer.params, &mut state.terrain, &self.audio_visual, size, frame.dt);
        let params = f.params;
        let uniform_id = format!("{prefix}:uniform");
        let audio = self.av2_audio_buffer(prefix);
        let audio_id = audio.id.clone();
        let mut buffers = vec![
            storage(&rows_id, u64::from(params.rows) * u64::from(TERRAIN_BINS) * 4, reset),
            uniform_spec(uniform_id.clone(), &f.uniform),
            audio,
        ];
        let mut pass_plans = Vec::new();
        if f.due > 0 {
            pass_plans.push(compute(
                format!("{prefix}:row"),
                core_shader(TERRAIN_ROW),
                "cs_row",
                f.due * TERRAIN_BINS,
                vec![write_binding(0, &rows_id), uniform_binding(1, &uniform_id), read_binding(2, &audio_id)],
            ));
        }
        let (post, extra) =
            self.av2_post(prefix, &graph_layer.source_id, &params.post, params.finish, size, &state.clock, &frame, None)?;
        let depth_id = format!("{prefix}:depth");
        let mut textures = post.textures;
        textures.push(depth_texture(depth_id.clone(), size.0, size.1));
        buffers.extend(post.buffers);
        buffers.extend(extra);
        let cols = if params.mirror { (TERRAIN_BINS - 1) * 2 } else { TERRAIN_BINS - 1 };
        let mut render_plans = vec![post.feedback];
        render_plans.push(depth_plan(
            format!("{prefix}:terrain"),
            core_shader(TERRAIN_DRAW),
            "vs_terrain",
            "fs_terrain",
            NativeComputeGraphRenderTarget::GraphTexture { id: post.scene_id.clone() },
            NativeComputeGraphRenderBlend::Replace,
            &depth_id,
            true,
            false,
            6,
            cols * (params.rows - 1),
            vec![read_binding(0, &rows_id), uniform_binding(1, &uniform_id)],
        ));
        render_plans.extend(post.finish);
        Ok((state, job(textures, buffers, pass_plans, render_plans)))
    }

    fn shatter_job(
        &mut self,
        graph_layer: &NativeGraphLayer,
        prefix: &str,
        mut state: Av2State,
    ) -> Result<(Av2State, NativeGraphFrameJob), String> {
        let peek = normalize_shatter_params(&graph_layer.params);
        if peek.path.is_empty() {
            return Err("mesh-shatter needs a point cloud file".to_string());
        }
        // A new file or budget starts a new read; the old one is dropped.
        if state.load.as_ref().is_none_or(|load| load.path != peek.path || load.max_points != peek.max_points) {
            state = Av2State { load: Some(CloudLoad::start(peek.path.clone(), peek.max_points)), ..Av2State::default() };
        }
        let points = match state.load.as_ref().map(|load| load.ready()) {
            Some(Ok(Some(points))) => points,
            // Still reading: keep the state (and its load) for next frame.
            Some(Ok(None)) => return Ok((state, job(Vec::new(), Vec::new(), Vec::new(), Vec::new()))),
            Some(Err(err)) => return Err(format!("mesh-shatter could not read the cloud: {err}")),
            None => unreachable!("a load was just started"),
        };
        let count = points.count;
        let home_id = format!("{prefix}:points:{count}");
        let shards_id = format!("{prefix}:shards:{count}");
        let drawn_id = format!("{prefix}:drawn:{count}");
        let home_missing = self.av2_buffer_missing(&home_id);
        if home_missing {
            // A new cloud, a lost device or an offline render starting.
            let load = state.load.take();
            state = Av2State { load, ..Av2State::default() };
            state.shatter.scan_gain = scan_gain(&points.bytes);
        }
        let frame = self.av2_clock(&mut state.clock);
        let size = accumulation_size(self.pending_width, self.pending_height, 1.0);
        let f = shatter_frame(&graph_layer.params, &mut state.shatter, &self.audio_visual, size, count, frame.dt);
        let params = f.params;
        let uniform_id = format!("{prefix}:uniform");
        let mut buffers = vec![
            NativeComputeGraphBufferSpec {
                id: home_id.clone(),
                byte_length: u64::from(count) * CLOUD_POINT_BYTES,
                kind: NativeComputeBufferBindingKind::StorageRead,
                initial_bytes: if home_missing { points.bytes.clone() } else { Vec::new() },
                persistent: true,
                clear: home_missing,
                indirect: false,
            },
            storage(&shards_id, u64::from(count) * SHARD_BYTES, home_missing),
            storage(&drawn_id, u64::from(count) * SHATTER_DRAWN_BYTES, home_missing),
            uniform_spec(uniform_id.clone(), &f.uniform),
        ];
        // Assign shards once per cloud and shard size (a live change of the
        // shard size re-cuts the cloud; it does not reset the motion).
        let want = shard_key(count, params.shard);
        let mut pass_plans = Vec::new();
        if (state.shard_key != want || home_missing) && frame.dt > 0.0 {
            state.shard_key = want;
            pass_plans.push(compute(
                format!("{prefix}:shards"),
                core_shader(SHATTER_SHARDS),
                "cs_shards",
                count,
                vec![read_binding(0, &home_id), uniform_binding(1, &uniform_id), write_binding(2, &shards_id)],
            ));
        }
        // Shade every point once (a repeat render reuses the last frame's).
        if frame.dt > 0.0 || home_missing {
            pass_plans.push(compute(
                format!("{prefix}:shade"),
                core_shader(SHATTER_POINTS),
                "cs_shatter_points",
                count,
                vec![
                    read_binding(0, &home_id),
                    uniform_binding(1, &uniform_id),
                    read_binding(2, &shards_id),
                    write_binding(3, &drawn_id),
                ],
            ));
        }
        let (post, extra) =
            self.av2_post(prefix, &graph_layer.source_id, &params.post, params.finish, size, &state.clock, &frame, None)?;
        buffers.extend(post.buffers);
        buffers.extend(extra);
        let mut render_plans = vec![post.feedback];
        render_plans.push(render_plan(
            format!("{prefix}:points"),
            core_shader(SHATTER_DRAW),
            "vs_shatter",
            "fs_point",
            NativeComputeGraphRenderTarget::GraphTexture { id: post.scene_id.clone() },
            false,
            NativeComputeGraphRenderBlend::Add,
            6,
            count,
            vec![read_binding(0, &drawn_id), uniform_binding(1, &uniform_id)],
        ));
        render_plans.extend(post.finish);
        Ok((state, job(post.textures, buffers, pass_plans, render_plans)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_instrument_publishes_its_params_in_the_manifest() {
        let manifest = crate::native_graph_manifest::native_graph_instrument_manifest();
        for instrument in Instrument2::ALL {
            let entry = manifest
                .as_array()
                .unwrap()
                .iter()
                .find(|e| e["id"] == instrument.prefix())
                .unwrap_or_else(|| panic!("{} is not in the manifest", instrument.prefix()));
            let params = entry["param_defs"].as_array().expect("param_defs");
            assert_eq!(params.len(), instrument.defs().len());
            for p in params {
                assert!(p["key"].is_string() && p["label"].is_string() && p["group"].is_string() && p["kind"].is_string());
            }
            for group in ["Camera", "Look", "Post", "Audio", "Motion"] {
                assert!(params.iter().any(|p| p["group"] == group), "{} lacks {group}", instrument.prefix());
            }
            for key in ["autoRotateX", "autoRotateY", "autoRotateZ", "trigger", "freeze", "speed", "colorA", "colorB", "quality"] {
                assert!(params.iter().any(|p| p["key"] == key), "{} lacks {key}", instrument.prefix());
            }
        }
    }
}
