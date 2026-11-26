//! The compositor's GPU records: frame uniforms, layer records and the layer
//! pools, changed-range uploads, and the footprint a layer covers.

use crate::*;

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
pub(crate) struct Uniforms {
    pub(crate) resolution: [f32; 2],
    pub(crate) time: f32,
    pub(crate) command_phase: f32,
    pub(crate) layer_count: f32,
    pub(crate) frame_count: f32,
    /// Master output gate: 1.0 normal, 0.0 blackout.
    pub(crate) output_gate: f32,
    /// Number of composite-stage effects in `post` (0..8).
    pub(crate) post_count: f32,
    pub(crate) audio0: [f32; 4],
    pub(crate) audio1: [f32; 4],
    pub(crate) audio2: [f32; 4],
    /// Composition effects then macro bundles, applied after layer blending.
    pub(crate) post: [[f32; 4]; 8],
    /// Output stage: crop, rotation + color grade, edge blend, dome.
    pub(crate) out0: [f32; 4],
    pub(crate) out1: [f32; 4],
    pub(crate) edge: [f32; 4],
    pub(crate) dome0: [f32; 4],
    pub(crate) dome1: [f32; 4],
    pub(crate) dome2: [f32; 4],
    pub(crate) edge_gamma: [f32; 4],
    pub(crate) black_level: [f32; 4],
    pub(crate) projector_calibration: [[f32; 4]; 5],
    pub(crate) swarp: [f32; 4],
    pub(crate) swarp_c0: [f32; 4],
    pub(crate) swarp_c1: [f32; 4],
    pub(crate) mwarp: [f32; 4],
    pub(crate) mwarp_c0: [f32; 4],
    pub(crate) mwarp_c1: [f32; 4],
    pub(crate) swarp_mesh: [[f32; 4]; 128],
    pub(crate) mwarp_mesh: [[f32; 4]; 128],
    pub(crate) smask: [f32; 4],
    pub(crate) smask_info: [[f32; 4]; MAX_SCREEN_MASKS],
    pub(crate) smask_bounds: [[f32; 4]; MAX_SCREEN_MASKS],
    pub(crate) smask_pts: [[f32; 4]; MAX_SCREEN_MASK_VEC4S],
    pub(crate) swarp_tangents: [[f32; 4]; WARP_MESH_TANGENT_VEC4S],
    pub(crate) mwarp_tangents: [[f32; 4]; WARP_MESH_TANGENT_VEC4S],
    /// Beat clock: (beat position, bpm, _, _). See `BeatClock`.
    pub(crate) clock: [f32; 4],
    /// Flux from a paired phone: see `Uniforms.flux0` in heartbeat.wgsl.
    pub(crate) flux0: [f32; 4],
    pub(crate) flux1: [f32; 4],
    /// Each screen's box for Flux: see `Uniforms.flux_regions` in heartbeat.wgsl.
    pub(crate) flux_regions: [[f32; 4]; MAX_FLUX_REGIONS],
    /// Dome canvas, dome grid and dome-placed layers: see `Uniforms.dome3`
    /// in heartbeat.wgsl.
    pub(crate) dome3: [f32; 4],
    pub(crate) dome4: [f32; 4],
    pub(crate) dlayer: [f32; 4],
    pub(crate) dview: [f32; 4],
    pub(crate) dview1: [f32; 4],
    pub(crate) dproj0: [f32; 4],
    pub(crate) dproj1: [f32; 4],
    pub(crate) dprojs: [[f32; 4]; 32],
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
pub(crate) struct LayerGpu {
    /// Conservative canvas-UV rectangle (min x, min y, max x, max y) outside
    /// which the layer cannot change a pixel. Filled at upload by
    /// `layer_cull_bounds`; the compositor tests it before anything else, so
    /// a layer that misses a pixel costs one read instead of several reads
    /// spread over its large record.
    pub(crate) cull: [f32; 4],
    pub(crate) p0: [f32; 4],
    pub(crate) p1: [f32; 4],
    pub(crate) color: [f32; 4],
    pub(crate) meta: [f32; 4],
    pub(crate) params0: [f32; 4],
    pub(crate) params1: [f32; 4],
    pub(crate) style: [f32; 4],
    pub(crate) uv0: [f32; 4],
    pub(crate) uv1: [f32; 4],
    pub(crate) shape: [f32; 4],
    pub(crate) shape2: [f32; 4],
    pub(crate) shape_meta: [f32; 4],
    pub(crate) shape_pts: [[f32; 4]; 32],
    pub(crate) effect0: [f32; 4],
    pub(crate) effect1: [f32; 4],
    pub(crate) effect2: [f32; 4],
    pub(crate) effect3: [f32; 4],
    pub(crate) edge_effects: [[[f32; 4]; LAYER_EDGE_EFFECT_VEC4S]; MAX_LAYER_EDGE_EFFECTS],
    /// (centerline points, effects, corners, diagonals)
    pub(crate) edge_info: [f32; 4],
    /// (centroid x px, centroid y px, perimeter px, inradius px)
    pub(crate) edge_geom: [f32; 4],
    /// (seed, _, _, _)
    pub(crate) edge_extra: [f32; 4],
    /// Centerline bounding box, px.
    pub(crate) edge_extra2: [f32; 4],
    /// Output-UV rectangle (min x, min y, max x, max y) the stack can touch.
    pub(crate) edge_bounds: [f32; 4],
    pub(crate) edge_chunks: [[f32; 4]; MAX_LAYER_EDGE_CHUNKS],
    pub(crate) edge_corners: [[f32; 4]; MAX_LAYER_EDGE_CORNERS],
    pub(crate) edge_diags: [[f32; 4]; MAX_LAYER_EDGE_DIAGONALS / 2],
    pub(crate) edge_pts: [[f32; 4]; MAX_LAYER_EDGE_POINTS],
    pub(crate) mask_info: [f32; 4],
    pub(crate) mask: [[f32; 4]; MAX_LAYER_MASK_POINTS],
    pub(crate) mesh: [[f32; 4]; MAX_LAYER_MESH_VEC4S],
    /// Where each mesh point rests on the layer, packed like `mesh`: the
    /// layer position a cell shows. The even lattice unless the mesh was
    /// fitted to a Custom Shape, whose mesh rests on the shape.
    pub(crate) mesh_rest: [[f32; 4]; MAX_LAYER_MESH_VEC4S],
    pub(crate) mesh_tangents: [[f32; 4]; MAX_LAYER_MESH_TANGENT_VEC4S],
    /// Quad-local (y-down) rectangle (min u, min v, max u, max v) that holds
    /// a Bezier mesh's whole surface, bulges past the corner quad included.
    /// Zero, and never read, for a straight mesh.
    pub(crate) mesh_bounds: [f32; 4],
    pub(crate) source_rect: [f32; 4],
    pub(crate) fast_flags: [u32; 4],
    /// Colour multiplier (r, g, b) applied to the layer's finished colour,
    /// edge effects included (Screen FX colour chases drive it), and in w
    /// the content alpha folded into `color`, so edge effects on a
    /// source-less layer are not dimmed with its placeholder.
    pub(crate) tint: [f32; 4],
    /// Placed on the dome (fast_flags[2]): azimuth, elevation, tangent of
    /// half the angular width, roll; radians. See `set_layer_dome`.
    pub(crate) dome: [f32; 4],
}

/// What the compositor reads of every layer: `LayerGpu` without the data
/// only some layers use, which `pack_layer_pools` moves into pool records
/// (heartbeat.wgsl LayerData and layer_pool). 240 bytes against ~30 KB.
#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
pub(crate) struct LayerCoreGpu {
    pub(crate) cull: [f32; 4],
    pub(crate) p0: [f32; 4],
    pub(crate) p1: [f32; 4],
    pub(crate) color: [f32; 4],
    pub(crate) meta: [f32; 4],
    pub(crate) style: [f32; 4],
    pub(crate) uv0: [f32; 4],
    pub(crate) uv1: [f32; 4],
    pub(crate) source_rect: [f32; 4],
    pub(crate) fast_flags: [u32; 4],
    pub(crate) tint: [f32; 4],
    pub(crate) dome: [f32; 4],
    pub(crate) edge_extra: [f32; 4],
    /// Record starts in the pool (vec4 index): shape, effects, mask, mesh.
    pub(crate) pool: [u32; 4],
    /// Edge Effects record start, then unused.
    pub(crate) pool2: [u32; 4],
}

// Pool record layouts, in vec4s; heartbeat.wgsl's POOL_* constants match
// (layer_pool_layout_matches_the_shader).
pub(crate) const POOL_SHAPE_PTS: usize = 3;

pub(crate) const POOL_SHAPE_LEN: usize = POOL_SHAPE_PTS + 32;

pub(crate) const POOL_FX_LEN: usize = 6;

pub(crate) const POOL_MASK_PTS: usize = 1;

pub(crate) const POOL_MASK_LEN: usize = POOL_MASK_PTS + MAX_LAYER_MASK_POINTS;

pub(crate) const POOL_MESH_POINTS: usize = 1;

pub(crate) const POOL_MESH_REST: usize = POOL_MESH_POINTS + MAX_LAYER_MESH_VEC4S;

pub(crate) const POOL_MESH_TANGENTS: usize = POOL_MESH_REST + MAX_LAYER_MESH_VEC4S;

pub(crate) const POOL_MESH_LEN: usize = POOL_MESH_TANGENTS + MAX_LAYER_MESH_TANGENT_VEC4S;

pub(crate) const POOL_EDGE_EFFECTS: usize = 4;

pub(crate) const POOL_EDGE_CHUNKS: usize = POOL_EDGE_EFFECTS + MAX_LAYER_EDGE_EFFECTS * LAYER_EDGE_EFFECT_VEC4S;

pub(crate) const POOL_EDGE_CORNERS: usize = POOL_EDGE_CHUNKS + MAX_LAYER_EDGE_CHUNKS;

pub(crate) const POOL_EDGE_DIAGS: usize = POOL_EDGE_CORNERS + MAX_LAYER_EDGE_CORNERS;

pub(crate) const POOL_EDGE_PTS: usize = POOL_EDGE_DIAGS + MAX_LAYER_EDGE_DIAGONALS / 2;

pub(crate) const POOL_EDGE_LEN: usize = POOL_EDGE_PTS + MAX_LAYER_EDGE_POINTS;

/// The all-zero record at the start of every pool: as long as the longest record.
pub(crate) const POOL_ZERO_LEN: usize = POOL_EDGE_LEN;

/// A pool buffer's first size, in vec4s (grown in powers of two).
pub(crate) const POOL_MIN_CAPACITY: usize = 4096;

/// GA_CORE_LAYER_UPLOAD=full: every layer gets every pool record and a
/// buffer that changed is re-sent whole (close to the old upload, for
/// comparing). Default: absent records share the zero record and only the
/// changed ranges are sent.
pub(crate) fn layer_upload_full() -> bool {
    static FULL: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *FULL.get_or_init(|| std::env::var("GA_CORE_LAYER_UPLOAD").is_ok_and(|value| value.trim() == "full"))
}

/// Split `layers` into core records and pool records. A record whose data
/// is all zero points at the zero record (unless `full`), so the shader
/// reads the same zeros it read from the old full-size layer.
pub(crate) fn pack_layer_pools(layers: &[LayerGpu], full: bool, cores: &mut Vec<LayerCoreGpu>, pool: &mut Vec<[f32; 4]>) {
    cores.clear();
    pool.clear();
    pool.resize(POOL_ZERO_LEN, [0.0; 4]);
    fn record(pool: &mut Vec<[f32; 4]>, full: bool, len: usize, parts: &[&[[f32; 4]]]) -> u32 {
        debug_assert_eq!(parts.iter().map(|part| part.len()).sum::<usize>(), len);
        let empty = parts.iter().all(|part| bytemuck::cast_slice::<[f32; 4], u8>(part).iter().all(|byte| *byte == 0));
        if empty && !full {
            return 0;
        }
        let start = pool.len() as u32;
        for part in parts {
            pool.extend_from_slice(part);
        }
        start
    }
    for layer in layers {
        let shape = record(pool, full, POOL_SHAPE_LEN, &[&[layer.shape, layer.shape2, layer.shape_meta], &layer.shape_pts]);
        let fx = record(pool, full, POOL_FX_LEN, &[&[layer.params0, layer.params1, layer.effect0, layer.effect1, layer.effect2, layer.effect3]]);
        let mask = record(pool, full, POOL_MASK_LEN, &[&[layer.mask_info], &layer.mask]);
        let mesh = record(pool, full, POOL_MESH_LEN, &[&[layer.mesh_bounds], &layer.mesh, &layer.mesh_rest, &layer.mesh_tangents]);
        let edge = record(pool, full, POOL_EDGE_LEN, &[
            &[layer.edge_info, layer.edge_geom, layer.edge_extra2, layer.edge_bounds],
            bytemuck::cast_slice(&layer.edge_effects),
            &layer.edge_chunks, &layer.edge_corners, &layer.edge_diags, &layer.edge_pts,
        ]);
        cores.push(LayerCoreGpu {
            cull: layer.cull,
            p0: layer.p0,
            p1: layer.p1,
            color: layer.color,
            meta: layer.meta,
            style: layer.style,
            uv0: layer.uv0,
            uv1: layer.uv1,
            source_rect: layer.source_rect,
            fast_flags: layer.fast_flags,
            tint: layer.tint,
            dome: layer.dome,
            edge_extra: layer.edge_extra,
            pool: [shape, fx, mask, mesh],
            pool2: [edge, 0, 0, 0],
        });
    }
}

/// Send `new` to `buffer`, which holds `last`: only the `chunk`-byte blocks
/// that differ (neighbours merged into one write), then anything past the
/// end of `last`. `full` sends everything when anything changed. Returns
/// the bytes sent.
pub(crate) fn write_changed_ranges(queue: &wgpu::Queue, buffer: &wgpu::Buffer, new: &[u8], last: &mut Vec<u8>, chunk: usize, full: bool) -> usize {
    if new == last.as_slice() {
        return 0;
    }
    let mut sent = 0;
    if full {
        churn_probe::write_buffer(queue, buffer, 0, new);
        sent = new.len();
    } else {
        for (start, end) in changed_ranges(new, last, chunk) {
            churn_probe::write_buffer(queue, buffer, start as u64, &new[start..end]);
            sent += end - start;
        }
    }
    last.clear();
    last.extend_from_slice(new);
    sent
}

/// The byte ranges of `new` to send over a buffer holding `last`: runs of
/// differing `chunk`-byte blocks, then whatever lies past `last`'s end.
pub(crate) fn changed_ranges(new: &[u8], last: &[u8], chunk: usize) -> Vec<(usize, usize)> {
    let common = new.len().min(last.len()) / chunk * chunk;
    let mut ranges = Vec::new();
    let mut at = 0;
    while at < common {
        if new[at..at + chunk] == last[at..at + chunk] {
            at += chunk;
            continue;
        }
        let start = at;
        while at < common && new[at..at + chunk] != last[at..at + chunk] {
            at += chunk;
        }
        ranges.push((start, at));
    }
    if new.len() > common {
        ranges.push((common, new.len()));
    }
    ranges
}

/// Some layer reads its picture's mips (the compositor build with source
/// mips draws them).
pub(crate) fn layers_want_mips(layers: &[LayerGpu]) -> bool {
    layers.iter().any(|layer| layer.fast_flags[3] & 4 != 0)
}

/// A pool buffer of `capacity` vec4s.
pub(crate) fn create_layer_pool_buffer(device: &wgpu::Device, capacity: usize, label: &str) -> wgpu::Buffer {
    device.create_buffer(&wgpu::BufferDescriptor {
        label: Some(label),
        size: (capacity * std::mem::size_of::<[f32; 4]>()) as u64,
        usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
        mapped_at_creation: false,
    })
}

/// The share of the composite a layer covers, as (width, height) in 0..1
/// units: the bounding box of its corners, stretched by a mesh warp that
/// reaches past them.
pub(crate) fn layer_composite_extent(layer: &SceneLayer) -> (f32, f32) {
    let bounds = |points: &mut dyn Iterator<Item = [f32; 2]>| {
        let (mut x0, mut y0, mut x1, mut y1) = (f32::MAX, f32::MAX, f32::MIN, f32::MIN);
        for [x, y] in points {
            x0 = x0.min(x); y0 = y0.min(y); x1 = x1.max(x); y1 = y1.max(y);
        }
        if x1 < x0 { (1.0, 1.0) } else { ((x1 - x0).max(0.0), (y1 - y0).max(0.0)) }
    };
    let (mut width, mut height) = bounds(&mut layer.corners.iter().copied());
    if !layer.mesh_points.is_empty() {
        let (mesh_w, mesh_h) = bounds(&mut layer.mesh_points.iter().copied());
        width *= mesh_w.max(1.0);
        height *= mesh_h.max(1.0);
    }
    (width, height)
}

/// Whether `layer` can show its picture (`texels` wide and high, before
/// its crop) smaller than its size somewhere on a `composite` pixel canvas:
/// the picture's longest side against the layer's shortest edge on screen,
/// with room for a mesh to squeeze its cells and for the dome to shrink
/// what it places. Conservative: a no only skips mip reads the picture
/// could not use.
pub(crate) fn layer_may_minify(layer: &SceneLayer, texels: [f32; 2], composite: [f32; 2]) -> bool {
    let (span_x, span_y) = layer_source_span(layer);
    let shown = (texels[0] * span_x).max(texels[1] * span_y);
    let c = layer.corners;
    let edge = |a: [f32; 2], b: [f32; 2]| ((a[0] - b[0]) * composite[0]).hypot((a[1] - b[1]) * composite[1]);
    let shortest = edge(c[0], c[1]).min(edge(c[1], c[2])).min(edge(c[2], c[3])).min(edge(c[3], c[0]));
    let squeeze = if !layer.mesh_points.is_empty() || layer.dome.is_some() { 0.5 } else { 0.9 };
    !(shortest.is_finite() && shown.is_finite()) || shown > shortest * squeeze
}

/// See `App::layer_render_footprint`. A layer showing part of its picture (a
/// crop: a piece's share of a picture spread across the stage) needs the
/// whole picture at the detail it shows its part: its extent divided by
/// that part.
pub(crate) fn layer_render_footprint_for(layer: &SceneLayer, composite_w: u32, composite_h: u32, max_edge: u32) -> (u32, u32) {
    let (width, height) = layer_composite_extent(layer);
    let (span_x, span_y) = layer_source_span(layer);
    let (width, height) = (width / span_x, height / span_y);
    let edge = |extent: f32, composite: u32| -> u32 {
        if !extent.is_finite() {
            return max_edge;
        }
        let pixels = (extent * composite.max(1) as f32 * 1.25).ceil().max(1.0) as u32;
        pixels.div_ceil(128).saturating_mul(128).clamp(256.min(max_edge), max_edge)
    };
    (edge(width, composite_w), edge(height, composite_h))
}

/// Key of a group of layers sharing one single-pass shader render (see
/// `isf_shared_footprints`).
pub(crate) fn isf_share_key_for(shader_id: &str, source_hash: u64, input_source_slot: usize, quality: f32) -> String {
    format!("{shader_id}:{source_hash:016x}:{input_source_slot}:{:08x}", quality.to_bits())
}

/// The share of its source (width, height) a layer shows: its crop (the
/// `uv_transform` scale), narrowed further on the long side by Fill.
pub(crate) fn layer_source_span(layer: &SceneLayer) -> (f32, f32) {
    let mut span_x = layer.uv0[2].abs();
    let mut span_y = layer.uv0[3].abs();
    if (layer.uv1[0] + 0.5).floor() as i32 == 1 {
        let ratio = layer.uv1[1].max(0.0001);
        if ratio > 1.0 {
            span_x /= ratio;
        } else {
            span_y *= ratio;
        }
    }
    let span = |value: f32| if value.is_finite() { value.clamp(1.0 / 64.0, 1.0) } else { 1.0 };
    (span(span_x), span(span_y))
}

/// How much of the full decode size a video needs for the layers showing it
/// (see `video_decode_scale`). A layer showing part of the clip (a video wall
/// tile, a crop) needs its on-screen size divided by that part: a quarter-
/// width tile showing a quarter of the clip needs the full width.
pub(crate) fn video_decode_scale_for_layers<'a>(layers: impl Iterator<Item = &'a SceneLayer>) -> f32 {
    let mut needed = 0.0f32;
    let mut shown = false;
    for layer in layers {
        shown = true;
        let (width, height) = layer_composite_extent(layer);
        let (span_x, span_y) = layer_source_span(layer);
        needed = needed.max((width / span_x).max(height / span_y) * 1.25);
    }
    if !shown || !needed.is_finite() {
        return 1.0;
    }
    [0.25, 0.375, 0.5, 0.75].into_iter().find(|step| needed <= *step).unwrap_or(1.0)
}

