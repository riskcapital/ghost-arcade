//! Graph textures: colour and depth targets a compute graph declares by id
//! (`"textures": [{ "id", "size" | "width"/"height", "format" }]`) and draws
//! into or reads from (`"target": "texture"`, `"depth_texture"`, the
//! `graph-texture` / `graph-depth-texture` bindings).
//!
//! The pool keeps each texture by id and recreates it when its size or format
//! changes. All of them together stay inside a byte budget. A texture no graph
//! has used for `RELEASE_AFTER_FRAMES` frames is freed, the way unreferenced
//! source-frame slots are, so a removed layer gives its memory back.
//!
//! The bookkeeping (budget, which textures to free) is plain data and tested
//! here; only `upsert` touches the GPU.

use std::cell::Cell;
use std::collections::HashMap;

use crate::compute_graph::NativeComputeGraphTextureSpec;

/// All graph textures together. A 2048 HDR scene with depth, a 2048 shadow
/// map and a bloom chain is about 130 MB.
pub(crate) const BUDGET_BYTES: u64 = 768 * 1024 * 1024;

/// Frames a texture may go unused before it is freed: about two seconds at
/// 60 fps, so a graph replaced for a moment (a parameter change, a quality
/// switch) finds its textures still there.
pub(crate) const RELEASE_AFTER_FRAMES: u64 = 120;

pub(crate) fn spec_bytes(spec: &NativeComputeGraphTextureSpec) -> u64 {
    (spec.width as u64) * (spec.height as u64) * spec.format.bytes_per_pixel()
}

/// Whether `spec` fits the budget next to the textures that would stay (every
/// other id; the one with the same id is replaced).
pub(crate) fn fits_budget<'a>(
    spec: &NativeComputeGraphTextureSpec,
    others: impl Iterator<Item = &'a NativeComputeGraphTextureSpec>,
    budget: u64,
) -> bool {
    let kept: u64 = others.filter(|other| other.id != spec.id).map(spec_bytes).sum();
    kept.saturating_add(spec_bytes(spec)) <= budget
}

/// Ids last used before `frame - release_after` (to free now).
pub(crate) fn stale_ids<'a>(
    entries: impl Iterator<Item = (&'a String, u64)>,
    frame: u64,
    release_after: u64,
) -> Vec<String> {
    entries
        .filter(|(_, last_used)| frame.saturating_sub(*last_used) > release_after)
        .map(|(id, _)| id.clone())
        .collect()
}

pub(crate) struct GraphTexture {
    pub(crate) spec: NativeComputeGraphTextureSpec,
    pub(crate) view: wgpu::TextureView,
    _texture: wgpu::Texture,
    /// The frame a graph last declared or drew with this texture.
    last_used: Cell<u64>,
}

#[derive(Default)]
pub(crate) struct GraphTexturePool {
    textures: HashMap<String, GraphTexture>,
    frame: u64,
}

impl GraphTexturePool {
    /// The texture with this id, marked as used this frame.
    pub(crate) fn get(&self, id: &str) -> Option<&GraphTexture> {
        let texture = self.textures.get(id)?;
        texture.last_used.set(self.frame);
        Some(texture)
    }

    /// The texture's format and size, without marking it used.
    pub(crate) fn spec(&self, id: &str) -> Option<&NativeComputeGraphTextureSpec> {
        self.textures.get(id).map(|texture| &texture.spec)
    }

