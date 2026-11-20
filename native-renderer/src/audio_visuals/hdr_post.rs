//! HDR feedback + post chain any core-built graph instrument can opt into.
//!
//! Per frame, in order:
//!   1. feedback: the previous accumulation, advected (outward drift, swirl)
//!      and decayed, drawn into this frame's accumulation (two float targets
//!      that swap every frame);
//!   2. the instrument draws additively into `scene_id`;
//!   3. bloom: a 6-level 13-tap downsample pyramid and a tent upsample back;
//!   4. composite: scene + bloom, chromatic split, exposure, a hue-keeping
//!      filmic tone map, sRGB encode and a one-step dither, into the layer's
//!      source frame.
//!
//! Everything is sized from the output (times a quality scale, capped), so the
//! textures follow an output resize and stay bounded. The textures live in the
//! graph texture pool, which frees them when the layer goes away.

use crate::compute_graph::{
    NativeComputeBufferBindingKind, NativeComputeGraphBindingKind, NativeComputeGraphBindingSpec,
    NativeComputeGraphBufferSpec, NativeComputeGraphDepthCompare, NativeComputeGraphPrimitiveTopology,
    NativeComputeGraphRenderBlend, NativeComputeGraphRenderPlan, NativeComputeGraphRenderTarget,
    NativeComputeGraphTextureSpec, NativeGraphTextureFormat,
};

use super::shaders::{CoreShader, HDR_POST, core_shader};

pub const BLOOM_LEVELS: usize = 6;
/// Largest accumulation side: 4K-wide output still renders at most this wide.
pub const MAX_ACCUM_WIDTH: u32 = 2560;
pub const MAX_ACCUM_HEIGHT: u32 = 1440;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct HdrPostSettings {
    /// Fraction kept per 1/60 s (0 = no trails).
    pub decay: f32,
    /// Outward drift per 1/60 s, as a fraction of the picture.
    pub zoom: f32,
    pub swirl: f32,
    pub flow: f32,
    pub bloom_strength: f32,
    pub threshold: f32,
    pub split: f32,
    pub exposure: f32,
    pub vignette: f32,
    pub dither: f32,
    pub burn: f32,
    /// Colour of the glow (linear rgb).
    pub tint: [f32; 3],
}

impl Default for HdrPostSettings {
    fn default() -> Self {
        Self {
            decay: 0.86,
            zoom: 0.002,
            swirl: 0.0,
            flow: 0.0,
            bloom_strength: 0.9,
            threshold: 0.35,
            split: 0.004,
            exposure: 1.0,
            vignette: 0.35,
            dither: 1.0,
            burn: 0.55,
            tint: [1.0, 1.0, 1.0],
        }
    }
}

/// The accumulation size for an output, scaled and capped, keeping aspect.
pub fn accumulation_size(output_width: u32, output_height: u32, scale: f32) -> (u32, u32) {
    let w = (output_width.max(16) as f32 * scale.clamp(0.25, 1.0)).round();
    let h = (output_height.max(16) as f32 * scale.clamp(0.25, 1.0)).round();
    let fit = (MAX_ACCUM_WIDTH as f32 / w).min(MAX_ACCUM_HEIGHT as f32 / h).min(1.0);
    (((w * fit).round() as u32).max(16), ((h * fit).round() as u32).max(16))
}

pub fn bloom_level_size(width: u32, height: u32, level: usize) -> (u32, u32) {
    ((width >> (level + 1)).max(1), (height >> (level + 1)).max(1))
}

pub struct HdrPostPlan {
    pub textures: Vec<NativeComputeGraphTextureSpec>,
    pub buffers: Vec<NativeComputeGraphBufferSpec>,
    /// Draw this first (clears and fills the scene with the decayed past).
    pub feedback: NativeComputeGraphRenderPlan,
    /// The texture the instrument draws into, additively, after `feedback`.
    pub scene_id: String,
    /// Bloom and composite, after the instrument's draws.
    pub finish: Vec<NativeComputeGraphRenderPlan>,
}

