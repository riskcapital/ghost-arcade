//! Small helpers shared by the second set of audio-reactive instruments
//! (Ribbon Field, Shockwave Rings, Fluid Ink, Arcs, Spectral Terrain, Mesh
//! Shatter): a look-at camera, quality tiers, depth-tested render plans,
//! fullscreen passes and onset intake.

use crate::compute_graph::{
    NativeComputeGraphBindingKind, NativeComputeGraphBindingSpec, NativeComputeGraphRenderBlend,
    NativeComputeGraphRenderPlan, NativeComputeGraphRenderTarget, NativeComputeGraphTextureSpec,
    NativeGraphTextureFormat,
};
use serde_json::Value;

use super::audio_data::{AudioVisualData, OnsetEvent};
use super::hdr_post::render_plan;
use super::params::{Palette3, text};
use super::shaders::CoreShader;

pub type Mat4 = [[f32; 4]; 4];

/// Quality tier: 0 low, 1 medium (the default), 2 high ("ultra" reads as high).
pub fn tier(params: &Value) -> usize {
    match text(params, "quality").as_str() {
        "low" | "performance" => 0,
        "high" | "ultra" | "insane" => 2,
        _ => 1,
    }
}

pub fn pick<T: Copy>(params: &Value, tiers: [T; 3]) -> T {
    tiers[tier(params)]
}

/// Like `pick`, with the instrument's own default tier when none is set.
pub fn pick_or<T: Copy>(params: &Value, tiers: [T; 3], default_tier: usize) -> T {
    match text(params, "quality").as_str() {
        "low" | "performance" => tiers[0],
        "medium" => tiers[1],
        "high" | "ultra" | "insane" => tiers[2],
        _ => tiers[default_tier.min(2)],
    }
}

pub fn palette_named(table: &[(&str, Palette3)], params: &Value) -> Palette3 {
    let name = text(params, "palette");
    table.iter().find(|(id, _)| *id == name).map(|(_, p)| *p).unwrap_or(table[0].1)
}

/// The glow tint the post chain uses: the palette's mid tone half way to white.
pub fn glow_tint(p: &Palette3) -> [f32; 3] {
    let m = p.mid;
    let peak = m[0].max(m[1]).max(m[2]).max(1e-3);
    [0.5 + 0.5 * m[0] / peak, 0.5 + 0.5 * m[1] / peak, 0.5 + 0.5 * m[2] / peak]
}

pub fn palette_floats(p: &Palette3) -> [f32; 12] {
    [
        p.core[0], p.core[1], p.core[2], p.core[3], p.mid[0], p.mid[1], p.mid[2], p.mid[3], p.fringe[0], p.fringe[1],
        p.fringe[2], p.fringe[3],
    ]
}

/// Hits the instrument has not seen yet, oldest first, at most `limit`, with
/// each hit's birth on the core clock. Older hits it skipped are never replayed.
pub fn fresh_hits(data: &AudioVisualData, last_seq: &mut u32, now: f32, limit: usize) -> Vec<(OnsetEvent, f32)> {
    if !data.active() {
        return Vec::new();
    }
    let fresh = data.events_after(*last_seq, limit);
    if let Some(last) = data.event(0) {
        *last_seq = (*last_seq).max(last.seq);
    }
    fresh
        .into_iter()
        .map(|event| {
            let age = (data.time() - event.time).clamp(0.0, 0.5);
            (event, now - age)
        })
        .collect()
}

pub fn hash01(seed: u32) -> f32 {
    let mut x = seed.wrapping_mul(0x9E37_79B9) ^ 0x85EB_CA6B;
    x ^= x >> 16;
    x = x.wrapping_mul(0x7FEB_352D);
    x ^= x >> 15;
    x = x.wrapping_mul(0x846C_A68B);
    x ^= x >> 16;
    x as f32 / u32::MAX as f32
}

fn mat_mul(a: &Mat4, b: &Mat4) -> Mat4 {
    let mut out = [[0.0; 4]; 4];
    for (c, column) in out.iter_mut().enumerate() {
        for (r, cell) in column.iter_mut().enumerate() {
            *cell = (0..4).map(|k| a[k][r] * b[c][k]).sum();
        }
    }
    out
}

