//! Graph textures: colour and depth targets a compute graph declares by id
//! (`"textures": [{ "id", "size" | "width"/"height", "format" }]`) and draws
//! into or reads from (`"target": "texture"`, `"depth_texture"`, the
//! `graph-texture` / `graph-depth-texture` bindings).
//!
//! The pool keeps each texture by id and recreates it when its size or format
//! changes. All of them together stay inside a byte budget. A texture no graph
//! has used for `RELEASE_AFTER_MS` is freed, so a removed layer gives its
//! memory back. The grace period is time, not frames: an idle core draws only
//! when asked, and frames would leave the memory held for minutes.
//!
//! The pool belongs to the renderer, so a recreated device starts with an
//! empty pool, and the next graph declares and recreates its textures. Sizes
//! come from the graph, not the output, so an output resize leaves them alone.
//!
//! The bookkeeping (budget, which textures to free) is plain data and tested
//! here; only `upsert` touches the GPU.

use std::cell::Cell;
use std::collections::HashMap;
use std::time::Instant;

use crate::compute_graph::{graph_texture_mip_levels, NativeComputeGraphTextureSpec, NativeGraphTextureFormat};

/// All graph textures together. A 2048 HDR scene with depth, a 2048 shadow
/// map and a bloom chain is about 130 MB.
pub(crate) const BUDGET_BYTES: u64 = 768 * 1024 * 1024;

/// How long a texture may go unused before it is freed: long enough that a
/// graph replaced for a moment (a parameter change, a quality switch) finds
/// its textures still there.
pub(crate) const RELEASE_AFTER_MS: u64 = 2000;

pub(crate) fn mip_levels(spec: &NativeComputeGraphTextureSpec) -> u32 {
    if spec.mips { graph_texture_mip_levels(spec.width, spec.height) } else { 1 }
}

pub(crate) fn spec_bytes(spec: &NativeComputeGraphTextureSpec) -> u64 {
    (0..mip_levels(spec))
        .map(|level| {
            let w = (spec.width >> level).max(1) as u64;
            let h = (spec.height >> level).max(1) as u64;
            w * h * spec.format.bytes_per_pixel()
        })
        .sum()
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

/// Ids last used more than `release_after` ms before `now` (to free now).
pub(crate) fn stale_ids<'a>(
    entries: impl Iterator<Item = (&'a String, u64)>,
    now: u64,
    release_after: u64,
) -> Vec<String> {
    entries
        .filter(|(_, last_used)| now.saturating_sub(*last_used) > release_after)
        .map(|(id, _)| id.clone())
        .collect()
}

/// Why a `graph-texture` / `graph-depth-texture` binding can't use a texture.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum BindingProblem {
    Undeclared,
    /// A colour texture bound as depth, or the other way round.
    KindMismatch(NativeGraphTextureFormat),
}

/// Check a binding against the declared format of the texture it names
/// (`None`: no graph declared it).
pub(crate) fn check_binding(
    format: Option<NativeGraphTextureFormat>,
    wants_depth: bool,
) -> Result<(), BindingProblem> {
    let format = format.ok_or(BindingProblem::Undeclared)?;
    if format.is_depth() != wants_depth {
        return Err(BindingProblem::KindMismatch(format));
    }
    Ok(())
}

/// How a render pass uses depth once its target and `depth_texture` are known.
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct RenderDepth {
    pub(crate) enabled: bool,
    pub(crate) write: bool,
    /// The target itself is a depth texture: no colour output.
    pub(crate) depth_only: bool,
    pub(crate) texture_id: Option<String>,
}

