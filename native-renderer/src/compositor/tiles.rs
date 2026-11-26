//! Composite views, the layer upload, tile bins, mesh cell bounds and layer
//! cull bounds.

use crate::*;

/// Composite view keys of the two deck monitors and the record target.
pub(crate) const DECK_MONITOR_VIEWS: [&str; 2] = ["deck:a", "deck:b"];

#[cfg_attr(not(any(target_os = "macos", target_os = "windows")), allow(dead_code))]
pub(crate) const RECORD_TARGET_VIEW: &str = "record";

/// Frames a composite view (see `CompositeView`) is kept after it was last drawn.
pub(crate) const COMPOSITE_VIEW_KEEP_FRAMES: u64 = 120;

/// Compositor inputs of one view drawn after the program in the same frame:
/// a deck monitor, the record target or a full-detail Screen. They used to
/// share the program's uniform and layer buffers, so every view overwrote
/// the program's layers and the unchanged-upload check never matched.
pub(crate) struct CompositeView {
    pub(crate) uniform_buffer: wgpu::Buffer,
    /// The view's own layers, or None when it draws the program's.
    pub(crate) layers: Option<CompositeViewLayers>,
    /// Scene bind group 0 over this view's buffers.
    pub(crate) bind_group: wgpu::BindGroup,
    /// Its own layers read a minified picture's mips.
    pub(crate) wants_mips: bool,
    pub(crate) scene_bindings_generation: u64,
    pub(crate) used_epoch: u64,
}

pub(crate) struct CompositeViewLayers {
    pub(crate) layer_buffer: wgpu::Buffer,
    /// LayerCoreGpu slots `layer_buffer` holds.
    pub(crate) slots: usize,
    pub(crate) pool: LayerPoolState,
    pub(crate) tile_buffer: wgpu::Buffer,
    pub(crate) layer_last: Vec<u8>,
    pub(crate) mesh_cell_bounds_last: Vec<u32>,
    pub(crate) tile_last: Vec<u32>,
}

/// One composite's pool buffer (see `pack_layer_pools`) and what it and the
/// core records hold now.
pub(crate) struct LayerPoolState {
    pub(crate) buffer: wgpu::Buffer,
    /// vec4s `buffer` holds.
    pub(crate) capacity: usize,
    pub(crate) core_last: Vec<u8>,
    pub(crate) pool_last: Vec<u8>,
}

impl LayerPoolState {
    pub(crate) fn new(device: &wgpu::Device, label: &str) -> Self {
        Self {
            buffer: create_layer_pool_buffer(device, POOL_MIN_CAPACITY, label),
            capacity: POOL_MIN_CAPACITY,
            core_last: Vec::new(),
            pool_last: Vec::new(),
        }
    }
}

/// Scratch the packed layers are built in, reused frame to frame.
#[derive(Default)]
pub(crate) struct LayerPackScratch {
    pub(crate) cores: Vec<LayerCoreGpu>,
    pub(crate) pool: Vec<[f32; 4]>,
}

/// Where one composite's layers go, and what was sent there last.
pub(crate) struct CompositeLayerState<'a> {
    pub(crate) layer_buffer: &'a wgpu::Buffer,
    pub(crate) pool: &'a mut LayerPoolState,
    pub(crate) tile_buffer: &'a wgpu::Buffer,
    pub(crate) layer_last: &'a mut Vec<u8>,
    pub(crate) mesh_cell_bounds_last: &'a mut Vec<u32>,
    pub(crate) tile_last: &'a mut Vec<u32>,
}