fn sub(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

fn cross(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

fn dot3(a: [f32; 3], b: [f32; 3]) -> f32 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

fn norm(a: [f32; 3]) -> [f32; 3] {
    let len = dot3(a, a).sqrt().max(1e-8);
    [a[0] / len, a[1] / len, a[2] / len]
}

#[derive(Clone, Copy, Debug)]
pub struct Camera {
    pub eye: [f32; 3],
    pub forward: [f32; 3],
    pub view_proj: Mat4,
}

impl Camera {
    /// view_proj (16 floats, column-major) then eye xyz + `w`.
    pub fn floats(&self, w: f32) -> Vec<f32> {
        let mut u: Vec<f32> = self.view_proj.iter().flatten().copied().collect();
        u.extend_from_slice(&[self.eye[0], self.eye[1], self.eye[2], w]);
        u
    }
}

/// Right-handed look-at with a roll (radians), depth 0..1 (wgpu clip space).
pub fn look_at(eye: [f32; 3], target: [f32; 3], roll: f32, fov: f32, aspect: f32, near: f32, far: f32) -> Camera {
    let f = norm(sub(target, eye));
    let s0 = norm(cross(f, [0.0, 1.0, 0.0]));
    let u0 = cross(s0, f);
    let (sr, cr) = roll.sin_cos();
    let s = [s0[0] * cr + u0[0] * sr, s0[1] * cr + u0[1] * sr, s0[2] * cr + u0[2] * sr];
    let u = cross(s, f);
    let view: Mat4 = [
        [s[0], u[0], -f[0], 0.0],
        [s[1], u[1], -f[1], 0.0],
        [s[2], u[2], -f[2], 0.0],
        [-dot3(s, eye), -dot3(u, eye), dot3(f, eye), 1.0],
    ];
    let g = 1.0 / (fov * 0.5).tan();
    let proj: Mat4 = [
        [g / aspect.max(1e-3), 0.0, 0.0, 0.0],
        [0.0, g, 0.0, 0.0],
        [0.0, 0.0, far / (near - far), -1.0],
        [0.0, 0.0, near * far / (near - far), 0.0],
    ];
    Camera { eye, forward: f, view_proj: mat_mul(&proj, &view) }
}

pub fn texture_binding(binding: u32, id: &str) -> NativeComputeGraphBindingSpec {
    NativeComputeGraphBindingSpec {
        binding,
        resource_id: id.to_string(),
        kind: NativeComputeGraphBindingKind::GraphTexture,
        source_slot: None,
    }
}

pub fn sampler_binding(binding: u32) -> NativeComputeGraphBindingSpec {
    NativeComputeGraphBindingSpec {
        binding,
        resource_id: "source-frame-sampler".to_string(),
        kind: NativeComputeGraphBindingKind::SourceFrameSampler,
        source_slot: None,
    }
}

pub fn hdr_texture(id: String, width: u32, height: u32) -> NativeComputeGraphTextureSpec {
    NativeComputeGraphTextureSpec { id, width, height, format: NativeGraphTextureFormat::Rgba16Float, mips: false }
}

pub fn depth_texture(id: String, width: u32, height: u32) -> NativeComputeGraphTextureSpec {
    NativeComputeGraphTextureSpec { id, width, height, format: NativeGraphTextureFormat::Depth32Float, mips: false }
}

/// An instanced draw into the scene, depth-tested (and written) against a
/// graph depth texture the size of the scene. The depth is cleared first.
#[allow(clippy::too_many_arguments)]
pub fn depth_plan(
    name: String,
    shader: &CoreShader,
    vertex_entry: &str,
    fragment_entry: &str,
    target: NativeComputeGraphRenderTarget,
    blend: NativeComputeGraphRenderBlend,
    depth_id: &str,
    write: bool,
    load: bool,
    vertex_count: u32,
    instance_count: u32,
    bindings: Vec<NativeComputeGraphBindingSpec>,
) -> NativeComputeGraphRenderPlan {
    let mut plan = render_plan(
        name,
        shader,
        vertex_entry,
        fragment_entry,
        target,
        false,
        blend,
        vertex_count,
        instance_count,
        bindings,
    );
    plan.depth_enabled = true;
    plan.depth_write = write;
    plan.depth_load = load;
    plan.depth_texture_id = Some(depth_id.to_string());
    plan.cache_key = plan
        .cache_key
        .replacen(":nodepth:read:", if write { ":depth:write:" } else { ":depth:read:" }, 1);
    plan
}

/// A fullscreen-triangle pass (`vs_full`) that replaces its target.
pub fn full_pass(
    name: String,
    shader: &CoreShader,
    fragment_entry: &str,
    target_id: &str,
    bindings: Vec<NativeComputeGraphBindingSpec>,
) -> NativeComputeGraphRenderPlan {
    render_plan(
        name,
        shader,
        "vs_full",
        fragment_entry,
        NativeComputeGraphRenderTarget::GraphTexture { id: target_id.to_string() },
        true,
        NativeComputeGraphRenderBlend::Replace,
        3,
        1,
        bindings,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tiers_default_to_medium() {
        assert_eq!(tier(&serde_json::json!({})), 1);
        assert_eq!(tier(&serde_json::json!({"quality": "Low"})), 0);
        assert_eq!(tier(&serde_json::json!({"quality": "ultra"})), 2);
    }

    #[test]
    fn look_at_puts_the_target_in_the_middle_of_the_picture() {
        let cam = look_at([0.0, 1.0, 3.0], [0.0, 0.0, 0.0], 0.0, 0.8, 1.78, 0.05, 50.0);
        let m = cam.view_proj;
        let clip = |p: [f32; 3]| {
            let v = [p[0], p[1], p[2], 1.0];
            let mut out = [0.0; 4];
            for (r, o) in out.iter_mut().enumerate() {
                *o = (0..4).map(|c| m[c][r] * v[c]).sum();
            }
            out
        };
        let c = clip([0.0, 0.0, 0.0]);
        assert!((c[0] / c[3]).abs() < 1e-4 && (c[1] / c[3]).abs() < 1e-4);
        assert!(c[2] / c[3] > 0.0 && c[2] / c[3] < 1.0);
        // Up in the world is up on screen.
        let up = clip([0.0, 0.3, 0.0]);
        assert!(up[1] / up[3] > 0.0);
    }

    #[test]
    fn depth_plans_get_their_own_pipeline_key() {
        let shader = super::super::shaders::core_shader(super::super::shaders::HDR_POST);
        let plan = depth_plan(
            "x".into(),
            shader,
            "vs_full",
            "fs_down",
            NativeComputeGraphRenderTarget::Snapshot,
            NativeComputeGraphRenderBlend::Replace,
            "d",
            true,
            false,
            3,
            1,
            Vec::new(),
        );
        assert!(plan.cache_key.contains(":depth:write:"), "{}", plan.cache_key);
        assert!(plan.depth_enabled && plan.depth_write && plan.depth_texture_id.as_deref() == Some("d"));
    }
}