/// Resolve a render's depth use. `target` is the graph texture it draws into
/// (`None` for the other targets); `format_of` looks up declared textures.
pub(crate) fn resolve_render_depth(
    shader_id: &str,
    target: Option<&str>,
    depth_texture_id: Option<String>,
    enabled: bool,
    write: bool,
    format_of: impl Fn(&str) -> Option<NativeGraphTextureFormat>,
) -> Result<RenderDepth, String> {
    let mut depth = RenderDepth { enabled, write, depth_only: false, texture_id: depth_texture_id };
    if let Some(id) = target {
        let Some(format) = format_of(id) else {
            return Err(format!("compute_graph render `{shader_id}` targets undeclared texture `{id}`"));
        };
        if format.is_depth() {
            depth = RenderDepth { enabled: true, write: true, depth_only: true, texture_id: Some(id.to_string()) };
        } else if depth.enabled && depth.texture_id.is_none() {
            return Err(format!(
                "compute_graph render `{shader_id}` into texture `{id}` uses depth and so needs depth_texture"
            ));
        }
    }
    if let Some(id) = depth.texture_id.as_deref() {
        if !format_of(id).is_some_and(NativeGraphTextureFormat::is_depth) {
            return Err(format!(
                "compute_graph render `{shader_id}` depth_texture `{id}` is not a declared depth texture"
            ));
        }
        if !depth.enabled {
            depth.texture_id = None;
        }
    }
    Ok(depth)
}

/// A depth texture must match the size of the target it is used with.
pub(crate) fn check_depth_size(
    render: &str,
    depth: &NativeComputeGraphTextureSpec,
    target_width: u32,
    target_height: u32,
) -> Result<(), String> {
    if depth.width != target_width || depth.height != target_height {
        return Err(format!(
            "native compute graph render `{render}`: depth texture `{}` is {}x{}, the target is {target_width}x{target_height}",
            depth.id, depth.width, depth.height
        ));
    }
    Ok(())
}

/// Each texel of the next level is the average of the 2x2 under it (an odd
/// last row or column is folded into its neighbour). Exact texel loads, so
/// no sampler filtering is involved.
const MIP_WGSL: &str = r#"
@group(0) @binding(0) var src: texture_2d<f32>;

@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}

@fragment
fn fs_main(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let hi = vec2i(textureDimensions(src)) - vec2i(1);
  let base = vec2i(pos.xy) * 2;
  var sum = vec4f(0.0);
  for (var y = 0; y < 2; y++) {
    for (var x = 0; x < 2; x++) {
      sum += textureLoad(src, min(base + vec2i(x, y), hi), 0);
    }
  }
  return sum * 0.25;
}
"#;

/// The downsample pipeline for one colour format.
struct MipBuilder {
    layout: wgpu::BindGroupLayout,
    pipeline: wgpu::RenderPipeline,
}

impl MipBuilder {
    fn new(device: &wgpu::Device, format: wgpu::TextureFormat) -> Self {
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("Ghost Graph Texture Mips"),
            entries: &[wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Texture {
                    sample_type: wgpu::TextureSampleType::Float { filterable: false },
                    view_dimension: wgpu::TextureViewDimension::D2,
                    multisampled: false,
                },
                count: None,
            }],
        });
        let module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("Ghost Graph Texture Mips"),
            source: wgpu::ShaderSource::Wgsl(MIP_WGSL.into()),
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Ghost Graph Texture Mips"),
            bind_group_layouts: &[Some(&layout)],
            immediate_size: 0,
        });
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("Ghost Graph Texture Mips"),
            layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState {
                module: &module,
                entry_point: Some("vs_main"),
                compilation_options: Default::default(),
                buffers: &[],
            },
            fragment: Some(wgpu::FragmentState {
                module: &module,
                entry_point: Some("fs_main"),
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format,
                    blend: None,
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            primitive: wgpu::PrimitiveState::default(),
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            multiview_mask: None,
            cache: None,
        });
        Self { layout, pipeline }
    }
}

pub(crate) struct GraphTexture {
    pub(crate) spec: NativeComputeGraphTextureSpec,
    /// Every mip level, for sampling.
    pub(crate) view: wgpu::TextureView,
    /// Level 0 only, for drawing into.
    pub(crate) target_view: wgpu::TextureView,
    /// Building the chain: level n+1 is drawn reading level n through
    /// `mip_sources[n]`. Empty without mips; made once, with the texture.
    mip_targets: Vec<wgpu::TextureView>,
    mip_sources: Vec<wgpu::BindGroup>,
    _texture: wgpu::Texture,
    /// When a graph last declared or drew with this texture (pool ms).
    last_used: Cell<u64>,
}