pub(crate) fn buffer_binding(binding: u32, id: &str, kind: NativeComputeBufferBindingKind) -> NativeComputeGraphBindingSpec {
    NativeComputeGraphBindingSpec {
        binding,
        resource_id: id.to_string(),
        kind: NativeComputeGraphBindingKind::Buffer(kind),
        source_slot: None,
    }
}

fn texture_binding(binding: u32, id: &str) -> NativeComputeGraphBindingSpec {
    NativeComputeGraphBindingSpec {
        binding,
        resource_id: id.to_string(),
        kind: NativeComputeGraphBindingKind::GraphTexture,
        source_slot: None,
    }
}

fn sampler_binding(binding: u32) -> NativeComputeGraphBindingSpec {
    NativeComputeGraphBindingSpec {
        binding,
        resource_id: "source-frame-sampler".to_string(),
        kind: NativeComputeGraphBindingKind::SourceFrameSampler,
        source_slot: None,
    }
}

pub(crate) fn uniform_spec(id: String, floats: &[f32]) -> NativeComputeGraphBufferSpec {
    let mut bytes: Vec<u8> = bytemuck::cast_slice(floats).to_vec();
    bytes.resize(bytes.len().div_ceil(16) * 16, 0);
    NativeComputeGraphBufferSpec {
        id,
        byte_length: bytes.len() as u64,
        kind: NativeComputeBufferBindingKind::Uniform,
        initial_bytes: bytes,
        persistent: true,
        clear: false,
        indirect: false,
    }
}

/// A render plan with the core's usual cache key. `instances`/`vertices`
/// describe the draw; no depth.
#[allow(clippy::too_many_arguments)]
pub(crate) fn render_plan(
    name: String,
    shader: &CoreShader,
    vertex_entry: &str,
    fragment_entry: &str,
    target: NativeComputeGraphRenderTarget,
    clear: bool,
    blend: NativeComputeGraphRenderBlend,
    vertex_count: u32,
    instance_count: u32,
    bindings: Vec<NativeComputeGraphBindingSpec>,
) -> NativeComputeGraphRenderPlan {
    let layout = crate::native_graph_binding_layout_signature(&bindings);
    NativeComputeGraphRenderPlan {
        name,
        cache_key: format!(
            "graph-render:{}:{}:{vertex_entry}:{fragment_entry}:{}:{}:nodepth:read:{}:{layout}",
            shader.id,
            shader.hash,
            blend.signature(),
            NativeComputeGraphPrimitiveTopology::TriangleList.signature(),
            NativeComputeGraphDepthCompare::Less.signature(),
        ),
        source: shader.source.clone(),
        vertex_entry: vertex_entry.to_string(),
        fragment_entry: fragment_entry.to_string(),
        clear,
        include_snapshot: false,
        generate_mips: false,
        target,
        blend,
        vertex_count,
        instance_count,
        indirect_buffer_id: None,
        indirect_offset: 0,
        clear_color: [0.0, 0.0, 0.0, 0.0],
        primitive_topology: NativeComputeGraphPrimitiveTopology::TriangleList,
        depth_enabled: false,
        depth_write: false,
        depth_compare: NativeComputeGraphDepthCompare::Less,
        depth_load: false,
        depth_texture_id: None,
        depth_only: false,
        bindings,
    }
}

fn hdr_texture(id: String, width: u32, height: u32) -> NativeComputeGraphTextureSpec {
    NativeComputeGraphTextureSpec { id, width, height, format: NativeGraphTextureFormat::Rgba16Float, mips: false }
}