/// Send `staged` (the first `filled` of them real layers) to `state`'s
/// buffers, skipping whatever is unchanged since the last upload there.
/// True when the pool buffer had to grow: bind groups over it are stale.
#[allow(clippy::too_many_arguments)]
pub(crate) fn upload_composite_layers(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    staged: &[LayerGpu],
    filled: usize,
    state: CompositeLayerState<'_>,
    pack: &mut LayerPackScratch,
    mesh_cell_bounds_scratch: &mut Vec<u32>,
    tile_scratch: &mut Vec<u32>,
) -> bool {
    let mut grown = false;
    fit_byte_scratch(state.layer_last, std::mem::size_of_val(staged));
    let layer_bytes: &[u8] = bytemuck::cast_slice(staged);
    if state.layer_last.as_slice() != layer_bytes {
        build_mesh_cell_bounds(&staged[..filled], mesh_cell_bounds_scratch);
        if *state.mesh_cell_bounds_last != *mesh_cell_bounds_scratch {
            churn_probe::write_buffer(queue,
                state.tile_buffer,
                (MESH_CELL_BOUNDS_BASE * std::mem::size_of::<u32>()) as u64,
                bytemuck::cast_slice(mesh_cell_bounds_scratch),
            );
            churn_probe::layer_bytes(mesh_cell_bounds_scratch.len() * 4);
            std::mem::swap(state.mesh_cell_bounds_last, mesh_cell_bounds_scratch);
        }
        let full = layer_upload_full();
        pack_layer_pools(staged, full, &mut pack.cores, &mut pack.pool);
        let pool = state.pool;
        if pack.pool.len() > pool.capacity {
            pool.capacity = pack.pool.len().next_power_of_two().max(POOL_MIN_CAPACITY);
            pool.buffer = create_layer_pool_buffer(device, pool.capacity, "Ghost Render Core Layer Pool");
            pool.pool_last.clear();
            grown = true;
        }
        let sent = write_changed_ranges(queue, state.layer_buffer, bytemuck::cast_slice(&pack.cores),
            &mut pool.core_last, std::mem::size_of::<LayerCoreGpu>(), full)
            + write_changed_ranges(queue, &pool.buffer, bytemuck::cast_slice(&pack.pool),
                &mut pool.pool_last, 256, full);
        churn_probe::layer_bytes(sent);
        state.layer_last.clear();
        state.layer_last.extend_from_slice(layer_bytes);
    }
    let culls = staged[..filled].iter().map(|layer| layer.cull).collect::<Vec<_>>();
    build_layer_tiles(&culls, tile_scratch);
    if *state.tile_last != *tile_scratch {
        churn_probe::write_buffer(queue, state.tile_buffer, 0, bytemuck::cast_slice(tile_scratch));
        churn_probe::layer_bytes(tile_scratch.len() * 4);
        std::mem::swap(state.tile_last, tile_scratch);
    }
    grown
}

pub(crate) fn build_layer_tiles(culls: &[[f32; 4]], out: &mut Vec<u32>) {
    out.clear();
    out.resize(LAYER_TILE_HEADER + LAYER_TILE_CELLS + 1, 0);
    out[0] = LAYER_TILES as u32;
    out[1] = LAYER_TILES as u32;
    let tile = |v: f32| ((v.clamp(0.0, 1.0) * LAYER_TILES as f32) as usize).min(LAYER_TILES - 1);
    let ranges = culls
        .iter()
        .map(|c| {
            let empty = !(c[0] <= c[2] && c[1] <= c[3]);
            let off_canvas = c[2] < 0.0 || c[3] < 0.0 || c[0] > 1.0 || c[1] > 1.0;
            (!empty && !off_canvas).then(|| (tile(c[0]), tile(c[1]), tile(c[2]), tile(c[3])))
        })
        .collect::<Vec<_>>();
    let mut counts = [0u32; LAYER_TILE_CELLS];
    let mut total = 0usize;
    for (x0, y0, x1, y1) in ranges.iter().flatten() {
        for ty in *y0..=*y1 {
            for tx in *x0..=*x1 {
                counts[ty * LAYER_TILES + tx] += 1;
            }
        }
        total += (x1 - x0 + 1) * (y1 - y0 + 1);
    }
    if total > LAYER_TILE_INDEX_CAP {
        return; // enabled stays 0
    }
    let mut cursor = [0u32; LAYER_TILE_CELLS];
    let mut running = 0u32;
    for cell in 0..LAYER_TILE_CELLS {
        out[LAYER_TILE_HEADER + cell] = running;
        cursor[cell] = running;
        running += counts[cell];
    }
    out[LAYER_TILE_HEADER + LAYER_TILE_CELLS] = running;
    let base = out.len();
    out.resize(base + total, 0);
    for (index, range) in ranges.iter().enumerate() {
        let Some((x0, y0, x1, y1)) = range else { continue };
        for ty in *y0..=*y1 {
            for tx in *x0..=*x1 {
                let cell = ty * LAYER_TILES + tx;
                out[base + cursor[cell] as usize] = index as u32;
                cursor[cell] += 1;
            }
        }
    }
    out[2] = 1;
    out[3] = total as u32;
}