pub(crate) struct GraphTexturePool {
    textures: HashMap<String, GraphTexture>,
    /// Mip builders, one per colour format, made on first use.
    mip_builders: HashMap<wgpu::TextureFormat, MipBuilder>,
    origin: Instant,
}

impl Default for GraphTexturePool {
    fn default() -> Self {
        Self { textures: HashMap::new(), mip_builders: HashMap::new(), origin: Instant::now() }
    }
}

impl GraphTexturePool {
    fn now_ms(&self) -> u64 {
        self.origin.elapsed().as_millis() as u64
    }

    /// The texture with this id, marked as used now.
    pub(crate) fn get(&self, id: &str) -> Option<&GraphTexture> {
        let texture = self.textures.get(id)?;
        texture.last_used.set(self.now_ms());
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
                existing.last_used.set(self.now_ms());
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
            mip_level_count: mip_levels(spec),
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: spec.format.texture_format(),
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        });
        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        let level_view = |level: u32| {
            texture.create_view(&wgpu::TextureViewDescriptor {
                base_mip_level: level,
                mip_level_count: Some(1),
                ..Default::default()
            })
        };
        let target_view = level_view(0);
        let (mut mip_targets, mut mip_sources) = (Vec::new(), Vec::new());
        if spec.mips {
            let format = spec.format.texture_format();
            let builder = self.mip_builders.entry(format).or_insert_with(|| MipBuilder::new(device, format));
            for level in 1..mip_levels(spec) {
                mip_targets.push(level_view(level));
                mip_sources.push(device.create_bind_group(&wgpu::BindGroupDescriptor {
                    label: Some("Ghost Graph Texture Mip Source"),
                    layout: &builder.layout,
                    entries: &[wgpu::BindGroupEntry {
                        binding: 0,
                        resource: wgpu::BindingResource::TextureView(&level_view(level - 1)),
                    }],
                }));
            }
        }
        self.textures.insert(
            spec.id.clone(),
            GraphTexture {
                spec: spec.clone(),
                view,
                target_view,
                mip_targets,
                mip_sources,
                _texture: texture,
                last_used: Cell::new(self.now_ms()),
            },
        );
        Ok(())
    }

    /// Rebuild a texture's mip chain from level 0, after a pass drew into it.
    /// Does nothing for a texture without mips.
    pub(crate) fn generate_mips(&self, encoder: &mut wgpu::CommandEncoder, id: &str) {
        let Some(texture) = self.textures.get(id).filter(|texture| !texture.mip_targets.is_empty()) else {
            return;
        };
        let Some(builder) = self.mip_builders.get(&texture.spec.format.texture_format()) else {
            return;
        };
        for (target, source) in texture.mip_targets.iter().zip(&texture.mip_sources) {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("Ghost Graph Texture Mip"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: target,
                    resolve_target: None,
                    ops: wgpu::Operations { load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT), store: wgpu::StoreOp::Store },
                    depth_slice: None,
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
                multiview_mask: None,
            });
            pass.set_pipeline(&builder.pipeline);
            pass.set_bind_group(0, source, &[]);
            pass.draw(0..3, 0..1);
        }
    }

    /// Once per frame: textures no graph used for a while are freed.
    pub(crate) fn end_frame(&mut self) {
        if self.textures.is_empty() {
            return;
        }
        let stale = stale_ids(
            self.textures.iter().map(|(id, texture)| (id, texture.last_used.get())),
            self.now_ms(),
            RELEASE_AFTER_MS,
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
    use crate::compute_graph::parse_compute_graph_texture;
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
    fn mips_add_their_levels_to_the_bytes_and_are_colour_only() {
        let with = parse_compute_graph_texture(&json!({ "id": "m", "size": 256, "format": "rgba8unorm", "mips": true })).unwrap();
        assert_eq!(mip_levels(&with), 9);
        // 256² + 128² + ... + 1² texels, four bytes each.
        let texels: u64 = (0..9).map(|l| (256u64 >> l).pow(2)).sum();
        assert_eq!(spec_bytes(&with), texels * 4);
        let wide = parse_compute_graph_texture(&json!({ "id": "w", "width": 300, "height": 20, "format": "rgba8unorm", "mips": true })).unwrap();
        assert_eq!(mip_levels(&wide), 9);
        assert!(parse_compute_graph_texture(&json!({ "id": "d", "size": 64, "format": "depth32float", "mips": true })).is_err());
        assert_eq!(mip_levels(&spec("n", 256, "rgba8unorm")), 1);
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
        let entries = [(&ids[0], 5000u64), (&ids[1], 1000u64), (&ids[2], 3000u64)];
        let stale = stale_ids(entries.into_iter(), 5000, RELEASE_AFTER_MS);
        assert_eq!(stale, vec!["stale".to_string()]);
    }

    use NativeGraphTextureFormat::{Depth32Float, Rgba16Float};

    fn declared(id: &str) -> Option<NativeGraphTextureFormat> {
        match id {
            "scene" => Some(Rgba16Float),
            "scene_depth" | "shadow" => Some(Depth32Float),
            _ => None,
        }
    }

    #[test]
    fn bindings_must_name_a_declared_texture_of_the_right_kind() {
        assert_eq!(check_binding(None, false), Err(BindingProblem::Undeclared));
        assert_eq!(check_binding(None, true), Err(BindingProblem::Undeclared));
        assert_eq!(check_binding(Some(Rgba16Float), false), Ok(()));
        assert_eq!(check_binding(Some(Depth32Float), true), Ok(()));
        assert_eq!(check_binding(Some(Rgba16Float), true), Err(BindingProblem::KindMismatch(Rgba16Float)));
        assert_eq!(check_binding(Some(Depth32Float), false), Err(BindingProblem::KindMismatch(Depth32Float)));
    }

    #[test]
    fn render_into_an_undeclared_texture_is_refused() {
        let err = resolve_render_depth("s", Some("nope"), None, false, false, declared).unwrap_err();
        assert!(err.contains("undeclared texture `nope`"), "{err}");
    }

    #[test]
    fn render_into_a_depth_texture_is_depth_only() {
        let depth = resolve_render_depth("s", Some("shadow"), None, false, false, declared).unwrap();
        assert_eq!(
            depth,
            RenderDepth { enabled: true, write: true, depth_only: true, texture_id: Some("shadow".into()) }
        );
    }

    #[test]
    fn colour_target_with_depth_needs_a_depth_texture() {
        let err = resolve_render_depth("s", Some("scene"), None, true, true, declared).unwrap_err();
        assert!(err.contains("needs depth_texture"), "{err}");
        let ok = resolve_render_depth("s", Some("scene"), Some("scene_depth".into()), true, true, declared).unwrap();
        assert_eq!(ok.texture_id.as_deref(), Some("scene_depth"));
        assert!(!ok.depth_only);
    }

    #[test]
    fn depth_texture_must_be_a_declared_depth_texture() {
        let colour = resolve_render_depth("s", None, Some("scene".into()), true, true, declared).unwrap_err();
        assert!(colour.contains("not a declared depth texture"), "{colour}");
        let missing = resolve_render_depth("s", None, Some("gone".into()), true, true, declared).unwrap_err();
        assert!(missing.contains("not a declared depth texture"), "{missing}");
        // Named but depth off: checked, then dropped.
        let off = resolve_render_depth("s", Some("scene"), Some("scene_depth".into()), false, false, declared).unwrap();
        assert_eq!(off.texture_id, None);
    }

    #[test]
    fn depth_texture_size_must_match_the_target() {
        let depth = spec("d", 512, "depth32float");
        assert!(check_depth_size("r", &depth, 512, 512).is_ok());
        let err = check_depth_size("r", &depth, 1024, 512).unwrap_err();
        assert!(err.contains("512x512") && err.contains("1024x512"), "{err}");
    }

    #[test]
    fn upsert_budget_refusal_is_reported_by_fits_budget() {
        // 4096² rgba16float is 128 MiB; six of them leave no room for a seventh.
        let big: Vec<_> = (0..6).map(|i| spec(&format!("t{i}"), 4096, "rgba16float")).collect();
        let next = spec("t6", 4096, "rgba16float");
        assert!(!fits_budget(&next, big.iter(), BUDGET_BYTES));
        assert!(fits_budget(&spec("t0", 4096, "rgba16float"), big.iter(), BUDGET_BYTES));
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
