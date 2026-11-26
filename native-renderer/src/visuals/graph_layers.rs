//! Native graph layers: their kinds and state, frame ordering, plugin graph
//! jobs and the commands that bind, update and release them.

use crate::*;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum NativeGraphLayerKind {
    Lines,
    Svg,
    LightPainting,
    Text,
    Splat,
    Model3D,
    Planet,
    InkCloud,
    Smoke3D,
    ParticleField,
    PixelParticles,
    Flythrough,
    PointCloudFx,
    SmokeRiders,
    FluidRiders,
    VolumetricSpheres,
    Strands,
    CloudPulse,
    CloudFlock,
    DepthLights,
    RibbonField,
    ShockwaveRings,
    FluidInk,
    LightningArcs,
    SpectralTerrain,
    MeshShatter,
    GhostFx,
    HandFx,
    PerformerWorld,
    /// Interactive 3D: an app-built scene graph installed as a template and
    /// replayed by the core every frame, with the scene frame block written.
    Scene3D,
    /// A video synthesizer: an app-built graph replayed every frame with the
    /// scene frame block, like Scene3D, drawn in 2D.
    VideoSynth,
    VjCrossfade,
    VjMix,
    Unsupported(String),
}

impl NativeGraphLayerKind {
    pub(crate) fn from_label(label: &str) -> Self {
        match label.trim().to_ascii_lowercase().replace('_', "-").as_str() {
            "lines" => Self::Lines,
            "svg" => Self::Svg,
            "light-painting" | "lightpainting" => Self::LightPainting,
            "text" => Self::Text,
            "splat" => Self::Splat,
            "model3d" => Self::Model3D,
            "planet" => Self::Planet,
            "ink-cloud" => Self::InkCloud,
            "smoke-3d" | "3d-smoke" => Self::Smoke3D,
            "particle-field" | "gravity-wells" => Self::ParticleField,
            "pixel-particles" => Self::PixelParticles,
            "flythrough" => Self::Flythrough,
            "point-cloud-fx" => Self::PointCloudFx,
            "smoke-riders" => Self::SmokeRiders,
            "fluid-riders" => Self::FluidRiders,
            "volumetric-spheres" | "volumetric-balls" => Self::VolumetricSpheres,
            "strands" => Self::Strands,
            "cloud-pulse" => Self::CloudPulse,
            "cloud-flock" => Self::CloudFlock,
            "depth-lights" => Self::DepthLights,
            "ribbon-field" => Self::RibbonField,
            "shockwave-rings" => Self::ShockwaveRings,
            "fluid-ink" => Self::FluidInk,
            "lightning-arcs" => Self::LightningArcs,
            "spectral-terrain" => Self::SpectralTerrain,
            "mesh-shatter" => Self::MeshShatter,
            "ghostfx" => Self::GhostFx,
            "handfx" => Self::HandFx,
            "performer-world" => Self::PerformerWorld,
            "scene3d" | "scene-3d" | "interactive-3d" => Self::Scene3D,
            "videosynth" | "video-synth" => Self::VideoSynth,
            "vj-crossfade" => Self::VjCrossfade,
            "vj-mix" => Self::VjMix,
            other => Self::Unsupported(other.to_string()),
        }
    }

    pub(crate) fn signature(&self) -> &str {
        match self {
            Self::Lines => "lines",
            Self::Svg => "svg",
            Self::LightPainting => "light-painting",
            Self::Text => "text",
            Self::Splat => "splat",
            Self::Model3D => "model3d",
            Self::Planet => "planet",
            Self::InkCloud => "ink-cloud",
            Self::Smoke3D => "smoke-3d",
            Self::ParticleField => "particle-field",
            Self::PixelParticles => "pixel-particles",
            Self::Flythrough => "flythrough",
            Self::PointCloudFx => "point-cloud-fx",
            Self::SmokeRiders => "smoke-riders",
            Self::FluidRiders => "fluid-riders",
            Self::VolumetricSpheres => "volumetric-spheres",
            Self::Strands => "strands",
            Self::CloudPulse => "cloud-pulse",
            Self::CloudFlock => "cloud-flock",
            Self::DepthLights => "depth-lights",
            Self::RibbonField => "ribbon-field",
            Self::ShockwaveRings => "shockwave-rings",
            Self::FluidInk => "fluid-ink",
            Self::LightningArcs => "lightning-arcs",
            Self::SpectralTerrain => "spectral-terrain",
            Self::MeshShatter => "mesh-shatter",
            Self::GhostFx => "ghostfx",
            Self::HandFx => "handfx",
            Self::PerformerWorld => "performer-world",
            Self::Scene3D => "scene3d",
            Self::VideoSynth => "videosynth",
            Self::VjCrossfade => "vj-crossfade",
            Self::VjMix => "vj-mix",
            Self::Unsupported(label) => label.as_str(),
        }
    }

    /// Where this kind's frame job runs in a frame. Jobs share one encoder and
    /// the VJ plugins sample other layers' source frames (`layer-frame:`): a
    /// crossfade reads its two bank rows, the mix reads every row including
    /// crossfade carriers. A reader encoded before its writer samples the
    /// previous frame, and in the frame a writer first appears it samples a
    /// freshly cleared slot, so the row under it flashes through. Content
    /// runs first, then crossfades, then the mix.
    pub(crate) fn frame_job_stage(&self) -> u8 {
        match self {
            Self::VjCrossfade => 1,
            Self::VjMix => 2,
            _ => 0,
        }
    }

    pub(crate) fn is_supported(&self) -> bool {
        matches!(
            self,
            Self::Lines
                | Self::Svg
                | Self::LightPainting
                | Self::Text
                | Self::Splat
                | Self::Model3D
                | Self::Planet
                | Self::InkCloud
                | Self::Smoke3D
                | Self::ParticleField
                | Self::PixelParticles
                | Self::Flythrough
                | Self::PointCloudFx
                | Self::SmokeRiders
                | Self::FluidRiders
                | Self::VolumetricSpheres
                | Self::Strands
                | Self::CloudPulse
                | Self::CloudFlock
                | Self::DepthLights
                | Self::RibbonField
                | Self::ShockwaveRings
                | Self::FluidInk
                | Self::LightningArcs
                | Self::SpectralTerrain
                | Self::MeshShatter
                | Self::GhostFx
                | Self::HandFx
                | Self::PerformerWorld
                | Self::Scene3D
                | Self::VideoSynth
                | Self::VjCrossfade
                | Self::VjMix
        )
    }
}

pub(crate) fn graph_layer_frame_order(
    a: (&NativeGraphLayerKind, &str),
    b: (&NativeGraphLayerKind, &str),
) -> std::cmp::Ordering {
    // The shared VJ mix produces group textures. Mapped slice readers must
    // consume those textures only after the producer has rendered this frame.
    // A VJ row whose clip is itself a mix (the Music Studio plugin: shader
    // voices mixed into one picture) is content: it reads only shader layers,
    // which render before any graph job, and the crossfades and the mix read it.
    let stage = |kind: &NativeGraphLayerKind, id: &str| {
        if matches!(kind, NativeGraphLayerKind::VjMix) {
            if id.starts_with("vj-layer-") { 0 } else if id == "__vj-mix__" { kind.frame_job_stage() } else { 3 }
        } else {
            kind.frame_job_stage()
        }
    };
    stage(a.0, a.1)
        .cmp(&stage(b.0, b.1))
        .then_with(|| a.1.cmp(b.1))
}

pub(crate) fn sort_graph_layers_for_frame(layers: &mut Vec<NativeGraphLayer>) {
    layers.sort_by(|a, b| {
        graph_layer_frame_order((&a.kind, a.layer_id.as_str()), (&b.kind, b.layer_id.as_str()))
    });
    // Stage order is only a tie breaker: clip fades, deck fades, and Screen
    // copies may share a kind. Follow the textures they actually read so a
    // freshly installed nested graph never samples a cleared/previous slot.
    let writers = layers.iter().enumerate().flat_map(|(index, layer)| {
        [(format!("layer-frame:{}", layer.layer_id), index),
         (format!("shader-frame:{}", layer.layer_id), index),
         (layer.source_id.clone(), index)]
    }).collect::<HashMap<_, _>>();
    let dependencies = layers.iter().enumerate().map(|(index, layer)| {
        let mut resources = vec![layer.input_source_id.as_str()];
        if let Some(job) = &layer.effect_job_template {
            resources.extend(job.render_plans.iter().flat_map(|plan| plan.bindings.iter())
                .chain(job.pass_plans.iter().flat_map(|plan| plan.bindings.iter()))
                .map(|binding| binding.resource_id.as_str()));
        }
        resources.into_iter().filter_map(|resource| writers.get(resource).copied())
            .filter(|writer| *writer != index).collect::<HashSet<_>>()
    }).collect::<Vec<_>>();
    let mut taken = std::mem::take(layers).into_iter().map(Some).collect::<Vec<_>>();
    layers.extend(graph_dependency_order(&dependencies).into_iter().filter_map(|index| taken[index].take()));
}

pub(crate) fn graph_dependency_order(dependencies: &[HashSet<usize>]) -> Vec<usize> {
    let mut remaining = (0..dependencies.len()).collect::<Vec<_>>();
    let mut finished = HashSet::new();
    let mut order = Vec::with_capacity(remaining.len());
    while !remaining.is_empty() {
        // A malformed cyclic graph has no same-frame solution. Keep its
        // fallback deterministic, rather than hanging the live render loop.
        let next = remaining.iter().position(|index| dependencies[*index].iter()
            .all(|dependency| finished.contains(dependency))).unwrap_or(0);
        let index = remaining.remove(next);
        finished.insert(index);
        order.push(index);
    }
    order
}

/// Per-layer running state for the GhostFX Liquid injection engine — beat
/// edge detection and the fractional bass-trickle accumulator survive across
/// frames so bursts fire on rising edges only and droplet rates stay smooth.
#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct NativePluginLiquidState {
    pub(crate) ambient_accumulator: f32,
}

/// Per-layer musical envelopes with gradual attack and release. No impulse
/// assignments: bass steers flow, mids shape structure, energy sustains light.
#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct NativePluginAudioSmooth {
    pub(crate) bass: f32,
    pub(crate) mid: f32,
    pub(crate) treble: f32,
    pub(crate) energy: f32,
    pub(crate) beat_env: f32,
    pub(crate) last_frame: u64,
}

impl NativePluginAudioSmooth {
    pub(crate) fn follow(current: f32, target: f32, dt: f32, attack_tau: f32, release_tau: f32) -> f32 {
        let tau = if target > current {
            attack_tau
        } else {
            release_tau
        };
        current + (target - current) * (1.0 - (-dt / tau.max(1e-3)).exp())
    }