/// Plan this frame's post chain. `parity` swaps the two accumulation targets.
#[allow(clippy::too_many_arguments)]
pub fn plan_hdr_post(
    prefix: &str,
    width: u32,
    height: u32,
    parity: bool,
    settings: &HdrPostSettings,
    dt: f32,
    time: f32,
    frame: u64,
    output: NativeComputeGraphRenderTarget,
) -> HdrPostPlan {
    let shader = core_shader(HDR_POST);
    let id = |name: &str| format!("{prefix}:post:{name}");
    let accum = [id("accum-a"), id("accum-b")];
    let (scene_id, prev_id) = if parity { (accum[1].clone(), accum[0].clone()) } else { (accum[0].clone(), accum[1].clone()) };
    let down: Vec<String> = (0..BLOOM_LEVELS).map(|level| id(&format!("down-{level}"))).collect();
    let up: Vec<String> = (0..BLOOM_LEVELS - 1).map(|level| id(&format!("up-{level}"))).collect();

    let mut textures = vec![hdr_texture(accum[0].clone(), width, height), hdr_texture(accum[1].clone(), width, height)];
    for level in 0..BLOOM_LEVELS {
        let (w, h) = bloom_level_size(width, height, level);
        textures.push(hdr_texture(down[level].clone(), w, h));
        if level < BLOOM_LEVELS - 1 {
            textures.push(hdr_texture(up[level].clone(), w, h));
        }
    }

    // Frame-rate independent trails: the settings are per 1/60 s.
    let steps = (dt * 60.0).clamp(0.0, 4.0);
    let decay = settings.decay.clamp(0.0, 0.995).powf(steps);
    let zoom = settings.zoom * steps;
    let swirl = settings.swirl * steps;
    let aspect = width as f32 / height.max(1) as f32;
    let post_u = |src: (u32, u32), dst: (u32, u32)| -> Vec<f32> {
        vec![
            1.0 / src.0 as f32, 1.0 / src.1 as f32, 1.0 / dst.0 as f32, 1.0 / dst.1 as f32,
            settings.bloom_strength, settings.split, settings.exposure, settings.threshold,
            settings.vignette, settings.dither, (frame % 4096) as f32, settings.burn,
            decay, zoom, swirl, aspect,
            time, settings.flow * steps, BLOOM_LEVELS as f32, 0.0,
            settings.tint[0], settings.tint[1], settings.tint[2], 0.0,
        ]
    };
    let mut buffers = Vec::new();
    let mut pass = |name: &str, fragment: &str, target: NativeComputeGraphRenderTarget, src: &str, add: Option<&str>, src_size: (u32, u32), dst_size: (u32, u32)| {
        let uniform_id = id(&format!("u:{name}"));
        buffers.push(uniform_spec(uniform_id.clone(), &post_u(src_size, dst_size)));
        let mut bindings = vec![
            buffer_binding(0, &uniform_id, NativeComputeBufferBindingKind::Uniform),
            texture_binding(1, src),
            sampler_binding(2),
        ];
        if let Some(add) = add {
            bindings.push(texture_binding(3, add));
        }
        render_plan(
            format!("{prefix}:{name}"),
            shader,
            "vs_full",
            fragment,
            target,
            true,
            NativeComputeGraphRenderBlend::Replace,
            3,
            1,
            bindings,
        )
    };
    let full = (width, height);
    let feedback = pass(
        "feedback",
        "fs_feedback",
        NativeComputeGraphRenderTarget::GraphTexture { id: scene_id.clone() },
        &prev_id,
        None,
        full,
        full,
    );
    let mut finish = Vec::with_capacity(BLOOM_LEVELS * 2 + 1);
    for level in 0..BLOOM_LEVELS {
        let (src, src_size) = if level == 0 {
            (scene_id.clone(), full)
        } else {
            (down[level - 1].clone(), bloom_level_size(width, height, level - 1))
        };
        finish.push(pass(
            &format!("down-{level}"),
            if level == 0 { "fs_down_first" } else { "fs_down" },
            NativeComputeGraphRenderTarget::GraphTexture { id: down[level].clone() },
            &src,
            None,
            src_size,
            bloom_level_size(width, height, level),
        ));
    }
    for level in (0..BLOOM_LEVELS - 1).rev() {
        let (coarser, coarser_size) = if level == BLOOM_LEVELS - 2 {
            (down[level + 1].clone(), bloom_level_size(width, height, level + 1))
        } else {
            (up[level + 1].clone(), bloom_level_size(width, height, level + 1))
        };
        finish.push(pass(
            &format!("up-{level}"),
            "fs_up",
            NativeComputeGraphRenderTarget::GraphTexture { id: up[level].clone() },
            &coarser,
            Some(&down[level]),
            coarser_size,
            bloom_level_size(width, height, level),
        ));
    }
    finish.push(pass("composite", "fs_composite", output, &scene_id, Some(&up[0]), full, full));
    HdrPostPlan { textures, buffers, feedback, scene_id, finish }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plan(parity: bool) -> HdrPostPlan {
        plan_hdr_post(
            "layer",
            1920,
            1080,
            parity,
            &HdrPostSettings::default(),
            1.0 / 60.0,
            1.0,
            3,
            NativeComputeGraphRenderTarget::Snapshot,
        )
    }

    #[test]
    fn accumulation_follows_the_output_and_stays_bounded() {
        assert_eq!(accumulation_size(1920, 1080, 1.0), (1920, 1080));
        assert_eq!(accumulation_size(1920, 1080, 0.5), (960, 540));
        let (w, h) = accumulation_size(7680, 4320, 1.0);
        assert!(w <= MAX_ACCUM_WIDTH && h <= MAX_ACCUM_HEIGHT);
        assert!((w as f32 / h as f32 - 16.0 / 9.0).abs() < 0.01);
    }

    #[test]
    fn accumulation_targets_swap_each_frame_and_never_read_what_they_write() {
        let even = plan(false);
        let odd = plan(true);
        assert_ne!(even.scene_id, odd.scene_id);
        for p in [&even, &odd] {
            for render in std::iter::once(&p.feedback).chain(p.finish.iter()) {
                if let NativeComputeGraphRenderTarget::GraphTexture { id } = &render.target {
                    assert!(
                        render.bindings.iter().all(|binding| &binding.resource_id != id),
                        "{} samples its own target",
                        render.name
                    );
                }
            }
        }
    }

    #[test]
    fn chain_is_feedback_then_bloom_down_up_then_composite() {
        let p = plan(false);
        assert_eq!(p.feedback.fragment_entry, "fs_feedback");
        assert_eq!(p.finish.len(), BLOOM_LEVELS + (BLOOM_LEVELS - 1) + 1);
        assert_eq!(p.finish[0].fragment_entry, "fs_down_first");
        assert_eq!(p.finish[BLOOM_LEVELS].fragment_entry, "fs_up");
        assert_eq!(p.finish.last().unwrap().fragment_entry, "fs_composite");
        assert!(matches!(p.finish.last().unwrap().target, NativeComputeGraphRenderTarget::Snapshot));
        // Every texture a pass reads or writes is declared.
        let declared: Vec<&str> = p.textures.iter().map(|t| t.id.as_str()).collect();
        for render in std::iter::once(&p.feedback).chain(p.finish.iter()) {
            for binding in &render.bindings {
                if matches!(binding.kind, NativeComputeGraphBindingKind::GraphTexture) {
                    assert!(declared.contains(&binding.resource_id.as_str()), "{}", binding.resource_id);
                }
            }
        }
    }

    #[test]
    fn texture_memory_is_bounded_at_1080p() {
        let p = plan(false);
        let bytes: u64 = p.textures.iter().map(|t| t.width as u64 * t.height as u64 * 8).sum();
        assert!(bytes < 48 * 1024 * 1024, "{bytes}");
        assert_eq!(p.textures.len(), 2 + BLOOM_LEVELS + BLOOM_LEVELS - 1);
    }

    #[test]
    fn trails_decay_the_same_per_second_at_any_frame_rate() {
        let at = |dt: f32, frames: usize| {
            let settings = HdrPostSettings { decay: 0.8, ..HdrPostSettings::default() };
            let p = plan_hdr_post("l", 64, 64, false, &settings, dt, 0.0, 0, NativeComputeGraphRenderTarget::Snapshot);
            let decay = f32::from_le_bytes(p.buffers[0].initial_bytes[48..52].try_into().unwrap());
            decay.powi(frames as i32)
        };
        assert!((at(1.0 / 60.0, 60) - at(1.0 / 30.0, 30)).abs() < 1e-3);
    }
}