    /// Create the texture, or recreate it when its size or format changed.
    /// Refused when it would take the pool over the budget.
    pub(crate) fn upsert(
        &mut self,
        device: &wgpu::Device,
        spec: &NativeComputeGraphTextureSpec,
    ) -> Result<(), String> {
        if let Some(existing) = self.textures.get(&spec.id) {
            if &existing.spec == spec {
                existing.last_used.set(self.frame);
                return Ok(());
            }
        }
        if !fits_budget(spec, self.textures.values().map(|texture| &texture.spec), BUDGET_BYTES) {
            return Err(format!("graph texture `{}` exceeds the graph texture budget", spec.id));
        }
        let texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some(&format!("Ghost Native Graph Texture {}", spec.id)),
            size: wgpu::Extent3d {
                width: spec.width,
                height: spec.height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: spec.format.texture_format(),
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        });
        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        self.textures.insert(
            spec.id.clone(),
            GraphTexture {
                spec: spec.clone(),
                view,
                _texture: texture,
                last_used: Cell::new(self.frame),
            },
        );
        Ok(())
    }

    /// Once per frame: textures no graph used for a while are freed.
    pub(crate) fn end_frame(&mut self, frame: u64) {
        self.frame = frame;
        if self.textures.is_empty() {
            return;
        }
        let stale = stale_ids(
            self.textures.iter().map(|(id, texture)| (id, texture.last_used.get())),
            frame,
            RELEASE_AFTER_FRAMES,
        );
        for id in stale {
            self.textures.remove(&id);
        }
    }

    pub(crate) fn len(&self) -> usize {
        self.textures.len()
    }

    pub(crate) fn total_bytes(&self) -> u64 {
        self.textures.values().map(|texture| spec_bytes(&texture.spec)).sum()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::compute_graph::{parse_compute_graph_texture, NativeGraphTextureFormat};
    use serde_json::json;

    fn spec(id: &str, size: u32, format: &str) -> NativeComputeGraphTextureSpec {
        parse_compute_graph_texture(&json!({ "id": id, "size": size, "format": format })).unwrap()
    }

    #[test]
    fn bytes_follow_size_and_format() {
        assert_eq!(spec_bytes(&spec("a", 1024, "rgba8unorm")), 1024 * 1024 * 4);
        assert_eq!(spec_bytes(&spec("b", 1024, "rgba16float")), 1024 * 1024 * 8);
        assert_eq!(spec_bytes(&spec("c", 1024, "depth32float")), 1024 * 1024 * 4);
    }

    #[test]
    fn budget_counts_the_others_and_replaces_the_same_id() {
        let a = spec("a", 1024, "rgba16float"); // 8 MiB
        let b = spec("b", 1024, "rgba16float"); // 8 MiB
        let budget = 16 * 1024 * 1024;
        assert!(fits_budget(&b, [&a].into_iter(), budget));
        let c = spec("c", 1024, "rgba8unorm"); // 4 MiB: 20 MiB with a and b
        assert!(!fits_budget(&c, [&a, &b].into_iter(), budget));
        // Re-declaring `a` larger replaces it rather than adding to it.
        let a2 = spec("a", 1024, "rgba16float");
        assert!(fits_budget(&a2, [&a, &b].into_iter(), budget));
    }

    #[test]
    fn unused_textures_are_freed_after_the_grace_period() {
        let ids = ["kept".to_string(), "stale".to_string(), "edge".to_string()];
        let entries = [(&ids[0], 500u64), (&ids[1], 100u64), (&ids[2], 380u64)];
        let stale = stale_ids(entries.into_iter(), 500, RELEASE_AFTER_FRAMES);
        assert_eq!(stale, vec!["stale".to_string()]);
    }

    #[test]
    fn parsing_rejects_bad_specs() {
        assert!(parse_compute_graph_texture(&json!({ "size": 64, "format": "rgba8unorm" })).is_err());
        assert!(parse_compute_graph_texture(&json!({ "id": "x", "size": 64, "format": "rgb10" })).is_err());
        let huge = parse_compute_graph_texture(&json!({ "id": "x", "size": 100000, "format": "rgba8unorm" })).unwrap();
        assert!(huge.width <= 4096 && huge.height <= 4096);
        let wide = parse_compute_graph_texture(&json!({ "id": "x", "width": 300, "height": 200, "format": "depth32float" })).unwrap();
        assert_eq!((wide.width, wide.height), (300, 200));
        assert!(matches!(wide.format, NativeGraphTextureFormat::Depth32Float));
    }
}