/// Fill `out` with the mesh cell bounds for these layers (see
/// MESH_CELL_BOUNDS_BASE): the boxes `layer_mesh_straight_cell` and
/// `layer_mesh_bezier_cell` in heartbeat.wgsl test, from the same packed
/// points and tangents, padded by MESH_CELL_BOUNDS_SLACK more.
pub(crate) fn build_mesh_cell_bounds(layers: &[LayerGpu], out: &mut Vec<u32>) {
    out.clear();
    out.resize(MAX_SCENE_LAYERS, 0);
    let mut budget = MESH_CELL_BOUNDS_LAYERS * MESH_CELL_WORDS_PER_LAYER;
    for (index, layer) in layers.iter().enumerate().take(MAX_SCENE_LAYERS) {
        // Same rounding as layer_mesh_uv.
        let side = |v: f32| (v + 0.5).floor().clamp(0.0, 16.0) as usize;
        let rows = side(layer.style[2]);
        let cols = side(layer.style[3]);
        if rows < 2 || cols < 2 {
            continue;
        }
        let words = (rows - 1) * (cols - 1) * 4;
        if words > budget {
            continue;
        }
        budget -= words;
        out[index] = (MESH_CELL_BOUNDS_BASE + out.len()) as u32;
        let bezier = layer.fast_flags[1] == 1;
        let point = |i: usize| -> [f64; 2] {
            let packed = layer.mesh[i / 2];
            if i % 2 == 0 { [packed[0] as f64, packed[1] as f64] } else { [packed[2] as f64, packed[3] as f64] }
        };
        // layer_mesh_tangent: side 0 right, 1 down, 2 left, 3 up.
        let tangent = |i: usize, side: usize| -> [f64; 2] {
            let packed = layer.mesh_tangents[i * 2 + (side >> 1)];
            if side & 1 == 0 { [packed[0] as f64, packed[1] as f64] } else { [packed[2] as f64, packed[3] as f64] }
        };
        let add = |p: [f64; 2], t: [f64; 2]| [p[0] + t[0], p[1] + t[1]];
        let mix = |a: [f64; 2], b: [f64; 2], t: f64| [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        for row in 0..rows - 1 {
            for col in 0..cols - 1 {
                let ia = row * cols + col;
                let ib = ia + 1;
                let id = ia + cols;
                let ic = id + 1;
                let (a, b, c, d) = (point(ia), point(ib), point(ic), point(id));
                let mut pts = vec![a, b, c, d];
                let pad = if bezier {
                    // mesh_patch_build, then mesh_patch_contains_bounds.
                    let ab1 = add(a, tangent(ia, 0));
                    let ab2 = add(b, tangent(ib, 2));
                    let dc1 = add(d, tangent(id, 0));
                    let dc2 = add(c, tangent(ic, 2));
                    let ad1 = add(a, tangent(ia, 1));
                    let ad2 = add(d, tangent(id, 3));
                    let bc1 = add(b, tangent(ib, 1));
                    let bc2 = add(c, tangent(ic, 3));
                    pts.extend([ab1, ab2, dc1, dc2, ad1, ad2, bc1, bc2]);
                    for j in 1..=2usize {
                        for i in 1..=2usize {
                            let (fu, fv) = (i as f64 / 3.0, j as f64 / 3.0);
                            let top = if i == 1 { ab1 } else { ab2 };
                            let bottom = if i == 1 { dc1 } else { dc2 };
                            let left = if j == 1 { ad1 } else { ad2 };
                            let right = if j == 1 { bc1 } else { bc2 };
                            let sheet = mix(mix(a, b, fu), mix(d, c, fu), fv);
                            let tb = mix(top, bottom, fv);
                            let lr = mix(left, right, fu);
                            pts.push([tb[0] + lr[0] - sheet[0], tb[1] + lr[1] - sheet[1]]);
                        }
                    }
                    0.002
                } else {
                    0.000001
                };
                let mut lo = [f64::INFINITY; 2];
                let mut hi = [f64::NEG_INFINITY; 2];
                for p in &pts {
                    for k in 0..2 {
                        lo[k] = lo[k].min(p[k]);
                        hi[k] = hi[k].max(p[k]);
                    }
                }
                let reach = lo.iter().chain(hi.iter()).fold(0.0f64, |m, v| m.max(v.abs()));
                let grow = pad + MESH_CELL_BOUNDS_SLACK * (1.0 + reach);
                let mut cell = [(lo[0] - grow) as f32, (lo[1] - grow) as f32, (hi[0] + grow) as f32, (hi[1] + grow) as f32];
                // A point the shader could not bound (NaN, infinite) keeps
                // the whole plane: the shader's own test decides there.
                if cell.iter().any(|v| !v.is_finite()) {
                    cell = [f32::MIN, f32::MIN, f32::MAX, f32::MAX];
                }
                out.extend(cell.iter().map(|v| v.to_bits()));
            }
        }
    }
}

/// See `LayerGpu::cull`. Mirrors the compositor's own reject in
/// heartbeat.wgsl: hierarchy masks touch every pixel; hidden and fully
/// transparent layers touch none; everything else is bounded by its quad
/// (or a Bezier mesh's reach) plus the area its edge effects can glow into.
pub(crate) fn layer_cull_bounds(layer: &LayerGpu) -> [f32; 4] {
    const ALL: [f32; 4] = [-1.0e9, -1.0e9, 1.0e9, 1.0e9];
    const NONE: [f32; 4] = [1.0e9, 1.0e9, -1.0e9, -1.0e9];
    if layer.meta[0] < 0.5 {
        return NONE;
    }
    let blend = layer.style[0];
    if (25.5..26.5).contains(&blend) {
        return ALL;
    }
    if layer.color[3] <= 0.001 {
        return NONE;
    }
    let tl = [layer.p0[0], layer.p0[1]];
    let tr = [layer.p0[2], layer.p0[3]];
    let br = [layer.p1[0], layer.p1[1]];
    let bl = [layer.p1[2], layer.p1[3]];
    let mut corners = vec![tl, tr, br, bl];
    if layer.fast_flags[1] == 1 {
        // quad_reach_bounds: the mesh reach in quad-local UV, at least 0..1.
        let reach = layer.mesh_bounds;
        let lo = [reach[0].min(0.0), reach[1].min(0.0)];
        let hi = [reach[2].max(1.0), reach[3].max(1.0)];
        let at = |u: f32, v: f32| {
            let top = [tl[0] + (tr[0] - tl[0]) * u, tl[1] + (tr[1] - tl[1]) * u];
            let bottom = [bl[0] + (br[0] - bl[0]) * u, bl[1] + (br[1] - bl[1]) * u];
            [top[0] + (bottom[0] - top[0]) * v, top[1] + (bottom[1] - top[1]) * v]
        };
        corners.extend([at(lo[0], lo[1]), at(hi[0], lo[1]), at(hi[0], hi[1]), at(lo[0], hi[1])]);
    }
    if corners.iter().any(|c| !c[0].is_finite() || !c[1].is_finite()) {
        return ALL;
    }
    let mut b = [f32::MAX, f32::MAX, f32::MIN, f32::MIN];
    for c in &corners {
        b[0] = b[0].min(c[0]);
        b[1] = b[1].min(c[1]);
        b[2] = b[2].max(c[0]);
        b[3] = b[3].max(c[1]);
    }
    // Same padding as the shader's reject, doubled to stay conservative.
    let pad = (b[2] - b[0]).max(b[3] - b[1]).max(1.0) * 0.002;
    b = [b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad];
    if layer.edge_info[1] > 0.5 && layer.edge_info[0] > 2.5 {
        let e = layer.edge_bounds;
        b = [b[0].min(e[0]), b[1].min(e[1]), b[2].max(e[2]), b[3].max(e[3])];
    }
    b
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn layer_tiles_list_each_tiles_layers_bottom_to_top() {
        const NONE: [f32; 4] = [1.0e9, 1.0e9, -1.0e9, -1.0e9];
        const ALL: [f32; 4] = [-1.0e9, -1.0e9, 1.0e9, 1.0e9];
        let culls = [
            [0.0, 0.0, 1.0, 1.0],        // 0: the whole canvas
            [0.0, 0.0, 0.02, 0.02],      // 1: the bottom-left tile only
            NONE,                        // 2: hidden
            [0.5, 0.5, 0.52, 0.52],      // 3: one tile in the middle
            [1.5, 1.5, 2.0, 2.0],        // 4: only off the canvas
            ALL,                         // 5: a hierarchy mask
        ];
        let mut out = Vec::new();
        build_layer_tiles(&culls, &mut out);
        assert_eq!(&out[..3], &[LAYER_TILES as u32, LAYER_TILES as u32, 1]);
        let tile = |tx: usize, ty: usize| {
            let cell = LAYER_TILE_HEADER + ty * LAYER_TILES + tx;
            let base = LAYER_TILE_HEADER + LAYER_TILE_CELLS + 1;
            out[base + out[cell] as usize..base + out[cell + 1] as usize].to_vec()
        };
        assert_eq!(tile(0, 0), vec![0, 1, 5]);
        assert_eq!(tile(16, 16), vec![0, 3, 5]);
        assert_eq!(tile(31, 31), vec![0, 5]);
        // Too many entries: binning off, every pixel walks every layer.
        let crowd = vec![[0.0, 0.0, 1.0, 1.0]; LAYER_TILE_INDEX_CAP / LAYER_TILE_CELLS + 1];
        build_layer_tiles(&crowd, &mut out);
        assert_eq!(out[2], 0);
    }

    #[test]
    fn mesh_cell_bounds_hold_the_boxes_the_compositor_tests() {
        let wgsl = include_str!("../heartbeat.wgsl");
        assert!(wgsl.contains(&format!("const MESH_CELL_BOUNDS_BASE: u32 = {MESH_CELL_BOUNDS_BASE}u;")));
        // A 4 x 3 Bezier mesh with bent tangents, and a straight 2 x 2 one.
        let mut bezier = LayerGpu::zeroed();
        bezier.style[2] = 4.0;
        bezier.style[3] = 3.0;
        bezier.fast_flags[1] = 1;
        let (rows, cols) = (4usize, 3usize);
        let mut seed = 11u32;
        let mut rnd = || { seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223); (seed >> 8) as f32 / 16_777_216.0 - 0.5 };
        let mut pts = vec![[0.0f32; 2]; rows * cols];
        for r in 0..rows {
            for c in 0..cols {
                pts[r * cols + c] = [c as f32 / 2.0 + rnd() * 0.1, 1.0 - r as f32 / 3.0 + rnd() * 0.1];
            }
        }
        for (i, p) in pts.iter().enumerate() {
            let slot = &mut bezier.mesh[i / 2];
            let o = (i % 2) * 2;
            slot[o] = p[0];
            slot[o + 1] = p[1];
            for half in 0..2 {
                bezier.mesh_tangents[i * 2 + half] = [rnd() * 0.2, rnd() * 0.2, rnd() * 0.2, rnd() * 0.2];
            }
        }
        let mut straight = LayerGpu::zeroed();
        straight.style[2] = 2.0;
        straight.style[3] = 2.0;
        straight.mesh[0] = [0.0, 1.0, 1.1, 0.9];
        straight.mesh[1] = [0.1, -0.05, 1.0, 0.0];
        let plain = LayerGpu::zeroed();
        let mut out = Vec::new();
        build_mesh_cell_bounds(&[plain, bezier, straight], &mut out);
        assert_eq!(out[0], 0, "a layer without a mesh has no boxes");
        let boxes = |layer: usize, cell: usize| -> [f32; 4] {
            let at = out[layer] as usize - MESH_CELL_BOUNDS_BASE + cell * 4;
            [f32::from_bits(out[at]), f32::from_bits(out[at + 1]), f32::from_bits(out[at + 2]), f32::from_bits(out[at + 3])]
        };
        // The shader's own box (f32, as heartbeat.wgsl works it out) must sit
        // inside the stored one, by the slack.
        let pt = |l: &LayerGpu, i: usize| { let p = l.mesh[i / 2]; if i % 2 == 0 { [p[0], p[1]] } else { [p[2], p[3]] } };
        let tan = |l: &LayerGpu, i: usize, side: usize| { let p = l.mesh_tangents[i * 2 + (side >> 1)]; if side & 1 == 0 { [p[0], p[1]] } else { [p[2], p[3]] } };
        let add = |a: [f32; 2], b: [f32; 2]| [a[0] + b[0], a[1] + b[1]];
        let mix = |a: [f32; 2], b: [f32; 2], t: f32| [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        for row in 0..rows - 1 {
            for col in 0..cols - 1 {
                let ia = row * cols + col;
                let (ib, id) = (ia + 1, ia + cols);
                let ic = id + 1;
                let (a, b, c, d) = (pt(&bezier, ia), pt(&bezier, ib), pt(&bezier, ic), pt(&bezier, id));
                let (ab1, ab2) = (add(a, tan(&bezier, ia, 0)), add(b, tan(&bezier, ib, 2)));
                let (dc1, dc2) = (add(d, tan(&bezier, id, 0)), add(c, tan(&bezier, ic, 2)));
                let (ad1, ad2) = (add(a, tan(&bezier, ia, 1)), add(d, tan(&bezier, id, 3)));
                let (bc1, bc2) = (add(b, tan(&bezier, ib, 1)), add(c, tan(&bezier, ic, 3)));
                let mut all = vec![a, b, c, d, ab1, ab2, dc1, dc2, ad1, ad2, bc1, bc2];
                for j in 1..=2 {
                    for i in 1..=2 {
                        let (fu, fv) = (i as f32 / 3.0, j as f32 / 3.0);
                        let sheet = mix(mix(a, b, fu), mix(d, c, fu), fv);
                        let tb = mix(if i == 1 { ab1 } else { ab2 }, if i == 1 { dc1 } else { dc2 }, fv);
                        let lr = mix(if j == 1 { ad1 } else { ad2 }, if j == 1 { bc1 } else { bc2 }, fu);
                        all.push([tb[0] + lr[0] - sheet[0], tb[1] + lr[1] - sheet[1]]);
                    }
                }
                let stored = boxes(1, row * (cols - 1) + col);
                for k in 0..2 {
                    let lo = all.iter().map(|p| p[k]).fold(f32::INFINITY, f32::min) - 0.002;
                    let hi = all.iter().map(|p| p[k]).fold(f32::NEG_INFINITY, f32::max) + 0.002;
                    assert!(stored[k] < lo - 5e-6 && stored[k] > lo - 1e-4, "cell {row},{col} axis {k}: {} vs {lo}", stored[k]);
                    assert!(stored[k + 2] > hi + 5e-6 && stored[k + 2] < hi + 1e-4, "cell {row},{col} axis {k}: {} vs {hi}", stored[k + 2]);
                }
            }
        }
        let cell = boxes(2, 0);
        assert!(cell[0] < 0.0 - 1e-6 && cell[1] < -0.05 - 1e-6 && cell[2] > 1.1 + 1e-6 && cell[3] > 1.0 + 1e-6);
        // Directory entries point past the directory, one after the other.
        assert_eq!(out[1] as usize, MESH_CELL_BOUNDS_BASE + MAX_SCENE_LAYERS);
        assert_eq!(out[2] as usize, out[1] as usize + (rows - 1) * (cols - 1) * 4);
        assert_eq!(out.len(), MAX_SCENE_LAYERS + ((rows - 1) * (cols - 1) + 1) * 4);
    }
}