/// Fill `out` with the tile bins for these cull bounds (see LAYER_TILES).
/// Pixels outside the 0..1 canvas (a dome, an output warp) are not binned
/// and walk every layer, so a layer that only reaches there is left out.
/// Layer slots the upload scratch keeps even for an empty scene, so a set
/// that adds and removes a few layers never reallocates.
pub(crate) const LAYER_UPLOAD_SCRATCH_MIN_SLOTS: usize = 16;

/// Sizes the layer upload scratch to `upload_len` slots: it grows to what the
/// scene uploads and gives memory back once the scene has shrunk to under a
/// quarter of what it holds (down to LAYER_UPLOAD_SCRATCH_MIN_SLOTS), so one
/// big scene earlier in a set does not keep its size for the rest of it.
pub(crate) fn fit_layer_upload_scratch(scratch: &mut Vec<LayerGpu>, upload_len: usize) {
    let upload_len = upload_len.min(MAX_SCENE_LAYERS);
    if scratch.len() < upload_len {
        scratch.resize(upload_len, LayerGpu::zeroed());
        return;
    }
    let keep = upload_len.max(LAYER_UPLOAD_SCRATCH_MIN_SLOTS);
    if scratch.capacity() > keep.saturating_mul(4) {
        scratch.truncate(keep);
        scratch.shrink_to(keep);
    }
}