    pub(crate) fn update(
        &mut self,
        frame_index: u64,
        dt: f32,
        audio0: [f32; 4],
        audio1: [f32; 4],
        reactivity: f32,
    ) {
        if self.last_frame == frame_index && frame_index != 0 {
            return;
        }
        self.last_frame = frame_index;
        let dt = dt.clamp(0.0, 0.1);
        // Both attack AND release glide. No beat-edge assignment or raw
        // waveform reaches a visual uniform, even at maximum responsiveness.
        let responsiveness = reactivity.clamp(0.0, 1.0);
        let attack = 0.65 - responsiveness * 0.40;
        let release = 1.45 - responsiveness * 0.65;
        let clean = |v: f32| if v.is_finite() { v.clamp(0.0, 1.0) } else { 0.0 };
        self.bass = Self::follow(self.bass, clean(audio0[1]), dt, attack, release);
        self.mid = Self::follow(self.mid, clean(audio0[2]), dt, attack * 0.85, release * 0.9);
        self.treble = Self::follow(self.treble, clean(audio0[3]), dt, attack * 0.75, release * 0.8);
        self.energy = Self::follow(self.energy, clean(audio0[0]), dt, attack * 1.8, release * 1.5);
        self.beat_env = Self::follow(self.beat_env, clean(audio1[1]), dt, 0.28, 0.75);

    }
}

/// Minimal HSV→RGB for splat dye colors (h/s/v in 0..1).
pub(crate) fn hsv_to_rgb(h: f32, s: f32, v: f32) -> [f32; 3] {
    let h6 = (h.rem_euclid(1.0)) * 6.0;
    let sector = h6.floor() as i32 % 6;
    let f = h6 - h6.floor();
    let p = v * (1.0 - s);
    let q = v * (1.0 - s * f);
    let t = v * (1.0 - s * (1.0 - f));
    match sector {
        0 => [v, t, p],
        1 => [q, v, p],
        2 => [p, v, t],
        3 => [p, q, v],
        4 => [t, p, v],
        _ => [v, p, q],
    }
}

#[derive(Clone, Debug)]
pub(crate) struct NativeGraphLayer {
    pub(crate) layer_id: String,
    pub(crate) source_id: String,
    pub(crate) input_source_id: String,
    pub(crate) kind: NativeGraphLayerKind,
    pub(crate) params: Value,
    /// Shared, so the per-frame copy of the layer does not copy its buffers.
    pub(crate) effect_job_template: Option<Arc<NativeGraphFrameJob>>,
    pub(crate) planet_state: NativePlanetGraphState,
    pub(crate) ink_cloud_state: NativeInkCloudGraphState,
    pub(crate) smoke_3d_state: NativeSmoke3DGraphState,
    pub(crate) particle_field_state: NativeParticleFieldGraphState,
    pub(crate) pixel_particles_state: NativePixelParticlesGraphState,
    pub(crate) flythrough_state: NativeFlythroughGraphState,
    pub(crate) point_cloud_state: NativePointCloudGraphState,
    pub(crate) volumetric_spheres_state: NativeVolumetricSpheresGraphState,
    pub(crate) smoke_riders_state: NativeSmokeRidersGraphState,
    pub(crate) strands_state: audio_visuals::jobs::StrandsState,
    pub(crate) cloud_pulse_state: audio_visuals::jobs::CloudPulseState,
    pub(crate) av2_state: audio_visuals::jobs2::Av2State,
}

pub(crate) enum NativeGraphLayerState {
    Planet(NativePlanetGraphState),
    InkCloud(NativeInkCloudGraphState),
    Smoke3D(NativeSmoke3DGraphState),
    ParticleField(NativeParticleFieldGraphState),
    PixelParticles(NativePixelParticlesGraphState),
    Flythrough(NativeFlythroughGraphState),
    PointCloudFx(NativePointCloudGraphState),
    SmokeRiders(NativeSmokeRidersGraphState),
    VolumetricSpheres(NativeVolumetricSpheresGraphState),
    Strands(audio_visuals::jobs::StrandsState),
    CloudPulse(audio_visuals::jobs::CloudPulseState),
    Av2(audio_visuals::jobs2::Av2State),
}

/// One asynchronous graph buffer readback: a MAP_READ copy made in the frame's
/// encoder, mapped after that frame is submitted, collected when the map lands.
pub(crate) struct PendingGraphReadback {
    pub(crate) id: String,
    pub(crate) staging: wgpu::Buffer,
    pub(crate) byte_length: u64,
    pub(crate) mapped: Option<mpsc::Receiver<Result<(), wgpu::BufferAsyncError>>>,
}

#[derive(Clone, Debug)]
pub(crate) struct NativeGraphFrameJob {
    /// Textures the graph declared. Re-declared each time the job is admitted,
    /// so a texture freed while its layer was hidden, or lost with the
    /// device, is there again before the job draws.
    pub(crate) textures: Vec<NativeComputeGraphTextureSpec>,
    pub(crate) buffers: Vec<NativeComputeGraphBufferSpec>,
    pub(crate) pass_plans: Vec<NativeComputeGraphPassPlan>,
    pub(crate) render_plans: Vec<NativeComputeGraphRenderPlan>,
    /// Buffers to copy back to the CPU once this job has run. Asynchronous:
    /// the bytes land in `graph_readback_results` a frame or more later, and
    /// a frame never waits for them.
    pub(crate) readback_buffer_ids: Vec<String>,
}

pub(crate) fn graph_job_references_source(job: &NativeGraphFrameJob, source_id: &str) -> bool {
    job.render_plans.iter().flat_map(|plan| plan.bindings.iter())
        .chain(job.pass_plans.iter().flat_map(|plan| plan.bindings.iter()))
        .any(|binding| binding.resource_id == source_id)
}

pub(crate) fn graph_job_structure_signature(job: &NativeGraphFrameJob) -> String {
    // Uniform values (mix/time/audio) do not invalidate a published picture;
    // a new shader, output, or input identity must render before it is ready.
    format!("{:?}:{:?}",
        job.render_plans.iter().map(|plan| (&plan.cache_key, match &plan.target {
            NativeComputeGraphRenderTarget::SourceFrame { source_id, slot, .. } => format!("{source_id}:{slot}"),
            target => format!("{target:?}"),
        },
            plan.bindings.iter().map(|binding| (&binding.resource_id, binding.binding, binding.kind)).collect::<Vec<_>>()
        )).collect::<Vec<_>>(),
        job.pass_plans.iter().map(|plan| (&plan.cache_key,
            plan.bindings.iter().map(|binding| (&binding.resource_id, binding.binding, binding.kind)).collect::<Vec<_>>()
        )).collect::<Vec<_>>())
}

pub(crate) fn graph_frame_job_order(jobs: &[NativeGraphFrameJob]) -> Vec<usize> {
    let mut writers = HashMap::<usize, Vec<usize>>::new();
    for (index, job) in jobs.iter().enumerate() {
        for plan in &job.render_plans {
            if let NativeComputeGraphRenderTarget::SourceFrame { slot, .. } = plan.target {
                writers.entry(slot).or_default().push(index);
            }
        }
    }
    let dependencies = jobs.iter().enumerate().map(|(index, job)| {
        job.render_plans.iter().flat_map(|plan| plan.bindings.iter())
            .chain(job.pass_plans.iter().flat_map(|plan| plan.bindings.iter()))
            .filter_map(|binding| binding.source_slot.and_then(|slot| writers.get(&slot)))
            .flat_map(|writers| writers.iter().copied()).filter(|writer| *writer != index)
            .collect::<HashSet<_>>()
    }).collect::<Vec<_>>();
    graph_dependency_order(&dependencies)
}

pub(crate) fn native_graph_buffer_safe_id(value: &str) -> String {
    let mut out = String::with_capacity(value.len().min(160));
    for ch in value.chars() {
        if ch.is_ascii_alphanumeric() || ch == ':' || ch == '_' || ch == '-' {
            out.push(ch);
        } else {
            out.push('_');
        }
        if out.len() >= 160 {
            break;
        }
    }
    if out.is_empty() {
        "source".to_string()
    } else {
        out
    }
}

pub(crate) fn native_graph_param_f32(params: &Value, key: &str, min: f32, max: f32, fallback: f32) -> f32 {
    params
        .get(key)
        .and_then(Value::as_f64)
        .map(|value| value.clamp(min as f64, max as f64) as f32)
        .unwrap_or(fallback)
}

pub(crate) fn native_graph_param_rgb(params: &Value, key: &str, fallback: [f32; 3]) -> [f32; 3] {
    color_path_or(params, &[key]).unwrap_or(fallback)
}