/// The same rule for a byte buffer that mirrors the last upload.
pub(crate) fn fit_byte_scratch(scratch: &mut Vec<u8>, bytes: usize) {
    let keep = bytes.max(LAYER_UPLOAD_SCRATCH_MIN_SLOTS * std::mem::size_of::<LayerGpu>());
    if scratch.capacity() > keep.saturating_mul(4) {
        scratch.truncate(keep.min(scratch.len()));
        scratch.shrink_to(keep);
    }
}

/// Screens Flux plays inside separately (see `set_output_flux`).
pub(crate) const MAX_FLUX_REGIONS: usize = 16;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn layer_pools_hold_only_what_layers_use() {
        use super::*;
        let plain = LayerGpu::zeroed();
        let mut masked = LayerGpu::zeroed();
        masked.mask_info = [1.0, 0.0, 0.0, 3.0];
        masked.mask[2] = [0.5, 0.25, 0.0, 0.0];
        let mut cores = Vec::new();
        let mut pool = Vec::new();
        pack_layer_pools(&[plain, masked], false, &mut cores, &mut pool);
        assert_eq!(cores[0].pool, [0; 4]);
        assert_eq!(cores[0].pool2, [0; 4]);
        // Only the mask record follows the shared zero record.
        assert_eq!(pool.len(), POOL_ZERO_LEN + POOL_MASK_LEN);
        let base = cores[1].pool[2] as usize;
        assert_eq!(base, POOL_ZERO_LEN);
        assert_eq!(pool[base], masked.mask_info);
        assert_eq!(pool[base + POOL_MASK_PTS + 2], masked.mask[2]);
        assert!(pool[..POOL_ZERO_LEN].iter().all(|v| *v == [0.0; 4]));
        // Full: every layer carries every record.
        pack_layer_pools(&[plain, masked], true, &mut cores, &mut pool);
        let per_layer = POOL_SHAPE_LEN + POOL_FX_LEN + POOL_MASK_LEN + POOL_MESH_LEN + POOL_EDGE_LEN;
        assert_eq!(pool.len(), POOL_ZERO_LEN + 2 * per_layer);
    }

    #[test]
    fn changed_ranges_send_only_what_differs() {
        use super::changed_ranges;
        let last = vec![0u8; 64];
        let mut new = last.clone();
        assert!(changed_ranges(&new, &last, 16).is_empty());
        new[17] = 1;
        new[40] = 1;
        new[63] = 1;
        assert_eq!(changed_ranges(&new, &last, 16), vec![(16, 64)]);
        new[40] = 0;
        assert_eq!(changed_ranges(&new, &last, 16), vec![(16, 32), (48, 64)]);
        // Longer than before: the tail goes too; shorter: nothing past it.
        new.extend_from_slice(&[7; 8]);
        new[17] = 0;
        new[63] = 0;
        assert_eq!(changed_ranges(&new, &last, 16), vec![(64, 72)]);
        assert!(changed_ranges(&last[..32], &last, 16).is_empty());
    }

    #[test]
    fn layer_upload_scratch_follows_the_scene_not_the_layer_limit() {
        use super::{fit_byte_scratch, fit_layer_upload_scratch, LayerGpu, LAYER_UPLOAD_SCRATCH_MIN_SLOTS, MAX_SCENE_LAYERS};

        let slot = std::mem::size_of::<LayerGpu>();
        let mut scratch = Vec::new();
        // A new render state holds nothing; a five-layer scene holds five slots.
        fit_layer_upload_scratch(&mut scratch, 5);
        assert_eq!(scratch.len(), 5);
        assert!(scratch.capacity() * slot < MAX_SCENE_LAYERS * slot / 8, "scratch must not be sized to the layer limit");
        // Growing and staying: no reallocation for small changes.
        fit_layer_upload_scratch(&mut scratch, 200);
        assert_eq!(scratch.len(), 200);
        fit_layer_upload_scratch(&mut scratch, 120);
        assert_eq!(scratch.len(), 200, "a scene a little smaller keeps the slots");
        // Shrunk to under a quarter: memory goes back, down to the floor.
        fit_layer_upload_scratch(&mut scratch, 3);
        assert_eq!(scratch.len(), LAYER_UPLOAD_SCRATCH_MIN_SLOTS);
        assert!(scratch.capacity() <= LAYER_UPLOAD_SCRATCH_MIN_SLOTS * 2);
        // Never past the layer limit.
        fit_layer_upload_scratch(&mut scratch, MAX_SCENE_LAYERS + 50);
        assert_eq!(scratch.len(), MAX_SCENE_LAYERS);
        let mut bytes = vec![1u8; 300 * slot];
        fit_byte_scratch(&mut bytes, 2 * slot);
        assert!(bytes.capacity() <= LAYER_UPLOAD_SCRATCH_MIN_SLOTS * slot * 2);
        assert!(bytes.iter().all(|b| *b == 1), "what is kept is a prefix of the last upload");
    }
}