pub(crate) fn write_f32_le(bytes: &mut [u8], index: usize, value: f32) {
    let offset = index.saturating_mul(4);
    if offset + 4 <= bytes.len() {
        bytes[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
    }
}

pub(crate) fn write_u32_le(bytes: &mut [u8], index: usize, value: u32) {
    let offset = index.saturating_mul(4);
    if offset + 4 <= bytes.len() {
        bytes[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
    }
}

/// Numbers that arrive as strings. Select-backed params (`shadowRes`)
/// round-trip through the UI as `"48"`, and `Value::as_f64` returns None
/// for those — which silently parked the tier's shadow resolution on the
/// fallback for every project that had ever touched the control.
pub(crate) fn native_graph_param_numeric(params: &Value, key: &str) -> Option<f64> {
    match params.get(key) {
        Some(Value::Number(n)) => n.as_f64(),
        Some(Value::String(s)) => s.trim().parse::<f64>().ok(),
        _ => None,
    }
}

pub(crate) fn native_graph_param_bool(params: &Value, key: &str, fallback: bool) -> bool {
    params.get(key).and_then(Value::as_bool).unwrap_or(fallback)
}

pub(crate) fn native_graph_param_u32(params: &Value, key: &str, min: u32, max: u32, fallback: u32) -> u32 {
    params
        .get(key)
        .and_then(Value::as_f64)
        .map(|value| value.round().clamp(min as f64, max as f64) as u32)
        .unwrap_or(fallback)
        .clamp(min, max)
}

impl App {
    /// Claim this render's slice of the world clock.
    ///
    /// Live mode is unchanged: every render advances by the frame delta.
    /// Under a manual (offline render) clock the declared delta is
    /// consumed exactly ONCE per virtual frame. `render()` also fires from
    /// this core's own `about_to_wait` pacing loop and from redraw
    /// requests, and each of those used to re-apply the full delta — a
    /// slow export (readback + IPC + encode per frame) let 1-3 extra
    /// renders slip between captured frames, so simulations ran 2-4x ahead
    /// of the frame timeline and the exported video played fast. Repeat
    /// renders still rebuild and re-run every graph (so a param or
    /// effect-graph edit at the same virtual time still lands) — they just
    /// advance the world by 0.
    pub(crate) fn claim_native_graph_step(&mut self) {
        if self.render_clock_mode != "manual" {
            self.last_native_graph_step_clock = None;
            self.native_graph_step_delta_this_render = self.render_clock_delta;
            return;
        }
        let already_stepped = self.last_native_graph_step_clock == self.render_clock_time
            || !self.manual_snapshot_stepping;
        if already_stepped {
            self.stats.manual_clock_graph_steps_skipped =
                self.stats.manual_clock_graph_steps_skipped.saturating_add(1);
        }
        if self.manual_snapshot_stepping {
            self.last_native_graph_step_clock = self.render_clock_time;
        }
        self.native_graph_step_delta_this_render = if already_stepped {
            0.0
        } else {
            self.render_clock_delta
        };
    }

    pub(crate) fn run_native_graph_layers(&mut self) -> Vec<NativeGraphFrameJob> {
        if self.native_graph_layers.is_empty() {
            return Vec::new();
        }
        let mut jobs = Vec::new();
        let mut graph_layers = self
            .native_graph_layers
            .values()
            .cloned()
            .collect::<Vec<_>>();
        // HashMap order is arbitrary and shifts as layers come and go. Building
        // in stage order also registers each writer's target slot before a
        // later reader resolves its `layer-frame:` bindings.
        sort_graph_layers_for_frame(&mut graph_layers);
        for graph_layer in graph_layers {
            if self.captured_graph_holds.contains(&graph_layer.layer_id) {
                continue;
            }
            let layer_visible = self
                .scene_layers
                .get(&graph_layer.layer_id)
                .map(|layer| layer.visible)
                .unwrap_or(false);
            if !layer_visible {
                continue;
            }
            if matches!(
                graph_layer.kind,
                NativeGraphLayerKind::GhostFx
                    | NativeGraphLayerKind::HandFx
                    | NativeGraphLayerKind::PerformerWorld
                    | NativeGraphLayerKind::Scene3D
                    | NativeGraphLayerKind::VideoSynth
                    | NativeGraphLayerKind::VjCrossfade
                    | NativeGraphLayerKind::VjMix
            ) {
                let Some(template) = graph_layer.effect_job_template.as_ref() else {
                    let message = format!(
                        "native plugin graph `{}` on layer `{}` has no installed template",
                        graph_layer.kind.signature(),
                        graph_layer.layer_id
                    );
                    // One stderr line per state change, not one per frame.
                    if self.last_shader_error.as_deref() != Some(message.as_str()) {
                        eprintln!("[GhostRenderCore] {message}");
                    }
                    self.last_shader_error = Some(message);
                    continue;
                };
                let job = self.native_plugin_graph_frame_job(&graph_layer, template, &jobs);
                self.register_compute_graph_source_frame_targets(&job.render_plans);
                jobs.push(job);
                self.last_shader_error = None;
                continue;
            }
            let result = match graph_layer.kind.clone() {
                // Lines, SVG, Light Painting, and Text frame jobs are fully described
                // by the renderer sync layer and submitted through `queue_compute_graph`.
                // The retained native graph entry keeps their source attached to
                // the compositor without generating a second frame job here.
                NativeGraphLayerKind::Lines
                | NativeGraphLayerKind::Svg
                | NativeGraphLayerKind::LightPainting
                | NativeGraphLayerKind::Text
                | NativeGraphLayerKind::Splat
                | NativeGraphLayerKind::Model3D => continue,
                NativeGraphLayerKind::Planet => self.build_native_planet_graph_job(&graph_layer),
                NativeGraphLayerKind::InkCloud => {
                    self.build_native_ink_cloud_graph_job(&graph_layer)
                }
                NativeGraphLayerKind::Smoke3D => self.build_native_smoke_3d_graph_job(&graph_layer),
                NativeGraphLayerKind::ParticleField => {
                    self.build_native_particle_field_graph_job(&graph_layer)
                }
                NativeGraphLayerKind::PixelParticles => {
                    self.build_native_pixel_particles_graph_job(&graph_layer)
                }
                NativeGraphLayerKind::Flythrough => {
                    self.build_native_flythrough_graph_job(&graph_layer)
                }
                NativeGraphLayerKind::PointCloudFx => {
                    self.build_native_point_cloud_graph_job(&graph_layer)
                }
                NativeGraphLayerKind::SmokeRiders => {
                    self.build_native_smoke_riders_graph_job(&graph_layer, "smoke-riders")
                }
                // Fluid Riders shares the whole solve + pass topology; only the
                // WGSL differs (opaque isosurface instead of a smoke march), so
                // it reuses this builder with its own shader-id prefix.
                NativeGraphLayerKind::FluidRiders => {
                    self.build_native_smoke_riders_graph_job(&graph_layer, "fluid-riders")
                }
                NativeGraphLayerKind::VolumetricSpheres => {
                    self.build_native_volumetric_spheres_graph_job(&graph_layer)
                }
                NativeGraphLayerKind::Strands => self.build_native_strands_graph_job(&graph_layer),
                NativeGraphLayerKind::CloudPulse => {
                    self.build_native_cloud_graph_job(&graph_layer, audio_visuals::jobs::CloudInstrument::Pulse)
                }
                NativeGraphLayerKind::CloudFlock => {
                    self.build_native_cloud_graph_job(&graph_layer, audio_visuals::jobs::CloudInstrument::Flock)
                }
                NativeGraphLayerKind::DepthLights => {
                    self.build_native_cloud_graph_job(&graph_layer, audio_visuals::jobs::CloudInstrument::DepthLights)
                }
                NativeGraphLayerKind::RibbonField
                | NativeGraphLayerKind::ShockwaveRings
                | NativeGraphLayerKind::FluidInk
                | NativeGraphLayerKind::LightningArcs
                | NativeGraphLayerKind::SpectralTerrain
                | NativeGraphLayerKind::MeshShatter => {
                    let instrument = audio_visuals::jobs2::Instrument2::from_kind(graph_layer.kind.signature())
                        .expect("second-set instrument kind");
                    self.build_native_av2_graph_job(&graph_layer, instrument)
                }
                NativeGraphLayerKind::GhostFx
                | NativeGraphLayerKind::HandFx
                | NativeGraphLayerKind::PerformerWorld
                | NativeGraphLayerKind::Scene3D
                | NativeGraphLayerKind::VideoSynth
                | NativeGraphLayerKind::VjCrossfade
                | NativeGraphLayerKind::VjMix => unreachable!(),
                NativeGraphLayerKind::Unsupported(_) => continue,
            };
            match result {
                Ok((next_state, job)) => {
                    if let Some(entry) = self.native_graph_layers.get_mut(&graph_layer.layer_id) {
                        match next_state {
                            NativeGraphLayerState::Planet(state) => entry.planet_state = state,
                            NativeGraphLayerState::InkCloud(state) => entry.ink_cloud_state = state,
                            NativeGraphLayerState::Smoke3D(state) => entry.smoke_3d_state = state,
                            NativeGraphLayerState::ParticleField(state) => {
                                entry.particle_field_state = state
                            }
                            NativeGraphLayerState::PixelParticles(state) => {
                                entry.pixel_particles_state = state
                            }
                            NativeGraphLayerState::Flythrough(state) => {
                                entry.flythrough_state = state
                            }
                            NativeGraphLayerState::PointCloudFx(state) => {
                                entry.point_cloud_state = state
                            }
                            NativeGraphLayerState::SmokeRiders(state) => {
                                entry.smoke_riders_state = state
                            }
                            NativeGraphLayerState::VolumetricSpheres(state) => {
                                entry.volumetric_spheres_state = state
                            }
                            NativeGraphLayerState::Strands(state) => entry.strands_state = state,
                            NativeGraphLayerState::CloudPulse(state) => {
                                entry.cloud_pulse_state = state
                            }
                            NativeGraphLayerState::Av2(state) => entry.av2_state = state,
                        }
                    }
                    jobs.push(job);
                    if let Some(effect_template) = graph_layer.effect_job_template.as_ref() {
                        let effect_job = self.native_graph_effect_frame_job(effect_template);
                        self.register_compute_graph_source_frame_targets(&effect_job.render_plans);
                        jobs.push(effect_job);
                    }
                    self.last_shader_error = None;
                }
                Err(err) => {
                    self.last_shader_error = Some(format!(
                        "native graph `{}` on layer `{}` failed: {err}",
                        graph_layer.kind.signature(),
                        graph_layer.layer_id
                    ));
                }
            }
        }
        jobs
    }

    pub(crate) fn native_plugin_graph_frame_job(
        &mut self,
        graph_layer: &NativeGraphLayer,
        template: &NativeGraphFrameJob,
        earlier_jobs: &[NativeGraphFrameJob],
    ) -> NativeGraphFrameJob {
        let mut job = template.clone();
        let clip_sources = if graph_layer.kind == NativeGraphLayerKind::VjCrossfade {
            [2, 3].map(|number| job.render_plans.iter().flat_map(|plan| plan.bindings.iter())
                .find(|binding| binding.binding == number).and_then(|binding| {
                    let (rect, slot) = if let Some(layer_id) = binding.resource_id.strip_prefix("layer-frame:") {
                        let layer = self.scene_layers.get(layer_id)?;
                        (layer.source_rect, layer.frame_slot)
                    } else {
                        (self.source_frames.get(&binding.resource_id)?.source_rect,
                            self.source_frame_slots.get(&binding.resource_id).copied())
                    };
                    // Queue ordering makes an already submitted snapshot or
                    // video safe to sample even before the CPU sees its GPU
                    // callback. Allocated/warming graph slots remain false.
                    let ready = slot.is_some_and(|slot| self.renderer.as_ref()
                        .is_some_and(|renderer| renderer.slot_readiness(slot).submitted())
                        || earlier_jobs.iter().chain(self.pending_native_graph_jobs.iter())
                            .flat_map(|job| job.render_plans.iter()).any(|plan|
                            matches!(plan.target, NativeComputeGraphRenderTarget::SourceFrame { slot: writer, .. } if writer == slot)));
                    Some((rect, ready))
                }).unwrap_or(([0.0, 0.0, 1.0, 1.0], false)))
        } else { [([0.0, 0.0, 1.0, 1.0], false); 2] };
        // `layer-frame:` bindings must track the CURRENT frame slot of their
        // scene layer every replay — at install time a shader layer may not
        // have rendered yet (its binding would pin to the empty placeholder
        // forever), and video slots can move under pool pressure.
        let debug_resolution = self.native_frame_index() % 240 == 0 && std::env::var("GHOST_DEBUG_LAYERS").is_ok();
        for plan in &mut job.render_plans {
            for binding in &mut plan.bindings {
                if let Some(layer_id) = binding.resource_id.strip_prefix("shader-frame:") {
                    if let Some(slot) = self
                        .scene_layers
                        .get(layer_id)
                        .and_then(|layer| layer.shader_frame_slot)
                    {
                        binding.source_slot = Some(slot);
                    }
                }
                if let Some(layer_id) = binding.resource_id.strip_prefix("layer-frame:") {
                    let resolved = self
                        .scene_layers
                        .get(layer_id)
                        .and_then(|layer| layer.frame_slot);
                    if let Some(slot) = resolved {
                        binding.source_slot = Some(slot);
                    }
                    if debug_resolution {
                        eprintln!(
                            "[GhostRenderCore] layer-frame resolve `{layer_id}` -> {:?} (template slot {:?}, layer known: {})",
                            resolved,
                            binding.source_slot,
                            self.scene_layers.contains_key(layer_id)
                        );
                    }
                }
            }
        }
        for plan in &mut job.pass_plans {
            for binding in &mut plan.bindings {
                if let Some(layer_id) = binding.resource_id.strip_prefix("layer-frame:") {
                    if let Some(slot) = self
                        .scene_layers
                        .get(layer_id)
                        .and_then(|layer| layer.frame_slot)
                    {
                        binding.source_slot = Some(slot);
                    }
                }
            }
        }
        let time = self.native_graph_time_seconds();
        let delta = self.native_frame_delta().clamp(0.0, 0.1);
        let frame_index = self.native_frame_index();
        let reactivity_key = match graph_layer.kind { NativeGraphLayerKind::Scene3D => "scene3dReactivity", NativeGraphLayerKind::VideoSynth => "videosynthReactivity", _ => "ghostfxReactivity" };
        let reactivity = native_graph_param_f32(&graph_layer.params, reactivity_key, 0.0, 1.0, 0.4);
        self.native_plugin_audio_smooth.retain(|id, _| self.native_graph_layers.contains_key(id));
        let envelope = self.native_plugin_audio_smooth.entry(graph_layer.layer_id.clone()).or_default();
        envelope.update(frame_index, delta, self.audio0, self.audio1, reactivity);
        let smooth = *envelope;
        // The template is replayed every frame, but its `clear` flags describe
        // INSTALL-time intent only. Replaying clear=true wipes persistent
        // state (fluid fields, particle trails) every frame — the sim can
        // never accumulate. Honor clear on the first run after install, then
        // force it off.
        if self
            .native_plugin_templates_initialized
            .contains(&graph_layer.layer_id)
        {
            for buffer in &mut job.buffers {
                buffer.clear = false;
            }
        } else {
            self.native_plugin_templates_initialized
                .insert(graph_layer.layer_id.clone());
        }
        let mut liquid_splat_count: Option<u32> = None;
        // GhostFX Liquid: regenerate the injection (splats) every frame in
        // the core. The installed template only carries frame-zero splats;
        // replaying them verbatim was the "liquid barely shows anything"
        // defect — a static, near-invisible drip. See the 128-byte uniform
        // branch below for the matching layout.
        if graph_layer.kind == NativeGraphLayerKind::GhostFx {
            let is_liquid = job.buffers.iter().any(|buffer| {
                matches!(buffer.kind, NativeComputeBufferBindingKind::Uniform)
                    && buffer.initial_bytes.len() == 128
            });
            if is_liquid {
                let state = self
                    .native_plugin_liquid_states
                    .entry(graph_layer.layer_id.clone())
                    .or_insert(NativePluginLiquidState {
                        ambient_accumulator: 0.0,
                    });
                let params = &graph_layer.params;
                let sensitivity =
                    native_graph_param_f32(params, "ghostfxSensitivity", 0.25, 4.0, 1.4);
                let hue_speed =
                    native_graph_param_f32(params, "ghostfxHueDriftSpeed", 0.0, 2.0, 0.15);
                let hue = (time * hue_speed).rem_euclid(1.0);
                let splat_radius =
                    native_graph_param_f32(params, "ghostfxLiquidSplatRadius", 0.01, 0.2, 0.08);
                let bass_rate =
                    native_graph_param_f32(params, "ghostfxLiquidBassRate", 0.0, 2.0, 1.0);
                let bass = (smooth.bass * sensitivity).clamp(0.0, 2.0);
                let energy = (smooth.energy * sensitivity).clamp(0.0, 2.0);
                state.ambient_accumulator += delta.max(0.0) * (2.0 + bass * 14.0) * bass_rate;
                let mut splats: Vec<[f32; 8]> = Vec::with_capacity(16);
                // Deterministic per-frame randomness (layer + frame seeded).
                let mut seed = stable_hash64(&format!("{}:{frame_index}", graph_layer.layer_id));
                let mut rand01 = move || {
                    seed = seed
                        .wrapping_mul(6364136223846793005)
                        .wrapping_add(1442695040888963407);
                    ((seed >> 33) as f64 / (u32::MAX as f64 + 1.0)) as f32
                };
                // 1) Three continuous Lissajous emitters with tangential
                //    swirl — the pool stays alive even in silence.
                for index in 0..3usize {
                    let phase = index as f32 / 3.0 * std::f32::consts::TAU;
                    let ax = 0.83 + index as f32 * 0.11;
                    let ay = 0.67 + index as f32 * 0.13;
                    let t = time * 0.35; // audio shapes force, never repositions elapsed-time phase
                    let x = 0.5 + 0.36 * (t * ax + phase).cos();
                    let y = 0.5 + 0.33 * (t * ay + phase * 1.7).sin();
                    let dxdt = -0.36 * ax * (t * ax + phase).sin();
                    let dydt = 0.33 * ay * (t * ay + phase * 1.7).cos();
                    let len = (dxdt * dxdt + dydt * dydt).sqrt().max(1e-4);
                    let fx = dxdt / len;
                    let fy = dydt / len;
                    let speed = 0.55 + energy * 1.1;
                    let swirl = if index % 2 == 0 { 1.0 } else { -1.0 };
                    let color = hsv_to_rgb((hue + index as f32 * 0.31).rem_euclid(1.0), 0.88, 1.0);
                    splats.push([
                        x,
                        y,
                        (fx * 0.7 - fy * 0.7 * swirl) * speed,
                        (fy * 0.7 + fx * 0.7 * swirl) * speed,
                        color[0],
                        color[1],
                        color[2],
                        splat_radius * (0.55 + energy * 0.35),
                    ]);
                }
                // Continuous bass-fed dye replaces discrete beat-ring impacts.
                // 3) Bass trickle: extra droplets while low end is present.
                while state.ambient_accumulator > 1.0 && splats.len() < 32 {
                    state.ambient_accumulator -= 1.0;
                    let angle = rand01() * std::f32::consts::TAU;
                    let speed = 0.25 + energy * 0.5;
                    let color = hsv_to_rgb((hue + rand01() * 0.6).rem_euclid(1.0), 0.75, 0.95);
                    splats.push([
                        rand01(),
                        rand01(),
                        angle.cos() * speed,
                        angle.sin() * speed,
                        color[0],
                        color[1],
                        color[2],
                        splat_radius * (0.5 + rand01() * 0.5),
                    ]);
                }
                splats.truncate(32);
                liquid_splat_count = Some(splats.len() as u32);
                for buffer in &mut job.buffers {
                    if !buffer.id.ends_with(":splats") || buffer.initial_bytes.len() < 1024 {
                        continue;
                    }
                    for (splat_index, splat) in splats.iter().enumerate() {
                        for (field_index, value) in splat.iter().enumerate() {
                            write_f32_le(
                                &mut buffer.initial_bytes,
                                splat_index * 8 + field_index,
                                *value,
                            );
                        }
                    }
                }
            }
        }
        // Scenes and the synth always get the frame block; an Interactive
        // layer gets it when its graph declares one (a 3D world in the
        // Studio, scene_frame::declares).
        let wants_frame = match graph_layer.kind {
            NativeGraphLayerKind::Scene3D | NativeGraphLayerKind::VideoSynth => graph_layer.params["scene3dPaused"] != true,
            NativeGraphLayerKind::PerformerWorld => {
                graph_layer.params["interactivePaused"] != true && scene_frame::declares(job.buffers.iter().map(|b| b.id.as_str()))
            }
            _ => false,
        };
        let scene_frame = wants_frame
            .then(|| {
                let beat_phase = self.audio1[2];
                self.scene_clock.advance(frame_index, beat_phase);
                scene_frame::SceneFrame {
                    time,
                    delta,
                    frame: frame_index,
                    audio_active: self.audio2[3] > 0.5,
                    bass: smooth.bass,
                    mid: smooth.mid,
                    treble: smooth.treble,
                    energy: smooth.energy,
                    beat: smooth.beat_env,
                    kick: self.audio2[1],
                    snare: self.audio2[2],
                    centroid: self.audio2[0],
                    tempo: self.audio1[3],
                    beat_phase,
                    bar_phase: self.scene_clock.bar_phase(beat_phase),
                    beats: self.scene_clock.beats(),
                }
            });
        for buffer in &mut job.buffers {
            if !matches!(buffer.kind, NativeComputeBufferBindingKind::Uniform) {
                continue;
            }
            // A 3D world inside an Interactive layer: like a scene, only its
            // frame block is the core's.
            if graph_layer.kind == NativeGraphLayerKind::PerformerWorld && buffer.id.starts_with(scene_frame::SCENE_BUFFER_PREFIX) {
                if buffer.id.ends_with(scene_frame::BUFFER_SUFFIX) {
                    match scene_frame.as_ref() {
                        Some(frame) => {
                            frame.write(&mut buffer.initial_bytes);
                        }
                        // Paused: hold the world still (no delta, no hits).
                        None => {
                            scene_frame::hold(&mut buffer.initial_bytes);
                        }
                    }
                }
                continue;
            }
            if matches!(graph_layer.kind, NativeGraphLayerKind::Scene3D | NativeGraphLayerKind::VideoSynth) {
                // Only the frame block is the core's; every other uniform of a
                // scene belongs to the app, which updates it in place.
                if let Some(frame) = scene_frame.as_ref() {
                    if buffer.id.ends_with(scene_frame::BUFFER_SUFFIX) {
                        frame.write(&mut buffer.initial_bytes);
                    }
                }
                continue;
            }
            // Interactive material settings contain light depth/power at slots
            // 2/3, not a render clock. Preserve authored values during replay.
            if graph_layer.kind == NativeGraphLayerKind::PerformerWorld
                && buffer.id.ends_with(":interactive:matter")
            {
                if buffer.initial_bytes.len() >= 192 && graph_layer.params["interactivePaused"] != true {
                    write_f32_le(&mut buffer.initial_bytes, 40, smooth.bass);
                    write_f32_le(&mut buffer.initial_bytes, 41, smooth.mid);
                    write_f32_le(&mut buffer.initial_bytes, 42, smooth.treble);
                    write_f32_le(&mut buffer.initial_bytes, 43, smooth.energy);
                    write_f32_le(&mut buffer.initial_bytes, 44, self.audio1[2]);
                    write_f32_le(&mut buffer.initial_bytes, 45, scene_frame::tempo_or_default(self.audio1[3]));
                }
                continue;
            }
            if graph_layer.kind == NativeGraphLayerKind::PerformerWorld
                && buffer.initial_bytes.len() == 80
            {
                // Performer worlds are a persistent native overlay. The
                // installed uniform owns world/space/XY parameters; only the
                // render clock and live audio envelope advance here.
                if graph_layer.params["interactivePaused"] != true {
                write_f32_le(&mut buffer.initial_bytes, 2, time);
                write_f32_le(&mut buffer.initial_bytes, 3, delta);
                write_f32_le(&mut buffer.initial_bytes, 10, smooth.energy);
                // The kick and snare hits (impulses, as in the 3D world's frame
                // block) in touch.xy, which an Interactive uniform leaves unused;
                // a Performer World keeps its pointer there.
                if buffer.id.ends_with(":interactive:uniform") {
                    write_f32_le(&mut buffer.initial_bytes, 8, self.audio2[1].clamp(0.0, 1.0));
                    write_f32_le(&mut buffer.initial_bytes, 9, self.audio2[2].clamp(0.0, 1.0));
                }
                if let Some(effects) = graph_layer.params["interactiveScene"]["effects"].as_array() {
                    // `...:<effect id>:interactive:uniform`: read the id out of the
                    // buffer name instead of formatting one string per effect per frame.
                    let effect_id = buffer.id.rsplit_once(":interactive:")
                        .and_then(|(prefix, _)| prefix.rsplit_once(':'))
                        .map(|(_, id)| id);
                    if let Some(effect) = effects.iter().find(|e| e["id"].as_str().is_some_and(|id| Some(id) == effect_id)) {
                        for (key, slot, min, max, fallback, scale) in [("energy",6,0.0,1.0,0.6,1.0),("gravity",7,-1.0,1.0,0.25,1.0),("hue",12,0.0,360.0,185.0,1.0/360.0),("trails",13,0.0,1.0,0.7,1.0),("opacity",18,0.0,1.0,1.0,1.0)] {
                            let base = effect["params"][key].as_f64().map(|v|v as f32).unwrap_or(fallback);
                            let m = &effect["mods"][key]; let source=m["source"].as_str().unwrap_or("manual");
                            // An unmodulated value belongs to the installed uniform, which the
                            // app updates in place (Auto, keyframes, sliders) without
                            // reinstalling the graph. Only a modulated slot is driven here.
                            if source=="manual" { continue; }
                            let speed=m["speed"].as_f64().unwrap_or(0.15) as f32;
                            let phase=time*speed*if m["bpmSync"]==true { scene_frame::tempo_or_default(self.audio1[3])/60.0 } else {1.0};
                            let mut signal=match source {"sub"|"bass"=>smooth.bass,"kick"=>self.audio2[1],"snare"=>self.audio2[2],"lowMid"=>(smooth.bass+smooth.mid)*0.5,"mid"=>smooth.mid,"highMid"=>(smooth.mid+smooth.treble)*0.5,"treble"|"air"|"presence"|"high"=>smooth.treble,"amplitude"=>smooth.energy,"beatPhase"=>self.audio1[2],"lfo-sine"=>0.5+0.5*(phase*std::f32::consts::TAU).sin(),"lfo-tri"=>1.0-(phase.rem_euclid(1.0)*2.0-1.0).abs(),"lfo-saw"=>phase.rem_euclid(1.0),"lfo-square"=>if phase.rem_euclid(1.0)<0.5 {1.0}else{0.0},_=>0.5};
                            let value=if source=="manual" {base} else if let (Some(lo),Some(hi))=(m["rangeMin"].as_f64(),m["rangeMax"].as_f64()) {if m["invert"]==true {signal=1.0-signal;}min+(lo as f32+(hi-lo) as f32*signal)*(max-min)} else {if !source.starts_with("lfo-")&&source!="beatPhase" {signal=0.5+signal*0.5;}if m["invert"]==true {signal=1.0-signal;}base+(signal-0.5)*m["amount"].as_f64().unwrap_or(0.5) as f32*(max-min)};
                            write_f32_le(&mut buffer.initial_bytes,slot,value.clamp(min,max)*scale);
                        }
                    }
                }
                }
                continue;
            }
            if matches!(
                graph_layer.kind,
                NativeGraphLayerKind::VjCrossfade | NativeGraphLayerKind::VjMix
            ) && buffer.initial_bytes.len() == 48
            {
                // VJ crossfade uniform (vjCrossfadeNative.ts): time at slot 3
                // animates glitch/liquid/strobe. Mix and transition are
                // updated in place by the renderer sync.
                write_f32_le(&mut buffer.initial_bytes, 3, time);
                continue;
            }
            if graph_layer.kind == NativeGraphLayerKind::VjCrossfade
                && buffer.initial_bytes.len() == 224
            {
                write_f32_le(&mut buffer.initial_bytes, 3, time);
                self.transition_clocks.retain(|id, _| self.native_graph_layers.contains_key(id));
                let token = graph_layer.params["vjclipClockToken"].as_u64();
                let duration = graph_layer.params["vjclipClockDuration"].as_f64().filter(|d| d.is_finite() && *d > 0.0 && *d <= 10.0);
                if self.render_clock_mode == "live" && token.is_some() && duration.is_some()
                    && graph_layer.params["vjclipClockRunning"] == true {
                    let progress = graph_layer.params["vjxfadeMix"].as_f64().filter(|p| p.is_finite()).unwrap_or(0.0);
                    let clock = self.transition_clocks.entry(graph_layer.layer_id.clone()).or_default();
                    let mix = transition_clock::TransitionClock::sample(clock, token.unwrap(), progress, duration.unwrap(), Instant::now());
                    write_f32_le(&mut buffer.initial_bytes, 2, mix);
                } else { self.transition_clocks.remove(&graph_layer.layer_id); }
                for (branch, (rect, ready)) in clip_sources.iter().enumerate() {
                    write_f32_le(&mut buffer.initial_bytes, 6 + branch, if *ready { 1.0 } else { 0.0 });
                    for (index, value) in rect.iter().enumerate() {
                        write_f32_le(&mut buffer.initial_bytes, 28 + branch * 24 + index, *value);
                    }
                }
                continue;
            }
            if graph_layer.kind == NativeGraphLayerKind::HandFx && buffer.initial_bytes.len() == 144 {
                write_f32_le(&mut buffer.initial_bytes, 2, time);
                write_f32_le(&mut buffer.initial_bytes, 3, delta);
                let amount = native_graph_param_f32(&graph_layer.params, "handfxAudioResponse", 0.0, 2.0, 0.65);
                write_f32_le(&mut buffer.initial_bytes, 35, (smooth.bass * 0.6 + smooth.energy * 0.4) * amount);
                continue;
            }
            if graph_layer.kind == NativeGraphLayerKind::GhostFx {
                if buffer.id.ends_with(":post-uniform") {
                    continue;
                }
                if buffer.initial_bytes.len() == 112 {
                    write_f32_le(&mut buffer.initial_bytes, 2, time);
                    write_f32_le(&mut buffer.initial_bytes, 3, delta);
                    let sensitivity = native_graph_param_f32(
                        &graph_layer.params,
                        "ghostfxSensitivity",
                        0.0,
                        4.0,
                        1.0,
                    );
                    write_f32_le(&mut buffer.initial_bytes, 4, smooth.bass * sensitivity);
                    write_f32_le(&mut buffer.initial_bytes, 5, smooth.mid * sensitivity);
                    write_f32_le(&mut buffer.initial_bytes, 6, smooth.treble * sensitivity);
                    write_f32_le(&mut buffer.initial_bytes, 7, smooth.bass);
                    write_f32_le(&mut buffer.initial_bytes, 8, smooth.mid);
                    write_f32_le(&mut buffer.initial_bytes, 9, smooth.treble);
                    write_f32_le(&mut buffer.initial_bytes, 10, smooth.energy);
                    write_f32_le(&mut buffer.initial_bytes, 11, self.audio1[2]);
                    write_f32_le(&mut buffer.initial_bytes, 12, smooth.beat_env);
                    write_f32_le(&mut buffer.initial_bytes, 13, smooth.energy);
                    let hue_speed = native_graph_param_f32(
                        &graph_layer.params,
                        "ghostfxHueDriftSpeed",
                        -8.0,
                        8.0,
                        0.08,
                    );
                    write_f32_le(
                        &mut buffer.initial_bytes,
                        14,
                        (time * hue_speed).rem_euclid(1.0),
                    );
                } else if buffer.initial_bytes.len() == 96 {
                    write_f32_le(&mut buffer.initial_bytes, 4, time);
                    write_f32_le(&mut buffer.initial_bytes, 5, delta);
                    write_f32_le(&mut buffer.initial_bytes, 6, self.audio0[1]);
                    write_f32_le(&mut buffer.initial_bytes, 7, self.audio0[2]);
                    write_f32_le(&mut buffer.initial_bytes, 8, self.audio0[3]);
                    write_f32_le(&mut buffer.initial_bytes, 9, self.audio0[0]);
                    write_f32_le(&mut buffer.initial_bytes, 10, self.audio1[2]);
                    write_f32_le(&mut buffer.initial_bytes, 11, self.audio1[1]);
                    let hue_speed = native_graph_param_f32(
                        &graph_layer.params,
                        "ghostfxHueDriftSpeed",
                        -8.0,
                        8.0,
                        0.08,
                    );
                    write_f32_le(
                        &mut buffer.initial_bytes,
                        12,
                        (time * hue_speed).rem_euclid(1.0),
                    );
                    write_u32_le(&mut buffer.initial_bytes, 18, 1);
                } else if buffer.initial_bytes.len() == 128 {
                    // GhostFX Liquid uniform (see liquid.wgsl.ts): live audio
                    // + params refresh, matching the TS pack offsets exactly.
                    let params = &graph_layer.params;
                    let sensitivity =
                        native_graph_param_f32(params, "ghostfxSensitivity", 0.25, 4.0, 1.4);
                    let hue_speed =
                        native_graph_param_f32(params, "ghostfxHueDriftSpeed", 0.0, 2.0, 0.15);
                    write_f32_le(&mut buffer.initial_bytes, 4, time);
                    write_f32_le(&mut buffer.initial_bytes, 5, delta.min(1.0 / 15.0));
                    write_f32_le(&mut buffer.initial_bytes, 6, smooth.bass * sensitivity);
                    write_f32_le(&mut buffer.initial_bytes, 7, smooth.mid * sensitivity);
                    write_f32_le(&mut buffer.initial_bytes, 8, smooth.treble * sensitivity);
                    write_f32_le(&mut buffer.initial_bytes, 9, smooth.energy * sensitivity);
                    write_f32_le(&mut buffer.initial_bytes, 10, self.audio1[2]);
                    write_f32_le(&mut buffer.initial_bytes, 11, smooth.beat_env);
                    write_f32_le(
                        &mut buffer.initial_bytes,
                        12,
                        (time * hue_speed).rem_euclid(1.0),
                    );
                    write_f32_le(
                        &mut buffer.initial_bytes,
                        13,
                        native_graph_param_f32(params, "ghostfxExposure", -1.0, 1.0, 0.1),
                    );
                    write_f32_le(
                        &mut buffer.initial_bytes,
                        14,
                        native_graph_param_f32(params, "ghostfxLiquidSplatForce", 0.2, 3.0, 1.0),
                    );
                    write_f32_le(
                        &mut buffer.initial_bytes,
                        15,
                        native_graph_param_f32(params, "ghostfxLiquidSplatRadius", 0.01, 0.2, 0.08),
                    );
                    write_f32_le(
                        &mut buffer.initial_bytes,
                        16,
                        native_graph_param_f32(params, "ghostfxLiquidDyeDecay", 0.985, 1.0, 0.995),
                    );
                    write_f32_le(
                        &mut buffer.initial_bytes,
                        17,
                        native_graph_param_f32(params, "ghostfxLiquidVelDecay", 0.95, 1.0, 0.996),
                    );
                    if let Some(count) = liquid_splat_count {
                        write_u32_le(&mut buffer.initial_bytes, 18, count);
                    }
                    write_f32_le(
                        &mut buffer.initial_bytes,
                        19,
                        native_graph_param_f32(params, "ghostfxLiquidVorticity", 0.0, 3.0, 1.3),
                    );
                    write_f32_le(
                        &mut buffer.initial_bytes,
                        20,
                        native_graph_param_f32(params, "ghostfxLiquidGloss", 0.0, 1.0, 0.7),
                    );
                    write_f32_le(
                        &mut buffer.initial_bytes,
                        21,
                        native_graph_param_f32(params, "ghostfxAmbient", 0.0, 1.0, 0.3),
                    );
                    write_f32_le(
                        &mut buffer.initial_bytes,
                        22,
                        native_graph_param_f32(params, "ghostfxLiquidDepth", 0.02, 1.0, 0.35),
                    );
                    write_f32_le(
                        &mut buffer.initial_bytes,
                        23,
                        native_graph_param_f32(params, "ghostfxLiquidBubbles", 0.0, 2.0, 1.0),
                    );
                    let azimuth =
                        native_graph_param_f32(params, "ghostfxLightAzimuth", 0.0, 360.0, 35.0)
                            .to_radians();
                    let elevation =
                        native_graph_param_f32(params, "ghostfxLightElevation", -90.0, 90.0, 55.0)
                            .to_radians();
                    write_f32_le(
                        &mut buffer.initial_bytes,
                        24,
                        elevation.cos() * azimuth.cos(),
                    );
                    write_f32_le(
                        &mut buffer.initial_bytes,
                        25,
                        elevation.cos() * azimuth.sin(),
                    );
                    write_f32_le(&mut buffer.initial_bytes, 26, elevation.sin().max(0.08));
                    write_f32_le(
                        &mut buffer.initial_bytes,
                        27,
                        native_graph_param_f32(params, "ghostfxLightStrength", 0.0, 2.0, 0.9),
                    );
                }
            } else if buffer.initial_bytes.len() >= 16 {
                write_f32_le(&mut buffer.initial_bytes, 2, time);
                write_f32_le(&mut buffer.initial_bytes, 3, delta);
            }
        }
        if graph_layer.kind == NativeGraphLayerKind::GhostFx && liquid_splat_count.is_none() {
            // Non-liquid GhostFX scenes keep the original single animated
            // splat driver (drift/ribbons use it as an accent input).
            for buffer in &mut job.buffers {
                if !buffer.id.ends_with(":splats") || buffer.initial_bytes.len() < 32 {
                    continue;
                }
                let energy = smooth.energy.clamp(0.0, 1.0);
                let phase = time * 0.7;
                write_f32_le(&mut buffer.initial_bytes, 0, 0.5 + phase.sin() * 0.28);
                write_f32_le(&mut buffer.initial_bytes, 1, 0.5 + phase.cos() * 0.24);
                write_f32_le(
                    &mut buffer.initial_bytes,
                    2,
                    phase.cos() * (0.15 + energy * 0.5),
                );
                write_f32_le(
                    &mut buffer.initial_bytes,
                    3,
                    -phase.sin() * (0.15 + energy * 0.5),
                );
                write_f32_le(&mut buffer.initial_bytes, 4, 0.25 + smooth.treble * 0.75);
                write_f32_le(&mut buffer.initial_bytes, 5, 0.35 + smooth.mid * 0.65);
                write_f32_le(&mut buffer.initial_bytes, 6, 0.8 + smooth.bass * 0.2);
                write_f32_le(&mut buffer.initial_bytes, 7, 0.025 + energy * 0.04);
            }
        }
        for render_plan in &mut job.render_plans {
            if let NativeComputeGraphRenderTarget::SourceFrame { seq, .. } = &mut render_plan.target
            {
                *seq = frame_index;
            }
        }
        job
    }

    pub(crate) fn native_graph_effect_frame_job(&self, template: &NativeGraphFrameJob) -> NativeGraphFrameJob {
        let mut job = template.clone();
        let time = self.native_graph_time_seconds();
        let delta = self.native_frame_delta();
        let frame_index = self.native_frame_index();
        for buffer in &mut job.buffers {
            if !matches!(buffer.kind, NativeComputeBufferBindingKind::Uniform)
                || buffer.initial_bytes.len() < 32
            {
                continue;
            }
            buffer.initial_bytes[8..12].copy_from_slice(&time.to_le_bytes());
            buffer.initial_bytes[12..16].copy_from_slice(&delta.to_le_bytes());
            buffer.initial_bytes[28..32].copy_from_slice(&(frame_index as f32).to_le_bytes());
        }
        for render_plan in &mut job.render_plans {
            if let NativeComputeGraphRenderTarget::SourceFrame { seq, .. } = &mut render_plan.target
            {
                *seq = frame_index;
            }
        }
        job
    }

    /// Record what the core actually resolved for an instrument layer this
    /// frame. Called from the graph-job builders with the POST-normalisation
    /// numbers, which is the only place that knows what the GPU will really
    /// run — the TS sync layer can only report the params it sent, and the
    /// core re-derives several of them (riders grid size / march + rider
    /// scaling from the `quality` enum, smoke-3d grid snapping, particle
    /// count clamping). Surfaced as `status.native_graph_workload`.
    pub(crate) fn record_native_graph_workload(&mut self, layer_id: &str, kind: &str, workload: Value) {
        let mut entry = serde_json::Map::new();
        entry.insert("layer_id".to_string(), Value::String(layer_id.to_string()));
        entry.insert("kind".to_string(), Value::String(kind.to_string()));
        if let Value::Object(fields) = workload {
            for (key, value) in fields {
                entry.insert(key, value);
            }
        }
        self.native_graph_workload
            .insert(layer_id.to_string(), Value::Object(entry));
    }

    pub(crate) fn native_graph_shader_source(
        &self,
        shader_id: &str,
        required_entry: &str,
    ) -> Result<(u64, Arc<str>), String> {
        let Some(record) = self.shader_registry.get(shader_id) else {
            return Err(format!("{shader_id} shader has not been precompiled"));
        };
        if NativeShaderSourceKind::from_label(&record.source_kind) != NativeShaderSourceKind::Wgsl {
            return Err(format!(
                "{shader_id} shader is {}, but native graph instruments require WGSL",
                record.source_kind
            ));
        }
        if !record
            .entry_points
            .iter()
            .any(|entry| entry == required_entry)
        {
            return Err(format!(
                "{shader_id} shader is missing required entry `{required_entry}`"
            ));
        }
        let source = self
            .shader_sources
            .get(shader_id)
            .cloned()
            .ok_or_else(|| format!("{shader_id} shader source missing"))?;
        Ok((record.source_hash, source))
    }

    pub(crate) fn apply_native_graph_layer(&mut self, command: &Value) {
        let Some(layer_id) = string_at(command, &["layer_id"]) else {
            return;
        };
        let kind_label = string_at(command, &["kind"])
            .or_else(|| string_at(command, &["instrument"]))
            .or_else(|| string_at(command, &["graph"]))
            .unwrap_or_else(|| "unknown".to_string());
        let kind = NativeGraphLayerKind::from_label(&kind_label);
        let source_id = string_at(command, &["instrument_source_id"])
            .or_else(|| string_at(command, &["instrumentSourceId"]))
            .or_else(|| string_at(command, &["source_id"]))
            .or_else(|| string_at(command, &["sourceId"]))
            .unwrap_or_else(|| format!("native-graph:{}:{}", kind.signature(), layer_id));
        let composite_source_id = string_at(command, &["composite_source_id"])
            .or_else(|| string_at(command, &["compositeSourceId"]))
            .unwrap_or_else(|| source_id.clone());
        let input_source_id = string_at(command, &["input_source_id"])
            .or_else(|| string_at(command, &["inputSourceId"]))
            .unwrap_or_default();
        let mut effect_job_template = command
            .get("effect_graph")
            .or_else(|| command.get("effectGraph"))
            .filter(|value| !value.is_null())
            .and_then(|config| match self.compute_graph_frame_job(config) {
                Ok(job) => Some(Arc::new(job)),
                Err(err) => {
                    // Loud on stderr: the broker forwards this to the app log,
                    // otherwise a bad template silently freezes the layer.
                    eprintln!(
                        "[GhostRenderCore] native graph effect template on layer `{layer_id}` failed: {err}"
                    );
                    self.last_shader_error = Some(format!(
                        "native graph effect template on layer `{layer_id}` failed: {err}"
                    ));
                    None
                }
            });
        if command.get("effect_graph").or_else(|| command.get("effectGraph"))
            .is_some_and(|config| !config.is_null()) && effect_job_template.is_none() {
            // Failed optional graph admission must preserve the outgoing
            // layer, not replace it with a carrier that cannot draw.
            return;
        }
        self.captured_graph_holds.remove(&layer_id);
        if let Some(template) = effect_job_template.as_ref() {
            let changed = self.native_graph_layers.get(&layer_id)
                .and_then(|layer| layer.effect_job_template.as_ref())
                .is_none_or(|old| graph_job_structure_signature(old) != graph_job_structure_signature(template));
            if changed && let Some(renderer) = self.renderer.as_ref() {
                for plan in &template.render_plans {
                    if let NativeComputeGraphRenderTarget::SourceFrame { slot, .. } = plan.target {
                        renderer.slot_readiness(slot).invalidate();
                    }
                }
            }
        }
        // Re-arm the template's first-run clear when its IDENTITY changes
        // (scene switch produces different buffer id prefixes). Param tweaks
        // reuse the same ids and must NOT reset accumulated sim state.
        if let Some(new_template) = effect_job_template.as_ref() {
            let new_key = new_template
                .buffers
                .first()
                .map(|buffer| buffer.id.clone())
                .unwrap_or_default();
            let old_key = self
                .native_graph_layers
                .get(&layer_id)
                .and_then(|layer| layer.effect_job_template.as_ref())
                .and_then(|template| template.buffers.first())
                .map(|buffer| buffer.id.clone())
                .unwrap_or_default();
            if new_key != old_key {
                self.native_plugin_templates_initialized.remove(&layer_id);
            }
        }
        let mut params = command.get("params").cloned().unwrap_or(Value::Null);
        // A late frontend snapshot may still describe the prepared, stopped
        // graph. Once native scheduling starts this token it owns the clock.
        if let Some(token) = self.scheduled_transition_tokens.get(&layer_id).copied() {
            if params["vjclipClockToken"].as_u64() == Some(token) && params["vjclipTransition"] == true {
                params["vjclipClockRunning"] = json!(true);
                params["vjxfadeMix"] = json!(0);
                if effect_job_template.is_none() {
                    effect_job_template = self.native_graph_layers.get(&layer_id)
                        .filter(|previous| previous.kind == kind && previous.source_id == source_id)
                        .and_then(|previous| previous.effect_job_template.clone());
                }
            } else { self.scheduled_transition_tokens.remove(&layer_id); }
        }
        if !kind.is_supported() {
            self.native_graph_layers.remove(&layer_id);
            self.last_shader_error = Some(format!(
                "native graph layer `{}` requested unsupported instrument `{}`",
                layer_id,
                kind.signature()
            ));
            return;
        }
        let time = self.native_graph_time_seconds();
        let previous_state = self
            .native_graph_layers
            .get(&layer_id)
            .filter(|existing| existing.kind == kind && existing.source_id == source_id)
            .map(|existing| existing.planet_state.clone())
            .unwrap_or_else(|| NativePlanetGraphState::new(time));
        let ink_params = normalize_ink_cloud_native_params(&params);
        let ink_seed_key = ink_cloud_seed_key(&ink_params);
        let previous_ink_state = self
            .native_graph_layers
            .get(&layer_id)
            .filter(|existing| existing.kind == kind && existing.source_id == source_id)
            .map(|existing| existing.ink_cloud_state.clone())
            .filter(|state| {
                state.particle_count == ink_params.particle_count && state.seed_key == ink_seed_key
            })
            .unwrap_or_else(|| {
                NativeInkCloudGraphState::new(ink_params.particle_count, ink_seed_key.clone(), time)
            });
        let smoke_params = normalize_smoke_3d_native_params(&params);
        let previous_smoke_state = self
            .native_graph_layers
            .get(&layer_id)
            .filter(|existing| existing.kind == kind && existing.source_id == source_id)
            .map(|existing| existing.smoke_3d_state.clone())
            .filter(|state| state.grid == smoke_params.grid_size)
            .unwrap_or_else(|| NativeSmoke3DGraphState::new(smoke_params.grid_size, time));
        let particle_params = normalize_particle_field_native_params(&params);
        let previous_particle_state = self
            .native_graph_layers
            .get(&layer_id)
            .filter(|existing| existing.kind == kind && existing.source_id == source_id)
            .map(|existing| existing.particle_field_state.clone())
            .filter(|state| {
                state.mode_id == particle_params.mode_id
                    && state.particle_count == particle_params.particle_count
            })
            .unwrap_or_else(|| {
                NativeParticleFieldGraphState::new(
                    particle_params.mode_id,
                    particle_params.particle_count,
                    time,
                )
            });
        let pixel_params = normalize_pixel_particles_native_params(&params);
        let previous_pixel_state = self
            .native_graph_layers
            .get(&layer_id)
            .filter(|existing| existing.kind == kind && existing.source_id == source_id)
            .map(|existing| existing.pixel_particles_state.clone())
            .filter(|state| {
                state.mode_id == pixel_params.mode_id
                    && state.particle_count == pixel_params.particle_count
                    && state.input_source_id == input_source_id
            })
            .unwrap_or_else(|| {
                NativePixelParticlesGraphState::new(
                    pixel_params.mode_id,
                    pixel_params.particle_count,
                    input_source_id.clone(),
                    time,
                )
            });
        let flythrough_params = normalize_flythrough_native_params(&params);
        let previous_flythrough_state = self
            .native_graph_layers
            .get(&layer_id)
            .filter(|existing| existing.kind == kind && existing.source_id == source_id)
            .map(|existing| existing.flythrough_state.clone())
            .filter(|state| {
                state.particle_count == flythrough_params.particle_count
                    && state.input_source_id == input_source_id
            })
            .unwrap_or_else(|| {
                NativeFlythroughGraphState::new(
                    flythrough_params.particle_count,
                    input_source_id.clone(),
                    time,
                )
            });
        let point_asset = self.native_point_cloud_assets.get(&layer_id);
        let point_signature = point_asset
            .map(|asset| asset.signature.clone())
            .unwrap_or_default();
        let point_count = point_asset.map(|asset| asset.point_count).unwrap_or(1);
        let previous_point_cloud_state = self
            .native_graph_layers
            .get(&layer_id)
            .filter(|existing| existing.kind == kind && existing.source_id == source_id)
            .map(|existing| existing.point_cloud_state.clone())
            .filter(|state| state.signature == point_signature && state.point_count == point_count)
            .unwrap_or_else(|| NativePointCloudGraphState::new(point_signature, point_count, time));
        let sphere_params = normalize_volumetric_spheres_native_params(&params);
        let sphere_seed_key = volumetric_spheres_seed_key(&sphere_params);
        let previous_sphere_state = self
            .native_graph_layers
            .get(&layer_id)
            .filter(|existing| existing.kind == kind && existing.source_id == source_id)
            .map(|existing| existing.volumetric_spheres_state.clone())
            .filter(|state| {
                state.sphere_count == sphere_params.sphere_count
                    && state.layout_id == sphere_params.layout_id
                    && state.seed_key == sphere_seed_key
            })
            .unwrap_or_else(|| {
                NativeVolumetricSpheresGraphState::new(
                    sphere_params.layout_id,
                    sphere_params.sphere_count,
                    sphere_seed_key.clone(),
                    time,
                )
            });
        let riders_params = normalize_smoke_riders_native_params(
            &params,
            0.0,
            0.0,
            matches!(kind, NativeGraphLayerKind::FluidRiders),
        );
        let riders_tiles = smoke_riders_tile_counts(self.pending_width, self.pending_height);
        let previous_smoke_riders_state = self
            .native_graph_layers
            .get(&layer_id)
            .filter(|existing| existing.kind == kind && existing.source_id == source_id)
            .map(|existing| existing.smoke_riders_state.clone())
            .filter(|state| {
                state.grid == riders_params.grid_size
                    && state.rider_count == riders_params.rider_count
                    && state.tile_count_x == riders_tiles.0
                    && state.tile_count_y == riders_tiles.1
            })
            .unwrap_or_else(|| {
                NativeSmokeRidersGraphState::new(
                    riders_params.grid_size,
                    riders_params.rider_count,
                    riders_tiles.0,
                    riders_tiles.1,
                    time,
                )
            });
        let previous_audio_visual = self
            .native_graph_layers
            .get(&layer_id)
            .filter(|existing| existing.kind == kind && existing.source_id == source_id)
            .map(|existing| (existing.strands_state.clone(), existing.cloud_pulse_state.clone()))
            .unwrap_or_default();
        let previous_av2 = self
            .native_graph_layers
            .get(&layer_id)
            .filter(|existing| existing.kind == kind && existing.source_id == source_id)
            .map(|existing| existing.av2_state.clone())
            .unwrap_or_default();
        let replaced_graph = self.native_graph_layers.insert(
            layer_id.clone(),
            NativeGraphLayer {
                layer_id: layer_id.clone(),
                source_id: source_id.clone(),
                input_source_id,
                kind: kind.clone(),
                params,
                effect_job_template,
                planet_state: previous_state,
                ink_cloud_state: previous_ink_state,
                smoke_3d_state: previous_smoke_state,
                particle_field_state: previous_particle_state,
                pixel_particles_state: previous_pixel_state,
                flythrough_state: previous_flythrough_state,
                point_cloud_state: previous_point_cloud_state,
                volumetric_spheres_state: previous_sphere_state,
                smoke_riders_state: previous_smoke_riders_state,
                strands_state: previous_audio_visual.0,
                cloud_pulse_state: previous_audio_visual.1,
                av2_state: previous_av2,
            },
        );
        let entry = self
            .scene_layers
            .entry(layer_id.clone())
            .or_insert_with(|| SceneLayer::new(layer_id, 0));
        entry.source_id = Some(composite_source_id.clone());
        entry.source_kind = source_kind(&format!("gpu:{}", kind.signature()));
        entry.shader_rendered = false;
        entry.preview_slot = None;
        if !composite_source_id.starts_with("effect-pass:") {
            entry.frame_slot = self.source_frame_slots.get(&composite_source_id).copied();
        }
        // A reused video layer may retain the decoder's centered sub-rect.
        // Graph outputs already cover their full canvas and must not inherit it.
        entry.source_rect = [0.0, 0.0, 1.0, 1.0];
        // Switching a GPU shader or its media input replaces the retained
        // graph without a remove command. Release the old graph's private
        // source frames now; otherwise repeated live edits fill the bounded
        // source-slot pool with pictures from no-longer-active shaders.
        if let Some(previous) = replaced_graph {
            for old_id in [previous.source_id, previous.input_source_id] {
                if !old_id.is_empty() {
                    self.release_media_source_if_orphaned(&old_id);
                }
            }
        }
    }

    pub(crate) fn apply_update_native_graph_buffer(&mut self, command: &Value) -> Result<(), String> {
        let layer_id = string_at(command, &["layer_id"])
            .ok_or_else(|| "native graph buffer update requires layer_id".to_string())?;
        let buffer_id = string_at(command, &["buffer_id"])
            .ok_or_else(|| "native graph buffer update requires buffer_id".to_string())?;
        let initial_b64 = string_at(command, &["initial_b64"])
            .ok_or_else(|| "native graph buffer update requires initial_b64".to_string())?;
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(initial_b64.as_bytes())
            .map_err(|err| {
                format!("native graph buffer `{buffer_id}` base64 decode failed: {err}")
            })?;
        let layer = self
            .native_graph_layers
            .get_mut(&layer_id)
            .ok_or_else(|| format!("native graph layer `{layer_id}` is not installed"))?;
        let template = layer
            .effect_job_template
            .as_mut()
            .map(Arc::make_mut)
            .ok_or_else(|| format!("native graph layer `{layer_id}` has no graph template"))?;
        let buffer = template
            .buffers
            .iter_mut()
            .find(|buffer| buffer.id == buffer_id)
            .ok_or_else(|| {
                format!("native graph layer `{layer_id}` has no buffer `{buffer_id}`")
            })?;
        if bytes.len() as u64 != buffer.byte_length {
            return Err(format!(
                "native graph buffer `{buffer_id}` expected {} bytes, received {}",
                buffer.byte_length,
                bytes.len()
            ));
        }
        buffer.initial_bytes = bytes;
        Ok(())
    }

    pub(crate) fn apply_remove_native_graph_layer(&mut self, command: &Value) {
        if let Some(layer_id) = string_at(command, &["layer_id"]) {
            for source_id in self.release_native_graph_layer_state(&layer_id) {
                self.release_media_source_if_orphaned(&source_id);
            }
        }
    }

    /// Tear down every trace of one native graph layer.
    ///
    /// Returns the source ids the graph owned so the caller can release
    /// their source frames once nothing references them anymore.
    ///
    /// Dropping the retained entry alone is not enough: the instrument's
    /// persistent GPU buffers are keyed off its source id, so a layer
    /// re-added under the same id would resume a fluid/particle sim from the
    /// state it had when it was deleted, and any still-queued frame job
    /// would keep painting the dead layer's `layer-frame:<id>` slot for
    /// whatever else binds it.
    pub(crate) fn release_native_graph_layer_state(&mut self, layer_id: &str) -> Vec<String> {
        self.scheduled_transition_tokens.remove(layer_id);
        self.transition_clocks.remove(layer_id);
        let removed = self.native_graph_layers.remove(layer_id);
        self.native_graph_workload.remove(layer_id);
        self.native_plugin_liquid_states.remove(layer_id);
        self.native_plugin_templates_initialized.remove(layer_id);
        let Some(graph_layer) = removed else {
            return Vec::new();
        };
        let mut owned_sources = vec![graph_layer.source_id.clone()];
        // Drop frame jobs already queued for this layer's targets so a
        // removed instrument cannot render one more frame into a slot.
        self.pending_native_graph_jobs.retain(|job| {
            !job.render_plans.iter().any(|plan| match &plan.target {
                NativeComputeGraphRenderTarget::SourceFrame { source_id, .. } => {
                    owned_sources.iter().any(|owned| owned == source_id)
                }
                _ => false,
            })
        });
        // Persistent compute-graph buffers are named
        // `<kind>:<safe-source-id>:<...>`; the trailing colon keeps
        // `layer-frame:a` from matching `layer-frame:ab`.
        let token = format!(":{}:", native_graph_buffer_safe_id(&graph_layer.source_id));
        if let Some(renderer) = self.renderer.as_mut() {
            let dropped = renderer.drop_native_compute_graph_buffers_containing(&token);
            if dropped > 0 {
                self.stats.vram_evictions = self.stats.vram_evictions.saturating_add(dropped as u64);
            }
            self.stats.compute_graph_persistent_buffers =
                renderer.native_compute_graph_buffer_count() as u64;
        }
        if !graph_layer.input_source_id.is_empty() {
            owned_sources.push(graph_layer.input_source_id.clone());
        }
        owned_sources
    }

    /// An offline render starts every simulation (particles, fluids, the
    /// Interactive Studio's worlds, GhostFX) from its first frame, not from
    /// wherever the live show had taken it, so two renders of a show come out
    /// the same. Each graph's persistent buffers are dropped and re-made from
    /// its template on the next step; the layers themselves stay installed.
    pub(crate) fn reset_native_graph_simulations(&mut self) {
        let tokens: Vec<String> = self
            .native_graph_layers
            .values()
            .map(|layer| format!(":{}:", native_graph_buffer_safe_id(&layer.source_id)))
            .collect();
        if let Some(renderer) = self.renderer.as_mut() {
            for token in &tokens {
                renderer.drop_native_compute_graph_buffers_containing(token);
            }
            self.stats.compute_graph_persistent_buffers = renderer.native_compute_graph_buffer_count() as u64;
        }
        self.native_plugin_templates_initialized.clear();
        self.native_plugin_liquid_states.clear();
        self.native_plugin_audio_smooth.clear();
        self.scene_clock = scene_frame::SceneClock::default();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plugin_audio_envelopes_glide_on_transients_and_settle_in_silence() {
        for fps in [30.0_f32, 60.0, 120.0] {
            for reactivity in [0.0, 0.4, 1.0] {
                let mut envelope = super::NativePluginAudioSmooth::default();
                envelope.update(1, 1.0 / fps, [1.0; 4], [0.0, 1.0, 0.0, 0.0], reactivity);
                assert!(envelope.bass < 0.13, "one kick cannot jump the scene scale");
                assert!(envelope.beat_env < 0.12, "beat attack must be continuous");
                let first = envelope.bass;
                envelope.update(1, 1.0 / fps, [1.0; 4], [1.0; 4], reactivity);
                assert_eq!(first, envelope.bass, "one update per rendered frame");
                for frame in 2..(fps as u64 * 4) {
                    envelope.update(frame, 1.0 / fps, [1.0; 4], [0.0; 4], reactivity);
                }
                assert!(envelope.bass > 0.99, "sustained music must remain expressive");
                for frame in (fps as u64 * 4)..(fps as u64 * 16) {
                    envelope.update(frame, 1.0 / fps, [0.0; 4], [0.0; 4], reactivity);
                }
                assert!(envelope.energy < 0.01);
                assert!(envelope.bass < 0.01);
            }
        }
    }

    #[test]
    fn nested_graph_dependencies_override_kind_and_id_order() {
        // Screen, deck fade, clip fade, and its outgoing generator arrive in
        // deliberately reversed order. Same-kind nesting must still work.
        let dependencies = vec![HashSet::from([1]), HashSet::from([2]),
            HashSet::from([3]), HashSet::new()];
        assert_eq!(graph_dependency_order(&dependencies), [3, 2, 1, 0]);
        assert_eq!(graph_dependency_order(&[HashSet::from([1]), HashSet::from([0])]), [0, 1]);
    }

    fn graph_test_job(output: usize, input: Option<usize>) -> NativeGraphFrameJob {
        NativeGraphFrameJob { textures: Vec::new(), buffers: Vec::new(), pass_plans: Vec::new(), readback_buffer_ids: Vec::new(),
            render_plans: vec![NativeComputeGraphRenderPlan {
                name: "test".into(), cache_key: "shader".into(), source: Arc::from(""),
                vertex_entry: "vs".into(), fragment_entry: "fs".into(), clear: true,
                include_snapshot: false, generate_mips: false,
                target: NativeComputeGraphRenderTarget::SourceFrame { source_id: format!("out{output}"), slot: output, seq: 0 },
                blend: NativeComputeGraphRenderBlend::Replace, vertex_count: 3, instance_count: 1,
                indirect_buffer_id: None, indirect_offset: 0, clear_color: [0.0; 4],
                primitive_topology: NativeComputeGraphPrimitiveTopology::TriangleList,
                depth_enabled: false, depth_write: false, depth_compare: NativeComputeGraphDepthCompare::Always,
                depth_load: false,
                depth_texture_id: None,
                depth_only: false,
                bindings: input.into_iter().map(|slot| NativeComputeGraphBindingSpec {
                    binding: 2, resource_id: format!("out{slot}"), source_slot: Some(slot),
                    kind: NativeComputeGraphBindingKind::SourceFrameTexture(NativeComputeGraphTextureDimension::D2),
                }).collect(),
            }] }
    }

    #[test]
    fn queued_effect_jobs_run_before_persistent_transition_readers() {
        let jobs = [graph_test_job(3, Some(2)), graph_test_job(2, Some(1)), graph_test_job(1, None)];
        assert_eq!(graph_frame_job_order(&jobs), [2, 1, 0]);
    }

    #[test]
    fn graph_readiness_changes_with_inputs_but_not_frame_sequence() {
        let job = graph_test_job(3, Some(2));
        let signature = graph_job_structure_signature(&job);
        let mut next = job.clone();
        if let NativeComputeGraphRenderTarget::SourceFrame { seq, .. } = &mut next.render_plans[0].target {
            *seq = 123;
        }
        assert_eq!(graph_job_structure_signature(&next), signature);
        next.render_plans[0].bindings[0].resource_id = "next-clip".into();
        assert_ne!(graph_job_structure_signature(&next), signature);
    }

    #[test]
    fn reused_source_slot_cannot_inherit_gpu_readiness() {
        let state = SourceFrameGpuReadiness::default();
        assert!(!state.ready());
        state.invalidate();
        state.submitted_epoch.store(1, Ordering::Release);
        assert!(state.submitted());
        assert!(!state.ready());
        state.completed_epoch.store(1, Ordering::Release);
        assert!(state.ready());
        state.invalidate();
        assert!(!state.submitted());
        assert!(!state.ready());
        state.completed_epoch.fetch_max(2, Ordering::AcqRel);
        state.completed_epoch.fetch_max(1, Ordering::AcqRel);
        assert!(state.ready());
    }

    #[test]
    fn clip_snapshot_names_bound_resource_ownership_to_two_decks() {
        assert!(is_clip_snapshot_source_id("vj-clip-snapshot-A-0"));
        assert!(is_clip_snapshot_source_id("vj-clip-snapshot-B-31"));
        for name in ["media:video", "vj-clip-snapshot-A-32", "vj-clip-snapshot-B-01",
            "vj-clip-snapshot-C-0", "vj-clip-snapshot-A--1", "vj-clip-snapshot-A-0-extra"] {
            assert!(!is_clip_snapshot_source_id(name));
        }
    }

    #[test]
    fn vj_graph_jobs_run_after_the_frames_they_sample() {
        // Ids chosen so plain id order would put the mix and the Screen
        // copies ahead of the crossfade carrier they read.
        let mut layers = vec![
            (NativeGraphLayerKind::VjMix, "__vj-mix__"),
            (NativeGraphLayerKind::VjMix, "0a-screen"),
            (NativeGraphLayerKind::VjCrossfade, "vj-xfade-0"),
            (NativeGraphLayerKind::VjCrossfade, "1b-screen"),
            (NativeGraphLayerKind::Flythrough, "vj-layer-0-B"),
            (NativeGraphLayerKind::GhostFx, "vj-layer-1-A"),
            // A Music Studio row: a mix that is the row's own content.
            (NativeGraphLayerKind::VjMix, "vj-layer-2-A"),
        ];
        layers.sort_by(|a, b| graph_layer_frame_order((&a.0, a.1), (&b.0, b.1)));
        let ids = layers.iter().map(|(_, id)| *id).collect::<Vec<_>>();
        assert_eq!(
            ids,
            ["vj-layer-0-B", "vj-layer-1-A", "vj-layer-2-A", "1b-screen", "vj-xfade-0", "__vj-mix__", "0a-screen"]
        );
    }
}
